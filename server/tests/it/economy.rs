//! The resource economy (META-PLAN M17-M21): the `0004_economy.sql` constraints on raw SQL, and the ledger and
//! balance primitives of `db/economy.rs` on raw READ COMMITTED connections.
//!
//! Every refused schema case breaks one CHECK, or one whose name sorts before every other it breaks: PostgreSQL tests
//! a table's CHECK constraints in name order, so the constraint a case reports is the one the case is about. Each
//! refused case sits next to a control on the same parent rows, so a red names the constraint, not a missing parent.
//!
//! Balances are seeded through the primitives (a `referral_invitee` credit needs no charge; a debt is a clawback of a
//! raw payment), never by raw balance rows, so every test keeps `balance - debt = SUM(amount)` per (user, kind).
//!
//! The catalog's `economy` section (M17) and the pack path (M19): pack products, the order binding, and the credit
//! inside the grant, through `POST /api/invoices` and the grant the webhook runs. `GET /api/wallet` through the
//! production router.

use std::fmt::Debug;
use std::path::Path;
use std::str::FromStr;
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::http::header::CACHE_CONTROL;
use serde_json::{Value, json};
use server::AppState;
use server::catalog::{
    CATALOG_JSON, Catalog, Economy, GiftRules, PackDef, PackId, ProductRef, ReferralRules,
    ResourceKind,
};
use server::content::{ContentError, ContentStore};
use server::db::economy::{
    Applied, Entry, Reason, clawback_in_tx, credit_in_tx, credited_by_charge, debit_in_tx,
};
use server::ids::{ChargeId, OrderId, ProductId, UserId};
use server::telegram::gateway::InvoiceSpec;
use server::telegram::payments::{GrantOutcome, PaymentFact, on_successful_payment};
use sqlx::postgres::{PgConnectOptions, PgQueryResult};
use sqlx::{Connection, PgConnection};

use crate::catalog::{ANN, T0, get, state_with_users};
use crate::common;
use crate::content::FIXTURE;
use crate::payments::{invoice_state, post_invoice};
use crate::webhook::order_status;

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

/// The `hint` kind.
fn hint() -> ResourceKind {
    ResourceKind("hint".to_owned())
}

/// A ledger change of `user`'s `kind` by `amount` for `reason` under `key` at `T0`: no charge, no counterpart.
fn entry<'a>(
    user: i64,
    kind: &'a ResourceKind,
    amount: i64,
    reason: Reason,
    key: &str,
) -> Entry<'a> {
    Entry {
        user: UserId(user),
        kind,
        amount,
        reason,
        idem_key: key.to_owned(),
        charge_id: None,
        counterpart: None,
        r#ref: None,
        at: T0,
    }
}

/// A `referral_invitee` credit: the seed of these tests (it needs no charge).
fn seed<'a>(user: i64, kind: &'a ResourceKind, amount: i64, key: &str) -> Entry<'a> {
    entry(user, kind, amount, Reason::ReferralInvitee, key)
}

/// A `pack_refund` clawback of `amount` (above 0) of charge `charge`, keyed `refund:<charge>`.
fn refund<'a>(user: i64, kind: &'a ResourceKind, amount: i64, charge: &'a str) -> Entry<'a> {
    Entry {
        charge_id: Some(charge),
        ..entry(
            user,
            kind,
            -amount,
            Reason::PackRefund,
            &format!("refund:{charge}"),
        )
    }
}

/// Opens a READ COMMITTED transaction on `c` (a raw connection's default is `repeatable read`).
async fn begin(c: &mut PgConnection) {
    sqlx::raw_sql("BEGIN ISOLATION LEVEL READ COMMITTED")
        .execute(&mut *c)
        .await
        .unwrap();
}

async fn commit(c: &mut PgConnection) {
    sqlx::raw_sql("COMMIT").execute(&mut *c).await.unwrap();
}

async fn rollback(c: &mut PgConnection) {
    sqlx::raw_sql("ROLLBACK").execute(&mut *c).await.unwrap();
}

/// A raw connection to `st`'s database named like the app pool's sessions, so `wait_for_lock_waiter` sees it wait.
async fn app_named(st: &server::AppState) -> PgConnection {
    let options = PgConnectOptions::from_str(&st.cfg.database_url)
        .unwrap()
        .application_name("tg-novel-server");
    PgConnection::connect_with(&options).await.unwrap()
}

/// Every balance row as (user, kind, balance, debt), by user and kind.
async fn balance_rows(c: &mut PgConnection) -> Vec<(i64, String, i64, i64)> {
    sqlx::query_as(
        "SELECT user_id, kind, balance, debt FROM resource_balances ORDER BY user_id, kind",
    )
    .fetch_all(&mut *c)
    .await
    .unwrap()
}

/// Every ledger key, sorted.
async fn ledger_keys(c: &mut PgConnection) -> Vec<String> {
    sqlx::query_scalar("SELECT idem_key FROM resource_ledger ORDER BY idem_key")
        .fetch_all(&mut *c)
        .await
        .unwrap()
}

/// The mismatch of `got` against `want`.
fn expect_eq<T: PartialEq + Debug>(case: &str, got: T, want: T) -> Option<String> {
    (got != want).then(|| format!("{case}: expected {want:?}, got {got:?}"))
}

/// A primitive's result as one comparable value: `Ok(Some(..))` applied or a duplicate, `Ok(None)` a refused debit,
/// or the database error as `(SQLSTATE, constraint) message`.
type Step = Result<Option<Applied>, String>;

/// A credit's or a clawback's result as a [`Step`].
fn step(got: Result<Applied, sqlx::Error>) -> Step {
    got.map(Some).map_err(|e| describe(&e))
}

/// A debit's result as a [`Step`].
fn debit_step(got: Result<Option<Applied>, sqlx::Error>) -> Step {
    got.map_err(|e| describe(&e))
}

/// Applied, leaving this balance and debt.
fn applied(balance: i64, debt: i64) -> Step {
    Ok(Some(Applied::Applied { balance, debt }))
}

/// A replayed key: nothing changed.
fn duplicate() -> Step {
    Ok(Some(Applied::Duplicate))
}

/// M18's invariant over a mixed sequence (credits, debits, a clawback into debt, a credit that pays it, replayed
/// keys): per (user, kind) the ledger sum equals `balance - debt`, and a replay changed nothing.
#[tokio::test]
async fn ledger_reconciles_with_balances() {
    let (_st, _db, mut c) = schema_db().await;
    let mut failures = Vec::new();
    let (hint, gem) = (hint(), ResourceKind("gem".to_owned()));
    failures.extend(expect_ok("payment c-refund", payment(&mut c, "c-refund", ANN).await).err());
    begin(&mut c).await;
    let mut steps = Vec::new();
    let got = credit_in_tx(&mut c, &seed(ANN, &hint, 5, "r1")).await;
    steps.push(("ANN +5", step(got), applied(5, 0)));
    let got = debit_in_tx(&mut c, &entry(ANN, &hint, -2, Reason::HintSpend, "d1")).await;
    steps.push(("ANN -2", debit_step(got), applied(3, 0)));
    let got = clawback_in_tx(&mut c, &refund(ANN, &hint, 4, "c-refund")).await;
    steps.push(("ANN clawback 4", step(got), applied(0, 1)));
    let got = credit_in_tx(&mut c, &seed(ANN, &hint, 3, "r2")).await;
    steps.push(("ANN +3 pays debt 1", step(got), applied(2, 0)));
    let got = credit_in_tx(&mut c, &seed(ANN, &hint, 5, "r1")).await;
    steps.push(("ANN r1 replayed", step(got), duplicate()));
    let got = debit_in_tx(&mut c, &entry(ANN, &hint, -2, Reason::HintSpend, "d1")).await;
    steps.push(("ANN d1 replayed", debit_step(got), duplicate()));
    let got = clawback_in_tx(&mut c, &refund(ANN, &hint, 4, "c-refund")).await;
    steps.push(("ANN clawback replayed", step(got), duplicate()));
    let got = credit_in_tx(&mut c, &seed(BEN, &gem, 7, "r3")).await;
    steps.push(("BEN gem +7", step(got), applied(7, 0)));
    let got = debit_in_tx(&mut c, &entry(BEN, &gem, -7, Reason::GiftOut, "d2")).await;
    steps.push(("BEN gem -7", debit_step(got), applied(0, 0)));
    let got = credit_in_tx(&mut c, &seed(BEN, &hint, 1, "r4")).await;
    steps.push(("BEN hint +1", step(got), applied(1, 0)));
    commit(&mut c).await;
    for (case, got, want) in steps {
        failures.extend(expect_eq(case, got, want));
    }
    let sums: Vec<(i64, String, i64)> = sqlx::query_as(
        "SELECT user_id, kind, SUM(amount)::BIGINT FROM resource_ledger \
         GROUP BY user_id, kind ORDER BY user_id, kind",
    )
    .fetch_all(&mut c)
    .await
    .unwrap();
    let rows = balance_rows(&mut c).await;
    let net: Vec<(i64, String, i64)> = rows
        .iter()
        .map(|(user, kind, balance, debt)| (*user, kind.clone(), balance - debt))
        .collect();
    failures.extend(expect_eq(
        "per (user, kind): SUM(amount) against balance - debt",
        sums,
        net,
    ));
    failures.extend(expect_eq(
        "balance rows",
        rows,
        vec![
            (ANN, "hint".to_owned(), 2, 0),
            (BEN, "gem".to_owned(), 0, 0),
            (BEN, "hint".to_owned(), 1, 0),
        ],
    ));
    failures.extend(expect_eq(
        "ledger keys",
        ledger_keys(&mut c).await,
        ["d1", "d2", "r1", "r2", "r3", "r4", "refund:c-refund"]
            .map(str::to_owned)
            .to_vec(),
    ));
    report(&failures);
}

/// A credit pays the debt first (M18, M20): debt 2 and a credit of 5 leave balance 3 and no debt; a credit of 1 on a
/// debt of 2 leaves a debt of 1.
#[tokio::test]
async fn credit_pays_debt_first() {
    let (_st, _db, mut c) = schema_db().await;
    let mut failures = Vec::new();
    let hint = hint();
    for (user, charge) in [(ANN, "c-ann"), (BEN, "c-ben")] {
        failures.extend(expect_ok(charge, payment(&mut c, charge, user).await).err());
    }
    begin(&mut c).await;
    let mut steps = Vec::new();
    let got = clawback_in_tx(&mut c, &refund(ANN, &hint, 2, "c-ann")).await;
    steps.push(("ANN debt 2", step(got), applied(0, 2)));
    let got = credit_in_tx(&mut c, &seed(ANN, &hint, 5, "r1")).await;
    steps.push(("ANN +5", step(got), applied(3, 0)));
    commit(&mut c).await;
    begin(&mut c).await;
    let got = clawback_in_tx(&mut c, &refund(BEN, &hint, 2, "c-ben")).await;
    steps.push(("BEN debt 2", step(got), applied(0, 2)));
    let got = credit_in_tx(&mut c, &seed(BEN, &hint, 1, "r2")).await;
    steps.push(("BEN +1", step(got), applied(0, 1)));
    commit(&mut c).await;
    for (case, got, want) in steps {
        failures.extend(expect_eq(case, got, want));
    }
    report(&failures);
}

/// A clawback takes the balance, then records the shortfall as debt (M20): balance 1, clawback 3 -> balance 0, debt 2.
/// A user with no row gets one holding the whole amount as debt (D16: the clawback is an upsert).
#[tokio::test]
async fn clawback_takes_balance_then_debt() {
    let (_st, _db, mut c) = schema_db().await;
    let mut failures = Vec::new();
    let hint = hint();
    for (user, charge) in [(ANN, "c-ann"), (BEN, "c-ben")] {
        failures.extend(expect_ok(charge, payment(&mut c, charge, user).await).err());
    }
    begin(&mut c).await;
    let mut steps = Vec::new();
    let got = credit_in_tx(&mut c, &seed(ANN, &hint, 1, "r1")).await;
    steps.push(("ANN +1", step(got), applied(1, 0)));
    let got = clawback_in_tx(&mut c, &refund(ANN, &hint, 3, "c-ann")).await;
    steps.push(("ANN clawback 3", step(got), applied(0, 2)));
    let got = clawback_in_tx(&mut c, &refund(BEN, &hint, 4, "c-ben")).await;
    steps.push(("BEN (no row) clawback 4", step(got), applied(0, 4)));
    commit(&mut c).await;
    for (case, got, want) in steps {
        failures.extend(expect_eq(case, got, want));
    }
    failures.extend(expect_eq(
        "balance rows",
        balance_rows(&mut c).await,
        vec![
            (ANN, "hint".to_owned(), 0, 2),
            (BEN, "hint".to_owned(), 0, 4),
        ],
    ));
    report(&failures);
}

/// Two debits of a balance of 1 at once (D14): A debits and holds the row; B's guarded UPDATE waits on it (B is a raw
/// connection named like the app's sessions, so `wait_for_lock_waiter` sees the wait), then re-evaluates on A's
/// committed row and matches nothing: `None`, and B rolls back. One debit applied; the ledger holds the seed and A's
/// row only.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn balance_never_negative_concurrent_spends() {
    let (st, _db, mut a) = schema_db().await;
    let mut failures = Vec::new();
    let hint = hint();
    begin(&mut a).await;
    let got = credit_in_tx(&mut a, &seed(ANN, &hint, 1, "seed")).await;
    failures.extend(expect_eq("seed +1", step(got), applied(1, 0)));
    commit(&mut a).await;

    begin(&mut a).await;
    let got = debit_in_tx(&mut a, &entry(ANN, &hint, -1, Reason::HintSpend, "d:a")).await;
    failures.extend(expect_eq("A", debit_step(got), applied(0, 0)));
    let mut b = app_named(&st).await;
    let mut second = tokio::spawn(async move {
        let hint = ResourceKind("hint".to_owned());
        begin(&mut b).await;
        let got = debit_in_tx(&mut b, &entry(ANN, &hint, -1, Reason::HintSpend, "d:b")).await;
        rollback(&mut b).await;
        b.close().await.unwrap();
        debit_step(got)
    });
    let early = tokio::select! {
        biased;
        got = &mut second => Some(got.unwrap()),
        () = common::wait_for_lock_waiter(&st) => None,
    };
    if early.is_some() {
        failures.push("B never waited: it finished while A held the balance row".to_owned());
    }
    commit(&mut a).await;
    let second = match early {
        Some(got) => got,
        None => second.await.unwrap(),
    };
    failures.extend(expect_eq("B", second, Ok(None)));
    failures.extend(expect_eq(
        "balance rows",
        balance_rows(&mut a).await,
        vec![(ANN, "hint".to_owned(), 0, 0)],
    ));
    failures.extend(expect_eq(
        "ledger keys",
        ledger_keys(&mut a).await,
        vec!["d:a".to_owned(), "seed".to_owned()],
    ));
    report(&failures);
}

/// L9's clawback source (M20, revision 1): the kind and amount of a charge's `pay:<charge>` row; `None` for a charge
/// with no ledger row, and for one whose only row is not its pack credit.
#[tokio::test]
async fn credited_by_charge_reads_the_pay_row() {
    let (_st, _db, mut c) = schema_db().await;
    let mut failures = Vec::new();
    let hint = hint();
    for charge in ["c1", "c2"] {
        failures.extend(expect_ok(charge, payment(&mut c, charge, ANN).await).err());
    }
    begin(&mut c).await;
    let pack = Entry {
        charge_id: Some("c1"),
        ..entry(ANN, &hint, 3, Reason::Pack, "pay:c1")
    };
    let got = credit_in_tx(&mut c, &pack).await;
    failures.extend(expect_eq("pack +3 as pay:c1", step(got), applied(3, 0)));
    let got = clawback_in_tx(&mut c, &refund(ANN, &hint, 1, "c2")).await;
    failures.extend(expect_eq("refund:c2 only", step(got), applied(2, 0)));
    commit(&mut c).await;
    for (case, charge, want) in [
        ("the pack charge c1", "c1", Some((hint.clone(), 3))),
        ("an unknown charge", "c-none", None),
        ("c2, whose only row is refund:c2", "c2", None),
    ] {
        let got = credited_by_charge(&mut c, charge).await;
        failures.extend(expect_eq(case, got.map_err(|e| describe(&e)), Ok(want)));
    }
    report(&failures);
}

/// `server/catalog.json` with `edit` applied, as text.
fn catalog_with(edit: impl FnOnce(&mut Value)) -> String {
    let mut v: Value = serde_json::from_str(CATALOG_JSON).unwrap();
    edit(&mut v);
    v.to_string()
}

/// The fixture's content, loaded without a database.
async fn fixture_content() -> ContentStore {
    ContentStore::load(Path::new(FIXTURE)).await.unwrap()
}

/// A `successful_payment` fact from `payer`: `amount` XTR for order `order`, charge `charge`.
fn paid(payer: i64, amount: u32, order: &str, charge: &str) -> PaymentFact {
    PaymentFact {
        payer: UserId(payer),
        currency: "XTR".to_owned(),
        total_amount: amount,
        invoice_payload: order.to_owned(),
        charge: ChargeId(charge.to_owned()),
        provider_charge: String::new(),
    }
}

/// A new order of `product` for `user` through `POST /api/invoices`: its id. A refusal is a failure line and `None`.
async fn order_of(
    st: &AppState,
    user: i64,
    product: &str,
    failures: &mut Vec<String>,
) -> Option<String> {
    let reply = post_invoice(st, Some(user), &json!({ "productId": product }).to_string()).await;
    let body: Value = serde_json::from_slice(&reply.body).unwrap_or(Value::Null);
    let order = body["orderId"]
        .as_str()
        .filter(|_| reply.status.as_u16() == 200);
    if order.is_none() {
        failures.push(format!(
            "POST /api/invoices {product} for {user}: expected 200 with an orderId, got {} {}",
            reply.status.as_u16(),
            String::from_utf8_lossy(&reply.body)
        ));
    }
    order.map(str::to_owned)
}

/// An order's (product_id, amount, pack_kind, pack_amount), read outside the app pool.
type OrderBinding = (String, i64, Option<String>, Option<i64>);

async fn order_binding(st: &AppState, order: &str) -> OrderBinding {
    let mut c = common::raw_db(st).await;
    let row = sqlx::query_as(
        "SELECT product_id, amount, pack_kind, pack_amount FROM orders WHERE id = $1",
    )
    .bind(order)
    .fetch_one(&mut c)
    .await
    .unwrap();
    c.close().await.unwrap();
    row
}

/// `user`'s `hint` row as (balance, debt), or `None` without one; read outside the app pool.
async fn hint_row(st: &AppState, user: i64) -> Option<(i64, i64)> {
    let mut c = common::raw_db(st).await;
    let row = sqlx::query_as(
        "SELECT balance, debt FROM resource_balances WHERE user_id = $1 AND kind = 'hint'",
    )
    .bind(user)
    .fetch_optional(&mut c)
    .await
    .unwrap();
    c.close().await.unwrap();
    row
}

/// One statement on a raw autocommit connection.
async fn raw_exec(st: &AppState, sql: &'static str, order: &str) {
    let mut c = common::raw_db(st).await;
    sqlx::query(sql).bind(order).execute(&mut c).await.unwrap();
    c.close().await.unwrap();
}

/// The (payments rows, `pay:` ledger rows) of `charge`, read outside the app pool.
async fn charge_rows(st: &AppState, charge: &str) -> (i64, i64) {
    let mut c = common::raw_db(st).await;
    let row = sqlx::query_as(
        "SELECT (SELECT count(*) FROM payments WHERE telegram_payment_charge_id = $1), \
         (SELECT count(*) FROM resource_ledger WHERE idem_key = 'pay:' || $1)",
    )
    .bind(charge)
    .fetch_one(&mut c)
    .await
    .unwrap();
    c.close().await.unwrap();
    row
}

/// Returns once at least `n` app-pool sessions on `st`'s database wait for a lock; panics after 5 s (the shape of
/// `common::wait_for_lock_waiter`, which returns at one).
async fn wait_for_waiters(st: &AppState, n: i64) {
    let mut c = common::raw_db(st).await;
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let waiters: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock' \
             AND datname = current_database() AND application_name = 'tg-novel-server'",
        )
        .fetch_one(&mut c)
        .await
        .unwrap();
        if waiters >= n {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "{waiters} lock waiters after 5 s, expected {n}"
        );
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    c.close().await.unwrap();
}

/// The credit is the kind and amount the order bound at invoice time (revision 1, W3), never the current catalog: an
/// order whose binding was raised to 7 (an order invoiced by an earlier build) credits 7, and an order whose product
/// was retired (`pack:gone`, the binding kept) credits its bound 3.
#[tokio::test]
async fn pack_credit_uses_amount_bound_at_order() {
    let (st, _db, _gateway) = invoice_state(&[(ANN, Some("ru"))]).await;
    let mut failures = Vec::new();
    let Some(raised) = order_of(&st, ANN, "pack:hint_s", &mut failures).await else {
        return report(&failures);
    };
    raw_exec(
        &st,
        "UPDATE orders SET pack_amount = 7 WHERE id = $1",
        &raised,
    )
    .await;
    let outcome = on_successful_payment(&st, &paid(ANN, 1, &raised, "c-raised")).await;
    failures.extend(expect_eq(
        "raised to 7: grant",
        outcome.ok(),
        Some(GrantOutcome::Granted),
    ));
    failures.extend(expect_eq(
        "raised to 7: hint row",
        hint_row(&st, ANN).await,
        Some((7, 0)),
    ));

    let Some(gone) = order_of(&st, ANN, "pack:hint_s", &mut failures).await else {
        return report(&failures);
    };
    raw_exec(
        &st,
        "UPDATE orders SET product_id = 'pack:gone' WHERE id = $1",
        &gone,
    )
    .await;
    let outcome = on_successful_payment(&st, &paid(ANN, 1, &gone, "c-gone")).await;
    failures.extend(expect_eq(
        "pack:gone: grant",
        outcome.ok(),
        Some(GrantOutcome::Granted),
    ));
    failures.extend(expect_eq(
        "pack:gone: hint row",
        hint_row(&st, ANN).await,
        Some((10, 0)),
    ));
    failures.extend(expect_eq(
        "pack:gone: rows",
        charge_rows(&st, "c-gone").await,
        (1, 1),
    ));
    report(&failures);
}

/// Two deliveries of one pack charge at once credit once (META-PLAN concurrency, `payments_pkey` the arbiter): with
/// the order row held, grant 1 records the payment and waits on the order; grant 2 waits on grant 1's payment key;
/// both are seen waiting, then the row is released. One `Granted`, one `Duplicate`, one payment, one `pay:` row,
/// balance 3; a third, later delivery is `Duplicate` and changes nothing.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn pack_credit_once_on_duplicate_payment() {
    let (st, _db, _gateway) = invoice_state(&[(ANN, Some("ru"))]).await;
    let mut failures = Vec::new();
    let Some(order) = order_of(&st, ANN, "pack:hint_s", &mut failures).await else {
        return report(&failures);
    };
    let mut holder = common::raw_db(&st).await;
    begin(&mut holder).await;
    sqlx::query("SELECT 1 FROM orders WHERE id = $1 FOR UPDATE")
        .bind(&order)
        .execute(&mut holder)
        .await
        .unwrap();
    let spawn_grant = |st: &AppState| {
        let (st, fact) = (st.clone(), paid(ANN, 1, &order, "c-twin"));
        tokio::spawn(async move { on_successful_payment(&st, &fact).await })
    };
    let first = spawn_grant(&st);
    common::wait_for_lock_waiter(&st).await;
    let second = spawn_grant(&st);
    wait_for_waiters(&st, 2).await;
    commit(&mut holder).await;
    holder.close().await.unwrap();
    let mut outcomes: Vec<String> = Vec::new();
    for grant in [first, second] {
        outcomes.push(format!("{:?}", grant.await.unwrap()));
    }
    outcomes.sort_unstable();
    failures.extend(expect_eq(
        "the twin outcomes, sorted",
        outcomes,
        vec!["Ok(Duplicate)".to_owned(), "Ok(Granted)".to_owned()],
    ));
    failures.extend(expect_eq("rows", charge_rows(&st, "c-twin").await, (1, 1)));
    failures.extend(expect_eq(
        "hint row",
        hint_row(&st, ANN).await,
        Some((3, 0)),
    ));

    let third = on_successful_payment(&st, &paid(ANN, 1, &order, "c-twin")).await;
    failures.extend(expect_eq(
        "a later redelivery",
        third.ok(),
        Some(GrantOutcome::Duplicate),
    ));
    failures.extend(expect_eq(
        "rows after it",
        charge_rows(&st, "c-twin").await,
        (1, 1),
    ));
    failures.extend(expect_eq(
        "hint row after it",
        hint_row(&st, ANN).await,
        Some((3, 0)),
    ));
    report(&failures);
}

/// The pack credit is inside the grant's one transaction (M19): while the credit waits on the held balance row, an
/// autocommit reader sees no payment, the order still `created` and no ledger row; after the release all three
/// appear together with the balance.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn pack_grant_credits_in_the_grant_transaction() {
    let (st, _db, _gateway) = invoice_state(&[(ANN, Some("ru"))]).await;
    let mut failures = Vec::new();
    let Some(order) = order_of(&st, ANN, "pack:hint_s", &mut failures).await else {
        return report(&failures);
    };
    let mut holder = common::raw_db(&st).await;
    // A (0, 0) row holds `balance - debt = SUM(amount)` with no ledger row.
    sqlx::query(
        "INSERT INTO resource_balances (user_id, kind, balance, debt, updated_at) VALUES ($1, 'hint', 0, 0, $2)",
    )
    .bind(ANN)
    .bind(T0)
    .execute(&mut holder)
    .await
    .unwrap();
    begin(&mut holder).await;
    sqlx::query("SELECT 1 FROM resource_balances WHERE user_id = $1 AND kind = 'hint' FOR UPDATE")
        .bind(ANN)
        .execute(&mut holder)
        .await
        .unwrap();
    let (app, fact) = (st.clone(), paid(ANN, 1, &order, "c-held"));
    let grant = tokio::spawn(async move { on_successful_payment(&app, &fact).await });
    common::wait_for_lock_waiter(&st).await;
    let while_waiting = (
        charge_rows(&st, "c-held").await,
        order_status(&st, &order).await,
    );
    commit(&mut holder).await;
    holder.close().await.unwrap();
    failures.extend(expect_eq(
        "while the credit waits: (payments, pay: rows), order status",
        while_waiting,
        ((0, 0), "created".to_owned()),
    ));
    let outcome = grant.await.unwrap();
    failures.extend(expect_eq(
        "grant",
        outcome.ok(),
        Some(GrantOutcome::Granted),
    ));
    failures.extend(expect_eq(
        "after the release: (payments, pay: rows), order status",
        (
            charge_rows(&st, "c-held").await,
            order_status(&st, &order).await,
        ),
        ((1, 1), "paid".to_owned()),
    ));
    failures.extend(expect_eq(
        "hint row",
        hint_row(&st, ANN).await,
        Some((3, 0)),
    ));
    report(&failures);
}

/// The compiled-in catalog's `economy` section (M17, PLACEHOLDER values): the packs in (kind, amount, id) order (D6),
/// each a product with its binding, the spend and the gift and referral rules; `chapters()` is still the chapter
/// products only.
#[tokio::test]
async fn catalog_packs_from_economy() {
    let catalog = Catalog::build(CATALOG_JSON, &fixture_content().await).unwrap();
    let mut failures = Vec::new();
    let packs: Vec<(String, u32, &str, &str, Option<PackDef>)> = catalog
        .packs()
        .map(|p| {
            (
                p.id.0.clone(),
                p.price_stars,
                p.title.ru.as_str(),
                p.title.en.as_str(),
                p.pack.clone(),
            )
        })
        .collect();
    let def = |id: &str, amount: u32| PackDef {
        id: PackId(id.to_owned()),
        kind: hint(),
        amount,
    };
    failures.extend(expect_eq(
        "packs()",
        packs,
        vec![
            (
                "pack:hint_s".to_owned(),
                1,
                "3 подсказки",
                "3 hints",
                Some(def("hint_s", 3)),
            ),
            (
                "pack:hint_m".to_owned(),
                3,
                "10 подсказок",
                "10 hints",
                Some(def("hint_m", 10)),
            ),
        ],
    ));
    for (id, pack, amount) in [("pack:hint_s", "hint_s", 3), ("pack:hint_m", "hint_m", 10)] {
        let id = ProductId(id.to_owned());
        let product = catalog
            .product(&id)
            .map(|p| (p.kind.clone(), p.pack.clone()));
        let want = Some((
            ProductRef::Pack {
                pack: PackId(pack.to_owned()),
            },
            Some(def(pack, amount)),
        ));
        failures.extend(expect_eq(&format!("product({})", id.0), product, want));
        failures.extend(expect_eq(
            &format!("pack({})", id.0),
            catalog.pack(&id).cloned(),
            Some(def(pack, amount)),
        ));
    }
    failures.extend(expect_eq(
        "economy()",
        catalog.economy().clone(),
        Economy {
            kinds: vec![hint()],
            hint_tier_cost: 1,
            gifts: GiftRules {
                kinds: vec![hint()],
                max_per_gift: 3,
                send_per_day: 3,
                receive_per_day: 5,
            },
            referral: ReferralRules {
                kind: hint(),
                inviter: 5,
                invitee: 2,
                min_play_secs: 120,
                cap_per_day: 3,
                cap_total: 20,
            },
        },
    ));
    let chapters: Vec<String> = catalog.chapters().map(|p| p.id.0.clone()).collect();
    failures.extend(expect_eq(
        "chapters()",
        chapters,
        vec!["chapter:ch2".to_owned(), "chapter:ch4".to_owned()],
    ));
    report(&failures);
}

/// A pack's invoice texts are 1-32 (title) and 1-255 (description) code points in each language, checked at startup
/// with the pack's product id.
#[tokio::test]
async fn catalog_pack_titles_within_limits() {
    let content = fixture_content().await;
    let mut failures = Vec::new();
    let text = |lang: &'static str, field: &'static str, value: String| {
        catalog_with(move |v| v["economy"]["packs"]["hint_s"][field][lang] = json!(value))
    };
    let built = Catalog::build(&text("ru", "title", "Я".repeat(32)), &content);
    if let Err(e) = &built {
        failures.push(format!("a 32-character ru title: expected Ok, got {e}"));
    }
    for (case, edited, lang, field, chars, max) in [
        (
            "a 33-character ru title",
            text("ru", "title", "Я".repeat(33)),
            "ru",
            "title",
            33,
            32,
        ),
        (
            "an empty en description",
            text("en", "description", String::new()),
            "en",
            "description",
            0,
            255,
        ),
    ] {
        match Catalog::build(&edited, &content) {
            Err(ContentError::InvoiceText {
                product,
                lang: got_lang,
                field: got_field,
                chars: got_chars,
                min: 1,
                max: got_max,
            }) if product == "pack:hint_s"
                && got_lang == lang
                && got_field == field
                && got_chars == chars
                && got_max == max => {}
            Err(e) => failures.push(format!(
                "{case}: expected InvoiceText {{ pack:hint_s, {lang}, {field}, {chars}, 1..={max} }}, got {e}"
            )),
            Ok(_) => failures.push(format!("{case}: expected InvoiceText, got Ok(catalog)")),
        }
    }
    report(&failures);
}

/// `POST /api/invoices { pack:hint_s }`: the price and the texts from the catalog's pack, in the user's language; the
/// order row binds the pack's kind and amount (revision 1, W3).
#[tokio::test]
async fn invoice_pack_price_from_catalog() {
    let (st, _db, gateway) = invoice_state(&[(ANN, Some("ru"))]).await;
    let mut failures = Vec::new();
    let Some(order) = order_of(&st, ANN, "pack:hint_s", &mut failures).await else {
        return report(&failures);
    };
    failures.extend(expect_eq(
        "gateway calls",
        gateway.invoice_calls(),
        vec![InvoiceSpec {
            title: "3 подсказки".to_owned(),
            description: "Три подсказки к загадкам игры.".to_owned(),
            payload: OrderId(order.clone()),
            label: "3 подсказки".to_owned(),
            amount: 1,
        }],
    ));
    failures.extend(expect_eq(
        "order row",
        order_binding(&st, &order).await,
        (
            "pack:hint_s".to_owned(),
            1,
            Some("hint".to_owned()),
            Some(3),
        ),
    ));
    report(&failures);
}

/// Every rule of the `economy` section is a startup refusal naming its key (`ContentError::Catalog`); a pack price
/// has no ceiling (one-time invoices have none, carry 5b).
#[tokio::test]
async fn catalog_economy_rules_refused() {
    let content = fixture_content().await;
    let mut failures = Vec::new();
    type Edit = Box<dyn FnOnce(&mut Value)>;
    let set = |path: &'static [&'static str], value: Value| -> Edit {
        Box::new(move |v: &mut Value| {
            let mut at = &mut v["economy"];
            for key in path {
                at = &mut at[*key];
            }
            *at = value;
        })
    };
    let cases: Vec<(&str, Edit, &str)> = vec![
        ("no kinds", set(&["kinds"], json!([])), "economy.kinds"),
        (
            "kinds without hint",
            set(&["kinds"], json!(["gem"])),
            "economy.kinds",
        ),
        (
            "a duplicate kind",
            set(&["kinds"], json!(["hint", "hint"])),
            "economy.kinds",
        ),
        (
            "Hint as a kind",
            set(&["kinds"], json!(["hint", "Hint"])),
            "economy.kinds",
        ),
        (
            "a 17-character kind",
            set(&["kinds"], json!(["hint", "a".repeat(17)])),
            "economy.kinds",
        ),
        (
            "an undeclared pack kind",
            set(&["packs", "hint_s", "kind"], json!("gem")),
            "economy.packs",
        ),
        (
            "pack amount 0",
            set(&["packs", "hint_s", "amount"], json!(0)),
            "economy.packs",
        ),
        (
            "pack amount 1001",
            set(&["packs", "hint_s", "amount"], json!(1001)),
            "economy.packs",
        ),
        (
            "pack priceStars 0",
            set(&["packs", "hint_s", "priceStars"], json!(0)),
            "economy.packs",
        ),
        (
            "a bad pack id",
            Box::new(|v: &mut Value| {
                let pack = v["economy"]["packs"]["hint_s"].take();
                v["economy"]["packs"]["Hint_S"] = pack;
            }),
            "economy.packs",
        ),
        (
            "hintTier 0",
            set(&["spend", "hintTier"], json!(0)),
            "economy.spend.hintTier",
        ),
        (
            "hintTier 1001",
            set(&["spend", "hintTier"], json!(1001)),
            "economy.spend.hintTier",
        ),
        (
            "an undeclared gift kind",
            set(&["gifts", "kinds"], json!(["gem"])),
            "economy.gifts",
        ),
        (
            "maxPerGift 0",
            set(&["gifts", "maxPerGift"], json!(0)),
            "economy.gifts",
        ),
        (
            "an undeclared referral kind",
            set(&["referral", "kind"], json!("gem")),
            "economy.referral",
        ),
        (
            "referral inviter 0",
            set(&["referral", "inviter"], json!(0)),
            "economy.referral",
        ),
        (
            "referral invitee 1001",
            set(&["referral", "invitee"], json!(1001)),
            "economy.referral",
        ),
    ];
    for (case, edit, key) in cases {
        let edited = catalog_with(|v| {
            // A bad pack id leaves `packs` with `null` under the old key: drop it.
            edit(v);
            if let Some(packs) = v["economy"]["packs"].as_object_mut() {
                packs.retain(|_, pack| !pack.is_null());
            }
        });
        match Catalog::build(&edited, &content) {
            Err(ContentError::Catalog(text)) if text.starts_with(key) => {}
            Err(e) => failures.push(format!("{case}: expected Catalog(\"{key}…\"), got {e}")),
            Ok(_) => failures.push(format!(
                "{case}: expected Catalog(\"{key}…\"), got Ok(catalog)"
            )),
        }
    }
    let unbounded =
        catalog_with(|v| v["economy"]["packs"]["hint_s"]["priceStars"] = json!(100_000));
    if let Err(e) = Catalog::build(&unbounded, &content) {
        failures.push(format!("pack priceStars 100000: expected Ok, got {e}"));
    }
    report(&failures);
}

/// A recent pack order is handed out again only for the same binding (D10): a catalog that changes `hint_s` to 4 at
/// the same price makes a new order bound to 4; the compiled-in catalog then reuses the first order.
#[tokio::test]
async fn invoice_pack_reuse_needs_same_binding() {
    let (st, _db, gateway) = invoice_state(&[(ANN, Some("ru"))]).await;
    let mut failures = Vec::new();
    let Some(first) = order_of(&st, ANN, "pack:hint_s", &mut failures).await else {
        return report(&failures);
    };
    let again = order_of(&st, ANN, "pack:hint_s", &mut failures).await;
    failures.extend(expect_eq(
        "the same catalog: reused",
        again.as_deref(),
        Some(first.as_str()),
    ));

    let four = Catalog::build(
        &catalog_with(|v| v["economy"]["packs"]["hint_s"]["amount"] = json!(4)),
        &st.content,
    )
    .unwrap();
    let changed = st.clone().with_catalog(Arc::new(four));
    let Some(second) = order_of(&changed, ANN, "pack:hint_s", &mut failures).await else {
        return report(&failures);
    };
    if second == first {
        failures.push("hint_s at 4: expected a new order, got the first one".to_owned());
    }
    failures.extend(expect_eq(
        "hint_s at 4: the new row",
        order_binding(&st, &second).await,
        (
            "pack:hint_s".to_owned(),
            1,
            Some("hint".to_owned()),
            Some(4),
        ),
    ));
    let back = order_of(&st, ANN, "pack:hint_s", &mut failures).await;
    failures.extend(expect_eq(
        "the compiled-in catalog again: the first order",
        back.as_deref(),
        Some(first.as_str()),
    ));
    failures.extend(expect_eq(
        "createInvoiceLink calls",
        gateway.invoice_calls().len(),
        2,
    ));
    report(&failures);
}

/// A third player.
const CAT: i64 = 1003;

/// `GET /api/wallet` as `user` (a token issued at `T0`) or without a token: (status, body as JSON).
async fn wallet(st: &AppState, user: Option<i64>) -> (u16, Value) {
    let reply = get(st, user, "/api/wallet").await;
    let body = serde_json::from_slice(&reply.body).unwrap_or(Value::Null);
    (reply.status.as_u16(), body)
}

/// A `WalletResponse` with these `hint` figures and the compiled-in catalog's packs and hint cost.
fn wallet_body(balance: i64, debt: i64) -> Value {
    json!({
        "balances": [{ "kind": "hint", "balance": balance, "debt": debt }],
        "packs": [
            {
                "productId": "pack:hint_s",
                "kind": "hint",
                "amount": 3,
                "priceStars": 1,
                "title": { "ru": "3 подсказки", "en": "3 hints" }
            },
            {
                "productId": "pack:hint_m",
                "kind": "hint",
                "amount": 10,
                "priceStars": 3,
                "title": { "ru": "10 подсказок", "en": "10 hints" }
            }
        ],
        "hintTierCost": 1
    })
}

/// `GET /api/wallet`: every declared kind in declaration order, zero-filled for a new player (D5), a row of a kind
/// the catalog does not declare left out; a debt as the row holds it; the catalog's packs and hint cost. No token is a
/// 401.
#[tokio::test]
async fn wallet_lists_balances_and_packs() {
    let (st, _db) = state_with_users(&[ANN, BEN, CAT]).await;
    let mut failures = Vec::new();
    failures.extend(expect_eq(
        "a new player",
        wallet(&st, Some(ANN)).await,
        (200, wallet_body(0, 0)),
    ));

    let mut c = common::raw_db(&st).await;
    failures.extend(expect_ok("payment c-ben", payment(&mut c, "c-ben", BEN).await).err());
    let (hint, gem) = (hint(), ResourceKind("gem".to_owned()));
    begin(&mut c).await;
    let mut steps = vec![
        step(credit_in_tx(&mut c, &seed(CAT, &hint, 3, "r-cat")).await),
        step(credit_in_tx(&mut c, &seed(CAT, &gem, 5, "r-gem")).await),
    ];
    steps.push(step(
        clawback_in_tx(&mut c, &refund(BEN, &hint, 2, "c-ben")).await,
    ));
    commit(&mut c).await;
    c.close().await.unwrap();
    failures.extend(expect_eq(
        "seeds",
        steps,
        vec![applied(3, 0), applied(5, 0), applied(0, 2)],
    ));
    failures.extend(expect_eq(
        "hint 3 and an undeclared gem row",
        wallet(&st, Some(CAT)).await,
        (200, wallet_body(3, 0)),
    ));
    failures.extend(expect_eq(
        "a debt of 2",
        wallet(&st, Some(BEN)).await,
        (200, wallet_body(0, 2)),
    ));
    failures.extend(expect_eq(
        "no token",
        wallet(&st, None).await,
        (401, json!({ "error": "token_missing" })),
    ));
    report(&failures);
}

/// The wallet is one user's own figures: no shared cache stores it.
#[tokio::test]
async fn wallet_private_no_store() {
    let (st, _db) = state_with_users(&[ANN]).await;
    let reply = get(&st, Some(ANN), "/api/wallet").await;
    let cache = reply
        .headers
        .get(CACHE_CONTROL)
        .and_then(|v| v.to_str().ok());
    let failures: Vec<String> = expect_eq(
        "status, cache-control",
        (reply.status.as_u16(), cache),
        (200, Some("private, no-store")),
    )
    .into_iter()
    .collect();
    report(&failures);
}
