//! `POST /telegram/webhook`: the one door for Telegram's updates. The secret header is checked in constant time
//! before anything is parsed (401), the body is limited to 1 MiB (413), and an update the server cannot decode is
//! acknowledged (200) unless it carries a payment it cannot read (500, so Telegram redelivers it).
//!
//! The wire helpers here ([`post_webhook`], [`post_update`], [`pre_checkout_update`], [`payment_update`]) build the
//! JSON Telegram sends; the pre-checkout and grant tests in `payments.rs` import them.

use axum::body::Body;
use axum::http::header::CONTENT_TYPE;
use axum::http::{HeaderValue, Request};
use serde_json::{Value, json};
use server::AppState;

use crate::catalog::{ANN, T0};
use crate::common;
use crate::payments::{GatewayCall, invoice_state, post_invoice};

/// The header Telegram sends `setWebhook`'s `secret_token` in.
const SECRET_HEADER: &str = "x-telegram-bot-api-secret-token";

/// The webhook's body limit (PP "HTTP API": 1 MB), stated here on its own so a changed constant is red.
const LIMIT: usize = 1024 * 1024;

fn report(failures: &[String]) {
    assert!(
        failures.is_empty(),
        "{} failures:\n{}",
        failures.len(),
        failures.join("\n")
    );
}

/// `POST /telegram/webhook` with `body`, carrying one `X-Telegram-Bot-Api-Secret-Token` header per entry of
/// `secrets` (none: no header).
pub(crate) async fn post_webhook(st: &AppState, secrets: &[&[u8]], body: Vec<u8>) -> common::Reply {
    let mut req = Request::post("/telegram/webhook").header(CONTENT_TYPE, "application/json");
    for &secret in secrets {
        req = req.header(SECRET_HEADER, HeaderValue::from_bytes(secret).unwrap());
    }
    common::call(st, req.body(Body::from(body)).unwrap()).await
}

/// `update` posted to the webhook with the state's own secret, as Telegram sends it.
pub(crate) async fn post_update(st: &AppState, update: &Value) -> common::Reply {
    let secret = st.cfg.webhook_secret.clone();
    post_webhook(st, &[secret.as_bytes()], update.to_string().into_bytes()).await
}

/// A `pre_checkout_query` update: query `query_id` from `payer` (Telegram language tag `language`) for `amount`
/// of `currency`, with `payload`.
pub(crate) fn pre_checkout_update(
    query_id: &str,
    payer: i64,
    language: Option<&str>,
    currency: &str,
    amount: u32,
    payload: &str,
) -> Value {
    json!({
        "update_id": 1,
        "pre_checkout_query": {
            "id": query_id,
            "from": { "id": payer, "is_bot": false, "first_name": "Ann", "language_code": language },
            "currency": currency,
            "total_amount": amount,
            "invoice_payload": payload
        }
    })
}

/// A `message` update with a `successful_payment` from `payer`: `amount` of `currency` for `payload`, charge
/// `charge`, provider charge `provider`. Every field frankenstein requires is present.
pub(crate) fn payment_update(
    payer: i64,
    currency: &str,
    amount: u32,
    payload: &str,
    charge: &str,
    provider: &str,
) -> Value {
    json!({
        "update_id": 2,
        "message": {
            "message_id": 7,
            "date": T0,
            "chat": { "id": payer, "type": "private" },
            "from": { "id": payer, "is_bot": false, "first_name": "Ann" },
            "successful_payment": {
                "currency": currency,
                "total_amount": amount,
                "invoice_payload": payload,
                "telegram_payment_charge_id": charge,
                "provider_payment_charge_id": provider
            }
        }
    })
}

/// `count(*)` of one table, read outside the app pool.
pub(crate) async fn rows(st: &AppState, count_sql: &'static str) -> i64 {
    let mut conn = common::raw_db(st).await;
    let n = sqlx::query_scalar(count_sql)
        .fetch_one(&mut conn)
        .await
        .unwrap();
    sqlx::Connection::close(conn).await.unwrap();
    n
}

/// The payments rows.
pub(crate) async fn payment_rows(st: &AppState) -> i64 {
    rows(st, "SELECT count(*) FROM payments").await
}

/// A new `created` order of `chapter:ch2` for `user`, through `POST /api/invoices` at the state's clock: its id and
/// amount. A refusal is a failure line and `None`.
pub(crate) async fn new_order(
    st: &AppState,
    user: i64,
    failures: &mut Vec<String>,
) -> Option<(String, u32)> {
    let reply = post_invoice(
        st,
        Some(user),
        &json!({ "productId": "chapter:ch2" }).to_string(),
    )
    .await;
    let body: Value = serde_json::from_slice(&reply.body).unwrap_or(Value::Null);
    let Some(order) = body["orderId"]
        .as_str()
        .filter(|_| reply.status.as_u16() == 200)
    else {
        failures.push(format!(
            "POST /api/invoices for {user}: expected 200 with an orderId, got {} {:?}",
            reply.status.as_u16(),
            body_text(&reply)
        ));
        return None;
    };
    let mut conn = common::raw_db(st).await;
    let amount: i64 = sqlx::query_scalar("SELECT amount FROM orders WHERE id = $1")
        .bind(order)
        .fetch_one(&mut conn)
        .await
        .unwrap();
    sqlx::Connection::close(conn).await.unwrap();
    Some((order.to_owned(), u32::try_from(amount).unwrap()))
}

/// The status of order `order`, read outside the app pool.
pub(crate) async fn order_status(st: &AppState, order: &str) -> String {
    let mut conn = common::raw_db(st).await;
    let status = sqlx::query_scalar("SELECT status FROM orders WHERE id = $1")
        .bind(order)
        .fetch_one(&mut conn)
        .await
        .unwrap();
    sqlx::Connection::close(conn).await.unwrap();
    status
}

fn body_text(reply: &common::Reply) -> String {
    String::from_utf8_lossy(&reply.body).into_owned()
}

/// A payment body that would record a payment if it got past the secret check.
fn forged_payment() -> Vec<u8> {
    payment_update(
        ANN,
        "XTR",
        1,
        "o_00000000000000000000000000000000",
        "forged-1",
        "",
    )
    .to_string()
    .into_bytes()
}

/// No secret header, or an empty one, is 401 before anything is parsed: a payment body records nothing.
#[tokio::test]
async fn webhook_missing_secret_401() {
    let (st, _db, _gateway) = invoice_state(&[(ANN, Some("ru"))]).await;
    let mut failures = Vec::new();
    for (case, secrets) in [("no header", &[][..]), ("an empty value", &[&b""[..]][..])] {
        let reply = post_webhook(&st, secrets, forged_payment()).await;
        if reply.status.as_u16() != 401 {
            failures.push(format!(
                "{case}: expected 401, got {} {:?}",
                reply.status.as_u16(),
                body_text(&reply)
            ));
        }
    }
    let payments = payment_rows(&st).await;
    if payments != 0 {
        failures.push(format!("payments rows: expected 0, got {payments}"));
    }
    report(&failures);
}

/// Every secret that is not exactly the configured one, in exactly one header value, is 401: a wrong value, one of
/// the same length, a prefix, the secret plus a character, two values (even both right), non-ASCII bytes. A payment
/// body behind them records nothing.
#[tokio::test]
async fn webhook_wrong_secret_401() {
    let (st, _db, _gateway) = invoice_state(&[(ANN, Some("ru"))]).await;
    let secret = st.cfg.webhook_secret.clone();
    let mut same_length = secret.clone().into_bytes();
    if let Some(last) = same_length.last_mut() {
        *last = if *last == b'x' { b'y' } else { b'x' };
    }
    let prefix = &secret.as_bytes()[..secret.len() - 1];
    let plus = format!("{secret}x");
    let cases: [(&str, Vec<&[u8]>); 7] = [
        ("a wrong value", vec![b"wrong"]),
        ("the same length, wrong", vec![&same_length]),
        ("a prefix", vec![prefix]),
        ("the secret plus a character", vec![plus.as_bytes()]),
        (
            "two right values",
            vec![secret.as_bytes(), secret.as_bytes()],
        ),
        (
            "a right and a wrong value",
            vec![secret.as_bytes(), b"wrong"],
        ),
        ("non-ASCII bytes", vec![b"\xff\xfe\x80secret"]),
    ];
    let mut failures = Vec::new();
    for (case, secrets) in cases {
        let reply = post_webhook(&st, &secrets, forged_payment()).await;
        if reply.status.as_u16() != 401 {
            failures.push(format!(
                "{case}: expected 401, got {} {:?}",
                reply.status.as_u16(),
                body_text(&reply)
            ));
        }
    }
    let payments = payment_rows(&st).await;
    if payments != 0 {
        failures.push(format!("payments rows: expected 0, got {payments}"));
    }
    report(&failures);
}

/// A body the server cannot decode and that carries no payment is acknowledged (200), so Telegram does not build a
/// redelivery backlog: not JSON, `{}`, an unknown update kind, a `pre_checkout_query` without `from`. Nothing is
/// answered or recorded, and the order stays `created`.
#[tokio::test]
async fn webhook_undecodable_200() {
    let (st, _db, gateway) = invoice_state(&[(ANN, Some("ru"))]).await;
    let mut failures = Vec::new();
    let Some((order, amount)) = new_order(&st, ANN, &mut failures).await else {
        report(&failures);
        return;
    };
    let mut no_from = pre_checkout_update("q-no-from", ANN, Some("ru"), "XTR", amount, &order);
    no_from["pre_checkout_query"]
        .as_object_mut()
        .unwrap()
        .remove("from");
    let secret = st.cfg.webhook_secret.clone();
    let mut replies = Vec::new();
    for (case, body) in [
        ("not JSON", &b"not json"[..]),
        ("{}", &b"{}"[..]),
        (
            "an unknown update kind",
            &br#"{"update_id":1,"brand_new_kind":{}}"#[..],
        ),
    ] {
        replies.push((
            case,
            post_webhook(&st, &[secret.as_bytes()], body.to_vec()).await,
        ));
    }
    replies.push((
        "a pre_checkout_query without from",
        post_update(&st, &no_from).await,
    ));
    for (case, reply) in replies {
        if reply.status.as_u16() != 200 {
            failures.push(format!(
                "{case}: expected 200, got {} {:?}",
                reply.status.as_u16(),
                body_text(&reply)
            ));
        }
    }
    let answers = gateway
        .calls()
        .into_iter()
        .filter(|call| !matches!(call, GatewayCall::Invoice(_)))
        .count();
    if answers != 0 {
        failures.push(format!(
            "gateway calls besides the invoice: expected 0, got {answers}"
        ));
    }
    let payments = payment_rows(&st).await;
    if payments != 0 {
        failures.push(format!("payments rows: expected 0, got {payments}"));
    }
    let status = order_status(&st, &order).await;
    if status != "created" {
        failures.push(format!("order status: expected created, got {status}"));
    }
    report(&failures);
}

/// The webhook takes bodies up to 1 MiB: one byte more is 413 before the handler runs; one byte less is read
/// (not JSON, so acknowledged with 200).
#[tokio::test]
async fn webhook_body_over_1mb_413() {
    let (st, _db, _gateway) = invoice_state(&[]).await;
    let secret = st.cfg.webhook_secret.clone();
    let mut failures = Vec::new();
    for (case, len, want) in [
        ("1 MiB + 1 byte", LIMIT + 1, 413),
        ("1 MiB - 1 byte", LIMIT - 1, 200),
    ] {
        let reply = post_webhook(&st, &[secret.as_bytes()], vec![b'x'; len]).await;
        if reply.status.as_u16() != want {
            failures.push(format!(
                "{case}: expected {want}, got {}",
                reply.status.as_u16()
            ));
        }
    }
    report(&failures);
}
