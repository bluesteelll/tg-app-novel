// The `path` puzzle's play half (engine plan §7.1, §8.3 gestures; GM7p D2): chunk code, imported only by its type UI
// (`rules-lazy`) and by the build's lint half, so the player's rule is the build's rule. Pure. It value-imports
// nothing: the chunk's engine bindings stay the ones its UI already reads.
import type { PuzzleTypePlay } from '../rules/index.ts';
import type { PathParams } from '../rules/path.ts';

/** A point in grid units: `x` in 0..cols and `y` in 0..rows cover the grid, cell `(x, y)` spans one unit each way. */
export type GridPoint = { readonly x: number; readonly y: number };

function isEnd(p: PathParams, c: number): boolean {
  return c === p.ends[0] || c === p.ends[1];
}

function isOpen(p: PathParams, c: number): boolean {
  return Number.isInteger(c) && c >= 0 && c < p.cols * p.rows && !p.blocked.includes(c);
}

/** 4-neighbours by row and column, so the last cell of a row is never next to the first of the following row. */
function adjacent(p: PathParams, a: number, b: number): boolean {
  const ra = Math.floor(a / p.cols);
  const rb = Math.floor(b / p.cols);
  const ca = a % p.cols;
  const cb = b % p.cols;
  return (ra === rb && Math.abs(ca - cb) === 1) || (ca === cb && Math.abs(ra - rb) === 1);
}

/** Whether `a` runs from one end to the other through every open cell exactly once, by 4-neighbour steps. */
export function reached(p: PathParams, a: readonly number[]): boolean {
  // Every open cell, the rule read from `params` (equal to `PATH_RULES.answerShape(p).len`).
  if (a.length + p.blocked.length !== p.cols * p.rows) {
    return false;
  }
  const first = a[0];
  const last = a.at(-1);
  if (first === undefined || last === undefined || first === last || !isEnd(p, first) || !isEnd(p, last)) {
    return false;
  }
  const seen = new Set<number>();
  let prev: number | null = null;
  for (const c of a) {
    if (!isOpen(p, c) || seen.has(c) || (prev !== null && !adjacent(p, prev, c))) {
      return false;
    }
    seen.add(c);
    prev = c;
  }
  return true;
}

/** What a reached answer posts: the path from its lower-index end, so both drawing directions post one answer. */
export function canonical(_p: PathParams, a: readonly number[]): readonly number[] {
  const first = a[0];
  const last = a.at(-1);
  return first !== undefined && last !== undefined && first > last ? [...a].reverse() : a;
}

/**
 * A stroke entering cell `c`: the next answer, or null when nothing changes. Back onto the previous cell takes the last
 * cell back; an open neighbour of the end that the path does not hold extends it; a path that reached its far end only
 * goes back, so a reached answer never turns into another reached one.
 */
export function advance(p: PathParams, a: readonly number[], c: number): readonly number[] | null {
  const end = a.at(-1);
  if (end === undefined || c === end) {
    return null;
  }
  if (c === a.at(-2)) {
    return a.slice(0, -1);
  }
  if (a.length > 1 && isEnd(p, end)) {
    return null;
  }
  return isOpen(p, c) && adjacent(p, end, c) && !a.includes(c) ? [...a, c] : null;
}

/** A pointer going down on cell `c`, or a cell's click: a step as `advance`, or else a touch on an end restarts there. */
export function touch(p: PathParams, a: readonly number[], c: number): readonly number[] | null {
  return advance(p, a, c) ?? (isEnd(p, c) && c !== a.at(-1) ? [c] : null);
}

/** The cell at grid point `(x, y)`, or null off the grid (the far edges `x = cols`, `y = rows` included) or non-finite. */
export function cellAt(p: PathParams, x: number, y: number): number | null {
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= p.cols || y >= p.rows) {
    return null;
  }
  return Math.floor(y) * p.cols + Math.floor(x);
}

/**
 * The grid cells the straight segment from `from` to `to` enters, in order, without `from`'s own cell (a grid
 * traversal, Amanatides-Woo): a fast move enters every cell it crosses. Off-grid stretches add nothing; at an exact
 * corner the horizontal neighbour comes first. With no `from` it is the cell at `to`, if any.
 */
export function cellsAlong(p: PathParams, from: GridPoint | null, to: GridPoint): number[] {
  if (!Number.isFinite(to.x) || !Number.isFinite(to.y)) {
    return [];
  }
  if (from === null || !Number.isFinite(from.x) || !Number.isFinite(from.y)) {
    const c = cellAt(p, to.x, to.y);
    return c === null ? [] : [c];
  }
  let cx = Math.floor(from.x);
  let cy = Math.floor(from.y);
  const tx = Math.floor(to.x);
  const ty = Math.floor(to.y);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const stepX = Math.sign(dx);
  const stepY = Math.sign(dy);
  // The segment's parameter (0 at `from`, 1 at `to`) where it crosses the next vertical / horizontal cell boundary.
  let tMaxX = stepX > 0 ? (cx + 1 - from.x) / dx : stepX < 0 ? (cx - from.x) / dx : Infinity;
  let tMaxY = stepY > 0 ? (cy + 1 - from.y) / dy : stepY < 0 ? (cy - from.y) / dy : Infinity;
  const tDeltaX = stepX === 0 ? Infinity : 1 / Math.abs(dx);
  const tDeltaY = stepY === 0 ? Infinity : 1 / Math.abs(dy);
  const out: number[] = [];
  // Each step moves one cell along x or y, and only toward `to`'s cell, so the walk ends there whatever the rounding.
  while (cx !== tx || cy !== ty) {
    if (cx !== tx && (cy === ty || tMaxX <= tMaxY)) {
      cx += stepX;
      tMaxX += tDeltaX;
    } else {
      cy += stepY;
      tMaxY += tDeltaY;
    }
    if (cx >= 0 && cy >= 0 && cx < p.cols && cy < p.rows) {
      out.push(cy * p.cols + cx);
    }
  }
  return out;
}

export const PATH_PLAY = Object.freeze({
  // The only answer a path posts is a reached one: it posts itself, there is no Try.
  validAnswer: reached,
  reached,
  canonical,
} satisfies PuzzleTypePlay<PathParams>);
