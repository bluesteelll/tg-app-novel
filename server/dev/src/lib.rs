//! The dev-only server: the production router plus the `/dev/*` routes, on a dev configuration. The `server` crate
//! cannot depend on this one (that would be a cycle), so no dev route is ever linked into the production binary.

// Also set by `[workspace.lints.rust]`; the attribute holds even for a member that forgets `[lints] workspace`.
#![forbid(unsafe_code)]

pub mod launch;

use std::net::SocketAddr;
use std::path::PathBuf;

use axum::Router;
use server::config::{Config, PLACEHOLDER_BOT_TOKEN, PLACEHOLDER_WEBHOOK_SECRET, TelegramEnv};
use server::{AppState, StartupError, build_router};

/// Where the dev app keeps its database and finds its content.
#[derive(Debug, Clone)]
pub struct DevPaths {
    /// The SQLite database file (`DATABASE_PATH`).
    pub db: PathBuf,
    /// The content directory (`CONTENT_DIR`).
    pub content: PathBuf,
}

/// The production router plus every dev module's routes, on a state built by [`AppState::new`] from the dev
/// configuration. Opens and migrates `paths.db`: it creates the file, never its directory, and deletes nothing.
pub async fn build_dev_app(paths: DevPaths) -> Result<Router, StartupError> {
    let state = AppState::new(dev_config(&paths)).await?;
    Ok(build_router(state.clone()).merge(launch::routes().with_state(state)))
}

/// The dev configuration: the public `.env.example` placeholder secrets, accepted only because the app stays local
/// (`TelegramEnv::Test`, a localhost URL, loopback binding in `main.rs`).
fn dev_config(paths: &DevPaths) -> Config {
    Config {
        bot_token: PLACEHOLDER_BOT_TOKEN.to_owned(),
        webhook_secret: PLACEHOLDER_WEBHOOK_SECRET.to_owned(),
        // Random per start: the database is fresh per launch, so a token from the previous run must fail
        // (`token_invalid`) and make the client re-auth, which re-creates its `users` row.
        token_key: random_token_key(),
        token_ttl_secs: 1800,
        initdata_max_age_secs: 86400,
        // Never published: server-dev has no `setup` subcommand.
        public_app_url: "http://localhost/".to_owned(),
        admin_telegram_ids: Vec::new(),
        // Vite serves the client in development.
        static_dir: None,
        content_dir: paths.content.clone(),
        database_path: paths.db.clone(),
        telegram_env: TelegramEnv::Test,
        // Unused: `main.rs` binds `DEV_API_PORT` itself.
        listen_addr: SocketAddr::from(([127, 0, 0, 1], 0)),
    }
}

/// 32 bytes from the OS random source.
fn random_token_key() -> [u8; 32] {
    let mut key = [0u8; 32];
    getrandom::fill(&mut key).expect(
        "invariant: the OS random source works (ProcessPrng on Windows 10+ is documented never to fail)",
    );
    key
}
