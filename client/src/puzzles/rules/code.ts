// The `code` lock (X17): `dials` 2..6, each a digit 0-9; the answer is the digit per dial; the start is all zeros.
import type { Result } from '../../story/catalog.ts';
import type { PuzzleRules } from './index.ts';

export type CodeParams = { readonly dials: number };

const DIALS_MIN = 2;
const DIALS_MAX = 6;
const DIGIT_MAX = 9;

function shapeProblem(a: readonly number[], len: number, max: number): string | null {
  if (a.length !== len) {
    return `length ${a.length}, expected ${len}`;
  }
  const bad = a.findIndex((v) => !Number.isInteger(v) || v < 0 || v > max);
  return bad === -1 ? null : `${String(a[bad])} at index ${bad} is out of range: an integer in 0..${max}`;
}

function decodeParams(raw: unknown): Result<CodeParams, string> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'params is not an object' };
  }
  const extra = Object.keys(raw).filter((k) => k !== 'dials');
  if (extra.length > 0) {
    return { ok: false, error: `unknown key ${extra.join(', ')} (a code puzzle has only 'dials')` };
  }
  const dials: unknown = 'dials' in raw ? raw.dials : undefined;
  if (typeof dials !== 'number' || !Number.isInteger(dials) || dials < DIALS_MIN || dials > DIALS_MAX) {
    return { ok: false, error: `dials must be an integer in ${DIALS_MIN}..${DIALS_MAX}` };
  }
  return { ok: true, value: { dials } };
}

export const CODE_RULES: PuzzleRules<CodeParams> = Object.freeze({
  type: 'code',
  decodeParams,
  answerShape: (p: CodeParams) => ({ len: p.dials, max: DIGIT_MAX }),
  initial: (p: CodeParams): readonly number[] => new Array<number>(p.dials).fill(0),
  validateSolution(p: CodeParams, s: readonly number[]): string | null {
    const shape = shapeProblem(s, p.dials, DIGIT_MAX);
    if (shape !== null) {
      return shape;
    }
    return s.every((d) => d === 0) ? 'the solution equals the initial state (all zeros)' : null;
  },
  validAnswer: (p: CodeParams, a: readonly number[]) => shapeProblem(a, p.dials, DIGIT_MAX) === null,
});
