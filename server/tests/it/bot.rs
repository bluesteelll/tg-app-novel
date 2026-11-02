//! The bot (PP "Bot texts", K20-K22): its texts in `server/locales/bot.*.json` within Telegram's bounds, Russian
//! first; a pre-checkout refusal in the query's language; the commands, answered in a private chat in the sender's
//! language, `/refund` for admins only; the notice of a payment recorded but not applied, and `/paysupport`'s list
//! that flags it; `server setup` (the webhook, the command menus, the menu button) on the fake gateway, and the real
//! subcommand refusing the placeholder token.
//!
//! Every state calls the Bot API through [`RecordingGateway`]: no test reaches Telegram.
//!
//! [`RecordingGateway`]: crate::payments::RecordingGateway

use std::process::{Command, Stdio};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::time::{Duration, Instant};

use serde_json::{Value, json};
use server::AppState;
use server::config::{
    PLACEHOLDER_BOT_TOKEN, PLACEHOLDER_TOKEN_KEY_HEX, PLACEHOLDER_WEBHOOK_SECRET,
};
use server::puzzles::Lang;
use server::telegram::commands::utc_date;
use server::telegram::gateway::{BotCommandSpec, CommandSet, OutMessage, WebAppButton};
use server::telegram::payments::{RejectReason, RevokeOutcome};
use server::telegram::setup;
use server::telegram::texts::{self, BotFile, MESSAGE_LIMIT, fill};

use crate::catalog::{ANN, T0, own};
use crate::common::{self, TEST_ADMIN_ID};
use crate::payments::{GatewayCall, RecordingGateway, invoice_state, refusal};
use crate::refunds::{
    BEN, T1, bought, entitlements_of, expect_eq, order_of, pay, refund_calls, refund_state,
    revoke_at,
};
use crate::webhook::{payment_update, post_update, pre_checkout_update};

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

/// A `message` update with `text` from `from` (Telegram language `language`) in chat `chat` of type `chat_type`.
pub(crate) fn text_update(
    from: i64,
    chat: i64,
    chat_type: &str,
    language: Option<&str>,
    text: &str,
) -> Value {
    json!({
        "update_id": 4,
        "message": {
            "message_id": 9,
            "date": T0,
            "chat": { "id": chat, "type": chat_type, "title": "Readers" },
            "from": { "id": from, "is_bot": false, "first_name": "Ann", "language_code": language },
            "text": text
        }
    })
}

/// The `sendMessage` calls `gateway` recorded, in order.
pub(crate) fn messages(gateway: &RecordingGateway) -> Vec<OutMessage> {
    gateway
        .calls()
        .into_iter()
        .filter_map(|call| match call {
            GatewayCall::Message(msg) => Some(msg),
            _ => None,
        })
        .collect()
}

/// `text` from `from` (language `language`) in their private chat, through the webhook: the HTTP status and the
/// messages sent while it was handled.
async fn say(
    st: &AppState,
    gateway: &RecordingGateway,
    from: i64,
    language: Option<&str>,
    text: &str,
) -> (u16, Vec<OutMessage>) {
    say_in(st, gateway, from, from, "private", language, text).await
}

/// [`say`] in chat `chat` of type `chat_type`.
async fn say_in(
    st: &AppState,
    gateway: &RecordingGateway,
    from: i64,
    chat: i64,
    chat_type: &str,
    language: Option<&str>,
    text: &str,
) -> (u16, Vec<OutMessage>) {
    let before = messages(gateway).len();
    let reply = post_update(st, &text_update(from, chat, chat_type, language, text)).await;
    let sent = messages(gateway).split_off(before);
    (reply.status.as_u16(), sent)
}

/// A plain message of `text` to chat `chat`.
fn plain(chat: i64, text: &str) -> OutMessage {
    OutMessage {
        chat_id: chat,
        text: text.to_owned(),
        web_app_button: None,
    }
}

/// The mismatch of one command's answer against 200 and exactly the message `want`.
fn expect_reply(case: &str, got: &(u16, Vec<OutMessage>), want: &OutMessage) -> Option<String> {
    let (status, sent) = got;
    (*status != 200 || sent.as_slice() != std::slice::from_ref(want)).then(|| {
        format!(
            "{case}: expected 1 message {want:?}, got {status} and {} messages: {sent:?}",
            sent.len()
        )
    })
}

/// `/start`, with or without the bot's name and a payload, answers the welcome with one button that opens the Mini App
/// at `PUBLIC_APP_URL`, in the sender's chat.
#[tokio::test]
async fn start_has_web_app_button() {
    let (st, _db, gateway) = refund_state().await;
    let ru = texts::texts(Lang::Ru);
    let want = OutMessage {
        chat_id: ANN,
        text: ru.start.clone(),
        web_app_button: Some(WebAppButton {
            text: ru.start_button.clone(),
            url: "https://example.invalid/".to_owned(),
        }),
    };
    let mut failures = Vec::new();
    for text in ["/start", "/start@novel_bot payload"] {
        let (status, sent) = say(&st, &gateway, ANN, Some("ru"), text).await;
        if status != 200 || sent != [want.clone()] {
            failures.push(format!(
                "{text}: expected 1 message with a web_app button, got {}: {status} {sent:?}",
                sent.len()
            ));
        }
    }
    report(&failures);
}

/// `/refund` is the admins' only: anyone else gets exactly the unknown-command reply, with no lookup and no Bot API
/// refund, whether the charge exists or not, and the entitlement stays. An admin without a charge gets the usage; an
/// admin with one refunds it through the gateway, revokes it and reads `refund_done`.
#[tokio::test]
async fn refund_command_admin_only() {
    let (st, _db, gateway) = refund_state().await;
    let mut failures = Vec::new();
    if bought(&st, ANN, "chapter:ch2", "c-ch2", &mut failures)
        .await
        .is_none()
    {
        return report(&failures);
    }
    let ru = texts::texts(Lang::Ru);
    for text in ["/refund c-ch2", "/refund nope"] {
        let (status, sent) = say(&st, &gateway, ANN, Some("ru"), text).await;
        let want = plain(ANN, &ru.unknown_command);
        if status != 200 || sent != [want] {
            let got = if sent.is_empty() {
                "no message".to_owned()
            } else {
                format!("{sent:?}")
            };
            failures.push(format!(
                "non-admin {text}: expected the unknown-command reply, got {status} {got}"
            ));
        }
    }
    failures.extend(expect_eq(
        "non-admin: refundStarPayment calls",
        refund_calls(&gateway).len(),
        0,
    ));
    failures.extend(expect_eq(
        "non-admin: entitlements of the charge",
        entitlements_of(&st, "c-ch2").await,
        1,
    ));
    let got = say(&st, &gateway, TEST_ADMIN_ID, Some("ru"), "/refund").await;
    failures.extend(expect_reply(
        "admin /refund",
        &got,
        &plain(TEST_ADMIN_ID, &ru.refund_usage),
    ));
    let got = say(&st, &gateway, TEST_ADMIN_ID, Some("ru"), "/refund c-ch2").await;
    let done = fill(&ru.refund_done, &[("charge", "c-ch2")]);
    failures.extend(expect_reply(
        "admin /refund c-ch2",
        &got,
        &plain(TEST_ADMIN_ID, &done),
    ));
    failures.extend(expect_eq(
        "admin: refundStarPayment calls",
        refund_calls(&gateway),
        vec![(ANN, "c-ch2".to_owned())],
    ));
    failures.extend(expect_eq(
        "admin: entitlements of the charge",
        entitlements_of(&st, "c-ch2").await,
        0,
    ));
    report(&failures);
}

/// `/privacy` links the policy page at `PUBLIC_APP_URL` + `api/privacy`, in the sender's language.
#[tokio::test]
async fn privacy_command_links_policy() {
    let (st, _db, gateway) = refund_state().await;
    let mut failures = Vec::new();
    for (user, language, lang) in [(ANN, "ru", Lang::Ru), (BEN, "en", Lang::En)] {
        let want = fill(
            &texts::texts(lang).privacy,
            &[("url", "https://example.invalid/api/privacy")],
        );
        let got = say(&st, &gateway, user, Some(language), "/privacy").await;
        failures.extend(expect_reply(
            &format!("/privacy {language}"),
            &got,
            &plain(user, &want),
        ));
    }
    report(&failures);
}

/// A command is answered in the sender's language (K29: `ru` Russian, `de` English), in their private chat only: the
/// same command in a group or a supergroup, and free text anywhere, get no message.
#[tokio::test]
async fn bot_commands_reply_in_sender_language() {
    let (st, _db, gateway) = refund_state().await;
    let mut failures = Vec::new();
    for (sender, language, lang) in [(ANN, "ru", Lang::Ru), (1003, "de", Lang::En)] {
        let t = texts::texts(lang);
        for (text, want) in [
            ("/terms", &t.terms),
            ("/support", &t.support),
            ("/x", &t.unknown_command),
        ] {
            let got = say(&st, &gateway, sender, Some(language), text).await;
            failures.extend(expect_reply(
                &format!("{text} from {language}"),
                &got,
                &plain(sender, want),
            ));
        }
    }
    for (case, chat, chat_type, text) in [
        ("/terms in a group", -100_123, "group", "/terms"),
        (
            "/paysupport in a supergroup",
            -100_124,
            "supergroup",
            "/paysupport",
        ),
        ("free text", ANN, "private", "hello"),
    ] {
        let (status, sent) = say_in(&st, &gateway, ANN, chat, chat_type, Some("ru"), text).await;
        if status != 200 || !sent.is_empty() {
            failures.push(format!(
                "{case}: expected 200 and no message, got {status} and {sent:?}"
            ));
        }
    }
    report(&failures);
}

/// A `successful_payment` update (every field frankenstein requires) from `payer` with Telegram language `language`.
fn payment_in(payer: i64, language: &str, amount: u32, order: &str, charge: &str) -> Value {
    let mut update = payment_update(payer, "XTR", amount, order, charge, "");
    update["message"]["from"]["language_code"] = json!(language);
    update
}

/// A second `created` order of `product` for `user` at `T0`, as raw SQL: the order the invoice route refuses once the
/// product is owned, as if it had been opened before the first one was paid and slipped past the checkout window.
async fn raw_order(st: &AppState, order: &str, user: i64, product: &str) {
    let mut c = common::raw_db(st).await;
    sqlx::query(
        "INSERT INTO orders (id, user_id, product_id, amount, currency, status, created_at) \
         VALUES ($1, $2, $3, 1, 'XTR', 'created', $4)",
    )
    .bind(order)
    .bind(user)
    .bind(product)
    .bind(T0)
    .execute(&mut c)
    .await
    .unwrap();
    sqlx::Connection::close(c).await.unwrap();
}

/// A payment the grant records but cannot apply notifies its payer (in the payment's sender language) and each admin
/// (in Russian) once: an `AlreadyEntitled` payment (a second order of an owned chapter) and an `OrderMismatch` one (a
/// wrong amount). A redelivery, and an applied payment, send nothing.
#[tokio::test]
async fn unapplied_charge_notifies_payer_and_admin() {
    let (st, _db, gateway) = refund_state().await;
    let mut failures = Vec::new();
    let Some((first, amount)) = order_of(&st, ANN, "chapter:ch2", &mut failures).await else {
        return report(&failures);
    };
    let second = "o_0123456789abcdef0123456789abcdef";
    raw_order(&st, second, ANN, "chapter:ch2").await;
    let Some((wrong, wrong_amount)) = order_of(&st, BEN, "chapter:ch4", &mut failures).await else {
        return report(&failures);
    };
    let ru = texts::texts(Lang::Ru);
    let en = texts::texts(Lang::En);
    let notice = |payer: i64, t: &texts::LangTexts, charge: &str, outcome: &str| {
        let admin = fill(
            &ru.admin_unapplied,
            &[
                ("charge", charge),
                ("payer", &payer.to_string()),
                ("outcome", outcome),
            ],
        );
        vec![
            plain(payer, &fill(&t.payment_unapplied, &[("charge", charge)])),
            plain(TEST_ADMIN_ID, &admin),
        ]
    };
    let mismatch = payment_in(BEN, "en", wrong_amount + 1, &wrong, "c-wrong");
    for (case, update, want) in [
        (
            "applied",
            payment_in(ANN, "ru", amount, &first, "c-first"),
            Vec::new(),
        ),
        (
            "already entitled",
            payment_in(ANN, "ru", 1, second, "c-second"),
            notice(ANN, ru, "c-second", "AlreadyEntitled"),
        ),
        (
            "order mismatch",
            mismatch.clone(),
            notice(BEN, en, "c-wrong", "OrderMismatch"),
        ),
        ("order mismatch redelivered", mismatch, Vec::new()),
    ] {
        let before = messages(&gateway).len();
        let status = post_update(&st, &update).await.status.as_u16();
        let sent = messages(&gateway).split_off(before);
        if status != 200 || sent != want {
            failures.push(format!(
                "{case}: expected 200 and {} messages {want:?}, got {status} and the fake gateway records {} messages \
                 {sent:?}",
                want.len(),
                sent.len()
            ));
        }
    }
    report(&failures);
}

/// The `/paysupport` lines of `text` after its intro: one per charge.
fn charge_lines<'a>(text: &'a str, intro: &str) -> Vec<&'a str> {
    text.strip_prefix(intro)
        .unwrap_or(text)
        .lines()
        .filter(|line| !line.is_empty())
        .collect()
}

/// `/paysupport` lists the sender's own charges, newest first: an applied chapter unflagged, an unapplied charge (paid
/// at a wrong amount) flagged, a refunded pack marked refunded. Another user's charge is not listed.
#[tokio::test]
async fn paysupport_flags_unapplied_charge() {
    let (st, _db, gateway) = refund_state().await;
    let mut failures = Vec::new();
    if bought(&st, ANN, "chapter:ch2", "c-applied", &mut failures)
        .await
        .is_none()
    {
        return report(&failures);
    }
    let Some((order, amount)) = order_of(&st, ANN, "chapter:ch4", &mut failures).await else {
        return report(&failures);
    };
    pay(&st, ANN, amount + 1, &order, "c-unapplied", &mut failures).await;
    if bought(&st, ANN, "pack:hint_s", "c-refunded", &mut failures)
        .await
        .is_none()
    {
        return report(&failures);
    }
    failures.extend(expect_eq(
        "revoke c-refunded",
        revoke_at(&st, T1, "c-refunded").await,
        Ok(RevokeOutcome::Revoked),
    ));
    own(&st, BEN, "chapter:ch4").await;
    let ru = texts::texts(Lang::Ru);
    let line = |charge: &str, amount: u32, status: Option<&str>| {
        let mut line = fill(
            &ru.paysupport_line,
            &[
                ("date", &utc_date(T0)),
                ("charge", charge),
                ("amount", &amount.to_string()),
            ],
        );
        if let Some(status) = status {
            line.push(' ');
            line.push_str(status);
        }
        line
    };
    let want = vec![
        line("c-unapplied", amount + 1, Some(&ru.paysupport_not_applied)),
        line("c-refunded", 1, Some(&ru.paysupport_refunded)),
        line("c-applied", 1, None),
    ];
    let (status, sent) = say(&st, &gateway, ANN, Some("ru"), "/paysupport").await;
    let text = sent.first().map(|msg| msg.text.clone()).unwrap_or_default();
    let got = charge_lines(&text, &ru.paysupport);
    if status != 200 || sent.len() != 1 || !text.starts_with(&ru.paysupport) || got != want {
        let got = if got.is_empty() {
            "the intro only".to_owned()
        } else {
            format!("{got:?}")
        };
        failures.push(format!(
            "expected 3 charge lines {want:?}, got {status}, {} messages, {got}",
            sent.len()
        ));
    }
    if text.contains("charge-1002") {
        failures.push("another user's charge is listed".to_owned());
    }
    report(&failures);
}

/// A paid pack applied through its ledger credit (no entitlement row) is not flagged as unapplied.
#[tokio::test]
async fn paysupport_pack_credit_is_applied() {
    let (st, _db, gateway) = refund_state().await;
    let mut failures = Vec::new();
    if bought(&st, ANN, "pack:hint_s", "c-pack", &mut failures)
        .await
        .is_none()
    {
        return report(&failures);
    }
    let ru = texts::texts(Lang::Ru);
    let want = vec![fill(
        &ru.paysupport_line,
        &[
            ("date", &utc_date(T0)),
            ("charge", "c-pack"),
            ("amount", "1"),
        ],
    )];
    let (_, sent) = say(&st, &gateway, ANN, Some("ru"), "/paysupport").await;
    let text = sent.first().map(|msg| msg.text.clone()).unwrap_or_default();
    let got = charge_lines(&text, &ru.paysupport);
    if got != want {
        let got = if got.is_empty() {
            "the intro only".to_owned()
        } else {
            format!("{got:?}")
        };
        failures.push(format!(
            "expected 1 unflagged charge line {want:?}, got {got}"
        ));
    }
    report(&failures);
}

/// The command menu in `t`'s language, as `server setup` registers it.
fn menu_of(t: &texts::LangTexts) -> Vec<BotCommandSpec> {
    [
        ("start", &t.cmd_start),
        ("paysupport", &t.cmd_paysupport),
        ("support", &t.cmd_support),
        ("terms", &t.cmd_terms),
        ("privacy", &t.cmd_privacy),
    ]
    .into_iter()
    .map(|(command, description)| BotCommandSpec {
        command: command.to_owned(),
        description: description.clone(),
    })
    .collect()
}

/// `server setup` on the fake gateway makes one setup call: the webhook at `PUBLIC_APP_URL` + `telegram/webhook` with
/// the configured secret, five command sets (the English default, and Russian for `ru`, `uk`, `be`, `kk`) of the five
/// listed commands, and the Russian menu button opening `PUBLIC_APP_URL`.
#[tokio::test]
async fn bot_setup_registers_webhook_commands_and_menu() {
    let (st, _db, gateway) = refund_state().await;
    let mut failures = Vec::new();
    if let Err(e) = setup::run(gateway.as_ref(), &st.cfg).await {
        failures.push(format!("setup::run: expected Ok, got {e}"));
    }
    let setups: Vec<GatewayCall> = gateway
        .calls()
        .into_iter()
        .filter(|call| matches!(call, GatewayCall::Setup { .. }))
        .collect();
    let ru = texts::texts(Lang::Ru);
    let mut commands = vec![CommandSet {
        language_code: None,
        commands: menu_of(texts::texts(Lang::En)),
    }];
    for code in ["ru", "uk", "be", "kk"] {
        commands.push(CommandSet {
            language_code: Some(code.to_owned()),
            commands: menu_of(ru),
        });
    }
    let want = GatewayCall::Setup {
        webhook_url: "https://example.invalid/telegram/webhook".to_owned(),
        secret_token: "test-webhook-secret".to_owned(),
        commands,
        menu_button: WebAppButton {
            text: ru.menu_button.clone(),
            url: "https://example.invalid/".to_owned(),
        },
    };
    if setups.len() != 1 {
        failures.push(format!("setup calls: expected 1, got {}", setups.len()));
    } else if setups[0] != want {
        failures.push(format!(
            "setup call: expected {want:?}, got {:?}",
            setups[0]
        ));
    }
    report(&failures);
}

/// The real `server setup` with the placeholder token (every `Config` variable set, the test environment on a local
/// URL): the production gateway is `Disabled`, so no request leaves the process, the setup fails with the gateway's
/// line, and it exits non-zero without serving or waiting on a database.
#[test]
fn bot_setup_subcommand_refuses_placeholder_token() {
    let mut child = Command::new(env!("CARGO_BIN_EXE_server"))
        .arg("setup")
        // Every variable `Config` reads, so none comes from the caller's environment; an empty value is unset.
        .envs([
            ("BOT_TOKEN", PLACEHOLDER_BOT_TOKEN),
            ("WEBHOOK_SECRET", PLACEHOLDER_WEBHOOK_SECRET),
            ("TOKEN_KEY", PLACEHOLDER_TOKEN_KEY_HEX),
            ("TOKEN_TTL_SECS", "1800"),
            ("INITDATA_MAX_AGE_SECS", "86400"),
            ("PUBLIC_APP_URL", "http://127.0.0.1/"),
            ("ADMIN_TELEGRAM_IDS", ""),
            ("STATIC_DIR", ""),
            (
                "CONTENT_DIR",
                concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/content"),
            ),
            // A closed port: setup must not need a database.
            ("DATABASE_URL", "postgres://postgres@127.0.0.1:1/tgn_setup"),
            ("TELEGRAM_ENV", "test"),
            ("LISTEN_ADDR", "127.0.0.1:0"),
            ("PRIVACY_OPERATOR_FILE", ""),
            ("RUST_LOG", "info"),
            ("NO_COLOR", "1"),
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let (lines, received) = mpsc::channel();
    crate::forward_lines(child.stdout.take().unwrap(), lines.clone());
    crate::forward_lines(child.stderr.take().unwrap(), lines);
    // A hang bound, not a timing verdict: both pipes closing (the process is exiting) ends the wait at once.
    let deadline = Instant::now() + Duration::from_secs(60);
    let mut log = Vec::new();
    let hung = loop {
        match received.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
            Ok(line) => log.push(line),
            Err(RecvTimeoutError::Disconnected) => break false,
            Err(RecvTimeoutError::Timeout) => break true,
        }
    };
    let mut failures = Vec::new();
    if hung && let Err(e) = child.kill() {
        failures.push(format!("kill server: expected Ok, got {e}"));
    }
    let status = child.wait().unwrap();
    let text = log.join("\n");
    if hung {
        failures.push(format!(
            "server setup: expected an exit within 60 s, got a hang and the log:\n{text}"
        ));
    } else if status.success() {
        failures.push(format!(
            "server setup: expected a failure exit, got {status} and the log:\n{text}"
        ));
    }
    if !log
        .iter()
        .any(|line| line.contains("bot api disabled: placeholder BOT_TOKEN"))
    {
        failures.push(format!(
            "expected the gateway's `bot api disabled: placeholder BOT_TOKEN` line, got the log:\n{text}"
        ));
    }
    if log.iter().any(|line| line.contains("listening")) {
        failures.push(format!("server setup served, the log:\n{text}"));
    }
    report(&failures);
}
