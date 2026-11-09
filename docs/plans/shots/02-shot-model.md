## 2. THE SHOT MODEL

### 2.1 Anatomy of a shot (all coordinates in plate px, origin top-left of the plate)

| Element | Source | Runtime node (inside the shot root = bg anchor) | Drawn or motion (CH D27) |
|---|---|---|---|
| **Plate** | `plate.png` = the original with every cut-out region inpainted away | `Mesh` on a 25 x 47 `PlaneGeometry` (SH8); a sprite in SH4-SH7 | drawn |
| **Depth layers** | `depth.png` (16-bit, DA3 Mono-Large or Blender Z) -> 13 x 24 u8 grid in the rig, normalised to `n ∈ [0, 1]`; optional `mask.plane.<n>.png` planes with a declared depth and `front: true / false` | vertex displacement (plate); a sprite or mesh per plane: back planes in the shot root, front planes in the shot's front root above props (S13) | planes: drawn |
| **Cast slots** (per character, cast order = back to front) | `mask.head.<char>.png` (head region, SAM 3; R1's bound); rest states on the plate: `<char>.half.png`, `<char>.closed.png`, `<char>.talk<n>.png`, `<char>.accent.png`; per non-rest expression `x`: `<char>.<x>.png` (on the plate) and, where `x` changes that box, `<char>.<x>.half.png`, `.closed.png`, `.talk<n>.png`, `.accent.png` (on `x`); `mask.fig.<char>.png` (figure mask, for the weight field); `mask.hair.<char>.<n>.png` | per character a **head node** (the plateau affine, S17) holding: the expression layer of `x`, then one motion layer each for blink, talk and accent (pairwise disjoint boxes, R2), then its hair locks; a `figure` plane parents its head node | rest face: in the plate (nothing to draw); non-rest expression layer: drawn; blink / talk / accent: motion; hair locks: drawn |
| **Props and state layers** | world data (`PropPlacement {prop, rect, at}`, GM2a / GM3b), catalog props and **loop props** (`prop.<id>.loop`, W10) | prop anchors inside `world`: `anchor > depth > motion > content` (S13, m9); a loop prop's frames stepped by an `AmbientSource` | drawn (today's rule); a loop prop: motion |
| **Ambient layers** | `shot.json` `ambient[]` (flicker mask, frame loop, particle preset, plane sway), each `z: back | front` | `AmbientSource`s (SH9); frames from the sheet | motion |
| **Camera framings** | `shot.json` `focus` (the crop centre inside `cover()`'s slack; rooms: ignored, centred); `cam:` tags; the parallax drive | the `world` container's transform | - |

**View kinds per cast member:**
- `face`: the face is visible, so face states can change.
- `back`: the back or the shoulder in an OTS. Hair locks only; no face states.
- `figure: true`: the whole figure is also cut out as a plane, needed only by `anim: hop | bounce` (S6, §3.3).

**Required of every cast member** (rev. 3, W4; Q53 rules L1 + L2 on every character, `docs/OPEN-QUESTIONS.md:60`):
`mask.fig.<char>` (the breathing and sway input), at least one `mask.hair.<char>.<n>` (any soft element hanging from
the head or shoulders: hair, a ribbon, a scarf end) and, for a `face` member, `mask.head.<char>`. The art list lists
them (§3.5) and R9 (§4.3) fails a shot that lacks one, so hair never moves only "where the owner remembered".

Every `face` cast member ships the full set whatever its size on screen (S30, rev. 2 C1): blink and accent in every
expression it shows, talk mouths in every expression it speaks in. A small face costs the same inpaint steps
(CropAndStitch crops and upscales the masked region before inpainting, S2 [I1]) and a few KB.

### 2.2 How a scene groups shots

- `scene: <shot>` opens a scene:
  - the faces in effect reset to each cast member's `rest`;
  - the camera resets to rest; cg and props clear (today's `scene` semantics, `client/src/scene/executor.ts:148-154`).
- `bg: <shot>` cuts inside the scene: faces persist (S4); the camera resets to the new shot's rest framing.
- A scene's shots share a `loc` (shots.json). A cut to another `loc` without `scene:` is W `shot/loc-change`.
- The 180-degree rule is the owner's art concern, not linted: the art list prints each location's setups in order.
- **Chapter entry** (rev. 2, critique question 1): every chapter's first step starts on the empty stage. A chapter
  handover restores `EMPTY_SNAPSHOT` before the new runner exists (`client/src/app/game.ts:834-838`, called with
  `clear = true` at `:1208` and `:1088`), and a fresh start from Home has nothing on stage. So the may-analysis seeds
  each chapter's first step with no shot and no faces; a free -> paid handover carries nothing into the paid
  chapter's effect, and the tiers come from per-chapter lists (rev. 4: build/shots.json `assets`, §2.5). A first step that names a face before any `bg:` / `scene:` is
  `shot/char-absent` (E).

### 2.3 Rooms and zoom views

- **A room is a shot** with `frame: room`:
  - a plate of exactly 1080 x 2048 (S11) and rest framing = `cover(stage, ROOM_SOURCE)` exactly, so the plate, the
    props layer (`scene/layout.ts`) and the hotspot buttons share the one transform (`cover.ts:1-2`), pinned by
    `shot-view: a room's rest framing equals cover()` (rev. 2, W1);
  - a cast is allowed (characters drawn into the room: blink, brows, breath; talk in event lines);
  - (rev. 4, m4) a world room has one static `bg` (EN §6), so a character drawn into a room plate is there on every
    visit: only a character who is always in that room is drawn into it (the keeper at the lamp). A character who
    comes and goes appears through an event that cuts to another shot of the same `loc` with that character
    (`study_wide_ally`), and the cut back restores the room (I-11). Characters present in a room over story time
    (a room plate chosen by world state) are owner question OQ18 and, if ruled, EN request I-17;
  - planes are allowed (rev. 2, C2): a `front: true` plane draws in the shot's front root above props (a chair back,
    a window frame), any other plane in the shot root below props; a front plane over a hotspot rect is W
    `shot/plane-over-hotspot` (the tap still works: the hotspot buttons are DOM children of the stage box, rendered over
    the canvas, `Stage.svelte:2-4`, `:26-30`);
  - during an explore yield the camera holds `cover()` (no drift, no push); the parallax drive moves near layers by
    <= 4 x 3 CSS px per axis (`g0 = 0`, far wall still, S19), so a drawn hotspot is <= 4 x 3 CSS px (5 CSS px
    diagonal) off its static tap box;
  - a story cut back to a room's shot inside an event restores the room's props and decor from world state
    (`Yields.propsFor`, I-11; rev. 2, W8), so a re-establishing wide shows the room as the world has it.
- **A zoom view is a shot with `frame: room`** (rev. 3, W9). EN §6.3 makes a view "a room with `"view": { "of":
  "study" }`, its own `bg` and hotspots" (engine.md §6.3, as read), so it takes every room rule: plate exactly
  1080 x 2048 (R5), rest framing `cover()` exactly (no overscan, no `focus` offset), the room drive (`A = 4 x 3` CSS px,
  `g0 = 0`), hotspots in the shared 1080-space mapping (`HOTSPOT_SAFE_FRAME`, `cover.ts:17-22`).
  - Lint `shot/room-frame` (E, SH2): a world room or view whose bg shots.json declares with a frame other than
    `room`. A room bg that shots.json does not declare is an implied `frame: room` shot (S2), so EN's lanes that add
    rooms (GM4's demo view, GM8d's beacon rooms) need no shots.json edit.
  - The move into it: SH10's scene motion pushes the camera into the `via` rect on the parent, then the view shot
    dissolves in at `cover()`. The push is a room batch's transition, not explore idle: SH10's cut verifies that the
    explore view takes no hotspot tap while a room batch runs (EN §6.3 `ui-state:waiting` ... `waited`, as read); if
    it does, the push is skipped and the dissolve alone runs (no hotspot is ever drawn off its box during a tap).
  - Until SH10, GM4's crossfade (`yields: a zoom move crossfades the bg`, [engine GM4 `mech-views`](../engine/12d-lanes-gm4-gm5.md#gm4-mech-views)) is the path.
  - `frame: insert` stays for a story insert with no hotspots (an object in a dialogue scene); it takes the shot
    rules (overscan, `focus`, the dialogue drive).
- **CG** (`cg:`) stays a full-screen rig-less overlay plate for objects only (puzzle close-ups, letters, photos) with
  the parallax drive at `g0 = 1` (a flat drift, SH8). It counts as an image change in the lookahead (§5.8). Rev. 3
  (W8): the CG's drift is a `'top'` source, so the `'cg'` cover holds the shot under it and not the CG itself (S16,
  §5.3); e2e `animation: a CG drifts while it covers the shot` (SH8). **A drawn
  moment with characters is a shot, never a CG** (rev. 2, m8): the romance "CG" of a classic VN is a `bg:` to a shot
  with `frame: two` or `close` and a cast, so its faces blink and breathe. AUTHORING rule (SH11), not linted: the build
  cannot see what a CG depicts.

### 2.4 Catalog ids and the catalog form

- **Ids:**
  - `bg/<shot>`: the plate; `kind: 'image'`, half tier as every bg.
  - `sheet/<shot>`: the shot's layer sheet (§2.6); `kind: 'image'`, half tier.
  - (rev. 4) `face/<shot>/<char>/<expr>` and `talk/<shot>/<char>/<expr>`: four fixed segments each, `kind: 'image'`,
    half tier (§2.6). There is no `gsheet`.
  - Shot ids match `[a-z][a-z0-9_]*`. Convention, not enforced: `<loc>_<frame>[_<subject>]`, e.g. `cafe_wide`,
    `cafe_ally_cu`, `cafe_ots_ally`.
  - File names stay injective: a fixed number of segments per namespace and no `-` (CH D2; `assetFileName`,
    `client/scripts/assets/manifest.ts:287-294`: "each namespace has a fixed number of parts"); rev. 4: `face` and
    `talk` have four, so `face-<s>-<c>-<x>-<hash8>.avif` parses back to one id, inside the server's gated-name rule
    `^[a-z0-9][a-z0-9_-]*\.(avif|webp|m4a|wav)$` (`server/src/content.rs:475-493`). `ASSET_ID_RE`
    (`client/src/story/catalog.ts:390`) gains the three namespaces in SH3a.
- **`assets/catalog.json` `bg.<id>` forms:**
  - `{ "placeholder": {...} }` today;
  - `{ "file": ... }` today: a flat plate with no layers;
  - new **`{ "src": "shot/<id>" }`**: the source directory `assets/src/shot/<id>/`, §4.1.
- **`assets/catalog.json` `prop.<id>` gains** (rev. 2, W10) the form **`{ "loop": { "src": "loop/<id>", "fps": N } }`**:
  a loop prop (EN §8.7's "catalog loop kind", [engine §8.7 The contracts MR1 and MR2 build on](../engine/08c-motion-gate-and-contracts.md#87-the-contracts-mr1-and-mr2-build-on-exact)), frames `assets/src/loop/<id>/<i>.png` (<= 12 frames,
  each <= 512 x 512, one size) packed into one atlas `prop/<id>`; decor states name it like any state image, so the
  world decides when it runs. The manifest entry stays a plain `kind: 'image'`; its frame boxes and fps travel in the
  manifest's opaque top-level `loops` (§4.5), so the per-kind key pin is untouched.
  - A shot in `story/shots.json` without a catalog entry gets an **implied placeholder**: hue = FNV-1a of the id
    mod 360, built by `effectiveCatalog()` in `scripts/story/shots/list.ts`. It is W `shot/implied-placeholder`, and
    the art list's "to draw" section lists it.
  - (rev. 3, W7 / W9) The reverse: a catalog bg that shots.json does not declare is an **implied cast-less shot**
    (`effectiveShots()` in the same file): `frame: room` when a world room or view of that chapter names it, else
    `wide`; `loc` = its id. It is W `shot/undeclared` (the art list's "to stage" section lists it). A `face:` on it
    fails `shot/char-absent`, so nothing silent remains.
- **`chars.<c>.exprs`** stays the expression **vocabulary**, with its placeholder hue used to tint placeholder face
  layers (`assets/catalog.json:14-37`). After SH12 no `char/*` image is emitted, because no tag names one.

### 2.5 The paid split (principle 0)

Rev. 4 (W3) replaces round 3's per-member split. **Every shot file is one asset tiered by the existing per-file rule**
(`tierOf`, `client/scripts/assets/manifest.ts:112-121`: a file any free chapter uses is public, one only paid chapters
use is gated, one no chapter uses is unused). The per-chapter lists come from the story tool: build/shots.json carries,
per chapter, `assets` = every shot-family file that chapter needs (§2.6, §3.6). A face state only paid chapters reach
(ch4's blush in a shot ch1 also uses) is its own file, so it is gated with no member logic.

| Case | `bg/<s>`, `sheet/<s>` | `face/<s>/<c>/<x>`, `talk/<s>/<c>/<x>` |
|---|---|---|
| s shown by some free chapter | public | public if some free chapter needs that file, else gated |
| s shown only by paid chapters | gated | gated |

- **Manifests:** each chapter's `shots` rigs name only the files and members that chapter uses (CH D5 restriction);
  a paid chapter's manifest is served after the check (unchanged).
- **scan-dist** (independent of the asset tool, as `client/scripts/scan-dist.ts:281-285` requires; critique r3 W3):
  - **(a) its own derivation:** `paidOnlyAssets` (`scan-dist.ts:286-291`) reads, besides usage.json, the per-chapter
    `assets` of `server/content/build/shots.json` and `chapters.json`, so the owed set = every shot file a paid chapter
    lists and no free chapter lists; it never calls the asset tool's tiering, `planAssets` or its usage view;
  - **(b) owed fingerprints:** a derived paid-only file without its `.avif` and `.webp` fingerprints fails closed
    (`'asset-files-missing'`, `scan-dist.ts:604-610`): a tier fault that wrote it public wrote no fingerprint;
  - **(c) whitelist of `dist/`:** every file under `client/dist/assets/` whose name starts with `bg-`, `sheet-`, `face-`
    or `talk-` is mapped back to its id by `assetFileName`'s injective grammar (fixed segment count per namespace, an
    optional `-half`, `-<hash8>`); an id that (a) does not derive as public fails as a new finding
    `{ kind: 'paid-asset', via: 'whitelist' }`. So a paid face state packed or tiered public by any fault of the asset
    tool fails the scan by its file name, even with no fingerprint and no manifest naming it;
  - names and content hashes of gated files are scanned in `dist/` as today.
- **The mutation that proves it** (SH3a): M-SH3y puts a fault inside the asset tool's tiering (every chapter counted
  free); `scan-dist: a paid-only face file that the asset tool tiered public fails` runs the real `planAssets` over a
  fixture usage, writes the plan's public files into a fixture `dist/`, and scans: red by (b) and (c), green on the
  parent of the mutation.

### 2.6 Files per shot (rev. 4: W4, W3; replaces rounds 1-3's one sheet per shot plus `gsheet`)

| File (asset id) | Holds | Exists iff (a story-tool fact) | A chapter needs it iff | CH D27 |
|---|---|---|---|---|
| `bg/<s>` | the plate | s is used | it shows s | drawn |
| `sheet/<s>` | hair locks, planes, figure planes, ambient frames; every `face` member's **rest** blink (`half`, `closed`) and rest accent | s has a cast, planes or ambient | it shows s | drawn (locks, planes) + motion |
| `face/<s>/<c>/<x>`, x not the rest | x's expression layer; x's blink (`half`, `closed`), accent and joint states, each **own** where x changes that box, else a **copy** of the rest layer | some chapter puts c in x in s | it puts c in x in s | drawn (the layer) + motion |
| `talk/<s>/<c>/<x>`, x any (rest included) | the two talk mouths c uses speaking in x: own where x changes the talk box, else a copy of the rest mouths | some chapter has c speak in x in s | it has c speak in x in s | motion: never awaited; flaps start when it is live |

- **Why per file** (A on §5.9's inputs): a shot's record now counts only the face states **in effect** (a CU with one
  non-rest expression in effect: 12.522 MiB, inside round 3's 12.703 upper bound, which the rows keep). Each further
  expression of the same shot costs nothing until it is the next appearance: then its face + talk files, 1.633 MiB,
  join the window. Shot / reverse shot stays at **25.406 MiB for any number of expressions per side**; round 3's one
  sheet reached 31.9 MiB at three and failed at four (critique r3 W4). Bytes follow need too: a chapter downloads the
  face states it uses.
- **Copies:** a reused rest layer is copied into the face or talk file that uses it (exact: x equals the plate inside
  that box, §4.2 step 3), so the story tool alone decides which files exist and who needs them, and both `tierOf` and
  scan-dist read one list. Cost: a CU face file that copies the rest blink and accent carries 136,000 px more,
  ~16 KB AVIF and 0.6 MiB decoded while x is in effect (inside the 12.703 bound). The owner still draws only the states
  that change a box (§4.2's reuse rule and the art list are unchanged).
- **Requests and manifest:** a cut into a CU with c in x fetches the plate, the sheet and the face file (drawn), and
  the talk file (motion) in parallel (`ensure` is unlimited, `client/src/scene/preload.ts:9-10`, `:128-141`). A
  20-shot chapter has ~75 face and talk files (20 shots x 1.5 face members x ~2.5), ~55 manifest entries more than
  round 3: ~+4.5 KB gzip at ~81 B per entry (S4 §3.7), charged to the entry row's chapter files (§5.11).
- **Paid split:** §2.5. **Runtime:** §5.2 (a `face:` ensures its face file), §5.8 (appearances).
