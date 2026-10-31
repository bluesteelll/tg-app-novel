# Promotion research 14: a separate entry bot for third-party ad broadcasts (owner follow-up to 11)

- Date: 2026-10-31. Inputs: 11 §3 and §5, V6 (row 23 and the arithmetic), V3 (the FAS transition), PROMOTION.md §12.
- Labels as in PROMOTION.md §1: DOCUMENTED, CLAIMED, ANALYSIS, ASSUMPTION, INTERPRETATION (not legal advice), Gap.
- R3 stands: the owner accepts the ad-law risk. The legal items below are facts, not blockers.
- V8 checked this report: 19 CONFIRMED, 11 CORRECTED, 1 UNSUPPORTED. Its corrections are applied in this text.

## The request

The owner proposes:
- **One entry bot** that every new user reaches first. It forwards them to the main bot.
- **Third-party ad broadcasts** (about one ad a day) go out only from the entry bot.
- **If Telegram blocks the entry bot, the main bot keeps working.**

The owner adds:
- A daily ad is not spam.
- The model is common: the owner sees it regularly.

## TL;DR

- **A separate bot removes the strongest objection in 11 / V6.**
  - The exchange gets the entry bot's token, never the main bot's.
  - The main bot's token derives the initData key and controls payments and refunds. It never leaves our server.
  - Users who block the ad bot keep the main bot's announcements.
- **The owner's market observation holds.**
  - An exchange catalogue exists (11 §3), and a vendor blog lists mailings as a standard bot-ad format ([3]).
  - No case of a bot banned for ad mailings was found (Gap). This report and V8 both searched again on 2026-10-31.
- **The isolation is partial (DOCUMENTED + INTERPRETATION).**
  - §5.2: Telegram "may terminate your TPA, your account, or both" [1].
  - §10: "the Telegram account tied to your TPA may also be banned" at Telegram's sole discretion. So may "any
    channels or communities affiliated with your TPA" [1].
  - The Terms bind "you, the developer", not one account. A separate owner account lowers the risk to the main bot,
    but cannot remove it.
  - The affiliation clause names our **channel and community chats**, so the ad bot must link only to the main bot.
  - §5.2(f) forbids attempts to "circumvent bans or content moderation" [1]. The ad bot is therefore one-shot: it
    earns until a ban and is not replaced.
- **Telegram Ads traffic cannot go through the entry bot or a redirect domain** (Ads guidelines §4.3 [6]).
  - The gate applies only to TikTok, blogger and own-post traffic.
  - Telegram Ads campaigns point straight at the main bot.
- **The exchange also receives our users' Telegram IDs, which we upload (CLAIMED, vendor guide).**
  - The list includes 14-17-year-olds.
  - It is a 152-FZ third-party transfer question, like the SDK data in 11.
- **The gate adds one screen for every new user, and that costs Stars revenue.** No measured hop loss exists (Gap).
  - At base inputs the gate beats having no ad bot only while the hop loses under ≈ 20 % of new users. The low and high
    inputs give 11 % and 45 %.
  - Against the opt-in satellite (design B), the threshold is lower still.
  - At the 1-Star chapter placeholder, ads dominate and the hop cost does not matter.
- **Recommendation:** workable under the conditions in §5.
  - Use a measured split for non-Telegram-Ads traffic.
  - It is a growth-phase item: exchanges need ≥ 1,000 active users.
  - That phase most likely starts after the FAS no-liability window for Telegram ads closes on 2026-12-31 (V3).

## 1. What the separate bot fixes

- **The token.**
  - The exchange model needs the bot token (V6 row 23). Bot API requests carry the token as the only credential
    (DOCUMENTED [2]). The token "can be used by anyone to control your bot" (DOCUMENTED [7]).
  - The Mini App key is `HMAC_SHA256(<bot_token>, "WebAppData")` (DOCUMENTED, V6 row 23).
  - With a separate bot, principles 0-3 are untouched. The exchange can never forge a main-bot launch, and it never
    touches payments.
- **Residual: the exchange holds the full Bot API for the ad bot** (DOCUMENTED [2]).
  - It can send any message to the ad bot's users.
  - It can change the bot's name (`setMyName`, Bot API 6.7, 2023-04-21) and its description (`setMyDescription`,
    6.6, 2023-03-09). Its photo too (`setMyProfilePhoto`, 9.4, 2026-02-09).
  - It can move the webhook (`setWebhook`).
  - Mitigation: the owner can revoke the token at any time with BotFather `/token` [7]. Ownership transfer and deletion
    are BotFather-only, so the exchange cannot take the bot itself.
- **Residual: what the exchange does with that token counts as ours.**
  - §4.5: "any actions taken by others who authenticate using your credentials will be deemed as taken by you"
    (DOCUMENTED [1]).
  - The same §4.5 says credentials are "intended solely for the operation of the products and services you offer". It
    expressly bans only making them public.
  - So handing the ad bot's token to an exchange is not expressly banned, but we answer for its use (INTERPRETATION).
- **Residual: the exchange also receives our users' IDs.**
  - The telega.io guide asks the owner to "upload an updated user ID database" (CLAIMED, vendor guide, V8 row 14).
  - The Bot API has no method that lists a bot's users, which fits an upload model (DOCUMENTED [8]).
  - The list includes 14-17-year-olds. It is a third-party, likely cross-border, transfer under 152-FZ, the same
    question 11 raised for the ad SDKs.
  - 11 §3's "not described whether by the bot token or by owner-run code" is now outdated.
- **The push channel.** 11 §5(b) warned that blocks erode our own chapter-release notifications. With a separate bot,
  a user who blocks the ad bot keeps the main bot.

## 2. What it does not fix

### 2.1 Ban isolation is partial

- **Sanctions reach the account and the developer** (DOCUMENTED [1]):
  - §5.2: Telegram "may terminate your TPA, your account, or both". §4.2 says the same for data-retention breaches.
  - §10: a violation "may result in a temporary or a permanent ban from Bot Platform or Telegram apps".
  - §10: "the Telegram account tied to your TPA may also be banned", together with "any channels or communities
    affiliated with your TPA", at Telegram's sole discretion. Bots are not named in the affiliation clause.
  - The Terms' preamble: "'you' refers to you, the developer of TPA".
- **Consequences** (INTERPRETATION):
  - If one account owns both bots, an account ban takes the main bot with it.
    - The ad bot must be created directly on a separate Telegram account.
    - Do not create it by ownership transfer: BotFather transfer is DOCUMENTED [7], works only to a user who has
      interacted with the bot, and is permanent.
    - Do not create it through the main bot's Managed Bots mode (Bot API 9.6, 2026-04-03): both record a link to the
      main account.
  - No Telegram rule forbids a second owner account. The general ToS and the Developer Terms say nothing on multiple
    accounts (V8 row 10).
  - The separation is technical, not contractual: the Terms bind the developer. The main bot stays exposed at
    Telegram's discretion. A separate owner lowers that risk but cannot remove it.
  - The affiliation clause reaches **our announcement channel and community chats** if the ad bot links to or promotes
    them. The ad bot links only to the main bot.
- **No respawn** (INTERPRETATION on a DOCUMENTED clause):
  - §5.2(f): a TPA "must not attempt to circumvent or otherwise undermine Telegram rate limits and moderation".
  - The same item continues: "operate by proxy … in an attempt to circumvent bans or content moderation" [1].
  - The proxy example ("using Bot API credentials supplied by other users") describes the exchange's own model.
    Telegram forbids it when it is used to evade bans or moderation.
  - Re-creating a banned ad bot under a new name is the obvious reading of "circumvent bans". It would raise the risk
    for the main bot.
  - After a ban: stop, appeal, and do not re-create the bot.
- **Account limits.** One write-up describes BotFather showing a limited-account notice during bot creation. @SpamBot
  confirmed the limit (CLAIMED, a single write-up, opened by V8 [4]). BotFather caps an account at 20 bots (2021 [5]).
- **Enforcement evidence: still none for bots.**
  - Searches on 2026-10-31, by this report and by V8 in Russian and English, found bot bans for data harvesting, RKN
    requests and false positives, plus account freezes since 2025.
  - None was a bot banned for ad mailings (Gap; 11 §3 found none either).
  - A vendor blog (SocialJet, 2023) lists three bot-ad formats: "обязательная подписка, рассылка и показы" ("mandatory
    subscription, mailing and impressions") (CLAIMED [3]).
  - INTERPRETATION: with opt-in and one mailing a day, a ban looks unlikely, but no data supports a number.

### 2.2 Telegram Ads and the front door

- **Telegram Ads cannot land on the entry bot** (DOCUMENTED [6]):
  - §4.3 bans "mostly noninteractive bots designed to redirect elsewhere", and "mock destinations created solely for
    displaying other ads".
  - §4.2: "Bots must be beneficial to the user".
  - §4.3 also bans websites that automatically redirect users to another domain, and §3 bans URL shorteners. A bot
    destination "may include start parameters for the bot" (§3).
  - So Telegram Ads campaigns use a direct `t.me/<main bot>?start=<campaign>` link and never touch the ad bot.
- **Other public links.** In the gate design, TikTok bios, blogger posts and our own posts point at the ad bot. A ban
  would kill all of those links at once, even though the main bot survives.
  - **Fix:** those links go through our own redirect domain (the existing own-domain landing ask, V6 §"Most
    decision-relevant" #7). After a ban we repoint one record, and no post needs editing.

### 2.3 The extra hop

- The gate puts one more screen in front of every new user who does not come from Telegram Ads:
  1. Start the ad bot.
  2. Read the notice.
  3. Tap through to the main bot.
  4. Start the main bot or open the app.
- **The handoff** is a URL button to `t.me/<main bot>?start=<code>`, which keeps attribution.
- **Never use a `web_app` button in the ad bot** (INTERPRETATION from [9]). The initData would then be signed with the
  ad bot's token.
- No measured loss rate for a bot-to-bot hop was found (Gap). §3 prices it.

### 2.4 Creatives reaching 14-17

- The ad bot reaches the same audience: girls aged 14-25 (R4).
- 11 §3 cites telega.io for the claim that the owner confirms each ad request in a dashboard (CLAIMED). V8 could not
  re-read it on the page (UNSUPPORTED this pass).
- Even where it exists, approval is a vendor workflow, not a technical control: the token lets the exchange send
  anything (§1).
- Approve each creative against the F28 blocklist: gambling, betting, adult, dating, crypto and VPN.
- Revoke the token at once on a breach.

### 2.5 Consent and timing (facts; R3 accepted the ad-law risk)

- **Telegram:** §6.2.5 allows broadcasts "to users who have granted permission to contact them" (DOCUMENTED [1]).
- **Russian law, consent:** 38-FZ art. 18 part 1 requires prior consent and puts the burden of proof on the
  distributor (DOCUMENTED, 11 §3).
  - A first-screen notice ("one partner ad a day; `/stop` turns it off") serves both rules.
  - INTERPRETATION: consent that is a condition of reaching the novel is weaker evidence than a free opt-in. Design B
    (§4) has the free opt-in.
- **Timing:** FAS treats Telegram ads aimed at Russia as banned under p. 10.7. It reportedly does not fine for them
  "until 2026-12-31 inclusive" (V3, press reports of FAS statements in March 2026).
  - A growth-phase launch most likely starts after that window.
  - From then on, each Russian broadcast is exposed as a p. 10.7 ad, with us as the distributor (KoAP 14.3 part 1).

## 3. Arithmetic (ANALYSIS on ASSUMPTION inputs from 11 §5, re-done by V6 and V8)

**Inputs, per 1,000 main-bot daily players per day (low / base / high):**
- daily third-party broadcast: $0.22 / $2.64 / $17.70;
- Stars purchases: $1.95 / $13.00 / $39.00.
- The broadcast inputs are before losses from blocks (no data) and before marking costs (ORD/ERID) and the 3 %
  distributor levy (11 §5, §3).

**Gate cost.** Let *h* be the share of new users who start the ad bot but never reach the main bot.
- **Ad income.** Drop-outs stay in the ad bot's base only until they block it.
  - An ads-only bot gives them no reason to keep it, so its block rate is likely above the main-bot base 11 assumed
    (ASSUMPTION; no data).
  - The broadcast input for the gate is therefore an upper bound.
- **Stars income** falls by about *h* × Stars.
  - This assumes the lost users would have paid at the average rate. That overstates the loss: drop-outs are less
    engaged than average.
  - One effect is not modelled: an ad notice as the first screen may also lower conversion among users who do pass
    (no data).
- **Break-even against no ad bot: *h* = broadcast ÷ Stars.**
  - Base: 2.64 / 13.00 ≈ **20 %**. Low 11 %, high 45 %.
  - Above that, the gate earns less than it costs.
- **Break-even against design B (the satellite):** *h* = (1 − *o*) × broadcast ÷ Stars, where *o* is the satellite's
  opt-in share. The gate beats the satellite only below that lower bar.
- **At the 1-Star chapter placeholder,** the Stars base is ≈ $0.26 (V6). The broadcast then earns ≈ 2.8× (low),
  ≈ 10× (base) and ≈ 34× (high) of Stars, so break-even *h* is above 100 % in every case. The verdict therefore follows
  the chapter price (P13), as in 11 / V6.

**Scale at 10,000 daily players** (before blocks, marking costs and the levy):

| Case | Per month | In rubles (95 ₽ per $) |
|---|---|---|
| Low | $66 | ≈ 6,300 ₽ |
| Base | $792 | ≈ 75,000 ₽ |
| High | $5,310 | ≈ 504,000 ₽ |

- Exchanges list only bots with ≥ 1,000 active users (CLAIMED, 11 §3).
- The exchange's commission and the bot owner's net share are still not found (Gap). 11 assumed net prices.

## 4. Designs compared

| Design | Ad base | Cost to the main funnel | If the ad bot is banned | Consent evidence |
|---|---|---|---|---|
| **A. Gate** (owner's proposal): non-Telegram-Ads link → ad bot → main bot | Every new user from those channels, including drop-outs until they block | One extra screen for those users (loss unmeasured, Gap) | Links pointing at it die unless they use our redirect domain. The main bot is exposed only at Telegram's discretion if a different account owns the ad bot (INTERPRETATION) | First-screen notice; consent bundled with access is weaker (INTERPRETATION) |
| **B. Satellite:** main funnel unchanged; the main bot offers the ad bot once, as an opt-in | Opt-in share only (unknown) | None | Nothing published points at it | A free opt-in |
| **C. Broadcasts from the main bot** (11, §12) | All main-bot users | Blocks erode our own announcements | The main bot itself; its token is handed over | — |

- C stays rejected. Telegram Ads traffic goes straight to the main bot in every design.
- **A vs B is a money call (P34).**
  - With the redirect domain in place, a split costs nothing: send half of the non-Telegram-Ads traffic through A and
    half straight to the main bot.
  - Offer B to the direct half. Compare per arm: first-chapter starts, payer share, Stars and ad revenue per user, and
    the block rate.

## 5. Conditions if the owner goes ahead (product asks, not applied)

1. **A separate bot, created directly on a separate owner account, with its own token.**
   - No transfer and no Managed Bots link to the main account.
   - No Mini App, no `web_app` button, no payments, no initData.
   - Its token never sits in the main server's environment.
2. **The ad bot links only to the main bot**, through a URL button with a `start` code. It never links to our channel
   or community chats.
3. **First `/start` screen:** a plain notice ("one partner ad a day; `/stop` turns it off") and the button to the
   novel.
   - `/stop` takes effect at once.
   - At most one mailing a day, a cap we set.
4. **Approval of every request** against F28's blocklist, plus token revocation on a breach.
5. **The user-ID upload** goes through a privacy-policy section and the 152-FZ review, the same item as F29.
6. **Telegram Ads campaigns** use direct `t.me/<main bot>?start=<campaign>` links. Every other public link goes
   through our redirect domain. No published post or bio points at a raw `t.me/<ad bot>` link.
7. **Blocks are logged** from `my_chat_member` updates (pointer, 11 §3), so the block rate is measured, not guessed.
8. **After a ban: stop and appeal.** Never re-create the bot (§5.2(f)).
9. **Phase: growth.** The ≥ 1,000 active-user floor rules it out at soft launch. The FAS window note in §2.5 applies.

## Sources

[1] https://telegram.org/tos/bot-developers — Bot Platform Developer Terms: preamble, §4.2, §4.5, §5.2, §5.2(f), §6.2.5,
§10. Undated; read 2026-10-31 by this report and by V8. Contract.
[2] https://core.telegram.org/bots/api and https://core.telegram.org/bots/api-changelog — token-in-path
authentication; `setMyName` (6.7), `setMyDescription` (6.6), `setMyProfilePhoto` (9.4), `setWebhook`; Managed Bots
(9.6). Official; V8.
[3] https://www.sostav.ru/blogs/262223/42491 — SocialJet / TeleJet vendor blog, 2023-12-06: three bot-ad formats.
Opened by V8.
[4] https://www.dio.me/es/articles/sua-conta-foi-limitada-no-telegram-veja-como-resolver-de50886c6f83 — DIO write-up,
2025-07-29 (Portuguese): a limited-account notice during bot creation, confirmed via @SpamBot. Community. Opened by V8.
[5] https://bugs.telegram.org/c/9709 — 2021-09-28: "Sorry, you can't add more than 20 bots", with a transfer hint. Bug
tracker. Opened by V8.
[6] https://ads.telegram.org/guidelines — Telegram Ads guidelines §3, §4.2, §4.3: redirect bots, mock destinations,
auto-redirecting sites, URL shorteners, start parameters. Official; V8.
[7] https://core.telegram.org/bots/features — the token "can be used by anyone to control your bot"; BotFather
`/token` revocation; ownership transfer. Official; V8.
[8] https://core.telegram.org/bots/faq — no method that lists a bot's users; bots do not see other bots' messages.
Official; V8.
[9] https://core.telegram.org/bots/webapps — initData is signed with the bot's own token. Official.

Telega.io and eLama sources are 11 [33] and [34], with the V6 and V8 corrections.
