# Promotion research 03: viral and social mechanics in Telegram
Date 2026-10-31. Sources read: 34 (pages opened) + prior research M2/M4 (re-used, re-verified where marked).
Freshness notes: Bot API changelog read to its latest entry, **Bot API 10.3 (2026-08-24)**; 10.2 2026-07-14, 10.1
2026-06-11, 10.0 2026-05-08, 9.6 2026-04-03, 9.5 2026-03-01 [1]. Mini Apps doc "Recent changes" top entry = Bot API
10.1 [2]. Deep-links doc [3], Bot Developer Terms (no date stamp on the page) [4], Telegram blog 2026-07-14 [5].
No Bot API release between 2026-08-24 and 2026-10-31. **The session's web-search budget ran out mid-research**: the
Russian-language romance-community and "VN inside a TMA" prior-art queries were not run (see Gaps); fetches of
already-known URLs continued.

Labels: MEASURED (data with stated method/sample), DOCUMENTED (official doc/terms), CLAIMED (vendor, press, blog,
company PR, anonymous post), INTERPRETATION (my reading of a legal/terms text; not legal advice).

## TL;DR (decision-relevant)

- **Nothing changed in the share stack since M2.** `savePreparedInlineMessage` → `WebApp.shareMessage` (8.0,
  2024-11-17) is still the rich share; `shareToStory` (7.8, 2024-07-31) still says "only premium subscribers can post
  stories with links" and caption 0-200 chars (2048 Premium) [1][2]. New since M2's focus: **guest mode (10.0)** — any
  user can @mention a guest-enabled bot in any non-secret private chat or group the bot is not in, and the bot posts an
  inline-style result there [1][6]; **Communities (10.2)** — groups, channels and bots linked around a topic [1][5];
  **ephemeral group messages (10.2)** [1][5]. These are new viral/community surfaces the plan does not use.
- **Stories are open to all users (since 2023-08-14) [7], but links in stories are Premium-only** (story captions,
  URL media areas, widget link) [2][8], and non-Premium users have lower weekly/monthly story quotas [8] (one large
  bug thread reports non-Premium accounts blocked after ~3 stories, CLAIMED [9]). A non-Premium story share carries
  no tappable way back. M14's rejection reason is confirmed.
- **Bots can gift real Telegram gifts** (`sendGift`, 8.0; paid from the bot in Stars; "can't be converted to Telegram
  Stars by the receiver") and Premium (`giftPremiumSubscription`, 9.0; 1000 Stars for 3 months) [1][10]. Usable as a
  rare prize, not as a per-referral reward (cost per unit in Stars; gift prices not re-read: GAP).
- **No measured K-factor exists for any Telegram Mini App** (Hamster Kombat, Notcoin, Catizen, any non-crypto TMA):
  GAP. Cross-industry: the largest referral dataset found (Extole, 400 programs) implies K ≈ 0.05; "good" consumer K
  0.15-0.25 (practitioner) [11] — all CLAIMED. Wordle's creator: ~100k shared grids when ~2M played (~5 %) [12].
- **Two peer-reviewed/field results matter for M23**: recipient-benefiting rewards convert at least as well as
  sender-benefiting ones (Gershon, Cryder, John, JMR 2020; field n = 6,364) [13]; in a mobile game (66,427 inviters,
  97,181 invitees) rewards **conditional on the invitee converting** gave 77.4 % fewer referrals, 11× higher acceptance,
  222.9 % more pestering of contacts, and invitees who spent 30.3 % less time and 76.6 % less money than with
  unconditional rewards (seminar abstract, 2026) [14]. MEASURED (method stated), the second only as an abstract.
- **Romance audiences share selectively**: fans post fan content and debate on X/TikTok/YouTube/Weibo (developer
  statement, Love and Deepspace) [15], but some keep the romance private because they treat the leads as partners
  [16] — CLAIMED. Russian teens: daily reach VK 63 % / TikTok 61 % (12-17); Telegram 80 % (12-24) — Mediascope Jan-Jul
  2024 via ComNews [17]. Off-Telegram (VK, TikTok) is where romance fandom content lives; Telegram is where the link
  lands.
- **Terms**: §5.2(d)(ii) forbids "Social growth manipulation" (undefined), §5.2(b) spam, §6.2.4 lets Telegram withhold
  Stars for "suspected abuse of Bot Platform" [4]. INTERPRETATION: a single-level, capped, play-based in-app reward
  is not on its face "manipulation"; rewards for joining channels, fake-account inflation or multi-level payouts sit
  closer to §5.2(d).

## Findings

### 1. Mechanisms (version that added each; current contract)

| Mechanism | Added (Bot API, date) | Contract facts (read today) | Label |
|---|---|---|---|
| `savePreparedInlineMessage` + `WebApp.shareMessage(id)` | 8.0, 2024-11-17 | "allowing bots to suggest users to send a specific message from a Mini App"; Telegram itself names "sending referral codes, custom memes, artwork and more to any chat" [1]. Message must come from a `PreparedInlineMessage` [2]. Per-chat-type flags, `expiration_date`, `web_app` buttons not allowed in shared messages, photo result = public JPEG ≤ 5 MB: M2 §1, unchanged in 9.x-10.3 [1] | DOCUMENTED |
| `WebApp.shareToStory(media_url, {text, widget_link})` | 7.8, 2024-07-31 | text "0-200 characters for regular users and 0-2048 characters for premium subscribers"; `widget_link.name` 0-48; "only premium subscribers can post stories with links" [2]. MTProto: "Premium users can use styled text entities and links in story captions and URL media areas" [8]. No callback/event (M2 §1) | DOCUMENTED |
| Who can post stories | client feature, 2023-08-14 | "now available to everyone on the platform" (after a Premium-only July 2023 launch) [7]; separate weekly/monthly/active-story limits for Premium vs non-Premium (`stories_sent_weekly_limit_default/premium`, values not stated) [8]; bug thread "Not possible to post stories without premium" (271 votes, users hit the cap after ~3 stories, no official reply) [9] | DOCUMENTED / CLAIMED |
| Main Mini App link `t.me/<bot>?startapp[=<p>]&mode=…` and named app `t.me/<bot>/<short>?startapp=<p>&mode=…` | main app 8.0 era; direct links 7.x; default full height since 7.6 (2024-07-01) [1][2] | `mode` = `compact` or `fullscreen` in the links doc [3]; the webapps doc mentions only `mode=compact` [2]. No length/charset stated for `startapp`; bot `start` = "up to 64 base64url characters" [3]. Direct links open "directly in the current chat" [2] | DOCUMENTED |
| `t.me/share/url?url=&text=` | — | url required (urlencoded), text optional; client inserts URL then text in the chosen chat's input field [3]. tdesktop: `/share/url` works in Mini Apps, `t.me/share?url=` failed (M2 [14]) | DOCUMENTED |
| Inline mode: `WebApp.switchInlineQuery(query, choose_chat_types)`, `answerInlineQuery` | switchInlineQuery 6.7; inline mode older | ≤ 50 results per query; `cache_time` default 300 s [10]; `SwitchInlineQueryChosenChat` {query, allow_user/bot/group/channel_chats} [10]. Works from any chat by typing `@bot` — no Mini App launch needed. Needs inline mode on in @BotFather (M2) | DOCUMENTED |
| Guest mode | 10.0, 2026-05-08 | "allowing bots to receive certain messages and issue replies within chats they are not a member of"; `answerGuestQuery`, `SentGuestMessage`, `Update.guest_message` [1]. MTProto: invoked by mentioning the bot's @username, up to 3 guest bots per message, in "any non-secret private chat, group and supergroup" except content-protected groups; reply is an inline-result object; bot receives the triggering message + referenced messages [6]. Whether buttons are allowed in guest results: not stated (GAP) | DOCUMENTED |
| Rich messages in inline / guest / Web App query results | 10.1, 2026-06-11 | `InputRichMessageContent` usable "in results of inline, guest, and Web App queries" [1] | DOCUMENTED |
| Group launches: `chat_type`, `chat_instance` | main app / direct links (7.x-8.0) | "Mini Apps can use the chat_type and chat_instance parameters to keep track of the current chat context. This introduces support for concurrent and shared usage by multiple chat members" [2]. Equality of `chat_instance` across members: implied, not stated (M2 §3, still unverified) | DOCUMENTED |
| Ephemeral group messages | 10.2, 2026-07-14 | bots in groups can send messages "visible only to the bot and the person who used them" (greetings, errors, button menus) [5][1] | DOCUMENTED |
| Communities | 10.2, 2026-07-14 | "Several groups, channels, and bots can now be linked together into communities around a shared topic"; members see and join the other chats; any member can add chats unless an admin restricts it [5] | DOCUMENTED |
| `addToHomeScreen` / `checkHomeScreenStatus` | 8.0, 2024-11-17 | "prompts the user to add the Mini App to the home screen" [2]. **No retention data found** (GAP) | DOCUMENTED |
| `sendGift` (bot → user/channel) | 8.0 (users), 8.2 `pay_for_upgrade` (2025-01-01), 8.3 channel chats (2025-02-12) [1] | "Sends a gift to the given user or channel chat. The gift can't be converted to Telegram Stars by the receiver"; text 0-128 chars; `getAvailableGifts` lists sendable gifts; `Gift.star_count` = "Telegram Stars that must be paid to send"; limited gifts carry per-bot `personal_remaining_count` [10]. "Bots can now send Paid Gifts to users in exchange for Telegram Stars" [1]. A gift shows on the recipient's profile only if they save it / auto-save privacy allows [18]. Current gift prices: GAP | DOCUMENTED |
| `giftPremiumSubscription` | 9.0, 2025-04-11 | `month_count` 3/6/12, `star_count` "must be 1000 for 3 months" (6/12-month values not captured) [10][1] | DOCUMENTED |
| Channel/group Stars giveaways | 7.10, 2024-09-06 | `prize_star_count` "to be split between giveaway winners"; `only_new_members`; `winner_count` [10][1]. Blog: "Channel and group owners can host giveaways", winners random, "prepaid", hosts earn boosts, winners spend Stars in channels, games and mini apps [19]. Started by the owner in the Telegram client (Statistics > Boosts) [19]; no Bot API method creates a giveaway (only objects received) [10]. Eligibility thresholds: not on Telegram's page (GAP) | DOCUMENTED |
| Telegram Affiliate Program (`t.me/<bot>?ref=<referrer>`) | 8.1, 2024-12-04 | Star purchases in the mini app transfer a commission to the link's creator [3]; details M4 §2c | DOCUMENTED |
| `requestChat` + `savePreparedKeyboardButton` | 9.6, 2026-04-03 | picker of users/chats; shares picked users' ids with the bot (M2 §3; rejected by M10) [1][2] | DOCUMENTED |

### 2. Measured referral and sharing outcomes

**K-factor benchmarks** (all from one 2020 compilation [11] of "passing mentions … no rigorous standards"):
- Adjust app sample: K present in 22.5 % of games (470 apps) vs 33.6 % of non-games (871); median K 0.45 where present.
  CLAIMED (vendor, method not given) [11].
- Jelly Splash soft launch: K 0.92 → 0.84 as eCPI rose 28 %. CLAIMED [11].
- Extole, 400 referral programs: 19 % of potential advocates became advocates, 2 shares each, median 1 click per share,
  13 % click-to-customer → K ≈ 0.049. CLAIMED (vendor data, n stated) [11].
- Practitioner rule (Rahul Vohra): 0.15-0.25 good, 0.4 great, ~0.7 outstanding. CLAIMED [11].
- **Telegram Mini Apps: no published K, invite rate or referral share for Hamster Kombat, Notcoin, Catizen, Blum or any
  non-crypto TMA** (GAP; searched in EN, several phrasings). Scale figures only: Hamster Kombat ">300 million" joined,
  131 M qualified for the airdrop, 2.3 M banned (team via Decrypt, 2024-09-24) [20]; Catizen ">36 million players",
  2.26 M paying (The Block, 2024-09; issuer figures) [21] — CLAIMED. A market selling Catizen referrals existed
  (vc.ru, 2024-07-04) [22] — CLAIMED, a pointer to farming.

**Two-sided vs one-sided rewards, conditional vs unconditional** (MEASURED):
- Gershon, Cryder, John, "Why Prosocial Referral Incentives Work", *JMR* 57(1):156-172, 2020: two field experiments +
  an incentivized lab study; recipient-benefiting incentives recruited more new customers than sender-benefiting ones;
  GiftAMeal field test: 6,364 customers, 5 arms (control, $5 sender, $5 recipient, $2.50 each, $5 donation),
  conversion "marginally higher in the friend-benefiting condition"; overall conversion low. Market survey of 351
  programs: 40.5 % sender-only, 2.6 % recipient-only, 55 % shared [13]. Exact per-arm rates not in the pages read.
- Zhuang (HKU), seminar 2026-05-07, "Unpacking the Incentive Conditions of Referral Programs": mobile-game field
  experiment, 66,427 inviters, 97,181 invitees, 60 days; conditional (invitee must convert) vs unconditional, × high/low
  value. High-reward conditional: −77.4 % referrals sent, > 11× acceptance per referral, +222.9 % contacting of
  invitees ("reward-driven social pressure"); invitees −30.3 % time, −76.6 % money [14]. Abstract only; not peer
  review read.
- Invite-to-install and install-to-activation rates for Telegram referral links specifically: GAP.

**Share rates of results / completion cards**:
- Wordle: Josh Wardle (2022-01): the Wordle Stats account collected ~100,000 shared grids when ~2 M people played
  (≈ 5 %, a lower bound: one collector, one platform). Twitter data scientist case study (2022-05-03): 3.3 M people
  tweeted about Wordle, 32.2 M tweets, peak 500k/day late January 2022. NYT Q1 2022 release: Wordle brought "tens of
  millions of new users" [12]. The tweet counts are platform-measured (MEASURED, internal method); the rest CLAIMED.
- Spotify Wrapped 2025: 200 M engaged users in ~24 h (+19 % YoY), ~500 M shares (+41 % YoY); "shares" include native
  shares, downloads and screenshots (company-reported, MBW 2025-12-08) [23]. CLAIMED.
- Personality quizzes (2014): on a "Which Tolkien creature are you?" quiz, people who got "an elf" were "more than
  twice as likely to share" as hobbit/wizard results (Livingly Media VP) [24]. CLAIMED. A flattering result drives the
  share.
- Measured uplift from adding an image to a Telegram share vs text-only: GAP.

**Narrative / romance share behaviour**:
- Fraction of players who ever share in Episode, Choices, Клуб Романтики, Wattpad: **no data found** (GAP).
- BookTok (romance books): NielsenIQ: fiction growth in six monitored countries "primarily driven by romance and sagas
  titles appearing with BookTok hashtags" (PW, 2023-10-19) [25]. Vendor panel data, method not detailed.
- Love and Deepspace (largest female-audience romance game): developer: players "share their thoughts on social
  media platforms like X, Facebook, TikTok, YouTube and Weibo"; fan creations praised (Pocket Gamer, 2024-01-17) [15].
  36Kr (2024-10-08): some players keep their experience private because they "genuinely view the male leads … as
  their boyfriends"; fans mass-protested on Weibo against a rapper calling the game "borderline sleazy" [16]. CLAIMED.

### 3. Anti-abuse practice for referral rewards

- **Signals a TMA server has** (M4 §3c, field list re-confirmed by the webapps doc today [2]): signed `user.id`,
  `is_premium`, `username`, `photo_url`, `language_code`, `allows_write_to_pm`; opt-in phone via `requestContact`;
  launch context `chat_type`/`chat_instance`; our own server-observed timings. **No account-age field** for bots or
  Mini Apps (M4 [32]). DOCUMENTED.
- **Hamster Kombat** (team statements via Decrypt/ForkLog, 2024-09-22/24): detection "by analyzing user behavior";
  one person linked 400+ accounts to one exchange address; one user with ~2,000 invited "friends" flagged; 6.8 B tokens
  taken back from cheaters [20]. Settlement was effectively delayed to a snapshot. Backlash followed late criteria
  changes (M4 [28][29]). CLAIMED.
- **Premium weighting** (Hamster: larger bonus for Premium invitees): M4 §3b, CLAIMED. No source documents `is_premium`
  as an anti-fraud signal (GAP).
- **Caps, delayed settlement, activity-based rewards**: seen in Blum (share of the friend's points), TapSwap (activity),
  Hamster (snapshot) — M4 §3b, CLAIMED. The Zhuang experiment shows the side effect of conditional rewards: more
  pressure on contacts and lower-value invitees [14].
- **Referral markets**: sellers advertise bought referrals for TMA games (vc.ru 2024-07-04) [22]: any reward a fresh
  account can trigger will be bought.
- **Telegram Bot Developer Terms** (page read 2026-10-31, no revision date) [4]:
  - §5.2(b): "Your TPA must not harass or spam users with unsolicited messages;"
  - §5.2(d): no misrepresentation, incl. misleading users toward unachievable outcomes; examples (i) "MLM or ponzi
    schemes", (ii) "Social growth manipulation" — **not defined anywhere on the page**.
  - §5.2(f): "must not attempt to circumvent or otherwise undermine Telegram rate limits and moderation".
  - §6.2.4: Telegram may withhold or debit Stars for "suspected abuse of Bot Platform"; §6.2.5: broadcasts only to
    users who granted permission to be contacted.
  - No clause on incentivized invites or referral rewards (GAP, as in M2/M4). Telegram's own 8.0 changelog markets
    shareMessage for "sending referral codes" [1].
  - INTERPRETATION (not legal advice): "social growth manipulation" most plausibly targets inflating subscriber/member/
    boost counts (paid or fake joins). A reward that requires real play by a real invitee, single-level and capped, is
    not on its face covered; rewards for joining a channel, bulk messaging through users, or multi-level payouts are
    closer to §5.2(b)/(d).

### 4. Romance / female-audience social behaviour

- **What gets shared** (CLAIMED, thin): fan creations and opinions about characters (Love and Deepspace [15]); fan
  protests defending the game/characters [16]; result-of-quiz identity content favours flattering results [24]; romance
  books spread through BookTok hashtags [25]. Fan Telegram channels around Клуб Романтики exist (memes, spoilers,
  contests; one ~11.6k subscribers) — search snippets of tgstat only; the pages returned 403 (unverified pointer).
- **Counter-behaviour**: some romance players keep the relationship private [16]; otome fandom literature describes
  fans who refuse to share "their" love interest with other fans (Cambridge item, 403 — pointer only, unverified).
- **Surfaces in Russia**: Mediascope Jan-Jul 2024 daily reach — 12-17: VK 63 %, TikTok 61 %; 12-24: Telegram 80 %,
  VK 67 %, TikTok 54 % (via ComNews 2025-08-11; panel data, sample not given) [17]. MEASURED (secondary report).
- **Teens vs adults**: the platform data above is the only age split found. Differences in what minors may be shown or
  rewarded for are another area's subject (law); socially, group/co-reading and public-community features expose minors
  to strangers — a design-time risk, not sourced here.

## Channel rows (for the synthesis table)

| Channel | Cost (with currency, date, label) | Effort | Fit for a Russian-first romance VN for girls in a TMA | Evidence quality | Notes |
|---|---|---|---|---|---|
| shareMessage, text + url button (planned M14) | 0 currency; Bot API calls free (DOCUMENTED, 2026-10) | S (planned) | Good floor: lands in the chats where friends are; spoiler-free | A mechanism / C outcome | No outcome data for TG; every share carries the invite |
| shareMessage with photo card (`InlineQueryResultPhoto`) | 0 currency; server render CPU (unmeasured) | M | Better for a visual genre (art is the hook) | A mechanism / C outcome | Public JPEG URL → free art only (principle 0); iOS sheet bug with long captions (M2 [16]) |
| `t.me/share/url` fallback | 0 | XS (planned) | Works on old clients | A | Preview = Telegram link preview of the URL |
| shareToStory | 0 | S-M (image needed) | Story culture fits the audience, but **no link for non-Premium**, quotas, no callback | A mechanism / C outcome | Only an image with the bot name/QR can bring viewers back |
| `startapp` invite links (M10/M11) | 0 | planned | Core attribution; main-app link works everywhere | A | `mode=fullscreen|compact` available [3] |
| Inline mode (`@bot` in any chat, `switchInlineQuery`) | 0 | M (inline handler) | Lets fans drop a teaser/"what would you choose" card into any chat without opening the app | A mechanism / C outcome | Result URLs public [M2]; needs /setinline |
| Guest mode (10.0) | 0 | M | New; a fan mentions the bot in a group to post a card | A mechanism / no outcome data | Client support and buttons in guest results: GAP; spam risk §5.2(b) |
| Group co-reading (`chat_instance`) | 0 | L | "Book club" / vote-together fits female group chats | A mechanism / C outcome | Paid chapters per member entitlement; equality of `chat_instance` unverified |
| Own channel + discussion group, Communities (10.2) | 0 currency; moderation time | M ongoing | Where fandom (polls, art, memes) lives in Telegram | A mechanism / C (fan channels exist) | Minors in open groups; moderation load |
| addToHomeScreen prompt | 0 | XS | Retention (return to cliffhanger), not acquisition | A mechanism / no data | No retention data anywhere (GAP) |
| Referral reward in hints (M23) | hints (no cash cost); fraud cost bounded by caps | planned | Fits; hints are a cheap currency | B (JMR, field abstract) | Recipient-weighted rewards evidence [13]; conditional-reward side effects [14] |
| In-app hint gifts (M22) | hints | planned | Friend-to-friend care fits audience (CLAIMED) | C | Farming bounded by caps |
| Telegram gifts via `sendGift` / Premium gift | Stars per gift (prices GAP); Premium 3 mo = 1000 Stars (DOCUMENTED 2026-10) | S | Status object on profile — attractive prize for contests | A mechanism / C outcome | Bot pays; not convertible by receiver; use for rare prizes, not per invite |
| Channel Stars giveaways (partner channels) | Stars prize pool, prepaid (DOCUMENTED; thresholds GAP) | S per giveaway | Co-promotion with romance/book channels; winners can spend Stars in our app | A mechanism / C outcome | Run by a channel owner in the client, not by our bot |
| Telegram Affiliate Program (MV11) | commission permille of revenue from referred users (DOCUMENTED, M4) | XS (BotFather setting) | Pays channel owners/fans who promote; no in-app item | A | Owner value; affiliates may target teens |
| Off-Telegram UGC (TikTok/VK/BookTok-style) | 0 direct; content time | L ongoing | Where romance fandom content spreads (CLAIMED) | B/C | Link must land in Telegram; TikTok/VK specifics are area for creatives |

## Applicability to tg-app-novel (map onto §2 planned features)

**Completion-card share as text + button (M14)**
- Gets right: every share carries the invite (closes the loop); native share with a fallback; spoiler-free like the
  Wordle grid (counts, no titles) [12]; per-tap preparation; group chats allowed.
- Misses: no visual in a visual genre (no TG-specific uplift data: GAP); only one trigger (after the first ending),
  while the free chapter's paywall cliffhanger is the emotional peak every free player reaches; the "score" (endings
  found, no total) is weaker than a flattering identity result [24].

**Friends' stats (M12-M13)**: private by default + mutual accept is the privacy-correct choice (M3); social proof only
inside an already-formed friendship. Misses group context entirely (no chat-level "who in this chat is reading").

**Hint gifts (M22)**: fits a care/reciprocity loop; no evidence either way for the audience (GAP).

**Referral 5/2 on chapter-1 completion (M23)**: single-level, capped, server-observed evidence matches the anti-farm
practice seen [20][M4]. Evidence to weigh: the reward is **conditional** for the inviter (the friend must finish chapter
1) — Zhuang's experiment links conditional inviter rewards to more pressure on contacts and lower-value invitees [14];
Gershon et al. find the recipient's reward drives conversion at least as much as the sender's [13] — the planned split
is sender-weighted (5 vs 2).

**No public profile / no shareToStory**: confirmed by today's sources (stories links Premium-only [2][8]; quotas [8][9]).

**PRODUCT FEATURE ASKS (listed, not designed)**
1. **Static per-story share-card image** (free key art, story title, bot name) via `InlineQueryResultPhoto`. Evidence:
   documented photo results [10]; visual genre. Conflicts: the image URL is public → free-chapter art only (principle
   0); keep captions short (iOS bug, M2).
2. **Personal result card** ("you found 3 endings", a flattering archetype line). Evidence: Wrapped [23], quiz share
   likelihood [24]. Conflicts: no ending titles / no totals (Q25); no paid-chapter facts; rendering must stay
   server-side (M2 trust table).
3. **"What would you choose?" share** from a free scene: a message with the dilemma and a deep link
   (`startapp=<scene-token>`) into that free scene; optionally aggregate "x % chose…". Evidence: spoiler-free shares
   [12]; fan debate behaviour [15][16] (CLAIMED). Conflicts: only chapter-1 choices (principle 0); a scene-entry deep
   link needs a story start-point (principle 7: the share names a scene, the story runtime decides); aggregates are
   other users' data (privacy: aggregates only, minimum counts).
4. **Love-interest / "who is your match" quiz** at the end of chapter 1. Evidence: identity results share better
   [24]; romance fandom centres on characters [15]. Conflicts: romance + minors (age bracket open, MV12); some players
   keep romance private [16] → opt-in only.
5. **Story share with the bot @name or a QR printed in the image** (works without Premium links). Evidence: stories
   for everyone [7]. Conflicts: no callback → no reward or attribution; quotas for non-Premium [8][9].
6. **Inline-mode teaser cards** (`@bot` in any chat; `switchInlineQuery` from the app). Evidence: documented [10].
   Conflicts: inline result URLs are public (principle 0); one more webhook handler (principle 6: fine through
   frankenstein).
7. **Guest-mode answers** (10.0) in group chats. Evidence: documented [1][6]; no client-support data. Conflicts: spam
   (§5.2(b)); unknown button support.
8. **Group co-reading / "book club"** keyed by `chat_instance` (shared votes, ephemeral per-member prompts 10.2).
   Evidence: "concurrent and shared usage by multiple chat members" [2]. Conflicts: each member needs their own
   entitlement for paid chapters (principle 0); members see each other's choices (privacy consent); minors in groups.
9. **Official channel + discussion group, linked as a Community (10.2)**: release announcements, character polls, fan
   art. Evidence: [5]; fan channels exist (pointer). Conflicts: moderation; minors; no ending spoilers policy.
10. **"Save art" for unlocked free CGs** (`downloadFile`, 8.0) to feed fan sharing. Evidence: fans share fan content
    [15]. Conflicts: paid CGs must not be offered as downloads (principle 0 spirit: a download is distribution).
11. **addToHomeScreen prompt** after chapter 1. Evidence: none measured (GAP). Conflicts: none.
12. **Recipient-weighted referral split** (e.g. invitee ≥ inviter). Evidence: [13]. Conflicts: the invitee bonus is
    per new account → farm yield per account rises (M23 note).
13. **Prize mechanics with Telegram gifts / Stars giveaways with partner channels.** Evidence: documented [10][19].
    Conflicts: Stars cost; §6.2.4; giveaways "only_new_members" tied to channel joins read close to §5.2(d)(ii)
    (INTERPRETATION); minors.
14. **Telegram Affiliate Program (MV11)** for channel owners who promote the story. Evidence: documented (M4 §2c).
    Conflicts: revenue share; no control over which audiences affiliates target (teens).

## Pitfalls / what goes wrong (sourced)

- K > 1 is rare; the largest referral dataset implies K ≈ 0.05 [11]. Do not plan growth on virality alone.
- Conditional inviter rewards → social pressure, worse invitees [14].
- Any reward a fresh account can trigger gets farmed and sold [22][20].
- Late changes to reward criteria and mass bans cause backlash (Hamster, 2024) [20][M4].
- Story links are Premium-only; non-Premium story quotas block posting [2][8][9].
- `t.me/share?url=` fails inside Mini Apps on tdesktop; use `/share/url` (M2).
- Long captions break the iOS share sheet (open bug, 2026-10) (M2).
- Inline/photo result URLs are public by definition (M2 [10]) — no paid art or paid names in a card or its URL.
- Romance players may not want public visibility of their romance [16]: sharing must be opt-in per act.

## Key claims for verification

1. Latest Bot API is 10.3 (2026-08-24); nothing newer as of 2026-10-31 — https://core.telegram.org/bots/api-changelog — DOCUMENTED.
2. shareToStory: "only premium subscribers can post stories with links"; caption 0-200 / 0-2048 — https://core.telegram.org/bots/webapps — DOCUMENTED.
3. Premium-only links in story captions and URL media areas; separate non-Premium story quotas — https://core.telegram.org/api/premium — DOCUMENTED.
4. Guest mode: @mention, ≤ 3 bots per message, any non-secret private chat/group except content-protected — https://core.telegram.org/api/bots/guest-mode — DOCUMENTED.
5. sendGift: gift "can't be converted to Telegram Stars by the receiver"; text 0-128 — https://core.telegram.org/bots/api#sendgift — DOCUMENTED.
6. giftPremiumSubscription star_count "must be 1000 for 3 months" — https://core.telegram.org/bots/api#giftpremiumsubscription — DOCUMENTED.
7. Links doc lists `mode=fullscreen` as well as `compact` — https://core.telegram.org/api/links — DOCUMENTED.
8. Extole 400 programs → K ≈ 0.049 — https://www.saxifrage.xyz/post/k-factor-benchmarks — CLAIMED.
9. Conditional referral incentives: −77.4 % referrals, 11× acceptance, invitees −30.3 % time / −76.6 % money (n = 66,427 / 97,181) — https://www.fdsm.fudan.edu.cn/en/2026/0428/c1894a33770/page.htm — MEASURED (abstract).
10. GiftAMeal field test n = 6,364, friend-benefiting marginally higher; 351 programs 40.5 / 2.6 / 55 % — https://source.washu.edu/2020/07/research-shows-how-businesses-can-win-more-customers-influence-your-friends/ — MEASURED.
11. Wordle ~100k shared grids at ~2 M players; 3.3 M tweeters, 32.2 M tweets — https://techcrunch.com/2022/05/04/wordle-new-york-times-user-growth — CLAIMED / MEASURED.
12. Spotify Wrapped 2025: ~500 M shares (+41 %), 200 M engaged users in ~24 h — https://www.musicbusinessworldwide.com/spotify-wrapped-campaign-hit-200m-engaged-users-in-24-hours-a-19-yoy-increase — CLAIMED.
13. Hamster Kombat: 131 M qualified, 2.3 M banned, 400 accounts to one address, ~2,000-friend inviter flagged — https://decrypt.co/250940/why-hamster-kombat-purged-millions-players-telegram-airdrop — CLAIMED.
14. Mediascope Jan-Jul 2024 daily reach 12-17: VK 63 %, TikTok 61 %; 12-24 Telegram 80 % — https://www.comnews.ru/content/240644/2025-08-11/2025-w33/1010/rossiyskoe-pokolenie-z-prezhnemu-predpochitaet-smotret-tiktok — MEASURED (secondary).
15. Terms §5.2(d)(ii) "Social growth manipulation" undefined; §6.2.4 Stars withheld for "suspected abuse" — https://telegram.org/tos/bot-developers — DOCUMENTED (reading = INTERPRETATION).

## Gaps (asked but no reliable source found)

- K-factor, invites per user, invite-to-install or install-to-activation for any Telegram Mini App (crypto or not).
- Share fraction of players in Episode, Choices, Клуб Романтики, Wattpad; any VN completion-card uplift.
- Uplift of image vs text shares in Telegram; retention effect of `addToHomeScreen`.
- Current Telegram gift prices for `sendGift` (read via `getAvailableGifts` on the real bot); Stars-giveaway
  eligibility thresholds (third-party claims only, not opened).
- Guest-mode client support and whether guest results may carry url buttons.
- Premium share among Russian (or female, or teen) Telegram users.
- Russian-language searches on romance fandom (VK groups of Клуб Романтики, "Мои истории"), and prior art of
  romance VNs inside TMAs: **not run — the session's web-search budget was exhausted**; tgstat/sport24 pages returned
  403/401. A follow-up session can run them.
- Otome "refusal to share a love interest" behaviour: only an unopened Cambridge item (403).

## Owner value questions this area raises (each with a default reading)

1. Share-card image: none / static per-story free art / personal result card? Default: static per-story free art at
   launch; personal card later.
2. Love-interest or archetype content in shares and quizzes? Default: no in the foundation; opt-in later, adults-only
   if the age bracket stays open.
3. Referral split (inviter 5 / invitee 2) and trigger (on the friend's chapter-1 completion)? Default: keep, revisit
   after launch data; evidence above favours a larger invitee share.
4. Official channel + group (Community) at public launch? Default: yes, one channel + one moderated discussion group.
5. Telegram Affiliate Program (MV11)? Default: not used before launch; reconsider with partner channels.
6. Group co-reading / guest mode / inline teasers? Default: later (after the foundation), behind the age decision.
7. Prize mechanics (Telegram gifts, Stars giveaways with partner channels)? Default: none in the foundation.

## Sources

[1] https://core.telegram.org/bots/api-changelog — Bot API changelog, read to 10.3 (2026-08-24); entries 10.2, 10.1, 10.0, 9.6, 9.5, 9.0, 8.3, 8.2, 8.1, 8.0, 7.10, 7.8, 7.6 quoted; read 2026-10-31. Primary.
[2] https://core.telegram.org/bots/webapps — Mini Apps doc (Recent changes top = 10.1): shareToStory, StoryShareParams, StoryWidgetLink, shareMessage, addToHomeScreen, chat_type/chat_instance, direct links, requestChat; read 2026-10-31. Primary.
[3] https://core.telegram.org/api/links — Main/direct Mini App links (`mode` compact/fullscreen), share links, referral links; read 2026-10-31. Primary.
[4] https://telegram.org/tos/bot-developers — Bot Platform Developer Terms §5.2, §6.2.4, §6.2.5 (no revision date); read 2026-10-31. Primary.
[5] https://telegram.org/blog/communities-editor-invisible-messages — Telegram blog, 2026-07-14: Communities, ephemeral bot messages. Primary.
[6] https://core.telegram.org/api/bots/guest-mode — MTProto guest mode; read 2026-10-31. Primary.
[7] https://techcrunch.com/2023/08/14/telegram-rolls-out-its-stories-feature-to-all-users/amp/ — Stories for all users, 2023-08-14. Press.
[8] https://core.telegram.org/api/premium — Premium features: story links/entities, story quota config keys; read 2026-10-31. Primary.
[9] https://bugs.telegram.org/c/60291 — "Not possible to post stories without premium" (271 votes, no official reply; year not shown). CLAIMED.
[10] https://core.telegram.org/bots/api — sendGift, getAvailableGifts, Gift, giftPremiumSubscription, Giveaway/GiveawayCreated, answerInlineQuery, SwitchInlineQueryChosenChat, CallbackQuery.chat_instance (Bot API 10.3); read 2026-10-31. Primary.
[11] https://www.saxifrage.xyz/post/k-factor-benchmarks — Michael Taylor, 2020-09-15, compilation of public K mentions (Adjust, Extole, Jelly Splash, Vohra). CLAIMED (compiler states no standards).
[12] https://techcrunch.com/2022/05/04/wordle-new-york-times-user-growth — 2022-05-04: NYT release, Twitter data scientist study, Wardle statement.
[13] https://source.washu.edu/2020/07/research-shows-how-businesses-can-win-more-customers-influence-your-friends/ — 2020-07-13, university summary of Gershon, Cryder, John, JMR 57(1) (DOI 10.1177/0022243719888440). Peer-reviewed study summary.
[14] https://www.fdsm.fudan.edu.cn/en/2026/0428/c1894a33770/page.htm — Fudan seminar abstract, Mengzhou Zhuang (HKU), 2026-05-07, mobile-game field experiment. Abstract only.
[15] https://www.pocketgamer.com/love-and-deepspace/developer-interview — Infold developer interview, 2024-01-17. CLAIMED.
[16] https://amp.kr-asia.com/otome-games-capture-hearts-but-managing-their-fandoms-is-a-delicate-act — 36Kr via KrASIA, 2024-10-08. CLAIMED.
[17] https://www.comnews.ru/content/240644/2025-08-11/2025-w33/1010/rossiyskoe-pokolenie-z-prezhnemu-predpochitaet-smotret-tiktok — ComNews 2025-08-11, Mediascope Jan-Jul 2024 via AD2X. Secondary report of panel data.
[18] https://core.telegram.org/api/gifts — MTProto gifts: profile display, conversion, limits; read 2026-10-31. Primary.
[19] https://telegram.org/blog/star-giveaways-iv-in-browser — Telegram blog 2024-09-06, Star Giveaways. Primary.
[20] https://decrypt.co/250940/why-hamster-kombat-purged-millions-players-telegram-airdrop — Decrypt 2024-09-24, team statements. CLAIMED.
[21] https://www.theblock.co/post/316195/catizen-completes-business-model-upgrade-pioneering-the-development-of-telegram-applications — The Block, 2024-09 (issuer figures; seen as search snippet, not opened in full). CLAIMED.
[22] https://vc.ru/1281633 — vc.ru 2024-07-04, promotional post selling Catizen referrals. CLAIMED (pointer).
[23] https://www.musicbusinessworldwide.com/spotify-wrapped-campaign-hit-200m-engaged-users-in-24-hours-a-19-yoy-increase — MBW 2025-12-08, Spotify figures. CLAIMED.
[24] https://www.inquirer.com/philly/living/20140312_Quizzes_go_pop.html — Philadelphia Inquirer 2014-03-12, Livingly Media VP on quiz share rates. CLAIMED.
[25] https://publishersweekly.com/pw/by-topic/international/Frankfurt-Book-Fair/article/93471-frankfurt-book-fair-2023-tracking-trends-in-international-book-sales.html — Publishers Weekly 2023-10-19, NielsenIQ statement. Vendor panel.
[M2] D:/tmp/novel-orch/design/choices/research_M2.md — prior research (sharing, 2026-10-31), re-used; Bot API facts re-verified above.
[M4] D:/tmp/novel-orch/design/choices/research_M4.md §2c, §3 — prior research (affiliate, referral practice, signals), re-used.
[META-PLAN] D:/claude/tg-app-novel/.claude/worktrees/design-choices/docs/META-PLAN.md §D M10-M16, §E M22-M23 — planned features (read-only).
