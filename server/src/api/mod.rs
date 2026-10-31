//! The `/api` routes.

pub mod auth;
pub mod content;
pub mod dto;
pub mod entitlements;
pub mod orders;
pub mod puzzles;
pub mod saves;

use axum::Router;
use axum::extract::DefaultBodyLimit;
use axum::extract::rejection::JsonRejection;
use axum::http::header::CACHE_CONTROL;
use axum::http::{HeaderValue, StatusCode};
use axum::routing::{get, post};
use tower_http::set_header::SetResponseHeaderLayer;

use crate::AppState;
use crate::error::ApiError;

/// The body limit of every `/api` route that sets none of its own (PP "HTTP API": saves raise theirs to 300 KB).
pub const DEFAULT_BODY_LIMIT: usize = 16 * 1024;

/// The body limit of `/api/saves/{storyId}/{slot}`: a save body of up to [`saves::MAX_SAVE_BODY_BYTES`] plus its JSON
/// envelope and string escapes.
pub const SAVE_REQUEST_LIMIT: usize = 300 * 1024;

/// The `/api` router: bodies up to [`DEFAULT_BODY_LIMIT`] (axum's own default is 2 MB), and `Cache-Control:
/// no-store` on every response unless a route set its own (paid content's `private, no-store`).
pub fn router() -> Router<AppState> {
    // `Router::layer` wraps only the routes that exist when it is called, so routes are added in `routes()` and the
    // layers are applied here, after all of them.
    routes()
        .layer(DefaultBodyLimit::max(DEFAULT_BODY_LIMIT))
        .layer(SetResponseHeaderLayer::if_not_present(
            CACHE_CONTROL,
            HeaderValue::from_static("no-store"),
        ))
}

/// Every `/api` route. Add new routes here, never after the layer in `router()`.
fn routes() -> Router<AppState> {
    Router::new()
        .route("/health", get(health))
        .route("/auth", post(auth::post_auth))
        .route("/entitlements", get(entitlements::get_entitlements))
        .route("/chapters/{chapter_id}", get(content::get_chapter))
        .route("/assets/{file}", get(content::get_asset))
        .route("/saves", get(saves::list_saves))
        // A route's own limit runs inside the router-wide default and overrides it.
        .route(
            "/saves/{story_id}/{slot}",
            get(saves::get_save)
                .put(saves::put_save)
                .layer(DefaultBodyLimit::max(SAVE_REQUEST_LIMIT)),
        )
        .route("/puzzles/{puzzle_id}", get(puzzles::get_status))
        .route("/puzzles/{puzzle_id}/attempts", post(puzzles::post_attempt))
        .route("/invoices", post(orders::post_invoice))
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
