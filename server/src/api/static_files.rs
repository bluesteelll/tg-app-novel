//! The built client served next to the API when `STATIC_DIR` is set (K27): `/assets/*` (Vite's chunks and the asset
//! tool's files, every name content-hashed) cached for a year, everything else (`index.html` for `/`) revalidated on
//! each launch. There is no SPA fallback: an unknown path is 404, so an unknown `/api/*` path never answers the page.
//!
//! Principle 0: [`check`] runs at startup, before the pool opens. `STATIC_DIR` and `CONTENT_DIR` must be disjoint
//! trees (neither the same nor one inside the other), and no entry of `STATIC_DIR` may resolve outside it: tower-http's
//! `ServeDir` refuses `..` and absolute components but opens whatever a path resolves to, so a link or a junction
//! inside the built client would serve its target. Compression is the reverse proxy's (K1).

use std::path::{Path, PathBuf};

use axum::Router;
use axum::http::header::CACHE_CONTROL;
use axum::http::{HeaderValue, StatusCode};
use axum::response::Response;
use tower::Layer;
use tower_http::services::ServeDir;
use tower_http::set_header::SetResponseHeaderLayer;

/// The `Cache-Control` of a found `/assets/*` file: its name changes with its bytes.
const IMMUTABLE: &str = "public, max-age=31536000, immutable";

/// The `Cache-Control` of everything else: `index.html` names the current chunks, so it is revalidated.
const REVALIDATE: &str = "no-cache";

/// A `STATIC_DIR` that passed [`check`]: canonical, disjoint from `CONTENT_DIR`, every entry resolving inside it.
#[derive(Debug, Clone)]
pub struct StaticDir {
    root: PathBuf,
}

impl StaticDir {
    /// The canonical directory.
    pub fn root(&self) -> &Path {
        &self.root
    }
}

/// Why `STATIC_DIR` is refused at startup. Paths are configuration, not secrets.
#[derive(Debug, thiserror::Error)]
pub enum StaticDirError {
    /// `STATIC_DIR` does not exist or cannot be resolved.
    #[error("STATIC_DIR {path}: cannot be resolved: {source}")]
    Unresolved {
        /// The configured path.
        path: PathBuf,
        /// Why.
        source: std::io::Error,
    },
    /// `STATIC_DIR` is not a directory.
    #[error("STATIC_DIR {path}: not a directory")]
    NotADirectory {
        /// The canonical path.
        path: PathBuf,
    },
    /// `CONTENT_DIR` does not exist or cannot be resolved, so the two cannot be compared.
    #[error("CONTENT_DIR {path}: cannot be resolved to compare with STATIC_DIR: {source}")]
    ContentUnresolved {
        /// The configured path.
        path: PathBuf,
        /// Why.
        source: std::io::Error,
    },
    /// The two are one directory: paid content would be public.
    #[error("STATIC_DIR {static_dir} is CONTENT_DIR: paid content would be public")]
    Same {
        /// The canonical `STATIC_DIR`.
        static_dir: PathBuf,
    },
    /// `CONTENT_DIR` is inside `STATIC_DIR`: paid content would be public.
    #[error(
        "STATIC_DIR {static_dir} contains CONTENT_DIR {content_dir}: paid content would be public"
    )]
    ContainsContent {
        /// The canonical `STATIC_DIR`.
        static_dir: PathBuf,
        /// The canonical `CONTENT_DIR`.
        content_dir: PathBuf,
    },
    /// `STATIC_DIR` is inside `CONTENT_DIR`: the paid files around it would be public.
    #[error(
        "STATIC_DIR {static_dir} is inside CONTENT_DIR {content_dir}: paid content would be public"
    )]
    InsideContent {
        /// The canonical `STATIC_DIR`.
        static_dir: PathBuf,
        /// The canonical `CONTENT_DIR`.
        content_dir: PathBuf,
    },
    /// An entry resolves outside `STATIC_DIR` (a link or a junction): it would serve its target.
    #[error("STATIC_DIR entry {entry} resolves to {target}, outside STATIC_DIR")]
    Escape {
        /// The entry.
        entry: PathBuf,
        /// What it resolves to.
        target: PathBuf,
    },
    /// An entry of `STATIC_DIR` could not be listed or resolved (a dangling link included).
    #[error("STATIC_DIR entry {path}: cannot be checked: {source}")]
    Unreadable {
        /// The directory or entry.
        path: PathBuf,
        /// Why.
        source: std::io::Error,
    },
}

/// How a canonical path relates to another, compared by components (`/a/site` and `/a/site2` are disjoint).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Overlap {
    /// Neither is the other or inside it.
    Disjoint,
    /// The same directory.
    Same,
    /// The second is inside the first.
    Contains,
    /// The first is inside the second.
    Inside,
}

/// How `a` relates to `b`. `Path` compares and prefixes by components, never by characters.
fn overlap(a: &Path, b: &Path) -> Overlap {
    if a == b {
        Overlap::Same
    } else if b.starts_with(a) {
        Overlap::Contains
    } else if a.starts_with(b) {
        Overlap::Inside
    } else {
        Overlap::Disjoint
    }
}

/// The startup check of `static_dir` against `content_dir` (`tokio::fs` only; one caller, `server serve`): both
/// canonicalized, `static_dir` a directory, the two disjoint both ways, then a walk of `static_dir` in which every
/// entry must resolve inside it. A built client is a few hundred files: the walk costs milliseconds.
pub async fn check(static_dir: &Path, content_dir: &Path) -> Result<StaticDir, StaticDirError> {
    let root = tokio::fs::canonicalize(static_dir)
        .await
        .map_err(|source| StaticDirError::Unresolved {
            path: static_dir.to_owned(),
            source,
        })?;
    let is_dir = tokio::fs::metadata(&root)
        .await
        .map_err(|source| StaticDirError::Unreadable {
            path: root.clone(),
            source,
        })?
        .is_dir();
    if !is_dir {
        return Err(StaticDirError::NotADirectory { path: root });
    }
    let content = tokio::fs::canonicalize(content_dir)
        .await
        .map_err(|source| StaticDirError::ContentUnresolved {
            path: content_dir.to_owned(),
            source,
        })?;
    match overlap(&root, &content) {
        Overlap::Disjoint => {}
        Overlap::Same => return Err(StaticDirError::Same { static_dir: root }),
        Overlap::Contains => {
            return Err(StaticDirError::ContainsContent {
                static_dir: root,
                content_dir: content,
            });
        }
        Overlap::Inside => {
            return Err(StaticDirError::InsideContent {
                static_dir: root,
                content_dir: content,
            });
        }
    }
    walk(&root).await?;
    Ok(StaticDir { root })
}

/// Every entry under `root` resolves inside it. Only real directories are descended into: a link that resolves
/// inside `root` names something the walk reaches anyway, and descending into it could loop.
async fn walk(root: &Path) -> Result<(), StaticDirError> {
    let unreadable = |path: &Path| {
        let path = path.to_owned();
        move |source| StaticDirError::Unreadable { path, source }
    };
    let mut dirs = vec![root.to_owned()];
    while let Some(dir) = dirs.pop() {
        let mut entries = tokio::fs::read_dir(&dir).await.map_err(unreadable(&dir))?;
        while let Some(entry) = entries.next_entry().await.map_err(unreadable(&dir))? {
            let path = entry.path();
            let target = tokio::fs::canonicalize(&path)
                .await
                .map_err(unreadable(&path))?;
            if !target.starts_with(root) {
                return Err(StaticDirError::Escape {
                    entry: path,
                    target,
                });
            }
            let kind = entry.file_type().await.map_err(unreadable(&path))?;
            if kind.is_dir() && !kind.is_symlink() {
                dirs.push(path);
            }
        }
    }
    Ok(())
}

/// `app` with the client of `dir` behind it: `/assets/*` from `dir/assets` with [`IMMUTABLE`] on a found file, and
/// every path no route claims from `dir` with [`REVALIDATE`] (`index.html` for `/`). A path with no file is 404 and a
/// method other than GET or HEAD 405 (`ServeDir`'s own answers).
pub fn with_static(app: Router, dir: &StaticDir) -> Router {
    let assets = Router::new()
        .fallback_service(ServeDir::new(dir.root.join("assets")))
        .layer(SetResponseHeaderLayer::overriding(
            CACHE_CONTROL,
            immutable_on_ok,
        ));
    let site =
        SetResponseHeaderLayer::overriding(CACHE_CONTROL, HeaderValue::from_static(REVALIDATE))
            .layer(ServeDir::new(&dir.root));
    app.nest_service("/assets", assets).fallback_service(site)
}

/// [`IMMUTABLE`] for a found file only: a 404 or a 304 keeps no year-long entry.
fn immutable_on_ok(response: &Response) -> Option<HeaderValue> {
    (response.status() == StatusCode::OK).then(|| HeaderValue::from_static(IMMUTABLE))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Disjoint by components: one directory, an ancestor, a descendant, a shared name prefix and two siblings.
    #[test]
    fn static_dir_disjoint_rules() {
        let cases = [
            ("/a/site", "/a/site", Overlap::Same),
            ("/a", "/a/site/content", Overlap::Contains),
            ("/a/site/dist", "/a/site", Overlap::Inside),
            ("/a/site", "/a/site2", Overlap::Disjoint),
            ("/a/site2", "/a/site", Overlap::Disjoint),
            ("/a/client/dist", "/a/server/content", Overlap::Disjoint),
        ];
        let failures: Vec<String> = cases
            .iter()
            .filter(|(a, b, want)| overlap(Path::new(a), Path::new(b)) != *want)
            .map(|(a, b, want)| {
                format!(
                    "{a} vs {b}: expected {want:?}, got {:?}",
                    overlap(Path::new(a), Path::new(b))
                )
            })
            .collect();
        assert!(
            failures.is_empty(),
            "{} failures:\n{}",
            failures.len(),
            failures.join("\n")
        );
    }
}
