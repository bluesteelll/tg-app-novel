//! The puzzle tables (`0002_puzzles.sql`): `puzzle_progress`, the attempt window and the solve of each (user,
//! puzzle), and `hint_unlocks`, read here only (its one writer is the hint spend of a later lane); and
//! `puzzle_values` (`0008_puzzle_values.sql`), each player's value of a per-player puzzle and its run.
//!
//! Every statement binds the token's user and the puzzle's storage key ([`PuzzleKey`], per-player §3.8: the id the
//! puzzle first shipped under, so a rename keeps its rows). A static solution never reaches this module: the caller
//! checks the answer against the content and passes whether it was correct, so the window is decided before that fact
//! is used. A per-player value is read, compared and counted only here, after the window decision, under its row
//! lock (per-player §3.5).

use std::fmt;

use sqlx::PgConnection;

use crate::db::Repo;
use crate::ids::{PuzzleKey, UserId};
use crate::puzzles::values::{Domain, DomainHash, ValueRow};
use crate::puzzles::{ATTEMPT_WINDOW_MAX, ATTEMPT_WINDOW_SECS, attempts_left};

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

/// What [`Repo::record_attempt`] judges an answer against (per-player §3.5).
pub enum Expected<'a> {
    /// The caller compared the answer with the static solution: whether it was right.
    Static {
        /// The answer is the solution.
        correct: bool,
    },
    /// The player's value decides, read under its row lock once the window admits the attempt.
    PerPlayer {
        /// The answer, already checked against the puzzle's shape.
        answer: &'a [u16],
        /// The content's domain of the puzzle.
        domain: &'a Domain,
        /// The author's cap on wrong answers per run; `None` without one.
        cap: Option<u8>,
        /// The run the client answers; `None` when it sent none.
        run: Option<i64>,
        /// A value of `domain`, drawn before the transaction, used only for an absent row.
        drawn: Vec<u16>,
    },
}

// The answer and the drawn value are a player's secret: neither is printed (per-player §3.1, m12).
impl fmt::Debug for Expected<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Expected::Static { correct } => {
                f.debug_struct("Static").field("correct", correct).finish()
            }
            Expected::PerPlayer {
                domain, cap, run, ..
            } => f
                .debug_struct("PerPlayer")
                .field("answer", &format_args!("<redacted>"))
                .field("domain", domain)
                .field("cap", cap)
                .field("run", run)
                .field("drawn", &format_args!("<redacted>"))
                .finish(),
        }
    }
}

/// What [`Repo::record_attempt`] recorded.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AttemptRecord {
    /// The attempt is past the window's limit: it was counted, and its answer was neither applied nor compared.
    Limited {
        /// The seconds until the window ends, in `1..=ATTEMPT_WINDOW_SECS`.
        retry_after_secs: i64,
        /// The puzzle is solved (by an earlier answer).
        solved: bool,
    },
    /// The answer was judged.
    Answered {
        /// The answer is the solution or the player's value.
        correct: bool,
        /// The puzzle is solved once this attempt is recorded.
        solved: bool,
        /// A capped per-player puzzle's wrong answers left in the run; `None` otherwise.
        attempts_left: Option<u8>,
        /// This answer spent the run.
        spent: bool,
    },
    /// A per-player answer whose run is absent or not current, or whose run is spent: nothing compared, no wrong
    /// answer counted; the player's current row.
    ValueChanged(ValueRow),
}

/// The one-row read of a value inside the caller's transaction (per-player §3.5 step 3): insert-if-absent with
/// `drawn` (run 1, live), then the row under `FOR UPDATE`, held to the commit.
async fn current_value(
    tx: &mut PgConnection,
    user: UserId,
    puzzle: &PuzzleKey,
    domain: &Domain,
    drawn: &[u16],
    now: i64,
) -> Result<ValueRow, sqlx::Error> {
    let value: Vec<i64> = drawn.iter().map(|&entry| i64::from(entry)).collect();
    sqlx::query(
        "INSERT INTO puzzle_values (user_id, puzzle_id, run, wrong, issued_at, domain, value) \
         VALUES ($1, $2, 1, 0, $3, $4, $5) ON CONFLICT (user_id, puzzle_id) DO NOTHING",
    )
    .bind(user.0)
    .bind(&puzzle.0)
    .bind(now)
    .bind(&domain.hash().0)
    .bind(&value)
    .execute(&mut *tx)
    .await?;
    let columns: ValueColumns = sqlx::query_as(
        "SELECT puzzle_id, run, wrong, issued_at, spent_at, domain, value FROM puzzle_values \
         WHERE user_id = $1 AND puzzle_id = $2 FOR UPDATE",
    )
    .bind(user.0)
    .bind(&puzzle.0)
    .fetch_one(&mut *tx)
    .await?;
    value_row(columns)
}

impl Repo {
    /// Counts one attempt of `user` on the puzzle keyed `puzzle` at `now`, then judges it by `expected` unless the
    /// window is full. One READ COMMITTED transaction: the upsert counts first and holds the (user, puzzle) row lock to
    /// the commit, so two attempts serialize (a first-ever pair's second insert waits on the first, then takes the
    /// update path) and the window count is exact. A window older than [`ATTEMPT_WINDOW_SECS`] restarts at `now` with
    /// this attempt. Past [`ATTEMPT_WINDOW_MAX`] the count commits, the answer is neither applied nor returned, and no
    /// value is read. A per-player answer is compared with the player's row, read under its lock (per-player §3.5),
    /// only when it names the row's run and the run is live; otherwise the row is returned and nothing compared. A
    /// wrong per-player answer counts in the row, and the one that reaches the author's cap spends the run.
    pub async fn record_attempt(
        &self,
        user: UserId,
        puzzle: &PuzzleKey,
        expected: Expected<'_>,
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
            return Ok(AttemptRecord::Limited {
                retry_after_secs,
                solved: solved_at.is_some(),
            });
        }
        let (correct, attempts_left, spent) = match expected {
            Expected::Static { correct } => (correct, None, false),
            Expected::PerPlayer {
                answer,
                domain,
                cap,
                run,
                drawn,
            } => {
                let row = current_value(&mut tx, user, puzzle, domain, &drawn, now).await?;
                // A runless answer comes from a device that shows no value of this puzzle: it is handed the value,
                // never judged against one it did not display (§3.5 step 4).
                if run != Some(row.run) || row.spent_at.is_some() {
                    tx.commit().await?;
                    return Ok(AttemptRecord::ValueChanged(row));
                }
                if answer == row.value.as_slice() {
                    (true, attempts_left(cap, row.wrong), false)
                } else {
                    // Every wrong answer of a run counts, a solved puzzle's replay too; the final one under the cap
                    // spends the run. `GREATEST` keeps `spent_at` at or after the draw when the clock stepped back
                    // since (`puzzle_values_spent_after`), so it stays a 200, never a 500.
                    let wrong = row.wrong + 1;
                    let spends = cap.is_some_and(|m| wrong >= i64::from(m));
                    sqlx::query(
                        "UPDATE puzzle_values SET wrong = $3, \
                         spent_at = CASE WHEN $4 THEN GREATEST($5, issued_at) ELSE NULL END \
                         WHERE user_id = $1 AND puzzle_id = $2",
                    )
                    .bind(user.0)
                    .bind(&puzzle.0)
                    .bind(wrong)
                    .bind(spends)
                    .bind(now)
                    .execute(&mut *tx)
                    .await?;
                    (false, attempts_left(cap, wrong), spends)
                }
            }
        };
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
        Ok(AttemptRecord::Answered {
            correct,
            solved,
            attempts_left,
            spent,
        })
    }

    /// The current run of `user`'s value of the puzzle keyed `puzzle` after a restart request from run `from`
    /// (per-player §3.6), in one READ COMMITTED transaction: the row `FOR UPDATE` ([`current_value`], issued first if
    /// absent); when its run is `from` and spent, a new run starts: re-drawn (`drawn`, of `domain`, issued `now`)
    /// for an unsolved puzzle, on the same value and its draw time for a solved one (`solved_at` read without a lock:
    /// only an attempt sets it, under the progress lock this path never takes). Otherwise nothing changes: `from` is
    /// the guard, so a repeat, a stale `from` or a live run answers the current row.
    pub async fn restart_value(
        &self,
        user: UserId,
        puzzle: &PuzzleKey,
        domain: &Domain,
        drawn: Vec<u16>,
        from: i64,
        now: i64,
    ) -> Result<ValueRow, sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        let row = current_value(&mut tx, user, puzzle, domain, &drawn, now).await?;
        if row.run != from || row.spent_at.is_none() {
            tx.commit().await?;
            return Ok(row);
        }
        let solved: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM puzzle_progress \
             WHERE user_id = $1 AND puzzle_id = $2 AND solved_at IS NOT NULL)",
        )
        .bind(user.0)
        .bind(&puzzle.0)
        .fetch_one(&mut *tx)
        .await?;
        let (issued_at, hash, value) = if solved {
            (row.issued_at, row.domain, row.value)
        } else {
            (now, domain.hash().clone(), drawn)
        };
        let value: Vec<i64> = value.iter().map(|&entry| i64::from(entry)).collect();
        let columns: ValueColumns = sqlx::query_as(
            "UPDATE puzzle_values SET run = run + 1, wrong = 0, spent_at = NULL, issued_at = $3, domain = $4, \
             value = $5 WHERE user_id = $1 AND puzzle_id = $2 \
             RETURNING puzzle_id, run, wrong, issued_at, spent_at, domain, value",
        )
        .bind(user.0)
        .bind(&puzzle.0)
        .bind(issued_at)
        .bind(&hash.0)
        .bind(&value)
        .fetch_one(&mut *tx)
        .await?;
        tx.commit().await?;
        value_row(columns)
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
