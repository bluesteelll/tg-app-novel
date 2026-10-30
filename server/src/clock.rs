//! The server's time source. Every timestamp is unix seconds; handlers read the time once per request from
//! `AppState::clock`, so tests can pin it.

use std::time::{SystemTime, UNIX_EPOCH};

/// A source of the current time in unix seconds.
pub trait Clock: Send + Sync {
    /// The current time, in unix seconds.
    fn now(&self) -> i64;
}

/// The operating system's clock: the production time source.
#[derive(Debug, Clone, Copy, Default)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> i64 {
        match SystemTime::now().duration_since(UNIX_EPOCH) {
            Ok(after) => i64::try_from(after.as_secs()).unwrap_or(i64::MAX),
            // A clock set before 1970: negative, so every freshness check fails instead of passing.
            Err(before) => i64::try_from(before.duration().as_secs()).map_or(i64::MIN, |s| -s),
        }
    }
}

/// A clock stuck at one instant, for tests. Immutable: a later time is a new state built with `with_clock`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FixedClock(pub i64);

impl Clock for FixedClock {
    fn now(&self) -> i64 {
        self.0
    }
}
