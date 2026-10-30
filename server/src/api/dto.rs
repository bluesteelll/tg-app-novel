//! Request and response bodies of `/api`: JSON in camelCase.
//!
//! No `Debug` on the auth bodies, nor on the bodies that carry a save body: they hold raw initData, session tokens
//! and up to 256 KiB of player data, which are never logged.

use serde::{Deserialize, Serialize};

use crate::ids::SaveSlot;

/// `POST /api/auth` request. Unknown fields (a client-sent `userId`, say) are ignored, never trusted.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthRequest {
    /// The raw `Telegram.WebApp.initData` query string.
    pub init_data: String,
}

/// `POST /api/auth` response.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthResponse {
    /// The session token for `Authorization: Bearer`.
    pub token: String,
    /// When the token expires, in unix seconds.
    pub expires_at: i64,
    /// The verified user.
    pub user: UserDto,
}

/// A user as the client sees it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserDto {
    /// The Telegram user id.
    pub id: i64,
    /// The first name Telegram sent.
    pub first_name: String,
    /// Telegram's language tag as sent, or `null` (serialized, not omitted).
    pub language_code: Option<String>,
}

/// A stored save without its body: an entry of `GET /api/saves`, the head of `GET /api/saves/{slot}`, and the
/// `current` of a 409.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveSummary {
    /// The slot.
    pub slot: SaveSlot,
    /// The revision: 1 when the slot is created, one more per accepted write.
    pub rev: i64,
    /// The chapter the save is in.
    pub chapter_id: String,
    /// The story version the body was written against.
    pub story_version: String,
    /// The line the save resumes at, or `null`.
    pub line_id: Option<String>,
    /// When the server stored this revision, in unix seconds.
    pub saved_at: i64,
    /// The `writeId` of the write that stored this revision.
    pub write_id: String,
}

/// `GET /api/saves` response.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveListResponse {
    /// The user's saves in slot order (`auto`, `s1`, `s2`, `s3`); an empty slot is absent.
    pub slots: Vec<SaveSummary>,
}

/// `GET /api/saves/{slot}` response.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveFull {
    /// The envelope.
    pub summary: SaveSummary,
    /// The save body as the client wrote it: a JSON document in a string, opaque to the server.
    pub body: String,
}

/// `PUT /api/saves/{slot}` request. Unknown fields are ignored.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PutSaveRequest {
    /// The `rev` this write replaces, or `null` to create the slot.
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

/// `PUT /api/saves/{slot}` response.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PutSaveResponse {
    /// The stored revision.
    pub rev: i64,
    /// When the server stored it, in unix seconds.
    pub saved_at: i64,
}
