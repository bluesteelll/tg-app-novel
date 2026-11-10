// The world lint registry (engine plan §3.2 "Lint codes"; build only): every mechanic's lint pass the story gate runs
// over a chapter world, each with its own codes, so no lane adds to LINT_CODES (lint.ts) or the DSL's code table; and
// beside it the module text walkers (§3.2 "Module texts"). Pure, no node:*: world.ts imports it and scan-dist.ts imports
// world.ts. Its imports from lint.ts are `import type`, erased at run time, so the value graph is world.ts -> index.ts
// -> the lint files with no edge back. Neither it nor any file in this directory (the lint files, texts.ts) imports
// anything from world.ts, not even a type: lint.ts's `Finding` takes this module's codes, so the app program
// (src/story/dsl-doc.test.ts -> lint.ts) compiles every file this one reaches, and world.ts type-imports emit.ts, which
// imports node:crypto. Each module lane appends its entries.
import type { DataOf, MechanicId } from '../../../src/mechanics/contract.ts';
import type { MECHANIC_DATA } from '../../../src/mechanics/data/index.ts';
import type { AssetCatalog } from '../../../src/story/catalog.ts';
import type { KnotName, LineId, PuzzleLocalId, VarName } from '../../../src/story/staging.ts';
import type { WorldSource } from '../../../src/world/types.ts';
import type { Finding, Severity, SourceChapter } from '../lint.ts';
import { SHAPE_LINT } from '../puzzles/shape.ts';
import { CLUES_LINT } from './clues.ts';
import { CONDITIONS_LINT } from './conditions.ts';
import { CORE_LINT } from './core.ts';
import { TEXTS_LINT } from './texts.ts';
import type { TextWalker } from './texts.ts';

/** world.ts's `VarLiteral`, restated (see the header); world.test.ts pins the two to one type. */
type VarLiteral = 'int' | 'float' | 'bool' | 'string' | 'other';

/** What the world runner, inside `lintWorld`, hands every per-world pass: `lintWorld`'s own inputs and its line
 *  lookup (the 1-based line of a dotted path, else of its nearest written ancestor, else 0), so a pass reports at the
 *  author's line. */
export type WorldLintInput = {
  readonly chapter: SourceChapter;
  readonly file: string;
  readonly text: string;
  readonly world: WorldSource;
  readonly catalog: AssetCatalog;
  readonly knots: ReadonlySet<KnotName> | null;
  readonly yielded: ReadonlySet<PuzzleLocalId> | null;
  readonly declared: ReadonlyMap<VarName, VarLiteral>;
  readonly line: (path: string) => number;
  /** The line IDs each module's text walker returned for this world, from the one module walk `worldLines` shares
   *  (world.ts `moduleTextsOf`): every MECHANIC_TEXTS id, a `null` entry an empty set. `TEXTS_LINT` reads only this. */
  readonly moduleLines: ReadonlyMap<MechanicId, ReadonlySet<LineId>>;
};

export type WorldLint<C extends string> = {
  /** A module id, or a build pass ('clues', 'puzzle-shape'). */
  readonly id: string;
  /** Its own codes; unique across every registry. */
  readonly codes: { readonly [K in C]: Severity };
} & (
  /** A per-world pass: the world runner calls it once per chapter world; findings take `codes[code]` as severity. */
  | { lint(input: WorldLintInput): readonly Finding[] }
  /** A pass whose rules run from a story-level call in scripts/story.ts, over every chapter at once: the entry
   *  registers its codes only. The union makes a per-world entry without `lint` a tsc error, not a silent no-op. */
  | { readonly runsFrom: 'story' }
);

export const MECHANIC_LINTS = [CORE_LINT, CLUES_LINT, SHAPE_LINT, CONDITIONS_LINT, TEXTS_LINT] as const satisfies readonly WorldLint<string>[];

/**
 * Each data module's text walker (engine plan §3.2 "Module texts"), exhaustive over MECHANIC_DATA ids (an id without
 * an entry fails `check`); null: the module owns no text, and `world/text-unwalked` refuses one in its data.
 */
export const MECHANIC_TEXTS: { readonly [M in (typeof MECHANIC_DATA)[number] as M['id']]: TextWalker<DataOf<M>> | null } = { core: null, use: null };

type CodesOf<L> = L extends { readonly codes: infer C } ? keyof C & string : never;
/** Every code of every MECHANIC_LINTS entry. */
export type MechanicLintCode = CodesOf<(typeof MECHANIC_LINTS)[number]>;
