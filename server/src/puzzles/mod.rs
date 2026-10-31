//! Puzzles (PUZZLES-PLAN X5-X7, META-PLAN M21): the server checks every answer against the content's solution,
//! behind a per-(user, puzzle) attempt window, and serves a hint's text only for a tier the user unlocked.
//!
//! Principle 0: a solution never leaves this module and the content store, and every route reaches a puzzle only
//! through [`entitled_puzzle`], so a paid chapter's puzzle answers 403 to a user without the chapter.

use crate::AppState;
use crate::api::dto::{HintView, PuzzleStatus};
use crate::content::{Localized, PuzzleDef};
use crate::error::ApiError;
use crate::ids::{PuzzleId, UserId};

/// The length of an attempt window, in seconds (X5).
pub const ATTEMPT_WINDOW_SECS: i64 = 600;

/// The attempts a window counts with their answers applied; later ones in the window are 429 (X5: a 4-digit code
/// then takes days to brute-force).
pub const ATTEMPT_WINDOW_MAX: i64 = 20;

/// The most answer entries a request may carry, whatever the puzzle.
pub const MAX_ANSWER_LEN: usize = 16;

/// The language of a hint text.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lang {
    /// Russian, the primary language.
    Ru,
    /// English.
    En,
}

impl Lang {
    /// The language `s` names: exactly `ru` or `en`.
    pub fn parse(s: &str) -> Option<Lang> {
        match s {
            "ru" => Some(Lang::Ru),
            "en" => Some(Lang::En),
            _ => None,
        }
    }
}

/// `localized` in `lang`.
fn text(localized: &Localized, lang: Lang) -> &str {
    match lang {
        Lang::Ru => &localized.ru,
        Lang::En => &localized.en,
    }
}

/// Why an answer does not fit its puzzle's shape. The shape (`answerLen`, `answerMax`) is public, so a misfit is a
/// 400 that counts no attempt.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum AnswerError {
    /// More than [`MAX_ANSWER_LEN`] entries, or not the puzzle's `answer_len`.
    #[error("answer length")]
    Length,
    /// An entry above the puzzle's `answer_max`.
    #[error("answer value")]
    Range,
}

/// Whether `answer` is `def`'s solution, once it fits the puzzle's shape.
pub fn check_answer(def: &PuzzleDef, answer: &[u16]) -> Result<bool, AnswerError> {
    if answer.len() > MAX_ANSWER_LEN || answer.len() != def.answer_len {
        return Err(AnswerError::Length);
    }
    if answer.iter().any(|&value| value > def.answer_max) {
        return Err(AnswerError::Range);
    }
    Ok(answer == def.solution.as_slice())
}

/// What an attempt answered.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AttemptOutcome {
    /// The attempt was in the window: whether this answer is the solution, and whether the puzzle is solved (by this
    /// answer or an earlier one).
    Answered {
        /// This answer is the solution.
        correct: bool,
        /// The puzzle is solved.
        solved: bool,
    },
    /// The window is full: the attempt was counted, its answer neither applied nor revealed.
    RateLimited {
        /// Seconds until the window ends.
        retry_after_secs: i64,
    },
}

/// The puzzle `id` names, when `user` may open it: 404 `not_found` for an id the content does not hold, 403
/// `not_entitled` for a paid chapter's puzzle without that chapter's entitlement. The one gate of every puzzle route.
pub async fn entitled_puzzle<'a>(
    st: &'a AppState,
    user: UserId,
    id: &PuzzleId,
) -> Result<&'a PuzzleDef, ApiError> {
    let def = st.content.puzzle(id).ok_or(ApiError::NotFound)?;
    // Invariant: nothing of a paid chapter's puzzle is read for the user before this entitlement row is seen.
    if let Some(chapter) = st.content.paid_chapter(&def.chapter)
        && !st.repo.is_entitled(user, &chapter.product).await?
    {
        return Err(ApiError::NotEntitled);
    }
    Ok(def)
}

/// One attempt of `user` on the gated `def`: the shape check (400, not counted), then the window, then the answer.
pub async fn attempt(
    st: &AppState,
    user: UserId,
    def: &PuzzleDef,
    answer: &[u16],
) -> Result<AttemptOutcome, ApiError> {
    let correct = check_answer(def, answer).map_err(|e| match e {
        AnswerError::Length => ApiError::BadRequest("answer length does not fit the puzzle"),
        AnswerError::Range => ApiError::BadRequest("answer value above the puzzle's maximum"),
    })?;
    let record = st
        .repo
        .record_attempt(user, &def.id, correct, st.clock.now())
        .await?;
    Ok(if record.limited {
        AttemptOutcome::RateLimited {
            retry_after_secs: record.retry_after_secs,
        }
    } else {
        AttemptOutcome::Answered {
            correct,
            solved: record.solved,
        }
    })
}

/// The status of the gated `def` for `user`: solved or not, and every tier of the puzzle's hint ladder, with the
/// text in `lang` only for a tier the user unlocked. An unlock row past the current ladder is ignored.
pub async fn status(
    st: &AppState,
    user: UserId,
    def: &PuzzleDef,
    lang: Lang,
) -> Result<PuzzleStatus, ApiError> {
    let solved = st.repo.is_solved(user, &def.id).await?;
    let unlocked = st.repo.unlocked_tiers(user, &def.id).await?;
    let hints = def
        .hints
        .iter()
        .zip(1u8..)
        .map(|(hint, tier)| {
            let open = unlocked.contains(&tier);
            HintView {
                tier,
                unlocked: open,
                text: open.then(|| text(hint, lang).to_owned()),
            }
        })
        .collect();
    Ok(PuzzleStatus {
        puzzle_id: def.id.0.clone(),
        solved,
        hints,
    })
}
