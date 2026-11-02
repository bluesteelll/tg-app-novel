//! The payment path's SQL (PP "Payment flow end to end"): the pre-checkout decision, which locks the payer's row
//! and then moves the order to `checkout` in one conditional statement (RULINGS 14, M19), the grant on
//! `successful_payment`, written first and made idempotent by the `payments_pkey` arbiter (K19), and the revoke of a
//! refund, made exactly-once by the payment row's `refunded_at IS NULL` guard (K20, M20).
//!
//! The money-fact, decision and outcome types live here, next to the statements that bind and decide them;
//! `telegram::payments` re-exports them, so `db/` never imports `telegram/`. Every Telegram string is bound through
//! [`without_nul`].

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

/// What a revoke did (K20). Only `Revoked` wrote anything.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RevokeOutcome {
    /// The payment is marked refunded, its order `refunded`, its entitlement deleted and its pack credit clawed back:
    /// whatever of these the charge had.
    Revoked,
    /// The payment was refunded before (a redelivery, the other refund path, or a concurrent twin): nothing changed.
    AlreadyRefunded,
    /// No payment has this charge id: nothing changed.
    UnknownCharge,
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
        tx.commit().await?;
        Ok(outcome)
    }

    /// The revoke of `charge` at `now` (K20, M20), in one READ COMMITTED transaction, its statements in the grant's
    /// order (payments, orders, entitlements, the ledger key, the balance row):
    /// 1. the payment → refunded, only if it is not yet: this single-row guard is the exactly-once arbiter. A twin
    ///    waits on the row lock, then READ COMMITTED re-checks the committed row and finds it set. No row back → one
    ///    read tells `AlreadyRefunded` from `UnknownCharge`, and nothing is written;
    /// 2. the charge's order → `refunded`, if it has one;
    /// 3. the charge's entitlement deleted, if it has one (an `AlreadyEntitled` charge has none: the entitlement is the
    ///    first charge's);
    /// 4. the pack credit of the charge (its `pay:<charge>` row, never the catalog) clawed back, keyed
    ///    `refund:<charge>`: the balance first, the rest as debt. No credit (an unapplied charge, a chapter) → none.
    ///
    /// Every undo is keyed by the charge's own rows, so an entitlement without an order is revoked too. No statistics
    /// or ledger row is deleted (ST4).
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
        sqlx::query("DELETE FROM entitlements WHERE charge_id = $1")
            .bind(&*charge)
            .execute(&mut *tx)
            .await?;
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
        tx.commit().await?;
        Ok(RevokeOutcome::Revoked)
    }
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
