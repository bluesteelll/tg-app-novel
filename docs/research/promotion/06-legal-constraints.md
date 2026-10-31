# Promotion research 06: legal and platform-policy constraints on promotion

Date 2026-10-31. Sources read: 55 opened (plus search-result pointers, marked as such). Freshness notes: 38-FZ "О
рекламе" and KoAP RF read on consultant.ru in the edition "ред. от 04.08.2026" (last amending laws 272-FZ of
2026-07-26 and 283-FZ of 2026-08-04; the site also shows a prepared edition with amendments not yet in force); 149-FZ
"последняя редакция" (last amendment 210-FZ of 2026-06-26); 436-FZ "последняя редакция" (last amendment 569-FZ of
2025-12-29); Bot API 10.3 (changelog, 2026-08-24); Telegram ToS / Bot Developer Terms / Stars ToS / Mini Apps ToS /
Ad Platform guidelines carry no revision date (read 2026-10-31). fas.gov.ru and rkn.gov.ru refused connections from
this machine (ECONNREFUSED), so FAS acts are cited through garant.ru (encoding broken), consultant.ru and dated news.
**The shared web-search budget ran out mid-task**: the later sub-questions were closed by fetching known primary URLs
only; the affected items are listed under Gaps.

**Everything legal below is INTERPRETATION, not legal advice**, unless it is a quoted or paraphrased law text
(DOCUMENTED). A Russian lawyer must confirm the Russian items, an EU lawyer the EU items, before money is spent.

Reused, not redone: research_M3 (152-FZ, GDPR, minors, Telegram privacy terms), research_M4 §2 and §4 (Stars ToS,
Apple/Google import, Affiliate Program, CPC principles, CRD 16(m)), research_M2 (Bot Developer Terms §5.2) [59].

## TL;DR (decision-relevant)

- **Paid promotion inside Telegram aimed at Russia is, per the FAS, unlawful since 2025-09-01 and only un-fined until
  2026-12-31.** 38-FZ art. 5 p. 10.7 (72-FZ, in force 2025-09-01) bans advertising "on information resources whose
  access is restricted under Russian law" [1][14]. FAS (2026-03-10) named Telegram, WhatsApp, YouTube, Instagram,
  Facebook and VPN services as showing signs of that violation; both the advertiser and the distributor are liable
  [19][21][8]. FAS (2026-03-25) announced a transition: no liability for ads in Telegram and YouTube "until the end of
  2026"; Instagram/Facebook/VPN are excluded [18][20]. **No FAS statement on 2027 was found** (latest checked: articles
  of 2026-08-27 and 2026-09-28) [24][25]. INTERPRETATION: any RU-targeted channel post, Telegram Ads campaign,
  blogger integration or affiliate post in Telegram placed for 2027 carries fine risk for us as the advertiser.
- **Telegram's status in Russia (2026-10), separated by evidence type.** Official: RKN confirmed a nationwide slowdown
  on 2026-02-10 [29]; calls restricted since 2025-08 [29][30]; a court fine of 35 M RUB (2026-03-16, Reuters via
  Wikipedia) [30]. Measured: OONI, blocking on many ISPs from 2026-03-20, ongoing as of its 2026-03-30 write-up [27];
  95 % anomalies on 2026-04-10 (Meduza/OONI, pointer) [28]. News/CLAIMED: "near-complete" block, reach via VPN;
  Durov: 65 M Russians use Telegram via VPN (2026-04-04) [29]; channel audiences reportedly halved after a late-April
  round (Agentstvo via Meduza, 2026-06-11) [26]. **No official blocking act, register entry or extremist designation
  of Telegram was found**; a 2026-09-28 practitioner article says Telegram is not in the RKN blocked-resource register
  [25]. The state pushes MAX (Peskov, 2026-03) [29].
- **Even where ads are allowed, RU internet ads need the full marking chain**: the label "Реклама", the advertiser's
  name or site, an ERID token issued by an ad-data operator (ORD), and data reported to RKN's ERIR (38-FZ art. 18.1
  pp. 3, 5, 16, 17) [6]. Fines (KoAP 14.3, ред. 04.08.2026): no token 30-100k RUB citizens / 100-200k officials /
  200-500k legal entities (p. 16); missing/late ERIR data 10-30k / 30-100k / 200-500k (p. 15) [9]. DOCUMENTED.
- **Own bot/channel posts about our own stories are generally "information", not advertising** (FAS letter
  АК/32908/25 of 2025-04-09), unless a post singles out one product among similar ones [11]. RKN has taken a stricter
  line on "self-advertising" (2023, secondary) [13]. INTERPRETATION: informational posts in our own channel need no
  ERID; a pushy "buy chapter 2 now" banner is the grey zone.
- **Minors.** A game is an "information product" (436-FZ art. 2 p. 5: computer programs) [32]; the producer
  self-classifies (0+/6+/12+/16+/18+) before release [34]; in-product marking is exempt for internet distribution
  (art. 11 p. 4) [37], but **every ad must state the category** (38-FZ art. 5 p. 10.1) [1]. Romance fits 12+ only as
  "episodic, non-naturalistic" depictions of relations between a man and a woman without sexual acts; 16+ allows
  depiction without "exploiting interest in sex" [35][36]. **Same-sex romance is banned for all ages in Russia**
  ("propaganda of non-traditional sexual relations", 478-FZ, 2022-12-05; in 436-FZ art. 5 p. 2, plus 149-FZ/38-FZ
  bans not re-read here) [33]. Ads must not exploit minors (38-FZ art. 6) [4].
- **Telegram platform rules**: no Telegram text bars a "5 hints for a friend" reward; the hooks are §5.2(b) spam and
  §5.2(d)(ii) "Social growth manipulation" (undefined) [40]. Telegram Ads forbid "sexually suggestive content" and
  "dating services" (§5.1) and clickbait (§5.4) [43] — a constraint on romance creatives. Earned Stars can buy
  Telegram Ads at **0.02 USD of ad credit per Star** (Bot Developer Terms §6.2.3, DOCUMENTED) [40]. Telegram's
  minimum age: 18 in the EU, UK and Australia; none stated elsewhere [39].
- **EU (if targeted)**: the CPC key principles (2025-03-21, soft law) ask for real-money prices next to virtual ones,
  no packs that force over-buying, a non-waivable withdrawal right for unused currency, and design that accounts for
  minors even when the audience is adult [49][50]. The Digital Fairness Act proposal was planned for Q3 2026; whether
  it was published by 2026-10 could not be checked (gap) [51]. GDPR art. 8 ages range 13-16 by member state [53][54].

## Findings

### 1. Russia: advertising law (38-FZ) and its enforcement

**1.1 What is advertising; own channel vs paid placement**
- Art. 3 p. 1: advertising is information "адресованная неопределенному кругу лиц и направленная на привлечение
  внимания к объекту рекламирования, формирование или поддержание интереса к нему и его продвижение на рынке"
  (addressed to an indefinite circle of persons and aimed at attracting attention to an object of advertising,
  forming or maintaining interest in it and promoting it on the market). The advertiser is the producer or seller or
  whoever defined the object/content (p. 5); the distributor is whoever distributes it "by any means" (p. 7) [3].
  DOCUMENTED (ред. 04.08.2026).
- Art. 2 p. 2 lists nine exclusions (political ads, legally required disclosures, reference/analytical material,
  state messages, signs, private announcements, info on the product/packaging, packaging design, organic mentions in
  works of art). **It has no exclusion for a seller's own website, page or channel** [2]. DOCUMENTED.
- FAS letter АК/32908/25 of 2025-04-09: a business's information about its own goods on its own resources (website,
  social-media groups, mobile app) is generally informational, not advertising; it becomes advertising when it
  singles out a specific product (e.g. a fixed or recurring banner); content that promotes third parties can be
  advertising; each case is assessed on its facts [11]. DOCUMENTED (FAS letter, via consultant.ru). Earlier FAS
  answers (2023) said the same for official sites and "pages of the producer or seller in social networks" [13];
  **RKN's 2023 answer: self-advertising on one's own resource is marked "in the general procedure"** [13] (secondary
  summary, 2023-06-27; CLAIMED).
- FAS 2022 (consultant.ru, 2022-10-27): ads spread "to a wide circle of users through Telegram channels" are subject
  to the law and to marking; ads in personal messages are not [12]. DOCUMENTED (FAS position via consultant.ru).
- INTERPRETATION: (a) posts in our own bot/channel that inform about stories, chapters and prices uniformly are not
  advertising; (b) a post or bot broadcast that pushes one chapter/pack with calls to buy may be treated as
  advertising — a practitioner article says own-channel calls to buy "считаются рекламой" [25] (CLAIMED); (c) bot
  messages to a user who started the bot are closer to "personal messages" than to a channel, but no FAS text on bot
  broadcasts was found (gap).

**1.2 Marking (ERID) and ORD/ERIR reporting** (art. 18.1, in force 2022-09-01 per secondary sources [60])
- p. 3: "Рекламодатели, рекламораспространители, операторы рекламных систем" (and persons under art. 10 p. 3.13)
  must provide data on internet ads aimed at consumers in Russia [6]; p. 5: through ad-data operators (ORD) authorised
  by RKN [6]; p. 11: the providers answer for completeness, accuracy, timeliness [6]; p. 13: RKN keeps the data ≥ 3
  years [6]. DOCUMENTED.
- p. 16: an internet ad must carry the label "реклама", the advertiser's name and/or a site/page with advertiser
  information; p. 17: distribution is allowed only once an ORD has assigned the ad an identifier (ERID) [6].
  DOCUMENTED.
- Liability split (art. 38): the **distributor** is liable for art. 18.1 p. 16 (label/advertiser info) [8].
  DOCUMENTED. Who files to the ORD is in practice fixed by the contract (CLAIMED; Government Decree No. 974 on the
  procedure was not opened — gap).
- "An ERID cannot be added retroactively" (eLama, 2026-06-02, CLAIMED) [23].

**1.3 Fines (KoAP RF art. 14.3, ред. 04.08.2026)** [9] DOCUMENTED. Columns: citizens / officials / legal entities
(RUB). The page shows no separate column for individual entrepreneurs (IP); under KoAP art. 2.4 IP are generally
fined as officials (not re-read; INTERPRETATION).

| Part | Violation | Citizens | Officials | Legal entities |
|---|---|---|---|---|
| 1 | Any breach of advertising law not covered by parts 2-17 | 2,000-2,500 | 4,000-20,000 | 100,000-500,000 |
| 9 | Ads on the resource of a foreign entity whose ad ban is listed under 236-FZ | 20,000-80,000 | 80,000-300,000 | 500,000-3,000,000 |
| 15 | ERIR data not provided / incomplete / late | 10,000-30,000 | 30,000-100,000 | 200,000-500,000 |
| 16 | Internet ad without ERID or with placement errors | 30,000-100,000 | 100,000-200,000 | 200,000-500,000 |
| 18 | Ads of means of access to restricted resources (VPN), part added by 281-FZ of 2025-07-31 | 50,000-80,000 | 80,000-150,000 | 200,000-500,000 |

- **Which part applies to ads placed on Telegram is unclear.** Part 9 names 236-FZ-listed foreign entities and does
  not mention "restricted access"; part 1 is the general catch-all (a lawyer quoted by eLama cites part 1) [9][23].
  eLama lists 20-80k / 80-300k / 0.5-3 M as the "stricter" fines for restricted resources since 2025-09-01 [23] — these
  are the part-9 amounts; whether part 9 reaches Telegram depends on a 236-FZ listing that was not verified. Must
  verify.
- **KoAP 14.3.1 is about tobacco/nicotine sponsorship and advertising** [10] — not relevant to this product.
- Secondary fine tables disagree with each other (e.g. vitvet.com puts "no marking" under part 4.1, which in the
  current text concerns ads over telecom networks) [60]; only the consultant.ru text above is used.

**1.4 The 3 % internet-advertising levy (art. 18.2, added by 479-FZ of 2024-12-26)** [7] DOCUMENTED
- Payers: ad distributors and ad-system operators distributing internet ads aimed at consumers in Russia (p. 1), and
  intermediaries who distribute on an advertiser's behalf (p. 10). Rate 3 % (p. 4) of quarterly income from ad
  distribution (p. 3); intermediaries on their own income (p. 11). Exemptions for certain broadcasters/media (p. 12).
- **p. 5: a Russian advertiser that contracts a foreign party for such ads must calculate, withhold and pay the
  deduction itself** and inform the foreign party [7].
- Practitioner reading (eLama, 2026-08-27, CLAIMED) [24]: buying a post directly from a channel owner → the owner (as
  distributor) pays; the advertiser has "no extra obligations as a rule"; the levy is charged once, at the first
  services contract in the chain; VK Ads / Yandex Direct operators are payers.
- INTERPRETATION: a small advertiser buying channel posts or VK Ads does not pay the levy but bears it in price;
  buying **Telegram Ads directly from Telegram** (a foreign party) or spending earned Stars as ad credit (§6.2.3)
  would, read literally, put the 3 % withholding on us if the ads target Russia. How to withhold from a Gram/Stars
  payment is not addressed anywhere found (gap).

**1.5 Bloggers/influencers**
- An influencer post that promotes our game is advertising; the influencer is the distributor (marking, label,
  ERID; levy payer as "owner of a site, blog, channel" [24]); we are the advertiser. Employee/personal pages promoting
  the employer can be advertising, reposts included (FAS АК/32908/25) [11]. DOCUMENTED/INTERPRETATION.
- Stimulating events: an ad announcing a contest/giveaway tied to purchases must state its period and where to find
  the organiser, rules, number of prizes and how to claim them (38-FZ art. 9) [5]. DOCUMENTED. INTERPRETATION:
  relevant if the referral or a promo is advertised with prizes.

### 2. Russia: where ads may be placed

**2.1 Personal pages > 10,000 audience (303-FZ of 2024-08-08)** [16][17] DOCUMENTED
- 149-FZ art. 10.6 p. 1.1: the creator of a personal page with an audience over 10,000 users must provide
  identifying information to RKN; p. 1.2: RKN keeps the list (перечень) of such pages; p. 1.3: an unlisted page may
  not post fundraising offers; p. 9.1: users must not repost from unlisted pages [17].
- 38-FZ art. 5 p. 10.6: **advertising may not be distributed on unlisted personal pages** of that kind [1]; the
  distributor is liable (art. 38 p. 7 covers "10.5 - 10.8") [8].
- In force: 2024-11-01 for one art. 10.6 provision; **2025-01-01 for the 38-FZ ad ban** (303-FZ art. 5 p. 3) [16].
- Scope: art. 10.6 covers "social networks" with > 500,000 daily users in Russia [17]. Whether RKN treats Telegram
  as such a network was not verified on a primary source (gap); practitioners state that Telegram channels > 10k must
  register and unregistered ones cannot carry ads [60] (CLAIMED).
- INTERPRETATION: before buying a post, check the channel is on the RKN list (if > 10k) — and, separately, that it is
  not a foreign-agent resource (art. 5 p. 10.5, 42-FZ of 2024-03-11) [1].

**2.2 Extremist / undesirable / restricted resources (art. 5 p. 10.7)** [1][14] DOCUMENTED
- Bans ads on (1) resources of foreign or international organisations recognised as undesirable (272-FZ), (2)
  resources of organisations banned or liquidated by a court under 114-FZ (extremism) or 35-FZ (terrorism), (3)
  **"other information resources whose access is restricted"** under 149-FZ. In force **2025-09-01** (72-FZ art. 3)
  [14]. Advertiser and distributor both liable (art. 38 pp. 6-7) [8].
- FAS 2026-03-10: Instagram, Facebook, YouTube, VPN services, Telegram and WhatsApp show signs of a p. 10.7 violation
  because RKN restricted access to them [19][21]. FAS 2026-03-25: liability for ads in Telegram and YouTube "will not
  be applied" until the end of 2026, to give businesses time to adapt and move to other channels; not extended to
  platforms restricted earlier (Instagram, Facebook) or to VPN services; FAS examines ad content, contract and
  restriction dates, publication dates and payment documents [18][20]. A 2026-04-06 FAS letter confirming the
  transition is reported by eLama (CLAIMED; not opened) [23]. The garant.ru copy of the 2026-03-25 FAS text exists but
  its Cyrillic was corrupted when fetched [22].
- Practitioner advice (CLAIMED): do not sign placements running past 2026-12-31 until FAS announces an extension;
  ads published before 2025-09-01 should not be re-pinned or re-linked [23][25].
- INTERPRETATION: the transition is an enforcement choice by FAS, not a change of law; the p. 10.7 ban itself stays.

**2.3 VPN advertising (art. 5 p. 10.8, 332-FZ of 2025-07-31)** [1][15] DOCUMENTED
- Bans ads of "программно-аппаратных средств доступа" to restricted resources; in force 2025-09-01 [15]; fine KoAP
  14.3 p. 18 [9].
- INTERPRETATION: a promo telling Russian users "use a VPN to open the bot" risks being read as VPN advertising;
  co-promotions with VPN-sponsored channels put our creative next to banned content. No FAS text on this case (gap).

**2.4 Telegram's status in Russia (as of 2026-10-31)**

| Date | Event | Evidence type | Source |
|---|---|---|---|
| 2025-08 | Voice/video calls in Telegram and WhatsApp restricted ("anti-fraud") | News (CNews 2025-08-13, Meduza) | [29][30] |
| 2026-02-10 | RKN confirms nationwide slowdown, "will continue to introduce restrictions" until Russian law is complied with | Official statement (via Interfax/RBC/Gazeta.ru, Amnesty) | [29] |
| 2026-03-10 / 03-25 | FAS: ads in Telegram show signs of p. 10.7 violation; no liability until 2026-12-31 | Regulator statement (via news) | [18][19][20] |
| 2026-03-16 | Court fines Telegram 35 M RUB for not removing prohibited content | Court decision (Reuters via Wikipedia) | [30] |
| 2026-03-20 → | Blocking on many ISPs (Rostelecom, Beeline, MTS, Central Telegraph); 547 ASes measured | MEASURED (OONI, write-up 2026-03-30) | [27] |
| 2026-03 | Peskov urges citizens to adopt MAX | Statement (m24 via Wikipedia) | [29] |
| 2026-04-04 | Durov: 65 M Russians use Telegram via VPN | CLAIMED (Kommersant via Wikipedia) | [29] |
| 2026-04-10 | 95 % "anomalies" (OONI data via Meduza/Agentstvo) | MEASURED, secondary (pointer, not opened) | [28] |
| 2026-04/05 | New throttling round; channels reportedly lost ~half their audiences; entertainment channels up to -35 % views; ad CPM in one channel fell to 400-500 RUB from ~1,000 | CLAIMED (Agentstvo, admins via Meduza 2026-06-11) | [26] |
| 2026-07-29 | Durov charged in absentia, put on an international wanted list | Procedural act (Lenta.ru via Wikipedia) | [29] |
| 2026-09-28 | "Not in the RKN register of blocked resources", throttled not banned | CLAIMED (practitioner article) | [25] |

- No official act blocking Telegram, no register entry and no extremist designation was found; the RU Wikipedia
  article (last checked 2026-10-12) records none [29]. No requirement to route Telegram ads through a Russian entity
  and no MAX-specific ad rule was found (gap).
- INTERPRETATION for the product (not law): a Russia-first TMA now depends on players who reach Telegram through VPN
  or the remaining unblocked paths; it also cannot legally buy Telegram-internal promotion for Russia after
  2026-12-31 unless FAS extends the transition. This is a market-access fact, not only a promotion one.

### 3. Minors and age rating

**3.1 436-FZ applicability** DOCUMENTED (last amendment 569-FZ of 2025-12-29; that amendment's content was not read)
- "Информационная продукция" includes "программы для ЭВМ" and information distributed via the Internet (art. 2
  p. 5) [32]. The word "games" does not appear; INTERPRETATION: a game is a computer program → an information product.
- Art. 1 p. 2: the law does not apply to advertising itself (item 6) [31]; ads are governed by 38-FZ.
- Art. 6: producers and distributors classify their own product **before** circulation, by theme, genre, content and
  artistic design, into 0+/6+/12+/16+/18+ (18+ = content of art. 5 p. 2); experts optional; results recorded in the
  accompanying documents [34].
- Art. 11 p. 4: age marking is not required for information distributed via telecom networks including the
  Internet, **except** online media (сетевые издания) and audiovisual services [37]. Art. 12 p. 4: the sign appears in
  catalogs/lists and in products posted on networks [38]. INTERPRETATION: the two read together leave in-app marking
  of a TMA game arguably optional; classifying it and stating the sign in the bot description is the low-risk
  reading. Lawyer item.
- **38-FZ art. 5 p. 10.1: no advertising of an information product subject to classification "без указания
  категории"** (without stating its category) [1]; the distributor is liable (art. 38 p. 7 range "9 - 10.3") [8].
  DOCUMENTED. → every ad creative for the game carries "12+"/"16+"/"18+".
- Art. 5 p. 10.2: no ads containing information prohibited for children in places/channels accessible to them [1].

**3.2 What romance content fits which category** DOCUMENTED (436-FZ)
- **12+** (art. 9 item 3): "эпизодические ненатуралистические изображение или описание половых отношений между
  мужчиной и женщиной", not exploiting interest in sex, not arousing or offensive, "за исключением изображения или
  описания действий сексуального характера" [35]. Kissing/love are not mentioned; INTERPRETATION: courtship, love
  confessions and a non-explicit kiss fit 12+; an implied intimate scene is borderline.
- **16+** (art. 10 item 5): depiction/description of sexual relations between a man and a woman not exploiting
  interest in sex and not offensive, sexual acts excluded; individual swear words (not obscene) allowed (item 4) [36].
- **18+ / banned for children** (art. 5 p. 2): pornography, obscene language, sexual violence, denial of family
  values, **"non-traditional sexual relations and/or preferences" (478-FZ of 2022-12-05)**, gender change (478-FZ),
  "childfree" promotion (411-FZ of 2024-11-23) [33]. INTERPRETATION: under the wider 2022 ban (not re-read here),
  same-sex romance cannot be offered to Russian users at any age category; this constrains story choices for the RU
  market.
- Art. 5 p. 3 restricts by age (not bans): violence, frightening content (the Resident Evil / Silent Hill puzzle
  wish), sexual relations between a man and a woman, non-obscene swearing [33].

**3.3 Ads and minors (38-FZ art. 6)** [4] DOCUMENTED. Ads must not: discredit parents/educators; push minors to
persuade parents to buy; suggest the product is affordable to any family; suggest owning it gives an advantage over
peers or that lacking it makes one inferior; show minors in danger; understate the skills needed; make minors feel
inferior about their appearance. The advertiser is liable (art. 38 p. 6) [8]. INTERPRETATION: "all your friends are
already playing", "only losers stay on chapter 1" or appearance-based hooks fail art. 6 if the audience includes
minors.

**3.4 Russian video-game law / age-rating initiative 2025-2026**: not verified — the search budget ran out before
the Duma bill could be located (gap).

**3.5 Personal data of minors and the referral program** (from research_M3, not re-verified [59])
- 152-FZ sets no age for consent; practice splits between the Civil Code (under 14: parents; 14-18 with parental
  approval) and a ~2018 RKN remark that 14+ may consent alone (CLAIMED). Consent must be "оформлено отдельно" (art. 9
  p. 1, 156-FZ). INTERPRETATION: a referral program that links inviter and invitee and grants rewards processes
  personal data of both; with players under 14 the parental path is the lawyer item MV12 already names.

**3.6 Telegram's own age rules and ad targeting**
- Telegram ToS: "Users in EU countries, the United Kingdom and Australia must be at least 18 years old to sign up";
  no minimum age is stated elsewhere [39]. DOCUMENTED (undated page).
- Telegram Ad Platform guidelines contain no age or minors rules; Telegram Ads targets channels (by choice of
  channel) [43][44]. INTERPRETATION: there is no age targeting to exclude minors, so RU ads must be child-safe in
  content (art. 6, p. 10.2) wherever they run.
- VK Ads rules on minors: ads.vk.com could not be fetched (gap).

### 4. Telegram platform policies

- **Bot Platform Developer Terms** [40] (undated; read 2026-10-31) DOCUMENTED:
  - §5.2(b) "Your TPA must not harass or spam users with unsolicited messages;"
  - §5.2(d) "must not misrepresent the services or functions it provides", examples "(i) MLM or ponzi schemes",
    "(ii) Social growth manipulation" — the term is not defined anywhere found.
  - §5.2(h) no "illegal, pirated, regulated or questionable goods and services".
  - No clause on incentivised invites, referrals, minors or age-restricted content.
  - §6.2: digital goods only for Stars, "Since Telegram must adhere to Apple and Google's definitions of digital
    goods and services" — developers should consult Apple/Google documentation directly.
  - §6.2.3: Stars earned by a TPA may advertise that same TPA on Telegram Ads if it follows the Ad Policies and
    accepts the Ad Platform Terms; "each Star in your balance is worth 0.02 USD in advertising credit".
- **Stars ToS** [41]: §4 Stars may not be sold, withdrawn or transferred beyond the listed uses; §3 all Star sales
  final at Telegram's level; §3.1 developer refunds via `/paysupport`. Nothing on referrals or incentives.
- **Mini Apps ToS** [42]: no age, content, Apple/Google, referral or advertising clause.
- **Bot API**: 10.1-10.3 (2026-06-11 → 2026-08-24) add nothing on ads, referral, age verification or Stars; 10.2
  restricts Mini App method calls to the app's original domain from 2026-07-20 [45]. Telegram blog posts of 2026
  show no ad- or referral-policy change [46].
- **Imported store rules** (Apple, current page; Google Play) DOCUMENTED:
  - Apple 3.2.2(x): apps "must not force users to rate the app, review the app, download other apps" to access
    content; "Apps may otherwise incentivize users to take specific actions within apps" [47].
  - Apple, section 3 intro: manipulating reviews or charts with "paid, incentivized, filtered, or fake feedback" can
    lead to expulsion [47]. Apple 3.1.1: IAP-eligible gifts allowed, refunded only to the purchaser, not exchangeable
    [47]. Apple 4.7.1: mini apps need content filtering, reporting and blocking of abusive users [47].
  - Apple 3.1.5(v) (task-for-currency, incl. "encouraging other users to download") applies to cryptocurrency apps
    only [47].
  - Google Play: "Don't offer rewards or incentives for ratings or reviews"; no rule on referral programmes [48].
- INTERPRETATION: a single-level "5 hints to the inviter, 2 to the invitee when the invitee finishes chapter 1" is an
  in-app incentive for an in-app action and is not barred by any text read; the risky variants are rewards for
  ratings/reviews (Google, Apple), rewards for spamming chats (§5.2(b)), multi-level payouts (§5.2(d)(i)) and
  rewards for bare sign-ups that inflate numbers (§5.2(d)(ii), undefined). Same as research_M2/M4 [59].
- **Telegram Ad Platform guidelines** [43] (undated) DOCUMENTED: §4.2 destination bots "must be beneficial to the
  user" and respond on mobile and desktop; §4.3 no mostly non-interactive redirect bots; link may carry start
  parameters (§3); §4.7 the ad, the target channel and the destination must share a language; §5.1 no "Nudity,
  sexually explicit and sexually suggestive content", including "dating services"; §5.4 no clickbait, false or
  exaggerated claims; §2 no gimmicky capitalisation or excessive emoji; §5.6 bans real-money gaming only. Telegram
  Ads are paid in "Gram" per the ads.telegram.org landing page [44].

### 5. EU, UK and US basics (only if the English audience includes them)

- **CPC Network key principles on in-game virtual currencies** (2025-03-21, non-binding; via law-firm summaries
  2025-03-27 and 2025-04-17, CLAIMED — the CPC document itself was not opened) [49][50]: (1) clear price indication,
  real-money price next to virtual; (2) avoid practices obscuring cost (mixing currencies); (3) avoid pushing players
  to buy more currency than needed (self-chosen amounts); (4) clear pre-contract information (trader identity,
  real price, withdrawal rights); (5) withdrawal rights: currency is not "digital content", the right cannot be waived
  but lapses once the currency is used within the period; (6) fair, plain terms; (7) design for vulnerabilities —
  consider whether an offer attracts minors "even if it is aimed at an adult audience". Basis: UCPD 2005/29/EC and CRD
  2011/83/EU. INTERPRETATION for Stars: Stars are Telegram's currency, our hints are a second layer (hints per Star) —
  principle 2 argues for showing what a hint pack costs in Stars and, where possible, real money.
- **CRD art. 16(m)** (digital content not on a tangible medium loses withdrawal once performance began with express
  consent and acknowledgment) — from research_M4, not re-read [59]. INTERPRETATION: a chapter unlock = digital
  content (waiver flow needed); a hint pack = currency (CPC reading: no waiver).
- **Digital Fairness Act**: the Commission ran a public consultation 2025-07-17 → 2025-10-24; a proposal was planned
  for Q3 2026; scope: dark patterns, personalisation, influencer marketing, contracts (Wikipedia, last edit
  2026-02-01) [51]. The 2026 work programme page (2025-10-21) did not show the annex [52]. Whether the proposal was
  published by 2026-10 is unverified (gap).
- **GDPR art. 8** [53]: 16 by default, member states may lower to no less than 13. Per euConsent (2021-10-26, may be
  stale) [54]: 13 — BE, DK, EE, FI, LV, MT, PT, SE; 14 — AT, BG, CY, IT, LT, ES; 15 — CZ, FR, GR; 16 — HR, DE, HU, IE,
  LU, NL, PL, RO, SK, SI. Telegram already requires 18+ in the EU [39].
- **DSA** (Commission Q&A, updated 2025-12-19) [55]: ads must be labelled with who placed them and why; no ads
  profiling minors; online platforms used by minors must ensure high privacy/safety; micro and small enterprises are
  exempt from some obligations (which ones not stated on the page). INTERPRETATION: a friends-only game with no public
  dissemination is unlikely to be an "online platform"; the DSA text (EUR-Lex) returned empty pages — gap.
- **Influencer disclosure**: UK ASA/CAP influencer guide, 4th edition updated 2026-10-23, developed with the CMA,
  covers payment/incentive/affiliate disclosure and post-DMCC fake-review rules [58] (the label rules are in the PDF,
  not opened). US FTC Endorsement Guides (revised 2023): disclose material connections (payment, free product,
  commissions, affiliate links, referral rewards) "clearly and conspicuously", e.g. "#ad" at the start; incentives
  must not be conditioned on positive reviews [56]. UCPD Annex I (hidden advertorials; direct exhortation to
  children) could not be fetched from EUR-Lex (gap).
- **COPPA** (US, under 13): applies to services directed to children under 13 or with actual knowledge; the rule text
  links to a Federal Register document of 2025-04-22; an FTC policy statement on age verification is dated 2026-02-25
  [57]. INTERPRETATION: a romance VN for teens is not "directed to children" under 13 by content, but under-13
  actual knowledge (e.g. a referral flow asking age) triggers it.

## Channel rows (for the synthesis table)

Only rows where law or platform policy changes cost or feasibility.

| Channel | Cost (with currency, date, label) | Effort | Fit for a Russian-first romance VN for girls in a TMA | Evidence quality | Notes |
|---|---|---|---|---|---|
| Paid posts in RU Telegram channels | CPM 400-500 RUB in one channel (2026-06, CLAIMED [26]); + legal overhead (ORD, ERID) | Medium: ORD account, token per creative, check RKN list (>10k) and foreign-agent status | Legally time-boxed: un-fined only until 2026-12-31 (FAS); advertiser liable after [18][20] | A (law, FAS via news) | ERID + "Реклама" + advertiser; 3 % paid by the channel owner [24]; category sign (12+/16+) in the creative [1] |
| Telegram Ads (official) aimed at RU | Stars as ad credit: 0.02 USD per Star (DOCUMENTED [40]); Gram otherwise [44] | Medium | Same p. 10.7 problem as above; RU marking via a reseller (CLAIMED [23]); possible 3 % self-withholding when paying a foreign party (art. 18.2 p. 5) [7] | A/B | Creatives: no "sexually suggestive" content or dating framing (§5.1) [43]; language must match channel and bot (§4.7) |
| Telegram Ads aimed at EN / non-RU | 0.02 USD/Star credit (DOCUMENTED [40]) | Low-medium | Not touched by 38-FZ (ads not aimed at RU consumers, art. 18.1 p. 3) — INTERPRETATION | A | Telegram ad policy only; EU: label + no minors profiling is Telegram's duty as platform |
| Bloggers/influencers in RU Telegram | ? (no rate card found) | Medium | Same p. 10.7 time box; influencer = distributor (ERID, label) | A | Art. 6 limits on hooks for minors [4] |
| RU influencers on VK / RuTube / Dzen; VK Ads | ? | Medium | Legal if marked (ERID) — but the ad leads users into Telegram, which many reach only via VPN | B | Do not mention VPN (p. 10.8, fine p. 18) [1][9]; VK Ads minors rules unverified (gap) |
| Instagram / Facebook for RU users | — | — | **Banned without transition** (p. 10.7; FAS 2026-03-25) [18][20] | A | Fines may reach part-9 level if applicable (must verify) |
| YouTube for RU users | ? | Medium | Same transition as Telegram (until 2026-12-31) [18] | A | |
| Own bot / own channel posts | 0 RUB | Low | Generally information, not ads (FAS АК/32908/25) [11] | A | Avoid singling-out "buy now" banners; RKN stricter (CLAIMED) [13] |
| In-app referral ("5 hints for a friend") | Hints (no cash) | Product feature | Not barred by Telegram/Apple/Google texts read [40][47][48] | A (absence of a rule) | Personal data of both users (152-FZ; minors) [59]; no rewards for reviews/ratings; no chat spam |
| Telegram Affiliate Program (MV11) | Revenue share set by us (research_M4 [59]) | Low (Telegram attributes) | Affiliates' posts in RU channels are ads for our product → same marking + p. 10.7 exposure for us as advertiser (INTERPRETATION) | B | Affiliates are outside our control: a compliance risk in RU, less so for EN |
| Contests/giveaways with prizes | Prize cost | Low | Ads announcing them must state period, rules location, prizes (art. 9) [5] | A | |
| EN influencers (UK/US/EU) | ? | Medium | Disclosure duty (#ad up front; affiliate/referral rewards are material connections) [56][58] | A/B | |

## Applicability to tg-app-novel (maps onto §2 of the context pack; asks listed, not designed)

- **Invite link / share (M10, M14)**: shares are user-to-user messages; under FAS 2022 personal-message ads are not
  marked [12], and a player's own share is not our advertising (INTERPRETATION). Asks: share text that is
  informational, carries the age sign (if it is ever used in paid placement it must, p. 10.1), no art. 6 hooks, no
  VPN mention; the 20/hour cap supports §5.2(b).
- **Referral (M23)**: no platform clause forbids it [40][47][48]. Asks: single level (already), no reward for
  ratings/reviews/channel subscriptions, no reward for bare launches (already: chapter-1 completion), the referral
  terms in `/terms` (art. 9-like clarity if prizes are ever advertised), a separate 152-FZ consent if the referral
  link is treated as data processing beyond the contract (lawyer, M3).
- **Gifts (M22)**: Apple 3.1.1 refund-to-purchaser rule [47]; not a promotion constraint.
- **Age gate (MV12)**: the content category (12+/16+/18+) must be decided before any ad runs because every ad carries
  it [1]; the category also fixes which romance scenes are possible [35][36]. Ask: a "category" field per story in
  `story/chapters.json` and the bot description showing the sign (INTERPRETATION of art. 12 p. 4).
- **Affiliate Program (MV11)**: in RU every affiliate post is an advertisement of our product; we cannot ensure
  ERID marking by strangers (INTERPRETATION). The legal risk favours "not used" for RU until the 2027 FAS position is
  known; for EN audiences the FTC/ASA disclosure duty sits with the affiliate and the brand [56][58].
- **Completion card / share image (later)**: no-title, no-paid-content rule already avoids most issues; an image
  with romance art must stay within the chosen category and Telegram §5.1 if reused as an ad creative [43].
- **Jurisdiction (Q21)**: 38-FZ binds ads aimed at RU consumers regardless of the operator's residence (art. 18.1
  p. 3, 18.2 p. 1) [6][7]; FAS enforcement against a non-resident operator is a lawyer question.

## Pitfalls / what goes wrong (sourced)

- Treating the FAS transition as legalisation: the ban (p. 10.7) is in force since 2025-09-01; only liability is
  deferred, until 2026-12-31 [14][18].
- Buying a long-running placement or pinned post that stays live into 2027 [23][25].
- Adding the ERID after publication — not possible [23]; posting without "Реклама" and advertiser info (KoAP 14.3
  p. 16, 30k-500k RUB) [9].
- Buying a post in an unlisted >10k channel (p. 10.6, since 2025-01-01) or a foreign-agent channel (p. 10.5) [1][16].
- Ads without the age sign (p. 10.1) [1]; romance creatives that are "sexually suggestive" (Telegram §5.1) or exploit
  interest in sex beyond the declared category [43][35].
- Hooks aimed at teens that shame or push them to ask parents to pay (38-FZ art. 6) [4].
- Any mention or partnership involving VPN in RU promotion (p. 10.8; KoAP p. 18) [1][9].
- Relying on secondary fine tables: they disagree with the KoAP text [9][60].
- Rewarding ratings/reviews (Google, Apple) [47][48]; reward schemes that pay per invite level (§5.2(d)(i)) [40].
- EU: hint packs sized to strand leftovers, or hint prices shown only in Stars without context [49][50].

## Key claims for verification

1. 38-FZ art. 5 p. 10.7 bans ads on resources "whose access is restricted"; in force 2025-09-01 (72-FZ art. 3) —
   https://www.consultant.ru/document/cons_doc_LAW_58968/f67f81c57fdcdacc2643d19d59369f7e185e1156/ and
   https://legalacts.ru/doc/federalnyi-zakon-ot-07042025-n-72-fz-o-vnesenii-izmenenii/ — DOCUMENTED.
2. FAS 2026-03-25: no liability for ads in Telegram/YouTube until end of 2026; Instagram/Facebook/VPN excluded —
   https://pravo.ru/news/262958/ , https://rb.ru/news/fas-dala-oficialnoe-razyasnenie-za-reklamu-v-telegram-i-youtube-ne-budut-shtrafovat-do-2027-goda/
   — DOCUMENTED via news (primary fas.gov.ru/news/34584 unreachable from here).
3. No FAS position on Telegram ads after 2026-12-31 as of 2026-09-28 —
   https://to-pick.ru/articles/899-perehodnyi-period-po-reklame-v-telegram-plan-dlja-biznesa-do-31-dekabrja-2026-goda —
   CLAIMED (absence; re-check fas.gov.ru for Oct-Dec 2026).
4. KoAP 14.3 p. 16 fines: 30-100k / 100-200k / 200-500k RUB —
   https://www.consultant.ru/document/cons_doc_LAW_34661/2d50fc1c4013ea9ab20b8b2666c1650b1dc4c982/ — DOCUMENTED.
5. Which KoAP part (1 or 9) applies to ads placed on Telegram; whether Telegram is a 236-FZ-listed entity — same URL
   + https://elama.ru/blog/zapret-reklamy-v-telegram/ — open question.
6. 38-FZ art. 5 p. 10.6 ad ban on unlisted >10k pages in force 2025-01-01 (303-FZ art. 5 p. 3) —
   https://legalacts.ru/doc/federalnyi-zakon-ot-08082024-n-303-fz-o-vnesenii-izmenenii/ — DOCUMENTED; Telegram's
   inclusion as a "social network" under 149-FZ art. 10.6 — not verified.
7. Art. 18.2 p. 5: a Russian advertiser contracting a foreign party withholds the 3 % itself —
   https://www.consultant.ru/document/cons_doc_LAW_58968/f5499f6a99f4f1011e473eae3412f6c7f0262387/ — DOCUMENTED.
8. FAS letter АК/32908/25 (2025-04-09): own-resource product info is not advertising unless singled out —
   https://www.consultant.ru/document/cons_doc_LAW_503349/ — DOCUMENTED.
9. 38-FZ art. 5 p. 10.1: ads of classified information products must state the category —
   consultant.ru art. 5 URL above — DOCUMENTED; 436-FZ art. 11 p. 4 Internet exemption from marking —
   https://www.consultant.ru/document/cons_doc_LAW_108808/b6ad93377c891ecf889a0b6262cb45ef1cd2479a/ — DOCUMENTED.
10. OONI: Telegram blocking on many Russian ISPs from 2026-03-20, ongoing —
    https://explorer.ooni.org/findings/96225549500 — MEASURED.
11. No official act blocking Telegram or extremist designation as of 2026-10 —
    https://ru.wikipedia.org/wiki/Блокировка_Telegram_в_России_(2026) — CLAIMED (absence).
12. Bot Developer Terms §6.2.3: 1 Star = 0.02 USD Telegram Ads credit — https://telegram.org/tos/bot-developers —
    DOCUMENTED.
13. Telegram Ad guidelines §5.1 ban "sexually suggestive content" and "dating services" —
    https://ads.telegram.org/guidelines — DOCUMENTED.
14. Telegram ToS: 18+ only in EU, UK, Australia — https://telegram.org/tos — DOCUMENTED.
15. CPC principles: withdrawal for virtual currency not waivable, lapses on use —
    https://www.reedsmith.com/de/perspectives/2025/03/qas-on-the-eu-consumer-protection-authorities-joint-guidance-paper
    — CLAIMED (CPC PDF not opened).

## Gaps (asked but no reliable source found)

- **Search budget exhausted mid-task**: no searches were possible for the items below; a follow-up pass can close
  them.
- Russian video-game law / age-rating bill 2025-2026 (number, reading, status).
- VK Ads rules on minors and age signs (ads.vk.com refused the fetch).
- Whether Telegram is in RKN's register of social networks for 149-FZ art. 10.6 (registration duty for Telegram
  channels) — only practitioner claims.
- The applicable KoAP part for p. 10.7 violations on Telegram (part 1 vs part 9) and Telegram's 236-FZ status.
- FAS position on bot broadcasts/mailings to users who started the bot (advertising or personal messages?).
- Any requirement to buy Telegram Ads in Russia through a Russian entity; MAX-related ad rules.
- Primary FAS texts (fas.gov.ru refused connections); the 2026-04-06 FAS letter (reported only).
- Digital Fairness Act status as of 2026-10; DSA text (EUR-Lex empty); UCPD Annex I points (EUR-Lex empty); the CPC
  PDF itself; ASA label rules (in the PDF).
- Government Decree No. 974 (ORD procedure; monthly statistics deadline) — not opened.
- 436-FZ amendment 569-FZ of 2025-12-29 — content not read.

## Owner value questions this area raises (each with a default reading)

1. **OWNER: is Russia still the first paid-promotion market given the FAS time box and the Telegram block?** Default
   reading: RU growth relies on own channels, shares and referral (not advertising) plus EN paid tests; no RU paid
   placement running past 2026-12-31 until FAS states its 2027 position.
2. **OWNER: the age category (12+ vs 16+ vs 18+) per story** — it fixes allowed romance scenes and must appear in
   every ad. Default reading: 16+ for the main romance line (allows non-explicit relations without exploiting
   interest in sex; matches MV12 14+ only loosely — a lawyer reconciles the two).
3. **OWNER: same-sex romance routes** — banned for the RU market at any age; default reading: none in RU builds;
   whether EN builds differ is a values call.
4. **OWNER: Telegram Affiliate Program (MV11)** — default reading: not used for RU (uncontrollable ad marking); an EN-only
   use is a business call.
5. **OWNER: who is the advertiser of record** (legal entity / IP / individual — Q21): it decides ORD contracts, fine
   tier, and whether 38-FZ enforcement can reach the operator. Default reading: settle Q21 before any RU paid ad.
6. **OWNER: is a lawyer engaged before the first paid placement?** Default reading: yes for RU (p. 10.7, ERID,
   age sign); EU review only if EU users are targeted.

## Sources

[1] https://www.consultant.ru/document/cons_doc_LAW_58968/f67f81c57fdcdacc2643d19d59369f7e185e1156/ — 38-FZ art. 5
(pp. 10.1, 10.2, 10.5-10.8), ред. 04.08.2026; read 2026-10-31; official-text aggregator.
[2] https://www.consultant.ru/document/cons_doc_LAW_58968/c530355c76ec66b91be9125e07b0b2bafd370a08/ — 38-FZ art. 2,
ред. 04.08.2026.
[3] https://www.consultant.ru/document/cons_doc_LAW_58968/4f41fe599ce341751e4e34dc50a4b676674c1416/ — 38-FZ art. 3,
ред. 04.08.2026.
[4] https://www.consultant.ru/document/cons_doc_LAW_58968/e6ec70594b2bbac7a47fe870454e14bf17783583/ — 38-FZ art. 6,
ред. 04.08.2026.
[5] https://www.consultant.ru/document/cons_doc_LAW_58968/7b11ca039c27a1a3999a4f93bed2bcdd9149f906/ — 38-FZ art. 9.
[6] https://www.consultant.ru/document/cons_doc_LAW_58968/2c4537e4796f6ff8b2736ed1b0d4fef08e14458e/ — 38-FZ art.
18.1, ред. 04.08.2026.
[7] https://www.consultant.ru/document/cons_doc_LAW_58968/f5499f6a99f4f1011e473eae3412f6c7f0262387/ — 38-FZ art.
18.2 (479-FZ), ред. 04.08.2026.
[8] https://www.consultant.ru/document/cons_doc_LAW_58968/4f8dcac024f3f2aec7ee1abb4fb4d8352cc84990/ — 38-FZ art. 38,
ред. 04.08.2026.
[9] https://www.consultant.ru/document/cons_doc_LAW_34661/2d50fc1c4013ea9ab20b8b2666c1650b1dc4c982/ — KoAP RF art.
14.3, ред. 04.08.2026.
[10] https://www.consultant.ru/document/cons_doc_LAW_34661/ — KoAP RF contents (art. 14.3.1 title), ред. 04.08.2026.
[11] https://www.consultant.ru/document/cons_doc_LAW_503349/ — FAS letter АК/32908/25 of 2025-04-09.
[12] https://www.consultant.ru/law/hotdocs/77670.html — FAS official position on Telegram ad marking, 2022-10-27.
[13] https://www.dextra.ru/about/news/otvety-fas-i-roskomnadzora-o-markirovke-samoreklamy/ — summary of FAS and RKN
answers on self-advertising, 2023-06-27; secondary.
[14] https://legalacts.ru/doc/federalnyi-zakon-ot-07042025-n-72-fz-o-vnesenii-izmenenii/ — 72-FZ of 2025-04-07 (p.
10.7; in force 2025-09-01); mirror of the official text.
[15] https://legalacts.ru/doc/federalnyi-zakon-ot-31072025-n-332-fz-o-vnesenii-izmenenii/ — 332-FZ of 2025-07-31 (p.
10.8; in force 2025-09-01).
[16] https://legalacts.ru/doc/federalnyi-zakon-ot-08082024-n-303-fz-o-vnesenii-izmenenii/ — 303-FZ of 2024-08-08
(personal pages; in-force dates).
[17] https://www.consultant.ru/document/cons_doc_LAW_61798/a3cba9a7c2ac9aa487df2d4172734dd5139376f5/ — 149-FZ art.
10.6 (last amendment 210-FZ of 2026-06-26).
[18] https://pravo.ru/news/262958/ — Pravo.ru, 2026-03-25: FAS transition period; legal news outlet.
[19] https://www.retail.ru/news/fas-razyasnila-pozitsiyu-vedomstva-v-chasti-kontrolya-reklamnogo-zakonodatelstva-10-marta-2026-275366/
— FAS position of 2026-03-10 as reproduced; trade news.
[20] https://rb.ru/news/fas-dala-oficialnoe-razyasnenie-za-reklamu-v-telegram-i-youtube-ne-budut-shtrafovat-do-2027-goda/
— RB.ru, 2026-03-25.
[21] https://kod.ru/fas-pro-reklamu-i-ban — Kod.ru, 2026-03-10.
[22] https://base.garant.ru/413952580/ — garant.ru copy of "Информация ФАС от 25.03.2026"; encoding corrupted on
fetch (title, date and the p. 10.7 link readable).
[23] https://elama.ru/blog/zapret-reklamy-v-telegram/ — eLama (ad reseller), 2026-06-02; practitioner, CLAIMED.
[24] https://elama.ru/blog/faq-po-sboru-3-za-dohod-ot-reklamy-otvechayut-eksperty-elama/ — eLama 3 % FAQ,
2026-08-27; CLAIMED.
[25] https://to-pick.ru/articles/899-perehodnyi-period-po-reklame-v-telegram-plan-dlja-biznesa-do-31-dekabrja-2026-goda
— agency article, 2026-09-28; CLAIMED.
[26] https://meduza.io/en/feature/2026/06/11/russia-has-been-blocking-telegram-for-months-meduza-asked-five-popular-channel-admins-if-it-s-working
— Meduza, 2026-06-11; news + admin statements, CLAIMED.
[27] https://explorer.ooni.org/findings/96225549500 — OONI finding "Russia blocked Telegram", 2026-03-30; network
measurement, MEASURED.
[28] https://meduza.io/en/news/2026/04/10/telegram-blocking-rate-in-russia-reaches-95 — Meduza, 2026-04-10; seen via
search results only (pointer, not opened).
[29] https://ru.wikipedia.org/wiki/Блокировка_Telegram_в_России_(2026) — RU Wikipedia, last checked 2026-10-12;
pointer to dated sources (CNews, Gazeta.ru, Amnesty, Reuters, Kommersant, Meduza, Lenta.ru).
[30] https://en.wikipedia.org/wiki/Blocking_of_Telegram_in_Russia — EN Wikipedia, last edit 2026-09-09; pointer.
[31] https://www.consultant.ru/document/cons_doc_LAW_108808/d44bdb356e6a691d0c72fef05ed16f68af0af9eb/ — 436-FZ art. 1
(last amendment 569-FZ of 2025-12-29).
[32] https://www.consultant.ru/document/cons_doc_LAW_108808/b819c620a8c698de35861ad4c9d9696ee0c3ee7a/ — 436-FZ art. 2.
[33] https://www.consultant.ru/document/cons_doc_LAW_108808/9083b03e61777d3fe172fb3ef707a10e10688262/ — 436-FZ art. 5.
[34] https://www.consultant.ru/document/cons_doc_LAW_108808/6fca9c26908d9ea57af1348f34c9630d15533d16/ — 436-FZ art. 6.
[35] https://www.consultant.ru/document/cons_doc_LAW_108808/360c3e68c68d0e9fc19c65a9b434ae18a8db56f1/ — 436-FZ art. 9.
[36] https://www.consultant.ru/document/cons_doc_LAW_108808/2025d6422eaf7de29d5df80a9eab6a678833b9c2/ — 436-FZ art. 10.
[37] https://www.consultant.ru/document/cons_doc_LAW_108808/b6ad93377c891ecf889a0b6262cb45ef1cd2479a/ — 436-FZ art. 11.
[38] https://www.consultant.ru/document/cons_doc_LAW_108808/553f0edac652ab327b379960f12fa3f0cbdd65d6/ — 436-FZ art. 12.
[39] https://telegram.org/tos — Telegram Terms of Service; undated; read 2026-10-31; official.
[40] https://telegram.org/tos/bot-developers — Bot Platform Developer Terms §5.2, §6.2, §6.2.3; undated; official.
[41] https://telegram.org/tos/stars — Stars Terms §3, §3.1, §4; undated; official.
[42] https://telegram.org/tos/mini-apps — Mini Apps Terms; undated; official.
[43] https://ads.telegram.org/guidelines — Telegram Ad Platform guidelines §2-§5.12; undated; official.
[44] https://ads.telegram.org/ — Telegram Ads landing (payment in "Gram", channel targeting); undated; official.
[45] https://core.telegram.org/bots/api-changelog — Bot API 10.1-10.3 (2026-06-11 → 2026-08-24); official.
[46] https://telegram.org/blog — Telegram blog index, 2026 posts; official.
[47] https://developer.apple.com/app-store/review/guidelines/ — App Review Guidelines 3 intro, 3.1.1, 3.1.5(v),
3.2.2(x), 4.7, 1.3; current page, date not visible.
[48] https://support.google.com/googleplay/android-developer/answer/9898684 — Google Play "User Ratings, Reviews, and
Installs" policy; current page.
[49] https://www.gleisslutz.com/en/know-how/new-guidelines-game-currencies-digital-consumer-protection-and-expanding-taboo-dark-patterns
— Gleiss Lutz, 2025-04-17; law-firm summary of CPC principles; CLAIMED.
[50] https://www.reedsmith.com/de/perspectives/2025/03/qas-on-the-eu-consumer-protection-authorities-joint-guidance-paper
— Reed Smith, 2025-03; law-firm summary; CLAIMED.
[51] https://en.wikipedia.org/wiki/Digital_Fairness_Act — DFA timeline, last edit 2026-02-01; pointer.
[52] https://commission.europa.eu/strategy-and-policy/strategy-documents/commission-work-programme/commission-work-programme-2026_en
— Commission work programme 2026 page, 2025-10-21 (annex not rendered).
[53] https://gdpr-info.eu/art-8-gdpr/ — GDPR art. 8 (mirror of Regulation (EU) 2016/679).
[54] https://www.euconsent.eu/digital-age-of-consent-under-the-gdpr/ — per-state ages, 2021-10-26; possibly stale.
[55] https://digital-strategy.ec.europa.eu/en/faqs/digital-services-act-questions-and-answers — Commission DSA Q&A,
updated 2025-12-19; official.
[56] https://www.ftc.gov/business-guidance/resources/ftcs-endorsement-guides-what-people-are-asking — FTC Endorsement
Guides FAQ (Guides revised 2023); official.
[57] https://www.ftc.gov/legal-library/browse/rules/childrens-online-privacy-protection-rule-coppa — FTC COPPA rule
page (rule text 2025-04-22; policy statement 2026-02-25); official.
[58] https://www.asa.org.uk/resource/influencers-guide.html — ASA/CAP influencers' guide, 4th ed., page dated
2026-10-23; official regulator.
[59] D:/tmp/novel-orch/design/choices/research_M3.md, research_M4.md (§2, §4), research_M2.md (§5.2) — internal prior
research of 2026-10-31.
[60] https://vitvet.com/articles/koap/otrasli/reklama-v-internete-narusheniya-shtraf-2026/ — law-firm marketing page
(fines; internally inconsistent with the KoAP text; registration claim); CLAIMED, used only as a contrast.
