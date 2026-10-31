//! The catalog (`server/catalog.json` over the story index) and `GET /api/entitlements`: every paid chapter of every
//! story, priced from the catalog, with `owned` from the user's entitlement rows. Hint tiers are not products
//! (RULINGS 25).

use std::path::Path;
use std::sync::Arc;

use axum::body::Body;
use axum::http::Request;
use axum::http::header::{AUTHORIZATION, CACHE_CONTROL};
use serde_json::{Map, Value, json};
use server::AppState;
use server::auth::issue_token;
use server::catalog::{CATALOG_JSON, Catalog, ProductRef, parse_file, parse_product_id};
use server::clock::FixedClock;
use server::content::{ContentError, ContentStore};
use server::ids::{ChapterId, ProductId, UserId};
use sqlx::Connection;

use crate::common;
use crate::content::{FIXTURE, FixtureCopy, content_error, read_json, state_on};

/// The clock of every state here.
pub(crate) const T0: i64 = 1_800_000_000;
/// The player of these tests.
pub(crate) const ANN: i64 = 1001;

fn report(failures: &[String]) {
    assert!(
        failures.is_empty(),
        "{} failures:\n{}",
        failures.len(),
        failures.join("\n")
    );
}

/// A state at `T0` on the fixture whose `users` table holds `users` (`entitlements.user_id` is a foreign key).
pub(crate) async fn state_with_users(users: &[i64]) -> (AppState, common::TestDb) {
    let (st, db) = common::test_state().await;
    let st = st.with_clock(Arc::new(FixedClock(T0)));
    for &id in users {
        st.repo
            .upsert_user(UserId(id), "Ann", None, T0)
            .await
            .unwrap();
    }
    (st, db)
}

/// `Authorization` for `user`: a token issued at `T0`.
pub(crate) fn bearer(st: &AppState, user: i64) -> String {
    let (token, _) = issue_token(&st.keys.token, UserId(user), T0, st.cfg.token_ttl_secs);
    format!("Bearer {token}")
}

/// `GET {path}` through the production router, as `user` or without an `Authorization` header.
pub(crate) async fn get(st: &AppState, user: Option<i64>, path: &str) -> common::Reply {
    let mut req = Request::get(path);
    if let Some(user) = user {
        req = req.header(AUTHORIZATION, bearer(st, user));
    }
    common::call(st, req.body(Body::empty()).unwrap()).await
}

/// Gives `user` the product as raw rows: a payment, then the entitlement it grants (their foreign-key parents).
/// Test code only: the server has no grant path in this lane.
pub(crate) async fn own(st: &AppState, user: i64, product: &str) {
    let mut c = common::raw_db(st).await;
    let charge = format!("charge-{user}-{product}");
    sqlx::query(
        "INSERT INTO payments (telegram_payment_charge_id, invoice_payload, user_id, amount, currency, \
         provider_payment_charge_id, paid_at, refunded_at) VALUES ($1, 'payload', $2, 1, 'XTR', '', $3, NULL)",
    )
    .bind(&charge)
    .bind(user)
    .bind(T0)
    .execute(&mut c)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO entitlements (user_id, product_id, charge_id, granted_at) VALUES ($1, $2, $3, $4)",
    )
    .bind(user)
    .bind(product)
    .bind(&charge)
    .bind(T0)
    .execute(&mut c)
    .await
    .unwrap();
    c.close().await.unwrap();
}

/// A `ProductDto` of chapter `ch` as a JSON value.
fn product(ch: &str, price: u32, owned: bool) -> Value {
    json!({ "productId": format!("chapter:{ch}"), "chapterId": ch, "priceStars": price, "owned": owned })
}

/// The mismatch of an entitlements reply against a 200 with exactly `products`, in order.
fn expect_products(case: &str, reply: &common::Reply, products: &[Value]) -> Option<String> {
    let want = json!({ "products": products });
    let got: Value = serde_json::from_slice(&reply.body).unwrap_or(Value::Null);
    (reply.status.as_u16() != 200 || got != want).then(|| {
        format!(
            "{case}: expected 200 {want}, got {} {}",
            reply.status.as_u16(),
            String::from_utf8_lossy(&reply.body)
        )
    })
}

/// `server/catalog.json` with `edit` applied, as text.
fn catalog_with(edit: impl FnOnce(&mut Value)) -> String {
    let mut v: Value = serde_json::from_str(CATALOG_JSON).unwrap();
    edit(&mut v);
    v.to_string()
}

/// `{ <chapter>: <price> }`, a `priceStars` value.
fn overrides(pairs: &[(&str, u32)]) -> Value {
    let map: Map<String, Value> = pairs
        .iter()
        .map(|&(chapter, price)| (chapter.to_owned(), json!(price)))
        .collect();
    Value::Object(map)
}

/// The fixture's content, loaded without a database.
async fn fixture_content() -> ContentStore {
    ContentStore::load(Path::new(FIXTURE)).await.unwrap()
}

/// A build result as one line.
fn outcome(built: &Result<Catalog, ContentError>) -> String {
    match built {
        Ok(_) => "Ok(catalog)".to_owned(),
        Err(e) => e.to_string(),
    }
}

/// The route prices from the state's catalog: a catalog with an override is what the route lists. No token is a 401.
#[tokio::test]
async fn entitlements_lists_catalog_prices() {
    let (st, _db) = state_with_users(&[ANN]).await;
    let mut failures = Vec::new();
    let catalog = Catalog::build(
        &catalog_with(|v| v["chapters"]["priceStars"] = overrides(&[("ch4", 2)])),
        &st.content,
    )
    .unwrap();
    let st = st.with_catalog(Arc::new(catalog));
    let reply = get(&st, Some(ANN), "/api/entitlements").await;
    failures.extend(expect_products(
        "priceStars {ch4: 2}",
        &reply,
        &[product("ch2", 1, false), product("ch4", 2, false)],
    ));

    let reply = get(&st, None, "/api/entitlements").await;
    let body: Value = serde_json::from_slice(&reply.body).unwrap_or(Value::Null);
    if reply.status.as_u16() != 401 || body != json!({ "error": "token_missing" }) {
        failures.push(format!(
            "no token: expected 401 token_missing, got {} {body}",
            reply.status.as_u16()
        ));
    }
    report(&failures);
}

/// Every paid chapter of every story is listed, in index order, at the default price; an owned one says so.
#[tokio::test]
async fn entitlements_lists_every_paid_chapter_of_every_story() {
    let (st, _db) = state_with_users(&[ANN]).await;
    let mut failures = Vec::new();
    let reply = get(&st, Some(ANN), "/api/entitlements").await;
    failures.extend(expect_products(
        "no rows",
        &reply,
        &[product("ch2", 1, false), product("ch4", 1, false)],
    ));
    let cache = reply
        .headers
        .get(CACHE_CONTROL)
        .and_then(|v| v.to_str().ok());
    if cache != Some("no-store") {
        failures.push(format!(
            "no rows: cache-control: expected no-store, got {cache:?}"
        ));
    }

    own(&st, ANN, "chapter:ch4").await;
    let reply = get(&st, Some(ANN), "/api/entitlements").await;
    failures.extend(expect_products(
        "owns chapter:ch4",
        &reply,
        &[product("ch2", 1, false), product("ch4", 1, true)],
    ));
    report(&failures);
}

/// The list is the catalog's chapter products: an owned row whose product the catalog does not sell (a hint-tier id
/// of the retired per-puzzle grammar) is not listed.
#[tokio::test]
async fn entitlements_lists_chapters_only() {
    let (st, _db) = state_with_users(&[ANN]).await;
    let mut failures = Vec::new();
    own(&st, ANN, "chapter:ch2").await;
    own(&st, ANN, "hint:ch1.drawer:1").await;
    let reply = get(&st, Some(ANN), "/api/entitlements").await;
    failures.extend(expect_products(
        "owns chapter:ch2 and hint:ch1.drawer:1",
        &reply,
        &[product("ch2", 1, true), product("ch4", 1, false)],
    ));
    if String::from_utf8_lossy(&reply.body).contains("hint:") {
        failures.push("the response names a hint: product".to_owned());
    }
    report(&failures);
}

/// Every paid chapter without an override costs `defaultPriceStars`; an override wins for its chapter; a zero default
/// is refused.
#[tokio::test]
async fn catalog_default_price_applies_to_every_paid_chapter() {
    let content = fixture_content().await;
    let mut failures = Vec::new();
    let default = parse_file(CATALOG_JSON)
        .unwrap()
        .chapters
        .default_price_stars;
    let cases = [
        (
            "server/catalog.json",
            CATALOG_JSON.to_owned(),
            [("ch2", default), ("ch4", default)],
        ),
        (
            "defaultPriceStars 3",
            catalog_with(|v| v["chapters"]["defaultPriceStars"] = json!(3)),
            [("ch2", 3), ("ch4", 3)],
        ),
        (
            "defaultPriceStars 3, priceStars {ch2: 5}",
            catalog_with(|v| {
                v["chapters"]["defaultPriceStars"] = json!(3);
                v["chapters"]["priceStars"] = overrides(&[("ch2", 5)]);
            }),
            [("ch2", 5), ("ch4", 3)],
        ),
    ];
    for (case, text, want) in cases {
        let catalog = match Catalog::build(&text, &content) {
            Ok(catalog) => catalog,
            Err(e) => {
                failures.push(format!("{case}: expected Ok, got {e}"));
                continue;
            }
        };
        let want: Vec<(String, u32)> = want
            .iter()
            .map(|&(ch, price)| (format!("chapter:{ch}"), price))
            .collect();
        let got: Vec<(String, u32)> = catalog
            .chapters()
            .map(|p| (p.id.0.clone(), p.price_stars))
            .collect();
        if got != want {
            failures.push(format!(
                "{case}: chapters(): expected {want:?}, got {got:?}"
            ));
        }
        for (id, price) in &want {
            let chapter = ChapterId(id.trim_start_matches("chapter:").to_owned());
            match catalog.product(&ProductId(id.clone())) {
                Some(p) if p.price_stars == *price && p.kind == ProductRef::Chapter { chapter } => {
                }
                Some(p) => failures.push(format!(
                    "{case}: product({id}): expected {price} for its chapter, got {} {:?}",
                    p.price_stars, p.kind
                )),
                None => failures.push(format!("{case}: product({id}): expected Some")),
            }
        }
    }
    let zero = Catalog::build(
        &catalog_with(|v| v["chapters"]["defaultPriceStars"] = json!(0)),
        &content,
    );
    if !matches!(zero, Err(ContentError::Catalog(_))) {
        failures.push(format!(
            "defaultPriceStars 0: expected Catalog(..), got {}",
            outcome(&zero)
        ));
    }
    report(&failures);
}

/// A `priceStars` key must be a paid chapter of the story index: a free chapter and an unknown one are refused; a
/// paid chapter's override builds, and a zero override does not.
#[tokio::test]
async fn catalog_price_override_must_be_paid_chapter() {
    let content = fixture_content().await;
    let mut failures = Vec::new();
    for (case, chapter) in [("free ch3", "ch3"), ("unknown ch9", "ch9")] {
        let built = Catalog::build(
            &catalog_with(|v| v["chapters"]["priceStars"] = overrides(&[(chapter, 2)])),
            &content,
        );
        match &built {
            Err(ContentError::PriceOverride { chapter: got }) if got == chapter => {}
            _ => failures.push(format!(
                "{case}: expected PriceOverride {{ {chapter} }}, got {}",
                outcome(&built)
            )),
        }
    }
    let paid = Catalog::build(
        &catalog_with(|v| v["chapters"]["priceStars"] = overrides(&[("ch4", 2)])),
        &content,
    );
    if paid.is_err() {
        failures.push(format!("paid ch4: expected Ok, got {}", outcome(&paid)));
    }
    let zero = Catalog::build(
        &catalog_with(|v| v["chapters"]["priceStars"] = overrides(&[("ch4", 0)])),
        &content,
    );
    if !matches!(zero, Err(ContentError::Catalog(_))) {
        failures.push(format!(
            "ch4 at 0: expected Catalog(..), got {}",
            outcome(&zero)
        ));
    }
    report(&failures);
}

/// The rendered invoice texts are 1-32 (title) and 1-255 (description) code points, checked at startup; a template
/// holds only `{chapter}` and `{story}`.
#[tokio::test]
async fn chapter_invoice_titles_within_limits() {
    let mut failures = Vec::new();

    // Control: the fixture's texts as `server/catalog.json`'s templates render them, through `AppState::new`.
    let (st, _db) = common::test_state().await;
    match st.catalog.product(&ProductId("chapter:ch4".to_owned())) {
        Some(p) => {
            let got = (
                p.title.ru.as_str(),
                p.title.en.as_str(),
                p.description.ru.as_str(),
                p.description.en.as_str(),
            );
            let want = (
                "Маяк",
                "The Lighthouse",
                "«Прилив»: Маяк",
                "“The Tide”: The Lighthouse",
            );
            if got != want {
                failures.push(format!("chapter:ch4 texts: expected {want:?}, got {got:?}"));
            }
        }
        None => failures.push("chapter:ch4: expected a product".to_owned()),
    }

    // (case, the index edit, the expected refusal: lang, field, chars, max; None = starts).
    type Edit = Box<dyn FnOnce(&mut Value)>;
    type Refusal = Option<(&'static str, &'static str, usize, usize)>;
    let ch4_title = |lang: &'static str, title: String| -> Edit {
        Box::new(move |v: &mut Value| v["stories"][1]["chapters"][1]["title"][lang] = json!(title))
    };
    let cases: [(&str, Edit, Refusal); 4] = [
        (
            "ch4 ru title of 32 Cyrillic characters",
            ch4_title("ru", "Я".repeat(32)),
            None,
        ),
        (
            "ch4 ru title of 33 characters",
            ch4_title("ru", "Я".repeat(33)),
            Some(("ru", "title", 33, 32)),
        ),
        (
            "ch4 empty en title",
            ch4_title("en", String::new()),
            Some(("en", "title", 0, 32)),
        ),
        (
            "tide ru title of 260 characters",
            Box::new(|v: &mut Value| v["stories"][1]["title"]["ru"] = json!("Я".repeat(260))),
            Some(("ru", "description", 268, 255)),
        ),
    ];
    for (case, edit, want) in cases {
        let copy = FixtureCopy::new();
        copy.edit_json("stories.json", edit).await;
        let (started, _db) = state_on(copy.path()).await;
        match want {
            None => {
                if let Err(e) = started {
                    failures.push(format!("{case}: expected Ok, got {e}"));
                }
            }
            Some((want_lang, want_field, want_chars, want_max)) => {
                match content_error(case, started) {
                    Ok(ContentError::InvoiceText {
                        product,
                        lang,
                        field,
                        chars,
                        min,
                        max,
                    }) if product == "chapter:ch4"
                        && lang == want_lang
                        && field == want_field
                        && chars == want_chars
                        && (min, max) == (1, want_max) => {}
                    Ok(other) => failures.push(format!(
                        "{case}: expected InvoiceText {{ chapter:ch4, {want_lang}, {want_field}, {want_chars} }}, got {other}"
                    )),
                    Err(failure) => failures.push(failure),
                }
            }
        }
    }

    // Templates: only {chapter} and {story}, in the title too.
    for (case, template) in [
        ("{chpater} in the title", "{chpater}"),
        ("an unclosed {chapter", "{chapter"),
        ("a stray }", "{chapter}}"),
    ] {
        let built = Catalog::build(
            &catalog_with(|v| v["chapters"]["title"]["ru"] = json!(template)),
            &st.content,
        );
        if !matches!(built, Err(ContentError::Catalog(_))) {
            failures.push(format!(
                "{case}: expected Catalog(..), got {}",
                outcome(&built)
            ));
        }
    }
    let both = Catalog::build(
        &catalog_with(|v| v["chapters"]["title"]["ru"] = json!("«{story}»: {chapter}")),
        &st.content,
    );
    match &both {
        Ok(catalog) => {
            let title = catalog
                .product(&ProductId("chapter:ch4".to_owned()))
                .map(|p| p.title.ru.as_str());
            if title != Some("«Прилив»: Маяк") {
                failures.push(format!(
                    "{{story}} in the title: expected «Прилив»: Маяк, got {title:?}"
                ));
            }
        }
        Err(e) => failures.push(format!("{{story}} in the title: expected Ok, got {e}")),
    }
    report(&failures);
}

/// The real `server/catalog.json` against the real `story/chapters.json`: every override key is a paid chapter
/// there, and every paid chapter's `productId` is its chapter product.
#[tokio::test]
async fn catalog_matches_story_chapters() {
    let mut failures = Vec::new();
    let file = parse_file(CATALOG_JSON).unwrap();
    let chapters = read_json(Path::new(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../story/chapters.json"
    )))
    .await;
    let entries = chapters.as_array().map(Vec::as_slice).unwrap_or_default();
    let paid: Vec<(&str, Option<&str>)> = entries
        .iter()
        .filter(|entry| entry["paid"] == json!(true))
        .map(|entry| {
            (
                entry["id"].as_str().unwrap_or_default(),
                entry["productId"].as_str(),
            )
        })
        .collect();
    for key in file.chapters.price_stars.keys() {
        if !paid.iter().any(|&(id, _)| id == key) {
            failures.push(format!(
                "priceStars key {key}: not a paid chapter of story/chapters.json"
            ));
        }
    }
    let mut checked = 0;
    for &(id, product_id) in &paid {
        let want = Some(ProductRef::Chapter {
            chapter: ChapterId(id.to_owned()),
        });
        let got = product_id.and_then(parse_product_id);
        if got == want {
            checked += 1;
        } else {
            failures.push(format!(
                "story/chapters.json {id}: productId {product_id:?} parses to {got:?}, expected {want:?}"
            ));
        }
    }
    if paid.is_empty() || checked != paid.len() {
        failures.push(format!(
            "checked {checked} of {} paid chapters: expected every one, and at least one",
            paid.len()
        ));
    }
    report(&failures);
}
