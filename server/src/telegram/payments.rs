//! The payment path's Telegram half: the pre-checkout decision under its deadline, its answer under the Bot API
//! deadline, and the reject texts in the payer's language (K18; the texts live in `server/locales/bot.*.json`); the
//! grant on `successful_payment` (K19) and the automatic refund of a charge it could not apply (owner Q9); the revoke
//! of a refund and the admin refund (K20). The fact, decision and outcome types are `db::payments`'s, re-exported
//! here.
//!
//! Principle 2: Telegram must receive the pre-checkout answer within 10 s of the query. The database step is bounded
//! by [`PRECHECKOUT_DB_DEADLINE`] and the answer by [`CALL_DEADLINE`], and nothing else runs on the path. The grant
//! runs only on `successful_payment`, never here in the pre-checkout.

use std::time::Duration;

use frankenstein::payments::PreCheckoutQuery;
use tokio::time::Instant;

use crate::AppState;
use crate::db::orders::parse_order_id;
use crate::db::without_nul;
use crate::ids::{ChargeId, UserId};
use crate::puzzles::Lang;
use crate::telegram::gateway::{CALL_DEADLINE, GatewayError, OutMessage};
use crate::telegram::texts::{self, fill};

pub use crate::db::payments::{
    AutoRefundRetry, GrantOutcome, PaymentFact, PreCheckoutVerdict, RejectReason, RevokeOutcome,
};

/// The deadline of the pre-checkout's database step (K18).
pub const PRECHECKOUT_DB_DEADLINE: Duration = Duration::from_secs(2);

// The 10 s rule as a compile-time fact: both deadlines together stay below it, in milliseconds (`as_secs` truncates,
// so 5.5 s + 4.6 s would pass as 5 + 4).
const _: () = assert!(PRECHECKOUT_DB_DEADLINE.as_millis() + CALL_DEADLINE.as_millis() < 10_000);

/// How long a claimed automatic refund attempt holds its row, in seconds: an attempt that died after its claim (a
/// crash, a dropped future) leaves the row claimable again after this, and the retry meets `CHARGE_ALREADY_REFUNDED`
/// if the first call went through.
pub const AUTO_REFUND_LEASE_SECS: i64 = 60;

// A live attempt is never claimed twice: its call is cut at one `CALL_DEADLINE`, well inside the lease.
const _: () = assert!(CALL_DEADLINE.as_millis() < (AUTO_REFUND_LEASE_SECS as u128) * 1000);

/// The wait after a first failed automatic refund attempt, in seconds; it doubles per attempt up to
/// [`AUTO_REFUND_MAX_WAIT_SECS`].
const AUTO_REFUND_FIRST_WAIT_SECS: i64 = 60;

/// The longest wait between two automatic refund attempts, in seconds.
const AUTO_REFUND_MAX_WAIT_SECS: i64 = 3600;

/// The primary language subtags whose speakers get Russian texts (K29); every other tag, or none, gets English.
pub(crate) const RUSSIAN_LANGS: [&str; 4] = ["ru", "uk", "be", "kk"];

/// The pre-checkout decision on `q` at the state's clock. A payload outside the order id grammar is `UnknownOrder`
/// and a payer id outside `i64` is `Mismatch`, both with no SQL (junk and U+0000 never reach the database); else the
/// repository decides within [`PRECHECKOUT_DB_DEADLINE`], and running out of it is `Temporary`. A database error is
/// returned: the webhook logs it and answers `Temporary`.
pub async fn on_pre_checkout(
    st: &AppState,
    q: &PreCheckoutQuery,
) -> Result<PreCheckoutVerdict, sqlx::Error> {
    let Some(order) = parse_order_id(&q.invoice_payload) else {
        return Ok(PreCheckoutVerdict::Reject(RejectReason::UnknownOrder));
    };
    let Ok(payer) = i64::try_from(q.from.id) else {
        return Ok(PreCheckoutVerdict::Reject(RejectReason::Mismatch));
    };
    let decision = st.repo.pre_checkout(
        UserId(payer),
        &order,
        &q.currency,
        q.total_amount,
        st.clock.now(),
    );
    match tokio::time::timeout(PRECHECKOUT_DB_DEADLINE, decision).await {
        Ok(verdict) => verdict,
        // The dropped transaction rolls back when its connection returns to the pool;
        // `idle_in_transaction_session_timeout` is the backstop. A timeout landing after the COMMIT leaves the order
        // in `checkout` behind a refusal: no money moves, and a retry is `InProgress` for the checkout window.
        Err(_) => Ok(PreCheckoutVerdict::Reject(RejectReason::Temporary)),
    }
}

/// `answerPreCheckoutQuery` for `q` with `verdict`, after the database step and outside every transaction. A refusal
/// carries the reason's text in the payer's Telegram language (`q.from.language_code`). The call is cut at
/// [`CALL_DEADLINE`] here too, whatever the gateway does; a failure or a timeout is logged, and the webhook still
/// answers 200: Telegram cancels an unanswered checkout itself.
pub async fn answer_pre_checkout(st: &AppState, q: &PreCheckoutQuery, verdict: PreCheckoutVerdict) {
    let answer = match verdict {
        PreCheckoutVerdict::Ok => Ok(()),
        PreCheckoutVerdict::Reject(reason) => {
            let lang = payer_lang(q.from.language_code.as_deref());
            Err(reject_text(reason, lang).to_owned())
        }
    };
    let call = st.gateway.answer_pre_checkout(q.id.clone(), answer);
    match tokio::time::timeout(CALL_DEADLINE, call).await {
        Ok(Ok(())) => tracing::info!(?verdict, "pre-checkout answered"),
        Ok(Err(e)) => tracing::warn!(?verdict, error = %e, "answerPreCheckoutQuery failed"),
        Err(_) => tracing::warn!(?verdict, "answerPreCheckoutQuery timed out"),
    }
}

/// P6: the grant for `fact` at the state's clock (the server's receipt time). Every outcome is committed and logged
/// with the charge id (not a secret): an applied one at `info`, `AlreadyEntitled` at `warn`, the other unapplied
/// ones at `error`. Only a database error is `Err`: the webhook answers 500, and Telegram redelivers.
pub async fn on_successful_payment(
    st: &AppState,
    fact: &PaymentFact,
) -> Result<GrantOutcome, sqlx::Error> {
    let outcome = st.repo.grant(fact, st.clock.now()).await?;
    let charge = fact.charge.0.as_str();
    match outcome {
        GrantOutcome::Granted | GrantOutcome::Duplicate => {
            tracing::info!(charge, ?outcome, "payment recorded");
        }
        GrantOutcome::AlreadyEntitled => {
            tracing::warn!(
                charge,
                ?outcome,
                "payment recorded, product already owned: not applied"
            );
        }
        GrantOutcome::OrderMismatch | GrantOutcome::UnknownProduct => {
            tracing::error!(charge, ?outcome, "payment recorded, not applied");
        }
    }
    Ok(outcome)
}

/// What follows the committed grant of `fact` (owner Q9). An applied payment and a redelivery (`Duplicate`) do
/// nothing: a redelivered charge's refund belongs to its row's schedule. An unapplied one (`OrderMismatch`,
/// `AlreadyEntitled`, `UnknownProduct`), whose `auto_refunds` row the grant committed with it, gets M19's notice first
/// (the payer in `lang`, their payment message's language, and each admin in Russian), then one refund attempt. Both
/// share one [`CALL_DEADLINE`], so the webhook's answer waits at most one deadline past the grant, as the notice alone
/// did; the notice goes first so a hung refund call cannot starve it. An attempt the deadline leaves no room for
/// stays due, and the sweep takes it. Never an error: the money fact and its refund's schedule are committed.
pub async fn after_grant(st: &AppState, fact: &PaymentFact, outcome: GrantOutcome, lang: Lang) {
    // No wildcard arm: a new outcome does not compile until it is sorted into applied or not here.
    match outcome {
        GrantOutcome::Granted | GrantOutcome::Duplicate => return,
        GrantOutcome::OrderMismatch
        | GrantOutcome::AlreadyEntitled
        | GrantOutcome::UnknownProduct => {}
    }
    let deadline = Instant::now() + CALL_DEADLINE;
    notify_unapplied(st, fact, outcome, lang, deadline).await;
    // The stored id (U+0000 replaced, as the grant bound it): the sweep and `/refund` send the same one.
    let charge = ChargeId(without_nul(&fact.charge.0).into_owned());
    if Instant::now() >= deadline {
        tracing::warn!(
            charge = %charge.0,
            "auto-refund: no time left after the notice; the sweep attempts it"
        );
        return;
    }
    let first = attempt(st, &charge, deadline).await;
    tracing::info!(charge = %charge.0, ?first, "auto-refund: first attempt");
}

/// M19's notice of a payment recorded but not applied: the payer is told in `lang`, and each admin in Russian, with
/// the charge id. The whole notice, sent one message after another, is cut at `deadline`; a failure or the cut is
/// logged, never an error: the money fact is recorded already.
async fn notify_unapplied(
    st: &AppState,
    fact: &PaymentFact,
    outcome: GrantOutcome,
    lang: Lang,
    deadline: Instant,
) {
    let charge = fact.charge.0.as_str();
    let payer = fact.payer.0.to_string();
    let word = format!("{outcome:?}");
    let to_payer = OutMessage {
        chat_id: fact.payer.0,
        text: fill(&texts::texts(lang).payment_unapplied, &[("charge", charge)]),
        web_app_button: None,
    };
    let admin_text = fill(
        &texts::texts(Lang::Ru).admin_unapplied,
        &[("charge", charge), ("payer", &payer), ("outcome", &word)],
    );
    let notice = async {
        if let Err(e) = st.gateway.send_message(to_payer).await {
            tracing::warn!(charge, error = %e, "unapplied payment: the payer's notice failed");
        }
        for &admin in &st.cfg.admin_telegram_ids {
            let to_admin = OutMessage {
                chat_id: admin,
                text: admin_text.clone(),
                web_app_button: None,
            };
            if let Err(e) = st.gateway.send_message(to_admin).await {
                tracing::warn!(charge, error = %e, "unapplied payment: an admin's notice failed");
            }
        }
    };
    if tokio::time::timeout_at(deadline, notice).await.is_err() {
        tracing::warn!(
            charge,
            "unapplied payment: the notice was cut at the deadline"
        );
    }
}

/// What one automatic refund attempt did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Attempt {
    /// No row claimed: not due, claimed by another attempt, settled or given up (or the claim itself failed: logged).
    NotDue,
    /// Telegram refunded (or answered the charge was refunded before) and the revoke recorded it: settled.
    Refunded,
    /// The call or the revoke failed: the row is due again at the backoff's time, or, when a database step after the
    /// call failed (logged), at its lease's end.
    Failed,
}

/// One automatic refund attempt of `charge` (its stored id), its Bot API call cut at `deadline`:
/// 1. the claim ([`Repo::claim_auto_refund`]), the arbiter among attempts; no row → [`Attempt::NotDue`];
/// 2. `refundStarPayment` to the payment row's payer, with no transaction open;
/// 3. Telegram refunded, or answers `CHARGE_ALREADY_REFUNDED` (a lost answer, the admin's `/refund` first): the one
///    guarded [`revoke`], which settles the row. A database error leaves the row claimed until its lease, and the
///    retry meets `CHARGE_ALREADY_REFUNDED`;
/// 4. any other answer: the failure write ([`Repo::auto_refund_failed`]), due again after
///    [`auto_refund_backoff`]. `Api` and `Disabled` count as refusals; a timeout or a transport break does not
///    (Telegram may not have seen the call, and the retry is safe either way).
///
/// [`Repo::claim_auto_refund`]: crate::db::Repo::claim_auto_refund
/// [`Repo::auto_refund_failed`]: crate::db::Repo::auto_refund_failed
async fn attempt(st: &AppState, charge: &ChargeId, deadline: Instant) -> Attempt {
    let now = st.clock.now();
    let lease_until = now.saturating_add(AUTO_REFUND_LEASE_SECS);
    let (payer, attempts) = match st.repo.claim_auto_refund(charge, now, lease_until).await {
        Ok(Some(claimed)) => claimed,
        Ok(None) => return Attempt::NotDue,
        Err(e) => {
            tracing::error!(charge = %charge.0, error = %e, "auto-refund: the claim failed");
            return Attempt::NotDue;
        }
    };
    let call = st.gateway.refund_star_payment(payer, charge.clone());
    let answer = match tokio::time::timeout_at(deadline, call).await {
        Ok(answer) => answer,
        Err(_) => Err(GatewayError::Timeout),
    };
    let failure = match answer {
        Ok(()) => None,
        Err(e) if already_refunded(&e) => {
            tracing::warn!(charge = %charge.0, "auto-refund: refunded before; revoking");
            None
        }
        Err(e) => Some(e),
    };
    let (error, refused) = match failure {
        Some(e) => {
            // No wildcard arm: a new gateway error does not compile until it is sorted here.
            let refused = match &e {
                GatewayError::Timeout | GatewayError::Transport(_) => false,
                GatewayError::Api(_) | GatewayError::Disabled => true,
            };
            (e.to_string(), refused)
        }
        None => match revoke(st, charge).await {
            Ok(RevokeOutcome::Revoked) => return Attempt::Refunded,
            Ok(RevokeOutcome::AlreadyRefunded) => {
                // Another path's revoke ran first and settled the row; a `refunded_at` written outside the revoke
                // did not (critique O3), so the row is settled here too.
                if let Err(e) = st.repo.settle_auto_refund(charge).await {
                    tracing::error!(charge = %charge.0, error = %e, "auto-refund: settling failed");
                }
                return Attempt::Refunded;
            }
            // Unreachable under `auto_refunds_charge_fk`: recorded as a refusal, so it cannot loop unseen.
            Ok(RevokeOutcome::UnknownCharge) => ("revoke: no payment row".to_owned(), true),
            Err(e) => {
                tracing::error!(
                    charge = %charge.0,
                    error = %e,
                    "auto-refund: the revoke failed; retried after the lease"
                );
                return Attempt::Failed;
            }
        },
    };
    let next_due = st.clock.now().saturating_add(auto_refund_backoff(attempts));
    match st
        .repo
        .auto_refund_failed(charge, attempts, refused, next_due, &error)
        .await
    {
        Ok(AutoRefundRetry::Scheduled) => {
            // Logged after the write returned: a reader of this line sees the row as written.
            tracing::warn!(
                charge = %charge.0,
                attempts,
                refused,
                error = %error,
                next_due,
                "auto-refund attempt failed"
            );
        }
        Ok(AutoRefundRetry::Superseded) => {
            tracing::warn!(
                charge = %charge.0,
                attempts,
                error = %error,
                "auto-refund attempt failed; the row moved on meanwhile"
            );
        }
        Err(e) => {
            tracing::error!(
                charge = %charge.0,
                error = %e,
                "auto-refund: the failure write failed; retried after the lease"
            );
        }
    }
    Attempt::Failed
}

/// The wait after failed automatic refund attempt number `attempt` (from 1), in seconds:
/// [`AUTO_REFUND_FIRST_WAIT_SECS`] doubled per earlier attempt, capped at [`AUTO_REFUND_MAX_WAIT_SECS`]: 60, 120, 240,
/// 480, 960, 1920, then 3600 for every later one.
pub fn auto_refund_backoff(attempt: i64) -> i64 {
    // 60 << 6 is past the cap already, so the shift never overflows.
    let doublings = attempt.saturating_sub(1).clamp(0, 6);
    (AUTO_REFUND_FIRST_WAIT_SECS << doublings).min(AUTO_REFUND_MAX_WAIT_SECS)
}

/// K20: the revoke of `charge` at the state's clock, through the one guarded transaction ([`Repo::revoke`]); both
/// refund paths (`/refund` and `refunded_payment`) end here. The outcome is logged with the charge id (not a secret):
/// `Revoked` and `AlreadyRefunded` at `info`, `UnknownCharge` at `error` (a refund of a charge this server never
/// recorded). Only a database error is `Err`.
///
/// [`Repo::revoke`]: crate::db::Repo::revoke
pub async fn revoke(st: &AppState, charge: &ChargeId) -> Result<RevokeOutcome, sqlx::Error> {
    let outcome = st.repo.revoke(charge, st.clock.now()).await?;
    let charge = charge.0.as_str();
    match outcome {
        RevokeOutcome::Revoked | RevokeOutcome::AlreadyRefunded => {
            tracing::info!(charge, ?outcome, "refund recorded");
        }
        RevokeOutcome::UnknownCharge => {
            tracing::error!(charge, ?outcome, "refund of a charge with no payment row");
        }
    }
    Ok(outcome)
}

/// Why an admin refund did not end in a revoke outcome.
#[derive(Debug, thiserror::Error)]
pub enum RefundError {
    /// `refundStarPayment` failed (other than "already refunded"): nothing moved, the entitlement stays.
    #[error("refundStarPayment: {0}")]
    Gateway(GatewayError),
    /// The database failed: the payment row could not be read, or the revoke did not commit.
    #[error("database: {0}")]
    Db(#[from] sqlx::Error),
}

/// The admin refund of `charge` (`/refund`, `/dev/refund`; K20): the payment row is read first, and an unknown or
/// already refunded charge answers with no Bot API call. Else `refundStarPayment` to the payer, with no transaction
/// open, cut at [`CALL_DEADLINE`]; then the revoke, when Telegram refunded or answers the charge was refunded before
/// (a crash between the two recovers on the next `/refund`). Any other gateway answer moves nothing.
pub async fn admin_refund(st: &AppState, charge: &ChargeId) -> Result<RevokeOutcome, RefundError> {
    let Some(record) = st.repo.payment_record(charge).await? else {
        return Ok(RevokeOutcome::UnknownCharge);
    };
    if record.refunded_at.is_some() {
        return Ok(RevokeOutcome::AlreadyRefunded);
    }
    let call = st.gateway.refund_star_payment(record.payer, charge.clone());
    let refunded = match tokio::time::timeout(CALL_DEADLINE, call).await {
        Ok(answer) => answer,
        Err(_) => Err(GatewayError::Timeout),
    };
    match refunded {
        Ok(()) => {}
        Err(e) if already_refunded(&e) => {
            tracing::warn!(charge = %charge.0, "refundStarPayment: refunded before; revoking");
        }
        Err(e) => {
            tracing::warn!(charge = %charge.0, error = %e, "refundStarPayment failed; nothing revoked");
            return Err(RefundError::Gateway(e));
        }
    }
    Ok(revoke(st, charge).await?)
}

/// Whether `e` is the Bot API saying the charge was refunded before: MTProto's `CHARGE_ALREADY_REFUNDED`, which the
/// Bot API passes on in its description (`"Bad Request: CHARGE_ALREADY_REFUNDED"`). Only an API refusal counts: a
/// transport text is not Telegram's answer.
pub fn already_refunded(e: &GatewayError) -> bool {
    matches!(e, GatewayError::Api(description) if description.contains("CHARGE_ALREADY_REFUNDED"))
}

/// The language of a Telegram language tag (K29, the rule of the invoice texts): its primary subtag, ASCII
/// case-insensitive, in [`RUSSIAN_LANGS`] is Russian; anything else, or no tag, is English.
pub fn payer_lang(language_code: Option<&str>) -> Lang {
    let primary = language_code
        .and_then(|tag| tag.split('-').next())
        .unwrap_or_default();
    if RUSSIAN_LANGS
        .iter()
        .any(|lang| primary.eq_ignore_ascii_case(lang))
    {
        Lang::Ru
    } else {
        Lang::En
    }
}

/// The `error_message` of a refused pre-checkout, from the bot texts of `lang`: plain, with no price and no legal
/// claim. No wildcard arm: a new reason does not compile until its text is named here.
pub fn reject_text(reason: RejectReason, lang: Lang) -> &'static str {
    let t = texts::texts(lang);
    match reason {
        RejectReason::UnknownOrder => &t.reject_unknown_order,
        RejectReason::Mismatch => &t.reject_mismatch,
        RejectReason::AlreadyOwned => &t.reject_already_owned,
        RejectReason::InProgress => &t.reject_in_progress,
        RejectReason::Expired => &t.reject_expired,
        RejectReason::Temporary => &t.reject_temporary,
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::*;

    /// Every reject reason, each at its index in [`index`].
    const REASONS: [RejectReason; 6] = [
        RejectReason::UnknownOrder,
        RejectReason::Mismatch,
        RejectReason::AlreadyOwned,
        RejectReason::InProgress,
        RejectReason::Expired,
        RejectReason::Temporary,
    ];

    /// The index of `reason` in [`REASONS`]: no wildcard arm, so a new reason does not compile until it is listed.
    fn index(reason: RejectReason) -> usize {
        match reason {
            RejectReason::UnknownOrder => 0,
            RejectReason::Mismatch => 1,
            RejectReason::AlreadyOwned => 2,
            RejectReason::InProgress => 3,
            RejectReason::Expired => 4,
            RejectReason::Temporary => 5,
        }
    }

    fn report(failures: &[String]) {
        assert!(
            failures.is_empty(),
            "{} failures:\n{}",
            failures.len(),
            failures.join("\n")
        );
    }

    /// Every (reason, language) has a text of 1-255 characters; the six texts of a language are distinct; a reason's
    /// Russian and English texts differ.
    #[test]
    fn reject_texts_complete_and_distinct() {
        let mut failures = Vec::new();
        for (i, &reason) in REASONS.iter().enumerate() {
            if index(reason) != i {
                failures.push(format!(
                    "REASONS[{i}] is {reason:?}, listed at {}",
                    index(reason)
                ));
            }
        }
        for lang in [Lang::Ru, Lang::En] {
            let texts: HashSet<&str> = REASONS.iter().map(|&r| reject_text(r, lang)).collect();
            if texts.len() != REASONS.len() {
                failures.push(format!(
                    "{lang:?}: expected {} distinct texts, got {}",
                    REASONS.len(),
                    texts.len()
                ));
            }
            for reason in REASONS {
                let chars = reject_text(reason, lang).chars().count();
                if !(1..=255).contains(&chars) {
                    failures.push(format!(
                        "{reason:?} {lang:?}: expected 1-255 characters, got {chars}"
                    ));
                }
            }
        }
        for reason in REASONS {
            if reject_text(reason, Lang::Ru) == reject_text(reason, Lang::En) {
                failures.push(format!("{reason:?}: the ru and en texts are the same"));
            }
        }
        report(&failures);
    }

    /// `CHARGE_ALREADY_REFUNDED` in an API refusal's description is "refunded before"; another refusal, a timeout or
    /// a transport text that happens to quote the word is not.
    #[test]
    fn refund_already_refunded_error_matches() {
        let cases = [
            (
                GatewayError::Api("Bad Request: CHARGE_ALREADY_REFUNDED".to_owned()),
                true,
            ),
            (
                GatewayError::Api("Bad Request: CHARGE_NOT_FOUND".to_owned()),
                false,
            ),
            (GatewayError::Timeout, false),
            (
                GatewayError::Transport("proxy said CHARGE_ALREADY_REFUNDED".to_owned()),
                false,
            ),
            (GatewayError::Disabled, false),
        ];
        let failures: Vec<String> = cases
            .iter()
            .filter(|(e, want)| already_refunded(e) != *want)
            .map(|(e, want)| format!("{e:?}: expected {want}, got {}", already_refunded(e)))
            .collect();
        report(&failures);
    }

    /// K29 with literal expectations (the tags of `invoice_title_in_user_language` and more): the primary subtag,
    /// ASCII case-insensitive, in `ru`, `uk`, `be`, `kk` is Russian; anything else, or no tag, is English.
    #[test]
    fn payer_lang_matches_k29() {
        let cases: [(Option<&str>, Lang); 15] = [
            (Some("ru"), Lang::Ru),
            (Some("uk"), Lang::Ru),
            (Some("be"), Lang::Ru),
            (Some("kk-KZ"), Lang::Ru),
            (Some("en"), Lang::En),
            (Some("de"), Lang::En),
            (None, Lang::En),
            (Some("RU"), Lang::Ru),
            (Some("Kk-KZ"), Lang::Ru),
            (Some("ru-RU"), Lang::Ru),
            (Some("UK"), Lang::Ru),
            (Some(""), Lang::En),
            (Some("rus"), Lang::En),
            (Some("kk_KZ"), Lang::En),
            (Some("en-RU"), Lang::En),
        ];
        let failures: Vec<String> = cases
            .iter()
            .filter(|&&(tag, want)| payer_lang(tag) != want)
            .map(|&(tag, want)| format!("{tag:?}: expected {want:?}, got {:?}", payer_lang(tag)))
            .collect();
        report(&failures);
    }
}
