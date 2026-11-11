// Module `visual`'s data half (engine plan §6.4, §5.1): a hotspot's `states` (each a picture: a prop that replaces the
// hotspot's own, or a patch drawn over it) and its `is` rules (the first whose `when` holds names the state), and a
// room's `decor` (pictures with no hotspot, drawn in `z` order, with states of their own). Engine half: decoded at
// chapter load into `world.mods.visual`, written back by `encode` for emission and the version hash. Function
// declarations and types only: mechanics/data/index.ts builds the entry from them, so the registry loads from any
// module first (the cycle through data/conditions.ts). Its data is plain JSON. A state is a visual condition, never
// gating: it reads any id of the chapter and keeps no fact. Pure.
import type { WorldState } from '../../explore/state.ts';
import type { Result } from '../../story/catalog.ts';
import type { PropId, Rect } from '../../story/staging.ts';
import type { HotspotKey, RoomId } from '../../world/types.ts';
import type { DecodeCtx, Issue, IssueReport, KernelWorld, OwnedAt, OwnedRaw, StateName } from '../contract.ts';
import { decodeCond } from './conditions.ts';
import type { Cond } from './conditions.ts';

/** A state's picture: `prop` replaces the base image (null: nothing drawn); `patch` is drawn over the base at `rect`. */
export type StateArt = { readonly prop: PropId | null } | { readonly patch: PropId; readonly rect: Rect };
/** One rule of an anchor's state: the first whose `when` holds names the state; none holds: `default`. */
export type IsRule = { readonly when: Cond; readonly state: StateName };
type Arts = Readonly<Record<StateName, StateArt>>;
/** A hotspot's states (the base is its `prop`, the `default` state) and its rules. */
export type HotspotVisual = { readonly states: Arts; readonly is: readonly IsRule[] };
/** A picture of a room with no hotspot: its anchor is `<room>~<id>`, drawn at `z` (hotspot props are at 0). */
export type Decor = { readonly id: string; readonly prop: PropId; readonly rect: Rect; readonly z: number; readonly states: Arts; readonly is: readonly IsRule[] };

export type VisualData = {
  /** The hotspots that declare `states` or `is`, in source order. */
  readonly hotspots: Readonly<Record<HotspotKey, HotspotVisual>>;
  /** Each room's decor, in source order; a room without decor is absent. */
  readonly decor: Readonly<Record<RoomId, readonly Decor[]>>;
  /** Each owned place's source path, by `<place>:<id>` (`OwnedAt.path`): `encode` writes every value back there. */
  readonly paths: Readonly<Record<string, string>>;
};

type Obj = Readonly<Record<string, unknown>>;

const ID_RE = /^[a-z][a-z0-9_]*$/;
const DEFAULT = 'default';

function isObject(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** The kernel's strict keys: each key outside `known`, each of `need` missing, reported; not an object reads as {}. */
function keysOf(v: unknown, path: string, report: IssueReport, known: readonly string[], need: readonly string[] = known): Obj {
  if (!isObject(v)) {
    report(path, 'shape', `not an object of ${known.join(', ')}`);
    return {};
  }
  for (const k of Object.keys(v)) {
    if (!known.includes(k)) {
      report(`${path}.${k}`, 'shape', `unknown key (expected ${known.join(', ')})`);
    }
  }
  for (const k of need) {
    if (!Object.hasOwn(v, k)) {
      report(`${path}.${k}`, 'shape', 'missing');
    }
  }
  return v;
}

/** An id (the kernel's pattern): a prop, a decor; a prop's catalog entry is the story gate's (`world/unknown-asset`). */
function idOf(v: unknown, path: string, report: IssueReport): PropId {
  if (typeof v !== 'string' || !ID_RE.test(v)) {
    report(path, 'id', `not an id ${ID_RE.source}`);
  }
  return v as PropId; // an id unless reported above (the result is dropped then)
}

/** Integer source px of the 1080×2048 room space, as the kernel's `rect`: x, y ≥ 0 and w, h > 0. */
function rectOf(v: unknown, path: string, report: IssueReport): Rect {
  if (!Array.isArray(v) || v.length !== 4 || !v.every((n: unknown, i) => Number.isInteger(n) && (n as number) >= (i < 2 ? 0 : 1))) {
    report(path, 'shape', 'not [x, y, w, h] in integers, x, y ≥ 0, w, h > 0');
  }
  return v as Rect; // a rect unless reported above (the result is dropped then)
}

function artOf(v: unknown, path: string, report: IssueReport): StateArt {
  if (isObject(v) && Object.hasOwn(v, 'patch')) {
    const a = keysOf(v, path, report, ['patch', 'rect']);
    return { patch: idOf(a['patch'], `${path}.patch`, report), rect: rectOf(a['rect'], `${path}.rect`, report) };
  }
  if (!isObject(v) || !Object.hasOwn(v, 'prop')) {
    report(path, 'shape', 'not a state picture: { prop } or { patch, rect }');
    return { prop: null };
  }
  keysOf(v, path, report, ['prop']);
  return { prop: v['prop'] === null ? null : idOf(v['prop'], `${path}.prop`, report) };
}

/** `states`: each a declared name (never `default`, the base) with its picture. */
function statesOf(v: unknown, path: string, report: IssueReport): Arts {
  const out: Record<string, StateArt> = {};
  if (!isObject(v)) {
    report(path, 'shape', 'not an object of state pictures');
  }
  for (const [name, art] of Object.entries(isObject(v) ? v : {})) {
    if (!ID_RE.test(name) || name === DEFAULT) {
      report(`${path}.${name}`, 'id', `not a state name: an id, not '${DEFAULT}'`);
    }
    out[name] = artOf(art, `${path}.${name}`, report);
  }
  return out;
}

/** `is`: `{ when, state }` rules, each state `default` or a key of `states`. */
function isOf(v: unknown, states: Arts, path: string, ctx: DecodeCtx, report: IssueReport): IsRule[] {
  if (!Array.isArray(v)) {
    report(path, 'shape', 'not an array of { when, state }');
    return [];
  }
  return v.map((r: unknown, i) => {
    const p = `${path}.${i}`;
    const { when, state } = keysOf(r, p, report, ['when', 'state']);
    const c = decodeCond(when, ctx, `${p}.when`);
    for (const e of c.ok ? [] : c.error) {
      report(e.path, e.reason, e.detail);
    }
    if (state !== DEFAULT && (typeof state !== 'string' || !Object.hasOwn(states, state))) {
      report(`${p}.state`, 'id', `neither '${DEFAULT}' nor a declared state`);
    }
    return { when: (c.ok ? c.value : null) as Cond, state: state as StateName }; // dropped unless both decoded
  });
}

function decorOf(v: unknown, path: string, ctx: DecodeCtx, report: IssueReport): Decor {
  const d = keysOf(v, path, report, ['id', 'prop', 'rect', 'z', 'states', 'is'], ['id', 'prop', 'rect', 'z']);
  const has = (k: string): boolean => Object.hasOwn(d, k);
  if (has('z') && !Number.isInteger(d['z'])) {
    report(`${path}.z`, 'shape', 'not an integer');
  }
  const states = has('states') ? statesOf(d['states'], `${path}.states`, report) : {};
  return {
    id: has('id') ? idOf(d['id'], `${path}.id`, report) : '',
    prop: has('prop') ? idOf(d['prop'], `${path}.prop`, report) : ('' as PropId),
    rect: has('rect') ? rectOf(d['rect'], `${path}.rect`, report) : [0, 0, 1, 1],
    z: d['z'] as number, // an integer unless reported above (the result is dropped then)
    states,
    is: has('is') ? isOf(d['is'], states, `${path}.is`, ctx, report) : [],
  };
}

/** Strict keys, every issue reported, each at its source path. Empty `states`, `is` and `decor` are the defaults. */
export function decodeVisual(raw: OwnedRaw, ctx: DecodeCtx): Result<VisualData, Issue[]> {
  const error: Issue[] = [];
  const report: IssueReport = (path, reason, detail) => {
    error.push({ path, reason, detail });
  };
  const hotspots: Record<string, HotspotVisual> = {};
  const decor: Record<string, Decor[]> = {};
  const paths: Record<string, string> = {};
  for (const a of raw) {
    const { states: s, is, decor: list } = a.raw;
    if (a.place === 'hotspot') {
      const states = s === undefined ? {} : statesOf(s, `${a.path}.states`, report);
      const h = { states, is: is === undefined ? [] : isOf(is, states, `${a.path}.is`, ctx, report) };
      if (Object.keys(states).length + h.is.length === 0) {
        continue; // the defaults: nothing to draw differently, nothing to write back
      }
      hotspots[a.id] = h;
    } else {
      const room = Array.isArray(list) ? list.map((v: unknown, i) => decorOf(v, `${a.path}.decor.${i}`, ctx, report)) : [];
      if (!Array.isArray(list)) {
        report(`${a.path}.decor`, 'shape', 'not an array of decor');
      }
      room.forEach((d, i) => {
        if (room.findIndex((x) => x.id === d.id) !== i) {
          report(`${a.path}.decor.${i}.id`, 'id', `decor '${d.id}' repeats in this room`);
        }
      });
      if (room.length === 0) {
        continue; // the default
      }
      decor[a.id] = room;
    }
    paths[`${a.place}:${a.id}`] = a.path;
  }
  return error.length > 0 ? { ok: false, error } : { ok: true, value: { hotspots, decor, paths } };
}

/** An anchor's states and rules, defaults left out. */
function encodeArt(x: { readonly states: Arts; readonly is: readonly IsRule[] }): Obj {
  return { ...(Object.keys(x.states).length === 0 ? {} : { states: x.states }), ...(x.is.length === 0 ? {} : { is: x.is }) };
}

/** The inverse of `decodeVisual`, defaults left out: a world without `visual` keys encodes [], so its body is unchanged. */
export function encodeVisual(d: VisualData): OwnedRaw {
  const at = (place: OwnedAt['place'], id: string, raw: Obj): OwnedAt => ({ place, id, path: d.paths[`${place}:${id}`] ?? '', raw });
  return [
    ...Object.entries(d.hotspots).map(([id, h]) => at('hotspot', id, encodeArt(h))),
    ...Object.entries(d.decor).map(([id, list]) => at('room', id, { decor: list.map((x) => ({ id: x.id, prop: x.prop, rect: x.rect, z: x.z, ...encodeArt(x) })) })),
  ];
}

/** It keeps no fact and no slice: a state is derived from the kernel's facts at every read. */
export function normalizeVisual(_w: KernelWorld, s: WorldState): WorldState {
  return s;
}
