//! The bot's one-time setup (`server setup`): every URL it publishes derives from `PUBLIC_APP_URL` (RULINGS 7a), so
//! the configuration's placeholder guard keys on what is published.

/// `public_app_url` up to its first `?` or `#`, its trailing `/` trimmed, then `/` and `path`: `https://h/` and
/// `telegram/webhook` give `https://h/telegram/webhook`, `https://h/app/` gives `https://h/app/telegram/webhook`.
pub fn app_url(public_app_url: &str, path: &str) -> String {
    let base = public_app_url
        .split(['?', '#'])
        .next()
        .unwrap_or_default()
        .trim_end_matches('/');
    let mut url = String::with_capacity(base.len() + 1 + path.len());
    url.push_str(base);
    url.push('/');
    url.push_str(path);
    url
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The published URLs of `app_url`'s vectors: a root and a sub-path base, with and without a trailing `/`, with a
    /// query or a fragment cut off.
    #[test]
    fn bot_setup_urls_from_public_app_url() {
        let cases = [
            (
                "https://h/",
                "telegram/webhook",
                "https://h/telegram/webhook",
            ),
            (
                "https://h/app/",
                "telegram/webhook",
                "https://h/app/telegram/webhook",
            ),
            (
                "https://h",
                "telegram/webhook",
                "https://h/telegram/webhook",
            ),
            ("https://h/app", "api/privacy", "https://h/app/api/privacy"),
            ("https://h/?x=1", "api/privacy", "https://h/api/privacy"),
            (
                "https://h/app/#f",
                "telegram/webhook",
                "https://h/app/telegram/webhook",
            ),
            (
                "https://h/app/?x=1#f",
                "api/privacy",
                "https://h/app/api/privacy",
            ),
        ];
        let failures: Vec<String> = cases
            .iter()
            .filter(|(base, path, want)| app_url(base, path) != *want)
            .map(|(base, path, want)| {
                format!(
                    "app_url({base:?}, {path:?}): expected {want}, got {}",
                    app_url(base, path)
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
