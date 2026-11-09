// The world lint registry (engine plan §3.2 "Lint codes"; build only): every mechanic's lint pass the story gate runs
// over a chapter world, each with its own codes, so no lane adds to LINT_CODES (lint.ts) or the DSL's code table. Pure,
// no node:*: world.ts imports it and scan-dist.ts imports world.ts. Its imports from world.ts and lint.ts are
// `import type`, erased at run time, so the value graph is world.ts -> index.ts -> the lint files with no edge back.
// Each module lane appends its entry.
import type { AssetCatalog } from '../../../src/story/catalog.ts';
import type { KnotName, PuzzleLocalId, VarName } from '../../../src/story/staging.ts';
import type { WorldSource } from '../../../src/world/types.ts';
import type { Finding, Severity, SourceChapter } from '../lint.ts';
import type { VarLiteral } from '../world.ts';
import { CORE_LINT } from './core.ts';

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

export const MECHANIC_LINTS = [CORE_LINT] as const satisfies readonly WorldLint<string>[];

type CodesOf<L> = L extends { readonly codes: infer C } ? keyof C & string : never;
/** Every code of every MECHANIC_LINTS entry. */
export type MechanicLintCode = CodesOf<(typeof MECHANIC_LINTS)[number]>;
