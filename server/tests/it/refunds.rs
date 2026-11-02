//! Refunds (K20, META-PLAN M20): the revoke keyed on the charge, once per charge whichever path asks for it. A
//! chapter's entitlement is deleted, its order `refunded` and its paid content 403 again, unless another unrefunded
//! charge of the payer paid for it: then the entitlement is re-keyed to the oldest such charge (RULINGS 96). A pack's
//! credit (its `pay:<charge>` ledger row, never the catalog) is clawed back from the payer's balance, the spent part
//! recorded as debt, a gift recipient untouched. The pre-checkout of a refunded or paid order stays refused `Expired`.
//!
//! Every state calls the Bot API through [`RecordingGateway`]: no test reaches Telegram.

use std::fmt::Debug;
use std::sync::Arc;

use serde_json::{Value, json};
use server::AppState;
use server::catalog::{GiftRules, ResourceKind};
use server::clock::FixedClock;
use server::db::economy::GiftMove;
use server::ids::{ChargeId, PuzzleId, UserId};
use server::puzzles::Lang;
use server::telegram::commands::utc_date;
use server::telegram::gateway::GatewayError;
use server::telegram::payments::{RefundError, RejectReason, RevokeOutcome, admin_refund, revoke};
use server::telegram::texts::{self, fill};
use sqlx::Connection;

use crate::bot::{charge_lines, raw_order, say};
use crate::catalog::{ANN, T0, get, own};
use crate::common;
use crate::payments::{GatewayCall, RecordingGateway, invoice_state, owned, post_invoice, refusal};
use crate::webhook::{order_status, payment_update, post_update, pre_checkout_update};

/// A second player.
pub(crate) const BEN: i64 = 1002;

/// Ten minutes after `T0`: when the refunds of these tests happen.
pub(crate) const T1: i64 = T0 + 600;

fn report(failures: &[String]) {
    assert!(
        failures.is_empty(),
        "{} failures:\n{}",
        failures.len(),
        failures.join("\n")
    );
}

/// The mismatch of `got` against `want`.
pub(crate) fn expect_eq<T: PartialEq + Debug>(case: &str, got: T, want: T) -> Option<String> {
    (got != want).then(|| format!("{case}: expected {want:?}, got {got:?}"))
}

/// `st` reading the time `t`.
pub(crate) fn at(st: &AppState, t: i64) -> AppState {
    st.clone().with_clock(Arc::new(FixedClock(t)))
}

/// A state at `T0` with `ANN` (Russian) and `BEN` (English), calling the Bot API through a fresh recorder.
pub(crate) async fn refund_state() -> (AppState, common::TestDb, Arc<RecordingGateway>) {
    invoice_state(&[(ANN, Some("ru")), (BEN, Some("en"))]).await
}

/// The revoke of `charge` on `st` at `t`; a database error as its text.
pub(crate) async fn revoke_at(
    st: &AppState,
    t: i64,
    charge: &str,
) -> Result<RevokeOutcome, String> {
    revoke(&at(st, t), &ChargeId(charge.to_owned()))
        .await
        .map_err(|e| e.to_string())
}

/// A new order of `product` for `user` through `POST /api/invoices` at the state's clock: its id and amount. A
/// refusal is a failure line and `None`.
pub(crate) async fn order_of(
    st: &AppState,
    user: i64,
    product: &str,
    failures: &mut Vec<String>,
) -> Option<(String, u32)> {
    let reply = post_invoice(st, Some(user), &json!({ "productId": product }).to_string()).await;
    let body: Value = serde_json::from_slice(&reply.body).unwrap_or(Value::Null);
    let Some(order) = body["orderId"]
        .as_str()
        .filter(|_| reply.status.as_u16() == 200)
    else {
        failures.push(format!(
            "POST /api/invoices {product} for {user}: expected 200 with an orderId, got {} {}",
            reply.status.as_u16(),
            String::from_utf8_lossy(&reply.body)
        ));
        return None;
    };
    let mut c = common::raw_db(st).await;
    let amount: i64 = sqlx::query_scalar("SELECT amount FROM orders WHERE id = $1")
        .bind(order)
        .fetch_one(&mut c)
        .await
        .unwrap();
    c.close().await.unwrap();
    Some((order.to_owned(), u32::try_from(amount).unwrap()))
}

/// A `successful_payment` from `user` of `amount` XTR for `order` with charge `charge`, through the webhook; a
/// non-200 answer is a failure line.
pub(crate) async fn pay(
    st: &AppState,
    user: i64,
    amount: u32,
    order: &str,
    charge: &str,
    failures: &mut Vec<String>,
) {
    let reply = post_update(st, &payment_update(user, "XTR", amount, order, charge, "")).await;
    if reply.status.as_u16() != 200 {
        failures.push(format!(
            "payment {charge}: expected 200, got {}",
            reply.status.as_u16()
        ));
    }
}

/// `product` ordered and paid by `user` with charge `charge` through the webhook: the order id.
pub(crate) async fn bought(
    st: &AppState,
    user: i64,
    product: &str,
    charge: &str,
    failures: &mut Vec<String>,
) -> Option<String> {
    let (order, amount) = order_of(st, user, product, failures).await?;
    pay(st, user, amount, &order, charge, failures).await;
    Some(order)
}

/// One `count(*)`-shaped scalar of `sql` with `charge` bound as `$1`, read outside the app pool.
async fn count_of(st: &AppState, sql: &'static str, charge: &str) -> i64 {
    let mut c = common::raw_db(st).await;
    let n = sqlx::query_scalar(sql)
        .bind(charge)
        .fetch_one(&mut c)
        .await
        .unwrap();
    c.close().await.unwrap();
    n
}

/// The entitlements rows of `charge`.
pub(crate) async fn entitlements_of(st: &AppState, charge: &str) -> i64 {
    count_of(
        st,
        "SELECT count(*) FROM entitlements WHERE charge_id = $1",
        charge,
    )
    .await
}

/// The `refunded_at` of payment `charge`, read outside the app pool (a missing row panics).
pub(crate) async fn refunded_at(st: &AppState, charge: &str) -> Option<i64> {
    let mut c = common::raw_db(st).await;
    let at = sqlx::query_scalar(
        "SELECT refunded_at FROM payments WHERE telegram_payment_charge_id = $1",
    )
    .bind(charge)
    .fetch_one(&mut c)
    .await
    .unwrap();
    c.close().await.unwrap();
    at
}

/// `user`'s `hint` row as (balance, debt), `(0, 0)` without one; read outside the app pool.
pub(crate) async fn hint_of(st: &AppState, user: i64) -> (i64, i64) {
    let mut c = common::raw_db(st).await;
    let row: Option<(i64, i64)> = sqlx::query_as(
        "SELECT balance, debt FROM resource_balances WHERE user_id = $1 AND kind = 'hint'",
    )
    .bind(user)
    .fetch_optional(&mut c)
    .await
    .unwrap();
    c.close().await.unwrap();
    row.unwrap_or((0, 0))
}

/// A ledger row as (key, amount, reason).
pub(crate) type LedgerRow = (String, i64, String);

/// `user`'s ledger rows, in insertion order.
pub(crate) async fn ledger_of(st: &AppState, user: i64) -> Vec<LedgerRow> {
    let mut c = common::raw_db(st).await;
    let rows = sqlx::query_as(
        "SELECT idem_key, amount, reason FROM resource_ledger WHERE user_id = $1 ORDER BY id",
    )
    .bind(user)
    .fetch_all(&mut c)
    .await
    .unwrap();
    c.close().await.unwrap();
    rows
}

/// The `refund:<charge>` ledger rows.
pub(crate) async fn refund_rows(st: &AppState, charge: &str) -> i64 {
    count_of(
        st,
        "SELECT count(*) FROM resource_ledger WHERE idem_key = 'refund:' || $1",
        charge,
    )
    .await
}

/// The (balance, debt) mismatch lines of `user`'s hint row against `want`, one per field.
async fn expect_hint(case: &str, st: &AppState, user: i64, want: (i64, i64)) -> Vec<String> {
    let (balance, debt) = hint_of(st, user).await;
    let mut lines = Vec::new();
    lines.extend(expect_eq(&format!("{case}: hint balance"), balance, want.0));
    lines.extend(expect_eq(&format!("{case}: hint debt"), debt, want.1));
    lines
}

/// The status of `order` through `GET /api/orders/{order}` as `user` (a token issued at `T0`).
async fn api_order_status(st: &AppState, user: i64, order: &str) -> Option<String> {
    let reply = get(st, Some(user), &format!("/api/orders/{order}")).await;
    let body: Value = serde_json::from_slice(&reply.body).unwrap_or(Value::Null);
    body["status"].as_str().map(str::to_owned)
}

/// A raw `chapter_started` statistics row of `user`: history a refund must leave alone (ST4).
async fn stat_row(st: &AppState, user: i64) {
    let mut c = common::raw_db(st).await;
    sqlx::query(
        "INSERT INTO stat_events (user_id, event_id, kind, story_id, chapter_id, subject, outcome, story_version, \
         age_ms, received_at) VALUES ($1, '0f8c3d2a-6b1e-4c7d-9a2b-3c4d5e6f7a8b', 'chapter_started', 'manor', \
         'ch2', NULL, NULL, '0123456789abcdef', 0, $2)",
    )
    .bind(user)
    .bind(T0)
    .execute(&mut c)
    .await
    .unwrap();
    c.close().await.unwrap();
}

/// The revoke of a paid chapter: the entitlement of the charge is deleted, the order `refunded` (so `GET
/// /api/orders` says so), `refunded_at` is the revoke's clock and `/api/entitlements` shows the chapter not owned. A
/// second revoke is `AlreadyRefunded` and moves nothing; an unknown charge is `UnknownCharge`. A revoke whose clock
/// is behind the payment's `paid_at` (a clock stepped back) records `paid_at`, never a `23514`; that charge is an
/// entitlement with no order (`own`), revoked by its own rows. The statistics row stays (ST4).
#[tokio::test]
async fn refund_revokes() {
    let (st, _db, _gateway) = refund_state().await;
    let mut failures = Vec::new();
    stat_row(&st, ANN).await;
    let Some(order) = bought(&st, ANN, "chapter:ch2", "c-ch2", &mut failures).await else {
        return report(&failures);
    };
    failures.extend(expect_eq(
        "first revoke",
        revoke_at(&st, T1, "c-ch2").await,
        Ok(RevokeOutcome::Revoked),
    ));
    failures.extend(expect_eq(
        "entitlements of the charge",
        entitlements_of(&st, "c-ch2").await,
        0,
    ));
    failures.extend(expect_eq(
        "order status",
        order_status(&st, &order).await,
        "refunded".to_owned(),
    ));
    failures.extend(expect_eq(
        "refunded_at",
        refunded_at(&st, "c-ch2").await,
        Some(T1),
    ));
    failures.extend(expect_eq(
        "GET /api/orders status",
        api_order_status(&st, ANN, &order).await,
        Some("refunded".to_owned()),
    ));
    failures.extend(expect_eq(
        "GET /api/entitlements chapter:ch2 owned",
        owned(&st, ANN, "chapter:ch2").await,
        Some(false),
    ));

    failures.extend(expect_eq(
        "second revoke",
        revoke_at(&st, T1 + 60, "c-ch2").await,
        Ok(RevokeOutcome::AlreadyRefunded),
    ));
    failures.extend(expect_eq(
        "second revoke: refunded_at",
        refunded_at(&st, "c-ch2").await,
        Some(T1),
    ));
    failures.extend(expect_eq(
        "second revoke: order status",
        order_status(&st, &order).await,
        "refunded".to_owned(),
    ));
    failures.extend(expect_eq(
        "unknown charge",
        revoke_at(&st, T1, "c-nope").await,
        Ok(RevokeOutcome::UnknownCharge),
    ));

    own(&st, BEN, "chapter:ch4").await;
    let charge = "charge-1002-chapter:ch4";
    failures.extend(expect_eq(
        "revoke behind paid_at",
        revoke_at(&st, T0 - 100, charge).await,
        Ok(RevokeOutcome::Revoked),
    ));
    failures.extend(expect_eq(
        "revoke behind paid_at: refunded_at",
        refunded_at(&st, charge).await,
        Some(T0),
    ));
    failures.extend(expect_eq(
        "revoke behind paid_at: entitlements of the charge",
        entitlements_of(&st, charge).await,
        0,
    ));
    failures.extend(expect_eq(
        "stat_events rows",
        crate::webhook::rows(&st, "SELECT count(*) FROM stat_events").await,
        1,
    ));
    report(&failures);
}

/// A refunded chapter is locked again: `GET /api/chapters/ch2` and its gated asset answer 200 before the revoke and
/// 403 `not_entitled` after it.
#[tokio::test]
async fn paid_chapter_403_after_refund() {
    let (st, _db, _gateway) = refund_state().await;
    let mut failures = Vec::new();
    if bought(&st, ANN, "chapter:ch2", "c-ch2", &mut failures)
        .await
        .is_none()
    {
        return report(&failures);
    }
    let paths = ["/api/chapters/ch2", "/api/assets/bg-archive-0a1b2c3d.avif"];
    for path in paths {
        let reply = get(&st, Some(ANN), path).await;
        failures.extend(expect_eq(
            &format!("{path} before the refund"),
            reply.status.as_u16(),
            200,
        ));
    }
    failures.extend(expect_eq(
        "revoke",
        revoke_at(&st, T1, "c-ch2").await,
        Ok(RevokeOutcome::Revoked),
    ));
    for path in paths {
        let reply = get(&st, Some(ANN), path).await;
        let body: Value = serde_json::from_slice(&reply.body).unwrap_or(Value::Null);
        if reply.status.as_u16() != 403 || body != json!({ "error": "not_entitled" }) {
            // The error code only: a 200 body is the paid chapter itself.
            failures.push(format!(
                "{path} after the refund: expected 403 not_entitled, got {} {}",
                reply.status.as_u16(),
                body["error"]
            ));
        }
    }
    report(&failures);
}

/// An unspent pack is clawed back whole: balance 0, debt 0, and the ledger keeps the credit next to the clawback
/// (`pay:<c>` +3, `refund:<c>` -3; ST4).
#[tokio::test]
async fn refund_pack_claws_back_unspent() {
    let (st, _db, _gateway) = refund_state().await;
    let mut failures = Vec::new();
    if bought(&st, ANN, "pack:hint_s", "c-pack", &mut failures)
        .await
        .is_none()
    {
        return report(&failures);
    }
    failures.extend(expect_hint("after the payment", &st, ANN, (3, 0)).await);
    failures.extend(expect_eq(
        "revoke",
        revoke_at(&st, T1, "c-pack").await,
        Ok(RevokeOutcome::Revoked),
    ));
    failures.extend(expect_hint("after the refund", &st, ANN, (0, 0)).await);
    failures.extend(expect_eq(
        "ledger",
        ledger_of(&st, ANN).await,
        vec![
            ("pay:c-pack".to_owned(), 3, "pack".to_owned()),
            ("refund:c-pack".to_owned(), -3, "pack_refund".to_owned()),
        ],
    ));
    report(&failures);
}

/// The spent part of a refunded pack becomes debt: 3 credited, 2 spent on hint tiers, then the refund takes the 1
/// left and records 2 as debt; the balance never goes below 0.
#[tokio::test]
async fn refund_spent_pack_records_debt() {
    let (st, _db, _gateway) = refund_state().await;
    let mut failures = Vec::new();
    if bought(&st, ANN, "pack:hint_s", "c-pack", &mut failures)
        .await
        .is_none()
    {
        return report(&failures);
    }
    let drawer = PuzzleId("ch1.drawer".to_owned());
    for tier in [1, 2] {
        if let Err(e) = st.repo.spend_hint(UserId(ANN), &drawer, tier, 1, T0).await {
            failures.push(format!("spend tier {tier}: expected Ok, got {e}"));
        }
    }
    failures.extend(expect_hint("after spending 2", &st, ANN, (1, 0)).await);
    failures.extend(expect_eq(
        "revoke",
        revoke_at(&st, T1, "c-pack").await,
        Ok(RevokeOutcome::Revoked),
    ));
    failures.extend(expect_hint("after the refund", &st, ANN, (0, 2)).await);
    report(&failures);
}

/// The clawback is the amount the charge credited, never the catalog's: an order whose binding was raised to 7 before
/// its payment credits 7, and its refund row is -7.
#[tokio::test]
async fn refund_claws_back_the_credited_amount() {
    let (st, _db, _gateway) = refund_state().await;
    let mut failures = Vec::new();
    let Some((order, amount)) = order_of(&st, ANN, "pack:hint_s", &mut failures).await else {
        return report(&failures);
    };
    let mut c = common::raw_db(&st).await;
    sqlx::query("UPDATE orders SET pack_amount = 7 WHERE id = $1")
        .bind(&order)
        .execute(&mut c)
        .await
        .unwrap();
    c.close().await.unwrap();
    pay(&st, ANN, amount, &order, "c-seven", &mut failures).await;
    failures.extend(expect_hint("after the payment", &st, ANN, (7, 0)).await);
    failures.extend(expect_eq(
        "revoke",
        revoke_at(&st, T1, "c-seven").await,
        Ok(RevokeOutcome::Revoked),
    ));
    let refund: Option<i64> = ledger_of(&st, ANN)
        .await
        .into_iter()
        .find(|(key, _, _)| key == "refund:c-seven")
        .map(|(_, amount, _)| amount);
    failures.extend(expect_eq("refund:c-seven amount", refund, Some(-7)));
    failures.extend(expect_hint("after the refund", &st, ANN, (0, 0)).await);
    report(&failures);
}

/// Makes `a` and `b` friends: a raw `friendships` row, the lower id first.
async fn befriend(st: &AppState, a: i64, b: i64) {
    let mut c = common::raw_db(st).await;
    sqlx::query("INSERT INTO friendships (user_lo, user_hi, created_at) VALUES ($1, $2, $3)")
        .bind(a.min(b))
        .bind(a.max(b))
        .bind(T0)
        .execute(&mut c)
        .await
        .unwrap();
    c.close().await.unwrap();
}

/// A refund never reaches a gift's recipient: `ANN`'s 3 credited hints all gifted to `BEN`, then the refund leaves
/// `BEN`'s 3 alone and records `ANN`'s whole clawback as debt.
#[tokio::test]
async fn refund_gifted_pack_keeps_friend_balance() {
    let (st, _db, _gateway) = refund_state().await;
    let mut failures = Vec::new();
    if bought(&st, ANN, "pack:hint_s", "c-pack", &mut failures)
        .await
        .is_none()
    {
        return report(&failures);
    }
    befriend(&st, ANN, BEN).await;
    let hint = ResourceKind("hint".to_owned());
    let rules = GiftRules {
        kinds: vec![hint.clone()],
        max_per_gift: 3,
        send_per_day: 3,
        receive_per_day: 5,
    };
    let gift = GiftMove {
        from: UserId(ANN),
        to: UserId(BEN),
        kind: &hint,
        amount: 3,
        request_id: "5b0e7c1a-2d3f-4a5b-8c6d-7e8f9a0b1c2d",
    };
    if let Err(e) = st.repo.transfer(&gift, &rules, T0).await {
        failures.push(format!("gift: expected Ok, got {e}"));
    }
    failures.extend(expect_hint("payer after the gift", &st, ANN, (0, 0)).await);
    failures.extend(expect_hint("friend after the gift", &st, BEN, (3, 0)).await);
    failures.extend(expect_eq(
        "revoke",
        revoke_at(&st, T1, "c-pack").await,
        Ok(RevokeOutcome::Revoked),
    ));
    let (balance, debt) = hint_of(&st, ANN).await;
    failures.extend(expect_eq("payer debt", debt, 3));
    failures.extend(expect_eq("payer balance", balance, 0));
    failures.extend(expect_hint("friend after the refund", &st, BEN, (3, 0)).await);
    report(&failures);
}

/// An unapplied pack charge (paid at another amount: `OrderMismatch`, no `pay:` row) is still revoked, and claws
/// back nothing: no ledger row, no balance, no debt.
#[tokio::test]
async fn refund_unapplied_charge_claws_back_nothing() {
    let (st, _db, _gateway) = refund_state().await;
    let mut failures = Vec::new();
    let Some((order, amount)) = order_of(&st, ANN, "pack:hint_s", &mut failures).await else {
        return report(&failures);
    };
    pay(&st, ANN, amount + 1, &order, "c-wrong", &mut failures).await;
    failures.extend(expect_eq(
        "revoke",
        revoke_at(&st, T1, "c-wrong").await,
        Ok(RevokeOutcome::Revoked),
    ));
    failures.extend(expect_eq(
        "refunded_at",
        refunded_at(&st, "c-wrong").await,
        Some(T1),
    ));
    failures.extend(expect_eq("ledger", ledger_of(&st, ANN).await, Vec::new()));
    failures.extend(expect_hint("after the refund", &st, ANN, (0, 0)).await);
    failures.extend(expect_eq(
        "order status",
        order_status(&st, &order).await,
        "created".to_owned(),
    ));
    report(&failures);
}

/// Two revokes of one charge at once revoke once: a raw READ COMMITTED transaction holds the guarded `UPDATE
/// payments` uncommitted, the app's revoke is seen waiting on the row, then the raw one commits. The app's revoke
/// re-checks the committed row and is `AlreadyRefunded`: it deleted nothing (the raw stand-in did not touch the
/// entitlement) and wrote no `refund:` row.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn refund_concurrent_revokes_once() {
    let (st, _db, _gateway) = refund_state().await;
    let mut failures = Vec::new();
    if bought(&st, ANN, "chapter:ch2", "c-ch2", &mut failures)
        .await
        .is_none()
    {
        return report(&failures);
    }
    let mut a = common::raw_db(&st).await;
    sqlx::raw_sql("BEGIN ISOLATION LEVEL READ COMMITTED")
        .execute(&mut a)
        .await
        .unwrap();
    sqlx::query(
        "UPDATE payments SET refunded_at = $2 WHERE telegram_payment_charge_id = $1 AND refunded_at IS NULL",
    )
    .bind("c-ch2")
    .bind(T1)
    .execute(&mut a)
    .await
    .unwrap();
    let app = st.clone();
    let b = tokio::spawn(async move { revoke_at(&app, T1 + 1, "c-ch2").await });
    common::wait_for_lock_waiter(&st).await;
    sqlx::raw_sql("COMMIT").execute(&mut a).await.unwrap();
    a.close().await.unwrap();
    failures.extend(expect_eq(
        "the waiting revoke",
        b.await.unwrap(),
        Ok(RevokeOutcome::AlreadyRefunded),
    ));
    failures.extend(expect_eq(
        "entitlements of the charge",
        entitlements_of(&st, "c-ch2").await,
        1,
    ));
    failures.extend(expect_eq(
        "refund: rows",
        refund_rows(&st, "c-ch2").await,
        0,
    ));
    failures.extend(expect_eq(
        "refunded_at",
        refunded_at(&st, "c-ch2").await,
        Some(T1),
    ));
    report(&failures);
}

/// The pre-checkout of a refunded chapter order, and of a paid pack order, is refused `Expired` in the query's
/// language, and neither order's status moves (the pre-checkout's `status IN ('created', 'checkout')` predicate and
/// the refusal's `Expired`-by-status branch).
#[tokio::test]
async fn refund_order_precheckout_refused_expired() {
    let (st, _db, gateway) = refund_state().await;
    let mut failures = Vec::new();
    let Some(chapter) = bought(&st, ANN, "chapter:ch2", "c-ch2", &mut failures).await else {
        return report(&failures);
    };
    let Some(pack) = bought(&st, ANN, "pack:hint_s", "c-pack", &mut failures).await else {
        return report(&failures);
    };
    failures.extend(expect_eq(
        "revoke",
        revoke_at(&st, T1, "c-ch2").await,
        Ok(RevokeOutcome::Revoked),
    ));
    let expired = refusal(RejectReason::Expired, Lang::Ru);
    for (case, order, status) in [
        ("the refunded chapter order", &chapter, "refunded"),
        ("the paid pack order", &pack, "paid"),
    ] {
        let mut c = common::raw_db(&st).await;
        let amount: i64 = sqlx::query_scalar("SELECT amount FROM orders WHERE id = $1")
            .bind(order)
            .fetch_one(&mut c)
            .await
            .unwrap();
        c.close().await.unwrap();
        let query_id = format!("q-{status}");
        let update = pre_checkout_update(
            &query_id,
            ANN,
            Some("ru"),
            "XTR",
            u32::try_from(amount).unwrap(),
            order,
        );
        let reply = post_update(&st, &update).await;
        let answer = gateway.answer(&query_id);
        if reply.status.as_u16() != 200 || answer.as_ref() != Some(&expired) {
            failures.push(format!(
                "{case}: expected the Expired refusal {expired:?}, got {} {answer:?}",
                reply.status.as_u16()
            ));
        }
        failures.extend(expect_eq(
            &format!("{case}: status"),
            order_status(&st, order).await,
            status.to_owned(),
        ));
    }
    report(&failures);
}

/// The admin refund's result as one comparable value: the outcome, or the error's text.
pub(crate) async fn refund_by_admin(
    st: &AppState,
    t: i64,
    charge: &str,
) -> Result<RevokeOutcome, String> {
    admin_refund(&at(st, t), &ChargeId(charge.to_owned()))
        .await
        .map_err(|e| match e {
            RefundError::Gateway(e) => format!("Gateway({e:?})"),
            RefundError::Db(e) => format!("Db({e})"),
        })
}

/// The `refundStarPayment` calls `gateway` recorded, as (payer, charge), in order.
pub(crate) fn refund_calls(gateway: &RecordingGateway) -> Vec<(i64, String)> {
    gateway
        .calls()
        .into_iter()
        .filter_map(|call| match call {
            GatewayCall::Refund { user, charge } => Some((user.0, charge.0)),
            _ => None,
        })
        .collect()
}

/// A refused `refundStarPayment` (a timeout, or Telegram's refusal of the charge) is an error and moves nothing: the
/// entitlement stays, the order stays `paid`, `refunded_at` stays NULL, and each attempt made exactly one call.
#[tokio::test]
async fn refund_gateway_error_keeps_entitlement() {
    let (st, _db, gateway) = refund_state().await;
    let mut failures = Vec::new();
    let Some(order) = bought(&st, ANN, "chapter:ch2", "c-ch2", &mut failures).await else {
        return report(&failures);
    };
    for (case, failure) in [
        ("timeout", GatewayError::Timeout),
        (
            "CHARGE_NOT_FOUND",
            GatewayError::Api("Bad Request: CHARGE_NOT_FOUND".to_owned()),
        ),
    ] {
        let before = refund_calls(&gateway).len();
        gateway.fail_with(Some(failure.clone()));
        let got = refund_by_admin(&st, T1, "c-ch2").await;
        gateway.fail_with(None);
        failures.extend(expect_eq(
            &format!("{case}: admin refund"),
            got,
            Err(format!("Gateway({failure:?})")),
        ));
        let kept = entitlements_of(&st, "c-ch2").await;
        if kept != 1 {
            failures.push(format!(
                "{case}: after a refused refundStarPayment: expected the entitlement kept, got {kept} rows"
            ));
        }
        failures.extend(expect_eq(
            &format!("{case}: order status"),
            order_status(&st, &order).await,
            "paid".to_owned(),
        ));
        failures.extend(expect_eq(
            &format!("{case}: refunded_at"),
            refunded_at(&st, "c-ch2").await,
            None,
        ));
        failures.extend(expect_eq(
            &format!("{case}: refundStarPayment calls"),
            refund_calls(&gateway).len() - before,
            1,
        ));
    }
    report(&failures);
}

/// The admin refund is repeat-safe: Telegram answering `CHARGE_ALREADY_REFUNDED` (a crash between an earlier refund
/// and its revoke) still revokes; a charge already refunded here, or unknown, answers so with no Bot API call.
#[tokio::test]
async fn refund_repeat_safe() {
    let (st, _db, gateway) = refund_state().await;
    let mut failures = Vec::new();
    if bought(&st, ANN, "chapter:ch2", "c-ch2", &mut failures)
        .await
        .is_none()
    {
        return report(&failures);
    }
    gateway.fail_with(Some(GatewayError::Api(
        "Bad Request: CHARGE_ALREADY_REFUNDED".to_owned(),
    )));
    let got = refund_by_admin(&st, T1, "c-ch2").await;
    gateway.fail_with(None);
    failures.extend(expect_eq(
        "refunded at Telegram before",
        got,
        Ok(RevokeOutcome::Revoked),
    ));
    failures.extend(expect_eq(
        "refunded at Telegram before: entitlements of the charge",
        entitlements_of(&st, "c-ch2").await,
        0,
    ));
    failures.extend(expect_eq(
        "refunded at Telegram before: refundStarPayment calls",
        refund_calls(&gateway),
        vec![(ANN, "c-ch2".to_owned())],
    ));
    for (case, charge, want) in [
        ("a refunded charge", "c-ch2", RevokeOutcome::AlreadyRefunded),
        ("an unknown charge", "c-nope", RevokeOutcome::UnknownCharge),
    ] {
        let before = refund_calls(&gateway).len();
        failures.extend(expect_eq(
            &format!("{case}: admin refund"),
            refund_by_admin(&st, T1 + 60, charge).await,
            Ok(want),
        ));
        failures.extend(expect_eq(
            &format!("{case}: refundStarPayment calls"),
            refund_calls(&gateway).len() - before,
            0,
        ));
    }
    report(&failures);
}

/// A `message` update with a `refunded_payment` of `charge` from `payer` (`amount` XTR for `payload`): every field
/// frankenstein requires is present.
pub(crate) fn refund_update(payer: i64, amount: u32, payload: &str, charge: &str) -> Value {
    json!({
        "update_id": 3,
        "message": {
            "message_id": 8,
            "date": T0,
            "chat": { "id": payer, "type": "private" },
            "from": { "id": payer, "is_bot": false, "first_name": "Ann" },
            "refunded_payment": {
                "currency": "XTR",
                "total_amount": amount,
                "invoice_payload": payload,
                "telegram_payment_charge_id": charge,
                "provider_payment_charge_id": ""
            }
        }
    })
}

/// `update` through the webhook on `st` at `t`: the HTTP status.
async fn post_at(st: &AppState, t: i64, update: &Value) -> u16 {
    post_update(&at(st, t), update).await.status.as_u16()
}

/// A `refunded_payment` update revokes, answered 200 only after the commit; Telegram's redelivery answers 200 too and
/// moves nothing: `refunded_at` stays the first delivery's time.
#[tokio::test]
async fn refunded_payment_update_revokes_idempotent() {
    let (st, _db, _gateway) = refund_state().await;
    let mut failures = Vec::new();
    let Some(order) = bought(&st, ANN, "chapter:ch2", "c-ch2", &mut failures).await else {
        return report(&failures);
    };
    let update = refund_update(ANN, 1, &order, "c-ch2");
    for (case, t) in [("first delivery", T1), ("redelivery", T1 + 60)] {
        let status = post_at(&st, t, &update).await;
        let left = entitlements_of(&st, "c-ch2").await;
        if status != 200 || left != 0 {
            failures.push(format!(
                "{case}: expected 200 with the entitlement gone, got {status} with {left} entitlement rows"
            ));
        }
        failures.extend(expect_eq(
            &format!("{case}: refunded_at"),
            refunded_at(&st, "c-ch2").await,
            Some(T1),
        ));
    }
    failures.extend(expect_eq(
        "order status",
        order_status(&st, &order).await,
        "refunded".to_owned(),
    ));
    report(&failures);
}

/// K17 for refunds: a `refunded_payment` frankenstein refuses (no `invoice_payload`, which its type requires) is read
/// by the lenient probe, which needs only the charge id, and revokes the same way: 200 after the commit.
#[tokio::test]
async fn webhook_refund_undecodable_by_frankenstein_still_revokes() {
    let (st, _db, _gateway) = refund_state().await;
    let mut failures = Vec::new();
    if bought(&st, ANN, "chapter:ch2", "c-ch2", &mut failures)
        .await
        .is_none()
    {
        return report(&failures);
    }
    let mut update = refund_update(ANN, 1, "o_x", "c-ch2");
    update["message"]["refunded_payment"]
        .as_object_mut()
        .unwrap()
        .remove("invoice_payload");
    if serde_json::from_value::<frankenstein::updates::Update>(update.clone()).is_ok() {
        failures.push("the update decodes with frankenstein: the case tests nothing".to_owned());
    }
    let status = post_at(&st, T1, &update).await;
    let left = entitlements_of(&st, "c-ch2").await;
    if status != 200 || left != 0 {
        failures.push(format!(
            "undecodable refunded_payment: expected 200 with the entitlement gone, got {status} with {left} \
             entitlement rows"
        ));
    }
    failures.extend(expect_eq(
        "refunded_at",
        refunded_at(&st, "c-ch2").await,
        Some(T1),
    ));
    report(&failures);
}

/// A refund whose charge id cannot be read (missing, or a number) is never acknowledged away: 500, so Telegram
/// redelivers it, and nothing moves.
#[tokio::test]
async fn webhook_refund_charge_unreadable_500() {
    let (st, _db, _gateway) = refund_state().await;
    let mut failures = Vec::new();
    if bought(&st, ANN, "chapter:ch2", "c-ch2", &mut failures)
        .await
        .is_none()
    {
        return report(&failures);
    }
    let mut missing = refund_update(ANN, 1, "o_x", "c-ch2");
    missing["message"]["refunded_payment"]
        .as_object_mut()
        .unwrap()
        .remove("telegram_payment_charge_id");
    let mut number = refund_update(ANN, 1, "o_x", "c-ch2");
    number["message"]["refunded_payment"]["telegram_payment_charge_id"] = json!(42);
    for (case, update) in [("no charge id", missing), ("a numeric charge id", number)] {
        failures.extend(expect_eq(
            &format!("{case}: status"),
            post_at(&st, T1, &update).await,
            500,
        ));
    }
    failures.extend(expect_eq(
        "entitlements of the charge",
        entitlements_of(&st, "c-ch2").await,
        1,
    ));
    failures.extend(expect_eq(
        "refunded_at",
        refunded_at(&st, "c-ch2").await,
        None,
    ));
    report(&failures);
}

/// Both refund paths for one pack charge claw back once: the admin refund at `T1`, then Telegram's
/// `refunded_payment` at a later time. One `refund:` row, the wallet unchanged by the second, `refunded_at` the
/// first's.
#[tokio::test]
async fn refund_pack_twice_claws_once() {
    let (st, _db, _gateway) = refund_state().await;
    let mut failures = Vec::new();
    let Some(order) = bought(&st, ANN, "pack:hint_s", "c-pack", &mut failures).await else {
        return report(&failures);
    };
    failures.extend(expect_eq(
        "admin refund",
        refund_by_admin(&st, T1, "c-pack").await,
        Ok(RevokeOutcome::Revoked),
    ));
    let after_admin = hint_of(&st, ANN).await;
    let status = post_at(&st, T1 + 60, &refund_update(ANN, 1, &order, "c-pack")).await;
    failures.extend(expect_eq("refunded_payment status", status, 200));
    failures.extend(expect_eq(
        "refunded_at",
        refunded_at(&st, "c-pack").await,
        Some(T1),
    ));
    failures.extend(expect_eq(
        "refund: rows",
        refund_rows(&st, "c-pack").await,
        1,
    ));
    failures.extend(expect_eq(
        "hint row after the second path",
        hint_of(&st, ANN).await,
        after_admin,
    ));
    report(&failures);
}

/// The entitlements rows of (`user`, `product`), read outside the app pool.
async fn product_entitlements(st: &AppState, user: i64, product: &str) -> i64 {
    let mut c = common::raw_db(st).await;
    let n = sqlx::query_scalar(
        "SELECT count(*) FROM entitlements WHERE user_id = $1 AND product_id = $2",
    )
    .bind(user)
    .bind(product)
    .fetch_one(&mut c)
    .await
    .unwrap();
    c.close().await.unwrap();
    n
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
    c.close().await.unwrap();
    charges
}

/// ANN's `chapter:ch2` paid with `c-a` at `T0` (granted), then each of `second`'s (order, charge, time) as a raw
/// second order paid through the webhook at its time: a payment that slipped past the checkout window, recorded
/// `AlreadyEntitled` (its order `paid`, no entitlement of its own). A setup that is not so is a failure line.
async fn paid_twice(st: &AppState, second: &[(&str, &str, i64)], failures: &mut Vec<String>) {
    if bought(st, ANN, "chapter:ch2", "c-a", failures)
        .await
        .is_none()
    {
        return;
    }
    for &(order, charge, t) in second {
        raw_order(st, order, ANN, "chapter:ch2").await;
        pay(&at(st, t), ANN, 1, order, charge, failures).await;
        let state = (
            order_status(st, order).await,
            entitlements_of(st, charge).await,
        );
        if state != ("paid".to_owned(), 0) {
            failures.push(format!(
                "setup: {charge}: expected AlreadyEntitled (its order paid, no entitlement of its own), got {state:?}"
            ));
        }
    }
    failures.extend(expect_eq(
        "setup: entitlements of c-a",
        entitlements_of(st, "c-a").await,
        1,
    ));
}

/// RULINGS 96: refunding the charge that keys a chapter's entitlement re-keys it to the payer's oldest other unrefunded
/// charge that paid an order of the chapter and keys nothing (`AlreadyEntitled`), instead of deleting it. ANN pays ch2
/// with `c-a`, then `c-b` at `T0+60` and `c-c` at `T0+120`. Refunding `c-a` keeps ch2 readable, keyed to `c-b`, and
/// `/paysupport` shows `c-b` applied, `c-c` not applied, `c-a` refunded; refunding `c-b` re-keys to `c-c`; refunding
/// `c-c` deletes it, and ch2 is 403 again. No entitlement is ever keyed to a refunded charge.
#[tokio::test]
async fn refund_rekeys_entitlement_to_other_paid_charge() {
    let (st, _db, gateway) = refund_state().await;
    let mut failures = Vec::new();
    paid_twice(
        &st,
        &[
            ("o_000000000000000000000000000000b0", "c-b", T0 + 60),
            ("o_000000000000000000000000000000c0", "c-c", T0 + 120),
        ],
        &mut failures,
    )
    .await;
    if !failures.is_empty() {
        return report(&failures);
    }
    failures.extend(expect_eq(
        "refund of c-a",
        revoke_at(&st, T1, "c-a").await,
        Ok(RevokeOutcome::Revoked),
    ));
    failures.extend(expect_eq(
        "after refunding c-a: entitlements of c-b",
        entitlements_of(&st, "c-b").await,
        1,
    ));
    failures.extend(expect_eq(
        "after refunding c-a: GET ch2",
        get(&st, Some(ANN), "/api/chapters/ch2")
            .await
            .status
            .as_u16(),
        200,
    ));
    let ru = texts::texts(Lang::Ru);
    let line = |charge: &str, t: i64, status: Option<&str>| {
        let mut line = fill(
            &ru.paysupport_line,
            &[("date", &utc_date(t)), ("charge", charge), ("amount", "1")],
        );
        if let Some(status) = status {
            line.push(' ');
            line.push_str(status);
        }
        line
    };
    let want = vec![
        line("c-c", T0 + 120, Some(&ru.paysupport_not_applied)),
        line("c-b", T0 + 60, None),
        line("c-a", T0, Some(&ru.paysupport_refunded)),
    ];
    let (status, sent) = say(&st, &gateway, ANN, Some("ru"), "/paysupport").await;
    let text = sent.first().map(|msg| msg.text.clone()).unwrap_or_default();
    let got: Vec<String> = charge_lines(&text, &ru.paysupport)
        .into_iter()
        .map(str::to_owned)
        .collect();
    failures.extend(expect_eq(
        "after refunding c-a: /paysupport (status, messages, charge lines)",
        (status, sent.len(), got),
        (200, 1, want),
    ));
    failures.extend(expect_eq(
        "refund of c-b",
        revoke_at(&st, T1 + 60, "c-b").await,
        Ok(RevokeOutcome::Revoked),
    ));
    failures.extend(expect_eq(
        "after refunding c-b: entitlements of c-c",
        entitlements_of(&st, "c-c").await,
        1,
    ));
    failures.extend(expect_eq(
        "refund of c-c",
        revoke_at(&st, T1 + 120, "c-c").await,
        Ok(RevokeOutcome::Revoked),
    ));
    failures.extend(expect_eq(
        "after refunding c-c: entitlements of (ANN, chapter:ch2)",
        product_entitlements(&st, ANN, "chapter:ch2").await,
        0,
    ));
    failures.extend(expect_eq(
        "after refunding c-c: GET ch2",
        get(&st, Some(ANN), "/api/chapters/ch2")
            .await
            .status
            .as_u16(),
        403,
    ));
    failures.extend(expect_eq(
        "entitlements keyed to a refunded charge",
        keyed_to_refunded(&st).await,
        Vec::<String>::new(),
    ));
    report(&failures);
}

/// RULINGS 97 Q10: the re-key never picks a successor whose own refund is in flight. A, a raw READ COMMITTED
/// transaction, plays `c-b`'s revoke (its guard, its order, its 0-row entitlement delete) and stays uncommitted; the
/// revoke of `c-a` must wait on `c-b`'s payment row (`FOR SHARE`), then re-check it, find it refunded and delete the
/// entitlement. Without the lock it would re-key to `c-b` after `c-b`'s delete had run: a chapter kept on two refunded
/// charges.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn refund_rekey_skips_charge_refunded_concurrently() {
    let (st, _db, _gateway) = refund_state().await;
    let mut failures = Vec::new();
    paid_twice(
        &st,
        &[("o_000000000000000000000000000000b0", "c-b", T0 + 60)],
        &mut failures,
    )
    .await;
    if !failures.is_empty() {
        return report(&failures);
    }
    let mut a = common::raw_db(&st).await;
    sqlx::raw_sql("BEGIN ISOLATION LEVEL READ COMMITTED")
        .execute(&mut a)
        .await
        .unwrap();
    sqlx::query(
        "UPDATE payments SET refunded_at = $1 \
         WHERE telegram_payment_charge_id = 'c-b' AND refunded_at IS NULL",
    )
    .bind(T1)
    .execute(&mut a)
    .await
    .unwrap();
    sqlx::query("UPDATE orders SET status = 'refunded' WHERE charge_id = 'c-b'")
        .execute(&mut a)
        .await
        .unwrap();
    sqlx::query("DELETE FROM entitlements WHERE charge_id = 'c-b'")
        .execute(&mut a)
        .await
        .unwrap();
    let app = st.clone();
    let mut revoke = tokio::spawn(async move { revoke_at(&app, T1, "c-a").await });
    let early = tokio::select! {
        biased;
        got = &mut revoke => Some(got.unwrap()),
        () = common::wait_for_lock_waiter(&st) => None,
    };
    if early.is_some() {
        failures.push(
            "revoke of c-a never waited on c-b's payment row: it finished while c-b's refund held its transaction \
             open"
                .to_owned(),
        );
    }
    sqlx::raw_sql("COMMIT").execute(&mut a).await.unwrap();
    a.close().await.unwrap();
    let got = match early {
        Some(got) => got,
        None => revoke.await.unwrap(),
    };
    failures.extend(expect_eq(
        "the revoke of c-a",
        got,
        Ok(RevokeOutcome::Revoked),
    ));
    failures.extend(expect_eq(
        "entitlements of (ANN, chapter:ch2)",
        product_entitlements(&st, ANN, "chapter:ch2").await,
        0,
    ));
    failures.extend(expect_eq(
        "entitlements keyed to a refunded charge",
        keyed_to_refunded(&st).await,
        Vec::<String>::new(),
    ));
    report(&failures);
}

/// A raw READ COMMITTED transaction on `st`'s database that holds `sql` (one row lock, `charge_or_order` bound as
/// `$1`) until it is rolled back.
async fn hold_row(st: &AppState, sql: &'static str, charge_or_order: &str) -> sqlx::PgConnection {
    let mut c = common::raw_db(st).await;
    sqlx::raw_sql("BEGIN ISOLATION LEVEL READ COMMITTED")
        .execute(&mut c)
        .await
        .unwrap();
    sqlx::query(sql)
        .bind(charge_or_order)
        .execute(&mut c)
        .await
        .unwrap();
    c
}

/// Rolls back and closes a connection from [`hold_row`].
async fn release(mut held: sqlx::PgConnection) {
    sqlx::raw_sql("ROLLBACK").execute(&mut held).await.unwrap();
    held.close().await.unwrap();
}

/// A money fact whose transaction fails midway answers 500 and leaves no partial row, so Telegram's redelivery runs it
/// whole. (a) The order row held `FOR UPDATE`: a payment errors at the 2 s `lock_timeout` after its payments insert,
/// which rolls back with it (0 payments rows); released and redelivered, it grants. (b) The payment row held: a
/// `refunded_payment` errors the same way, the entitlement kept and `refunded_at` NULL; released and redelivered, it
/// revokes. (c) Another charge's order row held: its `refunded_payment` passes the guard, then errors at the order
/// step, and the guard's write rolls back with it (`refunded_at` NULL, the entitlement kept); released and
/// redelivered, it revokes. Only (c) fails after the guard: in (b) the guard itself waits.
#[tokio::test]
async fn refund_and_grant_mid_transaction_failure_500() {
    let (st, _db, _gateway) = refund_state().await;
    let mut failures = Vec::new();
    let Some((order, amount)) = order_of(&st, ANN, "chapter:ch2", &mut failures).await else {
        return report(&failures);
    };
    let held = hold_row(&st, "SELECT 1 FROM orders WHERE id = $1 FOR UPDATE", &order).await;
    let payment = payment_update(ANN, "XTR", amount, &order, "c-ch2", "");
    failures.extend(expect_eq(
        "(a) payment with the order row held: status",
        post_at(&st, T0, &payment).await,
        500,
    ));
    release(held).await;
    failures.extend(expect_eq(
        "(a) payments rows after the failure",
        crate::webhook::payment_rows(&st).await,
        0,
    ));
    failures.extend(expect_eq(
        "(a) redelivered: status",
        post_at(&st, T0, &payment).await,
        200,
    ));
    failures.extend(expect_eq(
        "(a) redelivered: entitlements of the charge",
        entitlements_of(&st, "c-ch2").await,
        1,
    ));

    let held = hold_row(
        &st,
        "SELECT 1 FROM payments WHERE telegram_payment_charge_id = $1 FOR UPDATE",
        "c-ch2",
    )
    .await;
    let refund = refund_update(ANN, amount, &order, "c-ch2");
    failures.extend(expect_eq(
        "(b) refunded_payment with the payment row held: status",
        post_at(&st, T1, &refund).await,
        500,
    ));
    release(held).await;
    failures.extend(expect_eq(
        "(b) after the failure: entitlements of the charge",
        entitlements_of(&st, "c-ch2").await,
        1,
    ));
    failures.extend(expect_eq(
        "(b) after the failure: refunded_at",
        refunded_at(&st, "c-ch2").await,
        None,
    ));
    failures.extend(expect_eq(
        "(b) redelivered: status",
        post_at(&st, T1, &refund).await,
        200,
    ));
    failures.extend(expect_eq(
        "(b) redelivered: entitlements of the charge",
        entitlements_of(&st, "c-ch2").await,
        0,
    ));

    let Some((ben_order, ben_amount)) = order_of(&st, BEN, "chapter:ch2", &mut failures).await
    else {
        return report(&failures);
    };
    pay(&st, BEN, ben_amount, &ben_order, "c-ben", &mut failures).await;
    let held = hold_row(
        &st,
        "SELECT 1 FROM orders WHERE charge_id = $1 FOR UPDATE",
        "c-ben",
    )
    .await;
    let refund = refund_update(BEN, ben_amount, &ben_order, "c-ben");
    failures.extend(expect_eq(
        "(c) refunded_payment with the order row held: status",
        post_at(&st, T1, &refund).await,
        500,
    ));
    release(held).await;
    failures.extend(expect_eq(
        "(c) after the failure: refunded_at",
        refunded_at(&st, "c-ben").await,
        None,
    ));
    failures.extend(expect_eq(
        "(c) after the failure: entitlements of the charge",
        entitlements_of(&st, "c-ben").await,
        1,
    ));
    failures.extend(expect_eq(
        "(c) redelivered: status",
        post_at(&st, T1, &refund).await,
        200,
    ));
    failures.extend(expect_eq(
        "(c) redelivered: entitlements of the charge",
        entitlements_of(&st, "c-ben").await,
        0,
    ));
    report(&failures);
}
