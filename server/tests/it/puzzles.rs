//! Puzzles (`server/migrations/0002_puzzles.sql`, `db/puzzles.rs`, `puzzles/`, `/api/puzzles`): the schema's
//! constraints on raw SQL, the per-(user, puzzle) attempt window, the server-checked answer, and the hint ladder whose
//! texts are served only for unlocked tiers of a puzzle the user may open (principle 0).
//!
//! Hint unlock rows are inserted by raw SQL: the server has no writer for them in this lane.

use sqlx::PgConnection;
use sqlx::postgres::PgQueryResult;

use crate::catalog::{ANN, T0};
use crate::common;

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
async fn schema_db() -> (server::AppState, common::TestDb, PgConnection) {
    let (st, db) = crate::catalog::state_with_users(&[ANN, BEN]).await;
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
