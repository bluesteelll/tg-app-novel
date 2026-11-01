//! The social routes (META-PLAN M10-M12, M15): the user's social view, the invite view and the request through an
//! invite code (F19), the accept and the decline or removal (F20), the code rotation, and the profile-visibility
//! consent (F21). Thin handlers: the limits and the wire shapes of invite codes and handles live here, the SQL in
//! `db/social.rs`. Every 200 is `private, no-store`: one user's own view. Another user is named by handle only, never
//! by Telegram id (W1).
//!
//! An invite link is `https://t.me/<bot>?startapp=f<code>`; the server reads the signed `start_param` only. Every
//! other `start_param` shape is reserved for later prefixes (campaign codes) and stays harmless: it creates nothing.
//!
//! A malformed code or handle is 400 `bad_request` (it never reaches SQL); a well-shaped one that names nothing for
//! this caller is 404 `not_found`. Neither reveals anything about another user.

use axum::Json;
use axum::extract::rejection::{JsonRejection, PathRejection};
use axum::extract::{Path, State};
use axum::http::HeaderValue;
use axum::http::header::{CACHE_CONTROL, HeaderName};
use axum::response::{IntoResponse, Response};

use crate::AppState;
use crate::api::body_rejection;
use crate::api::dto::{ConsentRequest, FriendDto, FriendRequestDto, InviteView, SocialResponse};
use crate::api::legal::policy_version;
use crate::auth::AuthUser;
use crate::db::social::{AcceptOutcome, RotateOutcome};
use crate::error::ApiError;
use crate::ids::UserId;

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

/// The handle of the path: 400 unless it is text in the handle shape.
fn handle_param(raw: Result<Path<String>, PathRejection>) -> Result<String, ApiError> {
    let Ok(Path(handle)) = raw else {
        return Err(ApiError::BadRequest("handle is not text"));
    };
    if !is_handle(&handle) {
        return Err(ApiError::BadRequest("handle outside the grammar"));
    }
    Ok(handle)
}

/// `user`'s social view as the 200 of every social action.
async fn social_reply(st: &AppState, user: UserId) -> Result<Response, ApiError> {
    let rows = st.repo.social(user, st.clock.now()).await?;
    let body = SocialResponse {
        invite_code: rows.invite_code,
        friends: rows
            .friends
            .into_iter()
            .map(|row| FriendDto {
                handle: row.handle,
                first_name: row.first_name,
            })
            .collect(),
        requests: rows
            .requests
            .into_iter()
            .map(|row| FriendRequestDto {
                handle: row.handle,
                first_name: row.first_name,
                at: row.at,
            })
            .collect(),
        profile_visible: rows.profile_visible,
    };
    Ok((private_headers(), Json(body)).into_response())
}

/// `GET /api/social`: the user's invite code (created on the first call), friends, incoming requests and profile
/// visibility.
pub async fn get_social(
    State(st): State<AppState>,
    AuthUser(user): AuthUser,
) -> Result<Response, ApiError> {
    social_reply(&st, user).await
}

/// `POST /api/friends/requests/{handle}/accept` (F20 step 1): the request from the handle's user becomes a
/// friendship. 404 without such a request (a repeat after success too), 409 `limit_reached` when either side is at
/// [`MAX_FRIENDS`] (the request stays).
pub async fn post_accept(
    State(st): State<AppState>,
    AuthUser(user): AuthUser,
    handle: Result<Path<String>, PathRejection>,
) -> Result<Response, ApiError> {
    let handle = handle_param(handle)?;
    let from = st
        .repo
        .user_by_handle(&handle)
        .await?
        .ok_or(ApiError::NotFound)?;
    match st
        .repo
        .accept(user, from, MAX_FRIENDS, st.clock.now())
        .await?
    {
        AcceptOutcome::Accepted => social_reply(&st, user).await,
        AcceptOutcome::NoRequest => Err(ApiError::NotFound),
        AcceptOutcome::LimitReached => Err(ApiError::LimitReached),
    }
}

/// `DELETE /api/friends/{handle}` (F20 step 2): declines the handle's user's request or ends the friendship, from
/// either side, and writes the durable block. 404 when there is neither (a repeat too).
pub async fn delete_friend(
    State(st): State<AppState>,
    AuthUser(user): AuthUser,
    handle: Result<Path<String>, PathRejection>,
) -> Result<Response, ApiError> {
    let handle = handle_param(handle)?;
    let other = st
        .repo
        .user_by_handle(&handle)
        .await?
        .ok_or(ApiError::NotFound)?;
    if !st.repo.remove(user, other, st.clock.now()).await? {
        return Err(ApiError::NotFound);
    }
    social_reply(&st, user).await
}

/// `POST /api/invite/rotate`: revokes the user's active code and issues a new one (the old link then answers 404).
/// 429 `rate_limited` with `Retry-After` past [`MAX_ROTATIONS_PER_DAY`] in a rolling day.
pub async fn post_rotate(
    State(st): State<AppState>,
    AuthUser(user): AuthUser,
) -> Result<Response, ApiError> {
    match st
        .repo
        .rotate(user, MAX_ROTATIONS_PER_DAY, st.clock.now())
        .await?
    {
        RotateOutcome::Rotated => social_reply(&st, user).await,
        RotateOutcome::Limited { retry_after_secs } => {
            Err(ApiError::RateLimited { retry_after_secs })
        }
    }
}

/// `PUT /api/consents/friends_profile` (F21): appends the user's decision with the server's own policy version and the
/// named consent text. 400 for a bad body or a text version outside [`CONSENT_TEXT_VERSIONS`]. Profile visibility is
/// the latest row's decision, so nothing is read from the client to grant it (principle 1).
pub async fn put_consent(
    State(st): State<AppState>,
    AuthUser(user): AuthUser,
    req: Result<Json<ConsentRequest>, JsonRejection>,
) -> Result<Response, ApiError> {
    let Json(req) = req.map_err(body_rejection)?;
    if !CONSENT_TEXT_VERSIONS.contains(&req.text_version.as_str()) {
        return Err(ApiError::BadRequest("unknown consent text version"));
    }
    st.repo
        .record_consent(
            user,
            req.granted,
            policy_version(),
            &req.text_version,
            st.clock.now(),
        )
        .await?;
    social_reply(&st, user).await
}
