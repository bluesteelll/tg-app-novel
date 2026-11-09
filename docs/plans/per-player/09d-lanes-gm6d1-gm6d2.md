### GM6d1 `labels-scene` (client)

- **Goal.** §6.2-§6.4 on the scene side: `LabelsCommand`, label views on anchors, generated records, the canvas path,
  revive by redraw, rebind, holds outside the sweep, the label node, the change crossfade and the mask shimmer as an
  `AmbientSource` (r3 W3), counters, the debug hook's `labels()`. Nothing sends the command yet.
- **After** GM6a; the lane that lands the capped ambient loop in `render-loop.ts` (`addAmbient`, `setMode`, the cap,
  frozen; `characters.md` §6.3, MA1a in rev. 3); and the last animation lane on `scene/*` before it in the recorded
  chain `GM6a -> MD2 -> MA1a -> MA1b -> MA2 -> {GM6d1, MR1 -> MR2}` (`characters.md` §11.7 `:1544`, item 6
  `:1560-1562`: **after MA2**, one at a time with MR1 / MR2 in launch order; r3 W2: round 3's "after GM6a, MD2" admitted
  GM6d1 beside MA1b / MA2). `design-shots` re-sets those names (RULINGS 132); the invariants hold whatever they become:
  after the ambient loop exists, after the last chain lane holding `scene/{executor,controller,registry,loader}.ts`,
  never beside any lane holding `scene/*`. If no adopted design has landed the ambient loop by GM6d1's cut, the cut
  is BLOCKED (§6.3 "Dependency"). On the `game.ts` chain after GM6c3 (W4); never beside a lane holding `app/game.ts` /
  `app/game.test.ts`. **Reconcile P2 (shots I-2, I-7, I-8, I-9, §9.14), the adopted names:** after **SH7** (the loop:
  `addAmbient`, the cap, the modes, `setCovered`) and **SH8** (the last strict `scene/*` holder; the parallax drive and
  its depth list, R-S1), then one at a time with SH9, SH10, SH12a, SH12b by launch (`SH8 -> {GM6d1, SH9, SH10, SH12a,
  SH12b}`; reconcile r2, E-P26: and the carried preload-priority lane, RULINGS 152 Q14 (b), in the same fan-out); on `game.ts` `... -> SH7 -> GM6c2 -> GM6c3 -> GM6d1 -> GM9r`. A cut that finds SH8 merged without a depth
  list a label view can enter is STOP (R-S1). Reconcile r3 (E-P30): through SH8 -> SH7 -> SH3b this lane now also
  follows SH3b, transitively; no new edge and no new holder.
- **Lock (9):** `client/src/scene/executor.ts`, `client/src/scene/executor.test.ts`, `client/src/scene/controller.ts`,
  `client/src/scene/registry.ts`, `client/src/scene/registry.test.ts`, `client/src/scene/loader.ts`,
  `client/src/scene/loader.test.ts` (new), `client/src/app/game.ts` (the `DebugHook` gains `labels()`, `:353-359`,
  `:1650`; reconcile P4, on main `acc4e0d`: `DebugHook` `:412-419` beside `propRects` `:417`, its implementation
  beside `:1801`), `client/src/app/game.test.ts` (`FakeScene`'s `stats` literal gains `labels: 0, labelBytes: 0` and
  `debugLabels: () => []`, `:336-352`; on main: `liveBytes` `:341`, `debugPropRects` `:355`). The shot lanes before it
  hold `executor.ts` / `controller.ts`, so every `executor.ts:N` of this lane's text is re-located at its cut.
- **Commits (5):** (1) `registry: a generated record counts its bytes under the caps`, `registry: a generated record
  revives by redrawing` (red: `acquireGenerated` missing); (2) `loader: a label canvas is emptied after its upload`,
  `loader: a label texture is drawn at the tier resolution`; (3) `executor: a label follows its anchor through fade,
  crossfade and rebind`, `executor: a changed label crossfades` (the node fades, the sprite's alpha is written by the
  shimmer only), `executor: a masked label shimmers and reduced motion fades`, **`executor: a masked label draws frames
  with no batch running`** (r3 W3, the gate: the real `createRenderLoop` with MA1a's fake ticker, clock, timer and
  input, as the render-loop pins in `executor.test.ts` use; one masked label applied, the batch run to its end
  (`activeTimelines === 0`); then 1,000 ms of 60 Hz ticks: the loop's `frames` and `ambientFrames` grow by >= 0.8 x
  and <= 1 x `AMBIENT_FPS.AVERAGE` + 1, `activeTimelines` stays 0, `apply` has resolved, and the sprite took >= 3
  distinct alphas in [0.55, 1]; **seen red on round 3's form**, the mutation "a free `gsap.to(sprite alpha, { repeat:
  -1, yoyo: true })` outside `active` and no source": `frames` grows by 0), `executor: an unmasked label leaves the
  shimmer and the loop idles` (after the change crossfade ends, `labelLoops` 0 and the loop stops listening within one
  tick; seen red on the mutation "`continuous()` returns true always"), `executor: a frozen loop holds masked labels
  at alpha 1` (`setMode` frozen: alpha 1 and no ambient frame; replaces R-A8), `executor: rebind keeps the shimmer
  source and steps the new sprites` (`labelLoops` equal before and after; ambient frames keep growing and the new
  adapter's sprite receives the alphas), `executor: destroy removes the shimmer source` (a recording loop, `quietLoop()` wrapped so
  that `addAmbient` records the source and counts its remover's calls, passed through `harness(size, loop)`,
  `executor.test.ts:142`; a label masked before `destroy()`: the remover ran once and 1,000 ms of ticks after it draw no
  frame; seen red on the mutation "destroy skips the remover"). The other executor tests need no edit (r4 m4): their
  `quietLoop()` is the real `createRenderLoop` on a ticker that never ticks (`executor.test.ts:139-140`), which has
  `addAmbient` once the loop lane has merged, so they stay green by name. `executor: a label waits for its anchor`,
  `executor: a masked label waiting for its anchor draws no ambient frame` (r4 O1: a masked label whose anchor is not on
  stage; 1,000 ms of ticks draw no ambient frame and `labelLoops` reads 0; the anchor appears, the label attaches and
  the frames start; seen red on the mutation "`continuous()` counts waiting views"), `executor: a
  batch after a labels command keeps the label textures` (m8), `executor: a label stays on its anchor across a state
  image swap` (W7: a props command swaps the image at the same `at`; the label's parent and offset are unchanged),
  `executor: labels on two placements of one image stay apart` (W7); (4) `executor: a removed label's sprite is
  destroyed after its fade`, `executor: a labels command for another room fades the old room's labels`; **reconcile
  P2 (I-9; S14):** `executor: a label lives in its anchor's content node` (parent `content`; red: parent `anchor`),
  `executor: a bg label's depth node shifts by the grid depth at its rect centre` (SH8's drive at its amplitude: the
  label's global offset equals `par(n)` at the label's centre, within 0.25 source px of the plate pixel under it;
  red on the mutation **M-PR1l**, "the bg label rides the root's identity depth": offset 0; reconcile r2, m6, the
  fixture named: a room shot (`g0 = 0`) on a 540 x 1024 CSS px stage, so `s` = 0.5 CSS px per source px (cover of
  1080 x 2048), a depth grid whose value at the label's rect centre is **n = 0.5** (a mid-depth wall, not the far
  wall, which a room holds still, [shots §2.3 Rooms and zoom views](../shots/02-shot-model.md#23-rooms-and-zoom-views), M-SH8e), the drive at its amplitude c = (4, 3) CSS
  px: `par(0.5)` = (1 - 0) x 0.5 x (4, 3) / 0.5 = **(4, 3) source px**, |par| = 5 source px, 20 x the 0.25 tolerance
  (ARITHMETIC, `par(n) = (1 - g0) · n · c(t) / s`, [shots §5.6 Motion on baked figures](../shots/05a-runtime.md#56-motion-on-baked-figures-sh8-clientsrcscenewarpts-pure-vertex-math-the-mesh-only-in-controllerts)), so M-PR1l reads (0, 0) and fails by 5 source px; a
  second label at n = 0 asserts (0, 0) within 0.25, the far wall's stillness), `executor: a bg label
  leaves the depth list with its view`, `executor: a dissolve releases the old root's label holds at its swap` (the
  registry's holder count for `scene:label:#<n>` drops at the swap step right after the snapshot render, not at the
  tween end; **M-PR1f**, "the label holds are released at the transition's end", red with the holds still counted
  at the swap), `executor: a label on a new anchor fades in from the swap` (a hard cut to a room shot with a label:
  the label node's alpha is 0 at the cut frame and rises; its texture was acquired before the swap; red on the
  mutation "the label is acquired after the swap": a frame with the art and no label texture), `executor: the
  shimmer is held under a CG and under the puzzle frame` (a `'cg'` cover and a `'panel'` cover each stop
  `ambientFrames` while `labelLoops` stays 1; red on the mutation "the source declares `'top'`": frames grow under
  the CG); **reconcile r2 (W2, open question 1):** `executor: a labels command whose bg is not on stage attaches
  nothing` (the stage shows bg `cu_a`; `{ kind: 'labels', room: 'study', bg: 'study', labels: [a bg label] }`:
  `stats().labels === 0`, no `acquireGenerated` call; then `[{ bg: 'study', t: 'cut' }, the same labels command]`:
  one label view under study's root; red on revision 1's text and on **M-PR2a**, "the executor ignores
  `LabelsCommand.bg`": one label view under `cu_a`'s root), `executor: a cut drops the old room's labels from the
  model` (study shown with a bg label and a drawer label; a cut to `cu_a`, then a cut back to `study` with props and
  no labels command: `stats().labels === 0`; red on **M-PR2b**, "the model keeps a cut room's set waiting": two
  labels re-attach with their old texts), `executor: a bg label sits directly above the plate` (a root whose
  `content` holds the plate, a back ambient node and a back plane: the label's depth node is at index 1, below both;
  red on **M-PR2e**, "the label node is appended on top": index 3); (5) `scene:
  stats count labels, their bytes and their loops`, `game: the debug hook reports label rects` (red: TS2339
  `debugLabels`); **reconcile r3 (critique_perplayer_r2 W1), the labels job's premise:** `game: a tap while a step's
  batch loads completes it and starts no step` (`client/src/app/game.test.ts`'s `holdEnsure`, `:1639-1653` on
  `cec347c`: the next step's `ensure` held, a second `advance()` records `complete` on the fake scene and the runner
  takes no further step; after the release the held step's view is set; a pin, green on arrival (F2,
  `game.ts:1846-1848`) and labelled so, seen red on **M-PR3c**, "`present()` lets its intent end before `stage()`
  resolves" (expected red: no `complete`, a second step taken while the first loads; the tester's mutation run is the
  oracle, §14 Q16)). It sits in this lane because GM6d1 holds `game.test.ts` after the shot lanes that rework
  `present()` / `stage()` (SH1, SH5a, SH5b, SH7), and GM6d2, which relies on it, holds neither `game` file.
- **Gates:** check, test, build (engine ARITHMETIC **+0.52 KB br**, one figure (r3 m4): ~121 lines with the source
  and the label node; reconcile P2: + the bg label depth node with its list entry, the swap-point release and the
  entrance from the swap, ~7 lines, ARITHMETIC 7 x 4.3 B = 30.1 B, **+0.55 KB br**; reconcile r2: + the `bg`
  comparison and the cut's model drop (W2), the insertion index above the plate (open question 1), `debugLabels`'
  `alpha` / `anchor` (m5), ~3 lines, ARITHMETIC 3 x 4.3 B = 12.9 B, 0.5501 + 0.0129 = 0.563, **+0.56 KB br**; MEASURED;
  the first-line row quoted base -> HEAD at the cut against engine.md §11.1 with this file's terms, §10 "Ledgers"),
  e2e full (nothing visible changes; the rest predicates unchanged); mutations M-PR1f, M-PR1l, M-PR2a, M-PR2b,
  M-PR2e and the round's named ones seen red; reconcile r3: + the premise pin (test-only, 0 B; the figure stays
  **+0.56**), **M-PR3c** seen red.

### GM6d2 `labels-world` (client + story)

- **Goal.** §6.2, §6.5: the `labels` data module (`on: 'bg' | AnchorKey`, `states`, W7), its lints, **its texts in the
  one walk with role `read` and their reach** (round 6, r5 W1, R-E25), the room-set labels terms (E-P2), yields sending
  the command in room batches and visual batches with the per-state filter, the first label in ch1, the e2e with
  motion on.
- **After** GM6d1, GM6c4, GM3b (`visualsOf`, `PropView.at`, the visual batch), GM4 (views), GM4g (the transition pair),
  GM1b (`mechanics/data`, the lint registry), GM5f (the hotspot `when` that a label's reach reads), GM3c (R-E25's
  `MECHANIC_TEXTS` and walk), GM7p (`budget.ts`: engine.md §12's row M3c -> MD1 / GM3s -> GM4g -> GM7p -> GM6d2 -> MR2);
  `MECHANIC_TEXTS` sits in `client/scripts/story/mechanics/index.ts` (round 7, E-P16 (a)), whose row already orders
  this lane after every module lane, by launch, never beside; no lane of this file holds `mechanics/texts.ts`
  (engine.md's row: GM3c only, [engine §12 Order and conflicts](../engine/12f-order-and-conflicts.md#order-and-conflicts)).
  **Not** `client/scripts/story/values.ts` / `values.test.ts` (round 6, against the critic's "at least `values.ts`"):
  the rules read `role` / `reach` (GM6c1a), so a label is judged with no edit there; this lane's tests import
  `lintValueTexts`, they do not change it. **Reconcile P2 (shots I-2, I-3, I-11, I-18, §9.14):** `budget.ts` reads
  `M3c, LEL, LFL (merged) -> {SH3a, GM3s} -> SH3b -> GM4g -> GM7p -> GM6d2 -> SH12b` (reconcile r2, E-P26: engine.md
  §12's row with I-2's change; revision 1 read `M3c (merged) -> SH3a -> {SH3b, GM3s} -> ...`, and the older "M3c ->
  MD1 / GM3s -> GM4g -> GM7p -> GM6d2 -> MR2" above is the round-7 record), so SH3b's `img(n)` helper and its
  `LABELS_BOUND` exist at this cut (STOP if not); I-11's method exists in `yields.ts` as **`Yields.roomFor(bg):
  readonly VisualCommand[] | null`** (GM3b commit (2); reconcile r3, E-P29 (a): engine.md's reconcile r2 adopts
  R-E32, [engine GM3b `mech-state-visuals`](../engine/12c-lanes-gm3.md#gm3b-mech-state-visuals), and withdraws r1's `propsFor` placements), built by the one function that builds
  `roomBatch`'s state commands; STOP only if GM3b merged another shape) and SH5a's `withRoomProps` consumes it
  verbatim, so this lane appends the room's labels (with the room's `bg`) in that one function inside yields (and
  extends engine's `yields: roomFor equals the room batch's state commands`, M-RCaa, with a labelled room, E-P29 (a))
  and never edits `stage-route.ts`. **Reconcile r3 (W1), the labels job's premise, checked on the
  parent:** `scene.apply` is called only in `stage()` and every caller of `stage()` runs inside an intent and awaits it
  (`game.ts:722`, `:743`, `:788`, `:1379` on `cec347c`, re-located by symbol after the shot lanes' `present()` /
  `stage()` rework), with GM6d1's `game: a tap while a step's batch loads completes it and starts no step` green by
  name; a batch applied outside its intent is a STOP item (R-S3). The `story/ch1/world.json` edit adds
  the label and never touches `gate`, its `"closeup": null` or `manor_gate_forced` (I-18; a cut check on the diff).
  **Reconcile r2 (critique_perplayer_r1 open question 1; R-S2):** the cut also checks the label's room shot: no plane
  (back or front) `at` box and no cast member's `body` bounding box of its rig meets the label's rect (a code hidden
  by a pillar plane or a figure is a clue the art does not show); a meeting is a STOP item for the placement, settled
  by moving the rect (narrative designer). From SH12b on, R-S2's lint does this check for every label.
- **Lock (14; round 6 +1, r5 W1; round 7 -1, E-P16 (a)):** `client/src/mechanics/data/labels.ts` (new), `client/src/mechanics/data/index.ts`,
  `client/scripts/story/mechanics/labels.ts` (new, node-free: the rules, `LABEL_CODES`, `LABELS_LINT`, `LABELS_TEXTS:
  TextWalker<LabelsData>` with the reach of §6.2),
  `client/scripts/story/mechanics/labels.test.ts` (new, node project `scripts/**/*.test.ts`, `client/vite.config.ts:51`:
  commit 1's decode, lint and registration tests; round 5, found while resolving: round 4's lock named no file for
  them, and a new file keeps GM6d2 off engine.md's `world.test.ts` row), `client/scripts/story/mechanics/index.ts`
  (two lines: `LABELS_LINT` in `MECHANIC_LINTS` and `labels: LABELS_TEXTS` in `MECHANIC_TEXTS`, engine.md §3.2
  [engine §3.2 The two halves and the registries](../engine/03-module-contract.md#32-the-two-halves-and-the-registries) as read; the second forced by `tsc` as soon as `labels` joins `MECHANIC_DATA`, the same commit),
  `client/scripts/story/emit.ts` (label sizes in the usage rooms), `client/scripts/budget.ts`,
  `client/scripts/budget.test.ts`, `client/src/app/yields.ts`, `client/src/app/yields.test.ts`, `client/e2e/values.spec.ts`,
  `client/e2e/helpers.ts` (a `labels(page)` reader over the debug hook), `story/ch1/world.json`,
  `story/locales/en/ch1.json` (the label's en text).
- **Commits (5):** (1) decode + lints: `world: labels decode with strict keys`, `story: five labels in a room are
  refused`, `story: an anchor label outside its anchor is refused`, `story: a label on an unknown anchor is refused`
  (W7; a label `on` a `PropId` is refused the same way), `story: a label state the anchor lacks is refused` (W7),
  `story: a label whose rendered text exceeds 64 characters is refused` (m9), `story: two labels with one id in a room
  are refused`, `story: the label lint codes are registered once` (r4 W1; `LABEL_CODES` in `mechanics/labels.ts`;
  seen red on the mutation "the `LABELS_LINT` line removed"), `labels: mechanics/labels.ts imports no node module`
  (r5 m5); **round 6 (r5 W1), the texts:** `story: label texts are world lines with role read and their reach`
  (`worldLines` over a fixture world with a bg label and a drawer label: both IDs, `role: 'read'`, the paths
  `rooms.….labels.<i>.text`, reach `[{visited}]` and `[{all: [{visited}, {open}]}]`; red: TS2307 on the new module;
  then seen red on the mutation **M-P6b**, "`LABELS_TEXTS` returns `[]`"), `story: a placeholder typo in a label is
  refused` (`$code(drawr)` -> `world/placeholder` through `lintValueTexts`), `story: a label-only clue is accepted` (a
  bg label on a view room holds `$code(p)`, the clue `{visited: <view>}`, no other surface), `story: a label shown
  only in a listed state is a clue only through its state's condition` (the drawer label `states: ["open"]`: the
  clue `{all: [{visited: study}, {open: study.drawer}]}` accepted, `{visited: study}` refused with the accepted form in
  the message), `story: a label's en entry is checked, not an orphan` (`checkLocales` over the fixture's lines: no
  `loc/orphan-en`; the entry removed: `loc/missing-en`), `story: a label on a takeable prop is refused`, `story: a
  label state that draws nothing is refused` (round 6's two `world/label-anchor` refusals); (2) the room-set terms: `budget: room-set counts the labels of the room and of the transition pair's
  neighbour` (red: the row ignores labels; seen red on an oversized label set; reconcile P2, I-3: the terms sit beside
  SH3b's `img(n)`), **reconcile P2:** `budget: the step window's label bound equals the label lint's room bound`
  (SH3b's `LABELS_BOUND` against `labels.ts`'s 4 x 512 x 256 x 4; **M-PR1g**, the lint's width bound 512 -> 640, red);
  (3) yields: `yields: a room batch sends
  its labels after its props`, `yields: a value change re-sends the room's labels`, `yields: a label on a drawer shows
  only in its open state` (W7: a visual batch that opens the drawer carries the label, the one that closes it drops
  it), `yields: two labels on two placements of one image keep their anchors` (W7); **reconcile P2:** `yields: a value
  change on the current room applies its labels with no hold` (R-E33: the labels-only batch goes through `held` with
  `stateHold`'s `'no-load'`; the fake bus records no `ui-state:waiting` / `waited`; **M-PR1m**, "the labels-only batch
  passes `{ box: null }`", red with the pair recorded; reconcile r2, m1: the fixture's `FakeScene.stats()` reads
  `{ stale: 0, reviving: false }`, the only state in which `held` honours `'no-load'` (RULINGS 152; E-P28 (a)); a
  fixture with `stale > 0` would show engine's correct hold at `centre`, which is engine's M-R14j, not this test's),
  **reconcile r2 (W2):** `yields: a value change during a cut-away sends no labels` (room `study` with an `on: 'bg'`
  label holding `$code(drawer)`, the values fetch failed, so the label is masked; the fake scene's `snapshot()` reads
  `{ bg: 'study_cu_a', cg: null }`, a story cut inside a room event; Retry resolves with run 1 `1847`: `h.apply`
  records no batch; then `snapshot()` reads `{ bg: 'study' }` and I-11's method for `study` returns `[props, { kind:
  'labels', room: 'study', bg: 'study', labels: [the label with "1847"] }]`; red on revision 1's text and on
  **M-PR2c**, "the labels-only path drops its stage check": one `labels` command applied while `study_cu_a` is up),
  `yields: a value change under a CG over the room updates its labels` (`snapshot()` reads `{ bg: 'study', cg:
  'letter' }`: one labels-only batch with `bg: 'study'`; a pin, green on arrival and labelled so, seen red on
  **M-PR2d**, "the stage check also requires `cg === null`" (`takeBatch`'s clause): none), `yields: a room's commands for a story cut carry its labels`
  (I-11's method over the current section's room with a masked drawer label: `[props, labels]` in that order; R-E32;
  **M-PR1n**, "the method returns the props only", red with no `labels` command; reconcile r3: the method is
  `roomFor(bg)`, E-P29 (a)), and engine's `yields: roomFor equals the room batch's state commands` (GM3b's, in
  `yields.test.ts`) extended with a labelled room (E-P29 (a): the room entered by a move and asked by `roomFor`, a
  masked `on: 'bg'` label and a drawer label in its open state: the two lists deep-equal, the `labels` command
  included; M-RCaa then also fails on "`roomFor` omits the labels the room batch appends"); **reconcile r3 (critique_perplayer_r2 W1), the labels job:** the yields harness gains
  an option `intents: 'serial'` whose `tap` / `queue` follow `game.ts:473-491` and `:1413-1420` (on `cec347c`;
  `:474-492` and `:1414-1421` on `3c62a86`, reconcile r4) (one `busy`
  promise; `tap` while busy records `complete` and returns it; `queue` awaits it, then runs as the next intent;
  today's harness runs both at once, `yields.test.ts:260-261`) and `holdLoads` whose `apply` records a batch in
  `batches` at its call (call order, as today, `yields.test.ts:242`) and **applies** it, i.e. writes the fake stage
  and appends the batch to a second log **`applied`** (apply order; reconcile r4, critique_perplayer_r3 W1): at once
  when `imageIds(visual)` is empty (a `labels`-only batch: `stage()` reaches `scene.apply` with no await,
  `game.ts:718-723` on `3c62a86`), otherwise only at the test's `release()`, which applies every held batch in call
  order (as `stage()` awaits `scene.ensure` before `scene.apply`). `imageIds` is imported from `./game.ts`
  (`game.ts:333-348`, exported, the function `stage()` itself calls; a cut check: the harness imports it from
  wherever `stage()` takes it once the shot lanes have reworked `stage()`), so the harness's hold rule cannot drift
  from `stage()`'s; the rig returns `applied`, `release`, its `apply` and its `queue`. **Every assertion of the five tests
  below reads `applied`**: the fake stage carries no labels (`StagingSnapshot`, `yields.test.ts:180`, `:240-251`),
  so apply order is the only record of which text reached the art last (revision 3 read the call-order `batches`,
  on which test 2 could not be red). Tests: `yields: a value that lands while a room batch loads reaches the room's
  labels after it` (room `hall` on stage; the exit to `study`, whose `on: 'bg'` label holds `$code(drawer)`, the
  values fetch failed so the label is masked: the room batch `[bg, props, labels(masked)]` is recorded and held; Retry
  (the prompt's action, the store's `retry()`, §5.4: a store call, not an intent, so the serial `tap` cannot swallow
  it) resolves run 1 `1847`; `applied` gains nothing while the stage shows `hall`; `release()`, `settle()`: `applied`
  holds the room batch, then one labels-only batch with `bg: 'study'` and the label `1847`, `masked: false`, the last
  `labels` command applied; red on revision 2's text and on **M-PR3a**, "the store-change producer runs at the
  change, not through `h.queue`": the room batch's masked label is the last applied), `yields: a value that lands
  while a batch for the room on stage loads is not undone by it` (the values request held pending by the fake
  `getValues` since `chapterEntered`, so `$code(drawer)` renders masked and no prompt is up; the drawer label
  `states: ['open']`; `study` entered by its room batch, released, `settle()`; a mark on `applied`; a tap opens the
  drawer: its visual batch `[props(open image), labels(drawer label masked)]` is held by its open image; the test
  resolves the values request, run 1 `1847`; `settle()`, `release()`, `settle()`: the drawer label's texts in the
  `labels` commands for `study` that `applied` gains after the mark are exactly `[masked, '1847']` (the visual batch's,
  then the job's labels-only batch), so the code is the last text applied and no code is applied before the mask;
  red on revision 2's text and on **M-PR3a**: `['1847', masked]` (the producer sends at the change while the fake
  stage still shows `study`, and the held batch's mask applies at `release()`); on **M-PR4b**, "the producer sends at
  once while the stage shows the room's bg and queues the job only otherwise" (critique_perplayer_r3 W1 (b)):
  `['1847', masked]`; on **M-PR4a**, "revision 2's synchronous send kept beside the job" (§6.2's rejected (e)):
  `['1847', masked, '1847']`, the value -> mask -> value flicker; a different red, `[masked]` alone, means the job sent
  nothing after the tap's intent: its stage check failed (the fake stage written at the call, or its bg not `study`)
  or `labelsDue` missed the drawer), `yields: two values that land during one load leave the newest on the art`
  (during one held room batch: Retry's body run 1 `1847`, then an `activated` body run 2 `5203`; after `release()`,
  `settle()`: `applied` holds the room batch, then exactly one labels-only batch, carrying `5203`; red on **M-PR3b**,
  "the job renders the room's labels when it is queued": `1847`), `yields: a value that lands while a story cut back
  to the room loads reaches its labels after it` (the fake stage shows `study_cu_a`, a bg batch applied and released
  before; the test plays `present()`'s part inside a serial intent opened through the rig's `queue`: it builds
  `[bg(study), ...y.roomFor('study')]`, as SH5a's `withRoomProps` does inside `stage()`, and passes it to the rig's
  `apply`, so it is held by its `bg` image and logged in `applied` at its release like any batch; the values land;
  `release()`, the intent's end, `settle()`: the last `labels` command for `study` in `applied` carries the code; red
  on revision 2's text and on **M-PR3a**: the cut back's mask is the last applied), `yields: a labels job queued
  before dispose applies nothing` (a held room batch, a store change, `dispose()`, `release()`, `settle()`: `applied`
  holds the room batch and no labels-only batch after it; red on **M-PR3d**, "the job does not check `dead`": one
  labels-only batch after the teardown); (4) the story label (narrative-designer): one label holding
  `$code(drawer)` on a view room of the manor section (GM4's demo view), declared as a second clue of the drawer in its
  `clues` (`{visited: <view>}`, the label's reach), and its en entry in `story/locales/en/ch1.json`; placement within
  the lints, look per OQ7. `npm run story` 0 errors (predicted red with **M-P6b** re-applied: `loc/orphan-en` for the
  label's ID, `story/locales/en/ch1.json`, `locales.ts:196-199`, which is the critic's defect, **and** engine.md's
  `world/text-unwalked` at the label's `text` in `story/ch1/world.json` (its `{ id, ru }` under `w.mods.labels` is
  no walked line, engine.md §3.2 [engine §3.2 The two halves and the registries](../engine/03-module-contract.md#32-the-two-halves-and-the-registries) as read; round 7, E-P16 (b)); both reds mean "the label's texts are not
  walked"; a different red, e.g. `loc/missing-en`, means the entry was not written); (5) e2e: `values: a label on a view moves with its anchor through the zoom and
  shows the code` (reconcile r2, m5; revision 1's name `values: a label on a view rides the zoom and shows the code`;
  motion on, no freeze: from the tap to rest, `labels(page)` sampled every animation frame; at every sample that
  reports the label, its rect lies inside its `anchor` box and its offset and size relative to that box equal the
  canonical rect's within 1 CSS px; its `alpha` (the node's world alpha, which the shimmer never writes) is below 0.1
  at its first sample and never falls before rest (it fades in, never pops); at rest the text is the code and the rect is the canonical rect
  under `cover()` within 1 CSS px. The predicate holds under GM4's crossfade, where the view's bg anchor scales from
  the `via` rect with the label inside it, and under SH10's camera push into `via` plus a dissolve, where the label
  enters with the view's root from the swap (shots I-5), so SH10's `e2e full` cannot turn it red), `values: a label survives a hard context loss` (`debugForceContextLoss('hard')`,
  `activated`, the same text, `labelBytes` > 0, then 0 after leaving the room), `values: a masked label shimmers
  between batches` (r3 W3: the values route aborted, the view entered, the loop switched live through the animation
  design's debug switch (`setAnimation('live')`, `characters.md` §6.4; reconcile P2: the shots design's
  `__novelDebug.setAnimation('live')`, [shots §5.10 deactivated, reduced motion, e2e freeze, failure states](../shots/05b-preload-memory-download.md#510-deactivated-reduced-motion-e2e-freeze-failure-states), §5.10), `activeTimelines === 0`: two reads of the
  loop's `ambientFrames` 1 s apart differ and `labelLoops === 1`; then Retry: `labelLoops === 0`; the frozen default
  keeps every other spec's pixels unchanged).
- **Gates:** check, test, story, build (engine row MEASURED; ARITHMETIC **+0.15 KB br**, one figure, §10; r4 m4; the
  texts are build-only, 0 runtime bytes; the new room-set terms seen red; reconcile P2: + the labels-only batch's
  `held` call and the labels in I-11's method, ~3 lines, ARITHMETIC 13 B, **+0.16 KB br**; reconcile r2 (W2): + the
  labels-only path's stage check and the command's `bg` field, ~2 lines, ARITHMETIC 2 x 4.3 B = 8.6 B, 0.163 + 0.0086
  = 0.1716, **+0.17 KB br**; reconcile r3 (W1): + the labels job (the pending flag and the `labelsDue` set, the
  `h.queue` call, the job's head with the `dead` check and the set's intersection with the room's label puzzles,
  replacing revision 2's one direct call), ~4 lines net, ARITHMETIC 4 x 4.3 B = 17.2 B, 0.1716 + 0.0172 = 0.1888,
  **+0.19 KB br**; the first-line row quoted base -> HEAD at the cut against engine.md §11.1 with this
  file's terms, §10 "Ledgers"; M-PR1g, M-PR1m, M-PR1n, M-PR2c, M-PR2d, M-PR3a, M-PR3b, M-PR3d, M-PR4a, M-PR4b seen
  red; reconcile r4 (critique_perplayer_r3 W1): the five labels-job tests read the harness's applied-order log,
  test-only, 0 B, the figure stays **+0.19**), e2e full; pins (r4 W1): `dsl-doc: lint table
  equals lint codes` green and untouched, `story: module and type lint codes are unique and none is a DSL code` green
  over `LABEL_CODES`, engine.md's `mechanics: every module declares its texts` green with `labels` (R-E25), and
  engine.md's `world/text-unwalked` silent over the real ch1 world with its label (E-P16 (b)); reconcile r3: engine's
  `yields: roomFor equals the room batch's state commands` (M-RCaa) green by name with its labelled-room case (commit
  3), and GM3p's `requests: the host-wait walk's reach on the tree is the HOST_WAITS rows` green by name (the job adds a
  `queue` call, no host member; E-P29 (d)).
  14 files, 5 commits.
