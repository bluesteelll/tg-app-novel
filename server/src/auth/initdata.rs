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
    /// The signed `start_param` (the `startapp` value of the launch link) as sent, any shape, or `None` when the pair
    /// is absent. What a shape means is the feature's decision (`api/social.rs` reads the invite prefix).
    pub start_param: Option<String>,
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
        // Read from the HMAC-checked pairs, like every field here: never from `initDataUnsafe` or the request body.
        start_param: field(&pairs, "start_param").map(str::to_owned),
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

#[cfg(test)]
mod tests {
    use super::*;

    /// The bot token the vectors are signed with (`config::PLACEHOLDER_BOT_TOKEN`).
    const BOT_TOKEN: &str = crate::config::PLACEHOLDER_BOT_TOKEN;
    /// The vectors' `auth_date`, used as the validator's clock.
    const NOW: i64 = 1_790_000_000;
    /// The signed `start_param` of vector (a).
    const START: &str = "f0123456789abcdef0123456789abcdef";

    /// (a) `auth_date`, `start_param` and `user`, signed.
    const SIGNED_WITH_START: &str = "auth_date=1790000000&start_param=f0123456789abcdef0123456789abcdef&user=%7B%22id%22%3A5000000001%2C%22first_name%22%3A%22Ann%22%2C%22language_code%22%3A%22ru%22%7D&hash=51fbef8da1df9127bb1f96f82a326d96693caa130f86a4defcaf0336d3abe9fe";
    /// (b) (a) with the last hex digit of `start_param` edited after signing.
    const EDITED_START: &str = "auth_date=1790000000&start_param=f0123456789abcdef0123456789abcdee&user=%7B%22id%22%3A5000000001%2C%22first_name%22%3A%22Ann%22%2C%22language_code%22%3A%22ru%22%7D&hash=51fbef8da1df9127bb1f96f82a326d96693caa130f86a4defcaf0336d3abe9fe";
    /// (c) `auth_date` and `user`, signed, without `start_param`.
    const SIGNED_WITHOUT_START: &str = "auth_date=1790000000&user=%7B%22id%22%3A5000000001%2C%22first_name%22%3A%22Ann%22%2C%22language_code%22%3A%22ru%22%7D&hash=94e7e951aa55f51f0f3585494c1ec0b30a66a4baa9218d0cade0938b632256ae";
    /// (d) (c) with a `start_param` pair appended after signing.
    const APPENDED_START: &str = "auth_date=1790000000&user=%7B%22id%22%3A5000000001%2C%22first_name%22%3A%22Ann%22%2C%22language_code%22%3A%22ru%22%7D&hash=94e7e951aa55f51f0f3585494c1ec0b30a66a4baa9218d0cade0938b632256ae&start_param=f0123456789abcdef0123456789abcdef";

    /// `start_param` comes from the signed pairs only. The four vectors are signed by Node's `crypto`, independently
    /// of this module's signer, by this script (the algorithm of `tests/fixtures/sign_initdata.mjs`):
    ///
    /// ```text
    /// import { createHmac } from 'node:crypto';
    /// const BOT_TOKEN = '1000000001:placeholder-bot-token-not-a-real-one';
    /// const AUTH_DATE = '1790000000';
    /// const USER = '{"id":5000000001,"first_name":"Ann","language_code":"ru"}';
    /// const START = 'f0123456789abcdef0123456789abcdef';
    /// const SECRET = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
    /// const dcs = (pairs) => pairs.filter(([k]) => k !== 'hash').slice()
    ///   .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join('\n');
    /// const raw = (pairs) => pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    /// const sign = (pairs) => [...pairs, ['hash', createHmac('sha256', SECRET).update(dcs(pairs)).digest('hex')]];
    /// const withStart = sign([['auth_date', AUTH_DATE], ['start_param', START], ['user', USER]]);
    /// const without = sign([['auth_date', AUTH_DATE], ['user', USER]]);
    /// const a = raw(withStart);
    /// const b = a.replace(`start_param=${START}`, `start_param=${START.slice(0, -1)}e`);
    /// const c = raw(without);
    /// const d = `${c}&start_param=${START}`;
    /// console.log(JSON.stringify({ a, b, c, d }, null, 2));
    /// ```
    #[test]
    fn start_param_from_signed_string() {
        let check = |raw: &str| validate_init_data(raw, BOT_TOKEN, NOW, 86400);
        let mut failures = Vec::new();
        match check(SIGNED_WITH_START) {
            Ok(data) if data.start_param.as_deref() == Some(START) => {}
            Ok(data) => failures.push(format!(
                "(a): expected Some({START:?}), got {:?}",
                data.start_param
            )),
            Err(e) => failures.push(format!("(a): expected Ok, got Err({e:?})")),
        }
        match check(EDITED_START) {
            Err(InitDataError::BadHash) => {}
            got => failures.push(format!(
                "(b) edited value: expected Err(BadHash), got {got:?}"
            )),
        }
        match check(SIGNED_WITHOUT_START) {
            Ok(data) if data.start_param.is_none() => {}
            Ok(data) => failures.push(format!("(c): expected None, got {:?}", data.start_param)),
            Err(e) => failures.push(format!("(c): expected Ok, got Err({e:?})")),
        }
        match check(APPENDED_START) {
            Err(InitDataError::BadHash) => {}
            got => failures.push(format!(
                "(d) appended after signing: expected Err(BadHash), got {got:?}"
            )),
        }
        assert!(
            failures.is_empty(),
            "{} failures:\n{}",
            failures.len(),
            failures.join("\n")
        );
    }
}
