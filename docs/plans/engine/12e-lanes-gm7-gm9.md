### GM7r `mech-reach-runtime` (new)
- **Goal:** the runtime shared by every reach type (§7.4): `PuzzleUiProps.onreach` / `oncue`, the session's
  post-once-per-solve of `canonical(p, a)`, the `mismatch` result, yields' reset + update toast (m3), the gesture cue
  path; with a test-only fixture reach type, opened through yields' new `h.puzzleTypes` seam (round 5 m1, §7.1; GM1c
  added the decode and session halves of it). Round 5 (W3): `reachEdge` (`client/src/puzzles/play/reach.ts`), the
  reply-kind rule for reach types (§7.5 "Posting per reply kind"): `Open.reach`, `postReach`, the countdown's `ready(o)`
  hook, `frame.awaiting`, the clear on a move away, `ontry` = `postReach` on a reach frame, PuzzleHost's reach
  `canTry`; `mismatch` counts no attempt. Round 6 (W3): `ready(o)` returns whether it posted, and the zero emits
  `puzzle:checking` or `puzzle:ready`, never both (replacing GM3p's unconditional `ready` at zero; 0 net lines).
  Round 7 (per-player R-E27 (d), the E-P12 / R-E24 pattern): **if per-player GM6c2 is merged at this cut**, the zero's
  non-posting branch goes through GM6c2's `settle(o, patch, cue)` (one `setFrame`, one cue: `renewed` in place of
  `ready` when the pass carries a run change) and this lane's `ready(o)` test stays green by name (a static fixture
  puzzle's pass carries no values patch); if GM6c2 merges later, its cut routes whatever non-posting zero it finds;
  the cut records which. Round 7 (W1): the state gate's script (`yields: every visible change of the puzzle view
  plays a cue`, GM3p) gains the reach steps (`onreach`, a `mismatch`, a move away, the zero's re-post) on the fixture
  reach type. **Round 8 (per-player R-E28):** `postReach` and `ready(o)` post through GM3p's `post(o)` (no direct
  `session.attempt()`; `yields: every attempt starts through post` stays green by name), and `ready(o)` returns
  `post(o)`'s boolean; the `frame.awaiting` row joins `VIEW_FIELD_CUES` (true: `puzzle:reached`; false: `puzzle:input`
  for a move away, or a settling key).
- **After:** **GM5** (`yields.ts`, `yields.test.ts`: the holder chain ends `... GM4u -> GM5 -> GM7r`; round 3 m1), GM3p
  (`puzzle-view.svelte.ts`, `PuzzleHost.svelte`, `puzzle-host.svelte.test.ts`), GM1c (`session.ts`, `registry.ts`);
  never beside per-player GM6c2 (`session.ts`). **Beside:** GM5f. The mismatch is logged to the console only (m12).
- **Lock (11; round 4: one table instead of two; round 5: + `reach.ts` and its test):** `client/src/puzzles/session.ts`, `client/src/puzzles/session.test.ts`,
  `client/src/puzzles/registry.ts` (`PuzzleUiProps`), `client/src/ui/puzzle-view.svelte.ts` (`onreach`, `oncue` in
  `forwardHost`), `client/src/ui/puzzles/PuzzleHost.svelte` (passes them), `client/src/app/yields.ts`,
  `client/src/app/yields.test.ts`, `client/src/i18n/mechanics.ts` (`mech.content_updated`, Q15e default; round 4: not
  the main `i18n/{ru,en}.ts`, which the entry imports, `i18n/index.ts:3-4`),
  `client/src/ui/puzzles/puzzle-host.svelte.test.ts`; round 5 (W3, 9 -> 11): new `client/src/puzzles/play/reach.ts`,
  new `client/src/puzzles/play/reach.test.ts` (`puzzles/play/**` is already under `rules-lazy` from GM1c, and only
  type UIs import it).
- **Commits:** (1) `session: a reach puzzle posts once per solve and none per stroke` (red: TS2339 `onreach`);
  round 5: `reach: the edge reports a reached start once and each later turn to reached once` (red: TS2307 `reach.ts`;
  then **M-R5a**, the edge starting at `true`); (2) `session: a wrong reply to a reach post is a mismatch and counts no
  attempt` (round 5: and no `attempt-failed` is dispatched); (3) `yields: a mismatch resets the device and shows the
  update toast`; round 5 (W3): `yields: a reached answer answered offline posts again on Try` (red: Try posts the drawn
  answer, or nothing), `yields: a rate-limited reach post posts again when the countdown ends` (red: nothing posts at
  zero), round 6 (W3): `yields: a countdown's end emits puzzle checking when it re-posts and puzzle ready when it does
  not` (red on the parent: GM3p's zero emits `puzzle:ready` and posts nothing for a reached frame; mutation: `ready(o)`
  emits `puzzle:ready` after its post too -> two cues at one zero, red), `yields: a move away from a reached answer
  cancels its pending post` (red: a later Try posts the unreached answer), `puzzle-host: a reach frame enables Try only
  while its answer awaits` (red: Try enabled on an unreached fixture answer); (4) `puzzle-host: a gesture step reaches
  the cue bus through oncue`.
- **Gates:** check, test, build (puzzle-host row vs +0.01; engine vs +0.08: the round-5 reach state's +0.09 less round
  8's -0.01, `postReach` calling `post(o)`; round 9, critique_engine_r8 drift: round 8 left +0.09 here while §3.5 read
  +0.31 for the GM7 row), e2e full (unchanged: no world holds a reach type until GM8d). 11 files, 4 commits.

### GM7p `mech-path`
- **Goal:** `path` (§7.2-§7.4); `world/unique-solution`, `world/reach-solution`, `world/attempts-without-wrong`
  (round 3 name of `world/attempts-on-reach`: refuses `maxAttempts` where `wrong === 'none'`), `world/reach-has-clue`
  activated; puzzle-type roots by glob; the first gesture (`path-stroke`, M-I5h) with `touch-action: none`, pointer
  capture and `pointercancel` (m13).
- **After:** GM1d (`clues.ts`, `shape.ts`'s lint), GM7r (`registry.ts`), GM4g (`budget.ts`), GM3u (`arch.test.ts`),
  GM3p (`puzzle-types.svelte.test.ts`); **per-player GM6k** (the server's opaque `type`; today's closed `PuzzleKind`
  refuses a new type, `server/src/content.rs:394-412`; per-player R-E12). **Beside:** GM8i.
- **Lock (14; round 4 m5 +1):** `client/src/puzzles/rules/{index,path}.ts`, new `client/src/puzzles/play/path.ts`, new
  `client/src/puzzles/ui/PathPuzzle.svelte`, `client/src/puzzles/registry.ts`, new `client/scripts/story/puzzles/path.ts`
  (its `codes`: `world/unique-solution`, `world/reach-solution`, `world/attempts-without-wrong`),
  `client/scripts/story/puzzles/index.ts` (one `PUZZLE_LINTS` line, round 4),
  new `client/scripts/story/puzzles/path.test.ts` (round 3: the type's own build tests, so no shared lint test file),
  `client/scripts/story/mechanics/clues.ts`, `client/scripts/{budget,budget.test}.ts`, `client/src/arch.test.ts`
  (registry pin and `LAZY_COMPONENTS`), `client/src/puzzles/rules/rules.test.ts`,
  `client/src/puzzles/ui/puzzle-types.svelte.test.ts`. Round 3: `client/src/cues/stage/motions.ts` leaves the lock
  (`puzzle:blocked` is GM3m's; the path controls' motions come from their `ControlDecl`s, §8.5).
- **Commits:** (1) rules + canonical (`path: a reversed path posts its canonical form`); the path UI reports through
  GM7r's `reachEdge` (round 5, W3: `path: a stroke that reaches the end reports once`); (2) lints (two-solution and
  mismatch seeds red), `story: a path whose solution visits 17 cells is refused` (the W3 pin through a real type; a
  green here means GM1d's lint is not wired to the type registry); round 5 (W3): `story: a reach puzzle reached at its
  start is refused` (`world/reach-solution`'s new clause, in `path.test.ts` on a fixture reach type through the
  `PUZZLE_LINTS` parameter; red: no finding); (3) `budget: a new type UI is a root without a
  budget edit` (red: the row misses it); (4) UI + cues: `puzzles: every control declares its cue` covers `path-cell`
  and the `path-stroke` surface; `puzzles: every gesture surface disables touch panning` seen red by deleting the style
  from `PathPuzzle.svelte` (m13); `puzzles: every declared control emits its cue` drives the stroke script including
  the cancel (M-I5h seen red).
- **Gates:** check, test, story, build (new type row), e2e full (unchanged; round 4 W2: no world holds a `path` until
  GM8d, whose e2e `mechanics: draw the fuse path` is the type's real-layout proof).

### GM7g `mech-grid`
- **Goal:** `grid`, same shape as GM7p; round 3 (W3): raise the build's `MAX_ANSWER_LEN` to 64.
  **After:** GM7p (and through it GM7r for `session.test.ts`); per-player **GM6s1** (the server's `MAX_ANSWER_LEN` 64
  for 5 x 5; R-E12). **Beside:** GM8i.
- **Lock (13; round 4 m5 +1):** `client/src/puzzles/rules/{index,grid}.ts`, new `client/src/puzzles/play/grid.ts`, new
  `client/src/puzzles/ui/GridPuzzle.svelte`, `client/src/puzzles/registry.ts`, new `client/scripts/story/puzzles/grid.ts`,
  `client/scripts/story/puzzles/index.ts` (one `PUZZLE_LINTS` line, round 4),
  new `client/scripts/story/puzzles/grid.test.ts`, `client/scripts/story/puzzles/shape.ts` (the bound 16 -> 64),
  `client/src/arch.test.ts`, `client/src/puzzles/rules/rules.test.ts`, `client/src/puzzles/ui/puzzle-types.svelte.test.ts`,
  `client/src/puzzles/session.test.ts` (round 3: `motions.ts` leaves the lock).
- **Commits:** `story: a grid with two solutions is refused`, `grid: reached on the unique fill`, round 5: `story: a
  grid whose given cells fill it is refused` (the `world/reach-solution` start clause through a real type; a green
  means the clause reads no type's `initial`), `story: a 25-cell grid
  passes the answer bound` (red at 16; the server pin then reads 64 on the tree, so a red pin means GM6s1 has not
  merged: a STOP item), `session: a 25-cell answer posts`, UI and cues.
- **Gates:** check, test, story, build (new type row), e2e full (unchanged; the grid e2e is GM8d's, round 4 W2).

### GM8i `mech-devices`
- **Goal:** §7.5's module: `device` room key, `device-moved`, `run.work` writes, the `part` visual atom, open on
  arrival; round 3 (m10): the outcome branches, the device hotspot drawn by the device (no button),
  `module:devices:done` / `jammed`, `world/device-failed-state`; the critic's open question: the `normalize` that drops
  a `work` failing `workFits`. Round 4: arrival is the module's `arrived` hook (m9; no `device-arrive` action, no
  controller dispatch); the placement lints `world/view-type-site`, `world/device-type` (W3) and
  `world/device-parts-frame` (m10), all in `devices.ts`'s own `codes`. Round 5: `world/device-closeup` (W2) and the
  parts' safe frame with the derived band and its constants `DEVICE_BAR_CSS_H`, `DEVICE_TOP_INSET_CSS`,
  `DEVICE_BAND_Y` (m5), in the same file; lock unchanged (11). Round 6 (critique_engine_r5 m1): `DEVICE_BAR_CSS_H` =
  120 (the three-row bar of §7.5) and `DEVICE_BAND_Y = 64 + ceil((8 + DEVICE_BAR_CSS_H + DEVICE_TOP_INSET_CSS) x 1080 /
  320)` = 496; `devices: null` in `MECHANIC_TEXTS` (W1). Round 7 (critique_engine_r6 m1): the part-size rule imports
  `HOTSPOT_MIN_SOURCE_PX` from `client/src/geom/cover.ts` (GM3c moved it there), never a copy of 150. **Round 10
  (found while resolving critique_engine_r9 W1):** the `arrived` hook runs after the room's `enter:<room>` trigger and
  opens nothing while `pendingStory` is non-empty, so no device session opens under an `onEnter` event (its frame would
  have no room on screen); the event's return (`event-returned`'s `room` effect, `reduce.ts:354`) runs the hook again.
  Lock unchanged (11).
- **After:** GM5f (the index files, `cues/stage/motions.ts`), GM4 (`explore/controller.ts`, `controller.test.ts`), GM3c
  (`rules/conditions.ts`); **per-player GM6a** (W7: a device's identical parts are placements of one image). Round 3
  m1: GM7r is no longer a predecessor (no shared file, no dependency). **Beside:** GM7p, GM7g.
- **Lock (11):** new `client/src/mechanics/{data,rules}/devices.ts`, new `client/src/mechanics/devices.test.ts`, new
  `client/scripts/story/mechanics/devices.ts`; `client/src/mechanics/{data,rules}/index.ts`,
  `client/scripts/story/mechanics/index.ts`, `client/src/mechanics/rules/conditions.ts` (`part`),
  `client/src/explore/controller.ts` (the device hotspot left out of the hotspot views; round 4: no arrival dispatch),
  `client/src/explore/controller.test.ts`, `client/src/cues/stage/motions.ts` (`fact:work:*`, `module:devices:*`).
- **Commits:** `device: arriving in a device view opens its session`, `device: a part move writes run.work and its
  picture follows`, `story: a device room without a zero-slot lock is refused`, `visual: four placements of one lever
  image keep four anchors` (with GM6a in the tree); round 3: `device: arriving at a jammed device plays its jam and
  opens nothing` (red: the zero-slot lock tap emits `lock`, `reduce.ts:373`), `device: arriving at a solved device
  opens nothing`, `controller: a device view lists no button for its device hotspot`, `story: a capped device without
  a failed state is refused`, `device: a saved work that no longer fits the device is dropped at resume`; round 5:
  `story: a device puzzle with a close-up is refused` (W2, `world/device-closeup`; a fixture `view` type with
  `"closeup": "cabinet"`; red: no finding), `story: a device part outside the safe frame or under the bar's band is
  refused` (m5; round 6 m1: fixtures at x 40 and at y 400, inside round 5's 280 band and under the 496 one; red at
  y 400 on the 280 constant), `devices: the band constant follows the bar's bound` (round 6: `DEVICE_BAND_Y` = 496 for
  `DEVICE_BAR_CSS_H` = 120 and inset 0, and + 4 for one CSS px of inset, ceil(3.375); red: a hand-written 280); round 4:
  `device: a resume and an event return into a device room open its session` (the `:332` and `:354` pushes; red: only
  the move opens it), `device: a device's own end does not re-arrive` (solve, then `roomShown()`: no `done` cue; red on
  a hook bound to `roomShown`), `search: a device's arrival adds no state` (a fixture device world proves the same count
  with the hook), `story: a view-type puzzle outside a device lock is refused` (W3; a fixture `view` type yielded
  linearly, on a room lock and on a slot lock: three findings; red: none), `story: a device whose lock puzzle is an
  overlay type is refused`, `story: a device part under the bar's band is refused` (m10); round 10: `device: an
  arrival under an onEnter event opens nothing until the event returns` (a fixture device room whose `onEnter` holds
  `{ story }`; red: a `puzzle` effect in the exit's dispatch).
- **Gates:** check, test, story, build.

### GM8h `mech-device-host` (new)
- **Goal:** §7.5's host: PuzzleHost's `place: 'room' | 'ladder'` (compact bar without give-up, part hit areas,
  `pointer-events`), the device rendered **inside the room layer** with the ladder as a room sheet (round 3 W1),
  `coversStage` and `backScreen` narrowed to overlay frames, `Open.present` / `room`, W2's close rule with the `room`
  effect's deferred close (m9), `onwork` / `oncommit`, and `session.failLocal()` with its yields route (round 3 W2).
  Round 4: the session seeded from `run.work` and the one `onwork` handler (W1); `restartWork`; the full-commit post
  and its re-post at the countdown's end (m8); the demo runner and `ondemo` (m7); the device hidden at the zoom-out
  (m1); the top-anchored bar with the type-chunk Retry (m10). Round 5: `instanceOf`'s `work` branch (m1, moved here from
  GM1c); the device bar's Try for a reach device's awaiting answer, the bar's
  `data-cue-status`, the demo stopped by `onreach`, `restartWork` on `mismatch` (W3); E-P12's wiring if per-player
  GM6c2 merged first (m7). Round 6 (critique_engine_r5 m1): the bar's three-row layout rule (§7.5), in
  `PuzzleHost.svelte`'s `room` place; (W3) the full-commit zero emits `puzzle:checking` with its post, never
  `puzzle:ready`. Round 7 (critique_engine_r6 m4, m5, W1): the bar's cue markers (`data-cue-frame` and
  `data-cue-panel="puzzle"` on the bar, `data-cue-attempts` on its row 3, `data-cue-notice` on its failed-chunk notice;
  `data-cue-notice` on ExploreView's failed-host notice in a view; the `ladder` place carries no `data-cue-frame`;
  both Retry buttons `disabled={frame.retrying}` (round 8: was `busy`, critique_engine_r7 W1), so GM3p's retry wait
  holds in a view too; round 8 (m3): ExploreView's in-view failed-host block also carries `data-cue-panel="puzzle"`;
  round 8 (m1, R-E28): the full-commit post and `oncommit` call `post(o)`; round 9 (critique_engine_r8 m4): GM3p's
  `panel-open` at every frame write stays unnarrowed (round 10: at the write that shows it; the view frame is written after the crossfade, so the bar slides
  in after the zoom-in), and the view frame's covering is named here: non-null `ui-state:panel-open`, null
  `puzzle:closed` (`hideFrame(o)` at the zoom-out) or its end cue; round 9 (m1): the zoom-out's device hide is
  `hideFrame(o)` before the deferred close (round 4's m1 path, now the one shared with the X8 Back); in the `room`
  place the bar is the frame's wrapper (it carries `data-cue-frame` and `data-cue-panel="puzzle"`; the host's root
  carries neither), so RULINGS 135 (b)'s root invariant holds in a view);
  the bar's own rules `min-height: 44px` (with `padding: 10px 12px`) on its buttons and `line-height: 18px` on its
  status and attempts lines, overriding the frame's 48 px button rule (`PuzzleHost.svelte:179-189`), so the bar is
  6 + 44 + 4 + 2 x 18 + 4 + 18 + 6 = 118 <= 120 at 320 px; `onretry`'s App-block control cue narrowed to
  `o.present === 'overlay'`; the state gate's script gains the view frame's steps. Lock unchanged (11). **Round 10
  (critique_engine_r9 W1; the critic's `hotspot` question):** the view frame's appearance goes through GM3p's
  `appear(o)` (no emission of its own: the frame write when the host chunk is in, else the chunk write); the room
  place's parts layer (the type UI's wrapper beside the bar, never the bar) carries `data-cue-hit`, so a part's
  `roll`, `press` or `pulse` plays on its painted ghost over the device art (§8.5 "Hit areas"). Lock unchanged (11).
  **Round 11 (critique_engine_r10 W1, m5):** a view frame's load hold is GM3p's `holdLoad` from the frame write (no
  hold of its own; as an overlay frame's, it plays on a notice if one shows, ExploreView's in-view
  `data-cue-notice` or the bar's failed-chunk notice, else at `centre`, over the device art, whether or not the bar is
  mounted yet, §8.5); the zoom-out's `hideFrame(o)` takes
  m5's order (its ladder steps are no-ops there today, since the view's leave control lies under the ladder sheet's
  inert room; the order keeps any later zoom-out with the sheet open inside the shown-frame test); the state
  gate's view steps record the load hold's `waiting` at the arrival and its `waited` at the chunk write. Lock unchanged
  (11).
- **After:** GM8i; GM7g (`puzzles/registry.ts`, `session.test.ts`, round 5: `puzzles/rules/index.ts`); GM7r
  (`session.ts`, `puzzle-view.svelte.ts`, `PuzzleHost.svelte`, `puzzle-host.svelte.test.ts`, round 5: `reachEdge` and
  `Open.reach`); GM5 (`ExploreView.svelte`, `explore-view.svelte.ts`, `explore.svelte.test.ts`, `yields.ts`); GM2a
  (`PuzzleRun.work`, through GM1b-GM5's chain); never beside per-player GM6c2 (`session.ts`: both edit `#settle`, the
  later lane re-locates) or GM6c4 (`ExploreView.svelte`).
- **Lock (11; round 5 m1 +1):** `client/src/ui/puzzles/PuzzleHost.svelte`, `client/src/ui/puzzle-view.svelte.ts`
  (`PuzzleFrameView.presentation`, `HostPlace`, `coversStage`, `backScreen`, `onwork` / `oncommit` / `ondemo` in
  `forwardHost`), `client/src/puzzles/registry.ts` (`onwork`, `oncommit`, `ondemo`), `client/src/puzzles/rules/index.ts`
  (round 5 m1: `instanceOf`'s `work` branch, `run.work` when the type is 'view' and `workFits` holds),
  `client/src/puzzles/session.ts` (`failLocal`, `#countWrong`; the seed's call site is GM1c's `start`),
  `client/src/puzzles/session.test.ts`, `client/src/app/yields.ts`, `client/src/app/yields.test.ts`,
  `client/src/ui/puzzles/puzzle-host.svelte.test.ts`, `client/src/ui/explore/ExploreView.svelte` (the device slot, the
  ladder sheet, `covered`, the in-room Retry; it reads the `puzzle` / `puzzleActions` props GM3w added),
  `client/src/ui/explore/explore.svelte.test.ts`. No `App.svelte` (GM3w's `coversStage` is the only App seam), no
  `ui/explore-view.svelte.ts` (the props type is GM3w's) and no `cues/stage/motions.ts` (no new key).
- **Commits:** (1) `puzzle-view: coversStage is false for a view frame` (red: GM3w's `f !== null`), `puzzle-view:
  backScreen pushes no overlay for a view frame`; reconcile r2 (RC-W5; design-shots I-7): GM3p's `yields: the host
  hears every change of the shown frame` gains the case "a device view's bar never reports" (`frameShown` reports a
  frame only while `coversStage(frame)` holds, §8.6; red on the parent: `coversStage` is true for a view frame, so a
  `{ id }` at the device view's arrival; green with this commit's `coversStage` change, no `yields.ts` line; then
  **M-RCy**, the `coversStage` test dropped from GM3p's report); (2) `explore: a view frame renders the device inside the room, under
  the explore sheets` (red: no device slot), `explore: the ladder over a device is a sheet and the room is inert under
  it`, `explore: a view frame whose host failed shows Retry in the room`, `puzzle-host: a room-place host offers no
  give-up`; (3) W2's tests (§7.5; red on main's rule at `yields.ts:852-854`); `device: leaving the view closes it with no
  outcome and keeps its work`, `device: Back from a device view leaves in one press`; (4) m9: `yields: a correct
  answer landing after a zoom-out opens the device's lock`, `yields: a story effect during a device POST drops the
  answer`; (5) W2 (round 3): `session: a local wrong input counts one attempt and the limit ends the session failed`
  (a fixture `'local'` type; red: TS2339 `failLocal`), `yields: the third local wrong input ends the device failed and
  fires its onFail` (red on the parent: no end, no `fail:<key>`), `yields: a device's commit part posts through Try`
  (`oncommit`); (6) round 4 W1: `session: a view session starts from its saved work when it fits`, `session: a view
  session ignores a saved work that does not fit`, `yields: re-entering a device view continues from its saved work`,
  `yields: a device's saved work always equals its session's answer` (§7.5; the predicted reds there; round 5 m1: the
  first is red on the parent because GM1c's `start` returns `initial()`, and the `work` branch lands in this commit in
  `puzzles/rules/index.ts`; a green before the branch means the fixture bypassed `PuzzleSessionDeps.types`); (7) m8:
  `yields: a full-length press sequence posts once`, `yields: a full sequence rate-limited posts when the countdown
  ends` (round 6: and the zero emits `puzzle:checking`, no `puzzle:ready`), `yields: a wrong or offline full sequence
  restarts from initial`, `yields: a full-length work seeded at open
  restarts without a post`; round 5 (m7, conditional): **if per-player GM6c2 is merged** (its `value-changed` branch
  is in `yields.ts`), this commit routes that branch to `restartWork` for a `commit: 'full'` type with test `yields: a
  re-drawn value restarts a full sequence` (red: the presses stay); if it is not, nothing here, and GM6c2's cut wires
  it with the same test (E-P12); the cut records which; (8) m7: `yields: a demonstrating device plays
  its order once at open`, `yields: the first input stops the demonstration and a wrong one replays it`, `yields: a
  dropped device leaves no demo timer`; round 5: `yields: onreach stops the demonstration`; (9) m1 and m10: `yields: a
  zoom-out during a device POST hides the device at once and still applies a correct answer`, `puzzle-host: a
  room-place host whose type chunk failed shows Retry in its bar`, `puzzle-host: the room-place bar is anchored to the
  top`; round 6 (m1): `puzzle-host: the room-place bar keeps one button row and clamps its status to two lines`
  (computed `flex-wrap: nowrap` on the button row and the two-line clamp on `[data-cue-status]`; red: neither rule;
  the height itself is GM8d's e2e pin, jsdom has no layout); round 7 (m5): the same test also asserts the inputs of
  the derivation, computed `min-height: 44px` on every bar button and `line-height: 18px` on the status and attempts
  lines (red on the parent: `48px` from the frame's rule and no line height; verify at the cut that the component test
  sees the scoped styles, as round 6's `flex-wrap` assertion already needs; fallback: assert the compiled CSS text of
  the `room` place's rules); round 7 (m4): `puzzle-host: every puzzle cue target resolves in the room-place bar and the
  ladder place` (replaces round 5's `puzzle-host: the room-place bar's status line is a cue target`, which it
  includes; red: no `data-cue-frame` / `data-cue-attempts` in the bar); round 7 (W1): `yields: a view frame's host
  Retry plays no yields control cue` (ExploreView's root emits it; red: two `ui:puzzle-retry`) and the state gate's
  view steps; (10) round 5 (W3): `puzzle-host: a room-place bar shows Try only while a reached answer awaits after an
  offline reply` (red: no Try in the `room` place), `yields: a device's bar Try re-posts its reached work` (red: no
  post), `yields: a mismatch on a device restarts its work` (`restartWork`; red: `run.work` keeps the reached
  configuration) (round 7: round 5's `puzzle-host: the room-place bar's status line is a cue target` is folded into
  commit (9)'s resolve test). Each of (6)-(10) uses a fixture
  type through `types` (`PuzzleSessionDeps.types`, `h.puzzleTypes`, `decodeWorldSource`'s `types`; §7.1, round 5 m1):
  a `view` type with `workFits`, a `commit: 'full'` type, a `demo` type, a `view` reach type whose fixture UI uses
  `reachEdge`; so no real type is needed.
- **Gates:** check, test, build (puzzle-host row vs +0.52, round 7; explore-ui vs +0.1; engine vs its +0.12 share,
  round 9: the narrowing's guard dropped, -0.01; the hide is GM3p's `hideFrame`, called), e2e full
  (unchanged; the hit-testing e2e is GM8d's, on the demo devices, round 4 W2). 11 files, 10 commits: inside the lane
  bound. Round 9 tests in existing commits: (9)'s `yields: a zoom-out during a device POST hides the device at once and
  still applies a correct answer` asserts one `puzzle:closed` at the zoom-out and none when the answer lands
  (**M-R9k**'s twin: the zoom-out without `hideFrame`, red); `yields: every frame's appearance plays one panel-open`
  gains the view frame's arrival (red with round 8's `o.present === 'overlay'` narrowing: none); the resolve test of
  (9) asserts no resolved target matches `[data-cue-root]` in the `room` place. Round 10 tests in existing commits:
  `yields: a frame's appearance is emitted by the write that shows it` gains the session's first device (the bar's
  `panel-open` at the chunk write, red on **M-R10a**); the resolve test of (9) asserts the parts layer carries
  `data-cue-hit` and the bar does not (red: the attribute absent; a bar under it would draw its buttons as ghosts).

### GM8a `mech-levers`
- **Goal:** `levers` (reach, shown target; `solve` by BFS, `witness`, `renderHints` with `[moves]`, W6, m8) and
  `setting` (commit; per-player capable through `domainFits`, R-E2; floor `positions^parts - 1`, m4).
- **After:** GM8h (`registry.ts`, round 5: `rules/index.ts`), GM7g (`arch.test.ts`, `rules.test.ts`,
  `puzzle-types.svelte.test.ts`, `scripts/story/puzzles/index.ts`), GM4g (`build.test.ts`); **per-player GM6k** (round 3
  m1: the server's closed `PuzzleKind` refuses `levers` / `setting` at content load, `server/src/content.rs:394-412`).
  **Beside:** GM9p.
- **Lock (15; round 4: the e2e spec leaves for GM8d, the lint registry joins):**
  `client/src/puzzles/rules/{index,levers,setting}.ts`, `client/src/puzzles/play/{levers,setting}.ts`, new
  `client/src/puzzles/ui/LeverDevice.svelte` (shared by both types through `PUZZLE_UI`), `client/src/puzzles/registry.ts`,
  new `client/scripts/story/puzzles/{levers,setting}.ts`, `client/scripts/story/puzzles/index.ts` (two `PUZZLE_LINTS`
  lines), new `client/scripts/story/puzzles/levers.test.ts` (both types' build tests), `client/scripts/story/build.test.ts`
  (the `[moves]` emit test), `client/src/arch.test.ts`, `client/src/puzzles/rules/rules.test.ts`,
  `client/src/puzzles/ui/puzzle-types.svelte.test.ts`. Round 3: `motions.ts` leaves the lock (`lever`, `setting-*`
  motions and haptics come from the type's `ControlDecl`s).
- **Commits:** `levers: reached on the shown target`, `story: a levers target its throws cannot reach is refused`,
  `levers: the witness is the shortest throw order`, `story: a levers tier 3 without [moves] is refused`, `emit: a
  levers tier 3 renders its throw order in both languages`, `setting: a pull posts one attempt` (through `oncommit`,
  GM8h), `story: maxAttempts on levers is refused`, `story: setting's per-player domain passes the floor only above
  1,000 configurations besides the initial one` (seeded red: 10 positions x 3 parts = 999); round 4: `levers: a throw
  continues from the answer prop` (the UI computes the next configuration from `answer`, never from local state; red: a
  component that keeps its own copy and resets on re-mount), `story: a linear levers yield is refused` (W3's pin through
  a real type: a green means `world/view-type-site` is not wired to `PUZZLE_TYPES`); round 5 (W3): `levers: a
  configuration seeded at the target reports reached once at mount` (`LeverDevice` mounted with `answer` = the target:
  one `onreach`; red: a component that reports only from its throw handler), `levers: canonical is the configuration
  itself` (so `run.work` stays the session's answer), `story: a levers target equal to its start is refused`. The device e2e (throw the levers,
  the in-view taps with **M-W1a** / **M-W1c**, the re-entry) move to **GM8d** (round 4 W2), which has the content.
- **Gates:** check, test, story, build (type row), e2e full (unchanged).

### GM8b `mech-sequence`
- **Goal:** `sequence` (reach, the device plays its order: `demo(p) = p.order`, round 4 m7) and `ritual` (commit, I4;
  `commit: 'full'`, round 4 m8); `push` fires on `pointerdown` (the first real `pointerdown` control: M-I5g seen red on
  it); the replay control `sequence-replay`.
- **After:** GM8a (every shared file of its lock); per-player GM6k. **Beside:** GM9p.
- **Lock (15; round 3 m3, exact; round 4: the e2e spec leaves for GM8d, the lint registry joins):**
  `client/src/puzzles/rules/{index,sequence,ritual}.ts`, `client/src/puzzles/play/{sequence,ritual}.ts`, new
  `client/src/puzzles/ui/ButtonDevice.svelte` (shared by both types), `client/src/puzzles/registry.ts`, new
  `client/scripts/story/puzzles/{sequence,ritual}.ts`, `client/scripts/story/puzzles/index.ts` (two `PUZZLE_LINTS`
  lines), new `client/scripts/story/puzzles/sequence.test.ts` (both types' build tests),
  `client/scripts/story/build.test.ts`, `client/src/arch.test.ts`, `client/src/puzzles/rules/rules.test.ts`,
  `client/src/puzzles/ui/puzzle-types.svelte.test.ts`. No scan-dist file and no `motions.ts`.
- **Commits:** `sequence: a wrong press resets locally and counts one attempt` (m6, through GM8h's `failLocal`),
  `sequence: three wrong rings jam the bell` (round 3 W2: `maxAttempts: 3`, the run ends `failed`, `fired` holds
  `fail:<key>`; red if `sequence.wrong` is not `'local'`; a component test with the session fake, the e2e is GM8d's),
  round 4: `sequence: the device demonstrates its order` (red: `demo` absent, no `puzzle:demo` cue through GM8h's
  runner), `puzzles: the replay control asks for the demonstration` (`ui:sequence-replay` then `ondemo`), `ritual:
  the attempt posts at full length with no per-press feedback` (red: a POST per press; round 4: yields posts it through
  `commit: 'full'`, the UI never calls `oncommit`), `story: sequence hints are refused`,
  `emit: a ritual's solution reaches only the server content` (round 3 m3, replacing round 2's scan test: a ritual
  fixture world; the public world has no `solution` key and no planned `client/` output holds the order's JSON text,
  while `server/content/puzzles/<ch>.json` does, the control; the guarantee is the strip plus `decodeWorldPublic`'s
  refusal of `solution`, `world/decode.ts:80`; scan-dist's needles are hint texts, paid-world texts and canaries,
  `client/scripts/scan-dist.ts:41-70`, and a short number array would false-positive in minified JS), `ritual:
  domainFits sizes the domain as parts^length with nothing excluded` (m7; a unit test of the type's build lint, so it
  needs no per-player lane in the tree; per-player's `world/entropy-floor` then refuses 3 parts x 6 = 729), `puzzles: a
  push button emits its cue on pointerdown` (M-I5g), cues; round 5 (W3): `sequence: a full sequence seeded at mount
  reports reached once` (`ButtonDevice` mounted with `answer` = the order: one `onreach`; red: a component that
  reports only from its press handler), `sequence: canonical is the press list itself`. The e2e `mechanics: three wrong rings jam the bell` moves to
  GM8d (round 4 W2).
- **Gates:** check, test, story, build (type row), e2e full (unchanged).

### GM8d `mech-type-demos` (new in round 4; critique_engine_r3 W2)
- **Goal:** one demo puzzle of each new type in the shipped placeholder story, and every real-layout e2e of those
  types, so each gate whose proof needs a real device in a real room is seen red on its named mutation. Content
  (`narrative-designer` role, one writer pass): «Прилив» ch3 gains its first world, one section `beacon`.
  **Where it sits (round 5, W1: off the paywall e2e's path).** `client/e2e/stories.spec.ts:89-104` plays the tide story
  to `ch3.lighthouse_stairs.t011` with the picks `{ 'ch3.shore.c001': 1 }` (`:99`), taps once and expects ch4's paywall
  with no refused request (`:100-103`); `reachLine` answers every other choice set with option 0
  (`client/e2e/helpers.ts:309-310`, `:318`) and throws at a yield (`:310-311`). **Round 6 (critique_engine_r5 W2):
  every join is a knot top.** A divert from another knot into a labelled gather (round 5's `-> lighthouse_stairs.radio`)
  is `graph/entry-below-top` (E; `client/scripts/story/graph.ts:286-302`, `:553-556`, `lint.ts:55`; STAGING-DSL §10,
  `docs/STAGING-DSL.md:485`), because a knot's opening tag lines must run on every entry. So the new content is:
  - **`lighthouse_stairs`** keeps its header, its opening `# show: keeper neutral at=center` (`story/ch3/main.ink:62`)
    and `t001`-`t007` with the `# show: keeper worried` line (`:63-73`) unchanged, and ends with one new choice set
    after `t007`: **option 0** `* [<stay at the radio> #id:<new>] -> lighthouse_radio` (listed first: the option
    `reachLine` picks by default, so today's path), **option 1** `* [<go up to the lamp> #id:<new>] -> beacon_enter`
    (a divert is the only thing a choice line may carry after `]`, `docs/STAGING-DSL.md:117`).
  - **`lighthouse_radio`** (new knot): opening tag lines `# scene: lighthouse` and `# show: keeper worried at=center`
    (the stage `t007` shows: `:32`, `:62`, `:72`), then **`t008`-`t011` and `-> END` moved here from
    `lighthouse_stairs` with their text and IDs unchanged** (STAGING-DSL §4: "moving a line to another knot keeps its
    ID; the lint does not compare it with the current knot", `docs/STAGING-DSL.md:169`; the knot part of an ID is a
    readability hint, `:158`). Both branches enter it at its top, so both reach `t008` on the same stage whatever the
    section left on screen (a `scene` clears it all, `:514`), and a resume after a story update restarts it with that
    stage. Precedent: ch1's leave knot opens the same way (`story/ch1/main.ink:74-76`). It is now the chapter's
    `ending` knot (it writes `-> END`, `docs/STAGING-DSL.md:487`); so for a player who owns ch4 its first knot's
    preload starts at `lighthouse_radio`'s entry instead of `lighthouse_stairs`', seven lines and one choice later (a
    stated cost: less lead time for that preload), is released while the player is in `beacon` and requested again on
    the return (`:501-506`); in the spec ch4 is paid and unowned, so nothing is preloaded either way.
  - **`beacon_enter`** (new): a few lines, then `# explore: beacon` and `-> DONE` (ch1's yield pattern,
    `story/ch1/main.ink:48-49`); the section's exit hotspot leads (`"to": { "story": "beacon_out" }`) to **`beacon_out`**
    (new): a few lines of the keeper's dialogue, then `-> lighthouse_radio`. Neither beacon knot names a `bgm`, so
    `waves` (`:6`) plays through both branches. A writer's constraint, not a gate: `beacon_out` must lead into `t008`
    as written («В темноте зашипела рация…», `:74`), since `t008`-`t011` cannot change.
  **Invariant (restated):** no existing line changes text or ID; `t008`-`t011` move into `lighthouse_radio` and their
  en entries stay byte-identical; `stories.spec.ts`'s target `ch3.lighthouse_stairs.t011` is unchanged (`reachLine`
  matches `data-line-id`, `client/e2e/helpers.ts:278`, `:324`, not a knot). **The verify item is replaced by the gate it
  must pass:** commit (1)'s `npm run story` reports no `graph/entry-below-top`, seen red at the cut on the mutation
  "`beacon_out` diverts `-> lighthouse_stairs.radio`" (round 5's join), then reverted. The invariant **"the paywall e2e
  path never yields into `beacon`"** is enforced by `stories.spec.ts` itself, which stays byte-identical outside this
  lock and runs in this lane's `e2e full`.
  Rooms on existing placeholder bgs (`lighthouse`, `lamp_room`, `assets/catalog.json:11-12`) plus **one new bg
  `fog_gallery`** (round 5 m8; used by the fog bells' view only, so the wait e2e has a bg no other room keeps
  resident): a fuse box (`path`, overlay, on an `object` lock), a signal chart (`grid`, overlay), the
  lamp cabinet (a view with a `levers` device), the radio dial (a view with a `setting` device whose clue is a log
  page), the fog bells (a view with a `sequence` device, `maxAttempts: 3`, and a decor `{ failed }` state) and the
  shrine bells (a view with a `ritual` device whose clue is the keeper's song in a document). Every device puzzle has
  `"closeup": null` (round 5 W2) and its parts inside the safe frame below the 496 px band (round 5 m5; round 6 m1:
  the three-row bar). Device parts
  are decor with two placeholder prop states each (new catalog entries `lever_up`, `lever_down`, `bell`, `bell_lit`,
  `dial_mark`, placeholders by hue as today, `assets/catalog.json:56-60`). If `world/state-cap` refuses one section,
  the writer splits it in two (authoring; P2's measured factors). Owner question Q15g (default: yes, here, as the
  optional lamp branch).
- **After:** GM8b (every type in the tree), GM5 (the e2e spec's last holder before it among the engine lanes; GM8a /
  GM8b no longer hold it); per-player GM6k (server content accepts the types) and GM6s1 (a grid of 25 cells, if the
  writer uses one; else 16). **Before:** GM9r (`client/e2e/mechanics.spec.ts`). **Beside:** GM9p (disjoint).
- **Lock (6):** new `story/ch3/world.json`, `story/ch3/main.ink` (the choice set, the new knot `lighthouse_radio` with
  `t008`-`t011` moved into it, `beacon_enter`, `beacon_out`; round 6: no gather label; new line IDs by the story tool),
  `story/locales/en/ch3.json` (the en of every new world text and line),
  `assets/catalog.json` (the placeholder props and, round 5 m8, the bg `fog_gallery`), `client/e2e/mechanics.spec.ts`,
  `client/e2e/helpers.ts` (the world readers take a chapter: `worldOf(ch)` beside `ch1World`, `helpers.ts:366-369`;
  `hotspotLabel`, `puzzleTitle` gain an optional chapter; a new `enterBeacon(page)` after `enterManor`, `:509`, =
  `reachLine` to `beacon_enter`'s last line with `{ 'ch3.shore.c001': 1, <the new set's first option id>: 1 }`, then
  one tap). **Pin outside the lock:** `client/e2e/stories.spec.ts` byte-identical and green (W1). **Reconcile r1
  (design-shots I-15, adopted):** ch3 stays a legacy chapter (sprites) until SH11, so `lighthouse_radio`'s `# show:
  keeper worried at=center` is valid at this lane's cut; its rooms on `lighthouse`, `lamp_room` and `fog_gallery` are
  implied room shots (no `story/shots.json` edit, `shot/undeclared` warns only); SH11 restages ch3 after this lane with
  line IDs untouched, and `stories.spec.ts` stays this lane's byte-identical pin. Lock unchanged (6).
- **Commits:** (1) the story commit; `npm run story` 0 errors (every lint of every type green on real content, the
  state cap, `world/device-closeup` and the parts' band included; round 6 W2: no `graph/entry-below-top`, seen red on
  the round-5 dotted divert, then reverted; `world/text-unwalked` and the en checks over the section's texts);
  round 5 (W1): `stories: second story first chapter free then paywall` green on the new content (seen red on the
  mutation "the new set's two options swapped": `reachLine` meets the `beacon` yield and throws), then reverted; (2) e2e, each seen red on the named mutation applied on the
  lane's tree and reverted:
  `mechanics: draw the fuse path` (a Playwright pointer stroke; **M-I5h** re-applied: no `ui:path-stroke` key),
  `mechanics: fill the signal chart`, `mechanics: throw the levers to the drawn pattern`, `mechanics: inside a device
  view the hotspots, the ribbon, the leave control and the inventory answer` (tap the other hotspot -> its look toast;
  tap a ribbon item -> `ui-state:select` in `data-cues-played`; tap Inventory -> the sheet is on top and the device under
  it is inert; Back -> the device is still open; the leave control -> the room is `of`; seen red on **M-W1a**
  (`coversStage` back to `f !== null`: the room layer is inert) and **M-W1c** (the host mounted in App's frame layer:
  the Inventory tap lands on the wrapper)), `mechanics: a device keeps its levers across a zoom-out and a reload` (W1:
  throw two, leave, re-enter, the third throw moves only its own lever; reload, the same; red on the mutation
  "`PuzzleInstance.start` returns `initial()`"), `mechanics: the fog bells play their order and three wrong rings jam
  them` (`puzzle:demo` keys, then the jam and the `{ failed }` decor), `mechanics: the shrine bells post at full length,
  and a rate-limited sequence posts when the countdown ends` (`page.route` answers the first attempt 429 with
  `Retry-After: 2`; red on the mutation "the countdown's end does not post"), `mechanics: Hint in a device view opens the
  ladder over the device` (m10: the top bar's Hint is tappable; red on the mutation "the bar anchored to the bottom"),
  `mechanics: a move that waits on its picture holds a motion` (**M-R4b**; round 5 m8: `holdRequests` on
  `fog_gallery`'s file from before `enterBeacon`, released 1.5 s after the tap on the fog bells' exit; the test also
  asserts the move's key is played only after the release); round 5 (W3): `mechanics: a last ring answered offline
  posts again from the bar` (`page.route` aborts the first `POST /api/puzzles/{id}/attempts`,
  `client/src/api/endpoints.ts:108`; the bar shows `offline` and Try; Try -> the bells open; **M-R5b**: the bar never
  shows Try -> red), `mechanics: after a reload the reached bells post at open` (the first attempt aborted, the
  autosave's PUT awaited, then a reload and re-entry: the device posts at once and opens; **M-R5a** re-applied: never
  posts -> red); round 5 (m5): `mechanics: the device bar is no taller than its lint's bound` (the bar's
  `getBoundingClientRect().height` <= `DEVICE_BAR_CSS_H`, read from `client/scripts/story/mechanics/devices.ts`; red on
  the mutation "the bar's padding 6 -> 16 px", 138 > 120); round 6 (m1): it runs at `page.setViewportSize({ width:
  320, height: 569 })`, the derivation's own width, on the fog bells after an aborted last ring (title, Try, the
  two-line `offline` status, the attempts line: the bar's fullest state among the demo devices), and also asserts
  that the bar's bottom lies above every part's top in CSS px (the band's purpose, measured). Each test uses its own uid, so the jam and the offline tests on the
  fog bells never share a run.
- **Gates:** check, test, story, build (the ch3 world rows and room-set rows MEASURED, `fog_gallery` included), e2e
  full (`stories.spec.ts` among them, W1's pin). 6 files, 2 commits plus the W1 mutation check.
- **Conflicts:** `story/ch3/*` and `story/locales/en/ch3.json`: no other lane of either design holds them (verify
  per-player's GM6c3 / GM6c4 locks at the cut); `assets/catalog.json`: GM3b before it (round 5 m2), the adopted shot or
  animation lanes that hold it, by launch, never beside; `client/e2e/helpers.ts`: GM2a, then per-player GM6c4 / GM6d2
  by launch, never beside; `client/e2e/stories.spec.ts`: no lane of this design edits it (round 5 W1); a lane that
  ever puts `beacon` on the main path (owner Q15g's alternative) must hold it and add a helper that solves the section.

### GM9p `mech-carry-proof`
- **Goal:** §6.6 build half. Round 5 (per-player R-E22): the cross-chapter proof runs from `client/scripts/story.ts`,
  so its codes register as a `runsFrom: 'story'` entry of `MECHANIC_LINTS` (§3.2); a per-world carry rule, if any (an
  item text's placeholder, `world/carry-text-placeholder`), is a second, per-world entry of the same file with
  disjoint codes.
- **After:** **GM8i** (round 3 m1: `mechanics/data/index.ts` and `scripts/story/mechanics/index.ts`, whose last holder
  before it is GM8i), GM2b (`world.test.ts`), GM1a (`softlock.ts`); round 4: no `lint.ts` (its `world/carry-*` codes
  are `carry.ts`'s own, §3.2). **Beside:** GM8a, GM8b, GM8d.
  **Lock (10; round 4 -1):** new `story/items.json` (the format; no demo entry), new
  `client/src/mechanics/data/carry.ts` (decode only), `client/src/mechanics/data/index.ts`, new
  `client/scripts/story/mechanics/carry.ts`, `client/scripts/story/mechanics/index.ts`, `client/scripts/story/graph.ts`
  (`mustPass`, exported, per-player R-E13), `client/scripts/story/softlock.ts` (starts, leave check),
  `client/scripts/story/{world,softlock}.test.ts`, `client/scripts/story.ts` (cross-chapter pass; re-located at the
  cut). **No story file:** the demo required item lands in GM9r (C1).
- **Commits:** `carry: a continuing END reachable without the giver yield is refused`, `carry: a story ending reachable
  before the giver is allowed` (m5; red on round 1's rule), `carry: a giver yield after a choice is refused`, `carry: a
  section leave without the item is refused`, `carry: a required item consumable later is refused`, `carry: a paid
  giver into a free chapter is refused`, `carry: an item text with another chapter's placeholder is refused`,
  `softlock: optional carried items prove 2^k starts`; each on a seeded fixture world, seen red.

### GM9r `mech-carry-runtime`
- **Goal:** §6.6 runtime (C1): the builder, the receiver, every start path, the every-resume re-arm, the chapter-start
  cues, then the demo content.
- **After:** GM9p, the adopted animation / shot lanes that hold `app/game.ts` (rev. 3: MD2, MA1a, MA1b; §12
  "Animation and shot lanes", RULINGS 132; reconcile r1: **SH1, SH5a, SH5b, SH7**, design-shots I-2's "MA1 reads
  SH7"), per-player GM6c2 / GM6c3 / GM6d1 (also `game.ts`; per-player.md's chain
  ends with GM9r; never two at once); GM8h (`yields.ts` chain); **GM8d** (`client/e2e/mechanics.spec.ts`, round 4);
  GM4u (`story/ch1/world.json`); GM2a (`resume.ts`, `resume.test.ts`). The carry motion is GM3m's `byCause.carry`
  (round 3 m4), so no cue-stage file is in this lock.
- **Lock (14; round 5 m2 +2: `story/locales/en/ch1.json` and `story/locales/en/ch2.json`, the en of the carried
  item's `name` / `desc`, `story/ch2/world.json:3` holds no item today, and of any new hotspot label):**
  `client/src/mechanics/data/carry.ts` (`carriedOut`, `chapterStartWorld`, `rearmCarried`),
  `client/src/app/game.ts` (`beginChapter` / `enterChapter` signature `:824-871`, `chapterEnd` `:1158` and the pending body
  `:1171-1184`, `startPending` `:1088`, the new-game call `:1484`), `client/src/app/yields.ts` (`chapterChanged(start)`
  `:831-835`; the first room batch's carry cues), `client/src/story/resume.ts` (`:71-78`, `:94-101`),
  `client/src/app/game.test.ts`, `client/src/app/yields.test.ts`, `client/src/story/resume.test.ts`,
  `client/e2e/mechanics.spec.ts`, `story/items.json`, `story/ch1/world.json`, `story/ch2/world.json` (the demo
  required item; narrative-designer, after the runtime commits), `story/locales/en/ch1.json`,
  `story/locales/en/ch2.json` (round 5), `client/src/mechanics/carry.test.ts` (new).
- **Commits:** (1) `carry: the start world holds the required items and the carried optional ones` (red: TS2305
  `chapterStartWorld`); (2) the start paths: the four `game:` tests of §6.6 (red on main: `held` is `[]`);
  (3) `resume: a chapter-start resume starts with the carried and required items`, `resume: a same-version save
  without a required item regains it` (red: `reconcile.ts:298-300` returns early); (4) `yields: the chapter's first room
  batch flies the carried items in`; (5) the demo content + e2e `mechanics: a key carried from ch1 opens ch2's door`.
- **Gates:** check, test, story (the proof green on the demo), build, e2e full.
