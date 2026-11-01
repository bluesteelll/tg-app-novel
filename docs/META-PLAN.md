# Architecture: choice capture, achievements, the completion card, the Telegram social foundation, the economy foundation and the privacy policy

Date 2026-10-31. Source: `D:/tmp/novel-orch/design/choices/spec.md` (RULINGS 24, 25) and research
`design/choices/research_M1.md` … `research_M4.md` (cited [M1 §n] … [M4 §n]). Trunk at design time: `main` = `698993e`
(the design worktree branched at `0e4bedb` plus the owner rulings `665632d`). This plan extends
[PROTOTYPE-PLAN.md](PROTOTYPE-PLAN.md) (PP, decisions K*), [PUZZLES-PLAN.md](PUZZLES-PLAN.md) (PZ, X*) and
[STORIES-PLAN.md](STORIES-PLAN.md) (SP, Y*). Its decisions are **M1–M28**. Every place in those plans that this design
changes is marked "Changed by META-PLAN" there. The lane cut (new and re-cut lanes, locks, dependency order) lives in
PP "Implementation plan — THE LANE CUT"; this file holds the design and a summary of the cut.

---

## State at design time (what is already done)

- **Merged into `main`:** L1 client-shell, L2 server-skeleton, L4a server-auth, L3a staging-dsl, L3b story-compile,
  LW1 puzzle-dsl, L4b server-dev, L6a server-saves, LDB0 pg-dev-cluster, LW2 world-model, LDB1 db-port, LDB2
  pgdev-tune, L6b server-content (`698993e`: the story index, chapter products priced from it, `GET
  /api/entitlements`, paid chapters and paid assets behind the entitlement check; cut by RULINGS 25: no hint-tier
  products, `ProductRef` has the single variant `Chapter`), and the design merges design/puzzles, design/stories and
  docs-errata. 13 of the 38 planned lanes were merged when this design started.
- **Running at design start, merged since:** L3c story-locales (client), merged into `main` as `91e35cd` while this
  design was written; this design changes nothing in it. Now 14 of the 47 lanes are merged, none runs, 33 are to go.
- **Owner rulings this design implements:** RULINGS 24 (Q23 keep the data and draft a test privacy policy; Q24 capture
  choices from day one; Q25 no ending count before or outside the card; separate achievements per story; the card
  shows only the endings found and only the player's own statistics; it opens at an ending and from Home after the
  first ending; sharing and seeing friends' statistics through Telegram, as a foundation) and RULINGS 25 (a generic
  resource foundation with placeholder amounts; hints bought in Stars packs into a balance, replacing PZ's per-tier hint
  products; gifts to friends with a daily limit; a referral bonus when the invited newcomer completes the first chapter
  of a story, on server-side evidence).
- **Not started:** everything else. Every lane this design re-cuts is unstarted. L3c runs on and gets no mid-flight
  change (it has merged since, unchanged); merged lanes keep their history.

---

## Goal

The player:
1. plays a story; every choice they make is recorded by its stable line ID (no text, no ink index);
2. reaches an ending → "The End" → the **completion card** opens: the endings of this story they have found (titles
   only, no total, no empty slots), the achievements they have unlocked (new ones marked), their runs and completed
   chapters; Back returns to "The End";
3. later opens the same card from the story's card on Home ("Прохождение"), which appears after their first ending;
4. invites a friend or shares their progress into a Telegram chat; the friend taps the message, opens the Mini App
   and sends a friend request; the inviter accepts that person; each sees the other in Friends (revision 1, C1);
5. turns on "show my progress to friends" (a separate consent, off by default) and sees a friend's progress if that
   friend turned theirs on;
6. buys a hint pack for (mock) Stars, spends one hint on a puzzle tier, gifts a hint to a friend;
7. invites a newcomer who completes the first chapter of a story: both get the referral bonus;
8. reads the privacy policy from the app, the bot (`/privacy`) and Telegram's Privacy Policy button.

**Correctness targets** — each is a gate:

| # | Target | Proved by |
|---|---|---|
| MT1 | A choice event names the picked option by its line ID; it is stored once per (user, event id), only if the option belongs to the event's chapter in the server's vocabulary, and a paid chapter's option needs the entitlement first; choice volume never refuses or evicts a fact event (`chapter_*`, `ending_reached`, `puzzle_ended`) or a user's first pick of an option (revision 1, W2) | `schema_stat_events_choice_in_chapter`, `stats_choice_shape_checked`, `stats_cap_does_not_refuse_facts`, `stats_choice_over_budget_keeps_first_picks` (LS3); `reporter: queue full of choices keeps ending_reached` (LS4); `stats_unknown_choice_rejected`, `stats_paid_choice_needs_entitlement_first` (LM2) |
| MT2 | No response a client can read carries the number of endings of a story (Q25) | `stats_response_has_no_endings_total` (LS3); `card_has_no_endings_total` (LM2); `card: no total or empty slots` (LU1) |
| MT3 | Ending titles, achievement names and descriptions are server-only; an item gated on a paid chapter reaches only a viewer who owns it | `emit: meta texts only in server outputs`, `scan: meta text in dist fails` (LM1); `card_paid_titles_need_entitlement` (LM2); `friend_profile_paid_titles_need_viewer_entitlement` (LF2) |
| MT4 | Achievements are display facts: an unlock is stored once and reported `new` once, and nothing reads an unlock to grant anything | `card_unlock_persists_and_new_once`, `card_concurrent_posts_new_once` (LM2); review rule: `db/achievements.rs` is called only from `api/cards.rs` and `api/social.rs` |
| MT5 | A friendship needs two acts aimed at one person: the requester's request through the code's owner's link and the owner's accept of that requester; a decline or a removal is durable against every later request of the removed user; a friend's progress is visible only to friends and only while that friend's separate, revocable consent stands; every consent row names the policy version and the consent text version (revision 1, C1), and that version fixes every policy content value: none is read from the host file, and each version has exactly one pinned template text (revision 2, W1) | `friendship_needs_inviter_accept`, `unfriend_is_durable_against_old_code`, `decline_is_durable_against_old_code`, `consent_records_policy_version` (LF1); `friend_profile_private_by_default`, `consent_withdrawal_hides_profile`, `friend_profile_404_for_non_friend` (LF2); revision 2: `privacy_operator_content_key_refused`, `api::legal::tests::policy_template_pinned_per_version` (LPO); revision 3: `api::legal::tests::pin_check_rejects_non_increasing_versions`, `api::legal::tests::pin_check_rejects_last_not_meta`, `api::legal::tests::pin_check_rejects_hash_mismatch` (LPO) |
| MT6 | A share carries no paid content and no ending or achievement title; invite codes are 128-bit, revocable, and a revoked code creates nothing; a code tells its holder nothing about its owner; no response carries another user's Telegram id (revision 1, C1, W1) | `share_text_has_no_titles` (LF2); `revoked_code_creates_nothing`, `invite_view_reveals_nothing_about_owner`, `social_dto_has_no_telegram_id` (LF1); e2e `social: share sends a prepared message without titles` (LMI) |
| MT7 | Attribution comes only from the verified initData `start_param`, and a referral only on the invitee's first launch | `initdata::tests::start_param_from_signed_string`, `referral_attributed_on_first_login_only` (LF1) |
| MT8 | A balance never goes negative; per (user, kind) `balance − debt = Σ ledger.amount` | `schema_balance_never_negative`, `balance_never_negative_concurrent_spends`, `ledger_reconciles_with_balances` (LE1) |
| MT9 | A pack credits exactly once per charge, inside the grant transaction, the kind and amount bound to its order when the order was created; a refund claws back what that charge credited (its `pay:<charge>` ledger row) — the unspent part, the rest as debt; neither path reads the current catalog (revision 1, W3) | `pack_credit_once_on_duplicate_payment`, `pack_grant_credits_in_the_grant_transaction`, `pack_credit_uses_amount_bound_at_order` (LE1); `refund_pack_claws_back_unspent`, `refund_spent_pack_records_debt`, `refund_claws_back_the_credited_amount` (L9) |
| MT10 | A hint tier is unlocked once and debited once, in tier order, never after the puzzle is solved | `hint_spend_concurrent_debits_once`, `hint_spend_needs_previous_tier`, `hint_spend_after_solve_409` (LE1) |
| MT11 | A gift moves only between friends, once per request id, within the daily caps, in one transaction | `gift_requires_friendship`, `gift_replay_moves_once`, `gift_daily_send_cap_429`, `gift_concurrent_same_sender_respects_cap` (LE2) |
| MT12 | A referral bonus needs server-observed evidence (a recorded completion of a story's first chapter and a stats batch received ≥ 120 s after that chapter's first start), is re-evaluated on every later batch until it qualifies (a failed hook loses nothing), is granted once per invitee and is capped per inviter (revision 1, W5) | `referral_needs_min_play_gap`, `referral_grants_both_once`, `referral_cap_per_inviter_day`, `referral_concurrent_batches_grant_once`, `referral_qualifies_after_hook_failure` (LE2) |
| MT13 | The privacy policy is reachable without a token, carries its version, and is linked from the app, the bot and the BotFather profile; its operator identity facts come from a file outside the repository and its content values never do (MT5; revision 2, W1), and a production server refuses to start while a placeholder remains (revision 1, W4) | `privacy_page_served_with_version`, `privacy_page_needs_no_token` (LF1); `privacy_placeholder_refuses_prod_start` (LPO); `privacy_command_links_policy` (L9); e2e `meta: privacy link opens through openLink` (LMI) |

**Budget targets** (numbers and gates in [Budgets and validation](#budgets-and-validation)):
- entry closure ≤ 40 KB br, unchanged; this change adds about 2.9 KB br (the meta controller, its services and
  decoders); the meta UI is one lazy chunk ≤ 14 KB br that never loads before the first line;
- all JS ≤ 305 KB br (was 290: + the 14 KB meta chunk, + 1 KB of slack); JS before the first line ≤ 270 KB br,
  unchanged; first-load ≤ 800 KB per story, unchanged (+2.9 KB); time to first line ≤ 6 s, unchanged (+≈15 ms at
  1.6 Mbps); no extra tap;
- steady memory: the meta UI is DOM, < 0.5 MiB with its data → ≤ 138.6 MiB (145.3 MB) < 150 MB (principle 4);
- server: the card is ≤ 5 statements; a friend profile ≤ 7; a hint spend one transaction of ≤ 6 statements; a gift one
  transaction of ≤ 9 after one handle read; the stats POST gains one statement per batch (the referral probe by PK with
  its evidence, M23; revision 1, W5) and, only for a batch over the choice budget, one indexed read (first picks, M3;
  revision 1, W2); nothing new on the pre-checkout path (it gets shorter: M19).

---

## Context and constraints

**Subsystems touched.**
- Statistics: SP Y8–Y16 (`stat_events`, `POST /api/stats/events`, `GET /api/stats`, the reporter).
- Story tool: `client/scripts/story/*` (`classify.ts` gives every choice line with its weave depth, knot, stitch and
  ID; `graph.ts`; `emit.ts`; the lint), the STAGING-DSL contract (v2, frozen by RULINGS 13 PE3, reopened only by an
  owning lane with a stated reason).
- Server: `auth/initdata.rs` (the whole data-check-string is verified, so `start_param` is already signed), `api/auth.rs`,
  `db/users.rs` (one upsert statement), the payment path K18–K20, `catalog.rs` (`ProductRef::Chapter` only, as merged),
  `content.rs` (`ContentStore`), the puzzle routes of L6c, the bot (L9), the dev crate (`/dev/launch`, the fake gateway,
  `/dev/simulate-payment`).
- Client: the Telegram facade (L7), the overlay stack (L14a, K26), Home and "The End" (L14b, SP Y14), the puzzle session
  and hint ladder (LP2), the purchase flow (L10), GameSession (L15).

**Principles, by number.**
- **0** — meta texts can name paid endings and paid puzzles: they are server-only, gated per viewer, never in a share.
- **1** — achievements, the card and friend profiles are display; nothing unlocks from them. Balances live on the
  server; the client never computes one.
- **2** — packs ride the existing grant: only `successful_payment`, only through the idempotent charge-id insert, the
  credit in the same transaction; refunds claw back.
- **3** — `start_param` is read from the verified initData only; `initDataUnsafe.start_param` drives UX hints, never an
  identity or attribution decision (as merged, L7 `57e1424`, cut Q1: the client's `startParam()` parses the hint from
  the raw `initData` string, since the arch rule `init-data-unsafe` forbids reading `initDataUnsafe`). Revision 1
  (C1): the invite code it carries is also what the client presents to
  `GET` / `POST /api/invites/{code}` — a bearer capability to *ask* the code's owner, validated by the server like any
  request input; who the caller is still comes only from the bearer token.
- **4** — the meta UI is a lazy chunk; nothing new loads before the first line except 2.9 KB br in the entry.
- **5** — shares use `shareMessage` (8.0+) or `openTelegramLink`; the policy opens with `openLink` from a tap; no
  `window.open`; every overlay closes with BackButton.
- **6** — one Bot API call (`savePreparedInlineMessage`) and one lookup (`getMe`) through frankenstein types behind
  `BotGateway`; three facade methods; no SDK wrapper; no inline-query handler.
- **7** — capture reads the runner's choice step; the scene never reads the meta state.
- **8** — meta texts are written in ru and en (inline in `story/meta.json`, M4); UI strings in a locale table.

**Rulings and invariants that must survive.** RULINGS 14 (PostgreSQL 18, READ COMMITTED, named constraints, BIGINT,
unix seconds, the payer-row lock, `$n` binds, U+0000 → U+FFFD at the `db/` boundary); RULINGS 18 (≤ 3 lanes: 1 server +
2 client); RULINGS 25 (L6b built no hint products); K19's "the ONLY grant path is the charge-id insert"; SP ST4
(statistics never unlock); SP Y10's order "entitlement before subject"; PZ X5/X7 (solutions and hint texts server-only);
the frozen DSL tag language (no tag changes here).

**Platform facts this design relies on** (verified in research M1–M4):
- `WebApp.shareMessage(id)` exists from Bot API 8.0; the client posts `web_app_send_prepared_message {id}` and Telegram
  answers `prepared_message_sent` / `prepared_message_failed {error}` (re-emitted as `shareMessageSent` /
  `shareMessageFailed`), errors `UNSUPPORTED`, `MESSAGE_EXPIRED`, `MESSAGE_SEND_FAILED`, `USER_DECLINED`,
  `UNKNOWN_ERROR` [M2 §1]. Read in `telegram-web-app.js` (2026-10-31).
- `savePreparedInlineMessage(user_id, result, allow_user_chats, allow_bot_chats, allow_group_chats,
  allow_channel_chats)` → `PreparedInlineMessage { id, expiration_date }`; Telegram states no lifetime; the shared
  message cannot carry a `web_app` button (private chats with the bot only), so the way back is a `url` button to
  `https://t.me/<bot>?startapp=<p>` [M2 §1]. frankenstein 0.52.1 has `save_prepared_inline_message` and
  `InlineQueryResultArticle` with a builder [M2; docs.rs].
- `openTelegramLink("https://t.me/share/url?url=…&text=…")` works from 6.1 with no bot setting [M2 §1]; `openLink(url)`
  from 6.1 (it uses `window.open` only below 6.1, which the facade refuses).
- `start_param` is a field of the signed initData; the safe envelope is ≤ 64 characters of `[A-Za-z0-9_-]` [M2 §3].
- A Mini App can learn nothing about the user's contacts: "friends" must be the app's own table [M2 TL;DR].
- Revision 1 (W6): CloudStorage is Telegram-hosted ("the cloud storage … up to 1024 items per user"); only
  DeviceStorage (Bot API 9.0+) is "persistent local storage on the user's device" (core.telegram.org/bots/webapps,
  read 2026-10-31). PP K13 keeps the settings and the read-set in CloudStorage, and SP Y7 / Y13 the pending autosaves
  and the stats queue in DeviceStorage.
- Telegram rules: an own privacy policy is required, set in @BotFather, and shown by the Mini App's automatic Privacy
  Policy button (§4); data deleted on request (§4.2(a)); no "social growth manipulation" or MLM (§5.2(d)); no Telegram
  rule on in-app currencies, gifting or referral rewards [M3 §1; M4 TL;DR]. Telegram's ToS: users in the EU must be 18+
  [M3 §1].
- 152-FZ: a consent is "оформлено отдельно" (art. 9 p. 1, 156-FZ); friends-only visibility reads as *provision* to a
  defined circle, a public link as *distribution* needing an art. 10.1 consent (an INTERPRETATION, lawyer item) [M3 §2].
- PostgreSQL READ COMMITTED: `UPDATE … SET balance = balance - n WHERE … AND balance >= n` re-evaluates WHERE on the
  committed row (0 rows = insufficient); a CHECK sees one row only [M4 §1a]. PostgreSQL 18 adds `OLD` / `NEW` in
  `RETURNING` (used once, M11; verified against the dev cluster by the lane's schema test).
- No account-age signal exists in a Mini App [M4 TL;DR].

**Platform differences.** iOS WKWebView, Android WebView and Desktop all support `shareMessage` from client 8.0; an
older client or `UNSUPPORTED` takes the `t.me/share/url` path. An open iOS client issue reports the share sheet not
opening on iOS 16.7 [M2 §1]: the same fallback covers it (a failed or unanswered share offers "Send as link" after 10 s).

---

## Key decisions

### A. Choice capture (Q24)

**M1. A fifth event kind, `choice_made`: the picked option's line ID, nothing else.**
- **What.**
  - The reporter records `{ kind: 'choice_made', chapterId, storyVersion, option }` when the player picks a choice;
    `option` is that choice's `#id:` line ID (STAGING-DSL §3.4, §4), sent as the event's `subject`. Every pick is a new
    event with a new client UUID (SP Y13), replays and sticky re-picks included.
  - The choice *point* is not sent: the server derives it from the option through the vocabulary (M2). The story is
    derived from the chapter (SP Y10); `storyVersion` is shape-checked only (older builds report legitimately).
  - `0003_stats.sql` (LS3) admits the kind: `stat_events_kind_known` gains `'choice_made'`;
    `stat_events_subject_by_kind` gains `(kind = 'choice_made' AND subject ~ '<line-ID grammar>' AND outcome IS NULL)`;
    a new `stat_events_choice_in_chapter CHECK (kind <> 'choice_made' OR split_part(subject, '.', 1) = chapter_id)`.
  - Rust: `StatKind::ChoiceMade`; `StatRejectReason::UnknownChoice` is declared in LS3 (so the DTO never changes after
    LS4 decodes it). LS3 accepts a well-formed option of the event's chapter; LM2 adds the vocabulary check (M2).
  - Check order per event: `unknown_chapter` → `not_entitled` → `unknown_choice` (Y10's order: a non-buyer learns
    nothing about paid option IDs).
- **Why.** The line ID is the only identity that survives text edits and translation (principle 8) and it already
  exists on every choice with text (`id/missing`). Ink indices change with every edited choice block. Sending only
  the option keeps the event 160 B and the client free of a second vocabulary. The `split_part` CHECK makes "an option
  of another chapter" impossible in the table, not just in code.
- **Alternatives.** Point + option in the event (a second client-side identity that can disagree with the build);
  the option text (free text in the log; Y9 forbids it); a separate `choice_events` table (a second write path and a
  second cap for one more kind).
- **Trade-off.** Choice picks are client-reported like every other stat (SP Y10): a forged client can add picks of
  real options, bounded by the 600/h cap; they never unlock anything.

**M2. A choice point is one weave level of one knot or stitch; the vocabulary is server-only build output.**
- **What.**
  - The story tool (LM1, `scripts/story/meta.ts`) walks each chapter's classified lines (`classify.ts`). The options at
    weave depth *d* inside one knot or stitch form one point until a gather of depth ≤ *d*, a knot header or a stitch
    header ends it; deeper options open their own points and are transparent to the outer one. Conditional and
    sequence block lines are transparent. Fallback choices carry no ID and are not options.
  - The point id is the first option's ID in source order in the current build.
  - Output: `server/content/meta.json` `choices: { "<chapter>": { "<optionId>": "<pointId>" } }` for every chapter,
    free and paid. This map is the closed vocabulary (LM2 rejects an option absent from it as `unknown_choice`). It
    never enters a client output (MT3).
- **Why.** Threads and tunnels are forbidden (STAGING-DSL §10), so the options shown together at runtime are exactly
  the options of one weave level in source: the static grouping is the runtime grouping. A paid chapter's option IDs
  are paid vocabulary (principle 0); free chapters' IDs are public anyway (they are in the free story JSON), but one
  map for all chapters keeps one code path.
- **Alternatives.** Points declared by a tag (reopens the frozen tag language for a fact the source already states);
  points computed at runtime in the client (the vocabulary would have to ship).
- **Trade-off.** Editing the first option of a point moves the point id in the next build; old rows keep their option
  IDs, so a later aggregate re-maps them through the build that recorded them (`storyVersion`). Recorded for the
  aggregate lane (Later).

**M3. Counting: every pick is logged; "X % chose this" counts the first pick per player and point, later.**
- **What.**
  - Nothing is aggregated now. The later aggregate (Later row) reads, per (user, point), the earliest pick by
    `received_at − age_ms` and divides by the number of players with any pick at that point.
  - Volume: the demo has about 15 options picked per run and about 4 runs per player before every ending is found →
    ≈ 80 rows per player; at 5,000 players 400 k rows ≈ 70 MB with the two indexes. A full game (≈ 150 picks per run,
    4 runs) ≈ 600 rows per player → 3 M rows ≈ 0.75 GB at 5,000 players: still one table, no partitioning.
  - Wire: a choice event is ≈ 160 B; the batch of 32 is 5.1 KB (< the 16 KB body limit); the DeviceStorage queue of 64
    is ≈ 14 KB, unchanged.
  - Rate (revision 1, W2). A first run is read at reading pace (PP skip mode stops at unread lines and at choices), so
    a fast reader picks about one option per 20 s: ≤ 180 per hour. A replay in skip mode — the loop the card exists for
    (Q25) — advances read lines at once and pauses only at choices: about one pick per 3 s, ≈ 1,200 per hour at the
    full-game scale, twice SP's shared cap of 600. So choice events get their own budget and never touch the facts'
    (SP Y11, Y13, changed by this revision): facts (`chapter_*`, `ending_reached`, `puzzle_ended`) keep 600 per rolling
    hour and the batch-level 429, counted over fact rows only; `choice_made` has 600 per rolling hour of its own and
    never causes a 429 — beyond it a pick is still recorded if it is the user's first pick of that option, otherwise it
    is rejected `rate_limited` and the client drops it; the client queue evicts choice events before facts and puts
    facts first in a batch. A replay session therefore keeps every ending, every completion and every first pick (the
    `choice` achievements of M5 need nothing else) and loses only repeat picks beyond 600 per hour.
- **Why.** First-pick semantics answer the question players mean ("what did people choose the first time") and are
  immune to replay farming; logging every pick keeps the replay behaviour itself measurable (up to 600 repeat picks per
  hour, revision 1).
- **Alternatives.** Only the first pick per point on the client (needs the vocabulary on the client); a projection
  table now (no reader; SP Y8's argument).
- **Trade-off.** The aggregate needs one `DISTINCT ON` scan per chapter; at 3 M rows that is a batch job, not a live
  query.

### B. Achievements (Q26 framework)

**M4. Source: `story/meta.json`, written by the narrative-designer: per story, the ending titles and the achievements,
with their texts inline in ru and en.**
- **What.**
  ```jsonc
  // story/meta.json
  { "manor": {
      "endings": { "truth": { "ru": "…", "en": "…" }, "ashes": { "ru": "…", "en": "…" } },
      "achievements": {
        "drawer_no_hints": { "hidden": false, "when": { "puzzle": "ch1.drawer", "hints": 0 },
                             "name": { "ru": "…", "en": "…" }, "desc": { "ru": "…", "en": "…" } } } } }
  ```
  - Ids `^[a-z][a-z0-9_]{0,31}$`, unique per story, ≤ 50 per story; the object order is the display order.
  - Every ending declared in `story/stories.json` has a title (1–40 code points, ru and en); no title for an undeclared
    ending. Names 1–40, descriptions 1–140 code points; `hidden` is a boolean (reserved for a later "all
    achievements" list; the card shows unlocked items only, M7).
  - The lint code `catalog/meta` (E) checks the file (rules in [Source file](#source-file--storymetajson)); it joins
    `LINT_CODES` and STAGING-DSL §11 in LM1 (the one DSL reopen of this design, M28).
  - No ink tag.
- **Why.** The texts are server-only (principle 0, M7), so they must never pass through the public locale pipeline:
  L3c's `locales.ts` reads `story/locales/**` into public tables and refuses unknown `story.json` sections, and an
  en file there is read as a chapter table. Keeping them in a file the public emitter never reads makes a routing
  fault through the locale tables impossible by construction, and touches neither L3c (running) nor LS1. Inline
  `{ ru, en }` is the shape of every server-side text format already (the story index titles, the puzzle hints).
  An ink tag would reopen the frozen tag language for facts that are catalog data, not staging.
- **Alternatives.** New sections in `story.json` (edits `locales.ts` and `locales.test.ts`, two more lanes on the same
  files, and a server-only section inside a public table); an `# achievement:` tag (DSL reopen; the condition is about
  the whole story, not a line).
- **Trade-off.** Translators edit two places (the locale tables for ink, `meta.json` for meta). The lint makes a
  missing en text an error, so nothing is silently untranslated.

**M5. Conditions: seven kinds over facts the server has.**
- **What.** A condition is an object with exactly one key (`hints` only next to `puzzle`):

  | Condition | Met when | Facts (server) |
  |---|---|---|
  | `{ "ending": <EndingName> }` | that ending of this story was reached | `ending_reached` rows |
  | `{ "endings": n }` | n distinct endings of this story were reached (1 ≤ n ≤ the story's ending count) | `ending_reached` rows |
  | `{ "allEndings": true }` | every ending declared in the current index | `ending_reached` rows + the index |
  | `{ "choice": <LineId> }` | that option was picked at least once (an option of a chapter of this story) | `choice_made` rows |
  | `{ "chapter": <ChapterId> }` | that chapter was completed (SP F12: `chapter_completed`, or an ending in it) | stat rows |
  | `{ "puzzle": <PuzzleId> [, "hints": 0] }` | the puzzle is solved; with `hints: 0`, no hint tier of it was unlocked | `puzzle_progress.solved_at`, `hint_unlocks` |
  | `{ "all": [c1 … c4] }` | 2–4 conditions of the kinds above (no nested `all`) all hold | — |
- **Why.** These are the owner's examples (all endings found, a puzzle without hints, a specific choice) plus the
  facts already recorded. Puzzle facts come from the server's own tables, so the "without hints" achievement is not
  even client-reported. `all` with no nesting keeps evaluation linear and the lint finite; no `any`/`not` until a
  writer needs them.
- **Alternatives.** A small expression language (an evaluator and a parser for two prototype stories); counters such
  as "10 runs" (no owner example; `runs` is shown on the card instead).
- **Trade-off.** "Never did X" is not expressible; a writer models it with a positive fact (a choice or an ending).

**M6. Evaluation on the server, when the card is requested; unlocks persisted, display only.**
- **What.**
  - `POST /api/stories/{storyId}/card` (LM2) reads, per user and story: the stat facts (one grouped index scan:
    endings, completed chapters, picked options with their first times, the run count = `ending_reached` rows); the
    puzzle facts of the story's puzzles (`puzzle_progress` + the `hint_unlocks` count); the user's entitlements; the
    persisted unlocks. Rust evaluates every achievement of the story's meta (a pure function), inserts the newly met
    ones into `achievement_unlocks` with `ON CONFLICT DO NOTHING RETURNING achievement_id`, and marks exactly the
    returned ones `new: true`. Five statements; each autocommits; repeating the call changes nothing.
  - An unlock stays once stored: a later edit of the condition or a refund does not remove it (it can be hidden, M7).
    An achievement id absent from the current meta is not shown (retired).
  - A friend's view (M13) reads that friend's **persisted** unlocks only; it never evaluates for someone else.
  - Achievements grant nothing: no resource, no unlock, no price change. `db/achievements.rs` is called only from
    `api/cards.rs` and `api/social.rs` (review rule; FEATURE_MAP).
- **Why.** Principle 1: the facts are display facts, so the evaluation is display. Evaluating at read keeps the
  stats write path untouched (SP Y11's three statements) and the meta file the single definition. Persisting gives the
  "new" badge, the unlock time, and stable friend views.
- **Alternatives.** Evaluate on every stats POST (a meta read on the write path of every event, for a screen read at
  endings only); evaluate on the client (it would need the texts and conditions: principle 0); no persistence (no
  "new", no unlock time, and a friend view would evaluate another user's facts).
- **Trade-off.** An unlock time is the card request's time, not the moment the fact happened; the card opens at the
  ending, so the two are seconds apart in practice.

**M7. Secrecy: every meta text is server-only; paid-gated items reach only entitled viewers.**
- **What.**
  - The gate of an item is the set of paid chapters its condition names: `ending` → the ending's chapter; `choice` →
    the option's chapter; `chapter` → itself; `puzzle` → its chapter; `allEndings` → every chapter holding an ending of
    the story; `endings: n` → none; `all` → the union. An ending title's gate is its chapter.
  - The server computes the gate from the content index at startup (`meta::gate`). An item is shown to a viewer only
    if every gated chapter is free or owned by that viewer now.
  - The card lists only unlocked achievements and found endings; nothing is listed as locked, hidden or missing.
- **Why.** Principle 0: a paid ending's title or a paid puzzle's achievement text is paid content. "Owned now" makes a
  refund hide what it revoked. A non-buyer cannot even learn that a paid item exists.
- **Alternatives.** Gates written by hand in `meta.json` (a writer can forget one); showing everything the user
  unlocked regardless of ownership (a refunded buyer keeps paid titles; principle 0 trades against a cosmetic).
- **Trade-off.** After a refund the player's card loses the paid items until they buy the chapter again.

**M8. Ending titles are server-only and `endingsTotal` leaves the API.**
- **What.** `StatsResponse` loses `endingsTotal` in both `StoryStatsDto` and `GameStatsDto` (LS3 re-cut, before any
  client decodes it). `endingsReached` (names of the endings this user reached) stays; the titles exist only in the
  card. `chaptersTotal` and `storiesTotal` stay (the public catalog lists every chapter anyway).
- **Why.** Q25: the number of endings is never shown outside the card, and the card shows only found ones. A count in
  an API is a count in the client.
- **Alternatives.** Keep the field and not render it (anyone reads it in devtools).
- **Trade-off.** SP's "X of Y" foundation becomes "X found"; a later owner value can bring a total back.

### C. The completion card (Q22, Q25)

**M9. One per-story card endpoint; the card opens automatically at an ending and from Home after the first ending.**
- **What.**
  - API: `POST /api/stories/{storyId}/card` → `CardResponse { storyId, runs, chaptersCompleted: ChapterId[],
    endings: [{ name, title: { ru, en }, firstReachedAt }], achievements: [{ id, name: { ru, en }, description: { ru, en },
    unlockedAt, new }] }`; `private, no-store`; POST because it may write unlocks (M6), idempotent by construction.
  - At a declared ending's END (SP F4′): GameSession shows `Notice` `the_end` with two actions, "Прохождение" and "К
    историям"; it awaits `reporter.settle({ timeoutMs: 3000 })` (LS4: flush now, resolve when the queue is empty or the
    time is up) and then requests the card. A confirmed flush pushes the `card` overlay over `the_end`; Back closes it
    to `the_end`. A flush not confirmed in 3 s, or a failed card request, leaves `the_end` with its "Прохождение"
    action (which retries settle + card) and a toast `meta.card_later`.
  - From Home: `StoryPicker` shows "Прохождение" on a story's card iff `GET /api/stats` lists at least one
    `endingsReached` for it (fetched at boot in parallel, never awaited before the first line), or an ending was
    reached in this session.
  - The card shows own statistics only (no community numbers), the found endings by title, the unlocked achievements
    (new ones marked), runs and completed chapters, and a Share button (M14).
- **Why.** Q25's replay loop needs the card at the moment of the ending. `settle` makes the just-reached ending appear
  on the card without a second request. A per-story endpoint returns ≤ one story's meta (≤ 16 KB worst case at 50
  achievements, typically < 2 KB); a game-wide card would ship every story's texts to read one.
- **Alternatives.** Extend `GET /api/stats` (a GET that writes unlocks; every boot would pay for the texts); render
  the card from client facts (texts would ship).
- **Trade-off.** The card costs one request at each ending (≤ 5 statements, M6).

### D. Sharing and friends through Telegram (the social foundation)

**M10. Friends are our own table: a link holder asks, the link's owner accepts that person (rewritten in revision 1:
C1, W1).**
- **What.**
  - Every user has one active invite code: 128 random bits from `getrandom` as 32 lower-case hex. The invite link is
    `https://t.me/<bot_username>?startapp=f<code>` (33 characters, inside the 64-character safe envelope). The main
    Mini App link is used, not a named app (no BotFather app setup).
  - The code is a bearer capability to *ask*, never to join. Launching with it creates no friend request (M11 records
    only a newcomer's referral). The client, seeing `f<code>` in `startParam()`, reads `GET /api/invites/{code}`
    (`InviteView { state: open | requested | friends | own }`; nothing about the owner) and, for `open`, shows the
    `invite` prompt (`InvitePrompt`): it names nobody, and says that the person who shared the link will see the
    player's first name and that a friendship forms only if that person accepts. "Send" →
    `POST /api/invites/{code}/request` → one pending request from the player to the code's owner.
  - The owner sees each incoming request in Friends (the requester's first name, under a handle) and accepts or
    declines that person; Accept makes one `friendships (user_lo < user_hi)` row. A friendship therefore needs two acts
    aimed at one person: the requester's Send and the owner's Accept.
  - Durable "no": a decline and a removal (`DELETE /api/friends/{handle}`, from either side) write `friend_blocks
    (user_id = the remover, blocked_id = the other)`. While it stands, the blocked user's requests through any code of
    the remover create nothing and are answered `requested`, exactly like a pending one (the blocked side learns
    nothing). The remover lifts it only by their own act: a request to that person through that person's link.
    `POST /api/invite/rotate` revokes the active code and issues a new one; pending requests stay until handled.
  - Identity (W1): no other user ever receives a Telegram user id. Friends and requests are addressed by a handle
    (`user_handles`: 96 random bits as 24 lower-case hex, one per user, created when the user first sends or accepts a
    request), the only user identifier in DTOs, paths and `GiftRequest.to`.
  - Who sees what: the requester's first name and handle reach the code's owner only, by the requester's Send; the
    owner's first name and handle reach nobody until the owner accepts; after that the two see each other in Friends.
    A link holder learns nothing about the owner.
  - Limits (engineering constants, owner values with defaults in Open questions): 200 friends per user; 50 pending
    incoming requests per user (further requests create nothing and are answered `requested`); 10 rotations per user
    per rolling day.
- **Why.** A Mini App cannot read contacts [M2]; every TMA friend list is an invite table. A share reaches an
  indefinite circle (a group, a forward, a channel); under ask-then-accept that circle can only ask, and every friend is
  an account the player individually accepted or asked — the defined circle on which M12's "provision, no art. 10.1"
  rests [M3 §2 (a): "visible only to accounts the player accepted as friends"] — and nobody becomes visible to anyone
  by someone else's act (Telegram §5.2(i), 152-FZ). 128 bits make the code unguessable (no enumeration); the block
  makes a "no" final; rotation stops a leaked link from producing further requests. A random handle instead of the
  Telegram id keeps a stable cross-service identifier (resolvable by bots and leaked id → phone sets) out of every
  counterpart's hands for one indexed lookup per social route.
- **Alternatives.** The inviter's request created by the launch (revision 0: every holder of a forwarded link became a
  friend with one tap and received the inviter's first name and Telegram id, and a removal was undone by reopening the
  old message — C1); a single-use or short-lived code (a group share then serves the first tapper only, and who taps
  is still not the inviter's choice); the inviter's first name in the prompt (a disclosure to every holder of the
  link); the Telegram id as the handle (W1); `requestChat` with `request_users` (Bot API 9.6: shares third parties' ids
  without their consent [M2 §3]); a one-way "invited by" edge (the invitee never agreed to be visible);
  `chat_instance` co-presence (only on direct-link launches, unverified across members [M2 §3]).
- **Trade-off.** One more tap for the inviter per friend, and a friendship forms only when the inviter next opens
  Friends (no bot notification in the foundation); a recipient of a forward that hides its author asks without knowing
  whom (the prompt says so); there is no search (deliberately: no enumeration surface).

**M11. Attribution at `POST /api/auth`, from the verified initData only.**
- **What.**
  - `InitData` gains `start_param: Option<String>` (LF1; the HMAC already covers it). `f` + 32 lower-case hex is an
    invite code; anything else is ignored (reserved for later prefixes).
  - The users upsert returns whether it inserted the row: `RETURNING old.id IS NULL AS inserted` (PostgreSQL 18 `OLD`
    in `RETURNING`; `old` is NULL for an inserted row). Newcomer = inserted by this call.
  - Without a code: the one upsert statement, as today. With a code: one transaction — the upsert; if the user is a
    newcomer: the active code's owner (`revoked_at IS NULL`) and, if the owner is not the user, `INSERT INTO referrals
    (invitee, inviter, attributed_at) … ON CONFLICT DO NOTHING`. ≤ 3 statements. Revision 1 (C1): the launch creates
    no friend request; asking is the player's own act (M10, `POST /api/invites/{code}/request`).
  - `AuthResponse` is unchanged; the client learns the invite's state from `GET /api/invites/{code}` (M10).
- **Why.** Principle 3: `initDataUnsafe` is never trusted, and the signed string already holds `start_param`. "First
  launch only" is a property of the `users` row, the only identity the server has. The returned flag avoids a second
  read and the same-second ambiguity of comparing `created_at` with now.
- **Alternatives.** A separate `POST /api/invite/redeem` from the client for the referral (the client decides when to
  redeem: a returning user could redeem late and count as a newcomer; the friend request is client-driven on purpose,
  M10, because it is the player's act, while attribution is a fact of the first launch); `created_at = now` (two auths
  in one second both look new).
- **Trade-off.** A person who never opened the Mini App before counts as a newcomer even if they used the bot chat.

**M12. Visibility per player, private by default, friends-only, by a separate consent.**
- **What.**
  - `consents (user_id, purpose, granted, policy_version, text_version, at)`, append-only; the latest row per (user,
    purpose) wins; purpose `friends_profile` only.
  - `PUT /api/consents/friends_profile { granted, textVersion }` appends a row; the server records its own current
    policy version (from the compiled policy, M26); `textVersion` is one of a closed list (`friends_profile.v1`).
  - The `ConsentDialog` is its own screen with its own text and a link to the policy; off by default; one tap turns it
    off again. No public (anyone-with-the-link) mode exists. Revision 1 (C1): the text (`friends_profile.v1`) names the
    circle that results from M10 — the player's friends, i.e. the people whose request the player accepted and the
    people who accepted the player's request — and nobody else.
- **Why.** 152-FZ art. 9 p. 1 ("оформлено отдельно", 156-FZ) and GDPR art. 7 (as easy to withdraw as to give, proof
  of consent) [M3 §2, §3]. Friends-only reads as provision to a defined circle (each friend an account the player
  accepted or asked, M10 revision 1; never "whoever holds a link"); a public mode would be distribution
  under art. 10.1 with RKN order 18 content (full name and contacts we do not collect) [M3 §2]: out of the foundation.
- **Alternatives.** Visible by default (silence is not consent, art. 10.1 p. 8); per-story visibility (a second
  dimension nobody asked for; the profile is coarse already).
- **Trade-off.** A friend who never opens the consent dialog shows "progress hidden".

**M13. What a friend sees: counts, plus titles of what both found.**
- **What.** `GET /api/friends/{handle}/profile` (LF2; the handle and the friendship in one read, revision 1 W1): 404
  `not_found` unless the two are friends; `visible: false`
  (and nothing else) unless the friend's consent stands; otherwise per story the friend has started: `endingsFound`,
  `achievementsUnlocked` (counts of the friend's facts, current index), and `sharedEndings` / `sharedAchievements` —
  the titles of items the friend has and the viewer has too and that pass the viewer's gate (M7). ≤ 7 statements.
- **Why.** Showing a title the viewer has not found is a spoiler and, for paid items, paid content; showing what both
  found is the social hook ("you both found 'Dawn'"). Counts of the friend's own facts are the friend's statistics,
  which the owner wants shareable.
- **Alternatives.** Titles of everything the friend found (spoilers, principle 0 for paid items); counts only (no
  social hook).
- **Trade-off.** A friend's count is a lower bound on a story's ending total (Q25 forbids showing the total): an owner
  value with the default "counts shown" (Open questions).

**M14. A share is text plus a button, prepared per tap; no image in the foundation.**
- **What.**
  - `POST /api/share { storyId: StoryId | null, lang, native }` → `ShareResponse { link, text, preparedMessageId:
    string | null }`. `storyId: null` is a plain invite.
  - The server builds the text from `server/locales/meta.json` templates: the story title and the sharer's own counts
    (endings found, achievements unlocked) — never an ending or achievement title, never paid content. The link is the
    sharer's invite link (M10), so every share is also an invite; since revision 1 (C1) its recipients can only ask and
    the sharer accepts per person, so the reach of a share no longer decides who becomes a friend (no owner trade of
    reach against consent is left to decide).
  - `native: true` (the client runs Bot API ≥ 8.0): the server calls `savePreparedInlineMessage(user_id = the sharer,
    result = InlineQueryResultArticle { id, title, input_message_content: the text, reply_markup: one url button
    "Открыть" → link }, allow_user_chats = true, allow_group_chats = true)` and returns the id. A gateway failure
    returns `preparedMessageId: null` (the link path still works).
  - The client calls `shareMessage(id)`; `MESSAGE_EXPIRED` → one new `POST /api/share` and one retry; `UNSUPPORTED`,
    `native: false` or a null id → `openTelegramLink("https://t.me/share/url?url=<link>&text=<text>")`; `USER_DECLINED`
    → nothing; other errors → a toast with "Send as link".
  - Rate: 20 shares per user per rolling hour, held in memory in `AppState` (one process; a restart forgets it) → 429.
- **Why.** The prepared message is Telegram's own rich share with a tappable way back [M2 §1]; a text result needs no
  public media URL, so no card image can leak paid content or outlive a revocation (GDPR 17(2) favours shares we can
  stop serving [M3 §3]). Preparing per tap sidesteps the unknown lifetime. The limit protects the bot's Bot API quota.
- **Alternatives.** A server-rendered JPEG card (`InlineQueryResultPhoto` needs a public JPEG URL: a public route
  serving per-user images, an image renderer, and a principle-0 surface); `shareToStory` (Premium-only links, no
  callback [M2 §1]); `switchInlineQuery` (needs inline mode and an `answerInlineQuery` handler).
- **Trade-off.** The share looks like a plain message with a button; a card image is Later (a static per-story JPEG).

**M15. Abuse limits, in one place** (revision 1: C1, W1). Invite codes unguessable and rotatable; a code lets its
holder ask, never join; friend requests only from a code's holder to the code's owner, ≤ 50 pending per recipient,
accepted per person; a decline or removal blocks the removed user's further requests; friends ≤ 200; rotations ≤ 10
per day; shares ≤ 20 per hour; handles — never Telegram ids — to other users, and only to friends and to the owner a
request was sent to; profiles only to friends with consent; no search, no public profile, no listing.
Gifts and referrals have their own caps (M22, M23). Each limit's test is in the lane entries; each race is in the
[concurrency table](#concurrency-and-failure-model).

**M16. The thin Telegram layer gains one Bot API method, one lookup and three facade methods.**
- **What.**
  - Server (`telegram/gateway.rs`, LF2): `BotGateway::save_prepared_inline_message(user, PreparedShare) ->
    Result<PreparedMessage, GatewayError>` and `BotGateway::bot_username() -> Result<String, GatewayError>` (frankenstein
    `get_me`, called on first use and cached inside `FrankensteinGateway`; the dev and test fake answers
    `"novel_dev_bot"`). No configuration variable, no inline-query handler, `allowed_updates` unchanged.
  - Client (`telegram/`, L7 re-cut): `shareMessage(id) → Promise<Result<void, ShareError>>` (the `shareMessageSent` /
    `shareMessageFailed` events, a 60 s guard), `openTelegramLink(url)`, `openLink(url)`, `startParam()` (from
    `initDataUnsafe`, for UX only; as merged, L7 `57e1424`, cut Q1: parsed from the raw `initData` string, since the
    arch rule `init-data-unsafe` forbids reading `initDataUnsafe`; still a UX hint only), `supportsShareMessage()`
    (`isVersionAtLeast('8.0')`).
  - Dev mock: `/dev/launch?startapp=<p>` signs `start_param` into the dev initData (LF1); the fake gateway stores each
    prepared message and serves it at `GET /dev/prepared/{id}` (LF2); the mock transport answers
    `web_app_send_prepared_message` with `prepared_message_sent`, or the failure set by `__tgMock.setShareOutcome(…)`,
    and records `web_app_open_tg_link` / `web_app_open_link` (L7).
- **Why.** Principle 6: two frankenstein calls behind the existing trait, three facade functions we can replace in a
  day. `getMe` instead of a `BOT_USERNAME` variable: the username is always the token's own (no misconfiguration), and
  no `Config` field means no edits to the three `Config` constructors (`config.rs`, the dev lib, the `it` helper).
- **Alternatives.** A `BOT_USERNAME` variable (four more files in a lane, a value that can disagree with the token); a
  Telegram SDK wrapper (principle 6).
- **Trade-off.** The first share or invite after a restart waits for one `getMe` (≤ 5 s timeout, typically 100–300
  ms); if Telegram is unreachable, the share answers 502 `telegram_unavailable` (sharing needs Telegram anyway).

### E. The economy foundation (RULINGS 25)

**M17. Resources are data: kinds, packs and amounts in the compiled catalog's `economy` section.**
- **What.** `server/catalog.json` (compiled in, as merged) gains:
  ```jsonc
  "economy": {
    "kinds": ["hint"],
    "packs": { "hint_s": { "kind": "hint", "amount": 3,  "priceStars": 1,      // PLACEHOLDER (owner)
                           "title": { "ru": "3 подсказки", "en": "3 hints" }, "description": { … } },
               "hint_m": { "kind": "hint", "amount": 10, "priceStars": 3, … } },
    "spend":   { "hintTier": 1 },                                              // hints per unlocked tier
    "gifts":   { "kinds": ["hint"], "maxPerGift": 3, "sendPerDay": 3, "receivePerDay": 5 },
    "referral": { "kind": "hint", "inviter": 5, "invitee": 2, "minPlaySecs": 120, "capPerDay": 3, "capTotal": 20 } }
  ```
  - Pack products are `pack:<PackId>` (`^[a-z][a-z0-9_]{0,23}$`); `ProductRef` gains `Pack { pack: PackId }` (the
    merged L6b enum was made an enum for this). Startup checks: every pack kind is a declared kind; amounts 1–1000;
    pack titles 1–32 and descriptions 1–255 code points (the invoice limits); every gift and referral kind declared.
  - Chapters stay Stars-only (no soft currency opens a chapter).
- **Why.** "Placeholders, data not code" (RULINGS 25). The catalog already holds every price and is compiled in, so a
  changed amount is a reviewed commit, not a runtime edit.
- **Alternatives.** A table of kinds in the database (an admin surface for a placeholder); hard-coded constants (the
  owner changes amounts).
- **Trade-off.** Changing an amount needs a deploy.

**M18. An append-only ledger with an idempotency key, and a balance row that cannot go negative.**
- **What.**
  - `resource_balances (user_id, kind, balance ≥ 0, debt ≥ 0, CHECK (balance = 0 OR debt = 0))`.
  - `resource_ledger (id, user_id, kind, amount ≠ 0 signed, reason, idem_key UNIQUE, charge_id → payments,
    counterpart_id → users, ref, created_at)`; reasons `pack`, `pack_refund`, `hint_spend`, `gift_out`, `gift_in`,
    `referral_inviter`, `referral_invitee`, each with its sign and charge rule as a CHECK.
  - Every change is one ledger insert (`ON CONFLICT ON CONSTRAINT resource_ledger_idem_key DO NOTHING RETURNING id`;
    no row = a duplicate, nothing else happens) followed by one balance statement, in the caller's transaction:
    - credit: `INSERT … ON CONFLICT DO UPDATE SET debt = GREATEST(b.debt − n, 0), balance = b.balance +
      GREATEST(n − b.debt, 0)` (credits pay debt first);
    - debit: `UPDATE … SET balance = balance − n WHERE … AND balance >= n RETURNING balance` (no row → insufficient →
      the caller rolls back);
    - clawback: `UPDATE … SET balance = GREATEST(balance − n, 0), debt = debt + GREATEST(n − balance, 0)`.
  - Idempotency keys: `pay:<charge>`, `refund:<charge>`, `hint:<user>:<puzzle>:<tier>`, `gift:<sender>:<requestId>:out`
    and `:in`, `ref:<invitee>:inviter` and `:invitee`.
  - Invariant: per (user, kind) `balance − debt = Σ amount` (checked by `ledger_reconciles_with_balances` over a mixed
    sequence, and derivable at any time by one `GROUP BY`).
- **Why.** The ledger is the audit trail and the idempotency arbiter (a UNIQUE key, not a check-then-insert, as the
  project's charge-id rule); the balance row makes "never negative" a CHECK plus a conditional UPDATE that READ
  COMMITTED re-evaluates on the committed row [M4 §1a]. A CHECK cannot sum a ledger [M4 §1a], so a balance row is
  needed. One signed amount suffices: every operation keeps `balance − debt − Σ amount` at zero (credit: +n, debit:
  −n, clawback: −n).
- **Alternatives.** Ledger only, balance as `SUM` (needs a lock per spend and a scan per read); balance only (no
  idempotency key, no audit, no refund trace); a double-entry pair per transfer (pgledger [M4 §1b]: right for money
  between accounts, heavier than needed for a game resource with one external source).
- **Trade-off.** Two writes per change; the reconciliation is a test and a query, not a constraint.

**M19. Packs are bought on the existing payment path; pre-checkout is the RULINGS 14 form again.**
- **What.**
  - `POST /api/invoices { productId: "pack:<id>" }` runs P3 unchanged (the price and texts from the catalog; the
    entitlement check is trivially false for a pack; order reuse < 1 h). Revision 1 (W3): P3 also binds the pack's
    kind and amount into the order row it inserts (`orders.pack_kind`, `orders.pack_amount`; `0004` adds the two
    columns and the CHECK `orders_pack_binding`, so a pack order without its binding cannot exist), from the same
    catalog read that titles the invoice ("3 подсказки").
  - Pre-checkout (L8b re-cut): the payer-row lock, then the K18 conditional UPDATE — two statements; no PK read, no
    `$6`–`$8` predicates, no `Unavailable` (they existed only for hint tiers). A pack passes the `NOT EXISTS
    entitlements` predicate trivially; the 120 s checkout lock serializes two orders of the same pack, as for chapters.
  - Grant (K19): after `UPDATE orders … RETURNING product_id`, the transaction branches on `parse_product_id`:
    `Chapter` → the entitlement insert (L8b); `Pack` → `credit_in_tx` with key `pay:<charge>` (LE1), in the same
    transaction, before the commit. An unknown product id → recorded, no grant (unapplied). Revision 1 (W3): the
    credit is of the kind and amount the `UPDATE orders … RETURNING product_id, pack_kind, pack_amount` returns — never
    the current catalog — so a deploy that changes or retires the pack between the invoice and the payment (an order
    stays payable for 24 h) credits exactly what the invoice advertised (Bot Developer ToS §6.2.1 "as advertised"
    [M4]).
  - "Unapplied" (K19, `/paysupport`, L9) = a payment with no `entitlements` row **and** no ledger row of that charge,
    and `refunded_at IS NULL`.
  - The client confirms a pack through the polled order (`status: paid`, which the grant sets in the same transaction
    as the credit) and then reads `GET /api/wallet` (L10's `isDelivered`, re-cut).
- **Why.** Principle 2 and the spec ("pre-checkout unchanged in shape"): the grant stays the only place value is
  created from money, and it stays one transaction. Removing the hint predicates returns pre-checkout to the reviewed
  RULINGS 14 statement pair.
- **Alternatives.** Packs as entitlements (`entitlements` has PK (user, product): a pack could be bought once
  [M4 §1a]); a credit after the grant in a second transaction (a crash between them loses a paid credit); the kind
  and amount resolved from the catalog at grant time (revision 0: a deploy between invoice and payment credits another
  amount than advertised, and a retired pack credits nothing — W3); a separate `pack_orders` table for the binding
  (nothing would force a pack order to have its row; the column CHECK does).
- **Trade-off.** Two purchases of the same pack within 120 s: the second waits (the K18 cost already accepted).

**M20. A pack refund claws back the unspent part; the rest becomes debt that later credits pay.**
- **What.** L9's revoke transaction (K20) gains: when the refunded charge has a `pay:<charge>` ledger row (a credited
  pack), `clawback_in_tx(user, kind, amount, 'refund:<charge>', charge)` of **that row's** kind and amount
  (`credited_by_charge`, one read by the `resource_ledger_idem_key` index; revision 1, W3): the balance drops by
  min(balance, amount), the shortfall goes to `debt`. The current catalog is never read, so a changed or retired pack
  claws back exactly what the charge credited; a charge without that row (an unapplied pack) claws back nothing.
  Hints spent or gifted before the refund stay spent and gifted; a gift recipient's balance is never touched. The next
  credits (a pack, a gift received, a referral) pay the debt first (M18); a user with debt cannot spend (balance 0).
- **Why.** `refundStarPayment` refunds whole charges only [M4]; option (b) of research M4 keeps the ledger exact
  without reaching into a friend's balance. Debt makes refund farming (buy, spend, refund) cost the next credits.
- **Alternatives.** Refuse refunds of spent packs (refunds are the admin's tool and a Telegram support duty); claw back
  from gift recipients (punishes a third party); ignore the shortfall (free hints by refund).
- **Trade-off.** A player can carry debt; the wallet shows it ("долг: 2").

**M21. Spending a hint replaces the per-tier hint products.**
- **What.**
  - `hint_unlocks (user_id, puzzle_id, tier 1–3, unlocked_at)`, PK (user, puzzle, tier), created in L6c's `0002` (L6c
    re-cut); it replaces the `hint:<puzzle>:<tier>` entitlements of PZ X6.
  - `GET /api/puzzles/{puzzleId}?lang` (L6c) returns `hints: [{ tier, unlocked, text | null }]` (`text` only when
    unlocked).
  - `POST /api/puzzles/{puzzleId}/hints/{tier}?lang` (LE1), after the edge checks (puzzle known; tier within its
    ladder; a paid chapter needs its entitlement → 403): one transaction —
    1. the puzzle not solved (`puzzle_progress.solved_at IS NULL`) and tier 1 or tier − 1 unlocked, else 409
       `hint_unavailable`;
    2. `INSERT INTO hint_unlocks … ON CONFLICT DO NOTHING RETURNING tier` — no row: already unlocked → 200 with the
       text, nothing debited;
    3. the ledger debit (`hint:<user>:<puzzle>:<tier>`, `spend.hintTier` hints) and the conditional balance UPDATE —
       no row: ROLLBACK → 409 `insufficient_balance`;
    4. COMMIT → `HintUseResponse { balance, text }`.
  - The ladder rules of PZ X18 stay (1–3 tiers, nudge → direction → solution, the free hotspot reveal); prices per
    tier are gone (one hint per tier; `spend.hintTier` is data).
- **Why.** RULINGS 25. The unlock row before the debit means no debit without an unlock; its PK serializes two
  concurrent uses of the same tier (the second waits on the first's insert, then finds it); the conditional UPDATE
  serializes uses of different tiers on one balance.
- **Alternatives.** Keep hint products and add packs (two hint paths); store unlocks as entitlements (entitlements
  are the money unlock fact, PK on (user, product), with `charge_id`).
- **Trade-off.** A solved puzzle's remaining tiers cannot be bought for curiosity (PZ's rule, kept).

**M22. Gifts: friends only, a daily limit, one transaction for both sides, idempotent by a client request id.**
- **What.** `POST /api/gifts { to, kind, amount, requestId }` (LE2), `to` the friend's handle (revision 1, W1:
  resolved through `user_handles` before the transaction; unknown → 404 `not_found`), `amount` 1–`maxPerGift`,
  `requestId` a UUID v4. One transaction:
  1. lock both `users` rows in ascending id order (`FOR NO KEY UPDATE`);
  2. the friendship row (none → 404 `not_found`);
  3. the sender's ledger debit row (`gift:<sender>:<requestId>:out`); a duplicate → the replay: the recorded row's
     counterpart, kind and amount must equal the request (else 400 `bad_request`), 200 with the current balance;
  4. the caps: the sender's `gift_out` units in the last 24 h + amount ≤ `sendPerDay`, the recipient's `gift_in` units
     + amount ≤ `receivePerDay`, else ROLLBACK → 429 `rate_limited` + `Retry-After` (until the oldest counted gift
     leaves the window);
  5. the sender's conditional balance UPDATE (no row → ROLLBACK → 409 `insufficient_balance`);
  6. the recipient's ledger credit row (`…:in`) and credit (pays the recipient's debt first);
  7. COMMIT → `GiftResponse { balance }`.
- **Why.** The users-row locks serialize every gift of a sender and every gift to a recipient, so the caps are exact
  (a count after the lock sees every committed gift); ascending order prevents a deadlock between A→B and B→A. Apple
  3.1.1 allows gifting in-app items; Telegram has no rule against it [M4 TL;DR].
- **Alternatives.** Balance-row locks only (the caps would be soft); no caps (multi-account farming funnels free hints
  into one account).
- **Trade-off.** Farming through friends stays possible within the caps: at most `receivePerDay` (5) hints per day into
  one account.

**M23. Referral: attributed on the first launch, granted on server-observed evidence, capped per inviter.**
- **What.**
  - Attribution (LF1, M11): one `referrals` row per invitee, on the invitee's first verified launch with a valid code.
  - Qualification hook (LE2) in `POST /api/stats/events`, after the insert, on **every** batch (revision 1, W5): one
    statement reads the user's unqualified referral by its PK together with the evidence — a recorded completion
    (`chapter_completed`, or an `ending_reached` in it) of some story's **first** chapter whose earliest
    `chapter_started` was **received** (server clock) at least `minPlaySecs` (120) before this batch's receipt. No
    unqualified referral → done (the common case: one PK probe). The evidence is re-read from the table on each batch,
    never taken from what this batch recorded, so a completion recorded earlier qualifies on any later batch (a retry
    that comes back as duplicates included). Then one transaction:
    1. lock both `users` rows ascending;
    2. `UPDATE referrals SET qualified_at = now, outcome = … WHERE invitee_id = $1 AND qualified_at IS NULL RETURNING
       inviter_id` (no row → another batch won: done);
    3. the inviter's grants in the last 24 h < `capPerDay` and in total < `capTotal` → `outcome = 'granted'`, else
       `'capped'` (the invitee's bonus is still granted);
    4. credits: the inviter `referral_inviter` (when granted) and the invitee `referral_invitee`, ascending by user id;
    5. COMMIT. The stats response is unchanged; the wallet shows the new balance.
  - Failure (revision 1, W5): the hook never fails the stats response. The events are already committed (SP Y11's
    autocommit insert); a hook error — a `lock_timeout` on the `users` rows that gifts also lock, a transient database
    error — rolls the hook's transaction back and is logged, the response is 200 with the batch's results, and the
    next batch evaluates again.
  - Single-level only; no Premium weighting; no Telegram Affiliate Program (it pays Stars commissions, not in-app
    items [M4 TL;DR]).
- **Why.** `chapter_completed` is client-reported, so the evidence is what the server itself observed: a first-chapter
  start and a later batch received at least 120 s apart on its own clock, with the completion recorded (a script must
  still keep a session open for two minutes per account; re-evaluating on later batches adds no forgeable input) and a
  real Telegram account per invitee (initData). The caps bound the yield of a farm: at most 3 × 5 = 15 hints per day and
  100 in total per inviter.
- **What stays forgeable.** A script with many real Telegram accounts that launches each through the link, sends a
  `chapter_started`, waits 120 s and sends a completion. Bounded by the per-inviter caps; the invitee bonus (2) is
  per account; there is no account-age signal [M4 TL;DR]. A later hardening (saves progression, a play-time sum) is
  an open question.
- **Alternatives.** Grant on attribution (pure farming); grant on the client's word (principle 1); require a purchase
  (not the owner's rule).
- **Trade-off.** Every stats batch pays one PK probe of `referrals`. A newcomer who finishes the first chapter in under
  120 s qualifies on the first batch received ≥ 120 s after its start (the next chapter's `chapter_started`, a later
  session); a newcomer who sends no batch after a failed hook does not qualify.

**M24. The UI minimum.** A wallet chip on Home (`HomeBar`: the hint balance, debt if any, and a Friends button); the
`wallet` overlay (balances, the packs with server prices, Buy through the PP purchase flow with the terms checkbox of
P1); the hint ladder's "Use (1 hint)" and "Get more" (opens the wallet); the `gift` dialog from a friend's row; Invite
through Share (M14). The pack purchase in the dev mock goes through the fake Stars sheet and `/dev/simulate-payment`,
i.e. through the real webhook handler (PP L8b), unchanged.

### F. Privacy (Q23)

**M25. The full personal-data inventory; retention "keep"; erasure designed, not built.** The inventory, the lawful
bases and the erasure order are in [Privacy](#privacy-personal-data-inventory-lawful-bases-erasure). Retention: no
deletion job (Q23); erasure on request is designed and is a Later lane before production (Telegram §4.2(a) requires
deletion on request). Not stored, ever: `last_name`, `username`, `photo_url`, `is_premium`, `chat_instance`,
`chat_type`, the phone, contacts.

**M26. The policy: one HTML file, RU then EN, versioned, served publicly by the server, linked from three places.**
- **What.**
  - The draft lives at `server/legal/privacy-policy.html`, written by this design campaign's final step from the
    inventory, with a placeholder for every operator fact [M3 §5]. Never the owner's real name, e-mail or account: the
    file in the repository never holds an identity value (revision 1, W4). Revision 2 (W1) splits revision 1's 17
    placeholders into three classes; the class decides where a value comes from and whether it versions the policy:
    - **Identity (10), from the host file:** `{OPERATOR_NAME}`, `{OPERATOR_FORM}`, `{OGRN}`, `{INN}`,
      `{OPERATOR_ADDRESS}`, `{PRIVACY_CONTACT_EMAIL}`, `{RESPONSIBLE_PERSON}`, `{DPO_CONTACT}`, `{EU_REPRESENTATIVE}`,
      `{POLICY_URL}`: who the operator is and how to reach them (`legal::IDENTITY_KEYS`, LPO). An identity edit does
      not version the policy, because a contact fix changes nothing a consent covered. A change of the operator itself
      (`OPERATOR_NAME`, `OPERATOR_FORM`, `OGRN`, `INN`) is also a new version, by the runbook (D2 `privacy-ops`: the
      host-file edit plus a template commit); whether earlier consents are asked again is MV22, a lawyer item.
    - **Content (6), in the template:** `{RETENTION_PERIOD}`, `{MIN_AGE}`, `{DB_LOCATION_COUNTRY}`,
      `{HOSTING_PROVIDER}`, `{CROSS_BORDER_TRANSFER}`, `{SUPERVISORY_AUTHORITY}`. Each is a disclosure a consent is
      informed by: retention (GDPR 13(2)(a)), recipients and third-country transfers (13(1)(e), (f)), the database
      location and the cross-border transfer the RKN notice names (152-FZ art. 22 p. 3, item 10.1), the complaint
      authority (13(2)(d)), who may consent (GDPR art. 8) [M3 §2, §3]. So the database country and the transfers are
      content, not deployment facts (critique round 2, open question 1). A content value is written or changed only by a
      commit to the template that sets a new meta version and appends a pin row (next bullet). Until then it stays a
      visible placeholder, which a production start refuses (the rule below). The host file may not carry one
      (`legal::CONTENT_KEYS`, `PolicyError::ContentKey`). `api::legal::tests::policy_placeholders_classified` fails on a
      template placeholder that is in neither list and is not `POLICY_VERSION`, so a placeholder the draft adds is
      classified before it ships.
    - **Derived (1):** `{POLICY_VERSION}` in section 0, which replaces revision 1's `{EFFECTIVE_DATE}`. `Policy::load`
      fills it from the template's meta, never from the host file. The version's date is the effective date, so the
      page cannot show a date other than the version a consent records.
  - `<meta name="policy-version" content="2026-10-31">` is the version consents record (M12). Revision 2 (W1): the
    version identifies one template text, and `api/legal.rs` pins it. `POLICY_PINS` is an append-only list of
    (version, SHA-256 of the template bytes `include_str!` compiles; `.gitattributes` `eol=lf` keeps them LF on every
    checkout). The pin holds three conditions: the versions strictly increase, the last one equals the meta, and its
    hash equals the compiled template's. A template edit therefore lands with a new version and a new row; an edited
    row is a review STOP. Git history plus the pin give each recorded version exactly one text.
    - Revision 3 (W1): each condition has its own failing input. The three live in one pure checker,
      `check_pins(pins, meta, template bytes)`, checked in that order (`PinError::NotIncreasing`, `LastNotMeta`,
      `HashMismatch`). `api::legal::tests::policy_template_pinned_per_version` runs it on the real data: `POLICY_PINS`,
      `policy_version()` (the value consents record, not a second parse of the meta) and the compiled template bytes.
      Crafted histories run it on inputs that break exactly one condition of a valid two-row history:
      `pin_check_rejects_non_increasing_versions` (a duplicate and a decreasing version),
      `pin_check_rejects_last_not_meta` (a meta left at the first row's version, and an empty list) and
      `pin_check_rejects_hash_mismatch` (the two rows' hashes swapped). `pin_check_accepts_a_valid_history` keeps the
      checker from being stricter than the rule; a checker that compared every row's hash with today's template would
      pass the rest and fail closed at the first policy change.
    - Revision 3 (W1): `POLICY_PINS`, `PinError` and `check_pins` are `#[cfg(test)]`. No run-time code reads the pin,
      so in the non-test lib target a private constant is `dead_code` and `cargo clippy … -D warnings` fails (probed:
      `constant 'POLICY_PINS' is never used`; with `#[cfg(test)]` the lib and test targets are both clean). Test-only,
      the pin adds 0 bytes to the binary and needs neither a `pub` item nor a change to `api/mod.rs`, which is outside
      LPO's lock.
  - Operator identity facts (revision 1, W4; revision 2, W1: identity keys only): one flat JSON object of strings
    (`{ "OPERATOR_NAME": "…", … }`, keys from `IDENTITY_KEYS`) in a file **outside the repository**, named by
    `PRIVACY_OPERATOR_FILE` (a `Config` variable, lane LPO; the owner writes the file on the host, D2 runbook
    `privacy-ops`). `AppState::new` loads it once (`legal::Policy::load`). Every identity `{KEY}` of the compiled
    template is replaced by the HTML-escaped value, and `{POLICY_VERSION}` by the meta. Any of these →
    `StartupError::Privacy`: an unreadable file; a value that is not a string; a content key (`CONTENT_KEYS`) or
    `POLICY_VERSION`, whether or not the template still holds it as a placeholder (`ContentKey`, revision 2); any other
    key that is not an identity placeholder of the template (`UnknownKey`). Under `TELEGRAM_ENV=prod` the variable is
    required (a `ConfigError` without it, the existing "every problem collected, startup stops" path) and any
    `{UPPER_SNAKE}` placeholder left after the substitution → `StartupError::Privacy`: the server does not start. Under
    `TELEGRAM_ENV=test` the variable is optional; without it the template is served as a draft, placeholders visible
    (`{POLICY_VERSION}` filled, revision 2).
  - `GET /api/privacy` (LF1, `api/legal.rs`; from LPO on it serves the substituted page): the template compiled in with
    `include_str!`; public (no token); `Content-Type: text/html; charset=utf-8`, `Cache-Control: public, max-age=300`,
    `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'`. (Revision 0's startup log warning is
    replaced by the refusal above: a warning is a gate that cannot fail.)
  - Linked from: @BotFather's privacy policy URL = `<PUBLIC_APP_URL>api/privacy` (an owner step, D2 runbook), which makes
    Telegram show it on the Mini App's Privacy Policy button [M3 §1]; the bot's `/privacy` command (L9); the
    `ConsentDialog` and the Friends screen (`openLink`).
  - Outline (sections; the draft fills them): 0 Version and date (`{POLICY_VERSION}`, revision 2); 1 Operator and
    contacts; 2 What we collect (the inventory, in plain words); 3 Purposes and lawful bases (per item); 4 Friends and shares (revision 1, C1, W1): who
    can become a friend (only someone whose request the player accepts, or who accepts the player's request), what a
    request shows (the player's first name, to the one person asked), that other players never receive the player's
    Telegram id, that declining or removing is final until the player asks that person again, what friends see (M13)
    and what a share contains (M14); 5 Consents and how to withdraw; 6 Purchases, resources and refunds; 7 Storage
    location, transfers, retention (revision 1, W6: our server's database — {DB_LOCATION_COUNTRY},
    {HOSTING_PROVIDER}; Telegram's CloudStorage — the settings and the read-set, on Telegram's servers, part of
    {CROSS_BORDER_TRANSFER}; the device — DeviceStorage: the pending autosaves and the stats queue);
    8 Telegram's role (Telegram processes messages and shares, and hosts CloudStorage; its own policy); 9 Your rights (access, correction,
    deletion, objection, withdrawal) and how to exercise them (`/privacy`, the contact; answer within 10 working days
    under 152-FZ art. 20, one month under GDPR art. 12); 10 Minors ({MIN_AGE}; defaults 14+ in Russia, 18+ in the EU
    by Telegram's ToS); 11 Security (encryption at rest per Telegram §4.4(a), access control); 12 Changes to the policy;
    13 Contact and the supervisory authority; annex A 152-FZ specifics (art. 18 p. 5 localisation, art. 22
    notification); annex B GDPR specifics (art. 13 checklist, art. 27 representative).
- **Why.** Telegram §4 and 152-FZ art. 18.1 p. 2 require an accessible policy where data is collected [M3 §1, §2]; a
  route on our own server is the one URL that works for BotFather, the bot and the app. A version in the file ties
  every consent to the text the player saw. Revision 2 (W1) makes that true: every content value is in the template,
  a host-file content key stops the start, and the pin gives each version one text that git history keeps. Identity
  facts sit outside the version.
- **Alternatives.** A Telegraph page (outside our control, no version tie); a page in the client bundle (shipped with
  every build, and Telegram needs an HTTP URL anyway). Revision 2 (W1): the version derived at startup from the
  template plus the host facts, with each served text stored server-side (triage round 2, option a), rejected: it
  needs a new version shape for `consents_policy_version_shape`, a table and a startup write, for the guarantee the
  template and its pin already give. Revision 3 (W1), the pin's visibility: `pub` items, rejected (free of
  `dead_code` only while LF1's `api/mod.rs` declares `pub mod legal;`, a file LPO cannot edit, and a public API item
  with no caller); a startup use (`Policy::load` runs `check_pins` and refuses the start), rejected (a run-time
  refusal for a fact the merge gate already proves, plus a `PolicyError` variant and its own test).
- **Trade-off.** Editing the policy is a deploy; changing an identity fact is an edit of the host's file and a
  restart (revision 1). Revision 2 (W1): changing a content value is a template commit with a new version and a pin
  row, then a deploy, so new consents name the new version. The identity facts in force at a past date are kept only
  by the runbook's dated copies of the host file. Revision 3 (W1): the pin holds at test time only, so a binary built
  without `cargo test` is unchecked; the gate contract runs `cargo test --workspace` before every merge.

### G. Client architecture

**M27. One meta controller in the entry; the meta UI in one lazy chunk.**
- **What.**
  - `client/src/app/meta.ts` (LMI) creates the meta services after auth (`meta/card.ts`, `meta/social.ts`,
    `meta/wallet.ts`, LMD), fetches `GET /api/social`, `GET /api/wallet` and `GET /api/stats` in parallel (never
    awaited before the first line), and opens the meta overlays.
  - The overlay components (`ui/meta/*.svelte`, LU1) and their table `client/src/i18n/meta.ts` are one dynamic chunk
    (`meta-ui`, ≤ 14 KB br), imported only by `app/meta.ts` and prefetched once after the first line is shown.
  - Overlay kinds (L14a): `card`, `friends`, `friend`, `wallet`, `gift`, `consent`, `invite`; each closes with
    BackButton (K26).
  - Hints: LP2's puzzle session takes a `HintPort | null`; L15 passes `null`; LMI passes the wallet's port.
  - Entry points: `Menu` and `StoryPicker` (L14b) take optional `onFriends` / `onWallet` items, rendered iff given;
    the card button and the `the_end` card action likewise (L15 passes none, LMI the controller's).
- **Why.** Principle 4: none of this is needed before the first line; the entry pays ≈ 2.9 KB br for the controller,
  the services and the decoders, the rest waits in a 14 KB chunk. The `HintPort | null` seam keeps L15 (the prototype
  milestone) independent of the economy lanes.
- **Alternatives.** Meta UI in the entry (+≈11 KB br before the first line); one chunk per screen (seven requests for
  ≈ 1.5 KB each).
- **Trade-off.** The first card open in a session before the prefetch finished waits for ≈ 14 KB.

### H. Lanes

**M28. Ten new lanes (nine, plus LPO in revision 1), minimum scope each; the re-cut keeps the prototype path to L15
unchanged.**
- **What.**
  - New server lanes, in this order after LS3: **LE1** economy-core, **LF1** friends-server, **LM2** meta-server,
    **LF2** share-profile, **LE2** gifts-referrals; then **LPO** privacy-operator (revision 1, W4: the operator facts
    from `PRIVACY_OPERATOR_FILE`, the prod refusal; 8 files, 2 commits) and L9 (moved last in the server chain).
  - New client lanes: **LM1** meta-catalog (story tool + the DSL reopen; after LW3, beside D1), **LU1** meta-ui
    (presentational; after L14a), **LMD** meta-data (endpoints, decoders, services; after LS4 and LF2), **LMI**
    meta-integration (wiring + e2e; after L15, LMD, LU1, LE2).
  - Re-cut (not started): L6c, L8a, L8b, LS3, L9, L7, L10, LS4, L14a, L14b, LP2, L15, N1, N2, D1, D2.
  - Lanes: 38 + 10 = 48. The critical path becomes the server chain LS2 → L6c → L8a → L8b → LS3 → LE1 → LF1 → LM2 →
    LF2 → LE2 → LMI → D2; LPO and then L9 run in the server slot beside LMI (D2 waits for all three); the prototype
    milestone L15 no longer waits for L9 and is reached as before; the meta work adds about three lane-times after L15.
  - Changed by RULINGS 54 (as of `6043941`; docs lane `docs-errata-2`): of the ten lanes, LM1 (`4d8a9ec`) and LU1
    (`2a7b50c`) have merged and LE1 runs; LF1, LM2, LF2, LE2, LPO, LMD and LMI are to go. The server chain has run to
    LS3 (`00d7c10`), so it continues LE1 → LF1 → LM2 → LF2 → LE2 → LPO → L9.
  - Why LPO is a lane of its own (revision 1, W4): the operator facts need a `Config` variable, which means editing
    the three `Config` constructors (`config.rs`, `server/dev/src/lib.rs`, `server/tests/it/common.rs`) plus
    `lib.rs` and `.env.example`; in LF1 that is 15 + 4 = 19 files, over the cap. LPO holds them with `api/legal.rs` and
    its test file (8 files).
- **Why.** Each lane is one subsystem with ≤ 10 commits and ≤ 15 files (each lock is listed in PP); the split follows
  the serialized server files (one server lane at a time) and the client decoders' need for the Rust samples.
- **Alternatives.** Fold the meta work into L15/L9 (over the file caps, and the prototype would wait for the economy);
  one lane per foundation across client and server (two subsystems per lane).
- **Trade-off.** Nine more lanes and a three-lane tail; the owner can test the prototype at L15 before the tail.

---
## Data model and contracts

### Identifiers

| Id | Shape | Scope | Example |
|---|---|---|---|
| option / choice point | a choice's line ID, STAGING-DSL §4 (`^ch[1-9][0-9]*\.[a-z][a-z0-9_]*\.[0-9a-z]{4}$`) | game | `ch3.shore.k2t9` |
| `AchievementId` | `^[a-z][a-z0-9_]{0,31}$` | story | `drawer_no_hints` |
| `ResourceKind` | `^[a-z][a-z0-9_]{0,15}$`, declared in `economy.kinds` | game | `hint` |
| `PackId` / pack product | `^[a-z][a-z0-9_]{0,23}$` / `pack:<PackId>` | game | `pack:hint_s` |
| invite code | 32 lower-case hex (128 bits, `getrandom`); a bearer capability to ask its owner (revision 1) | user | `9f2c…e1` |
| friend handle (revision 1, W1) | 24 lower-case hex (96 bits, `getrandom`), one per user in `user_handles`; the only user id another user receives | game | `3fa9…c07d` |
| `start_param` | `f<invite code>` (33 chars); other first letters reserved | launch | `f9f2c…e1` |
| gift request id | lower-case UUID v4 (the stat event id grammar) | sender | `crypto.randomUUID()` |
| prepared message | Telegram's `PreparedInlineMessage.id`; our result id `s<unix>-<8 hex>` (1–64 bytes) | Telegram | — |
| policy version / consent text version | `^[0-9]{4}-[0-9]{2}-[0-9]{2}[a-z]?$` / `^[a-z_]+[.]v[1-9][0-9]*$` | game | `2026-10-31`, `friends_profile.v1` |
| hint product id `hint:<PuzzleId>:<tier>` | **removed** (M21) | — | — |

### Source file — `story/meta.json`

Hand-written by the narrative-designer (format in M4). `catalog/meta` (E), every finding printed, none stops the run:
1. the file exists and is an object; its keys are story ids of `story/stories.json` (a story may be absent: no
   achievements, and then it may declare no ending); each value has exactly `endings` and `achievements`; as merged
   (LM1 `4d8a9ec`, cut Q2): a missing `story/meta.json` counts as `{}`, and rule 2 still fails a story that declares
   an ending without its entry;
2. `endings` has exactly the ending names `stories.json` declares for that story, each `{ ru, en }`, 1–40 code points,
   non-blank (a story that declares an ending must be present);
3. each achievement id matches `AchievementId`, is unique in its story, ≤ 50 per story; each value has exactly
   `hidden` (boolean), `when`, `name`, `desc`; `name` 1–40 and `desc` 1–140 code points in ru and en, non-blank;
4. `when` is one condition of M5 with exactly one key (`hints: 0` only beside `puzzle`); `all` holds 2–4 conditions
   and no `all`;
5. `ending` names an ending of this story; `endings: n` has 1 ≤ n ≤ the story's ending count; `choice` is the ID of a
   choice with text (not a text line) in a chapter of this story's chain; `chapter` is on the chain; `puzzle` is a
   puzzle of a chapter of the chain (its world, LW3); `allEndings` is `true` and the story declares ≥ 1 ending.

### Server formats (story tool → server; the committed fixture is the contract)

```jsonc
// server/content/meta.json — emitted by the story tool (LM1) on every build; loaded by ContentStore (LM2).
// Never under client/. Fixture: server/tests/fixtures/content/meta.json (LM1 writes it; LM1's emit test and every
// server test read it).
{ "format": 1,
  "choices": { "ch1": { "ch1.hall.a1b2": "ch1.hall.a1b2", "ch1.hall.c3d4": "ch1.hall.a1b2" },   // option -> point
               "ch2": { … }, "ch3": { … }, "ch4": { … } },
  "stories": {
    "manor": { "endings": { "truth": { "ru": "…", "en": "…" }, "ashes": { "ru": "…", "en": "…" } },
               "achievements": [ { "id": "drawer_no_hints", "hidden": false,
                                   "when": { "puzzle": "ch1.drawer", "hints": 0 },
                                   "name": { "ru": "…", "en": "…" }, "desc": { "ru": "…", "en": "…" } } ] } } }
```

Startup checks (`StartupError::Content`, LM2): `format` 1; every chapter of the index has a `choices` entry (possibly
empty) and no other chapter does; every option key has its chapter's prefix and the line-ID grammar; every story of
`meta.json` is in the index and its `endings` keys equal the index's ending names; every condition names an ending,
chapter or puzzle of the content index and an option of that story's chapters; texts non-empty and within the M4
limits; the file ≤ 256 KB. The fixture holds the four fixture chapters, both fixture stories, and at least one
achievement of every condition kind.

```jsonc
// server/locales/meta.json — hand-written (LF2), compiled in; player-facing share texts (PLACEHOLDER wording, owner)
{ "ru": { "share_story": "Я играю в «{story}»: найдено концовок — {endings}, достижений — {achievements}. Присоединяйся!",
          "share_invite": "Присоединяйся ко мне в этой игре!", "share_button": "Открыть", "share_title": "Прогресс" },
  "en": { "share_story": "I'm playing “{story}”: {endings} endings and {achievements} achievements found. Join me!",
          "share_invite": "Join me in this game!", "share_button": "Open", "share_title": "Progress" } }
```

`server/catalog.json` gains the `economy` section of M17 (LE1); `CatalogFile` gains `economy: EconomyFile`
(`deny_unknown_fields`, as merged); the file's `"//"` marker names the placeholders (MV4–MV7).

### TS types (client)

```ts
// stats/reporter.ts (LS4 re-cut): one more variant
export type StatEvent =
  | /* SP's four variants, unchanged */
  | { kind: 'choice_made'; chapterId: ChapterId; storyVersion: StoryVersion; option: LineId };  // subject = option
export interface StatsReporter { /* SP API */
  settle(o: { timeoutMs: number }): Promise<'drained' | 'timeout'>;   // flush now; never rejects
}

// telegram/index.ts (L7 re-cut)
export type ShareError = { kind: 'unsupported' | 'expired' | 'declined' | 'send-failed' | 'unknown' };
export interface Tg { /* PP facade */
  supportsShareMessage(): boolean;                                       // isVersionAtLeast('8.0')
  shareMessage(preparedId: string): Promise<Result<void, ShareError>>;  // shareMessageSent / shareMessageFailed, 60 s guard
  openTelegramLink(url: string): Result<void, TgError>;                 // https://t.me/ links only
  openLink(url: string): Result<void, TgError>;                         // https only; from a tap
  startParam(): string | null;                                          // initDataUnsafe: UX only, never trusted
                                                                        // as merged (L7 `57e1424`, cut Q1): parsed from
                                                                        // the raw initData string (arch `init-data-unsafe`)
}

// meta/card.ts, meta/social.ts, meta/wallet.ts (LMD): views over the generated DTOs (ts-rs, api.ts)
export type CardView = { storyId: StoryId; runs: number; chaptersCompleted: readonly ChapterId[];
  endings: ReadonlyArray<{ name: EndingName; title: string; firstReachedAt: number }>;           // title in the UI lang
  achievements: ReadonlyArray<{ id: AchievementId; name: string; description: string; unlockedAt: number; isNew: boolean }> };
export type FriendHandle = string & { readonly __brand: 'FriendHandle' };     // revision 1 (W1): never a Telegram id
export type FriendView = { handle: FriendHandle; firstName: string };
export type SocialView = { inviteCode: string; friends: readonly FriendView[];
  requests: ReadonlyArray<FriendView & { at: number }>; profileVisible: boolean };   // requests: incoming only
export type InviteView = { state: 'open' | 'requested' | 'friends' | 'own' };       // revision 1 (C1): nothing about the owner
export type WalletView = { balances: ReadonlyArray<{ kind: ResourceKind; balance: number; debt: number }>;
  packs: ReadonlyArray<{ productId: ProductId; kind: ResourceKind; amount: number; priceStars: number; title: string }>;
  hintTierCost: number };
export type MetaError = { kind: 'network' | 'auth' | 'insufficient' | 'unavailable' | 'limit' | 'rate-limited' | 'not-found';
  retryAfter?: number };
export interface HintPort {                                              // LP2's seam; LMI passes wallet.hintPort()
  balance(): number | null;                                              // the last server balance; null = unknown
  tierCost(): number | null;                                             // WalletResponse.hintTierCost; null = unknown
  use(puzzle: PuzzleId, tier: number, lang: Lang): Promise<Result<{ text: string; balance: number }, MetaError>>;
  getMore(): void;                                                       // opens the wallet overlay
}
// ui/screens.ts (L14a re-cut): Screen gains
//   | { kind: 'card'; story: StoryId } | { kind: 'friends' } | { kind: 'friend'; handle: string }
//   | { kind: 'wallet' } | { kind: 'gift'; to: string } | { kind: 'consent' } | { kind: 'invite'; code: string }
//   (revision 1, C1 / W1: handles and the presented invite code, never a Telegram id; LMD brands them FriendHandle)
```

### Rust types (server)

```rust
// api/dto.rs (LS3 re-cut)
pub enum StatKind { ChapterStarted, ChapterCompleted, EndingReached, PuzzleEnded, ChoiceMade }
pub enum StatRejectReason { UnknownChapter, NotEntitled, UnknownEnding, UnknownPuzzle, UnknownChoice,
                            RateLimited }   // revision 1 (W2): a repeat pick over the choice budget (LS3)
pub struct StoryStatsDto { pub story_id: StoryId, pub started: bool, pub chapters_completed: Vec<String>,
                           pub chapters_total: u32, pub endings_reached: Vec<String> }        // endings_total removed
pub struct GameStatsDto { pub stories_started: u32, pub stories_total: u32, pub endings_reached: u32 } // idem

// error.rs (L6c re-cut: declared there beside RateLimited and HintUnavailable; used from LE1, LF1, LE2 on)
#[error("insufficient balance")] InsufficientBalance,   // 409 insufficient_balance
#[error("limit reached")] LimitReached,                 // 409 limit_reached (the friend cap)

// api/dto.rs (L6c re-cut): PuzzleStatus { puzzle_id, solved, hints: Vec<HintView> }
pub struct HintView { pub tier: u8, pub unlocked: bool, pub text: Option<String> }  // replaces HintTier

// catalog.rs (LE1)
pub struct PackId(pub String);  pub struct ResourceKind(pub String);   // grammars above; derive TS
pub enum ProductRef { Chapter { chapter: ChapterId }, Pack { pack: PackId } }
pub struct PackDef { pub id: PackId, pub kind: ResourceKind, pub amount: u32 }
pub struct GiftRules { pub kinds: Vec<ResourceKind>, pub max_per_gift: u32, pub send_per_day: u32, pub receive_per_day: u32 }
pub struct ReferralRules { pub kind: ResourceKind, pub inviter: u32, pub invitee: u32, pub min_play_secs: i64,
                           pub cap_per_day: u32, pub cap_total: u32 }
pub struct Economy { pub kinds: Vec<ResourceKind>, pub packs: Vec<PackDef>, pub hint_tier_cost: u32,
                     pub gifts: GiftRules, pub referral: ReferralRules }
impl Catalog { pub fn packs(&self) -> impl Iterator<Item = &Product>; pub fn pack(&self, id: &ProductId) -> Option<&PackDef>;
               pub fn economy(&self) -> &Economy; }
pub fn parse_product_id(s: &str) -> Option<ProductRef>;   // + "pack:<PackId>"

// db/economy.rs (LE1; LE2 adds transfer and the referral grant)
pub enum Reason { Pack, PackRefund, HintSpend, GiftOut, GiftIn, ReferralInviter, ReferralInvitee }
pub struct Entry<'a> { pub user: UserId, pub kind: &'a ResourceKind, pub amount: i64, pub reason: Reason,
                       pub idem_key: String, pub charge_id: Option<&'a str>, pub counterpart: Option<UserId>,
                       pub r#ref: Option<&'a str>, pub at: i64 }
pub enum Applied { Applied { balance: i64, debt: i64 }, Duplicate }
pub async fn credit_in_tx(c: &mut PgConnection, e: &Entry<'_>) -> Result<Applied, sqlx::Error>;
pub async fn debit_in_tx(c: &mut PgConnection, e: &Entry<'_>) -> Result<Option<Applied>, sqlx::Error>; // None = insufficient
pub async fn clawback_in_tx(c: &mut PgConnection, e: &Entry<'_>) -> Result<Applied, sqlx::Error>;
pub async fn credited_by_charge(c: &mut PgConnection, charge: &str)            // revision 1 (W3): the `pay:<charge>` row's
    -> Result<Option<(ResourceKind, i64)>, sqlx::Error>;                        // kind and amount; L9's clawback source
pub enum SpendOutcome { Unlocked { balance: i64 }, AlreadyUnlocked { balance: i64 }, Insufficient, Unavailable }
pub enum GiftOutcome { Sent { balance: i64 }, Replayed { balance: i64 }, NotFriends, Mismatch, Insufficient,
                       Capped { retry_after_secs: i64 } }
pub enum ReferralOutcome { NotEligible, Granted, Capped, AlreadyQualified }

// meta.rs (LM2)
pub enum Condition { Ending(String), Endings(u32), AllEndings, Choice(String), Chapter(ChapterId),
                     Puzzle { puzzle: PuzzleId, no_hints: bool }, All(Vec<Condition>) }
pub struct AchievementDef { pub id: String, pub hidden: bool, pub when: Condition, pub gate: BTreeSet<ChapterId>,
                            pub name: Localized, pub desc: Localized }                       // no Debug on texts
pub struct StoryMeta { pub endings: BTreeMap<String, Localized>, pub ending_gates: BTreeMap<String, BTreeSet<ChapterId>>,
                       pub achievements: Vec<AchievementDef> }
pub struct MetaIndex { pub choices: HashMap<ChapterId, HashMap<String, String>>, pub stories: BTreeMap<StoryId, StoryMeta> }
pub struct PuzzleFact { pub solved: bool, pub hints_unlocked: u32 }
pub struct Facts { pub endings: BTreeMap<String, i64>, pub chapters: BTreeSet<ChapterId>, pub choices: BTreeSet<String>,
                   pub puzzles: BTreeMap<PuzzleId, PuzzleFact>, pub runs: u32 }
pub fn met(c: &Condition, f: &Facts, story: &StoryDef) -> bool;                              // pure
pub fn gate(c: &Condition, story: &StoryDef, content: &ContentStore) -> BTreeSet<ChapterId>;  // paid chapters named
pub fn visible(gate: &BTreeSet<ChapterId>, owned: &BTreeSet<ProductId>, content: &ContentStore) -> bool;

// api/dto.rs (LE1, LM2, LF1, LF2, LE2), all #[derive(Serialize | Deserialize, TS)], camelCase
pub struct WalletResponse { pub balances: Vec<BalanceDto>, pub packs: Vec<PackDto>,
                            pub hint_tier_cost: u32 }   // economy.spend.hintTier (MV19), so the ladder shows the cost
pub struct BalanceDto { pub kind: String, pub balance: i64, pub debt: i64 }
pub struct PackDto { pub product_id: String, pub kind: String, pub amount: u32, pub price_stars: u32, pub title: Localized }
pub struct HintUseResponse { pub balance: i64, pub text: String }
pub struct CardResponse { pub story_id: StoryId, pub runs: u32, pub chapters_completed: Vec<String>,
                          pub endings: Vec<CardEnding>, pub achievements: Vec<CardAchievement> }
pub struct CardEnding { pub name: String, pub title: Localized, pub first_reached_at: i64 }
pub struct CardAchievement { pub id: String, pub name: Localized, pub description: Localized, pub unlocked_at: i64, pub new: bool }
pub struct SocialResponse { pub invite_code: String, pub friends: Vec<FriendDto>, pub requests: Vec<FriendRequestDto>,
                            pub profile_visible: bool }
// revision 1 (W1): `handle` (user_handles) replaces `user_id` in every social DTO; no DTO carries another user's id
pub struct FriendDto { pub handle: String, pub first_name: String }
pub struct FriendRequestDto { pub handle: String, pub first_name: String, pub at: i64 }       // incoming requests only
pub struct InviteView { pub state: InviteState }                                               // revision 1 (C1)
#[serde(rename_all = "snake_case")] pub enum InviteState { Open, Requested, Friends, Own }
pub struct ConsentRequest { pub granted: bool, pub text_version: String }
pub struct FriendProfile { pub handle: String, pub first_name: String, pub visible: bool, pub stories: Vec<FriendStoryDto> }
pub struct FriendStoryDto { pub story_id: StoryId, pub endings_found: u32, pub achievements_unlocked: u32,
                            pub shared_endings: Vec<SharedEnding>, pub shared_achievements: Vec<SharedAchievement> }
pub struct SharedEnding { pub name: String, pub title: Localized }
pub struct SharedAchievement { pub id: String, pub name: Localized }
pub struct ShareRequest { pub story_id: Option<StoryId>, pub lang: Lang, pub native: bool }
pub struct ShareResponse { pub link: String, pub text: String, pub prepared_message_id: Option<String> }
pub struct GiftRequest { pub to: String, pub kind: String, pub amount: u32, pub request_id: String } // to: a handle (W1)
pub struct GiftResponse { pub balance: i64 }

// telegram/gateway.rs (LF2)
pub struct PreparedShare { pub result_id: String, pub title: String, pub text: String, pub button: String, pub url: String }
pub struct PreparedMessage { pub id: String, pub expiration_date: i64 }
trait BotGateway { /* PP */
    async fn save_prepared_inline_message(&self, user: UserId, s: &PreparedShare) -> Result<PreparedMessage, GatewayError>;
    async fn bot_username(&self) -> Result<String, GatewayError>;      // getMe once, cached by the implementation
}
// The frankenstein side: InlineQueryResultArticle::builder() … into InlineQueryResult, with a text message content
// and one url button. LF2 commit 1 verifies the 0.52.1 type names on docs.rs and pins the serialized request in
// `gateway_prepared_share_shape` (the PP L8a invoice-shape precedent).

// auth/initdata.rs (LF1)
pub struct InitData { pub user: TgUser, pub auth_date: i64, pub start_param: Option<String> }  // from the signed pairs

// config.rs, api/legal.rs, lib.rs (LPO; revision 1, W4)
// Config gains `pub privacy_operator_file: Option<PathBuf>` (PRIVACY_OPERATOR_FILE; required under TelegramEnv::Prod).
pub struct Policy { html: String }                // the template with the identity facts and {POLICY_VERSION} substituted
#[derive(Debug, thiserror::Error)]
pub enum PolicyError { Read(std::io::Error), NotAnObject, NotAString(String), UnknownKey(String),
                       ContentKey(String),                           // revision 2, W1: a CONTENT_KEYS key or POLICY_VERSION
                       Unfilled(Vec<String>) }                       // Unfilled: under prod only; names the placeholders
// revision 2, W1 (M26): the only keys the host file may carry, and the keys only a template commit may fill
pub const IDENTITY_KEYS: [&str; 10] = ["OPERATOR_NAME", "OPERATOR_FORM", "OGRN", "INN", "OPERATOR_ADDRESS",
    "PRIVACY_CONTACT_EMAIL", "RESPONSIBLE_PERSON", "DPO_CONTACT", "EU_REPRESENTATIVE", "POLICY_URL"];
pub const CONTENT_KEYS: [&str; 6] = ["RETENTION_PERIOD", "MIN_AGE", "DB_LOCATION_COUNTRY", "HOSTING_PROVIDER",
    "CROSS_BORDER_TRANSFER", "SUPERVISORY_AUTHORITY"];                // + "POLICY_VERSION", filled from the meta
// revision 3, W1 (M26): the pin is a test-time gate that no run-time code reads, so all three items are #[cfg(test)]
// (a private item read only by tests is dead_code in the lib target: clippy -D warnings fails; 0 bytes in the binary)
#[cfg(test)]                                                        // append-only (version, hash)
const POLICY_PINS: &[(&str, &str)] = &[("2026-10-31", "<sha256 hex of the template>")];
#[cfg(test)] #[derive(Debug, PartialEq, Eq)]                        // PartialEq: the tests compare whole Results
enum PinError { NotIncreasing { at: usize }, LastNotMeta { last: Option<String>, meta: String },
                HashMismatch { version: String } }
#[cfg(test)] fn check_pins(pins: &[(&str, &str)], meta: &str, template: &[u8]) -> Result<(), PinError>;
// pure; in order: the versions strictly increase, the last equals meta, its hash = hex SHA-256(template)
impl Policy { pub fn load(file: Option<&Path>, env: TelegramEnv) -> Result<Policy, PolicyError>; pub fn html(&self) -> &str; }
// lib.rs: AppState gains `policy: Arc<Policy>` inside AppState::new; StartupError gains `Privacy(#[from] PolicyError)`.
```

### SQL

PostgreSQL 18 dialect (RULINGS 14): BIGINT, unix seconds, every constraint named, every FK column indexed, `$n` binds.

`server/migrations/0002_puzzles.sql` (L6c, re-cut) gains:

```sql
CREATE TABLE hint_unlocks (                     -- META-PLAN M21: replaces the hint:<puzzle>:<tier> entitlements
  user_id     BIGINT NOT NULL,
  puzzle_id   TEXT   NOT NULL,
  tier        BIGINT NOT NULL,
  unlocked_at BIGINT NOT NULL,
  CONSTRAINT hint_unlocks_pkey          PRIMARY KEY (user_id, puzzle_id, tier),
  CONSTRAINT hint_unlocks_user_fk       FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT hint_unlocks_id_shape      CHECK (puzzle_id ~ '^ch[1-9][0-9]*[.][a-z][a-z0-9_]*$'),
  CONSTRAINT hint_unlocks_tier_range    CHECK (tier BETWEEN 1 AND 3),
  CONSTRAINT hint_unlocks_time_positive CHECK (unlocked_at > 0)
);
-- user_id leads the PK: the FK is indexed.
```

`server/migrations/0003_stats.sql` (LS3, re-cut) — two constraints change, one is new:

```sql
  CONSTRAINT stat_events_kind_known CHECK (kind IN ('chapter_started', 'chapter_completed', 'ending_reached',
                                                    'puzzle_ended', 'choice_made')),
  CONSTRAINT stat_events_subject_by_kind CHECK (
       … SP's three branches unchanged …
    OR (kind = 'choice_made' AND subject ~ '^ch[1-9][0-9]*[.][a-z][a-z0-9_]*[.][0-9a-z]{4}$' AND outcome IS NULL)),
  -- as merged (LS3 `00d7c10`, cut D1; server/migrations/0003_stats.sql:28-34): each regex or IN test of `subject`
  -- or `outcome`, this branch's included, carries its own `IS NOT NULL` (on `subject`, and on `outcome` for
  -- puzzle_ended): a NULL CHECK passes
  CONSTRAINT stat_events_choice_in_chapter CHECK (kind <> 'choice_made' OR split_part(subject, '.', 1) = chapter_id),
```

`server/migrations/0004_economy.sql` (LE1, new):

```sql
CREATE TABLE resource_balances (
  user_id    BIGINT NOT NULL,
  kind       TEXT   NOT NULL,                   -- a catalog kind; membership checked in code (the catalog changes)
  balance    BIGINT NOT NULL,
  debt       BIGINT NOT NULL,                   -- the refund shortfall (M20); credits pay it first
  updated_at BIGINT NOT NULL,
  CONSTRAINT resource_balances_pkey            PRIMARY KEY (user_id, kind),
  CONSTRAINT resource_balances_user_fk         FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT resource_balances_kind_shape      CHECK (kind ~ '^[a-z][a-z0-9_]{0,15}$'),
  CONSTRAINT resource_balances_balance_nonneg  CHECK (balance >= 0),
  CONSTRAINT resource_balances_debt_nonneg     CHECK (debt >= 0),
  CONSTRAINT resource_balances_balance_or_debt CHECK (balance = 0 OR debt = 0)
);
CREATE TABLE resource_ledger (                  -- append-only; per (user, kind): balance - debt = SUM(amount)
  id             BIGINT GENERATED ALWAYS AS IDENTITY,
  user_id        BIGINT NOT NULL,
  kind           TEXT   NOT NULL,
  amount         BIGINT NOT NULL,               -- signed: a credit > 0, a debit or clawback < 0
  reason         TEXT   NOT NULL,
  idem_key       TEXT   NOT NULL,               -- the idempotency arbiter (M18 key forms)
  charge_id      TEXT,                          -- pack, pack_refund
  counterpart_id BIGINT,                        -- gift_*, referral_*; set NULL by a counterpart's erasure (Later)
  ref            TEXT,                          -- pack: the product id; hint_spend: '<puzzleId>:<tier>'
  created_at     BIGINT NOT NULL,
  CONSTRAINT resource_ledger_pkey             PRIMARY KEY (id),
  CONSTRAINT resource_ledger_user_fk          FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT resource_ledger_charge_fk        FOREIGN KEY (charge_id) REFERENCES payments (telegram_payment_charge_id),
  CONSTRAINT resource_ledger_counterpart_fk   FOREIGN KEY (counterpart_id) REFERENCES users (id),
  CONSTRAINT resource_ledger_idem_key         UNIQUE (idem_key),
  CONSTRAINT resource_ledger_kind_shape       CHECK (kind ~ '^[a-z][a-z0-9_]{0,15}$'),
  CONSTRAINT resource_ledger_reason_known     CHECK (reason IN ('pack', 'pack_refund', 'hint_spend', 'gift_out',
                                                                'gift_in', 'referral_inviter', 'referral_invitee')),
  CONSTRAINT resource_ledger_sign_by_reason   CHECK (
       (reason IN ('pack', 'gift_in', 'referral_inviter', 'referral_invitee') AND amount > 0)
    OR (reason IN ('pack_refund', 'hint_spend', 'gift_out') AND amount < 0)),
  CONSTRAINT resource_ledger_amount_bounded   CHECK (amount BETWEEN -1000 AND 1000),
  CONSTRAINT resource_ledger_charge_by_reason CHECK ((reason IN ('pack', 'pack_refund')) = (charge_id IS NOT NULL)),
  CONSTRAINT resource_ledger_time_positive    CHECK (created_at > 0)
);
CREATE INDEX resource_ledger_by_user        ON resource_ledger (user_id, reason, created_at);   -- the caps; FK index
CREATE INDEX resource_ledger_by_charge      ON resource_ledger (charge_id) WHERE charge_id IS NOT NULL;
CREATE INDEX resource_ledger_by_counterpart ON resource_ledger (counterpart_id) WHERE counterpart_id IS NOT NULL;
-- Revision 1 (W3): a pack order carries the kind and amount it was invoiced with; the grant credits exactly these.
ALTER TABLE orders
  ADD COLUMN pack_kind   TEXT,                  -- NULL for a chapter order
  ADD COLUMN pack_amount BIGINT,                -- resource units, not Stars; NULL for a chapter order
  ADD CONSTRAINT orders_pack_binding CHECK (
        ((product_id LIKE 'pack:%') = (pack_kind IS NOT NULL))
    AND ((pack_kind IS NULL) = (pack_amount IS NULL))
    AND (pack_kind IS NULL OR (pack_kind ~ '^[a-z][a-z0-9_]{0,15}$' AND pack_amount BETWEEN 1 AND 1000)));
```

P3 (`db/orders.rs`, LE1) binds `pack_kind` / `pack_amount` from the catalog in the order's INSERT (NULL for a chapter);
the grant's `UPDATE orders … RETURNING product_id, pack_kind, pack_amount` hands them to the credit. No existing row
violates the CHECK (no pack order exists before `0004`).

The credit, for one row (`$1` user, `$2` kind, `$3` n > 0, `$4` now; after the ledger insert returned a row):

```sql
INSERT INTO resource_balances AS b (user_id, kind, balance, debt, updated_at) VALUES ($1, $2, $3, 0, $4)
ON CONFLICT (user_id, kind) DO UPDATE SET
  balance    = b.balance + GREATEST($3 - b.debt, 0),   -- both SET expressions read the old row (PostgreSQL)
  debt       = GREATEST(b.debt - $3, 0),
  updated_at = $4
RETURNING balance, debt;
```

The debit: `UPDATE resource_balances SET balance = balance - $3, updated_at = $4 WHERE user_id = $1 AND kind = $2 AND
balance >= $3 RETURNING balance, debt` (no row → insufficient; the caller rolls back, which removes the ledger row). The
clawback: `UPDATE resource_balances SET balance = GREATEST(balance - $3, 0), debt = debt + GREATEST($3 - balance, 0),
updated_at = $4 WHERE user_id = $1 AND kind = $2 RETURNING balance, debt` (the pack's credit created the row).

`server/migrations/0006_achievements.sql` (LM2, new; numbered after LF1's `0005`, the lane order):

```sql
CREATE TABLE achievement_unlocks (              -- display facts (M6); never read by an unlock or content path
  user_id        BIGINT NOT NULL,
  story_id       TEXT   NOT NULL,
  achievement_id TEXT   NOT NULL,
  unlocked_at    BIGINT NOT NULL,
  CONSTRAINT achievement_unlocks_pkey           PRIMARY KEY (user_id, story_id, achievement_id),
  CONSTRAINT achievement_unlocks_user_fk        FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT achievement_unlocks_story_id_shape CHECK (story_id ~ '^[a-z][a-z0-9_]{0,23}$'),
  CONSTRAINT achievement_unlocks_id_shape       CHECK (achievement_id ~ '^[a-z][a-z0-9_]{0,31}$'),
  CONSTRAINT achievement_unlocks_time_positive  CHECK (unlocked_at > 0)
);
```

`server/migrations/0005_social.sql` (LF1, new):

```sql
CREATE TABLE invite_codes (
  code       TEXT   NOT NULL,
  user_id    BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  revoked_at BIGINT,
  CONSTRAINT invite_codes_pkey          PRIMARY KEY (code),
  CONSTRAINT invite_codes_user_fk       FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT invite_codes_shape         CHECK (code ~ '^[0-9a-f]{32}$'),
  CONSTRAINT invite_codes_revoked_after CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);
CREATE UNIQUE INDEX invite_codes_one_active ON invite_codes (user_id) WHERE revoked_at IS NULL;
CREATE INDEX invite_codes_by_user ON invite_codes (user_id, created_at);       -- FK index; rotations per day
CREATE TABLE friend_requests (                  -- revision 1 (C1): the holder asks, the owner accepts
  from_id    BIGINT NOT NULL,                   -- the requester: a holder of to_id's invite code who tapped Send
  to_id      BIGINT NOT NULL,                   -- the code's owner, who accepts or declines this person
  created_at BIGINT NOT NULL,
  CONSTRAINT friend_requests_pkey     PRIMARY KEY (from_id, to_id),
  CONSTRAINT friend_requests_from_fk  FOREIGN KEY (from_id) REFERENCES users (id),
  CONSTRAINT friend_requests_to_fk    FOREIGN KEY (to_id) REFERENCES users (id),
  CONSTRAINT friend_requests_not_self CHECK (from_id <> to_id)
);
CREATE INDEX friend_requests_by_to ON friend_requests (to_id);
CREATE TABLE friendships (
  user_lo    BIGINT NOT NULL,
  user_hi    BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  CONSTRAINT friendships_pkey    PRIMARY KEY (user_lo, user_hi),
  CONSTRAINT friendships_lo_fk   FOREIGN KEY (user_lo) REFERENCES users (id),
  CONSTRAINT friendships_hi_fk   FOREIGN KEY (user_hi) REFERENCES users (id),
  CONSTRAINT friendships_ordered CHECK (user_lo < user_hi)       -- one row per pair, whoever accepted
);
CREATE INDEX friendships_by_hi ON friendships (user_hi);
CREATE TABLE friend_blocks (                    -- revision 1 (C1): a decline or a removal is durable
  user_id    BIGINT NOT NULL,                   -- the remover
  blocked_id BIGINT NOT NULL,                   -- whose requests to user_id now create nothing
  created_at BIGINT NOT NULL,
  CONSTRAINT friend_blocks_pkey       PRIMARY KEY (user_id, blocked_id),
  CONSTRAINT friend_blocks_user_fk    FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT friend_blocks_blocked_fk FOREIGN KEY (blocked_id) REFERENCES users (id),
  CONSTRAINT friend_blocks_not_self   CHECK (user_id <> blocked_id)
);
CREATE INDEX friend_blocks_by_blocked ON friend_blocks (blocked_id);   -- FK index
CREATE TABLE user_handles (                     -- revision 1 (W1): the only user id other users receive
  user_id BIGINT NOT NULL,
  handle  TEXT   NOT NULL,
  CONSTRAINT user_handles_pkey    PRIMARY KEY (user_id),
  CONSTRAINT user_handles_user_fk FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT user_handles_handle  UNIQUE (handle),
  CONSTRAINT user_handles_shape   CHECK (handle ~ '^[0-9a-f]{24}$')
);
CREATE TABLE consents (                         -- append-only; the latest row per (user, purpose) wins
  id             BIGINT GENERATED ALWAYS AS IDENTITY,
  user_id        BIGINT  NOT NULL,
  purpose        TEXT    NOT NULL,
  granted        BOOLEAN NOT NULL,
  policy_version TEXT    NOT NULL,
  text_version   TEXT    NOT NULL,
  at             BIGINT  NOT NULL,
  CONSTRAINT consents_pkey                 PRIMARY KEY (id),
  CONSTRAINT consents_user_fk              FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT consents_purpose_known        CHECK (purpose IN ('friends_profile')),
  CONSTRAINT consents_policy_version_shape CHECK (policy_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[a-z]?$'),
  CONSTRAINT consents_text_version_shape   CHECK (text_version ~ '^[a-z_]+[.]v[1-9][0-9]*$')
);
CREATE INDEX consents_latest ON consents (user_id, purpose, id DESC);
CREATE TABLE referrals (                        -- one per invitee, written on the invitee's first launch (M11)
  invitee_id    BIGINT NOT NULL,
  inviter_id    BIGINT,                         -- NULL only after the inviter's erasure (Later)
  attributed_at BIGINT NOT NULL,
  qualified_at  BIGINT,
  outcome       TEXT,
  CONSTRAINT referrals_pkey          PRIMARY KEY (invitee_id),
  CONSTRAINT referrals_invitee_fk    FOREIGN KEY (invitee_id) REFERENCES users (id),
  CONSTRAINT referrals_inviter_fk    FOREIGN KEY (inviter_id) REFERENCES users (id),
  CONSTRAINT referrals_not_self      CHECK (inviter_id IS NULL OR inviter_id <> invitee_id),
  CONSTRAINT referrals_outcome_known CHECK ((qualified_at IS NULL AND outcome IS NULL)
                                         OR (qualified_at IS NOT NULL AND outcome IN ('granted', 'capped')))
);
CREATE INDEX referrals_by_inviter ON referrals (inviter_id, outcome, qualified_at);
```

Invariant → constraint: one ledger row per operation (`resource_ledger_idem_key`); never negative (`…_balance_nonneg`
plus the conditional UPDATE); debt and balance never both positive (`…_balance_or_debt`); a credit is positive and a
debit negative (`…_sign_by_reason`); pack rows carry their charge (`…_charge_by_reason`, FK to `payments`); one unlock
per tier (`hint_unlocks_pkey`); one unlock per achievement (`achievement_unlocks_pkey`); one friendship per pair
(`friendships_ordered` + PK); one active code (`invite_codes_one_active`); one referral per invitee
(`referrals_pkey`); a qualified referral has an outcome (`referrals_outcome_known`); a choice belongs to its chapter
(`stat_events_choice_in_chapter`); revision 1: a pack order carries its kind and amount (`orders_pack_binding`); one
block per (remover, removed) (`friend_blocks_pkey`); one handle per user, never shared (`user_handles_pkey`,
`user_handles_handle`). Membership in the current catalog, index and meta is checked in code (they change
with builds; old rows stay valid history).

### HTTP API (additions to PP "HTTP API"; common rules unchanged: bearer, JSON camelCase, `private, no-store` unless stated, 16 KB body limit)

| Method + path | Auth | Request | 200 response | Errors | Idempotency / cache | Lane |
|---|---|---|---|---|---|---|
| `POST /api/stats/events` (changed) | bearer | + `kind: "choice_made"`, `subject` = the option ID | unchanged | + reject `unknown_choice`; revision 1 (W2): the 429 counts fact rows only (600/h); + reject `rate_limited` for a repeat pick over the choice budget (600/h; a first pick of an option is recorded at any volume); as merged (LS3 `00d7c10`, O1): a choice-only batch is never a 429, since the facts' rule applies only to a batch that carries a fact | unchanged | LS3, LM2 |
| `GET /api/stats` (changed) | bearer | — | `StatsResponse` without `endingsTotal` (M8) | 401 | read | LS3 |
| `GET /api/puzzles/{puzzleId}?lang` (changed) | bearer | — | `PuzzleStatus { puzzleId, solved, hints: [{ tier, unlocked, text \| null }] }` | as PZ | read | L6c |
| `POST /api/puzzles/{puzzleId}/hints/{tier}?lang` | bearer | — | `HintUseResponse { balance, text }` | 400 (shapes), 403 `not_entitled`, 404, 409 `hint_unavailable` (order, solved), 409 `insufficient_balance` | (user, puzzle, tier): a repeat returns the text and debits nothing | LE1 |
| `GET /api/wallet` | bearer | — | `WalletResponse { balances, packs, hintTierCost }` | 401 | read | LE1 |
| `POST /api/invoices` (changed) | bearer | `productId`: `chapter:<ch>` or `pack:<id>` | as PP | as PP (no `hint_unavailable`) | as PP; revision 1 (W3): a pack order binds its kind and amount at creation | L8a, LE1 |
| `POST /api/stories/{storyId}/card` | bearer | — (empty body) | `CardResponse` (M9) | 400 (shape), 404 unknown story | unlocks `ON CONFLICT DO NOTHING`: a repeat changes nothing, `new` once | LM2 |
| `GET /api/social` | bearer | — | `SocialResponse { inviteCode, friends, requests, profileVisible }` (creates the code on the first call) | 401 | read (+ one code insert, once) | LF1 |
| `GET /api/invites/{code}` (revision 1, C1) | bearer | — | `InviteView { state }`: `open`, `requested` (a request of the caller pending, or a block of the caller by the owner, or the owner's 50 pending), `friends`, `own`; nothing about the owner | 400 (code shape), 404 `not_found` (unknown or revoked code) | read | LF1 |
| `POST /api/invites/{code}/request` (revision 1, C1) | bearer | — (empty body) | `InviteView` (the state after the act) | 400, 404 (unknown or revoked code) | the request PK: a repeat changes nothing; a blocked or capped request answers `requested` and writes nothing | LF1 |
| `POST /api/friends/requests/{handle}/accept` | bearer | — | `SocialResponse` | 404 (no such incoming request), 409 `limit_reached` (either side at 200) | a repeat after success → 404 (the request is gone), the friendship unchanged | LF1 |
| `DELETE /api/friends/{handle}` | bearer | — | `SocialResponse` | 404 (neither a friend nor an incoming request) | a repeat → 404; revision 1 (C1): writes the block (`friend_blocks`, `ON CONFLICT DO NOTHING`) | LF1 |
| `POST /api/invite/rotate` | bearer | — | `SocialResponse` (the new code) | 429 `rate_limited` + `Retry-After` (> 10 per day) | each call rotates | LF1 |
| `PUT /api/consents/friends_profile` | bearer | `ConsentRequest { granted, textVersion }` | `SocialResponse` | 400 (an unknown text version) | appends a row each call; the latest wins | LF1 |
| `GET /api/privacy` | **none** | — | the policy HTML (from LPO on: the operator identity facts and `{POLICY_VERSION}` substituted at startup; revision 1, W4; revision 2, W1) | — | `public, max-age=300`; CSP `default-src 'none'; style-src 'unsafe-inline'` | LF1, LPO |
| `GET /api/friends/{handle}/profile?lang` | bearer | — | `FriendProfile` (M13) | 404 not a friend (or an unknown handle) | read | LF2 |
| `POST /api/share` | bearer | `ShareRequest { storyId \| null, lang, native }` | `ShareResponse { link, text, preparedMessageId }` | 400, 404 unknown story, 429 `rate_limited` (> 20 per hour), 502 `telegram_unavailable` (no username) | none needed (each call prepares a new message) | LF2 |
| `POST /api/gifts` | bearer | `GiftRequest { to (a friend handle), kind, amount, requestId }` | `GiftResponse { balance }` | 400 (shapes; a replay with another body), 404 not a friend (or an unknown handle), 409 `insufficient_balance`, 429 `rate_limited` + `Retry-After` (the daily caps) | (sender, `requestId`): a replay moves nothing and answers 200 | LE2 |

Dev routes (`server-dev` only): `/dev/launch` gains `startapp` (LF1); `GET /dev/prepared/{id}` returns the stored
`PreparedShare` (LF2). `/dev/simulate-payment` and `/dev/refund` work for pack orders unchanged.

Bot (L9): the `/privacy` command (bot text `privacy` in `bot.*.json` with the policy URL); `setMyCommands` lists it.

### Staging DSL change (owning lane LM1)

No tag, option or default changes; the version line stays "DSL v2". In one LM1 commit, with the `LINT_CODES` entry
and the `dsl-doc` count (85 after LS1 → 86):
- **Header:** one sentence after the stories sentence: "§9 also describes the story meta file `story/meta.json`
  (META-PLAN, lane LM1); the tag language is unchanged."
- **§9:** a subsection "Story meta": the file and its format (M4); the condition kinds (M5) in a table; the text
  limits; "every declared ending needs a title"; "an achievement id is never reused for a different achievement"; "meta
  texts are server-only: never put a meta text into ink or a locale table"; "a choice's line ID is also its statistics
  identity (M1): keep it when you edit the text, retire it when you remove the option".
- **§11:** one row: `catalog/meta` | E | the five rules of [the source file section](#source-file--storymetajson), one
  sentence each.

Then `lint.ts`, `dsl-doc.test.ts` and STAGING-DSL are frozen again.

### Build outputs (additions to PP "Build outputs")

| Output | Producer | Where | Public? |
|---|---|---|---|
| server meta (the choice vocabulary, ending titles, achievements) | story tool (LM1) | `server/content/meta.json` | no |
| meta fingerprints (every meta text of ≥ 12 code points, from `story/meta.json`) | `scan-dist.ts` itself (LM1), from the source | in memory during `build` | — |

---

## Module API

```ts
// app/meta.ts (LMI) — created by boot.ts after auth; one per app
export interface MetaController {
  boot(): void;                                        // parallel GETs: social, wallet, stats; never awaited by boot
  hasCard(story: StoryId): boolean;                    // stats endingsReached ∪ the endings reached this session
  openCard(story: StoryId): Promise<Result<void, MetaError>>;     // POST card → push 'card'
  onEnding(story: StoryId): Promise<void>;             // settle(3000) → openCard, or the toast; never throws
  openFriends(): void; openWallet(): void; openConsent(): void;
  gift(to: FriendHandle, kind: ResourceKind, amount: number): Promise<Result<void, MetaError>>;  // one requestId per submit
  share(story: StoryId | null): Promise<void>;         // the M14 sequence incl. the fallback and one re-prepare
  hintPort(): HintPort;
  dispose(): void;
}
export function createMetaController(deps: { http: Http; tg: Tg; screens: Screens; reporter: StatsReporter;
  purchase: PurchaseFlowFactory; lang: () => Lang; loadUi: () => Promise<MetaUi> }): MetaController;

// meta/card.ts, meta/social.ts, meta/wallet.ts (LMD) — plain services over endpoints.ts
export function createCardService(api: MetaApi): { load(story: StoryId, lang: Lang): Promise<Result<CardView, MetaError>> };
export function createSocialService(api: MetaApi): {
  state(): SocialView | null; refresh(): Promise<Result<SocialView, MetaError>>;
  accept(from: FriendHandle): Promise<Result<SocialView, MetaError>>; remove(user: FriendHandle): Promise<Result<SocialView, MetaError>>;
  rotate(): Promise<Result<SocialView, MetaError>>; setVisible(on: boolean): Promise<Result<SocialView, MetaError>>;
  profile(user: FriendHandle, lang: Lang): Promise<Result<FriendProfileView, MetaError>>;
  invite(code: string): Promise<Result<InviteView, MetaError>>;          // revision 1 (C1): GET /api/invites/{code}
  ask(code: string): Promise<Result<InviteView, MetaError>>;             // revision 1 (C1): POST …/request
  prepareShare(story: StoryId | null, lang: Lang, native: boolean): Promise<Result<ShareResponse, MetaError>> };
export function createWalletService(api: MetaApi): {
  state(): WalletView | null; refresh(): Promise<Result<WalletView, MetaError>>; hintPort(open: () => void): HintPort };
// The gift call is MetaController.gift (LMI: the endpoint, its decoder and the request id kept across retries live in
// LMI, because GiftResponse exists only after LE2 and LMD runs beside LE2).

// puzzles/session.ts (LP2 re-cut): createPuzzleSession(deps: { …; hints: HintPort | null })
//   useHint(tier): void — single-flight; a 409 insufficient offers port.getMore(); texts in memory only
// stats/reporter.ts (LS4 re-cut): settle({ timeoutMs })
```

```rust
// api/cards.rs (LM2)
pub async fn card(st: &AppState, user: UserId, story: &StoryId) -> Result<CardResponse, ApiError>;
// db/achievements.rs (LM2)
impl Repo {
    pub async fn story_facts(&self, u: UserId, story: &StoryId, puzzles: &[PuzzleId]) -> Result<Facts, sqlx::Error>; // 2 reads
    pub async fn unlocks(&self, u: UserId, story: &StoryId) -> Result<BTreeMap<String, i64>, sqlx::Error>;
    pub async fn insert_unlocks(&self, u: UserId, story: &StoryId, ids: &[&str], now: i64) -> Result<Vec<String>, sqlx::Error>;
    pub async fn owned_products(&self, u: UserId) -> Result<BTreeSet<ProductId>, sqlx::Error>;
}
// db/social.rs (LF1; LF2 and LE2 read). Revision 1: the referral only at auth; invites; handles; blocks.
impl Repo {
    pub async fn auth_with_code(&self, u: &TgUser, code: Option<&str>, now: i64) -> Result<AuthAttribution, sqlx::Error>;
    pub async fn invite_state(&self, me: UserId, code: &str) -> Result<Option<InviteState>, sqlx::Error>;   // None: 404
    pub async fn ask(&self, me: UserId, code: &str, pending_cap: i64, now: i64)                           // F19 step 4
        -> Result<Option<InviteState>, sqlx::Error>;
    pub async fn user_by_handle(&self, h: &str) -> Result<Option<UserId>, sqlx::Error>;
    pub async fn social(&self, u: UserId, now: i64) -> Result<SocialRows, sqlx::Error>;
    pub async fn accept(&self, me: UserId, from: UserId, cap: i64, now: i64) -> Result<AcceptOutcome, sqlx::Error>;
    pub async fn remove(&self, me: UserId, other: UserId, now: i64) -> Result<bool, sqlx::Error>;    // + the block
    pub async fn rotate(&self, me: UserId, per_day: i64, now: i64) -> Result<RotateOutcome, sqlx::Error>;
    pub async fn record_consent(&self, me: UserId, granted: bool, policy: &str, text: &str, now: i64) -> Result<(), sqlx::Error>;
    pub async fn are_friends(&self, a: UserId, b: UserId) -> Result<bool, sqlx::Error>;
    pub async fn profile_visible(&self, u: UserId) -> Result<bool, sqlx::Error>;
}
// db/users.rs (LF1): upsert_user returns `inserted: bool` (RETURNING old.id IS NULL)
// db/economy.rs (LE1, LE2)
impl Repo {
    pub async fn balances(&self, u: UserId) -> Result<Vec<BalanceDto>, sqlx::Error>;
    pub async fn spend_hint(&self, u: UserId, p: &PuzzleId, tier: u8, cost: u32, now: i64) -> Result<SpendOutcome, sqlx::Error>;
    pub async fn transfer(&self, from: UserId, to: UserId, kind: &ResourceKind, amount: u32, request_id: &str,
                          rules: &GiftRules, now: i64) -> Result<GiftOutcome, sqlx::Error>;           // LE2
    pub async fn qualify_referral(&self, invitee: UserId, chapter: &ChapterId, rules: &ReferralRules, now: i64)
        -> Result<ReferralOutcome, sqlx::Error>;                                                       // LE2
}
// api/legal.rs (LF1): pub fn routes() -> Router<AppState>; pub fn policy_version() -> &'static str
// api/legal.rs (LPO, revision 1 W4): + Policy::load (above); the route serves AppState.policy; revision 2 W1:
//   + IDENTITY_KEYS, CONTENT_KEYS, POLICY_PINS (above); revision 3 W1: POLICY_PINS, PinError and check_pins are
//   #[cfg(test)], not module API (above)
// lib.rs (LF2): AppState gains `share_limit: Arc<RateWindow>` (20 per user per rolling hour, pruned on access)
```

---

## Critical flows

### F15. Choice capture (client → server)
1. Client: the player taps an option; GameSession calls `runner.choose(i)` and `reporter.record({ kind:
   'choice_made', chapterId, storyVersion, option: choices[i].lineId })` (L15). `record` never throws or awaits (ST8).
2. Reporter: the queue and its DeviceStorage mirror; the normal flush policy (5 s; at once on an ending).
3. Server: `POST /api/stats/events` → per event: the chapter known → a paid chapter owned → the option in
   `meta.choices[chapter]` (LM2; LS3 checks the shape and the chapter prefix) → `INSERT … ON CONFLICT DO NOTHING`.
- Fails/repeats: a lost response → the retry keeps the ids → duplicates; an unknown option (a build mismatch) →
  `rejected: unknown_choice`, dropped; offline → the queue keeps ≤ 64 events, evicting the oldest choice first (never a
  fact while a choice is queued); over the choice budget (600 per rolling hour) → a repeat pick is `rejected:
  rate_limited` and dropped, a first pick of an option is recorded, and facts are never refused because of choices
  (revision 1, W2).

### F16. Ending → "The End" → the card (client, server)
1. Client: the ending knot's END (SP F4′) → `Notice` `the_end` with "Прохождение" and "К историям"; the reporter
   already flushes `ending_reached` at once (SP Y13).
2. Client: `meta.onEnding(story)` → `reporter.settle({ timeoutMs: 3000 })`.
3. `drained` → `POST /api/stories/{story}/card` → server M6 (≤ 5 statements) → `CardResponse`.
4. Client: the `meta-ui` chunk (prefetched after the first line) → push `card`; new achievements marked.
5. Back → `the_end`. "К историям" → `exitToStories()` (SP).
- Fails: `timeout` or a card error → no card; the toast `meta.card_later`; "Прохождение" on `the_end` retries 2–4; a
  401 → PP's re-auth once; the chunk fails to load → the toast, the retry action stays.

### F17. The card from Home
1. Boot: `GET /api/stats` (parallel) → `hasCard(story)` per story → `StoryPicker` shows "Прохождение".
2. A tap → F16 steps 3–5 (the settle is skipped: nothing of that story is in play).
- Fails: the stats fetch failed → no button until the next boot or an ending in this session.

### F18. Share or invite (the sharer: client → server → Telegram)
1. Client: Share (card) or Invite (Friends) → `POST /api/share { storyId | null, lang, native:
   tg.supportsShareMessage() }`.
2. Server: the rate check (20/h) → the sharer's invite code (created if absent) → `gateway.bot_username()` (cached) →
   the text from `server/locales/meta.json` with the story title and the sharer's counts (current index) → if native:
   `savePreparedInlineMessage` → `ShareResponse`.
3. Client: a `preparedMessageId` → `tg.shareMessage(id)`; `MESSAGE_EXPIRED` → steps 1–3 once more; `UNSUPPORTED`, no
   id or `native: false` → `tg.openTelegramLink('https://t.me/share/url?url=' + enc(link) + '&text=' + enc(text))`;
   `USER_DECLINED` → nothing; `send-failed` / `unknown` / no event in 60 s → a toast with "Send as link".
- Fails: 429 → a toast with the wait; 502 (no username) → the toast "Telegram недоступен".

### F19. Opening an invite and asking (the link holder: Telegram → client → server; rewritten in revision 1, C1)
1. Telegram: the holder taps the message's button → `https://t.me/<bot>?startapp=f<code>` → the Mini App opens with
   `start_param` inside initData.
2. Client: `POST /api/auth` (PP F1). Server: verify initData (PP K16) → M11's transaction: the upsert (inserted?) →
   for a newcomer, the code's owner and a referral row. No friend request. `AuthResponse` unchanged.
3. Client, at boot (parallel, never awaited before the first line): `tg.startParam()` is `f<code>` →
   `GET /api/invites/{code}` → `open` → push `invite`: it names nobody and says that the person who shared the link
   will see the player's first name and that a friendship forms only if that person accepts. Any other state, or a 404
   → no prompt.
4. Send → `POST /api/invites/{code}/request` → server, one transaction: the code active (else 404) and not the
   caller's (`own`); lock both `users` rows ascending; already friends → `friends`; a block of the caller by the owner,
   a pending request of the caller, or 50 pending requests to the owner → `requested`, nothing written; else delete the
   caller's own block of the owner (if any: the caller's act lifts it), insert the request `ON CONFLICT DO NOTHING`,
   ensure the caller's handle → `requested`. Client: the toast `meta.invite_sent`. "Not now" → nothing (the prompt
   comes back on a later launch from the same link while the state is `open`).
5. The owner: Friends lists the incoming request (the requester's first name, under a handle) → F20.
- Fails/repeats: a second launch from the same link → the state is `requested` → no prompt; a revoked or unknown code →
  404 → no prompt; one's own code → `own` → no prompt; a blocked requester → `requested` on every later attempt,
  indistinguishable from a pending request; a newcomer's referral row is written once (`ON CONFLICT DO NOTHING`).

### F20. Accept or decline (the code's owner; revision 1, C1, W1)
1. Client: Accept → `POST /api/friends/requests/{handle}/accept` → server: the handle → the requester (none → 404);
   one transaction (lock both `users` rows ascending; delete the request from that user to me, none → 404; both below
   200 friends, else 409 `limit_reached`; insert the friendship `ON CONFLICT DO NOTHING`; delete the reverse request if
   any; ensure my handle) → `SocialResponse`.
2. Decline → `DELETE /api/friends/{handle}` → one transaction (lock both `users` rows ascending; delete the friendship
   or the incoming request, neither → 404; delete any request between the two; insert `friend_blocks (me, other) ON
   CONFLICT DO NOTHING`) → `SocialResponse`. The same route removes a friend, from either side.
- Repeats: a double tap → the second answer is 404 (already accepted) and the client refreshes the list; a declined or
  removed user who asks again → F19 step 4 answers `requested` and creates nothing (`unfriend_is_durable_against_old_code`,
  `decline_is_durable_against_old_code`).

### F21. Profile visibility consent
1. Client: Friends → "Показывать мой прогресс друзьям" → the `consent` overlay (its own text, the policy link) → on /
   off.
2. `PUT /api/consents/friends_profile { granted, textVersion: 'friends_profile.v1' }` → one row with the server's
   policy version → `SocialResponse.profileVisible`.
- Repeats: each call appends a row; the latest wins (`consents_latest`).

### F22. A friend's profile
1. Client: Friends → a friend → `GET /api/friends/{handle}/profile?lang` → server: the handle's user and the
   friendship in one read (404) → the friend's
   latest consent (`visible: false` → stop) → the friend's facts and unlocks (current index) → the viewer's facts,
   unlocks and entitlements → counts + the shared titles passing the viewer's gate (≤ 7 statements).
2. Client: the `friend` overlay; its Gift button (F25).
- Races: consent withdrawn between the list and the profile → `visible: false`; unfriended → 404 → the list refreshes.

### F23. Buying a hint pack
1. Client: Wallet → a pack → the terms checkbox (PP P1) → `PurchaseFlow.buy('pack:<id>')` → PP P2–P7.
2. Server: P3 → the order (binding the pack's kind and amount, revision 1 W3) and the invoice; P5 pre-checkout (the
   lock + the conditional UPDATE); P6 grant: the payments insert → the order `paid` (returning its binding) → `Pack` →
   the ledger `pay:<charge>` + the credit of the bound kind and amount, one transaction; the catalog is not read.
3. Client: the polled order `paid` → `GET /api/wallet` → the chip and the wallet show the new balance.
- Fails/repeats: as PP (a duplicate delivery → `Duplicate`; a lost credit is impossible: same transaction).

### F24. Using a hint
1. Client: the ladder's "Use (1)" on tier n (enabled when tier n − 1 is unlocked and the port's balance ≥ 1) →
   `port.use(puzzle, n, lang)` → `POST /api/puzzles/{id}/hints/{n}?lang`.
2. Server: M21's transaction → `{ balance, text }`.
3. Client: the text in memory only (PZ X7); the chip updates.
- Fails: 409 `insufficient_balance` → "Get more" (the wallet); 409 `hint_unavailable` → the ladder refreshes from
  `GET /api/puzzles/{id}`; a lost response → the retry finds the unlock and debits nothing.

### F25. Gifting
1. Client: a friend → Gift → the `gift` dialog (amount 1–`maxPerGift`, bounded by the balance) → `POST /api/gifts { to,
   kind, amount, requestId: crypto.randomUUID() }` (`to` the friend's handle; the id kept until a definitive answer).
2. Server: M22's transaction.
3. Client: the new balance; a 429 shows when the next gift is possible.
- Repeats: a retry with the same `requestId` → 200, nothing moves twice.

### F26. Referral qualification (revision 1, W5)
1. The invitee's client: plays the story's first chapter; `chapter_started` (flushed within 5 s) … the chapter's END
   → `chapter_completed` (or a mid-chapter ending's `ending_reached`); later play sends more batches.
2. Server, on every stats batch after its insert: one statement — the user's unqualified referral (PK) with the
   evidence (a recorded first-chapter completion whose chapter's earliest `chapter_started` was received ≥ 120 s before
   this batch) → M23's transaction (both credits, or `capped`).
3. Clients: the next wallet read shows the bonus.
- Races: two batches qualify concurrently → one `UPDATE referrals … WHERE qualified_at IS NULL` wins; the other sees no
  row. A completion less than 120 s after the start → nothing now; the first batch received ≥ 120 s after the start
  qualifies. A failed hook → rolled back and logged, the stats response unchanged; the next batch (a retry of the same
  batch included, all duplicates) qualifies.

### F27. Pack refund (admin → Telegram → server)
1. Admin `/refund <charge>` or `POST /dev/refund` → `refundStarPayment` → PP's revoke transaction → the charge's
   `pay:<charge>` ledger row (the credited kind and amount; revision 1, W3) → `clawback_in_tx` of exactly that
   (`refund:<charge>`); no such row → no clawback; the catalog is not read.
2. A `refunded_payment` update → the same revoke → `AlreadyRefunded` (no second clawback: the payment row's guard, and
   the ledger key).

### F28. The privacy policy
1. Telegram's Privacy Policy button (the BotFather URL), the bot's `/privacy`, or the app's link → `GET /api/privacy`
   (public). In the app: `tg.openLink(url)` from the tap (principle 5).

---

## Concurrency and failure model

Additions to PP's, PZ's and SP's tables.

**Lock order (every transaction of this plan):** `users` rows in ascending id (`FOR NO KEY UPDATE`), then
`resource_balances` rows in ascending (user id, kind), then the rest. Pre-checkout takes only the payer's `users` row;
the grant takes no `users` lock and one balance row; gifts, accepts and the referral grant take `users` rows first. No
cycle: nothing that holds a balance row waits for a `users` row. FK checks take `KEY SHARE`, which `NO KEY UPDATE`
does not block.

| Race / failure | Outcome | Test |
|---|---|---|
| The same card POST twice at once (two taps, two devices) | both evaluate; the PK lets one insert win; `new: true` in exactly one response | `card_concurrent_posts_new_once` |
| The card requested before the ending's event is recorded | `settle` first; on `timeout` no card (the toast), the retry action stays | `game: ending settles stats then opens the card` |
| Two uses of the same tier at once | the second insert waits on the first's PK, then finds the row: 200, no second debit | `hint_spend_concurrent_debits_once` |
| Two uses of different tiers, balance 1 | the second debit re-evaluates `balance >= 1` on the committed row: no row → ROLLBACK → 409 | `balance_never_negative_concurrent_spends` |
| A use while a pack credit commits | the debit waits on the balance row lock and sees the credit (READ COMMITTED re-evaluation) | covered by the two above |
| A duplicate `successful_payment` of a pack | the payments PK arbitrates; the twin is `Duplicate`; one ledger row | `pack_credit_once_on_duplicate_payment` |
| The grant fails after the ledger insert | one transaction: no payment, no order change, no ledger row; Telegram redelivers | `pack_grant_credits_in_the_grant_transaction` |
| A refund while the hints are being spent | the clawback waits on the balance row, then takes what is left; the rest is debt | `refund_spent_pack_records_debt` |
| A refund twice (admin + `refunded_payment`) | the payments `refunded_at` guard: one revoke, one clawback (and the ledger key) | `refund_pack_twice_claws_once` |
| Two gifts from one sender at once (cap 3, each 2) | the sender's `users` row lock serializes; the second counts the first: 429 | `gift_concurrent_same_sender_respects_cap` |
| A→B and B→A gifts at once | both lock the two `users` rows in ascending id: they serialize, no deadlock | `gift_opposite_directions_no_deadlock` |
| A gift retried after a lost response | the `…:out` ledger key: a replay, 200, nothing moves | `gift_replay_moves_once` |
| Unfriended between the dialog and the gift | the friendship read after the locks: 404 | `gift_requires_friendship` |
| Two stats batches both completing the first chapter | the guarded `UPDATE referrals … qualified_at IS NULL` lets one grant | `referral_concurrent_batches_grant_once` |
| A and B accept each other's requests at once | both lock the two `users` rows ascending; the friendship PK; one row | `accept_both_directions_one_friendship` |
| Two requests to one owner at once (the owner's pending count 49; revision 1, C1) | both transactions lock the owner's `users` row: the second counts the first and answers `requested` without a row; exact | `pending_requests_capped` |
| A request sent while the owner declines or removes that person (revision 1, C1) | both lock the two `users` rows ascending: a request after the decline sees the block (`requested`, nothing written); a decline after the request deletes it and writes the block | `unfriend_is_durable_against_old_code`, `decline_is_durable_against_old_code` |
| A code rotated while a holder opens the old link | the old code is revoked: `GET /api/invites/{code}` and the request answer 404; nothing is created | `revoked_code_creates_nothing` |
| A batch holds an ending while the hour already has ≥ 600 choice rows (a skip-mode replay; revision 1, W2) | facts have their own budget: the ending is recorded; a repeat pick over the choice budget is rejected `rate_limited`, a first pick recorded | `stats_cap_does_not_refuse_facts`, `stats_choice_over_budget_keeps_first_picks` |
| The queue is full of choices when an ending is recorded (offline, a long skip replay; revision 1, W2) | the oldest choice is evicted, never the ending; the next batch sends facts first | `reporter: queue full of choices keeps ending_reached`, `reporter: batch sends facts first` |
| The referral hook fails after the events' insert (`lock_timeout`, a transient error; revision 1, W5) | rolled back and logged; the stats response unchanged; the next batch re-reads the evidence and qualifies | `referral_qualifies_after_hook_failure` |
| A deploy changes or retires a pack between its invoice and the payment, or before its refund (revision 1, W3) | the grant credits the order's bound kind and amount; the refund claws back the `pay:<charge>` ledger row's | `pack_credit_uses_amount_bound_at_order`, `refund_claws_back_the_credited_amount` |
| Consent toggled on two devices | append-only; the latest `id` wins | `consent_latest_row_wins` |
| A prepared message expired before the tap | `MESSAGE_EXPIRED` → one re-prepare and retry, then the link fallback | `meta: expired prepared message re-prepared once` |
| `shareMessage` unsupported or silent (an old client, the iOS sheet issue) | the link fallback; the 60 s guard ends the wait | `share: below 8.0 is unsupported`, `meta: share falls back when unsupported` |
| `getMe` or `savePreparedInlineMessage` fails | username unknown → 502; prepare failed → `preparedMessageId: null` → the link | `share_prepare_failure_falls_back_to_link` |
| Token expiry during a meta request | PP's single-flight re-auth once (L10) | PP `http: 401 re-auths once` |
| `deactivated` during a share or a purchase | the share's 60 s guard; the purchase flow as PP (re-poll on `activated`) | PP |
| A story update retires an achievement or an ending | not shown (the current meta); the stored rows stay history | `card_retired_achievement_hidden` |
| A server restart | the share limiter forgets its windows (≤ 20 more shares per user); nothing else is in memory | — (accepted) |

No blocking work in async handlers: every new route is database I/O through sqlx, two Bot API calls through the
gateway (5 s timeouts), and a pure in-memory evaluation (≤ 50 achievements, microseconds). Every transaction is READ
COMMITTED with the statements listed; `lock_timeout` as RULINGS 14 sets it for the pool.

---

## Resource lifetime

| Resource | Owner | Created | Destroyed | Leak detection |
|---|---|---|---|---|
| The `meta-ui` chunk (JS) | the module graph | the first `loadUi()` (the prefetch after the first line) | never (one per session, ≤ 14 KB br) | the budget row |
| Card / profile data | the overlay component | on open | on close (unmount) | `card: data dropped on close` (LU1) |
| Hint texts | the puzzle session | on use / status read | the session's dispose (PZ X7) | `hints: texts never written to storage` |
| Share event listeners | `tg.shareMessage` | per call | on the first event or the 60 s guard | `share: listeners removed after the event` (L7) |
| Prepared messages | Telegram (production); the fake gateway's map (dev) | per share | Telegram's `expiration_date`; the dev process exit | — |
| Share limiter entries | `AppState.share_limit` | a user's first share in a window | pruned on access when older than 1 h | `share_rate_limited_after_20_per_hour` |
| Invite codes | `invite_codes` | the first `GET /api/social` / a rotation | never (revoked rows stay) | — |
| Friend blocks, user handles (revision 1) | `friend_blocks`, `user_handles` | a decline or removal; the user's first request sent or accepted | a block: the blocker's own request to that person; both: erasure (Later) | — |
| A gift's `requestId` | the gift dialog | on submit | on a definitive answer | `wallet: gift retry keeps its request id` (LMI) |

No Pixi resource, texture or audio buffer is created by this plan (the meta UI is DOM; principle 7).

---

## Paid-content protection

Additions to PP's section.

- **Meta texts.** Only in `server/content/meta.json`; `emit: meta texts only in server outputs` (LM1) proves no public
  output of the story tool holds any of them; `scan-dist` builds a fingerprint set from `story/meta.json` itself (every
  text of ≥ 12 code points, ru and en) and fails `build` if one appears in `dist/` (`scan: meta text in dist fails`,
  seen red with a scratch import). Shorter titles are kept out by type: the public catalog decoder has exact keys, and
  no client type outside the card DTOs has a meta text field.
- **Paid gates.** The card and the friend profile pass every item through `meta::visible` with the viewer's
  entitlements (the MT3 tests).
- **The choice vocabulary.** Server-only (`meta.json`); a non-buyer's paid-chapter choice event is rejected as
  `not_entitled` before the vocabulary is consulted (`stats_paid_choice_needs_entitlement_first`).
- **Shares.** The text holds the story title (public) and counts; never a title; no image, no public URL of ours
  (`share_text_has_no_titles`).

---

## Privacy: personal-data inventory, lawful bases, erasure

| Data | Where | Purpose | Basis 152-FZ / GDPR (INTERPRETATION, lawyer item) | Who sees it | Retention |
|---|---|---|---|---|---|
| Telegram id, first name, language, created / last seen | `users` | the account; the language; the friend list shows the first name | contract, art. 6 p. 1 item 5 / 6(1)(b) | the player; their friends, and the code owner the player sent a request to: the first name only, under the handle — the Telegram id never reaches another user (revision 1, W1) | keep (Q23) |
| Saves (story, slot, body) | `saves` | resuming | contract / 6(1)(b) | the player | keep |
| Orders, payments, entitlements | `orders`, `payments`, `entitlements` | purchases, refunds | contract + a legal obligation (accounting), items 5 and 2 / 6(1)(b), (c) | the player; admins (`/refund`) | keep; payments kept after erasure |
| Statistics incl. choices | `stat_events` | the card; later the aggregate "X % chose" | the card: contract / 6(1)(b); the aggregate: legitimate interest, item 7 / 6(1)(f) with an objection right | the player (the card); aggregates only | keep |
| Puzzle progress, hint unlocks | `puzzle_progress`, `hint_unlocks` | puzzles, the card | contract / 6(1)(b) | the player | keep |
| Achievement unlocks | `achievement_unlocks` | the card, friend profiles | contract / 6(1)(b); shown to friends by consent / 6(1)(a) | the player; friends with consent | keep |
| Balances, the ledger (incl. gift and referral counterparts) | `resource_balances`, `resource_ledger` | the economy; refund handling; anti-abuse | contract / 6(1)(b); anti-abuse 6(1)(f) | the player | keep |
| Invite codes, friend requests, friendships, friend blocks, user handles (revision 1) | `invite_codes`, `friend_requests`, `friendships`, `friend_blocks`, `user_handles` | the friends feature; a block keeps a decline or removal final; a handle addresses a user without their Telegram id | contract (the feature the player uses) / 6(1)(b) | a request: its recipient (the requester's first name and handle); a friendship: the two parties; a block: nobody (the blocked side sees `requested`); a code: its owner | until removed; blocks and handles keep (Q23) |
| Consents | `consents` | proof of consent (art. 9 p. 3; GDPR 7(1)) | a legal obligation / 6(1)(c) | admins | keep |
| Referrals | `referrals` | the referral bonus; anti-abuse | contract / 6(1)(b); 6(1)(f) | admins | keep |
| Share rate windows | memory (`AppState`) | protecting the bot's Bot API quota | legitimate interest / 6(1)(f) | nobody | ≤ 1 h |
| On-device caches (revision 1, W6): the pending autosaves (`pending_<story>`: the save body, SP Y7), the stats queue (`stats_queue`, SP Y13) | DeviceStorage (Bot API 9.0+) — on the device | offline resilience | contract / 6(1)(b) (ePrivacy 5(3) open, SP) | the device | until the server acknowledges them |
| Settings and the read-set (32-bit hashes of the line IDs the player has read, per chapter; PP K13) (revision 1, W6) | Telegram CloudStorage — on Telegram's servers, synced across the player's devices (a third-party host; part of `{CROSS_BORDER_TRANSFER}`, policy §7, §8) | preferences; skip mode on every device | contract / 6(1)(b) | the player; Telegram as the host | until overwritten; Telegram's own retention otherwise (verify: Telegram documents none) |
| Server logs (user ids on errors) | the host | operations, security | legitimate interest / 6(1)(f) | admins | the host's rotation (MV18) |
| Shared messages | Telegram (sent by the player from their own account) | the player's own disclosure | — (the player's act; Telegram's policy) | the chat | Telegram |

Not stored: `last_name`, `username`, `photo_url`, `is_premium`, `allows_write_to_pm`, `chat_instance`, `chat_type`, the
phone, contacts, IP addresses in tables. What friends see is M13; what a share holds is M14; what the invite link
reveals (revision 1, C1): nothing about the inviter — its holder may only ask, the inviter sees the asker's first name
(under a handle) and decides per person, and a newcomer's first launch through it records a referral that no other
user sees. The friend circle every friends-only item reaches is exactly the accounts whose request the player accepted
and the accounts that accepted the player's request.

**Erasure (designed; the command is a Later lane before production).** One transaction per user, children first (no
cascades, decision §4.1): `achievement_unlocks`, `stat_events`, `hint_unlocks`, `puzzle_progress`, `saves`, `consents`,
`friend_requests` (both directions), `friendships` (both columns), `friend_blocks` (both columns), `user_handles`,
`invite_codes`, `referrals` (as invitee: delete; as
inviter: `inviter_id = NULL`), `resource_ledger` (other users' rows naming this user: `counterpart_id = NULL`; own rows
without a `charge_id`: delete; own rows with a `charge_id` stay with their payment), `resource_balances`,
`entitlements`; then, because `payments` and `orders` are kept for accounting, the `users` row is anonymised
(`first_name = ''`, `language_code = NULL`) instead of deleted. Telegram §4.2(a) asks for deletion on request: until the
command exists, the D2 runbook `privacy-ops` describes the same order as a manual procedure.

---

## Integration

### Modules (new or changed)

| Path | Lane | Responsibility |
|---|---|---|
| `client/scripts/story/meta.ts` (+ test) | LM1 | decode and lint `story/meta.json`; choice points; plan `server/content/meta.json` |
| `client/scripts/scan-dist.ts` | LM1 | + the meta fingerprints from the source |
| `server/src/meta.rs` | LM2 | `MetaIndex`, conditions, `met`, `gate`, `visible` |
| `server/src/content.rs` | LM2 | loads `meta.json`, the startup checks |
| `server/src/db/achievements.rs`, `server/src/api/cards.rs` | LM2 | facts, unlocks, the card |
| `server/src/api/stats.rs` | LS3, LM2, LE2 | `choice_made`; the vocabulary check; the referral hook |
| `server/src/catalog.rs`, `server/catalog.json` | LE1 | the economy section, pack products |
| `server/src/db/economy.rs`, `server/src/api/wallet.rs` | LE1, LE2 | the ledger, balances, spend, transfer, the referral grant |
| `server/src/api/puzzles.rs` | L6c, LE1 | the status with unlocks; the hint use route |
| `server/src/db/payments.rs` | L8b, LE1, L9 | the grant's `ProductRef` branch; the pack credit of the order's bound kind and amount; the clawback of the credited ledger row; unapplied |
| `server/src/db/orders.rs` | L8a, LE1 | revision 1 (W3): P3 binds a pack order's kind and amount |
| `server/src/auth/initdata.rs`, `server/src/api/auth.rs`, `server/src/db/users.rs` | LF1 | `start_param`, attribution, the inserted flag |
| `server/src/db/social.rs`, `server/src/api/social.rs` | LF1, LF2 | friends, invites (ask), requests, blocks, handles, codes, consents; the friend profile |
| `server/src/api/legal.rs`, `server/legal/privacy-policy.html` | LF1, LPO (the file: this campaign) | the public policy route; the operator identity facts substituted, content keys refused, the template pinned per version (LPO; revision 2, W1) |
| `server/src/config.rs`, `.env.example`, `server/src/lib.rs` | LPO | revision 1 (W4): `PRIVACY_OPERATOR_FILE`; `AppState.policy`, `StartupError::Privacy` |
| `server/src/api/share.rs`, `server/locales/meta.json`, `server/src/telegram/gateway.rs` | LF2 | shares, prepared messages, `getMe` |
| `server/src/api/gifts.rs` | LE2 | gifts |
| `server/dev/src/launch.rs`, `server/dev/src/fake_gateway.rs` | LF1, LF2 | `startapp`; prepared messages |
| `client/src/telegram/*` | L7 | the share and link facade methods; the mock |
| `client/src/meta/{card,social,wallet}.ts` | LMD | the services |
| `client/src/ui/meta/*.svelte`, `client/src/i18n/meta.ts` | LU1 | the presentational overlays, the meta table |
| `client/src/app/meta.ts` | LMI | the controller |

### docs/FEATURE_MAP.md entries (D2 writes them; D1 if LM1 merged first)

Choice capture → `stats/reporter.ts`, `api/stats.rs`, `scripts/story/meta.ts`; Achievements → `story/meta.json`,
`meta.rs`, `db/achievements.rs`; Completion card → `api/cards.rs`, `ui/meta/CompletionCard.svelte`, `app/meta.ts`;
Friends → `db/social.rs`, `api/social.rs`, `ui/meta/Friends.svelte`; Sharing → `api/share.rs`, `telegram/gateway.rs`,
`telegram/webapp.ts`; Economy → `catalog.json` `economy`, `db/economy.rs`, `api/wallet.rs`; Hints → `api/puzzles.rs`,
`puzzles/session.ts`; Gifts and referrals → `api/gifts.rs`, `api/stats.rs` (the hook); Privacy → `api/legal.rs`,
`server/legal/privacy-policy.html`, `PRIVACY_OPERATOR_FILE` (`config.rs`, revision 1), the `privacy-ops` runbook. Review rules: `db/achievements.rs` only from
`api/cards.rs` and `api/social.rs`; `db/economy.rs` credits only from the grant, gifts and the referral hook.

### PROTOTYPE-PLAN.md, STORIES-PLAN.md and PUZZLES-PLAN.md items changed (each marked "Changed by META-PLAN" there)

- PP: Goal (the T7–T11 row, an MT row, the budget line); K3; K18; K19; K20; K26; the module map (`catalog.rs`); HTTP API;
  Payment flow (the hint tiers paragraph, the pre-checkout SQL and its notes, the hint products paragraph, the grant,
  unapplied, the refund, the bot commands); the Telegram integration module (production + the dev mock); Budgets (the
  all-JS row, a meta-ui row); THE LANE CUT (collision locks; the dependency order; the lane count; the launch
  preference; the critical path); lanes L6c, L8a, L8b, LS3, L7, L10, L9, D1, L14a, N1, N2, L14b, LP2, LS4, L15, D2
  re-cut; new lanes LE1, LF1, LM2, LF2, LE2, LM1, LU1, LMD, LMI; Later; Open questions; Readiness; Revision log.
- SP: Goal (the "X of Y" sentence; ST5, ST6); Y9; Y10; Y12; Y14; Y16; Y17; Identifiers; the `catalog.json` server
  format; the TS and Rust stats types; the SQL `0003`; HTTP API; F12; test names; Open questions (Q23–Q25 resolved);
  Revision log.
- PZ: X6, X7, X18 (each points here); Identifiers (the hint product row); Server formats (`catalog.json` `hints`); a
  section "Changed by META-PLAN" listing the superseded hint-purchase items; Revision log.
- Revision 1 (triage round 1) changes, marked "revision 1" in those places: PP Goal (the MT row), K19, K20, HTTP API
  (the META-PLAN routes row), Payment flow (hint packs, the grant's pack branch, the refund), the wrappers line
  (`startParam`), the lane-cut rules (the `config.rs` pre-declaration), collision locks, the dependency order (+ LPO;
  the L9 and D2 gates), the lane count, the launch preference, the critical path, lanes LS3, LE1, LF1, LF2, LE2, L9,
  L14a, LU1, LS4, LMD, LMI, D2 and the new LPO, the Revision log; SP Y11, Y13, the stats constants, F11, the
  concurrency table, Budgets, Test strategy, the Revision log. PZ is not changed.
- Revision 2 (triage round 2, W1) changes, marked "revision 2" in those places: PP lane LPO (goal, commits 1 and 2,
  mutations, seen working), D2 (the `privacy-ops` runbook), the Revision log. SP and PZ are not changed.
- Revision 3 (triage round 3, W1) changes, marked "revision 3" in those places: PP lane LPO (goal, commit 2, mutations,
  seen working), the Revision log. SP and PZ are not changed.

---

## Implementation plan

The lane entries (goal, gate, lock, commits with red-firsts, gates, seen working) are in PP "Implementation plan — THE
LANE CUT", section "Lanes". Summary:

| Lane | Slot | Gate to start (merged) | Files | Commits | Scope |
|---|---|---|---|---|---|
| **LE1** economy-core | server | LS3 | 15 | 6 | `0004` (+ the order's pack binding, revision 1), the ledger + balances, pack products, the grant credit of the bound amount, `GET /api/wallet`, the hint use route |
| **LF1** friends-server | server | LE1 (serialized server files) | 15 | 8 | `0005` (+ blocks, handles), `start_param`, the referral attribution, invites (ask → accept, revision 1), friends / requests / durable decline / codes / consents, `GET /api/privacy`, dev `startapp` |
| **LM2** meta-server | server | LF1, LM1 | 15 | 6 | `0006`, the meta loader, conditions, the card, the choice vocabulary check |
| **LF2** share-profile | server | LM2 | 15 | 6 | `getMe` + `savePreparedInlineMessage`, `POST /api/share`, the friend profile, `/dev/prepared`, the meta DTO samples |
| **LE2** gifts-referrals | server | LF2 | 12 | 5 | `POST /api/gifts`, the referral hook (every batch, revision 1) and grant, the gift DTO samples |
| **LPO** privacy-operator (revision 1, W4) | server | LE2 (serialized server files) | 8 | 2 | `PRIVACY_OPERATOR_FILE`, the startup substitution, the prod refusal; revision 2 (W1): identity keys only, `{POLICY_VERSION}` from the meta, the template pin; revision 3 (W1): the pin's three conditions in one `#[cfg(test)]` checker, each seen red on a crafted history |
| **LM1** meta-catalog | client | LW3 | 12 | 5 | `story/meta.json`, `catalog/meta`, choice points, `server/content/meta.json` + its fixture, the meta fingerprints, the DSL reopen |
| **LU1** meta-ui | client | L14a | 10 | 5 | the presentational meta overlays + `i18n/meta.ts` |
| **LMD** meta-data | client | LS4, LF2 | 7 | 4 | endpoints, decoders, the card / social / wallet services, the hint port |
| **LMI** meta-integration | client | L15, LMD, LU1, LE2, N1, N2 | 15 | 7 | `app/meta.ts`, the boot / game / App / yields wiring, the gift and share endpoints, the meta-ui budget row, `meta.spec.ts`, `social.spec.ts` |

Order: server LS2 → L6c → L8a → L8b → LS3 → **LE1 → LF1 → LM2 → LF2 → LE2 → LPO** → L9 (LPO and L9 beside LMI);
client: LM1 beside D1 after LW3; LU1 after L14a; LMD after LS4 and LF2; LMI after L15.
Changed by RULINGS 54 (as of `6043941`): merged LS2 … LS3, LM1 `4d8a9ec`, LU1 `2a7b50c`; running LE1 (server) and
L10 (client, ahead of LS4 and LMD); to go: server LF1 → LM2 → LF2 → LE2 → LPO → L9, client LMD, then LMI.

---

## Budgets and validation

| Budget | Limit | Basis | Enforced by |
|---|---|---|---|
| Entry closure JS | ≤ 40 KB br, unchanged | + ≈ 2.9 KB br: `app/meta.ts` ≈ 1.2, the three services ≈ 0.9, the decoders ≈ 0.8 | `budget.ts` (the existing row) |
| `meta-ui` lazy chunk (`ui/meta/*` + `i18n/meta.ts`) | ≤ 14 KB br; a dynamic entry imported only by `app/meta.ts`; PENDING until `app/meta.ts` exists, then FAIL without a dynamic entry or inside a static closure | 8 components ≈ 1.2 KB br each + the table ≈ 1.5 KB | `budget.ts` (LMI): `budget: meta ui in entry closure fails`, `budget: meta row pending until its importer exists` |
| All JS in `dist/` | ≤ 305 KB br (was 290) | + 14 meta-ui + 1 slack | `budget.ts` (LMI) |
| JS before the first line | ≤ 270 KB br, unchanged | the meta chunk is not in it | `budget.ts` |
| First-load to first line, per story | ≤ 800 KB, unchanged | + 2.9 KB | `budget.ts` |
| Time to first line | ≤ 6 s, unchanged | 2.9 KB × 8 / 1.6 Mbps ≈ 15 ms; the three boot GETs (≈ 0.5–2 KB each) are parallel and never awaited | e2e `time to first line under throttling` |
| Steady memory | ≤ 138.6 MiB (145.3 MB) | 138.1 (SP) + < 0.5 MiB (DOM overlays, ≤ 16 KB of card JSON, the chunk) | the estimate; e2e `heap under budget` (its 48 MB limit unchanged) |
| Card response | ≤ 16 KB | 50 achievements × ≈ 250 B + 32 endings × ≈ 120 B; typically < 2 KB | `card_response_bounded` (LM2) |
| Stats batch with choices | ≤ 16 KB body | 32 × ≈ 160 B = 5.1 KB | SP's limit |
| `server/content/meta.json` | ≤ 256 KB raw (a startup check) | ≈ 40 B per option: ≈ 3 KB for the demo, ≈ 60 KB for 10 chapters × 150 options; texts ≤ 36 KB per story | `startup_fails_when_meta_too_large` (LM2) |
| Server statements | card ≤ 5; profile ≤ 7; spend ≤ 6 (1 tx); gift ≤ 9 (1 tx) + 1 handle read; an invite request ≤ 6 (1 tx); the stats POST + 1 per batch (the referral probe with its evidence, revision 1 W5) + 1 only over the choice budget (first picks, revision 1 W2); pre-checkout 2 (was 3) | at the Q21 p99 RTT of 160 ms: the card ≤ 0.8 s, a spend ≤ 1 s, the stats POST ≤ 0.8 s worst case (5 statements) | the lane tests |

**Vacuous-green guards.** The meta-ui row is PENDING, never PASS, until `app/meta.ts` exists; `scan-dist`'s meta set
fails when `story/meta.json` is missing or has zero texts of ≥ 12 code points while any story declares an ending
(`scan: empty meta fingerprint set fails`); the `catalog/meta` fixtures are seen red per rule; server tests are counted
by name per lane.

---

## Test strategy

### Names per layer (each lane's commits name the ones it adds)

| Layer | Names |
|---|---|
| Story tool (LM1) | `meta: choice points split by gathers and knots`, `meta: deeper weave is transparent`, `meta: fallback choices are not options`, `meta: catalog/meta red on fixture` (one case per rule), `meta: every declared ending has a title`, `meta: conditions name existing endings, choices, chapters and puzzles`, `emit: meta texts only in server outputs`, `emit: server meta matches the server fixture shape`, `story: cli writes server meta`, `scan: meta text in dist fails`, `scan: empty meta fingerprint set fails`; `dsl-doc` 86 rows |
| Server (LS3 re-cut) | `schema_stat_events_choice_in_chapter`, `stats_choice_shape_checked`, `stats_response_has_no_endings_total`, `stats_endings_reached_distinct` (was `stats_endings_x_of_y`); revision 1: `stats_cap_does_not_refuse_facts`, `stats_choice_over_budget_keeps_first_picks` |
| Server (L6c re-cut) | `schema_hint_unlocks_pk`, `schema_hint_unlocks_tier_range`, `puzzle_hint_text_only_when_unlocked` (was `…_when_owned`), `api_error_maps_status_and_code` + `insufficient_balance`, `limit_reached` |
| Server (LE1) | `schema_balance_never_negative`, `schema_balance_or_debt`, `schema_ledger_idem_key`, `schema_ledger_sign_by_reason`, `catalog::tests::pack_product_id_grammar`, `catalog_packs_from_economy`, `catalog_pack_titles_within_limits`, `invoice_pack_price_from_catalog`, `pack_credit_once_on_duplicate_payment`, `pack_grant_credits_in_the_grant_transaction`, revision 1: `schema_orders_pack_binding`, `pack_credit_uses_amount_bound_at_order`; `credit_pays_debt_first`, `clawback_takes_balance_then_debt`, `ledger_reconciles_with_balances`, `balance_never_negative_concurrent_spends`, `hint_spend_concurrent_debits_once`, `hint_spend_needs_previous_tier`, `hint_spend_after_solve_409`, `hint_spend_insufficient_409_unlocks_nothing`, `hint_spend_replay_no_debit`, `hint_spend_paid_chapter_403`, `wallet_lists_balances_and_packs`, `wallet_private_no_store` |
| Server (LF1) | `schema_friendships_ordered`, `schema_invite_code_shape`, `schema_one_active_code`, `schema_consent_purpose_known`, `schema_referral_outcome_known`, `schema_friend_blocks_not_self`, `schema_user_handle_shape`, `initdata::tests::start_param_from_signed_string`, `users_upsert_reports_inserted`, `referral_attributed_on_first_login_only`, `invite_launch_creates_no_request` (was `invite_launch_creates_friend_request`), `invite_view_reveals_nothing_about_owner`, `invite_request_repeat_creates_one`, `self_invite_creates_nothing`, `revoked_code_creates_nothing`, `pending_requests_capped`, `friendship_needs_inviter_accept` (was `friendship_needs_accept`), `unfriend_is_durable_against_old_code`, `decline_is_durable_against_old_code`, `blocker_request_lifts_own_block`, `social_dto_has_no_telegram_id`, `accept_both_directions_one_friendship`, `friend_cap_409`, `remove_friend_ends_both_sides`, `rotate_invite_code_limited`, `consent_records_policy_version`, `consent_latest_row_wins`, `social_private_no_store`, `privacy_page_served_with_version`, `privacy_page_needs_no_token`; dev `dev_launch_signs_start_param` |
| Server (LM2) | `schema_achievement_unlocks_pk`, `meta::tests::conditions_evaluate`, `meta::tests::gates_name_paid_chapters`, `meta_index_loaded`, `startup_fails_when_meta_names_unknown_ending`, `startup_fails_when_meta_too_large`, `stats_unknown_choice_rejected`, `stats_paid_choice_needs_entitlement_first`, `card_lists_only_found_endings`, `card_has_no_endings_total`, `card_paid_titles_need_entitlement`, `card_unlock_persists_and_new_once`, `card_concurrent_posts_new_once`, `card_puzzle_no_hints_condition`, `card_retired_achievement_hidden`, `card_response_bounded`, `card_unknown_story_404`, `card_private_no_store` |
| Server (LF2) | `share_text_has_no_titles`, `share_link_carries_invite_code`, `share_prepares_inline_message_for_native`, `share_without_native_returns_link_only`, `share_prepare_failure_falls_back_to_link`, `share_rate_limited_after_20_per_hour`, `gateway_prepared_share_shape`, `friend_profile_404_for_non_friend`, `friend_profile_private_by_default`, `consent_withdrawal_hides_profile`, `friend_profile_shared_titles_only`, `friend_profile_paid_titles_need_viewer_entitlement`; dev `dev_prepared_message_readable`; `bindings_are_fresh`, `dto_samples_are_fresh` |
| Server (LE2) | `gift_requires_friendship`, `gift_moves_once_and_reconciles`, `gift_replay_moves_once`, `gift_replay_with_other_body_400`, `gift_daily_send_cap_429`, `gift_daily_receive_cap_429`, `gift_insufficient_409`, `gift_concurrent_same_sender_respects_cap`, `gift_opposite_directions_no_deadlock`, `referral_needs_first_chapter`, `referral_needs_min_play_gap`, `referral_grants_both_once`, `referral_cap_per_inviter_day`, `referral_cap_total`, `referral_concurrent_batches_grant_once`; revision 1: `referral_qualifies_after_hook_failure`, `referral_fast_reader_qualifies_on_a_later_batch` |
| Server (LPO, revision 1) | `config::tests::privacy_operator_file_required_in_prod`, `privacy_placeholder_refuses_prod_start`, `privacy_operator_file_fills_placeholders`, `privacy_operator_unknown_key_refused`, `privacy_draft_served_without_file_in_test`; revision 2: `privacy_operator_content_key_refused`, `api::legal::tests::policy_template_pinned_per_version`, `api::legal::tests::policy_placeholders_classified`; revision 3: `api::legal::tests::pin_check_rejects_non_increasing_versions`, `api::legal::tests::pin_check_rejects_last_not_meta`, `api::legal::tests::pin_check_rejects_hash_mismatch`, `api::legal::tests::pin_check_accepts_a_valid_history` |
| Server (L9 re-cut) | `refund_pack_claws_back_unspent`, `refund_spent_pack_records_debt`, `refund_pack_twice_claws_once`, `refund_gifted_pack_keeps_friend_balance`, `paysupport_pack_credit_is_applied`, `privacy_command_links_policy`; revision 1: `refund_claws_back_the_credited_amount` |
| Client unit (L7, LS4, L10, LP2, LMD, LMI, L15) | `share: failed event maps to a typed error`, `share: below 8.0 is unsupported`, `share: listeners removed after the event`, `links: open link refuses non-https`; `reporter: choice event carries the option line id`, `reporter: settle resolves after the queue drains`, `reporter: settle times out without throwing`, revision 1: `reporter: queue full of choices keeps ending_reached`, `reporter: batch sends facts first`; `flow: pack product confirms through order status`, `decode: puzzle status with unlocked hints`; `hints: next tier usable only after previous unlocked`, `hints: use without balance offers get more`; `decode: meta samples decode`, `card: loads once per open and keeps no copy`, `social: accept refreshes friends`, `social: ask returns the invite state` (revision 1), `wallet: hint port reads the balance from the server only`; `wallet: gift retry keeps its request id`, `meta: boot fetches never block the first line`, `meta: invite prompt only for an open invite` (was `… only for an incoming request`, revision 1), `meta: share falls back when unsupported`, `meta: expired prepared message re-prepared once`, `game: ending settles stats then opens the card`, `game: card failure keeps the end`; `game: a choice records its option line id` (L15) |
| Client DOM (L14a, L14b, LP2, LU1) | `screens: meta overlays close with back`; `menus: story picker shows the card button only after an ending`, `menus: the end offers the card when it exists`, `menus: friends and wallet entries only when given`; `hint ladder: no port shows no use button`; `card: lists endings and achievements, new ones marked`, `card: no total or empty slots`, `card: data dropped on close`, `friends: requests show accept and decline`, `consent: off by default and one tap withdraws`, `consent: text names the friend circle` (revision 1), `gift: amount bounded by balance and caps`, `wallet: packs show server prices and debt`, `invite: prompt names nobody and says who sees the name` (was `invite: prompt names the inviter`, revision 1), `i18n: meta keys complete in ru and en` |
| e2e (LMI) | `meta.spec.ts`: `meta: ending opens the card with the ending and a new achievement`, `meta: card back returns to the end`, `meta: home opens the card after the first ending`, `meta: pack purchase credits the wallet`, `meta: hint from a pack shows its text`, `meta: privacy link opens through openLink`; `social.spec.ts`: `social: invite link sends a request the inviter accepts` (was `social: invite link opens a friend request`, revision 1), `social: friend profile hidden until consent`, `social: share sends a prepared message without titles`, `social: share falls back to a share link below 8.0`, `social: gift moves a hint to a friend` |

The e2e uses two dev users (`/dev/launch?uid=…`, two browser contexts); the second launches with
`startapp=f<the first user's code>`, read from `GET /api/social` with the first user's token, and sends the request
from the prompt; the first context accepts it in Friends (revision 1, C1). Referral qualification needs 120 s of
server time and stays in the server tests (a fixed clock), not the e2e.

### Gates that must be seen red once (each lane quotes the failing run)

| Gate | Lane | How |
|---|---|---|
| `catalog/meta` | LM1 | each rule's fixture red, then the real tree green |
| the `scan-dist` meta set | LM1 | a scratch module importing a meta text → `build` exit 1 |
| the meta-ui budget row | LMI | a static import of `CompletionCard.svelte` from `app/boot.ts` (scratch) → FAIL |
| the e2e meta and social specs | LMI | before the wiring, `meta: ending opens the card…` fails at "card visible" (quoted) |
| the production placeholder refusal (revision 1, W4) | LPO | `privacy_placeholder_refuses_prod_start` against LF1's route, before `Policy::load`: `Ok(state)` (quoted) |
| the host-file content-key refusal (revision 2, W1) | LPO | `privacy_operator_content_key_refused` against a `Policy::load` that admits every template placeholder (the revision-1 rule): `Ok(state)` (quoted) |
| the policy template pin (revision 2, W1) | LPO | a scratch edit of one word of the template with no new `POLICY_PINS` row → `policy_template_pinned_per_version` fails on the hash (quoted); the scratch is reverted |
| the pin checker's three conditions (revision 3, W1) | LPO | against a `check_pins` stub that returns `Ok(())`, `pin_check_rejects_non_increasing_versions`, `pin_check_rejects_last_not_meta` and `pin_check_rejects_hash_mismatch` each fail with `left: Ok(())` (quoted) |

---

## Demo content outline (for N1 / N2; the narrative-designer writes the texts)

| Story | Achievement | `when` | Gate |
|---|---|---|---|
| `manor` | `drawer_no_hints` | `{ "puzzle": "ch1.drawer", "hints": 0 }` | — |
| `manor` | `cabinet_no_hints` | `{ "puzzle": "ch2.cabinet", "hints": 0 }` | ch2 |
| `manor` | `both_endings` | `{ "allEndings": true }` | ch2 |
| `manor` | `sharp_mind` (hidden) | `{ "all": [ { "puzzle": "ch1.drawer", "hints": 0 }, { "puzzle": "ch2.cabinet", "hints": 0 } ] }` | ch2 |
| `tide` | `first_ending` | `{ "endings": 1 }` | — |
| `tide` | `trusted_keeper` | `{ "choice": "<the ch3 option that trusts the keeper>" }` | — |
| `tide` | `dawn_seen` | `{ "ending": "dawn" }` | ch4 |
| `tide` | `all_tide` | `{ "allEndings": true }` | ch3, ch4 |

Ending titles: `manor.truth`, `manor.ashes` (N1), `tide.drowned`, `tide.dawn` (N2). LM1 writes the title of LS1's
skeleton ending `manor.end` and no achievement; N1 replaces it. The e2e relies on `tide.drowned` + `first_ending` (the
first ending of a free chapter unlocks a visible achievement). The `chapter` kind is covered by the fixture and the
server tests only.

---

## Open questions

### Engineering (for the orchestrator) — each with a recommendation

| # | Question | Recommendation |
|---|---|---|
| MQ1 | The meta tail adds ≈ 3 lane-times after L15. | Accept: L15 is the prototype milestone; the meta lanes follow. |
| MQ2 | LM1 reopens `lint.ts`, `dsl-doc.test.ts` and STAGING-DSL (§9, §11) for one lint code, after LS1's reopen. | Accept, the SP Y18 pattern; frozen again after LM1. |
| MQ3 | The card is a POST that materialises unlocks at read time. | Keep (M6); a write-path evaluation only if a screen needs unlock times to the second. |
| MQ4 | `hint_unlocks` is created in L6c's `0002` (the puzzle status reads it), not in LE1's `0004`. | Keep: L6c's status route needs it, and `0002` is unshipped. |
| MQ5 | The policy route is `/api/privacy` (the API router), not `/privacy` (the static dir). | Keep: the static dir is optional (L9); the API router is always mounted. |
| MQ6 | The share limiter is in memory (per process). | Keep for the prototype (one process); a table if the server scales out. |
| MQ7 | Whether `savePreparedInlineMessage` needs inline mode on (a research GAP), and the prepared message lifetime. | Verify on the real bot (D2 runbook `bot-setup`); the design does not depend on the lifetime (prepared per tap); if inline mode is required, the runbook adds `/setinline` (no code change). |
| MQ8 | Erasure is designed, not built. | A Later lane `erase-user` before production (Telegram §4.2(a)); until then the `privacy-ops` manual procedure. |
| MQ9 | LE1 (revision 1: + `db/orders.rs`), LF1, LM2, LF2 and LMI are at the 15-file limit. | Accept; every file is named; no further feature goes into them. |
| MQ10 | L6c pre-declares `InsufficientBalance` and `LimitReached` (used from LE1 and LF1 on), so the later lanes need no `error.rs`. | Accept (the L2 pre-declaration precedent). |
| MQ11 | The newcomer flag uses PostgreSQL 18 `RETURNING old.id IS NULL`. | Keep; LF1's `users_upsert_reports_inserted` proves it on the dev cluster; the fallback is `xmax = 0`. |
| MQ12 | The referral evidence is a first-chapter start and a later batch received ≥ 120 s apart, with the completion recorded, plus caps (revision 1: re-evaluated on every batch); a save-progression check could harden it. | Keep for the foundation; record the hardening as Later (a save row of that story written after the start). |
| MQ13 | Meta texts inline in `story/meta.json` instead of the locale tables. | Keep (M4): server-only by construction; revisit if a translation tool needs one table format. |
| MQ14 | `getMe` instead of a `BOT_USERNAME` variable. | Keep (M16); the first share after a restart pays one Bot API call. |
| MQ15 | Revision 1 (W4) adds the lane LPO (8 files, 2 commits) for `PRIVACY_OPERATOR_FILE`, the one `Config` variable added after L2, instead of four more files in LF1 (19 > 15). | Accept: it runs in the server slot beside LMI (LE2 → LPO → L9), off the critical path unless LPO + L9 outlast LMI. |
| MQ16 | Revision 1 (C1): the invite code reaches the invite routes from `initDataUnsafe.start_param` through the client (as merged, L7 `57e1424`, cut Q1: `startParam()` parses it from the raw `initData` string, see the `telegram/` client bullet). | Accept: the code is a bearer capability to ask, validated server-side like any input; identity stays the bearer token's and the referral stays on the signed `start_param` (MT7). |

### VALUES / SCOPE (for the owner — the orchestrator records them in docs/OPEN-QUESTIONS.md)

| # | Question | Default |
|---|---|---|
| MV1 | The default visibility of a player's progress to friends | private (off) until the player turns it on |
| MV2 | What friends see | counts of endings and achievements per story, plus the titles of what both found |
| MV3 | Share content and art | text + a button, no image; the wording in `server/locales/meta.json` (placeholder) |
| MV4 | Pack sizes and prices | `hint_s` 3 hints for 1 ⭐, `hint_m` 10 for 3 ⭐ (placeholders) |
| MV5 | The referral bonus and caps | inviter 5 hints, invitee 2; 3 per inviter per day, 20 lifetime |
| MV6 | Gift limits | up to 3 per gift; 3 sent and 5 received per day |
| MV7 | The minimum play before a referral qualifies | the first chapter's completion recorded and a stats batch ≥ 120 s after its start (revision 1) |
| MV8 | The refund of a spent pack | claw back what is left; the rest becomes debt paid by later credits |
| MV9 | Multi-level referrals | none (the Telegram §5.2(d)(i) risk) |
| MV10 | Premium weighting of referrals | none |
| MV11 | Telegram's Affiliate Program (a Stars commission) | not used |
| MV12 | The minimum age | 14+ in Russia, 18+ in the EU (Telegram's ToS) — a lawyer item |
| MV13 | The operator identity and contacts in the policy | placeholders until the owner fills them (a lawyer review before production) |
| MV14 | The BotFather privacy policy URL | `<PUBLIC_APP_URL>api/privacy`, set by the owner |
| MV15 | The friend cap and pending requests | 200 friends, 50 pending incoming requests per user (revision 1) |
| MV16 | A public (anyone-with-the-link) profile | none (it would be distribution under art. 10.1) |
| MV17 | A friend's counts in a paid story the viewer has not bought (a lower bound on the ending total, Q25) | shown |
| MV18 | Server log retention | the host's rotation, 30 days |
| MV19 | The cost of one hint tier | 1 hint per tier (`economy.spend.hintTier` in `server/catalog.json`, data) |
| MV20 | What a link holder learns about the inviter before the inviter accepts (revision 1, C1) | nothing: the prompt names nobody (Telegram itself shows the message's sender where it does) |
| MV21 | May a declined or removed person ask again (revision 1, C1) | no, until the remover sends that person a request (a durable block) |
| MV22 | Which policy facts may change without a new policy version, and when are earlier consents asked again (revision 2, W1; a lawyer item) | a contact fix (address, e-mail, responsible person, DPO, EU representative, policy URL): no new version; a change of the operator itself (name, form, OGRN, INN): a new version and fresh consents; every content value (M26): a new version, enforced by the template pin. No re-ask path is designed: if fresh consents are ruled necessary, a later lane adds a minimum policy version to the `friends_profile` visibility check |

Still open from before (not decided here): Q22's other screens and community percentages, Q26 the real achievement
lists (default: the narrative-designer drafts the demo ones above), Q21 jurisdiction and hosting.

---

## Readiness checklist

- [x] Goal names correctness targets MT1–MT13 and budget targets; every decision M1–M28 has why / alternatives /
  trade-off.
- [x] TS and Rust types for every new JSON (Rust the source of truth via ts-rs, K22); a SQL constraint per invariant
  (listed under SQL); every endpoint has auth, errors, idempotency and Cache-Control (the HTTP API table).
- [x] No tag change; the meta file and its lint documented in STAGING-DSL by LM1; every choice already has a line ID
  (`id/missing`), which M1 uses; the scene and the overlay never read story state (the reporter reads the runner's
  step).
- [x] Grant only on `successful_payment` via the charge-id insert, the pack credit in the same transaction; a refund
  revokes and claws back; pre-checkout does less work than before (2 statements); paid meta only behind the viewer's
  entitlement; `scan-dist` proves meta texts absent from `dist/`.
- [x] BackButton per meta overlay (L14a); no `window.open`, `alert` or Service Worker (`openLink` / `openTelegramLink`
  through the facade); audio unchanged; every SDK call on the main origin through the facade.
- [x] Textures: none added (a DOM UI); memory estimated (≤ 138.6 MiB).
- [x] A duplicate webhook (packs), a double tap (card, spend, gift, accept), reload (queued events, the gift request
  id), token expiry, a story update (retired meta), context loss (N/A: no Pixi resource): outcomes in the concurrency
  table.
- [x] Red-first per commit (the PP lane entries); test names per layer; budget numbers in `budget.ts`; each new gate seen
  failing once.

---

## Revision log

| Rev | Date | Source | Summary |
|---|---|---|---|
| 0 | 2026-10-31 | `D:/tmp/novel-orch/design/choices/spec.md` (RULINGS 24, 25); research M1–M4 | Initial design: M1–M28; the PP, SP and PZ edits marked "Changed by META-PLAN"; nine new lanes, sixteen re-cut. Design log: `D:/tmp/novel-orch/design/choices/design_log.md` |
| 1 | 2026-10-31 | `D:/tmp/novel-orch/design/choices/triage_r1.md` (critique `design/choices/critique_r1.md`) | Revision 1: the 7 confirmed items resolved. **C1** — M10 rewritten: a code lets its holder *ask* (`GET` / `POST /api/invites/{code}`), the owner accepts per person, a decline or removal writes a durable `friend_blocks` row; the launch creates no request (M11: the referral only); M12, M14, M15, MT5, MT6, F19, F20, the concurrency table, the inventory and policy §4 describe the resulting circle. **W1** — `user_handles` (96-bit handles) replace the Telegram id in every social DTO, path and `GiftRequest.to`. **W2** — choice events get their own budget (SP Y11: facts keep 600/h and the 429; repeat picks over 600/h are rejected `rate_limited`, first picks always recorded) and the queue evicts choices first and sends facts first (SP Y13); M3's rate restated with skip mode. **W3** — `0004` binds a pack order's kind and amount (`orders_pack_binding`), the grant credits them, the refund claws back the `pay:<charge>` ledger row's (M19, M20). **W4** — the operator facts come from `PRIVACY_OPERATOR_FILE` outside the repository; production refuses to start with a placeholder left; new lane LPO (M26, M28: 48 lanes). **W5** — the referral hook runs on every batch and re-reads the evidence; a hook failure never fails the response (M23, F26, MT12). **W6** — the inventory splits DeviceStorage (device) from CloudStorage (Telegram-hosted: settings, the read-set); policy §7, §8. Optional O1–O12 and the critique's open questions 1–3 are not folded in. Pre-revision copies: `D:/tmp/novel-orch/design/choices/{META-PLAN,STORIES-PLAN,PROTOTYPE-PLAN,PUZZLES-PLAN}.r1.before.md`; report `design/choices/revision_r1.md`. |
| 2 | 2026-10-31 | `D:/tmp/novel-orch/design/choices/triage_r2.md` (critique `design/choices/critique_r2.md`) | Revision 2: the 1 confirmed item resolved. **W1** (the served policy text could change while the version a consent records stayed the same), by the triage's option (b): M26 classifies revision 1's 17 placeholders as identity (10, host file `PRIVACY_OPERATOR_FILE`, `IDENTITY_KEYS`), content (6: retention, minimum age, database country, hosting provider, cross-border transfer, supervisory authority; written only by a template commit with a new version) and derived (`{POLICY_VERSION}` from the meta, replacing `{EFFECTIVE_DATE}`). `Policy::load` refuses a content key (`CONTENT_KEYS`) or `POLICY_VERSION` in the host file (`PolicyError::ContentKey`; `privacy_operator_content_key_refused`). `POLICY_PINS` pins each version to one template hash (`policy_template_pinned_per_version`). Every template placeholder must be classified (`policy_placeholders_classified`). An identity edit does not version the policy, but an operator change does (runbook; MV22). The version shape CHECK is unchanged. Also changed: MT5, MT13, Rust types, Module API, the HTTP API privacy row, Integration, the LPO table row, the test names, gates seen red, MV22; PP LPO and D2 `privacy-ops`; PP revision log row 21. Optional O1–O9 and the critique's open questions 2–3 are not folded in. Pre-revision copies: `D:/tmp/novel-orch/design/choices/{META-PLAN,STORIES-PLAN,PROTOTYPE-PLAN,PUZZLES-PLAN}.r2.before.md`; report `design/choices/revision_r2.md`. |
| 3 | 2026-10-31 | `D:/tmp/novel-orch/design/choices/triage_r3.md` (critique `design/choices/critique_r3.md`) | Revision 3: the 1 confirmed item resolved. **W1** (two of the pin's three conditions had no failing input, and tester mutation 3 had no killer): M26 moves the three conditions (versions strictly increase, the last equals the meta, its hash equals the template's) into one pure checker `check_pins(pins, meta, template bytes)` returning `PinError::{NotIncreasing, LastNotMeta, HashMismatch}`. `policy_template_pinned_per_version` runs it on `POLICY_PINS`, `policy_version()` and the compiled template. The crafted reds `pin_check_rejects_non_increasing_versions`, `pin_check_rejects_last_not_meta` and `pin_check_rejects_hash_mismatch` each break exactly one condition of a valid two-row history, and the control `pin_check_accepts_a_valid_history` passes that history. All three red against an `Ok(())` stub. `POLICY_PINS`, `PinError` and `check_pins` are `#[cfg(test)]` (no `dead_code` in the lib target under `-D warnings`, probed; `pub` and a startup use rejected). Also changed: MT5, M26 Alternatives and Trade-off, Rust types, Module API, Integration, the LPO table row, the test names, gates seen red; PP LPO (goal, commit 2, mutation 3 restated against the checker, seen working); PP revision log row 22. LPO keeps 8 files and 2 commits. Optional O1–O4 and the triage's open question 2 are not folded in. Pre-revision copies: `D:/tmp/novel-orch/design/choices/{META-PLAN,STORIES-PLAN,PROTOTYPE-PLAN,PUZZLES-PLAN}.r3.before.md`; report `design/choices/revision_r3.md`. |
| 4 | 2026-11-01 | `D:/tmp/novel-orch/carry.md` at ORCH `d97ba64` (the docs-errata-2 spec, group A), as merged on main `6043941` | Docs lane `docs-errata-2`, group A (not a triage round): L7 (`57e1424`) — `startParam()` parsed from the raw `initData`; LM1 (`4d8a9ec`) — a missing `story/meta.json` counts as `{}`; LS3 (`00d7c10`) — the `IS NOT NULL` guards and a choice-only batch never a 429. Fix round 1: the principle-3 line and MQ16 point at the raw-`initData` `startParam()`; the guard comment names the regex / IN tests of `subject` / `outcome`. Ledger: `D:/tmp/novel-orch/docs-errata-2/ledger.md` |
| 5 | 2026-11-01 | RULINGS 54 (as merged on main `6043941`) | Docs lane `docs-errata-2`, group B (not a triage round): M28 and "Implementation plan" Order as of `6043941` (LM1, LU1 merged; LE1 running; LF1, LM2, LF2, LE2, LPO, LMD, LMI to go). Ledger: `D:/tmp/novel-orch/docs-errata-2/ledger.md` |
