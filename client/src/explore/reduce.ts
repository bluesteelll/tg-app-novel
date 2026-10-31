// The one writer of WorldState during play, the successor relation and the section key (docs/PUZZLES-PLAN.md
// "World state and the reducer contract", X3, X4, X9). Pure: the runtime, the soft-lock checker and the seeded
// playthroughs call these same functions, so the build proves the rules the player runs.
//
// An action that changes no state returns the same state object and no `dirty`, but keeps the effects its rule emits
// (a lock panel, a reopened puzzle, a re-read text, a resume `room`, `refused`). A change ends with exactly one
// `dirty`. A reference the story gate would reject (a missing room, item or hotspot) makes the action a no-op, never
// a throw.
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
 * Bumped by hand on any edit that can change `actions`, `successors`, `sectionKey` or the search in reconcile.ts;
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

export type ExploreEffect =
  /** GameSession builds the room batch from it. */
  | { kind: 'room'; room: RoomId; sfx: SfxId | null }
  | { kind: 'look'; text: WorldText }
  | { kind: 'got'; gift: Gift }
  /** Open the lock panel. */
  | { kind: 'lock'; hotspot: HotspotKey }
  | { kind: 'puzzle'; puzzle: PuzzleLocalId; hotspot: HotspotKey }
  /** Run an event knot (ink); the rooms are suspended. */
  | { kind: 'story'; knot: KnotName }
  /** Leave the section into the story. */
  | { kind: 'leave'; knot: KnotName }
  | { kind: 'refused'; reason: 'no-fit' }
  /** admitSection restarted the section (a toast); never emitted by reduce. */
  | { kind: 'reset'; section: SectionId }
  /** The state changed: a debounced autosave. */
  | { kind: 'dirty' };

export type Step = ExploreAction | { kind: 'closed'; puzzle: PuzzleLocalId };
/** One edge of the successor relation; `leaves` marks a step whose effects hold a `leave`. */
export type Successor = { step: Step; state: WorldState; leaves: boolean };

// ---------------------------------------------------------------------------------------------------------------
// World lookups (built once per world object; Maps, so a world id such as `constructor` is never Object.prototype's)

type HotspotEntry = { readonly key: HotspotKey; readonly room: RoomId; readonly section: SectionId; readonly hotspot: Hotspot };

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
function own<K extends string, V>(r: Readonly<Record<K, V>>, k: K): V | undefined {
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
// The reducer

type Draft = { s: WorldState; readonly effects: ExploreEffect[]; readonly ix: WorldIndex };

const NO_RUN: PuzzleRun = Object.freeze({ outcome: null, attempts: 0, hintsOpened: 0 });

function added<T>(list: readonly T[], v: T): readonly T[] {
  return list.includes(v) ? list : [...list, v];
}

function removed<T>(list: readonly T[], v: T): readonly T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : list;
}

/** Replaces one field, and the state object only when the value differs (a no-op keeps the same object). */
function set<K extends keyof WorldState>(d: Draft, key: K, value: WorldState[K]): void {
  if (d.s[key] !== value) {
    d.s = { ...d.s, ...({ [key]: value } as Pick<WorldState, K>) }; // the one key K, holding a WorldState[K]
  }
}

function runOf(s: WorldState, p: PuzzleLocalId): PuzzleRun {
  return own(s.puzzles, p) ?? NO_RUN;
}

function setRun(d: Draft, p: PuzzleLocalId, run: PuzzleRun): void {
  set(d, 'puzzles', { ...d.s.puzzles, [p]: run });
}

function cellsOf(s: WorldState, key: HotspotKey, lock: Lock): Array<ItemId | null> {
  const stored = own(s.slots, key);
  return lock.slots.map((_, i) => stored?.[i] ?? null);
}

/** Every trigger fires at most once; an empty one is never recorded, so it adds no state. */
function fire(d: Draft, firedKey: string, effects: readonly Effect[]): void {
  if (effects.length === 0 || d.s.fired.includes(firedKey)) {
    return;
  }
  set(d, 'fired', [...d.s.fired, firedKey]);
  for (const e of effects) {
    if ('give' in e) {
      if (d.ix.items.has(e.give)) {
        set(d, 'held', added(d.s.held, e.give));
        d.effects.push({ kind: 'got', gift: { item: e.give } });
      }
    } else if ('unlock' in e) {
      openKey(d, e.unlock);
    } else {
      set(d, 'pendingStory', [...d.s.pendingStory, e.story]);
    }
  }
}

/** A key entering `open` runs its lock's `onOpen` once, whatever the cause. */
function openKey(d: Draft, key: HotspotKey): void {
  const entry = d.ix.hotspots.get(key);
  const lock = entry === undefined ? null : lockOf(entry.hotspot);
  if (lock === null || d.s.open.includes(key)) {
    return;
  }
  set(d, 'open', [...d.s.open, key]);
  fire(d, `open:${key}`, lock.onOpen);
}

/**
 * The opening action happened at this hotspot (its last insert, its puzzle solved): `onOpen`, then an object's
 * `then` at once. After a remote `unlock` an object's `then` waits for the next tap instead.
 */
function openAt(d: Draft, key: HotspotKey, hotspot: Hotspot): void {
  openKey(d, key);
  if (hotspot.kind === 'object') {
    fire(d, `then:${key}`, hotspot.then);
  }
}

function arrive(d: Draft, room: RoomId, sfx: SfxId | null): void {
  const entry = d.ix.rooms.get(room);
  const section = d.s.section;
  if (entry === undefined || section === null) {
    return;
  }
  set(d, 'room', room);
  if (own(d.s.lastRoom, section) !== room) {
    set(d, 'lastRoom', { ...d.s.lastRoom, [section]: room });
  }
  set(d, 'visited', added(d.s.visited, room));
  d.effects.push({ kind: 'room', room, sfx });
  fire(d, `enter:${room}`, entry.room.onEnter);
}

function enterSection(d: Draft, sid: SectionId): void {
  const section = d.ix.sections.get(sid);
  if (section === undefined) {
    return;
  }
  if (d.s.section === sid && d.s.room !== null) {
    d.effects.push({ kind: 'room', room: d.s.room, sfx: null }); // a resume
    return;
  }
  const last = own(d.s.lastRoom, sid);
  const room = last !== undefined && d.ix.rooms.get(last)?.section === sid ? last : section.start;
  if (!d.ix.rooms.has(room)) {
    return;
  }
  set(d, 'section', sid);
  arrive(d, room, null);
}

function eventReturned(d: Draft, sid: SectionId): void {
  if (d.s.pendingStory.length === 0 || d.s.section !== sid) {
    return;
  }
  const rest = d.s.pendingStory.slice(1);
  set(d, 'pendingStory', rest);
  const next = rest[0];
  if (next !== undefined) {
    d.effects.push({ kind: 'story', knot: next });
  } else if (d.s.room !== null) {
    d.effects.push({ kind: 'room', room: d.s.room, sfx: null });
  }
}

/** The hotspot when it is in the current room of a current section and no event knot runs; else undefined. */
function here(d: Draft, key: HotspotKey): HotspotEntry | undefined {
  if (d.s.section === null || d.s.room === null || d.s.pendingStory.length > 0) {
    return undefined;
  }
  const entry = d.ix.hotspots.get(key);
  return entry !== undefined && entry.room === d.s.room ? entry : undefined;
}

/** A tap on a locked hotspot: its puzzle when every slot is filled and the run has no outcome, else the panel. */
function lockTap(d: Draft, key: HotspotKey, lock: Lock): void {
  const p = lock.puzzle;
  if (p !== null && d.ix.puzzles.has(p) && cellsOf(d.s, key, lock).every((c) => c !== null) && runOf(d.s, p).outcome === null) {
    d.effects.push({ kind: 'puzzle', puzzle: p, hotspot: key });
  } else {
    d.effects.push({ kind: 'lock', hotspot: key });
  }
}

function tap(d: Draft, key: HotspotKey): void {
  const entry = here(d, key);
  if (entry === undefined) {
    return;
  }
  const h = entry.hotspot;
  switch (h.kind) {
    case 'look':
      d.effects.push({ kind: 'look', text: h.look });
      set(d, 'examined', added(d.s.examined, key));
      fire(d, `then:${key}`, h.then);
      return;
    case 'take': {
      if (d.s.taken.includes(key)) {
        return;
      }
      const g = h.gives;
      if ('item' in g ? !d.ix.items.has(g.item) : !d.ix.docs.has(g.doc)) {
        return;
      }
      if ('item' in g) {
        set(d, 'held', added(d.s.held, g.item));
      } else {
        set(d, 'docs', added(d.s.docs, g.doc));
      }
      set(d, 'taken', [...d.s.taken, key]);
      d.effects.push({ kind: 'got', gift: g });
      fire(d, `then:${key}`, h.then);
      return;
    }
    case 'exit':
      if (h.lock !== null && !d.s.open.includes(key)) {
        lockTap(d, key, h.lock);
      } else if ('room' in h.to) {
        arrive(d, h.to.room, h.sfx);
      } else {
        // I-W's re-entry rule: a leave changes only `section` (sectionKey ignores it and lastRoom).
        set(d, 'section', null);
        d.effects.push({ kind: 'leave', knot: h.to.story });
      }
      return;
    case 'object':
      if (h.lock !== null && !d.s.open.includes(key)) {
        lockTap(d, key, h.lock);
        return;
      }
      if (h.look !== null) {
        d.effects.push({ kind: 'look', text: h.look });
      }
      fire(d, `then:${key}`, h.then);
      return;
    default: {
      const never: never = h;
      return never;
    }
  }
}

/**
 * The slot an insert fills: the first free slot of an unopened lock in the current room that accepts the held
 * item; null when the insert is refused. `actions` lists exactly the inserts this accepts.
 */
function fit(ix: WorldIndex, s: WorldState, key: HotspotKey, item: ItemId): { hotspot: Hotspot; lock: Lock; index: number } | null {
  const entry = ix.hotspots.get(key);
  if (entry === undefined || entry.room !== s.room || !s.held.includes(item) || s.open.includes(key)) {
    return null;
  }
  const lock = lockOf(entry.hotspot);
  if (lock === null) {
    return null;
  }
  const cells = cellsOf(s, key, lock);
  const index = lock.slots.findIndex((slot, i) => slot.accepts === item && cells[i] === null);
  return index === -1 ? null : { hotspot: entry.hotspot, lock, index };
}

function insert(d: Draft, key: HotspotKey, item: ItemId): void {
  if (d.s.section === null || d.s.room === null || d.s.pendingStory.length > 0) {
    return;
  }
  const f = fit(d.ix, d.s, key, item);
  if (f === null) {
    d.effects.push({ kind: 'refused', reason: 'no-fit' });
    return;
  }
  const cells = cellsOf(d.s, key, f.lock).map((c, i) => (i === f.index ? item : c));
  set(d, 'slots', { ...d.s.slots, [key]: cells });
  set(d, 'held', removed(d.s.held, item));
  set(d, 'used', added(d.s.used, item));
  if (cells.some((c) => c === null)) {
    return;
  }
  const p = f.lock.puzzle;
  if (p === null) {
    openAt(d, key, f.hotspot);
  } else if (d.ix.puzzles.has(p) && runOf(d.s, p).outcome === null) {
    d.effects.push({ kind: 'puzzle', puzzle: p, hotspot: key });
  }
}

function puzzleEnded(d: Draft, p: PuzzleLocalId, outcome: PuzzleOutcome): void {
  if (!d.ix.puzzles.has(p)) {
    return;
  }
  const key = d.ix.puzzleLock.get(p);
  const run = runOf(d.s, p);
  // A lock puzzle's outcome is final for its run, and only a linear puzzle can be abandoned (X8).
  if ((key !== undefined && (run.outcome !== null || outcome === 'abandoned')) || run.outcome === outcome) {
    return;
  }
  setRun(d, p, { ...run, outcome });
  const entry = key === undefined ? undefined : d.ix.hotspots.get(key);
  const lock = entry === undefined ? null : lockOf(entry.hotspot);
  if (entry === undefined || lock === null) {
    return;
  }
  if (outcome === 'solved') {
    openAt(d, entry.key, entry.hotspot);
  } else {
    fire(d, `fail:${entry.key}`, lock.onFail);
  }
}

function apply(d: Draft, a: ExploreAction): void {
  switch (a.kind) {
    case 'enter-section':
      return enterSection(d, a.section);
    case 'event-returned':
      return eventReturned(d, a.section);
    case 'tap':
      return tap(d, a.hotspot);
    case 'insert':
      return insert(d, a.hotspot, a.item);
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
    case 'puzzle-ended':
      return puzzleEnded(d, a.puzzle, a.outcome);
    default: {
      const never: never = a;
      return never;
    }
  }
}

/** The one writer of WorldState during play. */
export function reduce(w: WorldPublicBody, s: WorldState, a: ExploreAction): { state: WorldState; effects: ExploreEffect[] } {
  const d: Draft = { s, effects: [], ix: worldIndex(w) };
  const idle = s.pendingStory.length === 0;
  apply(d, a);
  const head = d.s.pendingStory[0];
  if (idle && head !== undefined) {
    d.effects.push({ kind: 'story', knot: head });
  }
  if (d.s !== s) {
    d.effects.push({ kind: 'dirty' });
  }
  return { state: d.s, effects: d.effects };
}

// ---------------------------------------------------------------------------------------------------------------
// The successor relation

/**
 * Every enabled player action: a tap on each hotspot of the current room except a taken `take`, and each insert
 * `reduce` would accept, while `pendingStory` is empty; only `event-returned` while it is not. Puzzle outcomes are
 * not actions here: see `successors`.
 */
export function actions(w: WorldPublicBody, s: WorldState): ExploreAction[] {
  if (s.section === null || s.room === null) {
    return [];
  }
  if (s.pendingStory.length > 0) {
    return [{ kind: 'event-returned', section: s.section }];
  }
  const ix = worldIndex(w);
  const current = s.room;
  const room = ix.rooms.get(current);
  if (room === undefined) {
    return [];
  }
  const out: ExploreAction[] = [];
  const keys: HotspotKey[] = [];
  for (const h of room.room.hotspots) {
    const key = hotspotKey(current, h.id);
    keys.push(key);
    if (!(h.kind === 'take' && s.taken.includes(key))) {
      out.push({ kind: 'tap', hotspot: key });
    }
  }
  // Sorted, so two states that differ only in the order items were taken list the same actions.
  const held = [...s.held].sort();
  for (const key of keys) {
    for (const item of held) {
      if (fit(ix, s, key, item) !== null) {
        out.push({ kind: 'insert', hotspot: key, item });
      }
    }
  }
  return out;
}

const hasLeave = (effects: readonly ExploreEffect[]): boolean => effects.some((e) => e.kind === 'leave');

/**
 * THE successor relation of the soft-lock checker, the seeded playthroughs and reconcile: every action through
 * `reduce`; an action whose effects open puzzle p expands into `closed` (the post-action state: Back, or a reload,
 * since the puzzle is an overlay) and one successor per outcome (`solved`; `failed` when p has `maxAttempts`).
 */
export function successors(w: WorldPublicBody, s: WorldState): Successor[] {
  const out: Successor[] = [];
  for (const a of actions(w, s)) {
    const r = reduce(w, s, a);
    const opened = r.effects.find((e) => e.kind === 'puzzle');
    if (opened === undefined) {
      out.push({ step: a, state: r.state, leaves: hasLeave(r.effects) });
      continue;
    }
    const puzzle = opened.puzzle;
    out.push({ step: { kind: 'closed', puzzle }, state: r.state, leaves: false });
    const limited = (worldIndex(w).puzzles.get(puzzle)?.maxAttempts ?? null) !== null;
    const outcomes: PuzzleOutcome[] = limited ? ['solved', 'failed'] : ['solved'];
    for (const outcome of outcomes) {
      const step: ExploreAction = { kind: 'puzzle-ended', puzzle, outcome };
      const end = reduce(w, r.state, step);
      out.push({ step, state: end.state, leaves: hasLeave(end.effects) });
    }
  }
  return out;
}

function sortedIn<T extends string>(list: readonly T[], keep: ReadonlySet<T>): T[] {
  return list.filter((x) => keep.has(x)).sort();
}

/**
 * The canonical key of `s` restricted to section S, the one dedup key of both searches: room, pendingStory (an
 * ordered queue), S's keys in taken / open / slots / fired, the outcomes of S's lock puzzles, the items and docs S
 * gives in held / used / docs. The set-valued fields are sorted, so the order play added them in never splits one
 * state into two. Abstracted (read by no rule): examined, visited, attempts, hints opened; ignored: section,
 * lastRoom, unproved, everything outside S (X15).
 */
export function sectionKey(w: WorldPublicBody, s: WorldState, section: SectionId): string {
  const scope = sectionScope(w, section);
  const slots: Array<[HotspotKey, Array<ItemId | null>]> = [];
  for (const { key, lock } of scope.locks) {
    const cells = cellsOf(s, key, lock);
    if (cells.some((c) => c !== null)) {
      slots.push([key, cells]);
    }
  }
  return JSON.stringify([
    s.room,
    s.pendingStory,
    sortedIn(s.taken, scope.hotspots),
    sortedIn(s.open, scope.hotspots),
    slots,
    sortedIn(s.fired, scope.fired),
    scope.puzzles.map((p) => runOf(s, p).outcome),
    sortedIn(s.held, scope.items),
    sortedIn(s.used, scope.items),
    sortedIn(s.docs, scope.docs),
  ]);
}
