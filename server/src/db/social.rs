//! The social graph's SQL (META-PLAN M10-M12; `0005_social.sql`). This module writes the referral of a newcomer's
//! first launch (M11): the launch creates no friend request.
//!
//! Invite codes reach SQL only in the shape [`crate::api::social::is_invite_code`] accepts (32 lower-case hex), so no
//! U+0000 is ever bound; Telegram's own strings go through [`without_nul`](crate::db::without_nul).

use crate::auth::TgUser;
use crate::db::Repo;
use crate::db::users::upsert_user_in;
use crate::ids::UserId;

/// What [`Repo::auth_with_code`] recorded.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AuthAttribution {
    /// The login inserted the `users` row: the user is a newcomer.
    pub inserted: bool,
    /// The inviter of the referral row this login wrote, if it wrote one.
    pub inviter: Option<UserId>,
}

impl Repo {
    /// Records a verified login (the users upsert) and, for a newcomer launched with `code`, the referral to the code's
    /// owner (M11). Without a code: the one upsert statement. With one: one transaction of at most three statements,
    /// the upsert, then for a newcomer the active code's owner, then, when that owner is another user, the referral
    /// `ON CONFLICT DO NOTHING`. An unknown or revoked code writes nothing beyond the upsert, so it never fails a login.
    pub async fn auth_with_code(
        &self,
        u: &TgUser,
        code: Option<&str>,
        now: i64,
    ) -> Result<AuthAttribution, sqlx::Error> {
        let language_code = u.language_code.as_deref();
        let Some(code) = code else {
            let inserted = self
                .upsert_user(u.id, &u.first_name, language_code, now)
                .await?;
            return Ok(AuthAttribution {
                inserted,
                inviter: None,
            });
        };
        let mut tx = self.pool.begin().await?;
        let inserted = upsert_user_in(&mut tx, u.id, &u.first_name, language_code, now).await?;
        let mut inviter = None;
        if inserted {
            let owner: Option<i64> = sqlx::query_scalar(
                "SELECT user_id FROM invite_codes WHERE code = $1 AND revoked_at IS NULL",
            )
            .bind(code)
            .fetch_optional(&mut *tx)
            .await?;
            // A newcomer owns no code yet (`invite_codes_user_fk`); the check keeps `referrals_not_self` from ever
            // turning a login into a 500.
            if let Some(owner) = owner.filter(|&owner| owner != u.id.0) {
                let written = sqlx::query(
                    "INSERT INTO referrals (invitee_id, inviter_id, attributed_at) VALUES ($1, $2, $3) \
                     ON CONFLICT ON CONSTRAINT referrals_pkey DO NOTHING",
                )
                .bind(u.id.0)
                .bind(owner)
                .bind(now)
                .execute(&mut *tx)
                .await?
                .rows_affected();
                if written == 1 {
                    inviter = Some(UserId(owner));
                }
            }
        }
        tx.commit().await?;
        Ok(AuthAttribution { inserted, inviter })
    }
}
