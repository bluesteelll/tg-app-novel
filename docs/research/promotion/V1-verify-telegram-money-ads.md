# Verification V1 (adversarial, pass A): Telegram money, ads and funnel numbers in reports 01, 02, 07
Date 2026-10-31. Pages re-opened in this pass: about 60 distinct pages (66 WebFetch calls); web searches: 8.
Freshness: Bot API changelog top entry is **Bot API 10.3 (2026-08-24)**, and no 2026 entry mentions Stars rates,
affiliates, withdrawals or Telegram Ads. The Telegram blog index's latest post is 2026-08-25, and none of its last 8
posts change Stars or Ads terms. The Bot Developer Terms page shows no revision date. fas.gov.ru/news/34584 refused
the connection again (ECONNREFUSED).

Method: I re-opened every cited URL behind a numbered key claim, plus the TL;DR numbers the plan rests on. Each was
checked for the number, the date, the region and the label. A few searches looked for newer or contradicting data,
and I recomputed the 07 arithmetic by hand. **Verdicts: CONFIRMED 49 · CORRECTED 8 · MISLABELLED 2 · UNSUPPORTED 2 ·
STALE 1** (44 numbered claims + 18 extra TL;DR/body checks; extra rows are prefixed X).

## Verdict table

| # | Report:claim | Claim (short) | Verdict | Evidence (URL, what it says, date) | Fix for synthesis |
|---|---|---|---|---|---|
| 1 | 01:1 | Featuring needs a Main Mini App + Stars; media and design guidelines improve the chances | CONFIRMED | core.telegram.org/bots/webapps (read 2026-10-31): "Successful bots which enable a main Mini App and accept payments in Telegram Stars may be featured"; recommends "high-quality media" and "following our design guidelines". ToS §8.2.1: "at its sole discretion". | None |
| 2 | 01:2 | Apps tab shows Main Mini Apps "for users who have launched them" | CONFIRMED | Same page, verbatim. | None |
| 3 | 01:3 | `bot_preview_medias_max` = 12 per localization | CONFIRMED | core.telegram.org/api/config: default 12; description "Maximum number of main mini app previews that can be added for a localization". | Keep "documented default" |
| 4 | 01:4 | Attachment menu only for major advertisers | CONFIRMED | bots/webapps: "currently only available for major advertisers on the Telegram Ad Platform" (all bots in the test environment). | None |
| 5 | 01:5 | Affiliate commission bounds 1-800 ‰ | CONFIRMED | api/config: `starref_min_commission_permille` 1, `starref_max_commission_permille` 800 ("Minimum/Maximum allowed permille affiliate commission"). These are defaults; the live value was not observed. | Keep "default, live unobserved" |
| 6 | 01:6 | `starref_start_param_prefixes` = `["_tgr_"]` | CONFIRMED | api/config default. | None |
| 7 | 01:7 | Commission and duration can only be raised; `0` ends the program in ~24 h | CONFIRMED | core.telegram.org/api/bots/referrals: "Both the duration and the commission may only be raised after creation"; passing 0 ends it "around 24 hours after"; `STARREF_AWAITING_END`. | None |
| 8 | 01:8 | `AffiliateInfo` only on `invoice_payment`/`paid_media_payment`; `amount` and `nanostar_amount` can be negative on refunds | CONFIRMED | core.telegram.org/bots/api (10.3): the affiliate field's second sentence names exactly those two types; `amount` "can be negative for refunds"; `nanostar_amount` from -999999999 to 999999999. `subscription_period` exists on TransactionPartnerUser, for invoice_payment only. | None |
| 9 | 01:9 | Developer gets $0.013/Star, hold up to 21 days, ads credit $0.02/Star | CONFIRMED | telegram.org/tos/bot-developers: §6.2.3 "each Star in your balance is worth 0.02 USD in advertising credit", only "for that specific TPA", and "this value may fluctuate". §6.2.4 "an equivalent of 0.013 USD worth of rewards for each Telegram Star", processed by Fragment, Stars may be unavailable "for up to 21 days". §6.2.7: valid 3 years. | Add "the ads credit applies only to that specific TPA and may fluctuate (§6.2.3)" |
| 10 | 01:10 (+01 C2 table) | Buyer base rate "$1.41 per 1000 Stars" | **CORRECTED** | api/config: `stars_usd_sell_rate_x1000` 1410 = "the number of US dollars required to buy one thousand Telegram Stars". 01's own $0.0141/Star × 1,000 = **$14.10 per 1,000** ($1.41 per **100**). 01 slipped by 10×. AdsGram (2026-10-08) also says "$14.10 per 1,000". The live fragment.com/stars/buy page (2026-10-31) shows **1.50 per 100 / 15 per 1,000** in the first, unlabelled column, and a second unlabelled column of 1.2661 per 100 / 12.66 per 1,000. | Use "$14.10 per 1,000 (documented default)", and "Fragment page 15 per 1,000, currency unlabelled". Do not equate the default with the live Fragment price |
| 11 | 01:11 | Durov: 15,000 programs, 4 M users in 12 days (2024-12-17) | CONFIRMED | finance.mail.ru (TASS, 2024-12-17): "15 000 партнерских программ … 4 миллиона пользователей получили ссылки на мини-приложения". The CLAIMED label is right. | None |
| 12 | 01:12 | tapps.center lists 29 crypto apps | CONFIRMED | tapps.center (2026-10-31): 29 listings; categories are Wallets, Swap & DeFi, Stablecoins & Payments, NFT, Naming, Explorers, Dev Infra, Official; banner "Something new is coming"; no games category. | None |
| 13 | 01:13 | findmini promo $200 in TON/USDT per week | CONFIRMED | findmini.app (2026-10-31): "Pay $200 in TON or USDT" for one week. Also on the page: "Traffic sales" at $0.01-0.15 per user, and **TMA MAU 102.7 M** (see X17). | None |
| 14 | 01:14 | Telegram "largely inaccessible" in Russia by 2026-03-17 | CONFIRMED (press claim); newer data exists | meduza.io (2026-03-17): "largely inaccessible across Russia since the weekend". The evidence is complaint counts (6,000 → 12,000), not a measurement. Newer: Mediascope via checkroi.ru (2026-10-18) gives Telegram monthly reach of 94.3 M (Mar), **88 M (Apr)** and 75.7 M (Jun, 12+). Daily reach was 72.2 M (Mar), **35.4 M (Jun)** and **33.8 M (Aug)**. Wikipedia's article stops at 2026-03-17. No source found for the status in Oct 2026. | Replace "situation after March unknown" with the Mediascope series: the monthly audience is still about 76 M, but the daily audience has halved |
| 15 | 02:1 | Ad text 160 characters including spaces; no line breaks | CONFIRMED | ads.telegram.org/guidelines §1 "maximum length of the ad text is 160 characters including spaces"; §2 bans "Line breaks, bullet points, numbering lists". Also confirmed: "dating services" is listed under §5.1; the gambling rule is real-money only; there is no minors rule. | None |
| 16 | 02:2 | Minimum CPM 0.1 Toncoin; channels with 1000+ subscribers; targeting immutable | CONFIRMED | ads.telegram.org/getting-started: "The minimum CPM for a sponsored message is 0.1 Toncoin", "public channels with 1000+ subscribers", targeting "can't be changed". No minimum deposit is stated. The landing page now says ads are paid "with Gram". | Write "0.1 Toncoin (= Gram after the 2026-06-15 rename)". No page states "0.1 Gram" except a third-party glossary |
| 17 | 02:3 | Stars ads "special rate with a 30% discount" | CONFIRMED | core.telegram.org/api/stars, verbatim; transactions typed `starsTransactionPeerAds`. | None |
| 18 | 02:4 | Premium users do not see the ads | CONFIRMED | telegram.org/faq_premium: "These advertisements will be hidden for users that subscribe to Telegram Premium." The page does not say whether this covers search ads and ads in bots. | Add "scope for search/bot ads not stated" |
| 19 | 02:5 | Russia minimum CPM €0.15 → €0.75 (channels/bots/search); country/language €0.70 → €0.60 | CONFIRMED (CLAIMED source) | ppc.world news, 2026-08-28 15:52: "для России"; values verbatim, plus "Politics and incidents" €0.35 → €0.30. Its sources are the eLama Telegram channel and "Telegram Ads: Новинки"; no effective date is given. The earlier ppc.world item (2026-08-27) has €1 → €0.15, and kod.ru (2026-08-26, Magnetto) gives the same Russia value plus CIS base €0.15 / political €0.10. | Note: the €0.75 is Russia-only (see X14) |
| 20 | 02:6 | Reseller entry: MTS €250, MegaFon €100, most €500; fee "от 20%" + 22% VAT | CONFIRMED | elama.ru blog (2026-09-14, data as of 2026-09-01), verbatim. Worked example €1,000 + €200 + €264 VAT = €1,464. Some niches carry 30% commission. There is a 10% first-payment promo "до 30 ноября". | None |
| 21 | 02:7 | Gram-cabinet ads not shown in RU, UA, IL, PS, DE | CONFIRMED (single CLAIMED source) | deksis.ru (2025-12-21, no author), verbatim. The same page says Stars-cabinet ads "увидят жители России" and that the Stars cabinet cannot advertise "чат-боты". The page predates the 2026 changes. telegramadsarchive.com/info/ton-ads does not address Russia. | Keep CLAIMED and single-source; verify in a cabinet |
| 22 | 02:8 | Search ads: channels and bots only; no `start`, invite or post links (2025-04-08) | CONFIRMED | elama.ru (2025-04-08): "Рекламировать можно только Telegram-каналы и боты"; "пока нельзя использовать … параметр start"; up to 10 keywords of 4-32 characters; minimum bid €1 at the time. | None |
| 23 | 02:9 | SA Media CPM €1.64 → €0.97, CPC €0.33 → €0.12 (Jan → Aug 2026); Mediascope 94 M → 76 M | CONFIRMED, with an ambiguity | ppc.world (2026-09-15): "Средний CPM при таргетинге на широкие тематики упал почти на 41%". The same page also calls €0.97 a "минимальный порог" and gives €0.30 for news/politics. There is no sample or method. Mediascope is cross-checked: Sostav/RBC (2026-04-09) gives March **94.3 M** (12+); Vedomosti via checkroi gives June **75.7 M** (12+). SA Media blames the blocks **and** the summer seasonality. | Say "broad-topic average, wording ambiguous", and quote both causes. Mediascope is a measurement panel, so "MEASURED (panel, via press)" would be fairer than CLAIMED |
| 24 | 02:10 | FAS 2026-03-25: no liability for Telegram/YouTube ads until end-2026 | CONFIRMED (secondary ×3; primary unreachable) | ppc.world (2026-03-25 10:16): "переходный период до конца 2026 года … меры ответственности … применяться не будут". The same is in novayagazeta.eu (2026-03-25) and elama.ru/blog/zapret-reklamy-v-telegram (2026-06-02). Per eLama: the basis is 38-FZ art. 5 part 10.7 (in force since 2025-09-01); the ban is not lifted; advertiser and distributor are both liable; marking is still required. No extension past 2026-12-31 was found (search 2026-10-31). INTERPRETATION, not legal advice. | Keep as is. Mark the primary as unreachable, and add "no extension found as of 2026-10-31" |
| 25 | 02:11 | Suggested Posts: owner paid 24 h after posting; full refund if removed earlier | CONFIRMED | telegram.org/blog/checklists-suggested-posts (2025-07-01), verbatim. Apple-bought Stars are refundable within 21 days, so Toncoin is recommended. | None |
| 26 | 02:12 | RichAds floors: push CPC $0.015, interstitial CPM $1.50, video CPM $3, deposit $150 | CONFIRMED | richads.com/telegram_ads (undated): verbatim; embedded CPM $0.04; "70+ mln users". | None |
| 27 | 02:13 | TADS audience EN 56.06 / Persian 16.97 / RU 15.41 %; CPC from $0.01, CPM from $1 | CONFIRMED | tads.me/advertiser: verbatim; Tier-3 29.35 %; $50 test; CTR 10.5 % "last month" (undated). | None |
| 28 | 02:14 | AdsGram: "users watch ads to earn bonuses"; CPM only; USD₮ since 2024-09-23 | CONFIRMED (the quote is a paraphrase) | docs.adsgram.ai/advertiser: "When users are about to receive a bonus in Telegram mini-apps, they watch ads to get it"; "there is only a CPM strategy"; switched to USD₮ on 2024-09-23 (5.7 USD₮/TON). No minimum budget is stated in the doc. | Quote the doc's wording |
| 29 | 02:15 | EUR cabinet has no demographics; gender/age only via MTS BigData | CONFIRMED | habr.com/ru/articles/1020174 ("7 апр", year not on the page): "Telegram принципиально не собирает пол и возраст"; reseller table matches 02. | None |
| 30 | 07:1 | $0.013 cash, $0.02 ad credit, 21-day hold | CONFIRMED | ToS §6.2.3-6.2.4 (see #9). | Same fix as #9 |
| 31 | 07:2 | Config defaults 1300 / 1410 / 1,000 / 25,000,000 | CONFIRMED | api/config: all four defaults verbatim, with descriptions. Units are inferred: "x1000" values read as $13.00 / $14.10 per 1,000 Stars, which matches ToS $0.013. | Keep "defaults; live values unverified" |
| 32 | 07:3 | Ads paid with Stars "30% discount" | CONFIRMED | api/stars (see #17). Consistency check: $0.0141 ÷ (1 − 0.30) = $0.0201 ≈ the ToS $0.02 credit. | None |
| 33 | 07:4 | US App Store: 100 Stars $1.99, 1,000 $19.99 | CONFIRMED | apps.apple.com/us/…id686449807 (2026-10-31): 100 $1.99; 250 $5.09; 500 $9.99; 750 $14.99; 1,000 $19.99; 1,500 $29.99; 2,500 $50.90. | None |
| 34 | 07:5 | RU App Store: 100 Stars 209 ₽ | CONFIRMED | apps.apple.com/ru/… (2026-10-31): 100 209 ₽; 150 319 ₽; 250 529 ₽; 500 1,060 ₽. | None |
| 35 | 07:6 | Fragment 100 Stars for 1.50, currency unlabelled | CONFIRMED | fragment.com/stars/buy (2026-10-31): 100 → 1.50 and a **second unlabelled column 1.2661**; the 50-Star minimum pack is 0.75 / 0.6330. Payment in GRAM, TON, USDT, USDC. | Mention both columns; the currency of each is unknown |
| 36 | 07:7 | GameAnalytics: D7 median just under 4 %, D30 median 0.69-0.79 %, 16,262 games | CONFIRMED | gamedevreports (2026-06-04): verbatim; 2025 data. | None |
| 37 | 07:8 | AppsFlyer: casual D90 ARPPU $7.26; casino 4.95 % first purchase | CONFIRMED | gamedevreports (2026-06-25): $900 M IAP, Jan 2025-Mar 2026; verbatim. Nuance: casual "61 %" of revenue from paid installs refers to all payments, not IAP alone. | Minor wording on the 61 % |
| 38 | 07:9 | Aug 2026 average CPM €0.97, CPC €0.12 | CONFIRMED, ambiguous | See #23. Other claimed figures: spilnoagency (Ukraine, 2026-08-28) gives an "average market CPM ≈ €0.49" for June 2026 with no source or method; eLama gives "0.5-5 €" as the 2026 range. | Present it as a range of claims, not a single average |
| 39 | 07:10 | Russia minimum CPM €0.15 → €0.75 on 2026-08-28 | CONFIRMED | See #19. | None |
| 40 | 07:11 | Reseller minimums €500 / €250 / €100; ≥ 20 % + 22 % VAT | CONFIRMED | See #20. | None |
| 41 | 07:12 | Stars payments testable in the test environment | CONFIRMED | core.telegram.org/bots/payments-stars: "You can freely test payments in Telegram Stars by connecting your bot to Telegram's dedicated test environment." | None |
| 42 | 07:13 | TON Analytics SDK data used "to rank applications in the catalog" | CONFIRMED | github.com/telegram-mini-apps-dev/analytics: "used solely for to rank applications in the catalog based on their performance and Streaks"; tracks launches and TON Connect. No statement that it is required. | None |
| 43 | 07:14 | GK RF art. 426 §2: the price must be the same per consumer category (edition 2026-06-10) | CONFIRMED | pravo.ppt.ru/kodeks/gk/st-426: verbatim; "Действующая редакция от 10 июня 2026". consultant.ru not re-checked. INTERPRETATION, not legal advice. | Keep the "re-check on consultant.ru" note |
| 44 | 07:15 | Bot MAU shown only above an undisclosed threshold | CONFIRMED | bugs.telegram.org/c/50050/5 (staff, 2025-04-24): "doesn't currently have enough active users for this value to be displayed". No number given. | None |
| X1 | 01 TL;DR + C2 | In-app ~$0.02/Star is CLAIMED (AdsGram); official per-platform prices are a gap | **MISLABELLED** | The App Store listings are primary price lists (#33, #34): US $1.99/100, RU 209 ₽/100, read 2026-10-31. Google Play is still a gap. | DOCUMENTED (store listing, iOS US/RU); remove from 01's gaps |
| X2 | 01 C2 | Ads credit usable only for the channel/bot that earned it: CLAIMED (AdsGram) | **MISLABELLED** | ToS §6.2.3: Stars can be used to place ads "for that specific TPA"; api/stars: "for channels/bots they own … Stars currently available on the bot/channel's balance". | DOCUMENTED |
| X3 | 01 C (gap) | Whether the affiliate commission comes from the developer's share is "not stated" | **CORRECTED** | telegram.org/blog/affiliate-programs-ai-sticker-search (2024-12-04): developers specify "what percent of their future revenue they are willing to share". Bot API: "for each 1000 Telegram Stars received by the bot". The tour page is silent. | DOCUMENTED (blog): the commission comes out of the developer's revenue. ANALYSIS: at N ‰ the net from a referred buyer is about $0.013 × (1 − N/1000) per Star |
| X4 | 01 C2 / 02 §1 | Toncoin renamed Gram (01: "unverified"; 02: on 2026-06-15) | CONFIRMED | Exchange and data-vendor notices (KuCoin "completed the rename", Kaiko notice 2026-06-12) give 2026-06-15 12:00 UTC, after a community vote. AdsGram says it was "announced" on 2026-06-01. Chain still TON. Search results only (CLAIMED, consistent). | 2026-06-15 effective |
| X5 | 02 Gaps | The $0.02 credit and the 21-day hold "rest on one third-party source; core.telegram.org gives no values" | **CORRECTED** | Both are in the ToS (#9). The hold applies to "advertising credits or rewards". | DOCUMENTED (ToS §6.2.3-6.2.4); drop this gap |
| X6 | 07 TL;DR + §2 | Developer keeps "about 92 % of the Fragment price" | **CORRECTED** | 92 % = $1.30 / $1.41, which is the *config default* sell rate. The live Fragment page shows 1.50 per 100 (#35), so if USD the share is $1.30 / $1.50 = **≈ 87 %**. | Write "92 % of the documented default rate; ≈ 87 % of the Fragment page price if its first column is USD" |
| X7 | 07 §5 break-even, High column | High case $0.54 per start; net per Star listed as "$0.02 (as ad credit)" | **CORRECTED** | 0.55 × 0.10 × 5 × 150 × $0.02 = **$0.825**. $0.54 is the same funnel at $0.013 ($0.536). Revenue per payer "High $15.00" does use $0.02; at $0.013 it is $9.75. | Give two High values: $0.54 cash / $0.83 ad credit per start; $9.75 / $15.00 per payer |
| X8 | 07 §5 tier table | Small tier "≈ 400-6,000 starts", medium "≈ 4,000-60,000" | **CORRECTED** | The table's lower bound is the pre-fee €0.17 and ignores $→€. A reseller is needed for Russian targeting (the Gram cabinet is reportedly not shown in RU, #21), so all-in cost per start is €0.25-1.04 (€0.71 × 1.464). At €≈$1.1-1.2: Small ≈ **250-3,600** starts; Medium ≈ **2,400-36,000**. | Small cannot reach the 7,400-start paywall test ("cannot", not "borderline") |
| X9 | 07 §1 table | YipitData: 37.8 % of Stars-only buyers, n = 2,171 | **CORRECTED** | ask.yipitdata.com (2026-08-21): 37.8 % is of **1,817 Stars-only buyers**. 2,171 is all Stars buyers, of whom 354 also had Premium. Period 2025-08-18 to 2026-08-18; US e-receipts, Apple/Google only. | n = 1,817 |
| X10 | 07 §5 cost per start | Channel post 900-2,400 ₽ CPM → 90-240 ₽ per start | **CORRECTED** | eLama's sampled channel-post CPMs are 2,412 / 2,662 / 4,175 ₽ (2026-09-01). The cited range stops at the sample's minimum. With the report's own 1 % view→start: 90-**418** ₽ per start. | 90-420 ₽ (≈ $0.9-4.6 at 90-100 ₽/$, the report's assumption) |
| X11 | 07 §5 App-store CPI | Adjust 2026: Europe CPI $0.53 [23][24] | UNSUPPORTED (by [24]) | sostav.ru (2026-06-05) gives global $0.56 (+30 %) and NA $1.68 (+31 %), but for Europe only "+47 %", with no dollar figure. foxdata [23] not re-opened. | Cite $0.53 to [23] only, or drop it |
| X12 | 07 §4 method | The sample-size method "matches the Evan Miller calculator inputs (10.2 % + 3 points = 2,545)" | UNSUPPORTED | The static evanmiller.org page shows 10.2 %, "10.2%-13.2%", 2,545, with α/power values not visible. The standard formula at α 0.05 / power 0.8 gives ≈ 1,660-1,800 for 10.2 → 13.2 %, not 2,545. 07's own figures are correct (see the arithmetic check). | Drop the "matches Evan Miller" sentence; state the formula used |
| X13 | 02 §2 / 07 §2 | Mediascope 94 → 76 M labelled CLAIMED | CONFIRMED (label note) | Two independent press chains (#23). Further points: April 88 M; daily reach 72.2 → 35.4 → 33.8 M (Mar → Jun → Aug); Max at 86.3 M passed Telegram in June (search results). | Prefer "MEASURED (Mediascope panel), via press", and add the daily series |
| X14 | 02 §2 / 07 §5 | Minimum CPM changes "for Russia" | CONFIRMED + scope note | kod.ru (2026-08-26): the €0.15 base applies to CIS countries other than Russia, €0.10 for political. spilnoagency (2026-08-28, CLAIMED): €1 → €0.15 for Target Channels/Bots/Search in standard EUR cabinets via a Ukrainian reseller; Target Users stays €0.20; TON cabinets unchanged. The €0.75 reversal is reported for Russia only. | For EN or non-RU tests the channel/bot floor may be €0.15 (CLAIMED); verify in the cabinet |
| X15 | 02 §2 | Fines 200,000-500,000 RUB per violation (legal entities) | CONFIRMED + addition | habr 1020174: that range is for marking (ERID) violations. Advertising on *restricted-access resources* is a separate offence: eLama (2026-06-02, CLAIMED) gives art. 14.3 fines of 20-80k (individuals), 80-300k (officials, sole traders) and **500k-3 M RUB (legal entities)**. | Do not merge the two fine ranges |
| X16 | 02 TL;DR / §2 | Cost per channel subscriber: Telegram Ads €0.3-1.2, paid posts €4-10; beauty & fashion 90-240 ₽ (posts), €1.75-2.50 (Ads) | CONFIRMED | fedotovseo.ru (2026-04-25), telegue.com (2026-06-18; the agency's own seeding in 19 niches, "ориентировочные"), telegram-ads.com (**2026-10-03**, updated 2026-10-06; agency + "open benchmarks", no n). The sources conflict: telegue's paid-post cost per subscriber of 50-240 ₽ (≈ €0.5-2.6) is 2-8× below fedotovseo's €4-10. | Present paid-post cost per subscriber as a range spanning both sources |
| X17 | 02 §4 | TMA MAU "stabilised at 150-190 M by mid-2025" (PropellerAds citing Findminiapp) | STALE | findmini.app itself shows **TMA MAU 102.7 M** (+4.6 % in 30 days) and bots MAU 330.3 M (observed 2026-10-31; vendor, method undisclosed). | Use 102.7 M (findmini, 2026-10-31, CLAIMED) as the current figure |
| X18 | 07 §5 inputs | AdsGram "CPM from 2 USDT, minimum $100"; video CTR "up to 15 %" | CONFIRMED | adsgram.ai blog (2026-01-26): "Минимальный бюджет — $100, CPM от 2 USDT"; video CTR "достигает 15%", range 2.5-15 %. Also confirmed: Telega.in minimum CPM 900 ₽; micro channels (1-5 k subscribers) 500-1,200 ₽ per post. | None |

Other spot checks, all CONFIRMED and not counted separately:
- Game Growth Advisor: 896 installs for D1 ±3 points; gates D1 < 25 %, D7 < 8 %, D30 < 3 %; CPI at 30-70 % of LTV;
  lean $11-23 k; full $62-110 k; $300-500/day per ad set. Published 2025-12-16, updated 2026-08-01.
- VK Ads (ppc.world, 2025-01-22): CPC 10-50 ₽, up to 100 ₽; 600 ₽ minimum top-up.
- Choices: 32.7 M downloads and $175.4 M, iOS only, from GameRefinery via Udonis (2023-12-19).
- The 80 % bot-farm figure (wnhub, 2025-04-04): unattributed, no evidence, written by TON Society and AdsGram
  staff. "100 Stars cost $2.4" appears as an in-game IAP example.
- Telemetr survey: 56 % men / 44 % women, under 14 2 %, 15-20 13 %. No n, no method, and the population is not
  stated as Russian-speaking.
- tgadsspy Stars-cabinet guide (published 2026-04-22, updated 2026-09-24): ~1,000 Stars entry and ~25,000 test are
  practitioner figures. It does **not** say whether Stars-cabinet ads show in Russia.
- payments-stars: users acquire Stars "using standard Apple and Google in-app purchases or via @PremiumBot".
  Fragment is not mentioned there, but the Telegram blog of 2025-07-01 names Fragment and @PremiumBot for bulk
  Stars.

## Cross-report contradictions

1. **02 vs 01/07 on the Stars ad credit.** 02's Gaps say the $0.02 rate and the 21-day hold come from one
   third-party guide. 01 and 07 correctly cite ToS §6.2.3-6.2.4, which states both. Use 01/07 (X5).
2. **01 vs 07 on what a buyer pays.**
   - 01 labels the in-app price CLAIMED and lists official prices as a gap. 07 read the App Store listings. Use 07
     (X1).
   - 01 writes the base rate as "$1.41 per 1000"; 07 has $14.10 per 1,000. 07 is right (#10).
   - 07's "92 % of the Fragment price" mixes the config default with the Fragment page (X6).
3. **01 vs 02 on the payout coin.** 01: Gram rename "unverified". 02: 2026-06-15. Exchange notices support
   2026-06-15 (X4).
4. **07's cost per start vs 02's cost per subscriber.**
   - 07 builds €0.17 (net) / €0.25 (all-in) per start from CPC €0.12 and an assumed **70 % click→start**.
   - 02's only related rate is telegram-ads.com's recommended target of "**from 30 %**" click→subscribe for an
     author channel. At 30 %, cost per start is €0.40 net / **€0.59 all-in**.
   - 02's observed Telegram Ads cost per channel subscriber is €0.3-1.2 overall. For fashion & beauty, the closest
     women-skewed niche, it is **€1.75-2.50**. The subscriber is the nearest observed analogue of a one-tap Mini App
     start (ANALYSIS).
   - So 07's per-start cost sits at or below the bottom of 02's observed range.
5. **02 vs 07 on the €0.97.** Both call it an average. The source calls it the broad-topic average in one sentence
   and a "минимальный порог" in another. Another agency claims a €0.49 June average (X14, #38).
6. **02 vs 07 on why reach fell.** 02 says "after the spring restrictions". 07 and the source say blocks **plus**
   seasonality. The Mediascope daily series (−51 % Mar → Jun) is not in either report (X13).
7. **02 internal: paid-post cost per subscriber.** fedotovseo's €4-10 against telegue's 50-240 ₽ is a 2-8×
   disagreement between two agency sources (X16).
8. **02 §1 internal.** deksis says Stars-cabinet ads show in Russia; 02 cites [10] tgadsspy beside it, but that page
   is silent on Russia. So "shown in Russia" rests on deksis alone.

## Arithmetic check (07 §4-§5, recomputed)

| Item | Report | Recomputed | Verdict |
|---|---|---|---|
| Base revenue per start: 0.40 × 0.05 × 3 × 100 × $0.013 | $0.078 | 6 Stars × $0.013 = $0.078 | OK |
| Low: 0.25 × 0.02 × 1.5 × 50 × $0.013 | $0.0049 | 0.375 Stars × $0.013 = $0.004875 | OK |
| High: 0.55 × 0.10 × 5 × 150 × (column says $0.02) | $0.54 | $0.825 at $0.02; $0.536 at $0.013 | **Inconsistent** (X7) |
| Revenue per payer, low / base / high | $0.98 / $3.90 / $15.00 | $0.975 / $3.90 / $15.00 at $0.02 ($9.75 at $0.013) | High mixes rates |
| Sensitivity rows (completion, conversion, chapters, price, $0.02) | 0.049/0.107, 0.031/0.156, 0.039/0.130, 0.039/0.117, 0.120 | Same | OK |
| Cost per start: €0.12 ÷ 0.70 | €0.17 | €0.171 | OK |
| All-in (× 1.20 × 1.22) | €0.25 | €0.251 | OK |
| €3 CPM, 0.7 % CTR, 60 % | €0.71 | €0.714 net (€1.05 all-in, not stated) | OK, add all-in |
| Channel post | 90-240 ₽ | 90-418 ₽ with eLama's full sample | Range clipped (X10) |
| AdsGram $2 CPM, 2 % CTR, 60 % | $0.17 | $0.167 | OK |
| VK 10-50 ₽ CPC ÷ 0.3-0.6 | 17-167 ₽ | 16.7-166.7 ₽ | OK |
| "€0.25 needs about 3× base" | ~3× | €0.25 ≈ $0.28-0.30 (report's €≈$1.1-1.2) → **3.5-3.8×** | Understated |
| High-ish example 0.55 × 0.10 × 3 × 100 × $0.013 | $0.21 | $0.2145 | OK |
| Paywall test 5 % → 7.5 %, α 0.05 two-sided, power 0.8 (pooled formula) | ≈ 1,470/arm, ≈ 3,700 starts/arm, ≈ 7,400 total | 1,471 → 3,676 → 7,353 | OK |
| 5 % → 6 % | ≈ 8,150/arm, ≈ 20,000 starts/arm | 8,158 → 20,394 | OK |
| CTR 1.0 % → 1.5 % | ≈ 7,750 impressions/arm; €5-8 per arm | 7,750; €4.65-7.75 at €0.6-1 CPM | OK |
| D1 ±3 points: 1.96² × 0.3 × 0.7 / 0.03² | 896 | 896.4 | OK |
| One two-arm paywall test at €0.25/start | €1,850 | 7,400 × €0.25 = €1,850. At the 30 % click→start of contradiction 4: 7,400 × €0.59 ≈ **€4,370** | OK as stated; sensitive |
| Tier "starts bought" | Small ≈ 400-6,000; Medium ≈ 4,000-60,000 | All-in €0.25-1.04, $→€ applied: Small ≈ 250-3,600; Medium ≈ 2,400-36,000 | **Overstated ~1.7×** (X8) |
| Chapter revenue table (1/25/50/100/150/250 Stars) | as listed | All cells reproduce (e.g. 150 × 2.09 ₽ = 313.5 ₽; 250 × $0.013 = $3.25) | OK |
| "$20 vs $13 = 54 % more"; "65 % of iOS price" | 54 %; 65 % | 20 / 13 = 1.538; 1.30 / 1.99 = 65.3 % | OK |

Net effect on the break-even conclusion:
- 07's direction holds: base-case paid acquisition loses money.
- With the corrected inputs it holds more strongly.
  - At €0.59 all-in per start (30 % click→start), only the full High case breaks even, and only if Stars are
    recycled as ad credit ($0.825 per start ≈ €0.69-0.75).
  - At the fashion & beauty cost per subscriber (€1.75-2.50) no case breaks even, including High at $0.02 credit.

## Most decision-relevant corrections

- **Buyer base rate.** It is **$14.10 per 1,000 Stars** (documented default), not "$1.41 per 1000" (01 #10). The
  live Fragment page shows 15 per 1,000 in an unlabelled column. The developer's $0.013 is ≈ 65 % of the iOS US
  price, ≈ 92 % of the default rate, and ≈ 87 % of the Fragment page price (if USD).
- **Stars ad credit and hold are DOCUMENTED** (ToS §6.2.3-6.2.4). The ToS adds two limits: the credit is usable only
  "for that specific TPA", and its $0.02 value "may fluctuate". 02's "single third-party source" gap is wrong.
- **Affiliate commission comes out of the developer's revenue.** The 2024-12-04 blog says "percent of their future
  revenue" (closes 01's gap). Defaults are 1-800 ‰, raise-only, and `0` ends a program in ~24 h.
- **07's High break-even column mixes rates.** $0.54 per start is cash ($0.013); with the ad credit the column claims
  ($0.02) it is $0.825. Revenue per payer High is $15.00 at $0.02 and $9.75 at $0.013.
- **07's cost per start is optimistic.** The 70 % click→start assumption is above the only related figure (02:
  "from 30 %" click→subscribe target). Telegram Ads cost per channel subscriber is reported at €0.3-1.2 overall and
  €1.75-2.50 for fashion & beauty, against 07's €0.25 all-in. A paywall test then costs ≈ €4,400, not €1,850.
- **The small budget tier cannot run one paywall A/B test.** Its starts are overstated by ~1.7× (pre-fee cost, no
  $→€): Small ≈ 250-3,600 starts, under the ≈ 7,400 needed.
- **Russian Telegram audience.** Mediascope numbers are confirmed by two independent press chains (Mar 94.3 M, Jun
  75.7 M, 12+). The more telling series is **daily reach: 72.2 M (Mar) → 35.4 M (Jun) → 33.8 M (Aug)**, and Max
  (86.3 M) passed Telegram in June. No source on Telegram's status in Oct 2026 was found.
- **FAS 2026-03-25 "no liability until end-2026"** is confirmed by three secondary outlets; the primary is
  unreachable. No extension was found as of 2026-10-31. The ban itself stands, and both advertiser and channel are
  liable. Fines for ads on restricted resources (art. 14.3, CLAIMED via eLama) are **500k-3 M RUB for legal
  entities**, a separate range from the 200-500k RUB ERID fines. INTERPRETATION, not legal advice.
- **The €0.75 minimum CPM is Russia-only.** Non-Russian EUR cabinets and CIS reportedly keep €0.15 for
  channels/bots/search (CLAIMED, kod.ru / spilno, 2026-08), which matters for an EN test. Cite the €0.97 Aug CPM as
  "broad-topic average, source wording ambiguous".
- **In-app Star prices are DOCUMENTED** from App Store listings (US $1.99/100; RU 209 ₽/100), so drop 01's CLAIMED
  label. Separately, `stars_purchase_blocked` ("If false, indicates that Telegram Stars may be used in the current
  region", default `true`) shows Stars availability is region-gated. Whether Russian users can buy Stars in the
  client must be checked live; nothing read says either way.

## Sources opened in this pass (read 2026-10-31)
- Telegram:
  - telegram.org/tos/bot-developers
  - core.telegram.org/api/config
  - core.telegram.org/api/stars
  - core.telegram.org/bots/webapps
  - core.telegram.org/api/bots/referrals
  - core.telegram.org/bots/api (10.3, offset 470000)
  - core.telegram.org/bots/api-changelog
  - core.telegram.org/bots/payments-stars
  - telegram.org/faq_premium
  - telegram.org/blog/checklists-suggested-posts
  - telegram.org/blog/affiliate-programs-ai-sticker-search
  - telegram.org/tour/affiliate-programs/ru?setln=en
  - telegram.org/blog (index)
  - ads.telegram.org (landing, /getting-started, /guidelines)
  - fragment.com/stars/buy
  - bugs.telegram.org/c/50050/5
- Stores: apps.apple.com/us and /ru …id686449807.
- Trade press, resellers and agencies (CLAIMED):
  - ppc.world: 2026 benchmarks; min-CPM news of 2026-08-27 and 2026-08-28; FAS news of 2026-03-25; VK Ads costs
  - elama.ru: price guide; search ads; zapret-reklamy-v-telegram
  - kod.ru/telegram-ads-cpm-sng
  - spilnoagency.com.ua
  - deksis.ru
  - habr.com/ru/articles/1020174
  - tgadsspy.com
  - telegramadsarchive.com/info/ton-ads
  - fedotovseo.ru
  - telegue.com
  - telegram-ads.com
  - novayagazeta.eu (2026-03-25)
  - sostav.ru (2026-04-09; 2026-06-05)
  - checkroi.ru (2026-10-18)
  - meduza.io (2026-03-17)
  - en.wikipedia.org/wiki/Blocking_of_Telegram_in_Russia
  - finance.mail.ru (TASS, 2024-12-17)
- Vendors (CLAIMED): adsgram.ai (Stars blog; prices blog); docs.adsgram.ai/advertiser; richads.com; tads.me;
  findmini.app; tapps.center; github.com/telegram-mini-apps-dev/analytics; wnhub.io; telemetr.me.
- Benchmarks:
  - gamedevreports.substack.com (GameAnalytics 2026; AppsFlyer 2026)
  - gamegrowthadvisor.com
  - blog.udonis.co
  - ask.yipitdata.com
  - evanmiller.org
- Law: pravo.ppt.ru/kodeks/gk/st-426.
- Unreachable: fas.gov.ru/news/34584 (ECONNREFUSED); techora.ru (browser check page).
- Search-result-only facts (not opened): the Gram rename notices (KuCoin, Kaiko), and Max at 86.3 M in June.
