//! The tg-app-novel server: initData auth, saves, entitlements, Stars payments and paid-content delivery.

// Also set by `[workspace.lints.rust]`; the attribute holds even for a member that forgets `[lints] workspace`.
#![forbid(unsafe_code)]

pub mod api;
pub mod auth;
pub mod clock;
pub mod config;
pub mod db;
pub mod error;
pub mod ids;

use std::sync::Arc;

use axum::Router;

use crate::auth::Keys;
use crate::clock::{Clock, SystemClock};
use crate::config::Config;
use crate::db::Repo;

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
}

impl AppState {
    /// Opens the database pool and applies the migrations. Creates no directory and deletes no file: a missing
    /// parent directory of `DATABASE_PATH` is a [`StartupError::Db`].
    pub async fn new(cfg: Config) -> Result<AppState, StartupError> {
        let repo = Repo::open(&cfg.database_path).await?;
        if let Err(e) = repo.migrate().await {
            // Close at once: on Windows an open SQLite file cannot be removed by the caller.
            repo.close().await;
            return Err(e.into());
        }
        Ok(AppState {
            repo,
            keys: Arc::new(Keys::from_config(&cfg)),
            cfg: Arc::new(cfg),
            clock: Arc::new(SystemClock),
        })
    }

    /// The same state reading its time from `clock` (tests pin the time; a later time is a new state).
    pub fn with_clock(self, clock: Arc<dyn Clock>) -> AppState {
        AppState { clock, ..self }
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
}

/// The production routes. Dev-only routes live in `server-dev` and are never routable here.
pub fn build_router(state: AppState) -> Router {
    Router::new().nest("/api", api::router()).with_state(state)
}
