//! The schema's constraints (`server/migrations/0001_init.sql`), exercised with raw SQL on a connection of their own.
//! Every rejected case sits next to a control insert that must succeed on the same parent rows, so a red names the
//! constraint, not a missing parent or a typo.

use std::path::{Path, PathBuf};

use sqlx::PgConnection;
use sqlx::postgres::PgQueryResult;

use crate::common;

type Res = Result<PgQueryResult, sqlx::Error>;

/// `Ok` when `res` is a database error with SQLSTATE `want.0` on the constraint named `want.1`. Never the message
/// text: the server's locale decides it.
fn expect_err(case: &str, res: Res, want: (&str, &str)) -> Result<(), String> {
    let (code, constraint) = want;
    match res {
        Err(sqlx::Error::Database(e))
            if e.code().as_deref() == Some(code) && e.constraint() == Some(constraint) =>
        {
            Ok(())
        }
        Err(sqlx::Error::Database(e)) => Err(format!(
            "case {case}: expected ({code}, {constraint}), got ({}, {}) {e}",
            e.code().as_deref().unwrap_or("no code"),
            e.constraint().unwrap_or("no constraint")
        )),
        Err(e) => Err(format!(
            "case {case}: expected ({code}, {constraint}), got {e}"
        )),
        Ok(_) => Err(format!(
            "case {case}: expected ({code}, {constraint}), got Ok"
        )),
    }
}

fn expect_ok(case: &str, res: Res) -> Result<(), String> {
    res.map(|_| ())
        .map_err(|e| format!("case {case} (control): expected Ok, got {e}"))
}

fn report(failures: &[String]) {
    assert!(
        failures.is_empty(),
        "{} failures:\n{}",
        failures.len(),
        failures.join("\n")
    );
}

async fn user(c: &mut PgConnection, id: i64) -> Res {
    sqlx::query("INSERT INTO users (id, first_name, language_code, created_at, last_seen_at) VALUES ($1, 'U', NULL, 0, 0)")
        .bind(id)
        .execute(&mut *c)
        .await
}

async fn payment(
    c: &mut PgConnection,
    charge: &str,
    amount: i64,
    paid_at: i64,
    refunded_at: Option<i64>,
) -> Res {
    sqlx::query(
        "INSERT INTO payments (telegram_payment_charge_id, invoice_payload, user_id, amount, currency, \
         provider_payment_charge_id, paid_at, refunded_at) VALUES ($1, 'payload', 1, $2, 'XTR', '', $3, $4)",
    )
    .bind(charge)
    .bind(amount)
    .bind(paid_at)
    .bind(refunded_at)
    .execute(&mut *c)
    .await
}

/// An `orders` row of user 1; [`created`] is a valid starting point for every case.
struct Order<'a> {
    id: &'a str,
    status: &'a str,
    currency: &'a str,
    amount: i64,
    checkout_at: Option<i64>,
    paid_at: Option<i64>,
    charge_id: Option<&'a str>,
}

fn created(id: &str) -> Order<'_> {
    Order {
        id,
        status: "created",
        currency: "XTR",
        amount: 50,
        checkout_at: None,
        paid_at: None,
        charge_id: None,
    }
}

async fn order(c: &mut PgConnection, o: Order<'_>) -> Res {
    sqlx::query(
        "INSERT INTO orders (id, user_id, product_id, amount, currency, status, invoice_url, created_at, \
         checkout_at, paid_at, charge_id) VALUES ($1, 1, 'p1', $2, $3, $4, NULL, 0, $5, $6, $7)",
    )
    .bind(o.id)
    .bind(o.amount)
    .bind(o.currency)
    .bind(o.status)
    .bind(o.checkout_at)
    .bind(o.paid_at)
    .bind(o.charge_id)
    .execute(&mut *c)
    .await
}

async fn entitlement(c: &mut PgConnection, product: &str, charge: &str) -> Res {
    sqlx::query(
        "INSERT INTO entitlements (user_id, product_id, charge_id, granted_at) VALUES (1, $1, $2, 0)",
    )
    .bind(product)
    .bind(charge)
    .execute(&mut *c)
    .await
}

/// A `saves` row of `user` in `story`'s `slot`.
async fn save_in(c: &mut PgConnection, user: i64, story: &str, slot: &str) -> Res {
    sqlx::query(
        "INSERT INTO saves (user_id, story_id, slot, rev, chapter_id, story_version, line_id, write_id, body, \
         saved_at) VALUES ($1, $2, $3, 1, 'ch1', 'v1', NULL, 'w1', '{}', 0)",
    )
    .bind(user)
    .bind(story)
    .bind(slot)
    .execute(&mut *c)
    .await
}

/// A `saves` row of user 1 in `manor`.
async fn save(c: &mut PgConnection, slot: &str, rev: i64, body: &str) -> Res {
    sqlx::query(
        "INSERT INTO saves (user_id, story_id, slot, rev, chapter_id, story_version, line_id, write_id, body, \
         saved_at) VALUES (1, 'manor', $1, $2, 'ch1', 'v1', NULL, 'w1', $3, 0)",
    )
    .bind(slot)
    .bind(rev)
    .bind(body)
    .execute(&mut *c)
    .await
}

/// A JSON string literal of exactly `len` ASCII characters, so `len` bytes (`octet_length()` counts bytes).
fn json_string_of_len(len: usize) -> String {
    format!("\"{}\"", "a".repeat(len - 2))
}

#[tokio::test]
async fn schema_charge_id_unique() {
    let (st, _db) = common::test_state().await;
    let mut c = common::raw_db(&st).await;
    let mut failures = Vec::new();
    failures.extend(expect_ok("setup user", user(&mut c, 1).await).err());

    failures.extend(expect_ok("payment c1", payment(&mut c, "c1", 50, 100, None).await).err());
    failures.extend(expect_ok("payment c2", payment(&mut c, "c2", 50, 100, None).await).err());
    let res = payment(&mut c, "c1", 50, 100, None).await;
    failures.extend(expect_err("payments_pk", res, ("23505", "payments_pkey")).err());

    failures.extend(expect_ok("entitlement p1 c1", entitlement(&mut c, "p1", "c1").await).err());
    let res = entitlement(&mut c, "p2", "c1").await;
    failures.extend(
        expect_err(
            "entitlements_charge",
            res,
            ("23505", "entitlements_charge_key"),
        )
        .err(),
    );
    failures.extend(expect_ok("entitlement p2 c2", entitlement(&mut c, "p2", "c2").await).err());

    fn paid<'a>(id: &'a str, charge: &'a str) -> Order<'a> {
        Order {
            status: "paid",
            checkout_at: Some(10),
            paid_at: Some(100),
            charge_id: Some(charge),
            ..created(id)
        }
    }
    failures.extend(expect_ok("order o1 c1", order(&mut c, paid("o1", "c1")).await).err());
    let res = order(&mut c, paid("o2", "c1")).await;
    failures.extend(expect_err("orders_charge", res, ("23505", "orders_charge_key")).err());
    failures.extend(expect_ok("order o2 c2", order(&mut c, paid("o2", "c2")).await).err());

    report(&failures);
}

#[tokio::test]
async fn schema_order_status_check() {
    let (st, _db) = common::test_state().await;
    let mut c = common::raw_db(&st).await;
    let mut failures = Vec::new();
    failures.extend(expect_ok("setup user", user(&mut c, 1).await).err());

    failures.extend(expect_ok("created XTR", order(&mut c, created("o1")).await).err());
    let checkout = Order {
        status: "checkout",
        checkout_at: Some(10),
        ..created("o2")
    };
    failures.extend(expect_ok("checkout with checkout_at", order(&mut c, checkout).await).err());

    let cases = [
        (
            "status bogus",
            Order {
                status: "bogus",
                ..created("o3")
            },
            "orders_status_known",
        ),
        (
            "checkout without checkout_at",
            Order {
                status: "checkout",
                ..created("o4")
            },
            "orders_checkout_has_time",
        ),
        (
            "currency USD",
            Order {
                currency: "USD",
                ..created("o5")
            },
            "orders_currency_xtr",
        ),
        (
            "amount 0",
            Order {
                amount: 0,
                ..created("o6")
            },
            "orders_amount_positive",
        ),
    ];
    for (case, o, constraint) in cases {
        let res = order(&mut c, o).await;
        failures.extend(expect_err(case, res, ("23514", constraint)).err());
    }

    report(&failures);
}

#[tokio::test]
async fn schema_paid_requires_charge() {
    let (st, _db) = common::test_state().await;
    let mut c = common::raw_db(&st).await;
    let mut failures = Vec::new();
    failures.extend(expect_ok("setup user", user(&mut c, 1).await).err());
    for charge in ["c1", "c2", "c3"] {
        failures.extend(expect_ok(charge, payment(&mut c, charge, 50, 100, None).await).err());
    }

    let paid = Order {
        status: "paid",
        paid_at: Some(100),
        charge_id: Some("c1"),
        ..created("o1")
    };
    failures.extend(expect_ok("paid with charge and paid_at", order(&mut c, paid).await).err());
    let cases = [
        (
            "paid without charge",
            Order {
                status: "paid",
                paid_at: Some(100),
                ..created("o2")
            },
        ),
        (
            "paid without paid_at",
            Order {
                status: "paid",
                charge_id: Some("c2"),
                ..created("o3")
            },
        ),
        (
            "refunded without charge",
            Order {
                status: "refunded",
                paid_at: Some(100),
                ..created("o4")
            },
        ),
        (
            "refunded without paid_at",
            Order {
                status: "refunded",
                charge_id: Some("c3"),
                ..created("o5")
            },
        ),
    ];
    for (case, o) in cases {
        let res = order(&mut c, o).await;
        failures.extend(expect_err(case, res, ("23514", "orders_paid_has_charge")).err());
    }

    failures.extend(
        expect_ok(
            "refunded_at = paid_at",
            payment(&mut c, "c4", 50, 100, Some(100)).await,
        )
        .err(),
    );
    let res = payment(&mut c, "c5", 0, 100, None).await;
    failures.extend(
        expect_err(
            "payment amount 0",
            res,
            ("23514", "payments_amount_positive"),
        )
        .err(),
    );
    let res = payment(&mut c, "c6", 50, 100, Some(99)).await;
    failures.extend(
        expect_err(
            "refunded_at before paid_at",
            res,
            ("23514", "payments_refunded_after_paid"),
        )
        .err(),
    );

    report(&failures);
}

#[tokio::test]
async fn schema_save_body_json_valid() {
    let (st, _db) = common::test_state().await;
    let mut c = common::raw_db(&st).await;
    let mut failures = Vec::new();
    failures.extend(expect_ok("setup user", user(&mut c, 1).await).err());

    failures.extend(expect_ok("body {}", save(&mut c, "auto", 1, "{}").await).err());
    let at_limit = json_string_of_len(262_144);
    failures.extend(
        expect_ok(
            "body of 262144 bytes",
            save(&mut c, "s1", 1, &at_limit).await,
        )
        .err(),
    );

    let over_limit = json_string_of_len(262_145);
    let cases = [
        ("body not json", "s2", 1, "not json", "saves_body_json"),
        (
            "body of 262145 bytes",
            "s3",
            1,
            over_limit.as_str(),
            "saves_body_size",
        ),
        ("slot x", "x", 1, "{}", "saves_slot_known"),
        ("rev 0", "s2", 0, "{}", "saves_rev_positive"),
    ];
    for (case, slot, rev, body, constraint) in cases {
        let res = save(&mut c, slot, rev, body).await;
        failures.extend(expect_err(case, res, ("23514", constraint)).err());
    }

    report(&failures);
}

/// `saves_story_id_shape` is `StoryId::parse`'s grammar `^[a-z][a-z0-9_]{0,23}$` (the cases of `story_id_grammar`
/// plus an upper-case tail and a trailing newline): ASCII ranges by code point, `$` only at the end of the text.
#[tokio::test]
async fn schema_saves_story_id_shape() {
    let (st, _db) = common::test_state().await;
    let mut c = common::raw_db(&st).await;
    let mut failures = Vec::new();
    failures.extend(expect_ok("setup user", user(&mut c, 1).await).err());

    let longest = format!("a{}", "b".repeat(23));
    let too_long = format!("a{}", "b".repeat(24));
    for story in ["manor", "a", "a_1", "a9", longest.as_str()] {
        let res = save_in(&mut c, 1, story, "auto").await;
        failures.extend(expect_ok(&format!("story {story:?}"), res).err());
    }
    for story in [
        "Manor",
        "aB",
        "",
        "1a",
        "_a",
        "a-b",
        "a.b",
        "a b",
        too_long.as_str(),
        "\u{e9}",
        "a\u{e9}",
        "manor\n",
    ] {
        let res = save_in(&mut c, 1, story, "auto").await;
        failures.extend(
            expect_err(
                &format!("story {story:?}"),
                res,
                ("23514", "saves_story_id_shape"),
            )
            .err(),
        );
    }

    report(&failures);
}

/// The key is (user, story, slot): one slot name in two stories is two rows, the same (user, story, slot) twice is
/// refused, and another user's same (story, slot) is a row of its own.
#[tokio::test]
async fn schema_saves_pk_per_story() {
    let (st, _db) = common::test_state().await;
    let mut c = common::raw_db(&st).await;
    let mut failures = Vec::new();
    failures.extend(expect_ok("setup user 1", user(&mut c, 1).await).err());
    failures.extend(expect_ok("setup user 2", user(&mut c, 2).await).err());

    let res = save_in(&mut c, 1, "manor", "auto").await;
    failures.extend(expect_ok("user 1 manor/auto", res).err());
    let res = save_in(&mut c, 1, "tide", "auto").await;
    failures.extend(expect_ok("user 1 tide/auto", res).err());
    let res = save_in(&mut c, 1, "manor", "auto").await;
    failures.extend(expect_err("user 1 manor/auto again", res, ("23505", "saves_pkey")).err());
    let res = save_in(&mut c, 2, "manor", "auto").await;
    failures.extend(expect_ok("user 2 manor/auto", res).err());

    report(&failures);
}

/// sqlx calls that take SQL text.
const SQL_CALLS: [&str; 8] = [
    "query",
    "query_as",
    "query_scalar",
    "query_with",
    "query_as_with",
    "query_scalar_with",
    "raw_sql",
    "execute",
];

/// sqlx 0.9 runs only `SqlSafeStr` SQL (`&'static str` or `AssertSqlSafe`). Text built at run time gets in by
/// wrapping it in `AssertSqlSafe`, pushing it into a `QueryBuilder` (`push` does not sanitize), or leaking a
/// `String` / `Box` into a `&'static str` (`leak`): each is banned outright in `server/src`, and bind parameters need
/// none of them. Not caught by name: a `String` kept in a `static` (`LazyLock` / `OnceLock`) also derefs to a
/// `&'static str`; only the `format!` rule sees it, and only when the `format!` is within two lines of the call.
const ESCAPE_HATCHES: [&str; 3] = ["AssertSqlSafe", "QueryBuilder", "leak"];

fn identifiers(line: &str) -> impl Iterator<Item = &str> {
    line.split(|c: char| !(c.is_ascii_alphanumeric() || c == '_'))
        .filter(|t| !t.is_empty())
}

#[allow(
    clippy::disallowed_methods,
    reason = "a sync test may read files; the lint guards async handlers"
)]
fn rust_files(dir: &Path, files: &mut Vec<(PathBuf, String)>, problems: &mut Vec<String>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        problems.push(format!("cannot read {}", dir.display()));
        return;
    };
    for entry in entries {
        let path = match entry {
            Ok(entry) => entry.path(),
            Err(e) => {
                problems.push(format!("cannot list {}: {e}", dir.display()));
                continue;
            }
        };
        if path.is_dir() {
            rust_files(&path, files, problems);
        } else if path.extension().is_some_and(|ext| ext == "rs") {
            match std::fs::read_to_string(&path) {
                Ok(text) => files.push((path, text)),
                Err(e) => problems.push(format!("cannot read {}: {e}", path.display())),
            }
        }
    }
}

/// SQL is never built from strings in `server/src`: no escape hatch around sqlx's `SqlSafeStr`, and no `format!`
/// within two lines of an sqlx call (the intent caught early). Comment lines are skipped, so a why-comment may name
/// a banned item.
#[test]
fn no_dynamic_sql() {
    let root = Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/src"));
    let mut files = Vec::new();
    let mut violations = Vec::new();
    rust_files(root, &mut files, &mut violations);

    let scanned: Vec<String> = files
        .iter()
        .map(|(path, _)| {
            let rel = path.strip_prefix(root).unwrap_or(path);
            rel.to_string_lossy().replace('\\', "/")
        })
        .collect();
    if !(scanned.iter().any(|p| p == "lib.rs") && scanned.iter().any(|p| p == "db/mod.rs")) {
        violations.push(format!("scan root wrong: {}", root.display()));
    }

    for (rel, (_, text)) in scanned.iter().zip(&files) {
        let code: Vec<&str> = text
            .lines()
            .map(|line| {
                if line.trim_start().starts_with("//") {
                    ""
                } else {
                    line
                }
            })
            .collect();
        let calls_sql: Vec<bool> = code
            .iter()
            .map(|line| identifiers(line).any(|id| SQL_CALLS.contains(&id)))
            .collect();
        for (i, line) in code.iter().enumerate() {
            for id in identifiers(line).filter(|id| ESCAPE_HATCHES.contains(id)) {
                violations.push(format!("src/{rel}:{}: {id}", i + 1));
            }
            let near = i.saturating_sub(2)..(i + 3).min(code.len());
            if line.contains("format!") && calls_sql[near].iter().any(|&c| c) {
                violations.push(format!("src/{rel}:{}: format! next to query", i + 1));
            }
        }
    }

    assert!(
        violations.is_empty(),
        "{} dynamic SQL violations:\n{}",
        violations.len(),
        violations.join("\n")
    );
}

/// The app pool's sessions run on the pinned settings, on a test database whose own defaults are hostile
/// (`synchronous_commit = off`, `default_transaction_isolation = 'repeatable read'`): each pinned value differs from
/// the database's effective default, so dropping any pin reds its line here.
#[tokio::test]
async fn pool_session_settings() {
    let (st, _db) = common::test_state().await;
    let got = st.repo.session_settings().await.unwrap();
    let mut failures = Vec::new();
    for (setting, want, value) in [
        ("synchronous_commit", "on", got.synchronous_commit.as_str()),
        (
            "default_transaction_isolation",
            "read committed",
            got.default_transaction_isolation.as_str(),
        ),
        (
            "transaction_isolation",
            "read committed",
            got.transaction_isolation.as_str(),
        ),
        ("lock_timeout", "2s", got.lock_timeout.as_str()),
        ("statement_timeout", "15s", got.statement_timeout.as_str()),
        (
            "idle_in_transaction_session_timeout",
            "30s",
            got.idle_in_transaction_session_timeout.as_str(),
        ),
        (
            "application_name",
            "tg-novel-server",
            got.application_name.as_str(),
        ),
    ] {
        if value != want {
            failures.push(format!("{setting}: expected {want}, got {value}"));
        }
    }
    if got.server_version_num / 10_000 != 18 {
        failures.push(format!(
            "server_version_num: expected major 18, got {}",
            got.server_version_num
        ));
    }
    report(&failures);
}
