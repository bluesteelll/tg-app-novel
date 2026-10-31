# Verify pass G (V7): 12-russian-payments-vs-stars.md

Date 2026-10-31. Role: adversarial verifier. Pages opened: 44 (Telegram 6, Apple 7, Russian law/regulator 7, vendors 9,
press/other 15); web searches: 16. Freshness: Bot API 10.3 (2026-08-24) is the latest changelog entry; CBR USD/RUB for
2026-10-31 read from cbr.ru. Legal readings are **INTERPRETATION, not legal advice**.

Verdict counts: **CONFIRMED 24 / CORRECTED 9 / STALE 2 / UNSUPPORTED 1 / MISLABELLED 1** (37 rows).

## Claim table

| # | Report:claim | Claim (short) | Verdict | Evidence (URL, what it says, date) | Fix for synthesis |
|---|---|---|---|---|---|
| 1 | 12:KC1, TL;DR | Terms §6.2: digital goods "exclusively through the exchange of Telegram Stars"; "cannot be processed through third-party payment providers"; on notice and non-compliance "inaccessible from store versions of Telegram or terminate it from Bot Platform" | CONFIRMED | [T1] §6.2 opens "Your TPA may also offer digital goods and services for purchase"; the second sentence carries "cannot be processed through third-party payment providers"; "must be executed exclusively through the exchange of Telegram Stars"; "If your TPA is found to be using alternative payment systems for digital goods and services" → notice → "make your TPA inaccessible from store versions of Telegram or terminate it from Bot Platform". "Since Telegram must adhere to Apple and Google's definitions of digital goods and services" also present. Page undated, read 2026-10-31 | None |
| 2 | 12:KC2, TL;DR | Stars FAQ: "Telegram cannot display your bot or mini-app to mobile users if you attempt to sell digital goods and services via other currencies or through third-party payment providers" | CONFIRMED | [T2] FAQ "Can I use a different currency or payment provider?": "Payments for digital goods and services must be carried out exclusively in Telegram Stars" … "Due to these rules, Telegram cannot display your bot or mini-app to mobile users" … "if you attempt to sell digital goods and services via other currencies or through third-party payment providers". Undated, read 2026-10-31 | None |
| 3 | 12:KC2, TL;DR "Outside Telegram" | The FAQ "limits the Stars duty to 'the sale of digital goods and services inside Telegram apps'" | CORRECTED | [T2] The full answer: "To remain in compliance with Google's Payment Policies 1, 2 and 4 along with Apple's Review Guidelines 3.1.1, 3.1.1(a) and 3.1.3(b), your bot or mini app must use Telegram Stars for the sale of digital goods and services inside Telegram apps, regardless of any other web portals, apps, services or payment providers you may have set up outside the Telegram ecosystem." (fragments read in order) | Quote the whole sentence, "regardless …" clause included. It states a duty inside Telegram and does not grant anything outside. It is silent on unlocking web-bought items in the bot. It does cite Apple 3.1.3(b) (multiplatform), which matches the hybrid (c) reading. INTERPRETATION |
| 4 | 12:KC3 | @combot notice (May 2024): Apple cited 4.7 and 3.1.1; Stars-only "Starting on June 12"; "suspension of @combot for most of your customers" | CONFIRMED (label CLAIMED is right) | [A4] Forum post by Combot's CEO (handle Teodorix), "Created May '24", 0 replies; the three quotes match verbatim. Telegram never published the notice itself. [P1] T-J 2024-05-23: Telegram wrote to "owners of popular bots"; Stars-only from 12 June; Apple's warning was the reason. [T4] Telegram blog 2024-06-06: Stars "compliant with Apple and Google's latest policies on sales of digital products"; no deadline mentioned | Keep CLAIMED-primary-copy. Primary text of Telegram's letter: none public |
| 5 | 12:KC4 | Apple 3.1.3(b): web-acquired items accessible "provided those items are also available as in-app purchases within the app" | CONFIRMED | [A1] verbatim: "Apps that operate across multiple platforms may allow users to access content, subscriptions, or features they have acquired in your app on other platforms or your web site, including consumable items in multi-platform games, provided those items are also available as in-app purchases within the app." Read 2026-10-31, page undated | None |
| 6 | 12:KC4 | Apple 3.1.1 bans "license keys … QR codes" as unlock mechanisms | CONFIRMED | [A1] "Apps may not use their own mechanisms to unlock content or functionality, such as license keys, augmented reality markers, QR codes, cryptocurrencies and cryptocurrency wallets, etc." | None |
| 7 | 12:KC4, TL;DR | Anti-steering (3.1.1(a)/3.1.3) applies "in every storefront except the US" | CORRECTED | [A1] 3.1.1(a): entitlements let "apps on the App Store in specific regions" link out; "In all other storefronts, except for the United States storefront … may not include buttons, external links, or other calls to action". 3.1.3: "except for apps on the United States storefront and as set forth in 3.1.1(a) and 3.1.3(a)". [A2] StoreKit "External Purchase" doc lists entitlement programmes for the EU/EEA, Netherlands (dating), **Russia**, South Korea, Brazil, Japan | "Banned except on the US storefront **and in storefronts with an Apple entitlement**." Those entitlements belong to the host app's developer (Telegram), not to a mini app. Telegram's §6.2 bans alternative payments regardless (row 1). INTERPRETATION |
| 8 | 12:§1.4 | 4.7 covers "HTML5 and JavaScript mini apps and mini games … chatbots"; 4.7.1 "follow Guideline 3.1"; 4.7.5 age restriction | CONFIRMED | [A1] 4.7 and 4.7.1 verbatim as quoted. 4.7.5: an age restriction "based on verified or declared age". 4.7 states rejection of the host app as the consequence; nothing about removing individual mini apps | None |
| 9 | 12:TL;DR + §1.4 "Russia" | "No Russian storefront entitlement was found"; the FAS case brought "no rule change for Russia" | CORRECTED | [A2][A3] Apple documents "Distributing apps in Russia that provide an external purchase link" (request form `/contact/request/storekit-external-entitlement-ru/`). It names "the EEA and Russia" for single and multiple link-out implementations (doc © 2026). [P3] anti-malware.ru 2023-10-17: since Oct 2023 RU developers may link out; 27 % commission; links shown only to Russian users; Apple cited "a court ruling" (CLAIMED-press). [A5][A6] Apple forums, Apr 2026 and ~Oct 2026: the RU request form returns 500, or needs a Paid Applications Agreement that RU accounts cannot sign "due to applicable sanctions" (CLAIMED, no Apple reply) | Russia **has** an Apple link-out entitlement (since 2023-10), reportedly unusable by RU developer accounts in 2026. It helps only native apps that hold it. A Mini App cannot use it, and Telegram §6.2 still applies. INTERPRETATION |
| 10 | 12:§1.4 US | 2025-04-30 injunction; Ninth Circuit 2025-12 upheld contempt and allowed a commission; "Apple Supreme Court petition was pending in mid-2026" | STALE | [P4] Ninth Circuit ruled 2025-12-11: affirmed contempt, "vacated the complete commission ban", remanded. [P5] ipwatchdog 2026-06-30: Supreme Court **granted certiorari** (No. 25-1311). Per a Mealey's search snippet, the grant was limited to the contempt question. No merits decision found as of 2026-10-31 | "Cert granted 2026-06-30, merits pending." US-only, so no effect on this project |
| 11 | 12:TL;DR + §1.4 FAS | FAS 2022 anti-steering case "ended in a ₽1.18 bn fine, paid by 2024-01-22" | CORRECTED (date) | [P2] mobile-review 2024-01-22: violation found July 2022; fine 1,177,988,700 ₽ "уже поступили в бюджет" ("already received by the budget"); no rule change mentioned. [P6] vbr.ru 2023-10-18: the fine was imposed in **January 2023** | "Violation found 2022-07, fine ₽1.18 bn imposed 2023-01, paid by 2024-01; followed by Apple's RU link-out entitlement (2023-10)" |
| 12 | 12:KC5 | Romance Club sold via an official web shop by UID, accepting Russian cards (T-J 2023-09-29) | CONFIRMED (for 2023) | [P7] T-J 29.09.23 quotes: "Приложение не принимает карты российских банков, но оплатить алмазы и чай можно со счета мобильного телефона" ("the app does not accept Russian bank cards, but diamonds and tea can be paid from a mobile phone balance"); "через официальный онлайн-магазин" ("via the official online store"); "зарегистрироваться на сайте и указать UID" ("register on the site and enter the UID"); UID in settings, "Инструменты" ("Tools") tab. [P8] the linked domain on 2026-10-31 shows only a download page and a progress-transfer PDF; no shop | Present it as a **hybrid**: in-app store billing (mobile balance) ran alongside the web shop. That fits 3.1.3(b). It was a native app, not a Mini App. Current shop: gap |
| 13 | 12:TL;DR + §1.3 | RU providers in BotFather (ЮKassa, Sberbank, Smart Glocal) are for physical goods only (§6.1) | CONFIRMED as INTERPRETATION of the §6.1/§6.2 split; provider list UNSUPPORTED (the report says so) | [T1] §6.1 "Telegram does not process payments for physical goods and services"; third-party providers. §6.2 is Stars-only. [T3] payments page "covers payments for physical goods and services"; "Due to Apple's limitations, bot developers are currently not allowed to accept payments for digital goods and virtual services from iOS users"; names only Stripe. ЮKassa's page [V4] describes @YooKassaPaymentBot, not BotFather. Sberbank–BotFather integration is 2017 press only (search) | Keep it as an interpretation. Do not present the provider list as Telegram-documented |
| 14 | 12:KC6 | ЮKassa 2.8 % + 1 % per receipt, excl. VAT; promo 2026-01-28 → 2026-12-01; SBP individual; commission kept on refund | CONFIRMED | [V1] "2,8% + 1% за чек" ("2.8 % + 1 % per receipt") for cards; "с 28.01.2026 по 01.12.2026" ("from 28.01.2026 to 01.12.2026"), for new RU legal entities/ИП; "комиссию … + НДС от суммы комиссии. Ниже указаны комиссии без учёта НДС" ("commission … + VAT on the commission amount. Commissions below exclude VAT"); SBP "Рассчитаем индивидуально" ("calculated individually"). The reduced rate requires "Чеки от ЮKassa" ("Receipts from ЮKassa"). [V2] "Комиссия ЮKassa за проведение платежа не возвращается" ("ЮKassa's payment commission is not returned"); refunds 3 years; cards may be refused after 15 months | Minor: the promo line lists cards, ЮMoney, T-Pay, SberPay, Alfa Pay (Mir Pay is not in that line) |
| 15 | 12:KC7 | Robokassa ИП/ООО cards 3.9 %, SBP 2.7 % (start); VIP 2.9/1.8 % from 7 M ₽/month; self-employed 3.4 / 3.0 %; "НДС не облагается" ("not subject to VAT") | CONFIRMED | [V5] tables exactly as stated; "НДС не облагается"; payout "на следующий день" ("the next day"), request 1-3 business days. Read 2026-10-31 | None |
| 16 | 12:KC8 | Prodamus 3.8 % start → 2.9 % at ≥ 4 M ₽/month; ₽10,000 connection for ИП/legal entities; foreign cards 10 % (min 100 ₽) | CONFIRMED | [V6] "Изначально — 3,8%" ("initially 3.8 %"); tiers 3.5 / 3.3 / 3.1 / 2.9 % at 0.5 / 0.7 / 1 / 4 M ₽; "Стоимость подключения — 10 000 ₽" ("connection costs ₽10,000"); self-employed "Старт" ("Start") free; tier not lowered automatically. VAT on the fee not stated | Note: Prodamus VAT on the fee is unknown (row 33 range) |
| 17 | 12:KC9 | Acquiring lost its VAT exemption; 22 % on the fee from 2026-01-01; SBP not subject to VAT | CONFIRMED; label can be upgraded from CLAIMED-vendor | [R3] Minfin letter 24.12.2025 No. 03-07-05/126006, reproduced with FNS letter 30.01.2026 No. СД-36-3/674@ (consultant.ru): "с 1 января 2026 г. отменяется освобождение от налогообложения НДС" ("from 1 January 2026 the VAT exemption is cancelled") for services "связанных с обслуживанием банковских карт" ("related to bank-card servicing"). [P9] ppt.ru 2026-01-21: transfers "в том числе по СБП" ("including via SBP") stay exempt. [R2] FNS letter 29.12.2025 No. СД-4-3/11802@: the general rate is 22 % from 2026-01-01 (425-FZ of 28.11.2025). [V7] Yandex Pay blog 2026-06-03 agrees | Label DOCUMENTED (Minfin/FNS letters). Watch item: a Minfin official said on 2026-03-25 that VAT on SBP would be assessed by autumn (search snippet only) |
| 18 | 12:§3 VAT | General VAT rate 22 % from 2026 (425-FZ) | CONFIRMED | [R2] as row 17 | Label DOCUMENTED |
| 19 | 12:§3 VAT | УСН payers owe VAT above 20 M ₽ of 2025 income, then 15 M ₽ (2026 income), 10 M ₽ (from 2027 income) | STALE / conflicting | [R4] nalog.gov.ru (page updated 2026-08-05) still shows 20 / 15 / 10 M ₽. [P10] buhexpert8 2026-07-06 and [P11] Garant hotlaw: Federal Law **228-FZ (2026)** amended NK art. 145 and kept **20 M ₽** past 2026. Sources disagree whether 20 M ₽ holds through 2028 or 2029 (15 M ₽ and 10 M ₽ come later) | "20 M ₽ kept at least for 2027 (228-FZ, 2026); later steps conflicting; verify NK art. 145 on consultant/pravo.gov.ru" |
| 20 | 12:KC10 | 422-FZ art. 4 p. 2: item 8 income > 2.4 M ₽/year bars НПД; item 4 no employees; item 5 agency; ed. 2026-08-04 | CONFIRMED | [R1] consultant.ru "ред. от 04.08.2026" ("as amended 04.08.2026"); items 4, 5, 8 verbatim ("превысили … в текущем календарном году 2,4 миллиона рублей" ("exceeded … 2.4 million rubles in the current calendar year")); the experiment runs to 2028-12-31 | None |
| 21 | 12:§3 54-FZ | 54-FZ receipts for ИП/organisations; НПД exempt from cash registers, receipts via «Мой налог» under 422-FZ | CONFIRMED | [R5] consultant collection: exemption under **54-FZ art. 2 p. 2.2**; receipt "сформированный через приложение «Мой налог»" ("generated in the «Мой налог» app"), **422-FZ art. 14 part 1**. [V8] Robokassa: "Робочеки" ("Robo-receipts", agent scheme for ИП/ООО), "Робочеки СМЗ" ("Robo-receipts for the self-employed", «Мой налог»), and a cloud register | Add the article numbers |
| 22 | 12:KC14 | Bank of Russia: SBP "максимальный тариф не может превышать 0,7%" ("the maximum tariff cannot exceed 0.7 %", 2021); "current cap not re-confirmed" | CONFIRMED; the report's gap is closed | [R6] 2021-02-26 item: the quote is a regional CBR official's statement only, with no 0.4 % rate and no 1,500 ₽ cap. [R7] cbr.ru/PSystem/sfp/ (page updated **2026-02-06**): "для бизнеса размер комиссии не превышает 0,7%" ("for business the fee does not exceed 0.7 %"); 0.4 % for socially significant goods; 0.2 % for housing and utilities; "не превышает 1,5 тыс. рублей за операцию" ("does not exceed 1,500 rubles per operation"). [P12] nalog-nalog 2026-05-06: the 2026-03-27 decision is "по сути … не повышение" ("in substance … not an increase") | Cite [R7] (DOCUMENTED, 2026). Remove the gap line "current Bank of Russia merchant SBP caps" |
| 23 | 12:KC11 | RSB prohibited list item 8 "продажа интернет-контента эротического и порнографического характера" ("sale of erotic and pornographic internet content"); item 30 reputation | CONFIRMED | [V9] PDF (metadata 2018-06-20) read in full: item 8 "Проституция, продажа интернет-контента эротического и порнографического характера, интим товаров и услуг" ("prostitution, sale of erotic and pornographic internet content, intimate goods and services"). Item 30: goods whose sale "способна оказать негативное влияние на деловую репутацию Банка или международных платежных систем" ("may harm the business reputation of the Bank or international payment systems") | Keep "(one bank, 2018)" |
| 24 | 12:KC12 | Yandex Pay bans erotic/sexual services, access to pornography, sale of virtual currency | CONFIRMED with context | [V10] The list is introduced by "в подключении и/или использовании сервиса Яндекс Пэй может быть отказано" ("connection to or use of Yandex Pay may be refused"). Items: access to/sale of pornographic information; "Услуги и (или) работа интимного, эротического или сексуального характера" ("services or work of an intimate, erotic or sexual nature"). Item 32: "Материалы, передаваемые исключительно виртуально … (идеи, методы, принципы и т. д.)" ("materials transferred only virtually … (ideas, methods, principles, etc.)"). Item 33: "Игровое оборудование, используемое для проведения азартных игр, лотерейное оборудование, а также продажа виртуальной валюты" ("gambling equipment, lottery equipment, and the sale of virtual currency"). Activation codes and gift cards are a Yandex Split-only restriction. Undated | Say "may be refused" (not an absolute ban). The virtual-currency clause sits in the gambling item. Whether a hint balance counts is a question for the acquirer (INTERPRETATION) |
| 25 | 12:KC13 | SBP 45 % of small-business online orders by count, 37 % by turnover (Prodamus via TASS, 2026-09-10) | CONFIRMED (CLAIMED-vendor data) | [P13] 10.09.2026: 45 % by count; 37 % by value (36-37 % since March); ~2.5 M orders since the start of 2026 | None |
| 26 | 12:header | "no 2026 Bot API entry changes payments" | CORRECTED (minor) | [T5] Bot API 10.2 (2026-07-14): "Added updates about changes to a user payment subscription." 10.3 (2026-08-24) is the latest version | "Only 10.2's subscription-change update; nothing on the digital-goods rule" |
| 27 | 12:§1.1 | The FAQ cites "Google's Payments policy and Apple's guidelines (third-party software section)" | CORRECTED | [T2] It cites "Google's Payment Policies 1, 2 and 4" and "Apple's Review Guidelines 3.1.1, 3.1.1(a) and 3.1.3(b)", not 4.7 | Fix the citation (see row 3) |
| 28 | 12:§4 input (from 07) | RU App Store: 100 Stars = 209 ₽ (store listing, 2026-10-31) | UNSUPPORTED | [A7] apps.apple.com/ru Telegram listing refetched 2026-10-31 (also `?see-all=in-app-purchases`): the 10 IAP lines shown are Premium only; "Stars" or "звёзд" ("stars") appears nowhere. [A8] The US listing shows "100 Telegram Stars $1.99". 2026 guides (vc.ru, dtf.ru; CLAIMED) give 229-300+ ₽ for 100 Stars via the App Store | Mark CLAIMED or unverified. Test the price in the Telegram iOS app on a RU Apple ID |
| 29 | 12:§4 input | "90-100 ₽/$ as in 07" | CORRECTED | [R8] CBR official rate for **2026-10-31: 80.5573 ₽ per USD** (EUR 89.6603). 07 itself labels "$1 ≈ 90-100 ₽" an ASSUMPTION taken from AdsGram | Use 80.56 ₽/$ (CBR, 2026-10-31) |
| 30 | 12:TL;DR + §4 (i) | Stars via RU App Store ≈ 56-62 ₽ per 100 ₽; rubles ≈ 1.6× (1.55-1.75×) | CORRECTED | Recomputed (next section): **≈ 50 ₽** per 100 ₽ at 209 ₽ (≈ 46 ₽ at 229 ₽). Ruble rails keep **≈ 1.9-2.0×** as much (≈ 2.1-2.2× at 229 ₽), before TON conversion costs | Replace the numbers |
| 31 | 12:§4 (i-b) | @PremiumBot 50 Stars = 99 ₽ → ≈ 59-66 ₽ per 100 ₽ | CORRECTED | $0.65 × 80.5573 = 52.4 ₽ per 99 ₽ paid → **≈ 53 ₽** per 100 ₽ | Replace |
| 32 | 12:§4 (ii)-(iii) | Ruble rails net: SBP bank-direct ≈ 99.3; SBP via aggregator ≈ 97.0-97.3; ЮKassa card ≈ 95.4; Robokassa/Prodamus ≈ 96.1-96.2 | CONFIRMED | Inputs rows 14-17, 22. Arithmetic correct. Prodamus would be 95.4 if VAT is added to its fee (not stated) | Write the card band as 95.4-96.2 |
| 33 | 12:§4 caveat (from 09) | Funding a RU Apple ID degraded since 2026-04-01 | CONFIRMED (press) | [P14] zona.media 2026-04-01 and others: MTS, Beeline, MegaFon and T2 stopped Apple ID top-ups from phone balances on 2026-04-01 | Adds that route (i) is itself impaired for RU buyers |
| 34 | 12:§2(a) | ЮKassa webhooks redelivered for 24 h; non-200 = failure; re-check status and source IP | CONFIRMED | [V3] "в течение 24 часов" ("within 24 hours"), "ответьте кодом состояния HTTP 200" ("respond with HTTP status code 200"), "Проверьте текущий статус объекта" ("check the object's current status"), "Проверьте IP-адрес" ("check the IP address") | None |
| 35 | 12:§1.1 | Stars launch post 2024-06-06: "compliant with Apple and Google's latest policies"; "Purchases of physical products stay exactly the same" | CONFIRMED | [T4] verbatim, dated 2024-06-06 | None |
| 36 | 12:channel rows | Developer gets $0.013 per Star | CONFIRMED | [T1] §6.2.x: "Developers can receive an equivalent of 0.013 USD worth of rewards for each Telegram Star" | None |
| 37 | 12:channel row "Stars only" | "≈ 56-62 ₽ … (ANALYSIS on DOCUMENTED inputs, 2026-10-31)" | MISLABELLED | The FX input was an ASSUMPTION (07, AdsGram's "$1 ≈ 90-100 ₽"). The 209 ₽ input is not reproducible (row 28) | "ANALYSIS: $0.013 (DOCUMENTED) × CBR 80.56 (DOCUMENTED) ÷ store price (unverified)" |

## Arithmetic check

Inputs:
- $0.013 per Star, DOCUMENTED (Bot Developer Terms §6.2.x [T1]).
- USD/RUB 80.5573, DOCUMENTED (CBR, 2026-10-31 [R8]).
- RU App Store price for 100 Stars: 209 ₽ as used by the report (not reproducible on 2026-10-31, row 28). A 229 ₽ sensitivity case comes from 2026 guides (CLAIMED).
- Ruble fees from rows 14-17 and 22.

| Route | Computation | Net per 100 ₽ paid (pre-tax) | Report said |
|---|---|---|---|
| Stars, RU App Store, 209 ₽ / 100 Stars | 100 × $0.013 = $1.30 × 80.5573 = 104.72 ₽; 104.72 / 209 | **50.1 ₽** | 56-62 ₽ |
| Same at 229 ₽ / 100 Stars (CLAIMED price) | 104.72 / 229 | **45.7 ₽** | — |
| Report's own inputs (90-100 ₽/$, 209 ₽) | 117-130 / 209 | 56.0-62.2 ₽ (arithmetic right, FX input wrong) | 56-62 ₽ |
| Stars via @PremiumBot, 50 for 99 ₽ (CLAIMED) | $0.65 × 80.5573 = 52.36 ₽ / 99 | **52.9 ₽** | 59-66 ₽ |
| SBP bank-direct, ≤ 0.7 %, no VAT on SBP | 100 × (1 − 0.007) | **99.3 ₽** | 99.3 ₽ |
| SBP via Robokassa, 2.7 % (ИП) / 3.0 % (self-employed), "not subject to VAT" | 100 × (1 − 0.027 / 0.030) | **97.3 / 97.0 ₽** | 97.0-97.3 ₽ |
| Card via ЮKassa, (2.8 % + 1 %) + 22 % VAT on the fee | 3.8 % × 1.22 = 4.636 %; 100 − 4.636 | **95.4 ₽** | 95.4 ₽ |
| Card via Robokassa 3.9 % (no VAT) / Prodamus 3.8 % (VAT unknown) | 100 − 3.9; 100 − 3.8 (or 100 − 4.636 if VAT is added) | **96.1 / 96.2 ₽ (95.4 ₽)** | 96.1-96.2 ₽ |

- **Ratio, ruble rail to Stars per ruble paid.**
  - At 209 ₽: 95.4 / 50.1 = 1.90 to 99.3 / 50.1 = 1.98, so **≈ 1.9-2.0×**.
  - At 229 ₽: ≈ 2.1-2.2×.
  - The report's "≈ 1.6×" (1.55-1.75×) is too low.
- **A 100-Star chapter.**
  - A RU iOS buyer pays 209 ₽, and we receive **≈ 105 ₽** (report: 117-130 ₽).
  - The same 209 ₽ on a ruble rail nets 199.3-207.5 ₽ (report: 199-208 ₽, correct).
- **Not in any figure:**
  - TON → RUB conversion and withdrawal costs (lower the Stars side further).
  - The 21-day hold.
  - Income tax on either side (НПД 4 % / 6 %, УСН, etc.).
  - The 259-FZ question on receiving digital currency (lawyer item).
- **Break-even check.** The report's 56-62 ₽ needs 90-100 ₽/$. The CBR rate on 2026-10-31 is 80.56. A ruble weakening to ~90 would bring the report's band back, so the figure depends on the FX date.

## What the owner may and may not rely on

- **May rely on:** inside the bot or Mini App, digital goods (chapters, hints) are Stars-only. Telegram's own Terms §6.2 and Stars FAQ say so verbatim. Their stated sanctions are hiding from mobile/store versions, then termination (rows 1-2).
- **May rely on:** ЮKassa, Sberbank and other provider tokens are Telegram's physical-goods channel. Using one for chapters is the case §6.2 names (row 13, INTERPRETATION of the §6.1/§6.2 split).
- **May rely on:** Apple 3.1.3(b) and 3.1.1 as quoted. Telegram's FAQ itself cites 3.1.3(b). So "Stars inside + the same items also sold on our own website" is the pattern both texts describe; ruble-only items unlocked in the bot are not (rows 3, 5; INTERPRETATION).
- **May NOT rely on** "Telegram limits Stars to inside its apps, so outside is free". The FAQ says Stars apply inside "regardless" of outside portals. It does not say web-bought items may be honoured in the bot (row 3). A lawyer or Telegram support should confirm (c) before building.
- **May NOT rely on** "Russia has no Apple link-out exception". Apple has one since 2023-10, reportedly blocked for RU accounts in 2026. It changes nothing for a Mini App: only the host app could use it, and Telegram §6.2 applies anyway (rows 7, 9).
- **May rely on:** ruble rails keep ≈ 95-99 ₽ per 100 ₽ (rows 14-16, 22, 32). **May NOT rely on** "Stars keep 56-62 ₽" or "rubles ≈ 1.6×". At the CBR rate of 2026-10-31 it is ≈ 50 ₽ and ≈ 1.9-2.0×, before TON costs. The 209 ₽ store price itself is unverified (rows 28-30).
- **May rely on:** the 2026 tax facts. VAT is 22 %; acquiring fees carry VAT and SBP transfers do not (Minfin/FNS letters). The НПД cap is 2.4 M ₽ with no employees. НПД receipts go via «Мой налог» (rows 17-18, 20-21). **May NOT rely on** the УСН VAT step-down (15 M / 10 M): 228-FZ (2026) froze 20 M ₽ (row 19).
- **May rely on:** the SBP merchant cap. The Bank of Russia page (2026-02-06) states ≤ 0.7 % (0.4 % socially significant, ≤ 1,500 ₽ per operation). Aggregators charge 1.8-3.0 % (rows 15, 22).
- **May rely on (as risk, not rule):** at least two acquirer lists name erotic content. RSB 2018 is a ban; Yandex Pay's list is "may be refused". A sexual-content 18+ track on a ruble rail is likely to be refused (rows 23-24, INTERPRETATION).
- **May NOT rely on:** Romance Club's web shop as a live, rules-tested precedent. It is a 2023 press report about a native app that also sold through store billing. The shop is not found today (row 12).

## Sources

Telegram
- [T1] https://telegram.org/tos/bot-developers — Bot Platform Developer Terms §6.1, §6.2, §6.2.x, §9, §10; undated; read 2026-10-31. The contract.
- [T2] https://core.telegram.org/bots/payments-stars — Stars payments page and FAQ; undated; read 2026-10-31. The contract.
- [T3] https://core.telegram.org/bots/payments — physical-goods payments page; read 2026-10-31.
- [T4] https://telegram.org/blog/telegram-stars — Telegram blog, 2024-06-06.
- [T5] https://core.telegram.org/bots/api-changelog — Bot API 10.3 (2026-08-24), 10.2 (2026-07-14); read 2026-10-31.

Apple
- [A1] https://developer.apple.com/app-store/review/guidelines/ — 3.1.1, 3.1.1(a), 3.1.3, 3.1.3(a)/(b), 4.7-4.7.5; undated; read 2026-10-31 (first 100k chars; all cited sections inside).
- [A2] https://developer.apple.com/tutorials/data/documentation/storekit/external-purchase.md — StoreKit "External Purchase" (EEA and Russia link-outs; Brazil iOS 26.5; Japan iOS 26.2), © 2026.
- [A3] https://developer.apple.com/documentation/storekit/externalpurchaselink.md — links "Distributing apps in Russia that provide an external purchase link", © 2026.
- [A4] https://developer.apple.com/forums/thread/755947 — Combot CEO's post quoting Telegram's notice, "Created May '24".
- [A5] https://developer.apple.com/forums/thread/823088 — RU entitlement request form 500 error, Apr 2026 (CLAIMED).
- [A6] https://developer.apple.com/forums/thread/849726 — RU entitlement needs a Paid Applications Agreement unavailable "due to applicable sanctions", ~3 weeks old on 2026-10-31 (CLAIMED).
- [A7] https://apps.apple.com/ru/app/telegram-messenger/id686449807 — RU listing, refetched 2026-10-31; no Stars items shown.
- [A8] https://apps.apple.com/us/app/telegram-messenger/id686449807 — US listing, "100 Telegram Stars $1.99", 2026-10-31.

Russian law and regulator
- [R1] https://www.consultant.ru/document/cons_doc_LAW_311977/30ba0412dfedfe46e8061ea063246bac59da2b69/ — 422-FZ art. 4, ed. 2026-08-04.
- [R2] https://www.nalog.gov.ru/rn04/taxation/taxes/nds/16594097/ — FNS letter 29.12.2025 No. СД-4-3/11802@ (22 % from 2026-01-01; 425-FZ of 28.11.2025).
- [R3] https://www.consultant.ru/document/cons_doc_LAW_526101/d2496b0c8f6707051dbd62782c8990911b9084fd/ — Minfin letter 24.12.2025 No. 03-07-05/126006 with FNS letter 30.01.2026 No. СД-36-3/674@ (card-servicing exemption removed).
- [R4] https://www.nalog.gov.ru/rn25/taxation/taxes/nds_usn/ — УСН VAT thresholds 20/15/10 M ₽; page updated 2026-08-05.
- [R5] https://www.consultant.ru/law/podborki/samozanyatye_kassa/ — 54-FZ art. 2 p. 2.2; 422-FZ art. 14 p. 1; 2026 snapshot.
- [R6] https://www.cbr.ru/press/regevent/?id=10725 — CBR regional press item, 2021-02-26.
- [R7] https://www.cbr.ru/PSystem/sfp/ — CBR SBP page, updated 2026-02-06 (≤ 0.7 %, 0.4 %, 0.2 %, ≤ 1,500 ₽).
- [R8] https://www.cbr.ru/currency_base/daily/ and https://www.cbr.ru/scripts/XML_daily.asp?date_req=31/10/2026 — USD 80.5573, EUR 89.6603 for 2026-10-31.

Vendors
- [V1] https://yookassa.ru/fees/ — read 2026-10-31.
- [V2] https://yookassa.ru/developers/payment-acceptance/after-the-payment/refunds — read 2026-10-31.
- [V3] https://yookassa.ru/developers/using-api/webhooks — read 2026-10-31.
- [V4] https://promo.yookassa.ru/telegram_api — @YooKassaPaymentBot migration guide; image names hint 2025-03-06.
- [V5] https://robokassa.com/payments/tarify/ — read 2026-10-31.
- [V6] https://prodamus.ru/rates — read 2026-10-31.
- [V7] https://pay.yandex.ru/blog/articles/ekvajring-2026 — Yandex Pay blog, 2026-06-03.
- [V8] https://robokassa.com/solutions/business/cifrovye-tovary/ and https://robokassa.com/content/trebovaniya.html — read 2026-10-31.
- [V9] https://business.rsb.ru/upload/iblock/917/zapreshchennye-vidy-deyatelnosti-_internet_ekvayring_.pdf — RSB list, PDF metadata 2018-06-20.
- [V10] https://pay.yandex.ru/docs/ru/forbidden — Yandex Pay prohibited list, undated, read 2026-10-31.

Press and secondary (CLAIMED unless noted)
- [P1] https://t-j.ru/news/tg-stars/ — T-J, 2024-05-23.
- [P2] https://mobile-review.com/all/news/platit-i-kayatsya-apple-vyplatila-shtraf-v-12-mlrd-rublej-po-resheniyu-fas/ — 2024-01-22.
- [P3] https://www.anti-malware.ru/news/2023-10-17-114534/42125?page=12 — 2023-10-17, Apple RU link-out (27 %).
- [P4] https://digitalpolicyalert.org/event/39719-us-court-of-appeals-for-the-ninth-circuit-affirmed-contempt-finding-and-remanded-on-commission-rate-in-epic-games-v-apple — Ninth Circuit 2025-12-11.
- [P5] https://ipwatchdog.com/2026/06/30/high-court-grants-cert-in-apples-challenge-to-ninth-circuit-contempt-ruling-in-app-store-dispute/ — 2026-06-30.
- [P6] https://www.vbr.ru/novosti/banki/2023/10/18/oplacivat-app-store/ — 2023-10-18 (fine in Jan 2023).
- [P7] https://t-j.ru/romance-club/ — 2023-09-29.
- [P8] https://xn--80abwagddjkhv2ag.xn--p1ai/ — download page only, 2026-10-31.
- [P9] https://ppt.ru/amp/obzory/minfin/pozitsiya-minfina-rf-o-nds-na-ekvayring-protsessing-i-perevody-po-kartam-s-2026-goda — 2026-01-21.
- [P10] https://buhexpert8.ru/?p=743064 — 228-FZ, 20 M ₽ kept; 2026-07-06.
- [P11] https://www.garant.ru/hotlaw/federal/2154941/ — 228-FZ hotlaw page (text garbled on fetch).
- [P12] https://nalog-nalog.ru/raschety/sbp-s-1-maya-2026-chto-s-komissiyami-na-samom-dele/ — 2026-05-06.
- [P13] https://www.investfuture.ru/articles/po-dannym-prodamus-sbp-obespechivaet-45-onlayn-zakazov-malogo-biznesa-37897374 — 2026-09-10.
- [P14] https://zona.media/news/2026/04/01/apple-id — 2026-04-01 (search result; corroborated by several outlets in the same search).
- Pointers only (not relied on): vc.ru and dtf.ru 2026 Stars price guides (229-400 ₽ per 100 Stars, inconsistent).
