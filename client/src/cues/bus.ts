// The cue bus (engine plan §8.1): one per GameSession, created and disposed by yields. The overlay role is the
// session's CueStage, the scene role MR1's scene player. The stage subscribes in a later flush than the first cues of
// a section or a frame, so the bus holds what it emits until the overlay subscribes, and replays it then, in order.
// Pure (`isPureWorld`): synchronous, no timer, no microtask, no DOM.
import type { CueEvent, Unsubscribe } from './types.ts';

/** Events held while no 'overlay' subscriber exists (LIMIT new; m5). */
export const CUE_HOLD_MAX = 64;

export interface CueBus {
  /** With no 'overlay' subscriber the event is held (FIFO, <= CUE_HOLD_MAX; past it the oldest is dropped and counted
   *  as an orphan); 'scene' gets it live whenever MR1 subscribed. */
  emit(e: CueEvent): void;
  /** One subscriber per role. A second subscribe of a role replaces the first (a re-mount), so each role plays each cue
   *  exactly once. The first 'overlay' subscribe replays the held events to `fn` in order before any live one. */
  subscribe(role: 'overlay' | 'scene', fn: (e: CueEvent) => void): Unsubscribe;
  /** Events that never reached an 'overlay' subscriber: dropped past the hold, or still held at `dispose`. */
  orphans(): number;
  dispose(): void;
}

export function createCueBus(): CueBus {
  const held: CueEvent[] = [];
  const subscribers: { overlay: ((e: CueEvent) => void) | null; scene: ((e: CueEvent) => void) | null } = {
    overlay: null,
    scene: null,
  };
  let orphaned = 0;
  let disposed = false;
  return {
    emit(e) {
      if (disposed) {
        return;
      }
      subscribers.scene?.(e);
      if (subscribers.overlay !== null) {
        subscribers.overlay(e);
        return;
      }
      held.push(e);
      if (held.length > CUE_HOLD_MAX) {
        held.shift();
        orphaned += 1;
      }
    },
    subscribe(role, fn) {
      if (role === 'overlay') {
        // The overlay is set after the replay, so a cue emitted while it runs is held and replayed after the earlier ones.
        subscribers.overlay = null;
        for (let e = held.shift(); e !== undefined; e = held.shift()) {
          fn(e);
        }
      }
      subscribers[role] = fn;
      return () => {
        if (subscribers[role] === fn) {
          subscribers[role] = null;
        }
      };
    },
    orphans() {
      return orphaned;
    },
    dispose() {
      disposed = true;
      orphaned += held.length;
      held.length = 0;
      subscribers.overlay = null;
      subscribers.scene = null;
    },
  };
}
