//! The server's own session token: `v1.<user_id>.<exp>.<hex HMAC-SHA256(TOKEN_KEY, "v1.<user_id>.<exp>")>`.
//!
//! Not a JWT: no header, no algorithm choice, nothing for a client to negotiate. Only this server reads it.

use std::fmt;

use hmac::Mac;

use crate::auth::hmac_sha256;
use crate::ids::UserId;

/// The token format version, the first dot-separated part. A key rotation bumps it.
const VERSION: &str = "v1";

/// The MAC key of the session tokens (`TOKEN_KEY`). `Debug` prints `<redacted>`.
pub struct TokenKey([u8; 32]);

impl TokenKey {
    /// Wraps the 32 key bytes.
    pub fn new(bytes: [u8; 32]) -> TokenKey {
        TokenKey(bytes)
    }
}

impl fmt::Debug for TokenKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("TokenKey(<redacted>)")
    }
}

/// Why a token was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum TokenError {
    /// Not four dot-separated parts, an unknown version, a non-integer user id or expiry, or a tag that is not 64
    /// hex characters.
    #[error("token malformed")]
    Malformed,
    /// The tag is not the MAC of the first three parts under this key.
    #[error("token MAC mismatch")]
    BadMac,
    /// Correctly signed, but `exp` is not after now.
    #[error("token expired")]
    Expired,
}

/// Issues a token for `user` valid until `now + ttl`; returns the token and that expiry (unix seconds).
pub fn issue_token(k: &TokenKey, user: UserId, now: i64, ttl: i64) -> (String, i64) {
    let exp = now.saturating_add(ttl);
    let signed = format!("{VERSION}.{}.{exp}", user.0);
    let tag = hex::encode(
        hmac_sha256(&k.0)
            .chain_update(signed.as_bytes())
            .finalize()
            .into_bytes(),
    );
    (format!("{signed}.{tag}"), exp)
}

/// Verifies a token at time `now`: shape, then the MAC over the received `v1.<uid>.<exp>` bytes (constant time),
/// then `exp > now`. Expiry is reported only for a token this key signed.
pub fn verify_token(k: &TokenKey, t: &str, now: i64) -> Result<UserId, TokenError> {
    let (signed, tag_hex) = t.rsplit_once('.').ok_or(TokenError::Malformed)?;
    let mut parts = signed.split('.');
    let (Some(version), Some(uid), Some(exp), None) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return Err(TokenError::Malformed);
    };
    if version != VERSION || tag_hex.len() != 64 {
        return Err(TokenError::Malformed);
    }
    let uid: i64 = uid.parse().map_err(|_| TokenError::Malformed)?;
    let exp: i64 = exp.parse().map_err(|_| TokenError::Malformed)?;
    let tag = hex::decode(tag_hex).map_err(|_| TokenError::Malformed)?;
    // The MAC covers the bytes received, not a re-rendering of the parsed numbers: `+1001` or `01001` cannot pass
    // as the `1001` that was signed.
    hmac_sha256(&k.0)
        .chain_update(signed.as_bytes())
        .verify_slice(&tag)
        .map_err(|_| TokenError::BadMac)?;
    if exp <= now {
        return Err(TokenError::Expired);
    }
    Ok(UserId(uid))
}
