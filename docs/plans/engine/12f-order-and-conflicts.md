### Order and conflicts

**Round 3 (m1): one order, written once.** Each lane's `After` names every predecessor on every shared file of its
lock plus its semantic dependencies; `Beside` names the lanes it may run with (locks checked disjoint). The lane
sections above carry the same fields; where a section and this table ever disagree, the table is the error to fix.
Lane cap 3 (1 server + 2 client) still holds: at most one `Beside` pair runs at a time.

```
done:      M3c (a6365a8), docs-errata-8 (be6c348), LRF (a93fe54), docs (d31f720, Q56), docs-errata-9 (525dd68);
           reconcile r1: LEL (7b37278, RULINGS 141), LBI (fe996a0, RULINGS 145), LHJ (972f773), M3s (a5f887b),
           docs acc4e0d / df0e12c (Q15a-h, Q57: every default adopted, RULINGS 154),
           LFL (cec347c, RULINGS 155: merged while this revision was written, .git/logs/HEAD:112)
           adoption (main 3c62a86): LRB (3c62a86, RULINGS 157; it took arch.test.ts)
           after the adoption (main 9a83251): L1 l1-entry-summary (eec24fe, RULINGS 159), GM6k (fd62933,
           RULINGS 163), GM1a (ef8b4dc, RULINGS 165), GM6s1 (81a15b0, RULINGS 168), GM1b (03a00bc, RULINGS 171),
           docs-adopt (f509b05, RULINGS 172), docs 9a83251 (Q58: per-player OQ1-OQ7 asked)
           after docs-errata-10 (main 9b4fd25): docs-errata-10 (5977df5, RULINGS 174), docs 967a8da (every open
           question's default adopted, Q58 resolved, RULINGS 175), GM6s2 (2815340, RULINGS 176; the per-player
           server chain GM6k -> GM6s1 -> GM6s2 is done), GM1c (8c2fa03, RULINGS 178), GM2a (9b4fd25, RULINGS 181)
in flight: (as of 9b4fd25) GM1d gm1d-mech-clues (RULINGS 179 / 180; base 8c2fa03, launched beside GM2a; lock 11:
           client/src/world/{types,decode}.ts, decode.test.ts, scripts/story/{lint,world.test,build.test}.ts,
           scripts/story/mechanics/{clues,index}.ts, scripts/story/puzzles/shape.ts, mechanics/rules/search.ts,
           story/ch1/world.json), GM3w gm3w-ui-wiring (RULINGS 182; lock 10: app/{game,yields}.ts, game.test.ts,
           ui/{App.svelte,explore-view.svelte.ts,puzzle-view.svelte.ts}, ui/explore/{ExploreView.svelte,
           explore.svelte.test.ts}, ui/puzzles/{PuzzleHost.svelte,puzzle-host.svelte.test.ts}), docs-errata-11
           (RULINGS 182; docs only, in the idle server slot)
next:      per-player GM6a (after GM2a's field; with GM3w it gates SH1) and GM3m (after GM1c, GM1b) when a client
           slot frees (RULINGS 182); GM2b after GM1d; SH1 after GM3w and GM6a
carried:   L2, the entry lever (shelved, RULINGS 142 / 158; return line: entry headroom < 0.5 KB br, §15 item 15);
           the preload-priority lane (RULINGS 152 Q14 (b); scene/{registry,preload}.ts, the scene/* tail)
stopped:   the character half of design-animation (RULINGS 132), replaced by design-shots (RULINGS 143)
LFL's nine files: client/src/app/{boot,game,meta,game.test,meta.test}.ts, client/scripts/{budget,budget.test}.ts,
           client/e2e/perf.spec.ts, client/src/arch.test.ts (lfl-first-line/test_r2.md:85-86)
```

**Ruled: RULINGS 190, 195, 196** — the `next:` line gains the engine-closure lever lane (Ledger 4's headroom 0.873 KB
on `837b1ed`, under the 1.0 KB trigger): it runs in the first client slot after GM3s merges, before GM3 or any later
engine-adding lane; the `carried:` line gains its second candidate, P (`purchase/flow.ts`, ~-1.52 KB br), which joins
the lever only if `game.ts` is free (SH1 merged) and otherwise stays the next lever
([§11.1 Ledger 4](11-budgets-and-validation.md#111-the-shared-ledgers-reconcile-r1-r2-rulings-143-qo10-152-r4-153-155-design-shots-i-13)).

Changed by RULINGS 159-173 (as of `9a83251`; docs lane `docs-errata-10`, group B): the block above is the state at
`9a83251` (SHAs from `git log --first-parent main`). L1, GM6k, GM1a, GM6s1, GM1b and `docs-adopt` moved to `done:`;
the `in flight:` line read "(as of 3c62a86) docs-adopt (RULINGS 158; docs only), L1 l1-entry-summary (RULINGS 158;
client/src/saves/**, client/src/app/{boot,game}.ts, client/src/arch.test.ts)"; the `next:` line is new. The rows
below keep GM1a, GM1b, GM6k and GM6s1 as the predecessors they name; all four have merged.

Changed by RULINGS 174-182 (as of `9b4fd25`; docs lane `docs-errata-11`, group B): the block above is the state at
`9b4fd25` (SHAs from `git log --first-parent main`). `docs-errata-10`, the docs commit `967a8da`, GM6s2, GM1c and GM2a
moved to `done:`; the `in flight:` line read "(as of 9a83251) GM6s2 gm6s2-values-routes (RULINGS 169 / 170; lock 22:
server/src/{content,error}.rs, the puzzle repository / domain / route, the client api contract,
client/src/app/{game,yields}.test.ts, client/src/puzzles/session.test.ts), docs-errata-10 (RULINGS 173; docs only)",
and the `next:` line read "GM1c and GM2a (Beside), after GM6s2 merges: GM1c holds puzzles/session.test.ts, GM2a
app/{game,yields}.test.ts, all in GM6s2's lock (RULINGS 170, 173)". GM1d ran beside GM2a, a pair the order table
does not list (lock-disjoint, checked at launch: RULINGS 179), and now runs beside GM3w, a pair it lists (GM1d's row:
Beside GM3m, GM3w). The rows below keep GM6s2, GM1c and GM2a as the predecessors they name; all three have merged.

**The one order across the three designs (reconcile r1; RULINGS 143, 152, 153; design-shots §9.14 and I-2,
adopted with one change; it replaces the paragraph "Animation and shot lanes" that earlier sections cite).** The **A(f)** placeholders of rounds 4-14 ("every lane of an adopted animation or shot design
that holds file f") are retired: `design-shots` is the adopted design (RULINGS 143) and its §9.14 names its lanes, so
every A(f) below is replaced by those lanes in §9.14's order, and the rows below are the one order for the GM lanes
(this file), the GM6 lanes (`per-player.md`, whose §9 defers cross-design order here) and the SH lanes. The invariant
stays: **two lanes never hold one file at once; a row's holders run in its order, "by launch" meaning whichever starts
first holds the file until it merges, "never beside" meaning neither starts while the other is open.** The one change
to §9.14 (I-2): `budget.ts` / `budget.test.ts` read `{SH3a, GM3s}` by launch, then SH3b, where §9.14 reads SH3a ->
`{SH3b, GM3s}`: GM3s's hunks (the cue-stage family row, `cueStageChunkBr`, `LAZY_DIRS`) need none of SH3a's Records,
and §9.14's order would hold the whole GM3 chain (GM3s gates GM3, GM3u, GM3p, GM3b) behind the shot chain's start;
SH3b depends on SH3a and edits the same file, so it follows both. Roles: **MR1 = SH10**, **MR2 = SH8 + SH9**, **MA1's
executor duties = SH7** (§8.7). Rev. 3's lanes (MD1a, MD1b, MD2, MD3, MA1a, MA1b, MA2) no longer exist. Merged lanes
are shown as merged; LRB merged as `3c62a86` (RULINGS 157); L1 (`l1-entry-summary`, RULINGS 158; merged `eec24fe`, RULINGS 159) comes after it on
`game.ts`, `boot.ts` and `arch.test.ts`. Line numbers that LFL moved (`game.ts`, `budget.ts`, `boot.ts`, `arch.test.ts`) are
re-located at each holder's cut.

| Lane | After (shared file or dependency) | Beside |
|---|---|---|
| GM1a | M3c (merged) | - |
| GM1b | GM1a | - |
| GM1c | GM1b (`scripts/story/world.ts`), GM1a (`arch.test.ts`) | GM2a |
| GM2a | GM1b (`reconcile.ts`, `explore.test.ts`), GM1a (`yields.ts`, `resume.test.ts`); reconcile r1: LFL (merged) and LRB (merged `3c62a86`) on `game.ts`, `game.test.ts`; L1 (RULINGS 158; merged `eec24fe`, RULINGS 159) on `game.ts`; before SH1 (`game.ts`, `staging.ts`, the `scene/*` field) | GM1c |
| GM1d | GM1c (`world/{types,decode}.ts`); reconcile r1: SH12b after it on `lint.ts` (round 4: GM1d holds `lint.ts`'s one `Finding.code` hunk); SH2 never beside (`story.ts`, if GM1d's verify item takes it) | GM3m, GM3w |
| GM3m | GM1c (`arch.test.ts`, `puzzles/rules/index.ts`), GM1b (`mechanics/contract.ts`) | GM1d, GM2b, GM3c, GM3w |
| GM3w | GM2a (`game.ts`, `game.test.ts`, `yields.ts`); reconcile r1: before SH1 on `game.ts` (design-shots I-2: SH1's cut follows GM3w's merge) | GM1d, GM2b, GM3c, GM3m |
| GM2b | GM1d (`world/*`, `build.test.ts`, `world.test.ts`), GM2a (`reconcile.ts`, `explore.test.ts`); GM1b (`mechanics/core.ts`, round 4: replaces `lint.ts`) | GM3m, GM3w |
| GM3c | GM2b (`world/*`, `decode.test.ts`; round 6: `scripts/story/world.ts`, `world.test.ts`), GM1d (`scripts/story/mechanics/index.ts`) (round 4: no `lint.ts`); before GM3 (the first module with texts) and per-player GM6c1a (R-E25) | GM3m, GM3w, GM3s |
| GM3s | GM3m (`cues/**`, `arch.test.ts`), GM3w (`App.svelte`, the explore view files, `yields.ts`); reconcile r1: LFL (merged) on `budget.ts`, `budget.test.ts`, then SH3a by launch, never beside; SH6 never beside (`arch.test.ts`) | GM3c |
| GM3 | GM3c (index files), GM3s (`yields.ts`), GM3m (`motions.ts`), GM1b (`rules/{core,writer}.ts`) | - |
| GM3u | GM3 (`yields.ts`), GM3s (`ExploreView.svelte`, `arch.test.ts`, the e2e) | - |
| GM3p | GM3u (`yields.ts`, `controls.test.ts`, the e2e), GM3w (`PuzzleHost.svelte`, `puzzle-view.svelte.ts`, round 9: `puzzle-host.svelte.test.ts`), GM3s (round 9: the `CueStage.svelte` its real-flush tests render) | - |
| GM3b | GM3p (`yields.ts`, the e2e), GM2b (`emit.ts`), GM1d (`story/ch1/world.json`, `build.test.ts`); **per-player GM6a** | - |
| GM4g | GM3b (`emit.ts`, `build.test.ts`), GM3s (`budget.ts`); reconcile r1: SH3b (`budget.ts`, `budget.test.ts`, the sheet helper, I-3), SH3a -> SH3c (`scripts/assets/manifest.ts`, `assets.test.ts`) | - |
| GM4 | GM4g (`emit.ts`), GM3b (`controller.ts`, `yields.ts`, index files); P2-a read | - |
| GM4u | GM4 (`yields.ts`), GM3u (`ExploreView.svelte`), GM3b (`story/ch1/world.json`) | - |
| GM5 | GM4u (`yields.ts`, the explore view files, the e2e), GM3 (`motions.ts`), GM1b (`spike-p2.test.ts`) | - |
| GM5q (round 4; only if P2-b demands it) | GM5 (`spike-p2.test.ts`, P2-b), GM4 (`mechanics/view.test.ts`), GM3 (`explore.test.ts`), GM1d (`rules/search.ts`); all earlier than GM5 already | - |
| GM5f | GM5 (index files, `motions.ts`, `spike-p2.test.ts`), GM5q when it runs (`spike-p2.test.ts`, `explore.test.ts`), GM2b (`reconcile.ts`) | GM7r |
| GM7r | GM5 (`yields.ts`), GM3p (`puzzle-view.svelte.ts`, `PuzzleHost.svelte`, `puzzle-host.svelte.test.ts`), GM1c (`session.ts`, `registry.ts`); never beside per-player GM6c2 | GM5f |
| GM7p | GM7r (`registry.ts`), GM1d (`clues.ts`, `shape.ts`), GM1c (`scripts/story/puzzles/index.ts`, round 4), GM4g (`budget.ts`), GM3u (`arch.test.ts`), GM3p (`puzzle-types.svelte.test.ts`); **per-player GM6k** | GM8i |
| GM7g | GM7p (`scripts/story/puzzles/index.ts` and every other shared file), GM7r (`session.test.ts`); **per-player GM6s1** | GM8i |
| GM8i | GM5f (index files, `motions.ts`), GM4 (`controller.ts`), GM3c (`rules/conditions.ts`); **per-player GM6a** | GM7p, GM7g |
| GM8h | GM8i, GM7g (`registry.ts`, `session.test.ts`, round 5: `rules/index.ts`), GM7r (`session.ts`, `puzzle-view.svelte.ts`, `PuzzleHost.svelte`, round 5: `reachEdge`, `Open.reach`), GM5 (`ExploreView.svelte`, `explore.svelte.test.ts`, `yields.ts`); never beside per-player GM6c2 / GM6c4 | - |
| GM8a | GM8h (`registry.ts`, round 5: `rules/index.ts`), GM7g (`arch.test.ts`, the type tests, `scripts/story/puzzles/index.ts`), GM4g (`build.test.ts`); **per-player GM6k** (round 4: no e2e) | GM9p |
| GM8b | GM8a; **per-player GM6k** | GM9p |
| GM8d (round 4, W2) | GM8b (every type in the tree), GM5 (`client/e2e/mechanics.spec.ts`), GM2a (`client/e2e/helpers.ts`), GM3b (`assets/catalog.json`, round 5); **per-player GM6k**, GM6s1; reconcile r1: SH9 on `assets/catalog.json` by launch, never beside; SH11 after it on `story/ch3/main.ink` (I-15) | GM9p |
| GM9p | GM8i (index files), GM3c (`world.test.ts`, round 6; GM2b before it), GM1a (`softlock.ts`) (round 4: no `lint.ts`) | GM8a, GM8b, GM8d |
| GM9r | GM9p, GM8d (the e2e, round 4), GM8h (`yields.ts`), GM4u (`story/ch1/world.json`, round 5: `story/locales/en/ch1.json`), GM2a (`resume.ts`); reconcile r1: SH1, SH5a, SH5b, SH7 and per-player GM6c2 / GM6c3 / GM6d1 (`game.ts`); SH12a after it on `game.test.ts` | - |

**The SH lanes and the GM6 lanes' cross-design edges (reconcile r1; design-shots §9.14 as adopted, with I-2's change;
per-player's own order, `per-player.md` §9, inside each design is unchanged).** Each row names every predecessor on a
shared file of the lane's lock (`proposal.md` §9, the lane's Lock) and its semantic dependencies; "merged" lanes are
done. The SH rows come from §9.14's file list (the shots' own statement of the files its lanes share); a cut of any
lane of the three designs that finds a lock path held by another open or planned lane and in no row below STOPs, and
the table is the error to fix (the rule of this section's first paragraph).

| Lane | After (shared file or dependency) | Beside |
|---|---|---|
| SH1 | GM2a (`staging.ts`, `game.ts`, the `scene/*` field), GM3w (`game.ts`), per-player GM6a (`scene/*`); LFL, LRB (merged) on `game.ts`, `game.test.ts`; L1 (RULINGS 158; merged `eec24fe`, RULINGS 159) on `game.ts`; first holder of `graph.ts`, `tags.ts`, `dsl-doc.test.ts`, `STAGING-DSL.md` | none on `scene/*` or `game.ts` |
| SH2 | SH1 (`graph.ts`, `STAGING-DSL.md`); never beside GM1d, GM2b, GM3c, GM9p, per-player GM6c1a, GM6c1b (`client/scripts/story.ts`), never beside GM1a or GM3 (`playthrough.ts`) | M3s (merged: moot) |
| SH3a | M3s (merged; `scripts/assets/manifest.ts`, `assets.test.ts`); LEL, LFL (merged) on `budget.ts`, `budget.test.ts`; GM3s by launch, never beside (I-2, the change above); reconcile r2 (RC-W3): **SH2** (its tiers read `build/shots.json`'s `assets`, which SH2's `shots/usage.ts` creates, [shots §9.3 SH3a `shot-assets`](../shots/09b-lanes-sh3a-sh3b.md#93-sh3a-shot-assets-client-asset-tool-the-contract-placeholders-tiers-scan-dist), [shots §9.3 SH3a `shot-assets`](../shots/09b-lanes-sh3a-sh3b.md#93-sh3a-shot-assets-client-asset-tool-the-contract-placeholders-tiers-scan-dist); its Order, [shots §9.3 SH3a `shot-assets`](../shots/09b-lanes-sh3a-sh3b.md#93-sh3a-shot-assets-client-asset-tool-the-contract-placeholders-tiers-scan-dist)) | - |
| SH3b | SH3a and GM3s (`budget.ts`, `budget.test.ts`), SH2 (`shots/lint.ts`, `STAGING-DSL.md`) | SH3c; SH4 if SH4 waits only for SH3a |
| SH3c | SH3a (`scripts/assets/**`, `assets.test.ts`) | SH3b, SH4 |
| SH4 | SH1 (`scene/*`), SH3a (`story/shots.ts`'s decoders); first holder of `story/ch4/main.ink`, `client/e2e/shots.spec.ts` | SH3b, SH3c |
| SH5a | SH4 (`scene/*`, `registry.ts`), SH1 (`game.ts`, `game.test.ts`), GM3b (I-11's `Yields.roomFor`) | - |
| SH5b | SH5a (`scene/*`, `game.ts`, `loader.ts`, `preload.ts`, the e2e) | - |
| SH6 | SH5b (`scene/*`, `registry.ts`), SH4 (`story/ch4/main.ink`); `arch.test.ts` by launch, never beside GM1c, GM3m, GM3s, GM3u, GM7p, GM7g, GM8a, GM8b | - |
| SH7 | SH6 (`scene/*`), SH5b (`game.ts`); GM3s (the `sceneCues` seam it implements, I-4), GM3m (`FRAME_OPEN_MS`, I-7); GM3p (reconcile r2: always merged by SH7's cut, since SH5a needs GM3b, which follows GM3p; `requests.test.ts`, its `scene/motion/` `import()` row, §30 item 11; and `YieldsHost.frameShown`, the edge its cover follows, RC-W5); reconcile r2 (RC-W3): **SH3b** (the `scene-motion chunk (br)` row its Gates leave PENDING and **M-SH7d**'s red reads, [shots §9.8 SH7 `shot-idle`](../shots/09d-lanes-sh6-sh10.md#98-sh7-shot-idle-client-runtime), [shots §9.8 SH7 `shot-idle`](../shots/09d-lanes-sh6-sh10.md#98-sh7-shot-idle-client-runtime), [shots §9.8 SH7 `shot-idle`](../shots/09d-lanes-sh6-sh10.md#98-sh7-shot-idle-client-runtime)) | - |
| SH8 | SH7 (`scene/*`, `scene/motion/*`, `client/e2e/animation.spec.ts`), SH6 (`story/ch4/main.ink`) | - |
| SH9 | SH8 (`scene/*`, `scene/motion/*`, the e2e), per-player GM6c4 (`explore/controller.ts`, I-16's one hunk, never beside); GM3b, GM8d (`assets/catalog.json`, by launch, never beside either) | engine lanes off `scene/*`, `motions.ts`, `catalog.json` |
| SH10 (MR1) | SH8 (`scene/*`), GM8i (`motions.ts`); GM3b, GM3s, GM3m, per-player GM6a, GM8i, SH6, SH7 (design-shots I-2's MR1 row); SH6 (`client/e2e/shots.spec.ts`) | engine lanes off `scene/*`, `motions.ts` |
| SH11 | SH10 (`client/e2e/shots.spec.ts`), GM8d (`story/ch3/main.ink`, never beside), M3s (merged; `memory.spec.ts`); `story/ch1/world.json`'s room event (I-18); reconcile r2 (RC-W3): **SH9** (all features: the ch1 / ch2 / ch3 restage's `e2e full` runs with the ambient loops and loop props, [shots §9.12 SH11 `shot-content-manor`](../shots/09e-lanes-sh11-sh12b.md#912-sh11-shot-content-manor-content--e2e)), SH6 (`story/shots.json`, below) | - |
| SH12a | GM9p (`graph.ts`, never beside), GM8b and per-player GM6c1a, GM6c1b (`build.test.ts`), GM9r (`game.test.ts`), SH1 (`staging.ts`, `tags.ts`), SH2 (`shots/flow.ts`), the `scene/*` tail by launch; reconcile r2 (RC-W3): **SH11** (no chapter keeps a `show:` tag once SH11 restages ch1-ch3 and SH4 / SH6 ch4: main holds 20, §1; removing the kind first makes each one `tag/unknown-kind` and `npm run story` red; [shots §9.13 SH12a `sprites-out`](../shots/09e-lanes-sh11-sh12b.md#913-sh12a-sprites-out-client-the-kinds-atomic-rev-4-split-w6)) | - |
| SH12b | GM1d (`lint.ts`), per-player GM6d2 (`budget.ts`, `budget.test.ts`, `knotRows`, never beside), SH3b (`shots/lint.ts`), SH12a (`dsl-doc.test.ts`, `STAGING-DSL.md`, `shots/flow.ts`), the `scene/*` tail by launch | - |
| per-player GM6a | GM2a's field (`scene/*`); before SH1 (`scene/*`) and GM3b (E-P1, E-P7) | (per-player.md) |
| per-player GM6c2, GM6c3 | SH7 (`game.ts`; the game.ts row below); GM3p (`requests.test.ts`, E-P23) | (per-player.md) |
| per-player GM6d1 | GM6c3 (`game.ts`); SH8 (`scene/*`, the loop of SH7, I-9), by launch in the `scene/*` tail | (per-player.md) |
| per-player GM6c4 | GM8i (`explore/controller.ts`); before SH9 (I-16); its `story/ch1/world.json` cut checks I-18 | (per-player.md) |
| per-player GM6d2 | GM7p (`budget.ts`), GM6c4 (`story/ch1/world.json`, I-18 check); before SH12b (`budget.ts`) | (per-player.md) |
| per-player GM6c1a, GM6c1b | GM4g / GM8b's `build.test.ts` order by launch; before SH12a (`build.test.ts`); never beside SH2 (`story.ts`) | (per-player.md) |
| per-player GM6s2, GM6t | the entry ledger (§11.1): each quotes the entry row at its cut and STOPs past L1 / L2's line (§15 item 15); GM6t after GM3s on `App.svelte` | (per-player.md) |

| Shared file | Holders in order |
|---|---|
| `client/src/explore/controller.ts`, `controller.test.ts` | GM1a -> GM3 (test only) -> GM3b -> GM4 -> GM8i -> per-player GM6c4 -> SH9 (reconcile r1, design-shots I-16: `shotImages` in the neighbour preload, one hunk; never beside) |
| `client/src/app/yields.ts`, `yields.test.ts` | GM1a -> GM2a -> GM3w (`yields.ts` only: the `apply` dep's type, round 4, and `retrying: false` in `openPuzzle`'s frame literal, round 8; named in round 9, critique_engine_r8 drift) -> GM3s -> GM3 -> GM3u -> GM3p -> GM3b -> GM4 -> GM4u -> GM5 -> GM7r -> GM8h -> GM9r; per-player GM6c2, GM6c4, GM6d2 by launch, never beside one of these |
| `client/src/app/game.ts` | reconcile r1: LBI, LFL (merged) -> LRB (merged `3c62a86`, RULINGS 157) -> L1 (`l1-entry-summary`, RULINGS 158; merged `eec24fe`, RULINGS 159) -> GM2a -> GM3w (two hunks, round 4) -> SH1 -> SH5a -> SH5b -> SH7 -> per-player GM6c2 -> GM6c3 -> GM6d1 -> GM9r, one at a time (was: GM2a -> GM3w -> A(`game.ts`) (rev. 3: MD2 -> MA1a -> MA1b) -> per-player GM6c2 -> GM6c3 -> GM6d1 -> GM9r) |
| `client/src/app/game.test.ts` (reconcile r1, new row) | LEL, LBI, LFL (merged) -> LRB (merged `3c62a86`) -> the `game.ts` row's holders that test it, in that row's order -> SH12a (`reduceStage`, the `# show:` fixture) |
| `client/src/app/boot.ts`, `client/src/app/meta.ts`, `meta.test.ts` (reconcile r1, new row) | LEL, LBI, LFL (merged) -> LRB (merged `3c62a86`) -> L1 (`l1-entry-summary`, RULINGS 158; merged `eec24fe`, RULINGS 159; `boot.ts`); no GM, GM6 or SH lane holds them |
| `client/src/ui/App.svelte` | GM3w (round 8: also the `.host-failed` Retry's `disabled={frame.retrying}`) -> GM3s (round 7: the `.host-failed` block's cue markers) -> per-player GM6t (one prop, per-player round 4); nothing later of this design (round 3 W1: `coversStage` from GM3w on is the only seam; GM8h narrows it in `puzzle-view.svelte.ts`) |
| `client/src/geom/cover.ts` (round 7, m1) | GM3c only (`HOTSPOT_MIN_SOURCE_PX` moved in); later lanes import it; no per-player lane holds it (verify at GM3c's cut against the shot design's locks, which read it) |
| `client/src/ui/explore/ExploreView.svelte`, `explore.svelte.test.ts` | GM3w -> GM3s -> GM3u -> GM4u -> GM5 -> GM8h (round 3 W1) -> per-player GM6c4 |
| `client/src/ui/explore-view.svelte.ts` | GM3w -> GM3s -> GM3u -> GM4u -> GM5 -> per-player GM6c4 |
| `client/src/ui/puzzle-view.svelte.ts`, `ui/puzzles/PuzzleHost.svelte`, `puzzle-host.svelte.test.ts` | GM3w (view file and the CSS rule; round 8: `retrying`, Retry's `disabled` and the test's `frameOf` field) -> GM3p -> GM7r -> GM8h |
| `client/src/puzzles/registry.ts` | GM1c -> GM7r -> GM7p -> GM7g -> GM8h -> GM8a -> GM8b |
| `client/src/puzzles/session.ts`, `session.test.ts` | GM1c -> GM7r -> GM7g (test) -> GM8h (round 3 W2); per-player GM6c2 never beside GM7r / GM7g / GM8h |
| `client/src/puzzles/rules/index.ts`, `rules.test.ts`, `puzzles/ui/puzzle-types.svelte.test.ts` | GM1c -> GM3m (`rules/index.ts` only: `PuzzleTypeData.controls?`, round 4) -> GM3p (the svelte test) -> GM7p -> GM7g -> GM8h (`rules/index.ts` only: `instanceOf`'s `work` branch, round 5 m1) -> GM8a -> GM8b |
| `client/src/puzzles/play/reach.ts`, `reach.test.ts` (round 5, W3) | GM7r (new); later type UIs import it, no lane edits it |
| `client/scripts/story/puzzles/index.ts` (round 4, `PUZZLE_LINTS`) | GM1c (new, the `code` / `order` lines) -> GM7p -> GM7g -> GM8a -> GM8b (one line per type). **Ruled: RULINGS 178** — Q7' option B: per-player GM6c1a also holds the file for one hunk (`PuzzleTypeLint.domainFits?(p: P, d: Domain): string \| null` beside the TypeScript `Domain` type it defines), never beside GM7p / GM7g / GM8a / GM8b (whichever holds the file first holds it to its merge) |
| `client/src/mechanics/contract.ts` (round 4) | GM1b (new) -> GM3m (`MechanicData.controls?`) |
| `client/scripts/story/lint.ts` (round 4; round 5, per-player R-E23) | **GM1d** (one hunk: `Finding.code`'s union) **-> SH12b** (reconcile r1: the one-line removal of `budget/knot-set`; was: A(`lint.ts`) (rev. 3: MA1b -> MD3) never beside it); no other lane of either design edits it (per-player round 5 dropped GM6c1b's hunk; every module, type and per-player code lives in its own file's `codes`, §3.2) |
| `client/scripts/story/mechanics/core.ts` (round 4) | GM1b (new) -> GM2b (the four `renamed` codes and lints) -> per-player GM6c1b (lifts `world/renamed-puzzles`, E-P13) |
| `client/src/cues/stage/motions.ts` (round 3 m1) | GM3m -> GM3 -> GM5 -> GM5f -> GM8i -> SH10 (reconcile r1: MR1 adds every key's `scene` motion and sets `ScenePending = never`) (control motions come from `UI_MOTIONS` and each `ControlDecl`, so no type or UI lane holds it) |
| `client/src/cues/stage/motions.test.ts` (reconcile r1, new row) | GM3m (I-7's `FRAME_OPEN_MS` case) -> GM3 -> GM5 -> GM5f -> GM8i -> SH10, with `motions.ts` |
| `client/src/cues/controls.test.ts` | GM3u -> GM3p |
| `client/src/cues/{types,bus,visible}.ts`, `cues/root.ts` | GM3m (the pure three), GM3s (`root.ts`); later lanes import them |
| `client/e2e/mechanics.spec.ts` (round 3 m1) | GM3s -> GM3u -> GM3p -> GM3b -> GM4u -> GM5 -> GM8d -> GM9r (round 4: GM8a / GM8b leave, GM8d holds every device e2e) |
| `client/e2e/helpers.ts` (round 4) | GM2a (body literals) -> GM8d (`worldOf(ch)`, `enterBeacon`); per-player GM6c4 / GM6d2 by launch, never beside |
| `client/e2e/stories.spec.ts` (round 5, W1) | none of this design: a byte-identical pin of GM8d's `e2e full`; the beacon section sits on option 1 of a new choice set, off its path |
| `story/ch3/world.json` (new), `story/ch3/main.ink`, `story/locales/en/ch3.json` (round 4) | GM8d only (verify per-player's locks at its cut); reconcile r1 (I-15): `story/ch3/main.ink` GM8d -> SH11 (the restaging, line IDs untouched), never beside |
| `assets/catalog.json` (round 4; round 5 m2) | GM3b (one prop `drawer_open`) -> GM8d (five placeholder props and the bg `fog_gallery`); reconcile r1: SH9 (loop props, ambient) by launch, never beside either (was: A(`assets/catalog.json`)) |
| `story/locales/en/ch1.json` (round 5, m2) | GM4u (the demo view's title and labels) -> GM9r (the carried item's texts) -> per-player GM6c4 -> GM6d2 (by launch, never beside), the order of `story/ch1/world.json`'s row; GM1d and GM3b add no ch1 text (`clues` are conditions, a visual state has no text) |
| `story/locales/en/ch2.json` (round 5, m2) | GM9r only (the required item's `name` / `desc` and the door's label) |
| `client/scripts/story.ts` (round 5, m6; per-player R-E23) | GM1d only if its cut's verify item (§3.2: a `Finding.code` reader in `story.ts` that needs the wider union) finds one, then GM9p (the cross-chapter pass); per-player GM6c1a, GM6c1b by launch, never beside GM9p (their mutual order is per-player.md's) (this row, not `lint.ts`, now keeps GM9p and GM6c1b apart); reconcile r1: SH2 never beside GM1d, GM2b, GM3c, GM9p, GM6c1a, GM6c1b. Changed by RULINGS 183 (as of `837b1ed`; docs lane `docs-errata-12`, group A): GM1d took no hunk here (its cut's verify item found no `Finding.code` reader that needs the wider union; merged `794181b` without `story.ts`), so the row starts at GM9p |
| `client/scripts/story/spike-p2.test.ts` (round 5, m6) | GM1b (new) -> GM5 -> GM5q (when it runs) -> GM5f |
| `client/src/mechanics/rules/search.ts` (round 4) | GM1a -> GM1b -> GM1d -> GM5q (when it runs) |
| `client/src/explore/reconcile.ts`, `explore.test.ts` (round 3 m1) | GM1a -> GM1b -> GM2a -> GM2b -> GM3 (test) -> GM5q (test, when it runs; round 5 m6) -> GM5f; per-player GM6c1b never beside |
| `client/scripts/story/build.test.ts` | GM1d -> GM2b -> GM3b -> GM4g -> GM8a -> GM8b; per-player GM6c1a, GM6c1b by launch, never beside (R-E19) -> SH12a (reconcile r1; was: "with A(`build.test.ts`) (rev. 3: MD1a) before GM2b") |
| `client/scripts/story/world.test.ts` | GM1d -> GM2b -> GM3c (round 6: the walk's tests) -> GM9p; per-player GM6c1b by launch, never beside (round 5, R-E23) |
| `client/scripts/story/world.ts` (round 6, W1; per-player R-E25) | GM1a -> GM1b -> GM1c -> GM2b -> GM3c (`WorldTextLine`, the walk over `MECHANIC_TEXTS`); no later lane of either design (module texts arrive through `MECHANIC_TEXTS`, per-player's text rules read the walk's lines in `values.ts`) |
| `client/scripts/story/mechanics/texts.ts` (round 6, new) | GM3c only (the types, `KERNEL_TEXT_ROLES`, `TEXTS_LINT`); later lanes import its types |
| `client/scripts/story/mechanics/clues.ts` (GM1d, new) | **Ruled: RULINGS 192** — GM1d (new) -> GM3c (commit (2b), `clues` widened to `Cond[]`) -> GM7p, one at a time (the GM7p row names GM1d; GM3c held it between them) |
| `client/scripts/story/puzzles/shape.ts` | GM1d -> GM7g |
| `client/src/mechanics/data/index.ts`, `rules/index.ts` | GM1b -> GM3c (data) -> GM3 -> GM3b -> GM4 -> GM5 -> GM5f -> GM8i -> GM9p (data) -> per-player GM6d2 (data) |
| `client/src/ui/state.svelte.ts` | GM3s (one field and the slot types); per-player GM6c3 by launch |
| `client/src/i18n/{ru,en}.ts` | none (round 4: this design's strings live in `i18n/mechanics.ts`; per-player's GM6c2 strings in `i18n/values.ts`, R-E19) |
| `client/src/i18n/mechanics.ts` (round 4, new) | GM3u (new, with its parity test) -> GM7r (`mech.content_updated`) |
| `client/scripts/budget.ts`, `budget.test.ts` | reconcile r1: M3c, LEL, LFL (merged) -> {SH3a (the `LIMITS.image` and DIMS Records), GM3s} by launch, never beside -> SH3b (the sheet helper, two budget codes) -> GM4g -> GM7p -> per-player GM6d2 -> SH12b (`knotRows`, by launch, never beside) (was: M3c (merged) -> A(`budget.ts`) (rev. 3: MD1b) / GM3s (by launch, never beside) -> GM4g -> GM7p -> per-player GM6d2 -> the MR2 role (DIMS rows)) |
| `client/src/world/{types,decode}.ts` | GM1c -> GM1d -> GM2b -> GM3c (composed decoder) -> per-player GM6c1a; after GM3c no module lane edits them |
| `client/scripts/story/emit.ts` | (reconcile r1: no SH lane holds it, §9.14; "A(`emit.ts`) (rev. 3: MD1a) ->" removed) GM2b (compact, the `renderHints` call site) -> GM3b -> GM4g -> GM4 -> per-player GM6c1a -> GM6c1b -> GM6d2 (round 1 listed GM1d, whose strip lives in `toPublic`, `world/decode.ts:660`, not in `emit.ts`). Changed by RULINGS 183 (as of `837b1ed`; docs lane `docs-errata-12`, group A): `toPublic` is `client/src/world/decode.ts:855` on `837b1ed` (`:640` on `9b4fd25`, `:687` on `794181b`); GM1d stripped `clues` there and edited no `emit.ts` line |
| `client/scripts/story/mechanics/index.ts` | every module lane in the world chain order (one `MECHANIC_LINTS` line each, and from GM3c on one `MECHANIC_TEXTS` line each, `null` for a module without texts, round 6 W1: GM3c `core: null` plus the `TEXTS_LINT` line of `MECHANIC_LINTS`, GM3 `use`, GM3b `visual`, GM4 `view`, GM5 `combine`, GM5f `flags`, GM8i `devices`, GM9p `carry`, per-player GM6d2 `labels`); per-player GM6c1a (R-E16, round 4: one line `VALUES_LINT`, after GM1d, then by launch, never beside a later holder: GM3c, GM3, GM3b, GM4, GM5, GM5f, GM8i, GM9p) -> per-player GM6c1b (round 5, R-E23: one line `KEY_LINT`, a `runsFrom: 'story'` entry, by launch, never beside a module lane) -> per-player GM6d2 |
| `client/scripts/story/graph.ts` (round 4) | reconcile r1: SH1 -> SH2 (`sections`) -> GM9p (`mustPass`) -> SH12a, never beside (was: A(`graph.ts`) (rev. 3: MD1a) -> GM9p (`mustPass`); rev. 3's MA1b by launch, never beside GM9p) |
| `client/src/scene/*` | none of this file's lanes (views use today's crossfade); reconcile r1: M3c, LHJ (merged) -> GM2a's field -> per-player GM6a -> SH1 (executor, `executor.test.ts`) -> SH4 -> SH5a -> SH5b -> SH6 -> SH7 -> SH8 -> {per-player GM6d1, SH9, SH10, SH12a, SH12b, the carried preload-priority lane} one at a time by launch (was: M3c (merged) -> GM2a's field -> per-player GM6a -> A(`scene/*`) (rev. 3: MD2 -> MA1a -> MA1b -> MA2) -> {per-player GM6d1, the MR1 -> MR2 roles}) |
| `client/src/scene/registry.ts`, `registry.test.ts` (reconcile r1, inside the `scene/*` row) | LHJ (merged) -> SH4 -> SH5a (the warm form) -> SH5b (preview, upgrade) -> SH6 -> the preload-priority lane if it launches |
| `client/src/scene/preload.ts`, `preload.test.ts`, `scene/controller.ts` (reconcile r1, inside the `scene/*` row) | LHJ (merged; `preload.ts`) -> SH5a -> SH5b -> the later `scene/*` holders whose locks name them, in the `scene/*` row's order (the preload-priority lane among them) |
| `client/src/scene/loader.ts` (reconcile r1) | SH5a -> SH5b |
| `client/src/scene/layout.ts`, `layout.test.ts` (reconcile r1) | SH12b (in the `scene/*` tail) |
| `client/src/scene/motion/*` (reconcile r1, new directory) | SH7 (creates it) -> SH8 -> SH9 -> SH10 (`index.ts` in each), strict, inside the `scene/*` row |
| `client/src/arch.test.ts` | GM1a -> GM1c -> GM3m -> GM3s -> GM3u -> GM7p -> GM7g -> GM8a -> GM8b; reconcile r1: LEL, LFL (merged) -> LRB (merged `3c62a86`; its cut took it: `metaStatsGaps`) -> L1 (`l1-entry-summary`, RULINGS 158; merged `eec24fe`, RULINGS 159) before GM1a; SH6 by launch, never beside any of them (was: A(`arch.test.ts`) (rev. 3: MD2 after GM1a) never beside any of them) |
| `story/ch1/world.json` | GM1d -> GM3b -> GM4u -> GM9r (with `story/ch2/world.json`, `story/items.json`) -> per-player GM6c4 -> GM6d2, one at a time; reconcile r1 (design-shots I-18): every holder's cut checks that `gate`'s `"closeup": null` (`story/ch1/world.json:43`) and its `onFail` `manor_gate_forced` (`:89`) still stand, or names the replacement room event; SH11 reads it, no SH lane edits it |
| `client/src/requests.test.ts` (round 13; reconcile r1 adds SH7; reconcile r2, R-E35) | GM3p (new) -> {per-player GM6c2 (E-P23; its `SITE_MEMBERS` row, E-P29), SH7 (its `scene/motion/` `import()` row; GM3p is always merged by then), every later lane that adds a start, a `HOST_WAITS` row or a `SITE_MEMBERS` row} by launch, never beside (§12 head; r1 let two holders with disjoint rows run beside each other, withdrawn) |
| `client/src/story/staging.ts` (reconcile r1) | GM2a (`PropPlacement.at`, `StagingSnapshot.cam`, I-1) -> SH1 (the `cam` command) -> SH12a |
| `client/src/story/tags.ts`, `tags.test.ts` (reconcile r1) | SH1 -> SH12a |
| `client/scripts/story/dsl-doc.test.ts` (reconcile r1) | SH1 -> SH12a -> SH12b (GM1d reads its 86-row pin, edits none). Changed by RULINGS 183 (as of `837b1ed`; docs lane `docs-errata-12`, group A): the file is `client/src/story/dsl-doc.test.ts` (the path the other plan sections cite, §3.2); no file exists under `client/scripts/story/` by that name |
| `docs/STAGING-DSL.md` (reconcile r1) | SH1 -> SH2 -> SH3b -> SH12a -> SH12b; the docs adoption lane (RULINGS 153) before or after them, never beside |
| `client/src/story/catalog.ts` (reconcile r1) | no planned holder; it is in the entry closure (`client/src/app/boot.ts:21`), so a lane that adds to it quotes the entry ledger (§11.1; §30 item 9) |
| `client/src/story/shots.ts` (reconcile r1, new) | SH3a only (SH5a imports `ShotWindow` / `stepWindow`, SH9 `shotImages`) |
| `client/scripts/story/shots/{flow,shots.test}.ts` (reconcile r1, new) | SH2 -> SH12a -> SH12b |
| `client/scripts/story/shots/usage.ts` (reconcile r1, new) | SH2 -> SH12b |
| `client/scripts/story/shots/lint.ts` (reconcile r1, new) | SH2 -> SH3b -> SH12b |
| `client/scripts/story/lint.test.ts` (reconcile r1) | SH12a only |
| `client/scripts/story/playthrough.ts` (reconcile r1) | GM1a -> GM3 if its cut takes it (§9.14); SH2 never beside either |
| `client/scripts/assets/manifest.ts` (reconcile r1) | M3s (merged) -> SH3a -> GM4g |
| `client/scripts/assets/{assets,shots}.ts`, `assets.test.ts` (reconcile r1) | M3s (merged) -> SH3a -> SH3c -> GM4g |
| `client/scripts/assets/placeholder.ts` / `encode.ts` (reconcile r1) | SH3a only / SH3c only |
| `client/e2e/shots.spec.ts` (reconcile r1, new) | SH4 -> SH5a -> SH5b -> SH6 -> SH10 -> SH11, strict |
| `client/e2e/animation.spec.ts` (reconcile r1, new) | SH7 -> SH8 -> SH9 |
| `client/e2e/memory.spec.ts` (reconcile r1) | M3s (merged) -> SH11 |
| `client/e2e/perf.spec.ts`, `client/e2e/build-skew.spec.ts` (reconcile r1) | LFL (merged; `perf.spec.ts`); LRB (merged `3c62a86`; `build-skew.spec.ts`); no GM, GM6 or SH lane |
| `client/src/app/window.test.ts` (reconcile r1, new) | SH5a only |
| `story/ch1/main.ink`, `story/ch2/main.ink` (reconcile r1; r2 adds ch2, SH11's lock [shots §9.12 SH11 `shot-content-manor`](../shots/09e-lanes-sh11-sh12b.md#912-sh11-shot-content-manor-content--e2e)) | SH11 only (no GM or GM6 lane edits them; GM9r holds `story/ch2/world.json` and the en tables, not the ink) |
| `story/shots.json` (reconcile r2, RC-W3; r1 read "SH11" in the row above) | SH2 (new, the narrative-designer commit, [shots §9.2 SH2 `shot-flow`](../shots/09a-lanes-sh1-sh2.md#92-sh2-shot-flow-client-story-tool)) -> SH4 ([shots §9.5 SH4 `shot-view`](../shots/09c-lanes-sh4-sh5b.md#95-sh4-shot-view-client-runtime)) -> SH6 ([shots §9.7 SH6 `shot-cuts`](../shots/09d-lanes-sh6-sh10.md#97-sh6-shot-cuts-client-runtime)) -> SH11 ([shots §9.12 SH11 `shot-content-manor`](../shots/09e-lanes-sh11-sh12b.md#912-sh11-shot-content-manor-content--e2e)), strict; no GM or GM6 lane |
| `story/ch4/main.ink` (reconcile r1) | SH4 -> SH6 -> SH8; no GM or GM6 lane |

- **The MR1 role** (round 4, RULINGS 132: whichever adopted lane builds the room half's scene motions, §8.7) starts
  after GM3b (state model fixed), GM3s (the stage, `move:leave`, the move cue at `started`), GM3m (the `waiting` /
  `waited` and `demo` keys), per-player GM6a (anchors) and the A(`scene/*`) lanes before it; it consumes §8.7 and
  touches no world schema. **Reconcile r1 (design-shots I-2, I-4):** MR1 is **SH10**; it starts after GM3b, GM3s,
  GM3m, per-player GM6a, GM8i (`motions.ts`), SH6, SH7 (the loop, the `sceneCues` seam it subscribes through) and SH8
  (the last strict `scene/*` holder before the tail); MR2 is **SH8 + SH9**.
- **Lane cap 3** (1 server + 2 client, disjoint locks) holds: every `Beside` pair in the order table is lock-disjoint
  (checked path by path in round 3: GM2a ∥ GM1c, GM3m ∥ GM1d / GM2b / GM3c / GM3w, GM3w ∥ GM1d / GM2b / GM3c, GM3c ∥
  GM3s, GM5f ∥ GM7r, GM8i ∥ GM7p / GM7g, GM9p ∥ GM8a / GM8b; round 4 re-checked against the new locks: GM3m's
  `mechanics/contract.ts` and `puzzles/rules/index.ts` are in none of GM1d / GM2b / GM3c / GM3w; GM3w's `yields.ts` is in
  none of GM1d / GM2b / GM3c; and the new pair GM9p ∥ GM8d shares no path, GM8d's six against GM9p's ten).
- **Lane count (round 4):** 29 lanes (+ GM8d) and the conditional GM5q; GM1c (16) and GM3 (16) are one over the soft
  file bound, each with its reason in its section; every other lane is <= 15 files and <= 10 commits (GM8h 9).
  **Round 5:** still 29 lanes and GM5q (no lane added, merged or split). Locks: GM3b 15 -> 16 (the catalog, m2; one
  over the soft bound with its reason), GM4u 7 -> 8, GM9r 12 -> 14, GM7r 9 -> 11, GM8h 10 -> 11 (10 commits); every
  other lock unchanged. Beside pairs re-checked against the new paths: GM5f ∥ GM7r (GM7r's `puzzles/play/reach.ts` and
  its test are in no GM5f path), GM9p ∥ GM8a / GM8b / GM8d (`assets/catalog.json` and the en tables are in none of
  GM9p's ten), GM2a ∥ GM1c (GM1c reads no `PuzzleRun.work`, m1).
  **Round 6:** still 29 lanes and GM5q. Locks: GM3c 9 -> 12 (`client/scripts/story/world.ts`, new
  `client/scripts/story/mechanics/texts.ts`, `client/scripts/story/world.test.ts`); every other lock unchanged (the
  `MECHANIC_TEXTS` lines sit in `client/scripts/story/mechanics/index.ts` and the walkers in each module's own lint
  file, both already held; GM8d's `story/ch3/main.ink` gains a knot, not a path). Beside pairs re-checked: GM3c ∥ GM3m /
  GM3w / GM3s (none holds `world.ts`, `texts.ts` or `world.test.ts`); GM9p ∥ GM8a / GM8b / GM8d unchanged.
  **Round 7:** still 29 lanes and GM5q. Locks: GM3c 12 -> 13 (`client/src/geom/cover.ts`); every other lock unchanged
  (GM3m 12, GM3s 14, GM3u 13, GM3p 11 with 9 commits, GM5 15, GM7r 11, GM8h 11 with 10 commits). Beside pairs
  re-checked: GM3c ∥ GM3m / GM3w / GM3s (`cover.ts` is in none of them); no other pair's paths moved.
  **Round 8:** still 29 lanes and GM5q. Locks: GM3w 9 -> 10 (`client/src/ui/puzzles/puzzle-host.svelte.test.ts`, the
  one other `PuzzleFrameView` literal); every other lock unchanged (GM3p 11 with 9 commits, GM8h 11 with 10, GM7r 11,
  GM3c 13, GM3s 14). Beside pairs re-checked: GM3w ∥ GM1d / GM2b / GM3c / GM3m (`puzzle-host.svelte.test.ts` is in
  none of their locks); the holder row of `puzzle-view.svelte.ts` / `PuzzleHost.svelte` / `puzzle-host.svelte.test.ts`
  keeps its order with GM3w first.
  **Round 9:** still 29 lanes and GM5q; every lock unchanged (GM3m 12, GM3s 14, GM3u 13, GM3p 11 with 9 commits, GM8h
  11 with 10, GM7r 11): RULINGS 135 (b)'s work sits in files those lanes already hold (GM3m: `cues/visible.ts`,
  `cues/stage/{motions,presets,player}.ts` and their tests; GM3s: `CueStage.svelte`, `cues/root.ts`,
  `stage.svelte.test.ts`, `ExploreView.svelte` for the sheet markers moved from GM3u; GM3u: `Ribbon.svelte`,
  `yields.ts`, `yields.test.ts`, `explore.svelte.test.ts`; GM3p: `PuzzleHost.svelte`, `yields.ts`, `yields.test.ts`,
  `puzzle-host.svelte.test.ts`; GM8h: `yields.ts`, `PuzzleHost.svelte`). New ordering facts: GM3p after GM3s for
  `CueStage.svelte` (already implied through GM3u -> GM3s) and after GM3w for `puzzle-host.svelte.test.ts` (already in
  the holder row). Beside pairs re-checked: GM3m ∥ GM1d / GM2b / GM3c / GM3w (`cues/stage/presets.ts` is GM3m's new
  file, in none of them); GM3c ∥ GM3s (`ExploreView.svelte` is in no GM3c path); no other pair's paths moved.
  **Round 10:** still 29 lanes and GM5q; every lock unchanged (GM3m 12, GM3s 14, GM3u 13, GM3p 11 with 9 commits, GM8h
  11 with 10, GM8i 11): the work sits in files those lanes already hold (GM3m: `cues/visible.ts`,
  `cues/stage/{motions,player}.ts`, `player.test.ts`, `motions.test.ts`; GM3s: `CueStage.svelte` (its resolver, the
  attribute and the ghost style), `stage.svelte.test.ts`, the e2e; GM3u: `Ribbon.svelte`, `ExploreView.svelte`,
  `controls.test.ts`, `explore.svelte.test.ts`; GM3p: `yields.ts`, `yields.test.ts`, the e2e; GM8h:
  `PuzzleHost.svelte`, `puzzle-host.svelte.test.ts`, `yields.test.ts`; GM8i: `mechanics/rules/devices.ts`,
  `mechanics/devices.test.ts`). No new ordering fact. **Lanes in flight on main (RULINGS 137, 139):** LEL holds
  `client/src/app/boot.ts`, new `client/src/api/meta.ts`, `client/src/arch.test.ts` (two closure guards),
  `client/src/app/game.test.ts` (one import hunk) and, only if its probe needs it, `client/scripts/budget.ts` /
  `budget.test.ts`; LBI holds `boot.ts`, `game.test.ts` (shared with LEL, `RULINGS.md:2965-2967`), the http module
  and server files. GM3m and GM3s (`arch.test.ts`), GM3w (`game.test.ts`) and GM3s (`budget.ts`, `budget.test.ts`)
  start after LEL and LBI merge, never beside them, and re-locate its
  lines at their cuts; no GM lane holds `boot.ts`. LEL's measured entry drop (a STOP under 1.0 KB br,
  `RULINGS.md:2971`) widens the entry row this design plans at 39.80 / 40.0; its first-line row is unchanged by that
  split (`RULINGS.md:2972-2975`), so §11's 262.86 stands (round 11: 262.91, re-read below).
  **Round 11:** still 29 lanes and GM5q; every lock unchanged (GM3m 12, GM3s 14, GM3u 13, GM3p 11 with 9 commits, GM8h
  11 with 10): the work sits in files those lanes already hold (GM3m: `cues/stage/motions.ts` for `until`,
  `CHECKING_ENDS` and the `inventory` target, `cues/stage/player.ts` for the loop, the box rule, the edge skip and the
  DOM-branch count's seam, and their tests; GM3s: `CueStage.svelte` for `centre`, the `inventory` landing and the
  played-key panel suffix, `yields.ts` / `yields.test.ts` for the explore-import hold and `prefetch()`,
  `stage.svelte.test.ts`; GM3u: `ExploreView.svelte` for the conditional marker and the Inventory button's
  `data-cue="bar-inventory"` (`ExploreView.svelte:63`), `explore.svelte.test.ts`; GM3p: `yields.ts`, `yields.test.ts`
  and the e2e for `holdLoad`, the close-up's hold, the drop order and the class guard; GM8h: `yields.test.ts` for
  the view steps). No new ordering fact among GM lanes. **The tree moved during this round** (found at its end):
  `.git/refs/heads/main` reads `a9f28e3da456d3d4e7d6e73075733dde3f61e819`, LEL merged at `7b37278` (RULINGS 141,
  `RULINGS.md:2995-3002`) with the files `client/src/api/{meta,decode,endpoints}.ts`, `client/src/app/{boot,meta}.ts`,
  `client/src/meta/{card,social,wallet}.ts`, their tests, `client/src/app/game.test.ts` and `client/src/arch.test.ts`
  (`lel-entry-lever/impl.md:146-157`), none a file this round cites, so every citation stands; the GM rule "after LEL
  and LBI merge" now waits on LBI only, and the next `arch.test.ts` holder (GM1a, first in its row) takes LEL's review
  carry M1 (`RULINGS.md:3001-3002`). LHJ is in flight (RULINGS 144) on
  `client/src/scene/{preload,preload.test,registry,registry.test}.ts`: no GM lane holds them, and the `scene/*` holder
  row above gains LHJ before GM2a's field; this file's `registry.ts` citations (the caps and the admission lines) are
  re-located at the first cut after LHJ merges. LFL, the first-line lever lane (RULINGS 142,
  `RULINGS.md:3008-3014`), starts after LBI and holds `client/src/app/{boot,game}.ts`: no GM lane holds `boot.ts`, and
  `game.ts`'s holder row above (GM2a -> GM3w -> ...) gains LFL first, so GM2a and GM3w start after LFL merges, never
  beside it, and re-locate its lines at their cuts; its measured gain is the first-line row's only planned relief.
  **Round 12:** still 29 lanes and GM5q; every lock unchanged (GM3w 10 with 5 commits, GM3s 14, GM3m 12, GM3p 11 with
  9 commits, GM3b 16 with 4): the work sits in files those lanes already hold (GM3w: `game.ts`, `yields.ts`,
  `game.test.ts` for `ahead`; GM3s: `yields.ts`, `yields.test.ts` for `held`, its pin and `ahead`'s body; GM3m:
  `cues/stage/{motions,player}.ts` and `player.test.ts` for the loop's cancel; GM3p: `yields.ts` for the reorder,
  `yields.test.ts` for the await map, which reads `puzzles/{session,registry}.ts` without editing them, so neither
  file's holder row changes; GM3b: `controller.ts`, `controller.test.ts`, `mechanics/rules/visual.ts`, `yields.ts`,
  `yields.test.ts`, the e2e). New ordering facts: none (GM3w before GM3s, GM3s before GM3p, GM3p before GM3b already
  hold). The tree is `a9f28e3` as at round 11's end; LHJ (RULINGS 144) is still the only lane in flight on a file this
  design cites (`client/src/scene/registry.ts`, whose admission lines `:336-343` the state preload relies on: re-located
  at GM3b's cut). For `design-reconcile` (RULINGS 143, no new volume in this cycle): the new preload holder family
  `state:*` sits beside `room:*`, so design-shots' I-14 / QO16 eviction of `room:*` by a window item extends to it.
  **Round 13:** still 29 lanes and GM5q; one lock grows, GM3p 11 -> 12 (the new `client/src/requests.test.ts`, the
  request walk; it reads every file of `client/src` and edits none, so no holder row of another file changes); every
  other lock is unchanged: GM3s (14: `held`'s `'no-load'` in `yields.ts`, its case in `yields.test.ts`), GM3b (16:
  `stateHold`, the keep-set release and the close-up's two branches in `controller.ts`, their tests in
  `controller.test.ts` and `yields.test.ts`), GM4 (12: the zoom round trip in `controller.test.ts`). **New file row:**
  `client/src/requests.test.ts` GM3p -> every later lane that adds a request start with no row (§12 head's round-13
  rule) -> per-player GM6c2 (`getValues`, `restartPuzzle`, E-P23). **New ordering facts:** none for the lanes of this
  file (GM3s before GM3p before GM3b before GM4 hold); a lane of another design that adds an `import()` or a request
  (a shot runtime chunk, a meta lane) after GM3p holds `requests.test.ts` for its row, beside another holder only for
  disjoint rows, the second to merge syncing main and keeping both (§12 head).
  **Round 14:** still 29 lanes and GM5q; every lock unchanged: GM3s (14: the revive clause and `'stats'` in
  `yields.ts`, its case and the fake scene's `stats` in `yields.test.ts`), GM3p (12: the walk's round-14 checks and
  rows in `requests.test.ts`, the pin's deletion in `yields.test.ts`, both held), GM3b (16: the request at every
  `roomShown` in `controller.ts`, its test in `controller.test.ts`). New file rows and ordering facts: none (GM3s before
  GM3p before GM3b hold, and the pin's hand-over from GM3s to GM3p follows that order). Still in flight on `fe996a0`
  (RULINGS 149): LHJ on `scene/{preload,registry}.ts` (m2's re-request relies on `preload.ts:120-122` and
  `registry.ts:476-480`, re-read at GM3b's cut), M3s, LFL.
  **In flight on `fe996a0`** (RULINGS 146, 147): LHJ on `client/src/scene/{preload,registry}.ts` (GM3b's counting fake
  re-reads the holder rule at its cut), M3s on the server (no file here), LFL on `client/src/app/{boot,game}.ts` (its
  merge moves rows of the request table in `boot.ts`; GM3p's cut writes the rows from its own red-first output, so
  nothing in this design waits on LFL beyond the existing GM2a / GM3w order). The tree is `fe996a0` (LBI merged,
  RULINGS 145).
  **Reconcile r1:** still 29 lanes and GM5q; no GM lane added, merged or split, and every GM lock unchanged (the
  reconcile work sits in files those lanes already hold: GM2a `staging.ts`, `save-codec.ts` and their tests; GM3m
  `cues/types.ts`, `cues/visible.ts`, `motions.test.ts`; GM3w `game.test.ts`; GM3s `yields.ts`, `yields.test.ts`;
  GM3p `requests.test.ts`; GM3b `yields.ts`, `yields.test.ts`; GM4g `budget.ts`, `budget.test.ts`). The SH lanes keep
  `design-shots`' own locks and commit counts (its §9); this file adds SH7's `requests.test.ts` row (§30 item 11).
  **Merged on main since round 14:** LHJ `972f773`, M3s `a5f887b`, LFL `cec347c`; the rows above show them merged,
  and the rule "GM2a and GM3w start after LFL merges" is met. **LRB** (RULINGS 156), merged as `3c62a86` (RULINGS 157), whose envelope
  (`game.ts`, `game.test.ts`, `meta.ts`, `meta.test.ts`, `boot.ts`, maybe `arch.test.ts`, `build-skew.spec.ts`)
  made it the holder of `game.ts` / `game.test.ts` before GM2a and, its cut having taken `arch.test.ts`, before GM1a
  there; L1 (RULINGS 158; merged `eec24fe`, RULINGS 159) comes after it on `game.ts`, `boot.ts` and `arch.test.ts`; no GM, GM6 or SH lane starts on those files beside it. **Beside pairs re-checked** against the SH locks:
  GM2a ∥ GM1c unchanged (no SH lane runs before SH1, which follows GM2a); GM3c ∥ GM3s (neither holds an SH file); SH9 ∥
  engine lanes off `scene/*`, `motions.ts`, `catalog.json`, and SH10 ∥ engine lanes off `scene/*`, `motions.ts`, as
  §9.14 states; every other GM `Beside` pair is unchanged. Lane cap 3 holds.
  **Reconcile r2:** still 29 lanes and GM5q; no lane added, merged or split; every GM lock unchanged (the r2 work sits
  in files those lanes hold: GM3p `yields.ts`, `yields.test.ts`, `requests.test.ts`; GM3b `yields.ts`,
  `yields.test.ts`; GM8h `yields.ts`, `yields.test.ts`; GM3w's tightened entry bound is a gate, not a file). The SH
  table's four new edges (RC-W3) change no `Beside` pair (SH3b ∥ SH3c and SH3b ∥ SH4 still share no path; SH4 now
  also follows SH2 through SH3a), and the new `story/shots.json` row holds SH lanes only. Main read `cec347c` then
  (`.git/refs/heads/main`); the adoption reads `3c62a86` (LRB merged, RULINGS 157).
