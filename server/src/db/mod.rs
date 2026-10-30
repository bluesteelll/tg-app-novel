//! The repository seam: every SQL statement lives under `db/`, and the only module that names sqlx pool types.
//! Handlers see domain types, never sqlx.

use std::path::Path;
use std::time::Duration;

use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions};

/// The database handle. Cloning shares one pool; the pool lives from `AppState::new` until `close` after serving.
#[derive(Clone)]
pub struct Repo {
    pool: SqlitePool,
}

impl Repo {
    /// Opens a pool of 4 connections to the SQLite file at `path`, creating the file (never its directory).
    /// Foreign keys are enforced and a locked database is waited on for up to 5 s.
    pub async fn open(path: &Path) -> Result<Repo, sqlx::Error> {
        let options = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true)
            .foreign_keys(true)
            .busy_timeout(Duration::from_secs(5));
        let pool = SqlitePoolOptions::new()
            .max_connections(4)
            .connect_with(options)
            .await?;
        Ok(Repo { pool })
    }

    /// Applies `server/migrations/` (embedded at compile time). `migrate!` emits an `include_str!` per file, so an
    /// edit to an existing migration rebuilds the crate; a NEW file needs a build script (sqlx docs).
    pub async fn migrate(&self) -> Result<(), sqlx::migrate::MigrateError> {
        sqlx::migrate!("./migrations").run(&self.pool).await
    }

    /// Closes the pool, waiting for the connections in use to be returned.
    pub async fn close(&self) {
        self.pool.close().await;
    }
}
