# Webhook

> Register the Telegram webhook, rotate its secret, expose a local server over HTTPS and check that updates arrive.
> Run it at the first setup, after a `PUBLIC_APP_URL` change, and whenever payments or commands stop answering.

The server takes every bot update on one route, `POST /telegram/webhook`, outside `/api`
([server/src/lib.rs:133-145](../../server/src/lib.rs#L133)). The handler is described in
[ARCHITECTURE.md](../ARCHITECTURE.md#payments-as-built); the bot itself in [bot-setup.md](bot-setup.md).

## Preconditions

- A running `server serve` with the bot's configuration ([bot-setup.md](bot-setup.md#steps), step 6; on a host
  [deploy.md](deploy.md#steps)), reachable by Telegram at `<PUBLIC_APP_URL>` over HTTPS. That holds in the test
  environment too: `setWebhook` takes an HTTPS URL ([Bot API](https://core.telegram.org/bots/api#setwebhook)); only
  Mini App links may be `http://` there. One `PUBLIC_APP_URL` serves both, so an `http://` value fails `server setup`.
- The same environment in the shell that runs `server setup`, `<BOT_TOKEN>` and `<WEBHOOK_SECRET>` included.

## Steps

### Registering

```powershell
cargo run -p server --release --locked -- setup
```

`server setup` calls `setWebhook` with the URL `<PUBLIC_APP_URL>telegram/webhook` (`app_url`,
[setup.rs:22-35](../../server/src/telegram/setup.rs#L22)), `secret_token = WEBHOOK_SECRET` and
`allowed_updates = ["message", "pre_checkout_query"]`
([gateway.rs:427-436](../../server/src/telegram/gateway.rs#L427), :47-48). A `successful_payment` and a
`refunded_payment` arrive inside `message` updates. The same call registers the commands and the menu button
([bot-setup.md](bot-setup.md#steps), step 7).

### What the route answers

| Answer | When | Telegram |
|---|---|---|
| 401 | the `X-Telegram-Bot-Api-Secret-Token` header is missing, repeated or not `WEBHOOK_SECRET` (compared in constant time, body unread) | retries (below) |
| 413 | the body is over 1 MiB (`WEBHOOK_BODY_LIMIT`) | retries |
| 200 | the update was handled, or there is nothing to do with it (an undecodable update included) | forgets it |
| 500 | a money fact (a payment, a refund) or an admin `/refund`'s database step could not be recorded | redelivers it |

Sources: [webhook.rs:29](../../server/src/telegram/webhook.rs#L29), :52-71. Telegram repeats a request answered
outside 2xx "and give[s] up after a reasonable amount of attempts"
([Bot API, setWebhook](https://core.telegram.org/bots/api#setwebhook)).

### Rotating the secret

1. Choose a new `<WEBHOOK_SECRET>` (1-256 characters of `A-Z a-z 0-9 _ -`,
   [config.rs:325-335](../../server/src/config.rs#L325)).
2. Set it in the server's environment and restart `server serve`. From now on, updates signed with the old secret get
   401 and Telegram retries them.
3. Run `server setup` with the new value at once. Telegram then sends the new secret, and the retried updates pass.

Between steps 2 and 3 no update is handled. A `pre_checkout_query` must be answered within 10 s or Telegram cancels
the payment ([payments-stars](https://core.telegram.org/bots/payments-stars)), so rotate at a quiet hour.

### Exposing HTTPS

For a server on the owner's machine (PROTOTYPE-PLAN D2, step 5):

- **A named Cloudflare tunnel**: a stable hostname; register it once as `PUBLIC_APP_URL`.
- **A quick tunnel**: `cloudflared tunnel --url http://127.0.0.1:8787` prints a `trycloudflare.com` URL, and "the
  hostname changes each time you create a Quick Tunnel"
  ([Cloudflare docs](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/)).
  After each new tunnel: set `PUBLIC_APP_URL` to `https://<printed-host>/`, restart `server serve`, run
  `server setup`, and update the Main Mini App URL and the privacy policy URL (`<PUBLIC_APP_URL>api/privacy`) in
  @BotFather ([bot-setup.md](bot-setup.md#steps), steps 2-3). For the first run, start the tunnel before you set
  `PUBLIC_APP_URL`: `cloudflared` prints the host even while nothing listens on the port yet.

`cloudflared` is not part of this repository; install it from Cloudflare. `8787` is the default `LISTEN_ADDR` port
([config.rs:169-176](../../server/src/config.rs#L169)).

## Verify

Ask the Bot API for the webhook state (`getWebhookInfo`). The base is `https://api.telegram.org/bot<BOT_TOKEN>` in
production and `https://api.telegram.org/bot<BOT_TOKEN>/test` in the test environment, as the gateway builds it
([gateway.rs:224-232](../../server/src/telegram/gateway.rs#L224)):

```powershell
Invoke-RestMethod "https://api.telegram.org/bot<BOT_TOKEN>/test/getWebhookInfo"
```

Expected: `url` is `<PUBLIC_APP_URL>telegram/webhook`, `allowed_updates` lists `message` and `pre_checkout_query`, and
`pending_update_count` falls to 0. `last_error_date` / `last_error_message` show the latest failed delivery
([Bot API, WebhookInfo](https://core.telegram.org/bots/api#webhookinfo)). The command puts the token in a URL: run it
in a private shell and do not paste its history anywhere.

The server's own log: a refused secret logs nothing that holds the body, a header or the secret; a payment or refund
line names the charge id only (ARCHITECTURE "Payments as built", the route).

## Roll back

Register the previous URL by running `server setup` with the previous configuration. To stop updates entirely, call
the Bot API's `deleteWebhook` (drop `/test` for the production bot; same private-shell rule as above):

```powershell
Invoke-RestMethod "https://api.telegram.org/bot<BOT_TOKEN>/test/deleteWebhook"
```

Its `drop_pending_updates` parameter drops what is queued ([Bot API](https://core.telegram.org/bots/api#deletewebhook));
never pass it while a payment may be in the queue: a dropped `successful_payment` is a paid charge the server never
records.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `last_error_message` mentions 401 | `WEBHOOK_SECRET` differs between the server and the registration | run `server setup` with the server's value |
| `last_error_message` mentions 500, `pending_update_count` grows | the database refused a payment or refund write | read the server log (`error!` lines), fix the database; Telegram redelivers |
| connection or TLS errors | the tunnel or the host is down, or the quick-tunnel host changed | restart the tunnel; after a quick tunnel, the steps under "Exposing HTTPS" |
| payments hang at the Stars sheet | `pre_checkout_query` is not reaching the server, or not answered within 10 s | check the webhook state above; the pre-checkout answer is cut at 5 s ([gateway.rs:38](../../server/src/telegram/gateway.rs#L38)) |
