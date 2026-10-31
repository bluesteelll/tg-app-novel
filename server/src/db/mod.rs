//! The repository seam: every SQL statement lives under `db/`, and the only module that names sqlx pool and connect
//! types. Handlers see domain types, never sqlx.

pub mod saves;
pub mod users;

use std::str::FromStr;
use std::time::Duration;

use sqlx::postgres::{PgConnectOptions, PgPool, PgPoolOptions};

/// The pool size: about 10 MB per backend on the database host, far above this load's request concurrency.
pub const POOL_MAX_CONNECTIONS: u32 = 8;

/// sqlx's 30 s default would outlast every budget a request has (the pre-checkout answers within 10 s).
const POOL_ACQUIRE_TIMEOUT: Duration = Duration::from_secs(5);

/// The `application_name` of every app connection: what `pg_stat_activity` shows for the server.
const APPLICATION_NAME: &str = "tg-novel-server";

/// The settings every app session starts with. A client startup option outranks `postgresql.conf`, the server
/// command line and every `ALTER DATABASE` / `ALTER ROLE` default, and sqlx appends these after `PGOPTIONS`, so no
/// server, database or role default (a provider console field) can weaken them:
/// - `synchronous_commit=on`: a grant committed and answered 200 to Telegram survives a crash (principle 2);
/// - `read committed`: the statement after a row-lock wait takes a fresh snapshot, so the saves writes re-check
///   `rev` on the winner's row instead of failing with `40001`;
/// - `lock_timeout`: a blocked row lock errors with `55P03` inside the pre-checkout's 2 s budget instead of hanging;
/// - `statement_timeout`: bounds a runaway statement well inside Telegram's redelivery horizon;
/// - `idle_in_transaction_session_timeout`: ends a transaction leaked by a dropped future, releasing its locks.
const SESSION_OPTIONS: [(&str, &str); 5] = [
    ("synchronous_commit", "on"),
    ("default_transaction_isolation", "read committed"),
    ("lock_timeout", "2s"),
    ("statement_timeout", "15s"),
    ("idle_in_transaction_session_timeout", "30s"),
];

/// The database handle. Cloning shares one pool; the pool lives from `AppState::new` until `close` after serving.
#[derive(Clone)]
pub struct Repo {
    pool: PgPool,
}

impl Repo {
    /// Connects a pool of [`POOL_MAX_CONNECTIONS`] to the PostgreSQL database `url` names (checked by
    /// [`check_database_url`]), every session started with the pinned settings. Creates no database: a missing one
    /// is an error here, at startup.
    pub async fn open(url: &str) -> Result<Repo, sqlx::Error> {
        let options = PgConnectOptions::from_str(url)?
            .application_name(APPLICATION_NAME)
            .options(SESSION_OPTIONS);
        let pool = PgPoolOptions::new()
            .max_connections(POOL_MAX_CONNECTIONS)
            .acquire_timeout(POOL_ACQUIRE_TIMEOUT)
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

    /// The session settings as the server reports them for an app connection, and the isolation level a
    /// transaction from `pool.begin()` actually runs at (the level every money transaction gets).
    pub async fn session_settings(&self) -> Result<SessionSettings, sqlx::Error> {
        let (
            synchronous_commit,
            default_transaction_isolation,
            lock_timeout,
            statement_timeout,
            idle_in_transaction_session_timeout,
            application_name,
            server_version_num,
        ): (String, String, String, String, String, String, i32) = sqlx::query_as(
            "SELECT current_setting('synchronous_commit'), current_setting('default_transaction_isolation'), \
             current_setting('lock_timeout'), current_setting('statement_timeout'), \
             current_setting('idle_in_transaction_session_timeout'), current_setting('application_name'), \
             current_setting('server_version_num')::int4",
        )
        .fetch_one(&self.pool)
        .await?;
        let mut tx = self.pool.begin().await?;
        let transaction_isolation: String =
            sqlx::query_scalar("SELECT current_setting('transaction_isolation')")
                .fetch_one(&mut *tx)
                .await?;
        tx.rollback().await?;
        Ok(SessionSettings {
            synchronous_commit,
            default_transaction_isolation,
            lock_timeout,
            statement_timeout,
            idle_in_transaction_session_timeout,
            application_name,
            server_version_num,
            transaction_isolation,
        })
    }
}

/// What [`Repo::session_settings`] read, as `current_setting` prints each value.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionSettings {
    /// `synchronous_commit`, e.g. `on`.
    pub synchronous_commit: String,
    /// `default_transaction_isolation`, e.g. `read committed`.
    pub default_transaction_isolation: String,
    /// `lock_timeout`, e.g. `2s`.
    pub lock_timeout: String,
    /// `statement_timeout`, e.g. `15s`.
    pub statement_timeout: String,
    /// `idle_in_transaction_session_timeout`, e.g. `30s`.
    pub idle_in_transaction_session_timeout: String,
    /// `application_name`.
    pub application_name: String,
    /// `server_version_num`, e.g. 180006 for 18.6.
    pub server_version_num: i32,
    /// `transaction_isolation` read inside a transaction from `pool.begin()`: the level a transaction actually gets.
    pub transaction_isolation: String,
}

/// Why a `DATABASE_URL` is refused. A static text: the URL (which may hold a password) is never echoed.
const DATABASE_URL_RULE: &str = "must be a postgres:// or postgresql:// URL naming a database";

/// Checks a `DATABASE_URL`: the `postgres` or `postgresql` scheme (sqlx itself parses any scheme), a URL sqlx
/// parses, and a database path (an absent one would fall back to `PGDATABASE` or the user name).
pub fn check_database_url(url: &str) -> Result<(), &'static str> {
    let parts = UrlParts::split(url).ok_or(DATABASE_URL_RULE)?;
    if parts.path.is_empty() || PgConnectOptions::from_str(url).is_err() {
        return Err(DATABASE_URL_RULE);
    }
    Ok(())
}

/// The database a URL connects to, as `host:port/dbname` for logs: never the user or the password, wherever the
/// URL carries them (userinfo, `?user=`, `?password=`). The values are the ones sqlx connects with.
pub fn database_target(url: &str) -> String {
    let Ok(options) = PgConnectOptions::from_str(url) else {
        return "<unparsable DATABASE_URL>".to_owned();
    };
    let host = match options.get_socket() {
        Some(socket) => socket.display().to_string(),
        None => options.get_host().to_owned(),
    };
    format!(
        "{host}:{}/{}",
        options.get_port(),
        options.get_database().unwrap_or_default()
    )
}

/// The text parts of a `postgres://` / `postgresql://` URL that the checks read. The authority ends at the first
/// `/`, `?` or `#`, as the URL standard reads a non-special scheme.
struct UrlParts<'a> {
    /// The path after the authority's `/`, without the query: the database name.
    path: &'a str,
}

impl<'a> UrlParts<'a> {
    fn split(url: &'a str) -> Option<UrlParts<'a>> {
        let rest = url
            .strip_prefix("postgres://")
            .or_else(|| url.strip_prefix("postgresql://"))?;
        let rest = rest.split('#').next().unwrap_or_default();
        let before_query = rest.split('?').next().unwrap_or_default();
        let path = before_query
            .split_once('/')
            .map_or("", |(_authority, path)| path);
        Some(UrlParts { path })
    }
}
