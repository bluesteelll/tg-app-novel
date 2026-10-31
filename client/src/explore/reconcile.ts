// Saves across story updates (docs/PUZZLES-PLAN.md X9): reconcile a loaded world state with the current world, the
// one section search shared with the build's soft-lock checker, and the guarded section entry. Never throws on save
// data. Pure (X4).
import type { KnotName, PuzzleLocalId, SectionId } from '../story/staging.ts';
import type { Effect, HotspotKey, ItemId, RoomId, WorldPublic, WorldPublicBody } from '../world/types.ts';
import { RESUME_STATE_CAP, lockOf, reduce, sectionKey, sectionScope, successors, worldIndex } from './reduce.ts';
import type { ExploreAction, ExploreEffect, Successor, WorldIndex } from './reduce.ts';
import type { PuzzleRun, WorldState } from './state.ts';

/** A record's own entries keyed by its id brand (a save's keys are checked against the world before any use). */
function entriesOf<K extends string, V>(r: Readonly<Record<K, V>>): Array<[K, V]> {
  return Object.entries(r) as Array<[K, V]>; // keys of a WorldState record are ids of their kind
}

function outside<T extends string>(list: readonly T[], keys: ReadonlySet<T>): T[] {
  return list.filter((x) => !keys.has(x));
}

/**
 * Restarts section S: every key of S's rooms and hotspots leaves taken / examined / open / slots / fired / visited,
 * the runs of S's lock puzzles and the items and docs S gives are removed, `section` and `room` become null,
 * `lastRoom[S]` and `pendingStory` are cleared, and S leaves `unproved`. Callers pass a state whose section is S or
 * null, so the cleared `section` / `room` / `pendingStory` are never another section's.
 */
export function resetSection(w: WorldPublicBody, s: WorldState, section: SectionId): WorldState {
  const scope = sectionScope(w, section);
  const slots: Record<HotspotKey, ReadonlyArray<ItemId | null>> = {};
  for (const [key, cells] of entriesOf(s.slots)) {
    if (!scope.hotspots.has(key)) {
      slots[key] = cells;
    }
  }
  const dropRuns = new Set<PuzzleLocalId>(scope.puzzles);
  const puzzles: Record<PuzzleLocalId, PuzzleRun> = {};
  for (const [p, run] of entriesOf(s.puzzles)) {
    if (!dropRuns.has(p)) {
      puzzles[p] = run;
    }
  }
  const lastRoom: Record<SectionId, RoomId> = {};
  for (const [sid, rid] of entriesOf(s.lastRoom)) {
    if (sid !== section) {
      lastRoom[sid] = rid;
    }
  }
  return {
    ...s,
    section: null,
    room: null,
    lastRoom,
    visited: outside(s.visited, scope.rooms),
    held: outside(s.held, scope.items),
    used: outside(s.used, scope.items),
    docs: outside(s.docs, scope.docs),
    taken: outside(s.taken, scope.hotspots),
    examined: outside(s.examined, scope.hotspots),
    slots,
    open: outside(s.open, scope.hotspots),
    fired: outside(s.fired, scope.fired),
    pendingStory: [],
    puzzles,
    unproved: s.unproved.filter((x) => x !== section),
  };
}

function enter(section: SectionId): ExploreAction {
  return { kind: 'enter-section', section };
}

/** `reduce(w, resetSection(w, s, S), enter-section S).state`: the start of both searches (build: s = empty). */
export function sectionEntry(w: WorldPublicBody, s: WorldState, section: SectionId): WorldState {
  return reduce(w, resetSection(w, s, section), enter(section)).state;
}

export type SearchOptions = {
  /** Stop with 'found' when a state with this `sectionKey` is discovered. */
  readonly target?: string;
  /**
   * Every edge: `from` and `to` are discovery indices (0 = start); `to` is null for a `leaves` successor, which is a
   * goal edge and never enqueued; `isNew` marks the edge that discovered `to`.
   */
  readonly onEdge?: (from: number, succ: Successor, to: number | null, isNew: boolean) => void;
};
export type SearchResult = { readonly result: 'found' | 'exhausted' | 'cap'; readonly states: number };

/**
 * THE section search of the soft-lock checker and the resume (X9 "one cap"): a BFS over `successors` from `start`,
 * deduplicated by `sectionKey(S)`. Discovering a (cap+1)-th distinct state stops with 'cap', so the runtime never
 * searches past a count the build accepted.
 */
export function searchSection(w: WorldPublicBody, start: WorldState, section: SectionId, cap: number, opts: SearchOptions = {}): SearchResult {
  const seen = new Map<string, number>();
  const queue: WorldState[] = [start];
  const startKey = sectionKey(w, start, section);
  seen.set(startKey, 0);
  if (startKey === opts.target) {
    return { result: 'found', states: 1 };
  }
  for (let from = 0; from < queue.length; from++) {
    const state = queue[from];
    if (state === undefined) {
      break;
    }
    for (const succ of successors(w, state)) {
      if (succ.leaves) {
        opts.onEdge?.(from, succ, null, false);
        continue;
      }
      const key = sectionKey(w, succ.state, section);
      const known = seen.get(key);
      if (known !== undefined) {
        opts.onEdge?.(from, succ, known, false);
        continue;
      }
      if (seen.size + 1 > cap) {
        return { result: 'cap', states: seen.size };
      }
      const to = seen.size;
      seen.set(key, to);
      queue.push(succ.state);
      opts.onEdge?.(from, succ, to, true);
      if (key === opts.target) {
        return { result: 'found', states: seen.size };
      }
    }
  }
  return { result: 'exhausted', states: seen.size };
}

/** Whether the current world can produce `s` from S's entry: 'yes' when the search meets `sectionKey(s)`. */
export function inSectionReach(w: WorldPublicBody, s: WorldState, section: SectionId, cap: number): 'yes' | 'no' | 'cap' {
  const r = searchSection(w, sectionEntry(w, s, section), section, cap, { target: sectionKey(w, s, section) });
  return r.result === 'found' ? 'yes' : r.result === 'cap' ? 'cap' : 'no';
}

/**
 * X9 step 5, the explore controller's only way to enter a section. S not in `unproved`: plain `reduce`. Otherwise
 * enter with `reduce` and search the entered state: 'yes' keeps it, 'no' / 'cap' restarts S (a `reset` effect,
 * then `sectionEntry` and its entry effects). S leaves `unproved` either way.
 */
export function admitSection(w: WorldPublicBody, s: WorldState, section: SectionId): { state: WorldState; effects: ExploreEffect[] } {
  const entered = reduce(w, s, enter(section));
  if (!s.unproved.includes(section)) {
    return entered;
  }
  if (inSectionReach(w, entered.state, section, RESUME_STATE_CAP) === 'yes') {
    const state = { ...entered.state, unproved: entered.state.unproved.filter((x) => x !== section) };
    const dirty = entered.effects.some((e) => e.kind === 'dirty');
    return { state, effects: dirty ? entered.effects : [...entered.effects, { kind: 'dirty' }] };
  }
  const restarted = reduce(w, resetSection(w, s, section), enter(section));
  return { state: restarted.state, effects: [{ kind: 'reset', section }, ...restarted.effects] };
}

/** The effects of the trigger a `fired` entry records, or undefined when the current world has no such trigger. */
function triggerOf(ix: WorldIndex, fired: string): readonly Effect[] | undefined {
  const colon = fired.indexOf(':');
  const kind = fired.slice(0, colon);
  const target = fired.slice(colon + 1);
  // Lookup keys only: a target the world does not have misses.
  const hotspot = ix.hotspots.get(target as HotspotKey)?.hotspot;
  switch (kind) {
    case 'enter':
      return ix.rooms.get(target as RoomId)?.room.onEnter;
    case 'then':
      return hotspot === undefined || hotspot.kind === 'exit' ? undefined : hotspot.then;
    case 'open':
      return hotspot === undefined ? undefined : lockOf(hotspot)?.onOpen;
    case 'fail':
      return hotspot === undefined ? undefined : lockOf(hotspot)?.onFail;
    default:
      return undefined;
  }
}

/** Steps 1-3: drop the ids the world no longer has, fit the slots to the current locks, re-arm lost gifts. */
function normalize(w: WorldPublicBody, s: WorldState, knots: ReadonlySet<KnotName>, dropped: string[]): WorldState {
  const ix = worldIndex(w);
  const keep = <T extends string>(field: string, list: readonly T[], ok: (x: T) => boolean): T[] =>
    list.filter((x) => {
      const known = ok(x);
      if (!known) {
        dropped.push(`${field}:${x}`);
      }
      return known;
    });
  const hasLock = (key: HotspotKey): boolean => {
    const entry = ix.hotspots.get(key);
    return entry !== undefined && lockOf(entry.hotspot) !== null;
  };

  // 1. Unknown ids.
  let held = keep('held', s.held, (i) => ix.items.has(i));
  let used = keep('used', s.used, (i) => ix.items.has(i));
  const docs = keep('docs', s.docs, (d) => ix.docs.has(d));
  let taken = keep('taken', s.taken, (key) => ix.hotspots.get(key)?.hotspot.kind === 'take');
  const examined = keep('examined', s.examined, (key) => ix.hotspots.has(key));
  const open = keep('open', s.open, hasLock);
  let fired = keep('fired', s.fired, (f) => triggerOf(ix, f) !== undefined);
  const visited = keep('visited', s.visited, (r) => ix.rooms.has(r));
  const pendingStory = keep('pendingStory', s.pendingStory, (knot) => knots.has(knot));
  const puzzles: Record<PuzzleLocalId, PuzzleRun> = {};
  for (const [p, run] of entriesOf(s.puzzles)) {
    if (ix.puzzles.has(p)) {
      puzzles[p] = run;
    } else {
      dropped.push(`puzzles:${p}`);
    }
  }
  const lastRoom: Record<SectionId, RoomId> = {};
  for (const [sid, rid] of entriesOf(s.lastRoom)) {
    if (ix.rooms.get(rid)?.section === sid) {
      lastRoom[sid] = rid;
    } else {
      dropped.push(`lastRoom:${sid}`);
    }
  }
  let section = s.section;
  let room = s.room;
  const current = section === null ? undefined : ix.sections.get(section);
  if (section !== null && current === undefined) {
    dropped.push(`section:${section}`);
    section = null;
  }
  if (current !== undefined && section !== null) {
    if (room === null || ix.rooms.get(room)?.section !== section) {
      if (room !== null) {
        dropped.push(`room:${room}`);
      }
      room = current.start; // a missing current room falls back to the section start
    }
  } else if (room !== null && !ix.rooms.has(room)) {
    dropped.push(`room:${room}`);
    room = null;
  }

  // 2. Slot shape: a filled item stays only where the slot at that index still accepts it; every other one, and
  // every item of a lock that lost its slots, goes used → held.
  const giveBack = (item: ItemId | null): void => {
    if (item !== null && ix.items.has(item)) {
      used = used.filter((x) => x !== item);
      held = held.includes(item) ? held : [...held, item];
    }
  };
  const slots: Record<HotspotKey, ReadonlyArray<ItemId | null>> = {};
  for (const [key, cells] of entriesOf(s.slots)) {
    const entry = ix.hotspots.get(key);
    const lock = entry === undefined ? null : lockOf(entry.hotspot);
    if (lock === null) {
      dropped.push(`slots:${key}`);
      cells.forEach(giveBack);
      continue;
    }
    if (open.includes(key)) {
      slots[key] = cells;
      continue;
    }
    const fitted = lock.slots.map((slot, i) => {
      const item = cells[i] ?? null;
      return item !== null && slot.accepts === item && ix.items.has(item) ? item : null;
    });
    cells.forEach((item, i) => {
      if (item !== null && fitted[i] !== item) {
        giveBack(item);
      }
    });
    if (fitted.some((c) => c !== null)) {
      slots[key] = fitted;
    }
  }

  // 3. Gifts: a take or a fired trigger whose item or doc is in none of held / used / docs gives again.
  const obtained = (item: ItemId): boolean => held.includes(item) || used.includes(item);
  taken = taken.filter((key) => {
    const h = ix.hotspots.get(key)?.hotspot;
    if (h === undefined || h.kind !== 'take') {
      return false;
    }
    return 'item' in h.gives ? obtained(h.gives.item) : docs.includes(h.gives.doc);
  });
  fired = fired.filter((f) => (triggerOf(ix, f) ?? []).every((e) => !('give' in e) || obtained(e.give)));

  return { ...s, section, room, lastRoom, visited, held, used, docs, taken, examined, slots, open, fired, pendingStory, puzzles };
}

/**
 * The load-time reconcile of X9. The same world version → the state unchanged (the same object). Otherwise steps
 * 1-3 (`normalize`), step 4 (the current section is kept only if the current world can produce it from the section's
 * entry; else it restarts and `reset` names it), and step 5 (every other section joins `unproved`, proved at its
 * next entry by `admitSection`). `dropped` lists every `<field>:<id>` the world no longer has.
 */
export function reconcile(
  w: WorldPublic,
  s: WorldState,
  knots: ReadonlySet<KnotName>,
  savedVersion: string | null,
): { state: WorldState; dropped: string[]; reset: SectionId | null } {
  if (savedVersion === w.version) {
    return { state: s, dropped: [], reset: null };
  }
  const dropped: string[] = [];
  let state = normalize(w, s, knots, dropped);
  const current = state.section;
  let reset: SectionId | null = null;
  if (current !== null && inSectionReach(w, state, current, RESUME_STATE_CAP) !== 'yes') {
    state = resetSection(w, state, current);
    reset = current;
  }
  const unproved = [...worldIndex(w).sections.keys()].filter((sid) => sid !== current).sort();
  return { state: { ...state, unproved }, dropped, reset };
}
