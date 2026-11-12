// The explore controller (docs/PUZZLES-PLAN.md X10, X12, X13, X16 and "Modules"; the LX cut D2-D13): the runtime
// side of a section. Player actions go through the one reducer, the views it writes are what the explore layer
// shows, and every reducer effect leaves through `onEffect` to GameSession (app/yields.ts, L15). It reaches the world
// only through `reduce` / `admitSection` / `admitEvent` (principle 7) and lives in the explore-ui chunk with the
// components (X14), the one importer of the rules half (mechanics/rules/, the `rules-lazy` arch rule).
import type { VisualDiff } from '../cues/types.ts';
import { ROOM_SOURCE, cover, minTarget, toStage } from '../geom/cover.ts';
import type { Box, Size } from '../geom/cover.ts';
import type { AnchorKey, PropView, SectionAction } from '../mechanics/contract.ts';
import { reduce } from '../mechanics/rules/core.ts';
import { admitEvent, admitSection } from '../mechanics/rules/search.ts';
import { nearRooms, viewParent } from '../mechanics/rules/view.ts';
import { roomImages, visualsOf } from '../mechanics/rules/visual.ts';
import type { SceneController } from '../scene/controller.ts';
import type { AssetManifest } from '../story/catalog.ts';
import type { AssetId, BgId, PropId, SectionId } from '../story/staging.ts';
import type { Unsubscribe } from '../telegram/index.ts';
import type { DocView, ExploreViewStore, HotspotView, ItemView, LockView } from '../ui/explore-view.svelte.ts';
import type { DocId, HotspotKey, ItemId, Lock, RoomId, WorldPublic, WorldText } from '../world/types.ts';
import { hotspotKey, lockOf, worldIndex } from './reduce.ts';
import type { ExploreEffect } from './reduce.ts';
import { EMPTY_WORLD_STATE } from './state.ts';
import type { WorldState } from './state.ts';

/** PZ:552 (principle 5): the smallest hotspot side, in CSS px. */
export const MIN_TARGET_PX = 44;
/** X16: how long "show spots" outlines every hotspot. */
export const REVEAL_MS = 2000;

/** Owned by GameSession, one per chapter (PZ "Resource lifetime"). */
export interface ExploreController {
  /**
   * An explore yield: `admitSection` with an empty `pendingStory`, else `admitEvent` (the knot's return); an unproved
   * section is proved first either way (X9; engine plan §3.4).
   */
  enter(section: SectionId, state: WorldState): void;
  /** Taps, inserts and puzzle results; `enter-section` / `event-returned` take `enter`'s route, never `reduce` directly. */
  dispatch(a: SectionAction): void;
  /**
   * BackButton at the root (X12): in a view (engine plan §6.3 W1) a `leave-view` to its parent, whatever the path;
   * elsewhere a `tap` on the current room's open exit to the previous room of the path. False when neither applies
   * or the controller is disposed. During an event knot the reducer refuses the action.
   */
  back(): boolean;
  /**
   * "Back has a target" edges, for `setRootBack`: the path is non-empty, or the room is a view of a current section
   * (§6.3: a view always offers Back, a resume into one included). Called once on subscribe with the current value.
   */
  onPath(fn: (walkable: boolean) => void): Unsubscribe;
  /** The stage host's content box (X10); recomputes the hotspot boxes. The host's own ResizeObserver calls it too. */
  resize(stage: Size): void;
  /**
   * The current room's batch is applied, or its close-up was cleared (GameSession calls it; the cut addendum, W1/W2):
   * requests the room's own bg, then every image the room can show (`state:<room>`), then each neighbour's bg in exit
   * order, then each kept neighbour's images, under the registry's steady cap (engine plan §6.4). A no-op outside a
   * section, while an event knot is pending, and once disposed.
   */
  roomShown(): void;
  /** "Show spots" (X16): every hotspot outlined for REVEAL_MS; a second call restarts the time. */
  reveal(): void;
  /** Recomputes every view text after a language change (principle 8); no action, no effect. */
  relabel(): void;
  /** The room's picture in the current state (engine plan §6.4): every module's anchor views, back to front. */
  visualsOf(room: RoomId): readonly PropView[];
  /**
   * The stage box of anchor `at` of the current room: the cover mapping with no minimum tap target. Null while the stage
   * has no size, or when `at` is no anchor of the current room's picture.
   */
  anchorBox(at: AnchorKey): Box | null;
  /**
   * Where a state batch's load holds (§6.4 round 13): at the first anchor of `diff`, in draw order, whose new view draws
   * an image; none draws one: `'no-load'`, the batch adds no image.
   */
  stateHold(diff: readonly VisualDiff[]): { readonly box: Box | null } | 'no-load';
  state(): WorldState;
  onEffect(fn: (e: ExploreEffect) => void): Unsubscribe;
  /**
   * Idempotent: releases `room:*` and `state:*`, disconnects the observer, clears the reveal timer, drops the listeners,
   * empties its views.
   */
  dispose(): void;
}

export type ExploreControllerDeps = {
  world: WorldPublic;
  manifest: AssetManifest;
  scene: Pick<SceneController, 'preload' | 'releasePreload'>;
  view: ExploreViewStore;
  /** A world line in the UI language. */
  text: (t: WorldText) => string;
  /** The Stage.svelte element: the box the scene's ResizeObserver sizes the canvas to, so the buttons and the canvas
   *  share one size (X10). */
  stageHost: HTMLElement;
};

type Outcome = { state: WorldState; effects: ExploreEffect[] };

/** The `room:<id>` holder family (a trailing `:` names a family, scene/preload.ts). */
const ROOM_HOLDERS = 'room:';
const roomTag = (room: RoomId): string => `${ROOM_HOLDERS}${room}`;
/** The `state:<id>` holder family: every image a room can show (engine plan §6.4 "Memory"). */
const STATE_HOLDERS = 'state:';
const stateTag = (room: RoomId): string => `${STATE_HOLDERS}${room}`;
/** A bg slot's asset id, as the executor forms it (scene/executor.ts:112). */
const bgAsset = (bg: BgId): AssetId => `bg/${bg}` as AssetId; // STAGING-DSL §8: a bg id names its asset
/** A prop slot's asset id, as the executor forms it (scene/executor.ts:148). */
const propAsset = (p: PropId): AssetId => `prop/${p}` as AssetId; // STAGING-DSL §8: a prop id names its asset
/**
 * How an outcome came: through a section's entry (the path restarts), an event's return (the path is kept), or a
 * player action from `room` (a `room` effect to another room is a move).
 */
type Route = { kind: 'admit' } | { kind: 'event' } | { kind: 'action'; action: SectionAction; room: RoomId | null };

/** The renderer reads the same two numbers (`scene/controller.ts` `appOptions` and `onResize`); `.host` has no
 *  padding, so this is its content box. */
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
  /**
   * §6.4 round 13 (RULINGS 246 W1): the rooms whose `state:<id>` set was requested as the current room's, while they
   * stay in a move's keep set; a kept one's set is asked for again after the neighbours' bgs.
   */
  const trackedState = new Set<RoomId>();
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

  /** The current room's anchor views (engine plan §6.4); none outside a section. */
  const views = (): readonly PropView[] => {
    const room = current.section === null ? null : current.room;
    return room === null ? [] : visualsOf(world, current, room);
  };

  const anchorBox = (at: AnchorKey): Box | null => {
    const v = views().find((x) => x.at === at);
    return v === undefined || stage.w <= 0 || stage.h <= 0 ? null : toStage(v.rect, cover(stage, ROOM_SOURCE));
  };

  /**
   * D9 in engine plan §6.3's preload order (m2): Back's target first (a view's parent; else, for the current room, the
   * path's last room), then `nearRooms` (the rule emit writes as the usage neighbours: a view's parent, then the rooms
   * R's exits lead to in hotspot order, locked exits included, story exits and R not), distinct.
   */
  const neighbours = (room: RoomId): RoomId[] => {
    const near = nearRooms(world, room);
    const back = viewParent(world, room) ?? (room === current.room ? (path.at(-1) ?? null) : null);
    return back === null ? near : [back, ...near.filter((r) => r !== back)];
  };

  /** Both families, unconditionally (RULINGS 245 Q7): a `leave` and `dispose`. */
  const releaseAll = (): void => {
    tracked.clear();
    trackedState.clear();
    scene.releasePreload(ROOM_HOLDERS);
    scene.releasePreload(STATE_HOLDERS);
  };

  /**
   * D10 phase A, before any effect goes out: a move keeps only R and its neighbours' `room:*`; a puzzle with a close-up
   * releases every `room:*`, and a `leave` every holder, so the close-up, or the knot's own preloads, meet the bytes
   * these free. A room's `state:*` set (§6.4 round 13, RULINGS 246 W1): a move releases every set but the new room's
   * and stops tracking a room that left the keep set; a kept room's set is asked for again only after the neighbours'
   * bgs (`roomShown`), so a neighbour's bg outranks it. An event's return or a resume (`from === room`) moves nowhere,
   * and the close-up keeps the room's own set. A zoom-in to a view whose only neighbour is its parent keeps the
   * parent's set (§6.3, RULINGS 286 Q3): the one neighbour bg it asks for is the parent's, which `room:<of>` already
   * holds, so the set can displace no neighbour bg; walks and every other zoom release it as above.
   */
  const releaseHolders = (effects: readonly ExploreEffect[]): void => {
    for (const e of effects) {
      if (e.kind === 'room') {
        const near = neighbours(e.room);
        const keep = new Set([e.room, ...near]);
        const keepsParentSet = e.how === 'zoom-in' && near.every((n) => n === e.from);
        for (const m of [...tracked]) {
          if (!keep.has(m)) {
            tracked.delete(m);
            scene.releasePreload(roomTag(m));
          }
        }
        for (const m of [...trackedState]) {
          if (!keep.has(m)) {
            trackedState.delete(m);
            scene.releasePreload(stateTag(m));
          } else if (m !== e.room && e.from !== e.room && !(m === e.from && keepsParentSet)) {
            scene.releasePreload(stateTag(m));
          }
        }
      } else if (e.kind === 'puzzle' && (ix.puzzles.get(e.puzzle)?.closeup ?? null) !== null) {
        tracked.clear();
        scene.releasePreload(ROOM_HOLDERS);
        for (const m of [...trackedState]) {
          if (m !== current.room) {
            trackedState.delete(m);
            scene.releasePreload(stateTag(m));
          }
        }
      } else if (e.kind === 'leave') {
        releaseAll();
      }
    }
  };

  /** Every image `room` can show, as asset ids (sorted: `roomImages`). */
  const imagesOf = (room: RoomId): AssetId[] => roomImages(world, room).map(propAsset);

  /**
   * D10 phase B: R's whole set is live and the previous room's props are gone, so the registry counts R when it
   * admits each neighbour bg (K5's 32 MiB rule); the requests are idempotent joins when already live or queued. In
   * order (§6.4 round 14, RULINGS 246 W1): R's bg, R's images, each neighbour's bg in exit order, then each kept
   * neighbour's images, which the steady cap admits only into what the bgs left.
   */
  const roomShown = (): void => {
    const room = current.room;
    if (dead || current.section === null || room === null || current.pendingStory.length > 0) {
      return;
    }
    const near = neighbours(room);
    const preloadBg = (r: RoomId): void => {
      const entry = ix.rooms.get(r);
      if (entry !== undefined) {
        tracked.add(r);
        scene.preload(roomTag(r), [bgAsset(entry.room.bg)], deps.manifest);
      }
    };
    preloadBg(room);
    const own = imagesOf(room);
    if (own.length > 0) {
      trackedState.add(room);
      scene.preload(stateTag(room), own, deps.manifest);
    }
    near.forEach(preloadBg);
    for (const n of near) {
      if (trackedState.has(n)) {
        scene.preload(stateTag(n), imagesOf(n), deps.manifest);
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
   * D7, with engine plan §6.3's two view cases ahead of it (W1), told apart by the move's own `how` (core's `moveHow`):
   * a zoom-in pushes prev whatever exits the view has; a zoom-out truncates at its room when that is on the path and
   * never pushes the view, so the next Back never re-enters it. Any other move truncates a cycle (R on the path), else
   * pushes prev when R's way back to it is open, else clears the path (a door locked from the other side). An entry and
   * a `leave` clear it; an event's return keeps it.
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
        if (e.how === 'zoom-in') {
          path = [...path, prev];
        } else if (e.how === 'zoom-out') {
          path = at !== -1 ? path.slice(0, at) : path;
        } else {
          path = at !== -1 ? path.slice(0, at) : openExit(e.room, prev) !== null ? [...path, prev] : [];
        }
        prev = e.room;
      }
    }
  };

  /** The current room is a view of a current section (§6.3): Back leaves it, whatever the path. A story exit out of a
   *  view keeps its room but clears the section, so it leaves no Back target. */
  const inView = (): boolean => current.section !== null && current.room !== null && viewParent(world, current.room) !== null;

  /** D8: only a change of "Back has a target" reaches the listeners. */
  const reportPath = (): void => {
    const now = path.length > 0 || inView();
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

  /**
   * D5: the one route into a section; the reducer's `enter-section` and `event-returned` are reached only through
   * `admitSection` / `admitEvent`. An event return that restarted the section (a `reset`, which `reduce` never emits)
   * restarts the path like an entry; a plain return keeps it.
   */
  const admit = (section: SectionId, s: WorldState): void => {
    if (s.pendingStory.length > 0) {
      const out = admitEvent(world, s, section);
      settle(out, out.effects[0]?.kind === 'reset' ? { kind: 'admit' } : { kind: 'event' });
    } else {
      settle(admitSection(world, s, section), { kind: 'admit' });
    }
  };

  const dispatch = (a: SectionAction): void => {
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
      if (!dead && inView()) {
        dispatch({ kind: 'leave-view' });
        return true;
      }
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
    visualsOf: (room) => visualsOf(world, current, room),
    anchorBox,
    stateHold(diff) {
      const now = views();
      for (const d of diff) {
        const v = now.find((x) => x.at === d.at); // an anchor that left the picture is absent: it draws nothing
        if (v !== undefined && (v.prop !== null || v.patch !== null)) {
          return { box: anchorBox(d.at) };
        }
      }
      return 'no-load';
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
