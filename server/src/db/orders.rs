//! The `orders` table: one row per Stars invoice the server created (PP P3). This module writes only the insert of a
//! `created` order (with a pack's binding), bounded per user ([`OPEN_ORDERS_PER_WINDOW`] unpaid in a rolling hour),
//! and its invoice link, and reads an order for its owner; the grant that moves an order is `db/payments.rs`'s.
//!
//! The order id grammar lives here too: `ids.rs` holds the type, and an id is minted and parsed only next to the rows
//! it names.

use serde::Serialize;
use ts_rs::TS;

use crate::catalog::Product;
use crate::db::Repo;
use crate::ids::{OrderId, ProductId, UserId};

/// The window of the open-order bound, in seconds: a rolling hour.
pub const OPEN_ORDER_WINDOW_SECS: i64 = 3600;

/// The most unpaid orders (`created` or `checkout`) a user may open inside [`OPEN_ORDER_WINDOW_SECS`]: each cost one
/// `createInvoiceLink`, so the bound caps the Bot API calls a user can cause too.
pub const OPEN_ORDERS_PER_WINDOW: i64 = 10;

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

/// What [`Repo::create_order`] did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InvoiceOrder {
    /// A new `created` order without a link, committed.
    Created {
        /// The order: also the invoice payload.
        order: OrderId,
        /// The user's Telegram language tag, for the invoice texts.
        language_code: Option<String>,
    },
    /// The user has [`OPEN_ORDERS_PER_WINDOW`] unpaid orders inside the window: no order, no Bot API call.
    Limited {
        /// Seconds until the oldest of them leaves the window, 1..=[`OPEN_ORDER_WINDOW_SECS`].
        retry_after_secs: i64,
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
    /// A new `created` order for a `POST /api/invoices` of the catalog's `product` by `user` at `now`: in `XTR` at the
    /// product's price, binding a pack's kind and amount (`NULL` for a chapter: `orders_pack_binding`), read back with
    /// the user's language; or `Limited` when the user already has [`OPEN_ORDERS_PER_WINDOW`] unpaid orders created
    /// after `now - OPEN_ORDER_WINDOW_SECS`. One READ COMMITTED transaction, committed before the caller asks the Bot
    /// API for a link: no lock is held across that call.
    /// 1. The payer's `users` row is locked (`FOR NO KEY UPDATE`, the pre-checkout's mode): two POSTs of one user run
    ///    one after another, and the second one's count is a new statement whose snapshot holds the first one's
    ///    insert. Without the lock two POSTs both count 9 and both insert (no check-then-insert race).
    /// 2. The unpaid orders in the window are counted on `orders_by_user_product` (`user_id` leads it); `paid` and
    ///    `refunded` ones are not, so a paying reader is never bound. Ten or more → rolled back, `Limited`.
    /// 3. The insert, and the user's language read back.
    ///
    /// The lock order is users → orders, as the pre-checkout's; after the lock nothing waits on an existing row.
    ///
    /// No order is handed out again (K9): each POST is a new payload, so `createInvoiceLink` makes a new invoice with a
    /// slug TWA has not opened (it throws `WebAppInvoiceOpened` on one it has), and each order row costs one Bot API
    /// call. The price and the binding come from the one catalog product that also titles the invoice (M19). Two open
    /// orders of one product can coexist; a double payment of a chapter is closed at pre-checkout.
    pub async fn create_order(
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
        // No users row: no lock, and the insert's foreign key fails below.
        sqlx::query("SELECT 1 FROM users WHERE id = $1 FOR NO KEY UPDATE")
            .bind(user.0)
            .execute(&mut *tx)
            .await?;
        let (open, oldest): (i64, Option<i64>) = sqlx::query_as(
            "SELECT count(*), min(created_at) FROM orders \
             WHERE user_id = $1 AND status IN ('created', 'checkout') AND created_at > $2",
        )
        .bind(user.0)
        .bind(now.saturating_sub(OPEN_ORDER_WINDOW_SECS))
        .fetch_one(&mut *tx)
        .await?;
        if open >= OPEN_ORDERS_PER_WINDOW {
            tx.rollback().await?;
            // The oldest counted order leaves the window `OPEN_ORDER_WINDOW_SECS` after it was made.
            let retry_after_secs = oldest
                .unwrap_or(now)
                .saturating_add(OPEN_ORDER_WINDOW_SECS)
                .saturating_sub(now)
                .clamp(1, OPEN_ORDER_WINDOW_SECS);
            return Ok(InvoiceOrder::Limited { retry_after_secs });
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
