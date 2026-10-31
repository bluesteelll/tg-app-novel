//! The server's one integration-test binary: every server test module links into it.

#![allow(
    clippy::unwrap_used,
    reason = "clippy.toml's allow-unwrap-in-tests covers #[test] fns only, not the shared helpers; a test fails loudly"
)]
// Every allowance in this crate states why (L2 review M2); `-D warnings` makes a bare `allow` a gate failure.
#![warn(clippy::allow_attributes_without_reason)]

mod auth;
mod bindings;
mod catalog;
mod common;
mod content;
mod puzzles;
mod saves;
mod schema;

use std::io::{BufRead, BufReader, Read};
use std::process::{Command, Stdio};
use std::sync::mpsc::{self, Sender};
use std::time::{Duration, Instant};

use axum::body::Body;
use axum::http::header::CACHE_CONTROL;
use axum::http::{Request, StatusCode};
use pgdev::{DevCluster, TestDb};
use server::AppState;
use server::config::{
    PLACEHOLDER_BOT_TOKEN, PLACEHOLDER_TOKEN_KEY_HEX, PLACEHOLDER_WEBHOOK_SECRET,
};
use server::ids::UserId;
use sqlx::{Connection, PgConnection};

#[tokio::test]
async fn health_ok() {
    let (st, _db) = common::test_state().await;
    let reply = common::call(
        &st,
        Request::get("/api/health").body(Body::empty()).unwrap(),
    )
    .await;
    let mut failures = Vec::new();
    if reply.status != StatusCode::OK {
        failures.push(format!(
            "status: expected 200, got {}",
            reply.status.as_u16()
        ));
    }
    if reply.body.as_ref() != b"ok" {
        failures.push(format!(
            "body: expected \"ok\", got {:?}",
            String::from_utf8_lossy(&reply.body)
        ));
    }
    let cache = reply
        .headers
        .get(CACHE_CONTROL)
        .map(|v| v.to_str().unwrap_or("<not text>"));
    if cache != Some("no-store") {
        failures.push(format!("cache-control: expected no-store, got {cache:?}"));
    }
    assert!(
        failures.is_empty(),
        "{} failures:\n{}",
        failures.len(),
        failures.join("\n")
    );
}

fn report(failures: &[String]) {
    assert!(
        failures.is_empty(),
        "{} failures:\n{}",
        failures.len(),
        failures.join("\n")
    );
}

/// `pg_database` rows named `name`, read on the cluster's admin database.
async fn databases_named(cluster: &DevCluster, name: &str) -> i64 {
    let mut admin = PgConnection::connect(&cluster.admin_url()).await.unwrap();
    let count = sqlx::query_scalar("SELECT count(*) FROM pg_database WHERE datname = $1")
        .bind(name)
        .fetch_one(&mut admin)
        .await
        .unwrap();
    admin.close().await.unwrap();
    count
}

/// Two states get two databases on the configured cluster: each state reaches its own guard's database, a table
/// made in one is absent from the other, and a dropped guard's database is gone. Kept outside `common.rs` so the
/// guard is not edited with the helper it guards.
#[tokio::test]
async fn test_db_isolated_per_state() {
    let (a, a_db) = common::test_state().await;
    let (b, b_db) = common::test_state().await;
    let mut failures = Vec::new();
    if a_db.name() == b_db.name() {
        failures.push(format!("names: expected two, got {} twice", a_db.name()));
    }
    let mut a_conn = common::raw_db(&a).await;
    let mut b_conn = common::raw_db(&b).await;
    for (state, conn, db) in [("a", &mut a_conn, &a_db), ("b", &mut b_conn, &b_db)] {
        if !db.name().starts_with("tgn_t_") {
            failures.push(format!(
                "{state}: expected a tgn_t_ name, got {}",
                db.name()
            ));
        }
        let reached: String = sqlx::query_scalar("SELECT current_database()::text")
            .fetch_one(conn)
            .await
            .unwrap();
        if reached != db.name() {
            failures.push(format!(
                "{state}: expected the state to reach its guard's database {}, got {reached}",
                db.name()
            ));
        }
    }

    if let Err(e) = sqlx::raw_sql("CREATE TABLE isolation_probe (x BIGINT)")
        .execute(&mut a_conn)
        .await
    {
        failures.push(format!("create isolation_probe in a: expected Ok, got {e}"));
    }
    for (state, conn, want) in [("a", &mut a_conn, true), ("b", &mut b_conn, false)] {
        let found: Option<String> =
            sqlx::query_scalar("SELECT to_regclass('isolation_probe')::text")
                .fetch_one(conn)
                .await
                .unwrap();
        if found.is_some() != want {
            let want = if want { "present" } else { "absent" };
            failures.push(format!(
                "table made in a, seen from {state}: expected {want}, got {found:?}"
            ));
        }
    }

    let cluster = DevCluster::from_env().unwrap();
    let b_name = b_db.name().to_owned();
    b_conn.close().await.unwrap();
    drop(b);
    drop(b_db);
    for (name, want) in [(b_name.as_str(), 0), (a_db.name(), 1)] {
        let got = databases_named(&cluster, name).await;
        if got != want {
            failures.push(format!(
                "pg_database rows named {name} after b's guard dropped: expected {want}, got {got}"
            ));
        }
    }
    a_conn.close().await.unwrap();
    report(&failures);
}

/// What a state's database holds: the applied migrations (version, installed_on) and the users rows (id, name).
type Applied = (Vec<(i64, String)>, Vec<(i64, String)>);

/// Reads [`Applied`] outside the pool, then closes `st`'s pool.
async fn applied(st: AppState) -> Applied {
    let mut conn = common::raw_db(&st).await;
    let migrations =
        sqlx::query_as("SELECT version, installed_on::text FROM _sqlx_migrations ORDER BY version")
            .fetch_all(&mut conn)
            .await
            .unwrap();
    let users = sqlx::query_as("SELECT id, first_name FROM users ORDER BY id")
        .fetch_all(&mut conn)
        .await
        .unwrap();
    conn.close().await.unwrap();
    st.repo.close().await;
    (migrations, users)
}

/// A restart: a second `AppState::new` on a migrated database applies nothing again and keeps the rows.
#[tokio::test]
async fn state_reopens_migrated_database() {
    let (st, db) = common::test_state().await;
    st.repo
        .upsert_user(UserId(1001), "Ann", None, 100)
        .await
        .unwrap();
    let (first_migrations, first_users) = applied(st).await;
    let mut failures = Vec::new();
    // The applied set by version, not a count: the next migration lane moves this pin on purpose.
    let versions: Vec<i64> = first_migrations
        .iter()
        .map(|(version, _)| *version)
        .collect();
    if versions != [1, 2] {
        failures.push(format!(
            "first start: expected versions [1, 2], got {versions:?}"
        ));
    }
    match AppState::new(common::test_config(&db)).await {
        Err(e) => failures.push(format!("second start: expected Ok, got {e}")),
        Ok(again) => {
            let (migrations, users) = applied(again).await;
            if migrations != first_migrations {
                failures.push(format!(
                    "second start: expected the migrations untouched {first_migrations:?}, got {migrations:?}"
                ));
            }
            let want = vec![(1001, "Ann".to_owned())];
            if users != want || first_users != want {
                failures.push(format!(
                    "users rows: expected {want:?} before and after, got {first_users:?} and {users:?}"
                ));
            }
        }
    }
    report(&failures);
}

/// Sends each line of `out` to `lines` from a thread of its own, until EOF (the process exited or was killed).
fn forward_lines(out: impl Read + Send + 'static, lines: Sender<String>) {
    std::thread::spawn(move || {
        for line in BufReader::new(out).lines() {
            let Ok(line) = line else { break };
            if lines.send(line).is_err() {
                break;
            }
        }
    });
}

/// The real `server serve` binary, with a password in `DATABASE_URL`'s userinfo: the startup log names the
/// database as `host:port/dbname` and never carries the password (`main.rs` logs `db::database_target`, never the
/// URL). The `listening` line proves the server came up, so an early exit cannot pass on the password's absence.
#[test]
fn serve_log_names_database_target_not_password() {
    const PASSWORD: &str = "PWSENT-SERVE-91";
    let db = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
        .block_on(TestDb::create());
    let url = db
        .url()
        .replacen("postgres@", &format!("postgres:{PASSWORD}@"), 1);
    // The trust cluster ignores the password; the URL must still carry it, or the test proves nothing.
    assert!(
        url.contains(&format!(":{PASSWORD}@127.0.0.1:")),
        "no password in {url}"
    );
    let target = format!(
        "127.0.0.1:{}/{}",
        DevCluster::from_env().unwrap().port(),
        db.name()
    );
    let mut child = Command::new(env!("CARGO_BIN_EXE_server"))
        .arg("serve")
        // Every variable `Config` reads, so none comes from the caller's environment; an empty value is unset.
        .envs([
            ("BOT_TOKEN", PLACEHOLDER_BOT_TOKEN),
            ("WEBHOOK_SECRET", PLACEHOLDER_WEBHOOK_SECRET),
            ("TOKEN_KEY", PLACEHOLDER_TOKEN_KEY_HEX),
            ("TOKEN_TTL_SECS", "1800"),
            ("INITDATA_MAX_AGE_SECS", "86400"),
            ("PUBLIC_APP_URL", "http://127.0.0.1/"),
            ("ADMIN_TELEGRAM_IDS", ""),
            ("STATIC_DIR", ""),
            (
                "CONTENT_DIR",
                concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/content"),
            ),
            ("DATABASE_URL", url.as_str()),
            ("TELEGRAM_ENV", "test"),
            ("LISTEN_ADDR", "127.0.0.1:0"),
            // The production default filter, as plain text: ANSI escapes would split `field=value`.
            ("RUST_LOG", "info"),
            ("NO_COLOR", "1"),
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let (lines, received) = mpsc::channel();
    forward_lines(child.stdout.take().unwrap(), lines.clone());
    forward_lines(child.stderr.take().unwrap(), lines);

    // A hang bound, not a timing verdict: both pipes closing (the server exited) ends the wait at once.
    let deadline = Instant::now() + Duration::from_secs(60);
    let mut log = Vec::new();
    let mut listening = false;
    while !listening {
        match received.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
            Ok(line) => {
                listening = line.contains("listening");
                log.push(line);
            }
            Err(_) => break,
        }
    }
    let mut failures = Vec::new();
    if let Err(e) = child.kill() {
        failures.push(format!("kill server: expected Ok, got {e}"));
    }
    let status = child.wait().unwrap();
    // The rest of the output: the readers reach EOF once the killed server's pipes close.
    while let Ok(line) = received.recv_timeout(Duration::from_secs(5)) {
        log.push(line);
    }

    failures.extend(
        log.iter()
            .filter(|line| line.contains(PASSWORD))
            .map(|line| format!("the log carries the DATABASE_URL password: {line}")),
    );
    let text = log.join("\n");
    if !listening {
        failures.push(format!(
            "expected a `listening` line within 60 s, got {status} and the log:\n{text}"
        ));
    }
    if !log
        .iter()
        .any(|line| line.contains("opening database") && line.contains(&target))
    {
        failures.push(format!(
            "expected an `opening database` line naming {target}, got the log:\n{text}"
        ));
    }
    report(&failures);
}

/// `n` cycles of create, migrate and drop on this thread's own runtime, as one `#[tokio::test]` runs them:
/// (create, migrate, drop) each.
fn state_cycles(n: usize) -> Vec<[Duration; 3]> {
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
                let migrating = Instant::now();
                let st = match AppState::new(common::test_config(&db)).await {
                    Ok(st) => st,
                    Err(e) => panic!("state on {}: {e}", db.name()),
                };
                let migrated = migrating.elapsed();
                let dropping = Instant::now();
                drop(st);
                drop(db);
                samples.push([created, migrated, dropping.elapsed()]);
            }
            samples
        })
}

fn print_percentiles(phase: &str, samples: &[[Duration; 3]]) {
    let step = |i: usize| samples.iter().map(|s| s[i]).collect::<Vec<_>>();
    let totals = samples
        .iter()
        .map(|s| s.iter().sum())
        .collect::<Vec<Duration>>();
    for (name, mut values) in [
        ("create", step(0)),
        ("migrate", step(1)),
        ("drop", step(2)),
        ("total", totals),
    ] {
        values.sort_unstable();
        let ms = |p: usize| values[(values.len() - 1) * p / 100].as_secs_f64() * 1000.0;
        println!(
            "{phase}: {name} p50 {:.1} ms, p95 {:.1} ms (n = {})",
            ms(50),
            ms(95),
            values.len()
        );
    }
}

/// The migrate share of a test's database lifecycle (decision record §3.8), comparable with pgdev's
/// `measure_test_db_lifecycle`: 50 sequential cycles, then 16 threads x 4 cycles (the suite's thread count).
#[test]
#[ignore = "a measurement: cargo test -p server --test it measure_state_lifecycle -- --ignored --nocapture"]
fn measure_state_lifecycle() {
    // The first create brings the cluster up and sweeps: not a sample.
    state_cycles(1);
    let sequential = state_cycles(50);
    let parallel: Vec<[Duration; 3]> = std::thread::scope(|scope| {
        let workers: Vec<_> = (0..16).map(|_| scope.spawn(|| state_cycles(4))).collect();
        workers
            .into_iter()
            .flat_map(|worker| worker.join().unwrap())
            .collect()
    });
    print_percentiles("sequential 50", &sequential);
    print_percentiles("16-way 16 x 4", &parallel);
}
