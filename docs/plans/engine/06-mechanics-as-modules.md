## 6. The owner's mechanics as modules

### 6.1 `use`: item-first use and tools that stay (GM3 rules, GM3u UI)

- **Action** `use {item, target}`, from the ribbon: the first `uses` rule of the target whose `item` matches and whose
  `when` holds runs (`do` through the writer; `keep: false` consumes: `held - item`, `used + item`); else a lock target
  falls back to today's `insert` fit (`reduce.ts:439-475`); else the item's `refuse` text; else the room's; else the
  UI default (key `mech.use_refused` in `client/src/i18n/mechanics.ts`, GM3u: the mechanics' own string table, imported
  by yields and the explore UI only, so it ships with the engine and never in the entry, as `i18n/meta.ts:1-4` does for
  the meta overlays; round 4). A refusal writes nothing and emits `refused {at, item, reason}` plus
  `module:use:refused`.
- **`actions()`** lists held item x visible target pairs with a matching rule; pairs whose only effect is the lock fit
  stay `insert`'s, so the search sees each edge once.
- **Tools that stay:** a slot with `keep: true` records the item and leaves it held. `normalize` accepts an item both in
  a slot and in `held` when that slot keeps (the refit rule at `reconcile.ts:237-270` gains that case).
- **reads:** `held`, `used` of the rule's items and every atom of its `when`.
- **Effects grow** (kernel types, GM3): `room {room, sfx, from, via, how}` with `how: 'walk' | 'zoom-in' | 'zoom-out' |
  'enter' | 'return' | 'resume'`; `leave {knot, from, via}` (the `move:leave` cue's source, W3); `refused {at, item,
  reason: 'no-fit' | 'no-rule'}`; `got {gift, at}`; `look {text, at}`; `cue {cue}`.
- **Lints:** unknown item / target; scope (X15); a `keep: true` item consumed elsewhere (warning
  `world/keep-consumed`); `say` line IDs.
- **Texts (round 6, W1):** `USE_TEXTS: TextWalker<UseData>` in `client/scripts/story/mechanics/use.ts` declares each
  hotspot's `uses.<i>.say` (path `at.hotspot(key) + '.uses.<i>.say'`), each item's `refuse` (`items.<id>.refuse`) and
  each room's `refuse` (`at.room(r) + '.refuse'`), every one role `toast` (a note that lives seconds, shown through
  `h.text`, never the values store) and reach []; one line `use: USE_TEXTS` in `MECHANIC_TEXTS`. Test (GM3) `use: its
  say and refuse texts are world lines of role toast` (a fixture world with one `say` and one item `refuse`: two lines
  with those paths, at their source lines, role `toast`; red: TS2305 `USE_TEXTS`, then the lines absent with the entry
  `null`, which is also `world/text-unwalked`).
- **UI (GM3u):** a persistent ribbon over the room (`ui/explore/Ribbon.svelte`). Tap an item: select (UI state; cue
  `ui-state:select`). Tap a hotspot with an item selected: `use`. Tap the selected item again or bare art: deselect.
  The LockPanel keeps its insert path (`ui/explore/LockPanel.svelte:42`).
- **Tests:** `use: an item used on a target runs its first matching rule`, `use: a refusal names its target and
  item`, `use: a keep slot leaves the item held`, `use: the fallback chain ends at the room default`,
  e2e `mechanics: select the key, tap the drawer, the drawer opens` (ch1's existing slot; no story edit).

### 6.2 `combine` (GM5; R11)

- **Action** `combine {a, b}` (either order, Visionaire `<->`, F1): the first recipe matching `{a, b}` with `when`
  true writes `held - inputs not in keep`, `used + those`, `held + gives`; else `module:combine:refused`.
- **Combine anywhere (R11 decision).** Conditions, each a lint or an existing rule:
  1. `world/recipe-scope`: `a`, `b`, `gives` all belong to one section S's item scope (the items S gives,
     `reduce.ts:96-97`), `gives` given only by recipes of S;
  2. no gating rule outside S reads them (`world/cross-section-cond`, and X15's existing rule for lock slots; verify
     its code name at GM5's cut);
  3. S's search enumerates `combine` while S is current.
  Then a combine in section B writes only S-scoped facts, which B's key ignores, and the resulting state equals the
  state "combine in S, then leave", which S's search contains. A property test checks the commutation:
  `combine: combining in another section equals combining before leaving the recipe's section`, seen red on a mutant
  recipe whose product another section's lock accepts.
- **Why:** "not here" refusals would be a rule the player cannot see (critique R11). The trade-off is the scope lint
  on authors.
- **UI:** with an item selected, tap another ribbon item. **Proof:** held pairs add edges; P2-b measures states.
- **Texts (round 6, W1):** `COMBINE_TEXTS` in `client/scripts/story/mechanics/combine.ts` declares each
  `recipes.<i>.say` (role `toast`, reach []); one `MECHANIC_TEXTS` line. Test (GM5) `combine: a recipe's say is a world
  line of role toast` (red: the line absent).

### 6.3 `view`: full-screen zoom views (GM4; O5)

- **Schema:** a room with `"view": { "of": "study" }`, its own `bg` and hotspots; the parent enters it through an
  ordinary `exit` hotspot (`"to": { "room": "desk_view" }`). No new hotspot kind; the kernel's `tap` is unchanged.
- **Rules:** arrival emits `room {..., how: 'zoom-in', via}` when the target's `of` is the current room, `zoom-out` on
  the way back. Action `leave-view` (module `view`) is enabled only in a view and moves to `of`; the proof enumerates
  it. `world/view-depth` <= 2, `world/view-section` (`of` in the same section), **`world/view-entry`** (only `of` has an
  exit into a view), **`world/view-exits`** (a view's exits lead only to `of` or to its own child views; story exits
  allowed). So the views of a section form a tree under their rooms and `leave-view` is always open.
- **Navigation (W1).** The controller's walk rule (`controller.ts:257-275`) gains two cases ahead of today's:
  - a **zoom-in** `R -> V` (V.of = R) pushes R whatever exits V has: `path = [...path, R]`;
  - a **zoom-out** `V -> V.of` (by `leave-view` or by an exit to `of`) truncates at `of` when it is on the path, else
    leaves the path unchanged; it never pushes V, so the next Back never re-enters a view;
  - `reportPath` (`controller.ts:278-287`) reports **"Back has a target"** = `path.length > 0 || isView(current.room)`,
    so a view always offers the root-back, including after a resume, where `admit` empties the path (`:258-260`);
  - `back()` (`controller.ts:349-357`) dispatches `leave-view` when the room is a view, else taps the open exit to
    `path.at(-1)` as today. Telegram's BackButton (root back, `yields.ts:236-239`) therefore leaves one view level per
    press. `yields.ts` needs no edit: it already follows `onPath`.
  - **The view bar's leave control** (GM4u): `ExploreView`'s bar shows a "back out" button while the room is a view
    (`ui:view-leave`, trigger `click`), wired to the same `back()`. Two independent ways out: a regression in the
    root-back registration can no longer trap a player in a view.
- **State:** none new: `s.room` is the view, so save, resume and proof work as built; each view is a room in the key
  (P2-b; the place quotient is the fallback). The path is not saved (X12, `controller.ts:87`), which is why "Back has
  a target" reads the room, not the path, in a view.
- **Preload (m2).** `neighbours()` (`controller.ts:128-136`) returns, in order: **Back's target** (`of` in a view, else
  `path.at(-1)`), then this room's exits and views in hotspot order (the author's order), then for a view its child
  views. `roomShown` requests them in that order under the steady cap (`registry.ts:336-343`); round 12
  (critique_engine_r11 W1): after the room's own bg and before its first neighbour it requests every image the room
  can show (`state:<room>`, GM3b, §6.4), so a state change in this room rarely waits; round 13 (critique_engine_r12
  W2; RULINGS 148): it keeps them while the room stays in `room:*`'s keep set, so a zoom-out finds the parent's state
  images resident (Back's target is a view's first neighbour) and re-downloads none of them; and GM4g's "preloads k of n
  neighbours" note already counts them (its inputs are the usage `props`, every state image). **The real cost:** a
  batch awaits `scene.ensure` before any transition starts (`game.ts:646-654`), so no dip covers a load. At the full
  tier a room holds bg 8.87 + ~3 props 3.27 + labels <= 2 ≈ 14.1 MiB, which leaves room for **2** neighbour bgs
  (2 x 8.87 = 17.74 MiB, ARITHMETIC under 32); at the half tier (2.11 MiB per bg) ~8. A third neighbour on a full-tier
  device loads on tap: the tap's control cue plays at once (DOM, §8); **the wait has its own motion (round 4, m11):**
  yields emits `ui-state:waiting` at the `via` box when the room batch starts and `ui-state:waited` when its loads end
  (`apply`'s `started` callback, GM3w; `game.ts:647-654` ends the loads before any transition), and the player holds a
  looping `breathe` at the box from `WAIT_DELAY_MS` (120 ms, LIMIT new) until `waited`; a resident bg ends the loads in
  a microtask, so no hold shows. The move's own cue (`move:zoom-in`, `move:walk`) is emitted at `started` too, so its
  iris or sweep plays with the scene's crossfade, not 1 s before it. Fetch: 300,000 B AVIF at an assumed 10 Mbit/s =
  0.24 s, at 2 Mbit/s 1.2 s (ARITHMETIC; the link speed is CLAIM); decode: verify on the budget Android at GM4's cut. `roomRows` notes per room "preloads k of n neighbours"
  (ARITHMETIC from the same inputs, GM4g; a report, not a failure), so the author sees which rooms load on tap.
- **Transition:** a zoom move is a `bg` **crossfade** of `VIEW_FADE_MS` (new constant, 400 ms like `ROOM_FADE_MS`,
  `yields.ts:39`) on today's executor path (`executor.ts:569-578`); the overlay iris from the `via` box is the GM3m
  motion; the scene zoom (`bg-zoom` from the `via` rect) is MR1's (`ScenePending`, §8.5).
- **Memory (ARITHMETIC; LIMIT 32 MiB steady, 48 MiB hard, `registry.ts:13`, `:15`):**
  - one bg record: 1080 x 2048 x 4 = 8,847,360 B decoded + the kept file <= max(300,000 AVIF, 450,000 WebP) B
    (LIMIT `budget.ts:102`, `:128`) = 9,297,360 B = **8.87 MiB**;
  - parent and view resident during the crossfade (the old bg is destroyed when the new one is opaque,
    `executor.ts:573-577`): 2 x 8.87 = **17.73 MiB**; per-player labels add <= 2 MiB per room, 4 MiB for the pair
    (per-player.md §6.5); the props of **both** rooms share the rest: 32 - 17.73 - 4 = **10.27 MiB**;
  - **no third image (round 5, W2):** a puzzle of a `view` type has `closeup: null` (`world/device-closeup`, GM8i), so
    `openPuzzle` never fades a CG in over a device (`yields.ts:587-592`; CG DIMS 1080 x 2048 exact, `budget.ts:202`) and
    the 3 x 8.87 = 26.6 MiB arrival of critique_engine_r4 W2 cannot be authored; an overlay puzzle's close-up keeps its
    own `closeups(R)` term in the room-set formula below, as built;
  - one prop record <= 512 x 512 x 4 + 90,000 (WebP LIMIT `budget.ts:128`) = 1,138,576 B = 1.09 MiB, so <= 9 full-size
    prop images across parent + view; a 256 x 256 state patch is 0.34 MiB (ARITHMETIC), so ~30 patches;
  - the half tier (M3c; LOW Android only): a bg is 540 x 1024 x 4 = 2.11 MiB; views are `bg` assets, so they inherit
    it with no new namespace (RULINGS 120 Q6);
  - MEASURED baseline with placeholder art: room-set hall 16.9 MiB (two bg records), study 18.8 MiB
    (`final-build.log:171-172`).
- **Gates:**
  - **room-set** (`budget.ts:851-870`) becomes `bg(R) + props(R) + labels(R) + max over n in neighbours(R) and
    closeups(R) of (bg(n) + props(n) + labels(n))`: the **transition pair**. Today's row ignores the neighbour's props,
    which are on stage during a crossfade (`syncProps` fades both sets, `executor.ts:503-525`). **GM4g** adds the props
    term for today's exits (red-first on a fixture with a prop-heavy neighbour; `emit.ts` usage gains the neighbour
    **room keys** beside their bg ids), before GM4; per-player GM6d2 adds the labels terms; **reconcile r1
    (design-shots I-3):** every `bg(x)` term above, for R and for each n, reads `bg(x) + sheet(x)` through the one
    helper SH3b adds to `budget.ts` (a room is a shot with a sheet once SH9 gives rooms ambient; a room with no sheet
    has `sheet(x) = 0`, so today's figures do not move), and GM4g runs after SH3b on that file (§12 "Order and
    conflicts"); test `budget: the transition pair counts each room's sheet` (GM4g), **M-RCq** (the helper bypassed,
    `bg(x)` alone: red on a fixture whose neighbour has a 2.2 MiB sheet, the pair short by it);
  - GM4's `emit.ts` hunk adds views and `of` to the usage neighbours; every view room gets its own row automatically;
  - **knot-set** (`budget.ts:823-849`): unchanged. A knot entered from a view carries the view's bg as its one carried
    bg (`carriedBound`, `:813-821`).
- **Lints:** depth, section, entry, exits, a view's hotspots inside the safe frame; a device's puzzle has no close-up
  (`world/device-closeup`, GM8i, round 5 W2) and its part rects lie inside the safe frame and below the device bar's
  derived band (`world/device-parts-frame`, round 5 m5, §7.5).
- **Tests:** `view: an exit into a view emits a zoom-in move`, `view: leave-view returns to the parent and is enabled
  only in a view`, `controller: Back in a view of a view leaves one level`, **`controller: a view without an exit back
  offers Back`** (red on main's rule: `path` is `[]` and `onPath` reports false), **`controller: Back from the parent
  after leaving a view walks the path, not into the view`** (red: `path` becomes `[desk_view]`),
  **`controller: a resume inside a view offers Back`**, `controller: a room preloads Back's target first, then its
  hotspot order`, round 13 (critique_engine_r12 W2): **`controller: a zoom round trip P -> V -> P fetches each of P's
  state images once`** (GM4; a counting fake scene with the registry's holder rule; red on **M-R13h**, round 12's
  release at every room left: two fetches of each), e2e `mechanics: a reload inside a view resumes there and offers Back` (GM4u), `story: an exit into a view from another room is
  refused`, `story: a view exit to a sibling room is refused`, `budget: room-set counts the transition pair` (GM4g),
  `explore: the view bar's leave control leaves the view` (GM4u), e2e `mechanics: zoom into the desk and back with the
  BackButton and with the leave control` (GM4u).
- **Art:** GM4u's demo view reuses an existing placeholder bg from the catalog (verify which at the cut); no new art.
- **Transfer (O1, round 3):** each view is a full `bg` (<= 300,000 B AVIF, LIMIT `budget.ts:102`) against the 6 MB
  per-chapter `transfer` row (`budget.ts:122`): at most 6,000,000 / 300,000 = 20 full-size images per chapter, rooms,
  views, CGs and the first knot's art together (ARITHMETIC at the limit; real files are smaller). The row gates it
  already; the author trades views against CGs inside it.
- **Devices in a view** render inside the room layer, not in App's puzzle layer (W1, round 3): §7.5.

### 6.4 `visual`: state-derived room pictures (GM3b; replaces LFU3's B-001 fix)

- **Schema:** hotspot `states` + `is`; room `decor` (§5.1). The first `is` entry whose `when` holds names the state;
  else `default` (the hotspot's `prop`). A taken `take` draws nothing (B-001 by construction).
- **`visualsOf(w, s, room): readonly PropView[]`** (chunk, a method of the controller handle):

```ts
export type PropView = {
  readonly at: AnchorKey;                 // stable across states: motions and labels target this anchor
  readonly state: StateName;
  readonly prop: PropId | null;           // the state's base image; null: nothing drawn
  readonly patch: { readonly prop: PropId; readonly rect: Rect } | null;   // drawn inside the anchor over the base
  readonly rect: Rect;                    // base box, canonical bg px
  readonly z: number;                     // decor order; hotspot props 0
};
export type VisualDiff = { readonly at: AnchorKey; readonly from: StateName | null; readonly to: StateName | null };
// Round 12 (critique_engine_r11 W1), GM3b. `ExploreController` (`client/src/explore/controller.ts:25-50`) gains:
/** The stage box of an anchor of the current room (the cover mapping of `controller.ts:108-119` over its rect), for
 *  the state batch's hold; null while the stage has no size or the anchor is not in the room. */
anchorBox(at: AnchorKey): Box | null;
/** Round 13 (critique_engine_r12 m1; RULINGS 148): the state batch's `held` argument. The first entry of `diff` (draw
 *  order) whose anchor's new `PropView` draws an image (`prop !== null || patch !== null`) gives `{ box: anchorBox(at) }`
 *  (`box: null`, so `centre`, while the stage has no size); none gives `'no-load'`: the batch adds no image to the
 *  stage (its other placements are on stage, its bg is the stage's), so it loads nothing and `held` opens no hold. */
stateHold(diff: readonly VisualDiff[]): HeldAt | 'no-load';
// client/src/mechanics/rules/visual.ts (rules half, chunk):
/** Every image the room can show: its hotspots' props, their states' props and patches, its decor's: the set
 *  `emit.ts` writes as the room's usage `props` (so the room-set row and the preload count the same files). */
export function roomImages(w: WorldPublic, room: RoomId): readonly PropId[];
// client/src/explore/controller.ts: `const STATE_HOLDERS = 'state:'` beside `ROOM_HOLDERS` (`:69`), one holder
// `state:<room>` for the current room's images (§6.4 "The state batch's wait").
```

- **Per-dispatch diff:** after **every** `act` (`yields.ts:330-347`), one `visualBatch` job per drain: when the stage
  shows the current room's bg and no CG (`yields.ts:409-411`'s check), the new `PropPlacement[]` (base and patch
  placements with `at`, `part`) differs from the stage, apply `[{ bg: same, t: 'crossfade', ms: TAKE_FADE_MS },
  { props }]`, the batch shape LFU3 uses (`yields.ts:416`). `takeBatch` (`yields.ts:395-417`) and its `got` job
  (`:296`) are deleted; `roomBatch` builds props from `visualsOf` (`roomProps`, `:158-169`, deleted). `TAKE_FADE_MS`
  keeps its name and value (300 ms), so **LFU3's tests stay byte-identical and green**: `yields: a take removes its
  prop from the stage` (`client/src/app/yields.test.ts:358-374`) and e2e `explore: reload resumes in the same room with
  items` (`client/e2e/puzzles.spec.ts:132-158`).
- **The diff also goes to the cue bus** with the dispatch's cues (`VisualDiff[]`), so MR1 knows which anchor changed
  state and why (§8.7).
- **Anchors and order (W7, m9).** Two placements may share one `PropId` (four identical levers, two candles): each has
  its own `at`, and the executor keys anchors by `at` (E-P1, per-player GM6a). **GM3b and GM8i therefore start after
  GM6a merges.** The props command lists placements in draw order (decor `z`, then hotspot order), and the executor
  orders the props layer by the command (E-P7). A state image stays at its anchor's index, so a drawer's open image
  never covers the decor drawn in front of it.
- **Memory:** `emit.ts` writes every state image and every decor prop of a room into its usage `props`, so the
  room-set row counts all states (a state crossfade holds two images).
- **The state batch's wait (round 12, critique_engine_r11 W1; RULINGS 135).** A state change can show an image no
  one has requested (`drawer_open` after the drawer's code; a statue's next facing): `game.ts:647-654` awaits
  `scene.ensure` on the batch's prop ids before the crossfade. Two parts, with two jobs:
  - **The hold, by construction:** the state batch calls `held(visual, [], controller.stateHold(diff))` (§8.1 point
    11), never `h.apply`, so `ui-state:waiting` (`panel: null`) goes out before its loads and `waited` at `started`;
    round 13 (critique_engine_r12 m1; RULINGS 148): the box is that of the **first changed anchor, in draw order,
    whose new state draws an image** (`prop` or `patch` not null), through `anchorBox` (new on the controller handle,
    chunk: the cover mapping of `controller.ts:108-119` over the anchor's `rect`), so the ring breathes on the drawer
    that loads, never on a taken prop's emptied anchor drawn before it (round 12 read `anchorBox(diff[0].at)`);
    `centre` when that anchor has no box (the room has no stage size yet); **with no such anchor, no hold**:
    `stateHold` returns `'no-load'` and `held` applies the batch with no `waiting` / `waited`, since every other
    placement of its props command is on stage already and its bg is the stage's, so it loads nothing; **round 14
    (critique_engine_r13 m3): that premise holds only while no revive runs**, because `stage()` ensures every image id
    of the batch, the unchanged placements included (`game.ts:711-716`), and `acquire` on a live record that a revive
    has not reached yet waits for it (`registry.ts:356-377`, `:471-481`; on `acc4e0d` `:364-387`, `:479-502`), so
    `held` honours `'no-load'` only while `h.scene.stats().stale === 0 && !h.scene.stats().reviving` (reconcile r1,
    critique_engine_r14 m1, RULINGS 152 Q14 (a): an aborted revive leaves live records stale with `reviving` false,
    `registry.ts:423`, and `acquire` waits on them until the next `activated` revives them, `controller.ts:318-320`;
    round 14 keyed on `reviving` alone) and otherwise holds at `centre` (`box: null`: the wait is the stage's
    re-upload, not one anchor's; §8.1 `held`). The predicate is conservative and never short: a stale record the
    batch does not name still makes it hold, a hold that ends at `started` in a microtask when nothing waits. A
    batch whose images are resident ends its loads in a microtask and shows nothing (`WAIT_DELAY_MS`).
  - **Residency, the common case:** `roomShown` requests `roomImages(w, room)` (rules half, chunk: every `prop` of the
    room's hotspots, their `states` and `patch`es and its `decor`, the set `emit.ts` writes as the room's usage
    `props`) under the holder **`state:<room>`** (`STATE_HOLDERS = 'state:'`, beside `ROOM_HOLDERS`,
    `controller.ts:69-70`), after the room's own bg and before its neighbours (`:172-177`). **Release points (round
    13, critique_engine_r12 W2; RULINGS 148: `state:<m>` follows `room:*`'s keep set on a move):** `releaseHolders`'
    `room` branch releases `state:<m>` exactly when it releases `room:<m>`, when `m` leaves
    `{room, ...neighbours(room)}` (`:150-156`; a second tracked set beside `tracked`; **round 14, critique_engine_r13
    m2 (a): the current room's set is requested at every `roomShown`**, as the neighbour bgs are today, `:163-166`,
    `:172-177`: an id live under the tag joins its record at once with no fetch, `registry.ts:476-480` (reconcile r2,
    RC-m1, on `cec347c` after LHJ: `registry.ts:483-488`, and a live or pending id joins inside `preload()` at once,
    outside the two fetch slots, `preload.ts:167-172`), an id queued, in flight or joined under it is skipped,
    `preload.ts:120-122` (`:163-166` on `cec347c`), and an id that admission refused or an eviction ended is
    requested again (it has no record, `registry.ts:523-527`, so it queues, `preload.ts:168-169`); a neighbour's set, requested while that neighbour was current, is kept and not requested while it
    is not current); its close-up branch (`:157-158` becomes two branches) releases every `room:*` and
    every `state:<m>` with `m` not the current room, and keeps the current room's: the room-set row is `bg +
    props(every state) + max(neighbour, close-up)` (`budget.ts:883`), so the current room's states and the close-up
    fit together by the gate, while a neighbour's states sit in the `max` term the close-up takes (found in round 13:
    round 12's "`room:*` only" kept exactly the current room's states, since no other `state:` holder was live then);
    its `leave` branch and `dispose` release both families. **Bytes, both formats** (ARITHMETIC at the LIMIT
    `budget.ts:128`, `:131` on `cec347c`; k and the link CLAIM): each image <= 60,000 B AVIF / 90,000 B WebP, 0.24 s /
    0.36 s at 2 Mbit/s; (reconcile r2, RC-m4) a state image that is a loop prop (SH9's atlas, design-shots I-10) is
    bounded by the shots' loop-prop atlas LIMIT instead, <= 200,000 B AVIF / 300,000 B WebP ([shots §10 Budgets and validation](../shots/10-budgets-and-validation.md#10-budgets-and-validation-summary)), 0.8 s
    / 1.2 s at 2 Mbit/s (ARITHMETIC: 200,000 x 8 / 2,000,000), at its room's first entry and again at a return after the
    room left the keep set; the state batch's ring covers the wait as for any state image, so only the figures move.
    A registry record ends with its last holder (`registry.ts:249-258`; `:257-267` on `cec347c`) and a paid image is `private, no-store`
    (`server/src/api/content.rs:19-25`), so every request after a release fetches the file again. Hence: a room's
    first entry fetches its k state images once, after its bg (k x 60,000 B AVIF / k x 90,000 B WebP); **a zoom round
    trip P -> V -> P re-downloads none of P's** while P stays in the keep set (P is Back's target, V's first neighbour,
    §6.3; V is P's neighbour through P's exit), and neither does a walk to an adjacent room and back; **a return after P
    left the keep set** (a view of a view, a room two moves away, a close-up in a neighbour; round 14: an eviction is
    not one, below) **costs k x 60,000 B AVIF / k x 90,000 B WebP again** (k = 5: 300,000 B / 450,000 B, 1.2 s / 1.8 s at 2 Mbit/s). The
    chapter's `transfer` row (6,000,000 B, `budget.ts:122`) counts each manifest file once, as AVIF
    (`budget.ts:929-936`), so it bounds the first fetches and says nothing of a return; the preload also fetches the
    states the player never reaches (each costs its file). ch1 after GM3b: one image, the placeholder `drawer_open`
    (its size MEASURED at GM3b's build and recorded in the cut). **Memory:** the current room's images are counted
    resident by the room-set row already; a view's retained parent states sit in GM4g's transition-pair term
    (`bg(n) + props(n) + labels(n)` with `n` the parent, a view's first neighbour; `props` counts every state image,
    GM3b (3)); any other retained set is bounded by admission, as the neighbour bgs are: a preload fits the 32 MiB
    steady cap (`registry.ts:337-343`; on `cec347c` `admit`'s preload branch `:346-350`), and a visible load past the
    48 MiB hard cap first evicts every preload holder (`:344-353`; `:352-361` on `cec347c`). **Round 14
    (critique_engine_r13 m2 (c)):** an eviction drops the holders in the registry only (`evictPreloads`, `:326-334`;
    `:334-342` on `cec347c`), so the records end while the scheduler's `tags` (`preload.ts:42`, `:113`; `:49`, `:156` on
    `cec347c`) and the
    controller's tracked sets still name the room: it is no departure from the keep set; a state change of the current
    room before its next `roomShown` loads the image under the hold, and that `roomShown` requests the set again (one
    fetch per ended image, the cost above). A state image that does not fit under the steady cap is **refused** by
    admission (dropped silently, `preload.ts:69-70`; on `cec347c` `report`'s `over-cap` silence, `:64-69`, `:66`), loads on the change under the hold, and is requested again at the
    room's next `roomShown`. **Admission order (round 14, critique_engine_r13 m2 (b); §15 Q14 (b)):** first come under
    the steady cap. A retained neighbour's set is live before `roomShown` requests the current room's, so where the keep
    set holds more than the room-set row bounds (it counts the current room's states and one neighbour bg or close-up,
    `budget.ts:883`; `roomSet` is the steady cap, `:126`), a current-room state image can be refused while a
    neighbour's is kept. It then loads at the change at visible priority under the state batch's hold, within the
    48 MiB hard cap and evicting every preload holder first when needed (`registry.ts:344-353`; `:352-361` on
    `cec347c`), so the current room's picture always shows (the room-set row keeps the room's own set within the 32 MiB steady cap, so it fits under the
    hard cap once the preloads are evicted), after <= 0.24 s AVIF / 0.36 s WebP per image at 2 Mbit/s at the LIMIT (ARITHMETIC; the link
    CLAIM; reconcile r2, RC-m4: <= 0.8 s / 1.2 s for a loop-prop atlas). The same first-come rule governs the neighbour bgs today (`controller.ts:163-166`). A priority between
    preload holders would need a refusal signal or a priority-ordered eviction in `scene/{registry,preload}.ts`
    (MEMORY-PLAN's files; LHJ in flight; reconcile r2: LHJ merged as `972f773`, and the priority is the carried
    preload-priority lane of RULINGS 152 Q14 (b), §15 item 14), outside this design.
  - **Rejected:** residency alone (a preload may still be in flight, be refused, or the room may change state in its
    first second: the wait stays, with no hold); `ensure` of every state image in the room batch (every first entry
    waits on files the player may never reach); a hold row per batch caller (the class grew this way: the third
    caller was this remark); round 13: the release at every room left with its cost stated (critique_engine_r12 W2's
    second option: O5 makes the zoom the main navigation, so every zoom-out would pay k x LIMIT, 3.0 MB for ten round
    trips at k = 5, while the memory sits in the gated pair term already); keeping every room's states through a
    close-up (a neighbour's set beside the close-up passes the room-set row's `max` term).
- **Tests:** `visual: a prop's state follows its first matching is`, `visual: a visual condition may read another
  section`, `yields: a state change crossfades the props on screen`, `yields: two placements of one image keep two
  anchors`, `yields: the props command lists placements back to front`, `emit: usage props list every state image`, e2e
  `mechanics: opening the drawer changes its picture at once`; round 12: `yields: a state change that waits on its
  picture holds a motion at its anchor` (a fixture `apply` whose `started` comes late: `ui-state:waiting` with the
  drawer anchor's box before it, `waited` at it, then the crossfade; red on the parent: `takeBatch` shows no new image,
  so nothing is applied and no key is recorded; **M-R12a**: the state batch calls `h.apply` directly), `controller: a
  room preloads every image it can show before its neighbours` (red on the parent: bgs only, `controller.ts:176`;
  **M-R12i**), `controller: a close-up keeps the room's state images and a move releases them` (round 13: a close-up
  keeps the current room's `state:` and releases every other room's, a move releases `state:<m>` only when `m` leaves
  the keep set; **M-R12j**: the close-up branch releases `state:*` too; **M-R13i**: the close-up branch releases
  `room:*` only, round 12's literal branch, so a neighbour's `state:` is kept beside the close-up: red), round 13
  (critique_engine_r12 W2): `controller: a round trip to a neighbour and back fetches each state image once` (rooms P
  and Q with an exit each way, P with two state images; a counting fake scene that keeps a holder set per asset id,
  counts a fetch when an id gains its first holder and ends the id when its last holder leaves, `registry.ts:249-258`'s
  rule, with a trailing `:` naming a family; P -> Q -> P: each of P's images fetched once, and P -> Q -> S with P not
  a neighbour of S releases `state:P`; red on **M-R13h**, round 12's release at every room left: two fetches of
  each), round 14 (critique_engine_r13 m2 (a)): `controller: a refused or evicted state image is requested again at
  the room's next entry` (the same counting fake, which can refuse a preload over a fixture cap and evict every
  preload holder; P -> Q -> P with one of P's images refused at the first entry and another evicted while in Q: at the
  return both are requested and fetched once more, and P's live images are not fetched again; red on **M-R14k**, round
  13's once-per-room rule: no request at the return), round 13 (m1): `yields: a state change holds at the first changed anchor that draws an image` (a fixture
  dispatch that turns anchor `a`, drawn first, to a state with no image and drawer `d` to a new one, both states
  reading one flag the act sets: the hold's box is `d`'s;
  red on **M-R13j**, `anchorBox(diff[0].at)`: `a`'s box) and `yields: a state change that draws no image opens no
  hold` (a take whose only change empties its anchor: the crossfade plays, no `ui-state:waiting` / `waited` is
  recorded; red on **M-R13k**, `stateHold` never returning `'no-load'`: one pair recorded), `build: a room's preload list equals its room-set props` (`build.test.ts`: for every
  room of every built world, `roomImages(w, room)` as a set equals the usage `props` `emit.ts` writes, so the preload
  and the memory row count the same files; red: a fixture decor state that `roomImages` skips), e2e `mechanics: a state picture that loads holds a motion at its anchor` (ch1's
  study; `holdRequests` holds `drawer_open`'s request from the page's load until 1.5 s after `puzzle:solved`, so the
  preload cannot land first; 1.0 s after `puzzle:solved`, with the file still held, `data-cues-played` holds one more
  `ui-state:waiting` than `ui-state:waited` (the state batch's open `null` hold: the close-up's fade-out pair before it
  closes in a microtask), after the release the two counts are equal and the drawer shows `drawer_open`, and
  `data-cue-fallbacks` is 0; red on **M-R12a**: the counts are equal at 1.0 s).

### 6.5 `flags` (GM5f)

- Set-only flags (`{ set: FlagId }` effect; never cleared, so locks never close and the proof stays finite), declared
  with their owning section (`world/flag-scope`: only that section's effects set them); hotspot `when` (presence gate);
  `fl_<flag>` projected as a bool kernel fact kind (`project.ts:15-39` gains it); `normalize` drops undeclared flags.
- **m4:** `reads` lists a flag only where a gating condition reads it; a flag read only by `is` / `decor` costs 0
  states. Test `search: a visual-only flag adds no states`.

### 6.6 `carry`: items across chapters, required allowed (GM9p proof, GM9r runtime; O6 / R9)

- **Data:** `story/items.json` registers carryable ids only: `[{ "id": "brass_key", "from": "ch1" }]` (no texts: a paid
  chapter's item texts are paid content, F4 §7.4). The giving world marks the item `carry: { required }`; each
  receiving world lists it in `inherits` and declares it in `items` with its own texts (its own line IDs).
- **Runtime (GM9r; C1).** One builder, one receiver, every start path:

```ts
// client/src/mechanics/data/carry.ts (engine, pure)
/** The items chapter c's player carries out: held items c's world marks `carry` (chain items included). */
export function carriedOut(w: KernelWorld | null, s: WorldState): readonly ItemId[];
/** The world chapter r starts with: `held = (carried ∩ inherits) ∪ required(inherits)`, in `inherits` order; all else
 *  EMPTY_WORLD_STATE. A chapter without a world, or without `inherits`, gets EMPTY_WORLD_STATE. */
export function chapterStartWorld(w: KernelWorld | null, carried: readonly ItemId[]): WorldState;
/** Every required inherited item absent from `held` and `used` joins `held`; idempotent, O(k). */
export function rearmCarried(w: KernelWorld, s: WorldState): WorldState;
// client/src/app/yields.ts: the one receiver (today `chapterChanged()` sets EMPTY_WORLD_STATE, yields.ts:831-835)
chapterChanged(start: WorldState): void;
```

  | Start path (today) | Change |
  |---|---|
  | chapter end -> `beginChapter(s, loaded, carry, true)` (`game.ts:1208`) | `chapterEnd` computes `items = carriedOut(ch.world, s.yields.world())` before the runner is disposed (`game.ts:1158`) and passes it on; `beginChapter(s, ch, carry, clear, items)` -> `enterChapter(s, ch, clear, chapterStartWorld(ch.world, items))` -> `s.yields.chapterChanged(start)` |
  | the paywall: `pending()` body (`game.ts:1171-1184`) -> `pendingPaid` autosave -> `startPending` -> `beginChapter(..., body.chapterStart.carry, true)` (`game.ts:1088`) | the pending body records `chapterStart: { carry, items }`; `startPending` passes `body.chapterStart.items`, so a purchase, a reload under the paywall and a refund in between all keep the items |
  | a new game -> `beginChapter(s, ch, {}, false)` (`game.ts:1484`; the chapter list starts any owned chapter, `boot.ts:528-533`) | `items = []`: required items only, so a replay of chapter r from the list is playable (optional ones start absent, as ink's carry starts `{}` there) |
  | resume, chapter-start level (`resume.ts:94-101`) | `chapterStartWorld(ch.world, body.chapterStart.items)` replaces `EMPTY_WORLD_STATE` |
  | resume, any level (`reconciled`, `resume.ts:71-78`) | `rearmCarried(w, reconcile(...).state)`: runs **whatever the world version** (`reconcile` returns early on the same version, `reconcile.ts:298-300`), so a save written by any earlier build, or between two lanes, regains the item |
  | `resumeBody`'s `enterChapter` (`game.ts:913`) | passes `EMPTY_WORLD_STATE`; `restore(resumed.world, ...)` follows at `:925` as today |

  Every path through the earlier chapters gives the item (the proof below), and the list replay starts after the
  chapter that gave it (Q11), so the injection never grants what play would not. A required item cannot be consumed in
  chapters c..r (proof step 3), so re-arming "absent from held and used" never resurrects a spent item. **Cue:** at the
  chapter's first room batch yields emits one `fact:held:added` with `cause.verb = 'carry'` per start item (the ribbon
  flies them in, §8.4). **The demo content** (`story/items.json` entry, ch1 `carry`, ch2 `inherits`) lands in GM9r after
  its runtime commits, never in GM9p, so no merged tree ever ships a required item without its injection.
- **The proof (GM9p), per required item `i` given in section G of chapter c and required in chapter r > c:**
  1. **Path cut.** In c's knot graph (`ChapterGraph.knots[*].next`, `ending`, and the section edges, `graph.ts:21-71`,
     `:180-204`), let Y be the knots whose yields include `explore G`. Each yield in Y must sit on its knot's
     straight-line prefix: no choice, divert or conditional block before it (`world/carry-giver-prefix`), so entering
     the knot means reaching the yield. Remove Y; if any **continuing** END knot is still reachable from `firstKnot`,
     `world/carry-required-path` fails. A continuing END is a knot with `ending` (`graph.ts:30-31`) whose name is not a
     key of the chapter's `meta.endings`: those stop the story (`game.ts:1143`), so chapter r is never entered after
     them (m5; verify at GM9p's cut that `meta.endings` keys are the END-writing knots, as `chapterEnd` reads the
     checkpoint knot). Conditional diverts count as both branches: sound, possibly strict (the author restructures).
     `mustPass(graph, from, avoid): boolean` is exported from `graph.ts` (per-player R-E13).
  2. **Leave edge.** In G's search (`checkSection`, `scripts/story/softlock.ts:58-111`), every successor with `leaves`
     holds `i` in `held` (`world/carry-leave`). One check per edge, 0 extra states.
  3. **Not consumed later.** No slot without `keep`, no `uses` rule without `keep`, no recipe input outside `keep`
     accepts `i` anywhere in chapters c..r (`world/carry-consumed`).
  4. **Chapters in order** (Q11): every path into r passes through c (the catalog `next` chain, `story/chapters.json`).
  5. **Tiers:** a paid giver may not feed a free receiver (`world/carry-tier`, principle 0: its texts would have to be
     public).
  6. **Texts (R-E10):** a carried item's texts hold no placeholder of another chapter's puzzle
     (`world/carry-text-placeholder`).
  - **Section proofs of r:** required inherited items are constants of every start state (0 extra states); optional ones
    give `2^k` starts with k <= 3 (`world/inherit-count`), <= 8 searches (ARITHMETIC). An inherited item read by a
    gating rule enters that section's key.
  - **Cost:** one BFS over knots + edges per (required item, chapter) and one pass over G's leave edges, linear in the
    graph (ARITHMETIC). No spike.
- **Free + paid at build time:** the story tool already compiles every chapter, paid included, into `server/content`
  (`emit.ts:132-139`); the proof reads sources, writes nothing public beyond the free receiver's own world.
- **Runtime tests (GM9r, each red on main's start paths):** `game: ending ch1 holding a required item starts ch2
  holding it` (red: ch2's `held` is `[]`, `yields.ts:835`), `game: buying ch2 on the paywall starts it with the carried
  items` (red: `startPending` passes no items), `game: a reload under the paywall keeps the carried items` (red: the
  pending body has no `items`), `game: a new game at a chapter with a required inherited item holds it`, `resume: a
  chapter-start resume starts with the carried and required items`, `resume: a same-version save without a required
  item regains it` (red: `reconcile` returns early, `reconcile.ts:298-300`), `yields: the chapter's first room batch
  flies the carried items in`, e2e `mechanics: a key carried from ch1 opens ch2's door` (through server-dev's
  simulated purchase when ch2 is paid; re-located at the cut).
