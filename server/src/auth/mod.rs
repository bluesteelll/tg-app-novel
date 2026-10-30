//! Authentication: Telegram initData validation, then the server's own short-lived session token.

pub mod initdata;
pub mod token;

pub use initdata::{
    InitData, InitDataError, TgUser, data_check_string, secret_key, validate_init_data,
};
pub use token::{TokenError, TokenKey, issue_token, verify_token};

use hmac::{Hmac, KeyInit};
use sha2::Sha256;

/// HMAC-SHA256, the one MAC of the auth module (initData and session tokens).
pub(crate) type HmacSha256 = Hmac<Sha256>;

/// A fresh HMAC-SHA256 keyed with `key`.
pub(crate) fn hmac_sha256(key: &[u8]) -> HmacSha256 {
    // hmac's own `KeyInit::new` makes the same claim (hmac-0.13.0 block_api.rs): the key is hashed or padded.
    HmacSha256::new_from_slice(key).expect("invariant: HMAC accepts keys of any length")
}
