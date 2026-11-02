// The revive flow (MEMORY-PLAN M2, sections 6 and 8 A2): after a GPU context change the controller drives it, and it
// is the one owner of the running revive's AbortController and of the frame suspension. Each pass that settles (done
// or aborted, current or superseded) calls `reacquire()`, so a view of an ended record leaves the stage before any
// later frame; only the current revive's visible pass settling 'done' lets frames draw again. Pure: no Pixi, no GSAP,
// no fetch (arch rules), so it is tested in node over a fake revive.
import type { ReviveEnd } from './registry.ts';

export type ReviveFlowDeps = {
  /** `registry.revive` (or the controller's wrapper around it). */
  revive(gen: number, signal: AbortSignal): { visible: Promise<ReviveEnd>; all: Promise<ReviveEnd> };
  /** `executor.reacquire`: void, so no step can wait for the executor's chain. */
  reacquire(): void;
  /** The controller: frames may draw again (requestRender). */
  resume(): void;
};

export interface ReviveFlow {
  /** `webglcontextlost`, a rebuild's start, a restore while deactivated: aborts the current revive, suspends frames. */
  lost(): void;
  /** Aborts the current revive, suspends frames and starts `revive(gen)`. */
  start(gen: number): void;
  /** `deactivated`: aborts the current revive; the suspension is unchanged. */
  abort(): void;
  /** The render gate reads it (with the context's `lost`); false until the first lost() / start(). */
  suspended(): boolean;
  /** A started revive whose passes have not both settled. */
  reviving(): boolean;
  /** Aborts; later calls are no-ops. */
  destroy(): void;
}

type Run = { readonly controller: AbortController; open: number };

export function createReviveFlow(deps: ReviveFlowDeps): ReviveFlow {
  let current: Run | null = null;
  let suspended = false;
  let dead = false;

  const stop = (): void => {
    current?.controller.abort();
  };

  return {
    lost() {
      if (dead) {
        return;
      }
      stop();
      suspended = true;
    },
    start(gen) {
      if (dead) {
        return;
      }
      stop();
      suspended = true;
      const run: Run = { controller: new AbortController(), open: 2 };
      current = run;
      const passes = deps.revive(gen, run.controller.signal);
      // Not awaited: each pass's continuation acts by itself; a superseded or aborted run resumes nothing.
      void passes.visible.then((end) => {
        run.open -= 1;
        if (dead) {
          return;
        }
        deps.reacquire();
        if (end === 'done' && current === run && !run.controller.signal.aborted) {
          suspended = false;
          deps.resume();
        }
      });
      void passes.all.then(() => {
        run.open -= 1;
        if (!dead) {
          deps.reacquire();
        }
      });
    },
    abort() {
      if (!dead) {
        stop();
      }
    },
    suspended: () => suspended,
    reviving: () => current !== null && current.open > 0,
    destroy() {
      if (dead) {
        return;
      }
      dead = true;
      stop();
    },
  };
}
