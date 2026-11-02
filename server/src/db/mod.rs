//! The repository seam: every SQL statement lives under `db/`, and the only module that names sqlx pool and connect
//! types. Handlers see domain types, never sqlx.

pub mod achievements;
pub mod economy;
pub mod entitlements;
pub mod orders;
pub mod payments;
pub mod puzzles;
pub mod saves;
pub mod social;
pub mod stats;
pub mod users;

use std::borrow::Cow;
use std::net::IpAddr;
use std::str::FromStr;
use std::time::Duration;

use sqlx::postgres::{PgConnectOptions, PgPool, PgPoolOptions, PgSslMode};

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

/// `text` with every U+0000 replaced by U+FFFD (borrowed when there is none). PostgreSQL `text` cannot hold U+0000
/// (`22021`) and a Telegram string may carry it, so the payment path and the users upsert bind every Telegram string
/// through this, at the `db/` boundary. The replacement is deterministic: a replaced charge id is the same key on
/// every redelivery.
pub(crate) fn without_nul(text: &str) -> Cow<'_, str> {
    if text.contains('\0') {
        Cow::Owned(text.replace('\0', "\u{FFFD}"))
    } else {
        Cow::Borrowed(text)
    }
}

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
    /// edit to an existing migration rebuilds the crate; a NEW file is seen through `server/build.rs`
    /// (`cargo:rerun-if-changed=migrations`), without which an incremental build keeps the old set.
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

/// Why a `DATABASE_URL` off loopback is refused.
const DATABASE_URL_TLS_RULE: &str = "off loopback (localhost, 127.0.0.0/8, ::1, a socket path) the URL must say \
     sslmode=verify-full";

/// Checks a `DATABASE_URL`: the `postgres` or `postgresql` scheme (sqlx itself parses any scheme), a URL sqlx
/// parses, and a database path (an absent one would fall back to `PGDATABASE` or the user name). Off loopback the
/// URL itself must say `sslmode=verify-full`: the database password and every money fact cross the network.
///
/// The TLS rule judges the values sqlx connects with: the query decoded as sqlx decodes it, a later `host` /
/// `hostaddr` or `sslmode` / `ssl-mode` pair overriding the authority and the earlier pairs. Only the URL's own
/// values count, so the environment (`PGHOST`, `PGSSLMODE`) cannot decide: a URL that names no host is off loopback,
/// and one that names no sslmode is refused there.
pub fn check_database_url(url: &str) -> Result<(), &'static str> {
    let parts = UrlParts::split(url).ok_or(DATABASE_URL_RULE)?;
    if parts.path.is_empty() {
        return Err(DATABASE_URL_RULE);
    }
    let options = PgConnectOptions::from_str(url).map_err(|_| DATABASE_URL_RULE)?;
    let names_any = |keys: [&str; 2]| {
        form_urlencoded::parse(parts.query.as_bytes()).any(|(key, _)| keys.contains(&&*key))
    };
    let names_host = !parts.host.is_empty() || names_any(["host", "hostaddr"]);
    // A socket takes precedence over a host in sqlx's connect, and a Unix socket is local by construction.
    let local = names_host && (options.get_socket().is_some() || is_loopback(options.get_host()));
    let verify_full = names_any(["sslmode", "ssl-mode"])
        && matches!(options.get_ssl_mode(), PgSslMode::VerifyFull);
    if local || verify_full {
        Ok(())
    } else {
        Err(DATABASE_URL_TLS_RULE)
    }
}

/// `localhost`, a `127.0.0.0/8` address or `::1` (brackets allowed). Exact: any other spelling counts as remote,
/// the direction that asks for TLS.
fn is_loopback(host: &str) -> bool {
    let bare = host
        .strip_prefix('[')
        .and_then(|h| h.strip_suffix(']'))
        .unwrap_or(host);
    host == "localhost" || bare.parse::<IpAddr>().is_ok_and(|ip| ip.is_loopback())
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
    /// The authority's host, without userinfo and port; empty when the URL names none.
    host: &'a str,
    /// The path after the authority's `/`, without the query: the database name.
    path: &'a str,
    /// The text after the first `?`, still percent-encoded.
    query: &'a str,
}

impl<'a> UrlParts<'a> {
    fn split(url: &'a str) -> Option<UrlParts<'a>> {
        let rest = url
            .strip_prefix("postgres://")
            .or_else(|| url.strip_prefix("postgresql://"))?;
        let rest = rest.split('#').next().unwrap_or_default();
        let (before_query, query) = rest.split_once('?').unwrap_or((rest, ""));
        let (authority, path) = before_query.split_once('/').unwrap_or((before_query, ""));
        // Userinfo ends at the last `@`; a bracketed IPv6 host keeps its colons.
        let host_port = authority.rsplit('@').next().unwrap_or_default();
        let host = match host_port.find(']') {
            Some(end) if host_port.starts_with('[') => &host_port[..=end],
            _ => host_port.split(':').next().unwrap_or_default(),
        };
        Some(UrlParts { host, path, query })
    }
}
