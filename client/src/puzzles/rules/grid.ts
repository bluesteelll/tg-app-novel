// The `grid` puzzle (engine plan §7.2; GM7g D1, D2): `rows` x `cols` cells numbered cell-major (`row * cols + col`),
// filled with the symbols 1..`symbols` so that no symbol is twice in a row or a column and every given cell keeps its
// symbol. The answer is one entry per cell, 0 for an empty one. The data half (engine plan §7.1): a reach type on an
// overlay whose goal its UI shows, with no wrong state; the answer posts itself once it reaches.
import type { Result } from '../../story/catalog.ts';
import type { PuzzleTypeData } from './index.ts';

export type GridParams = {
  readonly rows: number;
  readonly cols: number;
  readonly symbols: number;
  /** One entry per cell, cell-major: 0 = not given, else the given symbol. */
  readonly given: readonly number[];
};

const SIDE_MIN = 2;
const MAX = 6;
const KEYS: readonly string[] = ['rows', 'cols', 'symbols', 'given'];

/** An integer in `lo`..6; else why not. */
function count(name: string, v: unknown, lo: number): Result<number, string> {
  return typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= MAX
    ? { ok: true, value: v }
    : { ok: false, error: `${name} must be an integer in ${lo}..${MAX}` };
}

function decodeParams(raw: unknown): Result<GridParams, string> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'params is not an object' };
  }
  const own = Object.keys(raw);
  const extra = own.filter((k) => !KEYS.includes(k));
  if (extra.length > 0) {
    return { ok: false, error: `unknown key ${extra.join(', ')} (a grid puzzle has 'rows', 'cols', 'symbols', 'given')` };
  }
  const missing = KEYS.filter((k) => !own.includes(k));
  if (missing.length > 0) {
    return { ok: false, error: `missing key ${missing.join(', ')}` };
  }
  const r: Record<string, unknown> = { ...raw };
  const rows = count('rows', r.rows, SIDE_MIN);
  if (!rows.ok) {
    return rows;
  }
  const cols = count('cols', r.cols, SIDE_MIN);
  if (!cols.ok) {
    return cols;
  }
  // A line of n cells holds n distinct symbols, so fewer symbols than the longer side fill no grid at all.
  const symbols = count('symbols', r.symbols, Math.max(rows.value, cols.value));
  if (!symbols.ok) {
    return symbols;
  }
  const cells = rows.value * cols.value;
  const given = r.given;
  if (!Array.isArray(given) || given.length !== cells) {
    return { ok: false, error: `given must be an array of ${cells} cells` };
  }
  const out: number[] = [];
  for (const [i, v] of given.entries()) {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > symbols.value) {
      return { ok: false, error: `given: ${JSON.stringify(v) ?? 'undefined'} at cell ${i} is not 0 (empty) or a symbol in 1..${symbols.value}` };
    }
    out.push(v);
  }
  return { ok: true, value: { rows: rows.value, cols: cols.value, symbols: symbols.value, given: out } };
}

/** The givens and blanks, a fresh copy: what a session starts from and what the device shows before any input. */
function initial(p: GridParams): readonly number[] {
  return [...p.given];
}

export const GRID_RULES = Object.freeze({
  type: 'grid',
  check: 'reach',
  goal: 'shown',
  presentation: 'overlay',
  wrong: 'none',
  // Unused for a reach type: the answer posts itself once it reaches the goal.
  commit: 'control',
  decodeParams,
  // Every cell, empty or not, so every solution has exactly `len` entries (H1 (1)); 0 is the empty cell.
  answerShape: (p: GridParams): { len: number; max: number } => ({ len: p.rows * p.cols, max: p.symbols }),
  initial,
  startShown: initial,
  controls: [
    { name: 'grid-cell', on: 'click' },
    { name: 'grid-symbol', on: 'click' },
  ],
} as const satisfies PuzzleTypeData<'grid', GridParams>);
