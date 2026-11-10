### 9.7 SH6 `shot-cuts` (client, runtime)

**Goal:**
- S14 exact dissolve, S15 exact patch;
- CH D14 / D15 transient reservations, D30 ledger, D28 arch rules;
- S20 camera moves;
- (rev. 3, W7) tide's ch4 `lamp` knot restaged into a wide + a keeper CU + an insert, with a push and a dissolve
  (round 2 named ch3's lighthouse, which EN's GM8d holds).

**Lock (13):**
- `client/src/scene/{flatten,flatten.test}.ts` (new)
- `client/src/scene/{executor,executor.test,registry,registry.test,controller,shot-view,shot-view.test}.ts`
- `client/src/arch.test.ts`
- `story/shots.json`, `story/ch4/main.ink` (narrative designer; rev. 3: ch4, not ch3)
- `client/e2e/shots.spec.ts`

**Commits:**
1. `flatten: a snapshot target is the stage in device px capped at 2048`; `flatten: the ledger drops a target only on
   its destroy event`.
2. Reservations:
   - `registry: a transient reservation admits against HARD and its band`;
   - (rev. 5, W2) `registry: a reservation over HARD evicts preload holders first` (fake records: a visible 16.562,
     a visible 12.703, a preload-only 11.262 and two warm-held files; a 9.0 MiB reservation is admitted after the
     preload-only and warm holders go, the visible ones stay; predicted red: refused with nothing evicted, CH O8);
   - `registry: a refused reservation falls back` (now: still over HARD after the eviction);
   - (rev. 5, W2) `executor: a dissolve's end asks the scheduler to retry` (the `released()` dep fires when the
     target is destroyed, so needs deferred during the dissolve are re-admitted).
3. Dissolve (`t=crossfade` between shots):
   - `executor: a dissolve draws the old shot's snapshot over the new shot and drops it`;
   - `executor: a dissolve releases the old shot's records right after the snapshot render` (rev. 2, W7);
   - `executor: a tap completes a dissolve and frees its target`;
   - `executor: a refused target dissolves by container alpha and counts flatRefused`;
   - (rev. 2, W2) `executor: a crossfade onto the shot on stage fades only the props and reserves no target` (the take
     batch, `yields.ts:416`).
4. `executor: a face change patches only the union of the old and new expression layer boxes` (rev. 2, S3; the patch
   sprite rides the head node from SH8).
5. Camera:
   - `shot-view: a push never exceeds one device px per source px`;
   - `shot-view: a pan stays inside the plate`;
   - `executor: a cam move tweens the world and a tap completes it`;
   - `executor: a cut resets the camera`;
   - `executor: restore applies the camera end state`.
6. Arch:
   - `arch: render-texture only in the adapter`;
   - `arch: mesh-create only in the adapter`;
   - `arch: gpu-target forbidden everywhere`;
   - (rev. 2, W6) `arch: scene/motion is reached by import() only` (rule `scene-lazy`, group `lazy`: a value import of
     `scene/motion/**` only from inside it; `scene/controller.ts` by `import()`; `import type` anywhere). Red fixture
     `['scene/executor.ts', "import { createCharAnim } from './motion/animator.ts';"]`; allow fixtures: the
     controller's `import('./motion/index.ts')`, a type-only import from `executor.ts`. The directory is created by
     SH7; the rule is seen red on its fixture here.
7. The tide content commit.
8. e2e:
   - `shots: a dissolve leaves no target alive` (`stats().scene.targets === 0`);
   - `shots: a push frames the keeper's face` (pixel);
   - `shots: live texture bytes stay within each step's window bound across the lamp knot` (rev. 2, m5: the bound is
     the static window, <= 32 MiB by the gate; seen red by M-SH6d; rev. 3: ch4's `lamp`).

**Mutations:**
- M-SH6a: `new RenderTexture` in `executor.ts` as an arch fixture (red: commit 6);
- M-SH6b: `dropTarget` skips `destroy(true)` (red: e2e `targets === 0`);
- M-SH6c: zoom clamp removed (red: commit 5's first test);
- M-SH6d (rev. 2, m5): the executor never releases the old shot's holders at a cut (red: e2e `shots: live texture
  bytes stay within each step's window bound across the lamp knot`, which compares `stats().scene.liveBytes` (rev. 6,
  m8: `client/src/scene/controller.ts:29`; round 5 wrote `bytes`) at
  every batch end with that step's bound read in Node from the chapter's manifest `look` through `stepWindow`
  (rev. 5, W1; round 4 wrote `cur + d1 + d2 + d3`): Σ full(`need` ∪ `warm` ∪ `hope`), full = decoded + the larger
  kept file, the gate's unit, plus the dissolve target's reservation while one runs (ch4's `lamp` is a story knot
  with no section, so no `room:*` term): static >= runtime, CH's I2);
- M-SH6f (rev. 5, W2): the reservation evicts nothing (CH O8 as written; red: `registry: a reservation over HARD
  evicts preload holders first`);
- M-SH6e (rev. 2): `scene-lazy` without its `import()` exemption (red: the controller's allow fixture).

**Gates:** check, test, story, build, e2e full.

**Order:**
- After SH5b (`scene/*`) and GM1a (`arch.test.ts`).
- `arch.test.ts`: never beside GM1c / GM3m / GM3s / GM3u / GM7p / GM7g / GM8a / GM8b (EN [engine §12 Order and conflicts](../engine/12f-order-and-conflicts.md#order-and-conflicts), [engine §12 Order and conflicts](../engine/12f-order-and-conflicts.md#order-and-conflicts)).
- S-D read at the cut.

### 9.8 SH7 `shot-idle` (client, runtime)

**Goal:**
- S16: CH §6.1-6.4 for faces;
- (rev. 2, W6) the lazy motion chunk: `client/src/scene/motion/index.ts` (`MotionKit`) holding the animator; the
  controller's `import()` after the first `apply`, the executor's `setMotion(kit)`, the rest state until it lands,
  `stats().scene.motion`;
- talking with `think` and the off-screen speaker;
- `setCovered('panel')` (CH R12);
  **Reconciled ([engine §30 Shots errata from reconcile](../engine/30-shots-errata.md#30-shots-errata-from-reconcile) item 5):** SH7 implements GM3p's `YieldsHost.frameShown?(f: ShownFrame | null)` in `yieldsHost` (`game.ts`, in its lock) with one function `panelCover(f)` and one pending timer on GameSession's `clock`: every call first clears the timer; `null` calls `scene.setCovered('panel', false)` at once; a frame arms `setCovered('panel', true)` `FRAME_OPEN_MS` (300, `cues/types.ts`, GM3m) later; `dispose` clears the timer before the yields and the scene go. `present()` no longer sets the panel cover (CH R12's wiring fired at a puzzle yield's step, before the frame's chunks loaded, and never for an explore-mode frame). The timer's row: [§14 Resource lifetime](14-resource-lifetime.md#14-resource-lifetime). SH7's lock is unchanged by this item.
- R-A9's loop contract;
- (rev. 4, m3: the designed first-line lever, taken here) the executor reaches `flatten` (SH6) only through the kit:
  `executor.ts` keeps an `import type`, `motion/index.ts` re-exports `../flatten.ts`, so `flatten` (~0.8 KB br E)
  leaves the engine closure with no file move; until the kit lands a dissolve falls back to container alpha (counted
  `flatRefused`, CH D15) and a face change to K7. Round 3's "camera tweens too" is withdrawn: GSAP stays in
  `executor.ts` only (`arch.test.ts:160-165`) and the framing math is needed by `restore`.
- (The parallax drive moves to SH8 with the depth grid it needs; rev. 2.)
- **Reconciled ([engine §30 Shots errata from reconcile](../engine/30-shots-errata.md#30-shots-errata-from-reconcile) item 3):** SH7 implements `YieldsHost.sceneCues` in `yieldsHost` (`game.ts`, in its lock) and hands the `subscribe` it receives to the scene role; SH10 subscribes `'scene'` through it. The seam is GM3s's ([engine §8.6 Reduced motion, `deactivated`, e2e determinism](../engine/08c-motion-gate-and-contracts.md#86-reduced-motion-deactivated-e2e-determinism)); SH7 runs after GM3s.
- **Reconciled ([engine §30 Shots errata from reconcile](../engine/30-shots-errata.md#30-shots-errata-from-reconcile) item 12):** this lane keeps `meta?.stepShown()` after the step's view is set (`game.ts:776` on `cec347c`) and at D11's paywall (`game.ts:982` on `cec347c`), pinned by LFL's `game: a presented step tells the meta port` (`game.test.ts:3218` on `cec347c`), `game: a continue into a pending paid start asks for the meta chunk at its paywall` (`game.test.ts:3237`) and its e2e G2; a lane that edits the entry path keeps both calls.
- **Reconciled ([engine §30 Shots errata from reconcile](../engine/30-shots-errata.md#30-shots-errata-from-reconcile) item 18, R-S3):** SH1, SH5a, SH5b and SH7, which rework `present()` / `stage()`, keep a story step's visual batch applied (`scene.apply`, the snapshot move) inside the step's intent, the `withRoomProps` cut back included (`game.ts:723`, `:744`, `:789` on `3c62a86`); detector: per-player GM6d1's `game: a tap while a step's batch loads completes it and starts no step` (M-PR3c), which lands after SH7; per-player owns the text and status ([per-player §12.1 R-S3](../per-player/12-interface-requests.md#121-requests-from-this-file-status-after-enginemd-round-9-as-read-2026-11-03-reconcile-revision-1-round-14-as-read-2026-11-09-reconcile-revision-2-enginemds-reconcile-revision-1-as-read-2026-11-09-reconcile-revision-3-enginemds-reconcile-revision-2-as-read-2026-11-09)).

**Lock (13):**
- `client/src/scene/motion/{index,animator,animator.test}.ts` (new)
- `client/src/scene/render-loop.test.ts` (new)
- `client/src/scene/{render-loop,executor,executor.test,controller,shot-view}.ts`
- `client/src/app/{game,game.test}.ts`
- `client/e2e/animation.spec.ts` (new)
- `client/src/requests.test.ts` (one row: SH7's `import()` of `scene/motion/`, an unlisted start; and its `WAIT_CASES` case if a view waits on it; by launch, never beside: [engine §12 Order and conflicts](../engine/12f-order-and-conflicts.md#order-and-conflicts), the `requests.test.ts` row)

**Commits:**
1. Animator:
   - `animator: a blink runs half closed half open within its chain`;
   - `animator: flaps never repeat a mouth`;
   - `animator: a listener moves its brows within 1.5 x browMs`;
   - `animator: think keeps the mouth still`.
2. Loop:
   - `render-loop: continuous sources draw at most AMBIENT_FPS`;
   - `render-loop: idle after 60 s holds continuous time`;
   - `render-loop: a panel cover holds every source` (round 2's `covered holds every source`, now for `'panel'`);
   - (rev. 3, W8) `render-loop: a cg cover holds the stage's sources and runs the cover's own` (predicted red:
     `AmbientSource` has no `layer`) and `render-loop: each continuous clock resumes at the phase it held`;
   - `render-loop: frozen draws no ambient frame`.
3. Talking:
   - `executor: talk flaps the speaker's visible mouth and cues the listeners`;
   - `executor: an off-screen speaker cues the listeners only`.
4. (rev. 2, W6) Motion kit:
   - `executor: a shot built before the motion kit shows rest faces and gains its sources when the kit lands`;
   - `executor: a face's animator leaves with its shot` (the remover is called at a cut; `stats().ambientSources`);
   - `executor: a failed kit is retried at the next shot build, at most 3 times per chapter`;
   - (rev. 4, m3) `executor: a dissolve before the motion kit lands falls back to container alpha` (red on the parent:
     the executor calls `flatten` directly).
5. Game:
   - `game: a line's speaker talks until lineShown`;
   - `game: an instant line talks for its nominal time`;
   - `game: an opaque frame covers the stage once its entrance ends` (a fake clock: no cover at `{ id }`, covered at +300, uncovered at `null`; red on a cover at the frame write);
   - `game: a frame cleared inside its entrance never covers` (`{ id }` at 0, `null` at 150: no `setCovered(true)`, 0 pending timers; also A `null` at 100 and B `{ id }` at 150: covered first at 450) with **M-SH7f** (`panelCover`'s clear removed: red, covered at 300 and 1 pending timer);
   - `game: a disposed session leaves no pending cover` with **M-SH7g** (`dispose` leaves the timer: red, 1 pending timer);
   - `game: reduced motion reaches the scene's mount`.
6. e2e:
   - `animation: the keeper blinks in the lamp-room shot` (live; waits for `stats().scene.motion === 'ready'`; the eye
     box changes within 6 s);
   - `animation: an idle minute holds the breathing` (`page.clock`; verify it drives GSAP's ticker, CH §14);
   - pin: the frozen build's pixel samples are unchanged.

**Mutations:**
- M-SH7a: the cap ignored (red: `render-loop: continuous sources draw at most AMBIENT_FPS`);
- M-SH7b: `heard()` never sent (red: commit 3's first test);
- M-SH7c: the animator's remover not called at a cut (red: `executor: a face's animator leaves with its shot`);
- M-SH7d (rev. 2): `controller.ts` imports `./motion/index.ts` statically (red: SH6's `arch: scene/motion is reached
  by import() only` and SH3b's `scene-motion chunk (br)` row FAILs "inside the engine closure");
- M-SH7e (rev. 3, W8): covered holds every source whatever its layer (CH §6.3 as written; red: `render-loop: a cg
  cover holds the stage's sources and runs the cover's own`).

**Gates:** check, test, build (the engine, first-line and scene-motion chunk rows MEASURED: the chunk leaves PENDING
here), e2e full.
**Ruled since: RULINGS 201** (the estimate policy, [engine §11.1 The shared ledgers](../engine/11-budgets-and-validation.md#111-the-shared-ledgers-reconcile-r1-r2-rulings-143-qo10-152-r4-153-155-design-shots-i-13)) — this lane's cut books its terms at E x R: its
engine net (the loop +0.6, `flatten` -0.8) books **0** on the engine until it measures it, and `flatten` is growth on
`scene-motion` (+0.8 x R); the `scene-motion` chunk at R (6.0 x 2.031 = 12.19) is flagged against its 8.0 LIMIT, so this
cut quotes it first ([§10 Budgets and validation](10-budgets-and-validation.md#10-budgets-and-validation-summary)); no Pixi filter, Sprite mask or advanced blend mode without lever X's import-back (rule
`pixi-env`).

**Order:**
- After SH6, SH3b, GM3s (the `sceneCues` seam), GM3m (`FRAME_OPEN_MS`) and GM3p (the frame edge `frameShown`; merged before SH5a's GM3b in any case).
- `game.ts`: after SH5b, before GM6c2.
- GM6d1 after SH7 (R-A9's `addAmbient`) and after SH8.

### 9.9 SH8 `shot-motion` (client, runtime)

**Goal:** S17-S19 and §5.6: the plate warp mesh with the affine head plateau (rev. 2, W3; rev. 3: exclusive
plateaus from the head mask, head groups), hair-lock meshes, the `anim:` / `fx:` runtime, the parallax drive with its
values (rev. 2, C2), back and front planes (the `front` layer), props, decor and labels in the anchor's `depth` node
(m9); rooms and views hold `cover()` while near layers move; (rev. 3, W8) the CG drift as a `'top'` source.

**Reconciled ([engine §30 Shots errata from reconcile](../engine/30-shots-errata.md#30-shots-errata-from-reconcile) item 18, R-S1):** SH8's drive steps a **depth list** held by the executor (one entry per `depth` node with its rect centre: prop anchors, decor anchors) that a later scene lane can add entries to; GM6d1 adds one entry per bg label view (`content > label depth > label node > sprite`, `par(n)` at the label's rect centre) and removes it with the view. Per-player owns the text and status ([per-player §12.1 Requests from this file](../per-player/12-interface-requests.md#121-requests-from-this-file-status-after-enginemd-round-9-as-read-2026-11-03-reconcile-revision-1-round-14-as-read-2026-11-09-reconcile-revision-2-enginemds-reconcile-revision-1-as-read-2026-11-09-reconcile-revision-3-enginemds-reconcile-revision-2-as-read-2026-11-09)).

**Lock (14; rev. 3, m3: + `shot-view.test.ts`, `flatten.test.ts`, which commits 2 and 3 write):**
- `client/src/scene/motion/{warp,warp.test,hair-mesh,hair-mesh.test}.ts` (new; CH §7's math under `motion/`)
- `client/src/scene/motion/index.ts` (the kit gains the warp, the drive and the hair mesh)
- `client/src/scene/{controller,executor,executor.test,flatten,flatten.test,shot-view,shot-view.test}.ts`
- `client/e2e/animation.spec.ts`
- `story/ch4/main.ink` (narrative designer: one `anim:` and one `fx:`)

**Commits:**
1. Warp (rev. 2, W3; rev. 3, W3):
   - `warp: breathing scales the figure about its feet inside its field`;
   - `warp: the head plateau takes the whole figure motion wherever it sits in the ellipse`;
   - `warp: a riding layer's corners match the warped plate within 0.25 source px` (every motion of §5.6 at its
     extreme, `nod` included, breathing and sway at their peaks, the drive at its amplitude; on the one-character,
     the two-character OTS and the head-group fixtures);
   - (rev. 3) `warp: every plateau vertex moves by its group's affine`;
   - (rev. 3) `warp: two heads within one band move as one group`;
   - `warp: every motion ends at the identity`.
2. (rev. 2, C2) Drive:
   - `warp: the drive moves the nearest layer by A and the far layer by g0 · A`;
   - `warp: the drive's amplitude is the same in CSS px at resolution 1 and 2`;
   - `warp: border vertices clamp to the slack of their axis`;
   - `shot-view: the world part of the drive stays inside the slack`.
3. Mesh adapter: `flatten: a dropped mesh's buffers leave the ledger`.
4. Riding: `executor: a head node takes its character's affine`; `executor: a hair lock bends about its root and
   rides the head`.
5. Motions:
   - `executor: anim nod moves only the head plateau and returns`;
   - `executor: fx shake moves the world`;
   - `executor: reduced motion skips anim, shake and the drive`;
   - `executor: hop without a figure plane is skipped and logged`.
6. Planes, props, rooms (rev. 2, C2, m9):
   - `executor: a front plane draws above the props and leaves with its shot`;
   - `executor: a prop's depth node shifts by the grid depth at its rect centre`;
   - `executor: a room holds cover() during explore while its nearest layer moves at most 4 CSS px`.
7. e2e:
   - `animation: the plate breathes in live mode`;
   - `animation: a near prop moves against the far wall in a room` (live; two pixel samples, one on a prop, one on
     the far wall, 6 s apart: the prop's offset differs, the wall's does not);
   - (rev. 3, W8) `animation: a CG drifts while it covers the shot` (live; ch1's letter CG; two samples 6 s apart
     differ, and `stats().ambientFrames` grows while the CG is up);
   - `animation: leaving the shot leaves no mesh buffer` (`meshBuffers === 0`).

**Mutations:**
- M-SH8a: `dropMesh` without destroying the geometry (red: e2e and commit 3);
- M-SH8b: the plateau weight dropped from `w_fig` (red: commit 1's second and third tests);
- M-SH8c (rev. 2): face layers ride by the translation at their centre (round 1; red: the corner test under `shake`);
- M-SH8d (rev. 2): the drive's amplitude taken in device px (red: `warp: the drive's amplitude is the same in CSS px
  at resolution 1 and 2`);
- M-SH8e (rev. 2): rooms with `g0 = 0.4` (the far wall drifts; red: the room e2e and
  `executor: a room holds cover() during explore ...`);
- M-SH8f (rev. 3, W3): the figure term not scaled by `(1 - Σ ω)` (red: the corner test on the two-character
  fixture);
- M-SH8g (rev. 3, W3): the plateau from the face boxes only (red: `warp: every plateau vertex moves by its group's
  affine`);
- M-SH8h (rev. 3, W8): the CG drive registered as a `'stage'` source (red: `animation: a CG drifts while it covers the
  shot`).

**Gates:** check, test, story, build, e2e full (perf spec frame time MEASURED on Chromium; device numbers from S-D).

**Order:** after SH7.

### 9.10 SH9 `shot-ambient` (client, runtime; the MR2 ambient role)

**Goal:** §5.7 (rev. 2, W10: loop props as decor state images). Rev. 4 (W2 b): SH9 is the lane that gives cast-less
room shots a sheet (placeholder ambient on `lighthouse` and `lamp_room`), so it also points EN's neighbour preload at
the whole shot: `explore/controller.ts:176`'s `[bgAsset(entry.room.bg)]` becomes `shotImages(deps.manifest,
entry.room.bg)` (`client/src/story/shots.ts`, SH3a: the bg and, when the rig has one, its sheet; no face or talk file,
a room's cast is at rest when entered; rev. 5, W1: SH3a exports and tests it, `shots: shotImages lists a room's bg and
its sheet, never a face or talk file`, so SH9 imports it and its lock is unchanged). Before SH9 no cast-less room has a sheet (CH D27: nothing drawn to ensure), so
round 3's moves did not yet fetch a sheet on tap; I-16.

**Lock (10; rev. 4: + `explore/controller.ts`, `controller.test.ts`):**
- `client/src/scene/motion/{ambient,ambient.test,index}.ts` (`ambient.ts` new)
- `client/src/scene/{executor,executor.test,controller}.ts`
- `client/src/explore/{controller,controller.test}.ts` (one hunk at `:172-177`)
- `assets/catalog.json` (placeholder `ambient` on `lighthouse` and `lamp_room`; one placeholder loop prop for a ch1
  decor state, synthesized by SH3a's placeholder path; the world's decor state naming it is GM3b's form, added by the
  lane that holds `story/ch1/world.json` after GM3b, or by this lane if the orchestrator adds the file: QO8)
- `client/e2e/animation.spec.ts`

**Commits:**
1. Sources:
   - `ambient: a loop steps its frames at its fps`;
   - `ambient: a flicker stays within its amplitude`;
   - `ambient: particles respawn inside their rect`;
   - `ambient: reduced motion halves flicker and stops particles`.
2. `executor: a shot's ambient sources leave with the shot`.
3. (rev. 2, W10) `executor: a prop anchor whose image is a loop prop steps its frames`, `executor: a decor state swap
   from a loop prop to a still image removes the loop source`.
4. e2e `animation: the lamp flickers in live mode`.
5. (rev. 4, W2 b) `explore: a neighbour preload asks for the room's whole shot` (a fixture manifest whose neighbour
   room has a sheet; red on the parent: only `bg/<n>` is preloaded).

**Mutations:** M-SH9a: the remover not called (red: commit 2's test); M-SH9b (rev. 2): a state swap keeps the old
loop source (red: commit 3's second test); M-SH9c (rev. 4): the neighbour preload back to the bg only (red: commit 5).

**Gates:** check, test, build, e2e full.

**Order:** after SH8, then by launch with GM6d1, SH10, SH12, never beside (`scene/*`). Rev. 3 (W7):
`assets/catalog.json` is EN's row "GM3b -> GM8d; A(`assets/catalog.json`) by launch, never beside either" (engine.md
§12, as read): SH9 fills that A, after GM3b (already before it through SH5a) and by launch with GM8d, never beside.
Rev. 4: `explore/controller.ts`, `controller.test.ts` are EN's chain "GM1a -> GM3 (test only) -> GM3b -> GM4 -> GM8i ->
per-player GM6c4" (engine.md §12, as read): SH9 follows GM6c4, never beside any of them.

### 9.11 SH10 `scene-cues` (client; the MR1 role)

**Goal:** EN §8.4-8.7:
- every `CueKey` and control default gets a `SceneMotionId`;
- `ScenePending = never`;
- `SceneMotion.build` produces executor `MotionCommand`s on `SceneTargets = { world, bg, prop(AnchorKey),
  closeup, face(CharId) }`;
- the `move:*` zoom pushes into `via`, then dissolves (S25).

**Lock (9; rev. 2, m6: exact):**
- `client/src/scene/motion/{scene-motions,scene-motions.test,index}.ts` (`scene-motions.ts` new, in the lazy chunk)
- `client/src/cues/stage/{motions,motions.test}.ts` (GM3m's every-key gate lives in `motions.test.ts`,
  [engine GM3m `mech-cue-gate`](../engine/12c-lanes-gm3.md#gm3m-mech-cue-gate))
- `client/src/scene/{executor,executor.test,controller}.ts`
- `client/e2e/shots.spec.ts`

**Red-first:**
- `cues: no scene motion pending` (red while `ScenePending = CueKey`);
- `cues: every scene motion moves its target` with **M-I5f** seen red (EN [engine §8.5 The motion gate](../engine/08c-motion-gate-and-contracts.md#85-the-motion-gate-fails-on-a-missing-or-no-op-motion));
- `executor: a motion command tweens its target anchor and a tap completes it`;
- (rev. 2, m9) `executor: a cue tween and the parallax compose on a prop anchor` (the tween writes the `motion` node,
  the drive the `depth` node; red if one overwrites the other); mutation **M-SH10a**: the tween targets the `depth`
  node;
- e2e `shots: opening the drawer moves its prop anchor`.
- **Reconciled ([engine §30 Shots errata from reconcile](../engine/30-shots-errata.md#30-shots-errata-from-reconcile) item 15):** `prop(AnchorKey)`, `bg` and `closeup` resolve to their anchor's `motion` node, so the tweens there write only `motion` nodes (never `anchor`, the executor's, or `depth`, SH8's); the cut verifies the bg and close-up roots carry the four-node nesting I-9 rev. 2 gives the bg anchor "likewise" (the display tree, [§5.1 Shot view](05a-runtime.md#51-shot-view-sh4-clientsrcsceneshot-viewts-pure), draws it for prop anchors only) and adds it in `executor.ts` (in this lock) if SH4 did not. `world` (the camera node) and `face(CharId)` (the head node) have per-frame writers and no `motion` node: a `world` cue motion is a term of the camera composition (the camera-move term, through the executor's camera state), a `face` cue motion a term of the head's composition or a layer change, never a tween on the node. Red-first: `executor: a world and a face cue motion survive their per-frame writers` (one drawn frame at a motion's midpoint: the composed transform differs from rest) with **M-SH10b** (the motion written as a tween on the node: red, the transform reads rest).

**Gates:** check, test, build (the `scene-motion chunk (br)` row, its scene-motions ~1.0, and the `cue-stage chunk (br)` row, +0.5 CLAIM for every key's and control default's `SceneMotionId` in `cues/stage/motions.ts`, [engine §11.1 The shared ledgers](../engine/11-budgets-and-validation.md#111-the-shared-ledgers-reconcile-r1-r2-rulings-143-qo10-152-r4-153-155-design-shots-i-13)), e2e full.
**Ruled since: RULINGS 201** — its scene-motions ~1.0 and the cue-stage +0.5 are estimates booked at E x R (the
all-JS R for both rows, 2.030 at `597dded`); the cue-stage row's LIMIT is 8.5 KB with a 7.5 KB review trigger (6,108 B
MEASURED at GM3s's merge); no Pixi filter, Sprite mask or advanced blend mode without lever X's import-back (rule
`pixi-env`) ([§10 Budgets and validation](10-budgets-and-validation.md#10-budgets-and-validation-summary)).

**Order:**
- After GM3b, GM3s, GM6a, GM8i (the last `motions.ts` holder, EN [engine §12 Order and conflicts](../engine/12f-order-and-conflicts.md#order-and-conflicts)), SH7 and SH6 (EN [engine §12 Order and conflicts](../engine/12f-order-and-conflicts.md#order-and-conflicts)'s "MA1" =
  SH7).
- STOP item at the cut: the scene subscribes to `CueBus` as `scene` without a `game.ts` hunk (else `game.ts` joins
  the lock, after GM9r).
  **Reconciled ([engine §30 Shots errata from reconcile](../engine/30-shots-errata.md#30-shots-errata-from-reconcile) item 3):** SH10 subscribes `'scene'` through the `subscribe` that SH7's `YieldsHost.sceneCues` (in `yieldsHost`, `game.ts`) hands the scene role; the seam is GM3s's ([engine §8.6 Reduced motion, `deactivated`, e2e determinism](../engine/08c-motion-gate-and-contracts.md#86-reduced-motion-deactivated-e2e-determinism)).
- (rev. 3, W9) Read at the cut: the explore view takes no hotspot tap while a room batch runs (I-6's question back);
  if it does, the `move:*` motion is the dissolve alone (no camera push into `via`), so no drawn hotspot is ever off
  its box under a finger.
