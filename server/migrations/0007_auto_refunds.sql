-- Refunds the server makes on its own (owner Q9) and refunds of charges this database does not hold (D2). Same dialect
-- as 0001-0006: every integer is BIGINT (Rust i64), times are unix seconds, every constraint is named (tests assert
-- (SQLSTATE, constraint)).
-- auto_refunds holds the work state only. Whether a charge was refunded is its payment's refunded_at, written by the
-- revoke alone, which also clears due_at in its own transaction: due_at IS NOT NULL implies refunded_at IS NULL.
-- Pending: due_at set. Settled: the payment's refunded_at set. Given up: neither (the admins were alerted).
CREATE TABLE auto_refunds (                         -- one per unapplied charge, inserted by its grant (db/payments.rs)
  charge_id  TEXT   NOT NULL,                       -- the payment's telegram_payment_charge_id
  created_at BIGINT NOT NULL,                       -- the grant's receipt time
  attempts   BIGINT NOT NULL,                       -- refundStarPayment attempts claimed
  refusals   BIGINT NOT NULL,                       -- attempts the Bot API refused; only these count toward the bound
  due_at     BIGINT,                                -- the next attempt (an attempt in flight: its lease end);
                                                    -- NULL: settled or given up
  last_error TEXT,                                  -- the last failed attempt's GatewayError text (no request text)
  CONSTRAINT auto_refunds_pkey                     PRIMARY KEY (charge_id),
  CONSTRAINT auto_refunds_charge_fk                FOREIGN KEY (charge_id)
                                                   REFERENCES payments (telegram_payment_charge_id),
  CONSTRAINT auto_refunds_attempts_nonneg          CHECK (attempts >= 0),
  CONSTRAINT auto_refunds_refusals_within_attempts CHECK (refusals >= 0 AND refusals <= attempts),
  CONSTRAINT auto_refunds_error_after_attempt      CHECK (last_error IS NULL OR attempts > 0)
);
CREATE INDEX auto_refunds_due ON auto_refunds (due_at) WHERE due_at IS NOT NULL;   -- the sweep's read

CREATE TABLE unrecorded_refunds (                   -- Stars an admin returned for a charge payments does not hold
  charge_id   TEXT   NOT NULL,                      -- as the admin typed it (a restored backup's charges list)
  user_id     BIGINT NOT NULL,                      -- the payer the admin named; no FK: the users row may be gone too
  admin_id    BIGINT NOT NULL,                      -- who ran /refund
  refunded_at BIGINT NOT NULL,
  CONSTRAINT unrecorded_refunds_pkey          PRIMARY KEY (charge_id),
  CONSTRAINT unrecorded_refunds_user_positive CHECK (user_id > 0)   -- the /refund parser takes a positive id only
);
