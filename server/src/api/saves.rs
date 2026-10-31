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

/// The largest save body, in UTF-8 bytes: the `saves.body` CHECK counts the same UTF-8 bytes (`octet_length`), so the
/// edge never admits what the CHECK refuses. The client measures the same bytes (`TextEncoder`).
pub const MAX_SAVE_BODY_BYTES: usize = 262_144;

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
/// The checks run in a fixed order (token, slot, request, text fields, body size, body JSON), so a request with
/// several faults gets one known answer.
pub async fn put_save(
    State(st): State<AppState>,
    AuthUser(user): AuthUser,
    slot: Result<Path<String>, PathRejection>,
    req: Result<Json<PutSaveRequest>, JsonRejection>,
) -> Result<Json<PutSaveResponse>, ApiError> {
    let slot = parse_slot(slot)?;
    let Json(req) = req.map_err(body_rejection)?;
    // PostgreSQL `text` cannot hold U+0000 (`22021`): a client string carrying it is a 400 here, not a 500 there.
    let texts = [
        Some(req.write_id.as_str()),
        Some(req.chapter_id.as_str()),
        Some(req.story_version.as_str()),
        req.line_id.as_deref(),
    ];
    if texts.into_iter().flatten().any(|text| text.contains('\0')) {
        return Err(ApiError::BadRequest("save text field contains U+0000"));
    }
    if req.body.len() > MAX_SAVE_BODY_BYTES {
        return Err(ApiError::PayloadTooLarge);
    }
    // `IS JSON` at the edge: a client bug is a 400 here instead of the CHECK's 500. A full parse, not `IgnoredAny`
    // (which has no depth limit): serde_json's recursion limit, lone surrogates and out-of-range numbers make the
    // edge stricter than `IS JSON`, so it never admits what the CHECK refuses. Only a check: the stored body stays the
    // request's bytes, and the CHECK remains the backstop.
    if serde_json::from_str::<serde_json::Value>(&req.body).is_err() {
        return Err(ApiError::BadRequest("save body is not one JSON document"));
    }
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
