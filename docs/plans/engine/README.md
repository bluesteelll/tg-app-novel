# Engine plan: the mechanics engine and the cue channel

**Planned; adopted 2026-11-09 at main `3c62a86`; nothing built yet**; lane cuts re-locate every code citation on their own base. Changed by RULINGS 159-173 (as of `9a83251`; docs lane `docs-errata-10`, group B): built since: GM1a `mech-run-split` (`ef8b4dc`, RULINGS 165) and GM1b `mech-registry` (`03a00bc`, RULINGS 171); no engine lane runs; the next, GM1c and GM2a, start after per-player GM6s2 merges (RULINGS 170, 173); the state of every lane is the status block of [§12 Order and conflicts](12f-order-and-conflicts.md#order-and-conflicts). Changed by RULINGS 174-182 (as of `9b4fd25`; docs lane `docs-errata-11`, group B): built since also GM1c `mech-puzzle-instance` (`8c2fa03`, RULINGS 178) and GM2a `mech-save-v2` (`9b4fd25`, RULINGS 181); GM1d `mech-clues` (RULINGS 179, 180) and GM3w `mech-ui-wiring` (RULINGS 182) run; GM3m next when a client slot frees, GM2b after GM1d; the state of every lane is the same status block. Changed by RULINGS 183-197 (as of `837b1ed`; docs lane `docs-errata-12`, group B): built since also GM1d `mech-clues` (`794181b`, RULINGS 183), GM3w `mech-ui-wiring` (`508bd36`, RULINGS 186), GM2b `mech-renamed` (`1782d6d`, RULINGS 190), GM3m `mech-cue-gate` (`a3f0678`, RULINGS 193) and GM3c `mech-conditions` (`837b1ed`, RULINGS 196); GM3s `mech-cue-stage` runs (lock 18, RULINGS 194, 195); next, the engine-closure lever lane (new, RULINGS 195, 196) in the first client slot after GM3s merges, then GM3 `mech-use`; the state of every lane is the same status block. Changed by RULINGS 198-209 (as of `461424d`; docs lane `docs-errata-13`, group B): built since also GM3s `mech-cue-stage` (`65e10ad`, RULINGS 204) and the engine-closure lever X `lever-x-pixi-env` (`597dded`, RULINGS 208; the lever lane became the program X, then P, with O5 and Y on the trigger: RULINGS 201); GM3 `mech-use` runs (lane A, the plan's lock 16 plus at most four carry files, RULINGS 209) beside lever P `lever-p-purchase-lazy` (lane C, RULINGS 209); next, GM3u `mech-ribbon` after GM3 and P; the state of every lane is the same status block. Changed by RULINGS 209-225 (as of `52e328e`; docs lane `docs-errata-14`, group B): built since also lever P `lever-p-purchase-lazy` (`3d120bc`, RULINGS 213), GM3 `mech-use` (`7082a35`, RULINGS 217; lock 25, RULINGS 212), GM3k `mech-kernel-world` (`3131844`, RULINGS 223; new, type-only, RULINGS 210 Q4) and the recovery lane `lazy-chunk-recovery` (`8e099ee`, RULINGS 224; new, Q60); GM3's merge fired the lever trigger (RULINGS 217), the levers O5 and Y were designed and approved (RULINGS 221, 222), and the recovery lane's re-base ended the trigger, so both are on the shelf (RULINGS 224); GM3u `mech-ribbon` runs (lane A) beside E6 `e6-money-holds` (lane C; new, the money-path follow-up) (RULINGS 225); next, GM3p `mech-puzzle-cues` after GM3u; the state of every lane is the same status block. Changed by RULINGS 225-237 (as of `0b91acc`; docs lane `docs-errata-15`, group B): built since also E6 `e6-money-holds` (`d5e04ef`, RULINGS 228; its merge fired the lever trigger again), GM3u `mech-ribbon` (`33b4f8d`, RULINGS 230; lock 18, RULINGS 226; it fixed Q62), the Q63 fix `fix-vitest-fs-cache` (`340f47c`, RULINGS 232; new), the lever O5 `lever-o5-overlays` (`9a0ae2d`, RULINGS 234; launched under the trigger and continued as a lane in flight after GM3u's merge ended it, RULINGS 230) and the Q64 fix `fix-paywall-reopen` (`d820803`, RULINGS 236; new); the lever Y stays an approved design on the shelf until a ledger is within 1.0 KB (RULINGS 234); GM3p `mech-puzzle-cues` runs (lane A; RULINGS 232-234); next, GM3b `mech-state-visuals` after GM3p, in lane C with the trigger checked at its launch (RULINGS 237); the state of every lane is the same status block. Changed by RULINGS 238-270 (as of `a064399`; docs lane `docs-errata-16`, group B): built since also GM3p `mech-puzzle-cues` (`d478384`, RULINGS 243; lock 12) and GM3b `mech-state-visuals` (`ac9cab1`, RULINGS 258; lock 18, RULINGS 245, 250; run in lane A, not lane C, which held the Q67 fix), and two fix lanes, Q67 `fix-phone-column` (`4f26e8e`, RULINGS 251) and Q69 `fix-ripple-flake` (`99be5c1`, RULINGS 265; it touched `yields.ts`); GM3b's merge moved the engine R to 2.666 (n 14, RULINGS 258); on `a064399` Ledger 4 is 224.427 / 230.0 and Ledger 1 263.606 / 270.0 (RULINGS 269), so the lever Y stays an approved design on the shelf and GM3b's engine-lever candidate waits for a ledger within 2.0 KB (RULINGS 253); no engine lane runs: GM4g `mech-room-set-pair`, the next, waits for shots SH3b (merged `e1e7637`) and SH3c (running, lane A; RULINGS 259, 263) and takes lane A after SH3c (the critical path, RULINGS 241, 270); the state of every lane is the same status block. Changed by RULINGS 271-291 (as of `768fc9d`; docs lane `docs-errata-17`, group B): built since also GM4g `mech-room-set-pair` (`56cc302`, RULINGS 284; lock 6, lane A after SH3c, RULINGS 278; held for fix2, RULINGS 283); shots SH4's merge (`768fc9d`) moved the engine R to 2.306 (n 15, RULINGS 290); on `768fc9d` Ledger 4 is 218.402 / 230.0 and Ledger 1 257.566 / 270.0 with 7.56 KB of engine terms left (RULINGS 290), so the lever Y stays an approved design on the shelf and GM3b's engine-lever candidate waits for a ledger within 2.0 KB (RULINGS 253); GM4 `mech-views` runs (lane A, from `56cc302`; lock 19; RULINGS 285-288) and carries the critical path (RULINGS 241); next, GM4u `mech-view-ui` after GM4 in lane A; two lanes at most (RULINGS 255, 276); the state of every lane is the same status block.

## Provenance

- Source: `design/mechanics/engine.md` in the orchestration repo, frozen at tag `designs-adopted-2026-11-09` (`5533440`), sha256 `5971dea7…`: mechanics round 14 + reconcile revision 2. Dated 2026-11-03; its code citations started on main `5c702c4` (code `48bc82a`); its inputs were `research/mechanics/synthesis.md` rev 2, the synthesis critique r2, RULINGS 114-126, M3c's cut and per-player round 1.
- Approved by `design/mechanics/critique_engine_r14.md` (RULINGS 152) and `design/reconcile/critique_engine_r2.md` (RULINGS 158); adopted by RULINGS 152, 153, 158.
- History, kept at the tag and not adopted: the header's round summaries (rounds 2-14, reconcile revisions 1 and 2), §17-§29, §31 and §32 (the patch logs).

## Reading rule

- Code citations are `file:line` on the commit each round read (`5c702c4` … `cec347c`, stated in place): a lane cut re-locates them on its own base. Design citations are links to the section they meant.
- Labels per [labels-and-owner-values.md](labels-and-owner-values.md); the totals live in [§11.1 The shared ledgers](11-budgets-and-validation.md#111-the-shared-ledgers-reconcile-r1-r2-rulings-143-qo10-152-r4-153-155-design-shots-i-13) (re-based at `3c62a86` by this adoption); a figure restated elsewhere with a revision tag (r1, r2, r3) is that revision's record.
- The one lane order of all three plans: [§12 Order and conflicts](12f-order-and-conflicts.md#order-and-conflicts).

Owner questions (§13): Q15a-h, every default adopted (RULINGS 154; OPEN-QUESTIONS Q15).

## Keys

| Key | Meaning | Where |
|---|---|---|
| MEASURED / ARITHMETIC / CLAIM / LIMIT / CODE | the label of every figure: measured (source named), computed (shown), claimed (a doc, a plan estimate, a page), a constant of our tree, read in source | [labels and owner values](labels-and-owner-values.md) |
| EN | this plan (the engine design, `design/mechanics/engine.md`) | this directory |
| PPL | the per-player plan (`design/mechanics/per-player.md`) | [per-player plan](../per-player/README.md) |
| SH | the shots plan (`design/shots/proposal.md`); `SH<n>` is one of its lanes | [shots plan](../shots/README.md) |
| CH | `design/animation/characters.md` rev. 3 (stopped by RULINGS 132) | orchestration repo |
| S1 | in §0's RC-W4 row and §8.1's `HOST_WAITS` walk: the walk's first scope rule (a non-declaration `.ts` file under `client/src`), not a source key | §8.1 |
| `file:line` | a code line on the commit its round names (`5c702c4` / `48bc82a` for round 1; later rounds state theirs, up to `cec347c`) | the repository at that commit |

## Files

| File | Contents |
|---|---|
| [labels-and-owner-values.md](labels-and-owner-values.md) | the labels of every figure and the owner values this plan builds on |
| [00-decision-table.md](00-decision-table.md) | §0 Decision table |
| [01-current-state.md](01-current-state.md) | §1 Current state on main |
| [02-goal-and-constraints.md](02-goal-and-constraints.md) | §2 Goal and constraints |
| [03-module-contract.md](03-module-contract.md) | §3 The module contract (3.1, 3.2, 3.3, 3.4, 3.5, 3.6) |
| [04-condition-grammar.md](04-condition-grammar.md) | §4 Condition grammar |
| [05-world-data-and-save-format.md](05-world-data-and-save-format.md) | §5 World data and save format 2 (5.1, 5.2, 5.3, 5.4) |
| [06-mechanics-as-modules.md](06-mechanics-as-modules.md) | §6 The owner's mechanics as modules (6.1, 6.2, 6.3, 6.4, 6.5, 6.6) |
| [07-puzzle-types.md](07-puzzle-types.md) | §7 Puzzle types (7.1, 7.2, 7.3, 7.4, 7.5, 7.6) |
| [08a-cue-union-and-bus.md](08a-cue-union-and-bus.md) | §8 The cue channel (8.1) |
| [08b-interactions-mechanism-presenters.md](08b-interactions-mechanism-presenters.md) | §8.2 I5: every UI interaction, and its mechanism (8.3, 8.4) |
| [08c-motion-gate-and-contracts.md](08c-motion-gate-and-contracts.md) | §8.5 The motion gate (8.6, 8.7, 8.8) |
| [09-concurrency-and-failure.md](09-concurrency-and-failure.md) | §9 Concurrency and failure model |
| [10-resource-lifetime.md](10-resource-lifetime.md) | §10 Resource lifetime |
| [11-budgets-and-validation.md](11-budgets-and-validation.md) | §11 Budgets and validation (11.1) |
| [12a-lanes.md](12a-lanes.md) | §12 Lanes |
| [12b-lanes-gm1-gm2.md](12b-lanes-gm1-gm2.md) | lanes GM1a, GM1b, GM1c, GM1d, GM2a, GM2b |
| [12c-lanes-gm3.md](12c-lanes-gm3.md) | lanes GM3c, GM3m, GM3w, GM3s, GM3, GM3u, GM3p, GM3b |
| [12d-lanes-gm4-gm5.md](12d-lanes-gm4-gm5.md) | lanes GM4g, GM4, GM4u, GM5, GM5q, GM5f |
| [12e-lanes-gm7-gm9.md](12e-lanes-gm7-gm9.md) | lanes GM7r, GM7p, GM7g, GM8i, GM8h, GM8a, GM8b, GM8d, GM9p, GM9r |
| [12f-order-and-conflicts.md](12f-order-and-conflicts.md) | §12 Order and conflicts |
| [13-owner-questions.md](13-owner-questions.md) | §13 Owner questions |
| [14-interface-requests.md](14-interface-requests.md) | §14 Interface requests to per-player.md, and answers to its §12 (14.1, 14.2, 14.3, 14.4) |
| [15-orchestrator-questions.md](15-orchestrator-questions.md) | §15 Questions for the orchestrator |
| [16-readiness-checklist.md](16-readiness-checklist.md) | §16 Readiness checklist |
| [30-shots-errata.md](30-shots-errata.md) | §30 Shots errata from reconcile |
