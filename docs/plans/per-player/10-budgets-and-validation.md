## 10. Budgets and validation

| Row | Change | Figure |
|---|---|---|
| entry (40.0 KB br LIMIT, 39.4 MEASURED after M3c, RULINGS 127; m8; r3 W1) | 2 endpoints, the changed attempt call, 2 decoders + 2 changed, 1 error code (GM6s2; `HintUseResponse` unchanged, m3); `toast-motion.ts` (keyframe table, `playToast`, `stackOf`) + `Toast.svelte`'s ghost stack and effect (GM6t). **Not** in the entry: Svelte's transition runtime (no directive in an entry component: GM6t uses `Element.animate`; CLAIM ~1-2 KB br avoided), GM6c2's strings (`i18n/values.ts`, engine chunk) | ARITHMETIC GM6s2 ~21 lines **+0.09**, GM6t ~60 lines **+0.26** KB br = **+0.35**; with engine.md GM3s's +0.05: 39.4 + 0.40 = **39.80 / 40.0 without the lever**. The lever (`createMetaEndpoints` `endpoints.ts:217-247` and the decoders only it reaches, `decode.ts:198-215`, `:252-281`, `:364-412`, ~128 lines) frees ARITHMETIC >= ~0.55 KB br (CLAIM ~2.2, `carry.md:1207-1208`), so <= 39.25 after it; it runs first (RULINGS 127, §14 Q8). Where Svelte's transition module lands after GM3s's lazy `in:` / `out:` is GM3s's build to show (R-E21). **Reconcile P4:** the lever is merged (LEL, RULINGS 141); the base is main's MEASURED 38.7 at `a5f887b`; this file's terms are unchanged (+0.35), the ledger is "Ledgers" below. **Reconcile r2:** unchanged (+0.35); nothing of r2 enters the entry; the ledger is engine.md §11.1's Ledger 2 |
| engine / first-line (LIMIT 230.0 / 270.0; MEASURED 214.2 / 257.2 at `48bc82a`, engine.md §0 R1) | GM6a anchors + order ~30 lines (**+0.13**); GM6c2 `world/values.ts` ~60 + `app/values.ts` ~135 + yields / session deltas ~45 (W3's drop and re-read, W5's origin, W6's pending state and `renewed`, `hint-renewing`) + `syncValues` ~14 net (round 6, r5 W2) + round 7's merge, refresh rule, `superseded`, `endedHere`, `failing`, `valuesPatch` / `settle` ~28 net (r6 W1, m1, m3, m5) + round 8's request tokens, `owed` / `fail`, `playing`, `post(o)` / `trying`, `chapterLeft` ~15 net (r7 W1, W2, m1, m3-m5) + round 9's `sync` / `held` / the unheld answers / `syncPrompt` / `seenDigits` / the `awaiting` clear, less `post(o)`'s body (GM3p's, E-P18 (b)), ~16 net (r8 W1, m1, m4, m5) + round 10's per-puzzle unheld test / `render`'s prompt scheduling / `ShownDigits` ~5 net (r9 W1, O1) + the `i18n/values.ts` table ~360 B raw (**+1.56**); GM6c3 `value-motion.ts` ~35 + `ValueText` ~30 + typewriter ~45 + game ~15 + three components ~10 (**+0.58**); GM6c4 ~15 (**+0.06**); GM6d1 labels, the label node and the shimmer source ~121 (**+0.52**); GM6d2 data module + yields (states filter, visual batch) ~35 (**+0.15**; its texts and reach are build-only, round 6) | ARITHMETIC (4.3 B br per line; the table at ~55 % of raw) **+3.00 KB br** in total, one figure per lane (r3 m4: 0.13 + 1.56 + 0.58 + 0.06 + 0.52 + 0.15 = 3.00; round 7: GM6c2 +0.12; round 8: GM6c2 +0.06, ~15 lines; round 9: GM6c2 +0.07, ~16 lines net; round 10: GM6c2 +0.02, ~5 lines net); first-line headroom 270 - 257.2 - **1.53** (engine.md round 9's own growth, [engine §0 Decision table](../engine/00-decision-table.md#0-decision-table) as read) - 3.00 = **8.27 KB br** (round 10; ARITHMETIC 12.8 - 1.53 = 11.27, 11.27 - 3.00 = 8.27; engine.md round 9 reads this file's round-8 +2.91 and writes 8.36, which R-E30 moves; critique_perplayer_r9's question 1 computed 8.29 with round 9's +2.98; round 9 read 8.32, round 7 8.49, round 6 8.62, round 5 8.83); each lane's build log reports its MEASURED delta; engine.md's STOP rule (> 0.5 KB br over the lane's estimate stops at its cut). No cap of this file's own: the rows' LIMITs are the gates (m2). **Reconcile P4 (supersedes this cell's sums and headroom):** GM6a +0.15, GM6c2 +1.59, GM6d1 +0.55, GM6d2 +0.16, the rest unchanged: 0.15 + 1.59 + 0.58 + 0.06 + 0.55 + 0.16 = **+3.09 KB br**; the bases are main's MEASURED rows at `a5f887b`; the ledgers of the three designs, without and with LFL, are "Ledgers" below. **Reconcile r2:** GM6d1 +0.56 (W2's `bg` comparison and cut drop, the insertion above the plate, `debugLabels`' two fields: ~3 lines), GM6d2 +0.17 (the stage check and the `bg` field: ~2 lines): 0.15 + 1.59 + 0.58 + 0.06 + 0.56 + 0.17 = **+3.11 KB br**; the sums are engine.md §11.1's ("Ledgers" below). **Reconcile r3:** GM6d2 +0.19 (the labels job, ~4 lines net, critique_perplayer_r2 W1): 0.15 + 1.59 + 0.58 + 0.06 + 0.56 + 0.19 = **+3.13 KB br** |
| explore-ui chunk (16.0 LIMIT, 4.9 MEASURED) | `DocumentReader` / `Inventory` render `ValueText` (GM6c4, ~10 lines); `mechanics/data/labels.ts` is a data half in the engine by the contract; its lint is build-only | ARITHMETIC ~+0.04 KB br explore-ui |
| first line latency | the values fetch starts at `chapterEntered` (after the chapter load, before its first step, m2) and nothing waits on it; a placeholder on the first line renders the mask, then the value | 0 added RTT before the first line; 1 RTT (~250-300 ms p95, CLAIM `PUZZLES-PLAN.md:231`) of mask only for chapters with per-player puzzles |
| per-chapter bytes | values response ~70 B per per-player puzzle (the critic's r2 count) | ARITHMETIC < 1 KB per chapter |
| texture memory | labels <= 2 MiB per room, +4 MiB worst in a transition, inside 32 / 48 MiB | ARITHMETIC; room-set gate (GM6d2) |
| DB | ~190-205 B per row | ARITHMETIC; MEASURED by `values_row_size_measured` |
| story checks | `world/*`, `story/placeholder` and `puzzle-key/*` lints (the chain included), their codes in `VALUES_CODES` / `VALUE_TEXT_CODES` / `KEY_CODES` / `LABEL_CODES` (registered, never `LINT_CODES`, r4 W1); line IDs unchanged; every world text, module texts included, in the en checks and the shipped en through the one walk (R-E25; round 6); paid chapters absent from `dist/` (scan-dist as built, now with module texts among the paid needles) | GM6c1a, GM6c1b, GM6d2; `dsl-doc: lint table equals lint codes` untouched; the label's en entry no orphan (GM6d2 commit 4, M-P6b) |

#### Ledgers (reconcile P4; RULINGS 143 QO10, 145, 149, 152; shots I-13; reconcile r2: one ledger, engine.md §11.1)

**Reconcile r2 (critique_perplayer_r1 W1; E-P25).** RULINGS 143 QO10 rules one first-line ledger across the three
designs, and engine.md §11.1 holds it ("One ledger per row across the three designs", [engine §11.1 The shared ledgers](../engine/11-budgets-and-validation.md#111-the-shared-ledgers-reconcile-r1-r2-rulings-143-qo10-152-r4-153-155-design-shots-i-13)). This
file therefore prints **no ledger total**: it owns the inputs of its own rows in that table (the terms below), and
every sum, headroom and verdict is §11.1's. Where §11.1's PPL rows read other figures than these terms, these terms
are the input (one owner per term) and the difference is R-E31's correction for the docs lane, never a second total
and never a STOP. The bases (MEASURED) are the same bytes §11.1 uses ([engine §11.1 The shared ledgers](../engine/11-budgets-and-validation.md#111-the-shared-ledgers-reconcile-r1-r2-rulings-143-qo10-152-r4-153-155-design-shots-i-13)), kept here for the cuts.

**Bases, MEASURED.** Main `a5f887b` (`D:/tmp/novel-orch/m3s-memory-half-paid/merge/build.log:92-100`; brotli q11, KB =
1000 B): entry closure 38.7 / 40.0, engine closure 215.0 / 230.0, JS before the first line 258.8 / 270.0 (defined there
as "entry + engine closures + meta controller chunk"), explore-ui 4.9 / 16.0, meta controller 5.1 / 6.0, all JS 271.6 /
305.0; to the byte (LFL's tester on main `df0e12c` = `a5f887b` + docs only, `budget.ts`'s own evaluate,
`D:/tmp/novel-orch/lfl-first-line/test_r2.md:63-69`): entry **38,687**, engine **215,015**, first line **258,823**, meta
controller 5,121, all JS **271,638** B. **With LFL** (its newest report, test round 2 GREEN at lane HEAD `7338d77`,
the same table; merged as main `cec347c`, whose merge build shows the same rows rounded,
`D:/tmp/novel-orch/lfl-first-line/merge/build.log:92-100`: 39.0, 215.1, 254.0, 5.1, 271.9): entry **38,952** (+265),
engine **215,052** (+37), first line **254,004** (-4,819; the row's definition becomes "entry + engine closures": the
meta controller chunk leaves it), meta controller 5,109, all JS **271,939** (+301). (Round 1's figures, 39,012 /
254,036 / 271,949 at `58c2226`, `test_r1.md:54-58`, are superseded by round 2's.) The LIMITs are
`client/scripts/budget.ts:106` (`entryJsBr` 40,000), `:108` (`firstLineJsBr` 270,000), `:114` (`allJsBr` 305,000).

**This file's terms in engine.md §11.1 (ARITHMETIC at 4.3 B br per line, CLAIM-based estimates until each lane's
build measures; reconcile r2).** The other designs' terms (EN, shots) are §11.1's rows and are not restated here.

| Lane | engine closure | entry closure | meta controller | explore-ui | Source |
|---|---|---|---|---|---|
| GM6a | +0.15 | - | - | - | §9 GM6a Gates |
| GM6s2 | - | +0.09 | +0.004 (`META_KINDS`' row, 1 x 4.3 B) | - | §9 GM6s2 Gates |
| GM6c2 | +1.59 | 0 (the strings ship in `i18n/values.ts`, engine chunk) | - | - | §9 GM6c2 Gates |
| GM6c3 | +0.58 | - | - | - | §9 GM6c3 Gates |
| GM6t | - | +0.26 | - | - | §9 GM6t Gates |
| GM6c4 | +0.06 | - | - | +0.04 | §9 GM6c4 Gates |
| GM6d1 | **+0.56** (r2: was 0.55) | - | - | - | §9 GM6d1 Gates |
| GM6d2 | **+0.19** (r3: the labels job, ~4 lines; r2: 0.17; r1: 0.16) | - | - | - | §9 GM6d2 Gates |
| GM6k, GM6s1, GM6c1a, GM6c1b | 0 (server or build-only) | - | - | - | - |
| **this file** | **+3.13** (r2: +3.11) | **+0.35** | **+0.004** | **+0.04** | ARITHMETIC: 0.15 + 1.59 + 0.58 + 0.06 + 0.56 + 0.19; 0.09 + 0.26 |

Per §11.1 row (its definitions): **JS before the first line** = entry + engine closures with LFL (merged), so this
file's term is 3.13 + 0.35 = **+3.48**; without LFL the row also counts the meta controller chunk, **+3.484**.
**Entry closure** +0.35. **Engine closure** +3.13. **All JS** 3.13 + 0.35 + 0.004 + 0.04 = **+3.524**. (Reconcile r2
read +3.46 / +3.464 / +3.11 / +3.504 on GM6d2's +0.17.)

**Against §11.1 as read (2026-11-09, engine.md reconcile revision 2; R-E31 answered, R-E36).** §11.1 now takes this
file's term table as its PPL input ("per-player's own term table is the input", [engine §11.1 The shared ledgers](../engine/11-budgets-and-validation.md#111-the-shared-ledgers-reconcile-r1-r2-rulings-143-qo10-152-r4-153-155-design-shots-i-13); every
`engine.md:N` of this paragraph is as last read on 2026-11-09, while the engine track wrote) and reads reconcile r2's
terms: engine +3.11, entry +0.35, meta controller +0.004, explore-ui +0.04 (Ledger 1 [engine §11.1 The shared ledgers](../engine/11-budgets-and-validation.md#111-the-shared-ledgers-reconcile-r1-r2-rulings-143-qo10-152-r4-153-155-design-shots-i-13), Ledger 2
[engine §11.1 The shared ledgers](../engine/11-budgets-and-validation.md#111-the-shared-ledgers-reconcile-r1-r2-rulings-143-qo10-152-r4-153-155-design-shots-i-13), Ledger 3 [engine §11.1 The shared ledgers](../engine/11-budgets-and-validation.md#111-the-shared-ledgers-reconcile-r1-r2-rulings-143-qo10-152-r4-153-155-design-shots-i-13), Ledger 4 [engine §11.1 The shared ledgers](../engine/11-budgets-and-validation.md#111-the-shared-ledgers-reconcile-r1-r2-rulings-143-qo10-152-r4-153-155-design-shots-i-13)). Reconcile r3 moves one term, GM6d2 +0.17 -> +0.19 (W1's labels
job), so engine **+3.13**. Under §11.1's own rule ("were a later per-player revision to move a term, the docs lane
takes that table and moves these sums by the difference (ARITHMETIC), and no lane STOPs on it", [engine §11.1 The shared ledgers](../engine/11-budgets-and-validation.md#111-the-shared-ledgers-reconcile-r1-r2-rulings-143-qo10-152-r4-153-155-design-shots-i-13)) the
difference is **+0.02 KB br** on Ledgers 1 (first line, both definitions), 3 (all JS) and 4 (engine closure) and
**0** on Ledger 2 (entry); R-E36 asks the engine track to read it. It flips none of §11.1's verdicts (ARITHMETIC on
the headrooms §11.1 prints): first line with LFL 4.52 -> 4.50 ([engine §11.1 The shared ledgers](../engine/11-budgets-and-validation.md#111-the-shared-ledgers-reconcile-r1-r2-rulings-143-qo10-152-r4-153-155-design-shots-i-13)), its peak 4.32 -> 4.30 ([engine §11.1 The shared ledgers](../engine/11-budgets-and-validation.md#111-the-shared-ledgers-reconcile-r1-r2-rulings-143-qo10-152-r4-153-155-design-shots-i-13)); engine
closure 3.98 -> 3.96 (Ledger 4, [engine §11.1 The shared ledgers](../engine/11-budgets-and-validation.md#111-the-shared-ledgers-reconcile-r1-r2-rulings-143-qo10-152-r4-153-155-design-shots-i-13)); all JS 3.37 -> 3.35 ([engine §11.1 The shared ledgers](../engine/11-budgets-and-validation.md#111-the-shared-ledgers-reconcile-r1-r2-rulings-143-qo10-152-r4-153-155-design-shots-i-13)) and, the smallest headroom it touches,
after EN's GM7p and GM7g **0.17 -> 0.15** ([engine §11.1 The shared ledgers](../engine/11-budgets-and-validation.md#111-the-shared-ledgers-reconcile-r1-r2-rulings-143-qo10-152-r4-153-155-design-shots-i-13)); the pre-LFL first-line row is FAIL already ([engine §11.1 The shared ledgers](../engine/11-budgets-and-validation.md#111-the-shared-ledgers-reconcile-r1-r2-rulings-143-qo10-152-r4-153-155-design-shots-i-13), history:
LFL is main) and the all-JS FAIL at GM8a ([engine §11.1 The shared ledgers](../engine/11-budgets-and-validation.md#111-the-shared-ledgers-reconcile-r1-r2-rulings-143-qo10-152-r4-153-155-design-shots-i-13)) stays a FAIL whose ruling is EN's (§15 item 16). No total is
printed here (r2 W1).
(Reconcile r2 read §11.1's revision-1 figures: +0.11 / 0 / +0.114 against +3.00, the smallest headroom touched all JS
after GM7p and GM7g, 0.81 -> 0.70; critique_perplayer_r2 m1.)

**Reconcile r4 (critique_perplayer_r3; main `3c62a86`).** This revision moves no term: W1's repair is test-only (0 B)
and m1 is a §7 row, so the table above stands (engine +3.13, entry +0.35, meta controller +0.004, explore-ui +0.04)
and its difference against §11.1's "with R-E36" rows is **0** on all four ledgers (engine.md §14.2 R-E36,
[engine §14.2 Answers to per-player.md §12](../engine/14-interface-requests.md#142-answers-to-per-playermd-12) as read: "Taken under §11.1's own rule"; Ledger 1 [engine §11.1 The shared ledgers](../engine/11-budgets-and-validation.md#111-the-shared-ledgers-reconcile-r1-r2-rulings-143-qo10-152-r4-153-155-design-shots-i-13), Ledger 3 [engine §11.1 The shared ledgers](../engine/11-budgets-and-validation.md#111-the-shared-ledgers-reconcile-r1-r2-rulings-143-qo10-152-r4-153-155-design-shots-i-13), Ledger 4 [engine §11.1 The shared ledgers](../engine/11-budgets-and-validation.md#111-the-shared-ledgers-reconcile-r1-r2-rulings-143-qo10-152-r4-153-155-design-shots-i-13)).
**LRB** merged as `3c62a86` after reconcile r3 (`.git/refs/heads/main`); its merge build reads entry 39.0, engine
215.1, first line 254.1, meta controller 5.2, all JS 272.1 KB br (MEASURED, rounded,
`D:/tmp/novel-orch/lrb-reload-bounds/merge/build.log:92-100`; no byte table exists, `lrb-reload-bounds/test_r2.md:60`).
Re-basing §11.1 on it is the engine track's (critique_engine_r2 m1); read on the rounding intervals (ARITHMETIC,
engine.md's to print, mirrored for the cuts; the planned lanes as §11.1 sums them: EN +1.71 engine / +0.06 entry /
+13.44 all JS, this file +3.13 / +0.35 / +3.524, SH +6.25 first line / +0.10 entry / +12.75 all JS):
- **First line:** 254.05-254.15 + 11.50 = **265.55-265.65** (4.35-4.45 left, PASS; r3 read 265.504 on `cec347c`).
- **Entry:** LRB's tester held the row ("must not move", 39.0 -> 39.0, `lrb-reload-bounds/test_r2.md:26`), so 38,952 B
  stays the base (CLAIM since LRB) and Ledger 2 reads **39.462**, **0.538** left, **38 B** above L1 / L2's return line,
  until the next entry-adding cut reads the exact bytes; this file's +0.35 enters through GM6s2 (+0.09) and GM6t
  (+0.26) only.
- **Engine closure:** 215.05-215.15 + 10.99 = **226.04-226.14** (3.86-3.96 left).
- **All JS:** 272.05-272.15 + 29.714 = **301.76-301.86** (3.14-3.24 left); + EN's GM7p and GM7g (3.2) =
  **304.96-305.06**, at the LIMIT within CLAIM noise; + GM8a = 306.56-306.66 (FAIL; engine.md §15 item 16's ruling).
- **Without LFL** (history; LFL is main since `cec347c`): 270.327 first line (FAIL) and 39.197 entry, unchanged.

No GM6 verdict flips. What a crossing does to a GM6 lane is "Per-lane quote" below (reconcile r4 clarifies its all-JS
clause) and §14 Q24.

**The reading this file adopts from §11.1 and engine.md §15 items 15-16 (mirrored, not recomputed).**
- **First line:** with LFL the three designs' planned lanes pass 270.0 (§11.1, Ledger 1); every GM6 client lane
  quotes the row base -> HEAD MEASURED at its cut, with the still-open lanes' figures (this file's terms for GM6
  lanes), and STOPs if the projection crosses 270.0; the lever is the shots' (`flatten` + camera, I-13), never a
  narrowed motion (RULINGS 114, 122).
- **Entry:** the entry terms agree (+0.35). With LFL the projection leaves **0.538** KB br, **0.038** above L1 / L2's
  return line (RULINGS 142, `RULINGS.md:3008-3009`: L1 / L2 return when the entry headroom falls under 0.5 KB br), so
  **L1 stays carried** (engine.md §15 item 15, [engine §15 Questions for the orchestrator](../engine/15-orchestrator-questions.md#15-questions-for-the-orchestrator-engineering-each-with-a-recommendation) as read in reconcile r4; reconcile r4, the note
  critique_engine_r2 left for this file: r1's "0.548 / 0.048", read before engine.md booked GM3w's +0.01, is
  superseded by the next sentence's figures). Reconcile r3: engine.md's reconcile r2 books GM3w's
  App expressions at +0.01 (bound +0.04), so Ledger 2 reads **0.538** KB br, **0.038** above the line ([engine §11.1 The shared ledgers](../engine/11-budgets-and-validation.md#111-the-shared-ledgers-reconcile-r1-r2-rulings-143-qo10-152-r4-153-155-design-shots-i-13)
  as last read; 0.508 at GM3w's bound, [engine §11.1 The shared ledgers](../engine/11-budgets-and-validation.md#111-the-shared-ledgers-reconcile-r1-r2-rulings-143-qo10-152-r4-153-155-design-shots-i-13)); this file's +0.35 is unchanged and W1 adds no entry byte (the job is in
  `yields.ts`, engine chunk); L1 stays carried. **If the line is crossed:** GM6s2 and GM6t (the
  only entry lanes of this file) quote the entry row at their cuts; the first lane whose measured projection leaves
  < 0.5 KB br STOPs at its cut, L1 (entry -1.75 KB br, first line +0.07; RULINGS 140, `RULINGS.md:2988-2990`) runs
  as the next lane on its files and merges first, then the stopped lane resumes; `entryJsBr` (`budget.ts:106`,
  40,000) is never raised; crossing 40.0 itself is a build-gate FAIL. L2 (-0.48) stays shelved with it.
- **All JS:** this file's +3.524 (r2: +3.504) is inside §11.1's projection with the difference above; every GM6 client lane quotes
  the row at its cut (shots I-13); the ruling the third EN type chunk needs is engine.md §15 item 16's. Reconcile r4:
  on `3c62a86` the three designs' terms read 301.76-301.86 and GM7p + GM7g's rows 304.96-305.06 (above), so the
  ruling is due before GM7p's cut, not GM8a's (critique_engine_r2 m1's direction; §14 Q24).
- **Per-lane quote (I-13; E-P25):** at its cut every client lane of this file quotes, base -> HEAD MEASURED, the
  first-line row (every client lane), the entry row (GM6s2, GM6t) and the all-JS row (every client lane), each
  against §11.1's sum of every still-planned lane of the three designs with this file's terms for the GM6 lanes; it
  STOPs if a sum crosses its LIMIT or, for the entry, if the headroom after it is < 0.5 while L1 / L2 are shelved.
  **Reconcile r4 (found while resolving P4):** for the all-JS row, "every still-planned lane" is the three designs'
  lane terms (§11.1 Ledger 3's design rows and their "sum" row), not EN's puzzle-type chunk rows (GM7p, GM7g, GM8a,
  GM8b): a GM6 lane prints those rows in its quote and STOPs on none of them, since their crossing is engine.md §15
  item 16's ruling, the row bounds no download (each chunk loads with its puzzle) and no GM6 lane adds a type chunk; a
  GM6 lane's own measured build past 305.0 is a build-gate FAIL as always. Read literally, r3's wording STOPped every
  GM6 client lane on GM8a's planned row (306.45 with LFL, [engine §11.1 The shared ledgers](../engine/11-budgets-and-validation.md#111-the-shared-ledgers-reconcile-r1-r2-rulings-143-qo10-152-r4-153-155-design-shots-i-13)), which no design intended.

Each new gate is seen failing on its named mutation (§4 table, §3.8 table, GM6k commit 3 (the real tree's three
undeclared columns), GM6s1 commits 1-2, GM6s2 commits 4 and 7, GM6c1b commits 1-2, GM6c3 commits 1-4, GM6t commits 1-2,
GM6d1 commit 3 (the frames gate seen red on round 3's free-tween form; round 5: the waiting-view test on "`continuous()`
counts waiting views"), GM6d2 commit 2). Round 5: the three registration tests (GM6c1a commit 4, GM6c1b commit 1,
GM6d2 commit 1) on "the registry line removed"; GM6t commit 1's token test on "`ended` holds keys and is never pruned".
Round 8: **M-P8a** (`run()` null unless `ready`; GM6c2 commit 3), **M-P8b** (`ready` admits a spent run only in a
`failed` world), **M-P8i** (an automatic re-post clears `fail`), **M-P8j** (Retry re-posts a lapsed restart) in
commit 2, **M-P8g** (`awaiting` holds a kind) in commit 1, **M-P8c**-**M-P8f** and **M-P8h** in commit 4, M-P7d on its
new no-outcome fixture and M-P7e with its corrected red (r7 m2); server `attempt_without_run_409_not_compared` seen red
on round 7's step 4 (GM6s2 commit 4).
Round 9: **M-P9a** (`sync` reconciles without comparing `held()` with `chapter()`; GM6c2 commit 1 and the game test of
commit 5), **M-P9b** (an unheld `entry` answers `loading`; commit 1's class guard and commit 4's unheld frame),
**M-P9c** (`retry()` acts only on held entries; the guard), **M-P9e** (a settling body leaves `awaiting`) and **M-P9f**
(an older below-floor body never fills `best`) in commit 1, **M-P9d** (`recoded` against the previous entry) in commit
4; GM6c3 commit 2's "`playValue` from a `$effect.pre`" (RULINGS 135 (b)).
Round 10: **M-P10a** (the generation keyed by the `HeldChapter` object; GM6c2 commit 1's new-object test and the
class guard's new-object row, commit 5's language-switch pin, GM6c3's K49 pin), **M-P10b** (`render` schedules no
`syncPrompt`; commit 4), **M-P10c** (`lastDigits` per generation; commit 1); M-P9a's and M-P9b's reds restated to what
they produce on this design (r9 m1).
Reconcile revision 1 (each named in its lane; the exact red is the tester's mutation run, §14 Q16): **M-P10d** (round
9's whole `chapter()`: GM6c2 commit 5's language-switch pin, GM6c3's K49 pin; it replaces M-P10a there, r10 m1);
**M-PR1a** (`dispose` leaves the prompt), **M-PR1b** (`syncPrompt` ignores `disposed`), **M-PR1c** (the `shown` dep
calls `values.render`; also GM6c4's document test), **M-PR1h** (the values row declared `other`), **M-PR1j** (the open
emits its own `puzzle:checking`), **M-PR1k** (`syncValues` bypasses the shown-frame test) in GM6c2 commit 4;
**M-PR1d** (`refresh` per generation only), **M-PR1e** (the `heldOf` cache returns the whole object) in commit 1;
**M-PR1i** (the art parented to `anchor`; GM6a); **M-PR1f** (label holds released at the tween end), **M-PR1l** (the bg
label rides the root's identity depth) in GM6d1; **M-PR1g** (the label bound diverges from `LABELS_BOUND`),
**M-PR1m** (the labels-only batch holds), **M-PR1n** (I-11's method without labels) in GM6d2.
Reconcile revision 2: **M-PR2a** (the executor ignores `LabelsCommand.bg`), **M-PR2b** (the model keeps a cut room's
set waiting), **M-PR2e** (the bg label node appended on top of `content`) in GM6d1 commit 4; **M-PR2c** (the
labels-only path drops its stage check), **M-PR2d** (the stage check also requires `cg === null`) in GM6d2 commit 3;
**M-PR2f** (the `shown` dep handed an alias of `values.render`; red on the walk's render row, green on the source pin)
in GM6c2 commit 4 when R-E34 is answered; M-PR1l with its fixture stated (n = 0.5, red by 5 source px); M-PR1m with
`{ stale: 0, reviving: false }`.
Reconcile revision 3: **M-PR3a** (the store-change producer runs at the change, not through `h.queue`: revision 2's
form), **M-PR3b** (the job renders the labels when it is queued), **M-PR3d** (the job ignores `dead`) in GM6d2
commit 3 on the serial-intent harness; **M-PR3c** (`present()` lets its intent end before `stage()` resolves) in
GM6d1 commit 5, on the pin of the premise; M-PR1c / M-PR2f with the `SITE_MEMBERS` row in engine.md's adopted shape
(E-P29 (c)).
Reconcile revision 4 (critique_perplayer_r3 W1): the five labels-job tests assert on the harness's applied-order log
(`applied`), so `yields: a value that lands while a batch for the room on stage loads is not undone by it` is red on
**M-PR3a** (`['1847', masked]`), **M-PR4a** (revision 2's synchronous send kept beside the job, §6.2's rejected (e):
`['1847', masked, '1847']`) and **M-PR4b** (send at once while the stage shows the room's bg, queue the job only
otherwise: `['1847', masked]`), all in GM6d2 commit 3; M-PR4a and M-PR4b are green on the other four tests, so this
test is their only guard and is counted by name; M-PR3a, M-PR3b and M-PR3d keep their reds on the other four, now
read on `applied`.
Round 6: **M-P6a** (the wait's end writes `busy: false` without a cue; GM6c2 commit 4), **M-P6b** (`LABELS_TEXTS`
returns `[]`: the label's texts test red and, on the real tree at GM6d2 commit 4, `loc/orphan-en`), the surface rule
allowing every role but `name` and `contains` comparing the first conjunct only (GM6c1a commit 5), the three node-free
source tests on "the file imports `createHash` from `node:crypto`", the seeded key record without `add ch2.cabinet`
(GM6c1b commit 2), and `value-changed` falling into the `network` branch (GM6c2 commit 4). Round 7: **M-P7a**
(a failed fetch fails every entry), **M-P7b** (a fetch start puts every entry in `loading`), **M-P7g** (the merge takes
the later response) in GM6c2 commit 1; **M-P7h** (reconcile ignores `endedHere`) in commit 2; **M-P7c** (the `failed`
row writes `offline` for any frame), **M-P7d** (row 3 compares the entry with its previous value), **M-P7e**
(`syncValues` runs during a countdown), **M-P7f** (a pass emits the writer's cue and the values cue) in commit 4; and
GM6c1a commit 5's `contains` mutation, now red through the conjunction fixture (r6 m2).
