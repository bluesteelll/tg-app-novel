//! The server's one integration-test binary: every server test module links into it.

#![allow(clippy::unwrap_used)]

mod common;
mod schema;

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
