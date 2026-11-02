//! The bot's commands (PP "Bot commands"; payments-stars: `/terms`, `/support`, `/paysupport`): `/start` with a
//! button that opens the Mini App, `/terms`, `/support`, `/paysupport`, `/privacy`, and the admin's `/refund <charge>`.
//! Only a text message in a private chat with a sender is answered, in the sender's language (K29), in that chat: a
//! group never sees a reply (`/paysupport` lists the sender's payments). Free text gets no reply and no Bot API call.
//!
//! Logs name the command, never the message text.

use frankenstein::types::{ChatType, Message};

use crate::AppState;
use crate::ids::ChargeId;
use crate::telegram::gateway::{CALL_DEADLINE, OutMessage, WebAppButton};
use crate::telegram::payments::{self, RefundError, RevokeOutcome, payer_lang};
use crate::telegram::setup::app_url;
use crate::telegram::texts::{self, LangTexts, fill};

/// The longest `/refund` argument looked up: a Telegram charge id is far shorter.
const MAX_CHARGE_ARG: usize = 256;

/// A command the bot answers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Command<'a> {
    /// `/start`, with any payload.
    Start,
    /// `/terms`.
    Terms,
    /// `/support`.
    Support,
    /// `/paysupport`.
    PaySupport,
    /// `/privacy`.
    Privacy,
    /// `/refund`, with the rest of the text trimmed (`None` when there is none).
    Refund(Option<&'a str>),
    /// Any other `/name`.
    Unknown,
}

impl Command<'_> {
    /// The command's name in logs.
    fn kind(self) -> &'static str {
        match self {
            Command::Start => "start",
            Command::Terms => "terms",
            Command::Support => "support",
            Command::PaySupport => "paysupport",
            Command::Privacy => "privacy",
            Command::Refund(_) => "refund",
            Command::Unknown => "unknown",
        }
    }
}

/// The command `text` starts with: its first whitespace-separated token as `/name` or `/name@bot`, case-sensitive
/// (Telegram's commands are lower case); `None` for text that does not start with `/`.
pub fn parse_command(text: &str) -> Option<Command<'_>> {
    let end = text.find(char::is_whitespace).unwrap_or(text.len());
    let (token, rest) = text.split_at(end);
    let name = token.strip_prefix('/')?;
    // In a private chat every command is ours, whichever bot name follows the `@`.
    let name = name.split_once('@').map_or(name, |(name, _)| name);
    Some(match name {
        "start" => Command::Start,
        "terms" => Command::Terms,
        "support" => Command::Support,
        "paysupport" => Command::PaySupport,
        "privacy" => Command::Privacy,
        "refund" => Command::Refund(Some(rest.trim()).filter(|arg| !arg.is_empty())),
        _ => Command::Unknown,
    })
}

/// A text message (D6): answered only when it is a command in a private chat with a sender, in the sender's language,
/// in that chat. A reply the gateway fails to send is logged; only a database error is `Err` (the webhook answers 500
/// and Telegram redelivers the command).
pub async fn on_text(st: &AppState, m: &Message) -> Result<(), sqlx::Error> {
    let (Some(text), Some(from)) = (m.text.as_deref(), m.from.as_deref()) else {
        return Ok(());
    };
    if m.chat.type_field != ChatType::Private {
        return Ok(());
    }
    let Some(command) = parse_command(text) else {
        return Ok(());
    };
    let t = texts::texts(payer_lang(from.language_code.as_deref()));
    let admin = i64::try_from(from.id).is_ok_and(|id| st.cfg.admin_telegram_ids.contains(&id));
    let reply = match command {
        Command::Start => OutMessage {
            chat_id: m.chat.id,
            text: t.start.clone(),
            web_app_button: Some(WebAppButton {
                text: t.start_button.clone(),
                url: st.cfg.public_app_url.clone(),
            }),
        },
        Command::Terms => plain(m, t.terms.clone()),
        Command::Support => plain(m, t.support.clone()),
        Command::PaySupport => plain(m, t.paysupport.clone()),
        Command::Privacy => {
            let url = app_url(&st.cfg.public_app_url, "api/privacy");
            plain(m, fill(&t.privacy, &[("url", &url)]))
        }
        // Anyone but an admin gets exactly the unknown-command reply, before any lookup: nothing about the charge
        // leaks.
        Command::Refund(_) if !admin => plain(m, t.unknown_command.clone()),
        Command::Refund(arg) => plain(m, refund_reply(st, t, arg).await?),
        Command::Unknown => plain(m, t.unknown_command.clone()),
    };
    send(st, reply, command.kind()).await;
    Ok(())
}

/// A plain-text reply to `m`'s chat.
fn plain(m: &Message, text: String) -> OutMessage {
    OutMessage {
        chat_id: m.chat.id,
        text,
        web_app_button: None,
    }
}

/// The admin's `/refund <charge>`: the usage without a usable argument, else the admin refund's outcome in `t`. A
/// database error is `Err`: Telegram redelivers the command, and its retry meets `CHARGE_ALREADY_REFUNDED` and
/// revokes.
async fn refund_reply(
    st: &AppState,
    t: &LangTexts,
    arg: Option<&str>,
) -> Result<String, sqlx::Error> {
    let Some(charge) = arg.filter(|charge| charge.chars().count() <= MAX_CHARGE_ARG) else {
        return Ok(t.refund_usage.clone());
    };
    let text = match payments::admin_refund(st, &ChargeId(charge.to_owned())).await {
        Ok(RevokeOutcome::Revoked) => fill(&t.refund_done, &[("charge", charge)]),
        Ok(RevokeOutcome::AlreadyRefunded) => fill(&t.refund_already, &[("charge", charge)]),
        Ok(RevokeOutcome::UnknownCharge) => fill(&t.refund_unknown, &[("charge", charge)]),
        // `GatewayError`'s text carries no request text (no token, no secret).
        Err(RefundError::Gateway(e)) => fill(
            &t.refund_failed,
            &[("charge", charge), ("error", &e.to_string())],
        ),
        Err(RefundError::Db(e)) => return Err(e),
    };
    Ok(text)
}

/// `sendMessage` of `reply`, cut at [`CALL_DEADLINE`]; a failure is logged with the command's name.
async fn send(st: &AppState, reply: OutMessage, command: &'static str) {
    match tokio::time::timeout(CALL_DEADLINE, st.gateway.send_message(reply)).await {
        Ok(Ok(())) => tracing::info!(command, "bot command answered"),
        Ok(Err(e)) => tracing::warn!(command, error = %e, "sendMessage failed"),
        Err(_) => tracing::warn!(command, "sendMessage timed out"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The command grammar: `/name` or `/name@bot` as the first token, any payload after it, `/refund`'s argument
    /// trimmed; case matters; text without a leading `/` is no command, and a lone `/` is an unknown one.
    #[test]
    fn bot_command_parse_forms() {
        let cases: [(&str, Option<Command<'_>>); 10] = [
            ("/start", Some(Command::Start)),
            ("/start@novel_bot", Some(Command::Start)),
            ("/start x", Some(Command::Start)),
            ("/refund  c1 ", Some(Command::Refund(Some("c1")))),
            ("/refund", Some(Command::Refund(None))),
            ("/paysupport@novel_bot", Some(Command::PaySupport)),
            ("/Start", Some(Command::Unknown)),
            ("start", None),
            ("/", Some(Command::Unknown)),
            ("hello /start", None),
        ];
        let failures: Vec<String> = cases
            .iter()
            .filter(|(text, want)| parse_command(text) != *want)
            .map(|(text, want)| {
                format!("{text:?}: expected {want:?}, got {:?}", parse_command(text))
            })
            .collect();
        assert!(
            failures.is_empty(),
            "{} failures:\n{}",
            failures.len(),
            failures.join("\n")
        );
    }
}
