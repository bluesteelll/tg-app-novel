# Promotion research 01: organic discovery inside Telegram, and Telegram Affiliate Programs
Date 2026-10-31. Sources read: 36 (opened). Freshness notes: Bot API changelog read to **Bot API 10.3 (2026-08-24)**;
MTProto client-config page (`/api/config`) read 2026-10-31 (its values are documented *defaults*, not what a live
client receives); Bot Developer ToS read 2026-10-31 (no revision date shown on the page); tapps.center and findmini.app
home pages observed 2026-10-31. **The shared web-search budget ran out during this task**, so a few sub-questions
have fewer sources than planned (listed under Gaps). Pages fetched directly after that point were primary pages
whose URLs were already known.

## TL;DR (decision-relevant)

- **There is one official Telegram store surface: the "Apps" tab of global search, which Telegram calls the "Mini App
  Store".** It shows apps the user has already launched, plus a "popular" list. The popular list comes from
  `bots.getPopularAppBots`, whose selection criteria are not published [1][2][3]. Telegram's docs list three
  conditions for being "featured": a Main Mini App, Stars payments, and high-quality preview media following the
  design guidelines. The ToS adds that Telegram chooses "at its sole discretion" (§8.2.1) [3][4][5]. DOCUMENTED.
  There is no application form, no categories and no published ranking. Two sources CLAIM ranking signals: kod.ru
  says Stars per day [21], and findmini lists DAU/MAU [23]. Neither is a Telegram statement.
- **The cheap levers we control:**
  - a Main Mini App, set in BotFather (Bot API 7.8, 2024-07-31);
  - up to **12 preview photos/videos per language**, with a default set as fallback (`bot_preview_medias_max` = 12,
    DOCUMENTED config default; file size and format limits are NOT documented);
  - the profile description and about text;
  - a good username, which can't be changed once set (5-32 characters, ending in "bot");
  - direct links `t.me/<bot>?startapp=…`;
  - the "Similar bots" profile tab, which is chosen "based on similarities in their subscriber bases"; non-Premium
    users may see a reduced list [1][3][9][10].
- **Not available to us:**
  - The **attachment menu** is for "major advertisers on the Telegram Ad Platform" only [3].
  - The **Gaming Platform** (`/newgame`, `sendGame`, `setGameScore`) still exists with no deprecation notice. A game
    opens as a plain URL in the in-app browser, with no Mini App initData. High scores are meaningless for a VN [11].
  - **Chat-folder (`addlist`) links** can hold channels and groups only, not bots [12].
- **Third-party catalogs are crypto-skewed, or have shrunk.** On 2026-10-31, tapps.center showed **29 listings**, all
  in crypto categories (Wallets, DeFi, NFT…), under a "Something new is coming" banner. TON's old "publishing" guide now
  redirects to core.telegram.org [17][18]. The TON "Telegram Analytics" SDK says its data ranks apps "in the catalog"
  [19]. findmini.app sells a one-week promo slot for **$200 in TON/USDT** and has no games, romance or story category
  [23]. Evidence of romance-VN traffic from either catalog: none found.
- **The Affiliate Program (2024-12-04) is a zero-code switch for the owner:**
  - Commission is set in permille, within `starref_min/max_commission_permille` (documented defaults **1-800 ‰**).
    The duration is in months, or unlimited. Both can only be raised later [6][7][8].
  - Anyone can join from **Settings → My Stars → Earn Stars**: a user, an owned bot or an owned channel. The developer
    does not approve affiliates [6][13].
  - A referral counts only if the user **starts the Mini App for the first time** through the link.
  - Commission applies to Stars purchases in the Mini App. Bot API `AffiliateInfo` appears on `invoice_payment` and
    `paid_media_payment`, and goes **negative on refunds** [14].
  - Fractional commissions are tracked in nanostars [14], so 1-Star prices are not a technical blocker.
  - Uptake evidence: Durov said 15,000 programs and 4 M users reached in 12 days (TASS, 2024-12-17, CLAIMED) [15].
    No conversion or earnings data was found.
- **Stars economics today:**
  - The developer receives **$0.013 per Star** in rewards (ToS §6.2.4). Stars may be held **up to 21 days**. Rewards
    are processed by Fragment and paid to a TON wallet. The minimum withdrawal is 1,000 Stars (`stars_revenue_withdrawal_min`).
  - Alternatively, **$0.02 per Star in Telegram Ads credit** (ToS §6.2.3, "30% discount" per `/api/stars`). All
    DOCUMENTED [4][16][8].
  - Buyers pay about **$0.0141 per Star** at the base rate (`stars_usd_sell_rate_x1000` = 1410, DOCUMENTED default).
    In-app (Apple/Google) it is about **$0.02** (CLAIMED, AdsGram 2026-10-08) [8][20].
- **Russia is the risk for a Russian-first launch, and lies outside the levers above.**
  - Roskomnadzor confirmed nationwide throttling on 2026-02-10. By 2026-03-17, Meduza reported Telegram "largely
    inaccessible" nationwide, with VPNs of little help [24][25].
  - The situation after March 2026 was **not established** (search budget exhausted).
  - Russians also cannot easily buy Stars in-app. SEO articles CLAIM SBP-based resellers as the common route [26].

## Findings

### A1. The Mini App Store / "Apps" tab, popular apps, similar bots

- **What it is.** The Mini App Store launched on 2024-07-31. It is an **Apps** tab in global search, between Channels
  and Media, on mobile, web and desktop. It lists apps the user launched before, plus "top-ranked"/popular apps, and
  supports search by name. At launch it had no categories or recommendations. Telegram said then that 500 M of its
  950 M MAU use mini apps monthly. Sources: Game World Observer 2024-08-01 [21a]; ppc.world 2024-07-29, citing the
  Telegram Info channel [22]. CLAIMED, consistent with the docs below.
  - The 2024-07-31 blog post [27] has a "Mini App Store" image caption but **no section** describing the store
    (checked 2026-10-31; section list: Browser, Sharing to Stories, Gifting Stars, …).
- **Telegram's text (DOCUMENTED):**
  - `/bots/webapps`: "Bots that enabled a main mini app will be displayed in the *Apps* tab of the search **for users
    who have launched them**." Also: "Successful bots which enable a main Mini App and accept payments in Telegram Stars
    **may be featured** in the Telegram Mini App Store". Uploading "high-quality media showcasing your app on your
    bot's profile and following our design guidelines" increases the chances [3].
  - `/bots/features` repeats this: featuring needs a Main Mini App, demo media and Stars payments [9].
  - `/api/bots/webapps`: "Main Mini Apps are also featured in the in-app Mini App Store" [1].
  - `bots.getPopularAppBots(offset, limit)` "Fetch popular Main Mini Apps, to be used in the apps tab of global
    search"; no criteria are given [2].
  - Bot Developer ToS §8.2.1: "Telegram chooses which TPA to feature at its sole discretion" [4].
- **Ranking: no Telegram statement found.** Practitioner claims:
  - kod.ru (2024-12-24, updated 2025-10-12): the in-search ranking orders Mini Apps "by the Telegram Stars they collect
    per day", and lower positions still have tens of thousands of users [21]. CLAIMED, no method.
  - Third-party trackers rank by Stars revenue and MAU (Telemetree, telegramadsarchive), but they are not Telegram's
    list (search-result summaries only; pages not opened). Treat as pointers.
  - A cloudspress summary claims "engagement, ratings, content quality, editorial decisions". Seen only as a
    search-result snippet; not opened, so not used as a fact.
- **Language and region variants.** No Telegram text says the popular list is localized by language or country, and
  no source shows a Russian-language or non-crypto app in it. Unknown (gap). Preview media is localized per user
  language (see A2).
- **Bot profile "monthly users".** Bot profiles of Mini Apps show a monthly unique-user count and a launch button.
  Source: ppc.world 2024-07-29, from the Telegram Info channel [22]. CLAIMED.
- **"Similar bots" tab (DOCUMENTED).** `bots.getBotRecommendations(bot)` returns "similarly themed bots, selected based
  on similarities in their subscriber bases". Clients show it in "a special 'Similar bots' tab in the bot's profile".
  "Non-Premium users may get a reduced result set" [10][10a].
  - No method exists to opt in, choose neighbours or pay for placement. ANALYSIS: being listed there depends on
    sharing an audience with other bots.

### A2. The Main Mini App, media previews, BotFather eligibility

- **Main Mini App.** Bot API **7.8 (2024-07-31)**: "Added the option for bots to set a Main Mini App, which can be
  previewed and launched directly from a button" [5]. It is set in @BotFather. The profile shows "Launch app" / "Open
  App". The link is `t.me/<bot>?startapp[=param][&mode=compact]`. By default it opens full-screen height [1][3][9].
  DOCUMENTED.
- **Media previews (DOCUMENTED):**
  - They are "Screenshots and video demos" on the profile, available after the Main Mini App is enabled.
  - "A maximum of `bot_preview_medias_max` preview medias may be added per localization key", with config default
    **12** ("Maximum number of main mini app previews that can be added for a localization").
  - The language with an empty `lang_code` is the fallback. Clients "automatically select the correctly localized
    variant" from the user's language [1][8].
  - They are managed in BotFather or via `bots.addPreviewMedia` / `editPreviewMedia` / `reorderPreviewMedias` /
    `deletePreviewMedia` (owner only, user API).
  - No Bot API changelog entry covers previews (checked to 10.3) [5].
  - **Dimension, duration, file-size and format limits: not documented on any page opened** (gap).
- **What BotFather requires.** No eligibility checklist for the store exists in the docs [1][3]. The documented
  requirements nearby:
  - ToS §4: "all TPA must be bound by a privacy policy that is easily accessible"; you provide your own in @BotFather
    where the standard policy is insufficient [4].
  - The client opens `privacy_policy_url`, else `/privacy`, else telegram.org/privacy-tpa (search-result summary of
    `botInfo` [28]).
  - Stars payments for digital goods, otherwise "Telegram cannot display your bot or mini-app to mobile users" [16].
  - Username: 5-32 characters, Latin letters, digits and underscore, ends in "bot", "can't be changed" once set. The
    "What can this bot do?" description and the short "About" text appear on the profile [9].
  - The page says nothing on an icon requirement, beyond the loading-screen settings (`botAppSettings`: background,
    header colour, placeholder SVG) [1].

### A3. The Telegram Gaming Platform

- **Still documented, no deprecation notice** on `/bots/games` (read 2026-10-31), and none in the changelog to 10.3
  [11][5]. How it works:
  - `/newgame` in BotFather; `sendGame` or inline mode.
  - The Play button triggers a callback; the bot answers with a URL that opens "in the in-app browser".
  - Per-chat high-score tables and service messages via `setGameScore` / `getGameHighScores`.
  - `TelegramGameProxy.shareScore()` "Do not call this method without consent and direct action from the user" [11].
  - From research_M2 (re-checked): it is a plain URL launch, so **no Mini App initData**. Games cannot be sent to
    channels.
- **Discovery benefit:** none documented. Discovery runs through inline mode (`@gamebot`, `@gamee` as examples) and
  chat sharing [11].
- **Fit for a VN (ANALYSIS).**
  - A score that must only grow is meaningless for branching endings. A "score = endings found" table would expose
    ending counts, which conflicts with owner rule Q25.
  - The URL launch lacks signed initData, so our auth (principle 3) does not apply.

### A4. Other in-Telegram organic levers

- **Direct links and channel buttons (DOCUMENTED).**
  - `t.me/<bot>?startapp=<param>` opens the Main Mini App directly. `start_param` reaches the app as `start_param` /
    `tgWebAppStartParam`. "Mini Apps opened from a direct link have no access to the chat" [3].
  - `/bots/webapps` documents no channel-specific "Open app" button [3]. From research_M2 [10] (Bot API 10.3): an
    inline `web_app` button is "Available only in private chats". So a channel post carries a **URL** button with the
    `t.me/…?startapp=` link.
- **Attachment menu (DOCUMENTED, not available).**
  - `/bots/webapps`: "limited to major advertisers on the Telegram Ad Platform"; all bots can use it on the test
    server [3].
  - `/bots/features`: "restricted to certain approved bots" [9].
- **Username search/SEO.** The username "is used in search, mentions and t.me links" [9]. Telegram documents no other
  ranking inputs for bot search (gap).
- **A companion channel (DOCUMENTED mechanics):**
  - Boosts: each boost lets a channel "post one additional story per day" [29].
  - Channel stories need boosts from Premium users, and the poster must be Premium.
  - The level-1 threshold is CLAIMED at 0.1% of subscribers, after an earlier 0.4% (Telegram Premium channel posts,
    via search-result summary). Not opened, so treat as a pointer [29a].
  - **Stars giveaways** "automatically distribute Telegram Stars among the winners". The channel gets `yearly_boosts`
    for one year, and can limit the giveaway to `only_new_subscribers`, by country, or to "additional channels" the
    user must join [30].
- **Chat-folder (`addlist`) links (DOCUMENTED).** "Only channels and groups/supergroups may be specified". A partner
  folder can include our companion channel, but **not the bot** [12].
- **Mini App home-screen shortcut.** Users can add a Mini App to the phone home screen: on iOS through the menu's
  Safari option, on Android via "Создать ярлык" ("create shortcut"). Source: kod.ru, 2024-12-29, updated 2025-05-23
  [31]. CLAIMED. A retention aid, not a discovery lever.

### B. Third-party catalogs

- **Telegram Apps Center (tApps):**
  - **Historically (CLAIMED):** a TON-ecosystem catalog (AdsGram 2024-12-15: "developed by the TON Studio team").
    Submitted free via `@app_moderation_bot`, with BotFather description, screenshots and icon. Categories: work,
    entertainment, finance, education… [32].
  - kod.ru CLAIMED about 80 games, 180 utilities, 60 Web3 and 180 business apps; over 3 M monthly users in autumn
    2024; and an audience split of 25% Russia/CIS, 25% Europe, 25% South Asia, 10% USA, 15% other [21]. No method;
    old data.
  - **Today (observed 2026-10-31) [17]:**
    - tapps.center shows **29 listings** in the categories Wallets, Swap & DeFi, Stablecoins & Payments, NFT &
      Marketplaces, Naming & Identity, Explorers & Analytics, Developer Infrastructure and Official.
    - A banner reads "Something new is coming", and the footer has a "Join Channel" link to t.me/trendingapps.
    - There is no submission route on the page.
    - The TON publishing guide (`docs.ton.org/…/tma/guidelines/publishing`) now **308-redirects to
      core.telegram.org/bots/webapps** [18].
  - ANALYSIS: in its current form the catalog is a crypto directory with no slot for a romance VN.
- **TON "Telegram Analytics" SDK** (`@telegram-apps/analytics` / tganalytics.xyz) [19]:
  - It tracks "app launches and TON Connect interactions". The token comes from TON Builders; the README also mentions
    @DataChief_bot.
  - "This data is used solely for to rank applications in the catalog based on their performance and Streaks".
  - No page opened states that it is **required** for listing (the context brief's premise: unverified).
  - The docs.ton.org analytics page redirects to the GitHub repo [19].
  - Principle check: a third-party script in the client, sending launch data to an external party. It would need
    review against principle 6 and the privacy policy (152-FZ).
- **findmini.app (observed 2026-10-31) [23]:**
  - A directory and analytics site. Categories visible: TON, Text Generation, Psychology, Stickers, Gifts, Language
    Learning, Monetization… **No games, story, romance or dating category.** Story-like apps (e.g. "ToonTrek" manga
    stories) appear in its charts.
  - "Add your app" is free. A **Promo block costs $200 in TON or USDT per week**. A third-party traffic seller is
    advertised at $0.01-0.15 per user. All CLAIMED vendor prices.
  - Its own stats: TMA MAU 102.7 M (+4.6%/30 d) and bot MAU 330.3 M. The site notes that bot growth comes partly from
    adding bots to its database. Method undisclosed: CLAIMED.
  - TON-section count: 3,343 TON Mini Apps.
- **Russian bot catalogs.** One search only. No primary catalog with listing rules or traffic was found (gap).

### C. Telegram Affiliate Programs (re-verified from research_M4 §2c, extended)

- **Launch.** Blog post of 2024-12-04: "Any mini app or bot developer on Telegram can start their own Affiliate
  Program". Users and channels join from the Star Balance. Programs are sortable by "start date, total revenue or
  potential profit". Commissions appear "in real time" [13]. Bot API 8.1, the same date, added
  `TransactionPartnerAffiliateProgram` and the affiliate field on transactions [5]. DOCUMENTED.
- **Creating a program (MTProto, DOCUMENTED) [6]:**
  - `bots.updateStarRefProgram(bot, commission_permille, duration_months?)`. With no duration, "there is no
    expiration date". Both values "may only be raised after creation".
  - Setting `0` ends the program in about 24 h, "invalidating all created affiliate links". After that,
    `STARREF_AWAITING_END` blocks a new program until the end date.
  - Affiliates keep commissions already earned. Users referred before the end keep generating commissions until each
    affiliate's period expires [6][13].
  - The tour page: only the owning account can create, modify or terminate a program, and does so from the Mini
    App's profile page [7].
- **Commission bounds.** The config defaults are `starref_min_commission_permille = 1` and
  `starref_max_commission_permille = 800`, i.e. **0.1%-80%** [8].
  - These are documented defaults. The live value a 2026 client receives was not observable without logging in, so
    "observed in 2026" bounds remain a gap.
  - The default `starref_program_allowed = false` / `starref_connect_allowed = false` on the same page are per-user
    gates sent by the server. They do not mean the feature is off [8].
- **Duration options.** A whole number of months via `duration_months`, or unlimited [6]. The tour page's example is
  "30 days" from first launch [7]. The UI's offered set of durations was not documented (gap).
- **How affiliates discover programs.**
  - In-app: Settings → My Stars → Earn Stars [7].
  - Client side: `payments.getSuggestedStarRefBots(order_by_revenue | order_by_date, offset, limit)` [6].
  - Who can join: self, an owned bot, or an owned channel where the user has the `post_messages` right, via
    `payments.connectStarRefBot`. "There are no limits on the number of programs a user can join". Multiple links per
    program are allowed, each to a different balance [6][7].
  - No developer approval step exists [6].
  - The tour page warns affiliates that spamming links "could lead to temporary account limitations" [7].
  - No third-party affiliate marketplace was found (gap; one search).
- **Links (DOCUMENTED).** Formats:
  - `t.me/<bot>?ref=<referrer>`
  - `t.me/<bot>?start={prefix}<referrer>`, where the prefix is mandatory
  - default `starref_start_param_prefixes = ["_tgr_"]`, which **closes research_M4's gap**
  - the client must always call `contacts.resolveUsername(referer=…)`; `STARREF_EXPIRED` means an invalid link
  [6][8][33].
  - Whether a ref link opens the Main Mini App or the bot chat is **not stated** [33] (gap).
- **Attribution.** "any Telegram user who starts the mini app **for the first time** after following a referral link".
  The commission runs "for `duration_months` months after your referral link is imported" [6].
  - First-launch rule: an existing player cannot be attributed later (DOCUMENTED) [6][7].
  - Multiple referrers: not covered (gap).
- **What it covers.**
  - Docs: "each mini app transaction" in Stars [6]. "intended for mini apps that offer digital products for Telegram
    Stars"; physical goods via third-party providers give no commission [7].
  - Bot API: `TransactionPartnerUser.affiliate` "Can be available only for 'invoice_payment' and
    'paid_media_payment'" [14].
  - Subscriptions are `invoice_payment` with `subscription_period` (2592000 s only) [14]. INFERENCE: they are
    covered. No text says so explicitly.
  - `createInvoiceLink` + `openInvoice` purchases are `invoice_payment`, so they are covered (DOCUMENTED type mapping).
- **Refunds (DOCUMENTED).** `AffiliateInfo.amount` "can be negative for refunds", and so can `nanostar_amount` [14].
  The MTProto `starsTransaction` carries `starref_commission_permille`, `starref_peer` and `starref_amount` [16a].
  - Reading: the affiliate's commission is reversed on a refund. Who absorbs a reversal the affiliate has already
    withdrawn is not documented (gap).
- **Fractional amounts (DOCUMENTED).** `amount` is "rounded to 0", plus `nanostar_amount` in 1/10⁹ Stars [14].
  - Example: a 1-Star chapter at 200 ‰ gives the affiliate 0.2 Star, booked in nanostars.
  - `commission_per_mille` = "Stars received by the affiliate for each 1000 Telegram Stars received by the bot".
    Whether the commission comes from the developer's share or from gross is not stated beyond this definition (gap).
- **Uptake evidence.**
  - Durov via TASS (2024-12-17): **15,000 programs created in 12 days**, and **4 M users** got Mini App links [15].
    CLAIMED.
  - One blog example of 15% on a sticker pack (search snippet, unverified).
  - No 2025-2026 conversion, earnings or romance/VN case was found (gap).
- **Estimate formula (DOCUMENTED, for affiliates):** `daily_revenue_per_user * commission_permille / 1000` Stars per
  day per referred user [6]. The affiliate sees our revenue per user. ANALYSIS: an app with tiny prices looks
  unattractive in a list sorted by revenue or potential profit.

### C2. Stars economics for the developer today

| Item | Value | Label / source |
|---|---|---|
| Developer reward per Star | **$0.013** | DOCUMENTED, ToS §6.2.4 [4]; config `stars_usd_withdraw_rate_x1000 = 1300` [8] |
| Hold before reward/ads use | "up to 21 days after their receipt" | DOCUMENTED, ToS §6.2.4 [4] |
| Payout processor | Fragment → TON wallet ("a unique URL to a Fragment page") | DOCUMENTED [4][16a] |
| Minimum / maximum withdrawal | 1,000 / 25,000,000 Stars | DOCUMENTED config defaults [8] |
| Ads credit per Star | **$0.02** ("may fluctuate"); "special rate with a 30% discount" | DOCUMENTED, ToS §6.2.3 [4]; `/api/stars` [16a] |
| Ads credit scope | only for the channel/bot that earned the Stars | CLAIMED, AdsGram 2026-10-08 [20] |
| Buyer price, base rate | **$0.0141/Star** ($1.41 per 1000) | DOCUMENTED config default `stars_usd_sell_rate_x1000 = 1410` [8]; AdsGram calls it the Fragment rate [20] |
| Buyer price, in-app (iOS/Android) | ~$1.99 per 100 (~$0.02/Star); 50 for ~$0.99 (US) | CLAIMED [20]; reseller pages via search only |
| Prices vary by user | "due to VAT and other applicable fees" | DOCUMENTED, payments-stars [16] |
| Topics-in-private-chats fee | 15%, non-refundable, while topics are enabled | DOCUMENTED, ToS §6.2.6 [4] |
| Payout coin | "Toncoin (renamed Gram)" | CLAIMED, AdsGram 2026-10-08 [20]; unverified |
| Buying Stars from Russia | App Store route unavailable to many; SBP resellers | CLAIMED, SEO articles 2026 [26] |

ANALYSIS: a buyer pays about $0.02 for a Star in-app, and the developer receives $0.013, about 65%. A program at
N ‰ takes N/1000 of what the bot receives.

## Channel rows (for the synthesis table)

| Channel | Cost (with currency, date, label) | Effort | Fit for a Russian-first romance VN for girls in a TMA | Evidence quality | Notes |
|---|---|---|---|---|---|
| Apps tab, "recently launched" list | Free (DOCUMENTED, 2026-10) | None beyond a Main Mini App | Retention only: shows the app to users who already launched it | A | [3] |
| Mini App Store "popular"/featured | Free; editorial "sole discretion" (DOCUMENTED) | Main Mini App + Stars + previews + design guidelines; no form | High upside, unpredictable. Ranking CLAIMED to follow Stars/day, which favours high spenders, not 1-Star prices | B (criteria undocumented) | [2][3][4][21] |
| Main Mini App profile + preview media | Free | 12 media per language (RU, EN, default); copy; icon/loading settings | Direct fit; per-language previews match RU-first/EN-second | A | Formats undocumented [1][8] |
| "Similar bots" profile tab | Free; not controllable | None | Depends on audience overlap with other bots; reduced for non-Premium users | A (mechanism) / C (effect) | [10] |
| Bot username / global search | Free; username permanent | Choose once | Name search only; no documented SEO | B | [9] |
| Direct links in posts / channel URL buttons | Free | Low | Core vehicle for every other channel (our `startapp` code) | A | `web_app` buttons are private-chat only (M2) |
| Companion channel: stories, Stars giveaways | Giveaway prizes in Stars (owner value); stories need boosts | Medium-high (content cadence) | Plausible for a story audience; giveaway can target new subscribers and countries | A (mechanics) / C (effect) | Minors and giveaway law: area 03/legal [29][30] |
| Partner folder (`addlist`) links | Partner negotiation | Medium | Can carry the channel, not the bot | A | [12] |
| Attachment menu | N/A: "major advertisers" only (DOCUMENTED) | — | Not available | A | [3][9] |
| Telegram Gaming Platform | Free | Separate product; no initData | Poor: scores meaningless, ending counts exposed (Q25) | A | [11] |
| Telegram Apps Center (tapps.center) | Free historically (CLAIMED 2024); current route unknown | Unknown (redesign "coming") | Poor today: 29 crypto-only listings (observed 2026-10-31) | C | [17][18][32] |
| TON Telegram Analytics SDK (catalog ranking) | Free | Client script + token | Questionable: third-party telemetry vs principle 6 and 152-FZ; "required" not confirmed | B | [19] |
| findmini.app | Free listing; promo $200 TON/USDT per week (CLAIMED vendor, 2026-10-31) | Low | Weak: no story/romance category, crypto payment, TON-heavy | C | [23] |
| Russian bot catalogs | ? | ? | ? | — | Gap |
| Telegram Affiliate Program | 0.1-80% of each referred purchase (DOCUMENTED default bounds), for N months or forever | One owner action in the profile; no code | Low-friction add-on; rewards channels that bring payers; tiny prices make it unattractive in sorted lists; first-launch rule | A (mechanics) / C (uptake) | [6][7][8][13][14][15] |

## Applicability to tg-app-novel (mapped to §2 of the context pack; asks are listed, not designed)

- **M10/M11 invite link and attribution vs affiliate links.**
  - Affiliate links use `?ref=` or `?start=_tgr_<referrer>`. Our invite link uses `?startapp=f<code>` [33][8].
  - An affiliate-referred launch carries no `startapp` code. So M11's "newcomer" attribution records it as
    unattributed (ANALYSIS).
  - Whether a ref link launches the Main Mini App at all, or the bot chat (where `/start _tgr_…` would reach the
    webhook), is undocumented. That needs a test-bot check before relying on it.
  - The affiliate is visible server-side only on the payment's `TransactionPartnerUser.affiliate` [14].
  - Ask: the webhook and transaction import must tolerate `affiliate` and negative `amount`/`nanostar_amount` on
    refunds (already a research_M4 note).
- **M14 share / M23 referral.** The affiliate first-launch rule means one user can't be attributed twice. Our M23
  referral grants hints, not Stars. The two systems can coexist (research_M4 §2c, re-confirmed). Ask: decide which
  wins when both an affiliate link and a friend link touch one user. Only our M23 is under our control.
- **Store eligibility asks (product features, listed):**
  - Main Mini App enabled.
  - Stars payments live.
  - RU + EN + default preview sets (≤ 12 each); per-language profile description and about text.
  - A loading-screen SVG and colours.
  - Public privacy policy URL in BotFather (MV defaults already plan `/privacy`).
  - Following Telegram's Mini App design guidelines.
- **Paid-content rule (principle 0).** Preview media is public profile content. It must show only chapter-1 or free art,
  never paid-chapter art (ANALYSIS).
- **Q25 / no ending totals.** This rules out the Gaming Platform high-score route. Any "share score" card must also
  obey it.
- **MV11 (Affiliate "not used" default).**
  - The facts that inform it: no code is needed; the setting is one-way (commission can only be raised; ending it
    takes about 24 h and voids links); the cost is a share of revenue per referred payer.
  - No VN uptake data was found.
  - Ask: if enabled, start low. The setting can only go up.
- **Principle 6 / privacy.** The TON analytics SDK and any catalog SDK are third-party client code and data flows.
  They need a ruling before use.

## Pitfalls / what goes wrong (sourced)

- Commission and duration **cannot be lowered**. To lower them, end the program (about 24 h, links invalidated) and
  start a new one [6].
- Already-referred users keep paying affiliates after the program ends, until each affiliate's period expires. An
  unlimited duration means "forever" [6][13].
- Affiliate links spammed into public groups can get the *affiliate* limited [7]. Bot-side spam is forbidden too:
  ToS §5.2(b) "spam", §5.2(d)(ii) "Social growth manipulation" [4].
- Stars are held up to 21 days, and can be withheld or debited for user refunds (ToS §6.2.4, research_M4 [4]). Cash
  flow lags sales.
- Withdrawal starts at 1,000 Stars, i.e. $13 [8]. At 1-Star prices that is 1,000 purchases before the first payout.
- Selling digital goods outside Stars makes Telegram unable to show the bot to mobile users [16]. Featuring requires
  Stars payments anyway [3].
- Old guides send developers to the TON publishing page and tApps. Both have moved or changed [17][18].
- Russia: nationwide throttling from 2026-02-10, near-total inaccessibility by mid-March 2026 [24][25]. Any
  Russia-first discovery plan inherits this.

## Key claims for verification

1. Featuring requires a Main Mini App and Stars payments, and is improved by media plus design guidelines.
   https://core.telegram.org/bots/webapps (DOCUMENTED, read 2026-10-31)
2. The Apps tab shows Main Mini Apps "for users who have launched them".
   https://core.telegram.org/bots/webapps (DOCUMENTED)
3. `bot_preview_medias_max` = 12 per localization. https://core.telegram.org/api/config (DOCUMENTED default)
4. The attachment menu is limited to major advertisers on the Telegram Ad Platform.
   https://core.telegram.org/bots/webapps (DOCUMENTED)
5. Affiliate commission bounds default to 1-800 ‰. https://core.telegram.org/api/config (DOCUMENTED default; the live
   value is unobserved)
6. `starref_start_param_prefixes` = `["_tgr_"]`. https://core.telegram.org/api/config (DOCUMENTED default)
7. Affiliate commission/duration can only be raised; `0` ends the program in about 24 h.
   https://core.telegram.org/api/bots/referrals (DOCUMENTED)
8. `AffiliateInfo` appears only on `invoice_payment` / `paid_media_payment`; `amount` and `nanostar_amount` can be
   negative for refunds. https://core.telegram.org/bots/api (Bot API 10.3, DOCUMENTED)
9. The developer reward is $0.013/Star, held up to 21 days; ads credit is $0.02/Star.
   https://telegram.org/tos/bot-developers §6.2.3-6.2.4 (DOCUMENTED)
10. The buyer base rate is $1.41 per 1000 Stars. https://core.telegram.org/api/config `stars_usd_sell_rate_x1000`
    (DOCUMENTED default)
11. 15,000 affiliate programs and 4 M users in 12 days (2024-12-17).
    https://finance.mail.ru/article/durov-za-12-dney-na-partnerskoy-platforme-telegram-sozdano-15-tys-programm-64101285/
    (CLAIMED)
12. tapps.center lists 29 crypto-category apps on 2026-10-31. https://tapps.center (observed)
13. findmini.app promo costs $200 in TON/USDT per week. https://findmini.app (CLAIMED vendor price, 2026-10-31)
14. Telegram was largely inaccessible in Russia by 2026-03-17.
    https://meduza.io/en/feature/2026/03/17/russia-was-expected-to-block-telegram-in-april-it-appears-to-have-done-it-two-weeks-early
    (CLAIMED press)

## Gaps (asked but no reliable source found)

- The ranking or eligibility formula for "popular" apps. Whether that list is per language or region, and whether any
  Russian-language or non-crypto app appears in it.
- Preview media formats: dimensions, video length, file size.
- The live (2026) affiliate commission bounds and the UI's duration choices; only documented defaults were read.
- Whether `?ref=` / `?start=_tgr_` links open the Main Mini App or the bot chat.
- Handling of multiple referrers, and who absorbs a refund reversal of a commission already withdrawn.
- Affiliate uptake after 2024-12: conversion, earnings, any VN or romance case.
- Third-party affiliate marketplaces for Telegram programs.
- Russian bot/Mini App catalogs (listing rules, traffic); one search only, then the shared search budget was
  exhausted.
- **The status of Telegram in Russia after March 2026**, and the current Russian audience. This is critical for a
  Russian-first launch: no source after 2026-03-17 was obtained before the search budget ran out.
- The current tApps submission route and whether the TON analytics SDK is a listing requirement.
- In-app Star prices per platform from an official source; only CLAIMED prices were found.

## Owner value questions this area raises (each with a default reading)

1. **MV11: turn on the Affiliate Program?** Default reading: keep "not used" until a store presence and real prices
   exist. If turned on, start at a low commission with a finite duration, since both can only be raised.
2. **Preview media per language.** Who produces 12 RU and 12 EN previews, and from which art? Default: free/chapter-1
   art only (principle 0); RU set first, EN second, default set = EN.
3. **A companion channel?** Default: yes as an owner content decision, with no Stars giveaways until the legal area
   clears giveaways involving minors.
4. **A paid third-party catalog slot** (findmini $200 in TON/USDT per week)? Default: no. The audience is crypto-skewed,
   and paying in crypto is a business and jurisdiction question (Q21).
5. **Russia-first vs. the 2026 Telegram block.** Default: treat the Russian market as at risk until a current source
   says otherwise. This feeds Q21 (jurisdiction) and the language order.
6. **Bot username** (permanent). Default: a name readable in both Latin-script search and Russian, decided before any
   public link circulates.

## Sources

[1] https://core.telegram.org/api/bots/webapps — MTProto "Mini Apps on Telegram": Main Mini App, preview media
methods, "featured in the in-app Mini App Store"; read 2026-10-31; primary.
[2] https://core.telegram.org/method/bots.getPopularAppBots — popular Main Mini Apps for the Apps tab; read
2026-10-31; primary.
[3] https://core.telegram.org/bots/webapps — Mini Apps doc: Apps tab, featuring conditions, attachment menu
eligibility, direct links; read 2026-10-31; primary (contract).
[4] https://telegram.org/tos/bot-developers — Bot Developer ToS §4, §5.2, §6.2.3-6.2.6, §8.2.1; read 2026-10-31
(no revision date shown); primary.
[5] https://core.telegram.org/bots/api-changelog — Bot API changelog to 10.3 (2026-08-24); 7.8, 8.0, 8.1, 9.0-9.3,
9.4-10.3 entries; read 2026-10-31; primary.
[6] https://core.telegram.org/api/bots/referrals — Affiliate programs (MTProto); read 2026-10-31; primary.
[7] https://telegram.org/tour/affiliate-programs/ru?setln=en — Telegram tour/FAQ "Affiliate Programs"; read
2026-10-31; primary (Telegram).
[8] https://core.telegram.org/api/config — client configuration defaults (`bot_preview_medias_max`, `starref_*`,
`stars_usd_*`, `stars_revenue_withdrawal_*`); read 2026-10-31; primary (documented defaults).
[9] https://core.telegram.org/bots/features — bot features: Main Mini App, previews, store, username, attachment
menu, games; read 2026-10-31; primary.
[10] https://core.telegram.org/method/bots.getBotRecommendations — similar bots method; read 2026-10-31; primary.
[10a] https://core.telegram.org/api/recommend — "Similar bots" tab, Premium-reduced results; read 2026-10-31; primary.
[11] https://core.telegram.org/bots/games — Gaming Platform; read 2026-10-31; primary.
[12] https://core.telegram.org/api/folders — shareable chat folders: channels/groups only; read 2026-10-31; primary.
[13] https://telegram.org/blog/affiliate-programs-ai-sticker-search — blog 2024-12-04; read 2026-10-31; primary.
[14] https://core.telegram.org/bots/api — Bot API 10.3: AffiliateInfo, TransactionPartnerUser,
TransactionPartnerAffiliateProgram, TransactionPartnerFragment/TelegramAds, RevenueWithdrawalState,
createInvoiceLink.subscription_period; read 2026-10-31; primary.
[15] https://finance.mail.ru/article/durov-za-12-dney-na-partnerskoy-platforme-telegram-sozdano-15-tys-programm-64101285/
— TASS report of Durov's numbers, 2024-12-17; read 2026-10-31; CLAIMED (founder statement via press).
[16] https://core.telegram.org/bots/payments-stars — Stars payments: Apple/Google/PremiumBot purchase, VAT
variation, Stars for Telegram Ads, mobile visibility rule; read 2026-10-31; primary.
[16a] https://core.telegram.org/api/stars — MTProto Stars: starref fields on transactions, Fragment withdrawal, ads
"30% discount"; read 2026-10-31; primary.
[17] https://tapps.center — Telegram Apps Center home page, observed 2026-10-31 (29 listings, crypto categories).
[18] https://docs.ton.org/v3/guidelines/dapps/tma/guidelines/publishing — 308 redirect to core.telegram.org/bots/webapps,
observed 2026-10-31.
[19] https://github.com/telegram-mini-apps-dev/analytics — TON Telegram Analytics SDK README (target of the
docs.ton.org/ecosystem/tma/analytics redirect); read 2026-10-31; vendor primary for its own SDK.
[20] https://adsgram.ai/blog/adsgram/telegram-stars-explained-price-in-usd-how-to-earn-and-withdraw- — AdsGram,
2026-10-08; Stars prices and withdrawal; CLAIMED (ad-network blog).
[21] https://kod.ru/mini-apps-telegram-trend — kod.ru, 2024-12-24 (updated 2025-10-12); ranking-by-Stars claim,
tApps numbers; CLAIMED (media).
[21a] https://gameworldobserver.com/2024/08/01/telegram-mini-app-store-500-million-mau-browser — Mini App Store
launch coverage, 2024-08-01; CLAIMED (trade press).
[22] https://ppc.world/news/v-beta-versii-telegram-dlya-android-poyavilsya-katalog-mini-prilozheniy/ — Apps tab in
Android beta, monthly users on profiles, 2024-07-29; CLAIMED (media citing Telegram Info).
[23] https://findmini.app — FindMini.app home page, observed 2026-10-31; vendor prices and stats; CLAIMED.
[24] https://en.wikipedia.org/wiki/Blocking_of_Telegram_in_Russia — timeline to 2026-03-17 (last edit 2026-09-09);
read 2026-10-31; pointer to press sources.
[25] https://meduza.io/en/feature/2026/03/17/russia-was-expected-to-block-telegram-in-april-it-appears-to-have-done-it-two-weeks-early
— Meduza, 2026-03-17; CLAIMED (press).
[26] https://vc.ru/services/2941461-kak-kupit-zvyozdy-telegram-v-rossii — one of the 2026 SEO guides on buying Stars
from Russia (seen in search results, not opened); CLAIMED pointer only.
[27] https://telegram.org/blog/w3-browser-mini-app-store?setln=en — blog 2024-07-31 (section list checked);
read 2026-10-31; primary.
[28] https://core.telegram.org/constructor/botInfo — `privacy_policy_url` fallback to `/privacy` / privacy-tpa (from
the search-result summary; page not opened separately); pointer.
[29] https://core.telegram.org/api/boost — boosts and per-level features, stories per boost; read 2026-10-31; primary.
[29a] https://tginfo.me/?p=6084 — channel stories, boost thresholds (seen in search results only); CLAIMED pointer.
[30] https://core.telegram.org/api/giveaways — Premium and Stars giveaways; read 2026-10-31; primary.
[31] https://kod.ru/icons-telegram-mini-apps — home-screen shortcuts, 2024-12-29 (updated 2025-05-23); CLAIMED.
[32] https://adsgram.ai/blog/adsgram/vsyo-o-telegram-apps-center — AdsGram on tApps Center, 2024-12-15; CLAIMED.
[33] https://core.telegram.org/api/links — referral link formats, Main Mini App links; read 2026-10-31; primary.
Prior research reused: D:/tmp/novel-orch/design/choices/research_M4.md §2c (lines 131-155),
D:/tmp/novel-orch/design/choices/research_M2.md (Games, `web_app` button scope).
