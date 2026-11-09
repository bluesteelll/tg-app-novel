### 9.12 SH11 `shot-content-manor` (content + e2e)

**Goal:** ch1 / ch2 and (rev. 3, W7) ch3 restaged into shots (casts, rests, cuts, faces, cam, anim) with
placeholders; `memory.spec.ts` re-pointed at shot faces; the shot authoring guide. After it no chapter has `show:`, so
every `knot-set` row lapses (SH12 removes the code). Rev. 6 (W3, RULINGS 138 (c)): SH11 is the first lane whose
content has the shapes of three e2e tests SH5a designed, so they move here with their mutation reds (§10 fixture
ledger rows F16-F18), and the restage commits create those shapes.

**Lock (7; rev. 3: + `story/ch3/main.ink`; rev. 6: + `client/e2e/shots.spec.ts`):**
- `story/{shots.json,ch1/main.ink,ch2/main.ink,ch3/main.ink}` (narrative designer; ch3 after GM8d: its
  `lighthouse_radio` and beacon knots included, line IDs untouched)
- `client/e2e/memory.spec.ts`
- `client/e2e/shots.spec.ts` (rev. 6: the three moved tests; it reads `playCh1ToGate`, `arrangeOrder`, `puzzleFrame`,
  `reachLine`, `worldSolutions` from `client/e2e/helpers.ts:313`, `:372`, `:416`, `:481`, `:521`, which it does not
  edit)
- `docs/AUTHORING.md` (doc-writer; rev. 2 adds: characters only in shots, never in a CG, m8; the entry-step levers,
  W5; front planes in rooms)

`client/e2e/perf.spec.ts` is not in the lock: it names no `char/*` id; its context-loss check samples a lit backdrop
pixel at 12 % of the stage height (`perf.spec.ts:210-215`), which any shot plate satisfies.

**Red-first:**
- `scene: an unrestored context loss rebuilds the shot`, re-pointed from the ally sprite (`memory.spec.ts:31-36`) to
  the ally's face box in `street_wide` (red on the parent: the plate's pixel);
- `scene: a failed revive re-acquires the shot`.

**The restage's fixture shapes** (rev. 6, W3; the narrative-designer commits, tags only, line IDs untouched; each e2e
reads its shape in Node from the built manifest and `look` first and fails "fixture shape absent" if it is missing):
- **F16** ch1 `arrival` a005-a013 (`story/ch1/main.ink:17-29`) staged as a wide of the street (`street_wide`, the
  stranger and the ally) -> a stranger CU -> an ally CU -> the wide, with full(wide) + full(CU A) + full(CU B) >
  33,554,432 B, so the four-cut sequence crosses STEADY only if a resident `hope` is kept (the CUs on 1440 plates
  where the placeholder sums fall short: 10.169 + 2 x 15.623 = 41.415 MiB at §5.9's rows; every `step-window` row of
  the sequence still fits: 25.792, 31.246).
  Rev. 7 (m1) pins the staging and states the shape by window class:
  - a005 on the wide; a006-a008 on CU A; **the choice on CU B** (the ally's reaction shot while the heroine decides);
    c001's a009 opens on the wide, c002's a011 on CU A;
  - the test reads in Node from `look` that a006's window has CU B's files in `need` (certain) and the wide's in
    `hope`, and fails "fixture shape absent" otherwise;
  - why the pin: the natural staging puts the choice on the stranger's CU. That makes CU B a `warm` reply opener that
    decodes from its held Blob at the tap, and the test then passes under M-SH5e (critique r6 m1);
- **F17** ch1 `arrival`'s choice (`main.ink:21-26`) shown on a CU, its replies a009 (c001) and a011 (c002) each
  opening on its own shot, neither the choice's, with full(choice CU) + full(opener 1) + full(opener 2) > 33,554,432 B,
  so that under M-SH5h the second opener is refused under STEADY.
  Rev. 7 (m1), with F16's pinned staging:
  - the choice is CU B, and the openers are the wide (c001) and CU A (c002): 12.703 + 10.169 + 12.703 = 35.575 MiB (A,
    §5.9's rows);
  - the test reads in Node that the choice's window has both openers in `warm`;
  - at the choice CU A stays decoded (its window holder survives as a `warm` file), while the wide is held as bytes
    (35.575 > 32). So the test taps **c001**, the reply whose opener decodes from held bytes. Rev. 6 said "the second
    reply", which with this staging opens on the already decoded CU A;
- **F18** `manor_gate_forced` (`main.ink:66-71`) staged with f002 and f001 on two distinct CU-sized shots and f003 on a
  1080 shot (lever 2: the return row then reads <= 29.265 MiB), so the exchange's first `need` refused with EN's
  `room:hall` and `room:study` resident must evict both: full(CU A) + full(CU B) + full(`room:hall`'s files) >
  33,554,432 B. EN's set is resident at this event because the `gate` puzzle has no close-up
  (`story/ch1/world.json:43`), so `releaseHolders` releases nothing before it (`client/src/explore/controller.ts:157`);
  critique r5 W3's "after the gate puzzle's close-up released every `room:*` holder" does not hold (R6.1). Reached by
  `playCh1ToGate` (`client/e2e/helpers.ts:521-548`) and three wrong orders, as `client/e2e/puzzles.spec.ts:109-123`.
  I-18 asks EN's `world.json` holders to keep this path until SH11 merges. Rev. 7 (m3): the shape is read **before
  the third wrong Try's tap** (`puzzles.spec.ts:117-119`). That Try presents f002 itself, and f002's swap evicts both
  rooms, which is the behaviour under test.

**e2e moved from SH5a** (rev. 6, W3; the tester re-applies each SH5a mutation in its scratch copy of
`client/src/scene/preload.ts` / `registry.ts`, never committed, so a mutation run needs no lock):
- (rev. 2, W7; rev. 3, W2) `shots: wide, close-up, reverse close-up, wide never waits` (F16).
  - `page.route` delays every bg after the first by 1.5 s. Rev. 7: before each tap the test waits up to 5 s for
    `stats().scene.window.pending === 0`.
  - The third and fourth cuts appear <= 300 ms after their taps; the fourth, c001's, decodes from held bytes.
  - Red: M-SH5e (the resident `hope` kept: CU B deferred, the bounded wait fails).
  - Rev. 7 withdraws round 6's M-SH5c red here (found while applying m1). With the window admitted at the batch
    start, CU B is deferred, and the swap's sweep retries it (§5.8 step 7), so it lands before the bounded wait ends.
    M-SH5c's red is `executor: a cut reports its swap after the old shot's holders are released` (SH5a commit 3);
- (rev. 4, C1) `shots: a choice cut decodes from bytes held since the choice` (F17; every bg fetch after the choice is
  shown is delayed by 1.5 s; tap c001 (rev. 7, m1; was the second reply) once `stats().scene.warm === 2`; the reply's line appears < 1,000 ms
  after the tap and no request for its files is issued after the tap, `page.on('request')`). Red: M-SH5h
  (`stats().scene.warm` never reaches 2, because the second opener is refused under STEADY; were the wait skipped,
  the tap issues a request);
- (rev. 5, W2) `shots: an exchange inside a room event never waits` (F18; `page.route` delays every image fetch after
  the third wrong Try's tap by 1.5 s. Before that tap, `stats().scene.rooms` lists `room:hall` and `room:study`, else
  "fixture shape absent". Rev. 7, m3: f002's own swap evicts both rooms, so a read at a tap on f002 would fail on
  correct code; before each tap the test waits up to 5 s for `stats().scene.window.pending === 0`; each cut and the
  return appear <= 300 ms after their taps; after the return `stats().scene.rooms` lists the study again). Red:
  M-SH5k (the hall, in `hope`, never evicted: CU B deferred, `window.pending` stays 1, the bounded wait fails).

**Gates:** story (0 E), build (every row MEASURED, ch1 / ch2), e2e full. Rev. 4 (C1): the restage gives
`manor_gate_forced` and `manor_cellar_voice` their own opening cuts and `street`'s choice (`story/ch1/main.ink:115-123`)
a distinct reply close-up per branch, and `build` must pass with them (A: `r:hall` 17.878 MiB, the choice at a CU
13.657 MiB); the log quotes both rows. Rev. 5 (W2): each event's last step now carries its return to the room
(a 1080 CU + the hall 29.265 MiB; a 1440 CU there fails at 32.185 and takes lever 2), and (rev. 6) the e2e full
includes the three moved tests above, each seen red by its re-applied mutation; the log quotes the return rows of
both events and the three shape checks' sums.

**Order:** after M3s (`memory.spec.ts`), SH9 (all features), SH10 (rev. 6: also `client/e2e/shots.spec.ts`'s previous
holder) and (rev. 3, W7) **GM8d** (`story/ch3/main.ink`: GM8d -> SH11, never beside; `client/e2e/stories.spec.ts`,
EN's byte-identical pin of the tide path, runs in SH11's e2e full and must stay green: the restage changes tags only).
Rev. 6: STOP at the cut if I-18 no longer holds on the base (`gate` gained a close-up, or `manor_gate_forced` moved),
unless the EN lane that changed it named the replacement event.

### 9.13 SH12a `sprites-out` (client: the kinds, atomic; rev. 4 split, W6)

**Goal:** `show:` / `hide:` removed from the parser, the command union and every consumer (owner: no sprites
anywhere). Removing a kind is one type-level change: `VisualCommand` is `Extract<StagingCommand, { kind: 'bg' |
'scene' | 'show' | 'hide' | 'cg' | 'wait' }>` (`client/src/scene/executor.ts:35-37`), so `staging.ts` dropping the
variants fails `check` in every switch over the kinds at once, `game.test.ts`'s `reduceStage` included (`case 'hide'`,
`case 'show'`, `client/src/app/game.test.ts:213-248`: TS2678), and every `# show:` fixture becomes
`tag/unknown-kind` (critique r3 W6, grep at this round).

**Lock (15; rev. 4, W6: + the four test files, − `lint.ts`, `shots/lint.ts`, `layout.ts`, `layout.test.ts` to SH12b;
rev. 5, W3: + `shots/shots.test.ts`, − `play.test.ts`):**
- `client/src/story/{tags,tags.test,staging,dsl-doc.test}.ts`
- `docs/STAGING-DSL.md` (§6, §7 rows of `show` / `hide`)
- `client/scripts/story/graph.ts` (`assetOf` / `clearsOf` lose the kinds)
- `client/scripts/story/shots/flow.ts` (rev. 5, W3: the may-analysis transfer of `show` / `hide` goes; `Effect.sprites`
  **stays**, always empty, so `usage.ts` and `shots/lint.ts`, which read only that field by SH2's confinement rule,
  compile and pass unchanged; SH12b removes the field with them; round 4 removed the field here, which would have
  broken both files outside this lock)
- `client/scripts/story/shots/shots.test.ts` (rev. 5, W3: SH2's four sprite cases, whose `# show:` fixtures become
  `tag/unknown-kind`: `flow: a legacy show is in effect until a hide or a scene` and `flow: a legacy step's entry lists
  the sprites in effect` are removed with the transfer; `shots: a show in a shot chapter fails` and `shots: a show in a
  legacy chapter passes` are removed, the code they test now unreachable and retired in SH12b; M-SH2h retires with
  them; rev. 6, m4: `shots: only the flow names the legacy kinds` and M-SH2l are **retired here** too, since the
  guard's non-vacuity floor is the kind literal in `flow.ts`'s transfer, which this lane removes, so the guard would
  fail its own floor; after the removal `check` refuses any `kind === 'show'` / `'hide'` comparison against
  `StagingCommand['kind']` (TS2367, no overlap) in every file, which is a wider guard than the test's `shots/*`;
  round 5 wrote "stays green")
- `client/src/scene/{executor,executor.test}.ts`
- `client/src/app/{stage-route,stage-route.test}.ts` (`splitBatch`, `imageIds`: the moved `game.ts:252-253`, `:277`)
- `client/src/app/game.test.ts` (`reduceStage` `:213-248`; the `# show:` fixture `:127`)
- `client/scripts/story/lint.test.ts` (`:71`, `:80`, `:85`, `:108-114`, `:240-243`: re-aimed at `face:` or at the
  unknown-kind error)
- `client/scripts/story/build.test.ts` (`:189-219`, `:264`, `:361`, `:417`: the carried-stage cases re-aimed at
  `face:` on a shot chapter, or removed with the sprite carry they test)

`client/scripts/story/play.test.ts` (rev. 5, W3: out of the lock): `play: tag lines before a choice block are not a
line` (`:319-338`) asserts only `play/line-without-id` and `batch/conflict` empty and `ended === 200` (`:335-337`); an
unknown-kind tag adds neither, and inkjs still yields the tag-only step, so the test stays green (verify at the cut: if
it goes red, it rejoins and the lock is 16, stated as the atomic-removal exception). `client/scripts/story/
classify.test.ts` (`:66-89`, `:463`, `:499`) uses `show:` only as lexical tag text, which classify never parses:
unaffected (verify at the cut). `client/src/telegram/telegram.test.ts:146` is BackButton's `show`, unrelated.

**Red-first:**
- `tags: show is an unknown kind` (red: it parses);
- `executor: snapshot chars are faces only`;
- `stage-route: no command kind routes a sprite` (red on the parent: `show` routes to the scene);
- the re-aimed fixtures of the two story suites (`lint.test.ts`, `build.test.ts`; rev. 5: `play.test.ts` needs none),
  each red on the parent with its new expectation (e.g. `lint.test`'s `# show:` without arguments now expects
  `tag/unknown-kind`, not `tag/missing-arg`);
- (rev. 5, W3) `flow: a show tag sets no sprite` (in `shots.test.ts`: `Effect.sprites` empty at every step of a
  fixture with `# show:`, which the tag lint reports as `tag/unknown-kind`; red on the parent: the transfer sets it);
- (rev. 6, m4) the guard `shots: only the flow names the legacy kinds` removed in the same commit as the transfer
  (kept, it would be red on this lane's own tree: its floor finds no literal).

**Mutation:** M-SH12a: keep `show` in `TAG_KINDS` (red: `dsl-doc: headings equal parser kinds`).

**Gates:** check, test, story, build, e2e full.

**Order:** after SH11 (no chapter has `show:`); `graph.ts` after GM9p; `shots/flow.ts`, `shots/shots.test.ts` after
SH2 (rev. 5); **`game.test.ts`
after GM9r** (the last `game.ts` / `game.test.ts` holder: "GM2a -> GM3w -> A(`game.ts`) ... -> GM6c2 -> GM6c3 ->
GM6d1 -> GM9r", per-player.md's shared-file table, as read at [per-player §9 Shared files](../per-player/09e-order-and-shared-files.md#shared-files-w4-m9)); **`build.test.ts` after GM8b and per-player
GM6c1a / GM6c1b** ("GM1d -> GM2b -> GM3b -> GM4g -> GM8a -> GM8b ...; per-player GM6c1a, GM6c1b by launch",
engine.md §12, as read at [engine §12 Order and conflicts](../engine/12f-order-and-conflicts.md#order-and-conflicts)); `lint.test.ts`: no planned holder in either design (grep of engine.md and
per-player.md at round 4), re-located at the cut; `scene/*` by launch after SH9 / SH10 / GM6d1.

### 9.13b SH12b `sprites-residue` (client; rev. 4 split)

**Goal:** the sprite-era leftovers that no longer have a reader once SH12a has merged: the `budget/knot-set` code and
its doc row, the `shot/sprite-in-shot-chapter` code and its §14 row, `charPlacement`; rev. 5 (W3): the inert sprite
data path SH12a left in place, so the code and the rows of `knot-set` go together: `Effect.sprites` (`flow.ts`),
`ShotUsage.sprites` and the entry's legacy sprite alternatives (`usage.ts`), `knotRows` and `carriedBound`
(`client/scripts/budget.ts:827-867`, `carriedBound`'s only caller is `knotRows`, `:856`; the call at `:1020`) with
their tests.

**Lock (11; rev. 5, W3: + `shots/flow.ts`, `shots/usage.ts`, `budget.ts`, `budget.test.ts`):**
- `client/scripts/story/lint.ts` (one line: `'budget/knot-set'` at `:66` goes; EN §12's row allows an A(`lint.ts`)
  holder after GM1d, never beside it)
- `client/scripts/story/shots/{lint,shots.test}.ts` (`shot/sprite-in-shot-chapter` goes)
- `client/scripts/story/shots/{flow,usage}.ts` (rev. 5: `Effect.sprites`, `ShotUsage.sprites`, the legacy entry
  alternatives; `decodeShotUsage`'s key set loses `sprites`)
- `client/scripts/{budget,budget.test}.ts` (rev. 5: `knotRows`, `carriedBound`, the `sprites` read SH3b added; the
  knot-set tests `budget.test.ts:951-1041`, `:1199`, and the pinned table lines `:1314`, `:1355`, removed or re-aimed
  at `step-window`, re-located at the cut)
- `client/src/story/dsl-doc.test.ts` (86 -> 85)
- `docs/STAGING-DSL.md` (§11 `budget/knot-set` row, §14 row)
- `client/src/scene/{layout,layout.test}.ts` (`charPlacement` `:93-95` goes)

**Reconciled ([engine §30 Shots errata from reconcile](../engine/30-shots-errata.md#30-shots-errata-from-reconcile) item 18, R-S2):** SH12b, the lane after per-player GM6d2 that holds `client/scripts/story/shots/lint.ts`, also adds the E rule `shot/plane-over-label` beside `shot/plane-over-hotspot` ([§3.3 Lints](03-story-dsl.md#33-lints)): a room shot's plane (back or front) `at` box or a cast member's `body` bounding box meets a bg label's rect of that room, or a front plane's `at` box meets an anchor label's rect (labels: `w.mods.labels`, GM6d2's data). `shots/lint.ts` is already in this lock; until the rule lands, GM6d2's cut checks its one label by hand. Per-player owns the text and status ([per-player §12.1 Requests from this file](../per-player/12-interface-requests.md#121-requests-from-this-file-status-after-enginemd-round-9-as-read-2026-11-03-reconcile-revision-1-round-14-as-read-2026-11-09-reconcile-revision-2-enginemds-reconcile-revision-1-as-read-2026-11-09-reconcile-revision-3-enginemds-reconcile-revision-2-as-read-2026-11-09)).

**Red-first:**
- `shots: shot/sprite-in-shot-chapter is retired` (the code removed);
- (rev. 3) `dsl-doc: lint table equals lint codes` at 85 rows (the pin `dsl-doc.test.ts:146` moves 86 -> 85 with the
  STAGING-DSL §11 row of `budget/knot-set`; red if only one side moves);
- (rev. 5, W3) `budget: no chapter has knot-set rows` (red on the parent: a fixture usage with `sprites: true` still
  yields them) and `shots: build shots.json has no sprites key` (red: the key is written).

**Gates:** check, test, story, build (the rows table loses every `knot-set` row; MEASURED before / after).

**Order:** after SH12a (`dsl-doc.test.ts`, `STAGING-DSL.md`, `shots/flow.ts`, `shots/shots.test.ts`); `lint.ts` after
GM1d, never beside it; `shots/lint.ts` after SH3b; `layout.ts` by launch inside the `scene/*` chain's tail; (rev. 5)
`budget.ts`, `budget.test.ts` after the chain's last planned holder (GM6d2), by launch, never beside any holder.

The asset-side `char` rows go to carry.md for the next `budget.ts` / `manifest.ts` / `catalog.ts` holder (QO7):
- DIMS `char` and the `char` image kind (the catalog's `chars`, `assets/catalog.json:14-37`, still decode);
- char trims;
- (rev. 5) usage.json's `knots.<k>.carried` and `carriedStage` (`graph.ts:204`) lose their last reader with
  `knotRows`; removed by the next holder of `emit.ts` and `graph.ts`.
