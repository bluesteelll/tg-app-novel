// The kernel of the explore world (engine plan §3.2, §3.3; docs/PUZZLES-PLAN.md "World state and the reducer
// contract", X3, X4, X9): the action and effect types, the world lookups, the section scope, the constants, and the
// run reducer the engine writes a linear puzzle's run with. Engine code: the rules that write a section's state, the
// successor relation, the section key and the searches are the rules half (mechanics/rules/core.ts and search.ts),
// which only the explore controller's lazy chunk loads. Pure: the runtime and the story tool call these same
// functions.
import type { MoveHow } from '../cues/types.ts';
import type { KnotName, PuzzleLocalId, SectionId, SfxId } from '../story/staging.ts';
import type {
  DocId,
  Effect,
  Gift,
  Hotspot,
  HotspotKey,
  ItemId,
  Lock,
  PublicPuzzle,
  Room,
  RoomId,
  Section,
  WorldPublicBody,
  WorldText,
} from '../world/types.ts';
import type { PuzzleOutcome, PuzzleRun, WorldState } from './state.ts';

/** THE section cap: `world/state-cap` (build) and the resume search (runtime) use this one constant (X9). */
export const RESUME_STATE_CAP = 5_000;
/**
 * Bumped by hand on any edit that can change `actions` (mechanics/rules/core.ts), `successors`, `sectionKey` or the
 * search (mechanics/rules/search.ts);
 * the story tool folds it into every world's `version`, so a rules edit sends saves through reconcile (PE7). The
 * golden test `reduce: rules golden pinned to RULES_VERSION` fails until the bump and its new row.
 */
export const RULES_VERSION = 1;

export type ExploreAction =
  /** An explore yield with an empty `pendingStory`. */
  | { kind: 'enter-section'; section: SectionId }
  /** An explore yield with a non-empty `pendingStory`: the event knot reached its yield. */
  | { kind: 'event-returned'; section: SectionId }
  | { kind: 'tap'; hotspot: HotspotKey }
  | { kind: 'insert'; hotspot: HotspotKey; item: ItemId }
  | { kind: 'attempt-failed'; puzzle: PuzzleLocalId }
  | { kind: 'hint-opened'; puzzle: PuzzleLocalId; tier: number }
  | { kind: 'puzzle-ended'; puzzle: PuzzleLocalId; outcome: PuzzleOutcome };

// Each effect names where it acts (engine plan §6.1 "Effects grow"), so a cue built from it needs no second lookup.
export type ExploreEffect =
  /** GameSession builds the room batch from it. `from`: the room left (a resume, an event return: the room itself; a
   *  section's fresh entry: null); `via`: the exit a walk took, else null. */
  | { kind: 'room'; room: RoomId; sfx: SfxId | null; from: RoomId | null; via: HotspotKey | null; how: Exclude<MoveHow, 'leave'> }
  /** `at`: the hotspot whose text it is. */
  | { kind: 'look'; text: WorldText; at: HotspotKey }
  /** `at`: the take, or the hotspot of the trigger that gave it (null: a room's `onEnter`). */
  | { kind: 'got'; gift: Gift; at: HotspotKey | null }
  /** Open the lock panel. */
  | { kind: 'lock'; hotspot: HotspotKey }
  | { kind: 'puzzle'; puzzle: PuzzleLocalId; hotspot: HotspotKey }
  /** Run an event knot (ink); the rooms are suspended. */
  | { kind: 'story'; knot: KnotName }
  /** Leave the section into the story: `from` the room left, `via` the exit. */
  | { kind: 'leave'; knot: KnotName; from: RoomId; via: HotspotKey }
  /** An item that does not go in at `at`: no slot takes it ('no-fit') or no rule uses it ('no-rule'). */
  | { kind: 'refused'; at: HotspotKey; item: ItemId; reason: 'no-fit' | 'no-rule' }
  /** admitSection or admitEvent restarted the section (a toast); never emitted by reduce. */
  | { kind: 'reset'; section: SectionId }
  /** The state changed: a debounced autosave. */
  | { kind: 'dirty' };

export type Step = ExploreAction | { kind: 'closed'; puzzle: PuzzleLocalId };
/** One edge of the successor relation; `leaves` marks a step whose effects hold a `leave`. */
export type Successor = { step: Step; state: WorldState; leaves: boolean };

// ---------------------------------------------------------------------------------------------------------------
// World lookups (built once per world object; Maps, so a world id such as `constructor` is never Object.prototype's)

export type HotspotEntry = { readonly key: HotspotKey; readonly room: RoomId; readonly section: SectionId; readonly hotspot: Hotspot };

export type WorldIndex = {
  readonly sections: ReadonlyMap<SectionId, Section>;
  /** Rooms are unique in the chapter (`world/duplicate-id`), so the lookup is chapter-wide. */
  readonly rooms: ReadonlyMap<RoomId, { readonly section: SectionId; readonly room: Room }>;
  readonly hotspots: ReadonlyMap<HotspotKey, HotspotEntry>;
  readonly puzzles: ReadonlyMap<PuzzleLocalId, PublicPuzzle>;
  /** The one lock that carries each lock puzzle (`world/puzzle-multi-lock`); a linear puzzle has none. */
  readonly puzzleLock: ReadonlyMap<PuzzleLocalId, HotspotKey>;
  readonly items: ReadonlySet<ItemId>;
  readonly docs: ReadonlySet<DocId>;
};

/** The keys `sectionKey(S)` reads and `resetSection(S)` clears: one definition for both (X9, I-W). */
export type SectionScope = {
  readonly rooms: ReadonlySet<RoomId>;
  readonly hotspots: ReadonlySet<HotspotKey>;
  /** S's locks, sorted by key. */
  readonly locks: ReadonlyArray<{ readonly key: HotspotKey; readonly lock: Lock }>;
  /** Every `fired` entry a trigger of S can write. */
  readonly fired: ReadonlySet<string>;
  /** The puzzles attached to S's locks, sorted. */
  readonly puzzles: readonly PuzzleLocalId[];
  /** The items and docs S's hotspots and triggers give. */
  readonly items: ReadonlySet<ItemId>;
  readonly docs: ReadonlySet<DocId>;
};

const INDEX = new WeakMap<WorldPublicBody, WorldIndex>();
const SCOPES = new WeakMap<WorldPublicBody, Map<SectionId, SectionScope>>();

/** A record's own entries keyed by its id brand (the world decoder checked every key against the brand). */
function entriesOf<K extends string, V>(r: Readonly<Record<K, V>>): Array<[K, V]> {
  return Object.entries(r) as Array<[K, V]>; // the keys of a decoded record are its ids
}

/** An own-property read: a save or world id never resolves to Object.prototype's members. */
export function own<K extends string, V>(r: Readonly<Record<K, V>>, k: K): V | undefined {
  return Object.hasOwn(r, k) ? r[k] : undefined;
}

export function hotspotKey(room: RoomId, hotspot: string): HotspotKey {
  return `${room}.${hotspot}` as HotspotKey; // the `<room>.<hotspot>` shape is HotspotKey's whole contract
}

export function lockOf(h: Hotspot): Lock | null {
  return h.kind === 'exit' || h.kind === 'object' ? h.lock : null;
}

export function worldIndex(w: WorldPublicBody): WorldIndex {
  const cached = INDEX.get(w);
  if (cached !== undefined) {
    return cached;
  }
  const sections = new Map<SectionId, Section>();
  const rooms = new Map<RoomId, { section: SectionId; room: Room }>();
  const hotspots = new Map<HotspotKey, HotspotEntry>();
  const puzzleLock = new Map<PuzzleLocalId, HotspotKey>();
  for (const [sid, section] of entriesOf(w.sections)) {
    sections.set(sid, section);
    for (const [rid, room] of entriesOf(section.rooms)) {
      if (rooms.has(rid)) {
        continue; // a room id in two sections: `world/duplicate-id` rejects the world; the first one wins
      }
      rooms.set(rid, { section: sid, room });
      for (const hotspot of room.hotspots) {
        const key = hotspotKey(rid, hotspot.id);
        hotspots.set(key, { key, room: rid, section: sid, hotspot });
        const p = lockOf(hotspot)?.puzzle ?? null;
        if (p !== null && !puzzleLock.has(p)) {
          puzzleLock.set(p, key);
        }
      }
    }
  }
  const index: WorldIndex = {
    sections,
    rooms,
    hotspots,
    puzzles: new Map(entriesOf(w.puzzles)),
    puzzleLock,
    items: new Set(entriesOf(w.items).map(([id]) => id)),
    docs: new Set(entriesOf(w.docs).map(([id]) => id)),
  };
  INDEX.set(w, index);
  return index;
}

function giftsOf(effects: readonly Effect[], into: Set<ItemId>): void {
  for (const e of effects) {
    if ('give' in e) {
      into.add(e.give);
    }
  }
}

export function sectionScope(w: WorldPublicBody, section: SectionId): SectionScope {
  let perWorld = SCOPES.get(w);
  if (perWorld === undefined) {
    perWorld = new Map();
    SCOPES.set(w, perWorld);
  }
  const cached = perWorld.get(section);
  if (cached !== undefined) {
    return cached;
  }
  const ix = worldIndex(w);
  const rooms = new Set<RoomId>();
  const hotspots = new Set<HotspotKey>();
  const locks: Array<{ key: HotspotKey; lock: Lock }> = [];
  const fired = new Set<string>();
  const puzzles = new Set<PuzzleLocalId>();
  const items = new Set<ItemId>();
  const docs = new Set<DocId>();
  for (const [rid, entry] of ix.rooms) {
    if (entry.section !== section) {
      continue;
    }
    rooms.add(rid);
    fired.add(`enter:${rid}`);
    giftsOf(entry.room.onEnter, items);
    for (const h of entry.room.hotspots) {
      const key = hotspotKey(rid, h.id);
      hotspots.add(key);
      for (const kind of ['then', 'open', 'fail']) {
        fired.add(`${kind}:${key}`);
      }
      if (h.kind !== 'exit') {
        giftsOf(h.then, items);
      }
      if (h.kind === 'take') {
        if ('item' in h.gives) {
          items.add(h.gives.item);
        } else {
          docs.add(h.gives.doc);
        }
      }
      const lock = lockOf(h);
      if (lock !== null) {
        locks.push({ key, lock });
        giftsOf(lock.onOpen, items);
        giftsOf(lock.onFail, items);
        if (lock.puzzle !== null) {
          puzzles.add(lock.puzzle);
        }
      }
    }
  }
  const scope: SectionScope = {
    rooms,
    hotspots,
    locks: locks.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
    fired,
    puzzles: [...puzzles].sort(),
    items,
    docs,
  };
  perWorld.set(section, scope);
  return scope;
}

// ---------------------------------------------------------------------------------------------------------------
// The run state: the reducer's draft, the helpers the explore rules share, and the run reducer

/** A reducer's working state: `s` is replaced, never mutated, so an unchanged state stays the same object. */
export type Draft = { s: WorldState; readonly effects: ExploreEffect[]; readonly ix: WorldIndex };

const NO_RUN: PuzzleRun = Object.freeze({ outcome: null, attempts: 0, hintsOpened: 0 });

/** Replaces one field, and the state object only when the value differs (a no-op keeps the same object). */
export function set<K extends keyof WorldState>(d: Draft, key: K, value: WorldState[K]): void {
  if (d.s[key] !== value) {
    d.s = { ...d.s, ...({ [key]: value } as Pick<WorldState, K>) }; // the one key K, holding a WorldState[K]
  }
}

export function runOf(s: WorldState, p: PuzzleLocalId): PuzzleRun {
  return own(s.puzzles, p) ?? NO_RUN;
}

export function setRun(d: Draft, p: PuzzleLocalId, run: PuzzleRun): void {
  set(d, 'puzzles', { ...d.s.puzzles, [p]: run });
}

/** The actions of a puzzle's run: what a linear puzzle sends (engine plan §3.2, §3.3). */
export type RunAction = Extract<ExploreAction, { kind: 'attempt-failed' | 'hint-opened' | 'puzzle-ended' }>;

/**
 * The run rules, one definition for the explore rules (`reduce`, mechanics/rules/core.ts) and `runReduce`: a failed
 * attempt counts, hint tiers open in order, and an outcome replaces any other (the linear rule: a lock puzzle's
 * outcome is final, which core decides before it calls this). A puzzle the world lacks changes nothing.
 */
export function runStep(d: Draft, a: RunAction): void {
  switch (a.kind) {
    case 'attempt-failed':
      if (d.ix.puzzles.has(a.puzzle)) {
        const run = runOf(d.s, a.puzzle);
        setRun(d, a.puzzle, { ...run, attempts: run.attempts + 1 });
      }
      return;
    case 'hint-opened': {
      const tiers = d.ix.puzzles.get(a.puzzle)?.hintTiers ?? 0;
      const run = runOf(d.s, a.puzzle);
      // Tiers open in order, so the highest tier is the count opened; a re-read changes nothing.
      if (Number.isInteger(a.tier) && a.tier >= 1 && a.tier <= tiers && a.tier > run.hintsOpened) {
        setRun(d, a.puzzle, { ...run, hintsOpened: a.tier });
      }
      return;
    }
    case 'puzzle-ended': {
      const run = runOf(d.s, a.puzzle);
      if (d.ix.puzzles.has(a.puzzle) && run.outcome !== a.outcome) {
        setRun(d, a.puzzle, { ...run, outcome: a.outcome });
      }
      return;
    }
    default: {
      const never: never = a;
      return never;
    }
  }
}

/**
 * The engine's writer of a linear puzzle's run (app/yields.ts, while no section is current): the run rules alone, so
 * no trigger fires and no story starts; `dirty` iff the state changed. A puzzle a lock holds is the explore rules'
 * (its outcome opens or fails the lock), so here it is a no-op.
 */
export function runReduce(w: WorldPublicBody, s: WorldState, a: RunAction): { state: WorldState; effects: ExploreEffect[] } {
  const d: Draft = { s, effects: [], ix: worldIndex(w) };
  if (d.ix.puzzleLock.has(a.puzzle)) {
    return { state: s, effects: [] };
  }
  runStep(d, a);
  return { state: d.s, effects: d.s === s ? [] : [{ kind: 'dirty' }] };
}
