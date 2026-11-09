## 3. The module contract

### 3.1 Kernel types (engine; `client/src/mechanics/contract.ts`, pure, types and constants only)

```ts
type Brand<T, B extends string> = T & { readonly __brand: B };
export type MechanicId = Brand<string, 'MechanicId'>;
export type FlagId = Brand<string, 'FlagId'>;
export type StateName = Brand<string, 'StateName'>;            // 'default' or a declared state
export type AnchorKey = Brand<string, 'AnchorKey'>;            // `<room>.<hotspot>` or `<room>~<decor>`
export type TriggerKey = Brand<string, 'TriggerKey'>;          // a `fired` entry: `enter:<room>` | `then:<key>` | ...
/** Every issue reported. Round 6 (W1): the kernel's own issue type (`client/src/world/decode.ts:61-65`), so a module's
 *  `line-id` issue maps to `id/missing` / `id/format` in `decodeWorldFile` (`client/scripts/story/world.ts:192-197`)
 *  exactly as a kernel text's does. */
export type Issue = WorldIssue;              // { path: string; reason: 'shape' | 'id' | 'line-id' | 'range' | 'hint-count' | 'secret'; detail: string }

/** A fact a rule can read or write; `id` is the fact's id (an item, a hotspot key, a room, `<puzzle>.<index>=<v>`). */
export type FactAtom = { readonly kind: FactKind; readonly id: string };
export type KernelFactKind =
  | 'held' | 'used' | 'doc' | 'taken' | 'examined' | 'open' | 'slot' | 'fired' | 'visited'
  | 'solved' | 'failed' | 'abandoned' | 'attempt' | 'hint' | 'story';
export type FactKind = KernelFactKind | ModuleFactKind;        // ModuleFactKind derived from MECHANIC_DATA[*].facts
/** WorldState fields whose changes are never a fact cue, each with its reason (the cue gate reads this list). */
export const SILENT_FIELDS = {
  format: 'not play state', section: 'every change is a `move:enter|resume` or a `move:leave` cue (§8.1)',
  room: 'every change is a move cue', lastRoom: 'bookkeeping of the move', unproved: 'bookkeeping of reconcile',
} as const;

export type CauseVerb = 'tap' | 'insert' | 'use' | 'combine' | 'enter' | 'return' | 'trigger' | 'solve' | 'fail'
  | 'device' | 'leave-view' | 'carry';                         // 'carry': an item the chapter start gave (§6.6)
export type Cause = { readonly verb: CauseVerb; readonly at: HotspotKey | null; readonly item: ItemId | null;
  readonly via: TriggerKey | null };

/** The one write path of every rule. Each list-field change appends one fact change per added / removed member. */
export interface Writer {
  readonly state: WorldState;
  set<K extends ListField>(field: K, value: WorldState[K], cause: Cause): void;
  run(puzzle: PuzzleLocalId, run: PuzzleRun, cause: Cause): void;      // solved / failed / attempt / hint / work facts
  fire(trigger: TriggerKey, effects: readonly Effect[], cause: Cause): void;   // the kernel trigger runner
  effect(e: ExploreEffect): void;
  cue(module: MechanicId, name: string, at: HotspotKey | null, item: ItemId | null): void;   // a module cue
}
```

### 3.2 The two halves and the registries

```ts
/** Round 6 (W1; GM1b declares both, GM3c's composed decoder builds them). The places a module may own keys in, each
 *  owned value with its place's id and **source path** (`sections.<s>.rooms.<r>.hotspots.<i>`, `items.<id>`, ...), so
 *  a module issue and a module text carry the path the author's file has. */
export type Place = 'world' | 'item' | 'room' | 'hotspot' | 'slot' | 'effect';
export type OwnedAt = { readonly place: Place; readonly id: string /* item / room id, HotspotKey, `<HotspotKey>#<slot>`, trigger path */;
  readonly path: string; readonly raw: Readonly<Record<string, unknown>> /* only the keys of owns[place] */ };
export type OwnedRaw = readonly OwnedAt[];               // one entry per place that carries at least one owned key
/** The kernel decoders a module reuses, in the kernel's decoder shape (`(v, path, report) => T`,
 *  `client/src/world/decode.ts:202-203`, written out here so GM1b needs no export from decode.ts): GM3c passes the
 *  kernel's `text('line-id')`, so a module text without an `id` is `line-id` at `<path>.id`. Conditions decode through
 *  `decodeCond` (§4, `mechanics/data/conditions.ts`). */
export type IssueReport = (path: string, reason: WorldIssue['reason'], detail: string) => void;
export type DecodeCtx = { readonly text: (v: unknown, path: string, report: IssueReport) => WorldText };

/** ENGINE half, client/src/mechanics/data/<id>.ts. Runs at chapter load and at resume, before any room. */
export interface MechanicData<Id extends string, D, Sl = never> {
  readonly id: Id;
  /** 'none': a data-only module (labels, per-player R-E6); the alignment test then skips it. */
  readonly rules: 'chunk' | 'none';
  /** Exactly the keys this module owns per place; a key owned twice fails `mechanics: every key has one owner`. */
  readonly owns: { readonly world?: readonly string[]; readonly item?: readonly string[];
    readonly room?: readonly string[]; readonly hotspot?: readonly string[]; readonly slot?: readonly string[];
    readonly effect?: readonly string[]; readonly trigger?: string; readonly atoms?: readonly string[];
    readonly facts?: readonly string[] };
  /** Strict keys, every issue reported. Gets only its owned keys, per place; the result goes to `world.mods[id]`. */
  decode(raw: OwnedRaw, ctx: DecodeCtx): Result<D, Issue[]>;
  /** The inverse, for emission and the version hash: `decode(encode(d))` equals `d` (a test per module). */
  encode(d: D): OwnedRaw;
  /** Reconcile steps 1-3 for this module's facts: drop refs the world lost, refit, re-arm lost gifts. */
  normalize(w: KernelWorld, s: WorldState, dropped: string[]): WorldState;
  /** The effects a `fired` entry with this module's prefix names (today's `triggerOf`, reconcile.ts:156-174). */
  trigger?(w: KernelWorld, target: string): readonly Effect[] | undefined;
  /** Condition atoms this module adds: their decoder, and whether a gating condition may use them. */
  readonly atoms?: { readonly [kind: string]: { decode: Decoder<unknown>; gating: boolean } };
  /** Saved state beyond facts. Its key must be in SAVE_FIELDS[SAVE_FORMAT]; adding one is a format bump (§5.2). */
  readonly slice?: { readonly key: string; readonly initial: Sl; read: Field<Sl>; normalize(w: KernelWorld, s: Sl): Sl };
  /** The DOM controls this module's UI adds, with their trigger (§8.3); `ui:<name>` keys derive from them. A control
   *  plays `UI_MOTIONS`' default unless it names its own preset; `haptic` adds touch feedback on top (§8.5). Data, in
   *  the engine half (round 3), so the cue stage resolves a control's motion without importing any rules half.
   *  Round 4 (m2): **GM3m adds this field** together with `ControlDecl` (`cues/types.ts`); GM1b's interface has none,
   *  so no lane declares a control before its type exists. */
  readonly controls?: readonly ControlDecl[];
}

/** CHUNK half, client/src/mechanics/rules/<id>.ts (explore-ui family). Never value-imported by the engine. */
export interface MechanicRules<Id extends string, A extends { readonly kind: string }, C extends string> {
  readonly id: Id;                                        // same id, same relative order as its data half
  /** Every action this module enables in s (the proof enumerates them). */
  actions(w: KernelWorld, s: WorldState): readonly A[];
  apply(w: KernelWorld, a: A, out: Writer): void;
  /** Every fact this module's GATING rules read in `section`: sectionKey is built from these (§3.7 synthesis). */
  reads(w: KernelWorld, section: SectionId): readonly FactAtom[];
  /** Module cue names; each `module:<id>:<name>` needs a CUE_MOTIONS entry (tsc, through the mapped type). */
  readonly cues: readonly C[];
  /** A tap on a hotspot that carries a key this module owns (`owns.hotspot`): core's `tap` hands it over before its own
   *  kinds, so the UI always dispatches `tap` and `actions` lists that tap once (core already does). False: not mine. */
  tap?(w: KernelWorld, s: WorldState, at: HotspotKey, out: Writer): boolean;
  /** Round 4 (m9): runs once per `room` effect into `room`, after the room's `onEnter` trigger and only when no event
   *  knot is pending; core calls it at its three `room` pushes (a move, `reduce.ts:322`; a resume, `:332`; an event
   *  return, `:354`). It writes no state: `ArrivalOut` offers only a `puzzle` effect and a module cue, so the proof's
   *  states are unchanged and `actions` never lists it. A puzzle end pushes no `room` effect, so it never re-arrives. */
  arrived?(w: KernelWorld, s: WorldState, room: RoomId, out: ArrivalOut): void;
  /** Evaluates an atom kind its data half declared. */
  holds?(w: KernelWorld, s: WorldState, atom: { kind: string; value: unknown }): boolean;
  /** Its share of the room's derived picture. */
  visuals?(w: KernelWorld, s: WorldState, room: RoomId): readonly PropView[];
}

// client/src/mechanics/data/index.ts:  export const MECHANIC_DATA  = [core, use, visual, view, combine, flags, devices, carry, labels] as const;
// client/src/mechanics/rules/index.ts: export const MECHANIC_RULES = [core, use, visual, view, combine, flags, devices, carry] as const;
export type SectionAction = ActionOf<(typeof MECHANIC_RULES)[number]>;           // the derived union
export type ModuleCueKey = { [R in (typeof MECHANIC_RULES)[number] as R['id']]: `module:${R['id']}:${R['cues'][number]}` }[(typeof MECHANIC_RULES)[number]['id']];
/** The decoded world: kernel body + one side table per module (R10: modules never edit world/types.ts). */
export type KernelWorld = WorldPublic & { readonly mods: ModsOf<typeof MECHANIC_DATA> };

// Engine kernel, explore/: state.ts, project.ts (kernel projection; `fl_` added by GM5f as a kernel fact kind),
// reconcile.ts (steps 0-3, every section marked unproved), reduce.ts (worldIndex, sectionScope, lockOf, hotspotKey,
// constants, types, and the run reducer):
export function runReduce(w: WorldPublicBody, s: WorldState, a: RunAction): { state: WorldState; effects: ExploreEffect[] };
//   RunAction = attempt-failed | hint-opened | puzzle-ended, for a puzzle no lock holds; a lock puzzle: a no-op (pinned)
// Chunk, mechanics/rules/: core.ts (today's tap / insert / triggers / puzzle-ended), search.ts (successors, derived
// sectionKey, searchSection, inSectionReach, resetSection, admitSection, sectionEntry), writer.ts, and the modules.
export function reduce(w: KernelWorld, s: WorldState, a: SectionAction): { state: WorldState; effects: ExploreEffect[] };
```

- **Exhaustiveness.** Dispatch is a typed map over the tuple; a module missing a member fails `tsc`. Registry test
  `mechanics: every key has one owner` (kinds, keys per place, effects, trigger prefixes, atoms, fact kinds, cue names)
  and `mechanics: data and rules registries align` (rules ids = data ids with `rules: 'chunk'`, same order).
- **The composed decoder** (GM3c, once): `world/decode.ts` keeps strict `exactKeys` per place, with the allowed set =
  kernel keys + every module's `owns[place]`; owned values go to the module's `decode`, the outputs to `world.mods`.
  `toPublic` / emission call `encode`; a module with a secret part (none of this file's) adds `toServer`. Round 6 (W1):
  each owned value reaches the module as an `OwnedAt` with its place's source path, and the module decodes its texts
  through `DecodeCtx.text`, so its issues carry source paths and its texts their line-ID rule.
- **Arrival output (round 4, m9; GM1b):**
  `type ArrivalOut = { effect(e: Extract<ExploreEffect, { kind: 'puzzle' }>): void; cue(module: MechanicId, name: string,
  at: HotspotKey | null): void }`. A `puzzle` effect from arrival makes `successors` expand the move edge into
  `closed` / outcomes (`reduce.ts:598-618`), which are the same states the device hotspot's own `tap` already reaches
  (`actions` lists it, `reduce.ts:572-577`), so the state count is unchanged (pinned in GM8i).
- **Lint codes (round 4, found while resolving).** Every finding takes its severity from `LINT_CODES`
  (`client/scripts/story/lint.ts:14-104`), and `dsl-doc: lint table equals lint codes` holds that table equal to
  STAGING-DSL §11 with exactly 86 rows (`client/src/story/dsl-doc.test.ts:139-152`). A code added there would force
  `lint.ts`, `docs/STAGING-DSL.md` and `dsl-doc.test.ts` into every lane that adds a lint, and serialize all of them on
  three files. So **no lane of this design adds to `LINT_CODES`**; each lint file declares its own codes:

```ts
// client/scripts/story/mechanics/index.ts (build-only, GM1b): the world lint registry
export type WorldLint<C extends string> = {
  readonly id: string;                                   // a module id, or a build pass ('clues', 'puzzle-shape')
  readonly codes: { readonly [K in C]: Severity };       // its own codes; unique across every registry (test below)
} & (
  /** A per-world pass: the world runner calls it once per chapter world. */
  | { lint(input: WorldLintInput): readonly Finding[] }  // findings built with `codes[code]` as their severity
  /** Round 5 (per-player R-E22): a pass whose rules run from a story-level call in `client/scripts/story.ts`, over
   *  every chapter at once (GM9p's carry proof; per-player's `keys.ts`). The entry registers its codes only; the
   *  world runner never calls it, and the union makes a per-world entry without `lint` a `tsc` error rather than a
   *  silent no-op. One file may export one entry of each kind, with disjoint codes. */
  | { readonly runsFrom: 'story' }
);
/** Round 6 (found while resolving W1: the type was named, never written). What the world runner, inside `lintWorld`
 *  (GM1b), hands every per-world pass: the inputs `lintWorld` already takes (`client/scripts/story/world.ts:415-424`)
 *  and its line lookup (`lineOf` over `pathLines`, `:93`, `:157-165`), so a pass reports at the author's line. */
export type WorldLintInput = { readonly chapter: SourceChapter; readonly file: string; readonly text: string;
  readonly world: WorldSource; readonly catalog: AssetCatalog; readonly knots: ReadonlySet<KnotName> | null;
  readonly yielded: ReadonlySet<PuzzleLocalId> | null; readonly declared: ReadonlyMap<VarName, VarLiteral>;
  readonly line: (path: string) => number;
  /** Round 7 (critique_engine_r6 m1; GM3c adds the field): the line IDs each module's walker returned for this world,
   *  from the one module walk `world.ts` runs for `worldLines` too (`moduleTextsOf`, below). `TEXTS_LINT` reads only
   *  this, so it needs neither `MECHANIC_TEXTS` nor the places index, and no lint file imports a value from `index.ts`
   *  or `world.ts`. A module with a `null` entry maps to an empty set. */
  readonly moduleLines: ReadonlyMap<MechanicId, ReadonlySet<LineId>> };
export const MECHANIC_LINTS: readonly WorldLint<string>[];   // `as const`; one line per module lint file
export type MechanicLintCode = /* keyof the `codes` of every MECHANIC_LINTS entry */ string;
// client/scripts/story/puzzles/index.ts (build-only, GM1c; round 4 m5): the puzzle-type lint registry
export const PUZZLE_LINTS: { readonly [T in PuzzleType]: PuzzleTypeLint<ParamsOf<T>> & { readonly codes: { readonly [c: string]: Severity } } };
export type PuzzleLintCode = /* keyof the `codes` of every PUZZLE_LINTS entry */ string;
// client/scripts/story/lint.ts (GM1d, one hunk): `Finding.code: LintCode | MechanicLintCode | PuzzleLintCode`;
// `LintCode` and `LINT_CODES` stay the DSL's and today's kernel codes, unchanged.
```

  Test `story: module and type lint codes are unique and none is a DSL code` (GM1d; seen red on a fixture lint whose
  `codes` holds `world/softlock`; round 5, R-E22: it reads the `codes` of `runsFrom: 'story'` entries too, seen red on
  a fixture story-level entry that repeats a module's code); `dsl-doc: lint table equals lint codes` stays green at 86 in every lane (a pin). The
  doc table of the module codes belongs to the adoption docs lane, which adds its own doc test (orchestrator Q10).
  verify at GM1d's cut: every reader of `Finding.code` (`client/scripts/story.ts`'s report and allowlist,
  `story.ts:459-475`) accepts the wider union.
- **Module texts (round 6, critique_engine_r5 W1; per-player R-E25; lane GM3c).** `worldLines`
  (`client/scripts/story/world.ts:325-359`) is the one walker of world texts and every text pass reads its output: the
  en checks (`checkLocales`, `client/scripts/story/locales.ts:239`; `loc/missing-en` / `loc/orphan-en`, `:175-200`), the
  shipped en (`shippedEn`, `client/scripts/story.ts:432-440`, over the lines stored at `:319`), `id/chapter-prefix`
  (`world.ts:661-666`), the hint and paid needles (`worldFingerprints`, `world.ts:393-404`), scan-dist's public texts
  (`client/scripts/scan-dist.ts:457`), `id/duplicate` across chapters (`locales.ts:274`), `--sync-locales`, and
  per-player's text rules. So module texts join **that walk**, and no consumer changes:

```ts
// client/scripts/story/mechanics/texts.ts (build-only, GM3c; pure, no node:*: world.ts imports it and scan-dist
// imports world.ts, world.ts:5; it and every module lint file value-import nothing from world.ts). Round 7 (m1): its
// only imports from `./index.ts` (`WorldLint`, `WorldLintInput`) and from `../world.ts` are `import type`, erased at
// run time (`verbatimModuleSyntax`, client/tsconfig.json:9, tsconfig.node.json:8; the tool runs on Node's type
// stripping, package.json:15), so the value graph is world.ts -> index.ts -> texts.ts with no edge back: no cycle and
// no TDZ whichever module loads first (a test imports texts.ts alone). Test `texts: texts.ts value-imports nothing
// from mechanics/index.ts or world.ts` (GM3c, a source check of its import lines; red on the mutation `import type`
// -> `import`).
/** How the player meets a world text; per-player's placeholder and clue rules decide per role, never per field. */
export type TextRole =
  | 'read'    // read at leisure and rendered through the values store (doc body, item description, a label)
  | 'toast'   // a note that lives seconds (look, lock text, `use`'s say / refuse, a recipe's say)
  | 'name'    // a title, a name, a prompt, a hotspot label
  | 'hint';   // a hint tier: kernel puzzles only (server content; a module's data ships in the public world, so a
              // module text can never be a hint: principle 0)
/** One module text. `path` is its dotted source path from the world root (findings, `lineOf`, `--fix-ids`); `reach`
 *  lists conditions any one of which, when it holds, lets the player read it (R-E9's surfaces as data; [] = it can
 *  never serve as a clue; read by per-player's rules on `read` lines only). */
export type ModuleText = { readonly text: WorldText; readonly path: string;
  readonly role: Exclude<TextRole, 'hint'>; readonly reach: readonly Cond[] };
/** The source paths of the world's places. Only the type lives here; `world.ts` builds the value once per walk from
 *  its private places index (`placePaths(placesOf(w))`, `world.ts:246-271`; round 7, m1), so `placesOf` stays
 *  unexported and no lint file needs it. */
export type PlacePaths = { room(r: RoomId): string; hotspot(k: HotspotKey): string; item(i: ItemId): string;
  slot(k: HotspotKey, index: number): string };          // round 6: `slot` added to R-E25's shape (`Lock.slots`, types.ts:49)
/** A module's walker: its texts in source order, read from its own decoded data `d` (= `w.mods[id]`) and, when it needs
 *  them, other modules' data (labels read `visual` and `flags`). */
export type TextWalker<D> = (w: WorldSource, d: D, at: PlacePaths) => readonly ModuleText[];
export const TEXT_CODES = { 'world/text-unwalked': 'E' } as const satisfies Readonly<Record<string, Severity>>;
/** One line of MECHANIC_LINTS (`{ id: 'texts', codes: TEXT_CODES, lint }`, per world): every plain object inside
 *  `w.mods[m]` whose own keys are exactly `id` and `ru`, both strings (the predicate the version hash already calls a
 *  text, `client/scripts/story/emit.ts:150-164`), has its `id` in `input.moduleLines.get(m)` (round 7: the walked IDs
 *  come in with the input, so this file reads no registry); reported at the line where the ID first appears in the
 *  world file (`input.text`). So a module that declares `null`, or a walker that misses a field, fails `npm run story`
 *  the first time its data holds a text. */
export const TEXTS_LINT: WorldLint<keyof typeof TEXT_CODES>;
/** The kernel's roles (R-E9 as data): item name `name`; item desc `read`, reach [{ has: item }]; doc title `name`; doc
 *  body `read`, reach [{ doc: doc }]; puzzle title, prompt `name`; puzzle hints `hint`; room title, hotspot label `name`;
 *  lock text, look `toast`. Each kernel field's role and reach in one table, so a new kernel text field is one row. */
export type KernelTextField = 'item.name' | 'item.desc' | 'doc.title' | 'doc.body' | 'puzzle.title' | 'puzzle.prompt'
  | 'puzzle.hints' | 'room.title' | 'hotspot.label' | 'lock.locked' | 'hotspot.look';   // today's walk, world.ts:331-357
export const KERNEL_TEXT_ROLES: { readonly [field in KernelTextField]: { readonly role: TextRole; readonly reach: 'has' | 'doc' | null } };

// client/scripts/story/mechanics/index.ts (beside MECHANIC_LINTS; GM3c adds it with `core: null`; every module lane
// adds its line, as it adds its MECHANIC_LINTS line, in the same file it already holds)
/** Exhaustive over MECHANIC_DATA ids (tsc: an id without an entry fails `check`); null = the module owns no text. */
export const MECHANIC_TEXTS: { readonly [M in (typeof MECHANIC_DATA)[number] as M['id']]: TextWalker<DataOf<M>> | null };
export type DataOf<M> = M extends MechanicData<string, infer D, infer _S> ? D : never;   // type-only import (engine)

// client/scripts/story/world.ts (GM3c)
/** A subtype, so today's `WorldLine` literals and readers stay valid (`locales.test.ts:238-240`, `story.ts:167`,
 *  `:208`, `:302`); `hint === (role === 'hint')`, so `worldFingerprints`' filter is unchanged. */
export type WorldTextLine = WorldLine & { readonly role: TextRole; readonly reach: readonly Cond[] };
/** The kernel texts in today's order with their roles, then every MECHANIC_TEXTS entry in MECHANIC_DATA order; `texts`
 *  is a parameter for fixture modules, as GM3c's decoder takes its registry. A path the places cannot resolve maps to
 *  line 0, as `lineOf` does today (`world.ts:157-165`). */
export function worldLines(w: WorldSource, file: string, text: string, texts?: typeof MECHANIC_TEXTS): WorldTextLine[];
/** Round 7 (m1; private): the module half of the walk, each MECHANIC_TEXTS walker over `w.mods[id]` with
 *  `placePaths(placesOf(w))`. `worldLines` appends its texts as lines; `lintWorld` groups their IDs per module into
 *  `WorldLintInput.moduleLines`. One walk, two consumers, so the gate and the en checks can never see different texts. */
function moduleTextsOf(w: WorldSource, texts: typeof MECHANIC_TEXTS): ReadonlyArray<{ module: MechanicId; text: ModuleText }>;
function placePaths(p: Places): PlacePaths;              // from `placesOf`'s room / spot / lock paths (`world.ts:246-271`)
// client/src/geom/cover.ts (GM3c, round 7 m1: moved from `world.ts:48`, which then imports it, as it imports
// `HOTSPOT_SAFE_FRAME` at `world.ts:11`; behaviour-identical; tree-shaken from every chunk, only build code reads it)
/** `world/hotspot-small`: 44 CSS px at a 0.296 scale (320 x 568), in source px; `world/device-parts-frame` (GM8i)
 *  imports the same constant. */
export const HOTSPOT_MIN_SOURCE_PX = 150;
```

  - **What each consumer gains, with no edit of its file:** a module text without an en entry is `loc/missing-en`, its
    en entry is no `loc/orphan-en`, it ships in the chapter's en table (`story.ts:319` -> `:740`), a wrong chapter prefix
    is `id/chapter-prefix`, a paid world's module texts are paid needles, a free world's are public texts in scan-dist,
    and `--sync-locales` appends their en stubs. Line IDs: a module text decodes through `DecodeCtx.text` at its source
    path (§3.2 `OwnedAt.path`), so a missing ID is `id/missing` at that line. **`--fix-ids` (round 7, critique_engine_r6
    m2, restated):** it walks the raw JSON generically and owns a text only under an `items`, `docs`, `puzzles` or
    `sections` entry, whose id becomes the knot part (`client/scripts/story/fix.ts:208`, `:262-263`). So it fills every
    module text that sits under an item, a section's room or hotspot (`use`'s `uses.<i>.say` and both `refuse`s,
    per-player's labels), and it reports a **world-place** text (`combine`'s top-level `recipes.<i>.say`) in `skipped`
    with "the text is under no item, doc, puzzle or section, so the ID would have no knot part" (`fix.ts:241-244`): the
    author writes that ID by hand (`<chapter>.<knot part>.<suffix>`, valid by `docs/STAGING-DSL.md:172`), and
    `id/missing` reports it until then. Pinned in GM5 (`combine: --fix-ids skips a recipe's say and names why`). No
    owner rule is added to `fix.ts`: a per-module rule there is an edit of the story tool per mechanic (§2's goal), and
    a hand-written ID costs the author one line.
  - **The modules of this design:** `use` (GM3: hotspot `uses.<i>.say`, item and room `refuse`, all `toast`, reach
    []), `combine` (GM5: `recipes.<i>.say`, `toast`); `core` (the kernel walk is `worldLines`' own), `visual`, `view`,
    `flags`, `devices`, `carry`: `null`; `labels` (per-player GM6d2: `at.room(r) + '.labels.<i>.text'`, `read`, the
    reach per-player.md §6.2 defines).
  - **Why `index.ts` and not a new registry file (a change to R-E25's shape):** every module lane already holds
    `client/scripts/story/mechanics/index.ts` for its `MECHANIC_LINTS` line (§12 holder table), so the texts line costs
    no lock path in eight lanes (GM3, GM3b, GM4, GM5, GM5f, GM8i, GM9p, per-player GM6d2; GM3 and GM3b are at 16
    already); `texts.ts` holds only the types, the kernel table and the gate, and only GM3c edits it.
  - **Bytes:** 0 runtime bytes (build only; `DecodeCtx.text` is decode.ts's existing decoder, exported).
  - **Rejected:** (a) each text-bearing module lane edits `world.ts` and per-player's `values.ts` (a fork of the story
    tool per mechanic, against §2's goal); (b) a `texts` member on the runtime `MechanicData` (~5 lines per module in
    the engine chunk, ~0.02 KB br each, for a build-only need); (c) field-pattern rules ("`*.say` under `uses`"): an
    unlisted field passes, "unknown = allowed" by construction; (d) tsc exhaustiveness alone, without
    `world/text-unwalked`: a module may declare `null` and still hold a text.

### 3.3 Run sites (today's importers)

| Runs in | Members | The engine importer that needs it |
|---|---|---|
| engine | every module's `decode`, `encode` | chapter load: `decodeWorldPublic` at `client/src/story/chapters.ts:138` |
| engine | reconcile steps 0-3: `renamed`, then every `normalize`; `fired` lookups via the data registry; every section `unproved` | resume, `resume.ts:76`; `resume()` stays synchronous (`resume.ts:107`, called at `game.ts:918`) |
| engine | the kernel projection | knot entry, `yields.ts:429` |
| engine | `runReduce` | linear puzzles, `yields.ts:338-346` (it imports `runReduce`, not `reduce`) |
| engine | puzzle-type data halves (`decodeParams`, `answerShape`, `initial`, `start` via `workFits`, `check`, `goal`, `presentation`, `commit`, `demo`; round 4) | world decode at load; `createPuzzleSession` (`yields.ts:579`); yields' full-commit post and demo runner (GM8h) |
| chunk | every rules half, the trigger runner, the condition evaluator, `visualsOf`, successors, `sectionKey`, searches, `resetSection`, `admitSection`, the writer | the explore controller, root of `import()` at `yields.ts:68` |
| chunk (type UI) | puzzle play halves | each `puzzles/ui/<Type>.svelte`, loaded by `PUZZLE_UI` |
| chunk (cue stage, its own lazy family) | `CUE_MOTIONS`, `UI_MOTIONS`, presets, the player, `CueStage.svelte` | `app/yields.ts`'s `import()` of `cues/stage/index.ts` (beside the explore and puzzle-host imports, `yields.ts:64-77`); the stage mounts in `App.svelte` |
| chunk (in both the explore-ui and the puzzle-host family, round 3 m11) | `cues/root.ts`: the root action `cueRoot` and the `layerIn` / `layerOut` transitions (their keyframes are data in the pure `cues/visible.ts`) | static imports from `ui/explore/ExploreView.svelte` and `ui/puzzles/PuzzleHost.svelte` only (rule `rules-lazy`); a module two families import statically is in each root's closure and counted in both rows (`budget.ts:572-581`) |
| build only | lints, solvers, `validateSolution`, `countSolutions`, `solve`, `domainFits`, the carry proof, P2 | `client/scripts/story/**`; an arch rule fails a `client/src` import of `client/scripts` (exists: `import-outside-src`) |

### 3.4 Reconcile step 4 at the first entry (R15)

1. `reconcile` keeps steps 0-3 and returns `reset: null` always; `unproved` = every section of the world, the current one
   included (today `reconcile.ts:309` excludes it and `:305-308` searches at load).
2. `admit` (`controller.ts:312-318`): with `pendingStory` empty it calls `admitSection` (unchanged, `reconcile.ts:141-153`,
   now in `mechanics/rules/search.ts`); a resume into a room takes `enterSection`'s resume path
   (`reduce.ts:331-333`), so the searched state is the saved one.
3. **The event return** (the hole): when `pendingStory` is non-empty and the section is `unproved`, `admit` runs
   `admitEvent(w, s, section)`: `inSectionReach` on `s` itself; `yes` -> `event-returned` as today and the section leaves
   `unproved`; `no` / `cap` -> `resetSection` + entry, with the `reset` effect. The story head is dropped by
   `resetSection` (it clears `pendingStory`, `reconcile.ts:22-24`), so the knot does not re-run on a reset state.
4. The toast: `yields.ts:313-315` (the effect) already shows it; `restore`'s branch (`yields.ts:827-829`) receives
   `reset: null` from then on and stays, so `game.ts:925` needs no edit.
5. Cost: one search of <= 5,000 states, 50-58 ms quiet (MEASURED, F4 §4), at the first entry after a version change
   instead of at load. The first line after a resume is unchanged.

### 3.5 The arch rule and the byte ledger (R1)

- **Rule `rules-lazy`** (a new `RuleId`, group `lazy`, `arch.test.ts:9-35`, `:46-72`): a value import of
  `mechanics/rules/**`, `puzzles/play/**`, `cues/stage/**` or `cues/root.ts` is allowed only from inside its own path
  and from its listed importers: `explore/controller.ts` (rules); `puzzles/ui/**` (play); `ui/explore/**`,
  `ui/puzzles/**`, `puzzles/ui/**` (`cues/root.ts`); none for `cues/stage/**`, which `app/yields.ts` reaches by
  `import()` only (as the other families, `yields.ts:64-77`). `import type` is allowed anywhere. `mechanics/**`,
  `puzzles/play/**` and `cues/{types,bus,visible}.ts` join `isPureWorld` (`arch.test.ts:130-137`); none of them names a
  `svelte` type, since `pure-world` reports a `svelte` import even type-only (`arch.test.ts:622-623`), so the slot types
  `CueStageSlot` / `CueStageProps` live in `ui/state.svelte.ts` (m11). `cues/stage/` joins the lazy dirs
  (`arch.test.ts:144`, `budget.ts:190`); `cues/root.ts` does not: two lazy families import it statically, and the
  `lazy-ui` rule (`arch.test.ts:615-620`) would report both imports (m11).
- **Rule `waapi`** (new, group `scene`; per-player R-E11, R-E18): a `.animate(` call is allowed only in
  `cues/stage/player.ts`, `ui/value-motion.ts` (per-player GM6c3) and `ui/toast-motion.ts` (per-player GM6t, round 4),
  so every DOM motion has one owner. Svelte's own `in:` / `out:` transitions are directives, not calls, and stay outside
  the rule (R-E17: a later tightening keeps them allowed). Red fixture: `['ui/explore/Ribbon.svelte', "el.animate([{opacity:
  0}, {opacity: 1}], 200);"]`; allow fixtures: one per allowed file, `ui/toast-motion.ts` included.
- **Red fixtures** (the named mutations): `['story/chapters.ts', "import { MECHANIC_RULES } from '../mechanics/rules/index.ts';"]`,
  `['puzzles/session.ts', "import { PATH_PLAY } from './play/path.ts';"]`, `['app/yields.ts', "import { CUE_MOTIONS } from '../cues/stage/motions.ts';"]`,
  `['app/yields.ts', "import { cueRoot } from '../cues/root.ts';"]` (round 3).
  **Allow fixtures:** the controller's import of the rules index; `ui/explore/ExploreView.svelte` and
  `ui/puzzles/PuzzleHost.svelte` importing `cues/root.ts`; `app/yields.ts` with `import('../cues/stage/index.ts')`; a
  type-only import from `app/yields.ts`.
- **Why a rule and not the row:** a non-root module shared with the engine is subtracted and counted silently in the
  engine (`budget.ts:578-580`). The rule catches it in `test`, the row only measures.
- **Ledger** (engine, KB br; ARITHMETIC estimates; each lane's build log replaces its line with MEASURED):

| Lane | engine | explore-ui (4.9 MEASURED) | cue stage (new family) | note |
|---|---|---|---|---|
| GM1a | -2.3 | +2.3 -> 7.2 | - | `reduce.ts:264-659` + `reconcile.ts:19-153` move out (~530 lines). Changed by RULINGS 162, 165 (as of `9a83251`; docs lane `docs-errata-10`, group A): MEASURED at GM1a's merge (`ef8b4dc`, exact bytes main -> HEAD): engine -1,908 B, explore-ui 4,912 -> 7,205 B (+2,293), entry -60 B, first line -1,968 B, all JS +334 B; these replace the -2.3 / +2.3 estimates ([§11.1](11-budgets-and-validation.md#111-the-shared-ledgers-reconcile-r1-r2-rulings-143-qo10-152-r4-153-155-design-shots-i-13)) |
| GM1b | +0.3 | +0.25 -> 7.45 | - | registries, `data/core`, writer, derived key; round 4: the `arrived` hook calls (~8 lines, chunk). Changed by RULINGS 171 (as of `9a83251`; docs lane `docs-errata-10`, group A): MEASURED at GM1b's merge (`03a00bc`, exact bytes main -> HEAD): engine -38 B, explore-ui 7,205 -> 8,395 B (+1,190 against +0.25), entry -33 B, first line -71 B, all JS +1,119 B; these replace the +0.3 / +0.25 estimates; the explore-ui row binds only at the 14.0 split line (the STOP rules below; RULINGS 171) ([§11.1](11-budgets-and-validation.md#111-the-shared-ledgers-reconcile-r1-r2-rulings-143-qo10-152-r4-153-155-design-shots-i-13)) |
| GM1c | +0.13 | 0 | - | `PuzzleInstance` with `start` and `commit` (round 4, ~6 lines); switch sites removed. Changed by RULINGS 178 (as of `9b4fd25`; docs lane `docs-errata-11`, group A): MEASURED at GM1c's merge (`8c2fa03`, exact bytes main -> HEAD): engine +16 B, entry -60 B, first line -44 B, puzzle-type 1,639 -> 1,618 B, all JS -77 B; these replace the +0.13 estimate ([§11.1](11-budgets-and-validation.md#111-the-shared-ledgers-reconcile-r1-r2-rulings-143-qo10-152-r4-153-155-design-shots-i-13)) |
| GM1d | 0 | 0 | - | build-only |
| GM2a | +0.33 (reconcile r1: was +0.3; design-shots I-1's `cam` reader, ~6 lines x 4.3 B = 25.8 B, +0.03) | 0 | - | format chain, upgrader, `at`; reconcile r1: `StagingSnapshot.cam` (§5.2). Changed by RULINGS 181 (as of `9b4fd25`; docs lane `docs-errata-11`, group A): MEASURED at GM2a's merge (`9b4fd25`, exact bytes main -> HEAD): engine +333 B, entry +7 B, first line +340 B, explore-ui 8,392 -> 8,395 B, all JS +363 B; these replace the +0.33 estimate ([§11.1](11-budgets-and-validation.md#111-the-shared-ledgers-reconcile-r1-r2-rulings-143-qo10-152-r4-153-155-design-shots-i-13)) |
| GM2b | +0.1 | 0 | - | step 0 |
| GM3c | +0.2 | +0.3 -> 7.75 | - | condition decoder / evaluator; the composed decoder; round 6: the text walk, `texts.ts` and `world/text-unwalked` are build-only (0), `DecodeCtx.text` passes decode.ts's existing decoder |
| GM3m | +0.16 (reconcile r1: design-shots I-7's `FRAME_OPEN_MS`, one exported constant in `cues/types.ts` that the frame's entrance row and SH7's cover call read, ~1 line, 4.3 B, under the rounding; round 7: was +0.2) | 0 | +2.75 (round 7: was +2.69) | the bus with the hold (~35 lines, 0.15) and the two constants the engine closure keeps, `MIN_VISIBLE_MS` (read by per-player's `ui/value-motion.ts`) and `CUE_TRIGGERS` (read by `cues/root.ts`, so kept wherever `cues/types.ts` lands) (engine). **Round 7 correction:** rounds 4-6 booked the name tuples' key lines (~9 lines, +0.04) on the engine, but no engine module reads `PUZZLE_CUES`, `UI_STATE_CUES` or `CORE_CONTROLS` at run time (yields emits string literals typed by `PuzzleCue`; the stage reads `CUE_MOTIONS`; only the gates' tests read the tuples), so a tree-shaking build drops them (CLAIM, Rollup-style dead-export removal; verify at GM3s's build, the first that imports `cues/**` from yields: its engine delta against 0.16 + 0.15 = 0.31; a delta near 0.35 means a tuple reached the engine and the ledger takes the 0.04 back), and `cues/visible.ts` is reached only from `cues/root.ts` (lazy) and the gates' tests. Presets, the ~111-entry table with the `removed` rows, round 4's `waiting` / `waited` / `demo` / `hint-renewing`, round 5's `offline` / `rate-limited`, round 6's `ready`, round 7's `ladder` / `hint-failed` / `load-failed`, `MotionSpec.with`, the per-panel wait holds and `CUE_TARGET_ATTRS` (~14 lines, +0.06), `UI_MOTIONS`, player with the wait hold (chunk) |
| GM3w | +0.03 (round 12: was +0.02; `Yields.ahead`'s no-op method ~1 line and `present`'s call in its `yield` case ~1, the interface member 0 bytes: 6 lines x 4.3 B = 25.8 B in all; round 8: was +0.01) | 0 | - | forwarders replace 14 literals (moved, not added); `coversStage` at two App sites; two CSS rules; round 4: `apply`'s `started` callback (`game.ts`, ~3 lines); round 8 (W1): `retrying: false` in `openPuzzle`'s frame literal (1 line; the field's type and doc are 0 bytes, the two `disabled` bindings ride the puzzle-host chunk and the entry): ~4 engine lines x 4.3 B = 17.2 B (round 9: critique_engine_r8's count, round 7's ~3 and round 8's one literal; round 8 wrote ~5 and 21.5 B; both round to +0.02) |
| GM3s | +0.19 (reconcile r1: was +0.18; RULINGS 152 Q14 (a)'s `stale` term inside the predicate's line, ~0.5 line, and the scene role's seam (design-shots I-4): `YieldsHost.sceneCues?` is a type, 0 B, its one call in `createYields` ~1 line: ~1.5 lines x 4.3 B = 6.5 B, with round 14's 4.3 B 10.8 B, +0.01; round 14: +0.004 under the rounding, m3's revive test inside `held`, `at !== 'no-load' \|\| h.scene.stats().reviving`, ~1 line x 4.3 B; round 13: unchanged, `held`'s `'no-load'` is an expression inside its two emission lines, 0 lines, as round 11 books the hotspots' conditional attribute; round 12: was +0.17; `held` ~4 lines replacing the room batch's two inline hold emissions, +2 net, the five call sites change their callee, 0, `ahead`'s body `prefetch()`, 0: 8.6 B, +0.01; round 11: was +0.15; the explore-import hold ~2 lines, `prefetch()` taken from `lineShown`'s body ~1 and its calls at `restore` and after a section's first room ~2: ~5 lines x 4.3 B = 21.5 B, +0.02) | +0.2 -> 7.95 (round 9: +0.01 for `layerOut`'s `frame` option and `frameOut`, in `cues/root.ts`'s closure, so puzzle-host carries it too, §1 `budget.ts:572-581`; the running totals below this row stay as written and the total row adds the 0.01) | +0.32 -> 3.07 (round 9: +0.08 -> 3.15: CueStage's capture / `tick()` / run, the resolver's outroing-root skip and the hold's notice step, the ghost clone, ~5 lines; GM3m's two-phase player, `resolveAt` on seven rows, `PRESET_SITE` and the leave watch, ~13 lines; 18 lines x 4.3 B = 77 B) | slot, loader, effect-to-cue map, round 4's move cue at the batch start and the wait cues, round 5's hold of a moving dispatch's cues until `started` (m9, ~2 lines, inside the line) (engine); `cues/root.ts` with the nested-root check and both transitions (explore-ui; puzzle-host from GM3p); stage, ghosts, round 7's resolver rules (the six new targets, a null-`el` control by `data-cue`, `box` falling back to the cue's panel; ~4 lines, +0.02) (stage); App's `.host-failed` markers (entry, ~1 line, inside the +0.05 below; round 8: the Retry's `disabled` is GM3w's) |
| GM3 | +0.2 | +0.8 -> 8.75 | 0 | `use` decoder / rules; kernel effect fields |
| GM3u | +0.3 | +1.2 -> 9.95 | 0 | ribbon, catcher, selection; round 4: `i18n/mechanics.ts` (~7 keys x 2 languages, ~630 B raw, imported by yields, so engine-side; ARITHMETIC at a CLAIM br ratio of ~2.5); round 9: the diff drops the `puzzle` kind and GM3s's `lock` mapping (-1 line, -4.3 B, under the rounding) |
| GM3p | +0.31 (reconcile r2: was +0.29; RC-W5's `frameShown` edge, the call in `appear(o)` ~1 line, `null` in `hideFrame` ~1 and in the drop of a shown frame ~1, its `ShownFrame` literal ~1: ~4 lines x 4.3 B = 17.2 B, +0.02; round 12: was +0.30; the close-up hold's two emissions are `held`'s now, GM3s, -2 lines, -8.6 B, -0.01; the chunk write's reorder and the await map change no shipped line, 0; round 11: was +0.27; `holdLoad` ~5 lines, its frame-write call ~1, `Open.loading` in the type and the literal ~1, the close-up hold's two emissions ~2, the round-7 / round-9 `puzzle` hold emissions at `onretry`, the chunk write and `endFrame` becoming its calls -1: ~8 lines x 4.3 B = 34 B, +0.03; round 10: was +0.24, W1's `appear(o)` with `shownFrame()` and its `busy` clause ~6 lines, its second call site ~1, the `appeared: false` literal ~0.5, the round-9 emission line replaced by the first call -1, the shown-frame test's `o.appeared` inside its line: ~7.5 lines x 4.3 B = 32 B, +0.03; round 9: was +0.20; round 8: was +0.17) | 0 (puzzle-host +0.2: `cues/root.ts` in its closure; round 7 +0.03: the cue-target markers, the load-failed wrapper; round 8: Retry's `disabled` is GM3w's, the same attribute; round 9 +0.02: the frame wrapper, the `{#key frame.id}` root and the moved frame styles ~3 lines, plus `cues/root.ts`'s `frameOut` +0.01 shared with explore-ui) | 0 | puzzle cues in yields (round 5: `offline` in `attempted`, `rate-limited` per `countdown` tick, ~3 lines, +0.01; round 6: `ready` at the countdown's zero and in the no-outcome branch with its `line: 'idle'`, ~3 lines, +0.01; round 7 (W1, m3): `setLadder` with its `busy` edges (~6 lines), the wallet compare (~1), `loadPuzzleUis`' `waited` and `opened` / `load-failed` (~2), Retry's wait and App-block control cue (~2), the `busy` reply's own case (~1): ~12 lines x 4.3 B = 52 B, +0.05; round 8 (W1, m1, R-E28): `post(o)` out of `ontry` (~3), `dropPuzzle(cue)` with the shown-frame test and its emit (~2), `onEnd`'s cue argument (~1), the screenless `panel-open` (~1); `retrying` replaces round 7's `busy` writes and the alert rules change expressions only (0): ~7 lines x 4.3 B = 30 B, +0.03; round 9 (critique_engine_r8 m1, m2, m4): `hideFrame` (~5), `unshowCloseup` taken out of `onEnd`'s `closed` branch so both call it (~2 net), the X8 call (~1), `endFrame` holding round 8's end emission plus the Retry `waited` (~2), the screenless test dropped from the `panel-open` emission (~0), `disposePuzzle: () => dropPuzzle('closed')` (~0, replaces the bare reference): ~10 lines x 4.3 B = 43 B, +0.04); `cueRoot` on the host |
| GM3b | +0.23 (reconcile r2: `roomFor` returns the room's state commands from `roomBatch`'s own builder, one more line than `propsFor`, 4.3 B, under the rounding, RC-W2; reconcile r1: was +0.2; design-shots I-11's `Yields.propsFor(bg)`, ~6 lines x 4.3 B = 25.8 B, +0.03; round 12: the state batch's `held` call with its anchor box, ~1 line, 4.3 B, under the rounding) | +0.45 -> 10.40 (round 13: +0.02, W2's release of `state:<m>` with `room:<m>` and the close-up's release of the other rooms' `state:` ~2 lines, m1's `stateHold` ~3 lines: ~5 lines x 4.3 B = 21.5 B; round 12: +0.03, `roomImages`, the `state:<room>` holder and its release branches, `anchorBox`, ~8 lines; the running totals below this row stay as written and the total row adds the 0.05) | 0 | `visual` decoder / `visualsOf`; per-dispatch diff; round 12: the state preload (chunk) |
| GM4g | 0 | 0 | - | build-only |
| GM4 / GM4u | +0.1 | +0.7 -> 11.05 | 0 | `view`, the walk rule, the leave control |
| GM5 / GM5f | +0.2 | +0.6 / +0.4 -> 12.05 | 0 | recipes, flags, `fl_` |
| GM7r / GM7p / GM7g | +0.31 (round 8: was +0.32) | 0 | 0 | reach post, data halves, `mech.content_updated` in the mechanics table (round 4); round 5 (W3): `Open.reach`, `postReach`, the countdown-end post, `frame.awaiting`, the clear on a move away (~20 lines, +0.09, engine); round 8 (R-E28): `postReach` sets the answer and calls GM3p's `post(o)` instead of repeating its `busy` / `checking` / `attempt()` lines (~-2 lines, -8.6 B, -0.01); `reachEdge` (~12 lines) and the play halves ride each type chunk; PuzzleHost's reach `canTry` (puzzle-host +0.01) |
| GM8i / GM8h / GM8a / GM8b | +0.72 (reconcile r2: GM8h's device-view case of `frameShown` costs 0 lines, since GM3p's report reads `coversStage`, which GM8h already narrows, RC-W5; round 9: was +0.73; the zoom-out's hide becomes a `hideFrame(o)` call, -2 lines, and the `panel-open` narrowing to overlay frames is dropped, -1 line: -12.9 B) | +0.3 -> 12.35 | 0 | devices module (`arrived`, `normalize` of `work`), four data halves (`demo` on `sequence`), `failLocal` and its yields route, round 4's full-commit post / re-post / restart, the demo runner and the hide-at-zoom-out (~25 lines, +0.11) (engine); round 5: `instanceOf`'s `work` branch moved here from GM1c (m1) and the demo stop on `onreach` (~4 lines, +0.02); the in-room device slot and ladder sheet (explore-ui +0.1); puzzle-host +0.52 (the `room` and `ladder` places, the bar's type-chunk Retry, round 5's bar Try +0.02, round 6's three-row bar CSS, ~6 lines, +0.03, round 7's 44 px button and 18 px line rules and the bar's cue markers, ~4 lines, +0.02) |
| GM8d | 0 | 0 | 0 | story, locale, catalog and e2e only |
| GM9p / GM9r | +0.2 | +0.1 -> 12.45 | 0 | builder, every-resume re-arm, chapter-start cues |
| **total** | **+1.71** (reconcile r2: ARITHMETIC, the added lines in table order with GM3p at 0.31: 3.99 + 0.02 = 4.01, and 4.01 - 2.3 = 1.71; unrounded 3.986 + 0.0172 (GM3p) + 0.0043 (GM3b) = 4.0075, so 1.7075; was **+1.69**; reconcile r1: ARITHMETIC, the added lines in table order: 0.3 + 0.13 + 0.33 + 0.1 + 0.2 + 0.16 + 0.03 + 0.19 + 0.2 + 0.3 + 0.29 + 0.23 + 0.1 + 0.2 + 0.31 + 0.72 + 0.2 = 3.99, and 3.99 - 2.3 = 1.69; unrounded 3.924 + 0.0258 + 0.0258 + 0.0065 + 0.0043 = 3.986, so 1.686; was **+1.62**; round 14: unchanged at two decimals, GM3s's +0.004, ARITHMETIC: 3.92 + 0.004 - 2.3 = 1.624; round 13: unchanged, no engine row moves, ARITHMETIC: 3.92 - 2.3 = 1.62; round 12: 3.92 added - 2.3 moved out = 1.62; ARITHMETIC, the added lines in table order: 0.3 + 0.13 + 0.3 + 0.1 + 0.2 + 0.16 + 0.03 + 0.18 + 0.2 + 0.3 + 0.29 + 0.2 + 0.1 + 0.2 + 0.31 + 0.72 + 0.2 = 3.92; GM3b's +1 line, 4.3 B, sits under its row's rounding and is booked in the +0.01 of the R1 row; round 11 read 3.91 -> 1.61, round 10 3.86 -> 1.56, round 9 3.83 -> 1.53, round 8 3.80 -> 1.50; 0.12 past the 1.5 target: orchestrator Q12 asks for the target ruling, 1.7 still recommended) | **12.51, ~12.5 / 16.0** (round 13: +0.02, GM3b's keep-set release and `stateHold`; round 12: +0.03, GM3b's state preload and `anchorBox`; round 9: +0.01, GM3s's `frameOut`; round 10: the `data-cue-hit` / `data-cue-ribbon` attributes and GM8i's arrival guard, ~2 lines, under the rounding; round 11: the hotspots' conditional `data-cue-hit` changes an expression, 0) | **3.28, ~3.3 / 6.0** (round 11: +0.06, GM3m's `checking` loop (`MotionSpec.until`, `CHECKING_ENDS`) ~5 lines, the `{ box }` rule with the edge skip and its played-nothing count ~2, `holdEnd`'s ghost on a mid-motion leave ~0 (it replaces round 10's watch skip), the `inventory` target and its two rows ~1; GM3s's `centre` landing ~2, the `inventory` landing ~1, the DOM-branch count ~1, the played-key panel suffix ~1: 13 lines x 4.3 B = 56 B; round 9: +0.08; round 10: +0.07, GM3m's fallback counter ~3 lines, `holdEnd`'s fill and watch skip ~2, the hit-area ghost ~2, `Resolved` ~1, three `holdEnd` entries ~1; GM3s's `ribbon` landing and `edge` box ~3, `data-cue-fallbacks` ~1, the `.cue-hit` outline CSS ~3: 16 lines x 4.3 B = 69 B) | MR1 adds its scene mapping (~1.0 estimate) to explore-ui (reconcile r1: MR1 is SH10, whose scene motions live in the shots' lazy `scene/motion/` chunk, its "scene-motions 1.0" of ~6.0, [shots §10 Budgets and validation](../shots/10-budgets-and-validation.md#10-budgets-and-validation-summary), not in explore-ui; so explore-ui stays ~12.51 + per-player's 0.04, §11.1; reconcile r2, RC-m5: SH10's `SceneMotionId` per key and control default sits in `cues/stage/motions.ts`, which ships in the cue-stage chunk, so that chunk reads ~3.78 with SH10, +0.5 CLAIM, booked in §11.1) |

  - **Reconcile r1: the two bullets below are superseded by §11.1** (RULINGS 152 R4): the shared ledgers are re-based
    on main's MEASURED rows at `a5f887b` (`m3s-memory-half-paid/merge/build.log:91-100`: entry 38.7, engine 215.0,
    first line 258.8, all JS 271.6) and LFL's MEASURED rows (`lfl-first-line/test_r1.md:54-58`). The first line
    projects **270.14 / 270.0 (FAIL)** without LFL and **265.35** with it; the entry **39.20** without LFL and **39.51**
    with it, 0.012 KB under L1 / L2's return line (§15 item 15). The bullets stay as the record of rounds 10-14.
  - First-line headroom (round 10, re-based; found while resolving): the base is design-shots' M-build after M3c,
    **257.9** / 270.0 (MEASURED, `design/shots/research_S4-engine-fit.md:171`; this file's 257.2 is LFU3's, before
    M3c), and the first line loads the entry, so both tracks' entry growth counts too (GM3s +0.05, per-player +0.35;
    rounds 2-9 summed only the engine growth). So 257.9 + 1.62 + 0.05 + 3.00 + 0.35 = 262.92 and the headroom is
    270 - 262.92 = **7.08 KB** before the shot design (round 12; round 11 read 262.91 and 7.09, round 10 262.86 and 7.14) (ARITHMETIC; per-player's +3.00 is its round-10 figure as read,
    [per-player §12.1 Requests from this file](../per-player/12-interface-requests.md#121-requests-from-this-file-status-after-enginemd-round-9-as-read-2026-11-03-reconcile-revision-1-round-14-as-read-2026-11-09-reconcile-revision-2-enginemds-reconcile-revision-1-as-read-2026-11-09-reconcile-revision-3-enginemds-reconcile-revision-2-as-read-2026-11-09)); with design-shots' own +6.15 + 0.1 at its approved rev. 7 ([shots §10 Budgets and validation](../shots/10-budgets-and-validation.md#10-budgets-and-validation-summary),
    RULINGS 143; round 10 read rev. 6's +6.05 + 0.1 at [shots §10 Budgets and validation](../shots/10-budgets-and-validation.md#10-budgets-and-validation-summary)) the row reads **269.17** / 270.0 (round 12;
    round 11: 269.16; the shots' own sum 269.08 used this file's round-9 +1.53, [shots §10 Budgets and validation](../shots/10-budgets-and-validation.md#10-budgets-and-validation-summary), and 269.08 + 0.09 = 269.17;
    round 10: 269.01). Round 9's figure on the old base and without the entry terms was 270 - 257.2 - 1.53 - 3.00 = 8.27
    (round 8 read 8.39, round 7 8.48, round 6 8.62, round 5 8.68). The rounds before design-shots compared the
    headroom with MD2 + MA1's 3-10 KB (animation synthesis §4.5, CLAIM; those lanes are re-set by `design-shots`,
    RULINGS 132); design-shots' own ledger now books 6.25 against it (rev. 7), leaving **0.83 KB** (peak **0.63** between its SH6
    and SH7: its peak is its sum + 0.2, [shots §10 Budgets and validation](../shots/10-budgets-and-validation.md#10-budgets-and-validation-summary); ARITHMETIC; round 11 read 0.84 and 0.64, round 10 0.99 and 0.79): one first-line
    ledger runs across this file, per-player and the shots, quoted base -> HEAD at every lane's cut with a STOP past
    270.0 (RULINGS 143 QO10, `RULINGS.md:3024-3026`), and the row's planned relief is LFL, the first-line lever lane
    (RULINGS 142, `RULINGS.md:3008-3014`; LEL's entry levers L1 / L2 raise this row and are shelved).
  - Entry (39.4 / 40.0 KB br after M3c, RULINGS 127): GM3s adds the `vm.cueStage` slot and one `{#if}` block in
    `App.svelte`, ~10 lines ~ +0.05 KB br (ARITHMETIC; round 7: the `.host-failed` block's two markers and its Retry's
    `disabled`, ~1 line, so 11 lines x 4.3 B = 47 B, still +0.05; round 8: that `disabled`, now `={frame.retrying}`,
    moves to GM3w, so the two lanes together still add 11 lines); GM3w's prop restructuring and `coversStage` are neutral; no
    string of this design enters the main tables (round 4: `i18n/mechanics.ts`, GM3u). With per-player's round-4 entry
    growth (GM6s2 ~0.09 + GM6t ~0.26 = 0.35, per-player.md §0 W-chunk) the two tracks reach
    39.4 + 0.05 + 0.35 = **39.80 / 40.0 KB br** (ARITHMETIC), 0.20 KB left; the carried entry lever
    (carry.md:1391-1393) goes first in any lane that would cross 40.0.
  - **Svelte's transition runtime (round 4; per-player critique r3 W1 and its open question).** This design's only
    `in:` / `out:` directives sit on the two lazy family roots (`ExploreView.svelte`, `PuzzleHost.svelte`, both in
    `LAZY_COMPONENTS`, `arch.test.ts:892-901`); no entry component gets one. Whether Rolldown places
    `svelte/internal/client`'s `transitions.js` (~510 source lines, CLAIM) in the lazy chunks or, through the barrel the
    entry also imports, in the entry, is not known without a build (verify; no measurement exists). GM3s is the first
    build with a directive, so its entry row MEASURED before / after settles it: a delta within +0.05 + 0.5 passes the
    STOP rule (the entry row's 40.0 gate still binds: a lane that would cross it lands the carried entry lever first,
    which frees >= ~0.55 KB br, per-player R-E21, ARITHMETIC there); a larger one is a STOP item at GM3s, with the
    fallback already named: the layer entrance and exit become cue-player
    motions on the layer root and on a ghost of it (the GM3s ghost mechanism, §8.3), and no Svelte transition directive
    remains in `client/src`. Per-player GM6t's toasts use `Element.animate` (R-E18), so they do not depend on it.
  - **STOP rules:** a lane whose MEASURED engine delta exceeds its line by > 0.5 KB br stops at the cut; the first
    lane whose MEASURED explore-ui row passes 14.0 KB br carries a split of the rules half from the room UI in its cut;
    the first lane whose MEASURED cue-stage row passes 5.0 KB br carries a presets split.

### 3.6 Worked example: adding `rotate` later (a statue that faces N ways; facing east opens a door)

| Step | What the author of `rotate` ships | Where |
|---|---|---|
| 1 | Data half: `owns: { hotspot: ['rotate'], atoms: ['facing'], facts: ['facing'] }`; decode `{ "rotate": { "positions": 4, "start": 0 } }` (positions 2..8, start < positions); `normalize` clamps a saved position >= positions to `start`; `slice: { key: 'rotations', initial: {}, read, normalize }` | `client/src/mechanics/data/rotate.ts`, one line in `MECHANIC_DATA` |
| 2 | Save: `SAVE_FORMAT` 2 -> 3; `SAVE_FIELDS[3]` = format 2 + `rotations`; upgrader 2 -> 3 inserts `{}`; golden format-2 body | `story/save-codec.ts` |
| 3 | Rules half: `tap(w, s, at, out)` claims a tap on a hotspot carrying `rotate` (core's `tap` hands it over, §3.2) and writes the slice through the writer, which appends `fact facing` removed (old) / added (new) with `cause.verb = 'tap'`; `actions` adds nothing (core already lists one `tap` per hotspot, so the search sees the edge once); `reads` = the `facing` atoms its gating conditions name; `holds` evaluates `{ facing: { at, is } }`; `cues: []` (the fact cues suffice); `visuals`: none (the statue's picture comes from `visual` states keyed by `facing`) | `client/src/mechanics/rules/rotate.ts`, one line in `MECHANIC_RULES` |
| 4 | Lints: positions range, the rotating hotspot and every `facing` reader in one section for gating (X15), every `is` state names a declared state; its codes (`world/rotate-range`, ...) in the file's own `codes` table, never in `LINT_CODES` (§3.2, round 4); its texts (round 6): `rotate` owns none, so `rotate: null` in `MECHANIC_TEXTS` (tsc requires the line); a module with texts writes a `TextWalker` beside its lint with each text's source path, role and reach, and `world/text-unwalked` refuses a text it forgets | `client/scripts/story/mechanics/rotate.ts`, one line in `MECHANIC_LINTS` and one in `MECHANIC_TEXTS` (`client/scripts/story/mechanics/index.ts`) |
| 5 | Motions: `fact:facing:added` and `fact:facing:removed` entries in `CUE_MOTIONS` (tsc refuses the build without them; the gate refuses a no-op): overlay `spin-glint` at the hotspot box; scene `prop-rotate` once MR1 exists | `client/src/cues/stage/motions.ts` |
| 6 | UI: none (a tap is the action). A module with controls declares them in its data half (`controls: [{ name: 'dial-turn', on: 'click', haptic: 'light', motion: 'wobble' }] as const`, §8.3); `ControlCue` derives from the registries, so `cues/types.ts` is not edited; each control plays `UI_MOTIONS`' default (`press`; a gesture step `pulse`) or the preset it names, so `motions.ts` is not edited for controls either, and the gate checks every resolved control motion (§8.5) | - |
| 7 | Locale: none (no new UI string; a module with world texts gets its en entries from `--sync-locales` through the walk, round 6) | - |
| 8 | Tests: the rules table (state, action) -> (state, cues); the decode round trip; a seeded lint mutation seen red; the golden successor test gains a fixture world using `rotate`. `RULES_VERSION` stays (no existing world's successors change; a bump is only for semantics that change existing worlds) | `client/src/mechanics/rotate.test.ts` |
| 9 | Server: none (rotations are public play state) | - |
| 10 | Budget: explore-ui family row (rules), engine ledger line (data half ~0.1 KB br) | build log |
| 11 | Docs: AUTHORING section, FEATURE_MAP row | docs lane |

No step edits `explore/{reduce,reconcile}.ts`, `world/{types,decode}.ts`, `app/yields.ts`, the scene,
`client/scripts/story/lint.ts`, `docs/STAGING-DSL.md` (round 4), `client/scripts/story/world.ts` or per-player's
`client/scripts/story/values.ts` (round 6: texts reach every text pass through the walk). A new **puzzle type** follows the same shape (§7.1):
a data half with `check`, `goal`, `presentation`, `wrong`, `commit`, `startShown`, `answerShape`, optional `workFits`,
`demo` and `controls` (one line in `PUZZLE_TYPES`), a play half, a UI component (one line in `PUZZLE_UI` and one in
arch's `LAZY_COMPONENTS`, `arch.test.ts:892-901`; `budget.ts` finds it by glob from GM7p), a build lint with `solve` /
`countSolutions` and its own `codes` (`client/scripts/story/puzzles/<type>.ts`, one line in `PUZZLE_LINTS`,
`client/scripts/story/puzzles/index.ts`, round 4 m5); the build's `world/answer-len`, `world/unique-solution`,
`world/view-type-site` and (round 5) `world/device-closeup` and `world/reach-solution`'s start clause apply to it with
no edit; a reach type's UI reports through `reachEdge` (§7.1) and inherits §7.5's posting rule per reply kind with no
yields edit (round 5, W3); `MAX_ANSWER_LEN` moves only with the server's (W3); a demo of it is a
story commit in the placeholder story (GM8d's pattern). Round 7 (critique_engine_r6 m4, W1): its UI marks each part
`data-cue-part="<i>"` (`puzzles: every type UI marks its parts` refuses it otherwise), so `puzzle:input`, `blocked`
and `demo` play on its parts through the existing `part` target; a module or type whose motion needs a target no row
of §8.5 "Cue targets" names adds the row to `CUE_TARGET_ATTRS` and marks its element, and the family's resolve test
fails until both exist; a lane that adds a field to `PuzzleFrameView` or `HintLadderUiView` adds its covering keys to
the state gate's `VIEW_FIELD_CUES` (or its reason to `SILENT_VIEW_FIELDS`), and the gate fails until it does.
Round 9 (critique_engine_r8 W1; RULINGS 135 (b)): a motion whose target the emitting block removes declares
`resolveAt: 'emit'` in its row (every other target is found after the block's flush, with no declaration); its cue is
emitted in the same synchronous block as the view write it describes; an element a target selects by an id
(`data-cue-item`, `data-cue-tier`, a module's own) is rendered by a keyed `{#each}` on that id; no marker goes on a
family root (`[data-cue-root]`, the element that carries the layer transitions); and a rule that removes an element
shown before a dispatch that also pushes a `room` effect is a STOP item at its cut (§8.1: a moving dispatch's cues
play at the batch's start, after their block's flush).
Round 10 (critique_engine_r9 W1, W2; RULINGS 135): a module or type element that only makes a touch target over the
art (a hit area: a `rotate` statue's button, a device's parts) carries `data-cue-hit`, so its element-site motions play
on a painted ghost; a cue whose target sits inside a view that a later write mounts is emitted by that write (the
frame's rule, `appear(o)`), and a target kind that can vanish with its family root in the emitting block declares a
landing that always exists (the `ribbon` -> `edge` rule), with its stage test derived from `CUE_MOTIONS`; the lane's
real-flush tests and e2e assert `fallbacks() === 0` / `data-cue-fallbacks` 0, so a target that resolves nowhere is a
red test in that lane.
Round 11 (critique_engine_r10 W1, m1; RULINGS 135): a module or type that adds a wait (a request, a chunk, a load
the player waits on) adds a row to §8.1 point 11's table, with its hold, its start block, every
block that ends it, and its case in `yields: every wait of the views holds a motion`, in the lane that adds it; a hit
area carries `data-cue-hit` only while it paints nothing.
Round 12 (critique_engine_r11 W1; RULINGS 135), restated in round 13 (critique_engine_r12 W1; RULINGS 148): that rule
is enforced at the request, not trusted: a request the module starts anywhere in `client/src` (a reference to a member
of a `REQUEST_PORTS` port, an `import()`, a `fetch`; however its promise is consumed, and a member passed as a value
counts) is red in `requests: every request start is a declared site` until its (file, function, member) is a
`REQUEST_SITES` row: a view row naming its point-11 rows, each with its `WAIT_CASES` case (`tsc`), or another row with
its reason; a picture it changes goes through a visual batch, and every batch goes through `held` (round 14,
critique_engine_r13 W1: the walk checks by declaration that the one reference to `YieldsHost.apply` is inside `held`,
however a module would reference it: a call, a value hand-off, a destructure, a bind), so it holds while it loads; it
starts no scene load of its own (outside `app/game.ts` and `scene/**` the walk fails `SceneController`'s `ensure`,
`apply`, `restore`, `mount`); it uses the asset transport only through a row (round 14, m1: a reference typed by
`FetchAsset` is a start); and it types every port, scene, batch or transport dependency as the interface, a `Pick` of
it or an indexed access naming one, or the alias, since a structural re-declaration of a guarded member that receives
the port whole is red ("re-typed"; a member re-declared as `Endpoints['getChapter']` takes a wrapper, as
`story/chapters.ts:158` does).
What the walk does not see (a timer or event wait, a value that flows into `any`, a DOM image) is stated in §8.1
point 11. **`rotate` adds no row:** it starts no request; its facing pictures are `visual` states, shown by GM3b's
state batch through `held` (its hold plays at the statue's anchor, the first changed anchor that draws an image), and
they are among the room's images the controller preloads under `state:<room>` and keeps while the room is in the keep
set (§6.4), so a turn to a facing not yet shown waits, under that hold, only while the preload is in flight, or after
admission refused it or an eviction ended it, until the room's next `roomShown` requests it again (round 14,
critique_engine_r13 m2).
