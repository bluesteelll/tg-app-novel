//! The `users` table: one row per Telegram user, written only from verified initData.

use std::borrow::Cow;

use crate::db::Repo;
use crate::ids::UserId;

impl Repo {
    /// Records a verified login: inserts the user, or refreshes the name, language and `last_seen_at` of a known one.
    /// `created_at` keeps the first login. One statement, so two concurrent logins of one user both succeed.
    /// U+0000 in the name or the language is stored as U+FFFD.
    pub async fn upsert_user(
        &self,
        id: UserId,
        first_name: &str,
        language_code: Option<&str>,
        now: i64,
    ) -> Result<(), sqlx::Error> {
        // PostgreSQL `text` cannot hold U+0000 (`22021`), and a Telegram string may carry it: a login must not fail on
        // a name, so the character is replaced here, at the database boundary, after the HMAC check saw the original.
        let first_name = without_nul(first_name);
        let language_code = language_code.map(without_nul);
        sqlx::query(
            "INSERT INTO users (id, first_name, language_code, created_at, last_seen_at) VALUES ($1, $2, $3, $4, $4) \
             ON CONFLICT (id) DO UPDATE SET first_name = excluded.first_name, \
             language_code = excluded.language_code, last_seen_at = excluded.last_seen_at",
        )
        .bind(id.0)
        .bind(&*first_name)
        .bind(language_code.as_deref())
        .bind(now)
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}

/// `text` with every U+0000 replaced by U+FFFD (borrowed when there is none).
fn without_nul(text: &str) -> Cow<'_, str> {
    if text.contains('\0') {
        Cow::Owned(text.replace('\0', "\u{FFFD}"))
    } else {
        Cow::Borrowed(text)
    }
}
