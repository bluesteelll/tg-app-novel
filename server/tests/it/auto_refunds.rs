//! The automatic refund of an unapplied charge (owner Q9): its schema (`server/migrations/0007_auto_refunds.sql`)
//! exercised with raw SQL on a connection of its own; the first attempt right after the grant, through the webhook;
//! the sweep's retries with their backoff and bound, the claim that arbitrates between attempts, and the refunds on
//! other paths that settle a pending row.
//!
//! Every state calls the Bot API through [`RecordingGateway`]: no test reaches Telegram.
//!
//! [`RecordingGateway`]: crate::payments::RecordingGateway

use std::time::{Duration, Instant};

use serde_json::{Value, json};
use server::AppState;
use server::ids::{ChargeId, UserId};
use server::puzzles::Lang;
use server::telegram::gateway::{GatewayError, OutMessage};
use server::telegram::payments::{SweepTally, sweep_auto_refunds};
use server::telegram::texts::{self, LangTexts, fill};
use sqlx::PgConnection;
use sqlx::postgres::PgQueryResult;

use crate::bot::{messages, raw_order, say};
use crate::catalog::{ANN, T0};
use crate::common::{self, TEST_ADMIN_ID};
use crate::payments::{GatewayCall, RecordingGateway};
use crate::refunds::{
    BEN, at, bought, entitlements_of, expect_eq, order_of, refund_calls, refund_state,
    refund_update, refunded_at,
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

/// A refusal the tests' gateway answers `refundStarPayment` with.
fn refused() -> GatewayError {
    GatewayError::Api("Bad Request: REFUND_TEST".to_owned())
}

/// An unapplied payment of 1 XTR by ANN (Russian) at `t` whose payload names no order (`OrderMismatch`), with charge
/// `charge`, through the webhook; a non-200 answer is a failure line.
async fn unapplied_at(st: &AppState, t: i64, charge: &str, failures: &mut Vec<String>) {
    let update = payment_from(ANN, "ru", 1, "o_00000000000000000000000000000001", charge);
    let status = post_update(&at(st, t), &update).await.status.as_u16();
    if status != 200 {
        failures.push(format!("payment {charge}: expected 200, got {status}"));
    }
}

/// One sweep pass at `t`; a database error as its text.
async fn sweep_at(st: &AppState, t: i64) -> Result<SweepTally, String> {
    sweep_auto_refunds(&at(st, t))
        .await
        .map_err(|e| e.to_string())
}

/// A tally of `attempted` attempts, `refunded` of them refunded, `failed` failed, `given_up` given up.
fn tally(attempted: u32, refunded: u32, failed: u32, given_up: u32) -> Result<SweepTally, String> {
    Ok(SweepTally {
        attempted,
        refunded,
        failed,
        given_up,
    })
}

/// The `refundStarPayment` calls of `charge` so far.
fn refunds_of(gateway: &RecordingGateway, charge: &str) -> usize {
    refund_calls(gateway)
        .iter()
        .filter(|(_, c)| c == charge)
        .count()
}

/// A failed first attempt is retried by the sweep after the backoff, and the bound counts refusals only: `c-retry`'s
/// first attempt times out (200, the payer told, row `(1, 0, T0+60, "timeout")`, not refunded); a sweep at `T0+59`
/// attempts nothing; at `T0+60` it is refused (`(2, 1, T0+180, "api: …")`); at `T0+180` the gateway answers and the
/// charge is refunded and revoked at `T0+180` (`due_at` NULL); a sweep a day later attempts nothing. Three refund
/// calls in all.
#[tokio::test]
async fn auto_refund_failure_retried_with_backoff() {
    let (st, _db, gateway) = refund_state().await;
    let mut failures = Vec::new();
    gateway.fail_refunds_with(Some(GatewayError::Timeout));
    unapplied_at(&st, T0, "c-retry", &mut failures).await;
    failures.extend(expect_eq(
        "after the timed-out first attempt: messages to ANN",
        messages(&gateway)
            .iter()
            .filter(|msg| msg.chat_id == ANN)
            .count(),
        1,
    ));
    failures.extend(expect_eq(
        "after the timed-out first attempt: row",
        auto_refund_row(&st, "c-retry").await,
        Some((1, 0, Some(T0 + 60), Some("timeout".to_owned()))),
    ));
    failures.extend(expect_eq(
        "after the timed-out first attempt: refunded_at",
        refunded_at(&st, "c-retry").await,
        None,
    ));
    failures.extend(expect_eq(
        "sweep at T0+59",
        sweep_at(&st, T0 + 59).await,
        tally(0, 0, 0, 0),
    ));
    gateway.fail_refunds_with(Some(refused()));
    failures.extend(expect_eq(
        "sweep at T0+60",
        sweep_at(&st, T0 + 60).await,
        tally(1, 0, 1, 0),
    ));
    failures.extend(expect_eq(
        "after the refused second attempt: row",
        auto_refund_row(&st, "c-retry").await,
        Some((
            2,
            1,
            Some(T0 + 180),
            Some("api: Bad Request: REFUND_TEST".to_owned()),
        )),
    ));
    gateway.fail_refunds_with(None);
    failures.extend(expect_eq(
        "sweep at T0+180",
        sweep_at(&st, T0 + 180).await,
        tally(1, 1, 0, 0),
    ));
    failures.extend(expect_eq(
        "after the third attempt: (refunded_at, due_at)",
        (
            refunded_at(&st, "c-retry").await,
            auto_refund_row(&st, "c-retry").await.and_then(|row| row.2),
        ),
        (Some(T0 + 180), None),
    ));
    failures.extend(expect_eq(
        "sweep a day later",
        sweep_at(&st, T0 + 86_400).await,
        tally(0, 0, 0, 0),
    ));
    failures.extend(expect_eq(
        "refundStarPayment calls of c-retry",
        refunds_of(&gateway, "c-retry"),
        3,
    ));
    report(&failures);
}

/// Sweeps `charge` at each `due_at` it reads back, at most `passes` times or until the row is no longer due: the
/// times of the attempts made, in order.
async fn sweep_until_settled(st: &AppState, charge: &str, passes: usize) -> Vec<i64> {
    let mut times = Vec::new();
    for _ in 0..passes {
        let Some((_, _, Some(due), _)) = auto_refund_row(st, charge).await else {
            break;
        };
        // A failed pass is seen in the row afterwards; the tally is the other tests' concern.
        let _ = sweep_at(st, due).await;
        times.push(due);
    }
    times
}

/// The bound counts refusals, and only the attempt that reaches it alerts the admins. `c-refused`: every attempt
/// refused; the sweeps at each read-back `due_at` attempt it seven more times, at `T0+60` … `T0+7380` (the backoff),
/// and after the eighth the row is given up (`due_at` NULL, 8 attempts, 8 refusals), not refunded, with exactly one
/// `admin_auto_refund_failed` to the admin (8 attempts, the last error) and no second message to the payer; a sweep a
/// day later attempts nothing, and the admin's `/refund` then revokes it. `c-transient` (critique W2): every attempt
/// breaks off in transport; twelve attempts later it is still due, its waits capped at an hour, no refusal counted,
/// no alert; once the gateway answers, the sweep refunds it.
#[tokio::test]
async fn auto_refund_bound_alerts_admins() {
    let (st, _db, gateway) = refund_state().await;
    let mut failures = Vec::new();
    let ru = texts::texts(Lang::Ru);
    gateway.fail_refunds_with(Some(refused()));
    unapplied_at(&st, T0, "c-refused", &mut failures).await;
    let times = sweep_until_settled(&st, "c-refused", 20).await;
    let want: Vec<i64> = [60, 180, 420, 900, 1860, 3780, 7380]
        .iter()
        .map(|d| T0 + d)
        .collect();
    failures.extend(expect_eq("c-refused: the sweeps' times", times, want));
    failures.extend(expect_eq(
        "c-refused after 8 refusals: (attempts, refusals, due_at)",
        auto_refund_row(&st, "c-refused")
            .await
            .map(|(attempts, refusals, due, _)| (attempts, refusals, due)),
        Some((8, 8, None)),
    ));
    failures.extend(expect_eq(
        "c-refused after 8 refusals: refunded_at",
        refunded_at(&st, "c-refused").await,
        None,
    ));
    let alert = fill(
        &ru.admin_auto_refund_failed,
        &[
            ("charge", "c-refused"),
            ("payer", &ANN.to_string()),
            ("attempts", "8"),
            ("error", "api: Bad Request: REFUND_TEST"),
        ],
    );
    let sent = messages(&gateway);
    failures.extend(expect_eq(
        "c-refused: alerts to the admin",
        sent.iter()
            .filter(|msg| msg.chat_id == TEST_ADMIN_ID && msg.text == alert)
            .count(),
        1,
    ));
    failures.extend(expect_eq(
        "c-refused: messages to the payer",
        sent.iter().filter(|msg| msg.chat_id == ANN).count(),
        1,
    ));
    failures.extend(expect_eq(
        "a sweep a day later",
        sweep_at(&st, T0 + 86_400).await,
        tally(0, 0, 0, 0),
    ));
    gateway.fail_refunds_with(None);
    let (status, sent) = say(
        &st,
        &gateway,
        TEST_ADMIN_ID,
        Some("ru"),
        "/refund c-refused",
    )
    .await;
    let done = fill(&ru.refund_done, &[("charge", "c-refused")]);
    failures.extend(expect_eq(
        "the admin's /refund c-refused",
        (status, sent.into_iter().map(|msg| msg.text).collect()),
        (200, vec![done]),
    ));
    failures.extend(expect_eq(
        "c-refused after the admin's refund: refunded_at",
        refunded_at(&st, "c-refused").await,
        Some(T0),
    ));

    let t1 = T0 + 2 * 86_400;
    gateway.fail_refunds_with(Some(GatewayError::Transport("connection reset".to_owned())));
    unapplied_at(&st, t1, "c-transient", &mut failures).await;
    let times = sweep_until_settled(&st, "c-transient", 11).await;
    let want: Vec<i64> = [
        60, 180, 420, 900, 1860, 3780, 7380, 10_980, 14_580, 18_180, 21_780,
    ]
    .iter()
    .map(|d| t1 + d)
    .collect();
    failures.extend(expect_eq("c-transient: the sweeps' times", times, want));
    failures.extend(expect_eq(
        "c-transient after 12 transport failures: row",
        auto_refund_row(&st, "c-transient").await,
        Some((
            12,
            0,
            Some(t1 + 25_380),
            Some("transport: connection reset".to_owned()),
        )),
    ));
    let alerts = messages(&gateway)
        .iter()
        .filter(|msg| msg.chat_id == TEST_ADMIN_ID && msg.text.contains("c-transient"))
        .count();
    failures.extend(expect_eq(
        "c-transient: messages to the admin (the unapplied notice only)",
        alerts,
        1,
    ));
    gateway.fail_refunds_with(None);
    failures.extend(expect_eq(
        "c-transient: the sweep once the gateway answers",
        sweep_at(&st, t1 + 25_380).await,
        tally(1, 1, 0, 0),
    ));
    failures.extend(expect_eq(
        "c-transient: refunded_at",
        refunded_at(&st, "c-transient").await,
        Some(t1 + 25_380),
    ));
    report(&failures);
}

/// Two claims of one due row at once attempt it once: `c-claim` is due at `T0+60` after a refused first attempt; a raw
/// READ COMMITTED transaction plays a competing claim (its guarded `UPDATE`, `due_at` moved to `T0+660`) and holds
/// it; the app's sweep at `T0+60` is seen waiting on the row, then the raw claim commits. The sweep re-checks the
/// committed row, finds it no longer due and attempts nothing: no `refundStarPayment` was made while the claim was
/// held or after.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn auto_refund_claim_exactly_once() {
    let (st, _db, gateway) = refund_state().await;
    let mut failures = Vec::new();
    gateway.fail_refunds_with(Some(refused()));
    unapplied_at(&st, T0, "c-claim", &mut failures).await;
    gateway.fail_refunds_with(None);
    failures.extend(expect_eq(
        "setup: c-claim's due_at",
        auto_refund_row(&st, "c-claim").await.and_then(|row| row.2),
        Some(T0 + 60),
    ));
    let before = refunds_of(&gateway, "c-claim");
    let mut a = common::raw_db(&st).await;
    sqlx::raw_sql("BEGIN ISOLATION LEVEL READ COMMITTED")
        .execute(&mut a)
        .await
        .unwrap();
    sqlx::query(
        "UPDATE auto_refunds SET due_at = $2, attempts = attempts + 1 \
         WHERE charge_id = 'c-claim' AND due_at <= $1",
    )
    .bind(T0 + 60)
    .bind(T0 + 660)
    .execute(&mut a)
    .await
    .unwrap();
    let app = st.clone();
    let mut sweep = tokio::spawn(async move { sweep_at(&app, T0 + 60).await });
    let early = tokio::select! {
        biased;
        got = &mut sweep => Some(got.unwrap()),
        () = common::wait_for_lock_waiter(&st) => None,
    };
    if early.is_some() {
        failures.push("the sweep never waited on the held auto-refund row".to_owned());
    }
    failures.extend(expect_eq(
        "refundStarPayment calls during the held claim",
        refunds_of(&gateway, "c-claim") - before,
        0,
    ));
    sqlx::raw_sql("COMMIT").execute(&mut a).await.unwrap();
    sqlx::Connection::close(a).await.unwrap();
    let got = match early {
        Some(got) => got,
        None => sweep.await.unwrap(),
    };
    failures.extend(expect_eq("the waiting sweep", got, tally(0, 0, 0, 0)));
    failures.extend(expect_eq(
        "refundStarPayment calls after the claim committed",
        refunds_of(&gateway, "c-claim") - before,
        0,
    ));
    report(&failures);
}

/// A refund call that never answers is cut at the deadline: `c-hung`'s webhook answers 200 after 5.0 s <= t < 7.5 s
/// (real time), the payer's and the admin's notices sent before the refund call, its row `(1, 0, T0+60, "timeout")`;
/// the sweep at `T0+60`, with the gateway answering, refunds and revokes it once.
#[tokio::test]
async fn auto_refund_hung_call_cut_at_deadline() {
    let (st, _db, gateway) = refund_state().await;
    let mut failures = Vec::new();
    gateway.hang_refunds(true);
    let update = payment_from(ANN, "ru", 1, "o_00000000000000000000000000000001", "c-hung");
    let started = Instant::now();
    let reply = tokio::time::timeout(Duration::from_secs(9), post_update(&st, &update)).await;
    let elapsed = started.elapsed().as_secs_f64();
    match reply {
        Err(_) => failures.push("no answer within 9 s".to_owned()),
        Ok(reply) => {
            if reply.status.as_u16() != 200 {
                failures.push(format!(
                    "status: expected 200, got {}",
                    reply.status.as_u16()
                ));
            }
            if !(5.0..7.5).contains(&elapsed) {
                failures.push(format!(
                    "elapsed: expected 5.0 s <= t < 7.5 s, got {elapsed:.2} s"
                ));
            }
        }
    }
    let ru = texts::texts(Lang::Ru);
    failures.extend(expect_eq(
        "the calls",
        gateway.calls(),
        unapplied_calls(ANN, ru, "c-hung", "OrderMismatch"),
    ));
    failures.extend(expect_eq(
        "after the cut: row",
        auto_refund_row(&st, "c-hung").await,
        Some((1, 0, Some(T0 + 60), Some("timeout".to_owned()))),
    ));
    gateway.hang_refunds(false);
    failures.extend(expect_eq(
        "sweep at T0+60",
        sweep_at(&st, T0 + 60).await,
        tally(1, 1, 0, 0),
    ));
    failures.extend(expect_eq(
        "sweep at T0+60: refundStarPayment calls",
        refunds_of(&gateway, "c-hung"),
        2,
    ));
    failures.extend(expect_eq(
        "sweep at T0+60: refunded_at",
        refunded_at(&st, "c-hung").await,
        Some(T0 + 60),
    ));
    report(&failures);
}

/// A crash between the Bot API call and the database write ends with one refund and one revoke. (i) A lost answer:
/// Telegram refunds `c-lost` (ANN's raw second order of the chapter she owns: `AlreadyEntitled`) but the answer is a
/// timeout, so the row stays pending; the sweep at `T0+60` meets `CHARGE_ALREADY_REFUNDED` and revokes once
/// (`refunded_at` `T0+60`, the order `refunded`, the row settled), and Telegram refunded once. (ii) A process that
/// died after its claim: `c-crash`'s refund call hangs and its webhook future is dropped at 1 s, so the claim
/// committed and no failure was written: row `(1, 0, T0+60, NULL)`, the lease. A sweep at `T0+59` attempts nothing;
/// at `T0+60`, with the gateway answering, it refunds and revokes once.
#[tokio::test]
async fn auto_refund_lost_answer_or_crash_revokes_once() {
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
    gateway.telegram_refunds(true);
    gateway.lose_refund_answers(true);
    let status = post_update(&st, &payment_from(ANN, "ru", 1, second, "c-lost"))
        .await
        .status
        .as_u16();
    gateway.lose_refund_answers(false);
    failures.extend(expect_eq(
        "(i) the payment with the answer lost: (status, row, refunded_at)",
        (
            status,
            auto_refund_row(&st, "c-lost").await,
            refunded_at(&st, "c-lost").await,
        ),
        (
            200,
            Some((1, 0, Some(T0 + 60), Some("timeout".to_owned()))),
            None,
        ),
    ));
    failures.extend(expect_eq(
        "(i) sweep at T0+60",
        sweep_at(&st, T0 + 60).await,
        tally(1, 1, 0, 0),
    ));
    failures.extend(expect_eq(
        "(i) after the sweep: (refunded_at, order status, due_at)",
        (
            refunded_at(&st, "c-lost").await,
            order_status(&st, second).await,
            auto_refund_row(&st, "c-lost").await.and_then(|row| row.2),
        ),
        (Some(T0 + 60), "refunded".to_owned(), None),
    ));
    failures.extend(expect_eq(
        "(i) entitlements of c-first",
        entitlements_of(&st, "c-first").await,
        1,
    ));

    gateway.hang_refunds(true);
    let update = payment_from(
        ANN,
        "ru",
        1,
        "o_00000000000000000000000000000001",
        "c-crash",
    );
    let dropped = tokio::time::timeout(Duration::from_secs(1), post_update(&st, &update)).await;
    if dropped.is_ok() {
        failures
            .push("(ii) the webhook answered within 1 s although its refund call hangs".to_owned());
    }
    gateway.hang_refunds(false);
    failures.extend(expect_eq(
        "(ii) after the drop: row",
        auto_refund_row(&st, "c-crash").await,
        Some((1, 0, Some(T0 + 60), None)),
    ));
    failures.extend(expect_eq(
        "(ii) sweep at T0+59",
        sweep_at(&st, T0 + 59).await,
        tally(0, 0, 0, 0),
    ));
    failures.extend(expect_eq(
        "(ii) sweep at T0+60",
        sweep_at(&st, T0 + 60).await,
        tally(1, 1, 0, 0),
    ));
    failures.extend(expect_eq(
        "(ii) refunded_at",
        refunded_at(&st, "c-crash").await,
        Some(T0 + 60),
    ));
    let at_telegram: Vec<String> = gateway
        .telegram_refunded()
        .into_iter()
        .map(|charge| charge.0)
        .collect();
    failures.extend(expect_eq(
        "the charges Telegram refunded",
        at_telegram,
        vec!["c-lost".to_owned(), "c-crash".to_owned()],
    ));
    report(&failures);
}

/// A refund on another path settles a pending row, so the sweep never calls for it again. With Telegram refunding
/// each charge once: (i) `c-lost`, pending after a lost answer (Telegram refunded it), is refunded by the admin's
/// `/refund`, which meets `CHARGE_ALREADY_REFUNDED`, revokes and answers `refund_done`; (ii) `c-telegram`, pending
/// after a refusal, is revoked by Telegram's `refunded_payment` through the webhook; (iii) `c-settled`, refunded
/// automatically at its payment, gets `refund_already` from the admin's `/refund` with no call. Each row is settled.
/// Control: `c-control`, refused at its payment, is due at the same `T0+60`; one sweep pass at `T0+60` refunds only
/// it.
#[tokio::test]
async fn auto_refund_settled_by_admin_or_telegram_refund() {
    let (st, _db, gateway) = refund_state().await;
    let mut failures = Vec::new();
    let ru = texts::texts(Lang::Ru);
    gateway.telegram_refunds(true);
    gateway.lose_refund_answers(true);
    unapplied_at(&st, T0, "c-lost", &mut failures).await;
    gateway.lose_refund_answers(false);
    gateway.fail_refunds_with(Some(refused()));
    unapplied_at(&st, T0, "c-telegram", &mut failures).await;
    unapplied_at(&st, T0, "c-control", &mut failures).await;
    gateway.fail_refunds_with(None);
    unapplied_at(&st, T0, "c-settled", &mut failures).await;
    for (charge, want) in [
        ("c-lost", Some(T0 + 60)),
        ("c-telegram", Some(T0 + 60)),
        ("c-control", Some(T0 + 60)),
        ("c-settled", None),
    ] {
        failures.extend(expect_eq(
            &format!("setup: {charge}'s due_at"),
            auto_refund_row(&st, charge).await.and_then(|row| row.2),
            want,
        ));
    }

    let (status, sent) = say(&st, &gateway, TEST_ADMIN_ID, Some("ru"), "/refund c-lost").await;
    failures.extend(expect_eq(
        "(i) the admin's /refund c-lost",
        (status, sent.into_iter().map(|msg| msg.text).collect()),
        (200, vec![fill(&ru.refund_done, &[("charge", "c-lost")])]),
    ));
    let status = post_update(&st, &refund_update(ANN, 1, "o-x", "c-telegram"))
        .await
        .status
        .as_u16();
    failures.extend(expect_eq("(ii) refunded_payment: status", status, 200));
    let before = refund_calls(&gateway).len();
    let (status, sent) = say(
        &st,
        &gateway,
        TEST_ADMIN_ID,
        Some("ru"),
        "/refund c-settled",
    )
    .await;
    failures.extend(expect_eq(
        "(iii) the admin's /refund c-settled",
        (status, sent.into_iter().map(|msg| msg.text).collect()),
        (
            200,
            vec![fill(&ru.refund_already, &[("charge", "c-settled")])],
        ),
    ));
    failures.extend(expect_eq(
        "(iii) refundStarPayment calls",
        refund_calls(&gateway).len() - before,
        0,
    ));
    for charge in ["c-lost", "c-telegram", "c-settled"] {
        failures.extend(expect_eq(
            &format!("{charge}: (refunded, due_at)"),
            (
                refunded_at(&st, charge).await.is_some(),
                auto_refund_row(&st, charge).await.and_then(|row| row.2),
            ),
            (true, None),
        ));
    }

    let before = refund_calls(&gateway).len();
    failures.extend(expect_eq(
        "the sweep at T0+60",
        sweep_at(&st, T0 + 60).await,
        tally(1, 1, 0, 0),
    ));
    failures.extend(expect_eq(
        "the sweep's refundStarPayment calls",
        refund_calls(&gateway).split_off(before),
        vec![(ANN, "c-control".to_owned())],
    ));
    failures.extend(expect_eq(
        "control: refunded_at",
        refunded_at(&st, "c-control").await,
        Some(T0 + 60),
    ));
    report(&failures);
}
