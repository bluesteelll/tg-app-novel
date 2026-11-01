-- The resource economy (META-PLAN M17-M21). Same dialect as 0001-0003: every integer is BIGINT (Rust i64), times are
-- unix seconds, every constraint is named (tests assert (SQLSTATE, constraint)).
-- Every change is one ledger row (its idem_key the idempotency arbiter) and one balance statement, in the caller's
-- transaction (db/economy.rs). Kind membership in the catalog's economy section is checked in code: the catalog
-- changes with deploys, and old rows stay valid history.
CREATE TABLE resource_balances (
  user_id    BIGINT NOT NULL,
  kind       TEXT   NOT NULL,                   -- a catalog kind; membership checked in code (the catalog changes)
  balance    BIGINT NOT NULL,
  debt       BIGINT NOT NULL,                   -- the refund shortfall (M20); credits pay it first
  updated_at BIGINT NOT NULL,
  CONSTRAINT resource_balances_pkey            PRIMARY KEY (user_id, kind),
  CONSTRAINT resource_balances_user_fk         FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT resource_balances_kind_shape      CHECK (kind ~ '^[a-z][a-z0-9_]{0,15}$'),
  CONSTRAINT resource_balances_balance_nonneg  CHECK (balance >= 0),
  CONSTRAINT resource_balances_debt_nonneg     CHECK (debt >= 0),
  CONSTRAINT resource_balances_balance_or_debt CHECK (balance = 0 OR debt = 0)
);
CREATE TABLE resource_ledger (                  -- append-only; per (user, kind): balance - debt = SUM(amount)
  id             BIGINT GENERATED ALWAYS AS IDENTITY,
  user_id        BIGINT NOT NULL,
  kind           TEXT   NOT NULL,
  amount         BIGINT NOT NULL,               -- signed: a credit > 0, a debit or clawback < 0
  reason         TEXT   NOT NULL,
  idem_key       TEXT   NOT NULL,               -- the idempotency arbiter (M18 key forms)
  charge_id      TEXT,                          -- pack, pack_refund
  counterpart_id BIGINT,                        -- gift_*, referral_*; set NULL by a counterpart's erasure (Later)
  ref            TEXT,                          -- pack: the product id; hint_spend: '<puzzleId>:<tier>'
  created_at     BIGINT NOT NULL,
  CONSTRAINT resource_ledger_pkey             PRIMARY KEY (id),
  CONSTRAINT resource_ledger_user_fk          FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT resource_ledger_charge_fk        FOREIGN KEY (charge_id) REFERENCES payments (telegram_payment_charge_id),
  CONSTRAINT resource_ledger_counterpart_fk   FOREIGN KEY (counterpart_id) REFERENCES users (id),
  CONSTRAINT resource_ledger_idem_key         UNIQUE (idem_key),
  CONSTRAINT resource_ledger_kind_shape       CHECK (kind ~ '^[a-z][a-z0-9_]{0,15}$'),
  CONSTRAINT resource_ledger_reason_known     CHECK (reason IN ('pack', 'pack_refund', 'hint_spend', 'gift_out',
                                                                'gift_in', 'referral_inviter', 'referral_invitee')),
  CONSTRAINT resource_ledger_sign_by_reason   CHECK (
       (reason IN ('pack', 'gift_in', 'referral_inviter', 'referral_invitee') AND amount > 0)
    OR (reason IN ('pack_refund', 'hint_spend', 'gift_out') AND amount < 0)),
  CONSTRAINT resource_ledger_amount_bounded   CHECK (amount BETWEEN -1000 AND 1000),
  CONSTRAINT resource_ledger_charge_by_reason CHECK ((reason IN ('pack', 'pack_refund')) = (charge_id IS NOT NULL)),
  CONSTRAINT resource_ledger_time_positive    CHECK (created_at > 0)
);
CREATE INDEX resource_ledger_by_user        ON resource_ledger (user_id, reason, created_at);   -- the caps; FK index
CREATE INDEX resource_ledger_by_charge      ON resource_ledger (charge_id) WHERE charge_id IS NOT NULL;
CREATE INDEX resource_ledger_by_counterpart ON resource_ledger (counterpart_id) WHERE counterpart_id IS NOT NULL;
-- Revision 1 (W3): a pack order carries the kind and amount it was invoiced with; the grant credits exactly these.
ALTER TABLE orders
  ADD COLUMN pack_kind   TEXT,                  -- NULL for a chapter order
  ADD COLUMN pack_amount BIGINT,                -- resource units, not Stars; NULL for a chapter order
  ADD CONSTRAINT orders_pack_binding CHECK (
        ((product_id LIKE 'pack:%') = (pack_kind IS NOT NULL))
    AND ((pack_kind IS NULL) = (pack_amount IS NULL))
    AND (pack_kind IS NULL OR (pack_kind ~ '^[a-z][a-z0-9_]{0,15}$' AND pack_amount BETWEEN 1 AND 1000)));
