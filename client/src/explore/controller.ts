// The explore controller (docs/PUZZLES-PLAN.md X10, X12, X13, X16 and "Modules"; the LX cut D2-D13): the runtime
// side of a section. Player actions go through the one reducer, the views it writes are what the explore layer
// shows, and every reducer effect leaves through `onEffect` to GameSession (app/yields.ts, L15). It reaches the world
// only through `reduce` / `admitSection` (principle 7) and lives in the explore-ui chunk with the components (X14).
import { ROOM_SOURCE, cover, minTarget, toStage } from '../geom/cover.ts';
import type { Size } from '../geom/cover.ts';
import type { SceneController } from '../scene/controller.ts';
import type { AssetManifest } from '../story/catalog.ts';
import type { SectionId } from '../story/staging.ts';
import type { Unsubscribe } from '../telegram/index.ts';
import type { ExploreViewStore, HotspotView } from '../ui/explore-view.svelte.ts';
import type { HotspotKey, RoomId, WorldPublic, WorldText } from '../world/types.ts';
import { admitSection } from './reconcile.ts';
import { hotspotKey, lockOf, reduce, worldIndex } from './reduce.ts';
import type { ExploreAction, ExploreEffect } from './reduce.ts';
import { EMPTY_WORLD_STATE } from './state.ts';
import type { WorldState } from './state.ts';

/** PZ:552 (principle 5): the smallest hotspot side, in CSS px. */
export const MIN_TARGET_PX = 44;

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
  state(): WorldState;
  onEffect(fn: (e: ExploreEffect) => void): Unsubscribe;
  /** Idempotent: disconnects the observer, drops the listeners and empties the views it writes. */
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
/**
 * How an outcome came: through a section's entry (the path restarts), an event's return (the path is kept), or a
 * player action from `room` (a `room` effect to another room is a move).
 */
type Route = { kind: 'admit' } | { kind: 'event' } | { kind: 'action'; action: ExploreAction; room: RoomId | null };

/** The renderer reads the same two numbers (`scene/controller.ts:180`); `.host` has no padding, so this is its content box. */
const sizeOf = (host: HTMLElement): Size => ({ w: host.clientWidth, h: host.clientHeight });

export function createExploreController(deps: ExploreControllerDeps): ExploreController {
  const { world, view, text } = deps;
  const ix = worldIndex(world);
  let current: WorldState = EMPTY_WORLD_STATE;
  let stage = sizeOf(deps.stageHost);
  /** D7: the rooms walked before the current one; not saved (X12 trade-off). */
  let path: readonly RoomId[] = [];
  let walkable = false;
  let effectFns: Array<(e: ExploreEffect) => void> = [];
  let pathFns: Array<(walkable: boolean) => void> = [];
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

  const writeView = (): void => {
    view.hotspots = hotspotViews();
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
   * D6: adopt the state, update the path, write the views, report the path edge, then the effects in order. Not
   * re-entrant: GameSession's single intent queue serializes; a listener that disposes ends the call.
   */
  const settle = (out: Outcome, route: Route): void => {
    current = out.state;
    walk(route, out.effects);
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
      observer.disconnect();
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
