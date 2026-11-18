// Module `carry`'s data half (engine plan §6.6): a giving world's `items.<id>.carry: true` marks an item it may carry
// out of its chapter; a receiving world's top-level `inherits: [{ id, required }]` names the items its chapter starts
// with, each required (held in every start) or optional (held or not). Engine half: decoded at chapter load into
// `world.mods.carry`, written back by `encode` for emission and the version hash. Function declarations and types only:
// mechanics/data/index.ts builds the entry from them; it imports nothing from data/conditions.ts, so it is off the
// registry's load cycle. Its data is plain JSON. Whether a carry holds across the chapters (story/items.json, the giver's
// paths and leaves) is the story gate's (client/scripts/story/mechanics/carry.ts). It keeps no fact and no slice. Pure.
import type { WorldState } from '../../explore/state.ts';
import type { Result } from '../../story/catalog.ts';
import type { ItemId } from '../../world/types.ts';
import type { Issue, KernelWorld, OwnedAt, OwnedRaw } from '../contract.ts';

/** One inherited item: `required` holds it in every start of the receiver; an optional one is held or not. */
export type Inherit = { readonly id: ItemId; readonly required: boolean };

export type CarryData = {
  /** The items this world marks `carry: true`, in source order. */
  readonly marks: readonly ItemId[];
  /** The items its chapter inherits, in source order. */
  readonly inherits: readonly Inherit[];
};

const ID_RE = /^[a-z][a-z0-9_]*$/;
const KEYS = ['id', 'required'];

/** Strict: a mark is `true` only, `inherits` a list of exactly `{ id, required }` with no repeated id; every issue at its
 *  path. */
export function decodeCarry(raw: OwnedRaw): Result<CarryData, Issue[]> {
  const error: Issue[] = [];
  const marks: ItemId[] = [];
  const inherits: Inherit[] = [];
  const seen = new Set<string>();
  for (const a of raw) {
    if (a.place === 'item') {
      if (a.raw['carry'] === true) {
        marks.push(a.id as ItemId); // an item place's id is its decoded key
      } else {
        error.push({ path: `${a.path}.carry`, reason: 'shape', detail: 'not true (omit the key)' });
      }
      continue;
    }
    const list = a.raw['inherits'];
    if (!Array.isArray(list)) {
      error.push({ path: 'inherits', reason: 'shape', detail: 'not an array' });
      continue;
    }
    list.forEach((v: unknown, n) => {
      const path = `inherits.${n}`;
      if (typeof v !== 'object' || v === null || Array.isArray(v)) {
        error.push({ path, reason: 'shape', detail: 'not an { id, required } object' });
        return;
      }
      const e = v as Readonly<Record<string, unknown>>; // an object, checked above
      for (const k of Object.keys(e).filter((x) => !KEYS.includes(x))) {
        error.push({ path: `${path}.${k}`, reason: 'shape', detail: 'unknown key (expected id, required)' });
      }
      const id = e['id'];
      const required = e['required'];
      if (typeof id !== 'string' || !ID_RE.test(id)) {
        error.push({ path: `${path}.id`, reason: 'id', detail: `not an item id ${ID_RE.source}` });
      } else if (seen.has(id)) {
        error.push({ path: `${path}.id`, reason: 'shape', detail: `'${id}' repeats` });
      } else {
        seen.add(id);
        if (typeof required !== 'boolean') {
          error.push({ path: `${path}.required`, reason: 'shape', detail: 'not a boolean' });
        } else {
          inherits.push({ id: id as ItemId, required }); // an id by the pattern; its item is the story gate's
        }
      }
    });
  }
  return error.length > 0 ? { ok: false, error } : { ok: true, value: { marks, inherits } };
}

/** The inverse of `decodeCarry`: a world that carries nothing encodes [], so its body and version are unchanged. */
export function encodeCarry(d: CarryData): OwnedRaw {
  const marks = d.marks.map((id): OwnedAt => ({ place: 'item', id, path: `items.${id}`, raw: { carry: true } }));
  return d.inherits.length === 0 ? marks : [...marks, { place: 'world', id: '', path: '', raw: { inherits: d.inherits } }];
}

/** It keeps no fact and no slice: the chapter start's items are the runtime's (§6.6). */
export function normalizeCarry(_w: KernelWorld, s: WorldState): WorldState {
  return s;
}
