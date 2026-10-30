//! Shared test helpers. Every state comes from `AppState::new`, with a fresh temp-file database per test.

use std::net::SocketAddr;
use std::path::PathBuf;

use axum::body::{Body, Bytes};
use axum::http::{HeaderMap, Request, StatusCode};
use http_body_util::BodyExt;
use server::config::{Config, PLACEHOLDER_BOT_TOKEN, TelegramEnv};
use server::{AppState, build_router};
use sqlx::ConnectOptions;
use sqlx::sqlite::{SqliteConnectOptions, SqliteConnection};
use tempfile::TempDir;
use tower::ServiceExt;

/// The bot token of every test state: the `.env.example` placeholder, so initData signed by the test vectors'
/// signer verifies here and against a server started from `.env.example`.
pub const TEST_BOT_TOKEN: &str = PLACEHOLDER_BOT_TOKEN;

/// The one admin of every test state.
pub const TEST_ADMIN_ID: i64 = 900_000_001;

/// A complete test configuration: the database is `dir/test.db`, the content the committed fixture.
pub fn test_config(dir: &TempDir) -> Config {
    Config {
        bot_token: TEST_BOT_TOKEN.to_owned(),
        webhook_secret: "test-webhook-secret".to_owned(),
        token_key: [7u8; 32],
        token_ttl_secs: 1800,
        initdata_max_age_secs: 86400,
        public_app_url: "https://example.invalid/".to_owned(),
        admin_telegram_ids: vec![TEST_ADMIN_ID],
        static_dir: None,
        content_dir: PathBuf::from(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/content"
        )),
        database_path: dir.path().join("test.db"),
        telegram_env: TelegramEnv::Test,
        listen_addr: SocketAddr::from(([127, 0, 0, 1], 0)),
    }
}

/// A migrated state on a fresh temp-file database. Bind the directory (`let (st, _dir) = ...`), never `_`, which
/// drops the directory and the database at once.
pub async fn test_state() -> (AppState, TempDir) {
    let dir = tempfile::Builder::new()
        .prefix("tg-novel-it-")
        .tempdir()
        .unwrap();
    match AppState::new(test_config(&dir)).await {
        Ok(state) => (state, dir),
        Err(e) => panic!("test_state: {e}"),
    }
}

/// A connection of its own to the state's database file, outside the app pool. It never creates a file: a wrong
/// path fails instead of yielding an empty database.
pub async fn raw_db(st: &AppState) -> SqliteConnection {
    SqliteConnectOptions::new()
        .filename(&st.cfg.database_path)
        .create_if_missing(false)
        .foreign_keys(true)
        .connect()
        .await
        .unwrap()
}

/// A collected response.
pub struct Reply {
    /// The status.
    pub status: StatusCode,
    /// The headers.
    pub headers: HeaderMap,
    /// The whole body.
    pub body: Bytes,
}

/// Sends `req` through the production router, with no port bound.
pub async fn call(st: &AppState, req: Request<Body>) -> Reply {
    let response = build_router(st.clone()).oneshot(req).await.unwrap();
    let (parts, body) = response.into_parts();
    let body = body.collect().await.unwrap().to_bytes();
    Reply {
        status: parts.status,
        headers: parts.headers,
        body,
    }
}
