//! The social graph's SQL (META-PLAN M10-M12; `0005_social.sql`). This module writes the referral of a newcomer's
//! first launch (M11: the launch creates no friend request), a link holder's request to the code's owner (F19 step 4)
//! with the requester's handle, the owner's accept and the decline or removal with its durable block (F20), a user's
//! first invite code and its rotation, and the append-only consent log (M12); it reads the user's friends, incoming
//! requests and profile visibility.
//!
//! Invite codes and handles reach SQL only in the shapes [`crate::api::social::is_invite_code`] and
//! [`crate::api::social::is_handle`] accept (lower-case hex), so no U+0000 is ever bound; Telegram's own strings go
//! through [`without_nul`](crate::db::without_nul). Other users are named by handle only: no row read here for another
//! user carries a Telegram id out of this module.
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

/// The random bytes of an invite code: 128 bits, 32 hex digits (`invite_codes_shape`), so a code cannot be guessed.
const CODE_BYTES: usize = 16;

/// The consent purpose of profile visibility (`consents_purpose_known`).
const FRIENDS_PROFILE: &str = "friends_profile";

/// The rolling window of the rotation limit, in seconds: a day. Only a rotation revokes a code, so the codes revoked
/// inside the window are the rotations it counts (the first code is not one).
pub const ROTATION_WINDOW_SECS: i64 = 86_400;

/// What [`Repo::rotate`] did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RotateOutcome {
    /// The active code was revoked and a new one issued.
    Rotated,
    /// The window already holds the limit's rotations: nothing changed.
    Limited {
        /// Seconds until the oldest rotation in the window leaves it.
        retry_after_secs: i64,
    },
}

/// What [`Repo::accept`] did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AcceptOutcome {
    /// The request became a friendship.
    Accepted,
    /// No request from that user to me (none, or accepted before): nothing changed.
    NoRequest,
    /// One of the two is at the friend cap: nothing changed, the request stays.
    LimitReached,
}

/// A friend of the user, as another user may see them: by handle, never by Telegram id.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FriendRow {
    /// The friend's handle.
    pub handle: String,
    /// The friend's first name.
    pub first_name: String,
}

/// An incoming request, by the requester's handle.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RequestRow {
    /// The requester's handle.
    pub handle: String,
    /// The requester's first name.
    pub first_name: String,
    /// When the request was sent, in unix seconds.
    pub at: i64,
}

/// What [`Repo::social`] read: the user's own invite code, friends, incoming requests and profile visibility.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SocialRows {
    /// The user's active invite code.
    pub invite_code: String,
    /// The friends, oldest friendship first, then by handle.
    pub friends: Vec<FriendRow>,
    /// The incoming requests, oldest first, then by handle.
    pub requests: Vec<RequestRow>,
    /// The latest `friends_profile` consent is a grant (none: `false`, M12).
    pub profile_visible: bool,
}

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

    /// The user a handle names, if any.
    pub async fn user_by_handle(&self, h: &str) -> Result<Option<UserId>, sqlx::Error> {
        let user: Option<i64> =
            sqlx::query_scalar("SELECT user_id FROM user_handles WHERE handle = $1")
                .bind(h)
                .fetch_optional(&self.pool)
                .await?;
        Ok(user.map(UserId))
    }

    /// `u`'s social view (`GET /api/social`): the active invite code, created on the first call; the friends and the
    /// incoming requests, each with the other user's handle and first name; the profile visibility. Four reads; the
    /// first call adds the code insert (and, when a concurrent first call won it, a re-read of the winner's code).
    pub async fn social(&self, u: UserId, now: i64) -> Result<SocialRows, sqlx::Error> {
        let invite_code = self.active_code(u, now).await?;
        let friends: Vec<(String, String)> = sqlx::query_as(
            "SELECT h.handle, o.first_name FROM friendships f \
             JOIN users o ON o.id = CASE WHEN f.user_lo = $1 THEN f.user_hi ELSE f.user_lo END \
             JOIN user_handles h ON h.user_id = o.id \
             WHERE f.user_lo = $1 OR f.user_hi = $1 ORDER BY f.created_at, h.handle",
        )
        .bind(u.0)
        .fetch_all(&self.pool)
        .await?;
        let requests: Vec<(String, String, i64)> = sqlx::query_as(
            "SELECT h.handle, o.first_name, r.created_at FROM friend_requests r \
             JOIN users o ON o.id = r.from_id JOIN user_handles h ON h.user_id = r.from_id \
             WHERE r.to_id = $1 ORDER BY r.created_at, h.handle",
        )
        .bind(u.0)
        .fetch_all(&self.pool)
        .await?;
        Ok(SocialRows {
            invite_code,
            friends: friends
                .into_iter()
                .map(|(handle, first_name)| FriendRow { handle, first_name })
                .collect(),
            requests: requests
                .into_iter()
                .map(|(handle, first_name, at)| RequestRow {
                    handle,
                    first_name,
                    at,
                })
                .collect(),
            profile_visible: self.profile_visible(u).await?,
        })
    }

    /// `me` accepts the request from `from` (F20 step 1), in one transaction: both `users` rows locked ascending; the
    /// request deleted (none: [`AcceptOutcome::NoRequest`]); both below `cap` friends, else
    /// [`AcceptOutcome::LimitReached`] with the request kept; the friendship inserted `ON CONFLICT DO NOTHING`; the
    /// reverse request deleted; `me`'s handle ensured (`from` now sees it).
    pub async fn accept(
        &self,
        me: UserId,
        from: UserId,
        cap: i64,
        now: i64,
    ) -> Result<AcceptOutcome, sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        if !lock_pair(&mut tx, me, from).await? {
            tx.rollback().await?;
            return Ok(AcceptOutcome::NoRequest);
        }
        let deleted = sqlx::query("DELETE FROM friend_requests WHERE from_id = $1 AND to_id = $2")
            .bind(from.0)
            .bind(me.0)
            .execute(&mut *tx)
            .await?
            .rows_affected();
        if deleted == 0 {
            tx.rollback().await?;
            return Ok(AcceptOutcome::NoRequest);
        }
        let (mine, theirs): (i64, i64) = sqlx::query_as(
            "SELECT (SELECT count(*) FROM friendships WHERE user_lo = $1 OR user_hi = $1), \
             (SELECT count(*) FROM friendships WHERE user_lo = $2 OR user_hi = $2)",
        )
        .bind(me.0)
        .bind(from.0)
        .fetch_one(&mut *tx)
        .await?;
        if mine >= cap || theirs >= cap {
            tx.rollback().await?;
            return Ok(AcceptOutcome::LimitReached);
        }
        let (lo, hi) = ordered(me, from);
        sqlx::query(
            "INSERT INTO friendships (user_lo, user_hi, created_at) VALUES ($1, $2, $3) \
             ON CONFLICT ON CONSTRAINT friendships_pkey DO NOTHING",
        )
        .bind(lo)
        .bind(hi)
        .bind(now)
        .execute(&mut *tx)
        .await?;
        sqlx::query("DELETE FROM friend_requests WHERE from_id = $1 AND to_id = $2")
            .bind(me.0)
            .bind(from.0)
            .execute(&mut *tx)
            .await?;
        ensure_handle(&mut tx, me).await?;
        tx.commit().await?;
        Ok(AcceptOutcome::Accepted)
    }

    /// `me` removes `other` (F20 step 2: a decline of an incoming request or an unfriending, from either side), in one
    /// transaction: both `users` rows locked ascending; the friendship and every request between the two deleted;
    /// `false` (and nothing changed) when there was neither a friendship nor a request from `other`; otherwise the
    /// durable block `(me, other)` inserted `ON CONFLICT DO NOTHING`, so `other`'s requests to `me` create nothing.
    pub async fn remove(&self, me: UserId, other: UserId, now: i64) -> Result<bool, sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        if !lock_pair(&mut tx, me, other).await? {
            tx.rollback().await?;
            return Ok(false);
        }
        let (lo, hi) = ordered(me, other);
        let unfriended = sqlx::query("DELETE FROM friendships WHERE user_lo = $1 AND user_hi = $2")
            .bind(lo)
            .bind(hi)
            .execute(&mut *tx)
            .await?
            .rows_affected()
            == 1;
        let senders: Vec<i64> = sqlx::query_scalar(
            "DELETE FROM friend_requests WHERE (from_id = $1 AND to_id = $2) OR (from_id = $2 AND to_id = $1) \
             RETURNING from_id",
        )
        .bind(other.0)
        .bind(me.0)
        .fetch_all(&mut *tx)
        .await?;
        if !unfriended && !senders.contains(&other.0) {
            tx.rollback().await?;
            return Ok(false);
        }
        sqlx::query(
            "INSERT INTO friend_blocks (user_id, blocked_id, created_at) VALUES ($1, $2, $3) \
             ON CONFLICT ON CONSTRAINT friend_blocks_pkey DO NOTHING",
        )
        .bind(me.0)
        .bind(other.0)
        .bind(now)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(true)
    }

    /// `me` rotates the invite code (M10: a leaked link stops producing requests), in one transaction: `me`'s `users`
    /// row locked, so the count is exact; the rotations of the last [`ROTATION_WINDOW_SECS`] counted, and at
    /// `per_day` [`RotateOutcome::Limited`] until the oldest of them leaves the window; else the active code revoked
    /// at `now` and a new one inserted. Pending requests stay until handled.
    pub async fn rotate(
        &self,
        me: UserId,
        per_day: i64,
        now: i64,
    ) -> Result<RotateOutcome, sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("SELECT 1 FROM users WHERE id = $1 FOR NO KEY UPDATE")
            .bind(me.0)
            .execute(&mut *tx)
            .await?;
        let (rotations, oldest): (i64, Option<i64>) = sqlx::query_as(
            "SELECT count(*), min(revoked_at) FROM invite_codes WHERE user_id = $1 AND revoked_at > $2",
        )
        .bind(me.0)
        .bind(now.saturating_sub(ROTATION_WINDOW_SECS))
        .fetch_one(&mut *tx)
        .await?;
        if rotations >= per_day {
            tx.rollback().await?;
            let leaves_at = oldest.unwrap_or(now).saturating_add(ROTATION_WINDOW_SECS);
            return Ok(RotateOutcome::Limited {
                retry_after_secs: leaves_at.saturating_sub(now),
            });
        }
        sqlx::query(
            "UPDATE invite_codes SET revoked_at = $2 WHERE user_id = $1 AND revoked_at IS NULL",
        )
        .bind(me.0)
        .bind(now)
        .execute(&mut *tx)
        .await?;
        sqlx::query("INSERT INTO invite_codes (code, user_id, created_at) VALUES ($1, $2, $3)")
            .bind(new_invite_code())
            .bind(me.0)
            .bind(now)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(RotateOutcome::Rotated)
    }

    /// Appends `me`'s `friends_profile` consent row (M12): the decision, the server's policy version and the consent
    /// text the user saw. The latest row wins (`consents_latest`); nothing is ever updated.
    pub async fn record_consent(
        &self,
        me: UserId,
        granted: bool,
        policy: &str,
        text: &str,
        now: i64,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "INSERT INTO consents (user_id, purpose, granted, policy_version, text_version, at) \
             VALUES ($1, $2, $3, $4, $5, $6)",
        )
        .bind(me.0)
        .bind(FRIENDS_PROFILE)
        .bind(granted)
        .bind(policy)
        .bind(text)
        .bind(now)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// The two users are friends (either order; one user is never its own friend). One read.
    pub async fn are_friends(&self, a: UserId, b: UserId) -> Result<bool, sqlx::Error> {
        let (lo, hi) = ordered(a, b);
        sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM friendships WHERE user_lo = $1 AND user_hi = $2)",
        )
        .bind(lo)
        .bind(hi)
        .fetch_one(&self.pool)
        .await
    }

    /// `u`'s latest `friends_profile` consent is a grant; `false` without one (private by default, M12). One read.
    pub async fn profile_visible(&self, u: UserId) -> Result<bool, sqlx::Error> {
        let granted: Option<bool> = sqlx::query_scalar(
            "SELECT granted FROM consents WHERE user_id = $1 AND purpose = $2 ORDER BY id DESC LIMIT 1",
        )
        .bind(u.0)
        .bind(FRIENDS_PROFILE)
        .fetch_optional(&self.pool)
        .await?;
        Ok(granted.unwrap_or(false))
    }

    /// `u`'s active invite code, inserted when `u` has none. The insert names the partial unique index
    /// `invite_codes_one_active` by inference (`ON CONFLICT (user_id) WHERE revoked_at IS NULL`; `ON CONSTRAINT` names
    /// constraints only, and a partial index is not one): a concurrent first call waits on the winner's row, inserts
    /// nothing, and re-reads the winner's code.
    async fn active_code(&self, u: UserId, now: i64) -> Result<String, sqlx::Error> {
        let active = "SELECT code FROM invite_codes WHERE user_id = $1 AND revoked_at IS NULL";
        let code: Option<String> = sqlx::query_scalar(active)
            .bind(u.0)
            .fetch_optional(&self.pool)
            .await?;
        if let Some(code) = code {
            return Ok(code);
        }
        let inserted: Option<String> = sqlx::query_scalar(
            "INSERT INTO invite_codes (code, user_id, created_at) VALUES ($1, $2, $3) \
             ON CONFLICT (user_id) WHERE revoked_at IS NULL DO NOTHING RETURNING code",
        )
        .bind(new_invite_code())
        .bind(u.0)
        .bind(now)
        .fetch_optional(&self.pool)
        .await?;
        match inserted {
            Some(code) => Ok(code),
            None => {
                sqlx::query_scalar(active)
                    .bind(u.0)
                    .fetch_one(&self.pool)
                    .await
            }
        }
    }
}

/// A new invite code: 32 lower-case hex of 16 OS-random bytes.
fn new_invite_code() -> String {
    let mut bytes = [0u8; CODE_BYTES];
    getrandom::fill(&mut bytes).expect(
        "invariant: the OS random source works (ProcessPrng on Windows 10+ is documented never to fail)",
    );
    hex::encode(bytes)
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
