//! The payment path's SQL (PP "Payment flow end to end"): the pre-checkout decision, which locks the payer's row
//! and then moves the order to `checkout` in one conditional statement (RULINGS 14, M19).
//!
//! The decision types live here, next to the statements that decide them; `telegram::payments` re-exports them, so
//! `db/` never imports `telegram/`. Every Telegram string is bound through [`without_nul`].

use crate::db::{Repo, without_nul};
use crate::ids::{OrderId, UserId};

/// How long an order that entered `checkout` blocks every pre-checkout of the same user and product, its own
/// included, in seconds (K18): a payment that failed after an accepted pre-checkout can be retried after this.
pub const CHECKOUT_LOCK_SECS: i64 = 120;

/// How long an order can be paid after it was created, in seconds (PP P5: `created_at > now - 86400`).
pub const ORDER_PAYABLE_SECS: i64 = 86_400;

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
