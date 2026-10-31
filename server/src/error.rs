//! Handler errors and their wire form: an HTTP status plus `{"error": "<code>"}`.
//!
//! A 5xx is logged here with its cause; the body only ever carries the code, never SQL, paths or tokens.

use axum::Json;
use axum::http::header::RETRY_AFTER;
use axum::http::{HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use serde::Serialize;
use ts_rs::TS;

use crate::api::dto::SaveSummary;

/// Every error a handler returns. The `match` in `into_response` has no wildcard, so a new variant does not compile
/// until it is mapped.
#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    /// A malformed request; the text is for logs and tests, not the body.
    #[error("bad request: {0}")]
    BadRequest(&'static str),
    /// initData failed parsing or its HMAC check.
    #[error("initData invalid")]
    InitDataInvalid,
    /// initData's `auth_date` is outside the accepted window.
    #[error("initData expired")]
    InitDataExpired,
    /// No `Authorization: Bearer` token.
    #[error("token missing")]
    TokenMissing,
    /// A malformed token or a bad MAC.
    #[error("token invalid")]
    TokenInvalid,
    /// A token past its `exp`.
    #[error("token expired")]
    TokenExpired,
    /// Paid content without an entitlement.
    #[error("not entitled")]
    NotEntitled,
    /// No such resource for this user.
    #[error("not found")]
    NotFound,
    /// A product id the catalog does not know.
    #[error("unknown product")]
    UnknownProduct,
    /// The user already owns the product.
    #[error("already owned")]
    AlreadyOwned,
    /// A save write whose `expectedRev` does not match the slot: the stored row's envelope, or `None` when the slot
    /// has no row (the body then carries no `current`).
    #[error("save conflict")]
    SaveConflict(Option<Box<SaveSummary>>),
    /// The request body exceeds the route's limit.
    #[error("payload too large")]
    PayloadTooLarge,
    /// The Bot API call failed; the gateway error is logged where it is mapped.
    #[error("telegram unavailable")]
    TelegramUnavailable,
    /// Too many puzzle attempts in the current window; the answer was not applied.
    #[error("rate limited")]
    RateLimited {
        /// Seconds until the window ends, sent as `Retry-After`.
        retry_after_secs: i64,
    },
    /// A hint tier that cannot be unlocked now (tier order, a solved puzzle, a paid chapter not owned).
    #[error("hint unavailable")]
    HintUnavailable,
    /// The balance does not cover a spend.
    #[error("insufficient balance")]
    InsufficientBalance,
    /// A count limit is reached (the friend cap).
    #[error("limit reached")]
    LimitReached,
    /// A database failure: logged, answered with a generic 500.
    #[error(transparent)]
    Db(#[from] sqlx::Error),
}

/// The stable wire codes of every error, consumed by the client's decoders.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    /// `bad_request`
    BadRequest,
    /// `initdata_invalid`
    InitdataInvalid,
    /// `initdata_expired`
    InitdataExpired,
    /// `token_missing`
    TokenMissing,
    /// `token_invalid`
    TokenInvalid,
    /// `token_expired`
    TokenExpired,
    /// `not_entitled`
    NotEntitled,
    /// `not_found`
    NotFound,
    /// `unknown_product`
    UnknownProduct,
    /// `already_owned`
    AlreadyOwned,
    /// `save_conflict`
    SaveConflict,
    /// `payload_too_large`
    PayloadTooLarge,
    /// `telegram_unavailable`
    TelegramUnavailable,
    /// `rate_limited`
    RateLimited,
    /// `hint_unavailable`
    HintUnavailable,
    /// `insufficient_balance`
    InsufficientBalance,
    /// `limit_reached`
    LimitReached,
    /// `internal`
    Internal,
}

/// The JSON body of every error response.
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ApiErrorBody {
    /// The error code.
    pub error: ErrorCode,
    /// `save_conflict` only: the stored row the write conflicted with. Omitted, not `null`, when absent, so every
    /// other error stays `{"error": "<code>"}`.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub current: Option<SaveSummary>,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let mut current = None;
        let mut retry_after: Option<i64> = None;
        let (status, error) = match self {
            ApiError::BadRequest(_) => (StatusCode::BAD_REQUEST, ErrorCode::BadRequest),
            ApiError::InitDataInvalid => (StatusCode::UNAUTHORIZED, ErrorCode::InitdataInvalid),
            ApiError::InitDataExpired => (StatusCode::UNAUTHORIZED, ErrorCode::InitdataExpired),
            ApiError::TokenMissing => (StatusCode::UNAUTHORIZED, ErrorCode::TokenMissing),
            ApiError::TokenInvalid => (StatusCode::UNAUTHORIZED, ErrorCode::TokenInvalid),
            ApiError::TokenExpired => (StatusCode::UNAUTHORIZED, ErrorCode::TokenExpired),
            ApiError::NotEntitled => (StatusCode::FORBIDDEN, ErrorCode::NotEntitled),
            ApiError::NotFound => (StatusCode::NOT_FOUND, ErrorCode::NotFound),
            ApiError::UnknownProduct => (StatusCode::NOT_FOUND, ErrorCode::UnknownProduct),
            ApiError::AlreadyOwned => (StatusCode::CONFLICT, ErrorCode::AlreadyOwned),
            ApiError::SaveConflict(stored) => {
                // The client resolves the conflict from the stored envelope (F3), so it travels in the body.
                current = stored.map(|summary| *summary);
                (StatusCode::CONFLICT, ErrorCode::SaveConflict)
            }
            ApiError::PayloadTooLarge => {
                (StatusCode::PAYLOAD_TOO_LARGE, ErrorCode::PayloadTooLarge)
            }
            ApiError::TelegramUnavailable => {
                (StatusCode::BAD_GATEWAY, ErrorCode::TelegramUnavailable)
            }
            ApiError::RateLimited { retry_after_secs } => {
                // The one header an error sets: when the window ends, in decimal seconds (RFC 9110 Retry-After).
                retry_after = Some(retry_after_secs);
                (StatusCode::TOO_MANY_REQUESTS, ErrorCode::RateLimited)
            }
            ApiError::HintUnavailable => (StatusCode::CONFLICT, ErrorCode::HintUnavailable),
            ApiError::InsufficientBalance => (StatusCode::CONFLICT, ErrorCode::InsufficientBalance),
            ApiError::LimitReached => (StatusCode::CONFLICT, ErrorCode::LimitReached),
            ApiError::Db(e) => {
                // The cause goes to the log only: SQL errors can name tables, paths and values.
                tracing::error!(error = %e, "database error");
                (StatusCode::INTERNAL_SERVER_ERROR, ErrorCode::Internal)
            }
        };
        let mut response = (status, Json(ApiErrorBody { error, current })).into_response();
        if let Some(secs) = retry_after {
            response
                .headers_mut()
                .insert(RETRY_AFTER, HeaderValue::from(secs));
        }
        response
    }
}

#[cfg(test)]
mod tests {
    use http_body_util::BodyExt;

    use super::*;

    #[tokio::test]
    async fn api_error_maps_status_and_code() {
        // (variant, error, status, code, Retry-After): only `RateLimited` sets the header.
        let cases: Vec<(&str, ApiError, StatusCode, &str, Option<&str>)> = vec![
            (
                "BadRequest",
                ApiError::BadRequest("why"),
                StatusCode::BAD_REQUEST,
                "bad_request",
                None,
            ),
            (
                "InitDataInvalid",
                ApiError::InitDataInvalid,
                StatusCode::UNAUTHORIZED,
                "initdata_invalid",
                None,
            ),
            (
                "InitDataExpired",
                ApiError::InitDataExpired,
                StatusCode::UNAUTHORIZED,
                "initdata_expired",
                None,
            ),
            (
                "TokenMissing",
                ApiError::TokenMissing,
                StatusCode::UNAUTHORIZED,
                "token_missing",
                None,
            ),
            (
                "TokenInvalid",
                ApiError::TokenInvalid,
                StatusCode::UNAUTHORIZED,
                "token_invalid",
                None,
            ),
            (
                "TokenExpired",
                ApiError::TokenExpired,
                StatusCode::UNAUTHORIZED,
                "token_expired",
                None,
            ),
            (
                "NotEntitled",
                ApiError::NotEntitled,
                StatusCode::FORBIDDEN,
                "not_entitled",
                None,
            ),
            (
                "NotFound",
                ApiError::NotFound,
                StatusCode::NOT_FOUND,
                "not_found",
                None,
            ),
            (
                "UnknownProduct",
                ApiError::UnknownProduct,
                StatusCode::NOT_FOUND,
                "unknown_product",
                None,
            ),
            (
                "AlreadyOwned",
                ApiError::AlreadyOwned,
                StatusCode::CONFLICT,
                "already_owned",
                None,
            ),
            (
                "PayloadTooLarge",
                ApiError::PayloadTooLarge,
                StatusCode::PAYLOAD_TOO_LARGE,
                "payload_too_large",
                None,
            ),
            (
                "TelegramUnavailable",
                ApiError::TelegramUnavailable,
                StatusCode::BAD_GATEWAY,
                "telegram_unavailable",
                None,
            ),
            (
                "RateLimited",
                ApiError::RateLimited {
                    retry_after_secs: 42,
                },
                StatusCode::TOO_MANY_REQUESTS,
                "rate_limited",
                Some("42"),
            ),
            (
                "HintUnavailable",
                ApiError::HintUnavailable,
                StatusCode::CONFLICT,
                "hint_unavailable",
                None,
            ),
            (
                "InsufficientBalance",
                ApiError::InsufficientBalance,
                StatusCode::CONFLICT,
                "insufficient_balance",
                None,
            ),
            (
                "LimitReached",
                ApiError::LimitReached,
                StatusCode::CONFLICT,
                "limit_reached",
                None,
            ),
            (
                "Db",
                ApiError::Db(sqlx::Error::Protocol("secret detail".to_owned())),
                StatusCode::INTERNAL_SERVER_ERROR,
                "internal",
                None,
            ),
        ];
        let mut failures = Vec::new();
        for (name, err, status, code, retry_after) in cases {
            let response = err.into_response();
            let got_status = response.status();
            let got_retry = response
                .headers()
                .get(RETRY_AFTER)
                .map(|v| v.to_str().unwrap_or("<not text>").to_owned());
            let body = match response.into_body().collect().await {
                Ok(collected) => String::from_utf8_lossy(&collected.to_bytes()).into_owned(),
                Err(e) => {
                    failures.push(format!("{name}: body unreadable: {e}"));
                    continue;
                }
            };
            let want = format!(r#"{{"error":"{code}"}}"#);
            if got_status != status || body != want {
                failures.push(format!(
                    "{name}: expected ({status}, {want}), got ({got_status}, {body})"
                ));
            }
            if got_retry.as_deref() != retry_after {
                failures.push(format!(
                    "{name}: Retry-After expected {retry_after:?}, got {got_retry:?}"
                ));
            }
            if body.contains("secret detail") {
                failures.push(format!("{name}: the body carries the cause"));
            }
        }
        assert!(
            failures.is_empty(),
            "{} mismatches:\n{}",
            failures.len(),
            failures.join("\n")
        );
    }

    #[test]
    fn error_codes_serialize_snake_case() {
        // The match has no wildcard: a new code does not compile until its wire string is pinned here.
        fn wire(code: ErrorCode) -> &'static str {
            match code {
                ErrorCode::BadRequest => "bad_request",
                ErrorCode::InitdataInvalid => "initdata_invalid",
                ErrorCode::InitdataExpired => "initdata_expired",
                ErrorCode::TokenMissing => "token_missing",
                ErrorCode::TokenInvalid => "token_invalid",
                ErrorCode::TokenExpired => "token_expired",
                ErrorCode::NotEntitled => "not_entitled",
                ErrorCode::NotFound => "not_found",
                ErrorCode::UnknownProduct => "unknown_product",
                ErrorCode::AlreadyOwned => "already_owned",
                ErrorCode::SaveConflict => "save_conflict",
                ErrorCode::PayloadTooLarge => "payload_too_large",
                ErrorCode::TelegramUnavailable => "telegram_unavailable",
                ErrorCode::RateLimited => "rate_limited",
                ErrorCode::HintUnavailable => "hint_unavailable",
                ErrorCode::InsufficientBalance => "insufficient_balance",
                ErrorCode::LimitReached => "limit_reached",
                ErrorCode::Internal => "internal",
            }
        }
        let all = [
            ErrorCode::BadRequest,
            ErrorCode::InitdataInvalid,
            ErrorCode::InitdataExpired,
            ErrorCode::TokenMissing,
            ErrorCode::TokenInvalid,
            ErrorCode::TokenExpired,
            ErrorCode::NotEntitled,
            ErrorCode::NotFound,
            ErrorCode::UnknownProduct,
            ErrorCode::AlreadyOwned,
            ErrorCode::SaveConflict,
            ErrorCode::PayloadTooLarge,
            ErrorCode::TelegramUnavailable,
            ErrorCode::RateLimited,
            ErrorCode::HintUnavailable,
            ErrorCode::InsufficientBalance,
            ErrorCode::LimitReached,
            ErrorCode::Internal,
        ];
        let mut failures = Vec::new();
        for code in all {
            let got = serde_json::to_string(&code).unwrap();
            let want = format!("\"{}\"", wire(code));
            if got != want {
                failures.push(format!("{code:?}: expected {want}, got {got}"));
            }
        }
        let body = serde_json::to_string(&ApiErrorBody {
            error: ErrorCode::NotFound,
            current: None,
        })
        .unwrap();
        if body != r#"{"error":"not_found"}"# {
            failures.push(format!(
                "ApiErrorBody: expected {{\"error\":\"not_found\"}}, got {body}"
            ));
        }
        assert!(
            failures.is_empty(),
            "{} codes wrong:\n{}",
            failures.len(),
            failures.join("\n")
        );
    }
}
