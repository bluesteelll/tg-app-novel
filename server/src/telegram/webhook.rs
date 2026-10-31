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
use frankenstein::updates::{Update, UpdateContent};
use subtle::ConstantTimeEq;

use crate::AppState;
use crate::telegram::payments::{self, PreCheckoutVerdict, RejectReason};

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

/// One decoded update: a pre-checkout is decided and answered. A payment cannot be recorded in this build yet, so it
/// is never acknowledged.
async fn dispatch(st: &AppState, update: Update) -> Handled {
    match update.content {
        UpdateContent::PreCheckoutQuery(q) => {
            pre_checkout(st, &q).await;
            Handled::Ack
        }
        UpdateContent::Message(m) if m.successful_payment.is_some() => {
            tracing::error!("webhook: successful_payment not recorded; Telegram redelivers");
            Handled::Retry
        }
        _ => Handled::Ack,
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
