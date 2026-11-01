//! The social graph (META-PLAN M10-M12, M15; `0005_social.sql`): the schema's named constraints on raw SQL.
//!
//! Every refused schema case breaks one constraint, or one whose CHECK name sorts before every other it breaks:
//! PostgreSQL tests a table's CHECK constraints in name order, then the unique indexes, then the foreign keys at the
//! end of the statement, so the constraint a case reports is the one the case is about. Each refused case sits next to
//! a control on the same parent rows, so a red names the constraint, not a missing parent.
//!
//! User ids are at least 5 000 000 001, so no timestamp, count or code fragment of a test can equal one.

use std::sync::Arc;

use server::AppState;
use server::clock::FixedClock;
use server::ids::UserId;
use sqlx::PgConnection;
use sqlx::postgres::PgQueryResult;

use crate::catalog::T0;
use crate::common;

/// The first player: the lowest id, so every two-row lock takes ANN's row first.
const ANN: i64 = 5_000_000_001;
/// The second player.
const BEN: i64 = 5_000_000_002;
/// A user id below every player with no `users` row.
const NOBODY_LOW: i64 = 4_000_000_001;
/// A user id above every player with no `users` row.
const NOBODY_HIGH: i64 = 9_000_000_001;

/// A valid invite code (32 lower-case hex).
const CODE_A: &str = "0123456789abcdef0123456789abcdef";
/// A second valid invite code.
const CODE_B: &str = "fedcba9876543210fedcba9876543210";
/// A valid handle (24 lower-case hex).
const HANDLE_A: &str = "0123456789abcdef01234567";
/// A second valid handle.
const HANDLE_B: &str = "fedcba9876543210fedcba98";

type Res = Result<PgQueryResult, sqlx::Error>;

fn report(failures: &[String]) {
    assert!(
        failures.is_empty(),
        "{} failures:\n{}",
        failures.len(),
        failures.join("\n")
    );
}

/// A database error as `(SQLSTATE, constraint) message`; any other error as its text.
fn describe(e: &sqlx::Error) -> String {
    match e {
        sqlx::Error::Database(db) => format!(
            "({}, {}) {db}",
            db.code().as_deref().unwrap_or("no code"),
            db.constraint().unwrap_or("no constraint")
        ),
        other => other.to_string(),
    }
}

/// `Ok` when `res` is a database error with SQLSTATE `want.0` on the constraint named `want.1`. Never the message
/// text alone: the server's locale decides it.
fn expect_err(case: &str, res: Res, want: (&str, &str)) -> Result<(), String> {
    let (code, constraint) = want;
    match res {
        Err(sqlx::Error::Database(e))
            if e.code().as_deref() == Some(code) && e.constraint() == Some(constraint) =>
        {
            Ok(())
        }
        Err(e) => Err(format!(
            "case {case}: expected ({code}, {constraint}), got {}",
            describe(&e)
        )),
        Ok(_) => Err(format!(
            "case {case}: expected ({code}, {constraint}), got Ok"
        )),
    }
}

fn expect_ok(case: &str, res: Res) -> Result<(), String> {
    res.map(|_| ())
        .map_err(|e| format!("case {case} (control): expected Ok, got {}", describe(&e)))
}

/// The failure lines of `results`.
fn failed(results: impl IntoIterator<Item = Result<(), String>>) -> Vec<String> {
    results.into_iter().filter_map(Result::err).collect()
}

/// A state at `T0` whose `users` table holds `users`, each named `Ann`, `Ben`, ... by position.
async fn social_state(users: &[i64]) -> (AppState, common::TestDb) {
    let (st, db) = common::test_state().await;
    let st = st.with_clock(Arc::new(FixedClock(T0)));
    for (i, &id) in users.iter().enumerate() {
        let name = NAMES.get(i).copied().unwrap_or("Zed");
        st.repo
            .upsert_user(UserId(id), name, Some("ru"), T0)
            .await
            .unwrap();
    }
    (st, db)
}

/// The first names [`social_state`] gives its users, in order.
const NAMES: [&str; 4] = ["Ann", "Ben", "Cat", "Dan"];

/// A migrated database with the `users` rows of ANN and BEN, and a raw connection to it.
async fn schema_db() -> (AppState, common::TestDb, PgConnection) {
    let (st, db) = social_state(&[ANN, BEN]).await;
    let c = common::raw_db(&st).await;
    (st, db, c)
}

async fn friendship(c: &mut PgConnection, lo: i64, hi: i64) -> Res {
    sqlx::query("INSERT INTO friendships (user_lo, user_hi, created_at) VALUES ($1, $2, $3)")
        .bind(lo)
        .bind(hi)
        .bind(T0)
        .execute(&mut *c)
        .await
}

async fn request(c: &mut PgConnection, from: i64, to: i64) -> Res {
    sqlx::query("INSERT INTO friend_requests (from_id, to_id, created_at) VALUES ($1, $2, $3)")
        .bind(from)
        .bind(to)
        .bind(T0)
        .execute(&mut *c)
        .await
}

async fn code(c: &mut PgConnection, code: &str, user: i64, revoked_at: Option<i64>) -> Res {
    sqlx::query(
        "INSERT INTO invite_codes (code, user_id, created_at, revoked_at) VALUES ($1, $2, $3, $4)",
    )
    .bind(code)
    .bind(user)
    .bind(T0)
    .bind(revoked_at)
    .execute(&mut *c)
    .await
}

async fn consent(c: &mut PgConnection, user: i64, purpose: &str, policy: &str, text: &str) -> Res {
    sqlx::query(
        "INSERT INTO consents (user_id, purpose, granted, policy_version, text_version, at) \
         VALUES ($1, $2, TRUE, $3, $4, $5)",
    )
    .bind(user)
    .bind(purpose)
    .bind(policy)
    .bind(text)
    .bind(T0)
    .execute(&mut *c)
    .await
}

async fn referral(
    c: &mut PgConnection,
    invitee: i64,
    inviter: Option<i64>,
    qualified_at: Option<i64>,
    outcome: Option<&str>,
) -> Res {
    sqlx::query(
        "INSERT INTO referrals (invitee_id, inviter_id, attributed_at, qualified_at, outcome) \
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(invitee)
    .bind(inviter)
    .bind(T0)
    .bind(qualified_at)
    .bind(outcome)
    .execute(&mut *c)
    .await
}

async fn block(c: &mut PgConnection, user: i64, blocked: i64) -> Res {
    sqlx::query("INSERT INTO friend_blocks (user_id, blocked_id, created_at) VALUES ($1, $2, $3)")
        .bind(user)
        .bind(blocked)
        .bind(T0)
        .execute(&mut *c)
        .await
}

async fn handle(c: &mut PgConnection, user: i64, handle: &str) -> Res {
    sqlx::query("INSERT INTO user_handles (user_id, handle) VALUES ($1, $2)")
        .bind(user)
        .bind(handle)
        .execute(&mut *c)
        .await
}

/// One friendship per pair, stored low id first; a request is between two users and never to oneself.
#[tokio::test]
async fn schema_friendships_ordered() {
    let (_st, _db, mut c) = schema_db().await;
    let failures = failed([
        expect_err(
            "friendship (BEN, ANN)",
            friendship(&mut c, BEN, ANN).await,
            ("23514", "friendships_ordered"),
        ),
        expect_ok("friendship (ANN, BEN)", friendship(&mut c, ANN, BEN).await),
        expect_err(
            "friendship (ANN, BEN) again",
            friendship(&mut c, ANN, BEN).await,
            ("23505", "friendships_pkey"),
        ),
        expect_err(
            "friendship (nobody, ANN)",
            friendship(&mut c, NOBODY_LOW, ANN).await,
            ("23503", "friendships_lo_fk"),
        ),
        expect_err(
            "friendship (BEN, nobody)",
            friendship(&mut c, BEN, NOBODY_HIGH).await,
            ("23503", "friendships_hi_fk"),
        ),
        expect_err(
            "request ANN -> ANN",
            request(&mut c, ANN, ANN).await,
            ("23514", "friend_requests_not_self"),
        ),
        expect_ok("request ANN -> BEN", request(&mut c, ANN, BEN).await),
        expect_ok("request BEN -> ANN", request(&mut c, BEN, ANN).await),
        expect_err(
            "request ANN -> BEN again",
            request(&mut c, ANN, BEN).await,
            ("23505", "friend_requests_pkey"),
        ),
        expect_err(
            "request nobody -> ANN",
            request(&mut c, NOBODY_LOW, ANN).await,
            ("23503", "friend_requests_from_fk"),
        ),
        expect_err(
            "request ANN -> nobody",
            request(&mut c, ANN, NOBODY_HIGH).await,
            ("23503", "friend_requests_to_fk"),
        ),
    ]);
    report(&failures);
}

/// An invite code is 32 lower-case hex, revoked no earlier than it was created, and belongs to a user.
#[tokio::test]
async fn schema_invite_code_shape() {
    let (_st, _db, mut c) = schema_db().await;
    let upper = CODE_A.to_uppercase();
    let failures = failed([
        expect_err(
            "upper-case code",
            code(&mut c, &upper, ANN, None).await,
            ("23514", "invite_codes_shape"),
        ),
        expect_err(
            "31-character code",
            code(&mut c, &CODE_A[1..], ANN, None).await,
            ("23514", "invite_codes_shape"),
        ),
        expect_err(
            "revoked before created",
            code(&mut c, CODE_B, ANN, Some(T0 - 1)).await,
            ("23514", "invite_codes_revoked_after"),
        ),
        expect_err(
            "code of nobody",
            code(&mut c, CODE_B, NOBODY_HIGH, None).await,
            ("23503", "invite_codes_user_fk"),
        ),
        expect_ok("code of ANN", code(&mut c, CODE_A, ANN, None).await),
        expect_ok(
            "code of BEN revoked at creation",
            code(&mut c, CODE_B, BEN, Some(T0)).await,
        ),
    ]);
    report(&failures);
}

/// One active code per user; revoked codes stand beside it.
#[tokio::test]
async fn schema_one_active_code() {
    let (_st, _db, mut c) = schema_db().await;
    let failures = failed([
        expect_ok("active code of ANN", code(&mut c, CODE_A, ANN, None).await),
        expect_err(
            "second active code of ANN",
            code(&mut c, CODE_B, ANN, None).await,
            ("23505", "invite_codes_one_active"),
        ),
        expect_ok(
            "revoked code of ANN beside the active one",
            code(&mut c, CODE_B, ANN, Some(T0)).await,
        ),
    ]);
    report(&failures);
}

/// A consent row names the one known purpose, a policy version `YYYY-MM-DD[a-z]` and a text version `<name>.v<N>`,
/// for a user.
#[tokio::test]
async fn schema_consent_purpose_known() {
    let (_st, _db, mut c) = schema_db().await;
    let failures = failed([
        expect_err(
            "purpose marketing",
            consent(&mut c, ANN, "marketing", "2026-10-31", "friends_profile.v1").await,
            ("23514", "consents_purpose_known"),
        ),
        expect_err(
            "policy version v1",
            consent(&mut c, ANN, "friends_profile", "v1", "friends_profile.v1").await,
            ("23514", "consents_policy_version_shape"),
        ),
        expect_err(
            "text version without .vN",
            consent(
                &mut c,
                ANN,
                "friends_profile",
                "2026-10-31",
                "friends_profile",
            )
            .await,
            ("23514", "consents_text_version_shape"),
        ),
        expect_err(
            "consent of nobody",
            consent(
                &mut c,
                NOBODY_HIGH,
                "friends_profile",
                "2026-10-31",
                "friends_profile.v1",
            )
            .await,
            ("23503", "consents_user_fk"),
        ),
        expect_ok(
            "consent of ANN",
            consent(
                &mut c,
                ANN,
                "friends_profile",
                "2026-10-31",
                "friends_profile.v1",
            )
            .await,
        ),
        expect_ok(
            "consent of ANN, a lettered policy version",
            consent(
                &mut c,
                ANN,
                "friends_profile",
                "2026-10-31b",
                "friends_profile.v12",
            )
            .await,
        ),
    ]);
    report(&failures);
}

/// One referral per invitee, never of oneself; a qualified referral has a known outcome, an unqualified one none.
#[tokio::test]
async fn schema_referral_outcome_known() {
    let (_st, _db, mut c) = schema_db().await;
    let failures = failed([
        expect_err(
            "qualified without outcome",
            referral(&mut c, BEN, Some(ANN), Some(T0), None).await,
            ("23514", "referrals_outcome_known"),
        ),
        expect_err(
            "unknown outcome",
            referral(&mut c, BEN, Some(ANN), Some(T0), Some("lost")).await,
            ("23514", "referrals_outcome_known"),
        ),
        expect_err(
            "outcome without qualification",
            referral(&mut c, BEN, Some(ANN), None, Some("granted")).await,
            ("23514", "referrals_outcome_known"),
        ),
        expect_err(
            "self referral",
            referral(&mut c, ANN, Some(ANN), None, None).await,
            ("23514", "referrals_not_self"),
        ),
        expect_err(
            "invitee nobody",
            referral(&mut c, NOBODY_HIGH, Some(ANN), None, None).await,
            ("23503", "referrals_invitee_fk"),
        ),
        expect_err(
            "inviter nobody",
            referral(&mut c, BEN, Some(NOBODY_HIGH), None, None).await,
            ("23503", "referrals_inviter_fk"),
        ),
        expect_ok(
            "BEN invited by ANN, qualified, granted",
            referral(&mut c, BEN, Some(ANN), Some(T0), Some("granted")).await,
        ),
        expect_err(
            "BEN again",
            referral(&mut c, BEN, Some(ANN), None, None).await,
            ("23505", "referrals_pkey"),
        ),
        expect_ok(
            "ANN with an erased inviter",
            referral(&mut c, ANN, None, None, None).await,
        ),
    ]);
    report(&failures);
}

/// One block per (remover, removed), never of oneself, between two users.
#[tokio::test]
async fn schema_friend_blocks_not_self() {
    let (_st, _db, mut c) = schema_db().await;
    let failures = failed([
        expect_err(
            "block ANN -> ANN",
            block(&mut c, ANN, ANN).await,
            ("23514", "friend_blocks_not_self"),
        ),
        expect_ok("block ANN -> BEN", block(&mut c, ANN, BEN).await),
        expect_ok("block BEN -> ANN", block(&mut c, BEN, ANN).await),
        expect_err(
            "block ANN -> BEN again",
            block(&mut c, ANN, BEN).await,
            ("23505", "friend_blocks_pkey"),
        ),
        expect_err(
            "block by nobody",
            block(&mut c, NOBODY_LOW, ANN).await,
            ("23503", "friend_blocks_user_fk"),
        ),
        expect_err(
            "block of nobody",
            block(&mut c, ANN, NOBODY_HIGH).await,
            ("23503", "friend_blocks_blocked_fk"),
        ),
    ]);
    report(&failures);
}

/// A handle is 24 lower-case hex, one per user, never shared.
#[tokio::test]
async fn schema_user_handle_shape() {
    let (_st, _db, mut c) = schema_db().await;
    let upper = HANDLE_A.to_uppercase();
    let failures = failed([
        expect_err(
            "upper-case handle",
            handle(&mut c, ANN, &upper).await,
            ("23514", "user_handles_shape"),
        ),
        expect_err(
            "32-character handle",
            handle(&mut c, ANN, CODE_A).await,
            ("23514", "user_handles_shape"),
        ),
        expect_ok("handle of ANN", handle(&mut c, ANN, HANDLE_A).await),
        expect_err(
            "ANN's handle for BEN",
            handle(&mut c, BEN, HANDLE_A).await,
            ("23505", "user_handles_handle"),
        ),
        expect_err(
            "a second handle of ANN",
            handle(&mut c, ANN, HANDLE_B).await,
            ("23505", "user_handles_pkey"),
        ),
        expect_err(
            "handle of nobody",
            handle(&mut c, NOBODY_HIGH, HANDLE_B).await,
            ("23503", "user_handles_user_fk"),
        ),
        expect_ok("handle of BEN", handle(&mut c, BEN, HANDLE_B).await),
    ]);
    report(&failures);
}
