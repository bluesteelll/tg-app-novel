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
- **Ruled since: RULINGS 305, 306, 307, 308, 309, 310, 312** — as built (GM5 `5190235`, lock 22; cut r3 and the fix2
  round). Where this section and the points below differ, the points hold.
  - **The data:** a top-level `recipes` key (module `combine`, `client/src/mechanics/data/index.ts:54-61`), each
    `{ a, b, gives, keep?, when?, say? }` (`Recipe`, `client/src/mechanics/data/combine.ts:14-25`; `keep` default [],
    `when` and `say` null).
  - **The action and its refusal:** the ribbon dispatches `combine {a, b}` when the selected item is tapped onto another
    (`oncombine`, `client/src/app/yields.ts:1389-1395`: the selection settles back first, then the dispatch, in one
    `h.tap` block). `applyCombine` (`client/src/mechanics/rules/combine.ts:112-134`) runs in any current section with no
    event knot pending: the first recipe of the unordered pair whose `when` holds writes `held - inputs not kept`,
    `used + those`, then `held + gives`, with the product's `got` toast and the recipe's `say`. No recipe: nothing is
    written, and two cues shake both ribbon items, `module:combine:refused` on the selected item (the error haptic)
    and `module:combine:refused-with` on the tapped one (no haptic; `client/src/cues/stage/motions.ts:219-220`): one
    refusal, one error haptic (RULINGS 306). `combineActions` (`:84`) lists a recipe only while its own section is
    current, each unordered pair once, so the section searches stay per section.
  - **`world/recipe-scope`** (`client/scripts/story/mechanics/combine.ts:34`, `combineFindings` `:45`): a recipe's
    inputs belong to one section S (the first section that gives both, through a chain of S's own recipes in any source
    order: `recipeSections`, `rules/combine.ts:49`); its product is accepted by no lock of another section (X15: the
    kernel's `world/cross-section-item` reads kernel gifts only); each `when` is a gating condition of S
    (`world/cross-section-cond`, `world/cond-size`). An unknown item is `world/recipe-unknown-ref`. The commutation
    argument as built (RULINGS 307 C1): a combine in another section B writes only S-scoped facts **that B's key
    ignores and B's rules never read**; the property test (`combine: combining in another section equals combining
    before leaving the recipe's section`) compares B's enabled steps and their successors' B-keys from `combine(x)` and
    from `x`, seen red on its mutant (B's lock accepts the product).
  - **Ruled: RULINGS 310** — **one giver per product:** a recipe's product has no other giver: no take, trigger or `use`
    rule of any section, and no other recipe of any section, S included (a gift fires once, so a second giver of a held
    product would consume its inputs for nothing); refused under `world/recipe-scope` at `<recipe>.gives`, no new code.
    Pinned by `story: a recipe's product has one giver`.
  - **Ruled: RULINGS 307** — W1 (a): the decoder refuses a recipe whose `keep` holds both inputs
    (`data/combine.ts:79-82`: "a recipe consumes at least one of its inputs"), so every run removes an input and no
    pair is a cue-less self-loop in the playthrough. If content ever needs keep-both, the path is the fire-once
    extension (b): a fired key per recipe, its key cost measured then.
  - **Texts:** `COMBINE_TEXTS` (`client/scripts/story/mechanics/combine.ts:29`) walks every recipe's `say` (role
    `toast`, reach []), registered in `MECHANIC_TEXTS` (`client/scripts/story/mechanics/index.ts:66`); a paid recipe's
    say is a paid needle. `MECHANIC_STORIES.combine` is null (no recipe enters a knot). The texts test and the
    `--fix-ids` pin live in `client/scripts/story/world.test.ts` (`:2035`, `:2047`; RULINGS 306 Q4).
  - **Open (carried to the next holder of `yields.ts`' selection, with `use`):** the hand empties after a refused
    `combine`, as after a refused `use` (`yields.ts:1382-1395`: `onuse` and `oncombine` deselect before the dispatch). Whether the item stays in
    hand after a refusal is one question for both ([08b §8.2](08b-interactions-mechanism-presenters.md#82-i5-every-ui-interaction-and-its-mechanism),
    "Open: the selection after a refusal").

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
  **Ruled: RULINGS 281, 284** — the note as built (GM4g `56cc302`, cut D3 and its O2 model). On `768fc9d`
  `neighbours()` (`client/src/explore/controller.ts:173-181`) is exit (hotspot) order alone: the distinct rooms R's
  exits lead to, a locked exit included, a story exit and R itself not ("Back's target first" and a view's child views
  are GM4's). `roomShown` (`:241-266`) asks for `room:<R>`, `state:<R>`, each neighbour's bg in that order, then each
  tracked neighbour's `state:` set. The note (`neighbourPreloads`, `client/scripts/budget.ts:1126`) starts from R's own
  set, img(R) ∪ props(R), and admits each neighbour room's img(n) (its plate and sheet; the runtime preloads a
  neighbour's bg alone, never its props) first-fit while used + need <= `STEADY_CAP_BYTES`, skipping a refused one, an
  id already in the set at no byte. k is the worst over a first entry (exit order) and every arrival from a neighbour t
  (t and the neighbours R shares with t first, then the rest in exit order); `on tap` lists, in exit order, the rooms
  the first order reaching that k refuses. **The exactness condition:** live at arrival is the room arrived from plus the
  neighbours it shares with R; a wider keep set is not modelled, and GM4's Back-first changes the request order, not
  the keep set. **Characters are out:** the usage carries no stage (on the base the hall keeps 901,432 B with two
  characters on stage, GM4g cut §4.3; the restage removes them, RULINGS 154). A kept `state:` set is asked for after
  every neighbour bg and the registry never evicts a preload for a preload, so on the base it cannot lower k. One path
  remains (GM4g cut §4.3 (c)): at an event's return (no move, kept sets live) after the live set shrank, a bg refused
  at the earlier `roomShown` is asked for again behind a kept image and may be refused where it would now fit; carried
  to GM4 or the preload-priority lane (RULINGS 152 Q14 (b)).
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
  - **Ruled: RULINGS 281, 284** — as built (GM4g `56cc302`, cut D1, D2). `room-set` (`roomRows`,
    `client/scripts/budget.ts:1169`) = img(R) + props(R) + max(the pair, the largest close-up), the pair the largest
    img(n) + props(n) over R's neighbour rooms (0 with none); every image through `imgIds` (`:1093`), a close-up never
    (a CG); an id R and a neighbour share is counted in both terms (an upper bound); a neighbour key not in usage.json
    FAILs the row. The labels terms stay GM6d2's. **Wording:** a room move is a dip under black, not a crossfade: the
    room batch is a `bg` with `t: 'fade'` (`client/src/app/yields.ts:715`), whose midpoint swaps the bg and syncs the
    props (`client/src/scene/executor.ts:923-927`), and both rooms' sets are resident while the move's batch loads
    (`held`, `yields.ts:726`); that is what the pair bounds. A crossfade with both prop sets fading is a state batch
    inside one room (`yields.ts:752`, `executor.ts:929-940`). The usage rooms' `neighbourRooms`
    (`client/scripts/story/emit.ts:93-99`, written by `roomUsage` `:360-387`) are the neighbour room keys in exit order,
    distinct, a locked exit included, the room itself and a story exit not; they are required on read (`decodeRooms`
    `:585-624`: a usage.json written before GM4g is refused, never read as rooms with no neighbours), and
    `RoomUsage = StoryRoomUsage` (`client/scripts/assets/manifest.ts:72`). MEASURED at the merge (RULINGS 284): the
    hall 17,708,296 -> 20,666,516 B (16.9 -> 19.7 MiB), the cellar 18,695,032 and the study 20,668,128 unchanged, all
    PASS under 32.0, each noting `preloads 2 of 2` (the hall) or `1 of 1`.
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
- **Ruled since: RULINGS 285, 286, 287, 288, 292** — as built (GM4 `d695053`, lock 19; cut r3 and its Addendum
  (RULINGS 287)). Where this section and the points below differ, the points hold.
  - **One source for a move's kind:** `moveHow` (`client/src/mechanics/rules/view.ts:27`) names every move core's exit
    tap makes (`'zoom-in'` when the target's `of` is the current room, `'zoom-out'` when the current room's `of` is the
    target, else `'walk'`); `leave-view` (`applyView` `:61`) moves through core's own `arrive` with `how: 'zoom-out'`
    and `via: null`, so a leave reaches the state an exit back reaches. `viewActions` (`:56`) offers it only in a view
    of a current section with no event knot pending; it checks no lock, so **a locked exit back from a view does not
    hold the player**. `viewParent` (`:21`) is the one reader of `of`; the runtime never walks the `of` chain.
  - **The walk by `e.how`** (`client/src/explore/controller.ts:358-382`): a zoom-in pushes the room left whatever exits
    the view has; a zoom-out (by `leave-view` or an exit to `of`) truncates the path at `of` when it is on it, else
    leaves it, and never pushes the view; a walk keeps D7's rule. "Back has a target" is `path.length > 0 || inView()`
    (`:386-390`); `back()` dispatches `leave-view` in a view, one level per press (`:465-468`).
  - **Back-first and one exit-rooms rule:** `neighbours(room)` (`controller.ts:184-188`) is Back's target (a view's
    parent; else the path's last room) first, then `nearRooms` (`rules/view.ts:36`): a view's parent, then the rooms of
    R's exits in hotspot order, distinct, same section, a locked exit included, a story exit and R not. The story
    tool writes the same rule as the usage neighbours (`client/scripts/story/emit.ts:359-376`), so a view's parent is
    its first usage neighbour and every view has a `room-set` row.
  - **The leaf zoom keep** (cut §1.3a; RULINGS 286 Q3): a zoom-in into a view whose only neighbour is its parent keeps
    `state:<parent>` (`controller.ts:213`, `keepsParentSet = e.how === 'zoom-in' && near.every((n) => n === e.from)`,
    read at `:224`). **Proof that it displaces no neighbour bg:** the one neighbour bg `roomShown(V)` asks for is the
    parent's, which `room:<parent>` already holds (a join, never refused), and under the hard-cap eviction both
    holders go and the built order asks the bg first. **Its memory** is V's own `room-set` pair term (V's set + the
    parent's plate and props), so a PASS bounds it under the steady cap; the kept files and characters on stage sit
    outside the row, as for every room. **Counts per zoom round trip P -> V -> P:** P's bg once (kept `room:P`); each of
    P's state images **once** for a leaf view, **twice** for a view with another neighbour (a child view); each of P's
    other neighbour bgs **twice**. Pinned by `controller: a zoom round trip P -> V -> P fetches each of P's state images
    once` and the twice test beside it, under M-R13h and M-K1..M-K4 (12d GM4). Walks and every other zoom release as
    §6.4 round 13 states.
  - **Q9's stated refetch:** P's other neighbour bgs leave the keep set at the zoom-in (`keep(V) = {V, ...neighbours(V)}`
    does not hold them), so P's return fetches each again in the background: (|neighbours(P)| - 1) x <= 300,000 B AVIF
    (450,000 B WebP) per zoom round trip. Holding them would put them ahead of V's own set and outside V's row, so the
    keep stays this narrow (M-K4); carried to the preload-priority lane (RULINGS 152 Q14 (b)) with Q5, O2 and the
    navmem lens's open question.
  - **The note's exactness** (GM4g's `preloads k of n`, `client/scripts/budget.ts:1126`): for a view it is exact (its
    Back target is its parent, `nearRooms`' first entry); a leaf view reads `preloads 1 of 1` with the parent live. For
    a non-view room the note is not a guaranteed worst case under Back-first (carried to the next `budget.ts` holder,
    RULINGS 286 Q4).
  - **Transition:** a zoom move's room batch is a `bg` crossfade of `VIEW_FADE_MS` = 400 ms
    (`client/src/app/yields.ts:49`, `:746-750`); a walk keeps the dip. Pinned by `yields: a zoom move crossfades the bg`.
  - **Ruled: RULINGS 286** — Q2: `world/one-way-exit` exempts an exit into a view; GM4u built it for **any** exit
    into a view, at any depth (`client/scripts/story/world.ts:601-606`), so a depth-2 view (no exit back:
    `world/view-entry` refuses an exit from a view to its parent view) is authorable and leaves by `leave-view` only.
  - **Pins:** `mechanics: every action kind has one handler` (`client/src/mechanics/registry.test.ts:454`) is a
    vitest pin as well as a `check` pin: without its `kinds` line, svelte-check fails on the `satisfies` and vitest on
    `expect(Object.keys(APPLY).sort()).toEqual(Object.keys(kinds).sort())` (GM4 `impl.md`).
- **Ruled since: RULINGS 293, 296, 298, 300, 302, 304** — as built (GM4u `aac7a97`, lock 14; cut r3 and its Addendum
  (RULINGS 300)).
  - **The leave control:** the store's `inView` (`client/src/ui/explore-view.svelte.ts:120`, `:137`) is written by
    yields in the room batch's synchronous run, with the layer, by the controller's own rule over its state
    (`client/src/app/yields.ts:760-764`), and reset to `false` at dispose (`:1410`). `ExploreView`'s `.bar` shows the
    control first while `view.inView` (`client/src/ui/explore/ExploreView.svelte:95-96`: `data-cue="view-leave"`,
    labelled with Back's string `explore.room_back`); `onleaveview` is a required layer action
    (`explore-view.svelte.ts:79`, forwarded `:99`) and yields wires it to `back`, the BackButton's own press
    (`yields.ts:1396`). The control sits under `inert` with every sheet. Pinned by `explore: the view bar's leave
    control leaves the view` and the e2e `mechanics: zoom into the desk and back with the BackButton and with the
    leave control`, `mechanics: a reload inside a view resumes there and offers Back`.
  - **The first committed view:** ch1's `desk_view`, a view of the study (bg `room`, no exit back, no hotspot), entered
    by the study's `to_desk` (`story/ch1/world.json:121-123`, `:142-148`).
  - **Ruled: RULINGS 296** — a view as a section's start room is refused under the existing `world/view-entry` at
    `sections.<sid>.start` (`client/scripts/story/mechanics/view.ts:49-52`); the one-way-exit exemption covers an
    exit into a view at any depth (RULINGS 286 Q2, above).
  - **Ruled: RULINGS 298, 300** — the zoom-out by no exit (`leave-view`, from the control or the BackButton) carries
    the drawn box of the parent's first shown exit into the view just left, the zoom-in's box read backwards
    (`exitBoxInto`, `yields.ts:517-521`, used at `:592`); a zoom-out by an exit keeps its `via` box. A view that no
    parent exit enters cannot be reached at runtime: a save standing in it restarts its section on load (`reconcile`
    -> `unproved` -> `admitSection` from the start room, `'no'` -> restart with its reset toast), so the null-box cue
    is a defensive fallback only ([08b §8.4](08b-interactions-mechanism-presenters.md#84-the-presenter-table-every-cue---default-motion),
    the `move:zoom-in` / `move:zoom-out` row).
  - **Ruled: RULINGS 304** — M-MEM-1, as revised by SH5a (RULINGS 311, 314). RULINGS 296 Q3's "a zoom round trip
    loads bg/room and then bg/hall on tap" was false: on `aac7a97` bg/hall stays resident under GameSession's legacy
    knot hold `preload:manor_arrive` for the whole exploration, and only bg/room loads on tap at the zoom-in. Cut
    1.6's desk prediction (about 26.71 MB) was false there: the desk view read 35,559,504 B of live textures (counted
    35,600,183 B: the explore set 20,647,565 B + the knot hold 14,952,618 B), over the 33,554,432 B steady cap and under
    the hard cap (K5). **On `48489b7` the
    desk view holds 26,712,144 B**, because SH5a's `hold` keeps only `char/` images in a chapter with a decoding
    `look` (`client/src/app/game.ts:1084-1097`); the knot hold's off-stage `char/ally/neutral` (3,044,496 B) remains.
    The study's "preloads 1 of 2" binding term before the first event knot of a fresh start is that off-stage
    character (GM4g Q1's "no characters on stage" misses it). The knot hold's lifetime during exploration, a budget row
    for room-set + a carried knot hold, and the steady-cap e2e at a close-up and a view stay carried (M-MEM-2) to the
    preload-priority lane (RULINGS 152 Q14 (b)) and SH11.
  - **Ruled: RULINGS 307, 308** (as built, GM5 `5190235`) — **the bar stays centred** (RULINGS 307 revises RULINGS
    304's stable slot: `.bar` keeps `justify-content: center`, `client/src/ui/explore/ExploreView.svelte:181-191`, so
    the bar re-centres when the leave control comes or goes). Instead, Inventory and Reveal go through `h.tap`
    (`barTap`, `client/src/app/yields.ts:1334-1340`) **only** in a room batch whose synchronous run flips
    `explore.inView` while the layer was already shown (a zoom into a view, a zoom-out or leave out of one: `barShift`,
    `:361`, set at `:763`, cleared in a `finally` at the batch's end `:768-773` and on dispose `:1411`). There a bar tap
    completes that batch and opens nothing; in every other batch and at rest Inventory and Reveal open at once. During
    a zoom's art load-wait such a tap is swallowed (the fade completes; a load in progress continues): the scene's
    `complete()` reaches enqueued batches only, so on a slow network the bar stays dead until the view's art arrives
    (GM5 player lens F4; views are exit neighbours, so preloading makes it rare).
- **Ruled since: RULINGS 316, 317, 318, 322, 323, 326** — the place quotient as built (GM5q `5142d5d`, lock 5; cut r3
  1.3-1.13; the "State" point above: "the place quotient is the fallback" is now built). Where "State" and the points
  below differ, the points hold.
  - **A free view keys under its parent's place** (`placesOf`, `client/src/mechanics/rules/search.ts:105-128`;
    `sectionPlaces` `:309` lists them). A view V of room P merges iff (a) its entry is ungated: (a2) every exit of the
    section's rooms into V lies in P, has no lock and (since GM5f) no `when`, and at least one does, which implies (a1)
    P is a room of the section; (a3) no module of the registry has a `tap` hook; (b) `enter:V` has no kernel effect
    (by key) and no module effect; (c) its only way out is `leave-view`: (c1) every exit of V leads into a child view
    of V, (c2) the registry offers `leave-view`; (d) no module's `reads` names `visited: V`. (a), (a3), (b) and (d)
    are soundness conditions the property test sees; (c2) one it cannot see (a trapped view would get its parent's way
    out; its red is a search count); (c1) is policy (RULINGS 316 Q2). A merged view of a merged view joins the same
    place (depth 2); a view that does not merge is a place of its own; a cycle's views stay places of their own.
  - **The key and the search:** `sectionKey`'s room part names the place's root; no other key part changes.
    `successors` is unchanged; the search expands a dequeued state over every member of its place, walking to each by
    the free moves (the first lockless parent exit, `leave-view`) and handing `onEdge` the walk as a 5th argument. I-P:
    every reachable state in a merged view has arrived at its root (a view is entered only from its parent, a section
    never starts in one), so the walk writes nothing the key encodes.
  - **Save and resume:** the save format is unchanged (`s.room` is the room the player stands in). A resume admits by
    the place key and resumes in the view itself. Every reachable save gets today's answer, with one new 'yes'
    (RULINGS 316 Q6, accepted): a save from another world version standing with a knot pending in another member of
    the place than the one where the knot was queued admits through its place twin; its future equals the twin's.
  - **Two bounds** (RULINGS 317 W2, 318): places <= `RESUME_STATE_CAP` and work <= cap x `RESUME_WORK_PER_STATE` (8)
    = 40,000 successor evaluations (`search.ts:535`, `:574`; one `reduce` per returned successor, one per walk move
    beyond the first member), one rule for build and runtime; `onStats` reports expansions, work and the bound
    (`SearchStats` `:528`). `world/state-cap` names the bound it passed (`client/scripts/story/softlock.ts:92-96`);
    the count text is byte-identical.
  - **The soft-lock path** prints each hop's walk, then its step, each described from the state before it
    (`softlock.ts:60-135`): a legal path, shortest in place hops, not in taps (RULINGS 323 A1).
  - **No `RULES_VERSION` bump** (RULINGS 316 Q4, 317 O1's rule: a bump is owed when the concrete relation or a
    reachable save's answer can change, not for a key, search or bound change that keeps both). ch1's story log moved
    540 -> 406 states (`desk_view` merges); story-gen, `server/content` and the usage files stayed byte-identical.
  - P2 with the quotient: [§7.6](07-puzzle-types.md#76-state-space-budget-and-spike-p2-r2-m4). Carried (`carry.md`
    "GM5q carries"): the first rules module lane that adds a `tap` hook restates (a3) for the keys it can claim
    (RULINGS 316 Q3); the next `rules/search.ts` holder watches explore-ui (11,870 B at the merge, row limit 16,000).

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
- **Ruled since: RULINGS 245, 246, 248, 258** — as merged (GM3b `ac9cab1`). Where this section and the points below
  differ, the points hold.
  - **Re-located** (GM3b cut §1, the citations above by content on `3785ac6`): in `client/src/app/yields.ts`,
    `roomProps` `:158-169` -> `:194-206`, `act` `:330-347` -> `:601-623`, `takeBatch` `:395-417` -> `:687-703` (the
    stage check `:409-411` -> `:695`, the crossfade `:416` -> `:702`), its `got` job `:296` -> the effect's `'got'`
    case `:529-539`; in `client/src/explore/controller.ts`, the interface `:25-50` -> `:28-59`, `ROOM_HOLDERS`
    `:69-70` -> `:74-76`, the cover mapping `:108-119` -> `hotspotViews` `:107-131` (`cover` at `:114`), `roomShown`
    `:163-166` / `:172-177` -> `:173-185`, `releaseHolders` `:150-156` -> `:153-167`. GM3b then deleted `takeBatch`,
    its `got` push and `roomProps`. On `a064399`: the one props builder `propsOf` (`yields.ts:693`, over
    `placementsOf` `:200`), `act`'s diff and its spliced state job (`:641-655`), `roomBatch` (`:695`), `stateBatch`
    (`:742`) and `roomFor` (`:1353`); in the controller, `STATE_HOLDERS` (`:96`), `trackedState` (`:127`),
    `anchorBox` (`:167`), `releaseAll` (`:184`), `releaseHolders` (`:199-230`), `roomShown` (`:241-266`) and the
    handle's `visualsOf` / `stateHold` (`:481-483`).
  - **Round 13's keep rule, restated (RULINGS 246 W1):** a move releases every `state:<m>` except the new room's.
    m stays tracked while it is in the keep set `{room, ...neighbours(room)}`, and `roomShown` asks for its set again
    after the neighbours' bgs, so the set is live only where it still fits. A room that leaves the keep set is
    released and untracked, as before. An event's return and a resume are no move (`e.from === e.room`), so a kept
    set stays live there. `roomShown` asks in this order: `room:<R>`, `state:<R>`, each neighbour's `room:<n>` in exit
    order, then `state:<n>` for each tracked neighbour (`controller.ts:241-266`). **A neighbour's background outranks a
    kept room's state pictures.** The close-up branch keeps the current room's set and drops every other; `leave` and
    `dispose` release both families (RULINGS 245 Q7).
  - **Round 14's admission-order note, restated:** "a retained neighbour's set is live before `roomShown` requests
    the current room's" now holds only at an event's return. A move releases the kept sets first, and a close-up drops
    them. The outcome is unchanged: an image of the current room refused there loads under the state batch's hold at
    its change.
  - **What W1 gives up:** "a zoom round trip P -> V -> P re-downloads none of P's" now holds only when P's set fits
    after V's neighbours. Otherwise P's set is requested again: at V in the background, one request per image whose
    record ended, or at P's return when refused at V. A priority between preload holders would keep a fitting set with
    no new request; that is the carried preload-priority lane (RULINGS 152 Q14 (b)), which W1 does not need.
    Changed by RULINGS 286, 292 (as of `48489b7`; docs lane `docs-errata-18`, group A): **except a leaf view (GM4's
    keep):** a zoom-in into a view whose only neighbour is P keeps P's set, so each of P's state images is fetched once
    per round trip ([§6.3](#63-view-full-screen-zoom-views-gm4-o5), "Ruled since: RULINGS 285, 286, 287, 288, 292").
  - **RULINGS 245 Q8, as built** (Changed by RULINGS 290 (as of `768fc9d`; docs lane `docs-errata-17`, group A);
    SH4 `768fc9d`, rider R3): a prop that moves keeps its live record, drawn at its new anchor in the same batch with
    no new take, whether into an anchor the target names or out of one to its own key (`syncProps`,
    `client/src/scene/executor.ts:769-791`); and one prop may sit at two anchors, since the logical stage keys a
    placement by its anchor and prop (`at ?? prop`, `reduce` `:233-235`), so both stay. Pinned by `executor: a prop
    moving to another anchor shows at its new key in the same batch` (`client/src/scene/executor.test.ts:1793`),
    `executor: one prop at two anchors keeps both` (`:1837`), and the restore pins `executor: a restore re-keys a
    multi-view anchor without a new anchor` (`:1810`) and `executor: a restore re-keys a multi-view anchor by its patch
    alone` (`:1823`). Q2's shared-prop lint stays carried (`client/scripts/story/world.test.ts`).
  - **The tests' mutations** as restated are [12c GM3b](12c-lanes-gm3.md#gm3b-mech-state-visuals)'s; MEASURED at the
    merge (RULINGS 258): `drawer_open` 6,495 B AVIF / 10,034 B WebP, the study's room-set row 18.8 -> 19.7 MiB. The
    chapter `transfer` row is 12,000,000 B since SH3b (`client/scripts/budget.ts:178`; RULINGS 154 OQ5, 262), not the
    6,000,000 B quoted above.

### 6.5 `flags` (GM5f)

- Set-only flags (`{ set: FlagId }` effect; never cleared, so locks never close and the proof stays finite), declared
  with their owning section (`world/flag-scope`: only that section's effects set them); hotspot `when` (presence gate);
  `fl_<flag>` projected as a bool kernel fact kind (`project.ts:15-39` gains it); `normalize` drops undeclared flags.
- **m4:** `reads` lists a flag only where a gating condition reads it; a flag read only by `is` / `decor` costs 0
  states. Test `search: a visual-only flag adds no states`.
- **Ruled since: RULINGS 327, 328, 329, 331, 333, 334** — as built (GM5f `402d4d8`, lock 27; cut r4, its §7-§9 patches
  and the implement addenda; D1-D11, D6', D6''). Where the two points above and the points below differ, the points
  hold.
  - **The data** (`client/src/mechanics/data/flags.ts`; the module's entry `client/src/mechanics/data/index.ts:65-74`):
    `"flags": { "<flag>": { "section": "<section>" } }` at the world's top; a `{ "set": "<flag>" }` effect inside a
    kernel trigger list (`onEnter`, `then`, `onOpen`, `onFail`), kept by `<trigger>#<source index>`; a hotspot's
    `when`, its presence, any gating condition (kernel atoms or flags); the atom `{ "flag": "<flag>" }`. The fact kind
    `flag` is the module's (`owns.facts`), saved in `WorldState.flags`; `fl_<flag>` is projected (bool) for every
    declared flag (`client/src/explore/project.ts:39-40`).
  - **The runner and A1's rule** (D2): a **kernel effect is defined by its key** (`give`, `unlock`, `story`;
    `isKernelEffect`, `client/src/mechanics/rules/writer.ts:23`), because the proof form keeps a module's owned
    `{ set }` in the kernel lists; `fire` (`writer.ts:48`) runs the module effects at their source index among the
    kernel ones, and fires a trigger whose only effects are a module's. A `set` adds its flag once and records
    `fact:flag:added` (`client/src/mechanics/rules/flags.ts:32-39`), the stage's `sweep` (`client/src/cues/stage/motions.ts:170`).
  - **Presence** (D3): `present` (`rules/flags.ts:84`) is read by core (a tap, `client/src/mechanics/rules/core.ts:135`;
    an insert, `:225`; `actions`, `:465`), use (`rules/use.ts:46`), visual (`rules/visual.ts:53`), the search (a gated
    entry merges no view, `gated` `rules/flags.ts:91`) and the explore controller. A hidden hotspot is no action, draws
    nothing, has no hit area, is no Back route and no free zoom entry. **Presence is not monotone** (a `when` may read
    `held` or `not`): D10, the lock panel closes when its lock goes absent (`shutLock`,
    `client/src/explore/controller.ts:295`); D11, a way back that goes absent clears Back's path (`prune`, `:403`; X12
    W4's rule, PUZZLES-PLAN X12).
  - **Reset and scope** (D4): a section's reset clears the flags it declares (`flagScope`, `rules/flags.ts:74`;
    `ModuleScope.flags`, `client/src/mechanics/contract.ts:200`). The lints `world/flag-unknown-ref` and
    `world/flag-scope` (`client/scripts/story/mechanics/flags.ts:29-32`): a `set` or a gating `flag` atom names only a
    flag its own section declares; a visual site or a clue reads any flag of the chapter; a hotspot `when` is also a
    gating condition of its section (`world/cross-section-cond`). D9: `world/fail-without-effect` counts a module
    effect, so an `onFail` that only sets a flag passes (`client/scripts/story/world.ts:695-699`).
  - **D7, the key, and its invariant (S3):** core's `reads` lists `fired` for a trigger only when it has a kernel
    effect by key (`hasKernelEffect`, `rules/core.ts:378`, used `:422-424`). It is sound because no condition atom
    reads `fired`, a set-only trigger writes only idempotent flags, and flags' own `reads` key each flag a gating rule
    reads (m4); and only while **every set-only trigger that has run has set its flags**, which the runner does on
    every played state and D6 restores on a reconciled one.
  - **D6, D6', D6'': the re-arm** (`normalizeFlags`, `client/src/mechanics/data/flags.ts:155`, run by reconcile after
    its kernel steps, `client/src/explore/reconcile.ts:327-331`). A declared flag is set **iff a current setter of it
    has run**: its trigger is in `fired`, or the trigger has no kernel effect and the fact its own event writes holds
    for its target and the hotspot's current kind (`triggerRan`, `reconcile.ts:57`): `visited` for `enter:<room>`,
    `examined` for a look's `then`, `taken` for a take's `then`, `open` for `open:<key>`, the puzzle's failed outcome
    for `fail:<key>`; an object's `then` has no such fact (an `unlock` opens an object without it). An undeclared flag
    is dropped (`flags:<id>`); a flag no current setter has run goes silently (D6''). The re-arm writes no `fired`.
  - **Resume answers that change (X9 classes, recorded; no committed world declares a flag, so none is reachable on
    shipped content today):**
    - A6 (D7): a reconciled `fired` key of a trigger that lost its kernel effects resumes instead of restarting
      (`no` -> `yes`); sound, the same direction GM5q accepted;
    - S1 / D6' (fix2): a `set` added to a trigger that was empty in the save's version reaches old saves through the
      trigger's event fact; before fix2 the flag was lost for good;
    - P6 / N7: where a setter that reconcile's step 3 un-fired held the flag, D6'' clears it, and S2's restart becomes
      a resume;
    - W1 (cut §8.1): where the new version moved a flag's only setter to a trigger the save has not run, D6'' clears
      the flag, and a save that holds a fact producible only with the flag restarts where keeping it resumed; the
      remedy is the authoring rule "keep the old `set` beside the new one" (AUTHORING "Flags");
    - D1 (cut §9.8): a failed outcome carried from an older version (the puzzle was linear then, or at another lock)
      counts as the current lock's failure, as the kernel already treats it: the lock's `onFail` flags re-arm at load
      and the save resumes with that lock's puzzle already failed;
    - D2 (recorded, not changed): a re-armed set-only trigger runs once more at its next event: one extra
      `fact:fired:added` cue (a pulse; the `enter` row's sweep on re-entry) and a dirty write, keys, flags and answers
      unchanged; that run also delivers any other non-kernel effect the new version gave the trigger.
  - **No `RULES_VERSION` bump** (RULINGS 317 O1's rule, applied with the evidence of cut D7 and checked by the
    critique, RULINGS 329): `RULES_VERSION` (`client/src/explore/reduce.ts:35`) gates only the stored "proved" answer
    (a section's absence from `unproved`); the concrete relation is unchanged on every committed world (none has a
    `flags` key), and A6's state sits only in an `unproved` section, answered live, so a bump would change no answer
    and only cost every player a reconcile. The save format needed no bump either: `flags` came with format 2 (GM2a,
    §5.2's "one bump").
  - **Cost** (author m5): a visual-only flag adds 0 states; two gating flags measured x1.95-3.12 states and x1.98-3.60
    work at ch1's density (spike P2's `flags-real` 896-1,410 states against base 406-528), not "about x2" per flag.
  - **Carried** (`carry.md` "GM5f carries"): Q4's demo flag and the optional `world/flag-unset` warning (widened per
    author m1: a hotspot that can never appear is silent today) to the next ch1 world holder (GM9r); the two kernel-effect
    predicates (`isKernelEffect`, reconcile's by-key copy `reconcile.ts:41`) to the next `reconcile.ts` / `writer.ts`
    holder (O1); `fact:flag:removed` has no emitter (the reset path emits `module:core:reset` only) to SH10 / MR1;
    A7's AND clue (`{ all: [{ flag: f }, { held: x }] }` refused by `world/clue-reachable` while no gating rule reads
    f) with the `examined` / `visited` class; and, unchanged, reconcile's step 1 drops a module trigger's `fired` key at
    a version change (the GM3 carry, RULINGS 210 Q5). Author m6: the flag sweep equals a walk's sweep, and a revealed
    hotspot with no prop shows no visible signal (to MR1).

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
