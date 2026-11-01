# Promotion research 12: a Russian payment system instead of (or next to) Telegram Stars

Date 2026-10-31. Sources read: 33 pages opened, plus search snippets labelled as such. Freshness notes: Bot API 10.3
(changelog 2026-08-24) is the latest; no 2026 Bot API entry changes payments [33]. Telegram's payments pages and
Bot Developer Terms carry no revision date (read 2026-10-31). Apple App Review Guidelines read 2026-10-31 (no date on the
page). Vendor tariff pages read 2026-10-31. Russian law editions: 422-FZ ed. 2026-08-04.

Owner request (verbatim): «Рассмотри возможность вместо звездочек подключить российскую платежную систему» ("consider
connecting a Russian payment system instead of Stars"). This report states facts against CLAUDE.md principles 0, 1, 2
and 6. It does not redesign them. Legal content is **INTERPRETATION, not legal advice**.

## TL;DR (decision-relevant)

- **"Instead of Stars" inside the bot or Mini App is forbidden by Telegram's terms as written.**
  - Bot Developer Terms §6.2: digital goods "must be executed exclusively through the exchange of Telegram Stars" and
    "cannot be processed through third-party payment providers". A developer found using "alternative payment systems"
    may get a notice. If it is ignored, Telegram "may have to make your TPA inaccessible from store versions of Telegram
    or terminate it from Bot Platform" [2].
  - The Stars page: "Telegram cannot display your bot or mini-app to mobile users if you attempt to sell digital goods
    and services via other currencies or through third-party payment providers" [1]. DOCUMENTED.
  - The rule has been enforced before. In May 2024 Telegram told @combot that Apple had flagged it under guidelines 4.7
    and 3.1.1. Non-compliance after 2024-06-12 would mean "the suspension of @combot for most of your customers"
    (notice quoted by the bot's CEO) [6]. CLAIMED-primary quote.
  - No 2025-2026 case of a bot hidden for ruble payments was found (gap).
- **Russian providers in BotFather (ЮKassa, Sberbank, Smart Glocal) are for physical goods and services only.** The
  Terms split payments into §6.1 "Physical Goods and Services" (third-party providers) and §6.2 "Digital Goods"
  (Stars only) [2][3]. Chapters and hints are digital goods under Apple's definitions, which Telegram adopts [2][8].
- **Apple's rules reach us through Telegram and give Russia no exception.**
  - Guideline 4.7.1 makes mini apps "follow Guideline 3.1" [8].
  - 3.1.1 bans unlocking content with "license keys … QR codes" [8].
  - 3.1.1(a)/3.1.3 ban in-app buttons, links or "other calls to action" to other purchase methods in every storefront
    except the US [8].
  - The 2025 US court changes and the EU DMA entitlements do not cover Russia. The 2022 FAS case against Apple's
    anti-steering rules ended in a ₽1.18 bn fine, paid by 2024-01-22, with no rule change for Russia found [11].
- **Outside Telegram is where a ruble route can live.**
  - Telegram's FAQ limits the Stars duty to "the sale of digital goods and services inside Telegram apps" [1].
  - Precedent: Romance Club (Russian cards refused in the app) sold diamonds "через официальный онлайн-магазин" ("via
    the official online store"), keyed to a UID shown in the app's settings (T-J, 2023-09-29) [29].
  - INTERPRETATION: Apple 3.1.3(b) lets a multiplatform app unlock web-bought content only if those items "are also
    available as in-app purchases within the app". A **hybrid** (Stars in the bot + a ruble website) fits that pattern.
    A ruble-only setup with no Stars does not.
- **Money per 100 ₽ the buyer pays (ANALYSIS, pre-tax).**
  - Stars bought on the RU App Store: ≈ 56-62 ₽, then TON exchange costs (unresearched).
  - SBP via an aggregator: ≈ 97 ₽. SBP bank-direct (≤ 0.7 %): ≈ 99 ₽.
  - A card via ЮKassa / Robokassa / Prodamus: ≈ 95-96 ₽.
  - Rubles roughly **1.6×** Stars per ruble paid. No source gives payment-method conversion for Russia. SBP carries
    45 % of small-business online orders by count (Prodamus data via TASS, 2026-09-10, CLAIMED) [28].
- **Prerequisites and risks a ruble route adds:**
  - A Russian-resident ИП, ООО or самозанятый (НПД: income cap 2.4 M ₽ a year, no employees) [26][17][18].
  - 54-FZ receipts.
  - 22 % VAT on acquiring fees since 2026-01-01 (SBP excluded; vendor blog) [25].
  - Acquirers' prohibited lists name **erotic content**: "продажа интернет-контента эротического … характера" ("sale of
    erotic internet content", Russian Standard Bank list) [21]; Yandex Pay bans erotic services and access to
    pornography [22]. **The 18+ track (R5) is the part least likely to get ruble acquiring.**
- **A ruble route makes us the minor's direct counterparty** (14-17, R4). Civil Code art. 26/175 then applies to our own
  offer, not to Apple's or the reseller's (INTERPRETATION; law text in 09 §3).

## Findings

### 1. Telegram's rule for digital goods, and Apple's rules as Telegram imports them

#### 1.1 Telegram's text (DOCUMENTED, pages undated, read 2026-10-31)

- **Stars page, step 1:** "all transactions must be carried out in Telegram Stars, with currency tag `XTR`" [1].
- **Stars page FAQ** [1]:
  - "Can I use a different currency or payment provider?" Answer: "Payments for digital goods and services must be
    carried out exclusively in Telegram Stars." And: "If you're selling physical goods or services, you may use
    different currencies or payment providers."
  - "I run my own website to process sales, does this mean I don't have to use Telegram Stars?" Answer: "your bot or
    mini app must use Telegram Stars for the sale of digital goods and services inside Telegram apps". It cites Google's
    Payments policy and Apple's guidelines (third-party software section).
  - Crypto: "All payments via bots and mini apps for digital goods and services inside Telegram apps must exclusively
    use Telegram Stars".
  - Consequence: "Due to these rules, Telegram cannot display your bot or mini-app to mobile users if you attempt to
    sell digital goods and services via other currencies or through third-party payment providers."
- **Bot Developer Terms §6** [2]:
  - §6.1 Physical Goods and Services: "Telegram does not process payments for physical goods and services." Developers
    use third-party providers directly. §6.1.2 says compliance with the provider's terms is "solely your
    responsibility".
  - §6.2 Digital Goods and Services:
    - Sales must be "executed exclusively through the exchange of Telegram Stars". They "cannot be processed through
      third-party payment providers", because of app-store requirements.
    - "Telegram must adhere to Apple and Google's definitions of digital goods and services", which developers should
      check directly. The Terms give no definition or examples of their own.
    - "If your TPA is found to be using alternative payment systems for digital goods and services, you may receive a
      notice." Ignoring it can lead to: "we may have to make your TPA inaccessible from store versions of Telegram or
      terminate it from Bot Platform".
  - §6.2.1: full refunds through the Bot API with no penalty; `/paysupport` is mandatory. Unresolved legitimate disputes
    can bring Star debits, removal, a public SCAM label or account termination.
  - §9: comply with Apple and Google store guidelines. §10: non-compliance may lead to a temporary or permanent ban; the
    TPA becomes "partially or fully inaccessible".
- **Physical-goods payments page:** "This page covers payments for **physical goods and services**." FAQ: "Due to
  Apple's limitations, bot developers are currently not allowed to accept payments for digital goods and virtual
  services from iOS users" [3].
  - The page names **no** provider list, only Stripe as an example and "over 20 providers". A provider token comes from
    @BotFather → Bot Settings → Payments → the provider's bot [3].
- **Mini Apps ToS** (the user-facing terms): Telegram "only provides SP with access to third-party payment providers via
  its Payment Platform"; disputes and refunds go to the service provider. It does not mention Stars or digital
  goods [4].
- **Stars launch post** (2024-06-06): Stars are "compliant with Apple and Google's latest policies on sales of digital
  products"; "Purchases of physical products stay exactly the same" [5].

#### 1.2 Enforcement evidence

- **May 2024, @combot.** An Apple Developer Forums post by Combot's CEO quotes Telegram's notice [6]:
  - "Apple has informed Telegram that @combot is in violation of App Review Guidelines 4.7 and 3.1.1, because it
    accepts payments for digital goods and services directly from customers without relying on Apple's in-app purchase
    mechanism."
  - "Starting on June 12, all payments for digital goods and services in bots and mini apps will have to be carried
    out exclusively in Telegram Stars … failure to comply with these changes will result in the suspension of @combot
    for most of your customers."
  - Label: CLAIMED (the forum post is the recipient's own copy; the thread has no reply).
- **T-J (2024-05-23)** reported the same letter to "owners of popular bots", with the 12 June date and Apple's warning
  as the reason [7]. CLAIMED-press.
- **Telegram's official @BotNews channel:** no post on this transition was found (fetched 2026-10-31) [33].
- **A Russian developer's account (Habr):** he used ЮKassa via native Telegram Payments and moved to Stars by his own
  choice. For larger turnover or ruble payouts he still considers ЮKassa "надёжнее" ("more reliable"). His "Telegram
  gives the developer ~70 %" is unsourced. The post shows "10 July" with no year [31]. CLAIMED.
- **Gap:** no 2025-2026 report of a bot or Mini App hidden from mobile or terminated for ruble or card payments was
  found (two searches).

#### 1.3 Russian providers reachable through BotFather (for physical goods)

- ЮKassa: selectable in BotFather's Payments list, with test and live tokens (Habr, search snippet). ЮKassa's own page
  says that after reconnecting the shop through the API, a bot accepts "банковскими картами, кошельком ЮMoney и с
  помощью SberPay" ("bank cards, the YooMoney wallet and SberPay") [16]. Neither page says anything about digital goods.
- Sberbank: needs a merchantLogin from internet acquiring (Habr 2021, search snippet).
- Smart Glocal: official connection guide (search snippet only, page not opened).
- T-Bank, Robokassa and Prodamus appear in third-party bot builders, not confirmed in BotFather (search snippet).
- **No complete BotFather provider list exists on core.telegram.org [3] (gap).** Under §6.1/§6.2 none of these may take
  payment for chapters or hints [2].

#### 1.4 Apple, as imported by Telegram (DOCUMENTED, guidelines read 2026-10-31) [8]

- **4.7** covers "HTML5 and JavaScript mini apps and mini games … chatbots": "You are responsible for all such software
  offered in your app". 4.7.1: such software must "follow Guideline 3.1 in order to offer digital goods or services to
  end users". 4.7.5 requires an age-restriction mechanism (that is 10's topic).
- **3.1.1:**
  - Unlocking "access to premium content … you must use in-app purchase".
  - "Apps may not use their own mechanisms to unlock content or functionality, such as license keys, augmented reality
    markers, QR codes, cryptocurrencies and cryptocurrency wallets, etc."
- **3.1.1(a):** link-out entitlements exist "in specific regions". "In all other storefronts, except for the United
  States storefront … apps and their metadata may not include buttons, external links, or other calls to action that
  direct customers to purchasing mechanisms other than in-app purchase."
- **3.1.3:**
  - Apps in this section "cannot, within the app, encourage users to use a purchasing method other than in-app
    purchase, except for apps on the United States storefront".
  - "Developers can send communications outside of the app to their user base about purchasing methods other than
    in-app purchase."
- **3.1.3(b) Multiplatform Services:** apps "may allow users to access content … they have acquired … on other
  platforms or your web site, including consumable items in multi-platform games, provided those items are also
  available as in-app purchases within the app".
- **3.1.3(a) Reader apps** cover "magazines, newspapers, books, audio, music, and video". INTERPRETATION: an interactive
  game inside a host app is not that category, and Telegram's terms require Stars regardless.
- **What changed in 2025-2026, and whether it helps in Russia:**
  - **US.** The guideline text itself now exempts the US storefront from the anti-steering bans [8].
    - Per search snippets (pages not opened): the 2025-04-30 injunction barred commissions on link-outs. On
      2025-12 the Ninth Circuit upheld contempt but let Apple seek a cost-based commission, remanding the rate. An
      Apple Supreme Court petition was pending in mid-2026.
    - CLAIMED-snippet.
  - **EU and others.** Apple's documentation (search snippet) lists custom purchase-link regions via ISO codes,
    including Brazil (iOS 26.5) and Japan (iOS 26.2) besides the EU. EU link-out fee figures conflict between 2025 and
    2026 secondary sources. CLAIMED-snippet.
  - **Russia.** No Russian storefront entitlement was found.
    - FAS found in 2022 that Apple banned informing users about payment outside the App Store and required removal of
      links. The ₽1,177,988,700 fine was paid (mobile-review, 2024-01-22) [11].
    - The article reports no rule change for Russia, and the current guideline text has no Russian carve-out [8].
  - INTERPRETATION: even a US- or EU-storefront freedom would bind Telegram's own app. Telegram's §6.2 is
    storefront-agnostic, so a link-out from a Mini App stays a breach of Telegram's terms everywhere.
- **Google Play.** The Payments policy does not apply to payments from users in Russia (since 2022-08-02), and Play
  billing has been paused there since 2022-03-10. Both facts come from 09 §1.2 [39], citing Google's pages.
  - Telegram's §6.2 does not carve Russia out.
  - The direct-APK, Desktop and Web clients are not "store versions" in §6.2's first sanction. The second sanction,
    termination from Bot Platform, covers every client [2]. INTERPRETATION.

### 2. The options

Each option below: mechanism, Telegram's rule, steering, iOS / Android / Desktop, refund or chargeback, and fit with
principles 0, 1, 2 and 6. All rule readings are INTERPRETATION.

#### (a) Russian payments inside the Mini App (ЮKassa widget, SBP QR or deeplink, T-Pay, SberPay)

- **Mechanism:**
  - ЮKassa's widget is a "готовая платежная форма" ("ready-made payment form") embedded on a page. It needs a
    server-created payment and a short-lived token, and supports cards, SberPay, T-Pay, SBP, Mir Pay and others [15].
  - Alternatively, a provider_token invoice through Telegram Payments [3].
  - Mobile behaviour of SBP inside the widget is not described [15]. Opening a bank app from Telegram's WebView is not
    documented anywhere found. `openLink` opens "an external browser. The Mini App will *not* be closed" [32]. Gap: test.
- **Telegram's rule:** a direct breach of §6.2 ("cannot be processed through third-party payment providers") and of
  the FAQ [1][2]. A provider-token invoice for a chapter is the case §6.2 names.
- **Apple / iOS:** it falls under 4.7.1 → 3.1.1, the @combot pattern [6][8]. The stated sanction is invisibility to
  mobile users or inaccessibility from store versions, then termination [1][2].
- **Android:** Google's policy is lifted for RU users [39], but Telegram's terms are not.
- **Desktop/Web:** not "store versions", but §10 termination covers everything [2].
- **Refunds:** ЮKassa refunds go to the original instrument, within 3 years for most methods (cards may be refused
  after 15 months). The commission is not returned on refund [13]. Card chargebacks follow the issuer's rules (not
  researched). SBP has no classic chargeback; a buyer can dispute through their own bank within 180 days, and the
  merchant's bank decides (press, CLAIMED) [36].
- **Principles:**
  - Principle 2: contradicts "Stars only" as written.
  - Principles 0 and 1 can hold: grant on the provider's `payment.succeeded` webhook after re-checking status and the
    IP allowlist. ЮKassa redelivers for 24 h and treats non-200 as failure [14]. Idempotence is ours (UNIQUE on the
    provider payment id, the analogue of `charge_id`).
  - Principle 6: a second payment adapter over plain HTTP; no SDK is required [14][15].

#### (b) Payment on our own website, outside Telegram; entitlement keyed to the Telegram user id

- **Precedent, Romance Club (T-J, 2023-09-29)** [29]:
  - The app "не принимает карты российских банков" ("does not accept Russian bank cards"). Players paid from a mobile
    balance or "через официальный онлайн-магазин" ("through the official online store").
  - "Чтобы совершить платеж, нужно зарегистрироваться на сайте и указать UID" ("to pay, register on the site and enter
    the UID"). The UID is visible in the app's settings, tab «Инструменты» ("Tools"). The shop "принимает карты
    российских банков" ("accepts Russian bank cards").
  - The studio left the RU stores in 2024-06 (05 §2a).
  - The domain linked by T-J showed only an app download page with an iOS PDF guide on 2026-10-31. No shop was visible
    [30], so the current shop URL is a gap.
  - No source on rule problems or how players learned of the shop (gap).
- **Identity:** Telegram's Login (now an OpenID Connect flow; the legacy widget is "archived") needs a bot. It returns
  an `id_token` (`sub`; with the `profile` scope `id`, `name`, `preferred_username`, `picture`). Telegram "will only
  process logins or redirect users using your pre-registered URLs" [34]. The page does not say whether `id` equals the
  initData user id (gap: test-bot check).
- **Telegram's rule:**
  - The FAQ ties the Stars duty to sales "inside Telegram apps" [1], and the website sale is outside them.
  - Telegram's text says nothing about honouring web-bought content inside the bot. §6.2's "found to be using
    alternative payment systems" is broad enough to be read against it [2].
- **Apple:**
  - 3.1.3(b) allows access to web-bought items only if they are "also available as in-app purchases within the app" [8].
    A ruble-only catalogue with no Stars price fails that condition. Stars kept in parallel meets it (option c).
  - Any link, button or "call to action" to the website inside the Mini App breaches 3.1.1(a) and 3.1.3 outside the US
    storefront [8], and probably also Telegram's §6.2.
  - Communications "outside of the app" are allowed by 3.1.3 [8]. Whether a Telegram channel post or a bot chat message
    counts as "outside the app" is unclear: both are inside Telegram's app (gap; lawyer or Telegram support).
  - Showing a player id in settings, as Romance Club did, is not by itself a purchase call to action. INTERPRETATION.
- **Platforms:** the purchase happens in a browser on any OS. The entitlement shows up in every Telegram client.
- **Reachability:** a site hosted in Russia is reachable without VPN and in mobile whitelist mode (whitelisting
  requires RU servers, 09 §4) [39]. That is a plus for the payment page. 152-FZ applies (Q21).
- **Refunds:** the provider's refund API [13]; SBP disputes as in (a) [36]. The consumer-law basis is ZoZPP art. 32 (a
  service may be refused against actual costs; research_M4 §4) [39]. In practice the offer and `/terms` carry the rule.
- **Principles:**
  - Principle 2: Stars are not used for these sales. Whether principle 2 forbids them depends on reading "Stars only" as
    in-Telegram only.
  - Principles 0 and 1: the server grants on the provider webhook, keyed to the Telegram id from the login [14][34].
  - Principle 6: a website, a login flow and a provider adapter, all outside the Mini App module.

#### (c) Hybrid: Stars inside Telegram + website payments for Russian players

- **Mechanism:** (b) plus the existing Stars invoices. Every item sold on the site also has a Stars price.
- **Rules:**
  - This is the shape Apple 3.1.3(b) describes ("provided those items are also available as in-app purchases") [8].
  - Telegram's FAQ addresses only sales inside Telegram apps [1].
  - The remaining exposure is steering: any in-app pointer to the site [8][2].
  - Telegram states no price-parity rule, and Apple's guidelines as read set none.
- **Platforms:** the same as (b). iOS users can still buy in-app with Stars.
- **Principles:** principle 2 stays literally true inside Telegram. Principles 0 and 1 need one entitlement table fed by
  two grant paths, `successful_payment` and the provider webhook, each idempotent on its own provider id.

#### (d) A code or voucher sold elsewhere (Boosty, VK Donut, a marketplace) and redeemed in the bot

- **Apple 3.1.1** names "license keys … QR codes" as forbidden unlock mechanisms [8]. A redemption field in a Mini App
  shown on iOS is that pattern. Telegram's FAQ makes Stars mandatory "regardless" of outside portals [1][2].
  INTERPRETATION: the highest-risk option inside the app.
- **Selling venues:**
  - Boosty supports 18+ content with author marking and user age confirmation, and one-off paid posts (T-J, undated,
    search snippet; Boosty's own rules not opened) [37].
  - Yandex Pay (used by many shops) bans selling "кодов активации и/или подарочных карт" ("activation codes and/or gift
    cards") with Yandex Split only, and bans "продажа виртуальной валюты" ("sale of virtual currency") in its general
    list [22].
  - Ozon's rules for digital codes were not found (gap).
  - VK Mini Apps/Games allow virtual goods only for VK votes (08 §3) [39].
- **Refunds:** the venue's rules plus revoking the code. Gap.
- **Principles:** the server must keep code issuance and single redemption (a UNIQUE code row). Principle 2 as in (b).

### 3. Russian merchant requirements

- **Who may accept payments:**
  - Robokassa: "Работаем с ИП, юридическими лицами, самозанятыми и благотворительными организациями" ("we work with
    sole proprietors, legal entities, the self-employed and charities") [18]; the same for digital goods [19].
  - ЮKassa's reduced-rate offer is for "new Russian legal entities and sole proprietors" [12]. Its self-employed plan
    exists in navigation, with no rates shown [12].
  - Prodamus: self-employed (free start), ИП and legal entities (₽10,000 connection) [20].
  - A non-resident operator was not found eligible on any page read. INTERPRETATION: a ruble route needs a Russian
    resident (ties to Q21).
- **НПД (self-employed), 422-FZ ed. 2026-08-04, art. 4 p. 2** [26]. The regime is barred for:
  - persons with employees (item 4);
  - persons acting in another's interest under agency or commission contracts (item 5);
  - persons whose income "превысили в текущем календарном году 2,4 миллиона рублей" ("exceeded 2.4 million rubles in
    the current calendar year", item 8).
  - DOCUMENTED. Per tax press, the cap has been unchanged since 2019 and the regime runs to 2028-12-31 (search snippet).
  - ANALYSIS: 2.4 M ₽ ≈ 12,000 sales of a 200 ₽ chapter a year.
- **54-FZ receipts:**
  - Cash-register use is mandatory for organisations and ИП at settlements, and internet card payment counts as a
    settlement (Garant, search snippet).
  - Provider services that cover it:
    - "Чеки от ЮKassa" ("Receipts from ЮKassa"), +1 % in the promo tariff [12];
    - Robokassa's "Робочеки" ("Robo-receipts"), an agent scheme for ИП/ООО without their own register or fiscal
      drive [19];
    - a cloud register [19];
    - for НПД, "Робочеки СМЗ" ("Robo-receipts for the self-employed"), integrated with «Мой налог» [19]. The НПД
      receipt duty comes from 422-FZ.
  - DOCUMENTED-vendor.
- **Fees (read 2026-10-31; the date is the read date unless stated):**

| Provider | Cards | SBP | Notes | Label |
|---|---|---|---|---|
| ЮKassa | 2.8 % + 1 % "за чек" (receipt service) for cards, SberPay, T-Pay, YooMoney, Alfa Pay, Mir Pay | "Рассчитаем индивидуально" ("calculated individually") | Rates exclude VAT; VAT is added to the fee. Promo for new RU legal entities/ИП 2026-01-28 → 2026-12-01. > 5 M ₽/month: individual terms. Commission not returned on refund [12][13] | DOCUMENTED-vendor |
| Robokassa, ИП/ООО | 3.9 % (start) → 2.9 % (VIP, ≥ 7 M ₽/month) | 2.7 % → 1.8 % | "НДС … не облагается" ("not subject to VAT") per the page. Payout from the next day; a request takes 1-3 business days [17] | DOCUMENTED-vendor |
| Robokassa, self-employed | 3.4 % | 3.0 % | Payout automatic; timing not stated [17] | DOCUMENTED-vendor |
| Prodamus | 3.8 % (cards and SBP) → 2.9 % at ≥ 4 M ₽/month; foreign cards 10 % (min 100 ₽) | in the same rate | ₽10,000 connection for ИП/legal entities; free start for the self-employed; tier changes on request only [20] | DOCUMENTED-vendor |
| CloudPayments | 2.6 % calculator example; real rate by contract | — | Aggregator summary; official tariff page returned 404 | CLAIMED |
| T-Bank | "individually" | — | tbank.ru failed TLS from this machine; aggregator only | CLAIMED / gap |
| SBP, bank-direct | — | Max 0.7 % (Bank of Russia official, 2021-02-26) [23]; 0.4-0.7 % "vs 1.5-2.5 % for acquiring", SBP not subject to VAT (Yandex Pay blog, 2026-06-03) [25] | Interbank tariffs fixed by a Bank of Russia decision of 2026-03-27 from 2026-05-01, "по сути это не повышение" ("in substance not an increase"; tax press, 2026-05-06) [24]. The merchant rate is set by the merchant's bank by MCC (Consultant collection) | DOCUMENTED (2021) / CLAIMED (2026) |

- **VAT:**
  - Acquiring services lost their VAT exemption under 425-FZ; 22 % on the fee from 2026-01-01 (Yandex Pay blog
    2026-06-03, citing the law) [25]. CLAIMED-vendor citing law.
  - The general rate is 22 % from 2026. УСН payers owe VAT above 20 M ₽ of 2025 income (15 M ₽ for 2026, 10 M ₽ from
    2027), per several tax-press snippets citing 425-FZ [27]. CLAIMED-secondary; verify on consultant.ru.
  - A **foreign** seller of e-services to Russian individuals pays Russian VAT itself (NК art. 174.2 p. 3; Kontur
    snippet, page 403; Consultant notes p. 5 was amended by 425-FZ) [41]. Whether games fall in the art. 174.2 list was
    not verified (gap).
- **Erotic / 18+ content in acquirers' rules:**
  - Russian Standard Bank, internet-acquiring prohibited list (PDF dated 2018-06-20), item 8: "Проституция, продажа
    интернет-контента эротического и порнографического характера, интим товаров и услуг" ("prostitution, sale of
    erotic and pornographic internet content, intimate goods and services"). Item 30 adds goods whose sale "способна
    оказать негативное влияние на деловую репутацию Банка или международных платежных систем" ("may harm the
    reputation of the Bank or international payment systems") [21]. DOCUMENTED (one bank, old document).
  - Yandex Pay prohibited list (undated, "may be changed unilaterally") bans [22]:
    - "Предоставление доступа к информации порнографического характера или ее продажа" ("providing access to
      pornographic information or selling it");
    - "Услуги и (или) работа интимного, эротического или сексуального характера" ("services or work of an intimate,
      erotic or sexual nature");
    - "продажа виртуальной валюты" ("sale of virtual currency");
    - and, in the same general list, "материалы, передаваемые исключительно виртуально" ("materials transferred only
      virtually", paraphrased by the reader as ideas, methods, principles).
    - DOCUMENTED.
  - Alfa-Bank's article lists "видео- и фотоэротика, порнография" ("video and photo erotica, pornography") as prohibited
    for internet acquiring (search snippet; the page failed TLS).
  - Robokassa's requirements page asks 18+ shops for an age-restriction page with confirmation (banner, checkbox or
    birth date). It gives no erotica clause [18].
  - ЮKassa's prohibited list was not found (three searches; gap).
  - INTERPRETATION: the R5 18+ track with erotic scenes falls inside the erotic-content prohibitions of at least two
    providers' lists. The 16+ main line does not.

### 4. Economics and conversion

**Net per 100 ₽ paid by the buyer, before income tax** (ANALYSIS on the labelled inputs; 90-100 ₽/$ as in 07):

| Route | Inputs | Net to us per 100 ₽ | Extra costs / caveats |
|---|---|---|---|
| (i) Stars bought on the RU App Store | 100 Stars = 209 ₽ (store, 2026-10-31) → $1.30 cash ($0.013/Star) (07 §2) | **≈ 56-62 ₽** | TON withdrawal and exchange costs not researched. 21-day hold; ≥ 1,000 Stars to withdraw. Unspent pack leftovers earn nothing. Funding a RU Apple ID is degraded (09 §1) |
| (i-b) Stars via @PremiumBot, if it works | 50 Stars = 99 ₽ (2024-25, CLAIMED) → $0.65 | ≈ 59-66 ₽ | Availability for Russian cards contradicted since 2026-04-01 (09 §1.2) |
| (ii) SBP, bank-direct | ≤ 0.7 % [23][25] | **≈ 99.3 ₽** | Receipts (54-FZ); merchant bank by MCC; no chargeback but bank disputes [36] |
| (ii-b) SBP via aggregator | Robokassa 2.7 % (ИП start) / 3.0 % (self-employed) [17] | ≈ 97.0-97.3 ₽ | Receipts included per Robokassa [19] |
| (iii) Card via ЮKassa | 2.8 % + 1 % receipt, + 22 % VAT on the fee ≈ 4.64 % [12][25] | **≈ 95.4 ₽** | Promo until 2026-12-01; fee kept on refunds [13] |
| (iii-b) Card via Robokassa / Prodamus | 3.9 % / 3.8 % [17][20] | ≈ 96.1-96.2 ₽ | Prodamus ₽10,000 connection (ИП) |

- **Reading:** per ruble paid, a ruble route keeps ≈ 1.55-1.75× what a Stars purchase keeps. Equivalently, a chapter
  priced at 100 Stars (209 ₽ to an iOS buyer) nets ≈ 117-130 ₽, while the same 209 ₽ via SBP or card nets ≈ 199-208 ₽.
  Tax applies on both sides and is not modelled. Income received in TON raises a separate question (Russian law bars
  accepting digital currency as payment for goods, 259-FZ art. 14 p. 5, secondary sources only [40]). Whether a Stars
  payout in TON falls under it is a lawyer item.
- **Conversion side** (no measured comparison found):
  - Buying Stars from Russia is degraded on every route (09 §1): App Store funding cut 2026-04-01, Google Play billing
    paused since 2022, @PremiumBot contradicted, Fragment crypto-only, resellers outside the Stars ToS.
  - SBP's share of paid online orders of small businesses was 45 % by count and 36-37 % by turnover in 2026 (Prodamus
    data on ~2.5 M orders, TASS 2026-09-10) [28]. CLAIMED-vendor data.
  - Tochka (search snippet; the page failed TLS) put cards at 73 % of payments by May 2026. The average SBP payment was
    4.2 K ₽ against 1.1 K ₽ by card (median 800 ₽ vs 370 ₽). CLAIMED.
  - No source gives invoice-to-paid conversion by payment method in Russia (gap).
  - INTERPRETATION: a ruble route outside Telegram swaps one friction (getting Stars) for another (leaving Telegram for
    a browser, logging in, paying). Which is larger is unmeasured. The 07/09 metric "invoice opened → paid by language"
    is the only way to know.

## Channel rows (for the synthesis table)

| Channel | Cost (with currency, date, label) | Effort | Fit for a Russian-first romance VN for girls in a TMA | Evidence quality (A primary/measured, B documented-but-vendor, C anecdotal) | Notes |
|---|---|---|---|---|---|
| Stars only (baseline, principle 2) | Developer gets $0.013/Star. ≈ 56-62 ₽ net per 100 ₽ paid on the RU App Store (ANALYSIS on DOCUMENTED inputs, 2026-10-31) plus TON exchange costs | None (built) | Compliant everywhere. RU buyers face degraded Stars purchase routes (09) | A (Telegram terms) / B (prices) | The only route Telegram's §6.2 allows inside the bot |
| (a) RU provider inside the Mini App (ЮKassa widget, SBP, T-Pay, SberPay, or a provider_token invoice) | Cards ≈ 3.8-4.6 % incl. VAT; SBP ≤ 0.7 % bank-direct or 1.8-3.0 % via an aggregator (DOCUMENTED-vendor, 2026-10-31). ≈ 95-99 ₽ net per 100 ₽ | Medium: provider adapter, webhook, receipts, RU entity | **Breaks Telegram §6.2 and the FAQ as written.** Sanction: hidden from mobile users or store versions, then termination [1][2]. @combot precedent 2024 [6] | A | Not viable while the bot is distributed through Telegram's store apps (INTERPRETATION) |
| (b) Own website outside Telegram, entitlement by Telegram id (ruble-only items) | As (a), plus RU hosting and a login flow | Medium-high: site, Telegram Login (OIDC), offer, 152-FZ | Outside "inside Telegram apps" [1]. Fails Apple 3.1.3(b) if the items have no Stars price. No in-app link or CTA allowed (non-US) [8] | B (rule text) / C (practice) | Romance Club precedent with UID [29]. Discovery only through outside channels |
| (c) Hybrid: Stars in Telegram + ruble website for RU | Stars side as baseline; ruble side as (a) | (b) plus a second grant path into one entitlement table | Closest to the Apple 3.1.3(b) pattern. Risk concentrated in steering. Principle 2 literally kept inside Telegram | B | Needs an owner ruling on principle 2's scope and on price parity |
| (d) Code or voucher sold elsewhere (Boosty, VK Donut, marketplace), redeemed in the bot | Venue fee (not found) + code system | Medium | Apple 3.1.1 names "license keys … QR codes" as forbidden unlock mechanisms [8]; Telegram "regardless" [1] | A (rule) / C (venues) | Highest in-app rule risk |
| 18+ track (R5) via ruble acquiring | — | — | Prohibited lists name erotic content (RSB, Yandex Pay; Alfa per snippet) [21][22] | B | INTERPRETATION: expect refusal or account closure for the 18+ track |

## Applicability to tg-app-novel (map onto §2 planned features; product feature asks, listed not designed)

- **What each option conflicts with:**
  - (a): principle 2; Telegram §6.2 and the FAQ; Apple 4.7.1/3.1.1 through Telegram.
  - (b): principle 2, if read globally; Apple 3.1.3(b) without a Stars price; steering rules if mentioned in-app.
  - (c): principle 2's wording ("Stars only"), which would need a scope sentence; steering.
  - (d): Apple 3.1.1 (license keys) and Telegram's FAQ.
  - All ruble options: Q21 (a Russian-resident entity), the R5 18+ track (acquirer lists), and the 14-17 audience
    (R4; below).
- **Minors (R4), INTERPRETATION:**
  - With Stars the minor's purchase of Stars is a contract with Apple or a reseller (09 §3). Spending Stars in our bot
    is a further transaction.
  - With rubles we sell directly. Civil Code art. 26 p. 1 (written consent beyond "мелкие бытовые сделки", "minor
    everyday transactions") and art. 175 (parents may void in court, with restitution) would target **our** sale [39].
  - Since 2025-08-01 a 14-17-year-old opens a bank account only with written parental consent (art. 26 p. 5; 09 §3).
    Cards for under-14s are commonly issued on the parent's account, e.g. T-Bank «Джуниор» (search snippet, CLAIMED).
    The payer of record may then be the parent.
  - No adopted rule on minors' in-game spending was found (09 §3).
- **Principles 0 and 1** are compatible with every ruble route: grant only on the provider's server-to-server
  notification after a status re-check [14], idempotent on the provider payment id. Paid chapter JSON is still served
  only after the entitlement check.
- **Principle 6:** a provider adapter over HTTP and, for (b)/(c), a website login. No bot framework or payment SDK is
  needed [14][15][34].
- **Product feature asks (listed, not designed):**
  - An entitlement record independent of the payment rail: a provider column, a provider payment id under UNIQUE, and
    refund/dispute states.
  - A provider webhook route with status re-check and source-IP validation [14].
  - A refund path per rail, including revocation on a provider refund or dispute.
  - A per-currency price table, with Stars and rubles kept in step if (c).
  - A website identity flow: Telegram Login OIDC [34], or a player id shown in settings as in the Romance Club pattern
    [29].
  - 54-FZ receipts via the provider [12][19].
  - An offer, `/terms` and a refund policy for the ruble rail.
  - Payment analytics by rail and language ("invoice opened → paid").
  - For (c): no link, button or price comparison inside the Mini App (steering) [8].

## Pitfalls / what goes wrong (sourced)

- **Treating BotFather providers as a ruble route for chapters.** §6.1 is for physical goods only; a provider token for
  digital goods is the §6.2 breach [2][3].
- **An in-app "cheaper on our site" banner or link.** This is anti-steering under 3.1.1(a)/3.1.3 outside the US
  storefront [8], and Telegram's notice-then-hide sanction [2]. The @combot letter shows Apple polices individual bots
  through Telegram [6].
- **A ruble-only catalogue unlocked in the bot.** It fails Apple 3.1.3(b)'s "also available as in-app purchases"
  condition [8].
- **Assuming SBP is ≤ 0.7 % through any provider.** Aggregators charge 1.8-3.0 % for SBP [17]. The 0.4-0.7 % band is the
  bank-direct merchant rate [23][25].
- **Forgetting the 2026 VAT change** on acquiring fees (22 %) [25]. ЮKassa's listed rates exclude VAT [12].
- **The self-employed regime outgrown mid-year.** The НПД right ends on the receipt that crosses 2.4 M ₽ (art. 4 p. 2
  item 8) [26]. Hiring anyone also ends it (item 4).
- **Assuming refunds return the fee:** ЮKassa keeps its commission on refunds [13].
- **The 18+ track on a ruble rail:** prohibited-content clauses in acquirer lists [21][22]. Item 30 ("reputation") lets
  a bank refuse at its discretion [21].
- **SBP from inside the WebView:** opening a bank app from Telegram's WebView is undocumented [15][32]. An untested flow
  can strand the buyer.

## Key claims for verification

1. Telegram Bot Developer Terms §6.2: digital goods "exclusively through the exchange of Telegram Stars"; "cannot be
   processed through third-party payment providers"; sanction "inaccessible from store versions … or terminate"
   — https://telegram.org/tos/bot-developers — DOCUMENTED.
2. Stars FAQ: "Telegram cannot display your bot or mini-app to mobile users if you attempt to sell digital goods …
   through third-party payment providers"; the Stars duty applies "inside Telegram apps"
   — https://core.telegram.org/bots/payments-stars — DOCUMENTED.
3. The @combot notice: Apple cited 4.7 and 3.1.1; Stars-only from June 12 (2024); "suspension … for most of your
   customers" — https://developer.apple.com/forums/thread/755947 — CLAIMED (recipient's quote).
4. Apple 3.1.3(b): web-acquired items accessible "provided those items are also available as in-app purchases"; 3.1.1
   bans "license keys … QR codes"; anti-steering applies "except for the United States storefront"
   — https://developer.apple.com/app-store/review/guidelines/ — DOCUMENTED.
5. Romance Club sold via an official web shop by UID, accepting Russian cards (2023-09-29)
   — https://t-j.ru/romance-club/ — CLAIMED-press.
6. ЮKassa: 2.8 % + 1 % per receipt, excluding VAT; promo 2026-01-28 → 2026-12-01; SBP individual
   — https://yookassa.ru/fees/ — DOCUMENTED-vendor.
7. Robokassa: ИП/ООО cards 3.9 %, SBP 2.7 % (start); self-employed 3.4 % / 3.0 %
   — https://robokassa.com/payments/tarify/ — DOCUMENTED-vendor.
8. Prodamus: 3.8 % start; ₽10,000 connection for ИП/legal entities — https://prodamus.ru/rates — DOCUMENTED-vendor.
9. 22 % VAT on acquiring fees from 2026-01-01 (425-FZ removed the exemption); SBP not subject to VAT
   — https://pay.yandex.ru/blog/articles/ekvajring-2026 — CLAIMED-vendor citing law.
10. 422-FZ art. 4 p. 2 item 8: НПД lost above 2.4 M ₽ a year; item 4: no employees (ed. 2026-08-04)
    — https://www.consultant.ru/document/cons_doc_LAW_311977/30ba0412dfedfe46e8061ea063246bac59da2b69/ — DOCUMENTED.
11. RSB prohibited list item 8: "продажа интернет-контента эротического и порнографического характера"
    — https://business.rsb.ru/upload/iblock/917/zapreshchennye-vidy-deyatelnosti-_internet_ekvayring_.pdf — DOCUMENTED
    (2018).
12. Yandex Pay bans erotic/sexual services, access to pornography and the sale of virtual currency
    — https://pay.yandex.ru/docs/ru/forbidden — DOCUMENTED.
13. SBP 45 % of small-business online orders by count, 37 % by turnover (2026)
    — https://investfuture.ru/articles/po-dannym-prodamus-sbp-obespechivaet-45-onlayn-zakazov-malogo-biznesa-37897374
    — CLAIMED-vendor data.
14. Bank of Russia: SBP "максимальный тариф не может превышать 0,7%" ("the maximum tariff cannot exceed 0.7 %",
    2021-02-26) — https://www.cbr.ru/press/regevent/?id=10725 — DOCUMENTED (2021; the current cap not re-confirmed).

## Gaps (asked but no reliable source found)

- Any 2025-2026 case of a bot or Mini App hidden or terminated for ruble/card payments for digital goods. Any case
  involving a website link (steering) from a Mini App.
- A complete list of BotFather payment providers for Russia (core.telegram.org lists none).
- ЮKassa's and T-Bank's prohibited-activity lists. T-Bank's and CloudPayments' official tariffs (TLS failure / 404).
- Current Bank of Russia merchant SBP caps (the 0.4 / 0.7 % / 1,500 ₽ structure) in a 2026 primary document.
- Conversion by payment method in Russia; how many RU players would leave Telegram to pay on a website.
- Whether the Telegram Login OIDC `id` equals the initData user id (test-bot item).
- How SBP or bank-app deeplinks behave inside Telegram's WebView on iOS and Android (test item).
- The Romance Club web shop's current URL, terms and how players found it. Any rule problem it met.
- Venue rules for selling codes (Boosty, VK Donut, Ozon).
- Tax treatment in Russia of Stars payouts received in TON. Whether art. 174.2 covers game content for a foreign seller.
- Card chargeback rules (Mir) for digital goods.

## Owner value questions this area raises (each with a default reading)

1. **Does "instead of Stars" mean inside Telegram, or alongside it outside Telegram?** Default: Stars stay the only
   payment inside the bot and Mini App (principle 2, Telegram §6.2). A ruble route is considered only as (c), a website
   outside Telegram for Russian players, after a lawyer reviews steering.
2. **Change principle 2's wording?** Default: unchanged until (c) is approved. If approved, add one scope sentence
   ("inside Telegram apps").
3. **Who is the merchant (Q21)?** Default: undecided. A ruble route needs a Russian-resident ИП, ООО or self-employed;
   НПД fits only below 2.4 M ₽ a year with no staff.
4. **Price parity between Stars and rubles?** Default: one catalogue, comparable prices; no price comparison shown
   inside Telegram.
5. **Does the 18+ track (R5) get a ruble rail?** Default: no. The 18+ track stays on Stars (with 10's risks) or is
   unsold in RU.
6. **May 14-17-year-olds pay rubles directly to us?** Default: yes for small amounts, with an offer clause on parental
   consent. A lawyer confirms the art. 26/175 exposure.
7. **Accept the risk of the bot being hidden on mobile (option a) for the ruble upside?** Default: no.

## Sources

[1] https://core.telegram.org/bots/payments-stars — Telegram, "Bot Payments API for Digital Goods and Services", undated, read 2026-10-31. The contract.
[2] https://telegram.org/tos/bot-developers — Telegram Bot Platform Developer Terms §6, §9, §10; undated, read 2026-10-31. The contract.
[3] https://core.telegram.org/bots/payments — Telegram, "Payments for physical goods and services", undated, read 2026-10-31.
[4] https://telegram.org/tos/mini-apps — Telegram Mini Apps ToS, undated, read 2026-10-31.
[5] https://telegram.org/blog/telegram-stars — Telegram blog, 2024-06-06.
[6] https://developer.apple.com/forums/thread/755947 — Combot CEO quoting Telegram's notice, "Created May '24", read 2026-10-31. Recipient's copy of a primary notice.
[7] https://t-j.ru/news/tg-stars/ — Т—Ж news, 2024-05-23 (press).
[8] https://developer.apple.com/app-store/review/guidelines/ — Apple App Review Guidelines 3.1.1, 3.1.1(a), 3.1.3, 3.1.3(a)/(b), 4.7; read 2026-10-31.
[9] Search snippets (not opened): macrumors.com 2026-06-11/06-30, cravath.com, idropnews — Epic v. Apple Ninth Circuit 2025-12 and the Supreme Court petition. CLAIMED-snippet.
[10] Search snippets (not opened): developer.apple.com custom-purchase-link allowed regions (Brazil, Japan); EU DMA fee coverage (techrepublic, mjtsai 2026-08-18). CLAIMED-snippet.
[11] https://mobile-review.com/all/news/platit-i-kayatsya-apple-vyplatila-shtraf-v-12-mlrd-rublej-po-resheniyu-fas/ — 2024-01-22, the FAS case and fine.
[12] https://yookassa.ru/fees/ — ЮKassa tariffs, read 2026-10-31 (promo window 2026-01-28 → 2026-12-01).
[13] https://yookassa.ru/developers/payment-acceptance/after-the-payment/refunds — ЮKassa API docs, read 2026-10-31.
[14] https://yookassa.ru/developers/using-api/webhooks — ЮKassa notifications, read 2026-10-31.
[15] https://yookassa.ru/developers/payment-acceptance/integration-scenarios/widget/basics — ЮKassa widget, read 2026-10-31.
[16] https://promo.yookassa.ru/telegram_api — ЮKassa page for Telegram bots, read 2026-10-31.
[17] https://robokassa.com/payments/tarify/ — Robokassa tariffs, read 2026-10-31.
[18] https://robokassa.com/content/trebovaniya.html — Robokassa site requirements, read 2026-10-31.
[19] https://robokassa.com/solutions/business/cifrovye-tovary/ — Robokassa digital goods page, read 2026-10-31.
[20] https://prodamus.ru/rates — Prodamus rates, read 2026-10-31 (page truncated).
[21] https://business.rsb.ru/upload/iblock/917/zapreshchennye-vidy-deyatelnosti-_internet_ekvayring_.pdf — Russian Standard Bank, prohibited activities for internet acquiring; PDF metadata 2018-06-20.
[22] https://pay.yandex.ru/docs/ru/forbidden — Yandex Pay prohibited goods and services, undated, read 2026-10-31.
[23] https://www.cbr.ru/press/regevent/?id=10725 — Bank of Russia press item, 2021-02-26.
[24] https://nalog-nalog.ru/raschety/sbp-s-1-maya-2026-chto-s-komissiyami-na-samom-dele/ — tax press, 2026-05-06.
[25] https://pay.yandex.ru/blog/articles/ekvajring-2026 — Yandex Pay blog, 2026-06-03 (vendor).
[26] https://www.consultant.ru/document/cons_doc_LAW_311977/30ba0412dfedfe46e8061ea063246bac59da2b69/ — 422-FZ art. 4, ed. 2026-08-04.
[27] Search snippets (not opened): ppt.ru, nalog-nalog.ru, tochka.com on 425-FZ (VAT 22 %, УСН thresholds 20/15/10 M ₽). CLAIMED-secondary.
[28] https://investfuture.ru/articles/po-dannym-prodamus-sbp-obespechivaet-45-onlayn-zakazov-malogo-biznesa-37897374 — TASS via InvestFuture, 2026-09-10.
[29] https://t-j.ru/romance-club/ — Т—Ж, 2023-09-29.
[30] https://xn--80abwagddjkhv2ag.xn--p1ai/ — the domain T-J linked as Romance Club's shop; showed a download page on 2026-10-31.
[31] https://habr.com/ru/posts/1057758/ — developer post (ЮKassa → Stars), "10 July", year not shown.
[32] https://core.telegram.org/bots/webapps — Mini Apps docs (`openLink`, `openInvoice`), read 2026-10-31.
[33] https://core.telegram.org/bots/api-changelog — Bot API 10.3 (2026-08-24); 10.2 origin hardening (2026-07-14). Plus https://t.me/s/BotNews (fetched 2026-10-31; no Stars-transition post).
[34] https://core.telegram.org/widgets/login — Telegram Login (OpenID Connect), undated, read 2026-10-31.
[35] Search snippets (not opened): habr.com/ru/articles/855824 (ЮKassa in BotFather), habr.com/ru/post/555460 (Sberbank), developer.smart-glocal.com (Smart Glocal bot connection). CLAIMED-snippet.
[36] Search snippets (not opened): profile.ru (2026-07-31), vbr.ru (2023-06-09), infostart.ru — SBP disputes, no chargeback. CLAIMED-press.
[37] Search snippet (not opened): t-j.ru/friendship-ended-with-patreon/ — Boosty 18+ marking, undated. CLAIMED.
[38] Search snippets (not opened): sravni.ru, finuslugi.ru, 1000bankov.ru — teen and child cards 2026. CLAIMED.
[39] Reused project research: 09-gap-fill-access-audience-minors.md §1, §3, §4 (Stars access from Russia, Civil Code art. 26/175, Google Play status, whitelisting); 07-funnel-metrics-budgets.md §2 ($0.013/Star, RU store prices); 08-markets-and-hedges.md §3 (MAX/VK payments); 05-case-studies.md §2a (Romance Club); D:/tmp/novel-orch/design/choices/research_M4.md §4 (ZoZPP art. 32).
[40] Search snippets (not opened): ppt.ru (Minfin position), teletype/harant — 259-FZ art. 14 p. 5 ban on accepting digital currency as payment. CLAIMED-secondary.
[41] Search snippets (Kontur 403; consultant.ru note) — NK art. 174.2 p. 3 (foreign e-service sellers pay VAT), p. 5 amended by 425-FZ. CLAIMED-secondary.
