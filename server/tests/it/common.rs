//! Shared test helpers. Every state comes from `AppState::new`, on a fresh PostgreSQL database per test
//! ([`TestDb`]) on the dev cluster the environment names (`DEV_PG_PORT`, `DEV_PG_ROOT`, `PG_BIN`).

use std::net::SocketAddr;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use axum::body::{Body, Bytes};
use axum::http::{HeaderMap, Request, StatusCode};
use http_body_util::BodyExt;
use server::config::{Config, PLACEHOLDER_BOT_TOKEN, TelegramEnv};
use server::{AppState, build_router};
use sqlx::{Connection, PgConnection};
use tower::ServiceExt;

pub use pgdev::TestDb;

/// The bot token of every test state: the `.env.example` placeholder, so initData signed by the test vectors'
/// signer verifies here and against a server started from `.env.example`.
pub const TEST_BOT_TOKEN: &str = PLACEHOLDER_BOT_TOKEN;

/// The one admin of every test state.
pub const TEST_ADMIN_ID: i64 = 900_000_001;

/// A complete test configuration: the database is `db`, the content the committed fixture.
pub fn test_config(db: &TestDb) -> Config {
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
        database_url: db.url(),
        telegram_env: TelegramEnv::Test,
        listen_addr: SocketAddr::from(([127, 0, 0, 1], 0)),
    }
}

/// A migrated state on a fresh database. Bind the guard (`let (st, _db) = ...`), never `_`, which drops the
/// database at once.
pub async fn test_state() -> (AppState, TestDb) {
    let db = TestDb::create().await;
    match AppState::new(test_config(&db)).await {
        Ok(state) => (state, db),
        Err(e) => panic!("test_state: {}: {e}", db.name()),
    }
}

/// A connection of its own to the state's database, outside the app pool. It carries none of the app's session
/// settings, so it runs under the test database's hostile defaults (`repeatable read`, `synchronous_commit = off`):
/// a raw stand-in for an app transaction opens it with `BEGIN ISOLATION LEVEL READ COMMITTED`.
pub async fn raw_db(st: &AppState) -> PgConnection {
    PgConnection::connect(&st.cfg.database_url).await.unwrap()
}

/// The app pool's `application_name` (`db/mod.rs`): raw connections set none, so only an app session matches.
const APP_SESSION: &str = "tg-novel-server";

/// Returns once an app-pool session on `st`'s database waits for a lock; panics after 5 s. It polls every 10 ms on
/// an autocommit connection of its own: `pg_stat_activity` is a snapshot taken once per transaction, so a poll
/// inside one would never see the wait begin. The caller then has the rest of the app's 2 s `lock_timeout` to
/// release the lock.
pub async fn wait_for_lock_waiter(st: &AppState) {
    let mut conn = raw_db(st).await;
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let waiters: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock' \
             AND datname = current_database() AND application_name = $1",
        )
        .bind(APP_SESSION)
        .fetch_one(&mut conn)
        .await
        .unwrap();
        if waiters > 0 {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "no lock waiter after 5 s: the app's statement never blocked on the held row"
        );
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    conn.close().await.unwrap();
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
