//! Gifts between friends (META-PLAN M22). `Repo::transfer` on raw seeds: one transaction moves both sides, both
//! `users` rows are locked in id order, the caps are counted after the locks, and a request id moves a gift once.
//! `POST /api/gifts` through the production router: a friend by handle only, the daily caps with `Retry-After`, the
//! 409, the replay and the malformed bodies, on the compiled-in catalog (3 units a gift, 3 sent and 5 received a day).
//!
//! Balances are seeded through the primitives (a `referral_invitee` credit; a debt is a clawback of a raw payment),
//! never by raw balance rows, so every test keeps `balance - debt = SUM(amount)` per (user, kind) (the
//! `it/economy.rs` rule). Friendships and handles are raw rows.

use std::fmt::Debug;
use std::sync::Arc;

use axum::body::Body;
use axum::http::Request;
use axum::http::header::{AUTHORIZATION, CACHE_CONTROL, CONTENT_TYPE, RETRY_AFTER};
use serde_json::{Value, json};
use server::AppState;
use server::catalog::{GiftRules, ResourceKind};
use server::clock::FixedClock;
use server::db::economy::{Entry, GiftMove, GiftOutcome, Reason, clawback_in_tx, credit_in_tx};
use server::ids::UserId;
use sqlx::{Connection, PgConnection};

use crate::catalog::{ANN, T0, state_with_users};
use crate::common;
use crate::economy::wait_for_waiters;
use crate::payments::bearer_now;
use crate::social::id_paths;

/// A second player.
const BEN: i64 = 1002;

/// A third player.
const CAT: i64 = 1003;

/// A fourth player.
const DAN: i64 = 1004;

fn report(failures: &[String]) {
    assert!(
        failures.is_empty(),
        "{} failures:\n{}",
        failures.len(),
        failures.join("\n")
    );
}

fn expect_eq<T: PartialEq + Debug>(case: &str, got: T, want: T) -> Option<String> {
    (got != want).then(|| format!("{case}: expected {want:?}, got {got:?}"))
}

fn hint() -> ResourceKind {
    ResourceKind("hint".to_owned())
}

/// The gift rules of the repository tests: the owner's defaults (3 units a gift, 3 sent and 5 received a day).
fn rules() -> GiftRules {
    GiftRules {
        kinds: vec![hint()],
        max_per_gift: 3,
        send_per_day: 3,
        receive_per_day: 5,
    }
}

/// The `n`-th lower-case UUID v4 of these tests.
fn uuid(n: u64) -> String {
    format!("{n:08x}-0000-4000-8000-{n:012x}")
}

/// Opens a READ COMMITTED transaction on a raw connection (its default is `repeatable read`).
async fn begin(c: &mut PgConnection) {
    sqlx::raw_sql("BEGIN ISOLATION LEVEL READ COMMITTED")
        .execute(&mut *c)
        .await
        .unwrap();
}

async fn commit(c: &mut PgConnection) {
    sqlx::raw_sql("COMMIT").execute(&mut *c).await.unwrap();
}

/// Credits `amount` hints to `user`: a `referral_invitee` row keyed `seed:<user>` (one seed per user and test).
async fn seed(st: &AppState, user: i64, amount: i64) {
    let kind = hint();
    let mut c = common::raw_db(st).await;
    begin(&mut c).await;
    credit_in_tx(
        &mut c,
        &Entry {
            user: UserId(user),
            kind: &kind,
            amount,
            reason: Reason::ReferralInvitee,
            idem_key: format!("seed:{user}"),
            charge_id: None,
            counterpart: None,
            r#ref: None,
            at: T0,
        },
    )
    .await
    .unwrap();
    commit(&mut c).await;
    c.close().await.unwrap();
}

/// Leaves `user` owing `amount` hints: a raw payment, then its `pack_refund` clawback on an empty balance.
async fn owe(st: &AppState, user: i64, amount: i64) {
    let kind = hint();
    let charge = format!("charge-{user}");
    let mut c = common::raw_db(st).await;
    sqlx::query(
        "INSERT INTO payments (telegram_payment_charge_id, invoice_payload, user_id, amount, currency, \
         provider_payment_charge_id, paid_at) VALUES ($1, 'payload', $2, 1, 'XTR', '', $3)",
    )
    .bind(&charge)
    .bind(user)
    .bind(T0)
    .execute(&mut c)
    .await
    .unwrap();
    begin(&mut c).await;
    clawback_in_tx(
        &mut c,
        &Entry {
            user: UserId(user),
            kind: &kind,
            amount: -amount,
            reason: Reason::PackRefund,
            idem_key: format!("refund:{charge}"),
            charge_id: Some(&charge),
            counterpart: None,
            r#ref: None,
            at: T0,
        },
    )
    .await
    .unwrap();
    commit(&mut c).await;
    c.close().await.unwrap();
}

/// Makes `a` and `b` friends: a raw `friendships` row, the lower id first.
async fn befriend(st: &AppState, a: i64, b: i64) {
    let mut c = common::raw_db(st).await;
    sqlx::query("INSERT INTO friendships (user_lo, user_hi, created_at) VALUES ($1, $2, $3)")
        .bind(a.min(b))
        .bind(a.max(b))
        .bind(T0)
        .execute(&mut c)
        .await
        .unwrap();
    c.close().await.unwrap();
}

/// `user`'s `hint` row as (balance, debt), `(0, 0)` without one; read outside the app pool.
async fn hint_of(st: &AppState, user: i64) -> (i64, i64) {
    let mut c = common::raw_db(st).await;
    let row: Option<(i64, i64)> = sqlx::query_as(
        "SELECT balance, debt FROM resource_balances WHERE user_id = $1 AND kind = 'hint'",
    )
    .bind(user)
    .fetch_optional(&mut c)
    .await
    .unwrap();
    c.close().await.unwrap();
    row.unwrap_or((0, 0))
}

/// A gift ledger row as (user, amount, reason, key, counterpart).
type GiftRow = (i64, i64, String, String, Option<i64>);

/// Every `gift_out` / `gift_in` ledger row, in insertion order.
async fn gift_rows(st: &AppState) -> Vec<GiftRow> {
    let mut c = common::raw_db(st).await;
    let rows = sqlx::query_as(
        "SELECT user_id, amount, reason, idem_key, counterpart_id FROM resource_ledger \
         WHERE reason IN ('gift_out', 'gift_in') ORDER BY id",
    )
    .fetch_all(&mut c)
    .await
    .unwrap();
    c.close().await.unwrap();
    rows
}

/// M18's invariant as failure lines: every (user, kind) whose ledger sum differs from `balance - debt`.
async fn unreconciled(st: &AppState) -> Vec<String> {
    let mut c = common::raw_db(st).await;
    let groups: Vec<(i64, String, i64, i64)> = sqlx::query_as(
        "SELECT l.user_id, l.kind, sum(l.amount)::bigint, COALESCE(b.balance - b.debt, 0) \
         FROM resource_ledger l LEFT JOIN resource_balances b ON b.user_id = l.user_id AND b.kind = l.kind \
         GROUP BY l.user_id, l.kind, b.balance, b.debt ORDER BY l.user_id, l.kind",
    )
    .fetch_all(&mut c)
    .await
    .unwrap();
    c.close().await.unwrap();
    groups
        .into_iter()
        .filter(|(_, _, sum, net)| sum != net)
        .map(|(user, kind, sum, net)| {
            format!("{user} {kind}: ledger sum {sum}, balance - debt {net}")
        })
        .collect()
}

/// `amount` hints from `from` to `to` under request `rid` at `now`, through the repository with [`rules`]; a database
/// error as its text.
async fn gift(
    st: &AppState,
    from: i64,
    to: i64,
    amount: u32,
    rid: &str,
    now: i64,
) -> Result<GiftOutcome, String> {
    let kind = hint();
    let g = GiftMove {
        from: UserId(from),
        to: UserId(to),
        kind: &kind,
        amount,
        request_id: rid,
    };
    st.repo
        .transfer(&g, &rules(), now)
        .await
        .map_err(|e| e.to_string())
}

/// [`gift`] on a task of its own, so two run at once.
fn spawn_gift(
    st: &AppState,
    from: i64,
    to: i64,
    amount: u32,
    rid: String,
) -> tokio::task::JoinHandle<Result<GiftOutcome, String>> {
    let st = st.clone();
    tokio::spawn(async move { gift(&st, from, to, amount, &rid, T0).await })
}

/// Locks the `users` rows of `users` `FOR UPDATE` in a READ COMMITTED transaction on `c`: a stand-in for another app
/// transaction, which the gifts then wait on.
async fn hold(c: &mut PgConnection, users: &[i64]) {
    begin(c).await;
    sqlx::query("SELECT id FROM users WHERE id = ANY($1) ORDER BY id FOR UPDATE")
        .bind(users)
        .execute(&mut *c)
        .await
        .unwrap();
}

/// A gift moves both sides in one transaction (M22): Ann (3 hints) gives Ben (owing 1) 2, so Ann keeps 1 and Ben's
/// credit pays his debt first (balance 1, debt 0); the ledger holds exactly the `…:out` and `…:in` rows, each naming
/// the other user, and reconciles. A gift the sender cannot cover (Cat has no hints) writes nothing.
#[tokio::test]
async fn gift_moves_once_and_reconciles() {
    let (st, _db) = state_with_users(&[ANN, BEN, CAT]).await;
    seed(&st, ANN, 3).await;
    owe(&st, BEN, 1).await;
    befriend(&st, ANN, BEN).await;
    befriend(&st, ANN, CAT).await;
    let mut failures = Vec::new();
    let rid = uuid(1);
    failures.extend(expect_eq(
        "Ann gives Ben 2",
        gift(&st, ANN, BEN, 2, &rid, T0).await,
        Ok(GiftOutcome::Sent { balance: 1 }),
    ));
    failures.extend(expect_eq(
        "Ann, Ben after: Ben's debt paid first",
        (hint_of(&st, ANN).await, hint_of(&st, BEN).await),
        ((1, 0), (1, 0)),
    ));
    let key = |side: &str| format!("gift:{ANN}:{rid}:{side}");
    failures.extend(expect_eq(
        "the gift rows",
        gift_rows(&st).await,
        vec![
            (ANN, -2, "gift_out".to_owned(), key("out"), Some(BEN)),
            (BEN, 2, "gift_in".to_owned(), key("in"), Some(ANN)),
        ],
    ));
    failures.extend(unreconciled(&st).await);
    let refused = gift(&st, CAT, ANN, 1, &uuid(2), T0).await;
    failures.extend(expect_eq(
        "an insufficient gift: (outcome, Ann)",
        (refused, hint_of(&st, ANN).await),
        (Ok(GiftOutcome::Insufficient), (1, 0)),
    ));
    failures.extend(expect_eq(
        "gift rows after the refusal",
        gift_rows(&st).await.len(),
        2,
    ));
    failures.extend(unreconciled(&st).await);
    report(&failures);
}

/// A request id moves its gift once (M22 step 3): the same gift twice is `Sent`, then `Replayed` with the same
/// balance; two gift rows, and neither wallet moves again.
#[tokio::test]
async fn gift_replay_moves_once() {
    let (st, _db) = state_with_users(&[ANN, BEN]).await;
    seed(&st, ANN, 5).await;
    befriend(&st, ANN, BEN).await;
    let mut failures = Vec::new();
    let rid = uuid(1);
    failures.extend(expect_eq(
        "the gift, then its replay",
        (
            gift(&st, ANN, BEN, 2, &rid, T0).await,
            gift(&st, ANN, BEN, 2, &rid, T0).await,
        ),
        (
            Ok(GiftOutcome::Sent { balance: 3 }),
            Ok(GiftOutcome::Replayed { balance: 3 }),
        ),
    ));
    failures.extend(expect_eq(
        "Ann, Ben",
        (hint_of(&st, ANN).await, hint_of(&st, BEN).await),
        ((3, 0), (2, 0)),
    ));
    failures.extend(expect_eq("gift rows", gift_rows(&st).await.len(), 2));
    failures.extend(unreconciled(&st).await);
    report(&failures);
}

/// Ann → Ben and Ben → Ann at once never deadlock (META-PLAN "Concurrency and failure model"): a stand-in holds both
/// `users` rows, both gifts queue behind it, and it commits. With both rows locked in ascending id by one statement,
/// both gifts wait on the lower row and then run one after the other; locks in request order would hand each gift
/// its first row at the commit and then deadlock (`40P01`).
#[tokio::test]
async fn gift_opposite_directions_no_deadlock() {
    let (st, _db) = state_with_users(&[ANN, BEN]).await;
    seed(&st, ANN, 3).await;
    seed(&st, BEN, 3).await;
    befriend(&st, ANN, BEN).await;
    let mut stand_in = common::raw_db(&st).await;
    hold(&mut stand_in, &[ANN, BEN]).await;
    let a = spawn_gift(&st, ANN, BEN, 1, uuid(1));
    let b = spawn_gift(&st, BEN, ANN, 1, uuid(2));
    wait_for_waiters(&st, 2).await;
    commit(&mut stand_in).await;
    stand_in.close().await.unwrap();
    let results = [a.await.unwrap(), b.await.unwrap()];
    let mut failures = Vec::new();
    if !results
        .iter()
        .all(|r| matches!(r, Ok(GiftOutcome::Sent { .. })))
    {
        failures.push(format!("both gifts: expected Sent twice, got {results:?}"));
    }
    failures.extend(expect_eq(
        "Ann, Ben after one hint each way",
        (hint_of(&st, ANN).await, hint_of(&st, BEN).await),
        ((3, 0), (3, 0)),
    ));
    failures.extend(expect_eq("gift rows", gift_rows(&st).await.len(), 4));
    failures.extend(unreconciled(&st).await);
    report(&failures);
}

/// Two gifts of one sender at once against the daily cap (3; each 2): the sender's `users` row serializes them and the
/// second counts the first, so exactly one is sent and the other is capped until the first leaves the window (both at
/// `T0`: 86 400 s). Ann keeps 2, and only the sent gift's two rows exist.
#[tokio::test]
async fn gift_concurrent_same_sender_respects_cap() {
    let (st, _db) = state_with_users(&[ANN, BEN, CAT]).await;
    seed(&st, ANN, 4).await;
    befriend(&st, ANN, BEN).await;
    befriend(&st, ANN, CAT).await;
    let mut stand_in = common::raw_db(&st).await;
    hold(&mut stand_in, &[ANN]).await;
    let to_ben = spawn_gift(&st, ANN, BEN, 2, uuid(1));
    let to_cat = spawn_gift(&st, ANN, CAT, 2, uuid(2));
    wait_for_waiters(&st, 2).await;
    commit(&mut stand_in).await;
    stand_in.close().await.unwrap();
    let mut outcomes = [
        format!("{:?}", to_ben.await.unwrap()),
        format!("{:?}", to_cat.await.unwrap()),
    ];
    outcomes.sort();
    let mut failures = Vec::new();
    failures.extend(expect_eq(
        "the two outcomes, sorted",
        outcomes,
        [
            format!(
                "{:?}",
                Ok::<_, String>(GiftOutcome::Capped {
                    retry_after_secs: 86_400
                })
            ),
            format!("{:?}", Ok::<_, String>(GiftOutcome::Sent { balance: 2 })),
        ],
    ));
    failures.extend(expect_eq("Ann", hint_of(&st, ANN).await, (2, 0)));
    failures.extend(expect_eq("gift rows", gift_rows(&st).await.len(), 2));
    failures.extend(unreconciled(&st).await);
    report(&failures);
}

/// `user`'s handle in these tests: the id as 24 lower-case hex digits.
fn handle_of(user: i64) -> String {
    format!("{user:024x}")
}

/// Gives `user` the handle [`handle_of`] spells: a raw `user_handles` row.
async fn give_handle(st: &AppState, user: i64) {
    let mut c = common::raw_db(st).await;
    sqlx::query("INSERT INTO user_handles (user_id, handle) VALUES ($1, $2)")
        .bind(user)
        .bind(handle_of(user))
        .execute(&mut c)
        .await
        .unwrap();
    c.close().await.unwrap();
}

/// `st` with its clock at `now`.
fn at(st: &AppState, now: i64) -> AppState {
    st.clone().with_clock(Arc::new(FixedClock(now)))
}

/// A gift body: `amount` hints to `to`'s handle under request `uuid(rid)`.
fn body(to: i64, amount: u32, rid: u64) -> Value {
    json!({ "to": handle_of(to), "kind": "hint", "amount": amount, "requestId": uuid(rid) })
}

/// `POST /api/gifts` with `body` as JSON, as `user` (a token from the state's clock) or without `Authorization`.
async fn post_gift(st: &AppState, user: Option<i64>, body: &Value) -> common::Reply {
    let mut req = Request::post("/api/gifts").header(CONTENT_TYPE, "application/json");
    if let Some(user) = user {
        req = req.header(AUTHORIZATION, bearer_now(st, user));
    }
    common::call(st, req.body(Body::from(body.to_string())).unwrap()).await
}

/// A reply as (status, body as JSON, `Retry-After`).
type Answer = (u16, Value, Option<String>);

fn answer(reply: &common::Reply) -> Answer {
    let body = serde_json::from_slice(&reply.body).unwrap_or(Value::Null);
    let retry = reply
        .headers
        .get(RETRY_AFTER)
        .map(|v| v.to_str().unwrap_or("<not text>").to_owned());
    (reply.status.as_u16(), body, retry)
}

/// A 200 with the sender's `balance`.
fn sent(balance: i64) -> Answer {
    (200, json!({ "balance": balance }), None)
}

/// A 4xx with the error code `code`.
fn refused(status: u16, code: &str) -> Answer {
    (status, json!({ "error": code }), None)
}

/// A 429 `rate_limited` with `Retry-After: secs`.
fn capped(secs: i64) -> Answer {
    (
        429,
        json!({ "error": "rate_limited" }),
        Some(secs.to_string()),
    )
}

/// A gift goes to a friend only, named by handle (M22, revision 1 W1): to a friend it is 200 with the sender's balance
/// only, `private, no-store`, and no user id at any depth; a user with a handle who is not a friend, an unknown handle
/// and one's own handle all answer the same 404 `not_found`, and so does a friend removed since (the friendship is
/// read under the locks). No refusal writes.
#[tokio::test]
async fn gift_requires_friendship() {
    let (st, _db) = state_with_users(&[ANN, BEN, CAT]).await;
    seed(&st, ANN, 3).await;
    befriend(&st, ANN, BEN).await;
    for user in [ANN, BEN, CAT] {
        give_handle(&st, user).await;
    }
    let mut failures = Vec::new();
    let reply = post_gift(&st, Some(ANN), &body(BEN, 2, 1)).await;
    let first = answer(&reply);
    let cache = reply
        .headers
        .get(CACHE_CONTROL)
        .map(|v| v.to_str().unwrap_or("<not text>"));
    failures.extend(expect_eq(
        "a friend: the answer, cache-control",
        (first.clone(), cache),
        (sent(1), Some("private, no-store")),
    ));
    let mut ids = Vec::new();
    for user in [ANN, BEN] {
        id_paths(&first.1, "$", user, &mut ids);
    }
    if !ids.is_empty() {
        failures.push(format!("a friend: user ids in the body at {ids:?}"));
    }
    for (case, to) in [
        ("a non-friend with a handle", handle_of(CAT)),
        ("an unknown handle", "ffffffffffffffffffffffff".to_owned()),
        ("one's own handle", handle_of(ANN)),
    ] {
        let gift = json!({ "to": to, "kind": "hint", "amount": 1, "requestId": uuid(2) });
        failures.extend(expect_eq(
            case,
            answer(&post_gift(&st, Some(ANN), &gift).await),
            refused(404, "not_found"),
        ));
    }
    let mut c = common::raw_db(&st).await;
    sqlx::query("DELETE FROM friendships WHERE user_lo = $1 AND user_hi = $2")
        .bind(ANN)
        .bind(BEN)
        .execute(&mut c)
        .await
        .unwrap();
    c.close().await.unwrap();
    failures.extend(expect_eq(
        "a friend removed since, a new request id",
        answer(&post_gift(&st, Some(ANN), &body(BEN, 1, 3)).await),
        refused(404, "not_found"),
    ));
    failures.extend(expect_eq(
        "after the refusals: Ann, Ben, Cat, gift rows",
        (
            hint_of(&st, ANN).await,
            hint_of(&st, BEN).await,
            hint_of(&st, CAT).await,
            gift_rows(&st).await.len(),
        ),
        ((1, 0), (2, 0), (0, 0), 2),
    ));
    failures.extend(unreconciled(&st).await);
    report(&failures);
}

/// The sender's daily cap counts units in a rolling 24 h (M22 step 4; 3 a day). Ann gives Ben 3; Cat's 1 is then 429
/// `rate_limited` until Ben's gift leaves the window (`Retry-After: 86400`), and so is the same gift from a request
/// whose clock read is a second before Ben's gift was stamped (critique W1: a committed gift counts whatever its
/// stamp, `86401`). One second before the window ends it is 429 with `Retry-After: 1`; at its end the gift passes.
/// Then 2 and 1 reach exactly 3 and pass, and one unit more is 429. No 429 writes.
#[tokio::test]
async fn gift_daily_send_cap_429() {
    let (st, _db) = state_with_users(&[ANN, BEN, CAT]).await;
    seed(&st, ANN, 10).await;
    for friend in [BEN, CAT] {
        befriend(&st, ANN, friend).await;
        give_handle(&st, friend).await;
    }
    let mut failures = Vec::new();
    let steps = [
        ("Ann gives Ben 3", T0, BEN, 3, 1, sent(7)),
        ("then Cat 1", T0, CAT, 1, 2, capped(86_400)),
        (
            "Cat 1 from a clock read a second before Ben's gift",
            T0 - 1,
            CAT,
            1,
            3,
            capped(86_401),
        ),
        ("Cat 1 at T0 + 86 399", T0 + 86_399, CAT, 1, 4, capped(1)),
        (
            "Cat 2 at T0 + 86 400: Ben's gift left the window",
            T0 + 86_400,
            CAT,
            2,
            5,
            sent(5),
        ),
        ("then Ben 1: exactly 3", T0 + 86_400, BEN, 1, 6, sent(4)),
        (
            "then Cat 1: one unit more",
            T0 + 86_400,
            CAT,
            1,
            7,
            capped(86_400),
        ),
    ];
    for (case, now, to, amount, rid, want) in steps {
        let st = at(&st, now);
        failures.extend(expect_eq(
            case,
            answer(&post_gift(&st, Some(ANN), &body(to, amount, rid)).await),
            want,
        ));
    }
    failures.extend(expect_eq(
        "Ann, Ben, Cat, gift rows",
        (
            hint_of(&st, ANN).await,
            hint_of(&st, BEN).await,
            hint_of(&st, CAT).await,
            gift_rows(&st).await.len(),
        ),
        ((4, 0), (4, 0), (2, 0), 6),
    ));
    failures.extend(unreconciled(&st).await);
    report(&failures);
}

/// The recipient's daily cap (5 units a rolling day) counts what every friend gave (M22 step 4: a farm of senders
/// funnels at most 5 a day into one account). Ann gives Dan 3 at `T0` and Ben 2 at `T0 + 100`, exactly 5, and both
/// pass; Cat's 1 at `T0 + 200` is 429 until Ann's gift leaves the window (`Retry-After: 86200`), and so is Cat's 1 from
/// a request that read the clock 10 s before Ann's gift was stamped (W1, `86410`). At `T0 + 86 400` Ann's gift has
/// left and Cat's passes.
#[tokio::test]
async fn gift_daily_receive_cap_429() {
    let (st, _db) = state_with_users(&[ANN, BEN, CAT, DAN]).await;
    seed(&st, ANN, 3).await;
    seed(&st, BEN, 2).await;
    seed(&st, CAT, 1).await;
    for sender in [ANN, BEN, CAT] {
        befriend(&st, sender, DAN).await;
    }
    give_handle(&st, DAN).await;
    let mut failures = Vec::new();
    let steps = [
        ("Ann gives Dan 3", ANN, T0, 3, 1, sent(0)),
        ("Ben gives Dan 2: exactly 5", BEN, T0 + 100, 2, 2, sent(0)),
        (
            "Cat gives Dan 1: one unit more",
            CAT,
            T0 + 200,
            1,
            3,
            capped(86_200),
        ),
        (
            "Cat's 1 from a clock read 10 s before Ann's gift",
            CAT,
            T0 - 10,
            1,
            4,
            capped(86_410),
        ),
        (
            "Cat's 1 at T0 + 86 400: Ann's gift left the window",
            CAT,
            T0 + 86_400,
            1,
            5,
            sent(0),
        ),
    ];
    for (case, sender, now, amount, rid, want) in steps {
        let st = at(&st, now);
        failures.extend(expect_eq(
            case,
            answer(&post_gift(&st, Some(sender), &body(DAN, amount, rid)).await),
            want,
        ));
    }
    failures.extend(expect_eq(
        "Dan, Cat, gift rows",
        (
            hint_of(&st, DAN).await,
            hint_of(&st, CAT).await,
            gift_rows(&st).await.len(),
        ),
        ((6, 0), (0, 0), 6),
    ));
    failures.extend(unreconciled(&st).await);
    report(&failures);
}

/// A gift the sender's balance does not cover is 409 `insufficient_balance` (M22 step 5) and writes nothing: Ann (1
/// hint) gives Ben 2.
#[tokio::test]
async fn gift_insufficient_409() {
    let (st, _db) = state_with_users(&[ANN, BEN]).await;
    seed(&st, ANN, 1).await;
    befriend(&st, ANN, BEN).await;
    give_handle(&st, BEN).await;
    let mut failures = Vec::new();
    failures.extend(expect_eq(
        "Ann gives Ben 2",
        answer(&post_gift(&st, Some(ANN), &body(BEN, 2, 1)).await),
        refused(409, "insufficient_balance"),
    ));
    failures.extend(expect_eq(
        "Ann, Ben, gift rows",
        (
            hint_of(&st, ANN).await,
            hint_of(&st, BEN).await,
            gift_rows(&st).await.len(),
        ),
        ((1, 0), (0, 0), 0),
    ));
    failures.extend(unreconciled(&st).await);
    report(&failures);
}

/// A request id names one gift (M22 step 3): after Ann gives Ben 2 under it, the same id with another amount, or with
/// another friend as the recipient, is 400 `bad_request`; the same body again is 200 with the same balance. The
/// wallets move once.
#[tokio::test]
async fn gift_replay_with_other_body_400() {
    let (st, _db) = state_with_users(&[ANN, BEN, CAT]).await;
    seed(&st, ANN, 3).await;
    for friend in [BEN, CAT] {
        befriend(&st, ANN, friend).await;
        give_handle(&st, friend).await;
    }
    let mut failures = Vec::new();
    let steps = [
        ("the gift", BEN, 2, sent(1)),
        ("the same id, amount 1", BEN, 1, refused(400, "bad_request")),
        ("the same id, to Cat", CAT, 2, refused(400, "bad_request")),
        ("the same body again", BEN, 2, sent(1)),
    ];
    for (case, to, amount, want) in steps {
        failures.extend(expect_eq(
            case,
            answer(&post_gift(&st, Some(ANN), &body(to, amount, 1)).await),
            want,
        ));
    }
    failures.extend(expect_eq(
        "Ann, Ben, Cat, gift rows",
        (
            hint_of(&st, ANN).await,
            hint_of(&st, BEN).await,
            hint_of(&st, CAT).await,
            gift_rows(&st).await.len(),
        ),
        ((1, 0), (2, 0), (0, 0), 2),
    ));
    failures.extend(unreconciled(&st).await);
    report(&failures);
}

/// Each malformed gift is 400 `bad_request` and writes nothing: `to` not 24 lower-case hex, a kind the catalog does
/// not give (`gem`), an amount of 0, -1 or above `maxPerGift` (4), a `requestId` in upper case or a UUID v1, a field
/// the body does not have (`from`: the sender is the token's user), a missing field. No token is 401 `token_missing`.
#[tokio::test]
async fn gift_shapes_400() {
    let (st, _db) = state_with_users(&[ANN, BEN]).await;
    seed(&st, ANN, 3).await;
    befriend(&st, ANN, BEN).await;
    give_handle(&st, BEN).await;
    let good = body(BEN, 1, 1);
    let with = |key: &str, value: Value| {
        let mut gift = good.clone();
        gift[key] = value;
        gift
    };
    let mut without_id = good.clone();
    if let Some(fields) = without_id.as_object_mut() {
        fields.remove("requestId");
    }
    let cases = [
        (
            "to in upper case",
            with("to", json!("00000000000000000000ABCD")),
        ),
        ("to of 23 digits", with("to", json!(&handle_of(BEN)[1..]))),
        ("kind gem", with("kind", json!("gem"))),
        ("amount 0", with("amount", json!(0))),
        ("amount -1", with("amount", json!(-1))),
        ("amount 4, above maxPerGift 3", with("amount", json!(4))),
        (
            "requestId in upper case",
            with("requestId", json!(uuid(0xabc).to_uppercase())),
        ),
        (
            "requestId a UUID v1",
            with("requestId", json!("00000001-0000-1000-8000-000000000001")),
        ),
        ("a field from", with("from", json!(handle_of(ANN)))),
        ("no requestId", without_id),
    ];
    let mut failures = Vec::new();
    for (case, gift) in &cases {
        failures.extend(expect_eq(
            case,
            answer(&post_gift(&st, Some(ANN), gift).await),
            refused(400, "bad_request"),
        ));
    }
    failures.extend(expect_eq(
        "no token",
        answer(&post_gift(&st, None, &good).await),
        refused(401, "token_missing"),
    ));
    failures.extend(expect_eq(
        "Ann, Ben, gift rows",
        (
            hint_of(&st, ANN).await,
            hint_of(&st, BEN).await,
            gift_rows(&st).await.len(),
        ),
        ((3, 0), (0, 0), 0),
    ));
    report(&failures);
}
