//! The dev app through its lib target: every app comes from the one `dev_app()` helper, on its own temp-file
//! database, and is driven with `oneshot` (no port is bound).

#![allow(
    clippy::unwrap_used,
    reason = "clippy.toml's allow-unwrap-in-tests covers #[test] fns only, not the shared helpers; a test fails loudly"
)]
// Every allowance in this crate states why; `-D warnings` makes a bare `allow` a gate failure.
#![warn(clippy::allow_attributes_without_reason)]

use std::path::{Path, PathBuf};

use axum::Router;
use axum::body::{Body, Bytes};
use axum::http::header::{CONTENT_TYPE, HeaderName, LOCATION};
use axum::http::{HeaderMap, Request, StatusCode};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use server::auth::{TgUser, validate_init_data};
use server::clock::{Clock, SystemClock};
use server::config::PLACEHOLDER_BOT_TOKEN;
use server::ids::UserId;
use server_dev::{DevPaths, build_dev_app};
use tempfile::TempDir;
use tower::ServiceExt;

/// A dev app on its own database. `app` is declared first, so the app and its pool drop before the directory.
struct DevApp {
    app: Router,
    db: PathBuf,
    dir: TempDir,
}

/// A dev app on `<temp dir>/dev.db` under cargo's `target/tmp` (RULINGS 7c), with the test content fixture. A failed
/// build panics with the error and whether the given database exists, so it never hides the path fact.
async fn dev_app() -> DevApp {
    let dir = tempfile::Builder::new()
        .prefix("tg-novel-dev-")
        .tempdir_in(env!("CARGO_TARGET_TMPDIR"))
        .unwrap();
    let db = dir.path().join("dev.db");
    let paths = DevPaths {
        db: db.clone(),
        content: PathBuf::from(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../tests/fixtures/content"
        )),
    };
    match build_dev_app(paths).await {
        Ok(app) => DevApp { app, db, dir },
        Err(e) => panic!(
            "dev_app: build_dev_app failed: {e} (given db exists: {})",
            db.exists()
        ),
    }
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

fn report(failures: &[String]) {
    assert!(
        failures.is_empty(),
        "{} failures:\n{}",
        failures.len(),
        failures.join("\n")
    );
}

/// The app opens the database it is given (not `target/e2e/dev.db`) and serves the production routes.
#[tokio::test]
async fn dev_app_uses_given_db_path() {
    let dev = dev_app().await;
    let mut failures = Vec::new();
    if !dev.db.is_file() {
        failures.push(format!(
            "given database {}: expected to exist, absent (build: Ok)",
            dev.db.display()
        ));
    }
    let root = Path::new(env!("CARGO_TARGET_TMPDIR"));
    if !dev.dir.path().starts_with(root) {
        failures.push(format!(
            "temp dir: expected a dir under {}, got {}",
            root.display(),
            dev.dir.path().display()
        ));
    }
    let name = dev
        .dir
        .path()
        .file_name()
        .map(|n| n.to_string_lossy().into_owned());
    if !name
        .as_deref()
        .is_some_and(|n| n.starts_with("tg-novel-dev-"))
    {
        failures.push(format!(
            "temp dir name: expected the prefix tg-novel-dev-, got {name:?}"
        ));
    }
    let health = get(&dev, "/api/health").await;
    if health.status != StatusCode::OK || health.body.as_ref() != b"ok" {
        failures.push(format!(
            "GET /api/health: expected 200 ok, got {} {:?}",
            health.status,
            body_text(&health)
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
