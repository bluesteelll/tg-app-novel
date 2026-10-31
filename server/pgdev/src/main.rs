//! `pgdev up|down|status|reset`: the dev cluster on `DEV_PG_PORT` under `DEV_PG_ROOT`, for humans and the
//! orchestrator. `up` also creates `tgn_local`, the database a local `server serve` runs on.

#![forbid(unsafe_code)]

use std::process::{Command, ExitCode, Stdio};
use std::time::Instant;

use pgdev::{DevCluster, PgDevError, UpOutcome};
use sqlx::{Connection, PgConnection};

const USAGE: &str = "usage: pgdev up|down|status|reset (env: PG_BIN, DEV_PG_PORT, DEV_PG_ROOT)";

/// A fixed name, so the statement is static text and needs no identifier quoting.
const CREATE_LOCAL_DB: &str = "CREATE DATABASE tgn_local";

/// `status` when no server runs: `pg_ctl status`'s own code.
const EXIT_NOT_RUNNING: u8 = 3;
const EXIT_USAGE: u8 = 2;

#[derive(Clone, Copy)]
enum Cmd {
    Up,
    Down,
    Status,
    Reset,
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let cmd = match args.as_slice() {
        [one] => match one.as_str() {
            "up" => Cmd::Up,
            "down" => Cmd::Down,
            "status" => Cmd::Status,
            "reset" => Cmd::Reset,
            _ => return usage(),
        },
        _ => return usage(),
    };
    let result = DevCluster::from_env().and_then(|cluster| match cmd {
        Cmd::Up => block_on(up(&cluster)),
        Cmd::Down => cluster.down().map(|()| {
            println!("down: port {}", cluster.port());
            ExitCode::SUCCESS
        }),
        Cmd::Reset => cluster.reset().map(|()| {
            println!("reset: {} deleted", cluster.data_dir().display());
            ExitCode::SUCCESS
        }),
        Cmd::Status => status(&cluster),
    });
    result.unwrap_or_else(|e| {
        eprintln!("pgdev: {e}");
        ExitCode::FAILURE
    })
}

fn usage() -> ExitCode {
    eprintln!("{USAGE}");
    ExitCode::from(EXIT_USAGE)
}

/// Only `up` and `status` talk to the server; the others stay synchronous.
fn block_on<T>(work: impl Future<Output = Result<T, PgDevError>>) -> Result<T, PgDevError> {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?
        .block_on(work)
}

/// One stable line: `up: already-up | started initdb=<bool> | joined-peer elapsed_ms=<n>`.
async fn up(cluster: &DevCluster) -> Result<ExitCode, PgDevError> {
    let started = Instant::now();
    let outcome = cluster.ensure_up().await?;
    create_local_db(cluster).await?;
    let what = match outcome {
        UpOutcome::AlreadyUp => "already-up".to_owned(),
        UpOutcome::Started { initdb } => format!("started initdb={initdb}"),
        UpOutcome::JoinedPeer => "joined-peer".to_owned(),
    };
    println!("up: {what} elapsed_ms={}", started.elapsed().as_millis());
    Ok(ExitCode::SUCCESS)
}

/// `CREATE DATABASE` looks the name up first only for a friendlier error, so a concurrent `up` gets `42P04`
/// (duplicate_database) or `23505` (unique_violation on `pg_database_datname_index`): both mean present.
async fn create_local_db(cluster: &DevCluster) -> Result<(), PgDevError> {
    let mut conn = PgConnection::connect(&cluster.admin_url()).await?;
    let created = sqlx::raw_sql(CREATE_LOCAL_DB).execute(&mut conn).await;
    conn.close().await?;
    match created {
        Ok(_) => Ok(()),
        Err(sqlx::Error::Database(e)) if matches!(e.code().as_deref(), Some("42P04" | "23505")) => {
            Ok(())
        }
        Err(e) => Err(e.into()),
    }
}

/// The port, the data directory and `pg_ctl status`; leftover `data.init-*` directories; with a running server its
/// version and the number of test databases. Exit 0 when a server runs, 3 when not.
fn status(cluster: &DevCluster) -> Result<ExitCode, PgDevError> {
    let data = cluster.data_dir();
    println!("port: {}", cluster.port());
    println!("data: {}", data.display());
    let pg_ctl = cluster
        .bin_dir()
        .join(format!("pg_ctl{}", std::env::consts::EXE_SUFFIX));
    let output = match Command::new(&pg_ctl)
        .arg("status")
        .arg("-D")
        .arg(&data)
        .stdin(Stdio::null())
        .output()
    {
        Ok(output) => output,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err(PgDevError::BinariesNotFound);
        }
        Err(e) => return Err(e.into()),
    };
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    for line in stdout.lines().chain(stderr.lines()) {
        println!("pg_ctl: {line}");
    }
    if let Some(dir) = data.parent()
        && let Ok(entries) = std::fs::read_dir(dir)
    {
        for entry in entries.flatten() {
            if entry
                .file_name()
                .to_string_lossy()
                .starts_with("data.init-")
            {
                println!("stale: {}", entry.path().display());
            }
        }
    }
    if output.status.code() != Some(0) {
        println!("running: no");
        return Ok(ExitCode::from(EXIT_NOT_RUNNING));
    }
    let (version, test_dbs) = block_on(server_facts(cluster))?;
    println!("server_version: {version}");
    println!("test databases (tgn_t_*): {test_dbs}");
    Ok(ExitCode::SUCCESS)
}

async fn server_facts(cluster: &DevCluster) -> Result<(String, i64), PgDevError> {
    let mut conn = PgConnection::connect(&cluster.admin_url()).await?;
    let facts = sqlx::query_as(
        "SELECT current_setting('server_version'), \
         (SELECT count(*) FROM pg_database WHERE datname LIKE 'tgn\\_t\\_%')",
    )
    .fetch_one(&mut conn)
    .await?;
    conn.close().await?;
    Ok(facts)
}
