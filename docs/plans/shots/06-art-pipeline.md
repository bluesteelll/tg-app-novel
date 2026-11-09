## 6. THE OWNER'S ART PIPELINE (local Krea + LoRA)

> **Rev. 6: not adopted (RULINGS 136, 138 (d)).** The owner: generation is not the focus now; his model is Krea 2 on an
> RTX 5080 (OPEN-QUESTIONS Q2 / Q56, main `cdca9d4`). §6.1-§6.4 (the model, its local setup and licence, LoRA
> training and the generation steps, GPU sizing) are kept below as a record, unchanged, and get no further design; no
> lane reads them and no gate depends on them. OQ1 is answered (Krea 2), OQ2 by the GPU (RTX 5080, 16 GB); OQ3, OQ10
> and OQ14 are not asked. §6.5 survives only as the art list's default minutes table (E; one constant in
> `shots/art-list.ts`, which the owner's own timings replace); §6.6 is adopted (it is the art list, §3.5). What the
> design needs from the art is the source layout and its checks (§4), whatever tool makes it.

### 6.1 Model choice (not adopted, RULINGS 136)

> **Not adopted** (RULINGS 136, 138 (d)): the model choice (Krea 2 vs FLUX.1 Krea [dev]) and OQ1's default. The record: `design/shots/proposal.md` §6.1, orchestration repo, tag `designs-adopted-2026-11-09`.

### 6.2 Hardware (not adopted, RULINGS 136)

> **Not adopted** (RULINGS 136, 138 (d)): the hardware facts, candidate timing and OQ2's default. The record: `design/shots/proposal.md` §6.2, orchestration repo, tag `designs-adopted-2026-11-09`.

### 6.3 Steps (not adopted, RULINGS 136; the output contract is §4.1)

> **Not adopted** (RULINGS 136, 138 (d)): the generation steps 1-12 (the output contract stays [§4.1 Source layout per shot](04-asset-pipeline.md#41-source-layout-per-shot-assetssrcshotshot)). The record: `design/shots/proposal.md` §6.3, orchestration repo, tag `designs-adopted-2026-11-09`.

### 6.4 Licence status of outputs and what to verify before release art (not adopted, RULINGS 136; OQ3 not asked)

> **Not adopted** (RULINGS 136, 138 (d)): the licence table and pre-release checks (OQ3 not asked). The record: `design/shots/proposal.md` §6.4, orchestration repo, tag `designs-adopted-2026-11-09`.

### 6.5 Hours per shot and per chapter (rev. 6: kept only as the art list's default minutes table, E; the generation inputs behind it are not adopted, RULINGS 136)

Rev. 2 (m4, C1, W4, W9): two faces counted, the per-expression states of §4.2, every face's full set, ambient.

| Step (§6.3) | Dialogue shot or two-face wide: 2 faces, rest + 1 expression each, both speak (min) | Insert or wide with no face (min) |
|---|---|---|
| 4 camera per setup in the reused blockout | 10 | 10 |
| 4-5 control renders | 5 | 5 |
| 6 generate (16-32 candidates at ~1 MP; ~4.55 s each on a 5090, MEASURED S2 [E2], more on smaller cards: S-A measures; rev. 5, m9) and pick | 15 | 15 |
| 6b upscale to the plate canvas (rev. 3, m6) | 5 | 5 |
| 7 per-character inpaint, 2 x (8 candidates + pick) | 18 | 0 |
| 8 masks (per cast member a figure mask and >= 1 hair lock, rev. 3 W4; planes; 2 head masks) + plate inpaint behind locks and planes | 17 | 15 |
| 9 face states, ~4 min each: per face the rest set (half, closed, talk1, talk2, accent = 5) + `x` + `x`'s own states where it changes a box (2-5): 8-11 per face, **16-22** for two | 64-88 | 0 |
| 10 depth | 2 | 2 |
| 11 ambient: one flicker mask (~10) + on average half a frame loop (~40 per loop: crop, a Wan 2.2 clip of < 9 min machine time, 2-3 tries, frame pick, cut) | 30 | 30 |
| 12 export + asset-tool fixes | 10 | 10 |
| **Total** (rev. 3: + 5 min upscale) | **176-200 (~2.9-3.3 h; range 2-4 h)** | **92 (~1.5 h; range 1-2 h)** |

**Per chapter** (~20 shots, A on E):
- 12 dialogue shots x 2-4 h = 24-48 h;
- 4 wides with faces x 2-4 h = 8-16 h;
- 4 inserts / face-less wides x 1-2 h = 4-8 h;
- ~4 new locations x 1-2 h blockout = 4-8 h (E, the least familiar step for a non-artist; S-A times it, m6);
- total **40-80 h** (round 1: 26-52 h; the rise is the full small-face sets, the per-expression motion states and the
  ambient step). OQ4 carries it; OQ13 prices the small-face reduction (~2-5 h per chapter, A: 8-12 small faces x 3-6
  states x 4 min).

**Hours as a function of expressions per shot** (rev. 4, W4; A on the 4-min state rate): the rows above count rest +
one non-rest expression per face per shot. Each further expression of one face in one shot costs the expression
itself (4 min) plus its own derived states only where it changes that box (0-5 of `half`, `closed`, `talk1`,
`talk2`, `accent`, 4 min each): **+4-24 min**. Per chapter: `40-80 h + E_extra x (4-24 min)`, where `E_extra` = the
(shot, face, expression) uses beyond the first; e.g. two more expressions on each face of the 12 dialogue shots
(12 x 1.5 x 2 = 36) adds **+2.4-14.4 h**. Memory and file limits no longer cap the count (§2.6); bytes add ~44 KB
AVIF per CU face file. The art list prints `E_extra` and this marginal per chapter (§3.5); OQ17 asks the owner for the
typical and maximum count.

**Per character, once:**
- dataset 2-4 h;
- training: the only Krea 2 data point is 18.75 h of machine time on a 12 GB RTX 5070 (one user, [T1]); [X1]'s ~2 h
  is a Chroma1-HD LoRA, not Krea 2 (m3); on a rented 4090 ~2-4 h (E): ~$1.8-3.6 at $0.89/h (A on E);
- the S-L test 1-2 h.

### 6.6 How the art list keeps volume minimal

- **Only what the ink uses:**
  - a face state exists only if the flow puts that character in that expression in that shot;
  - talk mouths only where it speaks in that expression;
  - an expression's own blink, talk and accent only where it changes that box; otherwise the rest state is reused
    (§4.2 step 3), and the asset tool says which were needed.
- **Reuse:**
  - shot / reverse shot alternates 2 setups for a whole exchange;
  - the reuse table shows the steps each shot serves;
  - a writer sees the hours estimate per shot and per chapter on every `--art-list` run.
- **Cheaper views** (none narrows a ruled behaviour, rev. 2 C1):
  - back views in OTS and wides carry no face states (no face is visible);
  - inserts carry no faces.
- **Setups per scene:** 3-4 by default (OQ4).
- **`art/pending` counts:** they drop as art lands, so the owner can track what is still to draw.
