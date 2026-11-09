//! The resource economy's SQL (META-PLAN M18; `0004_economy.sql`): an append-only ledger whose UNIQUE `idem_key` is
//! the idempotency arbiter, and a balance row per (user, kind) that a CHECK keeps at 0 or above.
//!
//! Every change is one ledger insert (`ON CONFLICT ON CONSTRAINT resource_ledger_idem_key DO NOTHING`: no row back is
//! a duplicate, and nothing else happens) followed by one balance statement, in the caller's transaction, so per
//! (user, kind) `balance - debt` equals the sum of the ledger amounts. A credit pays the debt first; a debit only
//! applies to a balance that covers it; a clawback takes the balance, then records the rest as debt (M20). The hint
//! spend (M21) unlocks a tier and debits it in one transaction; a gift (M22) moves units between two friends in one.
//!
//! Lock order on every path: the ledger key, then the balance row (the spend takes the unlock key first). No path here
//! waits for a `users` row while it holds a balance row. The gift ([`Repo::transfer`]) locks both `users` rows first
//! (ascending id), then the sender's key and balance row, then the recipient's: its two balance rows follow M22's step
//! order, not ascending (user id, kind). That is deadlock-free because every path that holds two balance rows (the
//! gift, the referral grant in `db/social.rs`) holds both of their `users` rows first, so two such paths sharing a
//! balance row are already serialized on that user's row, and every single-row path (grant, spend, clawback) waits on
//! nothing after its balance row.

use sqlx::PgConnection;

use crate::catalog::{GiftRules, HINT_KIND, ResourceKind};
use crate::db::social::{are_friends_in, lock_pair};
use crate::db::{Repo, without_nul};
use crate::ids::{PuzzleKey, UserId};

/// The idempotency-key prefix of a pack credit: `pay:<charge>`.
const PAY_KEY_PREFIX: &str = "pay:";

/// The idempotency-key prefix of a hint spend: `hint:<user>:<puzzleKey>:<tier>`.
const HINT_KEY_PREFIX: &str = "hint:";

/// The idempotency-key prefix of a gift's two rows: `gift:<sender>:<requestId>:out` and `…:in`.
const GIFT_KEY_PREFIX: &str = "gift:";

/// The rolling window of both gift caps, in seconds: a day (M22).
pub const GIFT_WINDOW_SECS: i64 = 86_400;

/// Why a ledger row moves a balance: the `resource_ledger_reason_known` words. The sign is the reason's
/// (`resource_ledger_sign_by_reason`): a credit for `Pack`, `GiftIn` and the referral bonuses, a debit or clawback for
/// the rest; `Pack` and `PackRefund` carry their charge (`resource_ledger_charge_by_reason`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Reason {
    /// A paid pack, credited inside the grant.
    Pack,
    /// A refunded pack, clawed back (L9).
    PackRefund,
    /// A hint tier unlocked from the balance.
    HintSpend,
    /// A gift sent (LE2).
    GiftOut,
    /// A gift received (LE2).
    GiftIn,
    /// The inviter's referral bonus (LE2).
    ReferralInviter,
    /// The invitee's referral bonus (LE2).
    ReferralInvitee,
}

impl Reason {
    /// The `resource_ledger.reason` word.
    pub fn as_str(self) -> &'static str {
        match self {
            Reason::Pack => "pack",
            Reason::PackRefund => "pack_refund",
            Reason::HintSpend => "hint_spend",
            Reason::GiftOut => "gift_out",
            Reason::GiftIn => "gift_in",
            Reason::ReferralInviter => "referral_inviter",
            Reason::ReferralInvitee => "referral_invitee",
        }
    }
}

/// One ledger row to write: a change of `user`'s `kind` balance by `amount`.
#[derive(Debug, Clone)]
pub struct Entry<'a> {
    /// The user whose balance changes.
    pub user: UserId,
    /// The resource kind.
    pub kind: &'a ResourceKind,
    /// The signed amount as the ledger stores it: above 0 for a credit, below 0 for a debit or a clawback, within
    /// ±1000 (`resource_ledger_amount_bounded`).
    pub amount: i64,
    /// Why; its sign rule must match `amount`'s.
    pub reason: Reason,
    /// The idempotency key (META-PLAN M18 forms): a second change with the same key changes nothing.
    pub idem_key: String,
    /// The Telegram charge of a `Pack` / `PackRefund` row, already through `without_nul`; `None` for every other.
    pub charge_id: Option<&'a str>,
    /// The other user of a gift or a referral.
    pub counterpart: Option<UserId>,
    /// What the change is for: a pack's product id, a hint spend's `<puzzleId>:<tier>`.
    pub r#ref: Option<&'a str>,
    /// When, in unix seconds.
    pub at: i64,
}

/// What a ledger change did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Applied {
    /// The ledger row was written and the balance moved: the row as it is now.
    Applied {
        /// The balance after the change.
        balance: i64,
        /// The debt after the change.
        debt: i64,
    },
    /// The key was written before: nothing changed.
    Duplicate,
}

/// The ledger insert of `e`: `true` when the row was written, `false` when its key already exists.
async fn insert_ledger(c: &mut PgConnection, e: &Entry<'_>) -> Result<bool, sqlx::Error> {
    let id: Option<i64> = sqlx::query_scalar(
        "INSERT INTO resource_ledger (user_id, kind, amount, reason, idem_key, charge_id, counterpart_id, ref, \
         created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) \
         ON CONFLICT ON CONSTRAINT resource_ledger_idem_key DO NOTHING RETURNING id",
    )
    .bind(e.user.0)
    .bind(&e.kind.0)
    .bind(e.amount)
    .bind(e.reason.as_str())
    .bind(&e.idem_key)
    .bind(e.charge_id)
    .bind(e.counterpart.map(|user| user.0))
    .bind(e.r#ref)
    .bind(e.at)
    .fetch_optional(&mut *c)
    .await?;
    Ok(id.is_some())
}

/// Credits `e.amount` (above 0) on `c`'s transaction: the ledger row, then the balance upsert, which pays the debt
/// first. Both `SET` expressions read the row as it was before the statement (PostgreSQL), so the debt paid and the
/// balance added sum to `e.amount`.
pub async fn credit_in_tx(c: &mut PgConnection, e: &Entry<'_>) -> Result<Applied, sqlx::Error> {
    if !insert_ledger(c, e).await? {
        return Ok(Applied::Duplicate);
    }
    let (balance, debt): (i64, i64) = sqlx::query_as(
        "INSERT INTO resource_balances AS b (user_id, kind, balance, debt, updated_at) VALUES ($1, $2, $3, 0, $4) \
         ON CONFLICT ON CONSTRAINT resource_balances_pkey DO UPDATE SET \
         balance = b.balance + GREATEST($3 - b.debt, 0), debt = GREATEST(b.debt - $3, 0), updated_at = $4 \
         RETURNING balance, debt",
    )
    .bind(e.user.0)
    .bind(&e.kind.0)
    .bind(e.amount)
    .bind(e.at)
    .fetch_one(&mut *c)
    .await?;
    Ok(Applied::Applied { balance, debt })
}

/// Debits `-e.amount` (`e.amount` below 0) on `c`'s transaction: the ledger row, then the guarded UPDATE, which
/// READ COMMITTED re-evaluates on the committed row after a wait. `None`: the balance does not cover it (or the user
/// has no row) and the ledger row WAS written, so the caller must roll back.
pub async fn debit_in_tx(
    c: &mut PgConnection,
    e: &Entry<'_>,
) -> Result<Option<Applied>, sqlx::Error> {
    if !insert_ledger(c, e).await? {
        return Ok(Some(Applied::Duplicate));
    }
    // The ledger insert above passed `resource_ledger_amount_bounded`: the negation cannot overflow.
    let row = debit_balance(c, e.user, e.kind, -e.amount, e.at).await?;
    Ok(row.map(|(balance, debt)| Applied::Applied { balance, debt }))
}

/// The guarded debit of `amount` (above 0) from `user`'s `kind` balance at `at`, which READ COMMITTED re-evaluates on
/// the committed row after a wait: (balance, debt) after it, or `None` when the balance does not cover it or the user
/// has no row. [`debit_in_tx`] and the gift ([`Repo::transfer`]) both debit here, after their ledger row.
async fn debit_balance(
    c: &mut PgConnection,
    user: UserId,
    kind: &ResourceKind,
    amount: i64,
    at: i64,
) -> Result<Option<(i64, i64)>, sqlx::Error> {
    sqlx::query_as(
        "UPDATE resource_balances SET balance = balance - $3, updated_at = $4 \
         WHERE user_id = $1 AND kind = $2 AND balance >= $3 RETURNING balance, debt",
    )
    .bind(user.0)
    .bind(&kind.0)
    .bind(amount)
    .bind(at)
    .fetch_optional(&mut *c)
    .await
}

/// Claws back `-e.amount` (`e.amount` below 0) on `c`'s transaction (M20): the ledger row, then an upsert that takes
/// the balance first and records the shortfall as debt. An upsert, so a refund never meets a missing row.
pub async fn clawback_in_tx(c: &mut PgConnection, e: &Entry<'_>) -> Result<Applied, sqlx::Error> {
    if !insert_ledger(c, e).await? {
        return Ok(Applied::Duplicate);
    }
    // The ledger insert above passed `resource_ledger_amount_bounded`: the negation cannot overflow.
    let (balance, debt): (i64, i64) = sqlx::query_as(
        "INSERT INTO resource_balances AS b (user_id, kind, balance, debt, updated_at) VALUES ($1, $2, 0, $3, $4) \
         ON CONFLICT ON CONSTRAINT resource_balances_pkey DO UPDATE SET \
         balance = GREATEST(b.balance - $3, 0), debt = b.debt + GREATEST($3 - b.balance, 0), updated_at = $4 \
         RETURNING balance, debt",
    )
    .bind(e.user.0)
    .bind(&e.kind.0)
    .bind(-e.amount)
    .bind(e.at)
    .fetch_one(&mut *c)
    .await?;
    Ok(Applied::Applied { balance, debt })
}

/// The kind and amount the pack credit of `charge` wrote (its `pay:<charge>` row, one probe of the
/// `resource_ledger_idem_key` index), or `None` when the charge credited nothing: what a refund claws back, never the
/// current catalog (M20, revision 1).
pub async fn credited_by_charge(
    c: &mut PgConnection,
    charge: &str,
) -> Result<Option<(ResourceKind, i64)>, sqlx::Error> {
    let row: Option<(String, i64)> =
        sqlx::query_as("SELECT kind, amount FROM resource_ledger WHERE idem_key = $1")
            .bind(pay_key(&without_nul(charge)))
            .fetch_optional(&mut *c)
            .await?;
    Ok(row.map(|(kind, amount)| (ResourceKind(kind), amount)))
}

/// The idempotency key of the pack credit of `charge` (already through `without_nul`): `pay:<charge>`.
pub(crate) fn pay_key(charge: &str) -> String {
    // `push_str`, not string formatting: this module holds SQL, and the dynamic-SQL scan flags formatting near it.
    let mut key = String::with_capacity(PAY_KEY_PREFIX.len() + charge.len());
    key.push_str(PAY_KEY_PREFIX);
    key.push_str(charge);
    key
}

/// The idempotency key of `user`'s spend on `tier` of the puzzle keyed `puzzle`: `hint:<user>:<puzzleKey>:<tier>`.
/// Built from the storage key (per-player §3.8), so a renamed puzzle's spend keeps its key.
fn hint_key(user: UserId, puzzle: &PuzzleKey, tier: u8) -> String {
    let mut key = String::from(HINT_KEY_PREFIX);
    key.push_str(&user.0.to_string());
    key.push(':');
    key.push_str(&spend_ref(puzzle, tier));
    key
}

/// The ledger `ref` of a hint spend: `<puzzleKey>:<tier>` (the column comment's `<puzzleId>`: the same text for a
/// puzzle never renamed).
fn spend_ref(puzzle: &PuzzleKey, tier: u8) -> String {
    let mut reference = puzzle.0.clone();
    reference.push(':');
    reference.push_str(&tier.to_string());
    reference
}

/// The idempotency key of one side (`out` or `in`) of `from`'s gift `request_id`: `gift:<from>:<requestId>:<side>`.
fn gift_key(from: UserId, request_id: &str, side: &str) -> String {
    let mut key = String::from(GIFT_KEY_PREFIX);
    key.push_str(&from.0.to_string());
    key.push(':');
    key.push_str(request_id);
    key.push(':');
    key.push_str(side);
    key
}

/// `user`'s balance of `kind` on `c`'s transaction, 0 without a row.
async fn balance_of(
    c: &mut PgConnection,
    user: UserId,
    kind: &ResourceKind,
) -> Result<i64, sqlx::Error> {
    let balance: Option<i64> = sqlx::query_scalar(
        "SELECT balance FROM resource_balances WHERE user_id = $1 AND kind = $2",
    )
    .bind(user.0)
    .bind(&kind.0)
    .fetch_optional(&mut *c)
    .await?;
    Ok(balance.unwrap_or(0))
}

/// What [`Repo::spend_hint`] did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SpendOutcome {
    /// This use unlocked the tier and debited it: the `hint` balance after it.
    Unlocked {
        /// The balance after the debit.
        balance: i64,
    },
    /// The tier was unlocked before: nothing was debited.
    AlreadyUnlocked {
        /// The current balance.
        balance: i64,
    },
    /// The balance does not cover the tier: nothing was written.
    Insufficient,
    /// The puzzle is solved, or the tier before this one is not unlocked: nothing was written.
    Unavailable,
}

/// One gift for [`Repo::transfer`] (M22): `amount` units of `kind` from `from` to `to`, keyed by the sender's
/// request id.
#[derive(Debug, Clone, Copy)]
pub struct GiftMove<'a> {
    /// The sender: the token's user.
    pub from: UserId,
    /// The recipient: the user the friend handle names.
    pub to: UserId,
    /// A gift kind of the catalog.
    pub kind: &'a ResourceKind,
    /// The units, 1 to the catalog's `maxPerGift`.
    pub amount: u32,
    /// The sender's request id, already a lower-case UUID v4: one gift per id.
    pub request_id: &'a str,
}

/// What [`Repo::transfer`] did. Every outcome but `Sent` wrote nothing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GiftOutcome {
    /// The gift moved.
    Sent {
        /// The sender's balance of the kind after the debit.
        balance: i64,
    },
    /// The request id moved this same gift before: nothing moved again.
    Replayed {
        /// The sender's current balance of the kind.
        balance: i64,
    },
    /// Not two friends: one's own handle, a friendship removed since the dialog, or a missing user.
    NotFriends,
    /// The request id moved another gift (another recipient, kind or amount).
    Mismatch,
    /// The sender's balance does not cover the amount.
    Insufficient,
    /// A daily cap of the sender or the recipient.
    Capped {
        /// Seconds until the oldest counted gift of the side over its cap leaves the window (the later of the two).
        retry_after_secs: i64,
    },
}

/// One balance row as stored.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Balance {
    /// The resource kind, as stored (a kind the catalog no longer declares included).
    pub kind: String,
    /// The balance, at least 0.
    pub balance: i64,
    /// The refund shortfall, at least 0; non-zero only with a balance of 0.
    pub debt: i64,
}

impl Repo {
    /// Every balance row of `user`, by kind.
    pub async fn balances(&self, user: UserId) -> Result<Vec<Balance>, sqlx::Error> {
        let rows: Vec<(String, i64, i64)> = sqlx::query_as(
            "SELECT kind, balance, debt FROM resource_balances WHERE user_id = $1 ORDER BY kind",
        )
        .bind(user.0)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|(kind, balance, debt)| Balance {
                kind,
                balance,
                debt,
            })
            .collect())
    }

    /// Unlocks `tier` (1 to 3) of the puzzle keyed `puzzle` for `user` at `now`, paying `cost` units of [`HINT_KIND`]
    /// (M21), in one READ COMMITTED transaction:
    /// 1. one read: the puzzle not solved, and tier 1 or the tier before unlocked; else `Unavailable`, nothing written
    ///    (a replay after a solve included);
    /// 2. the unlock row, `ON CONFLICT ON CONSTRAINT hint_unlocks_pkey DO NOTHING`: no row back is `AlreadyUnlocked`,
    ///    nothing debited. A concurrent use of the same tier waits on the first one's row here, then finds it: the
    ///    unlock key, not the balance, makes one debit per tier;
    /// 3. the debit keyed `hint:<user>:<puzzleKey>:<tier>`: a balance that does not cover it rolls back the unlock row
    ///    and the ledger row with it (`Insufficient`).
    ///
    /// The unlock row comes before the debit, so no debit exists without its unlock.
    pub async fn spend_hint(
        &self,
        user: UserId,
        puzzle: &PuzzleKey,
        tier: u8,
        cost: u32,
        now: i64,
    ) -> Result<SpendOutcome, sqlx::Error> {
        let kind = ResourceKind(HINT_KIND.to_owned());
        let mut tx = self.pool.begin().await?;
        let open: bool = sqlx::query_scalar(
            "SELECT NOT EXISTS (SELECT 1 FROM puzzle_progress \
                                WHERE user_id = $1 AND puzzle_id = $2 AND solved_at IS NOT NULL) \
             AND ($3 = 1 OR EXISTS (SELECT 1 FROM hint_unlocks \
                                    WHERE user_id = $1 AND puzzle_id = $2 AND tier = $3 - 1))",
        )
        .bind(user.0)
        .bind(&puzzle.0)
        .bind(i64::from(tier))
        .fetch_one(&mut *tx)
        .await?;
        if !open {
            tx.rollback().await?;
            return Ok(SpendOutcome::Unavailable);
        }
        let unlocked: Option<i64> = sqlx::query_scalar(
            "INSERT INTO hint_unlocks (user_id, puzzle_id, tier, unlocked_at) VALUES ($1, $2, $3, $4) \
             ON CONFLICT ON CONSTRAINT hint_unlocks_pkey DO NOTHING RETURNING tier",
        )
        .bind(user.0)
        .bind(&puzzle.0)
        .bind(i64::from(tier))
        .bind(now)
        .fetch_optional(&mut *tx)
        .await?;
        if unlocked.is_none() {
            let balance = balance_of(&mut tx, user, &kind).await?;
            tx.commit().await?;
            return Ok(SpendOutcome::AlreadyUnlocked { balance });
        }
        let reference = spend_ref(puzzle, tier);
        let debit = Entry {
            user,
            kind: &kind,
            amount: -i64::from(cost),
            reason: Reason::HintSpend,
            idem_key: hint_key(user, puzzle, tier),
            charge_id: None,
            counterpart: None,
            r#ref: Some(&reference),
            at: now,
        };
        match debit_in_tx(&mut tx, &debit).await? {
            None => {
                tx.rollback().await?;
                Ok(SpendOutcome::Insufficient)
            }
            Some(Applied::Applied { balance, .. }) => {
                tx.commit().await?;
                Ok(SpendOutcome::Unlocked { balance })
            }
            // The key is the tier's own: a duplicate cannot follow a fresh unlock row, and if it did, nothing more is
            // debited.
            Some(Applied::Duplicate) => {
                let balance = balance_of(&mut tx, user, &kind).await?;
                tx.commit().await?;
                Ok(SpendOutcome::AlreadyUnlocked { balance })
            }
        }
    }

    /// Moves the gift `g` at `now` under `rules` (M22), in one READ COMMITTED transaction of at most seven statements:
    /// 1. both `users` rows locked in ascending id ([`lock_pair`]): every gift of the sender and every gift to the
    ///    recipient runs after the one before it committed. Fewer than two rows (one's own handle, a missing user) is
    ///    `NotFriends`;
    /// 2. the friendship, read under the locks: `NotFriends` when it was removed since the dialog;
    /// 3. the sender's `gift_out` row keyed `gift:<from>:<requestId>:out`. A duplicate key is the replay: the recorded
    ///    row's counterpart, kind and amount equal this request's → `Replayed` with the current balance, else
    ///    `Mismatch`;
    /// 4. the caps, one read of `resource_ledger_by_user`: the sender's other `gift_out` units and the recipient's
    ///    `gift_in` units created after `now - GIFT_WINDOW_SECS`, each plus `amount` within `sendPerDay` /
    ///    `receivePerDay`, else `Capped` until the oldest counted gift of the side over its cap leaves the window. The
    ///    window has no upper bound: a gift committed by a request that read the clock after this one still counts, so
    ///    a count after the locks sees every committed gift;
    /// 5. the sender's guarded debit: `Insufficient` when the balance does not cover it;
    /// 6. the recipient's `gift_in` row keyed `…:in` and its credit, which pays a debt first;
    /// 7. COMMIT → `Sent` with the sender's balance after the debit.
    ///
    /// Every other outcome rolls back, so no gift row exists without its pair. A database error rolls back on drop.
    pub async fn transfer(
        &self,
        g: &GiftMove<'_>,
        rules: &GiftRules,
        now: i64,
    ) -> Result<GiftOutcome, sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        if !lock_pair(&mut tx, g.from, g.to).await?
            || !are_friends_in(&mut tx, g.from, g.to).await?
        {
            tx.rollback().await?;
            return Ok(GiftOutcome::NotFriends);
        }
        let amount = i64::from(g.amount);
        let out = Entry {
            user: g.from,
            kind: g.kind,
            amount: -amount,
            reason: Reason::GiftOut,
            idem_key: gift_key(g.from, g.request_id, "out"),
            charge_id: None,
            counterpart: Some(g.to),
            r#ref: None,
            at: now,
        };
        if !insert_ledger(&mut tx, &out).await? {
            let recorded: Option<(Option<i64>, String, i64)> = sqlx::query_as(
                "SELECT counterpart_id, kind, amount FROM resource_ledger WHERE idem_key = $1",
            )
            .bind(&out.idem_key)
            .fetch_optional(&mut *tx)
            .await?;
            if recorded == Some((Some(g.to.0), g.kind.0.clone(), -amount)) {
                let balance = balance_of(&mut tx, g.from, g.kind).await?;
                tx.commit().await?;
                return Ok(GiftOutcome::Replayed { balance });
            }
            tx.rollback().await?;
            return Ok(GiftOutcome::Mismatch);
        }
        // The sender's own row (just written, stamped `now`) is left out of its count: the rule is the M22 sum plus
        // `amount`, and the oldest row a refusal names is always a committed gift.
        let (sent, sent_oldest, received, received_oldest): (i64, Option<i64>, i64, Option<i64>) =
            sqlx::query_as(
                "SELECT o.units, o.oldest, i.units, i.oldest FROM \
                 (SELECT COALESCE(-sum(amount), 0)::bigint AS units, min(created_at) AS oldest \
                  FROM resource_ledger WHERE user_id = $1 AND reason = $3 AND created_at > $5 \
                  AND idem_key <> $6) AS o, \
                 (SELECT COALESCE(sum(amount), 0)::bigint AS units, min(created_at) AS oldest \
                  FROM resource_ledger WHERE user_id = $2 AND reason = $4 AND created_at > $5) AS i",
            )
            .bind(g.from.0)
            .bind(g.to.0)
            .bind(Reason::GiftOut.as_str())
            .bind(Reason::GiftIn.as_str())
            .bind(now.saturating_sub(GIFT_WINDOW_SECS))
            .bind(&out.idem_key)
            .fetch_one(&mut *tx)
            .await?;
        let over_send = sent + amount > i64::from(rules.send_per_day);
        let over_receive = received + amount > i64::from(rules.receive_per_day);
        if over_send || over_receive {
            tx.rollback().await?;
            let leaves = |over: bool, oldest: Option<i64>| {
                oldest
                    .filter(|_| over)
                    .map(|at| at.saturating_add(GIFT_WINDOW_SECS).saturating_sub(now))
            };
            // The catalog's bound (each cap at least `maxPerGift`) means a side over its cap counted a gift; a whole
            // window is the answer only for rules built around it.
            let retry_after_secs = leaves(over_send, sent_oldest)
                .max(leaves(over_receive, received_oldest))
                .unwrap_or(GIFT_WINDOW_SECS);
            return Ok(GiftOutcome::Capped { retry_after_secs });
        }
        let Some((balance, _)) = debit_balance(&mut tx, g.from, g.kind, amount, now).await? else {
            tx.rollback().await?;
            return Ok(GiftOutcome::Insufficient);
        };
        let credit = Entry {
            user: g.to,
            kind: g.kind,
            amount,
            reason: Reason::GiftIn,
            idem_key: gift_key(g.from, g.request_id, "in"),
            charge_id: None,
            counterpart: Some(g.from),
            r#ref: None,
            at: now,
        };
        // Both keys of a gift are written in one transaction, and its `…:out` key was fresh above: an `…:in` row
        // cannot exist. Were one there, the debit is not committed without its credit.
        if credit_in_tx(&mut tx, &credit).await? == Applied::Duplicate {
            tx.rollback().await?;
            return Ok(GiftOutcome::Mismatch);
        }
        tx.commit().await?;
        Ok(GiftOutcome::Sent { balance })
    }
}
