//! Gifts between friends (META-PLAN M22). `Repo::transfer` on raw seeds: one transaction moves both sides, both
//! `users` rows are locked in id order, the caps are counted after the locks, and a request id moves a gift once.
//!
//! Balances are seeded through the primitives (a `referral_invitee` credit; a debt is a clawback of a raw payment),
//! never by raw balance rows, so every test keeps `balance - debt = SUM(amount)` per (user, kind) (the
//! `it/economy.rs` rule). Friendships are raw rows.

use std::fmt::Debug;

use server::AppState;
use server::catalog::{GiftRules, ResourceKind};
use server::db::economy::{Entry, GiftMove, GiftOutcome, Reason, clawback_in_tx, credit_in_tx};
use server::ids::UserId;
use sqlx::{Connection, PgConnection};

use crate::catalog::{ANN, T0, state_with_users};
use crate::common;
use crate::economy::wait_for_waiters;

/// A second player.
const BEN: i64 = 1002;

/// A third player.
const CAT: i64 = 1003;

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
