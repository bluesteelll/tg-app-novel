//! The resource economy's SQL (META-PLAN M18; `0004_economy.sql`): an append-only ledger whose UNIQUE `idem_key` is
//! the idempotency arbiter, and a balance row per (user, kind) that a CHECK keeps at 0 or above.
//!
//! Every change is one ledger insert (`ON CONFLICT ON CONSTRAINT resource_ledger_idem_key DO NOTHING`: no row back is
//! a duplicate, and nothing else happens) followed by one balance statement, in the caller's transaction, so per
//! (user, kind) `balance - debt` equals the sum of the ledger amounts. A credit pays the debt first; a debit only
//! applies to a balance that covers it; a clawback takes the balance, then records the rest as debt (M20).
//!
//! Lock order on every path: the ledger key, then the balance row. No path here waits for a `users` row while it holds
//! a balance row.

use sqlx::PgConnection;

use crate::catalog::ResourceKind;
use crate::db::{Repo, without_nul};
use crate::ids::UserId;

/// The idempotency-key prefix of a pack credit: `pay:<charge>`.
const PAY_KEY_PREFIX: &str = "pay:";

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
    let row: Option<(i64, i64)> = sqlx::query_as(
        "UPDATE resource_balances SET balance = balance - $3, updated_at = $4 \
         WHERE user_id = $1 AND kind = $2 AND balance >= $3 RETURNING balance, debt",
    )
    .bind(e.user.0)
    .bind(&e.kind.0)
    .bind(-e.amount)
    .bind(e.at)
    .fetch_optional(&mut *c)
    .await?;
    Ok(row.map(|(balance, debt)| Applied::Applied { balance, debt }))
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
}
