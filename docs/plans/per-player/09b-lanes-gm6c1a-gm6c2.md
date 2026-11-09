### GM6c1a `values-build` (client, world chain)

- **Goal.** §4 and §5.1: the source mark, the public flag, format-2 per-player emission (domain with `startShown`
  excluded when non-null, E-P9; `maxAttempts`), the placeholder parser and the renderer with runs, every lint of §4 except `puzzle-key/*`, R4's compile
  test, and `world/per-player-runtime` (a mark in a listed chapter refused until GM6c4).
- **After** GM6s2 (the server parses everything this emits), GM1c (`scripts/story/puzzles/code.ts`, `PuzzleTypeLint`),
  GM1d (`clues`, `world/clue-reachable`; it also creates the lint-registry line pattern, `scripts/story/mechanics/clues.ts`),
  GM4 (`scripts/story/emit.ts`: engine.md's chain GM2b -> GM3b -> GM4g -> GM4 -> GM6c1a), and **R-E25's walk** (engine.md
  GM3c, which precedes GM6c1a on `world/{types,decode}.ts`, [engine §12 Order and conflicts](../engine/12f-order-and-conflicts.md#order-and-conflicts) as read in round 7; round 6, r5 W1;
  engine.md's GM3c order row states it, E-P16 (b)): the cut verifies that `worldLines` returns `WorldTextLine`s with
  `role` / `reach` and that `MECHANIC_TEXTS` exists in `scripts/story/mechanics/index.ts`; if not, the cut is
  BLOCKED (§4 "World texts"). Never beside a lane holding `world/{types,decode}.ts`, `scripts/story/emit.ts`,
  `scripts/story/mechanics/index.ts`, `client/scripts/story.ts` (engine.md GM9p, GM6c1b; [engine §12 Order and conflicts](../engine/12f-order-and-conflicts.md#order-and-conflicts)) or
  `client/scripts/story/build.test.ts` (GM1d -> GM2b -> GM3b -> GM4g -> GM8a -> GM8b, A(`build.test.ts`), GM6c1b;
  [engine §12 Order and conflicts](../engine/12f-order-and-conflicts.md#order-and-conflicts)) (round 6, r5 m4).
- **Lock (12):** `client/src/world/values.ts` (new), `client/src/world/values.test.ts` (new),
  `client/src/world/types.ts`, `client/src/world/decode.ts`, `client/src/world/decode.test.ts`,
  `client/scripts/story/values.ts` (new), `client/scripts/story/values.test.ts` (new),
  `client/scripts/story/mechanics/index.ts` (two lines: `VALUES_LINT` and `VALUE_TEXTS_LINT` in `MECHANIC_LINTS`,
  engine.md §3.2; r4 W1, E-P13; GM1b's registry exists before this lane by the order, and `scripts/story/world.ts` is
  not edited: the roles come from R-E25), `client/scripts/story/puzzles/code.ts`, `client/scripts/story/emit.ts`,
  `client/scripts/story.ts` (one stage-5 call of `lintValueTexts` after `localeStage`, `story.ts:696-697` at `525dd68`,
  given the world's lines, the graph's `yields` and the sources map, `:319`, `:626`, `:664`; `ChapterWorld.lines`
  typed `readonly WorldTextLine[]`, `:302`; re-located at the cut), `client/scripts/story/build.test.ts` (the format-2
  emit case). No `lint.ts`, STAGING-DSL §11, `dsl-doc.test.ts`, `world.ts` or `graph.ts`.
- **Commits (6):** (1) `placeholders` / `renderText` / `lineChapter`: `values: render matches the server vectors`,
  `values: a malformed placeholder renders still`, `values: runs concatenate to the text`, `values: a line id gives its
  chapter` (red: module missing); (2) decode: `world: a
  per-player source decodes its domain`, `world: a public world refuses a per-player domain` (red: unknown key
  `perPlayer`); (3) `toServer`: `emit: a per-player puzzle reaches the server content with startShown excluded` (E-P9; `code`:
  `initial`), `values: a null startShown adds no exclude` (a stub type data half; r3 m5),
  `emit: a static-only chapter stays format 1`, `emit: format 2 matches the server's content-v2 fixture shape`;
  (4) `domainFits` + floor: `story: a 3-dial per-player code is refused`, `story: per-player order is refused`,
  `story: domain sizes match the server vectors`, `story: the values lint codes are registered once` (r4 W1; both
  entries, round 6; red: TS2307, `scripts/story/values.ts` missing; then seen red on the mutation "the registry line
  removed", each line in turn), `values: values.ts imports no node module` (r5 m5; seen red on the mutation "values.ts
  imports `createHash` from `node:crypto`"); (5) placeholders and clues (the tests of commits 4-6 live in
  `client/scripts/story/values.test.ts`, over fixture `WorldTextLine`s, so no module is needed): `story: a placeholder
  of an unknown puzzle is refused`, `story: ru and en placeholders differ`, `story: a hint naming another puzzle is
  refused`, `story: a placeholder in a look text is refused`, **`story: a placeholder in a toast or name text of a
  module is refused`** (round 6, r5 W1: a fixture line of role `toast`, as engine.md's `say`; another of role `name`;
  seen red on the mutation "the surface rule allows every role but `name`"), **`story: a read text of any module is a
  clue surface`** (round 6: a fixture `read` line holding `$code(p)` with reach `[{visited: v}]` and the clue
  `{visited: v}` is accepted; the clue `{visited: w}` is refused, the message naming `{"visited":"v"}`; **round 7, r6
  m2, the conjunction case:** a second fixture line with reach `[{all: [{visited: v}, {open: d}]}]`, where the clue
  `{visited: v}` is refused (the message naming `{"all":[{"visited":"v"},{"open":"d"}]}`) and the clue `{all:
  [{open: d}, {visited: v}, {has: k}]}` is accepted (every conjunct of the reach, in another order, with one more);
  seen red on the mutation "`contains` compares the first conjunct only": the clue `{visited: v}` is accepted, which
  the single-conjunct fixtures alone could not show), `story: a per-player puzzle whose declared clue shows no
  value is refused`, `story: a linear per-player puzzle without a clue line before its yield is refused` (m7; round 6,
  r5 m1: through `sources` and `classify`; a fixture with the clue line behind a `* [..]` choice and one behind a
  `{flag:` block, both refused, and the plain line accepted), `story: a per-player mark in a listed chapter is refused
  until the runtime`; (6) ink: `story: an ink placeholder of an unknown puzzle is refused`
  (red) and the R4 verification `story: an ink line with a placeholder compiles and plays verbatim` (green on arrival,
  labelled so).
- **Gates:** check, test, story (0 errors: the real story has no mark), build (engine unchanged: nothing in the runtime
  imports `world/values.ts` until GM6c2), e2e full (world versions unchanged: no world gains a key); pins (r4 W1):
  `dsl-doc: lint table equals lint codes` green and untouched, engine.md's `story: module and type lint codes are
  unique and none is a DSL code` green over `VALUES_CODES` and `VALUE_TEXT_CODES`; engine.md GM3c's `story: a module
  text is a world line with its role` green (R-E25, untouched).

### GM6c1b `puzzle-keys-build` (client, world chain)

- **Goal.** §3.8's build half: the key record, its lints, `--fix-ids` maintenance, the `key` emission, and E-P5 in one
  commit (lift GM2b's `renamed.puzzles` refusal and map `s.puzzles` in step 0).
- **After** GM6c1a, GM2b (`mechanics/core.ts`: engine.md §12's row GM1b -> GM2b -> GM6c1b, [engine §12 Order and conflicts](../engine/12f-order-and-conflicts.md#order-and-conflicts) as read in round
  6), GM6k (the server reads `key`; GM6k's `deploy.md` sentence lands first). **Never beside** a lane holding
  `client/scripts/story/mechanics/index.ts` (every module lane, GM6c1a, GM6d2: engine.md [engine §12 Order and conflicts](../engine/12f-order-and-conflicts.md#order-and-conflicts)),
  `client/scripts/story/mechanics/core.ts`, `client/scripts/story.ts` (engine.md GM9p, GM6c1a; [engine §12 Order and conflicts](../engine/12f-order-and-conflicts.md#order-and-conflicts)),
  `client/scripts/story/world.test.ts` (GM1d -> GM2b -> GM9p, [engine §12 Order and conflicts](../engine/12f-order-and-conflicts.md#order-and-conflicts)), `build.test.ts` / `emit.ts` (their rows,
  [engine §12 Order and conflicts](../engine/12f-order-and-conflicts.md#order-and-conflicts), [engine §12 Order and conflicts](../engine/12f-order-and-conflicts.md#order-and-conflicts)) or `explore/reconcile.ts` / `explore.test.ts` (GM1a -> GM1b -> GM2a -> GM2b -> GM3 (test) -> GM5q
  (test, when it runs) -> GM5f, [engine §12 Order and conflicts](../engine/12f-order-and-conflicts.md#order-and-conflicts)). **No `lint.ts` (round 5, r4 W1, E-P13):** GM2b declares
  `world/renamed-puzzles` in `mechanics/core.ts`'s `codes` (engine.md §5.3 [engine §5.3 `renamed`, the client half](../engine/05-world-data-and-save-format.md#53-renamed-the-client-half-lane-gm2b)), so the lift is a `core.ts`
  hunk, and A(`lint.ts`) (rev. 3: MA1b -> MD3) no longer constrains this lane.
- **Lock (13):** `story/puzzle-keys.json` (new), `client/scripts/story/keys.ts` (new, node-free: parse, replay, chain
  with the injected `sha256`, the rules, `KEY_CODES`, `KEY_LINT` as a `runsFrom: 'story'` entry, `lintPuzzleKeys`,
  `RETIRE_COMPENSATED = false`, the prefix check), `client/scripts/story/keys.test.ts` (new), `client/scripts/story/fix.ts`,
  `client/scripts/story/emit.ts`, `client/scripts/story/mechanics/core.ts` (the lift: GM2b's `world/renamed-puzzles`
  rule and its code leave `codes`), `client/scripts/story/mechanics/index.ts` (one line: `KEY_LINT`),
  `client/scripts/story.ts` (the flags `--retire-puzzle`, `--move-puzzle`, `--mark-release`, `--check-extends`, r3 O1;
  one call of `lintPuzzleKeys` after the world stage, `:630-651`, with `sha256` bound to `createHash`),
  `client/scripts/story/world.test.ts` (GM2b's `story: renamed.puzzles is refused` lives there: engine.md's R-E23
  answer, [engine §14.2 Answers to per-player.md §12](../engine/14-interface-requests.md#142-answers-to-per-playermd-12), and GM2b's commit (2)) and `client/scripts/story/build.test.ts` (the emit case),
  `client/src/explore/reconcile.ts` (step 0), `client/src/explore/explore.test.ts`,
  `docs/runbooks/deploy.md` (the release step runs `--mark-release` and commits the record; the restore-from-git
  remedy for a broken chain). No `lint.ts`, STAGING-DSL §11 or `dsl-doc.test.ts`.
- **Commits (4):** (1) the log, its replay, the chain and the lints, on fixture records: `story: a deleted record line
  breaks the chain` (W4; red: module missing, then seen red on the fixture with `add ch1.gate` deleted),
  `story: a new puzzle without a recorded key is refused`, `story: a deleted puzzle whose key is not retired is
  refused`, `story: a retired key reused as a live id is refused`, `story: a rename chain passes` (m4; a lint on the raw
  map would refuse it: the mutation "rename-agrees over the unresolved map" turns it red), `story: a rename into a
  puzzle with its own key is refused` (m4), `story: a retire after a release is refused` (m7), `story: the key lint
  codes are registered once` (r4 W1; seen red on the mutation "the `KEY_LINT` line removed from `MECHANIC_LINTS`"),
  `keys: keys.ts imports no node module` (r5 m5; seen red on the mutation "keys.ts imports `createHash` from
  `node:crypto`"). **No `story.ts` hunk in this commit (round 6, r5 m6):** `KEY_LINT` registers codes only, so
  `npm run story` on the real tree is green at this boundary with no record; (2) the tools, the real record and the
  call, one commit: `lintPuzzleKeys`'s call in `story.ts` lands **with** the seeded record, so the real tree never
  sees `puzzle-key/unrecorded` for `ch1.gate`, `ch1.drawer`, `ch2.cabinet` at a commit boundary (the gate's own
  mutation: the seeded record without `add ch2.cabinet` -> `npm run story` red with `puzzle-key/unrecorded` naming
  `ch2.cabinet`);
  `fix-ids: a broken chain is refused, not rewritten`, `fix-ids: a rename moves its key to the new id`,
  `fix-ids: a new puzzle gets its own key`, `fix-ids: a second run appends nothing`, `fix-ids: a cross-chapter move
  serves the new id`, `keys: a log that does not extend the last released log is refused` (r3 O1; the fixture's
  restored copy plus its `retire` line is as long as the released log; seen red on the mutation "the prefix check
  compares lengths only"), and the real record seeded by one
  `--fix-ids` run (today's `ch1.gate`, `ch1.drawer`,
  `ch2.cabinet`, re-listed at the cut; no `release` line: nothing has shipped); (3) E-P5, one commit: `emit: a renamed
  puzzle's server entry carries its key`, `reconcile: step 0 maps renamed puzzle runs`, `story: renamed.puzzles is
  accepted` (GM2b's refusal test inverted on purpose in its own file; the rule and the code `world/renamed-puzzles`
  leave `mechanics/core.ts`, so engine.md's uniqueness test still passes and no code is left without a rule); (4)
  `deploy.md`'s release step (`--check-extends` against the last release's record, then `--mark-release`, then the
  commit of the record) and the remedy.
- **Gates:** check, test, story, build, e2e full (unchanged: no rename in the story); pins (r4 W1): `dsl-doc: lint
  table equals lint codes` green and untouched, `story: module and type lint codes are unique and none is a DSL code`
  green over `KEY_CODES`.

### GM6c2 `values-runtime` (client)

- **Goal.** §5.2, §5.4's states, §5.5 and the W1 rules: the store, reconcile and restart, the per-player session, the
  D18 replacement, R7's toast and Retry, the `activated` refresh, the hint `valueRun` check, the tier-text drop on a
  run change with the ladder re-read (W3), the render origin and the rename mapping (W5), the frame's pending state
  and the `puzzle:renewed` emission (W6), `syncValues` with a cue for every end of the wait (round 6, r5 W2), the
  `chapterEntered` hook (m2); round 7: the monotonic merge and the refresh rule (a known code survives every refresh,
  r6 W1, m5), `endedHere`, the restart re-post, `valuesPatch` against the shown frame and the one-cue `settle` pass
  over `attempted` and the countdown's zero (r6 m1, m3), the values failure ending the wait with `ready` (r6 m4);
  round 8: the derived entry by what is owed (a spent run under any outcome shows its value; a linear re-entry after
  `solved` / `abandoned` owes the restart, r7 W1), "No dead end" (`fail` + Retry re-issuing its request), the port's
  `run()` in every state (r7 W2), `Open.trying` / `post(o)` (r7 m1), request tokens (m5), the automatic re-post that
  keeps `fail` (m4), no reconcile at `chapterChanged` and `chapterLeft()` (m3), the ladder writes through `setLadder`
  and the state gate's per-player steps (E-P17 (a), (c)); round 9: the store keyed by its chapter (`sync`, `held`,
  `chapter()`, the unheld answers, the level-triggered `syncPrompt`; `chapterLeft()` in place of the paywall's
  `restore`; RULINGS 135 (a), r8 W1), the toast against `seenDigits` (r8 m1), the `awaiting` clear (m4), the
  null-`best` fill (m5), `o.trying = true` in GM3p's `post(o)` and the cached-chunk test (E-P18 (a), (b)); round 10:
  the key is the `ChapterId` with the per-puzzle unheld test (r9 W1), `render`'s prompt scheduling, `ShownDigits`
  (r9 O1), the language-switch pin. **No visible change:** no story text holds a
  placeholder until GM6c4 (`world/per-player-runtime`), so the lane's motion duty starts with the first surface that
  shows a value (GM6c3).
- **After** GM6c1a, GM6s2 (routes); engine.md GM3m (`puzzle:renewed`, R-E14, `puzzle:hint-renewing`, R-E20, and
  round 6's **`puzzle:ready`**, R-E26, in `PUZZLE_CUES`, beside its round-5 `puzzle:offline`; a GM3m merged without
  `ready` makes this cut a STOP item, never a local key) and GM3p (the last `yields.ts` holder before it, the
  `puzzle:hint-shown` cue, `data-cue-status` on the status line, and, round 6, the no-outcome branch's and the
  countdown zero's `puzzle:ready`, which this lane routes through `settle`: GM3p's tests `yields: a check that ends
  with no outcome returns the frame to idle with puzzle ready` and `yields: a countdown that ends with nothing to post
  emits puzzle ready` stay green by name, a static puzzle's pass carrying no values patch; R-E27 (d); round 8: GM3p's
  `setLadder`, `yields: the ladder has one writer`, `yields: a busy reply leaves the frame to the attempt in flight`
  and the state gate `yields: every visible change of the puzzle view plays a cue`, E-P17, all of which this lane
  keeps green by name; a GM3p merged without `setLadder` or the state gate makes this cut a STOP item; round 9,
  E-P18: GM3p's `post(o)` and its pin `yields: every attempt starts through post`, and GM3w's `retrying` field
  (`ui/puzzle-view.svelte.ts`), both green by name here; a GM3p merged without `post(o)` or a GM3w without
  `retrying` makes this cut a STOP item, never a local starter); on `app/game.ts` after
  the last holder before it in the recorded chain `GM2a -> GM3w -> MD2 -> MA1a -> MA1b -> GM6c2` (`characters.md` rev.
  3 §11.7, `:1545`; r3 W2: round 3's "MA1" is MA1a / MA1b, and MD2 holds `game.ts` too, `:1348-1352`; `design-shots`
  re-sets the animation names, RULINGS 132, and engine.md §12 owns the row, R-E19). Never beside a lane holding
  `app/{yields,game}.ts`, `app/{yields,game}.test.ts`, `puzzles/session.ts` or `puzzles/session.test.ts` (engine.md
  §12: GM1a, GM2a, GM3s, GM3, GM3u, GM3p, GM3b, GM4, GM4u, GM5, GM7r, GM8h, GM9r on `yields.ts`; GM1c, GM7r, GM7g,
  GM8h on `session.ts` / `session.test.ts`, E-P10; GM2a, GM3w, GM9r and the animation chain's MD2 / MA1a / MA1b on
  `game.ts`). **Reconcile P1/P2 (shots I-2, §9.14; RULINGS 148):** the `game.ts` chain reads `GM2a -> GM3w -> SH1 ->
  SH5a -> SH5b -> SH7 -> GM6c2 -> GM6c3 -> GM6d1 -> GM9r` (the shot lanes replace MD2 / MA1a / MA1b); the shot lanes
  rework `stage()` / `present()` before this lane, so its cut re-locates the five hunks below on its parent; and
  `client/src/requests.test.ts` (GM3p's request walk) is held after GM3p, the lane that creates it. **Reconcile r2
  (E-P26):** the chain's head is `LBI, LFL (merged) -> LRB (merged 3c62a86, RULINGS 157) -> L1 (RULINGS 158; merged eec24fe, RULINGS 159) -> GM2a`, so LRB's `game.ts`
  hunks move this lane's lines again; RULINGS 156 names `reloadBlocker()` (`game.ts:1742-1762` on `cec347c`) and
  `meta.ts`, outside the five hunks below (CLAIM from the ruling; the cut re-locates by symbol on its parent);
  `requests.test.ts` is held by launch, never beside another holder (R-E35).
- **Lock (10; round 10: 9, + `client/src/requests.test.ts`, reconcile P1, E-P23 (a)):** `client/src/app/values.ts`
  (new), `client/src/app/values.test.ts` (new), `client/src/app/yields.ts`,
  `client/src/app/yields.test.ts`, `client/src/puzzles/session.ts`, `client/src/puzzles/session.test.ts`,
  `client/src/requests.test.ts` (four view rows, `WaitRow` + `'values' | 'restart'`, `VIEW_FILES` + `'app/values.ts'`;
  §5.2 "Request sites"),
  `client/src/app/game.ts` (**five** hunks, re-located on main `acc4e0d` (reconcile P1; round 10 cited `525dd68`'s
  `:91`, `:827-829`, `:1833-1839`, `:906`, `:11`, `:1182`): the `GameDeps.api` Pick `:132` gains `getValues` /
  `restartPuzzle`; the `yieldsApi` forwarder `:1336-1346` gains the two plain forwarders (the request sites `getValues`,
  `restartPuzzle`; no `attemptsInFlight` count); `s.yields.chapterEntered()` in `enterChapter` after `:891-893` and
  before its first `await` `:899`, m2; one `s.yields.activated()` call in `onLifecycle`'s `activated` branch
  `:1984-1993`; round 9, RULINGS 135 (a): `s.yields.chapterLeft()` **in place of** the paywall branch's
  `s.yields.restore(EMPTY_WORLD_STATE, null, null)` at `:970`; the `EMPTY_WORLD_STATE` import `:11` stays, `:1246`
  still uses it), `client/src/app/game.test.ts`
  (the fake api's two new members; the two paywall tests), `client/src/i18n/values.ts` (new, r3 W1: keys `values.failed`, `values.retry`, `values.changed`,
  `valuesRu` / `valuesEn` / `vt`; imported only by `app/values.ts` and `app/yields.ts`, engine-chunk modules, so the
  strings ship in the engine chunk as `i18n/meta.ts:1-2`'s do in the meta chunk; `i18n/{ru,en}.ts` leave the lock).
- **Commits (5, + 1 conditional, round 5):** (1) store: `values: a chapter without per-player puzzles makes no request`, `values: a load renders
  the value and masks before it`, `values: a failed load masks and offers Retry`, `values: dispose aborts the fetch and
  drops its response`, `values: another chapter's template renders still` (W5), `values: a template naming a renamed
  puzzle renders the new puzzle's value` (W5) (red: module missing); **round 7 (r6 W1, m5):** `values: a failed
  activated refresh keeps the shown code` (a load resolves with `1847`, `refresh()` rejects: `render` still shows
  `1847` as `shown`, `failing` stays false, no change reported; the gate's mutation **M-P7a**, "a failed fetch sets
  every entry `failed`", turns it red with `····`), `values: a refresh in flight keeps the code and ready resolves at
  once` (the refresh held pending: `render` shows `1847` and `ready(p)` resolves in the same microtask turn; **M-P7b**,
  "a fetch start puts every entry in `loading`", turns it red with the mask and a pending `ready`), `values: a failed
  refresh fails only the entries that hold no value` (two puzzles, one `ready`, one `failed` after a failed restart:
  the refresh rejects, the first still shows, the second stays `failed`, `failing` reported true once, no second
  edge), `values: a status naming a newer run masks that value until its refetch` (`stale(p, 4)` over run 3: p masks
  at once, the other puzzle keeps its digits; the refetch rejects: p `failed` and a `failing` edge; resolves: run 4's
  digits in `shown`; `stale(p, 2)` changes nothing), `values: a late response never rolls the run back` (the
  restart's 200 with run 4 lands, then a refresh body with run 3 spent: the entry stays run 4, `shown` does not list
  p, no restart is posted; **M-P7g**, "the merge takes the later response", turns it red with run 3's digits in
  `shown`), `values: attempts left only fall within a run` (`answered` lowers run 3 to 1; a later body of run 3 with 2
  leaves 1); **round 8 (r7 m5):** `values: an older refetch's failure leaves the newer one's entry pending`
  (`stale(p, 4)` then `stale(p, 5)` over run 3: two refetches, p awaits the second; the first rejects: p stays
  `superseded`, no change reports `failing`; the second resolves with run 5: `ready`; **M-P8g**, "`awaiting` holds a
  request kind, not its token", turns it red with a `failing` edge at the first rejection), `values: a status during
  the first fetch refetches after it` (`stale(p, 4)` while the first fetch is in flight: a second request is issued;
  the first resolves with run 3: p `superseded`, masked; the second with run 4: `ready`; round 9, r8 m5: the first
  body fills the null `best`, which is what makes it `superseded` rather than `loading`, and `run(p)` is 3; **M-P9f**,
  "a below-floor body of an older request never fills `best`", turns it red with `loading` and `run(p)` null);
  **round 9 (r8 W1, m4; RULINGS 135 (a)):** `values: sync loads a chapter the store does not hold and keeps one it
  does` (a fake `chapter()`: ch1 loaded with `1847`; `sync()` over ch1: no request, `render` still shows `1847`;
  `chapter()` -> null, `sync()`: the generation dropped, `held()` null, a ch1 fetch held in flight is aborted and its
  late body changes nothing, no restart posted although the fixture's run is spent under an empty `world()`;
  `chapter()` -> ch1, `sync()`: exactly one `getValues('ch1')`, the entry `loading` then `ready`, `shown` lists p;
  `chapter()` -> ch2 over ch1's generation, `sync()`: one `getValues('ch2')`, every ch1 entry gone; **M-P9a**, "`sync`
  reconciles the held generation without comparing `held()` with `chapter()`", turns it red with no `getValues` after
  the drop, `render` `pending` (unheld: `render` reads `chapter()`, never the generation) and `failing()` true;
  round 10, r9 m1: round 9 predicted `still`, which only round 8's whole design gives, its `render` reading the
  generation), **round 10 (r9 W1):** `values: a new object of the held chapter keeps every code` (a fake `chapter()`
  returning object A of ch1; `load()` resolves `1847`; `chapter()` now returns a **new** object B of ch1 with an equal
  `perPlayer` map, as `heldOf` over `loadEn`'s spread would without its cache; with no `sync`: `render` `shown`
  `1847`, `entry(p)` `ready`, `failing()` false, `ready(p)` resolves at once; then `sync()`: no request, still
  `shown`, no change reported; **M-P10a**, "the generation is keyed by the `HeldChapter` object" (round 9's identity
  key), turns it red with `pending` and `failing()` true before the `sync`, and one `getValues` at it), **round 10
  (r9 O1):** `values: the last shown digits survive a reload of the same chapter` (ch1 loaded, `1847` `ready`:
  `lastShown(p)` `1847`; `chapter()` -> null, `sync()` (the drop); `chapter()` -> ch1, `sync()`: a new generation,
  `loading`, and `lastShown(p)` still `1847`; a ch2 generation with its own `drawer`: `lastShown` null for it;
  **M-P10c**, "`lastDigits` lives in the generation" (round 9's `Known.lastDigits`), turns it red with `lastShown(p)`
  null after the reload), `values: every masking state has an action that
  resolves it` (the class guard, `it.each` over the states `loading`, `failed` by fetch, `restarting`, `failed` by
  restart, `superseded`, the superseded entry under an older refetch's failure, `unheld` after a drop with
  `chapter()` naming ch1 and no `sync`, `unheld` with the store on ch1 and `chapter()` naming ch2, (round 10) `unheld`
  per puzzle, `chapter()` naming ch1 with a per-player `safe` the ch1 generation has no entry for, and the states that
  must stay `shown`: the entry a 409 settled under its refetch's failure, and (round 10) the held chapter under a new
  `HeldChapter` object: for each, the current chapter's placeholder renders `shown` or `pending`, never `still`;
  a `pending` entry awaits a request held in flight whose success derives `ready` / `restarting`, or has `failing()`
  true and a `retry()` that issues exactly one request whose success does; `ready(p)` pends only while such a request
  is in flight; the unheld rows also check `run(p)` null and that `learn(p, v)` issues one `getValues` and renders v;
  **M-P9b**, "an unheld puzzle's `entry` answers `loading`", turns the unheld rows red with `ready(p)` pending while no
  request is in flight (round 10, r9 m1: `failing()` stays **true** under it, since `failing()` reads the generation,
  not `entry`, so the prompt would still show; the red is the wait the ruling forbids; round 9 predicted `failing()`
  false); **M-P9c**, "`retry()` acts only on held entries", turns them red with no request after Retry; M-P10a turns
  the new-object row red with `pending`),
  `values: a 409 that settles a superseded entry survives its refetch's failure` (r8 m4: `stale(p, 4)` over run 3,
  the refetch held; `learn` of run 4 `V'`: `ready`; the refetch rejects: `render` still shows V', `failing` stays
  false, no change reported; **M-P9e**, "a settling body leaves `awaiting`", turns it red with `····` and a `failing`
  edge); **reconcile P3:** `values: heldOf takes the id from the chapter, not the world cache` (two world-less
  chapters in a row, `world: null`: `createHeldOf()(ch2).id` is `ch2`; a per-player chapter and its `loadEn` spread
  share one `perPlayer` map; **M-PR1e**, "the cache returns the whole `HeldChapter` keyed by `world`" (round 10's
  cache), turns it red with `ch1`), and the class guard's unheld rows gain `refresh()` (r10 m3: for each `unheld`
  state `refresh()` issues exactly one `getValues` and its body derives p; **M-PR1d**, "`refresh` loads only when the
  store holds no generation of `chapter()`", turns the per-puzzle `unheld` row red with a background refetch that
  leaves p `pending`); (2) reconcile / restart: `values: a spent puzzle
  held fresh is restarted once`, `values: a failed world keeps its spent run`, `values: two reconciles post one
  restart`, `values: an activated refresh reconciles a spent fresh puzzle`; **round 7 (found while resolving):**
  `values: the own final answer never restarts before the world records it` (`answered(p, 3, {spent: true})`, then a
  refresh body naming run 3 spent while `world()` holds no outcome: no restart posted; after `restore` of a world
  from before the failure: one restart `{from: 3}`; **M-P7h**, "reconcile ignores `endedHere`", turns it red with a
  restart posted before the restore), `values: a 409 for a failed restart's run posts it again` (the restart rejects:
  entry `failed`, masked; `learn` of run 3 spent: exactly one new restart `{from: 3}` and the entry `restarting`,
  never `ready` with run 3's digits; round 8: `learn` is the player's Try, so `fail` clears); **round 8 (r7 W1,
  m4):** `values: a spent run in a solved world keeps its code and shows no prompt` (run 3 live `1847` `ready`;
  `world()` holds `solved` for p; a refresh body names run 3 spent: `render` still shows `1847`, `shown` does not
  list p, `failing` stays false, no restart posted; the same with `abandoned` and `playing()` null; **M-P8b**, "the
  `ready` arm admits a spent run only in a `failed` world" (round 7's derivation), turns it red with `····` and a
  `failing` edge), `values: retry re-issues only the request that failed` (a failed restart: Retry posts exactly one
  restart `{from: 3}` and no fetch; a failed first fetch: Retry issues one fetch and no restart; a failed restart
  whose world meanwhile records `failed`: Retry posts nothing and the entry is `ready` with run 3's value, `failing`
  false; **M-P8j**, "Retry re-posts every failed restart without re-deciding it", turns the third case red with a
  restart posted), `values: an automatic re-post of a failed restart keeps the prompt` (the restart rejects:
  `failing` true; an `activated` body names run 3 spent: one restart re-posted, the entry stays `failed`, no change
  reports `failing` false; the re-post resolves with run 4: `ready`, `failing` false once; **M-P8i**, "an automatic
  re-post clears `fail`", turns it red with `failing` false then true); (3) session: `puzzles: a per-player attempt
  sends its run`, **round 8 (r7 W2):** `puzzles: a try while superseded sends the last known run` (the store at run
  3 under `stale(p, 4)`: the request carries `run: 3`; the same for `restarting` from run 3 and for `failed` with
  `last` run 3; a store with no body sends no `run`; **M-P8a**, "`run()` returns null unless the entry is `ready`"
  (round 7's port), turns it red with no `run` in the first three requests), `puzzles: a spent answer ends the run failed`, `puzzles: value_changed counts nothing and learns the
  value`, `puzzles: value_changed on a spent run restarts and keeps the frame open`, `puzzles: a stale-run hint text is
  fetched again`, `puzzles: a value change drops the tier texts of another run` (W3; red: `valueChanged is not a
  function`); (4) yields: `yields: a per-player puzzle whose world failed ends failed without a session` (red on the
  parent: the session opens), `yields: a spent run in a fresh world restarts before Try opens`, `yields: a runless try
  on a spent run restarts instead of failing` (round 8: renamed from "a blind try ..."), `yields: a section reset
  restarts a spent puzzle before the room shows`,
  `yields: a changed hint tier re-plays hint-shown`, `yields: a failed values load shows the Retry prompt`, `yields: a
  restart while the ladder is open re-reads tier 3` (W3; predicted red on the parent: the ladder still shows the run-3
  text), `yields: a re-read of a dropped tier fetches its text` (W3), `yields: a lock tap while values load opens the
  frame checking` (W6; predicted red: no frame until `ready` resolves), `yields: a run change in an open frame plays
  renewed` (W6; the fake bus records `puzzle:renewed`), `yields: a dropped tier text plays hint-renewing on its tier`
  (r3 m7; the fake bus records `puzzle:hint-renewing` with `index` 3 before `hint-shown`; predicted red on the parent:
  no cue between the drop and the re-fetch); **round 6 (r5 W2), `syncValues`:** `yields: values that land in an open
  frame play ready` (a lock tapped with the entry `loading`, then the load resolves: the frame ends `busy: false`,
  `line: 'idle'`, the fake bus records `puzzle:checking` then `puzzle:ready`; predicted red on the parent: no frame
  until `ready` resolves, as the W6 test; the gate's own mutation **M-P6a**, "the wait's end writes `busy: false`
  without a cue", turns it red with only `puzzle:checking` recorded), **round 7 (r6 m4, renamed from round 6's
  "... shows offline with its cue"):** `yields: a values failure ends the frame's wait with ready` (the load rejects
  under a waiting frame: `line: 'idle'`, `busy: false`, the bus records `puzzle:checking` then `puzzle:ready` and no
  `puzzle:offline`; Try enabled, read through `PuzzleHost`'s `canTry` inputs; the prompt shown; **M-P7c**, "the
  `failed` row writes `offline` with `puzzle:offline` for any frame" (round 6's row), turns it red), `yields: a failed
  restart ends the frame's wait with ready` (a 409 on a spent run keeps the frame `checking` while the restart runs;
  the restart rejects: `idle` + `puzzle:ready`), `yields: values that land after a failed wait show the attempts with
  ready` (capped: Retry resolves, `attemptsLeft` null -> 3 with one `puzzle:ready`, `index` 3; uncapped: the frame
  changes nothing and no cue is recorded), **round 7 (r6 W1):** `yields: a failed activated refresh leaves an idle
  frame idle` (an idle frame with 2 attempts left; `activated()`, the refresh rejects: the frame is the same object,
  no cue, no toast; red under **M-P7a** with the prompt shown, and on round 6's whole design, M-P7a with M-P7c,
  with `line: 'offline'` and `puzzle:offline`, the critic's trace; M-P7c alone leaves it green, since a correct store
  keeps the entry `ready`), **round 7 (r6
  m1):** `yields: a refresh during a try plays only the outcome` (replaces round 6's `yields: a store change during a
  try waits for its outcome`, which expected a `puzzle:ready` no consistent reading produces: a capped puzzle at 3,
  Try in flight, an `activated` refresh resolves with 3, then the reply `{correct: false, attemptsLeft: 2}`: the bus
  records `puzzle:checking`, `puzzle:wrong` and nothing after, the frame shows 2; round 8 (r7 m2): its mutation is
  **M-P8c**, "an outcome pass also cues a same-run count change", red with `puzzle:ready` after `puzzle:wrong`, and
  **M-P8d**, "`syncValues` waits on the session's in-flight marker instead of `trying`" (r7 m1's first reading: the
  marker is cleared before `#settle`, `session.ts:221-226`), red with `puzzle:ready` **before** `puzzle:wrong`;
  round 7's M-P7d moved to the next test, since under a correct `settle` no base reaches this one), **round 8 (r7
  m2):** `yields: a count seen during a try reaches the frame at its no-outcome reply` (round 9, r8 m3: the fixture
  no longer uses `invalid`, which `attempt()` returns before its first `await`, `session.ts:215-218`, so its pass
  could run before the refresh body's handler and leave M-P7d green; the order is now forced through a real await:
  the frame shows 3; Try with a valid answer, the fake api's `postAttempt` **held**; an `activated` refresh brings 2,
  another device's wrong answer, and the test awaits its handler (`trying` holds the pass); then `postAttempt`
  resolves 429 with `retryAfterSecs: 0`, so `attempted` -> `countdown(o, 0)` reaches the zero's no-outcome pass at
  once (`yields.ts:619-624`): that pass writes `line: 'idle'`, `attemptsLeft` 2 and exactly one `puzzle:ready` with
  `index` 2 (the assertion counts `puzzle:ready` only: GM3p's countdown cue, `puzzle:rate-limited` per tick,
  [engine GM3p `mech-puzzle-cues`](../engine/12c-lanes-gm3.md#gm3p-mech-puzzle-cues) as read, may precede it);
  **M-P7d** (restated), "the values patch comes from the store event's diff (previous entry -> new entry), not from
  the frame", turns it red with `attemptsLeft` 3 at the zero: the pass has no event, so its diff is empty), `yields:
  a refresh after the outcome with a lower count plays ready` (after that `wrong`, a refresh brings 1: `attemptsLeft`
  1 and one `puzzle:ready` with `index` 1), **round 7 (r6 m3):** `yields: a store change during a countdown waits for
  its zero` (a 429 with `retryAfter` 3; a refresh brings a lower count at second 2: every tick keeps `line:
  'rate-limited'` with its seconds and the old count; at the zero `line: 'idle'`, the new count, exactly one
  `puzzle:ready`; **M-P7e**, "`syncValues` runs during a countdown", turns it red with **the frame's count changing
  at second 2 with a `puzzle:ready` there, and a second `puzzle:ready` at the zero: two recorded, one expected**
  (round 8, r7 m2: round 7 predicted "`line: 'idle'` while `retryAfter > 0`", which row 3 cannot write: it patches
  `attemptsLeft` only)),
  `yields: a no-outcome reply with a run change plays renewed alone` (a refresh brings run 4 during the try; the
  session answers `invalid`: one `puzzle:renewed`, no `puzzle:ready`; **M-P7f**, "the pass emits the writer's cue and
  the values cue", turns it red with `ready` then `renewed`), `yields: values that land after a failure dismiss the
  Retry prompt` (the prompt shown at the failure leaves at the landing: `dismissToast('values_failed')` recorded once),
  `yields: a value_changed reply plays
  renewed, never offline` (E-P15 (c); seen red on the mutation "`value-changed` falls into the `network` branch");
  **round 8 (r7 W1, W2, m1, m3; E-P17):** `yields: a linear re-entry after give-up restarts a spent run before Try
  opens` (a linear per-player puzzle with `giveUp`; the world holds `abandoned`; the store's run 3 is spent; the
  story re-enters it: one restart `{from: 3}` posted, the frame `checking` until it lands, then `renewed` with run
  4's count; a second case with `solved`; predicted red on round 7's design: no restart, the frame idle, and a Try
  answered 409 with run 3 spent), `yields: a try with no known run unmasks the code instead of judging it` (the first
  fetch rejects; the dials set to `1847`; Try: the request carries no `run`; the fake route answers 409 with run 1
  `1847`: the bus records `puzzle:checking` then `puzzle:renewed` and no `puzzle:wrong`, the frame shows the body's
  `attemptsLeft`, `dismissToast('values_failed')` once, no `puzzle_value_changed` toast (mask -> digits); predicted
  red on round 7's design: the attempt is compared and the frame plays `wrong`), `yields: a failed restart ends the
  frame's wait with ready` gains **M-P8e**, "`syncValues` waits on `frame.busy` instead of `trying`" (r7 m1's second
  reading), red with the frame left `checking` and no `puzzle:ready`; GM3p's `yields: a busy reply leaves the frame
  to the attempt in flight` gains a per-player case (a store change pending under the first attempt is applied once,
  by that attempt's pass; **M-P8f**, "`settle` treats `busy` as a no-outcome reply", red with `line: 'idle'` and Try
  lit while the first attempt is in flight; E-P17 (b)), `yields: a chapter change restarts nothing of the chapter
  left` (ch1's spent puzzle in a world holding `failed`; `chapterChanged()`: no restart posted; `chapterEntered()`
  for ch2: ch2's fetch only; **M-P8h**, "`chapterChanged` calls `values.reconcile()`" (round 7's call list), turns it
  red with a restart `{from: 3}` of ch1's puzzle); GM3p's state gate `yields: every visible change of the puzzle view
  plays a cue` gains this file's steps (E-P17 (c)): values landing and failing under a waiting frame, a 409 on a
  spent run with its restart landing and failing, a run change during a try and during a countdown, an `activated`
  refresh with another count, a runless Try's 409, a linear re-entry's restart; it is seen red on **M-P6a** at the
  "values landing" step (a frame change with no cue), and GM3p's `yields: the ladder has one writer` stays green by
  name with the W3 writes going through `setLadder` (E-P17 (a)); **round 9 (E-P18 (b)):** GM3p's `post(o)` gains `o.trying
  = true` as its first write (round 8 had this lane land `post(o)` itself; engine.md accepted R-E28 with GM3p as its
  lander), GM3p's pin `yields: every attempt starts through post` stays green by name, and R-E28's `yields: a store
  change during any attempt waits for its outcome` covers every post site present at this cut (`ontry`, and
  GM7r's / GM8h's when merged; red on the parent: no `trying`, so `syncValues` cues before the outcome);
  **round 9 (E-P18 (a)):** `yields: a values wait over a cached type chunk keeps Try disabled` (the chunk loader
  resolves before `values.ready(p)`: after `loadPuzzleUis` the frame has `ui` set while `busy` is still true and
  `line` still `checking`, so `PuzzleHost`'s `canTry` inputs keep Try off until `puzzle:ready`; red on round 7's
  engine text, engine.md's **M-R8a**, "the chunk write clears `busy`"), and the state gate gains the steps "a values
  wait over a cached chunk" and "a chunk failure during a values wait" (the notice with Retry enabled, `retrying`
  false, while the status line keeps `checking`; the values' end plays `puzzle:ready` / `renewed` on its own);
  **round 9 (r8 W1, m1):** `yields: a frame over a puzzle the store does not hold shows the failing state with Retry`
  (the fake host's chapter switched to ch2 with no `chapterEntered` / `restore`, the defect class; ch2's per-player
  lock opened: no wait, the frame `idle`, the bus records `puzzle:checking` then `puzzle:ready`, `showToast` with key
  `values_failed` once, Try enabled; Try sends no `run`; Retry: one `getValues('ch2')`, then the digits; red under
  **M-P9b** with the frame left `checking`; the state gate gains the step "a frame over an unheld puzzle"), **round 10
  (r9 W1):** `yields: a render that meets a puzzle the store does not hold shows the Retry prompt` (the store on ch1
  with `1847`; the fake host's chapter switched to ch2, which has a per-player `drawer`, with no `chapterEntered` /
  `restore` and no frame open, the defect class off the frame path; `render('$code(drawer)', null)` returns the run
  `pending`; after one microtask `showToast` with key `values_failed` exactly once; a second `render` in the same
  task and one after it: no second `showToast`; a `render` of a text with no placeholder schedules nothing; Retry: one
  `getValues('ch2')`, then the digits and `dismissToast('values_failed')` once; **M-P10b**, "`render` schedules no
  `syncPrompt`", turns it red with no `showToast`), `yields: a
  restart after a spent-run Try shows the value-changed toast` (r8 m1, the primary race row of §3.6: the store shows
  V at run 3, the frame open; Try with run 3 -> 409 `{run 3, spent}`; the entry `restarting` (masked); the restart's
  200 brings run 4 V': `puzzle:renewed`, then `showToast` with key `puzzle_value_changed` exactly once; a second case
  with a solved run, whose restart keeps V: `renewed` and no toast; **M-P9d**, "`recoded` compares with the entry
  before this event", turns the first case red with no toast, since that entry was the mask);
  **reconcile P1 (E-P20-E-P22):** the four wait tests (`a lock tap while values load opens the frame checking`,
  `values that land in an open frame play ready`, `a values failure ends the frame's wait with ready`, `a failed
  restart ends the frame's wait with ready`) set `puzzle.host` through the store before the open and assert the bus
  filtered to `puzzle:*`; the first gains a deferred-chunk case that lists `ui-state:waited`, `panel-open`,
  `puzzle:checking`, `puzzle:opened` in that order (red if the open emits its own `puzzle:checking`: two `checking`,
  the first before `panel-open`, **M-PR1j**); `yields: values that land before the host chunk play no frame cue` (a
  fresh `PuzzleView`, the type loader deferred, values resolved first: no frame cue recorded; the chunk write records
  `panel-open` and `puzzle:opened` with the frame already `idle`; seen red on **M-PR1k**, "`syncValues` emits on the
  bus directly, bypassing yields' shown-frame test", with `puzzle:ready` before `panel-open`); GM6c2's values and restart waits appended as answer
  rows to `yields: every wait of the views holds a motion` (`WAIT_CASES`: start `puzzle:checking`, end a
  `CHECKING_ENDS` key; each row declares the frame write's `puzzle` open and the chunk write's close beside its answer
  hold, E-P22 (d)); GM3p's `requests: every request start is a declared site` green by name with §5.2's four view
  rows (red before them: "unlisted request start app/values.ts issueFetch Endpoints.getValues"; **M-PR1h**, the
  values row declared `other`, red: "other row in a views file"); **reconcile P3:** `yields: dispose dismisses the
  values prompt and a queued prompt stays down` (the first fetch rejects: the prompt up; a `render` of a masked text
  queues `syncPrompt`; `dispose()` in the same task: `dismissToast('values_failed')` once, and after the microtask no
  `showToast`; a second `dispose()`: nothing; **M-PR1a**, "`dispose` leaves the prompt", red with no `dismissToast`;
  **M-PR1b**, "`syncPrompt` ignores `disposed`", red with a `showToast` after the teardown), `yields: every value
  surface renders through render` (a source count: `values.render(` exactly once in `yields.ts`, inside the wrapper,
  and the explore controller's `shown` dep is the wrapper; **M-PR1c**, "the `shown` dep calls `values.render`", red
  with two occurrences; reconcile r2, O1: when GM3p's walk carries `SITE_MEMBERS` at this cut (R-E34), the pin is
  replaced in this commit by the walk's `ValuesStore.render` row, `requests: every request start is a declared site`
  green by name with it, and M-PR1c re-pointed (red: "site outside ValuesStore.render app/yields.ts <fn>"), plus
  **M-PR2f**, "the `shown` dep is `const { render: r } = values` handed to the controller" (red on the walk, green on
  the source pin: the alias the count missed); reconcile r3 (E-P29 (c)): the row takes engine.md's adopted shape
  `{ label: 'render', member: { file: 'app/values.ts', type: 'ValuesStore', name: 'render' }, site: { file:
  'app/yields.ts', alias: 'RenderOrigin' } }`, so M-PR1c's and M-PR2f's expected red reads "render outside render
  app/yields.ts openSection" (the tester's mutation run is the oracle, §14 Q16), and GM3p's `SITE_MEMBERS` is a cut
  check, the source pin's fallback only if it is absent);
  (5) game: `game: activated refetches values`, `game: entering a chapter
  loads its values` (m2; predicted red on the parent: `load` sees the previous chapter), `game: an autosave after a
  values fetch holds templates only`, **round 8 (found while resolving r7 m3):** `game: a paywall resume of another
  chapter restarts nothing of the chapter left` (ch1 loaded with a spent per-player puzzle in a world holding
  `failed`; a save of ch2's start whose chapter load answers `not-entitled`: no restart posted; predicted red on the
  parent of the `chapterLeft()` hunk: one restart `{from: 3}` posted by the empty world's reconcile), **round 9 (r8
  W1, RULINGS 135 (a), the critic's test):** `game: a resume of the chapter left at a paywall loads its values again`
  (ch1 free with a live per-player `drawer`, the fake `getValues('ch1')` answering run 1 `1847`; ch2 paid, not owned;
  ch1 started; Menu -> Saves loads ch2's saved start, `ink: null`, so `loadChapter` answers `not-entitled` and the
  paywall shows; then a ch1 slot is loaded: `resumeBody` reuses `s.ch` and skips `enterChapter`; expected: a second
  `getValues('ch1')` after that resume, `s.yields.render('$code(drawer)', 'ch1')` gives `1847` in state `shown`, no
  `restartPuzzle` call; red under **M-P9a** with one `getValues`, the span `pending` and one `showToast('values_failed')`
  (the `syncPrompt` at that `restore`, `failing()` being true by its unheld clause; round 10, r9 m1: round 9 predicted
  the span `still`, which is round 8's whole design, whose `render` read the store's generation); on this commit's
  parent, where the paywall still calls `restore(EMPTY_WORLD_STATE, …)` and so never drops the store, red on the
  second `getValues` only), **round 10 (r9 W1, the critic's test):** `game: a language switch keeps the shown codes`
  (ch1 free, loaded in Russian, so `ch.en` is null; a per-player `drawer` whose fake `getValues('ch1')` answers run 1
  `1847`; ch1 started and the values landed; `setSettings({ ...settings, lang: 'en' })`, which runs `setLang`, whose
  fake `loadEn` answers a spread `{ ...ch, en: {} }` (`game.test.ts:477`, so `s.ch` becomes a new object of ch1 as
  `chapters.ts:273` makes it); after it settles: still exactly one `getValues` call, `s.yields.render('$code(drawer)',
  'ch1')` gives `1847` in state `shown`, no `showToast` with key `values_failed`; a **verification pin, green on
  arrival** (the id key lands in commit 1), labelled so, and seen red on **M-P10d** (reconcile P3, r10 m1; round 10
  named M-P10a, which this pin cannot see: the game test runs the real `createYields`, whose `heldOf` cache returned
  the same `HeldChapter` across the spread), "round 9's whole `chapter()`: the identity key **and** a `HeldChapter`
  cached per `LoadedChapter` object", expected red: the span `pending`, one `showToast('values_failed')` (`render`'s
  prompt scheduling over `failing()` true) and still one `getValues`; the tester's mutation run is the oracle for the
  exact red (r10 open question 2's rule, §14 Q16); a fixture whose `loadEn` returned the same object would leave it
  green under M-P10d, which is why the spread is named (`game.test.ts:480` on main `acc4e0d`). M-P10a stays the
  store test's mutation (`values: a new object of the held chapter keeps every code`, whose fake `chapter()` hands
  out a new object). The toast texts come from `vt` (`values: the toasts read the values table in
  both languages`, in commit 1). (6) **E-P12, only when engine.md's GM8h is merged at this cut** (else GM8h's cut
  carries it, R-E24): the `value-changed` branch calls `restartWork(open)` for a `commit: 'full'` type, test `yields: a
  re-drawn value restarts a full sequence` (a fixture per-player `commit: 'full'` type through the registry parameter,
  as GM8h's own full-commit tests do: a full-length sequence posted, the reply 409 `value_changed`; predicted red on the
  base: `run.work` still holds the full sequence and no `fact:work:removed` cue is recorded).
- **Gates:** check, test, build (engine row MEASURED; ARITHMETIC **+1.56 KB br**, one figure (r3 m4): ~240 lines
  +1.03 with `world/values.ts` counted here, its first importer, + `syncValues` ~14 lines net +0.06 (round 6), + round
  7's merge, refresh rule, `superseded`, `endedHere`, `failing`, `valuesPatch` / `settle` ~28 lines net +0.12
  (28 x 4.3 B = 120 B), + round 8's tokens, `owed` / `fail`, `playing`, `post(o)` / `trying`, `chapterLeft` ~15 lines
  net +0.06 (15 x 4.3 B = 64.5 B), + round 9's `sync` / `held` / `failing()` / `chapter()`, the unheld answers,
  `syncPrompt`, `lastShown` / `seenDigits`, the `awaiting` clear and the null-`best` fill, less `post(o)`'s body
  (GM3p's now), ~16 lines net +0.07 (16 x 4.3 B = 68.8 B), + round 10's per-puzzle unheld test, `render`'s prompt
  scheduling and `ShownDigits`, ~5 lines net +0.02 (5 x 4.3 B = 21.5 B), + the `i18n/values.ts` table ~360 B raw
  ~+0.2 (no new string in rounds 7-10: m4 reuses `ready`, a runless Try's 409 needs no text, and the unheld state
  reuses `values.failed` / `values.retry`; 1.03 + 0.06 + 0.12 + 0.06 + 0.07 + 0.02 + 0.2 = 1.56); round 7's eight
  store / yields mutations M-P7a-M-P7h (M-P7d on its round-9 fixture, M-P7e with its corrected red), round 8's ten,
  M-P8a-M-P8j, round 9's six, M-P9a-M-P9f (M-P9a and M-P9b with their round-10 reds), and round 10's three,
  M-P10a-M-P10c, each seen red on its named test (M-P10a on the store test; reconcile P3: **M-P10d** on the
  language-switch pin and on GM6c3's K49 pin, round 10's "M-P10a on the language-switch pin" withdrawn, r10 m1), and
  the reconcile's **M-PR1a-M-PR1e**, **M-PR1h**, **M-PR1j**, **M-PR1k**, each seen red on its named test; GM3p's `setLadder` pin, its busy-reply test, its state
  gate, `yields: every attempt starts through post`, `yields: every wait of the views holds a motion` and
  `requests: every request start is a declared site` green by name; the
  **entry row unchanged** within 0.02 KB br, the proof that the strings left the entry, r3 W1; reconcile P4: + the
  two forwarders (~2 lines), `createHeldOf`'s split (~0 net), the `dispose` dismissal with `disposed` and its
  `syncPrompt` guard (~3) and `refresh`'s per-puzzle form (~1), ~7 lines, ARITHMETIC 7 x 4.3 B = 30.1 B, +0.03, so
  **+1.59 KB br**; the first-line and all-JS rows quoted
  base -> HEAD at the cut against §10 "Ledgers", STOP if a sum crosses its LIMIT), e2e full (unchanged).
