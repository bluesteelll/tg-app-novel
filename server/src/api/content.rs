//! The paid content routes: a paid chapter's JSON and a gated asset file. Principle 0: each is read only after the
//! entitlement check for the token's user, looked up by an exact id or file name the content index holds (never a
//! path built from the request), and answered `private, no-store`. Free chapters are static files of the client
//! build, never served here.

use axum::Json;
use axum::extract::rejection::PathRejection;
use axum::extract::{Path, State};
use axum::http::HeaderValue;
use axum::http::header::{CACHE_CONTROL, CONTENT_TYPE, HeaderName, X_CONTENT_TYPE_OPTIONS};
use axum::response::{IntoResponse, Response};

use crate::AppState;
use crate::api::dto::ChapterPayload;
use crate::auth::AuthUser;
use crate::error::ApiError;
use crate::ids::ChapterId;

/// The headers of every paid 200: no shared cache stores it, and no browser sniffs another type into it.
fn paid_headers() -> [(HeaderName, HeaderValue); 2] {
    [
        (CACHE_CONTROL, HeaderValue::from_static("private, no-store")),
        (X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff")),
    ]
}

/// `GET /api/chapters/{chapterId}`: the paid chapter's files composed raw. 404 for a free, unknown or malformed
/// chapter id (the same answer, so no id is confirmed); 403 `not_entitled` without the chapter's entitlement.
pub async fn get_chapter(
    State(st): State<AppState>,
    AuthUser(user): AuthUser,
    chapter_id: Result<Path<String>, PathRejection>,
) -> Result<Response, ApiError> {
    let Ok(Path(chapter_id)) = chapter_id else {
        return Err(ApiError::NotFound);
    };
    let chapter = ChapterId::parse(&chapter_id)
        .and_then(|id| st.content.paid_chapter(&id))
        .ok_or(ApiError::NotFound)?;
    // Invariant: the paid body is composed only after the entitlement row is seen for this user.
    if !st.repo.is_entitled(user, &chapter.product).await? {
        return Err(ApiError::NotEntitled);
    }
    let payload = ChapterPayload {
        chapter_id: &chapter.id.0,
        story_version: &chapter.story_version,
        story: &chapter.story,
        meta: &chapter.meta,
        assets: &chapter.assets,
        en: &chapter.en,
        world: chapter.world.as_deref(),
    };
    Ok((paid_headers(), Json(payload)).into_response())
}

/// `GET /api/assets/{file}`: a gated asset's bytes. 404 for a name the asset index does not hold (an orphan file, a
/// public asset, any path form: the name is a map key, never joined to a directory); 403 `not_entitled` unless the
/// user owns one of the chapter products whose manifests name the file.
pub async fn get_asset(
    State(st): State<AppState>,
    AuthUser(user): AuthUser,
    file: Result<Path<String>, PathRejection>,
) -> Result<Response, ApiError> {
    let Ok(Path(file)) = file else {
        return Err(ApiError::NotFound);
    };
    let asset = st.content.asset(&file).ok_or(ApiError::NotFound)?;
    let owned = st.repo.entitlements(user).await?;
    if !asset.owners.iter().any(|owner| owned.contains(owner)) {
        return Err(ApiError::NotEntitled);
    }
    // Read per request, not held: paid audio is megabytes, and the sum grows with every chapter. The file was proven
    // a regular file at startup; one gone since is a deployment fault, logged and answered as absent.
    let body = match tokio::fs::read(&asset.path).await {
        Ok(body) => body,
        Err(e) => {
            tracing::error!(path = %asset.path.display(), error = %e, "gated asset unreadable");
            return Err(ApiError::NotFound);
        }
    };
    let [cache, nosniff] = paid_headers();
    let headers = [
        (CONTENT_TYPE, HeaderValue::from_static(asset.content_type)),
        cache,
        nosniff,
    ];
    Ok((headers, body).into_response())
}
