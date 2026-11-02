//! The privacy policy's operator facts (LPO, META-PLAN M26): `AppState::new` substitutes the host file that
//! `PRIVACY_OPERATOR_FILE` names into the compiled template, refuses a bad file, and under prod refuses to start while
//! any placeholder is left; `GET /api/privacy` serves the substituted page.

use std::collections::BTreeSet;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use axum::body::Body;
use axum::http::header::{CACHE_CONTROL, CONTENT_SECURITY_POLICY, CONTENT_TYPE};
use axum::http::{Request, StatusCode};
use serde_json::{Map, Value, json};
use server::api::legal::PolicyError;
use server::config::{Config, TelegramEnv};
use server::{AppState, StartupError};
use sqlx::{Connection, PgConnection};

use crate::common::{self, Reply, TestDb};

/// The template as this test reads it, compiled in independently of `api/legal.rs`.
const TEMPLATE: &str = include_str!("../../legal/privacy-policy.html");

/// The identity placeholders (META-PLAN M26), written out here rather than read from the server: a test iterating
/// the server's own list would follow a key moved between the lists.
const IDENTITY: [&str; 10] = [
    "OPERATOR_NAME",
    "OPERATOR_FORM",
    "OGRN",
    "INN",
    "OPERATOR_ADDRESS",
    "PRIVACY_CONTACT_EMAIL",
    "RESPONSIBLE_PERSON",
    "DPO_CONTACT",
    "EU_REPRESENTATIVE",
    "POLICY_URL",
];

/// The content placeholders (META-PLAN M26), written out here for the same reason.
const CONTENT: [&str; 6] = [
    "RETENTION_PERIOD",
    "MIN_AGE",
    "DB_LOCATION_COUNTRY",
    "HOSTING_PROVIDER",
    "CROSS_BORDER_TRANSFER",
    "SUPERVISORY_AUTHORITY",
];

/// A plainly fake value for every identity key (no real operator data, ever). `OPERATOR_NAME` carries all five
/// characters the substitution escapes.
const FACTS: [(&str, &str); 10] = [
    ("OPERATOR_NAME", r#"Test Operator <&> "q" 'a'"#),
    ("OPERATOR_FORM", "test-operator-form"),
    ("OGRN", "test-ogrn"),
    ("INN", "test-inn"),
    ("OPERATOR_ADDRESS", "test-address"),
    ("PRIVACY_CONTACT_EMAIL", "privacy@example.invalid"),
    ("RESPONSIBLE_PERSON", "test-responsible-person"),
    ("DPO_CONTACT", "test-dpo-contact"),
    ("EU_REPRESENTATIVE", "test-eu-representative"),
    ("POLICY_URL", "https://example.invalid/api/privacy"),
];

/// `OPERATOR_NAME`'s value as the page must show it, escaped by hand.
const OPERATOR_NAME_ESCAPED: &str = "Test Operator &lt;&amp;&gt; &quot;q&quot; &#39;a&#39;";

fn report(failures: &[String]) {
    assert!(
        failures.is_empty(),
        "{} failures:\n{}",
        failures.len(),
        failures.join("\n")
    );
}

/// The template's `<meta name="policy-version">` content, parsed here, not by the server.
fn template_version() -> &'static str {
    TEMPLATE
        .split_once(r#"<meta name="policy-version" content=""#)
        .and_then(|(_, rest)| rest.split_once('"'))
        .map_or("<no policy-version meta>", |(version, _)| version)
}

/// What `GET /api/privacy` serves without a host file: the template with `{POLICY_VERSION}` filled from its meta,
/// every other placeholder visible.
fn served_draft() -> String {
    TEMPLATE.replace("{POLICY_VERSION}", template_version())
}

/// A host file under `CARGO_TARGET_TMPDIR`, unique per call, removed on drop.
struct HostFile {
    path: PathBuf,
}

/// Host files named by this test process: the counter keeps two names of one nanosecond apart.
static HOST_FILES: AtomicU32 = AtomicU32::new(0);

impl HostFile {
    fn new() -> HostFile {
        let dir = Path::new(env!("CARGO_TARGET_TMPDIR"));
        std::fs::create_dir_all(dir).unwrap();
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let n = HOST_FILES.fetch_add(1, Ordering::Relaxed);
        HostFile {
            path: dir.join(format!(
                "lpo-operator-{}-{nanos}-{n}.json",
                std::process::id()
            )),
        }
    }

    /// A host file holding `value` as JSON.
    fn json(value: &Value) -> HostFile {
        HostFile::raw(&serde_json::to_vec_pretty(value).unwrap())
    }

    /// A host file holding `bytes`.
    fn raw(bytes: &[u8]) -> HostFile {
        let file = HostFile::new();
        std::fs::write(&file.path, bytes).unwrap();
        file
    }

    /// A path that is never written.
    fn absent() -> HostFile {
        HostFile::new()
    }
}

impl Drop for HostFile {
    fn drop(&mut self) {
        // Best effort: a leftover file under target/ is harmless, fake and names its process.
        std::fs::remove_file(&self.path).ok();
    }
}

/// Every identity key with its fake value.
fn identity_facts() -> Map<String, Value> {
    FACTS
        .iter()
        .map(|(key, value)| ((*key).to_owned(), Value::from(*value)))
        .collect()
}

/// [`identity_facts`] with `key` set to `value`.
fn facts_with(key: &str, value: Value) -> Value {
    let mut facts = identity_facts();
    facts.insert(key.to_owned(), value);
    Value::Object(facts)
}

/// The test configuration on `db` under `env`, with `file` as `PRIVACY_OPERATOR_FILE`.
fn config(db: &TestDb, env: TelegramEnv, file: Option<&HostFile>) -> Config {
    Config {
        telegram_env: env,
        privacy_operator_file: file.map(|f| f.path.clone()),
        ..common::test_config(db)
    }
}

/// `AppState::new` on `db` under `env`, with `file` as `PRIVACY_OPERATOR_FILE`.
async fn start(
    db: &TestDb,
    env: TelegramEnv,
    file: Option<&HostFile>,
) -> Result<AppState, StartupError> {
    AppState::new(config(db, env, file)).await
}

/// The privacy error a start was refused with, or the failure line when it started or failed otherwise.
fn privacy_error(
    case: &str,
    started: Result<AppState, StartupError>,
) -> Result<PolicyError, String> {
    match started {
        Ok(_) => Err(format!("{case}: expected a privacy error, got Ok(state)")),
        Err(StartupError::Privacy(e)) => Ok(e),
        Err(e) => Err(format!("{case}: expected a privacy error, got {e}")),
    }
}

/// The migrations table of `db`, if any, read on a connection of its own: a refused start leaves none.
async fn migrations_table(db: &TestDb) -> Option<String> {
    let mut conn = PgConnection::connect(&db.url()).await.unwrap();
    let found: Option<String> = sqlx::query_scalar("SELECT to_regclass('_sqlx_migrations')::text")
        .fetch_one(&mut conn)
        .await
        .unwrap();
    conn.close().await.unwrap();
    found
}

/// `GET /api/privacy` without a token.
async fn get_privacy(st: &AppState) -> Reply {
    common::call(
        st,
        Request::get("/api/privacy").body(Body::empty()).unwrap(),
    )
    .await
}

/// The status and LF1's three headers of a policy reply, as failure lines: LPO changes the body only.
fn page_failures(reply: &Reply) -> Vec<String> {
    let mut failures = Vec::new();
    if reply.status != StatusCode::OK {
        failures.push(format!(
            "status: expected 200, got {}",
            reply.status.as_u16()
        ));
    }
    for (name, want) in [
        (CONTENT_TYPE, "text/html; charset=utf-8"),
        (CACHE_CONTROL, "public, max-age=300"),
        (
            CONTENT_SECURITY_POLICY,
            "default-src 'none'; style-src 'unsafe-inline'",
        ),
    ] {
        let got = reply
            .headers
            .get(&name)
            .map(|v| v.to_str().unwrap_or("<not text>"));
        if got != Some(want) {
            failures.push(format!("{name}: expected {want:?}, got {got:?}"));
        }
    }
    failures
}

/// Under prod a placeholder left after the substitution refuses the start before any pool: an identity key that is
/// missing, blank, or whose value is itself a placeholder (the guard reads the page, not the facts), and the content
/// keys the template still holds. No migration runs, and a database that does not exist is never reached.
#[tokio::test]
async fn privacy_placeholder_refuses_prod_start() {
    let mut failures = Vec::new();
    let db = TestDb::create().await;

    // (a) OPERATOR_NAME left: absent, empty, whitespace only (a blank value fills nothing), or "{OPERATOR_NAME}".
    let mut without_name = identity_facts();
    without_name.remove("OPERATOR_NAME");
    let without_name = Value::Object(without_name);
    let cases = [
        ("all identity keys but OPERATOR_NAME", without_name.clone()),
        (
            "OPERATOR_NAME empty",
            facts_with("OPERATOR_NAME", json!("")),
        ),
        (
            "OPERATOR_NAME whitespace only",
            facts_with("OPERATOR_NAME", json!(" \t ")),
        ),
        (
            "OPERATOR_NAME itself a placeholder",
            facts_with("OPERATOR_NAME", json!("{OPERATOR_NAME}")),
        ),
    ];
    for (case, facts) in cases {
        let file = HostFile::json(&facts);
        match privacy_error(case, start(&db, TelegramEnv::Prod, Some(&file)).await) {
            Ok(e) => {
                let shown = e.to_string();
                match e {
                    PolicyError::Unfilled(keys) => {
                        let identity_left: Vec<&str> = keys
                            .iter()
                            .map(String::as_str)
                            .filter(|k| IDENTITY.contains(k))
                            .collect();
                        if identity_left != ["OPERATOR_NAME"] {
                            failures.push(format!(
                                "{case}: expected OPERATOR_NAME as the only identity key left, got {keys:?}"
                            ));
                        }
                        if !shown.contains("{OPERATOR_NAME}") {
                            failures.push(format!(
                                "{case}: expected the error to show {{OPERATOR_NAME}}, got {shown:?}"
                            ));
                        }
                    }
                    other => failures.push(format!("{case}: expected Unfilled, got {other:?}")),
                }
            }
            Err(line) => failures.push(line),
        }
        if let Some(table) = migrations_table(&db).await {
            failures.push(format!(
                "{case}: expected no migration on a refused start, got table {table}"
            ));
        }
    }

    // (b) Every identity key given: the content keys the template still holds are left (all six today, until the
    // owner's template commit fills them), so a prod start refuses; with none left it would start.
    let file = HostFile::json(&Value::Object(identity_facts()));
    let content_left: BTreeSet<&str> = CONTENT
        .iter()
        .copied()
        .filter(|k| TEMPLATE.contains(&format!("{{{k}}}")))
        .collect();
    let started = start(&db, TelegramEnv::Prod, Some(&file)).await;
    if content_left.is_empty() {
        if let Err(e) = started {
            failures.push(format!(
                "all identity keys, no content key left: expected Ok(state), got {e}"
            ));
        }
    } else {
        match privacy_error("all identity keys", started) {
            Ok(PolicyError::Unfilled(keys)) => {
                let left: BTreeSet<&str> = keys.iter().map(String::as_str).collect();
                if left != content_left {
                    failures.push(format!(
                        "all identity keys: expected Unfilled {content_left:?}, got {keys:?}"
                    ));
                }
            }
            Ok(other) => failures.push(format!(
                "all identity keys: expected Unfilled, got {other:?}"
            )),
            Err(line) => failures.push(line),
        }
        if let Some(table) = migrations_table(&db).await {
            failures.push(format!(
                "all identity keys: expected no migration on a refused start, got table {table}"
            ));
        }
    }

    // (c) The refusal comes before the pool: a database that no longer exists is never reached.
    let gone = TestDb::create().await;
    let file = HostFile::json(&without_name);
    let cfg = config(&gone, TelegramEnv::Prod, Some(&file));
    drop(gone);
    match privacy_error("a dropped database", AppState::new(cfg).await) {
        Ok(PolicyError::Unfilled(_)) => {}
        Ok(other) => failures.push(format!(
            "a dropped database: expected Unfilled, got {other:?}"
        )),
        Err(line) => failures.push(line),
    }
    report(&failures);
}

/// A content key or `POLICY_VERSION` in the host file refuses the start in any environment, whether or not the
/// template still holds it: only a template commit fills those.
#[tokio::test]
async fn privacy_operator_content_key_refused() {
    let mut failures = Vec::new();
    let db = TestDb::create().await;
    for key in CONTENT.into_iter().chain(["POLICY_VERSION"]) {
        let file = HostFile::json(&facts_with(key, json!("test-content")));
        match privacy_error(key, start(&db, TelegramEnv::Test, Some(&file)).await) {
            Ok(PolicyError::ContentKey(k)) if k == key => {}
            Ok(other) => failures.push(format!(
                "{key}: expected ContentKey({key:?}), got {other:?}"
            )),
            Err(line) => failures.push(line),
        }
    }
    report(&failures);
}

/// Every identity key given: the page is the template with each identity placeholder replaced by its HTML-escaped
/// value and `{POLICY_VERSION}` by the meta, under LF1's headers.
#[tokio::test]
async fn privacy_operator_file_fills_placeholders() {
    let db = TestDb::create().await;
    let file = HostFile::json(&Value::Object(identity_facts()));
    let st = match start(&db, TelegramEnv::Test, Some(&file)).await {
        Ok(st) => st,
        Err(e) => panic!("all identity keys in test: expected Ok(state), got {e}"),
    };
    let reply = get_privacy(&st).await;
    let mut failures = page_failures(&reply);

    let version = template_version();
    let mut want = TEMPLATE.replace("{POLICY_VERSION}", version);
    for (key, value) in FACTS {
        let shown = if key == "OPERATOR_NAME" {
            OPERATOR_NAME_ESCAPED
        } else {
            value
        };
        want = want.replace(&format!("{{{key}}}"), shown);
    }
    let body = String::from_utf8_lossy(&reply.body);
    if body != want {
        failures.push(format!(
            "body: expected the template with the facts escaped and the version filled ({} bytes), got {} bytes",
            want.len(),
            reply.body.len()
        ));
    }
    for key in IDENTITY {
        if body.contains(&format!("{{{key}}}")) {
            failures.push(format!("{{{key}}}: expected filled, still in the page"));
        }
    }
    if body.contains("<&>") {
        failures.push("the page holds the raw `<&>` of OPERATOR_NAME: not escaped".to_owned());
    }
    for line in [
        format!("Версия и дата вступления в силу: {version}."),
        format!("Version and effective date: {version}."),
    ] {
        if !body.contains(&line) {
            failures.push(format!("section 0: expected {line:?}"));
        }
    }
    report(&failures);
}

/// A key that is no identity placeholder, a value that is not a string, a file that is not a JSON object, and a file
/// that cannot be read: each refuses the start.
#[tokio::test]
async fn privacy_operator_unknown_key_refused() {
    let mut failures = Vec::new();
    let db = TestDb::create().await;
    type Expected = fn(&PolicyError) -> bool;
    let cases: [(&str, HostFile, &str, Expected); 6] = [
        (
            "all identity keys plus FAX_NUMBER",
            HostFile::json(&facts_with("FAX_NUMBER", json!("test-fax"))),
            "UnknownKey(\"FAX_NUMBER\")",
            |e| matches!(e, PolicyError::UnknownKey(k) if k == "FAX_NUMBER"),
        ),
        (
            "all identity keys plus operator_name",
            HostFile::json(&facts_with("operator_name", json!("test-operator"))),
            "UnknownKey(\"operator_name\")",
            |e| matches!(e, PolicyError::UnknownKey(k) if k == "operator_name"),
        ),
        (
            "INN a number",
            HostFile::json(&json!({ "INN": 7 })),
            "NotAString(\"INN\")",
            |e| matches!(e, PolicyError::NotAString(k) if k == "INN"),
        ),
        ("a JSON array", HostFile::raw(b"[]"), "NotAnObject", |e| {
            matches!(e, PolicyError::NotAnObject)
        }),
        ("not JSON", HostFile::raw(b"not json"), "NotAnObject", |e| {
            matches!(e, PolicyError::NotAnObject)
        }),
        (
            "an absent file",
            HostFile::absent(),
            "Read(NotFound)",
            |e| matches!(e, PolicyError::Read(io) if io.kind() == ErrorKind::NotFound),
        ),
    ];
    for (case, file, want, expected) in cases {
        match privacy_error(case, start(&db, TelegramEnv::Test, Some(&file)).await) {
            Ok(e) if expected(&e) => {}
            Ok(e) => failures.push(format!("{case}: expected {want}, got {e:?}")),
            Err(line) => failures.push(line),
        }
    }
    report(&failures);
}

/// The test environment without a host file serves the draft: every identity and content placeholder visible,
/// `{POLICY_VERSION}` filled from the meta, under LF1's headers.
#[tokio::test]
async fn privacy_draft_served_without_file_in_test() {
    let db = TestDb::create().await;
    let st = match start(&db, TelegramEnv::Test, None).await {
        Ok(st) => st,
        Err(e) => panic!("no host file in test: expected Ok(state), got {e}"),
    };
    let reply = get_privacy(&st).await;
    let mut failures = page_failures(&reply);
    let draft = served_draft();
    if reply.body.as_ref() != draft.as_bytes() {
        failures.push(format!(
            "body: expected the draft policy's {} bytes, got {} bytes",
            draft.len(),
            reply.body.len()
        ));
    }
    let body = String::from_utf8_lossy(&reply.body);
    for key in IDENTITY.into_iter().chain(CONTENT) {
        if !body.contains(&format!("{{{key}}}")) {
            failures.push(format!("{{{key}}}: expected visible in the draft, absent"));
        }
    }
    if body.contains("{POLICY_VERSION}") {
        failures
            .push("{POLICY_VERSION}: expected filled from the meta, still in the page".to_owned());
    }
    report(&failures);
}
