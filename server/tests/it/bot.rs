//! The bot (PP "Bot texts", K20-K22): its texts in `server/locales/bot.*.json` within Telegram's bounds, Russian
//! first; a pre-checkout refusal in the query's language.
//!
//! Every state calls the Bot API through [`RecordingGateway`]: no test reaches Telegram.
//!
//! [`RecordingGateway`]: crate::payments::RecordingGateway

use server::puzzles::Lang;
use server::telegram::payments::RejectReason;
use server::telegram::texts::{self, BotFile, MESSAGE_LIMIT, fill};

use crate::catalog::{ANN, own};
use crate::payments::{invoice_state, refusal};
use crate::refunds::{BEN, order_of};
use crate::webhook::{post_update, pre_checkout_update};

fn report(failures: &[String]) {
    assert!(
        failures.is_empty(),
        "{} failures:\n{}",
        failures.len(),
        failures.join("\n")
    );
}

/// The `{name}` placeholders of `text` (lower-case ASCII and `_`), sorted and deduplicated, or the first stray brace.
fn placeholders(text: &str) -> Result<Vec<&str>, String> {
    let mut names = Vec::new();
    let mut rest = text;
    loop {
        match (rest.find('{'), rest.find('}')) {
            (None, None) => break,
            (Some(open), Some(close)) if open < close => {
                let name = &rest[open + 1..close];
                if name.is_empty() || !name.bytes().all(|b| b.is_ascii_lowercase() || b == b'_') {
                    return Err(format!("a brace pair around {name:?}"));
                }
                names.push(name);
                rest = &rest[close + 1..];
            }
            _ => return Err("an unpaired brace".to_owned()),
        }
    }
    names.sort_unstable();
    names.dedup();
    Ok(names)
}

/// `[a, b]` for a list of names.
fn listed(names: &[&str]) -> String {
    format!("[{}]", names.join(", "))
}

/// The characters of the longest `/paysupport` of 20 charges whose ids are 64 characters, laid out as the command
/// lays it out: the intro, a blank line, then one line per charge with the longer status after a space.
fn longest_paysupport(file: &BotFile) -> usize {
    let t = &file.texts;
    let charge = "c".repeat(64);
    let line = fill(
        &t.paysupport_line,
        &[
            ("date", "2027-01-01"),
            ("charge", &charge),
            ("amount", "1000"),
        ],
    );
    let status = t
        .paysupport_not_applied
        .chars()
        .count()
        .max(t.paysupport_refunded.chars().count());
    t.paysupport.chars().count() + 1 + 20 * (1 + line.chars().count() + 1 + status)
}

/// The failure lines of one language's file: each text within its bound (1 to its limit, not blank) with exactly its
/// placeholders; `drafts` exactly `paysupport`, `support`, `terms`, each a key; 20 charges fit one `/paysupport`.
fn file_failures(lang: &str, file: &BotFile) -> Vec<String> {
    let mut failures = Vec::new();
    let entries = file.texts.entries();
    for e in &entries {
        let chars = e.text.chars().count();
        if !(1..=e.limit).contains(&chars) {
            failures.push(format!(
                "{} {lang}: expected 1-{} characters, got {chars}",
                e.key, e.limit
            ));
        }
        if e.text.trim().is_empty() {
            failures.push(format!("{} {lang}: blank", e.key));
        }
        match placeholders(e.text) {
            Ok(names) if names == e.placeholders => {}
            Ok(names) => failures.push(format!(
                "{} {lang}: expected placeholders {}, got {}",
                e.key,
                listed(e.placeholders),
                listed(&names)
            )),
            Err(why) => failures.push(format!("{} {lang}: {why}", e.key)),
        }
    }
    if file.drafts != ["paysupport", "support", "terms"] {
        failures.push(format!(
            "drafts {lang}: expected [paysupport, support, terms], got {:?}",
            file.drafts
        ));
    }
    for draft in &file.drafts {
        if !entries.iter().any(|e| e.key == draft) {
            failures.push(format!("drafts {lang}: {draft} is not a text key"));
        }
    }
    let longest = longest_paysupport(file);
    if longest > MESSAGE_LIMIT {
        failures.push(format!(
            "paysupport {lang}: 20 charges of 64 characters need {longest} characters, over {MESSAGE_LIMIT}"
        ));
    }
    failures
}

/// Both `bot.*.json` files parse into every text, each within Telegram's bound (a message 1-4096 characters, a
/// command description 1-256, a button 1-64, a refusal 1-255) with exactly its placeholders; a key's Russian and
/// English texts differ; the placeholder texts are marked as drafts; 20 charges fit one `/paysupport`.
#[test]
fn bot_texts_complete_and_within_limits() {
    let mut failures = Vec::new();
    for (lang, json) in [("ru", texts::BOT_RU_JSON), ("en", texts::BOT_EN_JSON)] {
        match texts::parse(json) {
            Ok(file) => failures.extend(file_failures(lang, &file)),
            Err(e) => failures.push(format!("bot.{lang}.json: expected every text, got {e}")),
        }
    }
    let ru = texts::texts(Lang::Ru).entries();
    let en = texts::texts(Lang::En).entries();
    for (r, e) in ru.iter().zip(&en) {
        if r.text == e.text {
            failures.push(format!("{}: the ru and en texts are the same", r.key));
        }
    }
    report(&failures);
}

/// K29 for refusals: the refusal is in the language of the query's `from.language_code`, not the users row's (which
/// is the last login's, possibly stale). A payer whose row says `en` but whose query says `ru` gets the Russian
/// `AlreadyOwned` text, and the inverse the English one.
#[tokio::test]
async fn bot_precheckout_refusal_language_from_query() {
    let (st, _db, gateway) = invoice_state(&[(ANN, Some("en")), (BEN, Some("ru"))]).await;
    let mut failures = Vec::new();
    for (case, user, query_lang, want) in [
        ("users en, query ru", ANN, "ru", Lang::Ru),
        ("users ru, query en", BEN, "en", Lang::En),
    ] {
        let Some((order, amount)) = order_of(&st, user, "chapter:ch2", &mut failures).await else {
            continue;
        };
        own(&st, user, "chapter:ch2").await;
        let query_id = format!("q-{user}");
        let update = pre_checkout_update(&query_id, user, Some(query_lang), "XTR", amount, &order);
        let reply = post_update(&st, &update).await;
        let want = refusal(RejectReason::AlreadyOwned, want);
        let got = gateway.answer(&query_id);
        if reply.status.as_u16() != 200 || got.as_ref() != Some(&want) {
            failures.push(format!(
                "{case}: expected the {query_lang} text {want:?}, got {} {got:?}",
                reply.status.as_u16()
            ));
        }
    }
    report(&failures);
}
