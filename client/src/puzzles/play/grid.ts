// The `grid` puzzle's play half (engine plan §7.1; GM7g D2, D3): chunk code, imported only by its type UI
// (`rules-lazy`) and by the build's lint half, so the player's rule is the build's rule. Pure. It value-imports
// nothing: the chunk's engine bindings stay the ones its UI already reads.
import type { GridParams } from '../rules/grid.ts';
import type { PuzzleTypePlay } from '../rules/index.ts';

/** Whether the cells `start`, `start + step`, ... (`len` of them) of `a` hold no symbol twice. */
function distinct(a: readonly number[], start: number, step: number, len: number): boolean {
  const seen = new Set<number>();
  for (let i = 0; i < len; i++) {
    const v = a[start + i * step];
    if (v === undefined || seen.has(v)) {
      return false;
    }
    seen.add(v);
  }
  return true;
}

/** Whether `a` fills every cell with a symbol in 1..symbols, keeps every given, and repeats none in a row or column. */
export function reached(p: GridParams, a: readonly number[]): boolean {
  if (a.length !== p.rows * p.cols) {
    return false;
  }
  const full = a.every((v, c) => Number.isInteger(v) && v >= 1 && v <= p.symbols && (p.given[c] === 0 || p.given[c] === v));
  if (!full) {
    return false;
  }
  for (let r = 0; r < p.rows; r++) {
    if (!distinct(a, r * p.cols, 1, p.cols)) {
      return false;
    }
  }
  for (let c = 0; c < p.cols; c++) {
    if (!distinct(a, c, p.cols, p.rows)) {
      return false;
    }
  }
  return true;
}

/** What a reached answer posts: the answer itself (one cell order, one fill). */
export function canonical(_p: GridParams, a: readonly number[]): readonly number[] {
  return a;
}

/**
 * Symbol `v` (0 clears) on free cell `cell`: the next answer in a fresh array, or null when nothing would change - a
 * given cell, a value or cell out of range, an answer of another length, or the value the cell already holds (V2, so
 * no content-equal answer ever leaves the UI).
 */
export function place(p: GridParams, a: readonly number[], cell: number, v: number): readonly number[] | null {
  const cells = p.rows * p.cols;
  if (a.length !== cells || !Number.isInteger(cell) || cell < 0 || cell >= cells || p.given[cell] !== 0) {
    return null;
  }
  if (!Number.isInteger(v) || v < 0 || v > p.symbols || a[cell] === v) {
    return null;
  }
  const next = [...a];
  next[cell] = v;
  return next;
}

export const GRID_PLAY = Object.freeze({
  // The only answer a grid posts is a reached one: it posts itself, there is no Try.
  validAnswer: reached,
  reached,
  canonical,
} satisfies PuzzleTypePlay<GridParams>);
