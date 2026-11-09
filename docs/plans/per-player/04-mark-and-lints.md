## 4. O1: the mark and the lints (synthesis §4.6)

**Source mark** (`story/<ch>/world.json`, strict keys):

```json
"drawer": { "type": "code", "params": { "dials": 4 }, "maxAttempts": null, …,
            "perPlayer": { "positions": [[0, 9], [0, 9], [0, 9], [0, 9]], "distinct": false, "exclude": [] },
            "hints": [ …, { "id": "ch1.drawer.h003", "ru": "Код: $code(drawer)." } ] }
```

- `positions` optional (default: `[0, max]` for each entry of `answerShape`), `distinct` default false, `exclude`
  default `[]`. The build adds the type's **`startShown(p)`** to `exclude` when it is non-null (E-P9, engine.md §7.1
  `PuzzleTypeData.startShown`, from GM1c): for `code` and `setting` it is `initial` (today's rule `code.ts:44`, so
  nothing changes for them); for `ritual` it is null (no full-length configuration shows before input), so nothing is
  added and no empty tuple reaches `Domain::parse`'s "excludes well formed" check (r3 m5).
- **Public world:** `"perPlayer": true` on the puzzle, emitted only when true, so static worlds keep their version hash
  (X9's hash covers every emitted field). `decodeWorldPublic` refuses an object-valued `perPlayer` as `secret` (beside
  `solution`, `hints`, `world/decode.ts:80`).

```ts
// client/src/world/types.ts (GM6c1a; `key` in ServerPuzzle: GM6c1b)
export type PerPlayerSource = { readonly positions: ReadonlyArray<readonly [number, number]> | null;
  readonly distinct: boolean; readonly exclude: ReadonlyArray<readonly number[]> };
export type SourcePuzzle = PuzzleBody & { readonly hints: readonly WorldText[] } &
  ({ readonly solution: readonly number[]; readonly perPlayer: null } | { readonly solution: null; readonly perPlayer: PerPlayerSource });
export type PublicPuzzle = PuzzleBody & { readonly hintTiers: HintTiers; readonly perPlayer: boolean };   // absent in JSON = false
export type ServerDomain = { readonly positions: ReadonlyArray<readonly [number, number]>; readonly distinct: boolean;
  readonly exclude: ReadonlyArray<readonly number[]> };                                // startShown included when non-null
export type ServerPuzzle = { readonly key?: PuzzleId /* GM6c1b: absent = the puzzle's own id */ } & (
  | { readonly type: string; answerLen: number; answerMax: number; solution: readonly number[]; title: Bilingual; hints: readonly Bilingual[] }
  | { readonly type: string; answerLen: number; answerMax: number; perPlayer: ServerDomain; maxAttempts: number | null;
      title: Bilingual; hints: readonly Bilingual[] });
export type ServerPuzzleContent = { readonly format: 1 | 2; readonly chapterId: ChapterId;
  readonly puzzles: Readonly<Record<PuzzleLocalId, ServerPuzzle>> };
// build-only, client/scripts/story/puzzles/code.ts (GM1c's file): PuzzleTypeLint<CodeParams>.domainFits(p, d): string | null
```

**Lints** (build-only `client/scripts/story/values.ts`: the rules on the mark through the per-world `VALUES_LINT` in
engine.md's `MECHANIC_LINTS`; the text rules, `world/placeholder`, `story/placeholder` and `world/clue-shows-value`,
through one stage-5 call in `story.ts` over the chapter's **world lines of the one walk** (R-E25, "World texts" below),
its ink lines and its en table, registered as the `runsFrom: 'story'` entry `VALUE_TEXTS_LINT`; every code in its
file's own table, "Where the codes live" below, r4 W1; round 6 moved the text rules' world half from the registry to
stage 5, r5 W1):

| Lint | Rule | Seen red on (named mutation) |
|---|---|---|
| `world/answer-source` | exactly one of `solution` / `perPlayer` | both keys on `drawer` |
| `world/per-player-type` | the type has a build-only `domainFits` (today `code` only); `order` and every `check: 'reach'` type are refused | `perPlayer` on `gate` (order) |
| `world/per-player-domain` | `domainFits`: positions inside `answerShape`, len = `answerLen`, lo <= hi, excludes well formed; acceptance >= 1/16 | a position `[0, 10]` on a code (max 9) |
| `world/entropy-floor` | size with `startShown` excluded (when non-null; E-P9) >= 1,000; and `maxAttempts / size <= 1 %` | `dials: 3` with `perPlayer` (999); must pass: a stub type with `startShown = null` and 4^5 = 1,024 tuples (nothing excluded) |
| `world/placeholder` | over **every world line of the walk**, kernel and module alike (R-E25): grammar (§5.1); names a per-player puzzle of this chapter; index 1..len; the same placeholder multiset in ru and en; a hint names only its own puzzle. **The surface rule is by role, never by field (round 6, r5 W1):** allowed only on a line of role `read` (today: doc body paragraphs, item descriptions; from GM6d2 every label) and on a `hint` line of the puzzle's own hints; **refused** on `toast` lines (look and lock texts: a toast lives seconds, and "scratched on the back" is a view room with a label, O5; engine.md's `use` `say` / `refuse` and a recipe's `say`) and on `name` lines (every title and name of rooms, docs, items, puzzles; prompts; hotspot labels). A role is required on every module text by the type, so there is no "unknown = allowed" | `$code(drawr)` in the diary; en without the placeholder; a placeholder in a look text; a placeholder in a fixture module text of role `toast` |
| `story/placeholder` | the same rules for ink lines and choice texts (ru in the ink, en in the locale table), against the chapter's per-player set | `$code(drawr)` in a line of `ch1.ink` |
| `world/clue-shows-value` | among the clues the per-player puzzle declares (engine.md's `clues: Cond[]`, GM1d, §7.3), >= 1 **shows the value**: a world line of role `read` holding the puzzle's placeholder (any index) has in its `reach` a condition `s` that the clue **contains** (`contains(c, s)`: every conjunct of `s`, i.e. `s` itself or the members of its `all`, is structurally equal to a conjunct of `c`; so when `c` holds, `s` holds and the text is readable). `reach` is R-E9's surface -> atom map as data on each line (round 6, R-E25): doc body `[{doc}]`, item desc `[{has}]`, a bg label `[{visited: room}]`, a prop label the conditions under which its anchor is drawn in a listed state (§6.2 "Texts and reach"); a module's `read` text brings its own. Ink lines as before (its knot); hints never count (a code reachable only by paying is a dark pattern); `toast` / `name` lines never count. A refusal names the accepted forms (each `s` of each `read` line holding the placeholder), so the author copies one. **Linear** per-player puzzles (no section holds them, `yields.ts:327-329`): >= 1 placeholder line is a plain top-level line of the knot holding the `# puzzle:` yield, before the yield, with no choice, gather label or conditional between them (conservative: it is on every path; R-E13 for the later `mustPass` form) (m7). **Its input (round 6, r5 m1):** the knot that yields the puzzle comes from the graph's facts (`GraphFacts.yields`, `graph.ts:57-59`), its header from `graph.knots` (`file`, `line`, `:21-33`); the lines from the header to the yield are read from the chapter's sources through the shared `classify` (`classify.ts:444`), the tag found with `tagsOf` / `tagKind` and parsed by `parseTags`, exactly as `stories.ts:196-211`'s `yieldIn` does; a clue line is a `text` line (`classify.ts:29`) whose text holds the placeholder and no `{`; any `choice`, `gather`, `stitch` or `block-*` line between the header and the yield fails it. No second tag parser, no edit of `graph.ts` | `drawer` with the placeholder only in the tier-3 hint; a linear per-player puzzle whose clue line sits behind a choice; a declared clue `{ "visited": "study" }` for a label shown only while the drawer is open (§6.2) |
| `world/clue-reachable` | engine.md's GM1d lint, unchanged: each declared clue atom reachable from the section entry without the puzzle's solved edge | engine.md (a diary inside its own drawer) |
| `world/per-player-runtime` | a `perPlayer` mark in a chapter listed in `story/chapters.json` is refused until GM6c4 lifts it (the runtime and every surface of GM6c2-GM6c4 exist then); test worlds are not listed | a mark on ch1 `drawer` before GM6c4 |
| `puzzle-key/*` | §3.8 (GM6c1b) | §3.8 table |
| `world/label-size`, `world/label-anchor`, `world/label-id` | §6.5 (GM6d2; round 6: `world/label-anchor` also refuses a label on a `take` hotspot's anchor, which leaves the room with its prop, and a listed state that draws nothing); the size bound applies to the **rendered** text: the template with each placeholder at its longest rendering (`answerLen` x digits of `answerMax`, plus `-` joins) <= 64 characters, so a generated record id never needs a hash (m9); `id` unique per room | 5 labels in a room; a label of eight `$code` placeholders over 64 characters |
| scan-dist | **no change**: a mis-routed template ships verbatim, and the existing hint-text and paid-world needles take whole texts of >= 12 code points (`client/scripts/scan-dist.ts:402-460`), placeholders included; a rendered value can never be in a build output. The synthesis's "fixed parts" fingerprints add nothing (refuted) | - |

**Entropy, ARITHMETIC:** 4 dials 10^4 - 1 = 9,999; 4 distinct digits 10·9·8·7 = 5,040 (`0000` is not distinct, nothing
to subtract); 3 dials 10^3 - 1 = 999 < 1,000 (refused); `order` <= 5! = 120 (`order.ts:9-10`; refused by type anyway);
a year 1700-1899 = 200 (refused). With `maxAttempts` <= 9 the 1 % rule needs >= 900, below the floor, so the floor
binds; the rule stays for any later cap above 10.

**Where the codes live (round 5; r4 W1, E-P13, RULINGS 134).** Every finding of the story tool is typed by
`Finding.code` and takes a severity (`client/scripts/story/lint.ts:11`, `:107`). This file adopts engine.md §3.2's
rule ([engine §3.2 The two halves and the registries](../engine/03-module-contract.md#32-the-two-halves-and-the-registries)): **no lane of this file adds to `LINT_CODES`** (`lint.ts:14-104`), STAGING-DSL §11 or
`dsl-doc.test.ts`; each code sits in the `codes` table of the build-only file that reports it, and that file is one
line of `MECHANIC_LINTS`. GM1d's one hunk widens `Finding.code` to `LintCode | MechanicLintCode | PuzzleLintCode`, and
every lane below runs after GM1d (GM6c1a's After names it; GM6c1b, GM6c4 and GM6d2 come after GM6c1a).

```ts
// client/scripts/story/values.ts (GM6c1a), build-only, node-free (round 6, r5 m5)
export const VALUES_CODES = {
  'world/answer-source': 'E', 'world/per-player-type': 'E', 'world/per-player-domain': 'E', 'world/entropy-floor': 'E',
  'world/per-player-runtime': 'E',                       // removed with its rule by GM6c4 (the lift)
} as const satisfies Readonly<Record<string, Severity>>;
export const VALUE_TEXT_CODES = {
  'world/placeholder': 'E', 'story/placeholder': 'E', 'world/clue-shows-value': 'E',
} as const satisfies Readonly<Record<string, Severity>>;
export type ValuesCode = keyof typeof VALUES_CODES;
export type ValueTextCode = keyof typeof VALUE_TEXT_CODES;
/** One line of MECHANIC_LINTS (`{ id: 'values', codes: VALUES_CODES, lint }`), per world: the rules on the mark:
 *  answer-source, per-player-type, per-player-domain (the message `domainFits` returns, reported under this file's
 *  code), entropy-floor, per-player-runtime. */
export const VALUES_LINT: WorldLint<ValuesCode>;
/** One line of MECHANIC_LINTS (`{ id: 'value-texts', codes: VALUE_TEXT_CODES, runsFrom: 'story' }`, engine.md §3.2's
 *  story-level form, R-E22): its rules run from `lintValueTexts`, never from the world runner. */
export const VALUE_TEXTS_LINT: WorldLint<ValueTextCode>;
/** Stage 5 of the story tool (one call per chapter in `story.ts`, after `localeStage`, `story.ts:696-697`): every text
 *  rule. world/placeholder over every world line (grammar, puzzle, index, surface by role, own hint, ru / en multiset),
 *  story/placeholder over ink lines and choices (ru and en), world/clue-shows-value with its linear rule (one verdict
 *  per puzzle needs the world lines and the ink lines together). Reads `role` / `reach`, never a field name, so a new
 *  module's texts need no edit here (round 6, r5 W1). */
export function lintValueTexts(input: ValueTextsInput): readonly Finding[];
export type ValueTextsInput = {
  readonly chapter: SourceChapter; readonly worldFile: string; readonly world: WorldSource;
  /** The chapter's world lines from the one walk (`worldLines`, R-E25), kept by `readWorlds` (`story.ts:319`). */
  readonly lines: readonly WorldTextLine[];
  readonly graph: ChapterGraph;
  /** The knot -> yields map of the graph stage (`GraphFacts.yields`, `graph.ts:57-59`; `story.ts:626`). */
  readonly yields: ReadonlyMap<KnotName, readonly YieldCommand[]>;
  /** story.ts's story-relative, BOM-stripped sources (the map `checkEndings` gets, `story.ts:664`), read through the
   *  shared `classify` for the linear rule (r5 m1). */
  readonly sources: ReadonlyMap<string, string>;
  readonly en: EnTable | null };

// client/scripts/story/keys.ts (GM6c1b), build-only, node-free (r5 m5)
export const KEY_CODES = {
  'puzzle-key/chain': 'E', 'puzzle-key/unrecorded': 'E', 'puzzle-key/dropped': 'E', 'puzzle-key/retired-reused': 'E',
  'puzzle-key/rename-agrees': 'E', 'puzzle-key/retire-after-release': 'E',
} as const satisfies Readonly<Record<string, Severity>>;
export type KeyCode = keyof typeof KEY_CODES;
/** One line of MECHANIC_LINTS (`{ id: 'keys', codes: KEY_CODES, runsFrom: 'story' }`, engine.md's R-E22 answer):
 *  every key rule reads the record and every chapter at once, which no per-world input holds. */
export const KEY_LINT: WorldLint<KeyCode>;
/** The chain's hash, injected (r5 m5): story.ts and keys.test.ts bind it to node:crypto's createHash. */
export type Sha256 = (text: string) => string;
/** One call per run in `story.ts` after the world stage (`story.ts:630-651`), from GM6c1b commit 2 (r5 m6). */
export function lintPuzzleKeys(input: { readonly record: string | null; readonly chapters: readonly SourceChapter[];
  readonly worlds: ReadonlyMap<ChapterId, WorldSource>; readonly sha256: Sha256 }): readonly Finding[];

// client/scripts/story/mechanics/labels.ts (GM6d2), node-free: LABEL_CODES = { 'world/label-size',
// 'world/label-anchor', 'world/label-id' } (all 'E'), LABELS_LINT one line of MECHANIC_LINTS (per world: the room's
// labels and anchors), and LABELS_TEXTS: TextWalker<LabelsData>, the labels' entry of engine.md's MECHANIC_TEXTS in
// mechanics/index.ts (§6.2 "Texts and reach"; round 7, E-P16 (a)).
```

**World texts reach every text pass (round 6, r5 W1; R-E25 is engine.md's contract, sketched here as requested).**

- **The defect on the tree.** `worldLines` is the one walker of world texts and a fixed list of kernel fields
  (`world.ts:324-360`); everything that reads world texts reads its output: the en checks (`locales.ts:239`, an unknown
  en key is `loc/orphan-en`, `:196-199`), the shipped en (`story.ts:740`, which throws on a line without en,
  `:432-442`), the paid and hint needles (`world.ts:393-404`, called at `scan-dist.ts:485`; round 7, r6 m6 (f)), scan-dist's
  public texts (`:457`), `id/chapter-prefix`
  (`world.ts:661-666`), and this file's text rules. A text in `world.mods` is in none of them, so GM6d2's label en
  entry would fail the gate as an orphan, a label typo would pass, and engine.md's own `say` / `refuse` (GM3) would
  meet the same orphan. engine.md §5.1 left it as a verify item of GM3, whose lock lacks `world.ts` ([engine §5.1 World JSON: keys per module, no world-format bump](../engine/05-world-data-and-save-format.md#51-world-json-keys-per-module-no-world-format-bump)).
- **The contract (R-E25), as engine.md adopted it (round 7 mirror, E-P16 (a), (c)).** engine.md owns it (§3.2 "Module
  texts", [engine §3.2 The two halves and the registries](../engine/03-module-contract.md#32-the-two-halves-and-the-registries) as read); this file uses these names and designs none of them:
  - `client/scripts/story/mechanics/texts.ts` (GM3c only; build-only, node-free): `TextRole` (`read` / `toast` / `name`
    / `hint`), `ModuleText { text, path, role: Exclude<TextRole, 'hint'>, reach: readonly Cond[] }`, `PlacePaths`
    (`room`, `hotspot`, `item`, and `slot(k, index)` for `Lock.slots`), `TextWalker<D> = (w: WorldSource, d: D, at:
    PlacePaths) => readonly ModuleText[]`, `KERNEL_TEXT_ROLES` (the kernel roles below, as data) and `TEXTS_LINT`
    (`world/text-unwalked`: every `{ id, ru }` object under `w.mods` must be a walked line).
  - `client/scripts/story/mechanics/index.ts`, beside `MECHANIC_LINTS`: `MECHANIC_TEXTS`, exhaustive over
    `MECHANIC_DATA` ids (`TextWalker<DataOf<M>> | null`); every module lane adds its line there, in the file it already
    holds for its `MECHANIC_LINTS` line (GM6d2: `labels: LABELS_TEXTS`).
  - `client/scripts/story/world.ts` (GM3c): `WorldTextLine = WorldLine & { role, reach }` (a subtype: today's literals
    stay valid) and `worldLines(w, file, text, texts?)`, the kernel texts in today's order, then every `MECHANIC_TEXTS`
    entry in `MECHANIC_DATA` order.

- **Kernel roles** (R-E9 as data): item name `name`; item desc `read`, reach `[{ has: <item> }]`; doc title `name`; doc
  body `read`, reach `[{ doc: <doc> }]`; puzzle title and prompt `name`; hints `hint`; room title `name`; hotspot label
  `name`; lock text `toast`; look `toast`. This is exactly round 5's allowed / refused list, now data. The `core`
  module's `MECHANIC_TEXTS` entry is `null`: the kernel texts are the walk's own first part, never walked twice.
- **Invariants (asked in round 6, adopted by engine.md round 6):** one walk, each text once; every consumer above
  unchanged in code (they read the lines); a module holding texts cannot ship without declaring them: `tsc` through the
  mapped type fails a module with **no entry**, the registry test `mechanics: every module declares its texts` (seen
  red on a deleted entry) pins it, and engine.md's structural gate `world/text-unwalked` fails a **`null` entry or a
  walker that misses a field**, which `tsc` alone lets pass (round 7, E-P16 (b): round 6 wrote this invariant as if
  `tsc` closed it); a `read` text is rendered through
  `Yields.render` by its module's view (its lane shows a value on that surface in a test); 0 runtime bytes (build
  only); `texts.ts` and every module build file it imports value-import nothing from `world.ts` (no cycle:
  `world.ts` -> `texts.ts` -> module files); node-free (`world.ts:5`). GM3c's tests (engine.md's names): `story: a
  module text is a world line with its role` (a fixture module through the `texts` parameter; red on the parent: the
  fixture's ID is absent) and `story: a module text's en entry is checked` (`checkLocales`: no `loc/orphan-en`; the
  entry removed: `loc/missing-en`; shipping follows from `story.ts:319` -> `:740` reading the same lines).
- **This file's side.** `values.ts` reads `role` / `reach` only (GM6c1a, from fixture `WorldTextLine`s in its tests, so
  it does not wait for any module); GM6d2 declares the labels' texts in `scripts/story/mechanics/labels.ts`
  (`LABELS_TEXTS: TextWalker<LabelsData>`) and adds one `MECHANIC_TEXTS` line in `mechanics/index.ts` (§6.2, lock 14;
  round 7, E-P16 (a)). No lane of this file edits `world.ts` or `texts.ts`. **If R-E25 is not merged when
  GM6c1a is cut, the cut is BLOCKED** (its rules would have no roles to read) and the orchestrator decides between
  engine.md landing it first and GM6c1a taking `world.ts` (a STOP item, never a guess).
- **Gains beyond labels.** A paid chapter's module texts become paid needles (`scan-dist.ts:485`, principle 0; round 7,
  r6 m6 (f)), a free chapter's become public texts (`:457`), and
  `--sync-locales` appends their en stubs, from the first module with texts on.
- **Alternatives (rejected).** (a) GM6d2 holds `world.ts` and `values.ts` and adds a `labels` branch to each: every
  later module with texts repeats it in two central files, a fork of the story tool per mechanic, and engine.md's own
  GM3 would still be orphaned until then. (b) A `texts` member on the runtime `MechanicData`: ~5 lines per module in
  the engine chunk (ARITHMETIC ~0.02 KB br each) for a build-only need. (c) Field-pattern rules in `values.ts`
  ("`*.text` under `rooms.*.labels`"): "unknown = allowed" by construction.

**Where the codes live (continued from the sketch above).**

- **Severity.** Every finding of these files is built with its own table's severity (`codes[code]`), never through
  `story.ts`'s `finding()` helper, which reads `LINT_CODES` (`story.ts:48-49`). Stage-5 findings name their file as the
  rest of the tool does (ink files repo-relative through `inStory`, `story.ts:53`; the world file as `lintWorld`'s
  `file`, `:641`).
- **Why stage 5 for the text rules.** The en tables are read at stage 5 (`story.ts:688-697`), after the world lint
  (`:630-651`); the ink lines come from the graph (`:618-627`). A stage-5 error does not keep its chapter from the
  playthrough (`:685-686`), which costs nothing here: a mis-written placeholder plays verbatim and still fails the
  gate. The rules on the mark stay in the registry, so they gate play as every world error does. **Round 6:** the
  whole of `world/placeholder` runs at stage 5 (its world-text half included), because it reads the walk's lines,
  which `story.ts` already holds per chapter (`story.ts:319`, `:691`), and because a value import of `world.ts` from
  `values.ts` could close a cycle (GM1b's world runner of `MECHANIC_LINTS` sits in or beside `lintWorld`,
  `world.ts`, and the registry imports `values.ts`; verify at GM6c1a's cut); `values.ts` imports only types from
  `world.ts`.
- **Node-free registered files (round 6, r5 m5).** `lint.ts` stays node-free because the app program compiles it
  through `dsl-doc.test.ts` (`lint.ts:2-3`), and after GM1d's hunk the app program reaches `mechanics/index.ts`'s types
  and through them every registered file (`tsconfig.json:7`, `:21`: `types: ["vite/client"]` only). Whether a
  `node:crypto` import there would fail `check` depends on vitest's types pulling `@types/node` in (unverified, no
  `node_modules` on main), so this file does not rely on it: `values.ts`, `keys.ts` and `mechanics/labels.ts` import no
  `node:` module (the hash is injected, §3.8), and each lane pins its file with a source test: `values: values.ts
  imports no node module` (GM6c1a), `keys: keys.ts imports no node module` (GM6c1b), `labels: mechanics/labels.ts
  imports no node module` (GM6d2), each reading its file's import specifiers (node project, `node:fs` in the test only)
  and seen red on the mutation "the file imports `createHash` from `node:crypto`".
- **Pins in every lane that adds or removes a code (GM6c1a, GM6c1b, GM6c4, GM6d2):** `dsl-doc: lint table equals lint
  codes` green and untouched (its count is the lane base's: 86 at `525dd68`, `dsl-doc.test.ts:146`; an adopted
  animation or shot lane may move it, as `characters.md:1526` planned 87 -> 88 for MD3, never a lane of this file);
  engine.md GM1d's `story: module and type lint codes are unique and none is a DSL code` green, now over these codes
  too. Each registering lane adds `story: the <values | key | label> lint codes are registered once` (`MECHANIC_LINTS`
  holds exactly one entry with that id, and its `codes` keys equal the table's; for `values.ts` both entries,
  `values` and `value-texts`, round 6), seen red on the mutation "the registry line removed", so a registration that
  types nothing (a `MechanicLintCode` that widened to `string`) cannot pass vacuously.
- **Alternatives (rejected).** (a) The codes in `LINT_CODES` with STAGING-DSL §11 rows and the `dsl-doc` literal raised:
  three files outside every lock and every lint lane serialized on them (engine.md [engine §3.2 The two halves and the registries](../engine/03-module-contract.md#32-the-two-halves-and-the-registries)). (b) GM6c1b widens
  `Finding.code` by a fourth union in its `lint.ts` hunk: a second widening of one closed type from another track's
  lane, and `lint.ts` back beside A(`lint.ts`) (rev. 3: MA1b -> MD3). (c) `WorldLintInput` carrying the graph and the
  en table: a change to GM1b's contract for one consumer, and the en tables are read after the world stage anyway.
- **For the adoption docs lane's module-code table** (engine.md §15 Q10), this file's codes: `values.ts`
  (`VALUES_CODES`: `world/answer-source`, `world/per-player-type`, `world/per-player-domain`, `world/entropy-floor`,
  `world/per-player-runtime` until GM6c4; `VALUE_TEXT_CODES`: `world/placeholder`, `story/placeholder`,
  `world/clue-shows-value`),
  `keys.ts` (the six `puzzle-key/*` of §3.8), `mechanics/labels.ts` (`world/label-size`, `world/label-anchor`,
  `world/label-id`); every one `E`. Removed by this file: engine.md GM2b's `world/renamed-puzzles` (GM6c1b's lift
  deletes the rule and its code from `mechanics/core.ts`).
