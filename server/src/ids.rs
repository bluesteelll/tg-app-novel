//! Domain identifiers. Each id is its own type, so a user id cannot be passed where a product id is expected.
//!
//! The derive set is fixed here for every later lane (RULINGS 9 Q2): repositories bind `.0` / [`SaveSlot::as_str`],
//! and DTOs carry primitives, except `SaveSlot`, whose `TS` derive gives the generated client contract the slot union,
//! and `StoryId` (STORIES-PLAN "Rust types"). Each text id has one `parse`: the one grammar every loader and route
//! checks a file or wire string against.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// A Telegram user id. Telegram guarantees at most 52 significant bits, so it fits an `i64` and a JS number.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct UserId(pub i64);

/// An order id: `o_` + 32 hex chars; also the invoice payload.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct OrderId(pub String);

/// A catalog product id, e.g. `chapter:ch2`.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ProductId(pub String);

/// A `telegram_payment_charge_id`: the idempotency key of every grant and refund.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ChargeId(pub String);

/// A chapter id, `ch<N>`.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ChapterId(pub String);

impl ChapterId {
    /// The chapter id `s` spells: `^ch[1-9][0-9]*$` (STAGING-DSL `id/format`), so `ch01` and `ch0` are not chapters.
    pub fn parse(s: &str) -> Option<ChapterId> {
        is_chapter_id(s).then(|| ChapterId(s.to_owned()))
    }
}

/// A story id (STORIES-PLAN Y2): `^[a-z][a-z0-9_]{0,23}$`.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(transparent)]
pub struct StoryId(pub String);

impl StoryId {
    /// The story id `s` spells: a lower-case ASCII letter, then up to 23 lower-case letters, digits or `_`.
    pub fn parse(s: &str) -> Option<StoryId> {
        let ok = s.len() <= 24 && is_local_id(s);
        ok.then(|| StoryId(s.to_owned()))
    }
}

/// A chapter-qualified puzzle id `ch<N>.<local>` (PUZZLES-PLAN "Identifiers"): game-unique, because chapter ids are
/// unique across all stories. No `TS`: no DTO carries it (a puzzle status names its puzzle as a plain string).
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct PuzzleId(pub String);

impl PuzzleId {
    /// The puzzle id `s` spells: `^ch[1-9][0-9]*[.][a-z][a-z0-9_]*$`, the chapter grammar, one `.`, a local id.
    pub fn parse(s: &str) -> Option<PuzzleId> {
        let (chapter, local) = s.split_once('.')?;
        let ok = is_chapter_id(chapter) && is_local_id(local);
        ok.then(|| PuzzleId(s.to_owned()))
    }
}

/// `^ch[1-9][0-9]*$`.
fn is_chapter_id(s: &str) -> bool {
    let Some(number) = s.strip_prefix("ch") else {
        return false;
    };
    let mut digits = number.bytes();
    matches!(digits.next(), Some(b'1'..=b'9')) && digits.all(|b| b.is_ascii_digit())
}

/// `^[a-z][a-z0-9_]*$`: a chapter-local id (puzzle, room, item), and the shape of story ids and ending names.
pub(crate) fn is_local_id(s: &str) -> bool {
    let Some((first, rest)) = s.as_bytes().split_first() else {
        return false;
    };
    first.is_ascii_lowercase()
        && rest
            .iter()
            .all(|&b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
}

/// A save slot. The wire and database form is `auto`, `s1`, `s2` or `s3` (the `saves.slot` CHECK constraint).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
pub enum SaveSlot {
    /// The automatic save.
    Auto,
    /// Manual slot 1.
    S1,
    /// Manual slot 2.
    S2,
    /// Manual slot 3.
    S3,
}

impl SaveSlot {
    /// Every slot, in display order.
    pub const ALL: [SaveSlot; 4] = [SaveSlot::Auto, SaveSlot::S1, SaveSlot::S2, SaveSlot::S3];

    /// The wire and database form; equal to the serde form.
    pub fn as_str(self) -> &'static str {
        match self {
            SaveSlot::Auto => "auto",
            SaveSlot::S1 => "s1",
            SaveSlot::S2 => "s2",
            SaveSlot::S3 => "s3",
        }
    }

    /// The slot named by its wire form, e.g. a `/api/saves/{slot}` path segment.
    pub fn parse(s: &str) -> Option<SaveSlot> {
        SaveSlot::ALL.into_iter().find(|slot| slot.as_str() == s)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// serde, `as_str`, `parse` and the TS union agree on exactly `auto, s1, s2, s3`.
    #[test]
    fn save_slot_wire_strings() {
        let mut failures = Vec::new();
        let names: Vec<&str> = SaveSlot::ALL.iter().map(|s| s.as_str()).collect();
        if names != ["auto", "s1", "s2", "s3"] {
            failures.push(format!(
                "as_str: expected [auto, s1, s2, s3], got {names:?}"
            ));
        }
        for slot in SaveSlot::ALL {
            let json = serde_json::to_string(&slot).unwrap();
            if json != format!("\"{}\"", slot.as_str()) {
                failures.push(format!(
                    "serde {slot:?}: got {json}, as_str {:?}",
                    slot.as_str()
                ));
            }
            let back: Result<SaveSlot, _> = serde_json::from_str(&json);
            if back.as_ref().ok() != Some(&slot) {
                failures.push(format!("serde round trip {slot:?}: got {back:?}"));
            }
            if SaveSlot::parse(slot.as_str()) != Some(slot) {
                failures.push(format!("parse({:?}): expected {slot:?}", slot.as_str()));
            }
        }
        for bad in ["s4", "", "Auto", "S1"] {
            if let Some(slot) = SaveSlot::parse(bad) {
                failures.push(format!("parse({bad:?}): expected None, got {slot:?}"));
            }
        }
        let ts = SaveSlot::inline(&ts_rs::Config::default());
        if ts != r#""auto" | "s1" | "s2" | "s3""# {
            failures.push(format!("TS union: got {ts}"));
        }
        report(&failures);
    }

    fn report(failures: &[String]) {
        assert!(
            failures.is_empty(),
            "{} failures:\n{}",
            failures.len(),
            failures.join("\n")
        );
    }

    /// Every `ok` input parses to itself, every `bad` one to `None`.
    fn grammar_cases<T: std::fmt::Debug + PartialEq>(
        name: &str,
        parse: fn(&str) -> Option<T>,
        wrap: fn(String) -> T,
        ok: &[&str],
        bad: &[&str],
    ) -> Vec<String> {
        let mut failures = Vec::new();
        for &s in ok {
            let got = parse(s);
            if got != Some(wrap(s.to_owned())) {
                failures.push(format!("{name}::parse({s:?}): expected Some, got {got:?}"));
            }
        }
        for &s in bad {
            if let Some(got) = parse(s) {
                failures.push(format!("{name}::parse({s:?}): expected None, got {got:?}"));
            }
        }
        failures
    }

    /// `^[a-z][a-z0-9_]{0,23}$`; the newtype's TS type is a plain `string`.
    #[test]
    fn story_id_grammar() {
        let longest = format!("a{}", "b".repeat(23));
        let too_long = format!("a{}", "b".repeat(24));
        let mut failures = grammar_cases(
            "StoryId",
            StoryId::parse,
            StoryId,
            &["manor", "tide", "a", "a_1", "a9", longest.as_str()],
            &[
                "",
                "Manor",
                "1a",
                "_a",
                "a-b",
                "a.b",
                "a b",
                too_long.as_str(),
                "\u{e9}",
                "a\u{e9}",
            ],
        );
        let ts = StoryId::inline(&ts_rs::Config::default());
        if ts != "string" {
            failures.push(format!("TS type: expected string, got {ts}"));
        }
        report(&failures);
    }

    /// `^ch[1-9][0-9]*[.][a-z][a-z0-9_]*$`: the cases of the `puzzle_progress` id-shape CHECK (PUZZLES-PLAN SQL).
    #[test]
    fn puzzle_id_grammar() {
        let failures = grammar_cases(
            "PuzzleId",
            PuzzleId::parse,
            PuzzleId,
            &["ch1.drawer", "ch12.a_b9", "ch10.a", "ch2.cabinet"],
            &[
                "",
                "ch0.a",
                "ch01.a",
                "ch1x.a",
                "ch1.a.b",
                "ch1.a-b",
                "ch1.",
                "ch1.A",
                "ch1.\u{e9}",
                "ch1.1a",
                "ch1._a",
                ".a",
                "ch1",
                "drawer",
                "ch.a",
                "Ch1.a",
                "ch1.a ",
            ],
        );
        report(&failures);
    }

    /// `^ch[1-9][0-9]*$` (STAGING-DSL `id/format`).
    #[test]
    fn chapter_id_grammar() {
        let failures = grammar_cases(
            "ChapterId",
            ChapterId::parse,
            ChapterId,
            &["ch1", "ch10", "ch2", "ch909"],
            &[
                "",
                "ch0",
                "ch01",
                "Ch1",
                "ch",
                "ch1a",
                "ch-1",
                "ch 1",
                "c1",
                "1",
                "ch1.a",
                "ch\u{663}",
            ],
        );
        report(&failures);
    }
}
