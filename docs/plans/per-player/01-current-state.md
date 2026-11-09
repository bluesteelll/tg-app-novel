## 1. Current state on main

| Fact | Where |
|---|---|
| Routes: `GET /api/puzzles/{puzzle_id}`, `POST .../attempts`, `POST .../hints/{tier}` | `server/src/api/mod.rs:66-71` |
| Limits: window 600 s, 20 attempts, answer <= 16 entries | `server/src/puzzles/mod.rs:13-21` (LIMIT) |
| Type-agnostic check: shape, then `answer == def.solution` | `puzzles/mod.rs:64-72` |
| One gate for every puzzle route: 404 unknown, 403 paid without the chapter | `puzzles/mod.rs:94-107` |
| `attempt` computes `correct` **before** the transaction, then `record_attempt` | `puzzles/mod.rs:110-134` |
| `status`: hint texts only for unlocked tiers, static texts | `puzzles/mod.rs:138-164` |
| Invariant "no solution reaches this module" | `server/src/db/puzzles.rs:4-5` |
| `record_attempt`: upsert counts first and holds the (user, puzzle) row lock; past 20 commits and returns limited; else sets `solved_at` once | `db/puzzles.rs:28-86` |
| Tables `puzzle_progress` PK `(user_id, puzzle_id)`, `hint_unlocks` PK `(user_id, puzzle_id, tier)`, id grammar CHECK | `server/migrations/0002_puzzles.sql:5-32` |
| Hint spend: one transaction, (1) not solved and tier n-1 unlocked, (2) unlock insert `ON CONFLICT DO NOTHING` = the arbiter, (3) debit keyed `hint:<user>:<puzzle>:<tier>` | `server/src/db/economy.rs:372-452`, keys `:237-252` |
| Ledger `ref` = `'<puzzleId>:<tier>'` | `server/migrations/0004_economy.sql:28` |
| Puzzle content: `PuzzleDef { id, chapter, answer_len, answer_max, solution, title, hints }`; file format 1, `type` checked against a closed `PuzzleKind {Code, Order}` | `server/src/content.rs:169-186`, `:384-415`, `:787-832` |
| Startup: content, catalog, policy, gateway, pool, migrations; then serve | `server/src/lib.rs:71-93` |
| OS RNG use | `getrandom::fill` (`server/src/db/orders.rs:93-97`), `getrandom = "=0.4.3"` (`Cargo.toml:29`) |
| DTOs `AttemptRequest {answer}`, `AttemptResponse {correct, solved}`, `PuzzleStatus`, `HintView` (ts-rs) | `server/src/api/dto.rs:179-221` |
| Client: `postAttempt`, `getPuzzle`; `Endpoints` is in the entry | `client/src/api/endpoints.ts:66-85`, `:104-110`, `:189-193` |
| Client decoders `PuzzleStatus`, `AttemptResponse` | `client/src/api/decode.ts:343-351` |
| World types: `SourcePuzzle` carries `solution` + `hints`; `PublicPuzzle` `hintTiers`; `ServerPuzzleContent` format 1 | `client/src/world/types.ts:94-139` |
| Public world refuses `solution` / `hints` | `client/src/world/decode.ts:80`, `:577` |
| `toServer` emits the solution | `world/decode.ts:687-697`; called at `client/scripts/story/emit.ts:428` |
| The emitter's fixture contract test | `client/scripts/story/build.test.ts:1105-1123` reads `server/tests/fixtures/content/puzzles/ch1.json` |
| `maxAttempts` (1..9) client-only; the session counts wrong answers and ends `failed` at the limit | `world/types.ts:99-100`; `client/src/puzzles/session.ts:235-253`; X8 `docs/PUZZLES-PLAN.md:290-315` |
| D18: a run at its limit ends `failed` without a session | `client/src/app/yields.ts:571-576` |
| Every world text is resolved through `h.text` (yields host) and every ink line, choice and backlog entry through `s.lines.text` | `yields.ts:103`, game `client/src/app/game.ts:1280`; `game.ts:437-455` |
| Relabel of the views on a language change | `game.ts:457-470`; `Yields.relabel` `yields.ts:142-143` |
| `GameDeps.api` Pick (getPuzzle, postAttempt, ...) | `game.ts:91`; yields `yields.ts:89` |
| Demo puzzles: ch1 `drawer` 4 dials, `maxAttempts: null`, clue "the year the house was built: 1847"; ch1 `gate` order; ch2 `cabinet` 3 dials, `maxAttempts: 3` | `story/ch1/world.json:33`, `:50-63`, `:39-49`; `story/ch2/world.json:6-15` |
| Erasure: designed order, no command | `docs/META-PLAN.md:1841` (inventory row), `:1860-1868` (erasure paragraph) at `525dd68` (round 6, m3; rounds 1-5 cited `:1828`, `:1847-1855`); policy promise `server/legal/privacy-policy.html:592-595` |
| Scene: five shared layers; the adapter adds bare sprites to a layer; only characters get a `Container` | `client/src/scene/controller.ts:121-130`, `:133-198` (`group` `:140-146`, `sprite` `:152-160`) |
| Executor: bg / cg / prop views are single sprites; `swapBg` destroys and replaces; crossfade fades the new sprite; `rebind` re-creates sprites | `client/src/scene/executor.ts:202-207`, `:455-501`, `:569-577`, `:765-813` |
| Textures are created only in `scene/loader.ts` / `scene/registry.ts` | `client/src/arch.test.ts:176-177`, `:211-214` |
| Registry caps 32 / 48 MiB, records keyed by asset id, `Decoded<T>` with `revive` | `client/src/scene/registry.ts:12-17`, `:49-58`, `:87-114` |
| Room-set row: `bg + props + max(neighbour bg, close-up)` (`roomRows`) | `client/scripts/budget.ts:869-899` at `a6365a8` (M3c moved it; `:869-896` at `5c702c4`) |
| D18 checks the local count; `ended` records the outcome in the world (`act({ kind: 'puzzle-ended' })`) for both modes | `yields.ts:571-576`; `yields.ts:524-542` (`:535`) |
| An attempt maps to `{correct, solved}`; the client `ApiError` carries the server `code` | `server/src/puzzles/mod.rs:110-134`; `client/src/api/http.ts:19-24` |
| `MAX_ANSWER_LEN` 16; the shape check | `puzzles/mod.rs:21`, `:64-72` |
| Content load accepts format 1 only | `server/src/content.rs:793-795` |
| View state is `$state.raw`, replaced never mutated; `LineView {lineId, speaker, text}`, `ChoiceView` | `client/src/ui/state.svelte.ts:3`, `:21-23`, `:114-116` |
| `relabel` re-builds the line, the choices (a new `id` per call) and the backlog on every call | `game.ts:442-445`, `:457-466` |
| DialogueBox restarts the reveal for every new line object; the typewriter writes two spans through `textContent` | `client/src/ui/DialogueBox.svelte:61-76`; `client/src/ui/typewriter.ts:70-75`, `:105-129` |
| A same-key toast replaces the entry in place; toasts have no motion today | `state.svelte.ts:141-147`; `client/src/ui/Toast.svelte:28-69` |
| The explore controller renders world texts through one `text` dep; doc body and item desc are strings | `client/src/explore/controller.ts:61`, `:183`, `:188`; passed at `yields.ts:460` |
| Executor `sweep()` keeps only the logical snapshot's, the unfinished batches' and the shown views' (holder, id) pairs; `destroy()` releases the `scene:` prefix | `client/src/scene/executor.ts:288-322`, `:906` |
| The debug hook (scene stats, prop rects) and the game test's `FakeScene` literal | `game.ts:353-359`, `:1640-1653`; `client/src/app/game.test.ts:268-357` |
| The e2e reads the drawer's solution from `story/ch1/world.json` | `client/e2e/helpers.ts:371-382`, used at `:532` (`puzzles.spec.ts`, `perf.spec.ts`, `purchase.spec.ts` through `playCh1ToGate`) |
| DTO pins: `api.ts` byte-equal to `ts_bindings()`; every exported type and error code sampled; decoders keyed by `NAMES`, every name with a `MALFORMED` case; `META_KINDS` and `ERROR_CODES` exhaustive | `server/tests/it/bindings.rs:12-52`; `server/tests/it/dto_samples.rs:625-633`; `client/src/api/decode.test.ts:16`, `:190`, `:226`; `client/src/api/endpoints.ts:130-151`; `client/src/api/decode.ts:79-99` |
| Rollback = the previous binary with the previous content; a restore only across a sqlx migration | `docs/runbooks/deploy.md:128-136` |
| The achievements read takes puzzle ids from the meta index | `server/src/db/achievements.rs:101-125`, called at `server/src/api/cards.rs:62-66`; facts `server/src/meta.rs:559-567` |
| The story tool's source fixer flag `--fix-ids` (line IDs, world text IDs) | `client/scripts/story.ts:7`, `:540`; `client/scripts/story/fix.ts:1`, `:220` |
| **Round 3 reads (main `a6365a8`)** | |
| A test outside `tests/it/puzzles.rs` calls a puzzle repo function with a `PuzzleId`: `spend_hint(UserId(ANN), &drawer, ...)`; `tests/it` is one binary (`main.rs` + modules); no call site under `server/dev` | `server/tests/it/refunds.rs:421-423` on `d31f720` (`:417-419` before LRF; Grep `PuzzleId\(\|spend_hint\|record_attempt\|is_solved\|unlocked_tiers\|card_puzzles` over `server/`) |
| `payments.user_id` has no FK ("a payment row is never refused"); `users` is the root (no FK to itself); every other user column is an FK | `server/migrations/0001_init.sql:3-25`; FKs `0001:40`, `:58`, `:75`, `0002`-`0006` |
| The hint ladder fetches only when it opens; a re-read of an unlocked tier uses the in-memory text; an unlocked tier with `text: null` renders "unlocked" without text | `client/src/app/yields.ts:699-711`, `:726-729`; `client/src/puzzles/session.ts:280-306`; `client/src/ui/puzzles/HintLadder.svelte:41-45` |
| `HintPort.use` returns `{ text, balance }`; the wallet port drops other fields | `client/src/puzzles/session.ts:62`; `client/src/meta/wallet.ts:76-87` |
| The backlog lives for the session (created empty, pushed across chapters, capped at 50, restored from the save); `s.lines.text` falls back to the saved `ru` | `client/src/app/game.ts:1351`, `:669-671`, `:930`; `BACKLOG_MAX` (`save-codec.ts:49`); `client/src/i18n/lines.ts:18-29` |
| Line IDs are `<chapter>.<knot>.<suffix>` | `docs/STAGING-DSL.md:153` |
| `enterChapter` calls `s.yields.chapterChanged()` before `s.ch = ch`; the chapter load has already finished | `client/src/app/game.ts:824-841` (`:826`, `:827`), `:806-812`, `:885-917` |
| `lineShown` is the lazy first-line hook (chunk prefetch) | `client/src/app/yields.ts:801-815`; `chapterChanged` `:831-839` |
| `openPuzzle` opens the frame synchronously after the session and the close-up fade; Try sets `busy` + `line: 'checking'` | `client/src/app/yields.ts:563-616`, `:687-695`; `client/src/ui/puzzles/PuzzleHost.svelte:34-35` |
| `pauseAll` pauses GSAP's global timeline (every tween, in a batch or not); `stats()` counts `active` only | `client/src/scene/executor.ts:26-28`, `:871` |
| No overlay motion exists in `client/src`: no `svelte/transition`, no `@keyframes`, no `.animate(` (Grep); toasts render with none | `client/src/ui/Toast.svelte:28-69` |
| Svelte 5 runs `in:` / `out:` transitions through `element.animate` | `node_modules/svelte/src/internal/client/dom/elements/transitions.js:415`, `:476` (CODE, read in `docs-errata-8/wt-code-r1/client`) |
| Svelte component tests run in happy-dom; no test mounts `App`; `screens.svelte.test.ts` mounts `Toast` | `client/vite.config.ts:57-60`; `client/src/main.ts` (the only `App` importer); `client/src/ui/screens.svelte.test.ts:16`, `:299-340` |
| The entry row 39.4 / 40.0 KB br after M3c; "the entry lever the first item of the next lane that adds entry code"; the lever is the `MetaEndpoints` split | `RULINGS.md` 127; `client/src/api/endpoints.ts:189-193` |
| M3c's contracts this file uses | `createAssetRegistry({ load, variant, tier })` `client/src/scene/registry.ts:173`; `demote()` `:116`, `:573`; `textureGeometry(entry, tier)`, resolution `1 \| 0.5` `client/src/scene/layout.ts:35-44` |
| **Round 4 reads (main `d31f720`)** | |
| The scene renders on demand: `autoStart: false`; frames come only from the render loop on GSAP's ticker; a frame is drawn only while a timeline runs or the stage is dirty, then the listener is removed | `client/src/scene/controller.ts:131`, `:423-435`; `client/src/scene/render-loop.ts:1-3`, `:36-49` |
| The executor holds the loop (`ExecutorDeps.loop`); a batch timeline joins `active` and calls `loop.begin()`; `stats()` counts `active` only | `client/src/scene/executor.ts:99-100`, `:649-650`, `:871` |
| The loop and the executor survive a rebuild: `rebuild` calls `executor.rebind(pixiAdapter(...))` on the same executor | `client/src/scene/controller.ts:340-358`, `:436-451` |
| The adapter: `group`, `dropGroup`, `sprite(layer, tex, g?)`, `destroy`, `set`, `fx`; `pixiAdapter` and `createLayers` are module-private | `client/src/scene/executor.ts:49-60`; `client/src/scene/controller.ts:136`, `:148` |
| No vitest imports `pixi.js` (only `arch.test.ts` fixtures name it); the node project runs `src/**/*.test.ts`, the happy-dom project `src/**/*.svelte.test.ts` | Grep `from 'pixi\.js'` over `client/src/**/*.test.ts`; `client/vite.config.ts:50-51`, `:59-60` |
| `Toast.svelte` is an entry module (a static import of `App.svelte`); the engine is a lazy chunk; every other overlay component is the engine's (`vm.ui`) | `client/src/ui/App.svelte:4-5`, `:19`, `:281`; `client/src/app/boot.ts:410` |
| No Svelte directive runtime beyond the basics in any component: no `in:` / `out:` / `transition:` / `animate:` / `use:` / `{@attach}` anywhere, `{#key}` only in the lazy `PuzzleHost.svelte:76`; `bind:this` and `$effect` are in entry components | Grep over `client/src/**/*.svelte`; `App.svelte:48`, `:63` |
| The main UI tables ship in the entry (`i18n/index.ts` imports both, `t()` is used by entry modules); a lazy chunk's own table is the precedent | `client/src/i18n/index.ts:3-4`, `:18`; `client/src/app/boot.ts:14`; `client/src/i18n/meta.ts:1-2`, `:135-142` |
| The entry lever's code: `createMetaEndpoints` (called by the entry, `boot.ts:287`) and the decoders only it reaches | `client/src/api/endpoints.ts:217-247`; `client/src/api/decode.ts:198-215` (`uniqueBy`), `:252-281`, `:364-412`; "about 2.2 KB br" (CLAIM, `carry.md:1207-1208`) |
| LRF's migration `0007_auto_refunds.sql`: `auto_refunds` keyed by `charge_id` (FK to `payments`), no user column; `unrecorded_refunds.user_id` and `admin_id` BIGINT without an FK | `server/migrations/0007_auto_refunds.sql:7-21`, `:24-31` (`:26-27`) |
| `spend_hint` and the hint-spend transaction; the `AlreadyUnlocked` branch | `server/src/db/economy.rs:372-452` (signature `:383`, `:418-421`) |
| `PuzzleId(` outside a repo call: the meta unit-test helpers build `Condition::Puzzle` and `Facts.puzzles` keyed by the meta index's ids | `server/src/meta.rs:677-682`, `:700-710` |
| **Round 5 reads (main `525dd68`)** | |
| Every story-tool finding is typed by one closed table: `Severity`, `LINT_CODES`, `LintCode = keyof typeof LINT_CODES`, `Finding = { code: LintCode; ... }`; the in-tree precedent registers later world codes there ("Enforced from LW3 ... registered here so its findings are typed `LintCode`") | `client/scripts/story/lint.ts:11`, `:14-104` (`:68-69`), `:107` |
| `dsl-doc: lint table equals lint codes` holds `LINT_CODES` equal to STAGING-DSL §11, `expect(table).toHaveLength(86)` | `client/src/story/dsl-doc.test.ts:139-152` (`:146`) |
| story.ts's `finding()` helper takes its severity from `LINT_CODES`; the stages: source lint, compile, graph (`:616-629`); the world lint per chapter, given its graph's knots and yields (`:630-651`); the files an error of stages 1-4 names are not played, localization errors do not gate play (`:685-686`); the en tables are read and judged in stage 5 (`:688-697`); playthroughs (`:703-721`) | `client/scripts/story.ts:48-49`, `:602-721` |
| Toast keys name a purpose and repeat: every look text is key `look`; `got`, `area_reset`, the sound chip, the resume and purchase toasts likewise | `client/src/app/yields.ts:288`, `:294`, `:314`; `client/src/app/game.ts:492`, `:955`, `:1120` |
| The executor tests' loop is the real `createRenderLoop` on a ticker that never ticks; `harness` takes the loop as a parameter | `client/src/scene/executor.test.ts:139-142` |
| docs-errata-9 wrote LRF's privacy rule: both refund tables in the access read, and "the block touches neither `auto_refunds` nor `unrecorded_refunds`" on erasure; META-PLAN's inventory predates them | `docs/runbooks/privacy-ops.md:113-117`, `:120-142`, `:152-170` (`:155-157`) |
| **Round 6 reads (main `525dd68`)** | |
| `worldLines` is the one world-text walker and a fixed list of kernel fields: item name / desc, doc title / body, puzzle title / prompt / hints, room title, hotspot label, lock text, look; `WorldLine = StoryLine & { hint, path }` | `client/scripts/story/world.ts:324-360` (`:39`) |
| Its consumers: `readWorlds` (the lines kept per chapter, `story.ts:319`) feed `--sync-locales` and `localeStage` (`:691-697`) and `shippedEn` (`:740`), which throws when a line has no en text (`:432-442`); the paid / hint needles (`worldFingerprints`, `world.ts:393-404`, called at `scan-dist.ts:485`; round 7, r6 m6 (f): round 6 cited `:457`, which is the free worlds' public texts, `worldLines` at `:457-458`); `id/chapter-prefix` (`world.ts:661-666`) | as cited |
| `checkLocales` joins each chapter's ink lines with its world lines (`locales.ts:239`); an en key that names none of them is `loc/orphan-en` (`:196-199`) | `client/scripts/story/locales.ts` |
| A test builds `WorldLine` literals with exactly today's fields | `client/scripts/story/locales.test.ts:238-240` |
| GM1b and GM1c are the only engine lanes holding `scripts/story/world.ts`; GM3c (the composed decoder, `world.mods`) holds `world/{types,decode}.ts` but not it; engine.md §5.1 leaves the module texts to "GM3's cut verifies" | [engine GM1b `mech-registry`](../engine/12b-lanes-gm1-gm2.md#gm1b-mech-registry), [engine GM1c `mech-puzzle-instance`](../engine/12b-lanes-gm1-gm2.md#gm1c-mech-puzzle-instance), [engine §12 Order and conflicts](../engine/12f-order-and-conflicts.md#order-and-conflicts), [engine GM3c `mech-conditions`](../engine/12c-lanes-gm3.md#gm3c-mech-conditions), [engine §5.1 World JSON: keys per module, no world-format bump](../engine/05-world-data-and-save-format.md#51-world-json-keys-per-module-no-world-format-bump) (as read) |
| A yield found in a knot from the sources with the shared classifier: `yieldIn(node, sources)` scans `classify(text).slice(node.line)` to the next knot header with `tagsOf` / `tagKind`; `checkEndings` gets story.ts's sources map | `client/scripts/story/stories.ts:191-211`; `client/scripts/story.ts:664`; `classify` `client/scripts/story/classify.ts:444` (`SourceLine` `:85-92`, kinds `:20-82`); `tagsOf` exported by `lint.ts` (imported at `graph.ts:13`) |
| `ChapterGraph` carries knots (`file`, `line`) and `lines: StoryLine[]` without kind or nesting; per-knot yields without positions are in `GraphFacts`; the yield sites with lines are local to `buildGraph` | `client/scripts/story/graph.ts:18-48`, `:57-59`, `:519-544` |
| Build files that are pure inject what needs node: `fix.ts` ("story.ts reads the files, injects the random suffixes"); the only in-tree SHA-256 is `emit.ts`'s `node:crypto` | `client/scripts/story/fix.ts:3`; `client/scripts/story/emit.ts:10`, `:121`, `:147` |
| The app program compiles `src/**` with `types: ["vite/client"]` and reaches `scripts/story/lint.ts` through `dsl-doc.test.ts`; the node program has `types: ["node"]` over `scripts/**` | `client/tsconfig.json:7`, `:21`; `client/scripts/story/lint.ts:2-3`; `client/tsconfig.node.json:6`, `:15` |
| The frame: `canTry` = UI loaded, not busy, not ended, no countdown (no `line` test); the status line is plain text per `line`, `offline` included; the attempts line appears when `attemptsLeft` is non-null; disabled Try is a static `opacity: 0.5` | `client/src/ui/puzzles/PuzzleHost.svelte:21-23`, `:27-51`, `:81-84`, `:201-203` |
| `attempted` maps `network` / `not-entitled` to `line: 'offline'` with Try enabled; the `puzzle.offline` text | `client/src/app/yields.ts:654-661`; `client/src/i18n/ru.ts:134`, `en.ts:134` |
| **Round 7 reads (main `525dd68`)** | |
| The 429 countdown writes `line: 'rate-limited'`, `retryAfter`, `busy: false` each second and `line: 'idle'`, `retryAfter: null` at zero; Try is disabled while `retryAfter > 0` | `client/src/app/yields.ts:619-630`; `client/src/ui/puzzles/PuzzleHost.svelte:22-23` |
| `attempted`'s `wrong` writes the reply's `attemptsLeft` to the frame; the no-outcome branch writes `busy: false` only | `yields.ts:644-646`, `:662-666` |
| A session end drops the frame at once (`onEnd` -> `dropPuzzle`), but the world records the outcome only in the queued `ended`, after the close-up fade | `yields.ts:544-561` (`:548`, `:560`); `ended` `:524-542` (fade `:529-534`, `act` `:535`) |
| A toast is dismissed by key | `client/src/ui/state.svelte.ts:95`, `:168` |
| scan-dist: the free worlds' public texts come from `worldLines` (`:457-458`); the needles from `worldFingerprints` (`:485`) | `client/scripts/scan-dist.ts:443-469`, `:479-486` |
| **Round 8 reads (main `525dd68`)** | |
| Three outcomes: `PuzzleOutcome = 'solved' \| 'failed' \| 'abandoned'` | `client/src/explore/state.ts:6` |
| A lock puzzle's outcome is final and only a linear puzzle can be abandoned; a linear puzzle records its latest outcome, so an authored loop re-enters it | `client/src/explore/reduce.ts:477-487`; `docs/PUZZLES-PLAN.md:303-304`, `:1048-1049` |
| A lock opens its puzzle only while the run has no outcome | `reduce.ts:367-370`, `:472` |
| D18 ends a run at its limit without a session; every other open creates one, whatever the outcome | `yields.ts:571-584` |
| `ontry` is main's only `session.attempt()` call site in yields | `yields.ts:687-695` |
| The session clears its in-flight marker before `#settle`; a close or give-up asked during an attempt is deferred and a decisive answer wins over it | `client/src/puzzles/session.ts:212-226`, `:174-175`, `:227-231` |
| `chapterChanged` is called only by `enterChapter`, before `s.ch` is set; it sets the empty world | `client/src/app/game.ts:824-827`; `yields.ts:831-841` |
| The paywall resume of a not-owned chapter's start restores an empty world while `s.ch` stays the previous chapter | `game.ts:886-907` |
| **Round 9 reads (main `525dd68`)** | |
| `resumeBody` reuses the session's chapter when the body names it (`let ch = s.ch !== null && s.ch.id === body.chapterId ? s.ch : null`) and calls `enterChapter` only when it loads another; the paywall branch (`not-entitled` with `ink: null`) empties the stage, restores the empty world and returns without assigning `s.ch` | `client/src/app/game.ts:885-917` (`:887`, `:893-908`, `:906`) |
| Yields' world installations on main: two `s.yields.restore(` call sites, the paywall's empty world and the resumed body's world of `ch` (= `s.ch`, set by `enterChapter` or reused); `chapterChanged` is the only other world write | `game.ts:906`, `:925`; `yields.ts:817-841` (Grep `yields\.restore` over `client/src`: tests `yields.test.ts:314`, `:427`, `:429` only) |
| The yields host's chapter is the session's `s.ch` | `game.ts:1278` (`chapter: () => of().ch`) |
| A manual slot load, the "load theirs" path and the ink-error resume all go through `resumeBody` | `game.ts:1532-1549`, `:1511`, `:798` |
| `attempt()` returns `invalid` before its first `await`; a held `postAttempt` is a real await (`:221`); `countdown(o, 0)` writes `rate-limited` then `idle` in one call | `client/src/puzzles/session.ts:208-226` (`:215-218`, `:221`); `client/src/app/yields.ts:619-624` |
| **Round 10 reads (main `525dd68`)** | |
| `s.ch` is assigned at exactly two places: `enterChapter` (`s.ch = ch`, then two synchronous assignments, `:828-829`, where GM6c2 adds `chapterEntered()`) and `setLang`; the session starts with `ch: null` | Grep `\.ch = ` over `client/src/app/game.ts`: `:827`, `:1953`; `:1345` |
| `setLang` loads a free chapter's en table only when `ch.en === null`, replaces `s.ch` only when the result has the same id, then calls `relabel(s)`; it installs no world | `game.ts:1945-1960` (`:1950`, `:1952-1953`, `:1957-1959`); reached from `setSettings` `:1810-1813` |
| `loadEn` returns `{ ...ch, en }`: a new object with every other field shared, `world` included | `client/src/story/chapters.ts:256-274` (`:273`); `LoadedChapter` = `{ id, story, meta, assets, en, world }`, `client/src/story/catalog.ts:1060-1070` |
| A chapter loads its en table only for an en player | `game.ts:806-812` (`:811`, `withEn: vm.lang === 'en'`) |
| `relabel` re-renders the line, the choices, the backlog and calls `s.yields.relabel()` | `game.ts:456-466` |
| The game test's fake loader already answers `loadEn` with a spread (`{ ...ch, en: {} }`), so a test through it meets a new object as the real loader gives | `client/src/app/game.test.ts:461-481` (`:477`) |
| **Reconcile reads (main `acc4e0d`; `df0e12c` adds docs only; LFL merged as `cec347c` during this revision, cites marked)** | |
| `GameDeps.api` is a `Pick` of `Endpoints` (GM6c2 widens it); the yields host's `api` is LBI's forwarder object `yieldsApi` (`getPuzzle`, and `postAttempt` counted in `attemptsInFlight`), passed as `api: yieldsApi` | `client/src/app/game.ts:132`, `:1331-1346`, `:1353` |
| `enterChapter`: `chapterChanged()` `:890`, `s.ch = ch` `:891`, `s.assets` / `s.lines` `:892-893`, the first `await` `:899` | `game.ts:888-905` (`cec347c`: `:898-899`) |
| `resumeBody`: the same-chapter test, the paywall branch with `s.yields.restore(EMPTY_WORLD_STATE, null, null)`, the resumed restore | `game.ts:949`, `:951`, `:958-972` (`:970`), `:989` (`cec347c`: `:978`, `:1000`) |
| the yields host: `hints: () => meta?.hintPort() ?? null`, `chapter: () => of().ch`, `apply` | `game.ts:1360`, `:1362`, `:1365-1374` |
| teardown: `endSession` disposes yields then dismisses its own prompt; `exitNow` disposes, then calls `endSession` (two `dispose` calls on an exit) | `game.ts:1457-1481` (`:1465`, `:1469`), `:1495-1522` (`:1508`, `:1518`) (`cec347c`: `:1476`, `:1519`) |
| `onLifecycle`'s `activated` branch (scene resume, `onActivated`, sound, saves) | `game.ts:1966`, `:1984-1993` |
| `setLang`: `ch.en === null` `:2113`, same-id guard `:2115`, `s.ch = r.value` `:2116`, `relabel` `:2121` | `game.ts:2109-2121` (`cec347c`: `:2127`) |
| the line, choice and backlog views and `relabel` | `game.ts:501`, `:506`, `:510`, `:521-528` |
| `imageIds` gives ids for `bg`, `scene`, `show`, `cg`, `props` only; `stage()` ensures those and applies | `game.ts:327-342`, `:711-718` |
| the debug hook's `propRects`; its implementation | `game.ts:412-419` (`:417`), `:1801` |
| `META_KINDS` moved to `api/meta.ts` by LEL, `satisfies Record<ErrorCode, MetaError['kind']>`: a new `ErrorCode` fails `check` until mapped | `client/src/api/meta.ts:206-227` |
| `Endpoints` and `createEndpoints` | `client/src/api/endpoints.ts:47-66`, `:71-100` |
| the budget LIMITs: entry 40,000, first line 270,000, all JS 305,000 B | `client/scripts/budget.ts:106`, `:108`, `:114` |
| the game test's fake `loadEn` spread; `FakeScene`'s `liveBytes` and `debugPropRects` | `game.test.ts:480`, `:341`, `:355` |
| `yields.ts` unchanged since round 10 at the lines this file cites (`YieldsHost` `:85`, its `api` Pick `:89`, `apply` `:105`, `Yields` `:122`, `showToast` `:288`, `dropPuzzle` `:497`, `openPuzzle` `:563`, `ontry` `:687`) | `client/src/app/yields.ts` |
| ch1's `gate`: `"closeup": null`, `onFail` `manor_gate_forced` (shots I-18) | `story/ch1/world.json:43`, `:89` |
| LFL on `cec347c`: `GameMeta.stepShown()` `:176`, called at `:776` (after `present()`'s switch) and `:982` (the D11 branch); boot's never-null `hintPort` forwarder | `game.ts:176`, `:726`, `:776`, `:982`; `client/src/app/boot.ts:302-323` |
