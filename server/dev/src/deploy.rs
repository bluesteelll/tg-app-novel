//! The deploy simulation (LBI C3). server-dev serves no client files, so it has no `STATIC_DIR` whose build id it could
//! name; instead it claims one by hand. `POST /dev/build-id {"id": "<16 hex>" | null}` sets or clears it, and while it
//! is set every `/api/` answer carries it in `x-build-id`, as the production server's answers name the build its
//! `STATIC_DIR` holds. An e2e claims the build it runs, then another one: the open page sees a deploy. Nothing is claimed
//! at start, so a run that never asks (every other spec, another lane's server-dev) sees no header at all.

use std::sync::{Arc, Mutex, PoisonError};

use axum::extract::rejection::JsonRejection;
use axum::extract::{Request, State};
use axum::http::header::CACHE_CONTROL;
use axum::http::{HeaderName, HeaderValue, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::{Json, Router};
use serde::Deserialize;
use server::api::body_rejection;
use server::api::static_files::{BUILD_ID_HEADER, BuildId};
use server::error::ApiError;
use tracing::info;

/// The build id server-dev claims to serve: none until `POST /dev/build-id` sets one.
#[derive(Debug, Default)]
pub struct ServedBuild(Mutex<Option<HeaderValue>>);

impl ServedBuild {
    /// The claimed id's header value. A poisoned lock still holds a whole value (a store is one assignment).
    fn current(&self) -> Option<HeaderValue> {
        self.0
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }

    fn set(&self, id: Option<HeaderValue>) {
        *self.0.lock().unwrap_or_else(PoisonError::into_inner) = id;
    }
}

/// `POST /dev/build-id`'s body: the id to claim, or `null` for none.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct BuildIdRequest {
    id: Option<String>,
}

/// The `/dev/build-id` route over `served`.
pub fn routes(served: Arc<ServedBuild>) -> Router {
    Router::new()
        .route("/dev/build-id", post(set_build_id))
        .with_state(served)
}

/// `POST /dev/build-id {"id": "<16 hex>" | null}`: 204, the id claimed from now on (`null` claims none); an id that is
/// not 16 lowercase hex digits, or a body that is not that JSON, is 400 `bad_request`. `no-store` always.
async fn set_build_id(
    State(served): State<Arc<ServedBuild>>,
    req: Result<Json<BuildIdRequest>, JsonRejection>,
) -> Response {
    let mut response = match claimed(req) {
        Ok(id) => {
            info!(build_id = ?id.as_ref().map(BuildId::as_str), "dev build id claimed");
            served.set(id.as_ref().map(BuildId::header_value));
            StatusCode::NO_CONTENT.into_response()
        }
        Err(e) => e.into_response(),
    };
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

/// The id a request claims, or why it is refused.
fn claimed(req: Result<Json<BuildIdRequest>, JsonRejection>) -> Result<Option<BuildId>, ApiError> {
    let Json(req) = req.map_err(body_rejection)?;
    req.id
        .map(|text| {
            BuildId::parse(&text).ok_or(ApiError::BadRequest("id is not 16 lowercase hex digits"))
        })
        .transpose()
}

/// Middleware over the production router: while an id is claimed, the answer to a request whose path starts with
/// `/api/` carries it in `x-build-id` (whatever its status); nothing else does.
pub async fn stamp(State(served): State<Arc<ServedBuild>>, req: Request, next: Next) -> Response {
    let api = req.uri().path().starts_with("/api/");
    let mut response = next.run(req).await;
    if api && let Some(id) = served.current() {
        response
            .headers_mut()
            .insert(HeaderName::from_static(BUILD_ID_HEADER), id);
    }
    response
}
