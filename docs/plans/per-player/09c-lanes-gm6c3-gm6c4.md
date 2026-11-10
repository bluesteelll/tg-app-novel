### GM6c3 `values-ink-text` (client, overlay)

- **Goal.** §5.3's ink rows and the value motion: `runs` on `LineView` / `ChoiceView` / `BacklogLine`, `LineView.reveal`,
  `Typewriter.retext` and its run writer, `ValueText.svelte`, `ui/value-motion.ts`, the selective `revalue` in `game.ts`
  (W2). **`revalue` never re-runs the talker (r3 W2, `characters.md` R7):** it calls nothing on `scene` (no
  `scene.talk`, no `scene.apply`) and never calls `lineShown` again; the talker keeps its call points in the line
  display and `lineShown()` wherever its design puts them.
- **After** GM6c2 (and through it the `game.ts` chain `... -> MA1b -> GM6c2 -> GM6c3`, `characters.md` §11.7 `:1545`;
  reconcile P2: `... -> SH7 -> GM6c2 -> GM6c3 -> GM6d1 -> GM9r`, shots §9.14)
  and engine.md GM3m (`cues/types.ts` `MIN_VISIBLE_MS`, `cues/visible.ts` `keyframesVisible`, which the
  value-motion gate imports, E-P8; GM3m precedes GM3p, which precedes GM6c2, so the order already holds). Never beside
  a lane holding `ui/state.svelte.ts` (engine.md GM3s: one field), `ui/typewriter.ts`,
  `ui/{DialogueBox,Choices,Backlog}.svelte` (an overlay half, if one is ruled: orchestrator Q6) or `app/game.ts` /
  `app/game.test.ts`.
- **Lock (14):** `client/src/ui/value-motion.ts` (new), `client/src/ui/value-motion.test.ts` (new),
  `client/src/ui/ValueText.svelte` (new), `client/src/ui/value-text.svelte.test.ts` (new), `client/src/ui/state.svelte.ts`,
  `client/src/ui/typewriter.ts`, `client/src/ui/typewriter.svelte.test.ts` (its `lineOf` helper `:51` gains `reveal`),
  `client/src/ui/DialogueBox.svelte`, `client/src/ui/Choices.svelte`, `client/src/ui/choices.svelte.test.ts`,
  `client/src/ui/Backlog.svelte`, `client/src/ui/menus.svelte.test.ts`, `client/src/app/game.ts` (`lineView` /
  `choiceSet` / `backlogLines` `:437-455`; `revalue` beside `relabel` `:457-466`; reconcile P4, re-located on main
  `acc4e0d`: `lineView` `:501`, `choiceSet` `:506`, `backlogLines` `:510`, `relabel` `:521-528`; the cut re-locates
  them again on its parent), `client/src/app/game.test.ts`.
  Changed by RULINGS 234, 236 (as of `0b91acc`; docs lane `docs-errata-15`, group A): lever O5 (`9a0ae2d`) moved the Backlog, so this lock's
  `client/src/ui/Backlog.svelte` is **`client/src/ui/overlays/Backlog.svelte`** (in the overlays chunk; its `ValueText`
  import from `ui/overlays/` is an out-of-directory import, which the arch rule `lazy-ui` allows), and
  `menus.svelte.test.ts`'s component glob reads `['./*.svelte', './overlays/*.svelte']`
  (`client/src/ui/menus.svelte.test.ts:931`); the Q64 fix (`d820803`) added the stage tap to `DialogueBox.svelte` and
  `vm.stageTap` to `state.svelte.ts` (the cut re-locates both).
- **Commits (5):** (1) the motion gate: `value-motion: every value motion changes a visible property for >= 120 ms`
  (through engine.md's `keyframesVisible` and `MIN_VISIBLE_MS`, E-P8; red: module missing; then seen red on the
  mutation "equal keyframes"), `value-motion: reduced motion animates opacity only`; (2) `ValueText`: `value-text: a
  value run renders as its own span`, `value-text: a changed value plays the change motion` (seen red on the mutation
  "the action skips `playValue`"), `value-text: a pending value shimmers`, `value-text: a still value has no motion
  loop` (W5), `value-text: an unmounted span leaves no running animation`, **round 9 (RULINGS 135 (b), mirrored
  before engine.md writes it, R-E29):** `value-text: a value span a re-render creates plays its motion after its
  flush` (`ValueText` mounted with one plain run, then re-rendered with a plain run and a value run, `flushSync()`:
  the fake `animate` records exactly one `change` call, on the `[data-value]` span, which `isConnected` at the call;
  seen red on the mutation "the component calls `playValue` from a `$effect.pre` over its runs", which runs before
  the flush creates the span: no call, or a call on no connected element); (3) typewriter: `typewriter: a same-reveal
  line keeps its revealed count` (red: `retext is not a function`), `typewriter: retext of a finished line reports no
  second done`, `typewriter: value runs reveal inside their spans`, `typewriter: a value run reveals as one step`
  (m10; seen red on the mutation "count value graphemes": a mask `···` -> `12-7-30` change shifts the revealed plain
  text); (4) game: `game: a value change does not restart the reveal of the line on screen` (W2's test), `game: a value
  change leaves a line without its placeholder untouched`, `game: a value change keeps the choice set id`, `game: an ink
  line renders the player's code`, `game: a language switch still restarts the reveal` (K49 pinned; round 10, r9 W1:
  its line holds a per-player `$code(drawer)` showing `1847`, and after the switch the new `LineView`'s value run is
  still `shown` `1847` with no `getValues`, through the runs this lane adds; seen red on GM6c2's **M-P10d** with the
  run `pending` (reconcile P3, r10 m1: round 10 named M-P10a, which the real `heldOf` cache hides at the game level)), `game: a ch1
  backlog line in ch2 never renders ch2's value` (W5; both chapters with a per-player `drawer`; predicted red on a
  render without origin: the ch1 line shows ch2's digits), `game: a value change neither talks nor reports the line
  again` (r3 W2: the fake scene's `apply` count, its `talk` count once a talker exists on the base, and the
  `lineShown` count are unchanged across a `revalue`; reconcile P4: the fake meta's
  `stepShown` count too, since LFL (merged, `cec347c`) has `present()` call `meta?.stepShown()` after its switch, §11.1; a verification
  pin, green on arrival, labelled so; seen red on the mutation "`revalue` re-presents the
  line through `present`"); (5) `choices: a choice holding a value renders its span`, `backlog: a line holding a value
  renders its span`.
- **Gates:** check, test, story, build (engine ARITHMETIC +0.58 KB br, MEASURED), e2e full (unchanged: no placeholder in
  the story yet).

### GM6t `toast-motion` (client, overlay; new in round 3, W6)

- **Goal.** Every toast enters, leaves and swaps its text with motion. The two per-player toasts (`values_failed`,
  `puzzle_value_changed`) are the first that need it, and the change covers every toast, since today none moves
  (`Toast.svelte:28-69`; no overlay motion exists in `client/src`, §1) and the owner's value covers every UI
  interaction. **Mechanism (r3 W1): our own `Element.animate` path, no Svelte directive.** `Toast.svelte` is an entry
  module (`App.svelte:19`, `:281`) and no component uses a transition directive today (§1 round-4 reads), so an
  `in:` / `out:` there would pull Svelte's transition runtime (`svelte/src/internal/client/dom/elements/transitions.js`,
  ~510 lines, and its `loop.js`; CLAIM ~1-2 KB br, the critic's figure from the source size) into the entry. The
  browser's `Element.animate` costs 0 bytes; `bind:this` and `$effect`, which the stack needs to find its elements,
  are in the entry already (`App.svelte:48`, `:63`). A leave is a **ghost**: the stack keeps a removed entry rendered,
  `inert` and `aria-hidden`, until its `out` animation finishes. So m1 (Svelte's local transitions) does not arise.

```ts
// client/src/ui/toast-motion.ts (new; entry, with Toast.svelte; the third `waapi` allowance, R-E18)
import type { ToastEntry } from './state.svelte.ts';
export type ToastMotion = 'in' | 'out' | 'swap';
export type ToastMotionDef = { readonly keyframes: readonly Keyframe[]; readonly ms: number; readonly easing: string };
/** in: rise 12 px + fade, 220 ms; out: fade + 8 px up, 180 ms; swap: the text crossfades with a 4 % scale pulse,
 *  200 ms; reduced: opacity only, >= 120 ms. CLAIM defaults for design-animation (R-A7). */
export const TOAST_MOTIONS: { readonly [K in ToastMotion]: { readonly full: ToastMotionDef; readonly reduced: ToastMotionDef } };
/** Plays `kind` on `el` (`fill: 'both'` for `out`); null where `el.animate` does not exist, which the caller treats
 *  as an already finished motion (a leave then removes the ghost at once). */
export function playToast(el: Element, kind: ToastMotion, reduced: boolean): Animation | null;
/** One rendered toast: a live entry (`leave` null), or a ghost leaving under its own leave token. A token is minted
 *  per leave and never reused, so a key that left, came back and leaves again is a new ghost (r4 m1). */
export type ToastSlot = { readonly entry: ToastEntry; readonly leave: number | null };
/** The stack to render, pure: the entries of `next` in their order, live; each key of `prev` absent from `next` stays
 *  at its old index as a ghost, keeping its token if it was a ghost already, else taking the next of `token`,
 *  `token + 1`, ... in stack order; a ghost whose token is in `ended` is dropped; a key live again is never a ghost
 *  (its leave is cancelled, it plays `in`). Returns the stack and the next unused token. */
export function stackOf(prev: readonly ToastSlot[], next: readonly ToastEntry[], ended: ReadonlySet<number>,
  token: number): { readonly slots: readonly ToastSlot[]; readonly token: number };
```

- **`Toast.svelte` (r4 m1: the recompute form and the token lifetime).** Plain, non-reactive component variables hold
  the previous stack `prev`, the next token `token`, the set `ended` of finished leave tokens and a
  `Map<number, Animation>` of the `out`s running; one `$state` number `endedTick` is the only reactive input besides
  `ui.toasts`. **Recompute:** one `$effect` reads `ui.toasts` and `endedTick` (tracked) and `prev` / `ended` / `token`
  (plain, so never tracked), calls `stackOf(prev, ui.toasts, ended, token)`, stores `prev` and `token`, deletes from
  `ended` every token the new stack no longer holds, and writes `slots` (`$state.raw`), which this effect never reads,
  so it cannot loop (a form that read `slots` would throw Svelte's `effect_update_depth_exceeded` in every `toast:`
  test, so the suite pins it). **Motion:** a second `$effect` reads `slots` and, after the DOM update, walks the stack
  root's children (`bind:this`, `data-toast-key`, `data-toast-leave`): a new key plays `in`; a live key whose message
  changed plays `swap` on its `[data-toast-text]`; a ghost plays `out` once per token (cancelling its key's running
  `in`), and that animation's `finished` (or its rejection on cancel, or a null animation) adds the token to `ended`
  and bumps `endedTick`. A token never repeats, so a reused key plays `out` at every dismissal: every look text is key
  `look` (`yields.ts:288`), the sound chip, resume and purchase toasts reuse theirs (`game.ts:492`, `:955`, `:1120`),
  and `values_failed` will; `ended` holds only tokens of ghosts still on the stack, so it never outgrows the ghosts.
  One `Animation` per element at a time; the motion effect's cleanup cancels every running one at unmount. A ghost's
  buttons are inert, so a leaving Retry never runs twice. The prop `reduced` comes from App (`reduced={vm.reducedMotion}`, the one source, `characters.md`
  R3).

- **After** engine.md GM3m (`MIN_VISIBLE_MS`, `keyframesVisible`, imported by the gate test, E-P8; and the `waapi`
  rule with `ui/toast-motion.ts` in its allowed files, R-E18: without it this lane's `.animate(` call fails `test`),
  GM3s (`ui/App.svelte`: engine.md §12's row GM3w -> GM3s; this lane adds one prop, `reduced={vm.reducedMotion}`,
  beside today's `reducedMotion` pass at `App.svelte:86`), and the entry lever (RULINGS 127: it adds entry code;
  reconcile P4: merged, LEL `7b37278`, RULINGS 141; this lane is the largest entry delta of the three designs, so its
  cut quotes the entry row base -> HEAD against §10 "Ledgers" and STOPs if the sum crosses 40.0, or if the headroom
  after it is < 0.5 KB br while L1 / L2 are still shelved, RULINGS 142). **Ruled since: RULINGS 158** — L1 is unshelved as lane `l1-entry-summary`; L2 stays shelved; GM6t's cut reads this condition against the entry row of [§10 Ledgers](10-budgets-and-validation.md#ledgers-reconcile-p4-rulings-143-qo10-145-149-152-shots-i-13-reconcile-r2-one-ledger-enginemd-111) after L1. Changed by RULINGS 159 (as of `9a83251`; docs lane `docs-errata-10`, group A): L1 merged `eec24fe`.
  **Before** GM6c4, the first lane that shows either toast to a player. Never beside a lane holding `ui/App.svelte`,
  `ui/Toast.svelte` or `ui/screens.svelte.test.ts`. It touches no file of the values lanes, so it may run any time in
  that window.
- **Lock (5):** `client/src/ui/toast-motion.ts` (new), `client/src/ui/toast-motion.test.ts` (new, node project: the
  table and `stackOf` are pure), `client/src/ui/Toast.svelte`, `client/src/ui/screens.svelte.test.ts` (mounts
  `Toast`, `:16`; the tests define a recording `Element.prototype.animate` whose `finished` they resolve, restored
  after each test, whether or not happy-dom has one), `client/src/ui/App.svelte` (one hunk).
- **Commits (3):** (1) `toast-motion: every toast motion changes a visible property for >= 120 ms` (each
  `TOAST_MOTIONS` entry through `keyframesVisible` and `MIN_VISIBLE_MS`; red: module missing; then seen red on the
  mutation "`in`'s keyframes equal"), `toast-motion: reduced motion animates opacity only`, `toast-motion: a removed
  entry stays a ghost at its index until its token ends`, `toast-motion: a key shown again is never a ghost`,
  `toast-motion: a key that left, came back and leaves again is a new ghost until its own leave ends` (r4 m1; seen red
  on round 4's form, the mutation "`ended` holds keys and is never pruned": the second leave is dropped at once);
  (2) `toast: a new
  toast animates in, a dismissed one out` (predicted red on the parent: the fake `animate` records no call), `toast: a
  dismissed toast stays as a leaving ghost until its out motion finishes` (before `finished` resolves the element is
  present, `inert`, `aria-hidden`; after, gone; seen red on the mutation "remove at once"), `toast: a same-key replace
  swaps its text with motion`, `toast: a key that left, returned and leaves again plays out again` (r4 m1: a `look`
  note shown, expired, shown again, expired again; the fake `animate` records two `out`s and the element stays a
  ghost until the second resolves; predicted red on the mutation above: one `out`, the second leave cut),
  `toast: a toast without animate leaves at once`, `toast: an unmounted stack leaves no running animation`; (3) App's
  `reduced` prop: `toast: reduced motion plays the opacity-only motions`. The view-model
  tests `toast: transient expires, sticky stays until dismissed` and `toast: same key replaces in place`
  (`screens.svelte.test.ts:301`, `:336`) stay green: the entry list changes at once; only the element leaves later.
- **Gates:** check, test, build (entry row MEASURED; ARITHMETIC ~60 lines, **~+0.26 KB br**, one figure, r3 m4; the
  build log also states that no Svelte transition module entered the entry chunk: its entry delta stays within the
  estimate + 0.5 KB br, engine.md's STOP rule), e2e full (toasts are read by text; a ghost stays ~180 ms, `inert` and
  `aria-hidden`, which Playwright's auto-waiting assertions absorb).

### GM6c4 `values-world-text` (client + story)

- **Goal.** §5.3's world rows; lift `world/per-player-runtime`; ch1's first per-player puzzle (OQ1); the e2e of the
  values path and of R7.
- **After** GM6c3, GM6c1b, **GM6t** (the toasts it makes visible move, W6); and after the last engine.md holder of
  `explore/controller.ts` (GM8i), `ui/explore/**` / `ui/explore-view.svelte.ts` (GM5) and `e2e/helpers.ts` at its
  launch (engine.md §12 owns those rows, m9). Never beside a lane holding `app/yields.ts`, those files, or
  `story/ch1/world.json`. **Reconcile P2 (shots I-2, I-16, I-18):** SH9 follows this lane on `explore/controller.ts`
  (its one-hunk `shotImages` change after the chain's last holder, GM6c4); this lane's `story/ch1/world.json` edit
  touches only `drawer` and the diary / hint texts and never `gate`, its `"closeup": null` (`story/ch1/world.json:43`)
  or its `onFail` `manor_gate_forced` (`:89`), so the room event SH11's e2e needs stays reachable (a cut check: the
  diff names neither).
- **Lock (14):** `client/src/explore/controller.ts` (the `shown` dep: doc body, item desc), `client/src/explore/controller.test.ts`,
  `client/src/ui/explore-view.svelte.ts` (`DocView.body: readonly ShownText[]`, `ItemView.desc: ShownText`),
  `client/src/ui/explore/DocumentReader.svelte`, `client/src/ui/explore/Inventory.svelte`,
  `client/src/ui/explore/explore.svelte.test.ts`, `client/src/app/yields.ts` (passes `shown`; explore `revalue`),
  `client/src/app/yields.test.ts`, `client/scripts/story/values.ts` (the lift: the rule and the code
  `world/per-player-runtime` leave `VALUES_CODES`), `client/scripts/story/values.test.ts` (GM6c1a's `story: a
  per-player mark in a listed chapter is refused until the runtime` lives there and is inverted on purpose; round 5,
  found while resolving: round 4's lock missed it), `client/e2e/values.spec.ts` (new; a new spec file, MD2's
  precedent), `client/e2e/helpers.ts`, `story/ch1/world.json`, `story/locales/en/ch1.json`.
- **Commits (4):** (1) world surfaces: `explore: a document paragraph holding a value renders its span`, `explore: an
  item description holding a value renders its span` (red: TS, `DocView.body` holds strings), `yields: a value change
  re-renders the open document only where it holds the value`, **reconcile P3 (r10 m2):** `yields: a document that
  meets a puzzle the store does not hold shows the Retry prompt` (the store on ch1, the fake host's chapter switched
  to ch2 with a per-player `drawer` and no installation, the diary open: its body's span `pending`, after one
  microtask `showToast('values_failed')` once; red under GM6c2's **M-PR1c** with no `showToast`), and GM6c2's pin
  `yields: every value surface renders through render` stays green by name with the `shown` dep wired; (2) the lift: `story: a per-player mark is accepted in
  a listed chapter` (GM6c1a's refusal test inverted on purpose); (3) **the drawer becomes per-player, one commit** (W4):
  the story edit by the `narrative-designer` role (orchestrator Q2): `drawer` gains `perPlayer`, diary `b002` becomes a
  clue with `$code(drawer)` that no longer names a year, hint `h002` no longer says "a year" (m12), `h003` becomes the
  template, en likewise; and the e2e helpers by the developer: `launch()` records the page's own
  `GET /api/chapters/<ch>/values` 200 bodies, `playerCode(page, puzzle)` reads the last one, `playCh1ToGate` enters
  `await playerCode(page, 'drawer')` (`helpers.ts:532`), `worldSolutions()` returns `{ gate }` (`:371-382`; its callers
  `puzzles.spec.ts:103`, `:114` read `gate` only). Predicted red without the helper change: `puzzles.spec.ts`,
  `perf.spec.ts`, `purchase.spec.ts` stop at the drawer (`worldSolutions().drawer` is undefined); `npm run story` 0
  errors; (4) e2e: `values: the diary shows the player's own code and it opens the drawer`, `values: a failing values
  route masks the code and Retry shows it`, `values: another player's code does not open the drawer` (a third uid when
  two draws collide, p = 1 / 9,999).
- **Gates:** check, test, story, build (engine ARITHMETIC +0.06 KB br; explore-ui MEASURED, ARITHMETIC ~+0.04, §10;
  the first-line row quoted base -> HEAD at the cut, §10 "Ledgers"), e2e full + `values.spec.ts`
  (a `server-dev` built from GM6s2's merge or later, orchestrator Q3); pins (r4 W1): `dsl-doc: lint table equals lint
  codes` green and untouched, `story: the values lint codes are registered once` still green with one code fewer.
