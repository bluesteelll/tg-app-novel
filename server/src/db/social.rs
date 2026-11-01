//! The social graph's SQL (META-PLAN M10-M12; `0005_social.sql`). This module writes the referral of a newcomer's
//! first launch (M11: the launch creates no friend request), and a link holder's request to the code's owner (F19
//! step 4) with the requester's handle.
//!
//! Invite codes reach SQL only in the shape [`crate::api::social::is_invite_code`] accepts (32 lower-case hex), so no
//! U+0000 is ever bound; Telegram's own strings go through [`without_nul`](crate::db::without_nul).
//!
//! Lock order of every transaction here: both `users` rows in ascending id, taken by one statement, then the rest
//! (META-PLAN "Concurrency and failure model"). `NO KEY UPDATE` does not conflict with the `KEY SHARE` of foreign-key
//! checks, so logins, saves and grants never wait on these locks.

use serde::Serialize;
use sqlx::PgConnection;

use crate::auth::TgUser;
use crate::db::Repo;
use crate::db::users::upsert_user_in;
use crate::ids::UserId;

/// The random bytes of a handle: 96 bits, 24 hex digits (`user_handles_shape`).
const HANDLE_BYTES: usize = 12;

/// What a link holder's invite code means to them (`GET /api/invites/{code}`, M10). Nothing about the owner: a block
/// of the caller by the owner, and the owner's full request list, answer `requested` exactly like the caller's own
/// pending request, so the blocked or capped side learns nothing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum InviteState {
    /// The caller may ask: the prompt is shown.
    Open,
    /// A request of the caller is pending, the owner blocked the caller, or the owner's requests are at the cap.
    Requested,
    /// The caller and the owner are friends.
    Friends,
    /// The caller's own code.
    Own,
}

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

    /// What `code` means to `me` (F19 step 3), or `None` when no active code is `code` (unknown or revoked: 404).
    /// Two reads: the code's owner, then `invite_state_in`, the one state read [`Repo::ask`] runs too, so the GET
    /// and the POST answer a block or the cap alike.
    pub async fn invite_state(
        &self,
        me: UserId,
        code: &str,
        pending_cap: i64,
    ) -> Result<Option<InviteState>, sqlx::Error> {
        let mut c = self.pool.acquire().await?;
        let Some(owner) = code_owner(&mut c, code).await? else {
            return Ok(None);
        };
        if owner == me {
            return Ok(Some(InviteState::Own));
        }
        invite_state_in(&mut c, me, owner, code, pending_cap).await
    }

    /// `me` asks the owner of `code` (F19 step 4), in one transaction: the code's owner (`None`: 404); `own` for
    /// one's own code; both `users` rows locked ascending; the state re-read under the locks with the code re-checked
    /// (a rotation committed meanwhile is a 404, never a request through a revoked code). `friends` and `requested`
    /// (a pending request of `me`, a block of `me` by the owner, or `pending_cap` requests to the owner) write nothing.
    /// Otherwise: `me`'s own block of the owner is lifted (asking is `me`'s act), the request is inserted `ON CONFLICT
    /// DO NOTHING`, and `me`'s handle ensured (the owner now sees it) -> `requested`.
    pub async fn ask(
        &self,
        me: UserId,
        code: &str,
        pending_cap: i64,
        now: i64,
    ) -> Result<Option<InviteState>, sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        let Some(owner) = code_owner(&mut tx, code).await? else {
            tx.rollback().await?;
            return Ok(None);
        };
        if owner == me {
            tx.rollback().await?;
            return Ok(Some(InviteState::Own));
        }
        if !lock_pair(&mut tx, me, owner).await? {
            tx.rollback().await?;
            return Ok(None);
        }
        match invite_state_in(&mut tx, me, owner, code, pending_cap).await? {
            Some(InviteState::Open) => {}
            other => {
                tx.rollback().await?;
                return Ok(other);
            }
        }
        sqlx::query("DELETE FROM friend_blocks WHERE user_id = $1 AND blocked_id = $2")
            .bind(me.0)
            .bind(owner.0)
            .execute(&mut *tx)
            .await?;
        sqlx::query(
            "INSERT INTO friend_requests (from_id, to_id, created_at) VALUES ($1, $2, $3) \
             ON CONFLICT ON CONSTRAINT friend_requests_pkey DO NOTHING",
        )
        .bind(me.0)
        .bind(owner.0)
        .bind(now)
        .execute(&mut *tx)
        .await?;
        ensure_handle(&mut tx, me).await?;
        tx.commit().await?;
        Ok(Some(InviteState::Requested))
    }
}

/// The owner of the active code `code`, if any.
async fn code_owner(c: &mut PgConnection, code: &str) -> Result<Option<UserId>, sqlx::Error> {
    let owner: Option<i64> = sqlx::query_scalar(
        "SELECT user_id FROM invite_codes WHERE code = $1 AND revoked_at IS NULL",
    )
    .bind(code)
    .fetch_optional(&mut *c)
    .await?;
    Ok(owner.map(UserId))
}

/// `(a, b)` as a `friendships` row stores them: the lower id first.
fn ordered(a: UserId, b: UserId) -> (i64, i64) {
    (a.0.min(b.0), a.0.max(b.0))
}

/// Locks the `users` rows of `a` and `b` (`NO KEY UPDATE`) in one statement. `ORDER BY` runs before the locking
/// clause, so the rows lock in ascending id and two transactions over one pair never deadlock. `false` unless both
/// rows exist and are two (one's own handle names one row).
async fn lock_pair(c: &mut PgConnection, a: UserId, b: UserId) -> Result<bool, sqlx::Error> {
    let locked: Vec<i64> =
        sqlx::query_scalar("SELECT id FROM users WHERE id = ANY($1) ORDER BY id FOR NO KEY UPDATE")
            .bind([a.0, b.0].as_slice())
            .fetch_all(&mut *c)
            .await?;
    Ok(locked.len() == 2)
}

/// `me`'s invite state toward `owner` (another user) through `code`, in one statement: `None` when `code` is no longer
/// active; `friends` before `requested` before `open`. [`Repo::invite_state`] and [`Repo::ask`] both read it here.
async fn invite_state_in(
    c: &mut PgConnection,
    me: UserId,
    owner: UserId,
    code: &str,
    pending_cap: i64,
) -> Result<Option<InviteState>, sqlx::Error> {
    let (lo, hi) = ordered(me, owner);
    let (active, friends, requested): (bool, bool, bool) = sqlx::query_as(
        "SELECT EXISTS (SELECT 1 FROM invite_codes WHERE code = $1 AND revoked_at IS NULL), \
         EXISTS (SELECT 1 FROM friendships WHERE user_lo = $2 AND user_hi = $3), \
         EXISTS (SELECT 1 FROM friend_blocks WHERE user_id = $4 AND blocked_id = $5) \
         OR EXISTS (SELECT 1 FROM friend_requests WHERE from_id = $5 AND to_id = $4) \
         OR (SELECT count(*) FROM friend_requests WHERE to_id = $4) >= $6",
    )
    .bind(code)
    .bind(lo)
    .bind(hi)
    .bind(owner.0)
    .bind(me.0)
    .bind(pending_cap)
    .fetch_one(&mut *c)
    .await?;
    Ok(active.then_some(if friends {
        InviteState::Friends
    } else if requested {
        InviteState::Requested
    } else {
        InviteState::Open
    }))
}

/// Gives `user` a handle unless it has one: 24 lower-case hex of 12 OS-random bytes, the only user id another user
/// ever receives (W1). A clash with another user's handle (`user_handles_handle`, odds 2^-96) is an error, not a
/// shared handle.
async fn ensure_handle(c: &mut PgConnection, user: UserId) -> Result<(), sqlx::Error> {
    let mut bytes = [0u8; HANDLE_BYTES];
    getrandom::fill(&mut bytes).expect(
        "invariant: the OS random source works (ProcessPrng on Windows 10+ is documented never to fail)",
    );
    sqlx::query(
        "INSERT INTO user_handles (user_id, handle) VALUES ($1, $2) \
         ON CONFLICT ON CONSTRAINT user_handles_pkey DO NOTHING",
    )
    .bind(user.0)
    .bind(hex::encode(bytes))
    .execute(&mut *c)
    .await?;
    Ok(())
}
