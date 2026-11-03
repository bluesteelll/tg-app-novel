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
  missing one is a startup error ([server/src/lib.rs:63-70](../../server/src/lib.rs#L63)).
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
  ([vite.config.ts:24-33](../../client/vite.config.ts#L24)). `STATIC_DIR` is checked at startup: it must not be, or
  contain, or sit inside `CONTENT_DIR`, no entry may resolve outside it, and no dot-entry may be in it except the
  root's `.vite` directory ([static_files.rs:145-149](../../server/src/api/static_files.rs#L145)).

## Steps

1. Copy to the host, keeping the layout the configuration names: the binary, `client/dist/` (for `STATIC_DIR`) and
   `server/content/` (for `CONTENT_DIR`). The two directories must stay disjoint.
2. Set the environment of the service (the variables: [bot-setup.md](bot-setup.md#steps), step 4), with
   `TELEGRAM_ENV=prod`, `STATIC_DIR` and `CONTENT_DIR` pointing at the copied directories.
3. Stop the running server. It shuts down gracefully on Ctrl+C only, which is SIGINT on Linux
   ([main.rs:157-164](../../server/src/main.rs#L157)): a service manager must stop it with that signal (systemd sends
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
   ([main.rs:101-105](../../server/src/main.rs#L101)); the `STATIC_DIR` check (:106-116); then the content, the
   catalog, the privacy policy and the Bot API gateway; last the database pool and the migrations
   ([server/src/lib.rs:63-89](../../server/src/lib.rs#L63)). Pending migrations apply here, in this start.
6. If `PUBLIC_APP_URL` or `WEBHOOK_SECRET` changed, run `.\server.exe setup` with the same environment
   ([webhook.md](webhook.md#registering)).

## Verify

- The log shows `bot texts checked`, `opening database` with the target (never the password) and
  `listening` with the address ([main.rs:41](../../server/src/main.rs#L41), :118, :151).
- `GET <PUBLIC_APP_URL>api/health` answers `ok`; `GET <PUBLIC_APP_URL>api/privacy` shows no placeholder.
- `/assets/*` answers with `Cache-Control: public, max-age=31536000, immutable`, everything else `no-cache`
  ([static_files.rs:22-26](../../server/src/api/static_files.rs#L22)).
- Open the bot, start a free chapter, buy a paid one (in the test environment first).

## Migrations

`server/migrations/` is applied in order at every start. Until the first deployment a migration file may be rewritten
in place; from the first deployment on they are append-only: a schema change is a new file
([STORIES-PLAN.md](../STORIES-PLAN.md) Y7 and SQ3). A database that applied an older text of a file refuses the start
(`migration <n> was previously applied but has been modified`). There are no down migrations.

## Clients open during a deploy

A client bundle built before a change of the chapter manifest's format rejects the new key and fails to load the
chapter until the player reopens the Mini App (`decodeChapter` returns `malformed('assets')`,
[story/chapters.ts:127-130](../../client/src/story/chapters.ts#L127)). Nothing forces a reload yet, and the story
version does not tell the old session. After a release that changes the manifest format, expect "reopen" reports for a
while.

## Roll back

Start the previous binary with the previous `client/dist/` and `server/content/`. If the release applied a new
migration, the previous binary does not know it: sqlx refuses a database with a migration it lacks (verify on a copy
before relying on this), and there are no down migrations. A rollback across a migration then restores the step 4
backup into a new, empty database and points the server at it. Restoring over the migrated database does not work:
`pg_restore --clean` drops only the backup's own objects. Every migration after `0001` adds a table that references
`users` (`0002_puzzles.sql` to `0006_achievements.sql`), and such a table, absent from the backup, blocks the drop of
the `users` key. The migrated database stays as it is, as the source of the lists below.

A restore drops every row written since the backup. Steps 2, 4 and 6 repeat the refunds, the erasures and the
players' privacy decisions; the charges paid on the new release stay unknown to the restored database (below).
Everything else written on the new release is lost:

- saves, puzzle progress and hint unlocks, stat events and achievement unlocks;
- wallet balances and ledger rows: hints spent since come back, gifts and credits since are gone;
- friend requests, friendships and referrals made since;
- the players who first opened the app since: the restored database has no `users` row for them.

Players see their game as it was at the backup; tell them before the restart.

1. Stop the server.
2. From the migrated database, save two files. The first lists the charges paid or refunded since the backup (`-o`):

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
   gets their new rows back, and no erasure removes them again.
5. Set `DATABASE_URL=<RESTORE_DATABASE_URL>` in the service's environment and start the previous binary.
6. **Refunds.** A charge of the list with a `paid_at` at or before `<BACKUP_UNIX_TIME>` and a `refunded_at` was
   refunded on the new release. Telegram has returned its Stars, but the restored database shows it paid and its
   purchase granted again. Run `/refund <CHARGE_ID>` for it ([payments-ops.md](payments-ops.md#refund-a-charge)):
   the server treats an API refusal holding `CHARGE_ALREADY_REFUNDED` as refunded and revokes
   ([payments.rs:214-216](../../server/src/telegram/payments.rs#L214); verify: the Bot API's text for an
   already-refunded charge).

On Linux, as in step 4 of [Steps](#steps): the same arguments after `"<PG_BIN>/psql"` and `"<PG_BIN>/pg_restore"`,
with the here-string's SQL fed from a quoted here-document (`<<'SQL'` ... `SQL`) instead of `@'` ... `'@ |`.

The charges of the list with a `paid_at` after `<BACKUP_UNIX_TIME>` were paid on the new release. They are paid in
Telegram, but the restored database no longer knows them, and `/refund` answers `refund_unknown` for them
([payments-ops.md](payments-ops.md#refund-a-charge)); re-entering them is not built. Once players have paid on the new
release, prefer a fix-forward release to a restore. Keep the migrated database until every charge of the list is
settled.

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
| `static dir refused: ...` | `STATIC_DIR` overlaps `CONTENT_DIR`, holds a dot-entry or a link out of it | point it at a clean copy of `client/dist/` |
| `startup failed: content: ...` | `server/content/` missing, stale, or `server/catalog.json` does not fit it | rebuild with `npm --prefix client run build` and copy both together |
| `startup failed: database: ...` | the database does not exist, is unreachable, or refuses TLS | create it; check `DATABASE_URL` and `sslmode=verify-full` |
| `startup failed: migrations: ...` | a migration file changed after it was applied; or, for a previous binary, a migration it lacks | never edit an applied migration after the first deployment; add a new one; for a rollback, [Roll back](#roll-back) |
| `bot texts refused: ...`, `privacy policy: ...` | a production value is missing | the preconditions above |
