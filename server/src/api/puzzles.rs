//! `/api/puzzles`: answer attempts. A thin handler: the id is parsed here; the gate ([`puzzles::entitled_puzzle`])
//! and the rules live in `puzzles`.
//!
//! A malformed id is 400 `bad_request` (PUZZLES-PLAN "HTTP API additions"): puzzle ids are not secret, public worlds
//! name them. A known paid chapter's puzzle is 403 without the chapter, whatever the request body carries.

use axum::Json;
use axum::extract::rejection::{JsonRejection, PathRejection};
use axum::extract::{Path, State};

use crate::AppState;
use crate::api::body_rejection;
use crate::api::dto::{AttemptRequest, AttemptResponse};
use crate::auth::AuthUser;
use crate::error::ApiError;
use crate::ids::PuzzleId;
use crate::puzzles::{self, AttemptOutcome};

/// The puzzle id of the path: 400 when the segment is not text or not the `PuzzleId` grammar.
fn puzzle_id(raw: Result<Path<String>, PathRejection>) -> Result<PuzzleId, ApiError> {
    let Ok(Path(raw)) = raw else {
        return Err(ApiError::BadRequest("puzzle id is not text"));
    };
    PuzzleId::parse(&raw).ok_or(ApiError::BadRequest("puzzle id outside the grammar"))
}

/// `POST /api/puzzles/{puzzleId}/attempts`: checks `answer` against the puzzle. The checks run in a fixed order
/// (token, id grammar, puzzle known, entitlement, body, answer shape, window), and no 4xx counts an attempt.
pub async fn post_attempt(
    State(st): State<AppState>,
    AuthUser(user): AuthUser,
    id: Result<Path<String>, PathRejection>,
    req: Result<Json<AttemptRequest>, JsonRejection>,
) -> Result<Json<AttemptResponse>, ApiError> {
    let id = puzzle_id(id)?;
    let def = puzzles::entitled_puzzle(&st, user, &id).await?;
    // The body is judged only past the gate: a paid puzzle is 403 whatever the request carries.
    let Json(req) = req.map_err(body_rejection)?;
    match puzzles::attempt(&st, user, def, &req.answer).await? {
        AttemptOutcome::Answered { correct, solved } => {
            Ok(Json(AttemptResponse { correct, solved }))
        }
        AttemptOutcome::RateLimited { retry_after_secs } => {
            Err(ApiError::RateLimited { retry_after_secs })
        }
    }
}
