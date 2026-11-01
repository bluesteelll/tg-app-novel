//! The `users` table: one row per Telegram user, written only from verified initData.

use sqlx::PgConnection;

use crate::db::{Repo, without_nul};
use crate::ids::UserId;

impl Repo {
    /// Records a verified login: inserts the user, or refreshes the name, language and `last_seen_at` of a known one.
    /// `created_at` keeps the first login. One statement, so two concurrent logins of one user both succeed.
    /// U+0000 in the name or the language is stored as U+FFFD. `true` when this call inserted the row: the user is a
    /// newcomer (META-PLAN M11).
    pub async fn upsert_user(
        &self,
        id: UserId,
        first_name: &str,
        language_code: Option<&str>,
        now: i64,
    ) -> Result<bool, sqlx::Error> {
        let mut c = self.pool.acquire().await?;
        upsert_user_in(&mut c, id, first_name, language_code, now).await
    }
}

/// [`Repo::upsert_user`]'s one statement on `c`, so the attribution transaction (`db/social.rs`) runs the same
/// upsert, with the same U+0000 replacement, inside its transaction.
pub(crate) async fn upsert_user_in(
    c: &mut PgConnection,
    id: UserId,
    first_name: &str,
    language_code: Option<&str>,
    now: i64,
) -> Result<bool, sqlx::Error> {
    // PostgreSQL `text` cannot hold U+0000 (`22021`), and a Telegram string may carry it: a login must not fail on a
    // name, so the character is replaced here, at the database boundary, after the HMAC check saw the original.
    let first_name = without_nul(first_name);
    let language_code = language_code.map(without_nul);
    // PostgreSQL 18 `old` in RETURNING is NULL for a row this statement inserted and the prior row for an
    // ON CONFLICT update: the flag needs no second read, and two logins in one second never both look new.
    sqlx::query_scalar(
        "INSERT INTO users (id, first_name, language_code, created_at, last_seen_at) VALUES ($1, $2, $3, $4, $4) \
         ON CONFLICT ON CONSTRAINT users_pkey DO UPDATE SET first_name = excluded.first_name, \
         language_code = excluded.language_code, last_seen_at = excluded.last_seen_at \
         RETURNING (old.id IS NULL) AS inserted",
    )
    .bind(id.0)
    .bind(&*first_name)
    .bind(language_code.as_deref())
    .bind(now)
    .fetch_one(&mut *c)
    .await
}
