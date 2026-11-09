# Bot setup

> Create the bot in @BotFather, connect it to a running server and register its webhook, commands and menu button.
> Run it once per bot: first in Telegram's test environment, later for the production bot.

The server half is one command, `server setup`; the rest is @BotFather and the host. Serving the app itself:
[deploy.md](deploy.md). The webhook in detail: [webhook.md](webhook.md). Secrets are placeholders here (`<BOT_TOKEN>`,
`<WEBHOOK_SECRET>`, `<TOKEN_KEY>`); never write a real value into the repository.

## Preconditions

- A Telegram account for the bot owner with 2-step verification on. Telegram "highly recommends" it for the account
  that controls a bot selling for Stars ([payments-stars](https://core.telegram.org/bots/payments-stars)); the plan
  makes it an owner step (PROTOTYPE-PLAN D2, step 8).
- For a test bot: an account in Telegram's test environment. It is a separate environment with its own accounts and
  its own @BotFather. To log in: on iOS tap the Settings icon 10 times, then Accounts, Login to another account, Test;
  on Telegram Desktop open Settings, Shift + Alt + right-click "Add Account", then "Test Server"
  ([bots/features, test environment](https://core.telegram.org/bots/features#testing-your-bot)). Stars payments can be
  tested there freely ([payments-stars](https://core.telegram.org/bots/payments-stars)).
- A host that can reach the Bot API and that Telegram can reach over HTTPS, in both environments. The configuration
  accepts an `http://` `PUBLIC_APP_URL` under `test` ([config.rs:356-374](../../server/src/config.rs#L356)), because
  the test environment allows Mini App links without TLS ([bots/webapps](https://core.telegram.org/bots/webapps)). The
  webhook does not: `setWebhook` takes an HTTPS URL ([Bot API](https://core.telegram.org/bots/api#setwebhook)), and
  `server setup` builds the webhook URL from the same `PUBLIC_APP_URL`
  ([setup.rs:22-35](../../server/src/telegram/setup.rs#L22)). So `PUBLIC_APP_URL` is `https://` for a working bot.
  Exposing a local machine: [webhook.md](webhook.md#exposing-https).
- The host clock synced by NTP. initData whose `auth_date` is more than 60 s ahead of the server clock is refused as
  `initdata_expired` ([initdata.rs:11](../../server/src/auth/initdata.rs#L11), :106-107), and "reopen the app" cannot
  help while the clock is wrong (PROTOTYPE-PLAN, the failure table's server-clock row).
- For a test bot run on this machine (steps 6-7): the tools of [local-dev.md](local-dev.md#preconditions) (Node.js,
  the Rust toolchain, the PostgreSQL 18 binaries) and `npm --prefix client ci` once.

## Steps

1. **Create the bot.** In @BotFather (the test environment's for a test bot) send `/newbot` and follow the prompts.
   Keep the token it prints as `<BOT_TOKEN>`; it is also the key of the initData HMAC
   ([config.rs:33-34](../../server/src/config.rs#L33)).

2. **Set the Main Mini App to `<PUBLIC_APP_URL>`** in @BotFather's bot settings (verify: the menu path in the current
   @BotFather; [bots/webapps](https://core.telegram.org/bots/webapps), "Launching the main Mini App").
   `<PUBLIC_APP_URL>` is the HTTPS root the server answers on, with a trailing `/`, for example
   `https://<your-host>/`.

3. **Set the privacy policy URL** in @BotFather to `<PUBLIC_APP_URL>api/privacy`: the server answers
   `GET /api/privacy` without a token ([legal.rs:214-215](../../server/src/api/legal.rs#L214)), and the bot's
   `/privacy` sends the same link ([commands.rs:105-108](../../server/src/telegram/commands.rs#L105)). (verify: the
   @BotFather entry for a privacy policy; META-PLAN asks for it.) Filling the policy: [privacy-ops.md](privacy-ops.md).

4. **Fill the server configuration** on the host. The variables are parsed in
   [server/src/config.rs](../../server/src/config.rs) (`Config::from_lookup`, :143-257) and documented in
   [.env.example](../../.env.example). The server reads its process environment only; nothing loads a `.env` file for
   it ([config.rs:136-138](../../server/src/config.rs#L136)). On this machine, set the variables in the shell that
   starts the server, for example from a git-ignored file with the loader line of
   [local-dev.md](local-dev.md#the-production-binary-on-this-machine); on a host, in the service's environment.

   | Variable | Value |
   |---|---|
   | `BOT_TOKEN` | `<BOT_TOKEN>` from step 1 |
   | `WEBHOOK_SECRET` | `<WEBHOOK_SECRET>`: 1-256 characters of `A-Z a-z 0-9 _ -` (:325-335) |
   | `TOKEN_KEY` | `<TOKEN_KEY>`: 32 random bytes as 64 hex characters (:337-342), not the bot token |
   | `TELEGRAM_ENV` | `test` for a test-environment bot, `prod` for the production bot (:348-354) |
   | `PUBLIC_APP_URL` | `<PUBLIC_APP_URL>`; `https://` (the configuration requires it under `prod`, :356-374; the webhook needs it in both environments, above) |
   | `ADMIN_TELEGRAM_IDS` | the owner's Telegram user id (comma-separated positive integers): who may run `/refund` (:410-415); a test-environment account has its own id (below) |
   | `STATIC_DIR` | `client/dist` ([deploy.md](deploy.md#build)) |
   | `CONTENT_DIR` | `server/content` |
   | `DATABASE_URL` | the PostgreSQL database; off loopback it must carry `sslmode=verify-full` ([db/mod.rs:160-187](../../server/src/db/mod.rs#L160)); on this machine `pgdev`'s `tgn_local` ([.env.example:24](../../.env.example#L24), [local-dev.md](local-dev.md#the-dev-database-cluster-pgdev)) |
   | `PRIVACY_OPERATOR_FILE` | required under `prod`: [privacy-ops.md](privacy-ops.md) |
   | `TOKEN_TTL_SECS`, `INITDATA_MAX_AGE_SECS`, `LISTEN_ADDR` | optional: 900-3600 (default 1800), 1-86400 (default 86400), default `127.0.0.1:8787` |

   One way to make `<TOKEN_KEY>` in Windows PowerShell 5.1 (32 random bytes as 64 hex characters); its output also
   fits the `WEBHOOK_SECRET` rule, so run it twice, once for each:

   ```powershell
   $b = New-Object byte[] 32; [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); -join ($b | ForEach-Object { $_.ToString('x2') })
   ```

   **Your Telegram user id** for `ADMIN_TELEGRAM_IDS`: leave it unset for now (it is optional, :163) and do steps 6
   and 7. Then open the Mini App from your account with the bot's menu button, which step 7 sets, and read the `users`
   row it wrote (the id comes from verified initData only,
   [0001_init.sql:3-10](../../server/migrations/0001_init.sql#L3)). Set the id and restart the server:

   ```powershell
   & "<PG_BIN>\psql" "<DATABASE_URL>" -c "SELECT id, first_name FROM users ORDER BY created_at DESC LIMIT 5"
   ```

   A wrong id is accepted silently: `/refund` then answers the unknown-command reply
   ([commands.rs:113-116](../../server/src/telegram/commands.rs#L113)).

   The three secrets of `.env.example` are public placeholders: the server refuses them unless `TELEGRAM_ENV=test` and
   `PUBLIC_APP_URL` is local ([config.rs:186-200](../../server/src/config.rs#L186)). Every problem is reported at once,
   by variable name and rule, never by value ([config.rs:91-132](../../server/src/config.rs#L91)).

5. **Replace the draft bot texts before a production start.** `server/locales/bot.ru.json` and `bot.en.json` list
   ten keys under `drafts` ([bot.en.json:3](../../server/locales/bot.en.json#L3)): `admin_auto_refund_failed`,
   `admin_unapplied`, `payment_unapplied`, `paysupport`, `paysupport_refunding`, `refund_unknown`,
   `refund_unrecorded_done`, `refund_usage`, `support` and `terms`. The `/terms`, `/support` and `/paysupport` texts
   are placeholders with no real contact; the payment and refund notices are engineering wording. Under
   `TELEGRAM_ENV=prod`, `server serve` and `server setup` refuse to start while either file lists a draft; under
   `test` they log a warning ([main.rs:36-56](../../server/src/main.rs#L36),
   [texts.rs:349-380](../../server/src/telegram/texts.rs#L349)).
   The texts are compiled into the binary, so the edit needs a rebuild (a VALUES step for the owner, OPEN-QUESTIONS
   Q4). The same commit changes the test that pins the drafts: `bot_texts_complete_and_within_limits`
   ([server/tests/it/bot.rs:163](../../server/tests/it/bot.rs#L163)) expects `drafts` to be exactly the ten keys of
   `DRAFTS` in both files ([bot.rs:77-88](../../server/tests/it/bot.rs#L77), compared at :139). Without that change
   `cargo test` fails, and a deploy needs green gates ([deploy.md](deploy.md#preconditions)).

6. **Start the server** and check `GET <PUBLIC_APP_URL>api/health` answers `ok`. For a test bot on this machine, from
   the repository root, with the step 4 environment (`TELEGRAM_ENV=test`, `STATIC_DIR=client/dist`) and after
   `npm --prefix client run build`:

   ```powershell
   cargo run -p server --release --locked -- serve
   ```

   Stop `server-dev` first, or set another `LISTEN_ADDR`: both listen on `127.0.0.1:8787` by default. On a production
   host: [deploy.md](deploy.md#steps).

7. **Run the setup** with the same environment:

   ```powershell
   cargo run -p server --release --locked -- setup
   ```

   It opens no database. It makes one `BotGateway::setup` call: `setWebhook` at `<PUBLIC_APP_URL>telegram/webhook`
   with `WEBHOOK_SECRET` and the updates `message` and `pre_checkout_query`; `setMyCommands` for `/start`,
   `/paysupport`, `/support`, `/terms` and `/privacy`, in English by default and in Russian for `ru`, `uk`, `be` and
   `kk`; then `setChatMenuButton`, a Mini App button in Russian that opens `PUBLIC_APP_URL`
   ([main.rs:58-91](../../server/src/main.rs#L58), [setup.rs:37-77](../../server/src/telegram/setup.rs#L37),
   [gateway.rs:427-460](../../server/src/telegram/gateway.rs#L427), :47-48). `/refund` is not listed: it is the
   admins' only. Expected log line: `bot set up` with the webhook URL. Run it again after every change of
   `PUBLIC_APP_URL` or `WEBHOOK_SECRET`.

8. **Inline mode** (verify on the real bot, META-PLAN MQ7): whether `savePreparedInlineMessage`, which the share uses,
   needs inline mode switched on with @BotFather's `/setinline`. Without a prepared message the share still works: the
   server answers a null message id and the client falls back to a share link
   (`share_prepare_failure_falls_back_to_link`, [server/tests/it/share.rs](../../server/tests/it/share.rs)).

## Verify

- `/start` in the bot chat answers with a button that opens the Mini App
  ([commands.rs:81-101](../../server/src/telegram/commands.rs#L81)); the menu button opens it too.
- `/terms`, `/support`, `/paysupport` and `/privacy` answer; `/refund` from a non-admin gets the unknown-command reply
  ([commands.rs:113-116](../../server/src/telegram/commands.rs#L113)).
- Opening the Mini App reaches Home; a purchase in the test environment unlocks the chapter (the flow:
  [payments-ops.md](payments-ops.md)).
- The webhook state: [webhook.md](webhook.md#verify).

## Roll back

Point the bot elsewhere by running `server setup` from a server configured with the other `PUBLIC_APP_URL`. To stop
updates entirely, delete the webhook with the Bot API's `deleteWebhook` (the command:
[webhook.md](webhook.md#roll-back)).

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `invalid configuration: BOT_TOKEN: invalid (is the committed .env.example placeholder ...)` | a placeholder secret with a reachable URL or `prod` | set a real `<BOT_TOKEN>`, `<WEBHOOK_SECRET>` and `<TOKEN_KEY>` |
| `bot texts refused: ...` at start | `drafts` not empty under `TELEGRAM_ENV=prod` | step 5 |
| `setup failed: bot setup: ...` | a Bot API call failed (token, an `http://` `PUBLIC_APP_URL`, network); nothing after it ran | fix the cause and run `server setup` again |
| `server failed: ...` after `opening database` | the listen address is taken, for example by `server-dev` on `127.0.0.1:8787` ([main.rs:154](../../server/src/main.rs#L154), :138) | stop the other process, or set `LISTEN_ADDR` |
| every open of the app ends on "reopen" (`initdata_expired`) | the host clock is ahead or behind | NTP time sync on the host |
| `privacy policy: placeholders left under TELEGRAM_ENV=prod: ...` | the policy is not filled | [privacy-ops.md](privacy-ops.md) |
