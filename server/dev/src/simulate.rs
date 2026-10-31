//! `POST /dev/simulate-payment` (K21; PP "dev routes"): a Stars payment as Telegram would deliver it, for the dev
//! mock's fake Stars sheet. It builds Telegram's update JSON - the `pre_checkout_query`, then, when that was answered
//! ok, the `successful_payment` message - and feeds it through the real webhook handler with the real secret header.
//! Nothing here reaches the payment code but through that handler, so a simulated payment takes the production path.

use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Duration;

use axum::body::Bytes;
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
                }),
            )
                .into_response(),
        }
    }
}

/// The simulate route on `app`, reading invoices and pre-checkout answers from `fake`.
pub fn routes(app: AppState, fake: Arc<FakeBotGateway>) -> Router {
    Router::new()
        .route("/dev/simulate-payment", post(simulate))
        .with_state(Simulator {
            app,
            fake,
            next_update: Arc::new(AtomicU32::new(1)),
        })
}

/// `POST /dev/simulate-payment`, answered `no-store` whatever the outcome.
async fn simulate(
    State(sim): State<Simulator>,
    req: Result<Json<SimulateRequest>, JsonRejection>,
) -> Response {
    let mut response = match run(&sim, req).await {
        Ok(answer) => Json(answer).into_response(),
        Err(e) => e.into_response(),
    };
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
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

/// `update` through the real webhook handler with the configured secret; anything but 200 fails the simulation.
async fn feed(app: &AppState, update: &Value) -> Result<(), SimError> {
    let secret = HeaderValue::from_str(&app.cfg.webhook_secret).map_err(|_| SimError::Handler)?;
    let mut headers = HeaderMap::new();
    headers.insert(SECRET_HEADER, secret);
    let status = webhook(State(app.clone()), headers, Bytes::from(update.to_string())).await;
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
