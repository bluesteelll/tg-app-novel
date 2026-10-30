CREATE TABLE users (
  id            INTEGER PRIMARY KEY,                    -- Telegram user id (from verified initData only)
  first_name    TEXT    NOT NULL,
  language_code TEXT,
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL
) STRICT;

CREATE TABLE payments (                                 -- money facts: never rejected, never deleted
  telegram_payment_charge_id TEXT    PRIMARY KEY,       -- THE idempotency key (principle 2)
  invoice_payload            TEXT    NOT NULL,          -- not an FK: an unknown payload is still recorded
  user_id                    INTEGER NOT NULL,          -- payer (Message.from.id); no FK: a payment row is never refused
  amount                     INTEGER NOT NULL CHECK (amount > 0),
  currency                   TEXT    NOT NULL,          -- recorded as received; grant requires 'XTR' (orders CHECK)
  provider_payment_charge_id TEXT    NOT NULL,          -- '' when Telegram omits it (K17 probe)
  paid_at                    INTEGER NOT NULL,
  refunded_at                INTEGER,
  CHECK (refunded_at IS NULL OR refunded_at >= paid_at)
) STRICT;
CREATE INDEX payments_by_user ON payments(user_id);

CREATE TABLE orders (
  id           TEXT    PRIMARY KEY,                     -- OrderId = invoice payload
  user_id      INTEGER NOT NULL REFERENCES users(id),
  product_id   TEXT    NOT NULL,
  amount       INTEGER NOT NULL CHECK (amount > 0),     -- from server/catalog.json at creation, never from the request
  currency     TEXT    NOT NULL CHECK (currency = 'XTR'),
  status       TEXT    NOT NULL CHECK (status IN ('created','checkout','paid','refunded')),
  invoice_url  TEXT,
  created_at   INTEGER NOT NULL,
  checkout_at  INTEGER,
  paid_at      INTEGER,
  charge_id    TEXT    UNIQUE REFERENCES payments(telegram_payment_charge_id),
  CHECK (status <> 'checkout' OR checkout_at IS NOT NULL),
  CHECK (status NOT IN ('paid','refunded') OR (charge_id IS NOT NULL AND paid_at IS NOT NULL))
) STRICT;
CREATE INDEX orders_by_user_product ON orders(user_id, product_id, status, created_at);

CREATE TABLE entitlements (                             -- the ONLY unlock fact
  user_id    INTEGER NOT NULL REFERENCES users(id),
  product_id TEXT    NOT NULL,
  charge_id  TEXT    NOT NULL UNIQUE REFERENCES payments(telegram_payment_charge_id),
  granted_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, product_id)                     -- one entitlement per product; revoke = DELETE
) STRICT;

CREATE TABLE saves (
  user_id       INTEGER NOT NULL REFERENCES users(id),
  slot          TEXT    NOT NULL CHECK (slot IN ('auto','s1','s2','s3')),
  rev           INTEGER NOT NULL CHECK (rev >= 1),
  chapter_id    TEXT    NOT NULL,
  story_version TEXT    NOT NULL,
  line_id       TEXT,
  write_id      TEXT    NOT NULL,                       -- client idempotency key of the last successful write
  body          TEXT    NOT NULL CHECK (json_valid(body) AND length(body) <= 262144),
  saved_at      INTEGER NOT NULL,
  PRIMARY KEY (user_id, slot)
) STRICT;
