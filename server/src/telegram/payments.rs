//! The payment path's Telegram half (K18): the pre-checkout decision under its deadline, its answer under the Bot
//! API deadline, and the reject texts in the payer's language (PE4: a `match` here until the bot texts move to
//! `bot.*.json`). The decision types are `db::payments`'s, re-exported here.
//!
//! Principle 2: Telegram must receive the answer within 10 s of the query. The database step is bounded by
//! [`PRECHECKOUT_DB_DEADLINE`] and the answer by [`CALL_DEADLINE`], and nothing else runs on the path.

use std::time::Duration;

use frankenstein::payments::PreCheckoutQuery;

use crate::AppState;
use crate::db::orders::parse_order_id;
use crate::ids::UserId;
use crate::puzzles::Lang;
use crate::telegram::gateway::CALL_DEADLINE;

pub use crate::db::payments::{PreCheckoutVerdict, RejectReason};

/// The deadline of the pre-checkout's database step (K18).
pub const PRECHECKOUT_DB_DEADLINE: Duration = Duration::from_secs(2);

// The 10 s rule as a compile-time fact: both deadlines together stay below it.
const _: () = assert!(PRECHECKOUT_DB_DEADLINE.as_secs() + CALL_DEADLINE.as_secs() < 10);

/// The primary language subtags whose speakers get Russian texts (K29); every other tag, or none, gets English.
const RUSSIAN_LANGS: [&str; 4] = ["ru", "uk", "be", "kk"];

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

/// The `error_message` of a refused pre-checkout: plain, with no price and no legal claim (placeholder copy until
/// the bot texts move to `bot.*.json`).
pub fn reject_text(reason: RejectReason, lang: Lang) -> &'static str {
    match (reason, lang) {
        (RejectReason::UnknownOrder, Lang::Ru) => {
            "Этот счёт не найден. Откройте покупку в приложении ещё раз."
        }
        (RejectReason::UnknownOrder, Lang::En) => {
            "This invoice was not found. Please start the purchase again in the app."
        }
        (RejectReason::Mismatch, Lang::Ru) => {
            "Счёт не совпадает с заказом. Откройте покупку в приложении ещё раз."
        }
        (RejectReason::Mismatch, Lang::En) => {
            "This invoice does not match the order. Please start the purchase again in the app."
        }
        (RejectReason::AlreadyOwned, Lang::Ru) => "Эта покупка уже ваша, оплата не нужна.",
        (RejectReason::AlreadyOwned, Lang::En) => "You already own this, no payment is needed.",
        (RejectReason::InProgress, Lang::Ru) => {
            "Эта покупка уже оплачивается. Подождите пару минут и проверьте её в приложении."
        }
        (RejectReason::InProgress, Lang::En) => {
            "This purchase is already being paid for. Please wait a couple of minutes and check the app."
        }
        (RejectReason::Expired, Lang::Ru) => {
            "Срок действия счёта истёк. Откройте покупку в приложении ещё раз."
        }
        (RejectReason::Expired, Lang::En) => {
            "This invoice has expired. Please start the purchase again in the app."
        }
        (RejectReason::Temporary, Lang::Ru) => {
            "Не удалось проверить заказ. Попробуйте ещё раз через минуту."
        }
        (RejectReason::Temporary, Lang::En) => {
            "The order could not be checked. Please try again in a minute."
        }
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
