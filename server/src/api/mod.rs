//! The `/api` routes.

use axum::Router;
use axum::http::HeaderValue;
use axum::http::header::CACHE_CONTROL;
use axum::routing::get;
use tower_http::set_header::SetResponseHeaderLayer;

use crate::AppState;

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
    Router::new().route("/health", get(health))
}

/// `GET /api/health`: no auth, no database; `ok` as `text/plain`.
async fn health() -> &'static str {
    "ok"
}
