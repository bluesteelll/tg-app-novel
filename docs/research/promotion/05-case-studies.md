# Promotion research 05: case studies with numbers (Telegram narrative products, mobile romance / interactive-story apps, short-drama apps, the free-chapter paywall funnel)
Date 2026-10-31. Sources read: 38 opened pages + search-result pointers. Freshness notes: Bot API 10.3 (2026-08-24) is the
latest in `core.telegram.org/bots/api-changelog` [34]; 10.0-10.3 changed nothing about Stars, affiliate programs or
sharing. Key third-party pages read: RevenueCat 2026-08-28 [14], TechTimes/Media Partners Asia 2026-08-06 [12], Sensor
Tower Q2 2025 [7][8], Unisender on Romance Club (updated 2026-04-21) [1]. **The session's web-search quota ran out
during the paywall-conversion sub-question.** After that only pages whose URLs were already known could be fetched;
the Gaps section lists what that left open.

Label key: **MEASURED** = data with a stated method or sample. **DOCUMENTED** = an official doc, store listing or
company filing. **CLAIMED** = a vendor, press, blog or company PR statement. **CLAIMED-3P** = an app-intelligence
estimate (Sensor Tower, Appfigures, AppMagic, Apptopia, MPA) that the company did not report itself.
**ANALYSIS** = my arithmetic or reading, not a source fact.

## TL;DR
- **No Telegram-native romance VN or interactive-story product with public audience or revenue numbers was found.**
  What exists:
  - Russian text-game bots, e.g. the *Everlasting Summer* (Бесконечное лето) VN adapted as a chat bot, live since at
    least 2017 [30][32].
  - AI "story" bots [30] and a story RPG mini app, Roko [31].
  - Fandom channels around Romance Club [1][3].

  A romance VN with chapter purchases in a Mini App looks like an empty niche. That also means no in-platform
  benchmark exists. Telegram has published **no platform-wide figure for Stars payouts to developers**. The public
  numbers are Durov's posts: Catizen earned "$16 million from in-app purchases" (2024-07, currency not stated) [27],
  and 15,000 affiliate programs with 4 M referred users in 12 days (around 2024-12/2025-01) [28].
- **Клуб Романтики / Romance Club** (Your Story Interactive, Chișinău, Moldova, launched 2018-03-06) is the closest
  analogue: Russian-first, a female romance audience, chapter-gated.
  - Scale: Google Play 10 M+ (2020) and 11 M+ (2024) installs [4][5]. Community claimed at ~1.4 M on VK and 700 K+ on
    Telegram (2026) [1].
  - Monetization: energy ("tea", one cup per episode, regenerating) plus premium currency ("diamonds") for premium
    choices, scenes and outfits. Paid choices cost up to 10 diamonds early in a story, 30-40 late, and >100 in new
    stories. 60 diamonds cost 499 ₽ (2023) [3].
  - Acquisition: paid social with deliberately absurd or explicit "what was that?" video creatives (2019-2020), then
    organic TikTok memes and fandom [1][4]. It later shifted to retention, with the "Алмазная лихорадка" ("Diamond
    Fever") window in which paid choices are free [1][3].
  - **It left the Russian App Store and Google Play in June 2024** after a Roskomnadzor demand over LGBT content [5].
    Russian players then paid on its website by UID [3].
- **The "free episodes → paywall" funnel at scale is the short-drama model, and it is bought with ad money.**
  - ReelShort revenue: $97 M (2023) → $400 M (2024) → $785 M (2025), with ~55 % of 2025 revenue spent on marketing
    (MPA, CLAIMED-3P) [12].
  - The category made $2.98 B of IAP in 2025 (Sensor Tower) [11].
  - In the US, 68 % of microdrama ad spend (Jan-Sep 2025) went to social: Facebook 25 %, TikTok 19 %, Snapchat 16 %,
    Instagram 8 % (eMarketer/Sensor Tower via [12]).
  - The same studio, Crazy Maple, runs both Chapters (~$220 K/week US) and ReelShort (~$3-4 M/week US) (Sensor Tower)
    [8][9]. Its link to ReelShort comes from search results only (claim 11).
- **No public source gives the conversion rate at an interactive-story chapter paywall.** The best proxies:
  - The median short-drama app converts **5.5 % of installs to payers within 35 days**, against 1.6 % for other
    Entertainment apps, with $23.85 first-month revenue per payer (RevenueCat SDK data, 2026-08) [14].
  - WEBTOON's paying ratio is 4.6 % globally, 15.5 % in Korea and 10.1 % in Japan (S-1, via a secondary summary)
    [25].
  - Streaming Lens's "3-8 %" is an estimate borrowed from F2P [15].
- **Premium choices (paying for a romantic option inside a chapter) are the main lever of the market leaders.**
  Romance Club [2][3], Choices [16][17] and Episode [18] all use them, and critics call it "manipulation" [2]. The
  current project model has chapters for Stars only, hints as the only consumable, and no soft currency. Premium
  choices would conflict with it, and, if the branch text sat inside a free chapter's JSON, with principle 0.
- **Age split matters for which case applies.**
  - Choices' audience was ~78 % female and ~80 % aged 10-21 (Apptopia, 2018) [16]. Episode drew criticism for
    marketing sexualized stories to children [18].
  - Romance Club and Lore are rated **18+** on the App Store [6][24]. Short-drama audiences are adult women: ReelShort
    is ~75 % female (platform-reported) [13].
- **Crypto tap-to-earn numbers do not transfer.** Hamster reached 239 M users by June 2024 and Notcoin 35 M by May 2024
  (CLAIMED) [26], driven by token airdrops, and Hamster banned 2.3 M+ accounts for farming [36]. One aggregator claims
  Mini App reach fell from 1.44 B (2024-09) to 150-190 M by mid-2025 [29].

## Findings

### 1. Narrative products inside Telegram

#### 1a. What exists
| Product | Type | Numbers | Monetization | Acquisition | Label / source |
|---|---|---|---|---|---|
| *Бесконечное лето* bot `@EverlastingSummerBot` | adaptation of the free Russian VN *Everlasting Summer* as a chat bot; "calm" vs "fast" text modes | none found | none found | rides the fame of the original PC VN (2013) [4] | seen in search results and catalog pages only (Shazoo 2017, tgrm.su) [32]; listed in a 2026 DTF ranking [30] |
| `@QuestGameBot` "Привет, незнакомец!" | real-time text quest, branching endings | none | none | the DTF ranking [30] | the ranking looks promotional (referral parameters in links) [30] |
| `@ai_story_worlds_bot` | AI-generated stories in known fictional worlds | none | "try for free" | the DTF ranking, which carries a referral parameter [30] | CLAIMED, promotional [30] |
| Roko (`therokobot`) | story RPG mini app: choices shape the narrative, chapters unlock | none | not stated | catalog listing (findmini.app) [31] | CLAIMED [31] |
| Romance Club Telegram channel `t.me/official_romanceclub` | official fan channel of the mobile game, not a game | 700 K+ subscribers (screenshot, 2026) [1] | promo codes and announcements | owned community | CLAIMED [1] |
| Fandom channels (e.g. «Твои мужики из Клуба Романтики») | fan memes, spoilers, Diamond Fever alerts, diamond promo codes | up to ~80 K subscribers for Russian fan channels (2023) [3] | none | organic | CLAIMED [3] |
| fython/TelegramVisualNovelBot | open-source galgame-in-a-bot (Markdown scenes) | none | none | none | GitHub, seen in search results only |

ANALYSIS: no romance VN with per-chapter Stars purchases was found among the catalogs and articles searched. I could
not query TGStat or tapps.center directly: TGStat needs a login, and the tapps.center searches returned nothing. So
"none exists" is a search result, not proof.

#### 1b. Non-crypto Stars monetization and public Stars numbers
- **No official Telegram figure exists for total developer earnings or payouts in Stars.** Durov's posts give
  commission and adoption numbers only [28]:
  - Post 280 (2024-06, the Stars launch): Apple and Google take 30 % when users buy Stars. Telegram subsidizes Stars
    ads, so the overall commission is "nearly 0 %" for developers who reinvest.
  - Post 281 (2024-06): Telegram's own commission is "less than 5 %".
  - Post 384 (around 2024-12/2025-01): "In just 12 days, 15,000 affiliate programs were created", and 4 M users were
    referred to mini apps.

  The channel shows only times of day, so the dates are approximate. Label: CLAIMED, company CEO statement.
- **Catizen**: Durov said on 2024-07-23 that the game "has already earned $16 million from in-app purchases" with
  "over 26 million players". The article does not say whether the purchases were in Stars or TON. A Catizen
  co-founder gave **$30.7 ARPPU** in the same article [27]. CLAIMED. Catizen is crypto-linked.
- **Developer payout rate**: $0.013 per Star, withdrawn via Fragment in TON [35][26]. A guest article by TON Society
  and AdsGram gives an example: a user pays ~$2.4 through store IAP for 100 Stars, and the developer can withdraw
  ~$1.3 [26]. CLAIMED (vendor-authored). ANALYSIS: at $0.013/Star, $1 of developer revenue ≈ 77 Stars.
- Game World Observer (2025-04-04): "all successful cases so far are crypto-linked"; no non-crypto Stars game named
  [26]. I found **no non-crypto TMA game with published Stars revenue**. A blog figure for GAMEE (~$3.5 M in 2025)
  appeared only in a search summary and was not opened (gap).
- Telegram's company-level revenue was $870 M in H1 2025 (+65 % YoY), with Premium at $223 M. These come from FT
  reporting via aggregators; Stars is not broken out [29]. CLAIMED.

#### 1c. Crypto tap-to-earn contrast (short)
- Players: Notcoin had 35 M by May 2024. Hamster Kombat had 35 M by April 2024 and 239 M by June 2024, peaking at
  4-5 M new users a day. X Empire had 52 M in three months. Major had 70 M at listing and 45 M peak MAU [26]. All
  CLAIMED, in a vendor-authored guest article.
- Incentive: future token airdrops. $HMSTR began trading on 2024-09-26, and allocations disappointed players
  (Wikipedia citing Meduza) [36-ref via M4; Hamster Wikipedia]. Hamster banned more than 2.3 M accounts for farming,
  including one person who linked over 400 accounts to a single Binance address (team statement via ForkLog and
  Decrypt, 2024-09) [36].
- Reach after the hype: one aggregator says Mini App reach fell from 1.44 B monthly (2024-09 peak) to 150-190 M by
  mid-2025, citing PropellerAds [29]. CLAIMED, from a single secondary source.
- ANALYSIS: their audience came for expected money, and their referral loops paid in that expected money. A
  paid-chapter romance VN offers neither, so their acquisition numbers are not a benchmark.

### 2. Mobile romance / interactive-story apps

#### 2a. Клуб Романтики / Romance Club (Your Story Interactive): the closest case
- **Origin**:
  - Studio: Your Story Interactive (App Store seller "Your Story Interactive SRL"), Chișinău, Moldova. Launched
    2018-03-06; started with a team of 3 and self-funded (Unisender) [1][2][6].
  - Languages: 8 (RU, EN, DE, ES, CS, PL, RO, TR) [2].
  - Content: 40+ stories (2024) [5]. Most stories have about 10 chapters ("episodes"), whole novels are called
    "seasons", and a chapter takes under 30 min (2023) [3]. In 2020 a new story arrived every 3-4 months [4].
- **Scale**:

  | Metric | Value | Date | Label / source |
  |---|---|---|---|
  | Google Play installs | 10 M+ | 2020-05 | DOCUMENTED store counter via Afisha [4] |
  | Google Play installs | 11 M+ | 2024-06 | DOCUMENTED store counter via Meduza [5] |
  | Google Play installs | 12.5 M+ | 2025 | listing aggregator; search summary only |
  | App Store rating | 4.6 from 17 K ratings, age **18+** | read 2026-10-31 | DOCUMENTED [6] |
  | VK community | ~1.4 M (another figure: 1.5 M+) | 2026 / 2024 | CLAIMED [1][2] |
  | Telegram channel | 700 K+ | 2026 | CLAIMED [1] |
  | Outside-CIS followers | ~500 K | 2026 | CLAIMED [1] |
  | Europe, Android | peak $33.7 K/week revenue, 20.5 K/week downloads | Q2 2025 | CLAIMED-3P, Sensor Tower [7] |
  | Europe, Android active users | "1.7 M to nearly 1.9 M" | Q2 2025 | CLAIMED-3P, Sensor Tower [7]; ANALYSIS: implausible next to peers' 22-56 K, likely a different metric or an error |
  | Rank among interactive novels | top by downloads and revenue, last month and last year | 2024-11 | Apptica, no figures [33] |
  | Category revenue spread ("Storytelling (Visual Novels)", 630 apps, last month) | 55 % earn $0; 89 % < $1,000; 98 % < $100,000 | 2024-11 | CLAIMED-3P, Apptica [33] |

  No source states its total revenue, beyond "tens of millions of dollars" [3].
- **Audience**: no source gives age or gender breakdowns. Afisha mentions teenagers and quotes a 19-year-old woman
  fan [4]. The App Store rates it **18+** (sexual content, nudity) [6].
- **Monetization** (all from [1][2][3][6]):
  - **Tea** (energy): one cup per episode, regenerating every 3 h, starting with 3 cups. It is free for watching an
    ad. The pilot episode costs no tea [2][3].
  - **Diamonds**: buy premium choices, scenes, outfits and relationship points. Without enough diamonds,
    relationships degrade and a story can end badly [4]. Free diamonds come from ads, logins and finished chapters,
    usually ≤ 6 at a time [3].
  - **Prices, Russia 2023** [3]: 60 diamonds for 499 ₽; 1,500 diamonds for ~9,000 ₽; 170 tea for 7,999 ₽.
  - **Prices, Russia 2026** [1]: 5 tea for 349 ₽.
  - **Prices, US App Store** [6]: "Fistful of diamonds" $4.99 up to "Barrel" $49.99; "Gold pass" $9.99; starter
    pack $6.99.
  - **Paid choices**: up to 10 diamonds in early episodes, 30-40 in late ones, and >100 in new stories. An outfit costs
    ~30 diamonds, about 450 ₽ of real money [3].
  - A review sums it up: the most pleasant outcomes are "доступны только за донатную валюту" ("available only for
    the paid currency"). The Igromania critic called this a "подлая манипуляция" ("vile manipulation"), 2023-11-23
    [2].
- **Acquisition playbook** (CLAIMED, from Unisender [1], Afisha [4] and T-J [3]):
  - Paid social, in-game integrations with other games, creative testing.
  - 2019-2020 creatives: short videos with absurd or explicit dialogue, often not matching the actual plot. The hook
    is the viewer's "what was that?", answered by installing [1].
  - Viral TikTok memes made by fans: many people installed to understand the memes about the characters Viktor and
    Lucifer. Twitter trends appeared about every two weeks (2020) [4].
  - Peak growth came during the pandemic, followed by a shift to retention ("keeping players became cheaper than
    acquiring"; LTV as the key metric) [1].
  - Live-ops: "Алмазная лихорадка" ("Diamond Fever"), roughly monthly for two days, during which paid choices are
    free. It starts at 04:00 Moscow time and players set alarms [1][3].
  - Merch (books, plush toys, dakimakura) sold on Ozon and Wildberries. The novelization *Секрет небес* sold 25 K
    copies, against a 2-5 K average print run for Russian fiction [1][3].
  - Fandom: cosplay, walkthrough groups (e.g. rc.guide on VK), fan fiction [3][4].
- **Russia exit**: in June 2024 the studio removed the game from Russian app stores rather than delete LGBTQ+
  storylines after a Roskomnadzor demand. It promised to keep releasing Russian content [5]. Already in 2023, Russian
  bank cards were not accepted in the app, and players paid via mobile-operator billing or **on the official site by
  UID** [3].

  ANALYSIS: the leader of the Russian-language market already sells outside the app stores, which matters for a TMA.
  Content rules (Russian law on LGBT "propaganda") are a live risk for this genre in Russia; see area reports on law.

#### 2b. Love Sick: Interactive Stories (SWAG MASHA, Minsk, Belarus; MY.GAMES)
- Founded 2018-05. The game launched on Google Play in 2019-01 and on iOS in 2019-03. It reached "more than three
  million users" in its first six months, and MY.GAMES fully acquired the studio in 2019-07 (company press release)
  [21][22].
- Sensor Tower estimate for 2019-07: Android 600 K downloads / ~$600 K, iOS 400 K / ~$700 K (CLAIMED-3P via dev.by)
  [23].
- MY.GAMES Q3 2020 report (via dev.by): **monthly revenue > $2.6 M (+58 % YoY)**, ~$100 K/day in April 2020, and
  **21 M installs** since 2019-02. Top-paying markets: US, UK, Germany [20]. CLAIMED, a company report through press.
- 2025-05: about half of the 80 staff were laid off. The older games (Love Sick, Dream Zone, Love Sparks) get
  technical support only, with no new content. A new project, Swag Toons, reached ~20 K downloads (AppMagic) [23].
  CLAIMED, from former employees.
- ANALYSIS: a CIS-built, English-first title reached $2.6 M/month within ~20 months. The market for these titles has
  since contracted, as the next row shows.

#### 2c. Western interactive-story apps (Episode, Choices, Chapters, MeChat, Lovestruck)
| App | Numbers | Audience | Monetization | Source / label |
|---|---|---|---|---|
| **Choices: Stories You Play** (Pixelberry; Nexon 2017 → Series Entertainment 2024) | ~**$544 M lifetime revenue, 100 M+ downloads** (2024); ~$1 M worldwide in 2022-03; Nexon's NA/EU revenue fell 5 % in 2023, partly on Choices; layoffs 2024-01 and early 2026 | **~78 % female; ~45 % aged 10-15, ~35 % aged 16-21** (2018) | keys gate chapters (refill ~2 h, hold 2); diamonds buy premium choices and scenes; a 30-s video ad opens each chapter (2018); keys $1.99/5 up to $48.99/150; diamonds $1.99/20 up to $99.99/1,500 | PocketGamer.biz 2024, Finley 2022 and Apptopia 2018, via Wikipedia [16] (CLAIMED / CLAIMED-3P); prices DOCUMENTED-as-reported 2018 [17] |
| **Episode** (Pocket Gems; Tencent invested $90 M) | 6 M WAU (2018, studio) [19]; 12 M story creators, 150 K stories, 9 B views (2021) [18]; US: weekly revenue $379 K → $252 K and WAU 183 K → 147 K (Q3 2024) [9]; peak $259 K/week, ~43 K downloads/week, active users 257 K → 203 K (Q2 2025) [8] | marketed to children despite sexual themes (The Conversation, 2019) [18] | a daily limit of free chapters, then packs; premium choices for in-game currency [18] | [18][19] CLAIMED; [8][9] CLAIMED-3P |
| **Chapters: Interactive Stories** (Crazy Maple Studio) | US: ~$377-395 K/week, WAU ~122-128 K (Q3 2024) [9]; ~$220 K/week, 62.7 K active (Q2 2025) [8]; Europe Android: ~$103 K/week (Q2 2025) [7] | not found | not opened (gap) | CLAIMED-3P |
| **MeChat - Interactive Stories** (PlayMe), chat-story format | US: ~$139-149 K/week; active users 49 K (Q3 2024) and 101 K (Q2 2025) [8][9] | not found | not found | CLAIMED-3P |
| **Love and Deepspace** (Infold), 3D otome | US: peak ~$2.5 M/week (Q2 2025) [8] | not found | not found (gacha-style, not chapter-gated: ANALYSIS, unverified) | CLAIMED-3P |
| **Lovestruck** (Voltage USA) | a search summary says Voltage announced in 2021-12 it would close Voltage Entertainment USA (Wikipedia, not opened); a 2017 blog: a "ticket"-based portal, a whole main story ~400 coins ≈ $6 | not found | tickets + coins | gap: not verified |
| **Stories: Love and Choices** | nothing found | | | gap |
| **Lore: Interactive Stories** (Sunbird, 18+), chat stories | 1.4 K ratings | 18+ | "first two chapters of every story are free"; all-access subscription $6.99/week, $12.99/month, $99.99/year; message packs; **"no ads and no premium choices"** | DOCUMENTED, App Store listing [24] |

Category context: the top 7 interactive-story games made > $14 M of IAP in one month (Apptopia, 2018-02/03) [19].
ANALYSIS: the chapter-gated Western titles are flat or shrinking in 2024-2025. In the US, Episode and Chapters
each made ~$0.2-0.4 M a week, against ReelShort's ~$3-4 M a week in the same category list (Q3 2024) [9].

#### 2d. Short-drama apps (ReelShort, DramaBox, DramaWave): the same funnel at huge ad spend
- **Revenue**:

  | Item | Value | Label / source |
  |---|---|---|
  | Category IAP | $700 M in Q1 2025 (≈4× YoY); $2.98 B in 2025 (+115 %) | CLAIMED-3P, Sensor Tower [10][11] |
  | ReelShort / DramaBox | $130 M / $120 M in Q1 2025 | CLAIMED-3P, Sensor Tower [10] |
  | ReelShort (MPA) | $97 M (2023), $400 M (2024), $785 M (2025), $1.05 B projected (2026); ~$12 M net loss in 2025, first profit projected for 2026 | CLAIMED-3P, MPA [12] |
  | ReelShort (Appfigures) | ~$1.2 B gross consumer spend in 2025 | CLAIMED-3P, via [13] |
  | ReelShort revenue mix | North America 59 % of revenue; consumer payments 85-90 %, subscriptions 60-70 % of those | CLAIMED-3P, MPA [12] |
- **Users**: ~70 M monthly users (2026); Latin America and APAC are ~60 % of users but 19 % of revenue (MPA) [12].
  Q1 2025 category downloads were 370 M+ (Sensor Tower) [10]. ANALYSIS: downloads come from cheap markets, money from
  the US.
- **Audience**: ReelShort ~75 % female, platform-reported [13]. A 2023 AppGrowing estimate puts ad targeting at mainly
  women 25-44 (search summary only).
- **Paid UA and channels**:
  - ReelShort's marketing was **~55 % of revenue in 2025**, projected 44 % by 2028 (MPA) [12].
  - Executives at MIP London said platforms spend up to ~90 % of budgets on marketing [13][14]. Holywater's co-CEO
    claimed "$20-30 per install" at MIP London, 2026-02 [13]. CLAIMED; per install as quoted, the definition is not
    verified.
  - US channel split, Jan-Sep 2025: social 68 % of microdrama ad spend; Facebook 25 %, TikTok 19 %, Snapchat 16 %,
    Instagram 8 % (eMarketer/Sensor Tower, via [12]).
  - DramaWave: > 80 % of downloads from paid ads (2024-09..12), with Unity as the main network (Sensor Tower) [10].
  - TikTok accounts: ReelShort 1.8 M followers, DramaWave 1.7 M [10].
  - Ads open on the narrative hook, not the brand, and are attribution-tied from creative to install, episode,
    payment and renewal [14]. Top creatives are re-used with localized subtitles [10].
- **Monetization and paywall**:
  - Several free episodes, then a coin or subscription paywall "at peak curiosity" [14]. Reported paywall positions:
    first 5 free (sometimes up to 10) [13]; episodes 1-6 free with the paywall at 7-10, a design pattern [15].
  - Prices: VIP $19.99/week or $199/year; a full 80-episode series in coins ≈ $37-47 [13].
  - Weekly plans are 88.5 % of recurring revenue for the median app, and the most common weekly price is $9.99 [14].
- **Funnel numbers (MEASURED, RevenueCat SDK data, method partly stated, n not stated) [14]**:

  | Metric (median short-drama app) | Short drama | Other Entertainment apps |
  |---|---|---|
  | Install → paying within 35 days | **5.5 %** | 1.6 % |
  | Revenue per install, first 14 days | $0.83 | $0.15 |
  | First-month revenue per payer | $23.85 | $13.09 |
  | First-renewal rate | 31.1 % | 44.3 % |
  | Six-month retention (smaller subset) | 1.8 % | 8 % |

  Market concentration: the top 10 apps take ~78 % of short-drama store revenue, and the ~70 % long tail takes 1.5 %
  (Appfigures, ~360 apps, latest 30 days) [14].
- **Holywater** (Ukraine; My Passion books, My Drama vertical series): 100 M+ installs, 1 M+ new users/month (2026-01),
  $22 M round in 2026-01 [37]. CLAIMED. It sold its earlier interactive-story app portfolio in 2022 [37].

### 3. The "free first chapter → paywall" funnel
- **Where the paywall sits**:
  - Romance Club: the pilot episode is free of energy, and every later episode costs one tea (regenerating), so the
    "paywall" is a wait-or-pay timer, not a hard chapter purchase [3].
  - Choices: keys, same idea [16].
  - Episode: a daily chapter allowance [18].
  - Lore: a hard paywall after chapter 2, subscription only [24].
  - Short drama: a hard coin/VIP paywall after ~5-10 episodes [13][15].
  - KakaoPage-style "wait-until-free": one free episode after a 12-72 h wait, or pay to skip (Wikipedia, via search
    summary).

  ANALYSIS: the project's model (chapter 1 free, then a hard Stars purchase per chapter, no wait-for-free) matches
  Lore and short drama, not Romance Club or Choices.
- **Observed conversion at the paywall**: **no source publishes it for an interactive-story chapter paywall** (gap).
  Proxies:
  - 5.5 % install → payer in 35 days, median short drama (MEASURED-vendor, 2026) [14].
  - WEBTOON paying ratio 4.6 % global, Korea 15.5 %, Japan 10.1 %; ARPPU $11.50/month global, $22.20 Japan (S-1 via
    taddy.org, CLAIMED-secondary) [25].
  - "3-8 %" free → paid, explicitly borrowed from F2P (Streaming Lens estimate) [15]; ARPPU $25-35 for ReelShort
    (estimate) [15].
  - Catizen ARPPU $30.7 (co-founder, 2024) [27].
  - DramaBox's parent claims "payment conversion up to 85 %", corporate and unverified [13]. ANALYSIS: almost
    certainly a different metric; do not use it.
- **What drives it** (claims from sources, not experiments):
  - Peak curiosity / cliffhanger at the paywall, personalized [14].
  - "Viral hookability" built into scripts [13].
  - Accumulated attachment ("almost like real relationships", a fan quoted in [4]). Diamond-saving builds
    anticipation (a game designer in [4]).
  - Sunk cost: a progress report at the end of each Choices chapter makes replaying with keys attractive [17].

  No controlled A/B data on cliffhanger strength was found.
- **The "premium choice" lever**:
  - Romance Club, Choices and Episode monetize mainly through paid options inside chapters: the better romance scene,
    saving a character, the love interest's affection [2][3][4][16][17][18].
  - Price ladders rise through a story (≤ 10 → 30-40 → > 100 diamonds) [3].
  - Free players can usually finish the base story [1][17], but critics call the model manipulation or pay-to-win
    [2][16].
  - Lore markets the absence of premium choices as a feature [24].
  - **Conflict with the project model (ANALYSIS)**:
    - (a) It needs a second consumable or a soft currency for story choices, which the current model excludes
      (chapters are Stars-only; hints are the only consumable).
    - (b) A premium branch inside a free chapter is paid content. Under principle 0 its text could not ship in the
      free chapter's public JSON. It would need server-gated delivery per branch, which the current per-chapter
      gating does not cover.
    - (c) Per-choice Stars invoices would mean many small `openInvoice` round-trips inside a scene. Rewarded-ad
      currency, the free diamond source at Romance Club and Choices, is another channel the model does not have.

    Listed for the owner, not designed.

### 4. Lessons table
| Case | What they did | Result (label) | Transferable to a TMA romance VN? |
|---|---|---|---|
| Romance Club [1][4] | absurd/explicit "what was that?" video ads, 2019-20 | growth to 10 M+ GP installs by 2020 (DOCUMENTED counter); no causal data | **adapt**: the ad must land on a `t.me` link, a two-app hop from TikTok/VK; a misleading-creative risk under ad-platform rules (not checked here) |
| Romance Club [4] | fandom TikTok memes about the love interests | memes drove installs (CLAIMED, journalist) | **yes**: characters people meme about; cheap |
| Romance Club [1][3] | owned VK (~1.4 M) and Telegram (700 K+) communities, promo codes | retention channel (CLAIMED) | **yes**: a Telegram channel sits next to the bot natively |
| Romance Club [1][3] | Diamond Fever: paid choices free for 2 days a month | habit plus ad views (CLAIMED) | **adapt**: no soft currency here; the analogue would be a time-boxed free chapter or hint event (owner value) |
| Romance Club [3] | web payment by UID when store billing failed in Russia | kept Russian revenue after 2022 (CLAIMED) | **yes**: Stars is already in-platform; shows Russian players accept out-of-store payment |
| Romance Club [5] | refused to cut LGBT content, left RU stores 2024-06 | community praise (CLAIMED); store loss | **note**: a content-law risk for a Russian-first romance VN |
| Love Sick [20][21][23] | CIS studio, English-first, US/UK/DE payers, film/TV screenwriters | $2.6 M/month in 2020 (CLAIMED company report); half the staff laid off in 2025 | **adapt**: English as a second market pays more; content cadence stopped → decline |
| Choices / Episode [16][17][18] | energy (keys/passes) + premium choices + 30-s ad per chapter | Choices ~$544 M lifetime (CLAIMED) | **no / adapt**: conflicts with the current model; the teen audience (80 % aged 10-21) raises the minors issue |
| Lore [24] | 2 free chapters, then subscription; "no premium choices" | 1.4 K ratings, small (DOCUMENTED) | **yes**: closest to the project's hard-paywall model; Stars subscriptions exist (Bot API) |
| ReelShort [10][12][14] | free episodes → paywall at peak curiosity; 55 % of revenue to social video UA | $785 M in 2025, 5.5 % install→payer median (CLAIMED-3P / MEASURED-vendor) | **adapt**: the funnel transfers; the budget does not, and a TMA cannot use app-install ad optimization the same way (see other areas) |
| DramaWave [10] | > 80 % of downloads from paid ads, Unity; LatAm/SEA cheap installs | #2 by MAU 2025-04 (CLAIMED-3P) | **no** for revenue: cheap-market installs pay little (60 % of users = 19 % of revenue at ReelShort [12]) |
| Hamster / Notcoin [26][36] | token-incentive referrals | 35-239 M users; 2.3 M bans (CLAIMED) | **no**: incentive and audience differ; farming risk is the lesson |
| Telegram Affiliate Program [28] | Stars revenue share to promoters | 15 K programs, 4 M referred in 12 days (CLAIMED, CEO) | **adapt**: the platform tool exists; no narrative-app result found (MV11 owner value) |

## Channel rows (for the synthesis table)
| Channel | Cost (with currency, date, label) | Effort | Fit for a Russian-first romance VN for girls in a TMA | Evidence quality | Notes |
|---|---|---|---|---|---|
| Paid social video (Meta / TikTok / Snap / VK), hook-first cliffhanger creatives | ReelShort marketing ≈ 55 % of revenue, 2025 (CLAIMED-3P MPA [12]); US microdrama spend: 68 % social (2025-01..09 [12]); CPI estimates $3-7 US, $2-5 EU (CLAIMED estimate [15]); "$20-30 per install" (CLAIMED, Holywater exec, 2026-02 [13]) | high: a creative factory, constant testing | **adapt**: works for app installs at scale; a TMA lands on `t.me` (extra hop, Telegram must be installed); RU ad access is a separate question | B | evidence: ReelShort, DramaWave, Romance Club 2019-20 |
| Provocative "what was that?" mismatched-plot creatives | not stated | medium | **adapt / risky**: ad-policy and trust risk; minors if teen-targeted | C | Romance Club [1] |
| Organic fandom / UGC TikTok memes about characters | creator time only | medium (needs memeable characters and art) | **yes** | C | Romance Club [4]; ReelShort 1.8 M TikTok followers [10] |
| Owned community: Telegram channel + VK group, promo codes | free (staff time) | low-medium, continuous | **yes**: the Telegram channel is one tap from the Mini App | C | Romance Club ~1.4 M VK / 700 K+ TG [1]; fan channels up to ~80 K [3] |
| Live-ops "free premium" windows (Diamond Fever) | forgone revenue during the window | low per event | **adapt**: no soft currency; a free-chapter or hint window instead | C | Romance Club [1][3] |
| Merch / book tie-ins | production cost | high | **later**: only after a hit IP | C | Romance Club novelization 25 K copies [3] |
| In-game integrations / cross-promo with other games | not stated | medium | **adapt**: TMA cross-promo networks (see other areas) | C | Romance Club [1] |
| Telegram Affiliate Program (Stars share to promoters) | commission share set by the bot (see research_M4 §2c) | low (BotFather setting) | **adapt** (MV11) | B/C | Durov: 15 K programs, 4 M referred in 12 days [28] |
| Token-incentive referrals (tap-to-earn style) | token supply | high + anti-fraud | **no** | C | Hamster 2.3 M bans [36] |
| Cheap-geo install buying (LatAm/SEA/India) | CPI $0.2-1.5 (CLAIMED estimate [15]) | medium | **no** for revenue | B | ReelShort: 60 % of users → 19 % of revenue [12] |

## Applicability to tg-app-novel (mapped onto §2 planned features; product asks listed, not designed)
- **Free chapter 1 → Stars purchase per chapter.** This matches the hard-paywall cases (Lore [24], short drama
  [14]). The best public proxy for paywall conversion is a single-digit install-to-payer percentage (5.5 % median
  short drama [14]; 4.6 % WEBTOON global [25]). These are proxies, not a forecast.

  Product ask: instrument the funnel per story:
  - launch → chapter-1 start → chapter-1 end (paywall seen) → invoice opened → `successful_payment`.
  - Join these on the server with the M11 `start_param` attribution, so each channel's conversion becomes MEASURED
    data.
- **Invite link / attribution (M10/M11).** Several channels above (paid social, fandom memes, owned channel) need a
  per-channel `startapp` tag to measure them. Product ask: allow channel-campaign tags alongside personal invite
  codes in `start_param` (format left to the architect).
- **Share (M14).** Romance Club's virality ran through character memes and fan content, not share buttons [4]. The
  planned share carries only text and a URL, with no image card. Product ask (listed): the "Later" static per-story
  image is what UGC-style sharing used in these cases. No ending titles or paid content (Q25 rule) is compatible with
  meme-able *character* art.
- **Completion card / endings.** Choices' end-of-chapter progress report drove replays with keys [17]. Multiple
  endings and replayability already exist in the design. ANALYSIS: in these cases the progress report was tied to a
  paid replay lever.
- **Referral (M23) / Affiliate (MV11).** The crypto referral numbers do not transfer [26][36]. The Affiliate Program
  is the platform-native paid-promoter tool, and no narrative-app result exists for it [28].
- **Premium choices.** The market leaders' main lever. It conflicts with the current model and needs principle-0
  branch gating (§3). Listed as an owner question below.
- **Release cadence.** Romance Club added a story every 3-4 months (2020) with episodic chapters [4], and Love Sick's
  decline followed the end of new content [23]. Product ask: the story index (`story/chapters.json`) should support
  announcing upcoming chapters or stories, e.g. "next chapter on <date>", so the owned channel has something to post.
- **Age bracket.** Choices skews to teens [16], Romance Club and Lore are 18+ [6][24], and short-drama audiences are
  adult women [12][13]. Which case applies depends on the open age decision.

## Pitfalls / what goes wrong (sourced)
- **Premium-choice backlash**: "vile manipulation" (Igromania critic, 2023) [2]; "pay-to-win / pay-to-progress"
  (Kim 2023) [16]. It feeds negative reviews in a genre that depends on fandom goodwill.
- **Paid-UA treadmill**: ReelShort spent ~55 % of revenue on marketing and was still loss-making in 2025 [12]. The
  median short-drama app's six-month retention is 1.8 % [14].
- **Cheap installs, no payers**: ReelShort's LatAm and APAC users are ~60 % of the total but 19 % of revenue [12].
- **Content stops → decline**: Love Sick's older titles went to maintenance-only and half the staff were laid off in
  2025 [23]. Pixelberry had layoffs in 2024 and 2026 [16]. Episode's US WAU fell from 183 K to 147 K (Q3 2024) and
  active users from 257 K to 203 K (Q2 2025) [8][9].
- **Content law and platform risk in Russia**: Romance Club lost Russian store distribution in 2024-06 over LGBT
  content [5]. A tax inspection of one of its screenwriters followed a deputy's complaint (ru.wikipedia, citing Mash,
  2024-11) [2].
- **Marketing to minors with sexual content**: Episode was criticized in 2019 [18]. Romance Club is 18+ on the App
  Store [6].
- **Misleading creatives**: Romance Club's 2019-20 ads "often didn't match the plot" [1]. ANALYSIS: this raises a trust
  problem and an ad-policy problem.
- **Long-tail reality**: in Apptica's 630-app visual-novel category, 55 % of apps earn $0 a month and 89 % earn
  < $1,000 [33]. In short drama, the top 10 apps take ~78 % of revenue [14].

## Key claims for verification
1. Romance Club left Russian App Store and Google Play in June 2024 after a Roskomnadzor demand over LGBTQ+ content.
   https://meduza.io/en/feature/2024/06/26/it-shows-they-re-on-their-audience-s-side (CLAIMED, press)
2. Romance Club: VK ~1.4 M and Telegram 700 K+ followers (2026).
   https://www.unisender.com/ru/blog/klub-romantiki-marketing-i-fenomen-igry/ (CLAIMED)
3. Romance Club paid-choice prices of ≤ 10 / 30-40 / > 100 diamonds; 60 diamonds = 499 ₽ (2023-09).
   https://t-j.ru/romance-club/ (CLAIMED)
4. Romance Club rated 18+ on the US App Store, 4.6 from 17 K ratings.
   https://apps.apple.com/us/app/romance-club-stories-i-play/id1300588558 (DOCUMENTED)
5. ReelShort revenue $97 M / $400 M / $785 M (2023-2025); marketing ≈ 55 % of revenue in 2025.
   https://www.techtimes.com/articles/323399/20260806/reelshort-hits-1-billion-microdrama-revenue-first-profit-driven-app-store-bypass.htm
   (CLAIMED-3P, MPA)
6. US microdrama ad spend split for 2025-01..09: social 68 %; FB 25 %, TikTok 19 %, Snap 16 %, IG 8 %. Same URL as 5
   (CLAIMED-3P, eMarketer/Sensor Tower)
7. Median short-drama app: 5.5 % install → paying within 35 days; $23.85 first-month revenue per payer; 6-month
   retention 1.8 %. https://www.revenuecat.com/blog/growth/short-drama-mobile-acquisition-monetization (MEASURED-vendor)
8. Short-drama IAP $2.98 B in 2025 (+115 %).
   https://www.marketingdive.com/news/microdrama-apps-stand-out-on-mobile-heres-what-the-numbers-say/812610/
   (CLAIMED-3P, Sensor Tower)
9. Choices: ~$544 M lifetime revenue and 100 M+ downloads (2024); ~78 % female and ~80 % aged 10-21 (Apptopia 2018).
   https://en.wikipedia.org/wiki/Choices:_Stories_You_Play (CLAIMED / CLAIMED-3P via Wikipedia; re-check the
   PocketGamer.biz original)
10. Love Sick monthly revenue > $2.6 M (MY.GAMES Q3 2020 report); 21 M installs.
    https://devby.io/be/news/lubovnaya-mobilnaya-igra-ot-belorusskogo-pablishera-zarabatyvaet-26-mln-v-mesyats
    (CLAIMED, company via press)
11. US weekly revenue: Chapters ~$220 K and Episode peak $259 K (Q2 2025); ReelShort ~$3.1-3.9 M (Q3 2024).
    https://sensortower.com/blog/2025-q2-unified-top-5-interactive%20story%20games-revenue-us-6019ed6a241bc16eb869f511
    and https://sensortower.com/blog/2024-q3-unified-top-5-drama%20games-revenue-us-602160ea241bc16eb8940bf3
    (CLAIMED-3P). Also verify: Crazy Maple Studio runs both Chapters and ReelShort (this report has it from search
    results only).
12. Durov: "15,000 affiliate programs" and 4 M users referred in 12 days; Telegram's Stars commission is "less than
    5 %". https://t.me/s/durov?q=Stars (CLAIMED, CEO channel; exact post dates not shown)
13. Durov 2024-07-23: Catizen earned "$16 million from in-app purchases"; co-founder: ARPPU $30.7.
    https://www.theblock.co/amp/post/307041/telegram-ceo-touts-catizen-crypto-game-earning-16-million-from-in-app-purchases
    (CLAIMED)
14. Lore: "first two chapters of every story are free"; subscription $6.99/week, $99.99/year; "no premium choices".
    https://apps.apple.com/app/id6741527552 (DOCUMENTED)
15. WEBTOON paying ratio 4.6 % global / 15.5 % Korea / 10.1 % Japan. https://taddy.org/blog/how-does-webtoon-business-work
    (CLAIMED, secondary summary of the S-1; re-check against the SEC filing)

## Gaps (asked but no reliable source found)
- **Search-quota note**: the session's web-search limit ran out while researching paywall conversion. These were
  not searched further: Episode's audience demographics; Chapters' monetization; Stories: Love and Choices;
  Lovestruck's current status; ad-intelligence creative breakdowns (AppGrowing, AdMapix) for Episode, Chapters and
  Romance Club; TGStat/tapps.center catalogs for Telegram story bots; GAMEE's Stars revenue.
- **Romance Club**: total revenue, MAU, payer share, ARPPU, age/gender split, ad spend, and its share of revenue from
  Russia before and after 2024-06. None of these are published (the studio rarely gives interviews [1]).
- **Conversion at an interactive-story chapter paywall**: no public figure for any app. Only proxies, listed in §3.
- **Premium-choice uptake** (share of players who ever buy a premium choice): not found.
- **A Telegram-native VN or interactive story with Stars revenue or MAU**: not found. Telegram publishes no
  per-category or aggregate Stars payout figures.
- **Episode's audience split**: a Pocket Gems-authored GamesBeat post reportedly says "over two-thirds" of the
  audience are women aged 13-25. The page returned HTTP 403 and the claim is unverified (search snippet only).
- **Playable / "what would you choose?" ads in this genre**: only generic ad-tech guidance was found, with no case
  numbers for romance or interactive-story apps.
- **Retention numbers for interactive-story apps**: none found. Short drama has only RevenueCat's 6-month 1.8 % [14]
  and Streaming Lens estimates [15].

## Owner value questions this area raises (each with a default reading)
1. **Premium choices inside chapters** (the market leaders' main lever): add them, or stay chapters-only?
   *Default: chapters-only, as now. This matches Lore's "no premium choices" positioning [24] and avoids principle-0
   branch gating.*
2. **Age bracket**: the teen-heavy Choices-style audience or the adult Romance Club / Lore / short-drama audience?
   *Default: undecided (owner). The cases differ in content rating (18+ for RC and Lore) and in ad targeting.*
3. **Paid UA budget at launch**: the cases show the paywall funnel scaled only with heavy paid social (ReelShort
   ~55 % of revenue). Is there a UA budget, or is launch organic/community only?
   *Default: organic plus owned Telegram channel first; measure conversion per channel before paying for traffic.*
4. **Release cadence promise** (e.g. a chapter every N weeks): both cadence cases (Romance Club, Love Sick) depended
   on it. *Default: no public cadence until two stories are complete.*
5. **Content line for Russia** (LGBT, sexual content): Romance Club lost Russian store distribution over this.
   *Default: decide together with the jurisdiction question (Q21); lawyer item.*
6. **Live-ops "free" windows** (the Diamond Fever analogue: a free chapter or free hints for 48 h): acceptable?
   *Default: allowed in principle, not in the foundation.*
7. **Telegram Affiliate Program (MV11)**: this area found no narrative-app evidence for or against.
   *Default: unchanged ("not used").*

## Sources
[1] https://www.unisender.com/ru/blog/klub-romantiki-marketing-i-fenomen-igry/ — Unisender magazine, "Феномен «Клуба Романтики»", updated 2026-04-21, read 2026-10-31. Marketing analysis with screenshots of follower counts and price pages; CLAIMED.
[2] https://ru.wikipedia.org/wiki/Клуб_Романтики — Russian Wikipedia, read 2026-10-31 (the page is marked outdated, 2026-08). Cites academic papers, Igromania 2023-11-23, DTF 2024-06-24 and Mash 2024-11-19.
[3] https://t-j.ru/romance-club/ — Т—Ж (Tinkoff Journal), 2023-09-29. Prices, mechanics, community.
[4] https://daily.afisha.ru/culture/15770-kak-klub-romantiki-i-vizualnye-novelly-stali-novymi-lyubovnymi-romanami/ — Afisha Daily, 2020-05-31. Journalist feature with developer and fan quotes.
[5] https://meduza.io/en/feature/2024/06/26/it-shows-they-re-on-their-audience-s-side — Meduza, 2024-06-26. The Russia store exit and the 11 M+ GP installs.
[6] https://apps.apple.com/us/app/romance-club-stories-i-play/id1300588558 — App Store listing, read 2026-10-31. Age rating, IAP prices, seller; DOCUMENTED.
[7] https://sensortower.com/blog/2025-q2-android-top-5-interactive%20story%20games-revenue-europe-6019ed6a241bc16eb869f511 — Sensor Tower auto-generated insight, Q2 2025; CLAIMED-3P.
[8] https://sensortower.com/blog/2025-q2-unified-top-5-interactive%20story%20games-revenue-us-6019ed6a241bc16eb869f511 — Sensor Tower, US Q2 2025; CLAIMED-3P.
[9] https://sensortower.com/blog/2024-q3-unified-top-5-drama%20games-revenue-us-602160ea241bc16eb8940bf3 — Sensor Tower, US Q3 2024 (2024-10); CLAIMED-3P.
[10] https://sensortower.com/blog/state-of-short-drama-apps-2025 — Sensor Tower report, 2025-07 (Rui Ma). IAP estimates exclude ads and third-party Android stores; CLAIMED-3P.
[11] https://www.marketingdive.com/news/microdrama-apps-stand-out-on-mobile-heres-what-the-numbers-say/812610/ — Marketing Dive, 2026-02-20, citing Sensor Tower State of Mobile 2026.
[12] https://www.techtimes.com/articles/323399/20260806/reelshort-hits-1-billion-microdrama-revenue-first-profit-driven-app-store-bypass.htm — TechTimes, 2026-08-06, reporting a Media Partners Asia report plus eMarketer and Omdia data.
[13] https://filmustage.com/blog/short-drama-apps-compared-reelshort-vs-dramabox-in-2026/ — Filmustage blog, 2026. An aggregator of Sensor Tower, Appfigures, MPA and Variety figures; secondary, CLAIMED.
[14] https://www.revenuecat.com/blog/growth/short-drama-mobile-acquisition-monetization — RevenueCat, 2026-08-28 (Rik Haandrikman). Appfigures top ~5,000 Entertainment apps plus RevenueCat SDK medians; vendor benchmark, n not stated.
[15] https://lens.streaming-radar.com/vertical-drama-business-model — Streaming Lens, updated 2026-10. Explicit estimates; CLAIMED.
[16] https://en.wikipedia.org/wiki/Choices:_Stories_You_Play — Wikipedia, read 2026-10-31. Cites PocketGamer.biz (Astle 2024), Finley 2022, Apptopia via Batchelor 2018, Kim 2023.
[17] https://www.pocketgamer.biz/how-does-choices-stories-you-play-monetise/ — PocketGamer.biz IAP Inspector, 2018-01-12. Prices and mechanics.
[18] https://en.wikipedia.org/wiki/Episode_(video_game) — Wikipedia, read 2026-10-31. Cites Pocket Gamer 2014/2021, Polygon 2019, The Conversation 2019.
[19] https://gamesbeat.com/apptopia-interactive-story-games-thrive-on-mobile-with-14-million-in-revenues-last-month/ — GamesBeat, 2018-03-05, Apptopia data.
[20] https://devby.io/be/news/lubovnaya-mobilnaya-igra-ot-belorusskogo-pablishera-zarabatyvaet-26-mln-v-mesyats — dev.by, 2020-10-27, citing the MY.GAMES Q3 2020 report.
[21] https://about.my.games/news/27 — MY.GAMES press release, 2019-07-16.
[22] https://www.pocketgamer.biz/swag-masha-on-why-it-sold-to-mygames/ — PocketGamer.biz, 2019-08-14.
[23] https://devby.io/news/swagmasha-sokratila — dev.by, 2025-06-11. Layoffs; Sensor Tower 2019 figures; AppMagic downloads.
[24] https://apps.apple.com/app/id6741527552 — Lore: Interactive Stories App Store listing, read 2026-10-31; DOCUMENTED.
[25] https://taddy.org/blog/how-does-webtoon-business-work — Taddy blog summarizing the WEBTOON S-1, date not stated; secondary.
[26] https://gameworldobserver.com/2025/04/04/telegram-mini-apps-monetization-top-games-features — Game World Observer guest article by TON Society and AdsGram authors, 2025-04-04; vendor-authored, CLAIMED.
[27] https://www.theblock.co/amp/post/307041/telegram-ceo-touts-catizen-crypto-game-earning-16-million-from-in-app-purchases — The Block, 2024-07-23.
[28] https://t.me/s/durov?q=Stars — Pavel Durov's channel, posts 280, 281 and 384 (dates approximate: 2024-06 to around 2025-01). A pointer / CEO statement.
[29] https://voxbooster.com/blog/telegram-statistics-2026/ — statistics aggregator, 2026, citing FT, Statista and PropellerAds; low authority.
[30] https://dtf.ru/games/5219781-reyting-tekstovykh-igr-v-telegram — DTF user blog, "Рейтинг текстовых игр в Телеграм (2026)", 08-03; promotional signals.
[31] https://propellerads.com/blog/adv-best-telegram-mini-apps/ — PropellerAds blog, 2025-03-04, updated 2026-08-31.
[32] https://t.me/EverlastingSummerBot and https://shazoo.ru/2017/03/17/50056/igry-kotorye-rabotayut-pryamo-v-vashem-telegram — the bot link and a 2017 Shazoo article, seen in search results only (not opened).
[33] https://apptica.com/blog/market-research-case-of-interactive-novels/ — Apptica blog, 2024-11-05.
[34] https://core.telegram.org/bots/api-changelog — Bot API changelog, read 2026-10-31 (latest 10.3, 2026-08-24); DOCUMENTED.
[35] `Стек новеллы в Telegram Mini Apps.md` (repo root), line 39 — the owner's research: "$0.013 per Star".
[36] D:/tmp/novel-orch/design/choices/research_M4.md §3b (lines 186-197) — prior research: Hamster Kombat bans (ForkLog / Decrypt, 2024-09-23/24). Also https://en.wikipedia.org/wiki/Hamster_Kombat (read 2026-10-31) for the $HMSTR trading date.
[37] https://en.wikipedia.org/wiki/Holywater_(company) — Wikipedia, read 2026-10-31. Cites Forbes, The Hollywood Reporter, Deadline.
[38] https://ainovel.ru/blog/klub-romantiki-vs-ainovel — AI Novel blog, undated. States that Romance Club also has a subscription; CLAIMED, competitor page.
