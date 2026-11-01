//! The `stat_events` table (`0003_stats.sql`): the append-only log of client-reported statistics (STORIES-PLAN Y8).
//! Written only by [`Repo::record_events`], called only from the stats routes (`api/stats.rs`): no unlock, content or
//! grant path reads a statistic (ST4, principle 1).
//!
//! Every statement is autocommit: a statistic is not money, and its budgets are soft by one concurrent batch. The kind
//! and outcome vocabularies live here, next to the rows they name (the `OrderStatus` precedent of `db/orders.rs`).

use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::db::Repo;
use crate::ids::{ChapterId, StoryId, UserId};

/// The rolling window of both budgets, in seconds: a row counts while `received_at > now - STATS_WINDOW_SECS`.
pub const STATS_WINDOW_SECS: i64 = 3600;

/// What an event reports: the `stat_events.kind` values (`stat_events_kind_known`), and their wire form.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum StatKind {
    /// A chapter run began from the chapter's start, never from a resume.
    ChapterStarted,
    /// A chapter ended without a declared ending.
    ChapterCompleted,
    /// A declared ending was entered; the subject is the ending name.
    EndingReached,
    /// A puzzle ended; the subject is the puzzle id, the outcome how it ended.
    PuzzleEnded,
    /// A choice was picked; the subject is the picked option's line ID.
    ChoiceMade,
}

impl StatKind {
    /// The column and wire form; equal to the serde form.
    pub fn as_str(self) -> &'static str {
        match self {
            StatKind::ChapterStarted => "chapter_started",
            StatKind::ChapterCompleted => "chapter_completed",
            StatKind::EndingReached => "ending_reached",
            StatKind::PuzzleEnded => "puzzle_ended",
            StatKind::ChoiceMade => "choice_made",
        }
    }

    /// The kind the column value `s` names.
    pub fn parse(s: &str) -> Option<StatKind> {
        match s {
            "chapter_started" => Some(StatKind::ChapterStarted),
            "chapter_completed" => Some(StatKind::ChapterCompleted),
            "ending_reached" => Some(StatKind::EndingReached),
            "puzzle_ended" => Some(StatKind::PuzzleEnded),
            "choice_made" => Some(StatKind::ChoiceMade),
            _ => None,
        }
    }

    /// Whether the kind counts toward the facts' budget: every kind but `choice_made`, which has a budget of its own.
    pub fn is_fact(self) -> bool {
        !matches!(self, StatKind::ChoiceMade)
    }
}

/// How a puzzle ended: the `stat_events.outcome` values of a `puzzle_ended` (`stat_events_subject_by_kind`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum StatOutcome {
    /// Solved.
    Solved,
    /// Ended unsolved by the puzzle's own rules.
    Failed,
    /// Left by the player.
    Abandoned,
}

impl StatOutcome {
    /// The column and wire form; equal to the serde form.
    pub fn as_str(self) -> &'static str {
        match self {
            StatOutcome::Solved => "solved",
            StatOutcome::Failed => "failed",
            StatOutcome::Abandoned => "abandoned",
        }
    }

    /// The outcome the column value `s` names.
    pub fn parse(s: &str) -> Option<StatOutcome> {
        match s {
            "solved" => Some(StatOutcome::Solved),
            "failed" => Some(StatOutcome::Failed),
            "abandoned" => Some(StatOutcome::Abandoned),
            _ => None,
        }
    }
}

/// An event to record, already judged by the caller against the content and the entitlements.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NewStatEvent<'a> {
    /// The client's event id: a lower-case UUID v4, the idempotency key per user.
    pub event_id: &'a str,
    /// What the event reports.
    pub kind: StatKind,
    /// The story the chapter belongs to, derived by the server.
    pub story: &'a StoryId,
    /// The chapter the event happened in.
    pub chapter: &'a ChapterId,
    /// The ending name, puzzle id or option line ID; `None` for the chapter kinds.
    pub subject: Option<&'a str>,
    /// How a puzzle ended; `None` for every other kind.
    pub outcome: Option<StatOutcome>,
    /// The story version the client ran.
    pub story_version: &'a str,
    /// The event's age when it was sent, in ms (client clock).
    pub age_ms: i64,
}

/// The budgets of one window of [`STATS_WINDOW_SECS`]: fact rows, and `choice_made` rows.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StatCaps {
    /// The most fact rows (every kind but `choice_made`) per window.
    pub facts: i64,
    /// The `choice_made` rows per window past which only first picks are written.
    pub choices: i64,
}

/// What [`Repo::record_events`] did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RecordOutcome {
    /// The batch was judged and written.
    Recorded {
        /// The event ids written by this call, in batch order; an id the user sent before is not among them.
        inserted: Vec<String>,
        /// The choices past the choice budget that were not first picks, in batch order: not written.
        over_budget: Vec<String>,
    },
    /// The batch's facts would take the window past the facts' budget: nothing was written.
    RateLimited,
}

/// One column of the insert's UNNEST: `f` of each event, in order.
fn column<'e, T>(events: &[&NewStatEvent<'e>], f: impl Fn(&NewStatEvent<'e>) -> T) -> Vec<T> {
    events.iter().map(|e| f(e)).collect()
}

impl Repo {
    /// Records `events` of `user`, received at `now`, within the budgets `caps` of the window ending at `now`:
    /// - facts (every kind but `choice_made`): when the window's fact rows plus the batch's facts exceed
    ///   `caps.facts`, nothing is written and the answer is [`RecordOutcome::RateLimited`]. A batch without facts is
    ///   never refused, so no choice volume or fact overshoot turns into a refusal of choices.
    /// - choices: the batch's first `caps.choices` minus the window's choice rows are written, in batch order. Past
    ///   that budget a choice is written only as a first pick (no stored `choice_made` row and no earlier choice of
    ///   this batch with its subject); every other one is returned in `over_budget`.
    ///
    /// At most three autocommit statements: the one count, the first-pick read (only past the choice budget), and one
    /// UNNEST insert that skips an event id the user already sent (`stat_events_event_key`). Two concurrent batches
    /// may both pass the count, so each budget is soft by one batch. An empty `events` makes no statement. The caller
    /// passes distinct event ids.
    pub async fn record_events(
        &self,
        user: UserId,
        events: &[NewStatEvent<'_>],
        now: i64,
        caps: StatCaps,
    ) -> Result<RecordOutcome, sqlx::Error> {
        if events.is_empty() {
            return Ok(RecordOutcome::Recorded {
                inserted: Vec::new(),
                over_budget: Vec::new(),
            });
        }
        let (window_facts, window_choices): (i64, i64) = sqlx::query_as(
            "SELECT count(*) FILTER (WHERE kind <> 'choice_made'), count(*) FILTER (WHERE kind = 'choice_made') \
             FROM stat_events WHERE user_id = $1 AND received_at > $2",
        )
        .bind(user.0)
        .bind(now - STATS_WINDOW_SECS)
        .fetch_one(&self.pool)
        .await?;
        let batch_facts =
            i64::try_from(events.iter().filter(|e| e.kind.is_fact()).count()).unwrap_or(i64::MAX);
        if batch_facts > 0 && window_facts.saturating_add(batch_facts) > caps.facts {
            return Ok(RecordOutcome::RateLimited);
        }
        // A negative remainder (the window already past the budget) takes no choice in order.
        let budget = usize::try_from(caps.choices.saturating_sub(window_choices)).unwrap_or(0);
        let choices = || events.iter().filter(|e| !e.kind.is_fact());
        let stored: HashSet<String> = if choices().count() > budget {
            let subjects: Vec<&str> = choices().skip(budget).filter_map(|e| e.subject).collect();
            sqlx::query_scalar(
                "SELECT DISTINCT subject FROM stat_events \
                 WHERE user_id = $1 AND kind = 'choice_made' AND subject = ANY($2)",
            )
            .bind(user.0)
            .bind(subjects)
            .fetch_all(&self.pool)
            .await?
            .into_iter()
            .collect()
        } else {
            HashSet::new()
        };

        let mut writes: Vec<&NewStatEvent<'_>> = Vec::with_capacity(events.len());
        let mut over_budget = Vec::new();
        let mut earlier: HashSet<Option<&str>> = HashSet::new();
        let mut choices_seen = 0;
        for e in events {
            if e.kind.is_fact() {
                writes.push(e);
                continue;
            }
            let first_pick =
                e.subject.is_some_and(|s| !stored.contains(s)) && !earlier.contains(&e.subject);
            earlier.insert(e.subject);
            choices_seen += 1;
            if choices_seen <= budget || first_pick {
                writes.push(e);
            } else {
                over_budget.push(e.event_id.to_owned());
            }
        }
        if writes.is_empty() {
            return Ok(RecordOutcome::Recorded {
                inserted: Vec::new(),
                over_budget,
            });
        }

        let returned: Vec<String> = sqlx::query_scalar(
            "INSERT INTO stat_events (user_id, event_id, kind, story_id, chapter_id, subject, outcome, story_version, \
             age_ms, received_at) \
             SELECT $1, e.event_id, e.kind, e.story_id, e.chapter_id, e.subject, e.outcome, e.story_version, \
             e.age_ms, $2 \
             FROM UNNEST($3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[], \
             $10::int8[]) AS e (event_id, kind, story_id, chapter_id, subject, outcome, story_version, age_ms) \
             ON CONFLICT ON CONSTRAINT stat_events_event_key DO NOTHING \
             RETURNING event_id",
        )
        .bind(user.0)
        .bind(now)
        .bind(column(&writes, |e| e.event_id))
        .bind(column(&writes, |e| e.kind.as_str()))
        .bind(column(&writes, |e| e.story.0.as_str()))
        .bind(column(&writes, |e| e.chapter.0.as_str()))
        .bind(column(&writes, |e| e.subject))
        .bind(column(&writes, |e| e.outcome.map(StatOutcome::as_str)))
        .bind(column(&writes, |e| e.story_version))
        .bind(column(&writes, |e| e.age_ms))
        .fetch_all(&self.pool)
        .await?;
        let returned: HashSet<String> = returned.into_iter().collect();
        let inserted = writes
            .iter()
            .filter(|e| returned.contains(e.event_id))
            .map(|e| e.event_id.to_owned())
            .collect();
        Ok(RecordOutcome::Recorded {
            inserted,
            over_budget,
        })
    }
}
