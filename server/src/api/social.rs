//! The social routes (META-PLAN M10-M12, M15): the invite view and the request through an invite code (F19). Thin
//! handlers: the limits and the wire shapes of invite codes and handles live here, the SQL in `db/social.rs`. Every
//! 200 is `private, no-store`: one user's own view.
//!
//! An invite link is `https://t.me/<bot>?startapp=f<code>`; the server reads the signed `start_param` only. Every
//! other `start_param` shape is reserved for later prefixes (campaign codes) and stays harmless: it creates nothing.
//!
//! A malformed code is 400 `bad_request` (it never reaches SQL); a well-shaped code that is unknown or revoked is
//! 404 `not_found`. Neither reveals anything about a code's owner.

use axum::Json;
use axum::extract::rejection::PathRejection;
use axum::extract::{Path, State};
use axum::http::HeaderValue;
use axum::http::header::{CACHE_CONTROL, HeaderName};
use axum::response::{IntoResponse, Response};

use crate::AppState;
use crate::api::dto::InviteView;
use crate::auth::AuthUser;
use crate::error::ApiError;

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

/// The headers of a 200: one user's own view, which no shared cache stores (the `api/wallet.rs` pair).
fn private_headers() -> [(HeaderName, HeaderValue); 1] {
    [(CACHE_CONTROL, HeaderValue::from_static("private, no-store"))]
}

/// The invite code of the path: 400 unless it is text in the invite-code shape.
fn code_param(raw: Result<Path<String>, PathRejection>) -> Result<String, ApiError> {
    let Ok(Path(code)) = raw else {
        return Err(ApiError::BadRequest("invite code is not text"));
    };
    if !is_invite_code(&code) {
        return Err(ApiError::BadRequest("invite code outside the grammar"));
    }
    Ok(code)
}

/// `GET /api/invites/{code}` (F19 step 3): the caller's state toward the code's owner. 404 for an unknown or revoked
/// code. A read.
pub async fn get_invite(
    State(st): State<AppState>,
    AuthUser(user): AuthUser,
    code: Result<Path<String>, PathRejection>,
) -> Result<Response, ApiError> {
    let code = code_param(code)?;
    let state = st
        .repo
        .invite_state(user, &code, MAX_PENDING_REQUESTS)
        .await?
        .ok_or(ApiError::NotFound)?;
    Ok((private_headers(), Json(InviteView { state })).into_response())
}

/// `POST /api/invites/{code}/request` (F19 step 4): the caller asks the code's owner; the state after the act. A
/// repeat, a block of the caller and the owner's cap all answer `requested` and write nothing.
pub async fn post_invite_request(
    State(st): State<AppState>,
    AuthUser(user): AuthUser,
    code: Result<Path<String>, PathRejection>,
) -> Result<Response, ApiError> {
    let code = code_param(code)?;
    let state = st
        .repo
        .ask(user, &code, MAX_PENDING_REQUESTS, st.clock.now())
        .await?
        .ok_or(ApiError::NotFound)?;
    Ok((private_headers(), Json(InviteView { state })).into_response())
}
