# Promotion research 10: adult content, age gate and a dual audience (14-17 track + 18+ track)

Date 2026-10-31. Sources opened: 39 (list at the end), plus search-result snippets used only as pointers. They are
marked "snippet, not opened" and are CLAIMED.

**Freshness notes**
- **Bot API:** 10.3 (2026-08-24), read on `core.telegram.org/bots/api-changelog` and `/bots/api`. The `bots/webapps`
  page's "Recent changes" list ends at 10.1 (2026-06-11).
- **Telegram terms:** the ToS, Bot Developer Terms, Mini Apps ToS and Stars ToS pages show **no edition date**.
  They were read on 2026-10-31.
- **Apple:** App Store Review Guidelines read 2026-10-31. The page date was not visible in the part read.
  Telegram's US App Store listing was read on 2026-10-31 (v13.1.2).
- **Russian law editions:**
  - UK RF (Criminal Code), consultant.ru, ed. 04.08.2026.
  - 436-FZ: the consultant.ru table of contents lists amendments up to 569-FZ of 29.12.2025. The article text was
    read only in the 2023-04-28 edition (wikisource; see V7).
  - 152-FZ: ed. 26.07.2026.
  - KoAP 6.17: consultant.ru, edition not shown.

**Owner values this report works under (2026-10-31)**
- The audience is women aged 14-25.
- Erotic and "soft porn" content is possible behind an 18+ confirmation.
- The Russian ad-law risk under 38-FZ p. 10.7 is accepted and was not re-researched.
- Everything legal below is **INTERPRETATION, not legal advice**.

## TL;DR (decision-relevant)

- **Russia has no lawful channel for pornography.** This holds for adults, behind an age gate, and for paid access.
  - UK RF art. 242 part 1 punishes making, distributing, publicly showing or **advertising** pornographic materials.
    The article lists no exemption, licence or permitted purpose [19].
  - Using the internet is an aggravating element: part 3 "б", 2-6 years [19].
  - Distribution "among minors" is part 2: 2-5 years [19].
  - Whether an item is "pornography" or lawful "erotica" is decided case by case by an expert, with no statutory line
    [27][28][29].
  - Drawn anime erotica has been prosecuted: Tomsk, art. 242 part 3 "б", 1 year suspended, 2024-12 [27].
  - Paid closed Telegram channels with explicit content were prosecuted in 2025 [28].
  - **So "soft porn" is a label with no legal effect.** What a Russian expert would call "naturalistic" depiction
    falls under art. 242 whatever the age gate. Erotica that stays short of that ("non-naturalistic", 18+-marked) is
    the lane that Russian practice uses (Romance Club 18+ [34], Litnet's "Эротика" ("Erotica") genre behind
    registration (snippet)). INTERPRETATION.
- **Telegram's own rules do not ban legal adult content outright, but they import the store rules.**
  - The ToS bans "illegal pornographic content" on **publicly viewable** channels and bots [4]. In Russia, by the
    point above, pornography is illegal.
  - Bot Developer Terms §5.2(h) bar "illegal … regulated or questionable goods", and §9 requires compliance with
    Apple and Google store guidelines [1].
  - Stars ToS §5 lets Telegram **withhold or debit Stars** for violations of "local laws and applicable third-party
    store terms", with no refund [3].
  - Apple 1.1.4 bans "overtly sexual or pornographic material" [15].
  - Apple 4.7.5 requires a host app to let users identify mini apps that exceed **the host's age rating** and to
    restrict them by "verified or declared age" [15]. Telegram's US App Store rating is **13+** [16].
  - Google Play bans content "intended to be sexually gratifying" [18].
- **Telegram has an age-verification system, but a third-party bot cannot read it.**
  - It works through the Main Mini App of an official bot (@TelegramAge, face scan, live in the UK since 2025-07;
    "not yet available in Russia" as of 2025-07-28) [7][12][13].
  - It gates content whose `restriction_reason` is `sensitive` [7].
  - No Bot API or Mini App field (to 10.3) carries an age or a verification result. `WebAppUser` has no age field
    [10][11].
  - The only age-adjacent field is the optional, user-entered `birthdate` on a private chat's `ChatFullInfo`
    (added in Bot API 7.2, 2024-03-31) [9][10].
- **Russia has no age-verification duty or service for an 18+ game in 2026.**
  - Mintsifry (the digital ministry) said on 2026-06-08 that mandatory age checks on "sites and services" are "the
    nearest agenda". No law or date exists [31].
  - The MAX "Digital ID" law (Duma, 2025-12-18) covers alcohol, tobacco, lotteries and events, not online content
    [32].
  - Connecting to ESIA (the Gosuslugi state login) is open only to banks, insurers and similar entities (snippet,
    not opened).
  - In practice the options are self-declaration, a third-party age-estimation vendor (Didit lists $0.10 per check,
    CLAIMED, vendor [36]; Yoti prices by quote), or none.
- **Adult platforms moved to stricter checks in 2024-2025, and payment networks are the lever.**
  - Patreon requires ID verification of adult creators (card-network rules) and moved its iOS app to 17+ in 2024-11.
  - Steam added a payment-processor clause in 2025-07 and removed adult titles. Since 2025-08-29 it asks UK users for
    a credit card before mature pages.
  - itch.io deindexed all NSFW content on 2025-07-24; it re-indexed only free titles.
  - These are snippets, not opened; CLAIMED.
- **Promotion of the 18+ track has almost no compliant channel in Russia.**
  - Telegram Ads §5.1 bans "sexually suggestive" ads [14].
  - VK requires linked communities to have "no sexually explicit … images" [37].
  - Under art. 242, **advertising** pornography is itself a crime element [19]. This is separate from the waived
    38-FZ risk.
  - Adult ad networks (ExoClick, TrafficJunky, JuicyAds) have small deposits, $25-€500 (CLAIMED), but serve explicit
    traffic. Whether they accept a `t.me` landing is unknown.
- **The dual-audience precedent is "separate builds or apps".** Practice, not law:
  - Romance Club's Russian build is a separate App Store app, rated 18+, with same-sex routes removed (2026-05-19)
    [34].
  - Everlasting Summer, a Russian VN: an adult version on Nutaku (2015-08), separate from the all-ages release [38].
  - Steam "all-ages store version + off-store 18+ patch" (CLAIMED, forum).

## Findings

### 1. Telegram platform rules for adult content in a Stars-monetized Mini App

**1.1 Telegram Terms of Service** (no date on the page; read 2026-10-31) [4]
- Users agree not to "Post illegal pornographic content on publicly viewable Telegram channels, bots, etc."
  DOCUMENTED.
- Minimum age: "Users in EU countries, the United Kingdom and Australia must be at least 18 years old to sign up". No
  minimum is stated for other regions. DOCUMENTED.
- The wording targets *illegal* pornography on *public* surfaces. A bot's Mini App is reachable by anyone with the
  link. Reading (INTERPRETATION): legality is judged by local law, and in Russia distributing pornography is
  illegal (§3).
- The EU DSA user guidance (read 2026-10-31; "As of August 2026" appears in the text) says: "We never allow child
  sexual abuse materials (CSAM), bestiality, and non-consensual publication of sexual materials." Moderators "may
  block or delete users, bots, posts, channels and groups" [5]. DOCUMENTED.

**1.2 Bot Platform Developer Terms** (no date on the page) [1]. The page has **no clause** naming sexual, adult,
NSFW content or minors (DOCUMENTED, by a full-text read). Relevant clauses:
- §5.2(h): a third-party app (TPA) must not "provide, link to, aggregate, host, index, distribute" or trade
  "illegal, pirated, regulated or questionable goods and services".
- §5.2(a): TPA behaviour must comply with the Telegram ToS.
- §9: developers must operate "within all applicable laws, regulations and third-party Terms of Service", including
  "store guidelines from Apple and Google". Telegram is not liable when a developer fails to comply.
- §6.2: digital goods "must be executed exclusively through the exchange of Telegram Stars". Otherwise "we may have
  to make your TPA inaccessible from store versions of Telegram".
- Reading (INTERPRETATION): §9 imports Apple 1.1.4 and Google's sexual-content policy into the developer's duties.
  Sexual content sold for Stars is a "digital good" sold inside the store apps.

**1.3 Mini Apps ToS and Stars ToS**
- The Mini Apps ToS has no clause on adult content, minors or age. §6 lets Telegram restrict users' access to a Mini
  App [2]. DOCUMENTED.
- Stars ToS §5 "Abuse": Telegram "retains the right to temporarily withhold or permanently debit Stars". This
  includes violations of "local laws and applicable third-party store terms", and "Telegram will not issue any form
  of refund or compensation" [3]. DOCUMENTED.
- Stars ToS §2.3: Stars use "may be subject to additional restrictions in certain jurisdictions or for a subset of
  users" [3]. DOCUMENTED.
- The money risk for the 18+ track is therefore loss of earned Stars, not only a ban (INTERPRETATION).
- `core.telegram.org/bots/payments-stars` has no list of prohibited goods [6]. It states that Telegram "cannot
  display your bot or mini-app to mobile users" if it sells digital goods outside Stars, "to remain in compliance
  with … Apple's Review Guidelines" [6]. DOCUMENTED.

**1.4 Imported store rules** (read 2026-10-31)
- **Apple 1.1.4** bans "Overtly sexual or pornographic material, defined as 'explicit descriptions or displays of
  sexual organs or activities intended to stimulate erotic rather than aesthetic or emotional feelings'" [15].
  DOCUMENTED.
  - There is no "gated" exception for an app's own content. The only NSFW carve-out in 1.2 is for **user-generated**
    content from a web service, "hidden by default and only displayed when the user turns it on via your website"
    [15].
- **Apple 4.7** applies to "HTML5 and JavaScript mini apps": "You are responsible for all such software offered in
  your app, including ensuring that such software complies with these Guidelines" [15]. DOCUMENTED.
  - 4.7.1: the mini apps must include content filtering and reporting, and must follow 3.1 for digital goods.
  - **4.7.5**: "Your app must provide a way for users to identify software that exceeds the app's age rating, and
    use an age restriction mechanism based on verified or declared age to limit access by underage users."
  - Note that **4.7.5 accepts "declared" age** for the host's mechanism. Apple 1.2.1(a) uses the same wording for
    creator apps [15].
- **Telegram's App Store rating** (US listing, v13.1.2, read 2026-10-31) is **13+**, with "Infrequent" "Sexual
  Content or Nudity" and "Mature or Suggestive Themes" [16]. DOCUMENTED.
  - Apple introduced 13+/16+/18+ tiers on 2025-07-24, with a developer deadline of 2026-01-31 (snippet, not opened;
    CLAIMED).
  - Reading (INTERPRETATION): an 18+ erotic Mini App "exceeds the app's age rating". Under 4.7.5 Telegram must be able
    to restrict it on iOS. Under 1.1.4, overtly sexual material is barred from the iOS app altogether.
- **Google Play** (Inappropriate Content, answer 9878810; page "©2026", no version) [18]. DOCUMENTED:
  - "We don't allow apps that contain or promote sexual content or profanity, including pornography".
  - The ban covers content "intended to be sexually gratifying".
  - Nudity "may be allowed if the primary purpose is educational, documentary, scientific or artistic" and is not
    gratuitous.
  - The page opened says nothing about webview or third-party content.

**1.5 Telegram's restriction and "sensitive content" machinery** (client API docs, undated) [7][8]
- `restrictionReason` has fields `platform` (examples "ios, android, wp, all"; combinable as `android-ios`),
  `reason` (examples "porno", "terms") and `text` [8]. DOCUMENTED.
  - So Telegram can restrict a bot or channel **on iOS only**.
  - Third-party guides describe iOS users seeing "This channel can't be displayed" for 18+ channels, and toggling a
    "sensitive content" filter from a non-iOS client (snippets; conflicting; CLAIMED).
- The age-verification page [7], DOCUMENTED:
  - If the only surviving reason is `sensitive`, the content sits behind an **18+ spoiler**.
  - When `need_age_video_verification` is true in the user's jurisdiction, the content opens only after verification
    "using the age verification Mini App".
  - The bot doing the check is `verify_age_bot_username`, and the threshold is `verify_age_min`.
  - The Mini App emits `web_app_verify_age` with the detected age. The server flips the flag for the user's other
    devices.
  - The page does not say whether these rules apply to bot objects. A `user` object, bots included, has a
    `restriction_reason` field.
- News of 2025-07-28 [12][13], CLAIMED-press:
  - The official bot is "Verify Your Age" (@TelegramAge). It works by face scan; the photo "never leaves the device".
  - It is shown in settings in countries whose law requires it, the UK at launch. It was "not yet available in Russia".
- **Reading** (INTERPRETATION):
  - If Telegram marks our bot `sensitive`, users see an 18+ spoiler, and in some jurisdictions a face scan, before
    the **whole bot** opens.
  - If Telegram marks it `porno` with `platform: ios`, iOS users cannot open it.
  - Either flag applies per bot, so it would hit the 14-17 track too if both tracks share one bot.
  - No source states how Telegram decides to flag a bot. That is a gap.

**1.6 Bot API and Mini App fields carrying age** (Bot API 10.3, 2026-08-24) [9][10][11]
- The changelog has no entry for "age verification", "18+" or `has_sensitive_content` [9]. DOCUMENTED.
- Bot API 7.2 (2024-03-31): "Added the class Birthdate and the field birthdate" [9]. The current reference has
  `ChatFullInfo.birthdate`: "Optional. For private chats, the date of birth of the user" [10]. DOCUMENTED.
  - The value is user-entered profile data, not verified. Whether a user's birthday-privacy setting hides it from a
    bot was not confirmed (V3).
- `WebAppUser` fields: `id`, `is_bot`, `first_name`, `last_name`, `username`, `language_code`, `is_premium`,
  `added_to_attachment_menu`, `allows_write_to_pm`, `photo_url`. There is **no age or verification field** [11].
  DOCUMENTED.
- Bot API 8.2 (2025-01-01) added `verifyUser` / `verifyChat` [9]. These are third-party *organization* verification
  badges, not age (DOCUMENTED that they exist; the purpose is read from the changelog wording).

**1.7 Mini App Store and featuring**
- "Successful bots which enable a main Mini App and accept payments in Telegram Stars may be featured" [11].
  DOCUMENTED.
- No source states the eligibility of adult or sensitive bots. GAP. Reading: a `sensitive`-flagged bot sitting
  behind an 18+ spoiler is unlikely to be surfaced to a 13+-rated store audience (INTERPRETATION, not sourced).

### 2. Age-verification options for a TMA

| Option | What it proves | Cost (label, date) | Usable in a TMA? | Source |
|---|---|---|---|---|
| Self-declaration ("I am 18+" + birth year) | Nothing; a statement | 0 | Yes | Apple 4.7.5 accepts "declared" age for the host [15]. Ombudsman Moskalkova (2025-02) criticised "a tick box" as insufficient (snippet) |
| Telegram's own age check (@TelegramAge) | Face-estimated age, inside Telegram | 0 to us | **No**: no Bot API field exposes the result [7][9][11] | [7][12][13] |
| `ChatFullInfo.birthdate` | A user-entered date | 0 | Readable only via the Bot API `getChat` on the private chat; not verified | [9][10] |
| Telegram Passport | Documents, by user consent | — | Not researched this round: GAP | — |
| Third-party age estimation or ID check (Didit, Yoti) | Face-estimated age or ID document | Didit: age estimation $0.10 per check; ID + liveness bundle $0.33; $10 free credit per month from 2026-11-01 (CLAIMED, vendor page dated 2026-10-29). Yoti: quote-based, no public price | Unknown whether camera capture works in the Telegram WebView, on every platform. Third-party SDK = principle 6. Face images may be biometric data under 152-FZ: not checked, GAP | [36] |
| Gosuslugi / ESIA | Verified age | — | ESIA integration is open only to banks, insurers, microfinance firms, telecom operators and similar (snippet, not opened). Not for a game | snippet |
| MAX "Digital ID" | Verified age, for the listed goods and services | — | The law adopted 2025-12-18 covers alcohol, tobacco, nicotine, lotteries and entertainment events. Online content is not mentioned | [32] |
| Bank card check (Steam UK model) | Card ownership | Authorisation hold | Not in a Stars-only flow (principle 2) | snippet |

**Russian initiatives**
- **2021-06**: the Main Radio Frequency Centre (part of Roskomnadzor) suggested splitting pornography into legal and
  illegal, with ESIA age checks. This was a report, not a bill [30]. CLAIMED-press.
- **2025-02**: Ombudsman Moskalkova proposed regulating age verification online, including via Gosuslugi. The Duma
  IT committee called it "spornoy" ("contentious") (snippet, not opened).
- **2026-06-08**: Mintsifry head Shadaev said a mandatory check on "sites and services" "will definitely come up"
  [31]. No mechanism, law or date was given. He named Roblox's face or passport scan as a studied example [31].
  DOCUMENTED-press.
- **Status 2026-10-31**: no law obliges a game to verify age for 18+ content. The 436-FZ duties are labelling and
  access measures (§3.3). GAP: no bill text found.

**Practice of adult platforms** (all CLAIMED unless marked)
- **Patreon** (support pages, snippets):
  - Adult/18+ creators must be ID- and age-verified, and depicted people must consent. This follows Mastercard and
    Visa requirements.
  - The iOS app moved from 12+ to 17+ in 2024-11 because Apple in-app purchase required it.
- **Steam** (news snippets, 2025):
  - Since 2025-08-29, UK users verify age with a stored credit card before mature pages (Ofcom lists credit-card
    checks as "highly effective" age assurance).
  - In 2025-07 Valve added a clause on content that may violate "payment processors, card networks, banks". About
    22 or more adult titles were delisted, mostly incest-themed.
  - Valve's older rule (2018-06) allowed everything legal, but adult content must be "appropriately labeled and
    age-gated".
- **itch.io** (news snippets):
  - On 2025-07-24 it deindexed all NSFW content after payment-processor pressure.
  - New adult content standards came 2025-07-29.
  - Free NSFW content was re-indexed in early 2025-08; paid content was still under processor review.
  - Stripe "will not support content designed for sexual gratification".
  - No 2026 status was found.
- **Nutaku** (Aylo):
  - 45 M registered players, 128 M monthly visits, 60 % on mobile, 13 M female users ("male-dominated"), as of
    2020-01. Visual novels are its "least popular" genre [39]. CLAIMED, company figures.
  - 50 M registered users as of early 2020 [38].
  - Age-gate method: not found (GAP).
- **DLsite, F95zone, Boosty**: no primary rules page was read (GAP).
  - Boosty: one article claims it allows 18+ content with a creator label and viewer age confirmation (snippet).
  - F95zone: developers use it to advertise their Patreons (itch.io post, snippet).
- **Litnet** (RU web fiction): book cards in the "Эротика" ("Erotica") genre show "Ограничение 18+" ("18+
  restriction") and require a registered account with a confirmed e-mail (snippets of book pages). This is Russian
  practice for erotic text: an 18+ label plus an account gate, with no document check. CLAIMED, observed.

### 3. Russian law on the content itself (INTERPRETATION, not legal advice)

**3.1 UK RF art. 242** ("Незаконные изготовление и оборот порнографических материалов или предметов", "Illegal
production and circulation of pornographic materials or objects"), ed. 04.08.2026 [19]. DOCUMENTED:
- **Part 1**:
  - Acts: making or moving across the border "в целях распространения" ("for distribution"), and distributing,
    publicly showing or advertising.
  - Sanctions: a fine of 100-300 k RUB, forced labour up to 2 years, or prison up to 2 years.
- **Part 2**: distribution, showing or advertising "среди несовершеннолетних" ("among minors") by an adult.
  2-5 years.
- **Part 3**: aggravating elements, each 2-6 years:
  - (а) a group;
  - (б) "с использованием средств массовой информации либо информационно-телекоммуникационных сетей, в том числе
    сети "Интернет"" ("using mass media or telecommunication networks, including the Internet");
  - (в) large-scale income, defined in the note as more than 50,000 RUB.
- **The article lists no lawful channel, licence or exemption** [19].
- The Constitutional Court (ruling 1757-O, 2023-06-27) found art. 242 "не содержит неопределенности" ("contains no
  uncertainty"). Citing Plenum ruling No. 37 of 2022-12-15, it held that it "не имеет значения" ("does not matter")
  whether the materials were already freely available [21]. DOCUMENTED.
- A journalist's explainer (Т—Ж, 2026-07-27) [29], CLAIMED-press:
  - Producing pornography and earning legally in Russia "не получится" ("is not possible").
  - "четкой грани для отличия эротики от порнографии нет" ("there is no clear line between erotica and
    pornography").
  - Experts set and justify their own criteria; they may be sexologists, psychologists or art historians.
  - Adult sex scenes in films may be shown to adults when the plot or artistic purpose justifies them.
- **The only statutory definition** is 436-FZ art. 2 item 8: pornographic information is "натуралистических
  изображения или описания половых органов человека" ("naturalistic depictions or descriptions of human genitals"),
  plus sexual acts [23]. Commentary notes that the UK notes do not settle the definition for art. 242 [22].
  DOCUMENTED.

**Practice: drawn material and Telegram**
- **Tomsk, 2024**: a college animation student was convicted under art. 242 part 3 "б" (no 242.1) for erotic
  anime-style drawings posted in a VK group. Sentence: 1 year suspended. Article dated 2024-12-02 [27]. DOCUMENTED,
  press report of the verdict.
  - Per the verdict as reported, the prosecution argued that the images could provoke sexual arousal and "promote
    non-traditional sexual relations", and that they lacked "socio-cultural components" [27].
  - The case began with a classmate's notarised complaint [27].
- **2025, paid explicit Telegram channels**, under art. 242 [28], CLAIMED-press, 2025-06-06 (updated 2026-02-11):
  - Yekaterinburg: 2 channels, about 300 subscribers, about 10 k RUB earned; an expert found the material
    pornographic; 2-6 years possible.
  - Moscow, Voronezh, Irkutsk (2 years suspended), Novokuznetsk.
  - Several cases involved paid closed access.
- A lawyer's Q&A (snippet, not opened) reports divergent regional outcomes for drawn images: one conviction and one
  acquittal for "abstract" images.

**3.2 Art. 242.1** (materials with pornographic depictions of minors), ed. 04.08.2026 [20]. DOCUMENTED:
- Part 1: 2-8 years. Part 2 (including use of the internet): 3-10 years.
- Note 1 defines the materials as "содержащие любое изображение или описание в сексуальных целях" ("containing any
  depiction or description for sexual purposes") of, among others:
  - a minor's fully or partly naked genitals;
  - a minor's sexual acts;
  - "совершеннолетнего лица, изображающего несовершеннолетнего" ("an adult portraying a minor") performing or
    imitating intercourse.
- Note 2 exempts material of "историческую, художественную или культурную ценность" ("historical, artistic or
  cultural value") [20].
- The text does not mention drawn or computer-generated images [20].
- Practitioners' readings conflict (snippets, not opened): one lawyer says drawn characters are not covered by
  242.1 directly but risk art. 242; others say "любое изображение" ("any depiction") covers drawings.
- No 242.1 verdict on drawn VN or anime material was found. GAP.
- Reading (INTERPRETATION): "any depiction … for sexual purposes" of a character who reads as a minor, by age,
  setting or look, creates exposure under the gravest article. An audience that includes 14-17-year-olds and
  school-age characters would raise it.

**3.3 436-FZ: the 18+ category and online duties** (text read in the 2023-04-28 edition [23]; table of contents to
569-FZ of 29.12.2025 [24]; V7). DOCUMENTED for that edition:
- **Art. 5 part 2** lists information prohibited for children. Item 4 includes information "отрицающая семейные
  ценности, пропагандирующая нетрадиционные сексуальные отношения" ("denying family values, promoting
  non-traditional sexual relations"). Pornographic information is also in the prohibited list (art. 2 item 8 defines
  it).
- **Art. 5 part 3**: depiction of "половых отношений между мужчиной и женщиной" ("sexual relations between a man and
  a woman") is restricted by age, not banned.
- **Art. 10 item 5 (16+)**: depiction allowed only if "не эксплуатирующие интереса к сексу" ("not exploiting
  interest in sex"), with no sexual acts. 12+ wording: see PROMOTION.md §8.1.
- **Art. 6 part 3 item 5**: "информационная продукция, запрещённая для детей" ("information products prohibited for
  children") is the 18+ category. Art. 12 sets the "18+" sign.
- **Art. 14** (2023 text):
  - Part 1: organisers of internet access **in places accessible to children** must apply administrative,
    organisational, technical and software measures.
  - Part 2: sites not registered as mass media "may" place an age sign, self-assigned.
  - Part 3: audiovisual services must display it.
- **Art. 11 part 4 item 6** exempts information distributed via networks from the general sign duty, except network
  media and audiovisual services.
- Reading (INTERPRETATION): in the 2023 text a Mini App is not under an explicit "technical age gate" duty. The duty
  that bites is art. 242 part 2, not distributing to minors. Whether 2024-2025 amendments changed art. 14 is
  unverified (V7).
- **KoAP 6.17 part 1**: legal entities 20-50 k RUB, possible confiscation and suspension up to 90 days, for violating
  the law on protecting children from harmful information [25]. DOCUMENTED; edition not shown.
- **The LGBT rule** (already covered, PROMOTION.md §8.1): same-sex content is a risk at every age in Russia. Romance
  Club's RU build removed all same-sex routes [34].

**3.4 What the 14-17 track may contain.** Reuse PROMOTION.md §8.1 and §8.4:
- 12+: episodic, non-naturalistic, no sexual acts.
- 16+: depiction without exploiting interest in sex.
- No same-sex romance.

There is one new point: **any** 18+ chapter, preview, cover or share reaching a 14-17 user is the art. 242 part 2
scenario, if the material is pornographic, or a 436-FZ / KoAP 6.17 violation, if it is 18+ erotica (INTERPRETATION).

### 4. Promotion of an 18+ track

- **Telegram Ads** §5.1: "Ads must not promote graphic, shocking, or sexual content, products and services".
  Examples: "Nudity, sexually explicit and sexually suggestive content … dating services" [14]. DOCUMENTED; the page
  is undated.
  - The page does not say whether an ad may lead to a bot that contains adult content. GAP.
  - Reading: the promoted destination's own content falls under "promote … sexual content" (INTERPRETATION).
- **VK Ads** (official guide, 2023-04-04) [37]:
  - Communities linked from ads must "contain no sexually explicit or repulsive images".
  - "adult toys" are a restricted area.
  - 18+ targeting is mandatory only for pharmacies, medicine, lotteries and similar (not listed for games).
  - DOCUMENTED. The current `vk.com/adsrules` text could not be fetched (GAP).
- **Advertising law vs criminal law.** The owner waived the 38-FZ Telegram-ad risk. Art. 242 part 1 separately
  criminalises "рекламирование" ("advertising") of pornographic materials, with the internet as aggravation [19].
  This is not the waived risk (INTERPRETATION).
- **Adult ad networks** (affiliate reviews, snippets, CLAIMED):
  - ExoClick: minimum deposit €200 (electronic) or €500 (wire), or "$200"; popunder CPM floors 0.1-0.5 by tier
    (undated); 90 %+ adult traffic.
  - TrafficJunky (Aylo): $100 minimum ($25 via PayPal); CPM $0.30-8 by tier; no public rate card.
  - JuicyAds: $25-100 minimum.
  - No source on whether a `t.me` landing or Russian-targeted adult campaigns are accepted (GAP).
- **Adult VN communities and stores** (CLAIMED unless marked):
  - itch.io NSFW: free titles re-indexed in 2025-08; paid titles under processor review. Needs a non-Telegram build.
  - Nutaku: an Aylo store with its own payments. It runs its own builds, not a TMA. Developer terms: GAP.
  - F95zone: dev threads advertise Patreons. Rules: GAP.
  - Patreon: adult creators need ID verification.
  - Boosty: rules: GAP.
- **Russian-language 18+ Telegram channels as a market**: catalogue sections for adult and porn channels exist
  (telemetr.me, tgstat; snippets). No otome-18+ or adult-VN-for-women channel with a verifiable size was found (GAP).
  The 2025 prosecutions of paid explicit channels [28] are the evidenced risk.
- **Dual-audience brand separation (practice)**:
  - Romance Club RU: a separate App Store app (new ID; progress does not transfer), rated 18+, same-sex routes
    removed, returned 2026-05-19 after a 2024 Roskomnadzor block [34][33].
  - Romance Club monetises intimacy as **paid choices** in diamonds: a shower scene only with diamonds; 60 diamonds =
    499 ₽ (2023-09-29) [35]. CLAIMED, editors' test.
  - Everlasting Summer (Russian VN): an adult version on Nutaku in 2015-08 [38]. DOCUMENTED, secondary.
  - Steam: an "all-ages" store version, with adult content as a free off-store patch or DLC. Patch content must
    itself be allowed on Steam; adding NSFW content after launch reportedly needs a separately reviewed DLC
    (forum/news snippets, CLAIMED, date unclear).

### 5. Case numbers (weak; all CLAIMED)

- Nutaku: 45-50 M registered players, 128 M monthly visits, 13 M female users (2020-01) [38][39].
- Romance Club: revenue "tens of millions of dollars" from a registry entry (Т—Ж, 2023-09-29) [35]. RU fan channels up
  to ~80 K subscribers [35]. Its 18+ RU rating [34]. **No figure isolates the effect of spicy content.**
- Interactive-story category:
  - "Top 7 titles … over $14 million" IAP in one month (Apptopia via GamesBeat, month not shown; snippet).
  - Sensor Tower 2025 country top-5 posts (AI-written pages; snippets) show Romance Club, Blushed and Episode in small
    markets only.
- **No reliable revenue data for "spicy" lines** (Chapters, Passion, Steamy, Kiss, Lovestruck) was found. GAP.

## Channel rows (for the synthesis table)

| Channel | Cost (with currency, date, label) | Effort | Fit for a Russian-first romance VN for girls in a TMA | Evidence quality | Notes |
|---|---|---|---|---|---|
| Telegram Ads for the 18+ track | Per PROMOTION.md §4.2 | M | **None**: §5.1 bans sexually suggestive ads [14] | A | The minors-safe public face may still be advertised; the 18+ track may not be named |
| Seeding in RU adult / hentai Telegram channels | Unknown; no price found | L | Audience mismatch (male-skewed adult catalogues, hyp.). **Art. 242 "advertising" exposure if the promoted material is pornographic** [19] | C | Paid explicit channels prosecuted in 2025 [28] |
| Seeding in RU otome / romance fan channels (18+ angle) | PROMOTION.md §4.2 seeding row | L | High fit for the genre, but those channels' audience includes minors (RC fans), so an 18+ ad there is a 436-FZ / art. 242 part 2 risk | C | Only a minors-safe creative fits |
| VK Ads → landing → t.me (18+ track) | PROMOTION.md §4.4 | M | Low: linked communities must have no sexually explicit images [37] | B | An erotic creative is likely rejected (INTERPRETATION) |
| Adult ad networks (ExoClick, TrafficJunky, JuicyAds) | Deposit €200-500 / $100 / $25-100; CPM $0.1-8 (CLAIMED, undated to 2026) | M | Low: explicit, male-skewed inventory (Nutaku "male-dominated" [39]). `t.me` landing acceptance unknown | C | For RU targeting, art. 242 "advertising"; for EN, the networks' own rules |
| itch.io NSFW page (EN) | 0 | M | Low-medium for EN; needs a non-Telegram build; paid NSFW under processor review | C | Payment-processor volatility (2025-07) |
| Nutaku as a second store (EN) | Revenue share: GAP | XL | A separate build and store, not a TMA; its own payments conflict with principle 2's Stars-only rule for that build | C | Precedent: Everlasting Summer [38] |
| Patreon / Boosty 18+ tier (bonus art, EN/RU) | Platform fee: not researched | M | Medium for fan funding. Patreon needs creator ID verification. In RU, explicit material is art. 242 whatever the platform | C | Principle 0: paid art leaves our gate |
| F95zone dev thread (EN) | 0 | S | Low-medium for EN; leak / piracy culture (hyp.) | C | Rules unread |
| Steam all-ages build + 18+ patch (EN) | Steam fee: not researched | XL | Not a TMA; only if a desktop build exists | C | Post-launch NSFW restriction CLAIMED |
| Own 18+ Telegram channel (separate from the public channel) | 0 | M | Medium (hyp.). Telegram ToS bans illegal porn on public channels [4]; RU 2025 prosecutions targeted explicit channels [28] | B | Erotica-only and 18+-marked is the defensible content line (INTERPRETATION) |
| Litnet / Author.Today erotic-romance readers (RU) | Unknown | M | High topical fit for RU adult women (hyp.); 18+ genre exists behind an account | C | Promotion rules not read |

## Applicability to tg-app-novel

Mapping onto the planned features (00-CONTEXT §2):
- **Invite link and attribution (M10/M11)**: invites carry no age. A 14-year-old invited by an 18+ friend lands in the
  same bot.
- **Share (M14)**: "never paid content" must extend to "never 18+ content, cover or title".
- **Visibility (M12-M13)**: a friend's view of endings and achievements must not reveal 18+ titles to a minor friend.
- **Gifts and referral (M22/M23)**: rewards must not be redeemable on the 18+ track by an unconfirmed user.

**Product asks** (listed, not designed):
1. A **server-side age flag** per user (`age_confirmed_18`, method, timestamp, policy version), separate from
   purchases and entitlements. Never derived from `initDataUnsafe`, `birthdate` alone, or client storage
   (principle 1).
2. **18+ chapter JSON and 18+ art delivered only after both checks** (entitlement AND age flag), on the same path as
   paid content (principle 0). 18+ chapters never in the public bundle, even if free.
3. An **age category per story and per chapter** in the story index / `story/chapters.json` (0+/6+/12+/16+/18+), so
   the server and the story gate can enforce it. The 436-FZ 18+ sign is shown on every 18+ surface.
4. The **free chapter, every public asset** (bot profile, Mini App previews, store media, share cards, own-channel
   posts) and the default Home stay **minors-safe (≤ 16+)**. The 18+ track has separate covers, previews and share
   texts, or none.
5. A **minors-safe default**: a user without the flag never sees 18+ titles, teasers or locked-content hints. The
   18+ track is not advertised inside the 14-17 experience.
6. **Logging of age confirmations** under 152-FZ art. 5 parts 4, 5, 7 [26]: store only what the purpose needs (for
   example a boolean, a birth year or nothing more, method and time), with a retention rule. If a vendor face check
   is used, check whether its output is biometric personal data (GAP).
7. **Content rules for the 18+ track in the story gate** (lint): every sexual scene involves characters explicitly
   adult in text and art, with no school setting. Enforces the 242.1 risk reading.
8. **Separate the bot / brand or not**: Telegram's `restriction_reason` (`sensitive`, `porno`, platform `ios`)
   applies per bot or user object [7][8]. One shared bot means one flag would hit the 14-17 track. This is an
   architect / owner fork, listed only.
9. **A refund and kill path** for the 18+ track: Stars ToS §5 debit risk [3]. Stars earned from 18+ chapters may be
   withheld.

**Conflicts with project principles and defaults**

| Principle / default | Conflict | Source |
|---|---|---|
| 0 (paid never leaks) | Extends naturally: 18+ is a second gate on the same path. No conflict, more scope | — |
| 1 (server truth) | Age state must be a server record. No Telegram signal exists to read it from | [9][11] |
| 2 (Stars only) | Stars debit risk for content that breaks store or local rules. A second store (Nutaku/Steam) would mean other payments | [3] |
| 5 (WebView reality) | A face-scan vendor needs camera capture in every Telegram WebView: untested. No `window.open` means a vendor hand-off cannot use a popup | [36] |
| 6 (thin Telegram layer) | A third-party age-verification SDK is a dependency we cannot replace in a day | — |
| 8 (localization) | None | — |
| **MV12 (minimum user age 14+ RU)** | A 14+ user base plus an 18+ track in one product puts minors one self-declaration away from 18+ material (art. 242 part 2 if pornographic) | [19] |
| **Owner value "soft porn"** | No lawful RU channel for pornography; "soft" has no legal meaning; an expert decides | [19][27][28][29] |

## Pitfalls / what goes wrong (sourced)

- **Drawn content is prosecuted as pornography**: Tomsk 2024, art. 242 part 3 "б" [27]. The argument rested on
  arousal and "no socio-cultural components", not on realism.
- **Complaints start cases.** A classmate's notarised screenshots started the Tomsk case [27]; a subscriber's report
  started the Yekaterinburg one [28]. One teen who passes a self-declaration and complains is enough.
- **Paid closed access does not protect**: 2025 cases were about paid closed channels [28].
- **Payment networks move overnight**: itch.io deindexed all NSFW on 2025-07-24; Steam delisted titles in 2025-07
  (snippets).
- **Store-rule import**: Telegram may hide a bot on iOS (`platform: ios`) [8]. Telegram's iOS rating is 13+ [16];
  Apple 1.1.4 has no gated exception [15].
- **Stars forfeiture**: Telegram may "permanently debit" Stars for breaking local law or store terms, with no refund
  [3].
- **The flag is per bot**: a `sensitive` flag puts the whole bot behind an 18+ spoiler and, in some countries, a
  face scan [7]. That kills the 14-17 track's funnel if both tracks share the bot (INTERPRETATION).
- **Self-declaration is criticised as insufficient** (Moskalkova, 2025-02, snippet). Regulated contexts abroad do
  not accept it (vendor blog, snippet).
- **Mixed Q&A sources on 242.1 and drawn minors**: no settled practice. Treat as high risk.

## Key claims for verification

1. Art. 242: part 1 fine 100-300 k RUB or up to 2 years; part 2 (among minors) 2-5 years; part 3 "б" (internet) 2-6
   years; no exemption. Ed. 04.08.2026. https://www.consultant.ru/document/cons_doc_LAW_10699/ad5d9196ef8584bf342b4c10c1eb39fed4ae8745/
   DOCUMENTED.
2. Art. 242.1 note 1, "любое изображение или описание в сексуальных целях" ("any depiction or description for sexual
   purposes"), including an adult portraying a minor; part 2 (internet) 3-10 years. https://www.consultant.ru/document/cons_doc_LAW_10699/23ac064057d5bca235050872f65b23a1a1db092a/
   DOCUMENTED.
3. Tomsk: anime erotic drawings, art. 242 part 3 "б", 1 year suspended, published 2024-12-02.
   https://www.currenttime.tv/a/33223807.html CLAIMED-press.
4. Telegram ToS: "illegal pornographic content on publicly viewable … bots"; 18+ for EU/UK/AU. https://telegram.org/tos
   DOCUMENTED, undated.
5. Bot Developer Terms §5.2(h) and §9 (Apple/Google store guidelines). https://telegram.org/tos/bot-developers
   DOCUMENTED, undated.
6. Stars ToS §5: withhold or permanently debit Stars for "local laws and applicable third-party store terms", no
   refund. https://telegram.org/tos/stars DOCUMENTED.
7. Apple 1.1.4 wording, and 4.7.5 "verified or declared age" for mini apps exceeding the host rating.
   https://developer.apple.com/app-store/review/guidelines/ DOCUMENTED.
8. Telegram iOS rated 13+ (US listing, v13.1.2, 2026-10-31). https://apps.apple.com/us/app/telegram-messenger/id686449807
   DOCUMENTED; may differ by storefront.
9. Age verification: `need_age_video_verification`, `verify_age_bot_username`, `verify_age_min`,
   `web_app_verify_age`; applies to `sensitive` restriction reasons. https://core.telegram.org/api/age-verification
   DOCUMENTED.
10. @TelegramAge face scan, UK, "not yet available in Russia" (2025-07-28).
    https://ppc.world/news/v-telegram-poyavilsya-oficialnyy-bot-dlya-proverki-vozrasta/amp/ CLAIMED-press.
11. No age or verification field in `WebAppUser` / Bot API 10.3. `ChatFullInfo.birthdate` "For private chats, the date
    of birth of the user". https://core.telegram.org/bots/api and https://core.telegram.org/bots/webapps DOCUMENTED.
12. Telegram Ads §5.1 bans sexually suggestive content and dating services. https://ads.telegram.org/guidelines
    DOCUMENTED.
13. Mintsifry 2026-06-08: mandatory age checks "nearest agenda", no law.
    https://ru.themoscowtimes.com/2026/06/08/rossiyanam-gotovyat-pasportnii-kontrol-navhode-vinternet-a197564
    CLAIMED-press.
14. Romance Club RU: separate App Store app, 18+, same-sex routes removed (2026-05-19).
    https://appleinsider.ru/obzory-prilozhenij/klub-romantiki-na-iphone-kak-skachat-i-igrat-v-rossii.html CLAIMED-press.
15. Didit age estimation $0.10 per check (page updated 2026-10-29). https://didit.me/blog/didit-vs-yoti-kyc/
    CLAIMED-vendor.

## Must verify before relying on it

- **V1**: how Telegram decides to apply `sensitive` or `porno` / `ios` to a **bot**, and whether that blocks the Mini
  App or only the chat. No source found; test on a test bot only with minors-safe content, or ask Telegram support.
- **V2**: whether a third-party age-estimation flow (camera) works inside the Telegram WebView on iOS WKWebView,
  Android WebView, Desktop and Web.
- **V3**: whether `ChatFullInfo.birthdate` reaches a bot when the user's birthday privacy is restricted.
- **V4**: the 2026 status of itch.io paid NSFW, Steam's post-launch NSFW rule, and Patreon's 18+ rules. All are
  snippets only.
- **V5**: the current `vk.com/adsrules` sexual-content clause (could not be fetched).
- **V6**: Nutaku developer terms and age-gate method; DLsite and Boosty 18+ rules.
- **V7**: 436-FZ art. 14 and art. 5 in the current edition, after the 2022 LGBT amendments and to 569-FZ of
  2025-12-29. Only the 2023-04-28 text was read.
- **V8**: whether a face-estimation result or image is biometric personal data under 152-FZ art. 11, and the
  localisation consequences.
- **V9**: Apple age ratings, whether Telegram's rating differs in the RU storefront, and the 2025-07 13+/16+/18+
  change (snippet only).

## Gaps (asked but no reliable source found)

- Telegram rules on Mini App Store featuring for adult or sensitive bots.
- Any 242.1 verdict on drawn or VN characters. A full Russian court practice review of drawn erotica versus
  pornography (only the Tomsk case and lawyers' Q&A were found).
- Telegram Passport as an age signal (not researched).
- Revenue numbers for "spicy" romance lines (Chapters, Passion, Steamy, Kiss, Lovestruck), and for Romance Club's 18+
  effect.
- Sizes of RU otome-18+ Telegram channels.
- Whether adult ad networks accept `t.me` landings.
- EU and UK duties for an English 18+ track: the UK Online Safety Act "highly effective age assurance" for
  pornographic content, and the EU. Not researched beyond Steam's UK response.

## Owner value questions this area raises (each with a default reading)

- **O1 (OWNER): "soft porn" in the Russian line.** Russian law has no lawful channel for pornography (art. 242), and
  the erotica/pornography line is drawn by an expert.
  - Default reading: the RU line carries at most non-naturalistic 18+ erotica (the Romance Club / Litnet practice
    level), and a lawyer reviews sample scenes before production.
  - Any explicit material would exist only for non-RU audiences, after a separate legal review there.
- **O2 (OWNER): one product or two for the 14-25 audience.**
  - Default reading: the 14-17 experience must never show 18+ content, covers or teasers.
  - Whether the 18+ track lives in the same bot or in a separate bot/brand is an open fork, because Telegram flags
    apply per bot.
- **O3 (OWNER): the strength of the age confirmation.** There is no Telegram or Russian state signal available to a
  bot. Options:
  - a self-declaration (0 cost, weak);
  - a paid vendor check (about $0.10 each, CLAIMED; camera in WebView untested);
  - no 18+ track in RU.
  - Default reading: a self-declaration is the minimum, logged server-side. Its weakness is accepted only if the RU
    line stays non-pornographic (O1).
- **O4 (OWNER): accept iOS reach risk.** Telegram's iOS app is rated 13+, and Apple 1.1.4 bans overtly sexual
  material. Default reading: anything shown on iOS stays within what Apple allows for a 13+ host, or sits behind
  Telegram's own gate.
- **O5 (OWNER): Stars forfeiture risk.** Stars ToS §5 permits debiting earned Stars. Default reading: 18+ revenue is
  treated as at-risk until a payout cycle completes without action.
- **O6: MV12.** Keep 14+ RU as the user minimum. Default reading: 14+ applies to the minors-safe track. The 18+ track
  requires the server age flag, and the two are kept separate.

## Sources

[1] https://telegram.org/tos/bot-developers: Telegram Bot Platform Developer Terms. No edition date; read 2026-10-31. Primary contract.
[2] https://telegram.org/tos/mini-apps: Telegram Mini Apps ToS. No date; read 2026-10-31. Primary.
[3] https://telegram.org/tos/stars: Telegram Stars ToS. No date; read 2026-10-31. Primary.
[4] https://telegram.org/tos: Telegram Terms of Service. No date; read 2026-10-31. Primary.
[5] https://telegram.org/tos/eu-dsa: Telegram EU DSA user guidance. "As of August 2026"; read 2026-10-31. Primary.
[6] https://core.telegram.org/bots/payments-stars: Payments in Telegram Stars. Read 2026-10-31. Primary.
[7] https://core.telegram.org/api/age-verification: client API, age verification. Undated; read 2026-10-31. Primary.
[8] https://core.telegram.org/constructor/restrictionReason: `restrictionReason` constructor. Read 2026-10-31. Primary.
[9] https://core.telegram.org/bots/api-changelog: Bot API changelog to 10.3 (2026-08-24). Read 2026-10-31. Primary.
[10] https://core.telegram.org/bots/api: Bot API reference (`ChatFullInfo.birthdate`). Read 2026-10-31. Primary.
[11] https://core.telegram.org/bots/webapps: Mini Apps docs (`WebAppUser` fields, featuring). Read 2026-10-31. Primary.
[12] https://habr.com/en/news/931854: Habr news on @TelegramAge, 2025-07-28. Press.
[13] https://ppc.world/news/v-telegram-poyavilsya-oficialnyy-bot-dlya-proverki-vozrasta/amp/: ppc.world on the official age bot (UK; not in RU), 2025-07-28. Press.
[14] https://ads.telegram.org/guidelines: Telegram Ad Guidelines §5.1. Undated; read 2026-10-31. Primary.
[15] https://developer.apple.com/app-store/review/guidelines/: App Store Review Guidelines 1.1.4, 1.2, 1.2.1, 2.3.6, 3.1.1, 4.7. Read 2026-10-31. Primary.
[16] https://apps.apple.com/us/app/telegram-messenger/id686449807: Telegram US App Store listing, 13+, v13.1.2. Read 2026-10-31. Primary.
[17] (not opened) Apple's 2025-07-24 age-rating change: news snippets (9to5mac, pocketgamer.biz). CLAIMED.
[18] https://support.google.com/googleplay/android-developer/answer/9878810: Google Play Inappropriate Content policy. "©2026"; read 2026-10-31. Primary.
[19] https://www.consultant.ru/document/cons_doc_LAW_10699/ad5d9196ef8584bf342b4c10c1eb39fed4ae8745/: UK RF art. 242, ed. 04.08.2026. Law text.
[20] https://www.consultant.ru/document/cons_doc_LAW_10699/23ac064057d5bca235050872f65b23a1a1db092a/: UK RF art. 242.1, ed. 04.08.2026. Law text.
[21] https://legalacts.ru/sud/opredelenie-konstitutsionnogo-suda-rf-ot-27062023-n-1757-o/: Constitutional Court ruling 1757-O, 2023-06-27. Court text.
[22] https://www.consultant.ru/law/podborki/uk_rf_pornografiya/: ConsultantPlus selection on pornography (commentary on the definition). Read 2026-10-31.
[23] https://ru.wikisource.org/wiki/Федеральный_закон_от_29.12.2010_№_436-ФЗ: 436-FZ text, 2023-04-28 edition. Law text (older edition).
[24] https://www.consultant.ru/document/cons_doc_LAW_108808/: 436-FZ table of contents, amendments to 569-FZ of 29.12.2025. Read 2026-10-31.
[25] https://www.consultant.ru/document/cons_doc_LAW_117191/30b3f8c55f65557c253227a65b908cc075ce114a/: KoAP art. 6.17. Edition not shown.
[26] https://www.consultant.ru/document/cons_doc_LAW_61801/96fbc469f91f57235cc842a85e0516a99f23dc85/: 152-FZ art. 5, ed. 26.07.2026. Law text.
[27] https://www.currenttime.tv/a/33223807.html: Current Time on the Tomsk anime-drawings verdict, 2024-12-02. Press report of the verdict.
[28] https://www.mentoday.ru/entertainment/news/06-06-2025/v-rossiiskom-internete-nachalas-ohota-na-nyudsy-chto-grozit-za-eroticheskii-kontent-v-telegram/: 2025 prosecutions of explicit Telegram channels, 2025-06-06 (updated 2026-02-11). Press.
[29] https://t-j.ru/ask/porno-zakonno/: Т—Ж explainer on the pornography/erotica line, 2026-07-27. Press.
[30] https://tproger.ru/news/v-rossii-hotjat-legalizovat-porno-verificirovat-vozrast-planirujut-cherez-gosuslugi: the Main Radio Frequency Centre's age-check idea, 2021-06-16. Press (via Kommersant).
[31] https://ru.themoscowtimes.com/2026/06/08/rossiyanam-gotovyat-pasportnii-kontrol-navhode-vinternet-a197564: Shadaev on mandatory age checks, 2026-06-08. Press.
[32] https://profile.ru/news/society/podtverdit-vozrast-mozhno-budet-s-pomoshhju-messendzhera-max-1794705/amp/: MAX age-confirmation law, Duma 2025-12-18. Press.
[33] https://esports.ru/igrovaya-industriya/news/klub-romantiki-vernulsya-v-rossiyu-posle-czezury-kontenta/: Romance Club returns to RU, 2026-05-19. Press.
[34] https://appleinsider.ru/obzory-prilozhenij/klub-romantiki-na-iphone-kak-skachat-i-igrat-v-rossii.html: Romance Club RU app, 18+, same-sex routes removed, 2026-05-19. Press.
[35] https://t-j.ru/romance-club/: Т—Ж on Romance Club monetisation (paid intimate choices), 2023-09-29. Press, editors' test.
[36] https://didit.me/blog/didit-vs-yoti-kyc/: Didit vs Yoti pricing, updated 2026-10-29. Vendor (competitor), CLAIMED.
[37] https://ads.vk.ru/en/insights/kak-projti-moderaciyu: VK Ads moderation guide, 2023-04-04. Platform doc.
[38] https://en.wikipedia.org/wiki/Nutaku: Nutaku (Aylo), milestones including Everlasting Summer adult version 2015-08. Secondary.
[39] https://www.pocketgamer.biz/most-of-nutakus-player-base-is-now-on-mobile/: Nutaku stats, 2020-01-24. Trade press, company figures.

Pointers used as CLAIMED snippets (not opened):
- Steam UK credit-card age check, 2025-08-29 (VGC, TechRadar, Notebookcheck).
- Valve's 2025-07 payment-processor rule (PC Gamer, GamingOnLinux).
- itch.io 2025-07-24 deindexing (VGC, GamingOnLinux).
- Patreon support pages on adult creators and the 17+ iOS rating.
- Adult ad network reviews (affninja, affmaven, afftank).
- Litnet book pages; ESIA connection rules (Habr Q&A, regberry); harant.ru and vseadvokaty.ru lawyers' Q&A;
  Moskalkova 2025-02 (comnews, expert.ru).
