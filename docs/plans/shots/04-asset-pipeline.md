## 4. THE ASSET PIPELINE (SH3a, SH3b)

### 4.1 Source layout per shot (`assets/src/shot/<shot>/`)

```
original.png          the chosen generation, full resolution
plate.png             original with every cut-out region inpainted away (hair locks, planes, figure if any)
shot.json             { "crop": [x, y, w, h], "focus": [x, y], "q": 50,
                        "layers": { "<name>": { "kind": "hair|plane|figure", "char": "<c>|null", "mask": "mask.<...>.png",
                                                "pivot": [x, y], "depth": 0..1, "front": false } },
                        "ambient": [ { "kind": "flicker", "mask": "...", "amp": 0.15, "hz": 0.7, "z": "back|front" },
                                     { "kind": "loop", "frames": "loop.<n>.*.png", "fps": 8, "at": [x, y], "z": "back|front" },
                                     { "kind": "particles", "preset": "dust|rain|snow|embers", "rect": [x,y,w,h], "count": 24 },
                                     { "kind": "sway", "layer": "<name>", "amp": 1.5 } ] }
depth.png             16-bit depth (DA3 Mono-Large or Blender Z), any size (resampled to the grid)
mask.fig.<char>.png   figure mask (SAM 3), for the weight field moments; required for every cast member (R9, rev. 3)
mask.head.<char>.png  head region (SAM 3 "head", hair included): every face diff must lie inside it (R1); it also
                      sizes the head plateau (§4.2 step 5, rev. 3); required for every face member (R9)
mask.hair.<char>.<n>.png, mask.plane.<n>.png   soft masks (2-4 px feather) of cut-outs, taken from original.png;
                      at least one hair lock per cast member, face or back view (R9, rev. 3)
-- rest states (base: plate.png) --
<char>.half.png, <char>.closed.png             rest blink
<char>.talk1.png, <char>.talk2.png             rest talk mouths, where the char speaks at rest
<char>.accent.png                              rest brow target
<char>.accent.half.png, .accent.closed.png     the rest's joint blink-under-accent states (base: the rest accent state),
                                               only when the asset tool reports touching rest blink and accent diffs (R2)
-- per needed non-rest expression x --
<char>.<x>.png                                 the expression (base: plate.png)
<char>.<x>.half.png, <char>.<x>.closed.png     its blink (base: <char>.<x>.png), only if x changes the rest blink box
<char>.<x>.talk1.png, <char>.<x>.talk2.png     its talk (base: <char>.<x>.png), only if it speaks in x and x changes the rest talk box
<char>.<x>.accent.png                          its brow target (base: <char>.<x>.png), only if x changes the rest accent box
<char>.<x>.accent.half.png, .accent.closed.png  (rev. 3, m7) the joint blink-under-accent states (base: <char>.<x>.accent.png),
                                               only when the asset tool reports touching blink and accent diffs for x (R2)
loop.<n>.<i>.png      ambient frame loops (crops, <= 256 x 256 each, <= 8 frames)
```

`"q"` (rev. 2, W5 / m10): the shot's AVIF quality, default 50 (`encode.ts:15`), floor 40, for both tiers; the lever
the `entry step images` row names first when a shot's half-tier bytes exceed its share (rev. 3: no lever of that row
touches face states or framings).

Changed by RULINGS 264, 277 (as of `768fc9d`; docs lane `docs-errata-17`, group A; the SH3c cut's Q7, D3 and D7): as
built (SH3c `5d3013e`). `crop`, `focus` and every `pivot` are in original px, inside the crop (`decodeShotSource`,
`client/scripts/assets/extract.ts:71`; its contract `:64-68`); `q` is an integer in 40..100, absent 50 (`DEFAULT_Q`,
`MIN_Q` `:40-41`). The rest's own joint states are `<c>.accent.half.png` / `<c>.accent.closed.png`, cut against the rest
accent state (`<c>[.<x>].accent.half|closed.png`, `extract.ts:835-849`); an x reusing both rest states reuses the rest's
joint. An expression id is never a face state's name (`half`, `closed`, `accent`, `talk1`, `talk2`): such an
expression is refused by name (`STATE_NAMES`, `extract.ts:359`, `:888-889`).

**Ruled: RULINGS 264** — the SH3c cut's Q3 / Q4: a `src` shot's non-empty `ambient` is refused by name
(`decodeShotSource`, `extract.ts:68`, `:109-113`), and so is a plane in a cast-less `src` shot
(`declarationProblems`, `extract.ts:608-609`; `usage.ts:90-92` lists a sheet only for a cast). Both are D14's
refusals, carried with SH3a's placeholder-ambient carry to SH9 or a small shot-assets lane before it (§9.10), which
gains the `src` side: flicker masks, ambient loop frames <= 256 x 256 and <= 8 frames, particles, sway.

**Ruled: RULINGS 267** — `q` is the plate's AVIF quality (both tiers, exactly) and the alpha files' **starting**
quality: each alpha file's full and half tier (the sheet, each face and talk file, a `src` loop atlas) is searched from
`q` up, coarse steps of 5 to the first candidate whose decoded alpha passes R6, then the four q below it; the passing
candidate with the fewest bytes ships, and reaching the ceiling 90 with no pass fails the build by name (`searchAvif`,
`client/scripts/assets/encode.ts:303`; `Q_CEILING` `:288`; `encodeRaster` `:355`). So R6 decides the alpha files'
final q, and the `entry step images` lever `q` (SH3b, `client/scripts/budget.ts:1468`) acts on a shot's plates exactly
and on its alpha files as the search's start.

**The one transform:** every full-frame file is cropped by `shot.json.crop` (integer, the plate canvas size, S11),
with no resampling. Masks and variants share the original's geometry. Rev. 3 (m6): `original.png` is the image
**after** the owner's upscale (§6.3 step 6b: Krea 2 is pretrained to 1024 px, S1 :62-63, and its depth control-LoRA
caps Raw outputs at ~1 MP, S2 :71, so a 1080 x 2048 plate is generated at ~1 MP and upscaled ~1.5x first); every
mask and variant is made on the upscaled image, so the registration rules stand unchanged.

### 4.2 Extraction (pure, `client/scripts/assets/shots.ts`)

Rev. 2 (W4) replaces round 1's group split. **Every variant has one declared base**, and every layer composed onto an
expression is cut against that expression:

| Variant | Base | Layer it yields (box = bbox of the diff vs the base, dilated 4 px) |
|---|---|---|
| `<c>.<x>.png` (non-rest expression) | the plate | the **expression layer** `x` (eyes, brows, mouth, blush together) |
| `<c>.half.png`, `<c>.closed.png` | the plate | rest blink layers `half`, `closed` |
| `<c>.talk<n>.png` | the plate | rest talk layers |
| `<c>.accent.png` | the plate | rest accent layer |
| `<c>.<x>.half.png`, `.closed.png`, `.talk<n>.png`, `.accent.png` | `<c>.<x>.png` | `x`'s own motion layers |

A changed pixel is one with any channel `|Δ| > 2/255` (PNG sources; CropAndStitch stitches unmasked pixels without a
VAE round trip, S2 [I1], so an exact pipeline has none outside its mask).

1. **Rest motion boxes** per face cast member: `E` = bbox(`half` ∪ `closed` diffs), `M` = bbox(rest talk diffs),
   `B` = bbox(`accent` diff), each dilated 4 px. A character that never speaks at rest has no `M`.
2. **Per expression `x`:** `D_x` = the changed pixels of `x` vs the plate; the expression layer = the crop of `x` over
   bbox(`D_x`) dilated 4 px.
3. **Reuse rule (exact):** for each motion kind (blink / talk / accent), if `D_x` ∩ the rest box (E / M / B) is empty,
   `x` equals the plate inside that box, so the rest layer composited over `x`'s layer gives exactly `x` in that state;
   `x` reuses it and needs no file. Otherwise `x`'s own variant is required (R4 names the lines that need it); with no
   rest `M`, every expression it speaks in needs its own talk. The art list prints both bounds (S8).
4. **Cut-out layers:** each layer's pixels = `original × mask`, trimmed. The plate already has the region inpainted.
5. **Weight fields:** for each figure mask, the moments give an ellipse `{cx, cy, rx, ry, rot}` and the feet point
   (the lowest mask row's centroid). Rev. 3 (W3) replaces round 2's face-box plateau:
   - the **head plateau** `V_c` = every grid vertex of a cell that touches the character's head mask (hair
     included), a face layer box or a hair-lock root, dilated by one cell (a cell is 45 x 44 source px at the
     25 x 47 grid on 1080 x 2048, scaled with the plate). Every cell touching the head silhouette or a face layer then
     has its four corners in `V_c`, which is what makes the affine exact there (§5.6). Written to the rig as a
     1,175-bit vertex bitmask (`plateau`, base64 196 B) plus its bbox `head` (the push target and the neck point);
   - the **band** `f_c = max(60, 0.25 x head-mask bbox width)` px (E; 140 px for a 560 px close-up head): the falloff
     of the head motion, outside the plateau, so outside the head silhouette;
   - **head groups:** two characters whose plateaus come within `max(f_a, f_b)` of each other (an embrace, a kiss, a
     whisper) are one group (transitively); the rig writes `group` per cast member. After grouping every plateau is
     disjoint from every other group's band, so exclusivity (§5.6) holds.
6. **Depth:** bilinear-sampled to 13 x 24, quantised to u8, base64 (~416 B).
7. **Packing:** shelf packing of every member into one sheet <= 2048 x 2048, even coordinates and sizes (so the half
   tier is an exact halving). Rev. 4 (W4, W3): one packing per file of §2.6 (the sheet, each face file, each talk
   file), each <= 2048 x 2048; a reused rest state is copied into the face or talk file that uses it. Every one gets
   a half file like every bg (`halfAsk`, `client/scripts/assets/manifest.ts:128-147`, gains the `sheet` / `face` /
   `talk` namespaces through `imageKind`, `client/scripts/assets/placeholder.ts:10-25`; gated halves exist from M3s on,
   `manifest.ts:124-127`), since the entry awaits half files.
7b. **Masked motion layers** (rev. 3, m7): when two motion boxes used together on one expression overlap after
   dilation (an angry brow within 8 px of the lids), both layers are cut with an alpha mask = their own diff dilated
   2 px and feathered 2 px, instead of a rectangle. Outside its diff a layer equals its base, so a feathered edge over
   the base composites identical pixels (exact). R2 then tests the dilated **diffs** for disjointness; if those still
   touch, the asset tool names the joint states `x.accent.half` / `x.accent.closed` (blink drawn on the accent state)
   for the owner, and the animator draws the joint layer whenever blink and accent coincide.
   **Ruled: RULINGS 273** — per-file masking (SH3c fix3 M1; supersedes RULINGS 264's O4, "a reused rest motion
   layer masked anywhere is masked everywhere"): a state is masked only in the files of an expression whose own R2
   overlaps it (the rest's R2 for the sheet and `talk/<rest>`, x's for `face/<s>/<c>/<x>` and `talk/<s>/<c>/<x>`),
   else a rectangle, so another expression's needs never change how a file is cut; a reused rest state is the same
   state cut in x's form, exact in either (`maskedIn`, `client/scripts/assets/extract.ts:818-830`; the cut per form
   `:923-944`). Three residual channels stay, accepted under principle 0 (no paid-only pixel; one bit of geometry or a
   mouth source each): the **shared silent / speaking file** (one `face/x`, or the sheet for the rest, serves a silent
   free use and a speaking paid use, so it is masked for the speaking one); the **plateau union** (step 5's plateau,
   head and group take every expression's boxes, a paid-only one's included); the **speech union** (whether the rest
   is spoken in any chapter decides whether a free speaking x's public talk file takes the rest's mouths or x's own;
   critique m1). Closing them needs per-tier variants of one file id (§2.6, `usage.ts`) and per-chapter plateaus: a
   question for SH6's and SH12a's cuts ([§9.7 SH6](09d-lanes-sh6-sh10.md#97-sh6-shot-cuts-client-runtime),
   [§9.13 SH12a](09e-lanes-sh11-sh12b.md#913-sh12a-sprites-out-client-the-kinds-atomic-rev-4-split-w6)).
8. **Placeholders** (no `src`; SH3a implements this form, including the optional
   `bg.<id>.placeholder.ambient: ("flicker" | "loop" | "particles")[]` that SH9 turns on in the catalog):
   - the plate is a vertical gradient in the bg hue;
   - each face cast member gets boxes at `x = (i+1)/(n+1)` of the width, `y = 0.30` of the height:
     E 400 x 130, B 400 x 80, M 180 x 110 at close-up scale, an expression box 440 x 460 around them, all scaled by
     `frame`; a placeholder expression changes every box, so every derived state is synthesized (the upper bound);
   - each needed state is a flat rectangle in the expression's vocabulary hue;
   - blink / talk / accent are lighter or darker tints;
   - there is one hair-lock rectangle per cast member, face or back view (rev. 3, W4), and a synthesized figure mask
     (an ellipse) and, for a face member, a head mask (the expression box dilated 60 px), so R9 and the plateau rule
     run on placeholders too;
   - the ambient entries listed in `bg.<id>.placeholder.ambient` (SH9) are synthesized too;
   - (rev. 4, m2) a depth grid `n(y) = clamp((y / h - 0.35) / 0.65, 0, 1)` over the 13 x 24 lattice: the upper 35 % is
     a far wall at 0, the floor rises to 1 at the bottom edge. A placeholder room's far wall then stands still under
     the room drive (`g0 = 0`) and a prop low in the room moves, which SH8's e2e `animation: a near prop moves against
     the far wall in a room` samples; a flat grid would move nothing (n = 0) or everything (n = 1).
     **Ruled: RULINGS 254** — the grid is sampled at the lattice's vertices, `y = i/(rows-1)·h` (SH3a; pinned in
     `client/scripts/assets/shots.test.ts:468`).

### 4.3 Checks (gate errors unless marked; each seen red by its named mutation in SH3a, §9)

| # | Check | Catches | Mutation |
|---|---|---|---|
| R1 | **registration** (rev. 2, W4): every variant equals its **declared base** (§4.2 table) outside its character's head mask dilated 8 px: zero changed pixels (`|Δ| > 2/255`) there | a whole-frame relight, re-encode or VAE round trip (not CropAndStitch): any of them changes pixels outside the head | M-SH3a: R1 tests only inside the head mask (red: `assets: a relit expression fails registration`, a fixture relit by +12/255 everywhere) |
| R2 | the motion boxes used together on one expression (its own or the reused rest E / M / B) are **pairwise disjoint** after dilation; rev. 3 (m7): where boxes overlap, the layers are masked (§4.2 step 7b) and R2 tests the dilated diffs; diffs that still touch require the joint states, named with their line IDs (an error until drawn, like R4) | a blink that would swap the mouth; an angry brow drawn back to rest by a blink | M-SH3b: skip the overlap test; M-SH3t (rev. 3): masked layers cut as rectangles (red: `assets: overlapping blink and accent boxes are cut as masked layers`) |
| R3 | **clipping** (rev. 2): a layer box clipped by the head mask's dilated bbox or by the plate edge loses no changed pixel | a diff cut off at a box edge: a visible rectangle | M-SH3c: R3 compares the box before clipping (red: `assets: a diff clipped at the plate edge fails`) |
| R4 | every **needed** state of build/shots.json exists as a source file; a derived state is needed exactly when §4.2's reuse rule says so; the message names the line IDs | missing art; a surprised or laughing expression whose lids leave the rest blink box now asks for its own blink instead of failing (W4 b) | M-SH3n: the reuse rule always reuses (red: `assets: an expression that changes the eyes needs its own blink`) |
| R5 | plate dims: h = 2048, w even ∈ [1080, 1440]; a `room` plate exactly 1080 x 2048 | upscaled or odd plates | M-SH3k: accept w = 1081 |
| R6 | the **encoded** sheet keeps every member's alpha edge within 8/255 of the source (decode after encode) | AVIF alpha artifacts on feathered edges | M-SH3e: clamp alpha to 0 / 255 before encode |
| R7 | a cut-out mask region is inpainted in the plate (the plate differs from the original inside the mask by a mean > 8/255) | a lock or plane that would reveal baked pixels when it moves | M-SH3l: plate = original |
| R8 | (rev. 2, W) a room prop rect overlapping a cast member's figure mask in that room shot | a prop drawn over a character it stands behind (props draw above the shot root) | - (a warning) |
| R9 | (rev. 3, W4) every cast member has `mask.fig` and at least one hair lock; every `face` member has `mask.head`; the message names the shot and the character | a shot with still hair or no breathing because a mask step was skipped (Q53: L1 + L2 on every character) | M-SH3r: R9 skipped (red: `assets: a cast member without a hair lock fails` and `assets: a back-view member without a figure mask fails`) |

Fixtures per case (rev. 2, W4): a relit expression (R1 red), an expression whose eyes leave E with and without its
own blink (R4 red / green), a non-rest talk on its own base (green; round 1 failed it), a diff at the plate edge (R3
red). Rev. 3: a back-view member with no hair lock and one with no figure mask (R9 red); an angry expression whose
brow box overlaps its blink box (masked layers, green) and one whose diffs touch (joint states asked, red until
supplied). Each check is seen red on its fixture **and** by its named mutation, so none is vacuous for its declared
case.

The **opaque base under face layers** holds by construction (the plate is opaque; CH D4's P4b becomes trivial). The
"face under hair" ordering is fixed by z (hair locks above that character's face layers) and needs no check.

Changed by RULINGS 264, 277 (as of `768fc9d`; docs lane `docs-errata-17`, group A; the SH3c cut's Q7, D6 and D9): as
built. **R2** splits by pair: touching blink x accent diffs ask for the joint states by file and line IDs (an error
until drawn), while a talk x blink or talk x accent pair has no joint form and fails outright, naming the pair and the
lines (`client/scripts/assets/extract.ts:854`, `:870`). **R6** compares every px of the decoded file against its
source (`alphaWorst` `:458`, the tolerance `:452`). **R8** reads each room's prop rects from `story/<ch>/world.json`
(`roomPropRects` `:560`; the tool's world read, `client/scripts/assets.ts:252`), a warning as above.

**Ruled: RULINGS 273** — the opaque base is now checked, not assumed (SH3c fix3 F1): `plate.png` or `original.png`
with alpha below 255 at any px inside the crop is refused by name before any variant loads, one line per file
(`extractShot`, `client/scripts/assets/extract.ts:670-680`). Only px inside the crop reach a file, so transparency
outside the crop is legal when every source (`original.png`, `plate.png` and every variant) shares it; otherwise R1
refuses it, since a variant equal to the plate there differs from it in alpha (critique W1).

### 4.4 Encoding, half tier, file limits

- **Encoding:** AVIF q50 effort 4 and WebP q80 (`encode.ts:14-16`) for plates; sheets the same with alpha (`sharp`'s
  AVIF alpha quality is not separately settable — verify; R6 is the guard).
  **Ruled: RULINGS 267** — confirmed: sharp 0.35.5 exposes no separate AVIF alpha quality, and at the shot's q AVIF
  alpha missed R6 in every kind, so each alpha file's tiers are q-searched (§4.1). Frozen with return conditions:
  **WebP for the alpha kinds**, and **a separate AVIF alpha quality** (when sharp / libvips expose it, or when the
  sheet's search costs more than x1.2 on S-A's real art).
  **Ruled: RULINGS 273** — two encoding rules for `src` files (SH3c fix3): every **gated** `src` raster carries its id
  as EXIF ImageDescription (+281 B AVIF / +250 B WebP per gated file, the same px and q, Orientation 1; public bytes
  unchanged), so a gated file's bytes are never a public file's whatever its px (`CodecOptions` `mark`,
  `client/scripts/assets/encode.ts:209-228`; set for the paid tier, `client/scripts/assets.ts:552`); and a `src`
  **plate ships without an alpha band** in either tier (`opaque`, `encode.ts:227`; -281 / -253 B AVIF per plate), since
  §4.3 refuses a plate that is not opaque.
- **Half tier:** plate 540 x 1024 and the sheet at half (M3c's rule); the LOW perf class loads half files for the
  session (`layout.ts:72-82`), and (rev. 3, C1) every class loads the entry step's half files first (S23). Half
  bytes are E at **0.375 of the full AVIF** (a quarter of the pixels at ~1.5x the bytes per pixel; the measured
  placeholder halves say nothing about real art, S4 :18); S-A measures the ratio.

| File | AVIF | WebP | Dims | Status |
|---|---|---|---|---|
| plate (`bg`) | <= 300,000 x w / 1080 B (rev. 2, m10: 400,000 at 1440) | <= 450,000 x w / 1080 B (600,000 at 1440) | h 2048, w 1080-1440 | the existing PHOTO guard (`budget.ts:102`, `:128`), scaled by width |
| sheet | <= 200,000 B | <= 300,000 B | <= 2048 per side | new outlier guard (rev. 4: no expression in it; E: a close-up sheet ~49 / 76 KB, §5.9) |
| face file (rev. 4) | <= 120,000 B | <= 180,000 B | <= 2048 per side | new outlier guard, one expression per file (E: a CU face file ~44 / 68 KB) |
| talk file (rev. 4) | <= 30,000 B | <= 45,000 B | <= 2048 per side | new outlier guard (E: a CU talk file ~5.5 / 8.5 KB) |
| loop frame | inside the sheet | - | <= 256 x 256, <= 8 frames | new |
| loop prop atlas (`prop/<id>` with `loop`) | <= 200,000 B | <= 300,000 B | <= 2048 per side; frames <= 512 x 512, <= 12 | new (W10) |

Aggregate rows bind (CH D9's lesson): `step-window`, `entry step images`, `first-load`, `transfer`. Rev. 4 (W4): no
file guard counts expressions (one per face file), so the number of expressions a shot shows is bound by no file
limit and by no memory row (§2.6); it costs art hours (§6.5) and download bytes (~44 KB AVIF per CU face file).
Rev. 3 (C1): the entry row prices the **half tier**, so at the medians every shot type passes with margin (rev. 4: a
1440 close-up ~147 KB + chapter files <= ~79 KB = ~226 KB of 279 KB, A, §5.11); it can fail only for a shot whose
files sit far above the medians in a chapter whose files sit at their row limits. Its levers, in order: `shot.json` `q`
for that shot (both tiers); the chapter's own files (a long story JSON split into two chapters). No lever removes a
face state, a close-up or a framing.

### 4.5 Manifest additions (`client/src/story/shots.ts`, types; SH3a)

```ts
export type Frame = 'wide' | 'medium' | 'close' | 'ots' | 'two' | 'insert' | 'room';
export type Box = readonly [x: number, y: number, w: number, h: number];          // plate px
export type Member = { readonly file: AssetId; readonly frame: Box; readonly at: Box;   // rev. 4: its sheet, face or talk file; frame: that file's px
  readonly masked?: true };                                                    // rev. 3 (m7): alpha = the dilated diff, not a rectangle
// rev. 2 (W4): one expression layer per non-rest expression, motion layers cut against their own base
export type MotionSet = { readonly blink: { half: Member; closed: Member };   // exactly one source each (own or rest)
  readonly talk: readonly Member[];                                            // [] where the char never speaks in this expr
  readonly accent: Member;
  readonly joint?: { half: Member; closed: Member } };                         // rev. 3 (m7): blink drawn on the accent state
export type FaceRig = { readonly rest: ExprId;
  readonly exprs: Readonly<Record<ExprId, { layer: Member | null; motion: MotionSet }>>;   // layer null = the rest expr
  readonly head: Box };                                                        // the plateau's bbox: push target, neck point
export type CastRig = { readonly view: 'face' | 'back'; readonly face: FaceRig | null;
  readonly body: { cx: number; cy: number; rx: number; ry: number; rot: number; feet: readonly [number, number] };
  readonly headDepth: number;                                                  // rev. 2 (W3): mean n over the plateau, u8 / 255
  readonly plateau: string;                                                    // rev. 3 (W3): base64 bitmask over the 25 x 47 vertices
  readonly plateauCoarse: string;                                              // rev. 3 (C2): the same over 13 x 24, the S-D fallback lattice
  readonly band: number;                                                       // rev. 3: the head-motion falloff, plate px
  readonly group: number;                                                      // rev. 3: head group index (shared affine)
  readonly figure: Member | null; readonly hair: readonly { member: Member; pivot: readonly [number, number] }[] };  // hair: >= 1 (R9)
export type AmbientRig =
  | { kind: 'flicker'; member: Member; amp: number; hz: number; z: 'back' | 'front' }
  | { kind: 'loop'; frames: readonly Member[]; fps: number; z: 'back' | 'front' }
  | { kind: 'particles'; preset: 'dust' | 'rain' | 'snow' | 'embers'; sprite: Member; rect: Box; count: number }
  | { kind: 'sway'; plane: number; amp: number };
export type ShotRig = { readonly w: number; readonly h: number; readonly frame: Frame; readonly focus: readonly [number, number];
  readonly cast: readonly (CastRig & { char: CharId })[];                       // back to front
  readonly planes: readonly { member: Member; depth: number; pivot: readonly [number, number]; front: boolean }[];
  readonly ambient: readonly AmbientRig[]; readonly depth: string };          // base64 13 x 24 u8
/** rev. 2 (W10): a loop prop's frames inside its own atlas `prop/<id>`, keyed by that prop id. */
export type LoopRig = { readonly frames: readonly Box[]; readonly fps: number };
/** rev. 5 (W1): what GameSession hands the scene with a batch, the one source of the window type (`scene/preload.ts`
 *  imports it as a type). The asset tool folds build/shots.json's WindowRefs (§3.6) into it: need = cur ∪ certain (at
 *  any distance: the runtime asks early, the gate charges at distance 1, §3.4), warm = possible in look order,
 *  hope = d2 then d3. `certainDist` and the certain / possible split stay build-only. */
export type ShotWindow = { readonly need: readonly AssetId[]; readonly warm: readonly AssetId[];
  readonly near: number;                                                       // rev. 5 (m3): warm[0, near) fetched before tag preloads (EN's `room:*`), warm[near..) after
  readonly hope: readonly AssetId[] };
export type LookIndex = { readonly images: readonly AssetId[];                  // table; entries index into it
  readonly windows: Readonly<Record<string, readonly [need: readonly number[], warm: readonly number[], near: number, hope: readonly number[]]>> };  // keys: StepKey | `r:<RoomId>`
export function decodeShotRigs(raw: unknown): Result<ReadonlyMap<BgId, ShotRig>, string[]>;
export function decodeLoops(raw: unknown): Result<ReadonlyMap<PropId, LoopRig>, string[]>;       // rev. 2 (W10)
export function decodeLook(raw: unknown): Result<LookIndex, string[]>;       // refuses an index outside `images`, near > warm.length
export function stepWindow(look: LookIndex, key: string): ShotWindow | null;  // rev. 5 (W1): was { cur, d1, d2, d3 }
/** rev. 5 (W1; I-16): a room's whole shot for EN's neighbour preload: its bg and, when the rig has one, its sheet; never a
 *  face or talk file (a room is entered at rest). SH3a exports and tests it; SH9 imports it. */
export function shotImages(manifest: AssetManifest, bg: BgId): readonly AssetId[];
export function faceIndex(rigs: ReadonlyMap<BgId, ShotRig>): { hasChar(c: string): boolean; hasExpr(c: string, e: string): boolean };
```

`decodeAssetManifest` (`client/src/story/catalog.ts`, exactKeys) admits the optional top-level `shots`, `look` and
(rev. 2) `loops` as opaque values; only `story/shots.ts` decodes them (the CH D26 pattern: the entry gains no
decoder). The server probes only `assets.<id>` file URLs and its probes have no `deny_unknown_fields`
(`server/src/content.rs:357-375`, critique "Positive"), so the third key changes nothing there.

**Size** (A on E):
- a close-up rig ~1.5 KB raw (+ ~0.2 KB per character for the plateau bitmask, rev. 3); 20 shots ~34 KB raw,
  ~9-11 KB br (bitmasks are mostly zero bits);
- `look` ~30 B raw per step, 225 steps ~6.8 KB raw, ~1.5 KB br (rev. 4: + `possible` lists and the `r:` room keys,
  ~+1 KB br; rev. 5: the same lists as `[need, warm, near, hope]`, no distance, so no size change);
- (rev. 4) ~55 more asset entries per chapter for the face and talk files, ~+4.5 KB gzip (§2.6);
- both count in `first-load` (`budget.ts:984`) and (rev. 3, W1) in the `entry step images` row's chapter-files term,
  because the manifest is fetched beside the story before the first line (`client/src/story/chapters.ts:210-216`).
