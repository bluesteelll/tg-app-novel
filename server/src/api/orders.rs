//! `POST /api/invoices` (a Stars invoice link for a catalog product) and `GET /api/orders/{orderId}` (the status of
//! one of the user's orders). Thin handlers: the price and the texts come from the catalog, the order rows from
//! `db/orders.rs`, the link from the Bot API gateway.
//!
//! Principle 2: the order is committed before the gateway call, which runs outside any transaction; nothing here
//! grants. The request names a product only; a price, amount or currency in the body is ignored.

use axum::Json;
use axum::extract::rejection::{JsonRejection, PathRejection};
use axum::extract::{Path, State};

use crate::AppState;
use crate::api::body_rejection;
use crate::api::dto::{CreateInvoiceRequest, CreateInvoiceResponse, OrderResponse};
use crate::auth::AuthUser;
use crate::content::Localized;
use crate::db::orders::{InvoiceOrder, parse_order_id};
use crate::error::ApiError;
use crate::ids::ProductId;
use crate::puzzles::Lang;
use crate::telegram::gateway::InvoiceSpec;

/// The primary language subtags whose speakers get the Russian invoice (K29); every other tag, or none, gets English.
const RUSSIAN_INVOICE_LANGS: [&str; 4] = ["ru", "uk", "be", "kk"];

/// The invoice language of a Telegram language tag (K29): its primary subtag, ASCII case-insensitive, in
/// [`RUSSIAN_INVOICE_LANGS`] is Russian; anything else, or no tag, is English.
fn invoice_lang(language_code: Option<&str>) -> Lang {
    let primary = language_code
        .and_then(|tag| tag.split('-').next())
        .unwrap_or_default();
    if RUSSIAN_INVOICE_LANGS
        .iter()
        .any(|lang| primary.eq_ignore_ascii_case(lang))
    {
        Lang::Ru
    } else {
        Lang::En
    }
}

/// `text` in `lang`.
fn localized(text: &Localized, lang: Lang) -> &str {
    match lang {
        Lang::Ru => &text.ru,
        Lang::En => &text.en,
    }
}

/// `POST /api/invoices`: the checks run in a fixed order (token, body, product known, not owned); then a recent order
/// with a link is handed out again, or a new order is committed and its link asked from the Bot API. A gateway failure
/// is 502 `telegram_unavailable`, and the order stays `created` without a link (never reused).
pub async fn post_invoice(
    State(st): State<AppState>,
    AuthUser(user): AuthUser,
    req: Result<Json<CreateInvoiceRequest>, JsonRejection>,
) -> Result<Json<CreateInvoiceResponse>, ApiError> {
    let Json(req) = req.map_err(body_rejection)?;
    // A catalog lookup first: an unknown or junk id (U+0000 included) never reaches SQL.
    let product = st
        .catalog
        .product(&ProductId(req.product_id))
        .ok_or(ApiError::UnknownProduct)?;
    if st.repo.is_entitled(user, &product.id).await? {
        return Err(ApiError::AlreadyOwned);
    }
    let created = st
        .repo
        .reuse_or_create_order(user, product, st.clock.now())
        .await?;
    let (order, language_code) = match created {
        InvoiceOrder::Reused { order, invoice_url } => {
            return Ok(Json(CreateInvoiceResponse {
                order_id: order.0,
                invoice_url,
            }));
        }
        InvoiceOrder::Created {
            order,
            language_code,
        } => (order, language_code),
    };
    let lang = invoice_lang(language_code.as_deref());
    let title = localized(&product.title, lang).to_owned();
    let spec = InvoiceSpec {
        description: localized(&product.description, lang).to_owned(),
        payload: order.clone(),
        label: title.clone(),
        title,
        amount: product.price_stars,
    };
    // The order row is committed: a slow or failed call holds no lock and loses no order.
    let invoice_url = match st.gateway.create_invoice_link(spec).await {
        Ok(url) => url,
        Err(e) => {
            tracing::warn!(order = %order.0, product = %product.id.0, error = %e, "createInvoiceLink failed");
            return Err(ApiError::TelegramUnavailable);
        }
    };
    st.repo.set_invoice_url(&order, &invoice_url).await?;
    Ok(Json(CreateInvoiceResponse {
        order_id: order.0,
        invoice_url,
    }))
}

/// `GET /api/orders/{orderId}`: the product and status of one of the user's orders. A path segment that is not text
/// or not the order id grammar names no order: 404 `not_found`, like an unknown order and another user's order (the
/// table lists only 404), and it never reaches SQL.
pub async fn get_order(
    State(st): State<AppState>,
    AuthUser(user): AuthUser,
    id: Result<Path<String>, PathRejection>,
) -> Result<Json<OrderResponse>, ApiError> {
    let Ok(Path(raw)) = id else {
        return Err(ApiError::NotFound);
    };
    let order = parse_order_id(&raw).ok_or(ApiError::NotFound)?;
    let found = st
        .repo
        .order_for_user(user, &order)
        .await?
        .ok_or(ApiError::NotFound)?;
    Ok(Json(OrderResponse {
        order_id: order.0,
        product_id: found.product.0,
        status: found.status,
    }))
}
