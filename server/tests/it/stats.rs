//! Statistics (`server/migrations/0003_stats.sql`, `db/stats.rs`, `api/stats.rs`): the `stat_events` constraints on
//! raw SQL, the repository's idempotent, budgeted write, `POST /api/stats/events`, where every event is a claim
//! judged against the story index, the puzzle index and the caller's entitlements, and `GET /api/stats`, the distinct
//! facts the current index still holds. Statistics unlock nothing (ST4).
//!
//! Every refused schema case breaks one CHECK, or one whose name sorts before every other it breaks: PostgreSQL tests
//! a table's CHECK constraints in name order, so the constraint a case reports is the one the case is about.
//!
//! Large seeds are raw `generate_series` inserts (`gen_random_uuid` is a lower-case v4): only their count and time
//! matter to the budgets. Entitlement rows are raw too (`catalog::own`): the server has no grant path but the payment.
//! Rows that `classify` would refuse are written through `Repo::record_events`.

use std::path::{Path, PathBuf};

use axum::body::Body;
use axum::http::Request;
use axum::http::header::{AUTHORIZATION, CACHE_CONTROL, CONTENT_TYPE, RETRY_AFTER};
use serde_json::{Value, json};
use server::AppState;
use server::api::dto::{GameStatsDto, StoryStatsDto};
use server::db::stats::{NewStatEvent, RecordOutcome, StatCaps, StatKind, StatOutcome};
use server::ids::{ChapterId, StoryId, UserId};
use sqlx::postgres::PgQueryResult;
use sqlx::{Connection, PgConnection};
use ts_rs::TS;

use crate::catalog::{ANN, T0, bearer, get, own, state_with_users};
use crate::common;

/// A second player.
const BEN: i64 = 1002;

/// A `storyVersion` of the right shape.
const VERSION: &str = "0123456789abcdef";

type Res = Result<PgQueryResult, sqlx::Error>;

fn report(failures: &[String]) {
    assert!(
        failures.is_empty(),
        "{} failures:\n{}",
        failures.len(),
        failures.join("\n")
    );
}

/// A database error as `(SQLSTATE, constraint) message`; any other error as its text.
fn describe(e: &sqlx::Error) -> String {
    match e {
        sqlx::Error::Database(db) => format!(
            "({}, {}) {db}",
            db.code().as_deref().unwrap_or("no code"),
            db.constraint().unwrap_or("no constraint")
        ),
        other => other.to_string(),
    }
}

/// `Ok` when `res` is a database error with SQLSTATE `want.0` on the constraint named `want.1`. Never the message
/// text alone: the server's locale decides it.
fn expect_err(case: &str, res: Res, want: (&str, &str)) -> Result<(), String> {
    let (code, constraint) = want;
    match res {
        Err(sqlx::Error::Database(e))
            if e.code().as_deref() == Some(code) && e.constraint() == Some(constraint) =>
        {
            Ok(())
        }
        Err(e) => Err(format!(
            "case {case}: expected ({code}, {constraint}), got {}",
            describe(&e)
        )),
        Ok(_) => Err(format!(
            "case {case}: expected ({code}, {constraint}), got Ok"
        )),
    }
}

fn expect_ok(case: &str, res: Res) -> Result<(), String> {
    res.map(|_| ())
        .map_err(|e| format!("case {case} (control): expected Ok, got {}", describe(&e)))
}

/// The `n`-th lower-case UUID v4 of these tests.
fn uuid(n: u64) -> String {
    format!("{n:08x}-0000-4000-8000-{n:012x}")
}

/// A `stat_events` row; [`row`] is a valid one for every case to change.
struct Row<'a> {
    user: i64,
    event_id: String,
    kind: &'a str,
    story: &'a str,
    chapter: &'a str,
    subject: Option<&'a str>,
    outcome: Option<&'a str>,
    story_version: &'a str,
    age_ms: i64,
    received_at: i64,
}

/// A `chapter_started` of tide's ch3 by `user`, event id `uuid(n)`.
fn row<'a>(user: i64, n: u64) -> Row<'a> {
    Row {
        user,
        event_id: uuid(n),
        kind: "chapter_started",
        story: "tide",
        chapter: "ch3",
        subject: None,
        outcome: None,
        story_version: VERSION,
        age_ms: 0,
        received_at: T0,
    }
}

async fn insert_row(c: &mut PgConnection, r: Row<'_>) -> Res {
    sqlx::query(
        "INSERT INTO stat_events (user_id, event_id, kind, story_id, chapter_id, subject, outcome, story_version, \
         age_ms, received_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
    )
    .bind(r.user)
    .bind(&r.event_id)
    .bind(r.kind)
    .bind(r.story)
    .bind(r.chapter)
    .bind(r.subject)
    .bind(r.outcome)
    .bind(r.story_version)
    .bind(r.age_ms)
    .bind(r.received_at)
    .execute(&mut *c)
    .await
}

/// A migrated database with the `users` rows of ANN and BEN, and a raw connection to it.
async fn schema_db() -> (server::AppState, common::TestDb, PgConnection) {
    let (st, db) = state_with_users(&[ANN, BEN]).await;
    let c = common::raw_db(&st).await;
    (st, db, c)
}

/// One row per (user, client event id): a resent event is refused; another user's equal id is not. The user must
/// exist.
#[tokio::test]
async fn schema_stat_events_event_key() {
    let (_st, _db, mut c) = schema_db().await;
    let results = [
        expect_ok("ANN event 1", insert_row(&mut c, row(ANN, 1)).await),
        expect_err(
            "ANN event 1 again",
            insert_row(&mut c, row(ANN, 1)).await,
            ("23505", "stat_events_event_key"),
        ),
        expect_ok("BEN event 1", insert_row(&mut c, row(BEN, 1)).await),
        expect_err(
            "no such user",
            insert_row(&mut c, row(4242, 2)).await,
            ("23503", "stat_events_user_fk"),
        ),
    ];
    let failures: Vec<String> = results.into_iter().filter_map(Result::err).collect();
    report(&failures);
}

/// Each kind carries exactly its subject and outcome, a NULL included: a CHECK passes on NULL, so a missing subject
/// or outcome is refused only by the constraint's own `IS NOT NULL`. The kind vocabulary is closed.
#[tokio::test]
async fn schema_stat_events_subject_by_kind() {
    let (_st, _db, mut c) = schema_db().await;
    let by_kind = ("23514", "stat_events_subject_by_kind");
    let mut results = Vec::new();
    let refused: [(&str, Row<'_>); 9] = [
        (
            "ending_reached without subject",
            Row {
                kind: "ending_reached",
                ..row(ANN, 1)
            },
        ),
        (
            "chapter_started with a subject",
            Row {
                subject: Some("drowned"),
                ..row(ANN, 2)
            },
        ),
        (
            "chapter_completed with an outcome",
            Row {
                kind: "chapter_completed",
                outcome: Some("solved"),
                ..row(ANN, 3)
            },
        ),
        (
            "puzzle_ended without outcome",
            Row {
                kind: "puzzle_ended",
                story: "manor",
                chapter: "ch1",
                subject: Some("ch1.drawer"),
                ..row(ANN, 4)
            },
        ),
        (
            "puzzle_ended with outcome won",
            Row {
                kind: "puzzle_ended",
                story: "manor",
                chapter: "ch1",
                subject: Some("ch1.drawer"),
                outcome: Some("won"),
                ..row(ANN, 5)
            },
        ),
        (
            "ending_reached subject Bad",
            Row {
                kind: "ending_reached",
                subject: Some("Bad"),
                ..row(ANN, 6)
            },
        ),
        (
            "choice_made with an outcome",
            Row {
                kind: "choice_made",
                subject: Some("ch3.shore.s001"),
                outcome: Some("solved"),
                ..row(ANN, 7)
            },
        ),
        (
            "choice_made subject ch3.shore",
            Row {
                kind: "choice_made",
                subject: Some("ch3.shore"),
                ..row(ANN, 8)
            },
        ),
        (
            "choice_made without subject",
            Row {
                kind: "choice_made",
                ..row(ANN, 9)
            },
        ),
    ];
    for (case, r) in refused {
        results.push(expect_err(case, insert_row(&mut c, r).await, by_kind));
    }
    results.push(expect_err(
        "unknown kind choice",
        insert_row(
            &mut c,
            Row {
                kind: "choice",
                ..row(ANN, 10)
            },
        )
        .await,
        ("23514", "stat_events_kind_known"),
    ));
    let accepted: [(&str, Row<'_>); 5] = [
        ("chapter_started", row(ANN, 11)),
        (
            "chapter_completed",
            Row {
                kind: "chapter_completed",
                ..row(ANN, 12)
            },
        ),
        (
            "ending_reached drowned",
            Row {
                kind: "ending_reached",
                subject: Some("drowned"),
                ..row(ANN, 13)
            },
        ),
        (
            "puzzle_ended ch1.drawer abandoned",
            Row {
                kind: "puzzle_ended",
                story: "manor",
                chapter: "ch1",
                subject: Some("ch1.drawer"),
                outcome: Some("abandoned"),
                ..row(ANN, 14)
            },
        ),
        (
            "choice_made ch3.shore.s001",
            Row {
                kind: "choice_made",
                subject: Some("ch3.shore.s001"),
                ..row(ANN, 15)
            },
        ),
    ];
    for (case, r) in accepted {
        results.push(expect_ok(case, insert_row(&mut c, r).await));
    }
    let failures: Vec<String> = results.into_iter().filter_map(Result::err).collect();
    report(&failures);
}

/// The event id is a lower-case UUID v4 (`crypto.randomUUID`): version nibble 4, variant 8-b, dashes.
#[tokio::test]
async fn schema_stat_events_event_id_shape() {
    let (_st, _db, mut c) = schema_db().await;
    let shape = ("23514", "stat_events_event_id_shape");
    let mut results = Vec::new();
    for (case, id) in [
        ("upper-case v4", "0000000A-0000-4000-8000-00000000000A"),
        ("v1", "00000001-0000-1000-8000-000000000001"),
        ("variant c", "00000001-0000-4000-c000-000000000001"),
        ("no dashes", "00000001000040008000000000000001"),
    ] {
        let r = Row {
            event_id: id.to_owned(),
            ..row(ANN, 0)
        };
        results.push(expect_err(case, insert_row(&mut c, r).await, shape));
    }
    results.push(expect_ok(
        "lower-case v4",
        insert_row(
            &mut c,
            Row {
                event_id: "0f1e2d3c-4b5a-4987-a8b9-cadbecfd0e1f".to_owned(),
                ..row(ANN, 99)
            },
        )
        .await,
    ));
    let failures: Vec<String> = results.into_iter().filter_map(Result::err).collect();
    report(&failures);
}

/// The story, chapter and story-version grammars (the `StoryId`, `ChapterId` and `storyVersion` rules).
#[tokio::test]
async fn schema_stat_events_story_id_shape() {
    let (_st, _db, mut c) = schema_db().await;
    let too_long = format!("t{}", "i".repeat(24));
    let longest = format!("t{}", "i".repeat(23));
    let story_shape = ("23514", "stat_events_story_id_shape");
    let chapter_shape = ("23514", "stat_events_chapter_id_shape");
    let version_shape = ("23514", "stat_events_story_version_shape");
    let refused: [(&str, Row<'_>, (&str, &str)); 6] = [
        (
            "story Tide",
            Row {
                story: "Tide",
                ..row(ANN, 1)
            },
            story_shape,
        ),
        (
            "story 1tide",
            Row {
                story: "1tide",
                ..row(ANN, 2)
            },
            story_shape,
        ),
        (
            "story of 25 chars",
            Row {
                story: &too_long,
                ..row(ANN, 3)
            },
            story_shape,
        ),
        (
            "chapter ch01",
            Row {
                chapter: "ch01",
                ..row(ANN, 4)
            },
            chapter_shape,
        ),
        (
            "storyVersion of 15 hex",
            Row {
                story_version: "0123456789abcde",
                ..row(ANN, 5)
            },
            version_shape,
        ),
        (
            "storyVersion upper-case",
            Row {
                story_version: "0123456789ABCDEF",
                ..row(ANN, 6)
            },
            version_shape,
        ),
    ];
    let mut results = Vec::new();
    for (case, r, want) in refused {
        results.push(expect_err(case, insert_row(&mut c, r).await, want));
    }
    let accepted: [(&str, Row<'_>); 3] = [
        ("story tide", row(ANN, 11)),
        (
            "story of 24 chars",
            Row {
                story: &longest,
                ..row(ANN, 12)
            },
        ),
        (
            "chapter ch10",
            Row {
                chapter: "ch10",
                ..row(ANN, 13)
            },
        ),
    ];
    for (case, r) in accepted {
        results.push(expect_ok(case, insert_row(&mut c, r).await));
    }
    let failures: Vec<String> = results.into_iter().filter_map(Result::err).collect();
    report(&failures);
}

/// A picked option belongs to the event's chapter: its line ID's chapter part is the row's chapter.
#[tokio::test]
async fn schema_stat_events_choice_in_chapter() {
    let (_st, _db, mut c) = schema_db().await;
    let results = [
        expect_err(
            "ch1.hall.a1b2 in ch3",
            insert_row(
                &mut c,
                Row {
                    kind: "choice_made",
                    subject: Some("ch1.hall.a1b2"),
                    ..row(ANN, 1)
                },
            )
            .await,
            ("23514", "stat_events_choice_in_chapter"),
        ),
        expect_ok(
            "ch3.shore.s001 in ch3",
            insert_row(
                &mut c,
                Row {
                    kind: "choice_made",
                    subject: Some("ch3.shore.s001"),
                    ..row(ANN, 2)
                },
            )
            .await,
        ),
    ];
    let failures: Vec<String> = results.into_iter().filter_map(Result::err).collect();
    report(&failures);
}

/// The client-measured age is 0 to 30 days in ms; the server receive time is positive.
#[tokio::test]
async fn schema_stat_events_bounds() {
    let (_st, _db, mut c) = schema_db().await;
    let age = ("23514", "stat_events_age_bounded");
    let results = [
        expect_err(
            "age_ms -1",
            insert_row(
                &mut c,
                Row {
                    age_ms: -1,
                    ..row(ANN, 1)
                },
            )
            .await,
            age,
        ),
        expect_err(
            "age_ms 2592000001",
            insert_row(
                &mut c,
                Row {
                    age_ms: 2_592_000_001,
                    ..row(ANN, 2)
                },
            )
            .await,
            age,
        ),
        expect_err(
            "received_at 0",
            insert_row(
                &mut c,
                Row {
                    received_at: 0,
                    ..row(ANN, 3)
                },
            )
            .await,
            ("23514", "stat_events_received_positive"),
        ),
        expect_ok(
            "age_ms 0",
            insert_row(
                &mut c,
                Row {
                    age_ms: 0,
                    ..row(ANN, 4)
                },
            )
            .await,
        ),
        expect_ok(
            "age_ms 2592000000",
            insert_row(
                &mut c,
                Row {
                    age_ms: 2_592_000_000,
                    ..row(ANN, 5)
                },
            )
            .await,
        ),
    ];
    let failures: Vec<String> = results.into_iter().filter_map(Result::err).collect();
    report(&failures);
}

/// The production budgets (`api/stats.rs`): 600 fact rows and 600 choice rows per rolling hour.
const CAPS: StatCaps = StatCaps {
    facts: 600,
    choices: 600,
};

/// An event of the repository tests: the owned parts a [`NewStatEvent`] borrows.
struct Ev {
    id: String,
    kind: StatKind,
    story: StoryId,
    chapter: ChapterId,
    subject: Option<String>,
    outcome: Option<StatOutcome>,
}

/// Event `uuid(n)` of `kind` in `chapter` (manor's ch1 / ch2, else tide's).
fn ev(
    n: u64,
    kind: StatKind,
    chapter: &str,
    subject: Option<&str>,
    outcome: Option<StatOutcome>,
) -> Ev {
    let story = if matches!(chapter, "ch1" | "ch2") {
        "manor"
    } else {
        "tide"
    };
    Ev {
        id: uuid(n),
        kind,
        story: StoryId(story.to_owned()),
        chapter: ChapterId(chapter.to_owned()),
        subject: subject.map(str::to_owned),
        outcome,
    }
}

/// The `n`-th fact, in turn each subject / outcome shape (NULL and not), so every array bind carries NULL and non-NULL
/// elements: a `chapter_started`, an `ending_reached`, a `puzzle_ended`.
fn fact(n: u64) -> Ev {
    match n % 3 {
        0 => ev(n, StatKind::ChapterStarted, "ch3", None, None),
        1 => ev(n, StatKind::EndingReached, "ch3", Some("drowned"), None),
        _ => ev(
            n,
            StatKind::PuzzleEnded,
            "ch1",
            Some("ch1.drawer"),
            Some(StatOutcome::Solved),
        ),
    }
}

/// Event `uuid(n)`: a pick of the ch3 option `ch3.shore.<suffix>`.
fn pick(n: u64, suffix: &str) -> Ev {
    let option = format!("ch3.shore.{suffix}");
    ev(n, StatKind::ChoiceMade, "ch3", Some(&option), None)
}

fn ids(evs: &[Ev]) -> Vec<String> {
    evs.iter().map(|e| e.id.clone()).collect()
}

/// `Recorded` with exactly these ids.
fn recorded(inserted: Vec<String>, over_budget: Vec<String>) -> Result<RecordOutcome, String> {
    Ok(RecordOutcome::Recorded {
        inserted,
        over_budget,
    })
}

/// `Repo::record_events` of `user` at `now` under [`CAPS`]; a database error as [`describe`] writes it.
async fn record(st: &AppState, user: i64, evs: &[Ev], now: i64) -> Result<RecordOutcome, String> {
    let events: Vec<NewStatEvent<'_>> = evs
        .iter()
        .map(|e| NewStatEvent {
            event_id: &e.id,
            kind: e.kind,
            story: &e.story,
            chapter: &e.chapter,
            subject: e.subject.as_deref(),
            outcome: e.outcome,
            story_version: VERSION,
            age_ms: 0,
        })
        .collect();
    st.repo
        .record_events(UserId(user), &events, now, CAPS)
        .await
        .map_err(|e| describe(&e))
}

/// The mismatch of one `record` call against `want`.
fn expect_record(
    case: &str,
    got: Result<RecordOutcome, String>,
    want: Result<RecordOutcome, String>,
) -> Option<String> {
    (got != want).then(|| format!("{case}: expected {want:?}, got {got:?}"))
}

/// `n` rows of `kind` with `subject` by `user` in tide's ch3, received at `at`.
async fn seed(st: &AppState, user: i64, n: i64, kind: &str, subject: Option<&str>, at: i64) {
    let mut c = common::raw_db(st).await;
    sqlx::query(
        "INSERT INTO stat_events (user_id, event_id, kind, story_id, chapter_id, subject, outcome, story_version, \
         age_ms, received_at) SELECT $1, gen_random_uuid()::text, $2, 'tide', 'ch3', $3, NULL, $4, 0, $5 \
         FROM generate_series(1, $6)",
    )
    .bind(user)
    .bind(kind)
    .bind(subject)
    .bind(VERSION)
    .bind(at)
    .bind(n)
    .execute(&mut c)
    .await
    .unwrap();
    c.close().await.unwrap();
}

/// The `stat_events` rows of `user`.
async fn rows(st: &AppState, user: i64) -> i64 {
    let mut c = common::raw_db(st).await;
    let n = sqlx::query_scalar("SELECT count(*) FROM stat_events WHERE user_id = $1")
        .bind(user)
        .fetch_one(&mut c)
        .await
        .unwrap();
    c.close().await.unwrap();
    n
}

/// A resent batch is recorded once: the second call inserts nothing and is not an error (`stat_events_event_key`
/// and `ON CONFLICT ... DO NOTHING`), for every subject / outcome shape.
#[tokio::test]
async fn stats_event_replay_counts_once() {
    let (st, _db) = state_with_users(&[ANN]).await;
    let batch: Vec<Ev> = (0..3).map(fact).collect();
    let mut failures = Vec::new();
    failures.extend(expect_record(
        "first send",
        record(&st, ANN, &batch, T0).await,
        recorded(ids(&batch), Vec::new()),
    ));
    failures.extend(expect_record(
        "resend",
        record(&st, ANN, &batch, T0).await,
        recorded(Vec::new(), Vec::new()),
    ));
    let n = rows(&st, ANN).await;
    if n != 3 {
        failures.push(format!("rows: expected 3, got {n}"));
    }
    report(&failures);
}

/// 600 fact rows per user per rolling hour: the 601st is refused with nothing written until the first rows leave the
/// window (`received_at > now - 3600`); a batch that would cross the cap is refused whole, one that reaches it is not.
#[tokio::test]
async fn stats_rate_limited_after_600_per_hour() {
    let (st, _db) = state_with_users(&[ANN, BEN]).await;
    let mut failures = Vec::new();
    let facts: Vec<Ev> = (0..600).map(fact).collect();
    for (i, batch) in facts.chunks(32).enumerate() {
        failures.extend(expect_record(
            &format!("batch {i} of {} at T0", batch.len()),
            record(&st, ANN, batch, T0).await,
            recorded(ids(batch), Vec::new()),
        ));
    }
    let one_more = [fact(600)];
    failures.extend(expect_record(
        "event 601 at T0",
        record(&st, ANN, &one_more, T0).await,
        Ok(RecordOutcome::RateLimited),
    ));
    let n = rows(&st, ANN).await;
    if n != 600 {
        failures.push(format!("rows after the refusal: expected 600, got {n}"));
    }
    failures.extend(expect_record(
        "event 601 at T0 + 3599",
        record(&st, ANN, &one_more, T0 + 3599).await,
        Ok(RecordOutcome::RateLimited),
    ));
    failures.extend(expect_record(
        "event 601 at T0 + 3600",
        record(&st, ANN, &one_more, T0 + 3600).await,
        recorded(ids(&one_more), Vec::new()),
    ));

    seed(&st, BEN, 590, "chapter_started", None, T0).await;
    let eleven: Vec<Ev> = (1000..1011).map(fact).collect();
    failures.extend(expect_record(
        "BEN at 590: a batch of 11",
        record(&st, BEN, &eleven, T0).await,
        Ok(RecordOutcome::RateLimited),
    ));
    let ten = &eleven[..10];
    failures.extend(expect_record(
        "BEN at 590: a batch of 10",
        record(&st, BEN, ten, T0).await,
        recorded(ids(ten), Vec::new()),
    ));
    report(&failures);
}

/// Facts and choices have budgets of their own: 600 choice rows in the hour do not refuse a fact, and a fact window
/// past its cap (concurrent batches overshoot it by up to one batch) does not refuse a batch without facts.
#[tokio::test]
async fn stats_cap_does_not_refuse_facts() {
    let (st, _db) = state_with_users(&[ANN, BEN]).await;
    let mut failures = Vec::new();
    seed(&st, ANN, 600, "choice_made", Some("ch3.shore.s001"), T0).await;
    let ending = [ev(1, StatKind::EndingReached, "ch3", Some("drowned"), None)];
    failures.extend(expect_record(
        "ANN at 600 choices: an ending",
        record(&st, ANN, &ending, T0).await,
        recorded(ids(&ending), Vec::new()),
    ));
    seed(&st, BEN, 601, "chapter_started", None, T0).await;
    let choice = [pick(2, "s002")];
    failures.extend(expect_record(
        "BEN at 601 facts: a choice",
        record(&st, BEN, &choice, T0).await,
        recorded(ids(&choice), Vec::new()),
    ));
    report(&failures);
}

/// Past the choice budget only first picks are written: an option the user never picked, once per batch. The other
/// choices past the budget come back `over_budget`, in batch order; within the budget every pick is written.
#[tokio::test]
async fn stats_choice_over_budget_keeps_first_picks() {
    let (st, _db) = state_with_users(&[ANN, BEN]).await;
    let mut failures = Vec::new();
    seed(&st, ANN, 600, "choice_made", Some("ch3.shore.s001"), T0).await;
    let (a, b, c) = (pick(1, "s001"), pick(2, "s002"), pick(3, "s002"));
    let want = recorded(vec![b.id.clone()], vec![a.id.clone(), c.id.clone()]);
    failures.extend(expect_record(
        "ANN at 600: [A s001, B s002, C s002]",
        record(&st, ANN, &[a, b, c], T0).await,
        want,
    ));

    // BEN's stored picks are of another option: only the batch's own earlier picks make the third a repeat.
    seed(&st, BEN, 598, "choice_made", Some("ch3.shore.s009"), T0).await;
    let three: Vec<Ev> = (11..14).map(|n| pick(n, "s001")).collect();
    failures.extend(expect_record(
        "BEN at 598: [s001 x 3]",
        record(&st, BEN, &three, T0).await,
        recorded(ids(&three[..2]), ids(&three[2..])),
    ));

    let later = [pick(21, "s001"), pick(22, "s002"), pick(23, "s002")];
    failures.extend(expect_record(
        "ANN at T0 + 3600: [s001, s002, s002]",
        record(&st, ANN, &later, T0 + 3600).await,
        recorded(ids(&later), Vec::new()),
    ));
    report(&failures);
}

/// A wire event `uuid(n)` of `kind` in `chapter`, of the right story version and age 0.
fn event(n: u64, kind: &str, chapter: &str, subject: Option<&str>, outcome: Option<&str>) -> Value {
    json!({
        "eventId": uuid(n),
        "kind": kind,
        "chapterId": chapter,
        "storyVersion": VERSION,
        "subject": subject,
        "outcome": outcome,
        "ageMs": 0,
    })
}

/// `event` with `key` set to `value`.
fn with(mut event: Value, key: &str, value: Value) -> Value {
    event[key] = value;
    event
}

/// `POST /api/stats/events` as `user` with the raw `body`.
async fn post_raw(st: &AppState, user: i64, body: String) -> common::Reply {
    let req = Request::post("/api/stats/events")
        .header(AUTHORIZATION, bearer(st, user))
        .header(CONTENT_TYPE, "application/json")
        .body(Body::from(body))
        .unwrap();
    common::call(st, req).await
}

/// `POST /api/stats/events` as `user` with the batch `{ events }`.
async fn post(st: &AppState, user: i64, events: Vec<Value>) -> common::Reply {
    post_raw(st, user, json!({ "events": events }).to_string()).await
}

/// A `PostStatsResponse` as JSON; `rejected` is (event `n`, reason) in batch order.
fn answer(recorded: u32, duplicates: u32, rejected: &[(u64, &str)]) -> Value {
    let rejected: Vec<Value> = rejected
        .iter()
        .map(|&(n, reason)| json!({ "eventId": uuid(n), "reason": reason }))
        .collect();
    json!({ "recorded": recorded, "duplicates": duplicates, "rejected": rejected })
}

fn body_text(reply: &common::Reply) -> String {
    String::from_utf8_lossy(&reply.body).into_owned()
}

/// The mismatch of `reply` against a 200 with exactly the JSON `want`.
fn expect_answer(case: &str, reply: &common::Reply, want: &Value) -> Option<String> {
    let got: Option<Value> = serde_json::from_slice(&reply.body).ok();
    (reply.status.as_u16() != 200 || got.as_ref() != Some(want)).then(|| {
        format!(
            "{case}: expected 200 {want}, got {} {}",
            reply.status.as_u16(),
            body_text(reply)
        )
    })
}

/// The mismatch of `reply` against `status` with exactly the body `body`.
fn expect_reply(case: &str, reply: &common::Reply, status: u16, body: &str) -> Option<String> {
    let got = body_text(reply);
    (reply.status.as_u16() != status || got != body).then(|| {
        format!(
            "{case}: expected {status} {body}, got {} {got}",
            reply.status.as_u16()
        )
    })
}

const BAD_REQUEST: &str = r#"{"error":"bad_request"}"#;

/// An ending is accepted only in the chapter the story index places it in: `dawn` is tide's, but ch4's.
#[tokio::test]
async fn stats_unknown_ending_rejected() {
    let (st, _db) = state_with_users(&[ANN]).await;
    let mut failures = Vec::new();
    let reply = post(
        &st,
        ANN,
        vec![event(1, "ending_reached", "ch3", Some("dawn"), None)],
    )
    .await;
    failures.extend(expect_answer(
        "dawn for ch3",
        &reply,
        &answer(0, 0, &[(1, "unknown_ending")]),
    ));
    let reply = post(
        &st,
        ANN,
        vec![event(2, "ending_reached", "ch3", Some("drowned"), None)],
    )
    .await;
    failures.extend(expect_answer(
        "drowned for ch3 (control)",
        &reply,
        &answer(1, 0, &[]),
    ));
    report(&failures);
}

/// A paid chapter's event is recorded only for its buyer, judged at write time.
#[tokio::test]
async fn stats_paid_ending_needs_entitlement() {
    let (st, _db) = state_with_users(&[ANN]).await;
    let mut failures = Vec::new();
    let reply = post(
        &st,
        ANN,
        vec![event(1, "ending_reached", "ch4", Some("dawn"), None)],
    )
    .await;
    failures.extend(expect_answer(
        "dawn for ch4 without chapter:ch4",
        &reply,
        &answer(0, 0, &[(1, "not_entitled")]),
    ));
    own(&st, ANN, "chapter:ch4").await;
    let reply = post(
        &st,
        ANN,
        vec![event(2, "ending_reached", "ch4", Some("dawn"), None)],
    )
    .await;
    failures.extend(expect_answer(
        "dawn for ch4 with chapter:ch4",
        &reply,
        &answer(1, 0, &[]),
    ));
    report(&failures);
}

/// The entitlement is judged before the subject: a non-buyer gets `not_entitled` for a real paid ending and for an
/// invented one alike, so the answers name no paid ending.
#[tokio::test]
async fn stats_not_entitled_hides_ending_check() {
    let (st, _db) = state_with_users(&[ANN]).await;
    let reply = post(
        &st,
        ANN,
        vec![
            event(1, "ending_reached", "ch4", Some("nope"), None),
            event(2, "ending_reached", "ch4", Some("dawn"), None),
        ],
    )
    .await;
    let failures: Vec<String> = expect_answer(
        "nope and dawn in unowned ch4",
        &reply,
        &answer(0, 0, &[(1, "not_entitled"), (2, "not_entitled")]),
    )
    .into_iter()
    .collect();
    report(&failures);
}

/// The server derives the story from the chapter; a request that names one is refused whole.
#[tokio::test]
async fn stats_story_derived_by_server() {
    let (st, _db) = state_with_users(&[ANN]).await;
    let mut failures = Vec::new();
    let reply = post(
        &st,
        ANN,
        vec![event(1, "chapter_started", "ch3", None, None)],
    )
    .await;
    failures.extend(expect_answer("ch3 started", &reply, &answer(1, 0, &[])));
    let mut c = common::raw_db(&st).await;
    let story: Option<String> =
        sqlx::query_scalar("SELECT story_id FROM stat_events WHERE user_id = $1 AND event_id = $2")
            .bind(ANN)
            .bind(uuid(1))
            .fetch_optional(&mut c)
            .await
            .unwrap();
    c.close().await.unwrap();
    if story.as_deref() != Some("tide") {
        failures.push(format!("stored story_id: expected tide, got {story:?}"));
    }
    let inner = with(
        event(2, "chapter_started", "ch3", None, None),
        "storyId",
        json!("manor"),
    );
    let reply = post(&st, ANN, vec![inner]).await;
    failures.extend(expect_reply(
        "storyId inside an event",
        &reply,
        400,
        BAD_REQUEST,
    ));
    let top =
        json!({ "events": [event(3, "chapter_started", "ch3", None, None)], "storyId": "manor" });
    let reply = post_raw(&st, ANN, top.to_string()).await;
    failures.extend(expect_reply(
        "storyId at the top level",
        &reply,
        400,
        BAD_REQUEST,
    ));
    let n = rows(&st, ANN).await;
    if n != 1 {
        failures.push(format!("rows after the two 400s: expected 1, got {n}"));
    }
    report(&failures);
}

/// A batch holds 1 to 32 events in at most 16 KB (the `/api` default body limit).
#[tokio::test]
async fn stats_batch_over_32_400() {
    let (st, _db) = state_with_users(&[ANN]).await;
    let mut failures = Vec::new();
    let started = |n: u64| event(n, "chapter_started", "ch3", None, None);
    let reply = post(&st, ANN, (100..133).map(started).collect()).await;
    failures.extend(expect_reply("33 events", &reply, 400, BAD_REQUEST));
    let reply = post(&st, ANN, Vec::new()).await;
    failures.extend(expect_reply("0 events", &reply, 400, BAD_REQUEST));
    let reply = post_raw(&st, ANN, "{}".to_owned()).await;
    failures.extend(expect_reply("events missing", &reply, 400, BAD_REQUEST));
    let long = with(started(200), "subject", json!("x".repeat(17 * 1024)));
    let reply = post(&st, ANN, vec![long]).await;
    failures.extend(expect_reply(
        "a body over 16 KB",
        &reply,
        413,
        r#"{"error":"payload_too_large"}"#,
    ));
    let n = rows(&st, ANN).await;
    if n != 0 {
        failures.push(format!("rows after the refusals: expected 0, got {n}"));
    }
    let reply = post(&st, ANN, (1..33).map(started).collect()).await;
    failures.extend(expect_answer(
        "32 events (control)",
        &reply,
        &answer(32, 0, &[]),
    ));
    report(&failures);
}

/// A puzzle is accepted only in its own chapter; a rejected event does not drop the rest of the batch.
#[tokio::test]
async fn stats_puzzle_of_other_chapter_rejected() {
    let (st, _db) = state_with_users(&[ANN]).await;
    let reply = post(
        &st,
        ANN,
        vec![
            event(1, "puzzle_ended", "ch3", Some("ch1.drawer"), Some("solved")),
            event(
                2,
                "puzzle_ended",
                "ch3",
                Some("ch3.nothing"),
                Some("failed"),
            ),
            event(3, "puzzle_ended", "ch1", Some("ch1.drawer"), Some("solved")),
        ],
    )
    .await;
    let failures: Vec<String> = expect_answer(
        "ch1.drawer for ch3, ch3.nothing for ch3, ch1.drawer for ch1",
        &reply,
        &answer(1, 0, &[(1, "unknown_puzzle"), (2, "unknown_puzzle")]),
    )
    .into_iter()
    .collect();
    report(&failures);
}

/// A picked option is accepted only in its own chapter (its line ID's prefix), after the entitlement.
#[tokio::test]
async fn stats_choice_shape_checked() {
    let (st, _db) = state_with_users(&[ANN]).await;
    let reply = post(
        &st,
        ANN,
        vec![
            event(1, "choice_made", "ch3", Some("ch1.hall.a1b2"), None),
            event(2, "choice_made", "ch3", Some("ch3.shore.s001"), None),
            event(3, "choice_made", "ch4", Some("ch1.hall.a1b2"), None),
        ],
    )
    .await;
    let failures: Vec<String> = expect_answer(
        "ch1 option for ch3, ch3 option for ch3, ch1 option for unowned ch4",
        &reply,
        &answer(1, 0, &[(1, "unknown_choice"), (3, "not_entitled")]),
    )
    .into_iter()
    .collect();
    report(&failures);
}

/// The choice vocabulary (META-PLAN M2): a well-formed option of ch3 that the build did not emit for ch3
/// (`choices.ch3` of the meta index) is `unknown_choice`; one it emitted is recorded.
#[tokio::test]
async fn stats_unknown_choice_rejected() {
    let (st, _db) = state_with_users(&[ANN]).await;
    let reply = post(
        &st,
        ANN,
        vec![
            event(1, "choice_made", "ch3", Some("ch3.shore.zz99"), None),
            event(2, "choice_made", "ch3", Some("ch3.shore.s001"), None),
        ],
    )
    .await;
    let failures: Vec<String> = expect_answer(
        "ch3.shore.zz99 (outside choices.ch3) and ch3.shore.s001",
        &reply,
        &answer(1, 0, &[(1, "unknown_choice")]),
    )
    .into_iter()
    .collect();
    report(&failures);
}

/// The entitlement is judged before the vocabulary: an option of unowned ch4 is `not_entitled` whether or not the
/// build emitted it, so the answer names no paid option; with ch4 owned, the same option outside `choices.ch4` (empty
/// in the fixture) is `unknown_choice`.
#[tokio::test]
async fn stats_paid_choice_needs_entitlement_first() {
    let (st, _db) = state_with_users(&[ANN]).await;
    let mut failures = Vec::new();
    let reply = post(
        &st,
        ANN,
        vec![event(1, "choice_made", "ch4", Some("ch4.lamp.zz99"), None)],
    )
    .await;
    failures.extend(expect_answer(
        "ch4.lamp.zz99 in unowned ch4",
        &reply,
        &answer(0, 0, &[(1, "not_entitled")]),
    ));
    own(&st, ANN, "chapter:ch4").await;
    let reply = post(
        &st,
        ANN,
        vec![event(2, "choice_made", "ch4", Some("ch4.lamp.zz99"), None)],
    )
    .await;
    failures.extend(expect_answer(
        "ch4.lamp.zz99 in owned ch4",
        &reply,
        &answer(0, 0, &[(2, "unknown_choice")]),
    ));
    report(&failures);
}

/// Past the choice budget only first picks are written (SP Y11), and the vocabulary bounds them: a client forging
/// distinct well-formed options outside `choices.ch3` writes nothing, so the window grows by at most the vocabulary's
/// size (the LS3 pre-deploy item, RULINGS 52).
#[tokio::test]
async fn stats_first_picks_bounded_by_vocabulary() {
    let (st, _db) = state_with_users(&[BEN]).await;
    let mut failures = Vec::new();
    seed(&st, BEN, 600, "choice_made", Some("ch3.shore.s001"), T0).await;
    let forged = |from: u64| -> (Vec<Value>, Vec<(u64, &'static str)>) {
        let events = (from..from + 32)
            .map(|n| {
                let option = format!("ch3.shore.x{:03}", n % 64);
                event(n, "choice_made", "ch3", Some(option.as_str()), None)
            })
            .collect();
        let rejected = (from..from + 32).map(|n| (n, "unknown_choice")).collect();
        (events, rejected)
    };
    for (round, from) in [("first", 0), ("second", 32)] {
        let (events, rejected) = forged(from);
        let reply = post(&st, BEN, events).await;
        failures.extend(expect_answer(
            &format!("{round} 32 options outside choices.ch3"),
            &reply,
            &answer(0, 0, &rejected),
        ));
    }
    let n = rows(&st, BEN).await;
    if n != 600 {
        failures.push(format!(
            "rows after 64 out-of-vocabulary first picks: expected 600, got {n}"
        ));
    }
    let reply = post(
        &st,
        BEN,
        vec![
            event(100, "choice_made", "ch3", Some("ch3.shore.s001"), None),
            event(101, "choice_made", "ch3", Some("ch3.shore.s002"), None),
        ],
    )
    .await;
    failures.extend(expect_answer(
        "s001 (a repeat) and s002 (a first pick)",
        &reply,
        &answer(1, 0, &[(100, "rate_limited")]),
    ));
    for (round, from) in [("third", 200), ("fourth", 232)] {
        let (events, rejected) = forged(from);
        let reply = post(&st, BEN, events).await;
        failures.extend(expect_answer(
            &format!("{round} 32 options outside choices.ch3"),
            &reply,
            &answer(0, 0, &rejected),
        ));
    }
    let n = rows(&st, BEN).await;
    if n != 601 {
        failures.push(format!(
            "rows after the vocabulary's first pick and 64 more forged ones: expected 601, got {n}"
        ));
    }
    report(&failures);
}

/// Every shape the table's CHECKs refuse is a 400 for the whole batch before any write, never a 500: the batch's
/// well-formed event is not written either.
#[tokio::test]
async fn stats_malformed_event_400() {
    let (st, _db) = state_with_users(&[ANN]).await;
    let started = event(1, "chapter_started", "ch3", None, None);
    // The well-formed second event each shape case changes.
    let base = event(2, "chapter_started", "ch3", None, None);
    let long_name = "d".repeat(33);
    let cases: Vec<(&str, Value)> = vec![
        (
            "upper-case UUID",
            with(
                base.clone(),
                "eventId",
                json!("0000000A-0000-4000-8000-00000000000A"),
            ),
        ),
        (
            "v1 UUID",
            with(
                base.clone(),
                "eventId",
                json!("00000002-0000-1000-8000-000000000002"),
            ),
        ),
        (
            "NUL inside the id",
            with(
                base.clone(),
                "eventId",
                json!("00000002-0000-4000-8000-00000000000\u{0}"),
            ),
        ),
        ("ageMs -1", with(base.clone(), "ageMs", json!(-1))),
        (
            "ageMs 2592000001",
            with(base.clone(), "ageMs", json!(2_592_000_001_i64)),
        ),
        (
            "chapterId ch01",
            with(base.clone(), "chapterId", json!("ch01")),
        ),
        (
            "storyVersion ABC",
            with(base.clone(), "storyVersion", json!("ABC")),
        ),
        (
            "chapter_started with a subject",
            event(2, "chapter_started", "ch3", Some("drowned"), None),
        ),
        (
            "chapter_completed with a subject",
            event(2, "chapter_completed", "ch3", Some("drowned"), None),
        ),
        (
            "chapter_completed with an outcome",
            event(2, "chapter_completed", "ch3", None, Some("solved")),
        ),
        (
            "ending_reached without a subject",
            event(2, "ending_reached", "ch3", None, None),
        ),
        (
            "ending_reached with an outcome",
            event(2, "ending_reached", "ch3", Some("drowned"), Some("solved")),
        ),
        (
            "an ending name of 33 chars",
            event(2, "ending_reached", "ch3", Some(long_name.as_str()), None),
        ),
        (
            "puzzle_ended without an outcome",
            event(2, "puzzle_ended", "ch1", Some("ch1.drawer"), None),
        ),
        (
            "puzzle_ended with outcome won",
            event(2, "puzzle_ended", "ch1", Some("ch1.drawer"), Some("won")),
        ),
        (
            "choice_made with an outcome",
            event(
                2,
                "choice_made",
                "ch3",
                Some("ch3.shore.s001"),
                Some("solved"),
            ),
        ),
        (
            "choice_made subject ch3.shore",
            event(2, "choice_made", "ch3", Some("ch3.shore"), None),
        ),
        (
            "choice_made subject ch3.shore.S001",
            event(2, "choice_made", "ch3", Some("ch3.shore.S001"), None),
        ),
        (
            "choice_made subject ch3.shore.s01",
            event(2, "choice_made", "ch3", Some("ch3.shore.s01"), None),
        ),
        (
            "choice_made subject ch3.shore.s0011",
            event(2, "choice_made", "ch3", Some("ch3.shore.s0011"), None),
        ),
        ("unknown kind", event(2, "choice", "ch3", None, None)),
    ];
    let mut failures = Vec::new();
    for (case, bad) in cases {
        let reply = post(&st, ANN, vec![started.clone(), bad]).await;
        failures.extend(expect_reply(case, &reply, 400, BAD_REQUEST));
        let n = rows(&st, ANN).await;
        if n != 0 {
            failures.push(format!("{case}: expected 0 rows, got {n}"));
        }
    }
    let reply = post(&st, ANN, vec![started]).await;
    failures.extend(expect_answer(
        "a well-formed event (control)",
        &reply,
        &answer(1, 0, &[]),
    ));
    report(&failures);
}

/// A resent batch is answered as duplicates; a batch repeating an id records it once and counts the repeat.
#[tokio::test]
async fn stats_replayed_batch_answers_duplicates() {
    let (st, _db) = state_with_users(&[ANN]).await;
    let mut failures = Vec::new();
    let two = || {
        vec![
            event(1, "chapter_started", "ch3", None, None),
            event(2, "ending_reached", "ch3", Some("drowned"), None),
        ]
    };
    let reply = post(&st, ANN, two()).await;
    failures.extend(expect_answer("first send", &reply, &answer(2, 0, &[])));
    let reply = post(&st, ANN, two()).await;
    failures.extend(expect_answer("resend", &reply, &answer(0, 2, &[])));
    let repeated = event(3, "chapter_completed", "ch3", None, None);
    let reply = post(&st, ANN, vec![repeated.clone(), repeated]).await;
    failures.extend(expect_answer(
        "one id twice in a batch",
        &reply,
        &answer(1, 1, &[]),
    ));
    let n = rows(&st, ANN).await;
    if n != 3 {
        failures.push(format!("rows: expected 3, one per id, got {n}"));
    }
    report(&failures);
}

/// Over the facts' budget the batch is a 429 with `Retry-After: 600` and nothing written; over the choice budget a
/// repeat pick is a per-event `rate_limited`, never a 429.
#[tokio::test]
async fn stats_cap_429_and_rate_limited_reject() {
    let (st, _db) = state_with_users(&[ANN, BEN]).await;
    let mut failures = Vec::new();
    seed(&st, ANN, 600, "chapter_started", None, T0).await;
    let reply = post(
        &st,
        ANN,
        vec![event(1, "chapter_completed", "ch3", None, None)],
    )
    .await;
    failures.extend(expect_reply(
        "ANN at 600 facts: one more",
        &reply,
        429,
        r#"{"error":"rate_limited"}"#,
    ));
    let retry = reply
        .headers
        .get(RETRY_AFTER)
        .map(|v| v.to_str().unwrap_or("<not text>"));
    if retry != Some("600") {
        failures.push(format!("Retry-After: expected 600, got {retry:?}"));
    }
    let n = rows(&st, ANN).await;
    if n != 600 {
        failures.push(format!("ANN rows after the 429: expected 600, got {n}"));
    }
    seed(&st, BEN, 600, "choice_made", Some("ch3.shore.s001"), T0).await;
    let reply = post(
        &st,
        BEN,
        vec![event(2, "choice_made", "ch3", Some("ch3.shore.s001"), None)],
    )
    .await;
    failures.extend(expect_answer(
        "BEN at 600 choices: a repeat pick",
        &reply,
        &answer(0, 0, &[(2, "rate_limited")]),
    ));
    report(&failures);
}

/// `GET /api/stats` as `user`: the status and the body as JSON (`null` when it is not JSON).
async fn read_stats(st: &AppState, user: i64) -> (u16, Value) {
    let reply = get(st, Some(user), "/api/stats").await;
    let body = serde_json::from_slice(&reply.body).unwrap_or(Value::Null);
    (reply.status.as_u16(), body)
}

/// A `StoryStatsDto` as JSON.
fn story_stats(id: &str, started: bool, completed: &[&str], total: u32, endings: &[&str]) -> Value {
    json!({
        "storyId": id,
        "started": started,
        "chaptersCompleted": completed,
        "chaptersTotal": total,
        "endingsReached": endings,
    })
}

/// A `StatsResponse` of the fixture's two stories (manor first) as JSON, the game totals summed from them.
fn stats_body(manor: Value, tide: Value) -> Value {
    let started = [&manor, &tide]
        .iter()
        .filter(|s| s["started"] == json!(true))
        .count();
    let endings: usize = [&manor, &tide]
        .iter()
        .map(|s| s["endingsReached"].as_array().map_or(0, Vec::len))
        .sum();
    json!({
        "stories": [manor, tide],
        "game": { "storiesStarted": started, "storiesTotal": 2, "endingsReached": endings },
    })
}

/// The mismatch of a stats read against a 200 with exactly `want`.
fn expect_stats(case: &str, got: &(u16, Value), want: &Value) -> Option<String> {
    (got.0 != 200 || &got.1 != want)
        .then(|| format!("{case}: expected 200 {want}, got {} {}", got.0, got.1))
}

/// An ending reached twice under two ids is one fact; an ending never reached is not named; a story without a start
/// is not started. The game sums the stories.
#[tokio::test]
async fn stats_endings_reached_distinct() {
    let (st, _db) = state_with_users(&[ANN]).await;
    let mut failures = Vec::new();
    for n in [1, 2] {
        let reply = post(
            &st,
            ANN,
            vec![event(n, "ending_reached", "ch3", Some("drowned"), None)],
        )
        .await;
        failures.extend(expect_answer(
            &format!("drowned, id {n}"),
            &reply,
            &answer(1, 0, &[]),
        ));
    }
    let want = stats_body(
        story_stats("manor", false, &[], 2, &[]),
        story_stats("tide", false, &["ch3"], 2, &["drowned"]),
    );
    failures.extend(expect_stats("read", &read_stats(&st, ANN).await, &want));
    report(&failures);
}

/// The number of object keys named `name` at any depth of `v`.
fn keys_named(v: &Value, name: &str) -> usize {
    match v {
        Value::Object(map) => map
            .iter()
            .map(|(key, value)| usize::from(key == name) + keys_named(value, name))
            .sum(),
        Value::Array(items) => items.iter().map(|item| keys_named(item, name)).sum(),
        _ => 0,
    }
}

/// No total of endings at either level (META-PLAN M8): not in the served JSON, not in the client's contract.
#[tokio::test]
async fn stats_response_has_no_endings_total() {
    let (st, _db) = state_with_users(&[ANN]).await;
    let mut failures = Vec::new();
    let reply = post(
        &st,
        ANN,
        vec![
            event(1, "chapter_started", "ch3", None, None),
            event(2, "ending_reached", "ch3", Some("drowned"), None),
        ],
    )
    .await;
    failures.extend(expect_answer("the events", &reply, &answer(2, 0, &[])));
    let (status, body) = read_stats(&st, ANN).await;
    if status != 200 || body["stories"].as_array().is_none_or(Vec::is_empty) {
        failures.push(format!(
            "read: expected 200 with stories, got {status} {body}"
        ));
    }
    let n = keys_named(&body, "endingsTotal");
    if n != 0 {
        failures.push(format!(
            "the served JSON: expected no endingsTotal key, got {n} in {body}"
        ));
    }
    let cfg = ts_rs::Config::default();
    for (dto, decl) in [
        ("StoryStatsDto", StoryStatsDto::decl(&cfg)),
        ("GameStatsDto", GameStatsDto::decl(&cfg)),
    ] {
        if decl.contains("endingsTotal") {
            failures.push(format!("{dto}: expected no endingsTotal, got {decl}"));
        }
    }
    report(&failures);
}

/// A declared ending ends its chapter without a `chapter_completed` (STORIES-PLAN F4'): the chapter counts as
/// completed, listed in chain order.
#[tokio::test]
async fn stats_ending_completes_its_chapter() {
    let (st, _db) = state_with_users(&[ANN]).await;
    own(&st, ANN, "chapter:ch4").await;
    let mut failures = Vec::new();
    let reply = post(
        &st,
        ANN,
        vec![
            event(1, "ending_reached", "ch4", Some("dawn"), None),
            event(2, "ending_reached", "ch3", Some("drowned"), None),
        ],
    )
    .await;
    failures.extend(expect_answer(
        "dawn in ch4, drowned in ch3",
        &reply,
        &answer(2, 0, &[]),
    ));
    let want = stats_body(
        story_stats("manor", false, &[], 2, &[]),
        story_stats("tide", false, &["ch3", "ch4"], 2, &["dawn", "drowned"]),
    );
    failures.extend(expect_stats("read", &read_stats(&st, ANN).await, &want));
    report(&failures);
}

/// An `Ev` with every part given: rows `classify` would refuse.
fn raw_ev(n: u64, kind: StatKind, story: &str, chapter: &str, subject: Option<&str>) -> Ev {
    Ev {
        id: uuid(n),
        kind,
        story: StoryId(story.to_owned()),
        chapter: ChapterId(chapter.to_owned()),
        subject: subject.map(str::to_owned),
        outcome: None,
    }
}

/// Old rows outside the current index stay in the table and are not counted (ST6): an ending the story no longer
/// declares (and so no completed chapter by it), a chapter the story no longer has, a story the index no longer has,
/// and a chapter recorded under another story.
#[tokio::test]
async fn stats_retired_ending_not_counted() {
    let (st, _db) = state_with_users(&[ANN]).await;
    let retired = [
        raw_ev(1, StatKind::EndingReached, "tide", "ch3", Some("lost")),
        raw_ev(2, StatKind::ChapterCompleted, "tide", "ch9", None),
        raw_ev(3, StatKind::ChapterStarted, "gone", "ch5", None),
        raw_ev(4, StatKind::ChapterStarted, "manor", "ch3", None),
    ];
    let mut failures = Vec::new();
    failures.extend(expect_record(
        "the retired rows",
        record(&st, ANN, &retired, T0).await,
        recorded(ids(&retired), Vec::new()),
    ));
    let want = stats_body(
        story_stats("manor", false, &[], 2, &[]),
        story_stats("tide", false, &[], 2, &[]),
    );
    failures.extend(expect_stats("read", &read_stats(&st, ANN).await, &want));
    report(&failures);
}

/// Statistics of a paid chapter unlock nothing (ST4, principle 1): with rows that say ch4 was started, completed and
/// ended, the chapter is still 403 and its product still not owned.
#[tokio::test]
async fn stats_do_not_unlock_paid_chapter() {
    let (st, _db) = state_with_users(&[ANN]).await;
    let rows4 = [
        raw_ev(1, StatKind::ChapterStarted, "tide", "ch4", None),
        raw_ev(2, StatKind::ChapterCompleted, "tide", "ch4", None),
        raw_ev(3, StatKind::EndingReached, "tide", "ch4", Some("dawn")),
    ];
    let mut failures = Vec::new();
    failures.extend(expect_record(
        "the ch4 rows",
        record(&st, ANN, &rows4, T0).await,
        recorded(ids(&rows4), Vec::new()),
    ));
    let reply = get(&st, Some(ANN), "/api/chapters/ch4").await;
    failures.extend(expect_reply(
        "GET /api/chapters/ch4",
        &reply,
        403,
        r#"{"error":"not_entitled"}"#,
    ));
    let reply = get(&st, Some(ANN), "/api/entitlements").await;
    let body: Value = serde_json::from_slice(&reply.body).unwrap_or(Value::Null);
    let ch4 = body["products"].as_array().and_then(|products| {
        products
            .iter()
            .find(|p| p["productId"] == json!("chapter:ch4"))
    });
    if reply.status.as_u16() != 200 || ch4.map(|p| &p["owned"]) != Some(&json!(false)) {
        failures.push(format!(
            "GET /api/entitlements: expected 200 with chapter:ch4 owned false, got {} {body}",
            reply.status.as_u16()
        ));
    }
    report(&failures);
}

/// The `Cache-Control` of `reply`.
fn cache_control(reply: &common::Reply) -> Option<String> {
    reply
        .headers
        .get(CACHE_CONTROL)
        .map(|v| v.to_str().unwrap_or("<not text>").to_owned())
}

/// Both 200s are one user's own data, `private, no-store`; an error keeps the router's `no-store`.
#[tokio::test]
async fn stats_private_no_store() {
    let (st, _db) = state_with_users(&[ANN]).await;
    let mut failures = Vec::new();
    let no_token_post = Request::post("/api/stats/events")
        .header(CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "events": [event(9, "chapter_started", "ch3", None, None)] }).to_string(),
        ))
        .unwrap();
    for (case, reply, status, cache) in [
        (
            "POST 200",
            post(
                &st,
                ANN,
                vec![event(1, "chapter_started", "ch3", None, None)],
            )
            .await,
            200,
            "private, no-store",
        ),
        (
            "GET 200",
            get(&st, Some(ANN), "/api/stats").await,
            200,
            "private, no-store",
        ),
        (
            "GET without a token",
            get(&st, None, "/api/stats").await,
            401,
            "no-store",
        ),
        (
            "POST without a token",
            common::call(&st, no_token_post).await,
            401,
            "no-store",
        ),
    ] {
        let got = cache_control(&reply);
        if reply.status.as_u16() != status || got.as_deref() != Some(cache) {
            failures.push(format!(
                "{case}: expected {status} with Cache-Control {cache}, got {} with {got:?}",
                reply.status.as_u16()
            ));
        }
    }
    report(&failures);
}

/// Every Rust file under `dir`, with its text.
#[allow(
    clippy::disallowed_methods,
    reason = "a sync test may read files; the lint guards async handlers"
)]
fn rust_files(dir: &Path, files: &mut Vec<(PathBuf, String)>, problems: &mut Vec<String>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        problems.push(format!("cannot read {}", dir.display()));
        return;
    };
    for entry in entries {
        let path = match entry {
            Ok(entry) => entry.path(),
            Err(e) => {
                problems.push(format!("cannot list {}: {e}", dir.display()));
                continue;
            }
        };
        if path.is_dir() {
            rust_files(&path, files, problems);
        } else if path.extension().is_some_and(|ext| ext == "rs") {
            match std::fs::read_to_string(&path) {
                Ok(text) => files.push((path, text)),
                Err(e) => problems.push(format!("cannot read {}: {e}", path.display())),
            }
        }
    }
}

/// The identifiers of the code lines of `text`: a comment line (`//`, `///`, `//!`) is skipped, so a why-comment may
/// name the repository.
fn code_identifiers(text: &str) -> impl Iterator<Item = (usize, &str)> {
    text.lines()
        .enumerate()
        .filter(|(_, line)| !line.trim_start().starts_with("//"))
        .flat_map(|(i, line)| {
            line.split(|c: char| !(c.is_ascii_alphanumeric() || c == '_'))
                .filter(|t| !t.is_empty())
                .map(move |t| (i + 1, t))
        })
}

/// The names of the statistics repository and its table.
const STATS_REPO_WORDS: [&str; 7] = [
    "record_events",
    "stat_facts",
    "stat_events",
    "NewStatEvent",
    "StatFact",
    "RecordOutcome",
    "StatCaps",
];

/// Statistics unlock nothing (ST4): the repository is named only by `db/stats.rs` and by the stats routes in
/// `api/stats.rs` (which leave the table's name to `db/`), in `server` and `server-dev` alike. A later reader of the
/// table moves this allow-list on purpose.
#[test]
fn stats_repo_called_only_from_stats_api() {
    let crate_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let mut files = Vec::new();
    let mut failures = Vec::new();
    for root in ["src", "dev/src"] {
        rust_files(&crate_dir.join(root), &mut files, &mut failures);
    }
    let rel = |path: &Path| {
        path.strip_prefix(crate_dir)
            .unwrap_or(path)
            .to_string_lossy()
            .replace('\\', "/")
    };
    let api_words: Vec<&str> = STATS_REPO_WORDS
        .into_iter()
        .filter(|&w| w != "stat_events")
        .collect();
    let mut seen: Vec<(String, &str)> = Vec::new();
    for (path, text) in &files {
        let file = rel(path);
        let allowed: &[&str] = match file.as_str() {
            "src/db/stats.rs" => &STATS_REPO_WORDS,
            "src/api/stats.rs" => &api_words,
            _ => &[],
        };
        for (line, word) in code_identifiers(text).filter(|(_, w)| STATS_REPO_WORDS.contains(w)) {
            if allowed.contains(&word) {
                seen.push((file.clone(), word));
            } else {
                failures.push(format!("{file}:{line}: {word}"));
            }
        }
    }
    for (file, word, what) in [
        (
            "src/db/stats.rs",
            "stat_events",
            "db/stats.rs does not name stat_events",
        ),
        (
            "src/api/stats.rs",
            "record_events",
            "api/stats.rs does not call record_events",
        ),
        (
            "src/api/stats.rs",
            "stat_facts",
            "api/stats.rs does not call stat_facts",
        ),
    ] {
        if !seen.iter().any(|(f, w)| f == file && *w == word) {
            failures.push(what.to_owned());
        }
    }
    if !files.iter().any(|(path, _)| rel(path) == "dev/src/main.rs") {
        failures.push("the scan did not reach dev/src/main.rs".to_owned());
    }
    report(&failures);
}
