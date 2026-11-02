//! The social routes (META-PLAN M10-M13, M15): the user's social view, the invite view and the request through an
//! invite code (F19), the accept and the decline or removal (F20), the code rotation, the profile-visibility consent
//! (F21) and a friend's profile (M13). Thin handlers: the limits and the wire shapes of invite codes and handles live
//! here, the SQL in `db/social.rs`. Every 200 is `private, no-store`: one user's own view. Another user is named by
//! handle only, never by Telegram id (W1).
//!
//! An invite link is `https://t.me/<bot>?startapp=f<code>` ([`invite_link`] writes it, [`invite_code_of_start_param`]
//! reads it); the server reads the signed `start_param` only. Every other `start_param` shape is reserved for later
//! prefixes (campaign codes) and stays harmless: it creates nothing.
//!
//! A user's progress for others (a friend's profile; the share's counts in `api/share.rs`, LF2) comes from the two
//! grouped reads of `db/achievements.rs` ([`progress`]), counted against the current index ([`story_counts`]): this
//! module is the one route module besides the card that names them (META-PLAN M6; pinned by
//! `cards::achievements_repo_called_only_from_cards_api`). Counts are the friend's own statistics and are not gated;
//! a title is shown only when both found it and the viewer owns every chapter it is gated on (M7, principle 0).
//!
//! A malformed code or handle is 400 `bad_request` (it never reaches SQL); a well-shaped one that names nothing for
//! this caller is 404 `not_found`. Neither reveals anything about another user.

use std::collections::HashSet;

use axum::Json;
use axum::extract::rejection::{JsonRejection, PathRejection};
use axum::extract::{Path, State};
use axum::http::HeaderValue;
use axum::http::header::{CACHE_CONTROL, HeaderName, X_CONTENT_TYPE_OPTIONS};
use axum::response::{IntoResponse, Response};

use crate::AppState;
use crate::api::body_rejection;
use crate::api::dto::{
    ConsentRequest, FriendDto, FriendProfile, FriendRequestDto, FriendStoryDto, InviteView,
    Localized, SharedAchievement, SharedEnding, SocialResponse,
};
use crate::api::legal::policy_version;
use crate::auth::AuthUser;
use crate::content::{self, StoryDef};
use crate::db::achievements::{EndingRow, UnlockRow};
use crate::db::social::{AcceptOutcome, RotateOutcome};
use crate::error::ApiError;
use crate::ids::{ProductId, UserId};
use crate::meta::{StoryMeta, visible};

/// Friends per user (MV15).
pub const MAX_FRIENDS: i64 = 200;

/// Pending incoming requests per user (MV15): further requests create nothing and are answered `requested`.
pub const MAX_PENDING_REQUESTS: i64 = 50;

/// Invite-code rotations per user per rolling day (MV15).
pub const MAX_ROTATIONS_PER_DAY: i64 = 10;

/// The consent texts the client may name (`PUT /api/consents/friends_profile`): a closed list.
pub const CONSENT_TEXT_VERSIONS: [&str; 1] = ["friends_profile.v1"];

/// The `start_param` prefix of an invite.
const INVITE_PREFIX: &str = "f";

/// The hex digits of an invite code: 16 random bytes.
const CODE_HEX_LEN: usize = 32;

/// The hex digits of a handle: 12 random bytes.
const HANDLE_HEX_LEN: usize = 24;

/// `s` is exactly `len` lower-case hex digits.
fn is_lower_hex(s: &str, len: usize) -> bool {
    s.len() == len && s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

/// `s` is an invite code: exactly 32 lower-case hex digits (`invite_codes_shape`).
pub fn is_invite_code(s: &str) -> bool {
    is_lower_hex(s, CODE_HEX_LEN)
}

/// The invite code a signed `start_param` carries: `f` + an invite code, else `None` (an upper-case prefix or digit,
/// another length, U+0000, or another prefix).
pub fn invite_code_of_start_param(sp: &str) -> Option<&str> {
    sp.strip_prefix(INVITE_PREFIX)
        .filter(|code| is_invite_code(code))
}

/// `s` is a handle: exactly 24 lower-case hex digits.
pub fn is_handle(s: &str) -> bool {
    is_lower_hex(s, HANDLE_HEX_LEN)
}

/// The invite link of `code` on the bot `username`: `https://t.me/<username>?startapp=f<code>`, which
/// [`invite_code_of_start_param`] reads back.
pub(crate) fn invite_link(username: &str, code: &str) -> String {
    format!("https://t.me/{username}?startapp={INVITE_PREFIX}{code}")
}

/// What a user found, raw, over all stories: the distinct reached endings and the stored unlocks.
pub(crate) struct Progress {
    /// Every distinct (story, chapter, ending) reached.
    endings: Vec<EndingRow>,
    /// Every stored unlock.
    unlocks: Vec<UnlockRow>,
}

/// `user`'s [`Progress`]: two grouped reads, autocommit.
pub(crate) async fn progress(st: &AppState, user: UserId) -> Result<Progress, ApiError> {
    Ok(Progress {
        endings: st.repo.endings_by_story(user).await?,
        unlocks: st.repo.unlocks_by_story(user).await?,
    })
}

/// What counts of a user's progress in one story under the current index (STORIES-PLAN ST6).
pub(crate) struct StoryCounts {
    /// The endings found, in name order.
    pub endings: Vec<String>,
    /// The achievements unlocked, in the meta's display order.
    pub achievements: Vec<String>,
}

/// `p` counted in `story` (pure; not gated: these are the user's own statistics, M13). An ending counts when the row
/// is the story's and the story declares the ending in the row's chapter (`meta::facts`' rule): a retired ending, or
/// one recorded in another chapter, does not. An unlock counts when the row is the story's and the story's meta still
/// holds the id.
pub(crate) fn story_counts(p: &Progress, story: &StoryDef, meta: &StoryMeta) -> StoryCounts {
    let endings = story
        .endings
        .iter()
        .filter(|&(name, chapter)| {
            p.endings
                .iter()
                .any(|row| row.story == story.id && &row.name == name && &row.chapter == chapter)
        })
        .map(|(name, _)| name.clone())
        .collect();
    let achievements = meta
        .achievements
        .iter()
        .filter(|a| {
            p.unlocks
                .iter()
                .any(|row| row.story == story.id && row.achievement == a.id)
        })
        .map(|a| a.id.clone())
        .collect();
    StoryCounts {
        endings,
        achievements,
    }
}

/// The headers of a 200: one user's own view, which no shared cache stores (the `api/wallet.rs` pair).
fn private_headers() -> [(HeaderName, HeaderValue); 1] {
    [(CACHE_CONTROL, HeaderValue::from_static("private, no-store"))]
}

/// The invite code of the path: 400 unless it is text in the invite-code shape.
fn code_param(raw: Result<Path<String>, PathRejection>) -> Result<String, ApiError> {
    let Ok(Path(code)) = raw else {
        return Err(ApiError::BadRequest("invite code is not text"));
    };
    if !is_invite_code(&code) {
        return Err(ApiError::BadRequest("invite code outside the grammar"));
    }
    Ok(code)
}

/// `GET /api/invites/{code}` (F19 step 3): the caller's state toward the code's owner. 404 for an unknown or revoked
/// code. A read.
pub async fn get_invite(
    State(st): State<AppState>,
    AuthUser(user): AuthUser,
    code: Result<Path<String>, PathRejection>,
) -> Result<Response, ApiError> {
    let code = code_param(code)?;
    let state = st
        .repo
        .invite_state(user, &code, MAX_PENDING_REQUESTS)
        .await?
        .ok_or(ApiError::NotFound)?;
    Ok((private_headers(), Json(InviteView { state })).into_response())
}

/// `POST /api/invites/{code}/request` (F19 step 4): the caller asks the code's owner; the state after the act. A
/// repeat, a block of the caller and the owner's cap all answer `requested` and write nothing.
pub async fn post_invite_request(
    State(st): State<AppState>,
    AuthUser(user): AuthUser,
    code: Result<Path<String>, PathRejection>,
) -> Result<Response, ApiError> {
    let code = code_param(code)?;
    let state = st
        .repo
        .ask(user, &code, MAX_PENDING_REQUESTS, st.clock.now())
        .await?
        .ok_or(ApiError::NotFound)?;
    Ok((private_headers(), Json(InviteView { state })).into_response())
}

/// The handle of the path: 400 unless it is text in the handle shape.
fn handle_param(raw: Result<Path<String>, PathRejection>) -> Result<String, ApiError> {
    let Ok(Path(handle)) = raw else {
        return Err(ApiError::BadRequest("handle is not text"));
    };
    if !is_handle(&handle) {
        return Err(ApiError::BadRequest("handle outside the grammar"));
    }
    Ok(handle)
}

/// `user`'s social view as the 200 of every social action.
async fn social_reply(st: &AppState, user: UserId) -> Result<Response, ApiError> {
    let rows = st.repo.social(user, st.clock.now()).await?;
    let body = SocialResponse {
        invite_code: rows.invite_code,
        friends: rows
            .friends
            .into_iter()
            .map(|row| FriendDto {
                handle: row.handle,
                first_name: row.first_name,
            })
            .collect(),
        requests: rows
            .requests
            .into_iter()
            .map(|row| FriendRequestDto {
                handle: row.handle,
                first_name: row.first_name,
                at: row.at,
            })
            .collect(),
        profile_visible: rows.profile_visible,
    };
    Ok((private_headers(), Json(body)).into_response())
}

/// `GET /api/social`: the user's invite code (created on the first call), friends, incoming requests and profile
/// visibility.
pub async fn get_social(
    State(st): State<AppState>,
    AuthUser(user): AuthUser,
) -> Result<Response, ApiError> {
    social_reply(&st, user).await
}

/// `POST /api/friends/requests/{handle}/accept` (F20 step 1): the request from the handle's user becomes a
/// friendship. 404 without such a request (a repeat after success too), 409 `limit_reached` when either side is at
/// [`MAX_FRIENDS`] (the request stays).
pub async fn post_accept(
    State(st): State<AppState>,
    AuthUser(user): AuthUser,
    handle: Result<Path<String>, PathRejection>,
) -> Result<Response, ApiError> {
    let handle = handle_param(handle)?;
    let from = st
        .repo
        .user_by_handle(&handle)
        .await?
        .ok_or(ApiError::NotFound)?;
    match st
        .repo
        .accept(user, from, MAX_FRIENDS, st.clock.now())
        .await?
    {
        AcceptOutcome::Accepted => social_reply(&st, user).await,
        AcceptOutcome::NoRequest => Err(ApiError::NotFound),
        AcceptOutcome::LimitReached => Err(ApiError::LimitReached),
    }
}

/// `DELETE /api/friends/{handle}` (F20 step 2): declines the handle's user's request or ends the friendship, from
/// either side, and writes the durable block. 404 when there is neither (a repeat too).
pub async fn delete_friend(
    State(st): State<AppState>,
    AuthUser(user): AuthUser,
    handle: Result<Path<String>, PathRejection>,
) -> Result<Response, ApiError> {
    let handle = handle_param(handle)?;
    let other = st
        .repo
        .user_by_handle(&handle)
        .await?
        .ok_or(ApiError::NotFound)?;
    if !st.repo.remove(user, other, st.clock.now()).await? {
        return Err(ApiError::NotFound);
    }
    social_reply(&st, user).await
}

/// `POST /api/invite/rotate`: revokes the user's active code and issues a new one (the old link then answers 404).
/// 429 `rate_limited` with `Retry-After` past [`MAX_ROTATIONS_PER_DAY`] in a rolling day.
pub async fn post_rotate(
    State(st): State<AppState>,
    AuthUser(user): AuthUser,
) -> Result<Response, ApiError> {
    match st
        .repo
        .rotate(user, MAX_ROTATIONS_PER_DAY, st.clock.now())
        .await?
    {
        RotateOutcome::Rotated => social_reply(&st, user).await,
        RotateOutcome::Limited { retry_after_secs } => {
            Err(ApiError::RateLimited { retry_after_secs })
        }
    }
}

/// The headers of a profile: it may carry paid-gated titles, so no shared cache stores it and no browser sniffs another
/// type into it (the paid-content pair of `api/cards.rs`).
fn profile_headers() -> [(HeaderName, HeaderValue); 2] {
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

/// A count as the wire's `u32` (a user's distinct items are far fewer).
fn count(items: &[String]) -> u32 {
    u32::try_from(items.len()).unwrap_or(u32::MAX)
}

/// `GET /api/friends/{handle}/profile` (M13): a friend's progress, by handle. 400 for a malformed handle; 404
/// `not_found` unless the handle names a friend of the viewer (an unknown handle, a pending request either way, one's
/// own handle); `visible: false` and nothing else unless the friend's latest consent is a grant. Otherwise per story
/// of the index with a counted ending or unlock of the friend (Q4): the friend's counts, and the titles of the items
/// both found that pass the viewer's gate. At most eight autocommit reads: the handle, the friendship, the consent,
/// the viewer's entitlements and two grouped reads per user. No `?lang`: titles carry both languages.
pub async fn get_friend_profile(
    State(st): State<AppState>,
    AuthUser(viewer): AuthUser,
    handle: Result<Path<String>, PathRejection>,
) -> Result<Response, ApiError> {
    let handle = handle_param(handle)?;
    let friend = st
        .repo
        .user_by_handle(&handle)
        .await?
        .ok_or(ApiError::NotFound)?;
    // One's own handle answers `false` here too: one user is never its own friend.
    if !st.repo.are_friends(viewer, friend).await? {
        return Err(ApiError::NotFound);
    }
    if !st.repo.profile_visible(friend).await? {
        let body = FriendProfile {
            handle,
            visible: false,
            stories: Vec::new(),
        };
        return Ok((profile_headers(), Json(body)).into_response());
    }
    let owned: HashSet<ProductId> = st.repo.entitlements(viewer).await?.into_iter().collect();
    let theirs = progress(&st, friend).await?;
    let mine = progress(&st, viewer).await?;
    let stories = st
        .content
        .stories()
        .iter()
        .filter_map(|story| {
            // The meta index holds every story of the index (a startup rule).
            let meta = st.content.meta().story(&story.id)?;
            let friend_counts = story_counts(&theirs, story, meta);
            if friend_counts.endings.is_empty() && friend_counts.achievements.is_empty() {
                return None;
            }
            let viewer_counts = story_counts(&mine, story, meta);
            let shared_endings = friend_counts
                .endings
                .iter()
                .filter(|name| viewer_counts.endings.contains(name))
                .filter_map(|name| {
                    let ending = meta.endings.get(name)?;
                    visible(&ending.gate, &owned, story).then(|| SharedEnding {
                        name: name.clone(),
                        title: wire(&ending.title),
                    })
                })
                .collect();
            let shared_achievements = meta
                .achievements
                .iter()
                .filter(|a| {
                    friend_counts.achievements.contains(&a.id)
                        && viewer_counts.achievements.contains(&a.id)
                        && visible(&a.gate, &owned, story)
                })
                .map(|a| SharedAchievement {
                    id: a.id.clone(),
                    name: wire(&a.name),
                })
                .collect();
            Some(FriendStoryDto {
                story_id: story.id.clone(),
                endings_found: count(&friend_counts.endings),
                achievements_unlocked: count(&friend_counts.achievements),
                shared_endings,
                shared_achievements,
            })
        })
        .collect();
    let body = FriendProfile {
        handle,
        visible: true,
        stories,
    };
    Ok((profile_headers(), Json(body)).into_response())
}

/// `PUT /api/consents/friends_profile` (F21): appends the user's decision with the server's own policy version and the
/// named consent text. 400 for a bad body or a text version outside [`CONSENT_TEXT_VERSIONS`]. Profile visibility is
/// the latest row's decision, so nothing is read from the client to grant it (principle 1).
pub async fn put_consent(
    State(st): State<AppState>,
    AuthUser(user): AuthUser,
    req: Result<Json<ConsentRequest>, JsonRejection>,
) -> Result<Response, ApiError> {
    let Json(req) = req.map_err(body_rejection)?;
    if !CONSENT_TEXT_VERSIONS.contains(&req.text_version.as_str()) {
        return Err(ApiError::BadRequest("unknown consent text version"));
    }
    st.repo
        .record_consent(
            user,
            req.granted,
            policy_version(),
            &req.text_version,
            st.clock.now(),
        )
        .await?;
    social_reply(&st, user).await
}
