//! `POST /api/auth`: verified initData in, the server's own session token out.

use axum::Json;
use axum::extract::State;
use axum::extract::rejection::JsonRejection;

use crate::AppState;
use crate::api::body_rejection;
use crate::api::dto::{AuthRequest, AuthResponse, UserDto};
use crate::api::social::invite_code_of_start_param;
use crate::auth::{InitData, InitDataError, issue_token, validate_init_data};
use crate::error::ApiError;

/// The largest accepted initData, in bytes (real initData is about 1-1.5 KB).
pub const MAX_INIT_DATA_BYTES: usize = 4096;

/// Validates the initData, records the user (and a newcomer's referral, when the signed `start_param` is an invite,
/// META-PLAN M11), and issues a session token. The user comes from the verified initData only; anything else in the
/// body is ignored.
pub async fn post_auth(
    State(st): State<AppState>,
    body: Result<Json<AuthRequest>, JsonRejection>,
) -> Result<Json<AuthResponse>, ApiError> {
    let Json(req) = body.map_err(body_rejection)?;
    if req.init_data.len() > MAX_INIT_DATA_BYTES {
        return Err(ApiError::BadRequest("initData over 4 KB"));
    }
    // One reading of the clock: freshness, `last_seen_at` and the token expiry agree.
    let now = st.clock.now();
    let InitData {
        user, start_param, ..
    } = validate_init_data(
        &req.init_data,
        &st.cfg.bot_token,
        now,
        st.cfg.initdata_max_age_secs,
    )
    .map_err(init_data_error)?;
    // Only the signed `start_param`, and only an invite's shape, reaches the database: any other value (absent,
    // malformed, another prefix) is a plain login, never a failed one.
    let code = start_param.as_deref().and_then(invite_code_of_start_param);
    st.repo.auth_with_code(&user, code, now).await?;
    let (token, expires_at) = issue_token(&st.keys.token, user.id, now, st.cfg.token_ttl_secs);
    Ok(Json(AuthResponse {
        token,
        expires_at,
        user: UserDto {
            id: user.id.0,
            first_name: user.first_name,
            language_code: user.language_code,
        },
    }))
}

/// `initdata_expired` when only reopening the Mini App can help (the window), `initdata_invalid` otherwise.
fn init_data_error(e: InitDataError) -> ApiError {
    match e {
        InitDataError::Expired | InitDataError::FromFuture => ApiError::InitDataExpired,
        InitDataError::Malformed
        | InitDataError::DuplicateKey
        | InitDataError::MissingHash
        | InitDataError::MissingUser
        | InitDataError::BadHash => ApiError::InitDataInvalid,
    }
}
