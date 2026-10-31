//! Request and response bodies of `/api`: JSON in camelCase.
//!
//! No `Debug` on the auth bodies, nor on the bodies that carry a save body: they hold raw initData, session tokens
//! and up to 256 KiB of player data, which are never logged.
//!
//! Every body derives `TS`: [`ts_bindings`] turns them into the client's `client/src/api/generated/api.ts`. Every
//! `i64` is `#[ts(type = "number")]`: ids and timestamps stay below 2^53, and ts-rs would otherwise say `bigint`.

use serde::{Deserialize, Serialize};
use serde_json::value::RawValue;
use ts_rs::TS;

use crate::error::{ApiErrorBody, ErrorCode};
use crate::ids::{SaveSlot, StoryId};

/// `POST /api/auth` request. Unknown fields (a client-sent `userId`, say) are ignored, never trusted.
#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AuthRequest {
    /// The raw `Telegram.WebApp.initData` query string.
    pub init_data: String,
}

/// `POST /api/auth` response.
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AuthResponse {
    /// The session token for `Authorization: Bearer`.
    pub token: String,
    /// When the token expires, in unix seconds.
    #[ts(type = "number")]
    pub expires_at: i64,
    /// The verified user.
    pub user: UserDto,
}

/// A user as the client sees it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct UserDto {
    /// The Telegram user id.
    #[ts(type = "number")]
    pub id: i64,
    /// The first name Telegram sent.
    pub first_name: String,
    /// Telegram's language tag as sent, or `null` (serialized, not omitted).
    pub language_code: Option<String>,
}

/// A stored save without its body: an entry of `GET /api/saves`, the head of `GET /api/saves/{storyId}/{slot}`, and
/// the `current` of a 409.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SaveSummary {
    /// The story the save belongs to.
    pub story_id: StoryId,
    /// The slot.
    pub slot: SaveSlot,
    /// The revision: 1 when the slot is created, one more per accepted write.
    #[ts(type = "number")]
    pub rev: i64,
    /// The chapter the save is in.
    pub chapter_id: String,
    /// The story version the body was written against.
    pub story_version: String,
    /// The line the save resumes at, or `null`.
    pub line_id: Option<String>,
    /// When the server stored this revision, in unix seconds.
    #[ts(type = "number")]
    pub saved_at: i64,
    /// The `writeId` of the write that stored this revision.
    pub write_id: String,
}

/// `GET /api/saves` response.
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SaveListResponse {
    /// Every story's saves, by story id then slot (`auto`, `s1`, `s2`, `s3`); an empty slot is absent.
    pub slots: Vec<SaveSummary>,
}

/// `GET /api/saves/{storyId}/{slot}` response.
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SaveFull {
    /// The envelope.
    pub summary: SaveSummary,
    /// The save body as the client wrote it: a JSON document in a string, opaque to the server.
    pub body: String,
}

/// `PUT /api/saves/{storyId}/{slot}` request. Unknown fields are ignored.
#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct PutSaveRequest {
    /// The `rev` this write replaces, or `null` to create the slot.
    #[ts(type = "number | null")]
    pub expected_rev: Option<i64>,
    /// The client's idempotency key of this write.
    pub write_id: String,
    /// The chapter the save is in.
    pub chapter_id: String,
    /// The story version the body was written against.
    pub story_version: String,
    /// The line the save resumes at, or `null`.
    pub line_id: Option<String>,
    /// The save body: a JSON document in a string, opaque to the server.
    pub body: String,
}

/// `PUT /api/saves/{storyId}/{slot}` response.
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct PutSaveResponse {
    /// The stored revision.
    #[ts(type = "number")]
    pub rev: i64,
    /// When the server stored it, in unix seconds.
    #[ts(type = "number")]
    pub saved_at: i64,
}

/// A chapter product as `GET /api/entitlements` lists it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ProductDto {
    /// The product id, `chapter:<chapterId>`.
    pub product_id: String,
    /// The chapter it unlocks.
    pub chapter_id: String,
    /// The price in Telegram Stars, from the server's catalog.
    pub price_stars: u32,
    /// Whether the user owns it, from the server's entitlement rows.
    pub owned: bool,
}

/// `GET /api/entitlements` response.
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct EntitlementsResponse {
    /// Every chapter product: story order, then chain order.
    pub products: Vec<ProductDto>,
}

/// `GET /api/chapters/{chapterId}` response: a paid chapter's files as the build wrote them, composed raw (no
/// re-encoding).
// No `Debug`: it is the sold content, never logged.
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ChapterPayload<'a> {
    /// The chapter id.
    pub chapter_id: &'a str,
    /// The story version the chapter was built at (`meta.json`'s `storyVersion`).
    pub story_version: &'a str,
    /// The compiled ink (`story.json`).
    #[ts(type = "unknown")]
    pub story: &'a RawValue,
    /// The chapter meta (`meta.json`).
    #[ts(type = "unknown")]
    pub meta: &'a RawValue,
    /// The chapter's asset manifest (`assets.json`).
    #[ts(type = "unknown")]
    pub assets: &'a RawValue,
    /// The English line table (`en.json`).
    #[ts(type = "unknown")]
    pub en: &'a RawValue,
    /// The chapter's public world, or `null` (serialized, not omitted) when it has none.
    #[ts(type = "unknown")]
    pub world: Option<&'a RawValue>,
}

/// `POST /api/puzzles/{puzzleId}/attempts` request. Unknown fields are ignored.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttemptRequest {
    /// The answer: the puzzle's `answerLen` values, each at most its `answerMax` (at most 16, each at most 65535).
    pub answer: Vec<u16>,
}

/// `POST /api/puzzles/{puzzleId}/attempts` response.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttemptResponse {
    /// Whether this answer is the solution.
    pub correct: bool,
    /// Whether the puzzle is solved, by this answer or an earlier one.
    pub solved: bool,
}

/// The first line of the generated file: what it is and how to rewrite it.
const BINDINGS_HEADER: &str = "// Built from server/src/api/dto.rs and error.rs by ts-rs; do not edit. Regenerate: \
                               cargo test -p server --test it bindings::write_bindings -- --ignored --exact";

/// Every HTTP body's TypeScript declaration, as the one module `client/src/api/generated/api.ts`: the header line,
/// then each type's docs and `export type ...;`, blank-line separated, LF, with a final newline. Every type a
/// declaration names is declared here too, so a type left out is a client `check` error.
pub fn ts_bindings() -> String {
    let cfg = ts_rs::Config::new();
    let decls = [
        export::<SaveSlot>(&cfg),
        export::<StoryId>(&cfg),
        export::<ErrorCode>(&cfg),
        export::<ApiErrorBody>(&cfg),
        export::<AuthRequest>(&cfg),
        export::<AuthResponse>(&cfg),
        export::<UserDto>(&cfg),
        export::<SaveSummary>(&cfg),
        export::<SaveListResponse>(&cfg),
        export::<SaveFull>(&cfg),
        export::<PutSaveRequest>(&cfg),
        export::<PutSaveResponse>(&cfg),
        export::<ProductDto>(&cfg),
        export::<EntitlementsResponse>(&cfg),
        export::<ChapterPayload<'static>>(&cfg),
    ];
    format!("{BINDINGS_HEADER}\n\n{}", decls.join("\n"))
}

/// One exported declaration, as ts-rs's own exporter writes it (`export.rs`: docs, `export `, `decl()`).
fn export<T: TS>(cfg: &ts_rs::Config) -> String {
    format!("{}export {}\n", T::docs().unwrap_or_default(), T::decl(cfg))
}
