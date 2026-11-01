# Promotion of tg-app-novel: research synthesis

**Date:** 2026-10-31. **Status:** research, not a decision. The owner decides; nothing here changes the design docs.

**Scope:** how to promote a Telegram Mini App visual novel sold for Telegram Stars. The main line is romance VNs for
girls and young women aged 14-25 (R4), with an 18+ track behind an age confirmation (R5). Russia is the primary market, reached
through VPN-mediated Telegram use (owner, 2026-10-31); English comes second. Covered: Telegram surfaces, paid and viral
channels, channels outside Telegram, funnel economics, law, a phased plan, product asks and owner questions. Not
covered: hosting design (Q5/Q21), story and art (Q1/Q2).

**Owner rulings applied (2026-10-31 and 2026-11-01, verbatim):**

| # | Ruling | Reading applied in this report |
|---|---|---|
| R1 | «Обрати внимание что это романтические новеллы для девочек это основная» | The main line is romance VNs for a female audience |
| R2 | «В россии все равно все используют vpn и телеграмом все пользуются» | Russia stays the primary market; VPN-mediated Telegram use is assumed |
| R3 | «Про запрет на рекламу и так далее не обращай внимание это допустимо» | The ad-law risk (38-FZ art. 5 p. 10.7 and the related marking rules) is **accepted by the owner**. Russian in-Telegram paid channels are planned as usable; the legal rows stay in §8 as facts, marked "(R3: accepted)", and no phase waits on a FAS position |
| R4 | «Возраст женщины 14-25 лет» | Audience: women aged 14-25 — a dual audience with a 14-17 part |
| R5 | «Возможен эротический и софт порно контент при подтверждении возраста 18+» | An 18+ track with erotic content exists behind an age confirmation; everything a 14-17 user or an unverified user can reach stays minors-safe (§8.5) |
| R6 | «ты ошибаешься на счет российского тиктока. Многие с впна записывают видео на тикток и ютуб. Они живее всех живых» | TikTok and YouTube are live channels for the Russian audience via VPN; short video is a primary organic channel (§4.4, §14). The earlier "TikTok: EN only" row is withdrawn |
| R7 | «Сплит с замером» (2026-11-01, answering P34) | P34 is decided. At the growth phase, traffic that does not come from Telegram Ads is split through our redirect domain: one arm goes through the separate ad bot to the main bot (the gate), the other straight to the main bot, which offers the ad bot once as an opt-in (the satellite). The arm that earns more per new user, Stars plus ads, is kept. Telegram Ads always point at the main bot. F34 conditions apply (§12.1) |

**Owner requests answered later (2026-10-31; research, no ruling yet):** ad monetization on the publisher side —
official Telegram ads and third-party ads, including bots that send their users a daily ad (§12); a Russian payment
system instead of Stars (§13); short video via VPN (§14); a separate entry bot that carries the daily ad and forwards
users to the main bot (§12.1; decided by R7).

What R3 does not change (they are not ad law): Telegram's own ad moderation (Ads guidelines §5.1/§5.4 reject
suggestive or scary creatives regardless of law), exchanges and channel admins that demand an ERID before posting
(a practical gate), buying Stars from Russia, our host's reach without VPN (Q21/Q5), and the content law on the
product itself (§8.5).

## 1. How to read this

- **Labels:** **MEASURED** = data with a stated method or sample (panel data relayed by press = "MEASURED-secondary");
  **DOCUMENTED** = an official doc, terms page, law text, store listing or company filing; **CLAIMED** = a vendor,
  agency, press item, blog, CEO post or search snippet; **ANALYSIS** = our arithmetic on labelled inputs;
  **ASSUMPTION** = an input with no source; **INTERPRETATION** = a legal reading, **not legal advice** — a lawyer
  confirms it before money is spent.
- **Findings vs advice:** "Shows:" marks what the research found; "Recommend:" marks synthesis advice, each naming its
  evidence.
- **References:** `NN §x` = area report and section; `V1/V2/V3 #n` = a verify-pass row; `C1 Kn/Wn/Mn` = a critique
  finding; `N#` = an override note in §3.2. Reports 08 and 09 were written after the first three verify passes; V4
  re-checked them after this synthesis was drafted, and its corrections are applied in place (notes N26-N33).
- **Override rule:** where an area report and a verify pass disagree, the verify pass wins (§3.2 names the report).
- **Conversion assumptions (from 07, not looked up):** € ≈ $1.1-1.2; 90-100 ₽ per $.

**Index of the intermediate reports** (folder `docs/research/promotion/`):

| File | Scope |
|---|---|
| `00-CONTEXT.md` | Product facts, the planned growth features (META-PLAN M10-M23, MV defaults), rules, labels |
| `01-telegram-discovery-affiliates.md` | Apps tab, featuring, Main Mini App, previews, catalogs, the Telegram Affiliate Program |
| `02-telegram-paid-acquisition.md` | Telegram Ads cabinets and prices, Suggested Posts, channel-post exchanges, TMA ad networks |
| `03-viral-social-mechanics.md` | shareMessage, stories, guest mode, Communities, gifts, referral evidence, Telegram terms |
| `04-outside-telegram.md` | VK, Rutube, DTF/Habr/Pikabu, reader platforms, influencers, Reddit/itch/VNDB/jams, waitlist |
| `05-case-studies.md` | Romance Club, Choices/Episode/Lore, short drama, crypto TMAs, the free-chapter paywall |
| `06-legal-constraints.md` | 38-FZ, KoAP, ERID/ORD, 436-FZ age categories, Telegram policies, EU/UK/US basics |
| `07-funnel-metrics-budgets.md` | Metrics, benchmarks, Stars money, analytics, soft launch, break-even, budget tiers |
| `08-markets-and-hedges.md` | CIS markets, Russian access via VPN, MAX / VK platforms, English-first Telegram |
| `09-gap-fill-access-audience-minors.md` | Buying Stars from Russia, where the audience gathers, minors' purchases, host reach, VK/Yandex landings |
| `V1-verify-telegram-money-ads.md` | Adversarial check of 01/02/07: money, ads, break-even arithmetic (CONFIRMED 49, CORRECTED 8) |
| `V2-verify-virality-platforms-cases.md` | Adversarial check of 03/04/05 (CONFIRMED 40, CORRECTED 5, STALE 3) |
| `V3-verify-legal-status.md` | Adversarial check of 06 and of the Telegram-in-Russia claims (CONFIRMED 25, CORRECTED 8) |
| `V4-verify-markets-access-minors.md` | Adversarial check of 08/09 (CONFIRMED 31, CORRECTED 12, UNSUPPORTED 5, MISLABELLED 1) |
| `10-adult-content-age-gate-dual-audience.md` | The 18+ track: art. 242 / 242.1, Telegram and store rules, age-gate options, promotion of 18+, dual-audience precedent |
| `V5-verify-adult-content.md` | Adversarial check of 10 (CONFIRMED 23, CORRECTED 11, STALE 1, MISLABELLED 1, UNSUPPORTED 2); applied in §8.5 |
| `11-ad-monetization-publisher-side.md` | Earning from ads: Telegram's ad revenue share, Mini App ad SDKs, bot broadcast exchanges, hybrid evidence |
| `12-russian-payments-vs-stars.md` | Russian payment rails vs Stars: Telegram's rule, Apple via Telegram, website and hybrid options, merchant duties, economics |
| `13-tiktok-youtube-russia-vpn.md` | TikTok and YouTube in Russia via VPN: audience, posting, links, creator prices |
| `V6-verify-ads-tiktok.md` | Adversarial check of 11 and 13 (CONFIRMED 40, CORRECTED 10, MISLABELLED 3, UNSUPPORTED 2) |
| `V7-verify-payments.md` | Adversarial check of 12 (CONFIRMED 24, CORRECTED 9, STALE 2, UNSUPPORTED 1, MISLABELLED 1) |
| `14-entry-bot-ad-broadcasts.md` | A separate entry bot for third-party broadcasts: what it isolates, account-level sanctions, the extra hop, designs, conditions |
| `V8-verify-entry-bot.md` | Adversarial check of 14 (CONFIRMED 19, CORRECTED 11, UNSUPPORTED 1); applied in 14 and §12.1 |
| `C1-completeness-critique.md` | Coverage matrix, contradictions K1-K3 / W1-W8, the test-bot list |

## 2. Executive summary

1. **First, at zero cash (Recommend):** settle the values every creative carries (age category, brand/persona, bot
   username, prices, advertiser of record); open an owned Telegram channel with a VK mirror and a bot waitlist; ship
   the measurement asks (campaign `startapp` codes, paywall/invoice events, a per-day activity fact) before any spend.
   Own-channel posts are "information", not ads (FAS letter АК/32908/25, V3 #22); no TMA or story benchmark exists
   (07 §1), so our own funnel is the only data.
2. **Russia stays primary; Telegram there is degraded, not gone (Shows):** Mediascope monthly reach 94.3 M (Mar) →
   75.7 M (Jun 2026, 12+); daily reach roughly halved to 33.8-35.4 M (Jun-Aug); MAX (86.3 M) passed Telegram in June;
   Telegram is listed in the RU App Store (2026-10-31). Romance Club's official channel (732 K subscribers, 20.1 K
   average post reach) shows the audience is reachable inside Telegram (09 §2).
3. **The ad law — an owner-accepted risk (R3):** per FAS, ads placed in Telegram aimed at Russia show "signs" of a
   38-FZ art. 5 p. 10.7 violation; liability is deferred only to 2026-12-31 inclusive; no 2027 position found;
   exposure KoAP 14.3 p. 1 = 100-500 k RUB per violation (legal entity); disputed by lawyers, no court practice (V3 #1,
   #4, #6, #20; INTERPRETATION). The owner accepts this risk, so Russian in-Telegram paid channels — above all posts in
   Romance Club / otome fan channels, the best-evidenced audience match (09 §2) — are part of the plan from the soft
   launch.
4. **2/3 — buying Stars (Shows):** degraded, not closed: App Store carrier funding ended 2026-04-01 and Apple's
   payment-methods page lists no Russia entry, but App Store gift cards still work at a markup; Google Play billing
   paused since 2022-03-10 (DOCUMENTED); @PremiumBot takes cards / SBP / SberPay per the one 2026 source opened (it
   covers Premium; Stars unconfirmed — test T7); Fragment crypto-only (no KYC stated); resellers outside the Stars ToS
   (09 §1, V4 #1-#8; N26-N27). RU paywall conversion = unknown × a friction factor < 1 — measure it ("invoice opened →
   paid" by language).
5. **3/3 — our own host (Shows):** foreign hosts are throttled to ~16 KB per connection on major RU ISPs (Cloudflare
   doc, 2026-04-23) and unreachable in mobile whitelist mode (> 60 % of mobile sessions restricted in H1 2026; listing
   needs RU servers); on Desktop the in-app proxy does not carry the Mini App WebView (09 §4). A **hosting item
   (Q21/Q5), not promotion** — but it caps every RU channel's conversion.
6. **Money (Shows, ANALYSIS):** a Star nets $0.013 cash (≈ 65 % of the iOS price) or $0.02 as ad credit for the same
   bot. The base funnel (40 % × 5 % × 3 chapters × 100 Stars) earns **$0.078 per start**; Telegram Ads cost
   **€0.25-1.04 per start all-in** (V1-corrected). Paid acquisition loses at the base case; the sign is not
   established (the 5.5 % analog gives $0.21-0.26, §5.5). At the base funnel a chapter needs ≈ 370-870 Stars to break
   even on Telegram Ads: **price (Q3) is the largest lever**; the 1-Star placeholder makes paid traffic unrecoverable.
7. **Budgets (ANALYSIS):** the small tier ($300-1,000/month) buys ≈ 250-3,600 starts at Telegram-Ads-type costs —
   enough to read D1 (≈ 900 starts), not one paywall A/B (≈ 7,400 starts ≈ €1,850-4,370); the medium tier
   ($3,000-10,000) runs 1-2 paywall tests a month. Organic volume is unsourced, so **plan a small lawful paid tranche
   at soft launch** (C1 W5).
8. **Paid channels for the RU launch (Recommend, with R3):** posts in Romance Club / otome fan channels on Telegram
   and VK (exchanges, Suggested Posts, direct admin deals); Telegram Ads via RU resellers with minors-safe creatives;
   VK Ads to our own landing page (t.me acceptance unverified — one test ad decides); VK and marketplace bloggers;
   Telegram Ads bought with earned Stars. Each still passes the platform's own moderation, and most exchanges demand
   an ERID before posting (a practical gate, not a legal choice).
9. **Do not (Recommend, §8):** point users to Stars resellers (Stars ToS); buy incentivized TMA traffic,
   tapps/findmini slots or Stars giveaways; run suggestive, dating-framed, gruesome or scare creatives on Telegram
   Ads (§5.1/§5.4 — moderation rejects them); show any 18+ material in public or 14-17-reachable places (§8.5); use
   "ask your parents" or peer-shame hooks on a 14-25 audience; run per-user random price tests in Russia (Civil Code
   art. 426); ship same-sex routes in the RU build (content law, risk reading, V3 #29).
10. **Three biggest risks:** (1) RU clicks that cannot pay (Stars friction) or cannot load (host reach); (2) organic
    volume too small to pass the measurement gates (cross-industry K ≈ 0.05, no TMA figure); (3) the 18+ track: the
    content law on the product itself and platform rules on sexual content (§8.5) — not covered by R3. Accepted, not
    managed: the RU ad law (R3).
11. **Owner decisions waiting (§9):** the age-gate method and the 18+ track's scope and brand; real chapter prices;
    budget tier and ceiling; advertiser of record / jurisdiction (Q21); brand/persona; English timing and regions;
    Affiliate Program; referral split; premium choices; influencer funding; ads for hints (P23-P26); a ruble route and
    its merchant (P27-P31); who runs the TikTok account (P32). Decided: audience 14-25 (R4), the ad-law risk (R3),
    short video as a live channel (R6).
12. **The 18+ track (R5, §8.5; INTERPRETATION):** Russian criminal law (UK RF art. 242) has no lawful channel for
    pornography — giving access to even one person is "distribution", so no age-gate or paywall exemption exists, and
    "soft porn" has no legal meaning; an expert decides. Text alone and drawn characters (judged as minors) have been
    convicted. The closest-to-practice RU level is non-naturalistic 18+ erotica, still an expert call. Selling 18+
    products to under-18s is banned (436-FZ art. 16). No age signal a bot can read exists, so the gate is our own
    server flag. Telegram imports Apple/Google rules, judges the promoted product in ads, and may withhold Stars. The
    18+ track lives in a separate bot, never shown in public or 14-17-reachable places, with almost no paid channel.
13. **Short video is a primary organic channel (R6, §14):** TikTok 65.9 M monthly in Russia (Dec 2025) and the
    leader by teen online time (25 % of 12-17 time; VK leads by daily reach, 63 % vs 61 %, 2024); YouTube 65.9 M
    monthly / ~22 M daily (Jan 2026); posting works via a foreign IP; integrations ≈ 1.3-2.6 ₽ per view (all
    press/agency figures, CLAIMED). Cross-post to VK Clips (no VPN). Never say "use a VPN" in clips or briefs (38-FZ
    p. 10.8; R3-accepted, but the first FAS case treated VPN links as ads).
14. **Ads as extra income (§12):** rewarded ads for hints fit the hint economy and monetize players who cannot buy
    Stars; grant only on a server-verified postback. Telegram's own ad share (50 % to bot owners) earns ≈ $0 on
    Russian views (CLAIMED). Bot broadcast exchanges — what the owner saw — ask for the bot token, which would hand over
    login forging and payments: **never from the main bot**. A separate entry bot on another owner account removes
    that objection and is workable under the §12.1 conditions. The isolation is partial (Telegram may also ban the
    account tied to a bot, and the Terms bind the developer); Telegram Ads must point straight at the main bot; the
    exchange also receives our users' IDs. The owner chose a measured split between the gate and the opt-in satellite
    (R7). Ads beat Stars only at very low prices (below ≈ 5.4 Stars per paying user per day, V6).
15. **Russian payments (§13; INTERPRETATION):** inside the bot and Mini App, Stars cannot be replaced — Telegram's
    terms require Stars for digital goods and sanction others by hiding the bot on mobile. A hybrid is the
    rule-compatible path: Stars inside Telegram plus a ruble website outside it (the Romance Club pattern), with no
    link or mention inside the Mini App. Rubles keep ≈ 2× more per 100 ₽ paid (≈ 96-99 ₽ vs ≈ 50 ₽ via Stars, V7).
16. **Verify on the test bot before relying (§10):** Telegram Ads accepting `startapp`; `?ref=` opening the app;
    `start_param` lengths per platform; preview formats; gift prices; @PremiumBot with Russian cards.

## 3. The 2026 landscape

### 3.1 Fact table

| Fact | Value | Label | Date | Source | Verify verdict |
|---|---|---|---|---|---|
| Telegram monthly reach, Russia (Mediascope, 12+) | 94.3 M (Mar) → 88.0 M (Apr) → 80.9 M (May) → 75.7 M (Jun) | MEASURED-secondary (panel via press) | 2026-03..06 | ppc.world 2026-09-15; checkroi.ru 2026-10-18; verstka.media 2026-07-21 | CONFIRMED, relabelled (V1 #23, X13; V3 #11; N3) |
| Telegram daily reach, Russia | 74.3 M (Dec 2025) → 72.2 M (Mar) → 50.3 M (Apr) → 35.4 M (Jun) → 33.8 M (Aug) | MEASURED-secondary; Jun/Aug from a compilation or snippets only | 2025-12..2026-08 | checkroi.ru; Unisender 2026-05-21 | CONFIRMED (V1 #14; V3 #11; V2 #19) |
| MAX monthly reach | 86.3 M, above Telegram for the first time | CLAIMED (press citing Mediascope) | 2026-06 | verstka.media 2026-07-21 | V2 #19 |
| Read Telegram channels (Levada) | 49 % (Mar 2026), down from 53 % (Mar 2025); 25 % name channels their main news source | MEASURED (survey, sample not stated) | 2026-03 | 08 [19] | CONFIRMED (V4 #11) |
| VPN use in Russia | 40 % active users; 18-29: 61 %, 30-44: 50 % (Russian Field poll 2026-04-15..22, n = 1,600, via SecurityLab — not in the Carnegie article 08 cites); other polls 36 % (Feb), 52 % (Jun, n = 1,200) | MEASURED-secondary (poll via press) | 2026-02..06 | 08 [18]; V4 | CORRECTED source (V4; N28) |
| Durov's VPN figure | "65 M Russians daily via VPN" | CLAIMED (an interested party) | 2026-04-04 | novayagazeta.eu (snippet) | CONFIRMED as a claim (V3 #14) |
| OONI blocking | Blocking on Rostelecom, Vimpelcom, MTS and Central Telegraph from 2026-03-20; "not visible on all tested networks"; 95 % of measurements anomalous on 2026-04-10 (denominator undefined) | MEASURED / CLAIMED | 2026-03-30 / 04-10 | explorer.ooni.org/findings/96225549500; meduza.io 2026-04-10 | CONFIRMED / MISLABELLED: never "95 % blocked" (V3 #9, #10; N6) |
| RKN status | 2026-02-10: «последовательные ограничения» ("consecutive restrictions"), no legal basis named. No blocked-register entry; the 2018 court decision formally stands. On the RKN social-network register since 2021-10 | DOCUMENTED-by-press | 2026-02-10 | Interfax 2026-02-10; to-pick.ru 2026-09-28; dev.by 2021-10-26 | CORRECTED (V3 #8, #17, #26; N7) |
| Telegram in the RU App Store | Listed (v13.1.2, ₽ prices); a brief **global** removal on 2026-08-03 | DOCUMENTED (listing) / CLAIMED (snippets) | read 2026-10-31 | apps.apple.com/ru/…id686449807 | CORRECTED: the "April disappearance" is dropped (V2 #20; N2) |
| Ad law | 38-FZ art. 5 p. 10.7 in force 2025-09-01. FAS (2026-03-10) named Telegram. FAS (2026-03-25): no liability for Telegram/YouTube ads until 2026-12-31 inclusive; Instagram, Facebook and VPN excluded. No 2027 position found | DOCUMENTED (law) / FAS press statements (news items) | 2026-03 / checked 2026-10-31 | consultant.ru 38-FZ; retail.ru; pravo.ru 2026-03-25 | CONFIRMED / CORRECTED (V3 #1-#6; N4) |
| Fine exposure | KoAP 14.3 p. 1 per violation: legal entity 100-500 k RUB, official/IP 4-20 k, citizen 2-2.5 k. p. 16 (no ERID): legal entity 200-500 k | DOCUMENTED (KoAP, edition of 2026-08-04); the choice of part is INTERPRETATION | 2026-08 | consultant.ru KoAP 14.3 | CORRECTED: p. 1, not p. 9 (V3 #18-#20; N5) |
| Stars from Russia | App Store: carrier funding ended 2026-04-01; Apple's payment-methods page (2026-08-07) has no Russia entry; gift cards still work at a markup. Google Play billing paused since 2022-03-10. @PremiumBot: cards / SBP / SberPay per one 2026 source (Premium; Stars unconfirmed). Fragment: TON/GRAM/USDT/USDC only, no KYC stated. Resellers: rubles via SBP, outside the Stars ToS | CLAIMED-press + DOCUMENTED / DOCUMENTED / CLAIMED / DOCUMENTED / CLAIMED | 2026 | 09 §1.2 | CORRECTED: "degraded, not closed" (V4; N26-N27) |
| Stars buyer price | iOS US $1.99 per 100; RU App Store 209 ₽ per 100. Base sell rate $14.10 per 1,000 (config default). Fragment 1.50 per 100 (currency unlabelled) | DOCUMENTED | read 2026-10-31 | App Store listings; core.telegram.org/api/config; fragment.com/stars/buy | CORRECTED: 01's "$1.41 per 1000" (V1 #10, #33-35, X1; N9) |
| Developer net per Star | $0.013 cash (≈ 65 % of the iOS price, ≈ 92 % of the base rate, ≈ 87 % of the Fragment price if that is USD). $0.02 ad credit, only for the bot that earned it, and the value "may fluctuate". Up to 21-day hold | DOCUMENTED (Bot Developer Terms §6.2.3-6.2.4) | read 2026-10-31 | telegram.org/tos/bot-developers | CONFIRMED + CORRECTED (V1 #9, X5, X6; N9) |
| Payout mechanics | Minimum withdrawal 1,000 Stars, maximum 25 M (config defaults). Paid via Fragment in TON/Gram. Toncoin renamed Gram on 2026-06-15 | DOCUMENTED / CLAIMED (rename) | 2026-06 | api/config; exchange notices | CONFIRMED (V1 #31, X4) |
| Affiliate Program | Commission 1-800 ‰ (defaults). Commission and duration can only be raised; `0` ends the program in ~24 h. **The commission comes out of the developer's revenue** | DOCUMENTED | 2024-12-04 blog; read 2026-10-31 | core.telegram.org/api/bots/referrals; telegram.org/blog/affiliate-programs-ai-sticker-search | CORRECTED (V1 #5, #7, X3; N10) |
| Bot API | 10.3 latest (2026-08-24). 10.0 guest mode (2026-05-08). 10.2 Communities and ephemeral messages (2026-07-14). From 2026-07-20, Mini App method calls work only from the app's original domain | DOCUMENTED | read 2026-10-31 | core.telegram.org/bots/api-changelog | CONFIRMED (V2 #1-#3; 06 §4) |
| Store and featuring | "Successful bots which enable a main Mini App and accept payments in Telegram Stars may be featured", at "sole discretion" (§8.2.1). The Apps tab shows apps the user has launched. Up to 12 previews per localization; formats undocumented. Attachment menu only for "major advertisers" | DOCUMENTED | read 2026-10-31 | core.telegram.org/bots/webapps; api/config | CONFIRMED (V1 #1-#4) |
| Telegram Ads basics | 160-character text. Minimum CPM 0.1 Toncoin (now Gram). Channels with 1000+ subscribers. Targeting cannot be changed after creation. Premium users never see the ads. No age or gender targeting | DOCUMENTED / CLAIMED (no age targeting) | read 2026-10-31 | ads.telegram.org/guidelines, /getting-started; telegram.org/faq_premium | CONFIRMED (V1 #15-#18, #29) |
| Telegram Ads Russia floors | €0.75 for channels/bots/search, €0.60 for topic/country/language (from 2026-08-28). Russia only; non-RU EUR cabinets €0.15 | CLAIMED (resellers) | 2026-08-28 | ppc.world; kod.ru; spilnoagency | CONFIRMED + scope note (V1 #19, X14; N21) |
| Mini App market size | 102.7 M TMA MAU (findmini; vendor, method undisclosed) | CLAIMED | 2026-10-31 | findmini.app | STALE: 150-190 M replaced (V1 X17; N15) |
| Telegram minimum age | 18 in the EU, UK and Australia; nothing stated elsewhere, Russia included | DOCUMENTED | read 2026-10-31 | telegram.org/tos | CONFIRMED (V3 #32) |

**Reconciled reading of Telegram in Russia (C1 K1):** use 06/V3's dated timeline — RKN restrictions from 2026-02-10,
OONI-measured blocking on major ISPs from 2026-03-20, a further round in 2026-04/05, Mediascope monthly audience down
≈ 20 % and daily audience about halved by Jun-Aug. Report 01's "largely inaccessible, VPNs of little help" stops at
2026-03-17 and is superseded; its VPN remark concerned whitelist-mode mobile internet only (one expert, V3 #36). No
measurement covers Sep-Oct 2026 (V1 #14).

**Russia stays primary on VPN-mediated use (owner ruling). What VPN does and does not fix:**

| Issue | Does VPN fix it? | Facts | Where it belongs |
|---|---|---|---|
| Reaching Telegram | Largely yes, for users who run one (40 % active VPN users, Apr 2026, poll via press; Levada: 49 % still read channels). In mobile whitelist mode Telegram's own reachability may bind before our origin (V4 #49) | Mediascope monthly 75.7 M (Jun 2026) | Promotion assumes it |
| Paid ads inside Telegram aimed at Russia | **No** (INTERPRETATION): 38-FZ applies where an ad is distributed in Russia (art. 2 p. 1); a VPN changes the route, not the audience | Per FAS a p. 10.7 violation; un-fined to 2026-12-31; no 2027 position; KoAP 14.3 p. 1, 100-500 k RUB; disputed, no court practice (V3) | Promotion: §4.2, §8.1 |
| Buying Stars | **No.** A VPN creates no payment method | App Store carrier funding cut 2026-04-01 (gift cards still work, at a markup); Google Play billing paused since 2022-03-10; @PremiumBot cards / SBP for Stars unconfirmed (T7); Fragment crypto-only; resellers outside the Stars ToS (09 §1; V4) | Product + support copy (F2, F14) |
| Loading our own origin | Only with a full-device VPN. Users on the in-app MTProto proxy, or VPN-less sessions, hit the 16 KB throttle of foreign hosts and mobile whitelists (listing needs RU servers) | Cloudflare doc 2026-04-23; Vigo via Kommersant 2026-08-05; tdesktop #28692 (09 §4) | **Hosting (Q21/Q5), not promotion** |

### 3.2 Override notes (the verify pass wins)

| N | Area report said | Verdict | Use instead |
|---|---|---|---|
| N1 | 01: Telegram "largely inaccessible", "VPNs of little help"; status after March unknown | STALE / CORRECTED (V3 #36-#37; V1 #14) | The Mediascope series; the VPN remark applies to whitelist-mode mobile only |
| N2 | 04: "April 2026 App Store disappearance" | CORRECTED (V2 #20) | Listed in the RU App Store on 2026-10-31; only a brief global removal on 2026-08-03 |
| N3 | 04 / 02 / 07: Mediascope labelled DOCUMENTED-by-press or CLAIMED | MISLABELLED (V1 X13; V3 #11-#12) | MEASURED-secondary (panel via press). Keep CLAIMED for the snippet-only Jun/Aug daily values (V2 #19) |
| N4 | 06: unlawful "since 2025-09-01"; 02: "unknown legal status from 2027" | CORRECTED (V3 #2, contradiction 1) | The law has been in force since 2025-09-01, but per FAS the violation runs from Telegram's restriction (from 2026-02). The ban stands per FAS; what is unknown is enforcement from 2027 |
| N5 | 06: KoAP part 1 vs part 9 left open; eLama's 0.5-3 M "restricted resource" fines (V1 X15) | CORRECTED (V3 #20) | Part 1 (legal entity 100-500 k RUB). Part 9 applies only if RKN imposes a 236-FZ ad ban on Telegram |
| N6 | 06: "95 % anomalies", labelled MEASURED-secondary | MISLABELLED (V3 #10) | An anomaly share with an undefined denominator, CLAIMED. Never "95 % blocked" |
| N7 | 06: "no official blocking act" | CORRECTED (V3 #17) | No published 2026 act and no register entry. The 2018 court decision formally stands, and RKN cites unpublished decisions |
| N8 | 06: same-sex romance "banned for all ages" under 478-FZ / 436-FZ | CORRECTED (V3 #29) | For minors, depiction is barred (436-FZ art. 5 p. 2 item 4.1). For adults, "propaganda" is banned at every age (KoAP 6.21) |
| N9 | 01: base rate "$1.41 per 1000"; in-app price CLAIMED. 07: dev keeps "92 % of the Fragment price" | CORRECTED / MISLABELLED (V1 #10, X1, X6) | $14.10 per 1,000 (default). App Store prices are DOCUMENTED. 92 % is of the default rate; ≈ 87 % of the Fragment page if USD |
| N10 | 01: whether the affiliate commission comes from the developer's share is "not stated" | CORRECTED (V1 X3) | It comes from the developer's revenue: net ≈ $0.013 × (1 − N/1000) per Star |
| N11 | 07: High break-even $0.54 "at $0.02"; tier starts 400-6,000 / 4,000-60,000; channel-post 90-240 ₽ per start; Europe CPI $0.53 via [24]; "matches Evan Miller"; YipitData n = 2,171 | CORRECTED / UNSUPPORTED (V1 X7-X12) | $0.54 cash / $0.83 credit. Starts 250-3,600 / 2,400-36,000. 90-420 ₽. Cite $0.53 to [23] only. State the formula. n = 1,817 |
| N12 | 05: RevenueCat 5.5 % MEASURED; WEBTOON 4.6 %; Choices 78 % female, 80 % aged 10-21 | MISLABELLED / STALE / CORRECTED (V2 #43, #51, #45) | 5.5 % CLAIMED (n not stated), with 1.8 % six-month retention. WEBTOON Q2 2026: 4.8 % global, 1.5 % Rest of World. The demographics cover the top-3 story apps combined (2018) |
| N13 | 05: Romance Club "refused to cut LGBT content", left the RU stores | STALE (V2 #28, #37; C1 M1) | It returned in 2026-05 as a separate RU app with same-sex routes cut, rated 18+ |
| N14 | 03: JMR friend rewards convert "at least as well"; Zhuang result MEASURED; Wordle ~5 % MEASURED | CORRECTED / MISLABELLED (V2 #11-#13) | "Marginally higher, low base rates"; a working-paper abstract, high-reward condition; Wordle CLAIMED, a lower bound |
| N15 | 02: TMA MAU 150-190 M | STALE (V1 X17) | 102.7 M (findmini, CLAIMED). No TMA reach figure is a market size (C1 W8) |
| N16 | 03: teen daily reach Telegram 80 % (12-24) | STALE (V2 #16) | 2024 data, before the 2026 restrictions; not current |
| N17 | 04: YouTube throttled "to ~20 % of normal" | CORRECTED (V2 #25) | "Heavily throttled since 2024; VPN usually needed" |
| N18 | 06: own-resource posts are not ads "unless a post singles out one product" | CORRECTED (V3 #22) | Not ads, even a promo banner. Risk rises with content that "stimulates special interest" |
| N19 | 06: a Russian advertiser self-withholds 3 % | CORRECTED, scope (V3 #23) | Only if the operator is a Russian entity, IP or citizen (Q21) |
| N20 | 06: Telegram's status as a "social network" not verified | CORRECTED (V3 #26) | On RKN's register since 2021-10, so channels with more than 10 k subscribers must be on the RKN list to carry ads |
| N21 | 02 / 07: the €0.75 floor "for Russia" applied generally | Scope note (V1 X14) | Russia only. EN and CIS EUR cabinets reportedly €0.15 (CLAIMED) |
| N22 | 07: €0.25 all-in per start (70 % click → start) | Optimistic (V1 contradiction 4) | At the only related figure (30 %), €0.59 all-in. The fashion & beauty subscriber costs €1.75-2.50 |
| N23 | 06: a channel CPM of 400-500 RUB after the April round | Not representative (V3 #15) | Do not use it as a price benchmark |
| N24 | 05: Durov's Stars commission "less than 5 %" | Different quantity (V2 #48) | Use the documented $0.013 developer payout for revenue math |
| N25 | 06: a FAS letter of 2026-04-06 | UNSUPPORTED (V3 #7) | Cite only the 2026-03-10 and 2026-03-25 FAS statements |
| N26 | 09: App Store carrier funding was "the last mass funding route"; @PremiumBot with RU cards "contradicted" (dtf as the counter-source) | CORRECTED (V4) | Degraded, not closed: gift cards still work at a markup; the one 2026 source opened says @PremiumBot takes cards / SBP / SberPay (Premium; Stars unconfirmed, T7); the dtf page does not say the opposite |
| N27 | 08: Fragment "may need KYC"; 09: the Stars debit clause in §3 | CORRECTED (V4) | Fragment's buy page and terms state no KYC; the debit-on-refund/violation clause is Stars ToS §5 |
| N28 | 08: 40 % VPN use cited to Carnegie | CORRECTED source (V4) | Russian Field poll (2026-04-15..22, n = 1,600) via SecurityLab: 18-29 61 %, 30-44 50 % |
| N29 | 08: RKN letter 03-72707 (2025-02-20) treats ads not aimed at RU consumers as outside its scope | CORRECTED (V4) | It answers the Ministry of Finance on tax accounting of ad spend; it says nothing on 38-FZ applicability: not a safe harbour |
| N30 | 08: VK commission 45 %; VK payouts | Qualified (V4) | 45 % is 2021 and "not final"; payouts need a Russian ИП, self-employed person or legal entity (like MAX, a Q21 dependency) |
| N31 | 08: EN reseller floors €0.15-0.20 "since 2026-08-28"; ~€0.49 June average; KZ launch Oct 2025 | CORRECTED / UNSUPPORTED (V4) | Floors apply to reseller EUR cabinets, date unstated (the €0.20 user-targeting floor unchanged); €0.49 has no named source; KZ month disputed (Oct vs Dec 2025) |
| N32 | 09: foreign hosts (Hetzner, DigitalOcean, OVH) throttled like Cloudflare; "splitting assets under 16 KB won't help"; tdesktop PR #31166 fixes the proxy gap | CORRECTED (V4) | Cloudflare's ~16 KB cap is confirmed (doc 2026-04-23); the others only "reportedly similar"; the 16 KB reasoning does not follow from the sources; the PR covers SOCKS5 only, not MTProto proxies |
| N33 | 09: ШГШ brand behind «Цена выбора»; a Petrograd court case on a minor's purchase; telega.in 280-420 ₽ listings | UNSUPPORTED (V4) | Drop the brand attribution and the court case; keep only the 839 ₽ listing |

## 4. Channel comparison

**Reading the table**
- **Effort** is relative, not hours: XS < S < M < L < XL. The reports' Low/Medium/High scales are mapped onto it
  (C1 M5).
- **Fit:**
  - "(hyp.)" marks a hypothesis with no audience evidence (C1 W1).
  - Evidence of audience fit exists only for Romance Club's channels and fan channels (09 §2).
- **Legal:**
  - The legal column reads "RU 2026 / from 2027".
  - "Exposure" means KoAP 14.3 p. 1 unless FAS states a 2027 position.
  - Every legal cell is INTERPRETATION.
- **Evidence quality:** A = primary or measured; B = documented but vendor; C = anecdotal.

### 4.1 Telegram organic surfaces

| Channel | Cost (value, date, label) | Effort | Fit (RU-first romance VN for girls) | Legal (RU 2026 / 2027+) | Ev. | Priority |
|---|---|---|---|---|---|---|
| Main Mini App + profile + previews (≤ 12 per language) | 0 (DOCUMENTED) | S | High: RU / EN / default sets; free art only (principle 0) | Own resource, not an ad / same | A | Now |
| Mini App Store "popular" / featured | 0; editorial, "sole discretion" (DOCUMENTED) | M (Main Mini App + Stars + previews + design guidelines; no form) | High upside, unpredictable. Ranking signal CLAIMED to be Stars/day (kod.ru), which favours high prices | n/a | B | Launch |
| Apps tab, "recently launched" | 0 | XS | Retention only | n/a | A | Launch (automatic) |
| "Similar bots" tab | 0; not controllable | — | Depends on audience overlap | n/a | A/C | — |
| Bot username / global search | 0; the username is permanent | XS | Name search only | n/a | B | Now (Q4) |
| Third-party catalogs (tapps.center, findmini) | tapps: 29 crypto listings. findmini: $200 in TON/USDT per week (CLAIMED, 2026-10-31) | S | Poor: crypto-skewed, no story category | Crypto payment: Q21 | C | Avoid |
| Gaming Platform; attachment menu | No initData; attachment menu for "major advertisers" only | — | Not usable | — | A | Avoid |

### 4.2 Telegram paid

| Channel | Cost (value, date, label) | Effort | Fit | Legal (RU 2026 / 2027+) | Ev. | Priority |
|---|---|---|---|---|---|---|
| Official Ads via RU resellers (EUR cabinet) | Floors €0.75 / €0.60 (2026-08-28, CLAIMED). Broad-topic average CPM €0.97, CPC €0.12 (Aug 2026, CLAIMED; wording ambiguous). Entry €100-500 + ≥ 20 % fee + 22 % VAT. **≈ €0.25-1.04 per start all-in** (ANALYSIS, V1) | M | Medium (hyp.): topic/channel targeting; no age or gender targeting; Premium users never see the ads | Ban in force per FAS, un-fined to 2026-12-31 / exposure (R3: accepted) | B | Soft launch (R3; minors-safe creatives) |
| Official Ads, Gram cabinet (self-serve) | Minimum CPM 0.1 Gram (DOCUMENTED); first deposit ~20 Gram (CLAIMED). Reportedly not shown in RU (single CLAIMED source, 2025-12) | M (crypto wallet; Fragment states no KYC, V4) | Low for RU; possible for EN/CIS via channel lists | Not aimed at RU if not shown there / same | B/C | Growth (EN) |
| Official Ads paid with earned Stars | $0.02 credit per Star, "30 % discount", only for the bot that earned it, "may fluctuate"; 21-day hold (DOCUMENTED). ~1,000-Star entry (CLAIMED) | S | Medium-high once revenue exists: each Star buys 1.54× its cash value in ads | Aimed at RU: same p. 10.7 reading (06 over 02's practitioner) / same (R3: accepted) | A/B | Growth (RU and EN/CIS) |
| Official Ads aimed at CIS (KZ / BY / UZ) | CPM KZ €0.93 (CTR 1.35 %), BY €1.04, UZ €0.16 (Aug 2026, CLAIMED). KZ launch month disputed (2025-10 vendor / 2025-12 AdIndex). ≈ €0.11-0.34 per start (ANALYSIS) | M | KZ/BY medium: 84 % of Kazakhstan speaks Russian; in Belarus Russian is an official ad language. UZ low | Grey zone: a Russian-language creative leading to a bot that RU users can open may be read as aimed at RU. No safe harbour: RKN letter 03-72707 concerns tax accounting of ad spend, not 38-FZ (V4; N29) | B | Soft launch test, after a lawyer |
| Official Ads aimed at EN | Floors €0.15-0.20 (reseller EUR cabinets only, date unstated, CLAIMED); average ~€0.49 (Jun 2026, no named source — weak). ≈ €0.12-0.23 per start (ANALYSIS) | M | Unknown: no EN romance audience evidence on Telegram | Outside 38-FZ if not aimed at RU (INTERPRETATION) | C | Growth (after the EN tables) |
| Search ads | Minimum bid €1 (2025-04, CLAIMED) | S | Intent keywords such as «новелла» ("novel") and «отомэ» ("otome") (hyp.) | As official Ads RU | B/C | Avoid: no `start` parameter, so no attribution |
| Ads inside bots | €1 minimum at launch (2025-05, CLAIMED) | M | Only if fitting bots exist (hyp.) | As official Ads RU (R3: accepted) | C | Growth (if fitting bots exist) |
| Suggested Posts (native paid posts) | Price set per deal in Stars or Toncoin; paid 24 h after posting; automatic refund if removed earlier (DOCUMENTED) | M | Medium-high for small fandom channels (hyp.) | A paid post in Telegram aimed at RU: p. 10.7 + ERID / exposure (R3: accepted) | A (mechanism) | Soft launch (R3) |
| Channel posts via exchanges or admins («посевы», "seeding") | CPM 150-300 ₽ in entertainment (Q1 2026) up to 2,412-4,175 ₽ (n = 3 non-game channels, 2026-09). Anime/manga posts ≈ 840 ₽ (one listing opened; the 280-420 ₽ listings unconfirmed, V4). RC fan channels: ~1.4 K views per post, prices not published. **≈ 15-420 ₽ per start** (ANALYSIS, §5.4). ~30 % of channels cheat (CLAIMED) | L (vetting, ERID) | **Highest evidenced match**: RC fan channels of 57-81 K subscribers sell ads (09 §2) | p. 10.7 time box; ERID; RKN list above 10 k subscribers; foreign-agent check / exposure (R3: accepted; exchanges still demand an ERID) | A (reach) / C (price) | **Soft launch** (R3) |
| Yandex Direct → Telegram channels | CPC cap 30-300 ₽ (2023, CLAIMED); post forecast 700-7,200 ₽ (2026-09, CLAIMED); 18,000+ channels in the network (2026-01) | M | Medium; channel landings only, bot / Mini App landings unknown | Placement inside Telegram channels: same p. 10.7 reading (INTERPRETATION; R3: accepted) | C | Launch (R3) |
| TMA ad networks (AdsGram, RichAds, TADS, Monetag) | AdsGram CPM from 2 USDT, $100 minimum. RichAds push CPC $0.015, $150 deposit. TADS CPC $0.01, $50 test (CLAIMED) | S | Low: rewarded tap-to-earn and crypto skew; "up to 80 %" bot farms (CLAIMED) | Telegram-hosted, aimed at RU: same reading | B/C | Avoid |

### 4.3 Telegram viral mechanics and owned channels

| Channel | Cost | Effort | Fit | Legal (RU 2026 / 2027+) | Ev. | Priority |
|---|---|---|---|---|---|---|
| Own channel + discussion group (a 10.2 Community) | 0 + time | M, ongoing | High: Romance Club runs a 732 K channel (09) | Own posts are information, not ads (FAS 2025-04-09). No "buy now" banner that stimulates special interest | A/C | **Now** |
| Bot waitlist (user `/start`, later `requestWriteAccess`) | 0 within the free limits (~30 msg/s) | S | High (owned) | §6.2.5 permission; 152-FZ consent | A | **Now** |
| Invite link `startapp=f<code>` (M10/M11) | 0 | Planned (LF1) | Core: every share is an invite | A player's own share is not our ad / same | A | Launch |
| `shareMessage`, text + button (M14) | 0 | Planned (LF2) | A good floor; spoiler-free | Same | A (mechanism) / C (outcome) | Launch |
| `shareMessage` with a static story card (photo result) | 0 + art | M | Better for a visual genre (hyp.); a public JPEG, so free art only | Same | A/C | Launch (feature ask) |
| In-app referral (M23, hints) | Hints; ≈ $0.02 of developer value per 5-hint reward at placeholder prices (ANALYSIS, C1 M7) | Planned (LE2) | Fits; weak evidence for the split | Not barred by any terms read; single level | B | Launch |
| Hint gifts (M22) | Hints | Planned (LE2) | Reciprocity (CLAIMED) | — | C | Launch |
| `shareToStory` | 0 | S-M | Story culture fits, but links are Premium-only and there is no callback | — | A/C | Growth (image with the bot name only) |
| Inline teaser cards / "what would you choose?" | 0 | M | Fan debate (CLAIMED) | — | A/C | Growth |
| Guest mode (10.0) | 0 | M | A new surface; no outcome data; whether buttons are allowed is unknown | Spam, §5.2(b) | A | Growth |
| Telegram Affiliate Program (MV11) | 1-800 ‰ of referred revenue (defaults), from our revenue; raise-only | XS (no code) | Pays promoters who bring payers; no VN uptake data | Every affiliate post in an RU channel is our ad, and we cannot enforce ERID: + p. 10.7 (INTERPRETATION; R3: accepted) | A (mechanism) / C (uptake) | Growth |
| Telegram gifts / Premium as prizes | Premium 3 / 6 / 12 months = 1,000 / 1,500 / 2,500 Stars (DOCUMENTED); gift prices: gap | S | A status prize (hyp.) | Giveaway law with minors: gap (C1 M2) | A/C | Avoid in the foundation |
| Channel Stars giveaways with partner channels | A prepaid Stars pool | S | Co-promotion (hyp.) | `only_new_members` sits close to §5.2(d)(ii); art. 9 disclosure; minors gap | A/C | Avoid for now |

### 4.4 Outside Telegram, Russian-language

| Channel | Cost (value, date, label) | Effort | Fit | Legal (RU 2026 / 2027+) | Ev. | Priority |
|---|---|---|---|---|---|---|
| VK community + VK Clips (organic) | 0 cash | L | High (hyp.). The female skew rests on one blog (54-64 %); RC's VK community is 1.4-1.5 M (CLAIMED). VK 93.4 M MAU (Q1 2026, company) | Lawful; no VPN mention (p. 10.8) | A (audience) / C (gender) | **Now** |
| VK Ads → our landing page → t.me | CPC 9-40 ₽ (2026, CLAIMED); test 10-20 k ₽; minimum top-up 500-600 ₽. ≈ 15-167 ₽ per start (ANALYSIS) | M | High reach (hyp.). **Whether VK accepts a t.me landing is unverified.** The rules require a browser page, no redirects and an age label (rev. 2026-03-11) | Lawful with ERID + age label. That an ad leading into Telegram is fine is unconfirmed (V3 #5) | B | Soft launch (one test ad first) |
| VK / Rutube / Dzen bloggers; marketplaces (Perfluence, Epicstars, GetBlogger) | CPV ~1.5-2.8 ₽ (non-niche, 2025-26, CLAIMED); VK catalog placement averages 1,704 ₽ (Apr, CLAIMED); Perfluence free for advertisers (CPA/CPM). ≈ 150-280 ₽ per start (ANALYSIS) | M | Medium-high (hyp.); no niche prices found | Lawful with ERID; bloggers above 10 k must be on the RKN list | C | Soft launch / Launch |
| Romance Club / otome fan groups on VK | 0, or the admin's price (unknown) | M | Very high (the exact genre) | Lawful with ERID if paid | C | Soft launch |
| Fanfic and reader platforms (Ficbook, Litnet, Author.Today) | Unknown. Ficbook's Telegram channel ≈ 291 K; the site had 73.3 M visits (May 2025, CLAIMED) | M | High topical fit (hyp.); teens likely (unverified) | Promotion rules not read | C | Soft launch (read the rules first) |
| Rutube / Rutube Shorts | 0 | M | Medium; audience unknown | Lawful | C | Growth |
| DTF «Инди» ("Indie"); Habr dev story | 0 | S-M | Low (developers, gamers). Habr allows one app-store link; whether t.me counts is a moderator call | Lawful | A (rules) | Launch (optional) |
| Pikabu | Unknown | S | Unknown | Rules unreadable | C | — (gap) |
| Yandex Direct (search/network → our landing) | Not priced | M | Medium | Lawful with ERID | B | Growth |
| TikTok organic, Russian-language (R6) | 0 cash; production time | L | High: 65.9 M monthly, 27.3 M daily (Dec 2025, 12+); the leader by teen online time (25 % of 12-17 time); reachable share = VPN users (40 %; 61 % of 18-29, Russian Field Apr 2026) + CIS + diaspora (all via press, CLAIMED) | Posting from Russia needs a foreign IP; TikTok ToS bans bypassing its restriction (account risk; who posts from where = Q21). No VPN mention (p. 10.8) | B / C | **Now** (§14) |
| YouTube Shorts organic | 0 cash | M | Medium-high: 65.9 M monthly / ~22 M daily (Jan 2026); VPN-only since 2026-02; Shorts description links not clickable (YouTube help) — route via channel links | As TikTok | B / A (link rules) | **Now** (§14) |
| TikTok / YouTube creator integrations (RU) | TikTok ≈ 1.26-2.61 ₽ per view; Shorts ≈ 1.30 ₽; YouTube entertainment ≈ 1.53 ₽ (2025-26, agency studies, CLAIMED) | M (brief, per-creator code) | Medium-high (hyp.): no romance / teen-girl niche prices or cases | ERID; RKN blogger list > 10 k (R3: accepted). Adult creators only (§14) | C | Soft launch |
| YouTube / TikTok self-serve ads to Russia | — | — | Not available: Google shows no ads in Russia since 2022-03; TikTok per practitioners | — | B | n/a |
| Instagram / Facebook (RU) | — | — | Excluded | Banned, with no transition (FAS 2026-03-25) | A | Avoid |
| MAX / VK Mini Apps (a second platform) | MAX acquiring 1.8-2.9 % (CLAIMED); VK votes 45 % (2021, "not final"; no newer figure) | XL | Large audience (MAX 86.3 M). MAX publishers must be Russian residents; VK sells for votes only and pays out only to a Russian ИП, self-employed person or legal entity; both conflict with principles 2, 3 and 6 | n/a | A (rules) | Not a promotion channel; a Q21 hedge (V4; N30) |

### 4.5 Outside Telegram, English-language

| Channel | Cost | Effort | Fit | Legal | Ev. | Priority |
|---|---|---|---|---|---|---|
| VNDB entry | 0 | XS | EN discovery. Needs ≥ 50 % VN-style reading, so a puzzle-heavy design may fail | — | A | Launch (EN) |
| r/otomegames, r/visualnovels | 0 | S | Medium for EN | Self-promotion only in the weekly thread (CLAIMED, undated mirror; re-check live) | C | Growth |
| itch.io page + devlogs | 0 | M | Low unless there is a playable non-Telegram demo (an architect fork) | Link-only pages may drop out of discovery | A | Growth |
| itch.io jams | 0 | M-L | Medium for EN. Otome Jam 2026 is over (Apr 30 - Jul 1); 2027 dates not published. Yuri Jam open until 2026-12-01. AI content banned (Otome Jam) | — | A | Growth |
| TikTok / BookTok (EN) | 0 organic | L | The same clips with English subtitles, from the same account at first (13) | — | C | Growth (EN) |
| Instagram Reels | 0 organic | L | EN only: Instagram is blocked in Russia and advertising on it is banned with no transition (FAS 2026-03-25) | — | A | Growth (EN only) |
| Discord server | 0 | M | EN only (blocked in RU since 2024-10-08) | — | A | Growth (EN) |
| EN influencers | Not priced | M | Unknown | FTC / ASA disclosure (#ad; an affiliate reward is a material connection) | A/B | Growth |

### 4.6 The 18+ track (R5; 10 channel rows, §8.5)

| Channel | Cost | Fit | Constraint (not ad law) | Ev. | Priority |
|---|---|---|---|---|---|
| In-product, to users with the 18+ flag (Home shelf, end-of-chapter teaser) | 0 | High: the only audience known to be confirmed adults | Never shown without the flag (F23) | A | Launch of the 18+ track |
| Own 18+ channel, separate from the public one, erotica-only and 18+-marked | 0 + time | Medium (hyp.) | Telegram ToS (no illegal porn on public channels); art. 242 if explicit; 2025 prosecutions of explicit channels | B | Launch of the 18+ track |
| Telegram Ads naming the 18+ track | — | None | Ads §5.1 bans sexually suggestive ads | A | Avoid |
| Otome / Romance Club fan channels with an 18+ angle | Per §4.2 | High genre fit | Their audiences include minors: only a minors-safe creative fits (art. 242 part 2 risk) | C | Avoid (18+ angle); use them for the public track |
| VK Ads for the 18+ track | Per §4.4 | Low | Linked communities must have no sexually explicit images | B | Avoid |
| Adult ad networks (ExoClick, TrafficJunky, JuicyAds) | Deposits $25-€500; CPM $0.1-8 (CLAIMED) | Low: explicit, male-skewed traffic | For RU: art. 242 "advertising"; `t.me` landing acceptance unknown | C | Avoid |
| Litnet / Author.Today erotic-romance readers (RU) | Unknown | High topical fit for adult women (hyp.) | Promotion rules not read | C | Growth (read the rules first) |
| EN adult stores and communities (Nutaku, itch.io NSFW, F95zone, Patreon/Boosty 18+) | Varies; not researched | Low-medium for EN | Need a non-Telegram build or leave our gate (principle 0); processor volatility (2025) | C | Not for the TMA |

## 5. Funnel and metrics

### 5.1 The metric set (07 §1)

| Metric | Definition for this product |
|---|---|
| Start (CPI denominator) | A first Mini App launch: the `users` row inserted by `POST /api/auth`. Counted on verified initData users, never on clicks (07 pitfalls: bot farms) |
| D1 / D7 / D30 retention | The share of a day-0 cohort active on day N ("classic" retention, as GameAnalytics computes it) |
| Chapter-1 completion | Users who reach the free chapter's paywall END ÷ users who started chapter 1 (Y9 `chapter_completed` of a free chapter) |
| Paywall conversion | Users with a paid order ÷ users who reached a paywall. Stages: order `created → checkout → paid` |
| Start → payer | Chapter-1 completion × paywall conversion: the quantity comparable with "install → payer" benchmarks |
| Invoice friction (RU) | Invoices opened ÷ `successful_payment`, per `language_code` and platform (09 ask) |
| Payer share / ARPU / ARPPU / LTV | Net revenue (×$0.013 per Star) per user / per payer, by cohort at D30-D180, minus refunds. Always state the window (07: windows differ by an order of magnitude) |
| CAC per channel | Spend ÷ newcomers carrying that channel's campaign code |
| Referral K | Invites sent per user × invite → newcomer conversion; the M23 grant fires at chapter-1 completion |

### 5.2 Benchmarks (all genres unless stated)

| Metric | Value | Label, sample | Date | Source |
|---|---|---|---|---|
| Mobile D1, top 25 % | just above 30 %; top 10 % ≈ 40 % | MEASURED (vendor dataset, 16,262 games) | 2025 data, published 2026-06-04 | GameAnalytics via gamedevreports (07 [17]) |
| Mobile D7 | median just under 4 %; top 25 % 6-7 % | MEASURED, same | same | same |
| Mobile D30 | median 0.69-0.79 %; top 25 % ≈ 1.6-1.8 % | MEASURED, same | same | same |
| First purchase within 30 days of install | casino 4.95 %; non-gaming 9.84 % | MEASURED-secondary (AppsFlyer, $900 M IAP) | Jan 2025-Mar 2026 | 07 [19] |
| D90 IAP ARPPU | casual $7.26; midcore $9.80; casino $11.40 (gross buyer spend) | MEASURED-secondary | same | 07 [19] |
| Short drama, install → payer within 35 days | 5.5 % median (other Entertainment apps 1.6 %); first-month revenue per payer $23.85; six-month retention 1.8 % | **CLAIMED** (vendor, n not stated) | 2026-08-28 | RevenueCat (V2 #43) |
| WEBTOON paying ratio (MPU / MAU, monthly) | 4.8 % global; Korea 15.5 %; Japan 9.4 %; Rest of World 1.5 % | DOCUMENTED (8-K) | Q2 2026 | sec.gov (V2 #51) |
| Practitioner scale gates | D1 ≥ 25 %, D7 ≥ 8 %, D30 ≥ 3 %; CPI at 30-70 % of LTV | CLAIMED (general F2P, Android) | 2025-12, updated 2026-08 | gamegrowthadvisor.com (07 [22]) |
| Referral K | ≈ 0.05 (Extole, 400 programs); "good" consumer K 0.15-0.25 | CLAIMED (vendor aggregate, 2020) | 2020-09-15 | saxifrage.xyz (V2 #10) |
| Interactive-story retention | "notoriously low" | CLAIMED | 2023 | 07 [34] |

**An honest note:** no measured benchmark exists for a Telegram Mini App or for the story genre. That covers D1/D7,
chapter completion, paywall conversion, ARPPU and K (07 §1, 03 §2, 05 §3). Every number above is a cross-genre or
neighbouring-model proxy.

### 5.3 Money per Star and per chapter (07 §2, V1)

| Price per chapter (Stars) | Buyer, iOS US | Buyer, RU App Store | Developer, cash ($0.013) | Developer, as ad credit ($0.02) |
|---|---|---|---|---|
| 1 (placeholder) | $0.02 | 2 ₽ | $0.013 | $0.02 |
| 50 | $1.00 | 105 ₽ | $0.65 | $1.00 |
| 100 | $1.99 | 209 ₽ | $1.30 | $2.00 |
| 150 | $2.99 | 314 ₽ | $1.95 | $3.00 |
| 250 | $5.09 (pack) | 529 ₽ (pack) | $3.25 | $5.00 |

Withdrawal needs 1,000 Stars ($13). At a 1-Star price that means 1,000 purchases before the first payout (01).
**Note (V7):** the 209 ₽ per 100 Stars RU price could not be reproduced on refetch; 2026 guides quote 229 ₽ or more
(T21). At the CBR rate of 80.56 ₽/$ (2026-10-31) a developer keeps ≈ 50 ₽ of every 100 ₽ a Russian iOS buyer pays,
before the TON-payout conversion (§13).

### 5.4 Cost per start, reconciled (ANALYSIS on CLAIMED inputs)

Formula: cost per start = CPM ÷ (1,000 × CTR × click → start). The CTR and click → start rates are ASSUMPTIONS unless
stated otherwise.

| Channel | Cost per start | Inputs and caveat |
|---|---|---|
| Telegram Ads RU via reseller | €0.25 all-in at 70 % click → start (07). **€0.59** at 30 % (the only related figure, V1). €1.04 at a €3 CPM, 0.7 % CTR and 60 % (€0.71 net × 1.464) | The CPC €0.12 is the single, method-less SA Media aggregate (C1 W8) |
| Telegram Ads, fashion & beauty | €1.75-2.50 per channel subscriber, the nearest women-skewed analogue of a start | CLAIMED, agency (V1 contradiction 4) |
| Telegram channel posts | 15-420 ₽ (≈ $0.15-4.6) at 1 % view → start | Reconciles W4: 150-300 ₽ CPM (entertainment, Q1 2026) to 2,412-4,175 ₽ (n = 3, 2026-09). The romance/fandom niche has list prices only |
| Telegram Ads KZ (Russian-language) | €0.11-0.23 net; €0.17-0.34 via an RU reseller | CPM €0.93, CTR 1.35 % (CLAIMED), 30-60 % click → start |
| Telegram Ads EN | €0.12-0.23 net | CPM €0.49 (June average, no named source), 0.7 % CTR, 30-60 % click → start |
| VK Ads → landing → t.me | 15-167 ₽ (≈ $0.15-1.85) | CPC 9-50 ₽ ÷ 30-60 % click → start, before the landing-page hop. Only if VK accepts the landing |
| Bloggers (CPV) | ≈ 150-280 ₽ | CPV 1.5-2.8 ₽ (non-niche) at 1 % view → start |
| AdsGram-type networks | ≈ $0.17 | $2 CPM, 2 % CTR, 60 %. Bot-farm risk |

### 5.5 Break-even, corrected (07 §5 with V1 X7-X8; the analog row per C1 W3)

Revenue per start = completion × paywall conversion × chapters per payer × price × net per Star. Hints and refunds are
excluded.

| Input | Low | Base | High | Analog (05 proxies) | Label |
|---|---|---|---|---|---|
| Chapter-1 completion | 25 % | 40 % | 55 % | (folded in) | ASSUMPTION |
| Paywall → purchase | 2 % | 5 % | 10 % | (folded in) | ASSUMPTION |
| = Start → payer | 0.5 % | **2.0 %** | 5.5 % | **5.5 %**: the RevenueCat short-drama median, CLAIMED | ANALYSIS |
| Chapters per payer | 1.5 | 3 | 5 | 3 | ASSUMPTION |
| Price per chapter (Q3) | 50 | 100 | 150 | 100 | ASSUMPTION |
| Net per Star | $0.013 | $0.013 | $0.013 cash / $0.02 credit | $0.013 | DOCUMENTED |
| Revenue per payer | $0.98 | $3.90 | $9.75 / $15.00 | $3.90; or $4.72 = AppsFlyer casual ARPPU $7.26 × 0.65 net share | ANALYSIS |
| **Revenue per start = break-even cost per start** | **$0.005** | **$0.078** | **$0.54 / $0.83** | **$0.21-0.26** | ANALYSIS |

**Sensitivity (one input at a time, from the $0.078 base):**

| Change | Result |
|---|---|
| Completion 25 % / 55 % | $0.049 / $0.107 |
| Paywall conversion 2 % / 10 % | $0.031 / $0.156 |
| Chapters per payer 1.5 / 5 | $0.039 / $0.130 |
| Price 50 / 150 Stars | $0.039 / $0.117 |
| Stars recycled as ad credit | $0.120 |
| The 1-Star placeholder | $0.0008 |

The full range is **$0.005-0.83 per start**.

**Break-even chapter price (ANALYSIS):** price = cost per start ÷ (start → payer × chapters × $0.013).

| Funnel | At €0.25 per start (≈ $0.29) | At €0.59 per start (≈ $0.68) |
|---|---|---|
| Base (2 % start → payer) | ≈ 370 Stars (≈ 775 ₽ at the RU App Store rate) | ≈ 870 Stars |
| Analog (5.5 %) | ≈ 135 Stars | ≈ 315 Stars |

**Verdict by channel (ANALYSIS; the research shows inputs, not outcomes):** the base case ($0.078) loses on every
priced paid channel (the cheapest is ≈ $0.13-0.17 per start). The analog ($0.21-0.26) is about break-even on the
cheapest Telegram posts (15-30 ₽) and on CIS/EN Telegram Ads at the low end, and loses on RU Telegram Ads at €0.59.
High cash ($0.54) beats €0.25 all-in and CIS/EN costs but stays slightly below €0.59; High as ad credit ($0.83)
breaks even at €0.59 only if Stars are recycled into ads. At the fashion & beauty cost (€1.75-2.50) no case breaks
even.

### 5.6 Reconciling the payer rate: 2 % vs 5.5 % (C1 W3)

- **Shows:** 07's **2.0 %** is the product of two ASSUMPTIONS (40 % × 5 %); its own High case is exactly 5.5 %.
  05's **5.5 %** is a vendor's short-drama median (n not stated, CLAIMED, V2 #43), on frictionless app-store billing,
  against 1.6 % for other Entertainment apps, with 1.8 % six-month retention; the top 10 apps take ≈ 78 % of revenue.
  WEBTOON's 4.8 % global / 1.5 % Rest of World is a monthly MPU/MAU ratio, not a cohort figure (DOCUMENTED).
  AppsFlyer's 30-day first purchase is 4.95 % (casino) / 9.84 % (non-gaming). In Russia every payer must first get
  Stars through a degraded or off-ToS route (09 §1): an unknown factor below 1.
- **Reading (ANALYSIS):** the proxies span ≈ 1.5-5.5 % for start → payer-like ratios; 2 % sits inside the band, not
  below it, and neither figure is a forecast. "Telegram Ads into Russia lose money" holds under both rates at the
  corrected costs; "all paid acquisition loses money" is **not established**.
- **Recommend:** plan RU at ≤ 2 % until measured; treat 5.5 % as the optimistic EN/non-RU analog; the soft-launch
  paid tranche (§6.2) exists to measure the sign; report RU and EN cohorts separately (`language_code`).

### 5.7 Sample sizes and what each tier buys (V1-corrected)

**Sample sizes (V1 arithmetic check):**

| Test | Needs | At €0.25 per start | At €0.59 per start |
|---|---|---|---|
| D1 to ±3 points (95 %, near 30 %) | ≈ 900 starts | €225 | €530 |
| Paywall test, 5 % → 7.5 % (α 0.05, power 0.8) | ≈ 1,470 paywall viewers per arm ≈ 7,400 starts at 40 % completion | €1,850 | **€4,370** |
| Paywall test, 5 % → 6 % | ≈ 20,000 starts per arm (≈ 40,000 total) | ≈ €10,000 | ≈ €24,000 |
| Creative CTR, 1.0 % → 1.5 % | ≈ 7,750 impressions per arm | €5-8 per arm | (CTR is not the outcome that matters) |

**What each tier buys:**

| Tier (per month) | Starts at Telegram-Ads-type cost (€0.25-1.04 all-in) | At the €0.59 point | What it can measure |
|---|---|---|---|
| Zero | 0 paid; organic volume unknown (C1 W5) | — | Funnel shape on a small n; D1 only if organic reaches about 900 starts |
| Small, $300-1,000 | ≈ 250-3,600 | ≈ 440-1,470 | D1/D7 and chapter-1 completion of one cohort. **Cannot run one paywall A/B** |
| Medium, $3,000-10,000 | ≈ 2,400-36,000 | ≈ 4,400-14,700 | 1-2 paywall tests a month; per-channel CAC against D30 LTV; the LTV : CAC ≥ 1.4× gate |

Reseller minimums are €100-500 (V1 #20). Price tests in Russia must be sequential periods, not per-user randomisation
(Civil Code art. 426 §2; INTERPRETATION, lawyer item; 07 §4).

### 5.8 What the server records today vs what is missing (07 §3, 09)

| Needed | Source in the project | Status → ask |
|---|---|---|
| New users per day; language | `users.created_at`, `users.language_code` (`server/migrations/0001_init.sql`) | Exists |
| Order → checkout → paid → refunded | `orders`, `payments` (`0001_init.sql:12-49`) | Exists |
| Payer share, ARPPU, cohort revenue | `payments` × `users.created_at` | Computable; ask for a read-only admin report |
| Chapter started / completed (= paywall reached), endings | Y9 `stat_events` (STORIES-PLAN) | Planned |
| **D1 / D7 / D30** | `users.last_seen_at` is overwritten, and `chapter_started` skips resumes | **Missing**: a per-user, per-day activity fact |
| **Campaign attribution** | M11 reads `start_param` (design draft, not merged); no `start_param` in the tree | **Missing**: campaign prefixes besides `f<code>` |
| **Paywall shown / dismissed** | `chapter_completed` approximates "reached" | **Partial**: a `paywall_shown` / `paywall_dismissed` kind |
| **Invoice opened → closed unpaid, by language/platform** | Not recorded | **Missing** (09: measures RU Stars friction) |
| **Shares sent; invite launches → newcomers (K)** | M14 / M11 (draft) | **Missing**: per-inviter, per-day counters |
| **Load failures by region / network type** | Not recorded | **Missing** (09: whitelist and throttling) |
| Stars withdrawable and on hold | Only in the owner's client (`payments.getStarsRevenueStats`) | A manual monthly reconciliation in the ops runbook |

## 6. Phased plan (Recommend)

**Product readiness sets the calendar:** 14 of ~47 lanes are merged and there is no public bot (the owner has a test
bot); the social/growth features (M10-M23) are a draft on the unmerged `design/choices` branch, their lanes queued
after LS3 (LE1 → LF1 → LM2 → LF2 → LE2 → LPO); story/art (Q1/Q2), prices (Q3) and jurisdiction/hosting (Q21/Q5) are
open. The FAS window closes 2026-12-31, before any product exists to advertise; under R3 that date is **not a planning
constraint** (the owner accepts the RU ad-law risk). In the gates, "sourced" = a cited practitioner or arithmetic figure; "ASSUMPTION" = no source.

### 6.1 Phase 0: Pre-launch (now → public bot)

**Goal:** an owned audience and the decided values every later phase needs.

**Actions, in order:**
1. **Owner decisions** (§9 P2, P8, P9, P13, P15): age bracket and content category, brand/persona, bot username
   (permanent, 01), advertiser of record (Q21), a price range for modelling (Q3). Every ad carries the category
   (38-FZ art. 5 p. 10.1); ERID needs the advertiser's details (06 §1).
2. **Own Telegram channel + discussion group, mirrored as a VK community:** devlog, free-chapter character art,
   polls, character-led posts (Romance Club grew on memes about its love interests, 05, CLAIMED). Posts are
   information, not ads (V3 #22): no "buy now" pushes, never a VPN mention (p. 10.8).
3. **Short-video accounts (R6, §14):** TikTok (run from a foreign IP — who posts from where is a Q21 item), YouTube
   Shorts and VK Clips, cross-posting the same vertical chapter-1 clips and character cards (minors-safe, never the
   18+ track); a link-in-bio landing page with per-platform campaign codes (F17, F1); no VPN mention.
4. **Waitlist:** users who `/start` the bot have messaged it first and may be notified (04 §4); the Mini App
   `requestWriteAccess` opt-in comes later (F9); stay within §6.2.5.
5. **Run the test-bot checks** (§10) that gate attribution and the RU funnel.
6. **Store assets:** Main Mini App; RU/EN/default preview sets (≤ 12 each, free art only); description with the age
   sign; public privacy URL (MV14); loading-screen settings.
7. **Hosting decision with RU reach in view** (Q21/Q5) — it decides whether RU clicks load (09 §4); not promotion.
8. **Engage a Russian lawyer** before the first paid placement (06; V3) and before any ruble payment route (§13).

**Gate to soft launch:** a public bot with Stars live; chapter 1 of ≥ 1 real story; the soft-launch asks of §7
shipped; age category set; RU fixed-broadband load verified; ≥ 1,000 waitlist/channel members (ASSUMPTION — no source
gives a pre-launch growth rate, 04 gaps).

| Zero | Small ($300-1,000/month) | Medium ($3,000-10,000/month) |
|---|---|---|
| Everything above | Creative production (preview art, channel content); one VK Ads test ad (top-up 500-600 ₽) to settle t.me / landing acceptance (C1 K3); VK Ads to grow the VK community (ERID) | Not recommended (nothing to measure yet); at most one creative wave (6-10 variants at ≈ $150-350 each, CLAIMED app-store practice, 07) |

**Checkpoints:** an ORD account and ERID wherever a platform or exchange demands one before posting (VK, telega.in-type
exchanges); the age label on every creative, and only minors-safe material in it (§8.5); RKN-list and foreign-agent
checks where an exchange demands them. The RU ad-law exposure itself is accepted (R3).

### 6.2 Phase 1: Soft launch (production bot, cohort-coded links)

**Goal:** measure D1, chapter-1 completion, start → payer (RU vs EN), RU invoice friction and load success.

**Actions, in order:**
1. **Production-bot beta via `startapp` cohort links** (07 §4); the Telegram test environment is for payment QA only
   (testers need separate accounts).
2. **Invite the waitlist and channel first;** invites and shares once LF1/LF2 have merged.
3. **A paid measurement tranche** sized to reach ≈ 900 starts (C1 W5), in this order: (a) posts in Romance Club /
   otome fan channels on Telegram (exchanges, Suggested Posts, admin deals) and in the matching VK groups — the best
   evidenced audience match (09 §2; R3); (b) VK Ads → our landing page → t.me, if the test ad was accepted; (c)
   Telegram Ads via RU resellers with minors-safe creatives (R3); (d) TikTok / YouTube creator integrations with a
   per-creator code (§14) and marketplace bloggers (CPA); (e) Telegram Ads
   aimed at KZ/BY; (f) EN Telegram Ads, only with complete EN chapter-1 tables. Every creative shows the public
   (minors-safe) track only (§8.5).
4. **"How to buy Stars" help page** naming official routes only (09); read the invoice-friction event weekly.
5. **Sequential price periods** if price is tested at all (Civil Code art. 426).

**Gate to launch:** D1 read on ≥ 900 starts (sourced arithmetic); D1 ≥ 25 %, D7 ≥ 8 %, D30 ≥ 3 % (sourced
practitioner gates for general F2P — an ASSUMPTION for this genre; the GameAnalytics D7 median is just under 4 %);
chapter-1 completion ≥ 40 % (ASSUMPTION, the 07 base); start → payer ≥ 2 % per language cohort (ASSUMPTION); RU
invoice-friction and load-failure rates known (no threshold sourced); no open payment or refund defect (principle 2).

| Zero | Small ($300-1,000/month) | Medium ($3,000-10,000/month) |
|---|---|---|
| Waitlist, channel, invites; may not reach 900 starts (organic volume unsourced) | ≈ 250-3,600 starts at Telegram-Ads-type costs; via VK Ads ≈ 160-5,900, via KZ Telegram Ads ≈ 770-7,900 (ANALYSIS). D1 and funnel shape, not a paywall A/B | ≈ 2,400-36,000 starts: 1-2 paywall tests a month (€1,850-4,370 each), per-channel CAC |

**Checkpoints:** ERID + «Реклама» ("Advertisement") + advertiser identity where the platform or exchange demands it;
the age label; no "ask your parents" or peer-shame hooks (the audience starts at 14); no 18+ material in any creative
or landing page (§8.5). The RU ad-law exposure is accepted (R3). **Product dependency:** M11 attribution + campaign prefixes (F1), paywall
and invoice events (F2), the activity fact (F4), live Stars payments, the landing page (F17).

### 6.3 Phase 2: Launch

**Goal:** featuring eligibility, viral loops live, the first scaled spend only on channels that passed the gate.

**Actions, in order:**
1. **Meet the featuring conditions** (Main Mini App, Stars, previews, design guidelines; there is no form, 01).
2. **Live:** invite, share and referral (M10-M14, M23); a static per-story share card (F6); `addToHomeScreen` after
   chapter 1 (F11); release-cadence posts ("next chapter on <date>", F16).
3. **EN:** a VNDB entry; one r/visualnovels announcement and the r/otomegames weekly thread; a jam entry only if a
   free demo build exists (architect fork).
4. **Spend only on channels that passed;** Telegram Ads bought with earned Stars for EN/CIS ($0.02 per Star).

**Gate to growth:** LTV : CAC ≥ 1.4× per channel at D30-D90 (sourced practitioner rule: CPI at 30-70 % of LTV); CPI
rises < 30 % when spend triples (sourced, CLAIMED); K measured (no benchmark; K ≈ 0.05 as the floor reference).

| Zero | Small | Medium |
|---|---|---|
| Featuring, shares, referral, VNDB, Reddit, owned channels | The best measured channel at its measured CAC; Stars recycled into Telegram Ads | Scale only channels that pass; CPA bloggers (Perfluence model); creative waves |

**Checkpoints:** the Affiliate Program decision (affiliates promote with their own creatives: they must not show the
18+ track in public); EN influencer disclosure (FTC / ASA).

### 6.4 Phase 3: Growth

**Goal:** repeatable acquisition without breaking principles 0-2. **Actions:** the Affiliate Program — EN first, low
commission, finite duration (both can only be raised); influencers at scale; the EN market; guest mode, Communities,
inline teaser cards; live-ops windows (a free chapter or hint weekend, the Diamond Fever analogue, 05); RU Telegram
channel posts at scale on the measured CAC (R3). **Gate:** the same LTV : CAC rule per channel and market.
**Budget:** medium, sized to the measured CAC; never spend on unmeasured channels.

## 7. Product feature asks (listed, not designed)

| # | Ask | Why (evidence) | Maps onto | Conflicts / constraints | Phase | Owner or engineering |
|---|---|---|---|---|---|---|
| F1 | Campaign attribution: `startapp` prefixes distinct from `f<code>`, first-touch per user, plus an "unattributed" bucket | No channel CAC without it (02 §Appl., 07 Appl. 2, 04, 05). Search ads drop `start` (02 §1) | M11 (non-`f` prefixes "reserved"), LF1 | One `start_param` per link, ≤ 64 characters as the safe envelope (research_M2), so a campaign code plus an invite needs one encoding. Whether Ads accept `startapp` is pending check (§10). A bot `/start` path into the Mini App for ads that take only `?start=` | Soft launch | Engineering |
| F2 | `paywall_shown` / `paywall_dismissed` events; invoice opened → closed unpaid, by language and platform | Paywall conversion and RU Stars friction are unknown (07 Appl. 3; 09 Appl.) | SP Y9 (a closed vocabulary), `orders` | Y16: no third-party analytics, so server-side only | Soft launch | Engineering |
| F3 | Share and invite counters (shares prepared; `f<code>` launches → newcomers) | K-factor (07 Appl. 4) | M14, M11 | — | Launch | Engineering |
| F4 | Retention fact: one (user, day) row at `POST /api/auth` | `last_seen_at` is overwritten (07 Appl. 1) | SP Y9 / Y16, Q23 | New personal-data processing (152-FZ; lawyer item Q23) | Soft launch | Engineering + owner (Q23) |
| F5 | Launch-to-first-scene failure reports by region and network type | Whitelists and 16 KB throttling (09 §4) | L7 facade, stats | Data minimisation; no IP storage (privacy inventory) | Soft launch | Engineering |
| F6 | Static share-card image per story (`InlineQueryResultPhoto`) | A visual genre; Romance Club's virality ran on character art (05; 03 ask 1) | M14 "Later", MV3 | A public JPEG ≤ 5 MB, so free-chapter art only (principle 0); no ending titles (Q25); short captions (iOS bug, M2) | Launch | Owner (MV3, art) + engineering |
| F7 | Invitee-weighted referral reward (invitee ≥ inviter); a reward-size review | JMR 2020: friend-benefiting rewards "marginally" better (V2 #12). Zhuang: conditional inviter rewards bring worse invitees (abstract, V2 #11). Size ≈ $0.02 vs the $2.50-5 tested (C1 M7) | MV5 (default 5/2), M23 | A larger invitee bonus per new account raises farm yield; the M23 caps bound it | Launch | Owner (MV5) |
| F8 | Telegram Affiliate Program | Zero code; pays the promoters of payers (01 C) | MV11 (default "not used") | The commission is ours (V1 X3) and raise-only. RU affiliate posts are our ads, unmarkable (06). An affiliate launch has no `startapp`, so it is unattributed in M11. The webhook must tolerate `affiliate` and negative amounts | Growth | Owner (MV11) |
| F9 | `requestWriteAccess` opt-in for a waitlist and new-chapter notices | A bot cannot start a conversation (04 §4) | L7 facade; the privacy inventory | The inventory lists `allows_write_to_pm` as "not stored", so it needs a consent record. Trust it only from signed initData; §6.2.5 | Launch (the bot `/start` waitlist covers pre-launch) | Engineering + owner (copy) |
| F10 | Main Mini App + preview media per language (RU, EN, default); description; loading screen | Featuring needs a Main Mini App + Stars (V1 #1); ≤ 12 per localization (V1 #3) | D2 runbook `bot-setup`, MV14 | Previews are public, so free art only (principle 0); formats undocumented (§10) | Pre-launch | Owner (Q2, Q4) + engineering |
| F11 | `addToHomeScreen` prompt after chapter 1 | A return path to the cliffhanger (03); no retention data | L7 facade | Respect a decline | Launch | Engineering |
| F12 | Age-category marking: a category per story in `story/chapters.json`; the sign in the bot description and on every creative | 38-FZ art. 5 p. 10.1; VK Ads cl. 4.6 (06 §3.1; 09 §5) | Story index; MV12 | Keep "minimum user age" (MV12) and "content category" separate (C1 W2) | Pre-launch | Owner (category) + engineering |
| F13 | Guest mode (10.0) / Communities (10.2) | New surfaces (03 TL;DR) | Later lane | Spam §5.2(b); buttons in guest results unknown; minors in groups | Growth | Engineering + owner |
| F14 | "How to buy Stars from Russia" help page and `/paysupport` copy | No frictionless route (09 §1) | Locale tables, `/paysupport` | Name only official routes (App Store, @PremiumBot, Fragment). Never resellers (Stars ToS §4); no VPN mention | Soft launch | Owner (copy) + engineering |
| F15 | Premium choices (paid options inside chapters) | The market leaders' main lever (05 §3) | Monetization model, Q3 | Principle 0: branch text cannot ship in a free chapter's JSON, so it needs per-branch server gating; many `openInvoice` round trips; the "manipulation" backlash | Growth, if ever | **Owner value** |
| F16 | Release cadence: the story index can announce upcoming chapters ("next chapter on <date>") | Romance Club cadence; Love Sick's decline when content stopped (05) | `story/chapters.json` | Announce only public titles | Launch | Owner (cadence) + engineering |
| F17 | Public landing page per story on our domain: art, age sign, a t.me button | VK Ads requires a browser page with no redirects (09 §5); VNDB, press and itch need a URL | The privacy-policy host (MV14) | Free art only; must be reachable from RU (Q21) | Soft launch | Engineering |
| F18 | Locale hint in the campaign code | An ad, its channel and its destination must share a language (Ads §4.7) | F1, Q8 | — | Soft launch | Engineering |
| F19 | How a Stars debit after an Apple refund reaches the bot; revoke entitlements | Telegram may debit Stars (09 §1.3) | L9 refunds | Principle 2 | Soft launch | Engineering (test bot) |
| F20 | Server-side 18+ flag per user (method, time, policy version), separate from purchases and entitlements | R5; no Telegram age signal (§8.5 A8) | Auth/users, privacy inventory (M25), MV12 | Principle 1: never from `initDataUnsafe`, `birthdate` alone or client storage; 152-FZ data minimisation | Before the 18+ track | Engineering + owner (P21) |
| F21 | 18+ chapters and art served only after entitlement AND the 18+ flag; never in the public bundle, even if free | §8.5 A1, A5-A6 | Principle 0's delivery path (L6b), the asset pipeline | Extends principle 0; no conflict | Before the 18+ track | Engineering |
| F22 | Age category per story and per chapter (0+/6+/12+/16+/18+) in the story index, enforced by the server and the story gate | 436-FZ marking; §8.5 | `story/chapters.json`, F12 | Story DSL / index change (a lane owns it) | Before the 18+ track | Engineering + narrative |
| F23 | Minors-safe defaults: no 18+ titles, covers, teasers or locked hints for a user without the flag; separate covers, previews and share texts for 18+ | §8.5 Recommend; A2 (complaints start cases) | M14 shares, M12-M13 friend views, Home, store previews | Friend views and shares must not reveal 18+ titles to a minor friend | Before the 18+ track | Engineering |
| F24 | Story-gate lint for the 18+ track: explicitly adult characters in text and art metadata, no school setting | §8.5 A3 (art. 242.1) | Story lint (L3b/L3c) | Lint cannot judge art; a review step stays | Before the 18+ track | Engineering + narrative |
| F25 | A kill and refund path for the 18+ track (disable, refund, revoke) | Stars withholding risk, Bot Developer Terms §6.2.4 (A5) | L9 refunds, catalog | Principle 2 | Before the 18+ track | Engineering |
| F26 | Rewarded-ad hint source: network postback → our endpoint (secret, HTTPS) → idempotent grant keyed on a unique per-show id; a client `show()` never grants; a daily cap; an ad-hint ledger kept apart from Stars purchases | §12 (11 §Appl.; Monetag documents a per-show id; AdsGram's callback is unsigned) | Hint economy (M17-M21), M22/M23 caps as a model | Principle 1; a new third-party integration (principle 6) | Growth (after a holdout) | Engineering + owner (P23) |
| F27 | One lazy-loaded ad module (init / preload / show), never in the initial bundle, never active during story scenes | §12 (SDK ≈ 191 K characters for AdsGram) | Client, L7-style facade | Principles 4, 5, 6 | With F26 | Engineering |
| F28 | A written category blocklist (gambling, adult, dating, crypto incl. non-TON crypto per Developer Terms §7.4, VPN), "task" ads off, before any minors-reachable placement | §12; V6 | Ad network settings | 38-FZ art. 6; Developer Terms §7.4 | With F26 | Owner + engineering |
| F29 | Ad-data consent step and a privacy-policy section naming the network and its jurisdiction | §12 (SDK data: Telegram id, username, device, IP; initData fields in headers, V6) | Privacy policy (M26), Y16 | Y16 needs an explicit exception; 152-FZ cross-border transfer — lawyer item | With F26 | Owner + lawyer |
| F30 | An ads-free state (payers, or a Stars purchase) and an ads on / off holdout before wide rollout | §12 (cannibalization unmeasured) | Catalog, cohorts | — | With F26 | Owner + engineering |
| F31 | Clip capture mode and marketing asset set: vertical 9:16 chapter-1 captures, character cards, subtitles RU/EN, a fan-edit licence note; an export check that no paid or 18+ asset enters it | §14 (13 §Appl.) | Client dev mode, asset pipeline | Principle 0 (no paid asset in public clips); §8.5 | Pre-launch | Engineering + owner (licence) |
| F32 | A speakable bot username and a code-entry path for Shorts, where links are not clickable | §14 | Q4, F1 | — | Pre-launch (username) | Owner |
| F33 | If a ruble route is approved (§13 option c): a rail-independent entitlement record (provider, provider payment id UNIQUE, refund/dispute states), a provider webhook with a status re-check, a per-currency price table, website identity (Telegram Login or a player id shown in settings), 54-FZ receipts | §13 (12 §Appl.) | L8a/L8b payments, L9 refunds | Principle 2's wording needs a scope sentence (owner); no link or mention inside the Mini App | After an owner ruling | Engineering + owner (P27-P31) |
| F34 | For the R7 split: the redirect domain assigns each new visitor to an arm (50/50, sticky, recorded in the `start` code), and per-arm metrics (first-chapter starts, payer share, Stars and ad revenue per new user, block rate) are compared after a sample size fixed in advance; a separate bot created directly on a separate owner account (no transfer, no Managed Bots link), with its own token (no Mini App, no `web_app` button, no payments, no initData; the token never in the main server's environment); it links only to the main bot (URL button with a `start` code), never to our channel or chats; a first-screen notice with `/stop`; at most one mailing a day; every request checked against F28, the token revoked on a breach; the user-ID upload covered by the privacy policy and the 152-FZ review (F29); Telegram Ads links straight to the main bot, other public links through our redirect domain; block logging from `my_chat_member`; no re-creation after a ban | §12.1 (14 §5, V8) | A small separate service; the redirect domain; campaign codes | Principles 0-3 hold only while the token stays apart; Developer Terms §4.5, §5.2(f), §10; Ads guidelines §4.3 | Growth (exchanges need ≥ 1,000 active users) | Engineering + owner (R7) |

## 8. Legal do / don't checklist (INTERPRETATION, not legal advice)

### 8.1 Russia

**R3 (owner, 2026-10-31):** the ad-law risk is accepted. The rows marked "(R3: accepted)" are kept as facts — what the
exposure is — not as plan constraints. Rows on content, minors and Telegram's own terms are not ad law and stand.

| Do / Don't | Rule | Source |
|---|---|---|
| **Do** mark every paid RU internet ad: «Реклама» ("Advertisement"), the advertiser's name or site, an ERID token from an ORD, and ERIR reporting. The ERID cannot be added after publication | 38-FZ art. 18.1; KoAP 14.3 p. 15-16 (legal entity 200-500 k RUB) | 06 §1.2-1.3; V3 #18 |
| **Do** decide the advertiser of record first. ERID needs its details; the 3 % self-withholding binds only a Russian entity, IP or citizen | 38-FZ art. 18.2 p. 5 | V3 #23; Q21 |
| (R3: accepted) **Don't** run paid placements inside Telegram aimed at RU from 2027 without a FAS position. Per FAS, the violation exists now; liability is deferred to 2026-12-31 inclusive. Exposure: KoAP 14.3 p. 1, 100-500 k RUB per violation (legal entity). The reading of "restricted" is contested and untested in court | 38-FZ art. 5 p. 10.7 | V3 #1-#6, #20 |
| (R3: accepted) **Don't** buy a pinned or long-running Telegram placement that stays live into 2027 | Same | 06 pitfalls |
| **Don't** advertise on Instagram or Facebook (no transition) | p. 10.7; FAS 2026-03-25 | V3 #4 |
| (R3: accepted; exchanges may still refuse) **Don't** place ads in an unlisted channel above 10 k subscribers. Telegram is on RKN's social-network register (2021-10). Don't place in foreign-agent channels | 38-FZ art. 5 p. 10.6, p. 10.5 | V3 #25-#26; 06 |
| (R3: accepted) **Don't** mention VPN in any ad or partnership | 38-FZ art. 5 p. 10.8; KoAP 14.3 p. 18 | V3 #38 |
| **Do** state the age category (0+/6+/12+/16+/18+) in every ad | 38-FZ art. 5 p. 10.1; 436-FZ arts. 2, 6, 11 | V3 #27 |
| **Do** keep romance within the category: 12+ is "episodic, non-naturalistic" depiction between a man and a woman with no sexual acts; 16+ allows depiction without "exploiting interest in sex" | 436-FZ arts. 9-10 | V3 #28 |
| **Don't** include same-sex routes in the RU build (the risk reading). For minors, depiction is barred; for adults, "propaganda" is banned at every age (KoAP 6.21; legal entity from 800 k RUB). Romance Club's RU app cut those routes | 436-FZ art. 5 p. 2 item 4.1; KoAP 6.21 | V3 #29; V2 #28 |
| **Don't** use hooks aimed at minors: "ask your parents", affordability distortion, peer advantage or inferiority, appearance shaming | 38-FZ art. 6 | 09 §3; 06 §3.3 |
| **Do** treat our own channel and bot posts about our own chapters as information. Risk rises with posts that "stimulate special interest" | FAS letter АК/32908/25 (2025-04-09) | V3 #22 |
| **Do** state the period, the place of the rules and the prizes in any contest ad | 38-FZ art. 9 | 06 |
| **Don't** run per-user randomised prices; use sequential periods | Civil Code art. 426 §2 | V1 #43 |
| **Do** keep single purchases in the "minor everyday" range if 14-17-year-olds may buy, and honour parental refund requests (`refundStarPayment`) | Civil Code arts. 26, 175 | 09 §3 |
| **Do** get separate consent for referral data. Under 14, use the parental path | 152-FZ art. 9 | 06 §3.5 (M3) |

### 8.2 Telegram policies

| Do / Don't | Rule | Source |
|---|---|---|
| **Don't** run sexually suggestive creatives, dating framing, or gruesome or shocking imagery. This constrains the horror-puzzle angle too | Ad guidelines §5.1 | V3 #31 |
| **Don't** use clickbait, false or exaggerated claims, or scare tactics | Ad guidelines §5.4 | V3 #31 |
| **Do** match the language of the ad, its target channel and its destination | Ad guidelines §4.7 | 02 §1 |
| **Do** make the destination bot useful: it must respond on mobile and desktop, have a profile image and a full description, and not be a redirect bot | Ad guidelines §4.2-4.3 | 06 §4 |
| **Don't** spam users. Broadcast only to users who granted permission | Bot Developer Terms §5.2(b), §6.2.5 | V3 #35 |
| **Don't** run multi-level referrals, rewards for bare sign-ups or channel joins, or rewards for ratings and reviews ("social growth manipulation" is undefined) | §5.2(d)(i)-(ii); Apple 3.2.2; Google Play | V3 #35; 06 §4 |
| **Don't** point users to resellers. Stars may not be sold or transferred, and the only licensed resellers are three Smart Glocal entities | Stars ToS §4; third-party-payments page | 09 §1.1 |
| **Do** expect Stars held up to 21 days and possibly withheld for "suspected abuse" | §6.2.4 | V3 #35 |
| **Don't** enable "topics in private chats" without counting its 15 % non-refundable fee | §6.2.6 | 07 §2 |

### 8.3 EU, UK and US (only if English targets them)

| Do / Don't | Rule | Source |
|---|---|---|
| **Do** treat EU, UK and Australian users as 18+ (Telegram's own minimum) | Telegram ToS | V3 #32 |
| **Do** show real-money context next to hint prices; let buyers pick amounts; no withdrawal waiver for hint packs | CPC key principles (2025-03-21, soft law, known via law firms) | V3 #33-#34 |
| **Do** use the CRD waiver flow for chapter unlocks (digital content) | CRD art. 16(m) | 06 §5 |
| **Do** disclose influencer and affiliate ties (#ad up front; an affiliate reward is a material connection) | FTC Endorsement Guides; ASA / CAP | 06 §5 |
| **Don't** collect data from under-13s with actual knowledge | COPPA | 06 §5 |

### 8.4 The dual audience (R4: women 14-25): what differs for 14-17 and 18+

| Dimension | 13-17 | 18+ | Source |
|---|---|---|---|
| Minimum user age vs content category (separate notions) | MV12 default 14+ RU; under 14 takes the parental path | User 18+; category up to 18+ | MV12; 06 §3.5; C1 W2 |
| Romance content | 12+: episodic, non-naturalistic, no sexual acts. 16+: depiction without exploiting interest in sex | Wider (still no pornography) | V3 #28 |
| Same-sex content (RU) | Depiction barred | "Propaganda" banned at all ages; risk reading: none in RU | V3 #29 |
| Horror and fear (the puzzle wish) | Age-restricted | Allowed with the category | 06 §3.2 |
| Ad copy | 38-FZ art. 6 applies in full | General 38-FZ | 09 §3 |
| Ad targeting | Telegram Ads has no age targeting, so ads must be child-safe wherever they run. VK requires 18+ targeting only for dating and lotteries | Exclusion only by channel choice, or MTS BigData (RU, reseller) | 02 §1; 09 §5 |
| Ability to pay | "Minor everyday" deals only; parents may void others in court; Apple Ask to Buy cannot be turned off under 18 in Family Sharing "depending on the child's state, country, or region" (V4; not for a standalone 13-17 Apple ID); plus the RU Stars friction | Full capacity, plus the RU Stars friction | 09 §3 |
| Pending rule changes | РВИ memorandum (2026-10-20, CLAIMED snippets): parental confirmation under 14, monthly limits | — | 09 §3 |
| English line | EU/UK/AU teens excluded by Telegram's ToS; COPPA under 13 | OK | V3 #32 |
| Platform reach | Mediascope 2024, before the restrictions: 12-17 daily reach Telegram 80.6 %, VK 64.9 %, TikTok 62.2 % | — | 09 §2 (stale) |
| Case evidence | Top-3 story apps combined (2018): 78 % female, 80 % aged 10-21. Episode was criticised for sexualised marketing | Romance Club RU 18+; Lore 18+; short-drama audiences adult women (ReelShort ~75 % female) | V2 #45, #50; 05 |

**Planning default after R4/R5 (the owner decided the audience; the category split is the plan's reading):**
- the user minimum stays 14 (MV12 matches R4); the **public track** — free chapters, covers, previews, shares,
  creatives, landing pages, the channel — is at most 16+ and safe for 14-17;
- the **18+ track** (R5) is a separate category per story or chapter, reachable only after the age gate (§8.5);
- every creative is written minors-safe, because Telegram Ads cannot exclude minors and the audience starts at 14.

### 8.5 The 18+ track (R5): content law, platform rules, the age gate (INTERPRETATION, not legal advice)

Source: `10-adult-content-age-gate-dual-audience.md` (10), checked by `V5-verify-adult-content.md` (V5). R3 waives the
**ad-law** risk only; the rows below are criminal law on the content itself and the platforms' own terms.

**Shows:**

| # | Rule | What it means for an 18+ romance track | Label | Source |
|---|---|---|---|---|
| A1 | UK RF art. 242: making, distributing, publicly showing or **advertising** pornographic materials is a crime; no exemption, licence, age gate or paid-access carve-out. Internet: part 3 "б", 2-6 years. "Among minors": part 2, 2-5 years | "Soft porn" has no legal meaning: an expert decides per item whether it is pornography or lawful erotica. Giving access even to one person is "distribution" (Supreme Court Plenum No. 37 of 2022, p. 22), so neither a paywall nor an age gate makes it lawful. Advertising pornography is an element of art. 242 itself, separate from 38-FZ (R3 does not cover it) | DOCUMENTED (law, ed. 2026-08-04; Plenum) | 10 [19]; V5 |
| A2 | Practice: drawn anime erotica convicted (Tomsk, part 3 "б", 2024-12, started by a classmate's complaint); **text alone** convicted (fan-fiction texts, a language expert, part 3 "б", 1.5 years of forced labour, 2026-05); paid closed Telegram channels with explicit content prosecuted (2025) | Drawing, text-only form and paid closed access do not protect; one complaint from a teen who passed a self-declaration can start a case | CLAIMED (press reports of verdicts) | 10 [27][28]; V5 |
| A3 | UK RF art. 242.1 (sexual depictions of minors), "any depiction". Drawn characters **have** been treated as minors: Bryansk 2019-2020, an expert assigned an under-14 age to drawings, conviction under 242.1. The artistic-value exemption covers depictions of genitals only, not sexual acts | Every sexual scene: characters explicitly adult in text and art, no school setting, no youthful styling — the highest exposure next to a 14-17 audience | DOCUMENTED (law) / CLAIMED (case) / INTERPRETATION | 10 [20]; V5 (corrects 10's "no drawn case") |
| A4 | Precedent: Romance Club ships a separate 18+ RU app with same-sex routes removed (the source says nothing about its erotica level); Litnet runs an «Эротика» ("Erotica") genre behind an account (snippet) | Non-naturalistic, 18+-marked erotica is the lane closest to practice, but no source shows it is tolerated — it stays an expert call (A1-A2) | CLAIMED (practice) | 10 [33][34]; V5 |
| A5 | Telegram ToS: no "illegal pornographic content" on publicly viewable bots and channels; Bot Developer Terms §9: comply with the Apple and Google store guidelines; Bot Developer Terms §6.2.2 (Stars on a bot's balance are owned by Telegram), §6.2.4 (withholding) and §10 (no compensation on termination) | Stars earned from content that breaks RU law or store rules are at risk | DOCUMENTED | 10 [1][4]; V5 (the clause is not Stars ToS §5, which covers a user's own balance) |
| A12 | 436-FZ art. 16 part 6: selling 18+ information products to under-18s is banned (no statutory duty to verify age); the MAX law (569-FZ) amended it to let a seller check age via MAX | Our own gate is the only barrier between a 14-17 user and the 18+ track; MAX age checks need a MAX integration (principle 6) | DOCUMENTED (law) | V5 |
| A6 | Apple 1.1.4 bans "overtly sexual or pornographic material"; 4.7.5 makes a host app (Telegram, rated 13+) identify and restrict mini apps above its rating; Google Play bans content "intended to be sexually gratifying" | Anything visible to iOS/Android users without Telegram's own gate stays within a 13+ host's limits | DOCUMENTED | 10 [15][16][18] |
| A7 | Telegram's `restriction_reason` (`sensitive`, `porno`, platform `ios`) applies to a whole bot | A flag on a shared bot puts the 14-17 track behind an 18+ spoiler too: one bot or two is a real fork | DOCUMENTED | 10 [7][8] |
| A8 | No age signal a bot can read (Bot API 10.3): @TelegramAge (face scan, UK since 2025-07, not in Russia) is not exposed to bots; `birthdate` (Bot API 7.2) is user-entered and optional | The gate must be our own, server-side (principle 1) | DOCUMENTED | 10 [7][9][10][11] |
| A9 | Russia has no age-check law or service a game can use in 2026: Mintsifry calls it "the nearest agenda" (2026-06-08); the MAX ID law covers alcohol, tobacco, lotteries and events (and 436-FZ art. 16, A12); ESIA login is open only where a law or government act requires it or a government commission approves — no path for a game (V5) | Options: self-declaration (free, weak), a vendor check (Didit ≈ $0.10 per check, CLAIMED; camera in the WebView untested), or no 18+ track in RU | CLAIMED (press) / CLAIMED (vendor) | 10 [31][32][36] |
| A10 | Promotion: Telegram Ads §5.1 bans sexually suggestive ads, and the ad rules cover the **promoted product**, not only the creative (V5); VK requires linked communities without sexually explicit images; adult networks (ExoClick, TrafficJunky, JuicyAds; deposits $25-€500, CLAIMED) serve explicit, male-skewed traffic | The 18+ track has almost no compliant paid channel; a bot that also carries a sexual 18+ track risks rejection even with a clean ad — another reason for a separate 18+ bot (P20) | DOCUMENTED / CLAIMED | 10 [14][37] |
| A11 | Dual-audience precedent = separate apps or builds: Romance Club's separate 18+ RU app (2026-05-19); Everlasting Summer's adult version on Nutaku (2015-08) | Separation is the norm, not one mixed catalogue | CLAIMED | 10 [34][38] |

**What each content level means under Telegram's rules and Russian law (INTERPRETATION; A1, A5-A7, A10, A12):**
Telegram's own ToS bans only "illegal pornographic content" on public bots; the limits come from the imported store
rules (Apple 1.1.4: "explicit descriptions or displays of sexual organs or activities intended to stimulate erotic
rather than aesthetic or emotional feelings"; Google: "intended to be sexually gratifying"), from Apple 4.7.5 (Telegram
must age-restrict mini apps above its 13+ rating, so a bot may be flagged `sensitive` as a whole), and from the Ads
guidelines (suggestive ads banned; the rule reaches the promoted product).

| Level | Telegram and the stores | Russian law |
|---|---|---|
| Romance, kisses, implication, fade to black (≤ 16+) | Allowed; the main, advertised bot | Allowed with the 16+ sign |
| 18+ erotica without explicit depiction of sexual organs or acts | Allowed; best in a separate bot that may carry an 18+ flag, behind our own age confirmation; not advertised through Telegram Ads | Allowed with the 18+ sign, sold only to adults (436-FZ art. 16 part 6); the "non-naturalistic" line is an expert call |
| Explicit scenes ("soft porn") | Breaches Apple 1.1.4 (iOS) and Google's policy; Stars at risk (§6.2.4) | Art. 242 risk; no gate or paywall exemption |

Gap: no source states how Telegram decides to flag a bot (10 "Must verify" V1).

**Recommend (a planning reading — the owner decides, a lawyer confirms):**
- **RU content level:** at most non-naturalistic 18+ erotica (A4); no explicit ("soft porn") material in anything
  served to Russia (A1-A2) — text included, since text alone has been convicted. A lawyer reviews sample 18+ scenes
  (text and art) before production. Explicit material, if ever, only for non-RU audiences after a separate legal
  review there.
- **Separation:** every public and 14-17-reachable surface stays minors-safe (≤ 16+): free chapters, Home, covers,
  previews, shares, creatives, landing pages, the public channel, referral and gift flows. A user without the 18+ flag
  never sees 18+ titles, teasers or "locked" hints.
- **The gate:** a server-side 18+ flag per user (method, time, policy version), separate from purchases; 18+ chapter
  JSON and art served only after both the entitlement and the flag, never in the public bundle (principle 0's path).
  Minimum method: a logged self-declaration — acceptable only while the RU line stays non-pornographic (A1).
- **One bot or two:** a platform flag on a shared bot would hit the 14-17 funnel (A7), and Telegram Ads judge the
  promoted product, not only the ad (A10). Since the public track is the one advertised, a **separate 18+ bot** keeps
  the advertised bot clean (P20).
- **Money:** treat 18+ Stars revenue as at risk until a payout cycle clears (A5: Bot Developer Terms §6.2.2, §6.2.4,
  §10).
- **Promotion of the 18+ track:** inside the product to confirmed adults, and an own 18+-marked, erotica-only channel;
  never in paid creatives, never in fan channels whose audience includes minors (A10; 10 channel rows).

## 9. Owner value questions

Numbered P1-P34 so they do not collide with the `docs/OPEN-QUESTIONS.md` numbers (Q3, Q5, Q21 …) cited elsewhere.

| # | Question | Why it matters | Options | Default the plan assumes |
|---|---|---|---|---|
| P1 | Budget tier and monthly ceiling | It decides whether the gates are reachable (§5.7) | Zero / small $300-1,000 / medium $3,000-10,000 | Zero pre-launch; small at soft launch (to reach about 900 starts); medium only after the gates |
| P2 | ~~Audience age bracket~~ **DECIDED (R4, R5):** women 14-25; 18+ erotic content behind an age confirmation. Open part: the age-gate method and what counts as "confirmed" (§8.5) | It fixes the gate, its cost and its legal weight | Self-declaration / document or bank-ID check / Telegram-side signal if one exists (§8.5) | §8.5 |
| P3 | Positioning: "otome romance" or "romantic mystery / horror" (C1 M8); how the 18+ track is presented | Creatives: §5.1/§5.4 ban suggestive, gruesome and scare imagery; fear content is age-restricted; VNDB's 50 % reading rule | Romance-led / mystery-led / both; one brand or a separate 18+ brand | Romance-led, minors-safe public brand; the 18+ track never shown in public material (§8.5) |
| P4 | Content policy for the RU build (V3) | Same-sex content and sexual-content levels; Romance Club's precedent | RU = EN / RU-specific cut / none anywhere | No same-sex routes in RU builds; EN differences are a values call |
| P5 | When to target English, and which regions | EN channels need complete EN tables; EU/UK users are 18+ | At launch / after RU soft launch / later | After the RU soft launch; no EU/UK teens |
| P6 | ~~Launch timing vs 2026-12-31~~ **DECIDED (R3):** the ad-law risk is accepted, so the date does not bind | — | — | Launch when ready |
| P7 | CIS test geos; Ukraine | Cheap Russian-language reach, but a grey "aimed at RU" zone | KZ/BY yes / no; Ukraine | KZ/BY after the lawyer; Ukraine excluded (08: language rules, politics) |
| P8 | Brand / persona (C1 M3: not researched) | Channel voice; the legal operator details are needed anyway | Studio voice / character persona / both | A studio voice as operator (bot, `/support`, legal); character-led posts as content (Romance Club memes, CLAIMED) |
| P9 | Bot username (permanent) | Every link and creative carries it | — | Decided before any public link; readable in Latin-script search and in Russian |
| P10 | Affiliate Program on/off, commission and duration (MV11) | Raise-only commission out of our revenue; RU marking risk | Off / EN-only pilot / on | A low-commission, finite-duration pilot in Growth (R3 removes the RU legal block); affiliates' creatives are outside our control, so the 18+ track must not be promotable through it (§8.5) |
| P11 | Referral split and size (MV5) | The evidence leans invitee-side; the reward is ≈ $0.02 of value | 5/2 / invitee ≥ inviter / larger rewards | 5/2 (MV5); revisit with launch data |
| P12 | Premium choices | The leaders' main lever vs principle-0 branch gating | No / later / yes | No (chapters-only, Lore positioning) |
| P13 | Real chapter prices (Q3) | Break-even is linear in price; 1 Star cannot fund any paid traffic (§5.5) | 50-150 Stars modelled; higher | Model 50-150 Stars; decide before the paid tranche. A teen line keeps prices "minor everyday" |
| P14 | Fund influencers? | Niche prices are unknown; ERID duty | None / marketplace CPA / direct deals | None before the public bot; marketplace CPA at soft launch if there is budget |
| P15 | Advertiser of record (Q21) | ERID needs its details; it sets the fine tier and the 3 % withholding | RU entity / IP / non-resident | Settle before any paid placement |
| P16 | Which RU network conditions the app supports (09, with Q5/Q21) | Whitelist mode needs RU-hosted servers | Fixed broadband only / plus mobile whitelist | Fixed broadband and Wi-Fi; whitelist mode unsupported unless hosted in Russia |
| P17 | Release cadence promise | The owned channel needs news; cadence kept the cases alive | None / every N weeks | No public cadence until two stories are complete (05) |
| P18 | Giveaways, gifts as prizes, live-ops free windows | The minors / giveaway law is a gap | None / later | None in the foundation |
| P19 | How explicit the RU 18+ line may be (R5's "soft porn") | Art. 242 has no lawful channel for pornography; an expert draws the line (§8.5 A1-A2) | Non-naturalistic 18+ erotica / more explicit / explicit only outside RU | Non-naturalistic erotica in RU; a lawyer reviews sample scenes |
| P20 | One bot for both tracks, or a separate 18+ bot/brand | A platform flag applies per bot (§8.5 A7); Telegram Ads judge the promoted product (A10); separate apps are the precedent (A11) | One bot / two bots / two brands | A separate 18+ bot, so the advertised public bot stays clean |
| P21 | Strength of the age confirmation | No readable Telegram or state signal (A8-A9) | Self-declaration / vendor check (≈ $0.10, CLAIMED) / no 18+ in RU | Logged self-declaration at the non-naturalistic level |
| P22 | Accept the iOS reach and Stars-forfeiture risks of the 18+ track | Apple 1.1.4 / 4.7.5 via Telegram's 13+ rating; Bot Developer Terms §6.2.2 / §6.2.4 / §10 (A5-A6) | Accept / keep 18+ off iOS / no 18+ track | Accept, with 18+ revenue treated as at risk until a payout clears |
| P23 | Ads in the minors-reachable main bot at all (§12) | Rewarded hints monetize non-payers; SDKs carry data and weak category controls | None / opt-in rewarded hints only / interstitials too | Opt-in rewarded ads for hints only, with the F28 blocklist; no interstitials, no "task" ads; after a holdout |
| P24 | "Watch an ad to unlock a chapter" (§12) | It would change the "chapters are Stars-only" value | No / yes | No — ads fund hints only |
| P25 | Third-party ad broadcasts through our bot — the model the owner saw (§12) | The exchanges ask for the bot token (V6); Developer Terms §5.2(b) / §6.2.5; 38-FZ art. 18 consent burden on us; uncontrolled creatives to 14-17 | No / own opt-in announcements only | **No** from the main bot; its messages stay our own opt-in announcements. A separate ad bot is P34 |
| P26 | Share Telegram id and device data with a foreign ad network (§12) | Y16 and 152-FZ cross-border transfer | No SDK / after a lawyer and a consent step | Only after a lawyer's review, with a consent step (F29) |
| P27 | "Instead of Stars" — inside Telegram, or alongside it outside Telegram (§13) | Inside the bot, Telegram's terms require Stars (sanction: hidden on mobile) | Replace inside (option a) / hybrid website (option c) / Stars only | Stars only inside Telegram; consider the hybrid website for Russian players after a lawyer reviews steering |
| P28 | Change CLAUDE.md principle 2's wording | It says "Stars only" without scope | Unchanged / add "inside Telegram apps" | Unchanged until the hybrid is approved; then one scope sentence |
| P29 | The merchant of record for rubles (with Q21) | A ruble route needs a Russian-resident ИП, ООО or самозанятый (НПД: ≤ 2.4 M ₽ a year, no staff) | ИП / ООО / НПД / none | Undecided; it gates P27 |
| P30 | Price parity Stars vs rubles; a ruble rail for the 18+ track | Apple 3.1.3(b) pattern wants the same items in-app; acquirers' lists name erotic content | Parity / different; 18+ on rubles yes / no | One catalogue at comparable prices; no ruble rail for the 18+ track |
| P31 | May 14-17-year-olds pay rubles directly to us | We become the counterparty for Civil Code art. 26/175 voiding | Yes, small amounts / no | Yes for small amounts, with an offer clause; a lawyer confirms |
| P32 | Who posts our TikTok, from where (§14, with Q21) | TikTok ToS bans bypassing its Russia restriction; the account is at risk if run from Russia via VPN | Brand account run from abroad / creators only / both | A brand account run from outside Russia, plus creators |
| P33 | Fan edits of our art and music | Edits drive romance virality; music licences decide | Allow (licence note) / forbid | Allow non-commercial edits of free-chapter art with a short licence note |
| P34 | A separate entry bot for third-party broadcasts (§12.1) | It keeps the main bot's token and announcements safe, but a gate adds one screen for every new user, an account- or developer-level ban can still reach the main bot, and the exchange gets our users' IDs | Gate (non-Telegram-Ads link → ad bot → main bot) / satellite (offered once from the main bot, opt-in) / none | **Decided (R7, 2026-11-01):** at the growth phase, split non-Telegram-Ads traffic through our redirect domain (gate vs direct with the satellite); keep the arm that earns more per new user, Stars plus ads; F34 conditions |

## 10. Verify before relying (test-bot and live checks)

| # | Check | What depends on it | How | Who |
|---|---|---|---|---|
| T1 | Telegram Ads accept `t.me/<bot>?startapp=<code>` destinations, or only `?start=` | F1: every Ads CAC (C1 W7) | Draft an ad in a reseller or Gram cabinet with both link forms (moderation answers it; at most a minimal deposit) | Owner (production bot) |
| T2 | A `?ref=` / `_tgr_` affiliate link opens the Main Mini App, or the bot chat | MV11 attribution | Start a 1 ‰, shortest-duration program and open the link (raise-only; ending takes ~24 h; referred users keep paying the affiliate until the duration ends, 01) | Owner (test bot if the test environment supports programs, else production) |
| T3 | Real `start_param` length on iOS, Android and Desktop (64 vs 65+ characters) | The F1 encoding | Open crafted long `startapp` links; read the signed initData | Owner on the test bot |
| T4 | Preview media formats, sizes and durations | F10 | Upload in BotFather | Owner |
| T5 | Gift prices (`getAvailableGifts`) | Prize costing | One Bot API call | Developer, test bot |
| T6 | Whether guest-mode results carry buttons | F13 | Enable guest mode on the test bot | Developer |
| T7 | @PremiumBot offering card / SBP payment for Stars to a Russian account | The RU paywall forecast | Open @PremiumBot → /stars and read the methods; no purchase needed (09) | Owner (a Russian account) |
| T8 | What the invoice top-up sheet offers a Russian account with no Stars | F2, F14 | Open an invoice on the test bot | Owner |
| T9 | How a Stars debit after an Apple refund reaches the bot | F19, principle 2 | A test-environment refund | Developer |
| T10 | Whether `savePreparedInlineMessage` needs inline mode on (MQ7) | M14 | Test bot | Developer |
| T11 | Whether the Stars cabinet shows ads in Russia and can promote bots (deksis contradicts api/stars) | Stars-recycled ads | Look in the cabinet once Stars exist | Owner |
| T12 | Whether VK Ads accepts a t.me landing or our landing page | VK Ads row; F17 | One test ad (500-600 ₽ top-up) | Owner |
| T13 | Mini App load from RU without VPN: fixed broadband, mobile whitelist, in-app proxy, on the chosen host | Every RU row; Q21/Q5 | A load test from Russia | Owner / tester |
| T14 | The live affiliate commission bounds and duration choices (only defaults were read) | P10 | The BotFather / profile UI | Owner |
| T15 | The live r/otomegames and r/visualnovels self-promotion rules | EN posting | Read the wiki before posting | Owner |
| T16 | Whether an age-estimation vendor's camera flow works in the Telegram WebView (iOS, Android, Desktop) without `window.open` | P21, F20 | A vendor sandbox page opened as a Mini App | Developer, test bot |
| T17 | A lawyer's reading of sample 18+ scenes (text + art) against art. 242 / 242.1 and 436-FZ 18+ | P19, the RU 18+ line | Legal review before production | Owner + lawyer |
| T18 | Whether SBP / bank-app deep links open from the Telegram WebView (if a ruble route is ever tried outside the Mini App, the link must not come from it) | §13 option c | A test page outside the Mini App | Developer |
| T19 | Whether the Telegram Login `id` equals the Mini App user id (website identity for option c) | F33 | Test bot + a test login page | Developer |
| T20 | Whether TikTok accepts a `t.me` link (bio, comments) and the bio-link follower threshold | §14, F17 | Try on the brand account | Owner |
| T21 | The live Stars price on the Russian App Store (V7 could not reproduce 209 ₽ per 100) | §5.3, §13 | Open the Stars purchase sheet on a Russian iOS account | Owner |

## 11. Gaps and evidence quality

- **"Not found" often means "not searched":** every area agent exhausted the shared search budget (C1 M10); the
  unanswered items cluster on Russian-language and audience-specific queries. Treat them as open, not as negative
  findings.
- **Gaps that move decisions:** organic volume of a new non-crypto TMA (C1 W5); any TMA K-factor; any chapter-paywall
  conversion; interactive-story retention; age and gender of the romance communities (TGStat 403, VK unfetchable);
  niche ad prices for romance, fandom and teen channels; the share of RU users able to buy Stars; the FAS 2027
  position; VK Ads t.me acceptance and VK's minimum target age; Yandex bot / Mini App landings; iOS/Android WebView vs
  the in-app proxy; 2026 OONI data on foreign hosts; our revenue when Telegram debits Stars already spent; the loss rate of a
  bot-to-bot hop, any enforcement case for opt-in bot ad mailings, and the exchange's commission (14).
- **18+ track gaps (10):** whether adult ad networks accept `t.me` landings; Nutaku's revenue share; whether a vendor
  face check produces biometric personal data under 152-FZ; settled practice on drawn characters under art. 242.1;
  the size of the RU adult-female erotic-romance audience on Telegram.
- **Smaller gaps:** seasonality (M4: do not invent a launch season); brand/persona (M3); giveaway law with minors
  (M2); the Premium share of payers (M9 — Premium users never see Telegram Ads); MAX as a promotion surface; Pikabu
  and Lemma Soft rules; the EU Digital Fairness Act status; Google Play Stars prices.
- **Leads not followed:** "ToonTrek" and Roko (story TMAs on findmini); «Цена выбора» ("The Price of Choice"), a
  choice game reported as released "first on Telegram" (09 §2; its brand attribution and audience figures are
  UNSUPPORTED, V4 N33) — the closest direct comparable, worth a follow-up.
- **Single-source, load-bearing:** the SA Media CPC €0.12 (agency, no method; the only input to the Telegram Ads cost
  per start); Gram cabinet "not shown in RU" and Stars cabinet "shown in RU" (deksis 2025-12, both); the RU Stars-route
  statuses (promotional articles; the carrier cut rests on RBC and anonymous sources); the Vigo whitelist figures
  (vendor via press); RevenueCat's 5.5 % (n not stated); the Zhuang referral result (seminar abstract); Durov's 65 M on
  VPN (interested party); the 95 % anomaly figure (denominator undefined).
- **Vendor numbers:** TMA ad-network floors and testimonials, the Perfluence ranking, findmini MAU, telega.in list
  prices, AdsGram's CTR "up to 15 %".
- **Stale, used with dates:** Choices / top-3 demographics (2018); Mediascope teen reach (2024); VK votes 45 % (2021);
  DTF rules (2019); reader-platform traffic (2022). Incompatible TMA reach figures (500 M, 1.44 B, 150-190 M, 102.7 M):
  quote none as a market size (C1 W8).
- **Checked late:** facts from 08 and 09 (CIS, VPN polls, MAX, Stars routes, audience channels, minors, network
  reach) were verified by V4 after the synthesis draft; its 12 corrections and 5 unsupported items are applied as
  N26-N33. Rows V4 confirmed keep their original wording.

## 12. Ad monetization on the publisher side (owner request; 11, checked by V6)

The owner asked about earning from official Telegram ads and third-party ads, including bots that send their users an
ad about once a day. **Shows:**

| Option | What it earns (label) | Rules and constraints | Fit |
|---|---|---|---|
| Telegram's own ad share in our bot / channel | 50 % of ad revenue to bot owners, not only channels (DOCUMENTED, core.telegram.org/api/revenue); paid in Gram via Fragment; Russian views reportedly earn $0 and payout needs a Sumsub KYC (CLAIMED, press 2026-05) | A sponsored message above the bot chat, not inside the Mini App; Premium users can turn ads off; we cannot choose the ads | Poor for a Russian audience; leave it on if it comes by default, plan no revenue |
| Rewarded ads for hints inside the Mini App (AdsGram, Monetag, TADS, RichAds) | No published RU/CIS publisher eCPM; anchors: AdsGram's $3.8-16 CPM claim (2024, CLAIMED), Russian native-app rewarded eCPM $4.52 Android / $11.44 iOS (Q2 2024, not TMA traffic, MEASURED-secondary) | Server-verified grants only (principle 1): Monetag documents a per-show id and a "paid" flag; AdsGram's reward callback and TADS's webhook carry no signature. SDKs send Telegram id, username, device, IP and signed initData fields (incl. any `start_param`) to foreign companies (Seychelles; Isle of Man / Hong Kong / UAE) — Y16 and 152-FZ items. AdsGram blocks only gambling and adult, on request; Telegram's Developer Terms §7.4 bans promoting non-TON crypto inside a Mini App (V6) | **Good fit for hints**: monetizes players who cannot buy Stars (09 §1); hints only, chapters stay Stars-only |
| Interstitial / "task" ads | As above | Interrupt scenes; "task" ads send minors to third-party channels and apps | Poor |
| Bot broadcast exchanges (Telega.in / telega.io) — **what the owner saw** | Advertisers pay 200-800 ₽ CPM or 12-41,958 ₽ per 1,000 bot users (eLama 2026-09, CLAIMED); the bot owner's net share not found | **The exchange asks for our bot token** (V6) — the token derives the initData key and controls payments and refunds, so handing it over breaks auth and money (principles 2-3). Also: Developer Terms §5.2(b) bans unsolicited messages, §6.2.5 allows broadcasts only with permission; 38-FZ art. 18 needs prior consent with the burden of proof on us (FAS 2019 letter applies it to messengers); uncontrolled creatives reach 14-17; blocks erode our own announcement channel | **Not from the main bot**; a separate entry bot: §12.1 |
| Paid broadcasts (Telegram feature) | A cost: 0.1 Star per message above 30 msg/s; needs 100 k Stars + 100 k MAU (DOCUMENTED, Bot API 7.11) | — | Irrelevant at launch scale |

**Arithmetic per 1,000 daily players per day (ANALYSIS on mostly ASSUMPTION inputs, 11 §5; V6 re-did it):** rewarded
hint ads ≈ $0.03 / $0.70 / $5.40 (low / base / high); a daily third-party broadcast ≈ $0.22 / $2.64 / $17.70; Stars
purchases ≈ $1.95 / $13 / $39. Ads out-earn Stars only below ≈ 5.4 Stars per paying user per day — for example at the
1-Star placeholder — so the comparison depends on the chapter price (P13).

**Recommend:** opt-in rewarded ads as an extra **hint** source for non-payers (P23), only through a server-verified
postback with a daily cap (F26), a lazy-loaded module (F27), the F28 blocklist, the F29 consent and a holdout (F30);
no interstitials or "task" ads; no ads in the 18+ bot until a network's acceptance and the §8.5 review are known; no
third-party broadcasts from the main bot (P25); a separate entry bot only under §12.1 (P34).

### 12.1 A separate entry bot for broadcasts (owner follow-up; 14, checked by V8)

The owner proposed one entry bot that every new user reaches first: it carries the daily third-party ad and forwards
users to the main bot, so a ban of the entry bot leaves the main bot working. **Shows:**
- **It removes the token objection.** The exchange gets only the ad bot's token; the main bot's token (the initData
  key, payments, refunds) never leaves our server. Users who block the ad bot keep the main bot's announcements.
- **The isolation is partial (DOCUMENTED + INTERPRETATION).** §5.2: Telegram "may terminate your TPA, your account, or
  both"; §10: "the Telegram account tied to your TPA may also be banned", with "any channels or communities affiliated
  with your TPA", at Telegram's sole discretion; the Terms bind "you, the developer". One owner account would lose both
  bots, so the ad bot is created directly on a separate account (no transfer, no Managed Bots link). That lowers the
  risk to the main bot but cannot remove it. The affiliation clause names our channel and community chats, so the ad
  bot links only to the main bot (V8).
- **No respawn (INTERPRETATION).** §5.2(f) bans attempts to "circumvent bans or content moderation"; a re-created ad
  bot reads as that. The ad bot earns until a ban and is not replaced.
- **Telegram Ads cannot use the gate.** Ads guidelines §4.3 ban "mostly noninteractive bots designed to redirect
  elsewhere", mock destinations for other ads and auto-redirecting websites (DOCUMENTED, V8). Telegram Ads campaigns
  point straight at the main bot with a `start` code; the gate covers only TikTok, blogger and own-post traffic.
- **The exchange also gets our users' Telegram IDs:** telega.io asks the owner to upload and refresh a user-ID list
  (CLAIMED, vendor guide, V8). It includes 14-17-year-olds — a 152-FZ transfer item, like the SDK data (F29).
- **Its token's actions count as ours** (§4.5); vendor-side approval is a workflow, not a control, so every creative is
  checked against F28 and the token is revoked on a breach (BotFather `/token`).
- **Enforcement:** no case of a bot banned for ad mailings was found (Gap, searched twice); the market is broad, as the
  owner says.
- **The front door:** in the gate design a ban kills every link that points at the ad bot, so non-Telegram-Ads links go
  through our redirect domain.
- **Timing:** the FAS no-liability window for Telegram ads ends 2026-12-31 (V3); a growth-phase launch most likely runs
  after it, with us as the distributor of each broadcast (a fact under R3, not a blocker).
- **Arithmetic (ANALYSIS on ASSUMPTION inputs, 14 §3):** drop-outs at the extra screen receive ads only until they
  block an ads-only bot, and buy no Stars. At base inputs the gate beats no ad bot while the hop loses under ≈ 20 % of
  new users (low 11 %, high 45 %); against the opt-in satellite the bar is lower; at the 1-Star placeholder ads
  dominate. At 10,000 daily players: ≈ 6,300 / 75,000 / 504,000 ₽ a month (low / base / high), before blocks, marking
  costs and the 3 % levy. Exchanges need ≥ 1,000 active users; their commission is not found.

| Design | Ad base | Main-funnel cost | If the ad bot is banned |
|---|---|---|---|
| Gate (owner's): non-Telegram-Ads link → ad bot → main bot | New users from those channels, until they block | One more screen for them (unmeasured) | Links die unless they use our redirect domain |
| Satellite: offered once from the main bot, opt-in | Opt-ins only | None | Nothing published points at it |
| Broadcasts from the main bot | All users | Blocks erode our announcements | The main bot; its token is handed over: **no** |

**Owner ruling (R7, 2026-11-01):** at the growth phase, split non-Telegram-Ads traffic through our redirect domain
(gate vs direct with the satellite offered) and keep the arm that earns more per new user, Stars plus ads, under the
F34 conditions. The arm assignment is random and sticky, and the comparison waits for a sample size fixed in advance.

## 13. Russian payments vs Stars (owner request; 12, checked by V7; INTERPRETATION, not legal advice)

**Shows:**
- **Inside the bot and Mini App, Stars cannot be replaced.** Bot Developer Terms §6.2 and the FAQ of
  core.telegram.org/bots/payments-stars: digital goods
  are paid "exclusively" in Stars and "cannot be processed through third-party payment providers"; the sanction is the
  bot hidden from mobile users or store versions of Telegram, then removal (DOCUMENTED). Precedent: Telegram warned
  @combot in 2024-05 after Apple flagged it (the notice survives as the recipient's copy on Apple's forum, V7). The
  Russian providers in BotFather (ЮKassa, Sber, Smart Glocal) are for physical goods (§6.1).
- **Apple via Telegram:** mini apps must use in-app purchase (4.7.1 → 3.1.1); license keys or QR codes that unlock
  content are banned; in-app links to other payment methods are banned outside the US. Apple has offered a Russia-only
  external-link permission since 2023-10, but 2026 forum posts say Russian developer accounts cannot get it under
  sanctions, and only Telegram's own app could hold it anyway (V7).
- **Outside Telegram, rubles are possible.** The FAQ limits the Stars duty to sales "inside Telegram apps", "regardless
  of any other web portals … outside the Telegram ecosystem" (V7: it neither frees outside sales nor speaks of
  unlocking web-bought items in the bot). Apple 3.1.3(b) allows web-bought content to unlock in an app if the same
  items are also sold in-app. Romance Club's precedent: a web shop keyed to a player id shown in the app's settings.

| Option | Net per 100 ₽ paid (ANALYSIS, CBR 80.56 ₽/$, V7) | Rule status (INTERPRETATION) | Verdict |
|---|---|---|---|
| Stars only (today, principle 2) | ≈ 50 ₽ via the RU App Store (before the TON-payout conversion); RU buyers face degraded Stars routes (09) | Compliant everywhere | Baseline |
| (a) Ruble payments inside the Mini App (ЮKassa widget, SBP, T-Pay, SberPay) | ≈ 95-96 ₽ by card (≈ 3.8-4.6 % fees incl. VAT), ≈ 97-99 ₽ by SBP (≤ 0.7 % bank-direct; 1.8-3.0 % via aggregators) | Breaks Telegram §6.2 as written; the bot can be hidden on mobile | **No** |
| (b) Ruble-only website keyed to the Telegram id | As (a) | Outside "inside Telegram apps", but fails Apple 3.1.3(b) without a Stars price; no in-app link or mention | Weak |
| (c) Hybrid: Stars inside Telegram + a ruble website for Russian players | Stars side ≈ 50 ₽, ruble side ≈ 96-99 ₽ (≈ 1.9-2.0×) | Closest to the 3.1.3(b) pattern; principle 2 kept inside Telegram; any link, button or price comparison inside the Mini App is "steering" | **The rule-compatible option** — after a lawyer reviews steering (P27) |
| (d) Codes / vouchers sold elsewhere (Boosty, VK Donut), redeemed in the bot | Venue fee + code system | Apple names license keys and QR codes as forbidden unlocks | **No** |

**Constraints of any ruble route:** a Russian-resident merchant (ИП, ООО, or самозанятый with ≤ 2.4 M ₽ a year and no
staff — P29, Q21); 54-FZ receipts; 22 % VAT, now also on card-acquiring fees (SBP transfers exempt, V7); acquirers'
lists name erotic content (no ruble rail for the 18+ track, P30); selling to 14-17 directly makes us the counterparty
for Civil Code art. 26/175 voiding (P31); discovery of the website only through outside channels (VK, TikTok, the
landing page), never from inside the Mini App.

**Recommend:** keep Stars as the only payment inside Telegram (principle 2 as written); treat the hybrid website (c)
as an option for Russian players once a merchant exists (P29) and a lawyer has reviewed steering; if approved, the
product asks are in F33 and principle 2 gains a scope sentence (P28).

## 14. Short video via VPN: TikTok, YouTube Shorts, VK Clips (R6; 13, checked by V6)

**Shows (press citing measurers unless stated; CLAIMED):**
- TikTok: 65.9 M monthly, 27.3 M daily in Russia (Dec 2025, 12+); the leader by teen online time (25 % of 12-17 time;
  73 min/day 12-17, 48 min/day 18-24, period unstated). VK leads by teen daily reach (63 % vs 61 %, 2024, V6).
- YouTube: 65.9 M monthly, ~22 M daily (Jan 2026); daily reach 22.4 M in Jan-May 2026 after the 2026-02 block (the
  "it did not shrink" reading is an inference, V6).
- Mechanics: TikTok restricted Russia itself in 2022-03 (RKN never blocked it); from a Russian IP the app shows a
  pre-2022 archive; with a foreign IP the official app works normally (feed, uploads; practitioner tests 2026). TikTok's
  terms (2025-12-01) forbid bypassing its access restrictions — the account is at risk (P32). VPN use: 40 % of
  Russians, 61 % of 18-29 (Russian Field, Apr 2026, n = 1,600 — the one MEASURED figure); nobody measures what share of
  Russian TikTok viewers see new content (the main gap).
- Links: YouTube Shorts description and comment links are not clickable (YouTube help) — route through channel links;
  TikTok's bio link reportedly needs 1,000 followers or a business account (CLAIMED); `t.me` itself was on a registry
  hold for about a day on 2026-07-13/14 (V6) — an own-domain landing page is the fallback (F17).
- Prices: integrations TikTok ≈ 1.26-2.61 ₽ per view, Shorts ≈ 1.30 ₽, VK Clips ≈ 3 ₽ (agency studies, CLAIMED);
  self-serve TikTok / Google ads cannot target Russia.

**Recommend:** from pre-launch, one set of vertical chapter-1 clips and character cards (F31) cross-posted to TikTok,
Shorts and VK Clips, each platform and creator with its own campaign code (F1) and the landing page (F17); a brand
account run from outside Russia (P32); 2-3 test creator integrations at soft launch before scaling; adult creators
only; never the 18+ track; never a VPN mention (38-FZ p. 10.8 — the first FAS decision treated VPN links in a Telegram
channel as ads; R3 accepts the ad-law risk, but there is no upside in taking this one).

## 15. Sources

Key URLs behind the executive summary and the tables, read 2026-10-31 unless stated. **The full source lists are in
the area and verify reports.**

- **Telegram (primary):** https://telegram.org/tos/bot-developers (§4.5, §5.2, §5.2(f), §6.2.3-6.2.6, §8.2.1, §10);
  https://telegram.org/tos/stars and https://telegram.org/tos/third-party-payments (Stars ToS §2-§4, authorized
  resellers); https://telegram.org/tos (age); https://core.telegram.org/bots/webapps (featuring, Apps tab, attachment
  menu, `requestWriteAccess`, `shareToStory`); https://core.telegram.org/api/config (defaults);
  https://core.telegram.org/api/stars (30 % ad discount); https://core.telegram.org/api/bots/referrals;
  https://core.telegram.org/bots/api-changelog (10.3); https://core.telegram.org/bots/payments-stars;
  https://core.telegram.org/api/bots/guest-mode; https://ads.telegram.org/guidelines;
  https://ads.telegram.org/getting-started; https://core.telegram.org/bots/features (token, `/token`, ownership
  transfer); https://telegram.org/faq_premium;
  https://telegram.org/blog/checklists-suggested-posts; https://telegram.org/blog/affiliate-programs-ai-sticker-search;
  https://fragment.com/stars/buy.
- **Stores:** https://apps.apple.com/us/app/telegram-messenger/id686449807;
  https://apps.apple.com/ru/app/telegram-messenger/id686449807;
  https://support.google.com/googleplay/android-developer/answer/11950272 (RU billing pause);
  https://support.apple.com/en-us/105055 (Ask to Buy).
- **Law (consultant.ru, edition of 2026-08-04):** 38-FZ art. 5
  https://www.consultant.ru/document/cons_doc_LAW_58968/f67f81c57fdcdacc2643d19d59369f7e185e1156/ ; KoAP 14.3
  https://www.consultant.ru/document/cons_doc_LAW_34661/2d50fc1c4013ea9ab20b8b2666c1650b1dc4c982/ ; 436-FZ art. 5
  https://www.consultant.ru/document/cons_doc_LAW_108808/9083b03e61777d3fe172fb3ef707a10e10688262/ ; 38-FZ art. 6
  https://www.consultant.ru/document/cons_doc_LAW_58968/e6ec70594b2bbac7a47fe870454e14bf17783583/ ; Civil Code art. 26
  https://www.consultant.ru/document/cons_doc_LAW_5142/7b6abd47219e2aa6081ac21b41e9e83d80fb45df/ ; FAS letter
  АК/32908/25 https://www.consultant.ru/document/cons_doc_LAW_503349/
- **FAS / RKN positions (via outlets):**
  https://www.retail.ru/news/fas-oboznachila-sroki-v-kotorye-biznes-mozhet-razmeshchat-reklamu-v-telegram-25-marta-2026-275903/ ;
  https://pravo.ru/news/262958/ ; https://pravo.ru/story/262745/ ;
  https://to-pick.ru/articles/899-perehodnyi-period-po-reklame-v-telegram-plan-dlja-biznesa-do-31-dekabrja-2026-goda ;
  https://elama.ru/blog/zapret-reklamy-v-telegram/ ; https://www.interfax.ru/digital/1072012
- **Russian access and reach:** https://explorer.ooni.org/findings/96225549500 ;
  https://meduza.io/en/news/2026/04/10/telegram-blocking-rate-in-russia-reaches-95 ;
  https://checkroi.ru/blog/skolko-polzovateley-telegram-v-rossii/ (Mediascope compilation) ;
  https://ppc.world/articles/reklama-v-telegram-v-2026-godu-benchmarki-i-stoit-li-zapuskat-kampanii-seychas/ ;
  https://verstka.media/messendzher-max-vpervye-operedil-telegram-po-mesyachnoj-auditorii-v-rossii-mediascope ;
  https://meduza.io/en/news/2026/04/08/49-of-russians-still-read-telegram-channels-despite-blocking-levada-poll-finds ;
  https://developers.cloudflare.com/support/troubleshooting/general-troubleshooting/service-disruption/ ;
  https://www.iguides.ru/main/other/svobodnyy_internet_v_rf_pochti_polnostyu_vytesnen_belym_spiskom_saytov/ ;
  https://github.com/telegramdesktop/tdesktop/issues/28692
- **Ads and prices (CLAIMED unless stated):** https://elama.ru/blog/skolko-stoit-reklama-v-telegram/ ;
  https://ppc.world/news/telegram-ads-snova-izmenil-minimalnyy-cpm-pri-targetinge-na-kanaly-boty-i-poisk-uvelichil-v-5-raz/ ;
  https://workspace.ru/blog/telegram-reklama-v-sng-tri-scenariya-rosta-rynka/ ;
  https://ads.vk.ru/en/help/articles/moderation (DOCUMENTED, rev. 2026-03-11) ;
  https://buhexpert8.ru/npa/pismo-roskomnadzora-ot-20-02-2025-n-03-72707.html (RKN letter to the Ministry of Finance on tax
  accounting of ad spend; not a 38-FZ position, V4)
- **Audience and cases:** https://telemetr.me/content/official_romanceclub ; https://telemetr.me/content/klubromantiki2 ;
  https://appleinsider.ru/obzory-prilozhenij/klub-romantiki-na-iphone-kak-skachat-i-igrat-v-rossii.html ;
  https://www.revenuecat.com/blog/growth/short-drama-mobile-acquisition-monetization ;
  https://www.sec.gov/Archives/edgar/data/0001997859/000199785926000087/a260810_2026q2xsharehold.htm (WEBTOON Q2 2026)
- **Benchmarks and referral evidence:** https://gamedevreports.substack.com/p/gameanalytics-mobile-and-pc-game ;
  https://gamedevreports.substack.com/p/appsflyer-app-monetization-in-2026 ;
  https://gamegrowthadvisor.com/blog/2025-12-16-mobile-soft-launch-complete-guide/ ;
  https://source.washu.edu/2020/07/research-shows-how-businesses-can-win-more-customers-influence-your-friends/ ;
  https://www.fdsm.fudan.edu.cn/en/2026/0428/c1894a33770/page.htm ; https://www.saxifrage.xyz/post/k-factor-benchmarks
- **Platforms outside Telegram:** https://dev.max.ru/docs ; https://dev.vk.ru/ru/mini-apps-rules ;
  https://vndb.org/d2 ; https://itch.io/docs/creators/quality-guidelines ; https://itch.io/jam/otome-jam-2026 ;
  https://itch.io/jam/yuri-jam-2026 ; https://habr.com/en/docs/help/rules/
- **18+ track:** UK RF art. 242
  https://www.consultant.ru/document/cons_doc_LAW_10699/ad5d9196ef8584bf342b4c10c1eb39fed4ae8745/ ; art. 242.1
  https://www.consultant.ru/document/cons_doc_LAW_10699/23ac064057d5bca235050872f65b23a1a1db092a/ ;
  https://telegram.org/tos ; https://telegram.org/tos/stars ; https://core.telegram.org/api/age-verification ;
  https://core.telegram.org/constructor/restrictionReason ; https://developer.apple.com/app-store/review/guidelines/ ;
  https://support.google.com/googleplay/android-developer/answer/9878810 ; https://www.currenttime.tv/a/33223807.html
  (Tomsk verdict) ; https://esports.ru/igrovaya-industriya/news/klub-romantiki-vernulsya-v-rossiyu-posle-czezury-kontenta/
- **Ad monetization, payments, short video (§12-§14):** https://core.telegram.org/api/revenue ;
  https://telegram.org/tos/bot-developers (§5.2, §6.1-§6.2.5, §7.4) ; https://core.telegram.org/bots/payments-stars
  (incl. its FAQ) ; https://core.telegram.org/bots/payments ; https://developer.apple.com/app-store/review/guidelines/
  (3.1.1, 3.1.3, 4.7) ; https://www.cbr.ru/PSystem/sfp/ (SBP fee cap, updated 2026-02-06) ;
  https://support.google.com/youtube/answer/13748639 (Shorts links).
  Full lists: 11, 12, 13, V6, V7.
- **EU (law-firm summaries):**
  https://www.reedsmith.com/de/perspectives/2025/03/qas-on-the-eu-consumer-protection-authorities-joint-guidance-paper ;
  https://www.gleisslutz.com/en/know-how/new-guidelines-game-currencies-digital-consumer-protection-and-expanding-taboo-dark-patterns
