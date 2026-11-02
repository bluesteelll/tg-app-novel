//! `POST /api/stories/{storyId}/card` (META-PLAN M6-M9): the user's own completion card of one story.
//!
//! Achievements are evaluated here from facts the server holds (`stat_events`, the puzzle tables) against the meta
//! index, when the card is requested; the met ones are stored for display and grant nothing (principle 1). Principle 0
//! (M7): an ending title or an achievement gated on a paid chapter is listed, and an achievement stored, only when the
//! user owns every gated chapter now; nothing is listed as locked, and the card holds no total.
//!
//! At most five autocommit statements: the entitlements, the grouped stat read, the puzzle facts (only when the
//! story's conditions name a puzzle), the unlock insert (only when an achievement qualifies) and the stored unlocks.

use std::collections::HashSet;

use axum::Json;
use axum::extract::rejection::PathRejection;
use axum::extract::{Path, State};
use axum::http::HeaderValue;
use axum::http::header::{CACHE_CONTROL, HeaderName, X_CONTENT_TYPE_OPTIONS};
use axum::response::{IntoResponse, Response};

use crate::AppState;
use crate::api::dto::{CardAchievement, CardEnding, CardResponse, Localized};
use crate::auth::AuthUser;
use crate::content;
use crate::error::ApiError;
use crate::ids::{ProductId, StoryId};
use crate::meta::{self, met, visible};

/// The headers of a 200: the card carries paid-gated texts, so no shared cache stores it and no browser sniffs
/// another type into it (the paid-content pair of `api/content.rs`).
fn paid_headers() -> [(HeaderName, HeaderValue); 2] {
    [
        (CACHE_CONTROL, HeaderValue::from_static("private, no-store")),
        (X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff")),
    ]
}

/// A meta text in its wire form.
fn wire(text: &content::Localized) -> Localized {
    Localized {
        ru: text.ru.clone(),
        en: text.en.clone(),
    }
}

/// `POST /api/stories/{storyId}/card`: evaluates and stores the user's achievements of the story, then answers the
/// card. 400 for a path outside the `StoryId` grammar, 404 `not_found` for a story the index does not hold. POST
/// because it may store unlocks; a repeat changes nothing.
pub async fn post_card(
    State(st): State<AppState>,
    AuthUser(user): AuthUser,
    story_id: Result<Path<String>, PathRejection>,
) -> Result<Response, ApiError> {
    let Ok(Path(story_id)) = story_id else {
        return Err(ApiError::BadRequest("story id is not text"));
    };
    let id = StoryId::parse(&story_id).ok_or(ApiError::BadRequest("malformed story id"))?;
    let story = st.content.story(&id).ok_or(ApiError::NotFound)?;
    // The meta index holds every story of the index (a startup rule): this is the same 404, never reached.
    let story_meta = st.content.meta().story(&id).ok_or(ApiError::NotFound)?;
    let owned: HashSet<ProductId> = st.repo.entitlements(user).await?.into_iter().collect();
    let stats = st.repo.card_stats(user, &story.id).await?;
    let puzzles = if story_meta.puzzles.is_empty() {
        Vec::new()
    } else {
        st.repo.card_puzzles(user, &story_meta.puzzles).await?
    };
    let facts = meta::facts(story, &stats, &puzzles);
    // Met and visible now: an achievement is stored, and `new: true` sent, only beside the item it marks. In meta
    // order, so two concurrent cards of one user take the key locks in one order.
    let earned: Vec<&str> = story_meta
        .achievements
        .iter()
        .filter(|a| met(&a.when, &facts, story) && visible(&a.gate, &owned, story))
        .map(|a| a.id.as_str())
        .collect();
    let fresh: HashSet<String> = if earned.is_empty() {
        HashSet::new()
    } else {
        st.repo
            .record_unlocks(user, &story.id, &earned, st.clock.now())
            .await?
            .into_iter()
            .collect()
    };
    // Read after the insert: a key a concurrent card stored first shows with that card's time and `new: false`.
    let stored = st.repo.story_unlocks(user, &story.id).await?;
    let endings = facts
        .endings
        .iter()
        .filter_map(|(name, &first_reached_at)| {
            let ending = story_meta.endings.get(name)?;
            visible(&ending.gate, &owned, story).then(|| CardEnding {
                name: name.clone(),
                title: wire(&ending.title),
                first_reached_at,
            })
        })
        .collect();
    // A stored unlock stays whatever the facts say now (M6); one whose id the meta no longer holds is retired, and
    // one gated on a chapter not owned now is hidden (M7).
    let achievements = story_meta
        .achievements
        .iter()
        .filter(|a| visible(&a.gate, &owned, story))
        .filter_map(|a| {
            let row = stored.iter().find(|row| row.achievement == a.id)?;
            Some(CardAchievement {
                id: a.id.clone(),
                name: wire(&a.name),
                description: wire(&a.desc),
                unlocked_at: row.unlocked_at,
                new: fresh.contains(&a.id),
            })
        })
        .collect();
    let chapters_completed = story
        .chapters
        .iter()
        .filter(|ch| facts.chapters.contains(&ch.id))
        .map(|ch| ch.id.0.clone())
        .collect();
    let body = CardResponse {
        story_id: story.id.clone(),
        runs: facts.runs,
        chapters_completed,
        endings,
        achievements,
    };
    Ok((paid_headers(), Json(body)).into_response())
}
