# Shots plan: drawn-shot staging (`design-shots`)

**Planned; adopted 2026-11-09 at main `3c62a86`; nothing built yet**; lane cuts re-locate every code citation on their own base. Changed by RULINGS 159-173 (as of `9a83251`; docs lane `docs-errata-10`, group B): still nothing of this plan built or running; its first lane, SH1, follows engine GM2a and GM3w and per-player GM6a in the one order of [engine §12 Order and conflicts](../engine/12f-order-and-conflicts.md#order-and-conflicts). Changed by RULINGS 174-182 (as of `9b4fd25`; docs lane `docs-errata-11`, group B): still nothing of this plan built or running; GM2a has merged (`9b4fd25`, RULINGS 181) and GM3w runs (RULINGS 182), so SH1 waits for GM3w and per-player GM6a, which is next when a client slot frees. Changed by RULINGS 183-197 (as of `837b1ed`; docs lane `docs-errata-12`, group B): its first lane, SH1 `shot-dsl`, runs (base `837b1ed`, lock 12, RULINGS 196), since GM3w (`508bd36`) and per-player GM6a (`23e1d31`) have merged; nothing of this plan is built yet; SH2 `shot-flow` follows SH1. Changed by RULINGS 198-209 (as of `461424d`; docs lane `docs-errata-13`, group B): built since: SH1 `shot-dsl` (`2db33c3`, RULINGS 201; lock 13, RULINGS 198) and SH2 `shot-flow` (`7f45dee`, RULINGS 207); no lane of this plan runs; next, SH3a `shot-assets` after SH2, once engine lever P (running, RULINGS 209) frees `budget.ts` / `budget.test.ts` (the `budget.ts` row of the one order). Changed by RULINGS 209-225 (as of `52e328e`; docs lane `docs-errata-14`, group B): nothing of this plan built since `461424d`, and no lane of this plan runs; engine lever P merged as `3d120bc` (RULINGS 213), so SH3a `shot-assets` follows it on `budget.ts` / `budget.test.ts` with no lever between (O5 and Y are approved designs on the shelf, RULINGS 221, 222, 224); SH3a is next when a client slot frees (engine GM3u and E6 hold both, RULINGS 225), its entry term watched against Ledger 2's 1.070 KB at its cut (RULINGS 224). Changed by RULINGS 225-237 (as of `0b91acc`; docs lane `docs-errata-15`, group B): nothing of this plan built since `461424d`, and no lane of this plan runs; engine lever O5 ran on the trigger fired at E6's merge and merged as `9a0ae2d` (RULINGS 228, 230, 234; the `overlays chunk (br)` row in `budget.ts`), so SH3a `shot-assets` follows O5 on `budget.ts` / `budget.test.ts` with no lever between (Y is on the shelf, RULINGS 234); SH3a is next when a client slot frees (engine GM3p runs in lane A, and lane C is kept for engine GM3b, RULINGS 237), its entry term watched against Ledger 2's 1.331 KB at its cut (RULINGS 236).

## Provenance

- Source: `design/shots/proposal.md` in the orchestration repo, frozen at tag `designs-adopted-2026-11-09` (`5533440`), sha256 `80c42f11…`: revision 7. Architect, 2026-11-03; inputs: the research reports S1-S4, characters.md rev. 3 (CH), the engine and per-player designs as read 2026-11-03 (EN, PPL), RULINGS 132-133 and 136-138.
- Approved by `design/shots/critique_r7.md` (RULINGS 143); folded into the mechanics design by reconcile (RULINGS 153, engine §30); adopted by RULINGS 143, 136 / 138 (d) (scope) and 158.
- History, kept at the tag and not adopted: the revision summaries of the header and "Revision 2" - "Revision 7" (the patch logs).

## Reading rule

- Each lane reads [§0 Decision table](00-decision-table.md#0-decision-table), its own §9.x file, [engine §12 Order and conflicts](../engine/12f-order-and-conflicts.md#order-and-conflicts) (the one order of the three plans; [§9.14 Order and conflicts](09f-order-and-conflicts.md#914-order-and-conflicts-superseded-by-engine-12) is superseded), the rows of [§10.1 Fixture ledger](10-budgets-and-validation.md#101-fixture-ledger-rev-6-rulings-138-c-the-invariant-s34) that name its tests, and the sections its Goal names.
- Lanes: SH1 [§9.1](09a-lanes-sh1-sh2.md#91-sh1-shot-dsl-client), SH2 [§9.2](09a-lanes-sh1-sh2.md#92-sh2-shot-flow-client-story-tool), SH3a [§9.3](09b-lanes-sh3a-sh3b.md#93-sh3a-shot-assets-client-asset-tool-the-contract-placeholders-tiers-scan-dist), SH3c [§9.3c](09b-lanes-sh3a-sh3b.md#93c-sh3c-shot-extract-client-asset-tool-real-art-from-src-rev-4-w5), SH3b [§9.4](09b-lanes-sh3a-sh3b.md#94-sh3b-shot-budget-client-budget), SH4 [§9.5](09c-lanes-sh4-sh5b.md#95-sh4-shot-view-client-runtime), SH5a [§9.6](09c-lanes-sh4-sh5b.md#96-sh5a-shot-preload-client-runtime-windows-warm-rooms), SH5b [§9.6b](09c-lanes-sh4-sh5b.md#96b-sh5b-shot-entry-client-runtime-the-half-tier-entry-rev-4-split), SH6 [§9.7](09d-lanes-sh6-sh10.md#97-sh6-shot-cuts-client-runtime), SH7 [§9.8](09d-lanes-sh6-sh10.md#98-sh7-shot-idle-client-runtime), SH8 [§9.9](09d-lanes-sh6-sh10.md#99-sh8-shot-motion-client-runtime), SH9 [§9.10](09d-lanes-sh6-sh10.md#910-sh9-shot-ambient-client-runtime-the-mr2-ambient-role), SH10 [§9.11](09d-lanes-sh6-sh10.md#911-sh10-scene-cues-client-the-mr1-role), SH11 [§9.12](09e-lanes-sh11-sh12b.md#912-sh11-shot-content-manor-content--e2e), SH12a [§9.13](09e-lanes-sh11-sh12b.md#913-sh12a-sprites-out-client-the-kinds-atomic-rev-4-split-w6), SH12b [§9.13b](09e-lanes-sh11-sh12b.md#913b-sh12b-sprites-residue-client-rev-4-split).
- The generation parts are not adopted (RULINGS 136): §6.1-§6.4 are stubs, §8's S-L row and S-A's generation criteria are stubbed in place; the record stays at the tag.
- Repo facts are `path:line` on the main commit each revision names (`cdca9d4` / `525dd68` / `d31f720`): a lane cut re-locates them on its own base. Design citations are links to the section they meant.

Owner questions (§12): OQ1 and OQ2 answered (Krea 2; an RTX 5080, RULINGS 136, 138 (d)); OQ3, OQ10 and OQ14 not asked (generation, RULINGS 136); the rest asked as Q57, every default adopted (RULINGS 154).

## Keys

| Key | Meaning | Where |
|---|---|---|
| S1 | `design/shots/research_S1-local-krea-lora.md` | orchestration repo, at the tag |
| S2 | `design/shots/research_S2-shot-pipeline.md` | orchestration repo, at the tag |
| S3 | `design/shots/research_S3-cinematic-staging.md` | orchestration repo, at the tag |
| S4 | `design/shots/research_S4-engine-fit.md` | orchestration repo, at the tag |
| CH | `design/animation/characters.md` rev. 3 (stopped by RULINGS 132) | orchestration repo |
| EN | the engine plan; its line numbers in the body were "as read 2026-11-03" and are now links | [engine plan](../engine/README.md) |
| PPL | the per-player plan; as EN | [per-player plan](../per-player/README.md) |
| SH | this plan; `SH<n>` is one of its lanes | this directory |
| MEASURED / DOCUMENTED / CLAIMED / A / E / verify (and ARITHMETIC, CLAIM) | the label of every figure: measured (a named test), the vendor's own page, a secondary source, arithmetic done here, the architect's estimate, not yet checked; ARITHMETIC (once, in §10) and CLAIM (in the lines the adoption applied from engine §30 and RULINGS 158) are the engine labels, quoted | [labels and owner values](labels-and-owner-values.md) |
| Repo facts | `path:line` on the main commit each revision names (`cdca9d4` / `525dd68` / `d31f720`) | the repository at that commit |
| Web facts | a URL, read 2026-11-03 (by the research report under its source key, or by the architect) | the URL |

## Files

| File | Contents |
|---|---|
| [labels-and-owner-values.md](labels-and-owner-values.md) | the labels of every figure and the owner values this plan builds on |
| [00-decision-table.md](00-decision-table.md) | §0 Decision table |
| [01-goal-and-constraints.md](01-goal-and-constraints.md) | §1 Goal and constraints |
| [02-shot-model.md](02-shot-model.md) | §2 THE SHOT MODEL (2.1, 2.2, 2.3, 2.4, 2.5, 2.6) |
| [03-story-dsl.md](03-story-dsl.md) | §3 THE STORY DSL (3.1, 3.2, 3.3, 3.4, 3.5, 3.6) |
| [04-asset-pipeline.md](04-asset-pipeline.md) | §4 THE ASSET PIPELINE (4.1, 4.2, 4.3, 4.4, 4.5) |
| [05a-runtime.md](05a-runtime.md) | §5 THE RUNTIME (5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7) |
| [05b-preload-memory-download.md](05b-preload-memory-download.md) | §5.8 Preload policy for cuts (5.9, 5.10, 5.11) |
| [06-art-pipeline.md](06-art-pipeline.md) | §6 THE OWNER'S ART PIPELINE (6.1, 6.2, 6.3, 6.4, 6.5, 6.6) |
| [07-characters-md-kept-changed-dropped.md](07-characters-md-kept-changed-dropped.md) | §7 characters.md rev. 3: kept, changed, dropped |
| [08-spikes.md](08-spikes.md) | §8 Spikes before the lanes |
| [09a-lanes-sh1-sh2.md](09a-lanes-sh1-sh2.md) | §9 Lanes (9.1, 9.2) |
| [09b-lanes-sh3a-sh3b.md](09b-lanes-sh3a-sh3b.md) | §9.3 SH3a `shot-assets` (9.3c, 9.4) |
| [09c-lanes-sh4-sh5b.md](09c-lanes-sh4-sh5b.md) | §9.5 SH4 `shot-view` (9.6, 9.6b) |
| [09d-lanes-sh6-sh10.md](09d-lanes-sh6-sh10.md) | §9.7 SH6 `shot-cuts` (9.8, 9.9, 9.10, 9.11) |
| [09e-lanes-sh11-sh12b.md](09e-lanes-sh11-sh12b.md) | §9.12 SH11 `shot-content-manor` (9.13, 9.13b) |
| [09f-order-and-conflicts.md](09f-order-and-conflicts.md) | §9.14 Order and conflicts |
| [10-budgets-and-validation.md](10-budgets-and-validation.md) | §10 Budgets and validation (10.1) |
| [11-interface-requests.md](11-interface-requests.md) | §11 Interface requests to engine.md |
| [12-owner-questions.md](12-owner-questions.md) | §12 Owner questions |
| [13-orchestrator-questions.md](13-orchestrator-questions.md) | §13 Questions for the orchestrator |
| [14-resource-lifetime.md](14-resource-lifetime.md) | §14 Resource lifetime |
| [15-readiness-checklist.md](15-readiness-checklist.md) | §15 Readiness checklist |
