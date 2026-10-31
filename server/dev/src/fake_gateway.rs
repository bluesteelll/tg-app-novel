//! The dev app's Bot API: [`FakeBotGateway`] records every gateway call and answers it locally, so a dev run never
//! talks to Telegram. `GET /dev/invoices/{slug}` shows what an invoice link would have opened; later dev routes that
//! read the fake (a prepared share) join [`routes`] here.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use axum::extract::rejection::PathRejection;
use axum::extract::{Path, State};
use axum::http::HeaderValue;
use axum::http::header::CACHE_CONTROL;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use serde::Serialize;
use server::error::ApiError;
use server::ids::{ChargeId, UserId};
use server::telegram::gateway::{
    BotGateway, BoxFut, GatewayError, InvoiceSpec, OutMessage, SetupSpec,
};

/// The slug prefix of a dev invoice: the link is `https://t.me/$dev-<payload>`, its slug `dev-<payload>`.
const SLUG_PREFIX: &str = "dev-";

/// Everything the fake was asked.
#[derive(Default)]
struct FakeLog {
    /// Invoice specs by slug.
    invoices: HashMap<String, InvoiceSpec>,
    /// The latest answer of each pre-checkout query.
    answers: HashMap<String, Result<(), String>>,
    /// Every refund, in order.
    refunds: Vec<(UserId, ChargeId)>,
    /// Every message, in order.
    messages: Vec<OutMessage>,
    /// How many setups ran.
    setups: usize,
}

/// The dev app's Bot API: every call is recorded and answered `Ok` at once; an invoice link is
/// `https://t.me/$dev-<payload>`. The record grows without bound, a few hundred bytes per call, in a dev process only.
#[derive(Default)]
pub struct FakeBotGateway {
    log: Mutex<FakeLog>,
}

impl FakeBotGateway {
    /// The spec of the invoice whose link has slug `slug` (`dev-<payload>`).
    pub fn invoice(&self, slug: &str) -> Option<InvoiceSpec> {
        self.log().invoices.get(slug).cloned()
    }

    /// The latest answer given to pre-checkout query `query_id`.
    pub fn pre_checkout_answer(&self, query_id: &str) -> Option<Result<(), String>> {
        self.log().answers.get(query_id).cloned()
    }

    /// Every refund so far, in order.
    pub fn refunds(&self) -> Vec<(UserId, ChargeId)> {
        self.log().refunds.clone()
    }

    /// Every message so far, in order.
    pub fn messages(&self) -> Vec<OutMessage> {
        self.log().messages.clone()
    }

    /// How many setups ran.
    pub fn setups(&self) -> usize {
        self.log().setups
    }

    /// The record. Never held across an `.await`; a panic while holding it leaves it readable.
    fn log(&self) -> MutexGuard<'_, FakeLog> {
        self.log.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

impl BotGateway for FakeBotGateway {
    fn create_invoice_link(&self, spec: InvoiceSpec) -> BoxFut<'_, Result<String, GatewayError>> {
        Box::pin(async move {
            let mut slug = String::from(SLUG_PREFIX);
            slug.push_str(&spec.payload.0);
            let mut link = String::from("https://t.me/$");
            link.push_str(&slug);
            self.log().invoices.insert(slug, spec);
            Ok(link)
        })
    }

    fn answer_pre_checkout(
        &self,
        query_id: String,
        verdict: Result<(), String>,
    ) -> BoxFut<'_, Result<(), GatewayError>> {
        Box::pin(async move {
            self.log().answers.insert(query_id, verdict);
            Ok(())
        })
    }

    fn refund_star_payment(
        &self,
        user: UserId,
        charge: ChargeId,
    ) -> BoxFut<'_, Result<(), GatewayError>> {
        Box::pin(async move {
            self.log().refunds.push((user, charge));
            Ok(())
        })
    }

    fn send_message(&self, msg: OutMessage) -> BoxFut<'_, Result<(), GatewayError>> {
        Box::pin(async move {
            self.log().messages.push(msg);
            Ok(())
        })
    }

    fn setup(&self, _s: SetupSpec) -> BoxFut<'_, Result<(), GatewayError>> {
        Box::pin(async move {
            self.log().setups += 1;
            Ok(())
        })
    }
}

/// `GET /dev/invoices/{slug}` response: what the invoice would show.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DevInvoice {
    /// The order the invoice pays for (its payload).
    order_id: String,
    /// The invoice title.
    title: String,
    /// The invoice description.
    description: String,
    /// The price in Telegram Stars.
    amount: u32,
}

/// The routes that read `fake`: `GET /dev/invoices/{slug}`.
pub fn routes(fake: Arc<FakeBotGateway>) -> Router {
    Router::new()
        .route("/dev/invoices/{slug}", get(invoice))
        .with_state(fake)
}

/// The invoice recorded under `slug`, or 404 `not_found` (a slug that is not text names none); `no-store` either way.
async fn invoice(
    State(fake): State<Arc<FakeBotGateway>>,
    slug: Result<Path<String>, PathRejection>,
) -> Response {
    let spec = slug.ok().and_then(|Path(slug)| fake.invoice(&slug));
    let mut response = match spec {
        Some(spec) => Json(DevInvoice {
            order_id: spec.payload.0,
            title: spec.title,
            description: spec.description,
            amount: spec.amount,
        })
        .into_response(),
        None => ApiError::NotFound.into_response(),
    };
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use axum::body::{Body, Bytes};
    use axum::http::header::{AUTHORIZATION, CONTENT_TYPE};
    use axum::http::{Request, StatusCode};
    use http_body_util::BodyExt;
    use pgdev::TestDb;
    use serde_json::{Value, json};
    use server::auth::issue_token;
    use server::ids::OrderId;
    use server::telegram::gateway::{BotCommandSpec, CommandSet, WebAppButton};
    use tower::ServiceExt;

    use super::*;
    use crate::{DevPaths, dev_router, dev_state};

    /// An order id in the payload grammar.
    const ORDER: &str = "o_0123456789abcdef0123456789abcdef";

    fn report(failures: &[String]) {
        assert!(
            failures.is_empty(),
            "{} failures:\n{}",
            failures.len(),
            failures.join("\n")
        );
    }

    fn spec() -> InvoiceSpec {
        InvoiceSpec {
            title: "The Archive".to_owned(),
            description: "“The Manor”: The Archive".to_owned(),
            payload: OrderId(ORDER.to_owned()),
            label: "The Archive".to_owned(),
            amount: 1,
        }
    }

    fn button() -> WebAppButton {
        WebAppButton {
            text: "Play".to_owned(),
            url: "http://localhost/".to_owned(),
        }
    }

    /// Every method is recorded once and answered `Ok`; the accessors return exactly what was asked.
    #[tokio::test]
    async fn fake_gateway_records_every_call() {
        let fake = FakeBotGateway::default();
        let mut failures = Vec::new();
        let link = fake.create_invoice_link(spec()).await;
        let want_link = format!("https://t.me/$dev-{ORDER}");
        if link.as_deref() != Ok(want_link.as_str()) {
            failures.push(format!(
                "create_invoice_link: expected Ok({want_link}), got {link:?}"
            ));
        }
        let slug = format!("dev-{ORDER}");
        if fake.invoice(&slug) != Some(spec()) {
            failures.push(format!(
                "invoice({slug}): expected the spec, got {:?}",
                fake.invoice(&slug)
            ));
        }
        let unknown = "dev-o_00000000000000000000000000000000";
        if let Some(got) = fake.invoice(unknown) {
            failures.push(format!("invoice({unknown}): expected None, got {got:?}"));
        }

        for (query, verdict) in [("q1", Ok(())), ("q2", Err("x".to_owned()))] {
            let answered = fake.answer_pre_checkout(query.to_owned(), verdict).await;
            if answered != Ok(()) {
                failures.push(format!(
                    "answer_pre_checkout({query}): expected Ok, got {answered:?}"
                ));
            }
        }
        for (query, want) in [
            ("q1", Some(Ok(()))),
            ("q2", Some(Err("x".to_owned()))),
            ("q3", None),
        ] {
            let got = fake.pre_checkout_answer(query);
            if got != want {
                failures.push(format!(
                    "pre_checkout_answer({query}): expected {want:?}, got {got:?}"
                ));
            }
        }

        let charge = ChargeId("ch_1".to_owned());
        let refunded = fake.refund_star_payment(UserId(1001), charge.clone()).await;
        let refunds = fake.refunds();
        if refunded != Ok(()) || refunds != [(UserId(1001), charge)] {
            failures.push(format!(
                "refund: expected Ok and one record, got {refunded:?} and {refunds:?}"
            ));
        }

        let msg = OutMessage {
            chat_id: 1001,
            text: "hi".to_owned(),
            web_app_button: Some(button()),
        };
        let sent = fake.send_message(msg.clone()).await;
        let messages = fake.messages();
        if sent != Ok(()) || messages != [msg] {
            failures.push(format!(
                "send_message: expected Ok and one record, got {sent:?} and {messages:?}"
            ));
        }

        let setup = SetupSpec {
            webhook_url: "http://localhost/telegram/webhook".to_owned(),
            secret_token: "s".to_owned(),
            commands: vec![CommandSet {
                language_code: None,
                commands: vec![BotCommandSpec {
                    command: "start".to_owned(),
                    description: "Play".to_owned(),
                }],
            }],
            menu_button: button(),
        };
        let set_up = fake.setup(setup).await;
        if set_up != Ok(()) || fake.setups() != 1 {
            failures.push(format!(
                "setup: expected Ok and 1 setup, got {set_up:?} and {}",
                fake.setups()
            ));
        }
        report(&failures);
    }

    /// A collected response: (status, `Cache-Control`, body).
    async fn call(app: &Router, req: Request<Body>) -> (StatusCode, Option<String>, Bytes) {
        let response = app
            .clone()
            .oneshot(req)
            .await
            .expect("invariant: the router is infallible");
        let (parts, body) = response.into_parts();
        let cache = parts
            .headers
            .get(CACHE_CONTROL)
            .and_then(|v| v.to_str().ok())
            .map(str::to_owned);
        let body = body
            .collect()
            .await
            .expect("invariant: a collected body is in memory")
            .to_bytes();
        (parts.status, cache, body)
    }

    /// The dev app installs the fake: `POST /api/invoices` answers with a dev link, and `GET /dev/invoices/{slug}`
    /// shows the recorded invoice in the user's language. An unknown slug is 404 `not_found`.
    #[tokio::test]
    async fn dev_invoice_readable() {
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
        let now = st.clock.now();
        st.repo
            .upsert_user(UserId(1001), "Ann", Some("en"), now)
            .await
            .unwrap();
        let (token, _) = issue_token(&st.keys.token, UserId(1001), now, st.cfg.token_ttl_secs);
        let app = dev_router(st, fake);
        let mut failures = Vec::new();

        let req = Request::post("/api/invoices")
            .header(AUTHORIZATION, format!("Bearer {token}"))
            .header(CONTENT_TYPE, "application/json")
            .body(Body::from(r#"{"productId":"chapter:ch2"}"#))
            .unwrap();
        let (status, _, body) = call(&app, req).await;
        let reply: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);
        let order = reply["orderId"].as_str().unwrap_or_default().to_owned();
        let want_link = format!("https://t.me/$dev-{order}");
        if status != StatusCode::OK
            || order.len() != ORDER.len()
            || reply["invoiceUrl"].as_str() != Some(want_link.as_str())
        {
            failures.push(format!(
                "POST /api/invoices: expected 200 with invoiceUrl {want_link}, got {} {}",
                status.as_u16(),
                String::from_utf8_lossy(&body)
            ));
        }

        let uri = format!("/dev/invoices/dev-{order}");
        let (status, cache, body) =
            call(&app, Request::get(&uri).body(Body::empty()).unwrap()).await;
        let got: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);
        let want = json!({
            "orderId": order,
            "title": "The Archive",
            "description": "“The Manor”: The Archive",
            "amount": 1,
        });
        if status != StatusCode::OK || got != want || cache.as_deref() != Some("no-store") {
            failures.push(format!(
                "GET {uri}: expected 200 {want} no-store, got {} {} {cache:?}",
                status.as_u16(),
                String::from_utf8_lossy(&body)
            ));
        }

        let uri = "/dev/invoices/dev-o_00000000000000000000000000000000";
        let (status, _, body) = call(&app, Request::get(uri).body(Body::empty()).unwrap()).await;
        let got: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);
        if status != StatusCode::NOT_FOUND || got != json!({ "error": "not_found" }) {
            failures.push(format!(
                "GET {uri}: expected 404 {{\"error\":\"not_found\"}}, got {} {}",
                status.as_u16(),
                String::from_utf8_lossy(&body)
            ));
        }
        report(&failures);
    }
}
