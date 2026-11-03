# Local development

> Run the Mini App in a plain browser on this machine, against the dev server and the mock Telegram environment.
> Use it for daily work on the client, the story and the server; no bot, no tunnel and no real Stars are involved.

The dev setup has three processes: PostgreSQL 18 (the `pgdev` cluster), `server-dev` (the production router plus the
`/dev/*` routes on a fake Bot API) and the Vite dev server (the client with the dev mock compiled in). How the parts
fit: [ARCHITECTURE.md](../ARCHITECTURE.md#overview). The real-bot path is [bot-setup.md](bot-setup.md).

## Preconditions

- Node.js 22.12 or later ([client/package.json:7](../../client/package.json#L7)).
- The Rust toolchain for the workspace ([Cargo.toml](../../Cargo.toml): `server`, `server/dev`, `server/pgdev`):
  Rust 1.94 or later, edition 2024 ([Cargo.toml:6-7](../../Cargo.toml#L6)), and a C compiler for `aws-lc-sys`
  ([Cargo.lock:63-64](../../Cargo.lock#L63)); on Windows the MSVC toolchain (verify: the `aws-lc-sys` build
  requirements for your platform).
- PostgreSQL 18 binaries: `pg_ctl` on `PATH`, or their directory in `PG_BIN`
  ([cluster.rs:49-66](../../server/pgdev/src/cluster.rs#L49)).
- Optional, per lane or per checkout: `DEV_PG_PORT` (default 5487), `DEV_PG_ROOT` (an absolute path; default
  `<repo>/target/pg`), `DEV_API_PORT` (default 8787), `DEV_WEB_PORT` (the e2e preview port, default 4173)
  ([.env.example:33-40](../../.env.example#L33)).

## Steps

1. Install the client packages once per checkout:

   ```powershell
   npm --prefix client ci
   ```

2. Compile the story and encode the assets. `server-dev` refuses to start without
   `server/content/chapters/*/assets.json`, which only the asset tool writes:

   ```powershell
   npm --prefix client run story
   npm --prefix client run assets
   ```

   Expected: `story` exits 0 and prints its findings ([AUTHORING.md](../AUTHORING.md#running-the-story-gate));
   `assets` writes `client/public/assets/` and `server/content/assets/`.

3. Start the dev server in its own terminal and leave it running:

   ```powershell
   cargo run -p server-dev --locked
   ```

   Expected log lines: `dev only: public placeholder secrets, loopback only`, then `listening on 127.0.0.1:8787`
   ([server/dev/src/main.rs:56-69](../../server/dev/src/main.rs#L56)). It brings the `pgdev` cluster up if it is down,
   and recreates the database `tgn_dev_<port>` empty on every launch
   ([main.rs:97-108](../../server/dev/src/main.rs#L97), [lib.rs:59-64](../../server/dev/src/lib.rs#L59)): saves,
   purchases and friends from the previous run are gone.

4. Start the client in a second terminal:

   ```powershell
   npm --prefix client run dev
   ```

   Vite forwards `/api/`, `/dev/` and `/telegram/` to `127.0.0.1:$DEV_API_PORT`, so the page and the API share one
   origin ([vite.config.ts:26-28](../../client/vite.config.ts#L26)).

5. Open `/dev/launch` on the local URL Vite prints, for example `http://localhost:<vite-port>/dev/launch`. The route
   signs initData for a dev user with the dev bot token and redirects to `/` with it in the URL hash, as Telegram opens
   a Mini App ([launch.rs:54-58](../../server/dev/src/launch.rs#L54)). Query parameters, each optional:
   `uid` (default `1001`), `lang` (default `ru`), `name` (default `Dev`), `startapp` (an invite launch,
   `[A-Za-z0-9_-]{1,64}`) ([launch.rs:36-44](../../server/dev/src/launch.rs#L36), :59-67). Use two `uid`s in two
   browser profiles to try friends and gifts.

6. Buy a paid chapter. The dev mock shows a fake Stars sheet instead of Telegram's. Its buttons are `Pay`,
   `Pay, webhook +3 s`, `Pay twice`, `Pending`, `Cancel` and `Fail`
   ([invoice-sheet.ts:30-35](../../client/src/telegram/dev/invoice-sheet.ts#L30)). A paying button calls
   `POST /dev/simulate-payment`, which feeds a `pre_checkout_query` and then a `successful_payment` through the real
   webhook handler with the real secret header ([simulate.rs:1-4](../../server/dev/src/simulate.rs#L1)). The client
   unlocks only from the server's answer, never from the sheet.

## Verify

- `GET /api/health` answers `ok` ([server/src/api/mod.rs:53](../../server/src/api/mod.rs#L53)).
- Home shows the two demo stories (see [README](../../README.md#home-and-the-demo-stories)); `ch1` and `ch3` start
  without a purchase, and `ch2` / `ch4` open the paywall.
- A save is stored per story and slot at `/api/saves/<story>/<slot>`; the slots are `auto`, `s1`, `s2` and `s3`
  ([server/src/api/mod.rs:60](../../server/src/api/mod.rs#L60),
  [0001_init.sql:77](../../server/migrations/0001_init.sql#L77)).

## The dev database cluster (`pgdev`)

`pgdev` manages the cluster on `DEV_PG_PORT` under `DEV_PG_ROOT`
([server/pgdev/src/main.rs:1-12](../../server/pgdev/src/main.rs#L1)):

```powershell
cargo run -p pgdev --locked -- up       # start the cluster if needed and create tgn_local
cargo run -p pgdev --locked -- status   # port, data directory, pg_ctl status; exit 3 when no server runs
cargo run -p pgdev --locked -- down     # stop the cluster
cargo run -p pgdev --locked -- reset    # stop it, then delete <root>/<port>/data (every database on it)
```

`tgn_local` is the database a local `server serve` runs on: the committed
[.env.example:24](../../.env.example#L24) points `DATABASE_URL` at it.

### A rewritten migration

Until the first deployment, a migration under `server/migrations/` may be rewritten in place; after the first
deployment the migrations are append-only ([STORIES-PLAN.md](../STORIES-PLAN.md) Y7 and SQ3, the LS2 rule). `server-dev` is not affected: its database is
new on every launch. A long-lived `tgn_local` that applied the old text refuses the new one at startup with sqlx's
`migration <n> was previously applied but has been modified` (a `StartupError::Migrate`,
[server/src/lib.rs:117-119](../../server/src/lib.rs#L117)). Recreate the cluster:

```powershell
cargo run -p pgdev --locked -- reset
cargo run -p pgdev --locked -- up
```

## The production binary on this machine

`server serve` runs locally on the committed placeholders: they are accepted only with `TELEGRAM_ENV=test` and a
`localhost`, loopback or `.invalid` `PUBLIC_APP_URL` ([config.rs:186-200](../../server/src/config.rs#L186)), which
`.env.example` sets. The server reads its process environment only; nothing loads `.env` for it
([config.rs:136-138](../../server/src/config.rs#L136)). From the repository root, in PowerShell, the loader line reads
`.env.example` itself and leaves any `.env` of yours untouched:

```powershell
Get-Content .env.example | ForEach-Object { if ($_ -match '^([A-Z_]+)=(.*)$') { Set-Item "env:$($Matches[1])" $Matches[2] } }
cargo run -p pgdev --locked -- up
cargo run -p server --locked -- serve
```

The same line loads a git-ignored file of your own (for a test bot, [bot-setup.md](bot-setup.md#steps), step 4):
replace `.env.example` with its path. The variables last for that shell only.

With the placeholder token the Bot API gateway is disabled: every Bot API call fails at once and nothing reaches
Telegram ([gateway.rs:235-243](../../server/src/telegram/gateway.rs#L235)). To serve the built client from the same
process, see [deploy.md](deploy.md#build).

## The e2e run

Once per machine, install the Playwright browser the suite runs on (`chromium`,
[playwright.config.ts:44](../../client/e2e/playwright.config.ts#L44)); `npm ci` does not download it. It is a
download of about 150 MB (PROTOTYPE-PLAN E3):

```powershell
Push-Location client; npx playwright install chromium; Pop-Location
```

Then:

```powershell
npm --prefix client run e2e
```

On a cold Rust cache, build `server-dev` first (`cargo build -p server-dev --locked`): the suite waits at most 600 s
for its `cargo run` ([playwright.config.ts:53-54](../../client/e2e/playwright.config.ts#L53)).

It compiles the story and the assets, builds the client with `--mode e2e` into `client/dist-e2e/` (the dev mock
compiled in), starts `cargo run -p server-dev --locked` (or the full command in `SERVER_DEV_CMD`) and `vite preview` on
`DEV_API_PORT` / `DEV_WEB_PORT`, and fails at once when a port already answers
([client/package.json:17](../../client/package.json#L17),
[playwright.config.ts:1-4](../../client/e2e/playwright.config.ts#L1), :45-60). `client/dist-e2e/` is a test build:
never serve it to players ([deploy.md](deploy.md#build)).

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `server-dev` exits with `cannot bind 127.0.0.1:8787` | another `server-dev`, another checkout or a local `server serve` holds the port | stop it, or set `DEV_API_PORT` for both `server-dev` and `npm --prefix client run dev` |
| `server serve` exits with `server failed: ...` after `opening database` | `server-dev` (or another process) holds its `LISTEN_ADDR`, by default `127.0.0.1:8787` ([main.rs:150](../../server/src/main.rs#L150), :134) | stop `server-dev`, or set `LISTEN_ADDR` |
| the e2e fails at the first browser launch (`Executable doesn't exist`) | the Playwright browser is not installed | the install line under "The e2e run" |
| `cannot reset the dev database: ...` | no PostgreSQL binaries found, or the cluster cannot start | set `PG_BIN` to the PostgreSQL 18 `bin` directory; `cargo run -p pgdev --locked -- status` |
| `startup failed: content: ...` from `server-dev` | `server/content/` is missing or stale | rerun `npm --prefix client run story` and `npm --prefix client run assets` |
| the page shows "open in Telegram" | it was opened at `/`, not through `/dev/launch` | open `/dev/launch` |
| `migration <n> was previously applied but has been modified` | `tgn_local` holds an older text of a rewritten migration | `pgdev reset`, then `pgdev up` (above) |
| `DEV_API_PORT must be a port number 1..=65535` | the variable holds something else | unset it or set a decimal port ([main.rs:82-95](../../server/dev/src/main.rs#L82)) |
