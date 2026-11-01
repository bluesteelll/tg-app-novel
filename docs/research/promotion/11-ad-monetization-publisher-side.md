# Promotion research 11: ad monetization from the publisher side (Telegram revenue share, Mini App ad SDKs, bot broadcast ads)
Date 2026-10-31. Sources read: 50 pages opened (listed in Sources) plus search-result pointers, each marked "(pointer,
not opened)". Freshness notes:
- Bot API changelog: latest entry **Bot API 10.3, 2026-08-24**. `allow_paid_broadcast` was added in **7.11 (2024-10-31)**.
  The Mini Apps page was read 2026-10-31 and mentions entries up to Bot API 10.1 (2026-06-11).
- Bot Platform Developer Terms: undated page, read 2026-10-31.
- core.telegram.org `api/revenue`, `api/sponsored-messages`, `api/stars`: undated, read 2026-10-31.
- Vendor documentation:
  - AdsGram: blog comparison published 2026-08-10, updated 2026-10-30. Privacy policy updated 2026-06-16.
  - Monetag: privacy policy updated 2026-08-14. The docs are undated.
  - TADS: docs undated.
- eLama's Telegram price guide: 2026-09-14 (data as of 2026-09-01).
- 38-FZ art. 18: edition of 2026-08-04 (consultant.ru).
- About 45 web searches were used.

Scope: the owner asked (verbatim) «А ты рассмотрел варианты альтернативной монетизации ввиде оф рекламы тг и сторонней
рекламы. Я видел есть такая тема что боты рекламу присылают когда его активировал. Условно раз в день прилетает реклама
юзера и платят за это понял». In English: what about earning from official Telegram ads and from third-party ads? He
has seen bots that, once a user has started them, send that user an ad about once a day, and the bot owner is paid for
it. This report covers the **publisher side**: money we would earn by showing ads. Report 02 §4 covers the advertiser
side and is not repeated here.

## TL;DR (decision-relevant)

- **Telegram shares 50% of ad revenue with bot owners as well as channel owners** (DOCUMENTED [1]). In a bot the ad is
  a sponsored message shown **above the bot chat**, not inside the Mini App (DOCUMENTED [2]). The revenue accrues in
  Gram (TON) and is withdrawn via Fragment (DOCUMENTED [3]). For a Russian-first product the yield looks close to zero:
  - Premium users can turn ads off (DOCUMENTED [4]).
  - A Russian outlet (2026-05-13) reports that **views from Russia, Ukraine, Israel, Palestine and Germany earn no
    revenue**, that only TON-paid ads pay out, and that the Fragment payout needs a Sumsub KYC with a face scan
    (CLAIMED [6]).
  - The bot eligibility threshold (1,000+ monthly users) is CLAIMED [7]. I found no official bot threshold and no
    opt-in or opt-out procedure (Gap).
- **No first-party Telegram ad format runs inside Mini Apps** (none found in Telegram's docs [1][2][11] or in 02). Ads
  inside a Mini App come only from third-party SDKs: AdsGram, Monetag, TADS, RichAds (plus OnClicka and others).
  - All publish formats and payout terms. **None publishes a publisher eCPM for Russia or CIS.**
  - The only TMA publisher figure is AdsGram's launch-time "0.5-2 TON ($3.8-16) CPM" (2024-06-27, CLAIMED [20]).
  - The nearest Russian benchmark is native-app rewarded eCPM in Q2 2024: $4.52 on Android, $11.44 on iOS (Tenjin on
    CAS.AI data, 6 B impressions; MEASURED-secondary [38]). It is not TMA traffic.
- **Server-verified rewards exist, but quality differs** (principle 1).
  - **Monetag:** documented server postbacks with a `ymid` per ad show, `reward_event_type=valued`, an
    `estimated_price` per event, retries for ~30 h and **no deduplication**. It advises a shared secret in the URL and
    idempotency on `ymid` (DOCUMENTED [24][25]).
  - **AdsGram:** an optional Reward URL (a GET with the Telegram ID only, **no signature documented**). Its docs say it
    "makes sense" above 50k DAU (DOCUMENTED [13]).
  - **TADS:** a webhook with `telegram_id` + `widget_id`, with no signature or retry policy documented (DOCUMENTED
    [31]).
- **Category control for a 14-17 audience is weak.**
  - AdsGram turns off only "Gambling" or "Adult" advertisers, only on request to support, and warns that this means "a
    significant decrease in your income" (DOCUMENTED [13]).
  - TADS says publishers can configure advertiser categories (CLAIMED [29]).
  - I found no minors clause in the AdsGram or Monetag privacy policies [18][27], and no network-level ban on dating or
    crypto ads.
- **The SDKs are third-party trackers in our origin** (principles 4/5/6, Y16, 152-FZ).
  - AdsGram's `sad.min.js` is ≈ 191 K characters of script loaded from `sad.adsgram.ai` (fetched text, gzip size not
    measured [19]).
  - It reads raw initData and user fields and builds an environment record with `tg_id`, platform, user agent and
    origin [19].
  - The AdsGram policy (Seychelles) lists Telegram ID, username, device type and IP [18].
  - Monetag's npm wrapper is 542 B gzip but injects a remote `sdk.js` at runtime [28]. Its group transfers data to the
    Isle of Man, Hong Kong and the UAE [27].
- **What the owner saw is a real market: "ad broadcasts" through a bot's user base.**
  - Exchanges such as Telega.in / telega.io let the bot owner set a price per 1,000 *delivered* messages. The platform
    sends the broadcast; bots need ≥ 1,000 active users (CLAIMED [33]).
  - eLama's 2026-09 table gives advertiser prices of **12-41,958 RUB per 1,000 bot users** via Telega.in, **1,500-30,000+
    RUB per mass mailing** and **200-800 RUB CPM** (CLAIMED [34]). The owner's net share was not found.
- **The bot-broadcast route collides with rules that R3 (the owner's acceptance of ad-law risk) does not obviously
  cover.**
  - Telegram's Developer Terms: "must not harass or spam users with unsolicited messages" (§5.2(b)), and broadcasts
    only "to users who have granted permission to contact them" (§6.2.5) (DOCUMENTED [8]).
  - 38-FZ art. 18 part 1: ads over telecom networks only with the recipient's **prior consent**, with the burden of
    proof on the **distributor**, plus a duty to stop on demand (DOCUMENTED [35]).
  - FAS (2019 letter) applies art. 18 to messenger apps (DOCUMENTED [36]).
  - INTERPRETATION: our bot would be the "рекламораспространитель" (ad distributor), carrying uncontrolled creatives to
    14-17 users.
- **Arithmetic (§5; ANALYSIS on mostly ASSUMPTION inputs): per 1,000 DAU per day.**

  | Option | Low | Base | High |
  |---|---|---|---|
  | Rewarded hint ads | $0.03 | $0.70 | $5.40 |
  | A daily third-party bot broadcast | $0.22 | $2.64 | $17.70 |
  | Stars purchases (07-consistent) | $1.95 | $13.00 | $39.00 |

  On these inputs ads are a supplement, not a replacement. One rewarded view at a $2 eCPM ($0.002) pays about half of
  one placeholder-priced hint (1/3 Star = $0.0043).

## Findings

### 1. Official Telegram ad revenue sharing

**Channels (the established programme)**
- The programme is DOCUMENTED [4] (blog post of 2024-03-31):
  - Owners of "public channels with at least 1000 subscribers" receive "50% of the revenue from ads displayed in their
    channels".
  - "Withdrawals for channel owners will be via Fragment", with no fees.
  - "anyone can turn off ads by subscribing to Telegram Premium."
- ads.telegram.org (read 2026-10-31): "50% of the revenue from Telegram Ads goes to the owners of channels where they
  are displayed". Ads are paid in "Gram" (DOCUMENTED [5]).
- The revenue balance is kept "in nanograms". A withdrawal returns "a unique URL to a Fragment page" where a TON wallet
  is entered. It needs a balance ≥ `stars_revenue_withdrawal_min` and the `withdrawal_enabled` flag (DOCUMENTED [3]).
  The live value of the minimum was not found (Gap; 07 §2 lists the Stars default of 1,000).
- Russia (CLAIMED, press [6], 2026-05-13/14):
  - Russian channels got a "Получить на Fragment" ("Get on Fragment") button in their Monetization tab, rolled out in
    stages.
  - KYC through Sumsub is mandatory (document + liveness).
  - Payouts come only from ads whose advertiser paid in TON.
  - "Views from Russia, Ukraine, Israel, Palestine and Germany generate no income."
  - This matches 02's claim that Gram-cabinet ads are not shown in Russia (02 §1, [17] there). Earlier history: the
    2024 Russian rollout was withdrawn after five days (pointer, habr.com/ru/amp/publications/831074, not opened).
- Earnings per 1,000 views: there is no primary or measured source. One undated blog says about $1 per 1,000 views for
  lifestyle/entertainment and $10+ for finance (pointer, hackmd.io, not opened). That is CLAIMED at best and does not
  apply to Russian views given [6].

**Bots**
- "Telegram channel and bot owners can now receive 50% of the revenue from ads displayed in their channels and bots"
  (DOCUMENTED [1]). Withdrawals and stats share the Stars/TON revenue pages [1][3].
- Placement: "In bots, they must be displayed above the chat". Clients call `messages.getSponsoredMessages` each time a
  user opens a channel or a bot chat (DOCUMENTED [2]). **Mini Apps are not mentioned** [2].
  - INTERPRETATION: a player who launches the Mini App from a direct link or the Main Mini App button and never opens
    the bot chat produces no bot ad impressions.
- Advertiser side (CLAIMED [7], kod.ru 2026-09-15):
  - A "Banner in Bot" format in the Telegram Ads cabinet is targeted by user, not by bot. It is text + logo + custom
    emoji.
  - Eligible bots have "a monthly audience of 1,000+ users".
  - Neither Telegram's docs nor this article describe how a bot owner opts in or out, or whether a bot owner can block
    categories (Gap).
- Premium: the blog's "anyone can turn off ads" with Premium [4]. The sponsored-messages API returns
  `PREMIUM_ACCOUNT_REQUIRED` when a non-Premium user tries to hide ads [2] (DOCUMENTED).
- **Content control:** Telegram's own ad guidelines (02 §1: no gambling for real money, no sexual or suggestive content,
  "dating services" listed under sexual content) apply to the creatives. INTERPRETATION: official sponsored messages
  are the cleanest ad inventory for a 14-17 audience, but the bot owner cannot pick them.

**Ads inside Mini Apps by Telegram itself:** none found as of 2026-10. Not in the Mini Apps doc [11] or the
sponsored-messages doc [2], and a 2026 search found only third-party networks (pointer: adsgram.ai "10 best telegram
advertising platforms", not opened). This agrees with 02 §1.

### 2. Mini App ad SDKs (publisher side)

**AdsGram** (AdsGram Ltd, Seychelles [18]; launched with a TON Foundation grant, 2024-06-27 [20])
- Formats: "Reward", "Interstitial" or "Task" blocks (DOCUMENTED [13]). Task = paid missions such as subscribing to a
  channel or opening another Mini App (CLAIMED [17]). Up to 10 ad units per platform [13].
- Integration (DOCUMENTED [14][15]):
  - `<script src="https://sad.adsgram.ai/js/sad.min.js">` in `<head>`, or npm `@adsgram/react` / `@adsgram/vue`.
  - `window.Adsgram.init({blockId})` → `AdController.show()`, a Promise that resolves when the user "watches the ad to
    the end".
  - Events include `onReward`, `onSkip`, `onTooLongSession` and `onNonStopShow`.
- Platform registration needs an app name, the Telegram direct link, the Web App URL and the **Bot ID**. A test platform
  must use the dev bot's values "or you'll get a wrong referrer error" (DOCUMENTED [13]).
  - INTERPRETATION: AdsGram checks the launch context against the registered bot.
  - Moderation is required. It is CLAIMED at 4-6 h on weekdays [17].
- **Reward verification:** an optional Reward URL. "AdsGram sends a GET request containing the user's telegramId"
  with an `[userId]` placeholder, HTTPS on 443 only. It "makes sense for publishers who have more than 50k daily average
  users"; debug views send nothing (DOCUMENTED [13]). **No signature, token or ad-show identifier is documented** [13].
- **Category blocking:** "turn off impressions from advertisers in the Gambling or Adult categories" via support;
  "Disabling them will lead to a significant decrease in your income" (DOCUMENTED [13]). No dating, crypto or other
  categories are offered.
- Payouts (CLAIMED, AdsGram's own blog [17]): USDT on TON by default; TRC20 or fiat on request. $100 minimum, with one
  smaller withdrawal per month from 10 USDT. Processed within 24 h on weekdays. KYC "not currently required".
- Publisher rates: "0.5 TON ($3.8) to 2 TON ($16)" CPM "depending on the audience" (CLAIMED, 2024-06-27 [20]). No
  current or Russia-specific figure was found. The AdsGram blog post on selling TMA ads (2025-11-06) contains no
  numbers (read; not listed).
- Data:
  - The policy lists "any user data available for mini-apps (such as Telegram ID, username, device type)" and IP. There
    is no minors clause (DOCUMENTED [18]).
  - In the public SDK file (read 2026-10-31) [19]:
    - The code parses init data: `user.id`, `username`, `isPremium`, `languageCode`, `photoUrl`, `allowsWriteToPm`, the
      raw init-data string, and the launch params.
    - It reads `ton-connect-ui_wallet-info` from `localStorage` and subscribes to accelerometer/gyroscope/orientation
      events.
    - It builds an environment record with `tg_id`, `tg_platform`, `userAgent`, `platform` and `origin`.
    - Hosts: `api.adsgram.ai`, `image(s).adsgram.ai`, `tma.adsgram.ai`.
    - Which fields leave the device per request was not traced (Gap).
- Size: the fetched `sad.min.js` text is **≈ 191,021 characters** (WebFetch length, 2026-10-31; not a gzip measurement
  and not bundlephobia).

**AdsGram for bots (publisher side)** (DOCUMENTED [16])
- The bot owner calls `GET https://api.adsgram.ai/advbot?tgid=…&blockid=…&language=…&token=…` and receives
  `text_html`, `image_url`, `click_url`, `button_name`, `reward_url` and `button_reward_name`.
- The bot itself then sends the message, and "Ad messages sent via the bot must not be forwardable" (`protect_content`).
- **No frequency rule, payment model or user opt-in requirement is documented** [16]. This is the "bot sends an ad"
  model in API form.

**Monetag** (PropellerAds group; npm repo `propellerads/monetag-tg-sdk` [28])
- Formats: Rewarded Interstitial, Rewarded Popup, In-App Interstitial (DOCUMENTED [22]). SmartLink needs no SDK and
  "works in bots" (CLAIMED [17]).
- Integration (DOCUMENTED [23]):
  - `<script src="https://<domain>/sdk.js" data-zone="XXX" data-sdk="show_XXX">`, or npm `monetag-tg-sdk`.
  - `show_XXX()` returns a Promise.
  - Pass a `ymid` user/show identifier in both preload and show calls, because "forgetting it breaks rewarded
    postbacks".
- npm wrapper: version 1.0.4, **891 B min / 542 B gzip**, 1 dependency (bundlephobia API, MEASURED of the package [28]).
  The wrapper builds `//<process.env.DOMAIN>/sdk.js` and injects it [28], so the real SDK bytes load at runtime from a
  third-party host (size not measured, Gap).
- **Postbacks** (DOCUMENTED [24][25]):
  - Macros: `{ymid}`, `{telegram_id}` ("empty string" if unavailable), `{event_type}` (impression/click),
    `{reward_event_type}` (`valued` = paid / `non_valued`, e.g. "fraud or fallback traffic"), and `{estimated_price}`
    (USD per event, "not a CPM").
  - Delivery: retries at 1, 5, 15, 30, 60, 90, 120 and 180 min, then once after 30 h. Redirects count as failures.
  - "Monetag doesn't deduplicate". Docs advise "Grant one reward per `ymid`" and "a unique ymid per ad show".
  - Authentication: a long random secret in the URL. No signature or IP allowlist.
- Application requirements: no "aggressive or misleading monetization (e.g. fake buttons, clickbait, or unskippable
  flows)". There is no audience minimum and no clause on minors, adult or gambling on that page (DOCUMENTED [26]).
- Payouts (CLAIMED, a competitor's blog [17]): weekly. PayPal/Skrill/WebMoney $5, Payoneer $20-30, crypto $100, wire
  $500.
- Data: "URL of the website displaying our ads, referral URL, IP, country, geographical area", browser and OS. Transfers
  to group companies in the Isle of Man, Hong Kong and the UAE. No minors clause (DOCUMENTED [27], updated 2026-08-14).

**TADS** (tads.me)
- "You earn 70% of the amount the advertiser pays", and income depends on clicks. Formats: "In-app banners, fullscreen,
  rewarded ads, CPM or CPC". The main unit is a text-graphic block. "You can configure the categories of advertisers"
  (CLAIMED, vendor pages [29]).
- Payout: "only supports USD₮", within 15 days after month end (Net15), to a wallet given to @tads_manager; no minimum
  stated (DOCUMENTED [30]).
- Earnings calculator: "$270 for 30,000 clicks" on "Standard" traffic ≈ $0.009 per click (CLAIMED [29]). The audience
  mix is 15% Russian-language (02 §4).
- Webhook: POST `{telegram_id, widget_id}`, fired on click (TGB) or on view (Fullscreen). No signature, show ID or
  retries documented (DOCUMENTED [31]).

**RichAds**
- Publisher formats: push-style, embedded and interstitial banners, video; "all of which can be made into rewarded
  ads". Integration by "an SDK code"; "doesn't matter how big your audience is" (CLAIMED, own blog, updated 2026-06-22
  [32]).
- Publisher payout minimums of $10 (e-wallets) and $500 (wire) come from a search snippet of its FAQ. The page returned
  HTTP 500 (pointer, not opened).
- SDK and reward-callback docs were not found (Gap).

**OnClicka, Adexium, Gigapub**
- OnClicka: reward-based ads, interstitials and banners; Paxum/Capitalist/wire/card/crypto payouts (CLAIMED, a
  competitor's list [32]).
- Adexium: only one anonymous negative review surfaced (pointer, affpaying.com, not opened).
- Gigapub: only a SaaS-directory stub, "established in 2025" (pointer, saasbrowser.com, not opened). No usable terms
  for either (Gap).

**Publisher eCPM by geo: what exists**

| Figure | Value | Scope | Label | Src |
|---|---|---|---|---|
| AdsGram CPM offered to developers | $3.8-16 (0.5-2 TON) | TMA, global, 2024-06 | CLAIMED | [20] |
| Russia rewarded eCPM, native apps | iOS $11.44, Android $4.52 (interstitial $10.55 / $4.52, banner $0.73 / $0.47) | Q2 2024, CAS.AI data, 6 B impressions | MEASURED-secondary | [38] |
| Monetag per-event `estimated_price` | per event, USD | the publisher's own postbacks | DOCUMENTED (mechanism) | [24] |
| TADS calculator | ≈ $0.009 per click | TMA, "Standard" traffic | CLAIMED | [29] |
| Telegram's own TON ad share, RU views | 0 | channels (and by the same rule bots, inference) | CLAIMED | [6] |
| Russia/CIS TMA publisher eCPM | **not found** | — | Gap | — |

### 3. Bot broadcast ads (what the owner saw)

**Market models found**
- **Exchange-run broadcast through the bot's base (Telega.in / telega.io)** (CLAIMED, vendor, 2025-04-11 [33]):
  - The bot owner adds the bot to a catalogue and enters "your rate per 1,000 delivered ad messages".
  - "the platform automatically sends the broadcast to your bot's user base". It is not described whether by the bot
    token or by owner-run code.
  - "The system only counts successfully delivered messages". The owner confirms each request in a dashboard.
  - Bots need "at least 1,000 active users" and pass moderation.
  - No commission, frequency rule or payout method is stated.
- **Prices, Russian market** (CLAIMED, eLama 2026-09-14, data as of 2026-09-01 [34]):
  - Bot ads via Telega.in: **from 12 to 41,958 RUB "per 1,000 users"**.
  - Mass mailing: **1,500 to 30,000+ RUB** per mailing (late August 2026).
  - CPM model: **200-800 RUB** per 1,000 impressions. Banners/native: 0.5-3 RUB per contact.
  - Payment models listed: per placement, per mailing to the "whole accumulated base", CPM, per active user (unique users
    who started the bot in the last month), CPC, CPA.
  - eLama's caution: "a huge bot base may turn out to be 'dead'" (blocked or archived).
  - These are **advertiser** prices. The bot owner's net after the exchange was not found (Gap).
- **SDK-run in-bot ads (AdsGram advbot)** [16]: see §2. The owner's code sends one ad message per API response; the
  pricing model is not documented.
- **Telegram's own sponsored message above the bot chat** [1][2]: see §1. It is not a broadcast, it needs no message
  from us, and it is subject to Telegram's ad policy.
- Not found: a primary source for the specific "one ad a day after /start" networks, and Russian bot-monetization
  services such as "обязательная подписка" (mandatory channel subscription) networks. The searches returned nothing
  usable (Gap).

**Telegram rules**
- Bot Platform Developer Terms (undated, read 2026-10-31) [8], DOCUMENTED:
  - §5.2(b): "Your TPA must not harass or spam users with unsolicited messages".
  - §5.2(d): "social growth manipulation" is a forbidden use case.
  - §5.2 also requires that privileges are not used beyond their original purpose, and that users are told of
    significant changes and given an opt-out.
  - §6.2.5: TPAs may "broadcast up to 30 messages per second to users who have granted permission to contact them, free
    of charge". Higher limits go up to 1,000 msg/s via @BotFather. Each message above the free threshold "incurs a
    non-refundable fee of 0.1 Stars". It needs **≥ 100,000 Stars on the balance and ≥ 100,000 MAU**. "It is expressly
    prohibited to exploit increased limits to spam or harass users".
  - §6.2.3: Stars may buy Telegram Ads for the TPA itself.
  - There is no clause on third-party ads inside bots or Mini Apps.
- Bots FAQ (DOCUMENTED [9]): avoid more than 1 msg/s per chat; 20 msg/min in a group; "about 30 messages per second"
  for bulk without paid broadcasts. "Bots with increased limits are only charged for messages that are broadcasted
  successfully". Requirement: 100k Stars + 100k MAU.
- Bot API 7.11 (2024-10-31) added `allow_paid_broadcast` and `TransactionPartnerTelegramApi` (DOCUMENTED [10]).
- Who can be messaged:
  - The Mini App can ask with `requestWriteAccess` ("a native popup requesting permission for the bot to send messages
    to the user", Bot API 6.9). `WebAppUser.allows_write_to_pm` is "True, if this user allowed the bot to message them"
    (DOCUMENTED [11]).
  - INTERPRETATION: a Mini App user who never started the bot and never granted write access is not in "users who have
    granted permission to contact them" (§6.2.5).
- Enforcement evidence:
  - Telegram's spam FAQ covers **user accounts**. Reports go to "human moderators"; "the account becomes limited
    temporarily"; "Repeated offences will result in longer periods of being blocked" (DOCUMENTED [12]).
  - Since 2025, Telegram freezes *accounts*, with appeals via the Spam Info Bot (pointer, mundobytes / tginfo, not
    opened).
  - **No official text or reliable report on a *bot* being limited or frozen for ad broadcasts was found** (Gap).
- Effect on retention and blocking: **no measured block-rate data found.** One bot-admin doc expects 5-10% delivery
  failures per broadcast (blocked or deleted accounts) (pointer, mintlify.com, not opened). Blocks can be logged from
  `my_chat_member` updates (pointer, graspil.com, not opened).

**Russian ad law for a distributor** (INTERPRETATION, not legal advice; R3 accepted the ad-law risk; facts only)
- **Consent.** 38-FZ art. 18 part 1 (ed. 2026-08-04) [35], DOCUMENTED:
  - Ads over telecom networks are allowed "only with the prior consent of the subscriber or addressee".
  - An ad "is deemed distributed without prior consent unless the distributor proves such consent was obtained".
  - The distributor "must immediately stop distributing ads to a person who demands it".
  - FAS letter АК/52901/19 (2019-06-24): the art. 18(1) requirement "extends, among others, to WhatsApp Messenger, Viber
    and other applications". The distributor bears liability (art. 38 p. 7), not the app's developers (DOCUMENTED [36]).
  - INTERPRETATION: a third-party ad broadcast from our bot makes us the distributor under art. 18. Starting the bot to
    read a novel is not obviously "consent to receive advertising"; a separate opt-in would be the evidence art. 18 asks
    for. No FAS decision on Telegram bots specifically was found (Gap).
- **Marking, reporting, levy** (06 §1.2-1.4 [37], DOCUMENTED there):
  - Distributors, like advertisers, must report internet ads aimed at Russian consumers to the ERIR via an ORD (art.
    18.1 p. 3, p. 5).
  - Each ad needs "реклама" ("advertisement"), the advertiser's identity and an ERID before distribution (p. 16-17).
    The distributor is liable for p. 16.
  - Distributors pay the **3% levy** on quarterly ad income (art. 18.2).
  - Fines are in KoAP 14.3 (e.g. part 16: 200-500k RUB for legal entities).
  - An exchange may file to the ORD for us; who files is set by contract (06, CLAIMED).
- **Minors.** 38-FZ art. 6 limits ad content aimed at minors (06 §3.3 [37]). INTERPRETATION: with a 14-17 audience,
  every third-party creative that reaches them through our bot or SDK slot must meet art. 6. Neither the exchanges nor
  the SDK networks document a minors-safe filter beyond AdsGram's gambling/adult opt-out [13].

### 4. Hybrid monetization evidence (ads + IAP)

- **Choices (Pixelberry)** (CLAIMED, Udonis analysis, 2023-12-19 [40]): the game "relies on one ad format – rewarded
  video ads". It offers 3 ads per day at 1 diamond each in the home "rewards" section, plus a "watch an ad from our
  sponsors" pop-up after chapter 2 for 1 diamond. Ads unlock after the first chapter. **Keys (chapter access) are not
  sold through ads**. No ad-revenue share disclosed.
- **Romance Club (RU)**: fan guides say diamonds are given for watching ads and that ads "refresh every hour and a half"
  (pointer, wotpack.ru / landofgames.ru, not opened). There is no official source.
- **My Love & Dating Story Choices** (a different publisher): "unlock new chapters and premium choices by watching
  rewarded videos" (pointer, App Store snippet, not opened).
- **Short drama**:
  - ReelShort lets users earn coins by watching ads, which unlock episodes (pointer, Wikipedia, not opened).
  - In China, free ad-supported ("IAA") micro-dramas passed paid ones in market share by December 2024 (China
    Netcasting Services Association via Caixin, 2025-08-22; pointer, not opened).
  - The overseas paid apps still earn heavily from IAP: DramaBox and ReelShort about $140 M each in Q1 2026 (Sensor
    Tower via TechNode, 2026-10-20; pointer, not opened).
- **Casual hybrid benchmarks** (AppsFlyer State of App Monetization 2024; North America + Western Europe, Q3 2024;
  vendor aggregate, CLAIMED [39]):
  - Hypercasual hybrid D90 ARPU $0.60 vs IAA-only $0.47.
  - iOS mid-core hybrid D90 ARPU $9.69 vs IAP $7.31, but iOS mid-core ROAS is 215% on IAP vs 73% on hybrid.
  - Android mid-core hybrid D90 ROAS 146% vs IAP 93%.
  - AppsFlyer: "ads could cannibalize IAP earnings, especially for games with rewarded ads". There is no Russia and no
    story-genre cut.
- **Cannibalization vs uplift**: the only evidence is vendor correlation, e.g. Tapjoy 2017, "4.5x more likely to make an
  in-app purchase" for rewarded-ad engagers. These are self-selected groups (pointer, retaildive, not opened). No
  holdout study was found (Gap).
- **TMA games' ad ARPDAU**: none found. RichAds case studies give revenue totals without DAU, e.g. "$18,357 in 20 days,
  RPC $0.0227" (pointer, the page returned HTTP 500). Gap.

### 5. Arithmetic: per 1,000 DAU per day (ANALYSIS)

Exchange-rate assumption from PROMOTION.md §1: $1 ≈ 95 RUB.

| Option | Formula | Inputs, low / base / high | Earns per 1,000 DAU per day (low / base / high) |
|---|---|---|---|
| (a) Rewarded ads for hints (TMA SDK) | DAU × opt-in share × views per watcher × fill × eCPM / 1,000 | Opt-in share 10 / 25 / 40% (ASSUMPTION). Views per watcher 1 / 2 / 3 (ASSUMPTION; Choices caps 3/day [40]). Fill 50 / 70 / 90% (ASSUMPTION). Publisher eCPM for RU-heavy TMA traffic $0.5 / $2 / $5 (ASSUMPTION; anchors: AdsGram $3.8-16 global 2024 CLAIMED [20]; RU native-app rewarded $4.52-11.44 MEASURED-secondary [38]; RU views earn $0 in Telegram's own programme, CLAIMED [6]) | **$0.03 / $0.70 / $5.40** |
| (b) One third-party broadcast ad per day via the bot | reachable base × share of days sold × net price per 1,000 deliveries | Reachable base (started the bot, not blocked) 1,000 / 2,000 / 3,000 (ASSUMPTION). Days sold 30 / 60 / 100% (ASSUMPTION). Net price 70 / 210 / 560 RUB per 1,000 = 70% (ASSUMPTION) of 100 / 300 / 800 RUB (inside eLama's 200-800 RUB CPM and the 12-41,958 RUB per 1,000 users range, CLAIMED [34]) ≈ $0.74 / $2.2 / $5.9 | **$0.22 / $2.64 / $17.70**, before losses from blocks (no data) and before ORD/levy costs |
| (c) Stars purchases (chapters + hint packs) | DAU × daily payer share × Stars per payer-day × $0.013 | Daily payer share 0.3 / 1 / 2% (ASSUMPTION). Stars per payer-day 50 / 100 / 150 (ASSUMPTION; 07 base price 100). $0.013 per Star (DOCUMENTED [8]) | **$1.95 / $13.00 / $39.00** |

Checks:
- **(c) vs 07:** 07's base revenue per start is $0.078 lifetime. At an assumed ~5 active days per start this gives
  ≈ $0.016 per DAU-day, i.e. ≈ $15.6 per 1,000 DAU per day, close to the (c) base. The Russian Stars-purchase friction
  (09 §1) pulls (c) towards its low case.
- **(a) vs a hint sale:** one rewarded view at a $2 eCPM = $0.002. One hint at the placeholder price 3 hints / 1 Star =
  $0.0043, or $0.0039 at 10 / 3 Stars. At $5 eCPM a view ≈ $0.005 ≈ one placeholder hint. Real hint prices are an
  owner value (Q3).
- **(b) vs our own pushes:** every user who blocks the bot also leaves our own chapter-release notifications. The block
  cost cannot be priced without block-rate data (Gap).
- Telegram's own bot ad share is not computable. Impressions arise only when users open the bot chat [2], and Russian
  views are CLAIMED to earn $0 [6].

## Channel rows (for the synthesis table)

The Cost column here = what the option **earns**.

| Channel | Earns (currency, date, label) | Effort | Fit for a Russian-first romance VN for girls in a TMA | Evidence quality | Notes |
|---|---|---|---|---|---|
| Telegram ad revenue share in our bot (sponsored message above the bot chat) | 50% of ad revenue (DOCUMENTED [1]), in Gram via Fragment [3]; RU views $0 (CLAIMED [6], 2026-05) | None to enable (procedure not found); KYC at withdrawal (CLAIMED [6]) | Poor: RU views unpaid, Premium users excluded [4], no impressions inside the Mini App [2]. Creatives follow Telegram ad policy (cleanest for 14-17) | A (rule) / C (RU, eligibility ≥1,000 MAU [7]) | Bot chat only; owner cannot choose ads |
| Telegram channel revenue share (our own channel ≥1,000 subs) | 50% [4]; RU views $0 (CLAIMED [6]) | Channel growth + Sumsub KYC | Poor for an RU audience; neutral for an EN channel | A / C | Same Fragment route |
| AdsGram rewarded / interstitial / task in the Mini App | CPM to devs $3.8-16 (CLAIMED, 2024-06 [20]); RU eCPM not found; payout USDT-TON, min $100 (CLAIMED [17]) | Script tag in `<head>` + moderation + Bot ID registration [13][15]; server Reward URL (no signature documented) [13] | Rewarded-for-hints fits the hint economy. Category blocking only Gambling/Adult via support [13]; Telegram ID/username/IP to a Seychelles company [18]; ≈ 191 K-char script [19] | B (docs) / C (rates) | "Task" ads (subscribe to channels, open other apps) put third-party destinations in front of minors |
| Monetag (rewarded interstitial / popup / in-app interstitial) | Per-event USD `estimated_price` in postbacks [24]; payout from $5 (CLAIMED by a competitor [17]) | npm wrapper 542 B gzip + remote SDK [28]; postback endpoint with secret and `ymid` idempotency [25] | Best-documented server verification (principle 1). No minors/category controls found [26][27]; cross-border data [27] | B | Postbacks retried ~30 h, not deduplicated [25] |
| TADS (text-graphic / fullscreen / rewarded) | 70% of advertiser spend (CLAIMED [29]); ≈ $0.009/click calculator [29]; USDT Net15 [30] | Widget embed + webhook (no signature) [31] | Category configuration claimed [29]; CPC text units are less suited to a reward loop | C | 15% RU-language audience (02 §4) |
| RichAds publisher SDK | Not found (payout minimum $10 e-wallet / $500 wire, pointer) | "an SDK code" [32] | Unknown controls | C | Docs not found |
| OnClicka / Adexium / Gigapub | Not found | ? | ? | C | Gap |
| AdsGram bot messages (publisher side, `advbot` API) | Model not documented [16] | Our bot sends the ad; non-forwardable [16] | Conflicts with §5.2(b) unless opted in; art. 18 consent; uncontrolled creatives to 14-17 | B (API) / C | The "ad in the bot" model as an API |
| Bot broadcast exchanges (Telega.in / telega.io) | Advertiser prices 12-41,958 RUB per 1,000 users; 1,500-30,000+ RUB per mailing; 200-800 RUB CPM (CLAIMED, 2026-09 [34]); owner sets the price per 1,000 delivered [33] | Catalogue + moderation (≥1,000 active users) [33]; ORD/ERID + 3% levy as distributor [37] | Weak: §5.2(b)/§6.2.5 [8], art. 18 consent with the burden on us [35][36], art. 6 for 14-17, blocks erode our own push channel | C | What the owner saw; net share unknown |
| Stars purchases (baseline) | $0.013 per Star (DOCUMENTED [8]); 07 base ≈ $13 per 1,000 DAU-day (ANALYSIS) | Built (planned) | The product's model; RU purchase friction (09 §1) | A (rate) / ANALYSIS | For comparison |
| Paid broadcasts (cost, not earnings) | 0.1 Star per message above 30/s (DOCUMENTED [8][9]) | Needs 100k Stars + 100k MAU [8] | Irrelevant at launch scale | A | Bot API 7.11 [10] |

## Applicability to tg-app-novel (map onto §2 planned features; product feature asks, listed not designed)

**Conflicts, per option**

| Constraint | Rewarded ads in the Mini App (hints) | Interstitials in the Mini App | Third-party ad broadcasts via the bot | Telegram's own bot ad share |
|---|---|---|---|---|
| Principle 1 (server truth) | A client `show()` resolving is not proof. Only a server postback can grant a hint. Monetag documents one (secret + `ymid`) [25]. AdsGram's Reward URL carries only a Telegram ID, no signature [13] — INTERPRETATION: forgeable by anyone who learns the URL. TADS: no signature [31] | n/a (no grant) | n/a | n/a |
| Principle 4 (load budget) | Third-party script bytes: AdsGram ≈ 191 K chars [19]; Monetag runtime SDK size unknown [28]. Video creatives also add memory and network load | Same | None in the client | None |
| Principle 5 (WebView reality; SDK calls from the main origin; no `window.open`) | The ad SDK runs in our origin, reads initData and opens links itself (AdsGram code has `openUrl` / `t.me` handling [19]). Video audio vs our audio pause rules | Same; interstitials interrupt scenes | n/a | n/a |
| Principle 6 (thin, replaceable) | All three SDKs share the same "init → show() Promise" shape [14][23], so a client seam is plausible. Server postback formats differ per network | Same | Exchange-specific | Nothing to integrate |
| Y16 (no third-party analytics) | The SDKs collect Telegram ID, username, device, IP, UA [18][19][27]. INTERPRETATION: functionally third-party telemetry, so Y16 needs an explicit exception or the option is out | Same | The exchange learns our bot's base size and delivery stats [33] | None from us |
| 152-FZ | INTERPRETATION: passing Telegram ID/username to AdsGram (Seychelles) or Monetag (IoM/HK/UAE) is a transfer to a third party, and cross-border. Consent and lawyer review needed (06 §3.5; research_M3) | Same | The exchange sends via our base; the same question applies if it gets user IDs (not documented [33]) | Telegram's own processing |
| 14-17 audience (38-FZ art. 6, R4) | AdsGram blocks only Gambling/Adult on request [13]; no dating/crypto filter; "Task" ads send minors to third-party channels/apps | Same | Uncontrolled creatives + art. 18 consent | Telegram ad policy bans gambling and sexual/dating ads (02 §1) |
| 18+ separate bot (R5) | Unknown whether networks accept 18+ apps; AdsGram has an "Adult" advertiser category [13] (not a publisher-content rule) | Same | A sexual-content bot base is a different ad market (not researched) | Unknown |
| Owner rule: chapters are Stars-only | Rewarded ads for **hints** do not touch it. **"Watch ads to unlock a chapter" contradicts it** — it would change a value ruling, not an engineering detail. Precedent split: Choices keeps keys off ads [40]; short-drama apps sell episodes for ad coins (pointers) | n/a | n/a | n/a |
| Principle 0 (paid content never leaks) | Not touched as long as an ad grant is a server-side balance change; an ad-funded chapter unlock would still have to be a server entitlement | n/a | n/a | n/a |
| Telegram Developer Terms | No clause on third-party in-app ads found [8] | Same | §5.2(b), §6.2.5 [8] | Built in |

**Mapping onto §2 planned features**
- The hint economy (packs into a balance) is the only planned surface where a rewarded ad fits: an ad becomes another
  hint source, next to packs, gifts (M22) and referral grants (M23). The same server-side, idempotent grant discipline
  applies. Today that discipline is the `charge_id` UNIQUE rule; an ad grant would need its own unique ad-show key.
- Bot messages: the plan has bot commands (`/terms`, `/support`, `/paysupport`, `/privacy`) and invite and share flows
  (M10-M14). It has no promotional broadcast feature. Any broadcast (own or third-party) needs the write permission
  [11] and, for ads, consent evidence [35].
- Referral and gift caps (M22-M23) are a model for daily ad-reward caps.

**Product feature asks (listed, not designed)**
1. A server-verified rewarded-hint source: the network postback → our endpoint (secret in the URL, HTTPS) → an
   idempotent grant keyed on a unique per-show ID (Monetag `ymid` [24][25]). Grant only on a paid/valued event. A
   client `show()` result never grants.
2. A daily cap on ad-earned hints per user, and an ad-earned-hint ledger separate from Stars purchases (refund and
   fraud analysis).
3. One client ad module behind a small interface (init / preload / show), with the SDK loaded lazily only on the hint
   screen and never in the initial bundle (principle 4). The SDK is never active during story scenes.
4. A written category blocklist from the network (gambling, adult, dating, crypto/tap-to-earn, VPN), plus "Task"-format
   ads off, before any minors-reachable placement.
5. A consent step for ad-data sharing (152-FZ) and a privacy-policy section naming the ad network and its jurisdiction.
6. An ads-free state, e.g. for payers or as a Stars purchase (listed only).
7. If any bot messages are ever sent: `requestWriteAccess` [11], a separate explicit promotional opt-in (art. 18
   evidence [35]), a stop command honoured immediately [35], a frequency cap, and block-rate logging from
   `my_chat_member`.
8. A holdout measurement (ads on / ads off cohorts) before ads ship widely, to measure Stars cannibalization (AppsFlyer
   flags the risk [39]; no holdout study exists).

## Pitfalls / what goes wrong (sourced)

- **Forgeable rewards:**
  - AdsGram's Reward URL is a plain GET carrying a Telegram ID, with no signature documented [13].
  - Monetag postbacks are retried for ~30 h and not deduplicated [25].
  - A grant keyed only on the user (not the show) double-grants; a grant on the client is spoofable (principle 1).
- **Income-vs-safety trade:** AdsGram states that blocking gambling and adult ads significantly lowers income [13]. A
  minors-safe configuration earns less than the advertised CPMs.
- **Russian views earn nothing in Telegram's own programme** [6], and Russia is the primary market (R2).
- **Dead bases:** eLama warns that large bot bases may be mostly blocked or archived [34]. Broadcasting accelerates
  that, and our own pushes lose reach with it (no data).
- **Distributor duties:** as the distributor we must prove consent (art. 18) [35][36], mark ads and report via an ORD,
  and pay the 3% levy [37]. R3 covers the owner's acceptance of risk, but a missing consent record is a per-message
  liability (INTERPRETATION).
- **Third-party code in our origin:** the AdsGram SDK reads raw initData, `localStorage` wallet keys and motion
  sensors [19]. This runs into Y16, 152-FZ and the principle that every Telegram SDK call comes from our main origin
  module.
- **Mis-labelled rates:** most "CPM from $X" numbers on TMA network pages are advertiser floors, not publisher payouts
  (RichAds/TADS pages [32][29]; 02 §4).
- **Cannibalization:** a hint given away for an ad is a hint not sold for Stars. AppsFlyer flags rewarded ads as a
  cannibalization risk [39].

## Key claims for verification

1. Telegram shares 50% of ad revenue with **bot** owners as well as channels — core.telegram.org/api/revenue [1] — DOCUMENTED.
2. Sponsored messages in bots are shown "above the chat"; Mini Apps are not mentioned — core.telegram.org/api/sponsored-messages [2] — DOCUMENTED.
3. Channel/bot ad revenue is held in nanograms and withdrawn via a Fragment URL — core.telegram.org/api/stars [3] — DOCUMENTED.
4. Views from Russia (and UA, IL, PS, DE) generate no ad income; Fragment payout needs Sumsub KYC; only TON-paid ads pay — kod.ru 2026-05-13 [6] — CLAIMED.
5. Telegram Ads "Banner in Bot" runs in bots with ≥ 1,000 monthly users — kod.ru 2026-09-15 [7] — CLAIMED.
6. Developer Terms §5.2(b) "must not harass or spam users with unsolicited messages"; §6.2.5 broadcasts "to users who have granted permission to contact them", 0.1 Star per message above 30/s, needs 100k Stars + 100k MAU — telegram.org/tos/bot-developers [8] — DOCUMENTED.
7. `allow_paid_broadcast` added in Bot API 7.11 (2024-10-31); latest Bot API 10.3 (2026-08-24) — [10] — DOCUMENTED.
8. AdsGram Reward URL: GET with the Telegram ID, "makes sense" above 50k DAU; no signature documented; Gambling/Adult blocking only via support with an income warning — docs.adsgram.ai/publisher/get-block-id [13] — DOCUMENTED.
9. Monetag postbacks: `ymid`, `reward_event_type`, `estimated_price`; retries to ~30 h; no deduplication; secret-in-URL auth — docs.monetag.com [24][25] — DOCUMENTED.
10. TADS: 70% revenue share, USDT Net15, configurable categories — tads.me/for-publisher [29], gitbook payment [30] — CLAIMED / DOCUMENTED.
11. AdsGram developer CPM $3.8-16 (0.5-2 TON) — Cointelegraph 2024-06-27 [20] — CLAIMED.
12. Russia rewarded eCPM Q2 2024: iOS $11.44, Android $4.52 (native apps) — wnhub / Tenjin on CAS.AI data [38] — MEASURED-secondary.
13. Bot ads via Telega.in 12-41,958 RUB per 1,000 users; mass mailing 1,500-30,000+ RUB; CPM 200-800 RUB — elama.ru 2026-09-14 [34] — CLAIMED.
14. 38-FZ art. 18 p. 1: prior consent, burden of proof on the distributor, duty to stop on demand; FAS letter АК/52901/19 applies it to messengers — [35][36] — DOCUMENTED.
15. AdsGram SDK reads raw initData, user fields, a TON Connect `localStorage` key and motion sensors; ≈ 191 K characters — sad.adsgram.ai/js/sad.min.js [19] — observed in the public file 2026-10-31.

## Gaps (asked but no reliable source found)

- **Publisher eCPM for Russian/CIS traffic in any TMA network**, and current (2026) global TMA publisher eCPMs.
- How a **bot owner opts in or out** of Telegram's bot sponsored messages; the official bot eligibility threshold;
  category control for bot owners; live bot ad revenue per 1,000 bot-chat opens.
- The owner's **net share** on Telega.in / telega.io broadcasts, and the exchange's commission, frequency rules and ORD
  handling.
- Primary sources for the specific "daily ad after /start" networks the owner saw, and for Russian
  mandatory-subscription bot networks.
- **Block-rate data** after promotional broadcasts; any documented case of a **bot** limited or frozen for ad
  broadcasts.
- Runtime size of Monetag's remote `sdk.js`, gzip size of AdsGram's `sad.min.js`, and the exact fields each SDK sends
  per request.
- RichAds, Adexium, Gigapub and OnClicka publisher docs (SDK, reward callback, category controls).
- Whether the networks accept 18+ publisher apps (the R5 bot).
- A holdout study of rewarded-ad cannibalization in story games; ad-revenue shares for Choices, Episode or Romance Club;
  TMA games' ad ARPDAU.

## Owner value questions this area raises (each with a default reading)

1. **Ads in the minors-reachable main bot at all?**
   - Default reading: only opt-in rewarded ads for hints, with a written category blocklist.
   - No interstitials and no "Task" ads.
2. **"Watch an ad to unlock a chapter"?**
   - Default reading: no, since chapters stay Stars-only.
   - Ads may fund hints only.
3. **Third-party ad broadcasts through our bot** (what the owner saw)?
   - Default reading: no.
   - Bot messages stay our own, opt-in announcements.
   - Reason: §5.2(b)/§6.2.5, the art. 18 consent burden, art. 6 for 14-17, and erosion of our own push reach.
4. **Share Telegram ID and device data with a foreign ad network** (Y16, 152-FZ)?
   - Default reading: only after a lawyer's 152-FZ review, with a consent step.
   - Otherwise no SDK.
5. **Ads-free for payers?**
   - Default reading: payers see no ads.
   - Untested; a holdout measures it.
6. **Ads in the separate 18+ bot?**
   - Default reading: none until a network's acceptance and the legal review (10, §8.5) are known.
7. **Earn from Telegram's own ad share in our bot or channel?**
   - Default reading: leave it on if it comes by default; plan no revenue from it (RU views earn $0, CLAIMED [6]).

## Sources

[1] https://core.telegram.org/api/revenue (and `.md`) — "Channel and bot ad revenue", 50% to channel and bot owners; undated, read 2026-10-31; Telegram's API docs (contract).
[2] https://core.telegram.org/api/sponsored-messages.md — sponsored messages: "In bots, they must be displayed above the chat"; `getSponsoredMessages` on bot-chat open; undated, read 2026-10-31; primary. (corefork.telegram.org mirror also read; same text.)
[3] https://core.telegram.org/api/stars — ad revenue "in nanograms", Fragment withdrawal URL, `stars_revenue_withdrawal_min`, Stars ad credit; undated, read 2026-10-31; primary.
[4] https://telegram.org/blog/monetization-for-channels — "Sharing Revenue with Channel Owners", 2024-03-31; official blog.
[5] https://ads.telegram.org/ — Telegram Ads landing: 50% to channel owners, paid in Gram; undated, read 2026-10-31; official.
[6] https://kod.ru/telegram-channels-russia-fragment — Russian channels' Fragment TON payouts, Sumsub KYC, RU views earn nothing; published 2026-05-13, updated 2026-05-14; tech press (CLAIMED).
[7] https://kod.ru/telegram-ads-reklama-v-botah — "Banner in Bot" format, bots with ≥ 1,000 monthly users; 2026-09-15; tech press (CLAIMED).
[8] https://telegram.org/tos/bot-developers — Bot Platform Developer Terms §4, §5.2, §6.2.3-6.2.5; undated, read 2026-10-31; contract.
[9] https://core.telegram.org/bots/faq — broadcasting limits, paid broadcasts; undated, read 2026-10-31; official.
[10] https://core.telegram.org/bots/api-changelog — Bot API 7.11 (2024-10-31) `allow_paid_broadcast`; latest 10.3 (2026-08-24); official.
[11] https://core.telegram.org/bots/webapps — `requestWriteAccess`, `allows_write_to_pm` (Bot API 6.9); read 2026-10-31; official.
[12] https://telegram.org/faq_spam — spam reports, human moderation, limits (user accounts); undated, read 2026-10-31; official.
[13] https://docs.adsgram.ai/publisher/get-block-id — AdsGram block types, Reward URL, category blocking, moderation, platform fields; undated, read 2026-10-31; vendor docs.
[14] https://docs.adsgram.ai/publisher/api-reference — `window.Adsgram.init`, `show()` result, events; read 2026-10-31; vendor docs.
[15] https://docs.adsgram.ai/ru/publisher/reward-interstitial-integration — script tag `sad.adsgram.ai/js/sad.min.js`, npm `@adsgram/react` / `@adsgram/vue`; read 2026-10-31; vendor docs.
[16] https://docs.adsgram.ai/bots/block-integration — bot ad API `api.adsgram.ai/advbot`, response fields, non-forwardable rule; read 2026-10-31; vendor docs.
[17] https://adsgram.ai/blog/adsgram/adsgram-vs-monetag-which-platform-is-better-for-telegram-mini-app-monetization — payouts, formats, moderation times; published 2026-08-10, updated 2026-10-30; vendor blog about a competitor (CLAIMED).
[18] https://adsgram.ai/privacy-policy — AdsGram Ltd (Seychelles), data collected; updated 2026-06-16; vendor policy (DOCUMENTED for what the vendor states).
[19] https://sad.adsgram.ai/js/sad.min.js — AdsGram's public SDK file, read 2026-10-31 (two segments); primary artefact (observation, not a full audit).
[20] https://cointelegraph.com/news/telegram-adsgram-launch-devs-earn-ton-ads — AdsGram launch, CPM 0.5-2 TON to developers; 2024-06-27; press (CLAIMED).
[21] https://adsgram.ai/ — homepage: placements incl. "Native message from a Telegram bot"; undated, read 2026-10-31; vendor.
[22] https://docs.monetag.com/ — Monetag TMA SDK docs index, formats, postbacks overview; read 2026-10-31; vendor docs.
[23] https://docs.monetag.com/docs/ad-integration/sdk-integration/ — script tag, npm `monetag-tg-sdk`, `ymid`, `requestVar`; read 2026-10-31; vendor docs.
[24] https://docs.monetag.com/docs/postbacks/macroses/ — postback macros; read 2026-10-31; vendor docs.
[25] https://docs.monetag.com/docs/postbacks/configuration/ — postback config, secret, retries, no dedup; read 2026-10-31; vendor docs.
[26] https://docs.monetag.com/docs/introduction/application-requirements/ — app requirements; read 2026-10-31; vendor docs.
[27] https://monetag.com/privacy/ — Monetag privacy policy, updated 2026-08-14; vendor policy.
[28] https://bundlephobia.com/api/size?package=monetag-tg-sdk (v1.0.4: 891 B / 542 B gzip), https://registry.npmjs.org/monetag-tg-sdk/latest, https://raw.githubusercontent.com/propellerads/monetag-tg-sdk/main/index.ts (injects `//<DOMAIN>/sdk.js`); read 2026-10-31; package measurement + source.
[29] https://tads.me/for-publisher and https://tads.me/publisher — TADS publisher terms (70%), formats, categories, calculator; undated, read 2026-10-31; vendor (CLAIMED).
[30] https://tads.gitbook.io/docs/resourses/payment.md — TADS payouts (USD₮, Net15); read 2026-10-31; vendor docs.
[31] https://tads.gitbook.io/docs/getting-started/publishers/webhooks.md — TADS webhook payload; read 2026-10-31; vendor docs.
[32] https://richads.com/blog/5-best-adsgram-alternatives-to-consider/ — RichAds/OnClicka/Monetag/TADS publisher claims; updated 2026-06-22; vendor blog (CLAIMED).
[33] https://telega.io/blog/monetizing-a-telegram-bot-how-to-add-your-bot-to-the-telega-io-catalog-and-start-earning — bot owner earns per 1,000 delivered messages, ≥ 1,000 active users; 2025-04-11; vendor blog (CLAIMED).
[34] https://elama.ru/blog/skolko-stoit-reklama-v-telegram/ — Telegram ad prices incl. bot ads via Telega.in; 2026-09-14 (data 2026-09-01); reseller guide (CLAIMED).
[35] https://www.consultant.ru/document/cons_doc_LAW_58968/f892dec1383709792452f18d36e7043306e2be0a/ — 38-FZ art. 18, ed. 2026-08-04; law text.
[36] https://pravo.ppt.ru/pismo/fas/n-ak-52901-19-217150 — FAS letter АК/52901/19 of 2019-06-24 (art. 18 applies to messengers); official letter via a legal database.
[37] docs/research/promotion/06-legal-constraints.md §1.2-1.4, §3.3 — 38-FZ art. 6, 18.1, 18.2, KoAP 14.3 (law texts cited there, ed. 2026-08-04); internal report.
[38] https://wnhub.io/news/analytics/item-45194 — Tenjin report on CAS.AI data (6 B impressions): Russia eCPM Q2 2024; published 2024-08-26; trade press relaying a vendor aggregate (MEASURED-secondary).
[39] https://www.appsflyer.com/resources/reports/app-marketing-monetization-report-2024/ — State of App Monetization 2024 (Q3 2024 data, NA + WE); vendor aggregate (CLAIMED).
[40] https://www.blog.udonis.co/mobile-marketing/mobile-games/choices-stories-you-play-monetization — Choices rewarded-ad placements and caps; 2023-12-19; agency analysis (CLAIMED).
[41] https://telegram.org/tos/mini-apps — Terms of Service for Mini Apps (data shared with the service provider; no ad clauses); undated, read 2026-10-31; contract.
Internal: 02-telegram-paid-acquisition.md §1, §4; 07-funnel-metrics-budgets.md §2, §5; 09-gap-fill-access-audience-minors.md §1; PROMOTION.md §0 (R1-R5), §8.5.
