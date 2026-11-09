## 11. Budgets and validation

| Row | Today (MEASURED, `final-build.log`) | After the programme (ARITHMETIC) | Enforced by |
|---|---|---|---|
| entry (br) | 39.4 / 40.0 KB (RULINGS 127); round 11: **38.4** / 40.0 after LEL's merge (RULINGS 141, 38,370 B); reconcile r1: **38,687 B** on `df0e12c` (= `acc4e0d`'s code) and **38,952 B** with LFL (`lfl-first-line/test_r2.md:65`; merged `cec347c`), the three designs' rows in §11.1: **39.45** / 40.0, 0.548 left, 0.048 above L1 / L2's return line (§15 item 15); reconcile r2 (RC-m6): **39.46** / 40.0, 0.538 left, 0.038 above the line, GM3w's App expressions booked +0.01; **main `3c62a86`: 38,988 B** MEASURED (`budget.ts`'s evaluate, docs-adopt) | adoption (main `3c62a86`; supersedes the rounds below; §11.1): **39.50** / 40.0; +0.05 (GM3s slot + mount) -> ~39.45; with per-player's round-4 +0.35 -> **39.80** (round 4; round 11: on 38.4, ~**38.80**, 1.2 KB left, RULINGS 142); Svelte's transition runtime measured at GM3s (§3.5) | row; the carried entry lever first in a lane that would cross; GM3s's STOP item if its delta passes +0.55 |
| engine closure JS (br) | 214.2 / 230.0 KB (`:93`); round 10: **214.5** after M3c (design-shots' M-build, `design/shots/research_S4-engine-fit.md:170`); **main `3c62a86`: 215,087 B** MEASURED (`budget.ts`'s evaluate, docs-adopt) | adoption (main `3c62a86`; supersedes the rounds below; §11.1): **226.08** / 230.0; reconcile r2: +1.71 on LFL's 215,052 B -> ~216.76; the three designs together (+1.71 + 3.11 + 6.15) -> **226.02** / 230.0 (§11.1); reconcile r1: +1.69 on 215,015 B (`test_r2.md:66`, `df0e12c`) -> ~**216.71**, on LFL's 215,052 B -> ~216.74; the three designs together (+1.69 + 3.00 + 6.15) -> **225.89** / 230.0 (§11.1); was +1.62 -> ~**216.12** (round 14: unchanged at two decimals, m3's revive clause in `held` ~1 line, 4.3 B, 1.62 + 0.004 = 1.624, ARITHMETIC; round 12: `held`, `ahead`, the anchor box, +0.01; ~216.02 on LEL's 214.4; round 11: +1.61 -> 216.11; LEL's merge reads the base 214.4, `lel-entry-lever/test_r1.md:48`, so ~216.01 on today's main; round 10: +1.56 -> 216.06, re-based; round 9: +1.53 on 214.2 -> 215.73) | `budget.ts` row; `rules-lazy`; STOP rule |
| JS before the first line (br) | 257.2 / 270.0 KB (`:94`); round 10: **257.9** after M3c (`research_S4-engine-fit.md:171`); reconcile r1: **258,823 B** on `df0e12c` (entry + engine + the meta controller chunk), **254,004 B** with LFL (entry + engine closures; `test_r2.md:67`; merged `cec347c`, RULINGS 155); **main `3c62a86`: 254,075 B** MEASURED (`budget.ts`'s evaluate, docs-adopt) | adoption (main `3c62a86`; supersedes the rounds below; §11.1): **265.58** / 270.0; reconcile r2 (supersedes the rounds below; §11.1): the three designs add 11.48 -> **265.48** / 270.0 with LFL (4.52 left; peak 265.68 before SH7's -0.2), 270.31 (FAIL) on the pre-LFL row; reconcile r1: the three designs add 11.34 -> **265.34** / 270.0 with LFL (4.66 left; peak 265.54 before SH7's -0.2), 270.16 (FAIL) on the pre-LFL row; round 12: + 1.62 (engine) + 0.05 + 3.00 + 0.35 -> ~**262.92**, **7.08 KB left** before the shot design; with design-shots' rev. 7, +6.15 + 0.1, **269.17** / 270.0, 0.83 left, peak 269.37 (0.63 left); round 11: + 1.61 (engine) + 0.05 (entry, GM3s) + 3.00 (per-player engine, its round-10 figure as read, [per-player §12.1 Requests from this file](../per-player/12-interface-requests.md#121-requests-from-this-file-status-after-enginemd-round-9-as-read-2026-11-03-reconcile-revision-1-round-14-as-read-2026-11-09-reconcile-revision-2-enginemds-reconcile-revision-1-as-read-2026-11-09-reconcile-revision-3-enginemds-reconcile-revision-2-as-read-2026-11-09)) + 0.35 (per-player entry) -> ~**262.91**, **7.09 KB left** before the shot design; with design-shots' approved rev. 7, +6.15 + 0.1 ([shots §10 Budgets and validation](../shots/10-budgets-and-validation.md#10-budgets-and-validation-summary), RULINGS 143), **269.16** / 270.0, 0.84 left, peak 269.36 (round 10: 262.86, 7.14, 269.01 with rev. 6's +6.15 in all; LEL's merge leaves the base at 257.9, -15 B, RULINGS 141) (round 9 summed 257.2 + 1.53 + 3.00 = 261.73 without the entry terms; found while resolving) | row |
| explore-ui chunk (br) | 4.9 / 16.0 KB (`:97`) | ~12.51 before MR1 (includes `cues/root.ts` ~0.2; round 9: `frameOut` +0.01; round 12: GM3b's `roomImages`, the `state:` holder and its release branches, `anchorBox`, ~8 lines, +0.03; round 13: the keep-set release and the close-up's two branches, `stateHold`, ~5 lines, +0.02); Changed by RULINGS 171 (as of `9a83251`; docs lane `docs-errata-10`, group A): **8,395 B** MEASURED after GM1a and GM1b, projected **~13.45** / 16.0 (§11.1) | row; split trigger at 14.0 MEASURED |
| request walk (round 13) | - | test-only (`client/src/requests.test.ts`), 0 bundle bytes; its program's wall time MEASURED at GM3p's cut, 60 s test timeout, > 30 s a STOP item; round 14: the batch member, the transport's type, the re-type check over every value flow and the component names add checker work, not bytes (the same program; the time measured with them) | `test` |
| **cue-stage chunk (br), new family** | - (PENDING until GM3s) | ~3.28 (reconcile r2, RC-m5: ~3.78 once SH10 gives every key and control default its `scene` id in `cues/stage/motions.ts`, +0.5 CLAIM, §11.1; round 11: the `checking` loop, `centre`, the `inventory` landing, the edge skip and its count, the DOM-branch count and the played-key panel suffix, +0.06; round 10: the fallback counter, the hit-area ghost and its outline, `holdEnd`, `Resolved` and the `ribbon` landing, +0.07; round 4: the wait hold and four keys; round 5: `offline`, `rate-limited`; round 6: `ready` and the key lines' rounding; round 7: three keys, `with`, the per-panel holds, `CUE_TARGET_ATTRS` and the resolver rules, +0.08; round 9: the two-phase player, `resolveAt`, `PRESET_SITE`, the leave watch, the outroing-root skip, the hold's notice step and the ghost clone, +0.08) | new `LAZY_FAMILIES` row (`budget.ts:159-187`), LIMIT `cueStageChunkBr` 6.0 KB (new), seen red on a fixture over the limit (GM3s); split trigger at 5.0 |
| puzzle-type chunk (br, largest) | 1.6 / 8.0 KB (`:95`) | each new type <= 8.0 | row; GM7p derives roots by glob |
| puzzle-host chunk (br) | 2.5 / 10.0 KB (`:96`) | + `cues/root.ts` ~0.2 and (round 7) the cue-target markers, the load-failed wrapper and Retry's `disabled` ~0.03 (GM3p; round 8: the `disabled={frame.retrying}` attribute lands in GM3w, the same bytes) + the reach `canTry` ~0.01 (GM7r, round 5) + the `room` / `ladder` places with the top bar, its Retry, (round 5) its Try, (round 6) its three-row CSS and (round 7) its 44 px / 18 px rules and markers ~0.52 (GM8h) -> ~3.26; round 9: the frame wrapper, the keyed root and the moved frame styles ~0.01 plus `cues/root.ts`'s `frameOut` ~0.01 (GM3p, GM3s) -> ~3.28 | row |
| world json (per chapter) | ch1 1.7 KB br, 10.8 KB raw (`:120`) | compact emission; MEASURED in GM2b / GM4 | rows (8 KB br, 32 KB raw) |
| room-set | 16.9-18.8 MiB (`:170-172`) | transition-pair term; view pair 17.73 MiB + props + labels | row (32 MiB) |
| knot-set | <= 27.3 MiB (`:160`) | unchanged formula | row |
| first-line latency | - | 0 added requests; the world is already fetched with the chapter; round 11: `prefetch()` runs at the first line as today, at a resume onto a yield and after a section's first room, never before a chapter's first line (D13 kept); round 12 (critique_engine_r11 m4, m5): and at every yield step between its pictures' loads and its transition (`ahead`); D13 holds on every path but one stated exception, a resume onto a yield, whose chunks (<= 29.3 KB br at the LIMITs) share the link with the resumed pictures (<= 0.12 s at 2 Mbit/s bandwidth-bound, ARITHMETIC), so "D13 kept" now reads "D13 kept, with that exception"; reconcile r1 (LFL merged, RULINGS 155): LFL requests the meta controller chunk at the first step shown (`GameMeta.stepShown`, from `present`), so at a resume onto a yield it joins those chunks: <= 29.3 + 6.0 (`metaControllerChunkBr`, `client/scripts/budget.ts:116` on `cec347c`) = 35.3 KB br, <= 0.14 s at 2 Mbit/s (ARITHMETIC: 35,300 x 8 / 2,000,000 = 0.141 s); its request still follows the resumed step, never precedes a chapter's first line (LFL's G2, `client/e2e/perf.spec.ts`); the first line of a chapter is never delayed (no prefetch runs before it on a path that has one); per first room entry the state images (`state:<room>`, each <= 60,000 B AVIF / 90,000 B WebP) follow the room's own bg, counted once by the chapter's `transfer` row; round 13 (critique_engine_r12 W2): a zoom round trip fetches none again, a return after the room left the keep set fetches its k images again (k x LIMIT, §6.4) | TTFL e2e as built |
| story checks | - | new lints each seen red on a seeded world; line IDs for every new `WorldText`; scan-dist unchanged (no answer of a `secret` puzzle in `dist/`: `ritual` / `setting` solutions only in server content, proven by the emit tests, m3); round 3: `world/answer-len` with its server pin, `world/device-failed-state`, `world/attempts-without-wrong`; round 4: `world/view-type-site`, `world/device-type`, `world/device-parts-frame`; round 5: `world/device-closeup` (W2), `world/device-parts-frame` with the safe frame and the derived band (m5), `world/reach-solution`'s "not reached at `initial`" clause (W3); round 6: every module text a line of the walk (en checks, shipped en, `id/chapter-prefix`, needles) and `world/text-unwalked` (W1), the band 496 (m1), ch3's join at a knot top with no `graph/entry-below-top` (W2); every new code in a registered lint file's `codes`, unique across registries (GM1d's test), and `dsl-doc: lint table equals lint codes` pinned at 86 rows in every lane; round 7: `world/text-unwalked` fed by the walk's own per-module IDs (`WorldLintInput.moduleLines`), `texts.ts` value-importing nothing (a source test), `--fix-ids`' world-place skip pinned (GM5) | `story` gate; `test` |
| world json (ch3, new, round 4) | - (no world) | GM8d's demo section, MEASURED in its build log against the same rows; round 5: one more placeholder bg (`fog_gallery`, m8) in the ch3 transfer and room-set rows | rows (8 KB br, 32 KB raw); room-set for its rooms and device views |
| answer length (round 3, W3) | server 16 (`puzzles/mod.rs:21`); Changed by RULINGS 164, 168 (as of `9b4fd25`; docs lane `docs-errata-11`, group A): the server bound is **64** since GM6s1 (`81a15b0`; `server/src/puzzles/mod.rs:34` `MAX_ANSWER_LEN` on `9b4fd25`, and from GM6s2 the content load refuses an `answerLen` above it, `server/src/content.rs:1041-1042`) | build bound 16, 64 from GM7g; every posted length <= the bound | `world/answer-len` + the `<=` pin, each seen red |

Changed by RULINGS 171 (as of `9a83251`; docs lane `docs-errata-10`, group A): **spike P2-a, MEASURED** (GM1b
`03a00bc`, `client/scripts/story/spike-p2.test.ts`, eight seeds, a quiet machine): states per configuration (§7.6) —
base 406-528, views at 2 per room 1,174-1,456 (the asserted claim holds), flags 896-1,410, kept tools 1,516-1,840,
recipes 3,276-4,140, clue facts 1,516-1,840, the full mix at `cap` (5,000) on every seed (reported, not asserted); the
real ch1 406, with views 1,174. The full mix at `cap` is the input GM4's cut reads ([§7.6 State-space budget and spike
P2](07-puzzle-types.md#76-state-space-budget-and-spike-p2-r2-m4)).

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

**One owner per figure (reconcile r2, RC-W1).** This section owns the sums, headrooms and verdicts of the three
designs; each design owns its own lane terms (EN §3.5, per-player §10 "Ledgers", the shots §9 / §10 with this
section's RC-m5 addition). A per-lane quote at a cut takes the lane's term from its own design's table and the total
from here. per-player.md prints no total ([per-player §10 Ledgers](../per-player/10-budgets-and-validation.md#ledgers-reconcile-p4-rulings-143-qo10-145-149-152-shots-i-13-reconcile-r2-one-ledger-enginemd-111)), so the two plan files carry one number per row.
