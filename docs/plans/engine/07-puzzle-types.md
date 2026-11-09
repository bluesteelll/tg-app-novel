## 7. Puzzle types

### 7.1 The run-site split for types (m2)

```ts
// ENGINE: client/src/puzzles/rules/<type>.ts (pure). PUZZLE_TYPES as const derives PuzzleType.
export interface PuzzleTypeData<T extends string, P> {
  readonly type: T;
  readonly check: 'commit' | 'reach';            // when an attempt is posted
  readonly goal: 'secret' | 'shown';             // 'shown': the type's own UI draws its goal (I4); reach <=> shown
  readonly presentation: 'overlay' | 'view';
  /** Where a wrong input is known (W2, round 3): 'none' = no wrong state (`maxAttempts` refused); 'posted' = the
   *  server's reply to a POST; 'local' = the device sees it itself and counts it through `session.failLocal()`. */
  readonly wrong: 'none' | 'posted' | 'local';
  /** What posts a commit type's attempt (round 4, m8): 'control' = a Try or the device's own commit part (`code`,
   *  `order`, `setting`); 'full' = the device posts when the working answer reaches `answerShape(p).len`, posts it
   *  again when a 429 countdown ends, and restarts from `initial` after any reply that is not correct (`ritual`).
   *  Reach types: 'control' (unused). Pinned: 'full' implies `check === 'commit'` and `presentation === 'view'`. */
  readonly commit: 'control' | 'full';
  decodeParams(raw: unknown): Result<P, string>;     // strict, with the per-type bounds of §7.2
  /** Commit types: the posted length and value bound. Reach types: the longest working answer (the posted length is
   *  `solve(p).length`, known at build). The build bounds what is posted (`world/answer-len`, §7.4), not this comment. */
  answerShape(p: P): { len: number; max: number };
  /** The working answer a session starts from (`code`: zeros; `ritual` / `sequence`: `[]`, a press sequence grows). */
  initial(p: P): readonly number[];
  /** The full-length configuration the device shows before any input (`code`, `order`, `setting`: `initial(p)`;
   *  `ritual`: null, nothing of answer length is ever shown). Per-player's floor excludes it when non-null (m7, E-P9). */
  startShown(p: P): readonly number[] | null;
  /** View types: whether a saved working configuration still fits p (lengths, ranges); the devices `normalize` drops a
   *  `work` that does not (critic r2 open question). Absent: the type saves no `work`. */
  workFits?(p: P, work: readonly number[]): boolean;
  /** A shown-goal device that demonstrates its goal (round 4, m7; `sequence`: its `order`): the parts to play, in
   *  order. yields' demo runner plays them as `puzzle:demo` cues (§7.5). Absent: no demonstration. */
  demo?(p: P): readonly number[];
  /** The type UI's controls and triggers (§8.3); `ControlCue` derives from these, so a type lane never edits
   *  cues/types.ts, and each control's motion is `UI_MOTIONS`' default or its `motion`, so it never edits motions.ts.
   *  Round 4 (m2): optional, and **added by GM3m** with `ControlDecl`; `code` / `order` declare none (their controls are
   *  `CORE_CONTROLS`); every type from GM7p on declares its own. */
  readonly controls?: readonly ControlDecl[];
}
/** Built once per puzzle at decode (no consumer switches on type; removes session.ts:134-158). */
export type PuzzleInstance = { readonly type: PuzzleType; readonly shape: { len: number; max: number };
  readonly check: 'commit' | 'reach'; readonly goal: 'secret' | 'shown'; readonly presentation: 'overlay' | 'view';
  readonly wrong: 'none' | 'posted' | 'local'; readonly commit: 'control' | 'full'; initial(): readonly number[];
  /** Round 4 (W1): the answer a session starts from: `run.work` for a 'view' type whose `workFits` accepts it, else
   *  `initial()`. The session's constructor calls it (`session.ts:193` today calls `initialAnswer`), so `run.work` is
   *  the saved copy of the session's answer, one value. Round 5 (m1): GM1c lands it returning `initial()` for every
   *  type (only `code` / `order` exist, both 'overlay', and `PuzzleRun` has no `work` until GM2a,
   *  `client/src/explore/state.ts:8`); **GM8h adds the `work` branch** in `instanceOf`, the first lane with a 'view'
   *  type (a fixture) and with GM2a's field in its tree. */
  start(run: PuzzleRun): readonly number[];
  /** Round 4 (m7): the demonstration order, or null. */
  demo(): readonly number[] | null };
/** Round 5 (m1): the runtime type registry's shape, and its one seam for fixture types. Every runtime reader of the
 *  data halves takes `types` (default `PUZZLE_TYPES`): `decodeWorldSource(raw, o?: { types?: PuzzleTypes })` and
 *  `decodeWorldPublic` (GM1c, `world/decode.ts`), `createPuzzleSession(deps)` through `PuzzleSessionDeps.types?`
 *  (GM1c, `puzzles/session.ts`), and yields' host `h.puzzleTypes?` passed to `createPuzzleSession` (GM7r,
 *  `app/yields.ts`: the first lane whose yields tests open a fixture type). Production passes nothing; a test passes `[...PUZZLE_TYPES, FIXTURE]`. A fixture's `type` string
 *  lies outside `PuzzleType` at runtime only in tests; after GM1c no runtime code switches on `type` except the UI
 *  loader `PUZZLE_UI[type]`, which yields' tests replace with `h.chunks`. verify at GM1c's cut: a
 *  `PuzzleTypeData<'code', CodeParams>` is assignable to `PuzzleTypeData<string, unknown>` (method syntax is bivariant
 *  under `strictFunctionTypes`); fallback: `PuzzleTypes` as a tuple of `AnyPuzzleTypeData` built by a helper. */
export type PuzzleTypes = readonly PuzzleTypeData<string, unknown>[];
/** The instance of one puzzle from its type's data half (the one runtime place that builds an instance). */
export function instanceOf(data: PuzzleTypeData<string, unknown>, params: unknown): PuzzleInstance;
/** The instance of a decoded puzzle, looked up in `types` by `p.type`; null for a type `types` lacks (a bug: decode
 *  refused it). */
export function puzzleInstance(p: PublicPuzzle, types?: PuzzleTypes): PuzzleInstance | null;
// PLAY (chunk): client/src/puzzles/play/<type>.ts, imported only by puzzles/ui/<Type>.svelte.
export interface PuzzleTypePlay<P> {
  validAnswer(p: P, a: readonly number[]): boolean;              // enables the commit control
  reached?(p: P, a: readonly number[]): boolean;                 // reach types
  canonical?(p: P, a: readonly number[]): readonly number[];     // reach types: what is posted
  press?(p: P, work: readonly number[], part: number): { work: readonly number[]; wrong: boolean };  // devices
}
// UI loaders: client/src/puzzles/registry.ts
export const PUZZLE_UI: { readonly [T in PuzzleType]: () => Promise<Result<Component<PuzzleUiProps>, ChunkError>> };
// PuzzleUiProps gains: onreach?(canonical: readonly number[]): void (GM7r); oncue?(name: GestureCue, index: number):
// void (GM7r: a gesture step, §8.3); onwork?(work: readonly number[], wrong: boolean): void (GM8h; `wrong` true only for
// a `wrong: 'local'` type); oncommit?(): void (GM8h, round 3: a `commit: 'control'` device's own commit part,
// `setting-pull`, posts through the host's Try path, `ontry`, `yields.ts:687-695`, since a device bar has no Try; round
// 4: `ritual` is `commit: 'full'`, so yields posts it and its UI never calls `oncommit`); ondemo?(): void (GM8h, round 4
// m7: the device's own replay control asks yields to play the demonstration again).
// Round 4 (W1): a `presentation: 'view'` type reports every input through `onwork` only, never `onchange`, and renders
// the session's `answer` prop as every type does (`registry.ts:11-23`); that prop starts at `PuzzleInstance.start(run)`,
// so a device re-entered or reloaded shows and continues its saved configuration.
// Round 5 (W3): every reach type UI reports `onreach(canonical(p, answer))` from **one** rule, `reachEdge` below, run on
// each render of its `answer` prop (a `$effect` over `answer`), never from a press handler; so a start answer that is
// already reached (a device seeded at a reached `work`) is reported at mount, and an answer that turns reached again
// after a restart is reported again. For a 'view' reach type `canonical(p, a)` is `a` itself (`levers`: the
// configuration; `sequence`: the press list; pinned per type in GM8a / GM8b), so `run.work` stays equal to
// `session.answer()` (W1's pin).
// PLAY (chunk, shared by every reach type UI): client/src/puzzles/play/reach.ts (GM7r)
/** The reach report's edge: `step(reached)` is true exactly when `reached` turns true, and at the first call when the
 *  start answer is already reached. One per mount of a type UI (its owner and destroy point are the component's). */
export function reachEdge(): { step(reached: boolean): boolean };
// Device geometry (critique_engine_r1 open question): a device's params carry its part hit rects in canonical bg px;
// the type UI measures its full-bleed root (`bind:clientWidth` / `bind:clientHeight`) and maps them with
// `geom/cover.ts` (`cover`, `toStage`, `minTarget`, as `controller.ts:108-119`). The PuzzleHost layer and the stage
// host are both `inset: 0` layers of App (`App.svelte:294-297`); GM8h's cut verifies the boxes are equal.
// BUILD: client/scripts/story/puzzles/<type>.ts
export interface PuzzleTypeLint<P> {
  validateSolution?(p: P, s: readonly number[]): string | null;  // commit types: the source `solution`
  solve?(p: P): readonly number[] | null;                        // reach types: the posted canonical answer, or null
  /** Reach types whose goal is drawn (`levers`): the hidden method, the shortest move list from `initial` (W6). */
  witness?(p: P): readonly number[] | null;
  /** Server hint texts after build-time rendering (`levers`: `[moves]` -> the witness, W6); identity by default. */
  renderHints?(p: P, hints: readonly { ru: string; en: string }[]): readonly { ru: string; en: string }[];
  countSolutions(p: P, cap: 2): 0 | 1 | 2;                       // over canonical answers
  domainFits?(p: P, d: Domain): string | null;                   // per-player-capable commit types (per-player.md)
}
// `toServer` (`world/decode.ts:687`) takes the build's `renderHints` as an optional parameter (GM1c adds it with an
// identity default), since `src/` may not import `scripts/` (`import-outside-src`); GM2b passes the build registry's
// renderer at its one call site (`client/scripts/story/emit.ts:428`), so GM8a only implements `levers.renderHints`.
```

- `session.ts` keeps a type-agnostic shape check from `instance.shape` before a POST; type validity lives in the play
  half (the UI enables its commit control). The server compares shape and equality only (unchanged).
- Registry pin (GM1c, round 3): `check === 'commit'` implies `wrong === 'posted'`; `check === 'reach'` implies `wrong`
  is `'none'` or `'local'` (test `puzzles: a commit type posts its wrong answers; a reach type has none or a local one`).
  Round 4: `commit === 'full'` implies `check === 'commit'` and `presentation === 'view'`; `demo` present implies
  `goal === 'shown'` (a demonstration never plays a secret); `workFits` present iff `presentation === 'view'` (test
  `puzzles: a full-commit type is a view commit type and a demonstration shows only a shown goal`, seen red on a
  fixture `demo` on a `secret` type).
- **The lint registry (round 4, m5):** `PUZZLE_LINTS` in `client/scripts/story/puzzles/index.ts` (GM1c, new; `{ code,
  order }` then one line per type lane: GM7p, GM7g, GM8a, GM8b), mapped over `PuzzleType` so a type without a lint half
  fails `tsc`. `postedLength(p, PUZZLE_LINTS)`, `answerLenIssues`, `world/unique-solution` and `toServer`'s `renderHints`
  (GM2b's `emit.ts:428` call site) all read it; no other file names the type lint halves.
- Bytes: ~25 lines per data half, ~0.11 KB br engine per type (ARITHMETIC); play halves ride each type chunk
  (<= 8 KB br LIMIT, `budget.ts:109`).

### 7.2 Per-type table

| Type (lane) | check / wrong | goal | presentation | params (public; decode bounds, round 3 W3) | answer (canonical); posted length | server | per-player |
|---|---|---|---|---|---|---|---|
| `code` (built) | commit / posted | secret | overlay | `dials` <= 6 (as built, critique_engine_r2 W3) | digit per dial; `dials` | static or per-player | yes, >= 4 dials (floor) |
| `order` (built) | commit / posted | secret | overlay | `pieces` <= 5 (as built) | permutation; `pieces` | static | no (<= 120) |
| `path` (GM7p) | reach / none | shown (rules drawn) | overlay | `cols`, `rows` 2..7, `ends`, `blocked`, `visit` | node sequence starting at the lower-index end; `solve(p).length` <= 49, bounded by `world/answer-len` (<= 16 until GM7g raises it to 64) | static, `solve(p)` | no |
| `grid` (GM7g) | reach / none | shown | overlay | `rows`, `cols` 2..6, `symbols` 2..6, `given` | cell-major fill; `rows x cols` <= 36, bounded by `world/answer-len` (64 from GM7g) | static, `solve(p)` | no |
| `levers` (GM8a) | reach / none | shown (the target pattern drawn on the device) | view | `parts` 2..8, `positions` 2..4, `couples`, `target`, `rects` | configuration; `parts` <= 8 | static, `solve(p)` = the target iff a BFS over throws from `initial` reaches it, else null (m8); `witness(p)` = the shortest throw order | no |
| `setting` (GM8a) | commit / posted | secret (copied from a clue) | view | `parts` 1..8, `positions` 2..10, a commit part, `rects` | configuration; `parts` <= 8 | static or per-player | yes if `positions^parts - 1` >= 1,000 (`startShown` = `initial`, excluded, `world/solution-initial`, `client/scripts/story/world.ts:581-582`; m4): 10^3 - 1 = 999 fails, 4^5 - 1 = 1,023 and 6^4 - 1 = 1,295 pass (ARITHMETIC) |
| `sequence` (GM8b) | reach / **local** | shown (the device plays the order: `demo(p) = order`, at arrival, after each wrong ring and on its replay control; round 4 m7) | view | `parts` 2..8, `order` of length 2..12 | the order; <= 12 | static | no |
| `ritual` (GM8b) | commit / posted; **`commit: 'full'`** (round 4 m8) | secret (a clue order) | view | `parts` 2..6, `length` 3..12; `initial` = `[]`, `startShown` = null (m7) | press sequence; `length` <= 12 | static or per-player | yes if `parts^length` >= 1,000, nothing excluded (no full-length configuration is shown before input; m7): 4^5 = 1,024 and 6^4 = 1,296 pass, 3^6 = 729 fails (ARITHMETIC) |

### 7.3 I4: secret goals never ship

- **Type-level guarantee:** `reach` implies `goal: 'shown'`; a `shown` type's UI draws its goal from the params, so the
  public JSON holds only what the screen shows. A registry test pins `check === 'reach' <=> goal === 'shown'` per type.
- **`ritual` (the clue-matched order):** each press animates the pressed part (cue `fact:work:added`), says nothing
  about right or wrong, and at `length` presses yields posts the sequence as one attempt (`commit: 'full'`, round 4 m8;
  as a `code` submit: the window 20 / 600 s and `maxAttempts` apply as built). Correct: the device opens. Wrong:
  `puzzle:wrong` (jam motion), and yields restarts the working sequence from `[]` (`restartWork`, §7.5), so the decor's
  lit bells go dark with `fact:work:removed` cues. **Cost stated:** no per-press feedback; brute force over `parts^length` (4 bells x 5
  presses = 1,024 sequences) takes 1,024 / 20 x 600 s = 30,720 s ≈ 8.5 h at the window (ARITHMETIC).
- **Lints:** `world/clue-declared` (every `secret` puzzle declares >= 1 clue atom, `clues: Cond[]` source-only and
  stripped from the public world), `world/reach-has-clue` (a `shown` type may declare none), `world/clue-reachable`
  (each clue atom reachable from the section entry without the puzzle's solved edge; a search with that edge removed),
  `world/hints-on-shown-goal` (`sequence` has `hintTiers` 0: the device shows the answer; **`levers`**: the shown goal
  is the target, so the paid ladder may not end on it, and its last tier must be the generated one below), and
  **`world/hint-moves`** (W6): a `levers` puzzle's last tier holds the marker `[moves]` exactly once in `ru` and in its
  `en` table entry; no other tier and no other type holds it. The emitter replaces it with the witness as 1-based part
  numbers joined by ", " (`renderHints`), so the sold tier 3 is the hidden throw order and can never restate the drawn
  target. Seeded reds: a diary inside its own drawer; a `sequence` with a clue; a `levers` tier 3 in plain text; a
  `[moves]` marker on a `code` puzzle.
- **Rejected:** per-press feedback for `ritual` (it leaks the answer one press at a time, `length x parts` probes);
  ruling sequence answers public (it would sell hints whose answer ships, I4).

### 7.4 Canonical forms, uniqueness, reach agreement (R8, R8b, m3)

- `canonical(p, a)`: `path` orients from the lower-index end; `grid` and `levers` are already canonical (one array per
  fill or configuration). Round 5 (W3): the type UI reports `canonical(p, a)` through `reachEdge` (§7.1) when its
  `answer` turns reached and at mount when it already is; yields holds it as `Open.reach` and posts it whenever the
  session can, until a decisive reply (§7.5 "Posting per reply kind"). It is never posted per stroke or per press.
- `world/reach-solution` (round 5, W3) also refuses a reach puzzle reached at `initial(p)` (a grid whose `given` fills
  every cell, a `levers` target equal to its start): such a puzzle would post at its first mount with no input. Seen
  red in GM7p on a fixture reach type through the `PUZZLE_LINTS` parameter whose `initial` is reached (a real `path`
  starts at `[]`, never reached; `story: a reach puzzle reached at its start is refused`); pinned in GM7g on a real
  `grid` whose `given` fills every cell (`story: a grid whose given cells fill it is refused`) and in GM8a
  (`story: a levers target equal to its start is refused`).
- `world/unique-solution`: `countSolutions(p, 2) === 1` counts **canonical** answers `a` with `reached(p, a)`.
- `world/reach-solution`: `reached(p, solve(p))` and `canonical(p, solve(p))` equals `solve(p)`; `toServer` emits it.
- Search bounds: `path` cols, rows <= 7; `grid` rows, cols, symbols <= 6 (decode limits), so `countSolutions` stays a
  small backtracking search; the story tool reports its time per instance (MEASURED in GM7p / GM7g).
- **Runtime mismatch** (m3). The realistic trigger is a stale tab: a free bundle built before a deploy posts against
  updated server content; a lint bug is the other. The server answers wrong to a reach post; the session resolves the
  attempt as `{ kind: 'mismatch' }` (a new `AttemptResult` kind, GM7r; round 5: it dispatches no `attempt-failed`, so
  no reach post ever counts toward `maxAttempts`), yields resets the device, logs `reach-mismatch`
  to the console only (no stats event: `StatKind` is a closed union generated from the server,
  `client/src/api/generated/api.ts:345`, backed by a DB constraint, and this track makes no server change; m12) and
  shows a sticky toast `mech.content_updated` (round 4: in `i18n/mechanics.ts`, not the entry's tables; "The game was updated: close it and open it
  again", owner wording Q15e). A lock puzzle cannot be abandoned (`reduce.ts:483-486`), so that device **stays shut in
  this tab**; reopening loads the new bundle, whose `reached` agrees. The statement "never a stuck lock" is withdrawn.
- `levers` (m8): `solve` runs a BFS over configurations from `initial`, one edge per throw (the part and its couples
  advance by one, mod `positions`); <= 4^8 = 65,536 states (ARITHMETIC on the decode limits). An unreachable target
  (a couple parity) gives null and `world/reach-solution` refuses it; seeded red on such a pair.
- **Answer length (W3, round 3).** The server refuses an answer of more than `MAX_ANSWER_LEN = 16` entries with a 400
  (`server/src/puzzles/mod.rs:21`, `:64-67`); the session maps the 400 to `network` (`puzzles/session.ts:114-131`) and
  the frame shows "offline" (`yields.ts:658-661`) on every retry, so an over-long answer is a soft-lock. Content load
  checks only `solution.len() == answer_len` (`server/src/content.rs:803`), and no client code bounds the length. The
  build therefore enforces it:
  - `client/scripts/story/puzzles/shape.ts` (build-only, new in GM1d):
    ```ts
    /** The longest answer the build emits; never above the server's MAX_ANSWER_LEN (server/src/puzzles/mod.rs:21). */
    export const MAX_ANSWER_LEN = 16;              // GM7g: 64, after per-player GM6s1 raises the server's constant
    /** The length the server compares: a commit type's `answerShape(p).len`, a reach type's `solve(p).length`. */
    export function postedLength(p: SourcePuzzle, lints: typeof PUZZLE_LINTS): number | null;   // null: no solve
    export function answerLenIssues(w: WorldSource, lints: typeof PUZZLE_LINTS): Issue[];       // world/answer-len
    /** Round 4: registered in MECHANIC_LINTS as `{ id: 'puzzle-shape', codes: { 'world/answer-len': 'E' } }`. */
    ```
    (`PUZZLE_LINTS` is `client/scripts/story/puzzles/index.ts`, GM1c, round 4 m5; a test passes a fixture registry of
    the same type.)
  - lint `world/answer-len`: `1 <= postedLength(p) <= MAX_ANSWER_LEN` for every puzzle, per-player ones included (their
    domain length is `answerShape(p).len`, per-player.md `world/per-player-domain`); seen red in GM1d on a fixture type
    whose answer is 17 entries (the registry parameter, as GM3c's fixture module), pinned in GM7p on a real path whose
    solution visits 17 cells;
  - pin `story: the build's answer bound never exceeds the server's MAX_ANSWER_LEN` (GM1d): reads
    `server/src/puzzles/mod.rs`, requires a match of `pub const MAX_ANSWER_LEN: usize = (\d+);` (no match is red, so the
    test cannot pass vacuously) and asserts client <= server; seen red on the mutation client = 17. It is `<=` on
    purpose: per-player GM6s1's raise to 64 (a server-slot lane) leaves the client suite green, and **GM7g** raises the
    client bound to 64 after it (a 5 x 5 grid posts 25);
  - the per-type decode bounds (§7.2) keep every non-board type at <= 12 entries; `path` (<= 49 cells) and `grid`
    (<= 36) are bounded by the lint, so an author's 5 x 5 visit-all path fails `npm run story` until GM7g, never a POST;
  - per-player GM6s2's load rule `answer_len <= MAX_ANSWER_LEN` ([per-player §3.3 Content format 2](../per-player/03-server-half.md#33-content-format-2)) is the server's own second line;
    no lane of this file waits for it.
- **Tests:** `story: a grid with two solutions is refused` (seen red), `path: a reversed path posts its canonical form`
  (seen red without `canonical`), `story: a seeded reached/solve mismatch is refused`, `session: a reach puzzle posts
  once per solve and none per stroke`, `session: a wrong reply to a reach post is a mismatch` (GM7r), `yields: a
  mismatch resets the device and shows the update toast` (GM7r); round 5 (W3, GM7r): `reach: the edge reports a
  reached start once and each later turn to reached once`, `yields: a reached answer answered offline posts again on
  Try`, `yields: a rate-limited reach post posts again when the countdown ends`, `yields: a move away from a reached
  answer cancels its pending post`, `puzzle-host: a reach frame enables Try only while its answer awaits`, `story: a
  reach puzzle reached at its start is refused` (GM7p, a fixture; pinned by GM7g's grid and GM8a's levers tests); `story: a levers target its throws cannot reach is
  refused` (GM8a), `levers: the witness is the shortest throw order` (GM8a), `story: an answer longer than
  MAX_ANSWER_LEN is refused` and `story: the build's answer bound never exceeds the server's MAX_ANSWER_LEN` (GM1d),
  `story: a path whose solution visits 17 cells is refused` (GM7p), `story: a 25-cell grid passes the answer bound`
  (GM7g; red at 16).

### 7.5 Devices: lifecycle, attempts, working state (m6, m7, W2; round 3 W1, W2, m9, m10; GM8i module, GM8h host)

- **Open (m10, round 3; round 4 m9, W3).** A view room with `device: <hotspot>` whose hotspot carries a zero-slot lock
  with `puzzle`. The device hotspot is drawn by the device, never as a hotspot button: the controller's hotspot views omit
  it (GM8i). **Where arrival runs (round 4, m9):** nothing dispatches it. The devices module's `arrived(w, s, room, out)`
  hook (§3.2, the hook from GM1b) runs inside the reducer, once per `room` effect into the device room: a zoom-in
  (`arrive`, `reduce.ts:322`), a resume into it (`:332`) and an event knot's return into it (`:354`), each after the
  room's `onEnter` and only with no event knot pending. It never rides `roomShown()`, which yields also calls after every
  puzzle end (`yields.ts:540`, `:555`), and a puzzle end pushes no `room` effect, so a device's own `solved` / `failed`
  never re-plays `done` / `jammed`. The hook writes no state (`ArrivalOut`):
  - **Placement lints (round 4, W3; GM8i):** `world/view-type-site`: a puzzle whose type is `presentation: 'view'` is
    the puzzle of exactly one lock, and that lock is the zero-slot lock of a view room's `device` hotspot (a `view` type
    as a linear yield's puzzle, on an ordinary room lock or on a slot lock is refused); `world/device-type`: a device's
    lock puzzle is a `view` type. A linear yield of a device's puzzle is already `puzzle/in-section`
    (`client/scripts/story/graph.ts:601-606`). So no world that passes `npm run story` reaches a `view` frame that App's
    frame layer will not render (`coversStage` false) outside an ExploreView that renders it; the soft-lock of
    critique_engine_r3 W3 cannot be authored. Seen red in GM8i on a fixture `view` type through the registry parameter,
    pinned in GM8a by `story: a linear levers yield is refused`. **Round 5 (W2): `world/device-closeup`**: a puzzle
    whose type is `presentation: 'view'` has `closeup: null`. `closeup` is a required key of every puzzle
    (`PUZZLE_KEYS`, `client/src/world/decode.ts:512`, read `nullable` at `:527`), both existing lock puzzles set one
    (`story/ch1/world.json:54`, `story/ch2/world.json:10`), and `openPuzzle` applies it to every frame
    (`yields.ts:587-592`) on the cg layer above the props (`scene/controller.ts:143`), where the visual diff is skipped
    (`yields.ts:409-411`): a device with a close-up would be played blind under the CG, with no give-up. The rule is a
    content lint, not a silent runtime skip, so the author learns at `npm run story`. Seen red in GM8i on a fixture
    `view` type with `"closeup": "cabinet"` (`story: a device puzzle with a close-up is refused`); GM8d's six puzzles
    pass it.
  - run outcome null and the hotspot not open: the `puzzle` effect, under `lockTap`'s own condition (`reduce.ts:370`;
    every slot of an empty slot list is filled), so the session opens in `mode: 'explore'`. The proof reaches the same
    edges through the `tap` on the device hotspot that `actions` lists (`reduce.ts:572-577`), which `successors`
    expands as any lock puzzle (`reduce.ts:598-618`);
  - `solved`: no session; module cue `module:devices:done` (§8.4); the view shows the parts at their saved `work` and
    the decor's `{ solved: p }` states;
  - `failed`: no session; module cue `module:devices:jammed`; the decor's `{ failed: p }` state shows the jam. Lint
    `world/device-failed-state` (GM8i): a device with `maxAttempts` has a decor state whose `is` reads `{ failed: p }`,
    so a jammed device never looks live. A tap on its area is bare art (`ui:bare-art`). No LockPanel ever opens for a
    device (today's `lock` effect would open an empty one, `reduce.ts:368-375`, `yields.ts:299-302`).
- **Host: the device renders inside the room (W1, round 3).** App's frame layer is a full-bleed `.layer` after the stage
  layer (`App.svelte:103-115`, `:294-297`), inert only under OWN / META overlays (`:24-26`, `:34`), and the explore sheets
  are children of ExploreView inside the stage layer (`ExploreView.svelte:67-81`). A view frame in that layer would take
  every tap and paint over the sheets, whatever its root's `pointer-events`. So a `presentation: 'view'` frame **never
  enters App's frame layer**:
  - `coversStage(f)` (`ui/puzzle-view.svelte.ts`; GM3w adds it as `f !== null`, GM8h narrows it to `f !== null &&
    f.presentation === 'overlay'`) decides both App sites: the stage layer's `inert` (`App.svelte:65`) and the frame
    layer's `{#if}` (`:103`). From GM3w on App reads only `coversStage`, so no later lane edits `App.svelte`.
  - The room layer receives the puzzle store and actions (`puzzle: PuzzleView`, `puzzleActions: PuzzleHostCallbacks`,
    passed by App from GM3w on, unread until GM8h). For a view frame with its host loaded, ExploreView renders
    `<puzzle.host place="room" ...>` inside `.room`, after the hotspot buttons and before the bar, the ribbon and the
    leave control. `.room`'s `inert={covered}` (`ExploreView.svelte:38`, `:42`) then covers the device whenever an
    inventory, document or lock sheet is up, and the sheets, later siblings of `.room`, paint over it.
  - `place: 'room'` (`PuzzleHostProps.place: 'frame' | 'room' | 'ladder'`, GM8h): the compact bar (title, status line,
    attempts left when capped, Hint when `hintTiers > 0`, and **Retry (`ui:puzzle-retry`) while `frame.loadFailed`**, the
    type-chunk failure that `PuzzleHost.svelte:71-73` shows in an overlay frame's body; round 4 m10; **no give-up**: a
    lock puzzle cannot be abandoned, `reduce.ts:483-484`, and PuzzleHost offers it only in linear mode,
    `PuzzleHost.svelte:24`) and the type UI's full-bleed root with the part hit areas. The host root and the type UI root
    are `pointer-events: none`; the bar and each part are `pointer-events: auto`. A tap outside them reaches the view's
    other hotspots, the bare-art catcher, the ribbon, the bar's Inventory and the leave control. **The compact bar is
    anchored to the top edge** (`top: calc(var(--app-inset-top, 0px) + 8px)`, round 4 m10), so the explore bar, which
    sits at the bottom (`ExploreView.svelte:136-146`) and paints later in DOM order, never covers Hint or Retry.
    **Round 5 (W3): the bar's Try** (`ui:puzzle-try`, the existing control, label `puzzle.try`) shows while
    `frame.awaiting === true && frame.line === 'offline'`: a reach device whose reached answer got a `network` /
    `not-entitled` reply re-posts it from here (§"Posting per reply kind" below). A `commit: 'control'` device re-posts
    by its own commit part and a `commit: 'full'` one restarts, so neither shows it.
    **Round 5 (m5): the part rects** (`world/device-parts-frame`, GM8i) lie inside `HOTSPOT_SAFE_FRAME`
    (`client/src/geom/cover.ts:17`, x 80-1000, y 160-1760, the frame `world/hotspot-frame` uses) with each side at
    least the hotspot minimum (`client/scripts/story/world.ts:48` today; round 7: `HOTSPOT_MIN_SOURCE_PX` in
    `client/src/geom/cover.ts` from GM3c on, imported by `devices.ts`), so no supported aspect crops a part of a lock that
    cannot be abandoned; and every part's top edge lies at or below the **derived band**
    `DEVICE_BAND_Y = ceil((8 + DEVICE_BAR_CSS_H + DEVICE_TOP_INSET_CSS - offsetY) / scale)` at the worst supported
    cover, 320 CSS px wide at 9:16 (the safe frame's widest aspect, `cover.ts:16`; the smallest scale the hotspot lint
    already assumes, ~0.29 at `world.ts:48`, `:557`): `cover({w: 320, h: 568.89}, ROOM_SOURCE)` gives scale
    320 / 1080 = 0.2963 and offsetY (568.89 - 2048 x 0.2963) / 2 = -18.96 CSS px (ARITHMETIC on `cover.ts:25-28`), which
    is 64 canonical px cropped at the top (2048 - 1080 x 16 / 9 = 128, halved). **Round 6 (critique_engine_r5 m1): the
    bar's layout rule and its bound.** The bar is three rows at every width: row 1, 44 px, `flex-wrap: nowrap`: the
    title (`min-width: 0`, one line, ellipsis; <= 18 graphemes by `world/title-long`, `client/scripts/story/world.ts:46`),
    then Hint and Try or Retry, each >= 44 x 44 px; row 2: the status line, 14 px type on an 18 px line, at most two
    lines (`line-clamp: 2`; the longest status, `puzzle.offline`, is 41 characters in both languages,
    `client/src/i18n/ru.ts:134`, `client/src/i18n/en.ts:134`, and wraps at 320 px); row 3, when the puzzle is capped:
    the attempts line, one 18 px line (`puzzle.attempts_left`, `ru.ts:129`). So `DEVICE_BAR_CSS_H` = 6 + 44 + 4 +
    2 x 18 + 4 + 18 + 6 = 118, rounded up to **120** CSS px (LIMIT new; round 5's 56 held one button row only, which the
    strings above cannot fit at 320 px), and with `DEVICE_TOP_INSET_CSS` = 0 the band is
    `DEVICE_BAND_Y = 64 + ceil((8 + DEVICE_BAR_CSS_H + DEVICE_TOP_INSET_CSS) x 1080 / 320)` = 64 + 432 = **496**
    canonical px (integer form of round 5's formula, so no float rounding; ARITHMETIC), and each CSS px of top inset adds
    3.375. Wider 9:16 screens have a larger scale, so the band in CSS px only grows: at 360 x 640 the band sits at
    496 x 0.3333 - 21.33 = 144 CSS px against the bar's bottom at 128.
    A 9:19.5 screen is height-bound (offsetY 0, scale >= 0.3385 at 320 px), so its band is lower: 9:16 is the worst
    case. `DEVICE_TOP_INSET_CSS` is the largest `--app-inset-top` (`client/src/telegram/viewport.ts:14-21`, the safe
    area plus Telegram's content safe area, which is its header **in fullscreen**): `requestFullscreen` appears nowhere
    in `client/src` (Grep), so 0 is today's value; verify at GM8h's cut against core.telegram.org/bots/webapps
    (`safeAreaInset`, `contentSafeAreaInset`) whether any launch path enters fullscreen, and if one does, set the
    constant from the mock's largest inset (the band then grows, it never silently overlaps). The constants live in
    `client/scripts/story/mechanics/devices.ts` (build-only); GM8d's e2e pins the real bar against `DEVICE_BAR_CSS_H`
    (`mechanics: the device bar is no taller than its lint's bound`, seen red on the mutation "the bar's padding 6 ->
    16 px", 118 + 20 = 138 > 120). **Round 6 (m1): the pin runs at the derivation's own width in the bar's fullest state:**
    `page.setViewportSize({ width: 320, height: 569 })`, the fog bells (`sequence`, `maxAttempts: 3`) after an aborted
    last ring, so the bar shows the title, Try, the two-line `offline` status and the attempts line (all three rows;
    ru, the e2e language); verify at GM8d's cut that the mock's viewport variables follow `setViewportSize`. GM8h's
    component test `puzzle-host: the room-place bar keeps one button row and clamps its status to two lines` checks
    the rules themselves (computed `flex-wrap: nowrap` on row 1 and the two-line clamp on the status; red: neither rule).
  - The ladder over a device: `<puzzle.host place="ladder">` in an ExploreView `.sheet` after the explore sheets while
    `puzzle.ladder !== null` and the frame is a view; `covered` gains that case. Back closes it (the `hints` screen) and
    the device stays (Lifecycle below).
  - A failed host chunk in a view: ExploreView shows today's `puzzle.load_failed` text and Retry (`ui:puzzle-retry`,
    `puzzleActions.onretry`) in the room bar; App's `hostFailed` block (`App.svelte:42`, `:108-113`) serves overlay
    frames only.
  - `backScreen` (`ui/puzzle-view.svelte.ts:84-86`) returns null for a view frame, so no `puzzle` overlay is pushed.
  - The cue roots nest here (the host's root inside ExploreView's): `cueRoot` emits a control from its innermost root
    only (§8.3, M-I5j).
- **Lifecycle (W2; m9, round 3).** yields' `Open` gains `present: 'overlay' | 'view'` and `room: RoomId | null` (the
  device's view room). The X8 close in `screensChanged` (`yields.ts:852-854`) gains `open.present === 'overlay'`, so
  pushing `hints` (`yields.ts:704`), the inventory or a document over a device no longer closes it, and a `useHint` in
  flight finds its `Open` alive (`yields.ts:735-737`). A view session closes, with no outcome:
  - on a `room` effect to another room (in `effect`, `yields.ts:284-286`) through **`session.close()`**, the X8 path,
    deferred while an attempt is in flight (`puzzles/session.ts:85-86`, `:227-231`): a decisive answer that lands after
    the move still ends the session, and its `onEnd` applies the outcome in the section the player is in (a `room`
    effect never leaves the section, `world/view-section`), so a zoom-out never drops a server-recorded solve (m9).
    **Round 4 (m1):** the same `room` effect clears `puzzle.frame` and `puzzle.ladder` at once (`open` stays until
    `onEnd`), so the compact bar and the part hit areas leave with the view and never sit over the parent room during a
    deferred close; `attempted`'s `setFrame` (`yields.ts:482-487`) is then a no-op for that `Open`, while `onEnd` ->
    `dropPuzzle` -> `ended` applies a late correct answer as before. Re-entering the view while that POST is still in
    flight opens a new session (`openPuzzle` -> `dropPuzzle`, `yields.ts:577`), which drops the late answer; the solve
    stays a server fact, and (round 5, W3) the new session, seeded at the saved `work`, re-posts it at open for a reach
    device (its UI reports the reached start through `reachEdge`; the reply is `correct`) and restarts it for a
    `commit: 'full'` device (no re-post, below);
  - on a `leave` / `story` effect (`toStory`, `yields.ts:261-266`), `chapterChanged`, `restore` and `dispose`, through
    `dropPuzzle` (`yields.ts:497-509`), which disposes: the world is being replaced, a late answer is dropped
    (`session.ts:223-225`) and stays a server fact, and a re-solve posts the same answer and is `correct`.
- **Back:** the root back leaves the view (§6.3); the move closes the session with no outcome by the rule above. An open
  `hints` overlay, inventory or document is on top of the screens stack, so the first Back closes it and the device
  stays (Telegram's BackButton pops the stack before the root-back).
- **Tests (GM8h):** `yields: hints opened in a device view keep the session and show the ladder` (red on main's rule:
  the session closes and the ladder is cleared), `yields: closing hints leaves the device open`, `yields: the inventory
  over a device keeps the session`, `yields: leaving a device view closes its session with no outcome`, pin `yields:
  an overlay puzzle still closes when its overlay leaves the stack` (X8 unchanged); round 3 (W1, m9):
  `puzzle-view: coversStage is false for a view frame` (red: GM3w's `f !== null`), `puzzle-view: backScreen pushes no
  overlay for a view frame`, `explore: a view frame renders the device inside the room, under the explore sheets`
  (jsdom sees the real DOM order and `inert`: the host root is a descendant of `.room`, an open inventory `.sheet`
  follows `.room`, `.room` is inert; red on the parent: no device slot), `explore: the ladder over a device is a sheet
  and the room is inert under it`, `explore: a view frame whose host failed shows Retry in the room`, `puzzle-host: a
  room-place host offers no give-up`, `yields: a correct answer landing after a zoom-out opens the device's lock`,
  `yields: a story effect during a device POST drops the answer`; round 4: `yields: a zoom-out during a device POST
  hides the device at once and still applies a correct answer` (m1; red on the parent: `puzzle.frame` is still set in
  the parent room), `puzzle-host: a room-place host whose type chunk failed shows Retry in its bar` (m10; red: no
  Retry in the `room` place), `puzzle-host: the room-place bar is anchored to the top` (m10; the computed `top` of the
  bar). The hit-testing proof needs real layout and real content, so it is **GM8d's** e2e on the demo devices
  (§12 GM8d; mutations **M-W1a**, **M-W1c**; round 4 W2).
- **Working state (round 4, W1: one value).** `run.work` is the saved copy of the view session's answer; the session owns
  the live value. Three points make it one value:
  1. **Seed.** `PuzzleInstance.start(run)` (§7.1; the member lands in GM1c returning `initial()`, its `work` branch in
     GM8h, round 5 m1) returns `run.work` for a `view` type whose `workFits(p, work)` holds, else `initial(p)`; the
     session's constructor calls it where it calls `initialAnswer(puzzle)` today
     (`session.ts:193`), so the frame's `answer` (`yields.ts:600`) and therefore the type UI's `answer` prop
     (`PuzzleHost.svelte:77`) start at the saved configuration on every open: re-entry after Back, a reload (the saved
     world's run, `yields.ts:571`), an event knot's return. A `work` that no longer fits was already dropped at resume
     (the devices `normalize`, §5.2); the seed's `workFits` check makes the session safe on its own.
  2. **One write path.** A view type never calls `onchange`. Its UI computes the next configuration from the `answer`
     prop through its play half (`press`) and calls `onwork(work, wrong)`. yields' one handler (GM8h): `session.setAnswer
     (work)`; `setFrame({ answer: session.answer() })`; the controller dispatches `device-moved {puzzle, work:
     session.answer()}` (a devices rule, not enumerated by `actions`, outside the key), which writes `run.work` through
     the writer (cues `fact:work:removed` / `fact:work:added` per moved part, `dirty` autosave); then `wrong` ->
     `failLocal()` (Attempts below); then `commit: 'full'` -> the full-commit rule below. So `run.work` and
     `session.answer()` are the same array after every input, which a test pins.
  3. **One reset path.** `restartWork(o)` (yields, GM8h) sets the session answer and `run.work` to `initial` through the
     same handler; it runs after a `commit: 'full'` reply that is not correct, after a reach `mismatch` (GM7r's reset,
     re-routed through it in GM8h), and after per-player's `value-changed` (E-P12).

  The parts are `decor` of the view room with states chosen by the visual atom `{ part: { puzzle, index, is } }` over
  `run.work`, so a lever moves through the same machinery as a drawer (§6.4), and the decor and the type UI read the same
  configuration. A section reset clears the run and the picture returns to `initial`.
  Tests: `session: a session starts from the instance's start answer` (GM1c, `code` / `order`: behaviour-identical;
  red: TS2339 `start`); `session: a view session starts from its saved work when it fits` (GM8h, a fixture `view` type
  with `workFits` passed through `PuzzleSessionDeps.types`; red on the parent: the answer is `initial`, because GM1c's
  `start` returns `initial()` for every type until GM8h's `work` branch, round 5 m1); `session: a view session
  ignores a saved work that does not fit`; `yields: re-entering a device view continues from its saved work` (GM8h: open, two `onwork` throws, a
  zoom-out, a zoom-in; red on the parent: `frame.answer` is `initial` while `run.work` holds two throws, the
  critique's four-levers-snap-back case); `yields: a device's saved work always equals its session's answer` (after
  every `onwork`, `run.work` deep-equals `session.answer()`); e2e (GM8d) `mechanics: a device keeps its levers across a
  zoom-out and a reload`.
- **Full commit (round 4, m8; `ritual`).** After `onwork`, when `commit === 'full'` and `session.answer().length ===
  shape.len`, yields posts through `post(o)` (round 8: GM3p's one attempt starter, out of `ontry`'s body,
  `yields.ts:687-695`: `busy`, `checking`, `puzzle:checking`, `attempt()`; per-player R-E28). While `busy`
  or `retryAfter !== null` it does not post and the type UI ignores presses (its `busy` prop; a press on a full-length
  sequence is refused by the play half with `puzzle:blocked`, motion `shake`); **when the 429 countdown reaches zero**
  (`countdown`, `yields.ts:619-630`) yields posts the still-full answer once. One rule covers the rest: **a
  full-length unposted answer posts when the session can post** (after the last press and at the countdown's end; a
  full-length `work` seeded at open, which only a reload during a POST or a countdown leaves in a save, restarts
  through `restartWork` instead of posting, because the save cannot tell whether that POST reached the server and a
  re-post could count one input as two attempts), and **every reply that is not correct and not a 429 restarts the
  presses** (`wrong`, `network` / `not-entitled` with the "offline" line, GM7r's `mismatch`, per-player's
  `value-changed`) through `restartWork`, so the player is never left with a full sequence that nothing will post.
  Tests (GM8h, fixture `commit: 'full'` type): `yields: a full-length press sequence posts once` (red on the parent: no
  post without `oncommit`), `yields: a full sequence rate-limited posts when the countdown ends` (red: nothing posts at
  zero), `yields: a wrong or offline full sequence restarts from initial` (red: the presses stay), `yields: a
  full-length work seeded at open restarts without a post` (round 4, found while resolving; red: a second POST of the
  same presses).
- **Posting per reply kind (round 5, W3; critique_engine_r4's question answered).** Before round 5 a reach device posted
  only on the transition into `reached`, so a seeded reached `work` (a reload or a re-entry during the POST) or a
  non-decisive reply left a full `sequence` or a reached `levers` with nothing that would post, and the lock cannot be
  abandoned. One rule now covers every type: **an answer that is ready to post and has no decisive reply posts whenever
  the session can post**; what "ready" and "again" mean per type is this table. yields owns it (GM7r for the shared
  half, GM8h for the device bar); `Open` gains `reach: readonly number[] | null` (the reached canonical answer awaiting
  a decisive reply) and `PuzzleFrameView` gains `awaiting: boolean | null` (null: a commit type, Try as built; a reach
  type: `open.reach !== null`).

  | Event or reply | `commit: 'control'` (`code`, `order`, `setting`) | `commit: 'full'` (`ritual`) | reach, overlay (`path`, `grid`) | reach, view (`levers`, `sequence`) |
  |---|---|---|---|---|
  | ready to post | Try / the commit part (as built, `oncommit`) | the last press (`length` presses) | `onreach(c)` from `reachEdge` | `onreach(c)` from `reachEdge`, including **at mount when seeded reached** |
  | `correct` | solved | solved | solved | solved |
  | wrong (posted) | `wrong`, one attempt, the input stays (as built) | `wrong`, one attempt, `restartWork` | `mismatch`: reset to `initial`, `o.reach = null`, the update toast; no attempt | `mismatch`: `restartWork`, the toast; no attempt |
  | 429 | countdown; Try enabled at zero (as built), **`puzzle:ready`** at zero (round 6) | countdown; **posts at zero** (`puzzle:checking`) | countdown; **posts `o.reach` at zero** (`puzzle:checking`); `o.reach` cleared during the wait: `puzzle:ready`, no post (round 6) | the same |
  | `network` / `not-entitled` | `offline`; Try or the commit part again | `offline`; `restartWork` (presses again) | `offline`; **the frame's Try re-posts `o.reach`** | `offline`; **the bar's Try re-posts `o.reach`**; a press on a full `sequence` stays `puzzle:blocked` |
  | a move away (`onchange` / `onwork` with another answer) | - | - | `o.reach = null`; Try disabled until reached again | `o.reach = null`; the bar's Try hides; reaching again reports again |
  | session closed with the POST in flight (zoom-out re-entry, `story` effect, chapter change, reload) | the next session starts from `start(run)`; the player presses Try again | a full seed restarts, never re-posts (one input never counts twice) | the next session starts at `initial` (no `work`); the player redraws | **the seed is reached: the UI reports it at mount and it posts at open**; a server-recorded solve answers `correct` |

  `postReach(o)`: when `o.reach !== null`, the frame is not `busy` and `retryAfter === null`, it sets the session answer
  to `o.reach` (for a view type the same array, so W1's pin holds) and calls **`post(o)`** (round 8, per-player R-E28:
  GM3p's one starter sets `busy` / `checking`, emits `puzzle:checking` and calls `session.attempt()`, whose reply goes
  through `attempted` as today; GM6c2 adds `trying` inside it). The countdown's zero calls one hook, `ready(o)`,
  which posts `o.reach` for a reach type, the full answer for `commit: 'full'` and nothing for `commit: 'control'`
  (Try re-enables as built, `yields.ts:619-630`). **Round 6 (critique_engine_r5 W3):** `ready(o)` returns whether it
  posted (round 8: `post(o)`'s own boolean); a post emits `puzzle:checking` (the frame turns `checking`), no post emits **`puzzle:ready`** as the frame
  returns to `idle` and Try lights, so the end of every wait has exactly one cue (`commit: 'control'` always; a reach
  frame whose `o.reach` a move away cleared during the countdown; never two cues at one zero). PuzzleHost's `canTry` for a reach frame adds `frame.awaiting === true`
  (an unreached path never posts from Try), and `ontry` on a reach frame calls `postReach`. **Why a re-post is safe
  here and not for `ritual`:** reach types have no posted wrong (`wrong: 'none' | 'local'`; a server wrong is
  `mismatch`, which counts no attempt, §7.4), so posting one reached answer twice can never spend an attempt; each POST
  takes one slot of the server's window (20 per 600 s, `server/src/puzzles/mod.rs:13-17`), and every re-post here is
  one per open or one per player tap. **Rejected:** restarting a seeded reached device through `restartWork` (it throws
  away a solve the server may already hold, and a reached `levers` costs the player the whole pattern again for a lost
  reply); a hidden automatic retry loop on `network` (it spends window slots while the player is offline, and the
  `offline` line plus Try is the designed state).
  Tests: GM7r (a fixture overlay reach type) `reach: the edge reports a reached start once and each later turn to
  reached once` (red: TS2307 `reach.ts`; mutation **M-R5a**: the edge starts at `true` -> a reached start is never
  reported, red), `yields: a reached answer answered offline posts again on Try` (red: Try posts the drawn answer, or
  nothing), `yields: a rate-limited reach post posts again when the countdown ends` (red: nothing posts at zero), round
  6 (W3): `yields: a countdown's end emits puzzle checking when it re-posts and puzzle ready when it does not` (a
  reached fixture frame: one POST and `puzzle:checking`, no `puzzle:ready`; the same frame moved away during the wait:
  `puzzle:ready`, no POST; red on GM7r's parent: GM3p's zero emits `puzzle:ready` and posts nothing for the reached
  frame), `yields:
  a move away from a reached answer cancels its pending post` (red: a later Try posts the unreached answer),
  `puzzle-host: a reach frame enables Try only while its answer awaits`, `session: a wrong reply to a reach post is a
  mismatch and counts no attempt`; GM8h (a fixture view reach type) `puzzle-host: a room-place bar shows Try only while a
  reached answer awaits after an offline reply` (red: no Try in the `room` place), `yields: a device's bar Try re-posts
  its reached work` (red: no post), `yields: onreach stops the demonstration`; GM8a `levers: a configuration seeded at
  the target reports reached once at mount` and `levers: canonical is the configuration itself`; GM8b `sequence: a full
  sequence seeded at mount reports reached once` and `sequence: canonical is the press list itself`; GM8d e2e
  `mechanics: a last ring answered offline posts again from the bar` (`page.route` aborts the first `POST
  /api/puzzles/{id}/attempts`, `client/src/api/endpoints.ts:108`; mutation **M-R5b**: the bar never shows Try -> the lock
  stays shut, red) and `mechanics: after a reload the reached bells post at open` (the first attempt aborted, then a
  reload; **M-R5a** re-applied: the device never posts, red).
- **Demonstration (round 4, m7; `sequence`).** A type with `demo(p)` (only `sequence`; the pin of §7.1 refuses it on a
  `secret` goal) shows its goal by playing it. **yields' demo runner** (GM8h; one per `Open`, created in `openPuzzle`
  after the type UI loads, destroyed in `dropPuzzle`; the components hold no timer, as D12 keeps the reveal timer in
  the controller) emits `{ kind: 'puzzle', puzzle, name: 'demo', index: part }` for each part of `instance.demo()` at
  `DEMO_STEP_MS` (600 ms, a CLAIM default, owner Q15h) on `h.clock`. The cue stage plays `pulse` at the part's hit area
  (`[data-cue-part="<part>"]` inside the device host root; round 11, critique_engine_r10's question: round 7 m4
  renamed the part target from `data-cue-index`, a control attribute, and §8.4's row reads the same; the part is a hit
  area, so the pulse plays on its painted ghost, §8.5 "Hit areas") and the scene owes "the part lights and rings" (MR1). It
  plays at session open, again `DEMO_PAUSE_MS` (800 ms) after each wrong press that does not end the session, and on
  the device's own replay control (`ui:sequence-replay`, `click`, declared in `sequence`'s `controls`; the UI calls
  `ondemo()`). The first `onwork` input stops it, and so does an `onreach` (round 5, W3: a sequence seeded full posts
  at open instead of demonstrating); a close, a chapter change and `dispose` clear its timer. Reduced
  motion plays it with the reduced preset (an opacity pulse), never skips it: the goal must be shown. So the player who
  missed the first playback replays it for free, and `hintTiers: 0` stays right. Tests (GM8h, fixture type):
  `yields: a demonstrating device plays its order once at open` (red: no `puzzle:demo` cue), `yields: the first input
  stops the demonstration and a wrong one replays it`, `yields: a dropped device leaves no demo timer` (the fake clock
  holds no pending timer); GM8b: `sequence: the device demonstrates its order` (a real `sequence`).
- **Attempts (m6; W2, round 3).** The limit lives in the session: `#settle` counts a wrong posted answer, dispatches
  `attempt-failed` and ends the session `failed` at `maxAttempts` (`puzzles/session.ts:245-251`), reached only from
  `attempt()` after `postAttempt` (`:208-233`); `#attempts` is copied from the run once (`:194`); the reducer's
  `attempt-failed` only bumps `run.attempts` (`reduce.ts:510-515`). Each type declares its wrong state
  (`PuzzleTypeData.wrong`, §7.1):
  - `'none'` (`path`, `grid`, `levers`): no wrong state; `maxAttempts` refused (`world/attempts-without-wrong`, GM7p);
  - `'posted'` (`code`, `order`, `setting`, `ritual`): as built;
  - `'local'` (`sequence`): the device sees the wrong press itself. `session.failLocal()` (GM8h) runs the same count as
    `#settle`'s wrong branch, factored into one private `#countWrong()`: `#attempts + 1`, `attempt-failed`, and at
    `maxAttempts` `#end('failed')`. `onEnd` -> `ended(..., 'failed')` (`yields.ts:524-561`) -> `puzzle-ended` -> the
    lock's `onFail` (`reduce.ts:493-497`) then runs at the third wrong ring, exactly as after a posted answer. yields
    calls it from `onwork(work, true)` after dispatching `device-moved` and routes the result through `attempted`
    (`yields.ts:632-653`), so the attempts line moves on every wrong ring. No POST: the limit is client state as built
    (D18, `yields.ts:572-576`).
  ```ts
  // client/src/puzzles/session.ts (PuzzleSession, GM8h)
  /** A wrong input the device itself detected: counts one attempt as a wrong posted answer does (attempt-failed; at
   *  maxAttempts the session ends 'failed'). `invalid` unless the type's `wrong` is 'local' and the puzzle is static
   *  (per-player.md §5.5: no local count ends a per-player run); `busy` while an attempt is in flight; `closed` after
   *  the end. */
  failLocal(): Result<AttemptResult, PuzzleError>;
  ```
  - Tests: `session: a local wrong input counts one attempt and the limit ends the session failed` (GM8h, a fixture
    `'local'` type; red: TS2339 `failLocal`; a red on the count instead means `#countWrong` diverged from `#settle`),
    `yields: the third local wrong input ends the device failed and fires its onFail` (GM8h; red on the parent: the
    session never ends and `fired` lacks `fail:<key>`), `sequence: three wrong rings jam the bell` (GM8b, a `sequence`
    world with `maxAttempts: 3`).

### 7.6 State-space budget and spike P2 (R2, m4)

- **Today:** cap 5,000 (LIMIT `reduce.ts:28`), shared by `world/state-cap` and the runtime search; ch1 406 states
  (MEASURED); softlock 38.3 ms (MEASURED, RULINGS 68); runtime search 50-58 ms quiet (MEASURED, F4 §4).
- **Growth (ARITHMETIC, independent facts):** views x3 at 2 per room (406 -> 1,218); each gating binary fact x2;
  kept tools x2 each (taken or not); examined / visited atoms read by a gating rule x2 each. Reachable states are fewer
  than the product (dependencies), which is what P2 measures.
- **Spike P2.** P2-a in GM1b: `client/scripts/story/spike-p2.test.ts`, a seeded generator on today's kernel at ch1
  density (3 rooms, 11 hotspots, 2 locks, 1 lock puzzle), emulating views as rooms with ungated exits back, flags and
  kept tools as items given by triggers and never consumed, recipes as two-slot locks with an `onOpen` give, clue
  facts as docs. It runs before GM4's cut, as R2 asks. P2-b in GM5 (real views and recipes) and GM5f (real flags,
  visual-only flags). Record per
  configuration: states, ms per section (quiet machine only), with and without the place quotient. Assertions are the
  design's claims: `spike p2: views at 2 per room fit the cap at ch1 density`, `spike p2: visual-only flags add no
  states`; the full mix is reported, not asserted.
  Changed by RULINGS 171 (as of `9a83251`; docs lane `docs-errata-10`, group A): P2-a ran in GM1b (`03a00bc`). Its
  generator follows ch1 as counted on `ef8b4dc`: 3 rooms, 11 hotspots, 2 locks, **both with a puzzle** (2 lock
  puzzles, not the 1 above), 3 items, 2 docs (GM1b cut D11 / Q7). States (MEASURED, eight seeds, a quiet machine):
  base 406-528; views 1,174-1,456 (`spike p2: views at 2 per room fit the cap at ch1 density` holds); flags 896-1,410;
  kept tools 1,516-1,840; recipes 3,276-4,140; clue facts 1,516-1,840; the full mix reaches `cap` on every seed
  (reported, not asserted), the input GM4's cut reads; the real ch1 406, with views 1,174 (x2.89, the arithmetic's
  x3). No place quotient exists before GM5q, so P2-a has no "with the quotient" row.
- **Responses, in order:** (1) the place quotient for views (synthesis §3.7, seen red on a gated view entry; round 4
  m6: it changes `sectionKey` in `mechanics/rules/search.ts`, outside GM5's lock, so a P2-b result past the cap is a
  STOP item at GM5's cut and the quotient is the conditional lane **GM5q**, §12); (2)
  visual-only facts out of the key (built into derived `reads`); (3) a section split, the authoring rule, with the
  per-section budget written into AUTHORING from P2's measured factors (`world/state-cap` already fails an oversized
  section); (4) a cap raise only on a measured budget-Android timing of the runtime search, outside these lanes.
