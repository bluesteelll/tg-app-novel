# Architecture: several stories and the player-statistics foundation

Status: design extension of [PROTOTYPE-PLAN.md](PROTOTYPE-PLAN.md) and [PUZZLES-PLAN.md](PUZZLES-PLAN.md)
(architect round 1, 2026-10-31; RULINGS 20; revision 4 — see [Revision log](#revision-log)).
Scope: `D:/tmp/novel-orch/design/stories/spec.md`. Inputs:
- RULINGS 1–21 (`D:/tmp/novel-orch/RULINGS.md`);
- research S1 (stories, catalogs, endings) and S2 (statistics) in `D:/tmp/novel-orch/design/stories/research_S*.md`;
- the design worktree `design/stories` at `6aa9647`, and main at `38bc717` for the merged LW2 code;
- `D:/tmp/novel-orch/design/db/decision.md` §4 (the PostgreSQL schema), the LDB1 cut
  (`D:/tmp/novel-orch/ldb1-db-port/cut.md`) and the L3c cut (`D:/tmp/novel-orch/l3c-story-locales/cut.md`).

Labels:
- **[S1]**, **[S2]**: research reports (verified facts with their sources); [P*], [R*] as in PP/PZ.
- **PP**, **PZ**: a section of PROTOTYPE-PLAN.md / PUZZLES-PLAN.md, by name.
- **verify:** a fact not yet confirmed; the named lane confirms it with a red-first test before relying on it.
- Decisions are **Y1–Y19** (K1–K30 stay PP's, X1–X18 PZ's). Every PP or PZ item this design changes is marked there
  "changed by STORIES-PLAN"; the lane cut lives in PP "THE LANE CUT".

---

## Goal

The owner (2026-10-31, relayed): the game holds not only chapters but **different stories with different
characters**, and every player has **statistics for the whole game and per story** ("how many endings opened,
etc."). Follow-ups (spec §1):
- statistics are a **foundation only**: the server captures and stores progress facts from day one; which metrics
  and where they are shown is a later owner value (Q22);
- the **first chapter of every story is free**; later chapters are bought per chapter for Stars;
- the prototype ships **two short demo stories** with different casts.

The player:
1. opens the app on Home: **Continue** (the newest autosave of any story) and one card per story (cover, title,
   teaser, Start or Continue, Chapters);
2. plays story A, `manor` (the PP/PZ journey, unchanged inside the story);
3. returns to Home from the menu ("Back to stories") and plays story B, `tide`, from its free first chapter; meets a
   mid-story bad ending → "The End" → Home;
4. restarts `tide`, finishes ch3, buys ch4 with (mock) Stars, reaches `tide`'s ending;
5. goes back to `manor`: its saves are untouched.

The server records chapter starts and completions, endings reached and puzzle outcomes; `GET /api/stats` answers
"endings X of Y" per story and for the game. Changed by META-PLAN (M1, M8): it also records the picked option of
every choice (`choice_made`), and `endingsTotal` leaves the API — the answer is "endings found" (the names reached),
never a total; the titles exist only in the completion card ([META-PLAN.md](META-PLAN.md)).

**Correctness targets** — each is a gate:

| # | Target | Proved by |
|---|---|---|
| ST1 | No paid chapter's ending vocabulary (ending names, ending knots) or meta is in a story-tool client output or in the client bundle; the public catalog carries no endings at all | story tool: `emit: public catalog lists stories without endings`, `emit: paid endings only in server outputs`, its only client files pinned by `story: cli builds a free and a paid chapter`; bundle: `arch: import-outside-src red on fixture` + `arch: import boundaries` on the real tree (no non-test `client/src` module makes Vite pull in a file outside `client/src/`: literal specifiers, the static head of a template-literal or `+`-joined `import()` and of a template-literal `new URL`, and glob patterns with their `base` are judged, `#` specifiers and every form the rule cannot read statically are refused (revision 2), so `story/` sources and `server/content/` never enter the module graph; LS1); PP T1 scan for paid chapter JSON, en tables and art |
| ST2 | The first chapter of every story is free; every chapter belongs to exactly one story; carry flows only along a story's chain | `catalog/stories` fixtures (LS1); `startup_fails_when_first_chapter_paid` (L6b); `story: a story-ending run does not carry into the next chapter` |
| ST3 | Saves are per story: a slot of one story never overwrites or conflicts with another story's slot | `schema_saves_pk_per_story`, `saves_story_slots_independent` (LS2); `saves: pending entry is per story` (L10); e2e `stories: saves are per story` |
| ST4 | Statistics never unlock anything: no content or entitlement path reads `stat_events` | `stats_do_not_unlock_paid_chapter` (LS3); `db/stats.rs` is called only from `api/stats.rs` (review rule, FEATURE_MAP) |
| ST5 | A client event is stored once per (user, event id) whatever the retries; a set fact (an ending) counts once whatever the ids | `stats_event_replay_counts_once`, `stats_endings_x_of_y` (changed by META-PLAN: renamed `stats_endings_reached_distinct`) |
| ST6 | X ≤ Y: the read counts only chapters and endings of the current story index (changed by META-PLAN: no Y in the API, M8; the index filter stays) | `stats_retired_ending_not_counted`; changed by META-PLAN: `stats_response_has_no_endings_total` |
| ST7 | An event in a paid chapter needs the chapter entitlement at write time; the story id is derived by the server, never sent | `stats_paid_ending_needs_entitlement`, `stats_not_entitled_hides_ending_check`, `stats_story_derived_by_server` |
| ST8 | Capture never blocks or breaks play: `record()` never throws or awaits; a failed flush keeps the events, bounded | `reporter: failure never throws`, `reporter: retried batch keeps event ids`, `reporter: queue capped at 64 drops oldest` |

**Budget targets** (numbers and gates in [Budgets](#budgets-and-validation)):
- entry closure ≤ 40 KB br, unchanged; this change adds about 3.2 KB br (picker, reporter, decoders);
- first-load to first line ≤ 800 KB **for every story** (one row per first chapter), including the covers of the
  first three cards (≤ 3 × 24 KB AVIF), `covers.json` and the catalog;
- time to first line ≤ 6 s, unchanged, and no extra tap: the card's Start button is the audio-unlock gesture;
- steady memory: Home is unmounted during play; worst-case retained cover bitmaps 3 × 0.88 MiB = 2.6 MiB →
  138.1 MiB (144.8 MB) < 150 MB (principle 4);
- server: a stats flush is ≤ 3 statements; the stats read is 1 statement. As merged (LS3 `00d7c10`, cut D5): at most 4,
  the 3 plus revision 1's conditional first-pick read.

---

## Context and constraints

- **Principles at stake:**
  - 0 — paid ending names and paid metas stay server-side (Y5);
  - 1 — statistics are display facts, never an unlock; saves stay server truth per story (Y7, Y10);
  - 2 — products and prices derived from the story index; grant and refund transactions untouched (Y6, Y8);
  - 4 — a first-load row per story; covers as DOM images (Y15);
  - 5 — the audio unlock moves to the card buttons; BackButton only for ChapterSelect; flush on `deactivated` (Y13,
    Y14);
  - 6 — no analytics SDK [S2 §5]; the one Telegram module is reused for DeviceStorage;
  - 7 — GameSession reports events; scene and overlay never read ink (Y13);
  - 8 — story B's lines carry IDs; story titles and teasers live in locale tables (Y2).
- **Rulings:**
  - 13 PE3 — the DSL is frozen after LW1. This design reopens STAGING-DSL §4 wording, §8, §9, §11 and two lines of
    frozen code (`LINT_CODES` in `lint.ts`, the row count in `dsl-doc.test.ts`) for one lane, LS1 (reason: Y18);
    revision 2 also reopens one test hunk each in the frozen `tags.test.ts` and `lint.test.ts` for LS1 commit 8
    (reason: W1, the tool tests stop reading the committed cast); revision 3 reopens `tags.test.ts` for one more
    hunk, its catalog-key pins, in L5 (reason: W2, L5's catalog additions break the exact pins; SQ9);
  - 14 — PostgreSQL 18; the decision §4 conventions (named constraints, `BIGINT`, unix seconds);
  - 18 — at most 3 lanes: 1 server + 2 client / doc / narrative with disjoint locks;
  - 19 — the L3c questions (its seen-working line stays);
  - 20 — this design; L3c paused at `5d12aa3` until it merges;
  - 21 — LW2 merged (`38bc717`); the queued PP/PZ errata are applied after this design merges, not here.
- **What exists** (design worktree `6aa9647` unless marked):
  - chapter ids `CHAPTER_ID_RE = /^ch[1-9][0-9]*$/` (`client/src/story/catalog.ts:251`), `ChapterId`
    (`server/src/ids.rs:32`); line IDs embed the chapter (`LINE_ID_RE`, `client/src/story/tags.ts:40`); `PuzzleId`
    `<chapter>.<local>` and hint products `hint:<PuzzleId>:<tier>` (PZ "Identifiers");
  - `story/chapters.json` (ch1 free → ch2 paid), `story/cast.json` (`ally`, `stranger`, `voice`),
    `story/common/globals.ink` (`g_trust_ally`); `decodeChapterList` (`catalog.ts:317`);
  - the story tool `client/scripts/story.ts` (catalog → lint → compile → graph → emit); `emit.ts` `meta()` (:75),
    `catalog()` (:87), `planEmit()` (:156); the public catalog `{ chapters, cast }` decoded with exact keys;
  - `LINT_CODES` (`client/scripts/story/lint.ts:14`); `dsl-doc: lint table equals lint codes` pins 84 rows
    (`client/src/story/dsl-doc.test.ts:146`);
  - saves routes `/saves`, `/saves/{slot}` (`server/src/api/mod.rs:43-49`); the PK `(user_id, slot)` (decision §4.1,
    written into `0001` by the running LDB1); `SaveSlot` (`ids.rs:37`);
  - L3c (paused at `5d12aa3`): `fix.ts`, `locales.ts` committed (its C1, C2); `NAME_SECTIONS = ['names',
    'chapters']`;
  - LW2 (main `38bc717`): worlds per chapter (`client/src/world/types.ts` `ServerPuzzleContent.chapterId`);
    `PuzzleOutcome = 'solved' | 'failed' | 'abandoned'` (`client/src/explore/project.ts:9`);
  - `server-dev` reads the generated `server/content/` from a fixed path (`server/dev/src/main.rs:104`, pinned by its
    test at :236-240).
- **Research facts used:**
  - [S1]: Telegram has no product or catalog object (our invoice text, our limits: title 1–32, description 1–255
    characters); CloudStorage keys `[A-Za-z0-9_-]`, 1–128; engines declare endings in an authored list; `-> END` is
    overloaded (chapter end, not story end);
  - [S2]: idempotency by a client UUID under `UNIQUE (user_id, event_id)` + `ON CONFLICT DO NOTHING`; the server
    receive time is the time of record; typed columns over jsonb; no BRIN or partitioning at ~500 k rows; GDPR
    Recital 26 (pseudonymised data is personal), 152-FZ art. 18 p. 5 (the database in Russia, copies included),
    Telegram Bot Developer Terms §4.2–§4.3 (delete on request; collect only what the service needs); the Telegram
    Analytics SDK is not required and not integrated; choice events are the one metric that cannot be backfilled.
- **Platform:**
  - Home is DOM only (no Pixi): covers through `<picture>` (AVIF, WebP fallback), iOS ≥ 16 decodes AVIF (PP
    platform table), within the iOS 16.4 floor (V1);
  - `crypto.randomUUID()` needs a secure context and has been Baseline since 2022-03 [S2 §1]: inside the iOS 16.4 /
    Chrome 111 floor; Telegram serves Mini Apps over HTTPS, and `localhost` is a secure context in dev;
  - DeviceStorage is Bot API 9.0+ (K13); below it the stats queue is memory only.
- **Invariants that must survive** (beyond PP's and PZ's):
  - chapter ids are unique game-wide; a chapter belongs to one story for its whole shipped life;
  - carry never crosses stories;
  - no unlock or content path reads statistics; a stat row's story id comes from the server's index;
  - paid endings and paid metas exist only under `server/content/` (and in entitled payloads).

---

## Key decisions

Each: **What / Why / Alternatives / Trade-off.**

**Y1. Flat, game-unique chapter ids; a story is a chain of chapters.**
- **What.** Chapters keep `ch<N>` ids, unique across all stories, and the flat layout `story/<ch>/main.ink`
  (+ `world.json`). Story B's chapters are `ch3`, `ch4`. A story is the `next` chain from its first chapter.
- **Why.** Every grammar that embeds a chapter stays valid and unique with no change: line IDs (frozen `tags.ts:40`,
  pinned by `tags.test.ts`), `PuzzleId`, hint products, world text IDs, the `puzzle_progress` id CHECK, L3c's
  `fix.ts` owner rule and per-chapter locale tables, paid routing `server/content/chapters/<ch>/`, the read-set keys.
  Zero changes in the committed or cut modules that read them.
- **Alternatives.**
  - Nested `story/<story>/<ch>/` with per-story numbering: reopens `lint.ts` `GLOBALS_PATH` / `COMMON_DIR`, the
    entry and include rules, `decodeChapterList`'s entry rule, `fix.ts`, the emit paths; line IDs would need a story
    prefix to stay unique (a DSL v3 and a migration of every shipped ID).
  - Story-qualified ids (`manor.ch1`): the same reopening, for readability only.
- **Trade-off.** Chapter numbers do not restart per story (ch3 is `tide`'s first). Ids are handles: players see
  titles. A shipped chapter must never move between stories (D1 rule; [failure table](#concurrency-and-failure-model)).

**Y2. `story/stories.json`: the authored story list.**
- **What.** A hand-written array in Home order, `{ id, first, cover, endings }`. Membership is the chain from
  `first`; `story/chapters.json` is unchanged. Story id grammar `^[a-z][a-z0-9_]{0,23}$`. One new lint code,
  `catalog/stories` (E), with the rules in [Data model](#source-file--storystoriesjson). Titles and teasers live in
  `story/locales/<lang>/story.json`, new sections `stories` and `teasers`.
- **Why.**
  - One source per fact: `chapters.json` keeps tier, product and `next`; `stories.json` adds only what a chain
    cannot say (which chain is a story, its cover, its endings).
  - Membership by chain: a chapter cannot claim one story while its `next` leads into another.
  - The owner's rule "first chapter free" becomes a build error, not a review item.
  - 24 characters fit every key the id enters: DeviceStorage `pending_<id>` (≤ 128, [S1]), a URL path segment, a
    later `startapp` deep link (`\w`, up to 64 per community docs — unverified [S1]).
- **Alternatives.** A `story` field per chapter in `chapters.json` (a second statement of what the chain already
  says); the story list in `server/catalog.json` (a second hand-written source, in a file narrative lanes do not
  own).
- **Trade-off.** One more source file for the narrative-designer.

**Y3. Shared cast and globals; carry only along a story's chain.**
- **What.** `story/cast.json` and `story/common/globals.ink` stay game-wide. A story's carry flows along its chain;
  its first chapter starts from the declared defaults. New globals follow the convention `g_<story>_<name>` (D1
  documents it; not linted).
- **Why.** Speakers are already game-unique ids; globals are already namespaced by `g_`. Per-story globals would
  reopen the `GLOBALS_PATH` lint, the include isolation rule and `ChapterGraph.globals` for about 40 bytes per
  global per chapter meta: at 2 stories × ≤ 10 globals, ≤ 1 KB raw per chapter.
- **Alternatives.** `story/<story>/globals.ink` (above); a carry list per story in `stories.json` (a second carry
  definition beside the `VAR` declarations).
- **Trade-off.** A chapter carries other stories' globals at their defaults, never read. Revisit past ~50 globals
  (Later).

**Y4. Story endings are declared in `stories.json`, keyed by knot.**
- **What.**
  - `endings: { "<name>": { "chapter": "<ch>", "knot": "<knot>" } }`, names `^[a-z][a-z0-9_]{0,31}$`.
  - The knot is in that chapter's compiled graph with `ending: true` (a `-> END` is written in it), has no successor
    knot and no yield tag; one ending per knot. An ending may sit in any chapter of the story (a mid-story bad end).
  - Runtime: entering a declared ending knot reports `ending_reached`; F5's next-chapter preload is skipped for it;
    the END after it shows "The End" instead of the next chapter.
- **Why.**
  - An ending is a story fact; `-> END` is a chapter end with four consumers [S2 §6]. Declaring endings beside the
    story keeps the ink and the frozen tag language unchanged.
  - Keyed by knot because the runtime already reports knot entry (`enteredKnot`, PP F2): zero runtime parsing.
  - No successor and no yield make "entered the knot" equal "reached the ending": no branch can leave it.
  - An authored list is what every engine studied does [S1]; the name survives a knot rename, which fails the gate
    instead of silently renaming a statistic.
- **Alternatives.**
  - An ink tag `# ending: <name>`: a change to the frozen parser and a `StagingCommand` that no stage consumes
    (principle 7: commands drive the scene and the overlay).
  - Endings derived from the last line's ID: changes with text edits and has no name.
  - Every `-> END` of a story's last chapter is an ending: no mid-story bad end, names = knot names.
- **Trade-off.** An ending is written in two files (the ink and `stories.json`); the gate catches every mismatch.

**Y5. Build outputs: stories in the public catalog, endings in the chapter meta, a server story index.**
- **What.**
  1. `client/src/story-gen/catalog.json` gains `stories: [{ id, chapters, cover, title, teaser }]` — no endings.
  2. Every `ChapterMeta` gains `endings: { <knot>: <name> }`. Free metas are public (free content); a paid meta
     stays in `server/content/chapters/<ch>/meta.json` and reaches the client only inside the entitled
     `ChapterPayload`.
  3. New `server/content/stories.json` (server only): titles, chapters with tier, product and title, endings with
     their chapter. Contract fixture `server/tests/fixtures/content/stories.json`, written by L6b and read by LS1's
     emit test (the PZ `puzzles/ch1.json` pattern).
- **Why.** Principle 0: the public catalog cannot name a paid ending. The client needs a paid chapter's endings only
  while playing it, so they travel with the paid meta. The server needs membership and every ending to validate saves
  and statistics and to render invoice text. One producer, the story tool, from one source (`stories.json` +
  `chapters.json` + locales). Bytes: about +150 B per story in the catalog, +30 B per ending in a meta.
- **Alternatives.** Endings in the public catalog (leaks paid ending names); endings only on the server with a "did
  the story end?" call at END (a round trip at the climax, and a server call in a free chapter).
- **Trade-off.** The server now requires a generated file (Y6).

**Y6. The server loads the story index; chapter products and prices derive from it.**
- **What.**
  - L6b adds `StoryId` (`ids.rs`) and loads `content/stories.json` into `ContentStore` (`stories`, `story`,
    `story_of`). A missing or invalid index is `StartupError::Content`.
  - `server/catalog.json` chapters become one default price, per-chapter overrides and two templates (`{chapter}`,
    `{story}`); chapter products are every paid chapter of the index, with its `productId`.
  - Startup checks: every story's first chapter is free; every paid chapter has content and a price; every rendered
    chapter invoice title is 1–32 and description 1–255 characters [S1]; every override key is a paid chapter of the
    index. `catalog_matches_story_chapters` checks override keys against the real `story/chapters.json`.
  - `GET /api/entitlements` is unchanged (`ProductDto` keeps `chapterId`; the client maps chapter → story through the
    public catalog).
- **Why.** A new paid chapter (N2's ch4) needs no server edit: narrative lanes stay inside `story/`, prices stay
  server-only (principle 2; the V3 PLACEHOLDER default covers every paid chapter). A strict startup turns a forgotten
  story step into a refusal to start instead of a server that sells nothing.
- **Alternatives.** One hand-written catalog entry per paid chapter (the PZ format: every new chapter touches a
  server file); story membership in the server catalog (a second hand-written source).
- **Trade-off.** Until LS1 merges, no tool emits `server/content/stories.json`, so `server-dev` cannot start on
  generated content between the L6b and LS1 merges. Lane order: L7 (the first e2e lane) waits for LS1; a server lane
  in that window proves its seen-working by test names (SQ1).

**Y7. Saves per story.**
- **What.**
  - `saves` primary key `(user_id, story_id, slot)` plus `saves_story_id_shape`.
  - Routes: `GET /api/saves` (every story; `SaveSummary` gains `storyId`), `GET|PUT /api/saves/{storyId}/{slot}`. An
    unknown story → 404; a chapter outside the story → 400; the rev / writeId contract is unchanged per row.
  - Each story has its own `auto` and `s1`–`s3`. The client holds one `SaveService` per game session (one story);
    the DeviceStorage pending key is `pending_<storyId>`; Home's Continue is the newest `auto` across stories.
  - **Schema rule:** LS2 **rewrites** `server/migrations/0001_init.sql` (the `saves` table). Until the first
    deployment (Q5), a change to an existing table rewrites the migration that created it (decision §4.1: `0001`
    rewritten, "nothing is deployed"); a new table gets a new file; from the first deployment migrations are
    append-only. A local `tgn_local` database that applied the old `0001` is reset with `pgdev reset` (verify: sqlx
    0.9 refuses a modified applied migration — the message is quoted in LS2). Test and `server-dev` databases are
    recreated per test and per launch.
- **Why.** ST3: with one `auto` slot per user, playing story B would overwrite story A's progress or 409 against it.
- **Alternatives.** Slot names per story (`manor_auto`): the slot CHECK turns into a regex and the story cannot be
  validated at the edge. A new migration `ALTER TABLE saves …`: a primary-key swap recorded forever for a table no
  deployment ever held.
- **Trade-off.** One more path segment; L10's service is per story.

**Y8. Statistics storage: one append-only event log, no projections yet.**
- **What.** `server/migrations/0003_stats.sql`: `stat_events` with typed columns, a closed `kind` vocabulary, a
  per-kind CHECK on subject and outcome, `UNIQUE (user_id, event_id)`, an FK to `users`, the story derived by the
  server, the server receive time and a client-measured age. "X of Y" reads `SELECT DISTINCT` over the user's rows,
  filtered by the current index. Money and puzzle facts are **not** copied: `payments` / `orders` / `entitlements`
  and `puzzle_progress` already record them, so the grant, revoke and attempt transactions stay untouched.
- **Why.** The foundation must make later metrics computable [S2 §6]: numerators (endings per user, with time and
  story version) and denominators (chapter starts per user) exist from day one. Projections can be rebuilt from the
  log at any time [S2 §1], so building them now adds a second write per event and a drift surface (the S2 pitfall)
  for no reader. Scale: about 500 k rows / 75 MB at 5,000 players [S2 §2] — no BRIN, no partitioning.
- **Alternatives.**
  - Log + projections with natural keys (S2's recommendation): deferred until a screen reads them (Later: a
    `story_endings (user_id, story_id, ending, first_at)` table filled by one `INSERT … SELECT`).
  - Events written inside the grant and attempt transactions: touches the money path L8b/L9 prove, for no need now.
  - A jsonb payload: constraints move to code; sqlx's `json` feature is off (`Cargo.toml`, [S2 §2]).
- **Trade-off.** Forged event ids add rows (bounded by the cap, Y11) but never counts.

**Y9. Event vocabulary: four kinds, closed, minimal.**
- **What.**
  - `chapter_started` — a runner created from a `fresh` start point (PP `StartPoint`): a new game, a chapter change,
    resume step 2 (pending chapter start, `ink === null`) or step 5 (chapter start); never an exact or checkpoint
    resume (steps 3, 4);
  - `chapter_completed` — the chapter's END when its last entered knot is not a declared ending (the run leads on: the
    next chapter, the paywall or "To be continued"); a declared ending's END records only its `ending_reached`;
  - `ending_reached` — entering a declared ending knot; subject = the ending name;
  - `puzzle_ended` — subject = the `PuzzleId`, outcome `solved` | `failed` | `abandoned` (LW2's `PuzzleOutcome`).

  No choice events, no timings, no free text, no device data.
- **Why.** These are the facts the owner named (endings, chapters, "etc." = puzzles) that the server cannot derive:
  a free chapter makes no request, and endings and failed or abandoned puzzles happen in the client [S2 §3].
  Minimisation: Telegram terms §4.3, GDPR art. 5(1)(c), 152-FZ art. 5 [S2 §4]. The two chapter kinds keep the
  per-chapter funnel exact (revision 1): `chapter_started` of a paid chapter counts every buyer who began it (a
  purchase confirmed while no session ran resumes through step 2), and `chapter_completed` of a free chapter counts
  the runs that reached its paywall, never a mid-story ending.
- **Alternatives.** Capture choices now: rows per pick and a choice vocabulary per build for a metric nobody asked
  for — the owner decides (Q24, default off). "Chapter delivered" on the server: a prefetch is not engagement [S2].
- **Trade-off.** "34 % chose this" starts on the day choice capture starts, if ever.
- **Changed by META-PLAN (M1, Q24 resolved).** A fifth kind, `choice_made`: subject = the picked option's line ID
  (STAGING-DSL §4), outcome null; nothing else (no timings, no text). The aggregate screen stays Later.

**Y10. Trust: a closed vocabulary and the entitlement at write time; never a grant.**
- **What.** An event is accepted only if:
  1. its chapter is in the index;
  2. for a paid chapter, the user owns that chapter's product now (checked **before** the subject, so a non-buyer
     learns nothing about paid ending names);
  3. its ending belongs to that story and that chapter, or its puzzle is in that chapter's puzzle index.

  The story id is derived; the request has no story field. `storyVersion` is checked for shape only (older builds
  report legitimately). A player can still claim a free chapter's ending without playing it; set semantics bound the
  effect. No cross-check against saves in the prototype.
- **Why.** Principle 1: statistics are display facts read by no unlock path (ST4). The paid check keeps paid
  vocabulary from being probed.
- **Alternatives.** A save cross-check [S2 §3]: the latest save precedes the ending by design (saves happen at knot
  entries and choices), so it adds a read per event for little; server-side ink replay (bladeink: a new crate,
  unverified state compatibility with inkjs [S2]).
- **Trade-off.** Free-chapter endings are self-reported.
- **Changed by META-PLAN (M1, M2).** Rule 3 extends to choices: a `choice_made` subject has the line-ID grammar and
  the event's chapter as its prefix (LS3, `stat_events_choice_in_chapter`), and is an option of
  `meta.choices[chapter]` (LM2, reason `unknown_choice`), checked after the entitlement like every subject.

**Y11. Write API: `POST /api/stats/events`, batched, idempotent, capped.**
- **What.**
  - Body `{ events }`, 1–32 events; 200 `{ recorded, duplicates, rejected: [{ eventId, reason }] }`; a malformed
    batch → 400; over the cap (600 events per user per rolling hour, counted in the table) → 429 `rate_limited` +
    `Retry-After: 600`, nothing written.
  - Statements: at most one entitlement read (only when the batch holds a paid chapter), one count, one
    `INSERT … SELECT … FROM UNNEST(…) ON CONFLICT ON CONSTRAINT stat_events_event_key DO NOTHING RETURNING event_id`
    (autocommit). The default 16 KB body limit holds 32 events of about 250 B.
- **Why.** Three round trips worst case (≤ 480 ms at the Q21 RU-database-abroad p99 of 160 ms) against 32 for
  per-row inserts (5 s). `ON CONFLICT` on the client id is the `hint_ledger` / `saves.write_id` precedent [S2 §1].
  The cap bounds what one forged client can add (14,400 rows a day; as merged, LS3 review M2: for sequential batches,
  plus up to one batch per concurrent request). Reusing L6c's `RateLimited` keeps `ErrorCode`
  unchanged.
- **Alternatives.** One event per request (a request per knot); one CTE statement (cannot tell the cap from
  duplicates); a `uuid` column (needs sqlx's `uuid` feature [S2]: `TEXT` + CHECK instead).
- **Trade-off.** The cap is soft: two concurrent batches may both pass the count (overshoot ≤ 32; as merged, LS3
  review M2: up to one batch per concurrent request). A per-user row
  lock is not worth it on a non-money path.
- **Changed by META-PLAN revision 1 (W2; META-PLAN M3).** `choice_made` events (META-PLAN M1) arrive at about one per
  3 s in a skip-mode replay, so one shared cap would let them crowd the facts out. The one count statement now returns
  two counts over `stat_events_by_user_time` (`count(*) FILTER (WHERE kind = 'choice_made')` and the rest):
  - **facts** (`chapter_started`, `chapter_completed`, `ending_reached`, `puzzle_ended`): `STATS_HOURLY_CAP` 600 per
    rolling hour, counted over fact rows only; over it → 429 `rate_limited` + `Retry-After: 600`, nothing written, as
    above. Choice rows never count toward it.
  - **choices**: `STATS_CHOICE_HOURLY_CAP` 600 per rolling hour of their own, never a 429 (as merged, LS3 `00d7c10`,
    O1: this holds literally, since the facts' rule applies only to a batch that carries a fact,
    `server/src/db/stats.rs:197`). Within the remaining budget
    the batch's choice events are recorded in batch order; beyond it a choice event is still recorded if it is the
    user's first pick of that option (no `choice_made` row of that subject yet, and the batch's first event of it: one
    read on `stat_events_by_user_story`, made only when the batch exceeds the budget), otherwise it is rejected with
    the new reason `rate_limited` (`StatRejectReason::RateLimited`, LS3) and the client drops it (Y13).
  - So no fact and no first pick is ever refused because of choice volume; only repeat picks beyond 600 per hour are
    dropped. Statements: + that one conditional read. A forged client adds at most 600 fact rows and 600 choice rows
    per hour plus first picks, which the vocabulary bounds (28,800 rows a day plus the vocabulary once; was 14,400).

**Y12. One read endpoint, `GET /api/stats`; no screen.**
- **What.** `StatsResponse { stories: [{ storyId, started, chaptersCompleted, chaptersTotal, endingsReached,
  endingsTotal }], game: { storiesStarted, storiesTotal, endingsReached, endingsTotal } }`: one `SELECT DISTINCT`,
  filtered by the current index (X ≤ Y); names only of the endings this user reached; totals as counts; `no-store`.
  The client gets `getStats()` and its decoder (the DTO round trip) and no UI.
- **Why.** It proves the owner's example end to end (the e2e reads it) and gives the later screen one contract.
  Counts hide unreached paid ending names.
- **Alternatives.** No read endpoint (the foundation untested end to end); one endpoint per story (two contracts for
  one screen).
- **Trade-off.** `endingsTotal` reveals how many endings a paid story has (Q25; default allowed — nothing shows it
  yet).
- **Changed by META-PLAN (M8, Q25 resolved).** `endingsTotal` is removed from `StoryStatsDto` and `GameStatsDto`
  (LS3 re-cut, before any client decodes it); `endingsReached` stays; `chaptersTotal` and `storiesTotal` stay. The
  trade-off above no longer applies.

**Y13. Client capture: one reporter, queued, flushed at natural points.**
- **What.**
  - `client/src/stats/reporter.ts` is created by `boot.ts` after auth (entry chunk, about 1.3 KB br) and injected
    into the Game.
  - `record(event)` assigns a `crypto.randomUUID()` id and a timestamp and appends to an in-memory queue mirrored to
    DeviceStorage `stats_queue` (≤ 64 events, oldest dropped; memory only below Bot API 9.0).
  - Flush, single-flight: 5 s after a record; at once for `ending_reached`; on `deactivated` and `pagehide` with
    `keepalive`; after boot auth (the persisted queue). Retries keep the event ids; backoff 5 → 300 s; a 429 waits
    `Retry-After`; a 400 drops the batch (a client bug, logged under `__TG_MOCK__`); a 200 drops the recorded,
    duplicate and rejected events; events older than 30 days are dropped before sending.
- **Why.** ST8: play never awaits statistics. One id per event makes every retry idempotent (ST5). DeviceStorage
  (K13 precedent) survives a closed app: 64 × about 220 B ≈ 14 KB.
- **Alternatives.** A request per event; `localStorage` (forbidden: principle 1, arch rule); CloudStorage (4,096
  characters per value, synced: a per-device queue is the right scope).
- **Trade-off.** Events of a device that never returns are lost — acceptable for display statistics.
- **Changed by META-PLAN revision 1 (W2; META-PLAN M3).** The queue keeps its 64 events, but a full queue evicts the
  oldest `choice_made` event first; a fact (`chapter_*`, `ending_reached`, `puzzle_ended`) is evicted only when no
  choice event is queued (64 facts: not reachable in play, a chapter yields ≤ 3). A batch takes the queued facts first,
  then the choices, each oldest first, so an ending's immediate flush carries the ending in its first batch. A
  `rate_limited` rejection (a repeat pick over the choice budget, Y11) is dropped like any rejection. Trade-off: a
  device offline for more than 64 events loses its oldest picks (a lost first pick only delays a `choice`
  achievement until that option is picked again), never an ending.

**Y14. Client UX: Home lists the stories; ChapterSelect per story; "The End".**
- **What.**
  - After boot the root view is Home: `TapToStart` (L14a) with Continue ("Continue: <story>", the newest `auto`)
    and the `StoryPicker` cards (L14b): cover, title, teaser, Start or Continue (that story's `auto`), Chapters →
    the ChapterSelect overlay of that story (BackButton closes it).
  - Every Home button calls `unlockAudio()` synchronously: the button is the gesture.
  - In play the menu gains "Back to stories" (autosave → `Game.exitToStories()`). A declared ending → `Notice` kind
    `the_end` (action: Back to stories). No next chapter and no ending → "To be continued" (PP).
  - No BackButton on Home or at the game root (K26, plus PZ's root-back for rooms).
- **Why.** No extra tap before the first line (the card button replaces tap-to-start's tap), so time to first line is
  unchanged. Principle 5: BackButton only for closable overlays, no `history`. One Game reused across stories keeps
  one Pixi Application: holders are released on exit, no second context, no new leak surface.
- **Alternatives.** A picker screen after tap-to-start (+1 tap on every launch); BackButton from play to Home (an
  accidental Back, or Android's hardware back, would leave the story).
- **Trade-off.** Continue on a finished story resumes at its ending knot (the last lines, then "The End"), as PP's
  "To be continued" does; a "Start over" affordance is Later.
- **Changed by META-PLAN (M9, M27).** `the_end` gains a second action "Прохождение" (the completion card, after
  `reporter.settle`), and a story card on Home gains the same button once the player has reached one of its endings;
  Menu and Home gain Friends and Wallet entries. L15 renders none of them; LMI wires them (L14b re-cut).

**Y15. Covers: a public `cover` namespace, DOM images, measured into first-load.**
- **What.**
  - L5 adds `cover/<story>` to the asset catalog: 360×640, AVIF ≤ 24 KB, WebP ≤ 36 KB, always the public tier
    (marketing art shown before purchase), written to `client/public/assets/` with the manifest
    `client/src/story-gen/covers.json` (`{ assets: Record<AssetId, ImageEntry> }`), fetched at boot beside the
    catalog.
  - The picker renders `<picture>` with `width` / `height` and `decoding="async"`: eager for the first three cards,
    `loading="lazy"` after.
- **Why.** Principle 4: decoded 360×640×4 = 0.88 MiB per cover, three eager = 2.6 MiB; first-load +72 KB worst
  case. A Pixi texture per card would need a GL texture and a registry holder for a DOM screen.
- **Alternatives.** Covers as Pixi textures (above); a cover in a chapter manifest (it belongs to no chapter); cover
  URLs inlined in `catalog.json` (the catalog is the story tool's output, the hashes are the asset tool's: one
  producer per file, PP "Build outputs").
- **Trade-off.** One more boot fetch (about 0.3 KB br), in parallel with the catalog.

**Y16. Privacy and retention: minimal identity, the same database, retention an owner value.**
- **What.** Rows hold `user_id` only (no name or language copies); a closed vocabulary (no free text); the same
  PostgreSQL database as `users` (Q21's 152-FZ localisation applies the same way); no third-party analytics. No
  deletion job: retention defaults to "keep" (Q23). Designed for later: per-user erasure
  `DELETE FROM stat_events WHERE user_id = $1` (an admin path), an age cut-off `DELETE … WHERE received_at < $1`.
  The FK has no cascade, as in decision §4.1: deleting a user deletes its children explicitly. The privacy policy
  mention (Telegram terms §4) is due before production.
- **Why.** Telegram terms §4.2 / §4.3; GDPR Recital 26 (pseudonymised data is personal data); 152-FZ art. 18 p. 5
  (copies included) [S2 §4].
- **Alternatives.** Hashed user ids (still personal data under Recital 26); a cascading FK (decide with the erasure
  feature).
- **Trade-off.** The lawful basis and the retention period are open (owner + lawyer).
- **Changed by META-PLAN (M24–M26, Q23 resolved).** The personal-data inventory, the lawful basis per item, the
  retention defaults, the erasure order and the privacy policy (RU then EN, `GET /api/privacy`, versioned) are
  META-PLAN "Privacy: personal-data inventory, lawful bases, erasure" and M26; the erasure command is a Later lane
  before production.

**Y17. Puzzles per story: unchanged.**
- **What.** Worlds stay per chapter. `PuzzleId = <chapter>.<local>` and `hint:<PuzzleId>:<tier>` stay game-unique
  because chapter ids are (Y1). `puzzle_progress` (`0002`), every L6c route and test and X1–X18 are unchanged. The
  one new consumer: `puzzle_ended` uses the `PuzzleId` as its subject.
- **Why.** Y1 makes the generalization free.
- **Alternatives.** Per-story puzzle namespaces (needed only with per-story chapter numbering).
- **Trade-off.** None.
- **Changed by META-PLAN (M21).** The `hint:<PuzzleId>:<tier>` products are removed (RULINGS 25): a hint tier is
  unlocked by spending a hint from the balance (`hint_unlocks`, PK (user, puzzle, tier)); `PuzzleId` is unchanged.

**Y18. DSL: no tag change; the story-catalog contract enters STAGING-DSL through LS1.**
- **What.** `tags.ts`, `staging.ts`, `TAG_KINDS` and the parser are unchanged. LS1 changes, in one commit with the
  code ([DSL change](#staging-dsl-change-owning-lane-ls1)): STAGING-DSL's header note, §4, §8, §9, one §11 row
  `catalog/stories`; `LINT_CODES['catalog/stories'] = 'E'` in `lint.ts`; the row count 84 → 85 in
  `dsl-doc.test.ts`. Then the three files are frozen again.
- **Why.** RULINGS 13 PE3 froze the tag language; a story is a catalog fact, not a tag. §11 must list every lint
  code (`dsl-doc` enforces it), and §9 is where writers read the chapter files they edit.
- **Alternatives.** An `# ending:` tag (Y4); documenting stories only in AUTHORING.md (the writers' contract split
  over two documents, and §11 incomplete).
- **Trade-off.** The version line stays "DSL v2": §13 asks for a bump on "a new tag, option or default", and this is
  none of them. Writers gain one file to edit (design log).

**Y19. Lanes: generalize in place; four new lanes and one narrative lane.**
- **What.** New: LS1 story-catalog (client), LS2 server-story-saves (server), LS3 server-stats (server), LS4
  stats-client (client), N2 story-tide (narrative). Re-cut: L3c (its C4), L5, L6b, L6c (gate), L7 (gate), L9 (gate),
  L10, L13 (gate), L14a, L14b, L15, LW3 (gate), D1, N1, D2. Order, locks and commits: PP "THE LANE CUT".
- **Why.** Each new lane is one subsystem, ≤ 7 commits and ≤ 14 files (revision 2: LS1 has 8 commits and 17 files,
  for the cast decoupling of W1; PP "LS1" lock note, SQ2); every other change re-cuts a lane that has not started.
  LS3 runs before L9 so LS4 stays off the critical path; the critical path grows by one lane (LS2).
- **Alternatives.** Folding stories into L6b, L10 and L15 (each over the 15-file cap); one "stories" lane across
  client and server (two subsystems, two slots' files).
- **Trade-off.** 38 lanes instead of 32 (LDB2 counted).

---

## Data model and contracts

### Identifiers

| Id | Shape | Scope | Example |
|---|---|---|---|
| `StoryId` | `^[a-z][a-z0-9_]{0,23}$` | game | `manor`, `tide` |
| `ChapterId` | `ch<N>` (unchanged) | **game** (unique across stories, Y1) | `ch3` |
| `EndingName` | `^[a-z][a-z0-9_]{0,31}$` | story | `drowned` |
| stat event id | lower-case UUID v4 `^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$` | user | `crypto.randomUUID()` |
| `PuzzleId`, hint products, line IDs | unchanged (PZ, STAGING-DSL §4). Changed by META-PLAN: hint products removed (M21); a line ID of a choice is also a `choice_made` subject (M1) | game | `ch1.drawer`, ~~`hint:ch1.drawer:2`~~ |

### Source file — `story/stories.json`

```jsonc
// story/stories.json — hand-written by the narrative-designer; the array order is the Home order
[
  { "id": "manor", "first": "ch1", "cover": "cover/manor",
    "endings": { "truth": { "chapter": "ch2", "knot": "archive_truth" },
                 "ashes": { "chapter": "ch2", "knot": "archive_ashes" } } },
  { "id": "tide", "first": "ch3", "cover": "cover/tide",
    "endings": { "drowned": { "chapter": "ch3", "knot": "shore_drowned" },
                 "dawn":    { "chapter": "ch4", "knot": "lamp_dawn" } } }
]
```

`catalog/stories` (E) — every finding printed, none stops the run:
1. the file exists and is a non-empty array; each entry has exactly `id`, `first`, `cover`, `endings`;
2. `id` matches the `StoryId` grammar and is unique;
3. `first` is a listed chapter, free (`paid: false`), and no chapter's `next` names it;
4. the chain from `first` along `next` visits no chapter twice;
5. every chapter of `story/chapters.json` lies on exactly one story's chain;
6. `cover` is `cover/<name>` and exists in `assets/catalog.json`;
7. each ending name matches the `EndingName` grammar; its `chapter` lies on the story's chain;
8. its `knot` exists in that chapter's graph with `ending: true`, has no successor knot and carries no `puzzle` /
   `explore` tag (verify: the yield check reads the knot's parsed tag lines as the graph classifies them; LW3's yield
   edges later make `then=` a successor anyway); no two endings name the same chapter and knot; changed by RULINGS 33
   (as merged, LS1 `64fd798`; W1): a chapter with a `next` keeps a `-> END` knot that is no story ending;
9. a paid chapter's title (`story.json` `chapters`, ru and en) is 1–32 characters — it is the invoice title (Y6).
   Counted in code points, the same rule as L6b's startup check (verify: Telegram's counting unit).

### Locale tables — `story/locales/<lang>/story.json`

```jsonc
{ "names":    { "ally": "…", "keeper": "…" },
  "chapters": { "ch1": "…", "ch3": "…" },
  "stories":  { "manor": "…", "tide": "…" },      // new (LS1): the story title
  "teasers":  { "manor": "…", "tide": "…" } }     // new (LS1): one sentence for the card
```

Every key of every section is required in both languages (`loc/missing-name`, L3c's code; LS1 adds the two
sections to `NAME_SECTIONS`). Titles and teasers are public by design, like names and chapter titles (PP
"Localization").

### TS types (client)

```ts
// story/catalog.ts (LS1). The brands are local, as world/types.ts keeps them (staging.ts does not export Brand).
export type StoryId = Brand<string, 'StoryId'>;           // ^[a-z][a-z0-9_]{0,23}$
export type EndingName = Brand<string, 'EndingName'>;     // ^[a-z][a-z0-9_]{0,31}$
export type StoryEntry = {
  id: StoryId;
  chapters: readonly ChapterId[];                         // chain order; chapters[0] is free
  cover: AssetId;                                         // 'cover/<name>'
  title: { ru: string; en: string };
  teaser: { ru: string; en: string };
};
export type ChapterCatalog = {                            // exact keys: stories, chapters, cast
  stories: readonly StoryEntry[];                         // Home order
  chapters: /* unchanged */ ReadonlyArray<{ id: ChapterId; paid: boolean; productId: ProductId | null;
                                            next: ChapterId | null; title: { ru: string; en: string } }>;
  cast: /* unchanged */ Record<SpeakerId, { char: CharId | null; name: { ru: string; en: string } }>;
};
export type ChapterMeta = { /* unchanged fields */ endings: Readonly<Record<KnotName, EndingName>> };
export function storyOf(c: ChapterCatalog, ch: ChapterId): StoryEntry | null;
// L5 (asset tool output; the 'cover' namespace joins ASSET_ID_RE and decodeAssetCatalog):
export type CoverManifest = { assets: Readonly<Record<AssetId, Extract<AssetEntry, { kind: 'image' }>>> };
export function decodeCoverManifest(raw: unknown): Result<CoverManifest, CatalogIssue[]>;
```

```ts
// scripts/story/stories.ts (LS1; build only)
export type StorySource = { id: StoryId; first: ChapterId; cover: AssetId;
                            endings: Readonly<Record<EndingName, { chapter: ChapterId; knot: KnotName }>> };
export type StoryPlan = StorySource & { chapters: readonly ChapterId[] };      // the resolved chain
export function decodeStories(raw: unknown, chapters: readonly ChapterListEntry[],
                              assets: AssetCatalog): Result<readonly StoryPlan[], Finding[]>;      // rules 1–7
export function checkEndings(stories: readonly StoryPlan[],
                             graphs: ReadonlyMap<ChapterId, ChapterGraph>,
                             sources: ReadonlyMap<string, string>): Finding[];                     // rule 8
// as merged (LS1 `64fd798`, RULINGS 31 Q3): `sources` is the story-relative source map the yield clause classifies
export function checkInvoiceTitles(stories: readonly StoryPlan[], chapters: readonly ChapterListEntry[],
                                   names: StoryNames): Finding[];                                  // rule 9
export function endingKnots(stories: readonly StoryPlan[]): ReadonlyMap<ChapterId, ReadonlyMap<KnotName, EndingName>>;
// emit.ts (LS1 commit 7; revision 4): L3c's StoryNames gains the story titles and teasers, read for StoryEntry and
// the story index; locales.ts nameChecks fills them for the LocaleInput.stories ids (commit 4 only requires them)
export type StoryNames = { chapters: …; speakers: …;                       // unchanged (L3c)
  stories: Record<StoryId, { ru: string; en: string }>; teasers: Record<StoryId, { ru: string; en: string }> };
// emit.ts: server/content/stories.json
export type ServerStoryIndex = { format: 1; stories: ReadonlyArray<{
  id: StoryId; title: { ru: string; en: string };
  chapters: ReadonlyArray<{ id: ChapterId; paid: boolean; productId: ProductId | null; title: { ru: string; en: string } }>;
  endings: Readonly<Record<EndingName, { chapter: ChapterId }>> }> };
```

```ts
// stats/reporter.ts (LS4)
export type StatEvent =
  | { kind: 'chapter_started' | 'chapter_completed'; chapterId: ChapterId; storyVersion: StoryVersion }
  | { kind: 'ending_reached'; chapterId: ChapterId; storyVersion: StoryVersion; ending: EndingName }
  | { kind: 'puzzle_ended'; chapterId: ChapterId; storyVersion: StoryVersion; puzzle: PuzzleLocalId;
      outcome: PuzzleOutcome };                          // the reporter writes the subject as `<chapterId>.<puzzle>`
// Changed by META-PLAN (M1, LS4 re-cut): + | { kind: 'choice_made'; chapterId; storyVersion; option: LineId }
// (subject = option); StatsReporter gains settle({ timeoutMs }): Promise<'drained' | 'timeout'>.
```

Save body: `SaveBodyV1` is unchanged (the story is the row's key, not a body field).

### Rust types (server)

```rust
// ids.rs (L6b, with PuzzleId)
/// A story id, `^[a-z][a-z0-9_]{0,23}$` (STORIES-PLAN Y2). Same derives as `ChapterId`, plus `TS`.
#[serde(transparent)] pub struct StoryId(pub String);
impl StoryId { pub fn parse(s: &str) -> Option<StoryId>; }

// content.rs (L6b)
pub struct StoryDef { pub id: StoryId, pub title: Names, pub chapters: Vec<StoryChapter>,
                      pub endings: BTreeMap<String, ChapterId> }          // ending name -> its chapter
pub struct StoryChapter { pub id: ChapterId, pub paid: bool, pub product: Option<ProductId>, pub title: Names }
impl ContentStore {
    pub fn stories(&self) -> &[StoryDef];                                  // index order
    pub fn story(&self, id: &StoryId) -> Option<&StoryDef>;
    pub fn story_of(&self, ch: &ChapterId) -> Option<&StoryDef>;
}

// api/dto.rs (LS2): SaveSummary gains `story_id: StoryId` (first field); PutSaveRequest unchanged.
// api/dto.rs (LS3)
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StatEventDto { pub event_id: String, pub kind: StatKind, pub chapter_id: String,
                          pub story_version: String, pub subject: Option<String>,
                          pub outcome: Option<StatOutcome>, pub age_ms: i64 }
#[serde(rename_all = "snake_case")] pub enum StatKind { ChapterStarted, ChapterCompleted, EndingReached, PuzzleEnded }
#[serde(rename_all = "snake_case")] pub enum StatOutcome { Solved, Failed, Abandoned }
// as merged (LS3 `00d7c10`, cut D4): StatKind and StatOutcome live in db/stats.rs (the OrderStatus precedent) and
// api/dto.rs imports them; StatKind::ChoiceMade lands with the enum in C2
pub struct PostStatsRequest { pub events: Vec<StatEventDto> }                     // 1..=32
pub struct PostStatsResponse { pub recorded: u32, pub duplicates: u32, pub rejected: Vec<RejectedEvent> }
pub struct RejectedEvent { pub event_id: String, pub reason: StatRejectReason }
#[serde(rename_all = "snake_case")]
pub enum StatRejectReason { UnknownChapter, NotEntitled, UnknownEnding, UnknownPuzzle }
// Changed by META-PLAN (M1, M2, M8): StatKind gains ChoiceMade; StatRejectReason gains UnknownChoice (LS3 declares
// it, LM2 uses it); endings_total is removed from StoryStatsDto and GameStatsDto (LS3 re-cut).
pub struct StatsResponse { pub stories: Vec<StoryStatsDto>, pub game: GameStatsDto }
pub struct StoryStatsDto { pub story_id: StoryId, pub started: bool, pub chapters_completed: Vec<String>,
                           pub chapters_total: u32, pub endings_reached: Vec<String>, pub endings_total: u32 }
pub struct GameStatsDto { pub stories_started: u32, pub stories_total: u32,
                          pub endings_reached: u32, pub endings_total: u32 }
// constants (api/stats.rs): STATS_BATCH_MAX = 32, STATS_HOURLY_CAP = 600, STATS_RETRY_AFTER_SECS = 600,
// STATS_AGE_MS_MAX = 2_592_000_000 (30 days). Errors: ApiError::BadRequest, RateLimited (L6c), Internal — no new
// ErrorCode.
// Changed by META-PLAN revision 1 (W2, Y11): STATS_HOURLY_CAP counts fact rows only; STATS_CHOICE_HOURLY_CAP = 600
// (choice_made); StatRejectReason gains RateLimited (a repeat pick over the choice budget; LS3 declares it).
```

### SQL schema

`server/migrations/0001_init.sql` — LS2 rewrites the `saves` table (decision §4.1 otherwise unchanged):

```sql
CREATE TABLE saves (
  user_id       BIGINT NOT NULL,
  story_id      TEXT   NOT NULL,                -- STORIES-PLAN Y7; validated against the story index at the edge
  slot          TEXT   NOT NULL,
  rev           BIGINT NOT NULL,
  chapter_id    TEXT   NOT NULL,
  story_version TEXT   NOT NULL,
  line_id       TEXT,
  write_id      TEXT   NOT NULL,
  body          TEXT   NOT NULL,                -- opaque JSON, byte-exact: never jsonb
  saved_at      BIGINT NOT NULL,
  CONSTRAINT saves_pkey           PRIMARY KEY (user_id, story_id, slot),
  CONSTRAINT saves_user_fk        FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT saves_story_id_shape CHECK (story_id ~ '^[a-z][a-z0-9_]{0,23}$'),
  CONSTRAINT saves_slot_known     CHECK (slot IN ('auto', 's1', 's2', 's3')),
  CONSTRAINT saves_rev_positive   CHECK (rev >= 1),
  CONSTRAINT saves_body_json      CHECK (body IS JSON),
  CONSTRAINT saves_body_size      CHECK (octet_length(body) <= 262144)
);
-- saves.user_id is still the PK's leading column: the FK stays indexed.
```

`server/migrations/0003_stats.sql` — LS3, a new file (L6c's `server/build.rs` makes cargo see it):

```sql
CREATE TABLE stat_events (                       -- append-only; never read by an unlock or content path (ST4)
  id            BIGINT GENERATED ALWAYS AS IDENTITY,
  user_id       BIGINT NOT NULL,
  event_id      TEXT   NOT NULL,                 -- client UUID v4 (crypto.randomUUID), the idempotency key
  kind          TEXT   NOT NULL,
  story_id      TEXT   NOT NULL,                 -- derived by the server from chapter_id, never sent
  chapter_id    TEXT   NOT NULL,
  subject       TEXT,                            -- ending name | PuzzleId | NULL
  outcome       TEXT,                            -- puzzle_ended only
  story_version TEXT   NOT NULL,
  age_ms        BIGINT NOT NULL,                 -- client-measured age at send; occurred ~ received_at - age
  received_at   BIGINT NOT NULL,                 -- server clock (clock.rs), the time of record
  CONSTRAINT stat_events_pkey             PRIMARY KEY (id),
  CONSTRAINT stat_events_user_fk          FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT stat_events_event_key        UNIQUE (user_id, event_id),
  CONSTRAINT stat_events_event_id_shape   CHECK (event_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  CONSTRAINT stat_events_kind_known       CHECK (kind IN ('chapter_started', 'chapter_completed', 'ending_reached', 'puzzle_ended')),
  CONSTRAINT stat_events_story_id_shape   CHECK (story_id ~ '^[a-z][a-z0-9_]{0,23}$'),
  CONSTRAINT stat_events_chapter_id_shape CHECK (chapter_id ~ '^ch[1-9][0-9]*$'),
  CONSTRAINT stat_events_subject_by_kind  CHECK (
       (kind IN ('chapter_started', 'chapter_completed') AND subject IS NULL AND outcome IS NULL)
    OR (kind = 'ending_reached' AND subject ~ '^[a-z][a-z0-9_]{0,31}$' AND outcome IS NULL)
    OR (kind = 'puzzle_ended' AND subject ~ '^ch[1-9][0-9]*[.][a-z][a-z0-9_]*$'
        AND outcome IN ('solved', 'failed', 'abandoned'))),
  -- as merged (LS3 `00d7c10`, cut D1; server/migrations/0003_stats.sql:28-34): every regex or IN branch also
  -- requires `subject IS NOT NULL` (and `outcome IS NOT NULL` for puzzle_ended), because a CHECK that is NULL passes
  CONSTRAINT stat_events_story_version_shape CHECK (story_version ~ '^[0-9a-f]{16}$'),
  CONSTRAINT stat_events_age_bounded      CHECK (age_ms BETWEEN 0 AND 2592000000),
  CONSTRAINT stat_events_received_positive CHECK (received_at > 0)
);
-- Changed by META-PLAN (M1, LS3 re-cut): stat_events_kind_known gains 'choice_made'; stat_events_subject_by_kind
-- gains (kind = 'choice_made' AND subject ~ '^ch[1-9][0-9]*[.][a-z][a-z0-9_]*[.][0-9a-z]{4}$' AND outcome IS NULL);
-- new: CONSTRAINT stat_events_choice_in_chapter CHECK (kind <> 'choice_made' OR split_part(subject, '.', 1) = chapter_id)
-- (META-PLAN "SQL" holds the whole changed table).
-- The read ("X of Y"): an index-only scan of one user's distinct facts.
CREATE INDEX stat_events_by_user_story ON stat_events (user_id, story_id, kind, chapter_id, subject);
-- The rolling-hour cap count.
CREATE INDEX stat_events_by_user_time ON stat_events (user_id, received_at);
-- stat_events.user_id is the leading column of stat_events_event_key: the FK is indexed.
```

Invariant → constraint: one row per client event (`stat_events_event_key`); no free-text subject
(`stat_events_subject_by_kind`); closed vocabulary (`stat_events_kind_known`); story and chapter grammars; bounded
age. Membership in the current index (an ending of that story) is checked in code: the index changes with builds,
and old rows must stay valid history (ST6 filters at read).

### HTTP API (changes to PP "HTTP API"; common rules unchanged)

| Method + path | Auth | Request | 200 response | Errors | Idempotency / cache |
|---|---|---|---|---|---|
| `GET /api/saves` | bearer | — | `SaveListResponse { slots: SaveSummary[] }`, `SaveSummary { storyId, slot, rev, chapterId, storyVersion, lineId, savedAt, writeId }` — every story's slots | 401 | read; no-store |
| `GET /api/saves/{storyId}/{slot}` (was `/{slot}`) | bearer | — | `SaveFull { summary, body }` | 400 (story id or slot shape), 404 (unknown story, or no row for this user) | read; no-store |
| `PUT /api/saves/{storyId}/{slot}` (was `/{slot}`) | bearer | `PutSaveRequest` unchanged | `PutSaveResponse { rev, savedAt }` | 400 (shapes; `chapterId` not a chapter of the story), 404 unknown story, 409 `save_conflict` + `current`, 413 | PP's rev + writeId contract, per (user, story, slot); body limit 300 KB on this route |
| `POST /api/stats/events` (new, LS3) | bearer | `PostStatsRequest { events: StatEventDto[] }`, 1–32, ≤ 16 KB | `PostStatsResponse { recorded, duplicates, rejected: [{ eventId, reason }] }` | 400 `bad_request` (shape, count, per-kind subject/outcome, event id not a lower-case v4 UUID, `ageMs` outside 0–30 days, `chapterId` / `storyVersion` shape, an unknown field such as `storyId`), 401, 413, 429 `rate_limited` + `Retry-After: 600` (nothing written) | (user, `eventId`): a replay is a duplicate, never a second row; no-store (as merged, LS3 cut D7: `private, no-store` on the 200) |
| `GET /api/stats` (new, LS3) | bearer | — | `StatsResponse` (Y12) | 401 | read; no-store (as merged, LS3 cut D7: `private, no-store` on the 200 of both stats routes) |

Reject reasons, decided in this order per event: `unknown_chapter` (not in the index) → `not_entitled` (paid
chapter, product not owned) → `unknown_ending` (not an ending of the chapter's story in that chapter) /
`unknown_puzzle` (not in the chapter's puzzle index). Rejected events are answered, not retried.

Changed by META-PLAN (M1, M2, M8): `StatEventDto` admits `kind: "choice_made"` (subject = the option's line ID of
that chapter; 400 on a wrong shape or prefix; as merged, LS3 cut D3: a well-formed choice whose chapter part differs
from `chapterId` is a per-event `unknown_choice` after `not_entitled`, not a 400); the reason `unknown_choice` (not an
option of `meta.choices[chapter]`,
LM2) joins the third step; `StatsResponse` has no `endingsTotal`. The new meta routes are in META-PLAN "HTTP API".

### Server formats (story tool → server; the committed fixture is the contract)

```jsonc
// server/content/stories.json — emitted by the story tool (LS1); loaded by ContentStore (L6b); never under client/
{ "format": 1,
  "stories": [
    { "id": "manor", "title": { "ru": "…", "en": "…" },
      "chapters": [ { "id": "ch1", "paid": false, "productId": null,          "title": { "ru": "…", "en": "…" } },
                    { "id": "ch2", "paid": true,  "productId": "chapter:ch2", "title": { "ru": "…", "en": "…" } } ],
      "endings": { "truth": { "chapter": "ch2" }, "ashes": { "chapter": "ch2" } } },
    { "id": "tide", "title": { "ru": "…", "en": "…" },
      "chapters": [ { "id": "ch3", "paid": false, "productId": null,          "title": { "ru": "…", "en": "…" } },
                    { "id": "ch4", "paid": true,  "productId": "chapter:ch4", "title": { "ru": "…", "en": "…" } } ],
      "endings": { "drowned": { "chapter": "ch3" }, "dawn": { "chapter": "ch4" } } } ] }

// server/catalog.json — hand-written (L6b); chapters changed by STORIES-PLAN Y6 (hints unchanged, PZ)
{ "chapters": { "defaultPriceStars": 1,                                     // PLACEHOLDER (Q3): every paid chapter
                "priceStars": {},                                            // overrides, e.g. { "ch4": 2 } (owner)
                "title":       { "ru": "{chapter}", "en": "{chapter}" },     // rendered 1–32 characters
                "description": { "ru": "«{story}»: {chapter}", "en": "“{story}”: {chapter}" } },   // 1–255
  "hints": { "priceStars": [1, 1, 2], "title": { … }, "description": { … } } }
// Changed by META-PLAN (M17, M21): no `hints` section (RULINGS 25: L6b built no hint products); LE1 adds the
// `economy` section (resource kinds, `pack:<id>` products, `spend.hintTier`, gift and referral rules).
```

Fixtures (L6b, `server/tests/fixtures/content/`): `stories.json` exactly as above (two stories); paid content for
ch2 and ch4 (`chapters/<ch>/`); puzzle indexes for every fixture chapter (`puzzles/{ch1,ch2,ch3,ch4}.json`, ch3 and
ch4 with no puzzles). Every `it` and `dev.rs` test runs on them (PP lane rules "Content paths").

### Build outputs (additions to PP "Build outputs")

| Output | Producer | Where | Public? |
|---|---|---|---|
| `stories` in `catalog.json` | story tool (LS1) | `client/src/story-gen/catalog.json` | yes (no endings) |
| `endings` in `ChapterMeta` | story tool (LS1) | free: `story-gen/free/<ch>.meta.json`; paid: `server/content/chapters/<ch>/meta.json` | free only |
| server story index | story tool (LS1) | `server/content/stories.json` | no |
| cover files + `covers.json` | asset tool (L5) | `client/public/assets/cover-<id>-<hash8>.{avif,webp}`, `client/src/story-gen/covers.json` | yes |

### Staging DSL change (owning lane LS1)

No tag, option or default changes. In one LS1 commit, together with the `LINT_CODES` entry and the `dsl-doc` count:
- **Header:** after the DSL v2 sentence: "§9 also describes the story list `story/stories.json` (STORIES-PLAN, lane
  LS1); the tag language is unchanged." The version line stays "DSL v2".
- **§4 Line IDs:** the "Unique" row reads "across **all** chapters of all stories (`id/duplicate`)".
- **§8 Knot index:** the output line becomes `knots.<name> = { assets, next, ending }` plus `endings: { <knot>:
  <name> }` (the declared story endings of the chapter, §9). **Next chapter:** a knot that is a declared story ending
  never preloads the next chapter: the story ends there.
- **§9 Chapters → "Chapters and stories":** `story/stories.json` (format, Home order); membership = the `next` chain
  from `first`; every chapter in exactly one story; the first chapter of every story is free; story titles and
  teasers in `story.json`; endings: the rules of `catalog/stories` 7–8, written as authoring rules; story end: after a
  declared ending's END the player sees "The End", not the next chapter; cast and globals are shared, carry flows
  only along a story's chain, new globals are named `g_<story>_<name>`; never move a shipped chapter to another story
  (its saves are keyed by story).
- **§11:** one row: `catalog/stories` | E | the nine rules of [the source file section](#source-file--storystoriesjson),
  in one sentence each.

---

## Module API

```ts
// app/game.ts (L15) — one Game for the app's life, one story per session
export interface Game {
  start(from: { kind: 'new'; story: StoryId; chapter: ChapterId } |
              { kind: 'slot'; story: StoryId; slot: SaveSlot }): Promise<Result<void, GameError>>;
              // GameError gains { kind: 'chapter-outside-story' } (a chapter not in story.chapters)
  exitToStories(): Promise<void>;   // single-shot, in this order: the open PuzzleSession.dispose() (aborts an
                                    // in-flight attempt, drops its hint texts, disposes its hint PurchaseFlow) and the
                                    // chapter PurchaseFlow.dispose() → autosave (≤ 2 s, else the pending cache; the
                                    // world state is still in the explore controller) → ExploreController.dispose()
                                    // (room:* holders, its ResizeObserver, its subscriptions; the explore and puzzle
                                    // view stores reset) → runner.dispose() → scene.restore(EMPTY_SNAPSHOT) +
                                    // releasePreload of every tag → audio fade-out and SFX release (verify: L12's API
                                    // for "no chapter") → saves.dispose() → reporter.flush(); the Pixi Application
                                    // stays (K5 holders at baseline)
  /* advance, choose, setMode, save, buy, dispose: unchanged */
}

// saves/service.ts (L10) — one per game session
export function createSaveService(deps: { api: Endpoints; device: DeviceStore | null; clock: Clock;
                                          story: StoryId }): SaveService;     // pending key `pending_${story}`
// api/endpoints.ts (L10, LS4)
listSaves(): Promise<Result<SaveListResponse, ApiError>>;                      // every story
getSave(story: StoryId, slot: SaveSlot): Promise<Result<SaveFull, ApiError>>;
putSave(story: StoryId, slot: SaveSlot, req: PutSaveRequest): Promise<Result<PutSaveResponse, ApiError>>;
postStatEvents(events: readonly StatEventDto[], o?: { keepalive: boolean }): Promise<Result<PostStatsResponse, ApiError>>;
getStats(): Promise<Result<StatsResponse, ApiError>>;

// stats/reporter.ts (LS4)
export interface StatsReporter {
  record(e: StatEvent): void;                      // synchronous; never throws, never awaits
  flush(o?: { keepalive: boolean }): void;          // single-flight; a failure keeps the events
  dispose(): void;                                   // clears its timers; the queue stays in DeviceStorage
}
export function createStatsReporter(deps: { api: Pick<Endpoints, 'postStatEvents'>; device: DeviceStore | null;
  clock: Clock; newId: () => string /* crypto.randomUUID in production */;
  log?: (msg: string) => void /* __TG_MOCK__ only */ }): StatsReporter;
// boot.ts owns the reporter and its two subscriptions (facade `deactivated`, window `pagehide`) → flush({ keepalive: true }).
```

```rust
// db/saves.rs (LS2): every function gains `story: &StoryId` after `user`; `list(user)` returns every story's rows.
// db/stats.rs (LS3)
pub struct NewStatEvent<'a> { pub event_id: &'a str, pub kind: StatKind, pub story: &'a StoryId,
                              pub chapter: &'a ChapterId, pub subject: Option<&'a str>,
                              pub outcome: Option<StatOutcome>, pub story_version: &'a str, pub age_ms: i64 }
pub enum RecordOutcome { Recorded { inserted: Vec<String> }, RateLimited }
impl Repo {
    /// The cap count, then one UNNEST insert with `ON CONFLICT ON CONSTRAINT stat_events_event_key DO NOTHING
    /// RETURNING event_id` (autocommit; the cap is soft by one batch).
    pub async fn record_events(&self, user: UserId, events: &[NewStatEvent<'_>], now: i64, cap: i64)
        -> Result<RecordOutcome, sqlx::Error>;
    // as merged (LS3 `00d7c10`, cut D5; server/src/db/stats.rs:120-174): the two budgets of revision 1 —
    //   record_events(user, events, now, caps: StatCaps { facts, choices })
    //   RecordOutcome::{ Recorded { inserted, over_budget }, RateLimited }
    // `over_budget` holds the choices past the choice budget that were not first picks (answered `rate_limited`)
    /// The user's distinct (story, kind, chapter, subject) facts of the three story kinds.
    pub async fn stat_facts(&self, user: UserId) -> Result<Vec<StatFact>, sqlx::Error>;
}
// api/stats.rs (LS3): post_events, get_stats; classify(&ContentStore, owned: &HashSet<ProductId>, &StatEventDto)
// -> Result<NewStatEvent, StatRejectReason> (pure; unit-tested in the module).
```

---

## Critical flows

### F1′. Boot → Home → first line (changes to PP F1)

| # | Actor | Step | If it fails / repeats |
|---|---|---|---|
| 3 | client | in parallel: engine import; `POST /api/auth`; catalog + `covers.json`; `GET /api/saves` (every story); entitlements; settings. After auth: `createStatsReporter` → flush of the persisted queue | covers fail → cards without images; the rest as PP |
| 5 | client | Home: Continue (newest `auto` across stories, its story title) and the cards (first three covers eager) | a save of a story not in the catalog is ignored |
| 6 | player | taps Continue, or a card's Start / Continue / Chapters | the handler is single-shot |
| 7 | client | `unlockAudio()` synchronously; await the engine; `game.start({ new, story, chapter: story.chapters[0] })` or `{ slot, story, slot: 'auto' }` | as PP |
| 8–9 | client | as PP; a runner created from a `fresh` start point (a new game, or a resume through step 2 or 5) records `chapter_started` (Y9) | — |

### F2 addition. Entering a knot

`enteredKnot` K with `meta.endings[K] = e` → `reporter.record({ ending_reached, e })` (flushed at once); F2 step 5
(the F5 next-chapter preload) is skipped for K; steps 1–4 are unchanged.

### F4′. Chapter end and story end (changes to PP F4)

1. The ink reaches END. If the last entered knot K is in `meta.endings` → the story is over: no `chapter_completed`
   (K's `ending_reached`, F2, marks it), no new autosave (the last one is K's checkpoint); `Notice` `the_end`; its
   action calls `exitToStories()`.
2. Otherwise → `record(chapter_completed)`, then PP F4 steps 2–5. The next chapter is on the same chain by
   construction (`catalog/stories` rule 5); after the new runner starts (a `fresh` start point),
   `record(chapter_started)`.

### F11. Statistics capture

| # | Actor | Step | If it fails / repeats |
|---|---|---|---|
| 1 | client | `record(e)` → queue + DeviceStorage `stats_queue` | DeviceStorage error → memory only, no error |
| 2 | client | trigger (5 s debounce, an ending, `deactivated`, `pagehide`, boot) → `POST /api/stats/events` with the oldest ≤ 32 | a flush in flight: the trigger marks "again" |
| 3 | server | auth → decode → structural checks | 400 → the client drops the batch (logged in dev) |
| 4 | server | classify each event (chapter → entitlement → subject) | rejected → listed in the answer |
| 5 | server | count the user's rows of the last hour | over 600 → 429 + `Retry-After`, nothing written |
| 6 | server | UNNEST insert, `ON CONFLICT DO NOTHING RETURNING event_id` | DB error → 500 → backoff |
| 7 | client | 200 → drop recorded, duplicate and rejected events; persist the queue | network / 5xx → keep, backoff 5 → 300 s; 401 → the single-flight re-auth of `http.ts`, retried once; 429 → wait `Retry-After` |

A resend after a lost 200 comes back as duplicates and is dropped (ST5).

Changed by META-PLAN revision 1 (W2): step 2 sends the queued facts first, then choices (Y13); step 5 counts facts
and choices apart — over 600 facts → 429 as above; over 600 choices → repeat picks rejected `rate_limited`, first
picks recorded, never a 429 (Y11).

### F12. Statistics read

`GET /api/stats` → `stat_facts(user)` (one statement) → per story of the index: `started` = any `chapter_started` in
it; `chaptersCompleted` = distinct chapters still in the story with a `chapter_completed`, or holding a reached ending
still in the story (a declared ending ends its chapter without a `chapter_completed`, F4′); `endingsReached` =
distinct ending names still in the story; totals from the index → `game` sums. Old rows outside the index are kept
and not counted (ST6). Changed by META-PLAN (M8): no ending total in either level; `choice_made` rows are not read
here (the card and the friend profile read them, META-PLAN F16, F22).

### F13. Back to stories

Menu → "Back to stories" → `exitToStories()` (single-shot, as an intent after the current batch completes) → Home
mounted with a fresh `listSaves()`. During `busy`, the intent waits for `scene.complete()`.

### F14. Purchase in story B

PP "Payment flow" unchanged: `POST /api/invoices { productId: "chapter:ch4" }` → price from `defaultPriceStars`
(or an override) → invoice title = ch4's title, description "«tide title»: ch4 title".

---

## Concurrency and failure model

| Situation | Outcome |
|---|---|
| A stats batch resent after a lost response | every event a duplicate; nothing double-counted (ST5) |
| The same ending reached twice (replay, resume at the knot) | two rows, one fact: `endingsReached` holds it once |
| Two concurrent stats batches near the cap | both may pass the count: overshoot ≤ 32 rows (soft cap, Y11); as merged (LS3 review M2): up to one batch per concurrent request |
| A forged client posts new ids in a loop | 600 rows per hour, then 429; counts unchanged (set semantics). Changed by META-PLAN revision 1 (W2): 600 fact rows per hour, then 429, plus 600 choice rows and first picks (bounded by the vocabulary) |
| A skip-mode replay posts ≈ 1,200 picks per hour and reaches an ending (changed by META-PLAN revision 1, W2) | the ending is recorded (facts have their own budget); repeat picks past 600 per hour are rejected `rate_limited`, first picks recorded; a full queue evicts choices first |
| A paid-chapter event without the entitlement (or after a refund) | `not_entitled`, dropped by the client; the subject is never checked |
| Two devices, same story | PP's rev / writeId / 409 per (user, story, slot) |
| Two devices, different stories | independent rows; no conflict (ST3) |
| Double tap on a card's Start | single-shot handler (PP F1 step 5) |
| "Back to stories" during a transition | queued as an intent; runs after `scene.complete()` |
| "Back to stories" with a puzzle attempt or a chapter purchase in flight | the attempt is aborted before the exit's autosave and its late response is dropped (the server may have set `solved_at`: harmless, PZ); the purchase flow stops polling, the order completes on the server, and the next paywall reads `GET /api/entitlements` (PP P1) |
| Reload mid-chapter | Continue = the newest `auto`; each card resumes its own story; each story's pending entry is uploaded under PP F3 step 5 |
| `deactivated` during a flush | the keepalive flush; the queue is persisted either way |
| Token expiry mid-flush | 401 → single-flight re-auth → retried once with the same ids |
| Server started without `server/content/stories.json`, or with a paid first chapter | `StartupError::Content` (the server does not start) |
| Story update: an ending renamed or removed | the gate fails until `stories.json` matches; old rows stay, not counted (ST6) |
| Story update: a chapter appended to a story | `chaptersTotal` grows; saves unaffected |
| Story update: a story removed | its saves are ignored by the client (not in the catalog), its PUTs 404; its rows not counted |
| Story update: a shipped chapter moved to another story (forbidden by D1) | `GET` still returns the old row; resume sees a chapter outside the story → starts the story's first chapter with the PP "updated" toast; a PUT of that chapter under the old story → 400 → autosave pauses with the PP error toast |
| DeviceStorage unavailable (< 9.0) | memory-only queue and pending cache (K13) |
| WebGL context lost while on Home | Home has no Pixi; PP's `activated` check runs as before |
| An event older than 30 days in the queue | dropped by the client before sending (the CHECK would 400 the whole batch) |

Server: no blocking work in handlers; the stats statements run under decision §4.3's session settings
(`statement_timeout`, `lock_timeout`); the stats inserts take only the FK's `KEY SHARE` on the user row, which never
conflicts with the payment path's `NO KEY UPDATE` (decision §4.4).

---

## Resource lifetime

| Resource | Owner | Created | Destroyed | Leak detection |
|---|---|---|---|---|
| `StatsReporter` (queue, debounce and retry timers) | `boot.ts` | after auth | `dispose()` at app teardown | `reporter: dispose clears timers` (fake clock: 0 pending timers) |
| `deactivated` / `pagehide` subscriptions for the flush | `boot.ts` | boot | teardown (the facade's unsubscribe) | the facade's one-subscription test (L7) |
| Cover `<img>` elements | `StoryPicker.svelte` | Home mounted | Home unmounted at `game.start` | e2e `stories: picker unmounted during play` (0 cover images in the DOM) |
| `SaveService` | `Game.start` | per story session | `exitToStories()` / `dispose()` | `game: exit to stories disposes the save service` |
| `StoryRunner` | GameSession (PP) | per chapter | chapter change, `exitToStories()` | `game_holds_one_runner` |
| Scene holders of the story | `SceneController` (PP) | per batch / preload | `exitToStories()`: `restore(EMPTY_SNAPSHOT)` + `releasePreload` | `game: exit to stories returns the registry to baseline` |
| `PuzzleSession` (+ its `AbortController`, hint texts, hint `PurchaseFlow`) | `app/yields.ts` (PZ) | puzzle effect / yield | end, close, chapter change (PZ); `exitToStories()`, before its autosave | `game: exit to stories disposes explore, puzzle and purchase sessions` |
| `ExploreController` (+ `room:*` holders, its `ResizeObserver`) | GameSession (PZ) | first explore yield of a chapter | chapter change (PZ); `exitToStories()`, after its autosave | the same test |
| Chapter `PurchaseFlow` (polling timer) | GameSession (`buy`) | Buy | terminal state, `exitToStories()`, `dispose()` | the same test; PP `flow_clears_timers` |
| DeviceStorage `stats_queue` | reporter | first record | emptied as events are acknowledged | `reporter: queue capped at 64 drops oldest` |
| DeviceStorage `pending_<story>` | `SaveService` | a failed PUT | the acknowledged PUT | `saves: pending entry is per story` |

---

## Integration

### Modules (new or changed)

| Module | Responsibility | Boundary |
|---|---|---|
| `client/scripts/story/stories.ts` (LS1) | decode `stories.json`; `catalog/stories` rules; ending knots | build only |
| `client/scripts/story/emit.ts` (LS1) | + `stories` in the catalog, `endings` in metas, `server/content/stories.json` | build only; paid routing unchanged |
| `client/src/story/catalog.ts` (L5, LS1) | `cover` namespace, `CoverManifest`; `StoryEntry`, `storyOf`, `ChapterMeta.endings` | pure decoders |
| `client/src/stats/reporter.ts` (LS4) | the event queue and its flush | entry chunk; no story, scene or Svelte import |
| `client/src/saves/service.ts` (L10) | per-story saves | one instance per session |
| `client/src/ui/StoryPicker.svelte` (L14b) | the story cards (presentational) | props only |
| `client/src/app/game.ts` (L15) | stories, story end, events | the only reporter caller besides `boot.ts` |
| `server/src/content.rs`, `catalog.rs`, `ids.rs` (L6b) | story index, chapter products from it, `StoryId` | |
| `server/src/api/saves.rs`, `db/saves.rs` (LS2) | saves keyed by story | |
| `server/src/api/stats.rs`, `db/stats.rs`, `migrations/0003_stats.sql` (LS3) | write and read of the event log | `db/stats.rs` is called only by `api/stats.rs` |

### docs/FEATURE_MAP.md entries (D1 / D2 write them)

| Feature | Rows |
|---|---|
| Stories | `story/stories.json`, `scripts/story/stories.ts`, `emit.ts` (stories, endings, server index), `story/catalog.ts` (`StoryEntry`), `ui/StoryPicker.svelte`, `ui/ChapterSelect.svelte`, `app/game.ts` (story end); `server/src/content.rs` (story index), `catalog.rs` (chapter products) |
| Saves per story | `saves/service.ts`; `server/src/api/saves.rs`, `db/saves.rs`, `migrations/0001_init.sql` (`saves`) |
| Player statistics (foundation) | `stats/reporter.ts`, `app/game.ts` (event points); `server/src/api/stats.rs`, `db/stats.rs`, `migrations/0003_stats.sql` |

### PROTOTYPE-PLAN.md and PUZZLES-PLAN.md items changed (each marked there)

| Item | Change |
|---|---|
| PP Goal, invariants | the story journey; ST1–ST8; first-load per story; carry and stats invariants |
| PP K3 | Home (picker) and the reporter in the entry chunk (+3.2 KB br) |
| PP K8 | carry along a story's chain only; shared cast and globals (Y3) |
| PP K9 | `endings` in the meta; declared ending knots do not trigger F5 (Y4) |
| PP K12 | saves per story (Y7) |
| PP K13 | `pending_<story>`; `stats_queue` in DeviceStorage (Y13) |
| PP K26 | Home as the root with no BackButton; ChapterSelect per story; "Back to stories" in the menu (Y14) |
| PP TS types, Module map (arch rules), Module API (`Game`), SQL, HTTP API, Build outputs, Shared types, F1, F4, F5, Budgets, Test strategy, Later, lane cut | as in this file |
| PZ Identifiers, Server formats (`server/catalog.json` chapters), Implementation plan, Demo content outline, Resource lifetime | `PuzzleId` stays game-unique (Y17); chapter prices by default + templates (Y6); lanes re-cut in PP; ch1–ch2 are story `manor`, ch2 ends in two declared endings; `PuzzleSession` and `ExploreController` are also destroyed by `exitToStories()` (revision 1) |

---

## Implementation plan

The lanes are cut in PP "THE LANE CUT" (dependency order, locks, commits, red-firsts, gates, seen working):

| Lane | Slot | Gate to start | Files | Commits | Content |
|---|---|---|---|---|---|
| **LS1 story-catalog** (new) | client | L3c, L5, L6b | 17 | 8 | `stories.json` + `catalog/stories`; metas, catalog, server index; locale sections; carry filter; DSL doc row; the arch rule `import-outside-src`; the tool tests on an inline cast (revision 2: `tags.test.ts`, `lint.test.ts`, `locales.test.ts` join the lock) |
| **LS2 server-story-saves** (new) | server | L6b | 10 | 4 | `0001` saves rewrite; routes per story; story validation |
| **LS3 server-stats** (new) | server | L8b (after L6c's `build.rs`) | 11 | 5 | `0003_stats.sql`; POST / GET; DTOs |
| **LS4 stats-client** (new) | client | L10, LS3 | 5 | 3 | endpoints + decoders; the reporter |
| **N2 story-tide** (new) | narrative | N1, LS1, L5 | 10 paths | 2 | story B (ch3 free, ch4 paid), cast, titles, endings; each commit carries the cast, names and titles its chapters and story need |
| Re-cut | — | — | — | — | L3c (C4 tags carries), L5 (covers, story B assets, rows; revision 3: the `tags.test.ts` catalog-key pins, 14 files), L6b (story index, prices), L6c / L9 / LW3 / L13 (gates), L7 (gate LS1), L10 (saves per story), L14a (Home), L14b (picker, the end), L15 (wiring, `stories.spec.ts`), D1, N1, D2 |

**Running and merged lanes** (as of `66c92c4`, this design's merge; changed by RULINGS 22, 23: this list was written
while LDB1 ran; LDB1 and LDB2 had merged before the design landed, and the merge released L3c and L6b):
- **LDB1** (merged `fee9da7`): no scope change mid-flight. LS2 rewrites the `saves` table of the `0001` it
  wrote (collision lock `0001`: L2 → LDB1 → LS2); its seen-working path `PUT /api/saves/auto` becomes
  `/api/saves/manor/auto` in the docs (D2).
- **LDB2** (merged `a7e4a04`): it ran early in an idle server slot (SQ4), so it no longer follows L9.
- **LW2** (merged `38bc717`): no follow-up from stories (worlds stay per chapter, Y17); its queued errata (RULINGS 21)
  are applied after this design merges.
- **L3c** (paused at `5d12aa3`, C1 + C2 committed; resumed after the merge, trunk-synced `f1a46ea`, re-cut v3 with C1
  `87ee7cf` + C2 `5d12aa3` kept): C1 (`fix.ts`) and C2 (`locales.ts`) survive verbatim; C3 and C5
  as cut; C4 tags each carry with the knot its run ended in, so LS1 can drop story-ending runs from the next chapter's
  carry. Its RULINGS 19 seen-working line stays.
- **L6b** (running since the merge, server slot, base `d9ca9f1`): the first server lane of the chain.

**Order** (RULINGS 8 rolling, RULINGS 18 three slots; as of `66c92c4`, changed by RULINGS 22, 23: LDB1 and LDB2
merged, so the server chain starts at L6b): server L6b → LS2 → L6c → L8a → L8b → LS3 → L9; client (two slots)
L3c → L5 → {L11, LS1 (after L6b), L12} → {L7, LW3} → L14a, D1 → N1 → N2, and L10 (after
L8b) → L13, L14b → LP2 ∥ LX, LS4 → L15 → D2. Critical path: L6b → **LS2** → L6c → L8a → L8b → L10 → L14b →
LP2 → L15 → D2 (+1 lane). The PP lane entries hold the locks, commits, red-firsts, gates and seen-working.

**Collision locks added** (PP "Collision locks"): `0001` L2 → LDB1 → LS2; `0003` LS3; the serialized server files
L6b → LS2 → L6c → L8a → L8b → LS3 → L9; `ids.rs` L6b (`StoryId` with `PuzzleId`); `lint.ts` / `dsl-doc.test.ts` /
STAGING-DSL reopened for LS1 only, and (revision 2) `tags.test.ts` / `lint.test.ts` for one hunk each in LS1 commit
8, and (revision 3, SQ9) `tags.test.ts` for one hunk in L5 before that; `catalog.ts` L5 → LS1 → L13; `story.ts`, `emit.ts`, `build.test.ts`, `locales.ts` and (revision 2)
`locales.test.ts` L3c → LS1 → LW3; `arch.test.ts` L1 → LW2 → LS1 → LP2 (revision 1); `story/stories.json` and
`story.json` LS1 → N1 → N2; `api/{endpoints,decode}.ts` L10 → LS4; `dto_samples.rs` L8b → LS3.

---

## Budgets and validation

| Budget | Limit | Basis | Enforced by |
|---|---|---|---|
| Entry closure JS | ≤ 40 KB br (unchanged) | this change ≈ +3.2 KB br: StoryPicker 1.2, reporter 1.3, decoders 0.4, endpoints 0.3 | `budget.ts` |
| Cover image | exactly 360×640; AVIF ≤ 24 KB; WebP ≤ 36 KB; both formats | Y15: 0.88 MiB decoded | `budget.ts` (L5) |
| First-load to first line, per story | for every free chapter that no `next` names (the first chapter of each story, Y2 rule 3): closures + CSS + html + TWA + `catalog.json` + `covers.json` + the 3 largest cover AVIFs + that chapter's story / meta / manifest + its first knot's images ≤ 800 KB | PP row, per story; the 3 largest covers bound the 3 eager cards whatever the order | `budget.ts` (L5): `budget: first-load row per story` |
| Story JSON, en table, per-chapter transfer, knot set | PP limits, per chapter of every story | unchanged | `budget.ts` |
| Stats queue | ≤ 64 events (≈ 14 KB); changed by META-PLAN revision 1 (W2): choices evicted first | Y13 | `reporter: queue capped at 64 drops oldest`, `reporter: queue full of choices keeps ending_reached` |
| Stats batch | ≤ 32 events, ≤ 16 KB body | Y11 | `stats_batch_over_32_400`; the default body limit |
| Stats rows | ≤ 600 per user per rolling hour; changed by META-PLAN revision 1 (W2): ≤ 600 fact rows + ≤ 600 choice rows per rolling hour, plus first picks | Y11 | `stats_rate_limited_after_600_per_hour` (fact rows), `stats_cap_does_not_refuse_facts`, `stats_choice_over_budget_keeps_first_picks` |
| Home memory | Home unmounted during play; ≤ 2.6 MiB of cover bitmaps worst case | 138.1 MiB steady at the gated limits | e2e `stories: picker unmounted during play`; PP `heap under budget` |
| Time to first line | ≤ 6 s (unchanged), the tap on the first card's Start | Y14 | e2e `time to first line under throttling` (L15) |

Story checks (`npm run story`): compile, every lint code incl. `catalog/stories`, line IDs unique across all stories,
locales incl. story titles and teasers, 200 seeded playthroughs per chapter (story-ending runs excluded from the next
chapter's carry), paid chapters and paid metas absent from `dist/` (PP T1).

---

## Test strategy

### Names per layer (each lane's commits name the ones it adds)

| Layer / lane | Tests |
|---|---|
| Story tool and arch (LS1) | `dsl-doc: lint table equals lint codes` (85 rows); `stories: chapter in two stories fails`, `stories: chapter in no story fails`, `stories: paid first chapter fails`, `stories: next cycle fails`, `stories: first named by a next fails`, `stories: unknown cover fails`, `stories: bad story id fails`, `stories: unknown key fails`, `stories: ending knot must end the chapter`, `stories: ending knot with successors fails`, `stories: ending knot with a yield fails`, `stories: ending chapter outside the story fails`, `stories: two endings on one knot fail`, `stories: paid chapter title over 32 characters fails`; `loc: story title and teaser required`; `catalog: catalog with stories decodes`, `catalog: meta without endings is malformed`; `emit: public catalog lists stories without endings`, `emit: meta carries endings`, `emit: paid endings only in server outputs`, `emit: server story index matches the server fixture shape`; `story: missing stories.json fails the gate`, `story: a story-ending run does not carry into the next chapter`; `arch: import-outside-src red on fixture`, `arch: import-outside-src allows fixtures`; moved on purpose, old → new as PP LS1 commit 7 lists them: `emit: free and paid outputs are routed apart`, `emit: meta holds the knot index and the story version`, `catalog: emitted chapter catalog and meta decode`, `catalog: malformed meta is an error value`, `story: cli builds a free and a paid chapter`, and (revision 4) L3c's `locales: matching tables raise nothing` |
| Story tool (L3c C4) | `play: carries name the knot each run ended in` |
| Asset tool (L5) | `catalog: cover namespace decodes`, `assets: covers always public`, `budget: cover over 24 KB fails`, `budget: first-load row per story` |
| Server (L6b) | `story_index_loaded`, `startup_fails_without_story_index`, `startup_fails_when_first_chapter_paid`, `catalog_default_price_applies_to_every_paid_chapter`, `catalog_price_override_must_be_paid_chapter`, `chapter_invoice_titles_within_limits`, `entitlements_lists_every_paid_chapter_of_every_story` |
| Server (LS2) | `schema_saves_story_id_shape`, `schema_saves_pk_per_story`, `saves_story_slots_independent`, `saves_unknown_story_404`, `saves_bad_story_id_400`, `saves_chapter_outside_story_400`, `saves_list_spans_stories`; every existing `saves_*` and `schema_save*` name kept, on the new paths |
| Server (LS3) | `schema_stat_events_event_key`, `schema_stat_events_subject_by_kind`, `schema_stat_events_event_id_shape`, `schema_stat_events_story_id_shape`, `stats_event_replay_counts_once`, `stats_rate_limited_after_600_per_hour`, `stats_batch_over_32_400`, `stats_story_derived_by_server`, `stats_unknown_ending_rejected`, `stats_paid_ending_needs_entitlement`, `stats_not_entitled_hides_ending_check`, `stats_puzzle_of_other_chapter_rejected`, `stats_endings_x_of_y`, `stats_ending_completes_its_chapter`, `stats_retired_ending_not_counted`, `stats_do_not_unlock_paid_chapter`, `stats_private_no_store`; `bindings_are_fresh`, `dto_samples_are_fresh`. Changed by META-PLAN: `stats_endings_x_of_y` → `stats_endings_reached_distinct`; + `schema_stat_events_choice_in_chapter`, `stats_choice_shape_checked`, `stats_response_has_no_endings_total` (LS3); `stats_unknown_choice_rejected`, `stats_paid_choice_needs_entitlement_first` (LM2); the client rows gain `reporter: choice event carries the option line id`, `reporter: settle resolves after the queue drains`, `reporter: settle times out without throwing` (LS4) and `game: a choice records its option line id` (L15). Changed by META-PLAN revision 1 (W2): + `stats_cap_does_not_refuse_facts`, `stats_choice_over_budget_keeps_first_picks` (LS3); `stats_rate_limited_after_600_per_hour` counts fact rows |
| Client unit (L10) | `saves: pending entry is per story`, `saves: list spans stories` |
| Client unit (LS4) | `decode: stats samples decode`, `reporter: retried batch keeps event ids`, `reporter: ending flushes at once`, `reporter: 429 waits retry-after`, `reporter: 400 drops the batch`, `reporter: rejected events are dropped`, `reporter: failure never throws`, `reporter: queue survives reload through device storage`, `reporter: queue capped at 64 drops oldest`, `reporter: events older than 30 days are dropped`, `reporter: dispose clears timers`; changed by META-PLAN revision 1 (W2): + `reporter: queue full of choices keeps ending_reached`, `reporter: batch sends facts first` |
| Client DOM (L14a, L14b) | `tap: continue names the story`; `menus: story picker shows start or continue per story`, `menus: chapter select lists only its story`, `menus: notice kinds show their actions` (with `the_end`), `menus: menu has back to stories` |
| Client unit (L15) | `game: chapter start and end are reported`, `game: exact or checkpoint resume does not report chapter start`, `game: pending chapter start reports chapter start`, `game: declared ending end is distinguishable from chapter end`, `game: ending knot reports the ending and skips next-chapter preload`, `game: story end shows the end`, `game: exit to stories returns the registry to baseline`, `game: exit to stories disposes the save service`, `game: exit to stories disposes explore, puzzle and purchase sessions`, `game: start rejects a chapter outside the story` |
| e2e (L15, `stories.spec.ts`) | `stories: picker lists both stories with covers`, `stories: saves are per story`, `stories: second story first chapter free then paywall`, `stories: story ending shows the end and records the ending` (reads `GET /api/stats` with a token the test obtains through `/dev/launch` + `POST /api/auth` for the same dev user), `stories: back button closes chapter select to the picker`, `stories: picker unmounted during play` |

### Gates that must be seen red once (each lane quotes the failing run)

| Gate | Seeded failure | Lane |
|---|---|---|
| `dsl-doc` two-way | `catalog/stories` in `LINT_CODES`, the §11 row missing → `notInDoc: ['catalog/stories']` and 84 ≠ 85 | LS1 |
| `story` | each `catalog/stories` rule on an inline fixture; `stories.json` absent → exit 1 | LS1 |
| `emit` leak | a paid chapter's ending name planted in the public catalog → `emit: paid endings only in server outputs` red | LS1 (as merged: seen red in C7 `3668a09`) |
| arch | `import-outside-src` in `RULE_IDS` with its fixtures and no detector → `arch: import-outside-src red on fixture` (`story/catalog.ts` importing `../../../story/stories.json` not flagged); revision 2: a detector that reads string literals only → the same test red on each template-literal, `+`-join, glob-`base`, `#` and non-literal fixture ("expected [] to include 'import-outside-src'") | LS1 |
| `test` (committed cast; revision 2) | a scratch speaker `keeper` in `story/cast.json` and in both committed name tables on LS1 commit 7's tree → `invariant: speaker keeper has a name` from `emitFixture()`, `loc/missing-name` for `keeper` in `locales.test.ts` and the `build.test.ts` `repoFiles()` CLI cases, the two exact cast pins (`tags.test.ts`, `lint.test.ts`) red; the same probe on commit 8's tree → `test` exit 0 | LS1 |
| `build` budget | a 30 KB cover; a story whose first chapter's first-load row exceeds 800 KB (synthetic) | L5 |
| server startup | a fixture index with a paid first chapter → `StartupError::Content`; an index file removed → the same | L6b |
| schema | `saves_story_id_shape` removed → `schema_saves_story_id_shape` red; `stat_events_event_key` removed → `stats_event_replay_counts_once` red | LS2, LS3 (tester mutations) |
| stats trust | the entitlement check removed → `stats_paid_ending_needs_entitlement` red; the read counting rows instead of distinct facts → `stats_endings_x_of_y` red (changed by META-PLAN: `stats_endings_reached_distinct`) | LS3 (tester mutations) |
| reporter | ids regenerated per attempt → `reporter: retried batch keeps event ids` red | LS4 (tester mutation) |
| e2e | saves keyed without the story in a scratch tree → `stories: saves are per story` red | L15 |

---

## Demo content outline

**Story A `manor`** (cast `ally`, `stranger`, `voice`; lane N1): ch1 free and ch2 paid as in PZ "Demo content
outline". Changed by this design: ch2's `archive_after` diverts on `pz_cabinet` to one of two ending knots, each with
`-> END` and declared in `story/stories.json`:
- `archive_truth` (cabinet solved) → ending `truth`;
- `archive_ashes` (failed or abandoned) → ending `ashes`.

Story title and teaser in `story.json` (ru, en). Cover `cover/manor`.

**Story B `tide`** (lane N2; a placeholder premise, Q1: a lighthouse on a stormy coast). New cast: `keeper` (sprite
`char/keeper/{neutral,worried,smile}`), `radio` (a voice, no sprite). No world, no puzzles: it proves a story without
the puzzle layer.
- **ch3 (free), about 3 minutes:** knots `shore` (arrival; a choice: wade to the rocks / climb to the lighthouse),
  `shore_drowned` (the bad end: `-> END`, declared ending `drowned`), `lighthouse` (the keeper; a choice that sets
  `g_tide_trust_keeper`), `lighthouse_stairs` (`-> END`: the chapter end; the next chapter is paid → paywall).
- **ch4 (paid), about 2 minutes:** knots `lamp` (reacts to `g_tide_trust_keeper`; the radio speaks), `lamp_dawn`
  (`-> END`, declared ending `dawn`).
- `globals.ink` gains `VAR g_tide_trust_keeper = 0`.
- Every line and choice with an ID; en tables `story/locales/en/{ch3,ch4}.json`; names `keeper`, `radio`; chapter
  titles ch3, ch4 (≤ 32 characters: the ch4 title is the invoice title); story title and teaser.

**Catalog additions** (L5; the writers stay within them): bg `shore`, `lighthouse` (ch3) and `lamp_room` (ch4 only →
paid tier); char `keeper` with `neutral`, `worried`, `smile`; bgm `waves` (ch3) and `storm` (ch4 only → paid tier);
covers `cover/manor`, `cover/tide`.

Totals: 2 stories, 4 chapters (2 free, 2 paid), 4 endings (`truth`, `ashes`, `drowned`, `dawn`).

---

## Open questions

### Engineering (for the orchestrator) — each with a recommendation

| # | Question | Recommendation |
|---|---|---|
| SQ1 | The server requires the generated `server/content/stories.json` from L6b on, and only LS1 emits it: `server-dev` cannot start on generated content between the L6b and LS1 merges | Approve: L7 (the first e2e lane) gates on LS1; L6b, LS2 and L6c (and L8a / L8b if LS1 is still open) prove seen-working by test names, and their live `server-dev` checks move to L7's e2e or to L15, as PZ moved L6c's |
| SQ2 | LS1 reopens frozen files: `lint.ts` (one `LINT_CODES` line), `dsl-doc.test.ts` (the count), STAGING-DSL §4/§8/§9/§11 (RULINGS 13 PE3); revision 2 (W1): also `tags.test.ts` (the cast assertion of `catalog: demo catalog and cast decode`) and `lint.test.ts` (the clean control of `lint: catalog/assets red on fixture (cast char missing)`), one hunk each in LS1 commit 8, which brings the LS1 lock to 17 files | Approve for LS1 only, then frozen again; the DSL version line stays v2 (Y18). The two test hunks change inputs only (an inline cast), no expected value. Revision 3: decided together with SQ9 (L5's `tags.test.ts` hunk) |
| SQ3 | LS2 rewrites `0001` after LDB1; a local `tgn_local` that applied the old file must be reset | Approve the rule "rewrite until the first deployment, append-only after" (Y7); LS2 quotes the sqlx refusal and the `pgdev reset` remedy; D2's `local-dev` runbook records it |
| SQ4 | LS3 runs before L9 (PP's server order L8b → L9 changes), and LDB2 (RULINGS 17) at the end of the server chain | Approve: LS3 then L9 keeps LS4 off the critical path; LDB2 has no dependant, so it takes the server slot after L9 unless the slot idles earlier |
| SQ5 | RULINGS 21's errata cite PP and PZ by line | PZ: every PZ edit of this revision before line 1878 is an in-place single-line edit, so PZ:652–1877 are unchanged (as of `66c92c4`; PUZZLES-PLAN revision 9 applied the errata and moved them). PP lines move: re-locate the PP errata by their quoted text (the LW2 entry offset is in the design log) |
| SQ6 | L3c's C4 changes shape (`carries` tagged with the ended knot) | Approve as a C4 detail (one field, one test); C1 and C2 stand |
| SQ7 | verify: sqlx 0.9 binds `Vec<Option<String>>` as a nullable `text[]` for `UNNEST` | LS3 commit 2's red proves it; if it does not, the insert becomes ≤ 32 statements in one transaction (≤ 32 round trips; the batch max drops to 8 on a remote DB) |
| SQ8 | PP's lane rule text says "at most 2 lanes"; RULINGS 18 made it 3 | Updated in PP in this revision |
| SQ9 (revision 3, W2) | L5 reopens the frozen `tags.test.ts` (RULINGS 13 PE3) for one hunk. `catalog: demo catalog and cast decode` pins the committed catalog keys exactly (:450-458 at main `a7e4a04`), and L5's catalog additions (PUZZLES-PLAN's and this design's) break those pins. L5 runs before LS1, so LS1 cannot take it. This brings the L5 lock to 14 files | Approve for L5 only, decided together with SQ2, then frozen again. The pins become subset pins: the decoded keys, restricted to the L3a keys, equal them (PP "L5", the revision-3 bullet). A removed or renamed demo id still fails, and no later asset addition reopens the file. The line both hunks read (:448) and LS1 commit 8's cast hunk (:459-462) are not touched |

### VALUES / SCOPE (for the owner — the orchestrator records them in docs/OPEN-QUESTIONS.md)

| # | Question | Default in the design |
|---|---|---|
| Q22 (open) | Which statistics to show, and where | Foundation only (this design): no screen; `GET /api/stats` answers endings and chapters X of Y. Changed by META-PLAN: the completion card per story (own statistics, found endings by title, achievements; M9); endings have no Y in the API (M8); other screens and community numbers stay open |
| Q23 (RESOLVED 2026-10-31 by META-PLAN M24–M26) | Statistics retention, lawful basis, privacy-policy text (Telegram terms §4; GDPR; 152-FZ — with Q21) | Keep events with no deletion job; erasure designed, not built; policy text before production (owner + lawyer). Ruling: the inventory and lawful bases per item, the policy draft (RU then EN, placeholders for the operator facts, `GET /api/privacy`), consents versioned, erasure a Later lane before production; the operator facts and the lawyer review stay with the owner (META-PLAN MV12, MV13) |
| Q24 (RESOLVED 2026-10-31 by META-PLAN M1) | Capture choice events from day one (for a later "X % chose this")? | Off: not captured (minimisation); the metric can only start when capture starts. Ruling: captured — `choice_made`, the option's line ID only; the aggregate is Later |
| Q25 (RESOLVED 2026-10-31 by META-PLAN M7, M8) | May the number of endings (and later their titles) be shown before a story is bought? | Names never public before reached; the count is returned by `/api/stats` but shown nowhere yet. Ruling: no count anywhere (`endingsTotal` removed); the card shows only found endings, and a paid one's title only with the chapter's entitlement; a friend's counts stay visible (META-PLAN MV17) |
| Q1 (story) | Story B's premise, cast names and length | Placeholder `tide`: a lighthouse keeper, about 5 minutes in two chapters |
| Q2 (art) | Cover art direction | Generated placeholder covers, 360×640 |
| Q3 (prices) | Prices of later chapters per story | One default `1` Star for every paid chapter (PLACEHOLDER), per-chapter overrides possible |
| — (minor) | Story order on Home | The `stories.json` order (`manor`, then `tide`) |

---

## Readiness checklist

- [x] Goal names correctness targets (ST1–ST8) and budgets; every decision (Y1–Y19) has why / alternatives /
  trade-off.
- [x] TS and Rust types for every new JSON, one source of truth per seam: `stories.json` → TS decoder; public catalog
  and metas → TS decoders; server story index → TS producer + Rust consumer + one committed fixture; HTTP → Rust DTOs
  via ts-rs. SQL: a named constraint per invariant (`saves_pkey`, `saves_story_id_shape`, `stat_events_event_key`,
  `stat_events_subject_by_kind`, `stat_events_kind_known`, shapes, `stat_events_age_bounded`); every endpoint states
  auth, errors, idempotency, Cache-Control.
- [x] No new tag; the DSL doc change, its one lint code and the owning lane (LS1) are specified; one parser
  (unchanged); scene and overlay never read story state (events come from GameSession); every new line has an ID
  (N2).
- [x] Grant only on `successful_payment` via the charge-id insert (unchanged); refund revokes (unchanged); products
  derived from the index; pre-checkout untouched; paid metas and paid ending names only behind the entitlement check;
  the emit tests prove their absence from the story tool's client outputs and `arch: import-outside-src` keeps
  `story/` and `server/content/` out of the bundle's module graph (with PP's `scan-dist` for paid chapter JSON and
  art); revision 2: the rule judges every form by what Vite pulls in (literal, template head, glob `base`) and
  refuses the rest.
- [x] Audio unlock in the Home button gestures; BackButton for ChapterSelect only; `deactivated` flushes stats; no
  Service Worker, `window.open` or `alert`; SDK use unchanged (DeviceStorage through the facade).
- [x] No new Pixi texture (covers are DOM, 360×640); render resolution unchanged; story exit releases every holder;
  memory estimated (+2.6 MiB worst case).
- [x] Duplicate events, double tap, reload, token expiry, story update, context loss: outcomes in the failure table.
- [x] Red-first per commit (PP lane cut); test names above; budget rows the build gate enforces; each new gate seen
  failing (table above).

---

## Revision log

| Rev | Date | Source | Summary |
|---|---|---|---|
| 0 | 2026-10-31 | architect round 1 (RULINGS 20; spec `D:/tmp/novel-orch/design/stories/spec.md`) | Initial design: Y1–Y19; PROTOTYPE-PLAN revision 11 and PUZZLES-PLAN revision 7 mark the changed items and re-cut the lanes. Design log: `D:/tmp/novel-orch/design/stories/design_log.md` |
| 1 | 2026-10-31 | `D:/tmp/novel-orch/design/stories/triage_r1.md` (critique `design/stories/critique_r1.md`) | The 5 confirmed items W1–W5 resolved (W3 part 2 as narrowed by the triage), with PROTOTYPE-PLAN revision 12 and PUZZLES-PLAN revision 8. Optional O1–O8 and the critique's open questions noted, not folded in; the triage's side observation (LDB1 "running") not touched. Pre-revision copies: `design/stories/STORIES-PLAN.r1.before.md`, `PROTOTYPE-PLAN.r1.before.md`, `PUZZLES-PLAN.r1.before.md`. Per-item detail with the removed and added text: `D:/tmp/novel-orch/design/stories/revision_r1.md` |
| 2 | 2026-10-31 | `D:/tmp/novel-orch/design/stories/triage_r2.md` (critique `design/stories/critique_r2.md`) | The 3 confirmed items W1–W3 resolved, with PROTOTYPE-PLAN revision 13; PUZZLES-PLAN unchanged. Optional O1–O3, the critique's open questions and the triage's side observation (the catalog-key pins of `tags.test.ts`) noted, not folded in. Pre-revision copies: `design/stories/STORIES-PLAN.r2.before.md`, `PROTOTYPE-PLAN.r2.before.md`, `PUZZLES-PLAN.r2.before.md`. Per-item detail with the removed and added text: `D:/tmp/novel-orch/design/stories/revision_r2.md` |
| 3 | 2026-10-31 | `D:/tmp/novel-orch/design/stories/triage_r3.md` (critique `design/stories/critique_r3.md`) | The 2 confirmed items W1 and W2 resolved, with PROTOTYPE-PLAN revision 14; PUZZLES-PLAN unchanged. Optional O1–O3 and the critique's open question 1 noted, not folded in. Pre-revision copies: `design/stories/STORIES-PLAN.r3.before.md`, `PROTOTYPE-PLAN.r3.before.md`, `PUZZLES-PLAN.r3.before.md`. Per-item detail with the removed and added text: `D:/tmp/novel-orch/design/stories/revision_r3.md` |
| 4 | 2026-10-31 | `D:/tmp/novel-orch/design/stories/triage_r4.md` (critique `design/stories/critique_r4.md`) | The 1 confirmed item W1 resolved, with PROTOTYPE-PLAN revision 15; PUZZLES-PLAN unchanged. Optional O1–O4 and the critique's open question 1 noted, not folded in. Pre-revision copies: `design/stories/STORIES-PLAN.r4.before.md`, `PROTOTYPE-PLAN.r4.before.md`, `PUZZLES-PLAN.r4.before.md`. Per-item detail with the removed and added text: `D:/tmp/novel-orch/design/stories/revision_r4.md` |
| 5 | 2026-10-31 | RULINGS 22, 23 (as merged: LDB1 `fee9da7`, LDB2 `a7e4a04`, this design `66c92c4`) | Docs lane `docs-errata`, group C (not a triage round): "Implementation plan" — "Running and merged lanes" marked as of `66c92c4` (LDB1 and LDB2 merged, L3c resumed on `f1a46ea`, L6b running) and "Order" without LDB1 and LDB2, the critical path from L6b; with PROTOTYPE-PLAN revision 18. Review round 1: SQ5's "PZ:652–1877 are unchanged" marked as of `66c92c4` (PUZZLES-PLAN revision 9 moved them). Ledger: `D:/tmp/novel-orch/docs-errata/ledger.md` |
| 6 | 2026-10-31 | the META-PLAN campaign spec + RULINGS 25 | Extended by [META-PLAN.md](META-PLAN.md): choice capture (`choice_made`), `endingsTotal` removed, hint products removed, privacy designed. Changed items marked "Changed by META-PLAN": Goal (the "X of Y" sentence; ST5, ST6); Y9; Y10; Y12; Y14; Y16; Y17; Identifiers; the `catalog.json` server format; the TS and Rust stats types; the SQL `0003` note; HTTP API; F12; test names and the seen-red row; Open questions (Q22 note; Q23, Q24, Q25 resolved). Design log: `D:/tmp/novel-orch/design/choices/design_log.md` |
| 7 | 2026-10-31 | META-PLAN revision 1 (`D:/tmp/novel-orch/design/choices/triage_r1.md`, item W2) | Choice events no longer crowd facts out: Y11 counts facts and choices apart (facts 600/h with the 429; choices 600/h of their own, never a 429, repeat picks beyond it rejected `rate_limited`, first picks always recorded); Y13 evicts choices first and sends facts first; the stats constants, F11, the concurrency table, Budgets and Test strategy follow. Marked "Changed by META-PLAN revision 1". Pre-revision copy: `D:/tmp/novel-orch/design/choices/STORIES-PLAN.r1.before.md` |
| 8 | 2026-11-01 | `D:/tmp/novel-orch/carry.md` at ORCH `d97ba64` (the docs-errata-2 spec, group A), as merged on main `6043941` | Docs lane `docs-errata-2`, group A (not a triage round): LS1 (`64fd798`) — rule 8's `next` clause, `checkEndings(…, sources)`, the seeded leak seen in C7; LS3 (`00d7c10`) — at most 4 statements, the overshoot up to one batch per concurrent request, choices never a 429 (O1), `StatKind` / `StatOutcome` in `db/stats.rs`, the `IS NOT NULL` guards, `private, no-store`, the per-event `unknown_choice`, the `record_events` budgets. Ledger: `D:/tmp/novel-orch/docs-errata-2/ledger.md` |

**Revision 1 (2026-10-31)** — what changed, by triage item:
- **W1** (LS1 moved merged test pins it did not declare; commit 6 left the real-tree `story` gate red): PP "LS1" —
  the commits reordered to 1 DSL, 2 `decodeStories`, 3 `checkEndings` / `checkInvoiceTitles`, 4 `locales.ts` (empty
  `stories` / `teasers` sections committed), 5 the arch rule (W4), 6 `story.ts` together with the skeleton
  `story/stories.json`, `manor`'s title and teaser and the inline `repoFiles()` fixture (the commit that makes the file
  mandatory), 7 `emit.ts` + `catalog.ts`; commit 7 names the five moved `build.test.ts` pins old → new (the triage's
  four plus `emit: free and paid outputs are routed apart`, whose exact plan-key list also gains
  `server/content/stories.json`); every commit quotes its gates green on its own tree; the gate note "commit 4's red"
  → "commit 7's red"; the Gates line. This file: Test strategy (LS1 row: the moved pins).
- **W2** (N2's commit order could not pass the story gate): PP "N2" — two commits, each with the cast, names and
  titles its chapters and story need (`keeper`, ch3 and `tide`'s title and teaser with ch3; `radio` and ch4's title
  with ch4), each quoting `story` and `build` exit 0. This file: Implementation plan (N2: 2 commits).
- **W3** (the chapter-boundary events lost the free chapter → paywall funnel): option (a) of the triage, no
  `chapter_completed` at a declared ending's END; `chapter_started` for every runner created from a `fresh` start
  point (a new game, a chapter change, resume steps 2 and 5), never an exact or checkpoint resume. The SQL CHECK, the
  DTOs and the reporter are unchanged (0 client bytes). Sections: Y9 (What, Why), F1′, F4′, F12 (`chaptersCompleted` also
  counts the chapter of a reached ending, so `GET /api/stats` answers as in revision 0), Test strategy (L15, LS3
  rows); PP F4′ note and the lanes L15 (commit 1: the rule, the renamed `game: exact or checkpoint resume does not
  report chapter start`, the reds `game: declared ending end is distinguishable from chapter end` and `game: pending
  chapter start reports chapter start`) and LS3 (commit 4: `stats_ending_completes_its_chapter`).
- **W4** (ST1's "any client build output" was gated for `story-gen` only): a gate, not a narrowed claim — the arch
  rule `import-outside-src` (LS1 commit 5): no non-test `client/src` module references a file outside `client/src/`,
  so neither `story/stories.json` nor a paid meta under `server/content/` can enter the bundle. ST1 now states what
  its gates prove (the story tool's client outputs and the client bundle). Sections: Goal (ST1), Implementation plan
  (LS1 row, collision locks), Test strategy (LS1 row), the seen-red table (arch row), the readiness checklist; PP
  "Arch test rules", the `arch.test.ts` collision chain (L1 → LW2 → LS1 → LP2) and the LS1 lock (`arch.test.ts`;
  13 listed files + 1 = 14, the stated count).
- **W5** (`exitToStories()` did not dispose the exploration, puzzle and purchase sessions): the exit's order is the
  open `PuzzleSession` and `PurchaseFlow` first, then the autosave, then the `ExploreController`, then runner, scene,
  audio, saves, flush. Sections: Module API (`exitToStories`), the failure table (a new row), Resource lifetime
  (three rows), Integration (the PZ row), Test strategy (L15 row); PP `Game` comment and L15 commit 1 (red `game:
  exit to stories disposes explore, puzzle and purchase sessions`); PZ "Resource lifetime" (two in-place rows) and
  "Changed by STORIES-PLAN".
- **Not touched:** O1–O8 (O5's text-accuracy points included, apart from the LS1 file count that the W4 lock edit makes
  true), the critique's open questions 1–4, the side observation on LDB1 (merged at `fee9da7`, RULINGS 22). Not
  edited: `docs/STAGING-DSL.md`.

**Revision 2 (2026-10-31)** — what changed, by triage item:
- **W1** (N2 commit 1 adding `keeper` to the committed `story/cast.json` turned `test` red: `emitFixture()` threw
  `invariant: speaker keeper has a name`, the `repoFiles()` CLI cases gained `loc/missing-name`, and two frozen tests
  pinned the three-speaker cast; N2's per-commit proof ran no vitest): LS1, which runs before N2 and already holds
  `build.test.ts`, owns the fix as a new commit 8. Each tool test file takes one inline raw cast decoded against the
  committed asset catalog: `build.test.ts` (`committed()`, `emitFixture()`, `repoFiles()`), L3c's `locales.test.ts`
  (the same coupling, `committed()` and `repoFiles()`, not traced by the triage), and one hunk each in the frozen
  `tags.test.ts` and `lint.test.ts`, reopened SQ2-style. No expected value moves. Proof: a scratch speaker `keeper`
  in the cast and both committed name tables, `test` red on commit 7's tree as predicted and green on commit 8's.
  N2's per-commit proof gains `test`; LS1 commit 6's sentence now says only the stories fixture is inline there and
  the asset catalog is still read from the tree. Sections: Context (RULINGS 13 PE3), Y19 (Why: the LS1 size),
  Implementation plan (LS1 row: 17 files, 8 commits; collision locks), the seen-red table (a new `test` row), SQ2; PP
  the frozen-file and `locales.test.ts` collision locks, LS1 (lock, commit 6, commit 8, Gates), LW3 (the
  serialized-files note) and N2 (commits).
- **W2** (`import-outside-src` read string literals only, so a template-literal `import()` or `new URL` and a glob
  `base` outside `src/` passed it, though Vite 8.3.5 bundles them): the rule judges every form by the files Vite can
  pull in from it. Template-literal and `+`-joined `import()` and template-literal `new URL(…, import.meta.url)` are
  judged by the glob Vite derives (static head under `src/`, no `..` after the first wildcard); glob patterns resolve
  against `base` as `toAbsoluteGlob` does; `#` specifiers and every form it cannot read are flagged. Six red and two
  allow fixtures; a second red with a literal-only detector. Sections: Goal (ST1), the seen-red arch row, the
  readiness checklist; PP "Arch test rules" and LS1 commit 5 (the reader `importOrigins`, the fixtures, the red, the
  real-tree search).
- **W3** (the fixture's paid ending `end` occurs in every free output: the meta key `"ending"` and ink's `"end"`
  control string): the fixture ending is `q7_sealed_vault`; `emit: paid endings only in server outputs` keeps its
  substring claim and gains the control that the name occurs in the ch2 server meta. The committed skeleton's `end`
  on `archive` stays. Sections: PP LS1 commit 6 (the inline fixture) and commit 7 (the red's detail, the moved pin
  `endings: { drawer: 'q7_sealed_vault' }`).
- **Not touched:** O1–O3; the critique's open questions 1–2; the triage's side observation (`tags.test.ts:448-458`
  pins the committed catalog keys exactly, so L5's catalog commit turns `test` red in the same way; L5 runs before
  LS1, so it is L5's cut to take, see `revision_r2.md`). PUZZLES-PLAN is not edited. Not edited:
  `docs/STAGING-DSL.md`.
  - **Resolved in revision 3 (W2):** the plan, not the L5 cut, now gives L5 that hunk (SQ9; PP "L5").

**Revision 3 (2026-10-31)** — what changed, by triage item:
- **W1** (LS1 commit 6 made `story/stories.json` mandatory, but only `build.test.ts`'s `repoFiles()` got the inline
  stories file. L3c's `locales.test.ts` has its own temp-repo helper, and its C3 test 19
  `story: catalog names come from the locale tables` needs an emitting run. From commit 6 on, that run exits 1 and
  writes no `catalog.json`, so the commit's declared green was false. The lock note also scoped `locales.test.ts`
  to commit 8 only):
  - commit 6 gives `locales.test.ts`'s `repoFiles()` an inline `story/stories.json` (`manor`, first `ch1`, cover
    `cover/manor`, `endings: {}`). The story's title and teaser go into the ru and en name tables of that temp repo,
    not into the `NAMES_RU` / `NAMES_EN` constants that the `locales()` unit helper reads;
  - commit 6 gains a red: without the hunk, test 19 fails with ENOENT on the temp repo's `catalog.json`;
  - commit 6's real-tree line names both helpers;
  - the two new inputs are decided required: `LocaleInput`'s story ids (commit 4) and `planEmit`'s story plans
    (commit 7). Every field of both seams is required today, and L3c's own `en` input follows that rule. An
    optional field would let a caller drop the story-title check or the story index with no compile error;
  - commit 4 therefore passes `[]` from `story.ts` and from the `locales()` helper, and commit 7 gives C5 test 35's
    `planEmit` call the one-story plan. No assertion value moves;
    - **Corrected in revision 4 (W1):** one value does move. Commit 7 gives `StoryNames` the story titles and
      teasers, so L3c's `locales: matching tables raise nothing` (`locales.test.ts:291-298`) gains `stories: {}`
      and `teasers: {}` in `r.names`. PP LS1 commit 7 declares that move;
  - the lock note names commits 4, 6, 7 and 8 for `locales.test.ts`. The lock stays at 17 files;
  - this also settles round-2 O1 (critique r2), the field the triage names as the condition.

  Sections: PP "LS1" (lock note, commits 4, 6 and 7), PP revision log (row 14).
- **W2** (L5 adds keys to `assets/catalog.json`, and the frozen `tags.test.ts` pins the committed catalog keys
  exactly at :450-458, so L5's catalog commit turns `test` red, and no lane text gave L5 the file):
  - `tags.test.ts` reopens for L5, one hunk (SQ9, decided with SQ2): the six key pins of
    `catalog: demo catalog and cast decode` become subset pins (the decoded keys restricted to the L3a keys
    `toEqual` them), in the L5 commit that first adds a key;
  - rejected: an inline catalog fixture. It would change the `catalog` const (:448) that LS1 commit 8's cast hunk
    also reads, and it would drop the committed-catalog check;
  - L5 gets a red-first (`expected [ 'archive', 'cafe', 'cellar', 'hall', 'lamp_room', 'lighthouse', 'room',
    'shore', 'street', 'study' ] to deeply equal [ 'archive', 'cafe', 'room', 'street' ]`; the first failing pin
    ends the test) and a seen-failing scratch for the subset pin (`bg.room` deleted);
  - the L5 lock goes 13 → 14;
  - LS1 commit 8's hunk (:459-462) stays disjoint.

  Sections: Context (RULINGS 13 PE3), Implementation plan (the re-cut row, collision locks), SQ2, SQ9 (new), the
  Revision 2 block (its side observation marked resolved). PP:
  the frozen-file bullet, the dependency-order row of L5, "L5" (the lock, the STORIES re-cut header, a new last
  bullet), LS1 commit 8 (the pins note).
- **Not touched:** O1–O3 of the round-3 triage (the probe's predicted text for the `build.test.ts` CLI cases, the
  `+`-join fixture missing from the fixture list, the `new URL` opaque scope); the critique's open question 1.
  PUZZLES-PLAN is not edited. Not edited: `docs/STAGING-DSL.md`.

**Revision 4 (2026-10-31)** — what changed, by triage item:
- **W1** (the story titles and teasers reach `planEmit` through `names`, the `StoryNames` that `checkLocales`
  returns, but `StoryNames` had only `chapters` and `speakers`. Once `nameChecks` adds a story section, L3c's pin
  `locales: matching tables raise nothing` (`locales.test.ts:291-298`, an exact `toEqual` on `r.names`) gains an
  extra `{}`-valued key and fails, a move no list declared; revision 3 said no assertion value moves):
  - decision: the triage's option (a). `StoryNames` gains `stories` and `teasers`, each
    `Record<StoryId, { ru: string; en: string }>`, in LS1 commit 7, where `emit.ts` first reads them (the public
    `StoryEntry.title` / `teaser`, the server index's story `title`). `locales.ts` `nameChecks` fills them for the
    `LocaleInput.stories` ids with the lookups commit 4 added for the check, so `checkLocales` stays the one reader of
    the name tables. A story without a title or a teaser is an emit invariant, as a chapter title is;
  - the moved pin, declared in PP LS1 commit 7 (its own bullet and the moved-on-purpose list, now six) and in the
    lock note (commit 7 has two `locales.test.ts` hunks): `r.names` gains `stories: {}` and `teasers: {}`, because
    the `locales()` helper passes `stories: []`. Red-first: commit 7 without that hunk, keyed on the diff lines
    `+   "stories": {},` and `+   "teasers": {},` (vitest truncates the message line);
  - the inputs that gain the keys, with no assertion: `NAMES` of `build.test.ts` (an `as StoryNames` cast, so a
    missing key would only surface as the emit invariant), test 35's names, and the `StoryNames` literals of
    `stories.test.ts`;
  - commit 4 only requires the titles and teasers; `nameChecks` keeps its two output keys until commit 7. Its red
    `loc: story title and teaser required` lives in `stories.test.ts`, on its own `LocaleInput` (the triage's
    optional precision note);
  - rejected: (b), a separate `checkLocales` result field merged into `EmitInput.names` in `story.ts` (one fact in
    two values, a second null rule); filling the sections in commit 4 (two sections no reader uses for three
    commits).

  Sections: TS types (the `StoryNames` line in the build-only block), Test strategy (LS1 row: the sixth moved pin),
  the Revision 3 block (W1, "Corrected in revision 4"); PP "LS1" (lock note, commits 4 and 7, the moved list, Gates),
  PP status line and revision log (row 15).
- **Not touched:** O1–O4 of the round-4 triage (L5's first catalog commit, the truncated-message form, test 19's
  first failing assertion, the `angry` expression mutation); the critique's open question 1 (test 19 at LS1
  commit 7, for the LS1 cut). PUZZLES-PLAN is not edited. Not edited: `docs/STAGING-DSL.md`.
