//! Telegram Mini App initData validation (core.telegram.org/bots/webapps, "Validating data received via the Mini
//! App"): the HMAC over the data-check-string, then the `auth_date` window, then the `user` field.

use hmac::Mac;
use serde::Deserialize;

use crate::auth::hmac_sha256;
use crate::ids::UserId;

/// How far `auth_date` may lie in the future: the server's and Telegram's clocks may disagree by this much.
pub const MAX_FUTURE_SKEW_SECS: i64 = 60;

/// Why initData was refused. The wire maps `Expired` and `FromFuture` to `initdata_expired`, the rest to
/// `initdata_invalid`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum InitDataError {
    /// A signed field has the wrong shape (`auth_date` absent or not an integer, `user` not the expected JSON).
    #[error("initData malformed")]
    Malformed,
    /// A key occurs twice: refused before the HMAC, so no parser disagreement can pick a different value.
    #[error("initData has a duplicate key")]
    DuplicateKey,
    /// No `hash` field.
    #[error("initData has no hash")]
    MissingHash,
    /// Signed, but without a `user` field.
    #[error("initData has no user")]
    MissingUser,
    /// The `hash` is not hex, or not the HMAC of the data-check-string.
    #[error("initData hash mismatch")]
    BadHash,
    /// `auth_date` is older than the accepted age.
    #[error("initData expired")]
    Expired,
    /// `auth_date` is more than [`MAX_FUTURE_SKEW_SECS`] ahead of the server clock.
    #[error("initData from the future")]
    FromFuture,
}

/// Verified initData: every field here passed the HMAC and freshness checks.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InitData {
    /// The Telegram user who opened the Mini App.
    pub user: TgUser,
    /// When Telegram issued the initData, in unix seconds.
    pub auth_date: i64,
}

/// The verified Telegram user.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TgUser {
    /// The Telegram user id.
    pub id: UserId,
    /// The user's first name as Telegram sends it.
    pub first_name: String,
    /// The user's IETF language tag, if Telegram sent one.
    pub language_code: Option<String>,
}

/// The `user` JSON fields the server reads; every other field (and any future one) is ignored.
#[derive(Deserialize)]
struct UserJson {
    id: i64,
    first_name: String,
    #[serde(default)]
    language_code: Option<String>,
}

/// Validates raw initData (the query string `Telegram.WebApp.initData`) against the bot token at time `now`.
///
/// Order: decode, duplicate keys, `hash` present and hex, HMAC (constant time), and only then any field is read.
/// An unauthenticated `auth_date` therefore never yields `Expired`: a forged or tampered value is `BadHash`.
pub fn validate_init_data(
    raw: &str,
    bot_token: &str,
    now: i64,
    max_age: i64,
) -> Result<InitData, InitDataError> {
    // Decodes `%xx` and `+` (a space); the data-check-string is built from the decoded values.
    let mut pairs: Vec<(String, String)> = form_urlencoded::parse(raw.as_bytes())
        .into_owned()
        .collect();
    pairs.sort_by(|a, b| a.0.cmp(&b.0));
    if pairs.windows(2).any(|w| w[0].0 == w[1].0) {
        return Err(InitDataError::DuplicateKey);
    }
    let hash_hex = field(&pairs, "hash").ok_or(InitDataError::MissingHash)?;
    let expected = hex::decode(hash_hex).map_err(|_| InitDataError::BadHash)?;
    let mut mac = hmac_sha256(&secret_key(bot_token));
    mac.update(data_check_string(&pairs).as_bytes());
    // `verify_slice` rejects a wrong length, then compares in constant time.
    mac.verify_slice(&expected)
        .map_err(|_| InitDataError::BadHash)?;

    let auth_date: i64 = field(&pairs, "auth_date")
        .ok_or(InitDataError::Malformed)?
        .parse()
        .map_err(|_| InitDataError::Malformed)?;
    // Both bounds are inclusive: exactly `max_age` old, or exactly the skew ahead, is accepted.
    if now.saturating_sub(auth_date) > max_age {
        return Err(InitDataError::Expired);
    }
    if auth_date.saturating_sub(now) > MAX_FUTURE_SKEW_SECS {
        return Err(InitDataError::FromFuture);
    }
    let user_json = field(&pairs, "user").ok_or(InitDataError::MissingUser)?;
    let user: UserJson = serde_json::from_str(user_json).map_err(|_| InitDataError::Malformed)?;
    Ok(InitData {
        user: TgUser {
            id: UserId(user.id),
            first_name: user.first_name,
            language_code: user.language_code,
        },
        auth_date,
    })
}

/// The data-check-string: every pair except the one keyed `hash` (`signature` stays in), sorted by key bytes,
/// `key=value` joined by `\n`. Values are the decoded ones. The dev signer builds initData with this function.
pub fn data_check_string(pairs: &[(String, String)]) -> String {
    let mut kept: Vec<&(String, String)> = pairs.iter().filter(|(k, _)| k != "hash").collect();
    kept.sort_by(|a, b| a.0.cmp(&b.0));
    let mut out = String::new();
    for (i, (key, value)) in kept.into_iter().enumerate() {
        if i > 0 {
            out.push('\n');
        }
        out.push_str(key);
        out.push('=');
        out.push_str(value);
    }
    out
}

/// The initData HMAC key: HMAC-SHA256 with the key `WebAppData` over the bot token.
pub fn secret_key(bot_token: &str) -> [u8; 32] {
    hmac_sha256(b"WebAppData")
        .chain_update(bot_token.as_bytes())
        .finalize()
        .into_bytes()
        .into()
}

/// The value of `key` in pairs already checked for duplicates.
fn field<'a>(pairs: &'a [(String, String)], key: &str) -> Option<&'a str> {
    pairs
        .iter()
        .find(|(k, _)| k == key)
        .map(|(_, v)| v.as_str())
}
