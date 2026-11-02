//! `POST /api/gifts` (META-PLAN M22, F25): units of a resource to a friend, by the friend's handle. A thin handler:
//! the wire shapes are checked here, and the friendship, the daily caps, the balance and the replay are one
//! transaction of `db/economy.rs` ([`Repo::transfer`](crate::db::Repo::transfer)). Principle 1: the sender is the
//! token's user, the recipient the handle's, the kinds and the bound the catalog's; nothing else comes from the
//! client.
//!
//! One's own handle, a non-friend and an unknown handle answer the same 404 `not_found`, so a gift tells nothing about
//! another user; the 200 carries the sender's own balance only (M13, W1).

use axum::Json;
use axum::extract::State;
use axum::extract::rejection::JsonRejection;
use axum::http::HeaderValue;
use axum::http::header::{CACHE_CONTROL, HeaderName};
use axum::response::{IntoResponse, Response};

use crate::AppState;
use crate::api::body_rejection;
use crate::api::dto::{GiftRequest, GiftResponse};
use crate::api::social::is_handle;
use crate::api::stats::is_event_id;
use crate::auth::AuthUser;
use crate::db::economy::{GiftMove, GiftOutcome};
use crate::error::ApiError;

/// The headers of a 200: one user's own balance, which no shared cache stores (the `api/wallet.rs` pair).
fn private_headers() -> [(HeaderName, HeaderValue); 1] {
    [(CACHE_CONTROL, HeaderValue::from_static("private, no-store"))]
}

/// `POST /api/gifts`: the checks run in a fixed order, token, body, `to` a handle, `kind` a gift kind of the catalog,
/// `amount` 1 to `maxPerGift`, `requestId` a lower-case UUID v4 (each a 400 `bad_request`); then the handle's user
/// (none: 404 `not_found`) and the transfer at the request's one clock read. A non-friend is 404 `not_found`, a request
/// id that moved another gift 400 `bad_request`, a balance that does not cover the amount 409 `insufficient_balance`,
/// a daily cap 429 `rate_limited` with `Retry-After`. No 4xx writes anything; a replay of the same gift is 200 and
/// moves nothing.
pub async fn post_gift(
    State(st): State<AppState>,
    AuthUser(user): AuthUser,
    req: Result<Json<GiftRequest>, JsonRejection>,
) -> Result<Response, ApiError> {
    let Json(req) = req.map_err(body_rejection)?;
    if !is_handle(&req.to) {
        return Err(ApiError::BadRequest("to is not a handle"));
    }
    let rules = &st.catalog.economy().gifts;
    let Some(kind) = rules.kinds.iter().find(|kind| kind.0 == req.kind) else {
        return Err(ApiError::BadRequest("kind is not a gift kind"));
    };
    if !(1..=rules.max_per_gift).contains(&req.amount) {
        return Err(ApiError::BadRequest("amount outside 1 to maxPerGift"));
    }
    if !is_event_id(&req.request_id) {
        return Err(ApiError::BadRequest(
            "requestId is not a lower-case UUID v4",
        ));
    }
    let to = st
        .repo
        .user_by_handle(&req.to)
        .await?
        .ok_or(ApiError::NotFound)?;
    let gift = GiftMove {
        from: user,
        to,
        kind,
        amount: req.amount,
        request_id: &req.request_id,
    };
    match st.repo.transfer(&gift, rules, st.clock.now()).await? {
        GiftOutcome::Sent { balance } | GiftOutcome::Replayed { balance } => {
            Ok((private_headers(), Json(GiftResponse { balance })).into_response())
        }
        GiftOutcome::NotFriends => Err(ApiError::NotFound),
        GiftOutcome::Mismatch => Err(ApiError::BadRequest("requestId moved another gift")),
        GiftOutcome::Insufficient => Err(ApiError::InsufficientBalance),
        GiftOutcome::Capped { retry_after_secs } => Err(ApiError::RateLimited { retry_after_secs }),
    }
}
