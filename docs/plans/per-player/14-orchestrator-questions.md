## 14. Questions for the orchestrator (engineering, each with a recommendation)

1. **GM6a's slot.** It is a new lane in the `scene/*` chain, after M3c and engine.md's GM2a (E-P1's `at`), **before**
   the first animation or shot lane on `scene/*` (MD2 in `characters.md` rev. 3; r3 W2), never beside one.
   Recommendation: launch it right after GM2a merges, and forward §12 R-A1-R-A6, R-A9 and R-A10 to `design-shots`
   (RULINGS 132) before its first scene lane is cut. **Reconcile P2:** the shots design answered them (I-4, I-8, I-9;
   §12.1 statuses); GM6a goes before SH1 (so before SH4) and builds `AnchorRef` (`anchor > depth > motion > content`).
   **Ruled: RULINGS 172** — GM6a after GM2a, as the one order states ([engine §12 Order and conflicts](../engine/12f-order-and-conflicts.md#order-and-conflicts)).
2. **Story commits inside GM6c4 and GM6d2** (ch1 drawer mark, clue and hints; the view label) by the
   `narrative-designer` role, so the e2e exercises real content; GM6c4's story edit and its e2e-helper edit share one
   commit, so `e2e full` is never red at a commit boundary. Recommendation: yes, with the light story workflow (one
   writer pass, one mechanical verifier); OQ1 / OQ7 defaults until the owner answers.
   **Ruled: RULINGS 172** — accepted (the light story workflow); OQ1 / OQ7 defaults until the owner answers OPEN-QUESTIONS Q58.
3. **server-dev for GM6c4 / GM6d2 e2e:** the prebuilt `bin/server-dev-*.exe` must be built from GM6s2's merge or later
   (values routes, format 2). Recommendation: build it at the GM6s2 merge, as for LPO / LPH; GM6k's own e2e uses a
   `server-dev` built from the lane.
   **Ruled: RULINGS 172** — the values-route `server-dev` is built at GM6s2's merge.
4. **Lane count and sizes:** twelve lanes (round 1: seven; round 2: eleven): GM6s split into GM6s1 (9 files) and
   GM6s2 (16 files, one contract unit: the byte pins tie `dto.rs` to the four client api files, W3); GM6c1 into GM6c1a /
   GM6c1b (13 in round 5: `lint.ts` out, `mechanics/{core,index}.ts` and `world.test.ts` in); GM6c2 into GM6c2 / GM6c3 /
   GM6c4 (store, ink text, world text: three subsystems, each <= 14 files; GM6c4 14 in round 5); GM6k at 15 (W1); GM6t
   new (5); GM6d2 15 in round 6 (`mechanics/texts.ts`, r5 W1), **14 in round 7** (`MECHANIC_TEXTS` lives in
   `mechanics/index.ts`, E-P16 (a)). Recommendation: accept; GM6s2's 16th file is its new `endpoints.test.ts`.
   **Ruled: RULINGS 172** — accepted (the lane count and sizes).
5. **`app/game.ts` chain:** GM2a -> GM3w -> MD2 -> MA1a -> MA1b -> GM6c2 -> GM6c3 -> GM6d1 -> GM9r, one at a time
   (`characters.md` §11.7; engine.md §12 to adopt it, R-E19). Recommendation: hold it in that order with the
   animation names replaced by `design-shots`' once ruled (RULINGS 132); the next lane syncs main first.
   **Reconcile P2:** the adopted row is `GM2a -> GM3w -> SH1 -> SH5a -> SH5b -> SH7 -> GM6c2 -> GM6c3 -> GM6d1 ->
   GM9r` (shots I-2, §9.14); `game.test.ts` continues `-> SH12a`.
   **Ruled: RULINGS 153** — the one order ([engine §12 Order and conflicts](../engine/12f-order-and-conflicts.md#order-and-conflicts)) replaces this chain.
6. **An overlay half** would own the motion of `DialogueBox`, `Choices`, `Backlog` and `Toast` (engine.md §8.2, §15
   Q4: no planned owner today). GM6c3 edits the first three's text rendering, `ui/typewriter.ts` and
   `ui/state.svelte.ts`; GM6t gives `Toast` its motion. Recommendation: rule the overlay half as engine.md Q4 asks,
   forward R-A6 / R-A7 to it, and run GM6c3 and GM6t before its cuts or after its merge, never beside it.
   **Ruled: RULINGS 172** — as engine §15 item 4: the overlay motion owner is a later lane after GM3s; no design now.
7. **engine.md text updates.** R-E15, R-E16, R-E18-R-E24 are applied or accepted in engine.md round 5; **R-E25**
   (adopted with two changes) and **R-E26** (accepted) are in engine.md round 6 (§14.2 [engine §14.2 Answers to per-player.md §12](../engine/14-interface-requests.md#142-answers-to-per-playermd-12)), and this file
   mirrors them (E-P16, §12.2). Round 7 asked **R-E27** (the figures +2.85 / 8.49; the constant `LABELS_TEXTS`;
   `puzzle:offline`'s second emitter withdrawn, a values failure ending the wait with `puzzle:ready`; the one-cue pass
   over GM3p's no-outcome branch and the countdown's zero), accepted in engine.md round 7 ([engine §0 Decision table](../engine/00-decision-table.md#0-decision-table), [engine §14.2 Answers to per-player.md §12](../engine/14-interface-requests.md#142-answers-to-per-playermd-12)). Round 8
   asked **R-E28** (one attempt starter `post(o)`; the figures +2.91 / 8.42), accepted in engine.md round 8 with
   `post(o)` in GM3p ([engine §14.2 Answers to per-player.md §12](../engine/14-interface-requests.md#142-answers-to-per-playermd-12)). Round 9 asked **R-E29** (the figures +2.98 / 8.32; `ui/value-motion.ts` named under
   RULINGS 135 (b)'s resolve rule), answered in engine.md round 9's §0 row ([engine §0 Decision table](../engine/00-decision-table.md#0-decision-table): +1.53; E-P19 announced). **This
   round asks R-E30** (the figures +3.00 / 8.27; E-P19's value-span case as §12.2 answers it). Recommendation: send
   R-E30 to the engine track's next round, before GM6c3's cut, so E-P19's row and §5.3's resolve rule state the same
   thing; settle one cross-track first-line figure when both texts are final (critique_perplayer_r9 question 1; the
   binding check is MEASURED per lane anyway). **Reconcile revision 1:** R-E30 is answered (E-P19 written; engine.md
   uses +3.00 from round 10 on); this revision asks **R-E31** (the re-based figures), **R-E32** (I-11's method returns
   room commands, labels included) and **R-E33** (a labels-only batch is `stateHold`'s `'no-load'`). Recommendation:
   send all three to the engine track's reconcile round; R-E32 and R-E33 before GM3b's cut (the method's shape and
   `stateHold`'s empty-diff answer are GM3b's). **Reconcile r3:** all three answered by engine.md's reconcile r2
   (§12.1 statuses).
   **Ruled: RULINGS 172** — closed: applied in engine.md's rounds.
8. **The entry lever (RULINGS 127, m8).** GM6s2 (~+0.09 KB br) and GM6t (~+0.26) add entry code; the lever (moving
   `MetaEndpoints` and its decoders out of the entry, `endpoints.ts:189-193`) touches `api/endpoints.ts`,
   `api/decode.ts`, `app/boot.ts`, `app/meta.ts` and four test files (Grep `MetaEndpoints|createMetaEndpoints`), so as
   "the first item" of GM6s2 it would push that 16-file contract lane past 20 files, and of GM6t a 5-file overlay lane
   into the api layer. Recommendation: run the lever as its own small behaviour-identical client lane, before the first
   lane of either design that adds entry code (engine.md §11 adds ~0.05 KB br too); GM6s2 and GM6t list it in their
   "After". If the orchestrator keeps the ruling's literal form, GM6s2 is the lane that takes it and is split into
   GM6s2a (lever) and GM6s2b (this section) at its cut. **Reconcile P4: resolved** (LEL merged `7b37278`, RULINGS
   141); GM6s2's lock is 17 (+ `client/src/api/meta.ts`, where LEL moved `META_KINDS`; `tsc` forces its
   `value_changed` row). Recommendation: accept 17 (the contract unit plus the one file `tsc` forces; splitting the
   `META_KINDS` row from the `ErrorCode` it maps would leave a red `check` between two lanes).
   **Ruled: RULINGS 137** — the lever ran as its own lane and merged: LEL (`7b37278`, RULINGS 141).
9. **LRF before GM6k (W1).** Done: LRF merged `a93fe54`; GM6k's erasure data names its two tables (§3.9, r3 m2).
   **Ruled: RULINGS 130** — done: LRF auto-refund merged `a93fe54`.
10. **LRF's erasure rule in the docs (r3 m2).** **Resolved (round 5):** docs-errata-9 merged `525dd68` (RULINGS 133)
    with the rule in `docs/runbooks/privacy-ops.md` (access `:113-117`, `:125-126`; erasure keeps both tables,
    `:155-157`); META-PLAN's inventory still predates them, as `privacy-ops.md:114-115` says. GM6s1's docs commit adds
    only `puzzle_values` (§3.9). No action.
11. **GM6k vs M3s (RULINGS 132).** Both hold `server/src/content.rs` and `server/tests/it/content.rs`; M3s's order is
    re-set by `design-shots`. Recommendation: GM6k goes first when it is ready and M3s is not cut; never beside;
    the later cut re-locates (§9 "Order").
    **Ruled: RULINGS 151, 160** — M3s went first (merged `a5f887b`); GM6k launched after it, from the frozen design, before this adoption merged (RULINGS 160).
12. **The animation / shot chain (r3 W2, RULINGS 132).** This file now orders its lanes against `characters.md` rev.
    3's chain and states the invariants a successor must keep (§9 "Order", R-A10). Recommendation: when
    `design-shots` names its scene and `game.ts` lanes, have engine.md §12 replace MD2 / MA1a / MA1b / MA2 by them
    in one edit and check GM6a, GM6c2, GM6d1 against the invariants at their cuts. **Reconcile P2:** named (shots
    §9.14, I-2); §9 "Order" carries the `reconcile:` rows; engine.md §12 adopts them by I-2.
    **Ruled: RULINGS 153** — the one order: [engine §12 Order and conflicts](../engine/12f-order-and-conflicts.md#order-and-conflicts).
13. **The two shared-file tables before a GM6 cut (r4 m3).** engine.md round 6 applied R-E25's rows
    (`scripts/story/world.ts`, `scripts/story/mechanics/texts.ts`, [engine §12 Order and conflicts](../engine/12f-order-and-conflicts.md#order-and-conflicts)), so its rows
    ([engine §12 Order and conflicts](../engine/12f-order-and-conflicts.md#order-and-conflicts)) and §9 "Shared files" agree in round 7 (E-P16 (e) mirrored). Recommendation: each GM6 cut brief
    names the lane's lock and asks the cut to compare engine.md §12's row of each locked file with §9 "Shared files";
    a difference is a STOP item, settled in engine.md's row. An `engine.md:N` cite inside a lane text that no round-7
    patch names is a round-5 number; the cut re-locates it (this is a cite, never an order). Apply E-P16 with this
    round **before GM6c1a's and GM6d2's cuts** (critique_perplayer_r6's orchestrator item) and forward R-E27.
    **Ruled: RULINGS 172** — accepted as a cut-brief check.
14. **R-E28 and GM3p's round-7 contracts before GM6c2's cut (round 8).** GM6c2 now relies on GM3p's `setLadder`, its
    busy-reply test and its state gate (E-P17), and on one attempt starter `post(o)` that GM7r / GM8h must call
    (R-E28). Recommendation: send R-E28 to the engine track before GM7r's and GM8h's cuts; GM6c2's cut checks that
    GM3p merged with `setLadder` and the state gate (else STOP), and lists every `session.attempt()` site in
    `yields.ts` at its parent (a site that bypasses `post(o)` is a STOP item for whichever lane lands second).
    critique_perplayer_r7's orchestrator item (GM6c2's cut needs R-E27 (c) and (d) applied in engine.md) is met:
    engine.md round 7 accepted all four parts ([engine §0 Decision table](../engine/00-decision-table.md#0-decision-table), [engine §14.2 Answers to per-player.md §12](../engine/14-interface-requests.md#142-answers-to-per-playermd-12)). **Round 9:** R-E28 is answered
    (engine.md round 8, §14.2 [engine §14.2 Answers to per-player.md §12](../engine/14-interface-requests.md#142-answers-to-per-playermd-12) as read: accepted, `post(o)` lands in GM3p), so critique_perplayer_r8's
    orchestrator item is met; GM6c2's cut now checks GM3p merged with `setLadder`, the state gate **and `post(o)`**
    with its pin, and GM3w with `retrying` (E-P18), else STOP. Send R-E29 to the engine track's round 9 (the figures;
    `ui/value-motion.ts` named under its RULINGS 135 (b) rule), before GM6c3's cut.
    **Ruled: RULINGS 172** — accepted as a cut-brief check.
15. **RULINGS 135 (a) at GM6c2's cut.** The cut re-reads `game.ts`'s world installations at its parent (Grep
    `yields\.restore\(` and `chapterChanged\(`): the design relies on exactly two `restore` sites, the paywall's (which
    `chapterLeft()` replaces) and the resumed body's (a world of `s.ch`). A third site, or a `restore` of a world that
    is not `h.chapter()`'s, is a STOP item: it must go through `chapterLeft()` or carry its chapter. Recommendation:
    add the check to the cut brief; the class guard `values: every masking state has an action that resolves it`
    covers the store side whatever the call sites. **Round 10 (r9 W1):** the same cut also re-runs §5.2's audit of
    `chapter()`'s id (Grep `\.ch = ` over `client/src/app/game.ts`; main: `:827` in `enterChapter`, `:1953` in
    `setLang`, guarded to the same id at `:1952`): a third assignment, or one that can change the id without
    `enterChapter` -> `chapterEntered()`, is a STOP item (it must go through `enterChapter`, or keep the id). Even
    then a player would see Retry with the mask (`render`'s prompt scheduling), never a silent mask. **Reconcile
    P3/P4:** on main `acc4e0d` the two assignments are `:891` (`enterChapter`) and `:2116` (`setLang`, guarded at
    `:2115`), the two `restore` sites `:970` (paywall) and `:989`; "every surface" now holds literally, since every
    value surface renders through yields' wrapper (r10 m2, §5.2 "One render path").
    **Ruled: RULINGS 172** — accepted as a cut-brief check.
16. **Predicted reds of game-level pins (critique_perplayer_r10 open question 2; RULINGS 135's "a class that recurs").**
    r7 m2, r8 m3, r9 m1 and r10 m1 each corrected a predicted red the named mutation did not produce. Recommendation
    (taken in this file from this revision): a game-level pin names its failing input as a **full-design revert**
    ("round N's `chapter()`", as M-P10d) unless the design traced the mutation through the production dependencies the
    test runs; its red is stated as "expected", and **the tester's mutation run at the lane is the oracle** for the
    exact red; a different red is a finding for the lane, not a design round. Rule it for both tracks.
    **Ruled: RULINGS 172** — accepted (taken in this file).
17. **L1 / L2 return (reconcile P4; RULINGS 142).** With LFL merged (`cec347c`, +265 B on the entry), the planned
    entry lanes leave **0.55 KB br**, 48 B above the return line: the condition is not met by the estimates, but a lane
    48 B over its estimate meets it. Recommendation: keep L1 / L2 shelved; every entry lane (GM3s, GM6s2, GM6t, the
    shots' entry lane) quotes the entry row base -> HEAD plus the other open entry lanes' estimates at its cut, and the
    first quote that leaves < 0.5 STOPs that lane while L1 (entry -1.75, first line +0.07; RULINGS 140,
    `RULINGS.md:2988-2990`, reconcile r2, m3: revision 1 cited RULINGS 142, which states only "+0.07 to +0.55 KB" for
    both levers, `:3008`) runs as its own lane first; L2 stays shelved. **Reconcile r2 (W1): closed, no ruling
    needed.** engine.md §15 item 15 now reads LFL's round-2 bytes and recommends the same: "keep L1 carried" with the
    per-lane quote and STOP ([engine §15 Questions for the orchestrator](../engine/15-orchestrator-questions.md#15-questions-for-the-orchestrator-engineering-each-with-a-recommendation)); revision 1's fork ("launch L1 now" against the quote rule) no
    longer exists. Reconcile r3: engine.md's reconcile r2 books GM3w's entry at +0.01, so the margin reads 0.538 KB
    br, 38 B above the line (Ledger 2); the recommendation and the STOP rule are unchanged, and this revision adds no
    entry byte.
    **Ruled since: RULINGS 158** — L1 is unshelved (RULINGS 142's return condition: 38,988 B + 510 B = 39,498 B, 502 B left against the 500 B line, inside the build's own churn) as lane `l1-entry-summary` (`summaryOf` into `saves/summary.ts`; entry -1.59, first line +0.21, CLAIM at `cdca9d4`); L2 stays shelved. The cut/build crossing rule above stands for every later entry-adding lane, read against the row after L1 merges. Changed by RULINGS 159 (as of `9a83251`; docs lane `docs-errata-10`, group A): L1 merged `eec24fe`; entry 37,338 B MEASURED, 2,662 B left; first line 254,288 B MEASURED.
21. **E-P25-E-P28 (engine.md reconcile revision 1).** Announced (`design/mechanics/engine.md` line 392 at tag `designs-adopted-2026-11-09` (history: the header's reconcile revision 1 summary) as read) but their §14.3 rows were not
    yet written when this revision closed; only E-P28's rule is visible ([engine §8.1 The cue union and the bus](../engine/08a-cue-union-and-bus.md#81-the-cue-union-and-the-bus): a new promise-returning
    host member needs a `HOST_WAITS` row), answered in §12.2. Recommendation: forward the written rows to this track's
    next reconcile round; no GM6 cut starts before they are answered. **Reconcile r2: resolved** (written at
    [engine §14.3 Interface requests to per-player.md](../engine/14-interface-requests.md#143-interface-requests-to-per-playermd-reconcile); answered in §12.2, E-P25 with one input corrected, E-P26 with one row stricter).
    **Ruled: RULINGS 153, 158** — answered inside design-reconcile ([engine §14.2 Answers to per-player.md §12](../engine/14-interface-requests.md#142-answers-to-per-playermd-12); [engine §14.3 Interface requests to per-player.md](../engine/14-interface-requests.md#143-interface-requests-to-per-playermd-reconcile); [§12.2 Answers to engine.md §14.1 and §14.3](12-interface-requests.md#122-answers-to-enginemd-141-and-143-rounds-1-14-reconcile-revision-1-answers-e-p20-e-p24-reconcile-revision-2-answers-e-p25-e-p28-reconcile-revision-3-answers-e-p29-e-p30)).
22. **Requests of reconcile revision 2 (R-E31 restated, R-E33 restated, R-E34, R-E35; R-S2).** Recommendation: send
    R-E31 / R-E33 / R-E34 / R-E35 to the engine track's next round (R-E31 before the docs adoption lane copies §11.1,
    so the adopted ledger reads this file's terms; R-E33 and R-E32 before GM3b's cut; R-E34 before GM6c2's cut);
    forward R-S2 to the shots design with R-S1 before SH12b's cut. None adds a lane; R-S2 adds one lint code to
    SH12b's `SHOT_LINT_CODES` and a STAGING-DSL §14 row (SH12b already holds both, [engine §12 Order and conflicts](../engine/12f-order-and-conflicts.md#order-and-conflicts), [engine §12 Order and conflicts](../engine/12f-order-and-conflicts.md#order-and-conflicts)).
    **Reconcile r3: R-E31-R-E35 answered** by engine.md's reconcile r2 (§12.1 statuses; its §14.2 rows not yet
    written when read). The critic's sequencing question (critique_perplayer_r2 open question 1: the docs lane should
    not copy §11.1's PPL row or I-11's `propsFor` shape before R-E31 / R-E32 are answered) is therefore resolved: the
    docs adoption lane copies engine.md's reconcile-r2 §11.1 (whose PPL input is this file's term table) and I-11's
    `roomFor` shape (GM3b, R-E32 adopted), with this file's reconcile-r3 term table as that input (+3.13, R-E36).
    **Ruled: RULINGS 153, 158** — answered inside design-reconcile ([engine §14.2 Answers to per-player.md §12](../engine/14-interface-requests.md#142-answers-to-per-playermd-12); [engine §14.3 Interface requests to per-player.md](../engine/14-interface-requests.md#143-interface-requests-to-per-playermd-reconcile); [§12.2 Answers to engine.md §14.1 and §14.3](12-interface-requests.md#122-answers-to-enginemd-141-and-143-rounds-1-14-reconcile-revision-1-answers-e-p20-e-p24-reconcile-revision-2-answers-e-p25-e-p28-reconcile-revision-3-answers-e-p29-e-p30)).
23. **Requests of reconcile revision 3 (R-E36, R-S3).** Recommendation: R-E36 (a) to the engine track's next round,
    or, if none runs before the docs lane, to the docs lane as §11.1's own documented term move (+0.02 on Ledgers 1, 3,
    4; no lane STOPs on it, [engine §11.1 The shared ledgers](../engine/11-budgets-and-validation.md#111-the-shared-ledgers-reconcile-r1-r2-rulings-143-qo10-152-r4-153-155-design-shots-i-13) as last read); R-E36 (b) with it (one sentence beside I-6's answer;
    no code). Forward R-S3 to the shots design with R-S1 / R-S2 (engine.md §30 item 18 lists per-player's shots
    requests for the docs lane) before SH1's cut: it adds no lane and no code (today's `present()` already satisfies
    it) and binds the four lanes that rework `present()` / `stage()`; GM6d1's pin (M-PR3c) then guards it after SH7.
    **Reconcile r4:** R-E36 is taken (engine.md §14.2, [engine §14.2 Answers to per-player.md §12](../engine/14-interface-requests.md#142-answers-to-per-playermd-12) as read). R-S3 is still missing from engine.md
    §30 item 18 (critique_perplayer_r3 open question 1), so **R-E37** (a) asks for it there and (b) asks engine.md to
    cite this file by section (that critic's open question 2; critique_engine_r2 m3). Recommendation: R-E37 to the
    engine track's next round; if the docs lane runs first, it builds the shots errata list from §30 item 18 **plus**
    this file's §12.1 rows R-S1-R-S3 (R-S3's text is R-E37 (a)'s), and re-locates every `per-player.md:N` by section.
    **Ruled: RULINGS 158** — R-E36 taken ([engine §14.2 Answers to per-player.md §12](../engine/14-interface-requests.md#142-answers-to-per-playermd-12)); R-E37: (a) R-S3 joined [engine §30 Shots errata from reconcile](../engine/30-shots-errata.md#30-shots-errata-from-reconcile) item 18 at the adoption, (b) the adoption cites this file by section.
24. **Reconcile r4: what the parallel rounds leave open.** (a) engine.md's own reconcile revision 3 was being written
    beside this revision (engine.md read as its reconcile r2 with the late additions, `design/mechanics/engine.md` lines 11325-11352 at tag `designs-adopted-2026-11-09` (history: §32, the reconcile r2 late additions); Grep
    `E-P3[1-9]` finds nothing), so any request it adds is for this track's next round; no GM6 cut starts before it is
    answered. (b) The all-JS row on `3c62a86`: GM7p + GM7g's rows read 304.96-305.06 (§10 "Ledgers", reconcile r4).
    Recommendation: the orchestrator gives engine.md §15 item 16's ruling before GM7p's cut, as critique_engine_r2 m1
    directs; GM6 lanes do not STOP on the type-chunk rows (§10 "Per-lane quote", reconcile r4), so the ruling gates EN's
    lanes, not this file's. (c) The entry base is CLAIM since LRB (rounded 39.0, no byte table): GM6s2's and GM6t's
    cuts read the exact entry bytes on their parent before quoting the 38 B margin.
    **Ruled: RULINGS 158** — (b) `allJsBr` is re-set once, by GM7p ([engine §15 Questions for the orchestrator](../engine/15-orchestrator-questions.md#15-questions-for-the-orchestrator-engineering-each-with-a-recommendation) item 16); (c) the entry base is MEASURED at `3c62a86`: 38,988 B ([§10 Ledgers](10-budgets-and-validation.md#ledgers-reconcile-p4-rulings-143-qo10-145-149-152-shots-i-13-reconcile-r2-one-ledger-enginemd-111)).
18. **R-S1 to the shots design (reconcile P2).** SH8's drive steps a depth list a later scene lane can enter (the bg
    labels' depth nodes, GM6d1). Recommendation: forward it with I-9's answer before SH8's cut; it adds no lane and
    ~2 lines to SH8 (the list's add / remove), or GM6d1 STOPs at its cut.
    **Ruled: RULINGS 158** — R-S1 is applied to the shots plan at the adoption ([shots §9.9 SH8 `shot-motion`](../shots/09d-lanes-sh6-sh10.md#99-sh8-shot-motion-client-runtime)).
19. **R-E32 into SH5a's text.** SH5a's `withRoomProps` appends `roomFor(bg)`'s commands verbatim (props, then labels
    once GM6d2 lands), not a `props` command it builds. Recommendation: forward with R-E32 before SH5a's cut; the
    function's name is engine.md's to settle (GM3b), SH5a's text follows it. **Reconcile r3: resolved** (engine.md
    names it `roomFor` and carries it into SH5a's text through its §30 item 6, [engine §30 Shots errata from reconcile](../engine/30-shots-errata.md#30-shots-errata-from-reconcile), [engine §30 Shots errata from reconcile](../engine/30-shots-errata.md#30-shots-errata-from-reconcile) as last read).
    **Ruled: RULINGS 158** — `roomFor` is applied to the shots plan at the adoption ([shots §5.8 Preload policy for cuts](../shots/05b-preload-memory-download.md#58-preload-policy-for-cuts-sh5a-windows-sh5b-entry); [shots §9.6 SH5a `shot-preload`](../shots/09c-lanes-sh4-sh5b.md#96-sh5a-shot-preload-client-runtime-windows-warm-rooms)).
20. **GM6c2's lock 10 and `requests.test.ts` (reconcile P1).** GM6c2 now holds `client/src/requests.test.ts` (four
    rows, two `WaitRow`s, one `VIEW_FILES` entry). Recommendation: accept; engine.md §12 gains the row `GM3p -> ... ->
    GM6c2` (E-P23 (a) names it), and any other lane adding a row there runs by launch, never beside.
    **Ruled: RULINGS 172** — accepted as a cut-brief check.
