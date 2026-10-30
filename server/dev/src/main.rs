//! The `server-dev` binary: the dev app on `127.0.0.1:$DEV_API_PORT` (default 8787), on a fresh database per launch
//! at `<workspace root>/target/e2e/dev.db`. Dev only: it runs on the public placeholder secrets.

#![forbid(unsafe_code)]

use std::env::VarError;
use std::io;
use std::net::{Ipv4Addr, SocketAddr};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use server_dev::{DevPaths, build_dev_app};
use tokio::net::TcpListener;
use tracing::{error, info, warn};
use tracing_subscriber::EnvFilter;

/// The port when `DEV_API_PORT` is unset or empty.
const DEFAULT_DEV_API_PORT: u16 = 8787;

#[tokio::main]
async fn main() -> ExitCode {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    tracing_subscriber::fmt().with_env_filter(filter).init();

    let port = match std::env::var("DEV_API_PORT") {
        Ok(port) => Some(port),
        Err(VarError::NotPresent) => None,
        // Not a port number either: `dev_addr` refuses it instead of falling back to the default.
        Err(VarError::NotUnicode(raw)) => Some(raw.to_string_lossy().into_owned()),
    };
    let addr = match dev_addr(port.as_deref()) {
        Ok(addr) => addr,
        Err(e) => {
            error!("{e}");
            return ExitCode::FAILURE;
        }
    };
    // Bind before touching the database: a second instance on the same port exits here, before it deletes the
    // files of the instance already serving them.
    let listener = match TcpListener::bind(addr).await {
        Ok(listener) => listener,
        Err(e) => {
            error!("cannot bind {addr}: {e}");
            return ExitCode::FAILURE;
        }
    };
    let paths = default_paths();
    if let Err(e) = fresh_db(&paths.db).await {
        error!("cannot reset the dev database: {e}");
        return ExitCode::FAILURE;
    }
    warn!("dev only: public placeholder secrets, loopback only");
    info!(database = %paths.db.display(), "opening database");
    let app = match build_dev_app(paths).await {
        Ok(app) => app,
        Err(e) => {
            error!("startup failed: {e}");
            return ExitCode::FAILURE;
        }
    };
    info!("listening on {addr}");
    match axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
    {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            error!("server failed: {e}");
            ExitCode::FAILURE
        }
    }
}

/// The listen address: loopback only, on `DEV_API_PORT` (unset or empty: 8787). Anything but a decimal port
/// 1..=65535 is an error, never a silent fallback to 8787 (lane A's port, RULINGS 6 E2).
fn dev_addr(port: Option<&str>) -> Result<SocketAddr, &'static str> {
    let port = match port {
        None | Some("") => DEFAULT_DEV_API_PORT,
        Some(text) => text
            .parse::<u16>()
            .ok()
            // `u16::from_str` also takes a leading `+`.
            .filter(|&p| p != 0 && text.bytes().all(|b| b.is_ascii_digit()))
            .ok_or("DEV_API_PORT must be a port number 1..=65535")?,
    };
    Ok(SocketAddr::from((Ipv4Addr::LOCALHOST, port)))
}

/// The workspace root, fixed at compile time (two levels above `server/dev`), so no path depends on the working
/// directory the binary was started from.
fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .expect("invariant: server/dev lies two levels below the workspace root")
        .to_path_buf()
}

/// `target/e2e/dev.db` and the generated `server/content`, both under the workspace root.
fn default_paths() -> DevPaths {
    let root = workspace_root();
    DevPaths {
        db: root.join("target").join("e2e").join("dev.db"),
        content: root.join("server").join("content"),
    }
}

/// Creates `db`'s directory and removes the database with its `-wal` and `-shm` files, so every launch starts on an
/// empty database. A file that is already absent is fine; any other failure names the file.
async fn fresh_db(db: &Path) -> io::Result<()> {
    if let Some(dir) = db.parent() {
        tokio::fs::create_dir_all(dir)
            .await
            .map_err(|e| io::Error::new(e.kind(), format!("{}: {e}", dir.display())))?;
    }
    for suffix in ["", "-wal", "-shm"] {
        let mut file = db.as_os_str().to_owned();
        file.push(suffix);
        match tokio::fs::remove_file(&file).await {
            Ok(()) => {}
            Err(e) if e.kind() == io::ErrorKind::NotFound => {}
            Err(e) => {
                let file = Path::new(&file).display();
                return Err(io::Error::new(e.kind(), format!("{file}: {e}")));
            }
        }
    }
    Ok(())
}

async fn shutdown_signal() {
    if let Err(e) = tokio::signal::ctrl_c().await {
        // Without a Ctrl+C handler the server keeps running instead of shutting down at once.
        error!("cannot listen for Ctrl+C: {e}");
        std::future::pending::<()>().await;
    }
    info!("shutting down");
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

    #[test]
    fn dev_addr_is_loopback_on_dev_api_port() {
        let mut failures = Vec::new();
        for (port, expected) in [(None, 8787), (Some(""), 8787), (Some("8797"), 8797)] {
            let expected = SocketAddr::from((Ipv4Addr::LOCALHOST, expected));
            let got = dev_addr(port);
            if got != Ok(expected) {
                failures.push(format!("{port:?}: expected {expected}, got {got:?}"));
            }
        }
        for port in ["0", "65536", "abc", " 8797", "+8797"] {
            if let Ok(got) = dev_addr(Some(port)) {
                failures.push(format!("Some({port:?}): expected Err, got Ok({got})"));
            }
        }
        report(&failures);
    }

    #[tokio::test]
    async fn fresh_db_creates_dir_and_removes_files() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("e2e");
        let db = dir.join("dev.db");
        let mut failures = Vec::new();
        if let Err(e) = fresh_db(&db).await {
            failures.push(format!("missing directory: expected Ok, got {e}"));
        }
        if !dir.is_dir() {
            failures.push(format!(
                "{}: expected a directory after fresh_db, absent",
                dir.display()
            ));
        }
        // The removal checks below stand on their own even when the directory step failed.
        tokio::fs::create_dir_all(&dir).await.unwrap();
        for name in ["dev.db", "dev.db-wal", "dev.db-shm", "keep.txt"] {
            tokio::fs::write(dir.join(name), b"not a database\n")
                .await
                .unwrap();
        }
        if let Err(e) = fresh_db(&db).await {
            failures.push(format!("files present: expected Ok, got {e}"));
        }
        for name in ["dev.db", "dev.db-wal", "dev.db-shm"] {
            if dir.join(name).exists() {
                failures.push(format!("{name}: expected removed, still present"));
            }
        }
        if !dir.join("keep.txt").is_file() {
            failures.push("keep.txt: expected kept, removed".to_owned());
        }
        if let Err(e) = fresh_db(&db).await {
            failures.push(format!("already emptied: expected Ok, got {e}"));
        }
        report(&failures);
    }

    #[test]
    fn dev_paths_under_workspace_root() {
        let root = workspace_root();
        let mut failures = Vec::new();
        // An absolute root: a cwd-relative one (`../..`) would move with the directory the binary starts from.
        if !root.is_absolute() {
            failures.push(format!(
                "workspace root: expected an absolute path, got {}",
                root.display()
            ));
        }
        for manifest in ["Cargo.toml", "server/Cargo.toml", "server/dev/Cargo.toml"] {
            let path = root.join(manifest);
            if !path.is_file() {
                failures.push(format!("{}: expected a file", path.display()));
            }
        }
        let paths = default_paths();
        let db = root.join("target").join("e2e").join("dev.db");
        if paths.db != db {
            failures.push(format!(
                "db: expected {}, got {}",
                db.display(),
                paths.db.display()
            ));
        }
        let content = root.join("server").join("content");
        if paths.content != content {
            failures.push(format!(
                "content: expected {}, got {}",
                content.display(),
                paths.content.display()
            ));
        }
        report(&failures);
    }
}
