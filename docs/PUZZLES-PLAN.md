# Architecture: puzzles, exploration, inventory and paid hints

Status: design extension of [PROTOTYPE-PLAN.md](PROTOTYPE-PLAN.md) (architect round 1, 2026-10-30; RULINGS 10;
revision 8 — see [Revision log](#revision-log); extended by [STORIES-PLAN.md](STORIES-PLAN.md): see "Changed by STORIES-PLAN").
Scope: `D:/tmp/novel-orch/design/puzzles/spec.md`. Inputs: RULINGS 1–10; research P1–P4
(`D:/tmp/novel-orch/design/puzzles/research_P*.md`) and R1–R4; the tree at `0aef72e` (L1, L2, L4a merged) plus the
running L3a worktree (`client/src/story/{staging,catalog}.ts`).

Labels:
- **[P1]–[P4]**, **[R1]–[R4]**: research reports (verified facts).
- **PP:** a section of PROTOTYPE-PLAN.md (by name; line numbers drift).
- **verify:** a fact not yet confirmed; the named lane confirms it with a red-first test before relying on it.
- Decisions are **X1–X18** (K1–K30 stay PROTOTYPE-PLAN's). Every PP decision this design changes is marked there
  "changed by PUZZLES-PLAN".

---

## Goal

The owner's game is a visual novel with Resident Evil / Silent Hill puzzles (RULINGS 10). The prototype proves, end
to end, locally against the mock Telegram environment:

1. **Exploration.** In chapter 1 the story hands control to a small room graph. Each room is one 2D picture with
   tappable hotspots. The player moves by tapping doors, backtracks freely, picks up items and documents, inserts
   three found medallions into a gate, then solves a puzzle to open it. Story scenes fire on entering a room, taking
   an item, opening a lock (a door) or on a puzzle failure, and control returns to the rooms.
2. **Puzzles.** Two RE/SH-style types: a digit **code lock** and an **order** puzzle (arrange pieces into slots).
   A puzzle instance is data; a type is a lazy code module.
3. **Hints for Stars.** A per-puzzle ladder of up to three hints; each tier is bought with (mock) Stars.
4. **Branching.** Solved / failed / abandoned and the hint count reach the story and branch it. Failure is never a
   dead end.
5. **Resume.** A reload inside exploration resumes in the same room with the same inventory.

**Correctness targets** (each is a gate, not a review item; numbering continues PP's T1–T6):

| # | Target | Proved by |
|---|---|---|
| T7 | No hint text, hint line ID or puzzle solution in `client/dist/` or any public route; no paid chapter's world text or world line ID there either; hint text is served only to its unlock owner | `scan-dist` hint and paid-world fingerprints built from the sources, not from the emitter (`scan: hint text in dist fails`, `scan: paid world text in dist fails`); `emit: public world has no solution or hint fields`; `puzzle_hint_text_only_when_owned` |
| T8 | A hint tier is granted only on `successful_payment`, once per `telegram_payment_charge_id`; a refund revokes it; no tier is sold out of order, after the puzzle is solved, or for a paid chapter the user does not own | `hint_purchase_duplicate_concurrent_grants_once`, `precheckout_hint_*`, `invoice_hint_*`, `refund_revokes_hint` |
| T9 | No soft-lock: from every reachable exploration state some story exit is reachable; every event knot returns to its section | `world/softlock` (a model checker over the runtime reducer, per section); `lint: world/puzzle-multi-lock red on fixture` (revision 5: a puzzle on two locks strands a section the per-section checker proved); `lint: world/cross-section-exit red on fixture` (revision 6: a room→room exit into another section strands the player in a room no per-section search expands); `play/event-no-return` |
| T10 | One-way staging survives: puzzle and exploration UIs never read ink state; the host writes ink variables only at a yield, only declared ones | arch rules; `runner: enter rejects undeclared projection var`; `runner: enter outside a yield is an error` |
| T11 | A save restores the start of the open puzzle and the exact exploration state; a story update never throws on a world save and never leaves a state with no reachable story exit | `resume: exact at a yield re-yields`, `reconcile: unknown ids dropped`, `reconcile: renamed held item keeps the section exitable`, `reconcile: a dead end reachable from the reconciled state restarts the section`, `reconcile: reset section fires the start room's onEnter on resume`, `reconcile: a section left through a leave restarts on re-entry after a version change`, `reconcile: a version change marks every other section unproved and keeps the current section and room`, `controller: enter admits an unproved section`, `lint: world/cross-section-effect red on fixture`, `lint: world/puzzle-multi-lock red on fixture`, `lint: world/cross-section-exit red on fixture`, `softlock: section above RESUME_STATE_CAP fails the build`, e2e `explore: reload resumes in the same room with items` |

**Budget targets:** mini-game code is lazy (0 bytes added to the entry closure; the before-first-line JS stays
≤ 270 KB brotli); each puzzle type chunk ≤ 8 KB br; live textures while exploring ≤ 32 MiB (computed below:
29.3 MiB with two neighbours preloaded); world JSON ≤ 32 KB raw per chapter.

---

## Context and constraints

- **Principles at stake:**
  - 0 — hint text and solutions are paid content: server-only build output, entitlement-checked delivery,
    fingerprinted.
  - 1 — the server is the only writer of hint unlocks and of "solved" for money decisions. World progress (items,
    rooms) is save state: the server stores it and the client never unlocks anything paid from it.
  - 2 — a hint is a Stars product on the existing order → pre-checkout → `successful_payment` → refund chain.
  - 4 — rooms are 1080×2048 backgrounds (8.4 MiB decoded each); preload stays under the 32 MiB steady cap.
  - 5 — BackButton, no `history`, gesture rules, `deactivated`.
  - 6 — no new library: everything is our TS and Rust.
  - 7 — one-way staging, with one controlled outcome channel (X2).
  - 8 — every player-facing world text (hotspot labels, documents, puzzle prompts, hints) carries a line ID.
- **Rulings:** RULINGS 6 (PP is the source design), 8 (rolling schedule), 9 Q2 (`ids.rs` additions are
  orchestrator-approved), 10 (puzzles + exploration in the prototype).
- **Fixed by running or merged lanes** (L1, L2, L3a, L4a keep their scope):
  - DSL v1 (STAGING-DSL §10) forbids EXTERNAL, LIST, tunnels, threads, `-> DONE` and variable diverts. Every knot is
    entered at its top (`graph/entry-below-top`).
  - `parseTags(tags, assets)` is the one parser (L3a).
  - `decodeAssetCatalog` accepts exactly the namespaces `bg, chars, cg, bgm, sfx` (L3a `catalog.ts`).
  - `0001_init.sql` is applied: `entitlements` is "the ONLY unlock fact", PK `(user_id, product_id)`.
  - `AppState` is `#[non_exhaustive]`, built only by `AppState::new`.
  - `error.rs`: the `match` has no wildcard, so a new variant does not compile until it is mapped.
  - `db/mod.rs`: `migrate!` embeds the files, and "a NEW file needs a build script".
- **Platform facts that shape the design:**
  - ink lookahead runs past the returned line. Conditional choices are evaluated when generated, never again [P2 §1].
    A new tag after a newline counts as `ExtendedBeyondNewline`, so the snapshot is restored (inkjs 2.4.0
    `CalculateNewlineOutputStateChange` takes `prevTagCount` / `currTagCount`; read 2026-10-30).
  - `-> DONE` in the top-level flow sets `didSafeExit` and a null pointer: the story stops without the "ran out of
    content" error (inkjs 2.4.0 `PerformLogicAndFlowControl`; `canContinue === false` is inferred, verify: L13).
  - `ChoosePathString` → `ChoosePath` only moves the pointer (`SetChosenPath` clears `currentChoices`, sets the
    pointer, bumps the turn index) and updates visit counts. A choice condition is evaluated in `ProcessChoice`,
    while `Continue()` steps the content (inkjs 2.4.0 `Story.ts` 1677-1724, 771-777, 915-923; `StoryState.ts`
    1123-1135; read 2026-10-30). A write between `ChoosePathString` and the first `Continue()` is therefore seen by
    the knot's choices; a write after that `Continue()` is not.
  - Writing an undeclared VAR from the host throws [P2 §1].
  - Devtools are a documented feature on every Telegram client [P3 §3a].
  - Telegram has no consumable concept, and `refundStarPayment` refunds a whole charge [P3 §1a].
  - Pixi taps have no movement threshold and Pixi ignores `pointercancel` [P2 §3].
  - Android hardware back closes the app when our BackButton is hidden [R1 §2].

| Concern | iOS WKWebView | Android WebView | Desktop |
|---|---|---|---|
| Hotspot input | DOM buttons; `-webkit-user-select: none`, `-webkit-touch-callout: none`; no long-press features [P2 §3] | DOM buttons; `touch-action: manipulation` | same |
| Back | BackButton only | hardware back = our BackButton when visible, else closes the app | BackButton |
| Decode on door tap | `createImageBitmap` may block the main thread [P2 §6] (verify on device, L15) | non-blocking in Chrome | — |

**Invariants added** (every lane keeps them):
- The host writes ink variables only through `StoryRunner.enter()`, only while the runner is paused at a yield, and
  only declared projection variables.
- No puzzle solution and no hint text exists in any client build output.
- The exploration reducer is pure and shared by the runtime, the soft-lock checker and the seeded playthroughs.
- I-W, per section (X9): in a saved world state, each section's state is one its world version can produce from that
  section's entry, or the section is in `unproved` and is proved before the player can act in it. `reduce` writes every
  step of play. Reconcile keeps a section's changed-version state only after proving it: the current section at load,
  every other section at its next entry (`admitSection`). So T9's build proof covers every state the player can act
  in. I-W rests on one premise, enforced by the story gate: only a section's own actions and triggers write that
  section's state, and every move stays inside its section (X15, `world/cross-section-effect`,
  `world/puzzle-multi-lock`, `world/cross-section-exit`; X9 step 5).

---

## Key decisions

**X1. Ink ↔ host hand-off: a yield block (a tag-only line + `-> DONE`). The host re-enters ink only at a knot top.**
- **What.** Two new tag kinds (DSL v2):
  - `# puzzle: <id> then=<knot>` — run puzzle `<id>`, then continue at `<knot>`.
  - `# explore: <section>` — hand control to the exploration section.

  Either tag stands alone on a tag-only line, and the next source line is `-> DONE`:
  ```ink
  The drawer has four brass dials. #id:ch2.archive.d1al
  # puzzle: cabinet then=archive_after
  -> DONE
  ```
  - **The runner.** It returns a `yield` step when the story stops (`!canContinue`, no choices) with a yield command
    in the last batch.
  - **The host.** It runs the puzzle or the rooms. It comes back only through
    `StoryRunner.enter(knot, projection)`, which writes the projection variables and then calls
    `ChoosePathString(knot)`.
  - **Who names the knot.** A puzzle names its `then` knot in the tag. An exploration section names its event and
    exit knots in its data.
- **Why:**
  - The stop is exact. In `Text\n# puzzle…\n-> DONE`, the lookahead after `Text` meets a new tag, so the snapshot is
    restored. The next `Continue()` stops at DONE. No later knot is entered, no choice is generated and no visit
    count moves.
  - `enter()` evaluates the continuation knot from its top after the variables are written. This removes the
    stale-choice trap [P2 §1]: choices are built once, when generated.
  - It keeps K9: every knot is entered at its top; the `then` knot is a static edge named in a literal tag; a
    checkpoint resume (`ChoosePathString`) replays the knot up to the same yield.
  - Saving at a yield is the plain `state.toJson()` of a stopped story.
- **Alternatives:**
  - EXTERNAL — forbidden by DSL v1; it cannot block, and a lookahead-unsafe external is deferred or throws [P2 §1].
  - A tag on a text line plus a host-written VAR plus `Continue()` (P2 option A) — when the continuation starts with
    a choice block, the lookahead generates those choices with the old value and discards the snapshot, so the
    choices are stale and the next knot's visit count is already incremented.
  - Hidden choices (P2 option B) — choice IDs, backlog noise.
  - Rooms as ink knots (P2 table, A) — see X3.
- **Trade-off.** DSL v2 relaxes one ban: `-> DONE` is legal only directly after a yield line (lint `yield/shape`).
  Writers learn a two-line idiom.

**X2. The outcome channel is a projection into declared scalar VARs, written only by `enter()`.**
- **What.** `project(world, state, declared)` derives ink values from the host's world state:

  | VAR | Type | Value |
  |---|---|---|
  | `pz_<puzzle>` | int | 0 none, 1 solved, 2 failed, 3 abandoned |
  | `pz_<puzzle>_hints` | int | hint tiers opened in this run |
  | `it_<item>` | bool | the item was ever obtained |
  | `dc_<doc>` | bool | the document was found |

  - A projection VAR is written only if the chapter declares it (`meta.vars`) with the matching type (lint
    `world/var-type`). `enter()` refuses an undeclared name or a type mismatch with an error value, never a throw.
  - The full projection is written at every re-entry: after a puzzle (`then` knot), before an event knot, and
    before a section exit knot.
- **Why:**
  - Principle 7 stays true. The UIs never read ink. Ink never reads host state except these values, written at
    defined points.
  - Scalars fit K8, K12 and DSL v1 (`checkpoint.vars` holds scalars).
  - The writer sees plain `{ pz_drawer == 1: … }`.
- **Alternatives:**
  - LIST inventory — DSL ban; the origins-after-`LoadJson` bug is still open (ink #763) [P2 §2].
  - Ink VAR flags as the source of truth for items — that makes two writers (ink logic and hotspot taps).
  - `ObserveVariable` — the host reading ink, the reverse direction.
- **Trade-off.**
  - Ink cannot grant items. A `give` tag is Later; in the prototype items come from hotspots and puzzle effects only.
  - Projection names are a convention, so a puzzle id may not end in `_hints` (`world/id-reserved`).

**X3. Exploration is host-owned data plus a pure reducer. Ink holds no room state.**
- **What:**
  - **Data.** `story/<ch>/world.json` holds items, documents, puzzles and exploration sections (room graph,
    hotspots, locks, triggers).
  - **State.** `WorldState`: current room, inventory, filled slots, opened locks, fired triggers, puzzle runs.
  - **The writer.** `reduce(world, state, action) → { state, effects }`, one pure function; it is the only writer.
  - **Owner and storage.** The `ExploreController` owns the state; it is saved in `SaveBodyV1.world`.
  - **Story scenes.** They are ordinary ink knots, named by effects (`{ "story": "<knot>" }`) and entered through
    `enter()`. Each ends with its own `# explore: <section>` yield block, which hands control back.
- **Why:**
  - Free backtracking among N rooms as ink diverts needs a hub per room and a static divert per exit. "Go back" would
    be a variable divert (forbidden, K9).
  - Room state as VARs would be dozens of flags, and a checkpoint resume would restart the room knot with
    visit-count drift.
  - Host data gives the neighbours for preload directly, and a model-checkable state space for T9.
  - Prior art keeps room graphs on the host: Pixi'VN NQTR, Narrat, AGS, Ren'Py screens [P2 §6].
- **Alternatives.** Ink owns rooms (P2 option A); ink holds the flags and the host holds the graph (option C), which
  makes two writers.
- **Trade-off.**
  - A second authoring format beside ink. It gets its own lint (`world/*`), its own line-ID texts and a model
    checker.
  - Event knots must end in the yield block (`explore/event-return`, `explore/event-escape`).

**X4. One rules implementation for the runtime and the build.**
- **What.** These pure TS modules are imported by both the app and `client/scripts/story/`:
  - `explore/reduce.ts` (`reduce`, `actions`);
  - `explore/project.ts`;
  - `explore/reconcile.ts`;
  - `puzzles/rules/*` (params decoders, answer shapes, solution validators).

  The soft-lock checker and the seeded playthroughs call the same `reduce`/`actions` the player runs.
- **Why.** A checker built on a copy of the rules proves the copy. The same pattern already holds for `parseTags`
  (PP "one parser").
- **Trade-off.** These modules must stay DOM-free and fetch-free (arch rule `arch: pure world modules`).

**X5. Solutions are checked on the server. The client gets presentation parameters only.**
- **What:**
  - `POST /api/puzzles/{puzzleId}/attempts { answer: number[] }` → `{ correct, solved }`.
  - Every answer is an array of small integers: code digits, or piece indices for `order`. So the server compares
    `answer == solution` without knowing the type, after a shape check (`answerLen`, `answerMax`).
  - Rate limit: 20 attempts per 600 s per (user, puzzle), in `puzzle_progress`; then 429 with `Retry-After`.
- **Why:**
  - A solution in the public bundle makes the paid hint free [spec 8].
  - A hash does not help: 10^4 codes, 120 orderings and 720 clock positions enumerate in under a second [P3 §3b].
  - Devtools are documented on every client [P3 §3a].
  - The server must know "solved" to refuse selling hints after a solve (T8).
  - Brute force at the limit: 10^4 / 20 per 10 min = 5,000 min ≈ 3.5 days for a 4-dial lock.
- **Alternatives.**
  - A — the solution in client data.
  - B — a hash.
  - D — encrypted hints in the bundle (the letter of principle 0 forbids it).
  - All three in P3 §3b.
- **Trade-off:**
  - One round trip per Try: about 250–300 ms p95, a CLAIMED figure [P3 TL;DR 4]; verify on device in L15.
  - No offline play, which the prototype does not have anyway (PP F1).
  - Per-step feedback ("this medallion fits") exists only for item→slot insertion, which is not secret (X15).
- **Not protected.** A clue document says what it says: reading it in devtools equals reading it in the game. Only
  solutions and hint texts are protected. Per-player randomized answers are Later (they need server-generated
  clues).

**X6. A hint is one Stars invoice per tier, recorded as an `entitlements` row `hint:<puzzleId>:<tier>`.**
- **What.**
  - **Products.** `hint:ch1.drawer:1..3`.
  - **Order and grant.** `POST /api/invoices { productId }` and the existing order, pre-checkout, K19 grant and K20
    revoke run unchanged.
  - **Pre-checkout.** It gains three nullable predicates (X7 SQL):
    - tier n needs tier n−1;
    - a paid chapter's hint needs the chapter;
    - no sale once the puzzle is solved.
  - **The unlock.** Permanent per user and re-readable on every device. Purchase is consumption: there is no
    separate "spend".
- **Why:**
  - `refundStarPayment` refunds only whole charges, so 1 charge = 1 unlock maps every refund to one revocation
    [P3 §1a].
  - No grant/consume split. No credit balance, so no Apple 3.1.1 "credits may not expire" or restore surface
    [P3 §1c].
  - The top player complaint is an intermediate currency [P1 §2c].
  - Reusing `entitlements` keeps "the ONLY unlock fact" literally true. Grant and revoke gain no new code path, so
    principle 2's audit surface does not grow.
- **Alternatives:**
  - Credits or packs (refund of a partly spent pack is impossible; two idempotency keys).
  - A separate `hint_unlocks` table (a second grant path, a second revoke).
  - A bot-chat hint message (leaves the Mini App) [P3 §2].
- **Trade-off:**
  - Several small invoices per stuck player, and possibly service messages cluttering the bot chat (verify: what
    the payer sees per micro-purchase, owner step E6) [P3 must-verify].
  - Pre-checkout reads the order's product between the payer-row lock (DB-4, RULINGS 14) and its UPDATE: one more
    indexed statement, three instead of two; still within K18's 2 s DB timeout.

**X7. Hint text and solutions are server-only build output.**
- **What:**
  - The story tool splits `world.json`:
    - **public part** (no `solution`, no `hints`; `hintTiers` only) → `client/src/story-gen/free/<ch>.world.json`
      for free chapters, or the paid chapter payload;
    - **server part** → `server/content/puzzles/<ch>.json`.
  - Hint line IDs are excluded from the public en tables.
  - `scan-dist` builds hint fingerprints from the sources (`story/*/world.json` + `story/locales/en/*.json`), not
    from the emitter.
  - A paid chapter's public world (documents, item names, labels, puzzle titles and prompts) is paid content too.
    `scan-dist` builds paid-world fingerprints from the same sources: for every paid chapter of `story/chapters.json`
    that has a `story/<ch>/world.json`, every world line ID and every world text (ru, and en from
    `story/locales/en/<ch>.json`) of ≥ 12 chars.
  - Delivery: `GET /api/puzzles/{id}` returns `text` only for owned tiers, with `private, no-store`. Client copies are
    memory-only and dropped when the puzzle session is disposed.
- **Why.** Principle 0. A scan fed by the emitter cannot catch the emitter's own routing fault; the source-built
  fingerprints can (the same reasoning as PP's paid-only asset check). L3b's `fingerprints.lines.json` is built from
  paid ink only, so without the paid-world set a ch2 world mis-routed into `story-gen/free/` (or ch2 world en texts
  merged into a public table) would ship with `story`, `build` and `scan` green.
- **Trade-off.** Short solutions (`1847`) cannot be fingerprinted (false positives in minified JS). They are kept out
  by type and two decoders instead: `decodeWorldPublic` refuses `solution`/`hints` keys, and so do the emitter's
  types.

**X8. Failure, retry and abandonment.**
- **Exploration puzzles** (attached to a lock):
  - Closing the panel (BackButton) records no outcome; the player can return any time (RE/SH: unlimited tries)
    [P1 §3]. The mechanism: a tap on a lock whose slots are all filled and whose puzzle has no outcome reopens the
    puzzle at its start, attempts kept (reducer rule `tap`). A reload during the puzzle lands in the same state (the
    puzzle is an overlay, not a yield), so the same tap reopens it.
  - An instance may set `maxAttempts` (1–9). At the limit the outcome is `failed`, and the lock's `onFail` effects
    run. Typically these are a story knot plus `{ unlock: <this lock> }`.
  - The soft-lock checker proves the section stays exitable.
  - A failed puzzle is final for that run.
- **Linear puzzles** (`# puzzle:` in the story):
  - `giveUp: true` shows **Give up** (confirmed) → `abandoned`.
  - `maxAttempts` → `failed`.
  - The `then` knot branches on `pz_<id>`. Whether the story loops back for a retry is the writer's call (a divert
    to the puzzle knot is legal).
  - The puzzle is a mode, not an overlay: BackButton is hidden, so one stray Back never abandons a branch.
- **Attempts used** are saved (`PuzzleRun.attempts`) and autosaved after every wrong Try, so a reload does not reset
  the fail counter. An older manual slot still can.
- **Why.** Spec 6 (a branch, never a dead end). RE/SH have no fail state; the branching patterns come from narrative
  games (attempt gauge, give-up) [P1 §3].
- **Trade-off.** The server does not enforce `maxAttempts`: a cheater who ignores it only avoids story content, and
  the server's rate limit still bounds brute force.

**X9. Saves: a save restores the start of an open puzzle; world state lives in the save body; reconcile, never
throw.**
- **What:**
  - `SaveBodyV1` gains `world: WorldState`, `worldVersion` and `at.yield`. L13 has not started, so the codec is born
    with them and there is no format bump.
  - **World version.** The story tool stamps each public world with `version` = `worldVersion(body)`: sha256 of the
    emitted public world JSON without that field and with every world text value (`{ id, ru }`) replaced by the
    constant `1`, first 16 hex. The save stores the version it was written against. A `world.json`-only edit leaves
    `storyVersion` unchanged, so the world needs its own stamp.
    - Texts and line IDs are excluded because no reducer rule reads them (`reduce` only passes a `look` text through
      to its effect), so they cannot change `successors`. A `ru` typo fix or a `--fix-ids` run therefore keeps every
      save on the identity branch.
    - Every other field stays in the hash, including the presentation fields (rects, asset ids, `hintTiers`). So a
      field added to the world later is covered by default: a forgotten field causes an extra check, never a
      skipped one. An art-only edit leaves `successors` and `sectionKey` unchanged, so steps 4 and 5 keep every
      section state the old version proved: by I-W, every section that is not still in `unproved` from an earlier
      rules update, and such a section gets only the check it was already owed (revision 4; this rests on step 5's
      premise). Each check costs one bounded search.
  - **Inside a puzzle.** The dials and the arrangement are not saved (Ren'Py model [P2 §5]). Attempts and hints
    opened are saved.
  - **On load,** `reconcile(world, state, knots, savedVersion)`:
    - same version → the state unchanged. By the invariant below, each section's state is one this world produces
      from that section's entry, or the section is in `unproved` and step 5's check still runs at its next entry.
      That set is closed under `successors`, and T9's checker proves a `leave` reachable from each of its states, so
      it also covers every state the player reaches from this one.
    - otherwise:
      1. drop the ids the current world no longer has; a missing current room falls back to the section start;
         pending story knots that no longer exist are dropped;
      2. **slot shape**: for each lock in `slots` that is not open, the entry is resized to the lock's current slot
         count. A filled item stays only where the slot at that index still `accepts` it; every other filled item
         (and every item of a lock that lost its slots) goes `used → held`;
      3. **gifts**: a `taken` hotspot or a fired trigger is undone (it gives again) when an item or doc it gives is
         in none of `held`, `used`, `docs`;
      4. **the guarantee (membership)** for the current section S (the state's `section`; none when it is null):
         `inSectionReach(world, state, S, RESUME_STATE_CAP)` asks whether the current world can produce the state
         from section entry.
         - The search is a BFS over the shared successor relation from `sectionEntry(world, state, S)`, deduplicated
           by `sectionKey`. It answers `'yes'` when it meets `sectionKey(state)`.
         - `'yes'` → the state is kept.
         - `'no'` (the state lies outside the entry-reachable set) or `'cap'` → that section restarts
           (`resetSection`, below) and the player sees a toast.
         - `'cap'` cannot occur for a section the build accepted. The build enumerates the same set from the same
           start with the same key, and `world/state-cap` fails any section above `RESUME_STATE_CAP`. So `'cap'`
           means a world no build checked, and the reset fails safe.
      5. **every other section** (revision 3): `unproved` becomes the set of every section of the current world
         except the one step 4 checked. Their progress was produced by the old world, and nothing has proved it
         under this one. A section left through a `leave` and entered again later, or left behind while the player
         is in another section, would otherwise come back unchecked. Each of them is proved before the player can
         act in it, at its next `enter-section`, by `admitSection(world, state, S)`:
         - it enters S with `reduce` (`lastRoom[S]` or the start room, `onEnter` as usual), then runs the same
           search, `inSectionReach(world, entered, S, RESUME_STATE_CAP)`, on the entered state;
         - `'yes'` → the entered state is kept;
         - `'no'` or `'cap'` → S restarts: the result is `sectionEntry(world, state, S)`, preceded by a `reset`
           effect (the same toast);
         - either way S leaves `unproved`. A section that is not in `unproved` is entered by `reduce` alone.

         `admitSection` runs only at `enter-section S`, which comes from an explore yield with an empty
         `pendingStory`. There `section` is null (chapter start, or after a `leave`) or S itself (a resume). A
         current section is never in `unproved`: step 4 checked it at the load, or `admitSection` at its entry. So
         the reset of step 5 never meets another current section: no path resets a section that is not current
         while a different one is.

         **Step 5's premise** (revision 4): a section's keys change only while that section is current.
         `admitSection` judges the whole entered state against S's entry-reachable set, so a key of S written from
         outside S would count as old-world residue and be reverted, while the trigger that wrote it stays fired
         (W1 of the round-4 triage: a lever in one section that unlocks a gate in another strands the chapter after
         any version change, an art-only one included). The story gate makes the premise true for every world it
         accepts:
         - `world/cross-section-effect` (X15) fails an `{ unlock: key }` whose key is a hotspot of another section
           than the trigger's own, and an item or doc given in more than one section;
         - `world/cross-section-item` (X15) keeps every slot and puzzle that consumes an item in the section that
           gives it;
         - `world/puzzle-multi-lock` (X15, revision 5) fails a puzzle attached to more than one lock, so
           `puzzle-ended p` has one target and p's run is a key of exactly one section (W1 of the round-5 triage: a
           code puzzle on a courtyard shed and a tower gate, solved in the courtyard, left the tower gate showing
           its lock panel forever, a strand the per-section search never reaches);
         - `world/cross-section-exit` (X15, revision 6) fails a room→room exit whose `to.room` is a room of another
           section than the exit's own, so every move stays inside its section (W1 of the round-6 triage: an arch
           from a courtyard room into a tower room let the player pull a tower lever and drop into a tower pit while
           the courtyard was current; the courtyard search drops the lever's successor, because `sectionKey` ignores
           tower keys, and the tower search never reaches the room, so neither expands the pit and the strand passed
           the gate).

         So the keys `sectionKey(S)` reads (S's hotspot keys in `taken` / `open` / `slots` / `fired`, the run of each
         puzzle attached to one of S's locks, the items and docs S gives) are written only by actions in S's rooms
         and by S's own triggers (`onEnter` of S's rooms; `then` / `onOpen` / `onFail` of S's hotspots), and at load
         by reconcile, which checks its own result (step 4 for the current section, step 5 for the rest). A
         `puzzle-ended p` is one of those actions: p opens only from a tap or insert on p's one lock, a hotspot of
         S, and the action writes p's run and that lock's `open` and `fired` keys (its `onOpen`, the hotspot's
         `then`, its `onFail`), all keys of S. Those actions and triggers run only while S is current: the current
         room is always a room of the current section, because `enter-section S` sets it to `lastRoom[S]` or S's
         start and every move stays inside its section (`world/cross-section-exit`). A current section is never
         in `unproved`. Hence `admitSection` judges only progress the old world produced:
         it never reverts a key the current version wrote, and within one version the first entry of S yields
         exactly `sectionEntry`.
  - **The invariant (I-W)**, per section. For every section S and every saved state with world version v, either S
    is in `unproved`, or S's state is one v can produce from S's entry. S's state is the state itself when S is
    current, and the state the next `enter-section S` produces when S is not:
    - the runtime enters S through `enter-section`. The first entry yields exactly `sectionEntry`, because before it
      nothing has written S's keys and no move has entered S's rooms (step 5's premise, `world/cross-section-effect`,
      `world/puzzle-multi-lock`, `world/cross-section-exit`).
      Within one world version, a re-entry after a `leave` resumes at `lastRoom[S]` with the key of the state that
      left, which is in the set: a `leave` tap changes only `section`, and `sectionKey` ignores `section` and
      `lastRoom`;
    - `reduce` writes every step of play, and its steps are `successors`. The one other writer during play is
      `admitSection`, which composes `reduce` and `resetSection` at the entry of a section in `unproved`;
    - after a version change, reconcile keeps the current section's state only on `'yes'` (step 4) and puts every
      other section into `unproved` (step 5). `admitSection` takes a section out of `unproved` only on `'yes'`, or
      by restarting it from its entry.

    The next autosave stamps the current version and carries `unproved`. From then on the identity branch is sound,
    because a section still in `unproved` is proved before the player acts in it.
  - **The cost.** RESUME_STATE_CAP = 5,000 states, the one constant of `world/state-cap` (build) and of steps 4 and
    5 (runtime). The budget is ≤ 300 ms at CPU 4× per search, the plan's LOW proxy (PP Budgets: time to first
    line), for the worst case, a full enumeration.
    - Estimate: about 8 successors per state, each one immutable `reduce` plus one key string of about 200 chars,
      at about 2 µs per successor on a desktop core. That is about 15 µs per state, about 60 µs at 4×, so
      5,000 × 60 µs = 300 ms.
    - verify: LW2 seen working times the full search of a 5,000-state fixture section on a quiet machine. L15
      times it on a LOW Android if one is available. Over budget → lower the constant, and the story gate re-checks
      every section against it.
    - Measured, provisional (RULINGS 21 Q7; LW2 merged `38bc717`): one full `inSectionReach` enumeration took
      50-58 ms in quiet-like runs and 130-158 ms beside LDB1's cargo, against 75 ms unthrottled (≤ 300 ms at CPU
      4×). `RESUME_STATE_CAP` stays 5,000. Re-measure on a quiet machine before LX / L13 rely on it:
      `cd client && npx vitest run scripts/story/softlock -t "just under" --reporter=verbose`.
    - Each search runs on the main thread with no input pending. Step 4 runs behind the resume loading state. Step
      5 runs inside the explore yield, before the room batch starts, so no hotspot is on screen yet; it delays that
      section's door fade by at most the same 300 ms.
    - A load runs at most one search (the current section) and an entry at most one (the entered section), so no
      single point exceeds the budget, whatever the chapter's section count. After a rules update each section is
      searched at most once per loaded save: at the load if it is current, otherwise at its first entry. It is not
      searched per resume.
  - **Chapter-start fallback** (K12 level 3) resets the world to empty.
  - **Exact resume at a yield** rebuilds the yield step from `at.yield`. It does not rely on inkjs re-exposing tags
    of a stopped story.
- **Why.**
  - T5's "never throws" extends to world data.
  - The knot rule degrades safely: a renamed knot falls back to the chapter start (STAGING-DSL §9). A renamed or
    repurposed world id does not. Example: the player holds `medal_star` from `cellar.star`, and v2 renames it
    `medal_comet`. Dropping the unknown item while `cellar.star` stays `taken` strands the gate forever. Steps 2–3
    repair the common cases: they map the save onto a state the new world can produce (the gift re-armed, the
    items back in `held`). Step 4 turns "never rename a shipped id" from a convention into a guarantee. A kept state
    is one the current world can produce from section entry, so T9's build proof covers it and every state the
    player reaches from it. A path to a `leave` from the kept state alone would not be enough: in an updated world a
    reconciled state can reach a dead end that no state reachable from entry reaches.
  - Membership is bounded by what the build already enumerated, so one constant serves both sides and the resume
    search can never exceed a count the build accepted.
  - Steps 4 and 5 together give every section the guarantee, not only the current one (revision 3). A section the
    player left through a `leave`, or left behind in another section, carries progress the old world produced.
    Without step 5 it would be entered again under the new version unchecked, and the next autosave would stamp the
    new version on it, so every later load would skip it (W1 of the round-3 triage).
  - Step 5 is sound only when a section's keys change only while it is current (revision 4). A build-time lint makes
    that premise true at 0 runtime bytes and leaves the reconcile code, its one cap and X15's per-section T9 proof
    unchanged. The lint rejects the world before it ships, so the player can never meet the strand (W1 of the
    round-4 triage). Revision 5 adds a writer that lint did not cover, a puzzle attached to locks in two
    sections, as `world/puzzle-multi-lock` (W1 of the round-5 triage). Revision 6 adds the path no lint covered, a
    room→room exit into another section's room, through which S's hotspots were tapped while another section was
    current, as `world/cross-section-exit` (W1 of the round-6 triage).
  - The check runs only after a rules change (texts do not re-version), so its cost (≤ 5,000 states, ≤ 300 ms at
    CPU 4× per search) is paid at most once per section for each such update and loaded save, not per resume.
    Deferring the sections that are not current to their entry keeps each load and each entry at one search.
- **Alternatives.**
  - A build-time registry of shipped world ids and lock shapes that fails the story gate on a removal or repurpose:
    it blocks legitimate edits (a slot added to a lock) and still misses semantic changes, for example a new lock on
    an exit that needs an item the player already used elsewhere.
  - A path to a `leave` from the reconciled state (revision 1): unsound. States reached from it are never checked,
    and once autosaved they take the identity branch.
  - "Every state reachable from the reconciled state reaches a `leave`" (T9's property from the reconciled state):
    sound, and it keeps more states. But a reconciled state can lie outside the entry-reachable set, so the states
    reachable from it are not bounded by the count the build accepted. The search could then hit the cap for an
    accepted section, and it needs a second, backward pass.
  - Re-proving on every load until the section is left: a per-load cost, with the same cap problem.
  - A build-emitted set of reachable state keys: 4 B × N per section in a public file on the chapter's load path,
    plus hash-collision false positives.
  - Hashing the whole public world: any `ru` typo fix or `--fix-ids` run sends every in-section save through step 4
    (W1 of the round-2 triage).
  - Proving every section with progress at load (instead of step 5): the load pays one search per such section,
    ≤ 300 ms each at CPU 4×, so the resume time grows with the chapter's section count, which nothing bounds. It
    also needs a `resetSection` that leaves the current section's `section`, `room` and `pendingStory` alone.
  - A lint that forbids an `explore: S` yield reachable from one of S's `leave` knots: it removes the
    interlude-and-return pattern that I-W's re-entry rule and `lastRoom` exist for.
  - Modelling foreign writes instead of `world/cross-section-effect` (revision 4): `admitSection` and `sectionEntry`
    would treat S's keys written by other sections' triggers as given. The build would then have to prove S from
    every combination of foreign keys that other sections can write before S's entry, which multiplies S's state
    count by those combinations. The one-cap argument (build count = resume count) and X15's per-section T9 proof
    would both be lost.
  - Narrowing step 5 to the sections whose keys the old world wrote (revision 4): a cross-section lever pulled after
    the load survives, but one pulled before the update leaves an old-world `open` key in the gate's section, and
    `admitSection` still reverts it while the lever stays fired.
- **Trade-off.**
  - A checkpoint resume after a story update pairs the latest world with the knot-entry variables. The world is
    host truth and is projected again at the next `enter()`, so this is consistent.
  - A section restart loses that section's progress (its items, slots, solved puzzles; hint entitlements stay on the
    server).
    - It happens only after a rules edit (never a text-only edit) that leaves the saved state one the new world
      cannot produce. Examples: a new lock or trigger behind the player, a moved opener, a removed slot.
    - Some of these states still had an exit, so a restart can be conservative. None strands: T9 proves the
      restarted section from its entry, no fired trigger of another section loses its effect with it
      (`world/cross-section-effect`, revision 4), no other section's puzzle run is reset with it
      (`world/puzzle-multi-lock`, revision 5), and none of its keys was written while another section was current
      (`world/cross-section-exit`, revision 6).
  - A section is capped at RESUME_STATE_CAP = 5,000 abstract states. In the hub-and-gate shape that is about
    4 rooms with 6 key items: 4 rooms × 3⁶ item states ≈ 2.9k, before triggers. The demo is about 1.3k by hand
    count, and the story report prints each section's real count. A larger area is split into sections (X15).
    Raising the cap needs a cheaper state key or a faster measured device class.
  - About 1 KB br more in the engine chunk (the successor relation and the BFS); `admitSection` is a few dozen lines
    on top.
  - One more persisted field, `unproved`: a few section ids per save body. For a section other than the current
    one, the area-reset toast appears at its next entry, not at load.
  - No trigger in one section opens a lock in another, and no item or doc is given in two sections (revision 4,
    `world/cross-section-effect`). An RE-style shortcut between areas [P4 §1a] therefore lives inside one section,
    within RESUME_STATE_CAP. Cross-room unlocks inside a section stay allowed. A cross-section shortcut waits for a
    cross-section checker (Later, with X15's).
  - No room→room exit joins two sections either (revision 6, `world/cross-section-exit`). A walkable door between
    areas is a `leave` exit into a knot that yields `explore: <other>`, or the two areas are one section within
    RESUME_STATE_CAP.

**X10. Hotspots are DOM buttons positioned by the shared pure cover transform.**
- **What.**
  - Hotspots are integer rects `[x, y, w, h]` in source pixels of the 1080×2048 room background.
  - `geom/cover.ts` is the one cover function. `scene/layout.ts` uses it for the background sprite, and the explore
    controller uses it for the hotspot CSS rects, so they agree by construction (test
    `cover: hotspot rect follows the bg cover transform`).
  - **The box.** The math agrees only if both sides use one box: the **stage host**, the element of `Stage.svelte`
    (L14a). It is the full-bleed 9:16 column, pillar-boxed in landscape (PP "Portrait-first"), and Pixi's `resizeTo`
    and the controller's `ResizeObserver` both read it.
    - The hotspot layer (`ExploreView`'s root) is absolutely positioned inside that element, at `inset: 0`, never in
      the overlay box padded by `--app-inset-*`.
    - `controller.resize()` receives that element's content-box size.
    - The explore bar inside the layer pads itself by `--app-inset-*`; the buttons do not move.
    - A layer in the padded box would sit off by the inset or the pillar-box margin. The e2e
      `explore: hotspot buttons align with props under safe area and landscape` fails on that.
  - Targets smaller than 44×44 CSS px are expanded around their centre.
  - Rects must lie inside the safe frame `x 80–1000, y 160–1760` (lint `world/hotspot-frame`). That frame is visible
    from 9:19.5 (sides cropped to about 945 px) to 9:16 (top and bottom cropped to about 1,920 px), above the
    inventory bar and below the top bar.
- **Why:**
  - The overlay already owns input (PP: `stage.eventMode = 'none'`).
  - DOM gives tap slop and `pointercancel` handling for free, real `<button>`s with localized `aria-label`s (a11y),
    and 44 px targets (Apple 44 pt; WCAG 2.5.8 ≥ 24 px) [P1 §4].
  - Pixi would need `eventMode` changes, our own tap threshold and our own cancel handling [P2 §3].
- **Alternatives.** A Pixi `hitArea` on a background child (free transform; the costs above).
- **Trade-off.** Rects only (polygons Later). Overlapping rects are a lint warning (`world/hotspot-overlap`).

**X11. Props: a new asset kind `prop/<id>`, drawn in the background's coordinate space.**
- **What:**
  - **Asset.** ≤ 512×512 px, so ≤ 1 MiB decoded; AVIF ≤ 60 KB.
  - **Use.** A `take` or `object` hotspot may name a prop. It is shown at the hotspot rect until taken. Taken items
    disappear from the picture.
  - **Command.** The scene receives a `props` command: built by the explore controller, never parsed from a tag.
  - **Lifetime.** Any `bg` or `scene` clears it. `StagingSnapshot` gains `props`, so `restore()` and context-loss
    rebuilds keep it.
- **Why.** Spec 3b, "per-room state that persists (items taken …)", needs a visible change. Background variants per
  state would cost 8.4 MiB each. Real art needs this layer anyway ("clean architecture first time").
- **Alternatives.** Items painted into the background plus a DOM marker (no visible pickup); Pixi `Graphics`
  placeholders (throwaway).
- **Trade-off.** One more catalog namespace (L5, `catalog.ts`). At most 8 props per room (lint).

**X12. Navigation: exits are hotspots; exits are symmetric; BackButton walks the room path.**
- **What:**
  - **Exits.** Doors are `exit` hotspots, as the owner asked [spec 3b]. Every room→room exit has a reverse exit
    (`world/one-way-exit`), so there is no one-way door inside a section [P4 rec. 5]. Every room→room exit leads to
    a room of its own section (`world/cross-section-exit`, revision 6); sections join only through the story, by a
    `leave` exit.
  - **The path.** The controller keeps a room path: push on each move; a move to a room already on the path
    truncates back to it.
    - A move whose reverse exit is locked (the exit back from the new room is neither lock-free nor in `open`)
      clears the path instead of pushing. Locks never close again, so every room on the path can be walked back
      through an open exit.
    - Back never meets a locked door, and never opens a lock panel or a puzzle.
  - **`back()`** dispatches `tap` on the first open exit of the current room that leads to the previous path room:
    an ordinary move through the one writer, `reduce`.
  - **BackButton** pops overlays first. Then, while exploring with a non-empty path and no event knot running, it
    walks back one room. Otherwise it is hidden, and Android back closes the app, guarded by closing confirmation.
    - **Event knots.** The root-back is cleared when an event knot starts (a `story` effect) and restored from the
      path state when the rooms return (the `room` effect after `event-returned`). The reducer also refuses a `tap`
      while `pendingStory` is non-empty, so no move can run under an event's dialogue.
    - **Door fade.** The root-back stays set during the 400 ms fade. A press during the fade goes through
      GameSession's single intent queue and coalesces into `scene.complete()` (PP F2), so it does not move.
    - **Path state.** The controller reports the path's empty ↔ non-empty edges (`onPath`), and `yields.ts` sets or
      clears the root-back exactly at those edges. The button is never shown without an action.
  - **One owner.** `ui/screens.ts` stays the only owner of the button through a root-back slot
    (`setRootBack(fn | null)`).
  - **No map** in the prototype.
- **Why:**
  - BackButton is Telegram's in-app "back" (principle 5).
  - A truncating path is bounded by the room count and matches what the player walked.
  - With 3 rooms, multi-hop backtracking is at most one extra tap; a map is the anti-stuck device for larger graphs
    [P4 §1b] (Later).
- **Alternatives.** An on-screen back arrow only (escape-room style [P4 §2b]); BackButton reserved for overlays.
- **Trade-off.** The path is not saved: after a reload BackButton stays hidden until the first move. After a move
  through a door locked from the other side, the button hides until the next move.

**X13. Room preload: neighbours decoded in exit order within the steady cap. The door fade covers an on-demand
load.**
- **What:**
  - On entering room R, the controller requests `preload('room:<N>', [bg(N), props(N)])` for each neighbour N in
    exit order. The registry refuses a preload that would pass 32 MiB (K5), so the rest load on the tap behind the
    400 ms door fade (`ensure`).
  - Holders of non-neighbours are released on every move.
  - Opening a puzzle that has a close-up first releases every `room:*` holder, then ensures the close-up.
  - Arithmetic:
    - room: 8.4 (bg) + 4 × 1 (props) = 12.4 MiB;
    - two neighbours: + 16.9 → 29.3 MiB ≤ 32;
    - a third is refused;
    - puzzle open: 12.4 + 8.4 (close-up) = 20.9 MiB.
- **Why.** K5's cap is the invariant. Public art also sits in the HTTP cache (immutable), so an on-demand load is a
  decode, not a download (verify the decode time on a LOW Android and an iPhone: L15 perf).
- **Alternatives:**
  - Keep encoded neighbour blobs (a second cache with its own cap).
  - Smaller room art (an art-direction call).
  - Preload every exit (breaks the cap at 3 exits).
- **Trade-off.** The third and later exits pay a decode on tap. Paid rooms (`no-store`) re-download after eviction.

**X14. Lazy chunks.**
- **What.** Each family has its own dynamic chunk, never in the entry or engine static closures:
  - `puzzle-type:code`, `puzzle-type:order`;
  - `puzzle-host` (PuzzleHost + HintLadder);
  - `explore-ui` (controller + ExploreView + Inventory + DocumentReader + LockPanel).

  The pure rules, the session, `reduce` (with the successor relation), `project` and `reconcile` (about 7 KB br) stay
  in the engine chunk: a linear puzzle needs them without exploration, and every resume needs `reconcile`.
- **The importer.** `app/yields.ts` (L15) holds every `import()` of these families (the puzzle types through
  `puzzles/registry.ts`); `App.svelte` only renders the loaded components from the view stores. Until `yields.ts`
  exists nothing reachable from `index.html` imports them, so Vite emits no chunk, and the budget rows stay PENDING
  (Budgets).
- **Prefetch.** A non-awaited `import()` when a chapter's world has sections, or when the knot index shows a
  `puzzle` yield in `next(K)`.
- **Why.** Spec 9. The entry is 40 KB br and Svelte components otherwise land in it through `App.svelte` (PP K3).
- **Trade-off.** Four more budget rows and one arch rule (static imports of the lazy directories only from inside the
  same directory).

**X15. Sections are self-contained; linear puzzles take no items.**
- **What:**
  - An item obtained in section A may not be required (by a slot or a puzzle) in section B (`world/cross-section-item`).
  - A trigger writes only its own section (`world/cross-section-effect`, revision 4). An `{ unlock: key }` effect in
    a room's `onEnter` or in a hotspot's `then` / `onOpen` / `onFail` must name a hotspot of the same section, and
    every item and doc is given (a `take` hotspot's `gives`, a `{ give }` effect) in at most one section.
  - A puzzle is attached to at most one lock (`world/puzzle-multi-lock`, revision 5): no two locks, in one section
    or in two, name the same puzzle in their `puzzle` field.
  - A room→room exit leads only to a room of its own section (`world/cross-section-exit`, revision 6): an `exit`
    whose `to` is `{ room }` names a room of the section that holds the exit. Sections join only through the story:
    a `leave` exit into a knot that yields `explore: <other>`.
  - A linear puzzle has no `requires` (`world/linear-requires`). Erratum (RULINGS 21 Q6; LW2 merged `38bc717`): by
    construction, puzzles have no item field; only locks have slots. The decoder refuses a `requires` key as
    unknown, so LW3 keeps the code registered without an emitter.
  - Item→slot acceptance is public data: a medallion-shaped indentation is not a secret.
- **Why.** It makes T9 checkable per section, with no cross-section path analysis. Gilbert's "no unretrievable item"
  rule holds by construction [P4 §3a]. 999 uses self-contained escape segments [P4 §2a].
  - The effect rule makes X9 step 5's premise true: only S's own actions and triggers write the keys `sectionKey(S)`
    reads. Without it, a lever in one section that unlocks a gate in another is reverted at the gate's section
    entry after any version change, while the lever stays fired, so the chapter cannot be finished (W1 of the
    round-4 triage). The give rule also closes the second foreign write that triage names: an item or doc of S
    given again by another section's hotspot would make `admitSection` reset S for a re-takable gift.
  - The one-lock rule closes the third foreign write (revision 5). A puzzle run is keyed by `PuzzleLocalId` and
    `puzzle-ended` carries only that id, so a puzzle on `yard.shed` (courtyard) and on `hall.gate` (tower) makes
    the run `puzzles.keypad` a key of both sections. A courtyard solve writes it while courtyard is current; the
    tower gate then has every slot filled and an outcome, so a tap shows the lock panel forever. Tower's search
    starts from `sectionEntry`, where the run is reset, so `world/softlock` proves tower and only a random walk
    (`play/step-cap`) might catch the strand. After a version change `admitSection(tower)` would also revert a run
    the current version wrote (W1 of the round-5 triage). With one lock per puzzle, `puzzle-ended p` has exactly
    one target, the lock that carries p, and the run and that lock are keys of the same section, so step 5's
    writer list (X9) holds.
  - The exit rule closes the fourth foreign write (revision 6). Rooms are unique across the chapter, `tap h` needs
    only h in the current room, and `section` changes only at `enter-section`. So an arch from courtyard's `yard`
    into tower's `hall` lets the player tap tower hotspots while courtyard is current: a tower lever unlocks a door
    down into tower's `pit`, whose way back needs a rope from `hall`. Courtyard's search drops the lever's successor
    (its `sectionKey` ignores tower keys), and tower's search starts at tower's start room, from which `hall` is not
    reached, so neither search expands `pit`. `world/softlock` stays green and the gate reports only a
    `world/unreachable` W on `pit`; a variant of the world reports nothing. After a version change
    `admitSection(tower)` would also revert the lever the current version pulled (W1 of the round-6 triage). With
    every move inside its section, the current room is always a room of the current section, so step 5's writer
    list (X9) holds for taps, inserts and `onEnter` alike.
- **Alternatives (revision 5).**
  - All locks of a puzzle in one section, plus a target rule: "open every lock of p" turns one solve into a
    multi-lock unlock, and a fail at one door is a fail at the other through the shared run; "open the tapped
    lock" needs the hotspot on the `puzzle-ended` action and a run per lock, which is the next alternative.
  - A run keyed by `HotspotKey` instead of `PuzzleLocalId`: it changes the save format (`PuzzleRun` map keys), the
    projection names (`pz_<puzzle>`), the hint products (`hint:<PuzzleId>:<tier>`) and the server's solve state
    (`puzzle_progress` per puzzle), and a solve at one door would refuse hints at the other. All four are keyed by
    puzzle id and stay 1:1 with a lock under the one-lock rule.
- **Alternatives (revision 6).**
  - `world/unknown-ref` resolving `to.room` within the exit's section: it reports a defined room as "not defined",
    and it merges an existence fault and a scope fault under one code, so neither red can fail on its own. It also
    asks for a per-section room lookup in the reducer, which would be undefined on the worlds the lint rejects.
  - Modelling cross-section moves (a move sets `section` to the target room's section): the move would enter a
    section without `admitSection`, so an `unproved` section would be played unchecked. And `sectionKey(S)` would
    have to span every section a door reaches, which loses the per-section T9 proof and the one-cap argument (build
    count = resume count), as with revision 4's rejected modelling of foreign writes.
  - A runtime check in the move rule (refuse a move out of `s.section`): the door is dead in the shipped game, the
    world still ships unproved, and the check costs runtime bytes for a fault the build can reject.
- **Trade-off.** No inventory puzzle spans sections, no shortcut or shared gift crosses one (Later, with a
  cross-section checker), and no room→room door joins two (revision 6; a `leave` exit and an `explore` yield do). An
  area that needs any of these is one section, within RESUME_STATE_CAP. Two doors that share a code are two puzzle
  entries (two ids, two hint ladders, the same `solution`) or one lock. The story gate costs one pass over the locks
  and one over the exits (0 runtime bytes).

**X16. Inventory: chapter-scoped, no slot limit, glyph icons.**
- **What:**
  - Items and documents live in `WorldState` for the chapter, reset at a chapter change. Cross-chapter consequences
    go through `g_` carry variables, written by ink from the projection.
  - No slot limit and no item box: RE limits serve resource tension, not puzzles [P4 §1c].
  - A consumed key item moves to `used` and leaves the list (RE "no longer needed" [P4 rec. 4]).
  - Icons are a closed set of inline-SVG glyphs (`sun moon star key letter book gear coin`); item art is Later
    (`prop` assets are never reused as DOM images: their memory belongs to the registry).
- **Why.** Zero bytes of icon art. Paid chapters' items arrive with the paid world.
- **Trade-off.** Placeholder look.

**X17. The two prototype types: `code` and `order`.**
- **`code`:**
  - `params: { dials: 2..6 }`, each dial 0–9; the initial state is all zeros.
  - The answer is the digit per dial.
  - UI: one column per dial with ▲/▼ buttons ≥ 48×48 CSS px, plus Try.
  - Clue: a document found elsewhere (RE2R / SH1 keypads [P1 §1a]).
- **`order`:**
  - `params: { pieces: ItemId[2..5] }`; the initial arrangement is the listed order.
  - The answer is a piece index per slot.
  - UI: tap a slot, tap another to swap. Selection is a thicker border plus a check glyph, never colour alone
    [P1 §4]. Then Try.
  - Inside a lock, the pieces must equal the lock's slot items (lint): insert three medallions, then arrange them
    (RE2R goddess statue [P1 §1a]).
- **Both:**
  - The solution must differ from the initial state (`world/solution-initial`).
  - Locale-free answers (digits, item glyphs plus names).
  - Controls in the lower half [P1 §4].
- **Why.** Both are single-screen, tap-only and portrait-native [P1 §1c]. Their composition is the owner's door
  ("find three items, insert them, then solve a puzzle").
- **Alternatives.** Symbol dials, clock hands (Later: new `PuzzleRules` modules, no framework change).

**X18. Hint ladder shape and the free path.**
- **What:**
  - One to three tiers per puzzle (data). The authored convention is nudge → direction → solution [P1 §2b].
  - Prices by tier from `server/catalog.json` `hints.priceStars`. The placeholders are `[1, 1, 2]`, marked
    PLACEHOLDER (owner value Q14).
  - Every tier is paid by default; a free first tier is Q14.
  - Before the first hint purchase in a session the ladder asks the same terms confirmation as the paywall (PP P1),
    remembered in memory for the session.
  - The hotspot reveal (outline every hotspot for 2 s) is free: the paid hint buys reasoning, not pixel hunting
    [P4 rec. 2].
- **Why.** Prior art converges on 3 steps, with the solution priced highest [P1 §2b].
- **Trade-off.** No time-released free hints (The Room [P1 §2a]) in the prototype.

---

## Data model and contracts

### Identifiers

| Id | Shape | Scope | Example |
|---|---|---|---|
| `SectionId`, `RoomId`, `HotspotId`, `ItemId`, `DocId`, `PuzzleLocalId`, `PropId` | `[a-z][a-z0-9_]*` | unique per chapter (rooms across all sections of the chapter; `world/duplicate-id`) | `manor`, `hall`, `gate`, `medal_sun` |
| `HotspotKey` | `<room>.<hotspot>` | chapter | `hall.gate` |
| `PuzzleId` | `<chapter>.<local>` | global (server, products); changed by STORIES-PLAN (Y1, Y17): no change — chapter ids are unique across all stories | `ch1.drawer` |
| hint product id | `hint:<PuzzleId>:<tier>`, tier 1–3 | global | `hint:ch1.drawer:2` |
| world text line ID | STAGING-DSL §4 format; the knot part is the owning section, puzzle, item or doc id | global (`id/duplicate` spans ink and world) | `ch1.drawer.h2x9` |

Reserved:
- a puzzle id may not end in `_hints` (`world/id-reserved`);
- a puzzle id may not be both yielded by a tag and attached to a lock (`puzzle/in-section`);
- a puzzle id may be attached to at most one lock (`world/puzzle-multi-lock`, revision 5).

### World data — `story/<ch>/world.json` (source, written by the narrative-designer)

```jsonc
{
  "format": 1,
  "items": {
    "medal_sun":  { "name": { "id": "ch1.medal_sun.n4me", "ru": "Солнечный медальон" },
                    "desc": { "id": "ch1.medal_sun.d3sc", "ru": "…" }, "glyph": "sun" }
  },
  "docs": {
    "diary": { "title": { "id": "ch1.diary.t1tl", "ru": "Дневник" },
               "body": [ { "id": "ch1.diary.p001", "ru": "…год, когда построили дом: 1847…" } ] }
  },
  "puzzles": {
    "drawer": { "type": "code", "title": { "id": "ch1.drawer.t1tl", "ru": "Ящик стола" },
                "prompt": { "id": "ch1.drawer.p1rm", "ru": "Четыре латунных диска." },
                "closeup": "drawer", "params": { "dials": 4 }, "maxAttempts": null, "giveUp": false,
                "solution": [1, 8, 4, 7],                                    // SERVER ONLY
                "hints": [ { "id": "ch1.drawer.h1aa", "ru": "Год упоминается в одном из документов." },   // SERVER ONLY
                           { "id": "ch1.drawer.h2bb", "ru": "Перечитайте дневник из подвала." },
                           { "id": "ch1.drawer.h3cc", "ru": "Код: 1-8-4-7." } ] },
    "gate":   { "type": "order", "title": {…}, "prompt": {…}, "closeup": null,
                "params": { "pieces": ["medal_sun", "medal_moon", "medal_star"] },
                "maxAttempts": 3, "giveUp": false, "solution": [1, 0, 2], "hints": [ {…}, {…}, {…} ] }
  },
  "sections": {
    "manor": {
      "start": "hall", "bgm": "tension",
      "rooms": {
        "hall": {
          "bg": "hall", "title": { "id": "ch1.manor.h4ll", "ru": "Холл" },
          "onEnter": [],
          "hotspots": [
            { "id": "to_study", "kind": "exit", "rect": [80, 900, 220, 520], "label": {…}, "to": { "room": "study" },
              "lock": null, "sfx": "door" },
            { "id": "gate", "kind": "exit", "rect": [380, 700, 320, 700], "label": {…}, "to": { "story": "manor_out" },
              "sfx": "door",
              "lock": { "slots": [ { "accepts": "medal_sun" }, { "accepts": "medal_moon" }, { "accepts": "medal_star" } ],
                        "puzzle": "gate", "locked": {…}, "onOpen": [],
                        "onFail": [ { "story": "manor_gate_forced" }, { "unlock": "hall.gate" } ] } },
            { "id": "inscription", "kind": "look", "rect": [400, 400, 280, 200], "label": {…}, "look": {…}, "then": [] }
          ]
        },
        "study": { "bg": "study", "hotspots": [
            { "id": "medal", "kind": "take", "rect": […], "label": {…}, "gives": { "item": "medal_sun" }, "prop": "medal_sun",
              "then": [] },
            { "id": "drawer", "kind": "object", "rect": […], "label": {…}, "prop": null, "look": null,
              "lock": { "slots": [], "puzzle": "drawer", "locked": {…}, "onOpen": [], "onFail": [] },
              "then": [ { "give": "medal_moon" } ] },
            { "id": "to_hall", "kind": "exit", "to": { "room": "hall" }, … } ], … },
        "cellar": { "bg": "cellar", "onEnter": [ { "story": "manor_cellar_voice" } ], "hotspots": [ … ] }
      }
    }
  }
}
```

**Schema strictness** (erratum, RULINGS 21 Q5 / LW2 cut D3; as merged, `38bc717`, `client/src/world/decode.ts:1-5`):
- Every key the example writes out is required, and so are the keys it elides behind `…`: room `title` and room
  `onEnter` (`[]` when empty, as in `hall`). The only optional keys are `take.then` and `lock.onOpen` (default `[]`).
- Unknown keys are issues, so a typo such as `onenter` is an issue, not a silently empty trigger.
- `Effect`, `to` and `gives` are objects with exactly one key; `rect` is 4 integers with x, y ≥ 0 and w, h > 0.
- Nullable keys, each still required: exit `lock`, exit `sfx` (a silent door is `"sfx": null`), section `bgm`,
  take / object `prop`, object `lock`, object `look`, lock `puzzle`, puzzle `closeup`, puzzle `maxAttempts`.
- References are not resolved by the decoder: an undefined room or item is `world/unknown-ref` (LW3). A hotspot id
  repeated within one room is an `'id'` issue: a `HotspotKey` names one hotspot.

**Hotspot kinds:**

| Kind | Fields | Tap |
|---|---|---|
| `look` | `look`, `then` | shows the text; marks examined; runs `then` once |
| `take` | `gives: {item} \| {doc}`, `prop`, `then` | once: into the inventory; the prop disappears; "Got: …"; runs `then` once (e.g. a `story` event on picking up the item) |
| `exit` | `to: {room} \| {story}` (a `{room}` of the exit's own section, `world/cross-section-exit`), `lock`, `sfx` | locked → the lock's puzzle or its panel (Lock, below); open → move (door fade) or leave the section into the story knot |
| `object` | `lock`, `then`, `look`, `prop` | locked → the lock's puzzle or its panel (Lock, below); open → `then` once (e.g. `give`) |

**Lock.**
- `slots` (each `{accepts: ItemId}`) are filled in any order, and each fill persists (RE1 crests [P4 §1a]).
- Then `puzzle` (if any) opens. A puzzle belongs to this one lock: no other lock names it
  (`world/puzzle-multi-lock`, X15).
- Solved → open. Failed → `onFail` effects.
- `{ unlock: key }` opens any lock of the trigger's own section by force (`world/cross-section-effect`, X15).
- **A tap on a locked hotspot:**
  - a free slot left → the lock panel (insert items);
  - every slot filled (a zero-slot lock included) and a `puzzle` whose run has no outcome → the puzzle opens at
    its start, attempts kept. This holds the first time, after Back closed it, and after a reload;
  - otherwise (a failed puzzle whose `onFail` did not unlock) → the lock panel; the soft-lock checker rejects a
    section where that state cannot reach a `leave`.
- **Opening.** `onOpen` runs once when the key first enters `open`, whatever the cause: the last insert of a
  puzzle-less lock, a solved puzzle, or an `unlock` effect. This is the "opening a door" event.

**Effects:**
- `{give: ItemId}`
- `{unlock: HotspotKey}` — a hotspot of the trigger's own section (`world/cross-section-effect`, X15)
- `{story: KnotName}` — the knot runs; it must end with this section's explore yield.

Every trigger (`onEnter`, `then` on `look` / `take` / `object`, `onOpen`, `onFail`) fires at most once (`fired`).
Its `story` effects are event knots of the section like any other: `explore/event-return`, `explore/event-escape`,
the soft-lock checker and the seeded playthroughs cover them through the shared reducer.

**Texts.**
- Every `{ id, ru }` is a player-facing line. en comes from `story/locales/en/<ch>.json` like ink lines.
- `--sync-locales` and `--fix-ids` cover world texts; `--fix-ids` writes JSON back with two-space indentation and the
  key order unchanged.

### Puzzle types (`client/src/puzzles/rules/`)

```ts
export type PuzzleType = 'code' | 'order';
export interface PuzzleRules<P> {
  readonly type: PuzzleType;
  decodeParams(raw: unknown): Result<P, string>;
  answerShape(p: P): { len: number; max: number };               // emitted to the server content (answerLen/answerMax)
  initial(p: P): readonly number[];                                // deterministic starting state
  validateSolution(p: P, s: readonly number[]): string | null;     // lint world/solution (shape, range, ≠ initial)
  validAnswer(p: P, a: readonly number[]): boolean;               // client shape pre-check before a request
}
export type CodeParams  = { readonly dials: number };                       // 2..6; digits 0–9; answer = digit per dial
export type OrderParams = { readonly pieces: readonly ItemId[] };           // 2..5; answer = piece index per slot
export const PUZZLE_RULES: { readonly code: PuzzleRules<CodeParams>; readonly order: PuzzleRules<OrderParams> };
```

### World state and the reducer contract (`client/src/explore/`)

```ts
// explore/state.ts
export type PuzzleRun = { readonly outcome: 'solved' | 'failed' | 'abandoned' | null;
                          readonly attempts: number; readonly hintsOpened: number };
export type WorldState = {
  readonly format: 1;
  readonly section: SectionId | null;  readonly room: RoomId | null;
  readonly lastRoom: Readonly<Record<SectionId, RoomId>>;
  readonly visited: readonly RoomId[];
  readonly held: readonly ItemId[];    readonly used: readonly ItemId[];   readonly docs: readonly DocId[];
  readonly taken: readonly HotspotKey[];  readonly examined: readonly HotspotKey[];
  readonly slots: Readonly<Record<HotspotKey, ReadonlyArray<ItemId | null>>>;
  readonly open: readonly HotspotKey[];
  readonly fired: readonly string[];                 // 'enter:<room>' | 'then:<key>' | 'open:<key>' | 'fail:<key>'
  readonly pendingStory: readonly KnotName[];        // head = the event knot running now
  readonly puzzles: Readonly<Record<PuzzleLocalId, PuzzleRun>>;
  readonly unproved: readonly SectionId[];           // X9 step 5: a set; sections not yet re-proved after a version
                                                     // change; read and written by no reducer rule; [] when empty
};
export const EMPTY_WORLD_STATE: WorldState;           // frozen

// explore/reduce.ts — pure; the ONLY writer of WorldState during play (admitSection composes it with resetSection, X9)
// erratum (RULINGS 21 Q3; as merged, 38bc717): every pure function below takes WorldPublicBody, the body without
// version (the build checker runs on toPublic(source), which has none); only reconcile takes
// WorldPublic, because it compares w.version. WorldPublic is assignable to WorldPublicBody.
export type ExploreAction =
  | { kind: 'enter-section'; section: SectionId }               // an explore yield with an empty pendingStory
  | { kind: 'event-returned'; section: SectionId }              // an explore yield with a non-empty pendingStory
  | { kind: 'tap'; hotspot: HotspotKey }
  | { kind: 'insert'; hotspot: HotspotKey; item: ItemId }
  | { kind: 'attempt-failed'; puzzle: PuzzleLocalId }
  | { kind: 'hint-opened'; puzzle: PuzzleLocalId; tier: number }
  | { kind: 'puzzle-ended'; puzzle: PuzzleLocalId; outcome: 'solved' | 'failed' | 'abandoned' };
export type ExploreEffect =
  | { kind: 'room'; room: RoomId; sfx: SfxId | null }   // GameSession builds the room batch (below)
  | { kind: 'look'; text: WorldText }
  | { kind: 'got'; gift: { item: ItemId } | { doc: DocId } }
  | { kind: 'lock'; hotspot: HotspotKey }               // open the lock panel
  | { kind: 'puzzle'; puzzle: PuzzleLocalId; hotspot: HotspotKey }
  | { kind: 'story'; knot: KnotName }                   // run an event knot (ink); the rooms are suspended
  | { kind: 'leave'; knot: KnotName }                   // section exit into the story
  | { kind: 'refused'; reason: 'no-fit' }
  | { kind: 'reset'; section: SectionId }               // admitSection restarted the section (toast); never from reduce
  | { kind: 'dirty' };                                  // the state changed → debounced autosave
export function reduce(w: WorldPublicBody, s: WorldState, a: ExploreAction): { state: WorldState; effects: ExploreEffect[] };
export function actions(w: WorldPublicBody, s: WorldState): ExploreAction[];
  // every enabled player action: taps on the current room's hotspots and inserts of held items while pendingStory is
  // empty; only 'event-returned' while it is not. Puzzle outcomes are not listed here: see successors. The current
  // room is always a room of s.section (every move stays inside its section, world/cross-section-exit).
export type Successor = { step: ExploreAction | { kind: 'closed'; puzzle: PuzzleLocalId }; state: WorldState; leaves: boolean };
export function successors(w: WorldPublicBody, s: WorldState): Successor[];
  // THE successor relation of the soft-lock checker, the seeded playthroughs and reconcile (rules below)
export function sectionKey(w: WorldPublicBody, s: WorldState, section: SectionId): string;
  // canonical key of s restricted to section S: room, pendingStory, S's keys in taken / open / slots / fired, the
  // outcomes of S's lock puzzles (each puzzle has one lock, world/puzzle-multi-lock, so its run is a key of one
  // section), the items and docs S gives in held / used / docs. Abstracted (read by no rule):
  // examined, visited, attempts, hints opened; ignored: section, lastRoom, unproved, everything outside S (X15)
  // erratum (RULINGS 21, LW2 addendum W1): held / used / docs / taken / open / fired are sets in the key (each part
  // sorted), pendingStory stays an ordered queue; actions lists held items sorted, so one key lists one action set
export const RESUME_STATE_CAP = 5_000;   // THE section cap: world/state-cap (build) = the resume search (runtime), X9
export const RULES_VERSION = 1;          // erratum (RULINGS 21 Q2, PE7): hand-bumped on any edit that can change
                                         // actions, successors, sectionKey or the section search (rules golden)
// explore/project.ts
export function project(w: WorldPublicBody, s: WorldState, declared: ReadonlySet<VarName>): Record<VarName, InkScalar>;
// explore/reconcile.ts — X9; same version → identity; otherwise normalize, then the membership guarantee for the
// current section (step 4) and `unproved` = every other section (step 5)
export function reconcile(w: WorldPublic, s: WorldState, knots: ReadonlySet<KnotName>, savedVersion: string | null):
  { state: WorldState; dropped: string[]; reset: SectionId | null };   // reset: the current section restarted (toast)
export function admitSection(w: WorldPublicBody, s: WorldState, section: SectionId): { state: WorldState; effects: ExploreEffect[] };
  // X9 step 5; the explore controller's only way to enter a section. S ∉ unproved → reduce(w, s, enter-section S).
  // Otherwise enter with reduce, then inSectionReach on the entered state: 'yes' → kept; 'no' | 'cap' → a reset effect,
  // then sectionEntry(w, s, S) and its entry effects. S leaves unproved either way.
export function sectionEntry(w: WorldPublicBody, s: WorldState, section: SectionId): WorldState;
  // reduce(w, resetSection(w, s, S), enter-section S).state — the start of both searches (build: s = EMPTY_WORLD_STATE)
export function inSectionReach(w: WorldPublicBody, s: WorldState, section: SectionId, cap: number): 'yes' | 'no' | 'cap';
  // BFS over successors from sectionEntry(w, s, S), deduplicated by sectionKey; 'yes' on meeting sectionKey(s)
```

**Reducer rules** (each one a unit test name in [Test strategy](#test-strategy)):
- `enter-section S`:
  - S current with a room set → `room` effect (resume);
  - otherwise room = `lastRoom[S] ?? start`, then fire that room's `onEnter`. A `resetSection` state has `section`
    = null and no `lastRoom[S]`, so its resume takes this branch and fires the start room's `onEnter`.
  - The rule never reads `unproved`. At runtime the explore controller dispatches `enter-section` only through
    `admitSection` (X9 step 5), which proves an `unproved` section around this rule.
- `tap h` (h in the current room) — per the hotspot-kind table.
  - While `pendingStory` is non-empty (an event knot runs), every `tap` is refused: the state is unchanged and no
    effect is emitted.
  - `take` → the gift into `held` / `docs`, the key into `taken`, `got`, then the hotspot's `then` once.
  - A locked `exit` / `object`:
    - every slot filled and a puzzle whose `puzzles[p].outcome` is null → the `puzzle` effect;
    - otherwise → the `lock` effect (the panel).
  - A move (the target room is a room of `s.section`: the story gate rejects any other, `world/cross-section-exit`,
    so the rule has no runtime check; the room lookup is chapter-wide, rooms being unique in the chapter, so it is
    defined on every world whose rooms exist, a world this lint rejects included):
    1. set `room`, `lastRoom` and `visited`;
    2. emit the `room` effect;
    3. fire the new room's `onEnter` once.
- `insert h i`:
  - a free slot of h accepts i and i is held → fill it, move i `held → used`, `dirty`;
    - all slots filled → the `puzzle` effect if the lock has a puzzle, else open;
  - otherwise → `refused: no-fit` and the state is unchanged.
- `puzzle-ended p`:
  - records the outcome in p's run;
  - `solved` → open p's lock (the one lock that carries p, `world/puzzle-multi-lock`), then run that hotspot's
    `then` (object) or mark the exit passable;
  - `failed` → that lock's `onFail` once;
  - `abandoned` → linear puzzles only.
- A key entering `open` (the last insert of a puzzle-less lock, a solve, an `unlock` effect) runs that lock's
  `onOpen` once (`fired` `open:<key>`), before the owner's `then`.
- `story` effects append to `pendingStory`. After every action, if `pendingStory` was empty before the action and is
  non-empty after, emit `story(head)`.
- `event-returned` pops the head. More pending → `story(next head)`; otherwise the `room` effect.
- `give` adds to `held` (+ `got`); `unlock` adds to `open`.
- `attempt-failed`, `hint-opened` → counters, `dirty`.

**The points the rules leave open** (erratum, RULINGS 21 Q5 / LW2 cut D7 with the addendum's C1 and developer
decisions; as merged, `38bc717`, `client/src/explore/reduce.ts:1-8`):
- **No-change actions** (D7(a) as restated by C1). An action that changes no state returns the same state object and
  no `dirty`, but keeps every effect its rule emits: the `lock` panel (a lock with a free slot, or a failed lock), the
  `puzzle` effect of a reopened puzzle (zero-slot locks included), the `look` text of a re-read, the resume `room` of
  `enter-section` on the current section, and `refused`. A change ends with exactly one `dirty`. A tap while
  `pendingStory` is non-empty emits nothing. Test: `reduce: an action that changes no state keeps its effects`.
- **`actions`** (D7(b)): a tap on every hotspot of the current room except a taken `take`, plus only the inserts
  `reduce` would accept (one slot-fit rule decides both); held items in sorted order; `[]` when `section` is null;
  only `event-returned` while `pendingStory` is non-empty.
- **An `unlock` effect** (D7(c)) opens the key and runs `onOpen` once. An object's `then` runs at once only when the
  opening action happens at that hotspot (its last insert, its puzzle solved); after a remote `unlock` it runs at
  the next tap.
- **`hint-opened`** (D7(d)) sets `hintsOpened = max(hintsOpened, tier)` and accepts tiers 1..`hintTiers` only.
- **A `leave` tap** (D7(e)) sets only `section = null` and emits `leave`.
- **An insert** (D7(f)) fills the first free slot whose `accepts` is the item; an absent `slots` entry counts as
  all-null, and `sectionKey` canonicalises it.
- **A dangling reference** (D7(g); only on worlds LW3 rejects) makes the action a no-op, never a throw.
- **Empty triggers** (an empty `then` / `onEnter` / `onOpen` / `onFail`) are never recorded in `fired`.
- **An open object's tap** emits its `look` text when it has one, then runs `then` once; only the `look` kind marks
  `examined`.
- **`puzzle-ended`**: a lock puzzle's outcome is final and `abandoned` is refused for it (X8); a linear puzzle (no
  lock) records the latest outcome, so a story that loops back for a retry projects the new one (L13 owns retries).

**The successor relation** (`successors`; the one model of what the player can reach):
- every action of `actions(w, s)`, through `reduce`;
- `event-returned` stands for the event knot reaching its explore yield (proved by `explore/event-return`,
  `explore/event-escape` and `play/event-no-return`);
- a `puzzle` effect for puzzle p expands into:
  - `closed` — the post-action state itself: Back with no outcome, or a reload, since the puzzle is an overlay;
  - one successor per outcome: `reduce(puzzle-ended p solved)` and, if p has `maxAttempts`, `failed`;
- `examined`, `visited`, attempts and hints opened are abstracted (they gate nothing): states are deduplicated by
  `sectionKey`;
- `leaves` marks a successor whose effects hold a `leave`.

`world/softlock` (build) and `reconcile` (runtime) both ask questions of this relation, from the same start
(`sectionEntry`), with the same key and the same cap (`RESUME_STATE_CAP`). So the checker covers exactly what the
runtime can reach, closed puzzles included, and the runtime search never exceeds a count the build accepted. Both
halves rest on X9 step 5's premise: the first entry of S is `sectionEntry` only because no other section writes S's
keys and every move stays inside its section, so no other section's play reaches S's rooms
(`world/cross-section-effect`, `world/cross-section-item`, `world/puzzle-multi-lock`, `world/cross-section-exit`).

**`resetSection(w, s, S)`** (inside `reconcile`, X9 steps 4 and 5):
- every key of S's rooms and hotspots leaves `taken`, `examined`, `open`, `slots`, `fired` and `visited`;
- the runs of S's lock puzzles are removed (each puzzle has one lock, `world/puzzle-multi-lock`, so no other
  section's run goes with them);
- the items and docs that S's hotspots and triggers give leave `held`, `used` and `docs`;
- `section` = null, `room` = null, `lastRoom[S]` removed; `pendingStory` = [];
- S leaves `unproved`.

Its callers pass a state whose `section` is S or null (X9 step 5), so the `section` / `room` / `pendingStory` rule
never clears another section's values.

The resume then calls `controller.enter(S, state)`, which dispatches `enter-section S` (through `admitSection`; S is
not in `unproved`, so `reduce` alone). With `section` = null this is
the entry branch: the start room becomes current, and its `onEnter`, re-armed by the reset, fires as on a first
entry. The result is `sectionEntry(w, s, S)`, the state the build's search starts from. X15 keeps other sections'
items out of S's requirements, so T9's proof covers it.

**The room batch** (GameSession, from the `room` effect):
- `[{ kind: 'scene', bg: room.bg, t: 'fade', ms: 400 }, { kind: 'props', props: <untaken props of the room> }]`;
- plus `{ kind: 'bgm', track: section.bgm }` when it differs from the playing track;
- plus `sfx` when the exit names one.

On an `event-returned` with an empty queue, the batch is skipped if `scene.snapshot()` already equals the room's
stage.

### Staging DSL additions (DSL v2; specified here, implemented and documented in STAGING-DSL.md by lane LW1)

| Kind | Syntax | Consumer | Assets | Typed command |
|---|---|---|---|---|
| `puzzle` | `puzzle:<puzzle> then=<knot>` (`then` required) | GameSession → PuzzleSession | — (the close-up comes from world data) | `{ kind: 'puzzle'; puzzle: PuzzleLocalId; then: KnotName }` |
| `explore` | `explore:<section>` | GameSession → ExploreController | — (rooms come from world data) | `{ kind: 'explore'; section: SectionId }` |

**Grammar.** It is the existing STAGING-DSL §2 grammar: `then` is an option, and knot names fit `value`. `parseTags`
checks the syntax and the id shape only. Existence is checked by the story lint against the chapter's world
(`parseTags`' signature does not change).

**Placement (the yield block).** The tag stands alone on a tag-only line, and the next source line is `-> DONE`.
Staging tag lines above it merge into the yield step's batch (§3.5) and run before the puzzle or the rooms.

**§7 batch conflicts.** At most one yield per batch: `puzzle` + `explore`, two `puzzle`s or two `explore`s →
`batch/conflict`.

**§10 change.** `-> DONE` is allowed directly after a yield line, and forbidden anywhere else.

**§8 knot index:**
- `puzzle … then=K` → K is a successor (preload and reachability).
- An `explore: S` yield → every knot named by S's effects and exits is a **reachability edge**. These knots are not
  in the preload `next`: the room controller preloads per room (X13), so a hub never preloads every event.
- An event knot's carried stage is seeded with the background and props of every room that triggers it
  (`budget/knot-set`).

**Lint codes:**

| Code | Sev | Rule | Lane |
|---|---|---|---|
| `yield/shape` | E | a `puzzle`/`explore` tag not alone on a tag-only line, or not followed by `-> DONE`. A `-> DONE` not directly after a yield line stays `ink/forbidden` (erratum at the LW1 merge, RULINGS 16 Q4: L3a's `lint: every finding is reported` pins it) | LW1 |
| `puzzle/unknown`, `explore/unknown-section` | E | the id is not in the chapter's world | LW3 |
| `puzzle/then-unknown` | E | `then=` names no knot of the chapter | LW3 |
| `puzzle/in-section` | E | a puzzle both yielded and attached to a lock | LW3 |
| `explore/event-return` | E | an event knot (named by a `story` effect of S) has no `explore: S` yield | LW3 |
| `explore/event-escape` | E | an event knot contains `-> END` or diverts to a knot that is not an event knot of S | LW3 |
| `world/schema` | E | `decodeWorldSource` issues (unknown key, missing field, bad id, wrong type) — every issue, never the first only | LW3 |
| `world/duplicate-id`, `world/id-reserved` | E | rooms collide across sections; a puzzle id ends in `_hints` | LW3 |
| `world/unknown-asset` | E | room `bg`, `prop`, `closeup` (cg), section `bgm`, exit `sfx` not in the catalog | LW3 |
| `world/unknown-ref` | E | an item, doc, puzzle, room or hotspot key referenced but not defined; an effect knot not in the chapter | LW3 |
| `world/one-way-exit` | E | a room→room exit without a reverse exit | LW3 |
| `world/hotspot-frame` | E | a rect outside the safe frame `x 80–1000, y 160–1760` | LW3 |
| `world/hotspot-small` / `world/hotspot-overlap` | W | a rect under 150×150 source px (44 CSS px at a 0.296 scale, 320×568); overlapping rects | LW3 |
| `world/props-per-room` | E | more than 8 props in a room | LW3 |
| `world/solution`, `world/solution-initial` | E | `PUZZLE_RULES[type].validateSolution` fails; the solution equals the initial state | LW3 |
| `world/order-pieces` | E | an `order` puzzle in a lock whose `pieces` differ from the lock's slot items | LW3 |
| `world/hint-count` | E | more than 3 hint tiers; a hint without an `id` | LW3 |
| `world/title-long` | E | a puzzle title over 18 graphemes (the invoice title `Подсказка 3: <title>` must fit 32 chars) | LW3 |
| `world/giveup-in-section`, `world/linear-requires`, `world/cross-section-item` | E | X8, X15 | LW3 |
| `world/cross-section-effect` | E | an `{ unlock: key }` in a room's `onEnter` or a hotspot's `then` / `onOpen` / `onFail` whose key is a hotspot of another section; an item or doc given (`gives`, `{ give }`) in more than one section. X15, X9 step 5's premise (revision 4) | LW3 |
| `world/puzzle-multi-lock` | E | a puzzle named by the `puzzle` field of more than one lock, in one section or in several; prints every lock that names it. X15, X9 step 5's premise, reducer rule `puzzle-ended` (revision 5) | LW3 |
| `world/cross-section-exit` | E | a room→room exit whose `to.room` is a defined room of another section than the exit's own; prints every such exit, so a crossing pair is two findings. A room that is not defined stays `world/unknown-ref`. X15, X12, X9 step 5's premise, reducer move rule (revision 6) | LW3 |
| `world/fail-without-effect` | E | a lock puzzle with `maxAttempts` and an empty `onFail` | LW3 |
| `world/var-type` | E | a declared projection VAR with the wrong type (`pz_*` int, `it_*` / `dc_*` bool) | LW3 |
| `world/softlock` | E | the model checker found a reachable state (over `successors`, closed puzzles included) with no path to a `leave` effect; prints the action path (as merged, LW2 `38bc717`: the shortest path from entry in BFS order, e.g. `tap hall.gate → insert hall.gate medal_sun → …`; a `closed` / `puzzle-ended` step prints as the action that opened the puzzle plus the outcome, `tap hall.gate → gate failed`) | LW3 |
| `world/unreachable` | W | an item, doc, room or puzzle no reachable state touches | LW3 |
| `world/state-cap` | E | the checker exceeded `RESUME_STATE_CAP` (5,000) states: the section is too large to prove at resume (X9); split it | LW3 |
| `play/event-no-return` | E | a seeded run entered an event knot and stopped without its explore yield | LW3 |
| `paid/leak` (extended) | E | a hint line ID or hint text under `client/src/story-gen/` | LW3 |
| `id/*`, `loc/*` (extended) | E/W | world texts follow STAGING-DSL §4 (IDs, uniqueness across ink and world, en entries) | LW3 |

**Seeded playthroughs** (`play/*`, extended):
- At a `puzzle` yield: an outcome uniformly from {solved; failed if `maxAttempts`; abandoned if `giveUp`}, hints
  0..tiers. Then `project` and `enter(then)`.
- At an `explore` yield: a random walk over `successors` (a closed puzzle included). Puzzle outcomes are random as
  above. A `story` effect runs the event knot until its yield; a `leave` effect continues the story. The step cap
  stays 5,000.

### TS types — changes to existing modules

```ts
// story/staging.ts (LW1)
export type PropId = Brand<string, 'PropId'>;
export type Rect = readonly [x: number, y: number, w: number, h: number];   // integer source px, 1080×2048 space
export type PropPlacement = { readonly prop: PropId; readonly rect: Rect };
export type PuzzleLocalId = Brand<string, 'PuzzleLocalId'>;  export type SectionId = Brand<string, 'SectionId'>;
export type StagingCommand = /* the eight v1 kinds */
  | { kind: 'puzzle'; puzzle: PuzzleLocalId; then: KnotName }
  | { kind: 'explore'; section: SectionId };
export type YieldCommand = Extract<StagingCommand, { kind: 'puzzle' | 'explore' }>;
export type PropsCommand = { kind: 'props'; props: readonly PropPlacement[] };     // built by GameSession, never parsed
export type StagingSnapshot = { bg; cg; chars; bgm; props: readonly PropPlacement[] };   // EMPTY_SNAPSHOT.props = []
// AssetId comment: + 'prop/<id>'

// story/runner.ts (L13)
export type RunnerStep =
  | /* line | choices | end as in PP */
  | { kind: 'yield'; yield: YieldCommand; commands: StagingCommand[]; knot: KnotName; enteredKnot: boolean };
export type RunnerError = /* PP kinds */ | { kind: 'not-at-yield' } | { kind: 'unknown-knot'; knot: KnotName }
                        | { kind: 'bad-projection'; name: VarName; detail: string };
export type StartPoint = /* PP kinds; 'exact' gains */ { kind: 'exact'; ink: string; atYield: YieldCommand | null } | …;

// story/save-codec.ts (L13) — SaveBodyV1 is born with these (no V2: nothing shipped)
at: { lineId: LineId | null; knot: KnotName | null; yield: YieldCommand | null };
world: WorldState;                  // EMPTY_WORLD_STATE for a chapter without a world
worldVersion: string | null;        // WorldPublic.version at save time; null without a world (reconcile, X9)

// story/catalog.ts (L13): LoadedChapter gains
world: WorldPublic | null;          // free: story-gen/free/<ch>.world.json; paid: ChapterPayload.world

// world/types.ts (LW2): the shapes of the source example above, with branded ids;
// WorldSource = puzzles carry `solution` + `hints`; WorldPublic = puzzles carry `hintTiers: 0|1|2|3` instead.
// take hotspots carry `then: Effect[]`; locks carry `onOpen: Effect[]` (both optional, default []).
export type WorldPublic = WorldPublicBody & { readonly version: string };   // worldVersion(body), stamped by emit (LW3)
export function decodeWorldSource(raw: unknown): Result<WorldSource, WorldIssue[]>;
export function decodeWorldPublic(raw: unknown): Result<WorldPublic, WorldIssue[]>;   // refuses `solution` / `hints`; requires `version`
export type WorldIssue = { path: string; reason: 'shape' | 'id' | 'line-id' | 'range' | 'hint-count' | 'secret'; detail: string };
  // erratum (RULINGS 21 Q5, LW2 cut D4; as merged, decode.ts:56-65): `path` dotted ('' = the file); LW3 maps
  // 'line-id' → id/missing / id/format, 'hint-count' → world/hint-count, every other reason → world/schema;
  // 'secret' = solution / hints in a public world; `version` must match /^[0-9a-f]{16}$/ ('shape' otherwise)
export function toPublic(w: WorldSource): WorldPublicBody;
export function toServer(w: WorldSource, en: Readonly<Record<LineId, string>>, chapter: ChapterId): ServerPuzzleContent;
export type ServerPuzzleContent = { format: 1; chapterId: ChapterId; puzzles: Record<PuzzleLocalId, {
  type: PuzzleType; answerLen: number; answerMax: number; solution: number[];
  title: { ru: string; en: string }; hints: Array<{ ru: string; en: string }> }> };

// scripts/story/emit.ts (LW3; build only, so 0 bytes in the bundle)
export function worldVersion(body: WorldPublicBody): string;
  // sha256(emitted body JSON with every WorldText { id, ru } replaced by 1)[0..16] (X9 World version)
  // erratum (RULINGS 21 Q2, PE7 final shape): the hashed input is { rules: RULES_VERSION, body: <textless body> },
  // so a rules edit with no world edit changes every world's version (LW3 test `emit: world version changes on a
  // RULES_VERSION bump`, beside `emit: world version changes on a rules edit`)

// geom/cover.ts (L11)
export type Size = { w: number; h: number };
export type Cover = { scale: number; offsetX: number; offsetY: number };     // stage px = source px × scale + offset
export function cover(stage: Size, source: Size): Cover;
export function toStage(r: Rect, c: Cover): { x: number; y: number; w: number; h: number };
export function minTarget(r: { x: number; y: number; w: number; h: number }, minCssPx: number): { x: number; y: number; w: number; h: number };
export const ROOM_SOURCE: Size;                     // { w: 1080, h: 2048 }
export const HOTSPOT_SAFE_FRAME: { x0: 80; x1: 1000; y0: 160; y1: 1760 };
```

### Rust types

```rust
// ids.rs (L6b; an addition, RULINGS 9 Q2)
/// A chapter-qualified puzzle id, `ch<N>.<local>`.
pub struct PuzzleId(pub String);

// content.rs (L6b): ContentStore gains the puzzle index
pub struct PuzzleDef { pub id: PuzzleId, pub chapter: ChapterId, pub answer_len: usize, pub answer_max: u16,
                       pub solution: Vec<u16>, pub title: Localized, pub hints: Vec<Localized> }
pub struct Localized { pub ru: String, pub en: String }
impl ContentStore { pub fn puzzle(&self, id: &PuzzleId) -> Option<&PuzzleDef>; pub fn chapter_world(&self, ch: &ChapterId) -> Option<&RawValue>; }

// catalog.rs (L6b): products are chapters (from the file) and hint tiers (derived from the puzzle index)
pub enum ProductRef { Chapter { chapter: ChapterId }, Hint { puzzle: PuzzleId, tier: u8 } }
pub struct Product { pub id: ProductId, pub kind: ProductRef, pub price_stars: u32, pub title: Localized, pub description: Localized }
pub struct Prereqs { pub prev_tier: Option<ProductId>, pub chapter: Option<ProductId>, pub unsolved: Option<PuzzleId> }
impl Catalog {
    pub fn product(&self, id: &ProductId) -> Option<&Product>;
    pub fn chapters(&self) -> impl Iterator<Item = &Product>;        // GET /api/entitlements lists these only
    pub fn prereqs(&self, id: &ProductId) -> Prereqs;               // all None for a chapter product
}
pub fn parse_product_id(s: &str) -> Option<ProductRef>;            // "chapter:ch2" | "hint:ch1.drawer:2"

// puzzles/mod.rs (L6c)
pub const ATTEMPT_WINDOW_SECS: i64 = 600;  pub const ATTEMPT_WINDOW_MAX: i64 = 20;  pub const MAX_ANSWER_LEN: usize = 16;
pub enum Lang { Ru, En }
#[derive(Debug, thiserror::Error)] pub enum AnswerError { #[error("answer length")] Length, #[error("answer value")] Range }
pub fn check_answer(def: &PuzzleDef, answer: &[u16]) -> Result<bool, AnswerError>;
pub enum AttemptOutcome { Correct, Wrong, RateLimited { retry_after_secs: i64 } }
pub async fn attempt(st: &AppState, user: UserId, id: &PuzzleId, answer: &[u16]) -> Result<AttemptOutcome, ApiError>;
pub async fn status(st: &AppState, user: UserId, id: &PuzzleId, lang: Lang) -> Result<PuzzleStatus, ApiError>;

// db/puzzles.rs (L6c)
pub struct AttemptRecord { pub limited: bool, pub retry_after_secs: i64, pub solved: bool }
impl Repo {
    pub async fn record_attempt(&self, u: UserId, p: &PuzzleId, correct: bool, now: i64) -> Result<AttemptRecord, sqlx::Error>;
    pub async fn is_solved(&self, u: UserId, p: &PuzzleId) -> Result<bool, sqlx::Error>;
    pub async fn owned_products(&self, u: UserId, prefix: &str) -> Result<Vec<ProductId>, sqlx::Error>;   // "hint:ch1.drawer:"
    // SQL: WHERE user_id = $1 AND starts_with(product_id, $2) (PG 11+), never LIKE $2 || '%': `_` in a puzzle id is a
    // LIKE wildcard (RULINGS 14, design/db/decision.md §4.6)
}

// api/dto.rs (L6c; ts-rs)
#[derive(Serialize, TS)] #[serde(rename_all = "camelCase")]
pub struct PuzzleStatus { pub puzzle_id: String, pub solved: bool, pub hints: Vec<HintTier> }
#[derive(Serialize, TS)] #[serde(rename_all = "camelCase")]
pub struct HintTier { pub tier: u8, pub product_id: String, pub price_stars: u32, pub owned: bool, pub text: Option<String> }
#[derive(Deserialize, TS)] #[serde(rename_all = "camelCase")]
pub struct AttemptRequest { pub answer: Vec<u16> }
#[derive(Serialize, TS)] #[serde(rename_all = "camelCase")]
pub struct AttemptResponse { pub correct: bool, pub solved: bool }
// ChapterPayload (L6b) gains `world: unknown` (raw JSON or null).

// error.rs (L6c): two variants + codes; the no-wildcard match and the wire tests are updated
#[error("rate limited")] RateLimited { retry_after_secs: i64 },   // 429 rate_limited + Retry-After header
#[error("hint unavailable")] HintUnavailable,                      // 409 hint_unavailable

// telegram/payments.rs (L8b)
pub enum RejectReason { UnknownOrder, Mismatch, AlreadyOwned, InProgress, Expired, Temporary, Unavailable }
```

### SQL — `server/migrations/0002_puzzles.sql` (L6c; `0001` is the PostgreSQL schema of LDB1)

PostgreSQL dialect (RULINGS 14; `D:/tmp/novel-orch/design/db/decision.md` DB-3, §4.6): every integer is `BIGINT`
(Rust `i64`; sqlx's `i64` is `INT8` with no widening), times are unix seconds, every constraint is named so the tests
assert `(SQLSTATE, constraint())`, no `STRICT`.

```sql
CREATE TABLE puzzle_progress (                  -- server facts per (user, puzzle): rate limit + solved
  user_id         BIGINT NOT NULL,
  puzzle_id       TEXT   NOT NULL,
  attempts        BIGINT NOT NULL,              -- lifetime; a row exists only after one
  window_start    BIGINT NOT NULL,
  window_attempts BIGINT NOT NULL,
  first_at        BIGINT NOT NULL,
  solved_at       BIGINT,                       -- set once (guarded update), never cleared
  CONSTRAINT puzzle_progress_pkey               PRIMARY KEY (user_id, puzzle_id),
  CONSTRAINT puzzle_progress_user_fk            FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT puzzle_progress_id_shape           CHECK (puzzle_id ~ '^ch[1-9][0-9]*[.][a-z][a-z0-9_]*$'),
                                                -- = the PuzzleId grammar (Identifiers): ch<N> '.' PuzzleLocalId
  CONSTRAINT puzzle_progress_attempts_positive  CHECK (attempts >= 1),
  CONSTRAINT puzzle_progress_window_bounded     CHECK (window_attempts >= 1 AND window_attempts <= attempts),
  CONSTRAINT puzzle_progress_solved_after_first CHECK (solved_at IS NULL OR solved_at >= first_at),
  CONSTRAINT puzzle_progress_window_after_first CHECK (window_start >= first_at)
);
```

- **The id CHECK is the `PuzzleId` grammar, not the old GLOB's translation** (`^ch[1-9].*[.][a-z]`, which admits
  `ch1x.a`, `ch1.a.b`, `ch1.a-b`). The chapter part is the STAGING-DSL `id/format` chapter (`ch[1-9][0-9]*`); the
  local part is `PuzzleLocalId` (`[a-z][a-z0-9_]*`). PostgreSQL regex bracket ranges are code-point ranges, whatever
  the database collation (REL_18_STABLE `src/backend/regex/regc_locale.c` `range()`: the case-sensitive branch is
  `addrange(cv, a, b)`), so `ch1.é` is refused on every host. Test: `schema_puzzle_id_shape`.
- **The FK column is indexed.** `user_id` leads `puzzle_progress_pkey` (the decision §4.1 rule: PostgreSQL does not
  index referencing columns itself).
- **No table for hint unlocks.** A hint unlock is an `entitlements` row (X6); refund = the existing `DELETE … WHERE
  charge_id`.
- **The build script.** `server/build.rs` (`println!("cargo:rerun-if-changed=migrations");`) makes `migrate!` see the
  new file in incremental builds (`db/mod.rs` doc comment).
- **The attempt transaction** (write-first; one READ COMMITTED transaction; `$4` binds `ATTEMPT_WINDOW_SECS`, and
  Rust compares the returned `window_attempts` with `ATTEMPT_WINDOW_MAX`). **Existing-row columns are qualified**
  (`AS p`): an unqualified column in `ON CONFLICT DO UPDATE SET` is ambiguous in PostgreSQL (decision §4.6).

```sql
INSERT INTO puzzle_progress AS p (user_id, puzzle_id, attempts, window_start, window_attempts, first_at, solved_at)
VALUES ($1, $2, 1, $3, 1, $3, NULL)
ON CONFLICT (user_id, puzzle_id) DO UPDATE SET
  attempts        = p.attempts + 1,
  window_attempts = CASE WHEN p.window_start <= $3 - $4 THEN 1  ELSE p.window_attempts + 1 END,
  window_start    = CASE WHEN p.window_start <= $3 - $4 THEN $3 ELSE p.window_start END
RETURNING window_attempts, window_start, solved_at;     -- $1 user, $2 puzzle, $3 now, $4 = ATTEMPT_WINDOW_SECS (600), bound
-- window_attempts > ATTEMPT_WINDOW_MAX (20) → COMMIT; 429, Retry-After = window_start + 600 − now; correctness is not
--   used or revealed
-- correct → UPDATE puzzle_progress SET solved_at = $3 WHERE user_id = $1 AND puzzle_id = $2 AND solved_at IS NULL;
-- COMMIT
```

- **Two concurrent attempts serialize.** The `DO UPDATE` locks the row (a first-ever pair: the second insert waits
  on the first, then takes the update path), so the window count is exact.

- **Pre-checkout** (K18, changed by this plan; L8b). One READ COMMITTED transaction inside K18's `timeout(2 s)`
  (decision DB-4, §4.4):
  0. the payer-row lock, `SELECT 1 FROM users WHERE id = $1 FOR NO KEY UPDATE` (`$1` = `from.id`). This is DB-4's
     change to K18 itself; PP K18 gains it with the port lanes;
  1. one PK read, `SELECT product_id FROM orders WHERE id = $2` (`$2` = the payload; none → `UnknownOrder`);
  2. `catalog.prereqs(product)` in Rust (no I/O);
  3. the K18 conditional UPDATE with three nullable predicates.

  The predicates come after the lock, so they read a snapshot taken after any concurrent pre-checkout of this payer
  committed. For a chapter product all three parameters are NULL: the same effect as before.

```sql
   … K18 predicates unchanged ($1 from.id, $2 payload, $3 now, $4 amount, $5 currency; PG text: decision §4.4) …
   AND ($6 IS NULL OR EXISTS (SELECT 1 FROM entitlements e WHERE e.user_id = orders.user_id AND e.product_id = $6))
   AND ($7 IS NULL OR EXISTS (SELECT 1 FROM entitlements e WHERE e.user_id = orders.user_id AND e.product_id = $7))
   AND ($8 IS NULL OR NOT EXISTS (SELECT 1 FROM puzzle_progress p
                                   WHERE p.user_id = orders.user_id AND p.puzzle_id = $8 AND p.solved_at IS NOT NULL))
RETURNING id;
```

  - `$6` = `prereqs.prev_tier`, `$7` = `prereqs.chapter`, `$8` = `prereqs.unsolved`, bound as `Option<&str>`: sqlx
    declares them TEXT, so `$n IS NULL` is typed.
  - A puzzle attempt never takes the payer lock (decision §4.4 lock table), so a solve that commits while the UPDATE
    runs is not seen. That is benign: the player gets the hint they paid for (concurrency row "Puzzle solved on
    device A…").

  The classification read gains `Unavailable` (one of the three predicates failed). Its ru/en `error_message` sits
  next to the other reasons' texts (PE5).

### HTTP API additions

Common rules as in PP (bearer, JSON camelCase, `no-store`, 16 KB default body limit).

| Method + path | Auth | Request | 200 response | Errors | Idempotency; caching |
|---|---|---|---|---|---|
| `GET /api/puzzles/{puzzleId}?lang=ru\|en` | bearer | — | `PuzzleStatus { puzzleId, solved, hints: HintTier[] }`, `HintTier { tier, productId, priceStars, owned, text: string\|null }` (`text` only when owned) | 400 `bad_request` (id or lang), 403 `not_entitled` (a paid chapter's puzzle without the chapter), 404 `not_found` | read; `private, no-store` |
| `POST /api/puzzles/{puzzleId}/attempts` | bearer | `AttemptRequest { answer: number[] }` (≤ 16 entries, each ≤ 65535) | `AttemptResponse { correct, solved }` | 400 (shape: `answerLen` / `answerMax`), 403, 404, 429 `rate_limited` + `Retry-After` | the result is a pure function of the answer; a retry counts once more toward the window (bounded, accepted); `no-store` |
| `POST /api/invoices` (changed) | bearer | `CreateInvoiceRequest { productId }`: `chapter:<ch>` or `hint:<puzzleId>:<tier>` | as PP | as PP + 409 `hint_unavailable` (tier order, solved, paid chapter not owned) | as PP (reuse a `created` order < 1 h) |
| `GET /api/entitlements` (changed) | bearer | — | chapter products only | as PP | read |
| `GET /api/chapters/{id}` (changed) | bearer | — | `ChapterPayload` + `world: unknown` (the paid public world, or `null`) | as PP | as PP |

No dev route is added: the fake Stars sheet and `/dev/simulate-payment` work for any order slug.

### Server formats (story tool → server; the committed fixtures are the contract)

```jsonc
// server/content/puzzles/<ch>.json — emitted by the story tool for EVERY chapter (free ones included)
{ "format": 1, "chapterId": "ch1",
  "puzzles": { "drawer": { "type": "code", "answerLen": 4, "answerMax": 9, "solution": [1, 8, 4, 7],
                           "title": { "ru": "Ящик стола", "en": "Desk drawer" },
                           "hints": [ { "ru": "…", "en": "…" }, { "ru": "…", "en": "…" }, { "ru": "…", "en": "…" } ] } } }

// server/catalog.json — hand-written (L6b); prices are server-only; `chapters` changed by STORIES-PLAN Y6: { defaultPriceStars, priceStars, title, description } over the story index
{ "chapters": [ { "productId": "chapter:ch2", "chapterId": "ch2", "priceStars": 1,          // PLACEHOLDER (Q3)
                  "title": { "ru": "Глава 2", "en": "Chapter 2" }, "description": { "ru": "…", "en": "…" } } ],
  "hints": { "priceStars": [1, 1, 2],                                                     // PLACEHOLDER (Q14), by tier
             "title": { "ru": "Подсказка {tier}: {puzzle}", "en": "Hint {tier}: {puzzle}" },
             "description": { "ru": "Подсказка к головоломке «{puzzle}».", "en": "A hint for “{puzzle}”." } } }
```

**Startup checks** (`StartupError::Content`):
- every puzzle tier has a price;
- every rendered hint invoice title is 1–32 chars and every description 1–255 chars;
- every catalog chapter has content.

The fixture `server/tests/fixtures/content/puzzles/ch1.json` is also read by the story tool's test
`emit: server puzzle content matches the server fixture shape`, so the TS producer and the Rust consumer test against
one file.

### Build outputs (additions to PP "Build outputs")

| Output | Free chapter | Paid chapter |
|---|---|---|
| public world (`WorldPublic`) | `client/src/story-gen/free/<ch>.world.json` | `server/content/chapters/<ch>/world.json` (in `ChapterPayload.world`) |
| server puzzle content | `server/content/puzzles/<ch>.json` | same |
| en table | hint IDs excluded (they live in the server puzzle content only) | same |
| `usage.json` | `+ worldAssets` per chapter (room bgs, props, close-ups, section bgm, exit sfx: asset tiering and `scan-dist`'s paid-only check) and `rooms: { "<ch>/<section>/<room>": { bg, props[], closeups[], neighbours[] } }` (`budget/room-set`) | same |

---

## Module API

```ts
// puzzles/session.ts (LP2) — one per open puzzle; GameSession (yields.ts) creates and disposes it
export type PuzzleMode = 'linear' | 'explore';
export type AttemptResult = { kind: 'correct' } | { kind: 'wrong'; attemptsLeft: number | null } | { kind: 'failed' };
export type PuzzleError = { kind: 'network' } | { kind: 'rate-limited'; retryAfterSecs: number }
                        | { kind: 'not-entitled' } | { kind: 'busy' } | { kind: 'closed' };
export type HintTierView = { tier: number; productId: ProductId; priceStars: number; text: string | null;
                             state: 'owned' | 'buyable' | 'locked' | 'unavailable' };
export type PuzzleEnd = { outcome: 'solved' | 'failed' | 'abandoned' | 'closed'; hintsOpened: number };
export interface PuzzleSession {
  readonly id: PuzzleId; readonly local: PuzzleLocalId; readonly mode: PuzzleMode;
  answer(): readonly number[]; setAnswer(a: readonly number[]): void;
  attempt(): Promise<Result<AttemptResult, PuzzleError>>;      // single-flight; a wrong answer dispatches attempt-failed
  hints(): Promise<Result<readonly HintTierView[], PuzzleError>>;   // texts kept in this session's memory only
  openHint(tier: number): void;                                // dispatches hint-opened
  buyHint(tier: number): void;                                 // PurchaseFlow(productId hint:<id>:<tier>)
  giveUp(): void;                                              // linear only → end 'abandoned'
  close(): boolean;                                            // explore → end 'closed'; linear → false; deferred while an attempt is in flight
  onEnd(fn: (e: PuzzleEnd) => void): Unsubscribe;
  dispose(): void;                                             // aborts in-flight requests; idempotent
}
export function createPuzzleSession(deps: { api: Endpoints; purchase: (p: ProductId) => PurchaseFlow; world: WorldPublic;
  chapter: ChapterId; puzzle: PuzzleLocalId; mode: PuzzleMode; run: PuzzleRun; lang: () => 'ru' | 'en';
  dispatch: (a: ExploreAction) => void }): PuzzleSession;
// puzzles/registry.ts (LP2)
export function loadPuzzleUi(t: PuzzleType): Promise<Result<Component<PuzzleUiProps>, { kind: 'chunk'; detail: string }>>;
export type PuzzleUiProps = { params: unknown; answer: readonly number[]; busy: boolean;
                              onChange: (a: readonly number[]) => void; labels: (id: LineId) => string };

// explore/controller.ts (LX) — lives in the explore-ui chunk; owned by GameSession, one per chapter
export type HotspotView = { key: HotspotKey; kind: Hotspot['kind']; label: string;
                            css: { x: number; y: number; w: number; h: number }; done: boolean; locked: boolean };
export interface ExploreController {
  enter(section: SectionId, state: WorldState): void;           // explore yield → admitSection (enter-section) | event-returned
  dispatch(a: ExploreAction): void;                             // taps, inserts, puzzle results
  back(): boolean;                                              // `tap` on the open exit to the previous path room; false when empty
  onPath(fn: (walkable: boolean) => void): Unsubscribe;         // the path's empty ↔ non-empty edges; called once on subscribe
  resize(stage: Size): void;                                    // stage = the stage host's content box (X10); recomputes hotspot CSS rects
  state(): WorldState;
  onEffect(fn: (e: ExploreEffect) => void): Unsubscribe;
  dispose(): void;                                              // releases room:* holders, disconnects the ResizeObserver, unsubscribes
}
export function createExploreController(deps: { world: WorldPublic; manifest: AssetManifest;
  scene: Pick<SceneController, 'preload' | 'releasePreload'>; view: ExploreViewStore; text: (t: WorldText) => string;
  stageHost: HTMLElement }): ExploreController;                 // the Stage.svelte element: Pixi's resizeTo box, observed for resize()

// scene/controller.ts (L11): one debug addition, wired to __novelDebug only under __TG_MOCK__ (like debugForceContextLoss)
debugPropRects(): ReadonlyArray<{ prop: PropId; x: number; y: number; w: number; h: number }>;   // page CSS px of live prop sprites

// ui/screens.ts (L14a) — one owner of the Telegram BackButton
export type Screen = 'menu' | 'backlog' | 'settings' | 'saves' | 'chapters' | 'paywall' | 'terms'
                   | 'inventory' | 'document' | 'lock' | 'puzzle' | 'hints';
export function setRootBack(fn: (() => void) | null): void;   // visible = stack.length > 0 || rootBack !== null

// purchase/flow.ts (L10) — generic over the ownership check
export function createPurchaseFlow(deps: { api: Endpoints; tg: TelegramClient; clock: Clock;
  isOwned: (p: ProductId) => Promise<Result<boolean, ApiError>>;   // chapters: entitlements; hints: GET /api/puzzles
  onState: (s: PurchaseState) => void }): { buy(p: ProductId): void; checkAgain(): void; onActivated(): void; dispose(): void };

// story/runner.ts (L13)
enter(knot: KnotName, projection: Readonly<Record<VarName, InkScalar>>): Result<void, RunnerError>;
  // only while current() is a yield step; each name ∈ meta.vars and typeof equal to its current value; then ChoosePathString(knot)

// api/endpoints.ts (L10)
getPuzzle(id: PuzzleId, lang: 'ru' | 'en'): Promise<Result<PuzzleStatus, ApiError>>;
postAttempt(id: PuzzleId, answer: readonly number[]): Promise<Result<AttemptResponse, ApiError>>;   // 429 → ApiError http + retryAfter
```

---

## Critical flows

### F6. Linear puzzle (`# puzzle: cabinet then=archive_after`)

| # | Actor | Step | If it fails / repeats |
|---|---|---|---|
| 1 | client | `runner.next()` → `yield` step; the batch's staging runs; autosave (`at.yield` set) | — |
| 2 | client | `createPuzzleSession(mode 'linear')`; the scene ensures `closeup` (cg) and the controller releases `room:*`; `loadPuzzleUi(type)` | chunk load error → "Couldn't load" + Retry (no outcome) |
| 3 | player | sets the dials, taps Try → `POST /attempts` | double tap → one request (single-flight); network → toast, nothing counted; 429 → "wait N s", Try disabled until then; 401 → single-flight re-auth, retry once |
| 4 | server | upsert window; limited → 429; check the answer; correct → `solved_at` (guarded) | concurrent attempts from two devices → both answered; the first `solved_at` stays |
| 5 | client | wrong → `attempt-failed` (autosave); at `maxAttempts` → end `failed`; correct → end `solved`; Give up (confirmed) → `abandoned` | `deactivated` mid-request → it completes; nothing to pause |
| 6 | client | `reduce(puzzle-ended)` → `project` → `runner.enter(then, projection)` → `next()`; the then-knot branches on `pz_cabinet` | `enter` error value (undeclared var / unknown knot; prevented by lint) → the story-error screen (PP F2) |

### F7. Exploration

| # | Actor | Step | If it fails / repeats |
|---|---|---|---|
| 1 | client | `explore: manor` yield → load the explore-ui chunk (prefetched) → `controller.enter(manor, world)` (through `admitSection`: an `unproved` section is proved first, X9 step 5) → `room` effect → room batch (scene fade 400 ms + props + section bgm); preload neighbours (X13); subscribe `onPath` → `setRootBack` at its edges (hidden in the start room and after a reload: the path is empty) | chunk error → error screen with Retry (resume re-yields); an `unproved` section the current world cannot produce → `reset` effect, the section restarts from its entry, toast `explore.area_reset` |
| 2 | player | taps a `take` hotspot → `got` toast + haptic `success`; the prop leaves the picture; its `then` runs once; `dirty` → autosave in 2 s | double tap → the second tap finds the hotspot taken: no effect |
| 3 | player | taps `exit` → move: fade, holders updated, path pushed (cleared if the reverse exit is locked), `onEnter` once | target bg not preloaded → `ensure` behind the fade; over the hard cap → K5 skip path; Back during the fade → `scene.complete()`, no move |
| 4 | client | `onEnter: story` (or a `take` / `onOpen` / `onFail` story) → `pendingStory` → GameSession hides the explore UI, `setRootBack(null)`, `project` → `runner.enter(knot)` → ink lines | the knot's last block `explore: manor` → `event-returned` → next pending, or back to the room (the root-back restored from the path state); Back during the event never moves rooms (the root-back is cleared and the reducer refuses taps while `pendingStory` is non-empty) |
| 5 | player | taps the gate → lock panel → taps held medallions → `insert` (wrong item → "doesn't fit" + haptic `error`, state unchanged) | — |
| 6 | client | last slot → `puzzle` effect → PuzzleSession (mode 'explore'); Back closes it with no outcome | a later tap on the gate (every slot filled, no outcome) reopens it at its start, attempts kept; a reload lands in the room, and the same tap reopens it |
| 7 | client | solved → lock open → tap the gate → `leave(manor_out)` → `section = null`, `setRootBack(null)`, `project`, `runner.enter('manor_out')` | 3 wrong → `failed` → `onFail`: the story knot `manor_gate_forced`, then `unlock` → the gate passes; `pz_gate = 2` |

### F8. Hint purchase

| # | Actor | Step | If it fails / repeats |
|---|---|---|---|
| H1 | client | Hint → `GET /api/puzzles/{id}?lang` → ladder: owned tiers show text (opening one dispatches `hint-opened`), the next tier buyable, later ones locked; solved → nothing buyable | 403 (a paid chapter not owned; cannot happen in a played paid chapter) → toast |
| H2 | client | Buy tier n → terms confirmation (once per session) → `PurchaseFlow.buy('hint:<id>:<n>')` = PP P2–P7 | double tap → one flow (button disabled, order reuse) |
| H3 | server | `POST /api/invoices`: product → 409 `already_owned` / `hint_unavailable` → order → link | gateway error → 502 (PP P3) |
| H4 | Telegram → server | pre-checkout: payer-row lock (DB-4) + PK read + UPDATE with the hint predicates → answer | prerequisite missing / solved / chapter not owned → `ok=false` `Unavailable`; no charge |
| H5 | Telegram → server | `successful_payment` → K19 grant (`entitlements` row) → 200 | duplicate → `Duplicate`; solved in between → granted anyway (delivered as advertised) |
| H6 | client | order `paid` → `isOwned` via `GET /api/puzzles` → the tier text appears and counts as opened | webhook late → `delayed`, Check again (PP P7) |
| H7 | admin | `/refund <charge>` → K20 revoke deletes the row | the next status fetch → `owned: false`, `text: null`; this run's `hintsOpened` is unchanged |

### F9. Save and resume in exploration or a puzzle (changes PP F3)

- **Autosave triggers added:**
  - a `dirty` effect, debounced 2 s (one PUT in flight, the newest supersedes: PP F3);
  - every yield step;
  - `attempt-failed`;
  - `hint-opened`.
- **The body.**
  - `ink` = the stopped story at the yield (or mid-event);
  - `at.yield`;
  - `world` + `worldVersion`;
  - `staging` (incl. `props`).
- **Resume levels:**
  - **Exact** → the runner's current step = the stored yield.
    - A `puzzle` yield (a linear puzzle) reopens at its start with saved attempts.
    - An `explore` yield resumes in `world.room` with an empty path. An exploration puzzle that was open is closed
      with no outcome (it is an overlay, not a yield); a tap on its lock reopens it at its start, attempts kept.
  - **Checkpoint** (story update) → `reconcile(world, …, body.worldVersion)`; the knot top replays up to its yield.
  - **Every level** passes `world` through `reconcile` with `body.worldVersion`. After a rules change (a text-only
    edit keeps the version), the state is normalized, and every section is checked: the current one at this load,
    every other one at its next entry (X9 steps 4 and 5). A section's state is kept only if the current world can
    produce it from section entry. Otherwise the section restarts from the entry, with the toast
    `explore.area_reset` (X9), and the start room's `onEnter` runs again.
  - **Chapter start** → `EMPTY_WORLD_STATE`.
  - Mid-event exact → the same ink line; the `pendingStory` head is that event.

### F10. Chapter change (changes PP F4)

- `ExploreController.dispose()` releases `room:*` holders.
- `WorldState` resets to `EMPTY_WORLD_STATE`.
- Puzzle sessions are disposed; their hint texts are dropped.
- The props layer clears with `restore(EMPTY_SNAPSHOT)`.

---

## Concurrency and failure model (additions to PP's table)

| Situation | Authority | Outcome |
|---|---|---|
| Double tap on Try / on a hotspot | session single-flight / reducer | one request / one effect (a taken hotspot is gone) |
| Attempt response after the panel closed | session generation | a close is deferred while an attempt is in flight (bounded by the HTTP timeout); after `dispose()` the response is dropped. The server may have set `solved_at` — harmless (replays are allowed) |
| Network error on Try | client | no `attempt-failed`; toast "Couldn't check"; retry |
| 429 | server window | toast with seconds; Try disabled until `Retry-After` |
| Two devices attempt the same puzzle | the upsert's row lock + the `solved_at IS NULL` guard | serialized: both answered, both counted exactly in the window; one `solved_at` |
| Tier 2 bought while tier 1's payment is pending | pre-checkout | `Unavailable`, no charge; the UI enables tier 2 only after tier 1 is owned (server truth) |
| Puzzle solved on device A while device B pays for a hint | grant | granted (pre-checkout passed before the solve); the text is delivered |
| Duplicate `successful_payment` for a hint | `payments` PK | `Duplicate` — `hint_purchase_duplicate_concurrent_grants_once` |
| Refund of a consumed hint | K20 revoke | the entitlement is deleted; the text is no longer served; the knowledge stays with the player (policy: Q15); this run's `pz_*_hints` is unchanged |
| A forged save marks a puzzle solved or items held | — | the player's own progress (PP design log 10); it never unlocks a paid hint or chapter (those read `entitlements` / `puzzle_progress` only) |
| Story update removed, renamed or reshaped a room, item, hotspot or lock | `reconcile` (X9) | same `worldVersion` (texts and line IDs do not change it) → the state unchanged. Otherwise: ids dropped; missing room → section start; missing pending knot → dropped; slots resized to the new lock (non-matching items back to `held`); a `taken` hotspot or fired trigger whose gift is held nowhere gives again. The current section's state is then kept only if the current world can produce it from section entry (`inSectionReach`, at most 5,000 states, ≤ 300 ms at CPU 4×); otherwise the section restarts from its entry (the start room's `onEnter` runs again) with a toast. Every other section joins `unproved` and gets the same check at its next entry (`admitSection`, one search, before the player can act in it), so a section left through a `leave`, or left behind in another section, cannot come back unchecked. The check reverts only old-world progress: a trigger never writes another section's state (`world/cross-section-effect`, X15), a puzzle run belongs to its one lock's section (`world/puzzle-multi-lock`, X15), and no move leaves its section, so a section's hotspots are tapped only while it is current (`world/cross-section-exit`, X15), so no progress the current version made is lost. Never throws, never strands (T9, T11) |
| Reload mid-puzzle | save | linear: the puzzle reopens at its start (its yield), attempts kept. Exploration: the room resumes with the puzzle closed and no outcome; a tap on its lock reopens it at its start, attempts kept |
| Reload in exploration | save | the same room, inventory, slots and taken props; BackButton hidden until the first move |
| Back pressed while an event knot runs | `yields.ts` root-back + reducer guard | the root-back is cleared from event start to its return; a `tap` while `pendingStory` is non-empty is refused, so no room move runs under the dialogue |
| Back pressed during the door fade | GameSession intent queue | coalesces into `scene.complete()`; no move |
| `deactivated` in exploration or a puzzle | client | no timers to pause; the debounced autosave flushes (PP: `deactivated` autosaves); hint purchase polling pauses (PP P7) |
| WebGL context lost while exploring | scene | rebuild + `restore(snapshot)` incl. `props` (PP row) |
| A puzzle or explore chunk fails to load | client | Result error → toast + Retry; exploration closes the panel with no outcome; linear keeps the mode with a Retry button |
| Token expiry during Try or a hint fetch | `api/http.ts` | single-flight re-auth, retry once (PP) |
| An event knot never returns (an authoring bug) | lint | `explore/event-return`, `explore/event-escape`, `play/event-no-return` fail the story gate |
| A preload completes after the player left the room | registry | holder released → destroyed at once (PP "preload vs knot exit") |

---

## Paid-content protection (additions to PP's section)

1. **Build routing.** Solutions and hint texts go only to `server/content/puzzles/`. Paid chapters' public worlds go
   only to `server/content/chapters/<ch>/world.json`.
2. **Gates:**
   - `paid/leak` (story) — hint IDs and texts never under `story-gen/`.
   - `scan-dist` — fingerprints rebuilt from `story/*/world.json` + `story/locales/en/*.json`: every hint line ID and
     every hint text (ru and en) ≥ 12 chars. Non-vacuous: if the sources hold any hint, the derived set must be
     non-empty, else FAIL.
   - `scan-dist` — paid-world fingerprints from the same sources: for every paid chapter of `story/chapters.json` with
     a `story/<ch>/world.json`, every world line ID and every world text (ru, and en from
     `story/locales/en/<ch>.json`) ≥ 12 chars. Matched like every fingerprint, `data:` URIs decoded. Non-vacuous: a
     paid chapter with a world and an empty derived set FAILs. Tests: `scan: paid world text in dist fails`,
     `scan: paid world sources present but no fingerprints fails`.
   - `emit: public world has no solution or hint fields`.
   - `decodeWorldPublic` refuses `solution` / `hints` (the runtime refuses a leaked world).
3. **Delivery.** `GET /api/puzzles/{id}`: bearer → chapter entitlement (paid) → `text` only for owned tiers;
   `private, no-store`. Attempts reveal only right or wrong.
4. **Client memory only.** Hint texts are never in CloudStorage, DeviceStorage or `localStorage` (test
   `hints: texts never written to storage`).
5. **Server tests:**
   - `puzzle_hint_text_only_when_owned`
   - `puzzle_status_private_no_store`
   - `attempt_paid_chapter_403_without_entitlement`
   - `hint_text_403_for_unowned_paid_chapter`
   - a free chapter's world is a static file: the existing `free_chapter_not_served_by_api` covers its route

---

## Resource lifetime (additions)

| Resource | Owner | Created | Destroyed | Leak detected by |
|---|---|---|---|---|
| `PuzzleSession` (+ its `AbortController`, hint texts) | `app/yields.ts` | puzzle effect / yield | end, close, chapter change, `dispose()`; changed by STORIES-PLAN (revision 1): also `exitToStories()`, before its autosave | `session: dispose aborts the attempt`, `game_holds_at_most_one_puzzle_session`, `game: exit to stories disposes explore, puzzle and purchase sessions` |
| Puzzle UI component | `PuzzleHost.svelte` | session open | session end | `puzzle host: unmount on end` (dom) |
| Lazy chunk modules | browser module cache | first `import()` | app lifetime (code, not data) | budget rows |
| `ExploreController` (+ `ResizeObserver` on the stage host, `deps.stageHost`) | GameSession | first explore yield of the chapter | chapter change, new game, `dispose()` (disconnects the observer); changed by STORIES-PLAN (revision 1): also `exitToStories()`, after its autosave | `game_holds_one_explore_controller`, `controller: dispose releases room holders`, `game: exit to stories disposes explore, puzzle and purchase sessions` |
| `room:<id>` preload holders | `ExploreController` | room entry | move away (non-neighbour), puzzle with a close-up opens, section exit, `dispose()` | `controller: puzzle open releases neighbour preloads`; e2e `explore: live texture bytes stay under the steady cap` |
| Prop sprites (`scene:prop:<id>` holders) | executor (props layer) | `props` command / `restore` | any `bg`/`scene`, `restore` diff, `destroy()` | `executor: scene clears props` |
| Close-up texture (cg) | executor (cg slot) | puzzle open | puzzle end (`cg: null`) | `yields: puzzle end clears the close-up` |
| `PurchaseFlow` for a hint | `PuzzleSession` | `buyHint` | terminal state or session `dispose()` | `flow_clears_timers` (PP) |

---

## Integration

### Modules (new; PP "Module map" points here)

| Module | Responsibility | Boundary |
|---|---|---|
| `client/src/world/{types,decode}.ts` | world shapes, branded ids, source/public decoders, `toPublic`, `toServer` | pure (no DOM, no fetch); imported by the app and `scripts/story/` |
| `client/src/puzzles/rules/{code,order,index}.ts` | `PUZZLE_RULES` | pure |
| `client/src/explore/{state,reduce,project,reconcile}.ts` | `WorldState`, the one writer, the successor relation + `sectionKey` + `RESUME_STATE_CAP`, the projection, the story-update reconcile (with `sectionEntry`, the membership guarantee `inSectionReach`, and `admitSection` for the sections not current at load) | pure |
| `client/src/explore/controller.ts` | rooms at runtime: hotspot views (`geom/cover`), the room path, preload policy, effects out; enters a section only through `admitSection` | explore-ui chunk; no ink, no Pixi import (scene via the injected port) |
| `client/src/puzzles/{session,registry}.ts` | attempts, hints, purchase per open puzzle; lazy UI loaders | engine chunk; never reads ink |
| `client/src/puzzles/ui/{CodeLock,OrderPuzzle}.svelte` | per-type presentational UI | one lazy chunk each |
| `client/src/ui/puzzles/{PuzzleHost,HintLadder}.svelte`, `ui/puzzle-view.svelte.ts` | puzzle frame, ladder; view store | puzzle-host chunk; the view store is a statically importable plain `$state.raw` |
| `client/src/ui/explore/{ExploreView,Inventory,DocumentReader,LockPanel}.svelte`, `ui/explore-view.svelte.ts` | hotspot layer + bar, inventory (items / files), document reader, slots panel; view store | explore-ui chunk |
| `client/src/geom/cover.ts` | the one cover transform | pure; used by `scene/layout.ts` and the controller |
| `client/src/app/yields.ts` | routes `yield` steps and explore/puzzle effects; builds room batches; calls `project` + `runner.enter`; holds every `import()` of the lazy families (X14); sets the root-back from `onPath` and the event state (X12) | the only caller of `runner.enter` |
| `client/scripts/story/{world,softlock}.ts` | world lint; the model checker over `successors` | build only |
| `server/src/puzzles/mod.rs`, `api/puzzles.rs`, `db/puzzles.rs` | answer check, rate limit, status + hints | |

**Arch rules added** (`client/src/arch.test.ts`):
- `arch: pure world modules` (LW2) — no `document`, `window`, `fetch(`, `localStorage`, `svelte` import in
  `src/world/`, `src/explore/{state,reduce,project,reconcile}.ts`, `src/puzzles/rules/`. As merged (RULINGS 21 Q4,
  rule id `pure-world`, `38bc717`): transitive over those files plus their pure dependencies
  `story/{staging,catalog,tags}.ts`; it also bans `globalThis`, `self`, `navigator`, `location`, `XMLHttpRequest`,
  `WebSocket`, `sessionStorage`, `indexedDB`, `performance`, `crypto`, `Date`, `setTimeout`, `setInterval`,
  `queueMicrotask`, `requestAnimationFrame` and `Math.random`, and any value import outside that set (a bare package
  included). It binds L5 and any later editor of `catalog.ts` / `tags.ts`.
- `arch: lazy ui only by dynamic import` (LP2) — files under `src/puzzles/ui/`, `src/ui/puzzles/` and
  `src/ui/explore/` are statically imported only from their own directory; elsewhere only through `import()`.
- `arch: only yields.ts enters the runner` (LP2) — `.enter(` on the runner appears only in `src/app/yields.ts`.

### docs/FEATURE_MAP.md entries (D1/D2 write them)

| Feature | Rows |
|---|---|
| Puzzles | `puzzles/*`, `ui/puzzles/*`, `ui/puzzle-view.svelte.ts`; `server/src/puzzles/mod.rs`, `api/puzzles.rs`, `db/puzzles.rs`, `migrations/0002_puzzles.sql` |
| Exploration | `world/*`, `explore/*`, `ui/explore/*`, `ui/explore-view.svelte.ts`, `geom/cover.ts`, `app/yields.ts` |
| Hints for Stars | `puzzles/session.ts`, `ui/puzzles/HintLadder.svelte`, `purchase/flow.ts` (`isOwned`); `server/src/catalog.rs` (hint products), `telegram/payments.rs` (predicates) |
| World tooling | `scripts/story/{world,softlock,emit,graph,playthrough}.ts`, `story/<ch>/world.json` |

### PROTOTYPE-PLAN.md decisions changed (each marked there)

| PP item | Change |
|---|---|
| Goal | journey step "explores, solves puzzles, buys a hint"; T7–T11 |
| K3 | lazy chunks for puzzle types, puzzle host and explore UI (X14) |
| K5 | holders `room:<id>` and `scene:prop:<id>`; puzzle-open releases `room:*` (X13) |
| K9 | yield edges (`then=`, section knots); section knots are not preload `next`; event knots' carried stage seeded from rooms |
| K12 | `SaveBodyV1.world`, `worldVersion` (texts excluded), `at.yield`; reconcile with the membership guarantee for every section: the current one at load, the others at their next entry (X9) |
| K18 | a PK read + the UPDATE with three hint predicates; `Unavailable` |
| K26 | the BackButton root-back slot for rooms, cleared during event knots, toggled at the path's edges (X12) |
| HTTP API, SQL, Save format, Budgets, Test strategy, the lane cut | as in this file |

---

## Implementation plan

The lanes are cut in PROTOTYPE-PLAN.md "THE LANE CUT" (dependency order, locks, commits, red-firsts, seen working):
- **New:** LW1 puzzle-dsl, LW2 world-model, LW3 story-world, L6c server-puzzles, LP2 puzzle-ui, LX explore-ui.
- **Re-cut:** L5, L6b, L8a, L8b, L9, L10, L11, L13, L14a, L14b, D1, N1, L15, D2 (changed by STORIES-PLAN: re-cut again, and L6c's gate is LS2; PP "Dependency order").
- **Unchanged:** L3b, L3c, L4b, L6a, L7, L12.
- **Port lanes before the puzzle server lanes (RULINGS 14; cut in `D:/tmp/novel-orch/design/db/decision.md` §5,
  not here):** LDB0 pg-dev-cluster → LDB1 db-port run in the server slot after L6a and before L6b. L6b's gate to
  start gains LDB1; L6c's gate to start stays L6b (which waits for LDB1). So `0002` and every puzzle statement are
  written once, in the PostgreSQL dialect. The PP dependency order table carries both rows.

---

## Budgets and validation

| Budget | Limit | Basis | Enforced by |
|---|---|---|---|
| JS before the first line (entry + engine closures) | ≤ 270 KB br (PP's all-JS limit, now scoped) | PP K3; lazy chunks never load before the first line | `budget.ts` (L5 renames the row) |
| All JS in `dist/` | ≤ 290 KB br (was 270) | + 4 lazy chunk families ≈ 20 KB br | `budget.ts` |
| Puzzle type chunk (JS + CSS), each | ≤ 8 KB br, a dynamic entry, absent from the entry and engine static closures | X14 | `budget.ts` (LP2), keyed on the importer as the engine row keys on `src/app/engine.ts`: PENDING while `src/app/yields.ts` (the importer of every lazy family, L15) does not exist, whatever the lazy sources; once it exists, PENDING for a family whose sources are absent, FAIL if a source exists with no dynamic entry, or if it is in a static closure — `budget: puzzle ui in engine closure fails`, `budget: lazy row pending until its importer exists`, `budget: lazy row fails without dynamic entry once its importer exists` |
| Puzzle-host chunk | ≤ 10 KB br, same rules | | `budget.ts` (LP2) |
| Explore-ui chunk | ≤ 16 KB br, same rules | | `budget.ts` (LP2) |
| Engine closure | ≤ 230 KB br (unchanged; about 7 KB of pure world/puzzle code joins it) | | `budget.ts` (risk: about 8 KB headroom left; measured first in L15) |
| World JSON per chapter (public) | ≤ 32 KB raw, ≤ 8 KB br | | `budget.ts` (L5) |
| Prop image | ≤ 512×512, AVIF ≤ 60 KB, WebP ≤ 90 KB; ≤ 8 per room | ≤ 1 MiB decoded | `budget.ts` (L5) + `world/props-per-room` |
| `budget/room-set` | per room R: decoded bg(R) + props(R) + max(largest neighbour bg, largest close-up in R) ≤ 32 MiB | X13: one neighbour always fits; a puzzle with a close-up fits after the release | `budget.ts` (L5): FAIL if a chapter's world has sections and `usage.json` has no `rooms` for it — `budget: room-set counts props and close-up` |
| Knot working set | unchanged, with event knots' carried stage seeded from triggering rooms | K5, K9 | `budget/knot-set` |
| Per-chapter transfer | ≤ 6 MB (unchanged): ch1 + 3 room bgs (≤ 900 KB AVIF) + 4 props (≤ 240 KB) + 1 close-up (≤ 300 KB) | | `budget.ts` |
| First load | ≤ 800 KB (unchanged); counts the entry + engine closures (not all JS) + ch1 story/meta/manifest | exploration is not in the first knot | `budget.ts` |
| Live textures while exploring | ≤ 32 MiB steady: 29.3 MiB with two neighbours; 20.9 MiB with a close-up open | X13 | registry caps + e2e `explore: live texture bytes stay under the steady cap` |
| Steady memory | PP's 135.5 MiB total holds: textures stay cap-bounded; world data and sessions < 0.5 MB heap | | e2e `heap under budget` (PP) |
| Attempt latency | one request per Try; no budget gate | verify the p95 on device (L15) | — |
| Resume search after a rules update | ≤ 300 ms at CPU 4× (the LOW proxy) per search, worst case a full enumeration of `RESUME_STATE_CAP` = 5,000 states; one search at the load (the current section) and one at the first entry of each other section, never two at one point | X9: estimate ≈ 60 µs per state at 4× | `world/state-cap` bounds the states at build (LW3; `softlock: section above RESUME_STATE_CAP fails the build`, LW2); the time is verified in LW2 seen working (quiet machine) and on a LOW Android in L15 if available; LW2's measurement is provisional (RULINGS 21 Q7: 50-58 ms quiet-like, 130-158 ms under load, budget 75 ms unthrottled), re-measured on a quiet machine before LX / L13 rely on it |

**Red once:** budget.test.ts feeds:
- a manifest with `CodeLock.svelte` in the engine's static closure;
- lazy sources present, no `app/yields.ts`, a manifest without dynamic entries (expects PENDING; the red is a FAIL);
- the same with `app/yields.ts` present (expects FAIL);
- a 9 KB br puzzle chunk;
- a room with bg + close-up + 16 props of 1 MiB (32.9 MiB);
- a 1024 px prop;
- a world with sections but no `rooms` in usage.

---

## Test strategy

**Client unit** (vitest `unit`):
- **world** — `decode: every schema issue reported`, `decode: public refuses solution and hints`,
  `toPublic: strips solution and hints, keeps tier count`, `toServer: answer shape from the type rules`.
- **rules** — `rules: code validateSolution rejects out-of-range`, `rules: code initial is all zeros`,
  `rules: order solution must be a permutation`, `rules: solution equal to initial rejected`.
- **reduce** — `reduce: take moves item to held once`, `reduce: wrong item refused, state unchanged`,
  `reduce: lock opens after last slot then puzzle`, `reduce: slots persist in any order`,
  `reduce: tap on a filled unsolved lock reopens its puzzle`, `reduce: take runs its then once`,
  `reduce: lock opening runs onOpen once`, `reduce: tap while an event is pending is refused`,
  `reduce: failed runs onFail once`, `reduce: onEnter fires once`, `reduce: story effects queue and pop on return`,
  `reduce: leave clears the section`, `actions: enumerates enabled taps and inserts`,
  `successors: puzzle effect expands to closed and outcomes`.
- **project, reconcile** — `project: writes only declared vars`, `project: puzzle outcome codes`,
  `reconcile: unknown ids dropped`, `reconcile: missing room falls back to section start`,
  `reconcile: missing pending knot dropped`, `reconcile: same world version returns the state unchanged`,
  `reconcile: changed slot shape returns the items to held`, `reconcile: renamed held item keeps the section exitable`,
  `reconcile: unprovable state restarts the section`,
  `reconcile: a dead end reachable from the reconciled state restarts the section`,
  `reconcile: reset section fires the start room's onEnter on resume`,
  `reconcile: a section left through a leave restarts on re-entry after a version change`,
  `reconcile: a version change marks every other section unproved and keeps the current section and room`.
- **softlock** — `softlock: lock needing an unreachable item fails`, `softlock: fail branch without unlock fails`,
  `softlock: solvable section passes`, `softlock: state cap is an error`, `softlock: counterexample path printed`,
  `softlock: section above RESUME_STATE_CAP fails the build`.
- **As merged (LW2 `38bc717`, RULINGS 21 Q8 and the addendum):** the 50 LW2 names joined `baseline.tsv`; beside the
  names above: `decode: public requires version`, `decode: take then and lock onOpen default to empty`,
  `reduce: an action that changes no state keeps its effects` (C1), `reduce: rules golden pinned to RULES_VERSION`
  (PE7), `sectionKey: ignores section, lastRoom, unproved and other sections` (W1: equal sets in two orders give one
  key), `softlock: section just under RESUME_STATE_CAP passes` (the Q7 timing); arch: `arch: pure-world red on
  fixture`, `arch: pure-world allows fixtures`.
- **cover** — `cover: hotspot rect follows the bg cover transform`, `cover: small target expanded to 44 px`.
- **executor** — `executor: scene clears props`, `executor: props survive restore`.
- **runner** — `runner: puzzle yield stops at DONE` (verifies `canContinue === false` after DONE),
  `runner: then-knot choices see the outcome`, `runner: enter rejects undeclared projection var`,
  `runner: enter outside a yield is an error`.
- **resume, save codec** — `resume: exact at a yield re-yields`, `save-codec: world round trip`.
- **session** — `session: double try sends one attempt`, `session: max attempts yields failed`,
  `session: stale attempt response after dispose is dropped`, `session: dispose aborts the attempt`,
  `hints: texts never written to storage`, `hints: next tier buyable only after previous owned`.
- **flow** — `flow: hint product confirms through puzzle status`.
- **http** — `http: 429 carries retryAfter`.
- **controller** — `controller: hotspot rect follows cover on resize`, `controller: back walks the path, cycles truncate`,
  `controller: path state reported on change`, `controller: locked reverse exit clears the path`,
  `controller: puzzle open releases neighbour preloads`, `controller: neighbours preloaded in exit order`,
  `controller: dispose releases room holders`, `controller: enter admits an unproved section`.
- **yields** — `yields: puzzle end projects then enters`, `yields: event return restores the room`,
  `yields: puzzle end clears the close-up`, `yields: back during an event knot does not move rooms`.
- **game** — `game_holds_one_explore_controller`, `game_holds_at_most_one_puzzle_session`.
- **arch** — `arch: pure world modules`, `arch: lazy ui only by dynamic import`, `arch: only yields.ts enters the runner`.
- **budget** — `budget: puzzle ui in engine closure fails`, `budget: lazy row pending until its importer exists`,
  `budget: lazy row fails without dynamic entry once its importer exists`, `budget: room-set counts props and close-up`.
- **scan** — `scan: hint text in dist fails`, `scan: hint sources present but no fingerprints fails`,
  `scan: paid world text in dist fails`, `scan: paid world sources present but no fingerprints fails`.
- **emit** — `emit: public world has no solution or hint fields`, `emit: server puzzle content matches the server fixture shape`,
  `emit: world version ignores texts`, `emit: world version changes on a rules edit`,
  `emit: world version changes on a RULES_VERSION bump` (LW3; erratum, RULINGS 21 Q2).

**Client DOM** (vitest `dom`):
- `code: dials wrap and emit answer`, `order: tap two slots swaps`, `puzzle host: linear has give up and no back`,
  `puzzle host: unmount on end`, `hint ladder: locked tiers not buyable`.
- `explore view: reveal shows outlines`, `explore view: hotspot buttons have labels`,
  `lock panel: wrong item refused right item inserts`, `inventory: documents re-readable`.
- `screens: back walks the room path when no overlay`.

**Story gate:**
- `lint: <code> red on fixture` for every code in the DSL table above;
- `lint: world/cross-section-effect allows a cross-room unlock inside a section` (the control: the lever and the
  gate in two rooms of one section; revision 4);
- `lint: world/puzzle-multi-lock allows one puzzle on one lock` (the control: the demo shape, `drawer` on
  `study.drawer` and `gate` on `hall.gate`; revision 5);
- `lint: world/cross-section-exit allows a room→room exit inside one section` (the control: two rooms of one
  section joined by an exit pair, while the same chapter holds a second section; it guards against a rule keyed by
  room existence instead of by section; revision 6);
- `play: event knot without return fails`, `play: puzzle then-knot outcomes covered`;
- `story: world softlock fails the gate`.

**Server** (`cargo test --workspace`):
- **schema** — `schema_puzzle_progress_pk`, `schema_puzzle_window_check`, `schema_puzzle_id_shape`; each refusal is
  asserted as `(SQLSTATE, constraint())`, e.g. `("23514", "puzzle_progress_window_bounded")`.
- **attempts** — `attempt_correct_marks_solved`, `attempt_wrong_returns_false`, `attempt_wrong_shape_400`,
  `attempt_rate_limited_after_20_in_window`, `attempt_window_resets_after_600s`,
  `attempt_paid_chapter_403_without_entitlement`, `attempt_unknown_puzzle_404`.
- **status** — `puzzle_hint_text_only_when_owned`, `puzzle_status_private_no_store`,
  `hint_text_403_for_unowned_paid_chapter`.
- **catalog** — `catalog_prices_every_hint_tier`, `hint_invoice_titles_within_limits`, `entitlements_lists_chapters_only`.
- **invoices** — `invoice_hint_tier_order_409`, `invoice_hint_after_solve_409`,
  `invoice_hint_paid_chapter_needs_entitlement_409`, `invoice_hint_price_from_catalog`.
- **pre-checkout, grant** — `precheckout_hint_prereq_refused`, `precheckout_hint_solved_refused`,
  `precheckout_hint_chapter_not_owned_refused`, `hint_purchase_duplicate_concurrent_grants_once`.
- **refunds** — `refund_revokes_hint`.
- **errors** — `error_codes_serialize_snake_case`, extended with `rate_limited` and `hint_unavailable`.

**e2e** (`client/e2e/puzzles.spec.ts`, L15):
- `explore: search item puzzle buy hint solve`
- `explore: gate fail branch`
- `explore: reload resumes in the same room with items`
- `puzzle: hint text absent until bought`
- `puzzle: paid chapter puzzle needs entitlement`
- `explore: back button walks rooms then hides`
- `explore: live texture bytes stay under the steady cap`
- `explore: hotspot buttons align with props under safe area and landscape` (X10: `__tgMock.setSafeArea()` with
  non-zero insets, then a landscape viewport; each hotspot button's page rect against its prop sprite's rect from
  `__novelDebug.propRects()`, centres within 1 CSS px, sizes equal unless min-target expanded)

### Gates that must be seen red once

| Gate | Seeded failure | Lane |
|---|---|---|
| `story` (tags) | each `yield/*` fixture; `-> DONE` without a yield; a `puzzle:` tag on a text line | LW1 |
| `dsl-doc` | `puzzle` heading missing from STAGING-DSL §6 | LW1 |
| soft-lock checker | a stub returning no findings → `softlock: lock needing an unreachable item fails`; a `successors` stub with no `closed` successor → `successors: puzzle effect expands to closed and outcomes`; a checker capped at 200,000 instead of `RESUME_STATE_CAP` → `softlock: section above RESUME_STATE_CAP fails the build` (predicted red: PASS) | LW2 |
| reconcile | a step 4 that asks only for a path to a `leave` → `reconcile: a dead end reachable from the reconciled state restarts the section` (predicted red: `reset` null); a `resetSection` that keeps `section` = S → `reconcile: reset section fires the start room's onEnter on resume` (predicted red: no `got`); the current-section-only reconcile with no step 5 (no `unproved`; `admitSection` = plain `reduce`) → `reconcile: a section left through a leave restarts on re-entry after a version change` (predicted red: no `reset` effect, `hall.to_vault` stays open with K untaken) and `reconcile: a version change marks every other section unproved and keeps the current section and room` (predicted red: `unproved` empty; on a load-time loop over every section with the current `resetSection`: `section` and `room` null) | LW2 |
| controller | a controller whose `enter` dispatches `enter-section` straight to `reduce` → `controller: enter admits an unproved section` (predicted red: no `reset` effect, `hall.to_vault` still open) | LX |
| arch | a seeded `document.` in `explore/reduce.ts` (scratch) | LW2 |
| `story` (world) | every `world/*`, `puzzle/*`, `explore/*`, `play/event-no-return` fixture; `paid/leak` with a hint text routed into story-gen; the round-4 triage's courtyard/tower world (`yard.lever` `then: [unlock hall.gate]`, the gate a zero-slot puzzle-less lock in section `tower`) → `lint: world/cross-section-effect red on fixture` (predicted red: the gate exits 0 with only a `world/unreachable` warning on `vault`); the round-5 triage's keypad world (`keypad`, a `code` puzzle, on zero-slot `yard.shed` in `courtyard` and on zero-slot `hall.gate` in `tower`, the rest the round-4 shape), and the same puzzle on two zero-slot locks of one section → `lint: world/puzzle-multi-lock red on fixture` (predicted red at the `world.ts` level: no error-level finding; per-section `world/softlock` green, `world/cross-section-item` and `world/cross-section-effect` silent. A fixture run through the seeded playthroughs instead would likely go red on `play/step-cap`, a different red); the round-6 triage's arch world (section `courtyard`: start `yard`, lock-free `yard.arch` → `{room: hall}`, `yard.leave` → a knot; section `tower`: start `foyer` with a lock-free `foyer.out` leave, rooms `hall` and `pit`; `hall.to_yard` the arch's reverse, `hall.coil` gives `rope`, `hall.lever` an object with `then: [{unlock: hall.down}]`, `hall.down` → `{room: pit}` a zero-slot puzzle-less lock, `pit.up` → `{room: hall}` with one slot that accepts `rope`) → `lint: world/cross-section-exit red on fixture` (revision 6; asserts two findings, `yard.arch` and `hall.to_yard`, returned by `world.ts` without a throw; predicted red against the revision-5 `world.ts`, at the `world.ts` level and without `--strict`: no error-level finding, per-section `world/softlock` green, the only output a `world/unreachable` W on `pit`. A seeded-playthrough `play/step-cap` is a different red; a `world/unknown-ref` means the fixture is malformed) | LW3 |
| `build` scan | a synthetic dist holding a hint text, and one holding a hint line ID inside a base64 `data:` URI; the same for a paid ch2 world text and its line ID (`scan: paid world text in dist fails`, predicted red: exit 0) | LW3 |
| emit | the version hashed over the whole public world → `emit: world version ignores texts` (predicted red: two versions) | LW3 |
| `build` budget | a room-set over 32 MiB; a 1024 px prop | L5 |
| `build` budget | a puzzle UI in the engine closure; lazy sources present with no `app/yields.ts` (predicted red: FAIL instead of PENDING); `app/yields.ts` present with no dynamic entry (FAIL) | LP2 |
| arch | a static import of `CodeLock.svelte` from `app/` (scratch) | LP2 |
| server | `0002` absent → `relation "puzzle_progress" does not exist` (SQLSTATE `42P01`); a never-limiting stub → `attempt_rate_limited_after_20_in_window` | L6c |
| server | a pre-checkout stub without the hint predicates → `precheckout_hint_prereq_refused` returns Ok | L8b |
| e2e | the gate order changed in a scratch copy of the e2e's solution → `explore: search item puzzle buy hint solve` red; the mock invoice forced `failed` → the hint is never shown; the hotspot layer mounted in the padded overlay (scratch) → `explore: hotspot buttons align with props under safe area and landscape` red (the rects differ by the inset) | L15 |

---

## Demo content outline (for the narrative-designer, lane N1; ch1–ch2 are story `manor`, changed by STORIES-PLAN)

**Chapter 1 (free)** — the exploration section `manor`, three rooms. The `ally` speaker narrates.

| Room | bg | Hotspots | Triggers |
|---|---|---|---|
| `hall` (start) | `bg/hall` | exits `to_study`, `to_cellar`; the **gate** (`exit` → story `manor_out`) with a lock of 3 slots (`medal_sun`, `medal_moon`, `medal_star`) + puzzle `gate` (order, `maxAttempts: 3`, `onFail`: `manor_gate_forced` + `unlock hall.gate`); `inscription` (look: the order clue, e.g. "the moon before the sun, the star last") | — |
| `study` | `bg/study` | `medal` (take `medal_sun`, prop `medal_sun`); `drawer` (object; lock with puzzle `drawer`: code, 4 dials, 3 hint tiers, close-up `cg/drawer`; `then: give medal_moon`); `letter` (take doc `letter`, prop `note`); exit `to_hall` | — |
| `cellar` | `bg/cellar` | `star` (take `medal_star`, prop `medal_star`); `diary` (take doc `diary`: the drawer code 1847 in its text); exit `to_hall` | `onEnter`: `manor_cellar_voice` (a short ink scene, ends with `# explore: manor` + `-> DONE`) |

The section forces backtracking: the drawer is in the study, its clue in the cellar.

Ink skeleton (each line with an ID):

```ink
=== manor_arrive ===
# scene: hall
ally: Locked in. There has to be another way out. #id:ch1.manor_arrive.a001
# explore: manor
-> DONE

=== manor_cellar_voice ===
voice: Who's there? #id:ch1.manor_cellar_voice.v001
# explore: manor
-> DONE

=== manor_gate_forced ===
ally: Step back. I'll force it. #id:ch1.manor_gate_forced.f001
~ g_gate_forced = true
# explore: manor
-> DONE

=== manor_out ===
{ pz_gate == 1:
    The gate swings open without a sound. #id:ch1.manor_out.o001
- else:
    The gate hangs off one hinge. #id:ch1.manor_out.o002
}
{ pz_drawer_hints > 0:
    ally: You had help with that drawer, didn't you? #id:ch1.manor_out.o003
}
-> street
```

- Chapter-local declarations: `VAR pz_gate = 0`, `VAR pz_drawer_hints = 0`.
- `globals.ink` gains `g_gate_forced` (a ch2 reaction).
- The drawer is the **ch1 puzzle with a hint purchase** (e2e).
- The gate exercises **order + insertion + the fail branch**.

**Chapter 2 (paid)** — the linear puzzle `cabinet` in `archive` (bg exists, paid tier):

```ink
=== archive_cabinet ===
# scene: archive
The cabinet has three dials and a dusty label. #id:ch2.archive_cabinet.c001
# puzzle: cabinet then=archive_after
-> DONE
```

- `cabinet`: code, 3 dials, `maxAttempts: 3`, `giveUp: true`, 3 hint tiers, close-up `cg/cabinet` (paid only).
- `archive_after` branches on `pz_cabinet` (1 / 2 / 3) and reacts to `g_gate_forced`, then `-> END` (changed by STORIES-PLAN: it diverts to `archive_truth` (1) or `archive_ashes` (2, 3), each `-> END`, declared in `story/stories.json` as the endings `truth` and `ashes`).
- The world of ch2 holds only the puzzle: no sections.
- It proves a paid world through the payload, a paid close-up asset, and a hint gated by the chapter entitlement.

**Catalog additions** (L5; N1 writes within them):
- bg: `hall`, `study`, `cellar`;
- props: `medal_sun`, `medal_star`, `note`;
- cg: `drawer` (ch1), `cabinet` (ch2 only);
- items: `medal_sun`, `medal_moon`, `medal_star` (glyphs sun / moon / star);
- docs: `letter`, `diary`.

---

## Open questions

### Engineering (for the orchestrator), each with a recommendation

| # | Question | Recommendation |
|---|---|---|
| PE1 | `PuzzleId` joins `server/src/ids.rs` (RULINGS 9 Q2: later derives or types are orchestrator-approved lock additions) | Approve for L6b (an addition; the existing derives are untouched) |
| PE2 | `error.rs` gains `RateLimited` / `HintUnavailable` in L6c (PP: "no other lane edits error.rs") | Approve; the no-wildcard match and the wire tests make it a compile-checked edit |
| PE3 | DSL v2 (two tags, the narrowed `-> DONE` ban) lands in LW1 after L3a. STAGING-DSL.md's chain becomes L3a → LW1, then frozen | Approve |
| PE4 | PP L8b leaves the pre-checkout reject texts unplaced; `Unavailable` needs one | L8b keeps the ru/en reason texts as a `match` in `telegram/payments.rs`; L9 moves them into `bot.*.json` under `bot_texts_complete_and_within_limits` |
| PE5 | The lane count grows from 24 to 30 | Accept; the critical path grows by LP2 only (dependency order in PP) |
| PE6 | verify (L13): `canContinue === false` after `-> DONE` and `ChoosePathString` from that stop | The red-first `runner: puzzle yield stops at DONE` decides it; if it fails, STOP: X1 needs a redesign |
| PE7 (r2) | `worldVersion` covers the world body, not the `reduce` rules: a rules change shipped with no world edit keeps `version`, so reconcile is skipped and invariant I-W (X9) rests on T9 run under the old rules | A hand-bumped `RULES_VERSION` constant in `explore/reduce.ts`, folded into `worldVersion`'s input; a golden test pins the demo fixture's per-section state count together with the `RULES_VERSION` it was taken under, so a rules edit without a bump fails. Decide in the LW2 cut. **RESOLVED (RULINGS 21 Q2; as merged, `38bc717`):** `export const RULES_VERSION = 1` in `explore/reduce.ts`, hand-bumped on any edit that can change `actions`, `successors`, `sectionKey` or the section search. The golden `reduce: rules golden pinned to RULES_VERSION` (`explore.test.ts`) runs the section search with an edge callback over a demo-shaped fixture (the manor plus an `onOpen` and a `then` story on the drawer, a `take` with `then` and a remote `unlock` of an object) and pins `{ rulesVersion, states, digest }` in an append-only table keyed by version (row `1: { states: 1637, digest: 'd7c827dd' }`), the digest an FNV-1a-32 hex of the sorted edge lines; a mismatch fails with "rules changed: bump RULES_VERSION and add a row". A state count alone misses an order-only edit, the edge digest catches it. LW3 hashes `{ rules: RULES_VERSION, body }` and adds `emit: world version changes on a RULES_VERSION bump`; once N1's `story/ch1/world.json` exists, LW3 may add a second golden row over the real demo |

### VALUES / SCOPE (for the owner; the orchestrator records them in docs/OPEN-QUESTIONS.md)

| # | Question | Default in the design |
|---|---|---|
| Q14 | Hint prices; tiers per puzzle; the last tier = the full solution? a free first tier? packs? | `[1, 1, 2]` Stars by tier (PLACEHOLDER); 3 tiers; the last tier is the solution; no free tier; no packs |
| Q15 (new) | Refund policy text for consumed hints in `/terms`; an EU withdrawal-waiver checkbox (Directive 2011/83/EU art. 16(m)) [P3 §1b]; Russian consumer law (not researched) | Hints are "delivered on purchase"; admin-only refunds (Q9); no waiver checkbox; terms confirmation once per session before the first hint purchase |
| Q16 (new) | May a failed puzzle be retried after its fail branch? | No for exploration locks (the fail branch is final for that run); linear: the story decides per puzzle |
| Q17 (new) | Exploration help: hotspot reveal and "where next" — free, or paid? An "advanced" mode without reveal? | Reveal free; no paid exploration hints; no advanced mode |
| Q18 (new) | Demo size: rooms per section; a map screen | 3 rooms, no map (Later). Engineering bound (r2, X9): a section has at most `RESUME_STATE_CAP` = 5,000 abstract states (about 4 rooms with 6 items); a larger area is authored as several sections. Engineering bound (r4, X15): a shortcut or a shared gift between areas makes them one section (`world/cross-section-effect`). Engineering bound (r6, X15): a walkable door between two sections is a `leave` exit and an `explore` yield, or the areas are one section (`world/cross-section-exit`) |
| Q19 (new) | Riddle levels / per-player randomized codes (protects a shared solution) [P1 §1b] | None in the prototype (fixed authored answers) |
| Q20 (new) | Item icon art vs glyphs | Glyphs in the prototype; item art Later |

---

## Readiness checklist

- [x] The goal names correctness targets (T7–T11) and budgets. Every decision (X1–X18) has why / alternatives /
  trade-off.
- [x] TS and Rust types for every new JSON. One source of truth per seam:
  - HTTP — Rust DTOs, ts-rs;
  - world — TS decoders shared by tool and app;
  - server puzzle content — a committed fixture read by both sides.

  SQL has a named constraint per invariant (PK, `window_attempts ≤ attempts`, `solved_at ≥ first_at`, id regex = the
  `PuzzleId` grammar), in the PostgreSQL dialect (RULINGS 14). Every endpoint states auth, errors, idempotency and
  Cache-Control.
- [x] Tags specified for STAGING-DSL.md (LW1 implements and documents them); one parser; scene and overlay never read
  story state (T10); every world text and hint has a line ID.
- [x] Grant only on `successful_payment` via the charge-id insert (unchanged K19); refund revokes (K20); pre-checkout
  does three indexed statements in one transaction (the payer-row lock, the order PK read, the conditional UPDATE);
  hint text only behind the entitlement check; `scan-dist` proves hint texts absent from `dist/` with source-built
  fingerprints.
- [x] Audio unchanged (bgm per section through the same audio manager); BackButton per closable screen plus the
  root-back for rooms; `deactivated` / `activated` rows; no Service Worker, `window.open` or `alert` (arch);
  SDK on the main origin.
- [x] Room art ≤ 2048 px (1080×2048), props ≤ 512 px; render resolution unchanged; a release point per texture
  (`room:*`, `scene:prop:*`, close-up); exploration memory estimated (29.3 / 20.9 MiB).
- [x] Duplicate webhook, double tap, reload, token expiry, story update, context loss: outcomes stated.
- [x] Red-first per commit (PP lane cut); test names above; budget rows the build gate enforces; each new gate seen
  failing (table above).

---

## Changed by STORIES-PLAN

[STORIES-PLAN.md](STORIES-PLAN.md) (RULINGS 20) adds several stories, saves per story and the statistics
foundation. What it means for this design (the in-place marks above are single-line edits, so the line numbers that
RULINGS 21's errata cite, up to line 1877, are unchanged; revision 9 applied those errata and moved PZ:652 and the
lines after it, so they are now found by their quoted text):

| PZ item | Change |
|---|---|
| X1–X18 | unchanged (STORIES-PLAN Y17): worlds stay per chapter |
| Identifiers | `PuzzleId = <chapter>.<local>`, hint products `hint:<PuzzleId>:<tier>` and world text IDs stay game-unique: chapter ids are unique across all stories (Y1); a story is a chain of chapters |
| SQL `0002_puzzles` | unchanged (`puzzle_progress` PK and id CHECK); `0003_stats.sql` (LS3) follows it and relies on L6c's `server/build.rs` |
| Server formats | `server/content/puzzles/<ch>.json` unchanged; `server/catalog.json` `chapters` becomes a default price + overrides + templates over the generated story index (Y6); `hints` unchanged |
| HTTP additions | unchanged; a puzzle outcome is also reported as a `puzzle_ended` statistics event (subject = `PuzzleId`, outcome `solved` / `failed` / `abandoned`, from `app/yields.ts`) — display data only, never an input to attempts or hints |
| Lanes | L6c: gate LS2 (serialized server files), scope unchanged; LW3: gate + LS1 (serialized story-tool files), scope unchanged; N1: story `manor` with two declared endings; LP2, LX: unchanged |
| Demo content outline | ch1–ch2 are story `manor`; ch2 ends in the declared endings `truth` / `ashes`; story B (`tide`, ch3–ch4, lane N2) has no world |
| Resource lifetime (STORIES-PLAN revision 1) | `PuzzleSession` and `ExploreController` are also destroyed by `exitToStories()` (STORIES-PLAN "Module API"): the session before the exit's autosave, so a late attempt result is dropped; the controller after it, so the save still reads the world state. Both rows are single-line in-place edits |

---

## Revision log

| Rev | Date | Source | Summary |
|---|---|---|---|
| 0 | 2026-10-30 | architect round 1 | Initial design (with PROTOTYPE-PLAN revision 3) |
| 1 | 2026-10-30 | `D:/tmp/novel-orch/design/puzzles/triage_r1.md` (critique `design/puzzles/critique_r1.md`) | The 9 confirmed items W1–W9 resolved (W2, W3 as narrowed by the triage). Optional O1–O9 noted, not folded in. The triage's settled open question 1 (L3b `graph.ts` exhaustive switch vs LW1's new kinds) is left to the LW1 cut, as the triage directs. Pre-revision copies: `design/puzzles/PUZZLES-PLAN.r1.before.md`, `PROTOTYPE-PLAN.r1.before.md`. Per-item detail: `D:/tmp/novel-orch/design/puzzles/revision_r1.md` |
| 2 | 2026-10-31 | `D:/tmp/novel-orch/design/puzzles/triage_r2.md` (critique `design/puzzles/critique_r2.md`) | The 2 confirmed items W1 and W2 (both parts) resolved, together, as the triage directs. Optional O1–O5 noted, not folded in. Critique open question 1 (L3b `graph.ts` vs LW1) stays with the LW1 cut; open question 2 (`hintsOpened`: tiers or dispatches) is not touched. The triage's "not counted" item (a `reduce` rules change with no world edit) is recorded as PE7. Pre-revision copies: `design/puzzles/PUZZLES-PLAN.r2.before.md`, `PROTOTYPE-PLAN.r2.before.md`. Per-item detail: `D:/tmp/novel-orch/design/puzzles/revision_r2.md` |
| 3 | 2026-10-31 | `D:/tmp/novel-orch/design/puzzles/triage_r3.md` (critique `design/puzzles/critique_r3.md`) | The 1 confirmed item W1 resolved: the membership resume proof now covers every section, not only the current one (X9 step 5, `WorldState.unproved`, `admitSection`). Optional O1–O5 noted, not folded in. PE7 (`RULES_VERSION`) stays with the LW2 cut; critique-r2 open question 1 (moot: L3b is merged) is not touched. Pre-revision copies: `design/puzzles/PUZZLES-PLAN.r3.before.md`, `PROTOTYPE-PLAN.r3.before.md`. Per-item detail: `D:/tmp/novel-orch/design/puzzles/revision_r3.md` |
| 4 | 2026-10-31 | `D:/tmp/novel-orch/design/puzzles/triage_r4.md` (critique `design/puzzles/critique_r4.md`) | The 1 confirmed item W1 resolved: step 5's premise (a section's keys change only while it is current) is made true by a new story-gate error, `world/cross-section-effect` (X15): a cross-section `unlock` and an item or doc given in two sections fail the build. Reconcile is unchanged. This also closes round-3 O1. Optional O1, O2 noted, not folded in. Critique-r4 OQ1 folded into W1; OQ2 / PE7 (`RULES_VERSION`) stays with the LW2 cut. Pre-revision copies: `design/puzzles/PUZZLES-PLAN.r4.before.md`, `PROTOTYPE-PLAN.r4.before.md`. Per-item detail: `D:/tmp/novel-orch/design/puzzles/revision_r4.md` |
| 4b | 2026-10-31 | RULINGS 14 (database decision adopted) + `D:/tmp/novel-orch/design/db/decision.md` §4.6 | Database errata, not a triage round: the puzzle SQL in the PostgreSQL 18 dialect (named constraints, `BIGINT`, the qualified `ON CONFLICT` upsert, `starts_with`, the payer-row lock before the pre-checkout predicates, the `42P01` red text); the id CHECK aligned with the `PuzzleId` grammar; the port lanes LDB0 → LDB1 before L6b in the order. Removed/added text verbatim: `D:/tmp/novel-orch/design/puzzles/errata_db.md` |
| 5 | 2026-10-31 | `D:/tmp/novel-orch/design/puzzles/triage_r5.md` (critique `design/puzzles/critique_r5.md`) | The 1 confirmed item W1 (narrowed) resolved: a puzzle attached to more than one lock fails the story gate (`world/puzzle-multi-lock`, X15), so `puzzle-ended p` opens exactly one lock and every puzzle run is a key of exactly one section; step 5's writer list, I-W's first entry and the reducer rule now name the run and its one lock. Reconcile and its cap are unchanged; 0 runtime bytes. Optional O1–O3 noted, not folded in; critique-r5 OQ1 (a room→room exit across sections) noted, not folded in; OQ2 / PE7 (`RULES_VERSION`) stays with the LW2 cut. Pre-revision copies: `design/puzzles/PUZZLES-PLAN.r5.before.md`, `PROTOTYPE-PLAN.r5.before.md`. Per-item detail: `D:/tmp/novel-orch/design/puzzles/revision_r5.md` |
| 6 | 2026-10-31 | `D:/tmp/novel-orch/design/puzzles/triage_r6.md` (critique `design/puzzles/critique_r6.md`) | The 1 confirmed item W1 resolved: a room→room exit into a room of another section fails the story gate (`world/cross-section-exit`, X15), so every move stays inside its section and the current room is always a room of the current section; step 5's premise, the writer list, I-W's first entry, the successor paragraph and the reducer's move rule now name it as the fourth guarantee. Reconcile and its cap are unchanged; 0 runtime bytes. Optional O1, O2 and critique-r6 OQ1 noted, not folded in (OQ1 stays a detail for the LW3 cut); OQ2 / PE7 (`RULES_VERSION`) stays with the LW2 cut. Pre-revision copies: `design/puzzles/PUZZLES-PLAN.r6.before.md`, `PROTOTYPE-PLAN.r6.before.md`. Per-item detail: `D:/tmp/novel-orch/design/puzzles/revision_r6.md` |
| 7 | 2026-10-31 | `D:/tmp/novel-orch/design/stories/spec.md` (RULINGS 20), with PROTOTYPE-PLAN revision 11 | Extended by [STORIES-PLAN.md](STORIES-PLAN.md): the section "Changed by STORIES-PLAN" (no X decision changes; `PuzzleId` stays game-unique; `server/catalog.json` chapters over the story index; ch1–ch2 are story `manor` with two declared endings). In-place single-line marks only before line 1878 (status, Identifiers, Server formats, Implementation plan, Demo content outline), so the line references of RULINGS 21's errata stay valid. The errata themselves are not applied here |
| 8 | 2026-10-31 | `D:/tmp/novel-orch/design/stories/triage_r1.md` (STORIES-PLAN revision 1, W5) | Two single-line in-place edits in "Resource lifetime" (the `PuzzleSession` and `ExploreController` rows: also destroyed by `exitToStories()`, with its test) and one row in "Changed by STORIES-PLAN"; no X decision changes; the line numbers before line 1878 are unchanged. Pre-revision copy: `D:/tmp/novel-orch/design/stories/PUZZLES-PLAN.r1.before.md`. Detail: `D:/tmp/novel-orch/design/stories/revision_r1.md` |
| 9 | 2026-10-31 | RULINGS 21 + `D:/tmp/novel-orch/lw2-world-model/cut.md` §6 (Q1-Q8) and its addendum (C1, W1, developer decisions), as merged: LW2 `38bc717` | Docs lane `docs-errata`, group B (the LW2 errata, not a triage round): X15 `world/linear-requires` by construction (Q6); "World data" schema strictness (Q5/D3: required and nullable keys, repeated hotspot ids); the state API signatures take `WorldPublicBody`, only `reconcile` `WorldPublic` (Q3), `sectionKey` sets (W1), `RULES_VERSION` (Q2); "The points the rules leave open" (D7 with C1's restated no-change rule and the developer decisions); `WorldIssue` (D4); `worldVersion` hashes `{ rules: RULES_VERSION, body }` (Q2); the `world/softlock` message; the `pure-world` arch rule as merged (Q4); the X9 cost and the budget row carry the provisional timing (Q7); Test strategy: the LW2 names beside the list (Q8) and LW3's `emit: world version changes on a RULES_VERSION bump` in the emit list (Q2); PE7 resolved; the "Changed by STORIES-PLAN" line-number note says this revision moved the lines (review round 1). Each place is marked "erratum (RULINGS 21 …)" or "as merged". Ledger: `D:/tmp/novel-orch/docs-errata/ledger.md` |

**Revision 1 (2026-10-30)** — what changed, by triage item:
- **W1** (a fully slotted lock's puzzle cannot be reopened after Back or a reload): "Lock" (the tap rule: every slot
  filled + no outcome → the puzzle reopens at its start); hotspot-kind table; reducer rule `tap`; the new successor
  relation (`successors`: a `puzzle` effect expands to `closed` plus each outcome; `actions()` no longer lists
  outcomes), used by `world/softlock`, the playthroughs and `reconcile`; X8; F7 step 6; F9 resume levels; concurrency
  row "Reload mid-puzzle"; tests `reduce: tap on a filled unsolved lock reopens its puzzle`,
  `successors: puzzle effect expands to closed and outcomes`, `actions: enumerates enabled taps and inserts`
  (renamed); seen-red row (LW2).
- **W2** (no trigger on taking an item or opening a lock): `take.then` and `lock.onOpen`, both once through `fired`
  (`open:<key>`); Goal 1; hotspot-kind table; "Lock" (Opening); Effects / trigger rule; reducer rules; the world JSON
  example; `world/types.ts` note; F7 steps 2 and 4; tests `reduce: take runs its then once`,
  `reduce: lock opening runs onOpen once`.
- **W3** (the hotspot layer's box is not named): X10 "The box" (the stage host, the `Stage.svelte` element that
  Pixi's `resizeTo` and the `ResizeObserver` read); `createExploreController` `deps.stageHost`; `resize()` doc;
  `SceneController.debugPropRects()` (mock builds only); resource-lifetime row; e2e
  `explore: hotspot buttons align with props under safe area and landscape`; seen-red row (L15).
- **W4** (BackButton during event knots; no path-state output): X12 (the locked reverse exit clears the path,
  `back()` = a `tap` on the open exit, event knots, the door fade, `onPath`); reducer guard (a `tap` is refused while
  `pendingStory` is non-empty); `ExploreController.onPath`; F7 steps 1, 3 and 4; two concurrency rows; `yields.ts`
  module row; tests `reduce: tap while an event is pending is refused`, `controller: path state reported on change`,
  `controller: locked reverse exit clears the path`, `yields: back during an event knot does not move rooms`.
- **W5** (a reconciled state may never reach a `leave`): X9 (the world version, slot-shape and gift rules, the
  load-time reachability guarantee with a section restart, the rejected registry alternative); `reachesLeave`,
  `RESUME_STATE_CAP`, `resetSection`; `reconcile(…, savedVersion)` returns `reset`; `SaveBodyV1.worldVersion`;
  `WorldPublic.version`; T11; F9; concurrency row "Story update…"; X14 and the engine-closure row (about 7 KB);
  tests `reconcile: renamed held item keeps the section exitable`, `reconcile: same world version returns the state
  unchanged`, `reconcile: changed slot shape returns the items to held`, `reconcile: unprovable state restarts the
  section`.
- **W6** (paid world texts have no source-built dist scan): T7; X7 What and Why; Paid-content protection (gates);
  tests `scan: paid world text in dist fails`, `scan: paid world sources present but no fingerprints fails`;
  seen-red row (LW3).
- **W7** (the lazy budget rows FAIL from LP2 until L15): X14 "The importer" (`app/yields.ts` holds every lazy
  `import()`); the three lazy budget rows keyed on `src/app/yields.ts`; "Red once"; `yields.ts` module row; tests
  `budget: lazy row pending until its importer exists`, `budget: lazy row fails without dynamic entry once its
  importer exists`; seen-red row (LP2).
- **W8** (the then-knot choices red cannot be red on its stub): the inkjs 2.4.0 fact in "Platform facts" (choice
  conditions are evaluated during `Continue()`, not by `ChoosePathString`); the stub itself is in PP L13 commit 1a.
- **W9** (LW3 reads L6b's fixture without waiting for L6b): PP only (LW3 gate, dependency table, critical path).

PROTOTYPE-PLAN.md sections changed in this revision (each edit marked "changed by PUZZLES-PLAN"; PP revision 4): the
status line; Goal (the T7–T11 row); K3, K12, K26; the TS type notes (`SaveBodyV1`, `SceneController`); Save format
and resume; Telegram production behaviour (Viewport, BackButton); Paid-content protection; Scene controller (the
`eventMode` note); Budgets and validation (Inputs, the lazy-chunk row); Test strategy (the `puzzles.spec.ts` row,
the seen-red row); Gate commands mapping (the vacuous-green guards); the dependency order table and the critical
path; the lanes LW2, LW3, L11, L13, L14a, L14b, LP2, LX, L15; the revision log (row 4).

**Revision 2 (2026-10-31)** — what changed, by triage item:
- **W1** (the build cap was 10× the resume cap, so an accepted section could answer `'cap'` at resume; any `ru` edit
  re-versioned the world and sent every in-section save through the proof):
  - one constant, `RESUME_STATE_CAP` = 5,000, for `world/state-cap` (build) and the resume search (runtime); the
    200,000 build cap is gone;
  - both searches share the start (`sectionEntry`), the key (`sectionKey`, which also abstracts `visited`) and the
    cap, so `'cap'` cannot occur for a section the build accepted;
  - the resume time is stated: ≤ 300 ms at CPU 4× for a full 5,000-state enumeration (estimate ≈ 60 µs per state at
    4×; verify in LW2 seen working and L15);
  - the world version is `worldVersion(body)`, a hash with every world text `{ id, ru }` replaced by `1`, so a text
    or `--fix-ids` edit keeps every save on the identity branch;
  - sections changed: X9 (World version, step 4, The cost, Why, Alternatives, Trade-off: the section-size bound);
    the successor relation; `sectionKey` / `RESUME_STATE_CAP` in the state API; the `worldVersion` signature in
    the TS types; the `world/state-cap` lint row; the Budgets row "Resume search after a rules update"; the
    concurrency row "Story update…"; T11; Q18 (the engineering bound); tests
    `softlock: section above RESUME_STATE_CAP fails the build`, `emit: world version ignores texts`, and the
    control `emit: world version changes on a rules edit`; seen-red rows (LW2, LW3).
- **W2 (a)** (the resume proof checked one path from the reconciled state, not the states reachable from it): step
  4 is now membership. `inSectionReach` keeps the state only if the current world produces it from section entry.
  The new invariant (I-W, X9 "The invariant" and "Invariants added") makes the identity branch sound: every saved
  in-section state is in the entry-reachable set, which T9's build proof covers. Sections changed: X9 (same-version
  branch, step 4, The invariant, Why, Alternatives), `reconcile` header, `sectionEntry`, `inSectionReach`, F9,
  "Invariants added", the module row, the K12 row of "PROTOTYPE-PLAN.md decisions changed"; test
  `reconcile: a dead end reachable from the reconciled state restarts the section`; seen-red row (LW2).
- **W2 (b)** (`resetSection` left `section` = S, so the start room's `onEnter` did not fire on resume):
  `resetSection` sets `section` = null and `room` = null, removes `lastRoom[S]` and clears `pendingStory`. The next
  `enter-section S` takes the entry branch and yields `sectionEntry`, the state the build's search starts from.
  Sections changed: `resetSection`, the `enter-section` reducer rule, F9, the concurrency row; test
  `reconcile: reset section fires the start room's onEnter on resume`; seen-red row (LW2).
- **Recorded, not resolved:** PE7 (the triage's "not counted" item: a `reduce` rules change with no world edit
  keeps `version`).

PROTOTYPE-PLAN.md sections changed in this revision (each body edit marked "changed by PUZZLES-PLAN revision 2";
the seen-red row already carries "changed by PUZZLES-PLAN"; PP revision 5): the status line; K12 ("Changed by PUZZLES-PLAN (X9)"); Save format and resume ("Every level"); the
seen-red "puzzle extension" row; the lanes LW2 (commits 3, 4, 5 and seen working), LW3 (commit 3) and L15 (seen
working); the revision log (row 5).

**Revision 3 (2026-10-31)** — what changed, by triage item:
- **W1** (step 4 ran only for the current section, so a section re-entered after a version change, left through a
  `leave` or left behind in another section, escaped the membership proof; the next autosave stamped the new
  version and the soft-lock became permanent):
  - step 4 is scoped to the current section by name (none when `section` is null);
  - new step 5: `unproved` = every other section of the current world; each is proved at its next `enter-section`
    by `admitSection` (enter with `reduce`, then `inSectionReach` on the entered state; `'no'` / `'cap'` → a `reset`
    effect and `sectionEntry`), the explore controller's only way into a section;
  - a reset happens only to a section whose `section` is null or itself, so the current section's `section` / `room`
    / `pendingStory` are never cleared by another section's reset; `resetSection` also takes S out of `unproved`;
  - the cost: ≤ 300 ms at CPU 4× per search, one search per load (the current section) and one per entry (the
    entered section), never two at one point, whatever the section count;
  - rejected: proving every section at load (the load grows with the section count and needs a second
    `resetSection`); a lint forbidding re-entry after a `leave` (removes the interlude-and-return pattern);
  - sections changed: the status line; T11 ("Proved by"); "Invariants added" (I-W per section); X9 (World version,
    same-version branch, step 4, step 5, The invariant, The cost, Why, Alternatives, Trade-off); the TS types
    (`WorldState.unproved`, the `reset` effect, the `reduce.ts` writer comment, the `sectionKey` comment, the
    `reconcile` header and `admitSection`); the `enter-section` reducer rule; `resetSection`; Module API
    (`ExploreController.enter`); F7 step 1; F9 ("Every level"); the concurrency row "Story update…"; the module
    rows (`reconcile.ts`, `controller.ts`); the K12 row of "PROTOTYPE-PLAN.md decisions changed"; the Budgets row
    "Resume search after a rules update"; Test strategy; the seen-red table (reconcile row, new controller row);
    tests `reconcile: a section left through a leave restarts on re-entry after a version change`,
    `reconcile: a version change marks every other section unproved and keeps the current section and room`,
    `controller: enter admits an unproved section`.
- **Recorded, not resolved:** O1 (a cross-section `unlock` puts a section's first entry outside `sectionEntry`).
  After a version change, step 5 can revoke such an unlock: when the entered state of an unproved section B is
  outside B's entry-reachable set, B restarts from `sectionEntry`, which the build proved reaches a `leave` without
  the unlock, so the player is not stranded, but the unlock A gave is gone. Within one version O1 stands as the
  critique states it; the lint-or-model decision stays open.
  - **Resolved in revision 4 (lint).** The "not stranded" claim above is refuted: `sectionEntry` reaches *some*
    `leave` (T9), but the trigger that gave the unlock stays fired, so a chapter whose ending lies behind that lock
    cannot be finished (W1 of the round-4 triage). The lint `world/cross-section-effect` (X15) now rejects such a
    world, so the first entry yields exactly `sectionEntry` within one version, and step 5 never revokes an unlock.

PROTOTYPE-PLAN.md sections changed in this revision (each body edit marked "changed by PUZZLES-PLAN revision 3";
PP revision 6): the status line; K12 (the "On load" bullet); Save format and resume ("Every level"); the seen-red
"puzzle extension" row (LW2, LX); the lanes LW2 (commits 3 and 4), LX (commit 1) and L15 (commit 1a); the revision
log (row 6).

**Revision 4 (2026-10-31)** — what changed, by triage item:
- **W1** (step 5 reverted a cross-section `unlock`, one made under the current version included, while the trigger
  that made it stayed fired; after any version change, an art-only one included, a lever in `courtyard` that opens
  a gate in `tower` left the chapter unfinishable):
  - decision: the lint (the triage's option (a)). New story-gate error `world/cross-section-effect` (X15, LW3): an
    `{ unlock: key }` in a room's `onEnter` or a hotspot's `then` / `onOpen` / `onFail` must name a hotspot of the
    trigger's own section, and every item and doc is given (`gives`, `{ give }`) in at most one section. With
    `world/cross-section-item`, only S's own actions and triggers write the keys `sectionKey(S)` reads, and they
    run only while S is current, so `admitSection` judges only old-world progress. Reconcile, its cap and its
    tests are unchanged; 0 runtime bytes;
  - the lint covers foreign gives (the triage's scope note): an item or doc given in two sections fails the build;
  - round-3 O1 is closed by the same rule: within one version the first entry of a section yields exactly
    `sectionEntry`;
  - the World version claim (art-only edits "keep every saved state") is reworded: they keep every section state
    the old version proved, and a section still in `unproved` gets only the check it was already owed;
  - rejected: modelling foreign writes (the build would prove S from every combination of foreign keys, losing the
    one-cap argument and X15's per-section T9 proof); narrowing step 5 to the sections with old-world keys (does
    not close the order in which the lever is pulled before the update);
  - trade-off: no cross-section shortcut or shared gift (Later, with a cross-section checker); such an area is one
    section, within RESUME_STATE_CAP;
  - sections changed: the status line; T11 ("Proved by"); "Invariants added" (I-W's premise); X9 (World version,
    step 5's premise, The invariant, Why, Alternatives, Trade-off); X15 (What, Why, Trade-off); Lock (`unlock`);
    Effects (`unlock`); the lint-code table (new row); the concurrency row "Story update…"; Test strategy (Story
    gate: the control test); the seen-red `story` (world) row; Q18 (the engineering bound); the Revision 3 entry
    (O1 marked resolved); the revision log (row 4);
  - tests: `lint: world/cross-section-effect red on fixture` (the courtyard/tower world and a doc given in two
    sections), `lint: world/cross-section-effect allows a cross-room unlock inside a section`. The existing
    `reconcile: a section left through a leave restarts on re-entry after a version change` (one section, no
    cross-section write) passes the new lint and stays green.
- **Not touched:** O1 (no non-empty `unproved` codec fixture) and O2 (no red for the `reset` → toast mapping) of the
  round-4 triage are noted, not folded in. Critique-r4 OQ1 is folded into W1; OQ2 / PE7 (`RULES_VERSION`) stays with
  the LW2 cut (RULINGS 13). STAGING-DSL.md is not edited: LW1 documents the world codes from the lint table.

PROTOTYPE-PLAN.md sections changed in this revision (each body edit marked "changed by PUZZLES-PLAN revision 4";
PP revision 7): the status line; the seen-red "puzzle extension" row (LW3); the lane LW3 (commit 1: the new red and
its control; the lock is unchanged, `world.ts` and `world.test.ts` are already in it); the revision log (row 7).

**Revision 4b (2026-10-31, database errata)** — RULINGS 14 (PostgreSQL 18 through sqlx 0.9 `postgres` everywhere;
the port lanes LDB0 → LDB1 run in the server slot after L6a and before L6b) applied as `design/db/decision.md` §4.6
directs (RULINGS 14 Q8: errata at the design/puzzles merge). What changed, by item:
- **`0002_puzzles.sql` in the PostgreSQL dialect** (section "SQL"): the heading says "`0001` is the PostgreSQL schema
  of LDB1" ("applied and never edited" dropped); the table is decision §4.6's: every integer `BIGINT`, every
  constraint named (`puzzle_progress_pkey`, `_user_fk`, `_id_shape`, `_attempts_positive`, `_window_bounded`,
  `_solved_after_first`, `_window_after_first`), no `STRICT`; a dialect note and an FK-index note.
- **The id CHECK** (architect's call, as §4.6 allows): `puzzle_id ~ '^ch[1-9][0-9]*[.][a-z][a-z0-9_]*$'`, the
  `PuzzleId` grammar this design defines (Identifiers: `<chapter>.<local>`; chapter = the STAGING-DSL `id/format`
  chapter part, local = `PuzzleLocalId`), not the GLOB's exact translation `^ch[1-9].*[.][a-z]`. Pinned by the new
  `schema_puzzle_id_shape` (Test strategy; PP L6c commit 1 and its tester mutation).
- **The attempt upsert** (section "SQL"): `INSERT … AS p`, every existing-row column in `DO UPDATE SET` qualified
  `p.`, `$n` placeholders, the window bound as `$4`; the "two concurrent attempts serialize" bullet; the concurrency
  row "Two devices attempt the same puzzle".
- **`owned_products`** (Rust types): `starts_with(product_id, $2)`, never `LIKE $2 || '%'`.
- **Pre-checkout** (section "SQL"): step 0, the payer-row lock (DB-4), then the PK read and the UPDATE whose three
  predicates now come after the lock; `$6–$8` typed as `Option<&str>`; the benign "hint bought as the puzzle is
  solved" note. Consequential statement counts: X6 trade-off, F8 H4, readiness checklist item 4.
- **The red text** (seen-red table, server row): `relation "puzzle_progress" does not exist` (SQLSTATE `42P01`)
  replaces "no such table: puzzle_progress".
- **Readiness checklist** item 2: "id GLOB" → "id regex = the `PuzzleId` grammar", named constraints, the dialect.
- **Order** (Implementation plan): the port-lanes bullet; L6c's gate to start stays L6b, which waits for LDB1.
- **Not touched:** PP K14, K18, K19, the `0001` schema section and every other decision §6 edit (they land with
  LDB0/LDB1, RULINGS 14); LDB0/LDB1 are not re-cut; STAGING-DSL.md is not edited; the "Fixed by running or merged
  lanes" bullet on `0001` (its `entitlements` facts hold in LDB1's `0001`, decision §4.1).

PROTOTYPE-PLAN.md sections changed in this revision (PP revision 8): the status line; the dependency order (a
"changed by PUZZLES-PLAN revision 4b" sentence under the heading, the LDB0 and LDB1 rows, L6b's gate + LDB1, L6c's
gate note, the lane count, the server launch order, the critical path's server chain, the LW3 note); the lane L6c
(gate to start, commit 1's red and "Also", the tester mutation; each marked "changed by PUZZLES-PLAN revision 4b");
the revision log (row 8).

**Revision 5 (2026-10-31)** — what changed, by triage item:
- **W1** (narrowed; a puzzle attached to locks in two sections wrote another section's state: a `code` puzzle
  `keypad` on `yard.shed` in `courtyard` and on `hall.gate` in `tower`, solved in the courtyard, left the tower gate
  with every slot filled and an outcome, so its tap showed the lock panel forever; tower's per-section search starts
  with the run reset and proves tower, so only a seeded random walk (`play/step-cap`) might catch the strand; after a
  version change `admitSection(tower)` reverted a run the current version wrote; and "open the lock" named no lock):
  - decision: the strict rule. New story-gate error `world/puzzle-multi-lock` (X15, LW3, in `world.ts`): no two
    locks, in one section or in two, name the same puzzle. `puzzle-ended p` then has exactly one target, and p's
    run and that lock are keys of the same section, so X9 step 5's premise, I-W's first entry ("yields exactly
    `sectionEntry`") and "the checker covers exactly what the runtime can reach" hold for every world the gate
    accepts. Reconcile, its cap and its tests are unchanged; 0 runtime bytes;
  - the reducer rule `puzzle-ended p`: `solved` opens p's lock (the one lock that carries p) and runs that
    hotspot's `then`; `failed` runs that lock's `onFail` once;
  - step 5's writer list names the run of each puzzle attached to one of S's locks, and `puzzle-ended p` as an
    action on S's keys only;
  - rejected: all locks of a puzzle in one section plus a target rule (opening every lock makes one solve a
    multi-lock unlock and shares fails; opening the tapped lock needs a run per lock); a run keyed by `HotspotKey`
    (changes the save format, the `pz_<puzzle>` projection, the hint products and the server's per-puzzle solve
    state, and a solve at one door would refuse hints at the other);
  - trade-off: two doors sharing a code are two puzzle entries (two ids, two hint ladders, the same `solution`) or
    one lock;
  - sections changed: the status line; T9 and T11 ("Proved by"); "Invariants added" (I-W's premise); X9 (step 5's
    premise, The invariant, Why, Trade-off); X15 (What, Why, Alternatives (revision 5), Trade-off); Identifiers
    ("Reserved"); Lock; the `sectionKey` comment; the reducer rule `puzzle-ended`; the successor-relation closing
    paragraph; `resetSection`; the lint-code table (new row); the concurrency row "Story update…"; Test strategy
    (Story gate: the control test); the seen-red `story` (world) row; the revision log (row 5);
  - tests: `lint: world/puzzle-multi-lock red on fixture` (the round-5 keypad world across two sections, and the
    same puzzle on two locks of one section; predicted red against the revision-4 `world.ts`: no error-level
    finding; `play/step-cap` through the seeded playthroughs is a different red),
    `lint: world/puzzle-multi-lock allows one puzzle on one lock` (the demo shape). The demo world attaches `drawer`
    and `gate` once each, so it passes the new lint unchanged.
- **Not touched:** O1 (per-site coverage of the `world/cross-section-effect` red), O2 (no concurrent attempt-window
  test) and O3 (the SQLite-flavoured L8b block, PP "L8b", a `design/db/` carry) of the round-5 triage are noted, not
  folded in. Critique-r5 OQ1 (a room→room exit across sections) is noted by the triage and not folded in: step 5's
  writer list makes no new claim about moves (see `revision_r5.md`, "Not touched", for the triage's
  recommendation). OQ2 / PE7 (`RULES_VERSION`) stays with the LW2 cut (RULINGS 13). STAGING-DSL.md is not edited:
  LW1 documents the world codes from the lint table.

PROTOTYPE-PLAN.md sections changed in this revision (each body edit marked "changed by PUZZLES-PLAN revision 5";
PP revision 9): the status line; the seen-red "puzzle extension" row (LW3); the lane LW3 (commit 1: the new red and
its control; the lock is unchanged, `world.ts` and `world.test.ts` are already in it); the revision log (row 9).

**Revision 6 (2026-10-31)** — what changed, by triage item:
- **W1** (a room→room exit into another section's room let the player act in that section while another was
  current: courtyard's `yard.arch` led into tower's `hall`, where a tower lever opened a drop into tower's `pit`,
  whose way back needs a rope from `hall`; courtyard's search drops the lever's successor, because `sectionKey`
  ignores tower keys, and tower's search never reaches `hall`, so neither expands `pit` and the gate accepted the
  strand with one `world/unreachable` W, or with none in a variant; after a version change `admitSection(tower)`
  reverted the lever the current version pulled; and the reducer contract did not define the move):
  - decision: new story-gate error `world/cross-section-exit` (X15, LW3, in `world.ts`). A room→room exit whose
    `to.room` is a defined room of another section than the exit's own fails the build. Every such exit is printed,
    so a crossing pair is two findings, and an undefined room stays `world/unknown-ref`. Sections join only through
    the story (a `leave` exit and an `explore` yield). Every move then stays inside its section, the fourth
    guarantee of X9 step 5's premise. So the writer list ("run only while S is current"), I-W's first entry and
    "the checker covers exactly what the runtime can reach" hold for every world the gate accepts; revision 5's
    entry made that claim before this rule existed, and it was false for a world with a crossing exit. Reconcile,
    its cap and its tests are unchanged; 0 runtime bytes;
  - the reducer: the move rule and the `actions` comment state that the target room is a room of `s.section`. The
    lint guarantees it, so there is no runtime check. The room lookup stays chapter-wide (rooms are unique in the
    chapter), so `world.ts` reports the finding on the red fixture without throwing;
  - rejected: `world/unknown-ref` resolving `to.room` per section (it reports a defined room as undefined, one code
    then covers two faults so neither red fails alone, and the reducer's per-section lookup would be undefined on a
    rejected world); modelling cross-section moves (a move would enter a section without `admitSection`, and
    `sectionKey` would span sections, which loses the per-section T9 proof and the one cap); a runtime section check
    in the move rule (a dead door in the shipped game, the world still unproved, runtime bytes for a build fault);
  - trade-off: a walkable door between two areas is a `leave` exit and an `explore` yield, or the areas are one
    section within RESUME_STATE_CAP;
  - sections changed: the status line; T9 and T11 ("Proved by"); "Invariants added" (I-W's premise); X9 (step 5's
    premise: a fourth lint bullet and the writer paragraph; The invariant: the first entry; Why; Trade-off: "None
    strands" and a new bullet after the shortcut bullet); X12 (Exits); X15 (What, Why, Alternatives (revision 6),
    Trade-off); the hotspot-kind table (the `exit` row); the `actions` comment; the reducer's move rule; the
    successor-relation closing paragraph; the lint-code table (new row); the concurrency row "Story update…"; Test
    strategy (Story gate: the control test); the seen-red `story` (world) row; Q18 (the r6 engineering bound); the
    revision log (row 6);
  - tests: `lint: world/cross-section-exit red on fixture` (the round-6 arch world; it asserts the two findings,
    `yard.arch` and `hall.to_yard`, and no throw; predicted red against the revision-5 `world.ts`, without
    `--strict`: no error-level finding, per-section `world/softlock` green, the only output a `world/unreachable` W
    on `pit`; a seeded-playthrough `play/step-cap` is a different red, and a `world/unknown-ref` means a malformed
    fixture), `lint: world/cross-section-exit allows a room→room exit inside one section` (the control). The demo
    world has one section, `manor`, so its exits pass the new lint unchanged.
- **Not touched:** O1 (the same-section `onOpen` unlock idiom missing from the shared-code trade-off, an authoring
  note for N1 / D1) and O2 (the seen-red row's "the rest the round-4 shape" wording) of the round-6 triage are noted,
  not folded in. Critique-r6 OQ1 (does `world/softlock` run on a structurally invalid world) stays a detail for the
  LW3 cut; this revision settles only what W1 needs, a move lookup that is defined on a world this lint rejects.
  OQ2 / PE7 (`RULES_VERSION`) stays with the LW2 cut (RULINGS 13). STAGING-DSL.md is not edited: LW1 documents the
  world codes from the lint table.

PROTOTYPE-PLAN.md sections changed in this revision (each body edit marked "changed by PUZZLES-PLAN revision 6";
PP revision 10): the status line; the seen-red "puzzle extension" row (LW3); the lane LW3 (commit 1: the new red and
its control; the lock is unchanged, `world.ts` and `world.test.ts` are already in it); the revision log (row 10).
