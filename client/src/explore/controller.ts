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
import type { WorldPublic, WorldText } from '../world/types.ts';
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

/** The renderer reads the same two numbers (`scene/controller.ts:180`); `.host` has no padding, so this is its content box. */
const sizeOf = (host: HTMLElement): Size => ({ w: host.clientWidth, h: host.clientHeight });

export function createExploreController(deps: ExploreControllerDeps): ExploreController {
  const { world, view, text } = deps;
  const ix = worldIndex(world);
  let current: WorldState = EMPTY_WORLD_STATE;
  let stage = sizeOf(deps.stageHost);
  let effectFns: Array<(e: ExploreEffect) => void> = [];
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

  /** D6: adopt the state, write the views, then the effects in order; a listener that disposes ends the call. */
  const settle = (out: Outcome): void => {
    current = out.state;
    writeView();
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
  const admit = (section: SectionId, s: WorldState): Outcome =>
    s.pendingStory.length > 0 ? reduce(world, s, { kind: 'event-returned', section }) : admitSection(world, s, section);

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
        settle(admit(section, state));
      }
    },
    dispatch(a) {
      if (dead) {
        return;
      }
      settle(a.kind === 'enter-section' || a.kind === 'event-returned' ? admit(a.section, current) : reduce(world, current, a));
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
      view.hotspots = [];
      view.reveal = false;
      view.items = [];
      view.docs = [];
      view.lock = null;
    },
  };
}
