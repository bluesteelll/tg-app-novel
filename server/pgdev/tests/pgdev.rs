//! pgdev against live clusters. They need PostgreSQL 18 binaries (`PG_BIN`, or `pg_ctl` on PATH) and use the
//! cluster on `DEV_PG_PORT` under `DEV_PG_ROOT`, starting it when it is down; `ensure_up_concurrent_cold_start`
//! makes a private cluster of its own and removes it.

#![allow(
    clippy::unwrap_used,
    reason = "clippy.toml's allow-unwrap-in-tests covers #[test] fns only, not the shared helpers; a test fails loudly"
)]
// Every allowance in this crate states why; `-D warnings` makes a bare `allow` a gate failure.
#![warn(clippy::allow_attributes_without_reason)]

use std::collections::BTreeMap;
use std::io::Read;
use std::net::{Ipv4Addr, TcpListener};
use std::path::{Path, PathBuf};
use std::process::{Command, ExitStatus, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use pgdev::{DbName, DevCluster, TestDb, UpOutcome};
use sqlx::{Connection, PgConnection};

fn report(failures: &[String]) {
    assert!(
        failures.is_empty(),
        "{} failures:\n{}",
        failures.len(),
        failures.join("\n")
    );
}

fn env_cluster() -> DevCluster {
    DevCluster::from_env().unwrap_or_else(|e| panic!("DevCluster::from_env: {e}"))
}

/// The postmaster's pid: the first line of `postmaster.pid`.
async fn postmaster_pid(cluster: &DevCluster) -> String {
    let file = cluster.data_dir().join("postmaster.pid");
    match tokio::fs::read_to_string(&file).await {
        Ok(text) => text.lines().next().unwrap_or_default().to_owned(),
        Err(e) => format!("<{}: {e}>", file.display()),
    }
}

#[tokio::test]
async fn cluster_ensure_up_idempotent() {
    let cluster = env_cluster();
    if let Err(e) = cluster.ensure_up().await {
        panic!("first ensure_up: {e}");
    }
    let pid_before = postmaster_pid(&cluster).await;
    let mut failures = Vec::new();
    match cluster.ensure_up().await {
        Ok(UpOutcome::AlreadyUp) => {}
        Ok(other) => failures.push(format!(
            "second ensure_up: expected AlreadyUp, got {other:?}"
        )),
        Err(e) => failures.push(format!(
            "second ensure_up: expected AlreadyUp, got Err({e})"
        )),
    }
    let pid_after = postmaster_pid(&cluster).await;
    if pid_after != pid_before {
        failures.push(format!(
            "postmaster pid: expected {pid_before} unchanged, got {pid_after}"
        ));
    }

    let mut conn = PgConnection::connect(&cluster.admin_url()).await.unwrap();
    let (major, listen, checksums, port, messages): (i32, String, String, String, String) =
        sqlx::query_as(
            "SELECT current_setting('server_version_num')::int4 / 10000, \
             current_setting('listen_addresses'), current_setting('data_checksums'), current_setting('port'), \
             current_setting('lc_messages')",
        )
        .fetch_one(&mut conn)
        .await
        .unwrap();
    // Read as text over the `postgres` admin connection: a session on template1 would make a concurrent
    // CREATE DATABASE fail (55006), and `"char"` does not decode as a string.
    let provider: String = sqlx::query_scalar(
        "SELECT datlocprovider::text FROM pg_database WHERE datname = 'template1'",
    )
    .fetch_one(&mut conn)
    .await
    .unwrap();
    conn.close().await.unwrap();
    for (setting, expected, got) in [
        (
            "server_version_num / 10000",
            "18".to_owned(),
            major.to_string(),
        ),
        ("listen_addresses", "127.0.0.1".to_owned(), listen),
        ("data_checksums", "on".to_owned(), checksums),
        ("port", cluster.port().to_string(), port),
        ("lc_messages", "C".to_owned(), messages),
        ("template1.datlocprovider", "b".to_owned(), provider),
    ] {
        if got != expected {
            failures.push(format!("{setting}: expected {expected}, got {got}"));
        }
    }
    report(&failures);
}

/// A loopback port nobody listens on right now.
fn free_port() -> u16 {
    TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
        .and_then(|listener| listener.local_addr())
        .unwrap()
        .port()
}

/// A private cluster's root: on drop (on panic too) it stops that cluster and deletes the root. Errors are printed,
/// never panicked.
struct ColdRoot {
    cluster: DevCluster,
    root: PathBuf,
}

impl Drop for ColdRoot {
    fn drop(&mut self) {
        let data = self.cluster.data_dir();
        if data.is_dir() {
            let pg_ctl = self
                .cluster
                .bin_dir()
                .join(format!("pg_ctl{}", std::env::consts::EXE_SUFFIX));
            match Command::new(&pg_ctl)
                .args(["stop", "-m", "immediate", "-w", "-t", "60", "-D"])
                .arg(&data)
                .stdin(Stdio::null())
                .output()
            {
                Ok(out) if out.status.success() => {}
                Ok(out) => eprintln!(
                    "ColdRoot: pg_ctl stop -D {}: {}: {}",
                    data.display(),
                    out.status,
                    String::from_utf8_lossy(&out.stderr).trim()
                ),
                Err(e) => eprintln!("ColdRoot: {}: {e}", pg_ctl.display()),
            }
        }
        // The stopped server's processes may hold their files a moment longer.
        let root = self.root.clone();
        let removed = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|e| e.to_string())
            .and_then(|rt| {
                rt.block_on(async {
                    let mut last = String::new();
                    for _ in 0..40 {
                        match tokio::fs::remove_dir_all(&root).await {
                            Ok(()) => return Ok(()),
                            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
                            Err(e) => last = e.to_string(),
                        }
                        tokio::time::sleep(Duration::from_millis(250)).await;
                    }
                    Err(last)
                })
            });
        if let Err(e) = removed {
            eprintln!("ColdRoot: cannot delete {}: {e}", self.root.display());
        }
    }
}

enum Event {
    Closed {
        caller: usize,
        stream: &'static str,
        text: String,
    },
    Exited {
        caller: usize,
        status: std::io::Result<ExitStatus>,
    },
}

/// Reads `pipe` to EOF on its own thread and reports the text then.
fn read_to_eof(
    events: &mpsc::Sender<Event>,
    caller: usize,
    stream: &'static str,
    mut pipe: impl Read + Send + 'static,
) {
    let events = events.clone();
    std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let text = match pipe.read_to_end(&mut bytes) {
            Ok(_) => String::from_utf8_lossy(&bytes).into_owned(),
            Err(e) => format!("<read error: {e}>"),
        };
        // The receiver is gone only when the test already failed.
        let _ = events.send(Event::Closed {
            caller,
            stream,
            text,
        });
    });
}

#[test]
fn ensure_up_concurrent_cold_start() {
    let bin = env_cluster().bin_dir().to_path_buf();
    let port = free_port().to_string();
    let root = Path::new(env!("CARGO_TARGET_TMPDIR")).join(format!(
        "pgdev-cold-{}-{:08x}",
        std::process::id(),
        getrandom::u32().unwrap()
    ));
    let env: [(&str, &str); 3] = [
        ("PG_BIN", bin.to_str().unwrap()),
        ("DEV_PG_ROOT", root.to_str().unwrap()),
        ("DEV_PG_PORT", &port),
    ];
    let cluster = DevCluster::from_lookup(|key| {
        env.iter()
            .find(|(name, _)| *name == key)
            .map(|(_, value)| (*value).to_owned())
    })
    .unwrap();
    let guard = ColdRoot {
        cluster: cluster.clone(),
        root: root.clone(),
    };

    let started = Instant::now();
    let (events, received) = mpsc::channel();
    for caller in 1..=2 {
        let mut child = Command::new(env!("CARGO_BIN_EXE_pgdev"))
            .arg("up")
            .envs(env)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        read_to_eof(&events, caller, "stdout", child.stdout.take().unwrap());
        read_to_eof(&events, caller, "stderr", child.stderr.take().unwrap());
        let exited = events.clone();
        std::thread::spawn(move || {
            let status = child.wait();
            let _ = exited.send(Event::Exited { caller, status });
        });
    }
    drop(events);

    // A hang bound, not a timing verdict: a process that keeps a caller's pipe never lets it reach EOF.
    let deadline = started + Duration::from_secs(300);
    let mut texts = BTreeMap::new();
    let mut statuses = BTreeMap::new();
    while texts.len() < 4 || statuses.len() < 2 {
        let left = deadline.saturating_duration_since(Instant::now());
        match received.recv_timeout(left) {
            Ok(Event::Closed {
                caller,
                stream,
                text,
            }) => {
                texts.insert((caller, stream), text);
            }
            Ok(Event::Exited { caller, status }) => {
                statuses.insert(caller, status);
            }
            Err(_) => break,
        }
    }
    let elapsed_ms = started.elapsed().as_millis();
    let up_lines: Vec<&str> = (1..=2)
        .map(|caller| {
            texts
                .get(&(caller, "stdout"))
                .and_then(|text| text.lines().find(|line| line.starts_with("up: ")))
                .unwrap_or("<no up line>")
        })
        .collect();
    println!("ensure_up_concurrent_cold_start: elapsed_ms={elapsed_ms} {up_lines:?}");

    let mut failures = Vec::new();
    for caller in 1..=2 {
        for stream in ["stdout", "stderr"] {
            if !texts.contains_key(&(caller, stream)) {
                failures.push(format!(
                    "pgdev up #{caller}: {stream} not closed within 300 s while the cluster runs"
                ));
            }
        }
        let stderr = texts.get(&(caller, "stderr")).map_or("", String::as_str);
        match statuses.get(&caller) {
            Some(Ok(status)) if status.success() => {}
            Some(Ok(status)) => failures.push(format!(
                "pgdev up #{caller}: {status}; stderr: {}",
                stderr.trim()
            )),
            Some(Err(e)) => failures.push(format!("pgdev up #{caller}: wait failed: {e}")),
            None => failures.push(format!("pgdev up #{caller}: still running after 300 s")),
        }
    }

    // Both pipes are closed and both callers are gone: the cluster must still be serving. This build's `pgdev up`
    // always started this cluster, so its settings are the code's: a slot cluster keeps those of whichever build
    // started it.
    let messages = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
        .block_on(async {
            let mut conn = PgConnection::connect(&cluster.admin_url()).await?;
            let messages: String = sqlx::query_scalar("SELECT current_setting('lc_messages')")
                .fetch_one(&mut conn)
                .await?;
            conn.close().await?;
            Ok::<_, sqlx::Error>(messages)
        });
    match messages {
        Ok(messages) if messages == "C" => {}
        Ok(messages) => failures.push(format!(
            "lc_messages on the private cluster: expected C, got {messages}"
        )),
        Err(e) => failures.push(format!("connect after both callers ended: {e}")),
    }

    let cluster_dir = cluster.data_dir().parent().unwrap().to_path_buf();
    if !cluster.data_dir().is_dir() {
        failures.push(format!(
            "{}: expected one data directory, absent",
            cluster.data_dir().display()
        ));
    }
    let leftovers: Vec<String> = std::fs::read_dir(&cluster_dir)
        .map(|entries| {
            entries
                .flatten()
                .map(|entry| entry.file_name().to_string_lossy().into_owned())
                .filter(|name| name.starts_with("data.init-"))
                .collect()
        })
        .unwrap_or_default();
    if !leftovers.is_empty() {
        failures.push(format!("expected no data.init-* left, got {leftovers:?}"));
    }

    // The start loser's own pg_ctl fails (it waits on the winner's open server log, then exits 1), so it waits for
    // the winner: a loser that went back to step 1 instead would report `already-up`, and a launcher that lost
    // pg_ctl's exit code would report `started` twice.
    let outcomes: Vec<&str> = up_lines
        .iter()
        .map(|line| line.split(" elapsed_ms=").next().unwrap_or(line))
        .collect();
    let started_count = outcomes
        .iter()
        .filter(|outcome| outcome.starts_with("up: started"))
        .count();
    let joined_count = outcomes
        .iter()
        .filter(|outcome| **outcome == "up: joined-peer")
        .count();
    if started_count != 1 || joined_count != 1 {
        failures.push(format!(
            "outcomes: expected one `up: started` and one `up: joined-peer`, got {outcomes:?}"
        ));
    }
    drop(guard);
    report(&failures);
}

async fn admin(cluster: &DevCluster) -> PgConnection {
    PgConnection::connect(&cluster.admin_url()).await.unwrap()
}

async fn exists(cluster: &DevCluster, name: &str) -> bool {
    let mut conn = admin(cluster).await;
    let found = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1)")
        .bind(name)
        .fetch_one(&mut conn)
        .await
        .unwrap();
    conn.close().await.unwrap();
    found
}

fn presence(present: bool) -> &'static str {
    if present { "present" } else { "absent" }
}

#[tokio::test]
async fn test_db_created_then_dropped_on_drop() {
    let cluster = env_cluster();
    let db = TestDb::create().await;
    let name = db.name().to_owned();
    let mut failures = Vec::new();
    if !exists(&cluster, &name).await {
        failures.push(format!(
            "{name}: expected present in pg_database while the guard lives, absent"
        ));
    }
    drop(db);
    if exists(&cluster, &name).await {
        failures.push(format!("{name}: expected absent from pg_database, present"));
    }
    report(&failures);
}

#[tokio::test]
async fn test_dbs_isolated() {
    let (a, b) = (TestDb::create().await, TestDb::create().await);
    let mut failures = Vec::new();
    if a.name() == b.name() {
        failures.push(format!("two guards share one database {}", a.name()));
    }
    let mut in_a = PgConnection::connect(&a.url()).await.unwrap();
    let mut in_b = PgConnection::connect(&b.url()).await.unwrap();
    sqlx::raw_sql("CREATE TABLE isolation_probe (id int)")
        .execute(&mut in_a)
        .await
        .unwrap();
    for (db, conn, expected) in [(a.name(), &mut in_a, true), (b.name(), &mut in_b, false)] {
        let present: bool = sqlx::query_scalar("SELECT to_regclass('isolation_probe') IS NOT NULL")
            .fetch_one(&mut *conn)
            .await
            .unwrap();
        if present != expected {
            failures.push(format!(
                "isolation_probe in {db}: expected {}, got {}",
                presence(expected),
                presence(present)
            ));
        }
    }
    in_a.close().await.unwrap();
    in_b.close().await.unwrap();
    report(&failures);
}

#[tokio::test]
async fn recreate_drops_open_connections() {
    let cluster = env_cluster();
    let db = TestDb::create().await;
    let name = DbName::parse(db.name()).unwrap();
    let mut old = PgConnection::connect(&db.url()).await.unwrap();
    sqlx::raw_sql("CREATE TABLE before_recreate (id int)")
        .execute(&mut old)
        .await
        .unwrap();
    let mut failures = Vec::new();
    if let Err(e) = cluster.recreate(&name).await {
        failures.push(format!("recreate {name}: expected Ok, got {e}"));
    }
    if sqlx::raw_sql("SELECT 1").execute(&mut old).await.is_ok() {
        failures.push(
            "the connection opened before recreate: expected an error on its next query, got a result"
                .to_owned(),
        );
    }
    drop(old);
    let mut new = PgConnection::connect(&db.url()).await.unwrap();
    let relations: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace",
    )
    .fetch_one(&mut new)
    .await
    .unwrap();
    new.close().await.unwrap();
    if relations != 0 {
        failures.push(format!(
            "{name} after recreate: expected empty, got {relations} relations in public"
        ));
    }
    report(&failures);
}

#[tokio::test]
async fn sweep_drops_only_stale_test_dbs() {
    let cluster = env_cluster();
    let fresh = TestDb::create().await;
    let three_hours_ago = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
        - 3 * 60 * 60;
    let stale = DbName::parse(&format!(
        "tgn_t_{three_hours_ago}_{:08x}",
        getrandom::u32().unwrap()
    ))
    .unwrap();
    cluster.recreate(&stale).await.unwrap();
    let mut conn = admin(&cluster).await;
    for statement in ["CREATE DATABASE tgn_dev_0", "CREATE DATABASE tgn_local"] {
        match sqlx::raw_sql(statement).execute(&mut conn).await {
            Ok(_) => {}
            // Already there (a concurrent creator gets 23505, not 42P04). Never dropped here: another target's run on
            // the shared slot may be using it.
            Err(sqlx::Error::Database(e))
                if matches!(e.code().as_deref(), Some("42P04" | "23505")) => {}
            Err(e) => panic!("{statement}: {e}"),
        }
    }
    conn.close().await.unwrap();

    let mut failures = Vec::new();
    if let Err(e) = cluster.sweep_stale(7200).await {
        failures.push(format!("sweep_stale(7200): expected Ok, got {e}"));
    }
    // Presence, not the returned count: this binary's own once-per-process sweep may drop `stale` first.
    for (name, expected) in [
        (stale.as_str(), false),
        (fresh.name(), true),
        ("tgn_dev_0", true),
        ("tgn_local", true),
        ("postgres", true),
    ] {
        let present = exists(&cluster, name).await;
        if present != expected {
            failures.push(format!(
                "{name}: expected {} after sweep_stale(7200), got {}",
                presence(expected),
                presence(present)
            ));
        }
    }
    report(&failures);
}

#[tokio::test]
async fn test_db_carries_hostile_defaults() {
    let db = TestDb::create().await;
    let mut conn = PgConnection::connect(&db.url()).await.unwrap();
    let (synchronous_commit, isolation): (String, String) = sqlx::query_as(
        "SELECT current_setting('synchronous_commit'), current_setting('default_transaction_isolation')",
    )
    .fetch_one(&mut conn)
    .await
    .unwrap();
    conn.close().await.unwrap();
    let mut failures = Vec::new();
    if synchronous_commit != "off" {
        failures.push(format!(
            "synchronous_commit: expected off, got {synchronous_commit}"
        ));
    }
    if isolation != "repeatable read" {
        failures.push(format!(
            "default_transaction_isolation: expected repeatable read, got {isolation}"
        ));
    }
    report(&failures);
}

/// `n` create-then-drop cycles on this thread's own runtime, as one `#[tokio::test]` runs them: (create, drop) each.
fn lifecycle_cycles(n: usize) -> Vec<(Duration, Duration)> {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
        .block_on(async {
            let mut samples = Vec::with_capacity(n);
            for _ in 0..n {
                let creating = Instant::now();
                let db = TestDb::create().await;
                let created = creating.elapsed();
                let dropping = Instant::now();
                drop(db);
                samples.push((created, dropping.elapsed()));
            }
            samples
        })
}

fn print_percentiles(phase: &str, samples: &[(Duration, Duration)]) {
    let creates: Vec<Duration> = samples.iter().map(|s| s.0).collect();
    let drops: Vec<Duration> = samples.iter().map(|s| s.1).collect();
    let totals: Vec<Duration> = samples.iter().map(|s| s.0 + s.1).collect();
    for (step, mut values) in [("create", creates), ("drop", drops), ("total", totals)] {
        values.sort_unstable();
        let ms = |p: usize| values[(values.len() - 1) * p / 100].as_secs_f64() * 1000.0;
        println!(
            "{phase}: {step} p50 {:.1} ms, p95 {:.1} ms (n = {})",
            ms(50),
            ms(95),
            values.len()
        );
    }
}

#[test]
#[ignore = "a measurement: cargo test -p pgdev --test pgdev measure_test_db_lifecycle -- --ignored --nocapture"]
fn measure_test_db_lifecycle() {
    // The first create brings the cluster up and sweeps: not a sample.
    lifecycle_cycles(1);
    let sequential = lifecycle_cycles(50);
    let parallel: Vec<(Duration, Duration)> = std::thread::scope(|scope| {
        let workers: Vec<_> = (0..16)
            .map(|_| scope.spawn(|| lifecycle_cycles(4)))
            .collect();
        workers
            .into_iter()
            .flat_map(|worker| worker.join().unwrap())
            .collect()
    });
    print_percentiles("sequential 50", &sequential);
    print_percentiles("16-way 16 x 4", &parallel);
}
