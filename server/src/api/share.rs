//! `POST /api/share` (META-PLAN M14, F18): the sharer's invite link, and a text of the story title and the sharer's
//! own counts, prepared as an inline message when the client can send one.
//!
//! Principle 0: the text never holds an ending or achievement title (the templates have no placeholder for one), so a
//! share carries no paid content. The link is the sharer's invite link (M10): every share is also an invite, and its
//! recipients can only ask. The counts come through `api/social.rs`, the one route module besides the card that reads
//! the achievements repository.
//!
//! The texts are `server/locales/meta.json`, compiled in; the copy is a functional placeholder until the owner's
//! (Q51). The window of [`SHARES_PER_HOUR`] per user lives in memory in `AppState` (one process; a restart forgets it,
//! accepted).

use std::collections::{HashMap, VecDeque};
use std::sync::{LazyLock, Mutex, PoisonError};

use axum::Json;
use axum::extract::State;
use axum::extract::rejection::JsonRejection;
use axum::http::HeaderValue;
use axum::http::header::{CACHE_CONTROL, HeaderName};
use axum::response::{IntoResponse, Response};
use serde::Deserialize;

use crate::AppState;
use crate::api::body_rejection;
use crate::api::dto::{ShareRequest, ShareResponse};
use crate::api::social;
use crate::auth::AuthUser;
use crate::content::Localized;
use crate::error::ApiError;
use crate::ids::{StoryId, UserId};
use crate::puzzles::Lang;
use crate::telegram::gateway::PreparedShare;

/// Shares per user per rolling [`SHARE_WINDOW_SECS`] (M14, M15). PLACEHOLDER: the owner's value comes later
/// (RULINGS 77).
pub const SHARES_PER_HOUR: usize = 20;

/// The share window: one rolling hour.
pub const SHARE_WINDOW_SECS: i64 = 3_600;

/// `server/locales/meta.json`: the share texts, ru then en.
const SHARE_TEXTS_JSON: &str = include_str!("../../locales/meta.json");

/// The share texts, parsed once. The file is compiled in and `api::share::tests::share_texts_complete` parses it, so
/// a parse failure here is a bug.
static TEXTS: LazyLock<ShareTexts> = LazyLock::new(|| {
    serde_json::from_str(SHARE_TEXTS_JSON).expect(
        "invariant: server/locales/meta.json parses (pinned by api::share::tests::share_texts_complete)",
    )
});

/// `server/locales/meta.json`.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ShareTexts {
    /// Russian, the primary language.
    ru: LangTexts,
    /// English.
    en: LangTexts,
}

/// The share texts of one language.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct LangTexts {
    /// A story share: `{story}`, `{endings}` and `{achievements}`, nothing else.
    share_story: String,
    /// A plain invite: no placeholder.
    share_invite: String,
    /// The prepared message's button.
    share_button: String,
    /// The prepared message's title in the share sheet.
    share_title: String,
}

impl ShareTexts {
    /// The texts of `lang`.
    fn of(&self, lang: Lang) -> &LangTexts {
        match lang {
            Lang::Ru => &self.ru,
            Lang::En => &self.en,
        }
    }
}

/// `text` in `lang`.
fn localized(text: &Localized, lang: Lang) -> &str {
    match lang {
        Lang::Ru => &text.ru,
        Lang::En => &text.en,
    }
}

/// `template` with each `{name}` of `values` replaced, in one pass: an inserted value is never scanned again, so a
/// story title that holds `{endings}` stays literal. A `{` that opens no name of `values` is kept as is.
fn render(template: &str, values: &[(&str, &str)]) -> String {
    let mut out = String::with_capacity(template.len());
    let mut rest = template;
    while let Some(open) = rest.find('{') {
        out.push_str(&rest[..open]);
        let tail = &rest[open + 1..];
        let filled = values.iter().find_map(|(name, value)| {
            tail.strip_prefix(*name)
                .and_then(|after| after.strip_prefix('}'))
                .map(|after| (*value, after))
        });
        match filled {
            Some((value, after)) => {
                out.push_str(value);
                rest = after;
            }
            None => {
                out.push('{');
                rest = tail;
            }
        }
    }
    out.push_str(rest);
    out
}

/// A rolling window per user: at most `limit` takes in any `window_secs`. In memory and process-wide; the lock is
/// never held across an `.await`.
pub struct RateWindow {
    /// The takes allowed per window.
    limit: usize,
    /// The window's length.
    window_secs: i64,
    /// The takes per user, and the last sweep.
    state: Mutex<WindowState>,
}

/// What a [`RateWindow`] holds.
struct WindowState {
    /// Each user's takes still in the window, oldest first.
    by_user: HashMap<UserId, VecDeque<i64>>,
    /// When every user's takes were last pruned.
    swept_at: i64,
}

impl RateWindow {
    /// An empty window of `limit` takes per `window_secs`.
    pub fn new(limit: usize, window_secs: i64) -> RateWindow {
        RateWindow {
            limit,
            window_secs,
            state: Mutex::new(WindowState {
                by_user: HashMap::new(),
                swept_at: i64::MIN,
            }),
        }
    }

    /// Takes one slot of `user` at `now`, or `Err(retry_after_secs)`: when the user's oldest take leaves the window,
    /// at least 1. Drops the user's takes at or before `now - window`; prunes every user's at most once per window, so
    /// the map holds only users who took a slot in the last two windows.
    pub fn take(&self, user: UserId, now: i64) -> Result<(), i64> {
        let cutoff = now.saturating_sub(self.window_secs);
        let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        if now.saturating_sub(state.swept_at) >= self.window_secs {
            state.by_user.retain(|_, takes| {
                drop_old(takes, cutoff);
                !takes.is_empty()
            });
            state.swept_at = now;
        }
        let takes = state.by_user.entry(user).or_default();
        drop_old(takes, cutoff);
        if takes.len() >= self.limit {
            let oldest = takes.front().copied().unwrap_or(now);
            return Err(oldest
                .saturating_add(self.window_secs)
                .saturating_sub(now)
                .max(1));
        }
        takes.push_back(now);
        Ok(())
    }
}

/// Drops the takes at or before `cutoff` (they are in time order).
fn drop_old(takes: &mut VecDeque<i64>, cutoff: i64) {
    while takes.front().is_some_and(|&at| at <= cutoff) {
        takes.pop_front();
    }
}

/// The headers of a 200: one user's own share, which no shared cache stores.
fn private_headers() -> [(HeaderName, HeaderValue); 1] {
    [(CACHE_CONTROL, HeaderValue::from_static("private, no-store"))]
}

/// A prepared message's result id: 32 lower-case hex of 16 OS-random bytes.
fn new_result_id() -> String {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).expect(
        "invariant: the OS random source works (ProcessPrng on Windows 10+ is documented never to fail)",
    );
    hex::encode(bytes)
}

/// `POST /api/share` (F18): the link and the text, and with `native` a prepared message's id. 400 for a bad body, a
/// language other than `ru` / `en` or a story id outside the grammar, 404 for a story the index does not hold, 429
/// `rate_limited` past [`SHARES_PER_HOUR`], 502 `telegram_unavailable` when the bot username is unknown (the link
/// needs it, `native` or not). A refused request takes no slot; one that reaches Telegram takes one. A prepare that
/// fails answers a null id: the link still works (M14).
pub async fn post_share(
    State(st): State<AppState>,
    AuthUser(user): AuthUser,
    req: Result<Json<ShareRequest>, JsonRejection>,
) -> Result<Response, ApiError> {
    let Json(req) = req.map_err(body_rejection)?;
    let lang = Lang::parse(&req.lang).ok_or(ApiError::BadRequest("lang is not ru or en"))?;
    let story = match &req.story_id {
        None => None,
        Some(raw) => {
            let id = StoryId::parse(&raw.0).ok_or(ApiError::BadRequest("malformed story id"))?;
            let story = st.content.story(&id).ok_or(ApiError::NotFound)?;
            // The meta index holds every story of the index (a startup rule): this is the same 404, never reached.
            let meta = st.content.meta().story(&id).ok_or(ApiError::NotFound)?;
            Some((story, meta))
        }
    };
    let now = st.clock.now();
    st.share_limit
        .take(user, now)
        .map_err(|retry_after_secs| ApiError::RateLimited { retry_after_secs })?;
    let code = st.repo.social(user, now).await?.invite_code;
    let username = match st.gateway.bot_username().await {
        Ok(username) => username,
        Err(e) => {
            tracing::warn!(error = %e, "getMe failed: no invite link without the bot username");
            return Err(ApiError::TelegramUnavailable);
        }
    };
    let link = social::invite_link(&username, &code);
    let texts = TEXTS.of(lang);
    let text = match story {
        Some((story, meta)) => {
            let progress = social::progress(&st, user).await?;
            let counts = social::story_counts(&progress, story, meta);
            let endings = counts.endings.len().to_string();
            let achievements = counts.achievements.len().to_string();
            render(
                &texts.share_story,
                &[
                    ("story", localized(&story.title, lang)),
                    ("endings", &endings),
                    ("achievements", &achievements),
                ],
            )
        }
        None => texts.share_invite.clone(),
    };
    let prepared_message_id = if req.native {
        let share = PreparedShare {
            result_id: new_result_id(),
            title: texts.share_title.clone(),
            text: text.clone(),
            button: texts.share_button.clone(),
            url: link.clone(),
        };
        match st.gateway.save_prepared_inline_message(user, share).await {
            Ok(prepared) => Some(prepared.id),
            Err(e) => {
                tracing::warn!(error = %e, "savePreparedInlineMessage failed: the link stands");
                None
            }
        }
    } else {
        None
    };
    let body = ShareResponse {
        link,
        text,
        prepared_message_id,
    };
    Ok((private_headers(), Json(body)).into_response())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn report(failures: &[String]) {
        assert!(
            failures.is_empty(),
            "{} failures:\n{}",
            failures.len(),
            failures.join("\n")
        );
    }

    /// The `{name}` placeholders of `text` in order, or the reason it holds a brace outside one.
    fn placeholders(text: &str) -> Result<Vec<&str>, String> {
        let mut names = Vec::new();
        let mut rest = text;
        loop {
            let open = rest.find('{');
            let close = rest.find('}');
            match (open, close) {
                (None, None) => return Ok(names),
                (Some(open), Some(close)) if open < close => {
                    let name = &rest[open + 1..close];
                    if name.is_empty() || !name.bytes().all(|b| b.is_ascii_lowercase()) {
                        return Err(format!("a brace pair around {name:?}"));
                    }
                    names.push(name);
                    rest = &rest[close + 1..];
                }
                _ => return Err("an unpaired brace".to_owned()),
            }
        }
    }

    /// `server/locales/meta.json` parses into exactly the four texts of each language, none blank; a story share
    /// names `{story}`, `{endings}` and `{achievements}` once each and nothing else, and no other text has a
    /// placeholder or a stray brace (so no ending or achievement title can be put in).
    #[test]
    fn share_texts_complete() {
        let mut failures = Vec::new();
        let parsed: Result<ShareTexts, _> = serde_json::from_str(SHARE_TEXTS_JSON);
        let texts = match parsed {
            Ok(texts) => texts,
            Err(e) => {
                panic!("server/locales/meta.json: expected the four texts of ru and en, got {e}")
            }
        };
        for (lang, t) in [("ru", &texts.ru), ("en", &texts.en)] {
            for (key, text, want) in [
                (
                    "share_story",
                    &t.share_story,
                    vec!["achievements", "endings", "story"],
                ),
                ("share_invite", &t.share_invite, Vec::new()),
                ("share_button", &t.share_button, Vec::new()),
                ("share_title", &t.share_title, Vec::new()),
            ] {
                if text.trim().is_empty() {
                    failures.push(format!("{lang}.{key}: blank"));
                }
                match placeholders(text) {
                    Ok(mut names) => {
                        names.sort_unstable();
                        if names != want {
                            failures.push(format!(
                                "{lang}.{key}: expected the placeholders {want:?}, got {names:?}"
                            ));
                        }
                    }
                    Err(reason) => failures.push(format!("{lang}.{key}: {reason}")),
                }
            }
        }
        // The static the route reads parses the same file.
        if TEXTS.of(Lang::En).share_title != texts.en.share_title {
            failures.push("TEXTS: expected the file's texts".to_owned());
        }
        report(&failures);
    }

    /// The window rolls per user: take `limit + 1` is refused with the wait until the oldest take leaves; a take
    /// leaving the window frees one slot; after an idle window the sweep drops another user's emptied entry.
    #[test]
    fn rate_window_rolls_and_prunes() {
        let w = RateWindow::new(3, 100);
        let (a, b) = (UserId(1), UserId(2));
        let mut failures = Vec::new();
        let mut expect = |case: &str, got: Result<(), i64>, want: Result<(), i64>| {
            if got != want {
                failures.push(format!("{case}: expected {want:?}, got {got:?}"));
            }
        };
        expect("b at 0", w.take(b, 0), Ok(()));
        for at in [10, 20, 30] {
            expect(&format!("a at {at}"), w.take(a, at), Ok(()));
        }
        expect("a's 4th at 40", w.take(a, 40), Err(70));
        expect("a at 109: 10 still in", w.take(a, 109), Err(1));
        expect("a at 110: 10 has left", w.take(a, 110), Ok(()));
        expect("a at 111", w.take(a, 111), Err(9));
        let state = w.state.lock().unwrap_or_else(PoisonError::into_inner);
        let users: Vec<i64> = {
            let mut ids: Vec<i64> = state.by_user.keys().map(|u| u.0).collect();
            ids.sort_unstable();
            ids
        };
        let a_takes: Vec<i64> = state
            .by_user
            .get(&a)
            .map(|takes| takes.iter().copied().collect())
            .unwrap_or_default();
        if users != [1] || a_takes != [20, 30, 110] {
            failures.push(format!(
                "after the sweep at 109: expected only a with [20, 30, 110], got users {users:?} and a {a_takes:?}"
            ));
        }
        report(&failures);
    }

    /// One pass: a story title holding `{endings}` stays literal, and an unknown placeholder is kept.
    #[test]
    fn render_is_single_pass() {
        let mut failures = Vec::new();
        for (template, values, want) in [
            (
                "«{story}»: {endings}",
                vec![("story", "{endings}"), ("endings", "2")],
                "«{endings}»: 2",
            ),
            ("{x} {story}", vec![("story", "s")], "{x} s"),
            ("{story", vec![("story", "s")], "{story"),
        ] {
            let got = render(template, &values);
            if got != want {
                failures.push(format!(
                    "render({template:?}): expected {want:?}, got {got:?}"
                ));
            }
        }
        report(&failures);
    }
}
