# Promotion research 04: promotion outside Telegram
Date 2026-10-31. Sources read: 47 (opened), plus 9 search-result listings used only as pointers (marked "listing").
Freshness notes: Bot API changelog read 2026-10-31 (latest Bot API 10.3, 2026-08-24) [39]; Habr rules last edited
2026-07-08 [25]; VK Q1 2026 results published 2026-05-21 [17]; click.ru Q2 2026 ad benchmarks 2026-08-13 [19];
AppleInsider on Romance Club's return 2026-05-19 [30]. **The shared web-search budget (200 calls per turn, all agents)
ran out partway through this area.** Areas 3-5 were finished with direct fetches of primary pages only, so several
sub-questions remain gaps (see "Gaps"). Reddit, ficbook.net, the Lemma Soft forums and dev.vk.ru (HTTP 500 on
2026-10-31) could not be fetched; for those, search snippets are used and labelled.

## TL;DR (5-8 bullets, decision-relevant)
- **The platform itself is throttled in Russia.** Roskomnadzor confirmed it was restricting Telegram on 2026-02-10,
  after blocking calls in Aug 2025 [16a][16d]. Mediascope counted 93.6 M monthly / 74.3 M daily Telegram users in
  Dec 2025 (DOCUMENTED-by-press [16d]). A drop in March 2026 and an April 2026 App Store disappearance are
  CLAIMED/unverified. Off-Telegram promotion for a Russian audience sends people into a product whose transport is
  degraded. That is the main risk for every row below.
- **VK is the largest reachable Russian channel and skews female.** VK had 93.4 M MAU and 62.7 M DAU in Q1 2026
  (VK IR, Mediascope reach 90 %) [17]; one blog puts the female share at 54-64 % (CLAIMED, no source) [18]. VK Clips
  get 3.4 B views/day [17]. Romance Club, the reference Russian-language interactive-romance product, has ~1.5 M VK
  community members (CLAIMED by press, 2024 and 2026) [30][31]. In May 2026 it returned to Russian stores as a separate
  version with same-sex routes removed [30]. Its growth driver, per the press: fan content and memes [31].
- **Global short-video platforms are mostly closed to Russian creators.** TikTok has not accepted uploads from
  Russian accounts since 2022-03-06 and has no Russian ad cabinet (2026-01-20 explainer) [15]. YouTube traffic from
  Russia has been throttled to ~20 % of normal since late 2024 (CLAIMED) [14]. Instagram has been blocked since
  2022-03 and Meta is designated extremist [41]. Discord has been blocked since 2024-10-08 [13]. The Russian
  alternatives are VK Clips / VK Video, Rutube (Yappy is being folded into "Rutube Shorts", planned H1 2026) [45],
  and Twitch, which still has a large Russian viewership: ~119.8 M visits from Russia in Jun 2025 (CLAIMED) [34].
- **VK as a second distribution channel conflicts with the project rules.** VK games must pass moderation
  [21]. VK's own currency was mandatory in 2021 (votes, 45 % commission) [23], and the old catalog rules banned
  third-party authorization [22]. The current rules (in force 2024-04-22) were not readable [22]. This collides
  with principle 2 (Stars only) and principle 3 (initData auth); it is an architect/owner fork, not a marketing
  tactic.
- **The English VN/otome communities let you promote only in narrow slots.** r/otomegames allows self-promotion
  only in a weekly "Self Promotion Sunday" thread; r/visualnovels only for announcements, trailers, demos, Kickstarter
  campaigns and releases. Both rules are CLAIMED from undated mirrors [10][11]. itch.io discourages pages that only
  link to another platform and may drop them from discovery (DOCUMENTED) [3]. A Telegram-only game cannot have an
  itch-playable build without a non-Telegram web build. VNDB lists hybrids only if ≥ 50 % is "pure VN-style reading"
  (DOCUMENTED) [1]. A puzzle-heavy design may fall outside VNDB.
- **Jams are the cheapest structured EN exposure, and the calendar is fixed.** Otome Jam / Josei Jam run Apr 30 -
  Jul 1 each year; Otome Jam allows WIP demos and commercial projects with a demo, and bans AI content [4]. Other
  dated slots: Yuri Jam 2026-10-01 to 2026-12-01 (listing) [7], Trans Otome Jam 2026-11 (listing) [8],
  O2A2 2026-07-11 to 07-21 (1000 words) [6], ValenPy 2027-02-02 to 02-14 (listing) [9].
- **Influencer pricing in RU is quoted per view.** A 2026 review cites average CPV of 2.80 RUB on Telegram (news and
  marketing) and ~1.53 RUB on YouTube (entertainment). These come from a Jul 2025 - Jul 2026 study (CLAIMED) [32].
  Perfluence was rated No. 1 Russian influencer marketplace by market share in May 2026 (survey of 878 experts,
  CLAIMED) [33]. Every placement needs an ERID label (area 06).
- **Waitlist in Telegram: what the platform allows.** A bot cannot start a conversation; the user has to message it
  first [37]. A Mini App can ask permission with `requestWriteAccess` (Bot API 6.9) [38]. Free broadcasts are capped
  at ~30 msg/s; paid broadcasts reach 1000 msg/s at 0.1 Star per extra message and need 100 k Stars + 100 k MAU [35].
  The Terms limit broadcasts to "users who have granted permission to contact them" and ban spam (§5.2(b), §6.2.5)
  [36]. No published waitlist→launch conversion numbers were found.

## Findings

### 1. VN / IF / otome communities (mostly English)

**Reddit.** Reddit pages could not be fetched (tool block); the rules below come from mirrors shown in search results
and are CLAIMED, undated.
- r/otomegames: developers must post their own work in the weekly **"Self Promotion Sunday"** thread. Promotion
  outside it is removed, and that covers blog, website, YouTube, Instagram, Twitter and Tumblr links and requests for
  followers [10]. A separate r/IndieOtome runs a 24-hour promotion thread (Saturday per a 2024 snapshot; schedules
  reportedly changed) [10].
- r/visualnovels (older wiki copy): self-promotion threads must have the VN name in the title. Allowed:
  "announcements, kickstarter launch, trailer, or demo of a new project", a Kickstarter ≤ 5 days from ending (widened
  from 2 days in Oct 2020), a funded Kickstarter, and project/Steam release [11]. A related r/vns wiki says to wait
  until there is "something tangible to show" [11].
- r/RenPy: has a "self promotion" post flair, ~39 k members (CLAIMED, gummysearch snippet). Whether non-Ren'Py games
  are allowed was not established. r/interactivefiction: no rule text found.
- Sitewide: Reddit's content policy bans spam and manipulation and leaves promotion rules to each subreddit. The "90/10
  rule" is folk guidance, not an official number (vendor blog, 2026-03-15, upd. 2026-07-02) [12].
- Availability of Reddit in Russia in 2026: not established (gap).

**VNDB** (guidelines read 2026-10-31, site version 2.30-165) [1][2]. DOCUMENTED:
- A pure VN qualifies when "Choices are the only allowed (but optional) form of interactivity" and the title is ≥ 99 %
  pure reading.
- A **VN/game hybrid** qualifies when it "consistently use[s] the novel narrative" and ≥ 50 % is "pure, VN-style
  reading" [1]. "Dialogues, no matter how extensive" do not make a game a VN [1].
- Browser games are recorded under the media type "Internet Download" ("all browser games played through a website").
  "Account-based" DRM exists as a release attribute [2].
- No rule mentions messenger-distributed releases. Whether editors accept a Telegram-only release is undocumented
  (gap).
- In-development VNs can have entries ("In development" status), but editions must not be added "for unofficial TBA
  releases or unreleased projects" without a partial release [1]. So a VNDB entry realistically comes after a public
  free chapter.

**itch.io.** Quality guidelines, read 2026-10-31 [3]. DOCUMENTED:
- "Please try not to upload just Steam keys, or put a link to your Steam store page without uploading any files"; and
  "Avoid using third-party download services or links to other platforms" [3].
- Breaking the guidelines means "our systems or a site moderator may choose to remove your page from itch.io's
  discovery index" [3].
- Generative-AI content must be disclosed; AI-dominated projects are treated as spam [3].
- A page whose only content is a link to `t.me/<bot>` is therefore discouraged and liable to lose discovery. It is
  not explicitly banned. Devlogs attach to a project page.

**Jams** (itch.io pages read 2026-10-31):
| Jam | Window | Key rules | Source |
|---|---|---|---|
| Otome Jam 2026 | 2026-04-30 → 2026-07-01 (over; yearly; 2025 had 92 entries) | female-identifying protagonist + ≥ 1 male LI; romance focus; pre-started projects OK if a considerable part is done in the jam; finished games removed; WIP/demos OK; may be commercial "provided a demo is available"; AI content banned; R18 must be tagged; ≤ 3 entries per creator; screenshots on the itch page required | [4] DOCUMENTED |
| Josei Jam 2026 | same window | sister jam for BL/GL/non-romance | listing [5] |
| O2A2 2026 | 2026-07-11 → 2026-07-21 (over); 180 entries | 1 sprite, 1 background, 1 music track, 1 SFX, 1000 words | [6] DOCUMENTED |
| Yuri Jam 2026 | 2026-10-01 → 2026-12-01 (running now) | games about relationships between women; demos OK | listing [7] |
| Trans Otome Jam | 2026-11-01 → 2026-12-01 | trans representation in otome | listing [8] |
| ValenPy 2027 | 2027-02-02 → 2027-02-14 | Ren'Py-oriented by name; rules not opened | listing [9] |

**Lemma Soft Forums**: the forum returned HTTP 403. Its promotion subforum rules were not established (gap).
**Tumblr otome community**: not researched; the budget ran out (gap).

**Discord** is blocked in Russia. Roskomnadzor restricted it on **2024-10-08**, citing "violations of local
legislation"; NetBlocks confirmed it across several ISPs [13]. A Russian press roundup reports that RKN "does not see
grounds for unblocking" (snippet). A Discord server can therefore serve the EN audience only; Russian users need a
VPN. Discussing VPN use is legally sensitive (the 2025 law on searching for extremist content and VPN advertising
[41]; area 06).

### 2. Russian-speaking platforms

**Reachability backdrop (dated):**
- **Telegram.** Calls blocked Aug 2025. RKN confirmed restrictions on **2026-02-10**: "violations ... have not been
  fixed" [16a]. A partial slowdown (slow video and media loading) started Jan 2026 [16b]. A Bitrix24 explainer
  (updated 2026-08-06) reports message delays and media failures in all regions and no official full-block date
  [16c]. Mediascope Dec 2025: 93.6 M monthly, 74.3 M daily (via ppc.world, 2026-02-11) [16d]. Experts quoted there
  expect Telegram ad budgets to shift partly to VK, Max and Rutube in 2026 (CLAIMED) [16d].
- **YouTube.** Throttling started on desktop and was extended to mobile from mid-Dec 2024. Traffic "fell to 20 %"
  per Digital Report (CLAIMED, 2024-12-23, upd. 2025-05-23) [14].
- **TikTok.** Uploads from Russian accounts suspended since Mar 2022. Russians see a limited local feed. No ad
  cabinet for Russian accounts; integrations go through bloggers with ERID labels. The app is **not** on a banned
  list. Mediascope: 69.3 M MAU in Russia, Mar 2025 (all per a 2026-01-20 explainer, CLAIMED) [15].
- **Instagram.** Blocked by RKN (2022-03-11/14). Meta was found to facilitate extremist activity on 2022-03-21 and
  listed as "extremist" in Oct 2022 [41]. Advertising on blocked/extremist platforms is legally restricted; details
  and the law text are in area 06, not re-verified here.

**VK (VKontakte)** [17][18][19][20]:
- **Audience.** Q1 2026: 93.4 M MAU, 62.7 M DAU (VK IR; reach 90 % monthly / 57 % daily of the Russian internet,
  Mediascope 12+) — DOCUMENTED by the company [17]. VK Video: 82.6 M MAU (Mediascope) [17]. VK Clips: 3.4 B average
  daily views [17]. A 2026-07-28 blog puts women at 54-64 % of VK users and 35-44 as the largest age group (~31 %),
  sources unnamed (CLAIMED) [18].
- **Ads (VK Ads, the only cabinet since Jan 2026).**
  - click.ru Q2 2026, year over year: VK Ads CPM +33.15 %, CPC +0.99 %, CTR +10.09 %. Its earlier Q2 2026 snippet
    quoted VK Ads CPC = 9.15 RUB. Panel-based, sample size not stated (CLAIMED/MEASURED-by-vendor) [19].
  - A 2026 guide gives CPM 30-150 RUB in mass niches and 200-500 RUB+ in competitive ones, CPC 10-40 RUB / 50-150 RUB,
    a technical minimum top-up of 500 RUB and a test budget of 10-20 k RUB, all prepaid. Labelled "a guideline, not a
    promise"; no method (CLAIMED) [20].
  - No 2026 games-CPI benchmark was found; a snippet quoted 86 RUB Android / 140 RUB iOS for an undated puzzle case
    (CLAIMED, undated).
  - Whether VK Ads accepts creatives that lead to `t.me` links: not established (gap).
- **VK Donut.** Authors earned 718 M RUB in Q1 2026, +26 % YoY (VK IR) [17].
- **VK Games / VK Mini Apps as a second distribution channel** (facts only):
  - Any user can publish an HTML5 game. Games pass moderation for compliance with platform rules and Russian law
    [21]. The integration SDK is VK Bridge, with `VKWebAppInit` [21].
  - The server must allow `vk.ru` / `m.vk.ru` framing (X-Frame-Options) [21]. Payments in-game go through VK votes
    (≤ 3000/day by default) or OKs [21].
  - Monetizing requires registering in the cashout cabinet as a legal entity, sole proprietor or self-employed; no
    residency rule is stated [21].
  - The old catalog rules said: all virtual goods must be paid "using VK votes, and games are prohibited from
    accepting payment through any other means"; "no separate registration or authorization using third-party
    services"; iOS ≥ 10.3, Android ≥ 5.1. Those rules were marked obsolete, replaced by "Rules for App Placement on the
    VK Mini Apps Platform" effective **2024-04-22** (search snippet; page fetch HTTP 500 on 2026-10-31) [22].
  - 2021: votes mandatory for virtual goods in mini apps on all platforms except iOS; 45 % commission; VK said the
    rate "is not final" (kod.ru 2021-07-21) [23]. The current commission was not found (gap).
  - Featured collections need ≥ 1 month in the catalog and ≥ 15 % D1 retention (search snippet of dev.vk.ru) [22].
  - Catalog surfaces: the VK app, m.vk.com/services, vk.com/services; mini apps are also tested by "VK Testers" [24].
- **Odnoklassniki (OK).** OK payments ("OKs") are named as a VK Games payment option [21]. Audience and ad data were not
  gathered (gap).

**Habr** (rules last edited 2026-07-08) [25]. DOCUMENTED:
- "Do not use Habr as a platform to promote your (or others') projects."
- Ads only in company blogs or "one-time posts in the 'I'm advertising' hub".
- "App and game developers are allowed to post a link to an app store even if they are monetized"; a one-time mention
  of relevant social channels is allowed.
- A technical dev story (inkjs, Pixi, Stars payments) with one link fits the rules. A promotional post does not.

**DTF** (rules dated 2019-07-10) [26]. DOCUMENTED:
- "Мы не препятствуем публикации ссылок на собственные ресурсы, проекты" (links to your own projects are not
  hindered) while the content serves the community.
- Commercial promotion posts are banned, and blogs made only for ads can be restricted.
- The Gamedev subsite concept routes indie "about my game" stories to the **"Инди"** (Indie) subsite (snippet).
- A 2022 DTF Indie post argues devs should talk to players, not to other devs (opinion) [44].

**Pikabu.** The rules page has section 8 "advertising" (8.2 posts and blogs, 8.3 paid promotion, link to
`/information/adrules`), but the fetched text was garbled; the exact wording was not established [27] (gap).

**Дзен, Rutube, Yappy.** Yappy is being turned into **Rutube Shorts** inside one Rutube platform, planned for H1 2026
(ppc.world 2025-06-19) [45]. A snippet claimed Rutube traffic +43.8 % and VK Video +35 % in the month after YouTube's
slowdown (CLAIMED, not opened). Дзен audience and rules were not gathered (gap).

**Romance-reader and fandom platforms:**
- Similarweb visits as quoted on Author.Today, **2022-10-06**, period unstated (CLAIMED, stale) [28]: Ficbook 93.2 M,
  Litnet 44.7 M, Author.Today 31 M, Litres 21.8 M, Litmarket 10.9 M; Wattpad 149.1 M globally with ≤ 5.96 M estimated
  from Russia. No demographics.
- A 2025 Semrush snippet: ficbook.net 73.3 M visits in May 2025, 89 % direct traffic (CLAIMED; page 404 on re-fetch).
- ficbook.net rules: HTTP 403 (gap). Litnet / Author.Today / Litres Samizdat promotion rules: not gathered (gap).
- Book-market context: 2025 paper book sales were 114 B RUB, over half via marketplaces. On Wildberries Anna Jane's
  romance *Allow Me to Love* sold > 80 k copies; Rebecca Yarros's romantic fantasy was No. 3 on Litres
  (Kommersant 2026-01-11, CLAIMED-by-industry) [29]. No Russian BookTok audience data was found.
- **Romance Club (Клуб Романтики)** by Your Story Interactive (Moldova):
  - Removed from Russian stores in 2024 after RKN listed its store pages (2024-05-28) over LGBT content [31].
  - Returned in **May 2026** as a separate Russian app without same-sex routes, and progress does not transfer [30].
  - > 10 M Google Play downloads; ~1.5 M VK community subscribers; ~57 stories (CLAIMED, AppleInsider 2026-05-19)
    [30].
  - Discovery via memes and fan content: fan art, fanfiction, videos, cosplay contests (Novaya Gazeta Europe
    2024-07-16, reportage) [31].
  - App Store age rating 17+ (snippet).
  - Its VK fan groups are the closest existing audience, and posting rules there are set by each group's admins (gap).

### 3. Streamers and influencers
- **Twitch** (Russia): ~10 % of Twitch viewers; ~119.8 M visits from Russia in Jun 2025 (Similarweb); Russian-language
  streams average 208,492 concurrent viewers across 6,365 weekly active channels (Twitch Tracker). All quoted by a
  streamer-agency blog, 2025-10-08 (CLAIMED) [34]. Twitch's 2026 legal status in Russia: not established.
- **VK Play Live**: its catalog became available across VK Video surfaces (snippet, undated). No 2026 audience data
  found (gap).
- **Pricing** (2026 review of a Jul 2025 - Jul 2026 study; the review warns CPV × 1000 is not a true CPM) [32]:
  - Telegram (news/marketing) average CPV 2.80 RUB; Telegram (construction/design) 9.34 RUB.
  - YouTube entertainment ~1.53 RUB; MAX ad posts ~0.5 RUB.
  - Catalog placements (Flagram, Apr): Telegram 7,964 RUB, MAX 5,115 RUB, VK 1,704 RUB average.
  - All CLAIMED. No books/romance/anime niche figures; no micro-influencer prices.
- **Marketplaces:**
  - Perfluence: rated No. 1 "by market share" among blogger exchanges, AdIndex Technology Index 2026 (survey May 2026,
    878 experts / 453 companies; no share figure) — CLAIMED [33].
  - A toolfox.ru aggregator (Jun 2026, snippet only): GetBlogger subscription from 5,000 RUB, Epicstars from 2,000
    RUB, Perfluence free for advertisers with CPA/CPM models (CLAIMED).
  - VK AdBlogger and Telega.in exist per other snippets; Telega.in's MAX data is cited in [32].
- **VN let's-players.** No Russian VN/otome let's-play channels with audience data were found (gap). An EN example:
  otome.com interviewed a YouTube creator who plays itch.io/Steam VNs (2025-09-30, snippet only).
- **Labelling:** ad integrations need ERID tokens and ERIR reporting. Bloggers with > 10 k subscribers must be
  registered with RKN, and advertisers can be fined if they are not [15]. Detail in area 06.

### 4. Devlog channel, waitlist, crowdfunding, press
- **Waitlist mechanics (DOCUMENTED):**
  - "Bots can't start conversations with users. A user must either add them to a group or send them a message first"
    [37].
  - A Mini App can call `requestWriteAccess` — "a native popup requesting permission for the bot to send messages to
    the user" (Bot API 6.9, 2023-09-22) — and `WebAppUser.allows_write_to_pm` reports whether permission was given
    [38]. Under principle 3 this flag can only be trusted from signed initData on the server.
  - Free broadcasts: ~30 msg/s; ≤ 1 msg/s per chat; 20 msg/min per group [35]. Paid broadcasts: up to 1000 msg/s, 0.1
    Star per message over 30/s, eligibility ≥ 100,000 Stars balance and ≥ 100,000 MAU; `allow_paid_broadcast` since
    Bot API 7.11 (2024-10-31) [35][39]. A pre-launch waitlist is far below the paid tier and well within free limits
    if spread out (the FAQ suggests 8-12 h) [35].
  - Terms: §5.2(b) "must not harass or spam users with unsolicited messages"; §6.2.5 broadcasting "to users who have
    granted permission to contact them", "for legitimate business purposes", and no use of increased limits to spam
    [36].
  - 2026 changelog: "Communities" (several supergroups, channels and bots linked together), Bot API 10.2, 2026-07-14
    [39]. It may matter for linking a devlog channel and the bot. Its details were not researched (gap).
- **Waitlist→launch conversion**: no published number was found (gap; search budget exhausted).
- **Crowdfunding / community money:**
  - VK Donut: 718 M RUB paid to authors in Q1 2026 [17].
  - Boosty: card payments from Russia are officially available; new phone-number registration was "temporarily
    unavailable" at the time of the vc.ru article (CLAIMED; no commission found) [40]. A snippet claims the commission
    rose from 7 % to 10 % for new users and that Boosty restricted posting by "foreign agents" from 2025-09-01
    (CLAIMED, unverified).
  - Patreon left Russia (snippet only, CLAIMED).
- **Press:** whether StopGame, Igromania or DTF editors cover Telegram games was not established (gap). Habr and DTF
  user blogs are self-publishing routes with the rules above [25][26].

### 5. English-market basics
- **Wattpad**: the company page claims "the largest storytelling platform" with "millions" of users, without numbers
  or promotion policy (2026) [43]. In 2022 Similarweb counted 149.1 M visits [28].
- **Otome market reference:** *Love and Deepspace* (Papergames) passed 10 M downloads by its third day (Jan 2024),
  50 M registered players (2025) and > 500 M USD revenue by Mar 2025 (Sensor Tower via France 24). Its ex-China
  revenue fell 68 % in Jun-Jul 2026 after a character controversy (Polygon 2026-08-03) — CLAIMED/industry-tracker,
  via Wikipedia [42]. It is a AAA 3D title, not an indie growth model. Its fan petition (229 k signatures) shows how
  much otome fan communities can mobilize [42].
- An indie VN that grew on TikTok/BookTok with numbers was not found (gap).

## Channel rows (for the synthesis table)
| Channel | Cost (with currency, date, label) | Effort | Fit for a Russian-first romance VN for girls in a TMA | Evidence quality | Notes |
|---|---|---|---|---|---|
| VK community + VK Clips (organic) | 0 RUB cash; content production only | High (steady short video / posts) | High: largest reachable RU network, female-skewed (CLAIMED 54-64 %), Romance Club's 1.5 M fans live there | A (VK IR audience) / C (gender) | Sends users into throttled Telegram; VK age minimum unverified |
| VK Ads (targeted) | CPM 30-150 RUB mass, 200-500+ competitive; CPC ~9-40 RUB; test 10-20 k RUB (2026, CLAIMED) | Medium | High reach in RU; teen targeting has legal limits (area 06) | B/C | `t.me` landing acceptance unverified; ERID required |
| VK Games / VK Mini Apps (2nd distribution) | Votes commission 45 % (2021, DOCUMENTED-by-press; current unknown) | Very high (port: VK Bridge, VK auth, votes) | Audience fit high; architecture conflict with principles 2, 3 | B (old rules) / gap (2024 rules) | Owner/architect fork; moderation incl. Russian law |
| Romance Club / otome fan groups on VK | 0 RUB or paid posts via admins (unknown price) | Medium (per-group negotiation) | Very high (exact genre) | C | Each group's own rules; the competitor's fandom |
| Telegram-channel influencers (books/romance/anime) | ~2.8 RUB per view (news/marketing niche, 2025-26, CLAIMED); catalog placement ~7,964 RUB avg (Apr, CLAIMED) | Medium | High: click goes straight into the TMA | C | Niche prices not found; ERID; channel reach hit by throttling |
| Influencer marketplaces (Perfluence, Epicstars, GetBlogger) | Perfluence free for advertisers (CPA/CPM); others from 2,000-5,000 RUB subscription (Jun 2026, CLAIMED) | Low-medium | Medium-high | C | Use for micro-bloggers in VK/Telegram |
| Rutube / Rutube Shorts (ex-Yappy) | 0 RUB organic | Medium | Medium (audience age/gender unknown) | C | Merger planned H1 2026 |
| YouTube / Shorts (RU audience) | 0 RUB organic; ~1.53 RUB/view integrations (CLAIMED) | Medium | Low-medium for RU (throttled to ~20 %, CLAIMED); medium for EN | C | VPN-dependent in RU |
| TikTok (RU) | n/a: no uploads from RU accounts, no RU ad cabinet (2026-01, CLAIMED) | — | Low for RU creators; EN #otome / BookTok via non-RU accounts only | C | Legal status: not banned |
| Instagram Reels (RU) | Blocked; ads restricted by law (area 06) | — | Excluded for RU | A (block) | |
| Twitch / VK Play Live streamers | Unknown | Medium (outreach) | Medium (VN let's-plays fit; female share unknown) | C | No RU VN streamer data |
| Habr dev story | 0 RUB | Medium (one strong technical article) | Low audience fit (devs), high credibility/backlinks | A (rules) | Promotion banned; one store link allowed |
| DTF "Инди" devlog | 0 RUB | Low-medium | Low-medium (gamer, male-skewed: unverified) | A (2019 rules) | Commercial promo posts banned |
| Pikabu | 0 RUB / paid ads | Low | Unknown | C | Rules not readable |
| Ficbook / Litnet / Author.Today | Unknown | Medium | High topical fit (romance readers, fanfic) | C (2022 traffic) | Rules not read; teens likely present (unverified) |
| r/otomegames, r/visualnovels (EN) | 0 USD | Low | Medium for EN line | C (mirrored rules) | Weekly slot / announcement-type posts only |
| itch.io page + devlogs (EN) | 0 USD | Medium | Low unless a playable non-Telegram demo exists | A (guidelines) | Link-only pages lose discovery |
| itch.io jams (Otome/Josei Apr-Jul; Yuri Oct-Dec) | 0 USD | Medium-high (a demo per jam) | Medium for EN | A (Otome Jam rules) | AI content banned; screenshots required |
| VNDB entry | 0 USD | Low | EN discovery; needs ≥ 50 % VN reading | A (guidelines) | After a public chapter; Telegram platform field unverified |
| Discord server | 0 USD | Medium | EN only (blocked in RU since 2024-10-08) | A (block) | |
| Bot waitlist + devlog channel | 0 Stars within free limits | Low-medium | High (owned channel) | A (Bot API/Terms) | Needs explicit opt-in; no spam |
| VK Donut / Boosty | VK Donut volume 718 M RUB Q1 2026; Boosty fee unknown | Medium | Medium (community funding) | A (VK IR) / C | Second payment rail next to Stars: an owner question |

## Applicability to tg-app-novel (map onto §2 planned features; product feature asks, listed not designed)
- **Invite link / attribution (M10-M11).** Every off-Telegram channel needs its own `start_param` source code.
  Without it, off-platform spend cannot be measured. `start_param` is already carried in signed initData [38].
  Product ask: campaign codes, as distinct from friend invite codes, and a per-source newcomer count.
- **Share (M14).** Off-Telegram posts on VK, Rutube or forums can only carry a `t.me` link. A public landing page
  (the planned public privacy-policy host) with story art and a `t.me` button would give VNDB, itch.io and press a
  URL that is not a bot. Product ask: a static public page per story. It must stay free of paid art (principle 0).
- **Waitlist.** Users who open the Mini App via `startapp` without pressing /start have not messaged the bot. They
  can be messaged only after `requestWriteAccess` [37][38]. Product ask: an explicit "notify me about new chapters"
  opt-in, stored server-side, that respects §6.2.5 [36] and the 152-FZ consent work in M12-M13.
- **Referral (M23) and influencer deals.** Influencers usually want per-creator links and reports. A per-campaign code
  in `start_param` serves that; the Telegram Affiliate Program (MV11) is the alternative (area on referrals).
- **VK second distribution.** It conflicts with **principle 2** (Stars only, `currency = "XTR"`): VK historically
  required votes. It also conflicts with **principle 3** (auth is initData): VK has its own launch-signature scheme,
  not researched here. And with **principle 6** (one Telegram client module). A port is an architecture change, not
  a promotion task.
- **itch.io / jams.** A playable itch.io build would need a non-Telegram auth and payment path, or a free, offline
  demo build of a short story. The second option touches principle 0 only if paid content leaks; a demo built only
  from free chapter content would not. Architect fork.
- **Localization (principle 8).** The EN channels (Reddit, itch.io, VNDB, jams) need the English tables complete for
  at least chapter 1 of one story before any EN outreach.
- **Puzzle layer vs VNDB.** If puzzles and exploration take more than ~50 % of play, VNDB listing is unlikely [1].
  That is a design input for the narrative/gameplay balance, if VNDB matters.

## Pitfalls / what goes wrong (sourced)
- **Russian law and LGBT content.** A romance product can be removed from Russian distribution over LGBT content:
  Romance Club's store pages were blocked in 2024 [31], and it came back only as a version without same-sex routes
  [30]. This bears on VK moderation, which checks Russian law [21], and on ad moderation (area 06).
- **Throttled destination.** Paid traffic to a `t.me` link from Russia lands in a messenger RKN is degrading
  [16a][16c]. Budgets may buy clicks that fail to load.
- **Link-only pages.** On itch.io they can be dropped from discovery [3]. Reddit removes self-promotion outside
  designated threads [10].
- **Waitlist misuse.** Messaging users who never opted in breaks Terms §5.2(b) and §6.2.5 [36].
- **Commission.** VK's currency rule made developers give up 45 % (2021) [23], against Telegram Stars (area on
  economics).
- **Stale benchmarks.** Many "2026" Russian pages show the render date in the header, not the publication date. One
  "June" Mediascope article turned out to be from 2018 (observed during this research; kod.ru). Every number here
  carries the date found in the article body.
- **AI content.** AI-generated assets disqualify Otome Jam entries [4] and must be disclosed on itch.io [3].

## Key claims for verification
1. RKN confirmed restricting Telegram on 2026-02-10 — https://novayagazeta.eu/articles/2026/02/10/telegram-snova-blokiruiut-v-rossii — DOCUMENTED (press report of an RKN statement).
2. Mediascope Dec 2025: Telegram 93.6 M monthly / 74.3 M daily in Russia — https://ppc.world/news/obem-reklamy-v-telegram-v-2026-godu-snizitsya-na-fone-ogranicheniy-rkn-prognozy-ekspertov/ — CLAIMED (press citing Mediascope).
3. VK Q1 2026: 93.4 M MAU, 62.7 M DAU; VK Clips 3.4 B daily views; VK Video 82.6 M MAU; VK Donut 718 M RUB — https://m.vk.ru/press/q1-2026-results — DOCUMENTED (company IR).
4. VK Ads Q2 2026 YoY: CPM +33.15 %, CPC +0.99 % — https://www.sostav.ru/blogs/275971/101204 — CLAIMED (vendor panel).
5. VK votes mandatory for virtual goods in mini apps, 45 % commission (2021) — https://kod.ru/vkontakte-mini-apps-golos/amp — CLAIMED (press, dated 2021); the current rule is unknown.
6. TikTok: no uploads from Russian accounts, no ad cabinet; 69.3 M MAU (Mar 2025) — https://www.unisender.com/ru/blog/tiktok-v-rossii-chto-proiskhodit-s-platformoj/ — CLAIMED.
7. Discord restricted in Russia on 2024-10-08 — https://therecord.media/discord-messaging-app-banned-russia-turkey — DOCUMENTED (press of an RKN statement).
8. Romance Club returned to Russia in May 2026 without same-sex routes; ~1.5 M VK subscribers — https://appleinsider.ru/obzory-prilozhenij/klub-romantiki-na-iphone-kak-skachat-i-igrat-v-rossii.html — CLAIMED.
9. VNDB hybrids need ≥ 50 % VN-style reading — https://vndb.org/d2 — DOCUMENTED.
10. itch.io: link-only pages discouraged and may be removed from discovery — https://itch.io/docs/creators/quality-guidelines — DOCUMENTED.
11. Otome Jam 2026 rules: WIP OK, commercial only with a demo, AI banned, window Apr 30 - Jul 1 — https://itch.io/jam/otome-jam-2026 — DOCUMENTED.
12. Paid broadcasts: 1000 msg/s, 0.1 Star per message over 30/s, needs 100 k Stars + 100 k MAU — https://core.telegram.org/bots/faq — DOCUMENTED.
13. `requestWriteAccess` (Bot API 6.9) asks permission for the bot to message the user — https://core.telegram.org/bots/webapps — DOCUMENTED.
14. Telegram CPV average 2.80 RUB (news/marketing); YouTube entertainment ~1.53 RUB — https://workspace.ru/blog/skolko-stoit-reklama-u-blogerov-v-2026-godu-ceny-i-kak-ne-pereplatit/ — CLAIMED.
15. Habr: games may link to an app store; otherwise promotion only in company blogs or the one-time "I'm advertising" hub (rules 2026-07-08) — https://habr.com/en/docs/help/rules/ — DOCUMENTED.

## Gaps (asked but no reliable source found)
- Exact current r/visualnovels, r/RenPy and r/interactivefiction rules (Reddit unfetchable); Reddit's status in
  Russia 2026; Lemma Soft promotion subforum rules (HTTP 403); Tumblr otome community (not researched).
- VK Mini Apps placement rules of 2024-04-22: the current payment rule, commission and external-link policy (dev.vk.ru
  HTTP 500); VK minimum user age; whether VK Ads accepts `t.me` landings; OK, Дзен, Rutube and Pikabu audience, ad
  prices and promotion rules.
- Demographics (gender/age) of Ficbook, Litnet, Author.Today; their rules on promoting games; Litres Samizdat; Russian
  BookTok size.
- Russian VN/otome let's-players and female-audience book/anime bloggers by name and price; micro-influencer prices
  in those niches; VK Play Live 2026 audience; Twitch's 2026 legal status in Russia.
- Waitlist→launch conversion numbers; how indie games grow a Telegram channel pre-launch (no dated case found);
  whether StopGame, Igromania or DTF editors cover Telegram games; Boosty's current commission; Patreon's status for
  Russian creators.
- An indie VN that grew on TikTok/BookTok/Wattpad with numbers.
- Whether VNDB accepts a Telegram-only release (no rule either way).
- Telegram's App Store availability in Russia after April 2026 (CLAIMED in a search summary only).
- Cause: the shared web-search budget was exhausted. A follow-up session with fresh searches can close most items.

## Owner value questions this area raises (each with a default reading)
- **OWNER: Is the English line promoted at launch or later?** Default: later. EN outreach (Reddit slots, itch.io jams,
  VNDB) waits for complete EN tables and a public free chapter.
- **OWNER: Is a second distribution on VK (votes, VK auth) in scope?** Default: no. It conflicts with principles 2 and
  3; revisit only if Telegram's Russian reach keeps falling.
- **OWNER: Is a free, non-Telegram web demo (itch.io / jams) acceptable?** Default: no until the architect sizes it.
  If yes, only free content, never paid chapters (principle 0).
- **OWNER: Budget for paid influencers and VK Ads?** Default: none before the public bot exists. Test sizes quoted in
  the market start at 10-20 k RUB for VK Ads [20].
- **OWNER: Is a second community-money rail (VK Donut / Boosty) wanted besides Stars?** Default: no. Principle 2
  keeps the product's payments Stars-only; a creator-patronage page would sit outside the product.
- **OWNER: Same-sex romance routes?** Default: none until the jurisdiction and age bracket are decided (Q21, area 06).
  Romance Club's 2024 block and its 2026 return without such routes show the Russian enforcement pattern [30][31].
- **OWNER: Teens 13-17 or adults?** Default: undecided. It changes which fandom groups and ad targeting are legal
  (area 06).

## Sources
[1] https://vndb.org/d2 — VNDB "Adding/Editing a Visual Novel" inclusion guidelines; read 2026-10-31 (site v2.30-165); the database's own rules.
[2] https://vndb.org/d3 — VNDB release guidelines (media types, DRM, release types); read 2026-10-31.
[3] https://itch.io/docs/creators/quality-guidelines — itch.io creator quality guidelines; read 2026-10-31; official.
[4] https://itch.io/jam/otome-jam-2026 — Otome Jam 2026 page and rules; read 2026-10-31; organizer page.
[5] https://itch.io/jam/josei-jam-2026 — Josei Jam 2026 (listing only; dates from the search result).
[6] https://itch.io/jam/o2a2-2026 — O2A2 2026 jam rules; read 2026-10-31.
[7] https://itch.io/jam/yuri-jam-2026 — Yuri Jam 2026 (listing: 2026-10-01 → 2026-12-01).
[8] https://itch.io/jam/trans-otome-jam — Trans Otome Jam (listing: 2026-11-01 → 2026-12-01).
[9] https://itch.io/jam/valenpy-2027 — ValenPy 2027 (listing: 2027-02-02 → 2027-02-14).
[10] https://reddit.sudovanilla.org/r/otomegames/wiki/rules/selfpromotion — mirror of the r/otomegames self-promotion wiki; seen as a search snippet 2026-10-31, page 404 on fetch; undated; CLAIMED.
[11] https://lr.in.psf.lt/r/visualnovels/wiki/rules — mirror of the r/visualnovels rules wiki; search snippet; fetch failed (TLS); undated; CLAIMED.
[12] https://redship.io/blog/reddit-self-promotion-rules-2026 — vendor guide to Reddit self-promotion, 2026-03-15 (upd. 2026-07-02); pointer only.
[13] https://therecord.media/discord-messaging-app-banned-russia-turkey — The Record, 2024-10-09; Discord restricted 2024-10-08, NetBlocks confirmation.
[14] https://kod.ru/youtube-traffic-in-russia-has-fallen-to-a-critical-20 — Kod, 2024-12-23 (upd. 2025-05-23); YouTube traffic "to 20 %" per Digital Report; CLAIMED.
[15] https://www.unisender.com/ru/blog/tiktok-v-rossii-chto-proiskhodit-s-platformoj/ — Unisender explainer, 2026-01-20; TikTok status, ads, Mediascope Mar 2025; CLAIMED.
[16a] https://novayagazeta.eu/articles/2026/02/10/telegram-snova-blokiruiut-v-rossii — Novaya Gazeta Europe, 2026-02-10/11; RKN statement on Telegram restrictions.
[16b] https://3dnews.ru/1135388 — 3DNews, 2026-01-16; partial Telegram slowdown.
[16c] https://www.bitrix24.ru/journal/blokirovka-telegram/ — Bitrix24 explainer, upd. 2026-08-06; state of Telegram restrictions (content as of ~Apr 2026).
[16d] https://ppc.world/news/obem-reklamy-v-telegram-v-2026-godu-snizitsya-na-fone-ogranicheniy-rkn-prognozy-ekspertov/ — ppc.world, 2026-02-11; Mediascope Dec 2025 Telegram audience, ad forecasts.
[17] https://m.vk.ru/press/q1-2026-results — VK Q1 2026 results press release, 2026-05-21; company IR with Mediascope notes.
[18] https://www.sostav.ru/blogs/292667/98255 — Sostav blog "VK audience in 2026", 2026-07-28; CLAIMED.
[19] https://www.sostav.ru/blogs/275971/101204 — click.ru Q2 2025 vs Q2 2026 ad metrics, 2026-08-13; vendor panel.
[20] https://workspace.ru/blog/skolko-stoit-reklama-v-vk-ads-v-2026-godu-byudzhet-na-test-zayavki-markirovku-i-dokumenty/ — Workspace guide to VK Ads cost 2026 (no explicit date); CLAIMED.
[21] https://dev.vk.ru/en/games/faq — VK for Developers games FAQ; read 2026-10-31; official.
[22] https://dev.vk.ru/en/games-catalog-rules — VK games catalog rules (marked obsolete; replaced 2024-04-22); search snippet only, HTTP 500 on fetch 2026-10-31.
[23] https://kod.ru/vkontakte-mini-apps-golos/amp — Kod, 2021-07-21; VK votes requirement and 45 % commission.
[24] https://dev.vk.ru/en/mini-apps/catalog/getting-started — VK Mini Apps catalog getting-started; read 2026-10-31; official.
[25] https://habr.com/en/docs/help/rules/ — Habr rules, last edited 2026-07-08; official.
[26] https://dtf.ru/rules — DTF rules, dated 2019-07-10; official. Also https://dtf.ru/gamedev/133167 (Gamedev subsite concept; search snippet).
[27] https://pikabu.ru/information/rules — Pikabu rules; read 2026-10-31; text garbled, structure only.
[28] https://author.today/post/310553 — Author.Today user post with Similarweb visits for literary sites, 2022-10-06; CLAIMED, stale.
[29] https://kommersant.ru/doc/8338995 — Kommersant, 2026-01-11; 2025 Russian book market.
[30] https://appleinsider.ru/obzory-prilozhenij/klub-romantiki-na-iphone-kak-skachat-i-igrat-v-rossii.html — AppleInsider.ru, 2026-05-19; Romance Club's return to Russia.
[31] https://novayagazeta.eu/en/articles/2024/07/16/hopeful-romantics-en — Novaya Gazeta Europe, 2024-07-16; Romance Club community and its removal.
[32] https://workspace.ru/blog/skolko-stoit-reklama-u-blogerov-v-2026-godu-ceny-i-kak-ne-pereplatit/ — Workspace, 2026 (study Jul 2025-Jul 2026); influencer CPV; CLAIMED.
[33] https://adindex.ru/news/releases/2026/07/7/346977.phtml — AdIndex press release, 2026-07-08; Technology Index 2026 award for Perfluence; CLAIMED.
[34] https://www.sostav.ru/blogs/284610/68792 — Streamers Alliance blog, 2025-10-08; Twitch Russia figures; CLAIMED.
[35] https://core.telegram.org/bots/faq — Telegram Bots FAQ (broadcast limits, paid broadcasts); read 2026-10-31; the contract.
[36] https://telegram.org/tos/bot-developers — Telegram Bot Platform Developer Terms §5.2, §6.2.5; read 2026-10-31; the contract.
[37] https://core.telegram.org/bots — Telegram bots introduction ("Bots can't start conversations"); read 2026-10-31.
[38] https://core.telegram.org/bots/webapps — Mini Apps docs (`requestWriteAccess`, `allows_write_to_pm`, `startapp`); read 2026-10-31.
[39] https://core.telegram.org/bots/api-changelog — Bot API changelog; latest 10.3 (2026-08-24); 7.11 (2024-10-31); 2026-07-14 entries.
[40] https://vc.ru/services/3036304-boosty-kak-oformit-podpisku-i-oplatit-v-rossii — vc.ru on Boosty payments from Russia (2026); CLAIMED.
[41] https://en.wikipedia.org/wiki/Internet_censorship_in_Russia — Wikipedia; Instagram/Meta dates, the 2025 law on searching for extremist content; read 2026-10-31; secondary, cites Reuters/Guardian/BBC.
[42] https://en.wikipedia.org/wiki/Love_and_Deepspace — Wikipedia; downloads/revenue citing Sensor Tower, Polygon (to 2026-08); secondary.
[43] https://company.wattpad.com/ — Wattpad company page (© 2026); official, no numbers.
[44] https://dtf.ru/indie/1030352-pervoe-pravilo-indi-razrabotchika — DTF Indie user post, 2022-01-12; opinion.
[45] https://ppc.world/news/rutube-premier-i-yappy-stanut-edinoy-videoplatformoy/ — ppc.world, 2025-06-19; Yappy → Rutube Shorts, merger H1 2026.
