//! `GET /api/privacy` (META-PLAN M26, F28): the privacy policy, public and versioned. [`Policy::load`] substitutes
//! the compiled template once at startup: the operator's identity facts from the host file `PRIVACY_OPERATOR_FILE`
//! names, `{POLICY_VERSION}` from the template's meta; under prod a placeholder left refuses the start.

use std::path::Path;
use std::sync::LazyLock;

use axum::Router;
use axum::extract::State;
use axum::http::header::{CACHE_CONTROL, CONTENT_SECURITY_POLICY, CONTENT_TYPE};
use axum::response::IntoResponse;
use axum::routing::get;
use serde_json::{Map, Value};

use crate::AppState;
use crate::config::TelegramEnv;

/// The policy template, compiled in: the page is the binary's, never a file read at request time.
const POLICY_HTML: &str = include_str!("../../legal/privacy-policy.html");

/// The placeholders the host file fills (META-PLAN M26, the identity class): who the operator is and how to reach
/// them. The only keys the host file may carry.
pub const IDENTITY_KEYS: [&str; 10] = [
    "OPERATOR_NAME",
    "OPERATOR_FORM",
    "OGRN",
    "INN",
    "OPERATOR_ADDRESS",
    "PRIVACY_CONTACT_EMAIL",
    "RESPONSIBLE_PERSON",
    "DPO_CONTACT",
    "EU_REPRESENTATIVE",
    "POLICY_URL",
];

/// The placeholders only a template commit fills (META-PLAN M26, the content class): disclosures a consent is
/// informed by, so they version the policy. The host file may not carry one.
pub const CONTENT_KEYS: [&str; 6] = [
    "RETENTION_PERIOD",
    "MIN_AGE",
    "DB_LOCATION_COUNTRY",
    "HOSTING_PROVIDER",
    "CROSS_BORDER_TRANSFER",
    "SUPERVISORY_AUTHORITY",
];

/// The placeholder filled from the template's meta, never from the host file: the page's date is the version a
/// consent records.
const DERIVED_KEY: &str = "POLICY_VERSION";

/// The privacy page, substituted once at startup.
pub struct Policy {
    html: String,
}

/// Why [`Policy::load`] refused the start. The text names `PRIVACY_OPERATOR_FILE` and the key, never a value.
#[derive(Debug, thiserror::Error)]
pub enum PolicyError {
    /// The host file cannot be read.
    #[error("PRIVACY_OPERATOR_FILE cannot be read: {0}")]
    Read(#[source] std::io::Error),
    /// The host file is not valid JSON, or not a JSON object.
    #[error("PRIVACY_OPERATOR_FILE is not valid JSON or not a JSON object")]
    NotAnObject,
    /// The value of this key is not a string.
    #[error("PRIVACY_OPERATOR_FILE: the value of {0} is not a string")]
    NotAString(String),
    /// A key that is no identity placeholder ([`IDENTITY_KEYS`]).
    #[error("PRIVACY_OPERATOR_FILE: {0} is not an operator identity key")]
    UnknownKey(String),
    /// A content key ([`CONTENT_KEYS`]) or `POLICY_VERSION`: only a template commit fills those.
    #[error("PRIVACY_OPERATOR_FILE: {0} is filled by the policy template, never by the host file")]
    ContentKey(String),
    /// Under prod: the placeholders left in the page, each once, in the order they first appear.
    #[error("placeholders left under TELEGRAM_ENV=prod: {}", braced(.0))]
    Unfilled(Vec<String>),
}

/// `keys` as `{KEY}, {KEY}`.
fn braced(keys: &[String]) -> String {
    keys.iter()
        .map(|key| format!("{{{key}}}"))
        .collect::<Vec<_>>()
        .join(", ")
}

impl Policy {
    /// The compiled template with `{POLICY_VERSION}` filled from its meta and each identity placeholder from the host
    /// file `file` (one flat JSON object of strings, keys from [`IDENTITY_KEYS`]), every value HTML-escaped, in one
    /// pass. A blank value fills nothing, so its placeholder stays. Without a file the identity placeholders stay
    /// visible: the draft. Under [`TelegramEnv::Prod`] any placeholder left in the page is
    /// [`PolicyError::Unfilled`]: the server does not start.
    pub async fn load(file: Option<&Path>, env: TelegramEnv) -> Result<Policy, PolicyError> {
        let facts = match file {
            None => Vec::new(),
            Some(path) => facts_of(&tokio::fs::read(path).await.map_err(PolicyError::Read)?)?,
        };
        let html = render(POLICY_HTML, policy_version(), &facts);
        if env == TelegramEnv::Prod {
            // The page itself is scanned, not the template minus the facts: a value that carries a placeholder
            // leaves one too.
            let mut left: Vec<String> = Vec::new();
            for (_, key) in placeholders(&html) {
                if !left.iter().any(|k| k == key) {
                    left.push(key.to_owned());
                }
            }
            if !left.is_empty() {
                return Err(PolicyError::Unfilled(left));
            }
        }
        Ok(Policy { html })
    }

    /// The page as served.
    pub fn html(&self) -> &str {
        &self.html
    }
}

/// The identity facts of the host file's bytes. Each key is checked in this order: a content key or
/// `POLICY_VERSION`, a key outside [`IDENTITY_KEYS`], a value that is not a string; a blank value is dropped.
fn facts_of(bytes: &[u8]) -> Result<Vec<(&'static str, String)>, PolicyError> {
    let object: Map<String, Value> =
        serde_json::from_slice(bytes).map_err(|_| PolicyError::NotAnObject)?;
    let mut facts = Vec::new();
    for (key, value) in object {
        if key == DERIVED_KEY || CONTENT_KEYS.contains(&key.as_str()) {
            return Err(PolicyError::ContentKey(key));
        }
        let Some(&identity) = IDENTITY_KEYS.iter().find(|k| **k == key) else {
            return Err(PolicyError::UnknownKey(key));
        };
        let Value::String(value) = value else {
            return Err(PolicyError::NotAString(key));
        };
        // A published policy never shows an empty operator fact: the placeholder stays, and prod refuses it.
        if !value.trim().is_empty() {
            facts.push((identity, value));
        }
    }
    Ok(facts)
}

/// Every `{KEY}` token of `html` with the offset of its `{`; `KEY` is one or more of `A-Z` and `_` (`\{[A-Z_]+\}`).
/// The one scanner of the render, the prod guard and the classification test.
fn placeholders(html: &str) -> impl Iterator<Item = (usize, &str)> {
    html.match_indices('{').filter_map(move |(open, _)| {
        let tail = &html[open + 1..];
        let len = tail
            .bytes()
            .take_while(|b| b.is_ascii_uppercase() || *b == b'_')
            .count();
        (len > 0 && tail.as_bytes().get(len) == Some(&b'}')).then(|| (open, &tail[..len]))
    })
}

/// `template` with `{POLICY_VERSION}` replaced by `version` and each `{KEY}` of `facts` by its HTML-escaped value, in
/// one pass: an inserted value is never scanned again, so a value holding `{INN}` stays literal. Any other token stays
/// as it is.
fn render(template: &str, version: &str, facts: &[(&'static str, String)]) -> String {
    let mut out = String::with_capacity(template.len());
    let mut copied = 0;
    for (open, key) in placeholders(template) {
        let value = if key == DERIVED_KEY {
            version.to_owned()
        } else if let Some((_, fact)) = facts.iter().find(|(k, _)| *k == key) {
            escape_html(fact)
        } else {
            continue;
        };
        out.push_str(&template[copied..open]);
        out.push_str(&value);
        copied = open + key.len() + 2;
    }
    out.push_str(&template[copied..]);
    out
}

/// `value` safe in HTML text and in a quoted attribute: `&`, `<`, `>`, `"` and `'` escaped.
fn escape_html(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for c in value.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            c => out.push(c),
        }
    }
    out
}

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

/// `GET /api/privacy`: the page [`Policy::load`] substituted at startup, as `text/html; charset=utf-8`, cacheable for
/// five minutes by anyone (the route sets its own `Cache-Control`, so the router's `no-store` default stays off),
/// under a CSP that allows the page's inline `<style>` and nothing else.
async fn get_privacy(State(st): State<AppState>) -> impl IntoResponse {
    (
        [
            (CONTENT_TYPE, "text/html; charset=utf-8"),
            (CACHE_CONTROL, "public, max-age=300"),
            (
                CONTENT_SECURITY_POLICY,
                "default-src 'none'; style-src 'unsafe-inline'",
            ),
        ],
        st.policy.html().to_owned(),
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

/// The append-only pin history (META-PLAN M26): each policy version and the SHA-256 of its template bytes. A template
/// edit lands with a new meta version and a new row; an edited row is a review STOP. Test-only: no run-time code
/// reads the pin, and the gate contract runs `cargo test` before every merge.
#[cfg(test)]
const POLICY_PINS: &[(&str, &str)] = &[(
    "2026-10-31",
    "ec987fb14e73b201baf92881d3f7fd4c06436b88b4116f09cda75a32d1a1bb2c",
)];

/// The first pin condition [`check_pins`] finds broken.
#[cfg(test)]
#[derive(Debug, PartialEq, Eq)]
enum PinError {
    /// Row `at`'s version is not after the previous row's.
    NotIncreasing { at: usize },
    /// The last row's version (none for an empty history) is not the template's meta.
    LastNotMeta { last: Option<String>, meta: String },
    /// The last row's hash is not the template's.
    HashMismatch { version: String },
}

/// The pin's three conditions, in order: the versions strictly increase (`YYYY-MM-DD[a-z]` sorts by date), the last
/// equals `meta`, and its hash is the lower-case hex SHA-256 of `template`. Only the last row is compared with
/// today's template: an earlier row pins an earlier text.
#[cfg(test)]
fn check_pins(pins: &[(&str, &str)], meta: &str, template: &[u8]) -> Result<(), PinError> {
    use sha2::{Digest, Sha256};

    if let Some(i) = pins.windows(2).position(|w| w[0].0 >= w[1].0) {
        return Err(PinError::NotIncreasing { at: i + 1 });
    }
    let Some(&(version, hash)) = pins.last().filter(|(version, _)| *version == meta) else {
        return Err(PinError::LastNotMeta {
            last: pins.last().map(|(version, _)| (*version).to_owned()),
            meta: meta.to_owned(),
        });
    };
    if hash != hex::encode(Sha256::digest(template)) {
        return Err(PinError::HashMismatch {
            version: version.to_owned(),
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use sha2::{Digest, Sha256};

    use super::*;

    /// Two template texts of a crafted history.
    const T1: &[u8] = b"<p>policy text, first version</p>";
    const T2: &[u8] = b"<p>policy text, second version</p>";

    fn h(template: &[u8]) -> String {
        hex::encode(Sha256::digest(template))
    }

    /// The valid two-row history V: each crafted case below breaks exactly one of its conditions.
    fn valid() -> [(&'static str, String); 2] {
        [("2026-10-31", h(T1)), ("2026-12-01", h(T2))]
    }

    fn rows<'h>(history: &'h [(&'static str, String)]) -> Vec<(&'static str, &'h str)> {
        history
            .iter()
            .map(|(v, hash)| (*v, hash.as_str()))
            .collect()
    }

    #[test]
    fn pin_check_rejects_non_increasing_versions() {
        let duplicate = [("2026-10-31", h(T1)), ("2026-10-31", h(T2))];
        assert_eq!(
            check_pins(&rows(&duplicate), "2026-10-31", T2),
            Err(PinError::NotIncreasing { at: 1 }),
            "a duplicate version"
        );
        let decreasing = [("2026-12-01", h(T1)), ("2026-10-31", h(T2))];
        assert_eq!(
            check_pins(&rows(&decreasing), "2026-10-31", T2),
            Err(PinError::NotIncreasing { at: 1 }),
            "a decreasing version"
        );
    }

    #[test]
    fn pin_check_rejects_last_not_meta() {
        assert_eq!(
            check_pins(&rows(&valid()), "2026-10-31", T2),
            Err(PinError::LastNotMeta {
                last: Some("2026-12-01".to_owned()),
                meta: "2026-10-31".to_owned(),
            }),
            "a meta left at the first row's version"
        );
        assert_eq!(
            check_pins(&[], "2026-12-01", T2),
            Err(PinError::LastNotMeta {
                last: None,
                meta: "2026-12-01".to_owned(),
            }),
            "an empty history"
        );
    }

    #[test]
    fn pin_check_rejects_hash_mismatch() {
        let swapped = [("2026-10-31", h(T2)), ("2026-12-01", h(T1))];
        assert_eq!(
            check_pins(&rows(&swapped), "2026-12-01", T2),
            Err(PinError::HashMismatch {
                version: "2026-12-01".to_owned(),
            }),
            "the two rows' hashes swapped"
        );
    }

    /// Keeps the checker from being stricter than the rule: an earlier row's hash is never compared with today's
    /// template.
    #[test]
    fn pin_check_accepts_a_valid_history() {
        assert_eq!(check_pins(&rows(&valid()), "2026-12-01", T2), Ok(()));
    }

    /// The real data: the pin history, the version consents record and the compiled template bytes. A template edit
    /// lands with a new meta version and a new `POLICY_PINS` row.
    #[test]
    fn policy_template_pinned_per_version() {
        assert_eq!(
            check_pins(POLICY_PINS, policy_version(), POLICY_HTML.as_bytes()),
            Ok(())
        );
    }

    /// Every `{UPPER_SNAKE}` of the template is an identity key, a content key or `POLICY_VERSION`, so a placeholder
    /// the draft adds is classified before it ships. Every identity key is among the scanner's tokens, so a scanner
    /// that finds nothing cannot pass.
    #[test]
    fn policy_placeholders_classified() {
        let mut failures = Vec::new();
        let tokens: Vec<&str> = placeholders(POLICY_HTML).map(|(_, key)| key).collect();
        for key in &tokens {
            if !IDENTITY_KEYS.contains(key)
                && !CONTENT_KEYS.contains(key)
                && *key != "POLICY_VERSION"
            {
                failures.push(format!(
                    "{{{key}}}: in neither IDENTITY_KEYS nor CONTENT_KEYS, and not POLICY_VERSION"
                ));
            }
        }
        for key in IDENTITY_KEYS {
            if !tokens.contains(&key) {
                failures.push(format!(
                    "{{{key}}}: an identity key the scanner does not find in the template"
                ));
            }
        }
        assert!(
            failures.is_empty(),
            "{} failures:\n{}",
            failures.len(),
            failures.join("\n")
        );
    }

    /// One pass: a value is never scanned again, so the two-key cycle stays literal in either order of a sequential
    /// replace; a fact is escaped, the version is filled, an unknown token and a broken one stay as they are.
    #[test]
    fn render_is_single_pass() {
        let template =
            "{OPERATOR_NAME}|{INN}|{POLICY_VERSION}|{RETENTION_PERIOD}|{OPERATOR_NAME|{lower}";
        let facts = [
            ("OPERATOR_NAME", "{INN}".to_owned()),
            ("INN", "{OPERATOR_NAME} <x>".to_owned()),
        ];
        assert_eq!(
            render(template, "2026-12-01", &facts),
            "{INN}|{OPERATOR_NAME} &lt;x&gt;|2026-12-01|{RETENTION_PERIOD}|{OPERATOR_NAME|{lower}"
        );
    }
}
