## 5. THE RUNTIME

### 5.1 Shot view (SH4; `client/src/scene/shot-view.ts`, pure)

```ts
export type StageXform = { readonly x: number; readonly y: number; readonly k: number };   // plate px -> stage px
/** rev. 2 (W1): `cover(stage, {w, h})` (geom/cover.ts) times the overscan z0, the crop moved toward `focus` inside the
 *  slack; a `room` frame is `cover()` exactly (z0 = 1, centred), so it equals the hotspot and props mapping. */
export function restFraming(rig: ShotRig, stage: Size, resolution: number, half: boolean): StageXform;
/** z0 = room ? 1 : clamp(1 / kDev, 1, 1.03); kDev = cover.scale x resolution (x 2 on the half tier). */
export function overscan(rig: ShotRig, stage: Size, resolution: number, half: boolean): number;
/** Total zoom range over cover(): [z0, max(z0, min(1.30, 1 / kDev))]; equal ends = no push possible on this stage. */
export function zoomRange(rig: ShotRig, stage: Size, resolution: number, half: boolean): { min: number; max: number };
export function camFraming(rig: ShotRig, stage: Size, cam: CamState, range: { min: number; max: number }): StageXform;  // clamped inside the plate
export function faceLayers(rig: ShotRig, faces: ReadonlyMap<CharId, ExprId>): readonly LayerPlan[];    // drawn members, z order
/** Slack per side in stage px on each axis, from the actual cover axis and z0 (0 on the cover axis of a room). */
export function slack(rig: ShotRig, stage: Size, x: StageXform): { sx: number; sy: number };
```

**Display tree** (adapter in `controller.ts`, the only Pixi user):

```
stage
  world (camera: rest framing x camera move x the world part of the parallax drive)
    bg layer
      shot root = bg anchor (GM6a)
        plate (Mesh from SH8)
        back ambient (flicker, loops)
        per cast member, back to front: head node (the plateau affine, S17)
          expression layer, blink layer, talk layer, accent layer, hair locks
        figure planes (each parents its character's head node)
        back planes (depth order)
    props layer
      prop anchor (GM6a, placement) > depth node (SH8, per-frame parallax) > motion node (SH10, cue tweens) > content
    front layer (rev. 2)
      the shot's front root: front planes, front ambient (created and destroyed with the shot root)
    legacy chars layer (until SH12)
  cg layer
  fx layer
```

Rev. 2 (m9): each node has one writer. The anchor's placement is the executor's at batch time; the `depth` node is the
parallax source's (SH8), written per drawn frame; the `motion` node is SH10's `MotionCommand` tweens; labels and
sprites live in `content` (PPL I-9), so they follow all three.

**Ownership:**
- the executor owns the shot view's lifetime;
- the registry owns the plate, sheet, face and talk records (rev. 4), each one's held Blob while it is `warm` (S32),
  and their frame `Texture`s (`frames(handle, boxes)`, destroyed
  with the record; `texture-create` stays loader + registry only, `arch.test.ts:176-177`).

### 5.2 Faces, talking, listeners (SH4, SH7)

**The executor holds one face per visible face cast member:**
- `FaceView {char, rig, state, anim: CharAnim}`, with CH §6.1's `CharAnim` unchanged.
- `setExpr` takes the expression's layer and its `MotionSet` (rev. 2: own or reused rest members, §4.5). Rev. 4: the
  batch that changes an expression ensures that face file (drawn: GameSession awaits it, `game.ts:647-654`); the talk
  file is motion and never awaited: until it is live the face speaks with its mouth still, then flaps.
  **Ruled: RULINGS 275** — as built (SH4 `768fc9d`): the route is `imageIds(visual, { stage, manifest })`
  (`client/src/app/stage-route.ts:80`), its one caller `stage()` (`client/src/app/game.ts:708`, the one `game.ts` line
  admitted, Q1 (a)); the plan's `speaker` argument is dropped (it decided talk files, which are never ensured). With
  the stage before the batch and the chapter's manifest (its rigs), a shot chapter's batch that cuts or changes a face
  ensures the shot in effect after the cut with its persisted faces: the plate, the sheet by its rule and every
  visible face file not at rest, never a talk file (`shotSlots`, `client/src/scene/shot-view.ts:109`); without rigs the
  ids are the sprite stage's. The alternative, a second route rule in `game.ts`, was rejected (a second home for the
  rule, and over-ensuring persisted faces).
- (rev. 5, m1) **Face and talk files are slots of the logical stage**: `slotsOf` (`client/src/scene/executor.ts:118-134`)
  gains, per visible face cast member of the shot in effect, `face:<c>` -> `face/<s>/<c>/<x>` (no slot at rest) and
  `talk:<c>` -> `talk/<s>/<c>/<x>` (when the rig's `exprs[x].motion.talk` names that file), both under
  `scene:<slot>` holders like the bg (`:112-115`); the talk slot is `take`n without being awaited. A face change thus
  changes both slots' ids, and the existing `sweep` (`:292-322`) releases the previous files once no unfinished batch
  targets them and no retiring view shows them, i.e. after the patch (SH6) or K7's two phases (SH4). Pinned by
  `executor: a face change releases the previous face and talk files after the transition` (SH4). So a shot holds
  one face state per face whatever the number of changes: a 1440 CU stays 15.623 MiB (+ 1.633 for the next
  expression), not 15.623 + 4 x 1.633 = 22.155 after four changes (critique r4 m1, A).
- `IdleXform` now drives the warp weight fields (SH8) instead of a sprite transform.

**`talk(char | null, {forMs?})`** (CH §6.2, D19):
- GameSession calls it at the line display;
- `think` lines and narrator lines call `talk(null)`;
- the speaker flaps when it is a visible face cast member; every face that speaks in an expression has talk members
  for it (S30), so the condition is only "visible";
- every other visible face gets `heard()` (D29);
- an **off-screen speaker** flaps nothing; the visible faces get `heard()`.

**Runtime parse** (`manifestIndex`, moved to `stage-route.ts`):
- `hasChar` and `hasExpr` answer from the chapter's rigs (`faceIndex`) as well as from `char/*` sprites (until SH12);
- so a `face:` tag of a shot chapter validates against its own manifest (D14 rule, `game.ts:223-238`).

### 5.3 Animator reuse (SH7) — CH §6.1-§6.4 as designed

| Behaviour | Rule |
|---|---|
| Blink | chain per eye shape (the expression's `blink` entry) |
| Flaps | `U(80, 140)` ms, never the same mouth twice |
| Brows | own clock `browMs` 8,000 default, listener p = 1/4, speaker p = 1/3, target = `accent` or the rest brows (D29) |
| Continuous sources | breathing `sy` about the feet, sway `rot` / `dy`, the hair phase |
| Loop | the capped mode `AMBIENT_FPS {LOW 20, AVERAGE 30, HIGH 30}`, `IDLE_AFTER_MS = 60,000`, held and covered modes, the clocks `t` / `tc` (CH §6.3) |
| Covered (rev. 3, W8; changes CH §6.3's loop-wide rule, `characters.md:844-848`) | every `AmbientSource` declares `layer: 'stage' \| 'top'` (`'top'`: the CG's own drift, the only one today). `'cg'` holds the `'stage'` sources (the shot under the CG: faces, warp, ambient, decor loops) and keeps `'top'` sources live; `'panel'` (the opaque puzzle frame) holds both. Two continuous clocks: `tc` (stage: excludes idle ∪ any cover, CH's union rule) and `tcTop` (excludes idle ∪ `'panel'`), so each resumes at the phase it held. The capped draw runs while any unheld continuous source exists, so a CG on screen draws at the class cap until idle (60 s) holds it |
| Freeze | the e2e build is frozen by default (D21) |
| Reduced motion | per §5.10 |
| Loading (rev. 2, W6, S31) | the animator, warp, ambient, scene motions and the hair mesh are the lazy chunk `scene/motion/index.ts` (`MotionKit`); the controller `import()`s it once after the first `apply` resolves (CH rev. 3 O12's remedy) and hands it to the executor (`setMotion(kit)`, types only in `executor.ts`). Until it lands: faces at rest, the plate a still `Mesh` at identity, no ambient source; shots built before it get their sources when it lands. A failed import is logged and retried at the next shot build (at most 3 times per chapter); the story never waits on it. `__novelDebug.stats().scene.motion` = `'pending' | 'ready' | 'failed'` for the e2e |

### 5.4 Camera (SH6 moves, SH7 drift)

**Zoom range** (rev. 2, W1): `k_dev` = device px per source px at `cover()` = `cover(stage, plate).scale x resolution`
(x 2 on the half tier, whose texture has half the px). `z0 = clamp(1 / k_dev, 1, 1.03)` (rooms: 1), `max =
max(z0, min(1.30, 1 / k_dev))`. Examples (A, CSS viewport and DPR as stated, resolution `min(DPR, 2)`, 1080 x 2048
plate):

| Device | `cover()` scale, axis | `k_dev` | `z0` (shots) | Max push |
|---|---|---|---|---|
| iPhone 390 x 844 DPR 3 | max(0.361, 0.412) = 0.412, height | 0.824 | 1.03 | **1.21** |
| Android 412 x 915 DPR 2.625 | max(0.381, 0.447) = 0.447, height | 0.894 | 1.03 | **1.12** |
| LOW Android 360 x 800, resolution 1, half plate | max(0.333, 0.391) = 0.391, height | 0.781 | 1.03 | **1.28** |
| Telegram Desktop stage 405 x 720, DPR 1 | max(0.375, 0.352) = 0.375, **width** | 0.375 | 1.03 | **1.30** |
| Desktop stage 787 x 1400, DPR 1.5 | max(0.729, 0.684) = 0.729, width | 1.093 | 1.00 | **1.00**: no push; `push` runs as a pan to its target inside the slack |

Round 1's `min(1 / k_dev, 1.30)` gave 1 / 1.093 = 0.915 on the last row (rev. 4, m7: was misprinted 0.975), a
zoom-out that showed the stage edge (critique W1).

**Moves:**
- `push to=<char>` centres the cast member's `head` box, then clamps the view inside the plate;
- `pan` moves `x` across the slack;
- `pull` returns to rest;
- each move is a GSAP timeline on the `world` proxy (the executor stays GSAP's only importer).

**Snapshot and timing:**
- the end state is written to the snapshot at batch start (today's rule, `executor.ts:62-70`);
- a tap completes the move;
- a cut resets the camera to rest;
- `restore` applies the end state instantly.

**Drift and parallax (rev. 2, C2; one source, SH8; values E, OQ12 tunes):**
- one 2D drive `c(t) = (A_x sin(2π t_c / 11,000), A_y sin(2π t_c / 13,000 + φ))` in **CSS px**, `t_c` the loop's
  continuous clock (CH §6.3);
- an element at normalised depth `n` moves by `c(t) · (g0 + (1 - g0) · n)`: `world` takes the `g0` part, each layer
  the `(1 - g0) · n` part (the plate per vertex, planes at their declared depth, props / decor / labels at the grid
  depth of their rect centre, face and hair layers at `headDepth`);
- dialogue shots and inserts: `A = 8 x 5` CSS px, `g0 = 0.4`; rooms and views (`frame: room`, rev. 3 W9) during
  explore and in events: `A = 4 x 3` CSS px, `g0 = 0`; CGs (no grid): `g0 = 1`, `A = 8 x 5`, a `'top'` source;
- the `world` part stays inside the slack; plate border vertices clamp to the slack of their axis (0 on a room's
  cover axis), interior vertices do not, so the far content never uncovers an edge;
- held when idle, frozen or reduced; under a cover per §5.3 (rev. 3, W8: a CG holds the shot's drive and keeps its
  own); `deactivated` stops it with the loop.

| Device class (resolution) | Nearest layer, horizontal x vertical | Far layer (shots / rooms) | Slack per side at rest, shots (z0 1.03) |
|---|---|---|---|
| iPhone 390 x 844, r 2 | shots 16 x 10 device px; rooms 8 x 6 | 6.4 x 4 / 0 | 34 x 12.6 CSS px |
| Android 412 x 915, r 2 | the same | the same | 42.5 x 13.7 CSS px |
| LOW 360 x 800, r 1 | shots 8 x 5 device px; rooms 4 x 3 | 3.2 x 2 / 0 | 37 x 12 CSS px |
| Desktop 405 x 720, r 1 | shots 8 x 5; rooms 4 x 3 | 3.2 x 2 / 0 | 6 x 35.5 CSS px (the near border clamps at 6) |

Visibility (A on E): a phone's CSS px is ~0.16 mm (an iPhone's 390 CSS px span ~64 mm of glass, E) and the CSS
reference px 0.26 mm, so 8 CSS px is ~1.3-2.1 mm, ~15-24 arcmin at 30 cm; 4 CSS px ~7-12 arcmin. Relative-motion
thresholds are of the order of arcminutes (E, verify: S-D's look check judges "visible but calm" on the owner's
phones, and OQ12 tunes A). The slack column is A from the scales above: `(plate x scale x 1.03 - stage) / 2`.

### 5.5 Transitions and cuts (SH4, SH6)

| `t` | Steps | Fallback |
|---|---|---|
| `cut` | 1. ensure the drawn members (GameSession awaits `ensure`, `game.ts:647-654`). 2. In one batch frame: build the new roots, destroy the old roots' display objects, release the old shot's `scene:*` holders (plate, sheet, face and talk files; rev. 4). 3. **Swap point:** admit the step's window (§5.8) | - |
| `crossfade` to another shot (the dissolve) | 1. Reserve a transient target of stage device size, capped at 2048 per side; (rev. 5, W2) a reservation refused under HARD first evicts every preload-priority holder (`warm` included: window `hope` / `warm`, EN's `room:*`, `next:*`), as a visible admission does (`client/src/scene/registry.ts:344-351`), and retries once (changes CH O8's "evicts nothing" for preloads only; never a visible holder); the target's release calls the scheduler's `retry()`. 2. Render `world` into it once. 3. **Destroy the old roots and release the old shot's holders now** (the target holds its pixels; rev. 2, W7 and critique question 3). 4. **Swap point:** admit the window. 5. Show the target in a transition sprite above `world`, below `cg`; build the new shot live. 6. Tween the sprite's alpha 1 -> 0. 7. Destroy the target at the end, or at `complete()` | container alpha on the old root, counted `flatRefused` (CH D15); its old records are released at the tween's end, and the swap point moves there |
| `crossfade` onto the shot on stage | today's props crossfade (the take batch, `yields.ts:416`): no target, no swap | - |
| `fade` | today's dip through the fx rect (`executor.ts:527-560`); the swap point is at black, when the old shot is destroyed | - |
| no image change | the swap point is the batch start; (rev. 5, m1) a face change's previous face and talk files leave at the `sweep` after its transition (§5.2) | - |

**Context loss mid-dissolve:** the batch completes on the old stage (`rebind` contract, `executor.ts:73-78`), and the
target's destroy event drops it from the ledger.

### 5.6 Motion on baked figures (SH8; `client/src/scene/warp.ts`, pure vertex math; the `Mesh` only in `controller.ts`)

**Plate grid:** 25 x 47 vertices (cells of ~45 x 44 source px).

**Per character `c`, per frame** (rev. 2, W3): two affine maps about the feet and the neck pivot,
`F_c` = breathing (scale `sy` about the feet) ∘ sway (`rot` about the feet, `dy`) ∘ `lean_in / back` (scale about the
feet) and `H_c` = the head motion of `anim:` (`nod` translation, `shake` rotation about the neck point = the bottom
centre of `head`), each the identity at rest (CH D23).

**Per vertex `v`, per frame** (rev. 3, W3; A, ~1,175 x ~30 flops). `G` ranges over head groups (§4.2 step 5; a
group of one is a single character), `M_G` is the group's affine, `π_G` its plateau weight:

```
π_G(v)    = 1 on V_G (the union of its members' plateau vertices); smoothstep(1 - d(v, V_G) / f_G) outside; 0 beyond f_G
ω_G(v)    = π_G(v) / max(1, Σ_G' π_G'(v))                  (bands of two groups may overlap off both plateaus)
p(v)      = v + Σ_G ω_G(v) · (M_G(v) - v) + (1 - Σ_G ω_G(v)) · Σ_c φ_c(v) · (F_c(v) - v)
offset(v) = p(v) - v + par(n*(v)) ,   par(n) = (1 - g0) · n · c(t) / s       (source px; s = CSS px per source px)
n*(v)     = n_head,G on V_G, the grid depth n(v) beyond f_G, blended by ω_G in the band
M_G       = (mean over members m of F_m) ∘ (H_m of every member with a running anim:) + par(n_head,G)
```

**Weight fields:**
- `φ_c` = a smooth ellipse falloff from `body` (1 inside, cosine to 0 over 15 % of the radii): the figure motion;
- `π_G` = the plateau weight: 1 on the plateau vertices, falling to 0 over the band `f_G` (§4.2 step 5), which lies
  outside the head silhouette because the plateau covers the head mask with one cell of margin.

**Exclusive plateaus** (rev. 3, W3 a): on `V_G`, `π_G = 1` and every other group's `π` is 0 (the asset tool grouped
any two heads closer than a band, so no other band reaches `V_G`); hence `ω_G = 1` and the figure term's factor
`(1 - Σ ω)` is 0: `p(v) = M_G(v)` exactly, **whatever other figure's ellipse covers it** (an OTS foreground figure,
an embrace). Round 2's sum let character A's breathing (0.006 x 1,200 = 7.2 px) and sway (1,200 x sin 0.35° = 7.3 px)
move the plate under B's face layers (critique r2 W3, A). A hand of A drawn on B's plateau moves with B's head; it is
inside the head silhouette's margin, so that is the head it touches.

**On the plateau** `n*` is constant, so `p(v)` plus the parallax is **one affine `M_G` per frame**. A piecewise-linear
mesh reproduces an affine field exactly on every triangle whose three vertices are in `V_G`, and §4.2 step 5 builds
`V_G` so every cell touching the head mask, a face layer or a hair root is such a triangle pair.

**In the band** (rev. 3, W3 b; A on E for a close-up: head mask 560 px wide, plateau ~650 x 730 px, `f` = 140 px; the
values are E and S-D (7) judges them on S-A's art; OQ12 tunes the amplitudes):

| Motion (default) | Displacement at the plateau edge | Stretch across the band | Round 2 |
|---|---|---|---|
| `shake` ±1.2° about the neck point | 797 px radius x sin 1.2° = 16.7 px | 16.7 / 140 = 12 % | 13.8 px over 60 px = 23 % |
| `nod` +6 px | 6 px | 4.3 % | 10 % |
| breathing `sy` 0.006 about the feet (head top ~1,400 px above them) | 8.4 px | the figure term: over the ellipse falloff, not the band | - |
| sway 0.35° about the feet | 8.6 px | the same | - |
| `lean_in` 1.02 about the feet | 28 px at the head top | over the ellipse falloff (~90 px): ~31 % | - |

The skull and hair now move rigidly (they are on the plateau); the stretch sits in the neck and the background next
to the head. Levers if S-D (7) sees a drag: (1) the amplitude (OQ12; `lean_in` 1.01 halves its row); (2) for a pose
that still fails, a **head plane** (the head silhouette cut out with the plate inpainted behind it, +~15 min per
character per shot, the figure-plane path of OQ7 applied to the head) so the head moves over clean background.

**Riding layers:**
- each head node takes its group's `M_G` as its matrix (`setFromMatrix`), so its expression, blink, talk, accent and
  patch layers and its hair-lock roots move exactly with the plate under them, rotation and scale included;
- hair locks bend about their pivot with the hair phase inside the head node (CH §7);
- props, decor and labels take `par(n)` at their rect centre in the anchor's `depth` node (PPL R-A5; S13 nesting).

**The registration tests** (SH8), each for rest, breathing and sway at their peaks, every `anim:` motion (`nod`
included) at its extreme key and the parallax drive at its amplitude:
- `warp: a riding layer's corners match the warped plate within 0.25 source px` (the four corners of every face layer
  box mapped by `M_G` vs the mesh's piecewise-linear interpolation at those points), on three fixtures: one
  character; **two characters with A's ellipse over B's plateau** (an OTS); **a head group** (two plateaus within a
  band);
- `warp: every plateau vertex moves by its group's affine` (within 1e-6 px: the head silhouette is rigid);
- `warp: two heads within one band move as one group`.
Named mutations: **M-SH8b** the plateau weight dropped (the head in the ellipse falloff) -> red; **M-SH8c** face
layers ride by the translation at their centre (round 1) -> red under `shake`; **M-SH8f** (rev. 3) the figure term not
scaled by `(1 - Σ ω)` (round 2's sum) -> red on the two-character fixture (~7 px); **M-SH8g** (rev. 3) the plateau from
the face boxes only (round 2) -> red on `warp: every plateau vertex moves by its group's affine` (the hair top off the
plateau, 16.7 px under `shake`).

**`anim:` motions** are one-shot timelines on the head plateau and figure field:

| Motion | Effect |
|---|---|
| `nod` | dy +6 px and back, 400 ms |
| `shake` | rot ±1.2° x 2 |
| `lean_in` / `lean_back` | `F_c` scale 1.02 / 0.98 about the feet (the figure term and, through `M_G`, the head) |
| `sigh` | breath amplitude x3 once |
| `tremble` | 8 Hz ±1 px for `ms` |
| `hop` / `bounce` | move the figure plane |

Every motion ends at identity (CH D23).

**`fx:`** `shake` is the `world` jitter; `flash` is the fx rect alpha.

**Frozen alternatives** (rev. 3, C2: two, each with its own return condition; neither switches motion off):
- **Vertex-shader warp:** the same mesh, weights and affines, evaluated on the GPU from uniforms (per group `M_G`, per
  character `F_c` and `body`, the plateau as a vertex attribute) instead of the CPU; GLSL only (the renderer is WebGL,
  `client/src/scene/loader.ts:19-20`; verify at its cut that no WebGPU path is enabled). **Return condition:** S-D
  (3a) measures warp CPU > 4 ms per frame on the mid Android **after** the CPU levers (§8: half-rate warp updates,
  the 13 x 24 grid). Its lane is designed then; the motion stays on meanwhile at the reduced rate.
- **Per-pixel depth-displacement fragment shader** (rejected, S19: tears at depth edges). **Return condition:** S-D
  (7) sees the vertex parallax drag foreground edges visibly on S-A's art at the amplitudes of OQ12 (a look failure,
  not a CPU one).

### 5.7 Ambient (SH9; `client/src/scene/ambient.ts`, pure)

| Kind | Behaviour | Under reduced motion |
|---|---|---|
| flicker | alpha of a light member: `amp · noise(t · hz)` | half amplitude |
| loop (shot ambient, or a loop prop's anchor) | frames stepped at `fps` (<= 12) | holds frame 0 |
| particles | a pool of `count` (<= 48) sprites from one sheet member: dust drifts, rain falls, snow, embers rise; respawn inside `rect` | off |
| sway | a plane rotates about its pivot | off |

All are `AmbientSource`s added through the executor at shot build and removed at its destroy, so the remover is
always called (`stats().ambientSources` is the leak check).

**State loops are EN's decor states** (rev. 2, W10; EN §8.7 MR2 row, [engine §8.7 The contracts MR1 and MR2 build on](../engine/08c-motion-gate-and-contracts.md#87-the-contracts-mr1-and-mr2-build-on-exact): "ambient loops as state
images (a catalog loop kind, MR2's)"). A decor state image may name a **loop prop** (§2.4); `visualsOf` picks the state
as for any image (EN §6.4), and the executor gives a prop anchor whose texture has a `LoopRig` one `loop`
`AmbientSource` stepping its frames inside the anchor's `content`. A state swap replaces the source with the image, so
the hearth's fire runs from the moment the world says it is lit and never before; reduced motion holds frame 0 as for
any loop. The shot's own `ambient[]` stays for what runs in every state (the lamp's flicker, the dust). Decor keeps its
draw order from `z` (EN E-P7) and takes its parallax depth from the shot's grid at its rect centre, so a decor and the
plate under it move together (interface answer I-12). No world-schema change.
