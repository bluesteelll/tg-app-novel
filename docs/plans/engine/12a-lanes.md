## 12. Lanes

All lanes: client slot; red-first per commit; the CLAUDE.md gates `npm --prefix client ci | check | test | story |
build` (+ `e2e` through the kit when UI or flow changes); count tests by name; each new gate seen failing on its named
mutation. Locks are the expected touch set on main; each cut re-locates it.

**Ruled: RULINGS 219** — a type-only (behaviour-identical) lane proves its identity on **pinned-id builds**:
`client/scripts/build-id.ts` hashes every non-test `src/` file into `__BUILD_ID__` and `dist/build-id.txt`, so any `src`
edit moves the id and every chunk that holds or names it. The proof is two scratch builds, main and HEAD, with the id
pinned: every `client/dist` sha256 equal (one differing byte a STOP) and the rows equal in exact bytes, plus the real
build as the gate verdict (its rows quoted with their churn). GM3k (`3131844`, 12c) is the first such lane: RULINGS 210
Q4 added it to the lane map after GM3, before GM3b.

**Lane map (renames, merges, splits with reasons).** GM1a, GM1b, GM1c as synthesis. **GM1d** new (I4's lints need a
home before any reach type). **GM2 -> GM2a + GM2b** (save shape vs world renames: two subsystems, > 15 files together).
**GM3 -> GM3c + GM3m + GM3w + GM3s + GM3 + GM3u + GM3p** (O1; the motion gate must land before the first new cue;
round 2: **GM3w** makes `game.ts` and `App.svelte` forward actions and views generically, once, so no later UI lane
edits them (`game.ts:1898-1915` names each action today); **GM3s** mounts the one stage-level cue layer, W3). **GM4 ->
GM4g + GM4 + GM4u** (round 2: the transition-pair gate is independent of views and holds `budget.ts`; the leave control
and the demo view are UI; together > 15 files). **GM4b dropped** (O5). **GM5 -> GM5 + GM5f** (combine vs flags).
**GM7 -> GM7r + GM7p + GM7g** (round 2: the reach runtime, post-on-reach and the mismatch state, is shared by every
reach type and touches `yields.ts`; grid needs GM6s1's length). **GM8 -> GM8i + GM8h + GM8a + GM8b** (round 2: the
devices module vs the host's view presentation and W2's lifecycle; lever family; button family). **GM9 -> GM9p +
GM9r** (build proof vs runtime; GM9r holds `app/game.ts` and the demo content, C1). **28 lanes** (round 2 printed 27:
4 + 2 + 8 + 3 + 2 + 3 + 4 + 2 = 28, an arithmetic slip corrected in round 3; no lane was added). **Round 4: + GM8d**
(`mech-type-demos`, critique_engine_r3 W2: the six new types' demo content in «Прилив» ch3 and every real-layout e2e
of those types; a story-and-e2e lane of 6 files, after GM8b, because each type lane is at 13-15 files and the content
must not join the ch1 chain), so **29 lanes** (4 + 2 + 8 + 3 + 2 + 3 + 5 + 2 = 29), plus **GM5q** (`mech-place-quotient`),
which exists only if P2-b in GM5 shows a view-heavy section past the cap (m6). **Round 5:** no lane added, merged or
split; the changed locks are listed under "Order and conflicts". **Round 6:** no lane added, merged or split; GM3c's
lock grows 9 -> 12 (the text walk, W1), every other lock is unchanged. **Round 7:** no lane added, merged or split;
GM3c's lock grows 12 -> 13 (`client/src/geom/cover.ts`, m1); every other lock is unchanged (W1's and m4's work sits in
files GM3m, GM3s, GM3u, GM3p and GM8h already hold). **Rounds 8-13:** no lane added, merged or split; round 8 grew
GM3w 9 -> 10, rounds 9, 10, 11 and 12 change no lock, round 13 grows GM3p 11 -> 12 (the new
`client/src/requests.test.ts`) (the per-round list sits under "Order and conflicts"). **Round 13 rule for every later
lane (critique_engine_r12 W1; RULINGS 148; it replaces round 12's `VIEW_ASYNC_ROOTS` rule):** a lane whose diff adds a
request start anywhere in `client/src` (a reference to a `REQUEST_PORTS` member, an `import()`, a lib network start)
in a (file, function, member) with no row holds `client/src/requests.test.ts` to add its `REQUEST_SITES` row (and,
for a view row naming a new point-11 row, `client/src/app/yields.test.ts` for its `WaitRow` case), or its cut carries
a STOP item; a new `import()` in a function that has its row (a type's `case` in `loadPuzzleUi`) needs none; a lane
that renames or moves a function holding a start moves its row (a stale row is red); a lane that adds a port to
`api/**` lists it in `REQUEST_PORTS`; a lane that changes a picture applies it through `held`. The walk is global
once GM3p merges, so this binds every client lane of every design (LFL's successors, the shot runtime, meta lanes):
two lanes that add rows hold `requests.test.ts` one after the other, by launch and never beside (reconcile r2,
per-player R-E35: the lanes rule is never two lanes on one file at once, as every other row of §12 reads; an
exception is the orchestrator's to rule case by case, as RULINGS 137 did for `boot.ts`, not this plan's); a trunk
sync that moves a request start re-runs the walk, and its red is the sync's to fix (one row). **Round 14 addition (critique_engine_r13
W1, m1; no lane added, merged or split, no lock changes):** a lane that uses the asset transport (a reference typed by
`FetchAsset`) adds its row like any start; a lane that changes a picture calls `held` and never hands `h.apply` on
(the walk's batch member is red on any other reference to `YieldsHost.apply`); a lane that takes a port, the scene,
the batch or the transport as a dependency types it as the interface, a `Pick` of it or an indexed access naming
one, or the alias, since a structural re-declaration of a guarded member that receives the whole value is red where
the value flows; a component names no guarded type. **Reconcile r1 addition (critique_engine_r14 m2, m3; RULINGS
152; no lane added, merged or split):** a lane that adds a promise-returning member to `YieldsHost` (or to a GM6
host, E-P28) adds its `HOST_WAITS` row naming the wait that covers it; a lane never declares a second function with
a `HeldAt` parameter, never routes a guarded value through a constrained generic that re-declares its member, and
never types a dependency as `unknown` / `object` / `{}` to carry one. The design-shots requests land in their GM
lanes: I-1 GM2a, I-3 GM4g, I-4's seam GM3s, I-6's pin GM3w, I-7's constant GM3m, I-11 GM3b, I-15 GM8d, I-18 a cut
check in every holder of `story/ch1/world.json` (§14.4). **Reconcile r2 addition (RC-W2, RC-W4, RC-W5, R-E34; no
lane added, merged or split, no lock changes):** a lane that confines a member to one site adds a `SITE_MEMBERS` row
rather than a mechanism; the host-wait walk reaches only `client/src`'s `.ts` declarations (§8.1 point 11); I-7's
frame edge `frameShown` lands in GM3p (its device-view case in GM8h); I-11's method is `roomFor` (GM3b).
