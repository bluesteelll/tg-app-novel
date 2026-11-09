//! `POST /dev/simulate-payment` (K21; PP "dev routes"): a Stars payment as Telegram would deliver it, for the dev
//! mock's fake Stars sheet. It builds Telegram's update JSON - the `pre_checkout_query`, then, when that was answered
//! ok, the `successful_payment` message - and feeds it through the real webhook handler with the real secret header.
//! Nothing here reaches the payment code but through that handler, so a simulated payment takes the production path.
//!
//! `POST /dev/refund` (K20) runs the admin refund itself (`telegram::payments::admin_refund`, as `/refund` does) on the
//! fake gateway: the dev configuration has no admin ids, so no command could reach it. `POST /dev/refunded-update`
//! feeds the `refunded_payment` message Telegram sends for a refund it made on its own, through the same handler.

use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Duration;

use axum::body::Body;
use axum::extract::State;
use axum::extract::rejection::JsonRejection;
use axum::http::header::CACHE_CONTROL;
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use server::AppState;
use server::api::body_rejection;
use server::error::{ApiError, ApiErrorBody, ErrorCode};
use server::ids::ChargeId;
use server::telegram::payments::{RefundError, RevokeOutcome, admin_refund};
use server::telegram::webhook::webhook;

use crate::fake_gateway::FakeBotGateway;

/// The longest `webhookDelayMs`: a minute.
const MAX_DELAY_MS: u64 = 60_000;

/// The header the webhook reads `WEBHOOK_SECRET` from.
const SECRET_HEADER: &str = "x-telegram-bot-api-secret-token";

/// The route's state: the app the webhook runs on, the fake gateway that recorded the invoices and the pre-checkout
/// answers, and the update counter.
#[derive(Clone)]
struct Simulator {
    app: AppState,
    fake: Arc<FakeBotGateway>,
    /// The next `update_id` (also a message's `message_id`): increasing per dev process, as Telegram's are per bot.
    next_update: Arc<AtomicU32>,
}

impl Simulator {
    /// A fresh update id, within `i32` (a `message_id` is one).
    fn next_id(&self) -> u32 {
        self.next_update.fetch_add(1, Ordering::Relaxed) % i32::MAX.unsigned_abs()
    }
}

/// `{ slug, outcome, webhookDelayMs? }` (PP:1166).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SimulateRequest {
    /// The invoice slug, `dev-<orderId>`.
    slug: String,
    /// What Telegram does after an accepted pre-checkout.
    outcome: Outcome,
    /// How long after the answer the payment arrives, 0..=60000 ms (default 0).
    #[serde(default)]
    webhook_delay_ms: Option<u64>,
}

/// The payment deliveries after an accepted pre-checkout.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum Outcome {
    /// One `successful_payment`.
    Paid,
    /// The same `successful_payment` update twice, one after the other (a redelivery).
    PaidTwice,
}

impl Outcome {
    fn deliveries(self) -> usize {
        match self {
            Outcome::Paid => 1,
            Outcome::PaidTwice => 2,
        }
    }
}

/// `{ precheckoutOk, chargeId? }`: `chargeId` only when the pre-checkout was answered ok.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SimulateResponse {
    precheckout_ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    charge_id: Option<String>,
}

/// `{ chargeId }`: the charge a dev refund route acts on.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChargeRequest {
    /// The `telegram_payment_charge_id`, as `/dev/simulate-payment` answered it.
    charge_id: String,
}

/// `{ outcome }`: what the revoke did.
#[derive(Serialize)]
struct RefundResponse {
    /// `revoked`, `already_refunded` or `unknown_charge`.
    outcome: &'static str,
}

/// The wire word of `outcome`.
fn outcome_word(outcome: RevokeOutcome) -> &'static str {
    match outcome {
        RevokeOutcome::Revoked => "revoked",
        RevokeOutcome::AlreadyRefunded => "already_refunded",
        RevokeOutcome::UnknownCharge => "unknown_charge",
    }
}

/// Why a simulation was not run.
enum SimError {
    /// A refused request: the API's own answer (400 / 404 / 413, or 500 on a database error).
    Api(ApiError),
    /// The webhook handler answered anything but 200: 500 `internal`.
    Handler,
}

impl From<ApiError> for SimError {
    fn from(e: ApiError) -> SimError {
        SimError::Api(e)
    }
}

impl IntoResponse for SimError {
    fn into_response(self) -> Response {
        match self {
            SimError::Api(e) => e.into_response(),
            SimError::Handler => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiErrorBody {
                    error: ErrorCode::Internal,
                    current: None,
                    value: None,
                }),
            )
                .into_response(),
        }
    }
}

/// The simulate and refund routes on `app`, reading invoices and pre-checkout answers from `fake`.
pub fn routes(app: AppState, fake: Arc<FakeBotGateway>) -> Router {
    Router::new()
        .route("/dev/simulate-payment", post(simulate))
        .route("/dev/refund", post(dev_refund))
        .route("/dev/refunded-update", post(refunded_update))
        .with_state(Simulator {
            app,
            fake,
            next_update: Arc::new(AtomicU32::new(1)),
        })
}

/// `answer` as a response, `no-store` whatever it is.
fn no_store(answer: impl IntoResponse) -> Response {
    let mut response = answer.into_response();
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

/// `POST /dev/simulate-payment`, answered `no-store` whatever the outcome.
async fn simulate(
    State(sim): State<Simulator>,
    req: Result<Json<SimulateRequest>, JsonRejection>,
) -> Response {
    no_store(run(&sim, req).await.map(Json))
}

/// `POST /dev/refund { chargeId }`: the admin refund through the fake gateway, then 200 `{ outcome }`. A body that is
/// not `{chargeId}` is 400, a gateway refusal 502 `telegram_unavailable`, a database error 500; `no-store` always.
async fn dev_refund(
    State(sim): State<Simulator>,
    req: Result<Json<ChargeRequest>, JsonRejection>,
) -> Response {
    no_store(refund(&sim, req).await)
}

/// The admin refund of the request's charge.
async fn refund(
    sim: &Simulator,
    req: Result<Json<ChargeRequest>, JsonRejection>,
) -> Result<Json<RefundResponse>, ApiError> {
    let Json(req) = req.map_err(body_rejection)?;
    let outcome = admin_refund(&sim.app, &ChargeId(req.charge_id))
        .await
        .map_err(|e| match e {
            RefundError::Gateway(_) => ApiError::TelegramUnavailable,
            RefundError::Db(e) => ApiError::Db(e),
        })?;
    Ok(Json(RefundResponse {
        outcome: outcome_word(outcome),
    }))
}

/// The pre-checkout, answered by the real handler through the fake gateway; then, if it was answered ok, the payment.
/// With a delay the pre-checkout still runs first (so `precheckoutOk` is known), and the payment is fed after the
/// delay in a task of its own while the route answers at once.
async fn run(
    sim: &Simulator,
    req: Result<Json<SimulateRequest>, JsonRejection>,
) -> Result<SimulateResponse, SimError> {
    let Json(req) = req.map_err(body_rejection)?;
    let delay_ms = req.webhook_delay_ms.unwrap_or(0);
    if delay_ms > MAX_DELAY_MS {
        return Err(ApiError::BadRequest("webhookDelayMs must be 0..=60000").into());
    }
    let spec = sim.fake.invoice(&req.slug).ok_or(ApiError::NotFound)?;
    let payer = sim
        .app
        .repo
        .order_payer(&spec.payload)
        .await
        .map_err(ApiError::Db)?
        .ok_or(ApiError::NotFound)?;
    let from = json!({
        "id": payer.user.0,
        "is_bot": false,
        "first_name": payer.first_name,
        "language_code": payer.language_code,
    });

    let query_id = random_id("dev_q_");
    let pre_checkout = json!({
        "update_id": sim.next_id(),
        "pre_checkout_query": {
            "id": query_id,
            "from": from,
            "currency": "XTR",
            "total_amount": spec.amount,
            "invoice_payload": spec.payload.0,
        },
    });
    feed(&sim.app, &pre_checkout).await?;
    if sim.fake.pre_checkout_answer(&query_id) != Some(Ok(())) {
        return Ok(SimulateResponse {
            precheckout_ok: false,
            charge_id: None,
        });
    }

    let charge = random_id("dev_");
    let id = sim.next_id();
    let payment = json!({
        "update_id": id,
        "message": {
            "message_id": id,
            "date": u64::try_from(sim.app.clock.now()).unwrap_or_default(),
            "chat": { "id": payer.user.0, "type": "private" },
            "from": from,
            "successful_payment": {
                "currency": "XTR",
                "total_amount": spec.amount,
                "invoice_payload": spec.payload.0,
                "telegram_payment_charge_id": charge,
                "provider_payment_charge_id": "",
            },
        },
    });
    let deliveries = req.outcome.deliveries();
    if delay_ms == 0 {
        for _ in 0..deliveries {
            feed(&sim.app, &payment).await?;
        }
    } else {
        let app = sim.app.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(delay_ms)).await;
            for _ in 0..deliveries {
                if feed(&app, &payment).await.is_err() {
                    break;
                }
            }
        });
    }
    Ok(SimulateResponse {
        precheckout_ok: true,
        charge_id: Some(charge),
    })
}

/// `POST /dev/refunded-update { chargeId }`: Telegram's `refunded_payment` message for a recorded charge, from its
/// payer, fed through the real webhook handler with the real secret: 204, 404 for a charge with no payment row, 500
/// when the handler did not answer 200; `no-store` always.
async fn refunded_update(
    State(sim): State<Simulator>,
    req: Result<Json<ChargeRequest>, JsonRejection>,
) -> Response {
    no_store(refunded(&sim, req).await.map(|()| StatusCode::NO_CONTENT))
}

/// The `refunded_payment` update of the request's charge, through the webhook handler.
async fn refunded(
    sim: &Simulator,
    req: Result<Json<ChargeRequest>, JsonRejection>,
) -> Result<(), SimError> {
    let Json(req) = req.map_err(body_rejection)?;
    let charge = ChargeId(req.charge_id);
    let record = sim
        .app
        .repo
        .payment_record(&charge)
        .await
        .map_err(ApiError::Db)?
        .ok_or(ApiError::NotFound)?;
    let id = sim.next_id();
    let payer = json!({ "id": record.payer.0, "is_bot": false, "first_name": "Dev" });
    let update = json!({
        "update_id": id,
        "message": {
            "message_id": id,
            "date": u64::try_from(sim.app.clock.now()).unwrap_or_default(),
            "chat": { "id": record.payer.0, "type": "private" },
            "from": payer,
            "refunded_payment": {
                "currency": record.currency,
                // Recorded from Telegram's `u32`: it fits.
                "total_amount": u32::try_from(record.amount).unwrap_or_default(),
                "invoice_payload": record.invoice_payload,
                "telegram_payment_charge_id": charge.0,
                "provider_payment_charge_id": "",
            },
        },
    });
    feed(&sim.app, &update).await
}

/// `update` through the real webhook handler with the configured secret; anything but 200 fails the simulation.
async fn feed(app: &AppState, update: &Value) -> Result<(), SimError> {
    let secret = HeaderValue::from_str(&app.cfg.webhook_secret).map_err(|_| SimError::Handler)?;
    let mut headers = HeaderMap::new();
    headers.insert(SECRET_HEADER, secret);
    let status = webhook(State(app.clone()), headers, Body::from(update.to_string())).await;
    if status == StatusCode::OK {
        Ok(())
    } else {
        tracing::error!(%status, "simulated update: the webhook did not answer 200");
        Err(SimError::Handler)
    }
}

/// `prefix` + 32 lower-case hex of 16 OS-random bytes.
fn random_id(prefix: &str) -> String {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).expect(
        "invariant: the OS random source works (ProcessPrng on Windows 10+ is documented never to fail)",
    );
    let mut id = String::from(prefix);
    id.push_str(&hex::encode(bytes));
    id
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use axum::body::Body;
    use axum::http::header::{AUTHORIZATION, CONTENT_TYPE, LOCATION};
    use axum::http::{Request, StatusCode};
    use http_body_util::BodyExt;
    use pgdev::TestDb;
    use serde_json::{Value, json};
    use server::ids::{ChargeId, UserId};
    use tower::ServiceExt;

    use super::*;
    use crate::{DevPaths, dev_router, dev_state};

    fn report(failures: &[String]) {
        assert!(
            failures.is_empty(),
            "{} failures:\n{}",
            failures.len(),
            failures.join("\n")
        );
    }

    /// A dev app on a fresh database with the server's content fixture: the router, the fake it calls, and the
    /// database guard (bound by the caller, so the database outlives the app).
    async fn dev_app() -> (Router, Arc<FakeBotGateway>, TestDb) {
        let db = TestDb::create().await;
        let paths = DevPaths {
            database_url: db.url(),
            content: PathBuf::from(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../tests/fixtures/content"
            )),
        };
        let (st, fake) = match dev_state(&paths).await {
            Ok(built) => built,
            Err(e) => panic!("dev_state on {}: {e}", db.name()),
        };
        (dev_router(st, fake.clone()), fake, db)
    }

    /// `method uri` through `app`, with `Authorization: bearer` when given and `body` as JSON when given: (status,
    /// `Cache-Control`, the body as JSON or `null`).
    async fn send(
        app: &Router,
        method: &str,
        uri: &str,
        bearer: Option<&str>,
        body: Option<String>,
    ) -> (StatusCode, Option<String>, Value) {
        let mut req = Request::builder().method(method).uri(uri);
        if let Some(bearer) = bearer {
            req = req.header(AUTHORIZATION, bearer);
        }
        let body = match body {
            Some(text) => {
                req = req.header(CONTENT_TYPE, "application/json");
                Body::from(text)
            }
            None => Body::empty(),
        };
        let response = app
            .clone()
            .oneshot(req.body(body).unwrap())
            .await
            .expect("invariant: the router is infallible");
        let (parts, body) = response.into_parts();
        let cache = parts
            .headers
            .get(CACHE_CONTROL)
            .and_then(|v| v.to_str().ok())
            .map(str::to_owned);
        let bytes = body
            .collect()
            .await
            .expect("invariant: a collected body is in memory")
            .to_bytes();
        let json = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
        (parts.status, cache, json)
    }

    /// A session for dev user `uid`: `/dev/launch?uid=<uid>&lang=ru`, then `POST /api/auth` with the launch's
    /// `tgWebAppData`; the `Authorization` value.
    async fn session(app: &Router, uid: i64) -> String {
        let req = Request::get(format!("/dev/launch?uid={uid}&lang=ru"))
            .body(Body::empty())
            .unwrap();
        let launch = app.clone().oneshot(req).await.unwrap();
        let location = launch
            .headers()
            .get(LOCATION)
            .and_then(|v| v.to_str().ok())
            .unwrap_or_default();
        let hash = location.split_once('#').map_or("", |(_, hash)| hash);
        let init_data = form_urlencoded::parse(hash.as_bytes())
            .find(|(key, _)| key == "tgWebAppData")
            .map(|(_, value)| value.into_owned())
            .unwrap_or_else(|| panic!("/dev/launch: no tgWebAppData in {location:?}"));
        let body = json!({ "initData": init_data }).to_string();
        let (status, _, auth) = send(app, "POST", "/api/auth", None, Some(body)).await;
        let Some(token) = auth["token"].as_str() else {
            panic!("POST /api/auth for {uid}: expected a token, got {status} {auth}");
        };
        format!("Bearer {token}")
    }

    /// `chapter:ch2` invoiced for `bearer` and paid through `/dev/simulate-payment`: the charge id.
    async fn paid_ch2(app: &Router, bearer: &str) -> String {
        let order = json!({ "productId": "chapter:ch2" }).to_string();
        let (_, _, invoice) = send(app, "POST", "/api/invoices", Some(bearer), Some(order)).await;
        let slug = invoice["invoiceUrl"]
            .as_str()
            .and_then(|url| url.strip_prefix("https://t.me/$"))
            .unwrap_or_else(|| panic!("POST /api/invoices: expected a dev link, got {invoice}"))
            .to_owned();
        let body = json!({ "slug": slug, "outcome": "paid" }).to_string();
        let (_, _, paid) = send(app, "POST", "/dev/simulate-payment", None, Some(body)).await;
        paid["chargeId"]
            .as_str()
            .unwrap_or_else(|| panic!("/dev/simulate-payment: expected a chargeId, got {paid}"))
            .to_owned()
    }

    /// The status of `GET /api/chapters/ch2` as `bearer`.
    async fn ch2_status(app: &Router, bearer: &str) -> StatusCode {
        send(app, "GET", "/api/chapters/ch2", Some(bearer), None)
            .await
            .0
    }

    /// `POST /dev/refund` runs the admin refund: a paid chapter is refunded through the fake gateway and revoked
    /// (`revoked`, then 403); a second call is `already_refunded` with no second Bot API call; an unknown charge is
    /// `unknown_charge`; a body that is not `{chargeId}` is 400. Every answer is `no-store`.
    #[tokio::test]
    async fn dev_refund_revokes_through_admin_path() {
        let (app, fake, _db) = dev_app().await;
        let bearer = session(&app, 1001).await;
        let charge = paid_ch2(&app, &bearer).await;
        let mut failures = Vec::new();
        let before = ch2_status(&app, &bearer).await;
        if before != StatusCode::OK {
            failures.push(format!(
                "GET /api/chapters/ch2 after paying: expected 200, got {before}"
            ));
        }
        let body = json!({ "chargeId": charge }).to_string();
        for (case, body, status, want) in [
            (
                "first",
                body.clone(),
                StatusCode::OK,
                json!({ "outcome": "revoked" }),
            ),
            (
                "again",
                body,
                StatusCode::OK,
                json!({ "outcome": "already_refunded" }),
            ),
            (
                "an unknown charge",
                json!({ "chargeId": "dev_nope" }).to_string(),
                StatusCode::OK,
                json!({ "outcome": "unknown_charge" }),
            ),
            (
                "no chargeId",
                json!({ "charge": charge }).to_string(),
                StatusCode::BAD_REQUEST,
                json!({ "error": "bad_request" }),
            ),
        ] {
            let (got, cache, json) = send(&app, "POST", "/dev/refund", None, Some(body)).await;
            if got != status || json != want {
                failures.push(format!(
                    "POST /dev/refund {case}: expected {} {want}, got {} {json}",
                    status.as_u16(),
                    got.as_u16()
                ));
            }
            if cache.as_deref() != Some("no-store") {
                failures.push(format!(
                    "POST /dev/refund {case}: cache-control: expected no-store, got {cache:?}"
                ));
            }
        }
        let refunds = fake.refunds();
        if refunds != [(UserId(1001), ChargeId(charge.clone()))] {
            failures.push(format!(
                "refundStarPayment calls: expected one for {charge}, got {refunds:?}"
            ));
        }
        let after = ch2_status(&app, &bearer).await;
        if after != StatusCode::FORBIDDEN {
            failures.push(format!(
                "GET /api/chapters/ch2 after the refund: expected 403, got {after}"
            ));
        }
        report(&failures);
    }

    /// `POST /dev/refunded-update` feeds Telegram's `refunded_payment` for a paid charge through the real webhook
    /// handler: 204, then ch2 is 403 again, with no Bot API refund call (Telegram refunded on its own). An unknown
    /// charge is 404. Every answer is `no-store`.
    #[tokio::test]
    async fn dev_refunded_update_revokes_through_webhook() {
        let (app, fake, _db) = dev_app().await;
        let bearer = session(&app, 1001).await;
        let charge = paid_ch2(&app, &bearer).await;
        let mut failures = Vec::new();
        for (case, charge, status) in [
            ("a paid charge", charge.as_str(), StatusCode::NO_CONTENT),
            ("an unknown charge", "dev_nope", StatusCode::NOT_FOUND),
        ] {
            let body = json!({ "chargeId": charge }).to_string();
            let (got, cache, json) =
                send(&app, "POST", "/dev/refunded-update", None, Some(body)).await;
            if got != status {
                failures.push(format!(
                    "POST /dev/refunded-update {case}: expected {}, got {} {json}",
                    status.as_u16(),
                    got.as_u16()
                ));
            }
            if cache.as_deref() != Some("no-store") {
                failures.push(format!(
                    "POST /dev/refunded-update {case}: cache-control: expected no-store, got {cache:?}"
                ));
            }
        }
        let after = ch2_status(&app, &bearer).await;
        if after != StatusCode::FORBIDDEN {
            failures.push(format!(
                "GET /api/chapters/ch2 after the refunded update: expected 403, got {after}"
            ));
        }
        let refunds = fake.refunds();
        if !refunds.is_empty() {
            failures.push(format!(
                "refundStarPayment calls: expected none, got {refunds:?}"
            ));
        }
        report(&failures);
    }
}
