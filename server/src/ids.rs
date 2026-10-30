//! Domain identifiers. Each id is its own type, so a user id cannot be passed where a product id is expected.
//!
//! The derive set is fixed here for every later lane (RULINGS 9 Q2): repositories bind `.0` / [`SaveSlot::as_str`],
//! and DTOs carry primitives, except `SaveSlot`, whose `TS` derive gives the generated client contract the slot union.

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
        assert!(
            failures.is_empty(),
            "{} failures:\n{}",
            failures.len(),
            failures.join("\n")
        );
    }
}
