-- PostgreSQL >= 16 (IS JSON); the gates run 18. Every integer is BIGINT (Rust i64); times are unix seconds.
-- Every constraint is named: tests assert (SQLSTATE, constraint name).
CREATE TABLE users (
  id            BIGINT NOT NULL,                -- Telegram user id (from verified initData only), <= 52 bits
  first_name    TEXT   NOT NULL,
  language_code TEXT,
  created_at    BIGINT NOT NULL,
  last_seen_at  BIGINT NOT NULL,
  CONSTRAINT users_pkey PRIMARY KEY (id)
);

CREATE TABLE payments (                         -- money facts: never rejected, never deleted
  telegram_payment_charge_id TEXT   NOT NULL,   -- THE idempotency key (principle 2)
  invoice_payload            TEXT   NOT NULL,   -- not an FK: an unknown payload is still recorded
  user_id                    BIGINT NOT NULL,   -- payer (Message.from.id); no FK: a payment row is never refused
  amount                     BIGINT NOT NULL,
  currency                   TEXT   NOT NULL,   -- recorded as received; grant requires 'XTR' (orders CHECK)
  provider_payment_charge_id TEXT   NOT NULL,   -- '' when Telegram omits it (K17 probe)
  paid_at                    BIGINT NOT NULL,
  refunded_at                BIGINT,
  CONSTRAINT payments_pkey               PRIMARY KEY (telegram_payment_charge_id),
  CONSTRAINT payments_amount_positive    CHECK (amount > 0),
  CONSTRAINT payments_refunded_after_paid CHECK (refunded_at IS NULL OR refunded_at >= paid_at)
);
CREATE INDEX payments_by_user ON payments (user_id);

CREATE TABLE orders (
  id          TEXT   NOT NULL,                  -- OrderId = invoice payload
  user_id     BIGINT NOT NULL,
  product_id  TEXT   NOT NULL,
  amount      BIGINT NOT NULL,                  -- from server/catalog.json at creation, never from the request
  currency    TEXT   NOT NULL,
  status      TEXT   NOT NULL,
  invoice_url TEXT,
  created_at  BIGINT NOT NULL,
  checkout_at BIGINT,
  paid_at     BIGINT,
  charge_id   TEXT,
  CONSTRAINT orders_pkey              PRIMARY KEY (id),
  CONSTRAINT orders_user_fk           FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT orders_charge_key        UNIQUE (charge_id),
  CONSTRAINT orders_charge_fk         FOREIGN KEY (charge_id) REFERENCES payments (telegram_payment_charge_id),
  CONSTRAINT orders_amount_positive   CHECK (amount > 0),
  CONSTRAINT orders_currency_xtr      CHECK (currency = 'XTR'),
  CONSTRAINT orders_status_known      CHECK (status IN ('created', 'checkout', 'paid', 'refunded')),
  CONSTRAINT orders_checkout_has_time CHECK (status <> 'checkout' OR checkout_at IS NOT NULL),
  CONSTRAINT orders_paid_has_charge   CHECK (status NOT IN ('paid', 'refunded')
                                             OR (charge_id IS NOT NULL AND paid_at IS NOT NULL))
);
CREATE INDEX orders_by_user_product ON orders (user_id, product_id, status, created_at);

CREATE TABLE entitlements (                     -- the ONLY unlock fact
  user_id    BIGINT NOT NULL,
  product_id TEXT   NOT NULL,
  charge_id  TEXT   NOT NULL,
  granted_at BIGINT NOT NULL,
  CONSTRAINT entitlements_pkey       PRIMARY KEY (user_id, product_id),  -- one per product; revoke = DELETE
  CONSTRAINT entitlements_user_fk    FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT entitlements_charge_key UNIQUE (charge_id),
  CONSTRAINT entitlements_charge_fk  FOREIGN KEY (charge_id) REFERENCES payments (telegram_payment_charge_id)
);

CREATE TABLE saves (
  user_id       BIGINT NOT NULL,
  slot          TEXT   NOT NULL,
  rev           BIGINT NOT NULL,
  chapter_id    TEXT   NOT NULL,
  story_version TEXT   NOT NULL,
  line_id       TEXT,
  write_id      TEXT   NOT NULL,                -- client idempotency key of the last successful write
  body          TEXT   NOT NULL,                -- opaque JSON, byte-exact: never jsonb (it rewrites the bytes)
  saved_at      BIGINT NOT NULL,
  CONSTRAINT saves_pkey         PRIMARY KEY (user_id, slot),
  CONSTRAINT saves_user_fk      FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT saves_slot_known   CHECK (slot IN ('auto', 's1', 's2', 's3')),
  CONSTRAINT saves_rev_positive CHECK (rev >= 1),
  CONSTRAINT saves_body_json    CHECK (body IS JSON),
  CONSTRAINT saves_body_size    CHECK (octet_length(body) <= 262144)
);
