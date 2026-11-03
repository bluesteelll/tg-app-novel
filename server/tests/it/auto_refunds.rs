//! The automatic refund of an unapplied charge (owner Q9): its schema (`server/migrations/0007_auto_refunds.sql`)
//! exercised with raw SQL on a connection of its own; the first attempt right after the grant, through the webhook.
//!
//! Every state calls the Bot API through [`RecordingGateway`]: no test reaches Telegram.
//!
//! [`RecordingGateway`]: crate::payments::RecordingGateway

use serde_json::{Value, json};
use server::AppState;
use server::ids::{ChargeId, UserId};
use server::puzzles::Lang;
use server::telegram::gateway::OutMessage;
use server::telegram::texts::{self, LangTexts, fill};
use sqlx::PgConnection;
use sqlx::postgres::PgQueryResult;

use crate::bot::raw_order;
use crate::catalog::{ANN, T0};
use crate::common::{self, TEST_ADMIN_ID};
use crate::payments::GatewayCall;
use crate::refunds::{
    BEN, bought, entitlements_of, expect_eq, order_of, refund_calls, refund_state, refunded_at,
};
use crate::webhook::{order_status, payment_update, post_update};

type Res = Result<PgQueryResult, sqlx::Error>;

fn report(failures: &[String]) {
    assert!(
        failures.is_empty(),
        "{} failures:\n{}",
        failures.len(),
        failures.join("\n")
    );
}

/// The mismatch of `res` against a database error with SQLSTATE `want.0` on the constraint named `want.1`. Never the
/// message text: the server's locale decides it.
fn expect_err(case: &str, res: Res, want: (&str, &str)) -> Option<String> {
    let (code, constraint) = want;
    match res {
        Err(sqlx::Error::Database(e))
            if e.code().as_deref() == Some(code) && e.constraint() == Some(constraint) =>
        {
            None
        }
        Err(sqlx::Error::Database(e)) => Some(format!(
            "case {case}: expected ({code}, {constraint}), got ({}, {}) {e}",
            e.code().as_deref().unwrap_or("no code"),
            e.constraint().unwrap_or("no constraint")
        )),
        Err(e) => Some(format!(
            "case {case}: expected ({code}, {constraint}), got {e}"
        )),
        Ok(_) => Some(format!(
            "case {case}: expected ({code}, {constraint}), got Ok"
        )),
    }
}

/// The mismatch of a control insert against `Ok`.
fn expect_ok(case: &str, res: Res) -> Option<String> {
    res.err()
        .map(|e| format!("case {case} (control): expected Ok, got {e}"))
}

/// A payments row of user 1 for 1 XTR, paid at 0.
async fn payment(c: &mut PgConnection, charge: &str) -> Res {
    sqlx::query(
        "INSERT INTO payments (telegram_payment_charge_id, invoice_payload, user_id, amount, currency, \
         provider_payment_charge_id, paid_at) VALUES ($1, 'payload', 1, 1, 'XTR', '', 0)",
    )
    .bind(charge)
    .execute(&mut *c)
    .await
}

/// An `auto_refunds` row of `charge`, created and due at 0.
async fn work_row(
    c: &mut PgConnection,
    charge: &str,
    attempts: i64,
    refusals: i64,
    last_error: Option<&str>,
) -> Res {
    sqlx::query(
        "INSERT INTO auto_refunds (charge_id, created_at, attempts, refusals, due_at, last_error) \
         VALUES ($1, 0, $2, $3, 0, $4)",
    )
    .bind(charge)
    .bind(attempts)
    .bind(refusals)
    .bind(last_error)
    .execute(&mut *c)
    .await
}

/// An `unrecorded_refunds` row of `charge` refunded to `user`.
async fn unrecorded_row(c: &mut PgConnection, charge: &str, user: i64) -> Res {
    sqlx::query(
        "INSERT INTO unrecorded_refunds (charge_id, user_id, admin_id, refunded_at) VALUES ($1, $2, 9, 0)",
    )
    .bind(charge)
    .bind(user)
    .execute(&mut *c)
    .await
}

/// `0007`'s named constraints, each case violating exactly one beside a control insert that must succeed on the same
/// parent rows: an `auto_refunds` row needs its payment (`auto_refunds_charge_fk`), one per charge
/// (`auto_refunds_pkey`), non-negative attempts (`auto_refunds_attempts_nonneg`, which PostgreSQL tests before the
/// refusals check, by name), at most as many refusals as attempts and none negative
/// (`auto_refunds_refusals_within_attempts`), and an error only after an attempt (`auto_refunds_error_after_attempt`);
/// an `unrecorded_refunds` row names a positive payer (`unrecorded_refunds_user_positive`), one per charge
/// (`unrecorded_refunds_pkey`).
#[tokio::test]
async fn auto_refund_schema_constraints() {
    let (st, _db) = common::test_state().await;
    let mut c = common::raw_db(&st).await;
    let mut failures = Vec::new();
    for charge in ["c-1", "c-2", "c-3", "c-4", "c-5"] {
        failures.extend(expect_ok(
            &format!("payment {charge}"),
            payment(&mut c, charge).await,
        ));
    }
    failures.extend(expect_ok(
        "a pending row",
        work_row(&mut c, "c-1", 0, 0, None).await,
    ));
    failures.extend(expect_err(
        "a row of an unknown charge",
        work_row(&mut c, "c-nope", 0, 0, None).await,
        ("23503", "auto_refunds_charge_fk"),
    ));
    failures.extend(expect_err(
        "a second row of c-1",
        work_row(&mut c, "c-1", 0, 0, None).await,
        ("23505", "auto_refunds_pkey"),
    ));
    failures.extend(expect_err(
        "attempts -1",
        work_row(&mut c, "c-2", -1, 0, None).await,
        ("23514", "auto_refunds_attempts_nonneg"),
    ));
    failures.extend(expect_err(
        "refusals 2 of 1 attempt",
        work_row(&mut c, "c-2", 1, 2, Some("api: x")).await,
        ("23514", "auto_refunds_refusals_within_attempts"),
    ));
    failures.extend(expect_err(
        "refusals -1",
        work_row(&mut c, "c-2", 1, -1, Some("api: x")).await,
        ("23514", "auto_refunds_refusals_within_attempts"),
    ));
    failures.extend(expect_err(
        "an error before any attempt",
        work_row(&mut c, "c-2", 0, 0, Some("timeout")).await,
        ("23514", "auto_refunds_error_after_attempt"),
    ));
    failures.extend(expect_ok(
        "a failed attempt",
        work_row(&mut c, "c-2", 1, 0, Some("timeout")).await,
    ));
    failures.extend(expect_ok(
        "a refused attempt",
        work_row(&mut c, "c-3", 1, 1, Some("api: x")).await,
    ));
    failures.extend(expect_ok(
        "an unrecorded refund",
        unrecorded_row(&mut c, "c-gone", 1001).await,
    ));
    failures.extend(expect_err(
        "an unrecorded refund to user 0",
        unrecorded_row(&mut c, "c-zero", 0).await,
        ("23514", "unrecorded_refunds_user_positive"),
    ));
    failures.extend(expect_err(
        "a second unrecorded refund of c-gone",
        unrecorded_row(&mut c, "c-gone", 1002).await,
        ("23505", "unrecorded_refunds_pkey"),
    ));
    sqlx::Connection::close(c).await.unwrap();
    report(&failures);
}

/// An `auto_refunds` row as (attempts, refusals, due_at, last_error).
pub(crate) type WorkRow = (i64, i64, Option<i64>, Option<String>);

/// The `auto_refunds` row of `charge`, read outside the app pool.
pub(crate) async fn auto_refund_row(st: &AppState, charge: &str) -> Option<WorkRow> {
    let mut c = common::raw_db(st).await;
    let row = sqlx::query_as(
        "SELECT attempts, refusals, due_at, last_error FROM auto_refunds WHERE charge_id = $1",
    )
    .bind(charge)
    .fetch_optional(&mut c)
    .await
    .unwrap();
    sqlx::Connection::close(c).await.unwrap();
    row
}

/// The charges that key an entitlement although their payment is refunded (never any), read outside the app pool.
async fn keyed_to_refunded(st: &AppState) -> Vec<String> {
    let mut c = common::raw_db(st).await;
    let charges = sqlx::query_scalar(
        "SELECT e.charge_id FROM entitlements e \
         JOIN payments p ON p.telegram_payment_charge_id = e.charge_id \
         WHERE p.refunded_at IS NOT NULL ORDER BY e.charge_id",
    )
    .fetch_all(&mut c)
    .await
    .unwrap();
    sqlx::Connection::close(c).await.unwrap();
    charges
}

/// A `successful_payment` update from `payer` with Telegram language `language`.
fn payment_from(payer: i64, language: &str, amount: u32, order: &str, charge: &str) -> Value {
    let mut update = payment_update(payer, "XTR", amount, order, charge, "");
    update["message"]["from"]["language_code"] = json!(language);
    update
}

/// The calls an unapplied payment of `charge` by `payer` makes, in order: the notice to the payer in `t`, the Russian
/// notice to the admin naming `outcome`, then the refund to the payer.
fn unapplied_calls(payer: i64, t: &LangTexts, charge: &str, outcome: &str) -> Vec<GatewayCall> {
    let ru = texts::texts(Lang::Ru);
    let admin = fill(
        &ru.admin_unapplied,
        &[
            ("charge", charge),
            ("payer", &payer.to_string()),
            ("outcome", outcome),
        ],
    );
    vec![
        GatewayCall::Message(OutMessage {
            chat_id: payer,
            text: fill(&t.payment_unapplied, &[("charge", charge)]),
            web_app_button: None,
        }),
        GatewayCall::Message(OutMessage {
            chat_id: TEST_ADMIN_ID,
            text: admin,
            web_app_button: None,
        }),
        GatewayCall::Refund {
            user: UserId(payer),
            charge: ChargeId(charge.to_owned()),
        },
    ]
}

/// Owner Q9 through the webhook at `T0`: every unapplied outcome is refunded to its payer within its own update, once.
/// `AlreadyEntitled` (ANN pays a raw second order of the chapter she owns through `c-first`), `OrderMismatch` (BEN pays
/// his order at its amount + 1) and `UnknownProduct` (BEN's order whose product id no grammar knows) each answer 200
/// after exactly the payer's notice in their language, the admin's Russian notice, then `refundStarPayment` to the
/// payer; the payment is revoked at `T0` (its order `refunded`, or untouched when it matched none) and its row settled
/// after one attempt. The applied payment makes no refund and has no row. Each update redelivered answers 200 and
/// makes no call; ANN keeps ch2 on `c-first`; no entitlement is keyed to a refunded charge.
#[tokio::test]
async fn auto_refund_unapplied_outcomes_refunded_once() {
    let (st, _db, gateway) = refund_state().await;
    let mut failures = Vec::new();
    if bought(&st, ANN, "chapter:ch2", "c-first", &mut failures)
        .await
        .is_none()
    {
        return report(&failures);
    }
    let second = "o_0123456789abcdef0123456789abcdef";
    raw_order(&st, second, ANN, "chapter:ch2").await;
    let Some((wrong, wrong_amount)) = order_of(&st, BEN, "chapter:ch4", &mut failures).await else {
        return report(&failures);
    };
    let Some((retired, retired_amount)) = order_of(&st, BEN, "chapter:ch2", &mut failures).await
    else {
        return report(&failures);
    };
    let mut c = common::raw_db(&st).await;
    sqlx::query("UPDATE orders SET product_id = 'retired:hint_s' WHERE id = $1")
        .bind(&retired)
        .execute(&mut c)
        .await
        .unwrap();
    sqlx::Connection::close(c).await.unwrap();
    failures.extend(expect_eq(
        "applied c-first: refundStarPayment calls",
        refund_calls(&gateway),
        Vec::new(),
    ));
    failures.extend(expect_eq(
        "applied c-first: auto_refunds row",
        auto_refund_row(&st, "c-first").await,
        None,
    ));
    let ru = texts::texts(Lang::Ru);
    let en = texts::texts(Lang::En);
    for (case, update, charge, calls, order, status) in [
        (
            "already entitled",
            payment_from(ANN, "ru", 1, second, "c-second"),
            "c-second",
            unapplied_calls(ANN, ru, "c-second", "AlreadyEntitled"),
            second.to_owned(),
            "refunded",
        ),
        (
            "order mismatch",
            payment_from(BEN, "en", wrong_amount + 1, &wrong, "c-wrong"),
            "c-wrong",
            unapplied_calls(BEN, en, "c-wrong", "OrderMismatch"),
            wrong.clone(),
            "created",
        ),
        (
            "unknown product",
            payment_from(BEN, "en", retired_amount, &retired, "c-retired"),
            "c-retired",
            unapplied_calls(BEN, en, "c-retired", "UnknownProduct"),
            retired.clone(),
            "refunded",
        ),
    ] {
        let before = gateway.calls().len();
        let status_code = post_update(&st, &update).await.status.as_u16();
        let got = gateway.calls().split_off(before);
        failures.extend(expect_eq(
            &format!("{case}: (status, gateway calls)"),
            (status_code, got),
            (200, calls),
        ));
        failures.extend(expect_eq(
            &format!("{case}: refunded_at"),
            refunded_at(&st, charge).await,
            Some(T0),
        ));
        failures.extend(expect_eq(
            &format!("{case}: order status"),
            order_status(&st, &order).await,
            status.to_owned(),
        ));
        failures.extend(expect_eq(
            &format!("{case}: auto_refunds row (attempts, refusals, due_at, last_error)"),
            auto_refund_row(&st, charge).await,
            Some((1, 0, None, None)),
        ));
        let before = gateway.calls().len();
        let status_code = post_update(&st, &update).await.status.as_u16();
        let got = gateway.calls().split_off(before);
        failures.extend(expect_eq(
            &format!("{case} redelivered: (status, gateway calls)"),
            (status_code, got),
            (200, Vec::new()),
        ));
        failures.extend(expect_eq(
            &format!("{case} redelivered: auto_refunds row"),
            auto_refund_row(&st, charge).await,
            Some((1, 0, None, None)),
        ));
    }
    failures.extend(expect_eq(
        "entitlements of c-first",
        entitlements_of(&st, "c-first").await,
        1,
    ));
    failures.extend(expect_eq(
        "entitlements keyed to a refunded charge",
        keyed_to_refunded(&st).await,
        Vec::<String>::new(),
    ));
    report(&failures);
}
