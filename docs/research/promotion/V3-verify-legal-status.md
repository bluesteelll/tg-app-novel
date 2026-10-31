# V3 — adversarial verification, pass C: legal and platform status

Date 2026-10-31. Targets: `06-legal-constraints.md` (TL;DR, key claims 1-15, body), the Telegram-in-Russia claims in
the TL;DRs of `01`, `02` and `04`, and the Telegram-terms readings in `03`. Method: the cited law texts were
re-opened on consultant.ru (38-FZ, KoAP and 149-FZ in the edition "ред. от 04.08.2026" / "26.06.2026"; 436-FZ
"ред. от 29.12.2025"), along with legalacts.ru (72-FZ, 303-FZ), telegram.org / ads.telegram.org (undated pages, read
2026-10-31), OONI Explorer, and dated news and law-firm pages. 22 web searches were run. fas.gov.ru refused again
(ECONNREFUSED 194.226.26.36:443). The garant.ru copy of the FAS text of 2026-03-25 is still mojibake, so FAS texts
are cited through outlets that reproduce them, each with its date. The CPC PDF downloaded only as binary and could
not be read.

**Everything legal here is INTERPRETATION, not legal advice**, except quoted law and terms text (DOCUMENTED). A
Russian lawyer has to confirm the RU items, and an EU lawyer the EU items.

Verdicts: CONFIRMED / CORRECTED (the right text and its source are given) / UNSUPPORTED / STALE / MISLABELLED.

## Verdict table

| # | Report:claim | Claim (short) | Verdict | Evidence (URL, what it says, edition/date) | Fix for synthesis |
|---|---|---|---|---|---|
| 1 | 06:KC1, §2.2 | 38-FZ art. 5 p. 10.7 bans ads on resources "whose access is restricted"; in force 2025-09-01 | CONFIRMED | [A1]: p. 10.7 (introduced by 72-FZ of 2025-04-07) bans ads on resources of undesirable foreign/intl organisations (272-FZ), of organisations liquidated or banned by a court under 114-FZ / 35-FZ, "а также на других информационных ресурсах, доступ к которым ограничен в соответствии с законодательством Российской Федерации об информации, информационных технологиях и о защите информации" (ред. 04.08.2026). [A2]: 72-FZ art. 3 "вступает в силу с 1 сентября 2025 года", with no transitional clause. The text does not say whether a *slowdown* is a "restriction". FAS reads any RKN restriction as enough ("Любое ограничение со стороны РКН — это повод", as paraphrased by [N9]). Sceptical lawyers say p. 10.7 points to the register procedures (149-FZ art. 15.1), and that throttling through TSPU without a published act is legally disputable. No court practice exists [N8][N9] | Quote the wording. State that "restricted" covering a *throttled* resource is FAS's reading, disputed by lawyers and not tested in court (INTERPRETATION) |
| 2 | 06:TL;DR-1 | "Paid promotion inside Telegram aimed at Russia is, per the FAS, unlawful since 2025-09-01" | CORRECTED | The law has been in force since 2025-09-01 [A2]. FAS ties the violation to the platform's restriction date: it weighs "дату заключения договора, дату введения ограничений на работу платформы" [N3]. The FAS head says RKN has restricted Telegram since February 2026 [N4]. One practitioner holds that the norm does not reach ads placed before the restriction (pointer, search snippet only: aldushin.ru). | "Per FAS, ads placed on Telegram since RKN's restrictions (from 2026-02) show signs of a p. 10.7 violation. The law itself has been in force since 2025-09-01." |
| 3 | 06:§2.2, TL;DR-1 | FAS 2026-03-10 named Telegram, WhatsApp, YouTube, Instagram, Facebook and VPN; advertiser and distributor both liable | CONFIRMED | Form: an official FAS news item, fas.gov.ru/news/34556, reproduced by retail.ru 2026-03-10 [N1] and ppt.ru 2026-03-11 [N2]. FAS "усматривает в размещении рекламы на данных ресурсах признаки нарушения части 10.7 статьи 5". Liability falls on "как рекламодатель, так и рекламораспространитель". 38-FZ art. 38 p. 6 (advertiser) and p. 7 (distributor) both list p. 10.7 [A3] | Call it "a FAS public statement (news item), not a normative act or a decision in a case" |
| 4 | 06:KC2 | FAS 2026-03-25: no liability for Telegram/YouTube ads until the end of 2026; Instagram/Facebook/VPN excluded | CONFIRMED | Form: an official FAS news item / press release, fas.gov.ru/news/34584. garant.ru catalogues it as "Информация ФАС от 25.03.2026" (text unreadable) [N5]. pravo.ru 2026-03-25 quotes "до конца 2026 года меры ответственности за распространение рекламы в Telegram и YouTube применяться не будут" [N6]. retail.ru 2026-03-25 gives the reason ("требуется время для адаптации") and the exclusions (Instagram, Facebook "ранее", VPN services) [N3]. FAS head Shaskolsky told Expert on 2026-03-26 that the basis is restricted access since February 2026 [N4]. eLama reads the period as "до конца 2026 года включительно" [N7] | Keep. Label the form "FAS press statement (news item)" and give the end date as 2026-12-31 inclusive |
| 5 | 06:TL;DR-1 interp.; brief question | Whether the transition / ban covers ads in Telegram for RU users only, or any ad mentioning Telegram | CONFIRMED (as INTERPRETATION) | The FAS texts speak of "размещение рекламы в Telegram" (placement *on* the platform) [N1][N3]. p. 10.7 has no audience qualifier [A1]. 38-FZ art. 2 p. 1 applies the law "независимо от места ее производства, если распространение рекламы осуществляется на территории Российской Федерации" [A4]. No FAS text addresses ads on VK/Yandex that *link to* a Telegram bot, or that mention Telegram (search: none found). pravo.ru: FAS gave no audience criteria [N8] | INTERPRETATION: an ad on VK that points to the TMA is not literally "on" a restricted resource. That reading is unconfirmed. Do not claim FAS has cleared it |
| 6 | 06:KC3 | No FAS position on Telegram ads after 2026-12-31 (latest checked 2026-09-28) | CONFIRMED (absence) | to-pick.ru 2026-09-28: "Что будет после 31 декабря, пока не объявлено" [N10]. ppc.world 2026-09-15: experts "do not rule out" the rules staying the same in 2027 [N11]. vc.ru (2026-06-04) has no newer FAS statement and cites KoAP 14.3 p. 1 [N12]. Two searches (RU, Oct 2026) found no FAS statement after March 2026 | Keep as CLAIMED-absence as of 2026-10-31. Re-check at launch |
| 7 | 06:§2.2 | A FAS letter of 2026-04-06 confirming the transition (via eLama) | UNSUPPORTED | eLama 2026-06-02 describes its content but gives no number and no addressee [N7]. A search for "письмо ФАС от 06.04.2026" found no such document: outlets cite only the 2026-03-25 item | Drop it, or keep it as "reported by eLama only" |
| 8 | 06:§2.4; 01, 04 TL;DR | RKN confirmed restricting Telegram on 2026-02-10 | CONFIRMED | Interfax 2026-02-10: "по решению уполномоченных органов, Роскомнадзор продолжит введение последовательных ограничений", "с возможностью их снятия в случае устранения нарушений". Reasons given: law not observed, personal data, fraud, terrorism. **No law or article named** [N13]. BFM 2026-02-10: RKN's word is "ограничение". "Замедление" (slowdown) is the media's word [N14] | Quote RKN's own words ("последовательные ограничения"). Note that no legal basis was named and no act was published |
| 9 | 06:KC10 | OONI: blocking on many RU ISPs from 2026-03-20, ongoing | CONFIRMED | OONI finding, 2026-03-30 (M. Xynou): Rostelecom AS12389, Vimpelcom AS8402, MTS AS8359, Central Telegraph AS8615; 547 ASes measured 2026-02-28 → 03-30 with the ts-020 Telegram test; "ongoing"; the block "is not visible on all tested networks"; no percentage given [M1] | MEASURED. Add the caveat "not on all networks" |
| 10 | 06:TL;DR-2, §2.4 | "95 % anomalies on 2026-04-10" (brief: "~95 % blocked by April") | MISLABELLED | Meduza 2026-04-10 (translating Agentstvo): "Anomalies indicating that Telegram is being blocked in Russia reached 95 percent by the morning of April 10". The denominator (tests, networks) is undefined; the figure was 72 % on 03-20 [N15]. Opened now (06 had it only as a pointer) | Write: "95 % of OONI Telegram-test measurements anomalous on the morning of 2026-04-10 (Agentstvo via Meduza; denominator undefined)". Label it OONI data relayed second-hand = CLAIMED until the OONI query is opened. **Never "95 % blocked"** |
| 11 | 02:TL;DR-4 | Mediascope RU monthly audience 94 M (2026-03) → 76 M (2026-06) | CONFIRMED | ppc.world 2026-09-15: "76 млн россиян старше 12 лет (Mediascope, июнь 2026) — против 94 млн человек в марте", monthly. An SA Media expert attributes part of the fall to summer seasonality [N11]. A compilation dated 2026-10-18 (checkroi.ru, citing Vedomosti/RB.ru/Expert) gives monthly 93.6 (Dec-25), 95.7 (Feb-26), 94.3 (Mar), 88.0 (Apr), 75.7 (Jun); **daily 74.3 → 80.0 → 72.2 → 50.3 → 35.4 (Jun) → 33.8 M (Aug 2026)** [N16] | Label "MEASURED (Mediascope panel), secondary". Add the daily-reach series (CLAIMED compilation): RU daily reach is roughly halved since March 2026 |
| 12 | 04:TL;DR-1 | Mediascope 93.6 M monthly / 74.3 M daily, Dec 2025, labelled "DOCUMENTED-by-press" | MISLABELLED | The values match the compilation [N16]. Under 00-CONTEXT, DOCUMENTED means an official document, terms or law text; a panel measurement relayed by press is MEASURED-secondary (or CLAIMED) | Relabel |
| 13 | 04:TL;DR-1 | "A drop in March 2026 … CLAIMED/unverified" | STALE | The April-June figures are now relayed (see #11): 88.0 M monthly in April, 75.7 M in June; daily 35.4 M in June [N11][N16] | Replace with the #11 series |
| 14 | 06:TL;DR-2 | Durov: 65 M Russians use Telegram via VPN (2026-04-04) | CONFIRMED (CLAIMED) | Durov's post (2026-04-04) via the search snippets of several outlets: "65 миллионов россиян ежедневно используют его через VPN", "более 50 миллионов отправляют сообщения каждый день". RU Wikipedia cites Kommersant [N17][N18] | Add "daily". It comes from an interested party; no independent check |
| 15 | 06:TL;DR-2, row 2026-04/05 | Channel audiences "roughly halved" after the late-April round; one channel's CPM fell to 400-500 RUB from ~1,000 | CONFIRMED (CLAIMED) | Meduza 2026-06-11: "roughly half their audiences" is Agentstvo's claim; "as much as 35 percent of their views" is one admin's statement about channels he knows. The CPM figure comes from the anonymous author of one satirical news channel [N19] | Keep as CLAIMED. The CPM is **not representative** of a romance/girls audience. Do not use it as a price benchmark |
| 16 | 06:§2.4 | Court fined Telegram 35 M RUB on 2026-03-16 | CONFIRMED | Tagansky district court, KoAP 13.41 p. 4, five episodes × 7 M RUB (court press service via zona.media / 360.ru / DPA, search snippets) [N20]. 3dnews 2026-04-21 reports further fines: 10.8, 7, 10.5 M RUB in 2026 [N21] | Keep (cite the court, not Wikipedia) |
| 17 | 06:KC11, TL;DR-2 | "No official blocking act, register entry or extremist designation of Telegram was found" | CORRECTED | True for the *blocked-resources register* (to-pick 2026-09-28 [N10]; ALRUD's Khodakov: no domain in the register, in pravo.ru 2026-03-06 [N8]) and for the extremist/undesirable lists (Delcredere's Merkulova [N8]). But the "official acts" exist elsewhere. (a) The 2018 court decision to block Telegram was "не отменено", and FAS may rely on it or on an unpublished Prosecutor-General demand under 149-FZ art. 15.3 (lawyers Spitsyna, Mironov [N8]). (b) RKN "по решению уполномоченных органов" (unpublished) [N13]. (c) Since 2022-08 Telegram has been on RKN's 236-FZ foreign-persons list under coercive measures (search-engine labelling) [N22]. (d) Telegram has been on RKN's register of social networks since 2021-10 [N23] | Write: "No published act specific to the 2026 restriction and no blocked-register entry; the 2018 court decision formally stands; RKN cites unpublished decisions" |
| 18 | 06:KC4 | KoAP 14.3 p. 16: 30-100k / 100-200k / 200-500k RUB | CONFIRMED | [A5] ред. 04.08.2026: "без присвоенного оператором рекламных данных … идентификатора рекламы": citizens 30-100k, officials 100-200k, legal entities 200-500k (introduced by 274-FZ of 2023-06-24) | Keep |
| 19 | 06:§1.3 table | KoAP 14.3 p. 1 (2-2.5k / 4-20k / 100-500k), p. 9 (20-80k / 80-300k / 0.5-3 M), p. 15 (10-30k / 30-100k / 200-500k), p. 18 (50-80k / 80-150k / 200-500k; 281-FZ) | CONFIRMED | [A5]: the amounts are verbatim. p. 9 (259-FZ of 2022) covers ads on a resource of a foreign person listed under 236-FZ **after** an ad-ban measure has been taken against it. p. 18 was introduced by 281-FZ of 2025-07-31. **No part of 14.3 refers to art. 5 p. 10.7** | Keep |
| 20 | 06:KC5, §1.3 | Which KoAP part applies to p. 10.7 on Telegram (1 or 9) — "open question" | CORRECTED | Practice points to **p. 1**. eLama quotes an RKN reply that FAS "может привлекать … (ч. 1 ст. 14.3 КоАП РФ)" [N7]. The lawyers in pravo.ru give exactly the p. 1 amounts [N8]. A law-firm page: p. 1 because there is no special part, and the higher parts need an RKN decision plus a listing [N9]. Telegram *is* on the 236-FZ list (2022) [N22], but no RKN ad-ban measure against it was found, so p. 9 is not triggered on the evidence. eLama's "stricter fines for restricted resources since 2025-09-01" have no basis in the KoAP text [A5] | Exposure per post: p. 1, legal entity 100-500k RUB (individual 2-2.5k, official/IP 4-20k); p. 9 only if RKN imposes a 236-FZ ad ban on Telegram (INTERPRETATION) |
| 21 | 06:§1.3 | KoAP 14.3.1 is tobacco/nicotine | CONFIRMED | consultant.ru title of art. 14.3.1: "Спонсорство табака или никотинсодержащей продукции, реклама и стимулирование продажи табака…" [A6] | Keep |
| 22 | 06:KC8, TL;DR-4 | FAS letter АК/32908/25 (2025-04-09): own-resource product info is not advertising "unless a post singles out one product among similar ones" | CORRECTED (nuance) | [A7] Letter of 2025-04-09 No. АК/32908/25. Own-resource information about one's own goods "не может быть признана рекламой", **including a banner or news about a promotion on a specific product**. The singling-out test ("выделение среди однородных товаров", e.g. a fixed banner on every page) is stated for goods of *different producers* on a seller's resource. Information that "стимулируют или поддерживают особый интерес к определенному товару" may be advertising. Each case is decided on its facts | Write: "own-channel posts about our own chapters are information per FAS 2025, even a promo banner; risk rises with content that 'stimulates special interest' and with RKN's stricter 2023 line (secondary)". The "buy chapter 2 now" grey zone stands as INTERPRETATION |
| 23 | 06:KC7, §1.4 | Art. 18.2 p. 5: a Russian advertiser contracting a foreign party withholds the 3 % itself | CORRECTED (scope) | [A8] p. 5 binds only "Рекламодатель, являющийся российским юридическим лицом, российским индивидуальным предпринимателем или гражданином Российской Федерации" with a contract for internet ads aimed at consumers in Russia with a foreign person. It withholds "из денежных средств, выплачиваемых иностранному лицу" | Add: "only if the operator is a Russian entity, IP or citizen (Q21)". INTERPRETATION: spending earned Stars as ad credit pays no money, so the withholding base is unclear. Lawyer item |
| 24 | 06:§1.4 | The 3 % levy is art. 18.2 (479-FZ of 2024-12-26); payers are distributors and ad-system operators | CONFIRMED | [A8] art. 18.2 "Обязательные отчисления…", introduced by 479-FZ of 26.12.2024. p. 1 payers: "Рекламораспространители и операторы рекламных систем". p. 4 "трех процентов". p. 10 extends it to intermediaries | Keep |
| 25 | 06:KC6, §2.1 | 38-FZ art. 5 p. 10.6: no ads on unlisted >10k personal pages, from 2025-01-01 (303-FZ of 2024-08-08); 149-FZ art. 10.6 pp. 1.1-1.3 | CONFIRMED | [A1] p. 10.6 (303-FZ). [A9] 303-FZ art. 5 p. 3 → 2025-01-01 for art. 2 (the 38-FZ change); p. 2 → 2024-11-01. [A10] 149-FZ art. 10.6: social network = "более пятисот тысяч пользователей"; p. 1.1 ">10,000"; p. 1.2 the перечень; p. 1.3 unlisted pages may not post fundraising offers | Keep |
| 26 | 06:KC6, §2.1, Gaps | Telegram's status as a "social network" under 149-FZ art. 10.6 is "not verified" | CORRECTED | RKN added Telegram (with LiveJournal) to its register of social networks for exceeding 500k Russian daily users, per Interfax relayed by dev.by on 2021-10-26 [N23]. RKN's own Telegram channel was entered in the >10k list in 2024-11 (dp.ru, search snippet) | Treat Telegram channels >10k as covered: the p. 10.6 ad ban applies to unlisted ones (press-sourced; RKN primary unreachable) |
| 27 | 06:KC9, §3.1 | Ads must state the age category (38-FZ art. 5 p. 10.1); 436-FZ art. 11 p. 4 Internet marking exemption; a game = "программы для ЭВМ" (art. 2 p. 5) | CONFIRMED | [A1] p. 10.1: "без указания категории данной информационной продукции" (252-FZ of 2011); distributor liable via art. 38 p. 7 "9 - 10.3" [A3]. [A11] art. 2 p. 5 lists "программы для электронных вычислительных машин (программы для ЭВМ) и базы данных" and Internet-distributed information. [A12] art. 11 p. 4: oborot "без знака информационной продукции не допускается, за исключением: … 6) информации, распространяемой посредством … сети "Интернет", кроме сетевых изданий и аудиовизуальных сервисов" | Keep |
| 28 | 06:§3.2 | 12+ = "episodic, non-naturalistic" depiction of relations between a man and a woman, no sexual acts; 16+ = depiction without exploiting interest in sex | CONFIRMED | [A13] art. 9 item 3: "эпизодические ненатуралистические изображение или описание половых отношений между мужчиной и женщиной", "не эксплуатирующие интереса к сексу и не носящие возбуждающего или оскорбительного характера", "за исключением … действий сексуального характера". [A14] art. 10 item 5 (16+) is the same without "эпизодические ненатуралистические" and "возбуждающего"; item 4 allows "отдельные бранные слова" | Keep |
| 29 | 06:TL;DR-5, §3.2, Owner Q3 | "Same-sex romance is banned for all ages in Russia (478-FZ; in 436-FZ art. 5 p. 2)" | CORRECTED | 436-FZ governs *children*. Art. 5 p. 2 item 4.1 (478-FZ of 2022-12-05) bars for children information "пропагандирующая **либо демонстрирующая** нетрадиционные сексуальные отношения и (или) предпочтения", so under 18 even depiction is barred [A15]. The **all-ages** ban is on *propaganda*: KoAP 6.21 as amended by 479-FZ of 2022-12-05 ("среди лиц любого возраста"; legal entities from 800k to 1 M RUB in part 1, higher in the qualified parts) [A16][A17]. 478-FZ's 149-FZ changes (the blocking basis) were not re-read. Whether a same-sex route in an 18+ game is "propaganda" is an enforcement judgement, not a text. Market evidence: Romance Club's RU version removed same-sex routes (04 [30], CLAIMED) | Write: "for minors, depiction is barred (436-FZ 5.2 item 4.1); for adults, 'propaganda' is banned at every age (KoAP 6.21; 149-FZ via 478-FZ). The risk reading is: no same-sex routes in RU builds" (INTERPRETATION) |
| 30 | 06:KC12, TL;DR-6 | Earned Stars buy Telegram Ads at 0.02 USD per Star (§6.2.3 of which document?) | CONFIRMED | The document is the **Telegram Bot Platform Developer Terms** §6.2.3 [T1]: "each Star in your balance is worth 0.02 USD in advertising credit", and "It is possible that this value may fluctuate, based on temporary promotions and incentives". §6.2.4: 0.013 USD reward per Star; up to 21-day hold. Undated page | Add the fluctuation clause and the 21-day hold |
| 31 | 06:KC13, TL;DR-6 | Telegram Ad guidelines §5.1 ban "sexually suggestive content" and "dating services" | CONFIRMED | [T2] §5.1 "Graphic, shocking, or sexual content": "Nudity, sexually explicit and sexually suggestive content, including … dating services". The **same §5.1** also bans "Gruesome, disgusting, or shocking imagery…". §5.4 bans "shock or scare tactics". §4.7: language match. §5.6: real-money gambling. No minors/age section. Undated | Add: horror-puzzle creatives (the Silent Hill wish) are constrained by §5.1 bullet 1 and §5.4 too |
| 32 | 06:KC14, TL;DR-6 | Telegram ToS: 18+ only in the EU, UK and Australia | CONFIRMED | [T3]: "Users in EU countries, the United Kingdom and Australia must be at least 18 years old to sign up." No other age and no parental clause. Undated | Keep |
| 33 | 06:KC15, TL;DR-7 | CPC: withdrawal right for virtual currency cannot be waived and lapses on use | CONFIRMED (CLAIMED, contested) | Reed Smith 2025-03-27: the CPC suggests "players cannot waive their withdrawal right"; if used in the period "the right of withdrawal would no longer exist". Reed Smith itself argues that currency *is* "digital content" [L1]. Gleiss Lutz 2025-04-17: "virtual currency is not considered digital content, so the right of withdrawal cannot be excluded"; this applies whether the buyer pays "with real money, another virtual currency, or personal data" [L2]. The CPC PDF (2025-03-21) could not be read (binary) | Keep as the CPC's *position* (soft law, contested by law firms and by VGE/EGDF per search pointers). INTERPRETATION: hints bought with Stars are in scope ("another virtual currency") |
| 34 | 06:TL;DR-7, §5 | CPC: real-money price next to the virtual one; no forced over-buying; design for minors "even if aimed at an adult audience"; non-binding | CONFIRMED (CLAIMED) | Linklaters 2025-03-27: prices "clearly indicated in real-world money"; players may "choose the specific amount"; principle 7 on children; "The principles are not binding" [L3]. Reed Smith: avoid practices that "force consumers to purchase unwanted in-game virtual currency" [L1]. "Even if it is aimed at an adult audience" is **Gleiss Lutz's wording** [L2]; it was not seen in the CPC text | Attribute the "adult audience" phrase to Gleiss Lutz. The Stars → hints two-step exchange touches principle 2 ("avoid mixing currencies / exchanges") |
| 35 | 03:§3, TL;DR | Bot Developer Terms §5.2(b) spam, §5.2(d) incl. (i) MLM/ponzi, (ii) "Social growth manipulation" (undefined), §5.2(f), §6.2.4 withhold for "suspected abuse", §6.2.5 permission-only broadcasts | CONFIRMED | [T1]: §5.2(d) "misleading users into performing certain actions in the pursuit of an unachievable outcome"; (i) "MLM or ponzi schemes"; (ii) "Social growth manipulation", not defined anywhere. §5.2(f) verbatim. §6.2.4 "temporarily withhold or permanently debit Stars" for "suspected abuse of Bot Platform". §6.2.5 "users who have granted permission to contact them". §8.2.1 "at its sole discretion" | Keep; 03's reading matches 06 |
| 36 | 01:TL;DR-6 | "RKN confirmed nationwide throttling on 2026-02-10. By 2026-03-17, Meduza reported Telegram 'largely inaccessible' nationwide, with VPNs of little help" | CORRECTED | RKN said "последовательных ограничений", not "throttling"/"nationwide" [N13]. Meduza 2026-03-17: "largely inaccessible across Russia since the weekend", based on Downdetector/Sboi.rf complaints and Kommersant's experts; **no official confirmation**. The VPN remark is one expert speaking of whitelist-only mobile internet ("in cities where only whitelisted sites work, most VPN services won't help") [N24]. Durov later claimed 65 M daily via VPN (#14) | Reword. "VPNs of little help" applies to whitelist-mode mobile internet only, per one expert |
| 37 | 01:TL;DR-6, Gaps | "The situation after March 2026 was not established" | STALE | After March: OONI 95 % anomalies (04-10), the late-April/May round (Agentstvo), Mediascope June/August, further court fines, no published block act (#9-#17) | Use the #8-#17 timeline |
| 38 | 06:§2.3 | 38-FZ p. 10.8 bans VPN ads (332-FZ of 2025-07-31, in force 2025-09-01); fine in KoAP 14.3 p. 18 | CONFIRMED | [A1] p. 10.8 "(введена Федеральным законом от 31.07.2025 N 332-ФЗ)"; [A5] p. 18 "(введена Федеральным законом от 31.07.2025 N 281-ФЗ)". The in-force date was not re-read (06 cites legalacts) | Keep |
| 39 | 06:§2.4 | Durov charged in absentia / wanted, 2026-07-29 | UNSUPPORTED (date) | RU Wikipedia (last edited 2026-10-12) puts it at 29 June in the body, while the cited Lenta.ru URL is dated 29 July [N18] | Write "2026-06/07 (date unresolved)"; it is not load-bearing |

**Counts:** CONFIRMED 25 · CORRECTED 8 · UNSUPPORTED 2 · STALE 2 · MISLABELLED 2 (39 rows).

## Cross-report contradictions

1. **The legal status of RU Telegram ads after 2026.** 02 says paid acquisition has "an unknown legal status from
   2027-01-01". 06 says the ban already stands and only liability is deferred. 06 matches the FAS texts [N1][N3].
   The status is not unknown: per FAS it is a violation now, un-fined until 2026-12-31. What is unknown is
   enforcement from 2027. Both reports omit that "restricted" covering a throttled resource is FAS's contested
   reading (#1).
2. **When the violation starts.** 06 says "since 2025-09-01". FAS weighs the platform's restriction date, and its
   head says RKN has restricted Telegram since February 2026 [N3][N4] (#2).
3. **Telegram's audience in Russia.** 04 calls the March-2026 drop CLAIMED/unverified and labels the Dec-2025
   Mediascope figures "DOCUMENTED-by-press". 02 reports 94 → 76 M (Mar → Jun) without a label. 01 says the post-March
   status was "not established". The consistent reading is Mediascope panel data relayed by press, MEASURED-secondary:
   monthly 94.3 → 75.7 M, daily 72.2 → 35.4 M (Jun) → 33.8 M (Aug 2026) [N11][N16].
4. **VPN.** 01: "VPNs of little help" (one expert, whitelist mode) vs 06: Durov's 65 M daily via VPN (an interested
   party). Neither is a measurement. The synthesis should present both as CLAIMED and quantify neither.
5. **The 95 % figure.** 06 labels it "MEASURED, secondary". It is an anomaly share with an undefined denominator,
   relayed by Agentstvo and Meduza (#10). It must not become "95 % blocked" in the synthesis (one search-result guide
   already turned it into "95 % of connections fail").
6. **The applicable fine.** 06 leaves part 1 vs part 9 open and cites eLama's part-9-level "stricter" amounts. The
   KoAP text has no part for p. 10.7, and RKN (quoted by eLama) and the lawyers cite part 1 (#20).
7. **Official acts.** 06 says "no official blocking act", while its own sources (pravo.ru lawyers) mention the
   unrevoked 2018 court decision and the unpublished authorities' decisions RKN refers to (#17).

## What the promotion plan may and may not rely on

- **May rely on (DOCUMENTED):** the text of 38-FZ art. 5 p. 10.7 and its in-force date 2025-09-01; the KoAP 14.3
  amounts (parts 1, 9, 15, 16, 18; ред. 04.08.2026); ERID + "Реклама" + advertiser info for every RU internet ad; the
  age sign in every ad (p. 10.1); the 12+/16+ wording of 436-FZ arts. 9-10.
- **May rely on (FAS public statements, 2026-03-10 / 03-25):** Telegram and YouTube ads for RU are un-fined until
  2026-12-31 inclusive; Instagram/Facebook/VPN ads are not covered. No newer FAS statement was found as of
  2026-10-31. Re-check before any placement that runs into 2027.
- **May not rely on** "Telegram ads are legal in RU" (the ban stands per FAS) or on "they are illegal by statute
  beyond doubt" (a throttled resource counting as "restricted" is contested and untested in court). Present it as a
  regulator position with enforcement deferred. INTERPRETATION.
- **Fine exposure to plan with:** KoAP 14.3 p. 1 per violation (legal entity 100-500k RUB; official/IP 4-20k;
  citizen 2-2.5k) for a p. 10.7 breach; p. 16 (up to 500k) for a missing ERID. Not the 0.5-3 M of p. 9, unless RKN
  imposes a 236-FZ ad ban on Telegram.
- **May rely on:** own-channel and bot posts about our own chapters, prices and promos are information, not ads,
  per FAS 2025-04-09 (АК/32908/25). Keep the 2023 RKN stricter line as a caveat (secondary).
- **May rely on:** Telegram channels >10k audience must be on RKN's list to carry ads (p. 10.6, since
  2025-01-01). Telegram has been on RKN's social-network register since 2021-10 (press).
- **May not rely on** a 3 % self-withholding duty without first settling Q21: art. 18.2 p. 5 binds only Russian
  entities, IPs and citizens as advertisers.
- **Telegram status facts to use:** RKN's 2026-02-10 "последовательные ограничения" with no legal basis named; OONI
  blocking on major ISPs from 2026-03-20 (MEASURED, not on all networks); Mediascope daily reach roughly halved by
  Jun-Aug 2026 (MEASURED-secondary); no blocked-register entry. **Not:** "95 % blocked", "VPNs don't work", "Telegram
  is banned".
- **Content:** no same-sex romance in RU builds is the risk reading. For minors, depiction itself is barred
  (436-FZ); for adults, "propaganda" is banned at every age (KoAP 6.21). INTERPRETATION; a lawyer and the owner
  decide.
- **Telegram Ads creatives:** §5.1 bans sexually suggestive content, dating framing **and** gruesome/shocking
  imagery; §5.4 bans scare tactics. This covers the horror-puzzle angle as well as romance. Stars → ad credit is
  0.02 USD per Star, "may fluctuate", with up to a 21-day hold (Bot Platform Developer Terms §6.2.3-6.2.4).
- **EU (only if targeted):** the CPC principles (2025-03-21) are soft law, known only through law-firm summaries.
  Plan for real-money price context, self-chosen hint amounts and no withdrawal waiver for hint packs. Do not cite
  them as binding law.
- **Telegram minimum age:** 18 in the EU/UK/Australia only (ToS). Nothing in Telegram's terms covers RU teens; the
  RU age rules come from 436-FZ / 38-FZ.

## Sources (opened 2026-10-31 unless stated)

Law texts (DOCUMENTED):
- [A1] https://www.consultant.ru/document/cons_doc_LAW_58968/f67f81c57fdcdacc2643d19d59369f7e185e1156/ — 38-FZ art. 5, ред. 04.08.2026.
- [A2] https://legalacts.ru/doc/federalnyi-zakon-ot-07042025-n-72-fz-o-vnesenii-izmenenii/ — 72-FZ of 2025-04-07, art. 2 (p. 10.7), art. 3 (in force 2025-09-01).
- [A3] https://www.consultant.ru/document/cons_doc_LAW_58968/4f8dcac024f3f2aec7ee1abb4fb4d8352cc84990/ — 38-FZ art. 38 pp. 6-7, ред. 04.08.2026.
- [A4] https://www.consultant.ru/document/cons_doc_LAW_58968/c530355c76ec66b91be9125e07b0b2bafd370a08/ — 38-FZ art. 2 p. 1.
- [A5] https://www.consultant.ru/document/cons_doc_LAW_34661/2d50fc1c4013ea9ab20b8b2666c1650b1dc4c982/ — KoAP art. 14.3, ред. 04.08.2026.
- [A6] https://www.consultant.ru/document/cons_doc_LAW_34661/6b5ee5e17882637fda8fcda423ea8b7e921ea431/ — KoAP art. 14.3.1 title (search result on consultant.ru).
- [A7] https://www.consultant.ru/document/cons_doc_LAW_503349/ — FAS letter of 2025-04-09 No. АК/32908/25.
- [A8] https://www.consultant.ru/document/cons_doc_LAW_58968/f5499f6a99f4f1011e473eae3412f6c7f0262387/ — 38-FZ art. 18.2 (479-FZ), ред. 04.08.2026.
- [A9] https://legalacts.ru/doc/federalnyi-zakon-ot-08082024-n-303-fz-o-vnesenii-izmenenii/ — 303-FZ of 2024-08-08, art. 5 (in-force dates).
- [A10] https://www.consultant.ru/document/cons_doc_LAW_61798/a3cba9a7c2ac9aa487df2d4172734dd5139376f5/ — 149-FZ art. 10.6 (ред. 26.06.2026).
- [A11] https://www.consultant.ru/document/cons_doc_LAW_108808/b819c620a8c698de35861ad4c9d9696ee0c3ee7a/ — 436-FZ art. 2, ред. 29.12.2025.
- [A12] https://www.consultant.ru/document/cons_doc_LAW_108808/b6ad93377c891ecf889a0b6262cb45ef1cd2479a/ — 436-FZ art. 11.
- [A13] https://www.consultant.ru/document/cons_doc_LAW_108808/360c3e68c68d0e9fc19c65a9b434ae18a8db56f1/ — 436-FZ art. 9 (12+).
- [A14] https://www.consultant.ru/document/cons_doc_LAW_108808/2025d6422eaf7de29d5df80a9eab6a678833b9c2/ — 436-FZ art. 10 (16+).
- [A15] https://www.consultant.ru/document/cons_doc_LAW_108808/9083b03e61777d3fe172fb3ef707a10e10688262/ — 436-FZ art. 5, ред. 29.12.2025.
- [A16] https://www.consultant.ru/document/cons_doc_LAW_34661/5b103e878283a04f8ea2130f38e19f10b516b626/ — KoAP art. 6.21 (amounts via search-result summary; not opened).
- [A17] https://www.consultant.ru/law/hotdocs/78197.html — consultant.ru note on 479-FZ of 2022-12-05 ("среди лиц любого возраста").

Telegram terms (DOCUMENTED, undated pages):
- [T1] https://telegram.org/tos/bot-developers — Bot Platform Developer Terms §5.2, §6.2.3-6.2.5, §8.2.1.
- [T2] https://ads.telegram.org/guidelines — Ad Platform guidelines §4.7, §5.1, §5.4, §5.6.
- [T3] https://telegram.org/tos — Telegram ToS (age sentence).

Measurement:
- [M1] https://explorer.ooni.org/findings/96225549500 — OONI "Russia blocked Telegram", 2026-03-30.

Regulator statements via outlets, news, practitioners (pointers / CLAIMED unless stated):
- [N1] https://www.retail.ru/news/fas-razyasnila-pozitsiyu-vedomstva-v-chasti-kontrolya-reklamnogo-zakonodatelstva-10-marta-2026-275366/ — FAS 2026-03-10 (fas.gov.ru/news/34556) as reproduced.
- [N2] https://ppt.ru/columns/o-prave-v-onlayne/ofitsialnaya-pozitsiya-fas-rf-o-reklame-v-telegram — 2026-03-11, quotes FAS 34556.
- [N3] https://www.retail.ru/news/fas-oboznachila-sroki-v-kotorye-biznes-mozhet-razmeshchat-reklamu-v-telegram-25-marta-2026-275903/ — FAS 2026-03-25 (fas.gov.ru/news/34584) as reproduced.
- [N4] https://expert.ru/news/glava-fas-nazval-osnovanie-dlya-kontrolya-za-reklamoy-v-telegram — Shaskolsky to Expert, 2026-03-26.
- [N5] https://base.garant.ru/413952580/ — "Информация ФАС от 25.03.2026" (Cyrillic corrupted).
- [N6] https://pravo.ru/news/262958/ — Pravo.ru 2026-03-25.
- [N7] https://elama.ru/blog/zapret-reklamy-v-telegram/ — eLama 2026-06-02 (practitioner; quotes an RKN reply naming KoAP 14.3 p. 1).
- [N8] https://pravo.ru/story/262745/ — Pravo.ru 2026-03-06, eight named lawyers.
- [N9] https://krd.iusov.ru/moratorij-fas-na-shtrafy-v-telegram-i-youtube-do-2027-goda-pravovaya-pauza-ili-realnyj-risk/ — law-firm page, 2026-03-31.
- [N10] https://to-pick.ru/articles/899-perehodnyi-period-po-reklame-v-telegram-plan-dlja-biznesa-do-31-dekabrja-2026-goda — agency, 2026-09-28.
- [N11] https://ppc.world/articles/reklama-v-telegram-v-2026-godu-benchmarki-i-stoit-li-zapuskat-kampanii-seychas/ — ppc.world 2026-09-15 (Mediascope June 2026; SA Media CPM).
- [N12] https://vc.ru/legal/2960629-fas-i-reklama-v-telegram-i-youtube-moratoriy-na-shtrafy — vc.ru, 2026-06-04.
- [N13] https://www.interfax.ru/digital/1072012 — Interfax 2026-02-10, RKN statement.
- [N14] https://www.bfm.ru/news/597714 — BFM 2026-02-10.
- [N15] https://meduza.io/en/news/2026/04/10/telegram-blocking-rate-in-russia-reaches-95 — Meduza 2026-04-10 (Agentstvo/OONI).
- [N16] https://checkroi.ru/blog/skolko-polzovateley-telegram-v-rossii/ — compilation of Mediascope figures via Vedomosti/RB.ru/Expert/Sostav, 2026-10-18; secondary.
- [N17] https://novayagazeta.eu/articles/2026/04/04/telegram-budet-adaptirovatsia-k-blokirovkam-v-rossii-zaiavil-durov-news — Durov statement 2026-04-04 (search-snippet level).
- [N18] https://ru.wikipedia.org/wiki/Блокировка_Telegram_в_России_(2026) — last edited 2026-10-12; pointer.
- [N19] https://meduza.io/en/feature/2026/06/11/russia-has-been-blocking-telegram-for-months-meduza-asked-five-popular-channel-admins-if-it-s-working — Meduza 2026-06-11.
- [N20] https://zona.media/news/2026/03/16/fine — 2026-03-16 (with 360.ru and digitalpolicyalert.org; search snippets).
- [N21] https://3dnews.ru/1140389/ — 3dnews 2026-04-21 (fine list).
- [N22] https://www.comnews.ru/content/221831/2022-08-22/2022-w34/roskomnadzor-prinyal-mery-otnoshenii-ryada-inostrannykh-it-kompaniy — ComNews 2022-08-22 (236-FZ measures against Telegram).
- [N23] https://devby.io/news/roskomnadzor-vnes-telegram-i-livejournal-v-reestr-sotssetei — dev.by 2021-10-26 (Interfax: Telegram in RKN social-network register).
- [N24] https://meduza.io/en/feature/2026/03/17/russia-was-expected-to-block-telegram-in-april-it-appears-to-have-done-it-two-weeks-early — Meduza 2026-03-17.

EU (law-firm summaries; CLAIMED):
- [L1] https://www.reedsmith.com/de/perspectives/2025/03/qas-on-the-eu-consumer-protection-authorities-joint-guidance-paper — Reed Smith 2025-03-27.
- [L2] https://www.gleisslutz.com/en/know-how/new-guidelines-game-currencies-digital-consumer-protection-and-expanding-taboo-dark-patterns — Gleiss Lutz 2025-04-17.
- [L3] https://techinsights.linklaters.com/post/102k6t4/game-changer-eu-introduces-consumer-protection-guidance-for-in-game-virtual-curr — Linklaters 2025-03-27 (links the CPC PDF: commission.europa.eu/document/download/8af13e88-…, binary, not readable here).
