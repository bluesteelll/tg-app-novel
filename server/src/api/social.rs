//! The social routes (META-PLAN M10-M12, M15): the limits and the wire shapes of invite codes and handles. The SQL
//! lives in `db/social.rs`.
//!
//! An invite link is `https://t.me/<bot>?startapp=f<code>`; the server reads the signed `start_param` only. Every
//! other `start_param` shape is reserved for later prefixes (campaign codes) and stays harmless: it creates nothing.

/// Friends per user (MV15).
pub const MAX_FRIENDS: i64 = 200;

/// Pending incoming requests per user (MV15): further requests create nothing and are answered `requested`.
pub const MAX_PENDING_REQUESTS: i64 = 50;

/// Invite-code rotations per user per rolling day (MV15).
pub const MAX_ROTATIONS_PER_DAY: i64 = 10;

/// The consent texts the client may name (`PUT /api/consents/friends_profile`): a closed list.
pub const CONSENT_TEXT_VERSIONS: [&str; 1] = ["friends_profile.v1"];

/// The `start_param` prefix of an invite.
const INVITE_PREFIX: &str = "f";

/// The hex digits of an invite code: 16 random bytes.
const CODE_HEX_LEN: usize = 32;

/// The hex digits of a handle: 12 random bytes.
const HANDLE_HEX_LEN: usize = 24;

/// `s` is exactly `len` lower-case hex digits.
fn is_lower_hex(s: &str, len: usize) -> bool {
    s.len() == len && s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

/// `s` is an invite code: exactly 32 lower-case hex digits (`invite_codes_shape`).
pub fn is_invite_code(s: &str) -> bool {
    is_lower_hex(s, CODE_HEX_LEN)
}

/// The invite code a signed `start_param` carries: `f` + an invite code, else `None` (an upper-case prefix or digit,
/// another length, U+0000, or another prefix).
pub fn invite_code_of_start_param(sp: &str) -> Option<&str> {
    sp.strip_prefix(INVITE_PREFIX)
        .filter(|code| is_invite_code(code))
}

/// `s` is a handle: exactly 24 lower-case hex digits.
pub fn is_handle(s: &str) -> bool {
    is_lower_hex(s, HANDLE_HEX_LEN)
}
