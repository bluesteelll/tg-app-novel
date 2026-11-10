### 9.3 SH3a `shot-assets` (client, asset tool: the contract, placeholders, tiers, scan-dist)

**Goal:** §2.4-2.6, §4.2 steps 5-8, §4.4-4.5 (rev. 4: real-art extraction moves to SH3c, W5).
- the shot file namespaces `sheet`, `face`, `talk` as image kinds everywhere the kind is read (catalog, placeholder,
  manifest, the budget Records);
- placeholder shots synthesized from needs (masks, the depth grid of m2, every needed face and talk file);
- packing per file with the half tier; the head plateau bitmasks (both lattices) and head groups (W3, from masks);
- tiers per file through `tierOf` over build/shots.json's `assets` (rev. 4, W3); manifest `shots` / `look` /
  `loops`; loop props (W10);
- runtime decoders (`client/src/story/shots.ts`); rev. 5 (W1): the runtime window type `ShotWindow`, `stepWindow`
  returning it, the look emitter folding WindowRefs into `[need, warm, near, hope]`, and `shotImages` (I-16), so
  SH5a and SH9 import them and neither edits `story/shots.ts`;
- scan-dist: its own derivation, owed fingerprints, the `dist/` whitelist (§2.5).

The lane spans the runtime decoders, the asset tool and scan-dist (rev. 2, m6): one subsystem, the shot asset
contract, whose three readers must change together (the decoder, its producer and the paid-leak scan of its files).
Rev. 4 (W5): **`imageKind` / `ImageKind` (`client/scripts/assets/placeholder.ts:10-25`) is the one image-namespace
predicate**, read by `halfAsk` (`manifest.ts:128-147`), the plan invariant (`manifest.ts:346-348`) and the budget
(`client/scripts/budget.ts:24-25`, `:92`, `:128`, `:200-206`, `:701-706`, `:814`, `:918`); widening it makes the
exhaustive `CANONICAL_SIZE` (`placeholder.ts:13-19`), `shapes` (`:37-82`), `LIMITS.image` (`budget.ts:92`, `:128`) and
`DIMS` (`:200-206`) Records fail `check` until each has the new kinds. So SH3a holds `placeholder.ts` and
`budget.ts`'s **two Records only** (the §4.4 values for `sheet`, `face`, `talk`; no row, no evaluation change); SH3b
then adds the rows. A separate predicate for derived kinds (critique option 2) would leave `budget.ts:701-706` and
`:814` reading a sheet as not-an-image (the audio path) between SH3a and SH3b, so it is rejected.

**Carried from SH2 (RULINGS 207):** SH2's cut Q7: a declared catalog-less shot passes `story` and fails `npm run
assets` until this lane's effective catalog (SH2 merged `7f45dee`; `D:/tmp/novel-orch/carry.md` "SH2 carries").

**Lock (12; rev. 4: − `encode.ts`, − the `src` fixture (both SH3c), + `placeholder.ts`, + `budget.ts`):**
- `client/src/story/catalog.ts` (namespaces `sheet` / `face` / `talk` in the id lists `:78`, `ASSET_ID_RE` `:390`,
  `:767-769`; bg `src` form decoded; `decodeAssetManifest` optional `shots` / `look` / `loops`)
- `client/src/story/{shots,shots.test}.ts` (new)
- `client/scripts/assets/{shots,shots.test}.ts` (new: placeholders, packing, plateau, rigs, look)
- `client/scripts/assets/placeholder.ts` (`ImageKind`, `CANONICAL_SIZE`, `shapes` for the three kinds)
- `client/scripts/assets/manifest.ts` (`halfAsk`; the usage view adds build/shots.json's `assets`; manifest keys)
- `client/scripts/assets.ts` (reads build/shots.json)
- `client/scripts/assets/assets.test.ts`
- `client/scripts/budget.ts` (the `LIMITS.image` and `DIMS` entries for the three kinds only)
- `client/scripts/{scan-dist,scan-dist.test}.ts`

**Commits:**
1. Rig and look:
   - `shots: a rig decodes`;
   - `shots: an unknown rig key is refused`;
   - `shots: a look entry indexes the image table`;
   - (rev. 5, W1) `shots: a look window decodes need, warm, near and hope` (and refuses `near > warm.length`);
   - (rev. 5, W1, m7) `shots: stepWindow finds a room window by its room id`;
   - (rev. 5, W1) `shots: shotImages lists a room's bg and its sheet, never a face or talk file` (a fixture rig with
     a cast at rest and one non-rest face file; red: not exported);
   - `catalog: sheet ids are image ids`.
   Red: the module is missing.
2. Placeholders:
   - `assets: a placeholder shot has a layer per needed face state` (red: no sheet entry);
   - `assets: a rest expression has no layer`.
3. (rev. 4: extraction R1-R4, R6-R7 and the masked layers moved to SH3c) Masks, plateau, checks on placeholders:
   - R5 `assets: a plate that is not 2048 high fails`;
   - (rev. 3, W3) `assets: the head plateau covers the head mask and every face layer box with one cell of margin`
     (replaces round 2's face-box test; red under M-SH3u: the plateau from the face boxes only) and `assets: two heads
     closer than their bands form one head group`;
   - (rev. 3, W4) R9 `assets: a cast member without a hair lock fails` and `assets: a back-view member without a
     figure mask fails`;
   - (rev. 4, m2) `assets: a placeholder room's depth grid is far at the top and near at the floor`.
4. Packing and half (rev. 4: per file):
   - `assets: a sheet packs every member within 2048 px with even frames`;
   - `assets: a sheet's half halves every frame exactly`;
   - (rev. 4, W4) `assets: a placeholder shot has one face file per needed expression and one talk file per spoken
     one` and `assets: a face file that reuses the rest blink carries a copy of it`;
   - (rev. 3, C1; rev. 4) `assets: sheets, face and talk files get half files` (`halfAsk` over the new namespaces;
     red: `'none'`).
5. (rev. 4, W5) Kinds: `assets: every image namespace has a canonical size and a placeholder shape` (in
   `assets.test.ts`; the three kinds; red on the parent: `imageKind('face/...')` is null). The budget Records are kept
   complete by `check` (`Record<ImageKind, ...>` refuses a missing key); SH3b's tests pin their values.
6. Tiers (rev. 4, W3): `assets: a face file only a paid chapter needs is gated` (through `tierOf`, `manifest.ts:112-121`,
   over build/shots.json's `assets`; red on the parent: the asset tool reads no shot list) and `assets: a shot shown
   by a free chapter has a public plate and sheet`.
7. Manifest:
   - `assets: a chapter manifest carries only the rigs, members and files its chapter uses`;
   - (rev. 5, W1) `assets: the manifest look keeps need, warm and hope apart` (end to end: a fixture usage whose step
     has `cur` {CU A}, `certain` {CU B} at distance 2, `possible` {CU C, CU D} with `near` = CU C's file count (rev. 6,
     m8: its plate, sheet and face file, 3; round 5 wrote "`near` 1"), `d2` {wide}, through the
     emitter, `decodeLook` and `stepWindow`: `need` = CU A's and CU B's files, `warm` = CU C's then CU D's, `near` =
     CU C's file count, `hope` = the wide's; red on the parent: the emitter writes no windows);
   - (rev. 5, m8) `assets: every shot file id in build/shots.json is a manifest asset id` (each id the fixture usage
     lists passes the widened `ASSET_ID_RE`, and each `parseShotFileId` result names its manifest entry);
   - the pin `assets: paid manifest keeps the server fixture keys` (`assets.test.ts:887-922`) stays green.
8. scan-dist (rev. 4, W3; §2.5):
   - `scan-dist: a paid-only face file without a fingerprint fails closed` (the owed set from its own read of
     build/shots.json; red on the parent: not owed);
   - `scan-dist: a paid-only shot file in dist fails by the whitelist` (a `face-...` file whose id no free chapter
     lists; red: no whitelist finding);
   - `scan-dist: a paid-only face file that the asset tool tiered public fails` (the real `planAssets` over a fixture
     usage, its public files written to a fixture `dist/`; green on the parent, red under M-SH3y);
   - `scan-dist: every public shot file passes the whitelist` (non-vacuity: the fixture has >= 4 public shot files).
9. (rev. 4) `src`: the catalog's `src` form decodes (`catalog: a bg src form decodes`); the asset tool refuses a `src`
   bg with "extraction lands in SH3c" (`assets: a src shot before extraction is refused by name`); no committed `src`
   exists until SH3c.
10. (rev. 2, W10) Loop props: `catalog: a loop prop decodes with its frames and fps`, `assets: a loop prop packs its
    frames into one atlas with the loop rig in the manifest`, `assets: a loop prop used only by a paid chapter is
    gated` (the per-file tier rule, `manifest.ts:112-121`). Red: the catalog form is unknown.

**Mutations** (rev. 4: M-SH3a, M-SH3b, M-SH3c, M-SH3n, M-SH3e, M-SH3l, M-SH3t move to SH3c with their checks):
- M-SH3o (rev. 2): the loop rig omitted from the manifest (red: commit 10's second test);
- M-SH3d: odd frame coordinates (red: the half test);
- M-SH3f (rev. 4: re-aimed) the asset tool's usage view drops build/shots.json's `assets` (every shot file then
  "unused"; red: commit 6's tier test and scan-dist's owed-fingerprint test);
- M-SH3g: the rigs of every chapter in each manifest (red: commit 7);
- M-SH3k: w = 1081 accepted;
- M-SH3r (rev. 3, W4): R9 skipped (red: commit 3's R9 tests);
- M-SH3u (rev. 3, W3): the plateau from the face boxes only (red: `assets: the head plateau covers the head mask ...`);
- M-SH3v (rev. 3, C1): `halfAsk` keeps `'none'` for the new kinds (red: `assets: sheets, face and talk files get half
  files`);
- M-SH3y (rev. 4, W3): **inside the asset tool's tiering**, every chapter counted free (red: scan-dist's
  `a paid-only face file that the asset tool tiered public fails`, by (b) and (c) of §2.5: the check scan-dist does
  not share with the producer);
- M-SH3aa (rev. 4, W4): copies omitted, a face file referencing the rest layer in `sheet` (red: `assets: a face file
  that reuses the rest blink carries a copy of it`);
- M-SH3ab (rev. 5, W1): the look emitter merges `possible` into `need` (round 4's `d1`; red: `assets: the manifest
  look keeps need, warm and hope apart`; downstream SH5a's `shots: a choice cut decodes from bytes held since the
  choice` would read 38.109 MiB of `need` at the CU choice and defer CU C).

**Gates:** check, test, story, build (manifest bytes and first-load MEASURED before / after), e2e full (no visible
change).

**STOP items at the cut:**
- `content.rs:357-375` must accept unknown top-level manifest keys; else the lane needs the server slot;
- the fixture pin must compare per-entry keys only; else the two server fixture manifests join the lock and
  `cargo test` runs;
- (rev. 4) `budget.test.ts` must not pin the Records' key sets (grep at this round: no `LIMITS.image` / `DIMS` key pin,
  only a comment at `budget.test.ts:901`); else it joins the lock.
- **Reconciled ([engine §30 Shots errata from reconcile](../engine/30-shots-errata.md#30-shots-errata-from-reconcile) item 9):** SH3a's decoders stay out of the entry: `client/src/story/catalog.ts` is in the entry closure (`boot.ts:21` value-imports its decoders), so `story/shots.ts` is imported by neither `catalog.ts` nor `boot.ts`; the cut quotes the entry ledger ([engine §11.1 The shared ledgers](../engine/11-budgets-and-validation.md#111-the-shared-ledgers-reconcile-r1-r2-rulings-143-qo10-152-r4-153-155-design-shots-i-13), Ledger 2) and an entry delta above +0.15 KB br (its 0.10 + 0.05) is a STOP item here. **Ruled since: RULINGS 158** — L1 is unshelved (RULINGS 142's return condition: 38,988 B + 510 B = 39,498 B, 502 B left against the 500 B line, inside the build's own churn) as lane `l1-entry-summary` (`summaryOf` into `saves/summary.ts`; entry -1.59, first line +0.21, CLAIM at `cdca9d4`); L2 stays shelved. The cut/build crossing rule above stands for every later entry-adding lane, read against the row after L1 merges. Changed by RULINGS 159 (as of `9a83251`; docs lane `docs-errata-10`, group A): L1 merged `eec24fe`; entry 37,338 B MEASURED, 2,662 B left; first line 254,288 B MEASURED.

**Order:**
- After SH2 and **M3s** (`manifest.ts`, `assets.test.ts`; MEMORY-PLAN `:1315-1349`).
- Before SH3c, SH3b and GM4g (`manifest.ts`, `assets.test.ts`, EN [engine §12 Order and conflicts](../engine/12f-order-and-conflicts.md#order-and-conflicts)).
- `budget.ts` (rev. 4): {SH3a, GM3s} by launch, never beside, then SH3b; **never beside GM3s**.
- `catalog.ts`: no other holder.

### 9.3c SH3c `shot-extract` (client, asset tool: real art from `src`; rev. 4, W5)

**Goal:** §4.1-4.3 for `src` shots: diffs against declared bases, the expression / motion layers per file of §2.6
with copies of reused rest states, R1-R4, R6-R8, masked layers and joint states (m7), the per-shot `q`, the real-art
fixture (S-A's shot once it exists). Split out of SH3a so each lane stays one subsystem (round 3's SH3a: 10 commits,
~40 tests, 15 mutations, critique r3 W5).

**Carried from SH2 (RULINGS 207):** SH2's cut Q6: the reader of a shot's plane `at` boxes is SH12b's (it holds
`shots/lint.ts` and needs it for `shot/plane-over-label`); this lane's cut notes that the story tool must be able to
read a shot's plane `at` boxes, since the story tool runs before the asset tool.

**Lock (7):**
- `client/scripts/assets/{extract,extract.test}.ts` (new: pure diffs and checks over synthetic buffers)
- `client/scripts/assets/shots.ts` (wires `src` shots into packing)
- `client/scripts/assets/encode.ts` (shot source I/O, still the only `sharp` importer; alpha; `q`)
- `client/scripts/assets.ts` (the `src` path)
- `client/scripts/assets/assets.test.ts` (R6 on encoded output; `q`)
- `client/scripts/assets/fixtures/shot/` (new: one tiny `src` shot; later S-A's)

**Commits** (one fixture per case, §4.3; the round-3 names kept):
1. Extraction: `assets: an expression's diff becomes one expression layer`; `assets: an expression that keeps the rest
   eyes reuses the rest blink` (rev. 4: as a copy in its face file); `assets: a non-rest talk is cut against its
   expression`. Red: `extract.ts` is missing.
2. Registration and clipping: R1 `assets: a relit expression fails registration`; R2 `assets: overlapping motion
   boxes fail`; R3 `assets: a diff clipped at the plate edge fails`; R7 `assets: a cut-out not inpainted in the plate
   fails`.
3. Coverage: R4 `assets: an expression that changes the eyes needs its own blink` (and passes once supplied);
   `assets: a needed state missing from the source fails with its line IDs`.
4. Masked layers (m7): `assets: overlapping blink and accent boxes are cut as masked layers`; `assets: touching blink
   and accent diffs ask for the joint states`.
5. Encoding: R6 `assets: an encoded sheet keeps its feathered alpha within 8/255` (and a face file); `assets: a shot's
   q lowers its AVIF bytes`.
6. `src` end to end: `assets: a shot source directory builds its plate, sheet, face and talk files` (replaces SH3a's
   refusal by name).

**Mutations:** M-SH3a (R1 only inside the head mask), M-SH3b (skip the overlap test), M-SH3c (R3 before clipping),
M-SH3n (the reuse rule always reuses), M-SH3e (alpha clamped), M-SH3l (plate = original), M-SH3t (masked layers cut
as rectangles); each red on its named test as in round 3.

**Gates:** check, test, story, build (bytes of the fixture shot MEASURED), e2e full (no visible change).

**Order:** after SH3a (`shots.ts`, `assets.ts`, `assets.test.ts`); beside SH3b (disjoint: SH3b holds `budget.ts`,
`budget.test.ts`, `shots/lint.ts`, `STAGING-DSL.md`); before GM4g (`assets.test.ts`, EN's A(`scripts/assets/**`)).

### 9.4 SH3b `shot-budget` (client, budget)

**Goal:** S22-S23 rows; the §4.4 guards; `room-set` counts the room's sheet; STAGING-DSL §8 rewritten for the step
model. Rev. 2: `step-window` counts the props, decor and label bound of a room in effect (W8); `entry step images`
with its printed derivation (W5); the lazy family `scene-motion chunk (br)` (W6); plate file limits scaled by width
(m10). Rev. 3: `knot-set` **kept** for chapters with `sprites: true` (W5); `entry step images` at the half tier plus
the chapter files, limit 279,000 B (C1, W1); codes in `SHOT_LINT_CODES`, not `LINT_CODES` (§3.3). Rev. 4: the
`step-window` formula of §3.4 (the certain term due one step ahead, possible openers at kept bytes, one row per `r:`
room window), the face and talk file guards, the levers note of §5.9.

**Carried from SH2 (RULINGS 207):** SH2's cut Q3: this lane's two budget codes join `SHOT_LINT_CODES` and STAGING-DSL
§14, typed `ShotFinding` (SH2's finding type beside `Finding`); SH2 fix r1's limits: cross-list co-firing (an `unlock` /
`openAt` inserting another list's knots into the queue), the yield batch on a plain `r:` return, and `graph.ts`'s
`carriedStage` seeding a co-fired-only event.

**Lock (4; rev. 3: `lint.ts` out, `shots/lint.ts` in):** `client/scripts/{budget,budget.test}.ts`,
`client/scripts/story/shots/lint.ts` (two codes, `budget/step-window` and `budget/entry-step`), `docs/STAGING-DSL.md`
(§8, §14 rows).

**Commits:**
1. `budget: step window over 32 MiB fails` (red: no row) and `budget: step window counts the current shot once`;
   (rev. 2, W8; rev. 4 fixture) `budget: step window counts a room's props and label bound in effect` (§5.9's room
   story step before a 1440 CU: 32.185 MiB, red; 26.885 without the room terms, so M-SH3p turns it green).
   Rev. 4 (C1, W2; replaces round 3's `budget: step window at an explore yield counts the room and every event's
   first cut`):
   - `budget: step window counts a possible opener at its kept bytes` (the choice at a CU with CU replies: 13.657 MiB,
     green; red under M-SH3z at 38.109);
   - `budget: step window counts a certain image at the step before it appears` (the CG fixture: 34.168, red; the same
     chapter with the CG dismissed one line earlier: 25.406, green: lever 1 seen working; red under M-SH3h);
   - `budget: step window per room counts the room and the openers one action away` (the critic's fixture, three CU
     event openers and a `scene:` leave knot in one room: 18.355, green; red under M-SH3z at 64.8);
   - `budget: a failing step window prints its levers` (levers 1 and 2 with the step key);
   - (rev. 5, W2) `budget: step window at an event's last step counts the return to its room` (a hall event fixture:
     ending on a 1080 CU 29.265 MiB, green; ending on a 1440 CU 32.185, red with lever 2 printed; rev. 6, m5: round
     5's "under SH2's M-SH2m the 1440 case reads 15.623 and passes, so this test is also M-SH2m's red at the gate" is
     withdrawn: the fixture is hand-built usage JSON, as every `budget.test.ts` fixture is
     (`client/scripts/budget.test.ts:1392-1398`), so no SH2 mutation reaches it; M-SH2m keeps its own red in SH2);
   - `budget: a face file and a talk file over their limits fail` (§4.4).
2. (rev. 3, W5) `budget: a legacy chapter keeps its knot-set rows` (a fixture chapter with `sprites: true` whose knot
   shows sprites to 33.0 MiB: red under M-SH3s) and `budget: a shot chapter has no knot-set rows` (a cinematic knot
   of 10 shots would read 88.7 MiB there); the `knotRows` image rows `:841-867` stay for legacy chapters; LINT_CODES
   and its 86-row pin unchanged.
3. (rev. 3, C1 / W1) `budget: entry step images over 279,000 B fails` (a resume fixture: a 1440 shot at both file
   limits, red), `budget: entry step images prices the half tier` (red on round 2's full-tier sum),
   `budget: entry step images charges the chapter files` (story, meta, manifest, world, en; red: a 12 KB manifest
   growth ignored), `budget: entry step images takes the largest alternative of a step`, `budget: the entry row prints
   its derivation`, (W5) `budget: a legacy step's entry counts its sprites`; `budget: first-load counts the first
   step's half-tier images` (`:911-927`, `:958-994`).
4. Guards:
   - `budget: a sheet over 2048 px fails`;
   - `budget: a sheet file over its limit fails`;
   - `budget: a room plate that is not 1080 x 2048 fails`;
   - (rev. 2, m10) `budget: a 1440 plate's file limit scales with its width`;
   - `budget: room-set counts the room's sheet` (`:870-899`).
5. (rev. 2, W6) `budget: scene-motion chunk row is pending until its root exists` and `budget: a scene-motion root
   inside the engine closure fails` (a fixture manifest; the family's importer is `src/scene/controller.ts`, its root
   `src/scene/motion/index.ts`, limit 8,000 B, `firstLine: false`; the `LazyFamily.importer` union widens,
   `budget.ts:146-154`).
6. If OQ5 is ruled: `budget: transfer limit is 12 MB`.

**Mutations:**
- M-SH3h (rev. 4: re-aimed) the certain term summed at every distance, round 3's rule (red: commit 1's lever fixture
  stays at 34.168);
- M-SH3z (rev. 4, C1) possible openers counted at their full size (red: commit 1's choice and room fixtures);
- M-SH3i: count every image of the first knot (red: commit 3);
- M-SH3j: drop the sheet term (red: room-set);
- M-SH3p (rev. 2): drop the room terms from `cur` (red: commit 1's room fixture, which then reads 26.885 and passes);
- M-SH3q (rev. 2): the entry row reads the first step only (red: commit 3's resume fixture);
- M-SH3m (rev. 2): the family skips the inside-a-closure check (red: commit 5's second test);
- M-SH3s (rev. 3, W5): knot-set rows dropped for legacy chapters (red: commit 2's first test);
- M-SH3w (rev. 3, W1): the chapter-files term dropped (red: `budget: entry step images charges the chapter files`);
- M-SH3x (rev. 3, C1): the entry row prices the full tier (red: `budget: entry step images prices the half tier`).

**Gates:** check, test, story, build (every new row MEASURED per chapter; the levers note printed; the first-line
and all-JS rows quoted base -> HEAD).

**Order:**
- After SH3a; beside SH3c (disjoint locks).
- `budget.ts`: {SH3a, GM3s} by launch, never beside -> SH3b -> GM4g -> GM7p -> GM6d2 -> SH12b
  (engine.md §12, the `budget.ts` row, as read).
- `shots/lint.ts`: SH2 -> SH3b -> SH12b.
- `STAGING-DSL.md` after SH2.
