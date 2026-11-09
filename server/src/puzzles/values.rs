//! Per-player puzzle values (per-player §3.2): a puzzle's domain as the server holds it, one uniform draw from it, and
//! the renderer of the `$code(..)` placeholders that show a drawn value (§5.1). Pure apart from [`os_rng`]: no clock,
//! no database.
//!
//! Principle 0 and the log rule (§3.1 "Log redaction", m12): a drawn value belongs to one player, and a domain's
//! excluded tuples are the content's. No type here derives `Debug` over either or implements `Serialize`, and no
//! error carries one, so neither reaches a log line or a response by accident.

use std::fmt;

use serde::Deserialize;
use sha2::{Digest, Sha256};

use crate::ids::PuzzleKey;
use crate::puzzles::MAX_ANSWER_LEN;

/// The fewest values a per-player domain may hold (RULINGS 123 O1; synthesis §4.6).
pub const ENTROPY_FLOOR: u64 = 1_000;

/// The least share of the position product a domain may hold, as (numerator, denominator), so rejection ends fast:
/// at most 16 tuples are expected per draw.
pub const MIN_ACCEPTANCE: (u64, u64) = (1, 16);

/// Rejections before a draw gives up: whole tuples, and one position's u32s in a row (unreachable with
/// [`MIN_ACCEPTANCE`] and the OS source: p <= (15/16)^4096 ~ e^-264).
pub const DRAW_MAX_ROUNDS: u32 = 4_096;

/// The largest `answerMax` of an all-distinct domain: its size is counted over a bitmask of the values used.
const DISTINCT_MAX_VALUE: u16 = 15;

/// The largest `answerLen` of an all-distinct domain (65,536 masks x 16 positions, once at load).
const DISTINCT_MAX_LEN: usize = 16;

/// The opening of a placeholder (§5.1).
const PLACEHOLDER_OPEN: &str = "$code(";

/// A domain as the content's build writes it (`ServerDomain`, per-player §4), before [`Domain::parse`] checks it. No
/// `Debug`: it holds the excluded tuples.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DomainFile {
    /// One inclusive range `[lo, hi]` per answer entry.
    pub positions: Vec<(u16, u16)>,
    /// Whether the entries of a value are all distinct.
    pub distinct: bool,
    /// Tuples no value may be (the build has already added the type's `startShown`, E-P9).
    pub exclude: Vec<Vec<u16>>,
}

/// 16 lower-case hex: the first 8 bytes of SHA-256 over the canonical encoding `"pv1|"` + `"lo-hi"` per position
/// joined by `","` + `"|"` + `"0"` / `"1"` (distinct) + `"|"` + the excludes, deduplicated and in numeric order, each
/// `"a.b.c"`, joined by `","`. The order an author lists excludes in does not move it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DomainHash(pub String);

/// A per-player puzzle's domain as the server holds it: per-position inclusive ranges, optional all-distinct entries
/// and excluded tuples, with its size and hash. Only [`Domain::parse`] makes one, so `lo <= hi <= answerMax` holds at
/// every position. Its `Debug` prints the hash only (m12).
pub struct Domain {
    positions: Vec<(u16, u16)>,
    distinct: bool,
    /// Deduplicated and sorted: [`Domain::contains`] searches it, and the hash reads it in this order.
    exclude: Vec<Vec<u16>>,
    size: u64,
    hash: DomainHash,
}

/// Why a domain is refused at load. No variant carries a value or an excluded tuple.
#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub enum DomainError {
    /// The structure does not fit the puzzle; the text names the rule.
    #[error("{0}")]
    Shape(&'static str),
    /// Fewer values than [`ENTROPY_FLOOR`].
    #[error("{size} values, under {ENTROPY_FLOOR}")]
    Floor {
        /// The domain's size, saturated to `u64`.
        size: u64,
    },
    /// Under [`MIN_ACCEPTANCE`] of the position product: a rejection draw would take too long.
    #[error("too sparse to draw")]
    Sparse,
}

/// Why a draw gave up.
#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub enum DrawError {
    /// [`DRAW_MAX_ROUNDS`] rejections in a row: the random source is broken (never with [`os_rng`]).
    #[error("no value after {DRAW_MAX_ROUNDS} rounds")]
    Exhausted,
}

impl Domain {
    /// The domain `raw` describes for a puzzle of `answer_len` entries, each at most `answer_max`, checked in order:
    /// the structure (`answer_len` in `1..=MAX_ANSWER_LEN`, one range per entry, `lo <= hi <= answer_max`, excludes of
    /// `answer_len` entries each at most `answer_max`, `distinct` only with `answer_max <= 15` and `answer_len <= 16`),
    /// then the size against [`ENTROPY_FLOOR`], then the share of the position product against [`MIN_ACCEPTANCE`].
    /// The size is the product of the range sizes (or, all-distinct, the count of distinct tuples in them), minus the
    /// excludes that lie in the domain, in u128 and saturating.
    pub fn parse(
        raw: DomainFile,
        answer_len: usize,
        answer_max: u16,
    ) -> Result<Domain, DomainError> {
        let DomainFile {
            positions,
            distinct,
            mut exclude,
        } = raw;
        check_shape(&positions, distinct, &exclude, answer_len, answer_max)?;
        exclude.sort_unstable();
        exclude.dedup();
        let product = positions
            .iter()
            .fold(1u128, |p, &(lo, hi)| p.saturating_mul(range_size(lo, hi)));
        let tuples = if distinct {
            distinct_tuples(&positions)
        } else {
            product
        };
        let excluded = exclude
            .iter()
            .filter(|e| in_ranges(&positions, distinct, e))
            .count();
        let size = tuples.saturating_sub(u128::try_from(excluded).unwrap_or(u128::MAX));
        let size_u64 = u64::try_from(size).unwrap_or(u64::MAX);
        if size < u128::from(ENTROPY_FLOOR) {
            return Err(DomainError::Floor { size: size_u64 });
        }
        let (num, den) = MIN_ACCEPTANCE;
        if size.saturating_mul(u128::from(den)) < product.saturating_mul(u128::from(num)) {
            return Err(DomainError::Sparse);
        }
        let hash = canonical_hash(&positions, distinct, &exclude);
        Ok(Domain {
            positions,
            distinct,
            exclude,
            size: size_u64,
            hash,
        })
    }

    /// `v` lies in the domain: one entry per position, each in its range, all distinct when required, not excluded.
    pub fn contains(&self, v: &[u16]) -> bool {
        in_ranges(&self.positions, self.distinct, v)
            && self
                .exclude
                .binary_search_by(|e| e.as_slice().cmp(v))
                .is_err()
    }

    /// The domain's hash: the identity a stored value records (`puzzle_values.domain`).
    pub fn hash(&self) -> &DomainHash {
        &self.hash
    }

    /// How many values the domain holds, saturated to `u64`.
    pub fn size(&self) -> u64 {
        self.size
    }
}

impl fmt::Debug for Domain {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Domain")
            .field("hash", &self.hash.0)
            .finish()
    }
}

/// The structure rules of [`Domain::parse`], each refusal a fixed text.
fn check_shape(
    positions: &[(u16, u16)],
    distinct: bool,
    exclude: &[Vec<u16>],
    answer_len: usize,
    answer_max: u16,
) -> Result<(), DomainError> {
    let refusal = if answer_len == 0 || answer_len > MAX_ANSWER_LEN {
        Some("answerLen is outside 1..=MAX_ANSWER_LEN")
    } else if positions.len() != answer_len {
        Some("positions do not match answerLen")
    } else if positions.iter().any(|&(lo, hi)| lo > hi) {
        Some("a position's lo is above its hi")
    } else if positions.iter().any(|&(_, hi)| hi > answer_max) {
        Some("a position's hi is above answerMax")
    } else if exclude.iter().any(|e| e.len() != answer_len) {
        Some("an exclude does not match answerLen")
    } else if exclude.iter().flatten().any(|&x| x > answer_max) {
        Some("an exclude entry is above answerMax")
    } else if distinct && (answer_max > DISTINCT_MAX_VALUE || answer_len > DISTINCT_MAX_LEN) {
        Some("distinct needs answerMax <= 15 and answerLen <= 16")
    } else {
        None
    };
    refusal.map_or(Ok(()), |rule| Err(DomainError::Shape(rule)))
}

/// The values of `[lo, hi]`; `lo <= hi` after [`check_shape`].
fn range_size(lo: u16, hi: u16) -> u128 {
    u128::from(hi.saturating_sub(lo)) + 1
}

/// `v` has one entry per position, each in its range, and all distinct when `distinct`.
fn in_ranges(positions: &[(u16, u16)], distinct: bool, v: &[u16]) -> bool {
    v.len() == positions.len()
        && v.iter()
            .zip(positions)
            .all(|(&x, &(lo, hi))| lo <= x && x <= hi)
        && (!distinct || all_distinct(v))
}

fn all_distinct(v: &[u16]) -> bool {
    v.iter()
        .enumerate()
        .all(|(i, x)| !v.iter().skip(i + 1).any(|y| y == x))
}

/// The tuples of the ranges whose entries are all distinct: a count over positions, keyed by the bitmask of the
/// values used so far. Every value is at most [`DISTINCT_MAX_VALUE`] after [`check_shape`], so 2^16 masks hold them.
fn distinct_tuples(positions: &[(u16, u16)]) -> u128 {
    const MASKS: usize = 1 << (DISTINCT_MAX_VALUE + 1);
    let mut ways = vec![0u128; MASKS];
    if let Some(empty) = ways.first_mut() {
        *empty = 1;
    }
    for &(lo, hi) in positions {
        let mut next = vec![0u128; MASKS];
        for (mask, &count) in ways.iter().enumerate().filter(|(_, count)| **count > 0) {
            for v in lo..=hi {
                let bit = 1usize << v;
                if mask & bit == 0
                    && let Some(slot) = next.get_mut(mask | bit)
                {
                    *slot = slot.saturating_add(count);
                }
            }
        }
        ways = next;
    }
    ways.iter()
        .fold(0u128, |sum, &count| sum.saturating_add(count))
}

/// [`DomainHash`] of the canonical encoding; `exclude` is already deduplicated and sorted.
fn canonical_hash(positions: &[(u16, u16)], distinct: bool, exclude: &[Vec<u16>]) -> DomainHash {
    let ranges: Vec<String> = positions
        .iter()
        .map(|(lo, hi)| format!("{lo}-{hi}"))
        .collect();
    let excludes: Vec<String> = exclude
        .iter()
        .map(|e| e.iter().map(u16::to_string).collect::<Vec<_>>().join("."))
        .collect();
    let encoding = format!(
        "pv1|{}|{}|{}",
        ranges.join(","),
        if distinct { "1" } else { "0" },
        excludes.join(",")
    );
    let digest = Sha256::digest(encoding.as_bytes());
    DomainHash(hex::encode(
        digest.iter().take(8).copied().collect::<Vec<u8>>(),
    ))
}

/// One uniform value of `d`: each position uniform in its range by rejection on u32 (`r` is rejected when
/// `r >= 2^32 - 2^32 % n`; never `% n` alone, which is biased), the whole tuple drawn again when it is not distinct
/// (if required) or excluded. A position rejected [`DRAW_MAX_ROUNDS`] times in a row, or as many whole tuples, is
/// [`DrawError::Exhausted`], so a draw ends for any `rng`.
pub fn draw(d: &Domain, rng: &mut impl FnMut() -> u32) -> Result<Vec<u16>, DrawError> {
    for _ in 0..DRAW_MAX_ROUNDS {
        let mut v = Vec::with_capacity(d.positions.len());
        for &(lo, hi) in &d.positions {
            v.push(uniform(lo, hi, rng)?);
        }
        if d.contains(&v) {
            return Ok(v);
        }
    }
    Err(DrawError::Exhausted)
}

/// One uniform value of `[lo, hi]` by rejection; `lo <= hi` after [`Domain::parse`].
fn uniform(lo: u16, hi: u16, rng: &mut impl FnMut() -> u32) -> Result<u16, DrawError> {
    let n = u64::from(hi.saturating_sub(lo)) + 1;
    let span = 1u64 << 32;
    let zone = span - span % n;
    for _ in 0..DRAW_MAX_ROUNDS {
        let r = u64::from(rng());
        if r < zone {
            // Lossless: r % n < n <= 65,536, and lo + r % n <= hi.
            let offset = (r % n) as u16;
            return Ok(lo + offset);
        }
    }
    Err(DrawError::Exhausted)
}

/// The OS CSPRNG, 4 bytes per call through `getrandom::fill` (as `db/orders.rs`): no key to leak or rotate.
pub fn os_rng() -> impl FnMut() -> u32 {
    || {
        let mut bytes = [0u8; 4];
        getrandom::fill(&mut bytes).expect(
            "invariant: the OS random source works (ProcessPrng on Windows 10+ is documented never to fail)",
        );
        u32::from_le_bytes(bytes)
    }
}

/// `template` with `$code(<own>)` and `$code(<own>.<n>)` replaced from `value` (the grammar and join rule of §5.1):
/// the whole value in decimal, joined by `""` when `answer_max <= 9` and by `"-"` otherwise, or entry `n` (1-based,
/// `[1-9][0-9]?`, at most the value's length). Anything else stays verbatim (another puzzle, a malformed or
/// out-of-range index, an unclosed `$code(`): content's load rule refuses such texts, so this is defence only, and it
/// never reads another puzzle's value. Any other `$` is literal.
pub fn render(template: &str, own: &str, value: &[u16], answer_max: u16) -> String {
    let mut out = String::with_capacity(template.len());
    let mut rest = template;
    while let Some((before, inner)) = rest.split_once(PLACEHOLDER_OPEN) {
        out.push_str(before);
        match own_placeholder(inner, own, value, answer_max) {
            Some((text, after)) => {
                out.push_str(&text);
                rest = after;
            }
            None => {
                out.push_str(PLACEHOLDER_OPEN);
                rest = inner;
            }
        }
    }
    out.push_str(rest);
    out
}

/// The text of the placeholder whose body starts `inner` (after `$code(`), and the text after its `)`; `None` when
/// it is not one of `own`'s.
fn own_placeholder<'t>(
    inner: &'t str,
    own: &str,
    value: &[u16],
    answer_max: u16,
) -> Option<(String, &'t str)> {
    let (body, after) = inner.split_once(')')?;
    let text = match body.split_once('.') {
        None if body == own => {
            let joint = if answer_max <= 9 { "" } else { "-" };
            value
                .iter()
                .map(u16::to_string)
                .collect::<Vec<_>>()
                .join(joint)
        }
        Some((local, index)) if local == own => value.get(entry_index(index)? - 1)?.to_string(),
        _ => return None,
    };
    Some((text, after))
}

/// The 1-based index `s` spells: `[1-9][0-9]?`.
fn entry_index(s: &str) -> Option<usize> {
    let mut digits = s.bytes();
    let first = digits.next().filter(|b| (b'1'..=b'9').contains(b))?;
    let ones = usize::from(first - b'0');
    match (digits.next(), digits.next()) {
        (None, _) => Some(ones),
        (Some(d), None) if d.is_ascii_digit() => Some(ones * 10 + usize::from(d - b'0')),
        _ => None,
    }
}

/// One `puzzle_values` row of a user (per-player §3.1) without its `user_id`: the value drawn for the puzzle stored
/// under `puzzle`, and its run. Its `Debug` prints `value: <redacted>` (m12); it has no `Serialize`.
#[derive(Clone, PartialEq, Eq)]
pub struct ValueRow {
    /// The puzzle's storage key.
    pub puzzle: PuzzleKey,
    /// 1 at the first draw; +1 at each restart and each forced re-draw.
    pub run: i64,
    /// The wrong answers applied in this run.
    pub wrong: i64,
    /// When `value` was drawn, in unix seconds (server clock).
    pub issued_at: i64,
    /// The final wrong answer of this run; `None` while the run is live.
    pub spent_at: Option<i64>,
    /// The domain `value` was drawn in (or still fits).
    pub domain: DomainHash,
    /// The drawn value, one entry per answer position: the player's secret.
    pub value: Vec<u16>,
}

impl fmt::Debug for ValueRow {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ValueRow")
            .field("puzzle", &self.puzzle)
            .field("run", &self.run)
            .field("wrong", &self.wrong)
            .field("issued_at", &self.issued_at)
            .field("spent_at", &self.spent_at)
            .field("domain", &self.domain)
            .field("value", &format_args!("<redacted>"))
            .finish()
    }
}
