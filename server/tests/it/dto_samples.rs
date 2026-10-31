//! `client/src/api/fixtures/dto-samples.json` (K22): samples of every response body, serialized from the real Rust
//! DTOs, keyed by the TypeScript type name. The client's decoders are tested against this file, so a change of a
//! body's shape on the Rust side reaches the client's tests. Every optional field is sampled both absent (or null)
//! and present, and every value of the three wire unions at least once.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::value::RawValue;
use serde_json::{Map, Value};
use server::api::dto::{
    AttemptResponse, AuthResponse, ChapterPayload, CreateInvoiceResponse, EntitlementsResponse,
    HintView, OrderResponse, ProductDto, PutSaveResponse, PuzzleStatus, SaveFull, SaveListResponse,
    SaveSummary, UserDto, ts_bindings,
};
use server::db::orders::OrderStatus;
use server::error::{ApiErrorBody, ErrorCode};
use server::ids::{SaveSlot, StoryId};
use ts_rs::TS;

/// How to rewrite the file.
const REGENERATE: &str = "regenerate: cargo test -p server --test it dto_samples::write_dto_samples -- --ignored --exact";

/// The exported request bodies: the client only sends them, so it decodes none.
const REQUESTS: [&str; 4] = [
    "AuthRequest",
    "PutSaveRequest",
    "AttemptRequest",
    "CreateInvoiceRequest",
];

/// The exported types that only appear inside a sampled body, and are sampled there.
const NESTED: [&str; 8] = [
    "SaveSlot",
    "StoryId",
    "ErrorCode",
    "UserDto",
    "SaveSummary",
    "ProductDto",
    "HintView",
    "OrderStatus",
];

/// Every error code, each at its index in [`code_index`].
const ERROR_CODES: [ErrorCode; 18] = [
    ErrorCode::BadRequest,
    ErrorCode::InitdataInvalid,
    ErrorCode::InitdataExpired,
    ErrorCode::TokenMissing,
    ErrorCode::TokenInvalid,
    ErrorCode::TokenExpired,
    ErrorCode::NotEntitled,
    ErrorCode::NotFound,
    ErrorCode::UnknownProduct,
    ErrorCode::AlreadyOwned,
    ErrorCode::SaveConflict,
    ErrorCode::PayloadTooLarge,
    ErrorCode::TelegramUnavailable,
    ErrorCode::RateLimited,
    ErrorCode::HintUnavailable,
    ErrorCode::InsufficientBalance,
    ErrorCode::LimitReached,
    ErrorCode::Internal,
];

/// The index of `code` in [`ERROR_CODES`]: no wildcard arm, so a new code does not compile until it is sampled.
fn code_index(code: ErrorCode) -> usize {
    match code {
        ErrorCode::BadRequest => 0,
        ErrorCode::InitdataInvalid => 1,
        ErrorCode::InitdataExpired => 2,
        ErrorCode::TokenMissing => 3,
        ErrorCode::TokenInvalid => 4,
        ErrorCode::TokenExpired => 5,
        ErrorCode::NotEntitled => 6,
        ErrorCode::NotFound => 7,
        ErrorCode::UnknownProduct => 8,
        ErrorCode::AlreadyOwned => 9,
        ErrorCode::SaveConflict => 10,
        ErrorCode::PayloadTooLarge => 11,
        ErrorCode::TelegramUnavailable => 12,
        ErrorCode::RateLimited => 13,
        ErrorCode::HintUnavailable => 14,
        ErrorCode::InsufficientBalance => 15,
        ErrorCode::LimitReached => 16,
        ErrorCode::Internal => 17,
    }
}

/// Every order status, sampled in `OrderResponse`.
const ORDER_STATUSES: [OrderStatus; 4] = [
    OrderStatus::Created,
    OrderStatus::Checkout,
    OrderStatus::Paid,
    OrderStatus::Refunded,
];

/// The time of every sample.
const AT: i64 = 1_800_000_000;

/// `client/src/api/fixtures/dto-samples.json`, found from the server crate.
fn samples_path() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../client/src/api/fixtures/dto-samples.json")
}

/// `dto` as the server serializes it.
fn value<T: Serialize>(dto: &T) -> Value {
    serde_json::to_value(dto).unwrap()
}

/// A save envelope of the `manor` story in `slot`.
fn summary(slot: SaveSlot, rev: i64, line_id: Option<&str>) -> SaveSummary {
    SaveSummary {
        story_id: StoryId("manor".to_owned()),
        slot,
        rev,
        chapter_id: "ch1".to_owned(),
        story_version: "v1".to_owned(),
        line_id: line_id.map(str::to_owned),
        saved_at: AT,
        write_id: format!("w-{}", slot.as_str()),
    }
}

/// A raw JSON document.
fn raw(json: &str) -> Box<RawValue> {
    RawValue::from_string(json.to_owned()).unwrap()
}

/// Every sampled body, keyed by its TypeScript type name.
fn samples() -> Value {
    let mut map = Map::new();
    let mut put = |name: &str, samples: Vec<Value>| {
        map.insert(name.to_owned(), Value::Array(samples));
    };
    put(
        "AuthResponse",
        vec![
            value(&AuthResponse {
                token: "sample-session-token".to_owned(),
                expires_at: AT + 1800,
                user: UserDto {
                    id: 1001,
                    first_name: "Аня".to_owned(),
                    language_code: Some("ru".to_owned()),
                },
            }),
            value(&AuthResponse {
                token: "sample-session-token-2".to_owned(),
                expires_at: AT + 1800,
                user: UserDto {
                    id: 1002,
                    first_name: "Ben".to_owned(),
                    language_code: None,
                },
            }),
        ],
    );
    put(
        "SaveListResponse",
        vec![
            value(&SaveListResponse {
                slots: vec![
                    summary(SaveSlot::Auto, 3, Some("ch1.k1.l3")),
                    summary(SaveSlot::S1, 1, None),
                    summary(SaveSlot::S2, 2, Some("ch1.k2.l1")),
                    summary(SaveSlot::S3, 1, Some("ch1.k1.l1")),
                ],
            }),
            value(&SaveListResponse { slots: Vec::new() }),
        ],
    );
    put(
        "SaveFull",
        vec![value(&SaveFull {
            summary: summary(SaveSlot::Auto, 3, Some("ch1.k1.l3")),
            body: r#"{"inkState":{},"rev":3}"#.to_owned(),
        })],
    );
    put(
        "PutSaveResponse",
        vec![value(&PutSaveResponse {
            rev: 4,
            saved_at: AT,
        })],
    );
    put(
        "EntitlementsResponse",
        vec![value(&EntitlementsResponse {
            products: vec![
                ProductDto {
                    product_id: "chapter:ch2".to_owned(),
                    chapter_id: "ch2".to_owned(),
                    price_stars: 1,
                    owned: true,
                },
                ProductDto {
                    product_id: "chapter:ch4".to_owned(),
                    chapter_id: "ch4".to_owned(),
                    price_stars: 50,
                    owned: false,
                },
            ],
        })],
    );
    let (story, meta, assets, en, world) = (
        raw(r#"{"inkVersion":21,"root":[]}"#),
        raw(r#"{"storyVersion":"v1"}"#),
        raw(r#"{"assets":[]}"#),
        raw(r#"{"ch2.k1.l1":"The door is locked."}"#),
        raw(r#"{"rooms":[]}"#),
    );
    put(
        "ChapterPayload",
        [Some(&*world), None]
            .into_iter()
            .map(|world| {
                value(&ChapterPayload {
                    chapter_id: "ch2",
                    story_version: "v1",
                    story: &story,
                    meta: &meta,
                    assets: &assets,
                    en: &en,
                    world,
                })
            })
            .collect(),
    );
    put(
        "AttemptResponse",
        vec![
            value(&AttemptResponse {
                correct: true,
                solved: true,
            }),
            value(&AttemptResponse {
                correct: false,
                solved: false,
            }),
        ],
    );
    put(
        "PuzzleStatus",
        vec![value(&PuzzleStatus {
            puzzle_id: "ch1.drawer".to_owned(),
            solved: false,
            hints: vec![
                HintView {
                    tier: 1,
                    unlocked: true,
                    text: Some("Look under the rug.".to_owned()),
                },
                HintView {
                    tier: 2,
                    unlocked: false,
                    text: None,
                },
            ],
        })],
    );
    put(
        "CreateInvoiceResponse",
        vec![value(&CreateInvoiceResponse {
            order_id: "o_0123456789abcdef0123456789abcdef".to_owned(),
            invoice_url: "https://t.me/$sample-invoice".to_owned(),
        })],
    );
    put(
        "OrderResponse",
        ORDER_STATUSES
            .iter()
            .map(|&status| {
                value(&OrderResponse {
                    order_id: "o_0123456789abcdef0123456789abcdef".to_owned(),
                    product_id: "chapter:ch2".to_owned(),
                    status,
                })
            })
            .collect(),
    );
    let mut errors: Vec<Value> = ERROR_CODES
        .iter()
        .map(|&error| {
            value(&ApiErrorBody {
                error,
                current: None,
            })
        })
        .collect();
    errors.push(value(&ApiErrorBody {
        error: ErrorCode::SaveConflict,
        current: Some(summary(SaveSlot::S1, 2, Some("ch1.k2.l4"))),
    }));
    put("ApiErrorBody", errors);
    Value::Object(map)
}

/// The file's text: the samples as pretty JSON, LF, with a final newline.
fn samples_text() -> String {
    let mut text = serde_json::to_string_pretty(&samples()).unwrap();
    text.push('\n');
    text
}

/// The literals of a TypeScript string-literal union, `"a" | "b"`.
fn union_literals(ts: &str) -> BTreeSet<String> {
    ts.split(" | ")
        .map(|literal| literal.trim_matches('"').to_owned())
        .collect()
}

/// The serde names of `values`.
fn wire_names<T: Serialize>(values: &[T]) -> BTreeSet<String> {
    values
        .iter()
        .map(|v| value(v).as_str().unwrap_or_default().to_owned())
        .collect()
}

fn report(failures: &[String]) {
    assert!(
        failures.is_empty(),
        "{} failures:\n{}",
        failures.len(),
        failures.join("\n")
    );
}

/// The committed file equals what the DTOs serialize today, byte for byte; every type `ts_bindings()` exports is
/// sampled or listed as a request or a nested-only type (so a new body is red until it is sampled); every value of
/// the error-code, slot and order-status unions is sampled.
#[test]
#[allow(
    clippy::disallowed_methods,
    reason = "a sync test may read files; the lint guards async handlers"
)]
fn dto_samples_are_fresh() {
    let path = samples_path();
    let want = samples_text();
    let got = match std::fs::read_to_string(&path) {
        Ok(text) => text,
        Err(e) => panic!("cannot read {}: {e}\n{REGENERATE}", path.display()),
    };
    let mut failures = Vec::new();
    if got != want {
        let got_lines: Vec<&str> = got.split('\n').collect();
        let want_lines: Vec<&str> = want.split('\n').collect();
        let len = got_lines.len().max(want_lines.len());
        let at = (0..len)
            .find(|&i| got_lines.get(i) != want_lines.get(i))
            .unwrap_or(len);
        // The sample key the difference falls in: the nearest top-level `  "Name": [` line at or above it.
        let key = want_lines
            .iter()
            .take(at + 1)
            .rev()
            .find_map(|line| {
                line.strip_prefix("  \"")
                    .and_then(|rest| rest.strip_suffix("\": ["))
            })
            .unwrap_or("the file");
        failures.push(format!(
            "{} is stale in {key}; first difference at line {}:\n  file:      {:?}\n  generated: {:?}\n{REGENERATE}",
            path.display(),
            at + 1,
            got_lines.get(at),
            want_lines.get(at)
        ));
    }

    let samples = samples();
    let sampled: BTreeSet<&str> = samples
        .as_object()
        .map(|map| map.keys().map(String::as_str).collect())
        .unwrap_or_default();
    let bindings = ts_bindings();
    let exported: BTreeSet<&str> = bindings
        .lines()
        .filter_map(|line| line.strip_prefix("export type "))
        .filter_map(|rest| rest.split(' ').next())
        .collect();
    for name in &exported {
        if !sampled.contains(name) && !REQUESTS.contains(name) && !NESTED.contains(name) {
            failures.push(format!(
                "{name} has no sample: add one to dto_samples.rs, or list it in REQUESTS or NESTED"
            ));
        }
    }
    for name in sampled.iter().chain(&REQUESTS).chain(&NESTED) {
        if !exported.contains(name) {
            failures.push(format!(
                "{name} is sampled or listed but not exported by ts_bindings()"
            ));
        }
    }

    for (i, &code) in ERROR_CODES.iter().enumerate() {
        if code_index(code) != i {
            failures.push(format!(
                "ERROR_CODES[{i}] is {code:?}, indexed {}",
                code_index(code)
            ));
        }
    }
    let cfg = ts_rs::Config::default();
    for (union, ts, sampled) in [
        (
            "ErrorCode",
            ErrorCode::inline(&cfg),
            wire_names(&ERROR_CODES),
        ),
        (
            "SaveSlot",
            SaveSlot::inline(&cfg),
            wire_names(&SaveSlot::ALL),
        ),
        (
            "OrderStatus",
            OrderStatus::inline(&cfg),
            wire_names(&ORDER_STATUSES),
        ),
    ] {
        let literals = union_literals(&ts);
        if literals != sampled {
            failures.push(format!(
                "{union}: expected every union value sampled {literals:?}, got {sampled:?}"
            ));
        }
    }
    report(&failures);
}

/// Rewrites the samples file: `cargo test -p server --test it dto_samples::write_dto_samples -- --ignored --exact`.
#[test]
#[ignore = "writes client/src/api/fixtures/dto-samples.json; run by hand after a DTO change"]
fn write_dto_samples() {
    let path = samples_path();
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, samples_text()).unwrap();
}
