//! The social graph (META-PLAN M10-M12, M15; `0005_social.sql`): the schema's named constraints on raw SQL, the
//! users upsert's inserted flag, the attribution at `POST /api/auth` (M11), the invite routes (F19), the social view
//! with the accept and the decline or removal and its durable block (F20), the code rotation and the consent log
//! (M12), and the public privacy page (M26), through the production router.
//!
//! A concurrency case holds a row lock on a raw READ COMMITTED connection (a stand-in for another app transaction)
//! and observes the app's request waiting on it through `common::wait_for_lock_waiter`, never by timing.
//!
//! Every refused schema case breaks one constraint, or one whose CHECK name sorts before every other it breaks:
//! PostgreSQL tests a table's CHECK constraints in name order, then the unique indexes, then the foreign keys at the
//! end of the statement, so the constraint a case reports is the one the case is about. Each refused case sits next to
//! a control on the same parent rows, so a red names the constraint, not a missing parent.
//!
//! User ids are at least 5 000 000 001, so no timestamp, count or code fragment of a test can equal one. initData is
//! signed here with the validator's own data-check-string and key (the `auth.rs` precedent).

use std::sync::Arc;

use axum::body::Body;
use axum::http::header::{AUTHORIZATION, CONTENT_TYPE};
use axum::http::{Method, Request, StatusCode};
use hmac::{Hmac, KeyInit, Mac};
use serde_json::{Value, json};
use server::AppState;
use server::auth::{data_check_string, issue_token, secret_key};
use server::clock::FixedClock;
use server::ids::UserId;
use sha2::Sha256;
use sqlx::postgres::PgQueryResult;
use sqlx::{Connection, PgConnection};

use crate::catalog::{T0, bearer};
use crate::common;

/// The first player: the lowest id, so every two-row lock takes ANN's row first.
const ANN: i64 = 5_000_000_001;
/// The second player.
const BEN: i64 = 5_000_000_002;
/// The third player.
const CAT: i64 = 5_000_000_003;
/// The fourth player.
const DAN: i64 = 5_000_000_004;
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

/// The users upsert reports whether it inserted the row: a newcomer once, then never again, also within one second
/// (M11: `created_at = now` would call both logins at `T0` new).
#[tokio::test]
async fn users_upsert_reports_inserted() {
    let (st, _db) = social_state(&[]).await;
    let mut got = Vec::new();
    for at in [T0, T0, T0 + 100] {
        got.push(
            st.repo
                .upsert_user(UserId(ANN), "Ann", Some("ru"), at)
                .await
                .unwrap(),
        );
    }
    assert!(
        got == [true, false, false],
        "upserts at T0, T0, T0 + 100: expected [true, false, false], got {got:?}"
    );
}

/// initData for `user` named `name`, issued at `T0`, with `start_param` when given, signed with the test bot token.
fn init_data(user: i64, name: &str, start_param: Option<&str>) -> String {
    let user_json = json!({ "id": user, "first_name": name, "language_code": "ru" }).to_string();
    let mut pairs = vec![
        ("auth_date".to_owned(), T0.to_string()),
        ("user".to_owned(), user_json),
    ];
    if let Some(start_param) = start_param {
        pairs.push(("start_param".to_owned(), start_param.to_owned()));
    }
    let mut mac = Hmac::<Sha256>::new_from_slice(&secret_key(common::TEST_BOT_TOKEN)).unwrap();
    mac.update(data_check_string(&pairs).as_bytes());
    pairs.push(("hash".to_owned(), hex::encode(mac.finalize().into_bytes())));
    form_urlencoded::Serializer::new(String::new())
        .extend_pairs(&pairs)
        .finish()
}

/// `POST /api/auth` with the JSON `body`.
async fn post_auth(st: &AppState, body: &Value) -> common::Reply {
    let req = Request::post("/api/auth")
        .header(CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .unwrap();
    common::call(st, req).await
}

/// A launch of `user` named `name` with `start_param`: `POST /api/auth` with signed initData.
async fn launch(st: &AppState, user: i64, name: &str, start_param: Option<&str>) -> common::Reply {
    post_auth(
        st,
        &json!({ "initData": init_data(user, name, start_param) }),
    )
    .await
}

fn body_json(reply: &common::Reply) -> Value {
    serde_json::from_slice(&reply.body).unwrap_or(Value::Null)
}

fn body_text(reply: &common::Reply) -> String {
    String::from_utf8_lossy(&reply.body).into_owned()
}

/// `None` when `reply` is a 200 `AuthResponse` (exactly `token`, `expiresAt`, `user`), else the failure line.
fn auth_ok(case: &str, reply: &common::Reply) -> Option<String> {
    let json = body_json(reply);
    let keys: Vec<&str> = json
        .as_object()
        .map(|map| map.keys().map(String::as_str).collect())
        .unwrap_or_default();
    (reply.status != StatusCode::OK || keys != ["expiresAt", "token", "user"]).then(|| {
        format!(
            "{case}: expected 200 with exactly expiresAt, token, user; got {} {}",
            reply.status.as_u16(),
            body_text(reply)
        )
    })
}

/// A referral row: (invitee, inviter, attributed_at, qualified_at, outcome).
type ReferralRow = (i64, Option<i64>, i64, Option<i64>, Option<String>);

/// Every referral row, by invitee.
async fn referral_rows(c: &mut PgConnection) -> Vec<ReferralRow> {
    sqlx::query_as(
        "SELECT invitee_id, inviter_id, attributed_at, qualified_at, outcome FROM referrals ORDER BY invitee_id",
    )
    .fetch_all(&mut *c)
    .await
    .unwrap()
}

/// Every friend request as (from, to), in that order.
async fn request_rows(c: &mut PgConnection) -> Vec<(i64, i64)> {
    sqlx::query_as("SELECT from_id, to_id FROM friend_requests ORDER BY from_id, to_id")
        .fetch_all(&mut *c)
        .await
        .unwrap()
}

/// A newcomer's first launch with an invite records one referral to the code's owner; an existing user's launch with
/// the same code, and the newcomer's second launch, record nothing (M11: a property of the first login only).
#[tokio::test]
async fn referral_attributed_on_first_login_only() {
    let (st, _db) = social_state(&[ANN, BEN]).await;
    let mut c = common::raw_db(&st).await;
    code(&mut c, CODE_A, ANN, None).await.unwrap();
    let invite = format!("f{CODE_A}");
    let mut failures = Vec::new();

    failures.extend(auth_ok(
        "existing BEN",
        &launch(&st, BEN, "Ben", Some(&invite)).await,
    ));
    let rows = referral_rows(&mut c).await;
    if !rows.is_empty() {
        failures.push(format!("existing BEN: expected no row, got {rows:?}"));
    }

    failures.extend(auth_ok(
        "newcomer CAT",
        &launch(&st, CAT, "Cat", Some(&invite)).await,
    ));
    let want: Vec<ReferralRow> = vec![(CAT, Some(ANN), T0, None, None)];
    let rows = referral_rows(&mut c).await;
    if rows != want {
        failures.push(format!("newcomer CAT: expected {want:?}, got {rows:?}"));
    }

    failures.extend(auth_ok(
        "CAT again",
        &launch(&st, CAT, "Cat", Some(&invite)).await,
    ));
    let rows = referral_rows(&mut c).await;
    if rows != want {
        failures.push(format!(
            "CAT's second launch: expected {want:?}, got {rows:?}"
        ));
    }
    let requests = request_rows(&mut c).await;
    if !requests.is_empty() {
        failures.push(format!(
            "friend requests: expected none at auth, got {requests:?}"
        ));
    }
    report(&failures);
}

/// Only `f` + 32 lower-case hex naming an active code is an invite: every other signed `start_param`, and an unsigned
/// `startParam` in the body, is a plain login (200, `AuthResponse`'s three keys) that writes no referral and no
/// request. Each case is a fresh newcomer, so each takes the attribution path.
#[tokio::test]
async fn auth_start_param_other_shapes_create_nothing() {
    let (st, _db) = social_state(&[ANN]).await;
    let mut c = common::raw_db(&st).await;
    code(&mut c, CODE_A, ANN, None).await.unwrap();
    code(&mut c, CODE_B, ANN, Some(T0)).await.unwrap();
    let cases: Vec<(&str, String)> = vec![
        ("upper-case prefix", format!("F{CODE_A}")),
        ("upper-case code", format!("f{}", CODE_A.to_uppercase())),
        ("31 hex", format!("f{}", &CODE_A[1..])),
        ("33 hex", format!("f{CODE_A}0")),
        ("U+0000 and 31 hex", format!("f\u{0}{}", &CODE_A[1..])),
        ("campaign code", "c_spring_2027".to_owned()),
        ("empty", String::new()),
        (
            "unknown code",
            "f00000000000000000000000000000000".to_owned(),
        ),
        ("revoked code", format!("f{CODE_B}")),
    ];
    let mut failures = Vec::new();
    for (i, (case, start_param)) in cases.iter().enumerate() {
        let user = 5_000_000_100 + i64::try_from(i).unwrap();
        failures.extend(auth_ok(
            case,
            &launch(&st, user, "New", Some(start_param)).await,
        ));
    }
    let unsigned = post_auth(
        &st,
        &json!({ "initData": init_data(5_000_000_200, "New", None), "startParam": format!("f{CODE_A}") }),
    )
    .await;
    failures.extend(auth_ok("unsigned startParam in the body", &unsigned));
    let referrals = referral_rows(&mut c).await;
    if !referrals.is_empty() {
        failures.push(format!("referrals: expected none, got {referrals:?}"));
    }
    let requests = request_rows(&mut c).await;
    if !requests.is_empty() {
        failures.push(format!("friend requests: expected none, got {requests:?}"));
    }
    report(&failures);
}

/// `method path` through the production router, as `user` (a token issued at `T0`) or without `Authorization`.
async fn send(st: &AppState, method: Method, user: Option<i64>, path: &str) -> common::Reply {
    let mut req = Request::builder().method(method).uri(path);
    if let Some(user) = user {
        req = req.header(AUTHORIZATION, bearer(st, user));
    }
    common::call(st, req.body(Body::empty()).unwrap()).await
}

/// `GET /api/invites/{code}` as `user`.
async fn view_invite(st: &AppState, user: i64, code: &str) -> common::Reply {
    send(st, Method::GET, Some(user), &format!("/api/invites/{code}")).await
}

/// `POST /api/invites/{code}/request` as `user`.
async fn ask(st: &AppState, user: i64, code: &str) -> common::Reply {
    send(
        st,
        Method::POST,
        Some(user),
        &format!("/api/invites/{code}/request"),
    )
    .await
}

/// `None` when `reply` is a 200 whose body is exactly `{"state":"<state>"}`, else the failure line.
fn state_is(case: &str, reply: &common::Reply, state: &str) -> Option<String> {
    let want = format!(r#"{{"state":"{state}"}}"#);
    let body = body_text(reply);
    (reply.status != StatusCode::OK || body != want).then(|| {
        format!(
            "{case}: expected 200 {want}, got {} {body}",
            reply.status.as_u16()
        )
    })
}

/// `None` when `reply` is a 404 `{"error":"not_found"}`, else the failure line.
fn not_found(case: &str, reply: &common::Reply) -> Option<String> {
    let body = body_text(reply);
    (reply.status != StatusCode::NOT_FOUND || body != r#"{"error":"not_found"}"#).then(|| {
        format!(
            "{case}: expected 404 {{\"error\":\"not_found\"}}, got {} {body}",
            reply.status.as_u16()
        )
    })
}

/// Opens a READ COMMITTED transaction on a raw connection: a stand-in for another app transaction.
async fn begin(c: &mut PgConnection) {
    sqlx::raw_sql("BEGIN ISOLATION LEVEL READ COMMITTED")
        .execute(&mut *c)
        .await
        .unwrap();
}

async fn commit(c: &mut PgConnection) {
    sqlx::raw_sql("COMMIT").execute(&mut *c).await.unwrap();
}

/// Locks `user`'s `users` row on `c` as the app's transactions do.
async fn lock_user(c: &mut PgConnection, user: i64) {
    sqlx::query("SELECT 1 FROM users WHERE id = $1 FOR NO KEY UPDATE")
        .bind(user)
        .execute(&mut *c)
        .await
        .unwrap();
}

/// Both invite answers are exactly `{"state":...}`: the owner's first name, handle and id appear nowhere in them.
#[tokio::test]
async fn invite_view_reveals_nothing_about_owner() {
    let (st, _db) = social_state(&[ANN, BEN]).await;
    let mut c = common::raw_db(&st).await;
    code(&mut c, CODE_A, ANN, None).await.unwrap();
    handle(&mut c, ANN, HANDLE_A).await.unwrap();
    let mut failures = Vec::new();
    failures.extend(state_is(
        "GET as BEN",
        &view_invite(&st, BEN, CODE_A).await,
        "open",
    ));
    failures.extend(state_is(
        "POST as BEN",
        &ask(&st, BEN, CODE_A).await,
        "requested",
    ));
    failures.extend(state_is(
        "GET as BEN after the request",
        &view_invite(&st, BEN, CODE_A).await,
        "requested",
    ));
    report(&failures);
}

/// The owner's pending incoming requests stop at 50 (M10, M15), exactly, under concurrency: at 49 a stand-in holds
/// ANN's `users` row and inserts the 50th; BEN's ask is observed waiting on that row, then counts the committed 50th
/// and answers `requested` without a row. A capped caller sees `requested` on the GET and the POST alike (the cap is
/// never told apart from a pending request).
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn pending_requests_capped() {
    let (st, _db) = social_state(&[ANN, BEN, CAT]).await;
    let mut c = common::raw_db(&st).await;
    code(&mut c, CODE_A, ANN, None).await.unwrap();
    // 50 requesters with ids above every player; 49 of them ask now, the stand-in sends the 50th.
    sqlx::query(
        "INSERT INTO users (id, first_name, language_code, created_at, last_seen_at) \
         SELECT g, 'Req', NULL, $1, $1 FROM generate_series(6000000001::bigint, 6000000050::bigint) g",
    )
    .bind(T0)
    .execute(&mut c)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO friend_requests (from_id, to_id, created_at) \
         SELECT g, $1, $2 FROM generate_series(6000000001::bigint, 6000000049::bigint) g",
    )
    .bind(ANN)
    .bind(T0)
    .execute(&mut c)
    .await
    .unwrap();
    let mut failures = Vec::new();
    failures.extend(state_is(
        "GET as BEN at 49",
        &view_invite(&st, BEN, CODE_A).await,
        "open",
    ));

    let mut stand_in = common::raw_db(&st).await;
    begin(&mut stand_in).await;
    lock_user(&mut stand_in, ANN).await;
    request(&mut stand_in, 6_000_000_050, ANN).await.unwrap();
    let app = st.clone();
    let mut asking = tokio::spawn(async move { ask(&app, BEN, CODE_A).await });
    let early = tokio::select! {
        biased;
        reply = &mut asking => Some(reply.unwrap()),
        () = common::wait_for_lock_waiter(&st) => None,
    };
    if early.is_some() {
        failures
            .push("the ask never waited: it answered while the stand-in held ANN's row".to_owned());
    }
    commit(&mut stand_in).await;
    stand_in.close().await.unwrap();
    let reply = match early {
        Some(reply) => reply,
        None => asking.await.unwrap(),
    };
    failures.extend(state_is("BEN's ask beside the 50th", &reply, "requested"));

    for (case, reply) in [
        ("GET as BEN at 50", view_invite(&st, BEN, CODE_A).await),
        ("GET as CAT at 50", view_invite(&st, CAT, CODE_A).await),
        ("POST as CAT at 50", ask(&st, CAT, CODE_A).await),
        (
            "GET as CAT after the send",
            view_invite(&st, CAT, CODE_A).await,
        ),
    ] {
        failures.extend(state_is(case, &reply, "requested"));
    }
    let rows = request_rows(&mut c).await;
    let to_ann = rows.iter().filter(|(_, to)| *to == ANN).count();
    if to_ann != 50 {
        failures.push(format!("rows: expected 50 requests to ANN, got {to_ann}"));
    }
    let of_players: Vec<&(i64, i64)> = rows
        .iter()
        .filter(|(from, _)| [BEN, CAT].contains(from))
        .collect();
    if !of_players.is_empty() {
        failures.push(format!(
            "requests of BEN or CAT: expected none, got {of_players:?}"
        ));
    }
    report(&failures);
}

/// A launch with a live invite (an existing user's and a newcomer's) creates no friend request: asking is the
/// holder's own act. Both see `open`.
#[tokio::test]
async fn invite_launch_creates_no_request() {
    let (st, _db) = social_state(&[ANN, BEN]).await;
    let mut c = common::raw_db(&st).await;
    code(&mut c, CODE_A, ANN, None).await.unwrap();
    let invite = format!("f{CODE_A}");
    let mut failures = Vec::new();
    failures.extend(auth_ok(
        "existing BEN",
        &launch(&st, BEN, "Ben", Some(&invite)).await,
    ));
    failures.extend(auth_ok(
        "newcomer CAT",
        &launch(&st, CAT, "Cat", Some(&invite)).await,
    ));
    let requests = request_rows(&mut c).await;
    if !requests.is_empty() {
        failures.push(format!("friend requests: expected none, got {requests:?}"));
    }
    for (case, user) in [("GET as BEN", BEN), ("GET as CAT", CAT)] {
        failures.extend(state_is(
            case,
            &view_invite(&st, user, CODE_A).await,
            "open",
        ));
    }
    report(&failures);
}

/// One's own code is `own` on both routes and creates nothing: the owner's own-code launch writes no referral (a
/// newcomer owns no code, so this is the reachable case), and the request route writes no row.
#[tokio::test]
async fn self_invite_creates_nothing() {
    let (st, _db) = social_state(&[ANN]).await;
    let mut c = common::raw_db(&st).await;
    code(&mut c, CODE_A, ANN, None).await.unwrap();
    let mut failures = Vec::new();
    failures.extend(auth_ok(
        "ANN's own-code launch",
        &launch(&st, ANN, "Ann", Some(&format!("f{CODE_A}"))).await,
    ));
    failures.extend(state_is(
        "GET as ANN",
        &view_invite(&st, ANN, CODE_A).await,
        "own",
    ));
    failures.extend(state_is("POST as ANN", &ask(&st, ANN, CODE_A).await, "own"));
    let referrals = referral_rows(&mut c).await;
    if !referrals.is_empty() {
        failures.push(format!("referrals: expected none, got {referrals:?}"));
    }
    let requests = request_rows(&mut c).await;
    if !requests.is_empty() {
        failures.push(format!("friend requests: expected none, got {requests:?}"));
    }
    report(&failures);
}

/// A revoked code is unknown to both routes (404) and creates nothing, not even a newcomer's referral.
#[tokio::test]
async fn revoked_code_creates_nothing() {
    let (st, _db) = social_state(&[ANN, BEN]).await;
    let mut c = common::raw_db(&st).await;
    code(&mut c, CODE_A, ANN, Some(T0)).await.unwrap();
    code(&mut c, CODE_B, ANN, None).await.unwrap();
    let mut failures = Vec::new();
    failures.extend(not_found(
        "GET as BEN",
        &view_invite(&st, BEN, CODE_A).await,
    ));
    failures.extend(not_found("POST as BEN", &ask(&st, BEN, CODE_A).await));
    failures.extend(auth_ok(
        "newcomer CAT with the revoked code",
        &launch(&st, CAT, "Cat", Some(&format!("f{CODE_A}"))).await,
    ));
    let referrals = referral_rows(&mut c).await;
    if !referrals.is_empty() {
        failures.push(format!("referrals: expected none, got {referrals:?}"));
    }
    let requests = request_rows(&mut c).await;
    if !requests.is_empty() {
        failures.push(format!("friend requests: expected none, got {requests:?}"));
    }
    report(&failures);
}

/// Two sends through one code make one request; both answer `requested`.
#[tokio::test]
async fn invite_request_repeat_creates_one() {
    let (st, _db) = social_state(&[ANN, BEN]).await;
    let mut c = common::raw_db(&st).await;
    code(&mut c, CODE_A, ANN, None).await.unwrap();
    let mut failures = Vec::new();
    for case in ["first send", "second send"] {
        failures.extend(state_is(case, &ask(&st, BEN, CODE_A).await, "requested"));
    }
    let requests = request_rows(&mut c).await;
    if requests != [(BEN, ANN)] {
        failures.push(format!(
            "friend requests: expected [(BEN, ANN)], got {requests:?}"
        ));
    }
    report(&failures);
}

/// `GET /api/social` as `user`: the reply and its JSON.
async fn social(st: &AppState, user: i64) -> (common::Reply, Value) {
    let reply = send(st, Method::GET, Some(user), "/api/social").await;
    let json = body_json(&reply);
    (reply, json)
}

/// `user`'s invite code, read through `GET /api/social` (which creates it on the first call).
async fn invite_code(st: &AppState, user: i64) -> String {
    let (reply, json) = social(st, user).await;
    match json["inviteCode"].as_str() {
        Some(code) if reply.status == StatusCode::OK => code.to_owned(),
        _ => panic!(
            "GET /api/social as {user}: expected 200 with an inviteCode, got {} {}",
            reply.status.as_u16(),
            body_text(&reply)
        ),
    }
}

/// `POST /api/friends/requests/{handle}/accept` as `user`.
async fn accept(st: &AppState, user: i64, handle: &str) -> common::Reply {
    send(
        st,
        Method::POST,
        Some(user),
        &format!("/api/friends/requests/{handle}/accept"),
    )
    .await
}

/// `DELETE /api/friends/{handle}` as `user`.
async fn remove(st: &AppState, user: i64, handle: &str) -> common::Reply {
    send(
        st,
        Method::DELETE,
        Some(user),
        &format!("/api/friends/{handle}"),
    )
    .await
}

/// `user`'s handle, read raw (`None` before the user first asked or accepted).
async fn handle_of(c: &mut PgConnection, user: i64) -> Option<String> {
    sqlx::query_scalar("SELECT handle FROM user_handles WHERE user_id = $1")
        .bind(user)
        .fetch_optional(&mut *c)
        .await
        .unwrap()
}

/// The (handle, firstName) pairs of a `SocialResponse` list (`friends` or `requests`).
fn people(json: &Value, list: &str) -> Vec<(String, String)> {
    json[list]
        .as_array()
        .map(|items| {
            items
                .iter()
                .map(|item| {
                    (
                        item["handle"].as_str().unwrap_or("<no handle>").to_owned(),
                        item["firstName"]
                            .as_str()
                            .unwrap_or("<no firstName>")
                            .to_owned(),
                    )
                })
                .collect()
        })
        .unwrap_or_default()
}

/// `(handle, first name)` as [`people`] lists it.
fn person(handle: &str, first_name: &str) -> (String, String) {
    (handle.to_owned(), first_name.to_owned())
}

/// Every friendship as (lo, hi).
async fn friendship_rows(c: &mut PgConnection) -> Vec<(i64, i64)> {
    sqlx::query_as("SELECT user_lo, user_hi FROM friendships ORDER BY user_lo, user_hi")
        .fetch_all(&mut *c)
        .await
        .unwrap()
}

/// Every block as (remover, removed).
async fn block_rows(c: &mut PgConnection) -> Vec<(i64, i64)> {
    sqlx::query_as("SELECT user_id, blocked_id FROM friend_blocks ORDER BY user_id, blocked_id")
        .fetch_all(&mut *c)
        .await
        .unwrap()
}

/// `None` when `reply` is a 200 `SocialResponse` whose `list` holds exactly `want`, else the failure line.
fn list_is(
    case: &str,
    reply: &common::Reply,
    list: &str,
    want: &[(String, String)],
) -> Option<String> {
    let got = people(&body_json(reply), list);
    (reply.status != StatusCode::OK || got != want).then(|| {
        format!(
            "{case}: expected 200 with {list} {want:?}, got {} {}",
            reply.status.as_u16(),
            body_text(reply)
        )
    })
}

/// `owner` and `requester` become friends through the routes: `requester` asks through `owner`'s code and `owner`
/// accepts. Returns (the owner's code, the owner's handle, the requester's handle).
async fn befriend(
    st: &AppState,
    c: &mut PgConnection,
    owner: i64,
    requester: i64,
) -> (String, String, String) {
    let code = invite_code(st, owner).await;
    let asked = ask(st, requester, &code).await;
    assert!(
        asked.status == StatusCode::OK,
        "befriend: the ask answered {}",
        asked.status
    );
    let requester_handle = handle_of(c, requester).await.unwrap();
    let accepted = accept(st, owner, &requester_handle).await;
    assert!(
        accepted.status == StatusCode::OK,
        "befriend: the accept answered {} {}",
        accepted.status,
        body_text(&accepted)
    );
    let owner_handle = handle_of(c, owner).await.unwrap();
    (code, owner_handle, requester_handle)
}

/// A friendship needs the code owner's accept (M10): BEN's send makes a request that only ANN sees; BEN has no friend
/// until ANN accepts, and the accept fills both lists.
#[tokio::test]
async fn friendship_needs_inviter_accept() {
    let (st, _db) = social_state(&[ANN, BEN]).await;
    let mut c = common::raw_db(&st).await;
    let code_a = invite_code(&st, ANN).await;
    let mut failures = Vec::new();
    failures.extend(state_is(
        "BEN's send",
        &ask(&st, BEN, &code_a).await,
        "requested",
    ));
    let handle_b = handle_of(&mut c, BEN).await.unwrap();

    let (reply, _) = social(&st, BEN).await;
    failures.extend(list_is("BEN after the send", &reply, "friends", &[]));
    failures.extend(list_is("BEN after the send", &reply, "requests", &[]));
    let (reply, _) = social(&st, ANN).await;
    failures.extend(list_is("ANN after the send", &reply, "friends", &[]));
    failures.extend(list_is(
        "ANN after the send",
        &reply,
        "requests",
        &[person(&handle_b, "Ben")],
    ));
    let rows = friendship_rows(&mut c).await;
    if !rows.is_empty() {
        failures.push(format!(
            "friendships before the accept: expected none, got {rows:?}"
        ));
    }

    let reply = accept(&st, ANN, &handle_b).await;
    failures.extend(list_is(
        "ANN's accept",
        &reply,
        "friends",
        &[person(&handle_b, "Ben")],
    ));
    failures.extend(list_is("ANN's accept", &reply, "requests", &[]));
    let handle_a = handle_of(&mut c, ANN).await.unwrap_or_default();
    let (reply, _) = social(&st, BEN).await;
    failures.extend(list_is(
        "BEN after the accept",
        &reply,
        "friends",
        &[person(&handle_a, "Ann")],
    ));
    failures.extend(state_is(
        "BEN's view of the code after the accept",
        &view_invite(&st, BEN, &code_a).await,
        "friends",
    ));
    let rows = friendship_rows(&mut c).await;
    if rows != [(ANN, BEN)] {
        failures.push(format!("friendships: expected [(ANN, BEN)], got {rows:?}"));
    }
    report(&failures);
}

/// A removal is durable (C1): after ANN removes BEN, BEN's old link of ANN answers `requested` on the GET and the
/// POST, before and after the send, exactly like a pending request, and creates nothing.
#[tokio::test]
async fn unfriend_is_durable_against_old_code() {
    let (st, _db) = social_state(&[ANN, BEN]).await;
    let mut c = common::raw_db(&st).await;
    let (code_a, _, handle_b) = befriend(&st, &mut c, ANN, BEN).await;
    let mut failures = Vec::new();
    failures.extend(list_is(
        "ANN removes BEN",
        &remove(&st, ANN, &handle_b).await,
        "friends",
        &[],
    ));
    failures.extend(state_is(
        "BEN's GET before the send",
        &view_invite(&st, BEN, &code_a).await,
        "requested",
    ));
    failures.extend(state_is(
        "BEN's send",
        &ask(&st, BEN, &code_a).await,
        "requested",
    ));
    failures.extend(state_is(
        "BEN's GET after the send",
        &view_invite(&st, BEN, &code_a).await,
        "requested",
    ));
    let (reply, _) = social(&st, ANN).await;
    failures.extend(list_is("ANN's requests", &reply, "requests", &[]));
    failures.extend(list_is("ANN's friends", &reply, "friends", &[]));
    let requests = request_rows(&mut c).await;
    if !requests.is_empty() {
        failures.push(format!("friend requests: expected none, got {requests:?}"));
    }
    let blocks = block_rows(&mut c).await;
    if blocks != [(ANN, BEN)] {
        failures.push(format!("blocks: expected [(ANN, BEN)], got {blocks:?}"));
    }
    report(&failures);
}

/// The places in `value` that hold `id` as a number or as its decimal string, as JSON paths.
pub(crate) fn id_paths(value: &Value, path: &str, id: i64, out: &mut Vec<String>) {
    match value {
        Value::Number(n) if n.as_i64() == Some(id) => out.push(path.to_owned()),
        Value::String(s) if *s == id.to_string() => out.push(path.to_owned()),
        Value::Array(items) => {
            for (i, item) in items.iter().enumerate() {
                id_paths(item, &format!("{path}[{i}]"), id, out);
            }
        }
        Value::Object(map) => {
            for (key, item) in map {
                id_paths(item, &format!("{path}.{key}"), id, out);
            }
        }
        _ => {}
    }
}

/// No social body carries a Telegram id (W1): every `SocialResponse` and `InviteView` of both users, with each other
/// as a request and then as a friend, holds neither user's `users.id` at any depth, as a number or a string, nor its
/// decimal anywhere in the raw text.
#[tokio::test]
async fn social_dto_has_no_telegram_id() {
    let (st, _db) = social_state(&[ANN, BEN]).await;
    let mut c = common::raw_db(&st).await;
    let code_a = invite_code(&st, ANN).await;
    let mut bodies: Vec<(&str, common::Reply)> = Vec::new();
    bodies.push(("BEN's send", ask(&st, BEN, &code_a).await));
    bodies.push((
        "BEN's invite view, requested",
        view_invite(&st, BEN, &code_a).await,
    ));
    bodies.push((
        "ANN's SocialResponse with BEN's request",
        social(&st, ANN).await.0,
    ));
    bodies.push((
        "BEN's SocialResponse after the send",
        social(&st, BEN).await.0,
    ));
    let handle_b = handle_of(&mut c, BEN).await.unwrap();
    bodies.push(("ANN's accept", accept(&st, ANN, &handle_b).await));
    bodies.push((
        "ANN's SocialResponse with BEN as friend",
        social(&st, ANN).await.0,
    ));
    bodies.push((
        "BEN's SocialResponse with ANN as friend",
        social(&st, BEN).await.0,
    ));
    bodies.push((
        "BEN's invite view, friends",
        view_invite(&st, BEN, &code_a).await,
    ));
    let mut failures = Vec::new();
    for (case, reply) in &bodies {
        if reply.status != StatusCode::OK {
            failures.push(format!(
                "{case}: expected 200, got {} {}",
                reply.status.as_u16(),
                body_text(reply)
            ));
        }
        let json = body_json(reply);
        let text = body_text(reply);
        for (name, id) in [("ANN", ANN), ("BEN", BEN)] {
            let mut paths = Vec::new();
            id_paths(&json, "", id, &mut paths);
            for path in paths {
                failures.push(format!("{case}: {path} equals {name}'s id"));
            }
            if text.contains(&id.to_string()) {
                failures.push(format!("{case}: the body text carries {name}'s id: {text}"));
            }
        }
    }
    report(&failures);
}

/// One step of a raw stand-in transaction: `Err` with the step's name and the error, never a panic.
async fn step(
    c: &mut PgConnection,
    name: &str,
    sql: &'static str,
    binds: &[i64],
) -> Result<(), String> {
    let mut query = sqlx::query(sql);
    for &value in binds {
        query = query.bind(value);
    }
    query
        .execute(&mut *c)
        .await
        .map(|_| ())
        .map_err(|e| format!("stand-in {name}: {}", describe(&e)))
}

/// A and B accept each other's requests at once (META-PLAN concurrency table): both transactions lock the two `users`
/// rows ascending. A stand-in for BEN's accept holds ANN's row (the low one); ANN's accept is observed waiting on it;
/// the stand-in then takes BEN's row, makes the friendship and deletes both requests. ANN's accept, re-run on the
/// committed rows, finds no request: 404. One friendship, no request, no deadlock.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn accept_both_directions_one_friendship() {
    let (st, _db) = social_state(&[ANN, BEN]).await;
    let mut c = common::raw_db(&st).await;
    let code_a = invite_code(&st, ANN).await;
    let code_b = invite_code(&st, BEN).await;
    let mut failures = Vec::new();
    failures.extend(state_is(
        "ANN asks BEN",
        &ask(&st, ANN, &code_b).await,
        "requested",
    ));
    failures.extend(state_is(
        "BEN asks ANN",
        &ask(&st, BEN, &code_a).await,
        "requested",
    ));
    let handle_b = handle_of(&mut c, BEN).await.unwrap();

    let mut stand_in = common::raw_db(&st).await;
    begin(&mut stand_in).await;
    lock_user(&mut stand_in, ANN).await;
    let app = st.clone();
    let mut accepting = tokio::spawn(async move { accept(&app, ANN, &handle_b).await });
    let early = tokio::select! {
        biased;
        reply = &mut accepting => Some(reply.unwrap()),
        () = common::wait_for_lock_waiter(&st) => None,
    };
    if early.is_some() {
        failures.push(
            "ANN's accept never waited: it answered while the stand-in held ANN's row".to_owned(),
        );
    }
    let steps: [(&str, &'static str, &[i64]); 4] = [
        (
            "lock BEN",
            "SELECT 1 FROM users WHERE id = $1 FOR NO KEY UPDATE",
            &[BEN],
        ),
        (
            "delete ANN -> BEN",
            "DELETE FROM friend_requests WHERE from_id = $1 AND to_id = $2",
            &[ANN, BEN],
        ),
        (
            "insert the friendship",
            "INSERT INTO friendships (user_lo, user_hi, created_at) VALUES ($1, $2, $3)",
            &[ANN, BEN, T0],
        ),
        (
            "delete BEN -> ANN",
            "DELETE FROM friend_requests WHERE from_id = $1 AND to_id = $2",
            &[BEN, ANN],
        ),
    ];
    let mut stand_in_ok = true;
    for (name, sql, binds) in steps {
        if let Err(line) = step(&mut stand_in, name, sql, binds).await {
            failures.push(line);
            stand_in_ok = false;
            break;
        }
    }
    let end = if stand_in_ok { "COMMIT" } else { "ROLLBACK" };
    sqlx::raw_sql(end).execute(&mut stand_in).await.unwrap();
    stand_in.close().await.unwrap();
    let reply = match early {
        Some(reply) => reply,
        None => accepting.await.unwrap(),
    };
    failures.extend(not_found("ANN's accept after BEN's", &reply));
    let rows = friendship_rows(&mut c).await;
    if rows != [(ANN, BEN)] {
        failures.push(format!("friendships: expected [(ANN, BEN)], got {rows:?}"));
    }
    let requests = request_rows(&mut c).await;
    if !requests.is_empty() {
        failures.push(format!("friend requests: expected none, got {requests:?}"));
    }
    report(&failures);
}

/// A decline is durable (C1): after ANN declines BEN's request, BEN's link answers `requested` on the GET and the
/// POST, before and after the send, and creates nothing.
#[tokio::test]
async fn decline_is_durable_against_old_code() {
    let (st, _db) = social_state(&[ANN, BEN]).await;
    let mut c = common::raw_db(&st).await;
    let code_a = invite_code(&st, ANN).await;
    let mut failures = Vec::new();
    failures.extend(state_is(
        "BEN's send",
        &ask(&st, BEN, &code_a).await,
        "requested",
    ));
    let handle_b = handle_of(&mut c, BEN).await.unwrap();
    failures.extend(list_is(
        "ANN declines",
        &remove(&st, ANN, &handle_b).await,
        "requests",
        &[],
    ));
    failures.extend(state_is(
        "BEN's GET before the second send",
        &view_invite(&st, BEN, &code_a).await,
        "requested",
    ));
    failures.extend(state_is(
        "BEN's second send",
        &ask(&st, BEN, &code_a).await,
        "requested",
    ));
    failures.extend(state_is(
        "BEN's GET after the second send",
        &view_invite(&st, BEN, &code_a).await,
        "requested",
    ));
    let (reply, _) = social(&st, ANN).await;
    failures.extend(list_is("ANN's requests", &reply, "requests", &[]));
    let requests = request_rows(&mut c).await;
    if !requests.is_empty() {
        failures.push(format!("friend requests: expected none, got {requests:?}"));
    }
    let blocks = block_rows(&mut c).await;
    if blocks != [(ANN, BEN)] {
        failures.push(format!("blocks: expected [(ANN, BEN)], got {blocks:?}"));
    }
    let rows = friendship_rows(&mut c).await;
    if !rows.is_empty() {
        failures.push(format!("friendships: expected none, got {rows:?}"));
    }
    report(&failures);
}

/// Only the remover lifts a block, by their own act (M10): ANN removed BEN, then asks through BEN's code. ANN's block
/// is gone and BEN sees ANN's request.
#[tokio::test]
async fn blocker_request_lifts_own_block() {
    let (st, _db) = social_state(&[ANN, BEN]).await;
    let mut c = common::raw_db(&st).await;
    let (_, handle_a, handle_b) = befriend(&st, &mut c, ANN, BEN).await;
    let mut failures = Vec::new();
    failures.extend(list_is(
        "ANN removes BEN",
        &remove(&st, ANN, &handle_b).await,
        "friends",
        &[],
    ));
    let code_b = invite_code(&st, BEN).await;
    failures.extend(state_is(
        "ANN asks BEN",
        &ask(&st, ANN, &code_b).await,
        "requested",
    ));
    let blocks = block_rows(&mut c).await;
    if !blocks.is_empty() {
        failures.push(format!(
            "blocks after ANN's own ask: expected none, got {blocks:?}"
        ));
    }
    let (reply, _) = social(&st, BEN).await;
    failures.extend(list_is(
        "BEN's requests",
        &reply,
        "requests",
        &[person(&handle_a, "Ann")],
    ));
    report(&failures);
}

/// Seeds `n` users at ids `first..first + n` and a friendship of each with `user`, stored low id first.
async fn seed_friends(c: &mut PgConnection, user: i64, first: i64, n: i64) {
    let last = first + n - 1;
    sqlx::query(
        "INSERT INTO users (id, first_name, language_code, created_at, last_seen_at) \
         SELECT g, 'Pal', NULL, $3, $3 FROM generate_series($1::bigint, $2::bigint) g",
    )
    .bind(first)
    .bind(last)
    .bind(T0)
    .execute(&mut *c)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO friendships (user_lo, user_hi, created_at) \
         SELECT LEAST(g, $3), GREATEST(g, $3), $4 FROM generate_series($1::bigint, $2::bigint) g",
    )
    .bind(first)
    .bind(last)
    .bind(user)
    .bind(T0)
    .execute(&mut *c)
    .await
    .unwrap();
}

/// 200 friends per user (MV15), counted on either side of the stored pair: an accept with either user at 200 is 409
/// `limit_reached` and keeps the request; at 199 it succeeds.
#[tokio::test]
async fn friend_cap_409() {
    let (st, _db) = social_state(&[ANN, BEN, CAT, DAN]).await;
    let mut c = common::raw_db(&st).await;
    // ANN at 200: 100 friends below her id (ANN stored as hi), 100 above (ANN stored as lo). The same for BEN.
    seed_friends(&mut c, ANN, 1_000_000_001, 100).await;
    seed_friends(&mut c, ANN, 7_000_000_001, 100).await;
    seed_friends(&mut c, BEN, 1_100_000_001, 100).await;
    seed_friends(&mut c, BEN, 7_100_000_001, 100).await;
    let code_a = invite_code(&st, ANN).await;
    let code_d = invite_code(&st, DAN).await;
    let mut failures = Vec::new();
    failures.extend(state_is(
        "CAT asks ANN",
        &ask(&st, CAT, &code_a).await,
        "requested",
    ));
    failures.extend(state_is(
        "BEN asks DAN",
        &ask(&st, BEN, &code_d).await,
        "requested",
    ));
    let handle_c = handle_of(&mut c, CAT).await.unwrap();
    let handle_b = handle_of(&mut c, BEN).await.unwrap();
    let limit = r#"{"error":"limit_reached"}"#;
    for (case, reply) in [
        (
            "ANN (at 200) accepts CAT",
            accept(&st, ANN, &handle_c).await,
        ),
        (
            "DAN accepts BEN (at 200)",
            accept(&st, DAN, &handle_b).await,
        ),
    ] {
        let body = body_text(&reply);
        if reply.status != StatusCode::CONFLICT || body != limit {
            failures.push(format!(
                "{case}: expected 409 {limit}, got {} {body}",
                reply.status.as_u16()
            ));
        }
    }
    let requests = request_rows(&mut c).await;
    if requests != [(BEN, DAN), (CAT, ANN)] {
        failures.push(format!(
            "requests after the 409s: expected [(BEN, DAN), (CAT, ANN)], got {requests:?}"
        ));
    }
    sqlx::query("DELETE FROM friendships WHERE user_lo = $1 AND user_hi = $2")
        .bind(1_000_000_001_i64)
        .bind(ANN)
        .execute(&mut c)
        .await
        .unwrap();
    let reply = accept(&st, ANN, &handle_c).await;
    if reply.status != StatusCode::OK {
        failures.push(format!(
            "ANN (at 199) accepts CAT: expected 200, got {} {}",
            reply.status.as_u16(),
            body_text(&reply)
        ));
    }
    report(&failures);
}

/// A removal from the requester's side ends the friendship for both, writes the remover's block, and a repeat is 404.
#[tokio::test]
async fn remove_friend_ends_both_sides() {
    let (st, _db) = social_state(&[ANN, BEN]).await;
    let mut c = common::raw_db(&st).await;
    let (_, handle_a, _) = befriend(&st, &mut c, ANN, BEN).await;
    let mut failures = Vec::new();
    failures.extend(list_is(
        "BEN removes ANN",
        &remove(&st, BEN, &handle_a).await,
        "friends",
        &[],
    ));
    let (reply, _) = social(&st, ANN).await;
    failures.extend(list_is("ANN's friends", &reply, "friends", &[]));
    failures.extend(not_found(
        "BEN removes ANN again",
        &remove(&st, BEN, &handle_a).await,
    ));
    let rows = friendship_rows(&mut c).await;
    if !rows.is_empty() {
        failures.push(format!("friendships: expected none, got {rows:?}"));
    }
    let blocks = block_rows(&mut c).await;
    if blocks != [(BEN, ANN)] {
        failures.push(format!("blocks: expected [(BEN, ANN)], got {blocks:?}"));
    }
    report(&failures);
}

/// `None` when `reply` is a 200 with `Cache-Control: private, no-store`, else the failure line.
fn private_no_store(case: &str, reply: &common::Reply) -> Option<String> {
    let cache = reply
        .headers
        .get(axum::http::header::CACHE_CONTROL)
        .map(|v| v.to_str().unwrap_or("<not text>"));
    (reply.status != StatusCode::OK || cache != Some("private, no-store")).then(|| {
        format!(
            "{case}: expected 200 private, no-store, got {} {cache:?} {}",
            reply.status.as_u16(),
            body_text(reply)
        )
    })
}

/// Every social route needs the token (401 without one), and every 200 is `private, no-store`: one user's own view.
#[tokio::test]
async fn social_private_no_store() {
    let (st, _db) = social_state(&[ANN, BEN]).await;
    let mut c = common::raw_db(&st).await;
    let mut failures = Vec::new();
    let reply = send(&st, Method::GET, Some(ANN), "/api/social").await;
    failures.extend(private_no_store("GET /api/social", &reply));
    let code_a = body_json(&reply)["inviteCode"]
        .as_str()
        .unwrap_or_default()
        .to_owned();
    failures.extend(private_no_store(
        "GET /api/invites/{code}",
        &view_invite(&st, BEN, &code_a).await,
    ));
    failures.extend(private_no_store(
        "POST /api/invites/{code}/request",
        &ask(&st, BEN, &code_a).await,
    ));
    let handle_b = handle_of(&mut c, BEN).await.unwrap_or_default();
    failures.extend(private_no_store(
        "POST /api/friends/requests/{handle}/accept",
        &accept(&st, ANN, &handle_b).await,
    ));
    failures.extend(private_no_store(
        "DELETE /api/friends/{handle}",
        &remove(&st, ANN, &handle_b).await,
    ));
    failures.extend(private_no_store(
        "POST /api/invite/rotate",
        &rotate(&st, ANN).await,
    ));
    failures.extend(private_no_store(
        "PUT /api/consents/friends_profile",
        &put_consent(&st, ANN, &consent_body(true, "friends_profile.v1")).await,
    ));
    for (method, path) in [
        (Method::GET, "/api/social".to_owned()),
        (Method::POST, "/api/invite/rotate".to_owned()),
        (Method::PUT, "/api/consents/friends_profile".to_owned()),
        (Method::GET, format!("/api/invites/{CODE_A}")),
        (Method::POST, format!("/api/invites/{CODE_A}/request")),
        (
            Method::POST,
            format!("/api/friends/requests/{HANDLE_A}/accept"),
        ),
        (Method::DELETE, format!("/api/friends/{HANDLE_A}")),
    ] {
        let reply = send(&st, method.clone(), None, &path).await;
        let body = body_text(&reply);
        if reply.status != StatusCode::UNAUTHORIZED || body != r#"{"error":"token_missing"}"# {
            failures.push(format!(
                "{method} {path} without a token: expected 401 token_missing, got {} {body}",
                reply.status.as_u16()
            ));
        }
    }
    report(&failures);
}

/// A malformed code or handle is 400 on every route that takes one (it never reaches SQL, so U+0000 is no 500); a
/// well-shaped unknown one is 404, and so is one's own handle (no request or friendship with oneself).
#[tokio::test]
async fn social_malformed_ids_400_unknown_404() {
    let (st, _db) = social_state(&[ANN, BEN]).await;
    let mut c = common::raw_db(&st).await;
    handle(&mut c, ANN, HANDLE_A).await.unwrap();
    let mut failures = Vec::new();
    let bad = r#"{"error":"bad_request"}"#;
    let bad_codes = [
        CODE_A.to_uppercase(),
        CODE_A[1..].to_owned(),
        format!("{CODE_A}0"),
        format!("%00{}", &CODE_A[1..]),
        "g".repeat(32),
    ];
    let bad_handles = [
        HANDLE_A.to_uppercase(),
        HANDLE_A[1..].to_owned(),
        format!("{HANDLE_A}0"),
        format!("%00{}", &HANDLE_A[1..]),
    ];
    let mut cases: Vec<(String, common::Reply)> = Vec::new();
    for code in &bad_codes {
        cases.push((
            format!("GET invite {code:?}"),
            view_invite(&st, BEN, code).await,
        ));
        cases.push((format!("POST invite {code:?}"), ask(&st, BEN, code).await));
    }
    for h in &bad_handles {
        cases.push((format!("accept {h:?}"), accept(&st, BEN, h).await));
        cases.push((format!("DELETE {h:?}"), remove(&st, BEN, h).await));
    }
    for (case, reply) in &cases {
        let body = body_text(reply);
        if reply.status != StatusCode::BAD_REQUEST || body != bad {
            failures.push(format!(
                "{case}: expected 400 {bad}, got {} {body}",
                reply.status.as_u16()
            ));
        }
    }
    let unknown_code = "00000000000000000000000000000000";
    let unknown_handle = "000000000000000000000000";
    failures.extend(not_found(
        "GET an unknown code",
        &view_invite(&st, BEN, unknown_code).await,
    ));
    failures.extend(not_found(
        "POST an unknown code",
        &ask(&st, BEN, unknown_code).await,
    ));
    failures.extend(not_found(
        "accept an unknown handle",
        &accept(&st, BEN, unknown_handle).await,
    ));
    failures.extend(not_found(
        "DELETE an unknown handle",
        &remove(&st, BEN, unknown_handle).await,
    ));
    failures.extend(not_found(
        "accept a stranger's handle",
        &accept(&st, BEN, HANDLE_A).await,
    ));
    failures.extend(not_found(
        "DELETE a stranger's handle",
        &remove(&st, BEN, HANDLE_A).await,
    ));
    failures.extend(not_found(
        "accept one's own handle",
        &accept(&st, ANN, HANDLE_A).await,
    ));
    failures.extend(not_found(
        "DELETE one's own handle",
        &remove(&st, ANN, HANDLE_A).await,
    ));
    let blocks = block_rows(&mut c).await;
    if !blocks.is_empty() {
        failures.push(format!("blocks: expected none, got {blocks:?}"));
    }
    report(&failures);
}

/// Two first opens of Friends at once (two devices of one user) create one code: a stand-in holds an uncommitted
/// active code of ANN; ANN's first `GET /api/social` is observed waiting on the partial unique index, then reads the
/// stand-in's code. One active code; no 500.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn social_code_created_once_concurrently() {
    let (st, _db) = social_state(&[ANN]).await;
    let mut c = common::raw_db(&st).await;
    let mut stand_in = common::raw_db(&st).await;
    begin(&mut stand_in).await;
    code(&mut stand_in, CODE_A, ANN, None).await.unwrap();
    let app = st.clone();
    let mut opening = tokio::spawn(async move { social(&app, ANN).await });
    let early = tokio::select! {
        biased;
        reply = &mut opening => Some(reply.unwrap()),
        () = common::wait_for_lock_waiter(&st) => None,
    };
    let mut failures = Vec::new();
    if early.is_some() {
        failures.push(
            "the first GET never waited: it answered while the stand-in's code was uncommitted"
                .to_owned(),
        );
    }
    commit(&mut stand_in).await;
    stand_in.close().await.unwrap();
    let (reply, json) = match early {
        Some(got) => got,
        None => opening.await.unwrap(),
    };
    if reply.status != StatusCode::OK || json["inviteCode"] != CODE_A {
        failures.push(format!(
            "ANN's first GET: expected 200 with inviteCode {CODE_A}, got {} {}",
            reply.status.as_u16(),
            body_text(&reply)
        ));
    }
    let active: Vec<String> = sqlx::query_scalar(
        "SELECT code FROM invite_codes WHERE user_id = $1 AND revoked_at IS NULL",
    )
    .bind(ANN)
    .fetch_all(&mut c)
    .await
    .unwrap();
    if active != [CODE_A] {
        failures.push(format!(
            "active codes of ANN: expected [{CODE_A}], got {active:?}"
        ));
    }
    report(&failures);
}

/// `are_friends` (the read LF2's profile and LE2's gifts build on) sees a friendship from either side, and nothing
/// else: not a stranger, not oneself.
#[tokio::test]
async fn are_friends_either_order() {
    let (st, _db) = social_state(&[ANN, BEN, CAT]).await;
    let mut c = common::raw_db(&st).await;
    friendship(&mut c, ANN, BEN).await.unwrap();
    let mut failures = Vec::new();
    for (case, a, b, want) in [
        ("ANN, BEN", ANN, BEN, true),
        ("BEN, ANN", BEN, ANN, true),
        ("ANN, CAT", ANN, CAT, false),
        ("CAT, BEN", CAT, BEN, false),
        ("ANN, ANN", ANN, ANN, false),
    ] {
        let got = st.repo.are_friends(UserId(a), UserId(b)).await.unwrap();
        if got != want {
            failures.push(format!("are_friends({case}): expected {want}, got {got}"));
        }
    }
    report(&failures);
}

/// The policy file as the test reads it, compiled in independently of `api/legal.rs`.
const POLICY_FILE: &str = include_str!("../../legal/privacy-policy.html");

/// The content of the file's `<meta name="policy-version">`, parsed here, not by the server.
fn file_policy_version() -> &'static str {
    POLICY_FILE
        .split_once(r#"<meta name="policy-version" content=""#)
        .and_then(|(_, rest)| rest.split_once('"'))
        .map_or("<no policy-version meta>", |(version, _)| version)
}

/// `^[0-9]{4}-[0-9]{2}-[0-9]{2}[a-z]?$`, the `consents_policy_version_shape` CHECK.
fn version_shaped(v: &str) -> bool {
    let chars: Vec<char> = v.chars().collect();
    let digit = |i: usize| chars.get(i).is_some_and(char::is_ascii_digit);
    let date = (0..10).all(|i| {
        if i == 4 || i == 7 {
            chars.get(i) == Some(&'-')
        } else {
            digit(i)
        }
    });
    date && (chars.len() == 10 || (chars.len() == 11 && chars[10].is_ascii_lowercase()))
}

/// `GET /api/privacy` (M26): the compiled template byte for byte, as `text/html; charset=utf-8`, publicly cacheable
/// for five minutes (never the router's `no-store`), under the CSP; its version meta has the consent row's shape and
/// is what `policy_version()` reports.
#[tokio::test]
async fn privacy_page_served_with_version() {
    let (st, _db) = social_state(&[]).await;
    let reply = send(&st, Method::GET, None, "/api/privacy").await;
    let mut failures = Vec::new();
    if reply.status != StatusCode::OK {
        failures.push(format!(
            "status: expected 200, got {}",
            reply.status.as_u16()
        ));
    }
    for (name, want) in [
        (CONTENT_TYPE, "text/html; charset=utf-8"),
        (axum::http::header::CACHE_CONTROL, "public, max-age=300"),
        (
            axum::http::header::CONTENT_SECURITY_POLICY,
            "default-src 'none'; style-src 'unsafe-inline'",
        ),
    ] {
        let got = reply
            .headers
            .get(&name)
            .map(|v| v.to_str().unwrap_or("<not text>"));
        if got != Some(want) {
            failures.push(format!("{name}: expected {want:?}, got {got:?}"));
        }
    }
    if reply.body.as_ref() != POLICY_FILE.as_bytes() {
        failures.push(format!(
            "body: expected the policy file's {} bytes, got {} bytes",
            POLICY_FILE.len(),
            reply.body.len()
        ));
    }
    let version = file_policy_version();
    if !version_shaped(version) {
        failures.push(format!(
            "the file's policy-version {version:?}: expected YYYY-MM-DD[a-z]"
        ));
    }
    let compiled = server::api::legal::policy_version();
    if compiled != version {
        failures.push(format!(
            "policy_version(): expected the file's {version:?}, got {compiled:?}"
        ));
    }
    report(&failures);
}

/// The policy is public: no `Authorization`, and a garbage one, both get the page.
#[tokio::test]
async fn privacy_page_needs_no_token() {
    let (st, _db) = social_state(&[]).await;
    let mut failures = Vec::new();
    let without = send(&st, Method::GET, None, "/api/privacy").await;
    let garbage = common::call(
        &st,
        Request::get("/api/privacy")
            .header(AUTHORIZATION, "Bearer garbage")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    for (case, reply) in [("no Authorization", without), ("a garbage token", garbage)] {
        if reply.status != StatusCode::OK || reply.body.as_ref() != POLICY_FILE.as_bytes() {
            failures.push(format!(
                "{case}: expected 200 with the policy, got {} ({} bytes)",
                reply.status.as_u16(),
                reply.body.len()
            ));
        }
    }
    report(&failures);
}

/// `method path` with the JSON `body` (when given), as `user` with a token issued at `at`, through `st`'s router.
async fn send_at(
    st: &AppState,
    method: Method,
    user: i64,
    path: &str,
    body: Option<&Value>,
    at: i64,
) -> common::Reply {
    let (token, _) = issue_token(&st.keys.token, UserId(user), at, st.cfg.token_ttl_secs);
    let req = Request::builder()
        .method(method)
        .uri(path)
        .header(AUTHORIZATION, format!("Bearer {token}"));
    let req = match body {
        Some(body) => req
            .header(CONTENT_TYPE, "application/json")
            .body(Body::from(body.to_string())),
        None => req.body(Body::empty()),
    };
    common::call(st, req.unwrap()).await
}

/// `POST /api/invite/rotate` as `user` at `T0`.
async fn rotate(st: &AppState, user: i64) -> common::Reply {
    send_at(st, Method::POST, user, "/api/invite/rotate", None, T0).await
}

/// `PUT /api/consents/friends_profile` as `user` at `T0` with `body`.
async fn put_consent(st: &AppState, user: i64, body: &Value) -> common::Reply {
    send_at(
        st,
        Method::PUT,
        user,
        "/api/consents/friends_profile",
        Some(body),
        T0,
    )
    .await
}

/// A `ConsentRequest` body.
fn consent_body(granted: bool, text_version: &str) -> Value {
    json!({ "granted": granted, "textVersion": text_version })
}

/// A consent row: (purpose, granted, policy_version, text_version, at).
type ConsentRow = (String, bool, String, String, i64);

/// `user`'s consent rows, oldest first.
async fn consent_rows(c: &mut PgConnection, user: i64) -> Vec<ConsentRow> {
    sqlx::query_as(
        "SELECT purpose, granted, policy_version, text_version, at FROM consents WHERE user_id = $1 ORDER BY id",
    )
    .bind(user)
    .fetch_all(&mut *c)
    .await
    .unwrap()
}

/// The consent log records the compiled policy's version (M12, M26), never a client value, with the named text; the
/// profile is private until then. An unknown text version, or a body without `textVersion`, is 400 and writes nothing.
#[tokio::test]
async fn consent_records_policy_version() {
    let (st, _db) = social_state(&[ANN]).await;
    let mut c = common::raw_db(&st).await;
    let mut failures = Vec::new();
    let (_, before) = social(&st, ANN).await;
    if before["profileVisible"] != false {
        failures.push(format!(
            "before any consent: expected profileVisible false, got {before}"
        ));
    }
    let bad = r#"{"error":"bad_request"}"#;
    for (case, body) in [
        (
            "unknown text version",
            consent_body(true, "friends_profile.v2"),
        ),
        ("no textVersion", json!({ "granted": true })),
        (
            "snake_case text_version",
            json!({ "granted": true, "text_version": "friends_profile.v1" }),
        ),
        (
            "a client-sent policy version only",
            json!({ "granted": true, "policyVersion": "2099-01-01" }),
        ),
    ] {
        let reply = put_consent(&st, ANN, &body).await;
        let text = body_text(&reply);
        if reply.status != StatusCode::BAD_REQUEST || text != bad {
            failures.push(format!(
                "{case}: expected 400 {bad}, got {} {text}",
                reply.status.as_u16()
            ));
        }
    }
    if !consent_rows(&mut c, ANN).await.is_empty() {
        failures.push("rows after the 400s: expected none".to_owned());
    }
    let reply = put_consent(
        &st,
        ANN,
        &json!({ "granted": true, "textVersion": "friends_profile.v1", "policyVersion": "2099-01-01" }),
    )
    .await;
    let json = body_json(&reply);
    if reply.status != StatusCode::OK || json["profileVisible"] != true {
        failures.push(format!(
            "consent on: expected 200 with profileVisible true, got {} {}",
            reply.status.as_u16(),
            body_text(&reply)
        ));
    }
    let want: Vec<ConsentRow> = vec![(
        "friends_profile".to_owned(),
        true,
        file_policy_version().to_owned(),
        "friends_profile.v1".to_owned(),
        T0,
    )];
    let rows = consent_rows(&mut c, ANN).await;
    if rows != want {
        failures.push(format!("consent rows: expected {want:?}, got {rows:?}"));
    }
    report(&failures);
}

/// Each toggle appends a row and the latest decides (M12: as easy to withdraw as to give): on, off, on.
#[tokio::test]
async fn consent_latest_row_wins() {
    let (st, _db) = social_state(&[ANN]).await;
    let mut c = common::raw_db(&st).await;
    let mut failures = Vec::new();
    for granted in [true, false, true] {
        let reply = put_consent(&st, ANN, &consent_body(granted, "friends_profile.v1")).await;
        let got = body_json(&reply)["profileVisible"].clone();
        if reply.status != StatusCode::OK || got != granted {
            failures.push(format!(
                "consent {granted}: expected 200 with profileVisible {granted}, got {} {}",
                reply.status.as_u16(),
                body_text(&reply)
            ));
        }
        let (_, view) = social(&st, ANN).await;
        if view["profileVisible"] != granted {
            failures.push(format!(
                "GET /api/social after {granted}: expected {granted}, got {view}"
            ));
        }
    }
    let granted: Vec<bool> = consent_rows(&mut c, ANN)
        .await
        .into_iter()
        .map(|row| row.1)
        .collect();
    if granted != [true, false, true] {
        failures.push(format!(
            "rows: expected [true, false, true], got {granted:?}"
        ));
    }
    report(&failures);
}

/// 10 rotations per rolling day (MV15): each revokes the old code (its link answers 404) and issues a new one; the 11th
/// is 429 `rate_limited` with `Retry-After` until the oldest rotation leaves the window (86400 at once, 82800 an hour
/// later) and keeps the active code; a day after the first rotation one is allowed again.
#[tokio::test]
async fn rotate_invite_code_limited() {
    let (st, _db) = social_state(&[ANN, BEN]).await;
    let mut failures = Vec::new();
    let mut active = invite_code(&st, ANN).await;
    for i in 1..=10 {
        let reply = rotate(&st, ANN).await;
        let code = body_json(&reply)["inviteCode"]
            .as_str()
            .unwrap_or_default()
            .to_owned();
        if reply.status != StatusCode::OK || code.is_empty() || code == active {
            failures.push(format!(
                "rotation {i}: expected 200 with a new inviteCode, got {} {}",
                reply.status.as_u16(),
                body_text(&reply)
            ));
        }
        failures.extend(not_found(
            &format!("the code before rotation {i}"),
            &view_invite(&st, BEN, &active).await,
        ));
        active = code;
    }
    let limited = r#"{"error":"rate_limited"}"#;
    for (case, at, retry_after) in [
        ("the 11th at T0", T0, "86400"),
        ("the 11th at T0 + 3600", T0 + 3600, "82800"),
    ] {
        let later = st.clone().with_clock(Arc::new(FixedClock(at)));
        let reply = send_at(&later, Method::POST, ANN, "/api/invite/rotate", None, at).await;
        let body = body_text(&reply);
        let retry = reply
            .headers
            .get(axum::http::header::RETRY_AFTER)
            .map(|v| v.to_str().unwrap_or("<not text>"));
        if reply.status != StatusCode::TOO_MANY_REQUESTS
            || body != limited
            || retry != Some(retry_after)
        {
            failures.push(format!(
                "{case}: expected 429 {limited} with Retry-After {retry_after}, got {} {body} {retry:?}",
                reply.status.as_u16()
            ));
        }
    }
    let (_, view) = social(&st, ANN).await;
    if view["inviteCode"] != active.as_str() {
        failures.push(format!(
            "after the 429s: expected the active code {active}, got {view}"
        ));
    }
    failures.extend(state_is(
        "the active code after the 429s",
        &view_invite(&st, BEN, &active).await,
        "open",
    ));
    let next_day = T0 + 86_400;
    let later = st.clone().with_clock(Arc::new(FixedClock(next_day)));
    let reply = send_at(
        &later,
        Method::POST,
        ANN,
        "/api/invite/rotate",
        None,
        next_day,
    )
    .await;
    let code = body_json(&reply)["inviteCode"]
        .as_str()
        .unwrap_or_default()
        .to_owned();
    if reply.status != StatusCode::OK || code == active {
        failures.push(format!(
            "a day later: expected 200 with a new inviteCode, got {} {}",
            reply.status.as_u16(),
            body_text(&reply)
        ));
    }
    report(&failures);
}
