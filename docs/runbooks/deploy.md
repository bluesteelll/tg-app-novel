# Deploy

> Build the client, the paid content and the server, and start them on a host with the database migrated.
> Run it for the first deployment and for every release after it.

One process serves everything: `server serve` answers `/api`, the Telegram webhook and, with `STATIC_DIR`, the built
client ([server/src/main.rs:1-3](../../server/src/main.rs#L1)). Paid content stays outside the client: the server
loads it from `CONTENT_DIR` and serves it only after the entitlement check
([ARCHITECTURE.md](../ARCHITECTURE.md#paid-content-and-the-entitlement-check)). The bot side is
[bot-setup.md](bot-setup.md); the webhook [webhook.md](webhook.md).

## Preconditions

- A build machine with Node.js 22.12+ and the Rust toolchain, on a commit whose gates are green (CLAUDE.md "Gate
  commands"). A commit of owner values changes the tests that pin them in the same commit: the bot-text drafts
  ([bot-setup.md](bot-setup.md#steps), step 5), the prices and economy numbers
  ([payments-ops.md](payments-ops.md#prices-and-products)) and the policy's placeholders
  ([privacy-ops.md](privacy-ops.md#change-the-policy)).
- `pg_dump`, `pg_restore` and `psql` from the PostgreSQL 18 `bin` directory (`<PG_BIN>`), for the backup in step 4
  and a rollback; for a rollback across a migration also the right to create a database (the role's `CREATEDB`, or
  the host's panel).
- A host with PostgreSQL 18 and an empty or already migrated database. Off loopback, `DATABASE_URL` must say
  `sslmode=verify-full` ([db/mod.rs:160-187](../../server/src/db/mod.rs#L160)). The server creates no database: a
  missing one is a startup error ([server/src/lib.rs:65-72](../../server/src/lib.rs#L65)).
- The same URL for the PostgreSQL tools. They are libpq clients, and libpq differs from the server's driver in two
  ways. With `verify-full` and no `sslrootcert`, libpq looks for the root certificate in `~/.postgresql/root.crt`
  (`%APPDATA%\postgresql\root.crt` on Windows) and fails if it cannot verify the server
  ([libpq SSL](https://www.postgresql.org/docs/18/libpq-ssl.html)), while the server's driver also trusts the public
  web CAs. So put `sslrootcert=<CA file>` into the URL, which both read. And write `sslmode`: the server accepts the
  spelling `ssl-mode` ([db/mod.rs:180](../../server/src/db/mod.rs#L180)), libpq refuses it
  (`invalid URI query parameter: "ssl-mode"`).
- The host clock synced by NTP ([bot-setup.md](bot-setup.md#preconditions)).
- The production values are in place. Each one refuses a production start until it is:
  - the bot texts' `drafts` empty in both `server/locales/bot.{ru,en}.json` ([bot-setup.md](bot-setup.md#steps),
    step 5);
  - the policy's content placeholders filled by a template commit, and the host file named by
    `PRIVACY_OPERATOR_FILE` ([privacy-ops.md](privacy-ops.md));
  - real secrets, not the `.env.example` placeholders ([config.rs:186-200](../../server/src/config.rs#L186)).
- Owner values that no start refuses, so check them by hand: the chapter and pack prices and the economy numbers in
  `server/catalog.json` are PLACEHOLDER values (OPEN-QUESTIONS Q3, Q30-Q33; [payments-ops.md](payments-ops.md#prices-and-products));
  statistics retention is "keep, no deletion job" (Q23).

## Build

On the build machine, from the repository root:

```powershell
npm --prefix client ci
npm --prefix client run build
cargo build -p server --release --locked
```

- `npm --prefix client run build` runs the story tool, the asset tool, `vite build`, the budget check and the leak scan
  ([client/package.json:11](../../client/package.json#L11)). It writes the public client to `client/dist/` and the
  paid content to `server/content/` ([ARCHITECTURE.md](../ARCHITECTURE.md#build-outputs-and-the-gates)). It must exit
  0: a budget row or a leak finding fails it.
- `cargo build` writes `target/release/server` (`server.exe` on Windows). The binary carries, compiled in,
  `server/catalog.json`, the bot texts, the share texts, the policy template and the migrations
  ([catalog.rs:19](../../server/src/catalog.rs#L19), [texts.rs:16-19](../../server/src/telegram/texts.rs#L16),
  [share.rs:43](../../server/src/api/share.rs#L43), [legal.rs:19](../../server/src/api/legal.rs#L19),
  [db/mod.rs:82](../../server/src/db/mod.rs#L82)). A change to any of them needs a new binary.
- Serve `client/dist/` only. Never `client/dist-e2e/`: that build has the dev mock compiled in
  ([vite.config.ts:30-31](../../client/vite.config.ts#L30), :43, :46-47). `STATIC_DIR` is checked at startup: it must not be, or
  contain, or sit inside `CONTENT_DIR`, no entry may resolve outside it, and no dot-entry may be in it except the
  root's `.vite` directory ([static_files.rs:215-219](../../server/src/api/static_files.rs#L215)).

## Steps

1. Copy to the host, keeping the layout the configuration names: the binary, `client/dist/` (for `STATIC_DIR`) and
   `server/content/` (for `CONTENT_DIR`). The two directories must stay disjoint.
   - **The binary and `server/content/` ship together**, both from this commit's build. At startup the server
     indexes every gated file the paid chapters' manifests name, half-tier files included, and refuses to start when
     one is missing: `startup failed: content: cannot read <path>: ...`
     ([content.rs:668-727](../../server/src/content.rs#L668), :37; pinned by
     `startup_fails_when_manifest_names_missing_half_file`,
     [server/tests/it/content.rs:522](../../server/tests/it/content.rs#L522)). A binary from before M3s (`a5f887b`)
     with newer content ignores the gated half files: a LOW phone then gets a 404 for those images, and nothing leaks
     (M3s cut Q3, Q4; RULINGS 151).
   - **`client/dist/`**: keep the previous release's `assets/` files, and replace `index.html` and `build-id.txt` only
     at step 5 ([Clients open during a deploy](#clients-open-during-a-deploy), items 2 and 3).
2. Set the environment of the service (the variables: [bot-setup.md](bot-setup.md#steps), step 4), with
   `TELEGRAM_ENV=prod`, `STATIC_DIR` and `CONTENT_DIR` pointing at the copied directories.
3. Stop the running server. It shuts down gracefully on Ctrl+C only, which is SIGINT on Linux
   ([main.rs:169-176](../../server/src/main.rs#L169)): a service manager must stop it with that signal (systemd sends
   SIGTERM unless the unit sets `KillSignal=SIGINT`). An update Telegram sent meanwhile is redelivered: the webhook
   answers nothing while the server is down.
4. Back up the database while no server runs, so the backup holds every payment written so far, and check that the
   file reads back. `<BACKUP_FILE>` is a path on the host outside the release directories; keep one per release. Keep
   the backup's time with it, in unix seconds (`<BACKUP_UNIX_TIME>`, the third command): nothing writes to the
   database while the server is stopped, so any moment before step 5 is the backup's time.

   ```powershell
   & "<PG_BIN>\pg_dump" --format=custom --file="<BACKUP_FILE>" "<DATABASE_URL>"
   & "<PG_BIN>\pg_restore" --list "<BACKUP_FILE>"
   [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
   ```

   On Linux: the same arguments after `"<PG_BIN>/pg_dump"` and `"<PG_BIN>/pg_restore"`, and `date +%s` for the time.
   The second command lists the backup's contents; an error there means no usable backup, so stop. A full check
   restores it into a scratch database (`pg_restore --dbname="<SCRATCH_DATABASE_URL>" "<BACKUP_FILE>"`).
5. Start the new server (`.\server.exe serve` on Windows, `./server serve` on Linux):

   ```powershell
   .\server.exe serve
   ```

   Startup order, each step refusing the start on failure: the configuration; the bot texts
   ([main.rs:101-105](../../server/src/main.rs#L101)); the `STATIC_DIR` check (:106-120); then the content, the
   catalog, the privacy policy and the Bot API gateway; last the database pool and the migrations
   ([server/src/lib.rs:65-94](../../server/src/lib.rs#L65)). Pending migrations apply here, in this start.
6. If `PUBLIC_APP_URL` or `WEBHOOK_SECRET` changed, run `.\server.exe setup` with the same environment
   ([webhook.md](webhook.md#registering)).

## Verify

- The log shows `bot texts checked`, `opening database` with the target (never the password) and
  `listening` with the address ([main.rs:41](../../server/src/main.rs#L41), :122, :155).
- `GET <PUBLIC_APP_URL>api/health` answers `ok`; `GET <PUBLIC_APP_URL>api/privacy` shows no placeholder.
- The build id: the `static dir checked` line's `build_id` and the `x-build-id` header of `api/health` equal
  `client/dist/build-id.txt` ([Clients open during a deploy](#clients-open-during-a-deploy), item 5).
- `/assets/*` answers with `Cache-Control: public, max-age=31536000, immutable`, everything else `no-cache`
  ([static_files.rs:26-30](../../server/src/api/static_files.rs#L26)).
- Open the bot, start a free chapter, buy a paid one (in the test environment first).

## Migrations

`server/migrations/` is applied in order at every start. Until the first deployment a migration file may be rewritten
in place; from the first deployment on they are append-only: a schema change is a new file
([STORIES-PLAN.md](../STORIES-PLAN.md) Y7 and SQ3). A database that applied an older text of a file refuses the start
(`migration <n> was previously applied but has been modified`). There are no down migrations.

## Clients open during a deploy

A Mini App left open across a deploy runs the old client bundle against the new server. Each client build carries an
id, the server names the id it serves on every `/api` answer, and an open page of another build reloads into the new
one at its next safe point (as merged: LBI `fe996a0`, RULINGS 145; the wallet rule LRB `3c62a86`, RULINGS 157).

How it works:

- **The id.** `npm --prefix client run build` writes `client/dist/build-id.txt`: 16 lowercase hex digits, a hash of
  the build's inputs (the sources with the generated story, `public/` with the encoded assets, the lockfile, the
  configs and the build mode), and compiles the same id into the bundle
  ([build-id.ts:39-62](../../client/scripts/build-id.ts#L39), [vite.config.ts:34](../../client/vite.config.ts#L34),
  :47). One tree gives one id. It is not a secret and reads no paid content.
- **The server.** `server serve` reads the id from `STATIC_DIR` after the directory walk
  ([static_files.rs:259](../../server/src/api/static_files.rs#L259), :266-283). A missing or malformed file refuses
  the start, before the database opens: `static dir refused: STATIC_DIR <path>: no build-id.txt (the client build
  writes it)` or `... build-id.txt is not 16 lowercase hex digits` (:176, :182). The log line `static dir checked`
  carries it as `build_id` ([main.rs:112](../../server/src/main.rs#L112)). Every answer of an `/api` route, errors
  included, then carries `x-build-id: <id>` ([api/mod.rs:38-58](../../server/src/api/mod.rs#L38)); static files, the webhook and an unknown
  `/api/*` path (no route matched) do not.
- **The page.** The client reads the header of every response and compares it with its own id
  ([http.ts:173-187](../../client/src/api/http.ts#L173)). A lazy chunk or a free chapter file that the deploy removed
  answers without the header, so a failed chunk import (`vite:preloadError`) or a failed chapter load sends
  `GET /api/health` as a probe ([boot.ts:770-774](../../client/src/app/boot.ts#L770),
  [game.ts:1288-1298](../../client/src/app/game.ts#L1288)). A difference the boot reads saw before the game engine
  loaded is handed to the Game when it is made ([boot.ts:592-595](../../client/src/app/boot.ts#L592)).
- **The reload.** The Game waits for a safe point and looks again every 500 ms
  ([game.ts:1751-1774](../../client/src/app/game.ts#L1751), :263). It waits while a step, a chapter load or a resume
  runs, while the app is in the background, while an invoice is being created, open or confirmed (the paywall's, or
  the wallet's pack purchase while the player is on the wallet), while a puzzle attempt waits for its answer, and
  while a manual save or a gift is being sent. A pack flow the player left, a gift dialog the player closed and a hint
  do not hold the reload. At the safe point the Game autosaves that point, shows "An update is out. Restarting…"
  (`notice.update_title`), flushes the save (an unacknowledged one stays in the pending cache) and reloads
  ([game.ts:1777-1810](../../client/src/app/game.ts#L1777)). The player continues from the server's autosave.
- **The latch.** The reload adds `novelReloadedFor=<id>` to the URL fragment and keeps Telegram's parameters byte for
  byte. A reloaded page that sees the same id again does not reload a second time: today's error states stay
  ([game.ts:104-124](../../client/src/app/game.ts#L104), :2073-2079). A Mini App opened again starts from a fresh URL.
- **Not covered.** A page whose game engine never loaded (no Game exists, for example a boot that ended in the error
  notice) does not reload. Item 2 below keeps its old files loadable (LBI cut Q4, accepted). The page's own id is a
  constant of the bundle, so every release with any input change renames the entry and the chunks that import it, and
  returning players download them again.

What the deploy must do:

1. Ship `client/dist/build-id.txt` with the rest of `client/dist/` ([Build](#build) writes it).
2. Keep the previous release's `assets/` files reachable. Merge the new `client/dist/assets/*` into the served
   `assets/` directory without deleting old files: the names carry a content hash and never collide, and `/assets/*`
   is served `immutable`. Prune only files older than two releases and older than the longest session
   (`INITDATA_MAX_AGE_SECS`, 86400 s by default, [config.rs:155](../../server/src/config.rs#L155)). This lets an old
   page, one with no Game among them, keep loading its chunks; the probe is the backstop when it is not done.
3. Replace `index.html` and `build-id.txt` together with the restart ([Steps](#steps), step 5), never before. A server
   still running on the old id against the new files makes every new session reload once (the latch stops a loop).
4. A reverse proxy in front of the server passes the `x-build-id` response header and keeps `index.html` `no-cache`.
5. Verify: the `build_id` of the `static dir checked` log line equals the file, and the health route names it:

   ```powershell
   Get-Content client/dist/build-id.txt
   (Invoke-WebRequest -UseBasicParsing "<PUBLIC_APP_URL>api/health").Headers["x-build-id"]
   ```

   On Linux: `cat client/dist/build-id.txt` and `curl -s -D - -o /dev/null "<PUBLIC_APP_URL>api/health"` (the
   `x-build-id` line). Verify: the reload is seen in Chromium only (the e2e and the dev mock); check it once on
   Telegram iOS and Desktop.

A rollback is the previous binary with the previous `client/dist/` and its `build-id.txt` together
([Roll back](#roll-back)): pages opened on the newer release reload once into the older build.

To rehearse the client side on this machine: `server-dev` serves no client files, so it claims a build id by hand.
`POST /dev/build-id` with `{"id": "<16 hex digits>"}` puts the header on every `/api` answer, `{"id": null}` clears
it ([server/dev/src/deploy.rs:1-5](../../server/dev/src/deploy.rs#L1), :49-51). The e2e
`client/e2e/build-skew.spec.ts` drives it.

## Roll back

Start the previous binary with the previous `client/dist/` and `server/content/`. A puzzle renamed or moved to
another chapter needs no step here: the server keeps every puzzle's rows (progress, hint unlocks, the ledger's hint
keys) under its storage key, the id it first shipped under (`key` in `server/content/puzzles/<ch>.json`), so a
rollback and the next forward start serve the same rows, a puzzle new in the rolled-back release keeps its rows until
a release serves it again, and no start is refused or restore needed for them. If the release applied a new
migration, the previous binary does not know it: sqlx refuses a database with a migration it lacks (verify on a copy
before relying on this), and there are no down migrations. A rollback across a migration then restores the step 4
backup into a new, empty database and points the server at it. Restoring over the migrated database does not work:
`pg_restore --clean` drops only the backup's own objects. Every migration from `0002_puzzles.sql` to
`0006_achievements.sql` adds a table that references `users`, and such a table, absent from the backup, blocks the
drop of the `users` key. `0007_auto_refunds.sql` adds `auto_refunds`, which references `payments`, and
`unrecorded_refunds`, which references nothing
([0007_auto_refunds.sql:16-17](../../server/migrations/0007_auto_refunds.sql#L16)): across `0007`, `auto_refunds`
blocks the drop of the `payments` key the same way (read from the migrations; the runs below used a stand-in
`0007`). `0008_puzzle_values.sql` adds `puzzle_values`, which references `users`
([0008_puzzle_values.sql:20](../../server/migrations/0008_puzzle_values.sql#L20)), and blocks the drop of the `users`
key as `0002`-`0006`'s tables do. The migrated database stays as it is, as the source of the lists below.

A restore drops every row written since the backup. Step 4 repeats the erasures (from your erasure record) and the
privacy decisions between the players the restored database has (saved in step 2); step 6 repeats the refunds (from
step 2's charges list). The charges paid on the new release stay unknown to the restored database (below). Everything else written on the new
release is lost:

- saves, puzzle progress and hint unlocks, stat events and achievement unlocks;
- wallet balances and ledger rows: hints spent since come back, gifts and credits since are gone;
- friend requests, friendships and referrals made since;
- unpaid orders (an invoice of the new release is refused at pre-checkout as an unknown order,
  [db/payments.rs:739-740](../../server/src/db/payments.rs#L739)) and handles (made again on demand);
- the players who first opened the app since: the restored database has no `users` row for them;
- the removals and declines that involve such a player, those of the players the restored database has among them.
  A block needs both players' `users` rows, so on their next launch the newcomer can send a request again to a
  player who said no.

Players see their game as it was at the backup; tell them before the restart, through your own channel. The bot has
no message to all players: it sends only command replies
([commands.rs:306-313](../../server/src/telegram/commands.rs#L306)) and the notice of an unapplied payment
([payments.rs:173-216](../../server/src/telegram/payments.rs#L173)); the admins also get the alert of a given-up
automatic refund (:353-388). Tell the players of the lost declines first. The migrated database lists them (a newcomer's `users.created_at` is after
the backup: it keeps the first login, [db/users.rs:10](../../server/src/db/users.rs#L10)):

```powershell
& "<PG_BIN>\psql" "<DATABASE_URL>" -c "SELECT b.user_id AS decided_by, b.blocked_id, b.created_at FROM friend_blocks b WHERE b.created_at > <BACKUP_UNIX_TIME> AND EXISTS (SELECT 1 FROM users u WHERE u.id IN (b.user_id, b.blocked_id) AND u.created_at > <BACKUP_UNIX_TIME>) ORDER BY b.created_at"
```

1. Stop the server.
2. From the migrated database, save two files. Both hold player ids: put them beside `<BACKUP_FILE>`, outside the
   repository and the release directories. The first lists the charges paid or refunded since the backup (`-o`):

   ```powershell
   & "<PG_BIN>\psql" "<DATABASE_URL>" -o "<CHARGES_FILE>" -c "SELECT p.telegram_payment_charge_id, p.user_id, p.amount, p.paid_at, p.refunded_at FROM payments p WHERE p.paid_at > <BACKUP_UNIX_TIME> OR p.refunded_at > <BACKUP_UNIX_TIME> ORDER BY p.paid_at"
   ```

   The second, `<REAPPLY_FILE>`, holds the players' privacy decisions since the backup as SQL statements for the
   restored database, one line per decision:

   ```powershell
   @'
   SELECT s FROM (
     SELECT 1 AS k, id AS o, format('INSERT INTO consents (user_id, purpose, granted, policy_version, text_version, at) SELECT %1$L::bigint, %2$L, %3$L::boolean, %4$L, %5$L, %6$L::bigint WHERE EXISTS (SELECT 1 FROM users WHERE id = %1$L::bigint);', user_id, purpose, granted, policy_version, text_version, at) AS s
       FROM consents WHERE at > :t
     UNION ALL
     SELECT 2, created_at, format('DELETE FROM friendships WHERE user_lo = %1$L::bigint AND user_hi = %2$L::bigint; DELETE FROM friend_requests WHERE (from_id = %3$L::bigint AND to_id = %4$L::bigint) OR (from_id = %4$L::bigint AND to_id = %3$L::bigint); INSERT INTO friend_blocks (user_id, blocked_id, created_at) SELECT %3$L::bigint, %4$L::bigint, %5$L::bigint WHERE EXISTS (SELECT 1 FROM users WHERE id = %3$L::bigint) AND EXISTS (SELECT 1 FROM users WHERE id = %4$L::bigint) ON CONFLICT ON CONSTRAINT friend_blocks_pkey DO NOTHING;', least(user_id, blocked_id), greatest(user_id, blocked_id), user_id, blocked_id, created_at)
       FROM friend_blocks WHERE created_at > :t
     UNION ALL
     SELECT CASE WHEN revoked_at IS NULL THEN 4 ELSE 3 END, created_at, format('INSERT INTO invite_codes (code, user_id, created_at, revoked_at) SELECT %1$L, %2$L::bigint, %3$L::bigint, %4$L::bigint WHERE EXISTS (SELECT 1 FROM users WHERE id = %2$L::bigint) ON CONFLICT ON CONSTRAINT invite_codes_pkey DO UPDATE SET revoked_at = EXCLUDED.revoked_at;', code, user_id, created_at, revoked_at)
       FROM invite_codes WHERE created_at > :t OR revoked_at > :t
   ) r ORDER BY k, o;
   '@ | & "<PG_BIN>\psql" "<DATABASE_URL>" -At -v ON_ERROR_STOP=1 -v t=<BACKUP_UNIX_TIME> -o "<REAPPLY_FILE>"
   ```

   The here-string's closing `'@` starts its line. The statements repeat what the server wrote:
   - every `friends_profile` consent row since the backup, a withdrawal among them: the latest row wins
     ([db/social.rs:590-631](../../server/src/db/social.rs#L590));
   - every removal or decline that still stands: the friendship and the requests between the two deleted, the durable
     block inserted, as `remove` does ([db/social.rs:501-542](../../server/src/db/social.rs#L501)). A block that
     stands means the pair made no friendship after it: only the blocker's own request lifts it (`ask`, :374);
   - every invite code created or revoked since, so a rotated link stays dead
     ([db/social.rs:544-588](../../server/src/db/social.rs#L544)). The revoked codes come first, so a player never
     holds two active codes (`invite_codes_one_active`, [0005_social.sql:15](../../server/migrations/0005_social.sql#L15)).

   A statement for a player whom the restored database lacks inserts nothing: that player first opened the app since
   the backup, and the restore drops all of their rows.
3. Create the empty database and restore into it. `<RESTORE_DB>` is a new name that starts with a letter, then
   lower-case letters, digits and `_`, and is not an SQL key word (for example `tgn_restore_20261103`).
   `<RESTORE_DATABASE_URL>` is `<DATABASE_URL>` with its database name replaced by `<RESTORE_DB>`:

   ```powershell
   & "<PG_BIN>\psql" "<DATABASE_URL>" -c "CREATE DATABASE <RESTORE_DB>"
   & "<PG_BIN>\pg_restore" --exit-on-error --single-transaction --no-owner --dbname="<RESTORE_DATABASE_URL>" "<BACKUP_FILE>"
   ```

   Where the role may not create a database, create `<RESTORE_DB>` in the host's panel, owned by the role that
   `<DATABASE_URL>` connects as, and run only the second command. Since PostgreSQL 15 only the database's owner may
   create tables in its `public` schema by default
   ([PostgreSQL 15 release notes](https://www.postgresql.org/docs/release/15.0/)), so a database owned by another role
   refuses the restore. `--single-transaction` restores all or nothing; `--no-owner` makes the connecting role own what
   it restores.
4. Before any player can reach the restored database, repeat the erasures, then the decisions:
   - **Erasures.** Every deletion request answered since the backup was undone: the restore brought the player's rows
     back. Run the erasure again for each entry of your erasure record dated after `<BACKUP_UNIX_TIME>`
     ([privacy-ops.md](privacy-ops.md#answer-a-deletion-request-manual-erasure)), with `<RESTORE_DATABASE_URL>` in
     place of `<DATABASE_URL>`.
   - **Decisions.** Apply the file in one transaction:

     ```powershell
     & "<PG_BIN>\psql" "<RESTORE_DATABASE_URL>" -v ON_ERROR_STOP=1 --single-transaction -f "<REAPPLY_FILE>"
     ```

   Erasures go first. The file holds only what the migrated database kept, so a player who came back after an erasure
   gets their new rows back, and no erasure removes them again. Delete `<REAPPLY_FILE>` once it applied; keep
   `<CHARGES_FILE>` until every charge of it is settled (below).
5. Set `DATABASE_URL=<RESTORE_DATABASE_URL>` in the service's environment and start the previous binary.
6. **Refunds.** A charge of the list with a `paid_at` at or before `<BACKUP_UNIX_TIME>` and a `refunded_at` was
   refunded on the new release. Telegram has returned its Stars, but the restored database shows it paid and its
   purchase granted again. Run `/refund <CHARGE_ID>` for it ([payments-ops.md](payments-ops.md#refund-a-charge)):
   the server treats an API refusal holding `CHARGE_ALREADY_REFUNDED` as refunded and revokes
   ([payments.rs:503-505](../../server/src/telegram/payments.rs#L503); verify: the Bot API's text for an
   already-refunded charge).

On Linux, as in step 4 of [Steps](#steps): the same arguments after `"<PG_BIN>/psql"` and `"<PG_BIN>/pg_restore"`,
with the here-string's SQL fed from a quoted here-document (`<<'SQL'` ... `SQL`) instead of `@'` ... `'@ |`.

The charges of the list with a `paid_at` after `<BACKUP_UNIX_TIME>` were paid on the new release. They are paid in
Telegram, but the restored database no longer knows them, and `/refund <CHARGE_ID>` answers `refund_unknown` for them.
Settle each with its payer, the list's `user_id`:

```text
/refund <CHARGE_ID> <USER_ID>
```

The server refunds the Stars to that payer and records the refund in `unrecorded_refunds`; it grants and revokes
nothing, and a repeat is safe ([payments-ops.md](payments-ops.md#refund-a-charge-the-database-does-not-hold)). Only a
server built from commit `a93fe54` on has this form. A rollback across `0007` runs an older binary, which has not: those
charges can be settled only once a binary that has it runs again. Once players have paid on the new release, prefer a
fix-forward release to a restore. Keep the migrated database until every charge of the list is settled.

The docs lane D2 ran this procedure twice on a socket-only PostgreSQL 18.6 cluster with the tree's migrations
`0001`-`0006`, a backup, and then a stand-in `0007` with a table referencing `users`:

- The first run made a refund and an erasure as SQL stand-ins of their database effects. The restore into a new
  database exited 0 with the backup's tables, rows and a stand-in migration history, and the list showed both charges.
  `pg_restore --clean --if-exists --single-transaction` over the migrated database stopped at `cannot drop constraint
  users_pkey on table public.users because other objects depend on it` and changed nothing.
- The second run executed the PowerShell blocks of steps 2 to 4 and the privacy-ops erasure script as written. Before
  it, the migrated database got a consent withdrawal, a removal, two invite rotations, an erasure, the erased player's
  return and a new player. The restored database then gave the migrated one's answers for every decision, and held
  nothing of the new player. The `/refund` repeat of step 6 was not run.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `static dir refused: ...` | `STATIC_DIR` overlaps `CONTENT_DIR`, holds a dot-entry or a link out of it; or its `build-id.txt` is missing or not 16 lowercase hex digits | point it at a clean copy of `client/dist/`, `build-id.txt` included |
| `startup failed: content: ...` | `server/content/` missing, stale, or `server/catalog.json` does not fit it; `cannot read <path>`: a file a paid manifest names, a half-tier file included, is missing (content from another build than the binary) | rebuild with `npm --prefix client run build` and copy both together |
| `startup failed: database: ...` | the database does not exist, is unreachable, or refuses TLS | create it; check `DATABASE_URL` and `sslmode=verify-full` |
| step 4's decisions stop at `duplicate key value violates unique constraint "invite_codes_one_active"` | an erasure since the backup is missing from the erasure record: the restored database still holds that player's old active code | the single transaction applied nothing; run the erasure for that player on `<RESTORE_DATABASE_URL>`, add it to the record, apply the file again |
| `startup failed: migrations: ...` | a migration file changed after it was applied; or, for a previous binary, a migration it lacks | never edit an applied migration after the first deployment; add a new one; for a rollback, [Roll back](#roll-back) |
| `bot texts refused: ...`, `privacy policy: ...` | a production value is missing | the preconditions above |
