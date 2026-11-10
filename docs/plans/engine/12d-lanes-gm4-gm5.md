### GM4g `mech-room-set-pair` (new)
- **Goal:** §6.3's transition-pair term for today's exits; the per-room "preloads k of n neighbours" note (m2);
  orchestrator Q1's `first-load` world term if ruled.
- **After:** GM3b (`emit.ts`, `build.test.ts`); GM3s and the adopted animation / shot lanes that hold `budget.ts` or
  `scripts/assets/**` (rev. 3: MD1b; §12 "Animation and shot lanes", RULINGS 132) (`budget.ts`, `manifest.ts`).
- **Lock (6; round 3 m2):** `client/scripts/budget.ts` (`roomRows`, `:869-899` on `a6365a8`, and its usage-room
  reader; it reads `AssetUsage` from the asset tool, `budget.ts:23`), `client/scripts/budget.test.ts`,
  `client/scripts/story/emit.ts` (usage rooms gain the neighbour room keys; the usage decoder is `keysExactly`,
  `emit.ts:546`), `client/scripts/story/build.test.ts`, `client/scripts/assets/manifest.ts` (`RoomUsage`
  `{bg, props, closeups, neighbours}`, `:63-69`, gains `neighbourRooms`), `client/scripts/assets/assets.test.ts` (its
  usage fixture decodes through the same shape, `:816-822`; re-located at the cut). M3c has merged, so no STOP item.
- **Reconcile r1 (design-shots I-3, adopted):** after SH3b on `budget.ts` / `budget.test.ts` (§12 "Order and
  conflicts"); every image term reads `bg(x) + sheet(x)` through SH3b's helper (§6.3); lock unchanged (6).
- **Commits:** (1) `budget: room-set counts the transition pair` (red: the row ignores the neighbour's props; seen red
  on a fixture with a prop-heavy neighbour); reconcile r1: `budget: the transition pair counts each room's sheet` (a
  fixture neighbour with a 2.2 MiB sheet; red before the term reads the helper; **M-RCq**, `bg(x)` alone);
  (2) `budget: room-set notes how many neighbours preload` (a report; the test pins the text); (3) if Q1 is ruled: `budget: first-load counts the head chapter's world` (red on a fixture world
  that pushes the sum over).
- **Gates:** story, build (room-set rows MEASURED before / after), test.
- **Conflicts:** per-player GM6d2 adds the labels terms after GM4g (E-P2).

### GM4 `mech-views`
- **Goal:** §6.3 rules, navigation (W1), preload order (m2), zoom moves.
- **After:** GM4g; P2-a's result (GM1b) read at the cut.
- **Lock (12):** new `client/src/mechanics/{data,rules}/view.ts`, new `client/scripts/story/mechanics/view.ts`, new
  `client/src/mechanics/view.test.ts`; `client/src/mechanics/{data,rules}/index.ts`,
  `client/scripts/story/mechanics/index.ts`, `client/src/explore/controller.ts` (walk rule, `reportPath`, `back`,
  `neighbours`), `client/src/explore/controller.test.ts`, `client/src/app/{yields,yields.test}.ts` (zoom crossfade),
  `client/scripts/story/emit.ts` (views and `of` in the usage neighbours).
- **Commits:** (1) view rules and lints (§6.3 tests; `story: an exit into a view from another room is refused`, `story:
  a view exit to a sibling room is refused`); (2) navigation: `controller: a view without an exit back offers Back`
  (red on main: `onPath` false), `controller: Back from the parent after leaving a view walks the path, not into the
  view` (red: path `[desk_view]`), `controller: a resume inside a view offers Back`, `controller: Back in a view of a view
  leaves one level`; (3) `controller: a room preloads Back's target first, then its hotspot order`; round 13
  (critique_engine_r12 W2; RULINGS 148): `controller: a zoom round trip P -> V -> P fetches each of P's state images
  once` (GM3b's counting fake scene; V a view of P with no exit back; red on the parent: `neighbours(V)` lacks P, so
  `state:P` is released at the zoom-in and each image is fetched twice; green with this commit's `neighbours`, Back's
  target first; then **M-R13h** seen red); (4) `yields: a zoom
  move crossfades the bg` (reconcile r1, design-shots I-5: the path until SH10 replaces it with the camera push into
  `via` plus the dissolve; the batch keeps `kind: 'bg'`, `t: 'crossfade'`, which from SH6 is the exact dissolve
  between two shots, so no kind rename reaches `yields.ts`; a hotspot tap during this batch completes it, GM3w's pin).
- **Gates:** check, test, story, build (new room-set rows), e2e full (no new e2e: GM4u owns it).
- **Carried from SH2 (RULINGS 207):** SH2's critique O3: this lane adds `Room.view`, so it adds a fixture with a real view
  and runs SH2's mutation M-SH2g (`shot/room-frame` skips views) in its original form, red on `shots: a view whose bg
  is declared as an insert fails` (SH2 restated it on rooms, having no view to test).

### GM4u `mech-view-ui` (new)
- **Goal:** the view bar's leave control (`ui:view-leave`), the demo view, the e2e.
- **After:** GM4.
- **Lock (8; round 5 m2 +1):** `client/src/ui/explore/ExploreView.svelte`, `client/src/ui/explore-view.svelte.ts` (`inView`,
  `onleaveview` in `forwardLayer`), `client/src/ui/explore/explore.svelte.test.ts`, `client/src/app/yields.ts` (the
  layer action calls `back()`), `client/src/app/yields.test.ts`, `story/ch1/world.json` (the demo view; GM4's demo
  reuses a catalog placeholder bg, verify which at the cut; narrative-designer), `story/locales/en/ch1.json` (round 5
  m2: the view room's `title` and its hotspots' `label`s are `WorldText`s, `client/src/world/types.ts:82`, `:57`, and
  `loc/missing-en` is an error, `client/scripts/story/lint.ts:61`), `client/e2e/mechanics.spec.ts`.
- **Commits:** (1) `explore: the view bar's leave control leaves the view` (red: no control); `explore: every control
  declares its cue` covers it; (2) the demo view; e2e `mechanics: zoom into the desk and back with the BackButton and with
  the leave control`, `mechanics: a reload inside a view resumes there and offers Back`.
- **Gates:** check, test, story, build (explore-ui; world bytes per hotspot MEASURED), e2e full.

### GM5 `mech-combine`
- **Goal:** §6.2; P2-b with real views and recipes (§7.6). Round 4 (m6): if P2-b shows a view-heavy section past the
  cap, that is a **STOP item** for the orchestrator at GM5's cut, not a commit of this lane: the place quotient changes
  `sectionKey` in `client/src/mechanics/rules/search.ts`, outside this lock, and becomes lane GM5q below.
- **After:** GM4u.
- **Lock (15):** new `client/src/mechanics/{data,rules}/combine.ts`, new `client/scripts/story/mechanics/combine.ts`,
  new `client/src/mechanics/combine.test.ts`; `client/src/mechanics/{data,rules}/index.ts`,
  `client/scripts/story/mechanics/index.ts`, `client/src/ui/explore/Ribbon.svelte`, `client/src/ui/explore-view.svelte.ts`
  (`oncombine` in `forwardLayer`), `client/src/app/{yields,yields.test}.ts`, `client/src/cues/stage/motions.ts`,
  `client/scripts/story/spike-p2.test.ts`, `client/src/ui/explore/explore.svelte.test.ts`, `client/e2e/mechanics.spec.ts`.
- **Commits:** `combine: two items in either order give the product`, `story: a recipe outside one section's items is
  refused`, the commutation property test (§6.2, seen red on its mutant), `explore: an item tapped onto another
  dispatches combine`, P2-b recipes; round 6 (W1): `COMBINE_TEXTS` and its `MECHANIC_TEXTS` line (files of this lock),
  `combine: a recipe's say is a world line of role toast` (in `combine.test.ts`; red: the line absent); round 7
  (critique_engine_r6 m2): pin `combine: --fix-ids skips a recipe's say and names why` (in `combine.test.ts`,
  `fixWorldIds` from `client/scripts/story/fix.ts` over a fixture world whose `recipes.0.say` has no `id`: it is in
  `skipped` with "the text is under no item, doc, puzzle or section", absent from `added`, and the world lint reports
  `id/missing` at it; a pin of `fix.ts:208`, `:241-244` as built, green on the parent; a red means the tool's owner
  rule changed and §3.2's statement is stale).
- **Gates:** check, test, story, build, e2e full.

### GM5q `mech-place-quotient` (round 4, m6; only if P2-b demands it)
- **Goal:** the place quotient for views (synthesis §3.7): `sectionKey` abstracts which view of a room the player is
  in when no gating rule of the section reads it, so a view adds no state where its parent's state already decides
  every edge.
- **After:** GM5 (its P2-b result and `spike-p2.test.ts`); before GM5f (`spike-p2.test.ts`). **Beside:** none.
- **Lock (4):** `client/src/mechanics/rules/search.ts`, `client/src/mechanics/view.test.ts`,
  `client/scripts/story/spike-p2.test.ts`, `client/src/explore/explore.test.ts` (the golden successor pin, unchanged
  by construction).
- **Commits:** (1) `search: equal quotient keys have equal successor keys` (seeded; seen red on a gated view entry,
  the mutation that drops the "no gating rule reads the view" condition); (2) P2-b re-run with the quotient, reported.
- **Gates:** check, test, story (ch1 406 states unchanged; the P2-b section under the cap), build.

### GM5f `mech-flags`
- **Goal:** §6.5 (round 3: `fact:flag:removed` gets its row, §8.4).
- **After:** GM5, and GM5q when it runs (`spike-p2.test.ts`, `explore.test.ts`). **Beside:** GM7r.
- **Lock (12):** new `client/src/mechanics/{data,rules}/flags.ts`, new `client/scripts/story/mechanics/flags.ts`, new
  `client/src/mechanics/flags.test.ts`; `client/src/mechanics/{data,rules}/index.ts`,
  `client/scripts/story/mechanics/index.ts`, `client/src/explore/project.ts`, `client/src/explore/reconcile.ts`,
  `client/src/cues/stage/motions.ts`, `client/scripts/story/spike-p2.test.ts`, `client/src/explore/explore.test.ts`.
- **Commits:** `flags: a set effect sets a flag once`, `project: fl_<flag> is projected when declared`, `story: a flag
  set outside its section is refused`, `search: a visual-only flag adds no states` (red: states double).
- **Gates:** check, test, story, build.
