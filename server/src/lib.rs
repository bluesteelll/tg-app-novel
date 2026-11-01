//! The tg-app-novel server: initData auth, saves, entitlements, Stars payments and paid-content delivery.

// Also set by `[workspace.lints.rust]`; the attribute holds even for a member that forgets `[lints] workspace`.
#![forbid(unsafe_code)]

pub mod api;
pub mod auth;
pub mod catalog;
pub mod clock;
pub mod config;
pub mod content;
pub mod db;
pub mod error;
pub mod ids;
pub mod puzzles;
pub mod telegram;

use std::sync::Arc;

use axum::Router;
use axum::extract::DefaultBodyLimit;
use axum::routing::post;

use crate::auth::Keys;
use crate::catalog::{CATALOG_JSON, Catalog};
use crate::clock::{Clock, SystemClock};
use crate::config::Config;
use crate::content::{ContentError, ContentStore};
use crate::db::Repo;
use crate::telegram::gateway::{BotGateway, FrankensteinGateway, GatewayError};

/// Everything a handler can reach. Built only by [`AppState::new`]: `#[non_exhaustive]` makes a struct literal (or a
/// functional update) outside this crate a compile error, so every caller gets the production wiring.
#[derive(Clone)]
#[non_exhaustive]
pub struct AppState {
    /// The repository seam: the only way to the database.
    pub repo: Repo,
    /// The configuration the state was built from.
    pub cfg: Arc<Config>,
    /// The MAC keys derived from `cfg`.
    pub keys: Arc<Keys>,
    /// The time source: the system clock, or a fixed one set by [`AppState::with_clock`] in tests.
    pub clock: Arc<dyn Clock>,
    /// The content loaded from `cfg.content_dir` at startup: the story index, the paid chapters, the puzzle index
    /// and the gated asset index.
    pub content: Arc<ContentStore>,
    /// The products for sale: every paid chapter of `content`'s index, priced by `server/catalog.json`.
    pub catalog: Arc<Catalog>,
    /// The Bot API: frankenstein's client on `cfg`'s token and environment, or a fake set by
    /// [`AppState::with_gateway`] (tests, the dev app).
    pub gateway: Arc<dyn BotGateway>,
}

impl AppState {
    /// Loads the content from `CONTENT_DIR`, builds the catalog from it and the compiled-in `server/catalog.json`, and
    /// the Bot API gateway from `BOT_TOKEN` and `TELEGRAM_ENV`, then connects the database pool to `DATABASE_URL` and
    /// applies the migrations. Content, catalog and gateway come first: a refusal ([`StartupError::Content`],
    /// [`StartupError::Gateway`]) opens no pool. Creates no database: a missing or unreachable one is a
    /// [`StartupError::Db`].
    pub async fn new(cfg: Config) -> Result<AppState, StartupError> {
        let content = ContentStore::load(&cfg.content_dir).await?;
        let catalog = Catalog::build(CATALOG_JSON, &content)?;
        let gateway = FrankensteinGateway::new(&cfg.bot_token, cfg.telegram_env)?;
        let repo = Repo::open(&cfg.database_url).await?;
        if let Err(e) = repo.migrate().await {
            // Close at once: the pool's connections end now, not whenever the last clone of the pool is dropped.
            repo.close().await;
            return Err(e.into());
        }
        Ok(AppState {
            repo,
            keys: Arc::new(Keys::from_config(&cfg)),
            cfg: Arc::new(cfg),
            clock: Arc::new(SystemClock),
            content: Arc::new(content),
            catalog: Arc::new(catalog),
            gateway: Arc::new(gateway),
        })
    }

    /// The same state reading its time from `clock` (tests pin the time; a later time is a new state).
    pub fn with_clock(self, clock: Arc<dyn Clock>) -> AppState {
        AppState { clock, ..self }
    }

    /// The same state selling from `catalog` (tests prove a route reads the catalog, not a constant).
    pub fn with_catalog(self, catalog: Arc<Catalog>) -> AppState {
        AppState { catalog, ..self }
    }

    /// The same state calling the Bot API through `gateway` (tests and the dev app install a fake).
    pub fn with_gateway(self, gateway: Arc<dyn BotGateway>) -> AppState {
        AppState { gateway, ..self }
    }
}

/// Why the server could not start.
#[derive(Debug, thiserror::Error)]
pub enum StartupError {
    /// The database could not be opened.
    #[error("database: {0}")]
    Db(#[from] sqlx::Error),
    /// A migration failed or no longer matches the database's record of it.
    #[error("migrations: {0}")]
    Migrate(#[from] sqlx::migrate::MigrateError),
    /// The content directory is missing, incomplete or invalid, or `server/catalog.json` does not fit it.
    #[error("content: {0}")]
    Content(#[from] ContentError),
    /// The Bot API client could not be built.
    #[error("bot api client: {0}")]
    Gateway(#[from] GatewayError),
}

/// The production routes: `/api`, and Telegram's webhook with its own 1 MB body limit (outside `/api`, so none of
/// its layers apply). Dev-only routes live in `server-dev` and are never routable here.
pub fn build_router(state: AppState) -> Router {
    Router::new()
        .nest("/api", api::router())
        .route(
            "/telegram/webhook",
            post(telegram::webhook::webhook)
                .layer(DefaultBodyLimit::max(telegram::webhook::WEBHOOK_BODY_LIMIT)),
        )
        .with_state(state)
}
