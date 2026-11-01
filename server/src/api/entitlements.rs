//! `GET /api/entitlements`: the chapter products with their catalog prices, and whether the user owns each. The
//! server decides `owned` from its own rows (principle 1); no client state unlocks anything.

use std::collections::HashSet;

use axum::Json;
use axum::extract::State;

use crate::AppState;
use crate::api::dto::{EntitlementsResponse, ProductDto};
use crate::auth::AuthUser;
use crate::catalog::ProductRef;
use crate::error::ApiError;

/// `GET /api/entitlements`: every chapter product of the catalog in index order, priced by `server/catalog.json`;
/// an owned row whose product the catalog does not sell is not listed.
pub async fn get_entitlements(
    State(st): State<AppState>,
    AuthUser(user): AuthUser,
) -> Result<Json<EntitlementsResponse>, ApiError> {
    let owned: HashSet<_> = st.repo.entitlements(user).await?.into_iter().collect();
    let products = st
        .catalog
        .chapters()
        .filter_map(|product| match &product.kind {
            ProductRef::Chapter { chapter } => Some(ProductDto {
                product_id: product.id.0.clone(),
                chapter_id: chapter.0.clone(),
                price_stars: product.price_stars,
                owned: owned.contains(&product.id),
            }),
            // A pack is a consumable bought into a balance, never an entitlement.
            ProductRef::Pack { .. } => None,
        })
        .collect();
    Ok(Json(EntitlementsResponse { products }))
}
