//! Statistics (`server/migrations/0003_stats.sql`): the `stat_events` constraints on raw SQL.
//!
//! Every refused case breaks one CHECK, or one whose name sorts before every other it breaks: PostgreSQL tests a
//! table's CHECK constraints in name order, so the constraint a case reports is the one the case is about.

use sqlx::PgConnection;
use sqlx::postgres::PgQueryResult;

use crate::catalog::{ANN, T0, state_with_users};
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
