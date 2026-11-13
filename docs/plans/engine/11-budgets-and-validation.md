## 11. Budgets and validation

| Row | Today (MEASURED, `final-build.log`) | After the programme (ARITHMETIC) | Enforced by |
|---|---|---|---|
| entry (br) | 39.4 / 40.0 KB (RULINGS 127); round 11: **38.4** / 40.0 after LEL's merge (RULINGS 141, 38,370 B); reconcile r1: **38,687 B** on `df0e12c` (= `acc4e0d`'s code) and **38,952 B** with LFL (`lfl-first-line/test_r2.md:65`; merged `cec347c`), the three designs' rows in §11.1: **39.45** / 40.0, 0.548 left, 0.048 above L1 / L2's return line (§15 item 15); reconcile r2 (RC-m6): **39.46** / 40.0, 0.538 left, 0.038 above the line, GM3w's App expressions booked +0.01; **main `3c62a86`: 38,988 B** MEASURED (`budget.ts`'s evaluate, docs-adopt) | adoption (main `3c62a86`; supersedes the rounds below; §11.1): **39.50** / 40.0; +0.05 (GM3s slot + mount) -> ~39.45; with per-player's round-4 +0.35 -> **39.80** (round 4; round 11: on 38.4, ~**38.80**, 1.2 KB left, RULINGS 142); Svelte's transition runtime measured at GM3s (§3.5) | row; the carried entry lever first in a lane that would cross; GM3s's STOP item if its delta passes +0.55 |
| engine closure JS (br) | 214.2 / 230.0 KB (`:93`); round 10: **214.5** after M3c (design-shots' M-build, `design/shots/research_S4-engine-fit.md:170`); **main `3c62a86`: 215,087 B** MEASURED (`budget.ts`'s evaluate, docs-adopt) | adoption (main `3c62a86`; supersedes the rounds below; §11.1): **226.08** / 230.0; reconcile r2: +1.71 on LFL's 215,052 B -> ~216.76; the three designs together (+1.71 + 3.11 + 6.15) -> **226.02** / 230.0 (§11.1); reconcile r1: +1.69 on 215,015 B (`test_r2.md:66`, `df0e12c`) -> ~**216.71**, on LFL's 215,052 B -> ~216.74; the three designs together (+1.69 + 3.00 + 6.15) -> **225.89** / 230.0 (§11.1); was +1.62 -> ~**216.12** (round 14: unchanged at two decimals, m3's revive clause in `held` ~1 line, 4.3 B, 1.62 + 0.004 = 1.624, ARITHMETIC; round 12: `held`, `ahead`, the anchor box, +0.01; ~216.02 on LEL's 214.4; round 11: +1.61 -> 216.11; LEL's merge reads the base 214.4, `lel-entry-lever/test_r1.md:48`, so ~216.01 on today's main; round 10: +1.56 -> 216.06, re-based; round 9: +1.53 on 214.2 -> 215.73) | `budget.ts` row; `rules-lazy`; STOP rule. Changed by RULINGS 201, 208 (as of `461424d`; docs lane `docs-errata-13`, group A): the row counts the union of the chunks any supported WebView requests before its first line (the path rule, §11.1); lever X's walk stop (`engineWalk` stops at `PIXI_ENV_SRCS` while `SKIP_PIXI_ENV` holds, `client/scripts/budget.ts:453-456`, and counts them again otherwise: the fail-safe); rule `pixi-env` (`client/src/arch.test.ts:217`) keeps scene code off the skipped systems; **204,596 B** MEASURED at X's merge (`597dded`) |
| JS before the first line (br) | 257.2 / 270.0 KB (`:94`); round 10: **257.9** after M3c (`research_S4-engine-fit.md:171`); reconcile r1: **258,823 B** on `df0e12c` (entry + engine + the meta controller chunk), **254,004 B** with LFL (entry + engine closures; `test_r2.md:67`; merged `cec347c`, RULINGS 155); **main `3c62a86`: 254,075 B** MEASURED (`budget.ts`'s evaluate, docs-adopt) | adoption (main `3c62a86`; supersedes the rounds below; §11.1): **265.58** / 270.0; reconcile r2 (supersedes the rounds below; §11.1): the three designs add 11.48 -> **265.48** / 270.0 with LFL (4.52 left; peak 265.68 before SH7's -0.2), 270.31 (FAIL) on the pre-LFL row; reconcile r1: the three designs add 11.34 -> **265.34** / 270.0 with LFL (4.66 left; peak 265.54 before SH7's -0.2), 270.16 (FAIL) on the pre-LFL row; round 12: + 1.62 (engine) + 0.05 + 3.00 + 0.35 -> ~**262.92**, **7.08 KB left** before the shot design; with design-shots' rev. 7, +6.15 + 0.1, **269.17** / 270.0, 0.83 left, peak 269.37 (0.63 left); round 11: + 1.61 (engine) + 0.05 (entry, GM3s) + 3.00 (per-player engine, its round-10 figure as read, [per-player §12.1 Requests from this file](../per-player/12-interface-requests.md#121-requests-from-this-file-status-after-enginemd-round-9-as-read-2026-11-03-reconcile-revision-1-round-14-as-read-2026-11-09-reconcile-revision-2-enginemds-reconcile-revision-1-as-read-2026-11-09-reconcile-revision-3-enginemds-reconcile-revision-2-as-read-2026-11-09)) + 0.35 (per-player entry) -> ~**262.91**, **7.09 KB left** before the shot design; with design-shots' approved rev. 7, +6.15 + 0.1 ([shots §10 Budgets and validation](../shots/10-budgets-and-validation.md#10-budgets-and-validation-summary), RULINGS 143), **269.16** / 270.0, 0.84 left, peak 269.36 (round 10: 262.86, 7.14, 269.01 with rev. 6's +6.15 in all; LEL's merge leaves the base at 257.9, -15 B, RULINGS 141) (round 9 summed 257.2 + 1.53 + 3.00 = 261.73 without the entry terms; found while resolving) | row |
| explore-ui chunk (br) | 4.9 / 16.0 KB (`:97`) | ~12.51 before MR1 (includes `cues/root.ts` ~0.2; round 9: `frameOut` +0.01; round 12: GM3b's `roomImages`, the `state:` holder and its release branches, `anchorBox`, ~8 lines, +0.03; round 13: the keep-set release and the close-up's two branches, `stateHold`, ~5 lines, +0.02); Changed by RULINGS 171 (as of `9a83251`; docs lane `docs-errata-10`, group A): **8,395 B** MEASURED after GM1a and GM1b, projected **~13.45** / 16.0 (§11.1) | row; split trigger at 14.0 MEASURED |
| request walk (round 13) | - | test-only (`client/src/requests.test.ts`), 0 bundle bytes; its program's wall time MEASURED at GM3p's cut, 60 s test timeout, > 30 s a STOP item; round 14: the batch member, the transport's type, the re-type check over every value flow and the component names add checker work, not bytes (the same program; the time measured with them) | `test` |
| **cue-stage chunk (br), new family** | - (PENDING until GM3s) | ~3.28 (reconcile r2, RC-m5: ~3.78 once SH10 gives every key and control default its `scene` id in `cues/stage/motions.ts`, +0.5 CLAIM, §11.1; round 11: the `checking` loop, `centre`, the `inventory` landing, the edge skip and its count, the DOM-branch count and the played-key panel suffix, +0.06; round 10: the fallback counter, the hit-area ghost and its outline, `holdEnd`, `Resolved` and the `ribbon` landing, +0.07; round 4: the wait hold and four keys; round 5: `offline`, `rate-limited`; round 6: `ready` and the key lines' rounding; round 7: three keys, `with`, the per-panel holds, `CUE_TARGET_ATTRS` and the resolver rules, +0.08; round 9: the two-phase player, `resolveAt`, `PRESET_SITE`, the leave watch, the outroing-root skip, the hold's notice step and the ghost clone, +0.08) | new `LAZY_FAMILIES` row (`budget.ts:159-187`), LIMIT `cueStageChunkBr` 6.0 KB (new), seen red on a fixture over the limit (GM3s); split trigger at 5.0. Changed by RULINGS 201, 204 (as of `461424d`; docs lane `docs-errata-13`, group A): LIMIT **8.5 KB** (`cueStageChunkBr` 8,500, `client/scripts/budget.ts:131`; QS1) and a **7.5 KB review trigger** in place of the 5.0 split trigger (attribute by module; split only to remove a measured download: both halves load together); **6,108 B** MEASURED at GM3s's merge (`65e10ad`) |
| puzzle-type chunk (br, largest) | 1.6 / 8.0 KB (`:95`) | each new type <= 8.0 | row; GM7p derives roots by glob |
| puzzle-host chunk (br) | 2.5 / 10.0 KB (`:96`) | + `cues/root.ts` ~0.2 and (round 7) the cue-target markers, the load-failed wrapper and Retry's `disabled` ~0.03 (GM3p; round 8: the `disabled={frame.retrying}` attribute lands in GM3w, the same bytes) + the reach `canTry` ~0.01 (GM7r, round 5) + the `room` / `ladder` places with the top bar, its Retry, (round 5) its Try, (round 6) its three-row CSS and (round 7) its 44 px / 18 px rules and markers ~0.52 (GM8h) -> ~3.26; round 9: the frame wrapper, the keyed root and the moved frame styles ~0.01 plus `cues/root.ts`'s `frameOut` ~0.01 (GM3p, GM3s) -> ~3.28 | row |
| world json (per chapter) | ch1 1.7 KB br, 10.8 KB raw (`:120`); Changed by RULINGS 190 (as of `837b1ed`; docs lane `docs-errata-12`, group A, fix round 1): **MEASURED** at GM2b's merge (`1782d6d`, 4 builds per tree, identical): ch1 br 1,719 -> **1,506** B, raw 10,779 -> **5,253** B; ch2 br 286 -> 255 B, raw 569 -> 394 B | compact emission (merged, GM2b); indentation 51.3 % of raw (CLAIM 25-30 %), so the **br row binds first**: ~58 hotspots per chapter at 8 KB br against ~67 at 32 KB raw (ARITHMETIC on ch1's 11 hotspots, [§5.4](05-world-data-and-save-format.md#54-world-json-bytes-r6)); capacity with views and states MEASURED in GM4 | rows (8 KB br, 32 KB raw) |
| room-set | 16.9-18.8 MiB (`:170-172`); Changed by RULINGS 258 (as of `a064399`; docs lane `docs-errata-16`, group A): the study **19.7** MiB MEASURED at GM3b's merge (`ac9cab1`; `drawer_open` joins its props); Changed by RULINGS 284 (as of `768fc9d`; docs lane `docs-errata-17`, group A): the hall **19.7** MiB (17,708,296 -> 20,666,516 B) MEASURED at GM4g's merge (`56cc302`: the transition pair), the cellar 17.8 (18,695,032 B) and the study 19.7 (20,668,128 B) unchanged, each noting `preloads 2 of 2` (the hall) or `1 of 1` | transition-pair term (Changed by RULINGS 284 (as of `768fc9d`; docs lane `docs-errata-17`, group A): built by GM4g, [§6.3](06-mechanics-as-modules.md#63-view-full-screen-zoom-views-gm4-o5) Gates, with the preload note); labels terms GM6d2's; view pair 17.73 MiB + props + labels; Changed by RULINGS 246 (as of `a064399`; docs lane `docs-errata-16`, group A): the row bounds the current room's states; a kept room's `state:` set (a neighbour's) is admitted after the neighbour bgs, only into what they left under the 32 MiB steady cap, so a neighbour's background outranks it ([§6.4](06-mechanics-as-modules.md#64-visual-state-derived-room-pictures-gm3b-replaces-lfu3s-b-001-fix)) | row (32 MiB) |
| knot-set | <= 27.3 MiB (`:160`) | unchanged formula | row |
| first-line latency | - | 0 added requests; the world is already fetched with the chapter; round 11: `prefetch()` runs at the first line as today, at a resume onto a yield and after a section's first room, never before a chapter's first line (D13 kept); round 12 (critique_engine_r11 m4, m5): and at every yield step between its pictures' loads and its transition (`ahead`); D13 holds on every path but one stated exception, a resume onto a yield, whose chunks (<= 29.3 KB br at the LIMITs) share the link with the resumed pictures (<= 0.12 s at 2 Mbit/s bandwidth-bound, ARITHMETIC), so "D13 kept" now reads "D13 kept, with that exception"; reconcile r1 (LFL merged, RULINGS 155): LFL requests the meta controller chunk at the first step shown (`GameMeta.stepShown`, from `present`), so at a resume onto a yield it joins those chunks: <= 29.3 + 6.0 (`metaControllerChunkBr`, `client/scripts/budget.ts:116` on `cec347c`) = 35.3 KB br, <= 0.14 s at 2 Mbit/s (ARITHMETIC: 35,300 x 8 / 2,000,000 = 0.141 s); its request still follows the resumed step, never precedes a chapter's first line (LFL's G2, `client/e2e/perf.spec.ts`); the first line of a chapter is never delayed (no prefetch runs before it on a path that has one); per first room entry the state images (`state:<room>`, each <= 60,000 B AVIF / 90,000 B WebP) follow the room's own bg, counted once by the chapter's `transfer` row; round 13 (critique_engine_r12 W2): a zoom round trip fetches none again, a return after the room left the keep set fetches its k images again (k x LIMIT, §6.4) | TTFL e2e as built |
| story checks | - | new lints each seen red on a seeded world; line IDs for every new `WorldText`; scan-dist unchanged (no answer of a `secret` puzzle in `dist/`: `ritual` / `setting` solutions only in server content, proven by the emit tests, m3); round 3: `world/answer-len` with its server pin, `world/device-failed-state`, `world/attempts-without-wrong`; round 4: `world/view-type-site`, `world/device-type`, `world/device-parts-frame`; round 5: `world/device-closeup` (W2), `world/device-parts-frame` with the safe frame and the derived band (m5), `world/reach-solution`'s "not reached at `initial`" clause (W3); round 6: every module text a line of the walk (en checks, shipped en, `id/chapter-prefix`, needles) and `world/text-unwalked` (W1), the band 496 (m1), ch3's join at a knot top with no `graph/entry-below-top` (W2); every new code in a registered lint file's `codes`, unique across registries (GM1d's test), and `dsl-doc: lint table equals lint codes` pinned at 86 rows in every lane; round 7: `world/text-unwalked` fed by the walk's own per-module IDs (`WorldLintInput.moduleLines`), `texts.ts` value-importing nothing (a source test), `--fix-ids`' world-place skip pinned (GM5) | `story` gate; `test` |
| world json (ch3, new, round 4) | - (no world) | GM8d's demo section, MEASURED in its build log against the same rows; round 5: one more placeholder bg (`fog_gallery`, m8) in the ch3 transfer and room-set rows | rows (8 KB br, 32 KB raw); room-set for its rooms and device views |
| answer length (round 3, W3) | server 16 (`puzzles/mod.rs:21`); Changed by RULINGS 164, 168 (as of `9b4fd25`; docs lane `docs-errata-11`, group A): the server bound is **64** since GM6s1 (`81a15b0`; `server/src/puzzles/mod.rs:34` `MAX_ANSWER_LEN` on `9b4fd25`, and from GM6s2 the content load refuses an `answerLen` above it, `server/src/content.rs:1041-1042`) | build bound 16, 64 from GM7g; every posted length <= the bound | `world/answer-len` + the `<=` pin, each seen red |

Changed by RULINGS 201, 208 (as of `461424d`; docs lane `docs-errata-13`, group A): two rows this table does not list:
**all JS** has LIMIT **365.0 KB br** (`allJsBr` 365,000, `client/scripts/budget.ts:132`; RULINGS 201 QS3, written by
lane X; §11.1 Ledger 3), 284,488 B MEASURED at `597dded`; lever X moved the **first-load** rows ch1 306,278 -> 292,076 B
and ch3 288,426 -> 274,224 B (-14,202 each, MEASURED at `597dded`), with the first line 256,519 -> 242,304 B (-14,215).

Changed by RULINGS 172, 284 (as of `768fc9d`; docs lane `docs-errata-17`, group A): GM4g (`56cc302`) made the
**first-load** rows count the head chapter's public world (a chapter with a world source) and its en table, the files
`loadFree` awaits for an en-UI player (`firstLoadRows`, `client/scripts/budget.ts:1272`; §15 item 1): ch1 284,674 ->
**288,371** B (+ world 1,554 + en 2,143), ch3 266,564 -> **267,886** B (+ en 1,322), MEASURED at the merge (RULINGS
284); after SH4 (`768fc9d`, RULINGS 290) ch1 **292,787** and ch3 **272,302** B against 800,000.

Changed by RULINGS 213, 224 (as of `52e328e`; docs lane `docs-errata-14`, group A): lever P added a lazy row this table does not
list, **`purchase-flow chunk (br)`**, LIMIT **2.0 KB br** (`purchaseFlowChunkBr` 2,000, `client/scripts/budget.ts:141`;
the family `:226`) with a **1.75 KB review trigger** (an attribution, not a split), 1,468 B MEASURED at `3d120bc`
(RULINGS 213 Q1). The rows on main `8e099ee` (MEASURED, RULINGS 224): entry 38,219, engine 195,956 (one chunk),
first line 234,175, explore-ui 9,366, cue-stage 5,981, all JS 264,905 B against 365,000 (14 files); the per-merge
figures are §11.1's bullets.

Changed by RULINGS 229, 231, 234, 236 (as of `0b91acc`; docs lane `docs-errata-15`, group A): lever O5 added a lazy row this table does
not list, **`overlays chunk (br)`**, LIMIT **3.0 KB br** (`overlaysChunkBr` 3,000, `client/scripts/budget.ts:148`; the
family `:239`: root `src/ui/overlays/index.ts`, importer `app/game.ts`), 2,498 B MEASURED at `9a0ae2d` (RULINGS 234).
The first-load rows moved with it: ch1 282,707 -> 280,831 B and ch3 264,855 -> 262,979 B at O5's merge, then
281,110 / 263,258 B at the Q64 fix's merge `d820803` (RULINGS 236). The rows of `0b91acc`'s code (MEASURED at the Q64
fix's merge): entry 38,309, engine **194,715** (one chunk), first line **233,024**, all JS 266,611 B against 365,000
(15 files), CSS 3,857; 91 rows PASS; every lazy row, the overlays chunk's included, equal to O5's by module identity.

Changed by RULINGS 171 (as of `9a83251`; docs lane `docs-errata-10`, group A): **spike P2-a, MEASURED** (GM1b
`03a00bc`, `client/scripts/story/spike-p2.test.ts`, eight seeds, a quiet machine): states per configuration (§7.6) —
base 406-528, views at 2 per room 1,174-1,456 (the asserted claim holds), flags 896-1,410, kept tools 1,516-1,840,
recipes 3,276-4,140, clue facts 1,516-1,840, the full mix at `cap` (5,000) on every seed (reported, not asserted); the
real ch1 406, with views 1,174. The full mix at `cap` is the input GM4's cut reads ([§7.6 State-space budget and spike
P2](07-puzzle-types.md#76-state-space-budget-and-spike-p2-r2-m4)).
Changed by RULINGS 309, 312, 316, 317, 322, 326 (as of `f6487fc`; docs lane `docs-errata-19`, group A): **spike P2-b**
(GM5 `5190235`, real views and recipes) and **P2 with the place quotient** (GM5q `5142d5d`, places, expansions and work
per arm), both MEASURED on eight seeds (ms not measured), are §7.6's two tables. With the quotient: `views-real` 406-528
places (= base), `views+recipes-real` 1,868-2,300 (= `recipes-real`; without it, `cap` on every seed), work at most
21,868 of W = 40,000, and the real ch1 406 places (540 without). The cap now has two bounds, places and work
(PUZZLES-PLAN "The cost"); the measured 3.9-4.5 µs per evaluation against the model's 2 µs is OPEN-QUESTIONS Q70
(RULINGS 318).

### 11.1 The shared ledgers (reconcile r1, r2; RULINGS 143 QO10, 152 R4, 153, 155; design-shots I-13)

One ledger per row across the three designs (this file "EN", `per-player.md` "PPL", `design/shots/proposal.md`
"SH"); it replaces this file's earlier first-line and entry bullets (§3.5) and the shots proposal's §10 first-line
ledger ([shots §10 Budgets and validation](../shots/10-budgets-and-validation.md#10-budgets-and-validation-summary); §30 item 7). KB = 1,000 B, brotli q11 (`m3s-memory-half-paid/merge/build.log:90`).

- **Main `3c62a86`, MEASURED** (the adoption base, RULINGS 158): entry 38,988, engine 215,087, first line 254,075 (entry + engine closures), meta controller 5,242, puzzle-type chunk 1,625, all JS 272,130 B (`budget.ts`'s own evaluate on a scratch build; the entry is +36 B over LFL's with only a comment change: chunk-hash churn).
- **Main `03a00bc`, MEASURED** (Changed by RULINGS 159, 162, 165, 171 (as of `9a83251`; docs lane `docs-errata-10`, group
  A); `03a00bc` is GM1b's merge, and `9a83251` changes only `docs/` after it): entry 37,245, engine 215,004, first line
  252,249, explore-ui 8,395, all JS 273,747 B (exact bytes, `budget.ts`'s evaluate at GM1b's merge check, RULINGS 171).
  Per lane, main -> merge (exact bytes): **L1** `eec24fe` entry -1,650, engine +1,863, first line +213, all JS +164 (RULINGS
  159; its CLAIM above read -1.59 / +0.21); **GM1a** `ef8b4dc` entry -60, engine -1,908, first line -1,968, explore-ui
  4,912 -> 7,205 (+2,293), all JS +334, in place of §3.5's -2.3 / +2.3 (RULINGS 162, 165: the first line loses 0.33 KB of
  the planned fall); **GM1b** `03a00bc` entry -33, engine -38, first line -71, explore-ui 7,205 -> 8,395 (+1,190 against
  +0.25), all JS +1,119, in place of §3.5's +0.3 / +0.25 (RULINGS 171). The remaining EN terms (GM1c-GM9r, ARITHMETIC
  from §3.5): engine 1.71 + 2.3 - 0.3 = **+3.71**; explore-ui 7.61 - 2.3 - 0.25 = 5.06; EN all JS 13.44 - 0.55 = 12.89.
  On this base (ARITHMETIC; every other term as in the ledgers below): first line 252.249 + 13.50 = **265.749** / 270.0
  (4.251 left, PASS; the peak, SH7's -0.2 last, 265.949); entry 37.245 + 0.51 = **37.755** / 40.0 (2.245 left); all JS
  273.747 + 29.164 = **302.911** / 305.0 (2.089 left), + GM7p and GM7g (2 x 1.625) 306.161 before RULINGS 158's re-set
  at GM7p (unchanged); engine closure 215.004 + 12.99 = **227.994** / 230.0 (2.006 left); explore-ui 8.395 + 5.06 =
  **13.455**, ~13.45 / 16.0, 0.55 KB under §3.5's 14.0 split line (RULINGS 171; per-player's +0.04 not included, as
  RULINGS 171 reads it). The case tables below stay as the adoption's record at `3c62a86`.
- **Main `9b4fd25`, MEASURED** (Changed by RULINGS 176, 178, 181 (as of `9b4fd25`; docs lane `docs-errata-11`, group
  A); `9b4fd25` is GM2a's merge): entry 37,509, engine 215,336, first line 252,845, explore-ui 8,395, puzzle-type
  1,616, all JS 274,362 B (exact bytes, `budget.ts`'s evaluate at GM2a's merge check, RULINGS 181; the puzzle-type
  figure from that check's row, which RULINGS 181 does not quote). Per lane, main ->
  merge (exact bytes): **GM6s2** `2815340` entry **+317** (37,245 -> 37,562) in place of Ledger 2's +0.09 term, a PASS
  by §3.5's STOP rule (227 B over the term, under its 0.5 KB; RULINGS 176), engine -17, first line +300, puzzle-type
  +25, meta controller +14, explore-ui +1, all JS +329; **GM1c** `8c2fa03` entry -60, engine +16 against §3.5's +0.13,
  first line -44, puzzle-type 1,639 -> 1,618 (-21, its gate 0.1 KB), explore-ui 8,396 -> 8,392, all JS -77 (RULINGS
  178); **GM2a** `9b4fd25` entry +7, engine +333 against §3.5's +0.33, first line +340, explore-ui 8,392 -> 8,395 (+3),
  puzzle-type 1,618 -> 1,616 (-2), all JS +363 (RULINGS 181). The remaining terms (ARITHMETIC): EN engine 3.71 - 0.13 - 0.33 = **+3.25** (GM1d-GM9r);
  EN all JS 12.89 - 0.13 - 0.33 = 12.43; PPL entry 0.35 - 0.09 = 0.26 (GM6t); PPL all JS 3.524 - 0.09 - 0.004 = 3.430.
  On this base (ARITHMETIC; every other term as in the ledgers below): first line 252.845 + (3.25 + 0.05 + 0.01 + 3.13
  + 0.26 + 6.25 = 12.95) = **265.795** / 270.0 (4.205 left, PASS; the peak, SH7's -0.2 last, 265.995); entry 37.509 +
  (0.05 + 0.01 + 0.26 + 0.10 = 0.42) = **37.929** / 40.0 (2.071 left, 1.571 above L1 / L2's 0.5 line); all JS 274.362 +
  (12.43 + 3.430 + 12.75 = 28.61) = **302.972** / 305.0 (2.028 left), + GM7p and GM7g (2 x 1.625) 306.222 before
  RULINGS 158's re-set at GM7p (unchanged); engine closure 215.336 + (3.25 + 3.13 + 6.15 = 12.53) = **227.866** /
  230.0 (2.134 left); explore-ui 8.395 + 5.06 = **13.455**, ~13.45 / 16.0 (GM1c's and GM2a's explore-ui terms were 0).
- **Main `837b1ed`, MEASURED** (Changed by RULINGS 183, 186, 188, 190, 193, 196 (as of `837b1ed`; docs lane
  `docs-errata-12`, group A); `837b1ed` is GM3c's merge): entry 37,486, engine 217,077, first line 254,563, explore-ui
  8,433, all JS 276,107 B (exact bytes, `budget.ts`'s evaluate at GM3c's merge check, RULINGS 196). Per lane, main ->
  merge (each lane's own measurement, as its ruling quotes it): **GM1d** `794181b` entry +42 (churn), engine +96
  (churn across the closure; its term 0), first line +138, explore-ui +20, puzzle-type +22, all JS +165 (the tester's
  two trees on one machine, `gm1d-mech-clues/test_r1.md:76`; RULINGS 183); **GM3w** `508bd36` entry -14, engine
  **+15.8** (mean of 4 builds per tree; one build +80) against its +0.03 term, first line +66, explore-ui +19,
  puzzle-host +21, all JS +81 (RULINGS 186); **per-player GM6a** `23e1d31` engine **+469.6** (mean of 4, 215,546.2 ->
  216,015.8) against its +0.15 term (320 B over, 180 B under the term + 0.5 KB STOP line: a PASS), entry -10.8, first
  line +458.8, all JS +431.8 (means; RULINGS 188); **GM2b** `1782d6d` entry -60, engine **+400** against +0.1 (a PASS:
  300 B over the term, under term + 0.5), first line +340, all JS +331, world ch1 br 1,719 -> 1,506 and raw 10,779 ->
  5,253, ch2 br 286 -> 255 and raw 569 -> 394 (4 builds per tree, identical; RULINGS 190; §5.4); **GM3m** `a3f0678`
  no row moves (entry -5, engine -20, first line -25, all JS -78: nothing mounted; its +0.16 engine and +2.75
  cue-stage terms are measured with GM3s's build; RULINGS 193); **GM3c** `837b1ed` entry +7, engine **+605** against
  +0.2 (405 B over the term, inside the 0.5 KB STOP margin), first line +612, explore-ui -1, all JS +605
  (deterministic over 4 builds per tree; RULINGS 196), and its explore-ui +0.3 moves to GM3 (cut Q5, RULINGS 192). The
  remaining terms (ARITHMETIC): EN engine 3.25 - 0 (GM1d) - 0.03 (GM3w) - 0.1 (GM2b) - 0.2 (GM3c) = **+2.92**
  (GM3m's +0.16 stays planned); PPL engine 3.13 - 0.15 (GM6a) = **+2.98**; the entry terms 0.05 (GM3s) + 0.26 (GM6t)
  + 0.10 (SH3a) = 0.41 (GM3w's 0.01 merged); EN all JS 12.43 - 0.03 - 0.01 (GM3w) - 0.1 (GM2b) - 0.2 (GM3c) = 12.09;
  PPL all JS 3.430 - 0.15 = 3.280; EN explore-ui 5.06 (GM3c's +0.3 moved to GM3, not removed). On this base
  (ARITHMETIC; every other term as in the ledgers below): first line 254.563 + (2.92 + 0.05 + 2.98 + 0.26 + 6.25 =
  12.46) = **267.023** / 270.0 (2.977 left, PASS; the peak, SH7's -0.2 last, 267.223); entry 37.486 + 0.41 =
  **37.896** / 40.0 (2.104 left, 1.604 above L1 / L2's 0.5 line); all JS 276.107 + (12.09 + 3.280 + 12.75 = 28.12) =
  **304.227** / 305.0 (0.773 left), + GM7p and GM7g (2 x 1.625) 307.477 before RULINGS 158's re-set at GM7p
  (unchanged); engine closure 217.077 + (2.92 + 2.98 + 6.15 = 12.05) = **229.127** / 230.0 (**0.873 left**, under
  RULINGS 195's 1.0 KB trigger: Ledger 4 below); explore-ui 8.433 + 5.06 = **13.493** / 16.0 (0.507 under §3.5's 14.0
  split line). The ledgers' running figures between these merges are the rulings' (RULINGS 188: 228.366 at
  `23e1d31`; 190: 228.742 at `1782d6d`).
  **Ruled: RULINGS 186** — a row judged against a bound tighter than the chunk-hash churn (tens of bytes) is judged on
  the mean of at least 4 builds per tree, never on one build.
- **Main `65e10ad`, MEASURED** (Changed by RULINGS 201, 204 (as of `461424d`; docs lane `docs-errata-13`, group A);
  `65e10ad` is GM3s's merge): entry 37,691, engine 218,828, first line 256,519, explore-ui 8,917, cue-stage 6,108 (a
  new row), puzzle-host 2,527, all JS 284,494 B (exact bytes, the orchestrator's merge check, RULINGS 204). Per lane,
  main -> merge: **SH1** `2db33c3` (main `0fb7018`, code `837b1ed`) engine **+510** against its +0.3 term (mean of 4
  builds per tree), entry +42 (churn), first line +552, all JS +549 (RULINGS 201); **GM3s** `65e10ad` (main `7b9dc6f`)
  entry 37,528 -> 37,691 (**+163** against +0.05; its STOP line +550), engine 217,587 -> 218,828 (**+1,241** against
  GM3m's +0.16 and GM3s's +0.19, one sample over the combined 0.35; QS2's STOP line +1,580), first line +1,404,
  explore-ui 8,430 -> 8,917 (+487 against +0.21), cue-stage **6,108 / 8,500** (review trigger 7,500), puzzle-host 2,530
  -> 2,527, all JS 276,656 -> 284,494 (+7,838; 24 files) (RULINGS 204). GM3s took Branch F: its P0 measured Svelte's
  transition runtime in the **entry at +989 B br** (past 550), so the layer's entrance and exit are cue-stage motions
  (§3.5, RULINGS 195, 198); E1 (the explore root attaches through `bind:this` + `$effect`, rule `svelte-action`)
  MEASURED entry -219 and first line -252, E2 (`cues/root.ts` keeps its own trigger tuple) explore-ui -190 and
  cue-stage -109, with one request fewer (RULINGS 201). **R** (the estimate policy below) at GM3s's merge: engine
  **1.700** (n 9), all JS **2.030** (n 10), entry **3.26** (n 3), explore-ui **2.319** (n 3). Projection on `65e10ad`
  (ARITHMETIC, RULINGS 204): Ledger 4 218.828 + 11.60 x 1.700 = 238.548 with no lever, **224.283** after X; Ledger 2
  37.691 + 0.36 x 3.26 = **38.865**; Ledger 1 277.413 with no lever, **263.148** after X; Ledger 3 **341.072** / 365.0.
- **Main `597dded`, MEASURED** (Changed by RULINGS 207, 208 (as of `461424d`; docs lane `docs-errata-13`, group A);
  `597dded` is lever X's merge): entry 37,708, engine **204,596**, first line **242,304**, first-load ch1 292,076 and
  ch3 274,224, all JS 284,488 B against 365,000 (exact bytes, the orchestrator's merge check after the trunk sync,
  RULINGS 208). Per lane: **SH2** `7f45dee` every row byte-identical to main `65e10ad` (a story-tool lane: no engine
  term, no R sample; RULINGS 207); **lever X** `597dded` (main `65e10ad`) engine **-14,232**, first line **-14,215**,
  first-load ch1 / ch3 **-14,202** each, entry +17 (churn; mean of 4 per tree), all JS **-6**, explore-ui +3,
  cue-stage +5, puzzle-type -14, puzzle-host +1, meta-ui +5 (hash churn; module identity held, RULINGS 206 Q1); one
  serial request fewer at mount; the throttled time to first line (information only, RULINGS 206 Q3) main 4110 / 3880 /
  4015 ms, HEAD 3460 / 3392 / 3425 ms (limit 6000). **R unchanged** (a lever and a no-term lane add no sample): engine
  1.700, all JS 2.030, entry 3.26, explore-ui 2.319. Projection on `597dded` (ARITHMETIC, RULINGS 208): Ledger 4
  204.596 + 11.60 x 1.700 = **224.316** / 230.0 (5.684 left; 222.802 after P); Ledger 2 37.708 + 0.36 x 3.26 =
  **38.882** / 40.0 (1.118 left); Ledger 1 = Ledger 2 + Ledger 4 = **263.198** / 270.0 (6.802 left); Ledger 3 284.488 +
  6.464 + 1.600 + 23.94 x 2.030 = **341.150** / 365.0 (23.85 left). No ledger is under the 1.0 KB trigger, so O5 and Y
  wait; engine-adding cuts may start again (QS2's condition met), each quoting E, R and E x R.
  **Ruled: RULINGS 206** — a lever's lazy family rows (and the entry, beside its mean of 4 builds) are judged by
  **module identity**: the chunk list and count equal main -> HEAD, and each chunk file's raw text byte-equal after
  normalising hashed names (`-<8 chars>.js|css` -> `-H.js|css`) and the 16-hex build id; a difference after
  normalisation is a STOP, and the br delta is quoted as churn (above 0.5 KB a STOP anyway). The throttled time to first
  line is information only, never a gate.
- **Main `3d120bc`, MEASURED** (Changed by RULINGS 213 (as of `52e328e`; docs lane `docs-errata-14`, group A); `3d120bc` is lever
  P's merge): engine 204,596 -> **203,122** (**-1,474**, 9 chunks; 40 B short of its -1.514 forecast), first line
  242,304 -> 240,852 (-1,452), entry 37,708 -> 37,730 (+22, the tester's mean of 4), all JS 284,488 -> 284,447 (-41),
  the new `purchase-flow` row 1,468 / 2,000, explore-ui 8,917, cue-stage 6,112, meta-ui 6,441, meta controller 5,219
  (exact bytes, the orchestrator's merge check). **R unchanged** (a lever adds no sample). Projection (ARITHMETIC,
  RULINGS 213): Ledger 4 **222.842** (7.158 left), Ledger 2 38.904, Ledger 1 **261.746**, Ledger 3 341.109; O5's
  design threshold stays 0.505 KB (conservative, since P saved less than forecast).
- **Main `7082a35`, MEASURED** (Changed by RULINGS 216, 217 (as of `52e328e`; docs lane `docs-errata-14`, group A); GM3's
  merge): entry 37,730 -> 37,693 (-37, churn; term 0), engine 203,122 -> **204,314** (**+1,192** against +0.2;
  accepted as GM3's measured delta, RULINGS 216), first line 240,852 -> 242,007 (+1,155), explore-ui 8,917 -> 10,317
  (+1,400), cue-stage 6,112 -> 6,151, puzzle-host 2,530 -> 2,524, puzzle-type 1,607 -> 1,610, meta-ui 6,441 -> 6,455,
  all JS 284,447 -> 287,082 (+2,635). **R** (RULINGS 217): the engine sample 1.192 / 0.2 = 5.96 makes n 10 (-0.127,
  0.123, 0.527, 1.009, 1.700 | 3.025, 3.131, 3.546, 4.000, 5.96), median **2.3625**; all JS 2.635 / 1.3 = 2.027 ->
  **2.027** (n 11); entry no sample (3.26); explore-ui 1.273 joins, 2.319 kept until GM3u rebuilds the list.
  Projection on `7082a35` (ARITHMETIC): Ledger 4 204.314 + 11.40 x 2.3625 = **231.247 (FAIL 1.247)**; Ledger 2
  37.693 + 0.36 x 3.26 + the recovery lane's booked +0.43 = **39.297**; Ledger 1 **270.544 (FAIL 0.544)**; Ledger 3
  about **341.04**. **The trigger fired**: O5, then Y, before the next engine-adding cut (after O5's ESTIMATED -2.010:
  229.237; after Y's -3.3: 225.937).
  **Ruled: RULINGS 227** — an erratum to this bullet's Ledger 2: the recovery lane's booking was **0.73** (RULINGS 215:
  E 0.73, R 1.0), not 0.43, so Ledger 2 on `7082a35` = 38.867 + 0.73 = **39.597** (0.403 left) and Ledger 1 **270.844
  (FAIL 0.844)**; no decision changes (the trigger fired on Ledger 4 either way, and RULINGS 224 replaced the booking
  with the measured +0.504).
- **Main `3131844`, MEASURED** (Changed by RULINGS 219, 223 (as of `52e328e`; docs lane `docs-errata-14`, group A); GM3k's
  merge, type-only): with the build id pinned, all 127 `client/dist` files and all 17 rows byte-identical main ->
  HEAD (RULINGS 219 Q3); the real build's rows differ by the id's churn only: entry 37,715, engine 204,329, first line
  242,044, explore-ui 10,319. No R sample. Ledger 4 204.329 + 11.40 x 2.3625 = 231.26 (FAIL): the trigger held
  formally until the recovery lane's merge re-based the engine.
- **Main `8e099ee`, MEASURED** (Changed by RULINGS 215, 224 (as of `52e328e`; docs lane `docs-errata-14`, group A); the
  recovery lane's merge, one build, the tester's 4-build means agree): entry 37,715 -> **38,219** (+504; booked +0.73
  at R 1.0, review +730, STOP +1,096: PASS), engine 204,329 -> **195,956** (**-8,373**; one chunk), first line 242,044
  -> 234,175 (-7,869), explore-ui 10,319 -> 9,366, cue-stage 6,151 -> 5,981, puzzle-host 2,523 -> 1,936, puzzle-type
  1,606 -> 1,287, meta-ui 6,449 -> 5,401, meta controller 5,221 -> 5,118, all JS 287,082 -> **264,905** (-22,177; 23 ->
  14 files), CSS one file. **R** (RULINGS 224): the entry sample 0.504 / 0.73 = 0.690 makes n 4 (-1.40, 0.690, 3.26,
  3.52), median **1.975**; engine and all JS: no sample (term 0; the deltas re-base the ledgers). Projection on
  `8e099ee` (ARITHMETIC): Ledger 4 195.956 + 11.40 x 2.3625 = **222.888 / 230.0 (7.112 left)**; Ledger 2 38.219 + 0.36
  x 1.975 = **38.930 / 40.0 (1.070 left, the tightest)**; Ledger 1 **261.818 / 270.0 (8.182 left)**; Ledger 3 about
  **318.86 / 365.0**. The trigger does not hold: O5 and Y stay approved designs on the shelf (the program below).
- **Main `d5e04ef`, MEASURED** (Changed by RULINGS 228 (as of `0b91acc`; docs lane `docs-errata-15`, group A); E6's merge, the tester's 4
  builds per tree, byte-identical per tree, main `52e328e` -> `23b8ab0`): entry 38,219 -> **38,240** (+21), engine
  195,956 -> **196,067** (+111), first line **234,307**, meta controller 5,118 -> 5,153 (limit 6,000), all JS 264,905 ->
  **265,054**, first load ch1 282,233 / ch3 264,381; 90 rows PASS. **R** (RULINGS 228): the +111 B is deterministic
  but carries build-id churn; by the policy (one merged delta with a positive net term is one sample) the engine sample
  0.111 / 0.01 = 11.1 (C3's `p&&a.suspend()`) makes n 11, median **3.025**, the same without the two tiny-term samples
  (E6's, GM3w's), so no floor rule is added; the entry sample 0.021 / 0.08 = 0.26 makes n 5, median 0.690 -> the
  **floor 1.0**. Projection (ARITHMETIC): Ledger 4 196.067 + 11.40 x 3.025 = **230.552 (FAIL 0.552)**; Ledger 2 38.240 +
  0.36 x 1.0 = 38.600; Ledger 1 **269.152** (0.848 left); Ledger 3 about 319. **The trigger held again** (Ledgers 4 and
  1): O5 launched in lane C (cut and critique at once, its implement stage after GM3u's merge).
- **Main `33b4f8d`, MEASURED** (Changed by RULINGS 230 (as of `0b91acc`; docs lane `docs-errata-15`, group A); GM3u's merge, the tester's 4
  builds per tree, main `d5e04ef` -> `46ef5bf`): entry 38,240 -> **38,267** (+27; term 0), engine 196,067 -> **196,460**
  (+393 against +0.3), first line 234,307 -> 234,727, explore-ui 9,368 -> **9,716** (+348 against +1.2; LIMIT 16,000),
  cue-stage 5,975 -> 6,000, meta controller 5,155, all JS 265,054 -> **265,837** (+783), first load ch1 282,752 / ch3
  264,900; 90 rows PASS. **R** (RULINGS 230): the engine sample 0.393 / 0.3 = 1.31 makes n 12 (-0.127, 0.123, 0.527,
  1.009, 1.31, 1.700 | 3.025, 3.131, 3.546, 4.000, 5.96, 11.1), median **2.3625**, the same without the two tiny-term
  samples; entry no sample (term 0), 1.0; all JS: the sample 0.783 / 1.5 = 0.52 (and E6's, not drawn at RULINGS 228)
  lies below 2.027, which is **kept as an upper bound** (the list's other members are not in the records, so the
  median can only move down); explore-ui: the sample 0.348 / 1.2 = 0.29 joins GM3's 1.273 and GM3s's 2.319 below the
  kept **2.319** (an upper bound for the same reason). Projection (remaining engine terms 11.40 - 0.3 = 11.10): Ledger 4
  196.460 + 11.10 x 2.3625 = **222.684 (7.316 left)**; Ledger 2 38.267 + 0.36 x 1.0 = **38.627**; Ledger 1 **261.311**.
  The trigger does not hold; at the upper middle sample 3.025 Ledger 4 would be 230.038: the engine samples are bimodal
  (five at or under 1.7, six at or over 3.0, one tiny-term outlier), a 7.35 KB swing on 11.10 KB of terms.
- **Main `340f47c`** (Changed by RULINGS 232 (as of `0b91acc`; docs lane `docs-errata-15`, group A); the Q63 fix's merge): `client/vite.config.ts`
  gained `fsModuleCache: false` (a build-id input); the dist is identical after normalising the build id and the hashed
  names (111 files, 0 differences), so no row moves and no R sample.
- **Main `9a0ae2d`, MEASURED** (Changed by RULINGS 229, 231, 234 (as of `0b91acc`; docs lane `docs-errata-15`, group A); lever O5's merge, the
  tester's 4 builds per tree, main `8d388ba` -> `e62fbd1`): entry 38,224 -> **38,296** (+72, mean of 4; STOP +560),
  engine 196,457 -> **194,518** (**-1,939**; saving floor -1,005), first line 234,681 -> **232,814** (**-1,867**; floor
  -1,005), the new `overlays chunk (br)` row **2,498 / 3,000**, all JS 265,797 -> **266,440** (+643, 14 -> 15 files; STOP
  +1,430), CSS 3,808 -> 3,804, first load ch1 282,707 -> 280,831 / ch3 264,855 -> 262,979; every other lazy row equal by
  module identity (`k/normdiff-o5.mts`: only `index.html`, the engine chunk and `style.css` differ after
  normalisation, the overlays chunk only in HEAD). The engine chunk references the overlays chunk once, as a dynamic
  import with an empty preload list; it is in neither `index.html` nor the entry. **The C0 CSS block rule** (RULINGS
  231): one stylesheet (R1) emits the four moved components' blocks at the overlays chunk's place, so from C0 to the
  merge `CSS total (br)` was judged, after normalising the four components' `svelte-<hash>` tokens, by (i) every other
  rule byte-equal in sequence, (ii) each moved block byte-equal, contiguous and in main's internal order, (iii) the four
  blocks together at the stylesheet's end; any other difference a STOP (no element's matching rules come from two
  components, so the block order cannot change a computed style). **R** (RULINGS 234): a lever gives no sample (engine
  2.3625, entry 1.0, all JS 2.027). Projection (remaining engine terms 11.10, entry 0.36): Ledger 4 194.518 + 11.10 x
  2.3625 = **220.742 (9.258 left)**, 228.096 at the upper middle sample 3.025; Ledger 2 38.296 + 0.36 = **38.656 (1.344
  left)**; Ledger 1 232.814 + 26.224 + 0.36 = **259.398 (10.602 left)**. The trigger does not hold at either middle
  sample, so **Y stays on the shelf** (RULINGS 234: it returns when a ledger is within 1.0 KB).
- **Main `d820803`, MEASURED** (Changed by RULINGS 236 (as of `0b91acc`; docs lane `docs-errata-15`, group A); the Q64 fix's merge, the tester's 4
  builds per tree, main `b831b05` -> `f7849f3`): entry 38,296 -> **38,309** (+13; STOP +100), engine 194,518 ->
  **194,715** (+197; STOP +400), first line 232,814 -> **233,024** (+210), all JS 266,440 -> **266,611** (+171; STOP
  +500), CSS 3,804 -> 3,857, `index.html` 285 -> 301, first load ch1 280,831 -> 281,110 / ch3 262,979 -> 263,258; every
  lazy row equal by module identity; 91 rows PASS. A fix gives no R sample (RULINGS 201). Projection: Ledger 4 194.715 +
  11.10 x 2.3625 = **220.939 (9.061 left)**, 228.293 at the upper sample; Ledger 2 38.309 + 0.36 = **38.669 (1.331
  left)**; Ledger 1 233.024 + 26.224 + 0.36 = **259.608 (10.392 left)**. The trigger does not hold; Y stays on the
  shelf.
- **Main `a064399`, MEASURED** (Changed by RULINGS 243, 251, 253, 256, 258, 262, 265, 269 (as of `a064399`; docs lane
  `docs-errata-16`, group A); the rows of each merge are the orchestrator's merge check or the tester's 4 builds per
  tree, exact B br). Per lane, main -> merge:
  - **GM3p** `d478384`: entry 38,309 -> 38,322 (+13), engine 194,715 -> **195,430** (+715 against +0.31; sample
    2.306), first line 233,752, puzzle-host 1,938 -> 2,541, puzzle-type 1,315, explore-ui 9,721 -> 9,805 (the shared
    `cues/root.ts` chunk, RULINGS 233 Q2), all JS 267,725 (RULINGS 243).
  - **Q67's fix** `4f26e8e`: entry 38,416 (+94), engine +6 (hashed names), first line 233,852, cue-stage 6,000 ->
    6,072, all JS 267,907, CSS 3,882 -> 4,040; a fix, no sample (RULINGS 251).
  - **SH3a** `efd3811`: entry 38,548 (+132), engine 195,597 (+161, hashed names: the decoders do not bundle, so no
    sample, and their 1.0 KB term moves to the first importer, SH4 / SH5a), first line 234,145, all JS 268,186, first
    load ch1 283,040 / ch3 264,984 (RULINGS 256).
  - **GM3b** `ac9cab1`: entry unchanged, engine **196,405** (+808 against +0.23; sample 3.513), first line 234,953,
    explore-ui 10,448 (+644), all JS 269,631, first load ch1 283,901 / ch3 265,791 (RULINGS 253, 258).
  - **SH3b** `e1e7637`: every existing row byte-equal (a build tool; no sample); the step-model rows are new
    (RULINGS 262).
  - **Q69's fix** `99be5c1`: entry 38,517 (-31), engine 196,515 (+110), first line 235,032, all JS 269,710; a fix, no
    sample (RULINGS 265).
  - **GM6t** `a064399`: entry **39,179** (+662 against +0.26; the entry R sample **2.55**), engine **196,541** (+26:
    build-id name churn, module identity unchanged), first line **235,720**, all JS **270,402**, first load ch1 284,674
    / ch3 266,564 (RULINGS 269).
  **R** (the estimate policy below): engine **2.666** (n 14, bimodal: -0.127, 0.123, 0.527, 1.009, 1.31, 1.700, 2.306 |
  3.025, 3.131, 3.513, 3.546, 4.000, 5.96, 11.1); a lever or a fix gives no sample (RULINGS 258). Remaining terms
  (ARITHMETIC): engine 11.10 - 0.31 (GM3p) - 1.1 + 1.0 (SH3a, the decoders' term moved) - 0.23 (GM3b) = **10.46**;
  entry 0.36 - 0.10 (SH3a) - 0.26 (GM6t) = **0**: GM6t was Ledger 2's last planned entry term. Projection (RULINGS
  269): **Ledger 4** 196.541 + 10.46 x 2.666 = **224.427 / 230.0 (5.573 left)**; **Ledger 2** **39.179 / 40.0 (0.821
  left)**; **Ledger 1** 235.720 + 27.886 = **263.606 / 270.0 (6.394 left)**. The trigger does not hold: Y stays on the
  shelf until a ledger is within 1.0 KB; the GM3b engine-lever candidate (`visual`'s decoder reusing
  `world/decode.ts`'s private key / rect / id checks) is measured once Ledger 4 or Ledger 1 is within 2.0 KB, or when
  the next engine lever is cut (RULINGS 253, 258). L2's return line (entry headroom under 0.5 KB, RULINGS 142 / 158)
  does not hold: 0.821 KB is left.
  **Ruled: RULINGS 269** — RULINGS 206's +-15 B engine noise applies within one build id. Any source edit, comments
  included, changes the build id (`client/scripts/build-id.ts:23` hashes every file under `src`, `vite-plugins` and
  `public`, tests excepted), which re-hashes the chunk names and moves brotli bytes; across a build-id change a lane's
  engine row is judged by module identity, with the existing STOPs unchanged.
- **Main `768fc9d`, MEASURED** (Changed by RULINGS 277, 284, 290 (as of `768fc9d`; docs lane `docs-errata-17`, group
  A); the orchestrator's merge checks, exact B br). Per lane, main -> merge:
  - **SH3c** `5d3013e`: main's outputs byte-identical (no `src` entry in the catalog), so every row equals
    `a064399`'s; no sample (RULINGS 277).
  - **GM4g** `56cc302`: dist, dist-e2e and every output byte-identical except `build/usage.json`, so every JS row is
    equal; room-set the hall 17,708,296 -> 20,666,516 B; first load ch1 284,674 -> 288,371, ch3 266,564 -> 267,886 (the
    world and en terms); build-only, no sample (RULINGS 284).
  - **SH4** `768fc9d`: entry 39,179 -> **39,164** (-15), engine 196,541 -> **200,969** (+4,428 against E 2.9, under
    the +8.23 KB STOP; sample 4.428 / 2.9 = **1.527**), first line **240,133**, all JS **274,810**, explore-ui 10,446,
    overlays 2,496, puzzle-host 2,542, cue-stage 6,070 (the lazy rows by module identity, build-id bytes only), CSS 4.0
    KB, first load ch1 **292,787** / ch3 **272,302** (RULINGS 290).
  **R** (the estimate policy below): engine **2.306** (n 15: -0.127, 0.123, 0.527, 1.009, 1.31, **1.527**, 1.700,
  2.306, 3.025, 3.131, 3.513, 3.546, 4.000, 5.96, 11.1; SH4's sample moved the median back from 2.666; a lever or a fix
  gives no sample). Remaining terms (ARITHMETIC): engine 10.46 - 2.9 (SH4) = **7.56**; entry **0**. Projection (RULINGS
  290): **Ledger 4** 200.969 + 7.56 x 2.306 = **218.402 / 230.0 (11.598 left)**; **Ledger 2** **39.164 / 40.0 (0.836
  left)**; **Ledger 1** 240.133 + 17.433 = **257.566 / 270.0 (12.434 left)**. The trigger does not hold: Y stays on the
  shelf until a ledger is within 1.0 KB; the GM3b engine-lever candidate is measured once Ledger 4 or Ledger 1 is
  within 2.0 KB (RULINGS 253). L2's return line (entry headroom under 0.5 KB) does not hold: 0.836 KB is left.
- **Main `48489b7`, MEASURED** (Changed by RULINGS 292, 296, 302, 304, 309, 312, 314 (as of `48489b7`; docs lane
  `docs-errata-18`, group A); the orchestrator's merge checks and the testers' means of 4 builds, exact B br). Per
  lane, main -> merge (docs-errata-17 `65f3e56` is docs only):
  - **GM4** `d695053`: engine 200,969 -> **201,123** (+154 against E 0.09, under the +0.740 KB STOP; sample 1.711),
    explore-ui **10,737** (+291 against E 0.5; sample 0.582 recorded), entry **39,152** (-12), first line **240,275**,
    all JS **275,259**, first load ch1 **292,921** / ch3 **272,436** (RULINGS 292).
  - **GM4u** `aac7a97`: engine **201,429** (+306, under the +0.520 KB STOP), explore-ui **10,826** (+89; sample 0.445
    recorded), entry **39,117** (-35, hash text), first line **240,546**, all JS **275,631**, first load ch1
    **293,390** / ch3 **272,750**. The GM4 + GM4u pair's engine sample (154 + 306) / 100 = **4.60** replaces GM4's
    1.711, n stays 16 (RULINGS 296 Q2, 304).
  - **GM5** `5190235`: engine **202,009** (+580 against E 0.2, under the +1.033 KB STOP; sample **2.90**), explore-ui
    **11,391** (+565; sample 0.94 recorded), entry **39,143** (hash text only), cue-stage 6,083, first line
    **241,152**, all JS **276,791**, first load ch1 **293,995** / ch3 **273,355** (RULINGS 312).
  - **SH5a** `48489b7` (merged after GM5, on a tree tested as merged): engine **204,295** (+2,286 on the merge tree;
    on its base `aac7a97` +2,211 raw, under +3.612 KB, and **+1,657 net** by RULINGS 302 Q9, under +3.112 KB; sample
    1.657 / 1.3 = **1.27**), entry **39,163** (+20, hash text only: no entry change by module identity, RULINGS 269,
    309), first line **243,458**, explore-ui **11,385**, cue-stage 6,086, all JS **279,097**, first load ch1
    **296,301** / ch3 **275,661** (RULINGS 314).
  **R** (the estimate policy below): engine **2.603** (n 18: -0.127, 0.123, 0.527, 1.009, **1.27**, 1.31, 1.527,
  1.700, 2.306, **2.90**, 3.025, 3.131, 3.513, 3.546, 4.000, **4.60**, 5.96, 11.1; the median (2.306 + 2.90) / 2;
  RULINGS 314); explore-ui stays **2.319** (its list not rebuilt, RULINGS 214's rule). Remaining terms (ARITHMETIC,
  RULINGS 292, 312, 314): engine 7.56 -> 7.47 (GM4's 0.09) -> 7.461 (after GM4u, as RULINGS 312 counts it) -> 7.261
  (GM5's 0.2) -> **5.961** (SH5a's 1.3; GM5f restates its own term at its cut, RULINGS 306 Q3); entry **0**. Projection (RULINGS 314): **Ledger
  4** 204.295 + 5.961 x 2.603 = **219.811 / 230.0 (10.189 left)**; **Ledger 2** **39.163 / 40.0 (0.837 left)**;
  **Ledger 1** 243.458 + 15.516 = **258.974 / 270.0 (11.026 left)**. The trigger does not hold: Y stays on the shelf
  until a ledger is within 1.0 KB; the GM3b engine-lever candidate waits for a ledger within 2.0 KB (RULINGS 253).
  L2's return line does not hold: 0.837 KB is left.
- **Main `f6487fc`, MEASURED** (Changed by RULINGS 326, 334, 337, 341, 345, 346 (as of `f6487fc`; docs lane `docs-errata-19`, group A); the orchestrator's
  merge checks and the testers' paired builds, exact B br). Per lane, main -> merge (docs-errata-18 `053ccd1` and the
  Q70 commit `9bcfa9b` are docs only):
  - **GM5q** `5142d5d`: engine **204,326**, explore-ui **11,870** (+485, all `search.ts`, under its +500 B STOP), entry
    **39,184**, cue-stage 6,085, first line **243,510**, all JS **279,654**, first load ch1 **296,355** / ch3
    **275,715**; E = 0 for every row, so no R sample (RULINGS 326).
  - **GM5f** `402d4d8`: engine **205,167** (+841 against E 0.25, under the +1,151 B STOP; sample **3.364**, recorded by
    RULINGS 337 Q2 after RULINGS 334 omitted it), explore-ui **12,593** (+723, under +1,428), entry **39,199** (+15, hash
    text) (RULINGS 334).
  - **GM7r** `9516951`: engine 205,129 -> **205,560** on the tester's paired builds (+431 against E 0.31, under the
    +1,307 B STOP; sample **1.390**, recorded by RULINGS 346 after RULINGS 341 omitted it), puzzle-host **2,652** (+112),
    entry **39,152** (-44, hash text), first line **244,712**, all JS **281,694**, first load ch1 **297,557** / ch3
    **276,917**; module identity: only `engine.ts` and `PuzzleHost.svelte` (RULINGS 341).
  - **SH5b** `f6487fc`: engine **206,708** (+1,148 against E 0.45, under the +1,671 B STOP; sample **2.551**), entry
    **39,172** (+20, hash text), every other lazy row equal by module identity, first line **245,880**, all JS
    **282,846**, first load ch1 **298,732** / ch3 **278,092**; budget 112 rows, 111 PASS, 0 FAIL, 1 PENDING (RULINGS 346).
  **R:** engine **2.551** (n 21: -0.127, 0.123, 0.527, 1.009, 1.27, 1.31, **1.390**, 1.527, 1.700, 2.306, **2.551**,
  2.90, 3.025, 3.131, **3.364**, 3.513, 3.546, 4.000, 4.60, 5.96, 11.1; the median is the 11th; RULINGS 346); at
  RULINGS 337 Q2 (GM5f's 3.364 joined) it was **2.90** (n 19). GM7r kept its spec's 2.603 STOP and GM7p keeps its
  ruled STOP (+1,805 B at 2.90, RULINGS 345); later lanes use 2.551. Remaining engine terms (ARITHMETIC): 5.961 after
  SH5a; GM5f's restated 0.25 (RULINGS 306 Q3) booked and spent at its merge; **5.651** after GM7r's 0.31 (the whole
  §3.5 GM7r / GM7p / GM7g row, RULINGS 337 Q1; GM7p and GM7g restate their data halves at their cuts); **6.101** with
  GM7p's running 0.45 (RULINGS 345), unchanged at SH5b's merge (RULINGS 346). Projection at `f6487fc` (RULINGS 346):
  **Ledger 4** 206.708 + 6.101 x 2.551 = 206.708 + 15.564 = **222.272 / 230.0 (7.728 left)**; **Ledger 1** 245.880 +
  15.564 = **261.444 / 270.0 (8.556 left)**; **Ledger 2** **39.172 / 40.0 (0.828 left)**. The trigger does not hold
  (no ledger within 1.0 KB; the engine-lever candidate waits for Ledger 4 or 1 within 2.0 KB, RULINGS 253); L2's
  return line does not hold.
- **The path rule (RULINGS 201; the union rule, budget round r198 design §3.1).** Ledgers 1 and 4 count every JS chunk
  that some supported WebView requests **automatically before its first line** on the boot -> chapter -> first-line
  path, a capability fallback included (Pixi's three renderer facades: a device requests one by what it is): the
  entry's static closure, the engine's static closure and every dynamic import the engine walk reaches that is not a
  lazy root. A chunk is a **lazy root** (its own row, out of Ledgers 1 / 4) when a player action (a tap, Buy, a menu),
  an app event after the first line (a yield, a puzzle, a paywall) or a prefetch scheduled after the first line
  requests it. The named paths where a lazy root is requested before a first line are bounded by their own rows:
  residual (j) (a room- or puzzle-first resume, a yield-first chapter) and the paywall-first session if P's cut keeps a
  prefetch at `openPaywall`; a new such path is named in its lane's cut. **A chunk leaves the rows only when no path
  requests it** (lever X's environment chunks while `SKIP_PIXI_ENV` holds). Moving code between the static engine
  chunk and a renderer-fallback chunk saves 0 on the rows, so probe **G** (Pixi's WebGPU / Canvas modules) is
  **withdrawn**; its return is an engineering ruling at the queue's end, before Q59 is asked. The rule is written once,
  in `engineWalk`'s basis note (`client/scripts/budget.ts:441-452`); `firstLineFiles` (`:470`) gives the e2e the same
  set.
  Changed by RULINGS 213, 214, 215, 218, 224 (as of `52e328e`; docs lane `docs-errata-14`, group A): P kept the prefetch at
  `openPaywall` (RULINGS 213 Q2), so the purchase flow's chunk is requested before any first line by a Continue into a
  saved start of an unowned paid chapter (D11), a locked chapter row on Home (D17) and a pack Buy on Home, each
  bounded by its `purchase-flow chunk (br)` row; a plain start never requests it (the basis note now
  `client/scripts/budget.ts:469-482`, the P paths `:475-479`). Since the recovery lane (`8e099ee`, fork F2): Pixi's
  environment modules load empty while `SKIP_PIXI_ENV` holds (G2; their manifest keys stay, so the walk and
  `scene-env.spec.ts` still read them), and `autoDetectRenderer`'s three renderer `import()`s are static imports (G3,
  `client/vite.config.ts:34-52`, the transform `:61-76`): no renderer facade is requested and the engine closure is
  **one chunk**.
  `ENGINE_STATIC_DEPS_MAX` 0 (`client/scripts/scan-dist.ts:251`) fails the scan when the engine's import waits on
  another JS chunk. The basis note's "Pixi's three renderer facades" (`budget.ts:471`) predates G3; RULINGS 218 Q6
  left `budget*` untouched, so the correction stands here.
  Changed by RULINGS 229, 234, 236 (as of `0b91acc`; docs lane `docs-errata-15`, group A): lever O5's in-play overlays chunk (`overlays chunk
  (br)`) is a lazy root: the Game requests it once, after the first line's reveal (`game.lineShown`, after the
  gameplay chunks' prefetch), and before a first line only by a Menu or Backlog tap during a start or a chapter load, on
  a paywall-first session's empty stage once Back has closed its paywall, or in a room before any line (the basis
  note, `client/scripts/budget.ts:479-494`, its O5 clause `:489-492`); no automatic request precedes a first line, and a failed tap before the
  first line is not followed by the prefetch (RULINGS 229 Q1 (B)). Since the Q64 fix (`d820803`) that empty stage is
  also a tap that opens the pending chapter's paywall again (D11's re-open; it requests nothing new: the purchase
  flow's prefetch is `openPaywall`'s, above), and while the overlays chunk fails a Menu or Backlog tap there shows the
  failure note (`meta.action_failed`).
- **The estimate policy (RULINGS 201; design §5).** **R per row** = the median of MEASURED / term over the lanes merged
  since the adoption (RULINGS 158) with a positive net term on that row; one merged MEASURED delta is one sample (a
  term deferred to a later lane joins that lane's term: GM3m + GM3s is one sample); a row with fewer than 3 samples uses
  the all-JS R; floor 1.0; recomputed and printed in each merge's RULINGS line. At SH1's merge: engine 1.700 (n 9), all
  JS 2.031 (n 10), entry 3.52 (n 3), explore-ui 2.83 (n 3); at GM3s's merge (RULINGS 204): 1.700, 2.030, 3.26, 2.319;
  (Changed by RULINGS 213, 217, 224 (as of `52e328e`; docs lane `docs-errata-14`, group A)) unchanged at P's merge; at GM3's
  (RULINGS 217): engine **2.3625** (n 10), all JS **2.027** (n 11), entry 3.26, explore-ui 2.319 (kept); at the recovery
  lane's (RULINGS 224): entry **1.975** (n 4), the rest unchanged;
  (Changed by RULINGS 228, 230, 234, 236 (as of `0b91acc`; docs lane `docs-errata-15`, group A)) at E6's (RULINGS 228): engine **3.025**
  (n 11), entry **1.0** (the floor; median 0.690, n 5); at GM3u's (RULINGS 230): engine **2.3625** (n 12), all JS 2.027
  and explore-ui 2.319 kept as upper bounds; O5 (a lever) and the Q63 and Q64 fixes gave no sample;
  (Changed by RULINGS 243, 258, 269 (as of `a064399`; docs lane `docs-errata-16`, group A)) at GM3p's (RULINGS 243):
  engine **2.306** (n 13); at GM3b's (RULINGS 258): engine **2.666** (n 14); Q67's, SH3a's (its engine term deferred),
  SH3b's and Q69's merges gave no sample; at GM6t's (RULINGS 269): the entry sample 2.55, with no entry term left;
  (Changed by RULINGS 290 (as of `768fc9d`; docs lane `docs-errata-17`, group A)) SH3c's and GM4g's merges gave no
  sample (build tools); at SH4's (RULINGS 290): engine **2.306** (n 15; the sample 1.527);
  (Changed by RULINGS 292, 304, 312, 314 (as of `48489b7`; docs lane `docs-errata-18`, group A)) at GM4's (RULINGS
  292): engine **2.009** (n 16; the sample 1.711); at GM4u's (RULINGS 304): engine **2.666** (the pair's 4.60
  replaces 1.711, n 16); at GM5's (RULINGS 312): engine **2.90** (n 17); at SH5a's (RULINGS 314): engine **2.603**
  (n 18; Q9's net sample 1.27); (Changed by RULINGS 326, 337, 346 (as of `f6487fc`; docs lane `docs-errata-19`, group A)) GM5q's merge gave no sample
  (E = 0); at GM5f's, recorded by RULINGS 337 Q2: engine **2.90** (n 19; the sample 3.364); at SH5b's (RULINGS 346,
  with GM7r's 1.390 that RULINGS 341 omitted): engine **2.551** (n 21; the sample 2.551);
  the explore-ui samples 0.582, 0.445 and 0.94 recorded, its R kept at 2.319;
  cue-stage and `scene-motion` use the all-JS R. **Stability note:** the engine sample is bimodal (1.009 | 3.025, SH1
  between), so each next sample moves the median toward its own ratio; this is why the trigger is evaluated at every
  merge, and why Ledger 3's one-time LIMIT is set on the upper quartile, not the median. **Booking:** (2a) the unit is
  a lane's **net** term per row (planned module moves included at the same R); a net > 0 books net x R_row; a net <= 0
  books **0** until that lane measures it (so the projection bounds every point of the remaining order); a moved module
  is growth on the row it enters (SH7's `flatten` +0.8 x R on `scene-motion`); a cut's own lines that move an already
  MEASURED module book its MEASURED bytes (R 1.0); (2b) Ledger 1 = Ledger 2 + Ledger 4 (`budget.ts` sums the two
  walks), each term at its own row's R, and Ledger 3 is its own row with its own R; (2c) what a row counts is the path
  rule above, and a lever's saving is measured under it. Every cut states per row E (with its method), R and E x R (an
  estimate made from built bytes takes R 1.0); a ledger STOP is judged on the projection at E x R; the per-lane build
  STOP is a MEASURED delta more than 0.5 KB over **E x R**; an attribution tripwire (no STOP) at E + 0.5 attributes the
  delta by module (deltas within churn judged on the mean of >= 4 builds, RULINGS 186). This section owns R, the
  booking rule, the path rule and the realistic sums; the term tables stay with their owners.
- **Main, MEASURED:** exact bytes on `df0e12c` (code identical to `acc4e0d` and `a5f887b`: the two later commits are
  docs) from `lfl-first-line/test_r2.md:65-69` (budget.ts's own evaluate): entry 38,687, engine 215,015, first line
  258,823 (entry + engine + meta controller chunk, the pre-LFL row, `m3s-memory-half-paid/merge/build.log:94`), all
  JS 271,638; rounded in `m3s-memory-half-paid/merge/build.log:92-100` as 38.7 / 215.0 / 258.8 / 271.6, the brief's
  figures.
- **LFL, MEASURED:** its HEAD `7338d77` (`test_r2.md:65-69`), merged as `cec347c` (RULINGS 155): entry 38,952,
  engine 215,052, first line 254,004 (entry + engine closures, the row LFL redefines), all JS 271,939; the merged
  tree's rounded rows `lfl-first-line/merge/build.log:92-100` (39.0 / 215.1 / 254.0 / 271.9) agree. LFL round 1's
  rows (`test_r1.md:54-58`: 39,012 / 215,024 / 254,036 / 271,949) are superseded by round 2's fix.
- **Lane figures:** CLAIM estimates: EN §3.5 (4.3 B br per line); PPL: **per-player's own term table is the
  input** (reconcile r2, RC-W1: one owner per term, RULINGS 143 QO10; `per-player.md` §10 "Ledgers", [per-player §10 Ledgers](../per-player/10-budgets-and-validation.md#ledgers-reconcile-p4-rulings-143-qo10-145-149-152-shots-i-13-reconcile-r2-one-ledger-enginemd-111) as
  read 2026-11-09, its reconcile revision 2: engine **+3.11**, entry **+0.35**, meta controller **+0.004**, explore-ui
  **+0.04**; its per-lane split is that table's, not restated here); were a later per-player revision to move a term,
  the docs lane takes that table and moves these sums by the difference (ARITHMETIC), and no lane STOPs on it (the
  first such move, **R-E36**: per-player's reconcile r3, in flight on 2026-11-09, reads GM6d2 +0.19, so engine
  **+3.13**, [per-player §10 Ledgers](../per-player/10-budgets-and-validation.md#ledgers-reconcile-p4-rulings-143-qo10-145-149-152-shots-i-13-reconcile-r2-one-ledger-enginemd-111); each ledger below prints its "with R-E36" row beside the r2 row, and the docs
  lane prints whichever per-player's approved table carries); **adoption (main `3c62a86`, docs-adopt):** per-player's approved table (reconcile r4) carries R-E36, so PPL engine is **+3.13** in every ledger below (their "with R-E36" rows folded into the main rows); SH
  [shots §10 Budgets and validation](../shots/10-budgets-and-validation.md#10-budgets-and-validation-summary) (engine 6.15, `scene/motion/` chunk 6.0, entry 0.1), its per-lane split from its §9 lane
  Gates (CLAIM), plus (reconcile r2, RC-m5) SH10's `scene` ids on the cue-stage chunk, **+0.5** (CLAIM: ~111 entries
  x ~18 B raw at ~25 % brotli is ~0.5, the upper end of the critic's 0.2-0.5).
- **L1 / L2's figures** (RULINGS 140 / 142): entry -1.75, first line +0.07 (L1), entry -0.48 (L2), measured on LEL's
  tree (entry 39,352 B, RULINGS 140), so **CLAIM** on today's (reconcile r2, RC-m6; r1 labelled them ARITHMETIC). **Adoption (RULINGS 158):** L1 entry -1.59, first line +0.21 (CLAIM, measured at `cdca9d4`), the figures the cases below use; L2 stays shelved.
- **RC-O1:** SH5a's +1.3 includes rev. 7's synchronous joins and `registry.state` ([shots §10 Budgets and validation](../shots/10-budgets-and-validation.md#10-budgets-and-validation-summary), part of 0.1),
  which LHJ landed (`preload.ts:163-172`, `registry.ts:523-527`), so up to 0.1 is counted twice, in the safe direction;
  kept (the shots own SH5a's figure), and SH5a's cut quotes its measured delta (§30 item 19).

**Ledger 1: JS before the first line (br)**, LIMIT 270.0 (`firstLineJsBr`, `client/scripts/budget.ts:108` on
`acc4e0d`, `:111` on `cec347c`).

| Lane(s) | Add (KB br) | Of which entry | Source |
|---|---|---|---|
| EN engine, GM1a-GM9r | +1.71 (r2; r1 +1.69) | - | §3.5 total row |
| EN entry, GM3s (the `vm.cueStage` slot and mount) | +0.05 | +0.05 | §3.5 |
| EN entry, GM3w (r2, RC-m6: `coversStage` at two App sites and the `.host-failed` Retry's `disabled`, ~2 lines x 4.3 B; bound +0.04 in its Gates) | +0.01 | +0.01 | §3.5 GM3w row; GM3w Gates |
| PPL engine, GM6a-GM6d2 | +3.13 (adoption: per-player's approved r4 table, R-E36; r2 +3.11; r1 +3.00) | - | [per-player §10 Ledgers](../per-player/10-budgets-and-validation.md#ledgers-reconcile-p4-rulings-143-qo10-145-149-152-shots-i-13-reconcile-r2-one-ledger-enginemd-111) (its term table) |
| PPL entry, GM6s2 + GM6t | +0.35 | +0.35 | [per-player §10 Ledgers](../per-player/10-budgets-and-validation.md#ledgers-reconcile-p4-rulings-143-qo10-145-149-152-shots-i-13-reconcile-r2-one-ledger-enginemd-111) |
| SH1 | +0.3 | - | SH §9, the lane's Gates (CLAIM; [shots §10 Budgets and validation](../shots/10-budgets-and-validation.md#10-budgets-and-validation-summary)) |
| SH3a | +1.1 | +0.1 | SH §9 (the `story/shots.ts` decoders 1.0, [shots §10 Budgets and validation](../shots/10-budgets-and-validation.md#10-budgets-and-validation-summary); the catalog namespace strings 0.1, [shots §10 Budgets and validation](../shots/10-budgets-and-validation.md#10-budgets-and-validation-summary)) |
| SH4 | +1.9 | - | SH §9, the lane's Gates (CLAIM) |
| SH5a | +1.3 | - | SH §9, the lane's Gates (CLAIM) |
| SH5b | +0.45 | - | SH §9, the lane's Gates (CLAIM) |
| SH6 | +1.4 | - | SH §9, the lane's Gates (CLAIM) |
| SH7 | -0.2 | - | SH §9 (`flatten` -0.8 into `scene/motion/`, [shots §10 Budgets and validation](../shots/10-budgets-and-validation.md#10-budgets-and-validation-summary), against the loop's growth) |
| SH2, SH3b, SH3c, SH8-SH12b | 0 | - | SH §9: build-only, data, or `scene/motion/` |
| **sum** | **+11.50** (adoption: R-E36 taken; r2 +11.48; r1 +11.34) | +0.51 | ARITHMETIC: 1.71 + 0.05 + 0.01 + 3.13 + 0.35 + (0.3 + 1.1 + 1.9 + 1.3 + 0.45 + 1.4 - 0.2 = 6.25) = 11.50 |

| Case | Base (MEASURED) | Projected | Headroom | Verdict |
|---|---|---|---|---|
| **main `3c62a86`** | 254.075 | **265.575** | **4.425** | PASS |
| main `3c62a86`, the peak (SH7's -0.2 last) | 254.075 | 265.775 | 4.225 | PASS |
| main `3c62a86`, GM3w at its +0.04 bound | 254.075 | 265.605 | 4.395 | PASS |
| main `3c62a86` and L1 (+0.21, CLAIM at `cdca9d4`, RULINGS 158) | 254.075 | 265.785 | 4.215 | PASS |

Rule (design-shots I-13, adopted): every lane of the three designs quotes this row base -> HEAD MEASURED at its cut,
with the still-planned lanes' figures from this table, and STOPs if the projection crosses 270.0; the designed lever
is the shots' lazy `scene/motion/` chunk (already counted), then `flatten` + camera.

**Ledger 2: entry closure JS (br)**, LIMIT 40.0 (`entryJsBr`, `client/scripts/budget.ts:106` on `acc4e0d`, `:109` on
`cec347c`).

| Lane | Add (KB br) | Source |
|---|---|---|
| GM3s | +0.05 | §3.5 |
| GM3w (r2, RC-m6) | +0.01 (bound +0.04, its Gates) | §3.5 GM3w row |
| GM6s2 | +0.09; Changed by RULINGS 176 (as of `9b4fd25`; docs lane `docs-errata-11`, group A): **+0.317** MEASURED at its merge (`2815340`), in place of the term (the `9b4fd25` bullet above) | [per-player §10 Ledgers](../per-player/10-budgets-and-validation.md#ledgers-reconcile-p4-rulings-143-qo10-145-149-152-shots-i-13-reconcile-r2-one-ledger-enginemd-111) |
| GM6t | +0.26 | [per-player §10 Ledgers](../per-player/10-budgets-and-validation.md#ledgers-reconcile-p4-rulings-143-qo10-145-149-152-shots-i-13-reconcile-r2-one-ledger-enginemd-111) |
| SH3a | +0.10 | [shots §10 Budgets and validation](../shots/10-budgets-and-validation.md#10-budgets-and-validation-summary) |
| every other lane of the three | 0 | - |
| **sum** | **+0.51** (r2; r1 +0.50) | ARITHMETIC: 0.05 + 0.01 + 0.09 + 0.26 + 0.10 |

| Case | Base (MEASURED) | Projected | Headroom | Against L1 / L2's line (< 0.5) |
|---|---|---|---|---|
| **main `3c62a86`** | 38.988 | **39.498** | **0.502** | **0.002 above** |
| main `3c62a86`, GM3w at its +0.04 bound | 38.988 | 39.528 | 0.472 | **0.028 under** |
| main `3c62a86` and L1 (-1.59, CLAIM at `cdca9d4`) | 38.988 | 37.908 | 2.092 | above |

The L1 / L2 line (RULINGS 140 / 142): L1 returns when the entry headroom falls under 0.5 KB br. The projection does
not cross it, so L1 stays carried; the margin is 38 B (~9 source lines; r1 read 48 B before GM3w's App expressions
were booked). Named risks: GM3s's Svelte transition runtime (its build measures it; a measured delta past its 0.05 +
the 0.038 margin, i.e. above ~0.09, crosses the line; past +0.55 it is GM3s's own STOP item, §3.5) and SH3a's
decoders reaching the entry (+1.0 -> 40.46, FAIL; §30 item 9). **What crossing means** (reconcile r2 restates r1's
one sentence for both moments): at a lane's **cut**, a projection (the MEASURED base plus every still-planned entry
figure, its own included) under 0.5 headroom is a STOP there, and L1 lands first; at a lane's **build**, a MEASURED
delta that brings the projection under 0.5 does not fail that lane (the LIMIT is 40.0), but L1 becomes the next lane
on its files and every later entry-adding lane's cut STOPs until L1 has merged (§15 item 15); a delta that would
pass 40.0 is that lane's own STOP. `entryJsBr` is never raised.

**Ruled since: RULINGS 158** — L1 is unshelved (RULINGS 142's return condition: 38,988 B + 510 B = 39,498 B, 502 B left against the 500 B line, inside the build's own churn) as lane `l1-entry-summary` (`summaryOf` into `saves/summary.ts`; entry -1.59, first line +0.21, CLAIM at `cdca9d4`); L2 stays shelved. The cut/build crossing rule above stands for every later entry-adding lane, read against the row after L1 merges. Changed by RULINGS 159 (as of `9a83251`; docs lane `docs-errata-10`, group A): L1 merged `eec24fe`; entry 37,338 B MEASURED, 2,662 B left; first line 254,288 B MEASURED.

**Ledger 3: all JS (br)** (design-shots I-13 rev. 3), LIMIT 305.0 (`allJsBr`, `client/scripts/budget.ts:114` on
`acc4e0d`, `:117` on `cec347c`).

| Design | Add (KB br) | Parts |
|---|---|---|
| EN | +13.44 (r2; r1 +13.41) | engine 1.71, entry 0.06 (GM3s 0.05, GM3w 0.01), explore-ui 7.61 (4.9 -> 12.51, §3.5), cue stage 3.28 (new), puzzle-host 0.78 (2.5 -> 3.28, §11) |
| PPL | +3.524 (adoption: R-E36 taken; r2 +3.504; r1 +3.39) | per-player's terms: engine 3.13, entry 0.35, meta controller 0.004, explore-ui 0.04 ([per-player §10 Ledgers](../per-player/10-budgets-and-validation.md#ledgers-reconcile-p4-rulings-143-qo10-145-149-152-shots-i-13-reconcile-r2-one-ledger-enginemd-111), [per-player §10 Ledgers](../per-player/10-budgets-and-validation.md#ledgers-reconcile-p4-rulings-143-qo10-145-149-152-shots-i-13-reconcile-r2-one-ledger-enginemd-111)) |
| SH | +12.75 (r2; r1 +12.25) | engine 6.15, `scene/motion/` 6.0, entry 0.1, cue stage 0.5 (SH10's `scene` ids, RC-m5) |
| **sum** | **+29.714** (adoption: R-E36 taken; r2 +29.694; r1 +29.05) | ARITHMETIC: 13.44 + 3.524 + 12.75 |

| Case | Base (MEASURED) | Projected | Headroom |
|---|---|---|---|
| **main `3c62a86`** | 272.130 | **301.844** | **3.156** |
| + EN's type chunks GM7p, GM7g (each 1.625, the MEASURED `puzzle-type` row on `3c62a86`, CLAIM per new type) | - | 305.094 | **-0.094, FAIL** without the re-set (§15 item 16) |
| + GM8a | - | 306.719 | -1.719 |
| + GM8b | - | 308.344 | -3.344 |
| RULINGS 158's re-set at GM7p (projected) | - | 303.469 + 3 x 1.6 + 5.0 = 313.269 -> **314.0** (GM7p's cut quotes its MEASURED HEAD) | - |

§15 item 16 carries the ruling the third type chunk needs; no lane raises the LIMIT.

**Ruled since: RULINGS 201** (QS3) — Ledger 3 is re-set now, once, to **365.0 KB br** = ceil(292.243 + 23.94 x 2.988 +
1.0): the MEASURED base through SH1 with the four type chunks and the queued levers' all-JS costs (292.243), plus the
remaining all-JS nets (23.94) at the upper quartile (2.988) of the 10 MEASURED all-JS ratios, + 1.0 (ARITHMETIC). It is
crossed only if the median passes 3.04. **RULINGS 158's re-set at GM7p is withdrawn**; lane X wrote `allJsBr` 365,000
(`client/scripts/budget.ts:132`, `597dded`). On `597dded`: 341.150 / 365.0 (the `597dded` bullet above).

**Ledger 4: engine closure JS (br)**, LIMIT 230.0 (`engineJsBr`): main `3c62a86` 215.087 (MEASURED) + 1.71 + 3.13 + 6.15 = **226.077** / 230.0, 3.923 left; the peak before SH7's -0.2 is 226.277 (3.723 left) (ARITHMETIC; the adoption, R-E36 taken; reconcile r2 read 226.02 on LFL's 215.052 and PPL +3.11). (Reconcile r1
read 225.89 on EN +1.69 and PPL +3.00.) The shots' own figure, ~225.2
([shots §10 Budgets and validation](../shots/10-budgets-and-validation.md#10-budgets-and-validation-summary)), used EN's +1.53 and the 214.5 base; superseded here.

**Ruled: RULINGS 190, 195, 196** — Ledger 4 is the budget to watch: when its measured headroom falls under 1.0 KB, an
engine-closure lever lane (a lazily reachable module moved out of the closure, chosen on measured module bytes, a
guard each, the engine row measured main -> HEAD; designed by its own cut, architect + critic) runs before the next
lane that adds engine bytes. On `837b1ed` the projection is 229.127 / 230.0 (0.873 left, the `837b1ed` bullet above),
so the lever runs in the first client slot after GM3s merges and before GM3 or any later engine-adding lane; its
candidates are LFL's Q6 S (`puzzles/session.ts` imported by `yields.ts`, ~-1.19 KB br) and P (`purchase/flow.ts`
imported by `game.ts` on a paywall, ~-1.52 KB br; it joins only if `game.ts` is free, SH1 merged, else it stays the
next lever). Every cut quotes Ledger 4 with its own line-by-line engine estimate; a cut whose projection crosses
230.0 STOPs.

**Ruled since: RULINGS 201, 204, 208** — the lever program replaces the two candidates above: lane **X**
`lever-x-pixi-env` (Pixi `skipExtensionImports` from `client/src/scene/pixi-env.ts`, the fail-safe walk stop, rule
`pixi-env`, `touch-action: none` kept, e2e `scene-env.spec.ts`, the Ledger 3 re-set) merged `597dded` (engine -14,232
MEASURED); **P** (`purchase/flow.ts` lazy at Buy, MEASURED -1.514 engine on an applied build) pre-emptively in the
first client slot after X, beside GM3; then, evaluated at every merge, while Ledger 4 or 1 leaves < 1.0 KB, **O5 then
Y** (S folded into Y) run before the next engine-adding cut, each only on (a) its saving MEASURED on an applied build
under the path rule and (b) a full e2e equal to main's; O5's cut is designed (read-only) once the next positive-term
engine lane (GM3) measures an engine delta >= 0.505 KB (0.557 after P). R and W rejected; G withdrawn (the path rule).
**Basis kept:** `engineJsBr` 230.0 and `firstLineJsBr` 270.0 (the accepted time-to-first-line envelope; X's freed bytes
are planned growth); X rewrote the basis note. When the queue is exhausted (forecast at the second upper-cluster engine
sample after SH1: every lever leaves Ledger 4 at 232.668 and Ledger 1 at 271.597 at R 3.025), each engine-adding cut
first places its own new code behind an existing lazy root; then the owner's **Q59**
([OPEN-QUESTIONS](../../OPEN-QUESTIONS.md)): raise the two LIMITs on the measured throttled time to first line, or
defer named planned engine features; until answered, no engine-adding cut starts past a projected crossing. **Reach**
(design §2.2, ARITHMETIC on the base after SH1, 204.402 after X): the single R up to which a lever set keeps >= 1.0 KB
on Ledger 4 / Ledger 1 is X 2.12 / 2.21, X + P 2.25 / 2.34, X + P + O5 2.42 / 2.52, X + P + O5 + Y 2.71 / 2.80. A 10th
engine sample at GM3's ratio r gives R = (1.700 + clamp(r, 1.009, 3.025)) / 2 (n 10), so the trigger fires at GM3
above 2.53x (2.78x with P merged); at n 11 with both upper samples at 3.025 the queue is exhausted (design §2.2's n 10
/ n 11 tables).

**Ruled since: RULINGS 213, 216, 217, 221, 222, 224** — P merged `3d120bc` (-1,474 MEASURED). GM3's +1,192 (5.96x,
clamped to 3.025) put the engine R at 2.3625 and **the trigger fired at GM3's merge** (`7082a35`: Ledger 4 231.247,
Ledger 1 270.544). O5's and Y's read-only designs ran and were **approved** (O5 r2: Menu, Backlog, Settings and
SaveLoad behind one barrel the Game imports after the first line's reveal, the Paywall and Terms kept in the engine,
EST -1.65..-1.84 KB, one saving floor 1.005 KB; Y r2: the yields body, `puzzles/session.ts` and `explore/project.ts`
as one lazy `app/yield-runtime.ts` chunk behind a facade, EST -3.6 KB, a new row under a 6.0 KB LIMIT). RULINGS 221
put E6 first in lane C after the recovery lane, re-evaluates the trigger at every merge, and holds O5 and Y as
approved designs while Ledgers 4 and 1 both leave >= 1.0 KB. The recovery lane re-based the engine to 195,956 B (one
chunk): on `8e099ee` Ledger 4 is **222.888 / 230.0** and Ledger 1 261.818 / 270.0, so **the trigger does not hold; O5
and Y are on the shelf** (return condition: the trigger holds at a later merge) and the engine-adding lanes resume.
**Q59 recedes:** at the upper ratio 3.025 the engine projects 230.441 without levers, and O5 + Y would leave about 4.9
KB. Ledger 2 (1.070 left) is the tightest: GM6t's and SH3a's entry terms are watched at their cuts.

**Ruled since: RULINGS 228, 230, 234, 236** — E6's merge (`d5e04ef`) moved the engine R to 3.025 and **the trigger
fired again** (Ledger 4 230.552, Ledger 1 269.152): O5 launched in lane C (RULINGS 228). GM3u's merge (`33b4f8d`) put
the R back to 2.3625 (n 12, bimodal) and the trigger no longer held (Ledger 4 222.684), but **the trigger gates
launches only: a lane in flight is not stopped by a later flip, in either direction** (RULINGS 230; GM3u continued when
it fired), so O5 continued. O5 merged `9a0ae2d` (engine **-1,939** B br MEASURED, first line -1,867, the new overlays
row 2,498 / 3,000; RULINGS 234), and the Q64 fix (`d820803`) added engine +197 B, entry +13 (RULINGS 236); a lever
or a fix gives no R sample, so the engine R stays **2.3625** (n 12). The projection after the Q64 fix (ARITHMETIC):
**Ledger 4 220.939 / 230.0** (9.061 left; 228.293 at the upper middle sample 3.025), **Ledger 2 38.669 / 40.0** (1.331
left, the tightest), **Ledger 1 259.608 / 270.0** (10.392 left). **Y stays on the shelf** until a ledger is within
1.0 KB at a merge (RULINGS 234); the engine-adding lanes (GM3p running, then GM3b, SH3a, GM6t, SH5a) take the trigger
check at their launch. Per-merge rows: the bullets above.

**Ruled since: RULINGS 243, 251, 253, 256, 258, 262, 265, 269** — GM3p (`d478384`) moved the engine R to 2.306 (n 13)
and GM3b (`ac9cab1`) to **2.666** (n 14, bimodal); Q67's fix, SH3a, SH3b and Q69's fix gave no sample. GM3b's engine
cost was accepted as measured (RULINGS 253: +1,029 B br on its sync against the +1,030 STOP), and its lever candidate
joined Y on the shelf. After GM6t (`a064399`, RULINGS 269): **Ledger 4 224.427 / 230.0** (5.573 left), **Ledger 2
39.179 / 40.0** (0.821 left; GM6t was its last planned entry term), **Ledger 1 263.606 / 270.0** (6.394 left). **The
trigger does not hold: Y stays on the shelf** until a ledger is within 1.0 KB at a merge; the GM3b candidate is
measured once Ledger 4 or Ledger 1 is within 2.0 KB (RULINGS 253, 258). L2 stays shelved: its return line (entry
headroom under 0.5 KB) does not hold. Per-merge rows: the `a064399` bullet above.

**Ruled since: RULINGS 277, 284, 289, 290** — SH3c (`5d3013e`) and GM4g (`56cc302`) are build tools: every JS row
equal, no sample. SH4 (`768fc9d`) took the engine to 200,969 B (+4,428 against E 2.9; sample 1.527), and **R is back to
2.306** (n 15). After SH4: **Ledger 4 218.402 / 230.0** (11.598 left), **Ledger 2 39.164 / 40.0** (0.836 left),
**Ledger 1 257.566 / 270.0** (12.434 left), with 7.56 KB of engine terms and no entry term left. **The trigger does
not hold**; the GM3b candidate waits for a ledger within 2.0 KB (RULINGS 253); L2 stays shelved. SH4's merge was held
once by the orchestrator's **pre-merge lens check** (RULINGS 289): three independent verifiers (paid content,
lifetime, gate honesty), each finding sent to a refuter; it found one gate claim that could not fail (TM13), pinned
test-only in fix2 before the merge. Per-merge rows: the `768fc9d` bullet above.

**Ruled since: RULINGS 292, 296, 302, 304, 309, 310, 311, 312, 314** — GM4 (`d695053`), GM4u (`aac7a97`), GM5
(`5190235`) and SH5a (`48489b7`) took the engine to 204,295 B. GM4u's pair sample (4.60) replaced GM4's (RULINGS 296
Q2), GM5's 2.90 and SH5a's net 1.27 (RULINGS 302 Q9: the STOP judged on the net delta) joined, and **R is 2.603**
(n 18). After SH5a: **Ledger 4 219.811 / 230.0** (10.189 left), **Ledger 2 39.163 / 40.0** (0.837 left), **Ledger 1
258.974 / 270.0** (11.026 left), with 5.961 KB of engine terms and no entry term left. **The trigger does not hold**;
the GM3b candidate waits for a ledger within 2.0 KB (RULINGS 253); L2 stays shelved. The entry row moved only by
hash text, judged by module identity (RULINGS 269, 309; GM4's -12 B by its tester's module-identity check,
`gm4-mech-views/test_r2.md:57`). The orchestrator's **pre-merge lens check** (RULINGS 289)
ran at every one of the four merges: it found test gaps in GM5 (G-LAYER, an unpinned ruled clause) and in SH5a (G22,
G58, G15, three unpinned new rules), each closed by a fix round before the merge (RULINGS 310, 311; fix2, fix4).
Per-merge rows: the `48489b7` bullet above.

**Ruled since: RULINGS 326, 334, 337, 341, 345, 346** — GM5q (`5142d5d`, no sample), GM5f (`402d4d8`), GM7r
(`9516951`) and SH5b (`f6487fc`) took the engine to 206,708 B. GM5f's 3.364 (RULINGS 337 Q2), GM7r's 1.390 and SH5b's
2.551 (RULINGS 346) joined, and **R is 2.551** (n 21). After SH5b, with GM7p's running term: **Ledger 4 222.272 /
230.0** (7.728 left), **Ledger 1 261.444 / 270.0** (8.556 left), **Ledger 2 39.172 / 40.0** (0.828 left), with 6.101
KB of engine terms and no entry term left. **The trigger does not hold**; the engine-lever candidate waits for Ledger 4
or 1 within 2.0 KB (RULINGS 253); L2 stays shelved. The entry row moved only by hash text, judged by module identity
(RULINGS 269). The pre-merge lens check (RULINGS 289) ran at GM5f (G1, closed by fix3, RULINGS 333), GM7r (no product
defect, RULINGS 341) and SH5b (P1, an upgrade drew no frame, closed by fix2; the delta lenses, RULINGS 343). Per-merge
rows: the `f6487fc` bullet above.

**One owner per figure (reconcile r2, RC-W1).** This section owns the sums, headrooms and verdicts of the three
designs; each design owns its own lane terms (EN §3.5, per-player §10 "Ledgers", the shots §9 / §10 with this
section's RC-m5 addition). A per-lane quote at a cut takes the lane's term from its own design's table and the total
from here. per-player.md prints no total ([per-player §10 Ledgers](../per-player/10-budgets-and-validation.md#ledgers-reconcile-p4-rulings-143-qo10-145-149-152-shots-i-13-reconcile-r2-one-ledger-enginemd-111)), so the two plan files carry one number per row.
