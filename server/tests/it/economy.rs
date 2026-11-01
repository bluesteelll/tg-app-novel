//! The resource economy (META-PLAN M17-M21): the `0004_economy.sql` constraints on raw SQL.
//!
//! Every refused schema case breaks one CHECK, or one whose name sorts before every other it breaks: PostgreSQL tests
//! a table's CHECK constraints in name order, so the constraint a case reports is the one the case is about. Each
//! refused case sits next to a control on the same parent rows, so a red names the constraint, not a missing parent.

use sqlx::PgConnection;
use sqlx::postgres::PgQueryResult;

use crate::catalog::{ANN, T0, state_with_users};
use crate::common;

/// A second player.
const BEN: i64 = 1002;

/// A user id with no `users` row.
const NOBODY: i64 = 4242;

type Res = Result<PgQueryResult, sqlx::Error>;

fn report(failures: &[String]) {
    assert!(
        failures.is_empty(),
        "{} failures:\n{}",
        failures.len(),
        failures.join("\n")
    );
}

/// A database error as `(SQLSTATE, constraint) message`; any other error as its text.
fn describe(e: &sqlx::Error) -> String {
    match e {
        sqlx::Error::Database(db) => format!(
            "({}, {}) {db}",
            db.code().as_deref().unwrap_or("no code"),
            db.constraint().unwrap_or("no constraint")
        ),
        other => other.to_string(),
    }
}

/// `Ok` when `res` is a database error with SQLSTATE `want.0` on the constraint named `want.1`. Never the message
/// text alone: the server's locale decides it.
fn expect_err(case: &str, res: Res, want: (&str, &str)) -> Result<(), String> {
    let (code, constraint) = want;
    match res {
        Err(sqlx::Error::Database(e))
            if e.code().as_deref() == Some(code) && e.constraint() == Some(constraint) =>
        {
            Ok(())
        }
        Err(e) => Err(format!(
            "case {case}: expected ({code}, {constraint}), got {}",
            describe(&e)
        )),
        Ok(_) => Err(format!(
            "case {case}: expected ({code}, {constraint}), got Ok"
        )),
    }
}

fn expect_ok(case: &str, res: Res) -> Result<(), String> {
    res.map(|_| ())
        .map_err(|e| format!("case {case} (control): expected Ok, got {}", describe(&e)))
}

/// The failure lines of `results`.
fn failed(results: impl IntoIterator<Item = Result<(), String>>) -> Vec<String> {
    results.into_iter().filter_map(Result::err).collect()
}

/// A migrated database with the `users` rows of ANN and BEN, and a raw connection to it.
async fn schema_db() -> (server::AppState, common::TestDb, PgConnection) {
    let (st, db) = state_with_users(&[ANN, BEN]).await;
    let c = common::raw_db(&st).await;
    (st, db, c)
}

/// A `payments` row of `user` with charge `charge`.
async fn payment(c: &mut PgConnection, charge: &str, user: i64) -> Res {
    sqlx::query(
        "INSERT INTO payments (telegram_payment_charge_id, invoice_payload, user_id, amount, currency, \
         provider_payment_charge_id, paid_at) VALUES ($1, 'payload', $2, 1, 'XTR', '', $3)",
    )
    .bind(charge)
    .bind(user)
    .bind(T0)
    .execute(&mut *c)
    .await
}

/// A `resource_balances` row.
async fn balance(c: &mut PgConnection, user: i64, kind: &str, balance: i64, debt: i64) -> Res {
    sqlx::query(
        "INSERT INTO resource_balances (user_id, kind, balance, debt, updated_at) VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(user)
    .bind(kind)
    .bind(balance)
    .bind(debt)
    .bind(T0)
    .execute(&mut *c)
    .await
}

/// A `resource_ledger` row; [`ledger`] is a valid one for every case to change.
struct Ledger<'a> {
    user: i64,
    kind: &'a str,
    amount: i64,
    reason: &'a str,
    idem_key: &'a str,
    charge: Option<&'a str>,
    counterpart: Option<i64>,
    created_at: i64,
}

/// A `referral_invitee` credit of 2 hints to ANN under `idem_key`: no charge, no counterpart.
fn ledger(idem_key: &str) -> Ledger<'_> {
    Ledger {
        user: ANN,
        kind: "hint",
        amount: 2,
        reason: "referral_invitee",
        idem_key,
        charge: None,
        counterpart: None,
        created_at: T0,
    }
}

async fn insert_ledger(c: &mut PgConnection, l: Ledger<'_>) -> Res {
    sqlx::query(
        "INSERT INTO resource_ledger (user_id, kind, amount, reason, idem_key, charge_id, counterpart_id, ref, \
         created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, $8)",
    )
    .bind(l.user)
    .bind(l.kind)
    .bind(l.amount)
    .bind(l.reason)
    .bind(l.idem_key)
    .bind(l.charge)
    .bind(l.counterpart)
    .bind(l.created_at)
    .execute(&mut *c)
    .await
}

/// A `created` order of ANN for `product` at 1 Star, with the pack binding (`pack_kind`, `pack_amount`).
async fn order(
    c: &mut PgConnection,
    id: &str,
    product: &str,
    pack_kind: Option<&str>,
    pack_amount: Option<i64>,
) -> Res {
    sqlx::query(
        "INSERT INTO orders (id, user_id, product_id, amount, currency, status, created_at, pack_kind, pack_amount) \
         VALUES ($1, $2, $3, 1, 'XTR', 'created', $4, $5, $6)",
    )
    .bind(id)
    .bind(ANN)
    .bind(product)
    .bind(T0)
    .bind(pack_kind)
    .bind(pack_amount)
    .execute(&mut *c)
    .await
}

/// A balance never goes below 0: the CHECK behind the guarded debit.
#[tokio::test]
async fn schema_balance_never_negative() {
    let (_st, _db, mut c) = schema_db().await;
    let failures = failed([
        expect_err(
            "balance -1",
            balance(&mut c, BEN, "hint", -1, 0).await,
            ("23514", "resource_balances_balance_nonneg"),
        ),
        expect_ok("balance 0", balance(&mut c, BEN, "hint", 0, 0).await),
    ]);
    report(&failures);
}

/// A row holds a balance or a debt, never both: a credit pays the debt first.
#[tokio::test]
async fn schema_balance_or_debt() {
    let (_st, _db, mut c) = schema_db().await;
    let failures = failed([
        expect_err(
            "balance 1, debt 1",
            balance(&mut c, ANN, "hint", 1, 1).await,
            ("23514", "resource_balances_balance_or_debt"),
        ),
        expect_ok(
            "balance 0, debt 1",
            balance(&mut c, ANN, "hint", 0, 1).await,
        ),
        expect_ok(
            "balance 1, debt 0",
            balance(&mut c, BEN, "hint", 1, 0).await,
        ),
    ]);
    report(&failures);
}

/// One ledger row per idempotency key, whoever it names.
#[tokio::test]
async fn schema_ledger_idem_key() {
    let (_st, _db, mut c) = schema_db().await;
    let failures = failed([
        expect_ok("k1", insert_ledger(&mut c, ledger("k1")).await),
        expect_err(
            "k1 again, for BEN",
            insert_ledger(
                &mut c,
                Ledger {
                    user: BEN,
                    ..ledger("k1")
                },
            )
            .await,
            ("23505", "resource_ledger_idem_key"),
        ),
        expect_ok(
            "k2 for BEN",
            insert_ledger(
                &mut c,
                Ledger {
                    user: BEN,
                    ..ledger("k2")
                },
            )
            .await,
        ),
    ]);
    report(&failures);
}

/// A reason fixes the sign: a pack credits, a hint spend debits.
#[tokio::test]
async fn schema_ledger_sign_by_reason() {
    let (_st, _db, mut c) = schema_db().await;
    let pack = |amount: i64, key| Ledger {
        amount,
        reason: "pack",
        charge: Some("c1"),
        ..ledger(key)
    };
    let spend = |amount: i64, key| Ledger {
        amount,
        reason: "hint_spend",
        ..ledger(key)
    };
    let failures = failed([
        expect_ok("payment c1", payment(&mut c, "c1", ANN).await),
        expect_err(
            "pack -3",
            insert_ledger(&mut c, pack(-3, "pay:c1")).await,
            ("23514", "resource_ledger_sign_by_reason"),
        ),
        expect_ok("pack +3", insert_ledger(&mut c, pack(3, "pay:c1")).await),
        expect_err(
            "hint_spend +1",
            insert_ledger(&mut c, spend(1, "hint:1001:ch1.drawer:1")).await,
            ("23514", "resource_ledger_sign_by_reason"),
        ),
        expect_ok(
            "hint_spend -1",
            insert_ledger(&mut c, spend(-1, "hint:1001:ch1.drawer:1")).await,
        ),
    ]);
    report(&failures);
}

/// A `pack:` order carries its binding and a chapter order none (revision 1, W3).
#[tokio::test]
async fn schema_orders_pack_binding() {
    let (_st, _db, mut c) = schema_db().await;
    let failures = failed([
        expect_err(
            "pack order without a binding",
            order(&mut c, "o1", "pack:hint_s", None, None).await,
            ("23514", "orders_pack_binding"),
        ),
        expect_ok(
            "pack order bound to (hint, 3)",
            order(&mut c, "o1", "pack:hint_s", Some("hint"), Some(3)).await,
        ),
        expect_err(
            "chapter order with a binding",
            order(&mut c, "o2", "chapter:ch2", Some("hint"), Some(3)).await,
            ("23514", "orders_pack_binding"),
        ),
        expect_ok(
            "chapter order without a binding",
            order(&mut c, "o2", "chapter:ch2", None, None).await,
        ),
    ]);
    report(&failures);
}

/// Every other named constraint of `0004`, one refused case each: dropping any of them reds a line.
#[tokio::test]
async fn schema_economy_named_checks() {
    let (_st, _db, mut c) = schema_db().await;
    let mut results = vec![
        // resource_balances
        expect_err(
            "balance kind Hint",
            balance(&mut c, ANN, "Hint", 0, 0).await,
            ("23514", "resource_balances_kind_shape"),
        ),
        expect_ok(
            "balance kind hint",
            balance(&mut c, ANN, "hint", 0, 0).await,
        ),
        expect_err(
            "balance (ANN, hint) again",
            balance(&mut c, ANN, "hint", 0, 0).await,
            ("23505", "resource_balances_pkey"),
        ),
        expect_err(
            "debt -1",
            balance(&mut c, BEN, "hint", 0, -1).await,
            ("23514", "resource_balances_debt_nonneg"),
        ),
        expect_ok("debt 1", balance(&mut c, BEN, "hint", 0, 1).await),
        expect_err(
            "balance of no user",
            balance(&mut c, NOBODY, "hint", 0, 0).await,
            ("23503", "resource_balances_user_fk"),
        ),
        expect_ok("payment c1", payment(&mut c, "c1", ANN).await),
    ];
    // resource_ledger: (case, the refused row, the refusal, its control: the same row with the one change undone).
    let ledger_cases: [(&str, Ledger<'_>, (&str, &str), Ledger<'_>); 10] = [
        (
            "ledger kind Hint",
            Ledger {
                kind: "Hint",
                ..ledger("l-kind")
            },
            ("23514", "resource_ledger_kind_shape"),
            ledger("l-kind"),
        ),
        (
            "reason bonus",
            Ledger {
                reason: "bonus",
                ..ledger("l-reason")
            },
            ("23514", "resource_ledger_reason_known"),
            ledger("l-reason"),
        ),
        (
            "amount 1001",
            Ledger {
                amount: 1001,
                ..ledger("l-amount-up")
            },
            ("23514", "resource_ledger_amount_bounded"),
            Ledger {
                amount: 1000,
                ..ledger("l-amount-up")
            },
        ),
        (
            "hint_spend -1001",
            Ledger {
                amount: -1001,
                reason: "hint_spend",
                ..ledger("l-amount-down")
            },
            ("23514", "resource_ledger_amount_bounded"),
            Ledger {
                amount: -1000,
                reason: "hint_spend",
                ..ledger("l-amount-down")
            },
        ),
        (
            "pack without a charge",
            Ledger {
                amount: 3,
                reason: "pack",
                ..ledger("l-pack-charge")
            },
            ("23514", "resource_ledger_charge_by_reason"),
            Ledger {
                amount: 3,
                reason: "pack",
                charge: Some("c1"),
                ..ledger("l-pack-charge")
            },
        ),
        (
            "hint_spend with a charge",
            Ledger {
                amount: -1,
                reason: "hint_spend",
                charge: Some("c1"),
                ..ledger("l-spend-charge")
            },
            ("23514", "resource_ledger_charge_by_reason"),
            Ledger {
                amount: -1,
                reason: "hint_spend",
                ..ledger("l-spend-charge")
            },
        ),
        (
            "created_at 0",
            Ledger {
                created_at: 0,
                ..ledger("l-time")
            },
            ("23514", "resource_ledger_time_positive"),
            ledger("l-time"),
        ),
        (
            "pack of an unknown charge",
            Ledger {
                amount: 3,
                reason: "pack",
                charge: Some("nope"),
                ..ledger("l-charge-fk")
            },
            ("23503", "resource_ledger_charge_fk"),
            Ledger {
                amount: 3,
                reason: "pack",
                charge: Some("c1"),
                ..ledger("l-charge-fk")
            },
        ),
        (
            "ledger of no user",
            Ledger {
                user: NOBODY,
                ..ledger("l-user-fk")
            },
            ("23503", "resource_ledger_user_fk"),
            ledger("l-user-fk"),
        ),
        (
            "counterpart of no user",
            Ledger {
                counterpart: Some(NOBODY),
                ..ledger("l-counterpart-fk")
            },
            ("23503", "resource_ledger_counterpart_fk"),
            Ledger {
                counterpart: Some(BEN),
                ..ledger("l-counterpart-fk")
            },
        ),
    ];
    for (case, refused, want, control) in ledger_cases {
        results.push(expect_err(case, insert_ledger(&mut c, refused).await, want));
        results.push(expect_ok(case, insert_ledger(&mut c, control).await));
    }
    // orders_pack_binding: half a binding, a bad kind, an amount outside 1..=1000.
    for (case, kind, amount) in [
        ("pack kind without an amount", Some("hint"), None),
        ("pack amount without a kind", None, Some(3)),
        ("pack kind Hint", Some("Hint"), Some(3)),
        ("pack amount 0", Some("hint"), Some(0)),
        ("pack amount 1001", Some("hint"), Some(1001)),
    ] {
        results.push(expect_err(
            case,
            order(&mut c, "o-bad", "pack:hint_s", kind, amount).await,
            ("23514", "orders_pack_binding"),
        ));
    }
    results.push(expect_ok(
        "pack amount 1000",
        order(&mut c, "o-1000", "pack:hint_m", Some("hint"), Some(1000)).await,
    ));
    results.push(expect_ok(
        "pack amount 1",
        order(&mut c, "o-1", "pack:hint_m", Some("hint"), Some(1)).await,
    ));
    report(&failed(results));
}
