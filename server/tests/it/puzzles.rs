//! Puzzles (`server/migrations/0002_puzzles.sql`, `0008_puzzle_values.sql`, `db/puzzles.rs`, `puzzles/`,
//! `/api/puzzles`): the schema's constraints on raw SQL, the per-(user, puzzle) attempt window, the server-checked
//! answer, and the hint ladder whose texts are served only for unlocked tiers of a puzzle the user may open
//! (principle 0); the per-player values table's constraints and measured row size (per-player §3.1), and the values
//! domain, its draw and its renderer, held to the shared vectors `tests/fixtures/values/vectors.json` (§3.2).
//!
//! Hint unlock rows are inserted by raw SQL: the server has no writer for them in this lane. `puzzle_values` rows
//! are too: the server writes none until the values routes.

use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::body::Body;
use axum::http::Request;
use axum::http::header::{
    AUTHORIZATION, CACHE_CONTROL, CONTENT_TYPE, HeaderName, RETRY_AFTER, X_CONTENT_TYPE_OPTIONS,
};
use serde::Deserialize;
use serde_json::{Value, json};
use server::AppState;
use server::catalog::ResourceKind;
use server::clock::FixedClock;
use server::db::POOL_MAX_CONNECTIONS;
use server::db::economy::{Entry, Reason, credit_in_tx};
use server::db::puzzles::AttemptRecord;
use server::ids::{PuzzleKey, UserId};
use server::puzzles::values::{
    Domain, DomainError, DomainFile, DrawError, ValueRow, draw, os_rng, render,
};
use server::puzzles::{ATTEMPT_WINDOW_SECS, MAX_ANSWER_LEN};
use sqlx::postgres::PgQueryResult;
use sqlx::{Connection, PgConnection};
use tokio::task::JoinSet;

use crate::catalog::{ANN, T0, bearer, get, own, state_with_users};
use crate::common;
use crate::content::{FIXTURE, FixtureCopy, read_json, renamed_copy, state_on, state_on_db};

/// A second player.
const BEN: i64 = 1002;

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

/// A `puzzle_progress` row; [`progress`] is a valid one for every case to change.
struct Progress<'a> {
    user: i64,
    puzzle: &'a str,
    attempts: i64,
    window_start: i64,
    window_attempts: i64,
    first_at: i64,
    solved_at: Option<i64>,
}

fn progress(user: i64, puzzle: &str) -> Progress<'_> {
    Progress {
        user,
        puzzle,
        attempts: 1,
        window_start: T0,
        window_attempts: 1,
        first_at: T0,
        solved_at: None,
    }
}

async fn insert_progress(c: &mut PgConnection, p: Progress<'_>) -> Res {
    sqlx::query(
        "INSERT INTO puzzle_progress (user_id, puzzle_id, attempts, window_start, window_attempts, first_at, \
         solved_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    )
    .bind(p.user)
    .bind(p.puzzle)
    .bind(p.attempts)
    .bind(p.window_start)
    .bind(p.window_attempts)
    .bind(p.first_at)
    .bind(p.solved_at)
    .execute(&mut *c)
    .await
}

async fn insert_unlock(
    c: &mut PgConnection,
    user: i64,
    puzzle: &str,
    tier: i64,
    unlocked_at: i64,
) -> Res {
    sqlx::query(
        "INSERT INTO hint_unlocks (user_id, puzzle_id, tier, unlocked_at) VALUES ($1, $2, $3, $4)",
    )
    .bind(user)
    .bind(puzzle)
    .bind(tier)
    .bind(unlocked_at)
    .execute(&mut *c)
    .await
}

/// A migrated database with the `users` rows of ANN and BEN, and a raw connection to it.
async fn schema_db() -> (AppState, common::TestDb, PgConnection) {
    let (st, db) = state_with_users(&[ANN, BEN]).await;
    let c = common::raw_db(&st).await;
    (st, db, c)
}

/// One row per (user, puzzle): a second row for the pair is refused; the same user on another puzzle and another
/// user on the same puzzle are not. The user must exist.
#[tokio::test]
async fn schema_puzzle_progress_pk() {
    let (_st, _db, mut c) = schema_db().await;
    let mut failures = Vec::new();
    let results = [
        expect_ok(
            "ANN ch1.drawer",
            insert_progress(&mut c, progress(ANN, "ch1.drawer")).await,
        ),
        expect_err(
            "ANN ch1.drawer again",
            insert_progress(&mut c, progress(ANN, "ch1.drawer")).await,
            ("23505", "puzzle_progress_pkey"),
        ),
        expect_ok(
            "ANN ch2.cabinet",
            insert_progress(&mut c, progress(ANN, "ch2.cabinet")).await,
        ),
        expect_ok(
            "BEN ch1.drawer",
            insert_progress(&mut c, progress(BEN, "ch1.drawer")).await,
        ),
        expect_err(
            "no such user",
            insert_progress(&mut c, progress(4242, "ch1.drawer")).await,
            ("23503", "puzzle_progress_user_fk"),
        ),
    ];
    failures.extend(results.into_iter().filter_map(Result::err));
    report(&failures);
}

/// The window counts at least one attempt and never more than the lifetime count; a row exists only after an
/// attempt; a solve and a window start never precede the first attempt.
#[tokio::test]
async fn schema_puzzle_window_check() {
    let (_st, _db, mut c) = schema_db().await;
    let mut failures = Vec::new();
    let results = [
        expect_ok(
            "window_attempts = attempts",
            insert_progress(
                &mut c,
                Progress {
                    attempts: 3,
                    window_attempts: 3,
                    ..progress(ANN, "ch1.equal")
                },
            )
            .await,
        ),
        expect_err(
            "window_attempts > attempts",
            insert_progress(
                &mut c,
                Progress {
                    attempts: 2,
                    window_attempts: 3,
                    ..progress(ANN, "ch1.over")
                },
            )
            .await,
            ("23514", "puzzle_progress_window_bounded"),
        ),
        expect_err(
            "window_attempts = 0",
            insert_progress(
                &mut c,
                Progress {
                    window_attempts: 0,
                    ..progress(ANN, "ch1.empty")
                },
            )
            .await,
            ("23514", "puzzle_progress_window_bounded"),
        ),
        expect_err(
            "attempts = 0",
            insert_progress(
                &mut c,
                Progress {
                    attempts: 0,
                    ..progress(ANN, "ch1.none")
                },
            )
            .await,
            ("23514", "puzzle_progress_attempts_positive"),
        ),
        expect_err(
            "solved_at < first_at",
            insert_progress(
                &mut c,
                Progress {
                    solved_at: Some(T0 - 1),
                    ..progress(ANN, "ch1.early_solve")
                },
            )
            .await,
            ("23514", "puzzle_progress_solved_after_first"),
        ),
        expect_err(
            "window_start < first_at",
            insert_progress(
                &mut c,
                Progress {
                    window_start: T0 - 1,
                    ..progress(ANN, "ch1.early_window")
                },
            )
            .await,
            ("23514", "puzzle_progress_window_after_first"),
        ),
    ];
    failures.extend(results.into_iter().filter_map(Result::err));
    report(&failures);
}

/// Both tables hold only `PuzzleId` grammar ids (`^ch[1-9][0-9]*[.][a-z][a-z0-9_]*$`), each refused on its own
/// table's CHECK: a looser CHECK on either table (the old GLOB's translation) admits a refused id.
#[tokio::test]
async fn schema_puzzle_id_shape() {
    let (_st, _db, mut c) = schema_db().await;
    let mut failures = Vec::new();
    for id in ["ch1.drawer", "ch12.medal_sun"] {
        failures.extend(
            expect_ok(
                &format!("puzzle_progress {id}"),
                insert_progress(&mut c, progress(ANN, id)).await,
            )
            .err(),
        );
        failures.extend(
            expect_ok(
                &format!("hint_unlocks {id}"),
                insert_unlock(&mut c, ANN, id, 1, T0).await,
            )
            .err(),
        );
    }
    for id in [
        "ch0.a",
        "ch1x.a",
        "ch1.a.b",
        "ch1.a-b",
        "ch1.Drawer",
        "ch1.1a",
        "ch1.",
        "ch1.é",
    ] {
        failures.extend(
            expect_err(
                &format!("puzzle_progress {id}"),
                insert_progress(&mut c, progress(ANN, id)).await,
                ("23514", "puzzle_progress_id_shape"),
            )
            .err(),
        );
        failures.extend(
            expect_err(
                &format!("hint_unlocks {id}"),
                insert_unlock(&mut c, ANN, id, 1, T0).await,
                ("23514", "hint_unlocks_id_shape"),
            )
            .err(),
        );
    }
    report(&failures);
}

/// One unlock per (user, puzzle, tier): a duplicate is refused, another tier of the same puzzle is not. The user
/// must exist.
#[tokio::test]
async fn schema_hint_unlocks_pk() {
    let (_st, _db, mut c) = schema_db().await;
    let mut failures = Vec::new();
    let results = [
        expect_ok(
            "ANN ch1.drawer tier 1",
            insert_unlock(&mut c, ANN, "ch1.drawer", 1, T0).await,
        ),
        expect_err(
            "ANN ch1.drawer tier 1 again",
            insert_unlock(&mut c, ANN, "ch1.drawer", 1, T0).await,
            ("23505", "hint_unlocks_pkey"),
        ),
        expect_ok(
            "ANN ch1.drawer tier 2",
            insert_unlock(&mut c, ANN, "ch1.drawer", 2, T0).await,
        ),
        expect_err(
            "no such user",
            insert_unlock(&mut c, 4242, "ch1.drawer", 1, T0).await,
            ("23503", "hint_unlocks_user_fk"),
        ),
    ];
    failures.extend(results.into_iter().filter_map(Result::err));
    report(&failures);
}

/// A tier is 1, 2 or 3 (PUZZLES-PLAN X18), and an unlock carries a real time.
#[tokio::test]
async fn schema_hint_unlocks_tier_range() {
    let (_st, _db, mut c) = schema_db().await;
    let mut failures = Vec::new();
    let results = [
        expect_ok(
            "tier 1",
            insert_unlock(&mut c, ANN, "ch1.drawer", 1, T0).await,
        ),
        expect_ok(
            "tier 3",
            insert_unlock(&mut c, ANN, "ch1.drawer", 3, T0).await,
        ),
        expect_err(
            "tier 0",
            insert_unlock(&mut c, ANN, "ch1.drawer", 0, T0).await,
            ("23514", "hint_unlocks_tier_range"),
        ),
        expect_err(
            "tier 4",
            insert_unlock(&mut c, ANN, "ch1.drawer", 4, T0).await,
            ("23514", "hint_unlocks_tier_range"),
        ),
        expect_err(
            "unlocked_at = 0",
            insert_unlock(&mut c, ANN, "ch1.drawer", 2, 0).await,
            ("23514", "hint_unlocks_time_positive"),
        ),
    ];
    failures.extend(results.into_iter().filter_map(Result::err));
    report(&failures);
}

/// The domain hash of `[0, 9]^4` without `[0, 0, 0, 0]` (per-player §3.2's encoding, from an independent oracle).
const DOMAIN_HASH: &str = "bd058b756eb7a107";

/// A `puzzle_values` row as raw SQL writes it; [`value_row`] is a valid one for every case to change. `value` is SQL
/// array text, cast in the statement, so a case can send what no Rust type holds (two dimensions, a NULL entry).
struct ValueSql<'a> {
    user: i64,
    puzzle: &'a str,
    run: i64,
    wrong: i64,
    issued_at: i64,
    spent_at: Option<i64>,
    domain: &'a str,
    value: String,
}

fn value_row(user: i64, puzzle: &str) -> ValueSql<'_> {
    ValueSql {
        user,
        puzzle,
        run: 1,
        wrong: 0,
        issued_at: T0,
        spent_at: None,
        domain: DOMAIN_HASH,
        value: "{1,8,4,7}".to_owned(),
    }
}

async fn insert_value(c: &mut PgConnection, v: ValueSql<'_>) -> Res {
    sqlx::query(
        "INSERT INTO puzzle_values (user_id, run, wrong, issued_at, spent_at, puzzle_id, domain, value) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::text::bigint[])",
    )
    .bind(v.user)
    .bind(v.run)
    .bind(v.wrong)
    .bind(v.issued_at)
    .bind(v.spent_at)
    .bind(v.puzzle)
    .bind(v.domain)
    .bind(v.value)
    .execute(&mut *c)
    .await
}

/// `n` entries of `entry` as SQL array text.
fn array_of(n: usize, entry: &str) -> String {
    format!("{{{}}}", vec![entry; n].join(","))
}

/// One value per (user, puzzle): a second row for the pair is refused; the same user on another puzzle and another
/// user on the same puzzle are not. The user must exist. `ON CONFLICT (user_id, puzzle_id) DO NOTHING`, the
/// insert-if-absent arbiter (per-player §3.1), writes nothing over a stored value.
#[tokio::test]
async fn schema_puzzle_values_pk() {
    let (_st, _db, mut c) = schema_db().await;
    let mut failures = Vec::new();
    let results = [
        expect_ok(
            "ANN ch1.drawer",
            insert_value(&mut c, value_row(ANN, "ch1.drawer")).await,
        ),
        expect_err(
            "ANN ch1.drawer again",
            insert_value(&mut c, value_row(ANN, "ch1.drawer")).await,
            ("23505", "puzzle_values_pkey"),
        ),
        expect_ok(
            "ANN ch1.cabinet",
            insert_value(&mut c, value_row(ANN, "ch1.cabinet")).await,
        ),
        expect_ok(
            "BEN ch1.drawer",
            insert_value(&mut c, value_row(BEN, "ch1.drawer")).await,
        ),
        expect_err(
            "no such user",
            insert_value(&mut c, value_row(999, "ch1.drawer")).await,
            ("23503", "puzzle_values_user_fk"),
        ),
    ];
    failures.extend(results.into_iter().filter_map(Result::err));
    let arbiter = sqlx::query(
        "INSERT INTO puzzle_values (user_id, run, wrong, issued_at, spent_at, puzzle_id, domain, value) \
         VALUES ($1, 1, 0, $2, NULL, 'ch1.drawer', $3, '{9,9,9,9}') ON CONFLICT (user_id, puzzle_id) DO NOTHING",
    )
    .bind(ANN)
    .bind(T0 + 5)
    .bind(DOMAIN_HASH)
    .execute(&mut c)
    .await;
    match arbiter {
        Ok(done) if done.rows_affected() == 0 => {}
        Ok(done) => failures.push(format!(
            "arbiter on ANN ch1.drawer: expected 0 rows, got {}",
            done.rows_affected()
        )),
        Err(e) => failures.push(format!(
            "arbiter on ANN ch1.drawer: expected 0 rows, got {}",
            describe(&e)
        )),
    }
    let stored: Result<Vec<i64>, sqlx::Error> = sqlx::query_scalar(
        "SELECT value FROM puzzle_values WHERE user_id = $1 AND puzzle_id = 'ch1.drawer'",
    )
    .bind(ANN)
    .fetch_one(&mut c)
    .await;
    match stored {
        Ok(value) if value == [1, 8, 4, 7] => {}
        Ok(value) => failures.push(format!(
            "ANN ch1.drawer after the arbiter: expected [1, 8, 4, 7], got {value:?}"
        )),
        Err(e) => failures.push(format!(
            "ANN ch1.drawer after the arbiter: expected [1, 8, 4, 7], got {}",
            describe(&e)
        )),
    }
    report(&failures);
}

/// Each CHECK of `puzzle_values` (per-player §3.1) refuses its own violation, by (23514, constraint), and allows the
/// boundary beside it: the `PuzzleId` grammar; a 16-hex lower-case domain hash; a one-dimensional value of 1..64
/// entries with no NULL, each a u16; a run from 1; wrong answers from 0; a spend never before the draw; a real draw
/// time. The length bound is built from `MAX_ANSWER_LEN`: the CHECK's 64 and the cap are one bound, so moving
/// either alone reds a case here.
#[tokio::test]
async fn schema_puzzle_values_checks() {
    let (_st, _db, mut c) = schema_db().await;
    let mut failures = Vec::new();
    let refused = [
        (
            "id Ch1.drawer",
            value_row(ANN, "Ch1.drawer"),
            "puzzle_values_id_shape",
        ),
        (
            "id ch1.a-b",
            value_row(ANN, "ch1.a-b"),
            "puzzle_values_id_shape",
        ),
        (
            "domain in upper-case hex",
            ValueSql {
                domain: "BD058B756EB7A107",
                ..value_row(ANN, "ch1.d_upper")
            },
            "puzzle_values_domain_shape",
        ),
        (
            "domain of 15 hex",
            ValueSql {
                domain: "bd058b756eb7a10",
                ..value_row(ANN, "ch1.d_short")
            },
            "puzzle_values_domain_shape",
        ),
        (
            "domain of 17 hex",
            ValueSql {
                domain: "bd058b756eb7a1070",
                ..value_row(ANN, "ch1.d_long")
            },
            "puzzle_values_domain_shape",
        ),
        (
            "value {}",
            ValueSql {
                value: "{}".to_owned(),
                ..value_row(ANN, "ch1.v_empty")
            },
            "puzzle_values_value_shape",
        ),
        (
            "value of MAX_ANSWER_LEN + 1 entries",
            ValueSql {
                value: array_of(MAX_ANSWER_LEN + 1, "1"),
                ..value_row(ANN, "ch1.v_long")
            },
            "puzzle_values_value_shape",
        ),
        (
            "value in two dimensions",
            ValueSql {
                value: "{{1,2},{3,4}}".to_owned(),
                ..value_row(ANN, "ch1.v_grid")
            },
            "puzzle_values_value_shape",
        ),
        (
            "value with a NULL entry",
            ValueSql {
                value: "{1,NULL,3}".to_owned(),
                ..value_row(ANN, "ch1.v_null")
            },
            "puzzle_values_value_shape",
        ),
        (
            "entry 65536",
            ValueSql {
                value: "{1,65536,4,7}".to_owned(),
                ..value_row(ANN, "ch1.v_big")
            },
            "puzzle_values_value_range",
        ),
        (
            "entry -1",
            ValueSql {
                value: "{1,-1,4,7}".to_owned(),
                ..value_row(ANN, "ch1.v_negative")
            },
            "puzzle_values_value_range",
        ),
        (
            "run 0",
            ValueSql {
                run: 0,
                ..value_row(ANN, "ch1.run_zero")
            },
            "puzzle_values_run_positive",
        ),
        (
            "wrong -1",
            ValueSql {
                wrong: -1,
                ..value_row(ANN, "ch1.wrong_negative")
            },
            "puzzle_values_wrong_nonneg",
        ),
        (
            "spent_at = issued_at - 1",
            ValueSql {
                spent_at: Some(T0 - 1),
                ..value_row(ANN, "ch1.spent_early")
            },
            "puzzle_values_spent_after",
        ),
        (
            "issued_at 0",
            ValueSql {
                issued_at: 0,
                ..value_row(ANN, "ch1.issued_zero")
            },
            "puzzle_values_time_positive",
        ),
    ];
    for (case, row, constraint) in refused {
        failures
            .extend(expect_err(case, insert_value(&mut c, row).await, ("23514", constraint)).err());
    }
    let allowed = [
        (
            "value of MAX_ANSWER_LEN entries",
            ValueSql {
                value: array_of(MAX_ANSWER_LEN, "1"),
                ..value_row(ANN, "ch1.c_long")
            },
        ),
        (
            "entries 0 and 65535",
            ValueSql {
                value: "{0,65535}".to_owned(),
                ..value_row(ANN, "ch1.c_range")
            },
        ),
        (
            "run 1, wrong 0",
            ValueSql {
                run: 1,
                wrong: 0,
                ..value_row(ANN, "ch1.c_counts")
            },
        ),
        (
            "spent_at = issued_at",
            ValueSql {
                spent_at: Some(T0),
                ..value_row(ANN, "ch1.c_spent")
            },
        ),
        (
            "issued_at 1",
            ValueSql {
                issued_at: 1,
                ..value_row(ANN, "ch1.c_issued")
            },
        ),
    ];
    for (case, row) in allowed {
        failures.extend(expect_ok(case, insert_value(&mut c, row).await).err());
    }
    report(&failures);
}

/// R12, measured (per-player §3.1): 1,000 users with one four-entry value each, inserted in key order and vacuumed,
/// take at most 256 B per row of `puzzle_values`, heap and primary key together (the arithmetic estimate is ~212 B).
/// The figure is printed (`--nocapture`).
#[tokio::test]
async fn values_row_size_measured() {
    let (st, _db) = common::test_state().await;
    let mut c = common::raw_db(&st).await;
    sqlx::query(
        "INSERT INTO users (id, first_name, created_at, last_seen_at) \
         SELECT g, 'Ann', $1, $1 FROM generate_series(1, 1000) g",
    )
    .bind(T0)
    .execute(&mut c)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO puzzle_values (user_id, run, wrong, issued_at, spent_at, puzzle_id, domain, value) \
         SELECT g, 1, 0, $1, NULL, 'ch1.drawer', $2, '{1,8,4,7}' FROM generate_series(1, 1000) g ORDER BY g",
    )
    .bind(T0)
    .bind(DOMAIN_HASH)
    .execute(&mut c)
    .await
    .unwrap();
    sqlx::raw_sql("VACUUM (ANALYZE) puzzle_values")
        .execute(&mut c)
        .await
        .unwrap();
    let (heap, index): (i64, i64) = sqlx::query_as(
        "SELECT pg_relation_size('puzzle_values'), pg_indexes_size('puzzle_values')",
    )
    .fetch_one(&mut c)
    .await
    .unwrap();
    c.close().await.unwrap();
    let per_row = (heap + index) / 1000;
    println!(
        "puzzle_values: {per_row} B per row (heap {heap} B + primary key {index} B, 1,000 four-entry rows)"
    );
    assert!(
        per_row <= 256,
        "puzzle_values: expected at most 256 B per row, got {per_row} (heap {heap} B, primary key {index} B)"
    );
}

/// `puzzle_progress`'s counters of (user, puzzle), read on a raw connection: (attempts, window_attempts,
/// window_start, solved_at), or `None` without a row.
async fn progress_row(
    st: &AppState,
    user: i64,
    puzzle: &str,
) -> Option<(i64, i64, i64, Option<i64>)> {
    let mut c = common::raw_db(st).await;
    let row = sqlx::query_as(
        "SELECT attempts, window_attempts, window_start, solved_at FROM puzzle_progress \
         WHERE user_id = $1 AND puzzle_id = $2",
    )
    .bind(user)
    .bind(puzzle)
    .fetch_optional(&mut c)
    .await
    .unwrap();
    c.close().await.unwrap();
    row
}

/// The storage key of the puzzle `id` names: key = id for a puzzle never renamed (per-player §3.8).
fn pid(id: &str) -> PuzzleKey {
    PuzzleKey::parse(id).unwrap()
}

/// An attempt in the window, answered: not limited, no retry time.
const OPEN: AttemptRecord = AttemptRecord {
    limited: false,
    retry_after_secs: 0,
    solved: false,
};

/// The 21st attempt in a window is limited until the window ends; the count is per (user, puzzle).
#[tokio::test]
async fn attempt_rate_limited_after_20_in_window() {
    let (st, _db) = state_with_users(&[ANN, BEN]).await;
    let drawer = pid("ch1.drawer");
    let mut failures = Vec::new();
    for call in 1..=20 {
        let got = st
            .repo
            .record_attempt(UserId(ANN), &drawer, false, T0)
            .await
            .unwrap();
        if got != OPEN {
            failures.push(format!("call {call}: expected {OPEN:?}, got {got:?}"));
        }
    }
    let got = st
        .repo
        .record_attempt(UserId(ANN), &drawer, false, T0)
        .await
        .unwrap();
    let want = AttemptRecord {
        limited: true,
        retry_after_secs: ATTEMPT_WINDOW_SECS,
        solved: false,
    };
    if got != want {
        failures.push(format!("call 21: expected {want:?}, got {got:?}"));
    }
    let row = progress_row(&st, ANN, "ch1.drawer").await;
    if row != Some((21, 21, T0, None)) {
        failures.push(format!(
            "row after 21: expected (attempts 21, window 21, start T0, unsolved), got {row:?}"
        ));
    }
    for (case, user, puzzle) in [
        ("ANN on ch2.cabinet", ANN, "ch2.cabinet"),
        ("BEN on ch1.drawer", BEN, "ch1.drawer"),
    ] {
        let got = st
            .repo
            .record_attempt(UserId(user), &pid(puzzle), false, T0)
            .await
            .unwrap();
        if got != OPEN {
            failures.push(format!("{case}: expected {OPEN:?}, got {got:?}"));
        }
    }
    report(&failures);
}

/// The window ends 600 s after it began: one second before, the attempt is still limited (retry in 1 s); at 600 s a
/// new window starts with this attempt.
#[tokio::test]
async fn attempt_window_resets_after_600s() {
    let (st, _db) = state_with_users(&[ANN]).await;
    let drawer = pid("ch1.drawer");
    let mut failures = Vec::new();
    for _ in 0..20 {
        st.repo
            .record_attempt(UserId(ANN), &drawer, false, T0)
            .await
            .unwrap();
    }
    let got = st
        .repo
        .record_attempt(UserId(ANN), &drawer, false, T0 + 599)
        .await
        .unwrap();
    let want = AttemptRecord {
        limited: true,
        retry_after_secs: 1,
        solved: false,
    };
    if got != want {
        failures.push(format!("T0+599: expected {want:?}, got {got:?}"));
    }
    let got = st
        .repo
        .record_attempt(UserId(ANN), &drawer, false, T0 + 600)
        .await
        .unwrap();
    if got != OPEN {
        failures.push(format!("T0+600: expected {OPEN:?}, got {got:?}"));
    }
    let row = progress_row(&st, ANN, "ch1.drawer").await;
    if row != Some((22, 1, T0 + 600, None)) {
        failures.push(format!(
            "row at T0+600: expected (attempts 22, window 1, start T0+600, unsolved), got {row:?}"
        ));
    }
    report(&failures);
}

/// Polls on `c` (autocommit, every 10 ms) until `want` app-pool sessions wait for a lock, or `within` passes; returns
/// the count seen last. `pg_stat_activity` is a snapshot per transaction, so each poll is its own.
async fn lock_waiters(c: &mut PgConnection, want: i64, within: Duration) -> i64 {
    let deadline = Instant::now() + within;
    loop {
        let seen: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock' \
             AND datname = current_database() AND application_name = 'tg-novel-server'",
        )
        .fetch_one(&mut *c)
        .await
        .unwrap();
        if seen >= want || Instant::now() >= deadline {
            return seen;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
}

/// 25 attempts of (`user`, ch1.drawer) at `T0`, all started while `held` blocks the pair's row on a raw transaction,
/// then `release` (`COMMIT` or `ROLLBACK`) once the app's sessions wait on it. Returns the (open, limited) counts, the
/// lock waiters seen at the release, and the failures of single calls.
async fn collide(
    st: &AppState,
    user: i64,
    held: &'static str,
    release: &'static str,
) -> (usize, usize, i64, Vec<String>) {
    let mut holder = common::raw_db(st).await;
    let mut poll = common::raw_db(st).await;
    sqlx::raw_sql("BEGIN ISOLATION LEVEL READ COMMITTED")
        .execute(&mut holder)
        .await
        .unwrap();
    sqlx::query(held)
        .bind(user)
        .bind(T0)
        .execute(&mut holder)
        .await
        .unwrap();
    let mut tasks = JoinSet::new();
    for _ in 0..25 {
        let repo = st.repo.clone();
        tasks.spawn(async move {
            repo.record_attempt(UserId(user), &pid("ch1.drawer"), false, T0)
                .await
        });
    }
    // Every pool connection blocked on the held row, well inside the app's 2 s `lock_timeout`.
    let pool = i64::from(POOL_MAX_CONNECTIONS);
    let waiters = lock_waiters(&mut poll, pool, Duration::from_millis(1500)).await;
    sqlx::raw_sql(release).execute(&mut holder).await.unwrap();
    let (mut open, mut limited, mut errors) = (0, 0, Vec::new());
    while let Some(joined) = tasks.join_next().await {
        match joined.unwrap() {
            Ok(record) if record.limited => {
                limited += 1;
                if record.retry_after_secs != ATTEMPT_WINDOW_SECS {
                    errors.push(format!(
                        "limited record: expected retry 600, got {record:?}"
                    ));
                }
            }
            Ok(_) => open += 1,
            Err(e) => errors.push(format!("record_attempt: {}", describe(&e))),
        }
    }
    holder.close().await.unwrap();
    poll.close().await.unwrap();
    (open, limited, waiters, errors)
}

/// Concurrent attempts count exactly (PUZZLES-PLAN "Two concurrent attempts serialize"), forced to collide: the
/// app's sessions all wait on a raw transaction, then race at once. First on a fresh pair (the held row is an
/// uncommitted insert, rolled back: the first-ever-pair insert race), then on an existing row (held `FOR UPDATE`, then
/// committed). A read-then-write count without the row lock loses updates here and admits more than 20.
#[tokio::test]
async fn attempt_concurrent_window_exact() {
    let (st, _db) = state_with_users(&[ANN, BEN]).await;
    let mut failures = Vec::new();

    let (open, limited, waiters, errors) = collide(
        &st,
        ANN,
        "INSERT INTO puzzle_progress (user_id, puzzle_id, attempts, window_start, window_attempts, first_at, \
         solved_at) VALUES ($1, 'ch1.drawer', 1, $2, 1, $2, NULL)",
        "ROLLBACK",
    )
    .await;
    failures.extend(errors);
    if waiters < 2 {
        failures.push(format!(
            "fresh pair: expected at least 2 attempts waiting on the held insert, got {waiters}"
        ));
    }
    if (open, limited) != (20, 5) {
        failures.push(format!(
            "fresh pair: expected 20 open and 5 limited, got {open} and {limited} ({waiters} waited)"
        ));
    }
    let row = progress_row(&st, ANN, "ch1.drawer").await;
    if row != Some((25, 25, T0, None)) {
        failures.push(format!(
            "fresh pair row: expected (attempts 25, window 25, start T0, unsolved), got {row:?}"
        ));
    }

    // BEN's pair exists with one attempt in the window before the collision.
    st.repo
        .record_attempt(UserId(BEN), &pid("ch1.drawer"), false, T0)
        .await
        .unwrap();
    let (open, limited, waiters, errors) = collide(
        &st,
        BEN,
        "SELECT 1 FROM puzzle_progress WHERE user_id = $1 AND puzzle_id = 'ch1.drawer' AND window_start = $2 \
         FOR UPDATE",
        "COMMIT",
    )
    .await;
    failures.extend(errors);
    if waiters < 2 {
        failures.push(format!(
            "existing row: expected at least 2 attempts waiting on the held row, got {waiters}"
        ));
    }
    if (open, limited) != (19, 6) {
        failures.push(format!(
            "existing row: expected 19 open and 6 limited, got {open} and {limited} ({waiters} waited)"
        ));
    }
    let row = progress_row(&st, BEN, "ch1.drawer").await;
    if row != Some((26, 26, T0, None)) {
        failures.push(format!(
            "existing row: expected (attempts 26, window 26, start T0, unsolved), got {row:?}"
        ));
    }
    report(&failures);
}

/// `POST /api/puzzles/{id}/attempts` as `user` with `body` sent as `application/json`.
async fn post_attempt(st: &AppState, user: i64, id: &str, body: &str) -> common::Reply {
    let req = Request::post(format!("/api/puzzles/{id}/attempts"))
        .header(AUTHORIZATION, bearer(st, user))
        .header(CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_owned()))
        .unwrap();
    common::call(st, req).await
}

fn body_text(reply: &common::Reply) -> String {
    String::from_utf8_lossy(&reply.body).into_owned()
}

/// The mismatch of `reply` against `status` with exactly the body `body`.
fn expect_reply(case: &str, reply: &common::Reply, status: u16, body: &str) -> Option<String> {
    let got = body_text(reply);
    (reply.status.as_u16() != status || got != body).then(|| {
        format!(
            "{case}: expected {status} {body}, got {} {got:?}",
            reply.status.as_u16()
        )
    })
}

/// The mismatch of `reply` against `status` with exactly the error body of `code`.
fn expect_error(case: &str, reply: &common::Reply, status: u16, code: &str) -> Option<String> {
    expect_reply(case, reply, status, &format!(r#"{{"error":"{code}"}}"#))
}

/// The header `name` of `reply` as text.
fn header(reply: &common::Reply, name: HeaderName) -> Option<&str> {
    reply.headers.get(name).and_then(|v| v.to_str().ok())
}

const SOLUTION: &str = r#"{"answer":[1,8,4,7]}"#;
const WRONG: &str = r#"{"answer":[0,0,0,0]}"#;

/// A correct answer solves the puzzle once: a second correct answer keeps the first solve's time, and a wrong one
/// after it is wrong but solved.
#[tokio::test]
async fn attempt_correct_marks_solved() {
    let (st, _db) = state_with_users(&[ANN]).await;
    let mut failures = Vec::new();
    let reply = post_attempt(&st, ANN, "ch1.drawer", SOLUTION).await;
    failures.extend(expect_reply(
        "correct at T0",
        &reply,
        200,
        r#"{"correct":true,"solved":true}"#,
    ));
    let solved_at = progress_row(&st, ANN, "ch1.drawer").await.map(|r| r.3);
    if solved_at != Some(Some(T0)) {
        failures.push(format!(
            "after T0: expected solved_at T0, got {solved_at:?}"
        ));
    }
    let later = st.clone().with_clock(Arc::new(FixedClock(T0 + 10)));
    let reply = post_attempt(&later, ANN, "ch1.drawer", SOLUTION).await;
    failures.extend(expect_reply(
        "correct again at T0+10",
        &reply,
        200,
        r#"{"correct":true,"solved":true}"#,
    ));
    let solved_at = progress_row(&st, ANN, "ch1.drawer").await.map(|r| r.3);
    if solved_at != Some(Some(T0)) {
        failures.push(format!(
            "after T0+10: expected solved_at still T0, got {solved_at:?}"
        ));
    }
    let later = st.clone().with_clock(Arc::new(FixedClock(T0 + 20)));
    let reply = post_attempt(&later, ANN, "ch1.drawer", WRONG).await;
    failures.extend(expect_reply(
        "wrong at T0+20",
        &reply,
        200,
        r#"{"correct":false,"solved":true}"#,
    ));
    report(&failures);
}

/// A wrong answer is counted and leaves the puzzle unsolved.
#[tokio::test]
async fn attempt_wrong_returns_false() {
    let (st, _db) = state_with_users(&[ANN]).await;
    let mut failures = Vec::new();
    let reply = post_attempt(&st, ANN, "ch1.drawer", WRONG).await;
    failures.extend(expect_reply(
        "wrong",
        &reply,
        200,
        r#"{"correct":false,"solved":false}"#,
    ));
    let row = progress_row(&st, ANN, "ch1.drawer").await;
    if row != Some((1, 1, T0, None)) {
        failures.push(format!(
            "row: expected (attempts 1, window 1, start T0, unsolved), got {row:?}"
        ));
    }
    report(&failures);
}

/// A malformed id, a body that is not an answer, and an answer outside the puzzle's shape (`answerLen` 4,
/// `answerMax` 9, at most 64 entries) are each 400 `bad_request`, and none is counted.
#[tokio::test]
async fn attempt_wrong_shape_400() {
    let (st, _db) = state_with_users(&[ANN]).await;
    let mut failures = Vec::new();
    for id in ["Ch1.drawer", "ch1.Drawer", "ch1.a-b"] {
        let reply = post_attempt(&st, ANN, id, WRONG).await;
        failures.extend(expect_error(
            &format!("id {id}"),
            &reply,
            400,
            "bad_request",
        ));
    }
    let seventeen = format!(r#"{{"answer":[{}]}}"#, ["0"; 17].join(","));
    for body in [
        r#"{"answer":[1,8,4]}"#,
        r#"{"answer":[1,8,4,7,0]}"#,
        r#"{"answer":[1,8,4,10]}"#,
        r#"{"answer":[1,8,4,-1]}"#,
        r#"{"answer":[1,8,4,65536]}"#,
        r#"{"answer":[1.5,8,4,7]}"#,
        seventeen.as_str(),
        "{}",
        "not json",
    ] {
        let reply = post_attempt(&st, ANN, "ch1.drawer", body).await;
        failures.extend(expect_error(
            &format!("body {body}"),
            &reply,
            400,
            "bad_request",
        ));
    }
    let row = progress_row(&st, ANN, "ch1.drawer").await;
    if row.is_some() {
        failures.push(format!("after the 400s: expected no row, got {row:?}"));
    }
    let reply = post_attempt(&st, ANN, "ch1.drawer", WRONG).await;
    failures.extend(expect_reply(
        "control: a well-formed wrong answer",
        &reply,
        200,
        r#"{"correct":false,"solved":false}"#,
    ));
    let row = progress_row(&st, ANN, "ch1.drawer").await.map(|r| r.0);
    if row != Some(1) {
        failures.push(format!("control: expected attempts 1, got {row:?}"));
    }
    report(&failures);
}

/// A copy of the fixture whose `ch1.drawer` takes 64 entries (`answerLen` 64, `answerMax` 9; the solution is
/// `[1, 8, 4, 7]` 16 times), and that solution.
async fn long_drawer_copy() -> (FixtureCopy, Vec<u16>) {
    let solution = [1u16, 8, 4, 7].repeat(16);
    let copy = FixtureCopy::new();
    copy.edit_json("puzzles/ch1.json", |v| {
        let drawer = &mut v["puzzles"]["drawer"];
        drawer["answerLen"] = json!(64);
        drawer["solution"] = json!(solution);
    })
    .await;
    (copy, solution)
}

/// `{"answer": answer}` as a request body.
fn answer_body(answer: &[u16]) -> String {
    json!({ "answer": answer }).to_string()
}

/// `st` on `copy` at `T0` with ANN's `users` row.
async fn state_with_ann_on(copy: &FixtureCopy) -> (AppState, common::TestDb) {
    let (started, db) = state_on(copy.path()).await;
    match started {
        Ok(st) => (at_t0_with_users(st, &[ANN]).await, db),
        Err(e) => panic!("the 64-entry copy: expected Ok, got {e}"),
    }
}

/// An answer takes up to `MAX_ANSWER_LEN` = 64 entries (per-player §3.3; engine R-E12): the 64-entry solution of a
/// 64-entry puzzle solves it.
#[tokio::test]
async fn attempt_answer_len_64_accepted() {
    let (copy, solution) = long_drawer_copy().await;
    let (st, _db) = state_with_ann_on(&copy).await;
    let mut failures = Vec::new();
    let reply = post_attempt(&st, ANN, "ch1.drawer", &answer_body(&solution)).await;
    failures.extend(expect_reply(
        "64 entries",
        &reply,
        200,
        r#"{"correct":true,"solved":true}"#,
    ));
    let row = progress_row(&st, ANN, "ch1.drawer").await;
    if row != Some((1, 1, T0, Some(T0))) {
        failures.push(format!(
            "64 entries: expected (attempts 1, window 1, start T0, solved at T0), got {row:?}"
        ));
    }
    report(&failures);
}

/// One entry more than the 64-entry puzzle takes is 400 `bad_request`, and it is not counted.
#[tokio::test]
async fn attempt_answer_len_65_400() {
    let (copy, solution) = long_drawer_copy().await;
    let (st, _db) = state_with_ann_on(&copy).await;
    let mut failures = Vec::new();
    let mut answer = solution;
    answer.push(1);
    let reply = post_attempt(&st, ANN, "ch1.drawer", &answer_body(&answer)).await;
    failures.extend(expect_error("65 entries", &reply, 400, "bad_request"));
    let row = progress_row(&st, ANN, "ch1.drawer").await;
    if row.is_some() {
        failures.push(format!("65 entries: expected no row, got {row:?}"));
    }
    report(&failures);
}

/// A paid chapter's puzzle answers 403 to a user without the chapter, before the body is read and without a row;
/// the chapter's owner gets the check, and every user gets a free chapter's puzzle.
#[tokio::test]
async fn attempt_paid_chapter_403_without_entitlement() {
    let (st, _db) = state_with_users(&[ANN, BEN]).await;
    own(&st, BEN, "chapter:ch2").await;
    let mut failures = Vec::new();
    let reply = post_attempt(&st, ANN, "ch2.cabinet", r#"{"answer":[2,0,1]}"#).await;
    failures.extend(expect_error(
        "ANN, ch2.cabinet, the solution",
        &reply,
        403,
        "not_entitled",
    ));
    let reply = post_attempt(&st, ANN, "ch2.cabinet", "not json").await;
    failures.extend(expect_error(
        "ANN, ch2.cabinet, a malformed body",
        &reply,
        403,
        "not_entitled",
    ));
    let row = progress_row(&st, ANN, "ch2.cabinet").await;
    if row.is_some() {
        failures.push(format!("ANN on ch2.cabinet: expected no row, got {row:?}"));
    }
    let reply = post_attempt(&st, BEN, "ch2.cabinet", r#"{"answer":[2,0,1]}"#).await;
    failures.extend(expect_reply(
        "BEN owns chapter:ch2",
        &reply,
        200,
        r#"{"correct":true,"solved":true}"#,
    ));
    let reply = post_attempt(&st, ANN, "ch1.drawer", WRONG).await;
    failures.extend(expect_reply(
        "ANN, free ch1.drawer",
        &reply,
        200,
        r#"{"correct":false,"solved":false}"#,
    ));
    report(&failures);
}

/// An id of the grammar that the content does not hold is 404 with the error body, never the router's empty 404.
#[tokio::test]
async fn attempt_unknown_puzzle_404() {
    let (st, _db) = state_with_users(&[ANN]).await;
    let mut failures = Vec::new();
    for id in ["ch1.nothing", "ch3.drawer", "ch9.drawer"] {
        let reply = post_attempt(&st, ANN, id, WRONG).await;
        failures.extend(expect_error(id, &reply, 404, "not_found"));
    }
    report(&failures);
}

/// Past the window's 20 attempts even the solution is 429 with `Retry-After`, and the puzzle stays unsolved: the
/// answer is used only after the window.
#[tokio::test]
async fn attempt_limited_correct_answer_429_not_solved() {
    let (st, _db) = state_with_users(&[ANN]).await;
    let mut failures = Vec::new();
    for call in 1..=20 {
        let reply = post_attempt(&st, ANN, "ch1.drawer", WRONG).await;
        failures.extend(expect_reply(
            &format!("wrong {call}"),
            &reply,
            200,
            r#"{"correct":false,"solved":false}"#,
        ));
    }
    let reply = post_attempt(&st, ANN, "ch1.drawer", SOLUTION).await;
    failures.extend(expect_error(
        "the solution as attempt 21",
        &reply,
        429,
        "rate_limited",
    ));
    let retry = header(&reply, RETRY_AFTER);
    if retry != Some("600") {
        failures.push(format!("Retry-After: expected 600, got {retry:?}"));
    }
    let row = progress_row(&st, ANN, "ch1.drawer").await;
    if row != Some((21, 21, T0, None)) {
        failures.push(format!(
            "row: expected (attempts 21, window 21, start T0, unsolved), got {row:?}"
        ));
    }
    report(&failures);
}

/// Inserts `user`'s unlock of `puzzle`'s `tier` as a raw row: the server's only writer is a later lane's spend.
async fn unlock(st: &AppState, user: i64, puzzle: &str, tier: i64) {
    let mut c = common::raw_db(st).await;
    insert_unlock(&mut c, user, puzzle, tier, T0).await.unwrap();
    c.close().await.unwrap();
}

/// The exact wire text of a status: `puzzleId`, `solved`, then one hint per tier (tier 1 first) that is unlocked
/// with its text when `tiers` holds one, locked with `null` otherwise.
fn status_body(id: &str, solved: bool, tiers: &[Option<&str>]) -> String {
    let hints: Vec<String> = tiers
        .iter()
        .zip(1..)
        .map(|(text, tier): (&Option<&str>, u8)| {
            let wire = text.map_or("null".to_owned(), |t| serde_json::to_string(t).unwrap());
            format!(
                r#"{{"tier":{tier},"unlocked":{},"text":{wire}}}"#,
                text.is_some()
            )
        })
        .collect();
    format!(
        r#"{{"puzzleId":"{id}","solved":{solved},"hints":[{}]}}"#,
        hints.join(",")
    )
}

/// The fixture's ch1.drawer hint texts: (ru, en) per tier.
const DRAWER_HINTS: [(&str, &str); 3] = [
    (
        "Цифры спрятаны в комнате.",
        "The digits are hidden in the room.",
    ),
    (
        "Посмотрите на часы и календарь.",
        "Look at the clock and the calendar.",
    ),
    (
        "Код начинается с года на портрете.",
        "The code starts with the year on the portrait.",
    ),
];

/// A hint's text is served only for a tier with an unlock row, in the language asked for; the status carries every
/// tier of the ladder and never the solution. `lang` is required and is `ru` or `en`.
#[tokio::test]
async fn puzzle_hint_text_only_when_unlocked() {
    let (st, _db) = state_with_users(&[ANN, BEN]).await;
    unlock(&st, ANN, "ch1.drawer", 1).await;
    let mut failures = Vec::new();
    for (lang, text) in [("en", DRAWER_HINTS[0].1), ("ru", DRAWER_HINTS[0].0)] {
        let reply = get(
            &st,
            Some(ANN),
            &format!("/api/puzzles/ch1.drawer?lang={lang}"),
        )
        .await;
        failures.extend(expect_reply(
            &format!("ANN, tier 1 unlocked, lang {lang}"),
            &reply,
            200,
            &status_body("ch1.drawer", false, &[Some(text), None, None]),
        ));
        let body = body_text(&reply);
        let sealed = DRAWER_HINTS[1..]
            .iter()
            .flat_map(|(ru, en)| [*ru, *en])
            .chain(["1,8,4,7", "solution"]);
        for secret in sealed {
            if body.contains(secret) {
                failures.push(format!("lang {lang}: the body carries {secret:?}"));
            }
        }
    }
    let reply = get(&st, Some(BEN), "/api/puzzles/ch1.drawer?lang=en").await;
    failures.extend(expect_reply(
        "BEN, nothing unlocked",
        &reply,
        200,
        &status_body("ch1.drawer", false, &[None, None, None]),
    ));
    let reply = post_attempt(&st, ANN, "ch1.drawer", SOLUTION).await;
    failures.extend(expect_reply(
        "ANN solves",
        &reply,
        200,
        r#"{"correct":true,"solved":true}"#,
    ));
    let reply = get(&st, Some(ANN), "/api/puzzles/ch1.drawer?lang=en").await;
    failures.extend(expect_reply(
        "ANN after the solve",
        &reply,
        200,
        &status_body("ch1.drawer", true, &[Some(DRAWER_HINTS[0].1), None, None]),
    ));
    for query in ["?lang=de", "", "?lang=EN", "?lang=ru&lang=en"] {
        let reply = get(&st, Some(ANN), &format!("/api/puzzles/ch1.drawer{query}")).await;
        failures.extend(expect_error(
            &format!("lang {query:?}"),
            &reply,
            400,
            "bad_request",
        ));
    }
    report(&failures);
}

/// The status 200 is `private, no-store` + `nosniff` (sold text); every error and the attempt's 200 keep the
/// router's `no-store`. The GET's error bodies are exact: a malformed id or `lang` is 400 (not the chapters' 404), an
/// unknown id 404, a paid chapter's puzzle 403.
#[tokio::test]
async fn puzzle_status_private_no_store() {
    let (st, _db) = state_with_users(&[ANN]).await;
    let mut failures = Vec::new();
    let reply = get(&st, Some(ANN), "/api/puzzles/ch1.drawer?lang=en").await;
    let got = (
        reply.status.as_u16(),
        header(&reply, CACHE_CONTROL),
        header(&reply, X_CONTENT_TYPE_OPTIONS),
    );
    if got != (200, Some("private, no-store"), Some("nosniff")) {
        failures.push(format!(
            "status 200: expected (200, private, no-store, nosniff), got {got:?}"
        ));
    }
    for (path, status, code) in [
        ("/api/puzzles/Ch1.drawer?lang=en", 400, "bad_request"),
        ("/api/puzzles/ch1.a-b?lang=en", 400, "bad_request"),
        ("/api/puzzles/ch1.drawer?lang=de", 400, "bad_request"),
        ("/api/puzzles/ch1.drawer", 400, "bad_request"),
        ("/api/puzzles/ch1.nothing?lang=en", 404, "not_found"),
        ("/api/puzzles/ch2.cabinet?lang=en", 403, "not_entitled"),
    ] {
        let reply = get(&st, Some(ANN), path).await;
        failures.extend(expect_error(path, &reply, status, code));
        let cache = header(&reply, CACHE_CONTROL);
        if cache != Some("no-store") {
            failures.push(format!("{path}: expected no-store, got {cache:?}"));
        }
    }
    let reply = post_attempt(&st, ANN, "ch1.drawer", WRONG).await;
    let got = (reply.status.as_u16(), header(&reply, CACHE_CONTROL));
    if got != (200, Some("no-store")) {
        failures.push(format!(
            "attempt 200: expected (200, no-store), got {got:?}"
        ));
    }
    report(&failures);
}

/// An unlock row does not open a paid chapter's hint: without the chapter the status is a 403 that carries no text;
/// with it, the unlocked tier's text.
#[tokio::test]
async fn hint_text_403_for_unowned_paid_chapter() {
    let (st, _db) = state_with_users(&[BEN]).await;
    unlock(&st, BEN, "ch2.cabinet", 1).await;
    let mut failures = Vec::new();
    let reply = get(&st, Some(BEN), "/api/puzzles/ch2.cabinet?lang=en").await;
    failures.extend(expect_error(
        "BEN without chapter:ch2",
        &reply,
        403,
        "not_entitled",
    ));
    own(&st, BEN, "chapter:ch2").await;
    let reply = get(&st, Some(BEN), "/api/puzzles/ch2.cabinet?lang=en").await;
    failures.extend(expect_reply(
        "BEN with chapter:ch2",
        &reply,
        200,
        &status_body(
            "ch2.cabinet",
            false,
            &[Some("The folders are not sorted by colour."), None, None],
        ),
    ));
    report(&failures);
}

/// `st` at `T0` with the `users` rows of `users`, as `state_with_users` makes them.
async fn at_t0_with_users(st: AppState, users: &[i64]) -> AppState {
    let st = st.with_clock(Arc::new(FixedClock(T0)));
    for &id in users {
        st.repo
            .upsert_user(UserId(id), "Ann", None, T0)
            .await
            .unwrap();
    }
    st
}

/// Credits `amount` hints to `user`: a committed `referral_invitee` seed keyed `fund:<user>:<amount>` (the
/// `economy::fund` pattern).
async fn fund(st: &AppState, user: i64, amount: i64) {
    let kind = ResourceKind("hint".to_owned());
    let mut c = common::raw_db(st).await;
    sqlx::raw_sql("BEGIN ISOLATION LEVEL READ COMMITTED")
        .execute(&mut c)
        .await
        .unwrap();
    let seed = Entry {
        user: UserId(user),
        kind: &kind,
        amount,
        reason: Reason::ReferralInvitee,
        idem_key: format!("fund:{user}:{amount}"),
        charge_id: None,
        counterpart: None,
        r#ref: None,
        at: T0,
    };
    credit_in_tx(&mut c, &seed).await.unwrap();
    sqlx::raw_sql("COMMIT").execute(&mut c).await.unwrap();
    c.close().await.unwrap();
}

/// `user`'s ledger idempotency keys, in key order.
async fn ledger_keys(st: &AppState, user: i64) -> Vec<String> {
    let mut c = common::raw_db(st).await;
    let keys = sqlx::query_scalar(
        "SELECT idem_key FROM resource_ledger WHERE user_id = $1 ORDER BY idem_key",
    )
    .bind(user)
    .fetch_all(&mut c)
    .await
    .unwrap();
    c.close().await.unwrap();
    keys
}

/// `POST /api/puzzles/{id}/hints/{tier}?lang=en` as `user`: (status, body as JSON).
async fn post_hint(st: &AppState, user: i64, id: &str, tier: u8) -> (u16, Value) {
    let req = Request::post(format!("/api/puzzles/{id}/hints/{tier}?lang=en"))
        .header(AUTHORIZATION, bearer(st, user))
        .body(Body::empty())
        .unwrap();
    let reply = common::call(st, req).await;
    let body = serde_json::from_slice(&reply.body).unwrap_or(Value::Null);
    (reply.status.as_u16(), body)
}

/// The mismatch of a hint use against a 200 with `balance` and `text`.
fn expect_hint(case: &str, got: (u16, Value), balance: i64, text: &str) -> Option<String> {
    let want = (200, json!({ "balance": balance, "text": text }));
    (got != want).then(|| format!("{case}: expected {want:?}, got {got:?}"))
}

/// A renamed puzzle is served from the rows its old id wrote (per-player §3.8): release N wrote ANN's solve and tier-1
/// unlock and BEN's tier-1 unlock under `ch1.drawer`; release N+1 serves the puzzle as `ch1.desk`, keyed
/// `ch1.drawer`. ANN's status is solved with tier 1 open; BEN's tier 1 is `AlreadyUnlocked` (200, no debit, no new
/// ledger row); the old id is no route any more. BEN stays unsolved: a solved puzzle refuses every hint use.
#[tokio::test]
async fn rename_serves_rows_under_the_key() {
    let copy = renamed_copy().await;
    let (started, _db) = state_on(copy.path()).await;
    let st = match started {
        Ok(st) => at_t0_with_users(st, &[ANN, BEN]).await,
        Err(e) => panic!("release N+1 (the renamed copy): expected Ok, got {e}"),
    };
    let mut c = common::raw_db(&st).await;
    let solved = Progress {
        solved_at: Some(T0),
        ..progress(ANN, "ch1.drawer")
    };
    insert_progress(&mut c, solved).await.unwrap();
    insert_unlock(&mut c, ANN, "ch1.drawer", 1, T0)
        .await
        .unwrap();
    insert_unlock(&mut c, BEN, "ch1.drawer", 1, T0)
        .await
        .unwrap();
    c.close().await.unwrap();
    fund(&st, BEN, 5).await;
    let mut failures = Vec::new();
    let reply = get(&st, Some(ANN), "/api/puzzles/ch1.desk?lang=en").await;
    failures.extend(expect_reply(
        "ANN's status of ch1.desk",
        &reply,
        200,
        &status_body("ch1.desk", true, &[Some(DRAWER_HINTS[0].1), None, None]),
    ));
    failures.extend(expect_hint(
        "BEN's tier 1 of ch1.desk",
        post_hint(&st, BEN, "ch1.desk", 1).await,
        5,
        DRAWER_HINTS[0].1,
    ));
    let keys = ledger_keys(&st, BEN).await;
    if keys != ["fund:1002:5"] {
        failures.push(format!(
            "BEN's ledger: expected only the fund row, got {keys:?}"
        ));
    }
    let reply = get(&st, Some(ANN), "/api/puzzles/ch1.drawer?lang=en").await;
    failures.extend(expect_error(
        "the old id ch1.drawer",
        &reply,
        404,
        "not_found",
    ));
    report(&failures);
}

/// A rollback and the next forward start serve the same rows (per-player §3.8 "Rollback and re-deploy"), on one
/// database, one process at a time: under N+1 BEN buys tier 1 of `ch1.desk`; rolled back to N, `ch1.drawer` shows it
/// and BEN buys tier 2; forward to N+1 again, `ch1.desk` shows both and tier 2 is `AlreadyUnlocked`. One debit per
/// tier, both keyed by `ch1.drawer`.
#[tokio::test]
async fn rollback_then_forward_keeps_unlocks() {
    let db = common::TestDb::create().await;
    let renamed = renamed_copy().await;
    let releases = [
        ("N+1", renamed.path()),
        ("N", Path::new(FIXTURE)),
        ("N+1 again", renamed.path()),
    ];
    let mut failures = Vec::new();
    for (at, (release, dir)) in releases.into_iter().enumerate() {
        let st = match state_on_db(dir, &db).await {
            Ok(st) => at_t0_with_users(st, &[BEN]).await,
            Err(e) => {
                failures.push(format!("start {release}: expected Ok, got {e}"));
                break;
            }
        };
        match at {
            0 => {
                fund(&st, BEN, 5).await;
                failures.extend(expect_hint(
                    "N+1: BEN buys tier 1 of ch1.desk",
                    post_hint(&st, BEN, "ch1.desk", 1).await,
                    4,
                    DRAWER_HINTS[0].1,
                ));
            }
            1 => {
                let reply = get(&st, Some(BEN), "/api/puzzles/ch1.drawer?lang=en").await;
                failures.extend(expect_reply(
                    "N: BEN's status of ch1.drawer",
                    &reply,
                    200,
                    &status_body("ch1.drawer", false, &[Some(DRAWER_HINTS[0].1), None, None]),
                ));
                failures.extend(expect_hint(
                    "N: BEN buys tier 2 of ch1.drawer",
                    post_hint(&st, BEN, "ch1.drawer", 2).await,
                    3,
                    DRAWER_HINTS[1].1,
                ));
            }
            _ => {
                let reply = get(&st, Some(BEN), "/api/puzzles/ch1.desk?lang=en").await;
                failures.extend(expect_reply(
                    "N+1 again: BEN's status of ch1.desk",
                    &reply,
                    200,
                    &status_body(
                        "ch1.desk",
                        false,
                        &[Some(DRAWER_HINTS[0].1), Some(DRAWER_HINTS[1].1), None],
                    ),
                ));
                failures.extend(expect_hint(
                    "N+1 again: BEN's tier 2 of ch1.desk",
                    post_hint(&st, BEN, "ch1.desk", 2).await,
                    3,
                    DRAWER_HINTS[1].1,
                ));
                let keys = ledger_keys(&st, BEN).await;
                let want = [
                    "fund:1002:5",
                    "hint:1002:ch1.drawer:1",
                    "hint:1002:ch1.drawer:2",
                ];
                if keys != want {
                    failures.push(format!("BEN's ledger: expected {want:?}, got {keys:?}"));
                }
            }
        }
        st.repo.close().await;
    }
    report(&failures);
}

/// A correct answer to a renamed puzzle is stored under its storage key (GM6k review M1): release N+1 serves the
/// puzzle as `ch1.desk`, keyed `ch1.drawer`. ANN answers `ch1.desk` correctly; the solve row is `ch1.drawer`'s and
/// none is the live id's, so every reader keyed by the storage key sees the solve: the status is solved, the card
/// unlocks `drawer_no_hints` (its meta names `ch1.desk`), and the solved puzzle sells no hint. The hint is asked last,
/// so a wrongly sold one cannot change the card.
#[tokio::test]
async fn rename_attempt_solves_under_the_key() {
    let copy = renamed_copy().await;
    let (started, _db) = state_on(copy.path()).await;
    let st = match started {
        Ok(st) => at_t0_with_users(st, &[ANN]).await,
        Err(e) => panic!("release N+1 (the renamed copy): expected Ok, got {e}"),
    };
    fund(&st, ANN, 5).await;
    let mut failures = Vec::new();
    let reply = post_attempt(&st, ANN, "ch1.desk", SOLUTION).await;
    failures.extend(expect_reply(
        "ANN answers ch1.desk",
        &reply,
        200,
        r#"{"correct":true,"solved":true}"#,
    ));
    for (key, want) in [
        ("ch1.drawer", Some((1, 1, T0, Some(T0)))),
        ("ch1.desk", None),
    ] {
        let row = progress_row(&st, ANN, key).await;
        if row != want {
            failures.push(format!(
                "puzzle_progress under {key}: expected {want:?}, got {row:?}"
            ));
        }
    }
    let reply = get(&st, Some(ANN), "/api/puzzles/ch1.desk?lang=en").await;
    failures.extend(expect_reply(
        "ANN's status of ch1.desk",
        &reply,
        200,
        &status_body("ch1.desk", true, &[None, None, None]),
    ));
    let req = Request::post("/api/stories/manor/card")
        .header(AUTHORIZATION, bearer(&st, ANN))
        .body(Body::empty())
        .unwrap();
    let reply = common::call(&st, req).await;
    let card: Value = serde_json::from_slice(&reply.body).unwrap_or(Value::Null);
    let ids: Vec<&str> = card["achievements"]
        .as_array()
        .map(|all| all.iter().filter_map(|a| a["id"].as_str()).collect())
        .unwrap_or_default();
    if (reply.status.as_u16(), ids.as_slice()) != (200, ["drawer_no_hints"].as_slice()) {
        failures.push(format!(
            "ANN's manor card: expected 200 with the achievements [\"drawer_no_hints\"], got {} with {ids:?}",
            reply.status.as_u16()
        ));
    }
    let hint = post_hint(&st, ANN, "ch1.desk", 1).await;
    let want = (409, json!({ "error": "hint_unavailable" }));
    if hint != want {
        failures.push(format!(
            "ANN's tier 1 of the solved ch1.desk: expected {want:?}, got {hint:?}"
        ));
    }
    let keys = ledger_keys(&st, ANN).await;
    if keys != ["fund:1001:5"] {
        failures.push(format!(
            "ANN's ledger: expected only the fund row, got {keys:?}"
        ));
    }
    report(&failures);
}

/// The shared value vectors (per-player §3.2): the server's renderer and domain parser are held to the same file as
/// the client's.
const VECTORS: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/tests/fixtures/values/vectors.json"
);

/// The fewest `render` cases the vectors hold: an emptied list fails instead of passing on zero cases.
const RENDER_CASES_MIN: usize = 9;

/// The fewest `domains` cases the vectors hold.
const DOMAIN_CASES_MIN: usize = 12;

/// The vectors file; every key is required and no other is allowed, so a renamed key fails loudly.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Vectors {
    #[serde(rename = "about")]
    _about: String,
    render: Vec<RenderCase>,
    domains: Vec<DomainCase>,
}

/// A `render` case: `template` rendered for the puzzle `own` holding `value` of `answerMax` `max` is `text`.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RenderCase {
    template: String,
    own: String,
    value: Vec<u16>,
    max: u16,
    text: String,
}

/// A `domains` case: the oracle's size of `domain`, and whether it passes the entropy floor and the acceptance.
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct DomainCase {
    domain: DomainFile,
    answer_len: usize,
    answer_max: u16,
    size: u64,
    floor: bool,
    acceptance: bool,
}

async fn vectors() -> Vectors {
    serde_json::from_value(read_json(Path::new(VECTORS)).await).unwrap()
}

/// `[lo, hi]` at each of `n` positions.
fn ranges(lo: u16, hi: u16, n: usize) -> Vec<(u16, u16)> {
    vec![(lo, hi); n]
}

fn domain_file(positions: Vec<(u16, u16)>, distinct: bool, exclude: &[&[u16]]) -> DomainFile {
    DomainFile {
        positions,
        distinct,
        exclude: exclude.iter().map(|e| e.to_vec()).collect(),
    }
}

/// A well-formed test domain: as many entries as `positions`, each at most `answer_max`.
fn domain(
    positions: Vec<(u16, u16)>,
    distinct: bool,
    exclude: &[&[u16]],
    answer_max: u16,
) -> Domain {
    let len = positions.len();
    match Domain::parse(domain_file(positions, distinct, exclude), len, answer_max) {
        Ok(d) => d,
        Err(e) => panic!("a test domain: expected Ok, got {e:?}"),
    }
}

/// splitmix64 (Steele, Lea and Flood, 2014): a seeded test source, the high 32 bits of each output.
fn splitmix(seed: u64) -> impl FnMut() -> u32 {
    let mut state = seed;
    move || {
        state = state.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = state;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        u32::try_from((z ^ (z >> 31)) >> 32).unwrap()
    }
}

/// A source that yields `seq` in order, then 0.
fn scripted(seq: &[u32]) -> impl FnMut() -> u32 + '_ {
    let mut next = seq.iter().copied();
    move || next.next().unwrap_or(0)
}

/// `draw` is uniform over a small domain (per-player §3.2): `[0, 9]^3` (1,000 cells), 10^5 draws from a seeded source,
/// each in the domain, and Pearson's chi-square over the cells at most 1,250 (999 degrees of freedom: mean 999, sd
/// ~44.7). A position that never draws its top value leaves 271 cells empty (~37,000).
#[test]
fn values_draw_is_uniform_over_a_small_domain() {
    let d = domain(ranges(0, 9, 3), false, &[], 9);
    let mut rng = splitmix(0x5EED_6D51);
    let mut cells = vec![0u32; 1000];
    let mut failures = Vec::new();
    for _ in 0..100_000 {
        match draw(&d, &mut rng) {
            Ok(v) if d.contains(&v) => {
                let cell = v.iter().fold(0usize, |at, &x| at * 10 + usize::from(x));
                cells[cell] += 1;
            }
            other => {
                failures.push(format!(
                    "a draw: expected a value of the domain, got {other:?}"
                ));
                break;
            }
        }
    }
    let expected = 100.0_f64;
    let chi2: f64 = cells
        .iter()
        .map(|&o| (f64::from(o) - expected).powi(2) / expected)
        .sum();
    let empty = cells.iter().filter(|&&o| o == 0).count();
    println!("values: chi-square {chi2:.1} over 1,000 cells, {empty} empty");
    if chi2 > 1250.0 {
        failures.push(format!(
            "chi-square over 1,000 cells: expected at most 1250, got {chi2:.1} ({empty} cells empty)"
        ));
    }
    report(&failures);
}

/// Each position draws by rejection on u32, never `% n` alone (per-player §3.2): for n = 10 the zone is
/// 2^32 - 2^32 % 10 = 4,294,967,290, so `u32::MAX` and 4,294,967,290 are rejected and 4,294,967,289 (9 mod 10) is
/// the first entry.
#[test]
fn values_draw_rejects_the_top_of_the_u32_range() {
    let d = domain(ranges(0, 9, 4), false, &[], 9);
    let seq = [u32::MAX, 4_294_967_290, 4_294_967_289, 1, 2, 3];
    let got = draw(&d, &mut scripted(&seq));
    assert_eq!(
        got,
        Ok(vec![9, 1, 2, 3]),
        "a draw over [0, 9]^4 from {seq:?}"
    );
}

/// A draw is never an excluded tuple (the code's initial `0000` is one) nor, in an all-distinct domain, a tuple
/// with a repeat: the whole tuple is drawn again. A source that only repeats an excluded tuple gives up after
/// exactly 4 x 4,096 calls. `contains` is the same rule; one draw from the OS source lies in the domain.
#[test]
fn values_draw_never_returns_initial_or_an_excluded_value() {
    let mut failures = Vec::new();
    let excl = domain(ranges(0, 9, 4), false, &[&[0, 0, 0, 0]], 9);
    let got = draw(&excl, &mut scripted(&[0, 0, 0, 0, 1, 8, 4, 7]));
    if got != Ok(vec![1, 8, 4, 7]) {
        failures.push(format!(
            "excluding 0000, from 0,0,0,0,1,8,4,7: expected Ok([1, 8, 4, 7]), got {got:?}"
        ));
    }
    let distinct = domain(ranges(0, 9, 4), true, &[], 9);
    let got = draw(&distinct, &mut scripted(&[3, 3, 1, 2, 3, 1, 2, 4]));
    if got != Ok(vec![3, 1, 2, 4]) {
        failures.push(format!(
            "all distinct, from 3,3,1,2,3,1,2,4: expected Ok([3, 1, 2, 4]), got {got:?}"
        ));
    }
    let mut calls = 0u32;
    let got = draw(&excl, &mut || {
        calls += 1;
        0
    });
    if got != Err(DrawError::Exhausted) || calls != 4 * 4096 {
        failures.push(format!(
            "excluding 0000, from a constant 0: expected Err(Exhausted) after 16384 calls, got {got:?} after {calls}"
        ));
    }
    let cases: [(&str, &Domain, &[u16], bool); 6] = [
        ("the excluded 0000", &excl, &[0, 0, 0, 0], false),
        ("three entries", &excl, &[1, 8, 4], false),
        ("an entry above its range", &excl, &[1, 8, 4, 10], false),
        ("a repeat, all distinct", &distinct, &[3, 3, 1, 2], false),
        ("the drawn 1847", &excl, &[1, 8, 4, 7], true),
        (
            "the drawn 3124, all distinct",
            &distinct,
            &[3, 1, 2, 4],
            true,
        ),
    ];
    for (case, d, v, want) in cases {
        if d.contains(v) != want {
            failures.push(format!("contains {case}: expected {want}"));
        }
    }
    match draw(&excl, &mut os_rng()) {
        Ok(v) if excl.contains(&v) => {}
        other => failures.push(format!(
            "a draw from os_rng: expected a value of the domain, got {other:?}"
        )),
    }
    report(&failures);
}

/// Each `domains` case of the shared vectors parses as its oracle says: `Ok` with its size when it passes the
/// floor and the acceptance, `Floor` with its size under 1,000 values, `Sparse` under 1/16 of the position product.
/// Server only: the size saturates to u64 instead of overflowing (`[0, 65535]^16` is no JS-exact number).
#[tokio::test]
async fn values_domain_sizes_match_the_vectors() {
    let cases = vectors().await.domains;
    let mut failures = Vec::new();
    if cases.len() < DOMAIN_CASES_MIN {
        failures.push(format!(
            "domains: expected at least {DOMAIN_CASES_MIN} cases, got {}",
            cases.len()
        ));
    }
    for (at, case) in cases.into_iter().enumerate() {
        let want = if !case.floor {
            Err(DomainError::Floor { size: case.size })
        } else if !case.acceptance {
            Err(DomainError::Sparse)
        } else {
            Ok(case.size)
        };
        let got = Domain::parse(case.domain, case.answer_len, case.answer_max).map(|d| d.size());
        if got != want {
            failures.push(format!("domains[{at}]: expected {want:?}, got {got:?}"));
        }
    }
    let got =
        Domain::parse(domain_file(ranges(0, 65535, 16), false, &[]), 16, 65535).map(|d| d.size());
    if got != Ok(u64::MAX) {
        failures.push(format!("[0, 65535]^16: expected Ok(u64::MAX), got {got:?}"));
    }
    report(&failures);
}

/// Each `render` case of the shared vectors renders to its oracle's text (per-player §5.1: the join rule, entry
/// indices, a literal `$`). Server only: a placeholder that is not one of `own`'s stays verbatim (another puzzle, a
/// malformed or out-of-range index, an unclosed `$code(`); content's load rule refuses such texts first.
#[tokio::test]
async fn values_render_matches_the_vectors() {
    let cases = vectors().await.render;
    let mut failures = Vec::new();
    if cases.len() < RENDER_CASES_MIN {
        failures.push(format!(
            "render: expected at least {RENDER_CASES_MIN} cases, got {}",
            cases.len()
        ));
    }
    for (at, case) in cases.iter().enumerate() {
        let got = render(&case.template, &case.own, &case.value, case.max);
        if got != case.text {
            failures.push(format!(
                "render[{at}] {:?}: expected {:?}, got {got:?}",
                case.template, case.text
            ));
        }
    }
    for template in [
        "Код: $code(cabinet).",
        "$code(drawer.0)",
        "$code(drawer.01)",
        "$code(drawer.5)",
        "$code(drawer.100)",
        "Код: $code(drawer",
        "$code(Drawer)",
        "$code(drawer_x)",
        "$code(drawer.1x)",
        "$code()",
    ] {
        let got = render(template, "drawer", &[1, 8, 4, 7], 9);
        if got != template {
            failures.push(format!(
                "verbatim {template:?}: expected it unchanged, got {got:?}"
            ));
        }
    }
    report(&failures);
}

/// A domain under 1/16 of its position product is refused at parse (per-player §3.2): all-distinct `[0, 15]^16`
/// (16! of 16^16) and `[0, 15]^9` (16!/7! = 4,151,347,200 of 16^9, just under 1/16); `[0, 15]^8` (0.12) parses.
#[test]
fn values_a_sparse_domain_is_refused_at_parse() {
    let mut failures = Vec::new();
    for (n, want) in [
        (16, Err(DomainError::Sparse)),
        (9, Err(DomainError::Sparse)),
        (8, Ok(518_918_400)),
    ] {
        let got = Domain::parse(domain_file(ranges(0, 15, n), true, &[]), n, 15).map(|d| d.size());
        if got != want {
            failures.push(format!(
                "all distinct [0, 15]^{n}: expected {want:?}, got {got:?}"
            ));
        }
    }
    report(&failures);
}

/// m12 (per-player §3.1 "Log redaction"): the `Debug` of a `Domain` excluding `[1, 8, 4, 7]` and of a `ValueRow`
/// holding it prints neither `1847` nor `1, 8, 4, 7`; the row prints `value: <redacted>`.
#[test]
fn values_debug_output_redacts_the_code() {
    let d = domain(ranges(0, 9, 4), false, &[&[1, 8, 4, 7]], 9);
    let row = ValueRow {
        puzzle: pid("ch1.drawer"),
        run: 1,
        wrong: 0,
        issued_at: T0,
        spent_at: None,
        domain: d.hash().clone(),
        value: vec![1, 8, 4, 7],
    };
    let mut failures = Vec::new();
    let shown = [
        ("Domain", format!("{d:?}")),
        ("ValueRow", format!("{row:?}")),
    ];
    for (what, text) in &shown {
        for secret in ["1847", "1, 8, 4, 7"] {
            if text.contains(secret) {
                failures.push(format!("{what}'s Debug carries {secret:?}: {text}"));
            }
        }
    }
    if !shown[1].1.contains("value: <redacted>") {
        failures.push(format!(
            "ValueRow's Debug: expected value: <redacted>, got {}",
            shown[1].1
        ));
    }
    report(&failures);
}

/// The domain hash is the canonical encoding's (per-player §3.2): 16 lower-case hex, the oracle's for two domains
/// (one whose excludes differ in numeric and string order), unmoved by the order or repetition of the excludes, and
/// moved by a bound, by `distinct` and by another exclude.
#[test]
fn values_domain_hash_is_canonical() {
    let hash = |positions: Vec<(u16, u16)>, distinct: bool, exclude: &[&[u16]], max: u16| {
        domain(positions, distinct, exclude, max).hash().0.clone()
    };
    let mut failures = Vec::new();
    let base = hash(ranges(0, 9, 4), false, &[&[0, 0, 0, 0]], 9);
    let numeric = hash(
        ranges(0, 15, 4),
        false,
        &[&[10, 0, 0, 0], &[9, 0, 0, 0]],
        15,
    );
    for (case, got, want) in [
        ("[0, 9]^4 without 0000", &base, "bd058b756eb7a107"),
        (
            "[0, 15]^4 without 10.0.0.0, 9.0.0.0",
            &numeric,
            "c304cc282413339d",
        ),
    ] {
        if got != want {
            failures.push(format!("{case}: expected the oracle's {want}, got {got}"));
        }
    }
    let two = hash(ranges(0, 9, 4), false, &[&[0, 0, 0, 0], &[1, 2, 3, 4]], 9);
    let same = [
        (
            "reordered excludes",
            hash(ranges(0, 9, 4), false, &[&[1, 2, 3, 4], &[0, 0, 0, 0]], 9),
        ),
        (
            "a repeated exclude",
            hash(
                ranges(0, 9, 4),
                false,
                &[&[1, 2, 3, 4], &[0, 0, 0, 0], &[1, 2, 3, 4]],
                9,
            ),
        ),
    ];
    for (case, got) in &same {
        if *got != two {
            failures.push(format!("{case}: expected {two}, got {got}"));
        }
    }
    let moved = [
        (
            "a bound",
            hash(
                vec![(0, 8), (0, 9), (0, 9), (0, 9)],
                false,
                &[&[0, 0, 0, 0]],
                9,
            ),
        ),
        ("distinct", hash(ranges(0, 9, 4), true, &[&[0, 0, 0, 0]], 9)),
        (
            "another exclude",
            hash(ranges(0, 9, 4), false, &[&[0, 0, 0, 1]], 9),
        ),
    ];
    for (case, got) in &moved {
        if *got == base {
            failures.push(format!("{case}: expected a hash other than {base}"));
        }
    }
    let all = [&base, &numeric, &two]
        .into_iter()
        .chain(same.iter().map(|(_, h)| h))
        .chain(moved.iter().map(|(_, h)| h));
    for h in all {
        if h.len() != 16
            || !h
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            failures.push(format!("{h}: expected 16 lower-case hex"));
        }
    }
    report(&failures);
}

/// Each structure rule of `Domain::parse` refuses its own misfit with its own text (per-player §3.2 "Anything else
/// is `DomainError::Shape`"). Lengths over the cap are built from `MAX_ANSWER_LEN`, so the cases hold when it moves.
#[test]
fn values_a_misshapen_domain_is_refused_at_parse() {
    let over = MAX_ANSWER_LEN + 1;
    let cases = [
        (
            "answerLen 0",
            domain_file(vec![], false, &[]),
            0,
            9,
            "answerLen is outside 1..=MAX_ANSWER_LEN",
        ),
        (
            "answerLen MAX_ANSWER_LEN + 1",
            domain_file(ranges(0, 9, over), false, &[]),
            over,
            9,
            "answerLen is outside 1..=MAX_ANSWER_LEN",
        ),
        (
            "three positions for answerLen 4",
            domain_file(ranges(0, 9, 3), false, &[]),
            4,
            9,
            "positions do not match answerLen",
        ),
        (
            "lo 5 above hi 4",
            domain_file(vec![(5, 4), (0, 9), (0, 9), (0, 9)], false, &[]),
            4,
            9,
            "a position's lo is above its hi",
        ),
        (
            "hi 10 above answerMax 9",
            domain_file(vec![(0, 10), (0, 9), (0, 9), (0, 9)], false, &[]),
            4,
            9,
            "a position's hi is above answerMax",
        ),
        (
            "an exclude of three entries",
            domain_file(ranges(0, 9, 4), false, &[&[0, 0, 0]]),
            4,
            9,
            "an exclude does not match answerLen",
        ),
        (
            "an exclude entry 10 above answerMax 9",
            domain_file(ranges(0, 9, 4), false, &[&[0, 0, 0, 10]]),
            4,
            9,
            "an exclude entry is above answerMax",
        ),
        (
            "distinct with answerMax 16",
            domain_file(ranges(0, 16, 4), true, &[]),
            4,
            16,
            "distinct needs answerMax <= 15 and answerLen <= 16",
        ),
        (
            "distinct with answerLen 17",
            domain_file(ranges(0, 15, 17), true, &[]),
            17,
            15,
            "distinct needs answerMax <= 15 and answerLen <= 16",
        ),
    ];
    let mut failures = Vec::new();
    for (case, file, len, max, rule) in cases {
        let got = Domain::parse(file, len, max).map(|d| d.size());
        if got != Err(DomainError::Shape(rule)) {
            failures.push(format!(
                "{case}: expected Err(Shape({rule:?})), got {got:?}"
            ));
        }
    }
    report(&failures);
}
