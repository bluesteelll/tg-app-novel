// The explore controller (docs/PUZZLES-PLAN.md X10, X12, X13, X16 and "Modules"; the LX cut D2-D13): the runtime
// side of a section. Player actions go through the one reducer, the views it writes are what the explore layer
// shows, and every reducer effect leaves through `onEffect` to GameSession (app/yields.ts, L15). It reaches the world
// only through `reduce` / `admitSection` (principle 7) and lives in the explore-ui chunk with the components (X14).
import { ROOM_SOURCE, cover, minTarget, toStage } from '../geom/cover.ts';
import type { Size } from '../geom/cover.ts';
import type { SceneController } from '../scene/controller.ts';
import type { AssetManifest } from '../story/catalog.ts';
import type { AssetId, BgId, SectionId } from '../story/staging.ts';
import type { Unsubscribe } from '../telegram/index.ts';
import type { DocView, ExploreViewStore, HotspotView, ItemView, LockView } from '../ui/explore-view.svelte.ts';
import type { DocId, HotspotKey, ItemId, Lock, RoomId, WorldPublic, WorldText } from '../world/types.ts';
import { admitSection } from './reconcile.ts';
import { hotspotKey, lockOf, reduce, worldIndex } from './reduce.ts';
import type { ExploreAction, ExploreEffect } from './reduce.ts';
import { EMPTY_WORLD_STATE } from './state.ts';
import type { WorldState } from './state.ts';

/** PZ:552 (principle 5): the smallest hotspot side, in CSS px. */
export const MIN_TARGET_PX = 44;
/** X16: how long "show spots" outlines every hotspot. */
export const REVEAL_MS = 2000;

/** Owned by GameSession, one per chapter (PZ "Resource lifetime"). */
export interface ExploreController {
  /** An explore yield: `admitSection` with an empty `pendingStory` (an unproved section is proved first, X9), else `event-returned`. */
  enter(section: SectionId, state: WorldState): void;
  /** Taps, inserts and puzzle results; `enter-section` / `event-returned` take `enter`'s route, never `reduce` directly. */
  dispatch(a: ExploreAction): void;
  /**
   * BackButton at the root (X12): a `tap` on the current room's open exit to the previous room of the path; false
   * when the path is empty or the controller is disposed. During an event knot the reducer refuses the tap.
   */
  back(): boolean;
  /** The path's empty ↔ non-empty edges, for `setRootBack`; called once on subscribe with the current value. */
  onPath(fn: (walkable: boolean) => void): Unsubscribe;
  /** The stage host's content box (X10); recomputes the hotspot boxes. The host's own ResizeObserver calls it too. */
  resize(stage: Size): void;
  /**
   * The current room's batch is applied, or its close-up was cleared (GameSession calls it; the cut addendum, W1/W2):
   * requests the room's own bg, then each neighbour's bg in exit order, under the registry's steady cap. A no-op
   * outside a section, while an event knot is pending, and once disposed.
   */
  roomShown(): void;
  /** "Show spots" (X16): every hotspot outlined for REVEAL_MS; a second call restarts the time. */
  reveal(): void;
  /** Recomputes every view text after a language change (principle 8); no action, no effect. */
  relabel(): void;
  state(): WorldState;
  onEffect(fn: (e: ExploreEffect) => void): Unsubscribe;
  /** Idempotent: releases `room:*`, disconnects the observer, clears the reveal timer, drops the listeners, empties its views. */
  dispose(): void;
}

export type ExploreControllerDeps = {
  world: WorldPublic;
  manifest: AssetManifest;
  scene: Pick<SceneController, 'preload' | 'releasePreload'>;
  view: ExploreViewStore;
  /** A world line in the UI language. */
  text: (t: WorldText) => string;
  /** The Stage.svelte element: Pixi's `resizeTo` box, so the buttons and the canvas share one size (X10). */
  stageHost: HTMLElement;
};

type Outcome = { state: WorldState; effects: ExploreEffect[] };

/** The `room:<id>` holder family (a trailing `:` names a family, scene/preload.ts). */
const ROOM_HOLDERS = 'room:';
const roomTag = (room: RoomId): string => `${ROOM_HOLDERS}${room}`;
/** A bg slot's asset id, as the executor forms it (scene/executor.ts:112). */
const bgAsset = (bg: BgId): AssetId => `bg/${bg}` as AssetId; // STAGING-DSL §8: a bg id names its asset
/**
 * How an outcome came: through a section's entry (the path restarts), an event's return (the path is kept), or a
 * player action from `room` (a `room` effect to another room is a move).
 */
type Route = { kind: 'admit' } | { kind: 'event' } | { kind: 'action'; action: ExploreAction; room: RoomId | null };

/** The renderer reads the same two numbers (`scene/controller.ts:180`); `.host` has no padding, so this is its content box. */
const sizeOf = (host: HTMLElement): Size => ({ w: host.clientWidth, h: host.clientHeight });

export function createExploreController(deps: ExploreControllerDeps): ExploreController {
  const { world, scene, view, text } = deps;
  const ix = worldIndex(world);
  let current: WorldState = EMPTY_WORLD_STATE;
  let stage = sizeOf(deps.stageHost);
  /** D7: the rooms walked before the current one; not saved (X12 trade-off). */
  let path: readonly RoomId[] = [];
  let walkable = false;
  let effectFns: Array<(e: ExploreEffect) => void> = [];
  let pathFns: Array<(walkable: boolean) => void> = [];
  /** D10: the rooms whose `room:<id>` tag was requested and not released since. */
  const tracked = new Set<RoomId>();
  /** D12: the one reveal timer; components hold none. */
  let revealTimer: ReturnType<typeof setTimeout> | null = null;
  /** D11: the hotspot of the latest `lock` effect while its panel can show, and whether its last insert was refused. */
  let lockKey: HotspotKey | null = null;
  let refused = false;
  let dead = false;

  /** D4: the current room's hotspots in world order, except a taken `take` (as `actions` lists them). */
  const hotspotViews = (): HotspotView[] => {
    const room = current.section === null ? null : current.room;
    const entry = room === null ? undefined : ix.rooms.get(room);
    if (room === null || entry === undefined || stage.w <= 0 || stage.h <= 0) {
      return [];
    }
    const c = cover(stage, ROOM_SOURCE);
    const out: HotspotView[] = [];
    for (const h of entry.room.hotspots) {
      const key = hotspotKey(room, h.id);
      if (h.kind === 'take' && current.taken.includes(key)) {
        continue;
      }
      out.push({
        key,
        kind: h.kind,
        label: text(h.label),
        css: minTarget(toStage(h.rect, c), MIN_TARGET_PX),
        done: current.examined.includes(key),
        locked: lockOf(h) !== null && !current.open.includes(key),
      });
    }
    return out;
  };

  /** D9: the distinct rooms R's exits lead to, in hotspot order; locked exits included, story exits and R not. */
  const neighbours = (room: RoomId): RoomId[] => {
    const out: RoomId[] = [];
    for (const h of ix.rooms.get(room)?.room.hotspots ?? []) {
      if (h.kind === 'exit' && 'room' in h.to && h.to.room !== room && !out.includes(h.to.room)) {
        out.push(h.to.room);
      }
    }
    return out;
  };

  const releaseAll = (): void => {
    tracked.clear();
    scene.releasePreload(ROOM_HOLDERS);
  };

  /**
   * D10 phase A, before any effect goes out: a move keeps only R and its neighbours; a puzzle with a close-up and a
   * `leave` release every `room:*`, so the close-up, or the knot's own preloads, meet the bytes these free.
   */
  const releaseHolders = (effects: readonly ExploreEffect[]): void => {
    for (const e of effects) {
      if (e.kind === 'room') {
        const keep = new Set([e.room, ...neighbours(e.room)]);
        for (const m of [...tracked]) {
          if (!keep.has(m)) {
            tracked.delete(m);
            scene.releasePreload(roomTag(m));
          }
        }
      } else if (e.kind === 'leave' || (e.kind === 'puzzle' && (ix.puzzles.get(e.puzzle)?.closeup ?? null) !== null)) {
        releaseAll();
      }
    }
  };

  /**
   * D10 phase B: R's whole set is live and the previous room's props are gone, so the registry counts R when it
   * admits each neighbour bg (K5's 32 MiB rule); the requests are idempotent joins when already live or queued.
   */
  const roomShown = (): void => {
    const room = current.room;
    if (dead || current.section === null || room === null || current.pendingStory.length > 0) {
      return;
    }
    for (const r of [room, ...neighbours(room)]) {
      const entry = ix.rooms.get(r);
      if (entry !== undefined) {
        tracked.add(r);
        scene.preload(roomTag(r), [bgAsset(entry.room.bg)], deps.manifest);
      }
    }
  };

  const itemView = (id: ItemId): ItemView | null => {
    const item = Object.hasOwn(world.items, id) ? world.items[id] : undefined;
    return item === undefined ? null : { id, name: text(item.name), desc: text(item.desc), glyph: item.glyph };
  };

  const docView = (id: DocId): DocView | null => {
    const doc = Object.hasOwn(world.docs, id) ? world.docs[id] : undefined;
    return doc === undefined ? null : { id, title: text(doc.title), body: doc.body.map(text) };
  };

  /** The lock at `key` while it is in the current room of a current section and not open yet; else null. */
  const shutLock = (key: HotspotKey): { label: WorldText; lock: Lock } | null => {
    const entry = ix.hotspots.get(key);
    const lock = entry === undefined ? null : lockOf(entry.hotspot);
    if (entry === undefined || lock === null || current.section === null || entry.room !== current.room || current.open.includes(key)) {
      return null;
    }
    return { label: entry.hotspot.label, lock };
  };

  /**
   * D11: the panel follows the latest `lock` effect and closes (null) after a room change or once the lock opens;
   * `refused` holds only after an insert on that lock was refused.
   */
  const followLock = (route: Route, effects: readonly ExploreEffect[]): void => {
    for (const e of effects) {
      if (e.kind === 'lock') {
        lockKey = e.hotspot;
      }
    }
    const a = route.kind === 'action' ? route.action : null;
    refused = a?.kind === 'insert' && a.hotspot === lockKey && effects.some((e) => e.kind === 'refused');
    if (lockKey !== null && shutLock(lockKey) === null) {
      lockKey = null;
      refused = false;
    }
  };

  const lockView = (): LockView | null => {
    const key = lockKey;
    const shut = key === null ? null : shutLock(key);
    if (key === null || shut === null) {
      return null;
    }
    const cells = Object.hasOwn(current.slots, key) ? current.slots[key] : undefined;
    const slots = shut.lock.slots.map((_, i) => {
      const id = cells?.[i] ?? null;
      return id === null ? null : itemView(id);
    });
    return { key, title: text(shut.label), locked: text(shut.lock.locked), slots, refused };
  };

  const present = <T>(v: T | null): T[] => (v === null ? [] : [v]);

  const writeView = (): void => {
    view.hotspots = hotspotViews();
    view.items = current.held.flatMap((id) => present(itemView(id)));
    view.docs = current.docs.flatMap((id) => present(docView(id)));
    view.lock = lockView();
  };

  /** The first exit of `room` to `target` that is lock-free or open now; locks never close (X12). */
  const openExit = (room: RoomId, target: RoomId): HotspotKey | null => {
    for (const h of ix.rooms.get(room)?.room.hotspots ?? []) {
      const key = hotspotKey(room, h.id);
      if (h.kind === 'exit' && 'room' in h.to && h.to.room === target && (h.lock === null || current.open.includes(key))) {
        return key;
      }
    }
    return null;
  };

  /**
   * D7: a move prev -> R truncates a cycle (R on the path), else pushes prev when R's way back to it is open, else
   * clears the path (a door locked from the other side). An entry and a `leave` clear it; an event's return keeps it.
   */
  const walk = (route: Route, effects: readonly ExploreEffect[]): void => {
    if (route.kind === 'admit') {
      path = [];
      return;
    }
    if (route.kind === 'event') {
      return;
    }
    let prev = route.room;
    for (const e of effects) {
      if (e.kind === 'leave') {
        path = [];
      } else if (e.kind === 'room' && prev !== null && e.room !== prev) {
        const at = path.indexOf(e.room);
        path = at !== -1 ? path.slice(0, at) : openExit(e.room, prev) !== null ? [...path, prev] : [];
        prev = e.room;
      }
    }
  };

  /** D8: only an empty ↔ non-empty edge reaches the listeners. */
  const reportPath = (): void => {
    const now = path.length > 0;
    if (now === walkable) {
      return;
    }
    walkable = now;
    for (const fn of pathFns) {
      fn(now);
    }
  };

  /**
   * D6: adopt the state, update the path, release holders, write the views, report the path edge, then the effects in
   * order. Not
   * re-entrant: GameSession's single intent queue serializes; a listener that disposes ends the call.
   */
  const settle = (out: Outcome, route: Route): void => {
    current = out.state;
    walk(route, out.effects);
    releaseHolders(out.effects);
    followLock(route, out.effects);
    writeView();
    reportPath();
    for (const e of out.effects) {
      for (const fn of effectFns) {
        if (dead) {
          return;
        }
        fn(e);
      }
    }
  };

  /** D5: the one route into a section; the reducer's `enter-section` is reached only through `admitSection`. */
  const admit = (section: SectionId, s: WorldState): void => {
    if (s.pendingStory.length > 0) {
      settle(reduce(world, s, { kind: 'event-returned', section }), { kind: 'event' });
    } else {
      settle(admitSection(world, s, section), { kind: 'admit' });
    }
  };

  const dispatch = (a: ExploreAction): void => {
    if (dead) {
      return;
    }
    if (a.kind === 'enter-section' || a.kind === 'event-returned') {
      admit(a.section, current);
      return;
    }
    settle(reduce(world, current, a), { kind: 'action', action: a, room: current.room });
  };

  const resize = (size: Size): void => {
    if (dead) {
      return;
    }
    stage = size;
    view.hotspots = hotspotViews();
  };

  const observer = new ResizeObserver(() => resize(sizeOf(deps.stageHost)));
  observer.observe(deps.stageHost);

  return {
    enter(section, state) {
      if (!dead) {
        admit(section, state);
      }
    },
    dispatch,
    back() {
      const target = path.at(-1);
      const key = dead || target === undefined || current.room === null ? null : openExit(current.room, target);
      if (key === null) {
        return false;
      }
      dispatch({ kind: 'tap', hotspot: key });
      return true;
    },
    onPath(fn) {
      if (dead) {
        return () => {};
      }
      const entry = (w: boolean): void => fn(w);
      pathFns = [...pathFns, entry];
      entry(walkable);
      return () => {
        pathFns = pathFns.filter((x) => x !== entry);
      };
    },
    resize,
    roomShown,
    relabel() {
      if (!dead) {
        writeView();
      }
    },
    reveal() {
      if (dead) {
        return;
      }
      if (revealTimer !== null) {
        clearTimeout(revealTimer);
      }
      view.reveal = true;
      revealTimer = setTimeout(() => {
        revealTimer = null;
        view.reveal = false;
      }, REVEAL_MS);
    },
    state: () => current,
    onEffect(fn) {
      if (dead) {
        return () => {};
      }
      const entry = (e: ExploreEffect): void => fn(e);
      effectFns = [...effectFns, entry];
      return () => {
        effectFns = effectFns.filter((x) => x !== entry);
      };
    },
    dispose() {
      if (dead) {
        return;
      }
      dead = true;
      releaseAll();
      observer.disconnect();
      if (revealTimer !== null) {
        clearTimeout(revealTimer);
        revealTimer = null;
      }
      effectFns = [];
      pathFns = [];
      view.hotspots = [];
      view.reveal = false;
      view.items = [];
      view.docs = [];
      view.lock = null;
    },
  };
}
