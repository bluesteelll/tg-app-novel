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
- **Ruled since: RULINGS 278, 281, 283, 284** — launched from `5d3013e` in lane A (lock 6 as above), beside SH4.
  **Re-located** (GM4g cut §1.1 on `5d3013e`, then on `768fc9d`): `roomRows` `budget.ts:869-899` -> `:1098-1131` ->
  `client/scripts/budget.ts:1162-1211` (doc `:1162-1168`), with `neighbourRoomsOf` `:1102`, `neighbourPreloads`
  `:1126`, `preloadNote` `:1157` and `imgIds` `:1093`; the usage reader `budget.ts:23` -> `:25` (types) and `:1852`
  (`rooms: assetUsage(usage).rooms`); `emit.ts:546` -> `StoryRoomUsage` `client/scripts/story/emit.ts:93-99`,
  `roomUsage` `:360-387`, `decodeRooms` `:585-624` (`keysExactly` itself `:549`); `manifest.ts:63-69` -> `RoomUsage`
  `client/scripts/assets/manifest.ts:72` (now `= StoryRoomUsage`); `assets.test.ts:816-822` -> `decodedUsage()`
  `client/scripts/assets/assets.test.ts:1332`, whose fixture has no `rooms`, so the file stayed untouched;
  `firstLoadRows` `client/scripts/budget.ts:1266-1318`. Built as the plan's commits (1)-(3) in four (`70ca933` the
  usage rooms' `neighbourRooms`, `52e008e` the pair, `2984225` the note, `88757fc` first-load), rider R1 `d5f3136` (a
  step-window FAIL names the window that lacks a file, SH3b review M2) and rider R2 `53207f9` (`story: a played world
  crosses its use edge with the world's mods`, the (b1) call-site pin); the note's model is the critique's O2 (the
  room arrived from and the neighbours it shares with R live first; a three-room cycle fixture, `2 of 4`). Round 1's
  two surviving mutations (the on-tap tie rule; a neighbour preload charging its props) were pinned (`77d4a78`,
  `b230f25`). The merge was held once for a pin gap (V-1: the pair's max pinned only where the largest neighbour is
  the last exit; fix2 `a0c298e`, test-only). Merged
  `56cc302`: 5 files, 8 new vitest names (tag GM4G; 1686); every JS row and every output byte-identical except
  `build/usage.json`; the room-set and first-load rows as [§11](11-budgets-and-validation.md#11-budgets-and-validation)
  quotes them ([§6.3](06-mechanics-as-modules.md#63-view-full-screen-zoom-views-gm4-o5) as built).

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
- **Ruled since: RULINGS 285, 286, 287, 288, 292** — launched from `56cc302` in lane A. **Lock 19 as ruled:** the 12
  above, plus RULINGS 286 Q1's six (`client/src/mechanics/registry.test.ts`, `client/src/mechanics/rules/core.ts`
  (`how` and the exported `arrive`, typed on `KernelWriter`), `client/scripts/story/{softlock,playthrough}.ts` (one
  hunk each), `client/scripts/story/shots/shots.test.ts` (M-SH2g), `client/scripts/story/build.test.ts` (emit's view
  red-first)) and RULINGS 288 Q10's `client/scripts/story/world.test.ts` (two moved assertions: the room-key message
  gains `view`, the registered codes gain `VIEW_LINT`'s four). Commits C1-C4 (the commit (3) round trip pinned
  "once" for a leaf view and "twice" for a view with another neighbour, cut §1.3a) and riders R1, R2; round 1's F1
  fixed test-only (`ff27852`); round 2's R2-C (main's pre-existing `dead ||` in Back's walk branch) carried to GM4u.
  Merged `d695053`: 19 files, 23 new vitest names (tag GM4; 1756), e2e 104 by name; story-gen and content
  byte-identical; engine +154 B (E 0.09; sample 1.711, later replaced by the GM4 + GM4u pair's 4.60, RULINGS 296 Q2,
  304); explore-ui +291 B ([§6.3](06-mechanics-as-modules.md#63-view-full-screen-zoom-views-gm4-o5) as built).

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
- **Ruled since: RULINGS 286, 293, 296, 298, 300, 302, 304** — launched from `d695053` in lane A. **Lock 14 as ruled:**
  the 8 above, plus `client/scripts/story/world.ts` and `client/scripts/story/world.test.ts` (RULINGS 286 Q2: the
  one-way-exit exemption), `client/src/explore/controller.test.ts` test-only (GM4's R2-C and G-M1), and
  `client/scripts/story/mechanics/view.ts` with `client/src/mechanics/view.test.ts` (A-1: a start view refused), and
  one line of `client/src/cues/stage/stage.svelte.test.ts` (RULINGS 296 Q1, `onleaveview: no`). Merged `aac7a97`: 14
  files, 7 new vitest names (tag GM4U; 1763) and 2 e2e (106); engine +306 B (the GM4 + GM4u pair's R sample 4.60
  replaces GM4's 1.711, RULINGS 296 Q2, 304); explore-ui +89 B. The leave control, the demo `desk_view`, the depth-2
  and start-view rulings, the via-less zoom-out's box and M-MEM-1's correction:
  [§6.3](06-mechanics-as-modules.md#63-view-full-screen-zoom-views-gm4-o5) as built.

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
  rule changed and §3.2's statement is stale). **Ruled: RULINGS 306** (Q4) — both tests live in
  `client/scripts/story/world.test.ts` (`:2035`, `:2047` as merged), not in `combine.test.ts`: the app test program
  must not reach `world.ts` / `fix.ts`.
- **Gates:** check, test, story, build, e2e full.
- **Ruled since: RULINGS 305, 306, 307, 308, 309, 310, 312** — launched from `aac7a97` in lane A. **Ruled: RULINGS
  306** — **lock 22:** the 15 above, plus `client/src/ui/explore/ExploreView.svelte`, `client/src/cues/stage/motions.test.ts`
  and `client/scripts/story/world.test.ts` (RULINGS 305: 18), plus Q1's four: `client/src/mechanics/registry.test.ts`
  (the strict registry pins and `kinds`), `client/scripts/story/softlock.ts` (one `case 'combine'`),
  `client/src/explore/reduce.ts` (`look.at` widened to `| null`, type only) and one line of
  `client/src/cues/stage/stage.svelte.test.ts`; **E_engine 0.2** (the decoder is engine-side; STOP +1.033 KB; GM5f
  restates its own term), E_explore 0.6; one refusal, one error haptic (`refused-with` carries none). RULINGS 307:
  keep-both refused (W1 (a)), the bar stays centred (M1's stable slot withdrawn), the commutation property compares
  B's steps; RULINGS 308: bar taps through `h.tap` only in a batch that flips `inView` over a shown layer; RULINGS 309:
  P2-b ruled, GM5q runs; RULINGS 310: fix2 (G-LAYER's pin, three more pins, `barShift` cleared in a `finally`, one
  giver per product). No demo recipe (Q5: carried to the next ch1 content lane). Merged `5190235`: 22 files, 37 new
  vitest names (tag GM5; 1800), e2e 106 by name; story-gen and content byte-identical; engine +580 B (sample 2.90),
  explore-ui +565 B ([§6.2](06-mechanics-as-modules.md#62-combine-gm5-r11) and
  [§7.6](07-puzzle-types.md#76-state-space-budget-and-spike-p2-r2-m4) as built).

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
- **Ruled: RULINGS 309** — P2-b triggered it: `views+recipes-real` is at the cap on every seed
  ([§7.6](07-puzzle-types.md#76-state-space-budget-and-spike-p2-r2-m4)), so GM5q runs next in lane A after GM5's
  merge, with this lock (4). Its STOP: `views+recipes-real` still at the cap on any seed with the quotient, back to the
  orchestrator for §7.6's response (3). The ms per section only on a quiet machine. (Its launch and cut are RULINGS
  313's, after this docs lane's scope.)
- **Ruled since: RULINGS 313, 316, 317, 318, 322, 323, 326** — merged `5142d5d` (lane A, launched from `5190235`, its
  branch fast-forwarded to `48489b7` before any commit, RULINGS 316). **Lock 5:** the four above plus
  `client/scripts/story/softlock.ts` (RULINGS 316 Q1: the soft-lock path prints walk + step;
  `git diff --name-only 5142d5d^1 5142d5d` lists exactly these 5). **Commits:** C0 `c555e2e` (`search: a work bound
  beside the place cap (8 successor evaluations per state of the cap)`, RULINGS 317 W2), C1 `7b84f96` (`search: the
  place quotient for views (equal quotient keys have equal successor keys)`), C2 `ee72f65` (`spike p2: real views and a
  recipe fit the cap with the place quotient`), and fix2 `b8607a8`, `d2ee252`, `3b14b6e` (RULINGS 323: the work
  check's order, an excluded successor's work, a foreign view entry, ch1's place map, a resume inside the merged desk
  view, `exclude`'s doc). No STOP fired: every real view merges and `views+recipes-real` equals `recipes-real` under
  both bounds. ch1's story log 540 -> 406; explore-ui +485 B (all `search.ts`, under the +500 B STOP); no
  `RULES_VERSION` bump (RULINGS 316 Q4). The design as built:
  [§6.3](06-mechanics-as-modules.md#63-view-full-screen-zoom-views-gm4-o5), "Ruled since: RULINGS 316, 317, 318, 322,
  323, 326"; P2: [§7.6](07-puzzle-types.md#76-state-space-budget-and-spike-p2-r2-m4).

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
- **Ruled since: RULINGS 327, 328, 329, 331, 333, 334** — merged `402d4d8` (lane A, from `5142d5d`). **Lock 27**
  (RULINGS 327's 18 = the 12 above plus `client/src/cues/stage/motions.test.ts`, `client/src/mechanics/contract.ts`,
  `client/scripts/story/world.ts`, `client/scripts/story/world.test.ts`, `client/src/mechanics/registry.test.ts`,
  `client/scripts/story/mechanics/core.ts`; plus RULINGS 328 Q1's 9: `client/src/mechanics/rules/{writer,search,core,use,visual}.ts`,
  `client/src/explore/controller.ts`, `client/src/explore/controller.test.ts`, `client/src/world/decode.test.ts`
  (fixtures only), `client/src/mechanics/conditions.test.ts` (the probe rename only); `git diff --name-only 402d4d8^1
  402d4d8` lists exactly these 27). 23 commits: implement (C1-C7 with C2b and the riders R1, R2), fix2 (RULINGS 331:
  the re-arm from event facts, D6' and D6''), fix3 (RULINGS 333, 334: test-only plus comments). The "states double" red
  is D7's: a trigger whose effects are all a module's has no `fired` key fact, so a visual-only flag adds no states.
  E_engine 0.25 (RULINGS 328 Q2); engine +841 B (STOP +1,151), explore-ui +723 B (STOP +1,428); no `RULES_VERSION`
  bump (RULINGS 317 O1's rule, checked by the critique, RULINGS 329). The design as built:
  [§6.5](06-mechanics-as-modules.md#65-flags-gm5f), "Ruled since: RULINGS 327, 328, 329, 331, 333, 334".
