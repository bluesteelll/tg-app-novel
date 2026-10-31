# Promotion research C1: completeness critique of reports 00-07

Date 2026-10-31. Read: 00-CONTEXT, 01-07 (TL;DR, findings, channel rows, applicability, gaps, owner questions; bodies
where needed). Not yet available: 08-markets-and-hedges, V1-V3. Overlaps with them are noted per finding. External
checks by this critique: 3, listed under Sources at the end. Line numbers are `report:line` in this directory.

**Result: CRITICAL 3, IMPORTANT 8, MINOR 10.** The area coverage is broad and well labelled. The weak points are the
Russian market-access facts, which contradict each other across reports; the Russian buyer's route to Stars, which no
report researched; budget tiers priced on channels that are legally time-boxed before any plausible launch; and the
target audience, which was assumed, not researched. Every report says the shared search budget ran out, and the
unanswered items cluster on Russian-language and audience-specific queries (M10).

## 1. Coverage matrix

| # | Commissioned item | Status | Where | What is missing |
|---|---|---|---|---|
| 1a | Apps tab / search / Popular apps | COVERED | 01 A1 (01:63-98) | Ranking formula, per-language lists (01:398-399) |
| 1b | Main Mini App | COVERED | 01 A2 (01:100-105) | — |
| 1c | BotFather media previews / listing requirements | PARTIAL | 01 A2 (01:106-126) | Preview formats, sizes and durations undocumented (01:115) |
| 1d | Gaming Platform | COVERED | 01 A3 (01:128-143) | — |
| 1e | Third-party catalogs | PARTIAL | 01 B (01:173-207) | Russian catalogs: one search only (01:207, 01:406-407) |
| 1f | Telegram Ads minimums | COVERED (CLAIMED reseller data) | 02 §1-2 (02:54-162); 07:261-269 | — |
| 1g | TON / Stars payment for ads | COVERED | 02:77-95; 06:55; 07:117-120 | 02 and 01/06/07 disagree on the evidence label (W8) |
| 1h | Ad targeting | COVERED | 02:97-105 | — |
| 1i | Ad rules for bots / Mini Apps | COVERED | 02:107-117; 06:296-301 | Whether `startapp` links are accepted destinations (02:378-379; W7) |
| 1j | Observed CPM / CPC | PARTIAL | 02:121-147; 07:261-269 | Nothing MEASURED (02:246-252); no niche data (02:369-370) |
| 1k | Paid channel posts, exchanges | PARTIAL | 02 §3 (02:164-196); 06:345; 07:270-273 | Exchange terms come from a sponsored article (02:171); fraud checks not researched (02:191-192); prices conflict about 10x (W4) |
| 1l | Mini-App ad networks, cross-promo | PARTIAL | 02 §4 (02:198-244) | Cross-promo exchanges; Monetag/Adexium advertiser terms (02:371-373); no retention data |
| 1m | Affiliate Programs: terms, fit | COVERED (uptake gap) | 01 C (01:209-275); 06:354 | Whether ref links open the app or the chat (01:402); uptake data (01:404) |
| 2a | shareMessage, shareToStory, startapp, inline, groups/channels | COVERED | 03 §1 (03:48-68) | — |
| 2b | Measured K benchmarks | PARTIAL | 03 §2 (03:70-117) | No TMA K at all (03:277); cross-industry figures CLAIMED |
| 2c | Referral anti-abuse | COVERED | 03 §3 (03:119-148) | — |
| 2d | Mapping onto completion card, friend stats, gifts, 5-hint referral | COVERED | 03 Applicability (03:185-243) | Reward size not analysed (M7) |
| 3a | r/visualnovels and other Reddit communities | PARTIAL | 04:56-70 | Rules come from undated mirrors; Reddit could not be fetched |
| 3b | VNDB | COVERED | 04:72-83 | — |
| 3c | Lemma Soft | MISSING | 04:104 (HTTP 403) | Everything |
| 3d | itch.io | COVERED | 04:85-102 | — |
| 3e | Discord | COVERED | 04:107-111 | — |
| 3f | VK | PARTIAL | 04:130-161 | Whether VK Ads accepts t.me landings, VK minors rules, current mini-app rules (04:143, 04:348-349; 06:263) |
| 3g | Pikabu | MISSING | 04:177-178 (rules garbled) | Everything |
| 3h | DTF | COVERED (2019 rules) | 04:170-175 | — |
| 3i | TikTok / Reels / Shorts / VK Clips | PARTIAL | 04:21-26, 04:121-127; 05:228-238 | Availability only; no story-app performance numbers (04:358; 07:242-243) |
| 3j | Streamers and influencers | PARTIAL | 04 §3 (04:203-223) | No VN or female-audience creators; no niche prices (04:353-354) |
| 3k | Devlog channel and pre-launch waitlist | PARTIAL | 04 §4 (04:225-250) | Mechanics only; no conversion or growth case (04:355-356) |
| 4a | Narrative TMA case | PARTIAL (negative result) | 05 §1 (05:67-117) | "None exists is a search result, not proof" (05:80-82); TGStat not queried; leads not followed (M6) |
| 4b | Episode / Choices / Chapters | PARTIAL | 05 §2c (05:197-211) | Chapters monetization; Episode demographics (05:428-439) |
| 4c | Cliffhanger creatives | PARTIAL | 05:162-167, 05:237-238 | No creative breakdowns (05:429-431, 05:440-441) |
| 4d | Free-chapter paywall funnels | PARTIAL | 05 §3 (05:259-306) | No conversion figure, proxies only (05:433); conflicts with 07 (W3) |
| 5a | ERID / ORD | COVERED | 06 §1.2-1.3 (06:91-123) | — |
| 5b | RKN registration for >10k; ad ban in unregistered channels | PARTIAL | 06 §2.1 (06:149-160) | Whether Telegram counts as a "social network" under 149-FZ art. 10.6 (06:156-158); likely a V3 item |
| 5c | Ad bans on blocked / restricted platforms | COVERED | 06 §2.2-2.4 (06:162-205) | 2027 position (K3) |
| 5d | Telegram Ads policies; Stars and Mini App terms | COVERED | 06 §4 (06:265-301); 02:107-117 | — |
| 5e | EU basics | PARTIAL | 06 §5 (06:303-337) | DFA status, DSA text, UCPD Annex I (06:446-447) |
| 5f | Age rating (INTERPRETATION) | COVERED for law, PARTIAL for commerce | 06 §3 (06:207-263) | Game-law bill (06:248-249); whether teens can lawfully pay (W2) |
| 6a | D1 / D7 / D30 | PARTIAL | 07 §1 (07:66-83) | All-genre figures only |
| 6b | Chapter-1 completion | MISSING | 07:303 | Only an ASSUMPTION |
| 6c | Paywall conversion | PARTIAL | 05:272-281; 07:304 | Proxies only; 05 and 07 disagree (W3) |
| 6d | ARPPU in Stars | PARTIAL | 07:135-148, 07:309 | Derived from assumptions |
| 6e | Referral K | PARTIAL | 03:72-83; 07:63 | No TMA K |
| 6f | Soft launch | COVERED | 07 §4 (07:198-256) | Organic volume (W5) |
| 6g | Creative A/B testing | PARTIAL | 07:233-243 | Sample sizes only; no Telegram Ads A/B tooling (07:431) |
| 6h | Budget tiers with sourced CPI/CPM | PARTIAL | 07 §5 (07:258-333) | Priced on legally time-boxed channels (K3); post prices conflict (W4) |
| R1 | Output: channel comparison table | Inputs present, need reconciling | Channel rows of 01-07 | Duplicate rows with conflicting cost and fit (K3, W4); effort scales differ (M5) |
| R2 | Output: phased plan with budget tiers | Inputs PARTIAL | 07 §4-5; 04 §4; 06:21-28 | Launch window vs the FAS deadline (K3); organic volume (W5) |
| R3 | Output: feature asks mapped to the design | COVERED | Applicability sections of all reports | Dedupe the campaign-code ask (02:278-283, 04:289-291, 05:348-350, 07:352-355) |
| R4 | Owner questions: budget | COVERED | 02:384-387; 05:451-453; 07:439-445 | — |
| R4 | Owner questions: region / language | PARTIAL | 01:423-424; 06:453-455; 07:452-453 | Depends on K1 and K2; 08 pending |
| R4 | Owner questions: audience | PARTIAL | 04:376-377; 05:449-450; 06:456-458 | Age bracket is asked; the audience itself was not researched (W1) |
| R4 | Owner questions: timing | PARTIAL | 06:21-28; 04:38-41; 05:454-455 | No launch-window analysis (K3); no seasonality (M4) |
| R4 | Owner questions: brand / persona | MISSING | only the bot username (01:425-426) | Everything else (M3) |

Judgement items:
- **(a) Omissions:** K2, W5, W6, M2, M3, M8.
- **(b) Contradictions:** K1, K3, W3, W4, W7, W8 (ad-credit label), M1.
- **(c) Evidence quality:** W8.
- **(d) The romance-for-girls audience** was assumed, not researched: W1.
- **(e) The age bracket:** W2.

## 2. Findings

### CRITICAL

#### K1. Reports 01, 02, 04, 06 and 07 describe Telegram's reach in Russia (the premise of "Russian first") in four incompatible ways
- **Evidence:**
  - 01:56-58: "By 2026-03-17, Meduza reported Telegram 'largely inaccessible' nationwide, with VPNs of little help".
    The report adds that the situation after March 2026 "was not established (search budget exhausted)", and its
    pitfalls repeat "near-total inaccessibility" (01:364).
  - 02:34-35 and 02:149-150: Mediascope counted "94 M (March 2026) to 76 M (June 2026, 12+)", and "Channel reach
    kept above 60% of January levels" (SA Media). 07:43-44 repeats this and blames the drop on "blocks plus a
    seasonal dip".
  - 06:192-198 gives a dated timeline:
    - OONI measured blocking on many ISPs from 2026-03-20.
    - Durov said "65 M Russians use Telegram via VPN" (2026-04-04).
    - Channels "reportedly lost ~half their audiences" (2026-04/05).
    - On 2026-09-28: "throttled not banned".
  - 04:117-119: "message delays and media failures in all regions and no official full-block date" (updated
    2026-08-06).
  - App Store availability:
    - 04:14 and 04:360 call "an April 2026 App Store disappearance" CLAIMED.
    - 07:101 read the Russian App Store listing on 2026-10-31 and quotes Stars prices from it (209 ₽ per 100),
      labelled DOCUMENTED.
- **Consequence:** the synthesis must pick one picture.
  - "Largely inaccessible, VPN of little help" (01) removes Russia as a launch market.
  - "-19 % MAU, channel reach above 60 %" (02, 07) keeps Russia as the default.
  - Whichever is picked silently drives every RU channel row, the tier table and the region/language owner question.
    The two readings also disagree on whether a Russian player can reach a TMA at all (VPN of little help vs 65 M
    on VPN).
- **Confidence:** CONFIRMED that the reports contradict each other as quoted.
- **What the synthesis must do:**
  - **Reconcile.** Use 06 §2.4 as the dated spine; its latest item is 2026-09-28. Mark 01's Russia bullet as
    superseded, since its sources stop at 2026-03-17.
  - Quote the last measured audience: Mediascope June 2026, 76 M, 12+, CLAIMED via press. State that no Jul-Oct 2026
    measurement was found.
  - Mark App Store availability as contradicted: 07's listing read suggests it is live.
  - **Research more:** "What measured Telegram audience in Russia exists for Jul-Oct 2026 (Mediascope, OONI or
    similar), and what share connects via VPN or proxy?"
- **Overlap:** 08 covers the hedges (non-RU Russian speakers, MAX/VK), not this fact. V1 may re-check the Mediascope
  numbers.

#### K2. No report researched how a player in Russia buys Telegram Stars, though it gates every RU paywall figure
- **Evidence:**
  - 01:59: "Russians also cannot easily buy Stars in-app. SEO articles CLAIM SBP-based resellers as the common route".
    The table row at 01:292 says the same.
  - 07:105 lists four routes: "App Store ≈ 2.5-3 ₽/Star, Google Play ≈ 2-2.5 ₽, reseller bots ≈ 1.5-2 ₽". It adds
    that Mir cards are not accepted by the app stores, and that a store purchase needs a foreign account and card. The
    source is labelled "CLAIMED (promotional article for a reseller)".
  - 07:107: the official routes are Apple/Google IAP or @PremiumBot (DOCUMENTED). 07:380-383 notes that buyers fall
    back to reseller bots, and that paywall conversion in Russia "may sit below EN markets; no measurement found".
  - 05:177-178: once store billing failed, Romance Club's Russian players paid "on the official site by UID". That
    is a rail principle 2 excludes for this product.
  - External check by this critique: Google paused Google Play billing for users in Russia on 2022-03-10 (Google
    support page, search result). A 2026 vc.ru article says the pause still holds. If so, the "Google Play
    ≈ 2-2.5 ₽" route at 07:105 does not exist for Russian accounts.
- **Consequence:**
  - Suppose a Russian player has to leave Telegram for a third-party reseller, or buy TON for Fragment, before buying
    chapter 2. Then 07's paywall inputs (2-10 %, 07:304) have no basis for Russia.
  - The break-even, the tiers and the RU-first ordering all carry an unknown multiplier, and no report states what
    share of Russian users can buy Stars at all.
  - Whether reseller "gift" routes are allowed is not examined against the Stars ToS. Stars ToS §4 says Stars "may
    not be sold ... or transferred" beyond the listed uses (06:277-278).
- **Confidence:**
  - CONFIRMED that the route is single-sourced and unresearched (07:105 label; 01:59).
  - PLAUSIBLE that the Google Play route at 07:105 is wrong.
- **What the synthesis must do:**
  - **Mark as gap.** Qualify every RU conversion and ARPPU figure, and feed this into the "Russia first?" owner
    question.
  - **Research more:** "In 2026, which official routes let a user in Russia buy Telegram Stars (App Store payment
    methods, Google Play billing, @PremiumBot card acceptance, Fragment), at what price, and are reseller gift routes
    within the Stars ToS?"
- **Overlap:** not in 08's stated scope. V1 may re-check the 07:101 prices.

#### K3. Budget tiers and the RU paid rows are priced on channels that are legally time-boxed before any plausible launch
- **Evidence:**
  - 06:21-28: paid promotion in Telegram aimed at Russia is "unlawful since 2025-09-01 and only un-fined until
    2026-12-31"; "No FAS statement on 2027 was found". 06:382-383 lists "Treating the FAS transition as legalisation"
    as a pitfall.
  - 02:34-36 frames the same facts as an "unknown legal status from 2027-01-01". That understates 06's reading: the
    ban is in force now, and only the liability is deferred.
  - 07 builds on these channels without the time box:
    - 07:339 rates Telegram Ads (Russia) Fit "High", with no legal qualifier.
    - The tier table (07:329-333) counts starts bought at "€0.17-0.71/start, Telegram Ads".
    - The break-even (07:321-325) compares only Telegram Ads and channel posts.
  - 00:19-22: a prototype with 14 of ~47 lanes merged, no public bot, no launch date, and story and art still open.
  - Fines: 100-500k RUB for a legal entity under KoAP 14.3 part 1, or 0.5-3 M under part 9 if it applies
    (06:110-120).
  - 02:138-139 cites a practitioner who reads Stars-cabinet ads as outside Russian marking. 06:132-137, 06:346 and
    06:377-378 disagree: 38-FZ binds ads aimed at Russian consumers wherever the operator resides, and paying a foreign
    party triggers a 3 % self-withholding.
- **Consequence:**
  - The realistic launch window is 2027. After 2026-12-31, an RU-targeted placement on either of the two channels the
    tier table prices exposes the advertiser of record to KoAP 14.3 fines.
  - A synthesis that copies 07's tiers would put the owner's first spend into the riskiest channel.
  - The lawful RU alternative, VK Ads and VK bloggers with ERID, has an unverified blocker: whether VK Ads accepts
    t.me landings at all (04:143, 04:349), and what its minors rules are (06:263).
- **Confidence:**
  - CONFIRMED that the reports conflict as quoted.
  - The legal reading itself is INTERPRETATION (06:13-14).
- **What the synthesis must do:**
  - **Reconcile** the framing to 06: the ban is in force and only liability is deferred.
  - Mark the RU-Telegram-paid rows "conditional on a FAS 2027 position". Re-base the tiers on channels lawful in 2027
    (VK Ads or VK bloggers with ERID, own channel and shares, Telegram Ads aimed at EN), or show two tier sets.
  - Carry 06's reading of the Stars cabinet, not 02's practitioner reading.
  - **Research more:** "Has FAS stated a 2027 position on ads in Telegram (Oct-Dec 2026), and does VK Ads accept
    creatives that land on t.me bot or Mini App links?"
- **Overlap:** V3 (legal) may re-check the FAS item. The VK Ads question is open only in 04 and 06.

### IMPORTANT

#### W1. The romance-for-girls audience was assumed, not researched
- **Evidence:**
  - 02 found no audience figure:
    - "no number for games, books, romance or girls' audiences"; the only proxy is beauty/fashion (02:29-30,
      02:369-370).
    - The only gender split is Telegram-wide, 56/44 male/female, with no sample size (02:238-239).
  - 03:283-286: the Russian-language romance-community searches were "not run — the session's web-search budget was
    exhausted".
  - 04:16-18 says in its TL;DR that VK "skews female". The basis is a blog with no named source (04:133-134).
    Ficbook, Litnet and Author.Today demographics are a gap (04:351-352).
  - 05:145-146: no age or gender data for Romance Club. Choices data is from 2018 (05:57).
  - 07 uses all-genre benchmarks only.
  - The only direct audience signal: Romance Club communities (VK ~1.4-1.5 M, Telegram channel 700 K+; 05:136-137)
    and fan channels of up to ~80 K (05:77).
- **Consequence:** every "Fit for a romance VN for girls" cell is an analyst's guess. For example, 02:268 rates paid
  posts "High in principle: ... romance/books/anime channels are where the audience is", yet names no channel and
  quotes no price for those niches (02:187). The synthesis table would grade cost evidence A/B while fit, the column
  that drives the decision, has grade-C evidence or none.
- **Confidence:** CONFIRMED.
- **What the synthesis must do:**
  - **Qualify.** Label Fit "hypothesis" unless a row cites audience evidence.
  - Note that Romance Club's 700 K Telegram channel (a 2026 figure) is the strongest sign that the audience is
    reachable inside Telegram.
  - **Research more:** "Where do Russian-speaking girls and young women who play romance VNs (Romance Club, Мои
    истории, Love Sick) gather in 2026: the largest Telegram/VK channels and groups, their age skew and their ad
    price?"

#### W2. The age bracket: the law is covered, the commercial difference is not, and two age notions risk being merged
- **Covered:**
  - 436-FZ categories and 38-FZ art. 6 (06:207-263).
  - No age targeting in Telegram Ads (02:300-304).
  - Teen platform reach in 2024 (03:37-39).
  - Audiences of the cases (05:56-60, 05:365-366).
- **Missing:**
  - **(i) Whether a minor can pay.** Not examined anywhere:
    - Civil Code art. 26/28 "small household transactions";
    - parents' right to invalidate a minor's purchase, and the refund-and-revoke path that follows;
    - app-store family purchase controls;
    - for Russia, K2 on top.
  - **(ii) Teen-channel ad prices:** none found (02:187).
  - **(iii) VK's minimum user age:** a gap (04:349).
  - **(iv) A consolidated teen-vs-adult table.** 00:12-14 required one ("research must cover both and say where they
    differ"); no report delivers it.
  - **(v) Two different age notions:** MV12's minimum *user age* of 14+ (00:47) and 06's default *content category*
    of 16+ (06:455-458). 06 notes they match "only loosely", and the synthesis could easily merge them.
- **Consequence:**
  - The owner would choose a bracket without seeing the trade-off. The 13-17 line may hold the genre's largest
    audience (Choices: ~80 % aged 10-21, 2018).
  - But the same line may have the weakest ability to pay through Stars in Russia, the tightest ad-copy limits
    (38-FZ art. 6; 06:241-246), and parental consent for referral data under 14 (06:252-255).
- **Confidence:** CONFIRMED that payment capacity is a gap. Its size is PLAUSIBLE.
- **What the synthesis must do:**
  - Build the teen/adult difference table from the existing facts. Mark payment capacity as a gap. Keep "minimum user
    age" and "content category" in separate rows.
  - **Research more:** "Can a 14-17-year-old in Russia lawfully and practically buy Stars-priced digital goods (Civil
    Code arts. 26 and 28), and can parents reverse such purchases?"

#### W3. 07's break-even base case contradicts 05's closest proxies, so "paid acquisition loses money" is an artifact of the assumptions
- **Evidence:**
  - 07:19-24 and 07:301-309: base case 40 % completion × 5 % paywall conversion = **2 % start → payer**, and
    $3.90 per payer. 07 concludes that paid acquisition "loses money" at the base case.
  - 05's closest proxies are higher:
    - 5.5 % install → payer within 35 days, the short-drama median, with $23.85 first-month revenue per payer
      (05:46-51, 05:244-252);
    - WEBTOON: a 4.6 % paying ratio and $11.50/month ARPPU (05:275-276);
    - Catizen: ARPPU $30.7 (05:279).
  - 07's own cross-check is AppsFlyer casual D90 ARPPU $7.26 (07:309), about twice its base revenue per payer.
  - 07's "high" case (55 % × 10 % = 5.5 %) equals the short-drama *median*.
  - ANALYSIS: 5.5 % × $7.26 ≈ $0.40 per start, against ≈ €0.25 (≈ $0.28-0.30) per start bought; that is positive.
    WEBTOON's 4.6 % × 07's $3.90 ≈ $0.18 is negative.
- **Consequence:** if the synthesis carries 07's TL;DR as a finding, the owner will read "paid traffic is
  unprofitable" as established. In fact the sign is unknown. It also depends on K2 (Russian friction) and on the
  price owner value.
- **Confidence:** CONFIRMED that the inputs conflict. The ANALYSIS is arithmetic only.
- **What the synthesis must do:**
  - **Reconcile.** Present 07's model as scenarios and add an "analog" row built from 05's proxies.
  - State that the sign of paid ROI is not established, and that the first paid test exists to measure it.
  - No research needed.

#### W4. Telegram channel-post prices differ by about 10x across reports, and 07 uses the high end
- **Evidence:**
  - 02 quotes low CPMs:
    - Q1 2026 paid-post CPM: entertainment 150-300 RUB, news 500-800 (TGStat/Telemetr via [22]; 02:182-183);
    - cost per subscriber 50-240 RUB by niche (02:184-186).
  - 06:345: a CPM of 400-500 RUB in one channel after the April throttling (2026-06).
  - 07 quotes high ones:
    - a CPM of 2,412-4,175 ₽ across three non-game channels eLama sampled, and a Telega.in minimum of 900 ₽
      (07:271-273);
    - its cost per start of "90-240 ₽" uses 900-2,400 CPM (07:290-291, 07:341).
  - ANALYSIS: at 07's own 1 % view → start, a 150-300 RUB CPM gives 15-30 ₽ per start (≈ $0.15-0.33). That is the
    same band as Telegram Ads at €0.17-0.25.
- **Consequence:** the ranking of paid channels in the table, and 07's verdict that channel posts "need the high case
  or better" (07:324), both flip depending on which source the synthesis copies.
- **Confidence:** CONFIRMED.
- **What the synthesis must do:**
  - **Reconcile** into one dated range by niche and channel size. Note that 07's figure is n = 3 non-game channels.
  - Apply K3's legal time box to this row as well.

#### W5. No report estimated organic volume, so the shared default "organic first, measure, then pay" is circular
- **Evidence:**
  - The same default appears in three reports: 02:386-387, 05:452-453, and 07:331 / 07:444-445 ("zero or organic
    until a first cohort clears the scale gates").
  - 07:34-38 sets the sample sizes: ≈ 900 starts to read D1, and ≈ 7,400 starts for one two-arm paywall test.
  - No source says how many starts a new non-crypto TMA gets without paid UA:
    - affiliate uptake: none (01:404);
    - TMA K: none (03:277);
    - cross-industry K ≈ 0.05 (03:247);
    - pre-launch channel growth: no case (04:355-356).
- **Consequence:** suppose organic traffic gives a few hundred starts a month. Then the D1 gate takes months and the
  paywall test never reaches significance. The phased plan would wait, at its gate, for data that does not arrive.
- **Confidence:** CONFIRMED that the estimate is absent. The magnitude is PLAUSIBLE.
- **What the synthesis must do:**
  - **Mark as gap** and state the dependency in the phased plan.
  - The synthesis decides whether soft launch includes a minimal paid measurement tranche on a lawful channel (K3).
  - **Research more (likely to stay a gap):** "Any dated first-90-day user counts for a new non-crypto Telegram Mini
    App without paid UA, featured or not?"

#### W6. No report checked whether the Mini App's own origin loads for Russian users
- **Evidence:**
  - 04:316-317 considers only Telegram's throttling ("Budgets may buy clicks that fail to load").
  - The project layout plans a Cloudflare Worker and R2 for paid assets (project rules, "Later: worker/").
  - Cloudflare's blog of 2025-06-26: since 2025-06-09, Russian ISPs (Rostelecom, Megafon, Vimpelcom, MTS, MGTS) let
    users "load only the first 16 KB of any web asset". Hetzner, DigitalOcean and OVH are reported as affected too
    (external check, Sources).
  - Hosting is part of Q21 (00:20-21), and no report links it to promotion.
- **Consequence (PLAUSIBLE):**
  - Consider a Russian player who reaches Telegram through its in-app proxy rather than a system-wide VPN. If the
    WebView then loads our origin directly from a throttled foreign host, the free chapter stalls after 16 KB per
    asset.
  - Every paid or organic RU start is then lost after the click.
  - Whether Telegram's in-app proxy carries Mini App WebView traffic is unverified.
- **Confidence:**
  - The 2025 throttling is CONFIRMED at source. Its 2026 status and the WebView routing are PLAUSIBLE.
- **What the synthesis must do:**
  - **Mark as gap** and tie it to Q21 (hosting).
  - **Research more:** "In 2026, do Russian ISPs still throttle Cloudflare and other foreign hosts, and does
    Telegram's in-app proxy route Mini App WebView traffic?"
- **Overlap:** not in 08's scope as described.

#### W7. The attribution path for paid Telegram channels is unverified, though it is the measurement backbone
- **Evidence:**
  - 02:44-46: the official pixel covers websites only, and the EUR cabinet reports no conversions.
  - 02:286-287: search ads drop the `start` parameter.
  - 02:378-379: whether the EUR cabinet accepts `t.me/<bot>?startapp=` destinations is "not stated". 06:297-298
    partly closes this: the ad guidelines say the link "may carry start parameters (§3)".
  - Affiliate `?ref=` / `_tgr_` links: whether they open the app or the chat is unknown (01:247, 01:323-324, 01:402).
  - The `start_param` length envelope differs: none stated, or 512 per AdsGram (02:284-285), vs "1-64" (07:210-211,
    07:354-355; research_M2 picks ≤ 64 as a safe envelope).
  - 00:31-32: M11 reads attribution only from the initData `start_param`.
- **Consequence:**
  - If Telegram Ads accept only `?start=` bot links, the campaign code reaches the webhook as `/start <code>`, not the
    Mini App. M11 then records every ad click as unattributed, and no channel CAC can be computed.
  - Only 02:286-287 hints at the needed ask: "a bot /start or menu path that still lands in the Mini App".
- **Confidence:** CONFIRMED that it is unverified.
- **What the synthesis must do:** list these as **test-bot checks**, not web research (see §3). Mark the dependent
  feature asks "pending check".

#### W8. Evidence-quality problems in load-bearing places
- **Mini App reach figures are incompatible:**
  - Telegram, 2024: "500 M of 950 M MAU" use mini apps (01:68).
  - "1.44 B (2024-09) → 150-190 M" (05:63, 05:114-115). The 1.44 B exceeds Telegram's total MAU, so it must be a sum
    of per-app MAUs.
  - 150-190 M in mid-2025 (02:228-229).
  - 102.7 M on findmini, 2026 (01:204).
  - Synthesis: do not quote any of these as a market size without its method caveat.
- **A TL;DR claim on an unsourced blog:** 04:16-18 says VK "skews female", resting on 04:133-134. Qualify it.
- **Stale demographics carry weight:**
  - Choices 2018 Apptopia (05:57, 05:200).
  - Mediascope teen reach from Jan-Jul 2024, before the block, labelled MEASURED with "sample not given" (03:37-39,
    03:158-159).
  - Synthesis: date these in the text.
- **Labels the 00 rule does not support:** 00:66-68 requires a stated sample for MEASURED.
  - RevenueCat's 5.5 % is "MEASURED" with "n not stated" (05:244), and it is the best paywall proxy. Relabel it
    "vendor dataset, n undisclosed".
  - The Zhuang referral result is MEASURED from a seminar abstract only (03:30-35, 03:91-95), yet it drives the M23
    recommendation. Its "conditional" means the invitee must convert, while M23 rewards a free chapter-1 completion.
    Qualify the mapping.
- **Single sources behind the cost model:**
  - The SA Media CPC of €0.12 (02:140-142; 07:262-263) is the sole input to 07's cost per start (07:287-288). It is
    an agency aggregate with no method.
  - The Russian Stars-route table rests on one reseller's promotional article (07:105; see K2).
- **A label conflict to resolve:** 02:380-381 says the $0.02/Star ad credit "rest[s] on one third-party source;
  core.telegram.org gives no values". 01:51-52, 06:55 and 07:117-118 quote the Bot Developer ToS §6.2.3 for the
  same rate (DOCUMENTED). Resolve to DOCUMENTED.
- **Undated or method-less numbers:** RichAds (02:212, "undated"); puzzle CPI "no year" (07:280); VK CPI snippet
  "undated" (04:141); "~30 % of channels cheat", no method (02:189-190). Keep these out of the cost columns, or flag
  them.

### MINOR

#### M1. Reports 04 and 05 disagree on Romance Club's Russia history and age rating
- **Evidence:** 04:193-200 says the game was removed in 2024 and returned in May 2026 "without same-sex routes", with
  an App Store rating of 17+ (snippet). 05:36-37, 05:175-178 and the lessons row at 05:316 say it "refused to cut LGBT
  content" and left, and do not mention the return. 05:135 reads 18+ from the listing directly.
- **Consequence:** 05's lesson ("community praise; store loss") is stale. The current lesson is that returning to
  Russian distribution required cutting same-sex routes.
- **Confidence:** CONFIRMED.
- **Synthesis:** reconcile with 04's 2026 facts, and use 18+ (direct listing read).

#### M2. The giveaway-law handoff fell through
- **Evidence:** 01:307 and 01:419 defer "giveaways involving minors" to the legal area. 06 covers only the art. 9
  disclosure in ads announcing a giveaway (06:143-145). The lotteries law and minors as prize winners were not
  examined.
- **Consequence:** Stars giveaways or contests could be planned without their legal basis.
- **Confidence:** CONFIRMED.
- **Synthesis:** mark as gap and keep 01's default (no giveaways). Low priority.

#### M3. Brand and persona were not researched
- **Evidence:** a required owner question; only the bot username is covered (01:425-426). Nothing on a dev-face vs
  studio brand, character-led accounts or devlog voice. The only related evidence is Romance Club's character memes
  ("Viktor and Lucifer", 05:166-167).
- **Consequence:** the owner question will have no default grounded in evidence.
- **Confidence:** CONFIRMED.
- **Synthesis:** mark as gap and pose the question with a default drawn from the character-meme evidence.

#### M4. Timing has no seasonality data
- **Evidence:** only fixed dates were found: the jam calendar (04:38-41) and the FAS deadline (06:21-28). There is
  one "seasonal dip" remark (07:43-44).
- **Confidence:** CONFIRMED.
- **Synthesis:** mark as gap. Do not invent a launch season.

#### M5. Effort columns use different scales
- **Evidence:** 03 uses XS/S/M/L (03:168-183); the other reports use Low/Medium/High. None states hours.
- **Consequence:** the zero-cash tier's real cost is owner time, and it cannot be compared across rows.
- **Confidence:** CONFIRMED.
- **Synthesis:** normalize to one scale and say that it is relative, not hours.

#### M6. Leads that were found but not followed
- **Evidence:**
  - Story-like TMAs on findmini: "ToonTrek" manga stories (01:200-201) and Roko (05:75). Either could be the
    narrative-TMA case that 05 calls missing.
  - Paid posts in Romance Club fan channels, priced via admins (04:268; 05:77). Price unknown.
- **Confidence:** CONFIRMED.
- **Synthesis:** mark as gap. **Research question:** "What are ToonTrek and Roko (MAU, monetization, Stars use,
  launch date)?"

#### M7. The referral reward's size is not set against the evidence
- **Evidence:** at the placeholder pack prices (00:17-18), 5 hints ≈ 1.5-1.7 Stars ≈ $0.02 of developer value. The
  cited experiments tested $2.50-5 rewards and high/low-value arms (03:86-95). The M23 mapping (03:199-203) discusses
  the split, not the size.
- **Confidence:** CONFIRMED as arithmetic.
- **Synthesis:** add an analysis note. No research needed.

#### M8. Positioning (romance plus horror-puzzle) is not examined as a promotion question
- **Evidence:** the owner wants puzzles "like Resident Evil / Silent Hill" (00:13-14). Frightening content is
  age-restricted (06:238-239), a puzzle-heavy design may fall outside VNDB (04:309-310), and creatives differ by
  positioning. No report tested whether romance-for-girls audiences respond to horror-puzzle positioning.
- **Confidence:** CONFIRMED.
- **Synthesis:** add an owner question ("otome romance" vs "romantic mystery/horror"). Research cannot settle it.

#### M9. The Premium share of the audience is unknown
- **Evidence:** 03:283 and 02:318-319. Premium users never see Telegram Ads (02:15).
- **Consequence:** if payers over-index on Premium, ad reach misses exactly the payers.
- **Confidence:** CONFIRMED.
- **Synthesis:** mark as gap and add a caveat on the Telegram Ads rows.

#### M10. Every report hit the search-budget limit
- **Evidence:** 01:5-7, 02:7-8, 03:6-8, 04:5-8, 05:5-7, 06:10-12, 07:5-6. The unanswered items cluster on
  Russian-language and audience-specific queries (02:371-373, 03:284-286, 04:361, 05:428-431).
- **Consequence:** "none found" for those items means "not searched", not "does not exist".
- **Confidence:** CONFIRMED.
- **Synthesis:** say so in the gaps section; do not present them as negative findings.

## 3. Top gaps worth a gap-fill round (ranked by decision impact)

1. **K1:** "What measured Telegram audience in Russia exists for Jul-Oct 2026, and what share connects via VPN or
   proxy?" This decides whether Russia stays the first market.
2. **K2:** "In 2026, which official routes let a user in Russia buy Telegram Stars, at what price, and are reseller
   gift routes within the Stars ToS?" This decides whether Russian traffic can convert at all.
3. **K3:** "Has FAS stated a 2027 position on ads in Telegram, and does VK Ads accept creatives landing on t.me bot or
   Mini App links (and with what minors rules)?" This decides which paid channels the tier table may price.
4. **W1:** "Where do Russian-speaking girls and young women who play romance VNs gather in 2026: the largest
   Telegram/VK channels and groups, their age skew and their ad price?" This turns the Fit column from guesses into
   evidence.
5. **W2:** "Can a 14-17-year-old in Russia lawfully and practically buy Stars-priced digital goods (Civil Code arts.
   26 and 28), and can parents reverse such purchases?" This is the commercial half of the age-bracket decision.
6. **W6:** "In 2026, do Russian ISPs still throttle Cloudflare and other foreign hosts, and does Telegram's in-app
   proxy route Mini App WebView traffic?" This decides whether a Russian click turns into a loaded chapter (Q21
   hosting).

These need a test bot, not a research round (W7, plus gaps in 01 and 03). The synthesis lists them as "verify before
relying":
- Does Telegram Ads accept `t.me/<bot>?startapp=` destinations, or only `?start=`?
- Does a `?ref=` / `_tgr_` affiliate link open the Main Mini App or the bot chat?
- What is the real `start_param` length on iOS, Android and Desktop (64 vs 65+ characters)?
- What formats and sizes do preview media accept?
- What do gifts cost (`getAvailableGifts`)?
- Can guest-mode results carry buttons?

W3 and W4 need reconciliation in the synthesis, not more research.

## Sources (external checks by this critique, read 2026-10-31)

- [Cloudflare blog, "Russian Internet users are unable to access the open Internet"](https://blog.cloudflare.com/russian-internet-users-are-unable-to-access-the-open-internet/)
  — 2025-06-26. The 16 KB throttling since 2025-06-09; the ISPs named; Hetzner, DigitalOcean and OVH reported as
  affected. Primary for Cloudflare's own measurements. Also pointed to by
  [zona.media 2025-06-19](https://en.zona.media/article/2025/06/19/cloudflare) and [heise](https://heise.de/-10465087)
  (search results, not opened).
- [Google support, "Pausing Google Play's billing system for users in Russia"](https://support.google.com/books/partner/answer/11962641?hl=en-GB)
  — the pause from 2022-03-10. Search-result summary, not opened; its 2026 status is unverified.
- [vc.ru, "Можно ли купить Telegram Premium в России в 2026 году"](https://vc.ru/telegram/3012084-kak-kupit-telegram-premium-v-rossii)
  ("Can you buy Telegram Premium in Russia in 2026") — says Google Play billing is still paused for Russia in 2026.
  Search-result summary only, CLAIMED.
- `D:/tmp/novel-orch/design/choices/research_M2.md:28-31, 90-93` — the `start_param` envelope (community 512, safe
  ≤ 64; Telegram-stated 64 only for bot `start`). Read to check W7.
