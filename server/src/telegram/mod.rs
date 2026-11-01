//! The Telegram layer (principle 6): the Bot API through frankenstein types behind the [`gateway::BotGateway`] seam,
//! the webhook route Telegram's updates arrive on ([`webhook::webhook`]), and the payment path the webhook drives
//! ([`payments`]), with no bot framework.

pub mod gateway;
pub mod payments;
pub mod webhook;
