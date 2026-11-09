## 7. characters.md rev. 3: kept, changed, dropped (by section)

| CH section / decision | Verdict | Where now |
|---|---|---|
| §0 D1 layered form per pose; D2 part ids; D3 768 x 1536 transform | **dropped**: a per-shot face rig cut from full-frame variants; ids `bg` / `sheet` / `face` / `talk` (rev. 4); integer crop, no resampling | S1, S3, S11; §2.6; §4 |
| D4 P1-P9 checks | **changed** into R1-R8 (registration against the declared base outside the head mask, disjoint motion boxes, clipping, coverage by the reuse rule with line IDs, dims, encoded alpha, inpainted cut-outs, props over figures); P4b is trivial | §4.3 |
| D5 manifest rig restricted per chapter | **kept** as a pattern (`shots`) | S9 |
| D6 show -> members expansion | **changed**: flow-derived needs in build/shots.json | §3.4, §3.6 |
| D7 carriedBound per character | **dropped**: the step window's `cur` is a max over the shots in effect | §5.9 |
| D8 half for parts | **kept** for plates and sheets | §4.4 |
| D9 part file limits; `dist file types` row | **changed**: sheet limits. The `dist file types` row is not shot work and goes to carry.md | §4.4 |
| D10 driver seam; rig fallback | **changed**: the executor owns a `ShotView` per shot; the rig driver is **dropped** (Q56: no rig) | §5.1 |
| D11 CharView nesting | **changed**: `world > bg anchor (shot root) > plate / layers` | §5.1 |
| D12 exact face patch | **kept** | S15 |
| D13 flatten for whole-character fades | **changed**: no character fades exist (cuts replace entrances). The same adapter and `flatten.ts` make the dissolve snapshot target | S14 |
| D14, D15 reservation rule, `TRANSIENT_CAP`, fallbacks | **kept**; rev. 5 (W2): rev. 3's O8 ("`reserve` refuses and evicts nothing") is **changed for preload holders only**: a reservation refused under HARD first evicts every preload-priority holder, as a visible admission does, then retries once (so a room event's opening dissolve on Desktop is exact, §5.9) | §5.5 |
| D16 body as identity unit | **changed**: the shot is the unit (plate ended -> re-take the shot; sheet ended -> rest faces until `reacquire`) | §5.10 |
| D17 keeper first | **kept** as a pattern: tide (ch3, ch4) in SH4 / SH6, manor in SH11 | §9 |
| D18 pure animator; D19 talking; D20 capped loop; D21 freeze; D22 reduced motion; D29 brows | **kept**; D19 gains the off-screen speaker and `think`; D22 gains the camera and ambient rows; rev. 3 (W8): §6.3's covered is **changed** from loop-wide to layered (`'stage'` / `'top'` sources, a second continuous clock `tcTop`), so a CG's own drift runs while it covers the shot | §5.2-5.3, §5.10 |
| D23 `anim:` / `fx:` | **changed**: motions on the warp field; hop / bounce need a figure plane | §5.6 |
| D24 hair mesh | **kept** for hair locks | S18 |
| D25 lane shapes; D31 locks | **dropped** | §9 |
| D26 runtime module out of the entry | **kept**: `client/src/story/shots.ts` | S9 |
| D27 ensure only drawn members | **kept, adapted**: the sheet is drawn when the shot has cut-out layers or a non-rest face | S23 |
| D28 arch rules (`render-texture`, `mesh-create`, `gpu-target`) | **kept** (SH6) | §9 |
| D30 GPU ledger | **kept** (SH6; mesh buffers SH8) | §5.9 |
| D32 the M2 controller carry | **kept** in carry.md (still no harness) | - |
| §4.1-§4.8 MD1 contracts | replaced by §3-§4; §4.7's tier split -> per-file tiers of face and talk files (rev. 4; round 3: `gsheet`) | §2.5, §2.6 |
| §5.1-§5.7 MD2 | replaced by §5.1, §5.5, §5.9-5.10 | - |
| §6.1-§6.4, §6.6-§6.7, §6.9 MA1 | **kept** | §5.3 |
| §6.5 MA1b DSL | **kept, changed** (closed motion set; `think`; `cam`) | §3 |
| §6.8 parked rig | **dropped** (Q56) | - |
| §7 MA2 hair mesh | **kept** | SH8 |
| §8 ledger | replaced | §5.9 |
| §9 art brief | replaced by §6 and the art list | §6 |
| §10 device checks | replaced by S-D | §8 |
| §12 R1 (`anim` command for cue motions), R2 (ambient sources), R3 (one reduced-motion source), R5 (no unreserved filters), R6 (cues not in the snapshot), R7 (talk call points), R9 (activity), R10 (targets reserved), R12 (`setCovered`), R13 (brows need no command) | **kept** | SH7, SH10 |
| R4 (labels on characters) | **lapses**: no character nodes; faces are inside the shot | - |
| R8 (characters in rooms and views) | **answered**: they are drawn into the shot; zoom never upscales | §2.3 |
| R11 (order rows) | replaced by §9.14 | - |
| §13 Q1, Q2 | **carried** as OQ8, OQ9 | - |
| Q3 (gestures) | carried as the motion set | - |
| Q4 (instant mouths) | kept: nominal `forMs` | - |
| Q5 (opening scenes) | replaced by S23's entry-step row | - |
| §1 O12 (the 270 KB split: `animator.ts` + `hair-mesh.ts` behind one `import()` after the first `apply`, a row `anim chunk <= 8 KB br`) | **kept and widened** (rev. 2, W6): the whole `scene/motion/` family (animator, warp, ambient, scene motions, hair mesh), row `scene-motion chunk (br)` | S31, §5.3, §10 |

**Review status of the reused sections** (rev. 2, critique question 4). CH round 1's and round 2's critiques were
answered in full (CH "Revision 2", "Revision 3": every critical and important remark accepted and resolved, none
refuted, `characters.md:1888-1899`). Critique r3 never ran, so **the rev. 3 deltas are uncritiqued**: D29's brow clock
and listener cue (R3 C1), the `tc` union of idle and covered (O2), the loop-owned input subscription and
executor-counted activity (O3), covered reasons `'cg'` / `'panel'` (O6), `FLASH_MIN_GAP_MS` (O7), `reserve` refuses
and evicts nothing (O8), `resume()` restarting continuous frames (O11), the lazy chunk (O12) and reduced motion at
mount (O13) (`characters.md:1901-1928`). This design reuses them as written; this critique round covers them as part of
the reuse, and SH6 / SH7's cuts re-read them against the tree.

**How the mechanics plug in:**
- rooms, views, props and decor: §2.3, S25; a story cut back to a room restores its props (I-11);
- labels ride anchors inside `world`, in the anchor's `content` node, so the `depth` node's parallax and the `motion`
  node's cue tweens both carry them (PPL R-A1, R-A2, R-A5, R-A10; I-9);
- device parts are decor anchors (GM8i);
- state loops are decor state images naming a loop prop (EN §8.7; S21, §5.7);
- cue scene motions: SH10.
