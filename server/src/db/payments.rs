//! The payment path's SQL (PP "Payment flow end to end"): the pre-checkout decision, which locks the payer's row
//! and then moves the order to `checkout` in one conditional statement (RULINGS 14, M19), and the grant on
//! `successful_payment`, written first and made idempotent by the `payments_pkey` arbiter (K19).
//!
//! The money-fact, decision and outcome types live here, next to the statements that bind and decide them;
//! `telegram::payments` re-exports them, so `db/` never imports `telegram/`. Every Telegram string is bound through
//! [`without_nul`].

use crate::catalog::{ProductRef, parse_product_id};
use crate::db::{Repo, without_nul};
use crate::ids::{ChargeId, OrderId, UserId};

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
    /// Recorded, the order paid, the product granted.
    Granted,
    /// The charge was recorded before (a redelivery, or its concurrent twin): nothing changed.
    Duplicate,
    /// Recorded and the order paid, but the payer already owned the product (a second paid order slipped past the
    /// checkout window): not applied.
    AlreadyEntitled,
    /// Recorded, but the payload names no order of this payer at this amount in `XTR` that is still payable (unknown,
    /// another payer's, another amount or currency, already paid): not applied.
    OrderMismatch,
    /// Recorded and the order paid, but its product id names no product kind this build can grant: not applied.
    UnknownProduct,
}

/// The user an order belongs to, as Telegram's `from` would name them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OrderPayer {
    /// The Telegram user id.
    pub user: UserId,
    /// The first name of the user's last login.
    pub first_name: String,
    /// The Telegram language tag of the user's last login.
    pub language_code: Option<String>,
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
    ///    (no row → `AlreadyEntitled`); an id no product grammar knows → `UnknownProduct`, the order paid with no
    ///    entitlement.
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
        let product: Option<String> = sqlx::query_scalar(
            "UPDATE orders SET status = 'paid', paid_at = $5, charge_id = $1 \
             WHERE id = $2 AND user_id = $3 AND amount = $4 AND $6 = 'XTR' \
             AND status IN ('created', 'checkout') \
             RETURNING product_id",
        )
        .bind(&*charge)
        .bind(&*payload)
        .bind(fact.payer.0)
        .bind(amount)
        .bind(now)
        .bind(&*currency)
        .fetch_optional(&mut *tx)
        .await?;
        let Some(product) = product else {
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
            None => GrantOutcome::UnknownProduct,
        };
        tx.commit().await?;
        Ok(outcome)
    }

    /// The payer of `order`: its user's id, first name and Telegram language, or `None` for an unknown order. Read
    /// only by `server-dev`'s simulated payments, whose request names an invoice slug and no user; the production
    /// server never calls it.
    pub async fn order_payer(&self, order: &OrderId) -> Result<Option<OrderPayer>, sqlx::Error> {
        let row: Option<(i64, String, Option<String>)> = sqlx::query_as(
            "SELECT u.id, u.first_name, u.language_code FROM orders o JOIN users u ON u.id = o.user_id \
             WHERE o.id = $1",
        )
        .bind(&order.0)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(|(id, first_name, language_code)| OrderPayer {
            user: UserId(id),
            first_name,
            language_code,
        }))
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
