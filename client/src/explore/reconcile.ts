// Saves across story updates (docs/PUZZLES-PLAN.md X9): reconcile a loaded world state with the current world at the
// load (steps 0-3, every section unproved). Engine code: the section search and the guarded section entries that
// prove a section at its first entry are the rules half (mechanics/rules/search.ts, engine plan §3.4). Never throws
// on save data. Pure (X4).
import type { KnotName, PuzzleLocalId, SectionId } from '../story/staging.ts';
import type { Effect, HotspotKey, ItemId, RoomId, WorldPublic, WorldPublicBody } from '../world/types.ts';
import { lockOf, worldIndex } from './reduce.ts';
import type { WorldIndex } from './reduce.ts';
import type { PuzzleRun, WorldState } from './state.ts';

/** A record's own entries keyed by its id brand (a save's keys are checked against the world before any use). */
function entriesOf<K extends string, V>(r: Readonly<Record<K, V>>): Array<[K, V]> {
  return Object.entries(r) as Array<[K, V]>; // keys of a WorldState record are ids of their kind
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

/**
 * Steps 1-3: drop the ids the world no longer has, fit the slots to the current locks, re-arm lost gifts. A run goes
 * whole: its `work` stays with a puzzle the world keeps and goes with one it lost (engine plan §5.2). `flags` pass
 * unchanged: their drop is the flags module's own `normalize`.
 */
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
 * 1-3 (`normalize`) and step 5: every section joins `unproved`, the current one included. Step 4 runs at each
 * section's first entry instead (engine plan §3.4), through `admitSection`, or `admitEvent` when an event knot is
 * pending, so the load searches nothing and `reset` is always null. `dropped` lists every `<field>:<id>` the world
 * no longer has; a kept run's `work` and the `flags` pass unchanged (engine plan §5.2).
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
  const state = normalize(w, s, knots, dropped);
  const unproved = [...worldIndex(w).sections.keys()].sort();
  return { state: { ...state, unproved }, dropped, reset: null };
}
