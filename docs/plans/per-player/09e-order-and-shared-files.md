### Order

**Round 4 (r3 W2; RULINGS 132).** The animation lanes below are `characters.md` rev. 3's (§11.7, `:1543-1550`), the
last recorded order of the character chain; RULINGS 132 stopped that design and `design-shots` re-sets its lanes and
names. This file therefore states, per shared file, **the invariant** it needs from whatever animation or shot lanes
are adopted, and mirrors rev. 3's rows as their current instance. Until engine.md §12 carries the adopted rows (R-E19),
a cut treats every lane of an adopted animation or shot design that holds a file of its lock as a predecessor or a
never-beside, and an unordered one as a STOP item.

**Reconcile revision 1 (P2; shots I-2, §9.14, the adopted design's rows, RULINGS 143).** The shot lanes are the
adopted instance of every "animation / shot" placeholder below; the rows marked `reconcile:` replace rev. 3's
instance, and the invariants stand. M3s is merged (`a5f887b`, RULINGS 151), so the server slot has no outside holder.
**Reconcile revision 2 (critique_perplayer_r1 m4; E-P26):** the rows mirror engine.md §12 as now written (LHJ and
the preload-priority lane on `scene/*`, LBI / LFL / LRB on `game.ts`, `game.test.ts` as its own row, `budget.ts`
with I-2's change, `App.svelte`); the rev. 3 rows (the pre-M3s server slot, `scene/*` and `game.ts` with MD2 / MA1a /
MA1b / MA2) are struck and quoted in §27. One row differs on purpose and is stricter: `requests.test.ts` never beside
(R-E35); a cut that follows it complies with engine.md's row too, so it is no STOP item under §14 Q13.

```
reconcile:    server slot: (LRF, M3s merged) GM6k -> GM6s1 -> GM6s2 (the entry lever LEL merged, RULINGS 141)
reconcile r2: (E-P26, engine.md §12 "Order and conflicts" engine §12 Order and conflicts owns every row below; mirrored)
reconcile:    scene/*: M3c, LHJ (merged) -> GM2a's field -> GM6a -> SH1 -> SH4 -> SH5a -> SH5b -> SH6 -> SH7 -> SH8 ->
              {GM6d1, SH9, SH10, SH12a, SH12b, the carried preload-priority lane} one at a time by launch (GM6a before
              SH4 and every shot lane; GM6d1 after SH7's loop and SH8)
reconcile:    game.ts: LBI, LFL (merged) -> LRB (in flight, RULINGS 156) -> GM2a -> GM3w -> SH1 -> SH5a -> SH5b -> SH7 ->
              GM6c2 -> GM6c3 -> GM6d1 -> GM9r, one at a time
reconcile:    game.test.ts: LEL, LBI, LFL (merged) -> LRB (in flight) -> the game.ts row's holders that test it, in that
              row's order -> SH12a
reconcile:    requests.test.ts (new by GM3p): GM3p -> {GM6c2, SH7, every later lane that adds a start or a HOST_WAITS
              row} by launch, never beside (engine.md §12's row allows "disjoint rows may run beside"; this file keeps
              the stricter reading, which satisfies that row too, and R-E35 asks engine.md to drop the clause)
reconcile:    budget.ts / budget.test.ts: M3c, LEL, LFL (merged) -> {SH3a, GM3s} by launch, never beside -> SH3b -> GM4g
              -> GM7p -> GM6d2 -> SH12b (I-2 as engine.md adopts it, with its one change)
reconcile:    build.test.ts: GM1d -> GM2b -> GM3b -> GM4g -> GM8a -> GM8b; GM6c1a, GM6c1b by launch, never beside ->
              SH12a;  explore/controller.ts: GM1a -> GM3 (test) -> GM3b -> GM4 -> GM8i -> GM6c4 -> SH9
reconcile:    story/ch1/world.json: GM1d -> GM3b -> GM4u -> GM9r -> GM6c4 -> GM6d2, each holder's cut checking I-18
              (`gate`'s "closeup": null `:43`, its onFail manor_gate_forced `:89`; SH11 reads, no SH lane edits it);
              story.ts: SH2 never beside GM6c1a / GM6c1b;  App.svelte: GM3w -> GM3s -> GM6t
reconcile:    api/meta.ts: LEL (merged) -> GM6s2 (META_KINDS' value_changed row)
world chain:  ... GM1c -> GM1d -> GM2b -> ... -> GM4 -> GM6c1a (after GM6s2) -> GM6c1b (after GM6k) -> ...
lint codes:   no lane of this file holds lint.ts (round 5, r4 W1, E-P13): lint.ts is GM1d's one hunk, then SH12b's
              (reconcile r2, E-P26: was "A(lint.ts) never beside it"). GM6c1a -> GM6c1b -> GM6d2 each add one
              line to scripts/story/mechanics/index.ts (engine.md §12's row, every module lane by launch, never
              beside); GM6c1a and GM6c1b each add one call to
              client/scripts/story.ts (with GM9p's cross-chapter pass; by launch, never beside); GM6c1b holds
              mechanics/core.ts after GM2b and world.test.ts by launch against GM9p (R-E23)
world texts:  (round 6, r5 W1, R-E25; round 7, E-P16 (a), (e)) GM3c lands the walk (scripts/story/world.ts), the
              types and world/text-unwalked (scripts/story/mechanics/texts.ts, GM3c only) and MECHANIC_TEXTS
              (scripts/story/mechanics/index.ts); every later module lane with texts adds its line there in world-chain
              order; GM6c1a after GM3c (it reads the roles; BLOCKED at its cut without them); GM6d2 adds `labels` by
              launch, never beside a module lane (the index.ts row); no lane of this file holds world.ts or texts.ts
runtime:      GM6c2 (after GM6c1a, GM6s2, GM3m, GM3p, and the game.ts chain) -> GM6c3 -> GM6c4 (after GM6c1b, GM6t)
              -> GM6d2 (after GM6d1, GM3b, GM4, GM4g, GM7p); GM6c2 and GM8h by launch, never beside, and the later wires
              E-P12 (GM6c2 commit 6 or R-E24)
overlay:      GM6t (after GM3m with R-E18, GM3s, the entry lever; before GM6c4)
```
Cited in the block above: [engine §12 Order and conflicts](../engine/12f-order-and-conflicts.md#order-and-conflicts).

Until GM6d2, per-player codes show in documents, item descriptions, ink lines, choices and the tier-3 hint (synthesis
§6.4 item 4), which needs no label on the art.

### Shared files (W4, m9)

**Reconcile revision 1 (P2, P4):** the "Order" block's `reconcile:` rows replace the A(f) / rev. 3 instances in the
rows below (`client/src/app/game.ts`, `client/src/scene/*`, `client/scripts/budget.ts`, `build.test.ts`,
`explore/controller.ts`, `story/ch1/world.json`), as shots I-2 asks engine.md §12 to adopt them; two rows are new:
`client/src/requests.test.ts` (GM3p -> ... -> **GM6c2**, engine.md §12 owns it) and `client/src/api/meta.ts` (LEL,
merged -> **GM6s2**); the `client/src/api/*` row's "entry lever" is merged (LEL, RULINGS 141). **Reconcile
revision 2 (m4, E-P26):** the replacement is now made in the table body itself: the rows of `game.ts` (split into
`game.ts` and `game.test.ts`), `scene/*`, `emit.ts`, `build.test.ts`, `lint.ts`, `story.ts`, `explore/controller.ts`,
`budget.ts`, `story/ch1/world.json` and `api/*` read engine.md §12 as written in its reconcile revision 1
([engine §12 Order and conflicts](../engine/12f-order-and-conflicts.md#order-and-conflicts)), the rows `requests.test.ts` and `api/meta.ts` are added, and every superseded text is
quoted in §27. The `engine.md:N` cites of the older rows (round 6 numbers) are kept where the row is unchanged and are
re-located at each cut.

**One owner per row (m9).** For every file that lanes of both designs hold, **engine.md §12's "Order and conflicts"
table owns the order**; the rows below mirror its **round-6** table as read on 2026-11-03 ([engine §12 Order and conflicts](../engine/12f-order-and-conflicts.md#order-and-conflicts), with
R-E16, R-E19, R-E23 and R-E25 applied there: A(f) for the animation / shot holders, rev. 3's names as the recorded
instance, E-P14; round 6, r5 m4, E-P15 (b); round 7, E-P16 (e)) with this file's lanes in bold; every `engine.md:N`
here is as read in round 7 and re-located at each cut (m2). A disagreement is settled by engine.md's row and fixed
here, **except a row engine.md has not yet applied from a request of this file** (round 7: none; R-E25's two rows
are applied, [engine §12 Order and conflicts](../engine/12f-order-and-conflicts.md#order-and-conflicts), [engine §12 Order and conflicts](../engine/12f-order-and-conflicts.md#order-and-conflicts)): such a row would hold as written here until engine.md applies it. A cut that finds
the two tables differing on any file of its lock stops and asks the orchestrator (r4 m3; the STOP rule of "Order";
§14 Q13). Files only this file's lanes hold are owned here.

| File | Holders in order (this file's lanes in bold) |
|---|---|
| `client/src/app/yields.ts`, `yields.test.ts` | engine.md §12 ([engine §12 Order and conflicts](../engine/12f-order-and-conflicts.md#order-and-conflicts)): GM1a -> GM2a -> GM3w (`yields.ts` only) -> GM3s -> GM3 -> GM3u -> GM3p -> GM3b -> GM4 -> GM4u -> GM5 -> GM7r -> GM8h -> GM9r; **GM6c2**, **GM6c4**, **GM6d2** by launch, never beside one of these; the later of **GM6c2** / GM8h wires E-P12; the later of **GM6c2** / GM7r wires the countdown zero's non-posting branch to `settle` (round 7, R-E27 (d)); every `session.attempt()` site goes through GM3p's `post(o)` from GM3p on (GM7r / GM8h call it from their first commit; GM6c2 adds `o.trying = true` inside it; round 9, E-P18 (b): R-E28 accepted with GM3p as the lander, [engine §14.2 Answers to per-player.md §12](../engine/14-interface-requests.md#142-answers-to-per-playermd-12) as read, so round 8's "the later lane routes it" and its STOP rule lapse; pin `yields: every attempt starts through post`) |
| `client/src/app/game.ts` | engine.md §12 ([engine §12 Order and conflicts](../engine/12f-order-and-conflicts.md#order-and-conflicts)): LBI, LFL (merged) -> LRB (in flight, RULINGS 156) -> GM2a -> GM3w -> SH1 -> SH5a -> SH5b -> SH7 -> **GM6c2** -> **GM6c3** -> **GM6d1** -> GM9r, one at a time (reconcile r2) |
| `client/src/app/game.test.ts` | engine.md §12 ([engine §12 Order and conflicts](../engine/12f-order-and-conflicts.md#order-and-conflicts)): LEL, LBI, LFL (merged) -> LRB (in flight) -> the `game.ts` row's holders that test it (**GM6c2**, **GM6c3**, **GM6d1** among them), in that row's order -> SH12a (reconcile r2) |
| `client/src/puzzles/session.ts`, `session.test.ts` | engine.md §12: GM1c -> GM7r -> GM7g (test) -> GM8h; **GM6c2** never beside GM7r / GM7g / GM8h (E-P10) |
| `client/src/scene/*` | engine.md §12 ([engine §12 Order and conflicts](../engine/12f-order-and-conflicts.md#order-and-conflicts)): M3c, LHJ (merged) -> GM2a's field -> **GM6a** -> SH1 -> SH4 -> SH5a -> SH5b -> SH6 -> SH7 -> SH8 -> {**GM6d1**, SH9, SH10, SH12a, SH12b, the carried preload-priority lane} one at a time by launch; no `scene/*` lane beside another (reconcile r2) |
| `client/src/world/{types,decode}.ts`, `decode.test.ts` | engine.md §12 ([engine §12 Order and conflicts](../engine/12f-order-and-conflicts.md#order-and-conflicts)): GM1c -> GM1d -> GM2b -> GM3c -> **GM6c1a** |
| `client/scripts/story/world.ts` (round 6, R-E25; round 7, E-P16 (d), (e)) | engine.md §12 ([engine §12 Order and conflicts](../engine/12f-order-and-conflicts.md#order-and-conflicts)): GM1a -> GM1b -> GM1c -> GM2b -> GM3c (`WorldTextLine`, the walk over `MECHANIC_TEXTS`); **no lane of this file**, no later lane of either design |
| `client/scripts/story/mechanics/texts.ts` (round 6, R-E25, new; round 7, E-P16 (a), (e)) | engine.md §12 ([engine §12 Order and conflicts](../engine/12f-order-and-conflicts.md#order-and-conflicts)): GM3c only (the types, `KERNEL_TEXT_ROLES`, `TEXTS_LINT`); later lanes import its types; **no lane of this file** (round 6 put GM6d2 here: `MECHANIC_TEXTS` moved to `mechanics/index.ts`) |
| `client/scripts/story/emit.ts` | engine.md §12 ([engine §12 Order and conflicts](../engine/12f-order-and-conflicts.md#order-and-conflicts)): GM2b -> GM3b -> GM4g -> GM4 -> **GM6c1a** -> **GM6c1b** -> **GM6d2**; no SH lane holds it (shots §9.14; reconcile r2) |
| `client/scripts/story/build.test.ts` | engine.md §12 ([engine §12 Order and conflicts](../engine/12f-order-and-conflicts.md#order-and-conflicts)): GM1d -> GM2b -> GM3b -> GM4g -> GM8a -> GM8b; **GM6c1a**, **GM6c1b** by launch, never beside -> SH12a (reconcile r2) |
| `client/scripts/story/mechanics/index.ts` | engine.md §12 ([engine §12 Order and conflicts](../engine/12f-order-and-conflicts.md#order-and-conflicts)): every module lane in world-chain order (one `MECHANIC_LINTS` line each and, from GM3c on, one `MECHANIC_TEXTS` line each, `null` for a module without texts; GM3c adds `core: null` and the `TEXTS_LINT` line); **GM6c1a** (`VALUES_LINT` and, round 6, `VALUE_TEXTS_LINT`, after GM1d) -> **GM6c1b** (`KEY_LINT`, a `runsFrom: 'story'` entry; R-E23 applied) -> **GM6d2** (`LABELS_LINT` and, round 7, `labels: LABELS_TEXTS`), each by launch, never beside a module lane |
| `client/scripts/story/mechanics/core.ts` | engine.md §12 ([engine §12 Order and conflicts](../engine/12f-order-and-conflicts.md#order-and-conflicts)): GM1b (new) -> GM2b (the four `renamed` codes) -> **GM6c1b** (the lift of `world/renamed-puzzles`, E-P13) |
| `client/src/mechanics/data/index.ts` | engine.md §12: GM1b -> GM3c -> GM3 -> GM3b -> GM4 -> GM5 -> GM5f -> GM8i -> GM9p -> **GM6d2** |
| `client/scripts/story/lint.ts` | engine.md §12 ([engine §12 Order and conflicts](../engine/12f-order-and-conflicts.md#order-and-conflicts)): **GM1d** (one hunk, `Finding.code`) -> SH12b (the one-line removal of `budget/knot-set`); **no lane of this file** (R-E23 applied; reconcile r2) |
| `client/scripts/story.ts` | engine.md §12 ([engine §12 Order and conflicts](../engine/12f-order-and-conflicts.md#order-and-conflicts), R-E23 applied): GM1d only if its verify item finds a `Finding.code` reader there, then GM9p (the carry cross-chapter pass); **GM6c1a** (`lintValueTexts`), **GM6c1b** (`lintPuzzleKeys`, the flags), by launch, never beside GM9p; GM6c1a -> GM6c1b (this file's order); SH2 never beside GM1d, GM2b, GM3c, GM9p, **GM6c1a**, **GM6c1b** (reconcile r2) |
| `client/scripts/story/world.test.ts` | engine.md §12 ([engine §12 Order and conflicts](../engine/12f-order-and-conflicts.md#order-and-conflicts)): GM1d -> GM2b -> GM3c (round 6: the walk's tests; E-P16 (e)) -> GM9p; **GM6c1b** by launch, never beside (R-E23 applied) |
| `client/scripts/story/values.ts`, `client/scripts/story/values.test.ts` | **GM6c1a** (new) -> **GM6c4** (the lift); no later lane (round 6: GM6d2 imports, never edits) |
| `client/src/explore/reconcile.ts`, `explore.test.ts` | engine.md §12 ([engine §12 Order and conflicts](../engine/12f-order-and-conflicts.md#order-and-conflicts)): GM1a -> GM1b -> GM2a -> GM2b -> GM3 (test) -> GM5q (test, when it runs) -> GM5f; **GM6c1b** never beside (round 6, r5 m4: + GM5q) |
| `client/src/explore/controller.ts`, `controller.test.ts` | engine.md §12 ([engine §12 Order and conflicts](../engine/12f-order-and-conflicts.md#order-and-conflicts)): GM1a -> GM3 (test) -> GM3b -> GM4 -> GM8i -> **GM6c4** -> SH9 (design-shots I-16: `shotImages` in the neighbour preload, one hunk; never beside; reconcile r2) |
| `client/src/ui/explore/ExploreView.svelte`, `explore.svelte.test.ts` | engine.md §12: GM3w -> GM3s -> GM3u -> GM4u -> GM5 -> GM8h -> **GM6c4** (E-P10 adds GM8h) |
| `client/src/ui/explore-view.svelte.ts`, the other `ui/explore/**` files | engine.md §12: GM3w -> GM3s -> GM3u -> GM4u -> GM5 -> **GM6c4** |
| `client/scripts/budget.ts`, `budget.test.ts` | engine.md §12 ([engine §12 Order and conflicts](../engine/12f-order-and-conflicts.md#order-and-conflicts)): M3c, LEL, LFL (merged) -> {SH3a, GM3s} by launch, never beside -> SH3b (the sheet helper, `LABELS_BOUND`) -> GM4g -> GM7p -> **GM6d2** -> SH12b (`knotRows`, never beside) (reconcile r2; design-shots I-2 with engine.md's one change) |
| `story/ch1/world.json` | engine.md §12 ([engine §12 Order and conflicts](../engine/12f-order-and-conflicts.md#order-and-conflicts)): GM1d -> GM3b -> GM4u -> GM9r -> **GM6c4** -> **GM6d2**, one at a time; every holder's cut checks design-shots I-18 (`gate`'s `"closeup": null`, `:43`; its `onFail` `manor_gate_forced`, `:89`); SH11 reads it, no SH lane edits it (reconcile r2) |
| `story/locales/en/ch1.json` (round 6, r5 m4) | engine.md §12 ([engine §12 Order and conflicts](../engine/12f-order-and-conflicts.md#order-and-conflicts)): GM4u (the demo view's title and labels) -> GM9r (the carried item's texts) -> **GM6c4** (the drawer's clue and hints) -> **GM6d2** (the label's en), by launch, never beside |
| `client/src/ui/state.svelte.ts` | engine.md §12: GM3s (one field and the slot types); **GM6c3** by launch |
| `client/src/ui/App.svelte` | engine.md §12: GM3w -> GM3s; then **GM6t** (one prop) |
| `client/src/i18n/{ru,en}.ts` | engine.md §12 ([engine §12 Order and conflicts](../engine/12f-order-and-conflicts.md#order-and-conflicts)): none; **no lane of this file** from round 4 (GM6c2's strings live in `i18n/values.ts`, r3 W1; R-E19 applied) |
| `client/src/i18n/values.ts` | **GM6c2** (new) |
| `client/e2e/helpers.ts` | engine.md §12 ([engine §12 Order and conflicts](../engine/12f-order-and-conflicts.md#order-and-conflicts)): GM2a (body literals) -> GM8d; **GM6c4** -> **GM6d2** by launch, never beside |
| `client/e2e/values.spec.ts` | **GM6c4** -> **GM6d2**; no SH lane edits it, and SH10's `e2e full` runs it: GM6d2's zoom predicate holds under GM4's scaling zoom and SH10's push + dissolve (reconcile r2, m5), so the two lanes need no order on this file |
| `client/src/ui/typewriter.ts`, `ui/{DialogueBox,Choices,Backlog}.svelte` | **GM6c3**; an overlay half's lanes by launch, if one is ruled (orchestrator Q6) |
| `client/src/ui/Toast.svelte`, `ui/screens.svelte.test.ts`, `ui/toast-motion.ts` | **GM6t** |
| `client/src/api/*` (generated `api.ts`, `decode.ts`, `endpoints.ts`, their tests and fixtures) | LEL (merged `7b37278`, RULINGS 141) -> **GM6s2**; LRB (in flight) leaves `client/src/api/**` untouched (`lrb-reload-bounds/spec.md:54`, critique_perplayer_r1) (reconcile r2) |
| `client/src/api/meta.ts` | LEL (merged) -> **GM6s2** (`META_KINDS`' `value_changed` row; reconcile r1, listed as a row in r2) |
| `client/src/requests.test.ts` (new by GM3p) | engine.md §12 ([engine §12 Order and conflicts](../engine/12f-order-and-conflicts.md#order-and-conflicts)): GM3p -> {**GM6c2** (E-P23 (a)), SH7 (its `scene/motion/` `import()` row, if GM3p has merged), every later lane that adds a start or a `HOST_WAITS` row} by launch; **this file: never beside** (engine.md's "disjoint rows may run beside" is not taken: the lane rule is never two lanes on one file at once; R-E35) |
| `server/src/content.rs`, `server/tests/it/content.rs` | M3s by launch, never beside **GM6k** -> **GM6s1** (`it/content.rs` only if touched) -> **GM6s2** |
| `server/src/db/puzzles.rs`, `puzzles/mod.rs`, `api/puzzles.rs` | **GM6k** -> **GM6s1** -> **GM6s2** |
| `server/tests/it/refunds.rs`, `db/economy.rs`, `api/cards.rs` | LRF (merged `a93fe54`) -> **GM6k** |
