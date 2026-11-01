//! The dev-only server: the production router plus the `/dev/*` routes, on a dev configuration. The `server` crate
//! cannot depend on this one (that would be a cycle), so no dev route is ever linked into the production binary.

// Also set by `[workspace.lints.rust]`; the attribute holds even for a member that forgets `[lints] workspace`.
#![forbid(unsafe_code)]

pub mod fake_gateway;
pub mod launch;
pub mod simulate;

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

use axum::Router;
use pgdev::{DbName, DevCluster, PgDevError};
use server::config::{Config, PLACEHOLDER_BOT_TOKEN, PLACEHOLDER_WEBHOOK_SECRET, TelegramEnv};
use server::{AppState, StartupError, build_router};

use crate::fake_gateway::FakeBotGateway;

/// Where the dev app keeps its database and finds its content.
#[derive(Debug, Clone)]
pub struct DevPaths {
    /// The PostgreSQL database URL (`DATABASE_URL`); a dev cluster's URL holds no password (trust auth).
    pub database_url: String,
    /// The content directory (`CONTENT_DIR`).
    pub content: PathBuf,
}

/// The production router plus every dev module's routes, on a state built by [`AppState::new`] from the dev
/// configuration with the Bot API faked ([`FakeBotGateway`]). Connects to and migrates `paths.database_url`: it
/// creates no database and drops nothing.
pub async fn build_dev_app(paths: DevPaths) -> Result<Router, StartupError> {
    let (state, fake) = dev_state(&paths).await?;
    Ok(dev_router(state, fake))
}

/// The dev state: [`AppState::new`] on the dev configuration, calling the Bot API through a fresh [`FakeBotGateway`]
/// (returned too, for the routes that read it). Without the fake the placeholder token would answer every call
/// with `Disabled`.
async fn dev_state(paths: &DevPaths) -> Result<(AppState, Arc<FakeBotGateway>), StartupError> {
    let fake = Arc::new(FakeBotGateway::default());
    let state = AppState::new(dev_config(paths))
        .await?
        .with_gateway(fake.clone());
    Ok((state, fake))
}

/// The production router on `state`, plus the launch routes, the simulated payments (through the production webhook
/// handler on `state`) and the routes that read `fake`.
fn dev_router(state: AppState, fake: Arc<FakeBotGateway>) -> Router {
    build_router(state.clone())
        .merge(launch::routes().with_state(state.clone()))
        .merge(simulate::routes(state, fake.clone()))
        .merge(fake_gateway::routes(fake))
}

/// Recreates database `name` on `cluster` empty (`DROP … WITH (FORCE)`, which ends a previous instance's
/// connections, then `CREATE`) and returns its URL: every launch starts on a fresh database.
pub async fn launch_database(cluster: &DevCluster, name: &DbName) -> Result<String, PgDevError> {
    cluster.recreate(name).await?;
    Ok(cluster.database_url(name))
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
        database_url: paths.database_url.clone(),
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
