//! Server configuration: every variable the server reads, parsed and validated once at startup.
//!
//! Secrets come only from the environment (principle 3). `Debug` redacts them and a [`ConfigError`] names the
//! variable and the rule, never the value, so neither can carry a secret into a log.

use std::fmt;
use std::net::{IpAddr, SocketAddr};
use std::ops::RangeInclusive;
use std::path::PathBuf;

/// `BOT_TOKEN` as committed in `.env.example`; the integration tests sign with it too.
pub const PLACEHOLDER_BOT_TOKEN: &str = "1000000001:placeholder-bot-token-not-a-real-one";
/// `WEBHOOK_SECRET` as committed in `.env.example`.
pub const PLACEHOLDER_WEBHOOK_SECRET: &str = "placeholder-webhook-secret";
/// `TOKEN_KEY` as committed in `.env.example`: the bytes 0x00..=0x1f, visibly not random.
pub const PLACEHOLDER_TOKEN_KEY_HEX: &str =
    "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";

/// The Telegram environment the bot lives in (`TELEGRAM_ENV`); it selects the Bot API base.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TelegramEnv {
    /// The production environment.
    Prod,
    /// The separate test environment: test accounts, test Stars, HTTP Mini App URLs allowed.
    Test,
}

/// The validated server configuration. `Debug` prints `<redacted>` for every secret.
#[derive(Clone)]
pub struct Config {
    /// `BOT_TOKEN`: the Bot API token, also the key of the initData HMAC.
    pub bot_token: String,
    /// `WEBHOOK_SECRET`: the `secret_token` given to `setWebhook`, expected in `X-Telegram-Bot-Api-Secret-Token`.
    pub webhook_secret: String,
    /// `TOKEN_KEY`: the MAC key of the server's own session tokens.
    pub token_key: [u8; 32],
    /// `TOKEN_TTL_SECS`: the session token lifetime, 900..=3600 (default 1800).
    pub token_ttl_secs: i64,
    /// `INITDATA_MAX_AGE_SECS`: the accepted age of initData's `auth_date`, 1..=86400 (default 86400).
    pub initdata_max_age_secs: i64,
    /// `PUBLIC_APP_URL`: the Mini App URL the bot hands to Telegram.
    pub public_app_url: String,
    /// `ADMIN_TELEGRAM_IDS`: the Telegram user ids allowed to run admin commands (default none).
    pub admin_telegram_ids: Vec<i64>,
    /// `STATIC_DIR`: the built client to serve, if any.
    pub static_dir: Option<PathBuf>,
    /// `CONTENT_DIR`: the paid content loaded at startup.
    pub content_dir: PathBuf,
    /// `DATABASE_PATH`: the SQLite database file.
    pub database_path: PathBuf,
    /// `TELEGRAM_ENV`: `prod` or `test`.
    pub telegram_env: TelegramEnv,
    /// `LISTEN_ADDR`: the HTTP listen address (default `127.0.0.1:8787`).
    pub listen_addr: SocketAddr,
}

/// Stands in for a secret in `Debug` output.
struct Redacted;

impl fmt::Debug for Redacted {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("<redacted>")
    }
}

impl fmt::Debug for Config {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Config")
            .field("bot_token", &Redacted)
            .field("webhook_secret", &Redacted)
            .field("token_key", &Redacted)
            .field("token_ttl_secs", &self.token_ttl_secs)
            .field("initdata_max_age_secs", &self.initdata_max_age_secs)
            .field("public_app_url", &self.public_app_url)
            .field("admin_telegram_ids", &self.admin_telegram_ids)
            .field("static_dir", &self.static_dir)
            .field("content_dir", &self.content_dir)
            .field("database_path", &self.database_path)
            .field("telegram_env", &self.telegram_env)
            .field("listen_addr", &self.listen_addr)
            .finish()
    }
}

/// Every problem found in the configuration; startup stops on any of them.
#[derive(Debug, thiserror::Error)]
#[error("invalid configuration: {}", join_problems(.problems))]
pub struct ConfigError {
    /// The problems in variable order; no problem stops the scan.
    pub problems: Vec<ConfigProblem>,
}

/// One variable that is missing or breaks its rule.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConfigProblem {
    /// The environment variable.
    pub var: &'static str,
    /// What is wrong with it.
    pub kind: ProblemKind,
}

/// What is wrong with a variable. The reason is a static text: a value is never echoed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProblemKind {
    /// Unset or empty, and required.
    Missing,
    /// Set, but breaks the rule described by the text.
    Invalid(&'static str),
}

impl fmt::Display for ConfigProblem {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.kind {
            ProblemKind::Missing => write!(f, "{}: missing", self.var),
            ProblemKind::Invalid(reason) => write!(f, "{}: invalid ({reason})", self.var),
        }
    }
}

fn join_problems(problems: &[ConfigProblem]) -> String {
    problems
        .iter()
        .map(ToString::to_string)
        .collect::<Vec<_>>()
        .join("; ")
}

impl Config {
    /// Reads the configuration from the process environment.
    pub fn from_env() -> Result<Config, ConfigError> {
        Config::from_lookup(|var| std::env::var(var).ok())
    }

    /// Reads the configuration through `get` (the seam for tests: edition 2024 makes `std::env::set_var` unsafe,
    /// and the process environment is shared by parallel tests). An empty value counts as unset. Every problem is
    /// collected before returning.
    pub fn from_lookup(get: impl Fn(&str) -> Option<String>) -> Result<Config, ConfigError> {
        let mut scan = Scan {
            get,
            problems: Vec::new(),
        };

        let bot_token = scan.required("BOT_TOKEN", |v| Ok(v.to_owned()));
        let webhook_secret = scan.required("WEBHOOK_SECRET", parse_webhook_secret);
        let token_key = scan.required("TOKEN_KEY", parse_token_key);
        let token_ttl_secs = scan.optional("TOKEN_TTL_SECS", 1800, |v| {
            int_in(v, 900..=3600).ok_or("must be an integer in 900..=3600")
        });
        let initdata_max_age_secs = scan.optional("INITDATA_MAX_AGE_SECS", 86400, |v| {
            int_in(v, 1..=86400).ok_or("must be an integer in 1..=86400")
        });
        let telegram_env = scan.required("TELEGRAM_ENV", parse_telegram_env);
        // Read after TELEGRAM_ENV because its rule depends on it; a missing or unknown environment gets the strict
        // (prod) rule.
        let public_app_url =
            scan.required("PUBLIC_APP_URL", |v| parse_public_app_url(v, telegram_env));
        let admin_telegram_ids = scan.optional("ADMIN_TELEGRAM_IDS", Vec::new(), parse_admin_ids);
        let static_dir = scan.optional("STATIC_DIR", None, |v| Ok(Some(PathBuf::from(v))));
        let content_dir = scan.required("CONTENT_DIR", |v| Ok(PathBuf::from(v)));
        let database_path = scan.required("DATABASE_PATH", |v| Ok(PathBuf::from(v)));
        let listen_addr = scan.optional(
            "LISTEN_ADDR",
            SocketAddr::from(([127, 0, 0, 1], 8787)),
            |v| {
                v.parse()
                    .map_err(|_| "must be a socket address such as 127.0.0.1:8787")
            },
        );

        // The placeholder secrets are public (committed in .env.example): with them anyone can sign initData, mint
        // session tokens and forge webhook updates. They may run only where nobody else can reach the app.
        let unreachable = telegram_env == Some(TelegramEnv::Test)
            && public_app_url.as_deref().is_some_and(host_is_local);
        if !unreachable {
            if bot_token.as_deref() == Some(PLACEHOLDER_BOT_TOKEN) {
                scan.fail("BOT_TOKEN", PLACEHOLDER);
            }
            if webhook_secret.as_deref() == Some(PLACEHOLDER_WEBHOOK_SECRET) {
                scan.fail("WEBHOOK_SECRET", PLACEHOLDER);
            }
            if token_key.is_some() && token_key == parse_token_key(PLACEHOLDER_TOKEN_KEY_HEX).ok() {
                scan.fail("TOKEN_KEY", PLACEHOLDER);
            }
        }

        let (
            Some(bot_token),
            Some(webhook_secret),
            Some(token_key),
            Some(token_ttl_secs),
            Some(initdata_max_age_secs),
            Some(telegram_env),
            Some(public_app_url),
            Some(admin_telegram_ids),
            Some(static_dir),
            Some(content_dir),
            Some(database_path),
            Some(listen_addr),
        ) = (
            bot_token,
            webhook_secret,
            token_key,
            token_ttl_secs,
            initdata_max_age_secs,
            telegram_env,
            public_app_url,
            admin_telegram_ids,
            static_dir,
            content_dir,
            database_path,
            listen_addr,
        )
        else {
            return Err(ConfigError {
                problems: scan.problems,
            });
        };
        // Every `None` above recorded a problem; a placeholder problem leaves its value `Some`.
        if !scan.problems.is_empty() {
            return Err(ConfigError {
                problems: scan.problems,
            });
        }
        Ok(Config {
            bot_token,
            webhook_secret,
            token_key,
            token_ttl_secs,
            initdata_max_age_secs,
            public_app_url,
            admin_telegram_ids,
            static_dir,
            content_dir,
            database_path,
            telegram_env,
            listen_addr,
        })
    }
}

const PLACEHOLDER: ProblemKind = ProblemKind::Invalid(
    "is the committed .env.example placeholder; set a real secret (placeholders run only with TELEGRAM_ENV=test \
     and a localhost, loopback or .invalid PUBLIC_APP_URL)",
);

/// Reads variables through the lookup and collects every problem; nothing stops the scan.
struct Scan<F> {
    get: F,
    problems: Vec<ConfigProblem>,
}

impl<F: Fn(&str) -> Option<String>> Scan<F> {
    fn fail(&mut self, var: &'static str, kind: ProblemKind) {
        self.problems.push(ConfigProblem { var, kind });
    }

    /// The value of `var`, or `None` when it is unset or empty.
    fn value(&self, var: &str) -> Option<String> {
        (self.get)(var).filter(|v| !v.is_empty())
    }

    /// A required variable; `None` (with a recorded problem) when it is unset or breaks its rule.
    fn required<T>(
        &mut self,
        var: &'static str,
        parse: impl FnOnce(&str) -> Result<T, &'static str>,
    ) -> Option<T> {
        match self.value(var) {
            None => {
                self.fail(var, ProblemKind::Missing);
                None
            }
            Some(v) => self.parsed(var, &v, parse),
        }
    }

    /// An optional variable; `default` when unset, `None` (with a recorded problem) when it breaks its rule.
    fn optional<T>(
        &mut self,
        var: &'static str,
        default: T,
        parse: impl FnOnce(&str) -> Result<T, &'static str>,
    ) -> Option<T> {
        match self.value(var) {
            None => Some(default),
            Some(v) => self.parsed(var, &v, parse),
        }
    }

    fn parsed<T>(
        &mut self,
        var: &'static str,
        value: &str,
        parse: impl FnOnce(&str) -> Result<T, &'static str>,
    ) -> Option<T> {
        match parse(value) {
            Ok(parsed) => Some(parsed),
            Err(reason) => {
                self.fail(var, ProblemKind::Invalid(reason));
                None
            }
        }
    }
}

fn parse_webhook_secret(v: &str) -> Result<String, &'static str> {
    // Telegram's own rule for setWebhook's secret_token.
    let charset = v
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-');
    if charset && v.len() <= 256 {
        Ok(v.to_owned())
    } else {
        Err("must be 1-256 characters of A-Z a-z 0-9 _ -")
    }
}

fn parse_token_key(v: &str) -> Result<[u8; 32], &'static str> {
    let mut key = [0u8; 32];
    hex::decode_to_slice(v, &mut key)
        .map_err(|_| "must be exactly 64 hex characters (32 bytes)")?;
    Ok(key)
}

fn int_in(v: &str, range: RangeInclusive<i64>) -> Option<i64> {
    v.parse().ok().filter(|n| range.contains(n))
}

fn parse_telegram_env(v: &str) -> Result<TelegramEnv, &'static str> {
    match v {
        "prod" => Ok(TelegramEnv::Prod),
        "test" => Ok(TelegramEnv::Test),
        _ => Err("must be \"prod\" or \"test\""),
    }
}

fn parse_public_app_url(v: &str, env: Option<TelegramEnv>) -> Result<String, &'static str> {
    // Only Telegram's test environment accepts Mini App links without TLS.
    let (scheme_ok, rule) = if env == Some(TelegramEnv::Test) {
        (
            v.starts_with("https://") || v.starts_with("http://"),
            "must be an http:// or https:// URL with a host",
        )
    } else {
        (
            v.starts_with("https://"),
            "must be an https:// URL with a host",
        )
    };
    if scheme_ok && url_authority(v).is_some_and(|a| !a.is_empty()) {
        Ok(v.to_owned())
    } else {
        Err(rule)
    }
}

/// The authority of an `http(s)://` URL: the text between the scheme and the first `/`, `?` or `#`.
fn url_authority(url: &str) -> Option<&str> {
    let rest = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))?;
    rest.split(['/', '?', '#']).next()
}

/// Whether only this machine can reach the URL's host: `localhost`, `*.localhost`, a loopback address, or the
/// never-resolving `*.invalid` (RFC 6761). Anything unusual (userinfo, an unclosed IPv6 bracket) counts as
/// reachable, so the guard errs towards refusing a placeholder.
fn host_is_local(url: &str) -> bool {
    let Some(authority) = url_authority(url) else {
        return false;
    };
    if authority.contains('@') {
        return false;
    }
    let host = match authority.strip_prefix('[') {
        Some(bracketed) => match bracketed.split_once(']') {
            Some((ip, _)) => ip,
            None => return false,
        },
        None => authority
            .split_once(':')
            .map_or(authority, |(host, _)| host),
    };
    let host = host.to_ascii_lowercase();
    host == "localhost"
        || host.ends_with(".localhost")
        || host.ends_with(".invalid")
        || host.parse::<IpAddr>().is_ok_and(|ip| ip.is_loopback())
}

fn parse_admin_ids(v: &str) -> Result<Vec<i64>, &'static str> {
    v.split(',')
        .map(|id| id.trim().parse::<i64>().ok().filter(|n| *n > 0))
        .collect::<Option<Vec<_>>>()
        .ok_or("must be comma-separated positive integers")
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;
    use std::collections::{BTreeMap, BTreeSet};

    use super::*;

    const ENV_EXAMPLE: &str = include_str!("../../.env.example");

    /// The uncommented `KEY=VALUE` lines of `.env.example`, and the lines that are neither.
    fn env_example() -> (BTreeMap<String, String>, Vec<String>) {
        let mut vars = BTreeMap::new();
        let mut malformed = Vec::new();
        for line in ENV_EXAMPLE.lines().map(|l| l.trim_end_matches('\r')) {
            if line.trim().is_empty() || line.trim_start().starts_with('#') {
                continue;
            }
            match line.split_once('=') {
                Some((k, v)) => {
                    vars.insert(k.to_owned(), v.to_owned());
                }
                None => malformed.push(line.to_owned()),
            }
        }
        (vars, malformed)
    }

    /// A complete valid lookup whose secrets are not the placeholders.
    fn base() -> BTreeMap<String, String> {
        [
            ("BOT_TOKEN", "123456:base-bot-token".to_owned()),
            ("WEBHOOK_SECRET", "base_webhook-Secret-42".to_owned()),
            ("TOKEN_KEY", "ab".repeat(32)),
            ("PUBLIC_APP_URL", "https://example.invalid/".to_owned()),
            ("CONTENT_DIR", "content".to_owned()),
            ("DATABASE_PATH", "server.db".to_owned()),
            ("TELEGRAM_ENV", "test".to_owned()),
        ]
        .into_iter()
        .map(|(k, v)| (k.to_owned(), v))
        .collect()
    }

    fn with(changes: &[(&str, &str)]) -> BTreeMap<String, String> {
        let mut map = base();
        for (k, v) in changes {
            map.insert((*k).to_owned(), (*v).to_owned());
        }
        map
    }

    fn placeholders(changes: &[(&str, &str)]) -> BTreeMap<String, String> {
        let mut all = vec![
            ("BOT_TOKEN", PLACEHOLDER_BOT_TOKEN),
            ("WEBHOOK_SECRET", PLACEHOLDER_WEBHOOK_SECRET),
            ("TOKEN_KEY", PLACEHOLDER_TOKEN_KEY_HEX),
        ];
        all.extend_from_slice(changes);
        with(&all)
    }

    fn load(map: &BTreeMap<String, String>) -> Result<Config, ConfigError> {
        Config::from_lookup(|k| map.get(k).cloned())
    }

    fn problems(map: &BTreeMap<String, String>) -> Vec<ConfigProblem> {
        match load(map) {
            Ok(_) => Vec::new(),
            Err(e) => e.problems,
        }
    }

    /// `None` when the lookup loads; otherwise what came back instead (an `Err` with no problems included).
    fn not_loaded(map: &BTreeMap<String, String>) -> Option<String> {
        load(map).err().map(|e| format!("Err {:?}", e.problems))
    }

    fn vars(problems: &[ConfigProblem]) -> BTreeSet<&'static str> {
        problems.iter().map(|p| p.var).collect()
    }

    #[test]
    fn config_env_example_is_complete_and_valid() {
        let (file, malformed) = env_example();
        let mut failures: Vec<String> = malformed
            .iter()
            .map(|l| format!("malformed line: {l}"))
            .collect();
        let asked = RefCell::new(BTreeSet::new());
        let result = Config::from_lookup(|k| {
            asked.borrow_mut().insert(k.to_owned());
            file.get(k).cloned()
        });
        if let Err(e) = &result {
            failures.push(format!("expected Ok, got Err: {e}"));
        }
        let asked = asked.into_inner();
        let in_file: BTreeSet<String> = file.keys().cloned().collect();
        for k in asked.difference(&in_file) {
            failures.push(format!("read by Config but absent from .env.example: {k}"));
        }
        for k in in_file.difference(&asked) {
            failures.push(format!("in .env.example but never read by Config: {k}"));
        }
        // The placeholder guard matches these exact values, so the file must hold them.
        for (k, want) in [
            ("BOT_TOKEN", PLACEHOLDER_BOT_TOKEN),
            ("WEBHOOK_SECRET", PLACEHOLDER_WEBHOOK_SECRET),
            ("TOKEN_KEY", PLACEHOLDER_TOKEN_KEY_HEX),
        ] {
            if file.get(k).map(String::as_str) != Some(want) {
                failures.push(format!(
                    "{k} in .env.example is not the PLACEHOLDER_ constant"
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

    #[test]
    fn config_defaults_applied() {
        let cfg = match load(&base()) {
            Ok(cfg) => cfg,
            Err(e) => panic!("expected Ok, got Err: {e}"),
        };
        let mut failures = Vec::new();
        if cfg.token_ttl_secs != 1800 {
            failures.push(format!(
                "token_ttl_secs: expected 1800, got {}",
                cfg.token_ttl_secs
            ));
        }
        if cfg.initdata_max_age_secs != 86400 {
            failures.push(format!(
                "initdata_max_age_secs: expected 86400, got {}",
                cfg.initdata_max_age_secs
            ));
        }
        if cfg.listen_addr != SocketAddr::from(([127, 0, 0, 1], 8787)) {
            failures.push(format!(
                "listen_addr: expected 127.0.0.1:8787, got {}",
                cfg.listen_addr
            ));
        }
        if cfg.static_dir.is_some() {
            failures.push(format!(
                "static_dir: expected None, got {:?}",
                cfg.static_dir
            ));
        }
        if !cfg.admin_telegram_ids.is_empty() {
            failures.push(format!(
                "admin_telegram_ids: expected [], got {:?}",
                cfg.admin_telegram_ids
            ));
        }
        assert!(
            failures.is_empty(),
            "{} failures:\n{}",
            failures.len(),
            failures.join("\n")
        );
    }

    #[test]
    fn config_reports_every_problem() {
        let mut failures = Vec::new();

        // (a) Nothing set: exactly the seven required variables, each missing, in one error.
        let got = problems(&BTreeMap::new());
        let required = BTreeSet::from([
            "BOT_TOKEN",
            "WEBHOOK_SECRET",
            "TOKEN_KEY",
            "PUBLIC_APP_URL",
            "CONTENT_DIR",
            "DATABASE_PATH",
            "TELEGRAM_ENV",
        ]);
        if got.len() != 7
            || vars(&got) != required
            || got.iter().any(|p| p.kind != ProblemKind::Missing)
        {
            failures.push(format!(
                "empty lookup: expected 7 Missing problems {required:?}, got {} {got:?}",
                got.len()
            ));
        }

        // (b) One fault on a valid base: exactly one Invalid problem naming that variable.
        let long_secret = "s".repeat(257);
        let single: [(&str, &[(&str, &str)]); 13] = [
            ("TOKEN_TTL_SECS", &[("TOKEN_TTL_SECS", "899")]),
            ("TOKEN_TTL_SECS", &[("TOKEN_TTL_SECS", "3601")]),
            ("INITDATA_MAX_AGE_SECS", &[("INITDATA_MAX_AGE_SECS", "0")]),
            (
                "INITDATA_MAX_AGE_SECS",
                &[("INITDATA_MAX_AGE_SECS", "86401")],
            ),
            (
                "TOKEN_KEY",
                &[("TOKEN_KEY", &PLACEHOLDER_TOKEN_KEY_HEX[1..])],
            ),
            (
                "TOKEN_KEY",
                &[(
                    "TOKEN_KEY",
                    "zz0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
                )],
            ),
            ("TELEGRAM_ENV", &[("TELEGRAM_ENV", "staging")]),
            (
                "PUBLIC_APP_URL",
                &[
                    ("PUBLIC_APP_URL", "http://example.invalid/"),
                    ("TELEGRAM_ENV", "prod"),
                ],
            ),
            ("PUBLIC_APP_URL", &[("PUBLIC_APP_URL", "https://")]),
            ("WEBHOOK_SECRET", &[("WEBHOOK_SECRET", "has space")]),
            (
                "WEBHOOK_SECRET",
                &[("WEBHOOK_SECRET", long_secret.as_str())],
            ),
            ("ADMIN_TELEGRAM_IDS", &[("ADMIN_TELEGRAM_IDS", "1,x")]),
            ("LISTEN_ADDR", &[("LISTEN_ADDR", "nope")]),
        ];
        for (var, changes) in single {
            let got = problems(&with(changes));
            let one = got.len() == 1
                && got[0].var == var
                && matches!(got[0].kind, ProblemKind::Invalid(_));
            if !one {
                failures.push(format!(
                    "{changes:?}: expected exactly one Invalid problem naming {var}, got {got:?}"
                ));
            }
        }

        // (c) Five faults at once: five problems, no early stop.
        let got = problems(&with(&[
            ("TOKEN_TTL_SECS", "899"),
            ("TOKEN_KEY", "not-hex"),
            ("WEBHOOK_SECRET", "has space"),
            ("ADMIN_TELEGRAM_IDS", "1,x"),
            ("LISTEN_ADDR", "nope"),
        ]));
        let five = BTreeSet::from([
            "TOKEN_TTL_SECS",
            "TOKEN_KEY",
            "WEBHOOK_SECRET",
            "ADMIN_TELEGRAM_IDS",
            "LISTEN_ADDR",
        ]);
        if got.len() != 5 || vars(&got) != five {
            failures.push(format!("five faults: expected {five:?}, got {got:?}"));
        }

        // (d) The edges of every range are accepted.
        let edge_secret = "s".repeat(256);
        let edges: [&[(&str, &str)]; 6] = [
            &[("TOKEN_TTL_SECS", "900")],
            &[("TOKEN_TTL_SECS", "3600")],
            &[("INITDATA_MAX_AGE_SECS", "1")],
            &[("WEBHOOK_SECRET", edge_secret.as_str())],
            &[("ADMIN_TELEGRAM_IDS", " 1 , 2 ")],
            &[("PUBLIC_APP_URL", "http://example.invalid/")],
        ];
        for changes in edges {
            if let Some(got) = not_loaded(&with(changes)) {
                failures.push(format!("{changes:?}: expected Ok, got {got}"));
            }
        }

        assert!(
            failures.is_empty(),
            "{} failures:\n{}",
            failures.len(),
            failures.join("\n")
        );
    }

    #[test]
    fn config_refuses_placeholder_secrets() {
        let mut failures = Vec::new();
        let all_three = BTreeSet::from(["BOT_TOKEN", "WEBHOOK_SECRET", "TOKEN_KEY"]);

        // Allowed: the test environment with a URL nobody but this machine can reach.
        for url in [
            "https://example.invalid/",
            "http://localhost:4173/",
            "http://127.0.0.1:8797/",
            "http://[::1]:8797/",
            "https://app.localhost/",
        ] {
            if let Some(got) = not_loaded(&placeholders(&[("PUBLIC_APP_URL", url)])) {
                failures.push(format!("test env, {url}: expected Ok, got {got}"));
            }
        }

        // Refused: prod, or a URL that others can reach.
        let refused: [(&str, &str); 7] = [
            ("prod", "https://example.invalid/"),
            ("test", "https://novel.trycloudflare.com/"),
            ("test", "http://192.168.1.10:8787/"),
            ("test", "http://localhost.evil.example/"),
            ("test", "http://127.0.0.1@evil.example/"),
            ("test", "https://example.invalid.evil.example/"),
            // `localhost:80` is userinfo and evil.example the host; without the `@` rule the text before the
            // colon would pass for the host.
            ("test", "http://localhost:80@evil.example/"),
        ];
        for (env, url) in refused {
            let got = problems(&placeholders(&[
                ("TELEGRAM_ENV", env),
                ("PUBLIC_APP_URL", url),
            ]));
            let ok = got.len() == 3
                && vars(&got) == all_three
                && got
                    .iter()
                    .all(|p| matches!(p.kind, ProblemKind::Invalid(_)));
            if !ok {
                failures.push(format!(
                    "{env}, {url}: expected the three placeholder secrets refused, got {got:?}"
                ));
            }
        }

        // Each secret is checked on its own; TOKEN_KEY by its bytes, so the upper-case spelling is the same key.
        let only_secret = problems(&with(&[
            ("WEBHOOK_SECRET", PLACEHOLDER_WEBHOOK_SECRET),
            ("PUBLIC_APP_URL", "https://novel.trycloudflare.com/"),
        ]));
        if vars(&only_secret) != BTreeSet::from(["WEBHOOK_SECRET"]) || only_secret.len() != 1 {
            failures.push(format!(
                "placeholder WEBHOOK_SECRET only: expected one problem, got {only_secret:?}"
            ));
        }
        let upper = PLACEHOLDER_TOKEN_KEY_HEX.to_ascii_uppercase();
        let only_key = problems(&with(&[
            ("TOKEN_KEY", upper.as_str()),
            ("TELEGRAM_ENV", "prod"),
        ]));
        if vars(&only_key) != BTreeSet::from(["TOKEN_KEY"]) || only_key.len() != 1 {
            failures.push(format!(
                "upper-case placeholder TOKEN_KEY in prod: expected one problem, got {only_key:?}"
            ));
        }

        // Control: real secrets in prod on a public URL.
        let real = with(&[
            ("TELEGRAM_ENV", "prod"),
            ("PUBLIC_APP_URL", "https://novel.example.com/"),
        ]);
        if let Some(got) = not_loaded(&real) {
            failures.push(format!("real secrets in prod: expected Ok, got {got}"));
        }

        assert!(
            failures.is_empty(),
            "{} failures:\n{}",
            failures.len(),
            failures.join("\n")
        );
    }

    #[test]
    fn config_secrets_never_printed() {
        let mut failures = Vec::new();
        let cfg = Config {
            bot_token: "BOTTOKEN-SENTINEL-1".to_owned(),
            webhook_secret: "WEBHOOK-SENTINEL-2".to_owned(),
            token_key: [0xab; 32],
            token_ttl_secs: 1800,
            initdata_max_age_secs: 86400,
            public_app_url: "https://example.invalid/".to_owned(),
            admin_telegram_ids: vec![1],
            static_dir: None,
            content_dir: PathBuf::from("content"),
            database_path: PathBuf::from("server.db"),
            telegram_env: TelegramEnv::Test,
            listen_addr: SocketAddr::from(([127, 0, 0, 1], 8787)),
        };
        let printed = format!("{cfg:?}");
        let key_hex = "ab".repeat(32);
        let key_bytes = format!("{:?}", [0xab_u8; 32]);
        for secret in [
            "BOTTOKEN-SENTINEL-1",
            "WEBHOOK-SENTINEL-2",
            key_hex.as_str(),
            key_bytes.as_str(),
        ] {
            if printed.contains(secret) {
                failures.push(format!("Debug of Config prints a secret: {secret}"));
            }
        }

        let bad = "zz-TOKEN-KEY-SENTINEL";
        match load(&with(&[("TOKEN_KEY", bad)])) {
            Ok(_) => {
                failures.push("bad TOKEN_KEY: expected a TOKEN_KEY problem, got Ok".to_owned())
            }
            Err(e) => {
                if !e.problems.iter().any(|p| p.var == "TOKEN_KEY") {
                    failures.push(format!(
                        "bad TOKEN_KEY: expected a TOKEN_KEY problem, got {:?}",
                        e.problems
                    ));
                }
                if e.to_string().contains(bad) || format!("{e:?}").contains(bad) {
                    failures.push("ConfigError echoes the bad TOKEN_KEY value".to_owned());
                }
            }
        }

        assert!(
            failures.is_empty(),
            "{} failures:\n{}",
            failures.len(),
            failures.join("\n")
        );
    }
}
