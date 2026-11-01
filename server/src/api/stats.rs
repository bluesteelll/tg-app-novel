//! `/api/stats`: the statistics routes (STORIES-PLAN Y10-Y12, META-PLAN M1, M8).
//!
//! Writes: every event is a claim. Its shape is checked first: a malformed event refuses the whole batch with 400
//! before any write, so no table CHECK ever answers with a 500. Then [`classify`] judges each event against the story
//! index, the puzzle index and the caller's entitlements in a fixed order: the chapter, the entitlement, the subject.
//! A non-buyer gets `not_entitled` before any subject is looked at, so no answer names a paid ending, puzzle or option.
//! The story is derived here, never sent.
//!
//! Reads: the user's distinct facts, counted only where the current index still holds them (ST6).
//!
//! Statistics unlock nothing (ST4): these handlers are the only callers of the `db/stats.rs` repository.

use std::collections::HashSet;

use axum::Json;
use axum::extract::State;
use axum::extract::rejection::JsonRejection;
use axum::http::HeaderValue;
use axum::http::header::{CACHE_CONTROL, HeaderName};
use axum::response::{IntoResponse, Response};

use crate::AppState;
use crate::api::body_rejection;
use crate::api::dto::{
    GameStatsDto, PostStatsRequest, PostStatsResponse, RejectedEvent, StatEventDto,
    StatRejectReason, StatsResponse, StoryStatsDto,
};
use crate::auth::AuthUser;
use crate::content::{ContentStore, StoryChapter, StoryDef};
use crate::db::stats::{NewStatEvent, RecordOutcome, StatCaps, StatFact, StatKind};
use crate::error::ApiError;
use crate::ids::{ChapterId, ProductId, PuzzleId, is_local_id};

/// The most events in one batch.
pub const STATS_BATCH_MAX: usize = 32;

/// The most fact rows (every kind but `choice_made`) per user per rolling hour: past it a batch with facts is a 429.
pub const STATS_HOURLY_CAP: i64 = 600;

/// The `choice_made` rows per user per rolling hour past which only the first pick of an option is recorded.
pub const STATS_CHOICE_HOURLY_CAP: i64 = 600;

/// The `Retry-After` of a 429, in seconds.
pub const STATS_RETRY_AFTER_SECS: i64 = 600;

/// The oldest event accepted: 30 days, in ms (`stat_events_age_bounded`).
pub const STATS_AGE_MS_MAX: i64 = 2_592_000_000;

/// The headers of a 200: one user's own statistics, which no shared cache stores.
fn private_headers() -> [(HeaderName, HeaderValue); 1] {
    [(CACHE_CONTROL, HeaderValue::from_static("private, no-store"))]
}

/// A count of at most one batch, as the response's `u32`.
fn count(n: usize) -> u32 {
    u32::try_from(n).unwrap_or(u32::MAX)
}

/// `POST /api/stats/events`: records a batch of events. The checks run in a fixed order: token, body, count, each
/// event's shape, in-batch duplicates, then per event the chapter, the entitlement and the subject, then the budgets.
/// No 4xx writes anything, a 429 writes nothing either, and a 200 answers every event: recorded, a duplicate, or
/// rejected.
pub async fn post_events(
    State(st): State<AppState>,
    AuthUser(user): AuthUser,
    req: Result<Json<PostStatsRequest>, JsonRejection>,
) -> Result<Response, ApiError> {
    let Json(req) = req.map_err(body_rejection)?;
    if !(1..=STATS_BATCH_MAX).contains(&req.events.len()) {
        return Err(ApiError::BadRequest("a batch holds 1 to 32 events"));
    }
    for e in &req.events {
        check_event(e).map_err(ApiError::BadRequest)?;
    }
    // A repeated id is a duplicate of its first occurrence and never reaches SQL.
    let mut ids = HashSet::new();
    let unique: Vec<&StatEventDto> = req
        .events
        .iter()
        .filter(|e| ids.insert(e.event_id.as_str()))
        .collect();
    let repeats = req.events.len() - unique.len();
    // One entitlement read, made only when the batch names a paid chapter of the index.
    let names_paid = unique.iter().any(|e| {
        story_chapter(&st.content, &e.chapter_id).is_some_and(|(_, ch)| ch.product.is_some())
    });
    let owned: HashSet<ProductId> = if names_paid {
        st.repo.entitlements(user).await?.into_iter().collect()
    } else {
        HashSet::new()
    };
    let judged: Vec<(&StatEventDto, Result<NewStatEvent<'_>, StatRejectReason>)> = unique
        .iter()
        .map(|&e| (e, classify(&st.content, &owned, e)))
        .collect();
    let accepted: Vec<NewStatEvent<'_>> = judged
        .iter()
        .filter_map(|(_, verdict)| verdict.as_ref().ok().copied())
        .collect();
    let caps = StatCaps {
        facts: STATS_HOURLY_CAP,
        choices: STATS_CHOICE_HOURLY_CAP,
    };
    let (inserted, over_budget) = match st
        .repo
        .record_events(user, &accepted, st.clock.now(), caps)
        .await?
    {
        RecordOutcome::Recorded {
            inserted,
            over_budget,
        } => (inserted, over_budget),
        RecordOutcome::RateLimited => {
            return Err(ApiError::RateLimited {
                retry_after_secs: STATS_RETRY_AFTER_SECS,
            });
        }
    };
    let over: HashSet<&str> = over_budget.iter().map(String::as_str).collect();
    let rejected = judged
        .iter()
        .filter_map(|(e, verdict)| {
            let reason = match verdict {
                Err(reason) => *reason,
                Ok(_) if over.contains(e.event_id.as_str()) => StatRejectReason::RateLimited,
                Ok(_) => return None,
            };
            Some(RejectedEvent {
                event_id: e.event_id.clone(),
                reason,
            })
        })
        .collect();
    // Written but not inserted: the user sent that id before.
    let resent = accepted
        .len()
        .saturating_sub(over_budget.len())
        .saturating_sub(inserted.len());
    let body = PostStatsResponse {
        recorded: count(inserted.len()),
        duplicates: count(repeats + resent),
        rejected,
    };
    Ok((private_headers(), Json(body)).into_response())
}

/// `GET /api/stats`: the user's statistics per story of the index and for the game (STORIES-PLAN F12), from one read
/// of the user's distinct facts. No ending total at either level (META-PLAN M8). The 200 is `private, no-store`.
pub async fn get_stats(
    State(st): State<AppState>,
    AuthUser(user): AuthUser,
) -> Result<Response, ApiError> {
    let facts = st.repo.stat_facts(user).await?;
    Ok((private_headers(), Json(stats_of(&st.content, &facts))).into_response())
}

/// The statistics `facts` give over the index of `content`: every story in index order, then the game's sums.
fn stats_of(content: &ContentStore, facts: &[StatFact]) -> StatsResponse {
    let stories: Vec<StoryStatsDto> = content
        .stories()
        .iter()
        .map(|story| story_stats(story, facts))
        .collect();
    let game = GameStatsDto {
        stories_started: count(stories.iter().filter(|s| s.started).count()),
        stories_total: count(stories.len()),
        endings_reached: count(stories.iter().map(|s| s.endings_reached.len()).sum()),
    };
    StatsResponse { stories, game }
}

/// One story's statistics. A fact counts only while the index holds it: recorded under this story, in a chapter the
/// story still has, and for an ending one the story still declares (ST6). A reached ending also completes its chapter:
/// a declared ending ends the chapter without a `chapter_completed` (STORIES-PLAN F4').
fn story_stats(story: &StoryDef, facts: &[StatFact]) -> StoryStatsDto {
    let held: Vec<&StatFact> = facts
        .iter()
        .filter(|f| f.story == story.id && story.chapters.iter().any(|ch| ch.id == f.chapter))
        .collect();
    let ending = |f: &StatFact| {
        f.kind == StatKind::EndingReached
            && f.subject
                .as_deref()
                .is_some_and(|name| story.endings.contains_key(name))
    };
    let chapters_completed = story
        .chapters
        .iter()
        .filter(|ch| {
            held.iter()
                .any(|f| f.chapter == ch.id && (f.kind == StatKind::ChapterCompleted || ending(f)))
        })
        .map(|ch| ch.id.0.clone())
        .collect();
    let reached: HashSet<&str> = held
        .iter()
        .filter(|f| ending(f))
        .filter_map(|f| f.subject.as_deref())
        .collect();
    let endings_reached = story
        .endings
        .keys()
        .filter(|name| reached.contains(name.as_str()))
        .cloned()
        .collect();
    StoryStatsDto {
        story_id: story.id.clone(),
        started: held.iter().any(|f| f.kind == StatKind::ChapterStarted),
        chapters_completed,
        chapters_total: count(story.chapters.len()),
        endings_reached,
    }
}

/// The shape of one event as the table's CHECKs judge it (`0003_stats.sql`), with the reason for the log: the id, the
/// chapter, the story version, the age, and the subject and outcome each kind carries.
fn check_event(e: &StatEventDto) -> Result<(), &'static str> {
    if !is_event_id(&e.event_id) {
        return Err("eventId is not a lower-case UUID v4");
    }
    if ChapterId::parse(&e.chapter_id).is_none() {
        return Err("chapterId outside the grammar");
    }
    if !is_story_version(&e.story_version) {
        return Err("storyVersion is not 16 lower-case hex characters");
    }
    if !(0..=STATS_AGE_MS_MAX).contains(&e.age_ms) {
        return Err("ageMs outside 0 to 30 days");
    }
    let subject = e.subject.as_deref();
    let fits = match e.kind {
        StatKind::ChapterStarted | StatKind::ChapterCompleted => {
            subject.is_none() && e.outcome.is_none()
        }
        StatKind::EndingReached => subject.is_some_and(is_ending_name) && e.outcome.is_none(),
        StatKind::PuzzleEnded => {
            subject.is_some_and(|s| PuzzleId::parse(s).is_some()) && e.outcome.is_some()
        }
        StatKind::ChoiceMade => subject.is_some_and(is_line_id) && e.outcome.is_none(),
    };
    if fits {
        Ok(())
    } else {
        Err("subject or outcome does not fit the kind")
    }
}

/// `^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$` (`stat_events_event_id_shape`): what
/// `crypto.randomUUID` returns.
fn is_event_id(s: &str) -> bool {
    let bytes = s.as_bytes();
    bytes.len() == 36
        && bytes.iter().enumerate().all(|(at, &b)| match at {
            8 | 13 | 18 | 23 => b == b'-',
            14 => b == b'4',
            19 => matches!(b, b'8' | b'9' | b'a' | b'b'),
            _ => matches!(b, b'0'..=b'9' | b'a'..=b'f'),
        })
}

/// `^[0-9a-f]{16}$` (`stat_events_story_version_shape`): the rule `content.rs` applies to `meta.json`.
fn is_story_version(s: &str) -> bool {
    s.len() == 16 && s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

/// `^[a-z][a-z0-9_]{0,31}$` (STORIES-PLAN `EndingName`): the rule `content.rs` applies to `stories.json`.
fn is_ending_name(s: &str) -> bool {
    s.len() <= 32 && is_local_id(s)
}

/// A line ID, `^ch[1-9][0-9]*\.[a-z][a-z0-9_]*\.[0-9a-z]{4}$` (STAGING-DSL §4): the owning chapter, the knot part
/// and a four-character suffix.
fn is_line_id(s: &str) -> bool {
    let mut parts = s.split('.');
    let (Some(chapter), Some(knot), Some(suffix), None) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return false;
    };
    ChapterId::parse(chapter).is_some()
        && is_local_id(knot)
        && suffix.len() == 4
        && suffix
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
}

/// The story of the index and its chapter that `chapter_id` names.
fn story_chapter<'a>(
    content: &'a ContentStore,
    chapter_id: &str,
) -> Option<(&'a StoryDef, &'a StoryChapter)> {
    let id = ChapterId::parse(chapter_id)?;
    let story = content.story_of(&id)?;
    let chapter = story.chapters.iter().find(|ch| ch.id == id)?;
    Some((story, chapter))
}

/// Judges one well-formed event against `content` and the products `owned`, in a fixed order: the chapter is in the
/// index (`unknown_chapter`), a paid chapter's product is owned (`not_entitled`), then the subject belongs to that
/// chapter (`unknown_ending`, `unknown_puzzle`, `unknown_choice`). Pure. The story is derived from the index, and the
/// returned event borrows its story and chapter ids from `content`.
pub(crate) fn classify<'a>(
    content: &'a ContentStore,
    owned: &HashSet<ProductId>,
    e: &'a StatEventDto,
) -> Result<NewStatEvent<'a>, StatRejectReason> {
    let (story, chapter) =
        story_chapter(content, &e.chapter_id).ok_or(StatRejectReason::UnknownChapter)?;
    if let Some(product) = &chapter.product
        && !owned.contains(product)
    {
        return Err(StatRejectReason::NotEntitled);
    }
    let subject = e.subject.as_deref();
    match e.kind {
        StatKind::ChapterStarted | StatKind::ChapterCompleted => {}
        StatKind::EndingReached => {
            // By chapter, not by name alone: a free chapter never confirms the name of an ending of a paid one.
            if subject.and_then(|name| story.endings.get(name)) != Some(&chapter.id) {
                return Err(StatRejectReason::UnknownEnding);
            }
        }
        StatKind::PuzzleEnded => {
            let def = subject
                .and_then(PuzzleId::parse)
                .and_then(|id| content.puzzle(&id));
            if !def.is_some_and(|def| def.chapter == chapter.id) {
                return Err(StatRejectReason::UnknownPuzzle);
            }
        }
        StatKind::ChoiceMade => {
            // The line ID's chapter part (`stat_events_choice_in_chapter`); LM2 adds the chapter's option vocabulary.
            if subject.and_then(|option| option.split('.').next()) != Some(chapter.id.0.as_str()) {
                return Err(StatRejectReason::UnknownChoice);
            }
        }
    }
    Ok(NewStatEvent {
        event_id: &e.event_id,
        kind: e.kind,
        story: &story.id,
        chapter: &chapter.id,
        subject,
        outcome: e.outcome,
        story_version: &e.story_version,
        age_ms: e.age_ms,
    })
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::*;
    use crate::db::stats::StatOutcome;

    fn dto(kind: StatKind, chapter: &str, subject: Option<&str>) -> StatEventDto {
        StatEventDto {
            event_id: "00000001-0000-4000-8000-000000000001".to_owned(),
            kind,
            chapter_id: chapter.to_owned(),
            story_version: "0123456789abcdef".to_owned(),
            subject: subject.map(str::to_owned),
            outcome: (kind == StatKind::PuzzleEnded).then_some(StatOutcome::Solved),
            age_ms: 0,
        }
    }

    /// A case of [`classify_order`]: its name, the products owned, the event, and the verdict as (story, chapter).
    type Case<'a> = (
        &'a str,
        &'a HashSet<ProductId>,
        StatEventDto,
        Result<(&'a str, &'a str), StatRejectReason>,
    );

    /// Every reason, and the order chapter, entitlement, subject, on the test fixture's index: manor ch1 free, ch2
    /// paid (endings truth and ashes in ch2, puzzles ch1.drawer and ch2.cabinet); tide ch3 free, ch4 paid (drowned in
    /// ch3, dawn in ch4). An accepted event names the story the index derives.
    #[tokio::test]
    async fn classify_order() {
        use StatKind::{ChapterStarted, ChoiceMade, EndingReached, PuzzleEnded};
        use StatRejectReason::{
            NotEntitled, UnknownChapter, UnknownChoice, UnknownEnding, UnknownPuzzle,
        };
        let dir = Path::new(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/content"
        ));
        let content = match ContentStore::load(dir).await {
            Ok(content) => content,
            Err(e) => panic!("the fixture content: {e}"),
        };
        let none = HashSet::new();
        let ch4: HashSet<ProductId> = [ProductId("chapter:ch4".to_owned())].into();
        let cases: [Case<'_>; 17] = [
            (
                "unknown ch9, before its subject",
                &ch4,
                dto(EndingReached, "ch9", Some("nope")),
                Err(UnknownChapter),
            ),
            (
                "ch4 unowned: an invented ending",
                &none,
                dto(EndingReached, "ch4", Some("nope")),
                Err(NotEntitled),
            ),
            (
                "ch4 unowned: its real ending",
                &none,
                dto(EndingReached, "ch4", Some("dawn")),
                Err(NotEntitled),
            ),
            (
                "ch4 unowned: another chapter's puzzle",
                &none,
                dto(PuzzleEnded, "ch4", Some("ch1.drawer")),
                Err(NotEntitled),
            ),
            (
                "ch4 unowned: another chapter's option",
                &none,
                dto(ChoiceMade, "ch4", Some("ch1.hall.a1b2")),
                Err(NotEntitled),
            ),
            (
                "ch2 unowned: started",
                &ch4,
                dto(ChapterStarted, "ch2", None),
                Err(NotEntitled),
            ),
            (
                "ch4 owned: an invented ending",
                &ch4,
                dto(EndingReached, "ch4", Some("nope")),
                Err(UnknownEnding),
            ),
            (
                "ch4 owned: dawn",
                &ch4,
                dto(EndingReached, "ch4", Some("dawn")),
                Ok(("tide", "ch4")),
            ),
            (
                "ch3: dawn, an ending of ch4",
                &none,
                dto(EndingReached, "ch3", Some("dawn")),
                Err(UnknownEnding),
            ),
            (
                "ch3: drowned",
                &none,
                dto(EndingReached, "ch3", Some("drowned")),
                Ok(("tide", "ch3")),
            ),
            (
                "ch1: ch2.cabinet, a puzzle of ch2",
                &none,
                dto(PuzzleEnded, "ch1", Some("ch2.cabinet")),
                Err(UnknownPuzzle),
            ),
            (
                "ch3: ch3.nothing, no puzzle",
                &none,
                dto(PuzzleEnded, "ch3", Some("ch3.nothing")),
                Err(UnknownPuzzle),
            ),
            (
                "ch1: ch1.drawer",
                &none,
                dto(PuzzleEnded, "ch1", Some("ch1.drawer")),
                Ok(("manor", "ch1")),
            ),
            (
                "ch3: an option of ch1",
                &none,
                dto(ChoiceMade, "ch3", Some("ch1.hall.a1b2")),
                Err(UnknownChoice),
            ),
            (
                "ch3: an option of ch3",
                &none,
                dto(ChoiceMade, "ch3", Some("ch3.shore.s001")),
                Ok(("tide", "ch3")),
            ),
            (
                "ch4 owned: an option of ch4",
                &ch4,
                dto(ChoiceMade, "ch4", Some("ch4.lamp.ab12")),
                Ok(("tide", "ch4")),
            ),
            (
                "ch1: started",
                &none,
                dto(ChapterStarted, "ch1", None),
                Ok(("manor", "ch1")),
            ),
        ];
        let mut failures = Vec::new();
        for (case, owned, e, want) in &cases {
            let got = classify(&content, owned, e)
                .map(|accepted| (accepted.story.0.as_str(), accepted.chapter.0.as_str()));
            if got != *want {
                failures.push(format!("{case}: expected {want:?}, got {got:?}"));
            }
        }
        assert!(
            failures.is_empty(),
            "{} failures:\n{}",
            failures.len(),
            failures.join("\n")
        );
    }
}
