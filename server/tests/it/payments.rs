//! `POST /api/invoices`: Stars invoices priced and titled from the catalog, the order committed before the gateway
//! call, and a recent order with a link handed out again. `GET /api/orders/{orderId}`: the status of the user's own
//! order, read from its row. The pre-checkout (P5) through `POST /telegram/webhook`: the payer-row lock, the
//! conditional order UPDATE, the classified refusals in the payer's language, and the 2 s / 5 s deadlines. The
//! grant (P6): write-first and idempotent on the charge id, every money fact recorded, applied only to the payer's
//! own payable order at its amount in `XTR`.
//!
//! [`RecordingGateway`] is this crate's Bot API fake: every state here installs it through `with_gateway`, so no test
//! reaches the production gateway (whose placeholder token would answer `Disabled`, a 502, anyway). It records all
//! five gateway methods for the later payment, refund, bot, pack and share tests that import it from here.

use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use axum::body::Body;
use axum::http::Request;
use axum::http::header::{AUTHORIZATION, CACHE_CONTROL, CONTENT_TYPE};
use serde_json::{Map, Value, json};
use server::AppState;
use server::auth::issue_token;
use server::catalog::{CATALOG_JSON, Catalog};
use server::clock::FixedClock;
use server::db::orders::parse_order_id;
use server::ids::{ChargeId, OrderId, UserId};
use server::puzzles::Lang;
use server::telegram::gateway::{
    BotGateway, BoxFut, CommandSet, GatewayError, InvoiceSpec, OutMessage, SetupSpec, WebAppButton,
};
use server::telegram::payments::{
    GrantOutcome, PaymentFact, RejectReason, on_successful_payment, reject_text,
};
use sqlx::{Connection, PgConnection};

use crate::catalog::{ANN, T0, own};
use crate::common;
use crate::webhook::{
    new_order, order_status, payment_rows, payment_update, post_update, pre_checkout_update, rows,
};

/// A second player.
const BEN: i64 = 1002;

/// The link prefix of every invoice the recorder makes: `https://t.me/$test-<payload>`.
const TEST_LINK_PREFIX: &str = "https://t.me/$test-";

/// One call the server made to the Bot API, as [`RecordingGateway`] recorded it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum GatewayCall {
    /// `createInvoiceLink`.
    Invoice(InvoiceSpec),
    /// `answerPreCheckoutQuery`.
    PreCheckout {
        /// The query answered.
        query_id: String,
        /// The answer: accept, or refuse with the text shown to the payer.
        verdict: Result<(), String>,
    },
    /// `refundStarPayment`.
    Refund {
        /// The payer refunded.
        user: UserId,
        /// The charge refunded.
        charge: ChargeId,
    },
    /// `sendMessage`.
    Message(OutMessage),
    /// The setup calls (webhook, commands, menu button), as one call. Test values only: the secret is the test
    /// config's, so the `Debug` of this variant prints nothing real.
    Setup {
        /// The webhook URL.
        webhook_url: String,
        /// The webhook's `secret_token`.
        secret_token: String,
        /// The command sets.
        commands: Vec<CommandSet>,
        /// The menu button.
        menu_button: WebAppButton,
    },
}

/// What [`RecordingGateway`] saw and how it answers.
#[derive(Default)]
struct RecordLog {
    /// Every call, in order (a call answered with the failure too).
    calls: Vec<GatewayCall>,
    /// The error every call answers with, when set.
    failure: Option<GatewayError>,
    /// What the database probe read at each `createInvoiceLink`, in order.
    probes: Vec<Option<(String, Option<String>)>>,
}

/// The it crate's Bot API fake: records every call, answers `Ok` (an invoice link `https://t.me/$test-<payload>`)
/// or the error set by [`RecordingGateway::fail_with`]. With a probe database, each `createInvoiceLink` first reads
/// the order row on a connection of its own, which shows what was committed before the call.
pub(crate) struct RecordingGateway {
    log: Mutex<RecordLog>,
    probe_db: Option<String>,
}

impl RecordingGateway {
    /// A recorder that answers `Ok`.
    pub(crate) fn new() -> Arc<RecordingGateway> {
        Arc::new(RecordingGateway {
            log: Mutex::new(RecordLog::default()),
            probe_db: None,
        })
    }

    /// A recorder whose `createInvoiceLink` first reads the order row (`status`, `invoice_url`) on `database_url`.
    pub(crate) fn probing(database_url: String) -> Arc<RecordingGateway> {
        Arc::new(RecordingGateway {
            log: Mutex::new(RecordLog::default()),
            probe_db: Some(database_url),
        })
    }

    /// Every call from now on answers `failure` (`None`: `Ok` again).
    pub(crate) fn fail_with(&self, failure: Option<GatewayError>) {
        self.log().failure = failure;
    }

    /// Every call so far, in order.
    pub(crate) fn calls(&self) -> Vec<GatewayCall> {
        self.log().calls.clone()
    }

    /// The `createInvoiceLink` specs so far, in order.
    pub(crate) fn invoice_calls(&self) -> Vec<InvoiceSpec> {
        self.log()
            .calls
            .iter()
            .filter_map(|call| match call {
                GatewayCall::Invoice(spec) => Some(spec.clone()),
                _ => None,
            })
            .collect()
    }

    /// The latest answer given to pre-checkout query `query_id` (`None`: never answered).
    pub(crate) fn answer(&self, query_id: &str) -> Option<Result<(), String>> {
        self.log().calls.iter().rev().find_map(|call| match call {
            GatewayCall::PreCheckout {
                query_id: id,
                verdict,
            } if id == query_id => Some(verdict.clone()),
            _ => None,
        })
    }

    /// What the probe read at each `createInvoiceLink`: the order row's (`status`, `invoice_url`), or `None` when no
    /// committed row existed.
    pub(crate) fn probes(&self) -> Vec<Option<(String, Option<String>)>> {
        self.log().probes.clone()
    }

    /// The log; a test that panicked while holding it left it readable.
    fn log(&self) -> MutexGuard<'_, RecordLog> {
        self.log.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Records `call` and returns the configured answer.
    fn record(&self, call: GatewayCall) -> Result<(), GatewayError> {
        let mut log = self.log();
        log.calls.push(call);
        log.failure.clone().map_or(Ok(()), Err)
    }
}

/// The order row `order` as a connection outside the app pool sees it: only what was committed.
async fn probe_order(database_url: &str, order: &OrderId) -> Option<(String, Option<String>)> {
    let mut conn = PgConnection::connect(database_url).await.unwrap();
    let row = sqlx::query_as("SELECT status, invoice_url FROM orders WHERE id = $1")
        .bind(&order.0)
        .fetch_optional(&mut conn)
        .await
        .unwrap();
    conn.close().await.unwrap();
    row
}

impl BotGateway for RecordingGateway {
    fn create_invoice_link(&self, spec: InvoiceSpec) -> BoxFut<'_, Result<String, GatewayError>> {
        Box::pin(async move {
            if let Some(database_url) = &self.probe_db {
                let seen = probe_order(database_url, &spec.payload).await;
                self.log().probes.push(seen);
            }
            let mut link = String::from(TEST_LINK_PREFIX);
            link.push_str(&spec.payload.0);
            self.record(GatewayCall::Invoice(spec))?;
            Ok(link)
        })
    }

    fn answer_pre_checkout(
        &self,
        query_id: String,
        verdict: Result<(), String>,
    ) -> BoxFut<'_, Result<(), GatewayError>> {
        Box::pin(async move { self.record(GatewayCall::PreCheckout { query_id, verdict }) })
    }

    fn refund_star_payment(
        &self,
        user: UserId,
        charge: ChargeId,
    ) -> BoxFut<'_, Result<(), GatewayError>> {
        Box::pin(async move { self.record(GatewayCall::Refund { user, charge }) })
    }

    fn send_message(&self, msg: OutMessage) -> BoxFut<'_, Result<(), GatewayError>> {
        Box::pin(async move { self.record(GatewayCall::Message(msg)) })
    }

    fn setup(&self, s: SetupSpec) -> BoxFut<'_, Result<(), GatewayError>> {
        Box::pin(async move {
            self.record(GatewayCall::Setup {
                webhook_url: s.webhook_url,
                secret_token: s.secret_token,
                commands: s.commands,
                menu_button: s.menu_button,
            })
        })
    }
}

fn report(failures: &[String]) {
    assert!(
        failures.is_empty(),
        "{} failures:\n{}",
        failures.len(),
        failures.join("\n")
    );
}

/// A state at `T0` on the fixture whose `users` table holds `users` (id, Telegram language tag), calling the Bot API
/// through a fresh [`RecordingGateway`].
pub(crate) async fn invoice_state(
    users: &[(i64, Option<&str>)],
) -> (AppState, common::TestDb, Arc<RecordingGateway>) {
    let (st, db) = common::test_state().await;
    let gateway = RecordingGateway::new();
    let st = st
        .with_clock(Arc::new(FixedClock(T0)))
        .with_gateway(gateway.clone());
    for &(id, language_code) in users {
        st.repo
            .upsert_user(UserId(id), "Ann", language_code, T0)
            .await
            .unwrap();
    }
    (st, db, gateway)
}

/// `st` reading the time `t`.
fn at(st: &AppState, t: i64) -> AppState {
    st.clone().with_clock(Arc::new(FixedClock(t)))
}

/// `Authorization` for `user`: a token issued at the state's own clock. A re-clocked state needs it: a token issued at
/// `T0` is `token_expired` once the clock passes `T0` + the test TTL (1800 s).
pub(crate) fn bearer_now(st: &AppState, user: i64) -> String {
    let (token, _) = issue_token(
        &st.keys.token,
        UserId(user),
        st.clock.now(),
        st.cfg.token_ttl_secs,
    );
    format!("Bearer {token}")
}

/// `POST /api/invoices` with `body` as `application/json`, as `user` (a token from [`bearer_now`]) or without
/// `Authorization`.
pub(crate) async fn post_invoice(st: &AppState, user: Option<i64>, body: &str) -> common::Reply {
    let mut req = Request::post("/api/invoices").header(CONTENT_TYPE, "application/json");
    if let Some(user) = user {
        req = req.header(AUTHORIZATION, bearer_now(st, user));
    }
    common::call(st, req.body(Body::from(body.to_owned())).unwrap()).await
}

/// `{"productId": <product>}`.
fn invoice_body(product: &str) -> String {
    json!({ "productId": product }).to_string()
}

fn body_text(reply: &common::Reply) -> String {
    String::from_utf8_lossy(&reply.body).into_owned()
}

/// A 200 `CreateInvoiceResponse` with exactly its two keys, an order id in the grammar and the recorder's link for
/// it: the (orderId, invoiceUrl). Anything else is a failure line and `None`.
fn invoice_reply(
    case: &str,
    reply: &common::Reply,
    failures: &mut Vec<String>,
) -> Option<(String, String)> {
    let body: Value = serde_json::from_slice(&reply.body).unwrap_or(Value::Null);
    let parsed = (|| {
        let object = body.as_object().filter(|o| o.len() == 2)?;
        let order = object.get("orderId")?.as_str()?;
        let link = object.get("invoiceUrl")?.as_str()?;
        parse_order_id(order)?;
        let mut want_link = String::from(TEST_LINK_PREFIX);
        want_link.push_str(order);
        (link == want_link).then(|| (order.to_owned(), link.to_owned()))
    })();
    match parsed {
        Some(pair) if reply.status.as_u16() == 200 => Some(pair),
        _ => {
            failures.push(format!(
                "{case}: expected 200 {{orderId: o_<32 hex>, invoiceUrl: {TEST_LINK_PREFIX}<orderId>}}, got {} {:?}",
                reply.status.as_u16(),
                body_text(reply)
            ));
            None
        }
    }
}

/// The mismatch of `reply` against `status` with exactly the error body of `code`.
fn expect_error(case: &str, reply: &common::Reply, status: u16, code: &str) -> Option<String> {
    let body: Value = serde_json::from_slice(&reply.body).unwrap_or(Value::Null);
    (reply.status.as_u16() != status || body != json!({ "error": code })).then(|| {
        format!(
            "{case}: expected {status} {{\"error\":\"{code}\"}}, got {} {:?}",
            reply.status.as_u16(),
            body_text(reply)
        )
    })
}

/// An orders row: (id, user_id, product_id, amount, currency, status, invoice_url, created_at).
type OrderRow = (
    String,
    i64,
    String,
    i64,
    String,
    String,
    Option<String>,
    i64,
);

/// Every orders row, by id.
async fn order_rows(st: &AppState) -> Vec<OrderRow> {
    let mut conn = common::raw_db(st).await;
    let rows = sqlx::query_as(
        "SELECT id, user_id, product_id, amount, currency, status, invoice_url, created_at FROM orders ORDER BY id",
    )
    .fetch_all(&mut conn)
    .await
    .unwrap();
    conn.close().await.unwrap();
    rows
}

/// The compiled-in catalog with chapter `ch` priced at `price`.
fn catalog_priced(st: &AppState, ch: &str, price: u32) -> Arc<Catalog> {
    let mut file: Value = serde_json::from_str(CATALOG_JSON).unwrap();
    let mut prices = Map::new();
    prices.insert(ch.to_owned(), json!(price));
    file["chapters"]["priceStars"] = Value::Object(prices);
    Arc::new(Catalog::build(&file.to_string(), &st.content).unwrap())
}

/// The price and the texts come from the state's catalog, never from the body: a body naming 1 Star in USD buys at
/// the catalog's 77 XTR, and the row and the one gateway call agree. The compiled-in catalog sells at 1.
#[tokio::test]
async fn invoice_price_from_catalog() {
    let (st, _db, gateway) = invoice_state(&[(ANN, Some("ru"))]).await;
    let mut failures = Vec::new();
    let priced = st.clone().with_catalog(catalog_priced(&st, "ch2", 77));
    let reply = post_invoice(
        &priced,
        Some(ANN),
        r#"{"productId":"chapter:ch2","priceStars":1,"amount":1,"currency":"USD"}"#,
    )
    .await;
    if let Some((order, link)) = invoice_reply("priced 77", &reply, &mut failures) {
        let want_calls = vec![GatewayCall::Invoice(InvoiceSpec {
            title: "Архив".to_owned(),
            description: "«Усадьба»: Архив".to_owned(),
            payload: OrderId(order.clone()),
            label: "Архив".to_owned(),
            amount: 77,
        })];
        let calls = gateway.calls();
        if calls != want_calls {
            failures.push(format!(
                "priced 77: gateway calls: expected {want_calls:?}, got {calls:?}"
            ));
        }
        let want_rows: Vec<OrderRow> = vec![(
            order,
            ANN,
            "chapter:ch2".to_owned(),
            77,
            "XTR".to_owned(),
            "created".to_owned(),
            Some(link),
            T0,
        )];
        let rows = order_rows(&st).await;
        if rows != want_rows {
            failures.push(format!(
                "priced 77: orders rows: expected {want_rows:?}, got {rows:?}"
            ));
        }
    }

    // The compiled-in catalog: 1 Star, so a new order (a recent one at another price is not handed out).
    let reply = post_invoice(&st, Some(ANN), &invoice_body("chapter:ch2")).await;
    if invoice_reply("compiled-in catalog", &reply, &mut failures).is_some() {
        let amounts: Vec<u32> = gateway
            .invoice_calls()
            .iter()
            .map(|spec| spec.amount)
            .collect();
        if amounts != [77, 1] {
            failures.push(format!(
                "compiled-in catalog: spec amounts: expected [77, 1], got {amounts:?}"
            ));
        }
        let mut rows: Vec<i64> = order_rows(&st).await.iter().map(|row| row.3).collect();
        rows.sort_unstable();
        if rows != [1, 77] {
            failures.push(format!(
                "compiled-in catalog: orders.amount: expected [1, 77], got {rows:?}"
            ));
        }
    }
    report(&failures);
}

/// What a step of [`invoice_reuses_recent_order`] expects.
enum Want {
    /// The first order handed out again, with the first body.
    Reuse,
    /// A new order.
    New,
}

/// The steps of [`invoice_reuses_recent_order`]: every order seen so far, and the failures.
struct ReuseSteps<'g> {
    gateway: &'g RecordingGateway,
    /// The first reply's order and body.
    first: (String, axum::body::Bytes),
    /// Every distinct order handed out, in order.
    seen: Vec<String>,
    failures: Vec<String>,
}

impl ReuseSteps<'_> {
    /// One `POST /api/invoices` of `product` by `user` on `st`, checked against `want`; then the gateway calls and the
    /// orders rows must each equal the distinct orders seen. The order handed out, if the reply was one.
    async fn post(
        &mut self,
        case: &str,
        st: &AppState,
        user: i64,
        product: &str,
        want: Want,
    ) -> Option<String> {
        let reply = post_invoice(st, Some(user), &invoice_body(product)).await;
        let (order, _) = invoice_reply(case, &reply, &mut self.failures)?;
        match want {
            Want::Reuse => {
                if order != self.first.0 || reply.body != self.first.1 {
                    self.failures.push(format!(
                        "{case}: expected order {} with the first body, got {order} {:?}",
                        self.first.0,
                        body_text(&reply)
                    ));
                }
            }
            Want::New => {
                if self.seen.contains(&order) {
                    self.failures
                        .push(format!("{case}: expected a new order, got {order} again"));
                }
                self.seen.push(order.clone());
            }
        }
        let calls = self.gateway.invoice_calls().len();
        let rows = order_rows(st).await.len();
        let n = self.seen.len();
        if (calls, rows) != (n, n) {
            self.failures.push(format!(
                "{case}: gateway calls / orders rows: expected {n} / {n}, got {calls} / {rows}"
            ));
        }
        Some(order)
    }
}

/// A recent `created` order with a link is handed out again, with no gateway call: at `T0` and up to `T0+3599`. At
/// `T0+3600` (the window's edge), after the order moved to `checkout`, at a new price, for another product and for
/// another user, it is a new order. Every request carries a token issued at its state's clock.
#[tokio::test]
async fn invoice_reuses_recent_order() {
    let (st, _db, gateway) = invoice_state(&[(ANN, Some("ru")), (BEN, Some("en"))]).await;
    let mut first_failures = Vec::new();
    let first = post_invoice(&st, Some(ANN), &invoice_body("chapter:ch2")).await;
    let Some((a, _)) = invoice_reply("first POST at T0", &first, &mut first_failures) else {
        report(&first_failures);
        return;
    };
    let mut steps = ReuseSteps {
        gateway: &gateway,
        first: (a.clone(), first.body.clone()),
        seen: vec![a],
        failures: first_failures,
    };
    steps
        .post("second POST at T0", &st, ANN, "chapter:ch2", Want::Reuse)
        .await;
    let late = at(&st, T0 + 3599);
    steps
        .post("POST at T0+3599", &late, ANN, "chapter:ch2", Want::Reuse)
        .await;
    let edge = at(&st, T0 + 3600);
    let b = steps
        .post("POST at T0+3600", &edge, ANN, "chapter:ch2", Want::New)
        .await;
    if let Some(b) = b {
        let mut conn = common::raw_db(&st).await;
        sqlx::query("UPDATE orders SET status = 'checkout', checkout_at = $2 WHERE id = $1")
            .bind(&b)
            .bind(T0 + 3600)
            .execute(&mut conn)
            .await
            .unwrap();
        conn.close().await.unwrap();
        steps
            .post(
                "POST after the order moved to checkout",
                &edge,
                ANN,
                "chapter:ch2",
                Want::New,
            )
            .await;
    }
    let repriced = edge.clone().with_catalog(catalog_priced(&st, "ch2", 5));
    steps
        .post(
            "POST at a new price",
            &repriced,
            ANN,
            "chapter:ch2",
            Want::New,
        )
        .await;
    steps
        .post("POST for chapter:ch4", &edge, ANN, "chapter:ch4", Want::New)
        .await;
    steps
        .post("POST by another user", &edge, BEN, "chapter:ch2", Want::New)
        .await;
    report(&steps.failures);
}

/// The order row is committed, without a link, when the gateway is called: a connection outside the app pool reads it
/// from inside the call.
#[tokio::test]
async fn invoice_order_committed_before_gateway_call() {
    let (st, _db, _) = invoice_state(&[(ANN, Some("ru"))]).await;
    let probe = RecordingGateway::probing(st.cfg.database_url.clone());
    let st = st.with_gateway(probe.clone());
    let mut failures = Vec::new();
    let reply = post_invoice(&st, Some(ANN), &invoice_body("chapter:ch2")).await;
    invoice_reply("POST", &reply, &mut failures);
    let probes = probe.probes();
    let want = vec![Some(("created".to_owned(), None))];
    if probes != want {
        failures.push(format!("probe: expected {want:?}, got {probes:?}"));
    }
    report(&failures);
}

/// A gateway failure is 502 `telegram_unavailable` (`no-store`), and the order stays `created` without a link. A
/// retry makes a new order: a linkless order is never handed out.
#[tokio::test]
async fn invoice_gateway_error_502_order_kept() {
    let (st, _db, gateway) = invoice_state(&[(ANN, Some("ru"))]).await;
    let mut failures = Vec::new();
    gateway.fail_with(Some(GatewayError::Timeout));
    let reply = post_invoice(&st, Some(ANN), &invoice_body("chapter:ch2")).await;
    failures.extend(expect_error(
        "gateway timeout",
        &reply,
        502,
        "telegram_unavailable",
    ));
    let cache = reply
        .headers
        .get(CACHE_CONTROL)
        .map(|v| v.to_str().unwrap_or("<not text>"));
    if cache != Some("no-store") {
        failures.push(format!(
            "gateway timeout: cache-control: expected no-store, got {cache:?}"
        ));
    }
    let rows = order_rows(&st).await;
    let failed = match rows.as_slice() {
        [row] if row.5 == "created" && row.6.is_none() => Some(row.0.clone()),
        _ => {
            failures.push(format!(
                "after the 502: expected one created row without a link, got {rows:?}"
            ));
            None
        }
    };

    gateway.fail_with(None);
    let reply = post_invoice(&st, Some(ANN), &invoice_body("chapter:ch2")).await;
    if let Some((order, _)) = invoice_reply("retry", &reply, &mut failures)
        && failed.as_deref() == Some(order.as_str())
    {
        failures.push(format!(
            "retry: expected a new order, got the linkless {order}"
        ));
    }
    let rows = order_rows(&st).await.len();
    let calls = gateway.invoice_calls().len();
    if (rows, calls) != (2, 2) {
        failures.push(format!(
            "after the retry: orders rows / gateway calls: expected 2 / 2, got {rows} / {calls}"
        ));
    }
    report(&failures);
}

/// A product the catalog does not sell is 404 `unknown_product`, with no row and no gateway call: a free chapter, an
/// unknown chapter, a hint tier, an unknown pack, the empty id and an id with U+0000 (which never reaches SQL).
#[tokio::test]
async fn invoice_unknown_product_404() {
    let (st, _db, gateway) = invoice_state(&[(ANN, Some("ru"))]).await;
    let mut failures = Vec::new();
    for product in [
        "chapter:ch1",
        "chapter:ch99",
        "hint:ch1.drawer:1",
        "pack:no_such_pack",
        "",
        "chapter:ch2\u{0}",
    ] {
        let reply = post_invoice(&st, Some(ANN), &invoice_body(product)).await;
        failures.extend(expect_error(
            &format!("productId {product:?}"),
            &reply,
            404,
            "unknown_product",
        ));
    }
    let rows = order_rows(&st).await.len();
    let calls = gateway.calls().len();
    if (rows, calls) != (0, 0) {
        failures.push(format!(
            "orders rows / gateway calls: expected 0 / 0, got {rows} / {calls}"
        ));
    }
    report(&failures);
}

/// An owned chapter is 409 `already_owned`, with no row and no gateway call; a chapter not owned still sells.
#[tokio::test]
async fn invoice_already_owned_409() {
    let (st, _db, gateway) = invoice_state(&[(ANN, Some("ru"))]).await;
    own(&st, ANN, "chapter:ch2").await;
    let mut failures = Vec::new();
    let reply = post_invoice(&st, Some(ANN), &invoice_body("chapter:ch2")).await;
    failures.extend(expect_error(
        "owned chapter:ch2",
        &reply,
        409,
        "already_owned",
    ));
    let rows = order_rows(&st).await.len();
    let calls = gateway.calls().len();
    if (rows, calls) != (0, 0) {
        failures.push(format!(
            "owned chapter:ch2: orders rows / gateway calls: expected 0 / 0, got {rows} / {calls}"
        ));
    }
    let reply = post_invoice(&st, Some(ANN), &invoice_body("chapter:ch4")).await;
    invoice_reply("control chapter:ch4", &reply, &mut failures);
    report(&failures);
}

/// The invoice texts follow the user's Telegram language (K29): Russian for `ru`, `uk`, `be` and `kk` (primary
/// subtag, ASCII case-insensitive), English for anything else and for no tag.
#[tokio::test]
async fn invoice_title_in_user_language() {
    let users: [(i64, Option<&str>, bool); 9] = [
        (2001, Some("ru"), true),
        (2002, Some("uk"), true),
        (2003, Some("be"), true),
        (2004, Some("kk-KZ"), true),
        (2005, Some("en"), false),
        (2006, Some("de"), false),
        (2007, None, false),
        (2008, Some("RU"), true),
        (2009, Some("Kk-KZ"), true),
    ];
    let with_tags: Vec<(i64, Option<&str>)> = users.iter().map(|&(id, tag, _)| (id, tag)).collect();
    let (st, _db, gateway) = invoice_state(&with_tags).await;
    let mut failures = Vec::new();
    for (id, tag, russian) in users {
        let reply = post_invoice(&st, Some(id), &invoice_body("chapter:ch2")).await;
        let case = format!("language {tag:?}");
        let Some((order, _)) = invoice_reply(&case, &reply, &mut failures) else {
            continue;
        };
        let (title, description) = if russian {
            ("Архив", "«Усадьба»: Архив")
        } else {
            ("The Archive", "“The Manor”: The Archive")
        };
        let spec = gateway
            .invoice_calls()
            .into_iter()
            .find(|spec| spec.payload.0 == order);
        let got = spec.as_ref().map(|spec| {
            (
                spec.title.as_str(),
                spec.description.as_str(),
                spec.label.as_str(),
            )
        });
        if got != Some((title, description, title)) {
            failures.push(format!(
                "{case}: expected title / description / label {title:?} / {description:?} / {title:?}, got {got:?}"
            ));
        }
    }
    report(&failures);
}

/// A request without a token is 401; a body that is not the expected JSON is 400; a body over 16 KB is 413. None
/// makes a row or a gateway call.
#[tokio::test]
async fn invoice_rejects_bad_requests() {
    let (st, _db, gateway) = invoice_state(&[(ANN, Some("ru"))]).await;
    let mut failures = Vec::new();
    let reply = post_invoice(&st, None, &invoice_body("chapter:ch2")).await;
    failures.extend(expect_error("no bearer", &reply, 401, "token_missing"));
    let padding = "x".repeat(17 * 1024);
    let oversized = json!({ "productId": "chapter:ch2", "pad": padding }).to_string();
    for (case, body, status, code) in [
        ("not JSON", "not json", 400, "bad_request"),
        ("{}", "{}", 400, "bad_request"),
        (
            "productId a number",
            r#"{"productId":7}"#,
            400,
            "bad_request",
        ),
        ("a 17 KB body", oversized.as_str(), 413, "payload_too_large"),
    ] {
        let reply = post_invoice(&st, Some(ANN), body).await;
        failures.extend(expect_error(case, &reply, status, code));
    }
    let rows = order_rows(&st).await.len();
    let calls = gateway.calls().len();
    if (rows, calls) != (0, 0) {
        failures.push(format!(
            "orders rows / gateway calls: expected 0 / 0, got {rows} / {calls}"
        ));
    }
    report(&failures);
}

/// `GET /api/orders/{orderId}` as `user` (a token from [`bearer_now`]) or without `Authorization`; `id` goes into the
/// path as given (already percent-encoded where it must be).
async fn get_order(st: &AppState, user: Option<i64>, id: &str) -> common::Reply {
    let mut req = Request::get(format!("/api/orders/{id}"));
    if let Some(user) = user {
        req = req.header(AUTHORIZATION, bearer_now(st, user));
    }
    common::call(st, req.body(Body::empty()).unwrap()).await
}

/// The mismatch of `reply` against a 200 `OrderResponse` of `order` for `chapter:ch2` in `status`, `no-store`.
fn expect_order(case: &str, reply: &common::Reply, order: &str, status: &str) -> Vec<String> {
    let mut failures = Vec::new();
    let body: Value = serde_json::from_slice(&reply.body).unwrap_or(Value::Null);
    let want = json!({ "orderId": order, "productId": "chapter:ch2", "status": status });
    if reply.status.as_u16() != 200 || body != want {
        failures.push(format!(
            "{case}: expected 200 {want}, got {} {:?}",
            reply.status.as_u16(),
            body_text(reply)
        ));
    }
    let cache = reply
        .headers
        .get(CACHE_CONTROL)
        .map(|v| v.to_str().unwrap_or("<not text>"));
    if cache != Some("no-store") {
        failures.push(format!(
            "{case}: cache-control: expected no-store, got {cache:?}"
        ));
    }
    failures
}

/// Another user's order is 404 `not_found`, like an unknown one; its owner reads it.
#[tokio::test]
async fn order_other_user_404() {
    let (st, _db, _) = invoice_state(&[(ANN, Some("ru")), (BEN, Some("en"))]).await;
    let mut failures = Vec::new();
    let reply = post_invoice(&st, Some(ANN), &invoice_body("chapter:ch2")).await;
    if let Some((order, _)) = invoice_reply("ANN's invoice", &reply, &mut failures) {
        let reply = get_order(&st, Some(BEN), &order).await;
        failures.extend(expect_error("BEN", &reply, 404, "not_found"));
        let reply = get_order(&st, Some(ANN), &order).await;
        failures.extend(expect_order("ANN", &reply, &order, "created"));
    }
    report(&failures);
}

/// The status is the row's: `checkout`, `paid` (with its payment row) and `refunded`, each `no-store`.
#[tokio::test]
async fn order_status_follows_row() {
    let (st, _db, _) = invoice_state(&[(ANN, Some("ru"))]).await;
    let mut failures = Vec::new();
    let reply = post_invoice(&st, Some(ANN), &invoice_body("chapter:ch2")).await;
    let Some((order, _)) = invoice_reply("ANN's invoice", &reply, &mut failures) else {
        report(&failures);
        return;
    };
    let mut conn = common::raw_db(&st).await;
    sqlx::query("UPDATE orders SET status = 'checkout', checkout_at = $2 WHERE id = $1")
        .bind(&order)
        .bind(T0)
        .execute(&mut conn)
        .await
        .unwrap();
    let reply = get_order(&st, Some(ANN), &order).await;
    failures.extend(expect_order("checkout", &reply, &order, "checkout"));

    // `paid` needs its payment row (`orders_charge_fk`, `orders_paid_has_charge`).
    sqlx::query(
        "INSERT INTO payments (telegram_payment_charge_id, invoice_payload, user_id, amount, currency, \
         provider_payment_charge_id, paid_at, refunded_at) VALUES ('ch-1', $1, $2, 1, 'XTR', '', $3, NULL)",
    )
    .bind(&order)
    .bind(ANN)
    .bind(T0)
    .execute(&mut conn)
    .await
    .unwrap();
    sqlx::query(
        "UPDATE orders SET status = 'paid', charge_id = 'ch-1', paid_at = $2 WHERE id = $1",
    )
    .bind(&order)
    .bind(T0)
    .execute(&mut conn)
    .await
    .unwrap();
    let reply = get_order(&st, Some(ANN), &order).await;
    failures.extend(expect_order("paid", &reply, &order, "paid"));

    sqlx::query("UPDATE orders SET status = 'refunded' WHERE id = $1")
        .bind(&order)
        .execute(&mut conn)
        .await
        .unwrap();
    conn.close().await.unwrap();
    let reply = get_order(&st, Some(ANN), &order).await;
    failures.extend(expect_order("refunded", &reply, &order, "refunded"));
    report(&failures);
}

/// An unknown order and every path segment outside the order id grammar are 404 `not_found`, never a 500: a U+0000
/// or a non-UTF-8 segment never reaches SQL. Without a token it is 401.
#[tokio::test]
async fn order_unknown_or_malformed_404() {
    let (st, _db, _) = invoice_state(&[(ANN, Some("ru"))]).await;
    let mut failures = Vec::new();
    for (case, id) in [
        ("unknown", "o_00000000000000000000000000000000"),
        ("not the grammar", "nope"),
        ("upper-case hex", "o_0123456789ABCDEF0123456789ABCDEF"),
        ("33 hex", "o_0123456789abcdef0123456789abcdef0"),
        ("U+0000", "o_%000123456789abcdef0123456789abcde"),
        ("not UTF-8", "%FF"),
    ] {
        let reply = get_order(&st, Some(ANN), id).await;
        failures.extend(expect_error(case, &reply, 404, "not_found"));
    }
    let reply = get_order(&st, None, "o_00000000000000000000000000000000").await;
    failures.extend(expect_error("no bearer", &reply, 401, "token_missing"));
    report(&failures);
}

/// A Bot API whose `answerPreCheckoutQuery` never returns; every other call answers `Ok` at once (an invoice link in
/// the recorder's form).
struct HungAnswerGateway;

impl BotGateway for HungAnswerGateway {
    fn create_invoice_link(&self, spec: InvoiceSpec) -> BoxFut<'_, Result<String, GatewayError>> {
        Box::pin(async move {
            let mut link = String::from(TEST_LINK_PREFIX);
            link.push_str(&spec.payload.0);
            Ok(link)
        })
    }

    fn answer_pre_checkout(
        &self,
        _query_id: String,
        _verdict: Result<(), String>,
    ) -> BoxFut<'_, Result<(), GatewayError>> {
        Box::pin(std::future::pending())
    }

    fn refund_star_payment(
        &self,
        _user: UserId,
        _charge: ChargeId,
    ) -> BoxFut<'_, Result<(), GatewayError>> {
        Box::pin(async { Ok(()) })
    }

    fn send_message(&self, _msg: OutMessage) -> BoxFut<'_, Result<(), GatewayError>> {
        Box::pin(async { Ok(()) })
    }

    fn setup(&self, _s: SetupSpec) -> BoxFut<'_, Result<(), GatewayError>> {
        Box::pin(async { Ok(()) })
    }
}

/// A pre-checkout through the webhook: its HTTP status and the answer the recorder got (`None`: unanswered).
type Answered = (u16, Option<Result<(), String>>);

/// `update` (a `pre_checkout_query`) through the webhook, and what `gateway` answered to its query id.
async fn answered(st: &AppState, gateway: &RecordingGateway, update: &Value) -> Answered {
    let reply = post_update(st, update).await;
    let query_id = update["pre_checkout_query"]["id"]
        .as_str()
        .unwrap_or_default();
    (reply.status.as_u16(), gateway.answer(query_id))
}

/// The refusal the payer sees for `reason` in `lang`. Each test names the language literally, never through the
/// rule under test.
pub(crate) fn refusal(reason: RejectReason, lang: Lang) -> Result<(), String> {
    Err(reject_text(reason, lang).to_owned())
}

/// The mismatch of `got` against 200 with the answer `want`.
fn expect_answer(case: &str, got: &Answered, want: &Result<(), String>) -> Option<String> {
    (got.0 != 200 || got.1.as_ref() != Some(want))
        .then(|| format!("{case}: expected 200 {want:?}, got {} {:?}", got.0, got.1))
}

/// The (status, checkout_at) of order `order`, read outside the app pool.
async fn checkout_state(st: &AppState, order: &str) -> (String, Option<i64>) {
    let mut conn = common::raw_db(st).await;
    let row = sqlx::query_as("SELECT status, checkout_at FROM orders WHERE id = $1")
        .bind(order)
        .fetch_one(&mut conn)
        .await
        .unwrap();
    conn.close().await.unwrap();
    row
}

/// The mismatch of order `order`'s status against `want`.
async fn expect_status(case: &str, st: &AppState, order: &str, want: &str) -> Option<String> {
    let got = order_status(st, order).await;
    (got != want).then(|| format!("{case}: order status: expected {want}, got {got}"))
}

/// `owned` of `product` in `GET /api/entitlements` for `user` (a token issued at `T0`).
pub(crate) async fn owned(st: &AppState, user: i64, product: &str) -> Option<bool> {
    let reply = crate::catalog::get(st, Some(user), "/api/entitlements").await;
    let body: Value = serde_json::from_slice(&reply.body).unwrap_or(Value::Null);
    body["products"]
        .as_array()?
        .iter()
        .find(|p| p["productId"] == product)?
        .get("owned")?
        .as_bool()
}

/// A state with `ANN` (Telegram language `language`) and a `created` order of `chapter:ch2` for `ANN` at `T0`:
/// (state, guard, recorder, order, amount). A refused invoice is a failure line and `None`.
async fn order_for_ann(
    language: Option<&str>,
    failures: &mut Vec<String>,
) -> (
    AppState,
    common::TestDb,
    Arc<RecordingGateway>,
    Option<(String, u32)>,
) {
    let (st, db, gateway) = invoice_state(&[(ANN, language)]).await;
    let order = new_order(&st, ANN, failures).await;
    (st, db, gateway, order)
}

/// An accepted pre-checkout moves the order to `checkout` at the state's clock and answers `ok`.
#[tokio::test]
async fn precheckout_ok() {
    let mut failures = Vec::new();
    let (st, _db, gateway, Some((order, amount))) = order_for_ann(Some("ru"), &mut failures).await
    else {
        return report(&failures);
    };
    let update = pre_checkout_update("q-ok", ANN, Some("ru"), "XTR", amount, &order);
    let got = answered(&st, &gateway, &update).await;
    failures.extend(expect_answer("ok", &got, &Ok(())));
    let state = checkout_state(&st, &order).await;
    if state != ("checkout".to_owned(), Some(T0)) {
        failures.push(format!(
            "order: expected (checkout, Some({T0})), got {state:?}"
        ));
    }
    report(&failures);
}

/// An amount other than the order's is refused `Mismatch` (Russian payer) and leaves the order `created`.
#[tokio::test]
async fn precheckout_wrong_amount() {
    let mut failures = Vec::new();
    let (st, _db, gateway, Some((order, amount))) = order_for_ann(Some("ru"), &mut failures).await
    else {
        return report(&failures);
    };
    for (case, asked) in [("amount + 1", amount + 1), ("amount - 1", amount - 1)] {
        let update = pre_checkout_update(case, ANN, Some("ru"), "XTR", asked, &order);
        let got = answered(&st, &gateway, &update).await;
        failures.extend(expect_answer(
            case,
            &got,
            &refusal(RejectReason::Mismatch, Lang::Ru),
        ));
    }
    failures.extend(expect_status("after the refusals", &st, &order, "created").await);
    report(&failures);
}

/// Any currency but exactly `XTR` is refused `Mismatch` (English payer, English text), never a 500: `USD`, `xtr`,
/// and `XTR` + U+0000 (bound as U+FFFD, so no `22021`).
#[tokio::test]
async fn precheckout_wrong_currency() {
    let mut failures = Vec::new();
    let (st, _db, gateway, Some((order, amount))) = order_for_ann(Some("en"), &mut failures).await
    else {
        return report(&failures);
    };
    for (case, currency) in [("USD", "USD"), ("xtr", "xtr"), ("XTR + U+0000", "XTR\u{0}")] {
        let update = pre_checkout_update(case, ANN, Some("en"), currency, amount, &order);
        let got = answered(&st, &gateway, &update).await;
        failures.extend(expect_answer(
            case,
            &got,
            &refusal(RejectReason::Mismatch, Lang::En),
        ));
    }
    failures.extend(expect_status("after the refusals", &st, &order, "created").await);
    report(&failures);
}

/// A pre-checkout from anyone but the order's owner is refused `Mismatch` in the sender's language: `BEN`, a user of
/// the app too (English), opens `ANN`'s forwarded invoice at its amount in `XTR`. The order stays `created`, and
/// `ANN`'s own pre-checkout of it then passes.
#[tokio::test]
async fn precheckout_wrong_payer() {
    let mut failures = Vec::new();
    let (st, _db, gateway) = invoice_state(&[(ANN, Some("ru")), (BEN, Some("en"))]).await;
    let Some((order, amount)) = new_order(&st, ANN, &mut failures).await else {
        return report(&failures);
    };
    let update = pre_checkout_update("q-ben", BEN, Some("en"), "XTR", amount, &order);
    let got = answered(&st, &gateway, &update).await;
    failures.extend(expect_answer(
        "BEN, ANN's order",
        &got,
        &refusal(RejectReason::Mismatch, Lang::En),
    ));
    failures.extend(expect_status("after BEN's refusal", &st, &order, "created").await);
    let update = pre_checkout_update("q-ann", ANN, Some("ru"), "XTR", amount, &order);
    let got = answered(&st, &gateway, &update).await;
    failures.extend(expect_answer("ANN, her own order", &got, &Ok(())));
    report(&failures);
}

/// A payload that names no order is refused `UnknownOrder`: an unknown id in the grammar, a junk one, one with
/// U+0000 and an empty one (the last three never reach SQL). The real order is untouched.
#[tokio::test]
async fn precheckout_unknown_payload() {
    let mut failures = Vec::new();
    let (st, _db, gateway, Some((order, amount))) = order_for_ann(Some("ru"), &mut failures).await
    else {
        return report(&failures);
    };
    for (case, payload) in [
        ("an unknown order", "o_00000000000000000000000000000000"),
        ("not the grammar", "nope"),
        ("U+0000", "o_\u{0}0123456789abcdef0123456789abcde"),
        ("empty", ""),
    ] {
        let update = pre_checkout_update(case, ANN, Some("ru"), "XTR", amount, payload);
        let got = answered(&st, &gateway, &update).await;
        failures.extend(expect_answer(
            case,
            &got,
            &refusal(RejectReason::UnknownOrder, Lang::Ru),
        ));
    }
    failures.extend(expect_status("after the refusals", &st, &order, "created").await);
    report(&failures);
}

/// A payer who owns the product by the time of the pre-checkout is refused `AlreadyOwned`.
#[tokio::test]
async fn precheckout_already_owned() {
    let mut failures = Vec::new();
    let (st, _db, gateway, Some((order, amount))) = order_for_ann(Some("ru"), &mut failures).await
    else {
        return report(&failures);
    };
    own(&st, ANN, "chapter:ch2").await;
    let update = pre_checkout_update("q-owned", ANN, Some("ru"), "XTR", amount, &order);
    let got = answered(&st, &gateway, &update).await;
    failures.extend(expect_answer(
        "owned",
        &got,
        &refusal(RejectReason::AlreadyOwned, Lang::Ru),
    ));
    failures.extend(expect_status("after the refusal", &st, &order, "created").await);
    report(&failures);
}

/// Two orders of one payer for one product: the first enters `checkout`, and the second, a second later, is refused
/// `InProgress` (K18's "two orders, two charges", one after the other). The second order is made once the first is
/// an hour old, so the first is not handed out again.
#[tokio::test]
async fn precheckout_other_order_in_checkout() {
    let mut failures = Vec::new();
    let (st, _db, gateway, Some((first, first_amount))) =
        order_for_ann(Some("ru"), &mut failures).await
    else {
        return report(&failures);
    };
    let later = at(&st, T0 + 3601);
    let Some((second, second_amount)) = new_order(&later, ANN, &mut failures).await else {
        return report(&failures);
    };
    let update = pre_checkout_update("q-first", ANN, Some("ru"), "XTR", first_amount, &first);
    let got = answered(&later, &gateway, &update).await;
    failures.extend(expect_answer("the first order", &got, &Ok(())));
    let update = pre_checkout_update("q-second", ANN, Some("ru"), "XTR", second_amount, &second);
    let got = answered(&at(&st, T0 + 3602), &gateway, &update).await;
    failures.extend(expect_answer(
        "the second order",
        &got,
        &refusal(RejectReason::InProgress, Lang::Ru),
    ));
    failures.extend(expect_status("the second order", &st, &second, "created").await);
    report(&failures);
}

/// One order paid from two devices: a second pre-checkout 5 s after the first is refused `InProgress`; after the
/// 120 s window the same order passes again (a retry after a failed payment).
#[tokio::test]
async fn precheckout_same_order_twice_refused() {
    let mut failures = Vec::new();
    let (st, _db, gateway, Some((order, amount))) = order_for_ann(Some("ru"), &mut failures).await
    else {
        return report(&failures);
    };
    for (case, t, want) in [
        ("T0", T0, Ok(())),
        (
            "T0 + 5",
            T0 + 5,
            refusal(RejectReason::InProgress, Lang::Ru),
        ),
        ("T0 + 121", T0 + 121, Ok(())),
    ] {
        let update = pre_checkout_update(case, ANN, Some("ru"), "XTR", amount, &order);
        let got = answered(&at(&st, t), &gateway, &update).await;
        failures.extend(expect_answer(case, &got, &want));
    }
    let state = checkout_state(&st, &order).await;
    if state != ("checkout".to_owned(), Some(T0 + 121)) {
        failures.push(format!(
            "order: expected (checkout, Some({})), got {state:?}",
            T0 + 121
        ));
    }
    report(&failures);
}

/// An order older than 24 h is refused `Expired`; two seconds younger it still passes (the control, asked after the
/// refusal, which changed nothing).
#[tokio::test]
async fn precheckout_expired_order() {
    let mut failures = Vec::new();
    let (st, _db, gateway, Some((order, amount))) = order_for_ann(Some("ru"), &mut failures).await
    else {
        return report(&failures);
    };
    for (case, t, want) in [
        (
            "created + 86401 s",
            T0 + 86_401,
            refusal(RejectReason::Expired, Lang::Ru),
        ),
        ("created + 86399 s", T0 + 86_399, Ok(())),
    ] {
        let update = pre_checkout_update(case, ANN, Some("ru"), "XTR", amount, &order);
        let got = answered(&at(&st, t), &gateway, &update).await;
        failures.extend(expect_answer(case, &got, &want));
    }
    report(&failures);
}

/// Principle 2: an accepted pre-checkout grants nothing: no payment, no entitlement, and the product is not owned.
#[tokio::test]
async fn precheckout_grants_nothing() {
    let mut failures = Vec::new();
    let (st, _db, gateway, Some((order, amount))) = order_for_ann(Some("ru"), &mut failures).await
    else {
        return report(&failures);
    };
    let update = pre_checkout_update("q-ok", ANN, Some("ru"), "XTR", amount, &order);
    let got = answered(&st, &gateway, &update).await;
    failures.extend(expect_answer("ok", &got, &Ok(())));
    let payments = payment_rows(&st).await;
    if payments != 0 {
        failures.push(format!("payments rows: expected 0, got {payments}"));
    }
    let entitlements = rows(&st, "SELECT count(*) FROM entitlements").await;
    if entitlements != 0 {
        failures.push(format!("entitlements rows: expected 0, got {entitlements}"));
    }
    let owned = owned(&st, ANN, "chapter:ch2").await;
    if owned != Some(false) {
        failures.push(format!(
            "GET /api/entitlements chapter:ch2 owned: expected Some(false), got {owned:?}"
        ));
    }
    report(&failures);
}

/// A Bot API that never answers is cut at 5 s: the webhook answers 200 after 5-7.5 s (real time), inside Telegram's
/// 10 s, and the decision committed before the call stays (`checkout`).
#[tokio::test]
async fn precheckout_answer_times_out_at_5s() {
    let mut failures = Vec::new();
    let (st, _db, _gateway, Some((order, amount))) = order_for_ann(Some("ru"), &mut failures).await
    else {
        return report(&failures);
    };
    let hung = st.clone().with_gateway(Arc::new(HungAnswerGateway));
    let update = pre_checkout_update("q-hung", ANN, Some("ru"), "XTR", amount, &order);
    let started = Instant::now();
    let reply = tokio::time::timeout(Duration::from_secs(9), post_update(&hung, &update)).await;
    let elapsed = started.elapsed().as_secs_f64();
    match reply {
        Err(_) => failures.push("no answer within 9 s".to_owned()),
        Ok(reply) => {
            if reply.status.as_u16() != 200 {
                failures.push(format!(
                    "status: expected 200, got {}",
                    reply.status.as_u16()
                ));
            }
            if !(5.0..7.5).contains(&elapsed) {
                failures.push(format!(
                    "elapsed: expected 5.0 s <= t < 7.5 s, got {elapsed:.2} s"
                ));
            }
        }
    }
    failures.extend(expect_status("after the hung answer", &st, &order, "checkout").await);
    report(&failures);
}

/// The database step under contention: a raw transaction holds the payer's row `FOR UPDATE` through the call, so the
/// payer-row lock cannot be taken. The 2 s budget ends it (`lock_timeout` or the deadline): refused `Temporary`
/// after 2-4 s with 200, and the order stays `created`.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn precheckout_lock_timeout_temporary() {
    let mut failures = Vec::new();
    let (st, _db, gateway, Some((order, amount))) = order_for_ann(Some("ru"), &mut failures).await
    else {
        return report(&failures);
    };
    let mut a = common::raw_db(&st).await;
    sqlx::raw_sql("BEGIN ISOLATION LEVEL READ COMMITTED")
        .execute(&mut a)
        .await
        .unwrap();
    sqlx::query("SELECT 1 FROM users WHERE id = $1 FOR UPDATE")
        .bind(ANN)
        .execute(&mut a)
        .await
        .unwrap();
    let update = pre_checkout_update("q-locked", ANN, Some("ru"), "XTR", amount, &order);
    let started = Instant::now();
    let got = answered(&st, &gateway, &update).await;
    let elapsed = started.elapsed().as_secs_f64();
    sqlx::raw_sql("ROLLBACK").execute(&mut a).await.unwrap();
    a.close().await.unwrap();
    failures.extend(expect_answer(
        "locked payer",
        &got,
        &refusal(RejectReason::Temporary, Lang::Ru),
    ));
    if !(2.0..4.0).contains(&elapsed) {
        failures.push(format!(
            "elapsed: expected 2.0 s <= t < 4.0 s, got {elapsed:.2} s"
        ));
    }
    failures.extend(expect_status("after the timeout", &st, &order, "created").await);
    report(&failures);
}

/// A raw READ COMMITTED transaction A that takes `ANN`'s payer-row lock and moves `order` to `checkout` at `t`,
/// uncommitted: the stand-in for a concurrent pre-checkout of the app (a raw connection otherwise runs under the
/// test database's hostile `repeatable read` default).
async fn hold_checkout(st: &AppState, order: &str, t: i64) -> PgConnection {
    let mut a = common::raw_db(st).await;
    sqlx::raw_sql("BEGIN ISOLATION LEVEL READ COMMITTED")
        .execute(&mut a)
        .await
        .unwrap();
    sqlx::query("SELECT 1 FROM users WHERE id = $1 FOR NO KEY UPDATE")
        .bind(ANN)
        .execute(&mut a)
        .await
        .unwrap();
    sqlx::query("UPDATE orders SET status = 'checkout', checkout_at = $2 WHERE id = $1")
        .bind(order)
        .bind(t)
        .execute(&mut a)
        .await
        .unwrap();
    a
}

/// B, `update` through the webhook on `st`, against A's open transaction: B must be seen waiting for a lock before A
/// commits, and finishing first is a failure line ("B never waited"). Then A commits, and B's status and answer
/// return.
async fn race_pre_checkout(
    st: &AppState,
    gateway: &RecordingGateway,
    mut a: PgConnection,
    update: Value,
    failures: &mut Vec<String>,
) -> Answered {
    let query_id = update["pre_checkout_query"]["id"]
        .as_str()
        .unwrap_or_default()
        .to_owned();
    let app = st.clone();
    let mut b = tokio::spawn(async move { post_update(&app, &update).await.status.as_u16() });
    let early = tokio::select! {
        biased;
        status = &mut b => Some(status.unwrap()),
        () = common::wait_for_lock_waiter(st) => None,
    };
    if early.is_some() {
        failures.push("B never waited: it finished while A held its transaction open".to_owned());
    }
    sqlx::raw_sql("COMMIT").execute(&mut a).await.unwrap();
    a.close().await.unwrap();
    let status = match early {
        Some(status) => status,
        None => b.await.unwrap(),
    };
    (status, gateway.answer(&query_id))
}

/// RULINGS 14, "two orders, two charges": A holds its pre-checkout of order 1 uncommitted; B's pre-checkout of
/// order 2 waits on the payer-row lock, then sees A's `checkout` and is refused `InProgress`. Only order 1 is in
/// `checkout`.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn precheckout_concurrent_two_orders_one_passes() {
    let mut failures = Vec::new();
    let (st, _db, gateway, Some((first, _))) = order_for_ann(Some("ru"), &mut failures).await
    else {
        return report(&failures);
    };
    let later = at(&st, T0 + 3601);
    let Some((second, second_amount)) = new_order(&later, ANN, &mut failures).await else {
        return report(&failures);
    };
    let a = hold_checkout(&st, &first, T0 + 3601).await;
    let update = pre_checkout_update("q-b", ANN, Some("ru"), "XTR", second_amount, &second);
    let got = race_pre_checkout(&later, &gateway, a, update, &mut failures).await;
    failures.extend(expect_answer(
        "B (order 2)",
        &got,
        &refusal(RejectReason::InProgress, Lang::Ru),
    ));
    let statuses = (
        order_status(&st, &first).await,
        order_status(&st, &second).await,
    );
    if statuses != ("checkout".to_owned(), "created".to_owned()) {
        failures.push(format!(
            "statuses (order 1, order 2): expected (checkout, created), got {statuses:?}"
        ));
    }
    report(&failures);
}

/// RULINGS 14, "one order on two devices": A holds its pre-checkout of the order uncommitted; B's pre-checkout of
/// the same order waits on the payer-row lock, then sees A's committed `checkout` and is refused `InProgress`.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn precheckout_concurrent_same_order_one_passes() {
    let mut failures = Vec::new();
    let (st, _db, gateway, Some((order, amount))) = order_for_ann(Some("ru"), &mut failures).await
    else {
        return report(&failures);
    };
    let a = hold_checkout(&st, &order, T0).await;
    let update = pre_checkout_update("q-b", ANN, Some("ru"), "XTR", amount, &order);
    let got = race_pre_checkout(&st, &gateway, a, update, &mut failures).await;
    failures.extend(expect_answer(
        "B (the same order)",
        &got,
        &refusal(RejectReason::InProgress, Lang::Ru),
    ));
    report(&failures);
}

/// A third player.
const CAT: i64 = 1003;

/// A `successful_payment` fact from `payer`: `amount` of `currency` for `payload`, charge `charge`, no provider id.
fn fact(payer: i64, currency: &str, amount: u32, payload: &str, charge: &str) -> PaymentFact {
    PaymentFact {
        payer: UserId(payer),
        currency: currency.to_owned(),
        total_amount: amount,
        invoice_payload: payload.to_owned(),
        charge: ChargeId(charge.to_owned()),
        provider_charge: String::new(),
    }
}

/// A payments row: (charge, payload, user_id, amount, currency, provider charge, paid_at, refunded_at).
type PaymentRow = (String, String, i64, i64, String, String, i64, Option<i64>);

/// The payments row of `charge`, read outside the app pool.
async fn payment_row(st: &AppState, charge: &str) -> Option<PaymentRow> {
    let mut conn = common::raw_db(st).await;
    let row = sqlx::query_as(
        "SELECT telegram_payment_charge_id, invoice_payload, user_id, amount, currency, \
         provider_payment_charge_id, paid_at, refunded_at FROM payments WHERE telegram_payment_charge_id = $1",
    )
    .bind(charge)
    .fetch_optional(&mut conn)
    .await
    .unwrap();
    conn.close().await.unwrap();
    row
}

/// An entitlements row: (user_id, product_id, charge_id, granted_at).
type EntitlementRow = (i64, String, String, i64);

/// Every entitlements row, by user and product.
async fn entitlement_rows(st: &AppState) -> Vec<EntitlementRow> {
    let mut conn = common::raw_db(st).await;
    let rows = sqlx::query_as(
        "SELECT user_id, product_id, charge_id, granted_at FROM entitlements ORDER BY user_id, product_id",
    )
    .fetch_all(&mut conn)
    .await
    .unwrap();
    conn.close().await.unwrap();
    rows
}

/// The (status, charge_id, paid_at) of order `order`.
async fn paid_state(st: &AppState, order: &str) -> (String, Option<String>, Option<i64>) {
    let mut conn = common::raw_db(st).await;
    let row = sqlx::query_as("SELECT status, charge_id, paid_at FROM orders WHERE id = $1")
        .bind(order)
        .fetch_one(&mut conn)
        .await
        .unwrap();
    conn.close().await.unwrap();
    row
}

/// The mismatch of the grant of `fact` against `Ok(want)`.
async fn expect_grant(
    st: &AppState,
    case: &str,
    fact: &PaymentFact,
    want: GrantOutcome,
) -> Option<String> {
    let outcome = on_successful_payment(st, fact).await;
    (outcome.as_ref().ok() != Some(&want))
        .then(|| format!("{case}: expected Ok({want:?}), got {outcome:?}"))
}

/// P5 then P6 through the webhook: an accepted pre-checkout, then the payment, received at `T0 + 10` in a message
/// dated `T0`. One payment row with every field as received and the server's receipt time, the order `paid` with the
/// charge, the entitlement; the API shows the product owned and the order paid. The same update again is 200 and
/// changes nothing.
#[tokio::test]
async fn successful_payment_grants_once() {
    let mut failures = Vec::new();
    let (st, _db, gateway, Some((order, amount))) = order_for_ann(Some("ru"), &mut failures).await
    else {
        return report(&failures);
    };
    let update = pre_checkout_update("q-1", ANN, Some("ru"), "XTR", amount, &order);
    let got = answered(&st, &gateway, &update).await;
    failures.extend(expect_answer("pre-checkout", &got, &Ok(())));
    let paying = at(&st, T0 + 10);
    let payment = payment_update(ANN, "XTR", amount, &order, "charge-1", "prov-1");
    for delivery in ["the first delivery", "the redelivery"] {
        let reply = post_update(&paying, &payment).await;
        if reply.status.as_u16() != 200 {
            failures.push(format!(
                "{delivery}: expected 200, got {}",
                reply.status.as_u16()
            ));
        }
    }
    let payments = payment_rows(&st).await;
    let row = payment_row(&st, "charge-1").await;
    let want = (
        "charge-1".to_owned(),
        order.clone(),
        ANN,
        i64::from(amount),
        "XTR".to_owned(),
        "prov-1".to_owned(),
        T0 + 10,
        None,
    );
    if payments != 1 || row.as_ref() != Some(&want) {
        failures.push(format!(
            "payments: expected the one row {want:?}, got {payments} rows, charge-1: {row:?}"
        ));
    }
    let state = paid_state(&st, &order).await;
    if state
        != (
            "paid".to_owned(),
            Some("charge-1".to_owned()),
            Some(T0 + 10),
        )
    {
        failures.push(format!(
            "order: expected (paid, charge-1, {}), got {state:?}",
            T0 + 10
        ));
    }
    let entitlements = entitlement_rows(&st).await;
    let want = vec![(
        ANN,
        "chapter:ch2".to_owned(),
        "charge-1".to_owned(),
        T0 + 10,
    )];
    if entitlements != want {
        failures.push(format!(
            "entitlements: expected {want:?}, got {entitlements:?}"
        ));
    }
    let owned = owned(&st, ANN, "chapter:ch2").await;
    if owned != Some(true) {
        failures.push(format!(
            "GET /api/entitlements chapter:ch2 owned: expected Some(true), got {owned:?}"
        ));
    }
    let reply = get_order(&st, Some(ANN), &order).await;
    failures.extend(expect_order("GET /api/orders", &reply, &order, "paid"));
    report(&failures);
}

/// RULINGS 14, two deliveries of one charge at once: A (raw) holds the three grant statements of charge X
/// uncommitted; B's grant of X waits on A's uncommitted `payments_pkey` key, then skips it: `Duplicate`, not an
/// error. One payment, one entitlement, the order paid with X.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn successful_payment_duplicate_concurrent() {
    let mut failures = Vec::new();
    let (st, _db, _gateway, Some((order, amount))) = order_for_ann(Some("ru"), &mut failures).await
    else {
        return report(&failures);
    };
    let mut a = common::raw_db(&st).await;
    sqlx::raw_sql("BEGIN ISOLATION LEVEL READ COMMITTED")
        .execute(&mut a)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO payments (telegram_payment_charge_id, invoice_payload, user_id, amount, currency, \
         provider_payment_charge_id, paid_at) VALUES ('charge-x', $1, $2, $3, 'XTR', '', $4)",
    )
    .bind(&order)
    .bind(ANN)
    .bind(i64::from(amount))
    .bind(T0)
    .execute(&mut a)
    .await
    .unwrap();
    sqlx::query(
        "UPDATE orders SET status = 'paid', paid_at = $2, charge_id = 'charge-x' WHERE id = $1",
    )
    .bind(&order)
    .bind(T0)
    .execute(&mut a)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO entitlements (user_id, product_id, charge_id, granted_at) \
         VALUES ($1, 'chapter:ch2', 'charge-x', $2)",
    )
    .bind(ANN)
    .bind(T0)
    .execute(&mut a)
    .await
    .unwrap();
    let app = st.clone();
    let twin = fact(ANN, "XTR", amount, &order, "charge-x");
    let mut b = tokio::spawn(async move { on_successful_payment(&app, &twin).await });
    let early = tokio::select! {
        biased;
        outcome = &mut b => Some(outcome.unwrap()),
        () = common::wait_for_lock_waiter(&st) => None,
    };
    if early.is_some() {
        failures.push("B never waited: it finished while A held its transaction open".to_owned());
    }
    sqlx::raw_sql("COMMIT").execute(&mut a).await.unwrap();
    a.close().await.unwrap();
    let outcome = match early {
        Some(outcome) => outcome,
        None => b.await.unwrap(),
    };
    if !matches!(outcome, Ok(GrantOutcome::Duplicate)) {
        failures.push(format!("B: expected Ok(Duplicate), got {outcome:?}"));
    }
    let counts = (
        payment_rows(&st).await,
        rows(&st, "SELECT count(*) FROM entitlements").await,
    );
    if counts != (1, 1) {
        failures.push(format!(
            "payments / entitlements rows: expected 1 / 1, got {} / {}",
            counts.0, counts.1
        ));
    }
    let state = paid_state(&st, &order).await;
    if state != ("paid".to_owned(), Some("charge-x".to_owned()), Some(T0)) {
        failures.push(format!(
            "order: expected (paid, charge-x, {T0}), got {state:?}"
        ));
    }
    report(&failures);
}

/// A payment whose payload names no order is recorded and grants nothing (K19 "never lose money facts"): a
/// grammar-valid unknown id and a junk payload, each 200 through the webhook with its row; the grant's outcome for
/// such a payload is `OrderMismatch`.
#[tokio::test]
async fn successful_payment_unknown_order_recorded_no_grant() {
    let (st, _db, _gateway) = invoice_state(&[(ANN, Some("ru"))]).await;
    let mut failures = Vec::new();
    for (case, payload) in [
        ("an unknown order", "o_00000000000000000000000000000000"),
        ("a junk payload", "junk"),
    ] {
        let charge = format!("charge {case}");
        let reply = post_update(&st, &payment_update(ANN, "XTR", 1, payload, &charge, "")).await;
        if reply.status.as_u16() != 200 {
            failures.push(format!(
                "{case}: expected 200, got {}",
                reply.status.as_u16()
            ));
        }
        if payment_row(&st, &charge).await.is_none() {
            failures.push(format!("{case}: expected the payment recorded, got no row"));
        }
        let charge = format!("direct {case}");
        let outcome = on_successful_payment(&st, &fact(ANN, "XTR", 1, payload, &charge)).await;
        if !matches!(outcome, Ok(GrantOutcome::OrderMismatch)) {
            failures.push(format!(
                "{case}: expected Ok(OrderMismatch), got {outcome:?}"
            ));
        }
    }
    let entitlements = entitlement_rows(&st).await;
    if !entitlements.is_empty() {
        failures.push(format!("entitlements: expected none, got {entitlements:?}"));
    }
    report(&failures);
}

/// Every payment that cannot be applied is still recorded, and grants nothing it should not: a currency other than
/// `XTR`, another amount, another payer's order and a second charge for a paid order are `OrderMismatch`; an order
/// whose product id no product grammar knows is `UnknownProduct` (the order paid, no entitlement); an order for a
/// product the payer already owns is `AlreadyEntitled`.
#[tokio::test]
async fn successful_payment_unapplied_recorded_no_grant() {
    let (st, _db, _gateway) =
        invoice_state(&[(ANN, Some("ru")), (BEN, Some("en")), (CAT, Some("ru"))]).await;
    let mut failures = Vec::new();
    let Some((order, amount)) = new_order(&st, ANN, &mut failures).await else {
        return report(&failures);
    };
    for (case, fact, want) in [
        (
            "currency USD",
            fact(ANN, "USD", amount, &order, "c-usd"),
            GrantOutcome::OrderMismatch,
        ),
        (
            "amount + 1",
            fact(ANN, "XTR", amount + 1, &order, "c-amount"),
            GrantOutcome::OrderMismatch,
        ),
        (
            "another payer's order",
            fact(BEN, "XTR", amount, &order, "c-ben"),
            GrantOutcome::OrderMismatch,
        ),
        (
            "the order's own payment",
            fact(ANN, "XTR", amount, &order, "c-paid"),
            GrantOutcome::Granted,
        ),
        (
            "a second charge for the paid order",
            fact(ANN, "XTR", amount, &order, "c-second"),
            GrantOutcome::OrderMismatch,
        ),
    ] {
        failures.extend(expect_grant(&st, case, &fact, want).await);
    }

    // A product id outside every product grammar (neither `chapter:` nor `pack:`), set behind the API's back.
    let Some((retired, retired_amount)) = new_order(&st, BEN, &mut failures).await else {
        return report(&failures);
    };
    let mut conn = common::raw_db(&st).await;
    sqlx::query("UPDATE orders SET product_id = 'retired:hint_s' WHERE id = $1")
        .bind(&retired)
        .execute(&mut conn)
        .await
        .unwrap();
    conn.close().await.unwrap();
    failures.extend(
        expect_grant(
            &st,
            "an unknown product",
            &fact(BEN, "XTR", retired_amount, &retired, "c-retired"),
            GrantOutcome::UnknownProduct,
        )
        .await,
    );

    let Some((owned_order, owned_amount)) = new_order(&st, CAT, &mut failures).await else {
        return report(&failures);
    };
    own(&st, CAT, "chapter:ch2").await;
    failures.extend(
        expect_grant(
            &st,
            "an owned product",
            &fact(CAT, "XTR", owned_amount, &owned_order, "c-owned"),
            GrantOutcome::AlreadyEntitled,
        )
        .await,
    );

    let charges = [
        "c-usd",
        "c-amount",
        "c-ben",
        "c-paid",
        "c-second",
        "c-retired",
        "c-owned",
    ];
    for charge in charges {
        if payment_row(&st, charge).await.is_none() {
            failures.push(format!(
                "{charge}: expected the payment recorded, got no row"
            ));
        }
    }
    for (case, id, want) in [
        ("ANN's order", &order, ("paid", Some("c-paid"))),
        (
            "the unknown product's order",
            &retired,
            ("paid", Some("c-retired")),
        ),
        (
            "the owned product's order",
            &owned_order,
            ("paid", Some("c-owned")),
        ),
    ] {
        let (status, charge, _) = paid_state(&st, id).await;
        if (status.as_str(), charge.as_deref()) != want {
            failures.push(format!(
                "{case}: expected {want:?}, got ({status}, {charge:?})"
            ));
        }
    }
    let entitlements = entitlement_rows(&st).await;
    let want = vec![
        (ANN, "chapter:ch2".to_owned(), "c-paid".to_owned(), T0),
        (
            CAT,
            "chapter:ch2".to_owned(),
            format!("charge-{CAT}-chapter:ch2"),
            T0,
        ),
    ];
    if entitlements != want {
        failures.push(format!(
            "entitlements: expected {want:?}, got {entitlements:?}"
        ));
    }
    report(&failures);
}

/// U+0000 in the charge id, the payload and the provider id (PostgreSQL `text` cannot hold it) is stored as U+FFFD:
/// 200 and one row; the same update again is 200 and still one row (the replaced charge id is the same key).
#[tokio::test]
async fn successful_payment_nul_in_strings_recorded_replaced() {
    let mut failures = Vec::new();
    let (st, _db, _gateway, Some((order, amount))) = order_for_ann(Some("ru"), &mut failures).await
    else {
        return report(&failures);
    };
    let payload = format!("{order}\u{0}");
    let update = payment_update(ANN, "XTR", amount, &payload, "charge\u{0}1", "prov\u{0}1");
    for delivery in ["the first delivery", "the redelivery"] {
        let reply = post_update(&st, &update).await;
        if reply.status.as_u16() != 200 {
            failures.push(format!(
                "{delivery}: expected 200, got {}",
                reply.status.as_u16()
            ));
        }
    }
    let payments = payment_rows(&st).await;
    let row = payment_row(&st, "charge\u{FFFD}1").await;
    let want = (
        "charge\u{FFFD}1".to_owned(),
        format!("{order}\u{FFFD}"),
        ANN,
        i64::from(amount),
        "XTR".to_owned(),
        "prov\u{FFFD}1".to_owned(),
        T0,
        None,
    );
    if payments != 1 || row.as_ref() != Some(&want) {
        failures.push(format!(
            "payments: expected the one row {want:?}, got {payments} rows, the replaced charge: {row:?}"
        ));
    }
    failures.extend(expect_status("the payload with U+0000", &st, &order, "created").await);
    report(&failures);
}
