//! The `/api` routes.

pub mod auth;
pub mod dto;

use axum::Router;
use axum::extract::rejection::JsonRejection;
use axum::http::header::CACHE_CONTROL;
use axum::http::{HeaderValue, StatusCode};
use axum::routing::{get, post};
use tower_http::set_header::SetResponseHeaderLayer;

use crate::AppState;
use crate::error::ApiError;

/// The `/api` router: `Cache-Control: no-store` on every response unless a route set its own (paid content's
/// `private, no-store`).
pub fn router() -> Router<AppState> {
    // `Router::layer` wraps only the routes that exist when it is called, so routes are added in `routes()` and the
    // layer is applied here, after all of them.
    routes().layer(SetResponseHeaderLayer::if_not_present(
        CACHE_CONTROL,
        HeaderValue::from_static("no-store"),
    ))
}

/// Every `/api` route. Add new routes here, never after the layer in `router()`.
fn routes() -> Router<AppState> {
    Router::new()
        .route("/health", get(health))
        .route("/auth", post(auth::post_auth))
}

/// `GET /api/health`: no auth, no database; `ok` as `text/plain`.
async fn health() -> &'static str {
    "ok"
}

/// A JSON body the extractor refused: over the body limit is 413 `payload_too_large`; anything else (not JSON, a
/// missing field, a wrong content type) is 400 `bad_request`, not axum's own 415 / 422 text.
pub(crate) fn body_rejection(e: JsonRejection) -> ApiError {
    if e.status() == StatusCode::PAYLOAD_TOO_LARGE {
        ApiError::PayloadTooLarge
    } else {
        ApiError::BadRequest("request body is not the expected JSON")
    }
}
