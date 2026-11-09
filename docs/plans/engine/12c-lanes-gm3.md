### GM3c `mech-conditions`
- **Goal:** §4, and the composed decoder of §3.2 (`world.mods`, owned keys routed per place with their source paths
  as `OwnedAt`, module texts through `DecodeCtx.text`, `encode` on emit), so no later module lane edits
  `world/{types,decode}.ts` (R10). **Round 6 (critique_engine_r5 W1; per-player R-E25):** the one walk of world texts
  (§3.2 "Module texts"): `WorldTextLine` and the kernel roles in `worldLines`, the `MECHANIC_TEXTS` registry beside
  `MECHANIC_LINTS` (with `core: null`), `client/scripts/story/mechanics/texts.ts` (the types, `KERNEL_TEXT_ROLES`,
  `TEXTS_LINT` with `world/text-unwalked`), so no later module lane edits `client/scripts/story/world.ts` and every
  module text reaches every text pass. It lands before the first module with texts (GM3, `use`'s `say` / `refuse`) and
  before per-player GM6c1a (which reads `role` / `reach`, R-E25). **Round 7 (critique_engine_r6 m1):** the wiring
  without a cycle: `WorldLintInput.moduleLines` (built in `lintWorld` from the private module walk `moduleTextsOf`,
  which `worldLines` shares, with the private `placePaths(placesOf(w))`), so `TEXTS_LINT` reads no registry and
  `texts.ts` imports `index.ts` and `world.ts` by type only; and `HOTSPOT_MIN_SOURCE_PX` moves from `world.ts:48` to
  `client/src/geom/cover.ts` (behaviour-identical), so GM8i's `devices.ts` imports the hotspot minimum instead of
  copying 150 and no later lane edits `world.ts` for it.
- **After:** GM2b (`world/*`, `decode.test.ts`, `client/scripts/story/world.ts`, `world.test.ts`), GM1d
  (`scripts/story/mechanics/index.ts`). **Beside:** GM3m, GM3w, GM3s (re-checked in round 6: `world.ts`, `texts.ts` and
  `world.test.ts` are in none of their locks).
- **Lock (13; round 4: `client/scripts/story/lint.ts` leaves, its codes are `conditions.ts`'s own; round 6 +3; round 7
  +1: `client/src/geom/cover.ts`, the hotspot minimum's new home; no other open lane holds it: M3c merged, and the
  shot design reads it without a lock, verify at the cut):** new
  `client/src/mechanics/{data,rules}/conditions.ts`, new `client/src/mechanics/conditions.test.ts`, new
  `client/scripts/story/mechanics/conditions.ts`, `client/scripts/story/mechanics/index.ts`,
  `client/src/mechanics/data/index.ts`, `client/src/world/{types,decode}.ts`, `client/src/world/decode.test.ts`;
  round 6: `client/scripts/story/world.ts` (`WorldTextLine`, the walk), new `client/scripts/story/mechanics/texts.ts`,
  `client/scripts/story/world.test.ts` (the walk's tests); round 7: `client/src/geom/cover.ts` (`HOTSPOT_MIN_SOURCE_PX`,
  moved from `world.ts:48`). No `locales.ts`, `story.ts` or `scan-dist.ts` edit: each reads the walk's output as it is
  (`locales.ts:239`, `story.ts:319`, `scan-dist.ts:457`). Beside pairs re-checked in round 7: `cover.ts` is in none of
  GM3m's, GM3w's or GM3s's locks.
  **Ruled since: RULINGS 192** — Q1 option A: the lock gains `client/scripts/story/mechanics/clues.ts` (14) for commit
  (2b) `world: a clue is a condition` (`clues` widened to `Cond[]`; "a clue holds" = its whole condition holds in one
  reached state); Q2: `texts.ts`, `mechanics/index.ts` and `conditions.ts` import nothing from `world.ts`, **not even a
  type**, where round 7 above says "by type" (a type import reaches `node:crypto` in the app program), and the test
  `texts: texts.ts value-imports nothing from mechanics/index.ts or world.ts` checks every file of the directory
  (`client/scripts/story/world.test.ts:1645`).
- **Commits:** (1) `world: an owned key reaches its module and nothing else` (a fixture module through the registry
  parameter; red: unknown key), `world: an unowned key is still refused` (pin); round 6: `world: a module text decodes
  with the kernel's line-ID rule` (a fixture module text without `id`, through `decodeWorldFile`: `id/missing` at the
  text's source line; red: the reason is `shape`, or the path is not the source path); (2) `conditions: every atom and
  combinator decodes with strict keys` (red: module missing), `conditions: reads lists every atom`; (3) `story: a gating
  condition reading another section is refused`, `story: a condition deeper than 4 or with more than 16 atoms is
  refused`; (4) round 6 (W1), the walk: `story: a module text is a world line with its role` (a fixture module `probe`
  through `worldLines`' `texts` parameter: its `say` is a line with role `toast`, its source path and line; red:
  TS2554, then the fixture's ID absent: **M-R6b**), pin `story: the kernel's world lines keep their order and gain their
  roles` (ch1's and ch2's lines equal today's list in ids, paths and order, with R-E9's roles; a red on order means the
  kernel walk moved), `story: a module text's en entry is checked` (`checkLocales` over the walk: no en entry ->
  `loc/missing-en` at the text's source line; with it -> no `loc/orphan-en`; red on the parent: the en entry is
  `loc/orphan-en`, the critique's case), `mechanics: every module declares its texts` (the `MECHANIC_TEXTS` keys equal
  the `MECHANIC_DATA` ids; a deleted entry is a `check` error first, the test is its runtime twin), `story: an
  undeclared module text is refused` (`world/text-unwalked` on a fixture module whose entry is `null` while its data
  holds a `say`; red: no finding; **M-R6c**: the structural walk skips arrays). GM1d's `story: module and type lint
  codes are unique and none is a DSL code` covers `TEXT_CODES` (pin). Round 7 (m1), in the same commit:
  `story: the texts gate reads each module's walked lines` (`lintWorld` over a fixture module whose walker returns its
  `say`: `input.moduleLines` holds that ID and `world/text-unwalked` is silent; with the walker returning `[]`, the
  finding; red: TS2339 `moduleLines`, then the finding missing), `texts: texts.ts value-imports nothing from
  mechanics/index.ts or world.ts` (in `world.test.ts`, a source check that every import of `./index.ts` and
  `../world.ts` in `texts.ts` is `import type`, plus, after `vi.resetModules()`, `await import('./mechanics/texts.ts')`
  first resolving `TEXTS_LINT` with no `ReferenceError` (the critic's load order); red on the mutation `import type { WorldLint }` -> `import { WorldLint }` with a value use), and pin
  `story: the hotspot minimum is one constant` (`world/hotspot-small` on ch1 unchanged with `HOTSPOT_MIN_SOURCE_PX`
  imported from `geom/cover.ts`; a red means the move changed the value; round 8, critique_engine_r7 O1: it also
  asserts `HOTSPOT_MIN_SOURCE_PX === 150` and a boundary pair on the `base()` fixture of `world.test.ts:383-386`,
  `[400, 400, 149, 150]` -> one `world/hotspot-small` and `[400, 400, 150, 150]` -> none, so a mistyped 15, 140 or 151
  is red; `world.ts:556` compares `rw < min || rh < min`).
- **Gates:** check, test, story (world rows and versions unchanged: no world has a module key yet; ch1 / ch2 en checks
  unchanged, since their world lines are the same IDs), build (engine row within its +0.2: the walk is build-only, and
  the moved constant is read only by build code). 13 files, 4 commits.

### GM3m `mech-cue-gate`
- **Goal:** §8.1's types and bus, §8.4's presets and table, §8.5's motion gate and the player, §3.5's `waapi` rule and
  the `rules-lazy` cue-stage entries. Nothing mounted yet (GM3s). Round 3: the bus hold (m5), the 15 `removed` rows
  (m6), `UI_MOTIONS` and `uiMotion` (control defaults, so type lanes never edit `motions.ts`), the `byCause.carry`
  variant (m4), `puzzle:renewed` (R-E14), `LAYER_MOTIONS` in `cues/visible.ts` (m11). Round 4: the control types and
  the optional `controls` fields of `MechanicData` and `PuzzleTypeData` (m2: they land together, so no earlier lane
  declares a control it cannot type); the keys `ui-state:waiting` / `waited` with the player's wait hold (m11),
  `puzzle:demo` (m7), `puzzle:hint-renewing` (per-player R-E20); `waapi`'s third allowed file `ui/toast-motion.ts`
  (per-player R-E18). Round 5: the keys `puzzle:offline` / `puzzle:rate-limited` with the motion target `status`
  (found while resolving W3), and `KEY_SCRIPTS` for the every-key test (m3). Round 6: the key `puzzle:ready` with its
  §8.4 row (critique_engine_r5 W3, per-player R-E26). Round 7 (critique_engine_r6 W1, m4): the keys `puzzle:ladder`,
  `puzzle:hint-failed`, `puzzle:load-failed` with their rows; `CueTarget` with `attempts`, `part`, `tier`, `ladder`,
  `alert`, `notice`; `MotionSpec.with` (and `ready`'s and `renewed`'s `roll` moved into it); `CUE_TARGET_ATTRS` in
  `motions.ts`; the player's wait holds keyed by `panel`. Lock unchanged (12). **Round 9 (critique_engine_r8 W1;
  RULINGS 135 (b)):** `MotionSpec.resolveAt` (and each `with` entry's) with the `'emit'` rows of §8.4;
  `PRESET_SITE` in `presets.ts`; `LAYER_MOTIONS.frameOut` in `cues/visible.ts`; the player's two phases
  (`capture(e)` -> `CuePlan`, `run(plan)`), its deps `resolve` / `boxOf` / `ghost(box, of)`, and the leave watch (one
  `MutationObserver`, §8.1 "When a cue's DOM target is found", point 5); every existing player test calls
  `run(capture(e))`. Lock unchanged (12): all of it sits in `cues/visible.ts` and `cues/stage/{motions,presets,player}.ts`
  with their two test files. **Round 10 (critique_engine_r9 W1, W2, m1, m2; the critic's `hotspot` question):** the
  player's `Resolved` (an element, a designed box, or null) and its `animate` dep's `fill` argument; `fallbacks()`
  counting a first motion with no target (§8.1 point 10, the class guard); the hit-area rule (an element-site motion
  on or inside a `[data-cue-hit]` plays on `ghost(box, el)` with `cue-hit`); `MotionSpec.holdEnd` on the end rows'
  element-site motions (`fill: 'forwards'`, skipped by the leave watch, m2); `LAYER_MOTIONS.frameOut.reduced.ms` = 480
  (m1). Lock unchanged (12): the same four source files and two test files. **Round 11 (critique_engine_r10 W1, m2,
  m3; the critic's question):** `MotionSpec.until` with `CHECKING_ENDS` on `puzzle:checking` (the loop, §8.1 point
  11); the player's `{ box }` rule (an element-site motion on a plain box ghost, skipped at `edge`, a cue whose every
  motion was skipped counted); `holdEnd` as a fill rule whose motion moves to a ghost if its element leaves
  mid-motion (m3); `CueTarget` `'inventory'` with its `CUE_TARGET_ATTRS` entry and the two document rows. Lock
  unchanged (12). **Round 12 (critique_engine_r11 m3):** `until`'s one rule: at a settling key's run the player
  `cancel()`s the loop in the step that starts the key's first motion (no `updateTiming`, no residual cycle, no
  deferred key motion). Lock unchanged (12).
- **After:** GM1c (`arch.test.ts`, `puzzles/rules/index.ts`; round 3 m1) and GM1b (`FactKind`, `ModuleCueKey`,
  `CauseVerb`, `mechanics/contract.ts`). **Beside:** GM1d, GM2b, GM3c, GM3w (disjoint: none of them holds
  `mechanics/contract.ts` or `puzzles/rules/index.ts`).
- **Lock (12; round 4 +2):** new `client/src/cues/{types,bus,visible}.ts`, new `client/src/cues/bus.test.ts` (round 3),
  new `client/src/cues/stage/{motions,presets,player}.ts`, new `client/src/cues/stage/{motions,player}.test.ts`;
  `client/src/arch.test.ts` (`rules-lazy` += `cues/stage/**` and `cues/root.ts`; rule `waapi`; `isPureWorld` +=
  `cues/{types,bus,visible}.ts`); `client/src/mechanics/contract.ts` (round 4: `MechanicData.controls?`, a type-only
  import); `client/src/puzzles/rules/index.ts` (round 4: `PuzzleTypeData.controls?`; `code` / `order` declare none).
- **Commits:** (1) `cues: every cue key has a visible motion` (red: module missing; then M-I5a red, including the
  round-3 `UI_MOTIONS.gesture` mutation; prints the scene pending count); (2) `cues: the player animates every key`
  (M-I5b red; round 5 m3: through `KEY_SCRIPTS` for `ui-state:waiting` / `waited`, seen red on the script mutation of
  §8.5, so the test and commit (6)'s short-pair rule hold together), `cues: reduced motion keeps every key visible`; (3) `cues: every world field is a fact kind or silent`
  (M-I5d); (4) round 3: `bus: a cue emitted before the overlay subscribes plays once, in order, at subscribe` (red:
  TS2305 `createCueBus`, then **M-I5k**), `bus: a hold past CUE_HOLD_MAX counts the dropped cues as orphans`;
  (5) `arch: waapi red on fixture` (red: the Ribbon fixture's `.animate(` is not reported; a TS error means the `RuleId`
  tuple was not extended), `arch: rules-lazy red on the cue-stage fixture` and on the `cues/root.ts` fixture; round 4:
  the three allow fixtures (`cues/stage/player.ts`, `ui/value-motion.ts`, `ui/toast-motion.ts`) pass; (6) round 4:
  `cues: a waiting hold shows only past its delay and ends at waited` (fake clock; red: TS2305 on the hold API, then
  **M-R4a**), `cues: every cue key has a visible motion` covers `waiting`, `waited`, `demo`, `hint-renewing`, (round
  5) `offline`, `rate-limited`, (round 6) `ready` and (round 7) `ladder`, `hint-failed`, `load-failed` (red until their
  entries exist: `tsc` through the mapped type) and checks every `with` motion as its own spec (round 7; mutation: a
  `with` preset of equal keyframes -> red), and `cues: a declared control resolves its motion` over a
  fixture `controls` entry on a fixture type (the field now exists; red: TS2339 `controls` before the interface hunk);
  round 7: `cues: two waiting holds end at their own waited` (a room hold and a `hints` hold on the fake clock; red:
  TS2339 on the per-panel API, then **M-R7d**, the holds in one slot), `cues: a with motion whose target is missing is
  skipped and the first motion plays` (red: nothing plays, or the stage-centre fallback plays the `with` preset);
  round 9 (W1), in commit (2): `player: an emit motion is caught at capture and a flush motion is found at run` (red:
  TS2339 `capture` on the round-8 player; then **M-R9a** and **M-R9b** on the phases: an `'emit'` target removed
  between the phases plays at the stage centre, a `'flush'` target added between them is not found) and `player: an
  emit motion whose element leaves continues on its ghost from the same time` (red: the motion stops on the detached
  element; **M-R9h**; the observer is disconnected after `finish`); in commit (1): `cues: a frame's end motion ends
  before its frame leaves` (red: TS2339 `frameOut` on `LAYER_MOTIONS`, then **M-R9d**, `puzzle:failed`'s `ms` 600),
  and `cues: every cue key has a visible motion` checks `frameOut` and its reduced form as it checks `in` / `out`
  (mutation: `frameOut`'s two keyframes equal -> red); `PRESET_SITE` is a mapped type over `PresetId`, so a preset
  without a site is a `check` error (seen as TS2741 on a fixture preset added without one). **Round 10** in commit (1):
  `cues: a frame's end motion ends before its frame leaves` gains the `holdEnd` clause (**M-R10e**: `holdEnd` dropped
  from `puzzle:solved`; `holdEnd` added to `puzzle:wrong`: both red) and its reduced clause is seen red on **M-R10h**
  (`frameOut.reduced.ms` back to 200); on the unmutated defaults it is green, so the predicted red stays TS2339
  `frameOut`, then M-R9d (critique_engine_r9 m1: true now that the reduced outro is 480); in commit (2): `player: a
  first motion with no target counts one fallback` (red: TS2339 `fallbacks`, then **M-R10g**), `player: an element
  motion on a hit area plays on its painted ghost` (red: the animation recorded on the transparent fixture button;
  **M-R10f**), `player: an end motion holds its last frame and is never ghosted` (red: `fill: 'none'` recorded, then a
  ghost after the fixture wrapper's removal; round 11: renamed `player: an end motion holds its last frame, and moves
  to a ghost only if its element leaves mid-motion`, red on **M-R11h**); every existing player test's fake `animate`
  takes the `fill` argument. **Round 11** in commit (2): `cues: puzzle checking breathes until its frame settles`
  (red: TS2339 `until`, then **M-R11e**; round 12, m3: its settling clause reads "running after the key's run, or the
  key's motion later than that run", red on **M-R12d** and **M-R12e**); `player: a first motion with no target counts one fallback` gains the
  played-nothing case (a fixture cue whose only motion is element-site on a `ribbon` target that landed at `edge`;
  red: 0 counted); in commit (1): the two document rows on target `inventory` are rows of the table `cues: every cue
  key has a visible motion` checks (no separate red: `motions.ts` is new in this lane).
  **Reconcile r1 (design-shots I-7, adopted with a change):** `cues/types.ts` exports `FRAME_OPEN_MS = 300` (the
  frame's entrance, `LAYER_MOTIONS.in`'s `ms`, §8.2, which is defined from it, one source), so SH7 sets the scene
  covered only once an opaque frame's entrance has ended (`setCovered(true)` `FRAME_OPEN_MS` after the frame shows)
  and uncovered when its clear starts `frameOut`: the room keeps its ambient motion while the frame is still
  translucent, never a frozen room behind a fading frame. Test `motions: the puzzle frame's entrance lasts
  FRAME_OPEN_MS` (`LAYER_MOTIONS.in.ms === FRAME_OPEN_MS` and its reduced `ms` is no longer), **M-RCl** (`in.ms`
  set to 360 in `cues/visible.ts`: red). The constant is engine-side (`cues/types.ts` is in the engine closure, as
  `MIN_VISIBLE_MS` is), ~1 line, under the rounding (§3.5).
- **Gates:** check, test, build (no row moves: nothing imports `cues/**` before GM3s, whose build MEASURES GM3m's
  engine line together with its own, 0.16 + 0.15 = 0.31, and so checks §3.5's round-7 tuple claim; the cue-stage
  estimate is 2.75 in round 7; round 9: GM3m's share of the +0.08 is the two-phase player, `resolveAt`, `PRESET_SITE`
  and the leave watch, measured with GM3s's; round 10: GM3m's share of the +0.07 is ~9 lines, the counter, the fill,
  the hit rule, `Resolved` and the three `holdEnd` entries, measured with GM3s's; round 11: GM3m's share of the +0.06
  is ~8 lines, the loop, the `{ box }` rule and its count, the `inventory` target and rows, measured with GM3s's).

### GM3w `mech-ui-wiring` (new, behaviour-identical)
- **Goal:** one-time wiring so later lanes never edit `app/game.ts` or `ui/App.svelte` for explore / puzzle UI:
  `forwardLayer(get)` in `ui/explore-view.svelte.ts` and `forwardHost(get)` in `ui/puzzle-view.svelte.ts` (each an
  explicit object literal over its action type, next to the type, so a lane adding an action edits that file only);
  `game.ts:1898-1915` becomes `exploreActions: forwardLayer(() => session?.yields.layer)`, `puzzleActions:
  forwardHost(() => session?.yields.host)`; the layer's props become `{ lang, view: ExploreViewStore, actions }`
  (App passes `view={ui.explore}`, so new view fields need no App edit); `coversStage(frame)` (today `frame !== null`)
  replaces `App.svelte:65`'s literal **and** guards the frame layer's `{#if}` (`:103`; round 3 W1). Round 3 also: the
  layer's props gain `puzzle: PuzzleView` and `puzzleActions: PuzzleHostCallbacks` (App passes `puzzle={ui.puzzle}`,
  `puzzleActions={game.puzzleActions}`; unread until GM8h renders a device in the room), and two CSS rules: App's frame
  wrapper `pointer-events: none`, PuzzleHost's `.frame` and App's `.host-failed` `pointer-events: auto`
  (behaviour-identical: both are full-bleed, so every tap they took before they still take). After GM3w no lane of
  this design edits `App.svelte` beyond GM3s's mount. Round 4 (m11): yields' `apply` dep gains an optional third
  parameter `started?: () => void`, which game.ts calls after `stage()`'s loads end and before audio
  (`game.ts:1281-1290` around `:1284`), so GM3s can emit a move's cue with its crossfade; unused here, so
  behaviour-identical. **Round 8 (critique_engine_r7 W1):** `PuzzleFrameView.retrying` with its doc and `busy`'s
  rewritten doc (§8.1 "The frame's flags and its ends"), `retrying: false` in `openPuzzle`'s frame literal
  (`yields.ts:593-609`) and in the component test's `frameOf` (`puzzle-host.svelte.test.ts:51-70`), and
  `disabled={frame.retrying}` on PuzzleHost's load-failed Retry (`PuzzleHost.svelte:73`) and App's `.host-failed` Retry
  (`App.svelte:111`); nothing sets it yet, so both stay enabled (behaviour-identical), and App gets its one binding
  here, so no later lane edits App for Retry (GM3s keeps only the markers). **Round 12 (critique_engine_r11 m5):**
  `Yields.ahead(y: YieldCommand): void` (the type `onYield` takes, `yields.ts:124`) with its doc ("a yield step's
  pictures are loaded and its transition starts") and a
  no-op body in `createYields`' returned object, and `present`'s call `s.yields.ahead(step.yield)` in its `yield` case
  (`game.ts:695-697`, after `stage()` and the audio, before `await shown.done` at `:716`), so GM3s fills the body and
  no later lane edits `game.ts` for it; behaviour-identical (the body does nothing).
- **After:** GM2a on the `game.ts` and `yields.ts` chains; on `game.ts` before the adopted animation / shot lanes that
  hold it (§12 "Animation and shot lanes"; RULINGS 132), or after them; never beside. Reconcile r1 (design-shots I-2):
  **before SH1's cut** (the "or after them" branch is closed: SH1 follows GM2a and GM3w on `game.ts`). **Beside:** GM1d, GM2b, GM3c,
  GM3m.
- **Lock (10; round 4 +1; round 8 +1):** `client/src/app/game.ts` (two hunks: the forwarders, `apply`'s `started`),
  `client/src/app/yields.ts` (round 4: the `apply` dep's type only; round 8: `retrying: false` in the frame literal),
  `client/src/ui/App.svelte` (round 8: also the `.host-failed` Retry's `disabled={frame.retrying}`),
  `client/src/ui/explore-view.svelte.ts`, `client/src/ui/puzzle-view.svelte.ts` (round 8: `retrying`, both docs),
  `client/src/ui/explore/ExploreView.svelte`
  (props), `client/src/ui/explore/explore.svelte.test.ts`, `client/src/app/game.test.ts` (re-located at the cut),
  `client/src/ui/puzzles/PuzzleHost.svelte` (one CSS rule; round 3; round 8: Retry's `disabled={frame.retrying}`),
  `client/src/ui/puzzles/puzzle-host.svelte.test.ts` (round 8: `frameOf` gains `retrying: false`, the one other
  `PuzzleFrameView` literal, so `check` stays green).
- **Commits:** (1) `explore-view: forwardLayer reaches the current session's layer and nothing after it ends` (red:
  TS2305 `forwardLayer`); (2) the same for `forwardHost` and `puzzle-view: coversStage is true for every frame today`;
  (3) the App / ExploreView props change and the two CSS rules; every existing component test and e2e unchanged (the
  pins: the e2e taps every overlay frame's controls as before); round 8: in the same commit the `retrying` field, its
  two literals and the two `disabled` bindings (a behaviour-identical change; `check` proves it whole, since a frame
  literal without the field is TS2741, and `puzzle host: unmount on end`, whose load-failure step taps Retry once,
  `puzzle-host.svelte.test.ts:139`, `:164-172`, stays green with Retry enabled); (4) round 4: `game: apply reports the batch start after
  its loads` (a fake scene whose `ensure` resolves late: `started` runs after it and before `done`; red: TS2554, two
  arguments expected); round 5 (m9): `game: apply reports the batch start for an empty command list` (`started` runs
  once with `[]`; red: never called, which would strand GM3s's held cues); (5) round 12 (m5): `game: a yield step
  tells yields ahead of its transition` (a fake scene whose `apply`'s `done` resolves late and a recording yields:
  `ahead` after `ensure`, before `onYield`; none for a line or a choice step; red: TS2339 `ahead`, then **M-R12h**, the
  call removed). Lock unchanged (10): `game.ts`, `yields.ts` and `game.test.ts` are held already; 5 commits.
  **Reconcile r1 (design-shots I-6's question back: "does the explore view take hotspot taps while a room batch
  runs?"):** no. Every view intent goes through `h.tap` (`yields.ts:113-114`), and GameSession's `tap` completes the
  batch in flight and returns without running the intent (D7, `game.ts:1402-1408` on `acc4e0d`, `:1413-1419` on
  `cec347c`), so SH10 may push the camera into `via` during a zoom batch with no hotspot mapping; a hotspot is tappable
  again only after the batch ends, at the rest mapping. No app test pins this today (Grep of test names in
  `client/src/app/*.test.ts`: no "complete" / "during a batch" case, CLAIM by name), so commit (5) gains the pin `game:
  a tap during a batch completes it and runs no intent` (a fake scene whose `apply` holds its batch: `complete()`
  called once, the intent's `fn` never called, the tap's promise the batch's; green on the parent: a pin, seen red on
  **M-RCk**, `tap` running `fn` after the batch instead, `busy.then(() => run(fn))`). Lock unchanged (10); 5 commits.
- **Gates:** check, test, build (entry and engine rows within 0.05 KB; reconcile r2, RC-m6: the entry row's delta
  booked +0.01, bound **+0.04** KB br, a STOP item above it, since the entry ledger's margin to L1 / L2's line is
  0.038 and GM3w alone may not cross it, §11.1 Ledger 2; the engine row stays within 0.05), e2e full
  (behaviour-identical).
  **Ruled since: RULINGS 182** — the entry bound +0.04 is superseded: L1 has merged (RULINGS 159), and on `9b4fd25` the
  entry projection is 37.929 / 40.0, 1.571 above the 0.5 KB line ([§11.1](11-budgets-and-validation.md#111-the-shared-ledgers-reconcile-r1-r2-rulings-143-qo10-152-r4-153-155-design-shots-i-13)), so the entry STOPs only by
  Ledger 2's crossing rule, §3.5's STOP rule or the 40.0 LIMIT, and is quoted; the engine row within 0.05 KB stays
  GM3w's own gate, a STOP item unless the tester shows the excess is chunk-hash churn.
  Changed by RULINGS 186 (as of `837b1ed`; docs lane `docs-errata-12`, group A): as merged (`508bd36`), **6 commits**
  against the plan's 5: commits (1)-(5) as planned (`e1082cd`, `a58066a`, `632c220`, `bf7f4d4`, `1d43552`) and (6)
  `25cc64a`, the spec's LBI review M1 carry as its own comment-only commit (cut Q8). Cut D2: `ExploreLayerActions`
  moved from `yields.ts:120-121` to `client/src/ui/explore-view.svelte.ts:58`, an explicit object type next to
  `forwardLayer` (`:72`), which `yields.ts` and `game.ts` import by type (a type-only `yields.ts` hunk, 0 bytes). Cut
  D4: the frame wrapper is `<div class="layer frame-layer" inert={covered}>` (`client/src/ui/App.svelte:95`) with the
  rule `.frame-layer { pointer-events: none; }` (`:292-294`), the tap rule of §8.3 ("The frame wrapper passes taps").
  The engine row passed its 0.05 KB gate by the churn escape: +15.8 B on the mean of 4 builds per tree (one build +80)
  ([§11.1](11-budgets-and-validation.md#111-the-shared-ledgers-reconcile-r1-r2-rulings-143-qo10-152-r4-153-155-design-shots-i-13)).

### GM3s `mech-cue-stage` (new)
- **Goal:** §8.1's one stage-level layer and its loading, §8.3's `cueRoot` on the explore root, the outros, today's
  effects mapped to cues in yields (`look` -> `module:core:look`, `got` -> `fact:held|doc:added`, `refused` ->
  `module:core:refused`, `room` -> `move`, `leave` -> `move:leave`, `story` -> `fact:story:added`, `lock` ->
  `ui-state:panel-open`, `reset` -> `module:core:reset`), the orphan gate, the new budget family. Round 4 (m11): a
  `room` effect's `move:*` event is built at the effect and emitted from the room batch's `started`, with
  `ui-state:waiting` / `waited` around the loads; and the entry row MEASURED before / after settles where Svelte's
  transition runtime lands (§3.5; a STOP item past +0.55 KB br). Round 5 (m9): every cue of a dispatch that pushed a
  `room` effect is held with the move event and emitted at `started` after it (§8.1). Round 7 (critique_engine_r6 m4,
  W1): CueStage's `resolve` implements §8.5 "Cue targets" over `CUE_TARGET_ATTRS` (the six new targets, a `ui` cue
  with `el: null` found by `[data-cue="<control>"]`, a box-less `ui-state` cue found by its panel); App's `.host-failed`
  block gains `data-cue-notice` and `data-cue-panel="puzzle"`, its Retry `data-cue="puzzle-retry"` (round 8: its
  `disabled={frame.retrying}` is GM3w's, critique_engine_r7 W1; App is this lane's file; the cue for that Retry is
  emitted by GM3p's `onretry`, since App, the entry, has no cue root). **Round 9 (critique_engine_r8 W1, m3; RULINGS
  135 (b), the rule this lane owns):** CueStage's subscriber calls the player's `capture(e)` inside the bus emit, awaits
  one `tick()` and calls `run(plan)` (no timer; a plan pending at unmount is dropped and counted); `resolve` skips every
  candidate inside `[data-cue-root][inert]`; a box-less wait hold resolves its panel's `[data-cue-notice]` first (§8.5
  `box` row); `ghost(box, of)` clones `of` (ids and `data-cue*` attributes stripped, `inert`, `pointer-events: none`)
  at the box, or draws the round-3 plain ghost when `of` is null; `layerOut`'s `frame` option (`cues/root.ts`) plays
  `LAYER_MOTIONS.frameOut`; the three `.sheet` wrappers of `ExploreView.svelte` (`:68`, `:73`, `:78`) gain
  `data-cue-panel="inventory|document|lock"` here (round 7 gave them to GM3u; they move because this lane's real-flush
  test needs them and this lane already holds the file). **If §3.5's transition-runtime fallback is taken** (the STOP
  item above), no root outros and no `inert` is set, so the skip has nothing to skip and the end motions continue on
  the wrapper's clone (round 11, critique_engine_r10 m3: `holdEnd` motions too, since a `holdEnd` motion whose element
  leaves mid-motion moves to a ghost, onto the wrapper's clone inside the root's ghost, §8.5 `MotionSpec.holdEnd`); the
  STOP item then carries RULINGS 135 (b)'s nesting (the root's ghost holds the wrapper's
  clone) to the orchestrator with it. **Round 10 (critique_engine_r9 W2; the class guard):** `resolve` returns
  `Resolved`; `edge` is `{ box }` from the stage layer's rect (56 x 56 CSS px centred on its bottom edge, CLAIM); a
  `ribbon` target with no live `[data-cue-ribbon]` (none, or only inside an outroing root) resolves to `{ box: edge }`
  (§8.1 point 9), a live ribbon without the slot to null (counted); CueStage writes `data-cue-fallbacks` (the player's
  `fallbacks()`) beside `data-cue-orphans` under `__TG_MOCK__` and styles `.cue-ghost.cue-hit` (the hit outline,
  §8.5 "Hit areas"). Lock unchanged (14). **Round 11 (critique_engine_r10 W1, O1; found):** `resolve`'s `centre`
  landing for a box-less `null` hold and a notice-less `puzzle` hold; the `inventory` landing
  (`[data-cue="bar-inventory"]`, else `edge`); a `box` target's DOM branch that finds nothing counted (O1); the
  explore-import hold in `openSection` (§8.1 point 11); `prefetch()` taken from `lineShown`'s body and run also at
  `restore` onto a yield and after a section's first room (§8.1 "Loading"); `data-cues-played`'s panel suffix (§8.6).
  Lock unchanged (14). **Round 12 (critique_engine_r11 W1, m5; RULINGS 135):** `held(visual, audio, at)`, the one
  batch site (§8.1 "The frame's flags and its ends", point 11): round 4's room-batch hold becomes its body, and every
  `h.apply` of `yields.ts` on its parent (`:387` the room batch with its `via` box and `atStart` = the move event and
  the held cues, `:416` `takeBatch`, `:588` / `:530` / `:553` the close-up in and out with `box: null`) becomes a
  `held` call, so round 11's close-up hold is this lane's by construction (GM3p adds none); the pin `yields: every
  batch goes through held`; `ahead`'s body `prefetch()` (§8.1 "Loading"). Lock unchanged (14). **Round 13
  (critique_engine_r12 m1; RULINGS 148):** `held`'s `at` is `HeldAt | 'no-load'`; `'no-load'` applies the batch with
  neither emission (an expression inside the two emission lines); `yields: a batch that waits on a load emits waiting,
  then waited` gains a `'no-load'` case (no key recorded; red-first TS2345 before the branch exists). The stage
  loader's `import()` this lane adds becomes a view row of GM3p's request walk (waits `explore-import`,
  `frame-chunks`), written at GM3p's cut. Lock unchanged (14). **Round 14 (critique_engine_r13 m3, W1):** `held`
  honours `'no-load'` only while `h.scene.stats().reviving` is false and otherwise holds at `centre`; `YieldsHost.scene`
  becomes `Pick<SceneController, 'preload' | 'releasePreload' | 'snapshot' | 'stats'>` (`yields.ts:90`; game.ts passes
  the whole controller, `game.ts:1354`, and `yields.test.ts`, the only other `YieldsHost` builder, gains `stats` on its
  fake scene); the same test gains the case "`'no-load'` during a revive" (red-first: TS2353 on the fixture scene's
  `stats` until the `Pick` gains it, then the assertion, no pair while reviving, until the clause lands; then
  **M-R14j**).
  The pin `yields: every batch goes through held` is this lane's interim guard; GM3p's walk replaces it. Lock unchanged
  (14). **Reconcile r1 (RULINGS 152 Q14 (a); design-shots I-4):** the predicate becomes `h.scene.stats().stale === 0
  && !h.scene.stats().reviving` (§6.4); the case "`'no-load'` during a revive" gains the fixture states `{ reviving:
  false, stale: 1 }` (the pair recorded) and `{ reviving: false, stale: 0 }` (none), red on round 14's predicate
  (**M-RCa**); `YieldsHost` gains `sceneCues?: (subscribe: CueBus['subscribe']) => void`, called once by
  `createYields` right after the bus exists (§8.6), test `yields: the scene role gets the session's cue subscription
  once` in commit (2) (red on the parent: TS2353, `sceneCues` is not a known property of the fixture host; then
  **M-RCr**, **M-RCs**). Both in files already held (`yields.ts`, `yields.test.ts`): lock unchanged (14). Engine
  +0.19 (§3.5).
- **After:** GM3m, GM3w (and through it GM2a, the `yields.ts` predecessor); `budget.ts` after the adopted animation /
  shot lanes that hold it if one launches first (rev. 3's MD1b; never beside). **Beside:** GM3c. **Reconcile r1:** on
  `budget.ts` / `budget.test.ts` after LFL (merged) and **by launch with SH3a, never beside** (whichever starts first
  holds them; SH3b follows both, §12 "Order and conflicts"); its build is the first to measure Svelte's transition
  runtime in the entry, so its cut quotes the entry ledger (§11.1) and STOPs past L1 / L2's line (§15 item 15).
- **Lock (14):** new `client/src/cues/stage/{index.ts,CueStage.svelte}`, new `client/src/cues/root.ts` (round 3 m11:
  `cueRoot` with `data-cue-root` and the innermost-root check, `layerIn` / `layerOut`), new
  `client/src/cues/stage/stage.svelte.test.ts`; `client/src/ui/state.svelte.ts` (`cueStage` slot and the slot types),
  `client/src/ui/App.svelte` (the mount), `client/src/ui/explore/ExploreView.svelte` (`use:cueRoot`, `in:` / `out:`), `client/src/ui/explore-view.svelte.ts`
  (`oncue` action), `client/src/app/yields.ts`, `client/src/app/yields.test.ts`, `client/scripts/budget.ts` (family row,
  `cueStageChunkBr`, LAZY_DIRS), `client/scripts/budget.test.ts`, `client/src/arch.test.ts` (`LAZY_COMPONENTS`
  `:892-901` += `CueStage.svelte`; lazy dirs), new `client/e2e/mechanics.spec.ts`.
  **Ruled since: RULINGS 194, 195** — the lock is 18: it gains core's four cue names (`look`, `locked`, `refused`,
  `reset`) in `client/src/mechanics/rules/index.ts`, their pin in `client/src/mechanics/registry.test.ts`, the four
  `module:core:*` rows in `client/src/cues/stage/motions.ts` (GM3m's cut Q1) and the one `VALUE_IMPORTS` line in
  `client/src/ui/explore/explore.svelte.test.ts` (`ExploreView.svelte`'s value import of `cues/root.ts`); §3.5's
  transition-runtime rule is applied as P0 first (the entry row's mean of 4 builds), then the directives (entry delta
  within +0.55 KB br and Ledger 3 within 305.0) or the named fallback at once, without a second stop.
- **Commits:** (1) `budget: the cue-stage family is measured and refused over its limit` (red: PENDING never turns
  measured; seen failing on a fixture over 6.0); (2) `yields: today's effects reach the cue bus` (red: the bus records
  nothing), `yields: the cue stage loads before a section or a puzzle opens`; round 4: `yields: a move cue plays when
  its batch starts` (a fake `apply` that calls `started` late: the `move:*` event is recorded after it, with the box
  of the old room's `via`; red: emitted at the effect), `yields: a batch that waits on a load emits waiting, then
  waited` (red: neither key); round 5 (m9): `yields: a moving dispatch's cues play after its move cue` (an exit into a
  fixture room whose `onEnter` gives an item: the bus records `waited`, `move:walk`, then the gift's
  `fact:held:added`, all after the fake `apply`'s late `started`; red: `fact:held:added` before `started`; **M-R5c**);
  (3) `cues: a control removed in the same
  frame plays on a ghost`, `stage: an unmounted stage plays nothing and counts orphans`, round 3: `cues: a control
  inside two nested roots emits once` (red: two cues before the check; **M-I5j**), `stage: the held entry cues of the
  first section play after the stage mounts` (the m5 path end to end in a component test); round 7: `stage: each
  target resolves by its attribute` (a fixture DOM per §8.5 "Cue targets" row, a null-`el` control and a box-less
  `hints` cue included; red: TS2305 on `CUE_TARGET_ATTRS`' resolver, then a row resolving null), `stage: App's
  host-failed notice and Retry carry their cue markers` (a `svelte/compiler` parse of `ui/App.svelte`, the style of
  `controls.test.ts`: the `.host-failed` section has `data-cue-notice` and `data-cue-panel="puzzle"`, its button
  `data-cue="puzzle-retry"` and, round 8, GM3w's `disabled={frame.retrying}` (a pin); red: the three markers); round 9
  (W1, m3) in commit (3): `stage: no target is found inside an outroing root` (fixture DOM; red before the skip's
  hunk: the outroing candidate, first in document order, is returned; **M-R9g**), `stage: a wait hold over a
  panel with a notice plays on the notice` (red: the panel; **M-R9e**), `stage: a panel the write opens slides in after
  its flush and a panel it closes slides out on its ghost` (the real ExploreView and CueStage, a real flush, the
  recording `animate` of §8.5; red on the parent: no `data-cue-panel` on the sheets, the slide plays at the stage
  centre; then **M-R9a** and **M-R9b**), `cues: a control removed in the same frame plays on a ghost` gains its
  microtask case (**M-R9h**), and `stage: an unmounted stage plays nothing and counts orphans` gains a plan pending at
  unmount; every resolve test asserts no resolved target matches `[data-cue-root]` (**M-R9c** is red in GM3p's, the
  first lane with a frame wrapper); round 10 (W2) in commit (3): `stage: a ribbon target with no live ribbon lands at
  the edge` (fixture DOM; red: TS2322 on round 9's `Element | null` resolver, then **M-R10c**), and the five round-9
  real-flush tests' `fallbacks() === 0` assertion lands with the stage that exposes it (GM3s's own here, the others in
  GM3u / GM3p); (4) e2e `mechanics: a take
  plays its cue`, `mechanics: an event knot's start plays its cue and the room layer leaves with motion`, `mechanics: a
  section leave plays move:leave`, `mechanics: no cue is orphaned across the demo walk` (M-I5i seen red; round 10: it
  also asserts `data-cue-fallbacks` 0 at the walk's end, seen red on **M-R10c**: before GM3u no ribbon exists, so each
  take's `fly` lands at `edge` by the rule and falls back without it). **Round 11:** in (2) `yields: a section's first
  entry holds a motion while its chunk loads` (red on the parent: no `waiting` before the import settles; **M-R11g**)
  and `yields: a resume onto a yield prefetches its chunks` (red on the parent: `restore` calls no loader; **M-R11k**);
  in (3) `stage: a box-less hold lands at centre and a missing panel counts` (red: TS2339 on the landing's box
  helper, then **M-R11j**), and the round-10 stage test is renamed `stage: a ribbon or inventory target with no live
  control lands at the edge`, with the element skip (**M-R11i**) and the `inventory` rows (**M-R11l**). **Round 12**
  in (2): `yields: every batch goes through held` (a source count; red on the parent: five `h.apply(` sites; then
  **M-R12a**), `yields: a batch that waits on a load emits waiting, then waited` gains the close-up in and out and the
  take batch as cases (each through a fixture `apply` whose `started` comes late; red on the parent: no key around
  the close-up; **M-R11f** re-pointed: the close-up's apply past `held`), and `yields: a yield step prefetches its
  chunks ahead of its transition` (red on the parent: GM3w's no-op calls no loader).
- **Gates:** check, test, build (cue-stage row MEASURED vs 3.15 = GM3m 2.75 + GM3s 0.32 + round 9's 0.08, round 9;
  engine vs GM3m's +0.16 plus this lane's +0.15, the first build that imports `cues/**` from yields; explore-ui vs
  +0.21, round 9's `frameOut` included; entry vs +0.05), e2e full. Lock unchanged (14): every round-9 file
  (`CueStage.svelte`, `cues/root.ts`, `stage.svelte.test.ts`, `ExploreView.svelte`) is already in it. Round 10: the
  cue-stage row is checked against 3.22 (round 9's 3.15 + 0.07, GM3m's and this lane's round-10 lines together).
  Round 11: against 3.28 (+0.06), and the engine against GM3m's +0.16 plus this lane's +0.17 (0.33). Round 12: the
  engine against GM3m's +0.16 plus this lane's +0.18 (0.34); the cue-stage row unchanged (3.28).

### GM3 `mech-use`
- **Goal:** §6.1 rules; writer fact cues and module cues as `cue` effects; kernel effect fields (`from`, `via`, `how`,
  `at`, `item`); yields forwards `cue` effects to the bus and drops GM3m's effect-to-cue mappings that the writer now
  emits (no cue twice).
- **After:** GM3c, GM3s.
- **Lock (16; one over the soft bound: splitting the writer's cue emission from its first consumer would leave a lane
  whose new cues reach no rule):** new `client/src/mechanics/{data,rules}/use.ts`, new `client/src/mechanics/use.test.ts`,
  new `client/scripts/story/mechanics/use.ts`; `client/src/mechanics/{data,rules}/index.ts`,
  `client/scripts/story/mechanics/index.ts`, `client/src/mechanics/rules/{core,writer}.ts`; `client/src/explore/reduce.ts`
  (types); `client/src/cues/stage/motions.ts`; `client/scripts/story/playthrough.ts`; `client/src/explore/explore.test.ts`;
  `client/src/explore/controller.test.ts` (m1: the new `room` / `refused` fields break the `toEqual` at `:365`, `:377`,
  `:805`); `client/src/app/{yields,yields.test}.ts`.
- **Commits:** (1) `use: ...` (§6.1, four tests; red: unknown key `uses` until the module is registered); round 6
  (W1): `USE_TEXTS` and its `MECHANIC_TEXTS` line (both in files of this lock: `scripts/story/mechanics/{use,index}.ts`),
  test `use: its say and refuse texts are world lines of role toast` (in `client/src/mechanics/use.test.ts`, which, as
  every test file, sits outside the arch scan, `arch.test.ts:838`; red: TS2305 `USE_TEXTS`, then `world/text-unwalked`
  with the entry `null`); (2) `writer: every fact write emits a fact cue with its cause`; (3) `yields: a take emits exactly one held cue`
  (red: two, one from the writer and one from GM3s's mapping); (4) `playthrough: every step yields at least one cue`
  (red: a look on an examined hotspot yields none before the module cue); the new keys enter `CUE_MOTIONS` (the gate
  forces it); (5) round 5 (m9) pin: `yields: an arrival's fact cues play with its move at the batch start` (the
  writer's `fact:visited:added`, written before the `room` push at `reduce.ts:321-322`, and the `enter:<room>` cues
  reach the bus after `started`; red if the writer's `cue` effects bypass GM3s's hold, **M-R5c**).
- **Gates:** check, test, story (ch1 / ch2 states unchanged), build.

### GM3u `mech-ribbon`
- **Goal:** §6.1 UI, §8.3 for `ui/explore/**`: ribbon, selection, use dispatch, bare-art catcher, `data-cue` on
  every explore control, the control gate, the screens-diff `ui-state` cues, locale table. Round 7 (critique_engine_r6
  m4): the explore targets of §8.5 "Cue targets": `data-cue-panel` on the inventory, document and lock sheets and
  `data-cue-item` on each ribbon slot, with their resolve test. **Round 9 (critique_engine_r8 W1, m1; found (b)):** the
  sheets' `data-cue-panel` markers move to GM3s (its real-flush test needs them); the screens diff speaks for
  `inventory`, `document`, `lock` and `hints` only (no `puzzle` kind: a frame's open and close cues are yields', m1,
  m4), and this lane removes GM3s's `lock` -> `ui-state:panel-open` mapping in the commit that lands the diff (the
  diff speaks for the `lock` screen pushed in the same dispatch, `yields.ts:299-301`), as GM3 removes the
  writer-emitted mappings; the Ribbon keys its slots by item id (a keyed `{#each}`, the style of
  `ExploreView.svelte:43`, so a removed slot's node is never reused for a neighbour); the take and use real-flush tests (§8.5).
  **Round 10 (critique_engine_r9 W2, m3; the critic's `hotspot` question):** the Ribbon's root carries
  `data-cue-ribbon` (the live-ribbon test of §8.1 point 9); the hotspot buttons and the bare-art catcher carry
  `data-cue-hit` (§8.5 "Hit areas"); the take-then-knot real-flush test; the take test's press asserted on the painted
  ghost; the lock-double mutation is **M-R10d**. Lock unchanged (13). **Round 11 (critique_engine_r10 m1; the
  critic's question):** `data-cue-hit` on a `.hotspot` only while it paints nothing (`h.kind !== 'exit' && !reveal`;
  §8.5 "Hit areas"); documents fly to the bar's Inventory control, which carries `data-cue="bar-inventory"` from this
  lane's control gate (§8.3), so `explore: every explore cue target resolves` covers `inventory`. Lock unchanged (13).
- **After:** GM3 (`yields.ts`), GM3s (`ExploreView.svelte`, `explore-view.svelte.ts`, `arch.test.ts`, the e2e).
- **Lock (13; round 2 printed 15 over 14 listed paths):** new `client/src/ui/explore/Ribbon.svelte`, new `client/src/cues/controls.test.ts`, new
  `client/src/i18n/mechanics.ts` (round 4: renamed from `i18n/explore.ts`; the mechanics' string table `mechanicsRu`
  / `mechanicsEn` with its accessor, after `i18n/meta.ts`'s pattern, imported by yields and the explore UI only, so it
  ships with the engine, never in the entry; keys `mech.use_refused`, the ribbon's labels; the view leave control
  reuses `explore.room_back`, `client/src/i18n/ru.ts:111`, so no new main-table key);
  `client/src/ui/explore/{ExploreView,Inventory,LockPanel,DocumentReader}.svelte` (round 4 O1: the `.sheet` gains its
  own backdrop, which holds the dim while a panel is up),
  `client/src/ui/explore-view.svelte.ts` (`onuse`, `oncombine`-ready selection in `forwardLayer`; no `game.ts` edit,
  GM3w), `client/src/app/yields.ts`, `client/src/app/yields.test.ts`, `client/src/ui/explore/explore.svelte.test.ts`,
  `client/e2e/mechanics.spec.ts`, `client/src/arch.test.ts` (`LAZY_COMPONENTS` gains `Ribbon.svelte`, `:892-901`).
  Round 3: `client/src/cues/stage/motions.ts` leaves the lock (the `ribbon-item` / `bare-art` overrides are GM3m's
  `UI_MOTIONS`), so the lock is the 13 paths listed.
- **Commits:** (1) `explore: every control declares its cue` (red: `Inventory.svelte:19` lacks `data-cue`; M-I5c),
  round 3: `puzzles: every gesture surface disables touch panning` on a fixture surface (red: no finding without the
  style rule); (2) `explore: every declared control emits its cue` (fires each control's trigger; M-I5g seen red on the test's
  fixture `pointerdown` control); (3) R17 tests (§8.3); (4) `explore: selecting an item then
  tapping a target dispatches use`, `explore: a bare tap deselects`; (5) `yields: the screens diff emits panel-open
  and panel-close` (round 9: a lock tap records exactly one `ui-state:panel-open` with `panel: 'lock'`, red
  with GM3s's mapping kept: two, **M-R10d** (named in round 10, m3); an explore puzzle's open and its X8 close record no `ui-state` cue from
  the diff, red on **M-R9j**, the diff speaking for `puzzle`: a `panel-open (puzzle)` at the push); (6) e2e
  `mechanics: select the key, tap the drawer, the drawer opens`; round 9 (W1) in commit (4), in
  `explore.svelte.test.ts`: `explore: a take pulses the slot it creates and presses the hotspot it removes on its
  ghost` (red on the parent: TS2307, no `Ribbon.svelte`; then **M-R9a**, **M-R9b**, **M-R9h**) and `explore: a use
  settles its leaving slot on its ghost and pulses the slot its rule gives` (red on the parent: TS2307, as above;
  then **M-R9a**, **M-R9b**, **M-R9f**), both rendering ExploreView with the real
  CueStage (GM3s's) and the recording `animate`; round 10 (W2) in commit (4): `explore: a take whose then starts a
  knot flies its glyph to the edge as the rooms leave` (§8.5's sixth real-flush row: ExploreView mounted with
  `mount`, the take's block ending in `unmount(view, { outro: true })`; verify at the cut that Svelte 5.57.3's
  `unmount` takes `{ outro: true }` and sets `inert` on the outroing root, and whether the paused Ribbon is updated:
  the assertion holds either way, since the resolver skips an outroing root; red on the parent: TS2307, then
  **M-R10c**), and the take test's press is asserted on the hotspot's `.cue-hit` ghost (red: **M-R10f**; M-R9h leaves
  that test, §8.5); in commit (1): ~~`explore: every hit area is marked`~~ (round 11, critique_engine_r10 m1:
  replaced by `explore: a hotspot is a hit area exactly while it paints nothing` and `explore: an exit tap presses its
  glyph`, component tests over an exit and a take with the reveal off and on, and the catcher; red on the parent: no
  attribute anywhere; **M-R11b**: the marker unconditional, round 10's text, red on the exit), and `explore: every
  explore cue target resolves` asserts `[data-cue-ribbon]` on the Ribbon's root and (round 11) the `inventory` target
  on the bar's Inventory button; (7) round 4: `mechanics:
  both string tables hold the same keys and placeholders` (in `explore.svelte.test.ts`, as `meta.svelte.test.ts:156-164`
  does for the meta table; seen red on a key missing from `mechanicsEn`), `explore: an open panel's sheet holds the
  dim after its cue ends` (O1; the sheet's computed background is not transparent; red: transparent); round 7 (m4):
  `explore: every explore cue target resolves` (each sheet open in turn and the ribbon holding an item: `panel` for
  `inventory`, `document`, `lock` and `ribbon` for the item resolve through `CUE_TARGET_ATTRS`; red: no
  `data-cue-panel` on today's sheets; round 9: the sheets carry it from GM3s, so the red is the `ribbon` row, no
  `[data-cue-item]` before the Ribbon; and no resolved target matches `[data-cue-root]`).
- **Gates:** check, test, build (explore-ui), e2e full (round 10: its e2e assert `data-cue-fallbacks` 0 at their
  end). Lock unchanged (13): the round-10 work sits in `Ribbon.svelte`, `ExploreView.svelte` and
  `explore.svelte.test.ts`; the round-9 work sits in
  `Ribbon.svelte`, `yields.ts`, `yields.test.ts` and `explore.svelte.test.ts`; the sheet markers left this lane for
  GM3s, which already holds `ExploreView.svelte`, and `ExploreView.svelte` stays in this lock for the ribbon mount and
  the `data-cue` controls.

### GM3p `mech-puzzle-cues`
- **Goal:** §8.2-§8.3 for `puzzles/ui/**`, `ui/puzzles/**`: `data-cue` on every puzzle control, `use:cueRoot` and the
  `layerIn` / `layerOut` transitions on the PuzzleHost root, `puzzle:*` cues from yields (`onchange` diffs with index,
  `attempted`, hints), the reveal. Round 5: `puzzle:offline` from `attempted`'s `network` / `not-entitled` branch
  (`yields.ts:658-661`), `puzzle:rate-limited` from each `countdown` tick (`:619-630`), and `data-cue-status` on
  PuzzleHost's status line (`PuzzleHost.svelte:81`). Round 6 (critique_engine_r5 W3): `puzzle:ready` at the
  countdown's zero (every frame of this lane's types is `commit: 'control'`, so the zero never posts here; GM7r adds the
  `ready(o)` choice) and from `attempted`'s `closed` / `invalid` branch (`:662-666`; round 7: `busy` leaves it, m3),
  which also sets `line: 'idle'` (found in round 6: today that branch leaves `checking` on screen). **Round 7 (critique_engine_r6 W1,
  m3, m4):** `setLadder`, the one writer of `puzzle.ladder`, with its `busy` edges and the per-site cues of §8.1 "The
  hint ladder" (the status answer's guard against a closed ladder included, found while resolving); `loadPuzzleUis`'
  `waited` and `opened` / `load-failed`; Retry that keeps its notice (round 8: `retrying: true`, `!f.retrying`, its wait
  hold, App's control cue while `puzzle.host === null`; the chunk write never touches `busy`); `busy` replies write
  nothing (m3); the markers of §8.5 "Cue targets":
  `data-cue-frame` and `data-cue-panel="puzzle"` on PuzzleHost's frame root (round 9: on the frame wrapper inside
  it, below), `data-cue-attempts` on its attempts line,
  `data-cue-notice` on a wrapper around its load-failed text and Retry (`disabled={frame.retrying}`, GM3w's binding), `data-cue-panel="hints"`
  on HintLadder's root, `data-cue-tier` on each row, `data-cue-alert` on its failure line, `data-cue-part` on
  CodeLock's digits and OrderPuzzle's slots; the state gate. **Round 8 (critique_engine_r7 W1, W2, m1-m3; per-player
  R-E28):** `post(o)`, the one attempt starter, out of `ontry`'s body; the end cues at their real site,
  `dropPuzzle(cue)` called by `onEnd` with `solved` / `failed` / `closed` and by every other drop with `closed`
  (`dispose`: null); `ui-state:panel-open` for a frame with no screen; the Hint write keeping `failed` and the re-read's
  `puzzle:ladder`; the state gate by value, with its silent hold, `SETTLE_KEYS` for `busy` and seven new steps; the
  `ui-state` rows in the frame's resolve test. **A step the state gate finds without a cue that this
  design names no cue for is a STOP item at this lane's cut** (a design gap for the orchestrator), never an exclusion
  in the script. Lock unchanged (11). **Round 9 (critique_engine_r8 W1, m1-m4; RULINGS 135 (b)):** PuzzleHost's
  `<section>` becomes the family root keyed by `frame.id` (`{#key frame.id}`; `use:cueRoot`, `in:layerIn|global`,
  `out:layerOut|global={{ reduced, frame: true }}`, `data-cue-root`) holding one child, the frame wrapper
  (`data-cue-frame`, `data-cue-panel="puzzle"`, today's frame background, padding and scroll moved from the section,
  `PuzzleHost.svelte:115-128`; the root keeps its full-bleed box and GM3w's `pointer-events: auto`, and the wrapper
  fills it, so every tap the frame took it still takes, and an outroing root, `inert`, takes none); `endFrame(o, cue)` (the `waited` of a running Retry first, m2, then the end cue,
  only while the frame is shown), `hideFrame(o)` and `unshowCloseup(o)` with `Open.hidden`; the X8 Back runs
  `hideFrame(o)` before `session.close()` (m1); `ui-state:panel-open` (`panel: 'puzzle'`) at every frame write (m4),
  in the same synchronous block as the write (round 10: the write that shows the frame, through `appear(o)`, below); `disposePuzzle: () => dropPuzzle('closed')` (`yields.ts:866`; found
  (d)); the state gate's hold balance and its three round-9 steps; the resolve test's root invariant and notice row.
  Lock unchanged (11). **Round 10 (critique_engine_r9 W1; RULINGS 135):** `shownFrame()`, `appear(o)` and
  `Open.appeared` in `yields.ts` (§8.1 "The frame's flags and its ends", point 8): the frame's `panel-open` moves from
  the frame write to `appear(o)`, called after the frame write and after the chunk write, so it is emitted by the write
  that shows the frame; the shown-frame test gains `o.appeared` (a cue of a frame not yet shown is dropped); the state
  gate compares the shown view and fails a frame cue emitted while unshown, with three steps; the first-puzzle e2e on
  the real App. Lock unchanged (11). **Round 11 (critique_engine_r10 W1, m4, m5):** `holdLoad(o, on)` with
  `Open.loading` (the frame's load hold from the frame write, ended by the chunk write or `endFrame` whatever the
  frame's shown state; the round-7 / round-9 Retry emissions become its calls); the close-up's `null` hold around
  `openPuzzle`'s close-up batch (`started`); `dropPuzzle`'s and `hideFrame`'s order (the ladder and `hints` cleared
  while the frame is shown, m5); the state gate's hold balance on `loading(frame)`, the recorder's load-hold
  exception, its new steps and its restated predicted red (m4); the class guard `yields: every wait of the views
  holds a motion`; the first-puzzle e2e with the host chunk held. Lock unchanged (11). **Round 12 (critique_engine_r11
  W1, m1, m2; RULINGS 135):** the close-up's hold is GM3s's `held` (this lane emits nothing around it); the chunk
  write's order `holdLoad(o, false)`, `appear(o)`, then `puzzle:opened` / `load-failed` (m1); the class guard's
  scoped overlap clause and its declared moves (m2); **the await map** `yields: every await of the views names its
  wait`, with `WaitRow`, `WAIT_SITES` and `WAIT_CASES` in `yields.test.ts` (§8.1 point 11), which reads
  `puzzles/session.ts` and `puzzles/registry.ts` from disk and edits neither. Lock unchanged (11). **Round 13
  (critique_engine_r12 W1; RULINGS 148):** the await map is retired; **the request walk** `requests: every request
  start is a declared site` with its self-test `requests: a Pick of a port resolves to the port's member` lands in the
  new `client/src/requests.test.ts` (`REQUEST_PORTS`, `LIB_STARTS`, `WaitRow`, `REQUEST_SITES`, `HELD_ROWS`,
  `SCENE_LOADERS`, `VIEW_FILES`; §8.1 point 11), a program over `client/src` that reads every file and edits none;
  `yields.test.ts` keeps `WAIT_CASES`, typed by a type-only import of `WaitRow`. Lock 11 -> 12. **Round 14
  (critique_engine_r13 W1, m1, m4):** the walk gains `BATCH_MEMBER` (every reference to `YieldsHost.apply`, by
  declaration, is the one inside `held`), `TRANSPORT` (a reference typed by `FetchAsset` is a start: 11 new `other`
  rows on `fe996a0`), the re-type check at every value flow, `ViewWait`, the binding-element resolver by property and
  `COMPONENT_BANNED`; GM3s's pin `yields: every batch goes through held` leaves `yields.test.ts` in the same commit;
  four fixture mutations exercise the clauses that had none. Lock unchanged (12).
- **After:** GM3u (`yields.ts`, `controls.test.ts`, the e2e), GM3w (`PuzzleHost.svelte`, `puzzle-view.svelte.ts`,
  and, round 9 (drift (d)), `puzzle-host.svelte.test.ts`, whose `frameOf` GM3w extends with `retrying: false`), GM3s
  (`CueStage.svelte`, which this lane's real-flush tests render).
- **Lock (12; round 13: + the new `client/src/requests.test.ts`):** `client/src/puzzles/ui/{CodeLock,OrderPuzzle}.svelte`, `client/src/ui/puzzles/{PuzzleHost,HintLadder}.svelte`,
  `client/src/ui/puzzle-view.svelte.ts` (`oncue` in `forwardHost`), `client/src/app/yields.ts`, `client/src/app/yields.test.ts`,
  `client/src/ui/puzzles/puzzle-host.svelte.test.ts`, `client/src/puzzles/ui/puzzle-types.svelte.test.ts`,
  `client/src/cues/controls.test.ts`, `client/e2e/mechanics.spec.ts` (round 3: `motions.ts` leaves the lock; every
  `puzzle:*` key is GM3m's), new `client/src/requests.test.ts` (round 13: the request walk; it reads every file under
  `client/src` and edits none, so no other lane's lock is touched).
- **Commits:** (1) `puzzles: every control declares its cue` (red: `CodeLock.svelte:33`); (2) `yields: a dial change
  emits puzzle input with its index`, `yields: a wrong attempt emits puzzle wrong and a solve emits puzzle solved`
  (round 8, m1: `wrong` from `attempted`, `solved` from `dropPuzzle` via `onEnd`; with it `yields: a last wrong attempt
  emits puzzle failed`, `yields: a solve emits puzzle solved while its frame is shown`, `yields: a give-up and an X8
  close emit puzzle closed`, on the real session over a fake api; red on the parent: no puzzle cue at all; **M-R8d**,
  the cues in `attempted`'s ending cases, red: nothing recorded), `yields: every frame's appearance plays one
  panel-open` (round 8 named it `yields: a linear frame's appearance plays panel-open`; red: no key until the chunk;
  round 9, m4: the explore frame too, exactly one, **M-R9j**), round 9 (m1): `yields: an X8 Back hides the frame at
  once and a late correct answer still opens the lock` (the real session over a fake api whose attempt resolves after
  the Back; red on the parent: `puzzle.frame` still set at the Back, no `puzzle:closed` until the answer; **M-R9k**),
  round 10 (W1): `yields: a frame's appearance is emitted by the write that shows it` (a fresh `PuzzleView` with the
  host loader deferred; red on the parent: no `panel-open` at all, then **M-R10a**, round 9's emission at the frame
  write, recorded with `puzzle.host === null`) and `yields: a frame that never showed plays no cue` (red: **M-R10b**,
  `puzzle:closed` at an X8 Back before the host lands), reconcile r2 (RC-W5; design-shots I-7): `YieldsHost.frameShown?`
  and `ShownFrame` (§8.6), called from `appear(o)` and from every step that takes a shown frame off screen, with
  `yields: the host hears every change of the shown frame` (red on the parent: TS2353, `frameShown` is no member of
  `YieldsHost`; then **M-RCw** and **M-RCx**, §8.6), round 11 (W1): `yields: every wait of the views holds a
  motion` (§8.5; red on the parent at the close-up and frame-load rows, no `waiting` before their ends; then
  **M-R11a**, **M-R11f**, **M-R11c**; round 12: red on the parent at the frame-load row only, since the batch row's
  cases are green through GM3s's `held`; the overlap clause scoped, **M-R12g**), round 13 (critique_engine_r12 W1;
  RULINGS 148; it replaces round 12's await map): `requests: every request start is a declared site` (red-first with
  `REQUEST_SITES` empty: every start of the parent unlisted and four orphan wait rows, §8.5; then the 51 rows; then
  **M-R13a**-**M-R13g** and the re-pointed **M-R12b**, **M-R12c**, each seen red) and `requests: a Pick of a port
  resolves to the port's member` (its mutation seen red, §8.5); round 14 (critique_engine_r13 W1, m1, m4) in the same
  commit: the batch member, the transport and the re-type check (the red-first lists 50 other references and the
  table grows to 62 rows; the batch member and the re-type check are green on the parent, CLAIM, and a re-type found
  there is a STOP item), the pin `yields: every batch goes through held` deleted from `yields.test.ts` with **M-R12a**
  and **M-R11f** re-pointed to "batch outside held", the self-test's round-14 cases, then **M-R14a**-**M-R14i** and
  **M-R14l**, each seen red with its own message; reconcile r1 (critique_engine_r14 m2, m3; RULINGS 152), in the same
  commit and the same two files: `BATCH_MEMBER.site` bound to `held`'s declaration by its `HeldAt` parameter, the
  program-wide count, `HOST_WAITS` (its red-first: the table empty, "unlisted host wait" for each of its 8 members on
  the parent, the count MEASURED and recorded at the cut; a member set other than §8.1 point 11's is a STOP item there),
  the constraint comparison and the widening, the self-test's reconcile cases, then **M-RCb**-**M-RCj** and **M-RCt**,
  each seen red with its own message (§8.1 point 11); a guarded value flowing into a member-less type or a constrained
  generic on the parent is a STOP item at the cut, as a re-type is (lock and commit count unchanged); reconcile r2
  (RC-W4, R-E34), the same commit and files: `HOST_WAITS`' reach scoped to `client/src`'s `.ts` declarations with
  every function member's return type followed (§8.1 point 11), so its red-first lists exactly its 8 members
  ("unlisted host wait" each, with the table empty), then `requests: the host-wait walk's reach on the tree is the
  HOST_WAITS rows` with **M-RCu** and **M-RCv**; `BATCH_MEMBER` re-shaped as the first `SITE_MEMBERS` row (its
  messages and M-R14a-M-R14c, M-RCb-M-RCj unchanged) with `requests: every site member stays in its site` and
  **M-RCz**,
  `yields: every attempt starts through post` (round 8, R-E28; red: the call
  sits in `ontry`);
  round 5: `yields: an offline reply and each countdown second emit their cues` (a fake clock over a 3 s 429: three
  `puzzle:rate-limited` with index 3, 2, 1; red: none; **M-R5d**) and `puzzle-host: the status line is a cue target`
  (`[data-cue-status]` present in the frame); round 6 (W3): `yields: a countdown that ends with nothing to post emits
  puzzle ready` (the same fake clock on a `code` frame: after index 3, 2, 1, exactly one `puzzle:ready` at zero, the
  frame `idle` with `retryAfter: null`, no POST; red: no cue at zero, round 5's `countdown`; **M-R6a**: the zero branch
  emits nothing) and `yields: a check that ends with no outcome returns the frame to idle with puzzle ready` (an
  attempt answered `invalid`, which `attempt()` returns for an answer that fails `validAnswer`,
  `client/src/puzzles/session.ts:216-217`: e.g. a non-permutation set through `onchange` on an `order` frame, verify at
  the cut that `setAnswer` stores it; if no input reaches the branch through yields, the test drives `attempted` with a
  hand-built `invalid` result through the host seam the lane's yields tests already use; red: `line` stays `checking`
  and no cue); (3) `yields: the reveal emits its cue`; (4) `puzzles: every declared control emits its cue`; (5) e2e `mechanics: a
  linear puzzle's give-up ask and no play their cues` (red on round 1's scoped model: no player outside a section);
  (6) round 3: e2e `mechanics: a tap on the room right after a puzzle closes reaches the room` (the outro now exists;
  **M-W1b**, GM3w's wrapper without `pointer-events: none`, seen red); round 10 (W1): e2e `mechanics: the first puzzle
  of a page load slides in on its frame` (a fresh page, ch1's study drawer; one `ui-state:panel-open` before
  `puzzle:opened` in `data-cues-played` and `data-cue-fallbacks` 0; red on **M-R10a**: 1; round 11, W1: renamed
  `mechanics: the first puzzle of a page load holds a motion while its frame loads and slides in on its frame`, the
  host chunk's request held from the page's load until 1.5 s after the tap, `ui-state:waiting@puzzle` then
  `ui-state:waited@puzzle` before the `panel-open`; red on **M-R11a**; round 12, m1: the order `holdLoad`'s and
  `appear`'s docs now state too, red on **M-R12f**), the real-App, real-flush
  proof of the rule; every e2e of this lane ends asserting `data-cue-fallbacks` 0; round 7 (m3, m4) in the commits above: (1)
  gains `puzzles: every type UI marks its parts` (red: no `data-cue-part` in `CodeLock.svelte`), (2) gains `yields: a
  busy reply leaves the frame to the attempt in flight` (red on main: `busy: false`, `yields.ts:665`); (7) round 7
  (W1), the ladder: `yields: every hint-ladder answer plays its cue` (table-driven over §8.1's eleven rows on a fixture
  session and port; red on the parent: no ladder cue at all), `yields: a status that answers after Back leaves the
  ladder closed` (red on main: the ladder is written again, `yields.ts:706-709`), `yields: the ladder has one writer`
  (a source count of `puzzle.ladder =` in `yields.ts`, 1; red on the parent: 9); round 8 (W2): the table test's Hint
  and re-read rows assert the kept alert and the re-read's `puzzle:ladder` (red on the parent: no cue; on the round-7
  table: `failed: false` at the tap, **M-R8b**); (8) round 7 (W1), the chunk loads:
  `yields: a failed type chunk plays load-failed and a retry keeps the notice until it answers` (a fixture chunk
  loader failing, then failing again, then loading: `puzzle:load-failed`, `ui-state:waiting` / `waited` with
  `panel: 'puzzle'`, `puzzle:load-failed`, then `puzzle:opened`; `loadFailed` stays true and, round 8, `retrying` true
  between the tap and each answer, `busy` untouched; a second Retry tap imports nothing; red: `loadFailed` false at
  the tap, no cue); round 8 (W1): `yields: a chunk result writes only the chunk fields` (a guard, **M-R8a** seen red)
  and `puzzle-host: Retry is disabled only while it reloads` (a pin of GM3w's binding, green on the parent; seen red
  on the mutation "Retry `disabled={frame.busy}`", round 7's text); `yields: App's
  host-chunk Retry emits its control cue` (`puzzle.host === null`: one `ui:puzzle-retry` with `el: null`; with the host
  loaded: none from yields; red: none); (9) round 7 (W1, m4), the gates: **`yields: every visible change of the puzzle
  view plays a cue`** (§8.5's script; **M-R7a**, **M-R7b** seen red; round 8: by value, the silent hold, `SETTLE_KEYS`
  and the seven new steps, with **M-R8a**, **M-R8b** and the silent-list mutation seen red; round 9, m1 / m2: the hold
  balance and the steps "an X8 Back during an attempt in flight" with its answer, "Back during a Retry" and "a linear
  frame dropped during a Retry", **M-R9i** seen red; round 10, W1: the shown view, "frame cue while unshown" and the
  steps "the first open with the host chunk pending", "an X8 Back before the host lands", "a `restore` before it
  lands", **M-R10a** and **M-R10b** seen red; round 11, critique_engine_r10 W1, m4, m5: the hold balance on
  `loading(frame)`, the recorder's load-hold exception, `puzzle.host` set before "open (explore)", the restated
  predicted red, the steps "a chapter change before the host lands" and "a Try answered `correct` while the ladder is
  open with its status in flight", **M-R11a**, **M-R11c** and **M-R11d** seen red), `puzzle-host: every puzzle cue target resolves in the frame`
  (**M-R7c**; round 8: with the `ui-state` rows, **M-R8c**; round 9: no resolved target matches `[data-cue-root]`,
  **M-R9c** seen red, and the `loadFailed` hold row resolves `[data-cue-notice]`, **M-R9e** seen red), round 9 (W1):
  `puzzle-host: a failed purchase wobbles its new alert and Back slides the ladder out on its ghost` and `puzzle-host: a
  frame replaced in one block ends on its own wrapper under layer-out and the next opens on its own` (PuzzleHost and
  HintLadder with the real CueStage, a real flush and the recording `animate`; red on the parent: no frame wrapper,
  `jam` and `layer-out` on one element; then **M-R9a**, **M-R9b**, and for the second **M-R9c**, **M-R9g**), and e2e
  `mechanics: a hint ladder that cannot load plays its failure cue` (**M-R7a** re-applied). 9 commits (round 9 adds
  tests and hunks to commits (2) and (9), no commit; round 10 adds tests and the `appear` hunk to commits (2), (6) and
  (9), no commit; round 11 adds the `holdLoad` and close-up hunks and the class guard to commit (2), the e2e's hold
  to commit (6) and the gate's steps to commit (9), no commit; round 12 adds the await map and the chunk write's
  reorder to commit (2), the restated order to commit (6) and the scoped clause to commit (9), no commit; round 13
  replaces the await map with the request walk in commit (2), no commit; round 14 extends the walk and retires the pin
  in commit (2), no commit).
- **Gates:** check, test, build (puzzle-host row vs +0.25 = round 3's +0.2, round 7's +0.03 and round 9's +0.02, the
  wrapper and `frameOut`; engine vs +0.31, reconcile r2: +0.02 for `frameShown`'s four lines (was +0.29); round 9: +0.04 for `hideFrame`, `unshowCloseup`, the X8 call and
  `endFrame`; round 10: +0.03 for `appear(o)`, `shownFrame()` and the second call site; round 11: +0.03 for
  `holdLoad`, `Open.loading`, its four call sites and the close-up's hold; round 12: -0.01, the close-up's hold
  moving into GM3s's `held`; GM3p's cut carries Q12's STOP
  item if the orchestrator keeps the 1.5 target), e2e full (the round-3 e2e `mechanics: a tap on the room right after a puzzle closes reaches the room`
  now runs over the 480 ms `frameOut`); round 13: the request walk's program time MEASURED and recorded in the cut
  (60 s timeout; over 30 s is a STOP item), and its 51 rows re-located on the cut's parent (LFL, in flight, may move
  `boot.ts` / `app/meta.ts` lines and functions; reconcile r1: LFL merged as `cec347c`, and LRB (RULINGS 156) held
  the same files, merged as `3c62a86` (RULINGS 157): the rows follow the walk's red-first output, the design's list is §1's);
  round 14: 62 rows (the 11 transport rows of §1), the program time measured with the re-type check in it.

### GM3b `mech-state-visuals`
- **Goal:** §6.4.
- **After:** GM3p (`yields.ts`); **per-player GM6a** (W7: E-P1's `at`-keyed anchors and E-P7's order must be in the
  executor before two placements of one image are emitted).
- **Lock (16; round 5 m2: one over the soft bound, as GM1c and GM3: the drawer's open state needs an image, and a
  state naming a prop the catalog lacks fails `npm run story`, so the catalog entry and its first state are one unit):**
  new `client/src/mechanics/{data,rules}/visual.ts`, new `client/scripts/story/mechanics/visual.ts`,
  new `client/src/mechanics/visual.test.ts`; `client/src/mechanics/{data,rules}/index.ts`,
  `client/scripts/story/mechanics/index.ts`, `client/src/explore/controller.ts` (`visualsOf`, cue `box`; round 12:
  `anchorBox`, the `state:<room>` preload and its release branches; round 13: `stateHold`, the keep-set release and
  the close-up's release of the other rooms' `state:`; round 14: the current room's set requested at every
  `roomShown`),
  `client/src/app/yields.ts`, `client/src/app/yields.test.ts`, `client/scripts/story/emit.ts` (usage props),
  `client/scripts/story/build.test.ts`, `client/src/explore/controller.test.ts`, `client/e2e/mechanics.spec.ts`,
  `story/ch1/world.json` (a drawer state; narrative-designer), `assets/catalog.json` (round 5 m2: one placeholder prop
  `drawer_open` by hue, as `assets/catalog.json:56-60`; the drawer has `prop: null` today, `story/ch1/world.json:109`).
  A visual state carries no text, so no en table. `client/e2e/puzzles.spec.ts` is a byte-identical pin, not a touch.
- **Commits:** (1) `visual: a prop's state follows its first matching is` (red: module missing); (2) `yields: a state
  change crossfades the props on screen`; `takeBatch` replaced; pins `yields: a take removes its prop from the stage`
  and e2e `explore: reload resumes in the same room with items` byte-identical; `yields: two placements of one image
  keep two anchors`, `yields: the props command lists placements back to front`; round 12 (W1), round 13 (m1): the
  state batch calls GM3s's `held` with `controller.stateHold(diff)` (the first changed anchor that draws an image,
  else `'no-load'`), `yields: a state change that waits on its picture holds a motion at its anchor` (red on the
  parent: nothing applied; **M-R12a**, round 14: red in GM3p's walk, "batch outside held", since GM3b lands after
  GM3p retired the pin), round 13: `yields: a state change holds at the first changed anchor that
  draws an image` (red on **M-R13j**) and `yields: a state change that draws no image opens no hold` (red on
  **M-R13k**), and GM3p's request walk stays green with no new row (the state batch starts no request; its images
  load in `game.ts`'s `stage()`, a `SCENE_LOADERS` file, reached through `held`); (3) `emit: usage props list every
  state image`; round 12: `controller: a room preloads every image it can show before its neighbours` (red on the
  parent: bgs only; **M-R12i**) and `controller: a close-up keeps the room's state images and a move releases them`
  (red: no `state:` holder exists; **M-R12j**; round 13: restated to the keep set, **M-R13i**), round 13 (W2):
  `controller: a round trip to a neighbour and back fetches each state image once` (red on the parent: P's images
  never requested; then **M-R13h**), round 14 (critique_engine_r13 m2 (a)): `controller: a refused or evicted state
  image is requested again at the room's next entry` (red on the parent: no `state:` holder; then **M-R14k**, round
  13's once-per-room rule), `build: a room's preload list equals its room-set props` (red: a fixture decor
  state `roomImages` skips); (4) e2e `mechanics: opening the drawer changes its picture at once`; round 12: e2e
  `mechanics: a state picture that loads holds a motion at its anchor` (red on **M-R12a**). The cut records
  `drawer_open`'s MEASURED file size (the state preload's bytes for ch1's study) and re-reads `scene/registry.ts`'s
  holder rule (`:249-258`) on its parent for the counting fake (LHJ, in flight, holds that file; critique_engine_r12
  `:275-276`; reconcile r1, critique_engine_r14 O1: LHJ merged as `972f773`, and on `acc4e0d` the rule is `drop`,
  `registry.ts:257-267`, with `acquire`'s existing-record join `:483-488` and `preload()`'s join of a live or pending
  id outside the two slots, `preload.ts:167-172`; the counting fake models holders, not the queue, so a join is no
  fetch there either and no test changes). **Reconcile r1 (design-shots I-11), as changed by reconcile r2 (RC-W2,
  per-player R-E32 adopted):** commit (2) also adds `Yields.roomFor(bg): readonly VisualCommand[] | null` (§8.7 row;
  `roomProps`, `yields.ts:158-169`, stays module-private): the state commands of a room of the current section whose
  bg is `bg`, from the one function that builds `roomBatch`'s state commands (`[{ kind: 'props', props }]` here;
  per-player GM6d2 appends the room's `labels` in that function), with `yields: roomFor gives a room's state commands
  by its bg` (a fixture section with two rooms on one bg and a current room: the current room's commands when its bg
  matches, else the first room's in declaration order, null for a bg no room has and with no section open; red on the
  parent: TS2339 `roomFor`), **M-RCm** (the current room not preferred: red on the shared-bg case), **M-RCn** (`[]` for
  an unknown bg: red, null expected), and `yields: roomFor equals the room batch's state commands` (the same room
  entered by a move and asked by `roomFor`, a fixture state with a `patch`: the two lists deep-equal), **M-RCaa**
  (`roomFor` builds its own `props` list from `visualsOf` without the patch placements: red, the lists differ). r1's
  `propsFor(bg): readonly PropPlacement[] | null` returned placements, which a cut back to a room would show without
  its code labels. **Reconcile r1 (design-shots I-18):** this lane holds
  `story/ch1/world.json`; its cut checks that `gate`'s `"closeup": null` (`story/ch1/world.json:43`) and its `onFail`
  `manor_gate_forced` (`:89`) still stand after its drawer state, or names the replacement room event SH11's e2e uses
  (the same check binds GM1d, GM4u, GM9r, GM6c4 and GM6d2, §12 "Order and conflicts"). Lock unchanged (16); 4 commits.
- **Gates:** check, test, story, build (room-set rows MEASURED; explore-ui vs +0.45, round 13: +0.02 for the keep set
  and `stateHold`; engine vs +0.23 with the one `held` line and `propsFor`, reconcile r1; reconcile r2: `roomFor`,
  +1 line under the rounding), e2e full.
