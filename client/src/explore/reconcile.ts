// Saves across story updates (docs/PUZZLES-PLAN.md X9): reconcile a loaded world state with the current world at the
// load (steps 0-3, every section unproved). Engine code: the section search and the guarded section entries that
// prove a section at its first entry are the rules half (mechanics/rules/search.ts, engine plan §3.4). Never throws
// on save data. Pure (X4).
import type { TriggerRan } from '../mechanics/contract.ts';
import { MECHANIC_DATA } from '../mechanics/data/index.ts';
import type { KnotName, PuzzleLocalId, SectionId } from '../story/staging.ts';
import type { Effect, HotspotKey, ItemId, RoomId, WorldPublic, WorldPublicBody } from '../world/types.ts';
import { lockOf, runOf, worldIndex } from './reduce.ts';
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

/** A kernel effect, by key. The definition is the runner's `isKernelEffect` (mechanics/rules/writer.ts), which the
 *  engine half cannot import (the rules-lazy arch rule). */
const isKernelEffect = (e: Effect): boolean => 'give' in e || 'unlock' in e || 'story' in e;

/**
 * Whether trigger T has run in `s`, the post-step-3 state (GM5f D6'): its `fired` key is in `s`, or T has no kernel
 * effect in the current world (by key: the proof form keeps a module's raw entry in the kernel list) and the fact its
 * own event writes holds. Each such fact has one writer, which fires T in the same dispatch (mechanics/rules/core.ts,
 * writer.ts `openKey`), so it proves the run: `visited` for `enter:<room>`, `examined` for a look's `then`, `taken` for
 * a take's (a take step 3 re-armed is no longer taken), `open` for `open:<key>`, its puzzle's failed outcome for
 * `fail:<key>`. An object's `then` has no such fact: an `unlock` opens an object without it. A trigger with a kernel
 * effect follows its record alone: step 3 un-fires one to re-give its gift while its event fact stays.
 */
function triggerRan(ix: WorldIndex, s: WorldState): TriggerRan {
  return (trigger) => {
    if (s.fired.includes(trigger)) {
      return true;
    }
    const effects = triggerOf(ix, trigger);
    if (effects === undefined || effects.some(isKernelEffect)) {
      return false;
    }
    const colon = trigger.indexOf(':');
    const target = trigger.slice(colon + 1);
    // Lookup keys only: a room id misses the hotspots, and every fact list holds ids of its own kind.
    const h = ix.hotspots.get(target as HotspotKey)?.hotspot;
    switch (trigger.slice(0, colon)) {
      case 'enter':
        return s.visited.includes(target as RoomId);
      case 'then':
        if (h?.kind === 'look') {
          return s.examined.includes(target as HotspotKey);
        }
        return h?.kind === 'take' && s.taken.includes(target as HotspotKey);
      case 'open':
        return s.open.includes(target as HotspotKey);
      case 'fail': {
        const p = h === undefined ? null : (lockOf(h)?.puzzle ?? null);
        return p !== null && ix.puzzleLock.get(p) === target && runOf(s, p).outcome === 'failed';
      }
      default:
        return false;
    }
  };
}

/** `id` through one rename map: its own entry (a map is a plain object and `constructor` is an id), else `id`. */
function renamedId<K extends string>(map: Readonly<Record<K, K>> | undefined, id: K): K {
  return map !== undefined && Object.hasOwn(map, id) ? (map[id] ?? id) : id;
}

/**
 * The items of cells that went (a lost lock, a cell that no longer fits, a slot key a rename merged away) go used →
 * held in order, but one a kept cell still holds stays used: two cells can hold one id (a rename merged two items onto
 * one, step 0, or the world gives the item twice), and a give-back never takes an item out of a lock that keeps it.
 */
function giveBack(
  held: readonly ItemId[],
  used: readonly ItemId[],
  back: ReadonlyArray<ItemId | null>,
  slots: Readonly<Record<HotspotKey, ReadonlyArray<ItemId | null>>>,
): { held: ItemId[]; used: ItemId[] } {
  const kept = new Set(Object.values(slots).flat());
  const out = { held: [...held], used: [...used] };
  for (const item of back) {
    if (item !== null && !kept.has(item)) {
      out.used = out.used.filter((x) => x !== item);
      out.held = out.held.includes(item) ? out.held : [...out.held, item];
    }
  }
  return out;
}

/**
 * Step 0 (engine plan §5.3): every id the state holds, through the world's `renamed` map, which the build resolved to
 * final targets, so one lookup per id. A hotspot moves by its own entry only (a room's rename carries none of its
 * hotspots, so a room merged into a live one never lands on that room's hotspots). The lists stay sets in
 * first-occurrence order; of two saved keys that land on one, the first in save order stays and the other goes to
 * `dropped`, a dropped slot's items back to held through `giveBack`, as normalize's. An item merge never puts one item
 * in a lock and in hand: a held id the map merges with a different id `used` holds goes to `dropped` (the lock keeps
 * the item); one id the save has in both lists stays in both (a world that gives the item twice), unless a different
 * `used` id merges onto it too, which drops it from `held` as above. Puzzle keys stay (R-E4, per-player GM6c1b);
 * `unproved` is replaced right after. A world without `renamed`: the state itself.
 */
function renameIds(w: WorldPublicBody, s: WorldState, dropped: string[]): WorldState {
  const r = w.renamed;
  if (r === undefined) {
    return s;
  }
  const ids = <K extends string>(map: Readonly<Record<K, K>> | undefined, list: readonly K[]): K[] => [...new Set(list.map((x) => renamedId(map, x)))];
  const used = ids(r.items, s.used);
  const held = ids(
    r.items,
    s.held.filter((x) => {
      // Only an overlap the map made: one id saved in both lists is a world's second copy, kept as the save has it.
      const to = renamedId(r.items, x);
      const merged = s.used.some((u) => u !== x && renamedId(r.items, u) === to);
      if (merged) {
        dropped.push(`held:${x}`);
      }
      return !merged;
    }),
  );
  const slots: Record<HotspotKey, ReadonlyArray<ItemId | null>> = {};
  const back: Array<ItemId | null> = [];
  for (const [key, cells] of entriesOf(s.slots)) {
    const to = renamedId(r.hotspots, key);
    const items = cells.map((c) => (c === null ? null : renamedId(r.items, c)));
    if (Object.hasOwn(slots, to)) {
      dropped.push(`slots:${key}`);
      back.push(...items);
    } else {
      slots[to] = items;
    }
  }
  const lastRoom: Record<SectionId, RoomId> = {};
  for (const [sid, rid] of entriesOf(s.lastRoom)) {
    const to = renamedId(r.sections, sid);
    if (Object.hasOwn(lastRoom, to)) {
      dropped.push(`lastRoom:${sid}`);
    } else {
      lastRoom[to] = renamedId(r.rooms, rid);
    }
  }
  const trigger = (f: string): string => {
    const colon = f.indexOf(':');
    const kind = colon < 0 ? '' : f.slice(0, colon);
    const target = f.slice(colon + 1);
    switch (kind) {
      case 'enter':
        return `enter:${renamedId(r.rooms, target as RoomId)}`; // a kernel trigger's target, matched by its id below
      case 'then':
      case 'open':
      case 'fail':
        return `${kind}:${renamedId(r.hotspots, target as HotspotKey)}`; // as above: a hotspot key or a miss
      default:
        return f; // a module's trigger: its own normalize keeps or drops it
    }
  };
  return {
    ...s,
    section: s.section === null ? null : renamedId(r.sections, s.section),
    room: s.room === null ? null : renamedId(r.rooms, s.room),
    lastRoom,
    visited: ids(r.rooms, s.visited),
    ...giveBack(held, used, back, slots),
    docs: ids(r.docs, s.docs),
    taken: ids(r.hotspots, s.taken),
    examined: ids(r.hotspots, s.examined),
    slots,
    open: ids(r.hotspots, s.open),
    fired: [...new Set(s.fired.map(trigger))],
    flags: ids(r.flags, s.flags),
  };
}

/**
 * Steps 1-3: drop the ids the world no longer has, fit the slots to the current locks, re-arm lost gifts. A run goes
 * whole: its `work` stays with a puzzle the world keeps and goes with one it lost (engine plan §5.2). `flags` pass
 * unchanged: each data module's own `normalize` runs right after (`reconcile`), the flags module's among them.
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
  // every item of a lock that lost its slots, goes used → held (`giveBack`: not one a kept cell still holds).
  const back: Array<ItemId | null> = [];
  const slots: Record<HotspotKey, ReadonlyArray<ItemId | null>> = {};
  for (const [key, cells] of entriesOf(s.slots)) {
    const entry = ix.hotspots.get(key);
    const lock = entry === undefined ? null : lockOf(entry.hotspot);
    if (lock === null) {
      dropped.push(`slots:${key}`);
      back.push(...cells);
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
    back.push(...cells.filter((item, i) => fitted[i] !== item));
    if (fitted.some((c) => c !== null)) {
      slots[key] = fitted;
    }
  }
  ({ held, used } = giveBack(held, used, back.filter((item) => item !== null && ix.items.has(item)), slots));

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
 * The load-time reconcile of X9. The same world version → the state unchanged (the same object). Otherwise step 0
 * (`renameIds`), steps 1-3 (`normalize`), then each data module's `normalize` in `MECHANIC_DATA` order (GM5f D5: a
 * module's own facts, read against the kernel's result and `triggerRan` over it; flags' keeps the declared flags and
 * re-arms one a setter of which has run), and step 5: every section joins `unproved`, the current one included.
 * Step 4 runs at each section's first entry instead (engine plan §3.4), through `admitSection`, or `admitEvent` when
 * an event knot is pending, so the load searches nothing and `reset` is always null. `dropped` lists every
 * `<field>:<id>` the world no longer has, every key a rename merged away and every held id a rename merged onto an
 * item a lock holds, then each module's drops (`flags:<id>`, an undeclared flag); a kept run's `work` passes unchanged
 * (engine plan §5.2).
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
  let state = normalize(w, renameIds(w, s, dropped), knots, dropped);
  const ix = worldIndex(w);
  const ran = triggerRan(ix, state);
  for (const m of MECHANIC_DATA) {
    state = m.normalize(w, state, dropped, ran);
  }
  const unproved = [...ix.sections.keys()].sort();
  return { state: { ...state, unproved }, dropped, reset: null };
}
