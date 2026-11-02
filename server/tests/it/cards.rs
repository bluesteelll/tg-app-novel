//! Achievements (META-PLAN M5-M9): the `0006_achievements.sql` constraints on raw SQL.
//!
//! Every refused schema case breaks one CHECK, or one whose name sorts before every other it breaks: PostgreSQL tests
//! a table's CHECK constraints in name order, so the constraint a case reports is the one the case is about.

use sqlx::PgConnection;
use sqlx::postgres::PgQueryResult;

use crate::catalog::{ANN, T0, state_with_users};
use crate::common;

/// A second player.
const BEN: i64 = 1002;

/// A user id with no `users` row.
const NOBODY: i64 = 4242;

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

/// An `achievement_unlocks` row, written raw.
async fn unlock(c: &mut PgConnection, user: i64, story: &str, id: &str, at: i64) -> Res {
    sqlx::query(
        "INSERT INTO achievement_unlocks (user_id, story_id, achievement_id, unlocked_at) VALUES ($1, $2, $3, $4)",
    )
    .bind(user)
    .bind(story)
    .bind(id)
    .bind(at)
    .execute(&mut *c)
    .await
}

/// One unlock per (user, story, achievement): a second row of the same three is refused by the primary key; another
/// story or another id of the same user is not.
#[tokio::test]
async fn schema_achievement_unlocks_pk() {
    let (st, _db) = state_with_users(&[ANN]).await;
    let mut c = common::raw_db(&st).await;
    let results = vec![
        expect_ok(
            "ANN manor truth_found",
            unlock(&mut c, ANN, "manor", "truth_found", T0).await,
        ),
        expect_err(
            "ANN manor truth_found again",
            unlock(&mut c, ANN, "manor", "truth_found", T0 + 1).await,
            ("23505", "achievement_unlocks_pkey"),
        ),
        expect_ok(
            "ANN tide truth_found (another story)",
            unlock(&mut c, ANN, "tide", "truth_found", T0).await,
        ),
        expect_ok(
            "ANN manor kind_word (another id)",
            unlock(&mut c, ANN, "manor", "kind_word", T0).await,
        ),
    ];
    let failures: Vec<String> = results.into_iter().filter_map(Result::err).collect();
    report(&failures);
}

/// The named CHECKs and the foreign key: the story id grammar (`StoryId`, anchored at both ends), the achievement id
/// grammar (M4), a positive time, and an existing user. Each refused case sits next to a control on the same parent
/// rows.
#[tokio::test]
async fn schema_achievement_unlocks_named_checks() {
    let (st, _db) = state_with_users(&[ANN, BEN]).await;
    let mut c = common::raw_db(&st).await;
    let longest_story = format!("a{}", "b".repeat(23));
    let long_story = format!("a{}", "b".repeat(24));
    let longest_id = format!("a{}", "b".repeat(31));
    let long_id = format!("a{}", "b".repeat(32));
    let results = vec![
        expect_err(
            "story Manor",
            unlock(&mut c, ANN, "Manor", "truth_found", T0).await,
            ("23514", "achievement_unlocks_story_id_shape"),
        ),
        expect_err(
            "story of 25 characters",
            unlock(&mut c, ANN, &long_story, "truth_found", T0).await,
            ("23514", "achievement_unlocks_story_id_shape"),
        ),
        expect_ok(
            "story of 24 characters",
            unlock(&mut c, ANN, &longest_story, "truth_found", T0).await,
        ),
        expect_err(
            "id Bad",
            unlock(&mut c, ANN, "manor", "Bad", T0).await,
            ("23514", "achievement_unlocks_id_shape"),
        ),
        expect_err(
            "id of 33 characters",
            unlock(&mut c, ANN, "manor", &long_id, T0).await,
            ("23514", "achievement_unlocks_id_shape"),
        ),
        expect_ok(
            "id of 32 characters",
            unlock(&mut c, ANN, "manor", &longest_id, T0).await,
        ),
        expect_err(
            "unlocked_at 0",
            unlock(&mut c, BEN, "manor", "truth_found", 0).await,
            ("23514", "achievement_unlocks_time_positive"),
        ),
        expect_ok(
            "unlocked_at 1",
            unlock(&mut c, BEN, "manor", "truth_found", 1).await,
        ),
        expect_err(
            "a user with no users row",
            unlock(&mut c, NOBODY, "manor", "truth_found", T0).await,
            ("23503", "achievement_unlocks_user_fk"),
        ),
    ];
    let failures: Vec<String> = results.into_iter().filter_map(Result::err).collect();
    report(&failures);
}
