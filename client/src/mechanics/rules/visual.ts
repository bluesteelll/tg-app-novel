// Module `visual`'s rules half (engine plan §6.4): a room's picture derived from the state. Each `take` or `object`
// hotspot with a picture, then each decor, is one anchor whose state is the first `is` whose `when` holds, else
// `default`; a taken take draws nothing (B-001 by construction). `visualsOf` composes every module's `visuals` hook in
// draw order, and `roomImages` lists every image a room can show (its usage `props` and its `state:` preload). It adds
// no action, no cue and no gating read. Explore-ui chunk code (the `rules-lazy` arch rule): rules/index.ts builds the
// entry from these function declarations, and the registry is read only inside function bodies. Pure.
import { hotspotKey, own, worldIndex } from '../../explore/reduce.ts';
import type { WorldState } from '../../explore/state.ts';
import type { PropId } from '../../story/staging.ts';
import type { RoomId } from '../../world/types.ts';
import type { AnchorKey, FactAtom, KernelWorld, PropView, RulesRegistry, StateName } from '../contract.ts';
import type { IsRule, StateArt } from '../data/visual.ts';
import { holds } from './conditions.ts';
import { MECHANIC_RULES } from './index.ts';

/** The module enables no action: its states follow the kernel's facts. */
export type VisualAction = never;

const DEFAULT = 'default' as StateName;
const NO_STATES: Readonly<Record<StateName, StateArt>> = {};
const NO_RULES: readonly IsRule[] = [];

/** The first rule whose `when` holds names the state; none: `default`. */
function stateOf(w: KernelWorld, s: WorldState, is: readonly IsRule[]): StateName {
  return is.find((r) => holds(w, s, r.when))?.state ?? DEFAULT;
}

/** The anchor's view in `state`: a `{ prop }` state replaces the base; a `{ patch, rect }` state keeps it under the patch. */
function viewOf(at: AnchorKey, state: StateName, base: PropId | null, states: Readonly<Record<StateName, StateArt>>, rect: PropView['rect'], z: number): PropView {
  const art = state === DEFAULT ? undefined : own(states, state);
  if (art !== undefined && 'patch' in art) {
    return { at, state, prop: base, patch: { prop: art.patch, rect: art.rect }, rect, z };
  }
  return { at, state, prop: art === undefined ? base : art.prop, patch: null, rect, z };
}

/** `visual`'s share of the room's picture: its hotspots with a picture at z 0, in hotspot order, then its decor. */
export function visuals(w: KernelWorld, s: WorldState, room: RoomId): readonly PropView[] {
  const r = worldIndex(w).rooms.get(room)?.room;
  if (r === undefined) {
    return [];
  }
  const d = w.mods.visual;
  const out: PropView[] = [];
  for (const h of r.hotspots) {
    if (h.kind !== 'take' && h.kind !== 'object') {
      continue;
    }
    const key = hotspotKey(room, h.id);
    const v = own(d.hotspots, key);
    if ((h.prop === null && v === undefined) || (h.kind === 'take' && s.taken.includes(key))) {
      continue;
    }
    const states = v?.states ?? NO_STATES;
    out.push(viewOf(key as string as AnchorKey, stateOf(w, s, v?.is ?? NO_RULES), h.prop, states, h.rect, 0)); // a hotspot key is an anchor key
  }
  for (const x of own(d.decor, room) ?? []) {
    out.push(viewOf(`${room}~${x.id}` as AnchorKey, stateOf(w, s, x.is), x.prop, x.states, x.rect, x.z)); // `<room>~<decor>`
  }
  return out;
}

/** The room's picture: every module's `visuals` hook, stably sorted by `z`, which is the draw order (back to front). */
export function visualsOf(w: KernelWorld, s: WorldState, room: RoomId): readonly PropView[] {
  const rules: RulesRegistry = MECHANIC_RULES;
  return rules.flatMap((m) => m.visuals?.(w, s, room) ?? []).sort((a, b) => a.z - b.z);
}

/** Every picture of an art table: each `{ prop }` that draws, each patch. */
function artImages(states: Readonly<Record<StateName, StateArt>>): PropId[] {
  return Object.values(states).flatMap((a) => ('patch' in a ? [a.patch] : a.prop === null ? [] : [a.prop]));
}

/**
 * Every image the room can show, sorted and unique: its `take` and `object` hotspots' props with their states' props
 * and patches, and its decor's props with theirs. Static over the world (a taken take's image stays listed): it is the
 * set `emit.ts` writes as the room's usage `props` and the controller preloads under `state:<room>`.
 */
export function roomImages(w: KernelWorld, room: RoomId): readonly PropId[] {
  const r = worldIndex(w).rooms.get(room)?.room;
  if (r === undefined) {
    return [];
  }
  const d = w.mods.visual;
  const out = new Set<PropId>();
  for (const h of r.hotspots) {
    if (h.kind !== 'take' && h.kind !== 'object') {
      continue;
    }
    if (h.prop !== null) {
      out.add(h.prop);
    }
    artImages(own(d.hotspots, hotspotKey(room, h.id))?.states ?? NO_STATES).forEach((p) => out.add(p));
  }
  for (const x of own(d.decor, room) ?? []) {
    out.add(x.prop);
    artImages(x.states).forEach((p) => out.add(p));
  }
  return [...out].sort();
}

/** No action: a state changes only when the kernel's facts do. */
export function visualActions(): readonly VisualAction[] {
  return [];
}

/** Never called: the module has no action kind. */
export function applyVisual(): void {}

/** None: an `is` is a visual condition, never gating (§4 "Two scopes"). */
export function visualReads(): readonly FactAtom[] {
  return [];
}
