//! `POST /telegram/webhook` (K17): the one door for Telegram's updates. The secret header is compared in constant
//! time before the body is read, so a forged update is refused before it is buffered; the body is then read as
//! bytes, up to [`WEBHOOK_BODY_LIMIT`], and decoded as frankenstein's `Update`. A body that
//! decode refuses is read again by a lenient payment probe, so a payment or a refund the pinned types cannot decode
//! still reaches the same grant or revoke; anything else undecodable is acknowledged, and an unreadable payment or
//! refund is retried.
//!
//! Logs never carry the body, the headers or the secret: a decode error is logged by its class and position only,
//! because its text can quote a field value.

use axum::body::Body;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use frankenstein::payments::PreCheckoutQuery;
use frankenstein::types::Message;
use frankenstein::updates::{Update, UpdateContent};
use serde::Deserialize;
use serde_json::Value;
use subtle::ConstantTimeEq;

use crate::AppState;
use crate::ids::{ChargeId, UserId};
use crate::puzzles::Lang;
use crate::telegram::commands;
use crate::telegram::payments::{self, PaymentFact, PreCheckoutVerdict, RejectReason};

/// The webhook's body limit (PP "HTTP API": 1 MB): far above any update, applied by the handler once the secret
/// matched.
pub const WEBHOOK_BODY_LIMIT: usize = 1024 * 1024;

/// The header Telegram sends `setWebhook`'s `secret_token` in.
const SECRET_HEADER: &str = "x-telegram-bot-api-secret-token";

/// The `successful_payment` fields the grant reads, decoded leniently (K17): unknown fields are ignored and
/// `provider_payment_charge_id` may be absent.
#[derive(Deserialize)]
struct ProbeSuccessful {
    currency: String,
    total_amount: u32,
    invoice_payload: String,
    telegram_payment_charge_id: String,
    provider_payment_charge_id: Option<String>,
}

/// The `refunded_payment` field the revoke reads, decoded leniently (K17): the charge id only, so no field the revoke
/// never uses can turn a readable refund into a redelivery loop; unknown fields are ignored.
#[derive(Deserialize)]
struct ProbeRefunded {
    telegram_payment_charge_id: String,
}

/// What the handler made of an update: acknowledged (200, Telegram forgets it) or to be redelivered (500).
enum Handled {
    /// Done, or nothing to do: 200.
    Ack,
    /// A money fact was not recorded: 500, so Telegram sends the update again.
    Retry,
}

/// `POST /telegram/webhook`: 401 unless exactly one `X-Telegram-Bot-Api-Secret-Token` equals `WEBHOOK_SECRET`, with
/// the body unread; 413 when the body exceeds [`WEBHOOK_BODY_LIMIT`]; else the update is handled and answered 200,
/// or 500 when a money fact could not be recorded.
pub async fn webhook(State(st): State<AppState>, headers: HeaderMap, body: Body) -> StatusCode {
    if !secret_ok(&headers, st.cfg.webhook_secret.as_bytes()) {
        return StatusCode::UNAUTHORIZED;
    }
    // The limit is the one error a whole request can meet here; a body cut off mid-stream has no reader of the
    // answer, so it shares the 413.
    let Ok(body) = axum::body::to_bytes(body, WEBHOOK_BODY_LIMIT).await else {
        return StatusCode::PAYLOAD_TOO_LARGE;
    };
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
        Err(e) => probe(st, body, &e).await,
    }
}

/// K17: a body the full decode refused, navigated as plain JSON, so a malformed sibling field cannot hide a payment.
/// An update whose `message.successful_payment` is present and not null is payment-bearing: with its money fields
/// and a payer id in `i64` readable it goes through the same grant, else it is retried (500), never acknowledged
/// away. Without one, a present and not null `message.refunded_payment` is refund-bearing: with its charge id
/// readable it goes through the same revoke, else it is retried. Anything else (not JSON, an unknown update kind, a
/// changed non-payment type) is acknowledged; an undecodable pre-checkout stays unanswered, so Telegram cancels it
/// and no money moves.
async fn probe(st: &AppState, body: &[u8], decode: &serde_json::Error) -> Handled {
    let (class, line, column) = (decode.classify(), decode.line(), decode.column());
    let Ok(update) = serde_json::from_slice::<Value>(body) else {
        tracing::warn!(
            ?class,
            line,
            column,
            "webhook: body is not JSON; acknowledged"
        );
        return Handled::Ack;
    };
    let Some(payment) = update
        .pointer("/message/successful_payment")
        .filter(|v| !v.is_null())
    else {
        if let Some(refunded) = update
            .pointer("/message/refunded_payment")
            .filter(|v| !v.is_null())
        {
            return probe_refund(st, refunded, decode).await;
        }
        tracing::warn!(
            ?class,
            line,
            column,
            "webhook: undecodable update without a payment; acknowledged"
        );
        return Handled::Ack;
    };
    let payer = update
        .pointer("/message/from/id")
        .and_then(Value::as_u64)
        .and_then(|id| i64::try_from(id).ok());
    // The probe's own error is not logged: its text can quote a field value.
    let (Ok(fields), Some(payer)) = (ProbeSuccessful::deserialize(payment), payer) else {
        tracing::error!(
            ?class,
            line,
            column,
            "webhook: payment update unreadable; Telegram redelivers"
        );
        return Handled::Retry;
    };
    tracing::warn!(
        ?class,
        line,
        column,
        charge = %fields.telegram_payment_charge_id,
        "webhook: payment read by the lenient probe"
    );
    let fact = PaymentFact {
        payer: UserId(payer),
        currency: fields.currency,
        total_amount: fields.total_amount,
        invoice_payload: fields.invoice_payload,
        charge: ChargeId(fields.telegram_payment_charge_id),
        provider_charge: fields.provider_payment_charge_id.unwrap_or_default(),
    };
    let lang = payments::payer_lang(
        update
            .pointer("/message/from/language_code")
            .and_then(Value::as_str),
    );
    grant(st, &fact, lang).await
}

/// K17 for a refund: the charge id of a `refunded_payment` the full decode refused, through the same revoke; an
/// unreadable charge id is retried (500).
async fn probe_refund(st: &AppState, refunded: &Value, decode: &serde_json::Error) -> Handled {
    let (class, line, column) = (decode.classify(), decode.line(), decode.column());
    // The probe's own error is not logged: its text can quote a field value.
    let Ok(fields) = ProbeRefunded::deserialize(refunded) else {
        tracing::error!(
            ?class,
            line,
            column,
            "webhook: refund update unreadable; Telegram redelivers"
        );
        return Handled::Retry;
    };
    tracing::warn!(
        ?class,
        line,
        column,
        charge = %fields.telegram_payment_charge_id,
        "webhook: refund read by the lenient probe"
    );
    refund(st, &ChargeId(fields.telegram_payment_charge_id)).await
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
/// (no `from`, an id beyond `i64`) is retried, never acknowledged away. A `refunded_payment` is revoked by its charge,
/// and acknowledged only after the commit (K20). A text message is a command when it is one ([`commands::on_text`]):
/// answered, then acknowledged; retried only when an admin refund's database step failed; a `/paysupport` read
/// failure is answered and acknowledged — a 500 would hold the chat's later updates, the payer's `successful_payment`
/// included (critique O2). Any other message is acknowledged.
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
        let lang = payments::payer_lang(
            m.from
                .as_ref()
                .and_then(|from| from.language_code.as_deref()),
        );
        return grant(st, &fact, lang).await;
    }
    if let Some(rp) = &m.refunded_payment {
        return refund(st, &ChargeId(rp.telegram_payment_charge_id.clone())).await;
    }
    match commands::on_text(st, m).await {
        Ok(()) => Handled::Ack,
        Err(e) => {
            tracing::error!(error = %e, "bot command failed; Telegram redelivers");
            Handled::Retry
        }
    }
}

/// The grant for `fact`: 200 after the commit, whatever the outcome, an unapplied one after its notice in `lang`
/// (the payment message's language) and its first automatic refund attempt, both within one Bot API deadline
/// ([`payments::after_grant`]); a refund that fails is retried by the sweep, never answered 500 (a 500 would hold the
/// chat's later updates). 500 only on the grant's own database error, so Telegram redelivers and the idempotent grant
/// runs again.
async fn grant(st: &AppState, fact: &PaymentFact, lang: Lang) -> Handled {
    match payments::on_successful_payment(st, fact).await {
        Ok(outcome) => {
            payments::after_grant(st, fact, outcome, lang).await;
            Handled::Ack
        }
        Err(e) => {
            tracing::error!(charge = %fact.charge.0, error = %e, "grant failed; Telegram redelivers");
            Handled::Retry
        }
    }
}

/// The revoke of `charge`: 200 after the commit, whatever the outcome (the revoke logs an unknown charge); 500 on a
/// database error, so Telegram redelivers and the guarded revoke runs again.
async fn refund(st: &AppState, charge: &ChargeId) -> Handled {
    match payments::revoke(st, charge).await {
        Ok(_) => Handled::Ack,
        Err(e) => {
            tracing::error!(charge = %charge.0, error = %e, "revoke failed; Telegram redelivers");
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
