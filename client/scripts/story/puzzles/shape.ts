// The answer bound of engine plan §7.4 (W3, round 3): every answer a world's puzzle posts has 1..MAX_ANSWER_LEN
// entries, so the server's own bound (it refuses a longer answer) never meets a world the build accepted. A build pass
// of the world lint registry (§3.2). Build only and pure, no node:*: world.ts imports the registry and scan-dist.ts
// imports world.ts. Its imports from ../mechanics/index.ts and ../lint.ts are `import type`.
import { PUZZLE_TYPES } from '../../../src/puzzles/rules/index.ts';
import type { PuzzleTypes } from '../../../src/puzzles/rules/index.ts';
import type { PuzzleLocalId } from '../../../src/story/staging.ts';
import type { WorldIssue } from '../../../src/world/decode.ts';
import type { SourcePuzzle, WorldSource } from '../../../src/world/types.ts';
import type { Finding, Severity } from '../lint.ts';
import type { WorldLint, WorldLintInput } from '../mechanics/index.ts';
import { PUZZLE_LINTS } from './index.ts';
import type { PuzzleTypeLint } from './index.ts';

/**
 * The longest answer the build emits; never above the server's MAX_ANSWER_LEN (server/src/puzzles/mod.rs, 64 since
 * GM6s1; the test `story: the build's answer bound never exceeds the server's MAX_ANSWER_LEN` reads it). GM7g raises
 * it to 64.
 */
export const MAX_ANSWER_LEN = 16;

export const SHAPE_CODES = { 'world/answer-len': 'E' } as const satisfies Readonly<Record<string, Severity>>;

/** The lint halves keyed by type, structurally: a test keys a fixture type beside the real ones. */
export type PuzzleLintRegistry = Readonly<Record<string, PuzzleTypeLint<unknown>>>;

/**
 * How many entries puzzle `p` posts: a commit type's answer shape (its data half), a reach type's solution (its lint
 * half's `solve`); null when a reach instance has no solution (that is the type's own lint) or its type is unknown.
 */
export function postedLength(p: SourcePuzzle, lints: PuzzleLintRegistry = PUZZLE_LINTS, types: PuzzleTypes = PUZZLE_TYPES): number | null {
  const data = types.find((d) => d.type === p.type);
  if (data === undefined) {
    return null;
  }
  if (data.check === 'commit') {
    return data.answerShape(p.params).len;
  }
  const lint = Object.hasOwn(lints, p.type) ? lints[p.type] : undefined;
  return lint?.solve?.(p.params)?.length ?? null;
}

/** Every puzzle of `w` whose posted answer is outside 1..MAX_ANSWER_LEN, at its `params`. */
export function answerLenIssues(w: WorldSource, lints: PuzzleLintRegistry = PUZZLE_LINTS, types: PuzzleTypes = PUZZLE_TYPES): WorldIssue[] {
  const out: WorldIssue[] = [];
  // The keys of a decoded record are its puzzle ids.
  for (const [pid, p] of Object.entries(w.puzzles) as Array<[PuzzleLocalId, SourcePuzzle]>) {
    const n = postedLength(p, lints, types);
    if (n !== null && (n < 1 || n > MAX_ANSWER_LEN)) {
      out.push({ path: `puzzles.${pid}.params`, reason: 'range', detail: `puzzle '${pid}' posts ${n} entries: 1..${MAX_ANSWER_LEN} (the server refuses longer, §7.4)` });
    }
  }
  return out;
}

/** The pass: each issue as a `world/answer-len` finding at the author's line. */
export function answerLenFindings(input: WorldLintInput, lints: PuzzleLintRegistry = PUZZLE_LINTS, types: PuzzleTypes = PUZZLE_TYPES): Finding[] {
  return answerLenIssues(input.world, lints, types).map((i) => ({
    code: 'world/answer-len',
    severity: SHAPE_CODES['world/answer-len'],
    file: input.file,
    line: input.line(i.path),
    message: i.detail,
  }));
}

export const SHAPE_LINT: WorldLint<keyof typeof SHAPE_CODES> = { id: 'puzzle-shape', codes: SHAPE_CODES, lint: (input) => answerLenFindings(input) };
