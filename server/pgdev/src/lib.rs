//! A disposable PostgreSQL cluster per port for development and the gates, and a database per test. Dev and test
//! only: the cluster trusts every loopback connection, so the production `server` never links this crate.

// Also set by `[workspace.lints.rust]`; the attribute holds even for a manifest that forgets `[lints] workspace`.
#![forbid(unsafe_code)]

mod cluster;

use std::sync::OnceLock;
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub use cluster::DevCluster;

/// The PostgreSQL major version every dev cluster runs: the production major.
pub const REQUIRED_MAJOR: u32 = 18;

/// The cluster port when `DEV_PG_PORT` is unset or empty.
pub const DEFAULT_PORT: u16 = 5487;

/// How long a caller waits for a cluster that a peer is starting: 3 x the 60 s cold-start target, so a peer's full
/// initdb and start fit.
pub const READY_DEADLINE: Duration = Duration::from_secs(180);

/// Why a dev cluster or a test database is unavailable. Every message names its remedy where one exists.
#[derive(Debug, thiserror::Error)]
pub enum PgDevError {
    /// Neither `PG_BIN` nor `PATH` leads to `pg_ctl`.
    #[error("PostgreSQL binaries not found: set PG_BIN or put pg_ctl on PATH")]
    BinariesNotFound,
    /// The binaries, or the server already on the port, are another major version.
    #[error("PostgreSQL {found} found, {required} required", required = REQUIRED_MAJOR)]
    WrongMajor {
        /// The version text found.
        found: String,
    },
    /// An environment variable holds a value pgdev refuses.
    #[error("{0}")]
    BadEnv(&'static str),
    /// `initdb` failed; the text is its exit status and output.
    #[error("initdb failed: {0}")]
    Initdb(String),
    /// Only when no server runs on `data`: then no consumer can be using it, so `reset` is safe advice.
    #[error(
        "cluster start failed and no server runs on {data}: {detail}; if postgres.log shows corruption: \
         `cargo run -p pgdev -- reset`"
    )]
    Start {
        /// The data directory.
        data: String,
        /// pg_ctl's exit code and the tail of `postgres.log`.
        detail: String,
    },
    /// A server runs but is not ready (starting, recovering, or a peer is starting it): never `reset` advice, since
    /// it may be serving the slot's other consumers.
    #[error("cluster on port {port} not ready after {waited_secs} s; see {log}")]
    NotReady {
        /// The cluster port.
        port: u16,
        /// How long this caller waited.
        waited_secs: u64,
        /// The server log to read.
        log: String,
    },
    /// The port answers, but not as a trust-auth PostgreSQL server pgdev can use.
    #[error(
        "port {port} is served by a server that refuses trust auth; set DEV_PG_PORT ({detail})"
    )]
    Refused {
        /// The cluster port.
        port: u16,
        /// The server's or the driver's reason.
        detail: String,
    },
    /// A statement on a running cluster failed.
    #[error(transparent)]
    Sql(#[from] sqlx::Error),
    /// A file or process operation failed.
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

/// A database name pgdev may put into DDL: `^tgn_[a-z0-9_]{1,59}$` (at most 63 bytes, PostgreSQL's identifier
/// limit). Identifiers cannot be bound as parameters, so this type is what keeps the DDL text injection-free.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DbName(String);

/// Mixed into every test database name, so names from one process are distinct by construction and two processes
/// collide only if their salts nearly meet in the same second.
static PROCESS_SALT: OnceLock<u32> = OnceLock::new();
static NAME_COUNTER: AtomicU32 = AtomicU32::new(0);

impl DbName {
    /// A fresh test database name, `tgn_t_<unix secs>_<8 hex>`. The epoch lets a sweep drop leftovers by age.
    pub fn for_test() -> DbName {
        let salt = *PROCESS_SALT.get_or_init(|| {
            getrandom::u32().expect(
                "invariant: the OS random source works (ProcessPrng on Windows 10+ is documented never to fail)",
            )
        });
        let suffix = salt.wrapping_add(NAME_COUNTER.fetch_add(1, Ordering::Relaxed));
        DbName(format!("tgn_t_{}_{suffix:08x}", unix_secs()))
    }

    /// The database of the dev server on `api_port`, `tgn_dev_<port>`: two dev servers on one cluster never share one.
    pub fn for_dev(api_port: u16) -> DbName {
        DbName(format!("tgn_dev_{api_port}"))
    }

    /// `s` as a database name, or `None` when it is outside `^tgn_[a-z0-9_]{1,59}$`.
    pub fn parse(s: &str) -> Option<DbName> {
        let rest = s.strip_prefix("tgn_")?;
        let charset_ok = rest
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_');
        ((1..=59).contains(&rest.len()) && charset_ok).then(|| DbName(s.to_owned()))
    }

    /// The name as text.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for DbName {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// Seconds since the Unix epoch; 0 on a clock set before 1970.
fn unix_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::*;

    fn report(failures: &[String]) {
        assert!(
            failures.is_empty(),
            "{} failures:\n{}",
            failures.len(),
            failures.join("\n")
        );
    }

    #[test]
    fn db_name_charset_and_length() {
        let mut failures = Vec::new();
        let longest = format!("tgn_{}", "a".repeat(59));
        let too_long = format!("tgn_{}", "a".repeat(60));
        for name in [
            "tgn_t_1793318400_9f3a2c1b",
            "tgn_dev_8797",
            "tgn_local",
            longest.as_str(),
        ] {
            match DbName::parse(name) {
                Some(db) if db.as_str() == name => {}
                Some(db) => failures.push(format!("{name:?}: accepted as {:?}", db.as_str())),
                None => failures.push(format!("{name:?}: expected accepted, got refused")),
            }
        }
        // Each case is a valid name but for one defect, so a check that admits that defect fails one line only.
        for (case, name) in [
            ("a double quote", "tgn_t_\"x"),
            ("a semicolon", "tgn_t_;x"),
            ("upper case", "tgn_t_X"),
            ("a space", "tgn_t x"),
            ("a non-ASCII letter", "tgn_t_\u{e9}"),
            ("64 bytes", too_long.as_str()),
            ("nothing after the prefix", "tgn_"),
            ("no tgn_ prefix", "t_1793318400_9f3a2c1b"),
        ] {
            if DbName::parse(name).is_some() {
                failures.push(format!("{case} ({name:?}): expected refused, got accepted"));
            }
        }
        for db in [
            DbName::for_dev(8797),
            DbName::for_dev(u16::MAX),
            DbName::for_test(),
        ] {
            if DbName::parse(db.as_str()).is_none() {
                failures.push(format!("{db}: built by DbName, refused by DbName::parse"));
            }
        }
        if DbName::for_dev(8797).as_str() != "tgn_dev_8797" {
            failures.push(format!(
                "for_dev(8797): expected tgn_dev_8797, got {}",
                DbName::for_dev(8797)
            ));
        }
        report(&failures);
    }

    #[test]
    fn db_name_for_test_unique_and_dated() {
        let now = unix_secs();
        let names: Vec<DbName> = (0..1000).map(|_| DbName::for_test()).collect();
        let mut failures = Vec::new();
        let distinct: HashSet<&str> = names.iter().map(DbName::as_str).collect();
        if distinct.len() != names.len() {
            failures.push(format!(
                "expected {} distinct names, got {}",
                names.len(),
                distinct.len()
            ));
        }
        let mut misshapen = Vec::new();
        let mut misdated = Vec::new();
        for db in &names {
            let shape = db
                .as_str()
                .strip_prefix("tgn_t_")
                .and_then(|rest| rest.split_once('_'))
                .filter(|(secs, hex)| {
                    secs.bytes().all(|b| b.is_ascii_digit())
                        && hex.len() == 8
                        && hex.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
                });
            match shape.map(|(secs, _)| secs.parse::<u64>()) {
                Some(Ok(secs)) if secs.abs_diff(now) <= 5 => {}
                Some(_) => misdated.push(db.as_str()),
                None => misshapen.push(db.as_str()),
            }
        }
        if !misshapen.is_empty() {
            failures.push(format!(
                "{} names not tgn_t_<secs>_<8 hex>, e.g. {:?}",
                misshapen.len(),
                &misshapen[..misshapen.len().min(3)]
            ));
        }
        if !misdated.is_empty() {
            failures.push(format!(
                "{} names dated more than 5 s from {now}, e.g. {:?}",
                misdated.len(),
                &misdated[..misdated.len().min(3)]
            ));
        }
        report(&failures);
    }
}
