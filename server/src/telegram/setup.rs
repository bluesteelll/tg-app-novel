//! The bot's one-time setup (`server setup`): the webhook with its secret, the command menus and the menu button, in
//! one [`BotGateway::setup`] call. Every URL it publishes derives from `PUBLIC_APP_URL` (RULINGS 7a), so the
//! configuration's placeholder guard keys on what is published. Run by the owner at deploy; never by a test against
//! the real bot (the placeholder token makes the production gateway `Disabled`).

use crate::config::Config;
use crate::puzzles::Lang;
use crate::telegram::gateway::{
    BotCommandSpec, BotGateway, CommandSet, GatewayError, SetupSpec, WebAppButton,
};
use crate::telegram::payments::RUSSIAN_LANGS;
use crate::telegram::texts::{self, LangTexts};

/// Why `server setup` failed.
#[derive(Debug, thiserror::Error)]
pub enum SetupError {
    /// A Bot API call failed (the gateway stops at the first): nothing after it ran.
    #[error("bot setup: {0}")]
    Gateway(#[from] GatewayError),
}

/// `public_app_url` up to its first `?` or `#`, its trailing `/` trimmed, then `/` and `path`: `https://h/` and
/// `telegram/webhook` give `https://h/telegram/webhook`, `https://h/app/` gives `https://h/app/telegram/webhook`.
pub fn app_url(public_app_url: &str, path: &str) -> String {
    let base = public_app_url
        .split(['?', '#'])
        .next()
        .unwrap_or_default()
        .trim_end_matches('/');
    let mut url = String::with_capacity(base.len() + 1 + path.len());
    url.push_str(base);
    url.push('/');
    url.push_str(path);
    url
}

/// The setup of `cfg`'s bot: the webhook at `PUBLIC_APP_URL` + `telegram/webhook` with `WEBHOOK_SECRET`; the command
/// menu in English as the default set and in Russian for each of K29's Russian languages (so the menu follows the
/// replies); the menu button, in Russian (the primary language), opening `PUBLIC_APP_URL`. `/refund` is not listed:
/// it is the admins' only.
pub fn spec(cfg: &Config) -> SetupSpec {
    let ru = texts::texts(Lang::Ru);
    let mut commands = vec![CommandSet {
        language_code: None,
        commands: menu(texts::texts(Lang::En)),
    }];
    commands.extend(RUSSIAN_LANGS.iter().map(|&code| CommandSet {
        language_code: Some(code.to_owned()),
        commands: menu(ru),
    }));
    SetupSpec {
        webhook_url: app_url(&cfg.public_app_url, "telegram/webhook"),
        secret_token: cfg.webhook_secret.clone(),
        commands,
        menu_button: WebAppButton {
            text: ru.menu_button.clone(),
            url: cfg.public_app_url.clone(),
        },
    }
}

/// The command menu in `t`'s language.
fn menu(t: &LangTexts) -> Vec<BotCommandSpec> {
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

/// `server setup`: [`spec`] of `cfg` through `gateway` in one call.
pub async fn run(gateway: &dyn BotGateway, cfg: &Config) -> Result<(), SetupError> {
    gateway.setup(spec(cfg)).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The published URLs of `app_url`'s vectors: a root and a sub-path base, with and without a trailing `/`, with a
    /// query or a fragment cut off.
    #[test]
    fn bot_setup_urls_from_public_app_url() {
        let cases = [
            (
                "https://h/",
                "telegram/webhook",
                "https://h/telegram/webhook",
            ),
            (
                "https://h/app/",
                "telegram/webhook",
                "https://h/app/telegram/webhook",
            ),
            (
                "https://h",
                "telegram/webhook",
                "https://h/telegram/webhook",
            ),
            ("https://h/app", "api/privacy", "https://h/app/api/privacy"),
            ("https://h/?x=1", "api/privacy", "https://h/api/privacy"),
            (
                "https://h/app/#f",
                "telegram/webhook",
                "https://h/app/telegram/webhook",
            ),
            (
                "https://h/app/?x=1#f",
                "api/privacy",
                "https://h/app/api/privacy",
            ),
        ];
        let failures: Vec<String> = cases
            .iter()
            .filter(|(base, path, want)| app_url(base, path) != *want)
            .map(|(base, path, want)| {
                format!(
                    "app_url({base:?}, {path:?}): expected {want}, got {}",
                    app_url(base, path)
                )
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
