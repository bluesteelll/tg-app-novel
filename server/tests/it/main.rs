//! The server's one integration-test binary: every server test module links into it.

#![allow(
    clippy::unwrap_used,
    reason = "clippy.toml's allow-unwrap-in-tests covers #[test] fns only, not the shared helpers; a test fails loudly"
)]
// Every allowance in this crate states why (L2 review M2); `-D warnings` makes a bare `allow` a gate failure.
#![warn(clippy::allow_attributes_without_reason)]

mod common;
mod schema;

use std::path::Path;

use axum::body::Body;
use axum::http::header::CACHE_CONTROL;
use axum::http::{Request, StatusCode};

#[tokio::test]
async fn health_ok() {
    let (st, _dir) = common::test_state().await;
    let reply = common::call(
        &st,
        Request::get("/api/health").body(Body::empty()).unwrap(),
    )
    .await;
    let mut failures = Vec::new();
    if reply.status != StatusCode::OK {
        failures.push(format!(
            "status: expected 200, got {}",
            reply.status.as_u16()
        ));
    }
    if reply.body.as_ref() != b"ok" {
        failures.push(format!(
            "body: expected \"ok\", got {:?}",
            String::from_utf8_lossy(&reply.body)
        ));
    }
    let cache = reply
        .headers
        .get(CACHE_CONTROL)
        .map(|v| v.to_str().unwrap_or("<not text>"));
    if cache != Some("no-store") {
        failures.push(format!("cache-control: expected no-store, got {cache:?}"));
    }
    assert!(
        failures.is_empty(),
        "{} failures:\n{}",
        failures.len(),
        failures.join("\n")
    );
}

/// Test databases live under cargo's `target/tmp`, not `%TEMP%` (RULINGS 7c): Windows SQLite holds its files without
/// share-delete, so a `TempDir` can outlive its test there. Kept outside `common.rs` so the guard is not edited with
/// the helper it guards.
#[tokio::test]
async fn test_db_dir_under_target_tmpdir() {
    let (_st, dir) = common::test_state().await;
    let root = Path::new(env!("CARGO_TARGET_TMPDIR"));
    let mut failures = Vec::new();
    if !dir.path().starts_with(root) {
        failures.push(format!(
            "expected a dir under {}, got {}",
            root.display(),
            dir.path().display()
        ));
    }
    let name = dir
        .path()
        .file_name()
        .map(|n| n.to_string_lossy().into_owned());
    if !name
        .as_deref()
        .is_some_and(|n| n.starts_with("tg-novel-it-"))
    {
        failures.push(format!(
            "dir name: expected the prefix tg-novel-it-, got {name:?}"
        ));
    }
    assert!(
        failures.is_empty(),
        "{} failures:\n{}",
        failures.len(),
        failures.join("\n")
    );
}
