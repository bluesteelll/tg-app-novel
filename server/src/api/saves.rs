//! `/api/saves`: the player's save slots. The server is the source of truth (principle 1): a write replaces a slot
//! only through its `rev`, and every row is keyed by the token's user, never by anything the client sends.

use axum::Json;
use axum::extract::rejection::{JsonRejection, PathRejection};
use axum::extract::{Path, State};

use crate::AppState;
use crate::api::body_rejection;
use crate::api::dto::{PutSaveRequest, PutSaveResponse, SaveFull, SaveListResponse, SaveSummary};
use crate::auth::AuthUser;
use crate::db::saves::{NewSave, PutOutcome, SaveMeta};
use crate::error::ApiError;
use crate::ids::SaveSlot;

/// `GET /api/saves`: the user's saves without their bodies, in slot order.
pub async fn list_saves(
    State(st): State<AppState>,
    AuthUser(user): AuthUser,
) -> Result<Json<SaveListResponse>, ApiError> {
    let slots = st.repo.list_saves(user).await?;
    Ok(Json(SaveListResponse {
        slots: slots.into_iter().map(summary).collect(),
    }))
}

/// `GET /api/saves/{slot}`: the save with its body; 404 for an empty slot, including another user's.
pub async fn get_save(
    State(st): State<AppState>,
    AuthUser(user): AuthUser,
    slot: Result<Path<String>, PathRejection>,
) -> Result<Json<SaveFull>, ApiError> {
    let slot = parse_slot(slot)?;
    let (meta, body) = st
        .repo
        .get_save(user, slot)
        .await?
        .ok_or(ApiError::NotFound)?;
    Ok(Json(SaveFull {
        summary: summary(meta),
        body,
    }))
}

/// `PUT /api/saves/{slot}`: writes the save if `expectedRev` matches the slot, else 409 with the stored envelope.
/// The checks run in a fixed order (token, slot, body), so a request with several faults gets one known answer.
pub async fn put_save(
    State(st): State<AppState>,
    AuthUser(user): AuthUser,
    slot: Result<Path<String>, PathRejection>,
    req: Result<Json<PutSaveRequest>, JsonRejection>,
) -> Result<Json<PutSaveResponse>, ApiError> {
    let slot = parse_slot(slot)?;
    let Json(req) = req.map_err(body_rejection)?;
    let write = NewSave {
        expected_rev: req.expected_rev,
        write_id: &req.write_id,
        chapter_id: &req.chapter_id,
        story_version: &req.story_version,
        line_id: req.line_id.as_deref(),
        body: &req.body,
        now: st.clock.now(),
    };
    match st.repo.put_save(user, slot, write).await? {
        PutOutcome::Written { rev, saved_at } | PutOutcome::Replayed { rev, saved_at } => {
            Ok(Json(PutSaveResponse { rev, saved_at }))
        }
        PutOutcome::Conflict(stored) => Err(ApiError::SaveConflict(stored.map(summary))),
    }
}

/// The slot of a `/api/saves/{slot}` path: 400 for anything but `auto`, `s1`, `s2`, `s3`.
fn parse_slot(path: Result<Path<String>, PathRejection>) -> Result<SaveSlot, ApiError> {
    let Ok(Path(raw)) = path else {
        return Err(ApiError::BadRequest("save slot path unreadable"));
    };
    SaveSlot::parse(&raw).ok_or(ApiError::BadRequest("unknown save slot"))
}

/// The wire envelope of a stored save.
fn summary(meta: SaveMeta) -> SaveSummary {
    SaveSummary {
        slot: meta.slot,
        rev: meta.rev,
        chapter_id: meta.chapter_id,
        story_version: meta.story_version,
        line_id: meta.line_id,
        saved_at: meta.saved_at,
        write_id: meta.write_id,
    }
}
