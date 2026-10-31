//! The dev cluster on one port: where it lives and which PostgreSQL binaries run it.

use std::env::VarError;
use std::path::{Path, PathBuf};

use crate::{DEFAULT_PORT, PgDevError, REQUIRED_MAJOR};

/// One PostgreSQL cluster, identified by its port: its data directory is `<root>/<port>/data` and its server log
/// `<root>/<port>/postgres.log`, so every consumer that names the same port and root shares one cluster.
#[derive(Debug, Clone)]
pub struct DevCluster {
    port: u16,
    root: PathBuf,
    bin: PathBuf,
}

impl DevCluster {
    /// The cluster that `DEV_PG_PORT`, `DEV_PG_ROOT` and `PG_BIN` (or `pg_ctl` on `PATH`) name.
    pub fn from_env() -> Result<DevCluster, PgDevError> {
        DevCluster::from_lookup(env_var)
    }

    /// As [`DevCluster::from_env`], reading each variable through `get`: the test seam, since `std::env::set_var` is
    /// `unsafe` in edition 2024. An empty value counts as unset.
    pub fn from_lookup(get: impl Fn(&str) -> Option<String>) -> Result<DevCluster, PgDevError> {
        let set = |key: &str| get(key).filter(|value| !value.is_empty());
        let port = parse_port(set("DEV_PG_PORT").as_deref())?;
        let root = match set("DEV_PG_ROOT") {
            None => workspace_root().join("target").join("pg"),
            // A cwd-relative root would give two callers on one port two different clusters.
            Some(root) if Path::new(&root).is_absolute() => PathBuf::from(root),
            Some(_) => return Err(PgDevError::BadEnv("DEV_PG_ROOT must be an absolute path")),
        };
        // A given PG_BIN is taken as is: a wrong one fails loudly at the first spawn.
        let bin = match set("PG_BIN") {
            Some(bin) => PathBuf::from(bin),
            None => find_pg_ctl(set("PATH").as_deref()).ok_or(PgDevError::BinariesNotFound)?,
        };
        Ok(DevCluster { port, root, bin })
    }

    /// The cluster port.
    pub fn port(&self) -> u16 {
        self.port
    }

    /// The data directory, `<root>/<port>/data`.
    pub fn data_dir(&self) -> PathBuf {
        self.cluster_dir().join("data")
    }

    /// The directory of `initdb` and `pg_ctl`.
    pub fn bin_dir(&self) -> &Path {
        &self.bin
    }

    /// `<root>/<port>`: the data directory, the server log and the initdb temp directories.
    fn cluster_dir(&self) -> PathBuf {
        self.root.join(self.port.to_string())
    }
}

/// An environment variable; a value that is not Unicode is passed on lossily, so a port check refuses it instead of
/// treating it as unset.
fn env_var(key: &str) -> Option<String> {
    match std::env::var(key) {
        Ok(value) => Some(value),
        Err(VarError::NotPresent) => None,
        Err(VarError::NotUnicode(raw)) => Some(raw.to_string_lossy().into_owned()),
    }
}

/// `DEV_PG_PORT`: unset gives [`DEFAULT_PORT`]; anything but a decimal port 1..=65535 is an error, never a silent
/// fallback to another slot's port.
fn parse_port(text: Option<&str>) -> Result<u16, PgDevError> {
    match text {
        None => Ok(DEFAULT_PORT),
        Some(text) => text
            .parse::<u16>()
            .ok()
            // `u16::from_str` also takes a leading `+`.
            .filter(|&port| port != 0 && text.bytes().all(|b| b.is_ascii_digit()))
            .ok_or(PgDevError::BadEnv(
                "DEV_PG_PORT must be a port number 1..=65535",
            )),
    }
}

/// The workspace root, fixed at compile time (two levels above `server/pgdev`), so the default root does not depend
/// on the working directory.
fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .expect("invariant: server/pgdev lies two levels below the workspace root")
        .to_path_buf()
}

/// The first `PATH` directory that holds `pg_ctl`.
fn find_pg_ctl(path: Option<&str>) -> Option<PathBuf> {
    let pg_ctl = format!("pg_ctl{}", std::env::consts::EXE_SUFFIX);
    std::env::split_paths(path?).find(|dir| dir.join(&pg_ctl).is_file())
}

/// The major version in `pg_ctl --version`'s output (`pg_ctl (PostgreSQL) 18.6`), which must be
/// [`REQUIRED_MAJOR`]: initdb and the server come from the same directory, so their major is the same.
#[cfg_attr(
    not(test),
    expect(dead_code, reason = "ensure_up runs it before the first spawn")
)]
fn pg_major(stdout: &str) -> Result<u32, PgDevError> {
    let text = stdout.trim();
    let version = text.rsplit(char::is_whitespace).next().unwrap_or(text);
    let digits = version.bytes().take_while(u8::is_ascii_digit).count();
    match version[..digits].parse::<u32>() {
        Ok(REQUIRED_MAJOR) => Ok(REQUIRED_MAJOR),
        Ok(_) => Err(PgDevError::WrongMajor {
            found: version.to_owned(),
        }),
        Err(_) => Err(PgDevError::WrongMajor {
            found: text.to_owned(),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn report(failures: &[String]) {
        assert!(
            failures.is_empty(),
            "{} failures:\n{}",
            failures.len(),
            failures.join("\n")
        );
    }

    /// A lookup over fixed pairs: nothing is read from the process environment.
    fn vars<'a>(pairs: &'a [(&'a str, &'a str)]) -> impl Fn(&str) -> Option<String> + 'a {
        move |key| {
            pairs
                .iter()
                .find(|(name, _)| *name == key)
                .map(|(_, value)| (*value).to_owned())
        }
    }

    #[test]
    fn dev_cluster_env_defaults_and_errors() {
        const BIN: &str = "pg-bin-taken-as-given";
        let mut failures = Vec::new();

        for (case, pairs) in [
            ("unset", &[("PG_BIN", BIN)][..]),
            (
                "empty",
                &[("PG_BIN", BIN), ("DEV_PG_PORT", ""), ("DEV_PG_ROOT", "")][..],
            ),
        ] {
            let cluster = match DevCluster::from_lookup(vars(pairs)) {
                Ok(cluster) => cluster,
                Err(e) => {
                    failures.push(format!("{case}: expected Ok, got {e}"));
                    continue;
                }
            };
            if cluster.port() != 5487 {
                failures.push(format!(
                    "{case}: port expected 5487, got {}",
                    cluster.port()
                ));
            }
            if cluster.bin_dir() != Path::new(BIN) {
                failures.push(format!(
                    "{case}: bin expected {BIN}, got {}",
                    cluster.bin_dir().display()
                ));
            }
            // The default root is `<workspace>/target/pg`: checked against the files that mark the workspace, not
            // against a second computation of the same path.
            let root = &cluster.root;
            if !root.is_absolute() || !root.ends_with(Path::new("target").join("pg")) {
                failures.push(format!(
                    "{case}: root expected an absolute <workspace>/target/pg, got {}",
                    root.display()
                ));
            }
            let workspace = root.parent().and_then(Path::parent).unwrap_or(root);
            for manifest in ["Cargo.toml", "server/pgdev/Cargo.toml"] {
                let file = workspace.join(manifest);
                if !file.is_file() {
                    failures.push(format!("{case}: {} expected a file", file.display()));
                }
            }
            if cluster.data_dir() != root.join("5487").join("data") {
                failures.push(format!(
                    "{case}: data dir expected <root>/5487/data, got {}",
                    cluster.data_dir().display()
                ));
            }
        }

        match DevCluster::from_lookup(vars(&[("PG_BIN", BIN), ("DEV_PG_PORT", "5497")])) {
            Ok(cluster) if cluster.port() == 5497 => {}
            Ok(cluster) => failures.push(format!(
                "DEV_PG_PORT \"5497\": expected 5497, got {}",
                cluster.port()
            )),
            Err(e) => failures.push(format!("DEV_PG_PORT \"5497\": expected Ok, got {e}")),
        }
        for port in ["0", "65536", " 5497", "+5497", "abc"] {
            match DevCluster::from_lookup(vars(&[("PG_BIN", BIN), ("DEV_PG_PORT", port)])) {
                Err(PgDevError::BadEnv(_)) => {}
                Err(e) => failures.push(format!("DEV_PG_PORT {port:?}: expected BadEnv, got {e}")),
                Ok(cluster) => failures.push(format!(
                    "DEV_PG_PORT {port:?}: expected Err, got Ok({})",
                    cluster.port()
                )),
            }
        }

        let own_root = concat!(env!("CARGO_MANIFEST_DIR"), "/pg-root-override");
        match DevCluster::from_lookup(vars(&[("PG_BIN", BIN), ("DEV_PG_ROOT", own_root)])) {
            Ok(cluster) if cluster.data_dir() == Path::new(own_root).join("5487").join("data") => {}
            Ok(cluster) => failures.push(format!(
                "DEV_PG_ROOT {own_root}: data dir expected under it, got {}",
                cluster.data_dir().display()
            )),
            Err(e) => failures.push(format!("DEV_PG_ROOT {own_root}: expected Ok, got {e}")),
        }
        match DevCluster::from_lookup(vars(&[("PG_BIN", BIN), ("DEV_PG_ROOT", "target/pg")])) {
            Err(PgDevError::BadEnv(_)) => {}
            Err(e) => failures.push(format!("relative DEV_PG_ROOT: expected BadEnv, got {e}")),
            Ok(cluster) => failures.push(format!(
                "relative DEV_PG_ROOT: expected Err, got Ok({})",
                cluster.root.display()
            )),
        }

        // A PATH that exists but holds no pg_ctl: this crate's own directory.
        let no_pg_ctl = env!("CARGO_MANIFEST_DIR");
        for (case, pairs) in [
            ("no PG_BIN, no PATH", &[][..]),
            ("no PG_BIN, no pg_ctl on PATH", &[("PATH", no_pg_ctl)][..]),
        ] {
            match DevCluster::from_lookup(vars(pairs)) {
                Err(PgDevError::BinariesNotFound) => {}
                Err(e) => failures.push(format!("{case}: expected BinariesNotFound, got {e}")),
                Ok(cluster) => failures.push(format!(
                    "{case}: expected BinariesNotFound, got bin {}",
                    cluster.bin_dir().display()
                )),
            }
        }
        report(&failures);
    }

    #[test]
    fn pg_version_parse() {
        let mut failures = Vec::new();
        for text in [
            "pg_ctl (PostgreSQL) 18.6",
            "pg_ctl (PostgreSQL) 18.6\r\n",
            "pg_ctl (PostgreSQL) 18beta1",
        ] {
            match pg_major(text) {
                Ok(18) => {}
                Ok(other) => failures.push(format!("{text:?}: expected 18, got {other}")),
                Err(e) => failures.push(format!("{text:?}: expected 18, got {e}")),
            }
        }
        for (text, found) in [
            ("17.11", "17.11"),
            ("pg_ctl (PostgreSQL) 17.11", "17.11"),
            ("pg_ctl (PostgreSQL) 180.1", "180.1"),
            ("not a version", "not a version"),
            ("", ""),
        ] {
            match pg_major(text) {
                Err(PgDevError::WrongMajor { found: got }) if got == found => {}
                Err(e) => {
                    failures.push(format!("{text:?}: expected WrongMajor({found:?}), got {e}"))
                }
                Ok(major) => {
                    failures.push(format!("{text:?}: expected WrongMajor, got Ok({major})"))
                }
            }
        }
        report(&failures);
    }
}
