//! Puzzles (PUZZLES-PLAN X5-X7, META-PLAN M21): the server checks every answer against the content's solution,
//! behind a per-(user, puzzle) attempt window, and serves a hint's text only for a tier the user unlocked.
//!
//! Principle 0: a solution never leaves this module and the content store, and every route reaches a puzzle only
//! through [`entitled_puzzle`], so a paid chapter's puzzle answers 403 to a user without the chapter.
//!
//! [`values`] holds the per-player values' domain, draw and renderer (per-player §3.2); [`player_values`] issues a
//! chapter's values to their player (§3.4).

pub mod values;

use std::collections::BTreeMap;

use crate::AppState;
use crate::api::dto::{HintView, PlayerValue, PuzzleStatus, ValuesResponse};
use crate::content::{Answer, Localized, PuzzleDef};
use crate::db::puzzles::ValueIssue;
use crate::error::ApiError;
use crate::ids::{ChapterId, PuzzleId, UserId};
use crate::puzzles::values::{Domain, ValueRow};

/// The length of an attempt window, in seconds (X5).
pub const ATTEMPT_WINDOW_SECS: i64 = 600;

/// The attempts a window counts with their answers applied; later ones in the window are 429 (X5: a 4-digit code
/// then takes days to brute-force).
pub const ATTEMPT_WINDOW_MAX: i64 = 20;

/// The most answer entries a request may carry, whatever the puzzle: 64 (per-player §3.3; engine R-E12), so a 5 x 5
/// grid (25 entries) fits and a request stays under ~400 B. It is also the bound of a stored per-player value
/// (`puzzle_values_value_shape` in `0008_puzzle_values.sql`) and of every puzzle's `answerLen` (the content's load
/// rule).
pub const MAX_ANSWER_LEN: usize = 64;

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

/// Whether `answer` is `def`'s static solution, once it fits the puzzle's shape; never for a per-player puzzle.
pub fn check_answer(def: &PuzzleDef, answer: &[u16]) -> Result<bool, AnswerError> {
    if answer.len() > MAX_ANSWER_LEN || answer.len() != def.answer_len {
        return Err(AnswerError::Length);
    }
    if answer.iter().any(|&value| value > def.answer_max) {
        return Err(AnswerError::Range);
    }
    Ok(matches!(&def.answer, Answer::Static(solution) if answer == solution.as_slice()))
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

/// One value of `domain` from the OS source, drawn before a transaction (per-player §3.5: one `getrandom` call of a
/// few bytes per entry, non-blocking).
fn drawn(domain: &Domain) -> Vec<u16> {
    values::draw(domain, &mut values::os_rng()).expect(
        "invariant: a parsed domain accepts >= 1/16 of tuples, so DRAW_MAX_ROUNDS rounds of the OS source end with a value",
    )
}

/// `row` as the routes answer it (per-player §3.4): the wrong answers left under the author's cap (`None` without
/// one), and whether the run is spent.
fn player_value(row: &ValueRow, cap: Option<u8>) -> PlayerValue {
    PlayerValue {
        value: row.value.clone(),
        run: row.run,
        // 0 <= cap - wrong <= cap <= 9: the conversion keeps every value.
        attempts_left: cap.map(|m| u8::try_from((i64::from(m) - row.wrong).max(0)).unwrap_or(0)),
        spent: row.spent_at.is_some(),
    }
}

/// `user`'s values of the per-player puzzles of chapter `ch`, by local id, each issued at the first call (per-player
/// §3.4). The checks run in a fixed order: the chapter is known (404), then a paid chapter's entitlement (403, the
/// rule of [`entitled_puzzle`] per chapter), so nothing of a paid chapter is read or written for a non-buyer.
pub async fn player_values(
    st: &AppState,
    user: UserId,
    ch: &ChapterId,
) -> Result<ValuesResponse, ApiError> {
    if st.content.story_of(ch).is_none() {
        return Err(ApiError::NotFound);
    }
    // Invariant: no value of a paid chapter is issued or read for the user before this entitlement row is seen.
    if let Some(chapter) = st.content.paid_chapter(ch)
        && !st.repo.is_entitled(user, &chapter.product).await?
    {
        return Err(ApiError::NotEntitled);
    }
    let defs: Vec<(&PuzzleDef, &Domain, Option<u8>)> = st
        .content
        .chapter_per_player(ch)
        .filter_map(|def| match &def.answer {
            Answer::PerPlayer {
                domain,
                max_attempts,
            } => Some((def, domain, *max_attempts)),
            Answer::Static(_) => None,
        })
        .collect();
    let mut values = BTreeMap::new();
    if defs.is_empty() {
        return Ok(ValuesResponse { values });
    }
    let set: Vec<ValueIssue<'_>> = defs
        .iter()
        .map(|&(def, domain, _)| ValueIssue {
            puzzle: &def.key,
            domain,
            drawn: drawn(domain),
        })
        .collect();
    let rows = st.repo.issue_values(user, &set, st.clock.now()).await?;
    for row in &rows {
        if let Some(&(def, _, cap)) = defs.iter().find(|(def, _, _)| def.key == row.puzzle) {
            values.insert(def.local().to_owned(), player_value(row, cap));
        }
    }
    Ok(ValuesResponse { values })
}

/// One attempt of `user` on the gated `def`: the shape check (400, not counted), then the window, then the answer.
pub async fn attempt(
    st: &AppState,
    user: UserId,
    def: &PuzzleDef,
    answer: &[u16],
) -> Result<AttemptOutcome, ApiError> {
    // A per-player answer is compared with the player's own value only, which no path reads yet.
    if matches!(def.answer, Answer::PerPlayer { .. }) {
        return Err(ApiError::NotFound);
    }
    let correct = check_answer(def, answer).map_err(|e| match e {
        AnswerError::Length => ApiError::BadRequest("answer length does not fit the puzzle"),
        AnswerError::Range => ApiError::BadRequest("answer value above the puzzle's maximum"),
    })?;
    let record = st
        .repo
        .record_attempt(user, &def.key, correct, st.clock.now())
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
    let solved = st.repo.is_solved(user, &def.key).await?;
    let unlocked = st.repo.unlocked_tiers(user, &def.key).await?;
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
        value_run: None,
    })
}
