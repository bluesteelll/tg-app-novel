//! The payment path's SQL (PP "Payment flow end to end"): the pre-checkout decision, which locks the payer's row
//! and then moves the order to `checkout` in one conditional statement (RULINGS 14, M19), the grant on
//! `successful_payment`, written first and made idempotent by the `payments_pkey` arbiter (K19), and the revoke of a
//! refund, made exactly-once by the payment row's `refunded_at IS NULL` guard (K20, M20), which re-keys a chapter's
//! entitlement to another unrefunded paid charge of the payer for it instead of deleting it (RULINGS 96). An unapplied
//! charge's automatic refund (owner Q9) is scheduled by its grant and claimed attempt by attempt through one guarded
//! `UPDATE` of its `auto_refunds` row; the revoke settles that row.
//!
//! The money-fact, decision and outcome types live here, next to the statements that bind and decide them;
//! `telegram::payments` re-exports them, so `db/` never imports `telegram/`. Every Telegram string is bound through
//! [`without_nul`].

use sqlx::PgConnection;

use crate::catalog::{ProductRef, ResourceKind, parse_product_id};
use crate::db::economy::{
    Entry, Reason, clawback_in_tx, credit_in_tx, credited_by_charge, pay_key,
};
use crate::db::{Repo, without_nul};
use crate::ids::{ChargeId, OrderId, UserId};

/// How long an order that entered `checkout` blocks every pre-checkout of the same user and product, its own
/// included, in seconds (K18): a payment that failed after an accepted pre-checkout can be retried after this.
pub const CHECKOUT_LOCK_SECS: i64 = 120;

/// How long an order can be paid after it was created, in seconds (PP P5: `created_at > now - 86400`).
pub const ORDER_PAYABLE_SECS: i64 = 86_400;

/// The idempotency-key prefix of a pack clawback: `refund:<charge>` (META-PLAN M18).
const REFUND_KEY_PREFIX: &str = "refund:";

/// The pre-checkout decision.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PreCheckoutVerdict {
    /// The order entered `checkout`: Telegram may charge.
    Ok,
    /// Refused, with the reason the payer is told: no money moves.
    Reject(RejectReason),
}

/// Why a pre-checkout was refused (PP "If no row comes back").
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RejectReason {
    /// The payload names no order.
    UnknownOrder,
    /// The payer, the amount or the currency is not the order's.
    Mismatch,
    /// The payer already owns the product.
    AlreadyOwned,
    /// An order of the payer for the product, this one included, entered `checkout` less than
    /// [`CHECKOUT_LOCK_SECS`] ago.
    InProgress,
    /// The order is older than [`ORDER_PAYABLE_SECS`], or already paid or refunded.
    Expired,
    /// The database step failed or ran out of time: the payer may simply try again.
    Temporary,
}

/// A `successful_payment` as Telegram reported it: built from frankenstein's types, or from the webhook's lenient
/// probe when the full decode failed (K17). A money fact: recorded whatever it says.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PaymentFact {
    /// The payer (`Message.from.id`).
    pub payer: UserId,
    /// The currency as received; only `XTR` can be applied.
    pub currency: String,
    /// The amount as received.
    pub total_amount: u32,
    /// The invoice payload as received: an order id, or anything else.
    pub invoice_payload: String,
    /// `telegram_payment_charge_id`: the idempotency key.
    pub charge: ChargeId,
    /// `provider_payment_charge_id`, `""` when Telegram omits it.
    pub provider_charge: String,
}

/// What a grant did. Every outcome is committed; only a database error is not.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GrantOutcome {
    /// Recorded, the order paid, the product granted: a chapter's entitlement, or a pack's credit of the kind and
    /// amount its order bound.
    Granted,
    /// The charge was recorded before (a redelivery, or its concurrent twin): nothing changed.
    Duplicate,
    /// Recorded and the order paid, but the payer already owned the product (a second paid order slipped past the
    /// checkout window): not applied.
    AlreadyEntitled,
    /// Recorded, but the payload names no order of this payer at this amount in `XTR` that is still payable (unknown,
    /// another payer's, another amount or currency, already paid): not applied.
    OrderMismatch,
    /// Recorded and the order paid, but its product id names no product kind this build can grant (or a pack order
    /// without its binding, which `orders_pack_binding` forbids): not applied.
    UnknownProduct,
}

impl GrantOutcome {
    /// Whether the charge was recorded now and applied to nothing: `OrderMismatch`, `AlreadyEntitled`,
    /// `UnknownProduct` (owner Q9 refunds each automatically). No wildcard arm: a new outcome does not compile until
    /// it is sorted here.
    pub fn unapplied(self) -> bool {
        match self {
            GrantOutcome::Granted | GrantOutcome::Duplicate => false,
            GrantOutcome::OrderMismatch
            | GrantOutcome::AlreadyEntitled
            | GrantOutcome::UnknownProduct => true,
        }
    }
}

/// What the write of a failed auto-refund attempt did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AutoRefundRetry {
    /// The row is due again at the backoff's time.
    Scheduled,
    /// The row was already claimed by a later attempt, or settled by a refund on another path: nothing written.
    Superseded,
}

/// What a revoke did (K20). Only `Revoked` wrote anything.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RevokeOutcome {
    /// The payment is marked refunded, its order `refunded`, its entitlement deleted, or re-keyed to the oldest other
    /// unrefunded paid charge of the same product, and its pack credit clawed back: whatever of these the charge had.
    Revoked,
    /// The payment was refunded before (a redelivery, the other refund path, or a concurrent twin): nothing changed.
    AlreadyRefunded,
    /// No payment has this charge id: nothing changed.
    UnknownCharge,
}

/// A payment row as a refund reads it: who paid what for which payload, and whether it was refunded.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PaymentRecord {
    /// The payer (`Message.from.id`).
    pub payer: UserId,
    /// The amount as received.
    pub amount: i64,
    /// The currency as received.
    pub currency: String,
    /// The invoice payload as received.
    pub invoice_payload: String,
    /// When the payment was revoked, if it was.
    pub refunded_at: Option<i64>,
}

/// One payment of a user, as `/paysupport` lists it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChargeLine {
    /// The `telegram_payment_charge_id`.
    pub charge: String,
    /// The amount as received.
    pub amount: i64,
    /// When the server recorded it.
    pub paid_at: i64,
    /// When it was revoked, if it was.
    pub refunded_at: Option<i64>,
    /// Whether it granted anything: an entitlement or a ledger row of the charge (M19's "unapplied" is neither).
    pub applied: bool,
}

/// An order as the refusal classification reads it: (user_id, amount, status, created_at, the product owned by the
/// order's user, an order of that user for that product inside the checkout window).
type OrderFacts = (i64, i64, String, i64, bool, bool);

impl Repo {
    /// The pre-checkout decision on `order` for `payer`, asking `total_amount` of `currency` at `now`, in one READ
    /// COMMITTED transaction:
    /// 1. the payer's `users` row is locked (`FOR NO KEY UPDATE`): pre-checkouts of one payer run one after another,
    ///    and each next statement takes its snapshot after the previous decision committed. Without the lock two
    ///    concurrent pre-checkouts both pass, each on a snapshot without the other's `checkout` (RULINGS 14);
    /// 2. one conditional UPDATE moves the order to `checkout`: the payer's own order, at its amount, in `XTR`,
    ///    payable, not owned, and no order of the payer for the product (this one included) in `checkout` inside
    ///    [`CHECKOUT_LOCK_SECS`];
    /// 3. no row → one read classifies the refusal.
    ///
    /// The `orders` row is the only write: nothing is granted here. `NO KEY UPDATE` does not conflict with the
    /// `KEY SHARE` locks of foreign-key checks, so saves and grants never wait on it.
    pub async fn pre_checkout(
        &self,
        payer: UserId,
        order: &OrderId,
        currency: &str,
        total_amount: u32,
        now: i64,
    ) -> Result<PreCheckoutVerdict, sqlx::Error> {
        let currency = without_nul(currency);
        let amount = i64::from(total_amount);
        let payable_after = now.saturating_sub(ORDER_PAYABLE_SECS);
        let locked_after = now.saturating_sub(CHECKOUT_LOCK_SECS);
        let mut tx = self.pool.begin().await?;
        // No users row: no lock, and the UPDATE below cannot match (`user_id = $1` names no order).
        sqlx::query("SELECT 1 FROM users WHERE id = $1 FOR NO KEY UPDATE")
            .bind(payer.0)
            .execute(&mut *tx)
            .await?;
        // The window subquery has no `o2.id <> orders.id`: it sees this order too, so the same order opened on two
        // devices is refused while its own `checkout_at` is inside the window.
        let entered: Option<String> = sqlx::query_scalar(
            "UPDATE orders SET status = 'checkout', checkout_at = $3 \
             WHERE id = $2 AND user_id = $1 AND amount = $4 AND $5 = 'XTR' \
             AND status IN ('created', 'checkout') AND created_at > $6 \
             AND NOT EXISTS (SELECT 1 FROM entitlements e \
                             WHERE e.user_id = orders.user_id AND e.product_id = orders.product_id) \
             AND NOT EXISTS (SELECT 1 FROM orders o2 \
                             WHERE o2.user_id = orders.user_id AND o2.product_id = orders.product_id \
                             AND o2.status = 'checkout' AND o2.checkout_at > $7) \
             RETURNING id",
        )
        .bind(payer.0)
        .bind(&order.0)
        .bind(now)
        .bind(amount)
        .bind(&*currency)
        .bind(payable_after)
        .bind(locked_after)
        .fetch_optional(&mut *tx)
        .await?;
        let verdict = if entered.is_some() {
            PreCheckoutVerdict::Ok
        } else {
            let facts: Option<OrderFacts> = sqlx::query_as(
                "SELECT o.user_id, o.amount, o.status, o.created_at, \
                 EXISTS (SELECT 1 FROM entitlements e \
                         WHERE e.user_id = o.user_id AND e.product_id = o.product_id), \
                 EXISTS (SELECT 1 FROM orders o2 \
                         WHERE o2.user_id = o.user_id AND o2.product_id = o.product_id \
                         AND o2.status = 'checkout' AND o2.checkout_at > $2) \
                 FROM orders o WHERE o.id = $1",
            )
            .bind(&order.0)
            .bind(locked_after)
            .fetch_optional(&mut *tx)
            .await?;
            PreCheckoutVerdict::Reject(classify(facts, payer, amount, &currency, payable_after))
        };
        tx.commit().await?;
        Ok(verdict)
    }

    /// The grant for `fact`, received at `now` (the server's clock, never Telegram's message date), in one READ
    /// COMMITTED transaction, written first and with no payer lock: every step is arbitrated by a key or one row.
    /// 1. The payment row, `ON CONFLICT ON CONSTRAINT payments_pkey DO NOTHING`: no row back → `Duplicate`. A twin
    ///    delivery waits on the first one's uncommitted key, then skips; never a check-then-insert.
    /// 2. The order → `paid`, only if it is the payer's, at this amount, in `XTR`, and still `created` / `checkout`:
    ///    no row → `OrderMismatch` (recorded, no grant).
    /// 3. The order's product: a chapter → the entitlement, `ON CONFLICT ON CONSTRAINT entitlements_pkey DO NOTHING`
    ///    (no row → `AlreadyEntitled`); a pack → the credit of the kind and amount the order bound at invoice time
    ///    (never the catalog's current values), keyed `pay:<charge>` (M19); an id no product grammar knows →
    ///    `UnknownProduct`, the order paid with no entitlement and no credit.
    /// 4. An unapplied outcome ([`GrantOutcome::unapplied`]) inserts the charge's `auto_refunds` row, due at `now`,
    ///    before the commit (owner Q9): the money fact and the decision to refund it commit together, so a crash after
    ///    the commit cannot leave an unapplied charge with no refund scheduled (a redelivery is `Duplicate` and could
    ///    not schedule it again). The row is a new key, locked last.
    ///
    /// Every outcome commits; only an `Err` does not.
    pub async fn grant(&self, fact: &PaymentFact, now: i64) -> Result<GrantOutcome, sqlx::Error> {
        let charge = without_nul(&fact.charge.0);
        let payload = without_nul(&fact.invoice_payload);
        let currency = without_nul(&fact.currency);
        let provider = without_nul(&fact.provider_charge);
        let amount = i64::from(fact.total_amount);
        let mut tx = self.pool.begin().await?;
        let fresh: Option<String> = sqlx::query_scalar(
            "INSERT INTO payments (telegram_payment_charge_id, invoice_payload, user_id, amount, currency, \
             provider_payment_charge_id, paid_at) VALUES ($1, $2, $3, $4, $5, $6, $7) \
             ON CONFLICT ON CONSTRAINT payments_pkey DO NOTHING \
             RETURNING telegram_payment_charge_id",
        )
        .bind(&*charge)
        .bind(&*payload)
        .bind(fact.payer.0)
        .bind(amount)
        .bind(&*currency)
        .bind(&*provider)
        .bind(now)
        .fetch_optional(&mut *tx)
        .await?;
        if fresh.is_none() {
            tx.commit().await?;
            return Ok(GrantOutcome::Duplicate);
        }
        let paid: Option<(String, Option<String>, Option<i64>)> = sqlx::query_as(
            "UPDATE orders SET status = 'paid', paid_at = $5, charge_id = $1 \
             WHERE id = $2 AND user_id = $3 AND amount = $4 AND $6 = 'XTR' \
             AND status IN ('created', 'checkout') \
             RETURNING product_id, pack_kind, pack_amount",
        )
        .bind(&*charge)
        .bind(&*payload)
        .bind(fact.payer.0)
        .bind(amount)
        .bind(now)
        .bind(&*currency)
        .fetch_optional(&mut *tx)
        .await?;
        let Some((product, pack_kind, pack_amount)) = paid else {
            schedule_auto_refund(&mut tx, &charge, now).await?;
            tx.commit().await?;
            return Ok(GrantOutcome::OrderMismatch);
        };
        // No wildcard arm: a new product kind does not compile until its grant is written here (M19).
        let outcome = match parse_product_id(&product) {
            Some(ProductRef::Chapter { .. }) => {
                let granted: Option<String> = sqlx::query_scalar(
                    "INSERT INTO entitlements (user_id, product_id, charge_id, granted_at) \
                     VALUES ($1, $2, $3, $4) \
                     ON CONFLICT ON CONSTRAINT entitlements_pkey DO NOTHING \
                     RETURNING product_id",
                )
                .bind(fact.payer.0)
                .bind(&product)
                .bind(&*charge)
                .bind(now)
                .fetch_optional(&mut *tx)
                .await?;
                if granted.is_some() {
                    GrantOutcome::Granted
                } else {
                    GrantOutcome::AlreadyEntitled
                }
            }
            // The order's binding, never the catalog: a pack changed or retired since the invoice credits what the
            // invoice advertised (revision 1, W3).
            Some(ProductRef::Pack { .. }) => match (pack_kind, pack_amount) {
                (Some(kind), Some(amount)) => {
                    let kind = ResourceKind(kind);
                    let credit = Entry {
                        user: fact.payer,
                        kind: &kind,
                        amount,
                        reason: Reason::Pack,
                        idem_key: pay_key(&charge),
                        charge_id: Some(&*charge),
                        counterpart: None,
                        r#ref: Some(product.as_str()),
                        at: now,
                    };
                    // `Duplicate` cannot follow a fresh payments row (the key is the charge's): the credit exists
                    // once either way.
                    credit_in_tx(&mut tx, &credit).await?;
                    GrantOutcome::Granted
                }
                // Unreachable under `orders_pack_binding`: recorded, nothing credited.
                _ => GrantOutcome::UnknownProduct,
            },
            None => GrantOutcome::UnknownProduct,
        };
        if outcome.unapplied() {
            schedule_auto_refund(&mut tx, &charge, now).await?;
        }
        tx.commit().await?;
        Ok(outcome)
    }

    /// The revoke of `charge` at `now` (K20, M20), in one READ COMMITTED transaction, its statements in the grant's
    /// order (payments, orders, entitlements, the ledger key, the balance row):
    /// 1. the payment → refunded, only if it is not yet: this single-row guard is the exactly-once arbiter. A twin
    ///    waits on the row lock, then READ COMMITTED re-checks the committed row and finds it set. No row back → one
    ///    read tells `AlreadyRefunded` from `UnknownCharge`, and nothing is written;
    /// 2. the successor of the charge's entitlement, if it has one (RULINGS 96): the payer's oldest other unrefunded
    ///    charge whose own order of the entitlement's product is `paid` and which keys no entitlement, i.e. a second
    ///    payment of the chapter that slipped past the checkout window (`AlreadyEntitled`, notified as unapplied). An
    ///    order is `paid` only by a grant that matched it, so its product and price are proven; an `OrderMismatch` or
    ///    `UnknownProduct` charge, another user's, a pack's or a refunded one never qualifies, and neither does a
    ///    charge with an `auto_refunds` row (pending, given up or settled: owner Q9 refunds it, so it never keys an
    ///    entitlement). The candidates' payment rows are locked `FOR SHARE` (RULINGS 97 Q10): a concurrent refund of a
    ///    candidate holds its row from its guard, so this read waits, then re-checks the row's `refunded_at` and drops
    ///    it;
    /// 3. the charge's order → `refunded`, if it has one;
    /// 4. the charge's entitlement re-keyed to the successor (`granted_at` kept: access never lapsed), or deleted
    ///    when there is none (an `AlreadyEntitled` charge keys none: the entitlement is another charge's);
    /// 5. the pack credit of the charge (its `pay:<charge>` row, never the catalog) clawed back, keyed
    ///    `refund:<charge>`: the balance first, the rest as debt. No credit (an unapplied charge, a chapter) → none;
    /// 6. the charge's `auto_refunds` row, if it has one, settled (`due_at` NULL): whichever path refunded the charge
    ///    (the automatic attempt, the admin's `/refund`, Telegram's `refunded_payment`), it is never attempted again.
    ///
    /// Every undo is keyed by the charge's own rows, so an entitlement without an order is revoked too. No statistics
    /// or ledger row is deleted (ST4). The re-key grants nothing: the row this charge's `successful_payment` created
    /// moves to a charge recorded by its own `payments_pkey` insert, and `entitlements_charge_key` keeps every charge
    /// applied at most once. The lock order is all payments rows (the guard's, then the candidates'), then orders,
    /// entitlements, the ledger key, the balance, and last the charge's own `auto_refunds` row.
    ///
    /// The residual of RULINGS 100 is closed by owner Q9 (closure (B) ruled covered): a grant of a new charge C of the
    /// same chapter whose entitlement insert (`ON CONFLICT DO NOTHING`, no payer lock) runs between step 2 and step 4
    /// meets the committed entitlement row and returns `AlreadyEntitled` without waiting, so step 4 deletes. C's grant
    /// committed C's `auto_refunds` row, so C is refunded automatically (its first attempt right after its grant, the
    /// sweep after that), never left paid and unapplied; and since step 2 skips every charge with such a row, the
    /// window no longer changes the outcome: C is refunded whether its grant ran inside it or before step 2.
    pub async fn revoke(&self, charge: &ChargeId, now: i64) -> Result<RevokeOutcome, sqlx::Error> {
        let charge = without_nul(&charge.0);
        let mut tx = self.pool.begin().await?;
        // `GREATEST`: a clock stepped back since the grant would otherwise break `payments_refunded_after_paid`
        // (`23514`), a 500 Telegram redelivers for good.
        let payer: Option<i64> = sqlx::query_scalar(
            "UPDATE payments SET refunded_at = GREATEST($2, paid_at) \
             WHERE telegram_payment_charge_id = $1 AND refunded_at IS NULL RETURNING user_id",
        )
        .bind(&*charge)
        .bind(now)
        .fetch_optional(&mut *tx)
        .await?;
        let Some(payer) = payer else {
            let known: bool = sqlx::query_scalar(
                "SELECT EXISTS (SELECT 1 FROM payments WHERE telegram_payment_charge_id = $1)",
            )
            .bind(&*charge)
            .fetch_one(&mut *tx)
            .await?;
            tx.commit().await?;
            return Ok(if known {
                RevokeOutcome::AlreadyRefunded
            } else {
                RevokeOutcome::UnknownCharge
            });
        };
        // Fetched whole (0-2 rows in practice, each locked until the commit) and its first row taken: the oldest. The
        // charge itself is out twice: the guard just set its `refunded_at`, and it keys the entitlement. The
        // `p.refunded_at IS NULL` predicate stays although committed states exclude a refunded candidate already by
        // `o.status = 'paid'` (every revoke sets its order `refunded`): after the `FOR SHARE` wait, READ COMMITTED
        // re-checks the locked `p` row's new version but keeps the joined `o` row's old one.
        let successors: Vec<String> = sqlx::query_scalar(
            "SELECT p.telegram_payment_charge_id \
             FROM entitlements e \
             JOIN orders o ON o.user_id = e.user_id AND o.product_id = e.product_id AND o.status = 'paid' \
             JOIN payments p ON p.telegram_payment_charge_id = o.charge_id \
             WHERE e.charge_id = $1 AND p.user_id = e.user_id AND p.refunded_at IS NULL \
             AND NOT EXISTS (SELECT 1 FROM entitlements e2 \
                             WHERE e2.charge_id = p.telegram_payment_charge_id) \
             AND NOT EXISTS (SELECT 1 FROM auto_refunds r \
                             WHERE r.charge_id = p.telegram_payment_charge_id) \
             ORDER BY p.paid_at, p.telegram_payment_charge_id \
             FOR SHARE OF p",
        )
        .bind(&*charge)
        .fetch_all(&mut *tx)
        .await?;
        let successor = successors.into_iter().next();
        let product: Option<String> = sqlx::query_scalar(
            "UPDATE orders SET status = 'refunded' WHERE charge_id = $1 RETURNING product_id",
        )
        .bind(&*charge)
        .fetch_optional(&mut *tx)
        .await?;
        // No wildcard arm: a new product kind does not compile until its undo is reviewed here, as its grant is in
        // `grant`. Both kinds known today are undone by the charge's own rows below, whatever the order says.
        if let Some(product) = &product {
            match parse_product_id(product) {
                Some(ProductRef::Chapter { .. }) | Some(ProductRef::Pack { .. }) | None => {}
            }
        }
        match &successor {
            Some(successor) => {
                // `granted_at` stays: access never lapsed.
                sqlx::query("UPDATE entitlements SET charge_id = $2 WHERE charge_id = $1")
                    .bind(&*charge)
                    .bind(successor)
                    .execute(&mut *tx)
                    .await?;
                tracing::info!(
                    charge = %charge,
                    successor = %successor,
                    "revoke: entitlement re-keyed to the oldest other paid charge"
                );
            }
            None => {
                sqlx::query("DELETE FROM entitlements WHERE charge_id = $1")
                    .bind(&*charge)
                    .execute(&mut *tx)
                    .await?;
            }
        }
        if let Some((kind, credited)) = credited_by_charge(&mut tx, &charge).await? {
            let clawback = Entry {
                user: UserId(payer),
                kind: &kind,
                amount: -credited,
                reason: Reason::PackRefund,
                idem_key: refund_key(&charge),
                charge_id: Some(&*charge),
                counterpart: None,
                r#ref: product.as_deref(),
                at: now,
            };
            // A `Duplicate` cannot follow the guard above (the key is the charge's): the clawback exists once.
            clawback_in_tx(&mut tx, &clawback).await?;
        }
        // In the guard's transaction: `due_at IS NOT NULL` never outlives the `refunded_at` set above.
        sqlx::query("UPDATE auto_refunds SET due_at = NULL WHERE charge_id = $1")
            .bind(&*charge)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(RevokeOutcome::Revoked)
    }

    /// The claim of `charge`'s next automatic refund attempt at `now`, in one autocommit statement: the row is
    /// claimed only while it is due (`due_at <= now`), its `due_at` moved to `lease_until` and its attempts counted.
    /// This guarded `UPDATE` is the exactly-once arbiter among attempts, never a read then a write: a twin claimer
    /// waits on the row lock, then READ COMMITTED re-checks the committed row, finds `due_at` past `now` and gets no
    /// row. An attempt that dies after its claim leaves the row claimable again at `lease_until`. `None`: not due,
    /// claimed by another attempt, settled or given up. The payer comes from the payment row, never a request.
    pub async fn claim_auto_refund(
        &self,
        charge: &ChargeId,
        now: i64,
        lease_until: i64,
    ) -> Result<Option<(UserId, i64)>, sqlx::Error> {
        let charge = without_nul(&charge.0);
        let claimed: Option<(i64, i64)> = sqlx::query_as(
            "UPDATE auto_refunds r SET due_at = $3, attempts = r.attempts + 1 \
             FROM payments p \
             WHERE r.charge_id = $1 AND r.due_at <= $2 AND p.telegram_payment_charge_id = r.charge_id \
             RETURNING p.user_id, r.attempts",
        )
        .bind(&*charge)
        .bind(now)
        .bind(lease_until)
        .fetch_optional(&self.pool)
        .await?;
        Ok(claimed.map(|(payer, attempts)| (UserId(payer), attempts)))
    }

    /// The write of `charge`'s failed attempt number `attempt`: due again at `next_due`, `error` recorded, a refusal
    /// counted when `refused`. Only the claim of that attempt can write it (`attempts = attempt`: a claimer whose lease
    /// ran out cannot overwrite a newer attempt), and only while the row is pending (`due_at IS NOT NULL`: a failure
    /// never revives a row a refund on another path settled). It never writes a settled state: `refunded_at` is the
    /// revoke's alone.
    pub async fn auto_refund_failed(
        &self,
        charge: &ChargeId,
        attempt: i64,
        refused: bool,
        next_due: i64,
        error: &str,
    ) -> Result<AutoRefundRetry, sqlx::Error> {
        let charge = without_nul(&charge.0);
        let error = without_nul(error);
        let written: Option<String> = sqlx::query_scalar(
            "UPDATE auto_refunds SET due_at = $3, last_error = $4, refusals = refusals + $5 \
             WHERE charge_id = $1 AND attempts = $2 AND due_at IS NOT NULL \
             RETURNING charge_id",
        )
        .bind(&*charge)
        .bind(attempt)
        .bind(next_due)
        .bind(&*error)
        .bind(i64::from(refused))
        .fetch_optional(&self.pool)
        .await?;
        Ok(match written {
            Some(_) => AutoRefundRetry::Scheduled,
            None => AutoRefundRetry::Superseded,
        })
    }

    /// `charge`'s `auto_refunds` row settled (`due_at` NULL), for a charge the revoke found refunded already: the
    /// revoke settles the row of every refund it records, so this only matters for a `refunded_at` written outside it
    /// (critique O3), which would otherwise be claimed again at every lease.
    pub async fn settle_auto_refund(&self, charge: &ChargeId) -> Result<(), sqlx::Error> {
        let charge = without_nul(&charge.0);
        sqlx::query("UPDATE auto_refunds SET due_at = NULL WHERE charge_id = $1")
            .bind(&*charge)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    /// The payment row of `charge` (one primary-key read), or `None` when no payment has it.
    pub async fn payment_record(
        &self,
        charge: &ChargeId,
    ) -> Result<Option<PaymentRecord>, sqlx::Error> {
        let charge = without_nul(&charge.0);
        let row: Option<(i64, i64, String, String, Option<i64>)> = sqlx::query_as(
            "SELECT user_id, amount, currency, invoice_payload, refunded_at FROM payments \
             WHERE telegram_payment_charge_id = $1",
        )
        .bind(&*charge)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(
            |(payer, amount, currency, invoice_payload, refunded_at)| PaymentRecord {
                payer: UserId(payer),
                amount,
                currency,
                invoice_payload,
                refunded_at,
            },
        ))
    }

    /// `user`'s newest `limit` payments, newest first (`paid_at`, then the charge id, descending), each with whether
    /// it granted anything (an entitlement or a ledger row of the charge: both are indexed by charge), and how many
    /// payments `user` has in all; one statement on `payments_by_user`.
    pub async fn charges_of(
        &self,
        user: UserId,
        limit: i64,
    ) -> Result<(Vec<ChargeLine>, i64), sqlx::Error> {
        let rows: Vec<ChargeRow> = sqlx::query_as(
            "SELECT p.telegram_payment_charge_id, p.amount, p.paid_at, p.refunded_at, \
             EXISTS (SELECT 1 FROM entitlements e WHERE e.charge_id = p.telegram_payment_charge_id) \
             OR EXISTS (SELECT 1 FROM resource_ledger l WHERE l.charge_id = p.telegram_payment_charge_id), \
             count(*) OVER () \
             FROM payments p WHERE p.user_id = $1 \
             ORDER BY p.paid_at DESC, p.telegram_payment_charge_id DESC LIMIT $2",
        )
        .bind(user.0)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;
        let total = rows.first().map_or(0, |row| row.5);
        let lines = rows
            .into_iter()
            .map(
                |(charge, amount, paid_at, refunded_at, applied, _)| ChargeLine {
                    charge,
                    amount,
                    paid_at,
                    refunded_at,
                    applied,
                },
            )
            .collect();
        Ok((lines, total))
    }
}

/// One `charges_of` row: (charge, amount, paid_at, refunded_at, applied, the user's payment count).
type ChargeRow = (String, i64, i64, Option<i64>, bool, i64);

/// The `auto_refunds` row of the unapplied charge `charge` (already through `without_nul`), due at `now` with no
/// attempt yet, in the grant's transaction `c`. The key cannot exist (the grant just inserted the charge's payment);
/// `DO NOTHING` keeps a conflict from turning a recorded money fact into an error.
async fn schedule_auto_refund(
    c: &mut PgConnection,
    charge: &str,
    now: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO auto_refunds (charge_id, created_at, attempts, refusals, due_at) VALUES ($1, $2, 0, 0, $2) \
         ON CONFLICT ON CONSTRAINT auto_refunds_pkey DO NOTHING",
    )
    .bind(charge)
    .bind(now)
    .execute(&mut *c)
    .await?;
    Ok(())
}

/// The idempotency key of the pack clawback of `charge` (already through `without_nul`): `refund:<charge>`.
fn refund_key(charge: &str) -> String {
    // `push_str`, not string formatting: this module holds SQL, and the dynamic-SQL scan flags formatting near it.
    let mut key = String::with_capacity(REFUND_KEY_PREFIX.len() + charge.len());
    key.push_str(REFUND_KEY_PREFIX);
    key.push_str(charge);
    key
}

/// Why the UPDATE matched no row, read in the same transaction, in a fixed precedence: unknown, then a mismatch,
/// then owned, in progress, expired. Anything else cannot happen under the payer lock and answers `Temporary`.
fn classify(
    facts: Option<OrderFacts>,
    payer: UserId,
    amount: i64,
    currency: &str,
    payable_after: i64,
) -> RejectReason {
    let Some((user, order_amount, status, created_at, owned, in_progress)) = facts else {
        return RejectReason::UnknownOrder;
    };
    if user != payer.0 || order_amount != amount || currency != "XTR" {
        RejectReason::Mismatch
    } else if owned {
        RejectReason::AlreadyOwned
    } else if in_progress {
        RejectReason::InProgress
    } else if created_at <= payable_after || !matches!(status.as_str(), "created" | "checkout") {
        RejectReason::Expired
    } else {
        tracing::error!(%status, "pre-checkout refused with no reason found; answered as temporary");
        RejectReason::Temporary
    }
}
