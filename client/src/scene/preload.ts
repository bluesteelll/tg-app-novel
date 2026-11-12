// Asset scheduling over the registry (PROTOTYPE-PLAN "Per-chapter manifest", "Preload", F4, F5; shots §5.8): the
// current chapter's manifest, id resolution (in `from` when given, so the next chapter's ids resolve in its own
// manifest), background preloads under a tag (`preload:<knot>`, `next:<chapterId>`, `room:<roomId>`, `state:<roomId>`),
// the step's window (`want`: need, warm, hope and the event's room) over one ordered queue with two fetches in flight
// (an item whose record is live or in flight to be decoded joins it at once, outside the slots: QO19, S36 step 1b), the
// eviction order of a refused need, and the blocking `ensure` of a batch's assets under the holder `ensure`. Pure over
// the registry: no Pixi, no fetch.
import type { AssetManifest, ImageEntry, Result } from '../story/catalog.ts';
import type { ShotWindow } from '../story/shots.ts';
import type { AssetId } from '../story/staging.ts';
import type { AssetError, AssetRegistry, SceneError } from './registry.ts';

/** Preload fetches in flight at once; `ensure` is not limited. */
export const PRELOAD_IN_FLIGHT = 2;
/**
 * The holder of a batch's blocking loads (D7): released once apply / restore took the slot holders, and by setChapter
 * and destroy. One name serves because GameSession's single intent queue runs one ensure at a time.
 */
export const ENSURE_HOLDER = 'ensure';

/** A step's window as the scene admits it (shots §5.8): SH3a's `ShotWindow` and the event's room, its own class. */
export type StageWindow = ShotWindow & { readonly eventRoom: readonly AssetId[] };
/** The window of a step with none of its own (no decoding `look`): it still ends the entry tag. */
export const EMPTY_WINDOW: StageWindow = { need: [], warm: [], near: 0, hope: [], eventRoom: [] };
/**
 * `window.pending`: the window's need items not live; `window.ids`: the window's ids it holds or asks for; `rooms`: the
 * `room:` tags that hold or load a record.
 */
export type WindowStats = { window: { pending: number; ids: AssetId[] }; rooms: string[] };

export interface AssetScheduler {
  /**
   * Swaps the manifest; releases every `preload:*` (the window's holders included), every `next:*` except
   * `next:<m.chapterId>`, and `ensure`. The kept tag is the entry tag: the first `want` after this releases it once its
   * files were joined (shots §5.8 step 1c).
   */
  setChapter(m: AssetManifest): void;
  resolve(id: AssetId, from?: AssetManifest): Result<ImageEntry, AssetError>;
  /**
   * Background, at preload priority; an id that does not resolve is reported and skipped. An id whose record is live or
   * in flight to be decoded joins it at once (its holder added before this returns; no slot, no byte); any other id,
   * a held file's decode included, queues for one of the PRELOAD_IN_FLIGHT slots. The tag becomes the most recently
   * requested (the order a refused need evicts EN's tags in).
   */
  preload(tag: string, ids: readonly AssetId[], from?: AssetManifest): void;
  /** Drops queued, joining and in-flight preloads of the tag and releases its holder; a trailing `:` names a family. */
  releasePreload(tag: string): void;
  /** Loads a batch's assets at visible priority; resolves once every one is live or failed. */
  ensure(ids: readonly AssetId[], signal: AbortSignal): Promise<Result<void, SceneError>>;
  /** The step's window at its swap point (shots §5.8 steps 1-7): the window's holders follow `w`. */
  want(w: StageWindow): void;
  /** Step 7 after a holder was released: the deferred need and warm items again, then the held warm files' decodes. */
  retry(): void;
  stats(): WindowStats;
  destroy(): void;
}

/** The executor's two reports (its `swapped` / `released` deps), as the scene controller wires them (D12). */
export type WindowSeat = { swapped(w: StageWindow): void; released(): void };

/** The seat: a swap is the step's `want`, a release a `retry`; nothing else. */
export function windowDeps(s: Pick<AssetScheduler, 'want' | 'retry'>): WindowSeat {
  return { swapped: (w) => s.want(w), released: () => s.retry() };
}

type Item = { readonly tag: string; readonly id: AssetId; readonly entry: ImageEntry; readonly rank: number };
type Flight = Item & { readonly controller: AbortController };

/** A window holder: a need, hope or event-room item, or a warm file's decode (`preload:` family, so setChapter ends it). */
const WIN = 'preload:win:';
/** A warm file's held bytes. */
const WARM = 'preload:warm:';
// The one ordered queue (shots §5.8 step 5): rank first, then the order asked.
const NEED = 0;
const NEAR = 1;
const TAG = 2;
const FAR = 3;
const DECODE = 4;
const HOPE = 5;
const EVENT = 6;
const NEXT = 7;
/** EN's tags: a room's bg and its pictures (GM3b). */
const EN_TAG = /^(?:room|state):/;

/** The registry's holder rule: a trailing `:` is a family, any other name is exact. */
const matches = (tag: string, pattern: string): boolean => (pattern.endsWith(':') ? tag.startsWith(pattern) : tag === pattern);
const isWindow = (tag: string): boolean => tag.startsWith(WIN) || tag.startsWith(WARM);

export function createAssetScheduler<T>(deps: { registry: AssetRegistry<T>; onError(e: AssetError): void }): AssetScheduler {
  const { registry } = deps;
  let manifest: AssetManifest | null = null;
  let queue: Item[] = [];
  let inFlight: Flight[] = [];
  /** Items that joined a record inside preload() or want(), until their acquire settles. */
  let joins: Flight[] = [];
  /** Every tag preload() was given and not released since, least recently requested first. */
  const tags = new Set<string>();
  /** The ids each preload() tag was given: what step 6 classes the tag by. */
  const given = new Map<string, Set<AssetId>>();
  /** The ids each tag holds or loads: added when its acquire starts, dropped when it settles without a holder. */
  const holding = new Map<string, Set<AssetId>>();
  /** The latest window; null before the first want() after setChapter. */
  let win: StageWindow | null = null;
  /** Need and warm items still refused after step 6, asked again by retry() (step 7). */
  let deferred: Item[] = [];
  /** The tag setChapter kept, ended by the next want() (step 1c). */
  let entry: string | null = null;
  let dead = false;

  const resolve = (id: AssetId, from?: AssetManifest): Result<ImageEntry, AssetError> => {
    const m = from ?? manifest;
    const entry = m !== null && Object.hasOwn(m.assets, id) ? m.assets[id] : undefined;
    if (entry === undefined) {
      return { ok: false, error: { kind: 'missing-id', id } };
    }
    if (entry.kind !== 'image') {
      return { ok: false, error: { kind: 'not-image', id } };
    }
    return { ok: true, value: entry };
  };

  const report = (r: Result<unknown, AssetError>): void => {
    // A preload over the steady cap is expected (K5) and an aborted one was released on purpose.
    if (!r.ok && r.error.kind !== 'aborted' && r.error.kind !== 'over-cap') {
      deps.onError(r.error);
    }
  };

  const hold = (x: Item): void => {
    const ids = holding.get(x.tag) ?? new Set<AssetId>();
    ids.add(x.id);
    holding.set(x.tag, ids);
  };
  const unhold = (x: Item): void => {
    const ids = holding.get(x.tag);
    ids?.delete(x.id);
    if (ids?.size === 0) {
      holding.delete(x.tag);
    }
  };
  /** The tag holds or loads a record (step 6 releases nothing else). */
  const resident = (tag: string): boolean => (holding.get(tag)?.size ?? 0) > 0;

  /**
   * The fetches the preloads hold: every flight, plus each id a join waits on with a fetch or a decode in flight that no
   * flight covers (its flight was released, the join kept the load), once per id. So two in flight at most stays true
   * whatever the record's holders, and a join at a load its own flight still covers counts nothing.
   */
  const busy = (): number => {
    const carried = new Set<AssetId>();
    for (const j of joins) {
      if (!inFlight.some((f) => f.id === j.id) && registry.loading(j.id)) {
        carried.add(j.id);
      }
    }
    return inFlight.length + carried.size;
  };

  /** Rank first, then the order asked. */
  const enqueue = (item: Item): void => {
    let i = queue.length;
    while (i > 0 && (queue[i - 1]?.rank ?? NEED) > item.rank) {
      i -= 1;
    }
    queue.splice(i, 0, item);
  };

  const ask = (x: Flight): Promise<Result<unknown, AssetError>> =>
    x.tag.startsWith(WARM)
      ? registry.acquire(x.id, x.tag, { entry: x.entry, priority: 'warm', signal: x.controller.signal })
      : registry.acquire(x.id, x.tag, { entry: x.entry, priority: 'preload', signal: x.controller.signal });

  /** Drops the tag's queued, deferred, joining and in-flight items and releases its holder; never pumps. */
  const drop = (pattern: string): void => {
    queue = queue.filter((i) => !matches(i.tag, pattern));
    deferred = deferred.filter((i) => !matches(i.tag, pattern));
    for (const f of [...inFlight, ...joins].filter((x) => matches(x.tag, pattern))) {
      f.controller.abort();
    }
    inFlight = inFlight.filter((x) => !matches(x.tag, pattern));
    joins = joins.filter((x) => !matches(x.tag, pattern));
    for (const t of [...tags]) {
      if (matches(t, pattern)) {
        tags.delete(t);
        given.delete(t);
      }
    }
    for (const t of [...holding.keys()]) {
      if (matches(t, pattern)) {
        holding.delete(t);
      }
    }
    registry.releaseHolder(pattern);
  };

  /** Any warm fetch of the window still queued, joining or in flight. */
  const fetchingWarm = (): boolean => [...queue, ...inFlight, ...joins].some((x) => x.tag.startsWith(WARM));

  /**
   * Step 3: once no warm fetch is left, each held warm file is decoded in look order under its window holder, queued
   * for a slot (admitted while it fits); one another holder decodes is joined as it is. Never inside an eviction.
   */
  const decodeWarm = (): void => {
    const w = win;
    if (w === null || fetchingWarm()) {
      return;
    }
    for (const id of w.warm) {
      const tag = WIN + id;
      const s = registry.state(id);
      const r = resolve(id);
      const known = [...queue, ...inFlight, ...joins].some((x) => x.tag === tag);
      if (!r.ok || known || s === 'none') {
        continue;
      }
      if (s === 'held') {
        enqueue({ tag, id, entry: r.value, rank: DECODE });
      } else if (!resident(tag)) {
        join({ tag, id, entry: r.value, rank: DECODE });
      }
    }
  };

  /** One retry of a refused flight in this turn; true when admitted (its settle then frees the slot). */
  const readmit = (f: Flight): boolean => {
    const asked = ask(f);
    const s = registry.state(f.id);
    // A refused acquire adds no holder and leaves the record as it was: none, or a held file for a decode.
    const admitted = f.tag.startsWith(WARM) ? s !== 'none' : s === 'live' || s === 'pending';
    if (admitted) {
      void asked.then((r) => settle(f, r));
    }
    return admitted;
  };

  /** Releases a window holder of step 6 or D3; a hope or event-room item queues again, admitted only while it fits. */
  const evict = (tag: string, again: number | null): void => {
    const id = [...(holding.get(tag) ?? [])][0];
    drop(tag);
    const r = id === undefined || again === null ? null : resolve(id);
    if (id !== undefined && again !== null && r?.ok === true) {
      enqueue({ tag, id, entry: r.value, rank: again });
    }
  };

  /** The window's own holders of `ids` that hold or load a record, the last first. */
  const mine = (ids: readonly AssetId[]): string[] => ids.map((id) => WIN + id).filter(resident).reverse();

  /**
   * Step 6, a refused need item or warm fetch: releases one holder at a time and retries after each, in this turn:
   * (a) the window's resident hope, then its warm decodes (shed to their held files); (b) EN's tags with no id in
   * need, warm or the event's room, those with none in hope first, the most recently requested first; (c) the next
   * chapter's tags with no id in need or warm; (d) the event's room: the window's holders, then EN's tags that hold it.
   * Never `scene:*`, `ensure`, `preload:<knot>` or the window's need and warm holders.
   */
  const evictFor = (f: Flight, w: StageWindow): boolean => {
    const needWarm = new Set([...w.need, ...w.warm]);
    const keep = new Set([...needWarm, ...w.eventRoom]);
    const hope = new Set(w.hope);
    const room = new Set(w.eventRoom);
    const some = (t: string, ids: ReadonlySet<AssetId>): boolean => [...(given.get(t) ?? [])].some((id) => ids.has(id));
    const recent = [...tags].reverse().filter(resident);
    const en = recent.filter((t) => EN_TAG.test(t));
    const order: (readonly [string, number | null])[] = [
      ...mine(w.hope).map((t) => [t, HOPE] as const),
      ...mine(w.warm).map((t) => [t, null] as const),
      ...en.filter((t) => !some(t, keep) && !some(t, hope)).map((t) => [t, null] as const),
      ...en.filter((t) => !some(t, keep) && some(t, hope)).map((t) => [t, null] as const),
      ...recent.filter((t) => t.startsWith('next:') && !some(t, needWarm)).map((t) => [t, null] as const),
      ...mine(w.eventRoom).map((t) => [t, EVENT] as const),
      ...en.filter((t) => some(t, room) && !some(t, needWarm)).map((t) => [t, null] as const),
    ];
    for (const [t, again] of order) {
      if (!resident(t)) {
        continue;
      }
      evict(t, again);
      if (readmit(f)) {
        return true;
      }
    }
    return false;
  };

  /**
   * D3, a refused EN tag: the window's warm decodes shed to their files, then its resident hope goes, and the tag is
   * retried once in this turn, before anything queued is pumped; nothing else of step 6 is released for it.
   */
  const shedFor = (f: Flight, w: StageWindow): boolean => {
    const shed = [...mine(w.warm).map((t) => [t, null] as const), ...mine(w.hope).map((t) => [t, HOPE] as const)];
    for (const [t, again] of shed) {
      evict(t, again);
    }
    return shed.length > 0 && readmit(f);
  };

  /** A window flight's class in `w`; null for a tag of preload(). */
  const classOf = (f: Flight, w: StageWindow): 'need' | 'warm' | 'decode' | 'best' | null => {
    if (f.tag.startsWith(WARM)) {
      return 'warm';
    }
    if (!f.tag.startsWith(WIN)) {
      return null;
    }
    return w.need.includes(f.id) ? 'need' : w.warm.includes(f.id) ? 'decode' : 'best';
  };

  const settle = (f: Flight, r: Result<unknown, AssetError>): void => {
    if (!inFlight.includes(f)) {
      // Released while in flight: its slot was freed then.
      report(r);
      pump();
      return;
    }
    const w = win;
    if (!r.ok && r.error.kind === 'over-cap' && w !== null) {
      const c = classOf(f, w);
      if (c === 'need' || c === 'warm') {
        if (evictFor(f, w)) {
          pump();
          return;
        }
        deferred.push({ tag: f.tag, id: f.id, entry: f.entry, rank: f.rank });
      } else if (c === 'decode') {
        // A warm decode is best effort (step 3): one that does not fit stops the decodes and evicts nothing.
        queue = queue.filter((i) => !(i.rank === DECODE && i.tag.startsWith(WIN)));
      } else if (c === null && EN_TAG.test(f.tag) && shedFor(f, w)) {
        pump();
        return;
      }
    }
    inFlight = inFlight.filter((x) => x !== f);
    if (!r.ok) {
      unhold(f);
    }
    report(r);
    if (f.tag.startsWith(WARM)) {
      decodeWarm();
    }
    pump();
  };

  const pump = (): void => {
    while (!dead && busy() < PRELOAD_IN_FLIGHT) {
      const item = queue.shift();
      if (item === undefined) {
        return;
      }
      const flight: Flight = { ...item, controller: new AbortController() };
      inFlight.push(flight);
      hold(flight);
      // Not awaited: the slot frees when the acquire settles, whichever way.
      void ask(flight).then((r) => settle(flight, r));
    }
  };

  /**
   * Joins the item's record now: the registry adds the holder synchronously, at no byte and never refused, so a
   * same-turn release of the record's other holders cannot end it. The tag's release aborts it.
   */
  function join(item: Item): void {
    const j: Flight = { ...item, controller: new AbortController() };
    joins.push(j);
    hold(j);
    // Not awaited: a join holds no slot of its own; a load it carried (busy) frees when it settles.
    void ask(j).then((r) => {
      if (joins.includes(j)) {
        joins = joins.filter((x) => x !== j);
        if (!r.ok) {
          unhold(j);
        }
        if (j.tag.startsWith(WARM)) {
          decodeWarm();
        }
      }
      report(r);
      pump();
    });
  }

  /**
   * Step 1b: a warm file joins its record in any state; any other item a live record, or one in flight to be decoded.
   * The rest queue at their rank, a held file's decode included (an admission for the decoded bytes).
   */
  const take = (item: Item): void => {
    if ([...queue, ...inFlight, ...joins].some((x) => x.tag === item.tag && x.id === item.id)) {
      return;
    }
    // Read and joined in one synchronous turn: the record cannot end between the two.
    const s = registry.state(item.id);
    if (item.tag.startsWith(WARM) ? s !== 'none' : s === 'live' || s === 'pending') {
      join(item);
    } else {
      enqueue(item);
    }
  };

  const releasePreload = (pattern: string): void => {
    drop(pattern);
    pump();
  };

  return {
    setChapter(m) {
      if (dead) {
        return;
      }
      manifest = m;
      const kept = `next:${m.chapterId}`;
      for (const t of [...tags]) {
        if (t.startsWith('next:') && t !== kept) {
          releasePreload(t);
        }
      }
      releasePreload('preload:');
      registry.releaseHolder(ENSURE_HOLDER);
      win = null;
      deferred = [];
      entry = kept;
    },
    resolve,
    preload(tag, ids, from) {
      if (dead) {
        return;
      }
      // Step 6 (b)'s recency: a tag asked again becomes the most recent.
      tags.delete(tag);
      tags.add(tag);
      const g = given.get(tag) ?? new Set<AssetId>();
      given.set(tag, g);
      for (const id of ids) {
        const r = resolve(id, from);
        if (!r.ok) {
          deps.onError(r.error);
          continue;
        }
        g.add(id);
        take({ tag, id, entry: r.value, rank: tag.startsWith('next:') ? NEXT : TAG });
      }
      pump();
    },
    releasePreload,
    async ensure(ids, signal) {
      const outcomes = ids.map(async (id): Promise<AssetError | null> => {
        if (dead) {
          return { kind: 'aborted', id };
        }
        const r = resolve(id);
        if (!r.ok) {
          return r.error;
        }
        const got = await registry.acquire(id, ENSURE_HOLDER, { entry: r.value, priority: 'visible', signal });
        return got.ok ? null : got.error;
      });
      const errors = (await Promise.all(outcomes)).filter((e): e is AssetError => e !== null);
      return errors.length === 0 ? { ok: true, value: undefined } : { ok: false, error: { kind: 'assets', errors } };
    },
    want(w) {
      if (dead) {
        return;
      }
      win = w;
      deferred = [];
      // 1. The window's holders outside need ∪ warm ∪ hope ∪ eventRoom go, their loads aborted; its queued items are
      // planned again below by their new class.
      const all = new Set<string>([...w.need, ...w.warm, ...w.hope, ...w.eventRoom]);
      const windowTags = new Set([...holding.keys(), ...inFlight.map((f) => f.tag), ...joins.map((j) => j.tag)].filter(isWindow));
      for (const t of windowTags) {
        if (!all.has(t.slice(t.startsWith(WARM) ? WARM.length : WIN.length))) {
          drop(t);
        }
      }
      queue = queue.filter((i) => !isWindow(i.tag));
      // 1b, 2-5: what exists is joined at once, the rest queued by class.
      const plan = (ids: readonly AssetId[], prefix: string, rank: (i: number) => number): void => {
        ids.forEach((id, i) => {
          const r = resolve(id);
          if (r.ok) {
            take({ tag: prefix + id, id, entry: r.value, rank: rank(i) });
          } else {
            deps.onError(r.error);
          }
        });
      };
      plan(w.need, WIN, () => NEED);
      plan(w.warm, WARM, (i) => (i < w.near ? NEAR : FAR));
      plan(w.hope, WIN, () => HOPE);
      plan(w.eventRoom, WIN, () => EVENT);
      // 1c. The entry tag ends once its records were joined.
      if (entry !== null) {
        drop(entry);
        entry = null;
      }
      decodeWarm();
      pump();
    },
    retry() {
      if (dead) {
        return;
      }
      const items = deferred;
      deferred = [];
      for (const i of items) {
        take(i);
      }
      decodeWarm();
      pump();
    },
    stats() {
      const w = win;
      const asked = (t: string): boolean => resident(t) || [...queue, ...deferred].some((i) => i.tag === t);
      const ids = w === null ? [] : [...new Set([...w.need, ...w.warm, ...w.hope, ...w.eventRoom])].filter((id) => asked(WIN + id) || asked(WARM + id));
      return {
        window: { pending: w === null ? 0 : w.need.filter((id) => registry.state(id) !== 'live').length, ids },
        rooms: [...tags].filter((t) => t.startsWith('room:') && resident(t)),
      };
    },
    destroy() {
      if (dead) {
        return;
      }
      dead = true;
      queue = [];
      deferred = [];
      win = null;
      for (const f of [...inFlight, ...joins]) {
        f.controller.abort();
      }
      inFlight = [];
      joins = [];
      for (const t of tags) {
        registry.releaseHolder(t);
      }
      tags.clear();
      given.clear();
      holding.clear();
      registry.releaseHolder(WIN);
      registry.releaseHolder(WARM);
      registry.releaseHolder(ENSURE_HOLDER);
      manifest = null;
    },
  };
}
