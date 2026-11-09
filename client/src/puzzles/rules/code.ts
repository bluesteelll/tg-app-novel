// The `code` lock (X17): `dials` 2..6, each a digit 0-9; the answer is the digit per dial; the start is all zeros.
// The data half (engine plan §7.1): a commit type on an overlay whose secret goal the server checks.
import type { Result } from '../../story/catalog.ts';
import type { PuzzleTypeData } from './index.ts';

export type CodeParams = { readonly dials: number };

const DIALS_MIN = 2;
const DIALS_MAX = 6;
const DIGIT_MAX = 9;

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

function initial(p: CodeParams): readonly number[] {
  return new Array<number>(p.dials).fill(0);
}

export const CODE_RULES: PuzzleTypeData<'code', CodeParams> = Object.freeze({
  type: 'code',
  check: 'commit',
  goal: 'secret',
  presentation: 'overlay',
  wrong: 'posted',
  commit: 'control',
  decodeParams,
  answerShape: (p: CodeParams) => ({ len: p.dials, max: DIGIT_MAX }),
  initial,
  // The dials show their zeros before any input.
  startShown: initial,
});
