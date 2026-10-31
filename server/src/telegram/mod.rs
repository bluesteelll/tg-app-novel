//! The Telegram layer (principle 6): the Bot API through frankenstein types behind the [`gateway::BotGateway`] seam,
//! with no bot framework. The webhook route and the payment facts join this module in a later lane.

pub mod gateway;
