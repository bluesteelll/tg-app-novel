//! `/api/puzzles`: answer attempts, a puzzle's status with its hint ladder, and the hint use that unlocks a tier from
//! the balance (META-PLAN M21). Thin handlers: the id, the tier and `lang` are parsed here; the gate
//! ([`puzzles::entitled_puzzle`]) and the rules live in `puzzles`, the spend in `db/economy.rs`.
//!
//! A malformed id is 400 `bad_request` (PUZZLES-PLAN "HTTP API additions"): puzzle ids are not secret, public worlds
//! name them. A known paid chapter's puzzle is 403 without the chapter, whatever the request body carries.

use axum::Json;
use axum::extract::rejection::{JsonRejection, PathRejection};
use axum::extract::{Path, RawQuery, State};
use axum::http::HeaderValue;
use axum::http::header::{CACHE_CONTROL, HeaderName, X_CONTENT_TYPE_OPTIONS};
use axum::response::{IntoResponse, Response};

use crate::AppState;
use crate::api::body_rejection;
use crate::api::dto::{AttemptRequest, AttemptResponse, HintUseResponse};
use crate::auth::AuthUser;
use crate::content::Localized;
use crate::db::economy::SpendOutcome;
use crate::error::ApiError;
use crate::ids::PuzzleId;
use crate::puzzles::{self, AttemptOutcome, Lang};

/// The headers of a status 200: an unlocked hint's text is sold content, so no shared cache stores it and no browser
/// sniffs another type into it (the paid-content pair of `api/content.rs`).
fn sold_headers() -> [(HeaderName, HeaderValue); 2] {
    [
        (CACHE_CONTROL, HeaderValue::from_static("private, no-store")),
        (X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff")),
    ]
}

/// The puzzle id of the path: 400 when the segment is not text or not the `PuzzleId` grammar.
fn puzzle_id(raw: Result<Path<String>, PathRejection>) -> Result<PuzzleId, ApiError> {
    let Ok(Path(raw)) = raw else {
        return Err(ApiError::BadRequest("puzzle id is not text"));
    };
    PuzzleId::parse(&raw).ok_or(ApiError::BadRequest("puzzle id outside the grammar"))
}

/// The `lang` of a query string: exactly one `lang` pair, `ru` or `en`. Required: the client always knows its
/// locale, and a default would serve the wrong language without an error.
fn lang_param(params: Option<&str>) -> Option<Lang> {
    let mut langs = form_urlencoded::parse(params?.as_bytes()).filter(|(key, _)| key == "lang");
    let (_, value) = langs.next()?;
    // A repeated `lang` names no one language.
    if langs.next().is_some() {
        return None;
    }
    Lang::parse(&value)
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

/// `GET /api/puzzles/{puzzleId}?lang=ru|en`: whether the user solved the puzzle, and its hint ladder with the texts of
/// the unlocked tiers. The checks run in a fixed order (token, id grammar, `lang`, puzzle known, entitlement); the 200
/// is `private, no-store`.
pub async fn get_status(
    State(st): State<AppState>,
    AuthUser(user): AuthUser,
    id: Result<Path<String>, PathRejection>,
    RawQuery(params): RawQuery,
) -> Result<Response, ApiError> {
    let id = puzzle_id(id)?;
    let lang =
        lang_param(params.as_deref()).ok_or(ApiError::BadRequest("lang must be ru or en"))?;
    let def = puzzles::entitled_puzzle(&st, user, &id).await?;
    let status = puzzles::status(&st, user, def, lang).await?;
    Ok((sold_headers(), Json(status)).into_response())
}

/// The hint tier of a path segment: exactly `1`, `2` or `3`, one spelling per tier (no `01`, no `+1`).
fn hint_tier(raw: &str) -> Option<u8> {
    match raw {
        "1" => Some(1),
        "2" => Some(2),
        "3" => Some(3),
        _ => None,
    }
}

/// `localized` in `lang`: the rule of the status route's texts (`puzzles::text`, private there).
fn hint_text(localized: &Localized, lang: Lang) -> &str {
    match lang {
        Lang::Ru => &localized.ru,
        Lang::En => &localized.en,
    }
}

/// `POST /api/puzzles/{puzzleId}/hints/{tier}?lang=ru|en` (M21): unlocks a tier of the puzzle's hint ladder by spending
/// `spend.hintTier` hints from the balance, and answers the tier's text. The checks run in a fixed order (token, id
/// grammar, tier, `lang`, puzzle known, entitlement, then the tier within the puzzle's ladder, after the gate so a paid
/// ladder's length is not revealed); then the spend: 409 `hint_unavailable` for a solved puzzle or a tier out of
/// order, 409 `insufficient_balance` when the balance does not cover it. A tier unlocked before answers its text and
/// debits nothing. The 200 is `private, no-store` + `nosniff`.
pub async fn post_hint(
    State(st): State<AppState>,
    AuthUser(user): AuthUser,
    path: Result<Path<(String, String)>, PathRejection>,
    RawQuery(params): RawQuery,
) -> Result<Response, ApiError> {
    let Ok(Path((raw_id, raw_tier))) = path else {
        return Err(ApiError::BadRequest("puzzle id or tier is not text"));
    };
    let id =
        PuzzleId::parse(&raw_id).ok_or(ApiError::BadRequest("puzzle id outside the grammar"))?;
    let tier = hint_tier(&raw_tier).ok_or(ApiError::BadRequest("tier must be 1, 2 or 3"))?;
    let lang =
        lang_param(params.as_deref()).ok_or(ApiError::BadRequest("lang must be ru or en"))?;
    let def = puzzles::entitled_puzzle(&st, user, &id).await?;
    let hint = def
        .hints
        .get(usize::from(tier - 1))
        .ok_or(ApiError::NotFound)?;
    let cost = st.catalog.economy().hint_tier_cost;
    let spent = st
        .repo
        .spend_hint(user, &def.id, tier, cost, st.clock.now())
        .await?;
    let balance = match spent {
        SpendOutcome::Unlocked { balance } | SpendOutcome::AlreadyUnlocked { balance } => balance,
        SpendOutcome::Insufficient => return Err(ApiError::InsufficientBalance),
        SpendOutcome::Unavailable => return Err(ApiError::HintUnavailable),
    };
    let body = HintUseResponse {
        balance,
        text: hint_text(hint, lang).to_owned(),
    };
    Ok((sold_headers(), Json(body)).into_response())
}
