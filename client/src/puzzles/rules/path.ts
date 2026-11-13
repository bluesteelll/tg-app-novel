// The `path` puzzle (engine plan §7.2; GM7p D1): a grid of `cols` x `rows` cells numbered row-major
// (`row * cols + col`), two `ends` and some `blocked` cells. One line runs from one end to the other through every open
// cell exactly once, by 4-neighbour steps; the answer is the cells in drawn order. The data half (engine plan §7.1): a
// reach type on an overlay whose goal its UI shows, with no wrong state; the answer posts itself once it reaches.
import type { Result } from '../../story/catalog.ts';
import type { PuzzleTypeData } from './index.ts';

export type PathParams = {
  readonly cols: number;
  readonly rows: number;
  readonly ends: readonly [number, number];
  readonly blocked: readonly number[];
};

const SIDE_MIN = 2;
const SIDE_MAX = 7;
const KEYS: readonly string[] = ['cols', 'rows', 'ends', 'blocked'];

function side(name: string, v: unknown): Result<number, string> {
  return typeof v === 'number' && Number.isInteger(v) && v >= SIDE_MIN && v <= SIDE_MAX
    ? { ok: true, value: v }
    : { ok: false, error: `${name} must be an integer in ${SIDE_MIN}..${SIDE_MAX}` };
}

/** The distinct cells of a list, each an integer in 0..`cells - 1`; else why not. */
function cellList(name: string, v: unknown, cells: number): Result<number[], string> {
  if (!Array.isArray(v)) {
    return { ok: false, error: `${name} must be an array of cells` };
  }
  const out: number[] = [];
  for (const c of v) {
    if (typeof c !== 'number' || !Number.isInteger(c) || c < 0 || c >= cells) {
      return { ok: false, error: `${name}: ${JSON.stringify(c) ?? 'undefined'} is not a cell in 0..${cells - 1}` };
    }
    if (out.includes(c)) {
      return { ok: false, error: `${name}: cell ${c} is listed twice` };
    }
    out.push(c);
  }
  return { ok: true, value: out };
}

function decodeParams(raw: unknown): Result<PathParams, string> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'params is not an object' };
  }
  const own = Object.keys(raw);
  const extra = own.filter((k) => !KEYS.includes(k));
  if (extra.length > 0) {
    return { ok: false, error: `unknown key ${extra.join(', ')} (a path puzzle has 'cols', 'rows', 'ends', 'blocked')` };
  }
  const missing = KEYS.filter((k) => !own.includes(k));
  if (missing.length > 0) {
    return { ok: false, error: `missing key ${missing.join(', ')}` };
  }
  const r: Record<string, unknown> = { ...raw };
  const cols = side('cols', r.cols);
  if (!cols.ok) {
    return cols;
  }
  const rows = side('rows', r.rows);
  if (!rows.ok) {
    return rows;
  }
  const cells = cols.value * rows.value;
  const ends = cellList('ends', r.ends, cells);
  if (!ends.ok) {
    return ends;
  }
  const [a, b] = ends.value;
  if (ends.value.length !== 2 || a === undefined || b === undefined) {
    return { ok: false, error: 'ends must be exactly two distinct cells' };
  }
  const blocked = cellList('blocked', r.blocked, cells);
  if (!blocked.ok) {
    return blocked;
  }
  const blockedEnd = blocked.value.find((c) => c === a || c === b);
  if (blockedEnd !== undefined) {
    return { ok: false, error: `blocked: cell ${blockedEnd} is an end` };
  }
  return { ok: true, value: { cols: cols.value, rows: rows.value, ends: [a, b], blocked: blocked.value } };
}

/**
 * Every open cell is visited, so the posted length is a function of `params` and equals every solution's length
 * (engine plan §7.1 H1 (1); a reach type's "longest working answer" of 07:21 would post a shorter path as invalid).
 */
function answerShape(p: PathParams): { len: number; max: number } {
  return { len: p.cols * p.rows - p.blocked.length, max: p.cols * p.rows - 1 };
}

export const PATH_RULES = Object.freeze({
  type: 'path',
  check: 'reach',
  goal: 'shown',
  presentation: 'overlay',
  wrong: 'none',
  // Unused for a reach type: the answer posts itself once it reaches the goal.
  commit: 'control',
  decodeParams,
  answerShape,
  initial: (_p: PathParams): readonly number[] => [],
  // No full-length configuration shows before input.
  startShown: (_p: PathParams): readonly number[] | null => null,
  controls: [
    { name: 'path-cell', on: 'click' },
    { name: 'path-stroke', on: 'gesture' },
  ],
} as const satisfies PuzzleTypeData<'path', PathParams>);
