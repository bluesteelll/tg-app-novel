## 9. Lanes

**Common rules** (CLAUDE.md gate commands):
- every client lane runs `check` and `test` (never `--bail`);
- `story` when it touches `story/` or the story tool;
- `build` when it touches budgets, the bundle or assets;
- `e2e` when it touches the runtime;
- no lane touches `server/`;
- every new gate is seen failing by its named mutation, reported in the lane log;
- tests are counted by name against the list below;
- vacuity guards: a test asserts its fixture is non-empty (e.g. "the fixture shot has 3 face states").

| Lane | Replaces |
|---|---|
| SH1 `shot-dsl` | MA1b's DSL half + MD1a's type half |
| SH2 `shot-flow` | MD1a's story-tool half |
| SH3a `shot-assets` (rev. 4: contract, placeholders, tiers, scan-dist) | MD1b's asset half |
| SH3c `shot-extract` (rev. 4: real art from `src`, R1-R9) | MD1b's asset half |
| SH3b `shot-budget` | MD1b's budget half |
| SH4 `shot-view` | MD2 |
| SH5a `shot-preload` (rev. 4: windows, warm, rooms) | new (S4 §3.4-3.5) |
| SH5b `shot-entry` (rev. 4: half-tier entry, upgrade) | new |
| SH6 `shot-cuts` | MD2's flatten / ledger / arch commit |
| SH7 `shot-idle` | MA1a |
| SH8 `shot-motion` | MA2 + MA1b's runtime + MR2's parallax |
| SH9 `shot-ambient` | MR2's ambient |
| SH10 `scene-cues` | MR1 |
| SH11 `shot-content-manor` | MD3 |
| SH12a `sprites-out` (rev. 4: the kinds, atomic) | MD3's flat-character removal |
| SH12b `sprites-residue` (rev. 4: `budget/knot-set`, `charPlacement`) | MD3's flat-character removal |

### 9.1 SH1 `shot-dsl` (client)

**Goal:** §3.1-3.2 and the snapshot (S24).
- `bg` stays (rev. 2, W2); its default `t` becomes `cut`. A sprite stage takes `face` as `show` without `at`: the
  existing expression crossfade. No file outside the lock builds or matches a changed kind: `kind: 'bg'` and its `t`
  values are untouched, so `yields.ts:377`, `:416`, `yields.test.ts:244`, `:367`, `game.test.ts:225` compile and pass
  unchanged (they pass `t` explicitly).
- The other new kinds are parsed and routed; `cam` sits in the snapshot. Drawing comes in SH4 / SH6 / SH8.
- `splitBatch` / `imageIds` / `manifestIndex` / `knotAssets` move out of `game.ts` into `client/src/app/stage-route.ts`,
  so later lanes leave `game.ts`.
- **Reconciled ([engine §30 Shots errata from reconcile](../engine/30-shots-errata.md#30-shots-errata-from-reconcile) item 12):** this lane keeps `meta?.stepShown()` after the step's view is set (`game.ts:776` on `cec347c`) and at D11's paywall (`game.ts:982` on `cec347c`), pinned by LFL's `game: a presented step tells the meta port` (`game.test.ts:3218` on `cec347c`), `game: a continue into a pending paid start asks for the meta chunk at its paywall` (`game.test.ts:3237`) and its e2e G2; a lane that edits the entry path keeps both calls.
- **Reconciled ([engine §30 Shots errata from reconcile](../engine/30-shots-errata.md#30-shots-errata-from-reconcile) item 18, R-S3):** SH1, SH5a, SH5b and SH7, which rework `present()` / `stage()`, keep a story step's visual batch applied (`scene.apply`, the snapshot move) inside the step's intent, the `withRoomProps` cut back included (`game.ts:723`, `:744`, `:789` on `3c62a86`); detector: per-player GM6d1's `game: a tap while a step's batch loads completes it and starts no step` (M-PR3c), which lands after SH7; per-player owns the text and status ([per-player §12.1 R-S3](../per-player/12-interface-requests.md#121-requests-from-this-file-status-after-enginemd-round-9-as-read-2026-11-03-reconcile-revision-1-round-14-as-read-2026-11-09-reconcile-revision-2-enginemds-reconcile-revision-1-as-read-2026-11-09-reconcile-revision-3-enginemds-reconcile-revision-2-as-read-2026-11-09)).

**Lock (12):**
- `client/src/story/{tags,tags.test,staging,dsl-doc.test}.ts`
- `docs/STAGING-DSL.md` (§6, §7, §2 examples)
- `client/scripts/story/graph.ts` (`assetOf` `:99-123` and `clearsOf` `:130-156`: the new kinds; face = show's expression on a carried char; others none)
- `client/scripts/story/graph-shot.test.ts` (new)
- `client/src/app/game.ts` (imports only)
- `client/src/app/stage-route.ts` (new)
- `client/src/app/stage-route.test.ts` (new)
- `client/src/scene/{executor,executor.test}.ts` (`VisualCommand` and `reduce`, `:35-37`, `:144-187`)

**Commits:**
1. Move the four functions to `stage-route.ts`. Pins `stage-route: splitBatch routes every command kind`,
   `stage-route: imageIds lists a batch's images` (a pure move: no red-first; pinned green on the parent behaviour).
2. `bg` defaults to a cut. Tests:
   - `tags: bg parses with a cut by default`: predicted red `expected 'crossfade' to be 'cut'` (`tags.ts:216`); the
     table rows `tags.test.ts:42-45` move to `t: 'cut'` in the same commit;
   - `tags: bg t=crossfade takes its ms` (green on the parent: a pin);
   - `executor: a bg cut replaces the shot at once` (green on the parent: a pin of the `cut` path, `executor.ts:579-582`);
   - the doc §6 row (`dsl-doc: tag table equals parser kinds` green before and after).
   A different red: a failure in `yields.test.ts` or `game.test.ts` means a default leaked into a batch that relied
   on it; both pass `t` explicitly today, so that red would be a finding, not an expected edit.
3. `face`. Tests:
   - `tags: face names a known character and expression`;
   - `tags: face of an unknown expression is unknown-asset`;
   - `executor: a face changes the expression of a character on stage and nothing else`;
   - `graph: a face names no asset`.
4. `cam`. Tests:
   - `tags: cam push takes to and z within 105..130`;
   - `tags: cam pan needs to`;
   - `executor: a cam move persists in the snapshot until the next cut`;
   - `executor: a scene resets the camera`.
5. `think`, `anim`, `fx`. Tests:
   - `tags: think takes no argument`;
   - `tags: anim names a closed motion`;
   - `tags: fx is shake or flash`;
   - `stage-route: think goes to the session, anim and fx to the scene`.
   - `graph: think, anim and fx name no asset` (the exhaustive switch `graph.ts:118-121` gains each kind in its
     parser's commit; `cam` in commit 4 likewise).
6. Conflicts:
   - `tags: two faces of one character conflict`;
   - `tags: two cam moves conflict`;
   - `tags: two fx in one batch conflict`;
   - (pins, green on the parent) the existing `bg` + `bg` and `bg` + `scene` conflicts (`tags.ts:333-334`).
7. Doc: §6 rows, §7 batch order, valid examples of every kind (`dsl-doc: every example tag parses against the
   catalog` keeps its non-vacuity floor, `dsl-doc.test.ts:128-131`).

**Mutations (each seen red):**
- M-SH1a: `bg` keeps the `crossfade` default (red: `tags: bg parses with a cut by default`);
- M-SH1b: drop the one-face-per-char conflict (red: `tags: two faces of one character conflict`);
- M-SH1c: `reduce` ignores `cam` (red: `executor: a cam move persists in the snapshot until the next cut`).

**Gates:** check, test, story (demo unchanged: 0 findings; no committed `bg:` tag exists, so the default change moves
no chapter), build (entry, engine and first-line rows MEASURED; predicted <= +0.3 KB br engine, E), e2e full (no
visible change: pixel pins green).

**Order:**
- After GM2a (`staging.ts`, the snapshot, I-1), GM3w (`game.ts`) and (rev. 3, W7) **per-player GM6a**: SH1 holds
  `scene/{executor,executor.test}.ts`, and GM6a runs "before the first animation or shot lane holding `scene/*` ...
  never beside any lane holding `scene/*`" (per-player.md, GM6a's order, as read 2026-11-03 at [per-player GM6a `scene-anchors`](../per-player/09a-lanes-gm6a-gm6s2.md#gm6a-scene-anchors-client); rev. 4, m7:
  the file moved from [per-player GM6a `scene-anchors`](../per-player/09a-lanes-gm6a-gm6s2.md#gm6a-scene-anchors-client)). SH1 is the first lane of the `scene/*` chain
  (§9.14).
- Before SH2.
- `graph.ts`: SH1 -> SH2 (rev. 3), never beside GM9p.
- `STAGING-DSL.md` / `dsl-doc.test.ts`: no other planned holder before SH2.

**STOP item at the cut** (rev. 3, m2): I-1 merged in GM2a (`save-codec.ts`'s staging shape admits `cam?`,
`client/src/story/save-codec.ts:181-187`, `Shape<T>` at `:61`). If it has not, SH1 keeps `cam` out of
`StagingSnapshot` (the executor's camera state lives beside the snapshot, and a restore opens at rest framing) and the
orchestrator files the gap; SH1 never edits `save-codec.ts`.
**Reconciled ([engine §30 Shots errata from reconcile](../engine/30-shots-errata.md#30-shots-errata-from-reconcile) item 1):** GM2a declares `CamTarget` / `CamState` in `staging.ts` and reads `StagingSnapshot.cam?` as an optional key, so SH1 imports the types and writes `cam`: this STOP item is met once GM2a merges; engine +0.03 is GM2a's, not SH1's.

### 9.2 SH2 `shot-flow` (client, story tool)

**Goal:**
- the shot list and its decoder, with `effectiveCatalog`;
- the step flow and its playthrough cross-check;
- the shot lints and their §14 doc;
- `build/shots.json` and the art list (§3.3-3.6);
- (rev. 4) appearances with the certain / possible split and the room windows (§3.4; C1, W2), and the
  per-chapter `assets` lists of shot files (§2.5-2.6; W3, W4). The lock is unchanged (all inside `shots/*` and
  `graph.ts`'s one hunk; `RoomEvents` reads `ChapterGraph.sections` and the world body `story.ts` already passes).
- (rev. 5) the event-return edges (`EventReturns` from the same world body and `sections`, W2), `near` (m3), room
  windows keyed `r:<room>` (m7), every visible face's talk file in its appearances (m1), `parseShotFileId` (m8) and
  the legacy-kind confinement below (W3). The lock is unchanged.
- (rev. 6, m3) `near` at a story step = its `possible` count (§3.4), with its test and M-SH2o. The lock is unchanged.
- (rev. 6, m7, size) **SH2 stays one lane.** Commits 2-7 are one pipeline over two files: `shots/flow.ts` (CFG ->
  may-analysis -> lookahead, each reading the previous one's maps) and `shots/usage.ts` (its output), tested in
  `shots.test.ts`. A split SH2a (list, CFG, cross-check, lints, art list) / SH2b (lookahead, windows, returns, output)
  would chain both halves on `flow.ts` and `shots.test.ts`, so they could never run beside each other, and SH2b's
  developer would read SH2a's CFG and may-analysis anyway, since every lookahead rule is stated over them. The lane is
  inside the limits: 10 commits, 11 files (~57 named tests, 15 mutations after rev. 6). The cut may put commit 6
  (lookahead) into two commits if its review round grows; that changes no lock.

**Legacy kinds (rev. 5, W3).** Only `shots/flow.ts`'s may-analysis transfer names `show` / `hide` (the commands, or
`graph.ts`'s `assetOf` / `clearsOf`); `usage.ts` and `lint.ts` read legacy sprites only through `Effect.sprites`
(the `sprites` flag, the entry's sprite alternatives, `shot/sprite-in-shot-chapter`). So when SH12a removes the kinds,
the only files of this directory that fail `check` or `test` are `flow.ts` (its transfer) and `shots.test.ts` (four
fixtures with `# show:`); `usage.ts` and `lint.ts` compile unchanged over a field that is then always empty, and
SH12b removes the field with its readers. A guard test pins the confinement (commit 7).

The demo's shots.json declares the locations and no shot (rev. 3, W7 / W9): the 10 catalog bgs
(`assets/catalog.json:2-13`) are implied cast-less shots (§2.4), `frame: room` exactly where a world names them, so
every committed chapter stays legacy (`show:` sprites) and lints clean (only `shot/undeclared` warnings), and a later
engine lane that turns `lighthouse` or `lamp_room` into a room (GM8d) cannot hit `shot/room-frame`.

**Lock (11; rev. 3, W7: + `graph.ts`):**
- `story/shots.json` (new; the narrative-designer commit)
- `client/scripts/story/shots/{list,flow,lint,art-list,usage}.ts` (new)
- `client/scripts/story/shots/shots.test.ts` (new)
- `client/scripts/story/playthrough.ts` (`transitions`)
- `client/scripts/story.ts` (the pass, outputs, `--art-list`; it passes the chapter's world body to the shot lint for
  `shot/room-frame` and the implied room shots)
- `client/scripts/story/graph.ts` (rev. 3, W7: round 2's "graph.ts is not edited" was wrong: `sectionEdges` is a local
  of the builder, `graph.ts:676-681`, its type module-private, `:71`, and `ChapterGraph` exposes only `carried`,
  `:34-48`. One hunk: export the type and add `sections: { edges, seeds, rooms }` to `ChapterGraph`, the rooms per
  section knot from `knotsOf`, `:615-626`; no second derivation of the section edges)
- `docs/STAGING-DSL.md` (§14)

**Commits:**
1. List:
   - `shots: the shot list decodes against the catalog and cast`;
   - `shots: a cast member outside the vocabulary is refused`;
   - `shots: an undeclared catalog-less shot becomes an implied placeholder`;
   - (rev. 3, W7 / W9) `shots: a catalog bg shots.json lacks is an implied cast-less shot` and `shots: a room's
     undeclared bg is an implied room shot`.
   Red: the module is missing.
1b. (rev. 3, W7) `graph: the chapter graph exposes its section edges, seeds and rooms` (rev. 4, m1: in `shots.test.ts`,
   SH2's own new file, its one home; SH1's `graph-shot.test.ts` is not edited here; red: `sections` is not a property of
   `ChapterGraph`); the pin `budget/knot-set`'s carried stage is byte-identical (`carriedStage` still receives the same
   `SectionEdges`).
2. CFG:
   - `flow: a choice's branches each reach their first line`;
   - `flow: a gather joins its branches`;
   - `flow: a divert enters the knot's first step`;
   - `flow: a tunnel returns to every caller`;
   - `flow: a thread is unsupported`.
3. Cross-check:
   - `playthrough: a run records its step transitions` (red: `ChapterPlay` has no `transitions`);
   - `flow: every observed step transition is an edge`.
4. May-analysis:
   - `flow: the shot in effect after a gather is the union of its branches`;
   - `flow: faces persist across cuts until a scene`;
   - `flow: a chapter's first step starts on the empty stage` (§2.2);
   - (rev. 2, W8) `flow: a section knot starts with its room's shot and props` (the seeds of `graph.ts:200-212`);
   - (rev. 2, W8) `flow: a cut back to a room's shot puts its room in effect`;
   - (rev. 3, W5) `flow: a legacy show is in effect until a hide or a scene`.
5. Lints:
   - `shots: a face of a character absent from the shot fails`;
   - `shots: a face in the batch of a cut names the new shot's cast`;
   - `shots: an off-screen speaker passes`;
   - (rev. 2, m7) `shots: a show in a shot chapter fails` (any character) and `shots: a show in a legacy chapter
     passes`;
   - (rev. 2) `shots: a front plane over a hotspot warns`;
   - (rev. 3: was "fails") `shots: an undeclared shot warns`;
   - (rev. 3, W9) `shots: a view whose bg is declared as an insert fails` (`shot/room-frame`; red on the parent: no
     code);
   - `shots: the doc's shot lint table equals the codes` (two-way, with a non-vacuity floor, no fixed count, so SH3b
     adds its two budget codes with their §14 rows and no test edit).
6. Lookahead:
   - `flow: d1 of a choice lists each branch's first cut`;
   - `flow: a line after a knot's last cut looks into the next knot`;
   - `flow: a cg counts as an image change`;
   - (rev. 2, W8) `flow: a window with a room in effect lists its props and its label bound`;
   - (rev. 2, W5) `flow: a step under a CG enters at the CG alone` and `flow: a gather's entry lists one alternative
     per possible shot`;
   - (rev. 3, W5) `flow: a legacy step's entry lists the sprites in effect`;
   - (rev. 4, C1; replaces round 3's `flow: an explore yield's d1 lists each event's first cut`)
     `flow: a choice whose replies open on different shots lists them as possible, not certain` (red on the parent:
     no `possible`), `flow: a step whose every path opens on one shot lists it as certain with its distance`,
     `flow: a face change is an appearance of its face file` (W4);
   - (rev. 4, W2) `flow: each room of a section has a window of its room and the knots one action away` on the
     critic's fixture: a section whose start room has three events with distinct CU openers and a leave knot whose
     first tag is a `scene:` (red on the parent: no `r:` key), and `flow: an explore yield step enters at any room of
     its section`;
   - (rev. 5, W2) `flow: an event knot's last step lists the return to its room as certain` (a hall event fixture
     ending on CU B: certain = the hall's shot, props and decor at distance 1; red on the parent: the event's END has
     no successor) and `flow: an event co-fired before another makes the return possible, not certain` (a fixture
     `onFail` list with two `story` effects; ch1's at `world.json:89` holds one `story` and one `unlock`);
   - (rev. 5, m7) `flow: two rooms on one bg keep two windows` (red under round 4's `r:<bg>` key: one merged window);
   - (rev. 5, m3) `flow: a room window lists its own openers before its neighbours' onEnter openers` (ch1's hall
     shape: near = the gate event's and the leave knot's files, far = the cellar `onEnter` opener's);
   - (rev. 5, m1) `flow: a cut lists the talk file of every visible face whose expression has one` (a two-face shot,
     only one face speaking at the cut: both talk files listed);
   - (rev. 6, m3) `flow: a story step's near covers all its possible files` (a choice at a CU whose two replies open on
     distinct CUs, no section: `near` = the `possible` count, both openers' plate, sheet and face files; red on the
     parent of the rule: `near` 0 outside a room).
7. Output:
   - `shots: build shots.json lists every need with its line IDs`;
   - `shots: outputs are byte-identical across runs`;
   - (rev. 4, W3 / W4; replaces round 3's `shots: shotTiers puts a paid-only state of a shared shot in the gated
     sheet`) `shots: build shots.json lists every shot file each chapter needs` (a shared shot whose blush only a
     paid chapter reaches: the free chapter lists `bg`, `sheet` and the rest-state talk file, the paid one also
     `face/<s>/<c>/blush`; red on the parent: no `assets`) and `shots: a talk file is listed only where its
     character speaks in that expression`;
   - (rev. 5, m8) `shots: a shot-file id that names no shot, cast member or expression of its need is refused`
     (`parseShotFileId` in `decodeShotUsage`; red on the parent: the decoder checks keys only);
   - (rev. 5, W3) `shots: only the flow names the legacy kinds` (reads the sources of `shots/*.ts`; fails if any file
     but `flow.ts` holds a `'show'` or `'hide'` kind literal or a `kind === 'show'` / `'hide'` test; non-vacuity: it
     finds the literal in `flow.ts`).
8. `art-list: a shot lists its cast, needed expressions with lines, speakers and an hours estimate`;
   (rev. 2, C1) `art-list: a small face in a wide lists its full set` (red if any state is marked optional);
   `art-list: an expression's derived states are listed as conditional on its boxes`;
   (rev. 3, W4) `art-list: every cast member lists its figure mask and hair locks` (a back view in an OTS included; red
   on the parent: no mask rows).
9. `story.ts` wiring + the demo shots.json (narrative designer). `npm run story` prints
   `shots: <n> steps, <m> shots, 0 E` (MEASURED in the log).

**Mutations:**
- M-SH2a: drop the gather join edge (red: `flow/edge-missing` on the demo in `npm run story`, and `flow: a gather joins
  its branches`);
- M-SH2b: `char-absent` reads the cast before the batch's cut (red: `shots: a face in the batch of a cut names the new
  shot's cast`);
- M-SH2c: d1 stops at the first branch (red: `flow: d1 of a choice lists each branch's first cut`);
- M-SH2d (rev. 2): section knots unseeded (red: `flow: a section knot starts with its room's shot and props`);
- M-SH2e (rev. 2): the art list drops talk for faces under 64 px (round 1's rule; red: `art-list: a small face in a
  wide lists its full set`);
- M-SH2f (rev. 3, W4): the art list omits masks for back views (red: `art-list: every cast member lists its figure
  mask and hair locks`);
- M-SH2g (rev. 3, W9): `shot/room-frame` skips views (red: `shots: a view whose bg is declared as an insert fails`);
- M-SH2h (rev. 3, W5): `sprites` ignored by the may-analysis (red: `flow: a legacy step's entry lists the sprites in
  effect`);
- M-SH2i (rev. 4, C1): every `d1` file marked certain (red: `flow: a choice whose replies open on different shots
  lists them as possible, not certain`; rev. 6, m5: round 4's "and SH3b's choice fixture then reads 38.109 MiB" is
  withdrawn, since SH3b's fixtures are hand-built usage JSON, `client/scripts/budget.test.ts:1392-1398`, which no SH2
  mutation reaches; SH3b's M-SH3z gives the gate its own red);
- M-SH2j (rev. 4, W2): room windows only for the section's start room (red: `flow: each room of a section has a window
  ...`);
- M-SH2k (rev. 4, W4): a `face:` without a cut makes no appearance (red: `flow: a face change is an appearance of its
  face file`);
- M-SH2l (rev. 5, W3): `usage.ts` derives the `sprites` flag from `kind === 'show'` commands (red: `shots: only the
  flow names the legacy kinds`);
- M-SH2m (rev. 5, W2): no return edge from an event's END (red: `flow: an event knot's last step lists the return to
  its room as certain`; rev. 6, m5: round 5's "and SH3b's return fixture then reads 12.703" is withdrawn, as for
  M-SH2i);
- M-SH2n (rev. 5, m7): room windows keyed by bg (red: `flow: two rooms on one bg keep two windows`);
- M-SH2o (rev. 6, m3): a story step's `near` written 0 (red: `flow: a story step's near covers all its possible
  files`).

**Gates:** check, test, story (0 E; the W list printed), build (rows unchanged).

**Order:**
- After SH1.
- `graph.ts` (rev. 3): SH1 -> SH2 -> GM9p -> SH12a, never beside.
- (rev. 5, W3) `shots/flow.ts`, `shots/shots.test.ts`: SH2 -> SH12a -> SH12b; `shots/usage.ts`: SH2 -> SH12b.
- `story.ts`: never beside GM1d / GM2b / GM3c / GM9p / GM6c1a / GM6c1b.
- `playthrough.ts`: never beside GM3.
- `STAGING-DSL.md`: after SH1, before SH3b.
- Beside M3s (server slot; disjoint).
