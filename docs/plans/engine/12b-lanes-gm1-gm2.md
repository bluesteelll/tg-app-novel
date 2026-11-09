### GM1a `mech-run-split`
- **Goal:** §3.3-§3.5 behaviour-identical (`RULES_VERSION = 1`); spike P1 (engine / explore-ui before and after).
- **After:** M3c merged (m1: `explore/controller.test.ts`, RULINGS 120); design adopted.
- **Lock (15):** new `client/src/mechanics/rules/core.ts`, `client/src/mechanics/rules/search.ts`;
  `client/src/explore/{reduce,reconcile,controller}.ts`; `client/src/app/yields.ts` (`act`, imports);
  `client/src/arch.test.ts`; `client/src/explore/{explore,controller}.test.ts`; `client/src/app/yields.test.ts`;
  `client/scripts/story/{softlock,playthrough,world}.ts`; `client/scripts/story/softlock.test.ts`;
  `client/src/story/resume.test.ts` (m1: step 4 turns `:347`, `:352` `expect(...reset).toBe('yard')` red; they move to
  the entry-time reset).
- **Commits:** (1) `arch: rules-lazy red on fixture` + `allows fixtures` (red: the RED record has no `rules-lazy`
  violations; a TS error instead means the `RuleId` tuple was not extended); (2) move rules and searches; red
  `explore: runReduce leaves a lock puzzle's outcome alone` (TS2305 `runReduce` missing; any assertion red means the
  move changed behaviour); pins `reduce: rules golden pinned to RULES_VERSION` (`explore.test.ts:852-888`) and every
  softlock / play test unchanged; (3) step 4: `reconcile: a re-versioned save leaves every section unproved`
  (red: `unproved` lacks the current section, `reconcile.ts:309`), `controller: a save the new world cannot produce
  resets at its first entry` (red: no `reset` effect at entry), `controller: inside an event knot the return proves
  the section` (red: the event route returns no `reset`); (4) build log P1.
- **Gates:** check, test, story (states unchanged: ch1 406), build (engine and explore-ui rows MEASURED vs ledger),
  e2e full (behaviour-identical).
- **Conflicts:** first holder of `explore/**` after LFU3's freeze; `yields.ts` free since LFU3.

### GM1b `mech-registry`
- **Goal:** contract, registries with module `core`, derived action union, writer (fact changes recorded), derived
  `sectionKey` + property test, build-only lint registry (`WorldLint` with its own `codes`, round 4; round 5, per-player
  R-E22: the union of a per-world `lint` and a codes-only `runsFrom: 'story'` entry, §3.2), spike P2-a;
  round 4: the `arrived` hook (m9). No `controls` field yet (round 4 m2: GM3m adds it with its types). Round 6 (W1):
  the decode inputs `Place`, `OwnedAt`, `OwnedRaw`, `IssueReport`, `DecodeCtx` and `Issue = WorldIssue` in
  `contract.ts`, and `WorldLintInput` (the `lintWorld` inputs plus `line(path)`) in the lint registry, all types in
  files of this lock, so GM3c fills them without touching `contract.ts` (GM3m, beside GM3c, holds it).
- **After:** GM1a.
- **Lock (15):** new `client/src/mechanics/{contract.ts,data/index.ts,data/core.ts,rules/index.ts,rules/writer.ts}`,
  `client/src/mechanics/registry.test.ts`, `client/scripts/story/mechanics/{index,core}.ts`,
  `client/scripts/story/spike-p2.test.ts`; `client/src/mechanics/rules/{core,search}.ts`;
  `client/src/explore/{reduce,reconcile}.ts`; `client/scripts/story/world.ts`; `client/src/explore/explore.test.ts`.
- **Commits:** (1) `mechanics: every key has one owner`, `mechanics: data and rules registries align` (red: TS2307
  module missing; mutation: swap two tuple entries -> red); (2) writer: `writer: a set records the added and removed
  members`; (3) derived key: `search: derived sectionKey equals the hand key on ch1 and ch2` (pin), then
  `search: equal section keys have equal successor keys` (seeded), seen red on mutation **M-R3** (`core.reads` omits
  `held`); (4) P2-a: `spike p2: views at 2 per room fit the cap at ch1 density` (states and ms reported); (5) round 3,
  the tap hook (§3.2): `mechanics: a hotspot a module claims routes its tap to the module` and `search: a claimed
  hotspot has one tap edge` (a fixture module through the registry parameter; red: TS2339 `tap` on `MechanicRules`;
  ch1 / ch2 states unchanged, since no world claims a hotspot yet); (6) round 4 (m9), the arrival hook in
  `mechanics/rules/core.ts`'s three `room` pushes: `mechanics: an arrival hook runs once per room effect, after onEnter,
  and never while an event knot is pending` (a fixture module; red: TS2339 `arrived`; a red on the count means a push
  site was missed), `mechanics: a puzzle end runs no arrival hook`, `search: an arrival hook adds no state` (a fixture
  world whose hook opens its room's zero-slot lock puzzle on arrival proves the same state count as without the hook;
  ch1 / ch2 stay at their counts).
- **Gates:** check, test, story, build.
- **Beside:** none (it opens the module contract every later lane reads).

### GM1c `mech-puzzle-instance`
- **Goal:** §7.1 for `code` / `order`: `PUZZLE_TYPES`, data halves with `check`, `goal`, `presentation`, `wrong`,
  `commit` (round 4), `startShown`, optional `workFits` / `demo`; `PuzzleInstance` with `start(run)` and `demo()`
  (round 4, W1, m7); play halves; `PUZZLE_UI`; build-only `PuzzleTypeLint` and its registry `PUZZLE_LINTS` (round 4 m5).
  Round 5 (m1): `start(run)` returns `initial()` for every type here (no `run.work` read; GM8h adds the `work` branch),
  and the runtime seam for fixture types: `PuzzleTypes`, `instanceOf`, `puzzleInstance(p, types?)`, the optional
  `types` of `decodeWorldSource` / `decodeWorldPublic` and `PuzzleSessionDeps.types` (§7.1).
- **After:** GM1b; before GM1d, GM7p. Beside GM2a (disjoint in files **and types**: `PuzzleRun.work` is optional and,
  round 5 m1, GM1c never reads it, so neither lane's `check` depends on the other's merge, m1). Also adds `toServer`'s
  optional `renderHints` parameter (identity default, §7.1). No `controls` (round 4 m2: GM3m).
- **Lock (16; one over the soft bound, as GM3: the lint registry and its first two members are one unit, and a
  registry file with no member would be dead code until GM7p):** `client/src/puzzles/rules/{index,code,order}.ts`, new
  `client/src/puzzles/play/{code,order}.ts`, `client/src/puzzles/{registry,session}.ts`,
  `client/src/world/{types,decode}.ts`, new `client/scripts/story/puzzles/{index,code,order}.ts` (round 4: `index`),
  `client/scripts/story/world.ts`, `client/src/puzzles/rules/rules.test.ts`, `client/src/puzzles/session.test.ts`,
  `client/src/arch.test.ts` (`rules-lazy` += `puzzles/play/**`; the registry pin `:929-932` stays).
- **Commits:** (1) `puzzles: every type has a data half, a loader and a lint` (red: TS, `PUZZLE_UI` or `PUZZLE_LINTS`
  misses a key); round 3: the data halves carry `wrong`, `startShown` (`code` / `order`: `initial`) and the optional
  `workFits`, pinned by `puzzles: a commit type posts its wrong answers; a reach type has none or a local one`
  (mutation: `order.wrong = 'none'` -> red); round 4: `commit: 'control'` on both, pinned by `puzzles: a full-commit
  type is a view commit type and a demonstration shows only a shown goal` (a fixture `demo` on a `secret` type -> red);
  (2) `session: an instance answers initial and shape for every type` (red: TS2305 `puzzleInstance`); the switch sites
  `session.ts:134-158` deleted; round 4: `session: a session starts from the instance's start answer` (red: TS2339
  `start`; `code` / `order` behaviour-identical, since `start` returns `initial()` for every type in this lane, round 5
  m1); round 5 (m1): `session: a fixture type passed as types opens a session` and `puzzles: a fixture type passed as
  types decodes in a world` (in `rules.test.ts`; a fixture data half through the new parameter; red: TS2353, `types` is not a known property; a red on
  the answer instead means `puzzleInstance` ignored `types`); (3) `arch: rules-lazy red on fixture` (the `puzzles/play`
  fixture).
- **Gates:** check, test, story, build (puzzle-type row unchanged within 0.1 KB). Round 5: the lock stays 16 (the seam
  lives in `world/decode.ts`, `puzzles/session.ts`, `puzzles/rules/index.ts`, all already held; the tests in
  `session.test.ts` and `rules.test.ts`, also held, so no `decode.test.ts` edit).

### GM1d `mech-clues` (new; round 3 adds the answer-length bound)
- **Goal:** §7.3's lints and the source key `clues`; the demo puzzles declare their clues; round 3 (W3): §7.4's
  `world/answer-len` and its server pin, before any type that can post more than 6 entries exists.
- **After:** GM1c. Before GM7p and per-player GM6c1a (which applies `world/clue-reachable` to per-player puzzles).
  **Beside:** GM3m, GM3w.
- **Lock (12):** `client/src/world/{types,decode}.ts`, `client/src/world/decode.test.ts`, new
  `client/scripts/story/mechanics/clues.ts`, `client/scripts/story/mechanics/index.ts`,
  `client/src/mechanics/rules/search.ts` (a search option: an excluded step), `client/scripts/story/lint.ts`,
  `client/scripts/story/world.test.ts`, `story/ch1/world.json`, `story/ch2/world.json` (the story commit by the
  `narrative-designer` role: `clues` for `drawer`, `gate`, `cabinet`), `client/scripts/story/build.test.ts`
  (`clues` stripped from the public world), new `client/scripts/story/puzzles/shape.ts` (round 3).
- **Commits:** (1) `world: a source puzzle's clues decode` (red: unknown key `clues`), `emit: clues never reach the
  public world`; (2) `story: a secret puzzle without clues is refused`; (3) `story: a clue behind its own puzzle is
  refused` (seeded: the diary inside the drawer; red: no finding); (4) round 3: `story: an answer longer than
  MAX_ANSWER_LEN is refused` (a fixture type posting 17; red: TS2307 `shape.ts` missing, then no finding) and `story:
  the build's answer bound never exceeds the server's MAX_ANSWER_LEN` (seen red on client = 17; a red on "no match"
  means the server constant moved or was renamed, a STOP item); (5) the story commit; `npm run story` 0 errors.
  Round 4 (found while resolving): commit (0), before (1): `lint.ts`'s one hunk widens `Finding.code` to `LintCode |
  MechanicLintCode | PuzzleLintCode` (§3.2), and this lane's codes (`world/clue-declared`, `world/reach-has-clue`,
  `world/clue-reachable`, `world/answer-len`) live in `clues.ts`'s and `shape.ts`'s own `codes` (`shape.ts` registered
  in `MECHANIC_LINTS` as `puzzle-shape`); test `story: module and type lint codes are unique and none is a DSL code`
  (red: TS2322 on a module finding's `code` before the hunk; then seen red on a fixture lint whose `codes` holds
  `world/softlock`, and, round 5 R-E22, on a fixture `runsFrom: 'story'` entry repeating a module code); pin `dsl-doc: lint table equals lint codes` green at 86 (`dsl-doc.test.ts:146`). verify at the
  cut: `story.ts:459-475`'s allowlist reader accepts the union.
- **Gates:** check, test, story, build (world rows: bytes unchanged, `clues` stripped).

### GM2a `mech-save-v2`
- **Goal:** §5.2 (round 3: `normalize` drops a `work` only with the run of a puzzle the world lost; the fit rule is
  GM8i's).
- **After:** GM1b (`explore/reconcile.ts`, `explore.test.ts`), GM1a (`yields.ts`, `resume.test.ts`); **before the
  first adopted animation / shot lane on `app/game.ts`** (rev. 3: MD2; RULINGS 132; orchestrator Q2; reconcile r1:
  SH1) and before
  per-player GM6c2. **Beside:** GM1c.
- **Lock (14):** `client/src/story/{save-codec,staging,resume}.ts`, new `client/src/story/fixtures/save-1-ch1.json`,
  `client/src/explore/{state,reconcile}.ts` (normalize: flags, `work`), `client/src/app/game.ts` (12 type references,
  `:571`, `:578`, `:1172`, `:1180`; no other hunk), `client/src/app/yields.ts` (`roomProps` sets `at`),
  `client/src/story/{save-codec,resume}.test.ts`, `client/src/app/{game,yields}.test.ts`, `client/e2e/helpers.ts`
  (body literals `:584-592`), `client/src/explore/explore.test.ts` (WorldState literals; re-located at the cut).
- **Reconcile r1 (design-shots I-1):** `StagingSnapshot.cam?: CamState` and the types `CamTarget` / `CamState` in
  `staging.ts` (held), read by the codec's optional-key rule (§5.2); no lock change (14). After LFL (merged `cec347c`)
  and LRB (in flight, RULINGS 156) on `game.ts` / `game.test.ts`; its `game.ts` type references are re-located on the
  parent at the cut (LFL moved `game.ts` lines).
- **Commits:** (1) `save: a format-1 body upgrades to format 2` (golden; red: `unknown-format`); (2) `save: format 2
  round-trips` (with and without `run.work`, with `chapterStart.items`; reconcile r1: with and without
  `staging.cam`, in `staging` and in `checkpoint.staging`) and `save: the upgrader chain is total`; reconcile r1: `save:
  a camera state outside the grammar fails at its path` (a `push` with `z: 104`, `z: 131`, `z: 110.5`, a `to` that
  is no name, an unknown `kind`: each `save.staging.cam...`; red on the parent: TS2353, `cam` is not a known property
  of `StagingSnapshot`), with **M-RCo** (the reader declared required: red, a format-2 body without `cam` fails
  "missing", the round-trip case) and **M-RCp** (the `z` range check removed: red, `z: 131` decodes);
  (3) `mechanics: slice keys pinned to SAVE_FORMAT` (mutation: a slice key not in `SAVE_FIELDS[2]` -> red); (4) `yields:
  a room batch's props carry their anchor key` (red: no `at`).
- **Gates:** check, test, story, build, e2e full (saves written and resumed in format 2).

### GM2b `mech-renamed`
- **Goal:** §5.3, §5.4 (compact world emission, MEASURED).
- **After:** GM1d (world chain), **GM2a** (`explore/reconcile.ts`, `explore.test.ts`; round 3 m1: GM2a, after GM1b,
  can still be open when GM1d merges). **Beside:** GM3m, GM3w.
- **Lock (10):** `client/src/world/{types,decode}.ts`, `client/src/explore/reconcile.ts`,
  `client/scripts/story/{emit,world}.ts`, `client/scripts/story/mechanics/core.ts` (round 4: the four `renamed` codes
  in the core lint file's `codes`, replacing `client/scripts/story/lint.ts`), `client/src/world/decode.test.ts`,
  `client/src/explore/explore.test.ts`, `client/scripts/story/{world,build}.test.ts`.
- **Commits:** (1) `reconcile: step 0 maps renamed items, docs, rooms, sections and hotspots before normalize` (red:
  `dropped` lists the old id); (2) emit chains + lints: `story: a rename chain resolves to its final target`,
  `story: a rename to a missing target / of a live source / in a cycle is refused`, `story: renamed.puzzles is
  refused` (R-E4; round 5, per-player R-E23: in `client/scripts/story/world.test.ts`, the world-lint test file, which
  GM6c1b edits when it lifts the refusal); (3) `emit: the public world is compact and keeps its version` (red: newlines in the file);
  (4) `emit: server hints pass through the type's renderHints` (the `emit.ts:428` call site passes the build registry's
  renderer; a fixture type whose renderer upper-cases proves it is called; code / order output byte-identical).
- **Gates:** check, test, story, build (world rows MEASURED before / after).
