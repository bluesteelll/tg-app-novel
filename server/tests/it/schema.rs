//! The schema's constraints (`server/migrations/0001_init.sql`), exercised with raw SQL on a connection of their own.
//! Every rejected case sits next to a control insert that must succeed on the same parent rows, so a red names the
//! constraint, not a missing parent or a typo.

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
