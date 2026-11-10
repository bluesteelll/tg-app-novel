## 15. Questions for the orchestrator (engineering, each with a recommendation)

1. **The `first-load` row omits the world** (`budget.ts:944-953`; `firstLoadRows` `:958-994` on `a6365a8`) while
   `loadFree` awaits it before the first line (`chapters.ts:210-216`); the en table likewise when the UI language is en.
   Recommendation: add `<ch> world` (and the en table) to the row in **GM4g** (it holds `budget.ts`), red-first on a
   chapter whose world pushes the sum over.
   **Ruled: RULINGS 172** — accepted: GM4g adds `<ch> world` (and the en table) to the first-load row.
2. **GM2a holds `app/game.ts`** for type references and four literals, no behaviour (§5.2). Recommendation: accept
   (RULINGS 120's one-hunk precedent, scaled to a mechanical rename) and launch GM2a before the first A(`game.ts`) lane's
   cut (round 4: rev. 3's MD2; whichever lane `design-shots` or an adopted animation design puts on `game.ts`,
   RULINGS 132); if one is cut first, GM2a waits for its merge. Reconcile r1: that lane is **SH1** (§12 "Order and
   conflicts"); LFL and LRB have merged (LRB `3c62a86`, RULINGS 157) and L1 (RULINGS 158; merged `eec24fe`, RULINGS 159) comes before GM2a on `game.ts`, so GM2a starts after L1 and before
   SH1's cut.
   **Ruled: RULINGS 172** — accepted (RULINGS 120's one-hunk precedent): GM2a holds `app/game.ts`.
3. **Story commits** in GM1d, GM3b, GM4u, GM9r (one key or one demo object each; round 3 m8: GM4 holds no story file,
   GM9p has none; round 5 m2: GM3b adds one catalog prop, GM4u and GM9r their en table entries) and, round 4, **GM8d**
   (the first world of «Прилив» ch3 with one demo puzzle per new type; round 5 W1: a new choice set whose option 1
   enters the section and whose option 0 keeps today's path; round 6 W2: `t008`-`t011` move unchanged into a new knot
   `lighthouse_radio` that both options reach at its top; the entry and exit knots in `story/ch3/main.ink`, five
   placeholder props and one placeholder bg in `assets/catalog.json`) by the
   `narrative-designer` role, as per-player.md GM6c4 does. Recommendation: accept; GM8d's content is MVP placeholder
   (one writer pass, one mechanical verifier), and owner Q15g may move it.
   **Ruled: RULINGS 172** — accepted: the story commits ride their lanes by the `narrative-designer` role (MVP placeholder workflow).
4. **The overlay UI has no motion owner (m7).** RULINGS 116 and 124 plan the character half and the room half of
   `design-animation` only, and RULINGS 132 (round 4) replaces the character half with `design-shots`, which also
   covers the room half where rooms are shots; none of them names the overlay UI. The dialogue box, choices, story
   menus, Home and the meta overlays (`ui/*.svelte`, `ui/meta/**`) belong to no planned lane, though the owner's value
   covers every UI interaction (Q53).
   Recommendation: rule an overlay half of `design-animation` (or a lane of this programme after GM3s), with §8.3's
   `data-cue` gate and §8.5's motion gate as its enforcement over those directories, and per-player R-A6's constraint
   (keep `ValueText` and the reveal rule) in its brief. The stage-level layer (GM3s) already sits above every layer
   those components use, so no second cue mechanism is needed.
   **Ruled: RULINGS 172** — the overlay motion owner is a later lane after GM3s; no design now (RULINGS 132 stopped the character half).
5. **Lane count:** 29 lanes in round 4 (+ GM8d) and the conditional GM5q (runs only if P2-b at GM5's cut shows a
   view-heavy section past the cap); each <= 15 files but GM1c and GM3 (16 each, with their reasons; round 3 corrected
   round 2's "27", round 3's own count was 28). Recommendation: one workflow run per lane; the world chain runs one lane
   at a time, with GM2a / GM3m / GM3w beside it; the small lanes (GM3w, GM4g, GM4u, GM5q, GM7r, GM8h, GM8d; 4-10 files
   each) keep their own cut and review, never merged into a neighbour.
   **Ruled: RULINGS 172** — accepted: one workflow run per lane; the world chain one lane at a time.
6. **A state-cap raise** stays out of these lanes; decide it only on P2-b plus a budget-Android timing of the runtime
   search (§7.6). Recommendation: no raise now.
   **Ruled: RULINGS 172** — no state-cap raise now.
7. **Q11's chapter-select gating is unscheduled.** OPEN-QUESTIONS Q11 (RESOLVED 2026-11-02) says "a code change follows
   (chapter select keeps a chapter locked until the previous one is finished)"; `boot.ts:528-533` still starts any
   owned chapter new. GM9r's builder keeps a required item held on that path either way (required items are injected).
   Recommendation: schedule the gating as its own small client lane; it does not block this programme.
   **Ruled: RULINGS 172** — Q11's chapter-select gating is its own small later client lane; it does not block this programme.
8. **Mirror the two tracks' shared-file tables before the first GM lane launches** (critique_engine_r2, orchestrator
   question). This file's §12 order table and holder table are complete for its lanes as of round 3; per-player.md §9
   still lists round-1 engine holders (E-P10). Recommendation: until per-player.md mirrors them, take each file's
   engine lanes from this file's table and its per-player lanes from per-player.md's, and check a lane's lock against
   both at its cut. Round 4: per-player.md mirrored E-P10 and made this file's §12 the owner of every shared row
   (R-E16); this round adds the rows its R-E19 asked for as A(f) invariants. Remaining step: per-player.md mirrors the
   round-4 rows that changed here (`lint.ts` GM1d only, `mechanics/core.ts`, `puzzles/index.ts`, `e2e/helpers.ts`,
   `story/ch3/*`, `assets/catalog.json`, `i18n/mechanics.ts`). Round 5: per-player round 5 mirrored those
   rows and asked for five more (R-E23, applied here); what remains is E-P15 (b) (the two en tables, the catalog with
   GM3b, `rules/index.ts` with GM8h, `spike-p2.test.ts`, GM5q on `explore.test.ts`); the critic's note stands: check
   both tables at the first GM6 cut.
   **Ruled: RULINGS 153** — one combined order and shared-file table ([§12 Order and conflicts](12f-order-and-conflicts.md#order-and-conflicts); [per-player §9 Order](../per-player/09e-order-and-shared-files.md#order) / [per-player §9 Shared files](../per-player/09e-order-and-shared-files.md#shared-files-w4-m9) mirror it).
9. **Where Rolldown puts Svelte's transition runtime** (round 4; critique_perplayer_r3 W1, per-player R-E21). GM3s
   adds the first `in:` / `out:` directives of the client (on `ExploreView.svelte` in the lazy explore-ui chunk; no
   directive exists in `client/src/**/*.svelte` today, per-player.md's Grep). Recommendation: GM3s's build gate
   MEASURES the entry row before / after; a delta past +0.05 + 0.5 KB br is a STOP item to the orchestrator, with the
   fallback already designed (§3.5: the cue player's WAAPI motions on the layer root plus a ghost element for the outro,
   no Svelte transition), so the STOP costs a commit, not a redesign.
   **Ruled: RULINGS 172** — accepted: GM3s's build measures the transition runtime on the entry row.
10. **The authoring doc for module and type lint codes** (round 4, found while resolving). STAGING-DSL §11 is the table
    of `LINT_CODES` and is pinned by `dsl-doc: lint table equals lint codes` (`client/src/story/dsl-doc.test.ts:139-152`,
    86 rows); the module and type codes (§3.2 `MECHANIC_LINTS` / `PUZZLE_LINTS`) are deliberately outside it.
    Recommendation: the adoption docs lane (§3.6 step 11's docs lane, doc-writer) adds a hand table of module and
    type codes to the authoring guide with its own doc test over `MECHANIC_LINTS` / `PUZZLE_LINTS`; no lane of this
    design edits STAGING-DSL §11 or `dsl-doc.test.ts`.
    **Ruled: RULINGS 172** — the lint-code authoring doc goes to a later docs lane.
11. **The test world of critique_engine_r3 W2** (the critic's orchestrator question). The engineering part is decided
    here: the demo content ships in the placeholder story (GM8d, «Прилив» ch3), because the e2e builds from the real
    story (`client/package.json:17`: `npm run story && ... vite build --mode e2e`), so an e2e-only chapter would need a
    second story root, a second compile and a guard that keeps it out of `client/dist/`, three new moving parts for a
    test. The value part (whether the owner wants these demos visible in the placeholder story) is owner Q15g, default
    yes. Recommendation: accept; if the owner says no, GM8d's cut moves the same files under an e2e-only story root
    with a `scan-dist` canary, as a STOP item then.
    **Ruled: RULINGS 154** — the demo puzzles live in «Прилив» ch3 (GM8d).
12. **The engine envelope is at its bound** (round 8). This design's own programme target, engine growth <= 1.5 KB br
    (§2), now holds +1.50 (ARITHMETIC, §3.5), 0.00 left; the enforced gates are the build rows (engine 215.70 /
    230.0, first line 261.61 / 270.0 with per-player's +2.91) and the per-lane STOP rule (> +0.5 over a lane's line).
    Recommendation: keep 1.5 as the target; a later revision or lane cut that books another engine line brings an
    equal saving (as round 8's `postReach` reuse of `post(o)` did) or asks the orchestrator for a target ruling with
    the MEASURED rows of the lanes merged by then, never a silent overrun. **Round 9 (restated; the ruling is now
    asked):** RULINGS 135 (b)'s m1 / m2 half books +0.04 (GM3p: `hideFrame`, `unshowCloseup` shared, the X8 call,
    `endFrame`) and GM8h saves 0.01, so the programme reads **+1.53** (ARITHMETIC, §3.5), **0.03 KB br (~30 B, ~7
    lines at 4.3 B) past the target**. No saving of that size exists without dropping a ruled behaviour: the
    alternatives were checked (the X8 hide inline in `screensChanged` instead of `hideFrame`: the same lines twice, +;
    `endFrame` folded into `dropPuzzle`: `hideFrame` then repeats its emission, +; the every-frame `panel-open` back in
    the screens diff: m1's double close returns, a defect). The enforced gates keep their margins: engine 215.73 /
    230.0 (14.27 left), first line 261.73 / 270.0 (8.27 left with per-player's +3.00), and the per-lane STOP rule
    (> +0.5 over a lane's line) is unchanged. **Recommendation: rule the programme target to 1.6 KB br** (it bounds
    this design's own estimate, not a gate; 0.07 left), recorded in RULINGS; if the orchestrator keeps 1.5, GM3p's cut
    carries a STOP item to find 0.03 KB br in its own diff with its build MEASURED, never by removing a motion.
    **Round 10 (restated):** W1's `appear(o)` books +0.03 more in GM3p (§3.5), so the programme reads **+1.56**, 0.06
    past 1.5; the alternatives were checked (`appear` folded into `setFrame`: `openPuzzle` writes the frame directly,
    so a call stays there, -0 lines; the appearance emitted only at the chunk write: a later open whose type chunk is
    not cached would show its frame with no slide-in until that chunk lands, a motion lost). On the re-based ledger the
    gates keep their margins: engine 216.06 / 230.0 (13.94 left), first line 262.86 / 270.0 (7.14 left before the shot
    design, 0.99 with design-shots' 6.15). **Recommendation unchanged: rule the target to 1.6 KB br** (0.04 left); if
    1.5 is kept, GM3p's STOP item looks for 0.06 KB br in its diff, never by removing a motion.
    **Round 11 (restated):** W1's wait class books +0.03 in GM3p (`holdLoad`, `Open.loading`, its call sites, the
    close-up's hold) and +0.02 in GM3s (the explore-import hold, `prefetch()` and its two call sites), so the programme
    reads **+1.61** (ARITHMETIC, §3.5), **0.11 past 1.5 and 0.01 past round 10's recommended 1.6**. Alternatives
    checked: the load hold folded into `appear(o)` (it would start only when the frame shows, so the unshown wait, the
    remark itself, stays motionless: a motion lost); the close-up's hold dropped in favour of the frame's (the frame is
    not written until the close-up lands, `yields.ts:587-592`, so no hold would run: a motion lost); `prefetch()` kept
    to `lineShown` (a resumed yield's host and cue stage load on the first tap, a longer wait: the class grows). The
    `checking` loop costs the engine 0 (it is cue-stage data, §3.5). Gates keep their margins: engine 216.11 / 230.0
    (13.89 left; ~216.01 on LEL's 214.4), first line 262.91 / 270.0 before the shots (7.09 left) and **269.16 / 270.0
    with design-shots' approved rev. 7** (0.84 left, peak 269.36), the row that binds (RULINGS 142).
    **Recommendation: rule the programme target to 1.7 KB br** (0.09 left; it bounds this design's own estimate, not a
    gate; the first-line row and the per-lane STOP rule stay the enforced limits, under RULINGS 143 QO10's one ledger).
    If 1.6 is ruled, GM3p's STOP item looks for 0.01 KB br in its diff, never by removing a motion; if 1.5 is kept,
    0.11 across GM3p's and GM3s's diffs on the same terms.
    **Round 12 (restated):** `held` nets +2 lines in GM3s and takes the close-up hold's two lines out of GM3p (0 net
    between them), GM3w's `ahead` adds ~2 and GM3b's anchor box ~1, so the programme reads **+1.62** (ARITHMETIC,
    §3.5), 0.12 past 1.5. Alternatives checked: the state batch's hold inline in GM3b instead of `held` (the same two
    emissions again, +2 lines, and the class stays open to the next caller: rejected for correctness, not bytes);
    `ahead` dropped and m5 left as a cost (-2 lines; a chapter that opens on a yield would wait one round trip with no
    motion on every session's first chapter that has the shape: a motion lost). Gates keep their margins: engine
    216.12 / 230.0 (13.88 left), first line 262.92 before the shots (7.08 left) and **269.17 / 270.0 with design-shots'
    rev. 7** (0.83 left, peak 269.37). **Recommendation unchanged: rule the programme target to 1.7 KB br** (0.08
    left).
    **Reconcile r1:** the four request answers add +0.07 (I-1's `cam` reader +0.03, I-11's `propsFor` +0.03, the stale
    term and the scene seam +0.01, `FRAME_OPEN_MS` under the rounding), so the programme reads **+1.69** (1.686,
    §3.5), 0.01 under 1.7; the gates are §11.1's (engine closure 225.89 / 230.0, first line 265.34 / 270.0 with LFL).
    No answer is dropped to save bytes (each is a correctness or motion item). **Recommendation unchanged: 1.7 KB br.**
    **Reconcile r2:** RC-W5's frame edge (`frameShown`, ~4 lines in GM3p) and RC-W2's `roomFor` wrapper (~1 line) add
    21.5 B, so the programme reads **+1.71** (1.7075, §3.5), 0.01 past 1.7; the gates are §11.1's (engine closure
    226.02 / 230.0, first line 265.48 / 270.0 with LFL). Each is a motion or correctness item (a still room covered
    with no frame on it; a room cut back without its labels), so neither is dropped. **Recommendation: rule the programme target to 1.75 KB br** (0.04 left); it bounds this
    design's own estimate, not a gate, and the per-lane STOP rule (a lane > 0.5 KB br over its estimate stops at its
    cut) and §11.1's rows stay the enforced limits.
    **Ruled: RULINGS 172** — the 1.5 KB br envelope stays a target; §11.1's ledger is the gate.
13. **The recurring class of RULINGS 135** (critique_engine_r9 W1 / W2: "a motion resolved where its target does not
    exist", the third and fourth path after round 8's W1). Resolved here as RULINGS 135 (a)'s form: two rules for the
    two lifetimes found (a frame cue waits for its frame to be on screen; a `ribbon` target with no live ribbon lands at
    `edge`) and **one guard over the class**: the player's `fallbacks()`, `data-cue-fallbacks` under `__TG_MOCK__`, 0
    asserted by every real-flush test and every mechanics e2e (§8.1 point 10). Recommendation: record the invariant "a
    counted fallback is a defect; a lane whose e2e or real-flush test counts one stops at its cut" in RULINGS, so a
    later path of the class becomes a red test in the lane that opens it (as the orphan count did for lost cues), and
    the design rounds stop finding it by reading. The guard covers what the e2e walk and the real-flush tests reach;
    a path no test walks (content no shipped world has, such as W2's take with a knot) is covered by the per-kind rule
    and its derived stage test (`stage: a ribbon target with no live ribbon lands at the edge` runs every `ribbon`
    row), not by the counter. **Round 11 (extended; critique_engine_r10 W1):** the same form gets a second class, **a
    wait with no motion** (the unshown frame's chunk imports; found with it: a close-up's load, a section's first
    explore import, an answer that outlasts `checking`'s three pulses). Its invariant is "every wait of the explore and
    puzzle views holds a motion from the block that starts it to every block that ends it" (§8.1 point 11), and its one
    guard is `yields: every wait of the views holds a motion` (table-driven over point 11's rows) plus the state gate's
    hold balance (`puzzle` iff `loading(frame)`), with the first-puzzle e2e asserting `ui-state:waiting@puzzle` on the
    real App. Recommendation: record both invariants together in RULINGS ("a counted fallback is a defect"; "a wait
    with no hold is a defect: a new wait adds its row to point 11 and to the guard's table in the lane that opens it"),
    so a later wait (per-player's values wait, GM6c2's rows, E-P21 (a)) is a red test in its own lane. The counter
    (`stage: a ribbon or inventory target with no live control lands at the edge`, renamed in round 11) now also counts
    a cue whose every motion was skipped and a DOM-branch miss (O1).
    **Round 12 (the wait class recurs; critique_engine_r11 W1, routed here by its `:144`):** GM3b's state batch was the
    class's second path (after round 10's unshown frame), and it showed why round 11's guard could not catch it: a
    table-driven guard sees only the rows authors list. Resolved under RULINGS 135's form, with the guard made
    complete by a check: (1) **one batch site**, `held`, through which every visual batch passes (pin `yields: every
    batch goes through held`), so any picture change, now or later (GM3b, GM8a's levers, MR2's ambient states, a
    module's picture), holds while it loads by construction; (2) the await map `yields: every await of the views
    names its wait` (**retired in round 13**: it classified only an `await` whose operand is the request, in six
    roots, so a request consumed by `.then`, returned by a non-`async` method or started in another file passed it,
    critique_engine_r12 W1); (3) the common case removed at its source: a room's state images are resident while it is
    current (`state:<room>`, bytes in §6.4). Round 12 recommended recording the invariant and that a third path found
    by reading sends the await map back for a redesign. One cross-design note for `design-reconcile` (RULINGS 143): the
    preload holder family `state:*` joins `room:*` under design-shots' I-14 / QO16 eviction rule.
    **Round 13 (the map came back, as round 12 asked; RULINGS 148):** the orchestrator ruled the invariant at the
    request: **every request start is a declared site**. Its one guard is `requests: every request start is a declared
    site` (§8.1 point 11): a declaration-resolved walk over every non-test, non-generated file of `client/src` that
    fails any reference to a request port's member, any `import()` and any lib network start whose (file, function,
    member) has no `REQUEST_SITES` row, a view row naming its point-11 rows (each with its `WAIT_CASES` case) or
    another row with its reason; a scene load outside `app/game.ts` and `scene/**` fails in the same walk, so the
    views' image waits stay `held`'s. It claims exactly that: it does not see a timer or event wait (the countdown is
    the state gate's), the asset transport after its hand-off, or whether a view row names the right wait (the row's
    case and the cut's review do). No question remains for this class; `state:*` now follows `room:*`'s keep set
    (RULINGS 148 W2), so the `design-reconcile` note above covers one family rule for both.
    **Round 14 (critique_engine_r13 W1, m1):** the same guard now also sees the batch site by its declaration
    (`YieldsHost.apply`, every reference the one inside `held`), the asset transport by its type, and a guarded member
    re-typed at a value flow; it does not see a value that flows into `any`, a timer or event wait, a `.svelte` script
    beyond its names, or whether a view row names the right wait (§8.1 point 11). No new question for this class.
    **Reconcile r1 (critique_engine_r14 m2, m3; RULINGS 152):** "so the views' image waits stay `held`'s" above
    claimed more than the walk saw (a scene load wrapped by a new host member, a constrained generic, a widening then
    an assertion). The walk now also lists the host's promise-returning members (`HOST_WAITS`), compares a generic's
    constraint, fails a widening into a member-less type, and binds the batch site to `held`'s declaration; what it
    still does not see is stated as **B1** (an assertion out of a type parameter or `any`) and **B2** (a load reported
    by a callback), §8.1 point 11, each with no planned instance. No new question for this class.
    **Reconcile r2 (RC-W4):** the host-wait walk's reach is now exact (declarations in `client/src`'s `.ts` files, every
    function member's return type followed), pinned by a self-test on the tree's eight rows (**M-RCu**, **M-RCv**);
    what that reach leaves unseen is **B3** (a promise-returning member reached only through a type argument, an index
    signature or a declaration outside `client/src`'s `.ts` files), §8.1 point 11, with no instance on `cec347c` and no
    planned one. The frame-on-screen edge (RC-W5) is a void host member, no wait. No new question for this class.
    **Ruled: RULINGS 172** — accepted: the class invariant is recorded as recommended (a counted fallback is a defect at the cut).
14. **Two edges of the state batch's residency and hold (round 14; the critic's questions, critique_engine_r13
    `:268-270`).**
    (a) **The revive clause (m3).** RULINGS 148 m1 reads "none, no hold"; its premise was that such a batch loads
    nothing, which is false while a revive runs (`stage()` ensures every image id, `game.ts:711-716`, and a stale
    record waits for its re-upload, `registry.ts:356-377`, `:471-481`, up to 3,000 ms). The body takes the clause
    "and no revive running" (`held` checks `h.scene.stats().reviving`, holds at `centre`; GM3s, **M-R14j**).
    **Recommendation:** confirm it as the reading of 148 m1 (it restores the ruling's premise and keeps the class
    invariant "a wait with no hold is a defect"; cost ~1 line in the engine, 4.3 B).
    (b) **The admission order (m2 (b)).** A retained neighbour's state set is live before `roomShown` requests the
    current room's, and preload admission is first come under the 32 MiB steady cap (`registry.ts:337-343`), so where a
    room's keep set holds more than the room-set row bounds (`budget.ts:883`) a current-room state image can be refused
    while a neighbour's is kept. **Recommendation:** accept it: the refused image loads at the change at visible
    priority under the state batch's hold (the 48 MiB hard cap, every preload holder evicted first when needed), so
    the current room's picture always shows, after <= 0.24 s AVIF / 0.36 s WebP per image at 2 Mbit/s; it is
    requested again at the room's next `roomShown` (m2 (a), taken); the same first-come rule governs the neighbour bgs
    today (`controller.ts:163-166`). A preload priority (a refusal signal, or eviction of lower-priority preload
    holders for a current-room preload) is a change to `scene/{registry,preload}.ts`; if a budget-Android e2e ever
    shows the case, it is a MEMORY-PLAN lane after LHJ, not a mechanics lane.
    **Ruled (RULINGS 152; reconcile r1).** (a) Confirmed with the predicate `stats().stale === 0 &&
    !stats().reviving` (critique_engine_r14 m1: an aborted revive leaves stale records with `reviving` false); the
    body (§6.4, §8.1 `held`, §8.5) and GM3s's test carry it, M-R14j's fixture gains `{ reviving: false, stale: 1 }`, and
    **M-RCa** (round 14's `reviving`-only predicate) is red on it. (b) Accepted; the preload priority is **carried** as a
    MEMORY-PLAN lane in the `scene/*` tail after SH8 (SH5b is the last to edit `preload.ts`, SH6 `registry.ts`;
    §12 "Order and conflicts", the `scene/registry.ts` and `scene/preload.ts` rows), launched only if a budget-Android
    e2e shows the case; LHJ has merged (`972f773`), so its premise "after LHJ" is met.
15. **The entry ledger's return line (reconcile r1; RULINGS 140 / 142's L1 / L2).** With LFL merged (38,952 B,
    MEASURED, `lfl-first-line/test_r2.md:65`; RULINGS 155) and every planned entry addition of the three designs
    (GM3s +0.05, GM6s2 +0.09, GM6t +0.26, SH3a +0.10: CLAIM estimates), the entry projects to **39.45 / 40.0 KB br**,
    0.548 KB headroom, **0.048 KB above** L1 / L2's return line (headroom < 0.5 KB br; §11.1, ARITHMETIC). (Round 1's
    LFL row, 39,012 B, `test_r1.md:54`, gave 39.51 and 0.488, under the line; the merged code is round 2's.) The line
    is not crossed by the projection, so L1 stays carried, as RULINGS 142 rules; 48 B is ~11 source lines, so a
    single estimate error can cross it. Two named risks: GM3s's Svelte transition runtime (§3.5: a delta past +0.05 +
    0.5 is a STOP there) and SH3a's manifest decoders landing in the entry through `story/catalog.ts`, which is in the
    entry closure (`client/src/app/boot.ts:21`; +1.0 there would read 40.45, FAIL; §30 item 9). **What happens at the
    line:** every lane that adds entry bytes quotes the entry row at its cut (MEASURED base -> its estimate, plus the
    still-planned lanes' estimates); the first lane whose projection leaves < 0.5 KB br is a STOP at its cut, and L1
    (entry -1.75, first line +0.07, ARITHMETIC in RULINGS 140) returns as the next lane on its files and merges first,
    giving 37.70 (2.30 headroom; with L2's -0.48, 37.22); the stopped lane then resumes. `entryJsBr`
    (`client/scripts/budget.ts:106`, 40,000) is never raised for it. **Recommendation:** keep L1 carried; the orchestrator
    re-reads the row at GM3s's merge, the first build that measures the transition runtime.
    **Reconcile r2 (RC-m6, RC-W1):** GM3w's App expressions are booked (+0.01, bound +0.04 in its Gates) and per-player's
    entry term is unchanged (+0.35), so the projection is **39.46 / 40.0**, 0.538 headroom, **0.038 KB above** the line
    (39.49 and 0.508 at GM3w's bound); L1's -1.75 / +0.07 and L2's -0.48 are CLAIM on today's tree (measured on LEL's,
    RULINGS 140), so the with-L1 rows read 37.71 / 37.23. The two moments of a crossing, stated apart: at a lane's
    **cut**, a projection under 0.5 headroom is that lane's STOP and L1 lands first; at a lane's **build**, a MEASURED
    delta that brings the projection under 0.5 merges if it is under 40.0, L1 becomes the next lane on its files, and
    every later entry-adding lane's cut STOPs until L1 has merged; a delta past 40.0 is the lane's own STOP. The first
    lanes to watch: GM3w (bound +0.04) and GM3s (0.05 estimate: a measured delta above ~0.09 crosses).
    `entryJsBr` is `client/scripts/budget.ts:109` on `cec347c`. Recommendation unchanged.
    **Adoption (main `3c62a86`, docs-adopt):** §11.1 re-based on the measured bytes: first line 265.58 / 270.0, entry 39.50 / 40.0 (0.502 left), all JS 301.84 / 305.0 (re-set by GM7p, RULINGS 158), engine closure 226.08 / 230.0.
    **Ruled since: RULINGS 158** — L1 is unshelved (RULINGS 142's return condition: 38,988 B + 510 B = 39,498 B, 502 B left against the 500 B line, inside the build's own churn) as lane `l1-entry-summary` (`summaryOf` into `saves/summary.ts`; entry -1.59, first line +0.21, CLAIM at `cdca9d4`); L2 stays shelved. The cut/build crossing rule above stands for every later entry-adding lane, read against the row after L1 merges. Changed by RULINGS 159 (as of `9a83251`; docs lane `docs-errata-10`, group A): L1 merged `eec24fe`; entry 37,338 B MEASURED, 2,662 B left; first line 254,288 B MEASURED.
16. **All JS against its LIMIT (reconcile r1).** With LFL, the three designs' measured-base projection is **300.99 /
    305.0 KB br** (271,939 B MEASURED, `test_r2.md:69`, + 29.05 ARITHMETIC over CLAIM estimates) before EN's four
    puzzle-type chunks (GM7p, GM7g, GM8a, GM8b), each ~1.6 KB br by the measured `puzzle-type` chunk on main
    (`m3s-memory-half-paid/merge/build.log:95`; the new ones CLAIM): after two 304.19, after the third 305.79, so the
    third crosses 305.0 (ARITHMETIC, §11.1). The all-JS row bounds no download (each chunk loads with its puzzle; first line and
    entry are the load rows). **Recommendation:** GM7p's cut quotes the row; the orchestrator rules, before GM8a's cut,
    whether `allJsBr` (`budget.ts:114`) is re-set to the measured projection + 5 KB br with a RULINGS line (the
    architect's recommendation: yes, since the row bounds no download and each type chunk loads only with its
    puzzle); cutting a puzzle type is scope, the owner's, and is not offered. The row is never raised by a lane.
    **Reconcile r2 (RC-W1, RC-m5):** with per-player's +3.504 (its term table, the meta controller chunk included),
    EN's +13.44 and the shots' +12.75 (SH10's `scene` ids +0.5 on the cue-stage chunk), the projection is **301.63 /
    305.0** with LFL (271.939 + 29.694; 3.37 left), 304.83 after GM7p and GM7g (0.17 left) and **306.43 after GM8a**
    (FAIL, -1.43), 308.03 after GM8b; the third type chunk still crosses. Recommendation unchanged; the ruling is
    needed before GM8a's cut, and GM7g's cut quotes a 0.17 margin.
    **Adoption (main `3c62a86`, docs-adopt):** §11.1 re-based on the measured bytes: first line 265.58 / 270.0, entry 39.50 / 40.0 (0.502 left), all JS 301.84 / 305.0 (re-set by GM7p, RULINGS 158), engine closure 226.08 / 230.0.
    **Ruled: RULINGS 158** — `allJsBr` is re-set once, by GM7p (the `budget.ts` holder before GM7g in the one order), to GM7p's measured HEAD + the remaining planned puzzle-type chunks (GM7g, GM8a, GM8b at 1.6 KB br each, the measured `puzzle-type` chunk) + 5.0 KB br, rounded up to a whole KB; GM7p's cut quotes the arithmetic and the orchestrator confirms it in a RULINGS line at that cut; no other lane raises it (the row bounds no download).
    **Ruled since: RULINGS 201** — RULINGS 158's GM7p re-set is withdrawn: Ledger 3 (`allJsBr`) is re-set now, once, to **365.0 KB br** on the all-JS upper quartile at that ruling (lever X wrote it, `597dded`) [§11.1 Ledger 3](11-budgets-and-validation.md#111-the-shared-ledgers-reconcile-r1-r2-rulings-143-qo10-152-r4-153-155-design-shots-i-13).
