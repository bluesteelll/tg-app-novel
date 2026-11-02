//! The bot's commands (PP "Bot commands"; payments-stars: `/terms`, `/support`, `/paysupport`): `/start` with a
//! button that opens the Mini App, `/terms`, `/support`, `/paysupport`, `/privacy`, and the admin's `/refund <charge>`.
//! Only a text message in a private chat with a sender is answered, in the sender's language (K29), in that chat: a
//! group never sees a reply (`/paysupport` lists the sender's payments). Free text gets no reply and no Bot API call.
//!
//! Logs name the command, never the message text.

use frankenstein::types::{ChatType, Message};

use crate::AppState;
use crate::db::payments::ChargeLine;
use crate::ids::{ChargeId, UserId};
use crate::telegram::gateway::{CALL_DEADLINE, GatewayError, OutMessage, WebAppButton};
use crate::telegram::payments::{self, RefundError, RevokeOutcome, payer_lang};
use crate::telegram::setup::app_url;
use crate::telegram::texts::{self, LangTexts, fill};

/// The longest `/refund` argument looked up: a Telegram charge id is far shorter.
const MAX_CHARGE_ARG: usize = 256;

/// The most charges `/paysupport` reads: the newest ones.
const PAYSUPPORT_CHARGES: i64 = 20;

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
/// in that chat. A reply the gateway fails to send is logged. `Err` (the webhook answers 500 and Telegram redelivers
/// the command) only when an admin refund's database step failed; a `/paysupport` read failure is answered and
/// acknowledged — a 500 would hold the chat's later updates, the payer's `successful_payment` included (critique O2).
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
        Command::PaySupport => plain(m, paysupport(st, from.id, t).await),
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

/// The `/paysupport` text: the intro, then the charges, newest first, each with its status (refunded, or recorded
/// but not applied), as many as fit one message ([`texts::MESSAGE_LIMIT`]), then how many were left out of `total`;
/// with no charge, the intro and `paysupport_none`.
pub fn paysupport_message(t: &LangTexts, lines: &[ChargeLine], total: i64) -> String {
    let mut out = t.paysupport.clone();
    out.push('\n');
    if lines.is_empty() {
        out.push('\n');
        out.push_str(&t.paysupport_none);
        return out;
    }
    let more = |left: i64| fill(&t.paysupport_more, &[("n", &left.to_string())]);
    let mut chars = out.chars().count();
    let mut shown: i64 = 0;
    for line in lines {
        let text = charge_text(t, line);
        let line_chars = 1 + text.chars().count();
        // Room is kept for the "and N more" line whenever a charge would be left out after this one.
        let left_after = total - shown - 1;
        let tail = if left_after > 0 {
            2 + more(left_after).chars().count()
        } else {
            0
        };
        if chars + line_chars + tail > texts::MESSAGE_LIMIT {
            break;
        }
        out.push('\n');
        out.push_str(&text);
        chars += line_chars;
        shown += 1;
    }
    let left = total - shown;
    if left > 0 {
        out.push_str("\n\n");
        out.push_str(&more(left));
    }
    out
}

/// One charge of `/paysupport`: its date, amount and id, then its status when it was refunded or not applied.
fn charge_text(t: &LangTexts, line: &ChargeLine) -> String {
    let mut text = fill(
        &t.paysupport_line,
        &[
            ("date", &utc_date(line.paid_at)),
            ("charge", &line.charge),
            ("amount", &line.amount.to_string()),
        ],
    );
    let status = if line.refunded_at.is_some() {
        Some(&t.paysupport_refunded)
    } else if !line.applied {
        Some(&t.paysupport_not_applied)
    } else {
        None
    };
    if let Some(status) = status {
        text.push(' ');
        text.push_str(status);
    }
    text
}

/// `unix` seconds as the UTC date `YYYY-MM-DD` (the proleptic Gregorian calendar, no time-zone data): the
/// days-to-civil conversion of H. Hinnant's `chrono`-compatible date algorithms.
pub fn utc_date(unix: i64) -> String {
    let z = unix.div_euclid(86_400) + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!("{year:04}-{month:02}-{day:02}")
}

/// A plain-text reply to `m`'s chat.
fn plain(m: &Message, text: String) -> OutMessage {
    OutMessage {
        chat_id: m.chat.id,
        text,
        web_app_button: None,
    }
}

/// `/paysupport` for Telegram user `from`: the intro and their newest charges, flagged. A sender id beyond `i64` has
/// no payment row. A database error is logged and answered with the intro (it carries the support contact) and
/// `paysupport_unavailable`: never `Err`, so the update is acknowledged and the chat's queue moves on.
async fn paysupport(st: &AppState, from: u64, t: &LangTexts) -> String {
    let Ok(user) = i64::try_from(from) else {
        return paysupport_message(t, &[], 0);
    };
    match st.repo.charges_of(UserId(user), PAYSUPPORT_CHARGES).await {
        Ok((lines, total)) => paysupport_message(t, &lines, total),
        Err(e) => {
            tracing::error!(command = "paysupport", error = %e, "charges read failed; answered try later");
            let mut out = t.paysupport.clone();
            out.push_str("\n\n");
            out.push_str(&t.paysupport_unavailable);
            out
        }
    }
}

/// The admin's `/refund <charge>`: the usage without a usable argument, else the admin refund's outcome in `t`. A
/// gateway timeout or transport break says the outcome is unknown (Telegram may have refunded; a repeat is safe: it
/// meets `CHARGE_ALREADY_REFUNDED` and revokes), an API refusal or a disabled gateway that nothing changed. A database
/// error is `Err`: Telegram redelivers the command, and its retry meets `CHARGE_ALREADY_REFUNDED` and revokes.
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
        Err(RefundError::Gateway(e)) => {
            // No wildcard arm: a new gateway error does not compile until its reply is chosen here.
            let template = match &e {
                // The call may have reached Telegram: the Stars may be back already.
                GatewayError::Timeout | GatewayError::Transport(_) => &t.refund_unknown_outcome,
                // Telegram refused, or no call left the process: nothing changed.
                GatewayError::Api(_) | GatewayError::Disabled => &t.refund_failed,
            };
            // `GatewayError`'s text carries no request text (no token, no secret).
            fill(template, &[("charge", charge), ("error", &e.to_string())])
        }
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
    use crate::puzzles::Lang;

    fn report(failures: &[String]) {
        assert!(
            failures.is_empty(),
            "{} failures:\n{}",
            failures.len(),
            failures.join("\n")
        );
    }

    /// The civil date of known instants: the epoch, a leap day, a century that is not a leap year, a year start.
    #[test]
    fn bot_utc_date_vectors() {
        let cases = [
            (0, "1970-01-01"),
            (951_782_400, "2000-02-29"),
            (4_102_444_800, "2100-01-01"),
            (1_798_761_600, "2027-01-01"),
            (1_798_761_599, "2026-12-31"),
        ];
        let failures: Vec<String> = cases
            .iter()
            .filter(|(unix, want)| utc_date(*unix) != *want)
            .map(|(unix, want)| format!("{unix}: expected {want}, got {:?}", utc_date(*unix)))
            .collect();
        report(&failures);
    }

    /// `/paysupport` stays one message: 20 charges with 300-character ids do not fit, so the message keeps to 4096
    /// characters and ends with how many were left out; with no charge it is the intro and `paysupport_none`.
    #[test]
    fn bot_paysupport_message_capped() {
        let t = texts::texts(Lang::En);
        let lines: Vec<ChargeLine> = (0..20)
            .map(|i| ChargeLine {
                charge: format!("{i:02}{}", "c".repeat(298)),
                amount: 1,
                paid_at: 1_798_761_600,
                refunded_at: None,
                applied: true,
            })
            .collect();
        let mut failures = Vec::new();
        let capped = paysupport_message(t, &lines, 20);
        let chars = capped.chars().count();
        if chars > texts::MESSAGE_LIMIT {
            failures.push(format!(
                "20 long charges: expected <= 4096 characters, got {chars}"
            ));
        }
        let shown = lines
            .iter()
            .filter(|line| capped.contains(&line.charge))
            .count();
        let more = fill(&t.paysupport_more, &[("n", &(20 - shown).to_string())]);
        if shown == 20 || !capped.ends_with(&more) {
            failures.push(format!(
                "20 long charges: expected some left out and the message to end with {more:?}, got {shown} shown"
            ));
        }
        let none = paysupport_message(t, &[], 0);
        if !none.starts_with(&t.paysupport) || !none.ends_with(&t.paysupport_none) {
            failures.push(format!(
                "no charge: expected the intro and {:?}, got {none:?}",
                t.paysupport_none
            ));
        }
        report(&failures);
    }

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
