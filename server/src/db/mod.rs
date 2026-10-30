//! The repository seam: every SQL statement lives under `db/`, and the only module that names sqlx pool types.
//! Handlers see domain types, never sqlx.

pub mod users;

use std::path::Path;
use std::time::Duration;

use sqlx::sqlite::{
    SqliteConnectOptions, SqliteJournalMode, SqlitePool, SqlitePoolOptions, SqliteSynchronous,
};

/// The database handle. Cloning shares one pool; the pool lives from `AppState::new` until `close` after serving.
#[derive(Clone)]
pub struct Repo {
    pool: SqlitePool,
}

impl Repo {
    /// Opens a pool of 4 connections to the SQLite file at `path`, creating the file (never its directory), in WAL
    /// mode with `synchronous=FULL`: the WAL is synced at every commit, so a grant committed and answered 200 to
    /// Telegram survives an OS crash or power loss (NORMAL may lose the last commits). Foreign keys are enforced and
    /// a locked database is waited on for up to 5 s.
    pub async fn open(path: &Path) -> Result<Repo, sqlx::Error> {
        // WAL is a connection option, not a migration statement: sqlx runs a migration inside a transaction, where
        // `journal_mode` cannot change.
        let options = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Wal)
            .synchronous(SqliteSynchronous::Full)
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

    /// The connection settings as SQLite reports them, all read on ONE pooled connection (they are per-connection
    /// facts, except the journal mode, which a WAL file database keeps).
    pub async fn pragmas(&self) -> Result<PoolPragmas, sqlx::Error> {
        let mut conn = self.pool.acquire().await?;
        let journal_mode: String = sqlx::query_scalar("PRAGMA journal_mode")
            .fetch_one(&mut *conn)
            .await?;
        let synchronous: i64 = sqlx::query_scalar("PRAGMA synchronous")
            .fetch_one(&mut *conn)
            .await?;
        let foreign_keys: i64 = sqlx::query_scalar("PRAGMA foreign_keys")
            .fetch_one(&mut *conn)
            .await?;
        let busy_timeout_ms: i64 = sqlx::query_scalar("PRAGMA busy_timeout")
            .fetch_one(&mut *conn)
            .await?;
        Ok(PoolPragmas {
            journal_mode,
            synchronous,
            foreign_keys: foreign_keys != 0,
            busy_timeout_ms,
        })
    }
}

/// What [`Repo::pragmas`] read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PoolPragmas {
    /// `PRAGMA journal_mode`, e.g. `wal`.
    pub journal_mode: String,
    /// `PRAGMA synchronous`: 0 OFF, 1 NORMAL, 2 FULL, 3 EXTRA.
    pub synchronous: i64,
    /// `PRAGMA foreign_keys`.
    pub foreign_keys: bool,
    /// `PRAGMA busy_timeout`, in milliseconds.
    pub busy_timeout_ms: i64,
}
