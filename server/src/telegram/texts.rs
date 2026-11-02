//! The bot's texts (PP V5, OPEN-QUESTIONS Q4): `server/locales/bot.ru.json` and `server/locales/bot.en.json`, Russian
//! first, compiled in and parsed once. Each file is `{ "//": <note>, "drafts": [<key>...], "texts": {<key>: <text>} }`;
//! `drafts` names the texts that are placeholders until the owner's own (`/terms`, `/support`, `/paysupport`).
//!
//! Every text is plain (no parse mode). [`LangTexts::entries`] lists each one with its Telegram bound and its
//! placeholders, and `bot_texts_complete_and_within_limits` checks both files against it.

use std::sync::LazyLock;

use serde::Deserialize;

use crate::config::TelegramEnv;
use crate::puzzles::Lang;

/// `server/locales/bot.ru.json`.
pub const BOT_RU_JSON: &str = include_str!("../../locales/bot.ru.json");

/// `server/locales/bot.en.json`.
pub const BOT_EN_JSON: &str = include_str!("../../locales/bot.en.json");

/// `sendMessage`: 1-4096 characters after entities parsing (no parse mode is used, so the text as is).
pub const MESSAGE_LIMIT: usize = 4096;

/// `BotCommand.description`: 1-256 characters.
pub const COMMAND_DESCRIPTION_LIMIT: usize = 256;

/// A button text: the Bot API documents no bound, this is our own.
pub const BUTTON_LIMIT: usize = 64;

/// `answerPreCheckoutQuery.error_message`: the Bot API documents no bound, this is L8b's own.
pub const REFUSAL_LIMIT: usize = 255;

/// The Russian texts, parsed once. The file is compiled in, `bot_texts_complete_and_within_limits` parses it and
/// [`startup_check`] forces it before a start goes on, so a parse failure here is a bug.
static RU: LazyLock<BotFile> = LazyLock::new(|| {
    parse(BOT_RU_JSON).expect(
        "invariant: server/locales/bot.ru.json parses (pinned by bot_texts_complete_and_within_limits)",
    )
});

/// The English texts, parsed once (as [`RU`]).
static EN: LazyLock<BotFile> = LazyLock::new(|| {
    parse(BOT_EN_JSON).expect(
        "invariant: server/locales/bot.en.json parses (pinned by bot_texts_complete_and_within_limits)",
    )
});

/// One `bot.*.json` file.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BotFile {
    /// The file's own note: what is a placeholder, and whose the final texts are.
    #[serde(rename = "//")]
    pub note: String,
    /// The keys whose texts are placeholders until the owner's VALUES step, sorted.
    pub drafts: Vec<String>,
    /// The texts.
    pub texts: LangTexts,
}

/// The texts of one language. A `{name}` in a text is filled by [`fill`]; each text's placeholders are listed in
/// [`LangTexts::entries`].
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LangTexts {
    /// `/start`: the welcome.
    pub start: String,
    /// The `/start` message's button that opens the Mini App.
    pub start_button: String,
    /// The chat's menu button that opens the Mini App.
    pub menu_button: String,
    /// `/terms` (a draft until the owner's).
    pub terms: String,
    /// `/support` (a draft until the owner's).
    pub support: String,
    /// `/paysupport`'s intro, before the user's charges (a draft until the owner's).
    pub paysupport: String,
    /// `/paysupport` for a user with no payment.
    pub paysupport_none: String,
    /// One charge in `/paysupport`: `{date}`, `{charge}`, `{amount}`.
    pub paysupport_line: String,
    /// Appended to a charge that was recorded but not applied.
    pub paysupport_not_applied: String,
    /// Appended to a refunded charge.
    pub paysupport_refunded: String,
    /// After the listed charges, when more were left out: `{n}`.
    pub paysupport_more: String,
    /// `/paysupport` when the charges cannot be read now, after the intro.
    pub paysupport_unavailable: String,
    /// `/privacy`: `{url}`, the policy page.
    pub privacy: String,
    /// Any other command, and `/refund` from anyone but an admin.
    pub unknown_command: String,
    /// To the payer of a charge recorded but not applied: `{charge}`.
    pub payment_unapplied: String,
    /// To each admin about such a charge: `{charge}`, `{payer}`, `{outcome}`.
    pub admin_unapplied: String,
    /// `/refund` without a usable charge id.
    pub refund_usage: String,
    /// `/refund`: revoked: `{charge}`.
    pub refund_done: String,
    /// `/refund`: the charge was refunded before: `{charge}`.
    pub refund_already: String,
    /// `/refund`: no payment has the charge: `{charge}`.
    pub refund_unknown: String,
    /// `/refund`: Telegram refused, or no call left the process (nothing changed): `{charge}`, `{error}`.
    pub refund_failed: String,
    /// `/refund`: the call timed out or broke off, so Telegram may have refunded; a repeat is safe: `{charge}`,
    /// `{error}`.
    pub refund_unknown_outcome: String,
    /// The command menu's `/start`.
    pub cmd_start: String,
    /// The command menu's `/paysupport`.
    pub cmd_paysupport: String,
    /// The command menu's `/support`.
    pub cmd_support: String,
    /// The command menu's `/terms`.
    pub cmd_terms: String,
    /// The command menu's `/privacy`.
    pub cmd_privacy: String,
    /// A refused pre-checkout: the payload names no order.
    pub reject_unknown_order: String,
    /// A refused pre-checkout: the payer, amount or currency is not the order's.
    pub reject_mismatch: String,
    /// A refused pre-checkout: the payer owns the product.
    pub reject_already_owned: String,
    /// A refused pre-checkout: an order of the product is being paid.
    pub reject_in_progress: String,
    /// A refused pre-checkout: the order is too old, paid or refunded.
    pub reject_expired: String,
    /// A refused pre-checkout: the check failed; try again.
    pub reject_temporary: String,
}

/// One text with its bound: the key, the text, the most characters it may have (the least is 1) and the placeholder
/// names it must use, sorted.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Entry<'a> {
    /// The JSON key.
    pub key: &'static str,
    /// The text.
    pub text: &'a str,
    /// The most characters.
    pub limit: usize,
    /// The `{name}` placeholders, sorted.
    pub placeholders: &'static [&'static str],
}

impl LangTexts {
    /// Every text with its bound and placeholders. The destructuring names every field (no `..`): a new text does not
    /// compile until it is listed here.
    pub fn entries(&self) -> Vec<Entry<'_>> {
        let LangTexts {
            start,
            start_button,
            menu_button,
            terms,
            support,
            paysupport,
            paysupport_none,
            paysupport_line,
            paysupport_not_applied,
            paysupport_refunded,
            paysupport_more,
            paysupport_unavailable,
            privacy,
            unknown_command,
            payment_unapplied,
            admin_unapplied,
            refund_usage,
            refund_done,
            refund_already,
            refund_unknown,
            refund_failed,
            refund_unknown_outcome,
            cmd_start,
            cmd_paysupport,
            cmd_support,
            cmd_terms,
            cmd_privacy,
            reject_unknown_order,
            reject_mismatch,
            reject_already_owned,
            reject_in_progress,
            reject_expired,
            reject_temporary,
        } = self;
        fn entry<'a>(
            key: &'static str,
            text: &'a str,
            limit: usize,
            placeholders: &'static [&'static str],
        ) -> Entry<'a> {
            Entry {
                key,
                text,
                limit,
                placeholders,
            }
        }
        vec![
            entry("start", start, MESSAGE_LIMIT, &[]),
            entry("start_button", start_button, BUTTON_LIMIT, &[]),
            entry("menu_button", menu_button, BUTTON_LIMIT, &[]),
            entry("terms", terms, MESSAGE_LIMIT, &[]),
            entry("support", support, MESSAGE_LIMIT, &[]),
            entry("paysupport", paysupport, MESSAGE_LIMIT, &[]),
            entry("paysupport_none", paysupport_none, MESSAGE_LIMIT, &[]),
            entry(
                "paysupport_line",
                paysupport_line,
                MESSAGE_LIMIT,
                &["amount", "charge", "date"],
            ),
            entry(
                "paysupport_not_applied",
                paysupport_not_applied,
                MESSAGE_LIMIT,
                &[],
            ),
            entry(
                "paysupport_refunded",
                paysupport_refunded,
                MESSAGE_LIMIT,
                &[],
            ),
            entry("paysupport_more", paysupport_more, MESSAGE_LIMIT, &["n"]),
            entry(
                "paysupport_unavailable",
                paysupport_unavailable,
                MESSAGE_LIMIT,
                &[],
            ),
            entry("privacy", privacy, MESSAGE_LIMIT, &["url"]),
            entry("unknown_command", unknown_command, MESSAGE_LIMIT, &[]),
            entry(
                "payment_unapplied",
                payment_unapplied,
                MESSAGE_LIMIT,
                &["charge"],
            ),
            entry(
                "admin_unapplied",
                admin_unapplied,
                MESSAGE_LIMIT,
                &["charge", "outcome", "payer"],
            ),
            entry("refund_usage", refund_usage, MESSAGE_LIMIT, &[]),
            entry("refund_done", refund_done, MESSAGE_LIMIT, &["charge"]),
            entry("refund_already", refund_already, MESSAGE_LIMIT, &["charge"]),
            entry("refund_unknown", refund_unknown, MESSAGE_LIMIT, &["charge"]),
            entry(
                "refund_failed",
                refund_failed,
                MESSAGE_LIMIT,
                &["charge", "error"],
            ),
            entry(
                "refund_unknown_outcome",
                refund_unknown_outcome,
                MESSAGE_LIMIT,
                &["charge", "error"],
            ),
            entry("cmd_start", cmd_start, COMMAND_DESCRIPTION_LIMIT, &[]),
            entry(
                "cmd_paysupport",
                cmd_paysupport,
                COMMAND_DESCRIPTION_LIMIT,
                &[],
            ),
            entry("cmd_support", cmd_support, COMMAND_DESCRIPTION_LIMIT, &[]),
            entry("cmd_terms", cmd_terms, COMMAND_DESCRIPTION_LIMIT, &[]),
            entry("cmd_privacy", cmd_privacy, COMMAND_DESCRIPTION_LIMIT, &[]),
            entry(
                "reject_unknown_order",
                reject_unknown_order,
                REFUSAL_LIMIT,
                &[],
            ),
            entry("reject_mismatch", reject_mismatch, REFUSAL_LIMIT, &[]),
            entry(
                "reject_already_owned",
                reject_already_owned,
                REFUSAL_LIMIT,
                &[],
            ),
            entry("reject_in_progress", reject_in_progress, REFUSAL_LIMIT, &[]),
            entry("reject_expired", reject_expired, REFUSAL_LIMIT, &[]),
            entry("reject_temporary", reject_temporary, REFUSAL_LIMIT, &[]),
        ]
    }
}

/// `json` as a `bot.*.json` file.
pub fn parse(json: &str) -> Result<BotFile, serde_json::Error> {
    serde_json::from_str(json)
}

/// Why the bot texts refuse a start (critique O3, O6).
#[derive(Debug, thiserror::Error)]
pub enum TextsError {
    /// A file does not parse into every text.
    #[error("server/locales/bot.{lang}.json: {source}")]
    Parse {
        /// The file's language.
        lang: &'static str,
        /// Why.
        source: serde_json::Error,
    },
    /// Under TELEGRAM_ENV=prod a file still lists drafts (the owner's VALUES step empties them).
    #[error("server/locales/bot.{lang}.json: draft texts under TELEGRAM_ENV=prod: {keys}")]
    Drafts {
        /// The file's language.
        lang: &'static str,
        /// Its draft keys, comma-separated.
        keys: String,
    },
}

/// The `(lang, json)` files checked: every one parses into every text first (a parse error wins over a draft), then
/// under [`TelegramEnv::Prod`] none may list a draft. `Ok` holds the drafts left, sorted and deduplicated.
pub fn check(files: &[(&'static str, &str)], env: TelegramEnv) -> Result<Vec<String>, TextsError> {
    let mut parsed = Vec::with_capacity(files.len());
    for &(lang, json) in files {
        let file = parse(json).map_err(|source| TextsError::Parse { lang, source })?;
        parsed.push((lang, file));
    }
    let mut drafts = Vec::new();
    for (lang, file) in parsed {
        if env == TelegramEnv::Prod && !file.drafts.is_empty() {
            return Err(TextsError::Drafts {
                lang,
                keys: file.drafts.join(", "),
            });
        }
        drafts.extend(file.drafts);
    }
    drafts.sort_unstable();
    drafts.dedup();
    Ok(drafts)
}

/// [`check`] of the compiled-in pair ([`BOT_RU_JSON`], [`BOT_EN_JSON`]), then both parsed texts forced: they cannot
/// panic afterwards, the same bytes just parsed. Run at startup, before anything is opened or built.
pub fn startup_check(env: TelegramEnv) -> Result<Vec<String>, TextsError> {
    let drafts = check(&[("ru", BOT_RU_JSON), ("en", BOT_EN_JSON)], env)?;
    LazyLock::force(&RU);
    LazyLock::force(&EN);
    Ok(drafts)
}

/// The compiled-in file of `lang`.
pub fn bot_file(lang: Lang) -> &'static BotFile {
    match lang {
        Lang::Ru => &RU,
        Lang::En => &EN,
    }
}

/// The texts of `lang`.
pub fn texts(lang: Lang) -> &'static LangTexts {
    &bot_file(lang).texts
}

/// `template` with each `{name}` of `values` replaced, in one pass: an inserted value is never scanned again, so a
/// charge id that holds `{error}` stays literal. A `{` that opens no name of `values` is kept as is.
pub fn fill(template: &str, values: &[(&str, &str)]) -> String {
    let mut out = String::with_capacity(template.len());
    let mut rest = template;
    while let Some(open) = rest.find('{') {
        out.push_str(&rest[..open]);
        let tail = &rest[open + 1..];
        let filled = values.iter().find_map(|(name, value)| {
            tail.strip_prefix(*name)
                .and_then(|after| after.strip_prefix('}'))
                .map(|after| (*value, after))
        });
        match filled {
            Some((value, after)) => {
                out.push_str(value);
                rest = after;
            }
            None => {
                out.push('{');
                rest = tail;
            }
        }
    }
    out.push_str(rest);
    out
}
