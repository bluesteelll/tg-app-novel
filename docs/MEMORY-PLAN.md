# Architecture: texture memory beyond per-knot streaming

Date 2026-11-02. Trunk at design time: `main` = `f53755b`, re-checked against `a9e991c`; code line citations are as
of those commits, and lanes re-locate them. Design record (absolute paths):
`D:/tmp/novel-orch/design/memory/proposal.md` (this body, with the patch history "Revision 2" to "Revision 5") and the
critiques `D:/tmp/novel-orch/design/memory/critique_r1.md` to `critique_r5.md` (round 5 APPROVED).
Inputs: research `D:/tmp/novel-orch/design/memory/research_R1-compressed-textures.md` (cited "MR1"),
`D:/tmp/novel-orch/design/memory/research_R2-size-tiers-trim.md` ("MR2"),
`D:/tmp/novel-orch/design/memory/research_R3-layered-sprites.md` ("MR3"); earlier research
`D:/tmp/novel-orch/design/research_R1.md` ("R1"), `D:/tmp/novel-orch/design/research_R3.md` ("R3"). This plan extends
[PROTOTYPE-PLAN.md](PROTOTYPE-PLAN.md) ("PP"), [PUZZLES-PLAN.md](PUZZLES-PLAN.md) ("PZ"),
[STORIES-PLAN.md](STORIES-PLAN.md) ("SP") and [META-PLAN.md](META-PLAN.md) ("META"). Every PP place it changes is
marked "Changed by MEMORY-PLAN" there, and the lane cut lives in PP "Implementation plan — THE LANE CUT", as with
META-PLAN; section 11 here holds its sketches.
Revision 2 answers `design/memory/critique_r1.md` (W1-W4 resolved, O1-O10 applied, one own finding R2-0). Revision 3
answers `design/memory/critique_r2.md` (W5-W7 resolved, O1-O9 applied, the critique's open questions 1-2 answered, one
own finding R3-0). Revision 4 answers `design/memory/critique_r3.md` (W1-W2 resolved, O1-O5 applied, the critique's
open questions 1-2 answered, one own finding R4-0). Revision 5 answers `design/memory/critique_r4.md` (W1-W2 resolved
by one identity rule, O1-O4 applied, the critique's open questions 1-2 answered, one own finding R5-0). The text below
is the revised body; the sections "Revision 2" to "Revision 5" of the design record are the patches (removed text
quoted, added text, the sections each change depends on).
Labels: MEASURED (source + date), CLAIMED (vendor/blog), DOCUMENTED (spec/source code), ARITHMETIC (computed here),
verify: (not established). Adopted 2026-11-02 (RULINGS 78) through lane docs-errata-3, as a PP revision (RULINGS 65).

## 0. Decision table

| Lever | Busiest knot (gate, today 30.4 / 32 MiB) | 150 MB steady total (model, today 138.6 MiB, R2-0) | Download | Platforms | Decision | When |
|---|---|---|---|---|---|---|
| **B. Trim transparent margins** (char, prop) at build time, even-sided | 30.4 -> 24.3-27.3 (placeholders); 22.1-26.1 (real-art scenarios) | unchanged at the caps; real residency at the busiest knot -5.2 to -10.1 MiB (2 shown sprites x CPU+GPU + 1 preload x CPU) | ~0 | all | **ADOPT** - lane M1 | first client slot after L15, before LMI (LMI's gate gains M1) |
| **A. Drop the decoded CPU copy after upload**, keep the fetched Blob for context-loss revive | + kept file bytes (placeholders <= 0.1 MiB; <= 2.2 MiB per 5-image knot at the file limits) | 138.6 -> 106.6; crossfade transient 170.6 -> 122.6 (now under 150 MB) | 0 | all; GL renderers only (the WebGPU / canvas fallback keeps today's path) | **ADOPT** - lane M2 | after LMI (D2's gate gains M2) |
| **C. Half tier on Android LOW phones** (the 2 x 2 average of the full file, same canvas and trim rect; a character gets a half only on the canonical 768 x 1536 canvas; selected only where no backdrop, CG or character half file is drawn above its stored px: stage <= 540 x 984 device px) | LOW phones only: 30.4 -> 7.6 (6.1-6.8 with B); LOW tablets and other devices unchanged | LOW planned set <= ~9.6 MiB at the file limits (10.15 bounds the 5-image busiest knot; any knot: LOW <= full per entry, so <= 32) | LOW phones download the half files only | Android (UA `performance_class`) + stage size | **ADOPT** (engineering decision, critique W4) - lanes M3c (client) then M3s (server slot: paid half files) | M3c after M2; M3s after M3c, L9 and D2 |
| **F. LOW render resolution 1** (already designed, not wired: no caller passes the class yet, `controller.ts:265` re-clamps with `'HIGH'`) | - | LOW: framebuffers 12 -> ~3 MiB | 0 | Android LOW | **FIX inside L15** (carry, not a lane; L15's lock + `controller.ts` for the `mount` signature; its red at DPR 2; into L15's brief directly). Recorded: F went to L15 through its brief (L15 spec item 3, RULINGS 76) and is in L15's running cut; section 14 item 7's helpers line goes into L15's resume note (RULINGS 78) | L15 |
| **D. Layered sprites** (body + trimmed face parts) | with B: 23.5; an expression-heavy knot 39.4 (FAIL today) -> 24.7 | small | smaller per extra expression (unmeasured) | all | **DEFER**: only if owner Q-M1 = layered art | design round + 2 lanes with the real art |
| **E. GPU-compressed textures (KTX2/Basis)** | 30.4 -> 7.6 (10.1 if a mip chain is added for minification quality) | large | no measured KTX2-vs-AVIF comparison (MR1 :208); vs WebP (Defold 2021, MEASURED): ETC1S 2.28 MB vs WebP 2.30-3.76 MB, UASTC 1.3-2.5x WebP; McCurdy (CLAIMED): UASTC 1-2x JPEG/ETC1S | BC7 Windows; ASTC/ETC2 phones | **REJECT now, FREEZE** with return conditions (section 4.E) | not before D |
| Caps 32 / 48 MiB | - | - | - | - | **unchanged** by M1-M3; a raise to 48 / 64 is decided only after M2 is measured on devices | after M2 measurement |

Order: L15 (with F; its lock gains `controller.ts`) -> M1 -> LMI -> M2 -> M3c -> M3s (server slot, after L9 and D2).
LMI's gate gains M1; D2's gate gains M2. D and E are not scheduled. Locks: M1 13 (14 only if L15 leaves the e2e helpers
out of `client/e2e/helpers.ts`, section 14 item 7), M2 14, M3c 15, M3s 13 files.

## 1. Goal

Keep principle 4's targets (steady memory < 150 MB = 143.05 MiB; textures <= 2048 px; budgets enforced by a build
gate) with real art, while giving authors room at the per-knot gate (`budget/knot-set` <= 32 MiB), which today has
1.6 MiB of headroom in four demo knots with placeholder art. Correctness targets: K5's caps stay a runtime invariant;
the knot-set row stays a static gate that bounds the runtime; principle 0 holds for every new file and byte.

## 2. Current state in numbers

**Where 30.4 MiB comes from** (ARITHMETIC; registry rule `decodedBytes = w x h x 4`, `manifest.ts:295`,
`catalog.ts:798`). The busiest knots (carry.md:584: four knots at 30.4 of 32 MiB) hold one full-screen image on stage
plus one preloaded (bg or CG, `next(K)`), two characters on stage plus one new expression:

| Item | px | bytes | MiB |
|---|---|---|---|
| 2 full-screen images (on stage + successor) | 1080 x 2048 | 2 x 8,847,360 | 16.875 |
| 3 sprites (2 on stage + 1 new expression) | 768 x 1536 | 3 x 4,718,592 | 13.500 |
| **Knot set** (`budget.ts:701-727`: own `assets(K) U assets(next(K))` + `carriedBound`) | | 31,850,496 | **30.375** |
| Headroom to `LIMITS.knotSet` = 32 MiB (`budget.ts:112`) | | 1,703,936 | **1.625** |

One more sprite (4.5), a third character, or a CG preload (8.4) fails the gate. A 512 x 512 prop (1.0) still fits.
Placeholder sprites are full-canvas silhouettes (`placeholder.ts:58-69`): body x 154..614, head top y ~145, label
glyphs wider than the body for long ids.

**What is actually resident at that knot** (repo facts): the loader keeps each `ImageBitmap` as the texture's
resource (`loader.ts:17-21, :41`), so the CPU copy equals the counted bytes (30.4). Pixi uploads lazily on first bind
(GlTextureSystem: `return source._gpuData[...] || this._initSource(source)`, pixi v8.22.0, read 2026-11-02), so the GPU
holds only what was drawn: 1 bg + 2 sprites = 17.4. Texture-related total ~= 47.8 MiB. Pixi's GC never unloads our
sources: `TextureSource.defaultOptions.autoGarbageCollect = false` and the GCSystem returns early when
`!resource.autoGarbageCollect` (DOCUMENTED, pixi v8.22.0 `TextureSource.ts`, `GCSystem.ts`, read 2026-11-02).

**The 150 MB total** (PP:2120-2132 plus the two rows PP:64-70 adds, the gated limits; 150 MB = 143.05 MiB):

| Row | MiB |
|---|---|
| Textures (GPU) = steady cap | 32 |
| Bitmaps (CPU) = live textures | 32 |
| Framebuffers at resolution 2 | ~12 |
| JS heap (e2e `heap under budget`) | 45.8 |
| Audio (SFX cache + 2 BGM files) | 13.7 |
| Home cover bitmaps, worst case (STORIES-PLAN; PP:66-67, STORIES-PLAN:1085) | 2.6 |
| Meta UI, DOM (META-PLAN; PP:68-70, META-PLAN:1817) | 0.5 |
| **Steady total** | **138.6 = 145.3 MB** (headroom 4.45) |
| **Crossfade transient at the 48 MiB hard cap** (2 x 48 + 12 + 45.8 + 13.7 + 2.6 + 0.5) | **170.6 = 178.9 MB, over 150 MB** while a transition runs (PP:2131 accepts it) |

Textures + their CPU copies are 64 of 138.6 MiB (46 %); each MiB of texture saved today saves 2 MiB of the total.

**Known gaps found while reading** (repo facts):
- `controller.ts:265` re-clamps the caller's value with `renderResolution(o.resolution, 'HIGH')`, so LOW -> resolution 1
  (PP:2042, `layout.ts:17-23`) holds only if the caller passes `renderResolution(dpr, perfClass)` (critique O9). No
  caller exists yet (L15 writes it), and `TelegramClient.perfClass` (`webapp.ts:249`) has no path into the scene
  (MR2:42-44). Unwired, framebuffers on LOW stay ~12 MiB instead of ~3.
- `LIMITS.knotSet`, `LIMITS.roomSet` (`budget.ts:112-113`) and `STEADY_CAP_BYTES` (`registry.ts:9`) are three literals
  for one invariant.
- The next chapter's first knot (`next:*`) is outside the knot-set gate, bounded at runtime only (carry.md:82).
- Exploration rooms sit at 29.3 MiB with two neighbours (PZ X13 :614-618).

## 3. Context and constraints

- Principles: 0 (paid art gated: every new file goes through `FetchAsset`, `loader.ts:1-3`, and the server's gated
  index `content.rs:627-660`), 4 (the budget model), 5 (context check on `activated`, no Service Worker), 7 (scene never
  reads story state; the DSL is the authoring seam), 8 (no new lines).
- Rulings/decisions that must survive: K5 holder registry and caps (PP:197-225, RULINGS 35 eviction of every
  preload-priority holder); K9 knot index and `budget/knot-set` with the carried stage (PP:259-289, :2249); RULINGS 35
  "device px <= source px" for characters (`layout.ts:31-36`); context-loss restore without re-downloading paid
  `no-store` art (PP:2115-2118; controller D13 rebuild `controller.ts:215-241`); AVIF/WebP variant fixed per session
  (`registry.ts:82`, `:168`).
- Platforms: iOS WKWebView (no `deviceMemory`, no perf class, GPU string masked - MR2 section 1); Android WebView (UA
  `performance_class`, user-overridable - R1 section 6); Telegram Desktop Windows = WebView2, macOS = WKWebView (MR1
  "Platform facts"); Telegram Web = the browser.
- Invariants: (I1) the registry never holds more than its caps count; (I2) the static knot-set value >= what the
  runtime counts for the same knot; (I3) one creator and one destroy point per texture, bitmap and kept Blob; (I4)
  layout of every visual identical whatever the file's crop or tier; (I5) no paid byte at a public or new URL; (I6) the
  half tier is selected only where, at selection time, no backdrop, CG or character half file would be drawn above its
  stored px (RULINGS 35 Q7 "device px <= source px", in stored px; the full tier keeps today's rules). Every character
  half is on the canonical 1536-px canvas that the predicate's character term assumes (a decoder rule, 4.C; critique_r3
  W1); a character on a smaller canvas has no half and loads its full file on either tier. It is a selection
  rule: after a one-way demotion, live half records may be drawn up-sampled until released, and a prop follows its
  hotspot rect on either tier (quality only; 4.C); (I7) a frame binds only textures uploaded to the renderer that
  draws it (M2).

## 4. Levers

### 4.A Drop the decoded CPU copy after upload (keep the encoded Blob)

**What.** The loader fetches (unchanged), decodes, **uploads at once** through an injected `upload(source)`, then
`bitmap.close()`. It keeps the fetched `Blob` (encoded file, never given a URL). The `upload` contract (critique W1, O3):
- it targets **the renderer that is current when it is called**. The controller's implementation reads `core.app` inside
  each call and never captures a renderer: the D13 rebuild replaces `c.app` (`controller.ts:235`), while the loader is
  built once at mount (`controller.ts:282-285`);
- it is **GL only**: `renderer.texture.initSource(source)` (public in GlTextureSystem v8.22.0: "Initializes a texture
  source, if it has already been initialized nothing will happen"; DOCUMENTED, read 2026-11-02) when `'gl' in renderer`
  and the context is not lost, the test `isLost` already makes (`controller.ts:201-204`). Pixi 8.22's
  `autoDetectRenderer` tries webgl, then webgpu, then canvas, and GpuTextureSystem also has a public `initSource`
  (DOCUMENTED, v8.22.0, read 2026-11-02): a WebGPU or canvas renderer gets no upload, so its bitmap stays open (today's
  path);
- it returns the **GPU generation** it uploaded under, or `null`. The controller's generation starts at 1 and
  increments on `webglcontextrestored` and when a rebuilt Application is installed.

A live record is then `resident` (uploaded under a generation, bitmap closed) or `kept` (bitmap open: `upload` returned
`null`). `registry.revive(gen)` runs on `webglcontextrestored` and inside the D13 rebuild **before its first frame**.
It brings every live record not yet uploaded under `gen` to it: `kept` -> upload, close; `resident` under an older
generation -> re-decode the Blob, `source.resource = bitmap` (a plain public field in v8.22.0), upload, close.
- Order: records with a visible holder first, then preload-only records, **one at a time** (the transient is one
  bitmap, <= 8.44 MiB).
- Frames are suspended from `webglcontextlost`, and from the rebuild's start, until the visible pass of a revive
  started after the last loss is done (the revive flow, sections 6 and 8; critique_r4 O2).
- An `acquire` that joins a record not yet revived waits for it, and that record moves to the front.
- A failed re-decode ends the record at once (section 8 "Revive failure"; critique_r2 O5): the record leaves the
  registry, its texture is destroyed and its Blob dropped, and every waiting `acquire` gets a `decode` error. The
  executor's `reacquire()` then takes every view and hold entry bound to that record off the stage at once, and loads
  those slots again through the normal path, once per ended record. The record's identity is its `TextureHandle`, and
  no sprite is ever made from an ended record's handle (section 8 "Identity rule"; critique_r3 O5, critique_r4 W1,
  W2). A re-decode that has not settled by `REVIVE_DEADLINE_MS` (3000; counted from the start of the visible pass for visible
  records, from its own start for a background record) fails the same way, so frames are never suspended past the
  deadline. 3 s is 6 x the 500 ms visible-revive threshold of section 12; the device protocol raises it to 3 x the
  slowest measured visible revive if that is larger.
- `deactivated` aborts a running revive: no record fails by abort, records stay stale, frames stay suspended.
  `activated` starts a new revive under the current generation when the context is not lost (section 9).
- **Why.** After a restore Pixi re-creates GL textures lazily from `source.resource` (GlTextureSystem `contextChange`
  -> `removeAll(true)`; lazy `_initSource`), which is the only reason PP kept the bitmap (PP:2115-2118). A Blob gives
  the same "no re-download of `no-store` paid art" property at ~3 % of the bytes (300 KB AVIF vs 8.44 MiB decoded).
  GC cannot silently re-upload from a closed bitmap: `autoGarbageCollect` is false by default (above); the loader
  passes it explicitly so a future default change cannot flip it.
- **Upload at decode, not at first show.** Total bytes are equal. The `texImage2D` of an 8.4 MiB texture moves off the
  first frame of the transition that shows it (the frame the player watches) onto the moment the preload decodes, which
  may fall inside another animation (critique O4). Neither is free. The device protocol (section 12) times the upload of
  one 1080 x 2048 texture on a LOW Android. Above 33 ms (two 60 Hz frames), a follow-up defers preload uploads to
  frames with no running timeline (`executor.stats().activeTimelines === 0`).
- **Alternatives rejected.** Re-fetch on context loss (paid art is `no-store`: a re-download per loss, PP:2116; needs a
  live token). Keep bitmaps only for not-yet-shown preloads (same total; it moves the upload back onto the
  transition's first frame and adds a third record state beside `resident` and `kept`). Close nothing (today: the
  170.6 MiB transient).
- **Memory.** PP model at the caps: CPU row 32 -> 0 (a bitmap lives from decode to upload in one task). Kept Blobs are
  counted inside the caps (section 6) at their real size: `Decoded.keptBytes = blob.size`. The admission reserves
  `ref.bytes`; a host that rewrites images (another size) is counted as it is and reported in `stats().keptMismatch`,
  never refused as a decode error, so it cannot black the stage (critique O8; the build's own hosting serves the files
  byte for byte, so production expects 0). Steady total 138.6 -> **106.6 MiB**; hard-cap transient 170.6 ->
  **122.6 MiB** (48 + 12 + 45.8 + 13.7 + 2.6 + 0.5), under 150 MB. Real residency at the busiest knot: 47.8 -> ~30.5 MiB
  (GPU 30.4 + Blobs).
- **Download.** 0.
- **Risk.** The revive path is new correctness surface: a frame drawn between restore and revive would bind a closed
  bitmap (verify per browser: WebGL with a detached ImageBitmap -> INVALID_VALUE or an exception; the guard makes it
  unreachable). verify: no Pixi 8.22 path reads `resource.width` of a live `ImageSource` after its first upload other
  than `update()`/re-upload (a closed bitmap reports 0 x 0).
- **The rebuild branch gets its first gate (W1).** `context loss recovers` (PP:2332) uses `forceContextLoss()`, which
  Pixi restores itself, so no test entered `controller.ts:243-257`. M2 adds the e2e `scene: an unrestored context loss
  rebuilds the stage` (section 11). Its hook calls `WEBGL_lose_context.loseContext()` directly. Neither side restores
  that loss:
  - Pixi 8.22: `handleContextLost` calls `preventDefault()` and schedules `restoreContext()` only if
    `_contextLossForced`, which only `forceContextLoss()` sets (GlContextSystem.ts at v8.22.0, DOCUMENTED, read
    2026-11-02);
  - the browser: the extension says "The context will remain in the lost state according to the WebGL specification
    until restoreContext() is called" (registry.khronos.org WEBGL_lose_context, read 2026-11-02).

  So `activated` reaches the rebuild after `CONTEXT_GRACE_MS`. The extension exists in the e2e browser:
  `forceContextLoss()` calls the same one (`this.extensions.loseContext?.loseContext()`).
- **Platform caveats.** Preloads now occupy GPU memory instead of CPU memory; where WebGL runs in a separate GPU process
  (verify: WebKit GPU-process WebGL on iOS 16.4-18), the GPU-side share grows by the preload bytes (13 MiB at the
  busiest knot) while the total falls. No separate, lower per-process GPU limit was found (critique_r2 open question
  2). A WebKit engineer states "WebKit assigns the cost GPU process memory for a tab to the tab itself" (bugs.webkit.org
  256703, comment 7, 2023-05-18), and an Apple engineer states that the WKWebView limit "is not a set number. It depends
  on things like total device RAM, current system load" (developer.apple.com/forums/thread/133449, 2020; both read
  2026-11-02; statements, not measurements). So the move is expected to be neutral against the kill limit, and the
  protocol (section 12) records both processes. A non-GL renderer (Pixi's WebGPU or canvas fallback when WebGL init fails; WebGPU
  has an `initSource` too, critique O3) gets `null` from `upload` by contract: the loader keeps the bitmap (today's
  behaviour).
- **Revive latency (critique O4).** Today the first frame after a restore re-uploads at once from the kept bitmaps.
  With M2 the stage appears after the visible pass: 3 AVIF decodes at the busiest knot (1 bg + 2 sprites; the 2
  preload-only records follow in the background). So the player sees the stage later after a loss, not identically.
- **Measure on devices before raising any cap** (not before adopting M2, which is never worse in total):
  - process memory with M2 off/on at the busiest knot, on a LOW Android and an iPhone at the iOS 16.4 floor;
  - the visible revive after a hard loss (threshold 500 ms on the LOW Android; above it, a follow-up keeps the bitmaps
    of visible records, priced in the protocol report);
  - the upload time above;
  - context-loss frequency on iOS after backgrounding (section 9).

### 4.B Trim transparent margins (char, prop), build time

**What.** After the 2048-px clamp (`encode.ts:12-15`: `fit: 'inside'`, never enlarged; R3-0), the encoder of a
transparent kind (char, prop) computes the alpha bounding box itself (`raw()` RGBA, any alpha > 0) and widens it by
**2 px** (clamped to the canvas). It then widens the box to an **even width and height**: one more column or row on the
far side, or on the near side where the far side is the canvas edge. Then it `extract()`s the box. The asset tool
refuses a char or prop whose canvas has an odd side (an input error, exit 1), so an even box always fits. Even sides
make the half tier an exact halving of the stored file (4.C; critique_r2 W5). Every side of the box not at the canvas
edge keeps >= 2 transparent px.
The manifest entry keeps `w`, `h`, `decodedBytes = w x h x 4` of the **stored** pixels and gains an optional
`trim = { canvasW, canvasH, x, y }`. The loader builds `new Texture({ source, orig: (0, 0, canvasW, canvasH), trim:
(x, y, w, h) })`; `TextureHandle.w/h` report the canvas. bg, cg, cover are never trimmed (opaque; covers are DOM).
- **Why.** Pixi 8.22 lays out a trimmed texture exactly like the untrimmed canvas: `Sprite` width/anchor use
  `texture.orig`, the quad uses `trim` via `visualBounds` -> `updateQuadBounds` (MR2 section 4, sources at tag v8.22.0
  [22][27][28][29]; DOCUMENTED). Ren'Py does the same crop at load by default (MR3 [E1]). The gate and the registry
  already count `decodedBytes`, so they count trimmed bytes with no code change (MR2:204).
- **Own bbox scan, not `sharp.trim()`.** sharp's trim mixes a colour pass against the top-left pixel with an alpha pass
  at threshold 10 and returns negative offsets (MR2 section 4 [5][6][7]); a scan for alpha > 0 keeps every visible
  pixel, is exact and unit-testable. Cost: one 4.5 MiB raw buffer per sprite at build time.
- **2 px margin.** With `clamp-to-edge` and no mipmaps (MR3 [P1][P2]), bilinear sampling inside the quad reaches at
  most 0.5 texel past the trim rect; a transparent border makes the trimmed render equal the untrimmed one. 2 px covers
  sub-pixel placement. Cost ~2 x (w + h) x 2 x 4 B ~= 30 KB decoded per sprite (w 466, h 1394; critique O1). The even
  widening adds at most one column and one row (<= (w + h) x 4 B ~= 7.4 KB).
- **Clamp first, then trim.** Offsets are in canvas px and every expression of a character shares one transform,
  so swaps stay aligned (MR3 rendering concern 7). The asset tool refuses a character whose expressions have different
  canvases (an input error, exit 1).
- **Layout.** `charPlacement` keeps RULINGS 35's rule on the canvas height (`layout.ts:34-35`): trimming does not
  resample, so canvas px are the art's native px and the rule's meaning is unchanged. Without this the 1394-px trimmed
  height would shrink characters where the rule binds (e.g. 0.78 x 956 CSS x 2 = 1491 device px > 1394 on a 16 Pro Max,
  MR2 table).
- **Memory (ARITHMETIC).**
  - Placeholders: stored height 1394 (head top y 145, minus the margin, even-widened: rows 142-1535). Stored width 466
    (body 154..614 + margin, even) to <= 652: the labels `char/stranger/neutral` and `serious` are 21 characters at
    0.5-0.56 em of a 55 px font, 578-647 px, + margin, even (critique_r2 O1). That is 2.48-3.47 MiB per sprite (-23 to
    -45 %). Busiest knot 30.4 -> **24.3-27.3 MiB** (headroom 4.7-7.7). The lane's budget output replaces this estimate
    with the exact rows.
  - Real art (MR2 scenarios, figure 70/55/40 % of the canvas width, 97 % height): 3.06 / 2.40 / 1.75 MiB per sprite;
    busiest knot 26.1 / 24.1 / 22.1 MiB.
  - Props: the placeholder disc has `r = round(0.47 x 512) = 241` plus an 8-px stroke (`placeholder.ts:72-75`), 490 px
    across, 494 px with the margin: 93 % of 512^2, a ~7 % saving (critique O1). Included because it is the same code
    path.
- **Download.** Transparent margins already compress to almost nothing in AVIF: expected ~0 (MR2:202-203, INFERENCE;
  the lane quotes the transfer rows before/after).
- **Risk.** Low: renderer-level math documented at 8.22.0; a placement bug is visible and caught by an e2e pixel sample.
  verify: the alpha quality sharp's AVIF encoder uses at q50. Codec ringing that leaves faint alpha in the 2-px margin
  is drawn on both the trimmed and the untrimmed quad; only ringing beyond the margin is cut. M1's e2e samples beside the
  body cover the visible case.
- **Platform caveats.** None per WebView (premultiply on upload stays `loader.ts:41`).
- **Measure.** Nothing device-specific; one visual check of sprite edges in Telegram on an iPhone and an Android during
  the post-L15 browser verification (RESUME "Next" item 6).

### 4.C Half tier on Android LOW phones

**What.** Every bg, cg and prop, and every char on the canonical 768 x 1536 canvas, gets a second file pair at exactly
0.5 x per side of its **stored** file (bg 540 x 1024; a 466 x 1394 trimmed placeholder sprite gives 233 x 697). A char
on a smaller canvas, which DIMS allows (`budget.ts:165`, `exact: false`), gets no half and loads its full file on either
tier (the character canvas rule below; critique_r3 W1).

**Geometry rule (critique_r2 W5).** The half file is the **2 x 2 premultiplied average** of the full file's stored
pixels. The asset tool computes it on the raw RGBA buffer the bbox scan already holds. The half has **no trim of its
own**: it takes the entry's canvas and trim rect. M1 stores even sides, so the halving is exact:
- `half.w x 2 = w`, `half.h x 2 = h` and `half.decodedBytes = decodedBytes / 4`. The decoder checks all three.
- Every half pixel averages four stored pixels, so nothing outside the full box can appear. The >= 2 transparent px on
  each side not at the canvas edge (4.B) halve to a 1-px border with alpha 0, so clamp-to-edge sampling at the quad edge
  reads alpha 0 on both tiers.
- Offsets stay the full trim's integers in canvas px, whatever their parity. The half's texel grid is the full box's
  2 x 2 blocks, not the canvas's.

The half `ImageSource` gets `resolution: 0.5`, so `source.width = pixelWidth / resolution` equals the full stored width
(MR2 section 2, v8.22.0 [21][22]). `orig` (the canvas) and `trim` (the full rect) are passed exactly as on the full
tier, and the M3c e2e samples the same pixels on both tiers.

The opaque kinds use the same average. If the tester's screenshot check judges the half bg too soft, bg and cg switch
to sharp's default resize at w/2 x h/2 with no contract change: their sides are even and they are untrimmed.

**Character canvas rule (critique_r3 W1).** `charPlacement` draws a character's canvas at `min(0.78 x H, c / r)` CSS px
(`layout.ts:34-35`), where c is the canvas height the handle reports; that is `min(0.78 x H x r, c)` device px. Its half
stores c / 2 px per canvas height, so the half is drawn above its stored px iff `0.78 x H x r > c / 2`. The predicate's
character term below takes c = `CHAR_HALF_CANVAS_H` = 1536. That is exact for every half file, because:
- the decoder admits `half` on a char entry only when the entry's canvas height (`trim.canvasH`, else `h`) is
  `CHAR_HALF_CANVAS_H`. 1536 is DIMS's char maximum (`budget.ts:165`), so the rule reads "canvas height >= 1536";
- the asset tool asks the encoder for a char's half only there, and `planAssets` decodes every manifest it plans
  (`manifest.ts:314-317`), so a slip fails the build;
- one constant, exported by `client/src/story/catalog.ts`, serves the decoder and `halfFits`.

A char on a smaller canvas loads its full file on either tier, and the full file is never drawn above its stored px
(RULINGS 35 caps the drawn height at c). The critique's 600 x 1200 canvas on the LOW rows of the table below is drawn at
624 / 643 / 714 device px from 1200 stored px per canvas height (0.52-0.60 x), where its half would have up-sampled
1.04-1.19 x. Its LOW count is its full count, so per entry LOW <= full still holds (I2, section 7).

Alternatives rejected:
- A per-entry rule at runtime (the registry picks a char's half where 2 x 0.78 x H x r <= c). It adds a half only for
  canvases 1248-1534 px tall on the smallest LOW phone (2 x 0.78 x 800 = 1248 at 360 x 800, r = 1). It moves a
  stage-dependent rule into the registry, which is stage-blind today (`registry.ts:1-4`), and makes demotion per entry.
- A build-wide bound (the build's smallest char canvas) passed to `tierFor`. The tier is fixed at mount
  (`controller.ts:282-285`), before any manifest, and one small canvas would turn the half tier off for every image of
  the session.
- DIMS `char` exact 768 x 1536. Correct too, but it fails the gate on art that is valid today (PP:2246 "sprites <=
  768x1536") to protect a LOW-only tier. Kept as guidance instead: D2's story-authoring guide asks for the canonical
  canvas (section 13). A smaller canvas also changes a character's size relative to a canonical one between devices. At
  c = 1024 both are drawn at 0.78 x H on a LOW phone (0.78 x H x r = 624-714 <= 1024). On a 16 Pro Max (0.78 x 956 x 2
  = 1491) the smaller one is drawn at 1024 / 1491 = 69 % of the canonical one's height.

The tier is chosen at mount, like the AVIF/WebP variant, by perf class **and stage size** (critique W2):
- `half` iff `perfClass === 'LOW'` and `halfFits(bound, resolution)`. `bound` is the largest stage the session can
  reach, the larger per side of:
  - the portrait stage of the screen: H = the screen's long side, W = min(short side, 9/16 x H) (the 9:16 column,
    PP:1497-1499);
  - the host at mount.
- `halfFits(stage, r)` holds when no backdrop, CG or character half file is drawn above its stored px:
  - backdrops and CGs share one cover transform (`geom/cover.ts:25-28`). They need
    `cover(stage, ROOM_SOURCE).scale x r <= 0.5`, i.e. W x r <= 540 and H x r <= 1024;
  - characters need `CHAR_HEIGHT x H x r <= CHAR_HALF_CANVAS_H / 2 = 768`, i.e. H x r <= 984. Every char half is on
    that canvas (the character canvas rule above; critique_r3 W1);
  - props are outside the predicate (critique_r2 O7). A prop is stretched to its hotspot rect (`layout.ts:39-41`; PZ
    X11 :560), and no lint ties the rect to the prop's px (PZ :1125, :1721). Under the bg term, a half prop is drawn
    above its stored px only where its rect is larger than its canvas in canvas px. A full prop on the same device is
    drawn above its px only where the rect is larger than 2 x its canvas. Quality only; a rect lint belongs to the world
    lints, not to this design.
- **One-way demotion.** On each resize the controller re-tests `halfFits` on the new host. Once it is false, the
  registry's tier is `full` for every record started later; live half records stay until released. Layout does not
  depend on the tier (I4), so a mixed stage differs only in sharpness.
- **Why this predicate.** It is RULINGS 35 Q7 ("device px <= source px") in **stored** px (I6). With `resolution: 0.5`
  the handle reports the canvas, so `charPlacement` sees `src.h = 1536` (`layout.ts:34-35`) for every char that has a
  half (the character canvas rule). The round-1 rule (perf
  class alone) breaks on a LOW tablet at 800 x 1280 CSS (critique W2, arithmetic re-checked), where the stage is
  720 x 1280 at resolution 1:
  - the bg is drawn at 720 x 1365 from 540 x 1024 (1.33 x);
  - a character is drawn at 998 px from 768 (1.30 x).

  Under the predicate, `CHAR_HEIGHT x H x r <= 768 < 1536`, so `charPlacement` returns `0.78 x H`, the same as on the
  full tier.
- **Where it holds** (ARITHMETIC; resolution 1 via F; the first three CSS screens are rows of MR2's table, read here as
  LOW screens):

  | Screen | bg scale | Character px | Tier |
  |---|---|---|---|
  | 360 x 800 | 0.39 | 624 | half |
  | 384 x 824 | 0.40 | 643 | half |
  | 412 x 915 | 0.45 | 714 | half |
  | 480 x 1067 | 0.52 | - | full |
  | any tablet | - | - | full |

  Every other device has no perf class or not LOW, so it gets the full tier. There a 1024 tier would up-sample
  1.39-1.87 x (MR2 table), a quality loss with no signal to avoid it. Where the half tier holds, it also reduces
  minification aliasing without mipmaps (MR2:129).
- **The screen bound.** CSSOM View gives every `screen` dimension in CSS px, as the "Web-exposed screen area". A UA may
  report that area as the viewport (drafts.csswg.org/cssom-view sections 2.1, 2.3, read 2026-11-02). Three rules cover
  this:
  - a UA that reports less is covered by the host term and the one-way demotion;
  - a value that is not finite or not positive counts as an unbounded screen, so the tier is full;
  - the full tier is always within the caps, because the gate runs on it.
- **Alternatives rejected.**
  - Perf class alone (round 1): up-samples on LOW tablets (W2).
  - Three tiers 2048/1440/1024 by stage px x resolution (MR2 section 3): the 1440 tier is rejected as an engineering
    decision (4.G).
  - Tier by `deviceMemory`: absent on all Apple WebViews (MR2:61).
  - Two-way re-selection on resize: a promotion back to half frees nothing until release, and it doubles the code
    paths.
- **Memory (ARITHMETIC).**
  - LOW phones, busiest knot: 30.4 -> 7.6 MiB decoded (6.1-6.8 with B). A room with two neighbours: 29.3 -> 7.3.
    These figures assume that every image has a half, as every placeholder does. A char on a smaller canvas counts its
    full file (critique_r3 W1).
  - With M2 the gate bounds decoded bytes D plus file bytes F at <= 32 MiB per knot. The LOW runtime count is exactly
    D/4 plus the half files' bytes F', because the halving is exact (critique_r2 W5). The half files are checked
    against the same per-kind file limits, so F' <= 5 x 450 KB = 2.15 MiB.
    - Where F' <= F, as expected for a quarter of the pixels, the count is **<= ~9.6 MiB**: (32 - 2.15) / 4 + 2.15
      (critique O1).
    - For the 5-image busiest knot, with every image on a half and no relation between F' and F, the bound is 32 / 4 +
      2.15 = **10.15 MiB** (critique_r3 O4). For any knot the guarantee is per entry: LOW count <= full count (section
      7), so a knot's LOW count <= its full count <= 32 MiB. Round 2's per-variant "half <= full" check, which made 9.6
      a guarantee, is replaced by the exact I2 condition (section 7).
  - Other devices: unchanged.
- **Download.** LOW phones fetch only half files; AVIF bytes do not scale with pixel count and no measurement exists
  for our art (MR2:144-147). Build: +2 files per image; paid fingerprints +2 per paid image (`manifest.ts:286-289`), from
  M3s on.
- **Risk.** The server indexes gated files only from `avif`/`webp`/`file` (`content.rs:352-356, :638-642`). It needs
  every named file on disk (`:660-670`) and ignores a nested `half`. So:
  - M3c writes `half` on every **public** image entry (a char only on the 1536-px canvas), in free and paid manifests
    alike: an id's entry must be
    identical in every manifest that names it (`budget.ts:559-577`). It writes `half` on no gated entry, so LOW
    players load the full tier of gated art (inside the caps, gated as today);
  - M3s (server slot, after M3c) adds the planner's gated branch, the server index and the fixtures in one lane.

  No state exists in which a manifest names a paid half file that the server does not serve.
- **Platform caveats.** Android only; the class is user-overridable (quality only, never security, R1 section 6). A
  foldable unfolded mid-session is demoted for later loads by the resize test.
- **Measure and verify.** These are engineering checks, not owner questions (critique W4):
  - the tester's side-by-side screenshots, full tier vs half, in M3c "Seen working": Playwright at 360 x 800, DPR 2,
    with a LOW UA and `screen` set (critique_r2 W7, O9), and a LOW Android inside Telegram when one is available,
    judged for halos, banding and softness on character outlines and backgrounds;
  - the memory delta;
  - that the test device's UA carries the class and that `screen.*` reports CSS px there.

### 4.D Layered sprites (body + trimmed face parts) - deferred

- **What it would change.** Catalog `chars.<c>` gains a body (or bodies per pose) and part groups; each expression
  maps to a part set (Ren'Py attributes / Naninovel composition map, MR3); `show:<char> <expr>` is unchanged (principle
  7: a catalog concern, MR3 "Staging tag -> parts"). The story tool expands an expression to part ids, so
  `assets(K)` and `carriedBound` count a shared body once (`carriedBound`, `budget.ts:691-699`, changes to body + largest part set per
  character). The executor's "<= 2 sprites per character" (`executor.ts:42-43`, PP:2032) becomes "<= 2 composites";
  whole-character fades need an `AlphaFilter` during the fade (container alpha shows the base face through, MR3
  concern 4) and expression swaps need a flattened face-patch crossfade (MR3 concern 5). STAGING-DSL section 8 gains a
  note that part ids are internal, never tagged.
- **Memory (ARITHMETIC, part 384 x 384 = 0.56 MiB).** Busiest knot with B: 23.5 MiB (vs 24.3 B alone): little for one
  new expression. The case for it is expressive writing: a knot showing ally in 4 expressions + stranger + bg + next bg
  is 39.4 MiB today (FAIL), 29.3-34.2 with B (critique_r2 O1), **24.7** with D + B.
- **Risk.** Art production (a complete base face under every part, MR3 concern 2), seams, alignment, AlphaFilter cost
  per frame on LOW Android, 16-texture batch limit (MR3 [P7]); pose changes are new bodies (MR3 [A6]).
- **Decision.** Not built unless owner Q-M1 answers "layered sources". Then: a design round, then lanes MD1 (catalog
  + story-tool expansion + part pipeline + gate) and MD2 (scene composition + transitions + e2e).

### 4.E GPU-compressed textures (KTX2 / Basis) - rejected now, frozen

- **Gain.** 8 bpp after transcode: busiest knot 7.6 MiB; 10.1 MiB if a mip chain is shipped. The formats do not
  require mips, but they forbid `generateMipmap` (MR1 :231-232), so minification quality needs a shipped chain. CPU
  copy = compressed size (MR1 TL;DR, "GPU memory per pixel"). Download: there is no measured KTX2-vs-AVIF comparison
  (MR1 :208). The measured comparator is WebP (Defold 2021, MEASURED): ETC1S 2.28 MB vs WebP 2.30-3.76 MB, and UASTC
  4.95-5.77 MB, i.e. 1.3-2.5 x WebP. McCurdy 2024 (CLAIMED): UASTC is "1-2x the size of JPEG or ETC1S" (critique O6).
- **Why not now** (MR1): Pixi's KTX2 worker `fetch(url)`s with no headers (principle 0's gated `FetchAsset` cannot feed
  it; a blob: path is unverified); default transcoder on an unpinned CDN; full libktx 216 kB JS + 714 kB wasm raw,
  brotli unmeasured, against the all-JS row (290 KB on main, 305 KB after LMI); ETC1S block artifacts and alpha problems
  on 2D art, UASTC 1.3-2.5x WebP download (Defold 2021, MEASURED by users); no measured KTX2-vs-AVIF comparison and no
  mobile transcode time; Windows
  has only BC; forum reports, not WebKit bug-tracker entries (critique_r2 O8): UASTC->ASTC mip artifacts on Apple GPUs
  (Babylon.js forum, 2025, MR1 [46]) and magenta after a WKWebView crash (three.js forum, 2024, MR1 [47]).
- **Return conditions (all):** A + B (+ C) are in and a device measurement still exceeds 150 MB, or D's art still fails
  the gate; the transcoder's brotli size is measured and a budget row designed; transcode time measured on a LOW
  Android and an iPhone; ETC1S/UASTC vs AVIF q50 judged on the real art by the owner; a loader that feeds the
  transcoder bytes fetched through `FetchAsset`; the transcoder self-hosted and pinned.

### 4.F LOW render resolution (already designed) - fix in L15

`mount` takes the perf class: `mount(host, { dpr, perfClass, fetchAsset })`, with `renderResolution(o.dpr,
o.perfClass)` in place of the re-clamp with `'HIGH'` (`controller.ts:265`).
- Passing `renderResolution(dpr, perfClass)` as today's `resolution` would already give 1 (critique O9). The signature
  still changes in L15, for two reasons: M3c's `tierFor` needs the class inside the controller, and taking it in L15
  keeps L15's caller of `mount` (an `app/` file on the L15 -> LMI chain) out of every memory lane.
- L15's lock gains `client/src/scene/controller.ts` for this one hunk (14 -> 15 files).
- Framebuffers on LOW: 390 x 844 CSS x 4 B x 2 + stencil ~= 3 MiB instead of ~12 (ARITHMETIC from PP:2126).
- Red: `scene: a LOW perf class renders at resolution 1` (`perf.spec.ts`), asserting `canvas.width ===
  canvas.clientWidth`. It runs inside a `test.describe` with `test.use({ deviceScaleFactor: 2, userAgent: <a
  Telegram-Android UA whose last token is "LOW"> })`. Playwright allows `test.use` inside `test.describe`, and
  `navigator.userAgent` reaches `perfClassFromUa` (`webapp.ts:112`, `perf.ts:9-13`).
  - Predicted red before the controller hunk: `canvas.width` = 2 x `clientWidth` (750 vs 375 at the config's 375-px
    viewport), because `controller.ts:265` re-clamps with `'HIGH'` and `autoDensity` is on (`controller.ts:73`).
  - Why DPR 2 (critique_r2 W7): Playwright's `deviceScaleFactor` "Defaults to `1`", and the config sets none
    (`playwright.config.ts:39-43`). At DPR 1, `renderResolution(1, 'HIGH')` = `renderResolution(1, 'LOW')` = 1
    (`layout.ts:18-23`), so the test could not be red.
- Control: `scene: an AVERAGE perf class at DPR 2 renders at resolution 2` (DPR 2, the default UA):
  `canvas.width === 2 x canvas.clientWidth`. It proves that the DPR emulation took effect. If the control is red, the
  LOW test is vacuous and is not counted.

### 4.G Considered, not proposed

- 1440-tall tier: rejected as an engineering decision (critique W4).
  - Used everywhere, it up-samples 1.08-1.33 x on most phones (MR2 table).
  - Under 4.C's no-up-sampling predicate, it would apply to SE-class screens only (scale 0.99 at r = 2): +2 files per
    image for one device class.
  - Return condition: a measured share of devices with a stage device height of 1025-1440 px, and memory pressure
    measured there.
- Prop atlases: per-texture refcount makes a sheet live while any frame is held; one sheet cannot mix public and gated
  props (principle 0); a 2048^2 sheet is 16 MiB > a room's 8 x 1 MiB (MR2 section 5).
- RGB565 uploads for opaque backgrounds: not researched (banding, driver storage not guaranteed) - no proposal.
- Narrowing K9 preloads to successors' first batch: trades memory for visible mid-knot loads and breaks "K's own
  assets are already resident" (STAGING-DSL section 8) - out of scope.

## 5. Data model and contracts

No SQL, no new HTTP route, no staging-DSL change for A/B/C. The asset manifest (TS decoder `catalog.ts:774-807`, server
probe `content.rs:343-361`) is the one cross-crate contract that moves.

```ts
// client/src/story/catalog.ts  (M1 adds `trim`, M3c adds `half`; both optional, absent = today's meaning)
export type Trim = { canvasW: number; canvasH: number; x: number; y: number };   // canvas px = the full file's stored px
export type ImageFile = { w: number; h: number; decodedBytes: number; avif: AssetRef; webp: AssetRef };
/** M3c: the 2 x 2 average of the full file. No trim of its own: it takes the entry's canvas and trim rect. */
export type HalfFile = ImageFile;
export type ImageEntry = { kind: 'image' } & ImageFile & { trim?: Trim; half?: HalfFile };
// Decoder rules: decodedBytes = w*h*4 (kept, also for half); trim only on char/prop ids; 0 <= x, 0 <= y,
// x + w <= canvasW, y + h <= canvasH; (w, h) !== (canvasW, canvasH) (else omit); on char/prop ids w and h are even (M1);
// half only on bg/cg/char/prop, and on a char only when its canvas height (trim.canvasH, else h) is
// CHAR_HALF_CANVAS_H (critique_r3 W1); half.w * 2 === w and half.h * 2 === h; half has exactly the keys w, h,
// decodedBytes, avif, webp; covers keep today's shape.
/** R3-0: not `Tier`, which `client/scripts/assets/manifest.ts:98` already exports as 'public' | 'paid' | 'unused'. */
export type SizeTier = 'full' | 'half';
/** M3c: the one canvas height a char half may have (DIMS's char maximum, `budget.ts:165`); `halfFits` reads it too. */
export const CHAR_HALF_CANVAS_H = 1536;
```

```rust
// server/src/content.rs (M3s): index half-tier gated files under the chapter's product; still no deny_unknown_fields.
#[derive(Deserialize)]
struct AssetProbe { avif: Option<UrlProbe>, webp: Option<UrlProbe>, file: Option<UrlProbe>, half: Option<HalfProbe> }
#[derive(Deserialize)]
struct HalfProbe { avif: UrlProbe, webp: UrlProbe }
```

- `trim` needs no server change: `AssetProbe` ignores unknown fields (no `deny_unknown_fields`, `content.rs:351-356`).
- `half` on a **gated** entry exists only from M3s on (M3c writes it on public entries only, section 11). M3s's committed fixtures
  `server/tests/fixtures/content/chapters/{ch2,ch4}/assets.json` gain `half` for their one bg each, with 4 fixture files,
  because `index_assets` requires every named file on disk (`content.rs:660-670`).
- File names: half files get a distinct token in `assetFileName` (`manifest.ts:221-223`) so names stay injective
  (ids never hold `-`; per-namespace segment counts rule out collisions; the cut proves it in a test).

## 6. Module API (signatures only)

```ts
// scene/layout.ts (pure)
export type TextureGeometry = { canvas: Size; orig: Box; trim: Box | null; resolution: 1 | 0.5 };
/** M1: `textureGeometry(entry)`, resolution 1. M3c adds `tier`: 'half' -> resolution 0.5, the same canvas and trim. */
export function textureGeometry(entry: ImageEntry, tier: SizeTier): TextureGeometry;
export function stageBound(screen: Size | null, host: Size): Size;                      // M3c: largest reachable stage
export function halfFits(stage: Size, resolution: number): boolean;                     // M3c: no bg/cg/char half up-sampled (char term at CHAR_HALF_CANVAS_H)
export function tierFor(perf: PerfClass, bound: Size, resolution: number): SizeTier;    // M3c: 'half' iff LOW && halfFits

// scene/registry.ts
/** M1: the geometry is a third argument, so a loader that ignores it still type-checks: TypeScript allows a function
 *  to discard trailing parameters (critique_r2 W6). The fakes at `preload.test.ts:72` and `executor.test.ts:145` do. */
export type LoadImage<T> = (ref: AssetRef, signal: AbortSignal, geometry: TextureGeometry) => Promise<Result<Decoded<T>, LoadError>>;
/** M2's members are required, so the fakes of preload.test.ts and executor.test.ts gain them (M2's lock, section 11). */
export type Decoded<T> = {
  texture: T; w: number; h: number;              // stored px of the tier's file, checked against it (registry.ts:139)
  keptBytes: number;                              // M2: the kept Blob's real size (blob.size), counted once live
  gen: number | null;                             // M2: GPU generation uploaded under; null = bitmap kept open
  revive(gen: number, signal: AbortSignal): Promise<Result<void, LoadError>>;   // M2: bring this texture to `gen`
  release(): void;
};
export type TextureHandle<T> = { readonly id: AssetId; readonly texture: T; readonly w: number; readonly h: number }; // w,h = canvas
/** `tier` (M3c) is required like `variant`; the two fakes gain `tier: 'full'` (M3c's lock). */
export function createAssetRegistry<T>(deps: { load: LoadImage<T>; variant: 'avif' | 'webp'; tier: SizeTier }): AssetRegistry<T>;
/** M2: the visible-pass deadline and the per-record background deadline (section 8 "Revive failure"). */
export const REVIVE_DEADLINE_MS = 3000;
/** M2: how a revive pass settles (critique_r4 O2). */
export type ReviveEnd = 'done' | 'aborted';
interface AssetRegistry<T> {
  /* existing */
  /** M2: the handle of the id's record while that record is live (resident, kept or stale), else null (no record,
   *  pending, ended). The handle is the record's identity: a successful revive keeps it (the same Texture, re-uploaded
   *  in place, 4.A), and an ended record's handle is never current again (section 8 "Identity rule"; critique_r4 W1,
   *  W2, open question 1). A query for identity only: the executor reads it right after its own `acquire`. */
  current(id: AssetId): TextureHandle<T> | null;
  /** M2: every live record not at `gen` is brought to it, visible holders first, one at a time. `visible` settles
   *  `'done'` when the visible pass has handled each of its records (revived or ended; at the latest at the deadline),
   *  `all` when every record has been handled. A failed record ends at once (section 8). A newer call, or `signal`,
   *  aborts the revive: an abort fails no record, and each pass not yet settled settles `'aborted'` at the abort. Each
   *  pass settles exactly once (critique_r4 O2). No id list: the executor finds what ended by identity. */
  revive(gen: number, signal: AbortSignal): { visible: Promise<ReviveEnd>; all: Promise<ReviveEnd> };
  demote(): void;                                 // M3c: one-way half -> full for records started later
  stats(): RegistryStats;
}
/** M2 adds five counters (critique_r3 W2); every `toEqual` over `stats()` in the scene suites asserts all nine. */
export type RegistryStats = {
  live: number; bytes: number; pending: number; overCap: number;
  keptBytes: number;     // M2 commit 2: the kept Blob sizes of live records (inside `bytes`)
  keptMismatch: number;  // M2 commit 2: records that went live with keptBytes !== ref.bytes (cumulative, like overCap)
  openBitmaps: number;   // M2 commit 3: live records with Decoded.gen === null (bitmap open)
  stale: number;         // M2 commit 3: live records not at the gen of the latest revive() call; 0 before the first call
  reviveFailed: number;  // M2 commit 3: records ended by a failed or late re-decode (cumulative)
};

// scene/loader.ts
/** Uploads to the renderer current at call time, never a captured one; GL only; the generation, or null. */
export type Upload = (source: ImageSource) => number | null;
export function createImageLoader(deps: { fetchAsset: FetchAsset; upload: Upload }): LoadImage<Texture>;

// scene/executor.ts (M2; critique_r3 O5, R4-0, critique_r4 W1, W2, O1; section 8 "Identity rule")
/** A hold entry: the acquire, and the handle it is bound to (the live record `take` joined, read by
 *  `registry.current(id)` right after the acquire; else the handle the acquire resolved with; null until then). */
type Held<T> = { readonly hold: Hold<T>; bound: TextureHandle<T> | null };
/** Removes every shown or retiring view whose handle's record has ended (after `complete()`, and only when there is
 *  such a view), deletes every hold entry bound to an ended record without a registry release, and takes the slots of
 *  the logical stage among those entries again in one instant batch. It touches nothing else: no live view, no visual
 *  skipped for another reason, no newer record of the same id. With nothing bound to an ended record it returns at once,
 *  so a repeated call is a no-op. Returns void: its batch may queue behind a batch waiting on a fetch, and no caller
 *  waits for it (critique_r4 O1). */
reacquire(): void;

// scene/revive-flow.ts (M2, new; pure: no Pixi, no GSAP; critique_r4 O1, O2)
export type ReviveFlowDeps = {
  revive(gen: number, signal: AbortSignal): { visible: Promise<ReviveEnd>; all: Promise<ReviveEnd> }; // registry.revive
  reacquire(): void;                              // executor.reacquire: void, so no step can wait for the executor's chain
  resume(): void;                                 // the controller: frames may draw again, requestRender()
};
/** One owner for the revive's AbortController and the frame suspension. Each settle of a pass (done or aborted,
 *  current or superseded) calls `reacquire()`; only the current revive's `visible` settling `'done'` clears the
 *  suspension and calls `resume()`. */
export interface ReviveFlow {
  lost(): void;                                   // webglcontextlost, the rebuild's start, a restore while deactivated:
                                                  //   aborts the current revive, suspends frames
  start(gen: number): void;                       // aborts the current revive, suspends frames, starts revive(gen)
  abort(): void;                                  // deactivated: aborts the current revive; the suspension is unchanged
  suspended(): boolean;                           // the render gate reads it (with `lost`); false until the first lost()/start()
  reviving(): boolean;                            // a started revive whose passes have not both settled
  destroy(): void;                                // aborts; later calls are no-ops
}
export function createReviveFlow(deps: ReviveFlowDeps): ReviveFlow;

// scene/controller.ts (the signature in L15 for F; used by M3c)
mount(host: HTMLElement, o: { dpr: number; perfClass: PerfClass; fetchAsset: FetchAsset }): Promise<Result<void, SceneError>>;
stats(): { /* existing */ rebuilds: number; gen: number; openBitmaps: number; stale: number; staleFrames: number;
  reviveFailed: number; reviving: boolean };      // M2; __novelDebug under __TG_MOCK__ only
debugForceContextLoss(mode: 'restorable' | 'hard'): void;  // M2: 'hard' = gl.getExtension('WEBGL_lose_context').loseContext()

// scripts: budget.ts reads the cap through manifest.ts (the scripts' one door to src/, manifest.ts:4-5)
export const LIMITS: Limits = { /* ... */ knotSet: STEADY_CAP_BYTES, roomSet: STEADY_CAP_BYTES /* M2 */ };
```

## 7. Caps and the knot-set gate after each lever

| | Registry (runtime invariant) | `budget/knot-set` (static gate) | Equivalence (I2) |
|---|---|---|---|
| Today | counts `entry.decodedBytes` of live + in-flight records; 32 steady / 48 hard | sum of `decodedBytes` (own) + `carriedBound` | equal per knot |
| M1 trim | unchanged code; counts trimmed `decodedBytes` | unchanged code; DIMS (`budget.ts:162-168`) checked on the canvas; new decoder checks: trim only on char/prop, inside the canvas, even stored sides on char/prop | equal |
| M2 cpu-copy | reserves `decodedBytes + ref.bytes` of the chosen variant at admission; counts `decodedBytes + blob.size` once live (a different size is counted and reported in `keptMismatch`, not refused; critique O8) | the shared `decoded()` helper (`budget.ts:666-668`) counts `decodedBytes + max(avif.bytes, webp.bytes)`, so the knot-set **and room-set** rows (`budget.ts:701-759`) both move by the file bytes; `LIMITS.knotSet = LIMITS.roomSet = STEADY_CAP_BYTES` (one source; critique O2) | static >= runtime for a host that serves the build's bytes |
| M3c half | counts the file of the tier current when the record starts (`rec.file`; `demote()` changes later records only) | stays on the full tier. The decoder enforces the exact halving: `half.w x 2 = w`, `half.h x 2 = h`, `half.decodedBytes = w/2 x h/2 x 4` (critique_r2 W5), and a char `half` only on the 1536-px canvas (critique_r3 W1). Image rows add: half files exist at their manifest sizes and within the kind's file limits; per entry, `half.decodedBytes + max(half avif, half webp) <= decodedBytes + max(avif, webp)`, which is the exact I2 condition, not a proxy. The `transfer <ch> (half)` rows (6 MB) are a **measurement** of what a half-tier session downloads per chapter (the half file where an entry has one, else the full; from M3c, gated halves from M3s), not counted as a guard (critique_r2 O4) | per entry the LOW count <= the full count, so the gate bounds LOW too (for room-set as for knot-set) |
| Caps | 32 / 48 MiB through M1-M3 | 32 MiB | - |
| After M2 is measured | candidate 48 / 64 MiB: steady 48 + 12 + 45.8 + 13.7 + 3.1 = 122.6, transient 64 + 12 + 45.8 + 13.7 + 3.1 = 138.6 < 143.05 | follows `STEADY_CAP_BYTES` | a PP decision on measured numbers, not in M2 |

Steady total after the levers (PP model at the gated limits, MiB; 3.1 = covers 2.6 + meta 0.5):
- today: 138.6; LOW with F: 129.6;
- M2: 106.6; LOW with F: 97.6;
- LOW phones with F + M2 + M3c: planned set <= 9.6 + 3 + 45.8 + 13.7 + 3.1 = 75.2 (75.8 with 10.15, the 5-image
  busiest knot's bound, 4.C). The cap-bounded worst case stays 32, which gives 97.6.

## 8. Critical flows

**A1 load (M2).**
1. The registry admits `need = decodedBytes + ref.bytes`.
2. The loader's `fetchAsset` returns a Blob.
3. `createImageBitmap` -> `ImageSource({ resource, alphaMode: 'premultiply-alpha-on-upload', autoGarbageCollect:
   false, resolution })` -> `Texture({ source, orig, trim })`.
4. `gen = upload(source)` against the renderer current at that moment. A number -> `bitmap.close()`; `null` (context
   lost, or not GL) -> the bitmap stays open (`kept`).
5. The record goes live with the Blob, counted at `decodedBytes + blob.size`.

An abort at any step closes what exists (as `loader.ts:28-40`).

**A2 restore (M2).** The steps run in the revive flow (`scene/revive-flow.ts`, section 6), which the controller drives.
1. `webglcontextlost` -> `lost = true`; `flow.lost()`: a running revive is aborted, frames are suspended.
2. `webglcontextrestored` -> `gen += 1`; `flow.start(gen)` -> `registry.revive(gen, signal)`. While deactivated
   (`paused`), only `flow.lost()`: `activated` starts the revive (section 9).
3. `visible` settles `'done'` (at the latest at the deadline) -> `executor.reacquire()`: every view bound to an ended
   record leaves the stage synchronously, and an instant batch takes those slots again ("Identity rule" below). Then,
   because this revive is the flow's current one, frames resume and `requestRender()`. `reacquire()` returns void and
   nothing waits for its batch, which may queue behind a batch waiting on a fetch (critique_r4 O1).
4. `all` settles -> `executor.reacquire()` again. It is a no-op unless a background failure ended a record that the
   hold entry of a skipped visual is bound to. No view can be bound to such a record ("Identity rule", item 5), so it
   removes no view and completes no transition (critique_r4 open question 2).
5. A pass that settles `'aborted'`, and any pass of a superseded revive, also calls `reacquire()`, which takes an ended
   record's views off the stage before any later frame. It never resumes frames (critique_r4 O2).

**Rebuild (D13)**, when the context is still lost `CONTEXT_GRACE_MS` after `activated`. Steps 1-3 run in one
synchronous block after `app.init`:
1. `flow.lost()`. The new Application is installed (`c.app = app`; `executor.rebind`, which re-creates only views whose
   handle is current, "Identity rule" item 1, and drops a non-current view from the model: `bg = null`, `chars.delete`,
   `props.delete`, critique_r5 O3) and `gen += 1`.
2. `flow.start(gen)`: steps 3-5 of A2 against the new renderer.
3. The old Application is destroyed. That clears only its own GPU data (critique, "Positive": `GCManagedHash.remove`
   clears `_gpuData[renderer.uid]`).
4. The first frame is the flow's `resume()` (A2 step 3). It comes after step 3 even when nothing is stale, because a
   settled promise's continuation runs only after the synchronous block.

**Revive failure** (one rule; critique_r2 O5). A re-decode that fails, or has not settled by `REVIVE_DEADLINE_MS`,
ends its record at once, whatever its holders:
1. The record leaves the registry's map. `Decoded.release()` destroys its texture and drops its Blob; a late bitmap is
   closed when it settles.
2. Every `acquire` waiting on it resolves with `{ kind: 'decode' }`. A batch tapped during the revive skips that
   visual, as for any failed load. The scheduler's `ENSURE_HOLDER` and the preload holders hold nothing more.
3. The flow's next `reacquire()` (A2 steps 3-5) finds every view and hold entry bound to the ended record's handle.
   It removes those views synchronously, before frames resume, whatever batch is still waiting in the executor's
   chain (R4-0). It deletes those entries without a registry release: the record has ended, and a release by id would
   act on a newer record of the id (critique_r4 W2).
4. The same call takes the logical stage's slots among them again in one instant batch: a new record and a
   re-download. A gated file re-auths through `FetchAsset` (`loader.ts:1-3`), and a failed fetch skips the visual as
   any load does. This is a normal load after the record ended, not a network path inside the revive (R3-12's rejected
   alternative; critique_r3 O5).

So no record outlives a failed revive, and no later `acquire` can join one (`registry.ts:236-241`). No sprite is made
from its handle, and it is re-taken once. The deadline bounds the suspended period, because step 3's removal waits
for no batch (R4-0). The round-1 claim "the next batch that replaces the slot heals it" stays withdrawn.

**Identity rule** (R5-1; critique_r4 W1, W2, open question 1). The token of a record is its `TextureHandle`. The
registry creates one when the record goes live (`registry.ts:147`). A successful revive keeps it: the same `Texture`
is re-uploaded in place (4.A). An ended record's handle is never current again, and a later record of the id gets a
new one. So "h's record has ended" is `registry.current(h.id) !== h`, one map read.
1. **No sprite is made from an ended handle.** Every `adapter.sprite` call in `build` gets its handle through one
   accessor, `handleFor(slot)`, which returns the batch's handle only if it is current, checked in the same
   synchronous step as the call. That covers the takes resolved before the failure (W1) and the calls that run later,
   at a fade through black's midpoint (`executor.ts:400-414`; R5-0). `rebind` re-creates only views whose handle is
   current. A failed check builds the slot as a skipped visual: the slot keeps what it showed (`executor.ts:451-454`).
2. **Every hold entry knows its record.** `take` reads `registry.current(id)` right after its `acquire`. A non-null
   value is the live record the acquire joined: the acquire resolves with that handle, or with `decode` if the record
   fails its revive while the acquire waits. Otherwise `bound` is set when the acquire resolves ok. A take for an id
   the manifest lacks has `bound: null`.
3. **`reacquire()` acts on exactly what is bound to an ended handle.**
   - Views: if any shown or retiring view is bound to one, it calls `complete()`, then removes each such view (a
     character's group goes with it).
   - Hold entries: it deletes each one bound to an ended handle, with no registry release. `sweep` follows the same
     rule: such an entry is deleted, never released.
   - Re-take: one instant batch, target = the logical stage, takes = the slots of the logical stage whose entry it
     deleted.
   - It moves nothing else: no live view, no visual skipped for another reason (fetch, over-cap, decode of its own
     load), no newer record of the id.
4. **Each ended record is re-taken once.** After the call nothing is bound to it. A later call finds the re-taken
   entries bound to the new record (`null` while pending, then the new handle), so it returns at once: no
   `complete()`, no removal, no batch, no GET (W2).
5. **Only the visible pass can end a record that a view is bound to.** A view comes from a take that resolved in one
   of two ways:
   - before the revive started: the executor's visible holder was then on the record, so the record is in the visible
     pass;
   - after the record was revived or loaded under the current generation: it cannot fail again in this revive.

   A take that waits on a stale record that then fails gets `decode` and builds nothing. So a view bound to an ended
   record exists only between a visible-pass failure and that pass's settle (`'done'`, or `'aborted'` by `lost()`, a
   newer `start()` or `abort()`). Frames are suspended throughout, and `reacquire()`'s `complete()` runs only then. The
   `all` continuation finds at most the entries of skipped visuals (critique_r4 open question 2).

**B build (M1).** 2048-px clamp -> raw scan alpha > 0 -> +2 px -> even width and height -> `extract` -> AVIF + WebP from
the same pixels; planner writes `trim`; per-character canvas equality and even canvas sides checked; budget reads the
result. **M3c** adds: the 2 x 2 premultiplied average of the extracted pixels -> half AVIF + WebP; planner writes `half`
on public entries, on a char only on the 1536-px canvas (critique_r3 W1).
**C mount (M3c).**
1. `tier = tierFor(perfClass, stageBound(screen, host), resolution)`.
2. The registry is created with `{ variant, tier }`; every entry resolves its file once, at record start.
3. On each resize: `halfFits` fails on the new host -> `registry.demote()`, once.

## 9. Concurrency and failure model

| Event | Outcome |
|---|---|
| Release while revive runs | revive acts only on records still live by identity (the registry's generation rule, `registry.ts:125-133`); a late bitmap is closed |
| Second loss during revive | `flow.lost()` aborts the running revive (its re-decodes could not upload: `upload` returns `null` while lost), so records stay `kept` or stale; the next restore increments `gen` and starts a new revive. The aborted passes settle `'aborted'`: their continuations `reacquire()` and resume nothing (critique_r4 O2) |
| Rebuild during revive | rebuild aborts the running revive (`flow.lost()`), then revives against the new renderer under the new `gen`. `executor.rebind` re-creates only views whose handle is current; a view of a record that failed before the abort becomes a skipped visual, and the aborted visible pass's `reacquire()` takes it again (section 8 "Identity rule") |
| Load in flight during loss | `upload` returns `null`: the bitmap stays open (`kept`); the revive uploads and closes it without a decode |
| Load settling between the rebuild's install and its revive | uploads to the new renderer under the new `gen`; the revive skips it |
| `show` of a record not yet revived | its `acquire` waits for that record, which moves to the front; frames stay suspended while a visible record is stale, at most until the deadline (`stats().staleFrames` stays 0) |
| Re-decode fails, or misses `REVIVE_DEADLINE_MS`, during revive | the record ends at once (section 8 "Revive failure"): texture destroyed, Blob dropped, waiting acquires get `decode`. The visible pass's `reacquire()` takes every view bound to its handle off the stage synchronously before frames resume, and loads the slots again in an instant batch, once (critique_r2 O5, critique_r3 O5, critique_r4 W2) |
| A batch waiting on a fetch when a revive fails | its takes may hold the ended handle, resolved before the failure (critique_r4 W1). `handleFor` refuses it at build, so that slot is built as a skipped visual. The re-take queues behind the batch in the chain (`executor.ts:633-657`) and then shows the slot on the new record. Frames resume at the deadline: the removal is synchronous and nothing waits for the re-take (R4-0, critique_r4 O1). The slot is empty, or shows its previous visual, until that batch's fetch settles |
| A fade through black reaches its midpoint after the record it shows ended | the midpoint's `newChar` / `swapBg` / `syncProps` get the handle through `handleFor` at that moment, so the slot keeps its old visual; the re-take replaces it (R5-0) |
| The background pass reports a failure while a transition runs | `reacquire()` finds only the dead-bound entry of a skipped visual (no view: section 8 "Identity rule" item 5). It calls no `complete()`, and its re-take queues behind the running batch (critique_r4 open question 2) |
| `reacquire()` called again (each pass settle, every revive) | a no-op unless another record ended since: the re-taken entries are bound to the new record, and nothing is released by id (critique_r4 W2) |
| The story starts a new record of the id between the failure and `reacquire()` | through a preload or `ensure`: the re-take's acquire joins it (no second GET), and `bound` is its handle. Through the same slot: impossible while the dead-bound entry exists, because `take` reuses it (`executor.ts:230-232`). Its batch builds a skipped visual, and `reacquire()` heals it |
| Blob size differs from the manifest (a rewriting host) | counted at its real size, `keptMismatch` += 1; the image is shown (O8) |
| `deactivated` during revive | GSAP paused as today. `flow.abort()` aborts the revive through its signal: no record fails by abort, late bitmaps are closed on settle, records stay stale. Unsettled passes settle `'aborted'`; their continuations `reacquire()` and resume nothing, so frames stay suspended if the visible pass had not ended (critique_r4 O2). On `activated`, the context check runs as today. Not lost, and `flow.suspended()` or `stats().stale > 0` -> `flow.start(gen)` under the current generation with a fresh deadline; a revive with nothing stale settles `'done'` at once. Lost -> grace, rebuild, `gen += 1`, revive. Why abort rather than continue: a hidden WebView throttles or freezes timers and work (verify per platform), so a deadline running across a background period would fail records that never got the time (critique_r2 O5) |
| `webglcontextrestored` while deactivated | `gen += 1`, `flow.lost()`; the revive starts on `activated` (row above), for the same reason as the abort |
| `destroy()` during revive | records dead; revive results released at once; `flow.destroy()` aborts the revive, and its continuations find a destroyed executor (`reacquire()` returns at once) |
| Token expiry during revive | none: revive reads kept Blobs, no fetch. A `reacquire()` after a failure fetches through `FetchAsset`, which re-auths gated URLs (`loader.ts:1-3`) |
| Story update between sessions | manifests are per build; geometry is per file |
| Perf class absent | AVERAGE (R1 section 6) -> full tier |
| Viewport change / fullscreen / unfold | `halfFits` re-tested on the new host; false -> `registry.demote()`: later records load the full tier, live half records stay until released (I4: layout is tier-independent) |
| Gated image on a LOW phone before M3s | its entry has no `half`: the full file loads (inside the caps; gated as today); no 404 path exists |
| `screen` dimensions absent or not positive | counted as an unbounded screen -> full tier |

## 10. Resource lifetime

| Resource | Owner | Created | Destroyed | Leak detected by |
|---|---|---|---|---|
| Kept Blob (M2) | registry record via `Decoded` | loader after fetch | `Decoded.release()` at holder-set empty | `registry_returns_to_baseline` extended to `keptBytes = 0` |
| Decode `ImageBitmap` | loader | `createImageBitmap` | `close()` right after `upload`; kept open only while `upload` returns `null`, then closed by the next revive | `stats().openBitmaps`; e2e `scene: no decoded bitmap outlives its upload` |
| Revive `ImageBitmap` | `Decoded.revive`, called by `registry.revive` one record at a time | per stale record | `close()` after upload, on abort, on failure, or on settle after its deadline | same; e2e `scene: an unrestored context loss rebuilds the stage` asserts `openBitmaps === 0` and `stale === 0` after the revive |
| Texture + `ImageSource` | registry record | loader | `texture.destroy(true)` (unchanged) | unchanged |
| Revive `AbortController` (M2) | revive flow | `flow.start` | the next `start`, `lost()`, `abort()` or `destroy()` | `revive-flow:` reds (section 11 M2 commit 3b) |
| A sprite on a record's handle | executor (unchanged owner) | `build` / `rebind`, only from a current handle (section 8 "Identity rule" item 1) | as today, or by `reacquire()` once its record ended | the recording stage throws on a sprite over a released texture (`executor.test.ts:79-81`); M2 commit 3a reds |

A dead-bound hold entry keeps a reference to the ended handle's JS object until `reacquire()` deletes it; its GPU texture
and Blob were already freed when the record ended, so it holds no counted bytes.

## 11. Lane cut sketches

Each fits one subsystem, <= ~15 files, red-first per commit, budgets in the build gate. Line numbers are re-located
at cut time.

Ownership rules for every lane below (critique W3):
- No M lane edits `docs/PROTOTYPE-PLAN.md`. The design branch's PP revision owns that text (section 13).
- `docs/FEATURE_MAP.md` and `docs/ARCHITECTURE.md`: M1's and M2's rows go to D2; M3s writes the half-tier rows after
  D2.
- Each shared file's chain is stated per lane. The e2e file `client/e2e/memory.spec.ts` is new (M1), so no L15 or LMI
  spec is edited.

### M1 `memory-trim` (client) - first client slot after L15, before LMI
- **Goal.** char/prop files hold their alpha box + 2 px, laid out as the untrimmed canvas; knot-set rows drop (quote
  before/after); bg/cg/cover bytes byte-identical; no DSL, server code or HTTP change.
- **Why after L15.** L15 brings the first rendered scene and `perf.spec.ts` (PP:2332); the placement proof is an e2e.
- **Why before LMI.** M1 is the one lever that buys knot-set headroom for the real art. It also fits the window in
  which LMI waits for LE2 (RESUME "Next launches": LM2 -> LF2 -> LE2 are still ahead in the server slot after LF1).
  The cost if LE2 is merged first: LMI starts one M1 later.
- **Chains (PP revision).**
  - `client/scripts/{budget.ts,budget.test.ts}`: L1 -> L5 -> LP2 -> **M1** -> LMI -> **M2** -> **M3c** (PP:2568, :2612
    end at LMI today). LMI's gate gains M1.
  - `client/src/story/catalog.ts`: ... -> L13 -> M1 -> M3c (PP:2556).
  - `client/scripts/assets.ts`, `client/scripts/assets/{encode.ts,assets.test.ts}`: ... -> LW3 -> M1 -> M3c -> M3s.
  - `client/scripts/assets/manifest.ts`: ... -> LW3 -> M1 -> M2 -> M3c -> M3s (M2 re-exports the cap; critique_r2 O3).
  - `client/src/scene/{registry,registry.test}.ts`: L11 -> M1 -> M2 -> M3c.
  - `client/src/scene/loader.ts`: L11 -> M1 -> M2. M1's loader forwards the geometry's `resolution`, so M3c leaves the
    loader unchanged (critique_r2 W6).
  - `client/src/scene/{preload.test,executor.test}.ts`: L11 -> M2 -> M3c. Their fakes gain M2's `Decoded` members and
    M3c's `tier`; M1's third `load` argument needs no fake change (critique_r2 W6).
  - `client/src/scene/{layout,layout.test}.ts`: L11 -> M1 -> M3c.
  - `client/e2e/memory.spec.ts`: M1 -> M2 -> M3c -> M3s.
- **Lock (13).** `client/scripts/assets/encode.ts`, `client/scripts/assets.ts`, `client/scripts/assets/manifest.ts`,
  `client/scripts/assets/assets.test.ts`, `client/src/story/catalog.ts`, `client/scripts/budget.ts`,
  `client/scripts/budget.test.ts`, `client/src/scene/layout.ts`, `client/src/scene/layout.test.ts`,
  `client/src/scene/registry.ts`, `client/src/scene/registry.test.ts`, `client/src/scene/loader.ts`,
  `client/e2e/memory.spec.ts` (new). No docs.
- **Commits.**
  1. Decoder `trim`. Red `catalog: trimmed image entry decodes` -> issue `trim: unknown key`; also `catalog: a trim
     outside its canvas is an error value` and `catalog: a char entry with an odd stored side is an error value` (it
     decodes; critique_r2 W5). A different red (a fixture failing) means the optional-key path broke `exactKeys`.
  2. `textureGeometry`. Red `layout: a trimmed file keeps its canvas as orig` -> orig 466 x 1394, expected 768 x 1536.
  3. Registry handle, the geometry as `load`'s third argument, and loader `orig`/`trim`/`resolution`.
     - Red `registry: a trimmed entry's handle reports its canvas` -> h 1394.
     - Red `registry: load receives the entry's geometry` -> the third argument is undefined.
     - `preload.test.ts` and `executor.test.ts` are not edited. Their fakes take one or two parameters and still
       type-check (critique_r2 W6); this commit's `npm run check` proves it.
  4. Budget. Red `budget: a trimmed background fails` -> a PASS row; `budget: a char canvas over 768x1536 fails`.
  5. Encoder + planner on. Red `encode: a transparent sprite is cut to its alpha box plus 2 px, even-sided` -> w 768;
     `assets: expressions of one character share a canvas` -> exit 0 on a mismatched pair; `assets: a char canvas with
     an odd side is refused` -> exit 0. The shape test `assets:
     paid manifest keeps the server fixture keys` compares untrimmed kinds; the server fixtures stay as they are.
  6. e2e `scene: trimmed character renders where its canvas puts it`, in the new `client/e2e/memory.spec.ts` (pixel
     samples just inside the head's top edge, beside the body and above the head, computed from `placeholder.ts` and
     `layout.ts` constants). Seen red by mutation: loader without `orig`. The sample rule (critique_r3 open question 2),
     which M3c reuses on the half tier:
     - every sample sits >= 4 CSS px (>= 4 device px at resolution >= 1) from every edge: the silhouette, the head,
       the label glyph boxes and the canvas. At M3c's LOW phone (resolution 1, 0.78 x 740 / 1536 = 0.38 device px per
       canvas px), 4 px is >= 10 canvas px, i.e. >= 5 half texels, well past the 1 half texel that the 2 x 2 mean and
       bilinear sampling can move an edge;
     - each sample is compared with the expected flat colour of its region (`placeholder.ts` constants; outside the
       body, the bg showing through) at +-12 per RGB channel. The test asserts that the inside and outside colours of
       each sample differ by > 24 in some channel, so a match cannot confuse them;
     - the lane report quotes the largest per-channel deviation seen; above 6 (half the tolerance) the tester flags it.

     The helpers that reach a line and read a canvas pixel come from `client/e2e/helpers.ts` (section 14 item 7).
- **Pins.** char/prop files, their manifest entries and knot-set rows move on purpose; bg/cg/cover files and covers.json
  byte-identical; story outputs untouched.
- **Gates.** check, test, story, build, e2e. Seen working: `npm --prefix client run build` knot-set rows.

### M2 `memory-cpu-copy` (client) - after LMI
- **Goal.**
  - On a GL renderer, no decoded bitmap outlives its upload; Blobs are kept for revive.
  - A revive brings every live texture to the current renderer before a frame binds it (I7).
  - The caps count kept bytes; `LIMITS.knotSet = LIMITS.roomSet = STEADY_CAP_BYTES`.
  - After a context loss the player sees the same stage. After a Pixi-restored loss or a rebuild, it appears when the
    visible revive ends (3 decodes at the busiest knot, timed in section 12), not at the first frame as today (O4).
  - A visual whose re-decode fails leaves the stage at once and loads again through the normal path (critique_r3 O5),
    once per ended record, found by handle identity; no sprite is ever made from an ended record's handle
    (critique_r4 W1, W2; R5-0).
  - Frames resume when the visible pass of the current revive is done, whatever the executor's chain waits on; an
    aborted or superseded revive never resumes them (critique_r4 O1, O2).
- **Slot and chains (W3).**
  - Runs after LMI. `budget.ts` chain: ... -> LMI -> M2 -> M3c.
  - `client/src/app/game.ts`, which installs the `__novelDebug` hook (PP:5284-5286): L15 -> LMI -> M2.
  - `client/src/scene/controller.ts`: L11 -> L15 (F) -> M2 -> M3c.
  - `client/src/scene/{preload.test,executor.test}.ts`: L11 -> M2 -> M3c (critique_r2 W6).
  - `client/src/scene/executor.ts`: L11 -> M2 (`reacquire`; critique_r3 O5). Only L11 locks it in the plans (PP:4705;
    no other lock in `docs/` names it), and no running lane does (RESUME:27-29).
  - `client/src/scene/{revive-flow.ts,revive-flow.test.ts}`: new in M2 (critique_r4 O1, O2). The arch rules allow a
    pure `scene/` file (`arch.test.ts:152-181`: no Pixi, GSAP or fetch rule is broken).
  - D2's gate gains M2.
- **Lock (14).**
  - `client/src/scene/{loader.ts,registry.ts,registry.test.ts,controller.ts,executor.ts}` (`executor.ts` for
    `reacquire`, critique_r3 O5).
  - `client/src/scene/{revive-flow.ts,revive-flow.test.ts}` (new; critique_r4 O1, O2).
  - `client/src/scene/{preload.test.ts,executor.test.ts}` (critique_r2 W6). Their fakes return `Decoded`
    (`preload.test.ts:63`, `executor.test.ts:156`). They become byte-faithful hosts (critique_r3 W2): `keptBytes` = the
    bytes of the ref they were called with (100 B, the avif fixture, `preload.test.ts:19`, `executor.test.ts:119`),
    `gen` = the harness's current generation when the load settles (1 by default; a test raises it before it calls
    `revive`, as the production `upload` reports the current one, section 9), and a `revive` that resolves ok unless
    a test makes it fail or wait for one id. So `keptMismatch` stays 0, and no admission moves (R4-4). Declared
    assertion moves, per commit:
    - commit 2: the empty baselines `preload.test.ts:120`, `:205` and `executor.test.ts:246` gain `keptBytes: 0,
      keptMismatch: 0`;
    - commit 3: the same three gain `openBitmaps: 0, stale: 0, reviveFailed: 0`.

    The new fields at 0 make these baselines leak checks for the kept Blob, the open bitmap and the revive state. No
    other assertion in the two suites moves: their other registry assertions read `.live` only. `executor.test.ts` also
    gains commit 3a's `reacquire` tests and commit 3b's integration red (it imports `revive-flow.ts`; test files are
    outside the arch scan, `arch.test.ts:834`).
  - `client/scripts/{budget.ts,budget.test.ts}`; `client/scripts/assets/manifest.ts` (re-export of the cap; verify the
    `arch.test.ts` import rules at cut time).
  - `client/src/app/game.ts` (the hook gains the `'hard'` mode and the new stats; at cut time, check whether the hook
    already forwards them, and drop the file if it does).
  - `client/e2e/memory.spec.ts`.
- **Commits.**
  1. Guard e2e `scene: an unrestored context loss rebuilds the stage` (W1), on today's code:
     - reach a line with a bg and a character on stage, and sample the stage;
     - `__novelDebug.forceContextLoss('hard')` (`gl.getExtension('WEBGL_lose_context').loseContext()` called
       directly);
     - the mock's `minimize()` then `restore()` (`mock-transport.ts:230-231`, `visibility_changed`) -> `deactivated`,
       then `activated`;
     - wait `CONTEXT_GRACE_MS` + 1 s;
     - assert `stats().rebuilds === 1` (the branch was entered; a Pixi self-restore would leave it 0), samples at the
       bg and at the character's head equal to the pre-loss ones, and no page error;
     - advance to the next batch that shows an asset not loaded before (the cut names its line ID), and sample it as
       not black.

     It is green on the parent, because the bitmaps are kept today. Its red is seen by mutation and quoted in this
     commit's report: with the rebuild skipped on `activated`, `rebuilds === 0` and the bg sample is black. The hook's
     `'hard'` mode and the `rebuilds` stat land here.
  2. Kept bytes in the caps: `Decoded.keptBytes` and the stats `keptBytes`, `keptMismatch`. The loader keeps the
     fetched Blob in its `Decoded` (dropped on release) and reports `blob.size`; the bitmap stays open until commit 4.
     - Red `registry_caps_count_kept_bytes`: a preload of 32 MiB - 100 B decoded + 200 B file is admitted.
     - Red `registry: a kept blob is counted at its real size`: it is counted at `ref.bytes`, and `keptMismatch` is 0
       (expected 1).
     - Declared moves in `registry.test.ts` (critique_r3 W2). Its fake `decoded()` returns `keptBytes` = the call's ref
       bytes (F = 100 B, the avif fixture, `registry.test.ts:24`), so a record counts `decodedBytes + F` both pending
       and live. R4-4's table lists every moved figure: `registry_caps` (the K5 caps pin, PP:2100) at :114, :116, :118,
       :121, :125, :134, :149, :155; then :167, :171, :172, :194, :250, :273, :282, :290, and the comments :168, :189.
       Every `toEqual` over `stats()` (:99, :125, :155, :194, :229, :250, :273, :282, :290, :294) gains `keptBytes`
       (live records x F) and `keptMismatch: 0`. No admission outcome moves (R4-4).
     - The baselines of `preload.test.ts` and `executor.test.ts` move as stated under the lock.
  3. Revive in the registry, over the fake loader: `Decoded.gen`, `Decoded.revive`, `ReviveEnd`, `current(id)`, and the
     stats `openBitmaps`, `stale`, `reviveFailed`, added at 0 to every `toEqual` over `stats()` in the three suites
     (declared; critique_r3 W2). Until commit 4 the production loader reports `gen: null` and a `revive` that resolves
     ok (today's kept-bitmap path). The default fake of `registry.test.ts` reports `gen: 1`, like the preload and
     executor fakes, so its live rows read `openBitmaps: 0` as R4-4's table declares (critique_r4 O4). Predicted reds:
     - `registry: revive brings every record of an older generation once` -> 0 calls;
     - `registry: revive skips a record uploaded under the current generation` -> 1 call;
     - `registry: revive serves visible holders first` -> the preload-only record (inserted first) revives first;
     - `registry: acquire on a record not yet revived waits for it` -> it resolves before its revive;
     - `registry: a failed revive ends the record and fails its waiting acquire` (critique_r2 O5) -> the record stays
       live, and the waiting acquire resolves ok with the stale texture;
     - `registry: a revive that misses its deadline ends the record` (fake timers; a re-decode that never settles) ->
       `visible` never resolves;
     - `registry: an acquire after a failed revive starts a new record` -> it joins the ended record, with no load
       call;
     - `registry: an aborted revive fails no record` (the `deactivated` path) -> the records are ended as failures;
     - `registry: revive ignores an entry released mid-revive`;
     - `registry: current names a live record's handle and nothing else` (critique_r4 open question 1): `null` while
       pending, the handle once live, `null` after the last release, `null` after a failed revive, and a later record
       of the id has a different handle -> first red `TypeError: h.registry.current is not a function`;
     - `registry: a revived record keeps its handle` (`current(id)` after a successful revive is the handle acquired
       before it) -> a revive that rebuilt the texture object would give a new handle and strand every view;
     - `registry: visible and all settle aborted when the revive is aborted`, by `signal` and by a newer call, and a
       pass that had settled keeps `'done'` (critique_r4 O2) -> against a stub that settles both `'done'` at once;
     - `registry: a revive with no stale record settles done at once` (the `activated` restart, section 9).
  3a. `executor.reacquire()` and the identity rule (section 8; critique_r3 O5, R4-0, critique_r4 W1, W2, R5-0), in
      `executor.ts` and `executor.test.ts`. The harness gains three things, all inside `executor.test.ts`:
      - `failRevive(id)` and `holdRevive(id)`: the fake `Decoded.revive` of that id rejects, or waits for the test;
      - `deferLoad(id)`: the next load of that id waits for the test, a stalled fetch;
      - a `console.error` spy. The chain's catch logs a build that threw (`executor.ts:651-655`), so a throw from
        the recording stage inside `run` shows there, not as a rejected test.

      Records end through commit 3's real `registry.revive(2, signal)`, after the test sets the harness generation
      to 2. The method is new, so every red below first fails with `TypeError: h.ex.reacquire is not a function`. The
      behavioural red, which the tester's mutation reproduces, is in brackets. A different red, an assertion of an
      existing executor test, means the commit changed `enqueue` or `sweep` for the other callers. Reds:
      - `executor: reacquire removes a view bound to an ended record at once`. A bg and a character are shown (cut),
        and the bg's revive fails. Then `reacquire()`: before any await the bg sprite is destroyed, the character's is
        alive, and the call returned `undefined` (critique_r4 O1). [The removal moved inside the enqueued batch: the
        bg sprite is still alive.]
      - `executor: reacquire takes the slot again on a new record`. After a flush the bg is loaded a second time, the
        bg sprite's texture is not in `freed`, and `registry.current('bg/cafe')` is a new handle.
      - `executor: a batch never builds on a handle whose record ended` (critique_r4 W1's red).
        - Setup: `bg/cafe` is live under a test holder. B = `apply([bg('cafe','cut'), show('ally','neutral',null,
          'cut')])`, so B's bg take resolves at once while the ally load is deferred. Cafe's revive fails, then
          `reacquire()`, then the ally load settles, then a flush.
        - Asserted: no `console.error`; the ally sprite is alive; after the re-take the bg sprite's texture is the new
          one; `loadsOf('bg/cafe') === 2`.
        - [Without `handleFor`, as in round 4: `console.error('scene: batch failed', Error('stage: sprite on the
          released texture /assets/bg_cafe.avif'))`, and no ally sprite, because the throw ends B's build before the
          characters.]
        - A different red: the bg shows a freed texture with no throw. That means the recording stage stopped
          checking `freed`.
      - `executor: a fade through black never shows a handle whose record ended at black` (R5-0).
        - Setup: `bg/street` is live under a test holder. `apply([scene('street','fade',800)])`; `advance(100)`;
          street's revive fails; `reacquire()` (it removes nothing: no street sprite yet); `advance(400)`, so the
          midpoint fires; flush.
        - (critique_r5 O1) Right after `reacquire()`, `stats().activeTimelines` is still 1. Before the re-take
          assertion the test advances past S's end (800 ms), so `S.done` settles and the re-take chained behind
          `run(S)` builds.
        - Asserted: no throw, and after the re-take the bg is street on a new texture.
        - [With the check only where `run` collects the takes: `advance` throws `stage: sprite on the released texture
          /assets/bg_street.avif` from the GSAP callback.]
      - `executor: a second reacquire touches nothing` (critique_r4 W2). After the first call, a second one while the
        re-take is pending and a third after it settled. Asserted: `loadsOf('bg/cafe') === 2`, one `destroy:bg:cafe`
        in the log, the bg sprite alive, `registry.current('bg/cafe')` unchanged and `registry.stats().live`
        unchanged. [Views and entries matched by asset id, as in round 4: 3 loads and two destroys.]
      - `executor: reacquire behind a waiting batch removes at once` (the R4-0 case). A batch whose load is deferred is
        queued first, and the shown bg's revive fails. The removal still happens before any await. [The removal moved
        inside the enqueued batch: the bg is alive.]
      - `executor: a waiting take that failed with its record is taken again`. `char/ally/neutral` is live under a
        test holder and its revive is held; B = `apply([show('ally','neutral','left','cut')])` waits on the stale
        record; the held revive rejects, so B skips the ally (`onSkip` gets `decode`). Then `reacquire()`: the ally
        loads a second time and is shown. [`bound` set only on an ok result: no second load and no ally sprite.]
      - `executor: reacquire touches nothing not bound to an ended record` (critique_r4 open question 2). The setup
        has a `bg/broken` visual skipped by its own decode failure, a live character, and a running 200 ms expression
        fade. Asserted: no load call, no destroy in the log, and `stats().activeTimelines` stays 1. [`complete()`
        before the scan: 0 timelines. A re-take of every absent slot: a second `bg/broken` load.]

      - `executor: rebind skips a view whose record ended`. A bg and a character are shown, and the bg's revive fails.
        Then `ex.rebind(<a second recording stage sharing freed>)`: no throw, the new stage holds the character only,
        and a following `reacquire()` shows the bg on the new stage on a new texture, and the character is still alive
        on the new stage after it (critique_r5 O3). [Without the check in `rebind`:
        `rebind` throws `stage: sprite on the released texture /assets/bg_cafe.avif` synchronously.]

      Tester mutations: the removal inside the enqueued batch (the waiting-batch red); `handleFor` dropped at the
      midpoint (the fade red); `rebind` without the check (the rebind red); `complete()` whenever an entry is
      dead-bound (the fade red: `activeTimelines` is 0 right after `reacquire()`; critique_r5 O1). The entry is deleted rather than released
      by id. That is a rule, not a mutation target: while a dead-bound entry exists, no other record of the id holds
      its holder (`take` reuses the entry), so a release by id is a no-op, and a mutation there would be equivalent.
  3b. The revive flow (critique_r4 O1, O2): the new `scene/revive-flow.ts` and `revive-flow.test.ts`, over a fake
      `revive` whose passes the test settles, and spies for `reacquire` and `resume`. First red: the module is missing
      (`Failed to resolve import "./revive-flow.ts"`). Reds:
      - `revive-flow: frames resume when the visible pass is done, before all settles` [`resume` called only after
        `all`];
      - `revive-flow: every settled pass reacquires`: 2 calls for a done revive, and also on `'aborted'` [no call on
        abort];
      - `revive-flow: a superseded revive never resumes frames`. `start(2)`, then `start(3)`; the fake then settles
        visible(2) `'done'` late, ignoring its abort. `resume` runs once, after visible(3). [The token check is
        missing: two calls, the first while revive 3 is stale.]
      - `revive-flow: an aborted revive leaves frames suspended`. `start(2)`, `abort()`: `suspended()` stays true and
        `resume` is not called. A new `start(2)` that settles `'done'` resumes.
      - `revive-flow: lost aborts the current revive` (the second-loss row of section 9) [a `lost()` that only
        suspends: the old revive's `visible` `'done'` resumes frames during the second loss];
      - In `executor.test.ts`, the integration red `executor: with the revive flow, frames resume at the deadline while
        a batch waits on a stalled fetch` (critique_r4 O1). It uses the real registry, the real executor and
        `createReviveFlow`.
        - Setup: the bg is shown; A = `apply([show('ally','neutral','left','cut')])` with the ally load deferred;
          `flow.lost()`, `flow.start(2)`, with the bg's revive held (never settles); `vi.advanceTimersByTime(
          REVIVE_DEADLINE_MS)`; flush.
        - Asserted: `resume` was called once while A still waits. Inside the spy, `registry.stats().stale === 0`, so a
          frame can bind no stale texture (the controller's `staleFrames` stays 0), and the bg sprite is already
          destroyed. No `console.error`. After the ally load settles, the ally and the re-taken bg are on stage.
        - [A `reacquire` that returns its batch's promise, awaited by the flow before `resume`: `resume` is not called
          until the ally settles.]
  4. Loader close-after-upload, controller revive and frame suspension, in one commit. The red is seen on the working
     tree between the halves: with the loader change alone, commit 1's e2e samples a black bg after the rebuild, and
     L15's `context loss recovers` samples a black stage after the restore.
     - The controller drives `createReviveFlow({ revive: registry.revive, reacquire: executor.reacquire, resume })`
       (section 8 A2, Rebuild):
       - the render callback draws only when `!lost && !flow.suspended()`;
       - `webglcontextlost` -> `flow.lost()`; `webglcontextrestored` -> `gen += 1`, then `paused ? flow.lost() :
         flow.start(gen)`;
       - `pause()` (deactivated) -> `flow.abort()`;
       - `activated` with a live context and (`flow.suspended()` or `stale > 0`) -> `flow.start(gen)`. Every point where
         `activated` handling finds the context live, including the end of the grace, applies this same check
         (critique_r5 O2);
       - the rebuild runs `flow.lost()`, install, `gen += 1`, `flow.start(gen)` and the old app's destroy in one
         synchronous block. The block follows the restore rule: when `paused`, it calls `flow.lost()` in place of
         `flow.start(gen)`, and `activated` starts the revive. A rebuild that the grace reaches while deactivated builds
         at once and defers only the revive (RULINGS 78; critique_r5 O2 and its open question 2);
       - `destroy()` -> `flow.destroy()`;
       - `stats().reviving = flow.reviving()`.
     - The commit also adds the e2e `scene: a failed revive re-acquires the visual` (critique_r3 O5). After the first
       line, once `stats().pendingLoads === 0` (so no preload decode can take the failure), the test wraps
       `window.createImageBitmap` from the page so that its next call rejects once (the loader calls the global at call
       time, `loader.ts:33`). Then it runs commit 1's hard loss; the revive's first re-decode is a visible record. The
       test polls, for up to 5 s, until `stats().reviving === false` and `pendingLoads === 0`, so `all` has settled
       and the re-take has finished. Then it asserts: `reviveFailed === 1`, `rebuilds === 1`, both samples equal to
       the pre-loss ones, `openBitmaps === 0`, `stale === 0`. In the request log exactly one image URL was fetched
       twice and none three times (exactly one extra GET; critique_r4 W2), the log is unchanged 500 ms later, and
       there is no page error. The fixture routes every request, which disables the HTTP cache (Playwright
       `page.route`, critique_r4 Sources), so each GET is in the log.
     - Its predicted reds:
       - with the controller calling round 3's `executor.restore(<snapshot without them>)` in place of `reacquire`:
         one sample stays black and no second GET follows;
       - with round 4's id-based `reacquire(ids)` called at both passes: the failed URL is fetched three times,
         because the `all` call removes the healed view and re-takes it.

       A different red, `reviveFailed === 0`, means the wrapper did not reach the decode.
     - M2-cut item (critique_r5 open question 1): the cut checks the parent's request log at commit 1's sample point.
       If any image URL is already fetched twice there, the "exactly one image URL fetched twice" assertion counts GETs
       from a marker taken just before `forceContextLoss('hard')`.
     - Re-locate at cut time: an L15 e2e that asserts the whole `stats()` object with `toEqual` moves with the new
       counters, and its spec then joins this lock with the move declared.

     Tester mutations:
     - `upload` captured at mount: the new asset after the rebuild samples black;
     - frames not suspended until the visible pass: `staleFrames > 0`, plus a page error if the browser throws on a
       closed bitmap (verify the error text);
     - revive started after `requestRender()`: `staleFrames > 0`;
     - the render gate without `flow.suspended()` (only `lost`): `staleFrames > 0` after the rebuild.
  5. Budget.
     - Red `budget: knot-set counts kept encoded bytes`: PASS at 32 MiB - 1 B decoded + 2 B file.
     - Red `budget: room-set counts kept encoded bytes` (O2).
     - Guard `budget: knot-set and room-set limits are the registry steady cap` (critique_r3 O2). It is green on the
       parent: `LIMITS.knotSet = LIMITS.roomSet = 32 * MIB` (`budget.ts:91,112-113`) already equals `STEADY_CAP_BYTES`
       (`registry.ts:9`). Seen red by mutation (`knotSet: 32 * MIB + 1`) and quoted in the commit report, as commit 1's
       e2e is.
  6. e2e `scene: no decoded bitmap outlives its upload`: `stats().openBitmaps === 0` after the first line and after a
     preload settles. Seen red by mutation: skip `close()`.
- **Pins.** Knot-set and room-set rows rise by the kept bytes (placeholders ~0.1 MiB; at the file limits <= 2.2 MiB per
  5-image knot). The registry test figures rise by the kept file bytes, and the `toEqual` stats objects gain the five
  counters (commits 2-3, R4-4; `registry_caps` is K5's caps pin, PP:2100). Everything else byte-identical. This is one
  more reason M1 precedes M2: untrimmed, the busiest knot with real art at the file limits would be 30.4 + 2.15 = 32.5
  MiB, over the gate (ARITHMETIC).
- **Gates.** check, test, build, e2e. Device measurement (section 12) is reported, not gated.

### M3c `memory-half-tier` (client) - after M2
- **Goal.**
  - On a LOW Android phone whose largest stage passes `halfFits`, every **public** scene image loads its half file
    (a char only on the canonical 1536-px canvas; critique_r3 W1): texture bytes x 0.25, layout identical.
  - A LOW tablet and every other device load the full tier.
  - Gated entries keep today's shape until M3s.
- **Public entries, not free manifests.** An id's entry must be identical in every manifest that names it
  (`budget.ts:559-577` conflicts; `assets.test.ts:509` checks `bg/cafe` in ch1 and ch2). So M3c writes `half` on every
  entry with a public file, in free and paid manifests alike, and on no gated entry.
- **Server side.**
  - `AssetProbe` ignores the nested `half` (no `deny_unknown_fields`, `content.rs:351-356`), and `index_assets` skips
    public URLs (`:643-645`). So M3c needs no server change, no cargo and no PostgreSQL slot, and the committed server
    fixtures do not move.
  - `assets: paid manifest keeps the server fixture keys` (`assets.test.ts:542-567`) compares shapes with `half` set
    aside, and gains the assertion that every `half` URL in a paid manifest is public. M3s restores the full
    comparison.
- **Chains.** `budget.ts` ... -> M2 -> M3c; `catalog.ts` L13 -> M1 -> M3c; the asset-tool files M1 -> M3c -> M3s
  (`manifest.ts` M1 -> M2 -> M3c -> M3s); `scene/{registry,registry.test,controller,preload.test,executor.test}.ts`
  M2 -> M3c; `scene/{layout,layout.test}.ts` M1 -> M3c; `memory.spec.ts` M2 -> M3c -> M3s. No `loader.ts`.
- **Lock (15).** `client/scripts/assets/{encode.ts,manifest.ts,assets.test.ts}`, `client/scripts/assets.ts`,
  `client/src/story/catalog.ts`, `client/scripts/{budget.ts,budget.test.ts}`,
  `client/src/scene/{layout.ts,layout.test.ts,registry.ts,registry.test.ts,controller.ts}`,
  `client/src/scene/{preload.test.ts,executor.test.ts}`, `client/e2e/memory.spec.ts`.
  - The two suites are here because `createAssetRegistry`'s `tier` is required (critique_r2 W6): each fake gains
    `tier: 'full'`. That change is declared, and the assertions do not change.
  - `loader.ts` is out: M1's loader already forwards `geometry.resolution`.
  - Its doc rows go to M3s.
- **Reds** (predicted red in brackets):
  - `catalog: half tier decodes` [unknown key];
  - `catalog: a half that is not exactly half its file is an error value` (233 x 698 under a 466 x 1394 file) [it
    decodes];
  - `encode: the half of a trimmed placeholder is its 2 x 2 average` (critique_r2 W5). It runs on
    `char/stranger/neutral` as `placeholder.ts` draws it, through M1's trim, and asserts: `half.w x 2 = w` and
    `half.h x 2 = h`; every half pixel is the premultiplied mean of its 2 x 2 block (+-1 per channel for rounding);
    alpha 0 on every border row and column of the half that is not at the canvas edge; the planned pair passes the
    decoder's exact-halving rule, because `planAssets` decodes every manifest it plans and throws otherwise
    (`manifest.ts:314-317`) [no output];
  - `budget: a half whose LOW count exceeds its full count fails` (half files inflated in a fixture) [PASS];
  - `budget: a half file over its kind's file limit fails` [PASS];
  - `layout: half tier keeps the canvas and the full trim rect at resolution 0.5` [canvas 233 x 697, trim null];
  - `layout: no decodable half is drawn above its stored px` (W2; critique_r3 W1). Candidates, each decoded as a
    one-entry manifest by `decodeAssetManifest`: the bg 1080 x 2048 with its half; a char on the canonical 768 x 1536
    canvas (stored 466 x 1394, half 233 x 697); a char on a 600 x 1200 canvas (stored 400 x 1100, half 200 x 550); an
    untrimmed char on 768 x 1024 (half 384 x 512). For every candidate that decodes with a `half`, every stage 320-1280
    x 480-2048 CSS px (step 8) and r in {1, 1.5, 2} where `tierFor('LOW', stage, r)` is `half`, the device px per
    canvas px stay <= 0.5 (bg: `cover(stage, ROOM_SOURCE).scale x r`; char: `min(0.78 x H x r, c) / c`).
    Non-vacuity: the bg and the canonical char decode with `half`, and the half tier occurs (360 x 800 at r = 1). The
    char term's band also occurs: stages where the bg term holds and 0.78 x H x r > 768, i.e. 984.6 < H x r <= 1024.
    That is 140 stages at r = 1 (H 992-1024, W 320-536) and 18 at r = 1.5 (H 664-680, W 320-360). There is none at
    r = 2, because W x 2 >= 640 > 540 for every W of the grid, so the bg term already fails there. Each band stage
    must give `full`. A char term loosened to any value above 768 is red there; e.g. 360 x 1000 at r = 1 has bg scale
    0.488 and char 780 / 1536 = 0.508 (critique_r4 O3). [Red
    on round 3's design: the 600 x 1200 candidate decodes, and at 360 x 800, r = 1 it is drawn at 624 / 1200 = 0.52,
    above 0.5 per canvas px. Red on round 1's perf-only rule: the bg at 720 x 1280, 1.33 x.] The test imports the
    decoder: test files are outside the arch scan (`arch.test.ts:834`);
  - `catalog: a char half off the 1536-px canvas is an error value` (the 600 x 1200 candidate) [it decodes];
  - `assets: a char on a canvas shorter than 1536 px gets no half` (the asset tool's half rule and the encoder on a
    600 x 1200 RGBA source built with sharp in the test; the asset CLI admits placeholders only, `assets.ts:130`) [the
    entry carries `half`];
  - `layout: a LOW tablet keeps the full tier` (an 800 x 1280 screen -> `full`) [`half` on the perf-only rule];
  - `layout: a LOW 360 x 800 phone takes the half tier`;
  - `layout: a screen of unknown size takes the full tier`;
  - `layout: tierFor takes the half tier only for LOW` (AVERAGE and HIGH at 360 x 800, r = 1 -> `full`; critique_r3
    O1) [`half` on a class-blind `tierFor`];
  - `registry: a LOW registry counts the half file` [counts 4.5 MiB];
  - `registry: demote applies to records started later` [the live half record is reloaded];
  - `assets: a paid manifest names no gated half file` [a gated `half` on `bg/archive`];
  - e2e at `deviceScaleFactor: 2` (the AVERAGE control at 1, below) with `screen` set explicitly, through `test.use`
    inside a `test.describe` (critique_r2 W7, O9). At Playwright's default DPR 1, LOW and HIGH render at the same
    resolution 1:
    - `scene: a LOW phone loads half-tier files` (viewport 360 x 740, screen 360 x 800, LOW UA) [the request log shows
      full files].
      - It also samples the trimmed character at M1's CSS points, under M1's sample rule (>= 4 CSS px from every edge,
        +-12 per channel; critique_r3 open question 2). That proves that the half tier lays out as the full one on the
        real Pixi at resolution 0.5 (I4).
      - A red here while `layout: a LOW 360 x 800 phone takes the half tier` is green means that the class or the
        resolution does not reach `tierFor` in the controller. At r = 2, `halfFits(360 x 800, 2)` is false
        (W x 2 = 720 > 540).
    - `scene: an AVERAGE phone at DPR 1 loads full-tier files` (viewport 360 x 740, screen 360 x 800, the default UA,
      `deviceScaleFactor: 1`; critique_r3 O1). At DPR 1 an AVERAGE session renders at resolution 1
      (`layout.ts:18-23`), where `halfFits(360 x 800, 1)` holds (360 <= 540, 800 <= 984). So only the class conjunct
      keeps the full tier: the test is red on a `tierFor` that ignores the class and on a controller that passes a
      constant `'LOW'`. Round 3's control ran at DPR 2, where `halfFits` is false, so it could not be red;
    - `scene: a LOW tablet loads full-tier files` (viewport 800 x 1180, screen 800 x 1280).
- **Seen working (W4: the quality check is the tester's).** Side-by-side screenshots, full vs half, at 360 x 800, DPR
  2, with a LOW UA (and on a LOW Android in Telegram when one is available), judged for halos, banding and softness on
  character outlines and backgrounds. Both screenshots go into the lane report.
- **Gates.** check, test, story, build, e2e. No cargo.

### M3s `memory-half-paid` (server slot) - after M3c, after L9 (the end of the server chain) and after D2
- **Goal.** Gated image entries of paid manifests carry `half`. The server indexes those files under the chapter's
  product and serves them only after the entitlement check. LOW phones get the half tier of paid art.
- **Why one server-slot lane, after M3c (W3, O7).**
  - The paid manifest's shape is pinned to the committed server fixtures (`assets.test.ts:542-567`), and the server
    needs every file a fixture names on disk (`content.rs:660-670`). So the planner's gated branch, the server index
    and the fixtures change together, and that needs cargo and the PostgreSQL slot.
  - The client decoder already knows `half` (M3c), so `catalog: asset manifest decodes the server fixtures`
    (`assets.test.ts:312-327`) stays green when the fixtures gain it.
  - After L9 it delays no planned server lane, because the server chain has ended (PP:2620-2621).
  - Round 1's "new fixture chapter" is dropped. A chapter exists for the server only through the shared
    `stories.json` (O7); negative cases use `FixtureCopy::edit_json` (`server/tests/it/content.rs:72-77`).
- **Chains.**
  - `server/src/content.rs`: L6b -> LM2 -> M3s (PP:2588).
  - `server/tests/it/content.rs`, `server/tests/fixtures/content/chapters/{ch2,ch4}/assets.json`: -> M3s.
  - The asset-tool files and `memory.spec.ts`: ... -> M3c -> M3s.
  - `docs/FEATURE_MAP.md`, `docs/ARCHITECTURE.md`: D1 -> D2 -> M3s. M3s writes the M3c and M3s rows.
- **Lock (13).** `server/src/content.rs`, `server/tests/it/content.rs`,
  `server/tests/fixtures/content/chapters/{ch2,ch4}/assets.json`, 4 fixture files
  `server/tests/fixtures/content/assets/<bg half name>.{avif,webp}` (named by M3c's `assetFileName` token),
  `client/scripts/assets/{manifest.ts,assets.test.ts}`, `client/e2e/memory.spec.ts`, `docs/FEATURE_MAP.md`,
  `docs/ARCHITECTURE.md`.
- **Reds** (predicted red in brackets):
  - `content: half-tier gated file is served to an owner` [404];
  - `content: half-tier gated file is refused without the entitlement` (the existing gated rule);
  - `content: a manifest naming a missing half file fails to load` [it loads: `half` is not read];
  - client `assets: paid manifest keeps the server fixture keys`, with the M3c exclusion removed [the `image` key lists
    differ by `half` until the gated branch writes it];
  - e2e `scene: a LOW phone loads half-tier files of a paid chapter` (after the mock purchase; DPR 2 and `screen` set,
    as in M3c) [full files in the request log].
- **Gates.**
  - server: cargo fmt, clippy, test (slot-B PostgreSQL);
  - client: check, test, build (the paid `transfer <ch> (half)` rows appear);
  - e2e with a server-dev built in the lane.

## 12. Budgets and validation

- JS: M1-M3 add < 1.5 KB brotli to the engine chunk (geometry + revive + the revive flow and the identity checks +
  `halfFits`; an estimate, which the build's per-chunk row reports). No new dependency. No change to the
  all-JS row (`LIMITS.allJsBr`: 290,000 B on main, `budget.ts:102`; 305 KB after LMI, PP:2235). E would add a
  transcoder (rejected).
- First-load / per-chapter transfer:
  - M1: ~0 (quoted by the lane); M2: 0;
  - M3c adds the `transfer <ch> (half)` rows (6 MB) and keeps the first-load row on the full tier (worst case);
  - M3s moves the paid `(half)` rows to gated halves.
- Memory:
  - knot-set and room-set <= 32 MiB (kept bytes counted from M2); registry caps 32/48;
  - e2e `textures released on chapter change` and `heap under budget` unchanged;
  - new e2e: `scene: no decoded bitmap outlives its upload`, `scene: an unrestored context loss rebuilds the stage`,
    `scene: a failed revive re-acquires the visual`, `scene: a LOW phone loads half-tier files`, `scene: an AVERAGE
    phone at DPR 1 loads full-tier files`, `scene: a LOW tablet loads full-tier files`, `scene: a LOW phone loads
    half-tier files of a paid chapter`. Every tier e2e runs at DPR 2 with `screen` set (critique_r2 W7, O9), except
    the AVERAGE control, which runs at DPR 1 to isolate the class check (critique_r3 O1);
  - L15: `scene: a LOW perf class renders at resolution 1` and its control `scene: an AVERAGE perf class at DPR 2
    renders at resolution 2`, both at DPR 2 (4.F).
- Each new gate is seen failing: the budget reds above, plus three `node scripts/budget.ts` runs on synthetic inputs.
  Each run asserts its row and note, not only exit 1 (critique O10; PP:2259-2263 pattern):
  - a trimmed bg -> the CLI decodes each manifest first, the decoder refuses `trim` on a bg, so the `asset inputs` row
    FAILs naming it and that chapter's knot-set rows are absent (M1);
  - a half that is not exactly half its file -> the decoder refuses it the same way: the `asset inputs` row FAILs naming
    the entry, and that chapter's knot-set rows are absent (M3c; critique_r2 W5);
  - a half whose LOW count exceeds its full count -> the `image <id>` row FAILs with the I2 note (M3c).
- **Device measurement protocol** (before any cap change; results go to OPEN-QUESTIONS and the PP revision; devices
  and deployment: owner Q-M5).
  - Devices: a LOW Android (UA class LOW), an AVERAGE/HIGH Android, an iPhone at the iOS 16.4 floor, a current iPhone,
    Telegram Desktop on Windows.
  - Method: deltas measured in the platform browser against the test deployment, which runs the same engine as the
    WebView (Chrome remote inspector + `adb shell dumpsys meminfo` on Android, the Safari Web Inspector memory
    timeline on iOS; verify both tools' process attribution), plus one confirmation run inside Telegram per platform.
  - Metrics:
    - process memory at boot, at the first line, at the busiest knot and during a crossfade, M2 off vs on (parent vs
      head build);
    - on iOS, the WebContent and GPU process footprints separately, and their sum, at the same points (critique_r2 open
      question 2; WebKit charges a page's GPU-process memory to the page, bugs.webkit.org 256703 comment 7). verify:
      Instruments' Activity Monitor on a tethered iPhone lists `com.apple.WebKit.WebContent` and
      `com.apple.WebKit.GPU` for Telegram's web view. After any kill, record the JetsamEvent report's reason (bug
      256703 cites `per_process_limit`) and the process it names;
    - the visible revive after a hard loss, threshold 500 ms on the LOW Android (4.A); it also sets
      `REVIVE_DEADLINE_MS` (4.A);
    - the `texImage2D` of one 1080 x 2048 texture, threshold 33 ms (4.A);
    - `createImageBitmap` of one 1080 x 2048 AVIF (also PZ X13's open verify);
    - `screen.width/height` and `devicePixelRatio` on the LOW device (4.C);
    - for C, side-by-side screenshots.

## 13. Integration

- docs/FEATURE_MAP.md and docs/ARCHITECTURE.md (critique W3; PP:2573 "D1, D2 only" becomes the chain D1 -> D2 -> M3s):
  - **D2** writes the M1 and M2 rows: "image trimming -> `client/scripts/assets/encode.ts`", "texture geometry
    (orig/trim/tier) -> `client/src/scene/layout.ts`", "context-loss revive -> `client/src/scene/registry.ts`
    (records), `client/src/scene/revive-flow.ts` (frames), `client/src/scene/executor.ts` `reacquire` (the stage)". D2's
    gate gains M2; M1 precedes LMI, which precedes D2.
  - **D2's story-authoring guide** gains the rule "the expressions of one character share one canvas, and every char
    and prop canvas has even sides" (critique open question 2; critique_r2 W5), which M1's asset tool enforces. It also
    gains the guidance "deliver every character on the canonical 768 x 1536 canvas": a smaller canvas gets no half
    tier and changes the character's size relative to a canonical one between devices (4.C, character canvas rule;
    critique_r3 W1). Guidance, not a gate.
  - **M3s**, after D2, writes the half-tier rows: "half tier -> `tierFor` in `client/src/scene/layout.ts`", "paid half
    files -> `server/src/content.rs`".
- docs/STAGING-DSL.md: no change (A/B/C); D adds a section 8 note.
- **One owner per PROTOTYPE-PLAN section (W3).** The memory design branch's PP revision ("Changed by MEMORY-PLAN"
  entries, RULINGS 65, before M1) owns every PP text this design changes. No M lane edits `docs/PROTOTYPE-PLAN.md`; a
  cut that must deviate records it in carry.md for the next revision, as today. The sections:
  - the targets (PP:64-70: the steady figure per lever);
  - K5 (:197-225: kept bytes, revive; `registry_caps`' figures rise by the kept file bytes, critique_r3 W2) and K9
    (:259-289: the gate counts file bytes);
  - "Registry and loader" and "Memory estimate" (:2105-2118); "Steady total" (:2120-2132);
  - the concurrency table's context-loss rows, the controller's D13 note, the executor's `reacquire()` and identity
    rule (PP:2055 "Executor"; critique_r3 O5, critique_r4 W1, W2), and the revive flow (critique_r4 O1, O2);
  - "Budgets and validation" rows :2246 (sprite dims on the canvas), :2249 (+ file bytes), :2250 (+ the half transfer
    rows), :2253;
  - the lock chains: :2556 `catalog.ts`; :2568 / :2612 `budget.ts`; :2573 the two docs; :2588 `content.rs`; the
    asset-tool files (`manifest.ts` with M2); `client/src/scene/*`, including `{preload.test,executor.test}.ts`
    (L11 -> M2 -> M3c); the new `client/e2e/memory.spec.ts`; `client/src/app/game.ts` (L15 -> LMI -> M2);
  - the L15 entry (:5267-5270: + `controller.ts`, F, its red and its control at DPR 2), recording F as merged when it
    reached L15 through its brief first (section 14 item 1);
  - the dependency-order table (:2692-2694: + M1, M2, M3c, M3s; LMI's gate + M1; D2's gate + M2) and the launch
    preference (:2703-2704).

## 14. Open questions

**Engineering (for the orchestrator/critic; recommendation given).**
1. F belongs to L15. Add `mount(host, { dpr, perfClass, fetchAsset })`, `client/src/scene/controller.ts` to L15's
   lock (14 -> 15) and the LOW-UA e2e red with its control, both at DPR 2 (4.F), to L15's cut now. Recommended: yes (a
   known gap; M3c depends on the signature).
   - **Timing** (critique_r2 open question 1). F goes into **L15's brief directly**: the orchestrator writes it as a
     carry.md entry when it briefs L15, and L15's cut takes it from there. The memory PP revision does not gate L15's
     cut. It lands before M1, records F as merged, and quotes L15's merge sha.
   - Why: L15 is the second client launch from now (RESUME:56: N2, then L15), while the PP revision waits for this
     design's critique loop. Gating L15 on the revision would delay the whole client chain for one hunk; leaving F out
     of L15 would lose it, as the critique notes.
   - The cost: L15's cut is checked against this section, not against a merged PP text.
   - **Recorded at adoption** (RULINGS 78): F went to L15 through its brief (L15 spec item 3, RULINGS 76) and is in
     L15's running cut; L15 is not merged. Item 7's helpers line goes into L15's resume note (RULINGS 78).
2. Slotting (critique W3): L15 -> M1 -> LMI -> M2 -> M3c -> M3s.
   - LMI's gate gains M1, D2's gate gains M2, and M3s runs in the server slot after L9 and D2.
   - The chains are in section 11 and the one PP owner in section 13. Recommended: yes.
3. Kept Blob bytes inside the caps and the gate (honest invariant; costs <= ~2.2 MiB of gate headroom per 5-image knot
   with real art at the file limits) rather than only in the steady-total table. Recommended: inside (the critique's
   open question 3 accepts either).
4. Placeholder labels are wider than the body and inflate trimmed widths: do not tune placeholders to flatter the gate;
   real art decides. Recommended: leave placeholders as they are.
5. A cap raise to 48/64 MiB only after M2's device measurement, as its own PP decision. Recommended: yes.
6. Revive and upload latency (critique O4). If the visible revive exceeds 500 ms, or one upload exceeds 33 ms, on the
   LOW Android, a follow-up lane either keeps visible records' bitmaps or defers preload uploads, whichever threshold
   is exceeded. Recommended: measure first (section 12); do not pre-build either.
7. The e2e helpers M1 needs (critique_r3 open question 1). `client/e2e/helpers.ts` is in L15's lock (PP:5269-5270) and
   on the L15 -> LMI chain. At main it exports `boot`, `events` and the `test` fixture only (`helpers.ts:46-93`).
   - Recommended: the orchestrator adds one line to L15's brief, beside F (item 1): "export the helpers that reach a
     line and read a stage-canvas pixel, which `context loss recovers` needs, from `client/e2e/helpers.ts`". M1 then
     imports them, and its lock stays 13.
   - Fallback, if L15's merged tree keeps them inside `perf.spec.ts`: M1's cut adds `helpers.ts` (lock 14) and writes
     them there. `perf.spec.ts` is not edited; its private copies go to carry.md for LMI.
   - Rejected: copies inside `memory.spec.ts`. Two samplers can disagree on the read-back, and M1's tolerance (+-12)
     is defined against one.

**OWNER (values/scope), each with a default.** Recorded in [docs/OPEN-QUESTIONS.md](OPEN-QUESTIONS.md) on main
`22ed4d5`: Q-M1 is **Q52**, Q-M2 is **Q53** and Q-M5 is **Q54**.
- **Q-M1** layered art and expression count. Default: a flat PNG per expression, <= 6 per character, no layering.
  Either way, the expressions of one character are drawn on one canvas at one framing, and every char and prop canvas
  has even sides: M1's asset tool refuses mismatched canvases and odd sides, two rules for the Q2 art brief (critique_r2
  W5). The brief also asks for the canonical 768 x 1536 character canvas (guidance, section 13; critique_r3 W1).
- **Q-M2** idle blink / mouth animation. Default: none.
- **Q-M5** the devices and the deployment for the memory measurement: a LOW-class Android phone, an iPhone on iOS
  16.4-17, and an HTTPS test deployment that Telegram opens. Default: measured once Q21 (hosting) is decided, on the
  owner's own phones. Until then the caps stay 32/48, and no lever waits for it.
- **Withdrawn** (critique W4; engineering decisions recorded in 4.C and 4.G): Q-M3 (the half tier: adopted where it
  never up-samples) and Q-M4 (the 1440 tier: rejected).

## 15. Readiness checklist

- [x] Goal names budget and correctness targets; each decision has why / alternatives / trade-off.
- [x] TS + Rust types for the one moving JSON (manifest); one decoder (`catalog.ts`); server probe change named.
  SQL: N/A (no persistent state). Endpoints: N/A except M3s's index (auth, `private, no-store` unchanged).
- [x] DSL: no new tags; D keeps expressions as the authoring unit. Line IDs: N/A (no new lines).
- [x] Payments/grant: N/A. Paid art: no gated half file is named before the server serves it (M3s changes the gated
  branch, the index and the fixtures together); every new gated file is fingerprinted (`manifest.ts:286-289`); the
  kept Blob is never given a URL; scan-dist unchanged.
- [x] WebView: context check on `activated` kept and extended (revive); no Service Worker, `window.open`, `alert`.
- [x] Textures <= 2048 px; resolution <= 2x DPR (LOW 1 via F); a release point per texture, bitmap and Blob; peak and
  steady memory estimated per lever.
- [x] Context loss (restorable and unrestored), double loss, rebuild, a load during the rebuild, release mid-revive,
  a revive failure (re-acquired once per ended record by handle identity, also behind a waiting batch and at a fade's
  midpoint; no sprite on an ended handle), a revive past its deadline, `deactivated` during a revive, a restore while
  deactivated, an aborted or superseded revive (never resumes frames), token expiry, story update, perf class absent,
  `screen` unknown, a stage that grows: outcomes stated. Duplicate webhook / double tap: N/A.
- [x] Red-first per commit with predicted reds; test names; budget numbers the build gate enforces; each new gate seen
  failing; every DPR-dependent e2e runs at DPR 2 with a control, and the class control at DPR 1 (critique_r2 W7,
  critique_r3 O1); every type change names the test files it touches and their lock (critique_r2 W6), and every
  assertion it moves with the new value (critique_r3 W2).
- [x] I6 holds for every half file the decoder admits, for every canvas DIMS allows (critique_r3 W1); a sweep over
  decoded candidates pins it.

## Sources (read 2026-11-02 unless noted)

- `D:/tmp/novel-orch/design/memory/research_R1-compressed-textures.md` (MR1), `research_R2-size-tiers-trim.md` (MR2),
  `research_R3-layered-sprites.md` (MR3); `D:/tmp/novel-orch/design/research_R1.md` section 6, `research_R3.md`
  sections 4.1-4.5; `D:/tmp/novel-orch/carry.md:82-83, :584-585`; `D:/tmp/novel-orch/RULINGS.md` 65.
- PixiJS v8.22.0 source (DOCUMENTED):
  https://raw.githubusercontent.com/pixijs/pixijs/v8.22.0/src/rendering/renderers/shared/texture/sources/TextureSource.ts
  (`defaultOptions.autoGarbageCollect: false`; `resource` public field; `update()`, `unload()`);
  https://raw.githubusercontent.com/pixijs/pixijs/v8.22.0/src/rendering/renderers/shared/GCSystem.ts (defaults
  `gcActive: true, gcMaxUnusedTime: 60000, gcFrequency: 30000`; `if (isRecentlyUsed || !resource.autoGarbageCollect)
  return;`; sweep in `postrender`);
  https://raw.githubusercontent.com/pixijs/pixijs/v8.22.0/src/rendering/renderers/gl/texture/GlTextureSystem.ts
  (public `initSource`; `contextChange` -> `_managedTextures.removeAll(true)`; lazy `_initSource`);
  https://raw.githubusercontent.com/pixijs/pixijs/v8.22.0/src/rendering/renderers/gl/context/GlContextSystem.ts (round 2:
  `forceContextLoss` = `loseContext()` + `_contextLossForced = true`; `handleContextLost`: `preventDefault()`, then
  `restoreContext()` on a `setTimeout` only `if (this._contextLossForced)`; `get isLost()` = `!this.gl ||
  this.gl.isContextLost()`);
  https://raw.githubusercontent.com/pixijs/pixijs/v8.22.0/src/rendering/renderers/autoDetectRenderer.ts (round 2:
  `renderPriority = ['webgl', 'webgpu', 'canvas']`, the preference first); GpuTextureSystem public `initSource` per
  critique_r1's source list (v8.22.0, read 2026-11-02).
- Web standards (round 2): https://registry.khronos.org/webgl/extensions/WEBGL_lose_context/ ("The context will remain
  in the lost state according to the WebGL specification until restoreContext() is called");
  https://drafts.csswg.org/cssom-view/ (Screen `width`/`height` = the "Web-exposed screen area"; section 2.1 "All
  coordinates and dimensions ... are in CSS pixels"; section 2.3 lists the viewport as a possible exposed value).
- Round-2 repo reads (main @ f53755b): `client/src/scene/controller.ts:187-257,265,282-299,389-395`;
  `client/src/scene/registry.ts:89-95,183-211,236-241`; `client/src/scene/preload.ts:10`;
  `client/src/scene/executor.ts:679-739`; `client/src/geom/cover.ts:14,25-28`; `client/scripts/budget.ts:95-121,
  162-168,559-587,666-759`; `client/scripts/assets/assets.test.ts:283-327,401-420,505-567`;
  `server/src/content.rs:343-361,627-682`; `server/tests/fixtures/content/` (tree; `chapters/{ch2,ch4}/assets.json`);
  `client/e2e/` (tree), `client/e2e/fixtures/telegram-web-app.js:397-405`; `docs/PROTOTYPE-PLAN.md:58-70,1486-1500,
  2100-2132,2235,2240-2255,2540-2629,2660-2704,5147-5154,5267-5376,5387-5466`; `docs/STORIES-PLAN.md:64,1085`;
  `docs/META-PLAN.md:75,1817`; `D:/tmp/novel-orch/RESUME.md:23-30,53`; `D:/tmp/novel-orch/RULINGS.md` 35 (:373-390),
  65 (:1238-1251).
- Round 3 (read 2026-11-02):
  - TypeScript handbook, "Type Compatibility", "Comparing two functions"
    (https://www.typescriptlang.org/docs/handbook/type-compatibility.html): `y = x; // OK` for `x = (a: number) => 0`
    and `y = (b: number, s: string) => 0`, because "ignoring extra function parameters is actually quite common in
    JavaScript" (DOCUMENTED);
  - Playwright: https://playwright.dev/docs/api/class-testoptions (`deviceScaleFactor` "Defaults to `1`"; `screen`
    "Is only used when the testOptions.viewport is set"; `userAgent`; "with test.use() you can override some options
    for a file") and https://playwright.dev/docs/api/class-test#test-use ("`test.use` can be called either in the
    global scope or inside `test.describe`") (DOCUMENTED);
  - WebKit: https://bugs.webkit.org/show_bug.cgi?id=256703 (2023-05: comment 7 "WebKit assigns the cost GPU process
    memory for a tab to the tab itself"; comment 0 cites jetsam reason "per_process_limit") and
    https://bugs.webkit.org/show_bug.cgi?id=253172 (2023-03: iOS 16.4 beta WebGL regression; "com.apple.WebKit.GPU
    quickly growing in memory usage", "the WebContent process jetsams"; fixed by an ANGLE update). These are engineer and
    reporter statements in a bug tracker, not specifications;
  - Apple Developer Forums, "WKWebView memory budget" (https://developer.apple.com/forums/thread/133449, 2020): an
    Apple engineer, "It is not possible to increase the limit" and "'The memory limit' is not a set number. It depends on
    things like total device RAM, current system load, etc." (a statement, not a measurement).
  - Repo (main, `.git/HEAD` = `ref: refs/heads/main`): `client/src/scene/registry.ts:5-34,82-181,231-258`;
    `client/src/scene/loader.ts:17-58`; `client/src/scene/preload.test.ts:56-80`; `client/src/scene/executor.test.ts:
    139-167`; `client/src/scene/layout.ts:7-41`; `client/src/scene/controller.ts:69-73,184-309`;
    `client/src/telegram/{perf.ts:1-13, webapp.ts:68,112,249,349}`; `client/e2e/playwright.config.ts:29-66` (no
    `perf.spec.ts` yet: L15 writes it); `client/scripts/assets/{encode.ts:1-30, placeholder.ts:12-19,36-94,
    manifest.ts:98,200-330}`; `client/scripts/budget.ts:69-113,155-168,555-759`; `client/src/story/catalog.ts:709-814`;
    `docs/PROTOTYPE-PLAN.md:714-737,4705-4706,5267-5311`; `D:/tmp/novel-orch/RESUME.md:31,56`;
    `design/memory/research_R1-compressed-textures.md:250-251,388-389`.
- Round 4 (read 2026-11-02):
  - Vitest, https://vitest.dev/api/expect (DOCUMENTED): "`toEqual` asserts if actual value is equal to received one or
    has the same structure"; "`toMatchObject` asserts if an object matches a subset of the properties of an object".
  - Repo (main @ f53755b design base; tree read at 946e2b5): `client/src/scene/layout.ts:7-41`;
    `client/src/scene/registry.ts:1-291`; `client/src/scene/registry.test.ts:1-296`;
    `client/src/scene/preload.test.ts:1-125,205`; `client/src/scene/executor.test.ts:100-260`;
    `client/src/scene/executor.ts:200-370,560-760`; `client/src/scene/controller.ts:180-360`;
    `client/src/scene/loader.ts:1-73`; `client/src/story/catalog.ts:709-820`; `client/src/geom/cover.ts:1-41`;
    `client/scripts/budget.ts:60-121,159-168,596-602`; `client/scripts/assets/{encode.ts:1-30,manifest.ts:190-330}`;
    `client/scripts/assets.ts:126-131`; `client/src/arch.test.ts:595-619,834,863`; `client/e2e/helpers.ts` (exports);
    `docs/PROTOTYPE-PLAN.md:212,1375-1379,1688-1695,2246,4705,5265-5340`; `D:/tmp/novel-orch/RESUME.md:1-80`;
    `D:/tmp/novel-orch/RULINGS.md:373-390`.
- Round 5 (read 2026-11-02):
  - GSAP, https://gsap.com/docs/v3/GSAP/Timeline/progress() (DOCUMENTED): `suppressEvents` "(default = `false`)": "If
    `true`, no events or callbacks will be triggered when the playhead moves to the new position". So `complete()`
    (`progress(1)`) fires a fade's midpoint callback, which must check its handle (R5-0).
  - PixiJS v8.22.0 `Texture.ts`, `Sprite.ts`, `SpritePipe.ts`, `Batcher.ts` and the Playwright `page.route` note, as
    quoted in `design/memory/critique_r4.md` Sources (not re-fetched).
  - Repo (main @ a9e991c, read from `.git/refs/heads/main`; the scene files match the line numbers the critique cites
    at 946e2b5): `client/src/scene/executor.ts:1-790`; `client/src/scene/registry.ts:1-291`;
    `client/src/scene/executor.test.ts:1-270`; `client/src/scene/preload.ts:90-161`;
    `client/src/scene/controller.ts:180-400`; `client/src/arch.test.ts:140-189`; `client/src/geom/cover.ts:14`;
    `docs/PROTOTYPE-PLAN.md:1618-1642` (GameSession: `ensure`, then `scene.apply`).
