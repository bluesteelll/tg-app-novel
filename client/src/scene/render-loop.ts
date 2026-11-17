// On-demand rendering (PROTOTYPE-PLAN K6): a frame is drawn on the ticker only while a timeline runs, the stage was
// changed since the last frame, or an ambient source needs one; otherwise the listener is removed and no frames are
// drawn. The ticker is injected (the executor's GSAP ticker in the app, a fake in tests), so this module imports neither
// gsap nor Pixi.
// Ambient sources (shots plan SH7, R-A9; CH §6.3): a discrete source (a face's blinks) is drawn once at each change it
// announces, by one timer for the soonest; a continuous one at most AMBIENT_FPS while it is not held. Holds: frozen
// holds every source, a 'panel' cover every layer, a 'cg' cover the stage's layer only, and idle (no activity for
// IDLE_AFTER_MS) the continuous sources. Two clocks: `t` (paused time excluded) for discrete sources, and per layer
// `tc` (also without its held and idle spans) for continuous ones, so each resumes at the phase it held.

/** The subset of a frame ticker the loop needs (gsap.ticker behind `gsapTicker` in executor.ts). */
export type Ticker = { add(fn: () => void): void; remove(fn: () => void): void };

/** The stage's sources sit under a CG; the top layer's above it. */
export type AmbientLayer = 'stage' | 'top';
/** `t`: the loop's clock, paused time excluded; `tc`: the source's layer clock, held and idle spans excluded too. */
export type AmbientTime = { readonly t: number; readonly tc: number };
export type AmbientMode = { readonly frozen: boolean; readonly reduced: boolean; readonly idle: boolean; readonly covered: boolean };
export interface AmbientSource {
  readonly layer: AmbientLayer;
  /** Drawn every frame the cap allows while not held (breathing, sway); a discrete one only at its changes. */
  continuous(): boolean;
  /** Applies the source's state at `time`; called on drawn ticks only, while the source is not held. */
  step(time: AmbientTime): void;
  /** Ms to the source's next change; null for none. */
  nextChangeMs(time: AmbientTime): number | null;
  /** The loop's mode changed; true when the call changed pixels (then the loop draws one frame). */
  setMode(m: AmbientMode): boolean;
}
/** What covers the stage: the opaque puzzle frame (every layer) or a CG (the stage's layer). */
export type CoverReason = 'panel' | 'cg';

/** The continuous sources' frame cap per perf class (S-D defaults, `08-spikes.md:14`). */
export const AMBIENT_FPS = { LOW: 20, AVERAGE: 30, HIGH: 30 } as const;
/** No activity this long (t) holds the continuous sources. */
export const IDLE_AFTER_MS = 60_000;

export interface RenderLoop {
  /** The stage changed outside a timeline: draw one frame. */
  requestRender(): void;
  /** A timeline started: draw every tick until its end(). */
  begin(): void;
  /** A timeline ended: one more frame shows its end state. */
  end(): void;
  /** `deactivated`: no frames until resume(). */
  pause(): void;
  /** `activated`: activity, and a frame when anything is not held. */
  resume(): void;
  /** Registers a source with the loop's current mode; requests no frame. The returned function removes it. */
  addAmbient(s: AmbientSource): () => void;
  /** A player input or a story step: the idle clock restarts, and the discrete timer is armed again. */
  activity(): void;
  setCovered(reason: CoverReason, on: boolean): void;
  setAnimation(a: { readonly frozen?: boolean; readonly reduced?: boolean }): void;
  /** The loop's clock `t` now (ms, paused time excluded). */
  time(): number;
  /** `frames`: renders; `ambientFrames`: renders that drew a stepped source; `ambientSources`: held ones included. */
  stats(): { listening: boolean; frames: number; ambientFrames: number; ambientSources: number };
  destroy(): void;
}

export type RenderLoopDeps = {
  ticker: Ticker;
  /** One frame; `false`: the frame was gated and nothing was drawn. */
  render(): boolean | void;
  /** Ms, monotonic (`performance.now` by default). */
  now?(): number;
  /** The discrete sources' timer (setTimeout by default). */
  timer?: { set(fn: () => void, ms: number): unknown; clear(h: unknown): void };
  /** Where a player's pointerdown and keydown count as activity (capture listeners, removed at destroy). */
  input?: EventTarget;
  /** The continuous sources' cap (AMBIENT_FPS.AVERAGE by default). */
  fps?: number;
};

const LAYERS: readonly AmbientLayer[] = ['stage', 'top'];
const systemTimer: NonNullable<RenderLoopDeps['timer']> = {
  set: (fn, ms) => setTimeout(fn, ms),
  // The handle is the one `set` returned: setTimeout's own.
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export function createRenderLoop(deps: RenderLoopDeps): RenderLoop {
  const now = deps.now ?? (() => performance.now());
  const timer = deps.timer ?? systemTimer;
  const fps = deps.fps ?? AMBIENT_FPS.AVERAGE;
  let active = 0;
  let dirty = false;
  let listening = false;
  let paused = false;
  let dead = false;
  let frames = 0;
  let ambientFrames = 0;
  /** A discrete source's change came due (or the loop resumed): the next tick draws whatever the cap. */
  let due = false;
  let lastDraw = Number.NEGATIVE_INFINITY;
  let armed: { readonly h: unknown } | null = null;
  const sources = new Set<AmbientSource>();
  let frozen = false;
  let reduced = false;
  const covers = new Set<CoverReason>();

  let pausedTotal = 0;
  let pausedAt: number | null = null;
  const time = (): number => (pausedAt ?? now()) - pausedTotal;
  let lastActivity = time();
  /** Per layer: the stopped time counted up to `mark` (t); the span after it is counted from the state now. */
  const clocks: Record<AmbientLayer, { stopped: number; mark: number }> = {
    stage: { stopped: 0, mark: lastActivity },
    top: { stopped: 0, mark: lastActivity },
  };

  const held = (layer: AmbientLayer): boolean => frozen || covers.has('panel') || (layer === 'stage' && covers.has('cg'));
  const idleAt = (t: number): boolean => t - lastActivity >= IDLE_AFTER_MS;
  /** The time in [from, to] a layer's continuous clock stood: all of it while held, else its idle part. */
  const stoppedIn = (layer: AmbientLayer, from: number, to: number): number =>
    held(layer) ? to - from : Math.max(0, to - Math.max(from, lastActivity + IDLE_AFTER_MS));
  /** Counts each layer's stopped time up to now; called before any hold or the activity changes. */
  const settle = (): void => {
    const t = time();
    for (const layer of LAYERS) {
      const c = clocks[layer];
      c.stopped += stoppedIn(layer, c.mark, t);
      c.mark = t;
    }
  };
  const timeOf = (s: AmbientSource, t: number): AmbientTime => {
    const c = clocks[s.layer];
    return { t, tc: t - c.stopped - stoppedIn(s.layer, c.mark, t) };
  };
  const modeOf = (s: AmbientSource, t: number): AmbientMode => ({
    frozen,
    reduced,
    idle: idleAt(t),
    covered: covers.has('panel') || (s.layer === 'stage' && covers.has('cg')),
  });
  /** Stepped now: its layer is not held, and a continuous one is not idle. */
  const live = (s: AmbientSource, t: number): boolean => !held(s.layer) && !(s.continuous() && idleAt(t));
  const liveContinuous = (t: number): boolean => [...sources].some((s) => s.continuous() && live(s, t));

  const stop = (): void => {
    if (listening) {
      deps.ticker.remove(onTick);
      listening = false;
    }
  };
  const listen = (): void => {
    if (!listening && !paused && !dead) {
      deps.ticker.add(onTick);
      listening = true;
    }
  };
  const disarm = (): void => {
    if (armed !== null) {
      timer.clear(armed.h);
      armed = null;
    }
  };
  const fire = (): void => {
    armed = null;
    due = true;
    listen();
  };
  /** One timer for the soonest change of the sources not held. */
  const arm = (): void => {
    disarm();
    if (paused || dead) {
      return;
    }
    const t = time();
    let least = Number.POSITIVE_INFINITY;
    for (const s of sources) {
      const ms = live(s, t) ? s.nextChangeMs(timeOf(s, t)) : null;
      if (ms !== null && ms < least) {
        least = ms;
      }
    }
    if (least !== Number.POSITIVE_INFINITY) {
      armed = { h: timer.set(fire, Math.max(0, least)) };
    }
  };
  /** Every source hears the mode; a source that changed pixels gets one frame (none while paused: resume draws it). */
  const remode = (): void => {
    const t = time();
    let changed = false;
    for (const s of sources) {
      changed = s.setMode(modeOf(s, t)) || changed;
    }
    if (changed) {
      dirty = true;
    }
    if (paused) {
      return;
    }
    if (changed || liveContinuous(t)) {
      listen();
    }
    arm();
  };

  function onTick(): void {
    const n = now();
    const t = time();
    const continuous = liveContinuous(t);
    if (!(active > 0 || dirty || due) && !(continuous && n - lastDraw >= 1000 / fps - 1)) {
      if (!continuous) {
        stop();
      }
      return;
    }
    let stepped = false;
    for (const s of sources) {
      if (live(s, t)) {
        s.step(timeOf(s, t));
        stepped = true;
      }
    }
    const drew = deps.render() !== false;
    frames += 1;
    if (drew && stepped) {
      ambientFrames += 1;
    }
    lastDraw = n;
    dirty = false;
    due = false;
    if (stepped || armed === null) {
      arm();
    }
    if (active === 0 && !continuous) {
      stop();
    }
  }

  const loop: RenderLoop = {
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
      if (!paused) {
        settle();
        pausedAt = now();
        paused = true;
      }
      stop();
      disarm();
    },
    resume() {
      if (paused) {
        pausedTotal += now() - (pausedAt ?? now());
        pausedAt = null;
        paused = false;
      }
      // `activated` is activity: the idle clock restarts, so motion is back at once.
      settle();
      lastActivity = time();
      if ([...sources].some((s) => live(s, lastActivity))) {
        due = true;
      }
      if (active > 0 || dirty || due) {
        listen();
      }
      arm();
    },
    addAmbient(s) {
      const t = time();
      sources.add(s);
      s.setMode(modeOf(s, t));
      if (s.continuous() && live(s, t)) {
        listen();
      }
      arm();
      return () => {
        if (sources.delete(s)) {
          arm();
        }
      };
    },
    activity() {
      if (dead) {
        return;
      }
      settle();
      lastActivity = time();
      if (liveContinuous(lastActivity)) {
        listen();
      }
      arm();
    },
    setCovered(reason, on) {
      if (covers.has(reason) === on) {
        return;
      }
      settle();
      const t = time();
      const stood = on ? [] : [...sources].filter((s) => !live(s, t));
      if (on) {
        covers.add(reason);
      } else {
        covers.delete(reason);
      }
      // An uncover steps every source it held that is live now on the next tick, as resume() does: a change that came due
      // under the cover (a face's blink ending) is drawn at once, not at the source's next change. A source still held
      // (another cover, frozen) stays held; while paused, resume() draws it.
      if (!paused && stood.some((s) => live(s, t))) {
        due = true;
        listen();
      }
      remode();
    },
    setAnimation(a) {
      settle();
      frozen = a.frozen ?? frozen;
      reduced = a.reduced ?? reduced;
      remode();
    },
    time,
    stats() {
      return { listening, frames, ambientFrames, ambientSources: sources.size };
    },
    destroy() {
      dead = true;
      stop();
      disarm();
      active = 0;
      dirty = false;
      sources.clear();
      deps.input?.removeEventListener('pointerdown', onInput, { capture: true });
      deps.input?.removeEventListener('keydown', onInput, { capture: true });
    },
  };
  function onInput(): void {
    loop.activity();
  }
  deps.input?.addEventListener('pointerdown', onInput, { capture: true });
  deps.input?.addEventListener('keydown', onInput, { capture: true });
  return loop;
}
