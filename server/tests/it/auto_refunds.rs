//! The automatic refund of an unapplied charge (owner Q9): its schema (`server/migrations/0007_auto_refunds.sql`)
//! exercised with raw SQL on a connection of its own.

use sqlx::PgConnection;
use sqlx::postgres::PgQueryResult;

use crate::common;

type Res = Result<PgQueryResult, sqlx::Error>;

fn report(failures: &[String]) {
    assert!(
        failures.is_empty(),
        "{} failures:\n{}",
        failures.len(),
        failures.join("\n")
    );
}

/// The mismatch of `res` against a database error with SQLSTATE `want.0` on the constraint named `want.1`. Never the
/// message text: the server's locale decides it.
fn expect_err(case: &str, res: Res, want: (&str, &str)) -> Option<String> {
    let (code, constraint) = want;
    match res {
        Err(sqlx::Error::Database(e))
            if e.code().as_deref() == Some(code) && e.constraint() == Some(constraint) =>
        {
            None
        }
        Err(sqlx::Error::Database(e)) => Some(format!(
            "case {case}: expected ({code}, {constraint}), got ({}, {}) {e}",
            e.code().as_deref().unwrap_or("no code"),
            e.constraint().unwrap_or("no constraint")
        )),
        Err(e) => Some(format!(
            "case {case}: expected ({code}, {constraint}), got {e}"
        )),
        Ok(_) => Some(format!(
            "case {case}: expected ({code}, {constraint}), got Ok"
        )),
    }
}

/// The mismatch of a control insert against `Ok`.
fn expect_ok(case: &str, res: Res) -> Option<String> {
    res.err()
        .map(|e| format!("case {case} (control): expected Ok, got {e}"))
}

/// A payments row of user 1 for 1 XTR, paid at 0.
async fn payment(c: &mut PgConnection, charge: &str) -> Res {
    sqlx::query(
        "INSERT INTO payments (telegram_payment_charge_id, invoice_payload, user_id, amount, currency, \
         provider_payment_charge_id, paid_at) VALUES ($1, 'payload', 1, 1, 'XTR', '', 0)",
    )
    .bind(charge)
    .execute(&mut *c)
    .await
}

/// An `auto_refunds` row of `charge`, created and due at 0.
async fn work_row(
    c: &mut PgConnection,
    charge: &str,
    attempts: i64,
    refusals: i64,
    last_error: Option<&str>,
) -> Res {
    sqlx::query(
        "INSERT INTO auto_refunds (charge_id, created_at, attempts, refusals, due_at, last_error) \
         VALUES ($1, 0, $2, $3, 0, $4)",
    )
    .bind(charge)
    .bind(attempts)
    .bind(refusals)
    .bind(last_error)
    .execute(&mut *c)
    .await
}

/// An `unrecorded_refunds` row of `charge` refunded to `user`.
async fn unrecorded_row(c: &mut PgConnection, charge: &str, user: i64) -> Res {
    sqlx::query(
        "INSERT INTO unrecorded_refunds (charge_id, user_id, admin_id, refunded_at) VALUES ($1, $2, 9, 0)",
    )
    .bind(charge)
    .bind(user)
    .execute(&mut *c)
    .await
}

/// `0007`'s named constraints, each case violating exactly one beside a control insert that must succeed on the same
/// parent rows: an `auto_refunds` row needs its payment (`auto_refunds_charge_fk`), one per charge
/// (`auto_refunds_pkey`), non-negative attempts (`auto_refunds_attempts_nonneg`, which PostgreSQL tests before the
/// refusals check, by name), at most as many refusals as attempts and none negative
/// (`auto_refunds_refusals_within_attempts`), and an error only after an attempt (`auto_refunds_error_after_attempt`);
/// an `unrecorded_refunds` row names a positive payer (`unrecorded_refunds_user_positive`), one per charge
/// (`unrecorded_refunds_pkey`).
#[tokio::test]
async fn auto_refund_schema_constraints() {
    let (st, _db) = common::test_state().await;
    let mut c = common::raw_db(&st).await;
    let mut failures = Vec::new();
    for charge in ["c-1", "c-2", "c-3", "c-4", "c-5"] {
        failures.extend(expect_ok(
            &format!("payment {charge}"),
            payment(&mut c, charge).await,
        ));
    }
    failures.extend(expect_ok(
        "a pending row",
        work_row(&mut c, "c-1", 0, 0, None).await,
    ));
    failures.extend(expect_err(
        "a row of an unknown charge",
        work_row(&mut c, "c-nope", 0, 0, None).await,
        ("23503", "auto_refunds_charge_fk"),
    ));
    failures.extend(expect_err(
        "a second row of c-1",
        work_row(&mut c, "c-1", 0, 0, None).await,
        ("23505", "auto_refunds_pkey"),
    ));
    failures.extend(expect_err(
        "attempts -1",
        work_row(&mut c, "c-2", -1, 0, None).await,
        ("23514", "auto_refunds_attempts_nonneg"),
    ));
    failures.extend(expect_err(
        "refusals 2 of 1 attempt",
        work_row(&mut c, "c-2", 1, 2, Some("api: x")).await,
        ("23514", "auto_refunds_refusals_within_attempts"),
    ));
    failures.extend(expect_err(
        "refusals -1",
        work_row(&mut c, "c-2", 1, -1, Some("api: x")).await,
        ("23514", "auto_refunds_refusals_within_attempts"),
    ));
    failures.extend(expect_err(
        "an error before any attempt",
        work_row(&mut c, "c-2", 0, 0, Some("timeout")).await,
        ("23514", "auto_refunds_error_after_attempt"),
    ));
    failures.extend(expect_ok(
        "a failed attempt",
        work_row(&mut c, "c-2", 1, 0, Some("timeout")).await,
    ));
    failures.extend(expect_ok(
        "a refused attempt",
        work_row(&mut c, "c-3", 1, 1, Some("api: x")).await,
    ));
    failures.extend(expect_ok(
        "an unrecorded refund",
        unrecorded_row(&mut c, "c-gone", 1001).await,
    ));
    failures.extend(expect_err(
        "an unrecorded refund to user 0",
        unrecorded_row(&mut c, "c-zero", 0).await,
        ("23514", "unrecorded_refunds_user_positive"),
    ));
    failures.extend(expect_err(
        "a second unrecorded refund of c-gone",
        unrecorded_row(&mut c, "c-gone", 1002).await,
        ("23505", "unrecorded_refunds_pkey"),
    ));
    sqlx::Connection::close(c).await.unwrap();
    report(&failures);
}
