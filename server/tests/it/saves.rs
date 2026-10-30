//! Saves: one row per (user, slot) behind an optimistic `rev`, the one retry contract (`writeId`), the size and JSON
//! checks at the edge, and rows keyed by the token's user. Every request goes through the production router.

use std::sync::Arc;

use axum::body::Body;
use axum::http::Request;
use axum::http::header::{AUTHORIZATION, CACHE_CONTROL, CONTENT_TYPE};
use serde_json::{Value, json};
use server::AppState;
use server::auth::issue_token;
use server::clock::FixedClock;
use server::ids::UserId;
use tempfile::TempDir;

use crate::common;

/// The clock of every state here, unless a step moves it.
const T0: i64 = 1_800_000_000;
/// The user of the single-user tests.
const ANN: i64 = 1001;

fn report(failures: &[String]) {
    assert!(
        failures.is_empty(),
        "{} failures:\n{}",
        failures.len(),
        failures.join("\n")
    );
}

/// A migrated state at `T0` whose `users` table holds `users` (`saves.user_id` is a foreign key).
async fn saves_state(users: &[i64]) -> (AppState, TempDir) {
    let (st, dir) = common::test_state().await;
    let st = st.with_clock(Arc::new(FixedClock(T0)));
    for &id in users {
        st.repo
            .upsert_user(UserId(id), "Ann", None, T0)
            .await
            .unwrap();
    }
    (st, dir)
}

/// The same state with its clock at `now`.
fn at(st: &AppState, now: i64) -> AppState {
    st.clone().with_clock(Arc::new(FixedClock(now)))
}

/// `Authorization` for `user`: a token issued at `T0`, valid at every clock of these tests.
fn bearer(st: &AppState, user: i64) -> String {
    let (token, _) = issue_token(&st.keys.token, UserId(user), T0, st.cfg.token_ttl_secs);
    format!("Bearer {token}")
}

/// The save body a test writes with `write_id`: a JSON document naming its write.
fn save_body(write_id: &str) -> String {
    json!({ "write": write_id }).to_string()
}

/// The envelope of a write: chapter, story version, line.
type Envelope<'a> = (&'a str, &'a str, Option<&'a str>);

/// The envelope of most writes here.
const ENV1: Envelope<'static> = ("ch1", "v1", Some("ch1.k1.l3"));

/// A `PutSaveRequest` with the envelope `env` and the body `body`.
fn request_with(expected_rev: Option<i64>, write_id: &str, env: Envelope<'_>, body: &str) -> Value {
    json!({
        "expectedRev": expected_rev,
        "writeId": write_id,
        "chapterId": env.0,
        "storyVersion": env.1,
        "lineId": env.2,
        "body": body,
    })
}

/// A `PutSaveRequest` with [`ENV1`] and the body of `write_id`.
fn request(expected_rev: Option<i64>, write_id: &str) -> String {
    request_with(expected_rev, write_id, ENV1, &save_body(write_id)).to_string()
}

/// A `SaveSummary` as a JSON value.
fn summary_with(slot: &str, rev: i64, env: Envelope<'_>, saved_at: i64, write_id: &str) -> Value {
    json!({
        "slot": slot,
        "rev": rev,
        "chapterId": env.0,
        "storyVersion": env.1,
        "lineId": env.2,
        "savedAt": saved_at,
        "writeId": write_id,
    })
}

/// A `SaveSummary` of a write with [`ENV1`].
fn summary(slot: &str, rev: i64, saved_at: i64, write_id: &str) -> Value {
    summary_with(slot, rev, ENV1, saved_at, write_id)
}

/// `PUT /api/saves/{slot}` as `user`, with `body` sent as JSON.
async fn put(st: &AppState, user: i64, slot: &str, body: String) -> common::Reply {
    let req = Request::put(format!("/api/saves/{slot}"))
        .header(AUTHORIZATION, bearer(st, user))
        .header(CONTENT_TYPE, "application/json")
        .body(Body::from(body))
        .unwrap();
    common::call(st, req).await
}

/// `GET /api{path}`, as `user` or without an `Authorization` header.
async fn get(st: &AppState, user: Option<i64>, path: &str) -> common::Reply {
    let mut req = Request::get(format!("/api{path}"));
    if let Some(user) = user {
        req = req.header(AUTHORIZATION, bearer(st, user));
    }
    common::call(st, req.body(Body::empty()).unwrap()).await
}

fn text(reply: &common::Reply) -> String {
    String::from_utf8_lossy(&reply.body).into_owned()
}

/// The mismatch of `reply` against a status and a JSON body compared as a value.
fn expect_json(case: &str, reply: &common::Reply, status: u16, want: &Value) -> Option<String> {
    let got: Value = serde_json::from_slice(&reply.body).unwrap_or(Value::Null);
    (reply.status.as_u16() != status || got != *want).then(|| {
        format!(
            "{case}: expected {status} {want}, got {} {:?}",
            reply.status.as_u16(),
            text(reply)
        )
    })
}

/// The mismatch of `reply` against a status and an exact body text (the wire form, field order included).
fn expect_text(case: &str, reply: &common::Reply, status: u16, want: &str) -> Option<String> {
    let got = text(reply);
    (reply.status.as_u16() != status || got != want).then(|| {
        format!(
            "{case}: expected {status} {want}, got {} {got:?}",
            reply.status.as_u16()
        )
    })
}

/// `Cache-Control: no-store` is missing from `reply`.
fn expect_no_store(case: &str, reply: &common::Reply) -> Option<String> {
    let cache = reply
        .headers
        .get(CACHE_CONTROL)
        .map(|v| v.to_str().unwrap_or("<not text>"));
    (cache != Some("no-store"))
        .then(|| format!("{case}: cache-control: expected no-store, got {cache:?}"))
}

/// A `PutSaveResponse` as a JSON value.
fn written(rev: i64, saved_at: i64) -> Value {
    json!({ "rev": rev, "savedAt": saved_at })
}

/// A 409 body as a JSON value.
fn conflict(current: Value) -> Value {
    json!({ "error": "save_conflict", "current": current })
}

/// A `saves` row as the database holds it: (slot, rev, write_id, body, saved_at).
type Row = (String, i64, String, String, i64);

/// The row a write with [`ENV1`] and the body of `write_id` leaves.
fn row(slot: &str, rev: i64, write_id: &str, saved_at: i64) -> Row {
    (
        slot.to_owned(),
        rev,
        write_id.to_owned(),
        save_body(write_id),
        saved_at,
    )
}

/// Every `saves` row of `user`, read outside the app pool, by slot.
async fn rows(st: &AppState, user: i64) -> Vec<Row> {
    let mut db = common::raw_db(st).await;
    sqlx::query_as(
        "SELECT slot, rev, write_id, body, saved_at FROM saves WHERE user_id = ? ORDER BY slot",
    )
    .bind(user)
    .fetch_all(&mut db)
    .await
    .unwrap()
}

/// The mismatch of `user`'s rows against `want`.
async fn expect_rows(case: &str, st: &AppState, user: i64, want: &[Row]) -> Option<String> {
    let got = rows(st, user).await;
    (got != want).then(|| format!("{case}: rows of {user}: expected {want:?}, got {got:?}"))
}

#[tokio::test]
async fn saves_create_then_conflict() {
    let (st, _dir) = saves_state(&[ANN]).await;
    let mut failures = Vec::new();

    let reply = put(&st, ANN, "auto", request(None, "w1")).await;
    failures.extend(expect_json(
        "first PUT auto null/w1",
        &reply,
        200,
        &written(1, T0),
    ));
    failures.extend(expect_no_store("first PUT auto null/w1", &reply));

    // The exact wire form of a 409 that carries the stored row.
    let current = format!(
        r#"{{"error":"save_conflict","current":{{"slot":"auto","rev":1,"chapterId":"ch1","storyVersion":"v1","lineId":"ch1.k1.l3","savedAt":{T0},"writeId":"w1"}}}}"#
    );
    let reply = put(&st, ANN, "auto", request(None, "w2")).await;
    failures.extend(expect_text(
        "PUT auto null/w2 on a stored slot",
        &reply,
        409,
        &current,
    ));
    failures.extend(expect_no_store("PUT auto null/w2 on a stored slot", &reply));
    let reply = put(&st, ANN, "auto", request(Some(7), "w3")).await;
    failures.extend(expect_text(
        "PUT auto 7/w3 against rev 1",
        &reply,
        409,
        &current,
    ));
    // No row: the 409 carries no `current` at all, not `null`.
    let reply = put(&st, ANN, "s3", request(Some(1), "w4")).await;
    failures.extend(expect_text(
        "PUT s3 1/w4 on an empty slot",
        &reply,
        409,
        r#"{"error":"save_conflict"}"#,
    ));

    let reply = get(&st, Some(ANN), "/saves/auto").await;
    failures.extend(expect_json(
        "GET auto",
        &reply,
        200,
        &json!({ "summary": summary("auto", 1, T0, "w1"), "body": save_body("w1") }),
    ));
    failures.extend(expect_no_store("GET auto", &reply));
    failures.extend(expect_rows("after the 409s", &st, ANN, &[row("auto", 1, "w1", T0)]).await);
    let reply = get(&st, Some(ANN), "/saves").await;
    failures.extend(expect_json(
        "GET list",
        &reply,
        200,
        &json!({ "slots": [summary("auto", 1, T0, "w1")] }),
    ));
    report(&failures);
}

#[tokio::test]
async fn saves_rev_increments() {
    let (st, _dir) = saves_state(&[ANN]).await;
    let mut failures = Vec::new();
    let env3 = ("ch2", "v2", None);

    let reply = put(&st, ANN, "s2", request(None, "w1")).await;
    failures.extend(expect_json("PUT s2 null/w1", &reply, 200, &written(1, T0)));
    let reply = put(&at(&st, T0 + 10), ANN, "s2", request(Some(1), "w2")).await;
    failures.extend(expect_json(
        "PUT s2 1/w2 at T0+10",
        &reply,
        200,
        &written(2, T0 + 10),
    ));
    let w3 = request_with(Some(2), "w3", env3, &save_body("w3")).to_string();
    let reply = put(&at(&st, T0 + 20), ANN, "s2", w3).await;
    failures.extend(expect_json(
        "PUT s2 2/w3 at T0+20",
        &reply,
        200,
        &written(3, T0 + 20),
    ));
    let reply = put(&at(&st, T0 + 20), ANN, "auto", request(None, "w4")).await;
    failures.extend(expect_json(
        "PUT auto null/w4 at T0+20",
        &reply,
        200,
        &written(1, T0 + 20),
    ));

    let s2 = summary_with("s2", 3, env3, T0 + 20, "w3");
    let reply = get(&st, Some(ANN), "/saves/s2").await;
    failures.extend(expect_json(
        "GET s2",
        &reply,
        200,
        &json!({ "summary": s2, "body": save_body("w3") }),
    ));
    let reply = get(&st, Some(ANN), "/saves").await;
    failures.extend(expect_json(
        "GET list",
        &reply,
        200,
        &json!({ "slots": [summary("auto", 1, T0 + 20, "w4"), s2] }),
    ));
    report(&failures);
}

/// One round of two concurrent writes: exactly one 200 (`rev`), and one 409 whose `current` is the winner's row.
fn race_failure(
    round: &str,
    a: (&str, &common::Reply),
    b: (&str, &common::Reply),
    rev: i64,
) -> Option<String> {
    let statuses = (a.1.status.as_u16(), b.1.status.as_u16());
    let (winner, loser) = match statuses {
        (200, 409) => (a, b),
        (409, 200) => (b, a),
        _ => {
            return Some(format!(
                "{round}: expected one 200 and one 409, got {} {:?} and {} {:?}",
                statuses.0,
                text(a.1),
                statuses.1,
                text(b.1)
            ));
        }
    };
    let mut problems = Vec::new();
    problems.extend(expect_json("winner", winner.1, 200, &written(rev, T0)));
    problems.extend(expect_json(
        "loser",
        loser.1,
        409,
        &conflict(summary("auto", rev, T0, winner.0)),
    ));
    (!problems.is_empty()).then(|| format!("{round}: {}", problems.join("; ")))
}

/// Two devices write one slot at once: one wins, the other gets a 409 naming the winner; never a 500, never two
/// 200s. A regression guard: a single atomic statement has no deterministic red.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn saves_concurrent_writes_one_wins() {
    let (st, _dir) = saves_state(&[ANN]).await;
    let mut failures = Vec::new();
    let rounds = [
        ("race null/w1 vs null/w2", None, ["w1", "w2"], 1),
        ("race 1/w3 vs 1/w4", Some(1), ["w3", "w4"], 2),
    ];
    for (round, expected_rev, ids, rev) in rounds {
        let (a, b) = tokio::join!(
            put(&st, ANN, "auto", request(expected_rev, ids[0])),
            put(&st, ANN, "auto", request(expected_rev, ids[1])),
        );
        failures.extend(race_failure(round, (ids[0], &a), (ids[1], &b), rev));
        let got = rows(&st, ANN).await;
        let one_of = ids.map(|id| vec![row("auto", rev, id, T0)]);
        if !one_of.contains(&got) {
            failures.push(format!(
                "{round}: rows: expected one of {one_of:?}, got {got:?}"
            ));
        }
    }
    report(&failures);
}
