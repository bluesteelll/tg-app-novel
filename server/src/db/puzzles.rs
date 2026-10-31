//! The puzzle tables (`0002_puzzles.sql`): `puzzle_progress`, the attempt window and the solve of each (user,
//! puzzle), and `hint_unlocks`, read here only (its one writer is the hint spend of a later lane).
//!
//! Every statement binds the token's user and the puzzle id. No solution reaches this module: the caller checks the
//! answer against the content and passes whether it was correct, so the window is decided before that fact is used.

use crate::db::Repo;
use crate::ids::{PuzzleId, UserId};
use crate::puzzles::{ATTEMPT_WINDOW_MAX, ATTEMPT_WINDOW_SECS};

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
    /// Counts one attempt of `user` on `puzzle` at `now`, then applies `correct` unless the window is full. One READ
    /// COMMITTED transaction: the upsert counts first and holds the (user, puzzle) row lock to the commit, so two
    /// attempts serialize (a first-ever pair's second insert waits on the first, then takes the update path) and the
    /// window count is exact. A window older than [`ATTEMPT_WINDOW_SECS`] restarts at `now` with this attempt.
    /// Past [`ATTEMPT_WINDOW_MAX`] the count commits and `correct` is neither applied nor returned.
    pub async fn record_attempt(
        &self,
        user: UserId,
        puzzle: &PuzzleId,
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

    /// Whether `user` solved `puzzle`.
    pub async fn is_solved(&self, user: UserId, puzzle: &PuzzleId) -> Result<bool, sqlx::Error> {
        sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM puzzle_progress \
             WHERE user_id = $1 AND puzzle_id = $2 AND solved_at IS NOT NULL)",
        )
        .bind(user.0)
        .bind(&puzzle.0)
        .fetch_one(&self.pool)
        .await
    }

    /// The hint tiers of `puzzle` that `user` unlocked, ascending.
    pub async fn unlocked_tiers(
        &self,
        user: UserId,
        puzzle: &PuzzleId,
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
