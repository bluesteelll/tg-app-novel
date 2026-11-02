//! Achievements and the completion card (META-PLAN M5-M9): the `0006_achievements.sql` constraints on raw SQL, and
//! `POST /api/stories/{storyId}/card` through the production router - the found endings, the unlocked achievements
//! evaluated from server facts and persisted once, and principle 0's gate on every paid title.
//!
//! Every refused schema case breaks one CHECK, or one whose name sorts before every other it breaks: PostgreSQL tests
//! a table's CHECK constraints in name order, so the constraint a case reports is the one the case is about.
//!
//! Facts are raw rows (`stat_events`, `puzzle_progress`, `hint_unlocks`, entitlements through `catalog::own`): the
//! card reads what the server holds, however it was written.

use std::path::Path;
use std::sync::Arc;

use axum::body::Body;
use axum::http::Request;
use axum::http::header::{AUTHORIZATION, CACHE_CONTROL, X_CONTENT_TYPE_OPTIONS};
use serde_json::{Value, json};
use server::AppState;
use server::api::dto::{CardAchievement, CardEnding, CardResponse};
use server::clock::FixedClock;
use server::ids::UserId;
use sqlx::postgres::PgQueryResult;
use sqlx::{Connection, PgConnection};
use ts_rs::TS;

use crate::catalog::{ANN, T0, bearer, own, state_with_users};
use crate::common;
use crate::content::{FixtureCopy, state_on};
use crate::stats::{code_identifiers, rust_files};

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
pub(crate) async fn unlock(c: &mut PgConnection, user: i64, story: &str, id: &str, at: i64) -> Res {
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

/// The `n`-th lower-case UUID v4 of these tests.
fn uuid(n: u64) -> String {
    format!("{n:08x}-0000-4000-8000-{n:012x}")
}

/// A raw `stat_events` row `uuid(n)` of `user`: `kind` in `chapter` (manor's ch1 / ch2, else tide's) with `subject`,
/// received at `at`. Raw, so a row `classify` would refuse (a retired ending, an ending in another chapter) is written
/// too.
pub(crate) async fn stat(
    st: &AppState,
    user: i64,
    n: u64,
    kind: &str,
    chapter: &str,
    subject: Option<&str>,
    at: i64,
) {
    let story = if matches!(chapter, "ch1" | "ch2") {
        "manor"
    } else {
        "tide"
    };
    let mut c = common::raw_db(st).await;
    sqlx::query(
        "INSERT INTO stat_events (user_id, event_id, kind, story_id, chapter_id, subject, outcome, story_version, \
         age_ms, received_at) VALUES ($1, $2, $3, $4, $5, $6, NULL, '0123456789abcdef', 0, $7)",
    )
    .bind(user)
    .bind(uuid(n))
    .bind(kind)
    .bind(story)
    .bind(chapter)
    .bind(subject)
    .bind(at)
    .execute(&mut c)
    .await
    .unwrap();
    c.close().await.unwrap();
}

/// A raw solved `puzzle_progress` row of `user`, solved at `T0 - 50`, and the hint tiers `tiers` unlocked.
async fn solved(st: &AppState, user: i64, puzzle: &str, tiers: &[i64]) {
    let mut c = common::raw_db(st).await;
    sqlx::query(
        "INSERT INTO puzzle_progress (user_id, puzzle_id, attempts, window_start, window_attempts, first_at, \
         solved_at) VALUES ($1, $2, 1, $3, 1, $3, $3)",
    )
    .bind(user)
    .bind(puzzle)
    .bind(T0 - 50)
    .execute(&mut c)
    .await
    .unwrap();
    for &tier in tiers {
        sqlx::query(
            "INSERT INTO hint_unlocks (user_id, puzzle_id, tier, unlocked_at) VALUES ($1, $2, $3, $4)",
        )
        .bind(user)
        .bind(puzzle)
        .bind(tier)
        .bind(T0 - 60)
        .execute(&mut c)
        .await
        .unwrap();
    }
    c.close().await.unwrap();
}

/// `user`'s `achievement_unlocks` rows, as (story, id, time) in key order.
async fn unlock_rows(st: &AppState, user: i64) -> Vec<(String, String, i64)> {
    let mut c = common::raw_db(st).await;
    let rows = sqlx::query_as(
        "SELECT story_id, achievement_id, unlocked_at FROM achievement_unlocks WHERE user_id = $1 \
         ORDER BY story_id, achievement_id",
    )
    .bind(user)
    .fetch_all(&mut c)
    .await
    .unwrap();
    c.close().await.unwrap();
    rows
}

/// `POST /api/stories/{story}/card` through the production router, as `user` or without a token.
async fn post_card(st: &AppState, user: Option<i64>, story: &str) -> common::Reply {
    let mut req = Request::post(format!("/api/stories/{story}/card"));
    if let Some(user) = user {
        req = req.header(AUTHORIZATION, bearer(st, user));
    }
    common::call(st, req.body(Body::empty()).unwrap()).await
}

fn body_text(reply: &common::Reply) -> String {
    String::from_utf8_lossy(&reply.body).into_owned()
}

/// A `CardResponse` as JSON.
fn card(
    story: &str,
    runs: u32,
    completed: &[&str],
    endings: Vec<Value>,
    achievements: Vec<Value>,
) -> Value {
    json!({
        "storyId": story,
        "runs": runs,
        "chaptersCompleted": completed,
        "endings": endings,
        "achievements": achievements,
    })
}

/// A `CardEnding` as JSON.
fn ending(name: &str, title: (&str, &str), first_reached_at: i64) -> Value {
    json!({ "name": name, "title": { "ru": title.0, "en": title.1 }, "firstReachedAt": first_reached_at })
}

/// A `CardAchievement` of the fixture as JSON: its texts from the fixture's `meta.json`.
fn achievement(id: &str, unlocked_at: i64, new: bool) -> Value {
    let (name, desc) = match id {
        "truth_found" => (
            ("Фикстура: правда найдена", "Fixture: truth found"),
            (
                "Фикстура: дойти до концовки «Правда».",
                "Fixture: reach the ending The Truth.",
            ),
        ),
        "drawer_no_hints" => (
            ("Фикстура: ящик без подсказок", "Fixture: drawer, no hints"),
            (
                "Фикстура: открыть ящик стола без подсказок.",
                "Fixture: open the desk drawer without hints.",
            ),
        ),
        "kind_word" => (
            ("Фикстура: доброе слово", "Fixture: a kind word"),
            (
                "Фикстура: выбрать второй ответ в прихожей.",
                "Fixture: pick the second answer in the hall.",
            ),
        ),
        "lighthouse" => (
            ("Фикстура: маяк", "Fixture: the lighthouse"),
            (
                "Фикстура: пройти главу о маяке.",
                "Fixture: complete the lighthouse chapter.",
            ),
        ),
        "dawn_walk" => (
            ("Фикстура: прогулка на рассвете", "Fixture: a walk at dawn"),
            (
                "Фикстура: уйти с берега и встретить рассвет.",
                "Fixture: leave the shore and reach the dawn.",
            ),
        ),
        other => panic!("no fixture texts for {other}"),
    };
    json!({
        "id": id,
        "name": { "ru": name.0, "en": name.1 },
        "description": { "ru": desc.0, "en": desc.1 },
        "unlockedAt": unlocked_at,
        "new": new,
    })
}

const TRUTH: (&str, &str) = ("Фикстура: правда", "Fixture: the truth");
const DROWNED: (&str, &str) = ("Фикстура: утонувший", "Fixture: drowned");
const DAWN: (&str, &str) = ("Фикстура: рассвет", "Fixture: dawn");

/// The mismatch of a card reply against a 200 with exactly the JSON `want`.
fn expect_card(case: &str, reply: &common::Reply, want: &Value) -> Option<String> {
    let got: Option<Value> = serde_json::from_slice(&reply.body).ok();
    (reply.status.as_u16() != 200 || got.as_ref() != Some(want)).then(|| {
        format!(
            "{case}: expected 200 {want}, got {} {}",
            reply.status.as_u16(),
            body_text(reply)
        )
    })
}

/// The card lists the endings found, once each with its title and first time, never one not found; `runs` counts
/// every reach; an achievement over distinct endings is not met by one ending reached twice.
#[tokio::test]
async fn card_lists_only_found_endings() {
    let (st, _db) = state_with_users(&[ANN]).await;
    own(&st, ANN, "chapter:ch2").await;
    stat(
        &st,
        ANN,
        1,
        "ending_reached",
        "ch3",
        Some("drowned"),
        T0 - 50,
    )
    .await;
    stat(
        &st,
        ANN,
        2,
        "ending_reached",
        "ch3",
        Some("drowned"),
        T0 - 10,
    )
    .await;
    stat(&st, ANN, 3, "ending_reached", "ch2", Some("truth"), T0 - 40).await;
    stat(&st, ANN, 4, "ending_reached", "ch2", Some("truth"), T0 - 20).await;
    let mut failures = Vec::new();
    failures.extend(expect_card(
        "tide: drowned twice",
        &post_card(&st, Some(ANN), "tide").await,
        &card(
            "tide",
            2,
            &["ch3"],
            vec![ending("drowned", DROWNED, T0 - 50)],
            vec![],
        ),
    ));
    failures.extend(expect_card(
        "manor with ch2: truth twice (truth_found, not both_endings)",
        &post_card(&st, Some(ANN), "manor").await,
        &card(
            "manor",
            2,
            &["ch2"],
            vec![ending("truth", TRUTH, T0 - 40)],
            vec![achievement("truth_found", T0, true)],
        ),
    ));
    report(&failures);
}

/// Principle 0 (M7): a paid chapter's ending title and every achievement gated on it reach only a viewer who owns the
/// chapter now, and nothing is stored for one who does not; with the chapter owned, all three are listed.
#[tokio::test]
async fn card_paid_titles_need_entitlement() {
    let (st, _db) = state_with_users(&[ANN]).await;
    stat(&st, ANN, 1, "ending_reached", "ch4", Some("dawn"), T0 - 30).await;
    stat(
        &st,
        ANN,
        2,
        "choice_made",
        "ch3",
        Some("ch3.shore.s002"),
        T0 - 60,
    )
    .await;
    let mut failures = Vec::new();
    let reply = post_card(&st, Some(ANN), "tide").await;
    failures.extend(expect_card(
        "tide without chapter:ch4",
        &reply,
        &card("tide", 1, &["ch4"], vec![], vec![]),
    ));
    let text = body_text(&reply);
    for word in ["dawn", "lighthouse", "Фикстура"] {
        if text.contains(word) {
            failures.push(format!("without chapter:ch4 the body names {word}: {text}"));
        }
    }
    let rows = unlock_rows(&st, ANN).await;
    if !rows.is_empty() {
        failures.push(format!(
            "without chapter:ch4: expected no unlock row, got {rows:?}"
        ));
    }
    own(&st, ANN, "chapter:ch4").await;
    failures.extend(expect_card(
        "tide with chapter:ch4",
        &post_card(&st, Some(ANN), "tide").await,
        &card(
            "tide",
            1,
            &["ch4"],
            vec![ending("dawn", DAWN, T0 - 30)],
            vec![
                achievement("lighthouse", T0, true),
                achievement("dawn_walk", T0, true),
            ],
        ),
    ));
    report(&failures);
}

/// Principle 0 (M7) holds after a refund: the achievements stored while chapter:ch4 was owned, and the chapter's
/// ending title, leave the card once the entitlement row is deleted (a refund), while their unlock rows stay (M6). Only
/// the listing's own "visible now" check can hide them: the insert's check never sees a row that is already stored.
#[tokio::test]
async fn card_hides_stored_unlock_after_refund() {
    let (st, _db) = state_with_users(&[ANN]).await;
    stat(&st, ANN, 1, "ending_reached", "ch4", Some("dawn"), T0 - 30).await;
    stat(
        &st,
        ANN,
        2,
        "choice_made",
        "ch3",
        Some("ch3.shore.s002"),
        T0 - 60,
    )
    .await;
    own(&st, ANN, "chapter:ch4").await;
    let mut failures = Vec::new();
    failures.extend(expect_card(
        "tide with chapter:ch4 (control)",
        &post_card(&st, Some(ANN), "tide").await,
        &card(
            "tide",
            1,
            &["ch4"],
            vec![ending("dawn", DAWN, T0 - 30)],
            vec![
                achievement("lighthouse", T0, true),
                achievement("dawn_walk", T0, true),
            ],
        ),
    ));
    let mut c = common::raw_db(&st).await;
    let refunded =
        sqlx::query("DELETE FROM entitlements WHERE user_id = $1 AND product_id = 'chapter:ch4'")
            .bind(ANN)
            .execute(&mut c)
            .await
            .unwrap()
            .rows_affected();
    c.close().await.unwrap();
    if refunded != 1 {
        failures.push(format!(
            "refund: expected one entitlement row deleted, got {refunded}"
        ));
    }
    let reply = post_card(&st, Some(ANN), "tide").await;
    failures.extend(expect_card(
        "tide after the chapter:ch4 refund",
        &reply,
        &card("tide", 1, &["ch4"], vec![], vec![]),
    ));
    let text = body_text(&reply);
    for word in ["dawn", "lighthouse", "Фикстура"] {
        if text.contains(word) {
            failures.push(format!("after refund the card names {word}: {text}"));
        }
    }
    let rows = unlock_rows(&st, ANN).await;
    let stored = [
        ("tide".to_owned(), "dawn_walk".to_owned(), T0),
        ("tide".to_owned(), "lighthouse".to_owned(), T0),
    ];
    if rows != stored {
        failures.push(format!(
            "after refund: expected the dawn_walk and lighthouse rows at T0 to stay, got {rows:?}"
        ));
    }
    report(&failures);
}

/// Opens a READ COMMITTED transaction on `c` (a raw connection's default is `repeatable read`).
async fn begin(c: &mut PgConnection) {
    sqlx::raw_sql("BEGIN ISOLATION LEVEL READ COMMITTED")
        .execute(&mut *c)
        .await
        .unwrap();
}

/// Holds an uncommitted `kind_word` unlock of `user` (time `T0 - 100`) on a raw connection while the user's card POST
/// runs; once the POST waits on that row, the holder commits (`commit`) or rolls back. The card's reply.
async fn card_behind_held_unlock(
    st: &AppState,
    user: i64,
    commit: bool,
) -> Result<common::Reply, String> {
    let mut holder = common::raw_db(st).await;
    begin(&mut holder).await;
    expect_ok(
        "the held kind_word unlock",
        unlock(&mut holder, user, "manor", "kind_word", T0 - 100).await,
    )?;
    let app = st.clone();
    let mut posted = tokio::spawn(async move { post_card(&app, Some(user), "manor").await });
    let early = tokio::select! {
        biased;
        got = &mut posted => Some(got.unwrap()),
        () = common::wait_for_lock_waiter(st) => None,
    };
    let end = if commit { "COMMIT" } else { "ROLLBACK" };
    sqlx::raw_sql(end).execute(&mut holder).await.unwrap();
    holder.close().await.unwrap();
    if let Some(reply) = early {
        return Err(format!(
            "user {user}: the card answered before waiting on the held row: {} {}",
            reply.status.as_u16(),
            body_text(&reply)
        ));
    }
    Ok(posted.await.unwrap())
}

/// Two cards of one user at once (two devices, a retry): the insert of an achievement another request holds waits on
/// that row, and the card is read after the insert, so the waiting request shows the winner's unlock with `new:
/// false` and the winner's time. A holder that rolls back leaves the unlock to the waiting request: `new: true`.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn card_concurrent_posts_new_once() {
    let (st, _db) = state_with_users(&[ANN, BEN]).await;
    stat(
        &st,
        ANN,
        1,
        "choice_made",
        "ch1",
        Some("ch1.hall.c002"),
        T0 - 200,
    )
    .await;
    stat(
        &st,
        BEN,
        2,
        "choice_made",
        "ch1",
        Some("ch1.hall.c002"),
        T0 - 200,
    )
    .await;
    let mut failures = Vec::new();
    match card_behind_held_unlock(&st, ANN, true).await {
        Ok(reply) => failures.extend(expect_card(
            "ANN behind a committed unlock",
            &reply,
            &card(
                "manor",
                0,
                &[],
                vec![],
                vec![achievement("kind_word", T0 - 100, false)],
            ),
        )),
        Err(failure) => failures.push(failure),
    }
    match card_behind_held_unlock(&st, BEN, false).await {
        Ok(reply) => failures.extend(expect_card(
            "BEN behind a rolled-back unlock (control)",
            &reply,
            &card(
                "manor",
                0,
                &[],
                vec![],
                vec![achievement("kind_word", T0, true)],
            ),
        )),
        Err(failure) => failures.push(failure),
    }
    report(&failures);
}

/// The object keys of `v` at any depth that contain `word`, ignoring case.
fn keys_containing(v: &Value, word: &str) -> Vec<String> {
    match v {
        Value::Object(map) => map
            .iter()
            .flat_map(|(key, value)| {
                let own = key.to_lowercase().contains(word).then(|| key.clone());
                own.into_iter().chain(keys_containing(value, word))
            })
            .collect(),
        Value::Array(items) => items
            .iter()
            .flat_map(|item| keys_containing(item, word))
            .collect(),
        _ => Vec::new(),
    }
}

/// No total of endings or achievements (META-PLAN M8, M9): no key containing `total` anywhere in a served card with
/// an ending in it.
#[tokio::test]
async fn card_has_no_endings_total() {
    let (st, _db) = state_with_users(&[ANN]).await;
    stat(
        &st,
        ANN,
        1,
        "ending_reached",
        "ch3",
        Some("drowned"),
        T0 - 5,
    )
    .await;
    let mut failures = Vec::new();
    let reply = post_card(&st, Some(ANN), "tide").await;
    let body: Value = serde_json::from_slice(&reply.body).unwrap_or(Value::Null);
    if reply.status.as_u16() != 200 || body["endings"][0]["name"] != json!("drowned") {
        failures.push(format!(
            "control: expected 200 listing drowned, got {} {}",
            reply.status.as_u16(),
            body_text(&reply)
        ));
    }
    let totals = keys_containing(&body, "total");
    if !totals.is_empty() {
        failures.push(format!(
            "the served card: expected no key containing total, got {totals:?}"
        ));
    }
    let cfg = ts_rs::Config::default();
    for (dto, decl) in [
        ("CardResponse", CardResponse::decl(&cfg)),
        ("CardEnding", CardEnding::decl(&cfg)),
        ("CardAchievement", CardAchievement::decl(&cfg)),
    ] {
        if decl.to_lowercase().contains("total") {
            failures.push(format!("{dto}: expected no total, got {decl}"));
        }
    }
    report(&failures);
}

/// An unlock is stored once and stays (M6): `new: true` on the request that stored it, then `new: false` with the
/// same time on a later request, and still listed after the fact behind it is gone.
#[tokio::test]
async fn card_unlock_persists_and_new_once() {
    let (st, _db) = state_with_users(&[ANN]).await;
    stat(
        &st,
        ANN,
        1,
        "choice_made",
        "ch1",
        Some("ch1.hall.c002"),
        T0 - 5,
    )
    .await;
    let mut failures = Vec::new();
    let unlocked = |new: bool| {
        card(
            "manor",
            0,
            &[],
            vec![],
            vec![achievement("kind_word", T0, new)],
        )
    };
    failures.extend(expect_card(
        "first card at T0",
        &post_card(&st, Some(ANN), "manor").await,
        &unlocked(true),
    ));
    let later = st.clone().with_clock(Arc::new(FixedClock(T0 + 60)));
    failures.extend(expect_card(
        "second card at T0 + 60",
        &post_card(&later, Some(ANN), "manor").await,
        &unlocked(false),
    ));
    let mut c = common::raw_db(&st).await;
    sqlx::query("DELETE FROM stat_events WHERE user_id = $1")
        .bind(ANN)
        .execute(&mut c)
        .await
        .unwrap();
    c.close().await.unwrap();
    failures.extend(expect_card(
        "after the choice row is gone",
        &post_card(&later, Some(ANN), "manor").await,
        &unlocked(false),
    ));
    let rows = unlock_rows(&st, ANN).await;
    if rows != [("manor".to_owned(), "kind_word".to_owned(), T0)] {
        failures.push(format!(
            "unlock rows: expected one kind_word at T0, got {rows:?}"
        ));
    }
    report(&failures);
}

/// `puzzle` with `hints: 0` (M5) reads the server's own puzzle tables: a solved drawer with a hint tier unlocked does
/// not meet `drawer_no_hints`; one solved without a hint does.
#[tokio::test]
async fn card_puzzle_no_hints_condition() {
    let (st, _db) = state_with_users(&[ANN, BEN]).await;
    solved(&st, ANN, "ch1.drawer", &[1]).await;
    solved(&st, BEN, "ch1.drawer", &[]).await;
    let mut failures = Vec::new();
    failures.extend(expect_card(
        "ANN: solved with hint tier 1",
        &post_card(&st, Some(ANN), "manor").await,
        &card("manor", 0, &[], vec![], vec![]),
    ));
    failures.extend(expect_card(
        "BEN: solved without a hint",
        &post_card(&st, Some(BEN), "manor").await,
        &card(
            "manor",
            0,
            &[],
            vec![],
            vec![achievement("drawer_no_hints", T0, true)],
        ),
    ));
    report(&failures);
}

/// What the current meta does not hold is not shown (M6, ST6): a stored unlock of a retired achievement id, an ending
/// the index no longer declares (`gone`), and an ending recorded in a chapter the index no longer places it in
/// (`ashes` in ch1); none of them counts toward an achievement. The live items stay listed.
#[tokio::test]
async fn card_retired_achievement_hidden() {
    let (st, _db) = state_with_users(&[ANN]).await;
    own(&st, ANN, "chapter:ch2").await;
    let mut c = common::raw_db(&st).await;
    let held = unlock(&mut c, ANN, "manor", "old_badge", T0 - 5).await;
    c.close().await.unwrap();
    let mut failures: Vec<String> = expect_ok("the old_badge unlock", held)
        .err()
        .into_iter()
        .collect();
    stat(&st, ANN, 1, "ending_reached", "ch2", Some("truth"), T0 - 30).await;
    stat(&st, ANN, 2, "ending_reached", "ch2", Some("gone"), T0 - 20).await;
    stat(&st, ANN, 3, "ending_reached", "ch1", Some("ashes"), T0 - 25).await;
    failures.extend(expect_card(
        "manor: truth, gone, ashes in ch1, old_badge",
        &post_card(&st, Some(ANN), "manor").await,
        &card(
            "manor",
            1,
            &["ch2"],
            vec![ending("truth", TRUTH, T0 - 30)],
            vec![achievement("truth_found", T0, true)],
        ),
    ));
    report(&failures);
}

/// A card at the M4 limits (META-PLAN M9): 50 met, visible achievements with 32-character ids, 40-code-point names
/// and 140-code-point descriptions (ru Cyrillic, 2 bytes a code point; en Latin), and both manor endings with
/// 40-code-point titles. The precondition is asserted beside the bound: a 200 listing every constructed item at its
/// limits, and a body of at least 30,000 bytes, so a small body cannot pass; the bound is 36 KiB. The fixture's own
/// card with every manor item stays under 2 KiB (the typical card).
#[tokio::test]
async fn card_response_bounded() {
    const BOUND: usize = 36 * 1024;
    const FLOOR: usize = 30_000;
    const TYPICAL: usize = 2 * 1024;
    let ids: Vec<String> = (0..50).map(|i| format!("a{i:0>31}")).collect();
    let copy = FixtureCopy::new();
    let at_limits = ids.clone();
    copy.edit_json("meta.json", move |v| {
        let manor = &mut v["stories"]["manor"];
        for name in ["truth", "ashes"] {
            manor["endings"][name] = json!({ "ru": "я".repeat(40), "en": "e".repeat(40) });
        }
        manor["achievements"] = Value::Array(
            at_limits
                .iter()
                .map(|id| {
                    json!({
                        "id": id,
                        "hidden": false,
                        "when": { "choice": "ch1.hall.c002" },
                        "name": { "ru": "я".repeat(40), "en": "n".repeat(40) },
                        "desc": { "ru": "я".repeat(140), "en": "d".repeat(140) },
                    })
                })
                .collect(),
        );
    })
    .await;
    let (started, _db) = state_on(copy.path()).await;
    let st = started.unwrap().with_clock(Arc::new(FixedClock(T0)));
    st.repo
        .upsert_user(UserId(ANN), "Ann", None, T0)
        .await
        .unwrap();
    own(&st, ANN, "chapter:ch2").await;
    stat(
        &st,
        ANN,
        1,
        "choice_made",
        "ch1",
        Some("ch1.hall.c002"),
        T0 - 30,
    )
    .await;
    stat(&st, ANN, 2, "ending_reached", "ch2", Some("truth"), T0 - 20).await;
    stat(&st, ANN, 3, "ending_reached", "ch2", Some("ashes"), T0 - 10).await;
    let mut failures = Vec::new();
    let reply = post_card(&st, Some(ANN), "manor").await;
    let body: Value = serde_json::from_slice(&reply.body).unwrap_or(Value::Null);
    let chars = |v: &Value| v.as_str().map_or(0, |s| s.chars().count());
    let listed: Vec<&str> = body["achievements"]
        .as_array()
        .map(|items| items.iter().filter_map(|a| a["id"].as_str()).collect())
        .unwrap_or_default();
    if reply.status.as_u16() != 200 || listed != ids {
        failures.push(format!(
            "precondition: expected 200 listing the 50 constructed ids, got {} with {} ids",
            reply.status.as_u16(),
            listed.len()
        ));
    }
    let achievements_at_limit = body["achievements"].as_array().is_some_and(|items| {
        items.iter().all(|a| {
            [
                (&a["name"]["ru"], 40),
                (&a["name"]["en"], 40),
                (&a["description"]["ru"], 140),
                (&a["description"]["en"], 140),
            ]
            .iter()
            .all(|(text, max)| chars(text) == *max)
        })
    });
    let endings_at_limit = body["endings"].as_array().is_some_and(|items| {
        items.len() == 2
            && items
                .iter()
                .all(|e| chars(&e["title"]["ru"]) == 40 && chars(&e["title"]["en"]) == 40)
    });
    if !(achievements_at_limit && endings_at_limit) {
        failures.push("precondition: not every listed text is at its M4 limit".to_owned());
    }
    let size = reply.body.len();
    if !(FLOOR..=BOUND).contains(&size) {
        failures.push(format!(
            "the card at the M4 limits: expected {FLOOR} to {BOUND} bytes, measured {size}"
        ));
    }

    // The fixture's own card with every manor achievement and both endings.
    let (st, _db2) = state_with_users(&[ANN]).await;
    own(&st, ANN, "chapter:ch2").await;
    stat(
        &st,
        ANN,
        1,
        "choice_made",
        "ch1",
        Some("ch1.hall.c002"),
        T0 - 30,
    )
    .await;
    stat(&st, ANN, 2, "ending_reached", "ch2", Some("truth"), T0 - 20).await;
    stat(&st, ANN, 3, "ending_reached", "ch2", Some("ashes"), T0 - 10).await;
    solved(&st, ANN, "ch1.drawer", &[]).await;
    solved(&st, ANN, "ch2.cabinet", &[]).await;
    let reply = post_card(&st, Some(ANN), "manor").await;
    let body: Value = serde_json::from_slice(&reply.body).unwrap_or(Value::Null);
    let listed = body["achievements"].as_array().map_or(0, Vec::len);
    if reply.status.as_u16() != 200 || listed != 6 {
        failures.push(format!(
            "the fixture's full card: expected 200 with 6 achievements, got {} with {listed}",
            reply.status.as_u16()
        ));
    }
    // Measured at this lane: 34,167 bytes at the M4 limits, 2,036 for the fixture's full card.
    if reply.body.len() >= TYPICAL {
        failures.push(format!(
            "the fixture's full card: expected under {TYPICAL} bytes, measured {}",
            reply.body.len()
        ));
    }
    report(&failures);
}

/// The story id of the path: a story the index does not hold is 404 `not_found`, a path outside the `StoryId`
/// grammar 400 `bad_request`, no token 401; a story of the index answers.
#[tokio::test]
async fn card_unknown_story_404() {
    let (st, _db) = state_with_users(&[ANN]).await;
    let mut failures = Vec::new();
    for (case, user, story, status, body) in [
        ("nope", Some(ANN), "nope", 404, r#"{"error":"not_found"}"#),
        ("Nope", Some(ANN), "Nope", 400, r#"{"error":"bad_request"}"#),
        (
            "manor without a token",
            None,
            "manor",
            401,
            r#"{"error":"token_missing"}"#,
        ),
    ] {
        let reply = post_card(&st, user, story).await;
        let got = body_text(&reply);
        if reply.status.as_u16() != status || got != body {
            failures.push(format!(
                "{case}: expected {status} {body}, got {} {got}",
                reply.status.as_u16()
            ));
        }
    }
    failures.extend(expect_card(
        "manor (control)",
        &post_card(&st, Some(ANN), "manor").await,
        &card("manor", 0, &[], vec![], vec![]),
    ));
    report(&failures);
}

/// The 200 carries paid-gated texts: `private, no-store` and `nosniff` (the paid-content pair); an error keeps the
/// router's `no-store`.
#[tokio::test]
async fn card_private_no_store() {
    let (st, _db) = state_with_users(&[ANN]).await;
    let mut failures = Vec::new();
    for (case, reply, status, cache, nosniff) in [
        (
            "200",
            post_card(&st, Some(ANN), "manor").await,
            200,
            "private, no-store",
            Some("nosniff"),
        ),
        (
            "401",
            post_card(&st, None, "manor").await,
            401,
            "no-store",
            None,
        ),
        (
            "404",
            post_card(&st, Some(ANN), "nope").await,
            404,
            "no-store",
            None,
        ),
    ] {
        let header = |name| {
            reply
                .headers
                .get(name)
                .map(|v| v.to_str().unwrap_or("<not text>").to_owned())
        };
        let got = (header(CACHE_CONTROL), header(X_CONTENT_TYPE_OPTIONS));
        let want = (Some(cache.to_owned()), nosniff.map(str::to_owned));
        if reply.status.as_u16() != status || got != want {
            failures.push(format!(
                "{case}: expected {status} with {want:?}, got {} with {got:?}",
                reply.status.as_u16()
            ));
        }
    }
    report(&failures);
}

/// The names of the achievements repository and its table.
const ACHIEVEMENTS_REPO_WORDS: [&str; 7] = [
    "achievement_unlocks",
    "card_stats",
    "card_puzzles",
    "record_unlocks",
    "story_unlocks",
    "endings_by_story",
    "unlocks_by_story",
];

/// The card's reads and write, which `api/cards.rs` alone calls.
const CARD_CALLS: [&str; 4] = [
    "card_stats",
    "card_puzzles",
    "record_unlocks",
    "story_unlocks",
];

/// The two grouped reads of a user's progress (the friend profile and the share's counts, LF2), which `api/social.rs`
/// alone calls.
const SOCIAL_CALLS: [&str; 2] = ["endings_by_story", "unlocks_by_story"];

/// Achievements grant nothing (M6, principle 1): the repository is named only by `db/achievements.rs`, by the card
/// route in `api/cards.rs` (which leaves the table's name to `db/`) and by `api/social.rs` for the two grouped reads
/// alone ([`SOCIAL_CALLS`]: LF2's friend profile and the share's counts, which `api/share.rs` takes from
/// `api/social.rs`), in `server` and `server-dev` alike. Each allowed file must name each of its words, so a move
/// cannot pass with an empty scan.
#[test]
fn achievements_repo_called_only_from_cards_api() {
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
    let mut seen: Vec<(String, &str)> = Vec::new();
    for (path, text) in &files {
        let file = rel(path);
        let allowed: &[&str] = match file.as_str() {
            "src/db/achievements.rs" => &ACHIEVEMENTS_REPO_WORDS,
            "src/api/cards.rs" => &CARD_CALLS,
            "src/api/social.rs" => &SOCIAL_CALLS,
            _ => &[],
        };
        for (line, word) in
            code_identifiers(text).filter(|(_, w)| ACHIEVEMENTS_REPO_WORDS.contains(w))
        {
            if allowed.contains(&word) {
                seen.push((file.clone(), word));
            } else {
                failures.push(format!("{file}:{line}: {word}"));
            }
        }
    }
    let presence = std::iter::once(("src/db/achievements.rs", "achievement_unlocks"))
        .chain(CARD_CALLS.iter().map(|&call| ("src/api/cards.rs", call)))
        .chain(SOCIAL_CALLS.iter().map(|&call| ("src/api/social.rs", call)));
    for (file, word) in presence {
        if !seen.iter().any(|(f, w)| f == file && *w == word) {
            failures.push(format!("{file} does not name {word}"));
        }
    }
    if !files.iter().any(|(path, _)| rel(path) == "dev/src/main.rs") {
        failures.push("the scan did not reach dev/src/main.rs".to_owned());
    }
    report(&failures);
}

/// LF2's reads for a friend's profile (META-PLAN M13): every distinct reached ending of a user across stories, raw
/// (a retired ending too: the caller keeps what the index holds), and every stored unlock of the user. Another
/// user's rows are not read.
#[tokio::test]
async fn achievement_reads_by_story() {
    let (st, _db) = state_with_users(&[ANN, BEN]).await;
    stat(&st, ANN, 1, "ending_reached", "ch2", Some("truth"), T0 - 40).await;
    stat(&st, ANN, 2, "ending_reached", "ch2", Some("truth"), T0 - 30).await;
    stat(&st, ANN, 3, "ending_reached", "ch2", Some("gone"), T0 - 20).await;
    stat(
        &st,
        ANN,
        4,
        "ending_reached",
        "ch3",
        Some("drowned"),
        T0 - 10,
    )
    .await;
    stat(
        &st,
        ANN,
        5,
        "choice_made",
        "ch1",
        Some("ch1.hall.c002"),
        T0 - 5,
    )
    .await;
    stat(
        &st,
        BEN,
        6,
        "ending_reached",
        "ch3",
        Some("drowned"),
        T0 - 10,
    )
    .await;
    let mut failures = Vec::new();
    let mut c = common::raw_db(&st).await;
    for (user, story, id, at) in [
        (ANN, "manor", "truth_found", T0 - 5),
        (ANN, "tide", "lighthouse", T0 - 4),
        (ANN, "manor", "old_badge", T0 - 3),
        (BEN, "manor", "kind_word", T0 - 2),
    ] {
        if let Err(failure) = expect_ok(id, unlock(&mut c, user, story, id, at).await) {
            failures.push(failure);
        }
    }
    c.close().await.unwrap();

    let mut endings: Vec<(String, String, String)> = st
        .repo
        .endings_by_story(UserId(ANN))
        .await
        .unwrap()
        .into_iter()
        .map(|e| (e.story.0, e.chapter.0, e.name))
        .collect();
    endings.sort_unstable();
    let want: Vec<(String, String, String)> = [
        ("manor", "ch2", "gone"),
        ("manor", "ch2", "truth"),
        ("tide", "ch3", "drowned"),
    ]
    .iter()
    .map(|&(s, ch, name)| (s.to_owned(), ch.to_owned(), name.to_owned()))
    .collect();
    if endings != want {
        failures.push(format!(
            "endings_by_story(ANN): expected {want:?}, got {endings:?}"
        ));
    }
    let mut unlocks: Vec<(String, String, i64)> = st
        .repo
        .unlocks_by_story(UserId(ANN))
        .await
        .unwrap()
        .into_iter()
        .map(|u| (u.story.0, u.achievement, u.unlocked_at))
        .collect();
    unlocks.sort_unstable();
    let want: Vec<(String, String, i64)> = [
        ("manor", "old_badge", T0 - 3),
        ("manor", "truth_found", T0 - 5),
        ("tide", "lighthouse", T0 - 4),
    ]
    .iter()
    .map(|&(s, id, at)| (s.to_owned(), id.to_owned(), at))
    .collect();
    if unlocks != want {
        failures.push(format!(
            "unlocks_by_story(ANN): expected {want:?}, got {unlocks:?}"
        ));
    }
    report(&failures);
}
