//! The `users` table: one row per Telegram user, written only from verified initData.

use crate::db::Repo;
use crate::ids::UserId;

impl Repo {
    /// Records a verified login: inserts the user, or refreshes the name, language and `last_seen_at` of a known one.
    /// `created_at` keeps the first login. One statement, so two concurrent logins of one user both succeed.
    pub async fn upsert_user(
        &self,
        id: UserId,
        first_name: &str,
        language_code: Option<&str>,
        now: i64,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "INSERT INTO users (id, first_name, language_code, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?) \
             ON CONFLICT (id) DO UPDATE SET first_name = excluded.first_name, \
             language_code = excluded.language_code, last_seen_at = excluded.last_seen_at",
        )
        .bind(id.0)
        .bind(first_name)
        .bind(language_code)
        .bind(now)
        .bind(now)
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}
