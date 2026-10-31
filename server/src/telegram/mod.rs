//! The Telegram layer (principle 6): the Bot API through frankenstein types behind the [`gateway::BotGateway`] seam,
//! and the webhook route Telegram's updates arrive on ([`webhook::webhook`]), with no bot framework.

pub mod gateway;
pub mod webhook;
