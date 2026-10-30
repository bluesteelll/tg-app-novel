//! The `AuthUser` extractor: a handler that takes it cannot run without a valid session token.

use axum::extract::FromRequestParts;
use axum::http::HeaderMap;
use axum::http::header::AUTHORIZATION;
use axum::http::request::Parts;

use crate::AppState;
use crate::auth::token::{TokenError, verify_token};
use crate::error::ApiError;
use crate::ids::UserId;

/// The user of a request, proven by `Authorization: Bearer <token>`. Any failure is a 401 before the handler runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AuthUser(pub UserId);

impl FromRequestParts<AppState> for AuthUser {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, st: &AppState) -> Result<Self, Self::Rejection> {
        let token = bearer(&parts.headers).ok_or(ApiError::TokenMissing)?;
        match verify_token(&st.keys.token, token, st.clock.now()) {
            Ok(user) => Ok(AuthUser(user)),
            Err(TokenError::Expired) => Err(ApiError::TokenExpired),
            Err(TokenError::Malformed | TokenError::BadMac) => Err(ApiError::TokenInvalid),
        }
    }
}

/// The credentials of an `Authorization` header whose scheme is `Bearer` (case-insensitive, RFC 7235); `None` when
/// the header is absent, not text, or carries another scheme.
fn bearer(headers: &HeaderMap) -> Option<&str> {
    let value = headers.get(AUTHORIZATION)?.to_str().ok()?;
    let (scheme, credentials) = value.split_once(' ')?;
    scheme
        .eq_ignore_ascii_case("Bearer")
        .then(|| credentials.trim_start_matches(' '))
}
