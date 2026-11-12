// Module `view`'s data half (engine plan §6.3): a room's `view: { of }` makes it a zoom view of the room `of`, entered
// through an ordinary exit of `of` and left back to it (`leave-view`, the rules half). Engine half: decoded at chapter
// load into `world.mods.view`, written back by `encode` for emission and the version hash. Function declarations and
// types only: mechanics/data/index.ts builds the entry from them. Its data is plain JSON. A view keeps no fact and no
// slice: where the player stands is the kernel's `room`, and how a move entered it is the move's, never state. Pure.
import type { WorldState } from '../../explore/state.ts';
import type { Result } from '../../story/catalog.ts';
import type { RoomId } from '../../world/types.ts';
import type { Issue, KernelWorld, OwnedAt, OwnedRaw } from '../contract.ts';

export type ViewData = {
  /** Each view room's parent room, in source order; a room that is no view is absent. */
  readonly of: Readonly<Record<RoomId, RoomId>>;
  /** Each view room's source path (`OwnedAt.path`): `encode` writes its `view` back there. */
  readonly paths: Readonly<Record<RoomId, string>>;
};

const ID_RE = /^[a-z][a-z0-9_]*$/;

/** Strict: `view` is exactly `{ of: <room id> }`; every issue is reported at `<room path>.view`, the author's line. */
export function decodeView(raw: OwnedRaw): Result<ViewData, Issue[]> {
  const error: Issue[] = [];
  const of: Record<string, RoomId> = {};
  const paths: Record<string, string> = {};
  for (const a of raw) {
    const path = `${a.path}.view`;
    const v = a.raw['view'];
    if (typeof v !== 'object' || v === null || Array.isArray(v)) {
      error.push({ path, reason: 'shape', detail: 'not a { of } object' });
      continue;
    }
    const extra = Object.keys(v).filter((k) => k !== 'of');
    if (extra.length > 0) {
      error.push({ path, reason: 'shape', detail: `unknown key ${extra.join(', ')} (expected of)` });
    }
    const parent: unknown = (v as Readonly<Record<string, unknown>>)['of']; // an object, checked above
    if (typeof parent !== 'string' || !ID_RE.test(parent)) {
      error.push({ path, reason: 'id', detail: `of: not a room id ${ID_RE.source}` });
      continue;
    }
    of[a.id] = parent as RoomId; // an id by the pattern; its room is the story gate's (`world/unknown-ref`)
    paths[a.id] = a.path;
  }
  return error.length > 0 ? { ok: false, error } : { ok: true, value: { of, paths } };
}

/** The inverse of `decodeView`: a world with no view encodes [], so its body and version are unchanged. */
export function encodeView(d: ViewData): OwnedRaw {
  return Object.entries(d.of).map(([id, of]): OwnedAt => ({ place: 'room', id, path: d.paths[id as RoomId] ?? '', raw: { view: { of } } }));
}

/** It keeps no fact and no slice. */
export function normalizeView(_w: KernelWorld, s: WorldState): WorldState {
  return s;
}
