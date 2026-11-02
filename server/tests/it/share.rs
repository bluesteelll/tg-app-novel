//! `POST /api/share` (META-PLAN M14, F18) through the production router: the sharer's invite link, a text of the
//! story title and the sharer's own counts (never an ending or achievement title), the prepared inline message with
//! the link as its fallback, and the 20-per-hour window, on the it crate's `RecordingGateway`.
//!
//! User ids are at least 5 000 000 101, so no count, time or code fragment of a test can equal one.

use std::path::Path;
use std::sync::Arc;

use axum::body::Body;
use axum::http::header::{AUTHORIZATION, CACHE_CONTROL, CONTENT_TYPE, RETRY_AFTER};
use axum::http::{Method, Request, StatusCode};
use serde_json::{Value, json};
use server::AppState;
use server::clock::FixedClock;
use server::ids::UserId;
use server::telegram::gateway::{GatewayError, PreparedShare};
use sqlx::Connection;

use crate::cards::{stat, unlock};
use crate::catalog::{T0, own};
use crate::common;
use crate::content::{FIXTURE, read_json};
use crate::payments::{bearer_now, invoice_state};
use crate::social::id_paths;

/// The sharer.
const SHARER: i64 = 5_000_000_101;
/// A second user, with a window of their own.
const OTHER: i64 = 5_000_000_102;

/// The link of every share: the recorder's bot, then `startapp=f<invite code>`.
const LINK_PREFIX: &str = "https://t.me/novel_dev_bot?startapp=f";

fn report(failures: &[String]) {
    assert!(
        failures.is_empty(),
        "{} failures:\n{}",
        failures.len(),
        failures.join("\n")
    );
}

fn body_json(reply: &common::Reply) -> Value {
    serde_json::from_slice(&reply.body).unwrap_or(Value::Null)
}

fn body_text(reply: &common::Reply) -> String {
    String::from_utf8_lossy(&reply.body).into_owned()
}

/// A header of `reply` as text (`None` when absent or not visible ASCII).
fn header<'a>(reply: &'a common::Reply, name: &axum::http::HeaderName) -> Option<&'a str> {
    reply.headers.get(name).and_then(|v| v.to_str().ok())
}

/// `POST /api/share` with `body`, as `user` (a token at the state's own clock) or without `Authorization`.
async fn post_share(st: &AppState, user: Option<i64>, body: &Value) -> common::Reply {
    let mut req = Request::post("/api/share").header(CONTENT_TYPE, "application/json");
    if let Some(user) = user {
        req = req.header(AUTHORIZATION, bearer_now(st, user));
    }
    common::call(st, req.body(Body::from(body.to_string())).unwrap()).await
}

/// `method path` without a body, as `user` (a token at the state's own clock).
async fn send(st: &AppState, method: Method, user: i64, path: &str) -> common::Reply {
    let req = Request::builder()
        .method(method)
        .uri(path)
        .header(AUTHORIZATION, bearer_now(st, user));
    common::call(st, req.body(Body::empty()).unwrap()).await
}

/// A `ShareRequest` body.
fn share_body(story: Option<&str>, lang: &str, native: bool) -> Value {
    json!({ "storyId": story, "lang": lang, "native": native })
}

/// `user`'s invite code, through `GET /api/social` (which creates it on the first call).
async fn invite_code(st: &AppState, user: i64) -> String {
    let reply = send(st, Method::GET, user, "/api/social").await;
    match body_json(&reply)["inviteCode"].as_str() {
        Some(code) if reply.status == StatusCode::OK => code.to_owned(),
        _ => panic!(
            "GET /api/social as {user}: expected 200 with an inviteCode, got {} {}",
            reply.status.as_u16(),
            body_text(&reply)
        ),
    }
}

/// `server/locales/meta.json`, read at test time: the expected texts come from the file, not a copy of it. A file
/// that is missing or not JSON is `null`, so every expected text then mismatches (a red, never a panic before the
/// route's answer is seen).
async fn locale_texts() -> Value {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/locales/meta.json");
    tokio::fs::read(path)
        .await
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or(Value::Null)
}

/// The `share_story` template of `lang` with the story title and the counts.
fn story_text(locale: &Value, lang: &str, story: &str, endings: u32, achievements: u32) -> String {
    locale[lang]["share_story"]
        .as_str()
        .unwrap_or("<no share_story>")
        .replace("{story}", story)
        .replace("{endings}", &endings.to_string())
        .replace("{achievements}", &achievements.to_string())
}

/// Every text of the fixture's meta index: each ending title and each achievement name and description, of both
/// stories, in both languages.
async fn meta_texts() -> Vec<String> {
    let meta = read_json(&Path::new(FIXTURE).join("meta.json")).await;
    let mut texts = Vec::new();
    let mut push = |localized: &Value| {
        for lang in ["ru", "en"] {
            if let Some(text) = localized[lang].as_str() {
                texts.push(text.to_owned());
            }
        }
    };
    for story in meta["stories"]
        .as_object()
        .into_iter()
        .flat_map(|m| m.values())
    {
        for title in story["endings"]
            .as_object()
            .into_iter()
            .flat_map(|m| m.values())
        {
            push(title);
        }
        for achievement in story["achievements"].as_array().into_iter().flatten() {
            push(&achievement["name"]);
            push(&achievement["desc"]);
        }
    }
    texts
}

/// `None` when `reply` is a 200 `ShareResponse` with exactly its three keys, `link` and `text` as given and
/// `preparedMessageId` as given, `private, no-store`; else the failure line.
fn share_is(
    case: &str,
    reply: &common::Reply,
    link: &str,
    text: &str,
    prepared: Option<&str>,
) -> Option<String> {
    let want = json!({ "link": link, "text": text, "preparedMessageId": prepared });
    let cache = header(reply, &CACHE_CONTROL);
    (reply.status != StatusCode::OK
        || body_json(reply) != want
        || cache != Some("private, no-store"))
    .then(|| {
        format!(
            "{case}: expected 200 {want} private, no-store, got {} {} {cache:?}",
            reply.status.as_u16(),
            body_text(reply)
        )
    })
}

/// `None` when `reply` is `status` with exactly `{"error":"<code>"}`, else the failure line.
fn error_is(case: &str, reply: &common::Reply, status: u16, code: &str) -> Option<String> {
    (reply.status.as_u16() != status || body_json(reply) != json!({ "error": code })).then(|| {
        format!(
            "{case}: expected {status} {{\"error\":\"{code}\"}}, got {} {}",
            reply.status.as_u16(),
            body_text(reply)
        )
    })
}

/// The share text holds the story title and the sharer's counts, never a meta text (M14, principle 0): the sharer
/// found both tide endings (one in the paid ch4, owned) and both achievements (both gated on ch4), and in either
/// language neither the response nor the prepared message (title, text, button) carries any ending title or
/// achievement name or description of the fixture.
#[tokio::test]
async fn share_text_has_no_titles() {
    let (st, _db, gateway) = invoice_state(&[(SHARER, Some("ru"))]).await;
    own(&st, SHARER, "chapter:ch4").await;
    stat(
        &st,
        SHARER,
        1,
        "ending_reached",
        "ch3",
        Some("drowned"),
        T0 - 100,
    )
    .await;
    stat(
        &st,
        SHARER,
        2,
        "ending_reached",
        "ch4",
        Some("dawn"),
        T0 - 50,
    )
    .await;
    let mut c = common::raw_db(&st).await;
    unlock(&mut c, SHARER, "tide", "lighthouse", T0 - 40)
        .await
        .unwrap();
    unlock(&mut c, SHARER, "tide", "dawn_walk", T0 - 30)
        .await
        .unwrap();
    c.close().await.unwrap();
    let forbidden = meta_texts().await;
    let mut failures = Vec::new();
    // 2 + 2 ending titles and 6 + 2 achievements with a name and a description, each in two languages: a fixture
    // read that went wrong cannot pass with an empty list.
    if forbidden.len() != 40 {
        failures.push(format!(
            "the fixture's meta texts: expected 40, got {}",
            forbidden.len()
        ));
    }
    let locale = locale_texts().await;
    let code = invite_code(&st, SHARER).await;
    let link = format!("{LINK_PREFIX}{code}");
    for (lang, title) in [("ru", "Прилив"), ("en", "The Tide")] {
        let reply = post_share(&st, Some(SHARER), &share_body(Some("tide"), lang, true)).await;
        let text = story_text(&locale, lang, title, 2, 2);
        let n = gateway.prepared_calls().len();
        let id = format!("test-prepared-{n}");
        failures.extend(share_is(lang, &reply, &link, &text, Some(&id)));
        let got = body_json(&reply)["text"]
            .as_str()
            .unwrap_or_default()
            .to_owned();
        let prepared = gateway
            .prepared_calls()
            .last()
            .map(|(_, share)| share.clone());
        let Some(prepared) = prepared else {
            failures.push(format!("{lang}: expected a prepared message, got none"));
            continue;
        };
        for (field, value) in [
            ("response text", got.as_str()),
            ("prepared title", prepared.title.as_str()),
            ("prepared text", prepared.text.as_str()),
            ("prepared button", prepared.button.as_str()),
        ] {
            for meta_text in forbidden.iter().filter(|t| value.contains(t.as_str())) {
                failures.push(format!(
                    "{lang}: the {field} {value:?} carries {meta_text:?}"
                ));
            }
        }
    }
    report(&failures);
}

/// The link is `https://t.me/<bot>?startapp=f<the sharer's invite code>` (M10, M14): after a rotation the next share
/// carries the new code. The response is `private, no-store` and holds the sharer's Telegram id nowhere.
#[tokio::test]
async fn share_link_carries_invite_code() {
    let (st, _db, _gateway) = invoice_state(&[(SHARER, Some("ru"))]).await;
    let locale = locale_texts().await;
    let invite = locale["ru"]["share_invite"]
        .as_str()
        .unwrap_or("<no share_invite>");
    let mut failures = Vec::new();
    let code = invite_code(&st, SHARER).await;
    let reply = post_share(&st, Some(SHARER), &share_body(None, "ru", false)).await;
    failures.extend(share_is(
        "first share",
        &reply,
        &format!("{LINK_PREFIX}{code}"),
        invite,
        None,
    ));
    let mut paths = Vec::new();
    id_paths(&body_json(&reply), "$", SHARER, &mut paths);
    if !paths.is_empty() || body_text(&reply).contains(&SHARER.to_string()) {
        failures.push(format!(
            "first share: the sharer's id is in the body at {paths:?}: {}",
            body_text(&reply)
        ));
    }

    let rotated = send(&st, Method::POST, SHARER, "/api/invite/rotate").await;
    let new_code = body_json(&rotated)["inviteCode"]
        .as_str()
        .unwrap_or_default()
        .to_owned();
    if rotated.status != StatusCode::OK || new_code.is_empty() || new_code == code {
        failures.push(format!(
            "rotate: expected 200 with a new inviteCode, got {} {}",
            rotated.status.as_u16(),
            body_text(&rotated)
        ));
    }
    let reply = post_share(&st, Some(SHARER), &share_body(Some("tide"), "ru", false)).await;
    let link = body_json(&reply)["link"]
        .as_str()
        .unwrap_or_default()
        .to_owned();
    if reply.status != StatusCode::OK || link != format!("{LINK_PREFIX}{new_code}") {
        failures.push(format!(
            "after the rotation: expected 200 with the link of {new_code}, got {} {}",
            reply.status.as_u16(),
            body_text(&reply)
        ));
    }
    report(&failures);
}

/// `native: true` prepares one inline message for the sharer (M14): its title and button in the request's language,
/// the response's text and link, and its id in the response.
#[tokio::test]
async fn share_prepares_inline_message_for_native() {
    let (st, _db, gateway) = invoice_state(&[(SHARER, Some("ru"))]).await;
    let mut failures = Vec::new();
    for (lang, title, button, n) in [
        ("ru", "Прогресс", "Открыть", 1),
        ("en", "Progress", "Open", 2),
    ] {
        let reply = post_share(&st, Some(SHARER), &share_body(Some("tide"), lang, true)).await;
        let json = body_json(&reply);
        let id = format!("test-prepared-{n}");
        if reply.status != StatusCode::OK || json["preparedMessageId"].as_str() != Some(id.as_str())
        {
            failures.push(format!(
                "{lang}: expected 200 with preparedMessageId {id}, got {} {}",
                reply.status.as_u16(),
                body_text(&reply)
            ));
        }
        let calls = gateway.prepared_calls();
        let Some((user, share)) = calls.last() else {
            failures.push(format!("{lang}: expected a prepared call, got none"));
            continue;
        };
        let result_id_ok = share.result_id.len() == 32
            && share
                .result_id
                .bytes()
                .all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'));
        let want = PreparedShare {
            result_id: share.result_id.clone(),
            title: title.to_owned(),
            text: json["text"].as_str().unwrap_or_default().to_owned(),
            button: button.to_owned(),
            url: json["link"].as_str().unwrap_or_default().to_owned(),
        };
        if calls.len() != n || *user != UserId(SHARER) || *share != want || !result_id_ok {
            failures.push(format!(
                "{lang}: expected call {n} by {SHARER} with {want:?} and a 32-hex result id, got {calls:?}"
            ));
        }
    }
    report(&failures);
}

/// `native: false` gets the link and the text only: no prepared message is asked for.
#[tokio::test]
async fn share_without_native_returns_link_only() {
    let (st, _db, gateway) = invoice_state(&[(SHARER, Some("ru"))]).await;
    let locale = locale_texts().await;
    let code = invite_code(&st, SHARER).await;
    let mut failures = Vec::new();
    let reply = post_share(&st, Some(SHARER), &share_body(Some("tide"), "ru", false)).await;
    failures.extend(share_is(
        "native false",
        &reply,
        &format!("{LINK_PREFIX}{code}"),
        &story_text(&locale, "ru", "Прилив", 0, 0),
        None,
    ));
    let prepared = gateway.prepared_calls();
    if !prepared.is_empty() {
        failures.push(format!(
            "native false: expected no prepared call, got {prepared:?}"
        ));
    }
    report(&failures);
}

/// A failed prepare falls back to the link (M14): 200 with a null id and the link and text intact. An unknown bot
/// username is 502 `telegram_unavailable` even without `native` (the link needs it); once the Bot API answers, 200.
#[tokio::test]
async fn share_prepare_failure_falls_back_to_link() {
    let (st, _db, gateway) = invoice_state(&[(SHARER, Some("ru"))]).await;
    let locale = locale_texts().await;
    let code = invite_code(&st, SHARER).await;
    let link = format!("{LINK_PREFIX}{code}");
    let text = story_text(&locale, "ru", "Прилив", 0, 0);
    let mut failures = Vec::new();

    gateway.fail_prepare_with(Some(GatewayError::Timeout));
    let reply = post_share(&st, Some(SHARER), &share_body(Some("tide"), "ru", true)).await;
    failures.extend(share_is("prepare failed", &reply, &link, &text, None));
    if gateway.prepared_calls().len() != 1 {
        failures.push(format!(
            "prepare failed: expected one prepared call, got {:?}",
            gateway.prepared_calls()
        ));
    }
    gateway.fail_prepare_with(None);

    gateway.fail_with(Some(GatewayError::Timeout));
    for native in [true, false] {
        let reply = post_share(&st, Some(SHARER), &share_body(Some("tide"), "ru", native)).await;
        failures.extend(error_is(
            &format!("getMe failed, native {native}"),
            &reply,
            502,
            "telegram_unavailable",
        ));
    }
    gateway.fail_with(None);

    let reply = post_share(&st, Some(SHARER), &share_body(Some("tide"), "ru", true)).await;
    let n = gateway.prepared_calls().len();
    failures.extend(share_is(
        "recovered",
        &reply,
        &link,
        &text,
        Some(&format!("test-prepared-{n}")),
    ));
    report(&failures);
}

/// `st` reading the time `t`; the window is the same `Arc`, so it carries over.
fn at(st: &AppState, t: i64) -> AppState {
    st.clone().with_clock(Arc::new(FixedClock(t)))
}

/// 20 shares per user per rolling hour (M14, M15): a refused body takes no slot; the 21st share is 429
/// `rate_limited` with `Retry-After: 3600`; another user has a window of their own; one second before the first share
/// leaves the window the wait is 1 s, and when it leaves, a slot frees.
#[tokio::test]
async fn share_rate_limited_after_20_per_hour() {
    let (st, _db, _gateway) = invoice_state(&[(SHARER, Some("ru")), (OTHER, Some("en"))]).await;
    let mut failures = Vec::new();
    let refused = post_share(&st, Some(SHARER), &share_body(None, "de", false)).await;
    failures.extend(error_is("a refused body", &refused, 400, "bad_request"));
    for i in 1..=20 {
        let reply = post_share(&st, Some(SHARER), &share_body(None, "ru", false)).await;
        if reply.status != StatusCode::OK {
            failures.push(format!(
                "share {i} at T0: expected 200, got {} {}",
                reply.status.as_u16(),
                body_text(&reply)
            ));
        }
    }
    for (case, st, want_retry) in [
        ("share 21 at T0", st.clone(), "3600"),
        ("at T0 + 3599", at(&st, T0 + 3599), "1"),
    ] {
        let reply = post_share(&st, Some(SHARER), &share_body(None, "ru", false)).await;
        failures.extend(error_is(case, &reply, 429, "rate_limited"));
        let retry = header(&reply, &RETRY_AFTER);
        if retry != Some(want_retry) {
            failures.push(format!(
                "{case}: Retry-After expected {want_retry}, got {retry:?}"
            ));
        }
    }
    let other = post_share(&st, Some(OTHER), &share_body(None, "en", false)).await;
    if other.status != StatusCode::OK {
        failures.push(format!(
            "another user at T0: expected 200, got {} {}",
            other.status.as_u16(),
            body_text(&other)
        ));
    }
    let later = at(&st, T0 + 3600);
    let reply = post_share(&later, Some(SHARER), &share_body(None, "ru", false)).await;
    if reply.status != StatusCode::OK {
        failures.push(format!(
            "at T0 + 3600: expected 200, got {} {}",
            reply.status.as_u16(),
            body_text(&reply)
        ));
    }
    report(&failures);
}

/// The body is checked before anything else: a story id outside the grammar, a language other than `ru` / `en`, an
/// unknown field or a missing `native` is 400; a well-formed unknown story 404; no bearer 401. `storyId: null` is a
/// plain invite: the invite text, no counts.
#[tokio::test]
async fn share_rejects_bad_body_and_unknown_story() {
    let (st, _db, _gateway) = invoice_state(&[(SHARER, Some("ru"))]).await;
    let mut failures = Vec::new();
    for (case, body, status, code) in [
        (
            "storyId Manor",
            share_body(Some("Manor"), "ru", false),
            400,
            "bad_request",
        ),
        (
            "storyId nope",
            share_body(Some("nope"), "ru", false),
            404,
            "not_found",
        ),
        (
            "lang de",
            share_body(Some("tide"), "de", false),
            400,
            "bad_request",
        ),
        (
            "an unknown field",
            json!({ "storyId": "tide", "lang": "ru", "native": false, "userId": SHARER }),
            400,
            "bad_request",
        ),
        (
            "native missing",
            json!({ "storyId": "tide", "lang": "ru" }),
            400,
            "bad_request",
        ),
    ] {
        let reply = post_share(&st, Some(SHARER), &body).await;
        failures.extend(error_is(case, &reply, status, code));
    }
    let reply = post_share(&st, None, &share_body(Some("tide"), "ru", false)).await;
    failures.extend(error_is("no bearer", &reply, 401, "token_missing"));

    let locale = locale_texts().await;
    let invite = locale["ru"]["share_invite"]
        .as_str()
        .unwrap_or("<no share_invite>");
    let code = invite_code(&st, SHARER).await;
    let reply = post_share(&st, Some(SHARER), &share_body(None, "ru", false)).await;
    failures.extend(share_is(
        "storyId null",
        &reply,
        &format!("{LINK_PREFIX}{code}"),
        invite,
        None,
    ));
    report(&failures);
}
