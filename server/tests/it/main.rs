//! The server's one integration-test binary: every server test module links into it.

#![allow(
    clippy::unwrap_used,
    reason = "clippy.toml's allow-unwrap-in-tests covers #[test] fns only, not the shared helpers; a test fails loudly"
)]
// Every allowance in this crate states why (L2 review M2); `-D warnings` makes a bare `allow` a gate failure.
#![warn(clippy::allow_attributes_without_reason)]

mod auth;
mod auto_refunds;
mod bindings;
mod bot;
mod cards;
mod catalog;
mod common;
mod content;
mod dto_samples;
mod economy;
mod gifts;
mod legal;
mod payments;
mod puzzles;
mod referrals;
mod refunds;
mod saves;
mod schema;
mod share;
mod social;
mod stats;
mod webhook;

use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, ExitStatus, Stdio};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::time::{Duration, Instant};

use axum::body::Body;
use axum::http::header::CACHE_CONTROL;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use pgdev::{DevCluster, TestDb};
use server::AppState;
use server::api::static_files;
use server::config::{
    PLACEHOLDER_BOT_TOKEN, PLACEHOLDER_TOKEN_KEY_HEX, PLACEHOLDER_WEBHOOK_SECRET,
};
use server::ids::UserId;
use server::telegram::texts;
use sqlx::{Connection, PgConnection};
use tower::ServiceExt;

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
    if versions != [1, 2, 3, 4, 5, 6, 7] {
        failures.push(format!(
            "first start: expected versions [1, 2, 3, 4, 5, 6, 7], got {versions:?}"
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
            ("PRIVACY_OPERATOR_FILE", ""),
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

/// Owner Q9's sweep runs in the real `server serve`: a database migrated and seeded with an unapplied payment whose
/// `auto_refunds` row is long due, then the binary started on it with the placeholder `BOT_TOKEN` (its gateway is
/// `Disabled`: no call leaves the process, and nothing runs `server setup`) and no admin. Within 10 s of `listening`
/// the log names a failed attempt of `c-serve`, written before it was logged: the row reads 1 attempt, 1 refusal and
/// the gateway's text.
#[test]
fn serve_runs_auto_refund_sweep() {
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    let db = rt.block_on(async {
        let db = TestDb::create().await;
        let st = match AppState::new(common::test_config(&db)).await {
            Ok(st) => st,
            Err(e) => panic!("setup: migrate {}: {e}", db.name()),
        };
        st.repo.close().await;
        let mut c = PgConnection::connect(&db.url()).await.unwrap();
        sqlx::query(
            "INSERT INTO payments (telegram_payment_charge_id, invoice_payload, user_id, amount, currency, \
             provider_payment_charge_id, paid_at) VALUES ('c-serve', 'o-x', 1001, 1, 'XTR', '', 1700000000)",
        )
        .execute(&mut c)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO auto_refunds (charge_id, created_at, attempts, refusals, due_at) \
             VALUES ('c-serve', 1700000000, 0, 0, 1700000000)",
        )
        .execute(&mut c)
        .await
        .unwrap();
        c.close().await.unwrap();
        db
    });
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
            ("DATABASE_URL", db.url().as_str()),
            ("TELEGRAM_ENV", "test"),
            ("LISTEN_ADDR", "127.0.0.1:0"),
            ("PRIVACY_OPERATOR_FILE", ""),
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

    // Hang bounds, not timing verdicts: the server exiting closes both pipes and ends each wait at once.
    let mut log = Vec::new();
    let mut listening = false;
    let deadline = Instant::now() + Duration::from_secs(60);
    while !listening {
        match received.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
            Ok(line) => {
                listening = line.contains("listening");
                log.push(line);
            }
            Err(_) => break,
        }
    }
    let mut attempted = false;
    let deadline = Instant::now() + Duration::from_secs(10);
    while listening && !attempted {
        match received.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
            Ok(line) => {
                attempted = line.contains("auto-refund attempt failed") && line.contains("c-serve");
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
    while let Ok(line) = received.recv_timeout(Duration::from_secs(5)) {
        log.push(line);
    }
    let text = log.join("\n");
    if !listening {
        failures.push(format!(
            "expected a `listening` line within 60 s, got {status} and the log:\n{text}"
        ));
    } else if !attempted {
        failures.push(format!(
            "no \"auto-refund attempt failed\" line for c-serve within 10 s after listening; the log:\n{text}"
        ));
    }
    let row: Option<(i64, i64, Option<String>)> = rt.block_on(async {
        let mut c = PgConnection::connect(&db.url()).await.unwrap();
        let row = sqlx::query_as(
            "SELECT attempts, refusals, last_error FROM auto_refunds WHERE charge_id = 'c-serve'",
        )
        .fetch_optional(&mut c)
        .await
        .unwrap();
        c.close().await.unwrap();
        row
    });
    let want = (
        1,
        1,
        Some("bot api disabled: placeholder BOT_TOKEN".to_owned()),
    );
    if row.as_ref() != Some(&want) {
        failures.push(format!(
            "c-serve's row (attempts, refusals, last_error): expected {want:?}, got {row:?}"
        ));
    }
    drop(rt);
    report(&failures);
}

/// The webhook secret is checked before the body is read: a 2 MiB body with a wrong secret, or with none, is 401
/// (not buffered first and refused 413), and only with the right secret does the 1 MiB limit answer 413.
#[tokio::test]
async fn webhook_secret_checked_before_body_read() {
    let (st, _db) = common::test_state().await;
    let body = vec![b' '; 2 * 1024 * 1024];
    let secret = st.cfg.webhook_secret.clone();
    let mut failures = Vec::new();
    for (case, secrets, want) in [
        ("wrong secret, 2 MiB", vec![b"wrong-secret".as_slice()], 401),
        ("no secret, 2 MiB", Vec::new(), 401),
        ("the right secret, 2 MiB", vec![secret.as_bytes()], 413),
    ] {
        let got = webhook::post_webhook(&st, &secrets, body.clone())
            .await
            .status
            .as_u16();
        if got != want {
            failures.push(format!("{case}: expected {want}, got {got}"));
        }
    }
    report(&failures);
}

/// A fresh directory `name` under the test binary's scratch root (`CARGO_TARGET_TMPDIR`), emptied first. The removal
/// does not follow a link or a junction left inside it by an earlier run (std's `remove_dir_all`).
fn scratch_dir(name: &str) -> PathBuf {
    let dir = Path::new(env!("CARGO_TARGET_TMPDIR")).join(name);
    if dir.exists() {
        std::fs::remove_dir_all(&dir).unwrap();
    }
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// A link at `link` to the directory `target`: a junction on Windows (`mklink /J`, no privilege needed), a symlink
/// elsewhere. A failure fails the test: the case is never skipped.
fn dir_link(link: &Path, target: &Path) {
    #[cfg(windows)]
    {
        let out = Command::new("cmd")
            .arg("/C")
            .arg("mklink")
            .arg("/J")
            .arg(link)
            .arg(target)
            .output()
            .unwrap();
        assert!(
            out.status.success(),
            "mklink /J {} {}: {}",
            link.display(),
            target.display(),
            String::from_utf8_lossy(&out.stderr)
        );
    }
    #[cfg(not(windows))]
    std::os::unix::fs::symlink(target, link).unwrap();
}

/// The real `server serve` with `static_dir` and `content_dir` (every other variable set; the database a closed port,
/// so a start that gets that far fails there): its log, until it exits (bounded at 60 s, then killed).
fn serve_log(static_dir: &Path, content_dir: &Path) -> Vec<String> {
    let mut child = Command::new(env!("CARGO_BIN_EXE_server"))
        .arg("serve")
        .envs([
            ("BOT_TOKEN", PLACEHOLDER_BOT_TOKEN),
            ("WEBHOOK_SECRET", PLACEHOLDER_WEBHOOK_SECRET),
            ("TOKEN_KEY", PLACEHOLDER_TOKEN_KEY_HEX),
            ("TOKEN_TTL_SECS", "1800"),
            ("INITDATA_MAX_AGE_SECS", "86400"),
            ("PUBLIC_APP_URL", "http://127.0.0.1/"),
            ("ADMIN_TELEGRAM_IDS", ""),
            ("DATABASE_URL", "postgres://postgres@127.0.0.1:1/tgn_static"),
            ("TELEGRAM_ENV", "test"),
            ("LISTEN_ADDR", "127.0.0.1:0"),
            ("PRIVACY_OPERATOR_FILE", ""),
            ("RUST_LOG", "info"),
            ("NO_COLOR", "1"),
        ])
        .env("STATIC_DIR", static_dir)
        .env("CONTENT_DIR", content_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let (lines, received) = mpsc::channel();
    forward_lines(child.stdout.take().unwrap(), lines.clone());
    forward_lines(child.stderr.take().unwrap(), lines);
    let deadline = Instant::now() + Duration::from_secs(60);
    let mut log = Vec::new();
    loop {
        match received.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
            Ok(line) => log.push(line),
            Err(RecvTimeoutError::Disconnected) => break,
            Err(RecvTimeoutError::Timeout) => {
                log.push("<no exit within 60 s: killed>".to_owned());
                child.kill().unwrap();
                break;
            }
        }
    }
    child.wait().unwrap();
    log
}

/// Principle 0 at startup: `server serve` with `CONTENT_DIR` inside `STATIC_DIR` exits with a `STATIC_DIR` refusal
/// before it opens the database; with the two disjoint it goes on to open it. `check` itself refuses `STATIC_DIR`
/// inside `CONTENT_DIR`, the two as one, a missing `STATIC_DIR`, and a junction or link inside `STATIC_DIR` that
/// resolves to the content; it accepts two disjoint trees.
#[test]
fn static_dir_must_not_contain_content_dir() {
    let root = scratch_dir("static-check");
    let site = root.join("site");
    let nested = site.join("content");
    let content = root.join("content");
    let linked = root.join("linked");
    for dir in [&nested, &content, &linked] {
        std::fs::create_dir_all(dir).unwrap();
    }
    std::fs::write(site.join("index.html"), "<!doctype html>").unwrap();
    std::fs::write(content.join("paid.json"), "{}").unwrap();
    dir_link(&linked.join("paid"), &content);
    let mut failures = Vec::new();

    let refused = serve_log(&site, &nested);
    let refusal = refused
        .iter()
        .position(|line| line.contains("STATIC_DIR") && line.contains("ERROR"));
    let opening = refused
        .iter()
        .position(|line| line.contains("opening database"));
    if refusal.is_none() || opening.is_some() {
        failures.push(format!(
            "CONTENT_DIR inside STATIC_DIR: expected a STATIC_DIR refusal before opening the database, got:\n{}",
            refused.join("\n")
        ));
    }
    let control = serve_log(&root.join("missing"), &content);
    if !control
        .iter()
        .any(|line| line.contains("STATIC_DIR") && line.contains("ERROR"))
    {
        failures.push(format!(
            "a missing STATIC_DIR: expected a STATIC_DIR refusal, got:\n{}",
            control.join("\n")
        ));
    }
    std::fs::create_dir_all(root.join("site2")).unwrap();
    let disjoint = serve_log(&root.join("site2"), &content);
    if !disjoint
        .iter()
        .any(|line| line.contains("opening database"))
    {
        failures.push(format!(
            "disjoint trees: expected the start to reach `opening database`, got:\n{}",
            disjoint.join("\n")
        ));
    }

    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    let outcome = |static_dir: &Path, content_dir: &Path| match runtime
        .block_on(static_files::check(static_dir, content_dir))
    {
        Ok(dir) => format!("Ok({})", dir.root().display()),
        Err(e) => format!("{e:?}"),
    };
    for (case, static_dir, content_dir, want) in [
        (
            "CONTENT_DIR inside STATIC_DIR",
            &site,
            &nested,
            "ContainsContent",
        ),
        (
            "STATIC_DIR inside CONTENT_DIR",
            &nested,
            &site,
            "InsideContent",
        ),
        ("one directory", &content, &content, "Same"),
        (
            "a missing STATIC_DIR",
            &root.join("nope"),
            &content,
            "Unresolved",
        ),
        (
            "a junction to CONTENT_DIR inside STATIC_DIR",
            &linked,
            &content,
            "Escape",
        ),
        ("disjoint trees", &root.join("site2"), &content, "Ok("),
    ] {
        let got = outcome(static_dir, content_dir);
        if !got.starts_with(want) {
            failures.push(format!("check, {case}: expected {want}.., got {got}"));
        }
    }
    report(&failures);
}

/// Critique O9: `check` refuses a dot-entry anywhere in `STATIC_DIR` (`GET /.env` would serve the host's secrets): a
/// `.env` at the root, a dot-file deeper down, a dot-entry inside `.vite`, a `.vite` below the root, a `.vite` that is a
/// file, and `.well-known` (the reverse proxy's). Only the root's `.vite` directory passes, with Vite's manifest in it.
#[test]
fn static_dir_refuses_dot_entries() {
    let root = scratch_dir("static-dots");
    let content = root.join("content");
    std::fs::create_dir_all(&content).unwrap();
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    let mut failures = Vec::new();
    for (i, (case, file, want)) in [
        ("a .env in STATIC_DIR", ".env", "DotEntry"),
        ("a dot-file under assets", "assets/.secret", "DotEntry"),
        ("the root's .vite manifest", ".vite/manifest.json", "Ok("),
        ("a dot-file inside .vite", ".vite/.x", "DotEntry"),
        (
            "a .vite below the root",
            "sub/.vite/manifest.json",
            "DotEntry",
        ),
        ("a .vite file", ".vite", "DotEntry"),
        (".well-known", ".well-known/x", "DotEntry"),
    ]
    .into_iter()
    .enumerate()
    {
        let site = root.join(format!("site{i}"));
        let path = site.join(file);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(site.join("index.html"), "<!doctype html>").unwrap();
        std::fs::write(&path, "{}").unwrap();
        let got = match runtime.block_on(static_files::check(&site, &content)) {
            Ok(dir) => format!("Ok({})", dir.root().display()),
            Err(e) => format!("{e:?}"),
        };
        if !got.starts_with(want) {
            failures.push(format!("check, {case}: expected {want}.., got {got}"));
        }
    }
    report(&failures);
}

/// The real `server <command>` with `envs` set (each caller passes every variable `Config` reads, so none comes from
/// the caller's environment; an empty value is unset): its log until it exits (bounded at 60 s, then killed), and its
/// exit status.
fn server_log(command: &str, envs: &[(&str, &str)]) -> (Vec<String>, ExitStatus) {
    let mut child = Command::new(env!("CARGO_BIN_EXE_server"))
        .arg(command)
        .envs(envs.iter().copied())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let (lines, received) = mpsc::channel();
    forward_lines(child.stdout.take().unwrap(), lines.clone());
    forward_lines(child.stderr.take().unwrap(), lines);
    let deadline = Instant::now() + Duration::from_secs(60);
    let mut log = Vec::new();
    loop {
        match received.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
            Ok(line) => log.push(line),
            Err(RecvTimeoutError::Disconnected) => break,
            Err(RecvTimeoutError::Timeout) => {
                log.push("<no exit within 60 s: killed>".to_owned());
                child.kill().unwrap();
                break;
            }
        }
    }
    let status = child.wait().unwrap();
    (log, status)
}

/// The first line of `log` holding every one of `parts`.
fn line_with(log: &[String], parts: &[&str]) -> Option<usize> {
    log.iter()
        .position(|line| parts.iter().all(|part| line.contains(part)))
}

/// Critique O3: a production start with draft bot texts exits non-zero with the refusal, before it opens the database
/// (once the owner's VALUES step empties `drafts`, the start must not refuse on the texts). The prod configuration is
/// complete, with fake non-placeholder secrets (`Config` refuses the placeholders under prod). RULINGS 97 Q8: nothing
/// is sent on any path, under any mutation: `serve` makes no Bot API call before `listening`, `Policy::load` refuses
/// the missing `PRIVACY_OPERATOR_FILE` before the gateway is built, and the database is a closed port.
#[test]
fn prod_start_refuses_draft_bot_texts() {
    let dir = scratch_dir("prod-texts");
    let operator = dir.join("no-such-operator.json");
    let token_key = "1".repeat(64);
    let (log, status) = server_log(
        "serve",
        &[
            ("BOT_TOKEN", "1000000002:lph-fake-token-never-sent"),
            ("WEBHOOK_SECRET", "lph-prod-test-secret"),
            ("TOKEN_KEY", &token_key),
            ("TOKEN_TTL_SECS", "1800"),
            ("INITDATA_MAX_AGE_SECS", "86400"),
            ("PUBLIC_APP_URL", "https://example.invalid/"),
            ("ADMIN_TELEGRAM_IDS", ""),
            ("STATIC_DIR", ""),
            (
                "CONTENT_DIR",
                concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/content"),
            ),
            (
                "DATABASE_URL",
                "postgres://postgres@127.0.0.1:1/tgn_prod_texts",
            ),
            ("TELEGRAM_ENV", "prod"),
            ("LISTEN_ADDR", "127.0.0.1:0"),
            ("PRIVACY_OPERATOR_FILE", operator.to_str().unwrap()),
            ("RUST_LOG", "info"),
            ("NO_COLOR", "1"),
        ],
    );
    let text = log.join("\n");
    let drafts_left = [texts::BOT_RU_JSON, texts::BOT_EN_JSON]
        .iter()
        .any(|json| !texts::parse(json).unwrap().drafts.is_empty());
    let mut failures = Vec::new();
    if line_with(&log, &["invalid configuration"]).is_some() {
        failures.push(format!(
            "the test's prod configuration is incomplete, the log:\n{text}"
        ));
    }
    let refused = line_with(
        &log,
        &[
            "ERROR",
            "bot texts refused",
            "draft texts under TELEGRAM_ENV=prod",
        ],
    );
    let opening = line_with(&log, &["opening database"]);
    if drafts_left {
        if status.success() || refused.is_none() || opening.is_some() {
            failures.push(format!(
                "expected a bot-texts drafts refusal before `opening database` and a failure exit, got {status} and \
                 the log:\n{text}"
            ));
        }
    } else if line_with(&log, &["bot texts refused"]).is_some() {
        failures.push(format!(
            "no drafts left: expected no bot-texts refusal, got the log:\n{text}"
        ));
    }
    if line_with(&log, &["listening"]).is_some() {
        failures.push(format!("the prod start served, the log:\n{text}"));
    }
    report(&failures);
}

/// Critique O6: both subcommands check the bot texts right after the configuration, before anything else is opened
/// or built: `serve` logs `bot texts checked` before `opening database`, and `setup` (the placeholder token, so its
/// gateway is disabled and sends nothing) before the gateway's `bot api disabled` line.
#[test]
fn startup_checks_bot_texts_first() {
    let root = scratch_dir("startup-order");
    let site = root.join("site");
    std::fs::create_dir_all(&site).unwrap();
    std::fs::write(site.join("index.html"), "<!doctype html>").unwrap();
    let content = Path::new(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/content"
    ));
    let mut failures = Vec::new();
    let serve = serve_log(&site, content);
    let checked = line_with(&serve, &["bot texts checked"]);
    let opening = line_with(&serve, &["opening database"]);
    if !matches!((checked, opening), (Some(c), Some(o)) if c < o) {
        failures.push(format!(
            "serve: expected a `bot texts checked` line before `opening database`, got:\n{}",
            serve.join("\n")
        ));
    }
    let (setup, _) = server_log(
        "setup",
        &[
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
            ("DATABASE_URL", "postgres://postgres@127.0.0.1:1/tgn_setup"),
            ("TELEGRAM_ENV", "test"),
            ("LISTEN_ADDR", "127.0.0.1:0"),
            ("PRIVACY_OPERATOR_FILE", ""),
            ("RUST_LOG", "info"),
            ("NO_COLOR", "1"),
        ],
    );
    let checked = line_with(&setup, &["bot texts checked"]);
    let disabled = line_with(&setup, &["bot api disabled: placeholder BOT_TOKEN"]);
    if !matches!((checked, disabled), (Some(c), Some(d)) if c < d) {
        failures.push(format!(
            "setup: expected a `bot texts checked` line before the gateway's `bot api disabled` line, got:\n{}",
            setup.join("\n")
        ));
    }
    report(&failures);
}

/// One request through `app`, collected.
async fn call_app(app: &axum::Router, req: Request<Body>) -> common::Reply {
    let response = app.clone().oneshot(req).await.unwrap();
    let (parts, body) = response.into_parts();
    common::Reply {
        status: parts.status,
        headers: parts.headers,
        body: body.collect().await.unwrap().to_bytes(),
    }
}

/// The client next to the API: `/` is `index.html`, revalidated (`no-cache`); a found `/assets/*` file is cached for
/// a year (`immutable`), a missing one is 404 without that; encoded traversals are 404 and never reach the file
/// beside the directory; `/api` routes keep their own answers, an unknown `/api` path is 404 (no SPA fallback); a
/// POST to a static path is 405.
#[tokio::test]
async fn static_dir_serves_client_with_cache_headers() {
    const INDEX: &str = "<!doctype html><title>novel</title>";
    const SECRET: &str = "NOT-PUBLIC-91";
    let root = scratch_dir("static-serve");
    let site = root.join("site");
    std::fs::create_dir_all(site.join("assets")).unwrap();
    std::fs::write(site.join("index.html"), INDEX).unwrap();
    std::fs::write(site.join("assets").join("app-1a2b3c4d.js"), "export {};").unwrap();
    std::fs::write(root.join("secret.txt"), SECRET).unwrap();
    let (st, _db) = common::test_state().await;
    let dir = static_files::check(&site, &st.cfg.content_dir)
        .await
        .unwrap();
    let app = static_files::with_static(server::build_router(st.clone()), &dir);
    let mut failures = Vec::new();
    let cache = |reply: &common::Reply| {
        reply
            .headers
            .get(CACHE_CONTROL)
            .and_then(|v| v.to_str().ok())
            .map(str::to_owned)
    };
    for (method, path, status, want_cache, body) in [
        ("GET", "/", 200, Some("no-cache"), Some(INDEX)),
        (
            "GET",
            "/assets/app-1a2b3c4d.js",
            200,
            Some("public, max-age=31536000, immutable"),
            Some("export {};"),
        ),
        ("GET", "/api/health", 200, Some("no-store"), Some("ok")),
        ("POST", "/index.html", 405, None, None),
    ] {
        let req = Request::builder()
            .method(method)
            .uri(path)
            .body(Body::empty())
            .unwrap();
        let reply = call_app(&app, req).await;
        let text = String::from_utf8_lossy(&reply.body).into_owned();
        if reply.status.as_u16() != status || body.is_some_and(|want| text != want) {
            failures.push(format!(
                "{method} {path}: expected {status} {body:?}, got {} {text:?}",
                reply.status.as_u16()
            ));
        }
        if want_cache.is_some() && cache(&reply).as_deref() != want_cache {
            failures.push(format!(
                "{method} {path}: cache-control: expected {want_cache:?}, got {:?}",
                cache(&reply)
            ));
        }
    }
    for path in [
        "/assets/missing.js",
        "/%2e%2e/secret.txt",
        "/..%5csecret.txt",
        "/api/nope",
    ] {
        let reply = call_app(&app, Request::get(path).body(Body::empty()).unwrap()).await;
        let text = String::from_utf8_lossy(&reply.body).into_owned();
        if reply.status != StatusCode::NOT_FOUND || text.contains(SECRET) || text.contains(INDEX) {
            failures.push(format!(
                "GET {path}: expected 404 without the page or the file beside it, got {} {text:?}",
                reply.status.as_u16()
            ));
        }
        if cache(&reply).is_some_and(|v| v.contains("immutable")) {
            failures.push(format!("GET {path}: a 404 must not be cached as immutable"));
        }
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
