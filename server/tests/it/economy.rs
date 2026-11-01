//! The resource economy (META-PLAN M17-M21): the `0004_economy.sql` constraints on raw SQL, and the ledger and
//! balance primitives of `db/economy.rs` on raw READ COMMITTED connections.
//!
//! Every refused schema case breaks one CHECK, or one whose name sorts before every other it breaks: PostgreSQL tests
//! a table's CHECK constraints in name order, so the constraint a case reports is the one the case is about. Each
//! refused case sits next to a control on the same parent rows, so a red names the constraint, not a missing parent.
//!
//! Balances are seeded through the primitives (a `referral_invitee` credit needs no charge; a debt is a clawback of a
//! raw payment), never by raw balance rows, so every test keeps `balance - debt = SUM(amount)` per (user, kind).

use std::fmt::Debug;
use std::str::FromStr;

use server::catalog::ResourceKind;
use server::db::economy::{
    Applied, Entry, Reason, clawback_in_tx, credit_in_tx, credited_by_charge, debit_in_tx,
};
use server::ids::UserId;
use sqlx::postgres::{PgConnectOptions, PgQueryResult};
use sqlx::{Connection, PgConnection};

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
