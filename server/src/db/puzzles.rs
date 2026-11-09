//! The puzzle tables (`0002_puzzles.sql`): `puzzle_progress`, the attempt window and the solve of each (user,
//! puzzle), and `hint_unlocks`, read here only (its one writer is the hint spend of a later lane); and
//! `puzzle_values` (`0008_puzzle_values.sql`), each player's value of a per-player puzzle and its run.
//!
//! Every statement binds the token's user and the puzzle's storage key ([`PuzzleKey`], per-player §3.8: the id the
//! puzzle first shipped under, so a rename keeps its rows). No solution reaches this module: the caller checks the
//! answer against the content and passes whether it was correct, so the window is decided before that fact is used.

use sqlx::PgConnection;

use crate::db::Repo;
use crate::ids::{PuzzleKey, UserId};
use crate::puzzles::values::{Domain, DomainHash, ValueRow};
use crate::puzzles::{ATTEMPT_WINDOW_MAX, ATTEMPT_WINDOW_SECS};

/// One per-player puzzle of a values call: its storage key, its domain, and a value drawn from it before the
/// transaction, stored only when the player has no row yet. No `Debug`: `drawn` is a player's value.
pub struct ValueIssue<'a> {
    /// The puzzle's storage key.
    pub puzzle: &'a PuzzleKey,
    /// The content's domain of the puzzle.
    pub domain: &'a Domain,
    /// A value of `domain`, used only for an absent row.
    pub drawn: Vec<u16>,
}

/// A `puzzle_values` row as sqlx reads it: (puzzle_id, run, wrong, issued_at, spent_at, domain, value).
type ValueColumns = (String, i64, i64, i64, Option<i64>, String, Vec<i64>);

/// The row of `columns`; an entry outside u16 is a decode error (`puzzle_values_value_range` makes it unreachable, and
/// a 500 beats a panic if the schema ever drifts).
fn value_row(columns: ValueColumns) -> Result<ValueRow, sqlx::Error> {
    let (puzzle, run, wrong, issued_at, spent_at, domain, value) = columns;
    let value = value
        .into_iter()
        .map(|entry| {
            u16::try_from(entry)
                .map_err(|_| sqlx::Error::Decode("puzzle_values.value outside u16".into()))
        })
        .collect::<Result<Vec<u16>, sqlx::Error>>()?;
    Ok(ValueRow {
        puzzle: PuzzleKey(puzzle),
        run,
        wrong,
        issued_at,
        spent_at,
        domain: DomainHash(domain),
        value,
    })
}

/// `value` as a PostgreSQL array literal, `{1,8,4,7}`: values of different lengths travel as one `text[]` parameter
/// and are cast per row (per-player §3.4, m6). Built from `u16`s only, and bound, never spliced into SQL.
fn array_literal(value: &[u16]) -> String {
    let mut text = String::with_capacity(2 + value.len() * 6);
    text.push('{');
    for (i, entry) in value.iter().enumerate() {
        if i > 0 {
            text.push(',');
        }
        text.push_str(&entry.to_string());
    }
    text.push('}');
    text
}

/// The values route's read inside the caller's transaction (per-player §3.4, §3.5): one statement issues the absent
/// rows of `set`, inserted in key order with the primary key as the arbiter (never a check-then-insert), so two
/// issuers of one chapter meet the unique-index waits in the same order; then one plain select reads the rows, in key
/// order.
async fn chapter_values(
    tx: &mut PgConnection,
    user: UserId,
    set: &[ValueIssue<'_>],
    now: i64,
) -> Result<Vec<ValueRow>, sqlx::Error> {
    let keys: Vec<&str> = set.iter().map(|v| v.puzzle.0.as_str()).collect();
    let domains: Vec<&str> = set.iter().map(|v| v.domain.hash().0.as_str()).collect();
    let values: Vec<String> = set.iter().map(|v| array_literal(&v.drawn)).collect();
    sqlx::query(
        "INSERT INTO puzzle_values (user_id, run, wrong, issued_at, puzzle_id, domain, value) \
         SELECT $1, 1, 0, $2, k, d, v::bigint[] FROM unnest($3::text[], $4::text[], $5::text[]) AS t(k, d, v) \
         ORDER BY k \
         ON CONFLICT (user_id, puzzle_id) DO NOTHING",
    )
    .bind(user.0)
    .bind(now)
    .bind(&keys)
    .bind(&domains)
    .bind(&values)
    .execute(&mut *tx)
    .await?;
    let rows: Vec<ValueColumns> = sqlx::query_as(
        "SELECT puzzle_id, run, wrong, issued_at, spent_at, domain, value FROM puzzle_values \
         WHERE user_id = $1 AND puzzle_id = ANY($2) ORDER BY puzzle_id",
    )
    .bind(user.0)
    .bind(&keys)
    .fetch_all(&mut *tx)
    .await?;
    rows.into_iter().map(value_row).collect()
}

/// What [`Repo::record_attempt`] recorded.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AttemptRecord {
    /// The attempt is past the window's limit: it was counted, and its answer was not applied.
    pub limited: bool,
    /// When `limited`, the seconds until the window ends, in `1..=ATTEMPT_WINDOW_SECS`; 0 otherwise.
    pub retry_after_secs: i64,
    /// Whether the puzzle is solved once this attempt is recorded.
    pub solved: bool,
}

impl Repo {
    /// Counts one attempt of `user` on the puzzle keyed `puzzle` at `now`, then applies `correct` unless the window is
    /// full. One READ COMMITTED transaction: the upsert counts first and holds the (user, puzzle) row lock to the
    /// commit, so two attempts serialize (a first-ever pair's second insert waits on the first, then takes the update
    /// path) and the window count is exact. A window older than [`ATTEMPT_WINDOW_SECS`] restarts at `now` with this attempt.
    /// Past [`ATTEMPT_WINDOW_MAX`] the count commits and `correct` is neither applied nor returned.
    pub async fn record_attempt(
        &self,
        user: UserId,
        puzzle: &PuzzleKey,
        correct: bool,
        now: i64,
    ) -> Result<AttemptRecord, sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        // The existing row's columns are qualified (`AS p`): unqualified, they are ambiguous in `DO UPDATE SET`.
        let (window_attempts, window_start, solved_at): (i64, i64, Option<i64>) = sqlx::query_as(
            "INSERT INTO puzzle_progress AS p \
             (user_id, puzzle_id, attempts, window_start, window_attempts, first_at, solved_at) \
             VALUES ($1, $2, 1, $3, 1, $3, NULL) \
             ON CONFLICT (user_id, puzzle_id) DO UPDATE SET \
             attempts = p.attempts + 1, \
             window_attempts = CASE WHEN p.window_start <= $3 - $4 THEN 1 ELSE p.window_attempts + 1 END, \
             window_start = CASE WHEN p.window_start <= $3 - $4 THEN $3 ELSE p.window_start END \
             RETURNING window_attempts, window_start, solved_at",
        )
        .bind(user.0)
        .bind(&puzzle.0)
        .bind(now)
        .bind(ATTEMPT_WINDOW_SECS)
        .fetch_one(&mut *tx)
        .await?;
        if window_attempts > ATTEMPT_WINDOW_MAX {
            tx.commit().await?;
            // Already in range unless the clock stepped back since the window began; the clamp keeps the header sane.
            let retry_after_secs =
                (window_start + ATTEMPT_WINDOW_SECS - now).clamp(1, ATTEMPT_WINDOW_SECS);
            return Ok(AttemptRecord {
                limited: true,
                retry_after_secs,
                solved: solved_at.is_some(),
            });
        }
        let solved = if correct {
            // Set once: a later correct answer keeps the first solve's time. `GREATEST` keeps the solve at or after
            // the first attempt when the clock stepped back between them (`puzzle_progress_solved_after_first`).
            sqlx::query(
                "UPDATE puzzle_progress SET solved_at = GREATEST($3, first_at) \
                 WHERE user_id = $1 AND puzzle_id = $2 AND solved_at IS NULL",
            )
            .bind(user.0)
            .bind(&puzzle.0)
            .bind(now)
            .execute(&mut *tx)
            .await?;
            true
        } else {
            solved_at.is_some()
        };
        tx.commit().await?;
        Ok(AttemptRecord {
            limited: false,
            retry_after_secs: 0,
            solved,
        })
    }

    /// `user`'s values of `set` (one chapter's per-player puzzles), each issued if absent, in key order: one READ
    /// COMMITTED transaction ([`chapter_values`]). N calls give the same rows.
    pub async fn issue_values(
        &self,
        user: UserId,
        set: &[ValueIssue<'_>],
        now: i64,
    ) -> Result<Vec<ValueRow>, sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        let rows = chapter_values(&mut tx, user, set, now).await?;
        tx.commit().await?;
        Ok(rows)
    }

    /// Whether `user` solved the puzzle keyed `puzzle`.
    pub async fn is_solved(&self, user: UserId, puzzle: &PuzzleKey) -> Result<bool, sqlx::Error> {
        sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM puzzle_progress \
             WHERE user_id = $1 AND puzzle_id = $2 AND solved_at IS NOT NULL)",
        )
        .bind(user.0)
        .bind(&puzzle.0)
        .fetch_one(&self.pool)
        .await
    }

    /// The hint tiers of the puzzle keyed `puzzle` that `user` unlocked, ascending.
    pub async fn unlocked_tiers(
        &self,
        user: UserId,
        puzzle: &PuzzleKey,
    ) -> Result<Vec<u8>, sqlx::Error> {
        let tiers: Vec<i64> = sqlx::query_scalar(
            "SELECT tier FROM hint_unlocks WHERE user_id = $1 AND puzzle_id = $2 ORDER BY tier",
        )
        .bind(user.0)
        .bind(&puzzle.0)
        .fetch_all(&self.pool)
        .await?;
        // `hint_unlocks_tier_range` makes the error unreachable; a 500 beats a panic if the schema ever drifts.
        tiers
            .into_iter()
            .map(|tier| {
                u8::try_from(tier)
                    .map_err(|_| sqlx::Error::Decode("hint_unlocks.tier outside u8".into()))
            })
            .collect()
    }
}
