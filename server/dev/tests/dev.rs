//! The dev app through its lib target: every app comes from the one `dev_app()` helper, on its own test database
//! (`pgdev::TestDb`), and is driven with `oneshot` (no port is bound).

#![allow(
    clippy::unwrap_used,
    reason = "clippy.toml's allow-unwrap-in-tests covers #[test] fns only, not the shared helpers; a test fails loudly"
)]
// Every allowance in this crate states why; `-D warnings` makes a bare `allow` a gate failure.
#![warn(clippy::allow_attributes_without_reason)]

use std::path::PathBuf;
use std::time::{Duration, Instant};

use axum::Router;
use axum::body::{Body, Bytes};
use axum::http::header::{AUTHORIZATION, CACHE_CONTROL, CONTENT_TYPE, HeaderName, LOCATION};
use axum::http::{HeaderMap, Request, StatusCode};
use http_body_util::BodyExt;
use pgdev::{DbName, DevCluster, TestDb};
use serde_json::{Value, json};
use server::auth::{TgUser, validate_init_data};
use server::clock::{Clock, SystemClock};
use server::config::PLACEHOLDER_BOT_TOKEN;
use server::ids::UserId;
use server_dev::{DevPaths, build_dev_app, launch_database};
use sqlx::{Connection, PgConnection};
use tower::ServiceExt;

/// A dev app on its own database. `app` is declared first, so the app and its pool drop before the database.
struct DevApp {
    app: Router,
    db: TestDb,
}

/// The server's committed content fixture.
fn fixture_content() -> PathBuf {
    PathBuf::from(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../tests/fixtures/content"
    ))
}

/// A dev app on a fresh test database, with the test content fixture. A failed build panics naming the database.
async fn dev_app() -> DevApp {
    let db = TestDb::create().await;
    let paths = DevPaths {
        database_url: db.url(),
        content: fixture_content(),
    };
    match build_dev_app(paths).await {
        Ok(app) => DevApp { app, db },
        Err(e) => panic!("dev_app: build_dev_app on {} failed: {e}", db.name()),
    }
}

/// The ids of the `users` rows of the database `url` names, read outside any app pool.
async fn user_ids(url: &str) -> Vec<i64> {
    let mut conn = PgConnection::connect(url).await.unwrap();
    let ids = sqlx::query_scalar("SELECT id FROM users ORDER BY id")
        .fetch_all(&mut conn)
        .await
        .unwrap();
    conn.close().await.unwrap();
    ids
}

/// A collected response.
struct Reply {
    status: StatusCode,
    headers: HeaderMap,
    body: Bytes,
}

/// Sends `req` through the dev app.
async fn call(dev: &DevApp, req: Request<Body>) -> Reply {
    let response = dev.app.clone().oneshot(req).await.unwrap();
    let (parts, body) = response.into_parts();
    let body = body.collect().await.unwrap().to_bytes();
    Reply {
        status: parts.status,
        headers: parts.headers,
        body,
    }
}

/// `GET uri` through the dev app.
async fn get(dev: &DevApp, uri: &str) -> Reply {
    call(dev, Request::get(uri).body(Body::empty()).unwrap()).await
}

/// `POST /api/auth` with `init_data`, through the same dev app.
async fn post_auth(dev: &DevApp, init_data: &str) -> Reply {
    let body = json!({ "initData": init_data }).to_string();
    let req = Request::post("/api/auth")
        .header(CONTENT_TYPE, "application/json")
        .body(Body::from(body))
        .unwrap();
    call(dev, req).await
}

/// A header of `reply` as text (`None` when absent or not visible ASCII).
fn header(reply: &Reply, name: HeaderName) -> Option<&str> {
    reply.headers.get(name).and_then(|v| v.to_str().ok())
}

fn body_text(reply: &Reply) -> String {
    String::from_utf8_lossy(&reply.body).into_owned()
}

fn body_json(reply: &Reply) -> Value {
    serde_json::from_slice(&reply.body).unwrap_or(Value::Null)
}

/// The `Location` hash of a `/dev/launch` reply, decoded once into pairs, as Telegram's script reads it.
fn hash_pairs(reply: &Reply) -> Vec<(String, String)> {
    let hash = header(reply, LOCATION)
        .and_then(|location| location.split_once('#'))
        .map_or("", |(_, hash)| hash);
    form_urlencoded::parse(hash.as_bytes())
        .into_owned()
        .collect()
}

/// The initData a `/dev/launch` reply hands to the client (`tgWebAppData`), or a panic naming the `Location`.
fn launch_init_data(reply: &Reply) -> String {
    hash_pairs(reply)
        .into_iter()
        .find(|(key, _)| key == "tgWebAppData")
        .map(|(_, value)| value)
        .unwrap_or_else(|| {
            panic!(
                "Location {:?}: no tgWebAppData in the hash",
                header(reply, LOCATION)
            )
        })
}

/// `init_data` with the `user` JSON's id `from` replaced by `to`, every other pair (the `hash` too) unchanged, then
/// re-encoded. The substitution is anchored on the decoded JSON (`{"id":<from>,`), not on the encoded text.
fn with_user_id(init_data: &str, from: i64, to: i64) -> String {
    let pairs = form_urlencoded::parse(init_data.as_bytes())
        .into_owned()
        .map(|(key, value)| {
            if key == "user" {
                let value =
                    value.replacen(&format!("{{\"id\":{from},"), &format!("{{\"id\":{to},"), 1);
                (key, value)
            } else {
                (key, value)
            }
        });
    form_urlencoded::Serializer::new(String::new())
        .extend_pairs(pairs)
        .finish()
}

/// The value of `key` in `pairs`.
fn value<'a>(pairs: &'a [(String, String)], key: &str) -> Option<&'a str> {
    pairs
        .iter()
        .find(|(k, _)| k == key)
        .map(|(_, v)| v.as_str())
}

/// The keys of `pairs`, sorted, as `{a, b}` (a repeated key shows twice).
fn key_set(pairs: &[(String, String)]) -> String {
    let mut keys: Vec<&str> = pairs.iter().map(|(k, _)| k.as_str()).collect();
    keys.sort_unstable();
    format!("{{{}}}", keys.join(", "))
}

/// The theme keys `/dev/launch` sends, sorted.
const THEME_KEYS: [&str; 7] = [
    "bg_color",
    "button_color",
    "button_text_color",
    "hint_color",
    "link_color",
    "secondary_bg_color",
    "text_color",
];

/// A JSON object with exactly [`THEME_KEYS`], each value `#` and 6 hex digits.
fn theme_ok(json: &str) -> bool {
    let Ok(Value::Object(map)) = serde_json::from_str::<Value>(json) else {
        return false;
    };
    let mut keys: Vec<&str> = map.keys().map(String::as_str).collect();
    keys.sort_unstable();
    keys == THEME_KEYS
        && map.values().all(|v| {
            v.as_str()
                .and_then(|s| s.strip_prefix('#'))
                .is_some_and(|hex| hex.len() == 6 && hex.bytes().all(|b| b.is_ascii_hexdigit()))
        })
}

fn report(failures: &[String]) {
    assert!(
        failures.is_empty(),
        "{} failures:\n{}",
        failures.len(),
        failures.join("\n")
    );
}

/// The app uses the database it is given (not a fixed dev database) and serves the production routes: the `users`
/// row of a `/dev/launch` login lands in THAT database, read outside the app.
#[tokio::test]
async fn dev_app_uses_given_database() {
    let dev = dev_app().await;
    let mut failures = Vec::new();
    let health = get(&dev, "/api/health").await;
    if health.status != StatusCode::OK || health.body.as_ref() != b"ok" {
        failures.push(format!(
            "GET /api/health: expected 200 ok, got {} {:?}",
            health.status,
            body_text(&health)
        ));
    }
    let launch = get(&dev, "/dev/launch").await;
    let auth = post_auth(&dev, &launch_init_data(&launch)).await;
    if auth.status != StatusCode::OK {
        failures.push(format!(
            "POST /api/auth: expected 200, got {} {}",
            auth.status,
            body_text(&auth)
        ));
    }
    let ids = user_ids(&dev.db.url()).await;
    if ids != [1001] {
        failures.push(format!(
            "users rows in the given database {}: expected [1001], got {ids:?}",
            dev.db.name()
        ));
    }
    report(&failures);
}

/// Every launch starts on an empty database: `launch_database` twice on one name, and a row written after the first
/// is gone after the second. The name comes from a `TestDb` guard, which drops the database at the end, on panic too.
#[tokio::test]
async fn dev_database_reset_per_launch() {
    let guard = TestDb::create().await;
    let name = DbName::parse(guard.name()).unwrap();
    let cluster = DevCluster::from_env().unwrap();
    let launch = |round: &'static str| {
        let (cluster, name) = (cluster.clone(), name.clone());
        async move {
            let url = launch_database(&cluster, &name)
                .await
                .unwrap_or_else(|e| panic!("{round}: launch_database: {e}"));
            let paths = DevPaths {
                database_url: url.clone(),
                content: fixture_content(),
            };
            // The app migrates the database, as server-dev does after each launch.
            let app = build_dev_app(paths)
                .await
                .unwrap_or_else(|e| panic!("{round}: build_dev_app: {e}"));
            (url, app)
        }
    };
    let mut failures = Vec::new();

    let (url, first) = launch("launch 1").await;
    if url != guard.url() {
        failures.push(format!(
            "launch 1: expected the URL of {}, got {url}",
            guard.name()
        ));
    }
    let mut conn = PgConnection::connect(&url).await.unwrap();
    sqlx::query(
        "INSERT INTO users (id, first_name, language_code, created_at, last_seen_at) VALUES (1001, 'Ann', NULL, 0, 0)",
    )
    .execute(&mut conn)
    .await
    .unwrap();
    conn.close().await.unwrap();
    let ids = user_ids(&url).await;
    if ids != [1001] {
        failures.push(format!(
            "after launch 1 (control): expected the row written, got {ids:?}"
        ));
    }
    drop(first);

    let (url, _second) = launch("launch 2").await;
    let ids = user_ids(&url).await;
    if !ids.is_empty() {
        failures.push(format!(
            "after launch 2: expected no users rows, but the row from launch 1 survived: {ids:?}"
        ));
    }
    report(&failures);
}

/// `/dev/launch` hands out initData that the server's own validator accepts, directly and through `POST /api/auth`
/// of the same app, and the same hash over another user id is refused: the dev app has no bypass (RULINGS 5).
#[tokio::test]
async fn launch_signs_valid_initdata() {
    let dev = dev_app().await;
    let launch = get(&dev, "/dev/launch").await;
    assert!(
        launch.status == StatusCode::FOUND,
        "GET /dev/launch: expected 302 Found, got {}",
        launch.status
    );
    let init_data = launch_init_data(&launch);
    let mut failures = Vec::new();

    let expected = TgUser {
        id: UserId(1001),
        first_name: "Dev".to_owned(),
        language_code: Some("ru".to_owned()),
    };
    match validate_init_data(&init_data, PLACEHOLDER_BOT_TOKEN, SystemClock.now(), 86400) {
        Ok(data) if data.user == expected => {}
        got => failures.push(format!(
            "validate_init_data: expected Ok with {expected:?}, got {got:?}"
        )),
    }

    let auth = post_auth(&dev, &init_data).await;
    let json = body_json(&auth);
    if auth.status != StatusCode::OK {
        failures.push(format!(
            "POST /api/auth: expected 200, got {} {}",
            auth.status,
            body_text(&auth)
        ));
    }
    let user = json!({ "id": 1001, "firstName": "Dev", "languageCode": "ru" });
    if json["user"] != user {
        failures.push(format!("user: expected {user}, got {}", json["user"]));
    }
    let token = json["token"].as_str().unwrap_or("");
    if !token.starts_with("v1.1001.") {
        failures.push(format!(
            "token: expected v1.1001.<exp>.<tag>, got {token:?}"
        ));
    }

    let tampered = with_user_id(&init_data, 1001, 1002);
    if tampered == init_data {
        failures.push(format!(
            "tamper control: the user id substitution changed nothing in {init_data:?}"
        ));
    } else {
        let reply = post_auth(&dev, &tampered).await;
        let body = body_text(&reply);
        if reply.status != StatusCode::UNAUTHORIZED || body != r#"{"error":"initdata_invalid"}"# {
            failures.push(format!(
                "tampered user id: expected 401 {{\"error\":\"initdata_invalid\"}}, got {} {body}",
                reply.status
            ));
        }
    }
    report(&failures);
}

/// The redirect is a cache-free `302` to a relative `/#` hash with exactly Telegram's launch keys, in a shape
/// Telegram's script parses (one `=` per `&` segment).
#[tokio::test]
async fn launch_hash_carries_launch_params() {
    let dev = dev_app().await;
    let reply = get(&dev, "/dev/launch").await;
    let mut failures = Vec::new();
    if reply.status != StatusCode::FOUND {
        failures.push(format!("status: expected 302 Found, got {}", reply.status));
    }
    let cache = header(&reply, CACHE_CONTROL);
    if cache != Some("no-store") {
        failures.push(format!("cache-control: expected no-store, got {cache:?}"));
    }
    let location = header(&reply, LOCATION).unwrap_or("");
    let hash = location.strip_prefix("/#").unwrap_or_else(|| {
        failures.push(format!(
            "Location: expected a relative /#<hash>, got {location:?}"
        ));
        ""
    });
    // Telegram's script keeps only the text between a segment's first and second `=`.
    for segment in hash.split('&') {
        if segment.matches('=').count() != 1 {
            failures.push(format!(
                "hash segment {segment:?}: expected exactly one '='"
            ));
        }
    }
    let pairs: Vec<(String, String)> = form_urlencoded::parse(hash.as_bytes())
        .into_owned()
        .collect();
    let keys = key_set(&pairs);
    let expected = "{tgWebAppData, tgWebAppPlatform, tgWebAppThemeParams, tgWebAppVersion}";
    if keys != expected {
        failures.push(format!("hash keys: expected {expected}, got {keys}"));
    }
    let version = value(&pairs, "tgWebAppVersion");
    if version != Some("9.6") {
        failures.push(format!(
            "tgWebAppVersion: expected \"9.6\", got {version:?}"
        ));
    }
    let platform = value(&pairs, "tgWebAppPlatform");
    if platform != Some("android") {
        failures.push(format!(
            "tgWebAppPlatform: expected \"android\", got {platform:?}"
        ));
    }
    let theme = value(&pairs, "tgWebAppThemeParams");
    if !theme.is_some_and(theme_ok) {
        failures.push(format!(
            "tgWebAppThemeParams: expected a JSON object with 7 #rrggbb keys, got {theme:?}"
        ));
    }
    let init_data = value(&pairs, "tgWebAppData").unwrap_or("");
    let init_pairs: Vec<(String, String)> = form_urlencoded::parse(init_data.as_bytes())
        .into_owned()
        .collect();
    let init_keys = key_set(&init_pairs);
    if init_keys != "{auth_date, hash, user}" {
        failures.push(format!(
            "initData keys: expected {{auth_date, hash, user}}, got {init_keys}"
        ));
    }
    report(&failures);
}

/// `?uid=&lang=&name=` choose the signed user. The name holds Cyrillic, spaces and `& = + %`, so it reaches
/// `POST /api/auth` intact only if both layers (initData, and the hash around it) are encoded exactly once.
#[tokio::test]
async fn launch_query_sets_user() {
    let dev = dev_app().await;
    let reply = get(
        &dev,
        "/dev/launch?uid=2002&lang=en&name=%D0%90%D0%BD%D1%8F%20%26%20Co%20%3D%201%2B1%20%3D%20100%25",
    )
    .await;
    assert!(
        reply.status == StatusCode::FOUND,
        "GET /dev/launch?uid=2002&lang=en&name=…: expected 302 Found, got {}",
        reply.status
    );
    let auth = post_auth(&dev, &launch_init_data(&reply)).await;
    let json = body_json(&auth);
    let mut failures = Vec::new();
    if auth.status != StatusCode::OK {
        failures.push(format!(
            "POST /api/auth: expected 200, got {} {}",
            auth.status,
            body_text(&auth)
        ));
    }
    let user = json!({ "id": 2002, "firstName": "Аня & Co = 1+1 = 100%", "languageCode": "en" });
    if json["user"] != user {
        failures.push(format!("user: expected {user}, got {}", json["user"]));
    }
    report(&failures);
}

/// A session for dev user `uid`: `/dev/launch?uid=<uid>&lang=ru`, then `POST /api/auth`; the `Authorization` value.
async fn session(dev: &DevApp, uid: i64) -> String {
    let launch = get(dev, &format!("/dev/launch?uid={uid}&lang=ru")).await;
    let auth = post_auth(dev, &launch_init_data(&launch)).await;
    let json = body_json(&auth);
    let Some(token) = json["token"].as_str() else {
        panic!(
            "POST /api/auth for {uid}: expected a token, got {} {}",
            auth.status,
            body_text(&auth)
        );
    };
    format!("Bearer {token}")
}

/// `method uri` through the dev app, with `Authorization: bearer` when given and a JSON body when given.
async fn send(
    dev: &DevApp,
    method: &str,
    uri: &str,
    bearer: Option<&str>,
    body: Option<Value>,
) -> Reply {
    let mut req = Request::builder().method(method).uri(uri);
    if let Some(bearer) = bearer {
        req = req.header(AUTHORIZATION, bearer);
    }
    let body = match body {
        Some(json) => {
            req = req.header(CONTENT_TYPE, "application/json");
            Body::from(json.to_string())
        }
        None => Body::empty(),
    };
    call(dev, req.body(body).unwrap()).await
}

/// The invoice link prefix of the dev fake gateway: `https://t.me/$` + the slug.
const DEV_LINK_PREFIX: &str = "https://t.me/$";

/// A `chapter:ch2` invoice for `bearer` through `POST /api/invoices`: the order id and the link's slug.
async fn invoice(dev: &DevApp, bearer: &str) -> (String, String) {
    let reply = send(
        dev,
        "POST",
        "/api/invoices",
        Some(bearer),
        Some(json!({ "productId": "chapter:ch2" })),
    )
    .await;
    let json = body_json(&reply);
    let order = json["orderId"].as_str();
    let slug = json["invoiceUrl"]
        .as_str()
        .and_then(|url| url.strip_prefix(DEV_LINK_PREFIX));
    match (order, slug) {
        (Some(order), Some(slug)) => (order.to_owned(), slug.to_owned()),
        _ => panic!(
            "POST /api/invoices: expected an orderId and a dev link, got {} {}",
            reply.status,
            body_text(&reply)
        ),
    }
}

/// `POST /dev/simulate-payment` with `body`.
async fn simulate(dev: &DevApp, body: Value) -> Reply {
    send(dev, "POST", "/dev/simulate-payment", None, Some(body)).await
}

/// The mismatch of a simulate reply against 200 `{precheckoutOk: true, chargeId: dev_<32 hex>}`, `no-store`; the
/// charge id when it matches.
fn paid_reply(case: &str, reply: &Reply, failures: &mut Vec<String>) -> Option<String> {
    let json = body_json(reply);
    let charge = json["chargeId"].as_str().filter(|charge| {
        charge.strip_prefix("dev_").is_some_and(|hex| {
            hex.len() == 32 && hex.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
        })
    });
    let keys = json.as_object().map_or(0, |o| o.len());
    if reply.status != StatusCode::OK
        || json["precheckoutOk"] != json!(true)
        || keys != 2
        || charge.is_none()
    {
        failures.push(format!(
            "{case}: expected 200 {{precheckoutOk: true, chargeId: dev_<32 hex>}}, got {} {}",
            reply.status,
            body_text(reply)
        ));
    }
    if header(reply, CACHE_CONTROL) != Some("no-store") {
        failures.push(format!(
            "{case}: cache-control: expected no-store, got {:?}",
            header(reply, CACHE_CONTROL)
        ));
    }
    charge.map(str::to_owned)
}

/// The status of order `order` through `GET /api/orders/{order}` as `bearer`.
async fn order_status(dev: &DevApp, bearer: &str, order: &str) -> Option<String> {
    let reply = send(
        dev,
        "GET",
        &format!("/api/orders/{order}"),
        Some(bearer),
        None,
    )
    .await;
    body_json(&reply)["status"].as_str().map(str::to_owned)
}

/// `owned` of `chapter:ch2` in `GET /api/entitlements` as `bearer`.
async fn ch2_owned(dev: &DevApp, bearer: &str) -> Option<bool> {
    let reply = send(dev, "GET", "/api/entitlements", Some(bearer), None).await;
    body_json(&reply)["products"]
        .as_array()?
        .iter()
        .find(|p| p["productId"] == "chapter:ch2")?
        .get("owned")?
        .as_bool()
}

/// K21: a simulated payment goes through the production webhook handler. Before it ch2 is locked; after it the order
/// is `paid`, ch2 is owned and served, and the database shows what only the real path writes: the pre-checkout's
/// `checkout_at`, and the payment with provider `''` for the order. An unknown slug is 404; an unknown outcome or a
/// delay over a minute is 400; every answer is `no-store`.
#[tokio::test]
async fn simulate_payment_goes_through_webhook_handler() {
    let dev = dev_app().await;
    let bearer = session(&dev, 1001).await;
    let (order, slug) = invoice(&dev, &bearer).await;
    let mut failures = Vec::new();
    if slug != format!("dev-{order}") {
        failures.push(format!("slug: expected dev-{order}, got {slug}"));
    }
    let before = send(&dev, "GET", "/api/chapters/ch2", Some(&bearer), None).await;
    if before.status != StatusCode::FORBIDDEN {
        failures.push(format!(
            "GET /api/chapters/ch2 before paying: expected 403, got {}",
            before.status
        ));
    }
    let reply = simulate(&dev, json!({ "slug": slug, "outcome": "paid" })).await;
    let charge = paid_reply("simulate paid", &reply, &mut failures);
    let status = order_status(&dev, &bearer, &order).await;
    if status.as_deref() != Some("paid") {
        failures.push(format!("GET /api/orders: expected paid, got {status:?}"));
    }
    let owned = ch2_owned(&dev, &bearer).await;
    if owned != Some(true) {
        failures.push(format!(
            "GET /api/entitlements chapter:ch2 owned: expected Some(true), got {owned:?}"
        ));
    }
    let after = send(&dev, "GET", "/api/chapters/ch2", Some(&bearer), None).await;
    if after.status != StatusCode::OK {
        failures.push(format!(
            "GET /api/chapters/ch2 after paying: expected 200, got {}",
            after.status
        ));
    }
    let mut conn = PgConnection::connect(&dev.db.url()).await.unwrap();
    let checkout_at: Option<i64> =
        sqlx::query_scalar("SELECT checkout_at FROM orders WHERE id = $1")
            .bind(&order)
            .fetch_one(&mut conn)
            .await
            .unwrap();
    let payments: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT telegram_payment_charge_id, invoice_payload, provider_payment_charge_id FROM payments",
    )
    .fetch_all(&mut conn)
    .await
    .unwrap();
    conn.close().await.unwrap();
    if checkout_at.is_none() {
        failures.push("orders.checkout_at: expected the pre-checkout's time, got NULL".to_owned());
    }
    let want = charge
        .clone()
        .map(|charge| vec![(charge, order.clone(), String::new())]);
    if Some(&payments) != want.as_ref() {
        failures.push(format!(
            "payments rows: expected {want:?}, got {payments:?}"
        ));
    }
    for (case, body, status, code) in [
        (
            "an unknown slug",
            json!({ "slug": "dev-o_00000000000000000000000000000000", "outcome": "paid" }),
            StatusCode::NOT_FOUND,
            "not_found",
        ),
        (
            "outcome nope",
            json!({ "slug": slug, "outcome": "nope" }),
            StatusCode::BAD_REQUEST,
            "bad_request",
        ),
        (
            "webhookDelayMs 60001",
            json!({ "slug": slug, "outcome": "paid", "webhookDelayMs": 60_001 }),
            StatusCode::BAD_REQUEST,
            "bad_request",
        ),
    ] {
        let reply = simulate(&dev, body).await;
        if reply.status != status || body_json(&reply) != json!({ "error": code }) {
            failures.push(format!(
                "{case}: expected {status} {{\"error\":\"{code}\"}}, got {} {}",
                reply.status,
                body_text(&reply)
            ));
        }
        if header(&reply, CACHE_CONTROL) != Some("no-store") {
            failures.push(format!(
                "{case}: cache-control: expected no-store, got {:?}",
                header(&reply, CACHE_CONTROL)
            ));
        }
    }
    report(&failures);
}

/// `paid_twice` delivers the same payment update twice: one payment, one entitlement. A second simulation of the
/// now paid invoice is refused at pre-checkout: `{precheckoutOk: false}` with no charge.
#[tokio::test]
async fn simulate_paid_twice_grants_once() {
    let dev = dev_app().await;
    let bearer = session(&dev, 1002).await;
    let (_, slug) = invoice(&dev, &bearer).await;
    let mut failures = Vec::new();
    let reply = simulate(&dev, json!({ "slug": slug, "outcome": "paid_twice" })).await;
    paid_reply("simulate paid_twice", &reply, &mut failures);
    let mut conn = PgConnection::connect(&dev.db.url()).await.unwrap();
    let counts: (i64, i64) = sqlx::query_as(
        "SELECT (SELECT count(*) FROM payments), (SELECT count(*) FROM entitlements)",
    )
    .fetch_one(&mut conn)
    .await
    .unwrap();
    conn.close().await.unwrap();
    if counts != (1, 1) {
        failures.push(format!(
            "payments / entitlements rows: expected 1 / 1, got {} / {}",
            counts.0, counts.1
        ));
    }
    let again = simulate(&dev, json!({ "slug": slug, "outcome": "paid" })).await;
    if again.status != StatusCode::OK || body_json(&again) != json!({ "precheckoutOk": false }) {
        failures.push(format!(
            "simulate the paid invoice again: expected 200 {{\"precheckoutOk\":false}}, got {} {}",
            again.status,
            body_text(&again)
        ));
    }
    report(&failures);
}

/// With `webhookDelayMs` the route answers once the pre-checkout is answered, with the order still `checkout`; the
/// payment arrives after the delay, and the order turns `paid` (polled every 50 ms for up to 5 s).
#[tokio::test]
async fn simulate_payment_delay_answers_first() {
    let dev = dev_app().await;
    let bearer = session(&dev, 1003).await;
    let (order, slug) = invoice(&dev, &bearer).await;
    let mut failures = Vec::new();
    let reply = simulate(
        &dev,
        json!({ "slug": slug, "outcome": "paid", "webhookDelayMs": 300 }),
    )
    .await;
    paid_reply("simulate paid +300 ms", &reply, &mut failures);
    let status = order_status(&dev, &bearer, &order).await;
    if status.as_deref() != Some("checkout") {
        failures.push(format!(
            "GET /api/orders at once: expected checkout, got {status:?}"
        ));
    }
    let deadline = Instant::now() + Duration::from_secs(5);
    let mut status = None;
    while Instant::now() < deadline {
        status = order_status(&dev, &bearer, &order).await;
        if status.as_deref() == Some("paid") {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    if status.as_deref() != Some("paid") {
        failures.push(format!(
            "GET /api/orders within 5 s: expected paid, got {status:?}"
        ));
    }
    report(&failures);
}
