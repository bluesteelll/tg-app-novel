//! The Bot API seam: [`BotGateway`] is every call the server makes to Telegram, and [`FrankensteinGateway`] makes
//! them through frankenstein's reqwest client. Tests and the dev app install a fake through `AppState::with_gateway`.
//!
//! Principle 2 by type: an [`InvoiceSpec`] has no currency, provider or price-list field, so no caller can express a
//! non-Stars invoice; the gateway adds `XTR`, the empty `provider_token` and the one price.
//!
//! Secrets: [`FrankensteinGateway`] has no `Debug` (frankenstein's `Bot` prints its `api_url`, which holds the bot
//! token), nor has [`SetupSpec`] (it carries `WEBHOOK_SECRET`), and a [`GatewayError`] never carries request text.

use std::future::Future;
use std::pin::Pin;
use std::time::Duration;

use frankenstein::AsyncTelegramApi;
use frankenstein::client_reqwest::Bot;
use frankenstein::methods::{
    AnswerPreCheckoutQueryParams, CreateInvoiceLinkParams, RefundStarPaymentParams,
    SendMessageParams, SetChatMenuButtonParams, SetMyCommandsParams, SetWebhookParams,
};
use frankenstein::payments::LabeledPrice;
use frankenstein::types::{
    AllowedUpdate, BotCommand, InlineKeyboardButton, InlineKeyboardMarkup, MenuButton,
    MenuButtonWebApp, ReplyMarkup, WebAppInfo,
};

use crate::config::{PLACEHOLDER_BOT_TOKEN, TelegramEnv};
use crate::ids::{ChargeId, OrderId, UserId};

/// The currency of every invoice: Telegram Stars.
const STARS_CURRENCY: &str = "XTR";

/// The deadline of one Bot API call, connect to decoded answer (K18): a pre-checkout answer is due within 10 s.
pub const CALL_DEADLINE: Duration = Duration::from_secs(5);

/// The HTTP client's connect timeout (K18).
const CONNECT_TIMEOUT: Duration = Duration::from_secs(2);

/// The HTTP client's whole-request timeout (K18); [`CALL_DEADLINE`] bounds the call around it.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);

/// The updates the webhook asks for (K17): always passed explicitly, so a kind the server cannot decode is never sent.
const ALLOWED_UPDATES: [AllowedUpdate; 2] =
    [AllowedUpdate::Message, AllowedUpdate::PreCheckoutQuery];

/// A boxed future: the trait stays object-safe, so `AppState` holds an `Arc<dyn BotGateway>`.
pub type BoxFut<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// Every Bot API call the server makes. Each call is bounded by [`CALL_DEADLINE`] in the production gateway.
pub trait BotGateway: Send + Sync {
    /// `createInvoiceLink` for a Stars invoice of `spec`: the link the client opens with `openInvoice`.
    fn create_invoice_link(&self, spec: InvoiceSpec) -> BoxFut<'_, Result<String, GatewayError>>;
    /// `answerPreCheckoutQuery`: `Ok(())` accepts the checkout, `Err(text)` refuses it with `text` shown to the payer.
    fn answer_pre_checkout(
        &self,
        query_id: String,
        verdict: Result<(), String>,
    ) -> BoxFut<'_, Result<(), GatewayError>>;
    /// `refundStarPayment` of `charge` to `user`.
    fn refund_star_payment(
        &self,
        user: UserId,
        charge: ChargeId,
    ) -> BoxFut<'_, Result<(), GatewayError>>;
    /// `sendMessage` of `msg`.
    fn send_message(&self, msg: OutMessage) -> BoxFut<'_, Result<(), GatewayError>>;
    /// `setWebhook`, then `setMyCommands` once per command set, then `setChatMenuButton` for the default chat; stops
    /// at the first error.
    fn setup(&self, s: SetupSpec) -> BoxFut<'_, Result<(), GatewayError>>;
}

/// A Stars invoice: the texts, the payload and the one price. The currency and the empty `provider_token` are the
/// gateway's, never the caller's.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InvoiceSpec {
    /// The invoice title, 1-32 characters.
    pub title: String,
    /// The invoice description, 1-255 characters.
    pub description: String,
    /// The order the invoice pays for: the payload Telegram sends back in the pre-checkout and the payment.
    pub payload: OrderId,
    /// The label of the one price item.
    pub label: String,
    /// The price in Telegram Stars.
    pub amount: u32,
}

/// An inline keyboard button that opens the Mini App.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WebAppButton {
    /// The button text.
    pub text: String,
    /// The Mini App URL it opens.
    pub url: String,
}

/// A plain-text message to a private chat, with an optional button that opens the Mini App.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OutMessage {
    /// The chat: the user id for a private chat.
    pub chat_id: i64,
    /// The text, sent without a parse mode.
    pub text: String,
    /// The one inline button, if any.
    pub web_app_button: Option<WebAppButton>,
}

/// A bot command for the command menu.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BotCommandSpec {
    /// The command without the slash, e.g. `start`.
    pub command: String,
    /// Its description in the menu.
    pub description: String,
}

/// The commands of one language: one `setMyCommands` call.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommandSet {
    /// The language the set is for; `None` is the default set.
    pub language_code: Option<String>,
    /// The commands, in menu order.
    pub commands: Vec<BotCommandSpec>,
}

/// The bot's one-time setup: the webhook, the command sets and the menu button.
// No `Debug`: `secret_token` is `WEBHOOK_SECRET`.
#[derive(Clone)]
pub struct SetupSpec {
    /// The webhook URL Telegram posts updates to.
    pub webhook_url: String,
    /// The `secret_token` Telegram echoes in `X-Telegram-Bot-Api-Secret-Token`.
    pub secret_token: String,
    /// The command sets, each one `setMyCommands` call.
    pub commands: Vec<CommandSet>,
    /// The menu button of the default chat.
    pub menu_button: WebAppButton,
}

/// Why a Bot API call failed. No variant carries request text: params can hold `WEBHOOK_SECRET`, and the request URL
/// holds the bot token.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum GatewayError {
    /// No answer within the deadline (the client's timeouts or [`CALL_DEADLINE`]).
    #[error("timeout")]
    Timeout,
    /// The Bot API refused the call: its `description`, verbatim.
    #[error("api: {0}")]
    Api(String),
    /// The call did not reach the Bot API, or its answer could not be read.
    #[error("transport: {0}")]
    Transport(String),
    /// The bot token is the `.env.example` placeholder: no client exists, and no call leaves the process.
    #[error("bot api disabled: placeholder BOT_TOKEN")]
    Disabled,
}

/// The production gateway: frankenstein's reqwest client on the Bot API base of the configured environment.
// No `Debug`: frankenstein's `Bot` derives it and would print its `api_url`, which holds the bot token.
pub struct FrankensteinGateway {
    /// `None` for the placeholder token: every call is then [`GatewayError::Disabled`].
    bot: Option<Bot>,
}

impl FrankensteinGateway {
    /// The gateway for `bot_token` in `env`: the client has K18's timeouts (2 s connect, 5 s total). The placeholder
    /// token builds no client at all.
    pub fn new(bot_token: &str, env: TelegramEnv) -> Result<FrankensteinGateway, GatewayError> {
        build(bot_token, api_base(bot_token, env))
    }

    /// The client, or [`GatewayError::Disabled`] without one.
    fn bot(&self) -> Result<&Bot, GatewayError> {
        self.bot.as_ref().ok_or(GatewayError::Disabled)
    }
}

/// The Bot API base of `env`: `https://api.telegram.org/bot<token>`, plus `/test` for the test environment (R2 §1.7).
/// frankenstein posts each method to `<base>/<method>`.
fn api_base(bot_token: &str, env: TelegramEnv) -> String {
    let mut base = String::from(frankenstein::BASE_API_URL);
    base.push_str(bot_token);
    if env == TelegramEnv::Test {
        base.push_str("/test");
    }
    base
}

/// The gateway on `base`. The placeholder token gets no client: every test state and the dev app run on it, so a
/// test that forgets its fake gets [`GatewayError::Disabled`], never a request to Telegram.
fn build(bot_token: &str, base: String) -> Result<FrankensteinGateway, GatewayError> {
    if bot_token == PLACEHOLDER_BOT_TOKEN {
        return Ok(FrankensteinGateway { bot: None });
    }
    let client = frankenstein::reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|e| GatewayError::Transport(e.without_url().to_string()))?;
    Ok(FrankensteinGateway {
        bot: Some(Bot::builder().api_url(base).client(client).build()),
    })
}

/// `call` within `deadline`: past it the call is dropped and the answer is [`GatewayError::Timeout`].
async fn bounded<T>(
    deadline: Duration,
    call: impl Future<Output = Result<T, frankenstein::Error>>,
) -> Result<T, GatewayError> {
    match tokio::time::timeout(deadline, call).await {
        Ok(Ok(value)) => Ok(value),
        Ok(Err(e)) => Err(map_error(e)),
        Err(_) => Err(GatewayError::Timeout),
    }
}

/// frankenstein's error without request text: an API refusal keeps its description (a refund matches on it); an
/// encoding error drops its `input`, which is the params' `Debug` and may hold `WEBHOOK_SECRET`; a decoding error
/// drops the response body.
fn map_error(e: frankenstein::Error) -> GatewayError {
    match e {
        frankenstein::Error::Api(response) => GatewayError::Api(response.description),
        frankenstein::Error::HttpReqwest(e) if e.is_timeout() => GatewayError::Timeout,
        // frankenstein strips the URL (and the token in it) already; stripping again keeps that true on any path.
        frankenstein::Error::HttpReqwest(e) => GatewayError::Transport(e.without_url().to_string()),
        frankenstein::Error::JsonEncode { .. } => {
            GatewayError::Transport("request encoding failed".to_owned())
        }
        frankenstein::Error::JsonDecode { source, .. } => {
            GatewayError::Transport(format!("response decoding failed: {source}"))
        }
        // `frankenstein::Error` is `#[non_exhaustive]`: a later variant may carry anything.
        _ => GatewayError::Transport("bot api client error".to_owned()),
    }
}

/// A `true` result, or the method's refusal: the Bot API answers these methods with a bare `true`.
fn confirmed(method: &'static str, done: bool) -> Result<(), GatewayError> {
    if done {
        Ok(())
    } else {
        Err(GatewayError::Api(format!("{method} returned false")))
    }
}

/// `createInvoiceLink` params: exactly the texts, the payload, an explicit empty `provider_token` ("Pass an empty
/// string for payments in Telegram Stars"), `XTR` and one price. No photo, tip, flexible, subscription or business
/// field.
fn invoice_params(spec: &InvoiceSpec) -> CreateInvoiceLinkParams {
    CreateInvoiceLinkParams::builder()
        .title(spec.title.clone())
        .description(spec.description.clone())
        .payload(spec.payload.0.clone())
        .provider_token(String::new())
        .currency(STARS_CURRENCY.to_owned())
        .prices(vec![LabeledPrice {
            label: spec.label.clone(),
            amount: spec.amount,
        }])
        .build()
}

/// `answerPreCheckoutQuery` params: `ok`, plus the error message of a refusal.
fn answer_params(query_id: String, verdict: Result<(), String>) -> AnswerPreCheckoutQueryParams {
    let (ok, error_message) = match verdict {
        Ok(()) => (true, None),
        Err(text) => (false, Some(text)),
    };
    AnswerPreCheckoutQueryParams {
        pre_checkout_query_id: query_id,
        ok,
        error_message,
    }
}

/// `refundStarPayment` params; a negative user id is no Telegram user and makes no call.
fn refund_params(user: UserId, charge: ChargeId) -> Result<RefundStarPaymentParams, GatewayError> {
    let user_id = u64::try_from(user.0)
        .map_err(|_| GatewayError::Transport("user id out of range".to_owned()))?;
    Ok(RefundStarPaymentParams {
        user_id,
        telegram_payment_charge_id: charge.0,
    })
}

/// The inline button that opens `button.url` as a Mini App.
fn web_app_key(button: WebAppButton) -> InlineKeyboardButton {
    InlineKeyboardButton::builder()
        .text(button.text)
        .web_app(WebAppInfo { url: button.url })
        .build()
}

/// `sendMessage` params: the chat, the plain text and, with a button, a one-button inline keyboard.
fn message_params(msg: OutMessage) -> SendMessageParams {
    let reply_markup = msg.web_app_button.map(|button| {
        ReplyMarkup::InlineKeyboardMarkup(InlineKeyboardMarkup {
            inline_keyboard: vec![vec![web_app_key(button)]],
            force_reply: None,
        })
    });
    SendMessageParams::builder()
        .chat_id(msg.chat_id)
        .text(msg.text)
        .maybe_reply_markup(reply_markup)
        .build()
}

/// One call of [`BotGateway::setup`].
// No `Debug`: the webhook params carry `WEBHOOK_SECRET`.
enum SetupCall {
    /// `setWebhook`.
    Webhook(SetWebhookParams),
    /// `setMyCommands`.
    Commands(SetMyCommandsParams),
    /// `setChatMenuButton`.
    Menu(SetChatMenuButtonParams),
}

impl SetupCall {
    /// The Bot API method name.
    fn method(&self) -> &'static str {
        match self {
            SetupCall::Webhook(_) => "setWebhook",
            SetupCall::Commands(_) => "setMyCommands",
            SetupCall::Menu(_) => "setChatMenuButton",
        }
    }
}

/// The calls of a setup, in order: the webhook with [`ALLOWED_UPDATES`] and the secret, every command set, then the
/// menu button of the default chat.
fn setup_calls(s: SetupSpec) -> Vec<SetupCall> {
    let mut calls = vec![SetupCall::Webhook(
        SetWebhookParams::builder()
            .url(s.webhook_url)
            .allowed_updates(ALLOWED_UPDATES.to_vec())
            .secret_token(s.secret_token)
            .build(),
    )];
    calls.extend(s.commands.into_iter().map(|set| {
        SetupCall::Commands(SetMyCommandsParams {
            commands: set
                .commands
                .into_iter()
                .map(|c| BotCommand {
                    command: c.command,
                    description: c.description,
                    is_ephemeral: None,
                })
                .collect(),
            scope: None,
            language_code: set.language_code,
        })
    }));
    calls.push(SetupCall::Menu(SetChatMenuButtonParams {
        chat_id: None,
        menu_button: Some(MenuButton::WebApp(MenuButtonWebApp {
            text: s.menu_button.text,
            web_app: WebAppInfo {
                url: s.menu_button.url,
            },
        })),
    }));
    calls
}

impl BotGateway for FrankensteinGateway {
    fn create_invoice_link(&self, spec: InvoiceSpec) -> BoxFut<'_, Result<String, GatewayError>> {
        Box::pin(async move {
            let bot = self.bot()?;
            let params = invoice_params(&spec);
            Ok(bounded(CALL_DEADLINE, bot.create_invoice_link(&params))
                .await?
                .result)
        })
    }

    fn answer_pre_checkout(
        &self,
        query_id: String,
        verdict: Result<(), String>,
    ) -> BoxFut<'_, Result<(), GatewayError>> {
        Box::pin(async move {
            let bot = self.bot()?;
            let params = answer_params(query_id, verdict);
            let done = bounded(CALL_DEADLINE, bot.answer_pre_checkout_query(&params)).await?;
            confirmed("answerPreCheckoutQuery", done.result)
        })
    }

    fn refund_star_payment(
        &self,
        user: UserId,
        charge: ChargeId,
    ) -> BoxFut<'_, Result<(), GatewayError>> {
        Box::pin(async move {
            let bot = self.bot()?;
            let params = refund_params(user, charge)?;
            let done = bounded(CALL_DEADLINE, bot.refund_star_payment(&params)).await?;
            confirmed("refundStarPayment", done.result)
        })
    }

    fn send_message(&self, msg: OutMessage) -> BoxFut<'_, Result<(), GatewayError>> {
        Box::pin(async move {
            let bot = self.bot()?;
            let params = message_params(msg);
            bounded(CALL_DEADLINE, bot.send_message(&params)).await?;
            Ok(())
        })
    }

    fn setup(&self, s: SetupSpec) -> BoxFut<'_, Result<(), GatewayError>> {
        Box::pin(async move {
            let bot = self.bot()?;
            for call in setup_calls(s) {
                let done = match &call {
                    SetupCall::Webhook(params) => {
                        bounded(CALL_DEADLINE, bot.set_webhook(params)).await?
                    }
                    SetupCall::Commands(params) => {
                        bounded(CALL_DEADLINE, bot.set_my_commands(params)).await?
                    }
                    SetupCall::Menu(params) => {
                        bounded(CALL_DEADLINE, bot.set_chat_menu_button(params)).await?
                    }
                };
                confirmed(call.method(), done.result)?;
            }
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests {
    use std::time::Instant;

    use frankenstein::response::ErrorResponse;
    use serde_json::{Value, json};

    use super::*;

    /// An order id in the payload grammar.
    const ORDER: &str = "o_0123456789abcdef0123456789abcdef";

    fn report(failures: &[String]) {
        assert!(
            failures.is_empty(),
            "{} failures:\n{}",
            failures.len(),
            failures.join("\n")
        );
    }

    /// `params` as JSON: the request body frankenstein sends.
    fn to_json(params: &impl serde::Serialize) -> Value {
        serde_json::to_value(params).expect("invariant: Bot API params serialize")
    }

    /// The mismatch of `got` against `want`.
    fn expect_json(case: &str, got: &Value, want: &Value) -> Option<String> {
        (got != want).then(|| format!("{case}: expected {want}, got {got}"))
    }

    fn invoice_spec() -> InvoiceSpec {
        InvoiceSpec {
            title: "Архив".to_owned(),
            description: "«Усадьба»: Архив".to_owned(),
            payload: OrderId(ORDER.to_owned()),
            label: "Архив".to_owned(),
            amount: 1,
        }
    }

    fn play_button() -> WebAppButton {
        WebAppButton {
            text: "Играть".to_owned(),
            url: "https://example.invalid/".to_owned(),
        }
    }

    fn message(button: Option<WebAppButton>) -> OutMessage {
        OutMessage {
            chat_id: 1001,
            text: "hi".to_owned(),
            web_app_button: button,
        }
    }

    fn command_set(language_code: Option<&str>, description: &str) -> CommandSet {
        CommandSet {
            language_code: language_code.map(str::to_owned),
            commands: vec![BotCommandSpec {
                command: "start".to_owned(),
                description: description.to_owned(),
            }],
        }
    }

    fn setup_spec() -> SetupSpec {
        SetupSpec {
            webhook_url: "https://example.invalid/telegram/webhook".to_owned(),
            secret_token: "s".to_owned(),
            commands: vec![command_set(None, "Play"), command_set(Some("ru"), "Играть")],
            menu_button: play_button(),
        }
    }

    /// A `serde_json::Error` to wrap in frankenstein's JSON errors.
    fn json_error() -> serde_json::Error {
        serde_json::from_str::<Value>("{").expect_err("invariant: `{` is not JSON")
    }

    /// A Bot API refusal with `description`.
    fn api_refusal(description: &str) -> frankenstein::Error {
        frankenstein::Error::Api(ErrorResponse {
            ok: false,
            description: description.to_owned(),
            error_code: 400,
            parameters: None,
        })
    }

    /// The Stars invoice: exactly the six keys, `provider_token` empty and present, `XTR`, one price.
    #[test]
    fn gateway_invoice_request_shape() {
        let got = to_json(&invoice_params(&invoice_spec()));
        let want = json!({
            "title": "Архив",
            "description": "«Усадьба»: Архив",
            "payload": ORDER,
            "provider_token": "",
            "currency": "XTR",
            "prices": [{ "label": "Архив", "amount": 1 }],
        });
        report(&Vec::from_iter(expect_json(
            "createInvoiceLink",
            &got,
            &want,
        )));
    }

    /// The pre-checkout answers and the refund: an accept has no `error_message`, a refusal carries it; a negative
    /// user id makes no refund params.
    #[test]
    fn gateway_answer_request_shapes() {
        let mut failures = Vec::new();
        failures.extend(expect_json(
            "answer Ok",
            &to_json(&answer_params("q1".to_owned(), Ok(()))),
            &json!({ "pre_checkout_query_id": "q1", "ok": true }),
        ));
        failures.extend(expect_json(
            "answer Err",
            &to_json(&answer_params(
                "q1".to_owned(),
                Err("Уже куплено".to_owned()),
            )),
            &json!({ "pre_checkout_query_id": "q1", "ok": false, "error_message": "Уже куплено" }),
        ));
        match refund_params(UserId(1001), ChargeId("ch_1".to_owned())) {
            Ok(params) => failures.extend(expect_json(
                "refund",
                &to_json(&params),
                &json!({ "user_id": 1001, "telegram_payment_charge_id": "ch_1" }),
            )),
            Err(e) => failures.push(format!("refund 1001: expected params, got {e:?}")),
        }
        let negative = refund_params(UserId(-1), ChargeId("ch_1".to_owned()));
        if negative != Err(GatewayError::Transport("user id out of range".to_owned())) {
            failures.push(format!(
                "refund -1: expected Transport(\"user id out of range\"), got {negative:?}"
            ));
        }
        report(&failures);
    }

    /// A plain message, and one with the Mini App button as a one-button inline keyboard (R2 §2.3).
    #[test]
    fn gateway_message_request_shape() {
        let mut failures = Vec::new();
        failures.extend(expect_json(
            "plain",
            &to_json(&message_params(message(None))),
            &json!({ "chat_id": 1001, "text": "hi" }),
        ));
        failures.extend(expect_json(
            "with a button",
            &to_json(&message_params(message(Some(play_button())))),
            &json!({
                "chat_id": 1001,
                "text": "hi",
                "reply_markup": {
                    "inline_keyboard": [[{ "text": "Играть", "web_app": { "url": "https://example.invalid/" } }]]
                },
            }),
        ));
        report(&failures);
    }

    /// The setup calls in order (webhook, every command set, menu), each with its exact params.
    #[test]
    fn gateway_setup_request_shapes() {
        let calls = setup_calls(setup_spec());
        let mut failures = Vec::new();
        let methods: Vec<&str> = calls.iter().map(SetupCall::method).collect();
        let want_methods = [
            "setWebhook",
            "setMyCommands",
            "setMyCommands",
            "setChatMenuButton",
        ];
        if methods != want_methods {
            failures.push(format!("order: expected {want_methods:?}, got {methods:?}"));
        }
        let wants = [
            json!({
                "url": "https://example.invalid/telegram/webhook",
                "allowed_updates": ["message", "pre_checkout_query"],
                "secret_token": "s",
            }),
            json!({ "commands": [{ "command": "start", "description": "Play" }] }),
            json!({ "commands": [{ "command": "start", "description": "Играть" }], "language_code": "ru" }),
            json!({
                "menu_button": { "type": "web_app", "text": "Играть", "web_app": { "url": "https://example.invalid/" } }
            }),
        ];
        for (i, (call, want)) in calls.iter().zip(&wants).enumerate() {
            let got = match call {
                SetupCall::Webhook(params) => to_json(params),
                SetupCall::Commands(params) => to_json(params),
                SetupCall::Menu(params) => to_json(params),
            };
            failures.extend(expect_json(
                &format!("call {i} ({})", call.method()),
                &got,
                want,
            ));
        }
        report(&failures);
    }

    /// The base of each environment, and a real client builds on this host (no call is made).
    #[test]
    fn gateway_api_base_follows_telegram_env() {
        const TOKEN: &str = "123456:not-a-real-token";
        let mut failures = Vec::new();
        for (env, want) in [
            (
                TelegramEnv::Prod,
                "https://api.telegram.org/bot123456:not-a-real-token",
            ),
            (
                TelegramEnv::Test,
                "https://api.telegram.org/bot123456:not-a-real-token/test",
            ),
        ] {
            let got = api_base(TOKEN, env);
            if got != want {
                failures.push(format!("api_base {env:?}: expected {want}, got {got}"));
            }
            match FrankensteinGateway::new(TOKEN, env) {
                Ok(gateway) => {
                    let url = gateway.bot.as_ref().map(|bot| bot.api_url.as_str());
                    if url != Some(want) {
                        failures.push(format!(
                            "new {env:?}: expected a client on {want}, got {url:?}"
                        ));
                    }
                }
                Err(e) => failures.push(format!("new {env:?}: expected Ok, got {e:?}")),
            }
        }
        report(&failures);
    }

    /// The placeholder token makes no call: every method is `Disabled` at once. The base is the loopback discard
    /// port, so a broken guard shows as a local connect failure, never as traffic to Telegram.
    #[tokio::test]
    async fn gateway_placeholder_token_makes_no_call() {
        let gateway = match build(PLACEHOLDER_BOT_TOKEN, "http://127.0.0.1:9/bot".to_owned()) {
            Ok(gateway) => gateway,
            Err(e) => panic!("build: expected Ok, got {e:?}"),
        };
        let started = Instant::now();
        let results = [
            (
                "createInvoiceLink",
                gateway.create_invoice_link(invoice_spec()).await.map(drop),
            ),
            (
                "answerPreCheckoutQuery",
                gateway.answer_pre_checkout("q1".to_owned(), Ok(())).await,
            ),
            (
                "refundStarPayment",
                gateway
                    .refund_star_payment(UserId(1001), ChargeId("ch_1".to_owned()))
                    .await,
            ),
            ("sendMessage", gateway.send_message(message(None)).await),
            ("setup", gateway.setup(setup_spec()).await),
        ];
        let elapsed = started.elapsed();
        let mut failures: Vec<String> = results
            .iter()
            .filter(|(_, result)| *result != Err(GatewayError::Disabled))
            .map(|(method, result)| format!("{method}: expected Err(Disabled), got {result:?}"))
            .collect();
        if elapsed >= Duration::from_millis(100) {
            failures.push(format!(
                "the five calls: expected < 100 ms together, got {elapsed:?}"
            ));
        }
        report(&failures);
    }

    /// A call past its deadline is `Timeout`; an answer within it keeps its own error.
    #[tokio::test]
    async fn gateway_call_deadline_is_timeout() {
        let mut failures = Vec::new();
        let hung = bounded(
            Duration::from_millis(20),
            std::future::pending::<Result<(), frankenstein::Error>>(),
        );
        match tokio::time::timeout(Duration::from_secs(2), hung).await {
            Ok(Err(GatewayError::Timeout)) => {}
            Ok(other) => failures.push(format!(
                "pending call: expected Err(Timeout), got {other:?}"
            )),
            Err(_) => failures.push("pending call: no answer within 2 s".to_owned()),
        }
        let refused = bounded(
            CALL_DEADLINE,
            std::future::ready(Err::<(), _>(api_refusal("Bad Request: x"))),
        );
        match tokio::time::timeout(Duration::from_secs(2), refused).await {
            Ok(Err(GatewayError::Api(text))) if text == "Bad Request: x" => {}
            Ok(other) => failures.push(format!(
                "refused call: expected Err(Api(\"Bad Request: x\")), got {other:?}"
            )),
            Err(_) => failures.push("refused call: no answer within 2 s".to_owned()),
        }
        report(&failures);
    }

    /// An encoding error drops the params' text, a decoding error the body; an API refusal keeps its description.
    #[test]
    fn gateway_errors_carry_no_request_text() {
        let mut failures = Vec::new();
        let encode = map_error(frankenstein::Error::JsonEncode {
            source: json_error(),
            input: "SetWebhookParams { secret_token: Some(\"s3cr3t-in-params\") }".to_owned(),
        });
        if encode.to_string().contains("s3cr3t-in-params") {
            failures.push(format!(
                "JsonEncode: Display contains s3cr3t-in-params: {encode}"
            ));
        }
        let decode = map_error(frankenstein::Error::JsonDecode {
            source: json_error(),
            input: "<body>".to_owned(),
        });
        if decode.to_string().contains("<body>") {
            failures.push(format!("JsonDecode: Display contains <body>: {decode}"));
        }
        let api = map_error(api_refusal("Bad Request: CHARGE_ALREADY_REFUNDED"));
        if api != GatewayError::Api("Bad Request: CHARGE_ALREADY_REFUNDED".to_owned()) {
            failures.push(format!(
                "Api: expected the description verbatim, got {api:?}"
            ));
        }
        report(&failures);
    }
}
