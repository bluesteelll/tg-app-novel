//! `POST /api/invoices`: Stars invoices priced and titled from the catalog, the order committed before the gateway
//! call, and a recent order with a link handed out again. `GET /api/orders/{orderId}`: the status of the user's own
//! order, read from its row.
//!
//! [`RecordingGateway`] is this crate's Bot API fake: every state here installs it through `with_gateway`, so no test
//! reaches the production gateway (whose placeholder token would answer `Disabled`, a 502, anyway). It records all
//! five gateway methods for the later payment, refund, bot, pack and share tests that import it from here.

use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

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
use server::telegram::gateway::{
    BotGateway, BoxFut, CommandSet, GatewayError, InvoiceSpec, OutMessage, SetupSpec, WebAppButton,
};
use sqlx::{Connection, PgConnection};

use crate::catalog::{ANN, T0, own};
use crate::common;

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
/// subtag), English for anything else and for no tag.
#[tokio::test]
async fn invoice_title_in_user_language() {
    let users: [(i64, Option<&str>, bool); 7] = [
        (2001, Some("ru"), true),
        (2002, Some("uk"), true),
        (2003, Some("be"), true),
        (2004, Some("kk-KZ"), true),
        (2005, Some("en"), false),
        (2006, Some("de"), false),
        (2007, None, false),
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
