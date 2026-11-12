### 9.5 SH4 `shot-view` (client, runtime)

**Goal:**
- §5.1-5.2: shots drawn from rigs (plate sprite, face layers, hair locks static);
- face changes by the K7 two-phase; `cut` and `fade`; the dissolve fallback;
- the runtime face index;
- (rev. 3, W7) tide's **ch4** (`lamp`, `lamp_dawn`) staged with faces in new shots (`lamp_wide`, `lamp_keeper_cu`;
  implied placeholders, so no catalog edit). ch3 stays legacy: EN's GM8d holds `story/ch3/main.ink` ("GM8d only",
  engine.md §12, as read) and moves `t008`-`t011` of the lighthouse into a new knot `lighthouse_radio` that opens with a
  `show:`; SH11 restages ch3 after GM8d.

**Carried from SH2 (RULINGS 207):** SH2's cut Q4 (SH1's carry (a), carried further): `assetOf(face)` on a shot chapter
names the face file or nothing (today `char/<c>/<x>` on a sprite stage), with this lane's runtime `imageIds`; SH2
supplies the facts (`build/shots.json` `sprites`, `shots.<s>.cast`). It goes to SH12a's cut instead if SH12a runs first.
This lane then joins `graph.ts`'s order (SH2 -> GM9p -> SH12a).

**Lock (12; rev. 3: `story/ch3/main.ink` out):**
- `client/src/scene/{shot-view,shot-view.test}.ts` (new)
- `client/src/scene/{executor,executor.test,registry,registry.test,controller}.ts`
- `client/src/app/{stage-route,stage-route.test}.ts`
- `story/shots.json`, `story/ch4/main.ink` (narrative designer: `show:` -> `face:`, casts and rests; no text change,
  so the locale tables are untouched; no other lane of either design holds ch4)
- `client/e2e/shots.spec.ts` (new)

**Commits:**
1. (rev. 2, W1) `shot-view: a room's rest framing equals cover()` (every stage of a table: 390 x 844, 412 x 915,
   360 x 800, 405 x 720, 787 x 1400; red: the module is missing), `shot-view: a 1080 plate covers the 9:16 stage by
   width`, `shot-view: a shot's overscan is 1.03 and never above 1 / k_dev`, `shot-view: the zoom range never falls
   below the overscan` (the 787 x 1400 DPR 1.5 case: no push); `shot-view: a face member sits at its plate box`.
2. Registry frames:
   - `registry: a sheet's frames die with its record`;
   - `registry: a frame of an ended record is refused`.
3. Executor:
   - `executor: a shot draws its plate and its cast's drawn faces in the bg anchor`;
   - `executor: a face change swaps only that character's groups`;
   - `executor: a cut destroys the old shot's layers`;
   - `executor: restore draws the snapshot's faces`.
4. `stage-route: a batch ensures the sheet when a face is not at rest or the shot has cut-outs`;
   `stage-route: manifestIndex knows a face from the chapter's rigs`;
   (rev. 4, W4) `stage-route: a batch ensures the face file of every visible face not at rest, never a talk file`
   (`imageIds(visual, { stage, speaker })`: the shot in effect after the cut and the persisted faces decide the ids);
   (rev. 4, m5) `stage-route: a paid chapter's batch ensures its gated face files` (a paid fixture manifest whose
   blush lives in a gated `face/...` entry; red if the batch ensures only the plate and the sheet).
5. `executor: a face state whose sheet failed shows the rest face and logs a skip`; (rev. 5, m1) `executor: a face
   change releases the previous face and talk files after the transition` (the fake registry's holder set: after a
   `face:` batch and its K7 phases, `scene:face:<c>` and `scene:talk:<c>` hold only the new expression's files; red
   on the parent of the slot rule: the previous files stay held), and `executor: a talk file is taken without being
   awaited` (a batch whose talk file never resolves still finishes).
6. The tide content commit (ch4). Rev. 6 (the fixture ledger, §10 rows F1, F5, F6): `lamp` opens on `lamp_wide` for
   a001 and the conditional a002 / a003 (`story/ch4/main.ink:9-14`) and cuts to `lamp_keeper_cu` no later than a004
   (`:15`), where the keeper's `face:` changes once; so a resume at a001 has the CU's files in its window's `need`
   (SH5b's entry e2e) and the CU shows one face change (this lane's e2e).
7. e2e (ch4 is paid: `grantChapter(request, uid, 'chapter:ch4')`, then `reachLine` through ch3 with its picks,
   `client/e2e/helpers.ts:313`, `:609`):
   - `shots: the keeper's face changes in the lamp-room shot` (the face box pixel = the expression's placeholder hue);
   - `shots: a reload restores the keeper's face`.

**Mutations:**
- M-SH4a: frames not destroyed at release (red: `registry: a sheet's frames die with its record`);
- M-SH4b: the sheet never ensured (red: the stage-route test, and the e2e first frame without the face);
- M-SH4e (rev. 4): face files never ensured (red: `stage-route: a batch ensures the face file ...` and the e2e
  `shots: the keeper's face changes in the lamp-room shot`, whose face box keeps the plate's pixel);
- M-SH4c (rev. 2): rest framing by height (round 1; red: `shot-view: a room's rest framing equals cover()` at 405 x 720);
- M-SH4d (rev. 2): zoom range without its floor (red: the 787 x 1400 case gives 0.915);
- M-SH4f (rev. 5, m1): `sweep` skips the `face:` and `talk:` slots' holders, round 4's state with no named release
  point (red: `executor: a face change releases the previous face and talk files after the transition`).

**Ruled: RULINGS 275** — Q2: the stage-route tests are M-SH4b's and M-SH4e's designated reds; the e2e under each is
reported as observed, not a designated red (the executor awaits its own takes; SH4's cut predicts M-SH4e's e2e red
and M-SH4b's green, the ensure hold being on the face file only).

**Gates:** check, test, story, build (engine row MEASURED; E +1.9 KB br, rev. 4: + face files 0.1), e2e full
(`memory.spec.ts` untouched: ch1 is still legacy).

**Order:**
- After GM6a (`scene/*`, per-player.md GM6a's order, as read at [per-player GM6a `scene-anchors`](../per-player/09a-lanes-gm6a-gm6s2.md#gm6a-scene-anchors-client)), SH3a, SH1.
- The strict `scene/*` chain runs SH1 -> SH4 -> ... (rev. 3, W7: it starts at SH1, which holds `executor.ts`; §9.14).

**Ruled since: RULINGS 274, 275, 279, 280, 282, 289, 290** — launched from `1b85605` in lane C. SH4 is the first
bundled importer of `story/shots.ts`'s decoders, so its engine term is E = 1.9 + 1.0 = 2.9 KB (RULINGS 256). The lock
grew from the plan's 12 to 17:
- one `app/game.ts` line, `imageIds`' context (Q1 (a); the plan's `speaker` argument dropped, §5.2);
- `scripts/story/graph.ts` and `graph-shot.test.ts`, for SH2's cut Q4, taken as "nothing": a face on a shot chapter
  names no knot asset (§3.1);
- one `scripts/story.ts` hunk at `:684`, `buildGraph`'s `shots` input (Q5 (a));
- `client/e2e/handover.spec.ts`, its fixture only: the close-up's gated plate `bg/lamp_keeper_cu`, which `next:ch4`
  admits on the test's path.

The critique added named pins (`registry.test.ts`'s `pixiFrames` box, M-SH4k's story-run red). Riders took SH1's cut Q5
(a sprite build that throws drops its fresh group), SH1 review M2 / M3 (a `show` governs a `face`'s timing in its
batch, STAGING-DSL §7) and RULINGS 245 Q8 (engine §6.4).

Before the merge, three lens verifiers (paid content, lifetime, gate honesty) found one gate claim that could not fail
(TM13), so fix2, test-only, pinned it with the shot paths of rebind and reacquire (RULINGS 289). Merged `768fc9d`:
- 47 new vitest names (tag SH4; 1733) and the e2e `shots: the keeper's face changes in the lamp-room shot` and
  `shots: a reload restores the keeper's face` (104);
- engine +4,428 B (the R sample 1.527), entry -15 B;
- ch4's 33 gated files (its two shots' 32 and `bgm/storm`; 49 gated files in all, ch2's 16 included) only in
  `server/content`, behind the entitled asset route;
- ch4's budget rows on the step model; budget 108 PASS, 0 FAIL, 1 PENDING.

**Re-located on `768fc9d`** (SH4's cut §1a on `1b85605`, then this tree; docs lane `docs-errata-17`, group A):
- `client/e2e/helpers.ts:313` `reachLine` -> `:329`; `:609` `grantChapter` -> `:625`.
- Commit 6's `story/ch4/main.ink:9-14` / `:15`, as built: a001 `:8`; the conditional a002 / a003 `:9-13`; the cut
  `# bg: lamp_keeper_cu` `:14`, before a004 `:15`; the keeper's `# face: keeper smile` `:31` (again at the dawn knot
  `:37-38`).

### 9.6 SH5a `shot-preload` (client, runtime: windows, warm, rooms)

**Goal:** §5.8 without the entry (rev. 2: the window admitted at the swap point and deferred `need`s retried, W7; room
props restored on a story cut, W8; restore awaiting the visible top only, W5; rev. 3: a refused `need` evicts resident
`hope`, then neighbour `room:*` holders, W2). Rev. 4: the window classes `need` / `warm` / `hope` with the registry's
**warm form** (S32, C1) and **a window per room batch** (S33, W2). The entry tier is SH5b (split for size, rev. 4).
Rev. 5: the window arrives as SH3a's `ShotWindow` from `stepWindow` (W1: imported, `story/shots.ts` is not in this
lock and needs no edit); room windows keyed `r:<room>` from the yields' world state (m7); the eviction of EN's
`room:*` holders at any step, a room event's own room last (W2); the one ordered queue with `near` (m3); step 1 keeps
`warm` (m2). The lock is unchanged.
Rev. 6 (RULINGS 138): `next:*` evictable by step 6 (c) after EN's holders and queued after `hope` (W1); the recency
order implemented in `preload()` (delete, then add) and the event room's `hope` tail through `withEventRoom` (W2); a
warm decode never evicts (m2); the three e2e tests whose content needs a restaged chapter move with their mutation
reds to SH11, and this lane proves the same rules by unit tests and one integration file on the real scheduler,
registry and `withEventRoom` (W3; §10's fixture ledger rows F2-F4). Lock 14.
Rev. 7 (critique r6):
- W1, S36: the scheduler's joins take no slot, and its entry tag ends `next:<id>` after the first window of its
  chapter joined it, so a landed handover preload is kept. `game.ts:1018`'s release is removed.
- W2: the event room is the window's own `eventRoom` class (`StageWindow`), evicted after every other family (step
  6 (d)).
- Size: lock 14, unchanged; 7 commits; ~52 named tests (7 new); 19 mutations (5 new).
- **Reconciled ([engine §30 Shots errata from reconcile](../engine/30-shots-errata.md#30-shots-errata-from-reconcile) item 12):** this lane keeps `meta?.stepShown()` after the step's view is set (`game.ts:776` on `cec347c`) and at D11's paywall (`game.ts:982` on `cec347c`), pinned by LFL's `game: a presented step tells the meta port` (`game.test.ts:3218` on `cec347c`), `game: a continue into a pending paid start asks for the meta chunk at its paywall` (`game.test.ts:3237`) and its e2e G2; a lane that edits the entry path keeps both calls.
- **Reconciled ([engine §30 Shots errata from reconcile](../engine/30-shots-errata.md#30-shots-errata-from-reconcile) item 18, R-S3):** SH1, SH5a, SH5b and SH7, which rework `present()` / `stage()`, keep a story step's visual batch applied (`scene.apply`, the snapshot move) inside the step's intent, the `withRoomProps` cut back included (`game.ts:723`, `:744`, `:789` on `3c62a86`); detector: per-player GM6d1's `game: a tap while a step's batch loads completes it and starts no step` (M-PR3c), which lands after SH7; per-player owns the text and status ([per-player §12.1 R-S3](../per-player/12-interface-requests.md#121-requests-from-this-file-status-after-enginemd-round-9-as-read-2026-11-03-reconcile-revision-1-round-14-as-read-2026-11-09-reconcile-revision-2-enginemds-reconcile-revision-1-as-read-2026-11-09-reconcile-revision-3-enginemds-reconcile-revision-2-as-read-2026-11-09)).

**Lock (14; rev. 6: + `client/src/app/window.test.ts`):**
- `client/src/app/{game,game.test}.ts` (windows per step; rev. 4: the yields host `apply` hands the room window; rev.
  6: `withEventRoom` at a story step inside a room event, `preloadNext` from the next chapter's `look`; rev. 7: the
  handover's release at `:1018` removed, the fake scene's entry-tag rule)
- `client/src/app/{stage-route,stage-route.test}.ts` (`withRoomProps`; rev. 4: `roomWindowKey`; rev. 6:
  `withEventRoom`; rev. 7: it returns a `StageWindow`)
- `client/src/app/window.test.ts` (new, rev. 6, W3: the integration tests, commit 2c)
- `client/src/scene/{preload,preload.test}.ts` (rev. 5: the ordered queue, the eviction at any step, debug stats
  `window: { pending, ids }` and `rooms`, the `room:*` tags held, read by the e2e through `__novelDebug.stats().scene`;
  rev. 6: the recency re-insert at `:113`, step 6 (c), the `next:*` class after `hope`, the warm-decode rule; rev. 7:
  `StageWindow`, steps 1b, 1c and 6 (d), the entry tag)
- `client/src/scene/{executor,executor.test}.ts` (the swap point, the `swapped` / `released` deps, `restore`'s order;
  rev. 7: a batch without a window reports no swap)
- `client/src/scene/controller.ts` (forwards `swapped` to `want`, `released` to `retry`; rev. 7: `setChapter`'s doc
  names the entry tag, `controller.ts:54-55`)
- `client/src/scene/{registry,registry.test}.ts` (rev. 4: `Priority` `'warm'`, the held form, shed, stats `warm`,
  `warmBytes`; rev. 7: `state(id)`)
- `client/src/scene/loader.ts` (rev. 4: fetch-and-hold, decode from a held Blob)
- `client/e2e/shots.spec.ts`

**Commits:**
1. `stage-route: a step's window comes from look`; `stage-route: a missing key falls back to the knot index`;
   (rev. 4, W2; rev. 5, m7: renamed, was `stage-route: a room batch's window key is its bg, or the stage's for an
   empty batch`) `stage-route: a room batch's window key is its room's; a close-up batch has none` (two rooms on one
   bg get their own keys; a batch setting a CG gets null); (rev. 6, W2; rev. 7 renamed, was `... hopes for its room
   last`) `stage-route: a story step inside a room event passes its room as eventRoom` (`withEventRoom(w,
   roomWindow)`: the room window's `need` files that `w` lists in no class, in order, as `eventRoom`; no current
   section, the room's own `r:` window or a missing key give an empty `eventRoom`; red: the function is missing).
2. Preload:
   - `preload: want admits the required set first and hoped sets under STEADY`;
   - `preload: want releases what left the window`;
   - `preload: a released in-flight fetch is aborted`;
   - (rev. 2, W7) `preload: a need refused over the cap is admitted after a release` (predicted red: the fake
     registry records no second `acquire` for the item, today's drop at `preload.ts:67-73`), `preload: a deferred need
     outside a newer window is forgotten`;
   - (rev. 3, W2) `preload: a refused need evicts resident hope and is admitted` (fake sizes of §5.9: wide 10.169,
     CU A 12.703, CU B 12.703; predicted red: CU B over-cap with the wide still held);
   - (rev. 5, W2; replaces round 4's `preload: a refused need at a yield evicts a neighbour room's holder, never the
     current room's`) `preload: a refused need evicts room holders outside the window at any step` (fake holders
     `room:hall` {bg/hall, sheet/hall} 11.262 and `room:study` 11.262, live CU A 12.703, a story window `need` {CU A,
     CU B} whose `eventRoom` holds the hall's files (rev. 6: as GameSession passes it inside the hall's event; rev. 7:
     `eventRoom`, was the `hope` tail): `room:study` (b) then `room:hall` (d) released, CU B admitted at 25.406; predicted red on the parent of the rule:
     CU B deferred, `room:hall` kept), `preload: a room window never evicts the room on stage` (the same holders under
     `r:hall`'s window: only `room:study` goes), and `preload: room holders the window hopes for are evicted last`;
   - (rev. 4, C1) `preload: warm files are held before hope and decoded in order while they fit` (fake sizes: CU A
     live, CU B and CU C warm; predicted red: `want` has no `warm`), `preload: a refused need sheds a decoded warm
     file back to its bytes`;
   - (rev. 5, m2) `preload: want keeps the held warm files of the new window` (two successive windows sharing a warm
     opener: the fake loader counts one fetch; red under round 4's step 1);
   - (rev. 5, m3) `preload: near warm files go before tag preloads, far ones after` (the fake registry's acquire order
     for `r:hall`'s window and `room:study` queued between them);
   - (rev. 6, W1; the critic's test) `preload: a refused need evicts the next chapter's holders` (fake holders: a
     visible CU B 12.703 and `next:ch2` holding the next chapter's opening wide, 10.169; a window `need` {CU B, this
     chapter's closing wide, another 10.169 MiB shot}: `next:ch2` is released and the closing wide admitted at 22.872;
     predicted red on the parent of the rule: the closing wide deferred, `next:ch2` kept);
   - (rev. 6, W1) `preload: next-chapter preloads queue after hope` (a `next:ch2` request made before a window with
     `need`, `warm` and `hope`: the fake registry's acquire order ends with `next:ch2`'s files; red under round 5's
     order: they come right after `warm[0, near)`);
   - (rev. 6, W2; the critic's test, RULINGS 138 (b)) `preload: inside a room event the event's own room is evicted
     last` (the hall -> study path as EN requests it, `controller.ts:172-177`: `room:hall`, `room:study`, `room:cellar`
     at the hall, `releasePreload('room:cellar')` at the move, then `room:study`, `room:hall`; the study event's story
     window passed with an empty `eventRoom` (rev. 7; rev. 6: **without** a `hope` tail), so the scheduler's own order decides; live 11.262 + 11.262 + a visible
     wide 10.169 = 32.693 and a `need` face file of 1.633: exactly one eviction suffices; expected `room:hall` released,
     `room:study` kept, 23.064; red under M-SH5o, today's `Set` order, which releases `room:study`);
   - (rev. 6, W2; rev. 7 renamed, was `... through the hope tail`) `preload: an onEnter event keeps its room through
     eventRoom` (tags as EN leaves them when `roomShown` returns early, `controller.ts:169`: `room:hall`, then
     `room:cellar`; live 11.262 + 11.262 + a visible CU A 12.703 = 35.227; the window's `eventRoom` holds the cellar's
     files; a `need` face file of 1.633: `room:hall` released, `room:cellar` kept, 25.598; red under M-SH5v: recency
     alone releases `room:cellar`);
   - (rev. 7, W2; the critic's test) `preload: an onEnter event whose room only the window holds keeps it`. ch1's
     shape: `room:cellar` holds nothing; the cellar's shot 11.262 and props 3.3 are live under the window's
     `eventRoom` holders alone; `room:hall` holds 11.262; a visible CU A holds 12.703; total 38.527. A `need` face file
     of 1.633 -> 40.160. Expected: `room:hall` released and the cellar kept, 28.898. Red under M-SH5t, rev. 6's order:
     the cellar released first, 25.598, `room:hall` kept;
   - (rev. 6, m2) `preload: a warm decode that does not fit evicts nothing` (`room:study` 11.262 held, the `r:hall`
     window live with its openers held, 29.140; decoding the first CU opener needs 12.226 more: refused, `room:study`
     kept, both openers still held; red under M-SH5q);
   - (rev. 7, W1) `preload: joining a record that exists takes no slot`. A fake registry with `state`; both slots busy
     with fetches. A `want` whose `need` lists five ids with live or in-flight records and one without, then a
     `preload(tag, ids)` call over three live records. Expected: all eight holders are added before each call
     returns, and the one new id is queued. Red under M-SH5u, today's pump (`preload.ts:57-76`): no holder is added
     while both slots are busy;
   - (rev. 7, W1) `preload: the first window after a chapter change joins the next chapter's files, then releases its
     tag`. `next:ch4` holds six live records; `setChapter(ch4)`; then `want` with `need` = those six. Expected: the
     fake registry's log shows six `preload:win:` acquires before `releaseHolder('next:ch4')`, no record start, and
     `next:ch4` held by nothing after; a second `want` releases nothing more. Red under M-SH5s: `next:ch4` still held
     after `want`.
2b. (rev. 4, C1) Registry and loader, the warm form:
   - `registry: a warm record keeps the file and no texture` (red: `'warm'` is not a `Priority`);
   - `registry: a visible join decodes a warm record without a fetch` (the fake loader counts fetches: 1);
   - `registry: a live record sheds to warm when only warm holders remain`;
   - `registry: a visible admission evicts warm holders of other records after preloads`;
   - `registry: a context loss revives no warm record`;
   - (rev. 7, W1) `registry: state reports live, pending, held and none` (`'pending'` only for a record in flight with
     a non-`warm` holder; red: `state is not a function`).
2c. (rev. 6, W3, RULINGS 138 (c)) Integration, `client/src/app/window.test.ts`: the real `createAssetScheduler` over
   the real `createAssetRegistry` and the real `withEventRoom`, with a fake `load` that counts fetches and decodes per
   id and resolves at once with the manifest's dimensions, manifests built in the test at §5.9's sizes, and a stage
   harness of ~30 lines that takes and releases `scene:` holders as the executor's slots and `sweep` do
   (`executor.ts:118-134`, `:292-322`), calls `want` at each swap point and `ensure` at each tap, and issues EN's
   `preload('room:<r>', ...)` / `releasePreload` calls in EN's order (`controller.ts:147-179`). Each test asserts that
   no fetch of a cut's files starts after its tap (a held file may decode):
   - `window: wide, close-up, reverse close-up, wide loads no cut at its tap` (§5.8's first sequence; red under
     M-SH5e and M-SH5a);
   - `window: a choice cut decodes from the bytes held since the choice` (choice at CU A, replies on CU B and CU C,
     the tap on C; red under M-SH5h: C's acquire decoded at once, was refused under STEADY and is fetched at the tap);
   - `window: an exchange inside a room event loads no cut at its tap` (§5.8's exchange, CU A -> CU B -> CU A -> CU B
     -> the return; red under M-SH5k: CU B deferred and fetched at its tap);
   - `window: an ending knot's cuts load none at their tap while the next chapter is held` (§5.8's ending-knot
     sequence; red under M-SH5m: the closing wide deferred and fetched at its tap);
   - `window: an onEnter event keeps its room` (rev. 7, W2: ch1's shape, §5.8's `onEnter` sequence).
     - Setup: the cellar is refused under `room:cellar` at the hall, so its files are live under the room batch, then
       under the window's `eventRoom` alone; step windows go through `withEventRoom`.
     - Asserts: the fake `load` counts one fetch per cellar file across the event and its return, and `room:hall` is
       released at the face file's `need`.
     - Red under M-SH5t: the cellar is released at the face file and re-fetched for the return. Red under M-SH5p: it
       is released at the opener's step 1 and re-fetched.
     - Round 6's version gave `room:cellar` a record and could see neither (critique r6 W2);
   - (rev. 7, W1) `window: a handover whose preload landed fetches nothing for its first window` (§5.8's handover
     sequence).
     - Setup: `preload('next:ch4', k:lamp's need, ch4)` lands; `setChapter(ch4)`; the harness's `restore` with no
       window; `ensure` of `lamp_wide`'s files; the dip's swap 400 ms later on the harness clock; `want`.
     - Asserts: one fetch per id of `next:ch4`, and `next:ch4` held by nothing after the `want`.
     - Red under M-SH5u: the CU's files beyond the slots end at the release and are fetched twice. Red under M-SH5s:
       the tag is still held.
3. (rev. 2, W7) Executor:
   - `executor: a cut reports its swap after the old shot's holders are released`;
   - `executor: a crossfade reports its swap right after the snapshot render`;
   - `executor: restore awaits the CG and not the shot under it` (W5);
   - (rev. 7, W1) `executor: a batch without a window reports no swap` (`restore(EMPTY_SNAPSHOT)`: the fake `swapped`
     dep is never called; red if every batch reports, which would end the entry tag at the handover's clear).
4. Game:
   - `game: each presented step hands its window to the scene with its batch`;
   - `game: a resume asks for the resumed line's window`;
   - `game: the first knot's later shots are preloaded before they are needed` (red: the knot-level hold,
     `game.ts:1014-1018`);
   - (rev. 2, W8) `stage-route: a cut to a room's shot appends its props from world state` and `game: a cut back to
     the room inside an event shows its props`;
   - (rev. 4, W2) `game: a room batch hands its room's window` (red on the parent: the host `apply` passes none) and
     `game: a move releases the previous room's window holders`;
   - (rev. 6, W2; rev. 7 renamed, was `... passes its room in hope`) `game: a story step inside a room event passes its
     room as eventRoom` (a world state with a section and a room at a story step; red on the parent: no `eventRoom`);
   - (rev. 7, W1) `game: a handover leaves the next chapter's tag to the scheduler`.
     - Setup: owned ch2 after ch1's ending knot.
     - Asserts: the fake scene's `calls` (`client/src/app/game.test.ts:276`) from `setChapter:ch2` to ch2's first
       line hold no `release:next:ch2`.
     - Red on the parent and under M-SH5r: `game.ts:1018` logs it right after the first `apply`.
     - The fake scene models the entry tag: it drops the tag at its first `apply` with a window, logged as
       `entry:next:ch2`, never as a `release:` call. So `chapter_change_releases` (`:994-1010`) still sees no
       `next:ch2` after ch2's first line;
   - (rev. 6, W1) `game: an ending knot preloads the next chapter's first window` (`preloadNext` asks for
     `stepWindow(next.look, 'k:' + firstKnot).need` under `next:<id>`; red on the parent: the first knot's images from
     `knotAssets`, `game.ts:1001`);
   - pin `game: knot audio is still preloaded per knot`.
5. e2e (the steady window; the entry is SH5b's; rev. 6, W3: only content that exists on the base, §10 rows F2, F3):
   - `shots: a cut never waits for its plate` (`page.route` delays every bg after the first by 1.5 s; rev. 4, W1: the
     test taps once `stats().scene.window.pending === 0`, i.e. the window's `need` is resident, at a step after the
     entry's upgrades (`previews === 0`); the cut line appears <= 300 ms after the tap). Rev. 6 (ledger F2): the cut is
     ch1's `arrival` a013 -> `manor_arrive`'s `# scene: hall` (`story/ch1/main.ink:29-36`, on main, free); the test
     first reads a013's window in Node through `stepWindow` and fails "fixture shape absent" unless `bg/hall` is in
     its `need`;
   - (rev. 4, W2; rev. 5, W2 restates the bound and the sampling point) `shots: a room move hands the window to the
     new room` (ch1's manor: hall -> study -> hall -> cellar; ledger F3). Sampled at each room window once the
     scheduler is idle (`stats().scene.window.pending === 0` and no preload in flight), for the cellar after its
     `onEnter` event returned (the e2e taps through it), never during an event. Asserts: (1) every id under a
     `preload:win:*` / `preload:warm:*` holder (`stats().scene.window.ids`) is in the current room's `r:<room>` window,
     read in Node from the manifest's `look` through `stepWindow` (the window follows the room; round 4's bound "the
     room's window + one neighbour" was wrong both ways, since EN holds as many neighbours as fit); (2)
     `stats().scene.liveBytes` <= 33,554,432 (rev. 6, m8: `SceneStats.liveBytes`, `client/src/scene/controller.ts:29`,
     the field `client/e2e/helpers.ts:36` types; round 5 wrote `bytes`); (3) `stats().scene.overCap` does not grow;
   - (rev. 6, W3, RULINGS 138 (c)) **moved to SH11** with their mutation reds (§9.12): `shots: wide, close-up, reverse
     close-up, wide never waits`, `shots: a choice cut decodes from bytes held since the choice`, `shots: an exchange
     inside a room event never waits`. Before SH11 no chapter has their shapes (ch4 has one cast member and no world,
     `story/ch4/main.ink:1-61`; ch1 is restaged only in SH11), and this lock holds no story file. Commit 2c proves the
     same rules on the real scheduler and registry meanwhile.

**Mutations:**
- M-SH5a: hope admitted before need (red: commit 2's first test; rev. 6: and `window: wide, close-up, reverse close-up,
  wide loads no cut at its tap`);
- M-SH5b (rev. 6 restated; round 2-5: "`look` ignored", ambiguous beside the knot-index fallback): `want` never called,
  no window at all (red: `game: each presented step hands its window to the scene with its batch`, and the e2e
  `shots: a cut never waits for its plate`: the hall fetches at the tap, since `hold` passes sounds only in a chapter
  with `look`, §5.8 "Audio");
- M-SH5c (rev. 2): `swapped` called at the batch start of a cut (round 1's order; red: commit 3's first test. Rev. 6
  named the four-cut e2e as its SH11 red; rev. 7 withdraws that, because the deferred `need` is re-tried at the swap's
  sweep (step 7) and lands before the e2e's bounded wait ends, §9.12);
- M-SH5d (rev. 2): `withRoomProps` skipped (red: commit 4's room tests);
- M-SH5e (rev. 3, W2): no eviction of resident hope (red: commit 2's eviction test and, rev. 6, `window: wide,
  close-up, reverse close-up, wide loads no cut at its tap`; the four-cut e2e re-applies it in SH11);
- M-SH5h (rev. 4, C1; rev. 5, m5): a warm acquire decodes at once (red: `registry: a warm record keeps the file and no
  texture` and, rev. 6, `window: a choice cut decodes from the bytes held since the choice`; the e2e signal,
  `stats().scene.warm` never reaching 2 because the second opener is refused under STEADY, is SH11's);
- M-SH5i (rev. 4, W2): the host `apply` passes no room window (red: `game: a room batch hands its room's window` and
  the room e2e's assertion (1) after the first move: the hall's warm ids stay held);
- M-SH5k (rev. 5, W2; rev. 6 restated for the `hope` tail; rev. 7 for `eventRoom`): step 6 stops before (d), so the
  event's room is never evicted (round 4's "never the current room's"; red: `preload: a refused need evicts room
  holders outside the window at any step` and `window: an exchange inside a room event loads no cut at its tap`; the
  event e2e re-applies it in SH11);
- M-SH5l (rev. 5, m2): step 1 releases the window holders outside `need ∪ hope` (red: `preload: want keeps the held
  warm files of the new window`);
- M-SH5m (rev. 6, W1): step 6 skips `next:*`, round 5's set (red: `preload: a refused need evicts the next chapter's
  holders` and `window: an ending knot's cuts load none at their tap while the next chapter is held`);
- M-SH5n (rev. 6, W1): `next:*` back in the tag queue, round 5's order (red: `preload: next-chapter preloads queue after
  hope`);
- M-SH5o (rev. 6, W2): today's `Set` insertion order, `tags.add` without the delete (red: `preload: inside a room event
  the event's own room is evicted last`);
- M-SH5p (rev. 6, W2; rev. 7 restated): `withEventRoom` returns an empty `eventRoom` (red: `stage-route: a story step
  inside a room event passes its room as eventRoom`, `game: a story step inside a room event passes its room as
  eventRoom` and `window: an onEnter event keeps its room`);
- M-SH5q (rev. 6, m2): a refused warm decode runs step 6 (red: `preload: a warm decode that does not fit evicts
  nothing`);
- M-SH5r (rev. 7, W1): GameSession's `releasePreload('next:' + ch.id)` restored at the handover (`game.ts:1018`) (red:
  `game: a handover leaves the next chapter's tag to the scheduler`);
- M-SH5s (rev. 7, W1): `want` never releases the entry tag (red: `preload: the first window after a chapter change
  joins the next chapter's files, then releases its tag` and `window: a handover whose preload landed fetches nothing
  for its first window`: `next:ch4` still held);
- M-SH5t (rev. 7, W2): rev. 6's order, `eventRoom` treated as the end of `hope`: released first in (a) and its room's
  tag ranked in (b)'s second group (red: `preload: an onEnter event whose room only the window holds keeps it` and
  `window: an onEnter event keeps its room`);
- M-SH5u (rev. 7, W1): joins through the slot pump, today's `preload.ts:57-76` (red: `preload: joining a record that
  exists takes no slot` and `window: a handover whose preload landed fetches nothing for its first window`);
- M-SH5v (rev. 7, W2): step 6 (b) ignores `eventRoom`, so recency alone ranks the event room's tag (red: `preload: an
  onEnter event keeps its room through eventRoom`).

**Gates:** check, test, build, e2e full. S-D (1c) read at the cut. **Reconciled ([engine §30 Shots errata from reconcile](../engine/30-shots-errata.md#30-shots-errata-from-reconcile) item 19):** SH5a's +1.3 ([engine §11.1 The shared ledgers](../engine/11-budgets-and-validation.md#111-the-shared-ledgers-reconcile-r1-r2-rulings-143-qo10-152-r4-153-155-design-shots-i-13)) includes the synchronous joins and `registry.state` that LHJ landed (`preload.ts:163-172`, `registry.ts:523-527`), so up to 0.1 is already in the MEASURED base; the cut quotes its measured delta against the base.

**Order:**
- After SH4 (`scene/*`) and **GM3b** (I-11: `Yields.roomFor` over `visualsOf`; if GM3b has not merged at SH5a's cut,
  STOP: the method is EN's, `yields.ts` is not in this lock).
- `game.ts`: after SH1, before SH5b.
- `registry.ts` / `registry.test.ts`, `loader.ts`: SH4 -> SH5a -> SH5b -> SH6 (the `scene/*` chain).
- (rev. 5, W1) `client/src/story/shots.ts`: SH3a merged (SH5a imports `ShotWindow`, `stepWindow`; STOP at the cut if
  SH3a's `shots: a look window decodes need, warm, near and hope` is not on the base).
- (rev. 5) STOP-verify at the cut: `worldOf(s)` (`game.ts:641`, `s.yields.world()`) carries the world state's
  `section` and `room`; if it does not, SH5a STOPs (the room id would need a `yields.ts` hunk, EN's file).
- (rev. 6) After LBI (RULINGS 137: it holds `game.ts`, `game.test.ts`) and (rev. 7) LEL (RULINGS 139 Q1:
  `game.test.ts` joined its lock); `client/e2e/shots.spec.ts`: SH4 -> SH5a -> SH5b -> SH6 -> SH10 -> SH11;
  `client/src/app/window.test.ts`: SH5a only.
- (rev. 7, W1) Rev. 6's verify item is replaced: it fails on the base (critique r6 W1). The handover's order is now
  designed (S36, §5.8 steps 1b-1c). The cut verifies only that `game.ts:1018` is still the one release of `next:<id>`
  at a handover; if not, the cut names the other caller, and commit 4 removes it too.

### 9.6b SH5b `shot-entry` (client, runtime: the half-tier entry; rev. 4 split)

**Goal:** §5.8 "Entry at the half tier" (rev. 3, C1) with rev. 4's order (W1): the entry window admitted beside the
upgrade, its `need` files as half-tier previews, each sharpened after the visible records.
- **Reconciled ([engine §30 Shots errata from reconcile](../engine/30-shots-errata.md#30-shots-errata-from-reconcile) item 12):** this lane keeps `meta?.stepShown()` after the step's view is set (`game.ts:776` on `cec347c`) and at D11's paywall (`game.ts:982` on `cec347c`), pinned by LFL's `game: a presented step tells the meta port` (`game.test.ts:3218` on `cec347c`), `game: a continue into a pending paid start asks for the meta chunk at its paywall` (`game.test.ts:3237`) and its e2e G2; a lane that edits the entry path keeps both calls.
- **Reconciled ([engine §30 Shots errata from reconcile](../engine/30-shots-errata.md#30-shots-errata-from-reconcile) item 18, R-S3):** SH1, SH5a, SH5b and SH7, which rework `present()` / `stage()`, keep a story step's visual batch applied (`scene.apply`, the snapshot move) inside the step's intent, the `withRoomProps` cut back included (`game.ts:723`, `:744`, `:789` on `3c62a86`); detector: per-player GM6d1's `game: a tap while a step's batch loads completes it and starts no step` (M-PR3c), which lands after SH7; per-player owns the text and status ([per-player §12.1 R-S3](../per-player/12-interface-requests.md#121-requests-from-this-file-status-after-enginemd-round-9-as-read-2026-11-03-reconcile-revision-1-round-14-as-read-2026-11-09-reconcile-revision-2-enginemds-reconcile-revision-1-as-read-2026-11-09-reconcile-revision-3-enginemds-reconcile-revision-2-as-read-2026-11-09)).

**Lock (9):**
- `client/src/app/{game,game.test}.ts` (the entry flag)
- `client/src/scene/{registry,registry.test}.ts` (`AcquireOptions.preview`, `upgrade(id, signal)`, stats `previews`)
- `client/src/scene/loader.ts` (`Decoded.upgrade(ref, geometry, signal)`, the in-place swap beside `revive`)
- `client/src/scene/{preload,preload.test}.ts` (`want(window, { preview })`)
- `client/src/scene/controller.ts` (runs the upgrades and the entry window's order)
- `client/e2e/shots.spec.ts`

**Commits:**
1. (rev. 3, C1) Registry and loader:
   - `registry: a preview record starts from the entry's half file` (red: `AcquireOptions` has no `preview`);
   - `registry: a preview joins a live full record as it is`;
   - `registry: an upgrade keeps the texture handle and counts the full file` (the fake loader's `upgrade`; red:
     `upgrade is not a function`);
   - `registry: an upgrade over HARD is refused and the half stays live`;
   - `registry: a session on the half tier ignores preview`.
2. (rev. 4, W1; replaces round 3's `executor: a preview batch reports its swap after the upgrades`) Order, in the
   pure scheduler: `preload: an entry window admits its need as previews at once, beside the visible upgrades` (fake
   registry; red: the round-3 order, `swapped` after every upgrade, admits nothing before they end) and `preload: an
   entry window's need previews upgrade after the visible records`. The controller only forwards `swapped` at the
   swap point and runs `registry.upgrade` for the visible records.
3. Game: (rev. 3, C1) `game: the first step after entering a chapter loads previews` (fresh start, resume and
   handover; red: no `preview` flag) and `game: a later step loads the full tier`.
4. e2e:
   - (rev. 3, C1) `shots: a resume shows the half tier first and sharpens` (`page.route` delays every full file by
     2 s; the first line is visible while `stats().scene.previews > 0`, then `previews === 0` and, rev. 6 (ledger
     F5), `stats().scene.liveBytes` has risen by **at least** the visible records' full-minus-half decoded bytes, read
     in Node from the paid manifest. Rev. 7 (m2): this is not an equality, because the window's `need` previews and
     their upgrades land between the two samples too (entry steps 3-4). Under M-SH5f the rise is at most the CU's half
     previews, ~3.19 MiB, below `lamp_wide`'s plate alone (8,847,360 - 2,211,840 = 6,635,520 B), so the bound still
     fails there. Round 3's "the stage pixel at the face box changes to the full file's value" could not pass on
     placeholder content, whose face states are flat rectangles in one hue (§4.2 step 8), equal at both tiers; the
     resume is at ch4's a001, SH4's restage);
   - (rev. 4, W1) `shots: after an entry the first cut's half files are requested beside the upgrade` (rev. 6, ledger
     F6: the resume at ch4's a001, whose window's `need` holds `lamp_keeper_cu`'s files, SH4's restage; the test first
     reads that window in Node and fails "fixture shape absent" otherwise)
     (`page.on('request')`: the first cut's `-half-` plate request starts before the visible plate's full response
     ends; then a tap once the first cut's preview is live shows the cut <= 300 ms after the tap, at the half tier,
     and it sharpens).

**Mutations:**
- M-SH5f (rev. 3, C1): the upgrade never runs (red: the resume e2e, `previews` stays 2);
- M-SH5g (rev. 3, C1): `upgrade` creates a new texture instead of swapping in place (red: `registry: an upgrade keeps
  the texture handle ...`);
- M-SH5j (rev. 4, W1): the entry window admitted after the upgrades (round 3's order; red: commit 2's first preload
  test and the request-order e2e).

**Gates:** check, test, build, e2e full.

**Order:**
- After SH5a (`game.ts`, `registry.ts`, `loader.ts`, `preload.ts`, `controller.ts`, `shots.spec.ts`) and **M3s**
  (gated halves; else a paid entry loads its full files, which is correct but not the bound the row assumes: STOP).
- `game.ts`: after SH5a, before SH7.
- STOP items at the cut: Pixi 8.22's `TextureSource.resize(w, h, resolution)` after a `resource` swap keeps
  `source.width` in canvas units (read `node_modules/pixi.js` at the cut); else the fallback of §5.8 step 3.
