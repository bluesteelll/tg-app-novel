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
- `pg_dump` and `pg_restore` from the PostgreSQL 18 `bin` directory (`<PG_BIN>`), for the backup in step 4.
- A host with PostgreSQL 18 and an empty or already migrated database. Off loopback, `DATABASE_URL` must say
  `sslmode=verify-full` ([db/mod.rs:160-187](../../server/src/db/mod.rs#L160)). The server creates no database: a
  missing one is a startup error ([server/src/lib.rs:63-70](../../server/src/lib.rs#L63)).
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
   file reads back. `<BACKUP_FILE>` is a path on the host outside the release directories; keep one per release:

   ```powershell
   & "<PG_BIN>\pg_dump" --format=custom --file="<BACKUP_FILE>" "<DATABASE_URL>"
   & "<PG_BIN>\pg_restore" --list "<BACKUP_FILE>"
   ```

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
before relying on this), and there are no down migrations. A rollback across a migration is then a restore of the
step 4 backup, with no server running:

```powershell
& "<PG_BIN>\pg_restore" --clean --if-exists --single-transaction --dbname="<DATABASE_URL>" "<BACKUP_FILE>"
```

A restore drops every row written since the backup, payments included. Those charges are paid in Telegram, but the
restored database no longer knows them, and `/refund` answers `refund_unknown` for them
([payments-ops.md](payments-ops.md#refund-a-charge)). Before restoring, save the payments written since the backup
(the first query of [payments-ops.md](payments-ops.md#find-a-purchase-by-its-charge-id) with
`WHERE p.paid_at > <backup unix time>`); re-entering them is not built. Once players have paid on the new release,
prefer a fix-forward release to a restore.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `static dir refused: ...` | `STATIC_DIR` overlaps `CONTENT_DIR`, holds a dot-entry or a link out of it | point it at a clean copy of `client/dist/` |
| `startup failed: content: ...` | `server/content/` missing, stale, or `server/catalog.json` does not fit it | rebuild with `npm --prefix client run build` and copy both together |
| `startup failed: database: ...` | the database does not exist, is unreachable, or refuses TLS | create it; check `DATABASE_URL` and `sslmode=verify-full` |
| `startup failed: migrations: ...` | a migration file changed after it was applied | never edit an applied migration after the first deployment; add a new one |
| `bot texts refused: ...`, `privacy policy: ...` | a production value is missing | the preconditions above |
