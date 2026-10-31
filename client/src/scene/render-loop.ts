// On-demand rendering (PROTOTYPE-PLAN K6): a frame is drawn on the ticker only while a timeline runs or the stage was
// changed since the last frame; otherwise the listener is removed and no frames are drawn. The ticker is injected
// (the executor's GSAP ticker in the app, a fake in tests), so this module imports neither gsap nor Pixi.

/** The subset of a frame ticker the loop needs (gsap.ticker behind `gsapTicker` in executor.ts). */
export type Ticker = { add(fn: () => void): void; remove(fn: () => void): void };

export interface RenderLoop {
  /** The stage changed outside a timeline: draw one frame. */
  requestRender(): void;
  /** A timeline started: draw every tick until its end(). */
  begin(): void;
  /** A timeline ended: one more frame shows its end state. */
  end(): void;
  /** `deactivated`: no frames until resume(). */
  pause(): void;
  resume(): void;
  stats(): { listening: boolean; frames: number };
  destroy(): void;
}

export function createRenderLoop(deps: { ticker: Ticker; render(): void }): RenderLoop {
  let active = 0;
  let dirty = false;
  let listening = false;
  let paused = false;
  let dead = false;
  let frames = 0;

  const stop = (): void => {
    if (listening) {
      deps.ticker.remove(onTick);
      listening = false;
    }
  };
  function onTick(): void {
    deps.render();
    frames += 1;
    dirty = false;
    if (active === 0) {
      stop();
    }
  }
  const listen = (): void => {
    if (!listening && !paused && !dead) {
      deps.ticker.add(onTick);
      listening = true;
    }
  };

  return {
    requestRender() {
      dirty = true;
      listen();
    },
    begin() {
      active += 1;
      listen();
    },
    end() {
      active = Math.max(0, active - 1);
      dirty = true;
      listen();
    },
    pause() {
      paused = true;
      stop();
    },
    resume() {
      paused = false;
      if (active > 0 || dirty) {
        listen();
      }
    },
    stats() {
      return { listening, frames };
    },
    destroy() {
      dead = true;
      stop();
      active = 0;
      dirty = false;
    },
  };
}
