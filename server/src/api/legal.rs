//! `GET /api/privacy` (META-PLAN M26, F28): the privacy policy, public and versioned. The compiled template is served
//! as is; substituting the operator facts and `{POLICY_VERSION}` is LPO's (META-PLAN "why LPO owns the substitution").

use std::sync::LazyLock;

use axum::Router;
use axum::http::header::{CACHE_CONTROL, CONTENT_SECURITY_POLICY, CONTENT_TYPE};
use axum::response::IntoResponse;
use axum::routing::get;

use crate::AppState;

/// The policy template, compiled in: the page is the binary's, never a file read at request time.
const POLICY_HTML: &str = include_str!("../../legal/privacy-policy.html");

/// The text before the version in the template's `<meta name="policy-version" content="...">`.
const VERSION_META: &str = r#"<meta name="policy-version" content=""#;

/// The compiled template's version, parsed once.
static POLICY_VERSION: LazyLock<&'static str> = LazyLock::new(|| {
    version_of(POLICY_HTML).expect(
        "invariant: the compiled policy carries <meta name=\"policy-version\"> in the YYYY-MM-DD[a-z] shape \
         (pinned by privacy_page_served_with_version)",
    )
});

/// The version of the compiled policy (`YYYY-MM-DD`, optionally one lower-case letter): what a consent row records as
/// the policy the user saw (M12), never a client-sent value.
pub fn policy_version() -> &'static str {
    &POLICY_VERSION
}

/// The `/privacy` route: no `AuthUser`, the page is public.
pub fn routes() -> Router<AppState> {
    Router::new().route("/privacy", get(get_privacy))
}

/// `GET /api/privacy`: the template bytes as `text/html; charset=utf-8`, cacheable for five minutes by anyone (the
/// route sets its own `Cache-Control`, so the router's `no-store` default stays off), under a CSP that allows the
/// page's inline `<style>` and nothing else.
async fn get_privacy() -> impl IntoResponse {
    (
        [
            (CONTENT_TYPE, "text/html; charset=utf-8"),
            (CACHE_CONTROL, "public, max-age=300"),
            (
                CONTENT_SECURITY_POLICY,
                "default-src 'none'; style-src 'unsafe-inline'",
            ),
        ],
        POLICY_HTML,
    )
}

/// The version in `html`'s policy-version meta tag, if it has the consent row's shape (`consents_policy_version_shape`).
fn version_of(html: &'static str) -> Option<&'static str> {
    let (_, rest) = html.split_once(VERSION_META)?;
    let (version, _) = rest.split_once('"')?;
    is_policy_version(version).then_some(version)
}

/// `s` is `YYYY-MM-DD` with an optional trailing lower-case letter.
fn is_policy_version(s: &str) -> bool {
    let bytes = s.as_bytes();
    let Some((date, suffix)) = bytes.split_at_checked(10) else {
        return false;
    };
    let date_ok = date.iter().enumerate().all(|(i, &b)| {
        if i == 4 || i == 7 {
            b == b'-'
        } else {
            b.is_ascii_digit()
        }
    });
    let suffix_ok = match suffix {
        [] => true,
        [letter] => letter.is_ascii_lowercase(),
        _ => false,
    };
    date_ok && suffix_ok
}
