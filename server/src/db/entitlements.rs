//! The `entitlements` table, read here only: the one unlock fact (principle 1). A row is written by the idempotent
//! grant on `successful_payment` and deleted by a refund (later lanes); no grant path lives in this module.
//!
//! Plain autocommit reads under READ COMMITTED: a revoke that commits while a request runs is seen by that request
//! or by the next one.

use crate::db::Repo;
use crate::ids::{ProductId, UserId};

impl Repo {
    /// The products `user` owns, in product id order.
    pub async fn entitlements(&self, user: UserId) -> Result<Vec<ProductId>, sqlx::Error> {
        let products: Vec<String> = sqlx::query_scalar(
            "SELECT product_id FROM entitlements WHERE user_id = $1 ORDER BY product_id",
        )
        .bind(user.0)
        .fetch_all(&self.pool)
        .await?;
        Ok(products.into_iter().map(ProductId).collect())
    }

    /// Whether `user` owns `product`: one lookup on `entitlements_pkey`.
    pub async fn is_entitled(
        &self,
        user: UserId,
        product: &ProductId,
    ) -> Result<bool, sqlx::Error> {
        sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM entitlements WHERE user_id = $1 AND product_id = $2)",
        )
        .bind(user.0)
        .bind(&product.0)
        .fetch_one(&self.pool)
        .await
    }
}
