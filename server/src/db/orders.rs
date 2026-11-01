//! The `orders` table: one row per Stars invoice the server created (PP P3). This module writes only the insert of a
//! `created` order (with a pack's binding) and its invoice link, and reads an order for its owner; the grant that
//! moves an order is `db/payments.rs`'s.
//!
//! The order id grammar lives here too: `ids.rs` holds the type, and an id is minted and parsed only next to the rows
//! it names.

use serde::Serialize;
use ts_rs::TS;

use crate::catalog::Product;
use crate::db::Repo;
use crate::ids::{OrderId, ProductId, UserId};

/// How long a `created` order with a link is handed out again, in seconds (PP "HTTP API": younger than 1 h).
pub const ORDER_REUSE_SECS: i64 = 3600;

/// The prefix of every order id.
const ORDER_PREFIX: &str = "o_";

/// The hex digits after [`ORDER_PREFIX`]: 16 random bytes.
const ORDER_HEX_LEN: usize = 32;

/// An order's status: the `orders.status` values (`orders_status_known`), and their wire form in `OrderResponse`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "lowercase")]
pub enum OrderStatus {
    /// Invoiced, not paid.
    Created,
    /// A pre-checkout was accepted; the payment is pending.
    Checkout,
    /// Paid: the grant happened.
    Paid,
    /// Paid, then refunded.
    Refunded,
}

impl OrderStatus {
    /// The status the column value `s` names: exactly one of the four, as serde spells it.
    pub fn parse(s: &str) -> Option<OrderStatus> {
        match s {
            "created" => Some(OrderStatus::Created),
            "checkout" => Some(OrderStatus::Checkout),
            "paid" => Some(OrderStatus::Paid),
            "refunded" => Some(OrderStatus::Refunded),
            _ => None,
        }
    }
}

/// One of the user's orders, as `GET /api/orders/{orderId}` reports it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UserOrder {
    /// The product the order is for.
    pub product: ProductId,
    /// The order's status.
    pub status: OrderStatus,
}

/// What [`Repo::reuse_or_create_order`] did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InvoiceOrder {
    /// A `created` order of the same user, product, amount and pack binding, younger than [`ORDER_REUSE_SECS`] and
    /// with a link: its link is handed out again, with no Bot API call.
    Reused {
        /// The order.
        order: OrderId,
        /// Its invoice link.
        invoice_url: String,
    },
    /// A new `created` order without a link, committed.
    Created {
        /// The order: also the invoice payload.
        order: OrderId,
        /// The user's Telegram language tag, for the invoice texts.
        language_code: Option<String>,
    },
}

/// A new order id: [`ORDER_PREFIX`] + 32 lower-case hex of 16 OS-random bytes (34 bytes, within the payload's 128).
pub fn new_order_id() -> OrderId {
    let mut bytes = [0u8; ORDER_HEX_LEN / 2];
    getrandom::fill(&mut bytes).expect(
        "invariant: the OS random source works (ProcessPrng on Windows 10+ is documented never to fail)",
    );
    // `push_str`, not string formatting: this module holds SQL, and the dynamic-SQL scan flags formatting near it.
    let mut id = String::with_capacity(ORDER_PREFIX.len() + ORDER_HEX_LEN);
    id.push_str(ORDER_PREFIX);
    id.push_str(&hex::encode(bytes));
    OrderId(id)
}

/// The order id `s` spells: exactly `o_` + 32 lower-case hex, the form [`new_order_id`] mints. Anything else names no
/// order, so it never reaches SQL (a U+0000 would be a PostgreSQL `22021`).
pub fn parse_order_id(s: &str) -> Option<OrderId> {
    let hex = s.strip_prefix(ORDER_PREFIX)?;
    let ok =
        hex.len() == ORDER_HEX_LEN && hex.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'));
    ok.then(|| OrderId(s.to_owned()))
}

impl Repo {
    /// The order a `POST /api/invoices` of the catalog's `product` by `user` at `now` hands out: the newest `created`
    /// order of the same user, product, price and pack binding, younger than [`ORDER_REUSE_SECS`] and with a link;
    /// else a new `created` order in `XTR` at the product's price, binding a pack's kind and amount (`NULL` for a
    /// chapter: `orders_pack_binding`), read back with the user's language. One READ COMMITTED transaction, committed
    /// before the caller asks the Bot API for a link: no lock is held across that call.
    ///
    /// The price and the binding come from the one catalog product that also titles the invoice (M19). An order
    /// without a link is never reused (its link call failed or is still running), and a deploy inside the hour that
    /// changes a price or a pack's amount makes a new order, so a reused invoice credits what the catalog lists. Two
    /// concurrent first taps can make two orders; a double payment is closed at pre-checkout.
    pub async fn reuse_or_create_order(
        &self,
        user: UserId,
        product: &Product,
        now: i64,
    ) -> Result<InvoiceOrder, sqlx::Error> {
        let amount = i64::from(product.price_stars);
        let (pack_kind, pack_amount) = match &product.pack {
            Some(pack) => (Some(pack.kind.0.as_str()), Some(i64::from(pack.amount))),
            None => (None, None),
        };
        let mut tx = self.pool.begin().await?;
        let recent: Option<(String, String)> = sqlx::query_as(
            "SELECT id, invoice_url FROM orders \
             WHERE user_id = $1 AND product_id = $2 AND amount = $3 AND status = 'created' \
             AND invoice_url IS NOT NULL AND created_at > $4 \
             AND pack_kind IS NOT DISTINCT FROM $5 AND pack_amount IS NOT DISTINCT FROM $6 \
             ORDER BY created_at DESC, id DESC LIMIT 1",
        )
        .bind(user.0)
        .bind(&product.id.0)
        .bind(amount)
        .bind(now.saturating_sub(ORDER_REUSE_SECS))
        .bind(pack_kind)
        .bind(pack_amount)
        .fetch_optional(&mut *tx)
        .await?;
        if let Some((order, invoice_url)) = recent {
            tx.commit().await?;
            return Ok(InvoiceOrder::Reused {
                order: OrderId(order),
                invoice_url,
            });
        }
        let order = new_order_id();
        sqlx::query(
            "INSERT INTO orders (id, user_id, product_id, amount, currency, status, created_at, pack_kind, \
             pack_amount) VALUES ($1, $2, $3, $4, 'XTR', 'created', $5, $6, $7)",
        )
        .bind(&order.0)
        .bind(user.0)
        .bind(&product.id.0)
        .bind(amount)
        .bind(now)
        .bind(pack_kind)
        .bind(pack_amount)
        .execute(&mut *tx)
        .await?;
        // The insert's foreign key just proved the row exists.
        let language_code: Option<String> =
            sqlx::query_scalar("SELECT language_code FROM users WHERE id = $1")
                .bind(user.0)
                .fetch_one(&mut *tx)
                .await?;
        tx.commit().await?;
        Ok(InvoiceOrder::Created {
            order,
            language_code,
        })
    }

    /// `order` if it belongs to `user`: one `orders_pkey` lookup with the user bound, so another user's order is
    /// `None`, like an unknown one. A status outside the four (the CHECK forbids it) is a decode error.
    pub async fn order_for_user(
        &self,
        user: UserId,
        order: &OrderId,
    ) -> Result<Option<UserOrder>, sqlx::Error> {
        let row: Option<(String, String)> =
            sqlx::query_as("SELECT product_id, status FROM orders WHERE id = $1 AND user_id = $2")
                .bind(&order.0)
                .bind(user.0)
                .fetch_optional(&self.pool)
                .await?;
        row.map(|(product, status)| {
            let status = OrderStatus::parse(&status).ok_or_else(|| {
                sqlx::Error::Decode("orders.status outside the known four".into())
            })?;
            Ok(UserOrder {
                product: ProductId(product),
                status,
            })
        })
        .transpose()
    }

    /// Records the invoice link of `order` (autocommit), after the Bot API returned it.
    pub async fn set_invoice_url(
        &self,
        order: &OrderId,
        invoice_url: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE orders SET invoice_url = $2 WHERE id = $1")
            .bind(&order.0)
            .bind(invoice_url)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}
