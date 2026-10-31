# Promotion research 09: gap-fill G2 — paying from Russia, where the audience gathers, minors, network reach, VK/Yandex landings
Date 2026-10-31. Sources read: 47 pages opened, plus search-result pointers that are marked as such. Freshness notes:
- Bot API 10.3 (2026-08-24) is the latest changelog entry. 10.1-10.3 contain nothing on Stars purchase routes, regions
  or age [1].
- The Telegram ToS pages (Stars ToS, third-party payments, main ToS) show no edition date; they were read 2026-10-31.
- Civil Code part 1: edition of 10.06.2026 with amendments of 22.10.2026 (consultant.ru). 38-FZ: edition of 04.08.2026.
- The Cloudflare service-disruption doc was last updated 2026-04-23. The VK Ads moderation rules are revision 11.03.2026.
- Apple support pages: 125666 published 2026-10-26; 105055 published 2026-09-14.
- Day/month-only dates on vc.ru / dtf.ru are read as 2026 only where the title says 2026; this is flagged where it
  matters.

Scope: K2, W1, W2, W6 and the VK/Yandex half of K3 (C1-completeness-critique.md §3). Excluded per the brief: non-RU
Russian speakers, VPN share, MAX/VK mini apps, the English-first hedge, the FAS 2027 position and the 38-FZ readings (V3).

## TL;DR (decision-relevant)
- **A Russian user has no frictionless official way to buy Stars in 2026. Every route is contradicted or degraded.**
  - **App Store:** the RU storefront lists 209 ₽ per 100 Stars (V1, read 2026-10-31). Russian Apple IDs lost their
    last mass funding route on 2026-04-01, when the big-four carriers stopped mobile-balance top-ups after a
    Mintsifry instruction (press citing RBC) [8][9][10].
  - **Google Play:** billing has been paused for users in Russia since 2022-03-10. Google's developer page still says
    so, with no resumption [6].
  - **@PremiumBot with Russian cards:** contradicted. One tech outlet (updated 2026-10-07) says cards, SBP and SberPay
    work for Premium [12]. SEO guides say Russian cards fail there since 2026-04-01 [13]. The verify pass must check
    this on a real Russian account; it is not settled by reading.
  - **Fragment:** official, but sells only for TON/GRAM, USDT or USDC [5].
  - **Resellers:** paid in rubles via SBP. They deliver Stars to the buyer's @username, reportedly via Fragment's
    "buy for someone" function. Every such article is promotional (CLAIMED) [4][11][14].
- **Reseller routes sit outside the Stars ToS letter.**
  - The Stars ToS forbids selling or transferring Stars from a personal balance (§4) [2].
  - The only "authorized resellers" Telegram names are three Smart Glocal entities [3].
  - Fragment's own terms neither allow nor forbid buying Stars for third parties commercially [17].
  - Telegram may "permanently debit" Stars on refunds or ToS violations [2].
  - INTERPRETATION: Stars that reach a player this way are spendable, but the clawback risk on that balance is not
    zero. No source quantifies it.
- **No source states what share of Russian users can pay. No regional block on *spending* Stars in a bot or Mini App
  was found.**
  - The ToS reserves "additional restrictions in certain jurisdictions" (§2.3) [2].
  - A promotional guide says bots and Mini Apps "work normally" once the user has Stars (CLAIMED) [14].
- **Audience (W1).** The largest measured Russian-language romance-VN community in Telegram is Romance Club's official
  channel: 732,261 subscribers, average post reach 20.1 K (2.7 %). Fan channels:
  - "Подслушано Клуб Романтики" ("Overheard Romance Club"): 80.9 K subscribers, 1.4 K average reach.
  - "Коротко о Клубе Романтики" ("Romance Club in brief"): 56.7 K.
  - "Спойлеры с нами!" ("Spoilers with us!"): 77.2 K.
  - These are aggregator scrapes from Telemetr, read 2026-10-31 [18][19][20].
  - Manga/manhwa channels hold 30-115 K subscribers [21]. Marketplace list prices in anime/manga channels start at
    ≈ 280-840 ₽ per post (CLAIMED, telega.in) [25].
  - No source gives an age or gender split for any of these.
  - Mediascope (2024) puts Telegram's daily reach among Russian 12-17-year-olds at 80.6 %, VK at 64.9 % and TikTok at
    62.2 % (no gender split) [26].
- **Minors (W2), INTERPRETATION.**
  - Civil Code art. 26 lets a 14-17-year-old, without consent, dispose of their own earnings and other income and make
    "мелкие бытовые сделки" (minor everyday transactions). Anything else needs written parental consent, and art. 175
    lets parents (only they) void it in court with restitution [27][28].
  - Apple: in Russia a child account is mandatory under 13. "Ask to Buy" cannot be turned off for an under-18 inside
    Family Sharing [29][30].
  - Telegram's ToS sets a minimum age only for the EU, UK and Australia (18), none for Russia [31].
  - No adopted Russian rule on minors' in-game spending was found. The industry memorandum of 2026-10 (parental
    consent under 14, monthly limits) was seen only as search snippets [33].
- **Network reach (W6).**
  - Cloudflare's own doc (updated 2026-04-23) still says Russian ISPs throttle Cloudflare-fronted sites to ≈ 16 KB per
    connection [35]. Hetzner, DigitalOcean and OVH were reported throttled the same way since 2025-06 [36].
  - Mobile "whitelist" mode restricted > 60 % of Russian mobile sessions in H1 2026. Only 30.5 % of sessions in the
    Central Federal District were unrestricted in July 2026 (Vigo via Kommersant, reported 2026-08-05) [38].
  - Whitelist inclusion requires servers in Russia [38]. A foreign-hosted Mini App is therefore unreachable on mobile
    data in whitelist mode, whatever the hosting provider.
  - Telegram's in-app proxy does **not** carry Mini App WebView traffic on Desktop: tdesktop issue #28692 is open with
    2026 reports, and the fix PR #31166 is unmerged [39]. No source covers iOS/Android. INFERENCE: an MTProto proxy
    carries only MTProto [41], so the WebView fetches our origin directly or via the system VPN.
- **VK Ads / Yandex Direct (K3).**
  - VK Ads moderation rules (rev. 2026-03-11) contain no clause on t.me or messenger landings [44]. They do require:
    - a web page that opens in a browser;
    - no JS/meta redirects and no link shorteners;
    - mobile apps only from Google Play / App Store / RuStore;
    - 18+ targeting only for dating and lotteries;
    - an age label (0+…18+) on information products.
  - Whether VK moderation accepts a t.me bot or Mini App landing in practice was not found (gap).
  - Yandex Direct has supported t.me *channel* landings since 2023-07 [46]. It sells ads inside 18,000+ Telegram
    channels (Yandex press, 2026-01-12) [47]. Bot and Mini App landings were not found.

## Findings

### 1. [K2] Buying Telegram Stars from Russia in 2026

#### 1.1 What Telegram itself documents
- **Purchase routes:**
  - Stars ToS §2: Stars are acquired by in-app purchase in Telegram for iOS and Android, and via @PremiumBot "on the
    direct Android version" and in Telegram Web/Desktop. Telegram "does not process these transactions"; payment
    problems go to the processor. DOCUMENTED [2].
  - §2.2: a third-party purchase (e.g., Apple IAP) puts the billing relationship with that third party. DOCUMENTED [2].
  - §2.3: Stars "may be subject to additional restrictions in certain jurisdictions or for a subset of users". Telegram
    is not liable if local law prevents purchase or use. DOCUMENTED [2].
- **Restrictions and refunds:**
  - §4: "You may not sell, withdraw, transfer or use Stars in your personal balance for any other purpose" than those
    the Terms list (buying digital goods from bots and Mini Apps, paid media, donations, gifts). DOCUMENTED [2].
  - §3: Stars sales are final; Telegram issues no refunds for unwanted purchases. §3.1: disputes go to the bot
    developer via /paysupport. The page also states Telegram may "temporarily withhold or permanently debit Stars …
    in response to refunds of in-app purchases or violation of these Terms" (as returned by search for [2]).
    DOCUMENTED [2].
- **Authorized resellers:**
  - The "Third-Party Payments and Authorized Resellers" page says card purchases outside the app stores may be sold by
    an authorized reseller "in its own name under license from Telegram".
  - It lists exactly three: Smart Glocal Services Limited (Hong Kong), Smart Glocal Limited (UK) and Smart Glocal
    Services Inc. (Delaware).
  - DOCUMENTED [3].
- **Fragment:**
  - The Stars buy page offers top-ups "for yourself or your friends and colleagues" ("Choose recipient").
  - Packs from 50 Stars. 100 Stars = 1.50 / 1.2668 in two unlabelled columns (V1 saw 1.50 / 1.2661 the same day).
  - Payment in GRAM/TON, USDT (ETH, TON, POL) or USDC (ETH, Base, POL); no KYC mentioned.
  - DOCUMENTED [5].
  - Fragment's terms allow gifting *Premium* to others and say the company "may limit which countries it operates in".
    They are silent on buying Stars for others commercially and on resale. DOCUMENTED [17].

#### 1.2 Route by route for a user in Russia

| Route | Status for a Russian account, 2026 | Price | Label / source |
|---|---|---|---|
| App Store (RU storefront) | Listing live. Funding a Russian Apple ID is the problem: since 2022 only carrier billing or gift cards [9]. Carrier billing was switched off 2026-04-01 (Beeline told subscribers all operators; MTS still worked on 2026-03-30) [8][9][10]. A resumed carrier route "with a 110 % markup" (Mash via techora, 2026-08-10) is a search snippet only; the page is behind a bot check. appleinsider.ru (upd. 2026-10-07): Premium "can no longer be paid via App Store" in Russia [12]. | 100 Stars = 209 ₽; 150 = 319 ₽; 250 = 529 ₽; 500 = 1,060 ₽ (V1, 2026-10-31) | Prices DOCUMENTED (store listing via V1). Funding cut CLAIMED-press, consistent across Novaya Gazeta Europe (2026-03-31, 2026-04-01) and Kod Durova (2026-03-30), all citing RBC and anonymous sources; no official Mintsifry text found. |
| Google Play | Billing paused for users in Russia since 2022-03-10. Since 2022-08-02 Google's Payments policy (mandatory Play billing) does not apply to payments from users in Russia. The page shows no resumption [6][7]. | n/a | DOCUMENTED (Google Play Console Help, read 2026-10-31; page undated). The "Google Play ≈ 2-2.5 ₽/Star" in 07:105 has no basis for Russian accounts. INFERENCE: because the policy is lifted, Telegram for Android may show its own card checkout to Russian users. Not verified. |
| @PremiumBot (card, SBP) | **Contradicted.** (a) Kod Durova (2024-08-04, upd. 2025-05-24): @PremiumBot sells Stars in fixed packs for bank cards, Russian cards accepted [11]. (b) appleinsider.ru (2026-04-03, upd. 2026-10-07): Premium payable by bank card, SBP and SberPay "without any restrictions" (Stars not discussed) [12]. (c) dtf.ru/vc.ru guides of 2026: Russian cards fail in @PremiumBot from 2026-04-01, "an acquiring limitation" [13]. (d) On 2026-03-31 Telegram showed Russian numbers an in-app "last chance" Premium offer: "it may become technically impossible to subscribe … in your region" [9]. | (a) 50 Stars = 99 ₽ (1.98 ₽/Star); max 150,000 = 249,000 ₽; min gift 100 = 182 ₽ (2024-25) | (a), (b) CLAIMED-press; (c) CLAIMED-SEO; (d) CLAIMED-press quoting the in-app text. Charges show as "Smart Glocal" / "Bank131" (CLAIMED, search snippet). |
| Fragment (crypto) | Works for anyone holding TON/GRAM or USDT/USDC [5]. Russians get TON through @wallet's P2P market for rubles, or exchange P2P. Sources disagree on whether @wallet takes Russian cards (CLAIMED, search snippets of 2026 guides). One guide says Toncoin was renamed "Gram (GRAM)" in June 2026; the Fragment page does show "GRAM TON" [5]. | 1.50 per 100 in an unlabelled column (V1: ≈ USD, unverified) | DOCUMENTED page; the access path is CLAIMED. |
| Reseller sites/bots ("gift Stars") | Pay in rubles (SBP, Mir); give an @username; Stars are credited "within minutes". Resellers reportedly buy on Fragment for the buyer's username [14]. Guides warn of scams ("1000 Stars for 500 ₽") [14]. | "20-40 % below the store" (vc.ru, 2026-07-29?, promoting telegram-stars.org / @BuyStarsOfficial_bot) [15]. The same article prices the store at ≈ 1.8-2.5 ₽/Star. | CLAIMED, every source promotional (ggsel, Code-Top.Shop, telegram-stars.org) [13][14][15]. |

#### 1.3 Are reseller routes allowed? (INTERPRETATION, not legal advice)
- The ToS text forbids a *holder* selling or transferring Stars from a personal balance (§4) [2]. A reseller that
  sells Stars out of its own balance breaches §4.
- A reseller that buys on Fragment with the end user as recipient uses Fragment's documented "for friends" function
  [5]. The commercial resale of that service is not named in the Stars ToS, the Fragment terms or the
  authorized-reseller page [2][3][17]. Smart Glocal is the only licensed reseller named [3].
- For the bot developer (us), Stars spent in our bot are an ordinary `successful_payment`. Two risks follow from §3/§4:
  - Telegram's right to debit Stars on ToS violations [2].
  - Apple-refund clawbacks.
  - What happens to *our* revenue when Telegram debits Stars the user already spent with us: no source found (gap).

#### 1.4 Share of Russian users able to pay
- No survey, panel or Telegram statement was found (two targeted searches).
- SEO guides assert "the official route is in practice unavailable to most Russians" (CLAIMED, no method) [13].

#### 1.5 Spending in a Mini App
- No regional block on spending Stars in bots or Mini Apps was found in Telegram docs or news.
- One promotional guide states regional problems concern buying only (CLAIMED) [14].
- The ToS reserves the right to restrict per jurisdiction (§2.3) [2].

### 2. [W1] Where Russian-speaking girls and young women who play romance VNs gather (2026)

**Method.**
- Telemetr channel pages read 2026-10-31. "Subscribers" is the aggregator's scrape of Telegram's public counter.
  "Average reach" is Telemetr's views over the last 6 posts. Both are labelled MEASURED-aggregator (method not
  disclosed); the year is inferred from the 25-31 Oct chart window.
- TGStat and VK pages returned 403 or were unfetchable. TGStat figures below come from search snippets only.

| Community | Platform | Size | Activity | Notes / label |
|---|---|---|---|---|
| "Клуб Романтики — Мои Истории" ("Romance Club — My Stories", @official_romanceclub) | Telegram | 732,261 subs [19] | avg reach 20.1 K (2.7 %); 24 h reach 100.4 K; ER 13.7 % | Official Romance Club channel (category Games). No ad posts seen. TGStat snippet shows ≈ 173.3 K, unexplained discrepancy. MEASURED-aggregator. |
| "Подслушано Клуб Романтики" ("Overheard Romance Club", @tgpkr / klubromantiki2) | Telegram | 80,911 [20] | avg reach ≈ 1.4 K (1.7 %); ER 11.3 % | Fan channel that **sells ads** (post of 31 Oct marked "#реклама 16+"); no rates published. MEASURED-aggregator. |
| "Спойлеры с нами!" ("Spoilers with us!") | Telegram | 77.2 K [18] | — | Listed as a similar channel; topic not opened. |
| "Коротко о Клубе Романтики" ("Romance Club in brief", @lediclubromance) | Telegram | 56.7 K [18] | — | Fan news channel. |
| "Romance Club FAN TG" (@RomanceClubFan) | Telegram | 18,148 [18] | avg reach 76 (0.4 %) | Low reach per subscriber. MEASURED-aggregator. |
| "Визуальные новеллы" ("Visual novels", @vizualnovels) | Telegram | 8,428 [22] | avg reach 217 | Promo codes, 18+ content. |
| Romance Club official community | VK | ≈ 1.5 M (2024) | — | Sport24 via search snippet (page 401); 05 report: ≈ 1.4-1.5 M. CLAIMED; vk.com could not be fetched. |
| "Лига Мечтателей" ("League of Dreamers", Story Inc) | app (App Store / RuStore) | — | — | A Russian romance-VN collection app, rated 16+/17+ by store [23]. Telegram/VK community size not found. |
| ШГШ / @gladmedia | Telegram | conflicting: 9,286 (Telemetr, title "ГРЯЗНЫЙ ГЛАДЕНКО", "Dirty Gladenko") vs ≈ 134.6 K (TGStat snippet, title "Школа Романтики — ШГШ x НОВЕЛЛЫ", "Romance School — ShGSh x Novels") | avg reach 18.5 K | Its latest post announces «Цена выбора» ("The Price of Choice"), "the first game from ШГШ, released **first on Telegram**, then iOS/Android" [24]. A youth-media brand shipping a choice game Telegram-first: a direct comparable. Handle/title mismatch unresolved. |
| Manga / manhwa channels | Telegram | LN Manga 114 K; MangaBuff 103.8 K; ReManga 64.8 K; WaManga 40.7 K; a yaoi-manhwa translation channel 39.8 K [21] | — | Manhwa/yaoi readers skew female by reputation; no source states it. |
| Books / fanfiction | Telegram | "Фикбук" ("Ficbook") ≈ 291 K (Telemetr books catalog) [37]; "📚 Любовные романы" ("Romance novels", @newlovebooks) ≈ 43.3 K (search snippet) | — | Ficbook is the main Russian fanfiction site; no audience demographics found (searched). |

- **Age and gender.** No source in this pass states the age or gender skew of any community above.
  - Mediascope (via Sostav/RBC, 2024-06-25) for Russians aged 12-17: Telegram daily reach 80.6 % and 59 min/day; VK
    64.9 % and 21 min; TikTok 62.2 % and 71 min; YouTube ≈ 76 min/day; 65 % play games on smartphones. No gender
    split. MEASURED (panel, measurement period not stated in the article) [26].
- **Ad prices.**
  - telega.in list prices, "from" per post, read 2026-10-31: MangaHD ≈ 28.7 K subs, from 839 ₽; "ЯОЙ МАНГА МАНХВА"
    ("Yaoi Manga Manhwa") ≈ 44.8 K, from 420 ₽, 16+; "Аниме | Anime" ≈ 32.5 K, from 350 ₽; an anime chat (50/50
    gender, per the card), from 280 ₽. CLAIMED-marketplace [25].
  - Romance Club fan channels publish no rates [20].
  - The legality of paying for RU-targeted Telegram placements is V3's question (06: ban in force, liability deferred
    to 2027).

### 3. [W2] Can a 14-17-year-old in Russia buy Stars-priced goods; can parents reverse it? (INTERPRETATION)
- **Civil Code art. 26** (consultant.ru, edition 10.06.2026 with amendments of 22.10.2026) [27]:
  - p. 1: minors aged 14-18 transact "with the written consent" of their legal representatives, except for p. 2
    transactions. A transaction made without consent is valid if later approved in writing.
  - p. 2: without consent they may dispose of their earnings, stipend and other income; exercise IP rights; make bank
    deposits; and make "мелкие бытовые сделки" (minor everyday transactions) and the other transactions of art. 28 p. 2.
  - p. 3: they bear property liability for those transactions.
  - p. 5 (in force 2025-08-01, 178-FZ): a minor may open a bank account with parental consent.
  - DOCUMENTED law text.
- **Art. 175** [28]: a 14-18 transaction made without required consent "may be declared invalid by a court at the
  suit of the parents". The consequences are mutual restitution. Until contested it stands as valid (consultant
  commentary). DOCUMENTED law text plus commentary.
- **Art. 28 (under 14):** small everyday transactions and spending money given for a purpose or for free disposal.
  This comes from secondary summaries in search results; the art. 28 page itself was not opened. Under-14 deals beyond
  that are void (art. 172), per the same summaries.
- **What counts as "minor everyday".** Nothing statutory gives a ruble threshold. A practitioner consultation on
  harant.ru (search snippet) says 10 K and 23 K ₽ transactions are not minor everyday ones (CLAIMED).
  - INTERPRETATION: a single chapter at tens of Stars (tens to low hundreds of ₽ at 1.8-2.1 ₽/Star, §1.2) is the kind
    of amount courts usually treat as minor. A pattern of purchases summing to thousands is less clearly so. The teen
    also first buys the Stars themselves, a separate transaction with Apple, Smart Glocal or a reseller.
- **Court practice.** A Petrograd district court (St Petersburg) refused parents' claim for 445,000 ₽ that their son
  (born 2011) transferred from his father's account to the developer of the game Black Russia in five days of May 2025.
  - This was seen only in a search summary of a finuslugi.ru article; that page refused connection, and a second
    search found no independent report.
  - The same summary says the editors found no decisions in parents' favour for in-game purchases in 2023-2026.
  - CLAIMED, unverified.
- **Bills.** No adopted federal rule on minors' in-game spending was found.
  - 2025-01: Duma vice-speaker Chernyshov asked Mintsifry to require parental approval of children's in-game purchases
    and a parental refund right (RIA via WN Hub, 2025-01-15) [32]. No outcome found.
  - 2026-10-20: the industry body РВИ ("Organisation for the Development of the Video Game Industry") sent a
    memorandum to Duma committee chair Boyarsky (Kommersant, via search snippets). It proposes parental confirmation of
    purchases under 14, monthly age-based limits and a ban on manipulative mechanics [33]. The page was behind a bot
    check, so this is CLAIMED.
- **App stores:**
  - Apple: a child account (Family Sharing, parental consent) is required **under 13** in Russia, which falls under
    "all other countries and regions" (page published 2026-10-26) [29].
  - Ask to Buy: "can't be turned off if the child is under 18". Children must request every in-app purchase regardless
    of the app's age rating (page published 2026-09-14) [30]. A 13-17-year-old with a *standalone* Apple ID is not
    covered (inference from [29]).
  - Refunds: via reportaproblem.apple.com; the Family Sharing organizer can request refunds for family members'
    purchases; no deadline stated [34]. A refunded Stars IAP lets Telegram debit the Stars [2].
  - Google Play billing is unavailable in Russia (§1.2), so Family Link spending controls are moot for Stars there.
- **Telegram minimum age:** the ToS sets 18 only for "Users in EU countries, the United Kingdom and Australia"; there is
  no age for Russia and no parental-consent clause (read 2026-10-31) [31]. The Stars ToS has no age clause [2].
- **Ads aimed at teens.** 38-FZ art. 6 (edition 04.08.2026) bars ads that:
  - encourage minors to persuade parents to buy (p. 2);
  - create a distorted idea of affordability (p. 3);
  - suggest an advantage over peers (p. 4);
  - induce an inferiority complex in minors who don't own the product (p. 5), or over appearance (p. 8);
  - and others [43].
  - DOCUMENTED. This binds creatives for a 13-17 audience; the wider 38-FZ readings are V3's.

### 4. [W6] Network reach of a foreign-hosted Mini App from Russia
- **16 KB throttling, Cloudflare:**
  - Cloudflare's blog (2025-06-26): since 2025-06-09, Russian ISPs (Rostelecom, MegaFon, Vimpelcom, MTS, MGTS) let
    users load only the first 16 KB of any asset behind Cloudflare, over HTTP/1.1, HTTP/2 and HTTP/3. DOCUMENTED
    (vendor's own measurement) [36].
  - Cloudflare's support doc (last updated **2026-04-23**) still states throttling "to approximately 16 KB per
    connection". Cloudflare "do[es] not have the ability to restore Internet connectivity for Russia-based users".
    DOCUMENTED [35].
  - No 2026 blog post was found in Cloudflare's Russia tag feed [36].
- **Other hosts:** Mediazona and The Record (2025-06) report the same throttling for Hetzner, DigitalOcean and OVH
  (CLAIMED-press) [36a]. An ntc.party thread (pointer, 2026-02 per search snippet; the page refused connection)
  reports it persisting for non-whitelisted Cloudflare/OVH/DO sites.
  - No OONI report for 2026 on this was found (gap).
  - INTERPRETATION: a bundle split into many sub-16 KB files would not be a fix, because the cap is per connection
    [35].
- **Mobile whitelist mode** (iGuides 2026-08-05 citing Kommersant and Vigo) [38]:
  - In H1 2026, > 60 % of Russian mobile sessions were restricted.
  - Unrestricted sessions in July 2026:
    - Central Federal District: 30.5 %.
    - Moscow and Moscow Oblast: ≈ 49 %.
    - St Petersburg: 43.9 %.
    - Bryansk, Kursk and Belgorod: 12 %.
  - The whitelist covers Gosuslugi, VK and messengers, Yandex, marketplaces, banks and telecoms: several hundred
    resources. "Inclusion requires servers located in Russia and not hiding the IP address."
  - MEASURED-vendor (Vigo network monitoring, method not stated) / CLAIMED-press.
  - Mintsifry denied whitelists for **home** internet in Moscow (2026-03-21/22, search snippets of dtf/shazoo).
  - INTERPRETATION: on mobile data in whitelist mode, a Mini App hosted abroad or behind a CDN that hides the origin IP
    will not load. Its availability then depends on Wi-Fi or fixed broadband.
- **Telegram proxy vs Mini App WebView:**
  - tdesktop issue #28692 "Add proxy support for WebView" (opened 2024-11-24, open, label enhancement; PR #31166 open,
    unmerged) [39]:
    - The WebView "does not support local proxy server settings".
    - 2026-05-05: a Mini App fails ("Operation Was Cancelled") with the in-app proxy and loads only with system TUN
      mode.
    - 2026-07-10: a collaborator lists the per-platform WebView proxy APIs "if anyone wants to work on that".
    - An earlier issue (#24448, 2022) reports the WebView using the Windows system proxy rather than the client proxy
      [40].
    - DOCUMENTED for **Telegram Desktop** (issue tracker plus collaborator comment).
  - iOS (WKWebView) and Android (System WebView): no issue or doc was found.
    - INFERENCE: Telegram's MTProxy is an "MT-Proto proxy" that forwards to Telegram servers [41]. It cannot carry the
      WebView's HTTPS to our origin, so on mobile the WebView goes direct or through a system-level VPN.
    - Consequence (inference): a Russian user who reaches Telegram only through an in-app MTProto proxy may see the
      chat but not load our Mini App.
  - A "WEB Proxy" that tunnels MTProxy through a WebView/WebSocket was found in tdesktop code. It is not shipped and
    concerns Telegram's own traffic, not Mini Apps (Kod Durova 2026-08-22) [42].

### 5. [K3 second half] VK Ads and Yandex Direct landing on t.me
- **VK Ads moderation rules** (ads.vk.ru, revision 11.03.2026; VK may change them without notice) [44]:
  - **Landings:** the page must open correctly in a browser and match the ad. Not allowed:
    - JS/meta redirects, link shorteners, and pages that block leaving;
    - links to closed or empty communities/channels;
    - mobile apps "hosted on third-party resources" other than Google Play, App Store, RuStore or Windows Phone Store.
  - **No clause names Telegram, t.me, messengers or "resources with restricted access".**
  - The extremism clause bans ads of materials, persons, organisations and Internet resources (sites, social networks,
    video hosting) "recognized as extremist".
  - **Minors and age:** 18+ targeting is required only for dating, "stimulating events" and lotteries (cl. 4.1).
    - Ads may not reference the user's name or age (cl. 2.9).
    - Information products, websites included, must carry the legal age category 0+/6+/12+/16+/18+, and the advertiser
      is responsible for it (cl. 4.6).
    - No teen-specific targeting rule appears.
  - **Games:** section 3 bans "sale, resale, draws of game products, game coins, keys", third-party game servers and
    account boosting, and risk-and-bet games.
  - DOCUMENTED.
  - VK's 2026-02-05 moderation guide adds "harmful or dangerous for children and teenagers" content as prohibited
    [45].
- **What is not established:**
  - Whether VK moderation accepts `https://t.me/<bot>?startapp=` as a website landing in practice. Searched in Russian
    twice; no practitioner or VK statement found.
  - The minimum targetable age in VK Ads (searched; gap).
  - Whether hint packs sold for Stars fall under "game coins" (INTERPRETATION: the clause reads as aimed at selling
    game items or currency, not at advertising a game; unverified).
  - The 38-FZ restricted-resource question is V3's.
- **Yandex Direct:**
  - Master campaigns auto-switch to a "Telegram channel promotion" format when given a channel link. Text-image ads can
    link the channel directly (ppc.world 2023-08-16) [46].
  - Yandex reports 30,000+ advertisers and 18,000+ channels in its network with 320 M combined subscribers (Yandex
    press via ppc.world, 2026-01-12) [47].
  - Bot or Mini App landings are not mentioned (gap). CLAIMED-press / vendor.

## Channel rows (for the synthesis table)
| Channel | Cost (with currency, date, label) | Effort | Fit for a Russian-first romance VN for girls in a TMA | Evidence quality | Notes |
|---|---|---|---|---|---|
| Paid posts in Romance Club fan channels (e.g. "Подслушано КР", 80.9 K) | Not published; contact admin (2026-10-31) | Low-Medium | **High audience match**. Reach is ≈ 1.4 K/post (1.7 % of subs), so a post buys ~1-2 K views, not 80 K | A (reach, aggregator) / C (price) | Legal status for RU targeting: V3 (ban in force, liability deferred). Subject to the Stars-purchase friction (§1) and hosting reach (§4) |
| Anime/manga/yaoi-manhwa Telegram channels via telega.in | from ≈ 280-840 ₽/post list price (2026-10-31, CLAIMED-marketplace) | Low | Medium-High (manhwa/yaoi readers); no gender data | C | Same legal caveat; 16+ channels exist |
| Official Romance Club channel (732 K) | Not an ad seller (no ad posts seen) | — | Very high match, but a competitor | A (aggregator) | Benchmark for reach: 20.1 K avg/post |
| VK Ads → t.me Mini App landing | VK Ads costs per 04 (CPC ~9-40 ₽, 2026, CLAIMED) | Medium | High reach in RU; **feasibility unverified**. The rules don't forbid t.me, but require a browser-openable page, no redirects, and an age label | B (rules DOCUMENTED; acceptance gap) | A test ad decides it. A web landing page on our domain that links to t.me is the rules-compatible fallback (it must itself be reachable from RU, §4) |
| Yandex Direct → t.me | Not priced in this pass | Medium | Medium. Channel landings are supported; bot/Mini App unknown | B | Promote our own Telegram channel first, which then links the app |
| Any channel → foreign-hosted Mini App (cross-cutting) | — | — | **Degrades every RU row.** Cloudflare/Hetzner/DO/OVH are throttled to ≈ 16 KB/connection; mobile whitelist mode blocks non-RU-hosted origins (> 60 % of mobile sessions restricted, H1 2026) | A (Cloudflare doc 2026-04-23) / B (Vigo via press) | Hosting decision Q21 gates RU conversion |
| Paywall in Russia (cross-cutting) | Store ≈ 2.09 ₽/Star (DOCUMENTED); @PremiumBot ≈ 1.98 ₽/Star (2024-25, CLAIMED; 2026 status contradicted); resellers "20-40 % cheaper" (CLAIMED) | — | Every RU paying user must first obtain Stars through a degraded or off-ToS route | B/C | No share-of-payers data; treat RU paywall conversion as unknown, multiplied by a purchase-friction factor < 1 |

## Applicability to tg-app-novel (map onto §2 planned features; product asks listed, not designed)
- **Paywall copy and the Stars top-up moment.**
  - When the Telegram invoice opens and the user lacks Stars, Telegram's own top-up sheet appears. For a Russian
    account it may offer nothing that works (§1.2).
  - Ask: an analytics event for "invoice opened → closed without `successful_payment`" split by `language_code` /
    platform. This measures the RU friction instead of guessing it.
  - Ask: support copy for `/paysupport` that explains official purchase routes only. Recommending resellers would
    point users at an off-ToS route (§1.3).
- **Refund handling (M-plan, principle 2).** Telegram may debit Stars after an Apple refund or a ToS violation [2].
  - Ask: confirm via a test bot how such a debit surfaces to the bot (e.g. a refunded StarTransaction) and decide
    whether entitlements are revoked.
- **Minimum age MV12 (14+ Russia):**
  - The law gives 14-17-year-olds autonomy only for their own income and minor everyday deals. Parents can void other
    deals (art. 175).
  - Apple's Ask to Buy covers under-18 *child* accounts only [29][30].
  - Ask: keep chapter prices in the "everyday" range; a refund path that honours a parent's request (already possible
    via `refundStarPayment`); no creative that tells a minor to ask parents (38-FZ art. 6) [43].
- **Referral M23 / invite M10.** In mobile whitelist regions the invitee's Mini App may not load at all (§4). The
  "completes the first chapter" grant condition then fails silently.
  - Ask: log launch-to-first-scene failures by region/network type where the client can report them.
- **Hosting Q21.** The facts say a foreign CDN or VPS is degraded for Russian users on both fixed (16 KB) and mobile
  (whitelist) networks. Russian hosting brings its own 152-FZ/ORD questions (V3/M3).
  - Ask: the decision must name which Russian network states the product supports.
- **Ad landings.** VK Ads requires a page that opens in a browser without redirects [44].
  - Ask: a public landing page on our own domain (the privacy-policy host already planned) with an `<a
    href="https://t.me/<bot>?startapp=...">` button and an age label. It is the rules-compatible VK/Yandex landing,
    but only if that domain is reachable from Russia.

## Pitfalls / what goes wrong (sourced)
1. Quoting "Google Play ≈ 2-2.5 ₽/Star" for Russia: Play billing has been paused there since 2022-03-10 [6].
2. Treating the RU App Store price list as a purchase route. The listing exists, but Russian Apple IDs lost carrier
   funding on 2026-04-01 [8][9][10].
3. Relying on SEO articles for @PremiumBot status. They contradict each other and a tech outlet [11][12][13], and most
   promote a reseller [13][14][15].
4. Recommending resellers in support or marketing copy: Stars ToS §4 forbids selling or transferring balances. Only
   Smart Glocal is a licensed reseller [2][3].
5. Reading subscriber counts as reach. Romance Club fan channels show 0.4-2.7 % average post reach [18][19][20].
   Aggregators disagree up to 4× for the same channel (TGStat ≈ 173 K vs Telemetr 732 K) [19].
6. Assuming the in-app Telegram proxy "fixes" Russia for a Mini App. On Desktop the WebView ignores it [39]; on mobile
   MTProxy cannot carry HTTPS (inference [41]).
7. Splitting assets under 16 KB as a throttling workaround: the cap is per connection [35].
8. Assuming the 14+ rule makes any teen purchase final. Art. 175 lets parents sue to void non-everyday deals [28].
   Apple refunds can trigger Stars debits [2][34].

## Key claims for verification (for the verify pass)
1. Russian App Store Stars prices 209 ₽ / 100 etc. — https://apps.apple.com/ru/ (V1 #34) — DOCUMENTED.
2. Google Play billing paused for Russia since 2022-03-10; Play billing policy waived 2022-08-02 —
   https://support.google.com/googleplay/android-developer/answer/11950272 — DOCUMENTED.
3. Carrier (mobile-balance) top-ups of Apple IDs ended 2026-04-01 —
   https://novayagazeta.eu/articles/2026/04/01/v-rossii-perestala-rabotat-oplata-apple-id-so-scheta-mobilnogo-telefona-news
   and https://kod.ru/operatory-pro-oplatu-apple — CLAIMED-press. The verify pass should open the Novaya Gazeta 04-01
   piece; this pass opened only the 03-31 English one.
4. @PremiumBot accepts Russian cards / SBP for Premium (upd. 2026-10-07) — https://appleinsider.ru/?p=564666 — CLAIMED;
   contradicted by https://dtf.ru/howto/5199168-oplata-telegram-premium-v-rossii and 2026 vc.ru guides. Needs a live
   test.
5. Stars ToS §4 "may not sell, withdraw, transfer"; §2.3 jurisdiction restrictions — https://telegram.org/tos/stars —
   DOCUMENTED.
6. Authorized resellers = three Smart Glocal entities — https://telegram.org/tos/third-party-payments — DOCUMENTED.
7. Fragment sells Stars for others, paid in GRAM/TON/USDT/USDC, 100 Stars = 1.50 / 1.2668 —
   https://fragment.com/stars/buy — DOCUMENTED.
8. Official Romance Club Telegram channel 732,261 subs, avg reach 20.1 K —
   https://telemetr.me/content/official_romanceclub — MEASURED-aggregator.
9. Mediascope 12-17: Telegram daily reach 80.6 %, VK 64.9 %, TikTok 62.2 % (2024) —
   https://www.sostav.ru/publication/podrostki-vybirayut-tiktok-videoigry-na-smartfonakh-i-multfilmy-na-tv-68480.html —
   MEASURED (panel, via press).
10. Civil Code art. 26 p. 1-2 and art. 175 text (edition 10.06.2026) —
    https://www.consultant.ru/document/cons_doc_LAW_5142/7b6abd47219e2aa6081ac21b41e9e83d80fb45df/ and
    …/a267c0e04062a2651ed5c2dcfc1b867cc03b6e51/ — DOCUMENTED.
11. Apple: child account under 13 for Russia (catch-all); Ask to Buy can't be turned off under 18 —
    https://support.apple.com/en-us/125666, https://support.apple.com/en-us/105055 — DOCUMENTED.
12. Cloudflare: RU throttling ≈ 16 KB per connection, doc updated 2026-04-23 —
    https://developers.cloudflare.com/support/troubleshooting/general-troubleshooting/service-disruption/ — DOCUMENTED.
13. Vigo: July 2026 only 30.5 % of CFD mobile sessions unrestricted; whitelist requires RU-located servers —
    https://www.iguides.ru/main/other/svobodnyy_internet_v_rf_pochti_polnostyu_vytesnen_belym_spiskom_saytov/ —
    CLAIMED-press / MEASURED-vendor.
14. tdesktop WebView ignores the in-app proxy; issue #28692 open, PR #31166 unmerged —
    https://github.com/telegramdesktop/tdesktop/issues/28692 — DOCUMENTED (issue tracker).
15. VK Ads rules rev. 11.03.2026: no t.me clause; apps only from GP/App Store/RuStore; age labels; 18+ for dating and
    lotteries — https://ads.vk.ru/en/help/articles/moderation — DOCUMENTED.

## Gaps (asked but no reliable source found)
- **Share of Russian Telegram users able to buy Stars**: none found.
- **@PremiumBot status for Russian cards in 2026**: contradicted; needs a live check from a Russian account. This is an
  owner action, not research: open @PremiumBot → /stars and look at offered methods. No login or purchase is needed
  to see the list.
- **Whether a carrier top-up route for Apple IDs resumed in 2026-08** (techora/Mash): page unreadable.
- **What happens to developer revenue when Telegram debits Stars** the user already spent (Apple refund, ToS
  violation).
- **Age/gender skew of any named community**: TGStat demographics pages returned 403; VK unfetchable.
- **VK community sizes in 2026** (Romance Club, Лига Мечтателей, otome, BookTok-RU): vk.com unfetchable; only 2024
  CLAIMED figures.
- **Petrograd court case** (445 K ₽, Black Russia): search summary only; the primary page refused connection.
- **РВИ memorandum (2026-10-20)**: search snippets only.
- **Art. 28 text**: not opened (summarised via art. 26 p. 2 cross-reference and secondary pages).
- **iOS/Android WebView vs the Telegram in-app proxy**: no issue or doc found; inference only.
- **2026 OONI measurements on Cloudflare/foreign hosts**: not found.
- **Whether VK Ads accepts t.me bot / Mini App landings**, and the VK Ads minimum targetable age: not found.
- **Yandex Direct bot / Mini App landings**: not found.

## Owner value questions this area raises (each with a default reading)
- **OWNER: Is Russia still the first *paying* market, given Stars-purchase friction and a foreign-hosted app's network
  reach?** Default: Russia stays a *reach* market (story discovery, free chapter 1). The paywall forecast treats RU
  conversion as unknown and does not base budgets on it until the invoice-funnel event (Applicability) gives a number.
- **OWNER: Should support copy ever point Russian users to a reseller?** Default: no. Official routes only (Stars ToS
  §4, [2][3]).
- **OWNER: Price ceiling per chapter for a 14+ audience?** Default: keep single purchases in the "minor everyday" range
  and honour parental refund requests. The exact ruble line is a lawyer item.
- **OWNER (with Q21): Which Russian network states must the app support** (fixed broadband only, or mobile whitelist
  mode too)? Default: fixed broadband and Wi-Fi only. Mobile whitelist mode is unsupported unless hosted in Russia.

## Sources
[1] https://core.telegram.org/bots/api-changelog — Bot API changelog; 10.3 dated 2026-08-24; read 2026-10-31; the contract.
[2] https://telegram.org/tos/stars — Terms of Service for Telegram Stars (§2, §2.2, §2.3, §3, §3.1, §4); undated; read 2026-10-31; primary.
[3] https://telegram.org/tos/third-party-payments?setln=en — Third-Party Payments and Authorized Resellers (Smart Glocal ×3); undated; read 2026-10-31; primary.
[4] https://dtf.ru/howto/5052561-kak-kupit-telegram-stars-v-rossii and other dtf/vc guides — search pointers only; promotional.
[5] https://fragment.com/stars/buy — Fragment Stars purchase page; read 2026-10-31; primary (Telegram's platform).
[6] https://support.google.com/googleplay/android-developer/answer/11950272 — Play Console Help, Russia/Belarus billing changes (pause 2022-03-10; policy waiver 2022-08-02); undated; read 2026-10-31; primary.
[7] https://support.google.com/books/partner/answer/11962641?hl=en-GB — Google "Pausing Google Play's billing system for users in Russia"; read 2026-10-31; primary.
[8] https://kod.ru/operatory-pro-oplatu-apple — Kod Durova, 2026-03-30: Beeline SMS, MTS still working; read 2026-10-31; trade press.
[9] https://novayagazeta.eu/en/articles/2026/03/31/russians-offered-last-chance-to-buy-telegram-premium-subscriptions-as-payments-to-apple-blocked-en-news — 2026-03-31: Telegram in-app "last chance" text; RBC report on the carrier block; read 2026-10-31; press.
[10] https://novayagazeta.eu/articles/2026/04/01/v-rossii-perestala-rabotat-oplata-apple-id-so-scheta-mobilnogo-telefona-news — 2026-04-01 (search result; not opened); press.
[11] https://kod.ru/telegram-stars-buy-premium-bot — Kod Durova, 2024-08-04 upd. 2025-05-24: @PremiumBot Stars packs, 50 = 99 ₽; read 2026-10-31; trade press.
[12] https://appleinsider.ru/?p=564666 — AppleInsider.ru, 2026-04-03 upd. 2026-10-07: Premium via @PremiumBot with cards/SBP/SberPay; App Store route gone; read 2026-10-31; tech press.
[13] https://dtf.ru/howto/5199168-oplata-telegram-premium-v-rossii (2026-07-22?, promotes Code-Top.Shop) and search snippets of vc.ru/dtf.ru 2026 guides claiming the 2026-04-01 card failure; read 2026-10-31; CLAIMED-SEO.
[14] https://dtf.ru/howto/5086579-kak-kupit-telegram-stars-iz-rossii — dtf, 2026-05-27?: Fragment as the "most stable official" route, resellers buy via Fragment, no spending block; promotes ggsel; read 2026-10-31; CLAIMED.
[15] https://vc.ru/telegram/3050731-kak-kupit-zvezdy-telegram-v-rossii — vc.ru, 2026-07-29?: store ≈ 1.8-2.5 ₽/Star, alternatives 20-40 % cheaper; promotes telegram-stars.org; read 2026-10-31; CLAIMED.
[16] https://vc.ru/services/2940001-kak-kupit-zvezdy-telegram-v-rossii-na-android-bez-google-play — vc.ru, 2026-05-20?: Russian cards unreliable in Google Play; promotional; read 2026-10-31; CLAIMED.
[17] https://fragment.com/terms — Fragment Terms; undated; read 2026-10-31; primary.
[18] https://telemetr.me/content/romanceclubfan — Telemetr: Romance Club FAN TG plus the similar-channels list; read 2026-10-31; aggregator.
[19] https://telemetr.me/content/official_romanceclub — Telemetr: official Romance Club channel; read 2026-10-31; aggregator.
[20] https://telemetr.me/content/klubromantiki2 — Telemetr: Подслушано Клуб Романтики; read 2026-10-31; aggregator.
[21] https://telemetr.me/catalog/anime/manga/ — Telemetr manga catalog, top channels; read 2026-10-31; aggregator.
[22] https://telemetr.me/content/vizualnovels — Telemetr: Визуальные новеллы; read 2026-10-31; aggregator.
[23] https://www.rustore.ru/catalog/app/com.StoryInc.LeagueOfDreamers2 and the App Store listing id1591679538 — Лига Мечтателей store listings (search results); store pages.
[24] https://telemetr.me/content/gladmedia — Telemetr: @gladmedia, «Цена выбора» launch post; read 2026-10-31; aggregator.
[25] https://telega.in/channels/MangaHD_2/card (and the other telega.in cards in search) — Telega.in marketplace list prices; read via search 2026-10-31; CLAIMED-marketplace.
[26] https://www.sostav.ru/publication/podrostki-vybirayut-tiktok-videoigry-na-smartfonakh-i-multfilmy-na-tv-68480.html — Sostav 2024-06-25, Mediascope 12-17 data via RBC; read 2026-10-31; panel data via press.
[27] https://www.consultant.ru/document/cons_doc_LAW_5142/7b6abd47219e2aa6081ac21b41e9e83d80fb45df/ — Civil Code art. 26, edition 10.06.2026 (amendments 22.10.2026); read 2026-10-31; law text.
[28] https://www.consultant.ru/document/cons_doc_LAW_5142/a267c0e04062a2651ed5c2dcfc1b867cc03b6e51/ — Civil Code art. 175 (via search extract with commentary); read 2026-10-31; law text.
[29] https://support.apple.com/en-us/125666 — Apple "Region-specific rules for managing an Apple Account", published 2026-10-26; read 2026-10-31; primary.
[30] https://support.apple.com/en-us/105055 — Apple "Ask to Buy", published 2026-09-14; read 2026-10-31; primary.
[31] https://telegram.org/tos — Telegram ToS (18+ for the EU/UK/AU only); undated; read 2026-10-31; primary.
[32] https://wnhub.io/ru/news/other/item-46792 — WN Hub 2025-01-15: Chernyshov proposal (RIA); read 2026-10-31; trade press.
[33] https://techora.ru/news/rvi-predlozhila-gosdume-ogranichit-traty-detey-2026-10-28 — РВИ memorandum (Kommersant); bot check, search snippets only; CLAIMED.
[34] https://support.apple.com/en-us/118223 — Apple "Request a refund"; read 2026-10-31; primary.
[35] https://developers.cloudflare.com/support/troubleshooting/general-troubleshooting/service-disruption/ — Cloudflare doc, last updated 2026-04-23; read 2026-10-31; vendor primary.
[36] https://blog.cloudflare.com/russian-internet-users-are-unable-to-access-the-open-internet/ (2025-06-26) and https://blog.cloudflare.com/tag/russia/rss (no 2026 post); read 2026-10-31; vendor primary.
[36a] https://zona.media/article/2025/06/27/cloud_confirmed and https://therecord.media/cloudflare-russia-restricting-access-crackdown — 2025-06 press on Hetzner/DO/OVH; search results; press.
[37] https://telemetr.me/catalog/book — Telemetr books catalog (Фикбук ≈ 291 K); read 2026-10-31; aggregator.
[38] https://www.iguides.ru/main/other/svobodnyy_internet_v_rf_pochti_polnostyu_vytesnen_belym_spiskom_saytov/ — iGuides 2026-08-05 citing Kommersant (kommersant.ru/doc/8862389) and Vigo; read 2026-10-31; press citing a vendor measurement.
[39] https://github.com/telegramdesktop/tdesktop/issues/28692 — "Add proxy support for WebView", open, comments to 2026-07-10; read 2026-10-31; primary issue tracker.
[40] https://github.com/telegramdesktop/tdesktop/issues/24448 — "WebView is not using proxy", 2022, closed stale; read 2026-10-31; primary issue tracker.
[41] https://github.com/TelegramMessenger/MTProxy — official MTProxy README ("Simple MT-Proto proxy"); read 2026-10-31; primary.
[42] https://kod.ru/telegram-web-proxy-webview — Kod Durova 2026-08-22: WEB Proxy found in tdesktop code, not shipped; read 2026-10-31; trade press.
[43] https://www.consultant.ru/document/cons_doc_LAW_58968/e6ec70594b2bbac7a47fe870454e14bf17783583/ — 38-FZ art. 6, edition 04.08.2026; read 2026-10-31; law text.
[44] https://ads.vk.ru/en/help/articles/moderation — VK Ads moderation rules, revision 11.03.2026; read 2026-10-31; platform primary.
[45] https://ads.vk.ru/en/insights/vk-ads-moderation-guide — VK Ads moderation guide, 2026-02-05; read 2026-10-31; platform.
[46] https://ppc.world/articles/kak-reklamirovat-telegram-kanal-cherez-yandeks-direkt-obzor-vseh-vozmozhnostey/ — ppc.world 2023-08-16: Direct → Telegram channel formats; read 2026-10-31; trade press.
[47] https://ppc.world/news/bolee-30-000-reklamodateley-razmestili-reklamu-v-telegram-cherez-direkt-za-dva-goda-issledovanie/ — ppc.world 2026-01-12, Yandex Ads press data; read 2026-10-31; vendor via trade press.
