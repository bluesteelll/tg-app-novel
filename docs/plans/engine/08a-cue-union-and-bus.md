## 8. The cue channel

### 8.1 The cue union and the bus

```ts
// client/src/cues/types.ts (types + `as const` name tuples; pure, engine)
export type Cue =
  | { readonly kind: 'fact'; readonly fact: FactAtom; readonly change: 'added' | 'removed'; readonly cause: Cause }
  | { readonly kind: 'move'; readonly from: RoomId | null; readonly to: RoomId | null; readonly via: HotspotKey | null;
      readonly how: MoveHow }                                   // to = null only for 'leave' (a section left for a knot)
  | { readonly kind: 'module'; readonly module: MechanicId; readonly name: string; readonly at: HotspotKey | null;
      readonly item: ItemId | null }
  | { readonly kind: 'ui'; readonly control: ControlCue; readonly item: ItemId | null; readonly index: number | null }
  | { readonly kind: 'ui-state'; readonly name: UiStateCue; readonly panel: ScreenKind | null; readonly item: ItemId | null }
  | { readonly kind: 'puzzle'; readonly puzzle: PuzzleLocalId; readonly name: PuzzleCue; readonly index: number | null };
// (per-player round 2 withdrew R-E3: no `values` kind; value motions are owned by per-player's `ui/value-motion.ts`.)
export type CueTrigger = 'click' | 'pointerdown' | 'input' | 'change' | 'keydown';
export const CUE_TRIGGERS = ['click', 'pointerdown', 'input', 'change', 'keydown'] as const;
/** One declared control (module rules halves, type data halves): its trigger, an optional preset that replaces
 *  `UI_MOTIONS`' default, and touch feedback on top of the motion (round 3; `PresetId` is a type-only name tuple). */
export type ControlDecl = { readonly name: string; readonly on: CueTrigger | 'gesture'; readonly motion?: PresetId;
  readonly haptic?: Haptic };
/** Controls of the kernel's UI and of GM3u / GM4u's; module and type controls derive from their registries. */
export const CORE_CONTROLS = ['hotspot', 'bar-inventory', 'bar-reveal', 'inventory-tab', 'inventory-doc', 'doc-close',
  'lock-item', 'ribbon-item', 'bare-art', 'view-leave', 'dial-up', 'dial-down', 'order-slot', 'puzzle-try',
  'puzzle-hint', 'puzzle-retry', 'give-up-ask', 'give-up-no', 'give-up-yes', 'hint-use', 'hint-more'] as const;
// Round 4 (m2): `controls` is optional, so the entries are read through a distributive conditional, not an index:
type ControlsOf<T> = T extends { readonly controls: readonly (infer C)[] } ? C : never;
type TypeControlEntry = ControlsOf<(typeof PUZZLE_TYPES)[number]>;                    // type-only import (engine)
type ModuleControlEntry = ControlsOf<(typeof MECHANIC_DATA)[number]>;                 // type-only (engine; round 3, 4)
type TypeControl = TypeControlEntry['name']; type ModuleControl = ModuleControlEntry['name'];
export type ControlCue = (typeof CORE_CONTROLS)[number] | ModuleControl | TypeControl;   // derived, §8.3
export type GestureCue = Extract<TypeControlEntry | ModuleControlEntry, { on: 'gesture' }>['name'];   // today: 'path-stroke'
export const UI_STATE_CUES = ['select', 'deselect', 'panel-open', 'panel-close', 'reveal', 'tab',
  'waiting', 'waited'] as const;   // round 4 m11: a room batch waits on a load / its loads ended (§6.3); round 7
                                   // (W1): also the hint ladder's request (`panel: 'hints'`) and a chunk Retry
                                   // (`panel: 'puzzle'`); the player keeps one hold per `panel` (null: the room batch)
export const PUZZLE_CUES = ['opened', 'input', 'blocked', 'checking', 'wrong', 'failed', 'solved', 'reached', 'reset',
  'hint-shown', 'closed', 'renewed',   // 'renewed': per-player R-E14 (the run changed under an open frame)
  'demo',                              // round 4 m7: one step of a device's demonstration (index = part)
  'hint-renewing',                     // per-player R-E20 (round 4): a tier text dropped by a run change (index = tier)
  'offline',                           // round 5: a `network` / `not-entitled` reply (a `wobble` on the status line)
  'rate-limited',                      // round 5: one per countdown second (index = seconds left)
  'ready',                             // round 6 (W3; per-player R-E26): a wait ended with nothing posted, the frame
                                       // takes input again (countdown zero, a no-outcome reply, the values wait)
  'ladder',                            // round 7 (W1): a server answer rewrote the hint ladder (tiers, wallet; the
                                       // alert cleared); index null
  'hint-failed',                       // round 7 (W1): a ladder status or a hint purchase failed (index = tier or null)
  'load-failed'] as const;             // round 7 (W1): the type or host chunk did not load (the notice and Retry)
// Round 4 (m2): `CueTrigger`, `CUE_TRIGGERS`, `ControlDecl` and `Haptic` land here in GM3m together with the optional
// `controls` fields of `MechanicData` (`mechanics/contract.ts`) and `PuzzleTypeData` (`puzzles/rules/index.ts`), which
// GM3m adds; `PresetId` is a type-only name tuple of `cues/stage/presets.ts`. No earlier lane names a control type.
export type MoveHow = 'walk' | 'zoom-in' | 'zoom-out' | 'enter' | 'return' | 'resume' | 'leave';
export type CueKey = `fact:${FactKind}:${'added' | 'removed'}` | `move:${MoveHow}`
  | ModuleCueKey | `ui:${ControlCue}` | `ui-state:${UiStateCue}` | `puzzle:${PuzzleCue}`;
/** A floor, never a ceiling: every cue motion and every value motion (per-player E-P8) lasts at least this long. */
export const MIN_VISIBLE_MS = 120;
/** What the bus carries: the cue, the stage box of its hotspot (resolved by the controller, which has the cover
 *  mapping, `controller.ts:108-119`, even for a taken hotspot), the pointer point, the dispatch's visual diff, and for a
 *  `ui` cue the control element and its box at emit time (round 9: a `control` target is an `'emit'` target, §8.1
 *  "When a cue's DOM target is found": the motion plays on the element while it is in the document and continues on a
 *  ghost clone at `box` from the moment it leaves, whenever that is). */
export type CueEvent = { readonly cue: Cue; readonly box: Box | null; readonly point: Point | null;
  readonly diff: readonly VisualDiff[]; readonly el: Element | null };
// client/src/cues/bus.ts (engine, ~35 lines): one per GameSession, created and disposed by yields
/** Events held while no 'overlay' subscriber exists (LIMIT new; m5, round 3). */
export const CUE_HOLD_MAX = 64;
export interface CueBus {
  /** With no 'overlay' subscriber the event is held (FIFO, <= CUE_HOLD_MAX; past it the oldest is dropped and counted
   *  as an orphan); 'scene' gets it live whenever MR1 subscribed. */
  emit(e: CueEvent): void;
  /** One subscriber per role: 'overlay' = the session's CueStage (GM3s), 'scene' = MR1's scene player. A second
   *  subscribe of a role replaces the first (a re-mount), so each role plays each cue exactly once. The first
   *  'overlay' subscribe replays the held events to `fn` in order before any live one. */
  subscribe(role: 'overlay' | 'scene', fn: (e: CueEvent) => void): Unsubscribe;
  /** Events that never reached an 'overlay' subscriber: dropped past the hold, or still held at `dispose` (W3's
   *  detector; the e2e asserts 0). */
  orphans(): number;
  dispose(): void;
}
export function createCueBus(): CueBus;
// The slot types name svelte's `Component`, so they live in client/src/ui/state.svelte.ts, not in this pure file (m11):
//   CueStageSlot = { component: Component<CueStageProps>; subscribe: CueBus['subscribe']; orphans: () => number }
//   CueStageProps = { subscribe: CueBus['subscribe']; orphans: () => number; reduced: boolean }
//   App renders `<slot.component subscribe={slot.subscribe} orphans={slot.orphans} reduced={vm.reducedMotion} />`.
// client/src/cues/visible.ts (pure; used by this file's gate and per-player's value-motion gate, E-P8)
export function keyframesVisible(kf: readonly Keyframe[]): boolean;   // some visible property differs between frames
/** The room UI's and the puzzle frame's entrance and exit (round 3: data here, transitions in cues/root.ts). Round 9
 *  (critique_engine_r8 W1): the frame root leaves with its own `frameOut`, which lasts at least as long as every
 *  element-site end motion that plays on the frame's wrapper inside it (gate `cues: a frame's end motion ends before
 *  its frame leaves`), so the wrapper stays attached until its end motion is over. */
export const LAYER_MOTIONS: { readonly in: LayerMotion; readonly out: LayerMotion; readonly frameOut: LayerMotion };
// LayerMotion = { keyframes: readonly Keyframe[]; ms: number; reduced: { keyframes: readonly Keyframe[]; ms: number } }
// in: fade + scale 0.98 -> 1, 300 ms; out: fade + scale 1 -> 0.98, 300 ms; reduced: fade only, 150 ms.
// frameOut (round 9): fade + scale 1 -> 0.98, 480 ms; reduced: fade only, 480 ms (round 10, critique_engine_r9 m1: was
// 200; a `MotionSpec` has one `ms`, which its reduced preset plays too, §8.6, so the reduced outro must be as long as
// the end motions it holds) (CLAIM defaults: 480 = `jam`'s three 160 ms shake cycles, ARITHMETIC; GM3m tunes both
// with the end presets, the gate keeps them coupled).
// client/src/cues/root.ts (GM3s; DOM, imported statically by the two family roots only, rules-lazy)
/** The family root action: one capture listener per CUE_TRIGGERS kind; emits a control from its innermost root only. */
export function cueRoot(node: HTMLElement, emit: (e: CueEvent) => void): { update(emit: (e: CueEvent) => void): void; destroy(): void };
export function layerIn(node: Element, opts: { reduced: boolean }): TransitionConfig;    // Svelte `in:` from LAYER_MOTIONS.in
/** Svelte `out:` from LAYER_MOTIONS.out, or `.frameOut` for a puzzle host root (round 9: `frame: true`, GM3p). */
export function layerOut(node: Element, opts: { reduced: boolean; frame?: boolean }): TransitionConfig;
```

- **Sources, all data:** the writer's fact cues and module cues (reducer, via the `cue` effect); the controller's
  `move` (from `room`'s `how`, and `leave`'s `move:leave`); GameSession's `puzzle` cues (session results, `onchange`
  diffs, hints), `ui-state` cues (the screens diff in `screensChanged`, `yields.ts:843-862`, for the explore and puzzle
  screen kinds only: `inventory`, `document`, `lock`, `hints`; story-mode screens are the unowned overlay
  half's, §8.2, Q4; round 9 (critique_engine_r8 m1): **not `puzzle`**: a frame's appearance is yields'
  `ui-state:panel-open` at the write that shows the frame (round 10, critique_engine_r9 W1: the frame write when the
  host chunk is in, else the chunk write; "When a cue's DOM target is found" point 8) and its leave is its end cue, so
  one change has one motion; and the ribbon
  selection); the layer roots' `ui` control cues and gesture steps (§8.3). **Round 4:**
  a `room` effect's `move:*` event is **built** at the effect (the controller resolves the `via` box while the old room
  is current) and **emitted** from the room batch's `started` callback, with `ui-state:waiting` before the loads and
  `ui-state:waited` after them (§6.3, m11); the demo runner's `puzzle:demo` (§7.5, m7); per-player's
  `puzzle:hint-renewing` (R-E20, emitted by per-player GM6c2). **Round 5 (m9): a moving dispatch's cues travel with its
  move.** When a dispatch's effect list holds a `room` effect, yields holds **every** cue of that dispatch (the
  writer's fact and module cues, e.g. `fact:visited:added` written before the push, `reduce.ts:321-322`, and the
  `enter:<room>` trigger's cues after it, `:323`; GM3s's mapped `got` / `look` / `story` cues before GM3) with the
  `move:*` event and emits them at the batch's `started`, in the order `ui-state:waited` (emitted on every batch; the
  player shows its settle only after a shown hold, §8.4), the `move:*` event, then the dispatch's cues in their order;
  a dispatch with no `room` effect emits at once as before. **Round 9 (found while resolving critique_engine_r8 W1):**
  the hold covers the dispatch's world cues (its `cue` effects and GM3s's effect-to-cue mappings) and never yields'
  own frame, ladder or panel cues, which describe writes made at once (`hideFrame` at a zoom-out included). A held cue
  reaches the stage after its block's flush, so it can only be a `'flush'` row or a box target, and it is: no kernel
  or module effect removes an element shown before a dispatch that pushes a `room` effect (the world `Effect` union is
  `give | unlock | story`, `client/src/world/types.ts:40`; a `room` effect comes from a move, a resume or an event
  return, `reduce.ts:322`, `:332`, `:354`; a reset with a move happens only at an entry, whose layer the batch itself
  builds, `yields.ts:386`). A later rule that would break this is a STOP item at its cut (§3.6).
  The control cue of the tap is the DOM root's and stays immediate, so the tap still answers at once and the wait hold
  covers the load. A batch that dies first (`dead`, `yields.ts:388`) drops them with the move event (they never
  reached the bus, so they are not orphans). Two rules keep a held cue from being stranded: `apply` calls `started`
  exactly once per call, **an empty command list included** (a resume into the room the stage already shows,
  `yields.ts:374-377`; GM3w's test gains that case), and a batch that returns before `apply` (an unknown room,
  `yields.ts:369-371`, already a story error) emits its held cues at once. A `story` effect after the `room` effect
  (an `onEnter` event) does not cancel the batch: the room layer's outro starts at the dispatch as built (`toStory`
  sets `explore.layer = null`, `yields.ts:263`), the knot is queued after the batch (`:265`, `:285`), and
  `fact:story:added` plays with the move at the batch's start, before the knot's first line. Round 5 (found while
  resolving): yields' `attempted` emits `puzzle:offline` on a `network` / `not-entitled` reply, and `countdown` emits `puzzle:rate-limited` with `index` =
  the seconds left on each tick (`yields.ts:619-630`) (GM3p). **Round 6 (W3): the end of a wait has its cue too.** At
  the countdown's zero yields emits `puzzle:checking` when `ready(o)` posts and **`puzzle:ready`** when it does not;
  `attempted`'s `closed` / `invalid` branch (`yields.ts:662-666`, a check that ends with no outcome) sets
  `line: 'idle'` and emits `puzzle:ready` (found in round 6: today it leaves "Проверяем…" on screen with Try enabled,
  `PuzzleHost.svelte:23`, `:34-35`). **Round 7 (critique_engine_r6 m3): `busy` is not a return to input.** It means
  another attempt is in flight (`session.ts:212-213`), so `attempted` writes nothing and emits nothing for it: the
  frame stays `busy` / `checking` and the reply in flight settles it with its own cue (today's `busy: false` at
  `yields.ts:665` would light Try over a live check). Per-player's `syncValues` emits `puzzle:ready` when an open
  frame's values land and, round 7 (R-E27 (c)), when a values load or a restart fails under a waiting frame (the wait
  ends `idle` and a blind Try is checked; `puzzle:offline` keeps one emitter, `attempted`'s `network` / `not-entitled`
  branch). `index` = the attempts left when the frame shows them (`frame.attemptsLeft`), else null. **Round 7 (R-E27
  (d)): a no-outcome reply or the countdown's zero whose pass carries a per-player run change plays `puzzle:renewed`
  instead of `puzzle:ready`** (per-player's one-cue pass `settle`, GM6c2), so every status-line state and every return
  of the frame to input has exactly one cue (GM3p; GM7r for the reach half; GM6c2 for the values patch).
- **The hint ladder and the chunk loads (round 7, critique_engine_r6 W1).** Three state changes on main had no cue:
  the ladder's first status (tiers pop in up to the request timeout after the sheet, `yields.ts:704-709`,
  `session.ts:179-180`), a failed purchase (the alert and the relit button in one cut, `yields.ts:741-744`,
  `HintLadder.svelte:49`, `:59-61`) and a chunk failure (the notice and Retry, `PuzzleHost.svelte:71-73`,
  `App.svelte:108-113`). **One writer:** every write of `puzzle.ladder` goes through yields'
  `setLadder(o, next, cues)` (GM3p), which emits `ui-state:waiting` (`panel: 'hints'`) when `busy` turns true,
  `ui-state:waited` when it turns false **or the ladder is cleared while busy** (Back during a request: the hold must
  end, never loop under a closed sheet), then the caller's cues in order:

  ```ts
  // client/src/app/yields.ts (GM3p; inside createYields, beside setFrame)
  type LadderCue = Extract<PuzzleCue, 'ladder' | 'hint-shown' | 'hint-failed' | 'hint-renewing'>;
  /** The one writer of `puzzle.ladder` (pinned by `yields: the ladder has one writer`): writes `next`, emits the wait
   *  edge of `busy` (`ui-state:waiting` / `waited`, `panel: 'hints'`; a null `next` over a busy ladder is a `waited`),
   *  then each `[name, index]` of `cues` as a `puzzle` cue of `o.local`. */
  const setLadder: (o: Open | null, next: HintLadderUiView | null, cues?: readonly (readonly [LadderCue, number | null])[]) => void;
  ```

  | Write (main's line) | Ladder after it | Cues (the writer's edge cues first) |
  |---|---|---|
  | Hint (`:704-705`) | the session's ladder, `busy: true`, **`failed` kept** (round 8, critique_engine_r7 W2: `puzzle.ladder?.failed ?? false`; a repeat tap over a failed ladder keeps the alert up until the status answers, as the use start does) | `ui-state:waiting` (the sheet's `panel-open` is the screens diff's; a repeat tap opens no sheet, `screens.ts:103-110`) |
  | status answered (`:708`; round 7: written only while `puzzle.ladder !== null`, the use site's guard `:736`, found while resolving) | the answered ladder, `busy: false`, `failed: false` | `ui-state:waited`, **`puzzle:ladder`** |
  | status failed (`:708`; the same guard) | `busy: false`, **`failed: true`** | `ui-state:waited`, **`puzzle:hint-failed`** (index null) |
  | re-read of an unlocked tier (`:726-729`) | `busy` kept (its button is `disabled={ladder.busy}`, `HintLadder.svelte:49`), `failed: false` (the tier's text is the answer) | `puzzle:hint-shown` (tier), and **`puzzle:ladder`** when the shown ladder had `failed: true` (round 8, W2: the glint crosses the alert as it clears) |
  | use starts (`:734`) | `busy: true`, **`failed` kept** (round 7: the alert stays until the answer, so it never vanishes in one cut at the tap) | `ui-state:waiting` |
  | use answered (`:739-740`) | the answered ladder, `busy: false`, `failed: false` | `ui-state:waited`, `puzzle:hint-shown` (tier), **`puzzle:ladder`** (the balance, the tier's row and a cleared alert) |
  | use `failed` (`:741-744`) | `busy: false`, `failed: true` | `ui-state:waited`, **`puzzle:hint-failed`** (tier) |
  | use `insufficient` / `unavailable` / `locked` / `no-port` / `closed` (`:741-744`) | the session's ladder, `busy: false`, `failed: false` | `ui-state:waited`, **`puzzle:ladder`** (`insufficient` also opens the wallet, whose motion is the meta overlay's) |
  | use `busy` (`:741`) | unchanged | none: the use in flight answers |
  | hints closed (`:856-857`), `dropPuzzle` (`:506`) | `null` | `ui-state:waited` when it was `busy`, else none (the sheet's `panel-close` is the screens diff's) |
  | wallet re-read on a screens change (`:858-860`) | the session's ladder, `busy` / `failed` kept | **`puzzle:ladder`** when the wallet's `cost` or `balance` differs from the shown one, else none |

  **The chunk loads:** round 11 (critique_engine_r10 W1): the frame write opens the frame's **load hold**
  (`holdLoad(o, true)`: `ui-state:waiting`, `panel: 'puzzle'`; point 11 below), and `loadPuzzleUis`' one write
  (`yields.ts:520`) closes it (`holdLoad(o, false)`: `ui-state:waited`; rounds 7-10 emitted only this `waited`, with no
  hold before it, so a first open whose chunks were not cached waited motionless) and then emits `puzzle:opened` (the
  type UI arrived) or **`puzzle:load-failed`** (the notice and Retry appear with a `wobble`); a cached chunk closes the
  hold within microtasks, before `WAIT_DELAY_MS`, so an open whose chunks are in shows nothing extra. **Retry** keeps the notice: `onretry`
  sets **`retrying: true`** (round 8, critique_engine_r7 W1: was `busy: true`; Retry `disabled={frame.retrying}` in
  PuzzleHost, the bar and App's block) instead of clearing `loadFailed`, emits `ui-state:waiting` (`panel: 'puzzle'`; round 11: through `holdLoad(o, true)`, the same hold),
  and guards a second tap by `!f.retrying`; `loadPuzzleUis` writes `retrying: false` with its result and **never
  `busy`** (§8.1 "The frame's flags and its ends"). App's `.host-failed` Retry lies outside every cue root (App is the entry, and
  `cues/root.ts` is `rules-lazy`), so `onretry` emits that control's `ui:puzzle-retry` itself when `puzzle.host === null`
  (GM8h narrows it to `o.present === 'overlay'`, since a view's failed host shows its Retry inside ExploreView's root);
  the stage resolves a `ui` cue with `el: null` by `[data-cue="puzzle-retry"]` (§8.5 "Cue targets").
  **Why one writer and a state gate, not more keys alone:** a key gate cannot see a state that has no key (the round-5
  and round-6 misses had the same shape), so GM3p's `yields: every visible change of the puzzle view plays a cue`
  drives every host callback through every reply kind and fails a step in which a changed frame or ladder field has
  none of its covering keys recorded (`VIEW_FIELD_CUES`, §8.5), and `yields: the ladder has one writer` pins that later writes (per-player GM6c2's tier re-reads and
  `hint-renewing`) pass through `setLadder`. **Rejected:** reusing `puzzle:offline` for the ladder (one key has one
  target, and its target is the frame's status line, not the ladder's alert); a component-side `$effect` that emits on
  a prop diff (a second emission mechanism outside yields, and no cue while the host chunk is missing); clearing the
  alert at the tap with its own key (one more key for a state that lasts one request).
- **The frame's flags and its ends (round 8, critique_engine_r7 W1, m1; per-player R-E28).** Round 7 gave `busy` a
  third meaning (the chunk Retry) and its chunk write cleared per-player's values wait (`busy: true, line: 'checking'`,
  [per-player §5.5 Puzzle session changes](../per-player/05-client-half.md#55-puzzle-session-changes-puzzlessessionts-and-openpuzzle)) whenever the type chunk resolved first; and the session's end cues sat in `attempted`'s
  `correct` / `failed` cases, which never run for an ending answer (§1 round 8 rows). One meaning per field, one
  emission site per end:

  ```ts
  // client/src/ui/puzzle-view.svelte.ts (GM3w adds `retrying` and both docs; behaviour-identical: nothing sets it yet)
  /** The frame waits for an answer that settles it: an attempt in flight (yields' `post(o)` sets it, the attempt's
   *  reply clears it: `attempted`, or `countdown`'s first tick for a 429) or, for a per-player puzzle, its values wait
   *  and its restart wait (per-player.md §5.5: set at the open / the 409, cleared by `syncValues` / `settle`). Try and
   *  the type UI's input are off while it holds. Never the chunk's state: that is `retrying`. */
  busy: boolean;
  /** A Retry's import of the host and type chunks is in flight: the notice stays with Retry disabled. Written only by
   *  yields' `onretry` (true) and `loadPuzzleUis` (false, with its result). */
  retrying: boolean;
  // client/src/app/yields.ts (GM3p; inside createYields)
  /** The one attempt starter (per-player R-E28): refuses (false) while the frame is busy or a countdown runs; else
   *  `busy: true`, `line: 'checking'`, `puzzle:checking`, `o.session.attempt()` with its reply through `attempted`, and
   *  true. Callers: `ontry` (GM3p), `postReach` and `ready(o)` (GM7r), the full-commit post and `oncommit` (GM8h);
   *  GM6c2 adds `o.trying = true` as its first write. Pinned by `yields: every attempt starts through post`. */
  const post: (o: Open) => boolean;
  /** The end cue of a dropped frame: `onEnd` passes the session's end (`solved`, `failed`; `closed` for `closed` and
   *  `abandoned`), every other caller `'closed'` (a no-outcome drop: another puzzle opening, `restore`,
   *  `chapterChanged`, `disposePuzzle`, which becomes `() => dropPuzzle('closed')`, `yields.ts:866`), `dispose` null.
   *  Round 9 (critique_engine_r8 W1, RULINGS 135 (b)): emitted through `endFrame` in the same synchronous block as the
   *  frame's clear, while the frame is still in the DOM. The end rows are `resolveAt: 'emit'`, so the stage captures the
   *  frame's inner wrapper `[data-cue-frame]` and its box inside the emit; the clear's flush starts the root's
   *  `layerOut` (`LAYER_MOTIONS.frameOut`), which keeps the wrapper attached until the end motion is over; the end
   *  motion animates the wrapper and the outro the root, so their transforms nest. A frame `hideFrame` already hid is
   *  not shown, so its later drop emits nothing. Round 11 (critique_engine_r10 m5): the order is `endFrame(o, cue)`,
   *  `setLadder(o, null)` (its `waited` when busy) and `screens.close('hints')` (the screens diff's `panel-close`), all
   *  while `open === o` and the frame is shown, so their cues pass the shown-frame test; then `open = null`,
   *  `clearRetry()`, `o.session.dispose()`, `puzzle.frame = null`, `screens.close('puzzle')`. Main clears `open` first
   *  (`yields.ts:497-509`), which would drop the ladder hold's `waited` and emit the sheet's slide-out for a frame
   *  already gone. The `puzzle` screen stays until the last step, so the synchronous `screensChanged` of the `hints`
   *  close (`boot.ts:269-273`, `screens.ts:111-118`) takes no X8 branch. */
  type DropCue = Extract<PuzzleCue, 'solved' | 'failed' | 'closed'> | null;
  const dropPuzzle: (cue: DropCue) => void;
  /** Round 9 (m2): the one end emission of a frame, shared by `dropPuzzle` and `hideFrame`. Round 11
   *  (critique_engine_r10 W1): first `holdLoad(o, false)`, whatever the frame's shown state, so a load hold (the first
   *  load's or a Retry's) ends with its frame, a Back, a `restore`, a chapter change or another open before the host
   *  lands included (round 9 ended only a shown frame's `retrying` hold); then, when the frame is shown (the
   *  shown-frame test), `cue`; else nothing more. */
  const endFrame: (o: Open, cue: Exclude<DropCue, null>) => void;
  /** Round 9 (m1, m4): hides a frame whose session ends later. `endFrame(o, 'closed')`, then (round 11,
   *  critique_engine_r10 m5: while the frame is still shown, so their cues pass the shown-frame test) `setLadder(o,
   *  null)` (its `waited` when busy) and `screens.close('hints')` (a no-op at both callers today: an X8 Back pops
   *  `hints` before `puzzle`, and a view's leave control lies under the ladder sheet's inert room), then
   *  `puzzle.frame = null`, `o.hidden = true`, and
   *  `unshowCloseup(o)` (the close-up fade and `roomShown()`, taken out of `onEnd`'s `closed` branch, `yields.ts:549-556`,
   *  which now runs it only when `!o.hidden`; `ended` gets `o.closeup && !o.hidden`). `open` stays `o` until the
   *  session's end, so a decisive answer still reaches `onEnd` -> `ended` and the world. Callers: the X8 Back in
   *  `screensChanged`, **before** `o.session.close()` (GM3p), and the zoom-out's `room` effect, before the same close
   *  (GM8h, replacing its own clearing lines). */
  const hideFrame: (o: Open) => void;
  // `Open` gains `hidden: boolean` (false at `openPuzzle`). Every frame cue yields emits (`puzzle:*`, the frame's and
  // the ladder's `ui-state`) passes the shown-frame test, so a hidden frame's countdown or late reply plays nothing
  // (round 11: except the load hold's two keys, `holdLoad` below, which pass the open test).
  /** Round 10 (critique_engine_r9 W1): the frame is on screen. The condition App's frame layer renders by
   *  (`App.svelte:103-113`: the host component while `puzzle.host !== null`, else the `.host-failed` block while
   *  `loadFailed`) and GM8h's room place likewise; before it holds, the frame layer is an empty `div`. */
  const shownFrame: () => boolean;   // puzzle.frame !== null && (puzzle.host !== null || puzzle.frame.loadFailed)
  /** Round 10 (W1): called after each write that can show `o`'s frame: the frame write in `openPuzzle` (before any
   *  other cue of that open) and the chunk write in `loadPuzzleUis` (round 12, critique_engine_r11 m1: after its
   *  `holdLoad(o, false)`, whose `waited` goes first as a room batch's does, and before `opened` /
   *  `load-failed`). At the first call after which `open === o && !o.hidden && puzzle.frame?.id === o.id &&
   *  shownFrame()`, sets `o.appeared = true` and emits `ui-state:panel-open` (`panel: 'puzzle'`) in that block, then,
   *  when the frame it shows is `busy` (per-player's values wait still in flight), `puzzle:checking`, so a wait that
   *  began before the frame showed breathes on screen as one that began after; else nothing. The one emitter of a
   *  frame's `panel-open` (round 9's emission at the frame write becomes this call) and of the `puzzle:checking` of a
   *  frame that opens waiting (per-player's open writes `busy` into the frame literal and emits no cue of its own). */
  const appear: (o: Open) => void;
  // `Open` gains `appeared: boolean` (false at `openPuzzle`). The shown-frame test reads, from round 10,
  // `open === o && !o.hidden && o.appeared && puzzle.frame?.id === o.id`: a cue of a frame that has not appeared yet
  // (per-player's values-wait cues, `endFrame` at an X8 Back, a `restore`, a chapter change before the host lands) is
  // dropped, never held, since nothing of the frame was on screen; the frame appears in its current state.
  /** Round 11 (critique_engine_r10 W1; point 11 below): the frame's load hold, one per `Open`. When `on` differs from
   *  `o.loading`: sets `o.loading = on` and emits `ui-state:waiting` (true) or `ui-state:waited` (false) with
   *  `panel: 'puzzle'`, `box: null`; else nothing. It passes the **open test** (`open === o`), not the shown-frame
   *  test: the wait is on screen whether or not the frame is (the hold plays at the `centre` landing while no notice
   *  shows, §8.5 "Cue targets"). Calls: the frame write in `openPuzzle` (true, after `appear(o)`), `onretry` (true;
   *  round 7's emission), the chunk write in `loadPuzzleUis` (false, **first**, before `appear(o)` and `puzzle:opened`
   *  / `load-failed`; round 7's emission; round 12, critique_engine_r11 m1: one order, the wait's end before the state
   *  it ends in, as the room batch emits `waited` before its move cue, §8.1 Sources), `endFrame` (false; round 9's
   *  Retry `waited`). So the chunk write of an unshown frame emits `waited@puzzle`, `panel-open@puzzle`,
   *  `puzzle:opened`, the order the first-puzzle e2e asserts. `o.loading` holds exactly while
   *  `loading(puzzle.frame)` does, which the state gate's hold balance checks from the views. */
  const holdLoad: (o: Open, on: boolean) => void;
  // `Open` gains `loading: boolean` (false at `openPuzzle`). The views' predicate the gate reads:
  // loading(f) = f !== null && ((f.ui === null && !f.loadFailed) || f.retrying).
  // Round 11 (found): the close-up's batch in `openPuzzle` (`yields.ts:587-592`) is wrapped by the room's `null`
  // hold. Round 12 (critique_engine_r11 W1; RULINGS 135): that wrapping is `held` below, the one batch site (GM3s),
  // which every batch of yields calls; GM3p adds no emission of its own around the close-up.
  /** Round 12: the one site that applies a visual batch for the views. Emits `ui-state:waiting` (`panel: null`,
   *  `box: at.box`; the stage lands a null box at `centre`) before `h.apply`, and from that apply's `started` (GM3w's,
   *  called exactly once per apply, the empty list included) `ui-state:waited`, then `at.atStart?.()` (the room batch's
   *  built move event and its dispatch's held cues, §8.1 Sources, in that order). A dead session drops the hold with
   *  the bus, as a dead room batch does today (`yields.ts:388`). Callers: the room batch (`at.box` = its `via` box, or
   *  null), the state batch (GM3b: `controller.stateHold(diff)`; round 13, critique_engine_r12 m1: the first changed
   *  anchor that draws an image, else `'no-load'`), the close-up in and out (`openPuzzle`, `ended`, `onEnd`'s `closed`
   *  branch: null). `h.apply(` occurs once in `yields.ts`, inside `held` (pin `yields: every batch goes through held`;
   *  round 14, critique_engine_r13 W1: GM3p's request walk checks it by declaration, the one reference to
   *  `YieldsHost.apply` anywhere in `client/src`, and retires the pin).
   *  Round 13 (RULINGS 148 m1): `'no-load'` applies the batch with neither emission; only `stateHold` returns it, and
   *  only for a batch that adds no image to the stage, so it has no load to cover (the two emissions test `at`, an
   *  expression inside their own lines). Round 14 (critique_engine_r13 m3): honoured only while
   *  `h.scene.stats().reviving` is false; while a revive runs, `stage()`'s `ensure` waits on every stale record of the
   *  batch, so `held` holds at `centre` (`box: null`) as for a box-less batch. `YieldsHost.scene` is
   *  `Pick<SceneController, 'preload' | 'releasePreload' | 'snapshot' | 'stats'>` (GM3s; `yields.ts:90`).
   *  Reconcile r1 (critique_engine_r14 m1; RULINGS 152 Q14 (a)): the predicate is
   *  `h.scene.stats().stale === 0 && !h.scene.stats().reviving` (`scene/controller.ts:40`, `:46`, `:530-547`): an
   *  aborted revive (`controller.ts:519`; `registry.ts:423`) leaves live records stale with `reviving` false, and
   *  `acquire` on a live stale record waits for the next revive (`registry.ts:483-488`, `:380-382`), which the next
   *  `activated` starts (`controller.ts:318-320`), so `'no-load'` is honoured only with no stale
   *  record at all. Conservative, never short: a stale record the batch does not name still holds it, and that
   *  hold ends at `started` within a microtask when nothing waits (below `WAIT_DELAY_MS`, invisible). */
  type HeldAt = { readonly box: Box | null; readonly atStart?: () => void };
  const held: (visual: readonly VisualCommand[], audio: readonly AudioCommand[],
    at: HeldAt | 'no-load') => Promise<void>;
  ```

  | Field | Writers (set / clear) | Never written by |
  |---|---|---|
  | `busy` | `post(o)` / `attempted`'s settling branches and `countdown`'s first tick (its later ticks re-write `false` over a frame nobody can make busy during a countdown: `post(o)` refuses while `retryAfter !== null`, and `syncValues` holds during a countdown, [per-player §5.5 Puzzle session changes](../per-player/05-client-half.md#55-puzzle-session-changes-puzzlessessionts-and-openpuzzle)); per-player's values and restart waits / `syncValues`, `settle` | the chunk load, `onretry`, a `busy` reply (§8.1 round 7 m3), the ladder |
  | `retrying` | `onretry` / `loadPuzzleUis` | everything else |
  | `loadFailed`, `ui` | `loadPuzzleUis` (and `onretry` leaves `loadFailed` true until the answer) | everything else |

  **Neither wait wins** (the critic's question): the values wait and a chunk failure sit on disjoint fields and
  targets. A per-player lock opened while its values load, whose type chunk then fails: the body shows the notice with
  Retry **enabled** (`retrying` false) and `puzzle:load-failed`'s wobble; the status line keeps «Проверяем…» and Try
  stays off (`busy`). Retry breathes the notice (`ui-state:waiting`, `panel: 'puzzle'`; round 9, critique_engine_r8
  m3: a hold with `box: null` resolves its panel's `[data-cue-notice]` when the panel shows one, §8.5 `box` row, while
  `puzzle:checking`'s `breathe` plays on the frame wrapper, so the two waits move two nested elements) until the reload answers
  (`waited` + `puzzle:opened`, the type UI arriving with its input off while `busy`, or `puzzle:load-failed` again);
  the values' end plays `puzzle:ready` / `renewed` on the status line whatever the chunk's state. Try lights only when
  both are over (`canTry` = `ui !== null && !busy && ...`, `PuzzleHost.svelte:23`), at the later of the two cues. A
  cached chunk under a values wait: `puzzle:opened` arrives with `busy` still true, so the dials stay inert and Try off
  until `puzzle:ready` (per-player's W6 holds; the round-7 text broke it).

  **Ends.** `onEnd(o, e)` calls `dropPuzzle(e.outcome === 'solved' || e.outcome === 'failed' ? e.outcome : 'closed')`
  (`yields.ts:544-548` today calls `dropPuzzle()`), so a solve plays `puzzle:solved` (`flourish`), the limit's last
  wrong answer `puzzle:failed` (`jam`; ch1's `gate`, an `order` puzzle with `maxAttempts: 3`,
  `story/ch1/world.json:39-45`), and a give-up or a no-outcome drop `puzzle:closed` (`iris` out), each on the frame's
  inner wrapper while its root leaves (round 9: `jam` and `flourish` animate the wrapper, element site; `iris` draws on
  the stage layer at the wrapper's box, box site; the root's `frameOut` animates the root; none shares an element
  with another, so no `replace` composite drops one); the world's own cue (`fact:solved:added`, ...) follows from
  `ended` as built. `attempted`'s `correct` / `failed` cases stay without cues (unreachable while `#end` runs the
  listeners synchronously; a test pins the order). **An X8 Back** (round 9, critique_engine_r8 m1) runs
  `hideFrame(open)` and then `open.session.close()` (`yields.ts:852-854` today calls only the close): the frame irises
  out at the Back whether or not an attempt is in flight; with none in flight the close ends the session at once and
  `dropPuzzle('closed')` finds no shown frame, so one close plays one motion; with one in flight its decisive answer
  lands in `onEnd` -> `ended` as before and opens the lock in the room (`fact:solved:added`), with no frame cue.
  **Every frame's appearance** (round 9, m4; round 8 named only a frame with no screen) gets `ui-state:panel-open`
  (`panel: 'puzzle'`) from yields **at the write that shows it** (round 10, critique_engine_r9 W1: `appear(o)`; the
  frame write, `yields.ts:610`, when the host chunk is in, else the chunk write, `:516-520`, the first frame of every
  page load included), for an overlay, a linear and a view frame alike, since the screens diff no longer speaks for
  `puzzle`; a view frame is written after its room's crossfade (the `puzzle` effect's job follows the `room` job,
  `yields.ts:285`, `:304`, `:387`), so its bar slides in after `move:zoom-in` has played, at that write or, for the
  session's first frame, at the chunk write. Its removal is covered by the end cue above (no `panel-close` is emitted for a
  frame: the open's `dim` is a pulse with `fill: 'none'`, §8.6, so nothing holds to release).
  **Rejected:** a tri-state `load: 'ok' | 'failed' | 'retrying'` replacing `loadFailed` (the same bytes, but every
  reader of `loadFailed` in App, PuzzleHost and the test fixture changes for a rename); `loadPuzzleUis` clearing only
  the `busy` its own Retry set (one field would still carry two meanings, and per-player's `post`-time and wait-time
  readers would need to know which); keeping the end cues in `attempted` and having `#settle` defer `#end` (a session
  change for a cue, and `onEnd`'s `dropPuzzle` would then run after `attempted` wrote a `solved` line on a frame about
  to vanish).
- **One player, no scopes (W3).** The round-1 scope routing is withdrawn: its two layers lived inside `ExploreView` and
  `PuzzleHost`, so a linear puzzle (no section, `yields.ts:795-796`) and every cue that ends the room view
  (`toStory` sets `explore.layer = null`, `yields.ts:261-264`, in the same dispatch whose `story` effect the reducer
  appends last, `reduce.ts:539-542`) had no live player. Now **one `CueStage`** is mounted by `App.svelte` as a
  `pointer-events: none`, `aria-hidden` full-bleed layer **above** the puzzle layer and below the menu / meta overlays
  and toasts, for the whole GameSession (`vm.cueStage`). It resolves targets in the document (`[data-cue]` controls,
  `[data-cue-frame]`, `[data-cue-panel]`, the ribbon slot by `data-cue-item`, hotspot boxes from `CueEvent.box`), so it
  can play on any layer. Every cue plays exactly once because there is one subscriber.
- **When a cue's DOM target is found (round 9; critique_engine_r8 W1; RULINGS 135 (b), owned by GM3s).** The views are
  `$state.raw` (`puzzle-view.svelte.ts:69-73`) and Svelte 5 applies a write's DOM in a later flush, so inside the block
  that emits a cue an element the block creates is not in the document yet and one it removes is still there. One
  rule per target lifetime:

  ```ts
  // client/src/cues/stage/motions.ts (GM3m): per motion and per `with` entry
  /** `'emit'`: the target exists before the emitting block and may leave with it. The rows: `fact:held:removed`
   *  (and its `with`), `fact:doc:removed`, `fact:used:added` and `fact:slot:added` (their `drop` starts at the
   *  consumed item's ribbon slot), `ui-state:deselect` (a use may consume the selected item), `ui-state:panel-close`,
   *  `ui-state:waited`, `puzzle:solved`, `puzzle:failed`, `puzzle:closed`; every `control` target is `'emit'` by
   *  kind. Absent: `'flush'`, the block may create the target (a staying target is found either way). A two-endpoint
   *  preset (`fly`, `drop`) resolves both endpoints at the motion's point; a box endpoint needs no element. */
  readonly resolveAt?: 'emit';
  // client/src/cues/stage/presets.ts (GM3m)
  /** What a preset moves: the target element itself, a drawing on the stage layer at the target's box, or the stage. */
  export type PresetSite = 'element' | 'box' | 'stage';
  export const PRESET_SITE: { readonly [P in PresetId]: PresetSite };
  // element: press, pulse, shake, wobble, roll, breathe, flourish, jam, lift, settle, unfold;
  // box: glint, tick, burst, ripple, iris, fly, drop; stage: sweep, vignette, dim, caption.
  ```

  1. **Emitters** emit a cue in the same synchronous block as the view write it describes (no `await` between them;
     every site of §8.1 does: the controller writes the views before it hands out the effects, `controller.ts:294-309`;
     yields' writes and emits share a block). A control cue is the family root's, emitted at the event before any
     handler; the tap's own dispatch is a later block (`game.ts:401-405`), with its own cues.
  2. **Capture, inside the bus emit** (CueStage's `overlay` subscriber calls the player's `capture(e)`
     synchronously): every `'emit'` motion's target is resolved now, in the pre-flush DOM, with its box (stage
     coordinates); a `control` target is `e.el` with `e.box`.
  3. **One `tick()`** (Svelte 5's, imported by `CueStage.svelte`; "resolves once any pending state changes have been
     applied"), then **run** (`player.run(plan)`): every `'flush'` motion's target is resolved now, in the post-flush
     DOM. No timer. Plans run in emit order (the `tick` continuations resolve in order).
  4. **Liveness.** The resolver (CueStage's `resolve`, GM3s) never returns an element inside an outroing family root:
     a candidate `c` with `c.closest('[data-cue-root][inert]') !== null` is skipped (Svelte 5 sets `inert` on an
     element for its out transition, §1 `transitions.js:275`; no other code sets `inert` on a `[data-cue-root]`
     element: ExploreView's `inert` sits on `.room` and `.sheet`, `ExploreView.svelte:42`, `:68`, App's on its
     `.layer` divs, `App.svelte:65`, `:104`). So a frame replaced in one block (the old root outroing, the new one
     entering, both keyed by `frame.id`) gives the new frame's targets to the new frame only.
     Changed by RULINGS 195, 198 (as of `461424d`; docs lane `docs-errata-13`, group A): as merged, Branch F (GM3s
     `65e10ad`, F8): no root outros and nothing sets `inert` on a `[data-cue-root]`, so the resolver has no `inert` skip:
     a leaving root is out of the document at the flush, and its exit plays on a ghost clone on the stage layer, whose
     `id` and `data-cue*` attributes are stripped; the resolver takes the first match outside the stage layer
     (`live`, `client/src/cues/stage/index.ts:47`), so a ghost is never a live target (§8.3 "Entrances and outros").
  5. **Leaving.** An `'emit'` motion plays on its captured element while that element is in the document; the moment
     it leaves (at run, or later: a hotspot button the tap's own dispatch removes leaves after the press started),
     the motion continues on a **ghost clone** of the element (`cloneNode(true)`, `id` attributes stripped,
     `aria-hidden`, `inert`, `pointer-events: none`, placed on the stage layer at the captured box) from the same
     `currentTime`. One `MutationObserver` on the document (`childList`, `subtree`), owned by the player, observes
     only while a watched motion runs. A `box`-site preset of a gone target draws at the captured box; a `stage`-site
     preset needs no element.
  6. **End cues and the frame's outro.** No cue target is a family root (`[data-cue-root]`, the element that carries
     `in:layerIn` / `out:layerOut`): PuzzleHost's root holds one child, the frame wrapper, which carries
     `data-cue-frame`, `data-cue-panel="puzzle"` and today's frame styles (`PuzzleHost.svelte:115-128`); every resolve
     test asserts that no resolved target matches `[data-cue-root]`. An element-site end motion (`jam`, `flourish`)
     animates the wrapper while the root's `frameOut` animates the root; the gate keeps the motion inside the
     outro's duration, so the wrapper is in the document for the whole motion. Round 10 (critique_engine_r9 m2): such a
     motion is `holdEnd` (§8.5): it fills `forwards`, so the wrapper keeps its end pose (scaled out, dimmed) until the
     root's outro removes it, never snapping back to rest inside a frame that is still fading, and the leave watch
     never moves it to a ghost (its target was meant to leave with the root).
     Changed by RULINGS 195, 198 (as of `461424d`; docs lane `docs-errata-13`, group A): as merged, Branch F (GM3s
     `65e10ad`, F5-F7): the family root carries `data-cue-root` (the frame's `data-cue-root="frame"` is GM3p's PuzzleHost
     root, a carry; today only the explore layer is a cue root), not `in:` / `out:`;
     the root leaves the document at the flush and its `frameOut` plays on the root's ghost at its last box; an end
     motion caught on the leaving wrapper continues on the wrapper's clone inside that ghost (RULINGS 135 (b) restated),
     padded to the ghost's end, so the clone is never removed inside a frame still fading
     (`stage: an end motion continues on the wrapper's clone inside its root's ghost`).
  7. **Holds.** A `waited` settles the element its own `waiting` hold played on (captured with its box at the
     `waited` emit, so a notice that the reload removes settles on its ghost). Round 11: a hold that played at a box
     landing (`centre`, a `via` box) settles at that box.
  8. **A frame cue waits for its frame to be on screen (round 10, critique_engine_r9 W1).** Point 3 holds only when the
     emitting block is the block whose flush creates the target. For a frame it is not, the first time: App renders a
     frame only with the host component or the failed-host block (`App.svelte:103-115`), `puzzle.host` starts null
     (`puzzle-view.svelte.ts:70`) and only `loadPuzzleUis` sets it, after its `await` (`yields.ts:512-517`), so the
     first frame write of an engine's life mounts an empty layer and the chunk write, a later block, mounts the frame
     (promise jobs run in a fixed order, so even a settled chunk promise lands after the frame write's `tick()`).
     yields therefore keys every frame cue to the frame being on screen, not to the frame write: `appear(o)` emits the
     frame's `panel-open` at the first write after which `shownFrame()` holds (the frame write when the host is in,
     else the chunk write), and every other frame cue passes the shown-frame test with `o.appeared`, so a cue of a frame
     that has not appeared is dropped (§8.1 "The frame's flags and its ends"). The same holds for a view frame (GM8h's
     room place renders the bar only with the host); a view frame never lives under a hidden room, since a `story`
     effect closes a view session (W2 of round 1) and GM8i opens no device under an `onEnter` event (round 10, found).
  9. **A target whose rooms leave in the emitting block (round 10, critique_engine_r9 W2).** A `ribbon` target is a
     slot inside the explore root. A block that gives an item and hides the rooms (a take or an object whose `then`
     holds `{ story }`, `reduce.ts:403-404`, `:283-285`, `:539-542`; a lock whose `onOpen` gives and starts a knot; an
     `onEnter` gift with an event, whose cues are held to the batch start, §8.1 Sources) never mounts the slot: App's
     explore `{#if}` turns false in that flush (`App.svelte:67`), and point 4 would skip a slot inside the outroing
     root anyway. Neither point 2 nor point 3 covers that lifetime, so the target kind declares a landing that exists
     in every such case: a `ribbon` target with **no live ribbon** (no `[data-cue-ribbon]` outside an outroing
     `[data-cue-root][inert]`; also before GM3u, when no ribbon exists) resolves to the box **`edge`** (§8.5 "Cue
     targets": a slot-sized box centred on the stage's bottom edge, the box `byCause.carry` flies in from). The glyph
     flies from the hotspot off the bottom of the stage while the rooms leave (`layer-out`) and the stage dims
     (`fact:story:added`); the slot's `with` `pulse` is skipped, as any unresolved `with` is; the item is in the
     ribbon when the rooms return. It holds for every row whose target is `ribbon` (`fact:held:added`,
     `fact:doc:added`, `fact:slot:removed`, `fact:used:removed`), and it is timing-independent: the landing is a box on
     the always-mounted stage layer, the same whether the cues play in the dispatch's flush or at a later batch start.
     A live ribbon without the item's slot is not this case: it is a counted fallback (point 10).
  10. **Fallbacks are counted: the guard over the class (round 10; RULINGS 135).** Rounds 8 and 9 each found a path of
      one class, a motion resolved where its target does not exist (round 8 W1, round 9 W1 and W2). The player counts
      every first motion (and `byCause` variant) whose DOM target (`control`, `ribbon`, `frame`, `panel`, `status`,
      `attempts`, `part`, `tier`, `ladder`, `alert`, `notice`, after the §8.5 table's own fallbacks such as `status` ->
      `frame`) resolved to nothing and so played at the stage centre: `fallbacks()`. A `with` entry that does not
      resolve is skipped and not counted (round 7's rule); `box`, `point`, `stage` and `edge` need no element and
      never count (a box-less fact or module cue, an `onEnter` gift, plays over the stage by rule). CueStage writes the
      count as `data-cue-fallbacks` beside `data-cue-orphans` under `__TG_MOCK__`. **A fallback is a defect**: every
      real-flush test asserts `fallbacks() === 0`, and every mechanics e2e asserts `data-cue-fallbacks` 0 at its end,
      as it asserts 0 orphans, so a new path of the class is a red test in the lane that opens it, not a review round.
      Lane order keeps the assertion honest: no lane's e2e opens a surface whose marker a later lane adds (the
      screens diff speaks for `hints` from GM3u while HintLadder's `data-cue-panel="hints"` is GM3p's, and GM3u's e2e
      opens no ladder); a cut that finds such a pair moves the marker into the earlier lane, never drops the assertion.
  11. **Every wait of the views holds a motion (round 11, critique_engine_r10 W1; RULINGS 135's form for a class).**
      Round 10's unshown frame was a wait with no motion: the room inert (`App.svelte:65`), nothing of the frame on
      screen (`:103-115`) for as long as the host chunk takes. It is one path of a class, "the screen waits on a load or
      an answer and nothing moves", so the rule is over the class: **every wait of the explore and puzzle views has
      exactly one hold from the block that starts it to every block that ends it.** A hold shows from `WAIT_DELAY_MS`
      (a wait shorter than 120 ms shows nothing, round 4 m11's rule, unchanged: the tap's own control cue covers it).
      The waits, from the code (round 11 read "every visible `await` of `yields.ts`, `:387`, `:450`, `:512`, `:588`" by
      judgment and missed `:416`, which GM3b turns into a load, critique_engine_r11 W1; round 12 listed the `await`s of
      six roots, which missed a request consumed by `.then`, critique_engine_r12 W1; **round 13 (RULINGS 148): the
      request rows are the request walk's view rows below**, every request start of `client/src` a view waits on; on
      `fe996a0` the explore loader's two `import()`s (`yields.ts:68`), the host's (`:76`), the type UIs'
      (`puzzles/registry.ts:37`, `:39`), `postAttempt` (`puzzles/session.ts:221`; LBI's forwarder `game.ts:1341`),
      `getPuzzle` (`session.ts:268`; `game.ts:1337`) and `useHint` (`meta/wallet.ts:78`); a chunk Retry re-runs the
      loaders of `:512`; the batch row's loads are the scene's, which only `app/game.ts` and `scene/**` start and the
      views reach only through `held` (`yields.ts:387`, `:416`, `:530`, `:553`, `:588` become its calls in GM3s); plus
      the one wait a view flag holds with no request, a 429 countdown, a timer that the state gate's `retryAfter`
      covering checks):

      | Wait (main's line) | Starts (block) | Ends (every block) | Hold | Plays at |
      |---|---|---|---|---|
      | **a visual batch's loads** (round 12: every batch of the views, through the one site `held`: the room batch `yields.ts:387`, the take / state batch `:416` (GM3b's state batch replaces it), the close-up in `:588` and out `:530`, `:553`; `game.ts:646-654`) | `held`, before `h.apply` (GM3s; round 4's room-batch hold and round 11's close-up hold are its calls) | `started`, called exactly once per `apply` (GM3w); a dead batch (the bus is gone with it) | `ui-state:waiting` / `waited`, `panel: null` | the room batch's `via` box; the state batch's first changed anchor that draws an image (round 13, critique_engine_r12 m1: `stateHold`, GM3b, §6.4; with none, `'no-load'`: no hold, the batch loads nothing; round 14, critique_engine_r13 m3: unless a revive runs, then `centre`; reconcile r1, RULINGS 152 Q14 (a): unless a revive runs or a record is stale, `stats().stale === 0 && !stats().reviving`); with no box (an entry, a resume, an event return, a close-up) `centre` |
      | **a section's first explore-chunk import** (`:450`; round 11, found) | `openSection` before `h.chunks.explore()` while no controller exists (GM3s) | the import's settling, ok or failed (before the D13 notice), unless the session is `dead` | `panel: null` | `centre` |
      | **a frame's chunk imports** (`:512`: the host and the type together; round 11, W1) | the frame write: `holdLoad(o, true)` (GM3p) | the chunk write; `endFrame` (an X8 Back, a zoom-out, any drop: `restore`, a chapter change, another open) | `panel: 'puzzle'` | the frame's notice when one shows, else `centre` (the frame unshown, or shown with its type UI pending) |
      | a chunk Retry (round 7) | `onretry`: `holdLoad(o, true)` | the chunk write; `endFrame` | `panel: 'puzzle'` | the notice |
      | **an answer in flight** (`busy`: an attempt, per-player's values or restart wait; round 11, found: was three pulses) | `post(o)`'s `puzzle:checking`; `appear(o)`'s for a frame that shows `busy` | the same puzzle's next key in `CHECKING_ENDS` (`SETTLE_KEYS` + `puzzle:closed`: a reply's key, the countdown's, an end cue) | `puzzle:checking`'s `breathe`, looped (`MotionSpec.until`, GM3m) | the frame wrapper (the device bar in a view) |
      | a ladder request (round 7) | `setLadder`'s `busy` edge | `setLadder`'s `busy` false or its clear | `panel: 'hints'` | the ladder |
      | a 429 countdown (round 5) | `countdown`'s first tick | its zero | `puzzle:rate-limited`, once per second | the status line's number |

      Two holds that can overlap sit on two elements: a values wait over a type chunk that loads moves the frame
      wrapper (`checking`) and the `centre` ring (the load hold); a Retry during a values wait moves the wrapper and the
      notice. A wait of the story path (a knot's first batch after a section leave, `enterKnot` -> `continueStory`,
      `yields.ts:435`) is GameSession's, its motion the story's transition, outside this file (§8.2 "Outside this
      mechanism", Q4). No hold can play before the cue stage exists, so the stage is requested ahead of the first wait
      it must cover: at the first line (D13), at a resume onto a yield (`prefetch()` at `restore`, round 11, beside the
      resumed pictures: the stated trade of "Loading" below), and (round 12, critique_engine_r11 m5) at every yield
      step between its pictures' loads and its transition (`ahead(y)`, "Loading"), so a chapter whose first step is a
      yield gets its stage while that step's transition runs; it also stays mounted for the GameSession (§10), so only
      a session's first chapter can meet the residual case, a bare yield step with no transition, where the first hold
      shows from the stage's mount, one request after the yield (stated in "Loading"). **The guard:**
      GM3p's `yields: every wait of the views holds a motion` drives each row's start and each of its ends on fixture
      loaders, a fixture `apply` with a late `started` and a fake clock, and asserts after every block one open hold per
      panel while its wait runs and none after it ends, and that no hold the row's script does not declare for that
      block opens or closes in it (round 12, m2: the frame write declares the `puzzle` hold's open, the chunk write and
      `endFrame` its close; GM3s's two rows are its own tests first, §8.5); the state gate's
      hold balance checks the `puzzle` and `hints` rows from the views after every scripted step (`puzzle` iff
      `loading(puzzle.frame)`, `hints` iff `ladder.busy`); GM3m's `cues: puzzle checking breathes until its frame
      settles` checks the loop. **Round 12 (critique_engine_r11 W1; RULINGS 135), restated in round 13
      (critique_engine_r12 W1; RULINGS 148): the request rows are complete by a check at the request, the batch row
      by its one site.** A table-driven guard sees only its rows: round 11's rows were listed by reading (GM3b's state
      batch was the unlisted one), and round 12's await map read only an `await` whose operand is the request, in six
      roots (a `.then`, a returned promise, a new file passed it). So:
      - **One batch site.** Every `h.apply` of yields is inside `held` (above), so every batch, today's and every
        later one (GM3b's state batch, MR2's ambient state images, a module's picture), is the batch row by
        construction; pin `yields: every batch goes through held` (GM3s): `h.apply(` occurs once in `yields.ts`, inside
        `const held` (a source count, as `yields: the ladder has one writer` counts `puzzle.ladder =`). **Round 14
        (critique_engine_r13 W1): the site is checked by its declaration, not its spelling.** The count above sees
        only a call spelled `h.apply(` in `yields.ts`, so a batch handed on as a value (`apply: h.apply`),
        destructured (`const { apply } = h`) or bound and awaited in another file would wait with no hold. GM3p's
        request walk (below) carries `BATCH_MEMBER`: every reference to `YieldsHost.apply` (`yields.ts:105`) in any
        walked file, however it is referenced, must be the one inside `held` in `app/yields.ts`, and a structural
        re-declaration of it that receives `h` fails as a re-typed guarded member. The pin guards from GM3s until GM3p's
        commit (2), which deletes it (one check per invariant) and re-points **M-R12a** and **M-R11f** to the walk; the
        lanes between them (GM3, GM3u) add no batch site.
      - **The request walk (round 13, critique_engine_r12 W1; RULINGS 148: every request start is a declared site;
        it retires round 12's await map).** `requests: every request start is a declared site` (GM3p, the new
        `client/src/requests.test.ts`, `// @vitest-environment node`; test-only, 0 bundle bytes) builds one
        `ts.createProgram` from `client/tsconfig.json` (`typescript` 6.0.3, `client/package.json:33`; the repo's first
        type-checked test: every other `ts` use is `createSourceFile`, `arch.test.ts:312`, `:916`, `:962`) and walks,
        with its checker, every `.ts` file under `client/src` except `*.test.ts`, `*.d.ts`, `api/generated/**` and
        `story-gen/**`, so a new directory is walked with no author step (fail closed). `.svelte` scripts are parsed
        (through `svelte/compiler`'s `parse`, as `controls.test.ts` reads components) and checked by name only, since
        the checker does not read them:

        ```ts
        // client/src/requests.test.ts (GM3p; round 13, round 14)
        /** The ports whose members start a request. An exported object type of `api/**` (not `generated/`) with a
         *  member returning a `Promise` that is not listed fails ("unlisted port"). */
        const REQUEST_PORTS = [
          { file: 'api/endpoints.ts', port: 'Endpoints' },                 // 11 members, endpoints.ts:47-65
          { file: 'api/meta.ts', port: 'MetaEndpoints' },                  // 13 members, meta.ts:270-290
          { file: 'api/http.ts', port: 'Http', members: ['auth', 'request', 'fetchAsset'] },   // http.ts:69-80
        ] as const;
        /** Round 14 (critique_engine_r13 m1 (a)): the asset transport. A value-position reference whose type is this
         *  alias's declared type (identity after `getNonNullableType`) and that is no port member reference is a
         *  start, member `'FetchAsset'`. */
        const TRANSPORT = { file: 'story/catalog.ts', alias: 'FetchAsset' } as const;          // catalog.ts:756
        /** Round 14 (critique_engine_r13 W1): the one batch member. Every reference to it, in any walked file, is
         *  the one inside the batch site in `file`. Reconcile r1 (critique_engine_r14 m3; RULINGS 148 O1, 152): the
         *  site is bound to `held`'s declaration, not its name: the one function-like declaration in `file` with a
         *  parameter whose declared type names `site` (the type alias `HeldAt`, resolved by the checker to its one
         *  declaration in `file`; `held`'s `at: HeldAt | 'no-load'`). Zero or two such declarations fail ("batch site
         *  <n> declarations"), as zero or two aliases of that name in `file` do; from the alias on, the walk compares
         *  symbols, never names, so a function named `held` without that parameter is no site. */
        const BATCH_MEMBER = {                                                                   // reconcile r2: row shape
          label: 'batch',
          member: { file: 'app/yields.ts', type: 'YieldsHost', name: 'apply' },                  // yields.ts:105
          site: { file: 'app/yields.ts', alias: 'HeldAt' },
        } as const;
        /** Reconcile r2 (per-player R-E34, adopted with a change): one mechanism for "this member only inside that
         *  site", a row per member. Per row, the checks above, unchanged: every reference to `member` (by its
         *  declaration in `member.file`, through a property access, a string-keyed element access, an object binding
         *  element, a `.bind` / `.call`, a value hand-off) in any walked file lies inside the one function-like
         *  declaration in `site.file` with a parameter whose declared type names `site.alias`, and there is exactly one
         *  such reference program-wide. Messages: "<label> outside <site fn> <file> <fn>", "<label> site count <n>",
         *  "<label> site <n> declarations"; for the batch row they read exactly as before ("batch outside held ...",
         *  "batch site count <n>", "batch site <n> declarations"), so M-R14a-M-R14c, M-RCb-M-RCj and the re-pointed
         *  M-R12a / M-R11f keep their predicted text. The change to R-E34's shape: the member's declaring file and
         *  the site's file are separate fields (per-player's row declares `ValuesStore.render` in `app/values.ts` and
         *  its site in `app/yields.ts`), and `label` keeps the messages. Per-player GM6c2 appends its row (E-P29). */
        type SiteMember = { readonly label: string; readonly member: { readonly file: string; readonly type: string;
          readonly name: string }; readonly site: { readonly file: string; readonly alias: string } };
        const SITE_MEMBERS = [BATCH_MEMBER] as const satisfies readonly SiteMember[];
        /** Reconcile r1 (critique_engine_r14 m2 (a)): every member of `YieldsHost`, at any depth (property types and a
         *  function member's return type, so `hints()`'s `HintPort`; parameter types, such as `notice`'s `retry`, are
         *  not followed; by declaration, a `Pick` keeps it; a visited set ends recursive types), whose type is a
         *  function returning a `Promise` and that is no `REQUEST_PORTS` member is a
         *  row here, naming the wait that covers it. Reconcile r2 (RC-W4), the reach exactly: a member is a row
         *  candidate, and its type is followed, only if its declaration lies in a non-declaration `.ts` source file
         *  under `client/src` (S1: `!sf.isDeclarationFile`, the path under `client/src/`, the extension `.ts`, which
         *  `.svelte.ts` runes modules have and `.svelte` files and the `*.svelte` shim do not); from such a member the
         *  walk follows its type's properties, the return type of each of its call signatures and each union member;
         *  it never follows parameter types, type arguments (an array's element, a `Promise`'s value, a `Map`'s
         *  entries) or index signatures. So `stageHost()`'s `HTMLElement` (lib.dom), a returned `Promise`'s `then`
         *  (lib), a Svelte `Component`'s exports (`node_modules`) and a `.svelte` module's types end the walk there,
         *  while `hints()` -> `HintPort.use` (declared in `puzzles/session.ts`) stays a row. On `cec347c` the reach is
         *  §1's row "(reconcile r2) The host-wait walk's reach": exactly the eight rows below.
         *  A member with no row fails ("unlisted host wait <Type.member>"),
         *  a row with no member fails ("stale host row <Type.member>"). The rows below are what `yields.ts:85-117`
         *  declares on `acc4e0d` and `cec347c` (CLAIM, MEASURED by the self-test at GM3p's red-first; a difference is a
         *  STOP item at its cut, not a row edit). */
        const HOST_WAITS = [
          { member: 'YieldsHost.apply', wait: 'batch' },                     // held's (BATCH_MEMBER)       yields.ts:105
          { member: 'YieldsHost.continueStory', wait: 'story' },             // the story path's step      yields.ts:108
          { member: 'YieldsHost.tap', wait: 'intent' },                      // D7: completes a batch      yields.ts:114
          { member: 'YieldsHost.queue', wait: 'intent' },                    // after the batch in flight  yields.ts:116
          { member: 'LazyChunks.explore', wait: 'import()' },                // a request row's            yields.ts:66
          { member: 'LazyChunks.puzzleHost', wait: 'import()' },             //                            yields.ts:74
          { member: 'LazyChunks.puzzleUi', wait: 'import()' },               //                            yields.ts:81
          { member: 'HintPort.use', wait: 'ladder' },                        // through `hints()`          yields.ts:97
        ] as const satisfies readonly { member: string; wait: 'batch' | 'story' | 'intent' | 'import()' | 'ladder' }[];
        /** The lib's network starts: a declaration of one of these names in a default lib file. */
        const LIB_STARTS = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'sendBeacon'] as const;
        /** Point 11's rows. yields.test.ts keeps `WAIT_CASES: { readonly [R in WaitRow]: WaitCase }` (a type-only
         *  import of this type), so `tsc` refuses a row with no case; per-player GM6c2 adds `values`, `restart`. */
        export type WaitRow = 'batch' | 'explore-import' | 'frame-chunks' | 'answer' | 'ladder';
        /** Round 14 (found): a view row never names `batch`, whose completeness is `held`'s alone (BATCH_MEMBER). */
        type ViewWait = Exclude<WaitRow, 'batch'>;
        type Member = `${'Endpoints' | 'MetaEndpoints' | 'Http'}.${string}` | 'FetchAsset' | 'import()'
          | (typeof LIB_STARTS)[number];
        type SiteRow =
          | { readonly kind: 'view'; readonly file: string; readonly fn: string; readonly member: Member;
              readonly waits: readonly [ViewWait, ...ViewWait[]] }          // the holds that cover it
          | { readonly kind: 'other'; readonly file: string; readonly fn: string; readonly member: Member;
              readonly reason: string }                                     // one line: why no view waits on it
          | { readonly kind: 'port'; readonly file: string; readonly within: string; readonly reason: string };
        const REQUEST_SITES: readonly SiteRow[];   // on fe996a0: 8 view, 50 other (round 14: + 11 transport rows),
                                                   // 3 port rows (§1 "(round 13)", "(round 14) The transport")
        /** Rows whose completeness is not the walk's request table: `batch` is BATCH_MEMBER's. */
        const HELD_ROWS: readonly WaitRow[] = ['batch'];
        /** The only files that may name `SceneController`'s `ensure`, `apply`, `restore`, `mount`. */
        const SCENE_LOADERS = ['app/game.ts', 'scene/'] as const;
        /** A file under these holds view rows only. */
        const VIEW_FILES = ['app/yields.ts', 'explore/', 'mechanics/', 'puzzles/', 'ui/explore/', 'ui/puzzles/'] as const;
        /** Round 14 (W1's structural form, m1 (b)): the members a value flow may not re-type: every REQUEST_PORTS
         *  member, BATCH_MEMBER and SceneController's loading members by declaration; TRANSPORT by type. */
        type Guarded = { readonly kind: 'decl'; readonly decl: ts.Declaration } | { readonly kind: 'transport' };
        /** Round 14 (m1 (c)): names a `.svelte` script may not hold (components are presentational). */
        const COMPONENT_BANNED = ['YieldsHost', 'SceneController', 'Endpoints', 'MetaEndpoints', 'Http', 'FetchAsset',
          'fetchAsset'] as const;
        ```

        **Ruled: RULINGS 233** — Point 11 restated: `HOST_WAITS` has **nine** rows, not eight: GM3s's optional
        `LazyChunks.cueStage?()` loader (`client/src/app/yields.ts:66` on `8d388ba`) postdates the list above (written on
        `cec347c`), so GM3p's cut adds the row `{ member: 'LazyChunks.cueStage', wait: 'import()' }` (GM3p cut r1 Q1);
        never an exclusion, and `cueStage` stays optional.
        **Ruled: RULINGS 243** — as merged (GM3p `d478384`): the nine rows are `client/src/requests.test.ts:64-74`
        on `a064399`, the ninth `LazyChunks.cueStage`; the walk's reach test `requests: the host-wait walk's reach on
        the tree is the HOST_WAITS rows` (`:1273`) pins the count.

        **A request start** is (a) a `PropertyAccessExpression`'s name, a string-keyed `ElementAccessExpression` or a
        value-position `BindingElement` (a destructured member) whose symbol (`checker.getSymbolAtLocation` for the
        first two; round 14, found: for a binding element, its property's symbol,
        `checker.getPropertyOfType(checker.getTypeAtLocation(pattern), propertyName ?? name)`, since the location
        gives the local variable) has a declaration that is a member of a listed port; (d) (round 14,
        critique_engine_r13 m1 (a)) a value-position reference of the same three shapes, or an identifier, whose type
        is `TRANSPORT`'s declared type (identity after `checker.getNonNullableType`: a `Pick<Http, 'fetchAsset'>`, an
        optional property and an alias of the alias keep the identity; a structural re-declaration does not, and its
        flow is "re-typed" below) and that is no port member reference: member `'FetchAsset'`; (b) an `import()` call (a `CallExpression` on the `import`
        keyword; a `typeof import(...)` type query is not one) or a non-eager `import.meta.glob` (Vite turns it into
        `import()`s; the two on `fe996a0`, `app/boot.ts:77` and `story/chapters.ts:68`, are eager `?url` globs, static
        imports whose files are fetched through `fetchAsset`, so not starts); (c) a reference whose declaration is a `LIB_STARTS`
        name in a default lib file (`program.isSourceFileDefaultLibrary`); type positions are skipped. How its promise
        is consumed (`await`, `.then`, returned, stored) does not matter, and a member referenced as a value
        (`const f = h.api.getPuzzle`, `{ fetchAsset: d.http.fetchAsset }`) counts. `fn` is the nearest enclosing named
        function: a function declaration, a method (`#fetchStatus` for a private one), or a function expression or
        arrow named by the variable, property or class field whose initializer holds it with no function in between
        (`send` for `deps.fetch ?? ((input, init) => globalThis.fetch(input, init))`); an anonymous one (a call's
        argument, an IIFE) passes to the next enclosing function; the top level is `<module>`. **Failures:** a start
        that matches no row ("unlisted request start <file> <fn> <member>"); a row that matches no start ("stale
        row"); two named functions of one `fn` with starts in one file ("ambiguous fn"); an `other` row in a
        `VIEW_FILES` file; a `port` row outside the file that declares its port (a port row matches every start inside
        its `within` function's subtree); an unlisted port; an element access with a non-literal key on a value of a
        port type ("computed port access"); a `WaitRow` outside `HELD_ROWS` that no view row names ("orphan wait
        row"); a `SceneController` loading member referenced outside `SCENE_LOADERS` ("scene load outside
        app/game.ts and scene/"); in a `.svelte` script, a request member's name, `import(` or a `LIB_STARTS` name
        ("request in a component"); round 14: a reference to `BATCH_MEMBER` outside `held` in `app/yields.ts` ("batch
        outside held <file> <fn>"), or other than exactly one inside it ("batch site count <n>"), and a computed
        element access on a `YieldsHost` value (as on a port); a re-typed guarded member (below; "re-typed <guarded>
        <file> <fn>"); a `COMPONENT_BANNED` name in a `.svelte` script ("guarded type in a component"); reconcile r1:
        "inside `held`" is inside the one batch site's declaration (`BATCH_MEMBER.site`; zero or two sites: "batch site
        <n> declarations"), and "exactly one" counts over the whole program, not per function (two references anywhere,
        both inside the site included: "batch site count 2"); the computed access on a `YieldsHost` value reports
        "computed YieldsHost access <file> <fn>"; an unlisted or stale `HOST_WAITS` row ("unlisted host
        wait", "stale host row"); a guarded member widened away (below; "widened <guarded> <file> <fn>").
        **The batch member (round 14, critique_engine_r13 W1).** `YieldsHost.apply` is resolved like a port member
        (the three reference shapes of (a), by declaration), so a call, a value hand-off (`apply: h.apply`), a
        destructure (`const { apply } = h`), a `.bind` / `.call` (a property access on `h.apply`) and a string-keyed
        access are each one reference; the implementation in GameSession's host object (`game.ts:1365`, a property
        assignment) is a declaration, not a reference. It replaces the spelling pin's reach with the declaration's.
        Reconcile r1 (critique_engine_r14 m3): the enclosing site is found by declaration too: the walk resolves
        `HeldAt` (`checker.getSymbolAtLocation` on its alias name in `app/yields.ts`) and takes the one function-like
        declaration in that file one of whose parameters has a type node that references that symbol; a reference to
        `YieldsHost.apply` counts as inside the site only if that declaration is among its ancestors. So an item
        lane's `const held = async (item: ItemId) => { ...; await h.apply(...) }` (`held` is the world's word for
        carried items, `client/src/explore/state.ts:20`) is "batch outside held app/yields.ts held", and a second
        function with an `at: HeldAt` parameter is "batch site 2 declarations"; the count of references is
        program-wide, so a second reference inside the one site is "batch site count 2".
        **Host waits (reconcile r1, critique_engine_r14 m2 (a)).** `SCENE_LOADERS` confines references, not closures:
        `app/game.ts` builds the views' host (`game.ts:1349-1410`) and may wrap `scene.ensure` in a new host member
        (`warm(ids): Promise<void>`) that `yields.ts` awaits with no hold and no reference to any guarded member.
        `HOST_WAITS` makes the host's promise-returning members a listed set, as `REQUEST_PORTS` does for a port's:
        a new one is red in the lane that adds it until it has a row, and its row names the wait that covers it (the
        cut reviews the row, as it reviews a view row). Port members are excluded (their starts are rows already);
        `SceneController` members are not on the host (`YieldsHost.scene` is a `Pick` without its loading members,
        `yields.ts:90`, and widening it is **M-R13e**). Per-player's GM6 hosts follow the same rule (E-P28).
        **Re-typed guarded members (round 14; W1's structural form, m1 (b)).** The guarded members are every
        `REQUEST_PORTS` member, `BATCH_MEMBER` and `SceneController`'s `ensure` / `apply` / `restore` / `mount` (by
        declaration) and `TRANSPORT` (by type). At every value flow into a declared type (an argument of a call or
        `new`, against the resolved signature's parameter type; a property, shorthand or spread element of an object
        literal and an element of an array literal, against their contextual type; an initializer of a variable,
        property or parameter with a type annotation; a `return` or arrow body of a function with a declared return
        type; an assignment's right side; an `as` / `satisfies` / `<T>` assertion, against the asserted type), the
        walk compares the source type S with the target type T (`getNonNullableType` on both; each constituent of a
        union target): a transport-typed S needs a transport-typed T; for every property path of S, at every depth
        (a visited set over (S, T) pairs ends recursive types), that holds a guarded member, T's member of that name
        (a property, else its string index signature) must hold the same declaration (the transport: the same type)
        or be absent (a `Pick` without it drops it: nothing can call it through T); a T member, or index signature,
        that re-declares it fails. So a module that declares its own `{ getValues(...): Promise<...> }` or
        `{ apply(...): Promise<void> }` and receives `deps.api` or `h` whole is red where the value flows, not
        silent where it is called. A T that is `any` is not followed (below). Reconcile r1 (critique_engine_r14 m2
        (b), (c)): **a constrained generic** is compared twice: against the instantiated parameter type (which is S
        itself when the argument infers it) and against the uninstantiated signature's parameter type with each type
        parameter replaced by its constraint (`checker.getBaseConstraintOfType`), so `createX<D extends { apply(...):
        Promise<void> }>(deps: D)` called with `h` is "re-typed YieldsHost.apply"; an unconstrained type parameter
        (constraint `unknown`) is skipped there, so `Object.freeze(port)` and `Promise.resolve(x)` stay green. **A
        widening:** a T with no members and no index signature (`unknown`, `object`, `{}`, after
        `getNonNullableType`) that receives an S carrying a guarded member at any depth fails ("widened <guarded>
        <file> <fn>"), since the assertion that would re-type it later sees an S with no guarded path; the old text
        here ("`unknown` cannot be called without an assertion, which is a flow point") claimed that assertion was
        caught, which it is not. A member re-declared with an indexed-access type (`getChapter:
        Endpoints['getChapter']`) is a re-declaration: it may take a wrapper or a member handed on as a value (a start
        with its row at the hand-off), and a port flowing into it whole is "re-typed". On `fe996a0` every dep type of
        a guarded member is the interface, a `Pick`, an indexed access naming one or the alias, and the one
        indexed-access member takes a wrapper (§1 row "(round 14) Every dep type"), so no flow re-types: CLAIM,
        MEASURED by the red-first; a re-type found on GM3p's parent is a STOP item at its cut. The self-test `requests: a Pick of a port resolves to the port's member` checks
        that a reference through `Pick<Endpoints, 'getPuzzle'>` (how every caller types its port: `session.ts:93`,
        `yields.ts:89`, `game.ts:132`) resolves to `endpoints.ts:57` (CLAIM: TypeScript keeps the member
        declarations of a homomorphic mapped type such as `Pick`; red would be a STOP item at GM3p's cut); round 14:
        also that `Pick<YieldsHost, 'apply'>` resolves to `yields.ts:105`, that `Pick<Http, 'fetchAsset'>.fetchAsset`
        and a `type F = FetchAsset` value have `TRANSPORT`'s type, and that a fixture flow of `Endpoints` into a
        structural `{ getPuzzle(...): ... }` is "re-typed" while a flow into `Pick<Endpoints, 'getPuzzle'>` and into
        `Object.freeze(...)` is not; reconcile r1: that a fixture `YieldsHost` into a constrained generic
        `<D extends { apply(...): Promise<void> }>` is "re-typed", into `unknown` / `object` / `{}` is "widened", and
        into an unconstrained `<D>(d: D)` is neither; that `HOST_WAITS`' computed member set on a fixture host with an
        added `warm(): Promise<void>` is red; and that the batch site resolves to `held`'s declaration (a fixture with
        a second `held` without `HeldAt` is "batch outside held"). On `acc4e0d` no guarded value is expected to flow
        into a member-less type or a constrained generic (CLAIM: Grep cannot see types; MEASURED by the red-first, and
        a hit is a STOP item at GM3p's cut, as a re-type is). The
        `WaitRow`s: `batch` (a visual batch's loads, `held`'s), `explore-import`, `frame-chunks` (a frame's chunk
        imports and a chunk Retry: one loader, two starts, both driven by its case), `answer` (an answer in flight;
        per-player GM6c2 adds `values` and `restart`, E-P23), `ladder` (a ladder request); the 429 countdown starts no
        request (a timer) and stays the state gate's (`retryAfter` covering, the hold balance).
        **On `fe996a0` the table is exact** (§1 row "(round 13)"): view rows `app/yields.ts` `explore` and
        `puzzleHost` (`import()`; waits `explore-import`, `frame-chunks`), `puzzles/registry.ts` `loadPuzzleUi`
        (`import()`; `frame-chunks`), `puzzles/session.ts` `attempt` (`Endpoints.postAttempt`; `answer`) and
        `#fetchStatus` (`Endpoints.getPuzzle`; `ladder`), `meta/wallet.ts` `use` (`MetaEndpoints.useHint`; `ladder`),
        `app/game.ts` `getPuzzle` and `postAttempt` (LBI's forwarder; `ladder`, `answer`); 39 other rows (boot, the
        meta controller and its services, the saves and their autosave, the purchase flow, the stats reporter, the
        engine's chapter loader and asset hand-off, the slots screen, the dev mock); round 14: 11 more other rows, the
        transport's references (`app/engine.ts` `loader`, `audio`, `createEngine`: hand-offs to the chapter loader,
        the audio manager and GameSession; `app/game.ts` `chapterFailed`: LBI's build probe, nothing waits;
        `mountOnce`: the hand-off to the scene; `scene/controller.ts` `mount`: to the image loader; `scene/loader.ts`
        `createImageLoader`: the scene's image fetch, which the views wait on only as a batch's loads, through `held`;
        `story/chapters.ts` `fetchJson`: a chapter file, the story path's wait; `audio/manager.ts`
        `createAudioManager`: to the BGM player; `audio/bgm.ts` `take`: a gated track, nothing waits;
        `audio/sfx.ts` `fill`: a one-shot fill, nothing waits); 3 port rows (`createEndpoints`,
        `createMetaEndpoints`, `createHttp`): 61 rows. GM3s's stage loader (its `import()` of `cues/stage/index.ts`,
        "Loading" below) lands before GM3p and is the ninth view row (waits `explore-import` and `frame-chunks`: it is
        awaited beside both), so 62 at GM3p's cut. **What the walk does not see, stated** (round 14: the transport
        and the batch hand-off left this list, critique_engine_r13 W1, m1)**:** a timer or event wait (the 429
        countdown: the state gate's); a guarded value that flows into `any` (not followed: what flows out of `any`
        has no declaration to resolve; on `fe996a0` the one such flow is `main.ts:25`'s `mount(App, { target, props:
        { app } })`, whose props the program types through the `*.svelte` module; its guards are the project rule
        against an unexplained `any` and, inside a component, the name checks `request in a component` and `guarded
        type in a component`); a `.svelte` script beyond those names (the checker does not read it); a DOM image (only
        `ui/StoryPicker.svelte:48`, Home); and whether a view row names the right wait (its `WAIT_CASES` case proves
        the row's hold; the cut reviews the site's row). Reconcile r1 (critique_engine_r14 m2; RULINGS 148 W1: the
        text claims only what the walk sees), two **named blind spots**: **B1** an assertion out of a type parameter
        or out of `any` (`function f<D>(d: D) { (d as unknown as { apply(...): Promise<void> }).apply(...) }`, or
        `(x as any).apply(...)`): the source of the assertion carries no guarded path, so nothing is compared; its
        guards are the project rule against an unexplained `any` and the review of a double assertion, and no
        planned lane writes one (Grep of planned `h.<member>(` calls in this file: `apply` and `continueStory` only,
        critique_engine_r14 `:150-151`); **B2** a load reported by a callback or an event instead of a promise (a
        host member `onReady(cb): void` whose implementation calls `cb` after a `scene.ensure`): `HOST_WAITS` lists
        promise-returning members only, so a view state that waits for the callback has no hold; its guard is the
        state gate's hold balance only where the view's state is a `loading` predicate (the frame's, §10), otherwise none,
        and no planned host member takes a callback that a load settles. **The await map is retired** (RULINGS 148: it
        stays only if it guards something the walk does not): what it alone saw, in its six roots, was (i) an `await`
        of a scene load, now confined by `SCENE_LOADERS` for a reference and by `HOST_WAITS` for a host member that
        wraps one (reconcile r1: a scene load wrapped in `game.ts` and awaited through a new host member was a case
        the map saw and round 14's walk did not, critique_engine_r14 m2 (a)), and (ii) (round 14, critique_engine_r13 W1) an `await` of a batch
        handed on as a value, such as `await deps.apply(...)` in `mechanics/x.ts`, a property call on a parameter that
        neither its `'local'` nor its `'held'` shape matched, now `BATCH_MEMBER`'s, everywhere and however consumed;
        `h.continueStory()` is the story path's, and a timer it never saw either. Red cases: **M-R13a** (`void h.api.postAttempt(o.id, []).then(() =>
        undefined)` in `ontry`, the `yields.ts:694` shape: "unlisted request start app/yields.ts ontry
        Endpoints.postAttempt"), **M-R13b** (a non-`async` `refresh()` in `PuzzleSession` returning
        `this.#deps.api.getPuzzle(...)`, the `session.ts:255-263` shape), **M-R13c** (a new `client/src/app/values.ts`
        whose `load(): void` settles `api.getPuzzle(...)` with `.then`: a file in no earlier root), **M-R13d** (`const
        status = h.api.getPuzzle;` in `openPuzzle`: a member as a value), **M-R13e** (`YieldsHost['scene']` widened
        with `'ensure'` and `await h.scene.ensure(...)` in `openPuzzle`: "scene load outside app/game.ts and scene/"),
        **M-R13f** (`fetch('/api/x')` in `HintLadder.svelte`'s script: "request in a component"), **M-R13g** (an
        exported interface with a `Promise` member added to `api/endpoints.ts`: "unlisted port"); round 12's
        **M-R12b** (`await h.api.getPuzzle(...)` in `openPuzzle`) is red here as an unlisted start, **M-R12c**
        (`#fetchStatus` renamed) as a stale row and an unlisted start, and a second `h.apply` stays **M-R12a** (the
        pin; round 14: from GM3p on, "batch outside held" here). Round 14: **M-R14a** (`const batch = { apply: h.apply
        };` and `await batch.apply([...], [])` in `openPuzzle`: "batch outside held app/yields.ts openPuzzle"),
        **M-R14b** (`const { apply } = h;` in `roomBatch`: "batch outside held app/yields.ts roomBatch"), **M-R14c** (a
        new `mechanics/x.ts` whose `XDeps` re-declares `apply` and receives `h` whole from `createYields`: "re-typed
        YieldsHost.apply app/yields.ts createYields"), **M-R14d** (`fetchAsset?: FetchAsset` on `YieldsHost` and
        `await h.fetchAsset?.(url, signal)` in `openPuzzle`: "unlisted request start app/yields.ts openPuzzle
        FetchAsset"; with an `other` row for it, "other row in a views file"), **M-R14e** (`session.ts`'s `api` dep
        re-declared as a plain object type: "re-typed Endpoints.getPuzzle app/yields.ts openPuzzle" and "stale row"),
        **M-R14f** (`session.ts` `attempt`'s view row as an `other` row: "other row in a views file puzzles/session.ts
        attempt"), **M-R14g** (a factory-level `const getPuzzle = (id: PuzzleId) => deps.api.getPuzzle(id, vm.lang)` in
        `game.ts`: "ambiguous fn app/game.ts getPuzzle"), **M-R14h** (`createMetaEndpoints`' port row with `file:
        'app/meta.ts'`: "port row outside its port's file"), **M-R14i** (`h.api[k](...)` with `k: 'getPuzzle' |
        'postAttempt'` in `openPuzzle`: "computed port access app/yields.ts openPuzzle"), **M-R14l** (`import type {
        YieldsHost }` in `HintLadder.svelte`'s script: "guarded type in a component"). Reconcile r1 (critique_engine_r14
        m2, m3): **M-RCb** (an item lane's `const held = async (item: ItemId) => { await h.apply([{ kind: 'props',
        props: [] }], []); }` inside `createYields`: "batch outside held app/yields.ts held"), **M-RCc** (`held`'s
        body calls `h.apply` twice: "batch site count 2"), **M-RCd** (`const k: 'apply' | 'continueStory' = 'apply';
        void h[k]` in `openPuzzle`: "computed YieldsHost access app/yields.ts openPuzzle"), **M-RCe** (a new
        `client/src/story/x.ts` whose `XDeps = { fetchAsset(url: string, signal: AbortSignal): Promise<Response> }`,
        given `deps` (`GameDeps`, which carries `fetchAsset: FetchAsset`, `game.ts:149`) whole in `createGameSession`:
        "re-typed FetchAsset app/game.ts createGameSession", the transport branch), **M-RCf** (`scene/x.ts` whose
        `XScene = { ensure(ids: readonly string[], signal: AbortSignal): Promise<void> }`, given the controller whole
        in `game.ts`: "re-typed SceneController.ensure app/game.ts <fn>", the scene-loader branch), **M-RCg**
        (`YieldsHost` gains `warm(ids: readonly ImageId[]): Promise<void>`, implemented in `yieldsHost` over
        `scene.ensure`, awaited in `openPuzzle`: "unlisted host wait YieldsHost.warm"), **M-RCh** (`mechanics/x.ts`'s
        `createX<D extends { apply(v: readonly VisualCommand[], a: readonly AudioCommand[]): Promise<void> }>(deps:
        D)` called as `createX(h)` in `createYields`: "re-typed YieldsHost.apply app/yields.ts createYields"),
        **M-RCi** (`const x: unknown = h;` in `createYields`: "widened YieldsHost.apply app/yields.ts createYields"),
        **M-RCj** (a second function `const later = (at: HeldAt) => ...` in `createYields`: "batch site 2
        declarations"), **M-RCt** (the `YieldsHost.queue` row renamed `YieldsHost.enqueue`: "stale host row
        YieldsHost.enqueue" and "unlisted host wait YieldsHost.queue"). Reconcile r2 (RC-W4, R-E34): the self-test
        gains `requests: the host-wait walk's reach on the tree is the HOST_WAITS rows` (the computed member set on the
        parent equals the eight rows by name, so the scope itself is pinned, not only its rows) with **M-RCu** (S1
        dropped, lib and `node_modules` declarations followed: "unlisted host wait HTMLElement.requestFullscreen",
        among others such as `Promise.then`) and **M-RCv** (function members' return types not followed: "stale host
        row HintPort.use", the `hints()` path lost), and `requests: every site member stays in its site` over a fixture
        program with a second `SITE_MEMBERS` row whose member is referenced outside its site, with **M-RCz** (the
        check reads `SITE_MEMBERS[0]` only: no "fixture outside site" message); each test asserts its own message. So a
        later request (a module's, per-player's values load wherever its file sits, a new chunk, a use
        of the transport) is red in the lane that adds it until it has its row, and a view row until its `WAIT_CASES`
        case exists; a new picture is a batch and holds already (§3.6), and a batch handed on or a port re-typed is red
        where it is handed (round 14); a new promise-returning host member is red until its `HOST_WAITS` row exists,
        and a guarded member hidden behind a constraint or a member-less type is red where it flows (reconcile r1);
        B1 and B2 above are what stays unseen, and (reconcile r2, RC-W4) **B3**: a promise-returning member reached
        only through a type argument (an array element, a `Promise`'s value, a `Map` entry), an index signature or a
        declaration outside `client/src`'s `.ts` files (a lib or `node_modules` type, a `.svelte` module's type). On
        `cec347c` none reaches a host wait: the arrays under `YieldsHost` hold data views and `ToastEntry`s whose
        callbacks return `void` (`ui/state.svelte.ts:29-43`), and the `.svelte`-declared types under it are
        `NoticeView` and the component types; a lib wait (`requestFullscreen`, `HTMLImageElement.decode`) is no scene
        load, and a lib network start is `LIB_STARTS`'s already. Its guard is the review of a host member whose type
        is a lib generic of a callback; no planned lane adds one.

  **Why this rule:** a synchronous resolve finds no created element (the take's new ribbon slot, a failure alert,
  a just-pushed sheet) and a uniformly deferred one finds no removed element (a used item's slot, a closing sheet,
  a dropped frame's wrapper inside its outroing root, which point 4 skips); a per-motion declaration keeps both
  right, and the leave watch makes the result independent of whether the removing write lands before or after the
  run. **Rejected:** a ghost of the whole frame for the end cues (RULINGS 135 (b) names the inner wrapper; a clone
  over the outroing frame would double it for 480 ms); a non-`replace` composite on the root (an `add`ed `jam` and
  the outro's scale would still share one element, and `opacity` adds wrongly); end presets free of `transform` /
  `opacity` (a narrowing of the end motion, which the owner's value forbids); a frame id in `CueEvent` to tell two
  frames apart (an engine field and emitter lines for what point 4 gets from the outro's own `inert`). **Per-player:**
  E-P19 (§14.1) sends the same rule for `ui/value-motion.ts` and the labels.
- **Loading.** The stage is its own lazy family (`cues/stage/index.ts`), imported by yields beside the explore chunk in
  `openSection` and beside the host and type chunks in `loadPuzzleUis` (`yields.ts:450`, `:511-521`), and prefetched in
  `lineShown` when the world has sections or puzzles (`yields.ts:801-815`). **Round 11 (critique_engine_r10 W1;
  found):** `lineShown`'s body becomes `prefetch()` (the D13 set: the explore chunk when the world has sections, the
  host when it has puzzles, the cue stage when it has either; once per chapter through `prefetched`), run at the
  first line as today, at `restore` when the resumed step is a yield (`at !== null`, `yields.ts:817`: a resume clears
  the line and presents its first step, `game.ts:936`, `:957`, so `lineShown` never runs on that path; round 12,
  critique_engine_r11 m4: `restore` runs before `scene.restore` awaits its pictures, `game.ts:925`, `:943`, so the
  yield's chunks **do share the link with the resumed pictures**: this is D13's one stated exception, at most
  16,000 + 10,000 B br (the explore-ui and puzzle-host LIMITs, `budget.ts:110-111`) + ~3,300 B (the stage, §11) =
  29.3 KB, so the resumed picture shows at most 29.3 x 8 / 2,000 = **0.12 s** later at 2 Mbit/s when the link is
  bandwidth-bound and ~0 when it is latency-bound (ARITHMETIC; the link CLAIM; the market's VPN-routed links are
  assumed latency-bound), against one round trip (100-300 ms, CLAIM) saved before the resumed room or frame answers
  and a stage mounted before its first wait; the prefetch after `scene.restore` (before `present`, `game.ts:957`) was
  weighed and rejected: it starts the stage's import with the yield's own, so the first wait's hold would show only
  from the stage's mount, critique_engine_r11 m5's race), and after a section's first room batch
  (`openSection`'s `drain()`, so a session resumed into a room has the host before its first lock tap). **Round 12
  (critique_engine_r11 m5): at every yield step, ahead of its transition.** `Yields.ahead(y: YieldCommand): void` (GM3w adds
  it as a no-op with game.ts's call, behaviour-identical; GM3s's body is `prefetch()`): `present` calls it in its
  `yield` case (`game.ts:695-697`), after `stage()` has ended the step's loads and before `await shown.done`
  (`:716`) and `onYield` (`:725`), so the chunks compete with no picture (the step's are loaded) and download while
  the step's transition runs. It covers a chapter whose first step is a yield (no lint refuses one: STAGING-DSL §6
  `:401-402`, `:424`; a fresh start, a chapter end or a paywall start reach it with no line and no `restore`) and is a
  no-op when the first line or `restore` already ran `prefetch()` (`prefetched`). **Residual, stated:** a yield step
  with no staging tag has no transition (`shown.done` resolves at once), so `ahead` and `onYield` run in one turn and
  the stage's chunk lands with the explore chunk; the stage persists for the GameSession (§10), so this is reachable
  only on a session's first chapter (a new game or a stories-screen start whose chapter opens on a bare yield): the
  explore import's hold then shows from the stage's mount, about one request (one round trip, CLAIM) after the
  yield, over the stage the chapter start emptied (`game.ts:835`); no shipped chapter has the shape
  (`story/ch1/main.ink:48`, `story/ch2/main.ink:33` reach their yields after lines). The type chunks are not
  prefetched: a chapter fetches only the types it opens, and the frame's load hold covers that wait (point 11).
  **Imported is not subscribed (m5, round
  3):** yields sets `vm.cueStage` when the chunk resolves, but the stage subscribes in CueStage's `$effect`, which Svelte 5
  runs in a later flush, while `openSection` goes on synchronously into `c.enter()` (`yields.ts:450-475`), and
  `openPuzzle` pushes the `puzzle` screen (`yields.ts:613`) before `loadPuzzleUis` starts the stage import (`:615`). The
  bus therefore **holds** events while no `overlay` subscriber exists (§8.1 `CueBus`) and replays them, in order, at the
  stage's first subscribe: the first section's entry cues play one flush late, at the stage's mount, never lost
  (round 10: a linear-first chapter's first frame emits its `panel-open` at the chunk write, point 8, which is also
  when the stage chunk imported beside the host lands, so it is held until CueStage subscribes in the flush that mounts
  both, and its capture then runs on the mounted frame). Overflow past `CUE_HOLD_MAX` and anything still held at
  `dispose` count as orphans, so the orphan e2e still fails a stage that never mounts. Tests (GM3m): `bus: a cue
  emitted before the overlay subscribes plays once, in order, at subscribe` (mutation **M-I5k**: `emit` drops instead
  of holding -> red, `orphans()` 1), `bus: a hold past CUE_HOLD_MAX counts the dropped cues as orphans`. A failed
  import is the explore chunk's D13 state (notice + Retry, `yields.ts:455-458`).
- **Rules shared with animation** (synthesis §5.3): cues are one-shot, never in the snapshot; they hold no state.
