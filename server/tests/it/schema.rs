//! The schema's constraints (`server/migrations/0001_init.sql`), exercised with raw SQL on a connection of their own.
//! Every rejected case sits next to a control insert that must succeed on the same parent rows, so a red names the
//! constraint, not a missing parent or a typo.

use std::path::{Path, PathBuf};

use sqlx::sqlite::{SqliteConnection, SqliteQueryResult};

use crate::common;

type Res = Result<SqliteQueryResult, sqlx::Error>;

/// `Ok` when `res` is a database error whose message contains `needle`.
fn expect_err(case: &str, res: Res, needle: &str) -> Result<(), String> {
    match res {
        Err(sqlx::Error::Database(e)) if e.message().contains(needle) => Ok(()),
        Err(e) => Err(format!(
            "case {case}: expected an error containing {needle:?}, got {e}"
        )),
        Ok(_) => Err(format!("case {case}: expected {needle:?}, got Ok")),
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

async fn user(c: &mut SqliteConnection, id: i64) -> Res {
    sqlx::query("INSERT INTO users (id, first_name, language_code, created_at, last_seen_at) VALUES (?, 'U', NULL, 0, 0)")
        .bind(id)
        .execute(&mut *c)
        .await
}

async fn payment(
    c: &mut SqliteConnection,
    charge: &str,
    amount: i64,
    paid_at: i64,
    refunded_at: Option<i64>,
) -> Res {
    sqlx::query(
        "INSERT INTO payments (telegram_payment_charge_id, invoice_payload, user_id, amount, currency, \
         provider_payment_charge_id, paid_at, refunded_at) VALUES (?, 'payload', 1, ?, 'XTR', '', ?, ?)",
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

async fn order(c: &mut SqliteConnection, o: Order<'_>) -> Res {
    sqlx::query(
        "INSERT INTO orders (id, user_id, product_id, amount, currency, status, invoice_url, created_at, \
         checkout_at, paid_at, charge_id) VALUES (?, 1, 'p1', ?, ?, ?, NULL, 0, ?, ?, ?)",
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

async fn entitlement(c: &mut SqliteConnection, product: &str, charge: &str) -> Res {
    sqlx::query(
        "INSERT INTO entitlements (user_id, product_id, charge_id, granted_at) VALUES (1, ?, ?, 0)",
    )
    .bind(product)
    .bind(charge)
    .execute(&mut *c)
    .await
}

async fn save(c: &mut SqliteConnection, slot: &str, rev: i64, body: &str) -> Res {
    sqlx::query(
        "INSERT INTO saves (user_id, slot, rev, chapter_id, story_version, line_id, write_id, body, saved_at) \
         VALUES (1, ?, ?, 'ch1', 'v1', NULL, 'w1', ?, 0)",
    )
    .bind(slot)
    .bind(rev)
    .bind(body)
    .execute(&mut *c)
    .await
}

/// A JSON string literal of exactly `len` ASCII characters (SQLite's `length()` counts characters).
fn json_string_of_len(len: usize) -> String {
    format!("\"{}\"", "a".repeat(len - 2))
}

#[tokio::test]
async fn schema_charge_id_unique() {
    let (st, _dir) = common::test_state().await;
    let mut c = common::raw_db(&st).await;
    let mut failures = Vec::new();
    failures.extend(expect_ok("setup user", user(&mut c, 1).await).err());

    failures.extend(expect_ok("payment c1", payment(&mut c, "c1", 50, 100, None).await).err());
    failures.extend(expect_ok("payment c2", payment(&mut c, "c2", 50, 100, None).await).err());
    let res = payment(&mut c, "c1", 50, 100, None).await;
    failures.extend(
        expect_err(
            "payments_pk",
            res,
            "UNIQUE constraint failed: payments.telegram_payment_charge_id",
        )
        .err(),
    );

    failures.extend(expect_ok("entitlement p1 c1", entitlement(&mut c, "p1", "c1").await).err());
    let res = entitlement(&mut c, "p2", "c1").await;
    failures.extend(
        expect_err(
            "entitlements_charge",
            res,
            "UNIQUE constraint failed: entitlements.charge_id",
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
    failures.extend(
        expect_err(
            "orders_charge",
            res,
            "UNIQUE constraint failed: orders.charge_id",
        )
        .err(),
    );
    failures.extend(expect_ok("order o2 c2", order(&mut c, paid("o2", "c2")).await).err());

    report(&failures);
}

#[tokio::test]
async fn schema_order_status_check() {
    let (st, _dir) = common::test_state().await;
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
        ),
        (
            "checkout without checkout_at",
            Order {
                status: "checkout",
                ..created("o4")
            },
        ),
        (
            "currency USD",
            Order {
                currency: "USD",
                ..created("o5")
            },
        ),
        (
            "amount 0",
            Order {
                amount: 0,
                ..created("o6")
            },
        ),
    ];
    for (case, o) in cases {
        let res = order(&mut c, o).await;
        failures.extend(expect_err(case, res, "CHECK constraint failed").err());
    }

    report(&failures);
}

#[tokio::test]
async fn schema_paid_requires_charge() {
    let (st, _dir) = common::test_state().await;
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
        failures.extend(expect_err(case, res, "CHECK constraint failed").err());
    }

    failures.extend(
        expect_ok(
            "refunded_at = paid_at",
            payment(&mut c, "c4", 50, 100, Some(100)).await,
        )
        .err(),
    );
    let res = payment(&mut c, "c5", 0, 100, None).await;
    failures.extend(expect_err("payment amount 0", res, "CHECK constraint failed").err());
    let res = payment(&mut c, "c6", 50, 100, Some(99)).await;
    failures.extend(expect_err("refunded_at before paid_at", res, "CHECK constraint failed").err());

    report(&failures);
}

#[tokio::test]
async fn schema_save_body_json_valid() {
    let (st, _dir) = common::test_state().await;
    let mut c = common::raw_db(&st).await;
    let mut failures = Vec::new();
    failures.extend(expect_ok("setup user", user(&mut c, 1).await).err());

    failures.extend(expect_ok("body {}", save(&mut c, "auto", 1, "{}").await).err());
    let at_limit = json_string_of_len(262_144);
    failures.extend(
        expect_ok(
            "body of 262144 characters",
            save(&mut c, "s1", 1, &at_limit).await,
        )
        .err(),
    );

    let over_limit = json_string_of_len(262_145);
    let cases = [
        ("body not json", "s2", 1, "not json"),
        ("body of 262145 characters", "s3", 1, over_limit.as_str()),
        ("slot x", "x", 1, "{}"),
        ("rev 0", "s2", 0, "{}"),
    ];
    for (case, slot, rev, body) in cases {
        let res = save(&mut c, slot, rev, body).await;
        failures.extend(expect_err(case, res, "CHECK constraint failed").err());
    }

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

/// sqlx 0.9 runs only `SqlSafeStr` SQL, and the ways to hand it text built at run time are exactly these: wrapping
/// it in `AssertSqlSafe`, pushing it into a `QueryBuilder` (`push` does not sanitize), or leaking a `String` / `Box`
/// into a `&'static str` (`leak`). Each is banned outright in `server/src`; bind parameters need none of them.
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
