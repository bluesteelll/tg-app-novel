# Promotion research 08: markets outside Russia, Russian access, MAX / VK hedges, English-first Telegram

Date 2026-10-31. Sources opened: 44 (plus 9 pointers seen only as search-result extracts, marked **[P]**, not opened).
Freshness notes: ads.telegram.org and ads.telegram.org/getting-started read 2026-10-31 (the landing page names
the currency "Gram"; the getting-started page still says "0.1 Toncoin"). Toncoin was renamed Gram on 2026-06-15
[P46]. VK mini-app rules read in the edition of 2026-03-17 [35]. MAX developer docs (dev.max.ru) read
2026-10-31, undated [26][27][28]. Mediascope figures reach June 2026 [31]. The OONI and whitelist data run to
July-August 2026 [20][21]. zakon.rada.gov.ua (Ukraine) and mordovia.fas.gov.ru refused connection. dev.vk.com and
vk.com are blocked for the fetch tool, but dev.vk.ru worked. Not re-researched (see 06/04): the RKN restriction
of 2026-02-10, the OONI blocking from 2026-03-20, the Mediascope March-June drop, and the 38-FZ art. 5 p. 10.7 ban
(no FAS fines until 2026-12-31).

## TL;DR (decision-relevant)

- **Russian-speaking markets outside Russia are small, and no 2026 measurer publishes Telegram users per country.**
  DataReportal's 2026 country reports do not cover Telegram at all (Kazakhstan checked) [1]. The best per-country
  numbers available are surveys and press claims. Uzbekistan: "about 25 M" Telegram users (2026, source not named,
  CLAIMED) [2]. Armenia: 32 % of internet users name Telegram (Caucasus Barometer 2024, MEASURED) [7]. Georgia: 7 %
  [8]. Ukraine: 67 % of adults are "more or less active" users (Rating, Feb 2026, n = 1000, MEASURED) [11]. Russian
  speakers, total incl. non-native (Wikipedia tables, mixed years): Kazakhstan 83.7 %, Georgia 87 %, Latvia
  76.2 %, Lithuania 67.4 %, Estonia 66.6 %, Armenia 65.3 %, Kyrgyzstan 49.5 %. Native share in Israel is 15 %
  (2011), in Germany 2.3 % (2024), in Uzbekistan 2.1 % [6].
- **Telegram Ads clearly sells into the CIS outside Russia, at known prices.** Kazakhstan was officially launched in
  Oct 2025, and its advertiser count was about 4x by Aug 2026. CPM: Kazakhstan €1.19 → €0.93, Belarus
  €1.45 → €1.04 (Apr → Aug 2026), Uzbekistan €0.10 → €0.16 (all Magnetto.pro via workspace.ru, CLAIMED) [2].
  Counts of creatives with a confirmed target country (third-party classifier, 2026-10-30): Russia 200,668;
  India 58,191; Indonesia 21,247; Uzbekistan 11,764; Germany 10,635; Ukraine 6,139; Brazil 4,291; Kazakhstan
  2,118; US 1,176; Belarus 1,116; Philippines 77 [9]. Native country targeting: the official pages mention only
  channel targeting, and third-party sources contradict each other (gap) [40][41][43][44].
- **INTERPRETATION (not legal advice): a "Russian-language, not Russia-targeted" campaign is a grey zone.** RKN's
  letter 03-72707 (2025-02-20) says ads not aimed at consumers located in Russia are outside its ERIR accounting.
  It defines no test for "aimed at" and points to Government criteria [16]. A regional FAS presentation (2023,
  pointer only) reportedly treats Russian-language pages as ads distributed in Russia [P15b]. Our landing is a
  Telegram bot that Russian users can open, so a Russian-language creative geo-limited to KZ/BY/UZ can still be
  read as aimed at Russia.
- **Russians still reach Telegram, mostly through VPNs or proxies, and our own domain is a separate failure
  point.** Levada (18-26 Mar 2026): 49 % read Telegram channels (53 % in Mar 2025) [19]. VPN use: 40 % active
  (Russian Field, Apr 2026), > 50 % of 18-45-year-olds [18]. A Meduza poll found > 60 % for whom Telegram "works
  only with VPN or proxy". OONI showed Telegram reachable in 11 % of measurements on 2026-04-16 [20]. Separately,
  > 60 % of mobile sessions in H1 2026 ran under restrictions, and whitelist mode admits only listed resources;
  listing requires servers located in Russia (Vigo via Kommersant via iGuides, 2026-08-05) [21]. Since 2025-06-09,
  Russian ISPs have throttled Cloudflare-fronted sites to the first ~16 KB (Cloudflare, 2025-06-26) [22].
  That bears on the planned R2/Worker delivery.
- **Buying Stars from Russia is hard through the official routes.** Telegram documents two routes, Apple/Google
  in-app purchase and @PremiumBot, with no country list [25]. Practitioner guides (CLAIMED) say Russian cards are
  "mostly rejected" and App Store / Google Play work only by chance. Fragment (TON/Gram, KYC) is called the stable
  official route, and grey resellers sell Stars for rubles [24].
- **MAX now has a mini-app platform close to Telegram's, but only Russian residents may publish there.** Its
  `window.WebApp` bridge has `initData` / `initDataUnsafe`, `BackButton`, `DeviceStorage`, `openLink` and
  `shareMaxContent` [27]. initData is validated with HMAC-SHA256: the secret key is HMAC-SHA256 keyed with
  "WebAppData" over the bot token, then hex comparison [28]. Publishing is open only to "юрлиц, ИП и самозанятых,
  которые являются резидентами РФ" (legal entities, sole proprietors and self-employed persons who are Russian
  residents), and apps must comply with Russian law [26]. The bridge has no payments API. Payment providers
  offer acquiring links (Robokassa from 1.8 %/2.9 %) [30]. Audience: Mediascope MAU 86.3 M in June 2026, above
  Telegram's 75.7 M [31]. Apple removed MAX from the App Store on 2026-06-03, citing sanctions [31].
- **VK Mini Apps / Games (rules of 2026-03-17) conflict with principles 2, 3 and 6.** Virtual goods may be bought
  "исключительно в обмен на Голоса ВКонтакте" (exclusively for VK votes), and money payment methods are barred
  (5.2.1, 5.2.5). Apps must authorize users by launch parameters and validate their signature (1.2.2). Games may
  not require "отдельной регистрации или авторизации через сторонние сети" (a separate registration or login
  through third-party networks) (4.2.3). Monetization is limited to votes plus ads (4.2.2), and erotic content is
  banned (2.5.5) [35]. The current votes commission is not on the pages read. The last published figure is 45 %
  (2021) [38].
- **English-first inside Telegram: the audience is large, but nothing measures it per country by gender.**
  Telegram has "significantly over" 1 B MAU (Durov, Mar 2025, company claim) [P45]. No per-country female
  13-34 data was found (gap). No sized English romance or webnovel community on Telegram was found. The book
  channels that do surface skew to piracy (CLAIMED listicles). Floors: 0.1 Toncoin/Gram per 1000 impressions
  (DOCUMENTED) [41]. Reseller EUR accounts: €0.15 for channels, bots and search, €0.20 for user targeting (from
  2026-08-28, CLAIMED). Average market CPM ≈ €0.49 (June 2026, CLAIMED) [42]. No observed English-only CPM
  was found.

## Findings

### 1. Russian-speaking audiences on Telegram outside Russia

**Data availability.** DataReportal "Digital 2026: Kazakhstan" covers Facebook, Instagram, TikTok, LinkedIn,
Messenger, Snapchat, Reddit, X and Threads, but not Telegram. It gives 20.9 M people and 19.5 M internet users
(93.4 %), data as of Oct 2025 [1]. **DOCUMENTED** (as an absence). Telegram itself publishes no per-country user
counts. The aggregator pages (countly, demandsage, grabon) label their own numbers as estimates and disagree by
2x (e.g. India 84 M vs 200 M) [P49].

**Per-country facts found** (Telegram users / Russian speakers / Telegram Ads / local ad law / Stars):

| Country | Telegram audience | Russian speakers (total incl. non-native, native) [6] | Telegram Ads evidence | Local ad-law basics | Stars purchase |
|---|---|---|---|---|---|
| Kazakhstan | No 2026 measured figure. "12.5 M" attributed to Durov, undated [P3]. Outage 2026-08-13: traffic drop at Frankfurt/Moscow peering points, cause not found, works via VPN [4] | 83.7 % (2021); native 21.2 % (2017) | Official launch Oct 2025; advertisers ~4x by Aug 2026; CPM €1.19 → €0.93, CTR 1.03 → 1.35 % (Apr → Aug 2026, CLAIMED) [2]; 2,118 creatives [9] | Law 508-II art. 6 p. 2: ads in Kazakh, optionally also Russian/others, **except** periodicals, **internet resources**, news agencies (text current at 2026-05-17, DOCUMENTED) [5] | Not checked per country (gap). Official routes: IAP / @PremiumBot [25] |
| Belarus | No 2026 figure found | Native 70.2 % (2009) | CPM €1.45 → €1.04, CTR ~0.49 % (Aug 2026, CLAIMED) [2]; 1,116 creatives [9] | Law 225-З art. 10: ads in Belarusian and/or Russian (pointer, law text not opened) [P14] | gap |
| Uzbekistan | "About 25 M" (2026 studies, source not named, CLAIMED) [2] | Native 2.1 % (2021); CIA estimate 14.2 % cited | CPM €0.10 → €0.16 over 10 months, spend 3.3x (CLAIMED) [2]; 11,764 creatives [9] | gap | gap |
| Kyrgyzstan | gap | 49.5 % (2022) | 190 creatives [9] | gap | gap |
| Moldova | gap | Native 9.7 % (2014) | 268 creatives [9] | gap | gap |
| Armenia | 32 % of internet users "mention" Telegram (CB 2024, fieldwork 2024-07-27..10-10, MEASURED) [7] | 65.3 % (2022) | 466 creatives [9] | gap | gap |
| Georgia | 7 % of internet users (CB 2024, fieldwork 2024-04-16..05-13, MEASURED) [8] | 87.0 % (2019) | 597 creatives [9] | gap | gap |
| Azerbaijan | gap | 6.7 % fluent (2019) | 951 creatives [9] | gap | gap |
| Israel | gap | Native 15 % (2011) | 822 creatives [9] | gap | gap |
| Germany | gap; "Telegram, Signal, Threema 5 % daily" (t3n, study year unclear) [P50] | Native 2.3 % (2024) | 10,635 creatives [9] (language of these creatives not split) | EU rules (see 06) | gap |
| Latvia / Lithuania / Estonia | gap | 76.2 % (2024) / 67.4 % (2021) / 66.6 % (2021) | 102 / 9 / 15 creatives [9] | EU rules (see 06) | gap |
| Ukraine | 67 % "more or less active" users (Rating, 2026-02-26..28, n = 1000, phone, MOE ≤ 3.1 %, MEASURED); 76 % oppose a full ban [11] | Total 68 % (2006), native 29.6 % (2001) — pre-war data | 6,139 creatives [9] | Language law (2019): consumer service in Ukrainian; software sold in Ukraine: interface in Ukrainian and/or English/EU languages; "electronic advertising" in the state language (2019 bill text via mind.ua, enacted text not reachable, CLAIMED) [12] | gap |

**Method of the creative counts [9]:** the classifier counts sponsored creatives (489,570 in total) whose target
country is confirmed by the creative itself: landing ccTLD, writing script, a flag, or unambiguous language. The
page says this measures whom advertisers target, not where ads were seen. An observer-location method was
withdrawn on 2026-06-03. Snapshot 2026-10-30 16:12 UTC. Label: **MEASURED (third party, method stated)** as a
proxy for advertiser activity, not audience.

**Ukraine — own Telegram rules (facts only).** Since Sept 2024, civil servants and military personnel may not use
Telegram on duty. It is not usable in government agencies, military formations or critical infrastructure, and
the Verkhovna Rada restricted it for its staff [11]. A platform-regulation bill (No. 11115) was reportedly backed
by a Rada committee on 2026-03-25 for first reading. It provides for sanctions up to restricting platform use by
state bodies and banks (pointer, not opened) [P13]. No enacted 2026 Ukrainian ban on Russian-language Telegram
content was found.

**Telegram Ads location targeting.** ads.telegram.org describes only channel selection ("You can define specific
channels…") and states that private chats and contact lists are not used for targeting [40]. getting-started:
ads run "in public channels with 1000+ subscribers"; minimum CPM 0.1 Toncoin [41]. **DOCUMENTED.** Third-party
sources disagree on the rest. One glossary says language, not geo, is the native axis and geo is inferred
[44]. A pricing wiki quotes reseller EUR floors of "€0.60 for country or language" targeting [43]. That implies
country targeting exists in reseller EUR accounts (CLAIMED). Whether the self-serve Gram account offers country
targeting was not confirmed from an official page (gap).

**"Russian-language, not Russia-targeted" — INTERPRETATION, not legal advice.**
- 38-FZ is listed in the edition with amendments up to 283-ФЗ of 2026-08-04. Art. 2 is titled "Сфера применения"
  (scope); its text was not on the page read [15].
- RKN letter 2025-02-20 N 03-72707: RKN accounts internet ads "направленную на привлечение внимания потребителей
  рекламы, находящихся на территории Российской Федерации" (aimed at drawing the attention of ad consumers
  located in Russia). Ads not so aimed are outside its accounting. The letter gives no criteria for "aimed" and
  refers to Government criteria [16]. **DOCUMENTED (regulator letter).**
- A 2023 FAS regional-office presentation reportedly says an ad is distributed in Russia if placed on .RU/.РФ
  "а также на русскоязычных страницах сайтов" (and also on Russian-language pages of sites) (pointer; PDF refused
  connection) [P15b].
- Reading: geo-targeting to KZ/UZ/BY lowers the "aimed at Russia" signal. A Russian-language creative pointing
  to a bot that Russian users can open keeps it. Kazakhstan's law exempts internet resources from the Kazakh-first
  language rule [5], so Russian-only creatives are not barred there by that article. Ukraine's language rules make
  a Russian-only consumer product or ad non-compliant there (2019 text, CLAIMED) [12].

### 2. How Russian users reach Telegram in 2026, and what that does to a Mini App

- **Reach (MEASURED, survey):** Levada, 18-26 Mar 2026: 49 % read Telegram channels (20 % daily or more, 14 %
  almost daily, 15 % weekly), against 53 % in Mar 2025. Telegram channels are the primary news source for 25 %.
  Sample not stated in the article [19].
- **VPN share:** Russian Field (Apr 2026): 40 % active VPN users, > 50 % among 18-45, 74 % aware (via CEIP
  2026-07-01, sample not stated) [18]. Other 2026 polls: 36 % (Extreme Scan, Feb) and 52 % (ppc.world, Jun,
  n = 1200, 18-65) [P18b]. VPN downloads from Google Play in Mar 2026: 9.2 M, 14x year on year (Digital Budget via
  Kommersant via Meduza) [P18c]. RKN target: 92 % VPN-blocking effectiveness by 2030. VLESS + XTLS/REALITY is
  reportedly not yet handled [18]. **CLAIMED / MEASURED-by-press.**
- **Transport (MEASURED):** OONI found Telegram reachable in 11 % of measurements in Russia on 2026-04-16. In a
  Meduza poll (method not stated), ~6 % said it worked without VPN or proxy and > 60 % only with one [20].
- **Mobile whitelists:** in H1 2026, > 60 % of Russian mobile sessions ran under restrictions. In July 2026 only
  30.5 % of sessions in the Central Federal District were unrestricted; Moscow region ~49 %, Bryansk/Kursk/
  Belgorod 12 %. The whitelist held "several hundred resources" in early Aug 2026, and inclusion requires servers
  in Russia (Vigo via Kommersant via iGuides, 2026-08-05) [21]. **MEASURED (Vigo) as reported by press.**
- **Cloudflare:** since 2025-06-09, Russian ISPs (Rostelecom, Megafon, Vimpelcom, MTS, MGTS) throttle connections
  to Cloudflare-protected sites to ~16 KB across HTTP/1.1, HTTP/2 and HTTP/3 (Cloudflare blog 2025-06-26; content
  read via search extract) [22]. Whether this still holds in 2026-10 was not checked (gap).
- **What this does to a Mini App (INTERPRETATION from the facts above).** A Mini App is a web page served from
  the developer's URL inside Telegram's WebView (core.telegram.org/bots/webapps; project baseline, not re-opened
  in this pass). Its requests go to our origin, not to Telegram's IPs. Three cases follow:
  - With a full-device VPN, our origin loads through the VPN and pays its latency.
  - With Telegram's in-app MTProto/SOCKS proxy, no source says WebView traffic is proxied. Telegram Desktop code
    contains an unreleased "WEB Proxy" that uses the WebView as the proxy transport. The source does not say
    whether Mini App content uses it [23].
  - In whitelist mode, a non-whitelisted origin, or any foreign-hosted one, is unreachable without a VPN [21].
    Cloudflare-fronted assets risk the 16 KB cap [22].
  No measured latency or load-failure data for Mini Apps in Russia was found (gap).
- **Stars from Russia:** Telegram documents only "standard Apple and Google in-app purchases" and @PremiumBot,
  with no country list, and notes that prices vary by VAT and fees [25]. **DOCUMENTED.** Per a 2026 practitioner
  guide (CLAIMED, it promotes a marketplace), Russian cards are "либо вообще не принимаются" (not accepted at
  all) for most users, and IAP is not a stable option. Fragment (TON/Gram, KYC) is "самый стабильный и
  официальный вариант" (the most stable and official option). Grey offers such as "1000 Stars за 500 рублей"
  circulate [24]. No measured data on how Russian payers actually acquire Stars was found (gap).
- **Russian monthly audience recap (not re-researched):** Mediascope Telegram MAU 80.9 M in May and 75.7 M in
  June 2026; MAX 86 M in May and 86.3 M in June [31]. A Telegram DAU of 33.8 M in Aug-Sep 2026 (-33 % vs April) is
  reported via Expert (pointer) [P31b].

### 3. MAX (VK's national messenger) and VK Mini Apps / Games

**MAX mini-app platform (DOCUMENTED, dev.max.ru, undated pages read 2026-10-31).**
- Mini apps are "веб-сайты и программы, которые можно запустить прямо в MAX" (websites and programs launched
  inside MAX), built in HTML/JS/CSS with the MAX Bridge library [26].
- **Who may publish:** "доступно для юрлиц, ИП и самозанятых, которые являются резидентами РФ" (available to
  Russian-resident legal entities, sole proprietors and the self-employed). The service "должен соответствовать
  законам Российской Федерации" (must comply with Russian law). Bots go through moderation [26]. Earlier,
  narrower rule (Habr, 2025-09-28, info as of 2025-09-24, CLAIMED): only verified Russian legal entities;
  "ИП, самозанятые, физлица и нерезиденты сейчас не допускаются" (sole proprietors, self-employed, individuals
  and non-residents not admitted for now). Moderation and verification take up to 48 business hours. A user
  agreement, privacy policy, operator details and a support channel are required in the UI [29]. Per bfm.ru
  (pointer), companies must have their apps in RuStore [P29b].
- **Bridge:** script `https://st.max.ru/js/max-web-app.js` → `window.WebApp` with `initData`, `initDataUnsafe`
  ("must not be used for validation"), `platform` (ios/android/desktop/web), `BackButton`, `DeviceStorage`,
  `SecureStorage` (10 keys; neither storage works on web), `openLink`, `openMaxLink`, `shareContent`,
  `shareMaxContent`, `HapticFeedback`, `BiometricManager`, `enableClosingConfirmation` and
  `requestScreenMaxBrightness`. The page documents no general event system and no payments method. The docs
  suggest treating `auth_date` as stale after ~1 h [27].
- **initData validation:** secret = "HMAC-SHA256('WebAppData', BOT_TOKEN)". The check string is sorted
  `key=value` pairs joined by `\n` without `hash`, HMAC-SHA256 → hex, compared with `hash`. The page documents no
  freshness rule [28]. This is the same construction as Telegram's (principle 3).
- **Payments:** none in the bridge [27]. Providers sell acquiring for MAX bots: Robokassa sends a payment link in
  the chat, fees from 1.8 %/2.9 %, cards, SBP, SberPay and T-Pay, open to sole proprietors, legal entities and
  the self-employed (vendor page, CLAIMED) [30]. NSPK plans an SBP payment mini app in MAX (Vedomosti
  2026-06-04, pointer) [P30b]. No platform commission on mini-app payments was found (gap).
- **Audience:** Mediascope MAU 86.3 M in June 2026 (first time above Telegram) [31]. "125 M installs, DAU > 85 M"
  (business blog 2026-07-10, CLAIMED) [33]. In Oct 2025: DAU 18.9 M and MAU 48 M. Three quarters of its channels
  were state-created (MaxStat via Kommersant via 3DNews, 2025-12-13) [32]. Growth is attributed to installs
  required in schools, universities and state bodies (press, CLAIMED) [P31c].
- **Distribution:** Apple removed MAX from the App Store on 2026-06-03, citing sanctions. It was later removed
  from Google Play. Cloudflare flagged MAX's domain as spyware about a month earlier [31]. On Android, installs
  continue via RuStore and other stores; on iPhone, via web.max.ru (pointer) [P34]. Outside Russia, CIS
  registration opened in Nov 2025, with "40 countries" and ~7 M foreign users, 90 % CIS (TASS, pointer) [P47].
- **Can our client run there?** Technically, the bridge offers a WebView with initData, BackButton and storage.
  No source states WebGL/Pixi support or WebView engine versions (gap). Legally, publishing needs a
  Russian-resident entity [26].

**VK Mini Apps / Games (DOCUMENTED, dev.vk.ru, rules edition 2026-03-17).**
- Developer = "физическое или юридическое лицо" (an individual or legal entity); foreign persons are not
  addressed [35].
- Auth: non-game apps "должно авторизовывать Пользователей по параметрам запуска и валидировать подпись"
  (must authorize users by launch parameters and validate the signature) (1.2.2). Games may not require separate
  registration or login through third-party networks (4.2.3) [35].
- Payments: virtual goods only for VK votes (5.2.1). Money payment methods are barred (5.2.5). Games may use only
  votes, rewarded ads, interstitial ads and banners (4.2.2). Progress blockers must regenerate on their own
  (4.2.8). Minimum playtime > 10 min (4.2.7). Age restrictions must be shown at first launch (2.1.5). Erotica is
  banned (2.5.5) [35]. One-time and subscription (7/30/90-day) charges are supported in votes or OK. Payout
  terms depend on legal form and tax residency [36].
- Commission: not stated on the pages read. Historical figures: 45 % (votes, from 2021-07-07; VK said it was "not
  final") [38]; developers got 55 % (2019) [39]. Current figure is a gap.
- Moderation: at least 3 days. The request must confirm VK Bridge use and describe the audience. Apps can be
  removed after 30 days of inactivity or of unanswered reports [37].

**Conflicts with project principles (facts, not decisions).**
- Principle 2 (Stars only): VK requires votes for virtual goods [35]. MAX has no Stars, and its known payment
  path is RUB acquiring [30].
- Principle 3 (initData auth): MAX's scheme is the same construction, with its own bot token [28]. VK requires
  launch-parameter signature validation, a different format [35]. Either means a second auth adapter.
- Principle 6 (thin Telegram layer): a second bridge (`max-web-app.js` or VK Bridge) means a second client
  platform module. MAX's `initDataUnsafe` warning mirrors Telegram's [27].
- Jurisdiction (Q21): MAX requires a Russian resident [26]. VK pays out by legal form and tax residency [36].

### 4. English-first inside Telegram

- **Scale:** "significantly over" 1 B MAU (Durov, 2025-03-19 via TechCrunch, company claim, pointer) [P45]. India
  leads downloads (> 100 M installs in 2024, aggregator, CLAIMED) [P49]. No audited per-country user counts exist.
- **Advertiser activity by country (proxy, [9]):** India 58,191; Indonesia 21,247; Brazil 4,291; US 1,176;
  Philippines 77 creatives.
- **Female 13-34 audience for romance:** no per-country Telegram gender/age data was found. Aggregators put women
  at ~38-42 % of Telegram users globally (Statista and Similarweb-based, paywalled or unsourced, CLAIMED) [P49].
  Telegram's own minimum age is 18 in the EU, UK and Australia (see 06 [39]). Mobile interactive-story apps
  (Chapters, Episode) earn ~$220-260 K/week in the US (Sensor Tower Q2 2025, pointer) [P48]. That is a market for
  the genre, not Telegram evidence.
- **English romance / webnovel communities on Telegram:** none with verified size found. Search results were SEO
  listicles. The one sized community was a general "E-BOOKS FORUM" (~18 K, Hive Index, undated). Several book
  channels distribute pirated ebooks (CLAIMED) [P51].
- **CPM:** official floor 0.1 Toncoin (= Gram) [41]. Reseller EUR floors: from 2026-08-28, €0.15 for
  channels/bots/search and €0.20 for user targeting. The average market CPM was ~€0.49 in June 2026 (Netpeak via
  Spilno, CLAIMED) [42]. Euro-cabinet floors for advertisers from Russia: €0.70 (2026-02-17) and €0.30-0.75 by
  targeting (2026-08-28). Click.ru first top-up €250. A Gram account works with ~20 Gram (practitioners)
  (aggregated, CLAIMED) [43]. Unsourced geo multipliers: US/UK 1.3-1.5x, SEA/India 0.5-0.9x, CIS 0.6-0.9x
  against a DE/FR/IT baseline [43]. Russia (SA Media): CPM €1.64 → €0.97 and CPC €0.33 → €0.12, Jan → Aug 2026
  (CLAIMED) [17]. No observed English-only CPM (gap).

## Channel rows (for the synthesis table)

| Channel | Cost (with currency, date, label) | Effort | Fit for a Russian-first romance VN for girls in a TMA | Evidence quality | Notes |
|---|---|---|---|---|---|
| Telegram Ads → Kazakhstan (RU-language) | CPM ~€0.93 (Aug 2026, CLAIMED) [2]; floor 0.1 Gram [41] | Low-med (reseller or Gram account) | Medium: 84 % Russian-capable [6]; KZ law exempts internet resources from Kazakh-first [5]; stable Telegram except a 2026-08-13 outage [4] | B | Russia-spill risk (INTERPRETATION) [16] |
| Telegram Ads → Belarus | CPM ~€1.04, CTR ~0.49 % (Aug 2026, CLAIMED) [2] | Low-med | Medium: Russian an official ad language [P14]; no Telegram size figure | B/C | Low CTR reported |
| Telegram Ads → Uzbekistan | CPM €0.16 (CLAIMED) [2] | Low-med | Low-med: large Telegram base (~25 M CLAIMED) but native Russian 2.1 % [6] | B/C | Cheapest CIS CPM; language fit weak |
| Telegram Ads → Kyrgyzstan / Moldova / Armenia / Georgia / Azerbaijan | No CPM found | Low-med | Low: small (Armenia 32 %, Georgia 7 % of internet users on Telegram [7][8]) | C | Little advertiser activity (190-951 creatives [9]) |
| Telegram Ads → Israel / Germany / Baltics (RU diaspora) | No CPM found; EU baseline multiplier 1.0x (unsourced) [43] | Med (EU consumer rules, 18+ Telegram age in EU) | Low-med: RU speakers 15 % IL, 2.3 % DE, 67-76 % Baltics [6] | C | EU CPC/DFA (area 06) |
| Ukraine | — | High (political, legal) | Conflict: Ukrainian-language consumer/ad rules (CLAIMED) [12]; state restrictions on Telegram [11] | B | Russian-first product promoted there is politically sensitive |
| Russia via Telegram (VPN users) | Ads un-fined to 2026-12-31 (see 06); CPM €0.97 (Aug 2026, CLAIMED) [17] | Med | Audience exists (49 % read channels, Mar 2026 [19]); Stars purchase friction [24]; our origin hit by whitelists / CF throttling [21][22] | A/B | Hosting choice matters |
| MAX mini app | Acquiring 1.8-2.9 %+ (CLAIMED) [30]; platform fee unknown | High (second platform, RU entity, RUB payments) | Large audience (86.3 M MAU [31]); conflicts with principles 2/3/6 | A (docs) / B | iOS app removed from App Store [31] |
| VK Mini Apps / Games | Votes; commission unknown now (45 % in 2021) [38] | High (VK Bridge, votes, moderation ≥ 3 days) | Large female-skewed audience (04); votes-only, launch-param auth, erotica ban [35] | A (rules) | Collides with Stars-only |
| Telegram Ads → English (India/Indonesia/Brazil/US/Philippines) | Floors €0.15-0.20 (reseller, CLAIMED); avg ~€0.49 (Jun 2026) [42] | Med (EN content, EN creatives) | Unknown: no female 13-34 data; no EN romance community found | C | Biggest advertiser activity in India/Indonesia [9] |

## Applicability to tg-app-novel

- **Invite link / attribution (M10/M11):** `start_param` is the only cross-market attribution source. To compare
  KZ vs RU vs EN campaigns, the synthesis may want per-campaign `startapp` codes. That is a product ask, not
  designed here. MAX's initData also carries `start_param` [27].
- **Locales (principle 8):** English tables already exist (lane L3c). Kazakh, Uzbek and Ukrainian are not needed
  for KZ ads to internet resources [5]. They would be needed for Ukraine-compliant consumer service [12]
  (CLAIMED).
- **Delivery (R2/Worker, principle 4):** the Russian whitelist and Cloudflare-throttling facts [21][22] bear on
  where the origin and paid assets are hosted if Russian VPN-less users are a target. This is an architect/owner
  input (Q21).
- **Stars pricing (Q3):** Russian payers may hold Stars bought through grey resellers [24]. No data on refund or
  dispute behaviour of such Stars was found.
- **MAX/VK port (feature ask, not designed):** a second platform adapter (bridge, auth, payments in RUB or votes)
  plus a Russian legal entity. MAX's auth is structurally Telegram's [28].

## Pitfalls / what goes wrong (sourced)

- Treating aggregator "Telegram users by country" as data: sources disagree 2x and call themselves estimates [P49].
- Treating Telegram Ads geo as exact: one source says targeting is by channel language, with geo inferred [44].
  An observer-location dataset was withdrawn as unreliable on 2026-06-03 [9].
- VPN use blurs geotargeting (ppc.world, 2026-09-15) [17]. Russian VPN users can appear as foreign.
- Kazakhstan Telegram outage of 2026-08-13 with traffic loss at Moscow/Frankfurt peering points [4]. Transit
  through Russia can affect neighbours (INTERPRETATION).
- MAX distribution is fragile: removed from the App Store (sanctions) and then Google Play in mid-2026 [31].
- VK rules: progress blockers must regenerate (4.2.8). A hint economy sold only for currency may need review
  under it (INTERPRETATION) [35].

## Key claims for verification

1. MAX publishing is limited to Russian-resident legal entities, sole proprietors and self-employed —
   https://dev.max.ru/docs — DOCUMENTED.
2. MAX initData secret = HMAC-SHA256('WebAppData', BOT_TOKEN), hex compare — https://dev.max.ru/docs/webapps/validation — DOCUMENTED.
3. VK: virtual goods only for votes; money methods barred (5.2.1/5.2.5), edition 2026-03-17 —
   https://dev.vk.ru/ru/mini-apps-rules — DOCUMENTED.
4. Mediascope June 2026: MAX MAU 86.3 M, Telegram 75.7 M; MAX removed from App Store 2026-06-03 —
   https://verstka.media/messendzher-max-vpervye-operedil-telegram-po-mesyachnoj-auditorii-v-rossii-mediascope — DOCUMENTED-by-press.
5. KZ Law 508-II art. 6 p. 2 exempts internet resources from the Kazakh-first language rule (text at 2026-05-17) —
   https://prg.kz/m/amp/document/1045608 — DOCUMENTED.
6. RKN letter 03-72707 (2025-02-20): ads not aimed at consumers in Russia are outside ERIR accounting —
   https://buhexpert8.ru/npa/pismo-roskomnadzora-ot-20-02-2025-n-03-72707.html — DOCUMENTED (secondary host).
7. Telegram Ads CPM KZ €0.93 / BY €1.04 / UZ €0.16 (Aug 2026) — https://workspace.ru/blog/telegram-reklama-v-sng-tri-scenariya-rosta-rynka/ — CLAIMED.
8. Reseller EUR CPM floors €0.15 (channels/bots/search), €0.20 (users) from 2026-08-28 —
   https://spilnoagency.com.ua/en/news-en/telegram-ads-cpm-cut-target-channels — CLAIMED.
9. Minimum CPM 0.1 Toncoin — https://ads.telegram.org/getting-started — DOCUMENTED.
10. > 60 % of Russian mobile sessions restricted in H1 2026; whitelist needs Russian servers —
    https://www.iguides.ru/main/other/svobodnyy_internet_v_rf_pochti_polnostyu_vytesnen_belym_spiskom_saytov/ — MEASURED-by-press.
11. Levada Mar 2026: 49 % read Telegram channels — https://meduza.io/en/news/2026/04/08/49-of-russians-still-read-telegram-channels-despite-blocking-levada-poll-finds — MEASURED.
12. Ukraine: 67 % active Telegram users; 76 % oppose a ban (Rating, Feb 2026, n = 1000) —
    https://babel.ua/en/news/125300-poll-most-ukrainians-are-against-a-complete-ban-on-telegram — MEASURED.
13. Armenia 32 % / Georgia 7 % of internet users use Telegram (CB 2024) —
    https://caucasusbarometer.org/en/cb2024am/APPTEL/ , https://caucasusbarometer.org/en/cb2024ge/APPTEL/ — MEASURED.
14. Stars acquired via Apple/Google IAP and @PremiumBot (no country list) — https://core.telegram.org/bots/payments-stars — DOCUMENTED.
15. Cloudflare throttled to 16 KB by Russian ISPs since 2025-06-09 — https://blog.cloudflare.com/russian-internet-users-are-unable-to-access-the-open-internet/ — DOCUMENTED (vendor), status in 2026-10 unchecked.

## Gaps (asked but no reliable source found)

- Telegram users per country for KZ, BY, KG, MD, AZ, IL, DE, Baltics in 2026 (no measurer publishes them).
- Whether self-serve (Gram) Telegram Ads offers country/location targeting. Official pages mention channels only.
- Whether users in each CIS country can buy Stars via IAP (per-country availability not documented).
- Whether Mini App WebView traffic goes through Telegram's in-app proxy. No measured Mini App latency or failure
  data for Russia.
- MAX: platform commission, a payments API for mini apps, WebView engine / WebGL support, the full rules text.
- VK: current votes commission (2026), the withdrawal page (404), the rules on foreign developers.
- Ad-law basics for Uzbekistan, Kyrgyzstan, Moldova, Armenia, Georgia, Azerbaijan, Israel. Enacted text of
  Ukraine's language law (site refused connection). Belarus law text not opened.
- Per-country female 13-34 Telegram audiences. Observed English-only CPM. Sized English romance communities on
  Telegram.

## Owner value questions this area raises (each with a default reading)

- **OWNER: Is the CIS (KZ/BY/UZ) a target market, or only Russia?** Default reading: Russia remains primary, and
  KZ/BY are a low-cost test geo for Russian-language creatives.
- **OWNER: Is a Russian-resident legal entity on the table (Q21)?** It is required for MAX [26]. Default reading:
  undecided; no MAX/VK work until Q21 is answered.
- **OWNER: Is Ukraine excluded from targeting?** Default reading: excluded, given the language rules and the
  political sensitivity [11][12].
- **OWNER: Is the English market a launch market or later?** Default reading: later. English tables exist, but no
  audience evidence was found.

## Sources

[1] https://datareportal.com/reports/digital-2026-kazakhstan — DataReportal Digital 2026 Kazakhstan, data Oct 2025, read 2026-10-31; no Telegram section.
[2] https://workspace.ru/blog/telegram-reklama-v-sng-tri-scenariya-rosta-rynka/ — workspace.ru blog, undated (data to Aug 2026), cites Magnetto.pro; CLAIMED.
[P3] kapital.kz (Durov "12.5 M in Kazakhstan") — pointer seen in search extract, undated, not opened.
[4] https://www.anti-malware.ru/news/2026-08-13-1447/51035 — Anti-Malware.ru, 2026-08-13; KZ Telegram outage.
[5] https://prg.kz/m/amp/document/1045608 — Law RK 508-II "On advertising", text current at 2026-05-17; legal database.
[6] https://en.wikipedia.org/wiki/Geographical_distribution_of_Russian_speakers — tables with mixed census years; read 2026-10-31 (first 100k chars).
[7] https://caucasusbarometer.org/en/cb2024am/APPTEL/ — CRRC Caucasus Barometer 2024 Armenia; survey.
[8] https://caucasusbarometer.org/en/cb2024ge/APPTEL/ — CRRC Caucasus Barometer 2024 Georgia; survey.
[9] https://telegramads.it/geos (same data at https://tgmetrics.org/geos) — creatives per confirmed target country, snapshot 2026-10-30; method stated.
[11] https://babel.ua/en/news/125300-poll-most-ukrainians-are-against-a-complete-ban-on-telegram — Babel, 2026-03-03, Rating poll 2026-02-26..28, n = 1000.
[12] https://mind.ua/news/amp/20196512-kompaniyam-dovedetsya-perekladati-sajti-ukrayinskoyu — Mind.ua, 2019-04-25; summary of the language law as passed.
[P13] https://espreso.tv/suspilstvo-komitet-vr-pidtrimav-zakonoproekt-pro-regulyuvannya-diyalnosti-telegram-v-ukraini — bill 11115 committee support 2026-03-25; pointer.
[P14] https://ilex.by/news/mart-otvechaet-na-aktualnye-voprosy-o-reklame/ — Belarus ad law art. 10 language; pointer.
[15] https://www.consultant.ru/document/cons_doc_LAW_58968/ — 38-FZ, amendments to 283-ФЗ of 2026-08-04; art. 2 text not shown.
[P15b] https://mordovia.fas.gov.ru/sites/mordovia.f.isfb.ru/files/news/2023/10/13/es-r-internet-reklama-13_10_23.pdf — FAS regional presentation 2023; connection refused; pointer.
[16] https://buhexpert8.ru/npa/pismo-roskomnadzora-ot-20-02-2025-n-03-72707.html — RKN letter 2025-02-20 N 03-72707 (secondary host).
[17] https://ppc.world/articles/reklama-v-telegram-v-2026-godu-benchmarki-i-stoit-li-zapuskat-kampanii-seychas/amp/ — ppc.world, 2026-09-15; SA Media benchmarks; CLAIMED.
[18] https://m.ceip.org/russia-eurasia/politika/2026/05/russia-vpn-usage-political — Carnegie Politika, 2026-07-01; Russian Field poll.
[P18b] https://ppc.world/news/bolshe-poloviny-rossiyan-polzuyutsya-vpn-tolko-10-gotovy-ot-nego-otkazatsya-issledovanie/ — 52 % VPN poll; pointer.
[P18c] https://meduza.io/en/news/2026/04/28/kommersant-reports-russian-users-downloaded-vpn-apps-9-2-million-times-in-march-14-times-more-than-a-year-earlier — pointer.
[19] https://meduza.io/en/news/2026/04/08/49-of-russians-still-read-telegram-channels-despite-blocking-levada-poll-finds — Meduza, 2026-04-08; Levada poll.
[20] https://meduza.io/amp/en/news/2026/04/17/report-telegram-works-without-a-vpn-for-some-users-in-russia-but-reason-is-unknown — Meduza, 2026-04-17; OONI 11 %.
[21] https://www.iguides.ru/main/other/svobodnyy_internet_v_rf_pochti_polnostyu_vytesnen_belym_spiskom_saytov/ — iGuides, 2026-08-05; Vigo via Kommersant.
[22] https://blog.cloudflare.com/russian-internet-users-are-unable-to-access-the-open-internet/ — Cloudflare, 2025-06-26; read via search extract.
[23] https://kod.ru/telegram-web-proxy-webview/amp — Kod.ru, 2026-08-22; Telegram Desktop "WEB Proxy" code finding.
[24] https://dtf.ru/howto/5086579-kak-kupit-telegram-stars-iz-rossii — DTF guide, "27 мая" (2026 per title); promotes a marketplace; CLAIMED.
[25] https://core.telegram.org/bots/payments-stars — Telegram, read 2026-10-31; the contract.
[26] https://dev.max.ru/docs — MAX developer docs, read 2026-10-31.
[27] https://dev.max.ru/docs/webapps/bridge — MAX Bridge reference, read 2026-10-31.
[28] https://dev.max.ru/docs/webapps/validation — MAX initData validation, read 2026-10-31.
[29] https://habr.com/en/articles/951326 — Habr, 2025-09-28 (as of 2025-09-24); MAX onboarding.
[P29b] https://www.bfm.ru/news/587719 — MAX mini apps since Oct 2025, RuStore condition; pointer.
[30] https://robokassa.com/payments/instrumenty-oplaty/bot-max/ — Robokassa vendor page, read 2026-10-31; CLAIMED.
[P30b] https://www.vedomosti.ru/technologies/industries_and_markets/news/2026/06/04/1203249-nspk-max-platezhnoe-prilozhenie — pointer.
[31] https://verstka.media/messendzher-max-vpervye-operedil-telegram-po-mesyachnoj-auditorii-v-rossii-mediascope — Verstka, 2026-07-21; Mediascope data; App Store removal.
[P31b] https://techora.ru/news/auditoriya-telegram-v-rf-upala-na-2026-09-18 — Telegram DAU 33.8 M; pointer (page blocked by a bot check).
[P31c] Mediascope/expert.ru coverage of MAX growth drivers — pointer.
[32] https://3dnews.ru/1133879 — 3DNews, 2025-12-13; MaxStat via Kommersant.
[33] https://www.sostav.ru/blogs/292093/95285 — Sostav blog, 2026-07-10; CLAIMED.
[P34] https://www.iphones.ru/iNotes/prilozhenie-max-udaleno-iz-app-store — install routes after removal; pointer.
[35] https://dev.vk.ru/ru/mini-apps-rules — VK mini-app rules, edition 2026-03-17.
[36] https://dev.vk.ru/ru/mini-apps/monetization/payments — VK payments page, read 2026-10-31.
[37] https://dev.vk.ru/en/mini-apps/catalog/moderation — VK moderation page, read 2026-10-31.
[38] https://kod.ru/vkontakte-mini-apps-golos/ — Kod.ru, 2021-07-21; 45 % votes commission.
[39] https://m.vk.ru/@brown_room-vkminiapps-vkgames — The Brown Room, 2019-11-02; 55/45 split.
[40] https://ads.telegram.org/ — Telegram Ads landing, read 2026-10-31 (currency "Gram").
[41] https://ads.telegram.org/getting-started — Telegram Ads getting started, read 2026-10-31 (0.1 Toncoin floor).
[42] https://spilnoagency.com.ua/en/news-en/telegram-ads-cpm-cut-target-channels — Spilno, 2026-08-28; Netpeak reseller; CLAIMED.
[43] https://telegramadsanalytics.com/wiki/telegram-ads-pricing-guide — aggregator wiki, updated 2026-09-23; CLAIMED.
[44] https://telegramads.it/info/geo-targeting — Telegram Ads Spy glossary, undated; CLAIMED.
[P45] https://techcrunch.com/2025/03/19/telegram-founder-pavel-durov-says-app-now-has-1b-users-calls-whatsapp-a-cheap-watered-down-imitation — pointer.
[P46] https://coinmarketcap.com/academy/article/toncoin-rebrands-to-gram — Toncoin → Gram 2026-06-15; pointer.
[P47] https://tass.com/economy/2118263/amp — 7 M foreign MAX users; pointer.
[P48] https://sensortower.com/blog/2025-q2-unified-top-5-interactive%20story%20games-revenue-us-6019ed6a241bc16eb869f511 — pointer.
[P49] https://countly.net/how-many-telegram-users-are-there-in-2026-global-by-country — aggregator estimates; pointer.
[P50] https://t3n.de/news/ard-zdf-medienstudie-2026-ki-nutzung-1765059/ — "5 % daily" Telegram/Signal/Threema in Germany; pointer.
[P51] https://thehiveindex.com/communities/e-books-forum/ — general books Telegram community; pointer.
