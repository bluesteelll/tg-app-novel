//! The social graph (META-PLAN M10-M12, M15; `0005_social.sql`): the schema's named constraints on raw SQL, the
//! users upsert's inserted flag, and the attribution at `POST /api/auth` (M11) through the production router.
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
use axum::http::header::CONTENT_TYPE;
use axum::http::{Request, StatusCode};
use hmac::{Hmac, KeyInit, Mac};
use serde_json::{Value, json};
use server::AppState;
use server::auth::{data_check_string, secret_key};
use server::clock::FixedClock;
use server::ids::UserId;
use sha2::Sha256;
use sqlx::PgConnection;
use sqlx::postgres::PgQueryResult;

use crate::catalog::T0;
use crate::common;

/// The first player: the lowest id, so every two-row lock takes ANN's row first.
const ANN: i64 = 5_000_000_001;
/// The second player.
const BEN: i64 = 5_000_000_002;
/// The third player.
const CAT: i64 = 5_000_000_003;
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
