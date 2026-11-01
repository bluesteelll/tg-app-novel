//! `GET /api/wallet` (META-PLAN M17, M18): the user's resource balances and the packs for sale. A thin handler: the
//! balance rows come from `db/economy.rs`, the kinds, packs and hint cost from the catalog. Principle 1: the balances
//! are server rows; no client state is read.

use axum::Json;
use axum::extract::State;
use axum::http::HeaderValue;
use axum::http::header::{CACHE_CONTROL, HeaderName};
use axum::response::{IntoResponse, Response};

use crate::AppState;
use crate::api::dto::{BalanceDto, Localized, PackDto, WalletResponse};
use crate::auth::AuthUser;
use crate::error::ApiError;

/// The headers of a 200: one user's own figures, which no shared cache stores (the pair of `api/stats.rs`).
fn private_headers() -> [(HeaderName, HeaderValue); 1] {
    [(CACHE_CONTROL, HeaderValue::from_static("private, no-store"))]
}

/// `GET /api/wallet`: every kind the catalog declares, in its order, with the user's balance and debt (`0` / `0`
/// without a row, so a new player sees every kind); a row of a kind the catalog no longer declares is not listed.
/// Then the catalog's packs and the hint tier cost. One read; the 200 is `private, no-store`.
pub async fn get_wallet(
    State(st): State<AppState>,
    AuthUser(user): AuthUser,
) -> Result<Response, ApiError> {
    let rows = st.repo.balances(user).await?;
    let economy = st.catalog.economy();
    let balances = economy
        .kinds
        .iter()
        .map(|kind| {
            let row = rows.iter().find(|row| row.kind == kind.0);
            BalanceDto {
                kind: kind.0.clone(),
                balance: row.map_or(0, |row| row.balance),
                debt: row.map_or(0, |row| row.debt),
            }
        })
        .collect();
    let packs = st
        .catalog
        .packs()
        .filter_map(|product| {
            let pack = product.pack.as_ref()?;
            Some(PackDto {
                product_id: product.id.0.clone(),
                kind: pack.kind.0.clone(),
                amount: pack.amount,
                price_stars: product.price_stars,
                title: Localized {
                    ru: product.title.ru.clone(),
                    en: product.title.en.clone(),
                },
            })
        })
        .collect();
    let body = WalletResponse {
        balances,
        packs,
        hint_tier_cost: economy.hint_tier_cost,
    };
    Ok((private_headers(), Json(body)).into_response())
}
