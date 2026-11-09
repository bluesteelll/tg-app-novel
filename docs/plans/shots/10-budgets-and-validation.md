## 10. Budgets and validation (summary)

| Row or check | Limit | Lane | Seen red by |
|---|---|---|---|
| `step-window <ch>` (rev. 2: + a room's props, decor and label bound in effect; rev. 3: + legacy sprites in effect; rev. 4, C1 / W2: the certain term due one step ahead, possible openers at kept bytes, one row per `r:` room window) | 33,554,432 B | SH3b | M-SH3h, M-SH3p, M-SH3z (and M-SH2i, M-SH2j in the flow) |
| `knot-set <ch>/<knot>` (rev. 3, W5: kept for chapters with `show:` until SH11 restages the last) | 33,554,432 B | existing; SH3b keeps it | M-SH3s |
| `entry step images <ch>` (rev. 3: half tier + chapter files) | 279,000 B, derived (§5.11) | SH3b | M-SH3i, M-SH3q, M-SH3w, M-SH3x |
| `first-load <ch>` | 800,000 B (now with the first step's half-tier images) | SH3b | M-SH3i |
| `room-set` + sheet | 33,554,432 B | SH3b | M-SH3j |
| sheet dims / file; loop prop atlas | 2048 px; 200 / 300 KB | SH3b | its fixture |
| (rev. 4) face / talk file | 2048 px; 120 / 180 KB; 30 / 45 KB | SH3b | its fixture |
| (rev. 4, W3) scan-dist: own derivation, owed fingerprints, the `dist/` whitelist of shot files | 0 findings | SH3a | M-SH3y (inside the asset tool), M-SH3f |
| plate dims; plate file (rev. 2: scaled by width) | h 2048, w 1080-1440 even; room 1080 x 2048; 300 / 450 KB x w / 1080 | SH3a / SH3b | M-SH3k; the 1440 fixture |
| `scene-motion chunk (br)` (rev. 2, W6) | 8,000 B; root outside the engine closure | SH3b (row), SH7 (root) | M-SH3m, M-SH7d |
| `JS before the first line (br)` (rev. 2: the ledger below, quoted per lane) | 270,000 B (`budget.ts:108`) | existing | existing |
| `transfer <ch>` | 6,000,000 B (OQ5: 12,000,000) | existing | - |
| R1-R9 (rev. 3: R9 masks and hair locks; R2 masked layers and joint states) | §4.3 | SH3a | M-SH3a..c, M-SH3n, M-SH3k, M-SH3e, M-SH3l, M-SH3r, M-SH3t, M-SH3u (R8 a warning) |
| `flow/edge-missing` (observed transitions only, m5) | 0 | SH2 | M-SH2a |
| `shot/room-frame` (rev. 3, W9) | 0 | SH2 | M-SH2g |
| arch `scene-lazy` (rev. 2) | - | SH6 | its red fixture, M-SH6e |
| warp registration (rev. 2, W3; rev. 3: exclusive plateaus, head groups, `nod`) | 0.25 source px; plateau vertices 1e-6 px | SH8 | M-SH8b, M-SH8c, M-SH8f, M-SH8g |
| layered cover (rev. 3, W8) | a CG's drift runs under `'cg'` | SH7, SH8 | M-SH7e, M-SH8h |
| e2e: targets = 0, meshBuffers = 0, ambientSources back to 0 after a shot | - | SH6, SH8, SH9 | M-SH6b, M-SH8a, M-SH9a |
| e2e: live texture bytes <= each step's static window across the lamp knot (rev. 2, m5) | the window, <= 32 MiB | SH6 | M-SH6d |
| e2e: a cut never waits on its plate (rev. 6: ch1's hall cut, ledger F2) | 300 ms | SH5a | M-SH5b |
| e2e: wide, CU, reverse CU, wide (rev. 2, W7; rev. 3, W2; rev. 6, W3: moved, ledger F16) | 300 ms; rev. 7: `window.pending === 0` within 5 s before each tap | SH11 | M-SH5e (re-applied; rev. 7: M-SH5c's red is its executor unit test) |
| (rev. 4, C1) e2e: a choice cut decodes from bytes held since the choice (rev. 6, W3: moved, ledger F17) | < 1,000 ms, no request after the tap | SH11 | M-SH5h (re-applied) |
| (rev. 6, W3) integration `window: *` on the real scheduler, registry and `withEventRoom` (rev. 7: six tests, ledger F4) | no fetch of a cut's files after its tap; rev. 7: one fetch per id across an `onEnter` event and across a handover | SH5a | M-SH5a, M-SH5e, M-SH5h, M-SH5k, M-SH5m, M-SH5p, M-SH5s, M-SH5t, M-SH5u |
| (rev. 7, W1) joins take no slot; the entry tag ends after the first window's joins; GameSession leaves it to the scheduler | - | SH5a | M-SH5r, M-SH5s, M-SH5u |
| (rev. 6, W1) a refused need evicts the next chapter's holders; `next:*` after `hope` | - | SH5a | M-SH5m, M-SH5n |
| (rev. 6, W2; rev. 7) recency order in `preload()`; the event room as the window's `eventRoom`, evicted last | - | SH5a | M-SH5o, M-SH5p, M-SH5t, M-SH5v |
| (rev. 6, m2, m3) a warm decode evicts nothing; a story step's `near` | - | SH5a, SH2 | M-SH5q, M-SH2o |
| (rev. 4, W2; rev. 5 restated) e2e: a room move hands the window to the new room | sampled at each room window when idle: every window holder's id in that room's `r:<room>` window; bytes <= 32 MiB; `overCap` flat | SH5a | M-SH5i |
| (rev. 5, W2) e2e: an exchange inside a room event never waits (rev. 6, W3: moved, ledger F18) | each cut and the return <= 300 ms after the tap; `window.pending === 0` within 5 s before each tap | SH11 | M-SH5k (re-applied) |
| (rev. 5, W1) the manifest look keeps need, warm and hope apart | - | SH3a | M-SH3ab |
| (rev. 5, W2) step window at an event's last step counts the return to its room | 33,554,432 B | SH2 (edge), SH3b (row) | M-SH2m |
| (rev. 5, W3) only `shots/flow.ts` names the legacy kinds | - | SH2 | M-SH2l |
| (rev. 5, m1) a face change releases the previous face and talk files | - | SH4 | M-SH4f |
| (rev. 5, W2) a reservation over HARD evicts preload holders first | - | SH6 | M-SH6f |
| (rev. 5, m2, m7) warm files kept across windows; room windows per room | - | SH5a, SH2 | M-SH5l, M-SH2n |
| e2e: a resume shows the half tier first and sharpens (rev. 3, C1; rev. 6: `liveBytes` rises by full - half, ledger F5; rev. 7, m2: by at least that) | previews 0 after the upgrade | SH5b | M-SH5f |
| (rev. 4, W1) e2e: after an entry the first cut's half files are requested beside the upgrade | request order; cut <= 300 ms after a tap | SH5b | M-SH5j |
| (rev. 4, W2 b) a neighbour preload asks for the room's whole shot | - | SH9 | M-SH9c |
| TTFL throttled | 6,000 ms | existing perf spec | - |

**JS** (E; MEASURED per lane in the build log; rev. 2 splits engine and lazy chunk):

| Module | KB br | Where |
|---|---|---|
| shot-view | 1.5 | engine |
| frames | 0.3 | engine |
| preload (+ deferred needs; rev. 3: + hope / neighbour eviction 0.1) | 0.5 | engine |
| flatten | 0.8 | engine |
| camera | 0.6 | engine |
| loop (rev. 3: + layered cover, second clock 0.1) | 0.6 | engine (`render-loop.ts`) |
| (rev. 3, C1) entry preview + in-place upgrade (registry, loader, controller order) | 0.4 | engine |
| (rev. 4, m3) `story/shots.ts` decoders (rigs, look, loops, face index), needed before the first `apply` | 1.0 | engine |
| (rev. 4, m3) SH1's tags / staging / stage-route growth (its own estimate, §9.1 Gates) | 0.3 | engine |
| (rev. 4, C1) the warm form (registry, loader, scheduler classes) | 0.3 | engine |
| (rev. 4, W2) room windows (`roomWindowKey`, the host `apply` hunk) | 0.1 | engine |
| (rev. 4, W1) the entry window beside the upgrade | 0.05 | engine |
| (rev. 4, W4) face and talk files in `imageIds` and the executor | 0.1 | engine |
| (rev. 4, m3) `flatten` reached through the kit from SH7 on | − 0.8 | moves to `scene/motion/` |
| (rev. 5) eviction of `room:*` at any step and by a reservation (W2), the one ordered queue with `near` (m3), face and talk slots (m1) | 0.2 | engine |
| (rev. 6) the recency re-insert and step 6 (c) (W1, W2), the `next:*` tail class (W1), `withEventRoom` (W2), the warm-decode rule (m2) | 0.1 | engine |
| (rev. 7) synchronous joins, `registry.state`, the entry tag (W1); the `eventRoom` class and step 6 (d) (W2) | 0.1 | engine. **Reconciled ([engine §30 Shots errata from reconcile](../engine/30-shots-errata.md#30-shots-errata-from-reconcile) item 19):** SH5a's +1.3 ([engine §11.1 The shared ledgers](../engine/11-budgets-and-validation.md#111-the-shared-ledgers-reconcile-r1-r2-rulings-143-qo10-152-r4-153-155-design-shots-i-13)) includes the synchronous joins and `registry.state` that LHJ landed (`preload.ts:163-172`, `registry.ts:523-527`), so up to 0.1 is already in the MEASURED base; engine §11.1 keeps the figure (the safe direction), and SH5a's cut quotes its measured delta against the base |
| **engine subtotal** | **~6.15** (rev. 7; rev. 6: 6.05; rev. 5: 5.95; rev. 4: 5.75; 6.95 without the lever; 6.35 between SH6 and SH7, before SH7's loop) | engine row 214.5 MEASURED (S4 :170) + EN 1.53 + PPL 3.00 + 6.15 = 226.08 ([engine §11.1 The shared ledgers](../engine/11-budgets-and-validation.md#111-the-shared-ledgers-reconcile-r1-r2-rulings-143-qo10-152-r4-153-155-design-shots-i-13), main `3c62a86`) / 230.0 (rev. 6, m6: EN and PPL re-read; rev. 7: not re-read, a delta round) |
| `flatten` (rev. 4, from SH7) | 0.8 | `scene/motion/` chunk |
| animator | 1.5 | `scene/motion/` |
| warp + drive + hair mesh | 1.5 | `scene/motion/` |
| ambient | 1.2 | `scene/motion/` |
| scene-motions | 1.0 | `scene/motion/` |
| **chunk subtotal** | **~6.0** (rev. 4: + `flatten`) | `scene-motion chunk (br)` <= 8.0 |
| SH10 `scene` ids | 0.5 | cue-stage chunk |
| Entry: catalog namespace strings | <= 0.1 | entry |

**Superseded by [engine §11.1 The shared ledgers](../engine/11-budgets-and-validation.md#111-the-shared-ledgers-reconcile-r1-r2-rulings-143-qo10-152-r4-153-155-design-shots-i-13)** ([engine §30 Shots errata from reconcile](../engine/30-shots-errata.md#30-shots-errata-from-reconcile) item 7): every SH lane quotes §11.1's rows at its cut. The table below stays as the record (rev. 7).

**First-line ledger** (rev. 2, W6; KB br; every line E except the base):

| Line | KB | Source |
|---|---|---|
| base, MEASURED at `91602b2` (= main's client) | 257.9 | S4 :171 (M-build); EN and PPL still quote 257.2 at `48bc82a` (engine.md §11 budget table, "JS before the first line (br) \| 257.2 / 270.0 KB", as read): I-13 asks them to re-base |
| EN engine total (rev. 6, m6: round 9) | + 1.53 | engine.md §2 "Budgets": "Engine growth over the programme <= 1.5 KB br (ARITHMETIC estimate +1.53, round 9: 0.03 past it ...)" ([engine §2 Goal and constraints](../engine/02-goal-and-constraints.md#2-goal-and-constraints)) and the budget table, "+1.53 (+3.00 per-player ...)" ([engine §11 Budgets and validation](../engine/11-budgets-and-validation.md#11-budgets-and-validation)), as read 2026-11-03; round 5 used +1.46 (round 6) |
| EN entry (GM3s) | + 0.05 | engine.md §11 entry row, "+0.05 (GM3s slot + mount)", as read |
| PPL (rev. 6, m6: round 10) | + 3.00 | `per-player.md` §15 checklist: "Engine / first line: +3.00 KB br, headroom 8.27 KB br with engine.md's +1.53 (round 10)" ([per-player §15 Readiness checklist](../per-player/15-readiness-checklist.md#15-readiness-checklist)), as read 2026-11-03; round 5 used +2.85 (round 7) |
| PPL entry (GM6s2 + GM6t) | + 0.35 | `per-player.md` §15: "0.35 KB br of this file's code in the entry" ([per-player §15 Readiness checklist](../per-player/15-readiness-checklist.md#15-readiness-checklist)), as read |
| this design, engine part (rev. 4, m3: the decoders, SH1's growth and rev. 4's additions counted; `flatten` in the chunk from SH7; rev. 5: + 0.2; rev. 6: + 0.1; rev. 7: + 0.1) | + 6.15 | above |
| this design, entry | + 0.1 | above |
| **sum** | **269.08 / 270.0** (rev. 7; 0.92 left; the peak, between SH6 and SH7, is 269.28, 0.72 left; rev. 6: 268.98, peak 269.18) | A |
| without the lazy chunk (+ 6.0) | 275.08: **FAIL** | A |

Each SH lane quotes the row base -> HEAD in its build log and STOPs at its cut if the quoted sum plus its own estimate
crosses 270.0. Rev. 4 (m3): round 3's ledger left out the `story/shots.ts` decoders and SH1's own +0.3; with them and
this revision's additions the engine part is 6.55 KB, so **the designed lever is taken in SH7**: `flatten` (0.8 KB) is
reached through the kit (SH7 Goal); the first step has no shot to dissolve from, and a dissolve before the kit lands
falls back to container alpha. Round 3's "camera tweens too" is withdrawn (GSAP's one importer is `executor.ts`,
`arch.test.ts:160-165`; `camFraming` is needed by `restore`). The next lever, if a cut STOPs: the scheduler's `warm`
decode order and the room-window helper (~0.4 KB) behind the kit, since both act only after the first line. Rev. 6
(m6): with 0.82 KB left at the peak (rev. 7: 0.72), SH6's cut and SH7's cut quote the row first; if the MEASURED sum at SH5a's merge
already reads above 269.6, SH6 takes that lever before its own work (the lever's cost is round 4's: until the kit
lands, ~30 ms + one RTT after the first line, S31, warm files stay bytes and the first room batch hands no room
window).

**Entry** (rev. 6, RULINGS 137): 39.4 MEASURED + EN's planned 0.40 (39.80, RULINGS 137) + this design's 0.1 = 39.90 /
40.0 KB br; LEL (RULINGS 137) is measuring a lever of >= 1.0 KB br out of the entry now, and SH3a's cut quotes the
row after it merges.
**Ruled since: RULINGS 158** — L1 is unshelved (RULINGS 142's return condition: 38,988 B + 510 B = 39,498 B, 502 B left against the 500 B line, inside the build's own churn) as lane `l1-entry-summary` (`summaryOf` into `saves/summary.ts`; entry -1.59, first line +0.21, CLAIM at `cdca9d4`); L2 stays shelved. The cut/build crossing rule above stands for every later entry-adding lane, read against the row after L1 merges.

**Superseded by [engine §11.1 The shared ledgers](../engine/11-budgets-and-validation.md#111-the-shared-ledgers-reconcile-r1-r2-rulings-143-qo10-152-r4-153-155-design-shots-i-13)** ([engine §30 Shots errata from reconcile](../engine/30-shots-errata.md#30-shots-errata-from-reconcile) item 7): every SH lane quotes §11.1's rows at its cut. The table below stays as the record (rev. 7).

**All-JS ledger** (rev. 3, m5; the row `all JS (br)` <= 305,000 B, `budget.ts:114`; KB br, E except the base):

| Line | KB | Source |
|---|---|---|
| base, MEASURED at `91602b2` | 270.6 | S4 §1.7 (M-build) |
| this design (rev. 7): engine 6.15 + chunk 6.0 + entry 0.1 | + 12.25 | above |
| EN engine + entry (rev. 6: 1.53 + 0.05) | + 1.58 | as in the first-line ledger |
| EN explore-ui growth (rev. 6: 12.46 estimate - 4.9 MEASURED) | + 7.56 | engine.md §3.5 byte ledger, total row "**12.46, ~12.5 / 16.0** (round 9: +0.01, GM3s's `frameOut`)" ([engine §3.5 The arch rule and the byte ledger](../engine/03-module-contract.md#35-the-arch-rule-and-the-byte-ledger-r1)), as read 2026-11-03 |
| EN cue-stage chunk (rev. 6) | + 3.15 | engine.md §3.5 byte ledger, total row "**3.15, ~3.2 / 6.0** (round 9: +0.08)" ([engine §3.5 The arch rule and the byte ledger](../engine/03-module-contract.md#35-the-arch-rule-and-the-byte-ledger-r1)), as read 2026-11-03 |
| PPL engine + entry (rev. 6: 3.00 + 0.35) | + 3.35 | as above |
| **sum** | **298.49 / 305.0** (rev. 7; 6.51 left; rev. 6: 298.39; rev. 5: 297.90) | A (PLAUSIBLE: the explore-ui and cue rows are EN's estimates) |

Not in the sum: EN's new puzzle-type chunks (GM7p, GM7g, GM8a, GM8b; each <= 8 KB by its row). With 6.51 KB left (rev. 7), a few
of them exceed `all JS`: I-13 makes this ledger shared, superseded by [engine §11.1 The shared ledgers](../engine/11-budgets-and-validation.md#111-the-shared-ledgers-reconcile-r1-r2-rulings-143-qo10-152-r4-153-155-design-shots-i-13) ([engine §30 Shots errata from reconcile](../engine/30-shots-errata.md#30-shots-errata-from-reconcile) item 7); and the first EN lane whose estimate crosses 305.0 STOPs.
**Ruled: RULINGS 158** — `allJsBr` is re-set once, by GM7p (the `budget.ts` holder before GM7g in the one order), to GM7p's measured HEAD + the remaining planned puzzle-type chunks (GM7g, GM8a, GM8b at 1.6 KB br each, the measured `puzzle-type` chunk) + 5.0 KB br, rounded up to a whole KB; GM7p's cut quotes the arithmetic and the orchestrator confirms it in a RULINGS line at that cut; no other lane raises it (the row bounds no download).

Verify the engine headroom against 230,000 B at SH4's cut.

### 10.1 Fixture ledger (rev. 6, RULINGS 138 (c); the invariant S34)

**Rule.** Every e2e test and every integration test this design names has a row. A row names the content shape the
test needs, the file(s) that create it and the lane whose lock holds them; that lane is the test's own lane or one
ordered before it (§9.14), or the shape exists on main and its holders are named. A test with no row, or a row whose
file is outside the creating lane's lock, is a defect, checked by this table. Every e2e that needs a shape reads it in
Node from the built manifest, `look` or world first and fails "fixture shape absent" (a red, never a vacuous green).
Unit tests whose fixtures are built inside their own file need no row. The e2e builds from the real story
(`client/package.json:17`); `client/e2e/` has no story fixture (its one fixture is `fixtures/telegram-web-app.js`).

| # | Test (the lane that names it) | Content shape | File(s) | Created by (lock holds it) | Asserted first |
|---|---|---|---|---|---|
| F1 | `shots: the keeper's face changes in the lamp-room shot`, `shots: a reload restores the keeper's face` (SH4) | ch4 `lamp` with the keeper a face member of `lamp_keeper_cu` and one `face:` change there; placeholder face states as flat rectangles in the vocabulary hues (§4.2 step 8) | `story/ch4/main.ink`, `story/shots.json`; `client/scripts/assets/{shots,placeholder}.ts` | SH4 commit 6; SH3a | the two expressions' hues differ in the built catalog |
| F2 | `shots: a cut never waits for its plate` (SH5a) | a certain cut to another bg at distance 1 after the entry: ch1 `arrival`'s a013 -> `manor_arrive`'s `# scene: hall` | `story/ch1/main.ink:29-36` | main (free chapter; no SH lane edits it before SH11) | a013's `need` holds `bg/hall` |
| F3 | `shots: a room move hands the window to the new room` (SH5a) | a section of >= 3 rooms whose start room has >= 2 exits: ch1's manor (hall -> study, cellar) | `story/ch1/world.json:66-136` | main; EN's chain holds the file (§9.14, I-18) | world.json's shape |
| F4 | `window: wide, close-up, reverse close-up, wide loads no cut at its tap`, `window: a choice cut decodes from the bytes held since the choice`, `window: an exchange inside a room event loads no cut at its tap`, `window: an ending knot's cuts load none at their tap while the next chapter is held`, `window: an onEnter event keeps its room`, (rev. 7) `window: a handover whose preload landed fetches nothing for its first window` (SH5a, integration) | manifests at §5.9's sizes and EN's request order, built in the test (rev. 7: the `onEnter` test in ch1's shape, `room:cellar` holding nothing; the handover with a `k:lamp`-like `need` of a wide and a CU) | `client/src/app/window.test.ts` | SH5a (new file) | in-file |
| F5 | `shots: a resume shows the half tier first and sharpens` (SH5b) | a resume in a paid shot chapter whose visible shot has gated half files: ch4 a001 | `story/ch4/main.ink:9`; the gated halves (asset tool) | SH4; M3s (before SH5b by its Order) | the resumed step's files have `half` entries in the paid manifest |
| F6 | `shots: after an entry the first cut's half files are requested beside the upgrade` (SH5b) | a resume at a line on `lamp_wide` whose window's `need` holds `lamp_keeper_cu`'s files: ch4 a001 (SH4's rev. 6 staging) | `story/ch4/main.ink:9-15`, `story/shots.json` | SH4 | a001's `need` holds the CU's plate |
| F7 | `shots: a dissolve leaves no target alive`, `shots: a push frames the keeper's face`, `shots: live texture bytes stay within each step's window bound across the lamp knot` (SH6) | ch4 `lamp` as a wide + a keeper CU + an insert, a `bg: <shot> t=crossfade` between two shots, a `cam: push` to the keeper | `story/ch4/main.ink`, `story/shots.json` | SH6 commit 7 | the built `look` has the crossfade step and the cam step |
| F8 | `animation: the keeper blinks in the lamp-room shot`, `animation: an idle minute holds the breathing` (SH7) | a visible face member: ch4's keeper | as F1 | SH4 | - |
| F9 | pin: the frozen build's pixel samples (SH7) | the existing e2e samples | `client/e2e/*.spec.ts` on main | main | - |
| F10 | `animation: the plate breathes in live mode`, `animation: leaving the shot leaves no mesh buffer` (SH8) | a cast member with a figure mask and a head plateau; one `anim:` and one `fx:` | `story/ch4/main.ink`; SH3a's placeholder masks (§4.2 step 8) | SH8; SH3a | - |
| F11 | `animation: a near prop moves against the far wall in a room` (SH8) | a room prop whose rect centre lies below 35 % of the plate height under the placeholder depth grid: ch1's cellar `star` (`story/ch1/world.json:127-129`, centre y 1,300 of 2,048: n = 0.44), sampled before `take` | `story/ch1/world.json`; SH3a's grid | main (EN's chain on world.json, I-18) | the test finds such a prop in world.json |
| F12 | `animation: a CG drifts while it covers the shot` (SH8) | ch1's `# cg: letter` | `story/ch1/main.ink:105` | main | - |
| F13 | `animation: the lamp flickers in live mode` (SH9) | a shown bg with a placeholder flicker: `lighthouse` (`story/ch3/main.ink:32`, kept as a room bg by GM8d, I-15) | `assets/catalog.json` (`bg.lighthouse.placeholder.ambient`) | SH9 (its lock); ch3 on main | the shown bg lists `flicker` in the built catalog |
| F14 | `shots: opening the drawer moves its prop anchor` (SH10) | ch1's study `drawer` with a decor state and its placeholder prop | `story/ch1/world.json`, `assets/catalog.json` (`drawer_open`) | GM3b (engine.md GM3b lock, as read; before SH10 by its Order) | the built world has a state on `drawer` |
| F15 | `scene: an unrestored context loss rebuilds the shot`, `scene: a failed revive re-acquires the shot` (SH11, `memory.spec.ts`) | the ally's face box in `street_wide` | `story/ch1/main.ink`, `story/shots.json` | SH11 | - |
| F16 | `shots: wide, close-up, reverse close-up, wide never waits` (SH11; moved from SH5a) | §9.12 F16: ch1 `arrival` a005-a013 as wide -> CU A -> CU B -> wide, full(wide) + full(CU A) + full(CU B) > 33,554,432 B; rev. 7 (m1): the choice on CU B | `story/ch1/main.ink:17-29`, `story/shots.json` | SH11 | that sum; and (rev. 7, m1) a006's window: CU B in `need`, the wide in `hope` |
| F17 | `shots: a choice cut decodes from bytes held since the choice` (SH11; moved) | §9.12 F17: `arrival`'s choice at a CU, two reply openers on distinct shots, full(choice CU) + 2 openers > 33,554,432 B; rev. 7 (m1): the choice on CU B, the openers the wide (c001) and CU A (c002), 35.575 MiB | `story/ch1/main.ink:21-26`, `story/shots.json` | SH11 | the choice's window: both openers in `warm`; that sum |
| F18 | `shots: an exchange inside a room event never waits` (SH11; moved) | §9.12 F18: `manor_gate_forced` on two CU-sized shots + a 1080 last shot, EN's `room:hall`, `room:study` resident (`gate` has no close-up, `world.json:43`), full(CU A) + full(CU B) + full(`room:hall`'s files) > 33,554,432 B | `story/ch1/main.ink:66-71`, `story/shots.json`; EN's `story/ch1/world.json` | SH11; EN's chain through I-18 | `stats().scene.rooms` before the third wrong Try's tap (rev. 7, m3); that sum |

The other specs every SH lane runs in `e2e full` (EN's `stories.spec.ts` and `puzzles.spec.ts`; `memory.spec.ts`
before SH11 re-points it; `perf.spec.ts`) keep their own fixtures, the story on main; SH11's restage changes tags
only, so `stories.spec.ts`'s byte pin holds (§9.12 Order). They are not this design's tests, so they have no row.

**Story checks unchanged:** compile, tag lint, line IDs unique, paid chapters absent from `dist/`. Every paid-only
shot file (plate, sheet, face, talk) joins the paid-file scan through scan-dist's own derivation (SH3a; rev. 5, m9:
round 4 still said "gated sheets").
