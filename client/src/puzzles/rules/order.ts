// The `order` puzzle (X17): `pieces` are 2..5 distinct items in their listed (initial) order; the answer is the piece
// index per slot, a permutation that differs from the identity. The data half (engine plan §7.1): a commit type on an
// overlay whose secret goal the server checks.
import type { Result } from '../../story/catalog.ts';
import type { ItemId } from '../../world/types.ts';
import type { PuzzleTypeData } from './index.ts';

export type OrderParams = { readonly pieces: readonly ItemId[] };

const PIECES_MIN = 2;
const PIECES_MAX = 5;
// PUZZLES-PLAN "Identifiers": an item id (world/decode.ts keeps the same pattern).
const ITEM_ID_RE = /^[a-z][a-z0-9_]*$/;

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

function initial(p: OrderParams): readonly number[] {
  return p.pieces.map((_, i) => i);
}

export const ORDER_RULES: PuzzleTypeData<'order', OrderParams> = Object.freeze({
  type: 'order',
  check: 'commit',
  goal: 'secret',
  presentation: 'overlay',
  wrong: 'posted',
  commit: 'control',
  decodeParams,
  answerShape: (p: OrderParams) => ({ len: p.pieces.length, max: p.pieces.length - 1 }),
  initial,
  // The pieces show in their listed order before any input.
  startShown: initial,
});
