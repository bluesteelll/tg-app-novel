# Payments operations

> Set prices, find a purchase by its charge id, refund it, follow an automatic refund, and answer a player's
> `/paysupport` request.
> Run it when a player writes about a payment, when the admins are alerted that an automatic refund was given up, after
> a restore from a backup, or before a price change.

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
& "<PG_BIN>\psql" "<DATABASE_URL>" -c "SELECT p.telegram_payment_charge_id, p.user_id, p.amount, p.currency, p.paid_at, p.refunded_at, o.id AS order_id, o.product_id, o.status, EXISTS (SELECT 1 FROM entitlements e WHERE e.charge_id = p.telegram_payment_charge_id) OR EXISTS (SELECT 1 FROM resource_ledger l WHERE l.charge_id = p.telegram_payment_charge_id) AS applied, r.attempts AS auto_attempts, r.refusals AS auto_refusals, r.due_at AS auto_due_at, r.last_error AS auto_last_error FROM payments p LEFT JOIN orders o ON o.charge_id = p.telegram_payment_charge_id LEFT JOIN auto_refunds r ON r.charge_id = p.telegram_payment_charge_id WHERE p.telegram_payment_charge_id = '<CHARGE_ID>'"
```

Replace `<CHARGE_ID>` inside the quotes with the number as the player sent it. `applied` is the rule `/paysupport` uses: an entitlement or a ledger row keyed by the charge
([db/payments.rs:658-696](../../server/src/db/payments.rs#L658)). The `auto_*` columns are the charge's automatic
refund ([An unapplied-charge notice](#an-unapplied-charge-notice)); they are empty for a charge that has none.
Times are unix seconds. The tables: [0001_init.sql](../../server/migrations/0001_init.sql) (`payments`, `orders`,
`entitlements`), [0004_economy.sql](../../server/migrations/0004_economy.sql) (`resource_ledger`) and
[0007_auto_refunds.sql](../../server/migrations/0007_auto_refunds.sql) (`auto_refunds`, `unrecorded_refunds`).

No row: the charge is not in `payments`. After a restore from a backup it may be one of the charges refunded by its
payer form ([below](#refund-a-charge-the-database-does-not-hold)):

```powershell
& "<PG_BIN>\psql" "<DATABASE_URL>" -c "SELECT charge_id, user_id, admin_id, refunded_at FROM unrecorded_refunds WHERE charge_id = '<CHARGE_ID>'"
```

### Answer `/paysupport`

`/paysupport` is the player's own command: it lists the sender's newest charges, newest first, at most 20 and as many
as fit one message, then how many more there are of the total; each charge has its date, amount and number, and a
status ([commands.rs:125-191](../../server/src/telegram/commands.rs#L125), `PAYSUPPORT_CHARGES` :23). When the
database read fails, the bot answers the intro and "repeat in a minute"
([commands.rs:217-234](../../server/src/telegram/commands.rs#L217)). The intro text is a draft until the owner writes
the real support contact ([bot-setup.md](bot-setup.md#steps), step 5).

The four states (`charge_text`, [commands.rs:165-191](../../server/src/telegram/commands.rs#L165); the texts
[bot.en.json:13-15](../../server/locales/bot.en.json#L13)):

| Status | Text key | When | Next |
|---|---|---|---|
| no mark | - | applied: an entitlement or a ledger row keyed by the charge | nothing |
| "(refunded)" | `paysupport_refunded` | the payment has `refunded_at` | nothing: the Stars are back |
| "(being refunded)" | `paysupport_refunding` | its automatic refund is pending (its `auto_refunds` row has `due_at`) | nothing: the server retries; see [An unapplied-charge notice](#an-unapplied-charge-notice) |
| "(not applied, please contact us)" | `paysupport_not_applied` | paid, granted nothing, and no automatic refund pending: a charge recorded before migration `0007`, or one whose automatic refund was given up | refund it by hand ([below](#refund-a-charge)) |

The bot checks the marks from "(refunded)" down and shows no mark only when none of them holds: a refunded charge
shows "(refunded)" whatever else it has ([commands.rs:165-191](../../server/src/telegram/commands.rs#L165)).

### Refund a charge

In the private chat with the bot, from an admin account:

```text
/refund <CHARGE_ID>
```

The server reads the payment first; an unknown or already refunded charge answers at once, with no Bot API call. Else
it calls `refundStarPayment` for the payer, then revokes in one transaction
([payments.rs:485-512](../../server/src/telegram/payments.rs#L485)). The reply can take about 10 s: the Bot API call is
cut at 5 s and the reply at another 5 s (`CALL_DEADLINE`, [gateway.rs:38](../../server/src/telegram/gateway.rs#L38)).
A charge whose automatic refund is pending can be refunded this way too: Telegram refunds a charge once, the revoke
runs once, and the revoke settles the automatic refund
([db/payments.rs:500-504](../../server/src/db/payments.rs#L500); `auto_refund_settled_by_admin_or_telegram_refund`,
[server/tests/it/auto_refunds.rs:875](../../server/tests/it/auto_refunds.rs#L875)).

| Reply (`server/locales/bot.*.json`) | Meaning | Next |
|---|---|---|
| `refund_done` | Telegram returned the Stars and the purchase is revoked | done; then the check below |
| `refund_already` | the charge was refunded before | nothing |
| `refund_unknown` | no payment has this charge id | check the number; after a restore, [the payer form](#refund-a-charge-the-database-does-not-hold) |
| `refund_unrecorded_done` | the payer form refunded a charge the database does not hold | done |
| `refund_failed` | Telegram refused (or the gateway is disabled): nothing changed | read the error, retry |
| `refund_unknown_outcome` | the call timed out or broke: Telegram may have refunded | repeat the same command: the server treats an API refusal whose description holds `CHARGE_ALREADY_REFUNDED` as refunded, and revokes or records ([payments.rs:560-565](../../server/src/telegram/payments.rs#L560); verify: the Bot API's text for an already-refunded charge, the owner's E6 run) |
| `refund_usage` | no charge id, more than two words, a payer that is not a positive number, or a charge id over 256 characters | correct the command |

Sources: [commands.rs:236-304](../../server/src/telegram/commands.rs#L236) (`refund_args`, `refund_reply`;
`MAX_CHARGE_ARG` :20), [bot.en.json:23-29](../../server/locales/bot.en.json#L23). A non-admin's `/refund` gets the
unknown-command reply. Of these replies, `refund_unknown`, `refund_unrecorded_done` and `refund_usage` are drafts
until the owner's bot-text step (`drafts`, [bot.en.json:3](../../server/locales/bot.en.json#L3)).

What the revoke does ([db/payments.rs:368-401](../../server/src/db/payments.rs#L368), `RevokeOutcome` :130-140): the
payment gets `refunded_at`, its order turns `refunded`; a chapter's entitlement moves to the payer's oldest other
unrefunded paid charge of the same chapter that has no automatic refund, keeping `granted_at`, or is deleted when there
is none; a pack's credit is clawed back; the charge's automatic refund, if it has one, is settled. A clawback takes
what is left of the balance and records the rest as debt, which later credits pay first
([db/economy.rs:191-193](../../server/src/db/economy.rs#L191); OPEN-QUESTIONS Q34). Hints already read stay read:
they were delivered on purchase (OPEN-QUESTIONS Q15, the default).

**After every admin refund**, check the payer's other charges. A second payment of the same chapter that the refund
leaves unapplied is refunded automatically: the race of RULINGS 100 is closed, and the re-key never picks a charge with
an automatic refund ([db/payments.rs:396-401](../../server/src/db/payments.rs#L396)). What is left to do by hand is a
paid charge that granted nothing and has no automatic refund pending. The payer's charges:

```powershell
& "<PG_BIN>\psql" "<DATABASE_URL>" -c "SELECT p.telegram_payment_charge_id, p.amount, p.paid_at, p.refunded_at, EXISTS (SELECT 1 FROM entitlements e WHERE e.charge_id = p.telegram_payment_charge_id) OR EXISTS (SELECT 1 FROM resource_ledger l WHERE l.charge_id = p.telegram_payment_charge_id) AS applied, r.attempts AS auto_attempts, r.due_at AS auto_due_at FROM payments p LEFT JOIN auto_refunds r ON r.charge_id = p.telegram_payment_charge_id WHERE p.user_id = <USER_ID> ORDER BY p.paid_at DESC LIMIT 20"
```

`<USER_ID>` is the payer's Telegram user id (the `user_id` of the first query). For a row with `refunded_at` empty and
`applied` false:
- `auto_due_at` set: its automatic refund is pending; nothing to do;
- `auto_attempts` set and `auto_due_at` empty: its automatic refund was given up (the admins got the alert); refund
  it by hand;
- both empty: a charge recorded before migration `0007`, which has no automatic refund; refund it by hand.

### An unapplied-charge notice

A payment that is recorded but grants nothing is refunded automatically. The reasons
([db/payments.rs:77-93](../../server/src/db/payments.rs#L77)): `OrderMismatch` (the payload names no payable order of
this payer at this amount), `AlreadyEntitled` (the payer owned the chapter already) and `UnknownProduct` (the product
id names nothing this build grants). What happens:

1. The grant commits the payment and the charge's `auto_refunds` row in one transaction
   ([db/payments.rs:255-268](../../server/src/db/payments.rs#L255), `schedule_auto_refund` :705). A redelivery of
   the same payment changes nothing.
2. The payer is told the Stars are being refunded (`payment_unapplied`, in the payer's language), and every admin that
   the automatic refund has started (`admin_unapplied`, in Russian), with the charge id and the payer
   ([payments.rs:143-216](../../server/src/telegram/payments.rs#L143)).
3. The first refund attempt normally runs right after the notice; a sweep pass that runs in between may take the row
   first, and the claim lets only one of them refund. The notice and the attempt's `refundStarPayment` call share one
   5 s deadline; the attempt's database steps run outside it. An attempt claims the row for 60 s, calls
   `refundStarPayment` and, on success, revokes as `/refund` does
   ([payments.rs:232-351](../../server/src/telegram/payments.rs#L232)).
4. A failed attempt is retried by the sweep that `server serve` runs: every 30 s, up to 20 due charges a pass
   ([payments.rs:390-443](../../server/src/telegram/payments.rs#L390); [main.rs:156-165](../../server/src/main.rs#L156)).
   The wait doubles from 60 s to at most 1 h (`auto_refund_backoff`,
   [payments.rs:448](../../server/src/telegram/payments.rs#L448)).
5. Only a refusal counts toward the bound: an API error or a disabled gateway. After 8 refusals (about 2 h when every
   attempt is refused) the refund is given up, and every admin gets `admin_auto_refund_failed` once, with the charge,
   the payer, the attempts and the last error (`AUTO_REFUND_MAX_REFUSALS`,
   [payments.rs:51-55](../../server/src/telegram/payments.rs#L51), `alert_given_up` :353-388). Refund it by hand:
   `/refund <CHARGE_ID>`. A timeout or a broken connection is not a refusal: such a charge is retried on the same
   backoff, hourly from the seventh attempt on, with no bound, and stays "being refunded" until the Bot API answers.

The texts are drafts until the owner's bot-text step ([bot.en.json:3](../../server/locales/bot.en.json#L3), :20-22).
The payer reads "being refunded" even when the first attempt has already refunded; `/paysupport` then shows
"(refunded)".

The server log names each step: `auto-refund: first attempt`, `auto-refund attempt failed` (with `refused`, the error
and `next_due`), `auto-refund given up; the admins are alerted`, and the sweep's `auto-refund sweep pass`. The alert is
sent once: if every admin's message fails, the log has `auto-refund given up: an admin's alert failed` and
`/paysupport` shows the charge "not applied". The charges whose automatic refund has not ended in a refund:

```powershell
& "<PG_BIN>\psql" "<DATABASE_URL>" -c "SELECT r.charge_id, p.user_id, p.amount, r.created_at, r.attempts, r.refusals, r.due_at, r.last_error FROM auto_refunds r JOIN payments p ON p.telegram_payment_charge_id = r.charge_id WHERE p.refunded_at IS NULL ORDER BY r.created_at"
```

A row with `due_at` set is pending; one with `due_at` empty was given up: refund it by hand.

### Refund a charge the database does not hold

After a restore from a backup ([deploy.md](deploy.md#roll-back)), a charge paid since the backup is paid in Telegram but
missing from `payments`, and `/refund <CHARGE_ID>` answers `refund_unknown`. Refund it with its payer's Telegram user
id, from the charges list the rollback saved:

```text
/refund <CHARGE_ID> <USER_ID>
```

- A charge the database holds keeps the one-word path, whatever payer is typed: the database's payer is refunded.
- For a charge it does not hold, the server calls `refundStarPayment` for `<USER_ID>` and records the refund in
  `unrecorded_refunds`, with the admin who ran it. It grants nothing and revokes nothing: no row of the charge exists
  ([payments.rs:514-558](../../server/src/telegram/payments.rs#L514)).
- A repeat is safe: a recorded refund answers `refund_already` with no Bot API call, and a call that meets
  `CHARGE_ALREADY_REFUNDED` records the refund. A refusal records nothing (`refund_failed`).
- The payer form exists only in a server built from commit `a93fe54` on. An older binary reads the two words as one
  charge id, answers `refund_unknown` and refunds nothing.

Pinned by `refund_command_unrecorded_charge` ([server/tests/it/bot.rs:576](../../server/tests/it/bot.rs#L576)).

### A refund made outside the bot

Telegram sends a `refunded_payment` message for a refund it made itself; the webhook revokes through the same path,
once per charge ([webhook.md](webhook.md#what-the-route-answers); ARCHITECTURE "Payments as built", Refunds).

## Verify

- The charge's row shows `refunded_at` and its order `refunded` (the first query).
- The player's `/paysupport` shows the charge as refunded.
- An automatic refund: its `auto_due_at` is empty and `refunded_at` set (the first query).

## Roll back

A refund cannot be undone: the Stars are back with the player. Re-granting a revoked chapter by hand is not built; a
player who wants it buys it again.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| a player paid, the chapter stays locked | the `successful_payment` has not arrived yet, or the charge is unapplied (then it is refunded automatically) | wait for the client's polling; check the webhook ([webhook.md](webhook.md#verify)); the first query |
| `admin_auto_refund_failed` arrived | Telegram refused the automatic refund 8 times | read the error in the alert; `/refund <CHARGE_ID>` |
| a charge stays "being refunded" for hours | the Bot API times out or the connection breaks: such attempts retry hourly and never give up | check the host's link to the Bot API and the log's `auto-refund attempt failed`; a `/refund <CHARGE_ID>` meanwhile is safe |
| `refund_unknown` for a number the player sent | a typo, another bot's payment, or a charge lost in a restore | ask for the number from `/paysupport`; after a restore, [the payer form](#refund-a-charge-the-database-does-not-hold) |
| a hint spent on a puzzle that had just been solved | a hint use and a correct attempt raced; nothing was granted unpaid | none needed; an optional goodwill credit is not built |
| `invoice` answers 429 `rate_limited` | this player already has 10 unpaid orders in the rolling hour ([db/orders.rs:158](../../server/src/db/orders.rs#L158)) | wait for `Retry-After` (at most 3600 s) ([db/orders.rs:15-20](../../server/src/db/orders.rs#L15)) |
