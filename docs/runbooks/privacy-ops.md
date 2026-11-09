# Privacy operations

> Fill the privacy policy's placeholders, change the policy, and answer a player's access or deletion request.
> Run it before the first production start, at every policy change, and when a request about personal data arrives.

The policy page is `GET /api/privacy`, public and tokenless ([legal.rs:213-216](../../server/src/api/legal.rs#L213)); the
bot's `/privacy` links it, and @BotFather's privacy policy URL points at it ([bot-setup.md](bot-setup.md#steps),
step 3). The design is META-PLAN M25-M26 and its section
[Privacy](../META-PLAN.md#privacy-personal-data-inventory-lawful-bases-erasure); the code map is the FEATURE_MAP row
[Privacy policy route](../FEATURE_MAP.md#server). The operator's identity never enters the repository: it lives in a
file on the host.

## Preconditions

- Shell access to the production host, and the right to restart `server serve` there.
- For a request about data: `psql` (PostgreSQL 18 `bin`) and write access to the database (`<DATABASE_URL>`).

## How the page is filled

The template [server/legal/privacy-policy.html](../../server/legal/privacy-policy.html) is compiled into the server
(`POLICY_HTML`, [legal.rs:19](../../server/src/api/legal.rs#L19)). `Policy::load` substitutes it once at startup
([legal.rs:87-112](../../server/src/api/legal.rs#L87)). Its placeholders are `{NAME}` tokens of `A-Z` and `_` only
(`\{[A-Z_]+\}`, [legal.rs:145](../../server/src/api/legal.rs#L145)); a placeholder with a digit would not be found,
so never write one. Three classes:

| Class | Keys | Filled by |
|---|---|---|
| identity (10) | `OPERATOR_NAME`, `OPERATOR_FORM`, `OGRN`, `INN`, `OPERATOR_ADDRESS`, `PRIVACY_CONTACT_EMAIL`, `RESPONSIBLE_PERSON`, `DPO_CONTACT`, `EU_REPRESENTATIVE`, `POLICY_URL` | the host file, `PRIVACY_OPERATOR_FILE` |
| content (6) | `RETENTION_PERIOD`, `MIN_AGE`, `DB_LOCATION_COUNTRY`, `HOSTING_PROVIDER`, `CROSS_BORDER_TRANSFER`, `SUPERVISORY_AUTHORITY` | a template commit only |
| derived | `POLICY_VERSION` | the template's `<meta name="policy-version" content="YYYY-MM-DD[a-z]">` |

Sources: `IDENTITY_KEYS` and `CONTENT_KEYS` ([legal.rs:21-45](../../server/src/api/legal.rs#L21)), `DERIVED_KEY`
(:47-49), the meta ([privacy-policy.html:6](../../server/legal/privacy-policy.html#L6)).

Under `TELEGRAM_ENV=prod`:
- `PRIVACY_OPERATOR_FILE` must be set; unset is a configuration error
  (`PRIVACY_OPERATOR_FILE: missing`, [config.rs:177-184](../../server/src/config.rs#L177));
- the server refuses to start while any placeholder is left in the page, and the error names each one:
  `privacy policy: placeholders left under TELEGRAM_ENV=prod: {RETENTION_PERIOD}, ...`
  ([legal.rs:73-75](../../server/src/api/legal.rs#L73), :98-110).

Under `test` without a host file, the draft is served with its placeholders visible.

## Steps

### Write the host file (identity facts)

1. On the host, outside the repository, create a UTF-8 JSON file without a byte-order mark: one flat object, keys
   from the identity class only, every value a string. The loader parses the raw bytes
   ([legal.rs:96](../../server/src/api/legal.rs#L96), :123-125), so a BOM makes the file "not valid JSON". Windows
   PowerShell 5.1's `Set-Content -Encoding utf8` and `Out-File -Encoding utf8` write a BOM;
   `[System.IO.File]::WriteAllText` does not (the PowerShell block below the example). Placeholders only in this
   example:

   ```json
   {
     "OPERATOR_NAME": "<operator name>",
     "OPERATOR_FORM": "<legal form>",
     "OGRN": "<OGRN or OGRNIP>",
     "INN": "<INN>",
     "OPERATOR_ADDRESS": "<postal address>",
     "PRIVACY_CONTACT_EMAIL": "<privacy contact e-mail>",
     "RESPONSIBLE_PERSON": "<responsible person>",
     "DPO_CONTACT": "<DPO contact>",
     "EU_REPRESENTATIVE": "<EU representative>",
     "POLICY_URL": "<PUBLIC_APP_URL>api/privacy"
   }
   ```

   Paste the object with your values between the here-string's lines; its closing `'@` starts its line:

   ```powershell
   $text = @'
   <the JSON object above, with your values>
   '@
   [System.IO.File]::WriteAllText("<absolute path>", $text)
   ```

2. Set `PRIVACY_OPERATOR_FILE=<absolute path of that file>` in the server's environment and restart `server serve`.

The loader's rules ([legal.rs:121-143](../../server/src/api/legal.rs#L121), `PolicyError` :56-77): a file that is
not JSON or not an object, a value that is not a string, a key outside the identity class, a content key or
`POLICY_VERSION` each refuse the start, naming the key and never the value. A blank value fills nothing: its
placeholder stays, so prod refuses. A key written twice keeps its last value (probed by the LPO lane; carry). Every
value is HTML-escaped.

3. Keep every revision of the host file on the host, each with its date. It is the only record of the identity facts in
   force when a consent was given (a `consents` row records the policy version and its time `at`,
   [0005_social.sql:55-62](../../server/migrations/0005_social.sql#L55)).

### Change the policy

| Change | How | New version |
|---|---|---|
| a content value (retention, minimum age, database country, hosting provider, cross-border transfer, supervisory authority) or any other template text | a template commit: edit the HTML, set a new `policy-version` meta (the date it takes effect), append a `POLICY_PINS` row with the template's lower-case hex SHA-256 ([legal.rs:263-270](../../server/src/api/legal.rs#L263); the hash: `(Get-FileHash -Algorithm SHA256 server/legal/privacy-policy.html).Hash.ToLower()`); then deploy | yes |
| a contact fix in the host file | edit the host file, restart | no |
| the operator itself (name, form, OGRN, INN) | both: the host file and a template commit | yes |

`POLICY_PINS` is append-only. `cargo test` checks three things (`policy_template_pinned_per_version`,
[legal.rs:389-397](../../server/src/api/legal.rs#L389); `check_pins` :284-305): the versions strictly increase, the
last row's version is the template's meta, and the last row's hash is today's template. It compares only the last row
with the template, so it does not catch an edited earlier row, nor a template edit whose new hash overwrites the last
row under the same version. Review catches those: "an edited row is a review STOP" (the pin's comment, :263-264).
Never edit a row; a template change always gets a new version and a new row.
New consents then record the new version. The first content fill is the owner's VALUES step: until it lands, a
production start refuses (the designed guard). In the same commit the tests that pin the placeholders visible change
too (`privacy_draft_served_without_file_in_test` in [server/tests/it/legal.rs](../../server/tests/it/legal.rs), and
`served_draft()` in `legal.rs` and [server/tests/it/social.rs](../../server/tests/it/social.rs)).

### Answer an access request

The policy promises an answer within 10 working days (152-FZ art. 20) and one month under GDPR art. 12
([META-PLAN.md](../META-PLAN.md) M26, the policy's rights section). What is stored, per table, is the inventory in
META-PLAN "Privacy", plus the two refund tables of
[0007_auto_refunds.sql](../../server/migrations/0007_auto_refunds.sql), which that inventory predates: `auto_refunds`
(a charge's automatic refund, found through its payment) and `unrecorded_refunds` (a refund of a charge the database
does not hold, with the payer's id). The per-player puzzle codes are in `puzzle_values`
([0008_puzzle_values.sql](../../server/migrations/0008_puzzle_values.sql)): per per-player puzzle, the code drawn for
the player, its run and the number of wrong answers in the run. Nothing else is kept (no IP addresses in tables, no username, no
phone). Read one player's rows (`<USER_ID>` is their Telegram user id, a number):

```powershell
@'
SELECT * FROM users WHERE id = :uid;
SELECT story_id, slot, rev, chapter_id, line_id, saved_at FROM saves WHERE user_id = :uid;
SELECT * FROM payments WHERE user_id = :uid;
SELECT r.* FROM auto_refunds r JOIN payments p ON p.telegram_payment_charge_id = r.charge_id WHERE p.user_id = :uid;
SELECT * FROM unrecorded_refunds WHERE user_id = :uid;
SELECT * FROM orders WHERE user_id = :uid;
SELECT * FROM entitlements WHERE user_id = :uid;
SELECT * FROM stat_events WHERE user_id = :uid ORDER BY received_at;
SELECT * FROM puzzle_progress WHERE user_id = :uid;
SELECT * FROM hint_unlocks WHERE user_id = :uid;
SELECT * FROM puzzle_values WHERE user_id = :uid;
SELECT * FROM achievement_unlocks WHERE user_id = :uid;
SELECT * FROM resource_balances WHERE user_id = :uid;
SELECT * FROM resource_ledger WHERE user_id = :uid ORDER BY created_at;
SELECT * FROM consents WHERE user_id = :uid ORDER BY at;
SELECT * FROM invite_codes WHERE user_id = :uid;
SELECT * FROM user_handles WHERE user_id = :uid;
SELECT * FROM friend_requests WHERE from_id = :uid OR to_id = :uid;
SELECT * FROM friendships WHERE user_lo = :uid OR user_hi = :uid;
SELECT * FROM friend_blocks WHERE user_id = :uid OR blocked_id = :uid;
SELECT * FROM referrals WHERE invitee_id = :uid OR inviter_id = :uid;
'@ | & "<PG_BIN>\psql" "<DATABASE_URL>" -v ON_ERROR_STOP=1 -v uid=<USER_ID>
```

`stat_events` holds the player's id and closed-vocabulary facts only: the kind (`chapter_started`, `chapter_completed`,
`ending_reached`, `puzzle_ended`, `choice_made`), the story and chapter, an ending name, puzzle id or option line ID,
a puzzle outcome, the story version, the client-measured age and the server's receipt time
([0003_stats.sql:8-41](../../server/migrations/0003_stats.sql#L8)). Retention is "keep", with no deletion job
(OPEN-QUESTIONS Q23, resolved 2026-10-31). Rows on the player's device (DeviceStorage) and in Telegram's CloudStorage
are not on the server.

### Answer a deletion request (manual erasure)

The erase command is a later lane; until it exists, run the designed order by hand (META-PLAN "Privacy", Erasure):
one transaction, children first, no cascades. The same order is data, `ERASURE_ORDER` in
[server/src/db/mod.rs](../../server/src/db/mod.rs), held to the schema by the erasure gates in
[server/tests/it/schema.rs](../../server/tests/it/schema.rs). Payments and orders stay for accounting, so the `users`
row is anonymised, not deleted; ledger rows with a charge stay with their payment. The refund records stay too, as
accounting records like `payments`: the block touches neither `auto_refunds` nor `unrecorded_refunds`. Check the
player's id twice: this cannot be undone.

```powershell
@'
BEGIN;
DELETE FROM achievement_unlocks WHERE user_id = :uid;
DELETE FROM stat_events WHERE user_id = :uid;
DELETE FROM hint_unlocks WHERE user_id = :uid;
DELETE FROM puzzle_values WHERE user_id = :uid;
DELETE FROM puzzle_progress WHERE user_id = :uid;
DELETE FROM saves WHERE user_id = :uid;
DELETE FROM consents WHERE user_id = :uid;
DELETE FROM friend_requests WHERE from_id = :uid OR to_id = :uid;
DELETE FROM friendships WHERE user_lo = :uid OR user_hi = :uid;
DELETE FROM friend_blocks WHERE user_id = :uid OR blocked_id = :uid;
DELETE FROM user_handles WHERE user_id = :uid;
DELETE FROM invite_codes WHERE user_id = :uid;
DELETE FROM referrals WHERE invitee_id = :uid;
UPDATE referrals SET inviter_id = NULL WHERE inviter_id = :uid;
UPDATE resource_ledger SET counterpart_id = NULL WHERE counterpart_id = :uid AND user_id <> :uid;
DELETE FROM resource_ledger WHERE user_id = :uid AND charge_id IS NULL;
DELETE FROM resource_balances WHERE user_id = :uid;
DELETE FROM entitlements WHERE user_id = :uid;
UPDATE users SET first_name = '', language_code = NULL WHERE id = :uid;
COMMIT;
'@ | & "<PG_BIN>\psql" "<DATABASE_URL>" -v ON_ERROR_STOP=1 -v uid=<USER_ID>
```

On Linux, call `"<PG_BIN>/psql"` with the same arguments and feed the SQL from a quoted here-document (`<<'SQL'` ...
`SQL`) instead of `@'` ... `'@ |`. `ON_ERROR_STOP` ends the session at the first failing statement, before `COMMIT`,
so nothing is applied. The columns are the migrations' ([0002_puzzles.sql](../../server/migrations/0002_puzzles.sql),
[0004_economy.sql](../../server/migrations/0004_economy.sql), [0005_social.sql](../../server/migrations/0005_social.sql),
[0006_achievements.sql](../../server/migrations/0006_achievements.sql),
[0008_puzzle_values.sql](../../server/migrations/0008_puzzle_values.sql)). The docs lane D2 ran this block twice, as
written then, on a probe cluster with the tree's migrations ([deploy.md](deploy.md#roll-back), the last paragraph).
The values lane GM6s1 ran the access query and this block with `puzzle_values` added, as written, on a scratch
database migrated through `0008` on PostgreSQL 18.6: the first access showed the player's `puzzle_values` row, the
block reached `COMMIT`, and the second access showed no `puzzle_values` row and the anonymised `users` row. Run the
access query above first, then this, on a copy or at a quiet hour. Tell the player what was kept and why (payments,
orders, refund records and the ledger rows of a charge, for accounting).

Then add the erasure to your erasure record: the player's id and the time in unix seconds
(`[DateTimeOffset]::UtcNow.ToUnixTimeSeconds()`; on Linux `date +%s`). Keep the record on the host with the backups, never in the
repository: it holds player ids. The erasure leaves no dated trace in the database, and a database restore from a
backup older than the erasure brings the rows back. A rollback then runs the erasure again from this record, before
the server starts on the restored database ([deploy.md](deploy.md#roll-back), step 4).

## Verify

- `GET <PUBLIC_APP_URL>api/privacy` shows no `{...}` placeholder and the version you set.
- After an erasure, the access query returns the `users` row with an empty name, the payments, the refund records,
  the orders and the ledger rows with a charge, and nothing else of the player.

## Roll back

A host-file change: restore the previous revision kept on the host and restart. A template change: a new template
commit with a newer version (pins are append-only; never edit or remove a row). An erasure cannot be rolled back.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `invalid configuration: PRIVACY_OPERATOR_FILE: missing` | prod without the variable | set it (above) |
| `privacy policy: PRIVACY_OPERATOR_FILE cannot be read: ...` | wrong path or permissions | fix the path; the server process must read it |
| `privacy policy: PRIVACY_OPERATOR_FILE is not valid JSON or not a JSON object` | a syntax error, a top level that is not an object, or a byte-order mark ([legal.rs:62-64](../../server/src/api/legal.rs#L62)) | fix the JSON; write the file without a BOM (step 1) |
| `privacy policy: PRIVACY_OPERATOR_FILE: <KEY> is filled by the policy template, never by the host file` | a content key or `POLICY_VERSION` in the host file | remove it; change content by a template commit |
| `privacy policy: PRIVACY_OPERATOR_FILE: <KEY> is not an operator identity key` | a typo or an unknown key | use the ten keys above |
| `privacy policy: placeholders left under TELEGRAM_ENV=prod: ...` | a blank value, a missing key, or the content keys not yet filled by a template commit | fill what the message names |
