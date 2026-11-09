## 6. I1: labels on the art

### 6.1 Anchor nodes (lane GM6a, behaviour-identical)

```ts
// client/src/scene/executor.ts: the StageAdapter gains anchors; GroupRef serves both.
/** Reconcile P2 (shots I-9, rev. 2 m9): one anchor = four nested Containers, `anchor > depth > motion > content`,
 *  each with one writer. `anchor`: the executor's placement at batch time (position, scale, the batch fades);
 *  `depth`: SH8's parallax drive per drawn frame (identity until SH8; the bg anchor's stays identity, its plate warps
 *  per vertex); `motion`: SH10's `MotionCommand` tweens (`SceneTargets.bg` / `prop(AnchorKey)`; identity until SH10);
 *  `content`: the art sprite, its state patch, and (GM6d1) the label nodes. */
export type AnchorRef = { readonly anchor: GroupRef; readonly depth: GroupRef; readonly motion: GroupRef;
  readonly content: GroupRef };
export interface StageAdapter<T> {
  /** A new anchor on top of `layer` (round 10 returned one `GroupRef`; reconcile P2: the four nodes). */
  anchor(layer: 'bg' | 'props' | 'cg', label: string): AnchorRef;
  /** (unchanged) `g` parents the sprite: a char group, or an anchor. */
  sprite(layer: Layer, tex: TextureHandle<T>, g?: GroupRef): SpriteRef;
  /** (unchanged) destroys a group or an anchor with its children; textures stay the registry's. */
  dropGroup(g: GroupRef): void;
  // size, destroy, set, fx unchanged
}
type View<T> = { readonly slot: string; readonly handle: TextureHandle<T>; readonly node: GroupRef; readonly sprite: SpriteRef };
```

- **Placement.** The anchor at the view's box origin (stage px), scale 1; `depth`, `motion`, `content` at the identity
  inside it; the art sprite at (0, 0) of `content` with the box size. `propRects()` keeps reporting the sprite box, so
  `debugPropRects` and the e2e are unchanged (the three inner nodes are the identity until SH8 / SH10 write them).
- **Motions target the anchor:** `fade`, the bg crossfade (`executor.ts:569-577`), the dip swap, `syncProps` fades,
  `relayout`, and every motion a later lane adds (character lanes keep char groups; every room, prop and shot motion
  targets anchors, §12 R-A1, R-A10). **Reconcile P2 (I-9):** the batch motions write the `anchor` node; SH8's
  parallax writes only `depth`; SH10's cue tweens write only `motion`; nothing writes `content`'s transform, so a label
  in `content` follows all three. The shots design's tree ([shots §5.1 Shot view](../shots/05a-runtime.md#51-shot-view-sh4-clientsrcsceneshot-viewts-pure)) puts the bg anchor as
  the **shot root** in `world`, so every label sits inside `world` and the camera carries it.
- **`rebind`** creates on the new adapter, per view: anchor (its four nodes), then sprite, then (GM6d1) its labels.
  **`destroyView` / `reacquire` / `destroy`** drop the anchor (`dropGroup` on `anchor`, which destroys the three inner
  nodes with it).
- **Prop anchors persist across states (E-P1, R-A4).** A prop anchor is keyed by `PropPlacement.at` when present
  (engine.md GM2a's format-2 field, `engine.md` §5.2), else by `prop` (today, `executor.ts:503-525`). A placement whose
  image changes at the same `at` swaps the image **inside** the anchor with a crossfade (the old sprite fades out over
  the new one); the anchor, its position and its labels stay. A `part: 'patch'` placement is a child sprite of its base's
  anchor (same `at`), faded in / out inside it.
  **Ruled: RULINGS 188** — D5.1, adopted in its general form: "a target key with no anchor takes over an anchor that
  shows one of its props, when the target does not name that anchor's key; re-keyed, nothing created, dropped or
  faded" (`syncProps`' first loop, `client/src/scene/executor.ts:543-549`; it keeps a format-1 save's at-less props on
  screen at the first at-keyed batch). An adopted anchor keeps its creation label (the bare prop id, a debug label in the
  Pixi tree) until a rebind re-creates it under its key. GM3s's at-aware `sameProps`, if it makes one, keeps or replaces
  D5.1 in the same lane, never drops it.
- **The props layer follows the command's order (E-P7).** After every `props` command the executor re-indexes the prop
  anchors in the layer to the command's array order (engine.md §5.2: decor `z`, then hotspot order); an anchor that
  stays is moved, not re-created, so a drawer's open image stays at its index and never covers decor drawn in front of
  it (today a new view is appended on top, `executor.ts:461-473`, `:515-524`). Changed by RULINGS 188 (as of `837b1ed`; docs lane
  `docs-errata-12`, group A): as merged (GM6a `23e1d31`, critique W2), the anchors map is rebuilt in the command's order
  at every sync (adoptions and arrivals included), `orderProps` writes z from the map's order (an anchor's z is its
  index; in a `content` the base 0, an old base 1 while it fades out, patch i 2 + i), and `rebind` re-creates the prop
  anchors in the map's order, each anchor before its art, and ends with `orderProps()`, so the fresh stage holds the
  old one's draw order (`client/src/scene/executor.ts:404`, `:865`, `:911`). Inside a prop anchor's `content`: the base
  sprite, then its patch, then its labels, so a label always draws over the art it is written on. **Reconcile r2
  (critique_perplayer_r1 open question 1):** inside the **bg anchor's** (the shot root's) `content`, a bg label's node
  (its depth node, §6.2) sits **directly above the plate** (the plate sprite today, SH8's mesh later: `content`'s first
  child), below the back ambient, the cast's head nodes, the figure planes and the back planes
  ([shots §5.1 Shot view](../shots/05a-runtime.md#51-shot-view-sh4-clientsrcsceneshot-viewts-pure)); front planes and front ambient are in the shot's front root above props
  ([shots §5.1 Shot view](../shots/05a-runtime.md#51-shot-view-sh4-clientsrcsceneshot-viewts-pure), [shots §2.3 Rooms and zoom views](../shots/02-shot-model.md#23-rooms-and-zoom-views)). A bg label is painted on the wall, so whatever the shot draws in front of the wall hides it
  exactly as it hides the wall's own pixels; on today's stage (one bg sprite) "above the plate" is the top, so GM6a's
  behaviour-identical promise holds. Whether a code is hidden that way is a lint question (R-S2, §12.1).
- **Why a lane of its own, now:** the animation lanes write room motions after M3c (animation synthesis §4.2). If the
  anchor arrived with GM6d, it would rewrite their targets in `scene/*` (critique r2 I1). `characters.md` rev. 3 §11.7
  orders the chain strictly as `GM6a -> MD2 -> MA1a -> MA1b -> MA2`, so GM6a goes **first** (r3 W2: round 3's "either
  order" with MD2 is withdrawn); `design-shots` re-sets the chain's names (RULINGS 132), and the invariant stays: GM6a
  before the first animation or shot lane on `scene/*`. GM6a needs GM2a for `at`, so it runs after GM2a. **Reconcile
  P2 (shots I-2, I-9, §9.14):** the `client/src/scene/*` chain is `M3c (merged) -> GM2a's field -> GM6a -> SH1 -> SH4
  -> SH5a -> SH5b -> SH6 -> SH7 -> SH8 -> {GM6d1, SH9, SH10, SH12a, SH12b}`, so GM6a precedes SH1 and with it SH4
  (I-9's "GM6a precedes SH4").
- **Bytes:** ~30 lines in the engine's scene, ~0.13 KB br (ARITHMETIC; one figure, r3 m4); reconcile P2: + the three
  inner nodes per anchor (~4 lines, 4 x 4.3 B = 17.2 B), **~0.15 KB br**.

### 6.2 Label data and the command

```json
"drawer_view": { "bg": "drawer_view", …,
  "labels": [ { "id": "l1", "on": "bg", "rect": [420, 860, 240, 96],
                "text": { "id": "ch1.manor.x001", "ru": "$code(drawer)" }, "style": "brass" } ] },
"study": { "bg": "study", …,
  "labels": [ { "id": "l1", "on": "study.drawer", "states": ["open"], "rect": [610, 1320, 200, 80],
                "text": { "id": "ch1.manor.x002", "ru": "$code(drawer.1)" }, "style": "ink" } ] }
```

- A **presentation-only mechanic module** (synthesis §3.3: a data half, no rules half): `client/src/mechanics/data/labels.ts`
  owns the room key `labels`; decode with strict keys; `normalize` none (labels hold no state); one line in
  `MECHANIC_DATA` (§12 R-E6).
- **`on` names an anchor, never an image (W7, E-P6):** `"bg"` or an `AnchorKey` of the room (engine.md §3.1:
  `<room>.<hotspot>` or `<room>~<decor>`; the `at` of `visualsOf`'s `PropView`, which is stable across states). A
  `PropId` names an image: it is ambiguous for two placements of one image (four levers, two candles, engine.md §6.4)
  and changes when a state swaps the image at the same anchor (the drawer `closed -> open`), so it cannot key a label.
- **`states` (optional):** the anchor states that show the label (engine.md R-E9: "the prop's state showing it");
  absent = every state. A code scratched inside the drawer is `states: ["open"]`; one painted on its front is absent.
- `rect` in the bg's canonical px; for an anchor label it lies inside the anchor's rect in each listed state (lint) and
  is drawn at its offset inside the anchor. A label may hold fixed text (a sign, localized through its line ID) or
  placeholders.
- **Texts and reach (round 6, r5 W1).** The labels' texts enter the one walk (R-E25) through `LABELS_TEXTS:
  TextWalker<LabelsData>`, build-only in `client/scripts/story/mechanics/labels.ts`, one line of `MECHANIC_TEXTS` in
  `client/scripts/story/mechanics/index.ts` (round 7, E-P16 (a)): per room, per label, in source order,
  `{ text: label.text, path: at.room(r) + '.labels.<i>.text', role: 'read', reach }`. engine.md's `world/text-unwalked`
  then also proves the walker reaches every label text (each label `text` is an `{ id, ru }` object under
  `w.mods.labels`). So the label's line ID is checked by
  `id/chapter-prefix`, `id/duplicate` and the en checks, its en ships in the chapter's table (`shippedEn`), a paid
  chapter's label text becomes a paid needle, `--sync-locales` appends its en stub, and `world/placeholder` /
  `world/clue-shows-value` judge it, with no edit of `world.ts` or `values.ts`. `reach` is computed from the anchor
  with engine.md's first-match rule ([engine §6.4 `visual`: state-derived room pictures](../engine/06-mechanics-as-modules.md#64-visual-state-derived-room-pictures-gm3b-replaces-lfu3s-b-001-fix): "The first `is` entry whose `when` holds names the state; else
  `default`") and is sound by construction (each condition, when it holds, draws the anchor in a showing state):
  - `on: 'bg'`: `[{ visited: room }]`.
  - `on: anchor`: let `show` = the listed states (every state when `states` is absent) that draw the anchor
    (`StateArt.prop !== null`); `h` = the hotspot's own visibility condition (engine.md GM5f's hotspot `when`), when it
    has one. Then `{ visited: room }` (+ `h`) when `default` and every `is` entry's state are in `show` (whatever holds,
    the state shows); and for each `is` entry k whose states 1..k are all in `show`, `{ all: [{ visited: room }, h?,
    when_k] }` (when `when_k` holds, entry k or an earlier one wins, each in `show`). A drawer whose code is scratched
    inside (`states: ["open"]`, `is: [{ when: { open: "study.drawer" }, state: "open" }]`, default `closed`) has reach
    `[{ all: [{ visited: "study" }, { open: "study.drawer" }] }]`: a declared clue `{ visited: "study" }` is refused
    (the label is not drawn on a mere visit; the message names the accepted form) and that `all` is accepted.
  - `world/label-anchor` adds two refusals that keep this sound: a label on a `take` hotspot's anchor (the prop leaves
    the room when taken, [engine §6.4 `visual`: state-derived room pictures](../engine/06-mechanics-as-modules.md#64-visual-state-derived-room-pictures-gm3b-replaces-lfu3s-b-001-fix); its code belongs in the item's description, a `read` surface) and a listed
    state that draws nothing.

```ts
// client/src/scene/executor.ts: VisualCommand gains it (executor.ts:35-37).
export type LabelStyleId = 'brass' | 'ink' | 'chalk';
/** One visible label; yields has already applied `states`, so the executor never reads world state (principle 7). */
export type LabelPlacement = { readonly id: string; readonly on: 'bg' | AnchorKey; readonly rect: Rect;
  readonly text: string; readonly masked: boolean; readonly style: LabelStyleId };
/** The labels of one room; `id` is unique within the room (`world/label-id`). Reconcile r2 (W2): `bg` is the room's
 *  bg (its room shot); the executor applies the command only when `bg` is the bg the batch leaves on stage, so a
 *  room's labels never land on another shot's root (principle 7: the producer states it, the executor compares ids). */
export type LabelsCommand = { readonly kind: 'labels'; readonly room: RoomId; readonly bg: BgId;
  readonly labels: readonly LabelPlacement[] };
```

- **Producer:** GameSession (yields) only. The visible set of room R is computed from engine.md's `visualsOf(w, s, R)`:
  a `bg` label always; an anchor label iff its anchor is drawn (`PropView.prop !== null`) and the anchor's `state` is in
  `states` (or `states` is absent). It is sent in every room batch after `props` (`yields.ts:374-377` grows the batch
  to `bg, props, labels`), in every **visual batch** after its `props` (engine.md §6.4's per-dispatch diff), so a label
  appears and leaves with the state that shows it, and on a store change for the current room **while the stage shows
  that room's bg** (reconcile r2, W2: `h.scene.snapshot().bg === entry.room.bg`, read in the same synchronous run as
  the `held` call, the guard `takeBatch` uses, `yields.ts:409-411`, without its `cg !== null` clause: a CG over the
  room's own picture leaves that root on stage, so its labels update under the CG and show current when it clears;
  during a cut-away, a room event's close-ups, `StagingSnapshot.bg` is the shot in effect,
  [shots §3.2 Typed commands](../shots/03-story-dsl.md#32-typed-commands-clientsrcstorystagingts-sh1), and nothing is sent: the room batch, the visual batch and the story cut back each
  carry the labels rendered at their build when the room's picture returns, and a value that lands while such a batch
  loads is sent after it, below). Every `labels` command carries the room's `bg`. The `labels` command is
  appended even when the room is already on stage and the batch is otherwise empty (`yields.ts:375-376`): it is a
  no-op when nothing changed, and a changed value still reaches the art. Text already rendered (mask included; a label
  is always the current chapter's, so `masked` means pending). Never in `StagingSnapshot`: a resume re-derives it.
  - **Reconcile r3 (critique_perplayer_r2 W1): the store-change producer runs after the batch in flight.** Every
    labels-carrying batch renders its labels when it is built and applies them after its load wait: the room batch
    builds `visual` before `await h.apply` (`yields.ts:372-387`), the visual batch likewise inside its dispatch, and the
    story cut back gets them from `roomFor` inside `stage()` before `imageIds` / `ensure` (`game.ts:716-722`;
    [shots §5.8 Preload policy for cuts](../shots/05b-preload-memory-download.md#58-preload-policy-for-cuts-sh5a-windows-sh5b-entry)); the executor's snapshot moves only at `scene.apply` (`executor.ts:2`). A
    store change during that wait therefore read the previous picture's bg in revision 2 and sent nothing (the batch
    then applied its older text, and the mask stayed with no prompt once the store was `ready`), or, with the room's
    bg already on stage, sent a labels-only batch at once that the batch in flight then undid. **The rule:** the
    store's `onChange` with a non-empty `shown` adds those puzzles to one set `labelsDue` and, unless a job is
    pending (`labelsQueued`), queues one job `syncRoomLabels` through `h.queue` (`YieldsHost.queue`, "an intent that must
    run: after the batch in flight", `yields.ts:115-116`; `after`, `game.ts:486-491`, `:1420`: it waits for the intent
    in progress, then runs as the next one; `onEnd` queues its close-up fade the same way, `yields.ts:551-560`). The
    job clears `labelsQueued`, returns if `dead`, takes `labelsDue`, and for the current room R (`world.room` while
    a section is open) renders R's visible labels **now** through the wrapper `render`; it sends nothing when none of
    them names a puzzle of the set, nothing unless `h.scene.snapshot().bg === entry.room.bg` (read in the job's own
    synchronous run with its `held` call, as above), and otherwise one labels-only batch through `held` with
    `stateHold`'s `'no-load'` (R-E33). A change during the job's own batch queues the next job.
  - **Why the newest value is the last command for R (the premise, CODE on `cec347c`):** every labels-carrying batch
    is built and applied inside one intent: `scene.apply` is called only in `stage()` (`game.ts:722`); `stage()`'s two
    callers, `present()` (`:743`, which also awaits the batch's end, `:788`) and the yields host's `apply` (`:1379`),
    run inside `run` / `after` intents (`begin` `:1829`, `advance` `:1850`, `choose` `:1872`, `loadSlot` `:1962`,
    `continueStory` from an intent, the notice's Retry `:1402`; yields' `h.tap` at `yields.ts:227`, `:757`, `:760`,
    and `h.queue` at `:551`, `:560`). So when the job runs, the batch built before the change has applied, and the job
    renders after the change. The premise is pinned at the story step, the path the shot lanes rework, by GM6d1's
    `game: a tap while a step's batch loads completes it and starts no step` (**M-PR3c**), and asked of SH1, SH5a,
    SH5b and SH7 (**R-S3**); GM6d2's cut re-checks it.
  - **Trade-off.** The labels-only batch is now an intent: a tap during its crossfade (250 ms; 150 ms reduced)
    completes it and runs no intent, as during any batch (D7, `game.ts:1413-1418`; the code shows at once), and its
    start waits for the intent in progress (bounded by that intent: a room batch's load and fade, a story step's
    batch). An exit pressed after the job is queued waits for it: `after(exitNow)` (`game.ts:2103` on `3c62a86`)
    registers on `busy` after the job's `after`, and the two resume in registration order, so the job's crossfade
    plays first (<= 250 ms; 150 ms reduced) and the exit starts after it (reconcile r4, critique_perplayer_r3 m1; §7).
    Bytes ~4 lines (GM6d2 +0.19). **Rejected:** (b) a store generation compared at each labels-carrying
    batch's end with a re-send: three build sites, the third (the story cut back) inside `game.ts`'s `stage()`, a file
    the shot lanes rework and GM6d2 does not hold, and a second re-send path beside the producer; (c) labels rendered
    at apply time by the scene: the executor would read the store (principle 7); (d) a new `YieldsHost.idle()`
    promise: a new host wait (a `HOST_WAITS` row, E-P28 (b)) duplicating `queue`; (e) revision 2's synchronous send
    kept beside the queued job: with the room's bg already on stage and a batch in flight, the code would show, the
    batch would put the mask back, and the job would show the code again (a value -> mask -> value flicker on a code
    that never changed back).
- **Executor model:** label views keyed by `(room, id)`, each a child of the `content` node (reconcile P2, I-9) of
  the anchor its `on` names: the bg anchor (the shot root), or the prop anchor keyed by `at` (GM6a). **A label view is
  a node holding one sprite (r3 W3):** the node (a `Container`
  from the adapter's new `node(parent, label)`, on top of `content`'s children) takes every batch motion of the
  label (fade in, fade out, the change crossfade); the sprite takes only the shimmer's alpha (§6.3). One writer per
  property, so a masked label shimmers through its own fade-in and its crossfade with no hand-over. An image swap at the same `at` happens inside the anchor, so the label stays,
  at the same offset and scale, through the swap's crossfade (E-P1); two placements of one image are two anchors, so
  their labels never mix. A command for room R replaces R's set: same id + text kept; changed text crossfades;
  removed fades out; new fades in; every label of another room still attached fades out (a prop shown in both rooms
  keeps its anchor, its old room's labels go). A label whose anchor is not on stage waits in the model and attaches
  when the anchor appears. A `bg` command (a room change) retires the old bg anchor with its labels. **Reconcile r2
  (W2):** a `labels` command applies only when its `bg` equals the bg the batch leaves on stage (the logical snapshot
  after the batch's `scene` / `bg`, `executor.ts:2`, `:143-159`); otherwise it is ignored: no label view is created,
  no texture acquired, nothing waits. A batch whose bg differs from a room's command bg (a cut) retires the old root
  with its bg labels, clears the props (`reduce`, `executor.ts:155-159`) and with them the anchor labels, and drops
  that room's set from the model, so **no label waits across a cut**: the room's labels come back only with a command
  for its bg (the room batch, the visual batch, the story cut back), carrying the values rendered at that batch's
  build; a value that lands while that batch loads reaches R's root by the labels job right after it (reconcile r3,
  W1; "Producer" above), so the last command for R carries the newest value. The wait rule
  above stays for an anchor not yet drawn in a picture of the command's own bg. A bg label's node is inserted directly
  above the plate (§6.1).
- **With shots (reconcile P2; `design/shots/proposal.md` I-9, S14, S19, §5.6 [shots §5.6 Motion on baked figures](../shots/05a-runtime.md#56-motion-on-baked-figures-sh8-clientsrcscenewarpts-pure-vertex-math-the-mesh-only-in-controllerts)):**
  - **Depth.** A label on a prop anchor rides that anchor's `depth` node (SH8: `par(n)` at the prop's rect centre, the
    rect holds the label by `world/label-anchor`). A **bg label** sits in the shot root's `content`, whose plate warps
    per vertex while the root's own `depth` stays the identity, so it would slide over the wall it is written on: each
    bg label view therefore gets its **own depth node** (`content > label depth > label node > sprite`), shifted by
    `par(n)` at the label's rect centre, entered in the executor's depth list that SH8's drive steps (request **R-S1**,
    §12.1; GM6d1 STOPs at its cut if SH8 merged without such a list). No shader (S19 answers R-A5).
  - **A cut** retires the old shot root with its label views (`dropGroup`), and the label model releases their holds
    (`scene:label:#<n>`, outside the sweep, §6.3) **at the swap point** where the old root's other `scene:*` holders go
    ([shots §5.8 Preload policy for cuts](../shots/05b-preload-memory-download.md#58-preload-policy-for-cuts-sh5a-windows-sh5b-entry)): the cut frame of a hard cut; a dissolve's swap right after its snapshot render
    (S14); the black frame of a dip; never at the transition's tween end (**M-PR1f**).
  - **Entrance.** A label on an anchor created in the same batch is acquired (texture drawn and uploaded) before the
    swap, attached with its anchor and plays its own fade-in from the swap point, so it is never visible before its
    art and never pops in late; a label new on an anchor already on stage fades in as before. Every label motion of
    §6.4 stays (no motion is removed: RULINGS 114, 122).
  - **Ambient.** The shimmer source declares `layer: 'stage'` (shots §5.3, [shots §5.3 Animator reuse](../shots/05a-runtime.md#53-animator-reuse-sh7--ch-61-64-as-designed)), so a
    `'cg'` or `'panel'` cover holds it (SH7's covered mode, I-7 / I-8).
  - **Producers (reconcile r2, m2: two sites, by who applies the batch).** **The views' batches go through engine's
    `held`** (E-P24 (a)): a room batch and a visual batch carry `labels` after `props`; a labels-only batch (a store
    change for the current room, sent only while the stage shows its bg, "Producer" above; reconcile r3, W1: by the
    labels job, an intent queued after the batch in flight) is a state batch whose
    `at` is `stateHold`'s `'no-load'` (it draws no image: `imageIds`, `game.ts:327-342`, yields none for `labels`, and
    `stage()` ensures nothing for it, `:711-718`; request **R-E33**), which `held` honours only while
    `stats().stale === 0 && !stats().reviving` and otherwise holds at `centre` as every load-free batch (RULINGS 152,
    `RULINGS.md:3202-3205`; E-P28 (a); reconcile r2, m1). **The story cut back rides the story step's `stage()`**, not
    `held`: `present()` -> `stage()` (`game.ts:726-743`, `:716-723` on `cec347c`) passes the step's batch through
    SH5a's `withRoomProps` ([shots §5.8 Preload policy for cuts](../shots/05b-preload-memory-download.md#58-preload-policy-for-cuts-sh5a-windows-sh5b-entry)), which appends I-11's method's output for a batch
    whose `bg` / `scene` names a room of the current section; **reconcile r3 (E-P29 (a)): engine.md's reconcile r2
    adopts R-E32**: I-11's method is `Yields.roomFor(bg): readonly VisualCommand[] | null`, the state commands built
    by the one function `roomBatch` builds its own with (GM3b commit (2), [engine GM3b `mech-state-visuals`](../engine/12c-lanes-gm3.md#gm3b-mech-state-visuals); r1's `propsFor`
    placements withdrawn), and GM6d2 appends the room's `labels` command (with its `bg`) in that function, so the cut
    back brings the room's labels and the room batch and `roomFor` carry the same list (GM6d2 extends engine's `yields:
    roomFor equals the room batch's state commands`, **M-RCaa**, with a labelled room, as E-P29 (a) asks); the labels are rendered when
    `stage()` builds the batch, and a value that lands while it loads reaches the art by the labels job after the
    step's intent ("Producer" above); GM6d2's cut checks the method's shape (STOP only if GM3b merged another). No GM6
    function declares a `HeldAt` parameter (E-P28 (d)).
- **Tests (W7):** `executor: a label stays on its anchor across a state image swap`, `executor: labels on two
  placements of one image stay apart` (GM6d1); `yields: a label on a drawer shows only in its open state`,
  `story: a label on an unknown anchor is refused`, `story: a label state the anchor lacks is refused` (GM6d2).
  Reconcile r2 (W2, open question 1): `executor: a labels command whose bg is not on stage attaches nothing`
  (**M-PR2a**), `executor: a cut drops the old room's labels from the model` (**M-PR2b**), `executor: a bg label
  sits directly above the plate` (**M-PR2e**) (GM6d1); `yields: a value change during a cut-away sends no labels`
  (**M-PR2c**), `yields: a value change under a CG over the room updates its labels` (**M-PR2d**) (GM6d2).
  Reconcile r3 (W1): `game: a tap while a step's batch loads completes it and starts no step` (the premise; **M-PR3c**)
  (GM6d1); `yields: a value that lands while a room batch loads reaches the room's labels after it` (**M-PR3a**),
  `yields: a value that lands while a batch for the room on stage loads is not undone by it` (**M-PR3a**; reconcile
  r4: also **M-PR4a**, **M-PR4b**), `yields:
  two values that land during one load leave the newest on the art` (**M-PR3b**), `yields: a value that lands while a
  story cut back to the room loads reaches its labels after it` (**M-PR3a**), `yields: a labels job queued before dispose
  applies nothing` (**M-PR3d**) (GM6d2, on a serial-intent harness, §9 GM6d2 commit 3). Reconcile r4
  (critique_perplayer_r3 W1): the harness logs each batch at the moment it applies (`applied`: at once for a batch
  with no image, at `release()` for one with an image, as `stage()`), and every assertion of the five reads that log;
  the call-order log could not see a labels-only batch applied before a held batch's mask.

### 6.3 Textures, fonts, revive, rebind (lane GM6d1)

- **Generated records.** `AssetRegistry.acquireGenerated(id: GeneratedId, holder: string, o: { spec: LabelSpec; priority })`
  where `GeneratedId = 'gen/label/<style>/<w>x<h>@<res>/<text>'` (text <= 64 chars: no hash, no collision) and
  `LabelSpec = { text, style, w, h }`. Admission under the same caps; decoded bytes `w x h x 4` at the resolution;
  `keptBytes` 0.
- **The only creator** is `scene/loader.ts` (`texture-create`, `arch.test.ts:176-177`; critique r2 optional O2 taken):
  `createLabelLoader(upload)` draws a `<canvas>` with 2D `fillText` (font size from the rect height, centred by
  `measureText`, the style's fill / stroke / shadow), wraps it in Pixi's `CanvasSource` + `Texture`, uploads at once,
  then shrinks the canvas to 0 x 0 (as the image loader closes its bitmap, `loader.ts:67-70`). `revive(gen)` redraws the
  canvas from the spec and re-uploads (the M2 model with the spec as the CPU copy). `release()` destroys the texture.
- **Resolution / tier.** The canvas is drawn at `rect x res`, `res` = the registry's tier resolution at acquire (M3c:
  `textureGeometry(entry, tier)` gives 0.5 for half, `cut.md:184`; today `geometry.resolution`, `loader.ts:55`), so a
  label is exactly as sharp as the art under it.
- **Fonts.** Styles use generic CSS families only (`serif`, `sans-serif`, `monospace`): always present, synchronous, 0
  bytes, no `document.fonts.load` to wait for. A custom label font later is its own change: `document.fonts.load` before
  the first draw with a timeout and a redraw when it resolves late (verify in WKWebView / Android WebView then).
- **Holders and the sweep (m8; the critic's open question 2).** Each label view acquires its texture under its own
  holder `scene:label:#<n>`, `n` minted by the executor per label view, so two rooms' labels with one text never share a
  holder while both are resident (the record id is by content, so they share the texture). The label model keeps these
  holds in its own map, **outside** `holds`, so `sweep()` (`executor.ts:288-322`, which keeps only the logical snapshot's,
  the unfinished batches' and the shown views' pairs; labels are never in `StagingSnapshot`) never releases a texture a
  live label sprite draws. The label model releases a hold when its label view is destroyed (a replacing command, its
  anchor's retirement, `destroy()`, whose `releaseHolder('scene:')`, `executor.ts:906`, also covers the prefix).
  `reacquire()` calls the label model's own re-acquire for a label record that ended (a failed revive).
- **Rebind** (unrestored loss): the executor re-creates anchors, art, label nodes and label sprites on the new adapter
  from its model; the registry's revive already redrew each label texture; the shimmer source stays registered (the
  loop is the same) and steps the new sprites. **Restorable loss:** the registry revive alone.
- **The mask shimmer is one `AmbientSource` of the label model (r3 W3; replaces round 3's free GSAP loop).** The scene
  renders on demand (`controller.ts:131`, `render-loop.ts:1-3`): only a timeline in `active` (`executor.ts:649-650`)
  or a dirty stage draws a frame, so round 3's tween outside `active` changed `alpha` on GSAP's ticker and was never
  drawn after the room batch ended. The shimmer now follows the frame-loop contract (`characters.md` §6.3, §6.9 items
  1 and 3; R2), an input to `design-shots` (RULINGS 132):

```ts
// client/src/scene/executor.ts (GM6d1): the label model's one source for every masked label view.
/** alpha(tc) = 0.775 + 0.225 * cos(2π (tc - tc0) / SHIMMER_MS), tc0 = the loop's `tc` at the first step after the view
 *  became masked (a new view's sprite is created at alpha 1), so a new mask starts at alpha 1; 0.55 <= alpha <= 1.
 *  Durations are CLAIM defaults for design-animation (R-A3). */
export const SHIMMER_MS = 1_200;
// The source (the AmbientSource of characters.md §6.3):
//   continuous(): true iff >= 1 masked label view is attached (its anchor on stage; a view waiting for its anchor,
//                 §6.2, is not stepped and draws no frame: r4 O1) and the mode is not frozen (reduced keeps it: an
//                 opacity motion with a 600 ms half-cycle, >= 120 ms, engine.md §8.6);
//   step(time):   writes `alpha(time.tc)` to each masked view's sprite through `adapter.set` (never its node);
//   nextChangeMs(): null (no discrete step);
//   setMode(m):   frozen -> every masked sprite at alpha 1 and one `loop.requestRender()` (the e2e rest picture, which
//                 replaces round 3's R-A8 switch); idle / covered need nothing here: the loop holds `tc` and draws no
//                 ambient frame (`characters.md` §6.3 steps 3-4).
```

  - **Owner and lifetime.** Created by `createExecutor`, registered once through the loop the executor already holds
    (`deps.loop.addAmbient(source)`, MA1a's method on `RenderLoop`, `characters.md:808-809`); the remover runs in
    `executor.destroy()`. The loop and the executor survive a rebuild (`controller.ts:340-358`), so `rebind` registers
    nothing: it re-creates the label nodes and sprites, and the next drawn frame steps the new sprites.
  - **Rate.** At most `AMBIENT_FPS[perfClass]` frames per second (LOW 20, AVERAGE / HIGH 30, `characters.md:820`)
    while no batch runs; full rate during a batch (step 2 of the draw decision steps every source); 0 while paused
    (`deactivated`), covered (a CG at alpha 1, the opaque puzzle frame), frozen, or idle after `IDLE_AFTER_MS` with no
    input and no story step (`characters.md:821`, the loop's battery rule, whose owner question is `characters.md` §13
    Q2). The mask stays visible while held; the next tap resumes the shimmer from its phase.
  - **What it is not.** It is not in `active`, so `stats().activeTimelines` never counts it, `complete()`
    (`executor.ts:769`) never ends it, `apply` never waits on it, and every e2e rest predicate that waits for
    `activeTimelines === 0` (`client/e2e/helpers.ts:300`, `:425`) is unchanged. `stats().labelLoops` = the attached
    masked label views the source steps (a waiting view joins when its anchor appears, r4 O1). A view leaves the source
    when it unmasks (its replacement fades in by a batch
    timeline on its node), when it is destroyed, and at `destroy()`; with no masked view left `continuous()` is false
    and the loop stops listening (no frame drawn for nothing).
  - **Dependency, stated.** `addAmbient` / `setMode` / the cap exist only after the lane that lands `characters.md`
    §6.3 in `render-loop.ts` (MA1a in rev. 3; re-set by `design-shots`, RULINGS 132). GM6d1 runs after it; if no
    adopted design lands that loop by GM6d1's cut, the cut is BLOCKED and asks the orchestrator (one owner per
    contract: the frame loop is the animation design's, this file never adds a second loop mode). **Reconcile P2
    (shots I-7, I-8, I-9):** that lane is **SH7** (`RenderLoop.addAmbient`, `AmbientSource`, the per-class cap,
    `stats().{frames, ambientFrames}`, the frozen / reduced / idle / covered modes, `scene.setCovered`), and GM6d1 runs
    after SH7 and SH8 (the last strict `scene/*` holder before the fan-out). The source declares `layer: 'stage'`
    ([shots §5.3 Animator reuse](../shots/05a-runtime.md#53-animator-reuse-sh7--ch-61-64-as-designed)): a CG cover and the opaque puzzle frame both hold it, as the shot under them is
    held. The shimmer stays in `executor.ts` (the engine chunk), not in the lazy `scene/motion/` chunk: it needs only
    the loop, so a label masks with its shimmer before `MotionKit` lands.
- **Counters:** `SceneStats` gains `labels: number`, `labelBytes: number` (inside `liveBytes`) and `labelLoops: number`
  (masked views in the shimmer source); the loop's own `frames` / `ambientFrames` (`characters.md:816`) show that they
  are drawn; `debugLabels(): {id,
  text, x, y, w, h}[]` in page CSS px under `__TG_MOCK__`, after `debugPropRects` (`controller.ts:77-78`); reconcile
  r2 (m5): each entry also reports `alpha` (the label node's world alpha) and `anchor: { x, y, w, h }` (its anchor's
  `content` bounds in page CSS px), so the e2e can check that a label moves with its anchor under any zoom form (~1
  line). The e2e
  reaches it as the debug hook's new `labels()` member beside `propRects()` (`game.ts:353-359`, `:1650`); the game
  test's `FakeScene` literal (`game.test.ts:336-352`) gains the two stats fields and `debugLabels`, so GM6d1 holds both
  `game` files (W4).
- **Why canvas 2D, not Pixi `Text`:** `Text` registers its systems on import (`Text.mjs:8`), which our scene does not
  do today, so it would add its pipeline (unmeasured); our path is ~80-100 lines, ~0.4 KB br (ARITHMETIC, synthesis
  §4.3). DOM labels were rejected in synthesis §4.3 (they pop in on every visit under "maximum animation").

### 6.4 Motion (R5; maximum animation)

| Motion | Carries the label because | Owner of the motion |
|---|---|---|
| room fade / crossfade / slide | the label is a child of the bg / prop anchor that fades or moves | executor today; MR1 |
| zoom into / out of a view (`via` rect) | the view's bg anchor scales from the rect (GM4's crossfade path, `yields: a zoom move crossfades the bg`); reconcile r2 (m5, shots I-5): from SH10 the move is a camera push into `via` plus a dissolve, and the view's labels enter with the view's new root from the swap with their own fade-in (§6.2 "Entrance"); either way a label stays inside its anchor at its canonical offset and scale, the predicate GM6d2's e2e checks | GM4, then SH10 (MR1) |
| a prop's part tween (a drawer slides) | the prop anchor moves | MR1 |
| a prop's state patch | the patch is a sprite inside the same anchor's `content` (§12 R-A4) | GM3b / SH10 (MR1, shots I-4) |
| a cue's scene motion (`MotionCommand` on `SceneTargets.prop(AnchorKey)` / `bg`) | the tween writes the anchor's `motion` node; the label is in `content` under it (reconcile P2, I-9) | SH10 |
| depth parallax (round 10: "MR2 shader"; reconcile P2: no shader, shots S19) | SH8's drive writes a prop anchor's `depth` node at `par(n)` of its rect centre, and each bg label's own depth node at `par(n)` of the label's rect centre (§6.2 "With shots", R-S1) | SH8 (drive), GM6d1 (bg label depth nodes) |
| a cut, dissolve or dip between shots | the label views leave with the old shot root (their holds released at the swap point) and the new root's labels enter with it, each with its own fade-in from the swap (§6.2 "With shots") | executor (SH4-SH6 cuts), GM6d1 (label holds) |
| ambient loops, particles | independent of labels | SH9 (MR2's ambient role, shots I-4) |
| the label's own change (mask -> value, value -> new value after a restart, a language switch) | the executor crossfades old -> new label **node** in a batch timeline, default 250 ms; a masked label's **sprite** shimmers through the label model's `AmbientSource` (§6.3, r3 W3: alpha 0.55 <-> 1, 1,200 ms per cycle, drawn at the capped ambient rate between batches and at full rate inside them, outside `active` and `complete()`, held while paused, covered, frozen (alpha 1) or idle, the same source across `rebind`); reduced motion: a 150 ms opacity crossfade, never a cut (engine.md §8.6), and the shimmer stays (opacity-only); a tap completes the crossfade (batch rule), never the shimmer. Durations are CLAIM defaults for `design-animation` | GM6d1 |
| a label appearing or leaving with its anchor's state (the drawer opens: its inside code fades in) | the visual batch's `labels` command adds / removes it with the fade-in / fade-out of a new / removed label, timed with the state crossfade (W7) | GM6d1 (motion), GM6d2 (the command) |

Names (reconcile P2, shots I-4): MR1 = **SH10** (scene motions), MR2 = **SH8** (parallax) + **SH9** (ambient decor);
the rows above that say MR1 / MR2 read those lanes. Every row keeps its motion; reduced motion as stated per row.
Reconcile r2 (E-P27 (d)): the scene cells this file's cue rows owe to MR1 (`puzzle:renewed`, R-E14;
`puzzle:hint-renewing`, R-E20; `puzzle:ready`, R-E26) are SH10's.

### 6.5 Memory and budget

- **Lint** `world/label-size`: <= 4 labels per room, each <= 512 x 256 canonical px -> <= 4 x 512 x 256 x 4 B = 2 MiB per
  room (ARITHMETIC; the 4-label bound counts every label of the room, whatever its `states`, so the bound holds in
  every state). Typical: 240 x 96 x 4 = 92,160 B. `world/label-anchor` (W7): `on` is `bg` or an `AnchorKey` of the
  room (a hotspot or decor anchor that `visualsOf` can draw), never a `take` hotspot's anchor (round 6); every listed
  state exists on that anchor and draws it (round 6); the rect lies inside the anchor's rect in every listed state
  (every state when `states` is absent). The three codes
  (`world/label-size`, `world/label-anchor`, `world/label-id`) live in `client/scripts/story/mechanics/labels.ts`'s
  `LABEL_CODES`, one line of `MECHANIC_LINTS` (GM6d2; §4 "Where the codes live", r4 W1).
- **Room-set term** (`roomRows`, `budget.ts:869-899` at `a6365a8`, GM6d2, inside engine.md's transition pair, GM4g, E-P2): the row becomes
  `bg(R) + props(R) + labels(R) + (bg(n*) + props(n*) + labels(n*))`, with `n*` the neighbour or close-up that maximises
  `bg(n) + props(n) + labels(n)` (engine.md §6.3; one formula, GM4g owns the props terms, GM6d2 the labels terms), from
  label sizes the story tool writes into the usage rooms (`scripts/story/emit.ts`). Worst case +4 MiB (ARITHMETIC);
  engine.md's view arithmetic already reserves it (2 x 8.87 MiB of bg + 4 MiB of labels, 10.27 MiB left for props).
  **Reconcile P2 (shots I-3):** a room is a shot with a sheet, so the image term is `img(n) = bg(n) + sheet(n)` from
  the one helper SH3b adds to `budget.ts`; the row reads `img(R) + props(R) + labels(R) + (img(n*) + props(n*) +
  labels(n*))`, GM6d2 still writing only the labels terms. **One bound, two readers:** the shots design counts a room
  in a step window at its label bound `LABELS_BOUND` = 2 MiB ([shots §3.4 The flow analysis](../shots/03-story-dsl.md#34-the-flow-analysis-clientscriptsstoryshotsflowts-build-only), SH3b), and this
  lint's per-room bound is 4 x 512 x 256 x 4 B = 2,097,152 B (ARITHMETIC); GM6d2 pins them equal
  (`budget: the step window's label bound equals the label lint's room bound`, **M-PR1g**: the lint's 512 raised to
  640, red), so neither can move alone.

### 6.6 How labels enter engine.md's scene channel

- engine.md's presenter turns cues and the `visualsOf` diff into `props` commands with per-prop transitions. Labels are
  **not** in `visualsOf` (they need values, which never enter the world or the reducer); yields reads `visualsOf`'s
  `PropView.at` / `state` to pick the visible labels (W7) and appends the `labels` command after `props` in the same
  batch, in room batches and in engine.md §6.4's visual batches alike.
- One executor batch applies `bg`, `props`, `labels` in that order, so a label's anchor exists when it attaches.
- **Reconcile P2, restated in reconcile r2 (m2):** the views' batches with a `labels` command (room, visual,
  labels-only) are applied through engine's `held` (E-P23 (b), E-P24 (a)); a labels-only batch is a state batch with
  `'no-load'` (R-E33), sent only while the stage shows the room's bg (W2); the story cut back to a room shot is the
  story step's batch, applied by `present()` -> `stage()` (`game.ts:716-723` on `cec347c`), never through `held`
  (so `held`'s batch site count is unchanged), and gets the room's commands from shots I-11's method through
  `stage-route.ts`' `withRoomProps` ([shots §5.8 Preload policy for cuts](../shots/05b-preload-memory-download.md#58-preload-policy-for-cuts-sh5a-windows-sh5b-entry); labels included once R-E32 is answered).
  **Reconcile r3:** R-E32 is adopted (`Yields.roomFor(bg)`, [engine GM3b `mech-state-visuals`](../engine/12c-lanes-gm3.md#gm3b-mech-state-visuals)), so the cut back carries the
  labels; and the labels-only batch is sent by the labels job, an intent queued through `YieldsHost.queue` after the
  batch in flight (W1, §6.2 "Producer"): one more `queue` call site in `yields.ts`, no new host member, no new
  `held` site.
  No GM6 function declares a `HeldAt` parameter, and no GM6 lane subscribes the scene role's cues
  (`YieldsHost.sceneCues` is engine.md's, E-P28 (d), (e)).
- No cue carries a value change (R-E3 withdrawn, §12): the label crossfade / shimmer above and `ValueText` (§5.3) are
  its motion, each owned by the code that draws the value. The shimmer enters the scene's frame loop as an
  `AmbientSource` (§6.3), the channel `characters.md` §6.9 gives every continuous room effect.
