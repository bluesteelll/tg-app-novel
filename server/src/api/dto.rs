//! Request and response bodies of `/api`: JSON in camelCase.
//!
//! No `Debug` on the auth bodies: they carry raw initData and session tokens, which are never logged.

use serde::{Deserialize, Serialize};

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
