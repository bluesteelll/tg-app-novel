# Promotion research 07: funnel, metrics, soft launch and budget tiers
Date 2026-10-31. Sources read: 44 (41 web pages opened + 3 repo/prior-research files). Freshness notes: Bot API changelog
read to 10.3 (2026-08-24), with no Stars, analytics or `startapp` change in 10.0-10.3 [12]. Telegram Bot Developer Terms
read 2026-10-31 (the page shows no "last updated" date) [1]. Telegram client config defaults read 2026-10-31 [2]. The ad
price pages are dated 2025-01 to 2026-10. **The web search budget of this session ran out partway through.** After that
only already-known URLs were opened. The gaps that caused are listed under "Gaps".

## TL;DR (decision-relevant)
- **One Star nets the developer $0.013 in cash, or $0.02 in Telegram Ads credit.** Both rates are DOCUMENTED [1][2].
  Withdrawal needs ≥ 1,000 Stars and goes through Fragment in TON [2][3]. A Star may be held up to 21 days [1]. A buyer
  on iOS (US) pays $1.99 for 100 Stars [5]; in Russia the App Store price is 209 ₽ for 100 [6]. So the developer keeps
  about **65 % of what an iOS buyer pays** and about 92 % of the Fragment price (ANALYSIS). One chapter priced at
  N Stars brings in **N × $0.013** in cash.
- **No public benchmark exists for this exact product.** Nobody publishes D1/D7, chapter-1 completion or
  paywall→purchase figures for TMA games, for interactive-story or romance games, or for "free chapter → paid chapter" models.
  Every TMA number found is CLAIMED. The only measured-sample benchmarks cover all genres together: GameAnalytics 2026
  (16,262 mobile games, 2025 data), with D7 median just under 4 %, D7 top 25 % at 6-7 % and D30 median 0.69-0.79 % [17].
  For interactive-story games the only statement found is that retention is "notoriously low" (CLAIMED) [34].
- **The worked break-even example (§5) earns $0.078 per Mini App start in its base case.** Base case: 40 % finish
  chapter 1, 5 % of those buy, a payer buys 3 chapters at 100 Stars, $0.013 per Star; all funnel inputs are
  ASSUMPTIONS. The sensitivity range is **$0.005-0.54 per start**. Paid traffic costs roughly €0.15-0.70 per start on
  Telegram Ads and far more through Telegram channel posts (CLAIMED inputs). So at base-case conversion paid
  acquisition loses money. It pays only near the top of the range: ≥ 10 % paywall conversion, ≥ 5 chapters per payer,
  ≥ 150 Stars per chapter.
- **The server already records most funnel numerators.** Purchase intent, checkout, payment and refund are in the
  `orders` and `payments` tables (`server/migrations/0001_init.sql:12-49`). New users and language are in `users`
  (`:3-10`). The planned Y9 events (`chapter_started`, `chapter_completed`, `ending_reached`) add the chapter funnel.
  **Missing:** D1/D7/D30 retention (`users.last_seen_at` is overwritten, and `chapter_started` skips resumes), campaign
  attribution from `start_param`, and paywall shown/dismissed and share events. Those are product asks, listed below.
- **Telegram gives almost no analytics.** A bot's profile shows monthly users only above a threshold Telegram does not
  disclose [16]. Bot owners can read Stars revenue stats [3]. The webapps doc describes no Mini App analytics [13]. The
  TON-backed "Telegram Analytics" SDK sends launches and TON Connect events to TON Builders and is used "to rank
  applications in the catalog" [14]. No source says any store requires it.
- **Soft-launch arithmetic sets the budget floor.** Two figures need real traffic. Reading D1 to ±3 points needs about
  900 starts [22]. A paywall test needs about 1,470 paywall viewers per arm to detect 5 % → 7.5 % (ANALYSIS, §4), which
  is about 3,700 starts per arm. At about €0.25 per start that is **about €1,850 for one two-arm paywall test**. A
  $300-1,000/month tier can measure the funnel but cannot run significant A/B tests within a month; the
  $3,000-10,000 tier can.
- **Price A/B tests in Russia carry legal risk.** Under Russian Civil Code art. 426 §2 the price in a public contract
  "must be the same for consumers of the corresponding category" [38]. Showing different users random prices may
  conflict with this (INTERPRETATION, not legal advice; a lawyer item). No Telegram rule on price testing was found in
  the Stars terms read [1][4].
- **Russian reach is shrinking and moving.** Mediascope via ppc.world puts Telegram's monthly audience at 94 M in March
  2026 and 76 M in June 2026, blamed on blocks plus a seasonal dip (CLAIMED) [26]. Telegram Ads minimum CPMs in Russia
  changed twice in August 2026, in opposite directions [28][29]. Any plan built on Russian paid traffic needs a
  re-check at launch.

## Findings

### 1. Metrics and definitions, with benchmarks

**Definitions** (standard practice; how each maps to this product's flow):
- **DN retention.** The share of a day-0 cohort (first launch) active on day N ("classic" retention, the method
  GameAnalytics uses [18]). It needs a per-day activity fact per user.
- **Chapter-1 completion.** Users who reach the free chapter's paywall END ÷ users who started chapter 1. Y9 defines
  `chapter_completed` of a free chapter as "the runs that reached its paywall" (STORIES-PLAN.md:288-289).
- **Paywall conversion.** Users with a paid order ÷ users who reached a paywall. The stages in between are the order
  states `created → checkout → paid` (`0001_init.sql:45`).
- **Payer share.** Payers ÷ active users in a window (daily, 30-day or cohort; sources mix these, see [20]).
- **ARPU / ARPPU.** Net revenue ÷ users / ÷ payers in a window. **LTV** is cumulative net revenue per cohort user at
  D30, D90 or D180.
- **CAC/CPI.** Spend ÷ new users. In a TMA the "install" is a first Mini App start (a `users` row insert).
- **Referral K.** Invites sent per user × invite→newcomer conversion. K > 1 means self-sustaining growth; the inviter's
  reward is granted at chapter-1 completion (M23).

**Benchmarks found** (all genres unless stated):

| Metric | Value | Sample / method | Date | Label | Src |
|---|---|---|---|---|---|
| Mobile D1, top 25 % | just above 30 %; top 10 % ≈ 40 % | GameAnalytics, 16,262 games ≥ 1,000 MAU, iOS+Android | 2025 data, pub. 2026-06-04 | MEASURED (vendor dataset) | [17] |
| Mobile D7 | median just under 4 %; top 25 % 6-7 %; top 10 % 11-12 % | same | same | MEASURED | [17] |
| Mobile D30 | median 0.69-0.79 %; top 25 % ≈ 1.6-1.8 %; top 1 % 13-15 % | same | same | MEASURED | [17] |
| Mobile D1, top 25 % (iOS / Android) | 31-33 % / 25-27 % | GameAnalytics, 11,600 apps, classic retention | 2024 data, pub. 2025-02-17 | MEASURED | [18] |
| Mobile D28 | 75 % of titles below 3 % | same | 2024 | MEASURED | [18] |
| Genre note | puzzle, board, card and casino retain best mid- and long-term; numbers only in charts | same | 2024 | MEASURED (qualitative) | [18] |
| Interactive story retention | "notoriously low" (Deconstructor of Fun, cited by Udonis) | none | 2023 | CLAIMED | [34] |
| First purchase ≤ 30 d after install | casino 4.95 % (repeat 3.01 %); non-gaming 9.84 %; casual and midcore % not given | AppsFlyer State of App Monetization 2026: $900 M IAP, Jan 2025-Mar 2026 (via GameDev Reports) | pub. 2026-06-25 | MEASURED (vendor dataset, secondary) | [19] |
| D90 IAP ARPPU | casual $7.26; midcore $9.80; casino $11.40 | same | same | MEASURED (secondary) | [19] |
| Share of gaming IAP revenue from paid installs | 59 % (casual 61 %) | same | same | MEASURED (secondary) | [19] |
| Daily payer conversion | top 15 % of games 0.8-1.2 %; RPG ≈ 3 % | GameAnalytics, 75 k games | 2018-2019 (old) | MEASURED, outdated | [20] |
| Payer conversion / ARPPU | "no published benchmark worth quoting" (Game Growth Advisor, Aug 2026) | — | 2026 | CLAIMED | [20] |
| Choices (interactive story #2) | lifetime iOS: 32.7 M downloads, $175.4 M revenue ≈ **$5.36 gross per download** (ANALYSIS) | GameRefinery data via Udonis | 2023-12-19 | CLAIMED (secondary) | [34] |
| Stars buyers (US) | 37.8 % of Stars-only buyers also spend on games outside Telegram; n = 2,171 buyers | YipitData US e-receipt panel, Apple/Google-billed only | 2025-08 to 2026-08 | MEASURED (panel, narrow) | [36] |

**Telegram Mini App benchmarks:** none found. No public D1/D7, payer share or ARPPU exists for TMA games, from AdsGram,
TON, PlayDeck or Telegram. The closest items:
- AdsGram's CEO and TON Society write that up to 80 % of "users" in the big tap-to-earn games may be bot farms (CLAIMED,
  2025-04-04) [35].
- AdsGram claims video ad CTR "up to 15 %" (CLAIMED) [31].

The owner's research already notes that the large TMA games (Hamster, Notcoin, Catizen) retained players through a
token and are not comparables (`Стек новеллы в Telegram Mini Apps.md:49`).

### 2. Stars money

**What a buyer pays:**

| Route | Price | Per Star | Date | Label | Src |
|---|---|---|---|---|---|
| iOS App Store, US | 100 Stars $1.99; 500 $9.99; 1,000 $19.99; 2,500 $50.90 | ≈ $0.020 | read 2026-10-31 | DOCUMENTED (store listing) | [5] |
| iOS App Store, Russia | 100 Stars 209 ₽; 150 319 ₽; 250 529 ₽; 500 1,060 ₽ | ≈ 2.1 ₽ | read 2026-10-31 | DOCUMENTED (store listing) | [6] |
| Telegram base sell rate | $14.10 per 1,000 (`stars_usd_sell_rate_x1000` default 1410) | $0.0141 | config default | DOCUMENTED | [2] |
| Fragment | 50 → 0.75; 100 → 1.50; 1,000 → 15 (unlabelled column, likely USD), payable in TON/GRAM/USDT/USDC | ≈ $0.015 | read 2026-10-31 | DOCUMENTED (page; currency inferred) | [7] |
| In-app (AdsGram reading) | ≈ $1.99 per 100 in iOS/Android; $0.0141 outside the stores | — | 2026-10-08 | CLAIMED | [8] |
| Russia, routes | App Store ≈ 2.5-3 ₽/Star, Google Play ≈ 2-2.5 ₽, reseller bots ≈ 1.5-2 ₽; **Mir cards not accepted by the app stores**; store purchase needs a foreign account and card | — | 2026-07-09 | CLAIMED (promotional article for a reseller) | [9] |

Official ways to acquire Stars: "standard Apple and Google in-app purchases or via @PremiumBot" (DOCUMENTED) [4].
Fragment is not mentioned on that page; Fragment's own page sells Stars for crypto [7].

**What the developer receives:**
- Cash: **$0.013 per Star** (Terms §6.2.4 [1]; `stars_usd_withdraw_rate_x1000` default 1300 [2]). Paid in Toncoin
  through Fragment; withdrawal requires the owner's 2FA password [3]. The minimum withdrawable balance is
  `stars_revenue_withdrawal_min` = 1,000 Stars and the maximum per withdrawal 25,000,000 [2] (DOCUMENTED as config
  defaults; live values may differ). AdsGram adds that the rate is "now called Gram" (CLAIMED) [8].
- Hold: Stars "may not become available for advertising credits or rewards for up to 21 days after their receipt"
  [1]. Validity: Stars earned are valid 3 years [1].
- **Ad credit: "each Star in your balance is worth 0.02 USD in advertising credit"** [1]. Telegram's API docs call this
  "a special rate with a 30% discount" [3]. So 1,000 Stars = $20 of Telegram Ads against $13 in cash, 54 % more (the
  arithmetic is also in [8]). The answer to "can ad spend be paid in Stars?" is **yes, DOCUMENTED** [1][3]. Area 02 has
  the Telegram Ads detail.
- Fees: 0 % commission by default. A non-refundable 15 % applies while "topics in private chats" are enabled (§6.2.6)
  [1]. Paid broadcasts above 30 messages per second cost 0.1 Star per message (§6.2.5) [1]. Refunds via
  `refundStarPayment` carry "no penalty" (§6.2.1) [1]; Telegram may debit the balance for user refunds [1].

**Effect of Apple and Google fees** (ANALYSIS). The store fee is charged to Telegram, not to the bot; the developer
always receives $0.013 per Star. It still decides what the buyer pays:
- iOS US: $1.99 per 100 Stars. Apple's small-business rate is 15 % [10]; Telegram is far above the $1 M threshold, so
  the standard rate applies to it. Developer's share = $1.30 / $1.99 = **65 %**.
- Google Play: above $1 M of annual revenue the fee is 30 % in the "remaining markets". In the US, EEA and UK it is
  20 % plus a 5 % billing fee for new installs from 2026-06-30 [11].
- Fragment / base rate: $1.30 / $1.41 = 92 %.
- Comparison: the 2025 TON Society / AdsGram example said "100 Stars cost the user $2.4, developer withdraws $1.3"
  (CLAIMED) [35]; the US App Store price is $1.99 today [5].

**Real revenue of a chapter priced at N Stars:**

| N (Stars) | Buyer pays, iOS US ($0.0199/Star) | Buyer pays, RU App Store (2.09 ₽/Star) | Developer, cash ($0.013) | Developer, as Telegram Ads credit ($0.02) |
|---|---|---|---|---|
| 1 (placeholder) | $0.02 | 2 ₽ | $0.013 | $0.02 |
| 25 | $0.50 | 52 ₽ | $0.33 | $0.50 |
| 50 | $1.00 | 105 ₽ | $0.65 | $1.00 |
| 100 | $1.99 | 209 ₽ | $1.30 | $2.00 |
| 150 | $2.99 | 314 ₽ | $1.95 | $3.00 |
| 250 | $5.09 (pack) | 529 ₽ (pack) | $3.25 | $5.00 |

A buyer usually holds more Stars than one chapter needs, because the packs start at 100 Stars on iOS [5][6]. The
leftover balance is spent elsewhere, so the developer earns only what is spent in the bot. Before withdrawal the
developer also pays TON network and exchange costs; those were not researched (a gap).

### 3. Analytics tooling for a TMA

**Telegram-provided:**
- **Mini Apps: none described.** The webapps doc covers debugging, not analytics [13].
- **Bot profile monthly users.** Telegram staff (2025-04-24): "The specified bot doesn't currently have enough active
  users for this value to be displayed within the app" [16]. The threshold is not disclosed.
- **Stars revenue.** `payments.getStarsRevenueStats` (MTProto, bot owner) returns a revenue graph plus current,
  withdrawable and total earned Stars (DOCUMENTED) [3]. It is reached from the owner's Telegram client, not from the
  Bot API.
- **Store featuring.** "Successful bots which enable a main Mini App and accept payments in Telegram Stars may be
  featured in the Telegram Mini App Store" [13]. No analytics requirement is stated.

**TON Foundation "Telegram Analytics" SDK** (`@telegram-apps/analytics`, MIT):
- Needs an access token from TON Builders, and must be initialised before the app renders [14].
- "Tracks app launches and TON Connect interactions." The data is used "to rank applications in the catalog based on
  their performance and Streaks" [14]. Which catalog is not named; presumably the TON-ecosystem Apps Center.
- The docs list the events `app-init`, `app-hide` and `custom-event`, plus TON Connect events. This list comes from a
  search snippet of docs.ton.org (marked "work in progress"); the page itself returned 404 when fetched [15], so it is
  CLAIMED. The payload fields (user id, platform, `start_param`) were not documented in anything read.
- No source found says Telegram's Mini App Store or the Apps Center requires it.
- Privacy (INTERPRETATION): the SDK sends user activity to a third party. That conflicts with STORIES-PLAN Y16 ("no
  third-party analytics", `docs/STORIES-PLAN.md:388-391`) and adds a cross-border transfer question under Q21 / 152-FZ.

**Self-hosted, privacy-oriented web analytics** (fit noted; not needed for the server-side funnel):
- **Umami.** MIT; PostgreSQL ≥ 12.14; "No cookies" [40].
- **Plausible CE.** AGPL-3.0, tracker MIT; PostgreSQL + ClickHouse; funnels are not available in CE [41].

Both are page-view tools built around a script on the client. The product's facts (user, chapter, order) already live in
its own PostgreSQL, so a script adds bytes (principle 4) and a second copy of personal data. Fit is low (ANALYSIS).

**What the project's own data already gives** (current tree plus STORIES-PLAN; `0003_stats.sql` is planned, not yet in
this tree, which has only `server/migrations/0001_init.sql`):

| Needed metric | Source in the project | Status |
|---|---|---|
| New users per day (the "install" denominator) | `users.created_at` (`0001_init.sql:7`) | exists |
| Language split (RU / EN rollout) | `users.language_code` (`:6`) | exists (client-reported language) |
| Chapter-1 started / completed (= paywall reached) | `stat_events` `chapter_started` / `chapter_completed` (Y8-Y9, STORIES-PLAN.md:256-292) | planned |
| Endings, replays, puzzles | `ending_reached`, `puzzle_ended` (Y9) | planned |
| Paywall CTA → invoice → checkout → paid → refunded | `orders.status` + `created_at` / `checkout_at` / `paid_at`; `payments.refunded_at` (`0001_init.sql:12-49`) | exists |
| Payer share, ARPPU, revenue per cohort | `payments` joined to `users.created_at` | exists (computable by query) |
| Hint spend | `hint_ledger` (cited as a precedent in Y11) | exists per the plan's references |
| **D1/D7/D30 retention** | `users.last_seen_at` is overwritten; `chapter_started` is not recorded on resumes (Y9 steps 3-4) | **missing** |
| **Campaign attribution** | M11 reads `start_param` from verified initData (design/choices, not merged); no `start_param` in this tree (grep) | **missing** |
| **Paywall shown / dismissed** | `chapter_completed` approximates "reached"; seen-and-closed is not recorded | partial |
| **Share sent / share-link launches** | M14 (design draft) | missing |
| **Invites sent → newcomer conversion (K)** | M10-M11 friend requests + newcomer flag (design draft) | missing |

### 4. Soft-launch practice

**Closed beta environments:**
- **Telegram test environment** (DOCUMENTED [13][4]):
  - "Completely separate from the main environment"; it needs a new user account and a new bot from the test-server
    @BotFather.
  - Bot API calls use `https://api.telegram.org/bot<token>/test/METHOD_NAME`, and HTTP links without TLS are allowed.
  - "You can freely test payments in Telegram Stars by connecting your bot to Telegram's dedicated test environment."
  - Logging in is documented for iOS, Desktop and macOS through hidden debug menus. Android steps are absent from the
    doc.
  - Fit (ANALYSIS): good for QA of payments; not a player beta, because testers must create test accounts.
- **Production bot beta.** The real bot, not yet submitted for featuring [13], entered through `startapp` links that
  carry a cohort code. A cohort code shares the 1-64 `[A-Za-z0-9_-]` `start_param` space with the planned invite codes
  `f<code>` (research_M2.md:28-31, CLAIMED / community envelope). Staging by language can read `users.language_code`.
- No Telegram mechanism for staged rollout (a percentage or a country) was found.

**KPI gates before paid scale** (no story-game-specific thresholds found; general F2P, practitioner, CLAIMED):
- Game Growth Advisor (2025-12-16, updated 2026-08-01) [22], all Android:
  - Gates: stop-and-fix below 25 % D1; stop scaling below 8 % D7 and below 3 % D30. Its D1 median is ≈ 22 % and its
    casual/puzzle peer band is 28-32 %.
  - Scale rule: if CPI rises less than 30 % when spend triples, go; more than 50 %, kill. Plan for CPI at 30-70 % of
    projected LTV (LTV:CPI ≈ 1.4-3.3×).
  - Its conversion floor "is unverified and removed".
- Its sample-size rule is about 896 installs to read D1 near 30 % to ±3 points at 95 % confidence. That matches the
  normal approximation 1.96² × 0.3 × 0.7 / 0.03² = 896 (ANALYSIS).
- The GameAnalytics medians [17][18] sit far below these gates. The gates describe "good enough to scale", not
  "typical".

**Duration and budget** (CLAIMED [22]):
- A lean soft launch is 4 weeks in one market with one ad set (total $11,000-23,000). A full one is 12 weeks in two
  markets ($62,000-110,000).
- Creative waves are 6-10 variants at about $150-350 per variant. A minimum of about $300-500 per day per ad set is
  needed for platform learning; that applies to app-store networks, not to Telegram Ads.
- Matej Lancaric's "Soft Launch Bible" (2025-04-22) is paywalled; only its outline was visible [42].

**Sample sizes at small budgets** (ANALYSIS; standard two-proportion test, α = 0.05 two-sided, power 80 %; the method
matches the Evan Miller calculator inputs [39]; its example is 10.2 % baseline with +3 points absolute = 2,545 per
variation):
- **Paywall conversion 5 % → 7.5 %** (relative +50 %): ≈ 1,470 paywall viewers per arm. At 40 % chapter-1 completion
  that is ≈ 3,700 starts per arm and ≈ 7,400 starts for the test.
- **Paywall conversion 5 % → 6 %** (+20 %): ≈ 8,150 viewers per arm, ≈ 20,000 starts per arm.
- **Ad creative CTR 1.0 % → 1.5 %**: ≈ 7,750 impressions per arm. Cheap at a €0.6-1 CPM (≈ €5-8 per arm), but CTR is
  not the outcome that matters. Testing a creative on cost per start or per payer multiplies the sample by the downstream
  funnel.
- Short-video hook tests (TikTok, Reels, Shorts): no sourced methodology for story apps was found (gap). Area 04 covers
  those channels.

**Price testing of chapters in Stars:**
- Telegram: the Stars terms and the payments page read contain no rule on price testing or regional pricing [1][4].
  Prices are set per invoice in XTR, the same for every client.
- Russia: art. 426 §2 GK RF (edition 2026-06-10): "the price … must be the same for consumers of the corresponding
  category" [38]. A business that sells to "everyone who applies" is a public-contract party (§1).
  - INTERPRETATION, not legal advice: a randomised per-user price for the same chapter may conflict with §2.
  - Sequential tests (everyone sees price A for a period, then price B) or different products would avoid per-user
    differences. A lawyer item.
- EU: the 2019/2161 amendment requires disclosure when a price is personalised by automated decision-making (seen in a
  search snippet only). The eur-lex fetch failed, so this is NOT VERIFIED and a gap.
- Ethics note: a refund-on-request policy for paid chapters already exists in the payment design (refunds supported,
  principle 2). A price test that charges some users more raises refund and complaint risk; no source quantifies it.

### 5. Budget tiers and break-even

**Cost inputs found** (detail in "Channel rows"):
- **Telegram Ads, Russia** (CLAIMED):
  - Average CPM €1.64 (Jan 2026) → €0.97 (Aug 2026); CPC €0.33 → €0.12, broad themes (SA Media and agencies via
    ppc.world) [26].
  - Minimum CPM for channels, bots and search: €1 → €0.15 on 2026-08-26/27 [27][28], then €0.15 → €0.75 on
    2026-08-28. Country or language targeting moved €0.70 → €0.60 [29].
  - eLama (data as of 2026-09-01): €0.6 by theme or audience, €0.75 for specific channels, bots and search; image
    €0.9, video €1.02. The typical market is €0.5-5 [30].
  - Reseller minimum budgets: €500 at most resellers, €250 through MTS Ads, €100 through MegaFon. Commission ≥ 20 %
    plus 22 % VAT [30].
- **Telegram channel posts, Russia** (CLAIMED):
  - CPM 2,412-4,175 ₽ in the three non-game channels eLama sampled (WOWBLOGGER, 2026-09-01) [30].
  - AdsGram: mass entertainment from $1 CPM ("≈ 90-100 ₽"); Telega.in minimum CPM 900 ₽; micro channels (1-5 k
    subscribers) 500-1,200 ₽ per post (2026-01-26) [31].
- **AdsGram and other TMA ad networks**: CPM from 2 USDT, minimum budget $100 (AdsGram blog, CLAIMED) [31].
- **VK Ads** (CLAIMED):
  - Average CPC 10-50 ₽, up to 100 ₽ in mass niches in central regions; minimum top-up 600 ₽ (2025-01-22) [32].
  - Case: an MMO on RuStore got 35 k installs in 2 months at a $3.8 CPI with men-only targeting (2026-02-16) [25].
- **App-store CPI references** (Adjust Gaming App Insights 2026, via secondary pages, CLAIMED):
  - Global CPI $0.56 (+30 % year on year), North America $1.68, Europe $0.53 [23][24].
  - Puzzle about iOS $3 / Android $2 (Business of Apps via FoxData, no year) [23].
  - Rafinad: Telegram CPM is 30-50 % lower than traditional networks in some gaming verticals (CLAIMED) [24].
- **TikTok**: CPM $13.26 for 2025 (Triple Whale, e-commerce brands; no app or game category) [33]. A poor fit as a
  benchmark; area 04 covers this channel.

**From CPM to cost per Mini App start** (ANALYSIS; the CTR and click→start rates are ASSUMPTIONS):
cost per start = CPM ÷ (1,000 × CTR × click→start).
- Telegram Ads, Aug 2026 average CPC €0.12 [26] ÷ 70 % click→start (ASSUMPTION) ≈ **€0.17 per start**. With a 20 %
  reseller commission and 22 % VAT [30]: ≈ **€0.25**.
- Telegram Ads at a €3 CPM, 0.7 % CTR and 60 % click→start (ASSUMPTIONS) ≈ €0.71 per start.
- Channel post at a 900-2,400 ₽ CPM with 1 % view→start (ASSUMPTION) ≈ **90-240 ₽ per start**, about $0.9-2.6 at
  AdsGram's "$1 ≈ 90-100 ₽" (ASSUMPTION).
- AdsGram at a $2 CPM, 2 % CTR and 60 % click→start (ASSUMPTIONS) ≈ $0.17 per start. Bot-farm traffic risk [35]
  applies.
- VK Ads at a 10-50 ₽ CPC with 30-60 % click→Mini App start (ASSUMPTION; the click leaves VK for Telegram) ≈ 17-167 ₽
  per start.
- (€ ≈ $1.1-1.2 is assumed, not looked up.)

**Worked break-even.** Revenue per start = completion × paywall conversion × chapters per payer × price (Stars) ×
net $/Star. Hints and refunds are excluded.

| Input | Low | **Base** | High | Source / label |
|---|---|---|---|---|
| Chapter-1 completion (start → paywall reached) | 25 % | **40 %** | 55 % | ASSUMPTION (no benchmark found) |
| Paywall → purchase (≥ 1 chapter) | 2 % | **5 %** | 10 % | ASSUMPTION. Context: AppsFlyer casino 30-day first purchase 4.95 % of installs [19]; this is of paywall viewers, a narrower base |
| Chapters bought per payer (lifetime, all stories) | 1.5 | **3** | 5 | ASSUMPTION |
| Price per chapter | 50 Stars | **100 Stars** | 150 Stars | ASSUMPTION (owner value Q3; placeholder 1 Star) |
| Net per Star | $0.013 | **$0.013** | $0.02 (as ad credit) | DOCUMENTED [1][2] |
| **Revenue per start = break-even cost per start** | **$0.0049** | **$0.078** | **$0.54** | ANALYSIS |
| Revenue per payer | $0.98 | $3.90 | $15.00 | ANALYSIS. Cross-check: AppsFlyer casual D90 ARPPU $7.26 [19]; Choices ≈ $5.36 gross lifetime per download [34] |

**One-at-a-time sensitivity** (from base $0.078):

| Change | Result |
|---|---|
| completion 25 % / 55 % | $0.049 / $0.107 |
| paywall conversion 2 % / 10 % | $0.031 / $0.156 |
| chapters per payer 1.5 / 5 | $0.039 / $0.130 |
| price 50 / 150 Stars | $0.039 / $0.117 |
| Stars recycled as ad credit ($0.02) | $0.120 |

Against cost per start:
- At ≈ €0.25 per start (Telegram Ads through a reseller), break-even needs about 3× the base revenue per start. One
  example: 55 % completion, 10 % conversion, 3 chapters at 100 Stars, $0.013 → $0.21. That is still below €0.25.
- Channel posts at 90-240 ₽ per start need the high case or better.
- Organic, referral and featured traffic has no direct cost per start. That is where base-case economics are positive.

**What each budget tier buys** (ANALYSIS on the cost inputs above):

| Tier | Per month | Starts bought (€0.17-0.71/start, Telegram Ads) | Revenue at base $0.078/start | What it can measure |
|---|---|---|---|---|
| Zero (organic) | $0 (time only) | 0 paid. Channels are own channel/bot, sharing and invites (M10-M14), featuring after Stars are live [13], the owner's networks | — | Funnel shape on small n. D1 to ±3 points needs ≈ 900 starts [22] |
| Small | $300-1,000 | ≈ 400-6,000. Above the €100-500 reseller minimums [30] | ≈ $30-470 | D1/D7 and chapter-1 completion of one cohort; one paywall test only if ≥ ≈ 7,400 starts (§4) — borderline |
| Medium | $3,000-10,000 | ≈ 4,000-60,000 | ≈ $300-4,700 | Several significant paywall or creative tests; per-channel CAC vs D30 LTV; enough to apply the LTV:CPI ≥ 1.4× gate [22] |

## Channel rows (for the synthesis table)

| Channel | Cost (with currency, date, label) | Effort | Fit for a Russian-first romance VN for girls in a TMA | Evidence quality | Notes |
|---|---|---|---|---|---|
| Telegram Ads (Russia, via reseller) | CPM average €0.97, CPC €0.12 (Aug 2026, CLAIMED [26]); minimum CPM €0.6-0.75 (Sep 2026, CLAIMED [30]); ≈ €0.17-0.71 per start (ANALYSIS); reseller minimum €100-500 + ≥ 20 % commission + 22 % VAT [30] | Medium (creatives, reseller account) | High: lands inside Telegram, one tap to the bot; payable with earned Stars at $0.02 [1] | B | Minimums changed twice in Aug 2026 [28][29]; geo-targeting distorted by VPNs [26]; area 02 has detail |
| Telegram Ads paid with earned Stars | 1 Star = $0.02 credit vs $0.013 cash [1]; "30 % discount" [3] (DOCUMENTED) | Low | High once revenue exists | A | Recycling revenue into ads raises effective net per Star by 54 % |
| Telegram channel posts (посевы) | CPM 2,412-4,175 ₽ in sampled non-game channels (Sep 2026, CLAIMED [30]); Telega.in minimum 900 ₽ CPM; micro-channel post 500-1,200 ₽ (Jan 2026, CLAIMED [31]); ≈ 90-240 ₽ per start (ANALYSIS) | High (channel selection, fraud checks) | High if the channels are romance/fandom/girls' channels; no channel-level data found for that niche | C | No cost-per-start benchmark found; area 02 |
| AdsGram-type TMA ad networks | CPM from 2 USDT, minimum $100 (Jan 2026, CLAIMED [31]) | Low-medium | Medium: reaches TMA users, but the audience skews toward tap-to-earn games; bot-farm risk [35] | C | The CTR "up to 15 %" is a vendor claim [31] |
| VK Ads | CPC 10-50 ₽ average (Jan 2025, CLAIMED [32]); game case CPI $3.8 for an app-store MMO (Feb 2026, CLAIMED [25]) | Medium | Medium-high for a Russian female audience (VK is a Russian network); every click must leave VK for Telegram, so an extra drop-off | C | No TMA-landing case found; area 04 |
| TikTok / Reels / Shorts paid | CPM $13.26 (2025, e-commerce sample, CLAIMED [33]); no app/story data | Medium-high (video creatives) | Unclear for Russia (platform availability not checked here; area 04); plausible for EN | C | No story-app CPI found (gap) |
| App-store CPI (reference only) | Global $0.56, NA $1.68, EU $0.53 (Adjust 2026 via secondary, CLAIMED [23][24]) | — | Not a channel for a TMA; a yardstick | B (secondary) | Shows paid TMA starts at ≈ €0.2-0.7 are in the same band as app-store installs |
| Organic / referral / featuring | $0 cash; featuring requires a main Mini App + Stars [13] | Medium (features M10-M14, content) | High | A (featuring rule documented) | Referral grant at chapter-1 completion (M23) ties K to the same funnel step |

## Applicability to tg-app-novel (feature asks, listed not designed)
1. **Retention fact.** D1/D7/D30 cannot be computed today. `users.last_seen_at` keeps only the last launch
   (`0001_init.sql:8`), and Y9's `chapter_started` skips resumes. Ask: a per-user, per-day activity record written at
   `POST /api/auth`. It is new personal-data processing, so the Y16 / Q23 retention rules apply.
2. **Campaign attribution.** Persist the first-launch `start_param` from verified initData (M11's mechanism) per user,
   with a campaign namespace separate from invite codes `f<code>`. Without this no channel CAC can be computed.
   - Constraint: one `start_param` per link (1-64 chars, research_M2.md:28-31), so a campaign code and an invite code
     cannot both ride one link unless encoded together.
3. **Paywall events.** Y9's `chapter_completed` of a free chapter equals "paywall reached". `orders.created_at` marks
   the buy-tap. "Paywall shown and closed without tapping" is unrecorded. Ask: decide whether "reached" + "order
   created" is enough. If not, add a `paywall_shown` / `paywall_dismissed` kind to the closed Y9 vocabulary.
4. **Share and invite counters (K-factor).** M14's server-side `savePreparedInlineMessage` call is a natural "share
   prepared" fact. Launches with `f<code>` that create newcomers (M11) are the conversions. Ask: keep both countable per
   inviter and per day.
5. **Cohort revenue query.** Payer share, ARPPU and D30 LTV come from `payments` × `users.created_at` with
   `refunded_at` subtracted. Ask: a read-only admin report, no new table.
6. **Stars reconciliation.** Withdrawable balance and hold status live only in the owner's client
   (`payments.getStarsRevenueStats`, MTProto) [3]. The server's `payments` table is gross. Ask: a monthly manual
   reconciliation step in the ops runbook.
7. **Price as data.** Prices come from `server/catalog.json` per order (`0001_init.sql:31`). Sequential price tests are
   possible without code changes. Per-user randomised prices would need a new mechanism and legal clearance (§4).
8. **Third-party analytics SDK.** The TON SDK conflicts with Y16 and principle 4. It is needed only if the owner wants
   TON Apps Center ranking [14] (owner question below).

## Pitfalls / what goes wrong (sourced)
- **Benchmarks are not gates.** GameAnalytics medians (D7 just under 4 %) [17] sit far below practitioner scale gates
  (D7 ≥ 8 %) [22]. Mixing them up either scales a weak product or kills a normal one.
- **Payer metrics are not comparable across sources.** Daily, monthly and cohort windows differ "by an order of
  magnitude" [20]. Always state the window.
- **TMA user counts are inflated.** Up to 80 % bot farms in the big TMA games (CLAIMED) [35]. Cheap TMA-network traffic
  needs fraud checks; count starts by verified initData users who reach line 1, not by clicks.
- **Ad-price minimums move without notice.** Russia's minimum CPM went €1 → €0.15 → €0.75 within three days of August
  2026 [28][29]. Re-read the cabinet before every budget.
- **Russian buyer friction.** Mir cards are not accepted by the app stores (CLAIMED) [9]. Buyers fall back to reseller
  bots outside Telegram's documented routes [4]. Paywall conversion in Russia may sit below EN markets; no measurement
  found.
- **Stars cash is delayed and discrete.** Up to 21 days on hold [1], 1,000-Star minimum withdrawal [2], paid in TON. At
  small scale the money is not usable for weeks. Ad credit is usable earlier only within the same hold rule [1].
- **The 15 % topics fee** silently cuts revenue if "topics in private chats" is enabled [1].
- **Shrinking Russian reach.** Mediascope: 94 M → 76 M monthly (Mar → Jun 2026; CLAIMED) [26]. The FAS has said
  liability for Telegram ads will not apply until the end of 2026 (CLAIMED via ppc.world) [26]. The 2027 regime is
  unknown.

## Key claims for verification
1. Developer receives $0.013 per Star; Stars are worth $0.02 as ad credit; hold up to 21 days. Bot Developer Terms
   §6.2.3-6.2.4, https://telegram.org/tos/bot-developers. DOCUMENTED.
2. Config defaults: `stars_usd_withdraw_rate_x1000` = 1300, `stars_usd_sell_rate_x1000` = 1410,
   `stars_revenue_withdrawal_min` = 1000, `stars_revenue_withdrawal_max` = 25,000,000.
   https://core.telegram.org/api/config. DOCUMENTED (defaults; live values unverified).
3. Ad purchase with Stars "at a special rate with a 30% discount". https://core.telegram.org/api/stars. DOCUMENTED.
4. US App Store: 100 Telegram Stars $1.99, 1,000 $19.99.
   https://apps.apple.com/us/app/telegram-messenger/id686449807. DOCUMENTED (listing, 2026-10-31).
5. RU App Store: 100 Telegram Stars 209 ₽.
   https://apps.apple.com/ru/app/telegram-messenger/id686449807. DOCUMENTED (listing, 2026-10-31).
6. Fragment sells 100 Stars for 1.50 (currency column unlabelled). https://fragment.com/stars/buy. DOCUMENTED; the
   currency is inferred.
7. GameAnalytics 2026: D7 median just under 4 %; D30 median 0.69-0.79 %; 16,262 games.
   https://gamedevreports.substack.com/p/gameanalytics-mobile-and-pc-game. MEASURED (secondary summary).
8. AppsFlyer 2026: casual D90 IAP ARPPU $7.26; casino 30-day first purchase 4.95 %.
   https://gamedevreports.substack.com/p/appsflyer-app-monetization-in-2026. MEASURED (secondary).
9. Telegram Ads Russia: average CPM €0.97 and CPC €0.12 in Aug 2026.
   https://ppc.world/articles/reklama-v-telegram-v-2026-godu-benchmarki-i-stoit-li-zapuskat-kampanii-seychas/. CLAIMED.
10. Russian minimum CPM for channels/bots/search raised €0.15 → €0.75 on 2026-08-28.
    https://ppc.world/news/telegram-ads-snova-izmenil-minimalnyy-cpm-pri-targetinge-na-kanaly-boty-i-poisk-uvelichil-v-5-raz/.
    CLAIMED.
11. Reseller minimum budgets €500 / MTS Ads €250 / MegaFon €100; commission ≥ 20 % plus 22 % VAT.
    https://elama.ru/blog/skolko-stoit-reklama-v-telegram/. CLAIMED.
12. Stars payments testable in the test environment. https://core.telegram.org/bots/payments-stars. DOCUMENTED.
13. TON Analytics SDK data used "to rank applications in the catalog".
    https://github.com/telegram-mini-apps-dev/analytics. DOCUMENTED (vendor README).
14. Art. 426 §2 GK RF: the price must be the same for consumers of the corresponding category (edition 2026-06-10).
    https://pravo.ppt.ru/kodeks/gk/st-426. DOCUMENTED (law text via an aggregator; re-check on consultant.ru).
15. Bot MAU shown only above an undisclosed threshold. https://bugs.telegram.org/c/50050/5. DOCUMENTED (staff
    reply).

## Gaps (asked but no reliable source found)
- **No D1/D7/D30, chapter completion or paywall-conversion benchmark** for TMA games, for interactive-story or romance
  mobile games, or for free-first-chapter models. GameAnalytics genre charts were not readable as text [18]. Sensor
  Tower, GameRefinery and Liftoff genre tables are gated. An academic study of a 10 M-player interactive-story game
  surfaced in search, but its page had no content [X-MOL, not cited].
- **The Romance Club / "Клуб Романтики" funnel.** This is the closest Russian-language comparable. Downloads and
  audience figures appeared only in search snippets and were not opened, because the search budget ran out.
- **Google Play Stars prices** by region; the Russian Google Play price.
- **Telegram Ads A/B tooling, and story-app creative testing practice** (TikTok, Reels, Shorts) with sample sizes.
- **TON network and exchange costs** of turning the Fragment payout into fiat.
- **The EU personalised-price disclosure** (Directive 2019/2161, art. 6(1)(ea) CRD): the eur-lex fetch failed.
- **The live payload of the TON Analytics SDK** and its `docs.ton.org` pages (404 when fetched) [15].
- **Telegram Ads CTR and click→start rates** for bot/Mini App landings; every conversion step in §5 is an ASSUMPTION.
- **Adjust Gaming App Insights 2026 primary page** (HTTP 429); its figures are used only through secondary pages
  [23][24].

## Owner value questions this area raises (each with a default reading)
1. **Chapter price (Q3).** It drives the break-even linearly. Default reading: model 50-150 Stars per chapter
   ($0.65-1.95 net). The placeholder of 1 Star makes paid traffic unrecoverable at any conversion.
2. **Recycle Stars revenue into Telegram Ads?** It values each Star at $0.02 instead of $0.013. Default: yes, for any
   Telegram Ads spend, once revenue exists. Keep the cash route for running costs.
3. **Soft-launch budget tier.** Default: zero or organic until a first cohort clears the scale gates (≈ 900 starts for
   D1 ±3 points). Then the small tier for D7 and paywall measurement; the medium tier only after LTV:CPI ≥ 1.4×.
4. **Price experiments in Russia.** Default: no per-user randomised prices; sequential price periods only, after a
   lawyer reviews art. 426.
5. **TON Analytics SDK for Apps Center ranking.** Default: not used (Y16: no third-party analytics). Revisit if TON
   Apps Center placement becomes a channel.
6. **Daily activity tracking for retention.** It is new personal-data processing. Default: record a minimal (user, day)
   fact under the Y16 / Q23 retention decision, after the lawyer item.
7. **Paid-traffic markets.** Default: RU and EN cohorts measured separately (`language_code`). EN paid tests only after
   RU organic shows the funnel works, since Russian reach is falling [26].

## Sources
[1] https://telegram.org/tos/bot-developers - Telegram Bot Developer Terms, §6.2.1-6.2.7; read 2026-10-31; primary
contract.
[2] https://core.telegram.org/api/config - client configuration defaults for Stars withdraw, sell and min/max; read
2026-10-31; primary.
[3] https://core.telegram.org/api/stars - Stars API: withdrawals via Fragment, ads at a 30 % discount, revenue stats,
affiliate programs; read 2026-10-31; primary.
[4] https://core.telegram.org/bots/payments-stars - Bot payments for digital goods: purchase routes, test environment,
refunds, display rule; read 2026-10-31; primary.
[5] https://apps.apple.com/us/app/telegram-messenger/id686449807 - US App Store listing, IAP prices; read 2026-10-31;
primary price list.
[6] https://apps.apple.com/ru/app/telegram-messenger/id686449807 - RU App Store listing, IAP prices in ₽; read
2026-10-31; primary price list.
[7] https://fragment.com/stars/buy - Fragment Stars packages; read 2026-10-31; primary (Telegram's platform), currency
column unlabelled.
[8] https://adsgram.ai/blog/adsgram/telegram-stars-explained-price-in-usd-how-to-earn-and-withdraw- - AdsGram, Stars
prices and withdrawal; published 2026-10-08; vendor (CLAIMED).
[9] https://vc.ru/telegram/3020395-kak-kupit-zvezdy-telegram-v-rossii - buying Stars in Russia; published 2026-07-09;
promotional article (CLAIMED).
[10] https://developer.apple.com/app-store/small-business-program/ - Apple Small Business Program, 15 % ≤ $1 M; read
2026-10-31; primary.
[11] https://support.google.com/googleplay/android-developer/answer/112622 - Google Play service fees, incl. the
2026-06-30 changes; read 2026-10-31; primary.
[12] https://core.telegram.org/bots/api-changelog - Bot API changelog to 10.3 (2026-08-24); read 2026-10-31; primary.
[13] https://core.telegram.org/bots/webapps - Mini Apps doc: featuring condition, `startapp`, test environment; read
2026-10-31; primary.
[14] https://github.com/telegram-mini-apps-dev/analytics - Telegram Analytics SDK README (MIT, TON Builders token,
catalog ranking); read 2026-10-31; vendor primary.
[15] https://docs.ton.org/ecosystem/tma/analytics/supported-events - supported events; seen as a search snippet only,
404 on fetch 2026-10-31; CLAIMED.
[16] https://bugs.telegram.org/c/50050/5 - Telegram bug tracker, staff answer on bot MAU display; 2025-04-24; primary
(staff).
[17] https://gamedevreports.substack.com/p/gameanalytics-mobile-and-pc-game - GameAnalytics 2026 benchmarks summary
(16,262 games, 2025 data); published 2026-06-04; secondary summary of a measured dataset.
[18] https://gamedevreports.substack.com/p/gameanalytics-mobile-gaming-benchmarks - GameAnalytics 2025 benchmarks
summary (11,600 apps, 2024 data); published 2025-02-17; secondary.
[19] https://gamedevreports.substack.com/p/appsflyer-app-monetization-in-2026 - AppsFlyer State of App Monetization 2026
summary; published 2026-06-25; secondary of a measured dataset.
[20] https://blog.playio.co/arppu-mobile-games - Playio, ARPPU and payer-conversion compilation with cited sources;
published 2026-10-26; CLAIMED compilation.
[21] https://gamedevreports.substack.com/p/liftoff-and-singular-casual-games - Liftoff/Singular casual report 2025
summary (CPI by genre, CTR); published 2025-05-08; secondary.
[22] https://gamegrowthadvisor.com/blog/2025-12-16-mobile-soft-launch-complete-guide/ - soft-launch guide, gates,
budgets, sample size; published 2025-12-16, updated 2026-08-01; practitioner (CLAIMED).
[23] https://foxdata.com/ru/blogs/2026-mobile-game-user-acquisition-cost-benchmarks-how-much-should-you-spend/ - CPI
benchmarks citing Adjust 2026 and Business of Apps; published 2026-04-24; vendor (CLAIMED).
[24] https://www.sostav.ru/publication/transformatsiya-igrovogo-trafika-v-2026-godu-i-novye-modeli-privlecheniya-auditorii-84399.html
- game traffic in 2026, Adjust CPI, Rafinad Telegram CPM note; published 2026-06-05; trade press (CLAIMED).
[25] https://adindex.ru/case/2026/02/16/342460.phtml - Black Wind × VK Ads case, CPI $3.8; published 2026-02-16; case
PR (CLAIMED).
[26] https://ppc.world/articles/reklama-v-telegram-v-2026-godu-benchmarki-i-stoit-li-zapuskat-kampanii-seychas/ -
Telegram ads 2026 benchmarks, Mediascope reach, FAS note; published 2026-09-15; trade press with agency data
(CLAIMED).
[27] https://kod.ru/telegram-ads-cpm-sng - Telegram Ads minimum CPM change (Magnetto.pro); published 2026-08-26; trade
press (CLAIMED).
[28] https://ppc.world/news/telegram-ads-snizil-minimalnyy-cpm-v-sem-raz/ - minimum CPM €1 → €0.15 in Russia;
published 2026-08-27; trade press (CLAIMED).
[29] https://ppc.world/news/telegram-ads-snova-izmenil-minimalnyy-cpm-pri-targetinge-na-kanaly-boty-i-poisk-uvelichil-v-5-raz/
- minimum CPM €0.15 → €0.75; published 2026-08-28; trade press (CLAIMED).
[30] https://elama.ru/blog/skolko-stoit-reklama-v-telegram/ - eLama, Telegram ad costs, channel-post table, reseller
minimums; published 2026-09-14 (data 2026-09-01); reseller (CLAIMED).
[31] https://adsgram.ai/blog/adsgram/skolko-stoit-reklama-v-telegram - AdsGram, Telegram ad prices and AdsGram CPM;
published 2026-01-26; vendor (CLAIMED).
[32] https://ppc.world/articles/skolko-stoit-reklama-v-vk-i-ot-chego-zavisit-cena/ - VK Ads costs; published
2025-01-22; trade press (CLAIMED).
[33] https://influee.co/blog/tiktok-ads-benchmarks - TikTok benchmarks from Triple Whale 2025 data; published
2026-07-22; vendor (CLAIMED).
[34] https://www.blog.udonis.co/mobile-marketing/mobile-games/choices-stories-you-play-monetization - Choices
monetization with GameRefinery figures; published 2023-12-19; agency blog (CLAIMED).
[35] https://wnhub.io/news/monetization/item-47503 - TON Society / AdsGram article on TMA monetization; published
2025-04-04; vendor-authored (CLAIMED).
[36] https://ask.yipitdata.com/insights/telegram-stars-buyers-gaming-spend - YipitData US e-receipt panel on Stars
buyers; published 2026-08-21; measured panel (narrow).
[37] https://ads.telegram.org/getting-started - Telegram Ads getting started (TON, 0.1 TON minimum CPM, channels ≥ 1,000
subscribers); read 2026-10-31; primary but apparently not updated for 2026 reseller pricing.
[38] https://pravo.ppt.ru/kodeks/gk/st-426 - Civil Code RF art. 426, edition 2026-06-10; law text via an aggregator
(INTERPRETATION applied).
[39] https://www.evanmiller.org/ab-testing/sample-size.html - A/B sample-size calculator (example: 2,545 per
variation); read 2026-10-31; widely used reference.
[40] https://github.com/umami-software/umami - Umami README; read 2026-10-31; primary.
[41] https://github.com/plausible/analytics - Plausible CE README; read 2026-10-31; primary.
[42] https://lancaric.substack.com/p/the-soft-launch-bible-full-2025-blueprint - Soft Launch Bible (paywalled
preview); published 2025-04-22; practitioner.
[43] Repo: `server/migrations/0001_init.sql` (users, payments, orders, entitlements); `docs/STORIES-PLAN.md` Y8-Y16
(lines 256-399); owner's stack research `Стек новеллы в Telegram Mini Apps.md:39-49`.
[44] Prior research: `D:/tmp/novel-orch/design/choices/research_M2.md:28-31,81-93` (`start_param` envelope) and
`research_M4.md:131-154` (Affiliate Programs).
