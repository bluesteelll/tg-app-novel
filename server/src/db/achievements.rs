//! The `achievement_unlocks` table (`0006_achievements.sql`) and the completion card's reads (META-PLAN M6): display
//! facts only. Called only from the card route (`api/cards.rs`) and, from LF2, a friend's profile (`api/social.rs`):
//! no unlock, content or grant path calls this module (principle 1; pinned by
//! `cards::achievements_repo_called_only_from_cards_api`).
//!
//! The card reads `stat_events` (written by `db/stats.rs`) to show what a user reached, never to grant (ST4), and the
//! puzzle tables for the puzzle conditions. Every statement is autocommit. The one wait is the unlock insert behind a
//! concurrent, uncommitted insert of the same key, bounded by the pool's `lock_timeout`.

use crate::db::Repo;
use crate::db::stats::StatKind;
use crate::ids::{ChapterId, PuzzleId, StoryId, UserId};

/// One group of a user's stat rows of one story, as [`Repo::card_stats`] reads them: a kind, a chapter and a subject,
/// how many rows, and the first one's time. Rows outside the current index are returned too: the caller counts only
/// what the index still holds (ST6).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StatGroup {
    /// `chapter_completed`, `ending_reached` or `choice_made`.
    pub kind: StatKind,
    /// The chapter the rows were recorded in.
    pub chapter: ChapterId,
    /// The ending name or the option's line ID; `None` for `chapter_completed`.
    pub subject: Option<String>,
    /// The rows of the group: every reach of one ending counts.
    pub rows: i64,
    /// The earliest row's `received_at` (server clock).
    pub first_at: i64,
}

/// What the server holds of one puzzle of a user, as [`Repo::card_puzzles`] reads it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PuzzleRow {
    /// The puzzle.
    pub puzzle: PuzzleId,
    /// `solved_at` is set.
    pub solved: bool,
    /// The hint tiers unlocked.
    pub hints: i64,
}

/// A reached ending of a user, as [`Repo::endings_by_story`] reads it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EndingRow {
    /// The story the row was recorded under.
    pub story: StoryId,
    /// The chapter it was recorded in.
    pub chapter: ChapterId,
    /// The ending name.
    pub name: String,
}

/// A stored unlock.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnlockRow {
    /// The story.
    pub story: StoryId,
    /// The achievement id.
    pub achievement: String,
    /// When the card that first met it was requested (server clock).
    pub unlocked_at: i64,
}

impl Repo {
    /// The card's facts of `user` in `story` from `stat_events`: one grouped read over `stat_events_by_user_story` of
    /// the three kinds the conditions use, per (kind, chapter, subject) with its row count and first time.
    pub async fn card_stats(
        &self,
        user: UserId,
        story: &StoryId,
    ) -> Result<Vec<StatGroup>, sqlx::Error> {
        let rows: Vec<(String, String, Option<String>, i64, i64)> = sqlx::query_as(
            "SELECT kind, chapter_id, subject, count(*), min(received_at) FROM stat_events \
             WHERE user_id = $1 AND story_id = $2 \
             AND kind IN ('chapter_completed', 'ending_reached', 'choice_made') \
             GROUP BY kind, chapter_id, subject",
        )
        .bind(user.0)
        .bind(&story.0)
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter()
            .map(|(kind, chapter, subject, rows, first_at)| {
                // `stat_events_kind_known` makes the error unreachable; a 500 beats a panic if the schema ever drifts.
                let kind = StatKind::parse(&kind).ok_or_else(|| {
                    sqlx::Error::Decode("stat_events.kind outside the vocabulary".into())
                })?;
                Ok(StatGroup {
                    kind,
                    chapter: ChapterId(chapter),
                    subject,
                    rows,
                    first_at,
                })
            })
            .collect()
    }

    /// The facts of `user`'s puzzles among `puzzles`: one read of `puzzle_progress` (a puzzle without a row has no
    /// fact) with the count of its `hint_unlocks` rows, both on their primary keys.
    pub async fn card_puzzles(
        &self,
        user: UserId,
        puzzles: &[PuzzleId],
    ) -> Result<Vec<PuzzleRow>, sqlx::Error> {
        let ids: Vec<&str> = puzzles.iter().map(|p| p.0.as_str()).collect();
        let rows: Vec<(String, bool, i64)> = sqlx::query_as(
            "SELECT p.puzzle_id, p.solved_at IS NOT NULL, count(h.tier) FROM puzzle_progress p \
             LEFT JOIN hint_unlocks h ON h.user_id = p.user_id AND h.puzzle_id = p.puzzle_id \
             WHERE p.user_id = $1 AND p.puzzle_id = ANY($2) \
             GROUP BY p.puzzle_id, p.solved_at",
        )
        .bind(user.0)
        .bind(ids)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|(puzzle, solved, hints)| PuzzleRow {
                puzzle: PuzzleId(puzzle),
                solved,
                hints,
            })
            .collect())
    }

    /// Stores the unlocks `ids` of `user` in `story` at `now`, once each: one UNNEST insert that skips a stored key
    /// (`achievement_unlocks_pkey`) and returns the ids this call stored. A key another transaction inserted and has
    /// not committed makes the statement wait for it (`lock_timeout` bounds the wait), then skip it if it committed.
    /// Callers pass `ids` in one order (the meta order), so two concurrent calls take the key locks in one order.
    pub async fn record_unlocks(
        &self,
        user: UserId,
        story: &StoryId,
        ids: &[&str],
        now: i64,
    ) -> Result<Vec<String>, sqlx::Error> {
        sqlx::query_scalar(
            "INSERT INTO achievement_unlocks (user_id, story_id, achievement_id, unlocked_at) \
             SELECT $1, $2, a.id, $4 FROM UNNEST($3::text[]) AS a (id) \
             ON CONFLICT ON CONSTRAINT achievement_unlocks_pkey DO NOTHING \
             RETURNING achievement_id",
        )
        .bind(user.0)
        .bind(&story.0)
        .bind(ids)
        .bind(now)
        .fetch_all(&self.pool)
        .await
    }

    /// The stored unlocks of `user` in `story`, on the primary key's prefix. Called after [`Repo::record_unlocks`],
    /// it takes a fresh snapshot (READ COMMITTED), so a key another request stored first shows with that request's
    /// time.
    pub async fn story_unlocks(
        &self,
        user: UserId,
        story: &StoryId,
    ) -> Result<Vec<UnlockRow>, sqlx::Error> {
        let rows: Vec<(String, String, i64)> = sqlx::query_as(
            "SELECT story_id, achievement_id, unlocked_at FROM achievement_unlocks \
             WHERE user_id = $1 AND story_id = $2",
        )
        .bind(user.0)
        .bind(&story.0)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(unlock_row).collect())
    }

    /// Every distinct reached ending of `user`, all stories, in (story, chapter, name) order: one statement over
    /// `stat_events_by_user_story`. Raw: the caller keeps what the current index holds and what the viewer may see.
    pub async fn endings_by_story(&self, user: UserId) -> Result<Vec<EndingRow>, sqlx::Error> {
        let rows: Vec<(String, String, String)> = sqlx::query_as(
            "SELECT DISTINCT story_id, chapter_id, subject FROM stat_events \
             WHERE user_id = $1 AND kind = 'ending_reached' \
             ORDER BY story_id, chapter_id, subject",
        )
        .bind(user.0)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|(story, chapter, name)| EndingRow {
                story: StoryId(story),
                chapter: ChapterId(chapter),
                name,
            })
            .collect())
    }

    /// Every stored unlock of `user`, all stories, in (story, achievement) order: one statement on the primary key's
    /// prefix. Raw: the caller keeps what the current meta holds and what the viewer may see.
    pub async fn unlocks_by_story(&self, user: UserId) -> Result<Vec<UnlockRow>, sqlx::Error> {
        let rows: Vec<(String, String, i64)> = sqlx::query_as(
            "SELECT story_id, achievement_id, unlocked_at FROM achievement_unlocks \
             WHERE user_id = $1 ORDER BY story_id, achievement_id",
        )
        .bind(user.0)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(unlock_row).collect())
    }
}

fn unlock_row((story, achievement, unlocked_at): (String, String, i64)) -> UnlockRow {
    UnlockRow {
        story: StoryId(story),
        achievement,
        unlocked_at,
    }
}
