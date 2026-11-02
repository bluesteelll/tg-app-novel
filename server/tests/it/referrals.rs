//! The referral grant (META-PLAN M23, MT12). `Repo::qualify_referral` on raw rows: the invitee's evidence is re-read
//! from `stat_events` by the server's own receipt times, both sides are credited once, and the inviter's daily and
//! total caps are counted after the locks.
//!
//! Referral rows and statistics are raw rows (`cards::stat` stamps `received_at`); balances start empty, so every
//! test keeps `balance - debt = SUM(amount)` per (user, kind).

use std::fmt::Debug;

use server::AppState;
use server::catalog::{ReferralRules, ResourceKind};
use server::db::social::ReferralOutcome;
use server::ids::UserId;
use sqlx::{Connection, PgConnection};

use crate::cards::stat;
use crate::catalog::{ANN, T0, state_with_users};
use crate::common;
use crate::economy::wait_for_waiters;

/// The first invitee of these tests; the n-th is `INVITEE + n - 1`.
const INVITEE: i64 = 2001;

/// The first chapter of each fixture story (`stories.json`): what the server passes from its index.
const FIRSTS: [(&str, &str); 2] = [("manor", "ch1"), ("tide", "ch3")];

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

/// The referral rules of these tests: the owner's defaults (5 to the inviter, 2 to the invitee, 120 s, 3 a day, 20 in
/// total), with the caps `per_day` and `total`.
fn rules(per_day: u32, total: u32) -> ReferralRules {
    ReferralRules {
        kind: ResourceKind("hint".to_owned()),
        inviter: 5,
        invitee: 2,
        min_play_secs: 120,
        cap_per_day: per_day,
        cap_total: total,
    }
}

/// A state at `T0` with Ann and the invitees `INVITEE` to `INVITEE + n - 1`.
async fn state_with_invitees(n: i64) -> (AppState, common::TestDb) {
    let users: Vec<i64> = [ANN]
        .into_iter()
        .chain((0..n).map(|i| INVITEE + i))
        .collect();
    state_with_users(&users).await
}

/// `invitee`'s referral to `inviter`, attributed at `T0` and not qualified: a raw row.
async fn refer(st: &AppState, invitee: i64, inviter: i64) {
    let mut c = common::raw_db(st).await;
    sqlx::query(
        "INSERT INTO referrals (invitee_id, inviter_id, attributed_at) VALUES ($1, $2, $3)",
    )
    .bind(invitee)
    .bind(inviter)
    .bind(T0)
    .execute(&mut c)
    .await
    .unwrap();
    c.close().await.unwrap();
}

/// `user` started ch1 at `T0` and completed it at `T0 + 10`, as the server received them.
async fn played_ch1(st: &AppState, user: i64) {
    stat(st, user, 1, "chapter_started", "ch1", None, T0).await;
    stat(st, user, 2, "chapter_completed", "ch1", None, T0 + 10).await;
}

/// Qualifies `invitee`'s referral at `now` under `rules` with the fixture's first chapters; an error as its text.
async fn qualify(
    st: &AppState,
    invitee: i64,
    rules: &ReferralRules,
    now: i64,
) -> Result<ReferralOutcome, String> {
    st.repo
        .qualify_referral(UserId(invitee), &FIRSTS, rules, now)
        .await
        .map_err(|e| e.to_string())
}

/// A referral ledger row as (user, amount, reason, key, counterpart).
type RefRow = (i64, i64, String, String, Option<i64>);

/// Every `referral_inviter` / `referral_invitee` ledger row, in insertion order.
async fn ref_rows(st: &AppState) -> Vec<RefRow> {
    let mut c = common::raw_db(st).await;
    let rows = sqlx::query_as(
        "SELECT user_id, amount, reason, idem_key, counterpart_id FROM resource_ledger \
         WHERE reason IN ('referral_inviter', 'referral_invitee') ORDER BY id",
    )
    .fetch_all(&mut c)
    .await
    .unwrap();
    c.close().await.unwrap();
    rows
}

/// `invitee`'s referral row as (qualified_at, outcome).
async fn referral_of(st: &AppState, invitee: i64) -> (Option<i64>, Option<String>) {
    let mut c = common::raw_db(st).await;
    let row = sqlx::query_as("SELECT qualified_at, outcome FROM referrals WHERE invitee_id = $1")
        .bind(invitee)
        .fetch_one(&mut c)
        .await
        .unwrap();
    c.close().await.unwrap();
    row
}

/// `user`'s `hint` balance, 0 without a row.
async fn hints(st: &AppState, user: i64) -> i64 {
    let mut c = common::raw_db(st).await;
    let balance: Option<i64> = sqlx::query_scalar(
        "SELECT balance FROM resource_balances WHERE user_id = $1 AND kind = 'hint'",
    )
    .bind(user)
    .fetch_optional(&mut c)
    .await
    .unwrap();
    c.close().await.unwrap();
    balance.unwrap_or(0)
}

/// `n` invitees of Ann, each with a referral and a ch1 start and completion, qualified in turn at `at(i)` (i from 0)
/// under `rules`: the outcomes.
async fn qualify_each(
    st: &AppState,
    first: i64,
    n: i64,
    rules: &ReferralRules,
    at: impl Fn(i64) -> i64,
) -> Vec<Result<ReferralOutcome, String>> {
    let mut outcomes = Vec::new();
    for i in 0..n {
        let invitee = first + i;
        refer(st, invitee, ANN).await;
        played_ch1(st, invitee).await;
        outcomes.push(qualify(st, invitee, rules, at(i)).await);
    }
    outcomes
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

/// A referral grants both sides once (M23), on the server's own receipt times: the invitee's ch1 start at `T0` and
/// completion at `T0 + 10`, then a qualification at `T0 + 120` (the start is `minPlaySecs` old) → `Granted`. The
/// ledger holds exactly `ref:<invitee>:inviter` (+5 to Ann, naming the invitee) and `ref:<invitee>:invitee` (+2,
/// naming Ann), and the row is qualified at `T0 + 120` as `granted`. Again → `NotEligible`, nothing new.
#[tokio::test]
async fn referral_grants_both_once() {
    let (st, _db) = state_with_invitees(1).await;
    refer(&st, INVITEE, ANN).await;
    played_ch1(&st, INVITEE).await;
    let mut failures = Vec::new();
    failures.extend(expect_eq(
        "at T0 + 120",
        qualify(&st, INVITEE, &rules(3, 20), T0 + 120).await,
        Ok(ReferralOutcome::Granted),
    ));
    failures.extend(expect_eq(
        "the referral rows",
        ref_rows(&st).await,
        vec![
            (
                ANN,
                5,
                "referral_inviter".to_owned(),
                format!("ref:{INVITEE}:inviter"),
                Some(INVITEE),
            ),
            (
                INVITEE,
                2,
                "referral_invitee".to_owned(),
                format!("ref:{INVITEE}:invitee"),
                Some(ANN),
            ),
        ],
    ));
    failures.extend(expect_eq(
        "the referral row",
        referral_of(&st, INVITEE).await,
        (Some(T0 + 120), Some("granted".to_owned())),
    ));
    failures.extend(expect_eq(
        "again at T0 + 130",
        qualify(&st, INVITEE, &rules(3, 20), T0 + 130).await,
        Ok(ReferralOutcome::NotEligible),
    ));
    failures.extend(expect_eq(
        "Ann, the invitee, referral rows",
        (
            hints(&st, ANN).await,
            hints(&st, INVITEE).await,
            ref_rows(&st).await.len(),
        ),
        (5, 2, 2),
    ));
    report(&failures);
}

/// The inviter's daily cap (3 granted bonuses a rolling day, counted after the locks): three invitees of Ann qualify
/// in the day → `Granted` each; the fourth → `Capped`, the invitee's 2 still credited, Ann's 5 not, the row `capped`.
/// A fifth after the first grant left the window → `Granted`.
#[tokio::test]
async fn referral_cap_per_inviter_day() {
    let (st, _db) = state_with_invitees(5).await;
    let rules = rules(3, 20);
    let mut failures = Vec::new();
    use ReferralOutcome::{Capped, Granted};
    failures.extend(expect_eq(
        "four in the day",
        qualify_each(&st, INVITEE, 4, &rules, |i| T0 + 120 + i).await,
        vec![Ok(Granted), Ok(Granted), Ok(Granted), Ok(Capped)],
    ));
    let fourth = INVITEE + 3;
    failures.extend(expect_eq(
        "after the fourth: Ann, the fourth, its row",
        (
            hints(&st, ANN).await,
            hints(&st, fourth).await,
            referral_of(&st, fourth).await,
        ),
        (15, 2, (Some(T0 + 123), Some("capped".to_owned()))),
    ));
    failures.extend(expect_eq(
        "a fifth once the first grant left the window",
        qualify_each(&st, INVITEE + 4, 1, &rules, |_| T0 + 86_400 + 120).await,
        vec![Ok(Granted)],
    ));
    failures.extend(expect_eq(
        "Ann, referral rows",
        (hints(&st, ANN).await, ref_rows(&st).await.len()),
        (20, 9),
    ));
    report(&failures);
}

/// The inviter's total cap counts every granted bonus (rules: 3 a day, 4 in total, so the two caps separate): three
/// grants on day 0 and one on day 1 reach the total, and a fifth invitee on day 2 is `Capped` in a fresh day.
#[tokio::test]
async fn referral_cap_total() {
    let (st, _db) = state_with_invitees(5).await;
    let rules = rules(3, 4);
    let mut failures = Vec::new();
    use ReferralOutcome::{Capped, Granted};
    let day = |d: i64| T0 + d * 86_400;
    failures.extend(expect_eq(
        "three on day 0, one on day 1, one on day 2",
        qualify_each(&st, INVITEE, 5, &rules, |i| match i {
            0..=2 => day(0) + 120 + i,
            3 => day(1) + 200,
            _ => day(2) + 300,
        })
        .await,
        vec![
            Ok(Granted),
            Ok(Granted),
            Ok(Granted),
            Ok(Granted),
            Ok(Capped),
        ],
    ));
    let fifth = INVITEE + 4;
    failures.extend(expect_eq(
        "Ann, the fifth, its row",
        (
            hints(&st, ANN).await,
            hints(&st, fifth).await,
            referral_of(&st, fifth).await,
        ),
        (20, 2, (Some(day(2) + 300), Some("capped".to_owned()))),
    ));
    report(&failures);
}

/// Two batches of one invitee qualifying at once grant once (META-PLAN "Concurrency and failure model"): a stand-in
/// holds the invitee's `users` row, both qualifications queue behind it, and it commits. The guarded `UPDATE …
/// qualified_at IS NULL` lets exactly one grant; the other finds the row qualified (`AlreadyQualified`). Two ledger
/// rows.
#[tokio::test]
async fn referral_concurrent_batches_grant_once() {
    let (st, _db) = state_with_invitees(1).await;
    refer(&st, INVITEE, ANN).await;
    played_ch1(&st, INVITEE).await;
    let mut stand_in = common::raw_db(&st).await;
    begin(&mut stand_in).await;
    sqlx::query("SELECT 1 FROM users WHERE id = $1 FOR UPDATE")
        .bind(INVITEE)
        .execute(&mut stand_in)
        .await
        .unwrap();
    let spawn = || {
        let st = st.clone();
        tokio::spawn(async move { qualify(&st, INVITEE, &rules(3, 20), T0 + 120).await })
    };
    let (a, b) = (spawn(), spawn());
    wait_for_waiters(&st, 2).await;
    commit(&mut stand_in).await;
    stand_in.close().await.unwrap();
    let mut outcomes = [
        format!("{:?}", a.await.unwrap()),
        format!("{:?}", b.await.unwrap()),
    ];
    outcomes.sort();
    let mut failures = Vec::new();
    failures.extend(expect_eq(
        "the two outcomes, sorted",
        outcomes,
        [
            format!("{:?}", Ok::<_, String>(ReferralOutcome::AlreadyQualified)),
            format!("{:?}", Ok::<_, String>(ReferralOutcome::Granted)),
        ],
    ));
    failures.extend(expect_eq(
        "Ann, the invitee, referral rows",
        (
            hints(&st, ANN).await,
            hints(&st, INVITEE).await,
            ref_rows(&st).await.len(),
        ),
        (5, 2, 2),
    ));
    report(&failures);
}
