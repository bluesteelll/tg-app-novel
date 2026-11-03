# Payments operations

> Set prices, find a purchase by its charge id, refund it, and answer a player's `/paysupport` request.
> Run it when a player writes about a payment, when the admin is notified of an unapplied charge, or before a price
> change.

Stars only: `currency = "XTR"`, an empty `provider_token`, exactly one price item; the bot answers
`pre_checkout_query` within 10 s and grants only on `successful_payment`, keyed by `telegram_payment_charge_id`
([payments-stars](https://core.telegram.org/bots/payments-stars); CLAUDE.md principle 2). How it is built:
[ARCHITECTURE.md](../ARCHITECTURE.md#payments-as-built). The client's `openInvoice` callback status (`paid`,
`cancelled`, ...) is a UX hint only: it never proves a payment. Only the server's records do.

## Preconditions

- The admin's Telegram user id in `ADMIN_TELEGRAM_IDS` ([config.rs:163](../../server/src/config.rs#L163)), and a
  private chat with the bot from that account.
- For the database queries: `psql` from the PostgreSQL 18 `bin` directory and read access to the database
  (`<DATABASE_URL>`). Every query below only reads.

## Prices and products

Prices live in [server/catalog.json](../../server/catalog.json), compiled into the server
(`CATALOG_JSON`, [catalog.rs:19](../../server/src/catalog.rs#L19)): a price change is a commit, a rebuild and a
restart ([deploy.md](deploy.md)). Tests pin the compiled-in values, so the same commit changes them, or `cargo test`
fails. Among them (the list is not complete; `cargo test` is the rule):
- `invoice_price_from_catalog` ([server/tests/it/payments.rs:437](../../server/tests/it/payments.rs#L437)): the
  compiled-in chapter price of 1 Star (:479-496);
- `catalog_default_price_applies_to_every_paid_chapter`
  ([server/tests/it/catalog.rs:223](../../server/tests/it/catalog.rs#L223)): every paid chapter of the shipped file at
  `defaultPriceStars`, so a `priceStars` entry fails it;
- `wallet_lists_balances_and_packs` ([server/tests/it/economy.rs:1767](../../server/tests/it/economy.rs#L1767)),
  through `wallet_body` (:1739): the packs' amounts and prices, `hintTierCost` and `maxPerGift`;
- `catalog_packs_from_economy` (economy.rs:1249): the packs and the spend, gift and referral rules;
- the `hint_s` pack at 3 hints for 1 Star: `invoice_pack_price_from_catalog` (economy.rs:1394, also the pack's
  invoice titles), `invoice_pack_binds_catalog_at_invoice` (:1652), and the pack-credit tests that pay 1 Star for it
  (`pack_credit_uses_amount_bound_at_order` :1067, `pack_credit_once_on_duplicate_payment` :1124,
  `pack_grant_credits_in_the_grant_transaction` :1187);
- the gifts suite ([server/tests/it/gifts.rs](../../server/tests/it/gifts.rs)), written on the compiled-in gift limits
  (its header, :1-4).

Run `cargo test --workspace --all-targets --no-fail-fast --locked` after the edit; a failure names the value it
expected.

- **Chapters:** product id `chapter:<ch>`. Each paid chapter costs `chapters.defaultPriceStars` unless
  `chapters.priceStars` names it. A new paid chapter needs no catalog edit. A key of `priceStars` that is not a paid
  chapter, or a price below 1 Star, stops the start ([catalog.rs:285-312](../../server/src/catalog.rs#L285),
  `check_price` :544-552).
- **Hint packs:** product id `pack:<id>`, one per key of `economy.packs`, each with its `kind`, `amount` (units) and
  `priceStars` ([catalog.rs:55](../../server/src/catalog.rs#L55)). Every amount and price in the file is a
  PLACEHOLDER until the owner's (its `//` note; OPEN-QUESTIONS Q3, Q30). Hint products of their own no longer exist:
  hints are bought as packs and spent from the balance (META-PLAN M19, M21).
- The amount of an order is taken from the catalog when the order is created, never from the request
  ([0001_init.sql:31](../../server/migrations/0001_init.sql#L31)).
- The minimum Stars amount Telegram accepts: verify on the test bot. The Stars page states none
  ([payments-stars](https://core.telegram.org/bots/payments-stars)). A payment of 0 would fail the database check
  `payments_amount_positive` ([0001_init.sql:22](../../server/migrations/0001_init.sql#L22)), answer 500, and be
  redelivered.

## Steps

### Find a purchase by its charge id

The player quotes the payment number that `/paysupport` lists (the `telegram_payment_charge_id`). Look it up:

```powershell
& "<PG_BIN>\psql" "<DATABASE_URL>" -c "SELECT p.telegram_payment_charge_id, p.user_id, p.amount, p.currency, p.paid_at, p.refunded_at, o.id AS order_id, o.product_id, o.status, EXISTS (SELECT 1 FROM entitlements e WHERE e.charge_id = p.telegram_payment_charge_id) OR EXISTS (SELECT 1 FROM resource_ledger l WHERE l.charge_id = p.telegram_payment_charge_id) AS applied FROM payments p LEFT JOIN orders o ON o.charge_id = p.telegram_payment_charge_id WHERE p.telegram_payment_charge_id = '<CHARGE_ID>'"
```

Replace `<CHARGE_ID>` inside the quotes with the number as the player sent it. `applied` is the rule `/paysupport` uses: an entitlement or a ledger row keyed by the charge
([db/payments.rs:475-496](../../server/src/db/payments.rs#L475)). Times are unix seconds. The tables:
[0001_init.sql](../../server/migrations/0001_init.sql) (`payments`, `orders`, `entitlements`) and
[0004_economy.sql](../../server/migrations/0004_economy.sql) (`resource_ledger`).

### Answer `/paysupport`

`/paysupport` is the player's own command: it lists the sender's newest charges, newest first, at most 20 and as many
as fit one message, then how many more there are of the total; each charge has its date, amount and number, and a
mark when it was refunded or "not applied, please contact us"
([commands.rs:119-178](../../server/src/telegram/commands.rs#L119), `PAYSUPPORT_CHARGES` :22). When the database
read fails, the bot answers the intro and "repeat in a minute" ([commands.rs:207-222](../../server/src/telegram/commands.rs#L207)).
The intro text is a draft until the owner writes the real support contact ([bot-setup.md](bot-setup.md#steps), step 5).

For a charge marked "not applied": the player paid and got nothing. Refund it (below).

### Refund a charge

In the private chat with the bot, from an admin account:

```text
/refund <CHARGE_ID>
```

The server reads the payment first; an unknown or already refunded charge answers at once, with no Bot API call. Else
it calls `refundStarPayment` for the payer, then revokes in one transaction
([payments.rs:196-223](../../server/src/telegram/payments.rs#L196)). The reply can take about 10 s: the Bot API call is
cut at 5 s and the reply at another 5 s (`CALL_DEADLINE`, [gateway.rs:38](../../server/src/telegram/gateway.rs#L38)).

| Reply (`server/locales/bot.*.json`) | Meaning | Next |
|---|---|---|
| `refund_done` | Telegram returned the Stars and the purchase is revoked | done; then the check below |
| `refund_already` | the charge was refunded before | nothing |
| `refund_unknown` | no payment has this charge id | check the number |
| `refund_failed` | Telegram refused (or the gateway is disabled): nothing changed | read the error, retry |
| `refund_unknown_outcome` | the call timed out or broke: Telegram may have refunded | repeat `/refund <CHARGE_ID>`: the server treats an API refusal whose description holds `CHARGE_ALREADY_REFUNDED` as refunded and revokes ([payments.rs:225-230](../../server/src/telegram/payments.rs#L225); verify: the Bot API's text for an already-refunded charge, the owner's E6 run) |
| `refund_usage` | no charge id given | add it |

Sources: [commands.rs:226-256](../../server/src/telegram/commands.rs#L226),
[bot.en.json:21-26](../../server/locales/bot.en.json#L21). A non-admin's `/refund` gets the unknown-command reply.

What the revoke does ([db/payments.rs:94-102](../../server/src/db/payments.rs#L94)): the payment gets `refunded_at`,
its order turns `refunded`; a chapter's entitlement moves to the payer's oldest other unrefunded paid charge of the
same chapter, keeping `granted_at`, or is deleted when there is none; a pack's credit is clawed back. A clawback takes
what is left of the balance and records the rest as debt, which later credits pay first
([db/economy.rs:191-193](../../server/src/db/economy.rs#L191); OPEN-QUESTIONS Q34). Hints already read stay read:
they were delivered on purchase (OPEN-QUESTIONS Q15, the default).

**After every admin refund**, check the payer for an unapplied charge: a refund that races a second payment of the
same chapter can leave that payment paid and unapplied (the residual of RULINGS 100, documented at
[db/payments.rs:344-350](../../server/src/db/payments.rs#L344)). The payer's charges:

```powershell
& "<PG_BIN>\psql" "<DATABASE_URL>" -c "SELECT p.telegram_payment_charge_id, p.amount, p.paid_at, p.refunded_at, EXISTS (SELECT 1 FROM entitlements e WHERE e.charge_id = p.telegram_payment_charge_id) OR EXISTS (SELECT 1 FROM resource_ledger l WHERE l.charge_id = p.telegram_payment_charge_id) AS applied FROM payments p WHERE p.user_id = <USER_ID> ORDER BY p.paid_at DESC LIMIT 20"
```

`<USER_ID>` is the payer's Telegram user id (the `user_id` of the first query). A row with `refunded_at` empty and `applied` false is a paid charge that granted nothing: refund it too.

### An unapplied-charge notice

When a payment is recorded but grants nothing, the server tells the payer and every admin, with the charge id to
refund ([payments.rs:112-117](../../server/src/telegram/payments.rs#L112)). The reasons
([db/payments.rs:78-90](../../server/src/db/payments.rs#L78)): `OrderMismatch` (the payload names no payable order of
this payer at this amount), `AlreadyEntitled` (the payer owned the chapter already) and `UnknownProduct` (the product
id names nothing this build grants). "Unapplied" also covers a pack charge without its ledger row. The remedy is
`/refund <CHARGE_ID>`.

### A refund made outside the bot

Telegram sends a `refunded_payment` message for a refund it made itself; the webhook revokes through the same path,
once per charge ([webhook.md](webhook.md#what-the-route-answers); ARCHITECTURE "Payments as built", Refunds).

## Verify

- The charge's row shows `refunded_at` and its order `refunded` (the first query).
- The player's `/paysupport` shows the charge as refunded.

## Roll back

A refund cannot be undone: the Stars are back with the player. Re-granting a revoked chapter by hand is not built; a
player who wants it buys it again.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| a player paid, the chapter stays locked | the `successful_payment` has not arrived yet, or the charge is unapplied | wait for the client's polling; check the webhook ([webhook.md](webhook.md#verify)); the first query |
| `refund_unknown` for a number the player sent | a typo, or another bot's payment | ask for the number from `/paysupport` |
| a hint spent on a puzzle that had just been solved | a hint use and a correct attempt raced; nothing was granted unpaid | none needed; an optional goodwill credit is not built |
| `invoice` answers 429 `rate_limited` | this player already has 10 unpaid orders in the rolling hour ([db/orders.rs:158](../../server/src/db/orders.rs#L158)) | wait for `Retry-After` (at most 3600 s) ([db/orders.rs:15-20](../../server/src/db/orders.rs#L15)) |
