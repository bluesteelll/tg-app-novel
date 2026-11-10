### 8.2 I5: every UI interaction, and its mechanism

| Control (today, `file:line`) | Control cue | State / outcome cues it causes |
|---|---|---|
| hotspot button, `ui/explore/ExploreView.svelte:44-60` (`onclick` `:55`) | `ui:hotspot` (round 10: a hit area, `data-cue-hit`, so its `press` plays on its painted ghost, §8.5 "Hit areas") | the tap's fact / module / move cues |
| bar Inventory, `ExploreView.svelte:63` | `ui:bar-inventory` | `ui-state:panel-open` (inventory) |
| bar Reveal, `ExploreView.svelte:64` (Q17, free) | `ui:bar-reveal` | `ui-state:reveal` (outlines draw in, hold `REVEAL_MS`, fade; `controller.ts:22`, `:376-388`) |
| inventory tabs, `ui/explore/Inventory.svelte:19`, `:22` | `ui:inventory-tab` | `ui-state:tab` |
| inventory document, `Inventory.svelte:48` | `ui:inventory-doc` | `ui-state:panel-open` (document) |
| reader close, `ui/explore/DocumentReader.svelte:18` | `ui:doc-close` | `ui-state:panel-close` |
| lock panel item, `ui/explore/LockPanel.svelte:42` | `ui:lock-item` | `fact:slot:added` or `module:core:refused` |
| dial up / down, `puzzles/ui/CodeLock.svelte:33`, `:37` | `ui:dial-up` / `ui:dial-down` (index) | `puzzle:input` (index) |
| order slot, `puzzles/ui/OrderPuzzle.svelte:69` | `ui:order-slot` (index) | `puzzle:input` on a swap |
| chunk retry, `ui/puzzles/PuzzleHost.svelte:73` | `ui:puzzle-retry` | round 7 (W1): the notice stays with Retry disabled (round 8: `retrying`, never `busy`) and `ui-state:waiting` (`panel: 'puzzle'`) holds past 120 ms; then `ui-state:waited` and `puzzle:opened` when the UI loads, or `puzzle:load-failed` again |
| (round 7, W1) App's host-chunk Retry, `ui/App.svelte:111` (outside every cue root) | `ui:puzzle-retry`, emitted by yields' `onretry` while `puzzle.host === null` (GM3p; GM8h: and the frame is an overlay) | as the chunk retry above |
| (round 7, W1) no control: the type or host chunk fails (`yields.ts:520`) | none | `puzzle:load-failed` (`wobble` on the notice as it and Retry appear) |
| Try, `PuzzleHost.svelte:86`; round 5 (W3): the same control in the device bar, shown while a reach device's reached answer awaits after an offline reply | `ui:puzzle-try` | `puzzle:checking` (from `post(o)`, round 8; round 11: its `breathe` loops until the reply's settling or end key, §8.1 point 11), then `wrong` (`attempted`, `yields.ts:644-647`) or, for an answer that ends the session, `solved` / `failed` (round 8, m1: from `dropPuzzle`, called by `onEnd`, `yields.ts:544-548`, before the frame clears; `attempted` never sees an ending answer), `renewed` (per-player), and round 5 `offline` / `rate-limited` (one per countdown second) or, for a reach type, `mismatch`'s `reset`; round 6: a reply with no outcome (round 7: `closed` / `invalid`) -> `puzzle:ready`, or `puzzle:renewed` instead when the pass carries a per-player run change (R-E27 (d)); round 7 (m3): a `busy` reply -> none (the attempt in flight answers) |
| Hint, `PuzzleHost.svelte:88` | `ui:puzzle-hint` | `ui-state:panel-open` (hints) and `ui-state:waiting` (`panel: 'hints'`, a held `breathe` on the ladder past 120 ms); round 7 (W1): when the status answers, `ui-state:waited` + `puzzle:ladder`; when it fails, `ui-state:waited` + `puzzle:hint-failed`; round 8 (W2): a repeat tap over a failed ladder keeps the alert through the wait (no `panel-open`: the sheet is already up), and the answer clears it with `puzzle:ladder` or wobbles it again with `puzzle:hint-failed` |
| give-up ask / no / yes, `PuzzleHost.svelte:103`, `:96`, `:99` | `ui:give-up-ask` / `-no` / `-yes` | yes: `puzzle:closed` (round 8, m1: the frame irises out as it leaves, from `dropPuzzle`), then `fact:abandoned:added` |
| (round 8, m1) no control: a frame leaves with no outcome (another puzzle opens, a save loads, the chapter changes) | none | `puzzle:closed` from `dropPuzzle` (round 9: and nothing else: the screens diff speaks for no `puzzle` frame; a running Retry hold ends first with `ui-state:waited`, m2) |
| (round 8, found; round 9, m4: every frame) no control: a frame appears (a `# puzzle:` yield, a lock tap's puzzle, a device view's arrival) | none | `ui-state:panel-open` (`panel: 'puzzle'`) from yields at the write that shows the frame (round 10, W1: the frame write when the host chunk is in, else the chunk write), for every frame; `puzzle:opened` when its type UI arrives |
| (round 10, W1; round 11, critique_engine_r10 W1) no control: an open frame waits for its chunks or changes before it first shows (per-player's values wait; a Back, a save load or a chapter change before the host chunk lands) | none | the frame's load hold: `ui-state:waiting` from the frame write (`panel: 'puzzle'`, a held `breathe` ring at `centre` past 120 ms), `ui-state:waited` at the show, a chunk failure or any end (§8.1 point 11); every other cue of the frame is dropped by the shown-frame test, since nothing of the frame is on screen (`App.svelte:103-115`); the frame appears in its current state with `panel-open`; a close-up's fade is the scene's |
| (round 11, found) no control: an overlay puzzle's close-up loads before its frame (`yields.ts:587-592`) | the tap's own `ui:hotspot` | `ui-state:waiting` (`panel: null`, at `centre`) past 120 ms, `ui-state:waited` at the close-up batch's `started`, then the close-up's fade (the scene's); round 12: emitted by `held`, the close-up's batch site |
| (round 12, critique_engine_r11 W1) no control: a state change shows a picture that is not resident yet (GM3b's state batch: a drawer opened by its code, a statue turned to a facing not yet shown, a lever's or a door's state image) | the act's own cue (`puzzle:solved`, `fact:open:added`, a module's cue) | `ui-state:waiting` (`panel: null`, a held `breathe` ring at the box of the first changed anchor that draws an image; round 13, critique_engine_r12 m1) past 120 ms, `ui-state:waited` at the state batch's `started`, then the props' crossfade (`TAKE_FADE_MS`, the scene's); with the image preloaded under `state:<room>` and kept while the room is in the keep set (§6.4; round 13, W2) the loads end in a microtask and only the crossfade plays; a state change whose changed anchors draw no image (a take's emptied anchor) opens no hold and plays its crossfade (round 14, critique_engine_r13 m3: unless a revive runs, when it holds at `centre` until its batch starts, §6.4; reconcile r1, RULINGS 152 Q14 (a): or while any record is stale, `stats().stale > 0`) |
| (round 11, found) no control: a section's first entry waits for the explore chunk (`yields.ts:450`) | none (a story step's yield) | `ui-state:waiting` / `waited` (`panel: null`, at `centre`), then the room batch's own cues |
| hint use, `ui/puzzles/HintLadder.svelte:49` | `ui:hint-use` (index = tier) | round 7 (W1): `ui-state:waiting` (`panel: 'hints'`) while the POST is in flight; answered: `ui-state:waited`, `puzzle:hint-shown`, `puzzle:ladder`, `fact:hint:added`; `failed`: `ui-state:waited`, `puzzle:hint-failed` (tier); `insufficient` / `unavailable` / `locked` / `no-port` / `closed`: `ui-state:waited`, `puzzle:ladder`; `busy`: none (the use in flight answers) |
| (round 7, W1) no control: the wallet changes under an open ladder (a pack bought over it) | none | `puzzle:ladder` at the screens change that re-reads it (`yields.ts:858-860`) |
| (round 7, W1) Back while the ladder's request is in flight | none of its own | `ui-state:panel-close` (hints) and `ui-state:waited` (the hold ends with the sheet) |
| get more, `HintLadder.svelte:57` | `ui:hint-more` | the wallet overlay's own motion (meta, overlay half) |
| new: ribbon item (GM3u) | `ui:ribbon-item` (item; `click`) | `ui-state:select` / `deselect`; `combine` cues |
| new: bare art catcher (GM3u) | `ui:bare-art` (point; `click`) | `ui-state:deselect` when an item was selected |
| new: view bar leave control (GM4u) | `ui:view-leave` (`click`) | `move:zoom-out` |
| new per type, each with its trigger (W5; declared in the type's data half `controls`): `path-cell` (`click`, tap-by-tap), `path-stroke` (**gesture**: one cue per cell the stroke enters), `grid-cell`, `grid-symbol` (`click`), `lever` (`click`: a tap throws), `setting-part`, `setting-pull` (`click`), `push` (`pointerdown`: the button sinks at touch, `sequence` / `ritual`), `sequence-replay` (`click`, round 4 m7: play the order again); the device bar (inside the room, round 3 W1; at the top, round 4 m10) reuses `puzzle-hint`, after a failed host or type chunk `puzzle-retry`, and (round 5 W3) `puzzle-try` while a reach device's reached answer awaits after an offline reply; it has no give-up (m10) | `ui:<name>` (index) | `puzzle:input` / `puzzle:blocked` (a refused cell, a press on a full or busy sequence), `fact:work:added`, `reached`, `wrong`, `reset`; a wrong ring: `fact:attempt:added` and at the limit `fact:failed:added` (W2); `sequence-replay`: `puzzle:demo` per step; a full `ritual`: `puzzle:checking` then the outcome (round 4 m8) |
| (round 4) no control: a device demonstrating its order (at open, after a wrong ring) | none (not an input) | `puzzle:demo` per step (m7) |
| (round 5, W3) no control: a device seeded at a reached `work` posts at open | none (not an input) | `puzzle:checking`, then the outcome |
| (round 5) no control: a 429 countdown ticks; a `network` reply arrives | none | `puzzle:rate-limited` per second (`roll` of the number); `puzzle:offline` (`wobble` on the status line) |
| (round 6, W3) no control: the countdown reaches zero; per-player's values land in an open frame | none | `puzzle:checking` when the zero re-posts (reach, `commit: 'full'`), else `puzzle:ready` (`glint` over the frame as the status clears and Try lights); per-player's values: `puzzle:ready` (R-E26), also when they fail under a waiting frame (round 7, R-E27 (c)); a pass with a per-player run change: `puzzle:renewed` instead of `puzzle:ready` (R-E27 (d)) |
| (round 4) no control: a move waiting on its bg load | the tap's own `ui:hotspot` / `ui:view-leave` | `ui-state:waiting` (a held motion past 120 ms), `ui-state:waited`, then the `move:*` cue with the crossfade (m11) |
| Telegram BackButton (screens stack) | none of its own | `ui-state:panel-close` (an explore sheet or the ladder) or a `move` (zoom-out, walk): the outcome is the motion; round 9 (critique_engine_r8 m1): a Back that closes an explore frame (X8) plays `puzzle:closed` **at once** from `hideFrame`, also over an attempt in flight (the session's close stays deferred, `session.ts:398-400`, and its decisive answer opens the lock in the room with the world's cue); the diff plays no `panel-close` for the frame |

Only `path-stroke` is a drag. A drag fires no `click` on the cells it crosses, which is why gestures emit per step
through `oncue` and never through the root listener (W5).

- **Outside this mechanism:** the dialogue box, choices, story menus, Home and the meta overlays (`ui/*.svelte`,
  `ui/meta/**`). **They have no planned owner today (m7):** RULINGS 116 and 124 plan only the character and room halves
  of `design-animation`; "overlay half" exists only in the mechanics documents. Orchestrator Q4 asks for a ruling; this
  file's `data-cue` gate (§8.3) and motion gate (§8.5) are the proposed enforcement for those directories.

### 8.3 The mechanism (GM3m, GM3s, GM3u, GM3p)

- **Declaration:** every element with an event attribute (`onclick`, `onpointerdown`, `onpointerup`, `onpointermove`,
  `onkeydown`, `oninput`, `onchange`) in a scanned Svelte file carries either `data-cue="<a ControlCue literal>"` with
  `data-cue-on="<a CueTrigger>"` (omitted = `click`), plus `data-cue-index` / `data-cue-item` where the cue has them, or
  `data-cue-gesture="<a GestureCue literal>"` (a gesture surface: the element whose pointer handlers track a stroke).
  The declared trigger must be one of the element's own handler events: a `data-cue` element with only
  `onpointerdown` and no `data-cue-on="pointerdown"` is refused (W5). Components (capitalised tags) are not elements;
  their own files are scanned. **Hit areas (round 10, the critic's `hotspot` question):** an element that only makes a
  touch target over the art and paints nothing carries `data-cue-hit` as well: ExploreView's hotspot buttons
  (`ExploreView.svelte:96-112`: transparent, no border) and the bare-art catcher (GM3u), and a device's parts layer in
  the room place (GM8h; its parts are hit areas over the device art); its element-site motions play on a painted ghost
  (§8.5 "Hit areas"). GM3u's parse test `explore: every hit area is marked` and GM8h's room-place resolve test pin the
  markers.
- **Gate** `explore: every control declares its cue` / `puzzles: every control declares its cue`
  (`client/src/cues/controls.test.ts`, new): parses each `.svelte` under the scanned directories with
  `svelte/compiler` `parse(src, { modern: true })` (verify: the Svelte 5 modern AST's `RegularElement.attributes` shape
  at the GM3u cut; fallback: the markup regex style of `arch.test.ts:188`). Non-vacuous: it asserts the scanned file
  set equals **`LAZY_COMPONENTS` (`arch.test.ts:892-901`) restricted to `ui/explore/**`, `ui/puzzles/**` and
  `puzzles/ui/**`** (round 4 m3: GM3s adds `cues/stage/CueStage.svelte` to `LAZY_COMPONENTS`, an `aria-hidden`,
  `pointer-events: none` layer with no control, outside the three directories), and that >= 1 control per scanned file
  is found.
  Changed by RULINGS 226, 230 (as of `0b91acc`; docs lane `docs-errata-15`, group A): the layer matches this paragraph as merged: GM3s
  shipped it `inert` only, and GM3u (`33b4f8d`, its cut Q3 (A)) added `aria-hidden="true"`
  (`client/src/cues/stage/CueStage.svelte:31`: `inert aria-hidden="true"`), so a ghost clone of a hotspot is hidden from
  every role locator (Q62's root fix; pinned by `cues: the stage layer is hidden from the accessibility tree`).
  Named mutation **M-I5c**: drop `data-cue` from `LockPanel.svelte:42` -> red. **Parts (round 7, critique_engine_r6
  m4):** the puzzles gate also requires every type UI under `puzzles/ui/**` to mark each part with
  `data-cue-part="<i>"` (a dial's digit, an order slot, a path or grid cell, a lever, a bell, a setting part): the
  element a `part` motion plays on, distinct from its controls' `data-cue-index` (a dial's up and down buttons share
  the dial's index, so `[data-cue-index=2]` resolved the first button, never the digit); `puzzles: every type UI marks
  its parts` (GM3p; seen red by deleting `data-cue-part` from `CodeLock.svelte`; each later type lane meets it red
  until its parts are marked). **Gesture surfaces (m13, round 3):** the
  same gate refuses a `data-cue-gesture` element without `style:touch-action="none"` (`puzzles: every gesture surface
  disables touch panning`; landed with GM3u on a fixture surface, seen red in GM7p by deleting it from
  `PathPuzzle.svelte`).
- **Emission:** one `use:cueRoot={emit}` action per family root (the ExploreView `.layer` and the PuzzleHost root;
  `cues/root.ts`, round 3 m11) adds one capture-phase listener **per `CUE_TRIGGERS` kind**; on an event it takes
  `el = target.closest('[data-cue]')` inside the root and emits only when `event.type === (el.dataset.cueOn ??
  'click')`, so each control emits once, on its own trigger, before its handler's outcome cues; keyboard activation of a
  `click` control fires `click`. **Nested roots (round 3):** each root carries `data-cue-root`, and a listener emits only
  when `target.closest('[data-cue-root]')` is its own root, so a device host inside the room (W1, §7.5) emits each
  control once, from the innermost root (test `cues: a control inside two nested roots emits once`, GM3s; mutation
  **M-I5j**: drop the check -> two cues). Gesture steps are emitted by the type UI through `oncue(name, index)`
  (PuzzleUiProps) per accepted or refused step; a refused step also yields `puzzle:blocked`. Listeners are added on
  mount and removed by the action's `destroy`.
  Changed by RULINGS 201 (as of `461424d`; docs lane `docs-errata-13`, group A): **E1** as merged (GM3s `65e10ad`):
  no `use:` action; an `$effect` on the bound root (`bind:this`) calls `cueRoot` and returns its `destroy`
  (`client/src/ui/explore/ExploreView.svelte:33-45`), a second `$effect` passes the emit through `update` (`:46-50`);
  arch rule `svelte-action` forbids `use:` (entry -219, first line -252 MEASURED). **E2:** `cues/root.ts` keeps its own
  trigger tuple `ROOT_TRIGGERS`, tied to `CUE_TRIGGERS` by a type equality and a runtime pin (`client/src/cues/root.ts:21`;
  explore-ui -190, cue-stage -109, one request fewer). GM3p's frame root attaches the same way.
- **Gesture input (m13, principle 5).** ExploreView's buttons use `touch-action: manipulation`
  (`ExploreView.svelte:110`), which lets the WebView start a pan and fire `pointercancel` mid-stroke on Android and iOS;
  desktop Playwright and jsdom never show it. Every gesture surface therefore carries `style:touch-action="none"`,
  takes pointer capture at `pointerdown` (`setPointerCapture(e.pointerId)`), and treats `pointercancel` as the stroke's
  end, as `pointerup` does: the cells drawn so far stay, nothing is posted until `reached`, and the next stroke starts
  from the path's end cell.
- **Entrances and outros (W3; round 3).** The room layer's root and the puzzle frame's root carry `in:layerIn` and
  `out:layerOut` with `|global` (Svelte 5 plays a `|global` outro when an ancestor block is destroyed), from
  `cues/root.ts` over `LAYER_MOTIONS` (`cues/visible.ts`: fade + scale, 300 ms; reduced: fade 150 ms). When
  `explore.layer` turns null (`yields.ts:263`, `:386`, `:786`, `:824`) the room UI therefore leaves with motion while
  the stage plays the cue that hid it (`move:leave`, `fact:story:added`), and when it returns (an event knot ends,
  `fact:story:removed`) it enters with motion. Svelte 5 sets `inert` on an element for its out transition
  (`transitions.js:275`, §1), so an outroing root takes no tap. **The frame wrapper passes taps (W1's second effect):**
  App's frame layer wrapper is `pointer-events: none` and PuzzleHost's `place: 'frame'` root and the `hostFailed` block
  are `pointer-events: auto` (GM3w, behaviour-identical: the frame is full-bleed), so during the frame's 300 ms outro a
  tap passes the wrapper to the stage layer, which `coversStage(null)` has already made live. e2e (GM3p): `mechanics: a
  tap on the room right after a puzzle closes reaches the room` (mutation **M-W1b**: the wrapper without
  `pointer-events: none` -> red, the tap is swallowed). verify at GM3s's cut: Svelte 5's transitions in the vitest
  environment (they need `Element.animate`); fallback: the e2e asserts the layer root is still attached >= 100 ms after
  the hide.
  Changed by RULINGS 186 (as of `837b1ed`; docs lane `docs-errata-12`, group A): as merged (GM3w `508bd36`, cut D4),
  the wrapper carries its own class, `frame-layer` (`client/src/ui/App.svelte:95`; `.layer` is shared by every App
  layer), with `.frame-layer { pointer-events: none; }` (`:292-294`); `.host-failed` (`:336`) and PuzzleHost's `.frame`
  (`client/src/ui/puzzles/PuzzleHost.svelte:129`) take `pointer-events: auto`. The comment above the rule
  (`App.svelte:290-291`) gives a reason the frame layer's `{#if}` guard rules out today; the rule serves this outro tap
  (GM3w review M1, carried to GM3s, a comment only).
  Changed by RULINGS 195, 198, 201 (as of `461424d`; docs lane `docs-errata-13`, group A): as merged, **Branch F**
  (GM3s `65e10ad`; its P0 measured Svelte's transition runtime in the entry at +989 B br, past §3.5's +0.55): no root
  carries `in:` / `out:` and no Svelte transition directive exists in `client/src` (`cues: no Svelte transition
  directive in client/src`). The cue stage owns both layer motions (`mountStage`, `client/src/cues/stage/index.ts:214`):
  a `MutationObserver` sees a family root (`data-cue-root`) arrive and plays `LAYER_MOTIONS.in` on the live root from
  the birth stamp `cueRoot` writes (`data-cue-born`, `client/src/cues/root.ts:57`), and a tracked root that leaves the
  document plays `LAYER_MOTIONS.out` (`frameOut` for `data-cue-root="frame"`) on a ghost clone at its last box
  (`:260-276`); an end motion caught on the leaving wrapper continues on the wrapper's clone inside the root's ghost,
  padded to the ghost's end (`stage: an end motion continues on the wrapper's clone inside its root's ghost`). The
  root leaves the document at the flush, so no outroing root takes a tap or holds `inert`, and the room's tap after a
  puzzle closes has no outro window (M-W1b still guards the wrapper's `pointer-events`). Test `stage: a family root
  enters and leaves with LAYER_MOTIONS`. The vitest check above was settled at GM3s's cut (happy-dom 21.0.4 implements
  `Element.animate`).
- **The catcher (R17):** `<div class="bare" data-cue="bare-art">` is the first child of `.room`, `inset: 0`, under the
  hotspot buttons; it emits `ui:bare-art` with the point and calls `ondeselect`; it dispatches no action. Tests
  `explore: a tap on bare art emits one bare-art cue and no action`, `explore: a tap on a hotspot edge dispatches the
  tap and no bare-art cue`.
- **Component test** per family: renders the family with fixture views, fires **each `[data-cue]` element's declared
  trigger** (a `pointerdown` control gets a `pointerdown` event, not a click; verify jsdom's `PointerEvent` at GM3u's cut,
  fallback `new Event('pointerdown', { bubbles: true })`) and expects exactly one `ui` cue with its name; for each
  `[data-cue-gesture]` surface it drives the gesture's fixture script (`GESTURE_SCRIPTS['path-stroke']`: pointerdown on
  cell 0, pointermove across cells 1 and 2, pointerup; then, round 3 m13, pointerdown on cell 0, pointermove to 1,
  `pointercancel`, pointerdown on 1, pointermove to 2, pointerup) and expects one `ui:path-stroke` cue per newly entered
  cell and, after the cancel script, the answer `[0, 1, 2]`
  (`explore: every declared control emits its cue`, `puzzles: every declared control emits its cue`). Named mutations:
  **M-I5g** (the root listens for `click` only) -> red on the first `pointerdown` control (GM8b's `push`; until then a
  fixture control in the test); **M-I5h** (the path UI's stroke handler never calls `oncue`) -> red in GM7p.
- **Stage-level gate (W3).** The bus counts `orphans()`; the CueStage writes `data-cues-played` (the last 32 keys) and
  `data-cue-orphans` on its root under `__TG_MOCK__`; round 10 (§8.1 point 10): also `data-cue-fallbacks`, the
  player's `fallbacks()`, which every mechanics e2e asserts 0 at its end. e2e (GM3s): `mechanics: an event knot's start plays its cue and the
  room layer leaves with motion`, `mechanics: a section leave plays move:leave`, `mechanics: no cue is orphaned across
  the demo walk` (orphans 0); GM3p adds `mechanics: a linear puzzle's give-up ask and no play their cues`. Named
  mutation **M-I5i:** mount the stage inside `ExploreView` again (round 1's model) -> the linear-puzzle e2e finds no
  played key and the event-knot e2e counts orphans > 0.

### 8.4 The presenter table (every cue -> default motion)

Overlay presets (Web Animations on DOM, GM3m; `cues/stage/presets.ts`): `press` (control scale 1 -> 0.92 -> 1), `glint`
(light sweep over a box), `tick` (a check stroke draws at a box), `pulse` (box glow ring 0 -> 1 -> 0, scale 1.06),
`burst` (8 sparks radiate from a box), `shake` (translateX +-6 px x3), `wobble` (rotate +-4 deg x2), `fly` (a glyph ghost
flies box -> ribbon slot), `drop` (ghost ribbon slot -> box), `ripple` (ring expands at a point), `sweep` (stage-wide
light pass in a direction), `iris` (a rounded rect grows from / shrinks to a box), `vignette` (stage edge darkens and
opens), `dim` (stage darkens and blurs under a panel), `lift` / `settle` (ribbon item rises with glow / returns),
`caption` (room title fades in and out), `roll` (a digit rolls), `breathe` (frame pulses x3), `flourish` (frame burst +
scale out), `jam` (shake + dim), `unfold` (tier text unfolds); the layer transitions `layer-in` / `layer-out` (the room
UI or the puzzle frame enters / leaves: fade + scale 0.98 <-> 1) are `LAYER_MOTIONS` in `cues/visible.ts`, played by
`cues/root.ts`'s Svelte transitions (round 3, m11; Changed by RULINGS 195 (as of `461424d`; docs lane
`docs-errata-13`, group A): played by the cue stage on the live root and on its ghost, Branch F, §8.3 "Entrances and
outros"). **Ruled: RULINGS 203, 204** — the ghost style: a plain ghost (a box- or stage-site drawing, `of` null) carries
`cue-plain`, which CueStage paints with a soft light (radial white, peak alpha 0.5, CSS only, CLAIM defaults judged at
Q54's device session), unless the keyframes it plays carry `boxShadow` or `backgroundColor` (`vignette`,
`vignette-back`, `dim` paint by themselves: `SELF_PAINT`, `client/src/cues/stage/index.ts:30`, `:292-294`); a clone of an
element that is or lies inside `[data-cue-hit]` carries `cue-hit` (`:155-170`; `client/src/cues/stage/CueStage.svelte:46-57`).
Every played-backwards entry below (`tick`, `pulse`, `sweep`
reversed) is the preset with its keyframes in reverse order, so it changes the same visible properties. Scene motions are MR1's: **every cell of the scene column is owed by MR1** (W4; the names are
indicative, MR1 designs them); there is no "none", no "-" and no exemption list: rooms, scenes and props take the
maximum (RULINGS 114, 122). The haptic column adds touch feedback **on top of** motion, never instead of it.

| CueKey | Overlay default (lane) | Scene default: MR1 owes every cell (indicative) | Haptic |
|---|---|---|---|
| `fact:held:added` | `fly` box -> ribbon slot + slot `pulse` (GM3m); round 10 (critique_engine_r9 W2): with no live ribbon (the dispatch hid the rooms, a take or `onOpen` with a knot), the `fly` ends at `edge`, off the stage's bottom edge, and the `pulse` is skipped (§8.1 point 9); cause `carry`: `fly` in from the stage edge (GM3m too, `byCause.carry` with target `edge`, round 3 m4; GM9r only emits it) | the prop lifts and flies to the ribbon; `carry`: the room's light warms once | success (as `yields.ts:291`) |
| `fact:held:removed` (round 9: `resolveAt: 'emit'`, the first motion and its `with`) | ribbon slot `settle` out (on the slot's ghost clone once the write removes it) + `fly` from the slot's captured box to the target box | the item sprite flies into its target | - |
| `fact:used:added` (round 9: `resolveAt: 'emit'`, the `drop` starts at the consumed item's slot) | `drop` into the target box | the item seats | light |
| `fact:doc:added` | round 11 (critique_engine_r10's question: the inventory sheet keeps the documents, `ExploreView.svelte:63`, `:67-70`; the ribbon holds items): `fly` page glyph box -> the bar's Inventory control (target `inventory`) + `with`: `pulse` on the control; with no live Inventory control (the dispatch hid the rooms; before GM3u marks it) the `fly` ends at `edge` and the `pulse` is skipped (§8.1 point 9, §8.5) | the paper lifts | success |
| `fact:taken:added` | `glint` at the emptied box | the prop lifts off its anchor and fades (with the visual diff) | - |
| `fact:examined:added` | `tick` at the box | a done glint on the object | - |
| `fact:open:added` | `burst` at the box | part tween (a drawer slides) + patch crossfade | success |
| `fact:slot:added` (round 9: `resolveAt: 'emit'`, as `used:added`) | `drop` into the box | the item seats in the slot | light |
| `fact:fired:added` | `pulse` at the trigger's box; room triggers: `sweep`. Changed by RULINGS 212, 217 (as of `52e328e`; docs lane `docs-errata-14`, group A): as merged (GM3 `7082a35`), the `enter` cause (a room's `onEnter`, no hotspot) plays `sweep` on the stage (`byCause.enter`, `client/src/cues/stage/motions.ts:148`); every other cause pulses at the box; the walk case is GM3p's carry | a pulse on each target anchor | - |
| `fact:visited:added` | `vignette` + `caption` (the room title) | establishing pan | - |
| `fact:solved:added` | `flourish` at the lock box | the lock opens (tween) | success |
| `fact:failed:added` | `jam` at the lock box | the lock shudders and dims | error |
| `fact:abandoned:added` | frame `iris` out | the lock's anchor sags and settles back | - |
| `fact:attempt:added` | `shake` at the lock box / frame | the lock or dial anchor shakes | error |
| `fact:hint:added` | `pulse` at the hint control | a faint glow on the puzzle's anchor | - |
| `fact:story:added` | `dim` (an event knot starts) + the room layer's `layer-out` | the room slowly pushes in and darkens | - |
| `fact:flag:added` (GM5f) | `sweep` | the state crossfade where visible; a room light pulse otherwise | - |
| `fact:work:added` / `fact:work:removed` (GM8i; a part's new / old position, id `<puzzle>.<index>=<v>`) | `press` at the part's hit area | part throw tween | light |
| `fact:used:removed` (round 3 m6; a section reset, mostly) | `fly` a ghost from the target box back to the ribbon slot + slot `pulse` (round 10: `edge` with no live ribbon) | the item lifts out of its target and returns | - |
| `fact:doc:removed` (round 9: `resolveAt: 'emit'`) | round 11 (the critic's question): `glint` across the bar's Inventory control (box site, target `inventory`, captured at emit) + `with`: `settle` on the control (element site); with no live control the `glint` plays at `edge` and the `settle` is skipped | the paper fades from the room | - |
| `fact:taken:removed` | `glint` at the box (the prop is back) | the prop fades back in at its anchor (with the visual diff) | - |
| `fact:examined:removed` | `tick` played backwards at the box (the check undraws) | the done glint fades | - |
| `fact:open:removed` | `iris` shrinks onto the box (it shuts) | part tween back (the drawer slides shut) + patch crossfade | - |
| `fact:slot:removed` | `fly` box -> ribbon slot (round 10: `edge` with no live ribbon) | the item unseats from the slot | - |
| `fact:fired:removed` | `pulse` played backwards at the trigger's box; room triggers: `sweep` reversed | each target anchor pulses once | - |
| `fact:visited:removed` | `caption` (the room title) fades out | the room's light dims once | - |
| `fact:solved:removed` / `fact:failed:removed` / `fact:abandoned:removed` | `sweep` reversed at the lock box (a rewind) | the lock returns to its shut pose | - |
| `fact:attempt:removed` | `roll` back at the lock box | the lock anchor settles | - |
| `fact:hint:removed` | `pulse` at the lock box | the puzzle anchor's glow fades | - |
| `fact:story:removed` (an event knot returns: `pendingStory` pops) | `vignette` opens + the room layer's `layer-in` | the room pulls back from the push-in and brightens | - |
| `fact:flag:removed` (GM5f; only a section reset clears a flag) | `sweep` reversed | the state crossfade where visible; a room light pulse otherwise | - |
| `move:walk` | `sweep` toward the exit side of the `via` box | slide by exit side | - |
| `move:zoom-in` / `move:zoom-out` (GM4) | `iris` from / to the `via` box | bg zoom from / to the rect | - |
| `move:enter` / `move:return` / `move:resume` | `vignette` open | establishing push-in (scale 1.04 -> 1) | - |
| `move:leave` (W3; a section left for a knot) | `vignette` close + the room layer's `layer-out` | the room pushes out and fades | - |
| `module:core:look` | `glint` at the box | a glint on the object | - |
| `module:core:locked` | `shake` at the box | the door rattles | error. Changed by RULINGS 204 (as of `461424d`; docs lane `docs-errata-13`, group A): declared with its row (GM3s), but **no effect emits it** on `461424d`: its emitter is the first lane that refuses a tap on a closed exit or hotspot (GM3s cut Q4) |
| `module:core:refused` | `wobble` at the box | the target wobbles, the item bounces back | error (as `yields.ts:311`) |
| `module:core:reset` | `sweep` reversed (a rewind) + today's toast | every changed anchor rewinds to its section-start state | - |
| `module:use:refused` (GM3; Changed by RULINGS 212, 217 (as of `52e328e`; docs lane `docs-errata-14`, group A): as merged, `motions.ts:215`, also on a failed fit, `refused { reason: 'no-fit' }`) | `wobble` at the target + `fly` back to the ribbon | as core refused | error |
| `module:use:said` (GM3; Changed by RULINGS 212, 217 (as of `52e328e`; docs lane `docs-errata-14`, group A): as merged, `motions.ts:216`; the toast is the rule's `look` effect, not the cue's) | `glint` at the target + the toast | a glint on the target | - |
| `module:combine:refused` (GM5) | both ribbon items `shake` | the room's light dips once | error |
| `module:devices:done` (GM8i, round 3 m10; arrival at a solved device) | `glint` at the device box | the device's light settles | - |
| `module:devices:jammed` (GM8i, round 3 m10; arrival at a failed device) | `jam` at the device box | the parts shudder and settle in their jammed state | error |
| `ui:<control>` (every control cue, gesture steps included; `UI_MOTIONS`, §8.5) | default `press` on the control, a gesture step `pulse` at the step's cell; overrides in GM3m for core controls (`bare-art`: `ripple` at the point; `ribbon-item`: `lift`); a type or module control may name its own preset in its `ControlDecl`; round 10 (the critic's `hotspot` question): on a hit area (`data-cue-hit`: a hotspot button, the catcher, a device part) an element-site motion plays on the area's painted ghost (its clone at its box with the hit outline), so a take, look or object tap dips a visible outline at once (§8.5 "Hit areas") | `hotspot`: its anchor dips; `bare-art`: dust at the point; bar and panel controls: a light pulse across the room; puzzle controls: the device part or the close-up nudges | from the declaration: `ribbon-item`, `lever`, `push`: light |
| `ui-state:select` / `deselect` (round 9: `deselect` is `resolveAt: 'emit'`: a use may consume the selected item) | `lift` / `settle` the item | the room's light shifts | light |
| `ui-state:panel-open` / `panel-close` | open: the panel slides in and a `dim` pulse darkens the stage onto the sheet's own backdrop, which holds the dim while the panel is up (round 4 O1: overlay cues are `fill: 'none'`, §8.6, so the persistent dim is the sheet's CSS backdrop, GM3u, never the cue); close: a ghost of the panel slides out and its backdrop fades with it (round 9: `resolveAt: 'emit'`, the ghost clone of §8.1 "When a cue's DOM target is found"). Round 9 (m1, m4): for `panel: 'puzzle'` only the open exists, emitted by yields at every frame write, and it slides the frame wrapper (overlay and linear frames) or the device bar (a view); round 10 (critique_engine_r9 W1): at the write that shows the frame, the frame write when the host chunk is in, else the chunk write (`appear(o)`, §8.1 point 8), so the slide lands on the wrapper the first frame of a page load mounts | the room dims / brightens | - |
| `ui-state:waiting` (round 4 m11; a room batch waits on a load; round 7 W1: also the hint ladder's request, `panel: 'hints'`, and a chunk Retry, `panel: 'puzzle'`) | a held `breathe` ring at the `via` box (target `box`; with no box, round 9 (m3): the cue's panel's notice when it shows one, else the panel element, §8.5 "Cue targets": the ladder for `hints`; for a chunk Retry the notice, PuzzleHost's, App's `.host-failed`, the device bar's or ExploreView's in-view one), looping from `WAIT_DELAY_MS` (120 ms) until the `waited` **of the same panel** (one hold per panel, round 7); not shown when the wait ends first; round 11 (critique_engine_r10 W1): with no box and no notice, a `null` or `puzzle` hold breathes at the designed landing `centre` (§8.5 "Cue targets"): a room batch with no `via`, a section's explore import, a close-up's load, a frame's chunk imports (unshown, or shown with its type UI pending); the frame's load hold opens at the frame write (§8.1 point 11); round 12 (critique_engine_r11 W1): every visual batch emits it through `held`, and GM3b's state batch carries its first changed anchor's box, so a state picture that loads breathes on the drawer, the lever, the statue it will change | the room's light dims a step while it waits (round 12: for a state batch, MR1's indicative motion is the changing anchor's own shimmer) (a ladder or Retry wait: the close-up or device dims a step) | - |
| `ui-state:waited` (round 4 m11; round 9: `resolveAt: 'emit'`, the element its own hold played on) | the hold releases with a `settle` at the box (>= 120 ms), then the move's own cue plays with the crossfade; emitted on every batch, it plays its settle only after a shown hold (with no hold the move's cue is the motion; round 5 m3: the every-key test drives it after a shown hold); round 7: a ladder or Retry `waited` is followed by its answer's cue (`ladder`, `hint-shown`, `hint-failed`, `opened`, `load-failed`) the same way | the light returns as the move starts (the close-up or device brightens back) | - |
| `ui-state:reveal` (Changed by RULINGS 226, 230 (as of `0b91acc`; docs lane `docs-errata-15`, group A): no emitter yet, see `ui-state:tab`) | outlines draw in over every hotspot box, hold `REVEAL_MS`, fade | every hotspot anchor shimmers once | - |
| `ui-state:tab` (Changed by RULINGS 226, 230 (as of `0b91acc`; docs lane `docs-errata-15`, group A): no emitter yet, as `ui-state:reveal`; both are in `UI_STATE_CUES`, `client/src/cues/types.ts:102-103`, and GM3u `33b4f8d` left them without one, its cut Q4: the bar Reveal and the inventory tabs emit only their control cues) | the tab underline slides | the dimmed room drifts one parallax step | - |
| `puzzle:opened` / `closed` (round 8, m1: `opened` from `loadPuzzleUis` when the type UI arrives; `closed` from `dropPuzzle` for a give-up and every no-outcome drop, while the frame is still shown; round 9: and from `hideFrame` at an X8 Back and at a device view's zoom-out; `closed` is `resolveAt: 'emit'`) | frame `iris` in / out at the frame wrapper's box (a box-site drawing on the stage layer; + the frame root's `layer-in` / `frameOut`) | the close-up fades in / out; a device's parts settle | - |
| `puzzle:input` | `roll` at the part (target `part`, `[data-cue-part=<index>]`; round 7 m4: was `[data-cue-index]`, a control attribute) | the device part moves (devices); the close-up nudges (overlays) | light |
| `puzzle:blocked` (W5) | `shake` at the refused cell (target `part`) | the close-up or device nudges back | error |
| `puzzle:checking` | `breathe` on the frame wrapper (the device bar in a view); round 11 (critique_engine_r10 W1, §8.1 point 11): **looped** (`until: CHECKING_ENDS`) until the same puzzle's next settling or end key, one visible pulse per cycle; round 12 (critique_engine_r11 m3): cancelled where it stands at that key's run, in the step that starts the key's own motion (round 11 read "stopped at the end of its current cycle") | the close-up or device hums (a small pulse) while the answer is out | - |
| `puzzle:wrong` | frame `shake` | the lock anchor shakes | error |
| `puzzle:failed` (round 8, m1: from `dropPuzzle`, called by `onEnd`, as the frame leaves; round 9: `resolveAt: 'emit'`) | `jam` on the frame wrapper (element site), nested under the root's `frameOut`; round 10 (m2): `holdEnd`, so the wrapper stays jammed and dimmed until the root's outro removes it | the lock shudders and dims | error |
| `puzzle:solved` (round 8, m1: the same site; round 9: `resolveAt: 'emit'`) | `flourish` on the frame wrapper (element site; its sparks draw at the wrapper's box), nested under the root's `frameOut`; round 10 (m2): `holdEnd`, so the scaled-out wrapper never snaps back to rest before the root's outro removes it | the lock opens (tween) and light blooms | success |
| `puzzle:reached` | device `pulse` | the device glows | - |
| `puzzle:reset` | `jam` (device) | parts snap back | error |
| `puzzle:hint-shown` | `unfold` the tier (target `tier`, `[data-cue-tier=<index>]`) | the close-up or device glows | - |
| `puzzle:renewed` (per-player R-E14; GM3m adds the key, per-player GM6c2 emits it) | frame `breathe` (target `frame`) + `with`: `roll` on the attempts line (target `attempts`, round 7 m4) | the close-up or device glows once | - |
| `puzzle:demo` (round 4 m7; GM3m adds the key, GM8h's demo runner emits it, index = part) | `pulse` at the part (target `part`, `[data-cue-part=<index>]` in the device host; round 7 m4) | the part lights and rings (MR1 owes) | - |
| `puzzle:hint-renewing` (per-player R-E20, round 4; GM3m adds the key, per-player GM6c2 emits it, index = tier) | `unfold` played backwards on the tier (target `tier`: `[data-cue-tier=<index>]`, marked by GM3p in HintLadder, round 7), wherever the ladder is: the frame or ExploreView's `ladder` sheet | the close-up or device dims once | - |
| `puzzle:offline` (round 5; GM3m adds the key, GM3p emits it from `attempted`) | `wobble` on the status line (target `status`: `[data-cue-status]` in the frame or the device bar; fallback the frame) | the close-up or device flickers and dims once (MR1 owes) | error |
| `puzzle:rate-limited` (round 5; GM3m adds the key, GM3p emits it from each `countdown` tick, index = seconds left) | `roll` on the status line's number (target `status`) | the close-up or device takes one slow pulse step per second (MR1 owes) | - |
| `puzzle:ready` (round 6, W3 and per-player R-E26; GM3m adds the key; GM3p emits it at the countdown's zero with nothing to post and from the no-outcome branch, GM7r through `ready(o)`, per-player GM6c2 from `syncValues`; index = attempts left or null) | `glint` over the frame (target `frame`: `[data-cue-frame]`, PuzzleHost's frame root, GM3p, or the device bar in a view, GM8h) + `with`: `roll` on the attempts line (target `attempts`: `[data-cue-attempts]`, round 7 m4; skipped when the line is not shown) as `puzzle:renewed`'s row does; the sweep crosses the status line as it clears and Try as it lights | the close-up or device brightens once (MR1 owes) | - |
| `puzzle:ladder` (round 7, W1; GM3m adds the key, GM3p emits it through `setLadder`; per-player GM6c2's ladder writes pass through it too) | `glint` over the ladder (target `ladder`: `[data-cue-panel="hints"]`, HintLadder's root in the frame and in ExploreView's `ladder` sheet), crossing the tiers, the balance and the use button as they arrive or change and the alert as it clears | the close-up or device glows faintly (MR1 owes) | - |
| `puzzle:hint-failed` (round 7, W1; GM3p, index = the tier or null) | `wobble` on the ladder's alert (target `alert`: `[data-cue-alert]` inside the ladder; fallback the ladder) as it appears and the use button relights beside it | the close-up or device dims once (MR1 owes) | error |
| `puzzle:load-failed` (round 7, W1; GM3p from `loadPuzzleUis`) | `wobble` on the notice (target `notice`: `[data-cue-notice]`, PuzzleHost's load-failed block, App's `.host-failed`, the device bar's and ExploreView's failed-host notice; fallback the frame) as it and Retry appear | the close-up or device flickers once (MR1 owes) | error |

Value spans and code labels are per-player's (`ui/value-motion.ts`, the executor's label crossfade; R-E3 withdrawn in
per-player round 2): their motion is theirs, gated with this file's `MIN_VISIBLE_MS` and `keyframesVisible` (E-P8).

- Changed by RULINGS 193 (as of `837b1ed`; docs lane `docs-errata-12`, group A): two rows of the table ship as
  recorded deviations, visual CLAIM defaults (GM3m `a3f0678`, triage r1 M4, never blocking): `fact:abandoned:added`
  plays `iris-back` on target `box`, not the frame's `iris` out (`client/src/cues/stage/motions.ts:157`; the frame may
  be gone at a flush, and `puzzle:closed` already irises it); `fact:fired:added` / `:removed` play `pulse` /
  `pulse-back` on `box` only (`motions.ts:147-148`): the room triggers' `sweep` has no field in `MotionSpec`, which
  varies a row by cause (`byCause`) only.
- **Fallback:** a cue whose box cannot be resolved plays its preset on the stage centre, still visible. Round 10
  (critique_engine_r9 W1, W2; restated, round 9's "not a path a designed cue takes" was false on two paths): a
  fallback is **a counted defect** (`fallbacks()`, `data-cue-fallbacks`, §8.1 point 10), and the designed cues avoid
  it by three rules of §8.1 "When a cue's DOM target is found": each row's target is resolved where its element exists
  (`resolveAt`, points 2-3); a frame cue is emitted only once its frame is on screen, and the write that shows it
  emits its `panel-open` (point 8); a `ribbon` target with no live ribbon lands at `edge` (point 9). The six real-flush
  tests of §8.5 assert `fallbacks() === 0`, and every mechanics e2e asserts `data-cue-fallbacks` 0, including GM3p's
  `mechanics: the first puzzle of a page load holds a motion while its frame loads and slides in on its frame` on the
  real App (round 11: renamed). Round 11 (critique_engine_r10 m2, O1): a `box` target with no box resolved through the
  DOM (a panel's notice or element) that finds nothing counts too, and a cue whose every motion was skipped (an
  element-site motion at `edge`, §8.5) counts once; `centre` and `edge` are landings and never count.
- **Ruled: RULINGS 234** — Q65: a world cue whose subject is not in the shown room (a hidden puzzle's late
  `fact:attempt:added` / `fact:solved:added` after the player walked away) is dropped by the cue stage: no motion, no
  haptic, no fallback count; the next holder of `client/src/cues/stage/{index,player}.ts` implements it with a stage
  test where the answer lands after a walk (not GM3p's: its lock excludes `cues/stage/**`).
- **Overrides** (later, MR1): world / catalog override per hotspot or prop -> catalog default per prop -> this table.
