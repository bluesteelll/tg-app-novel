// The `order` puzzle (X17): `pieces` are 2..5 distinct items in their listed (initial) order; the answer is the piece
// index per slot, a permutation that differs from the identity.
import type { Result } from '../../story/catalog.ts';
import type { ItemId } from '../../world/types.ts';
import type { PuzzleRules } from './index.ts';

export type OrderParams = { readonly pieces: readonly ItemId[] };

const PIECES_MIN = 2;
const PIECES_MAX = 5;
// PUZZLES-PLAN "Identifiers": an item id (world/decode.ts keeps the same pattern).
const ITEM_ID_RE = /^[a-z][a-z0-9_]*$/;

function shapeProblem(a: readonly number[], len: number, max: number): string | null {
  if (a.length !== len) {
    return `length ${a.length}, expected ${len}`;
  }
  const bad = a.findIndex((v) => !Number.isInteger(v) || v < 0 || v > max);
  return bad === -1 ? null : `${String(a[bad])} at index ${bad} is out of range: an integer in 0..${max}`;
}

function decodeParams(raw: unknown): Result<OrderParams, string> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'params is not an object' };
  }
  const extra = Object.keys(raw).filter((k) => k !== 'pieces');
  if (extra.length > 0) {
    return { ok: false, error: `unknown key ${extra.join(', ')} (an order puzzle has only 'pieces')` };
  }
  const pieces: unknown = 'pieces' in raw ? raw.pieces : undefined;
  if (!Array.isArray(pieces) || pieces.length < PIECES_MIN || pieces.length > PIECES_MAX) {
    return { ok: false, error: `pieces must be an array of ${PIECES_MIN}..${PIECES_MAX} item ids` };
  }
  const out: ItemId[] = [];
  for (const p of pieces) {
    if (typeof p !== 'string' || !ITEM_ID_RE.test(p)) {
      return { ok: false, error: `${JSON.stringify(p) ?? 'undefined'} is not an item id ${ITEM_ID_RE.source}` };
    }
    // The pattern above is ItemId's whole contract; whether the item exists is world/unknown-ref (LW3).
    const id = p as ItemId;
    if (out.includes(id)) {
      return { ok: false, error: `piece '${p}' is listed twice` };
    }
    out.push(id);
  }
  return { ok: true, value: { pieces: out } };
}

export const ORDER_RULES: PuzzleRules<OrderParams> = Object.freeze({
  type: 'order',
  decodeParams,
  answerShape: (p: OrderParams) => ({ len: p.pieces.length, max: p.pieces.length - 1 }),
  initial: (p: OrderParams): readonly number[] => p.pieces.map((_, i) => i),
  validateSolution(p: OrderParams, s: readonly number[]): string | null {
    const n = p.pieces.length;
    const shape = shapeProblem(s, n, n - 1);
    if (shape !== null) {
      return shape;
    }
    if (new Set(s).size !== n) {
      return `not a permutation of 0..${n - 1}: an index repeats`;
    }
    return s.every((v, i) => v === i) ? 'the solution equals the initial state (the listed order)' : null;
  },
  validAnswer: (p: OrderParams, a: readonly number[]) => shapeProblem(a, p.pieces.length, p.pieces.length - 1) === null,
});
