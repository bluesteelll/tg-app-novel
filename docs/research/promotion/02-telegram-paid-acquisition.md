# Promotion research 02: Paid acquisition inside Telegram
Date 2026-10-31. Sources read: 37 opened pages (listed in Sources) plus search-result pointers marked "(pointer, not
opened)". Freshness notes: ads.telegram.org pages read 2026-10-31 (undated; the landing page now says ads are paid
in "Gram", the getting-started page still says "0.1 Toncoin"); core.telegram.org/api/stars read 2026-10-31; the
Telegram blog index read 2026-10-31 (latest post 2026-08-25); the Russian minimum-CPM changes dated 2026-08-27/28;
eLama's price guide dated 2026-09-14. The Bot API changelog was not re-read (no Bot API method is load-bearing in
this area). **The shared web-search budget ran out mid-task** (200 searches per turn across all agents), so the
items listed under Gaps were not searched. Pages I fetched directly after that point are noted as such.

## TL;DR (5-8 bullets, decision-relevant)

- **The official Telegram Ads unit is still a 160-character text with one button, linking to something inside
  Telegram** (channel, bot, account, post; websites only in some cabinets). DOCUMENTED [1][2][3]. The platform added
  **search ads** (keywords; channels and bots only; no `start` parameter, as of 2025-04-08) [14] and **ads inside
  bots** (2025-05-14) [15]. Both are CLAIMED by resellers. **Premium users never see these ads** (DOCUMENTED [5]).
  I found no first-party Telegram ad format that runs *inside* Mini Apps. That inventory belongs to third-party
  networks (AdsGram, RichAds, TADS, Monetag).
- **Three ways to pay.** (a) The self-serve **Gram (ex-TON) cabinet**: minimum CPM 0.1 Gram (DOCUMENTED [3]). You
  can target only explicit lists of channels, bots or search keywords. It is CLAIMED that its ads are **not shown to
  users in Russia** [17]. (b) The **EUR cabinet via resellers**: entry from about €100-500 plus about 20% commission
  plus 22% VAT [13][16]. Targeting there covers topics, language, geo and interests, **with no age/gender
  targeting** [16]. (c) The **Stars cabinet**: an owner can spend the Stars balance of their **own bot or channel**
  on ads for that bot or channel, "**at a special rate with a 30% discount**" (DOCUMENTED [4]). This is the one
  route where Stars revenue from chapter sales can go straight back into ads without a Fragment withdrawal.
- **Russian-targeted Telegram Ads prices (resellers, CLAIMED).** Since 2026-08-28 the minimum CPM is **€0.75** for
  channel/bot/search targeting and **€0.60** for topic/country/language targeting [12][13]. The average CPM is
  quoted at €0.5-5 [13]. SA Media's averages fell between January and August 2026: **CPM €1.64 → €0.97, CPC
  €0.33 → €0.12** [18]. Cost per *channel subscriber* is CLAIMED at €0.3-1.2 from Telegram Ads and €4-10 from paid
  posts [22]. I found **no number for games, books, romance or girls' audiences**. The closest proxy is "beauty and
  fashion": 90-240 RUB per subscriber via paid posts [21] and €1.75-2.50 via Telegram Ads [23].
- **Russian legal and market risk sits on top of every Russian-language channel here.** FAS (25 March 2026) said
  ads on resources whose access is restricted are prohibited. For Telegram and YouTube, liability "will not be
  applied" only **until the end of 2026** [19] (INTERPRETATION, not legal advice; area 06). Mediascope figures cited
  by ppc.world show the Russian monthly audience fell **from 94 M (March 2026) to 76 M (June 2026)** after the
  spring restrictions [18]. Russian-market paid acquisition inside Telegram therefore has an unknown legal status
  from 2027-01-01.
- **Mini-App ad networks sell cheap but crypto/tap-to-earn-skewed, mostly rewarded traffic.** AdsGram describes
  itself as a network "where users watch ads to earn bonuses", and its listed partners are tap/crypto games [26].
  Price floors (vendor, CLAIMED): RichAds push-style CPC from $0.015, interstitial CPM from $1.50, video CPM from $3,
  minimum deposit $150 [30]. TADS CPC from $0.01, CPM from $1, tests from $50 [31]. TADS's audience is 56% English,
  17% Persian and 15% Russian, with Tier-3 at 29% [31]. **No network publishes gender data** (Gap). No source gave a
  D1/D7 figure for incentivized TMA users.
- **Attribution is entirely ours.** The official pixel covers websites only, per a third-party summary (pointer).
  The EUR cabinet reports impressions, clicks and spend, not conversions [CLAIMED, pointer]. Telegram's search ads
  reject `start` parameters [14]. Campaign-coded `startapp` links and server-side first-touch storage (planned M11)
  are the only way to tie a Telegram Ads click to a chapter purchase. AdsGram's advertiser doc says the same [28].
- **Telegram's own native paid-post mechanism exists: "Suggested Posts"** (blog, 2025-07-01). A user offers a
  channel Stars or Toncoin to publish a post. The owner is paid 24 h after posting, and if the post is removed
  earlier the payment is auto-refunded (DOCUMENTED [7]). This is an escrowed alternative to exchanges for buying
  posts in small channels.

## Findings

### 1. Telegram Ads (official): formats, cabinets, minimums, targeting, creative and policy

**Formats and placements**
- Ad = text "limited to 160 characters including spaces" plus a button that opens the link. One optional in-text
  link (`@link`, `t.me/link`, `t.me/link/123`) must lead to the same destination. No line breaks, bullet points or
  numbered lists; caps, emoji and symbols are restricted. DOCUMENTED [2] (undated page, read 2026-10-31).
- "Ads are displayed in public channels with 1000+ subscribers"; links "must link to a channel or bot on Telegram";
  once an ad is created "its targeting parameters can't be changed". DOCUMENTED [3] (getting-started page, read
  2026-10-31; it still says "0.1 Toncoin", i.e. it predates the Gram rename).
- **Search ads**: added 2025-04-08 per eLama. Keyword targeting, up to 10 keywords of 4-32 characters, shown above
  global search results on mobile and desktop, headline only. "Only Telegram channels and bots" can be promoted.
  Invite links, the `start` parameter and post links are not supported. Minimum bid €1 (at the time). CLAIMED
  (reseller) [14].
- **Ads in bots**: launched 2025-05-14 per weproject.media (citing adindex.ru). Advertisers pick specific bots. The
  promoted object can be a channel, post, Mini App or bot. Minimum €1 (at the time); a channel avatar adds +30% CPM.
  CLAIMED [15].
- Media: eLama's 2026 minimum CPMs list image ads (€0.90) and video/GIF ads (€1.02) [13], so media creatives exist
  in the EUR cabinet. CLAIMED. The official guideline page shown to me does not describe media [2].
- Premium: "These advertisements will be hidden for users that subscribe to Telegram Premium." DOCUMENTED [5].
- **Ads inside Mini Apps by Telegram itself**: not found on ads.telegram.org [1][3] or in the blog index for
  2025-2026 [6]. A third-party roundup states "No bots or Mini Apps" as placements for official ads [29], which
  conflicts with [15] on bots. Reading: no first-party TMA ad inventory as of 2026-10.

**Cabinets and money**
- **Gram cabinet (ex-TON).** The landing page says ads are paid in "Gram" [1]. Toncoin was renamed Gram on
  2026-06-15; the chain is still TON [9] (CLAIMED, third-party glossary). Self-serve at ads.telegram.org, topped up
  via Fragment from a TON wallet (Fragment may require KYC) [9]. Official minimum CPM 0.1 (Toncoin/Gram) DOCUMENTED
  [3]. First deposit about 20 Gram CLAIMED [9]. Targeting is limited to explicit channel/bot/keyword lists, with no
  geo or interests [8][9]. CLAIMED: "TON-cabinet ads are not shown to subscribers from Russia, Ukraine, Israel,
  Palestine and Germany" [17] (2025-12-21, agency blog, no primary source). It was repeated by another secondary
  source (pointer).
- **Stars cabinet.** "Channel/bot owners may place Telegram advertisements for channels/bots they own … paying using
  the Stars currently available on the bot/channel's balance at a special rate with a 30% discount." Entry point:
  the bot's Balance/Monetization section, "Buy Ads" → `payments.getStarsRevenueAdsAccountUrl`. DOCUMENTED [4]. Per
  a third-party guide, one Star buys **$0.02** of ad credit versus **$0.013** on withdrawal, Stars become spendable
  after the 21-day hold, and practitioners enter with about 1,000 Stars and test with about 25,000 Stars [10]
  (CLAIMED, 2026-09-24). CLAIMED, single source: ads from the Stars cabinet **are shown in Russia**, with no
  interest/geo targeting [17]. [17] also says the Stars cabinet cannot promote "chatbots", which contradicts the
  official "channels/bots they own" [4]. The official text wins; verify in the cabinet.
- **EUR cabinet** is sold through resellers. A direct contract is CLAIMED at €2 M, of which €1 M is a deposit
  forfeited unless €10 M is spent in a year [16]. Telegram does not publish this [8].
- Revenue share: "50% of ad revenue goes to the owners of the channels" DOCUMENTED [1].

**Targeting**
- Official pages describe channel selection only [1][3]. Telegram "doesn't use private chat contents or contacts
  lists for ad targeting" DOCUMENTED [1].
- EUR cabinet: "channels, topics, interests, geolocation and language"; **no demographics, no classic
  retargeting**; the Telegram Pixel covers only the last 8 hours. CLAIMED [16] (2026-04-07). [8] adds bots, search
  and retargeting, so the two sources disagree on retargeting.
- Gender/age is available only via **MTS BigData** (operator data) in eLama's "Маркетолог PRO" cabinet or OneSpot's
  BigData cabinet: "exact gender and age, district-level geo, income, 120+ interests, phone-list upload (SHA-256)".
  CLAIMED [16]. Only Russian MTS subscribers are covered.

**Policy relevant to a romance VN Mini App** (DOCUMENTED [2], undated, read 2026-10-31)
- Prohibited: "online or offline gambling, gaming, or casino-based activities involving real money". Non-real-money
  games are not prohibited. "Nudity and sexually explicit or suggestive content" are prohibited, and **"dating
  services" is listed as an example under sexual content**. Profanity is banned in ads *and destinations*.
- Bots must be "beneficial to the user" and respond to commands on mobile and desktop. "Mostly noninteractive bots
  designed to redirect elsewhere" are not allowed. Promoted channels, bots and accounts need a profile image and a
  full about/description.
- A channel destination needs "at least one post published within the two weeks prior to review".
- "The language of the targeted channel should match the language of the ad and of the destination."
- **No age-related rules** and nothing on minors or romance on the page [2].
- Moderation is CLAIMED at a typical 1-4 h [8].

### 2. Telegram Ads for Russian advertisers (resellers, prices, ERID, 2026 changes)

- **Minimum CPM history for Russia** (all CLAIMED, resellers via ppc.world):
  - Feb 2026: a reported ~30% cut, to €0.70 for categories and €1.00 for channels/bots (pointer, not opened).
    [22] quotes the same €0.7 / €0.35 / €1 floors.
  - 2026-08-27: the channel/bot/search minimum was cut from €1 to **€0.15** [11].
  - 2026-08-28: it was raised to **€0.75** (×5). Country/language targeting went €0.70 → **€0.60**; "Politics and
    incidents" €0.35 → €0.30 [12].
  - eLama on 2026-09-14 gave these minimums: topic/audience €0.6; channels, chatbots and search €0.75; image €0.9;
    video/GIF €1.02 [13].
- **Resellers and entry** (CLAIMED):
  - eLama, 2026-09-14 [13]: "most resellers require 500 €". МТС Ads "Маркетолог Pro" from 250 €; МегаФон from
    100 €. Commission "от 20%" plus VAT 22%: a €1,000 budget costs €1,464 in total. First-payment commission 10% if
    launched by 30 November.
  - Habr comparison, 2026-04-07 [16]: eLama €0 (postpay) / €250-500, 15-20%; OneSpot €500, 20%; Click.ru €250,
    ~20%; Magnetto €500-1,500, 20%; Clickise €500, 15-20%. Resellers take rubles; some add 3-5 RUB/€ over the
    central-bank rate; eLama offers postpay up to 60 days.
- **ERID**: every creative gets an erid token before publication. For external links the token has to be added to
  the URL by hand. Statistics go to the ERIR within 30 days after the month. Fines for legal entities are
  200,000-500,000 RUB per violation [16]; eLama generates tokens [13]. One practitioner reads Stars-cabinet ads as
  outside Russian marking, "not a legal opinion" [10]. Area 06 has the detail.
- **Benchmarks** (SA Media via ppc.world, 2026-09-15, CLAIMED) [18]: CPM €1.64 → €0.97 and CPC €0.33 → €0.12
  (January → August 2026). Frequency 4 per user gives the best CTR and subscription conversion. Changing the CTA can
  lift CTR "up to 165%". Android has the lowest CPM. VPN use breaks city-level geo; country-level still works.
- **CTR**: Telegram Ads 0.3-0.8%, paid posts 1-5%, native integrations 3-10% (CLAIMED, no method) [22].
- **Cost per channel subscriber** (CLAIMED):
  - Telegram Ads €0.3-1.2 vs paid posts €4-10 [22].
  - Telegram Ads open benchmarks: education €1.37, fashion & beauty €2.50, marketing €0.80 (agency's own results:
    €0.96 / €1.75 / €0.56). Click → subscribe target "from 30%" for an author channel [23].
- **Market context** (CLAIMED/secondary):
  - Mediascope: Russian monthly audience 94 M (March 2026) → 76 M (June 2026, 12+). Channel reach kept above 60%
    of January levels (SA Media) [18].
  - FAS 2026-03-25: no liability for Telegram/YouTube ads until the end of 2026; the ban on ads on restricted
    resources is restated [19].
  - RKN began restricting Telegram on 2026-02-10 (pointers: sravni.ru, novayagazeta.eu, not opened).
- **Yandex Direct → Telegram channels** (the non-Telegram-Ads route, CLAIMED):
  - Auction format, 2023 test write-up [20]: full post with media, up to 764 characters, CPC capped 30-300 RUB,
    billed only for clicks in the first 48 h. Test results: 9 leads for 14,300 RUB; 0 leads for 33,500 RUB in a
    B2B niche.
  - Since 2025 an "exchange" mode has been added in which channels set their own CPM (pointer, ppc.world, not
    opened).
  - Direct's ads are CLAIMED to reach Premium users too [17].
  - eLama's forecast post prices via Direct: ~700-7,200 RUB per post by niche [13].
- **VK Ads**: no source found for VK selling Telegram placements in 2026 (Gap).

### 3. Paid posts in channels (exchanges, prices, fraud, ERID, RKN)

- **Telegram-native "Suggested Posts"** (blog 2025-07-01) [7]. Proposers send a post through the channel's direct
  messages and offer Stars or Toncoin. A date can be fixed or left as "Anytime", and the owner may counter-edit or
  re-price. "The channel owner will receive their reward 24 hours after posting"; "if the post is removed earlier,
  Telegram will automatically return the full amount". Stars bought via Apple etc. may be refunded within 21 days,
  so owners prefer Toncoin. DOCUMENTED [7].
- **Exchanges** (tproger, 2026-02-12, **sponsored content**, CLAIMED) [24]:
  - Telega.in: claims to check channels and exclude bots; a tariff "from 100,000 RUB".
  - Epicstars: 10% commission on top-up, "EpicSafe" escrow.
  - Teletarget: 10%. AdGram: 10%. Socialjet.pro: 25% with automated marking. Bloggery: from 1,000 RUB, checks
    bloggers for cheating.
  - MTS Marketolog: from 125 RUB CPM excl. VAT.
  - Collaborator, Telemetr and TGStat are not detailed there.
  - Per [22], exchanges add 20-30% and going direct to the admin saves 15-25%.
- **Post prices** (CLAIMED):
  - By audience size [22]: under 1k subscribers from 500 RUB; under 10k from 900 RUB; 10-30k 10,000-40,000 RUB;
    50-150k 40,000-150,000 RUB. Agenda [13] gives higher figures: under 10k 10,000-17,000 RUB.
  - Paid-post CPM, Q1 2026 (TGStat/Telemetr via [22]): entertainment & memes 150-300 RUB; news 500-800; IT
    1,200-1,600; finance/crypto 2,500-3,000.
  - Cost per subscriber via paid posts [21] (2026-06-18, agency ranges, no sample size): mass entertainment 50-90
    RUB; news 50-120; food 60-200; beauty & fashion 90-240; parenting 90-240; education 120-180; real estate up to
    680.
  - **No rows for books, fanfiction, anime/manga, K-pop, teen channels or games in any source read** (Gap).
- **Fraud**:
  - "about 30% of channels show signs of view/subscriber cheating" and "73% of budgets go to paid posts" (TGStat via
    [22], CLAIMED, no method).
  - Channel-check procedures (ERR, citation index, view curves) were not researched: the search budget was exhausted
    (Gap).
- **ERID on posts**: every advertising post needs an erid, the "Реклама" label and the advertiser's identity [13].
  For which channels may take ads at all (the RKN >10k registration rule), see area 06; not researched here.
- **Telegram's channel ad-revenue programme**: 50% of Telegram Ads revenue goes to channel owners [1] (the supply
  side, not a buying route).

### 4. Mini-App ad networks and cross-promo

- **AdsGram** (advertiser side):
  - Advertiser doc: "an ad network within Telegram mini-apps, where users watch ads to earn bonuses". "Currently,
    there is only a CPM strategy". USD₮ since 2024-09-23. Partners listed are tap/crypto games (@gamee,
    @dotcoin_bot, @gemzcoin_bot, …) [26].
  - Homepage: media ads (video 6-15 s 9:16 or image/GIF 1:1); inline/task ads; native channel posts and bot
    messages; official Telegram Ads resale [27].
  - Bidding: CPM with tCPC/tCPA optimisation (tCPA after ~25 postback conversions) [27].
  - Targeting: country, interface language, OS, VPN, Premium, TON wallet. No gender or age targeting [27].
  - Reach: 15 M+ daily impressions, 213 countries [27].
  - Testimonials: a game at $0.21 CPI with UA paying back on day 18; a VPN at $0.36 per install, 11% to paid
    (CLAIMED, unverified) [27].
  - The verticals list of [29] includes "dating" and iGaming.
- **RichAds** (vendor page, undated, CLAIMED) [30]:
  - Average prices: playable CPM $3-4; push-style CPC $0.025; interstitial video CPM $3-7; embedded banner CPC
    $1-2; interstitial CPC $1.5-2.5.
  - Floors: push-style CPC $0.015 (recommended $0.02); embedded CPM $0.04; interstitial CPM $1.50; video CPM $3.
  - Minimum deposit $150. Paid by wire, card, Capitalist or Payoneer.
  - Targeting: language, geo, motive/non-motive (rewarded or not), Premium, wallet, OS. No retargeting.
  - Reach: "70+ million users", "150+ app and bot owners since September 2024".
- **TADS** (vendor, read 2026-10-31, CLAIMED) [31][32]:
  - Formats: banner, fullscreen, rewarded. Main unit is a text-graphic block billed by CPC; fullscreen billed by
    CPM.
  - Prices: CPC from $0.01, CPM from $1, a $50 test. Funding over USDT TRC20 (per its FAQ, pointer).
  - Audience: 25 M users; 7.64% Premium; 20.6% "Web 3.0 gamers"; languages EN 56.06% / Persian 16.97% / RU 15.41%;
    Tier 1 36% / Tier 2 34% / Tier 3 29%; average CTR 10.5% "last month".
  - TADS "does not track conversion rates on third-party apps". Its blog (2026-06-16) gives no retention data and
    advises measuring rewarded and non-rewarded traffic separately.
- **PropellerAds 2025 report** [33] (CLAIMED, internal data, no method):
  - TMA MAU stabilised at 150-190 M by mid-2025 (Findminiapp); crypto 57 M, games 52 M.
  - CPC in Tier-2/3 geos ~$0.01; CTR 20-40%; rewarded interstitial takes 60-70% of rewarded budgets.
  - Only 1.3% of campaigns promote Telegram products.
  - No gender, no Russia data.
- **Monetag, Adexium**: only publisher-side material surfaced (Monetag formats: rewarded popup / rewarded
  interstitial / in-app interstitial / SmartLink, via a competitor blog, pointer). No advertiser terms were found
  for either (Gap).
- **PlayDeck**: a game marketplace offering push notifications, promo banners and "tasks in the Wheel of Fortune"
  for visibility. The wiki was last edited 2025-02-03 and states no prices or cross-promo exchange [34].
- **Audience demographics**:
  - Russian-speaking Telegram overall: 56% male / 44% female; ages 15-20 13%, under 14 2%, 21-45 65% (Telemetr
    2025 survey, no sample size; CLAIMED) [35].
  - Mediascope (2024, via search pointer): Telegram's composition is "close to the average Russian".
  - TMA ad networks publish no gender split. Their inventory (tap-to-earn, crypto partners [26]; "Web 3.0 gamers",
    wallet targeting [31]) points to crypto-native audiences, but that is inference, not data.
- **Incentivized-traffic quality**: no published D1/D7 for TMA rewarded campaigns was found (Gap). The only signal
  is the vendors' own advice to split the measurement [32].

### 5. Anything MEASURED

- Nothing I opened meets MEASURED with a stated method and sample. Closest:
  - SA Media's January→August 2026 CPM/CPC averages [18]: an agency aggregate with no method → CLAIMED.
  - Yandex Direct Telegram-placement tests [20] (2023): four campaigns with spend and leads each, a stated method
    (single agency, B2B/real estate), n = 4 → CLAIMED, but the closest to a case write-up.
  - AdsGram testimonials [27]: CLAIMED.
- Derived arithmetic (mine, from CLAIMED inputs):
  - At the €0.75 floor, 100k impressions = €75 before fees. With eLama's ~20% commission and 22% VAT that is ≈
    €110.
  - At CTR 0.3-0.8% [22] that is 300-800 clicks → **€0.14-0.37 per click all-in**, roughly in line with SA Media's
    €0.12 CPC net [18].

## Channel rows (for the synthesis table)

| Channel | Cost (with currency, date, label) | Effort | Fit for a Russian-first romance VN for girls in a TMA | Evidence quality | Notes |
|---|---|---|---|---|---|
| Telegram Ads, EUR cabinet via RU reseller (eLama, Click.ru, MTS, MegaFon, OneSpot) | Min CPM €0.60 (topic/lang) / €0.75 (channels, bots, search), 2026-08-28, CLAIMED [12][13]; avg CPM €0.97, CPC €0.12 Aug 2026, CLAIMED [18]; entry €100-500 + ~20% fee + 22% VAT, CLAIMED [13][16] | Medium: contract with reseller, ERID per creative, 160-char creatives, moderation | Medium. Topic/channel targeting can reach books/anime/women's channels. **No age/gender targeting** except MTS BigData [16]. Premium users excluded [5]. Legal status from 2027 unknown [19] | B | Destination must match the ad's language [2]. "Suggestive" creatives and "dating" are banned [2]. Romance art must stay chaste |
| Telegram Ads, Stars cabinet (own bot) | 30% discount on Stars spent, DOCUMENTED [4]; ≈$0.02 ad credit per Star vs $0.013 payout, CLAIMED [10]; ~1k Stars entry, CLAIMED [10] | Low: in-app "Buy Ads" from the bot balance; needs earned Stars (21-day hold, CLAIMED) | Medium-high once revenue exists: recycles chapter revenue. CLAIMED shown in Russia [17]; targeting thin [10] | B (mechanism A) | Only promotes the bot/channel that holds the Stars [4]. Nothing to spend before launch |
| Telegram Ads, Gram (ex-TON) cabinet, self-serve | Min CPM 0.1 Gram, DOCUMENTED [3]; first deposit ~20 Gram, CLAIMED [9] | Medium: crypto wallet + Fragment (KYC possible) | Low for Russia (CLAIMED not shown to RU users [17]). Possible for the English line (explicit channel lists) | B/C | No geo/interests [9]. 80% of archived creatives come from this rail [9] |
| Telegram search ads | Min bid €1 (2025-04), CLAIMED [14]; €0.75 min CPM for RU (2026-08), CLAIMED [12] | Low-medium | Medium: keywords like «новелла», «отомэ» could reach intent; **no `start` param → no attribution** [14] | B/C | Channels and bots only [14] |
| Telegram Ads in bots | Min €1 at launch (2025-05), CLAIMED [15]; €0.75 RU min (2026-08) [12] | Medium | Medium: choose bots with a fitting audience (reading, quiz, fandom bots), if they exist | C | Third-party roundup says official ads have "no bots", which conflicts [29] |
| Paid posts via exchanges (Telega.in, Epicstars, etc.) | Cost/subscriber 50-240 RUB by niche (beauty 90-240), 2026-06, CLAIMED [21]; entertainment CPM 150-300 RUB, Q1 2026, CLAIMED [22]; exchange fee 10-30% [22][24] | High: channel vetting, ERID, negotiation | High in principle: native posts in romance/books/anime channels are where the audience is, and media/long text are allowed. Fraud risk ~30% of channels, CLAIMED [22] | C | Niche prices for books, anime, fanfic, K-pop: none found |
| Suggested Posts (Telegram-native paid posts) | Price set per deal in Stars/Toncoin; payout 24 h after posting, auto-refund if removed early, DOCUMENTED [7] | Medium: per-channel DMs | Medium-high for small fandom channels; escrow protects the buyer | A (mechanism) / no price data | ERID still applies in RU (area 06) |
| Yandex Direct → Telegram channels | CPC cap 30-300 RUB, 48 h billing (2023), CLAIMED [20]; post forecast ~700-7,200 RUB (2026-09), CLAIMED [13] | Medium: Direct account; auto-marking | Medium: reaches Premium users too (CLAIMED [17]); channel pool chosen by algorithm or exchange | C | 2023 tests: weak in narrow niches [20] |
| AdsGram (TMA network) | CPM only [26]; testimonial game CPI $0.21, CLAIMED [27] | Low-medium: self-serve, USD₮, postback for tCPA | Low-medium: rewarded tap/crypto inventory [26]. No gender targeting. RU language targetable [27] | B/C | Also resells official Telegram Ads [27] |
| RichAds (TMA formats) | Push CPC from $0.015, interstitial CPM from $1.50, video CPM from $3; deposit $150, CLAIMED [30] | Low-medium | Low-medium: "motive/unmotive" filter lets you exclude rewarded traffic [30] | B/C | Card/wire payment possible [30] |
| TADS | CPC from $0.01, CPM from $1, $50 test, CLAIMED [31] | Low | Low: EN 56% / Persian 17% / RU 15%; Web3 skew [31] | B/C | Crypto (TRC20) funding (pointer) |
| Monetag / Adexium / PlayDeck | No advertiser pricing found | ? | Unknown; PlayDeck is a game catalog with pushes/banners [34] | C | Gaps |

## Applicability to tg-app-novel (map onto §2 planned features; product feature asks, listed not designed)

- **M11 attribution** fits directly. Every paid channel above links into Telegram, and conversion data comes only
  from our server. Asks:
  - (a) a campaign-coded `startapp` namespace distinct from the invite `f<code>` (e.g. a different prefix), stored
    first-touch at user creation;
  - (b) cohort metrics per campaign: launch → chapter-1 completion → paywall view → first purchase → D1/D7;
  - (c) a server-side conversion postback endpoint if tCPA on AdsGram-type networks is used [27].
  - Charset/length of `startapp`: core.telegram.org states none (prior research M2); AdsGram's doc says up to 512
    characters [28]. The two disagree; keep codes short.
- **Search ads and search-ad-style links drop `start` parameters** [14]. Traffic from them arrives without a
  campaign code. Asks: an "unattributed" bucket, and a bot `/start` or menu path that still lands in the Mini App.
- **Ad destination requirements** [2][3] are product asks:
  - a bot with a profile image, a full description and working commands on mobile and desktop (`/terms`,
    `/support`, `/paysupport`, `/privacy` already planned);
  - a project **public channel** with a post in the last 14 days, since many formats prefer channels;
  - destination language = ad language. A Russian ad must open the Russian locale, so the Mini App should honour a
    locale hint in the campaign code or Telegram's `language_code`.
- **Stars cabinet** ties to the monetization loop. Revenue from chapter sales can buy ads for the same bot at a 30%
  discount [4]. This decision interacts with MV11 (Affiliate Program "not used"): both spend Star revenue on
  acquisition and should be compared on the same cohort metric.
- **Creative policy vs romance**: "suggestive" content and "dating services" are prohibited [2]. Romance creatives
  and the first chapter (as the destination) must stay non-suggestive. This affects art direction (Q2) and the free
  chapter-1 cliffhanger.
- **Age bracket (13-17 vs 18+)**:
  - Telegram Ads offers **no age targeting** [16] and its policy has no age rules [2]. You cannot target or exclude
    teens there, except via MTS BigData (operator data, Russia only) [16].
  - If the line is 18+, exclusion can only come from channel selection. If the line is 13-17, ads in teen channels
    raise the minors issues in area 06.
- **Russia-first risk**: the FAS transition period ends 2026-12-31 [19]. Every Russian-language Telegram paid
  channel here (Telegram Ads RU, paid posts, Direct-to-Telegram) may become unlawful for Russian advertisers in
  2027 (INTERPRETATION). The operator's jurisdiction (Q21) decides whether that applies.
- **Gifts/referral (M22-M23)**: incentivized TMA networks pay users to open apps. Their users may farm the referral
  reward (first-chapter completion) if it can be converted to value. The 120 s / daily caps planned in M23 are the
  relevant guard. Note only.

## Pitfalls / what goes wrong (sourced)

- Reseller fees and VAT add ~46% to a EUR budget (€1,000 → €1,464) [13]. Minimum CPMs moved three times in 2026
  (February, 2026-08-27, 2026-08-28) [11][12], so stale price sheets mislead.
- Third-party pages contradict each other on the basics: deposits (20 vs 100 TON), retargeting, whether official
  ads run in bots [8][15][29]. Most "2026 guides" are written by agencies selling the service ([8] discloses this).
- Premium users never see Telegram Ads [5]. Premium users may over-index among paying users, but no source
  quantifies that.
- Geo targeting breaks under VPN use in Russia; country-level still works [18].
- The Gram cabinet is CLAIMED not to serve Russia [17]. A campaign there could spend without reaching the primary
  market.
- Rewarded/incentivized TMA traffic: vendor sources themselves avoid publishing conversion or retention [31][32].
  AdsGram's own description is "users watch ads to earn bonuses" [26].
- About 30% of channels show cheating signs (TGStat via [22], CLAIMED).
- Stars paid by Apple/Google users can be refunded within 21 days. That hits Stars-based deals (Suggested Posts)
  [7], and presumably the Stars ad balance (not verified).
- Search ads: no `start` param [14]. Ad targeting is frozen after creation [3].

## Key claims for verification (numbered)

1. Official Telegram Ads text limit "160 characters including spaces"; no line breaks. URL:
   https://ads.telegram.org/guidelines. DOCUMENTED [2].
2. Minimum CPM "0.1 Toncoin"; ads in public channels with 1000+ subscribers; targeting immutable after creation.
   URL: https://ads.telegram.org/getting-started. DOCUMENTED [3].
3. Stars spent on ads for one's own bot/channel get "a special rate with a 30% discount". URL:
   https://core.telegram.org/api/stars. DOCUMENTED [4].
4. Premium users do not see Sponsored Messages. URL: https://telegram.org/faq_premium. DOCUMENTED [5].
5. Russia minimum CPM raised €0.15 → €0.75 (channels/bots/search); country/language €0.70 → €0.60 on 2026-08-28.
   URL: https://ppc.world/news/telegram-ads-snova-izmenil-minimalnyy-cpm-pri-targetinge-na-kanaly-boty-i-poisk-uvelichil-v-5-raz/.
   CLAIMED [12].
6. Reseller entry: MTS "Маркетолог Pro" from €250, MegaFon from €100, typical €500; fee "от 20%" + VAT 22%. URL:
   https://elama.ru/blog/skolko-stoit-reklama-v-telegram/. CLAIMED [13].
7. Gram-cabinet ads are not shown to users from Russia, Ukraine, Israel, Palestine and Germany. URL:
   https://deksis.ru/blog/kak-zapustit-reklamu-v-telegram-v-rossii-v-2025-godu-polnyj-gajd-po-metodam-i-byudzhetam.
   CLAIMED [17].
8. Search ads: channels and bots only; `start` parameter unsupported (2025-04-08). URL:
   https://elama.ru/blog/v-telegram-zarabotala-poiskovaya-reklama-i-ona-uzhe-dostupna-v-kabinetah-telegram-ads-ot-elama/.
   CLAIMED [14].
9. SA Media: CPM €1.64 → €0.97, CPC €0.33 → €0.12 (Jan → Aug 2026); Russian Telegram MAU 94 M → 76 M (Mar → Jun
   2026). URL: https://ppc.world/articles/reklama-v-telegram-v-2026-godu-benchmarki-i-stoit-li-zapuskat-kampanii-seychas/.
   CLAIMED [18].
10. FAS: no liability for Telegram/YouTube ads until the end of 2026 (2026-03-25). URL:
    https://ppc.world/news/fas-mery-otvetstvennosti-za-reklamu-v-telegram-i-youtube-ne-budut-primenyatsya-do-konca-2026-goda/
    (primary fas.gov.ru/news/34584 refused connection). CLAIMED secondary [19].
11. Suggested Posts: reward 24 h after posting, full auto-refund if removed earlier. URL:
    https://telegram.org/blog/checklists-suggested-posts. DOCUMENTED [7].
12. RichAds floors: push CPC $0.015, interstitial CPM $1.50, video CPM $3; deposit $150. URL:
    https://richads.com/telegram_ads/. CLAIMED [30].
13. TADS audience: EN 56.06%, Persian 16.97%, RU 15.41%; CPC from $0.01, CPM from $1. URL:
    https://tads.me/advertiser. CLAIMED [31].
14. AdsGram: "users watch ads to earn bonuses"; CPM only; USD₮ since 2024-09-23. URL:
    https://docs.adsgram.ai/advertiser/. CLAIMED (vendor doc) [26].
15. EUR cabinet has no demographic targeting; gender/age only via MTS BigData. URL:
    https://habr.com/ru/articles/1020174/. CLAIMED [16].

## Gaps (asked but no reliable source found)

- Cost per subscriber, CPM or CPC for **books/reading, romance, fanfiction, anime/manga, K-pop, teen channels,
  games** in Russian Telegram: none in any source read. "Beauty & fashion" is the only women-skewed proxy [21][23].
- **Search budget exhausted** before these were searched: Collaborator, Telega.in and Epicstars current terms;
  TGStat/Telemetr channel-fraud check procedures; VK Ads Telegram placements; Monetag and Adexium advertiser terms;
  Telegram cross-promo exchanges between TMA games; offerwall/task networks other than AdsGram tasks.
- The RKN registration rule for channels over 10k subscribers and its effect on ad-taking: left to area 06.
- No MEASURED case (spend + installs + D1) for any TMA, let alone a VN. No retention data for incentivized TMA
  users.
- Gender/age split of TMA ad-network audiences: none published.
- Whether the official EUR cabinet accepts `t.me/<bot>?startapp=` links as destinations: not stated on any
  official page read. [15] says Mini Apps can be promoted in bot ads.
- The Stars ad-credit rate ($0.02/Star) and the 21-day hold for ad spending rest on one third-party source [10];
  core.telegram.org gives no values [4].
- The Telegram Ads official age policy (none on [2]) and Telegram's own user minimum age: not researched here.

## Owner value questions this area raises (each with a default reading)

1. **Paid-acquisition test budget** before launch (e.g. €500 via reseller ≈ €730 all-in). Default reading: none
   until chapter-1 → purchase conversion is measured organically; then a small reseller test.
2. **Recycle Stars revenue into Stars-cabinet ads** for the bot (30% discount) versus withdrawing it. Default
   reading: allowed once revenue exists, judged against MV11 (Affiliate Program).
3. **Russian-market paid ads in 2027** given the FAS transition end (2026-12-31). Default reading: no Russian-market
   paid Telegram campaigns committed beyond 2026 until area 06 and the jurisdiction ruling (Q21) are settled.
4. **Incentivized/rewarded TMA networks** (crypto-skewed audience). Default reading: excluded, or "unmotivated only"
   filters if tested.
5. **Teen channels as ad placements** if the line is 13-17. Default reading: not before the legal review (area 06).
6. **Creative policy**: chaste romance art in all ads and in chapter 1 (Telegram bans "suggestive"). Default
   reading: yes, an art-direction constraint (Q2).
7. **A public project channel** as an ad destination and community. Default reading: yes, owned and posted to at
   least every two weeks.

## Sources

[1] https://ads.telegram.org/ — Telegram Ad Platform landing (160 chars, 50% revenue share, paid in "Gram"); undated, read 2026-10-31; official.
[2] https://ads.telegram.org/guidelines — Ad Policies and Guidelines; undated, read 2026-10-31; official (redirect from promote.telegram.org/guidelines).
[3] https://ads.telegram.org/getting-started — getting started (min CPM 0.1 Toncoin, 1000+ subscribers, immutable targeting); undated, read 2026-10-31; official.
[4] https://core.telegram.org/api/stars — MTProto Stars docs, "Paying for ads" section; read 2026-10-31; official.
[5] https://telegram.org/faq_premium — Premium FAQ (ads hidden); read 2026-10-31; official.
[6] https://telegram.org/blog — blog index 2025-01-24 … 2026-08-25; read 2026-10-31; official.
[7] https://telegram.org/blog/checklists-suggested-posts — Suggested Posts; 2025-07-01, read 2026-10-31; official.
[8] https://tgmetrics.org/wiki/what-is-telegram-ads — third-party guide by an agency group (discloses it); updated 2026-09-23; CLAIMED.
[9] https://telegramadsarchive.com/info/ton-ads — Gram cabinet glossary (Telegram Ads Spy, CC-BY); 2026, data as of 2026-09-23; CLAIMED.
[10] https://tgadsspy.com/blog/en-stars-cabinet-telegram-ads-guide-2026 — Stars cabinet guide; published 2026-04-22, updated 2026-09-24; CLAIMED.
[11] https://ppc.world/news/telegram-ads-snizil-minimalnyy-cpm-v-sem-raz/ — news, min CPM €1 → €0.15 for Russia; 2026-08-27; trade press citing eLama.
[12] https://ppc.world/news/telegram-ads-snova-izmenil-minimalnyy-cpm-pri-targetinge-na-kanaly-boty-i-poisk-uvelichil-v-5-raz/ — news, €0.15 → €0.75; 2026-08-28; trade press.
[13] https://elama.ru/blog/skolko-stoit-reklama-v-telegram/ — eLama (reseller) price guide; 2026-09-14; CLAIMED.
[14] https://elama.ru/blog/v-telegram-zarabotala-poiskovaya-reklama-i-ona-uzhe-dostupna-v-kabinetah-telegram-ads-ot-elama/ — search ads launch; 2025-04-08; reseller.
[15] https://weproject.media/articles/detail/telegram-ads-zapustil-reklamu-vnutri-chat-botov/?amp=y — ads in bots; 2025-05-14; trade press citing adindex.ru.
[16] https://habr.com/ru/articles/1020174/ — reseller comparison, targeting, ERID; 2026-04-07 (year from footer); practitioner article.
[17] https://deksis.ru/blog/kak-zapustit-reklamu-v-telegram-v-rossii-v-2025-godu-polnyj-gajd-po-metodam-i-byudzhetam — agency guide (TON/Stars cabinets for RU, Direct, MTS); 2025-12-21; CLAIMED.
[18] https://ppc.world/articles/reklama-v-telegram-v-2026-godu-benchmarki-i-stoit-li-zapuskat-kampanii-seychas/ — 2026 benchmarks (SA Media, Mediascope, FAS); 2026-09-15; trade press.
[19] https://ppc.world/news/fas-mery-otvetstvennosti-za-reklamu-v-telegram-i-youtube-ne-budut-primenyatsya-do-konca-2026-goda/ — FAS transition period; 2026-03-25; trade press (fas.gov.ru refused connection).
[20] https://ppc.world/articles/reklama-v-telegram-kanalah-cherez-yandeks-direkt-rezultaty-pervyh-testov/ — Direct→Telegram tests; 2023-11-29; agency case.
[21] https://telegue.com/blog/articles/benchmarks-telegram — cost per subscriber by niche (paid posts); 2026-06-18; agency ranges.
[22] https://fedotovseo.ru/blog/stoimost-reklamy-telegram-2026/ — costs 2026 (Telegram Ads vs paid posts, CTR, TGStat fraud share); 2026-04-25; agency blog.
[23] https://telegram-ads.com/ru/blog/skolko-stoit-podpischik-v-telegram-ads/ — cost per subscriber in Telegram Ads by niche; 2026; agency blog.
[24] https://tproger.ru/articles/top-15-birzh-reklamy-v-telegram-v-2026-godu---rejting-servisov — exchanges ranking; 2026-02-12; sponsored content.
[25] https://tgmetrics.org/telegram-cpm — CPM compilation by geo; updated 2026-05-07; compiled, CLAIMED (consulted for geo CPM; not cited inline).
[26] https://docs.adsgram.ai/advertiser/ — AdsGram advertiser doc; undated, read 2026-10-31; vendor.
[27] https://adsgram.ai — AdsGram homepage (formats, targeting, testimonials); read 2026-10-31; vendor.
[28] https://docs.adsgram.ai/fr/advertiser/telegram-analytics — AdsGram doc on `startapp` attribution (512 chars); read 2026-10-31; vendor.
[29] https://adsgram.ai/blog/adsgram/10-best-telegram-advertising-platforms — competitor roundup; 2026-08-03, updated 2026-10-30; vendor blog.
[30] https://richads.com/telegram_ads/ — RichAds TMA formats and floors; undated, read 2026-10-31; vendor.
[31] https://tads.me/advertiser — TADS advertiser page (audience split, floors); read 2026-10-31; vendor.
[32] https://tads.me/blog/telegram-mini-app-ads — TADS blog; 2026-06-16; vendor.
[33] https://propellerads.com/blog/adv-telegram-mini-app-advertising-report/ — PropellerAds TMA report; 2025; vendor.
[34] https://github.com/ton-play/playdeck-integration-guide/wiki — PlayDeck wiki; last edited 2025-02-03; vendor.
[35] https://telemetr.me/research2025/user/ — Telemetr survey of Russian-speaking Telegram users; 2025, no method; CLAIMED.
[36] https://3dnews.ru/1117896/telegram-v-yanvare-vpervie-oboshel-youtube-po-mesyachnomu-ohvatu — Mediascope Jan 2025 reach 90.6 M; 2025-02-07; press.
[37] D:/tmp/novel-orch/design/choices/research_M2.md — prior project research: `startapp`/`start_param` (no official charset/length); read 2026-10-31.
Pointers, not opened: sravni.ru and novayagazeta.eu (2026-02-10, RKN restricts Telegram); ppc.world (Yandex Direct Telegram exchange, 2025); techora.ru (Feb 2026 CPM cut); habr.com/en/articles/912204 (bot ads for bots with 1000+ users).
