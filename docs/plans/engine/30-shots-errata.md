## 30. Shots errata from reconcile

For the docs lane (RULINGS 153: it adopts the three designs as plan files). `design/shots/proposal.md` is not edited
here; each item names the proposal's text as read (rev. 7) and what this revision's answers make it read. Every item is
engineering; none narrows motion.

**Adopted 2026-11-09 (docs-adopt):** every item below and the R-S1-R-S3 of [per-player §12.1 Requests from this file](../per-player/12-interface-requests.md#121-requests-from-this-file-status-after-enginemd-round-9-as-read-2026-11-03-reconcile-revision-1-round-14-as-read-2026-11-09-reconcile-revision-2-enginemds-reconcile-revision-1-as-read-2026-11-09-reconcile-revision-3-enginemds-reconcile-revision-2-as-read-2026-11-09) are applied to the [shots plan](../shots/README.md) at the places they name; this section is the record of what that plan absorbed.

1. **I-1, the camera state in saves** ([shots §11 Interface requests to engine.md](../shots/11-interface-requests.md#11-interface-requests-to-enginemd-and-through-the-orchestrator-to-per-playermd); §3.2): GM2a declares `CamTarget` / `CamState` in
   `client/src/story/staging.ts` and reads `StagingSnapshot.cam?` as an optional key (engine §5.2), so SH1 imports the
   types and writes `cam`; SH1's STOP item ("without it SH1 keeps `cam` out of the snapshot") is met once GM2a merges.
   Engine +0.03 is GM2a's (engine §3.5), not SH1's.
2. **I-2 / §9.14, `budget.ts`** ([shots §9.14 Order and conflicts](../shots/09f-order-and-conflicts.md#914-order-and-conflicts-superseded-by-engine-12)): "SH3a ... -> {SH3b, GM3s} by launch, never beside -> GM4g"
   reads "LFL (merged) -> {SH3a, GM3s} by launch, never beside -> SH3b -> GM4g -> GM7p -> GM6d2 -> SH12b"; the same for
   `budget.test.ts`. Reason: engine §12's one-order paragraph. Reconcile r2 (RC-m3 (a)): the same change in SH3a's
   Order ([shots §9.3 SH3a `shot-assets`](../shots/09b-lanes-sh3a-sh3b.md#93-sh3a-shot-assets-client-asset-tool-the-contract-placeholders-tiers-scan-dist): "SH3a (the Records) -> {SH3b, GM3s} by launch" reads "{SH3a, GM3s} by launch, never
   beside, then SH3b") and SH3b's Order ([shots §9.4 SH3b `shot-budget`](../shots/09b-lanes-sh3a-sh3b.md#94-sh3b-shot-budget-client-budget): "SH3a (the Records, rev. 4) -> {SH3b, GM3s} by launch, never
   beside, then GM4g -> GM7p -> GM6d2" reads "{SH3a, GM3s} by launch, never beside -> SH3b -> GM4g -> GM7p -> GM6d2 ->
   SH12b").
3. **I-4, the scene role's subscription:** SH7 implements `YieldsHost.sceneCues` in `yieldsHost` (`game.ts`, already
   in its lock) and hands the `subscribe` it receives to the scene role; SH10 subscribes `'scene'` through it. The seam
   is GM3s's (engine §8.6); SH7 runs after GM3s.
4. **I-6, the question back:** answered "no": a tap during a batch completes it and runs no intent (D7,
   `client/src/app/game.ts:1402-1408` on `acc4e0d`), so SH10 pushes into `via` with no hotspot mapping during the
   batch (engine §14.4, GM3w's pin).
5. **I-7, covered timing** ([shots §11 Interface requests to engine.md](../shots/11-interface-requests.md#11-interface-requests-to-enginemd-and-through-the-orchestrator-to-per-playermd); SH7 [shots §9.8 SH7 `shot-idle`](../shots/09d-lanes-sh6-sh10.md#98-sh7-shot-idle-client-runtime), [shots §9.8 SH7 `shot-idle`](../shots/09d-lanes-sh6-sh10.md#98-sh7-shot-idle-client-runtime); characters.md R12): ~~SH7 sets
   `setCovered(true)` `FRAME_OPEN_MS` (300, `cues/types.ts`, GM3m) after an opaque frame shows, and `setCovered(false)`
   when its clear starts `frameOut`; SH7's test asserts both edges (the ambient source draws through the entrance and
   from the clear on), red on a cover at the frame write.~~ (reconcile r2, RC-W5) SH7 implements GM3p's
   `YieldsHost.frameShown?(f: ShownFrame | null)` in `yieldsHost` (`game.ts`, in its lock) with one function
   `panelCover(f)` and one pending timer on GameSession's `clock`: every call first clears the timer; `null` calls
   `scene.setCovered('panel', false)` at once; a frame arms `setCovered('panel', true)` `FRAME_OPEN_MS` (300,
   `cues/types.ts`, GM3m) later; `dispose` clears the timer before the yields and the scene go. `present()` no longer
   sets the panel cover (CH R12's wiring fired at a puzzle yield's step, before the frame's chunks loaded, and never
   for an explore-mode frame). SH7's commit 5 `game: a puzzle yield covers the stage` reads `game: an opaque frame
   covers the stage once its entrance ends` (a fake clock: no cover at `{ id }`, covered at +300, uncovered at
   `null`; red on a cover at the frame write), plus `game: a frame cleared inside its entrance never covers` (`{ id }`
   at 0, `null` at 150: no `setCovered(true)`, 0 pending timers; also A `null` at 100 and B `{ id }` at 150: covered
   first at 450) with **M-SH7f** (`panelCover`'s clear removed: red, covered at 300 and 1 pending timer) and `game: a
   disposed session leaves no pending cover` with **M-SH7g** (`dispose` leaves the timer: red, 1 pending timer); a
   §10 row of the shots design (or its docs) names the timer: owner GameSession, created by `frameShown({ id })`,
   destroyed by its firing, the next `frameShown` call or `dispose`. SH7's lock is unchanged.
6. **I-11, ~~`propsFor`~~ `roomFor`** ([shots §11 Interface requests to engine.md](../shots/11-interface-requests.md#11-interface-requests-to-enginemd-and-through-the-orchestrator-to-per-playermd), [shots §5.8 Preload policy for cuts](../shots/05b-preload-memory-download.md#58-preload-policy-for-cuts-sh5a-windows-sh5b-entry), SH5a [shots §9.6 SH5a `shot-preload`](../shots/09c-lanes-sh4-sh5b.md#96-sh5a-shot-preload-client-runtime-windows-warm-rooms); reconcile r2, RC-W2: per-player
   R-E32 adopted, and per-player's §14 Q19 asks the same): the method is `Yields.roomFor(bg: BgId): readonly
   VisualCommand[] | null`, the room's state commands (GM3b's `props`, then per-player GM6d2's `labels` with its `bg`),
   not `propsFor(bg): readonly PropPlacement[] | null`; SH5a's `withRoomProps(batch, roomFor)` appends the list
   verbatim instead of building `{ kind: 'props', props: propsFor(bg) }`; SH5a's STOP ("if GM3b has not merged")
   names `roomFor`. Kept from r1: the tie rule (the current room first when its bg is `bg`, else the first such room
   in the section's declaration order; null with no section open) and the bytes (+0.03, ~7 lines, not +0.02).
7. **The first-line and all-JS ledgers** ([shots §10 Budgets and validation](../shots/10-budgets-and-validation.md#10-budgets-and-validation-summary), the I-13 rule, its all-JS line 295.85 / 305.0):
   superseded by engine §11.1 (exact MEASURED bases, LFL merged; reconcile r2: first line **265.48 / 270.0**, entry
   **39.46 / 40.0**, all JS **301.63 / 305.0**, engine closure 226.02 / 230.0, EN at +1.71 and PPL at its own +3.11,
   not +1.53 / +3.00; r1 read 265.34, 39.45, 300.99, 225.89); every SH lane quotes §11.1's rows at its cut. The
   "engine row ... ~225.2 / 230.0" ([shots §10 Budgets and validation](../shots/10-budgets-and-validation.md#10-budgets-and-validation-summary)) reads 226.02.
   **Adoption (main `3c62a86`, docs-adopt):** §11.1 re-based on the measured bytes: first line 265.58 / 270.0, entry 39.50 / 40.0 (0.502 left), all JS 301.84 / 305.0 (re-set by GM7p, RULINGS 158), engine closure 226.08 / 230.0.
8. **I-14** ([shots §11 Interface requests to engine.md](../shots/11-interface-requests.md#11-interface-requests-to-enginemd-and-through-the-orchestrator-to-per-playermd)): "`room:<r>` holders" reads "`room:<r>` and `state:<r>` holders" (EN's state preload
   follows `room:*`'s keep set, RULINGS 148 W2); EN's next `roomShown` re-requests both.
9. **SH3a's decoders stay out of the entry:** `client/src/story/catalog.ts` is in the entry closure (`boot.ts:21`
   value-imports its decoders), so `story/shots.ts` is imported by neither `catalog.ts` nor `boot.ts`; SH3a's cut quotes
   the entry ledger and an entry delta above +0.15 KB br (its 0.10 + 0.05) is a STOP item there (the entry's 0.548
   headroom would otherwise cross L1 / L2's line or the LIMIT; engine §15 item 15). Reconcile r2 (RC-m6): the margin
   is 0.038 (§11.1 Ledger 2), so a measured SH3a entry delta above ~0.138 crosses the line: it merges if under 40.0,
   and L1 then lands before the next entry-adding lane (engine §15 item 15); the +0.15 STOP stays SH3a's own bound.
10. **§9.14 as a whole** is superseded by engine §12 "Order and conflicts" (the one order across the three designs);
    §9.14 stays as the record of the shots' proposal. Its "Running lanes" paragraph (LBI, LEL) reads: LEL, LBI, LHJ,
    M3s, LFL merged; LRB merged (`3c62a86`, RULINGS 157) on `game.ts` / `game.test.ts` / `meta.ts` / `boot.ts` (RULINGS 156).
11. **SH7 and the request walk:** ~~if GM3p has merged before SH7's cut~~ (reconcile r2: GM3p has always merged by
    then, since SH5a needs GM3b, which follows GM3p), SH7's `import()` of `scene/motion/` is an
    unlisted start in `client/src/requests.test.ts`; SH7 holds that file for its one row (and its `WAIT_CASES` case if
    a view waits on it), lock 12 -> 13 (engine §12 `requests.test.ts` row, by launch, never beside).
12. **LFL's contract in `present`:** SH1, SH5a, SH5b and SH7 edit `game.ts`'s `present` / `stage`; they keep
    `meta?.stepShown()` after the step's view is set (`game.ts:776` on `cec347c`), pinned by LFL's `game: a presented
    step tells the meta port` (`client/src/app/game.test.ts:3218` on `cec347c`) and its e2e G2; the meta controller
    chunk (5,109 B) shares the link after the first step: ~20 ms at 2 Mbit/s (ARITHMETIC 5,109 x 8 / 2,000,000 =
    0.020 s). Reconcile r2 (RC-m3 (c)): LFL's second call binds SH5b too: `meta?.stepShown()` at D11's paywall
    (`game.ts:982` on `cec347c`, the session's first screen when a continue lands on a pending paid start), pinned by
    `game: a continue into a pending paid start asks for the meta chunk at its paywall` (`game.test.ts:3237`); a lane
    that edits the entry path keeps both calls.
13. **MR1's bytes:** engine §3.5's "MR1 adds its scene mapping (~1.0 estimate) to explore-ui" is the shots' own
    `scene/motion/` "scene-motions 1.0" ([shots §10 Budgets and validation](../shots/10-budgets-and-validation.md#10-budgets-and-validation-summary)), not explore-ui bytes; no double count. Reconcile r2
    (RC-m3 (b), RC-m5): SH10's Gates ([shots §9.11 SH10 `scene-cues`](../shots/09d-lanes-sh6-sh10.md#911-sh10-scene-cues-client-the-mr1-role)) "build (explore-ui row: EN estimates +1.0 KB,
    [§3.5 The arch rule and the byte ledger](03-module-contract.md#35-the-arch-rule-and-the-byte-ledger-r1))" reads "build (the `scene-motion chunk (br)` row, its scene-motions ~1.0, and the `cue-stage chunk
    (br)` row, +0.5 CLAIM for every key's and control default's `SceneMotionId` in `cues/stage/motions.ts`, engine
    §11.1)"; §10's JS table gains the line "SH10 `scene` ids | 0.5 | cue-stage chunk".
14. **All JS:** the third of EN's new puzzle-type chunks crosses 305.0 on §11.1's projection; engine §15 item 16 asks
    the orchestrator for the ruling; SH lanes quote the row.
    **Ruled: RULINGS 158** — `allJsBr` is re-set once, by GM7p (the `budget.ts` holder before GM7g in the one order), to GM7p's measured HEAD + the remaining planned puzzle-type chunks (GM7g, GM8a, GM8b at 1.6 KB br each, the measured `puzzle-type` chunk) + 5.0 KB br, rounded up to a whole KB; GM7p's cut quotes the arithmetic and the orchestrator confirms it in a RULINGS line at that cut; no other lane raises it (the row bounds no download).
15. **I-4 / I-9, targets:** ~~`SceneTargets` members resolve to their anchor's `motion` node, so SH10's tweens write
    only `motion` nodes (never `anchor`, the executor's, or `depth`, SH8's).~~ (reconcile r2, RC-m2) `prop(AnchorKey)`,
    `bg` and `closeup` resolve to their anchor's `motion` node, so SH10's tweens there write only `motion` nodes (never
    `anchor`, the executor's, or `depth`, SH8's); SH10's cut verifies the bg and close-up roots carry the four-node
    nesting I-9 rev. 2 gives the bg anchor "likewise" (the display tree, [shots §5.1 Shot view](../shots/05a-runtime.md#51-shot-view-sh4-clientsrcsceneshot-viewts-pure), draws it for prop
    anchors only), and adds it in `executor.ts` (its lock) if SH4 did not. `world` (the camera node, [shots §5.1 Shot view](../shots/05a-runtime.md#51-shot-view-sh4-clientsrcsceneshot-viewts-pure)) and
    `face(CharId)` (the head node, [shots §5.1 Shot view](../shots/05a-runtime.md#51-shot-view-sh4-clientsrcsceneshot-viewts-pure)) have per-frame writers and no `motion` node: a `world` cue motion is a term
    of the camera composition (the camera-move term, through the executor's camera state), a `face` cue motion a term
    of the head's composition or a layer change, never a tween on the node. SH10's red-first adds `executor: a world and
    a face cue motion survive their per-frame writers` (one drawn frame at a motion's midpoint: the composed transform
    differs from rest) with **M-SH10b** (the motion written as a tween on the node: red, the transform reads rest).
16. **I-17:** not applicable (RULINGS 154: OQ18's default, no characters in explore rooms); the proposal's row stays as
    the record.
17. **The one order (RC-W3):** the SH sections' Order bullets already state the four edges engine §12's r1 table
    lacked (SH3a after SH2, [shots §9.3 SH3a `shot-assets`](../shots/09b-lanes-sh3a-sh3b.md#93-sh3a-shot-assets-client-asset-tool-the-contract-placeholders-tiers-scan-dist); SH7 after SH3b, [shots §9.8 SH7 `shot-idle`](../shots/09d-lanes-sh6-sh10.md#98-sh7-shot-idle-client-runtime); SH11 after SH9, [shots §9.12 SH11 `shot-content-manor`](../shots/09e-lanes-sh11-sh12b.md#912-sh11-shot-content-manor-content--e2e); SH12a after SH11, [shots §9.13 SH12a `sprites-out`](../shots/09e-lanes-sh11-sh12b.md#913-sh12a-sprites-out-client-the-kinds-atomic-rev-4-split-w6)); the
    proposal needs no edit for them. §9.14's `story/shots.json` line ([shots §9.14 Order and conflicts](../shots/09f-order-and-conflicts.md#914-order-and-conflicts-superseded-by-engine-12), "SH11") reads "SH2 -> SH4 -> SH6 ->
    SH11, strict", as the four locks hold it ([shots §9.2 SH2 `shot-flow`](../shots/09a-lanes-sh1-sh2.md#92-sh2-shot-flow-client-story-tool), [shots §9.5 SH4 `shot-view`](../shots/09c-lanes-sh4-sh5b.md#95-sh4-shot-view-client-runtime), [shots §9.7 SH6 `shot-cuts`](../shots/09d-lanes-sh6-sh10.md#97-sh6-shot-cuts-client-runtime), [shots §9.12 SH11 `shot-content-manor`](../shots/09e-lanes-sh11-sh12b.md#912-sh11-shot-content-manor-content--e2e)).
18. **Per-player's requests to the shots design (RC-m7)**, listed here so the docs lane has one errata list;
    per-player owns their text and status (`per-player.md` §12.1): **R-S1** ([per-player §12.1 Requests from this file](../per-player/12-interface-requests.md#121-requests-from-this-file-status-after-enginemd-round-9-as-read-2026-11-03-reconcile-revision-1-round-14-as-read-2026-11-09-reconcile-revision-2-enginemds-reconcile-revision-1-as-read-2026-11-09-reconcile-revision-3-enginemds-reconcile-revision-2-as-read-2026-11-09)): SH8's drive steps a
    depth list the executor holds, one entry per `depth` node with its rect centre, to which GM6d1 adds one entry per
    bg label view; **R-S2** ([per-player §12.1 Requests from this file](../per-player/12-interface-requests.md#121-requests-from-this-file-status-after-enginemd-round-9-as-read-2026-11-03-reconcile-revision-1-round-14-as-read-2026-11-09-reconcile-revision-2-enginemds-reconcile-revision-1-as-read-2026-11-09-reconcile-revision-3-enginemds-reconcile-revision-2-as-read-2026-11-09)): SH12b's `client/scripts/story/shots/lint.ts` gains the E rule
    `shot/plane-over-label` beside `shot/plane-over-hotspot` ([shots §3.3 Lints](../shots/03-story-dsl.md#33-lints)). **R-S3** ([per-player §12.1 R-S3](../per-player/12-interface-requests.md#121-requests-from-this-file-status-after-enginemd-round-9-as-read-2026-11-03-reconcile-revision-1-round-14-as-read-2026-11-09-reconcile-revision-2-enginemds-reconcile-revision-1-as-read-2026-11-09-reconcile-revision-3-enginemds-reconcile-revision-2-as-read-2026-11-09)): SH1, SH5a, SH5b and SH7, which rework `present()` / `stage()`, keep a story step's visual batch applied (`scene.apply`, the snapshot move) inside the step's intent, the `withRoomProps` cut back included (`game.ts:723`, `:744`, `:789` on `3c62a86`); detector: per-player GM6d1's `game: a tap while a step's batch loads completes it and starts no step` (M-PR3c), which lands after SH7; per-player owns the text and status ([per-player §12.1 R-S3](../per-player/12-interface-requests.md#121-requests-from-this-file-status-after-enginemd-round-9-as-read-2026-11-03-reconcile-revision-1-round-14-as-read-2026-11-09-reconcile-revision-2-enginemds-reconcile-revision-1-as-read-2026-11-09-reconcile-revision-3-enginemds-reconcile-revision-2-as-read-2026-11-09)). Per-player's §14 Q19 (SH5a names
    `roomFor`) is item 6 here. None touches an engine contract.
19. **SH5a's figure (RC-O1):** SH5a's +1.3 (`proposal.md` §10 JS table, rev. 7's 0.1 at [shots §10 Budgets and validation](../shots/10-budgets-and-validation.md#10-budgets-and-validation-summary)) includes the
    synchronous joins and `registry.state` that LHJ landed (`preload.ts:163-172`, `registry.ts:523-527`), so up to 0.1
    is already in the MEASURED base; engine §11.1 keeps the figure (the safe direction), and SH5a's cut quotes its
    measured delta against the base.
20. **SH7's predecessors (RC-W3, RC-W5):** SH7's Order ([shots §9.8 SH7 `shot-idle`](../shots/09d-lanes-sh6-sh10.md#98-sh7-shot-idle-client-runtime)) reads "After SH6, SH3b, GM3s (the `sceneCues`
    seam), GM3m (`FRAME_OPEN_MS`) and GM3p (the frame edge `frameShown`; merged before SH5a's GM3b in any case)".
