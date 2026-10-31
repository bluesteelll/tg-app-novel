//! `POST /telegram/webhook` (K17): the one door for Telegram's updates. The secret header is compared in constant
//! time before anything is parsed; the body is read as bytes and decoded as frankenstein's `Update`, and an update
//! the server cannot decode is acknowledged unless a money fact would be lost.
//!
//! Logs never carry the body, the headers or the secret: a decode error is logged by its class and position only,
//! because its text can quote a field value.

use axum::body::Bytes;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use frankenstein::payments::PreCheckoutQuery;
use frankenstein::types::Message;
use frankenstein::updates::{Update, UpdateContent};
use subtle::ConstantTimeEq;

use crate::AppState;
use crate::ids::{ChargeId, UserId};
use crate::telegram::payments::{self, PaymentFact, PreCheckoutVerdict, RejectReason};

/// The webhook's body limit (PP "HTTP API": 1 MB): far above any update, and applied by the route before the handler.
pub const WEBHOOK_BODY_LIMIT: usize = 1024 * 1024;

/// The header Telegram sends `setWebhook`'s `secret_token` in.
const SECRET_HEADER: &str = "x-telegram-bot-api-secret-token";

/// What the handler made of an update: acknowledged (200, Telegram forgets it) or to be redelivered (500).
enum Handled {
    /// Done, or nothing to do: 200.
    Ack,
    /// A money fact was not recorded: 500, so Telegram sends the update again.
    Retry,
}

/// `POST /telegram/webhook`: 401 unless exactly one `X-Telegram-Bot-Api-Secret-Token` equals `WEBHOOK_SECRET`; else
/// the update is handled and answered 200, or 500 when a money fact could not be recorded.
pub async fn webhook(State(st): State<AppState>, headers: HeaderMap, body: Bytes) -> StatusCode {
    if !secret_ok(&headers, st.cfg.webhook_secret.as_bytes()) {
        return StatusCode::UNAUTHORIZED;
    }
    match handle(&st, &body).await {
        Handled::Ack => StatusCode::OK,
        Handled::Retry => StatusCode::INTERNAL_SERVER_ERROR,
    }
}

/// Exactly one secret header value, non-empty and equal to `secret`, compared in constant time (a length mismatch
/// fails at once: the length is not the secret).
fn secret_ok(headers: &HeaderMap, secret: &[u8]) -> bool {
    let mut values = headers.get_all(SECRET_HEADER).iter();
    let (Some(given), None) = (values.next(), values.next()) else {
        return false;
    };
    let given = given.as_bytes();
    !given.is_empty() && bool::from(given.ct_eq(secret))
}

/// Decodes the body and dispatches the update.
async fn handle(st: &AppState, body: &[u8]) -> Handled {
    match serde_json::from_slice::<Update>(body) {
        Ok(update) => dispatch(st, update).await,
        Err(e) => {
            tracing::warn!(
                class = ?e.classify(),
                line = e.line(),
                column = e.column(),
                "webhook: undecodable update acknowledged"
            );
            Handled::Ack
        }
    }
}

/// One decoded update: a pre-checkout is decided and answered, a message is read for a payment; every other kind is
/// acknowledged.
async fn dispatch(st: &AppState, update: Update) -> Handled {
    match update.content {
        UpdateContent::PreCheckoutQuery(q) => {
            pre_checkout(st, &q).await;
            Handled::Ack
        }
        UpdateContent::Message(m) => message(st, &m).await,
        _ => Handled::Ack,
    }
}

/// P6: a `successful_payment` is granted, and acknowledged only after the commit; one whose payer cannot be recorded
/// (no `from`, an id beyond `i64`) is retried, never acknowledged away. A `refunded_payment` is acknowledged and
/// logged: refunds are handled by a later lane, and no refund can be issued before it. Any other message is
/// acknowledged.
async fn message(st: &AppState, m: &Message) -> Handled {
    if let Some(sp) = &m.successful_payment {
        let Some(payer) = m.from.as_ref().and_then(|from| i64::try_from(from.id).ok()) else {
            tracing::error!(
                charge = %sp.telegram_payment_charge_id,
                "successful_payment without a payer the server can record; Telegram redelivers"
            );
            return Handled::Retry;
        };
        let fact = PaymentFact {
            payer: UserId(payer),
            currency: sp.currency.clone(),
            total_amount: sp.total_amount,
            invoice_payload: sp.invoice_payload.clone(),
            charge: ChargeId(sp.telegram_payment_charge_id.clone()),
            provider_charge: sp.provider_payment_charge_id.clone(),
        };
        return grant(st, &fact).await;
    }
    if m.refunded_payment.is_some() {
        tracing::warn!(
            "refunded_payment acknowledged unhandled: refund handling is a later lane's"
        );
    }
    Handled::Ack
}

/// The grant for `fact`: 200 after the commit, whatever the outcome; 500 on a database error, so Telegram
/// redelivers and the idempotent grant runs again.
async fn grant(st: &AppState, fact: &PaymentFact) -> Handled {
    match payments::on_successful_payment(st, fact).await {
        Ok(_) => Handled::Ack,
        Err(e) => {
            tracing::error!(charge = %fact.charge.0, error = %e, "grant failed; Telegram redelivers");
            Handled::Retry
        }
    }
}

/// P5: the decision, then its answer. A database error is logged and answered `Temporary`; Telegram is answered either
/// way, and the update is acknowledged.
async fn pre_checkout(st: &AppState, q: &PreCheckoutQuery) {
    let verdict = match payments::on_pre_checkout(st, q).await {
        Ok(verdict) => verdict,
        Err(e) => {
            tracing::error!(error = %e, "pre-checkout database step failed; answered as temporary");
            PreCheckoutVerdict::Reject(RejectReason::Temporary)
        }
    };
    payments::answer_pre_checkout(st, q, verdict).await;
}
