//! Saves: one row per (user, story, slot) behind an optimistic `rev`, the one retry contract (`writeId`), the size
//! and JSON checks at the edge, and rows keyed by the token's user. Every request goes through the production router.

use std::sync::Arc;

use axum::body::Body;
use axum::http::Request;
use axum::http::header::{AUTHORIZATION, CACHE_CONTROL, CONTENT_TYPE};
use serde_json::{Value, json};
use server::AppState;
use server::auth::issue_token;
use server::clock::FixedClock;
use server::ids::UserId;

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
async fn saves_state(users: &[i64]) -> (AppState, common::TestDb) {
    let (st, db) = common::test_state().await;
    let st = st.with_clock(Arc::new(FixedClock(T0)));
    for &id in users {
        st.repo
            .upsert_user(UserId(id), "Ann", None, T0)
            .await
            .unwrap();
    }
    (st, db)
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

/// The envelope of most writes here: a chapter of `manor`.
const ENV1: Envelope<'static> = ("ch1", "v1", Some("ch1.k1.l3"));

/// The envelope of the `tide` writes: a chapter of `tide`.
const ENV_TIDE: Envelope<'static> = ("ch3", "v1", Some("ch3.k1.l1"));

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

/// `PUT /api{path}` as `user`, with `body` sent as JSON.
async fn put_path(st: &AppState, user: i64, path: &str, body: String) -> common::Reply {
    let req = Request::put(format!("/api{path}"))
        .header(AUTHORIZATION, bearer(st, user))
        .header(CONTENT_TYPE, "application/json")
        .body(Body::from(body))
        .unwrap();
    common::call(st, req).await
}

/// `PUT /api/saves/{story}/{slot}` as `user`, with `body` sent as JSON.
async fn put_in(st: &AppState, user: i64, story: &str, slot: &str, body: String) -> common::Reply {
    put_path(st, user, &format!("/saves/{story}/{slot}"), body).await
}

/// `PUT /api/saves/manor/{slot}` as `user`, with `body` sent as JSON.
async fn put(st: &AppState, user: i64, slot: &str, body: String) -> common::Reply {
    put_in(st, user, "manor", slot, body).await
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

/// A `saves` row as the database holds it: (story_id, slot, rev, write_id, body, saved_at).
type Row = (String, String, i64, String, String, i64);

/// The row a write to `story` with the body of `write_id` leaves.
fn row_in(story: &str, slot: &str, rev: i64, write_id: &str, saved_at: i64) -> Row {
    (
        story.to_owned(),
        slot.to_owned(),
        rev,
        write_id.to_owned(),
        save_body(write_id),
        saved_at,
    )
}

/// The row a write to `manor` with the body of `write_id` leaves.
fn row(slot: &str, rev: i64, write_id: &str, saved_at: i64) -> Row {
    row_in("manor", slot, rev, write_id, saved_at)
}

/// Every `saves` row of `user`, read outside the app pool, by story then slot.
async fn rows(st: &AppState, user: i64) -> Vec<Row> {
    let mut db = common::raw_db(st).await;
    sqlx::query_as(
        "SELECT story_id, slot, rev, write_id, body, saved_at FROM saves WHERE user_id = $1 \
         ORDER BY story_id, slot",
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

/// Inserts `user`'s row `row_in(story, slot, 1, write_id, T0)` outside the app, with [`ENV1`]: a row of a story the
/// index may not hold (a story removed by a later build).
async fn insert_raw(st: &AppState, user: i64, story: &str, slot: &str, write_id: &str) {
    let mut db = common::raw_db(st).await;
    sqlx::query(
        "INSERT INTO saves (user_id, story_id, slot, rev, chapter_id, story_version, line_id, write_id, body, \
         saved_at) VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $8, $9)",
    )
    .bind(user)
    .bind(story)
    .bind(slot)
    .bind(ENV1.0)
    .bind(ENV1.1)
    .bind(ENV1.2)
    .bind(write_id)
    .bind(save_body(write_id))
    .bind(T0)
    .execute(&mut db)
    .await
    .unwrap();
}

#[tokio::test]
async fn saves_create_then_conflict() {
    let (st, _db) = saves_state(&[ANN]).await;
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

    let reply = get(&st, Some(ANN), "/saves/manor/auto").await;
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
    let (st, _db) = saves_state(&[ANN]).await;
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
    let reply = get(&st, Some(ANN), "/saves/manor/s2").await;
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
    let (st, _db) = saves_state(&[ANN]).await;
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

/// Opens a raw READ COMMITTED transaction on `st`'s database (the stand-in for a concurrent app writer: raw
/// connections run under the test database's hostile `repeatable read` default) and runs `sql` in it, uncommitted.
async fn hold_row(st: &AppState, sql: &'static str) -> sqlx::PgConnection {
    let mut a = common::raw_db(st).await;
    sqlx::raw_sql("BEGIN ISOLATION LEVEL READ COMMITTED")
        .execute(&mut a)
        .await
        .unwrap();
    sqlx::query(sql)
        .bind(ANN)
        .bind(save_body("wA"))
        .bind(T0 + 1)
        .execute(&mut a)
        .await
        .unwrap();
    a
}

/// Commits the transaction [`hold_row`] opened.
async fn commit(mut a: sqlx::PgConnection) {
    sqlx::raw_sql("COMMIT").execute(&mut a).await.unwrap();
    sqlx::Connection::close(a).await.unwrap();
}

/// A writer A holds the slot's row with rev 2 uncommitted. The app's PUT `{expectedRev: 1}` is seen waiting on the
/// row lock, then A commits: READ COMMITTED re-checks `rev = 1` on A's row version, so the PUT writes nothing and
/// answers 409 naming A's row. Deterministic, unlike `saves_concurrent_writes_one_wins`.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn saves_update_waits_for_winner_then_conflicts() {
    let (st, _db) = saves_state(&[ANN]).await;
    let mut failures = Vec::new();
    let reply = put(&st, ANN, "auto", request(None, "w1")).await;
    failures.extend(expect_json(
        "PUT auto null/w1 (setup)",
        &reply,
        200,
        &written(1, T0),
    ));

    let a = hold_row(
        &st,
        "UPDATE saves SET rev = 2, write_id = 'wA', body = $2, saved_at = $3 \
         WHERE user_id = $1 AND story_id = 'manor' AND slot = 'auto'",
    )
    .await;
    let app = st.clone();
    let pending = tokio::spawn(async move { put(&app, ANN, "auto", request(Some(1), "w2")).await });
    common::wait_for_lock_waiter(&st).await;
    commit(a).await;
    let reply = pending.await.unwrap();
    failures.extend(expect_json(
        "PUT auto 1/w2 behind A's rev 2",
        &reply,
        409,
        &conflict(summary("auto", 2, T0 + 1, "wA")),
    ));
    failures.extend(
        expect_rows(
            "after A's commit",
            &st,
            ANN,
            &[row("auto", 2, "wA", T0 + 1)],
        )
        .await,
    );
    report(&failures);
}

/// A writer A holds an uncommitted INSERT of the empty slot. The app's PUT `{expectedRev: null}` is seen waiting on
/// it (the INSERT's arbiter), then A commits: `ON CONFLICT DO NOTHING` skips, and the PUT answers 409 naming A's row.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn saves_create_waits_for_winner_then_conflicts() {
    let (st, _db) = saves_state(&[ANN]).await;
    let mut failures = Vec::new();
    let a = hold_row(
        &st,
        "INSERT INTO saves (user_id, story_id, slot, rev, chapter_id, story_version, line_id, write_id, body, \
         saved_at) VALUES ($1, 'manor', 'auto', 1, 'ch1', 'v1', 'ch1.k1.l3', 'wA', $2, $3)",
    )
    .await;
    let app = st.clone();
    let pending = tokio::spawn(async move { put(&app, ANN, "auto", request(None, "w2")).await });
    common::wait_for_lock_waiter(&st).await;
    commit(a).await;
    let reply = pending.await.unwrap();
    failures.extend(expect_json(
        "PUT auto null/w2 behind A's insert",
        &reply,
        409,
        &conflict(summary("auto", 1, T0 + 1, "wA")),
    ));
    failures.extend(
        expect_rows(
            "after A's commit",
            &st,
            ANN,
            &[row("auto", 1, "wA", T0 + 1)],
        )
        .await,
    );
    report(&failures);
}

/// The one retry contract: a PUT whose `writeId` equals the stored row's gets 200 with the stored `rev` and `savedAt`
/// and writes nothing, whatever its `expectedRev`. Only the stored row's `writeId` replays: an older one conflicts.
#[tokio::test]
async fn saves_retry_same_write_id_ok() {
    let (st, _db) = saves_state(&[ANN]).await;
    let mut failures = Vec::new();

    // (1) A create, then its retry later with another body: the stored answer, the stored row.
    let reply = put(&st, ANN, "auto", request(None, "w1")).await;
    failures.extend(expect_json(
        "PUT auto null/w1",
        &reply,
        200,
        &written(1, T0),
    ));
    let retry = request_with(None, "w1", ENV1, &save_body("w1 again")).to_string();
    let reply = put(&at(&st, T0 + 5), ANN, "auto", retry).await;
    failures.extend(expect_json(
        "retry null/w1 at T0+5 with another body",
        &reply,
        200,
        &written(1, T0),
    ));
    failures.extend(
        expect_rows(
            "after the retry of w1",
            &st,
            ANN,
            &[row("auto", 1, "w1", T0)],
        )
        .await,
    );

    // (2) An update, then its retry.
    let reply = put(&at(&st, T0 + 10), ANN, "auto", request(Some(1), "w2")).await;
    failures.extend(expect_json(
        "PUT auto 1/w2 at T0+10",
        &reply,
        200,
        &written(2, T0 + 10),
    ));
    let reply = put(&at(&st, T0 + 15), ANN, "auto", request(Some(1), "w2")).await;
    failures.extend(expect_json(
        "retry 1/w2 at T0+15",
        &reply,
        200,
        &written(2, T0 + 10),
    ));

    // (3) The stored writeId, whatever its expectedRev; (4) even the stored rev itself writes nothing.
    for expected_rev in [Some(99), None, Some(2)] {
        let case = format!("w2 with expectedRev {expected_rev:?} at T0+20");
        let reply = put(&at(&st, T0 + 20), ANN, "auto", request(expected_rev, "w2")).await;
        failures.extend(expect_json(&case, &reply, 200, &written(2, T0 + 10)));
    }
    failures.extend(
        expect_rows(
            "after the retries of w2",
            &st,
            ANN,
            &[row("auto", 2, "w2", T0 + 10)],
        )
        .await,
    );

    // (5) Control: w1 is no longer the stored writeId, so it is a conflict naming w2.
    let reply = put(&at(&st, T0 + 25), ANN, "auto", request(Some(1), "w1")).await;
    failures.extend(expect_json(
        "the older w1 with expectedRev 1",
        &reply,
        409,
        &conflict(summary("auto", 2, T0 + 10, "w2")),
    ));
    report(&failures);
}

/// A JSON object of exactly `len` bytes: braces around spaces, so it needs no escape inside the request.
fn body_of_len(len: usize) -> String {
    format!("{{{}}}", " ".repeat(len - 2))
}

/// A `PutSaveRequest` of exactly `len` bytes carrying `body`: JSON whitespace before the closing brace, so the
/// request size and the body size vary independently.
fn padded_request(expected_rev: Option<i64>, write_id: &str, body: &str, len: usize) -> String {
    let mut req = request_with(expected_rev, write_id, ENV1, body).to_string();
    assert!(
        req.len() <= len,
        "the request without padding is over {len} bytes"
    );
    req.insert_str(req.len() - 1, &" ".repeat(len - req.len()));
    assert_eq!(req.len(), len, "request length arithmetic");
    req
}

/// `user`'s rows as (slot, rev, write_id, body length).
async fn row_sizes(st: &AppState, user: i64) -> Vec<(String, i64, String, usize)> {
    rows(st, user)
        .await
        .into_iter()
        .map(|(_, slot, rev, write_id, body, _)| (slot, rev, write_id, body.len()))
        .collect()
}

const PAYLOAD_TOO_LARGE: &str = r#"{"error":"payload_too_large"}"#;
const BAD_REQUEST: &str = r#"{"error":"bad_request"}"#;
const NOT_FOUND: &str = r#"{"error":"not_found"}"#;

/// The body cap is 262 144 bytes (the CHECK's limit) and the save request limit 300 x 1024 bytes, over the 16 KB
/// default of every other route; each boundary is exact.
#[tokio::test]
async fn saves_body_too_large_413() {
    let (st, _db) = saves_state(&[ANN]).await;
    let mut failures = Vec::new();
    let at_cap = body_of_len(262_144);

    let body = request_with(None, "w1", ENV1, &at_cap).to_string();
    let reply = put(&st, ANN, "auto", body).await;
    failures.extend(expect_json(
        "body of 262144 bytes (control)",
        &reply,
        200,
        &written(1, T0),
    ));
    let body = request_with(Some(1), "w2", ENV1, &body_of_len(262_145)).to_string();
    let reply = put(&st, ANN, "auto", body).await;
    failures.extend(expect_text(
        "body of 262145 bytes",
        &reply,
        413,
        PAYLOAD_TOO_LARGE,
    ));

    let req = padded_request(None, "w3", &at_cap, 307_200);
    let reply = put(&st, ANN, "s1", req).await;
    failures.extend(expect_json(
        "request of 307200 bytes",
        &reply,
        200,
        &written(1, T0),
    ));
    let req = padded_request(None, "w4", &at_cap, 307_201);
    let reply = put(&st, ANN, "s2", req).await;
    failures.extend(expect_text(
        "request of 307201 bytes",
        &reply,
        413,
        PAYLOAD_TOO_LARGE,
    ));

    let got = row_sizes(&st, ANN).await;
    let want = vec![
        ("auto".to_owned(), 1, "w1".to_owned(), 262_144),
        ("s1".to_owned(), 1, "w3".to_owned(), 262_144),
    ];
    if got != want {
        failures.push(format!(
            "rows (slot, rev, write_id, body length): expected {want:?}, got {got:?}"
        ));
    }
    report(&failures);
}

/// The body cap counts UTF-8 bytes, not characters: a body of 2-byte characters over 262 144 bytes but under
/// 262 144 characters is refused (413) and writes nothing; a body of exactly 262 144 bytes is admitted. The edge
/// and the CHECK (`octet_length`) both count the bytes the client measures with `TextEncoder`.
#[tokio::test]
async fn saves_body_cap_counts_utf8_bytes_413() {
    let (st, _db) = saves_state(&[ANN]).await;
    let mut failures = Vec::new();
    // `{"a":"` + n x U+0436 (Cyrillic, 2 bytes in UTF-8) + `"}` = 8 + 2n bytes, 8 + n characters.
    let doc = |n: usize| format!("{{\"a\":\"{}\"}}", "\u{436}".repeat(n));
    let at_cap = doc(131_068);
    assert_eq!(at_cap.len(), 262_144, "body arithmetic: bytes at the cap");
    let over = doc(131_069);
    assert_eq!(over.len(), 262_146, "body arithmetic: bytes over the cap");
    assert_eq!(
        over.chars().count(),
        131_077,
        "body arithmetic: characters over the cap"
    );

    let body = request_with(None, "w1", ENV1, &at_cap).to_string();
    let reply = put(&st, ANN, "auto", body).await;
    failures.extend(expect_json(
        "2-byte body of 262144 bytes (control)",
        &reply,
        200,
        &written(1, T0),
    ));
    let body = request_with(Some(1), "w2", ENV1, &over).to_string();
    let reply = put(&st, ANN, "auto", body).await;
    failures.extend(expect_text(
        "2-byte body of 262146 bytes, 131077 chars",
        &reply,
        413,
        PAYLOAD_TOO_LARGE,
    ));

    let got = row_sizes(&st, ANN).await;
    let want = vec![("auto".to_owned(), 1, "w1".to_owned(), 262_144)];
    if got != want {
        failures.push(format!(
            "rows (slot, rev, write_id, body bytes): expected {want:?}, got {got:?}"
        ));
    }
    report(&failures);
}

/// The body must be one JSON document: checked at the edge (400), not left to the CHECK (500).
#[tokio::test]
async fn saves_body_not_json_400() {
    let (st, _db) = saves_state(&[ANN]).await;
    let mut failures = Vec::new();
    for (case, write_id, body) in [
        ("body `not json`", "w1", "not json"),
        ("body `{\"a\":1} x`", "w2", r#"{"a":1} x"#),
    ] {
        let req = request_with(None, write_id, ENV1, body).to_string();
        let reply = put(&st, ANN, "auto", req).await;
        failures.extend(expect_text(case, &reply, 400, BAD_REQUEST));
    }
    let req = request_with(None, "w3", ENV1, r#"{"a":1}"#).to_string();
    let reply = put(&st, ANN, "auto", req).await;
    failures.extend(expect_json(
        "body `{\"a\":1}` (control)",
        &reply,
        200,
        &written(1, T0),
    ));
    report(&failures);
}

/// The body is stored byte for byte (`TEXT`, never `jsonb`): whitespace, key order, a duplicate key and a number's
/// spelling come back as sent, through GET and in the row. `s1` holds only what `jsonb` would rewrite but accept, so
/// a `jsonb` store shows its rewrite there; `s2` adds the `\u0000` escape, which `IS JSON` admits and `jsonb` refuses.
#[tokio::test]
async fn saves_body_round_trips_bytes() {
    let (st, _db) = saves_state(&[ANN]).await;
    let mut failures = Vec::new();
    let rewritable = r#"{ "b" : 1,  "a" : [ 1.230e-5 , true ],
 "b" : 2 }"#;
    let with_nul_escape = r#"{ "b" : 1,  "a" : [ 1.230e-5 , "\u0000" ],
 "b" : 2 }"#;
    let bodies = [("s1", "w1", rewritable), ("s2", "w2", with_nul_escape)];
    for (slot, write_id, body) in bodies {
        let req = request_with(None, write_id, ENV1, body).to_string();
        let reply = put(&st, ANN, slot, req).await;
        failures.extend(expect_json(
            &format!("PUT {slot}"),
            &reply,
            200,
            &written(1, T0),
        ));
        let reply = get(&st, Some(ANN), &format!("/saves/manor/{slot}")).await;
        let got: Value = serde_json::from_slice(&reply.body).unwrap_or(Value::Null);
        if reply.status.as_u16() != 200 || got["body"].as_str() != Some(body) {
            failures.push(format!(
                "GET {slot}: expected 200 with the body {body:?} byte for byte, got {} {:?}",
                reply.status.as_u16(),
                got["body"]
            ));
        }
    }
    let want: Vec<Row> = bodies
        .iter()
        .map(|(slot, write_id, body)| {
            (
                "manor".to_owned(),
                (*slot).to_owned(),
                1,
                (*write_id).to_owned(),
                (*body).to_owned(),
                T0,
            )
        })
        .collect();
    failures.extend(expect_rows("the stored bodies", &st, ANN, &want).await);
    report(&failures);
}

/// PostgreSQL `text` cannot hold U+0000, so a text field carrying it is refused at the edge (400), never left to the
/// database (`22021`, a 500), and writes nothing. In the body a raw U+0000 is not JSON (400); the `\u0000` escape is
/// JSON text without a NUL byte and is stored (the control).
#[tokio::test]
async fn saves_nul_in_text_field_400() {
    let (st, _db) = saves_state(&[ANN]).await;
    let mut failures = Vec::new();
    let nul = "a\u{0}b";
    let body = save_body("w1");
    let cases = [
        (
            "chapterId",
            request_with(None, "w1", (nul, "v1", Some("ch1.k1.l3")), &body),
        ),
        (
            "storyVersion",
            request_with(None, "w1", ("ch1", nul, Some("ch1.k1.l3")), &body),
        ),
        (
            "lineId",
            request_with(None, "w1", ("ch1", "v1", Some(nul)), &body),
        ),
        ("writeId", request_with(None, nul, ENV1, &body)),
        (
            "body (raw, inside a JSON string)",
            request_with(None, "w1", ENV1, "{\"a\":\"a\u{0}b\"}"),
        ),
    ];
    for (field, req) in cases {
        let reply = put(&st, ANN, "auto", req.to_string()).await;
        failures.extend(expect_text(
            &format!("{field} with U+0000"),
            &reply,
            400,
            BAD_REQUEST,
        ));
    }
    failures.extend(expect_rows("after the refusals", &st, ANN, &[]).await);
    let escaped = request_with(None, "w2", ENV1, r#"{"a":"a\u0000b"}"#).to_string();
    let reply = put(&st, ANN, "auto", escaped).await;
    failures.extend(expect_json(
        "body with the \\u0000 escape (control)",
        &reply,
        200,
        &written(1, T0),
    ));
    report(&failures);
}

/// The edge parses the body with serde_json's recursion limit, so it is stricter than `IS JSON` on depth: 127 nested
/// arrays are stored, 128 are refused (400) although the CHECK would admit them.
#[tokio::test]
async fn saves_body_too_deep_400() {
    let (st, _db) = saves_state(&[ANN]).await;
    let mut failures = Vec::new();
    let nested = |depth: usize| format!("{}{}", "[".repeat(depth), "]".repeat(depth));
    let req = request_with(None, "w1", ENV1, &nested(127)).to_string();
    let reply = put(&st, ANN, "auto", req).await;
    failures.extend(expect_json(
        "depth 127 (control)",
        &reply,
        200,
        &written(1, T0),
    ));
    let req = request_with(None, "w2", ENV1, &nested(128)).to_string();
    let reply = put(&st, ANN, "s1", req).await;
    failures.extend(expect_text("depth 128", &reply, 400, BAD_REQUEST));
    report(&failures);
}

/// A slot outside `auto, s1, s2, s3` is 400 on GET and PUT; the token is checked before the slot.
#[tokio::test]
async fn saves_bad_slot_400() {
    let (st, _db) = saves_state(&[ANN]).await;
    let mut failures = Vec::new();
    for path in ["/saves/manor/s4", "/saves/manor/AUTO"] {
        let reply = get(&st, Some(ANN), path).await;
        failures.extend(expect_text(
            &format!("GET {path}"),
            &reply,
            400,
            BAD_REQUEST,
        ));
    }
    for slot in ["x", "s0"] {
        let reply = put(&st, ANN, slot, request(None, "w1")).await;
        failures.extend(expect_text(
            &format!("PUT /saves/manor/{slot}"),
            &reply,
            400,
            BAD_REQUEST,
        ));
    }
    let reply = get(&st, Some(ANN), "/saves/manor/s1").await;
    failures.extend(expect_text(
        "GET /saves/manor/s1, no row (control)",
        &reply,
        404,
        NOT_FOUND,
    ));
    let reply = put(&st, ANN, "s3", request(None, "w2")).await;
    failures.extend(expect_json(
        "PUT /saves/manor/s3 (control)",
        &reply,
        200,
        &written(1, T0),
    ));
    let reply = get(&st, None, "/saves/manor/x").await;
    failures.extend(expect_text(
        "GET /saves/manor/x without a token",
        &reply,
        401,
        r#"{"error":"token_missing"}"#,
    ));
    report(&failures);
}

/// Rows are keyed by the token's user: another user's slot is invisible to every read, and no write, conflict read
/// or replay of one user ever touches or reveals another user's row.
#[tokio::test]
async fn saves_other_user_404() {
    const BOB: i64 = 1002;
    let (st, _db) = saves_state(&[ANN, BOB]).await;
    let mut failures = Vec::new();
    let reply = put(&st, ANN, "s1", request(None, "w1")).await;
    failures.extend(expect_json(
        "1001 PUT s1 null/w1",
        &reply,
        200,
        &written(1, T0),
    ));

    // Bob has no s1: a conflict with no `current`, whether his expectedRev and writeId match Ann's row or not.
    for (case, write_id) in [
        ("1002 PUT s1 1/w9 (Ann's rev)", "w9"),
        ("1002 PUT s1 1/w1 (Ann's rev and writeId)", "w1"),
    ] {
        let reply = put(&st, BOB, "s1", request(Some(1), write_id)).await;
        failures.extend(expect_text(
            case,
            &reply,
            409,
            r#"{"error":"save_conflict"}"#,
        ));
    }
    failures.extend(expect_rows("after Bob's 409s", &st, ANN, &[row("s1", 1, "w1", T0)]).await);
    let reply = get(&st, Some(BOB), "/saves/manor/s1").await;
    failures.extend(expect_text("1002 GET s1", &reply, 404, NOT_FOUND));
    let reply = get(&st, Some(BOB), "/saves").await;
    failures.extend(expect_json(
        "1002 GET list",
        &reply,
        200,
        &json!({ "slots": [] }),
    ));

    // Bob's own s1: created and updated beside Ann's, never over it.
    let reply = put(&st, BOB, "s1", request(None, "w2")).await;
    failures.extend(expect_json(
        "1002 PUT s1 null/w2",
        &reply,
        200,
        &written(1, T0),
    ));
    let reply = put(&st, BOB, "s1", request(Some(1), "w3")).await;
    failures.extend(expect_json(
        "1002 PUT s1 1/w3",
        &reply,
        200,
        &written(2, T0),
    ));
    failures.extend(expect_rows("after Bob's writes", &st, ANN, &[row("s1", 1, "w1", T0)]).await);
    failures.extend(expect_rows("after Bob's writes", &st, BOB, &[row("s1", 2, "w3", T0)]).await);

    let reply = get(&st, Some(ANN), "/saves/manor/s1").await;
    failures.extend(expect_json(
        "1001 GET s1",
        &reply,
        200,
        &json!({ "summary": summary("s1", 1, T0, "w1"), "body": save_body("w1") }),
    ));
    let reply = put(&st, ANN, "s1", request(Some(5), "w4")).await;
    failures.extend(expect_json(
        "1001 PUT s1 5/w4: the conflict names Ann's row",
        &reply,
        409,
        &conflict(summary("s1", 1, T0, "w1")),
    ));
    report(&failures);
}

/// Each story has its own slots: a write, a conflict read or a replay in one story never touches or reveals the same
/// slot of another story. Both `auto` rows sit at rev 1 when manor's is updated, so an UPDATE that ignores the story
/// moves tide's too; tide's `s1` is empty while manor's holds `w5`, so a conflict read that ignores the story shows
/// manor's row (a `current`) or replays manor's `w5` (a 200).
#[tokio::test]
async fn saves_story_slots_independent() {
    let (st, _db) = saves_state(&[ANN]).await;
    let mut failures = Vec::new();
    let tide = |expected_rev, write_id: &str| {
        request_with(expected_rev, write_id, ENV_TIDE, &save_body(write_id)).to_string()
    };

    // (1) The same slot of two stories: two creates.
    let reply = put_in(&st, ANN, "manor", "auto", request(None, "w1")).await;
    failures.extend(expect_json(
        "PUT manor/auto null/w1",
        &reply,
        200,
        &written(1, T0),
    ));
    let reply = put_in(&st, ANN, "tide", "auto", tide(None, "w2")).await;
    failures.extend(expect_json(
        "PUT tide/auto null/w2",
        &reply,
        200,
        &written(1, T0),
    ));

    // (2) An update of manor's auto leaves tide's auto at rev 1.
    let reply = put_in(&st, ANN, "manor", "auto", request(Some(1), "w3")).await;
    failures.extend(expect_json(
        "PUT manor/auto 1/w3",
        &reply,
        200,
        &written(2, T0),
    ));
    let both_auto = [
        row_in("manor", "auto", 2, "w3", T0),
        row_in("tide", "auto", 1, "w2", T0),
    ];
    failures.extend(expect_rows("after manor's update", &st, ANN, &both_auto).await);

    // (3) Manor's s1 holds w5; tide's s1 is empty: a conflict with no `current`, never a replay of manor's w5.
    let reply = put_in(&st, ANN, "manor", "s1", request(None, "w5")).await;
    failures.extend(expect_json(
        "PUT manor/s1 null/w5 (setup)",
        &reply,
        200,
        &written(1, T0),
    ));
    for (case, write_id) in [
        ("PUT tide/s1 1/w6 (manor's rev)", "w6"),
        ("PUT tide/s1 1/w5 (manor's rev and writeId)", "w5"),
    ] {
        let reply = put_in(&st, ANN, "tide", "s1", tide(Some(1), write_id)).await;
        failures.extend(expect_text(
            case,
            &reply,
            409,
            r#"{"error":"save_conflict"}"#,
        ));
    }

    // (4) Every read is per story.
    let reply = get(&st, Some(ANN), "/saves/tide/s1").await;
    failures.extend(expect_text("GET tide/s1", &reply, 404, NOT_FOUND));
    let reply = get(&st, Some(ANN), "/saves/manor/auto").await;
    failures.extend(expect_json(
        "GET manor/auto",
        &reply,
        200,
        &json!({ "summary": summary("auto", 2, T0, "w3"), "body": save_body("w3") }),
    ));
    let reply = get(&st, Some(ANN), "/saves/tide/auto").await;
    failures.extend(expect_json(
        "GET tide/auto",
        &reply,
        200,
        &json!({
            "summary": summary_with("auto", 1, ENV_TIDE, T0, "w2"),
            "body": save_body("w2"),
        }),
    ));

    // (5) The one-segment path of before is no route; the rows are exactly the three writes.
    let reply = put_path(&st, ANN, "/saves/auto", request(None, "w7")).await;
    if reply.status.as_u16() != 404 {
        failures.push(format!(
            "PUT /saves/auto (old path): expected 404, got {} {:?}",
            reply.status.as_u16(),
            text(&reply)
        ));
    }
    let want = [
        row_in("manor", "auto", 2, "w3", T0),
        row_in("manor", "s1", 1, "w5", T0),
        row_in("tide", "auto", 1, "w2", T0),
    ];
    failures.extend(expect_rows("at the end", &st, ANN, &want).await);
    report(&failures);
}

/// A story the index does not hold is 404 `not_found` on GET and PUT and writes nothing, even when a row of it is
/// stored (a story a later build dropped: the index is checked before the row, and the row stays); the shapes are
/// checked before the index (400).
#[tokio::test]
async fn saves_unknown_story_404() {
    let (st, _db) = saves_state(&[ANN]).await;
    let mut failures = Vec::new();

    let reply = put_in(&st, ANN, "nope", "auto", request(None, "w1")).await;
    failures.extend(expect_text("PUT nope/auto", &reply, 404, NOT_FOUND));
    failures.extend(expect_no_store("PUT nope/auto", &reply));
    failures.extend(expect_rows("after PUT nope/auto", &st, ANN, &[]).await);
    let reply = get(&st, Some(ANN), "/saves/nope/auto").await;
    failures.extend(expect_text("GET nope/auto", &reply, 404, NOT_FOUND));
    failures.extend(expect_no_store("GET nope/auto", &reply));

    insert_raw(&st, ANN, "gone", "auto", "wG").await;
    let reply = get(&st, Some(ANN), "/saves/gone/auto").await;
    failures.extend(expect_text(
        "GET gone/auto with a stored row",
        &reply,
        404,
        NOT_FOUND,
    ));
    let gone = [row_in("gone", "auto", 1, "wG", T0)];
    failures.extend(expect_rows("after GET gone/auto", &st, ANN, &gone).await);

    let reply = get(&st, Some(ANN), "/saves/nope/x").await;
    failures.extend(expect_text(
        "GET nope/x (slot shape before the index)",
        &reply,
        400,
        BAD_REQUEST,
    ));
    report(&failures);
}

/// A save names a chapter of its own story: another story's chapter, an unknown chapter or a malformed id is 400
/// and writes nothing.
#[tokio::test]
async fn saves_chapter_outside_story_400() {
    let (st, _db) = saves_state(&[ANN]).await;
    let mut failures = Vec::new();
    // A slot per case, so each refusal stands on its own (an admitted case writes a row no later case meets).
    for (case, slot, write_id, env) in [
        ("tide's ch3", "auto", "w1", ENV_TIDE),
        ("ch9 of no story", "s1", "w2", ("ch9", "v1", None)),
        ("x, no chapter shape", "s2", "w3", ("x", "v1", None)),
    ] {
        let req = request_with(None, write_id, env, &save_body(write_id)).to_string();
        let reply = put_in(&st, ANN, "manor", slot, req).await;
        failures.extend(expect_text(
            &format!("PUT manor/{slot} with {case}"),
            &reply,
            400,
            BAD_REQUEST,
        ));
    }
    failures.extend(expect_rows("after the refusals", &st, ANN, &[]).await);

    let req = request_with(None, "w4", ENV_TIDE, &save_body("w4")).to_string();
    let reply = put_in(&st, ANN, "tide", "auto", req).await;
    failures.extend(expect_json(
        "PUT tide/auto with ch3 (control)",
        &reply,
        200,
        &written(1, T0),
    ));
    let tide = [row_in("tide", "auto", 1, "w4", T0)];
    failures.extend(expect_rows("after the control", &st, ANN, &tide).await);
    report(&failures);
}

/// A story id outside `^[a-z][a-z0-9_]{0,23}$` is 400 on GET and PUT (checked at the edge, not left to the CHECK's
/// 500) and writes nothing; the token is checked before the story.
#[tokio::test]
async fn saves_bad_story_id_400() {
    let (st, _db) = saves_state(&[ANN]).await;
    let mut failures = Vec::new();
    let too_long = format!("a{}", "b".repeat(24));
    // `%C3%A9` is `é` once the path segment is decoded.
    for story in ["Manor", "a-b", too_long.as_str(), "%C3%A9"] {
        let reply = get(&st, Some(ANN), &format!("/saves/{story}/auto")).await;
        failures.extend(expect_text(
            &format!("GET {story}/auto"),
            &reply,
            400,
            BAD_REQUEST,
        ));
        let reply = put_in(&st, ANN, story, "auto", request(None, "w1")).await;
        failures.extend(expect_text(
            &format!("PUT {story}/auto"),
            &reply,
            400,
            BAD_REQUEST,
        ));
    }
    failures.extend(expect_rows("after the refusals", &st, ANN, &[]).await);

    let reply = get(&st, None, "/saves/Manor/auto").await;
    failures.extend(expect_text(
        "GET Manor/auto without a token",
        &reply,
        401,
        r#"{"error":"token_missing"}"#,
    ));
    report(&failures);
}
