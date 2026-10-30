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
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
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
    body: Bytes,
}

/// Sends `req` through the dev app.
async fn call(dev: &DevApp, req: Request<Body>) -> Reply {
    let response = dev.app.clone().oneshot(req).await.unwrap();
    let (parts, body) = response.into_parts();
    let body = body.collect().await.unwrap().to_bytes();
    Reply {
        status: parts.status,
        body,
    }
}

/// `GET uri` through the dev app.
async fn get(dev: &DevApp, uri: &str) -> Reply {
    call(dev, Request::get(uri).body(Body::empty()).unwrap()).await
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
            String::from_utf8_lossy(&health.body)
        ));
    }
    report(&failures);
}
