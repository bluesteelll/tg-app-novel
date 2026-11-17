// The render loop's ambient sources (lane SH7, R-A9; D6, D7, D8): a fake clock, timer and ticker, and fake sources
// that record what the loop hands them. `run` plays a 60 Hz display: per frame the clock moves, due timers fire, then
// the ticker ticks once.
import { expect, test } from 'vitest';

import { AMBIENT_FPS, IDLE_AFTER_MS, createRenderLoop } from './render-loop.ts';
import type { AmbientLayer, AmbientMode, AmbientSource, AmbientTime, Ticker } from './render-loop.ts';

const FRAME_MS = 1000 / 60;

function rig(o: { fps?: number; gate?: () => boolean; input?: EventTarget } = {}) {
  let clock = 0;
  const listeners = new Set<() => void>();
  const ticker: Ticker = {
    add: (fn) => {
      listeners.add(fn);
    },
    remove: (fn) => {
      listeners.delete(fn);
    },
  };
  let id = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const timer = {
    set: (fn: () => void, ms: number): unknown => {
      id += 1;
      timers.set(id, { at: clock + ms, fn });
      return id;
    },
    clear: (h: unknown): void => {
      timers.delete(h as number); // the handle `set` returned
    },
  };
  let renders = 0;
  const loop = createRenderLoop({
    ticker,
    render: () => {
      renders += 1;
      return o.gate?.() ?? true;
    },
    now: () => clock,
    timer,
    ...(o.fps === undefined ? {} : { fps: o.fps }),
    ...(o.input === undefined ? {} : { input: o.input }),
  });
  const tick = (): void => {
    for (const fn of [...listeners]) {
      fn();
    }
  };
  /** Due timers in time order, each at its own time. */
  const fireDue = (): void => {
    for (;;) {
      const next = [...timers].filter(([, x]) => x.at <= clock).sort((a, b) => a[1].at - b[1].at)[0];
      if (next === undefined) {
        return;
      }
      timers.delete(next[0]);
      next[1].fn();
    }
  };
  /** `ms` of display frames. */
  const run = (ms: number): void => {
    const end = clock + ms;
    while (clock + FRAME_MS <= end + 1e-9) {
      clock += FRAME_MS;
      fireDue();
      tick();
    }
  };
  /** Time passes with no frame (a paused page). */
  const skip = (ms: number): void => {
    clock += ms;
  };
  return { loop, run, skip, tick, now: () => clock, listening: () => listeners.size > 0, renders: () => renders, armed: () => timers.size };
}

/** A fake source: its steps' times, the modes it heard; a discrete one changes at every multiple of `every` ms of t. */
function source(o: { layer?: AmbientLayer; continuous?: boolean; every?: number; hides?: boolean } = {}) {
  const steps: AmbientTime[] = [];
  const modes: AmbientMode[] = [];
  let shown = true;
  const s: AmbientSource = {
    layer: o.layer ?? 'stage',
    continuous: () => o.continuous === true,
    step: (time) => {
      steps.push(time);
      shown = true;
    },
    nextChangeMs: (time) => (o.every === undefined ? null : o.every - (time.t % o.every)),
    setMode: (m) => {
      modes.push(m);
      const hid = o.hides === true && m.frozen && shown;
      if (m.frozen) {
        shown = false;
      }
      return hid;
    },
  };
  return { s, steps, modes, last: (): AmbientTime | undefined => steps[steps.length - 1] };
}

test('render-loop: continuous sources draw at most AMBIENT_FPS', () => {
  for (const fps of [AMBIENT_FPS.AVERAGE, AMBIENT_FPS.LOW]) {
    const r = rig({ fps });
    const c = source({ continuous: true });
    r.loop.addAmbient(c.s);
    r.run(1000);
    const one = r.loop.stats().ambientFrames;
    expect(one).toBeLessThanOrEqual(fps);
    expect(one).toBeGreaterThanOrEqual(fps - 2);
    expect(c.steps).toHaveLength(one);
    // Arm: a running timeline draws every tick beside them, the batch at full rate.
    const frames = r.loop.stats().frames;
    r.loop.begin();
    r.run(500);
    expect(r.loop.stats().frames - frames).toBe(30);
    r.loop.end();
    r.run(1000);
    expect(r.loop.stats().frames - frames).toBeLessThanOrEqual(30 + 1 + fps);
    r.loop.destroy();
  }
});

test('render-loop: idle after 60 s holds continuous time', () => {
  const r = rig();
  const c = source({ continuous: true });
  const d = source({ every: 5_000 });
  r.loop.addAmbient(c.s);
  r.loop.addAmbient(d.s);
  r.run(IDLE_AFTER_MS - 1_000);
  expect(r.listening()).toBe(true);
  r.run(2_000);
  // Idle: the continuous source is held, the loop rests, and its clock stood at the idle start.
  const held = c.steps.length;
  expect(r.listening()).toBe(false);
  expect(c.last()?.tc).toBeLessThanOrEqual(IDLE_AFTER_MS);
  const blinks = d.steps.length;
  r.run(20_000);
  expect(c.steps).toHaveLength(held);
  // A discrete source runs on through idle.
  expect(d.steps.length).toBeGreaterThan(blinks);
  // Activity: the continuous source steps again, from the phase it held.
  r.loop.activity();
  expect(r.listening()).toBe(true);
  r.run(100);
  expect(c.steps.length).toBeGreaterThan(held);
  const after = c.last();
  expect((after?.tc ?? 0) - IDLE_AFTER_MS).toBeLessThan(200);
  expect(after?.t).toBeGreaterThan(IDLE_AFTER_MS + 20_000);
  r.loop.destroy();
});

test('render-loop: a panel cover holds every source', () => {
  const r = rig();
  const stage = source({ continuous: true });
  const top = source({ continuous: true, layer: 'top' });
  const blink = source({ every: 300 });
  for (const x of [stage, top, blink]) {
    r.loop.addAmbient(x.s);
  }
  r.run(1_000);
  const counts = [stage, top, blink].map((x) => x.steps.length);
  expect(counts.every((n) => n > 0)).toBe(true);
  r.loop.setCovered('panel', true);
  expect([stage, top, blink].map((x) => x.modes[x.modes.length - 1]?.covered)).toEqual([true, true, true]);
  const frames = r.loop.stats().frames;
  r.run(2_000);
  expect([stage, top, blink].map((x) => x.steps.length)).toEqual(counts);
  expect(r.loop.stats().frames).toBe(frames);
  expect([r.listening(), r.armed()]).toEqual([false, 0]);
  r.loop.setCovered('panel', false);
  r.run(1_000);
  expect([stage, top, blink].every((x, i) => x.steps.length > (counts[i] ?? 0))).toBe(true);
  r.loop.destroy();
});

test("render-loop: a cg cover holds the stage's sources and runs the cover's own", () => {
  const r = rig();
  const stage = source({ continuous: true });
  const top = source({ continuous: true, layer: 'top' });
  r.loop.addAmbient(stage.s);
  r.loop.addAmbient(top.s);
  r.run(1_000);
  const held = stage.steps.length;
  const stageTc = stage.last()?.tc ?? 0;
  r.loop.setCovered('cg', true);
  expect([stage.modes[stage.modes.length - 1]?.covered, top.modes[top.modes.length - 1]?.covered]).toEqual([true, false]);
  const topSteps = top.steps.length;
  r.run(1_000);
  expect(stage.steps).toHaveLength(held);
  expect(top.steps.length).toBeGreaterThan(topSteps);
  // The top layer's clock runs under the CG; the stage's stood.
  expect((top.last()?.tc ?? 0) - (top.last()?.t ?? 0)).toBe(0);
  r.loop.setCovered('cg', false);
  r.run(100);
  const back = stage.last();
  expect((back?.tc ?? 0) - stageTc).toBeLessThan(150);
  expect((back?.t ?? 0) - (back?.tc ?? 0)).toBeGreaterThanOrEqual(1_000 - FRAME_MS);
  r.loop.destroy();
});

test('render-loop: each continuous clock resumes at the phase it held', () => {
  const r = rig();
  const c = source({ continuous: true });
  r.loop.addAmbient(c.s);
  r.run(1_000);
  const before = c.last()?.tc ?? 0;
  const coverAt = r.now();
  r.loop.setCovered('panel', true);
  r.run(500);
  const uncoverAt = r.now();
  r.loop.setCovered('panel', false);
  r.run(FRAME_MS * 3);
  const resumed = c.last();
  // The clock lost exactly the covered span: the source goes on from where it was.
  expect((resumed?.t ?? 0) - (resumed?.tc ?? 0)).toBeCloseTo(uncoverAt - coverAt, 6);
  expect((resumed?.tc ?? 0) - before).toBeLessThan(100);
  // Arm: an idle span and a cover that overlap stand the clock once, over their union.
  const o = rig();
  const s = source({ continuous: true });
  o.loop.addAmbient(s.s);
  o.run(IDLE_AFTER_MS - 1_000);
  const from = o.now();
  o.loop.setCovered('panel', true);
  o.run(2_000);
  o.loop.setCovered('panel', false);
  o.run(1_000);
  const to = o.now();
  o.loop.activity();
  o.run(FRAME_MS * 3);
  const last = s.last();
  // Covered [from, from + 2000], idle [60000, to]: one span [from, to].
  expect((last?.t ?? 0) - (last?.tc ?? 0)).toBeCloseTo(to - from, 6);
  o.loop.destroy();
  r.loop.destroy();
});

test('render-loop: frozen draws no ambient frame', () => {
  const r = rig();
  const c = source({ continuous: true });
  const d = source({ every: 400 });
  r.loop.addAmbient(c.s);
  r.loop.addAmbient(d.s);
  r.loop.setAnimation({ frozen: true });
  expect([c.modes[c.modes.length - 1]?.frozen, d.modes[d.modes.length - 1]?.frozen]).toEqual([true, true]);
  r.run(200);
  const frames = r.loop.stats().frames;
  r.run(10_000);
  // At rest: nothing stepped, nothing drawn, no listener and no timer.
  expect(r.loop.stats()).toEqual({ listening: false, frames, ambientFrames: 0, ambientSources: 2 });
  expect([c.steps.length, d.steps.length, r.armed()]).toEqual([0, 0, 0]);
  // A batch still draws under frozen (the camera, cuts and dissolves are not the loop's to hold).
  r.loop.requestRender();
  r.run(100);
  expect(r.loop.stats().frames).toBe(frames + 1);
  expect(r.loop.stats().ambientFrames).toBe(0);
  // Live again: the sources step.
  r.loop.setAnimation({ frozen: false });
  r.run(1_000);
  expect(c.steps.length).toBeGreaterThan(0);
  expect(r.loop.stats().ambientFrames).toBeGreaterThan(0);
  r.loop.destroy();
});

test('render-loop: resume re-listens for a registered unheld source', () => {
  const r = rig();
  const d = source({ every: 4_000 });
  r.loop.addAmbient(d.s);
  r.run(100);
  r.loop.pause();
  expect([r.listening(), r.armed()]).toEqual([false, 0]);
  r.skip(10_000);
  r.loop.resume();
  // Neither a timeline nor a change: the registered source alone brings a frame back at once.
  expect(r.listening()).toBe(true);
  const steps = d.steps.length;
  r.run(FRAME_MS);
  expect(d.steps.length).toBe(steps + 1);
  expect(r.listening()).toBe(false);
  expect(r.armed()).toBe(1);
  // A held source brings none.
  r.loop.setAnimation({ frozen: true });
  r.loop.pause();
  r.loop.resume();
  expect(r.listening()).toBe(false);
  r.loop.destroy();
});

test('render-loop: paused time never counts toward idle and activated restarts it', () => {
  const r = rig();
  const c = source({ continuous: true });
  r.loop.addAmbient(c.s);
  r.run(30_000);
  r.loop.pause();
  r.skip(120_000);
  r.loop.resume();
  r.run(1_000);
  // The paused two minutes are not in the clocks.
  const back = c.last();
  expect(back?.t).toBeLessThan(32_000);
  expect(back?.tc).toBeLessThan(32_000);
  // Idle counts again from `activated`: 59 s on the source still runs, at 61 s it is held.
  r.run(IDLE_AFTER_MS - 2_000);
  const running = c.steps.length;
  r.run(500);
  expect(c.steps.length).toBeGreaterThan(running);
  r.run(2_000);
  const idle = c.steps.length;
  r.run(1_000);
  expect(c.steps).toHaveLength(idle);
  r.loop.destroy();
});

test('render-loop: a cover set while paused draws no frame', () => {
  const r = rig();
  const d = source({ every: 500 });
  const c = source({ continuous: true });
  r.loop.addAmbient(d.s);
  r.loop.addAmbient(c.s);
  r.run(1_000);
  r.loop.pause();
  const frames = r.loop.stats().frames;
  r.loop.setCovered('panel', true);
  // Recorded: the sources heard it; nothing listens and no timer is armed while paused.
  expect([d.modes[d.modes.length - 1]?.covered, c.modes[c.modes.length - 1]?.covered]).toEqual([true, true]);
  expect([r.listening(), r.armed()]).toEqual([false, 0]);
  r.tick();
  r.run(1_000);
  expect(r.loop.stats().frames).toBe(frames);
  // Resumed under the cover: every source is held, so still no frame.
  r.loop.resume();
  r.run(1_000);
  expect(r.loop.stats().frames).toBe(frames);
  r.loop.destroy();
});

// Review r1 M1 (triage r4 L1): a discrete source whose changes came due under a cover is stepped and drawn on the first
// tick after the uncover, as resume() does, not at its next change; a source another hold still holds is not.
test('render-loop: an uncover steps the sources it held on the next tick', () => {
  for (const reason of ['panel', 'cg'] as const) {
    const r = rig();
    const d = source({ every: 1_000 });
    r.loop.addAmbient(d.s);
    r.run(500);
    r.loop.setCovered(reason, true);
    // Its changes at 1 s and 2 s come due under the cover; the next is at 3 s.
    r.run(2_200);
    const [steps, frames] = [d.steps.length, r.loop.stats().frames];
    expect(steps).toBe(0);
    r.loop.setCovered(reason, false);
    r.run(FRAME_MS);
    expect.soft([d.steps.length - steps, r.loop.stats().frames - frames], `${reason}: stepped and drawn at the uncover`).toEqual([1, 1]);
    // Then it rests until its next change.
    expect.soft([r.listening(), r.armed()], `${reason}: at rest after the uncover`).toEqual([false, 1]);
    r.loop.destroy();
  }
  // Two covers: the panel lifts, the CG stays. The top layer's source is stepped; the stage's, still under the CG, is not.
  const r = rig();
  const stage = source({ every: 1_000 });
  const top = source({ every: 1_000, layer: 'top' });
  r.loop.addAmbient(stage.s);
  r.loop.addAmbient(top.s);
  r.run(500);
  r.loop.setCovered('cg', true);
  r.loop.setCovered('panel', true);
  r.run(2_200);
  r.loop.setCovered('panel', false);
  r.run(FRAME_MS);
  expect.soft([stage.steps.length, top.steps.length], 'the panel lifted under a CG').toEqual([0, 1]);
  // Frozen holds every source through an uncover: no step and no frame.
  r.loop.setAnimation({ frozen: true });
  r.run(1_000);
  const frozen = r.loop.stats().frames;
  r.loop.setCovered('cg', false);
  r.run(1_000);
  expect.soft([stage.steps.length, r.loop.stats().frames - frozen], 'the CG lifted while frozen').toEqual([0, 0]);
  // Paused: the uncover draws nothing until resume, which steps the source.
  r.loop.setAnimation({ frozen: false });
  r.loop.setCovered('cg', true);
  r.run(1_000);
  r.loop.pause();
  const paused = [stage.steps.length, r.loop.stats().frames];
  r.loop.setCovered('cg', false);
  r.tick();
  expect.soft([r.listening(), stage.steps.length, r.loop.stats().frames], 'the CG lifted while paused').toEqual([false, ...paused]);
  r.loop.resume();
  r.run(FRAME_MS);
  expect.soft(stage.steps.length - (paused[0] ?? 0), 'resumed: the stage source stepped').toBe(1);
  r.loop.destroy();
  // Triage r5 F1: an uncover under pause leaves nothing behind for resume(). The source is held again by another cover
  // before resume, so resume() neither steps it nor draws.
  {
    const q = rig();
    const d = source({ every: 1_000 });
    q.loop.addAmbient(d.s);
    q.run(500);
    q.loop.setCovered('cg', true);
    q.run(2_200);
    q.loop.pause();
    q.loop.setCovered('cg', false);
    q.loop.setCovered('panel', true);
    q.loop.resume();
    const frames = q.loop.stats().frames;
    q.run(100);
    expect.soft([d.steps.length, q.loop.stats().frames - frames], 'uncovered and held again while paused').toEqual([0, 0]);
    q.loop.destroy();
  }
  // Triage r5 F2: an uncover steps only the sources that cover held. A CG never holds a top-layer source, so its uncover
  // neither steps that live source nor draws (its next change is at 1 s).
  {
    const q = rig();
    const top = source({ every: 1_000, layer: 'top' });
    q.loop.addAmbient(top.s);
    q.run(500);
    q.loop.setCovered('cg', true);
    const [steps, frames] = [top.steps.length, q.loop.stats().frames];
    q.loop.setCovered('cg', false);
    q.run(100);
    expect.soft([top.steps.length - steps, q.loop.stats().frames - frames], 'a CG lifted over a live top source').toEqual([0, 0]);
    q.loop.destroy();
  }
});

test('render-loop: a gated tick is not an ambient frame', () => {
  let open = false;
  const r = rig({ gate: () => open });
  const d = source({ every: 1_000 });
  r.loop.addAmbient(d.s);
  r.run(3_500);
  // The source stepped and the loop asked for frames, but the render was gated each time.
  expect(d.steps.length).toBeGreaterThan(0);
  expect(r.loop.stats().frames).toBe(d.steps.length);
  expect(r.loop.stats().ambientFrames).toBe(0);
  open = true;
  r.run(2_000);
  expect(r.loop.stats().ambientFrames).toBe(2);
  r.loop.destroy();
});

test('render-loop: a discrete source draws once at each change and the loop rests between', () => {
  const r = rig();
  const d = source({ every: 1_000 });
  r.loop.addAmbient(d.s);
  // Registering requests no frame.
  expect([r.listening(), r.armed()]).toEqual([false, 1]);
  r.run(5_500);
  expect(r.loop.stats()).toEqual({ listening: false, frames: 5, ambientFrames: 5, ambientSources: 1 });
  // Each at the first frame from its change.
  expect(d.steps.map((x, i) => x.t - (i + 1) * 1_000).every((late) => late >= 0 && late < FRAME_MS + 1e-6)).toBe(true);
  expect(r.armed()).toBe(1);
  // Removed: no timer, nothing drawn.
  const off = r.loop.addAmbient(source({ every: 700 }).s);
  off();
  r.run(2_000);
  expect(r.loop.stats().frames).toBe(7);
  expect(r.loop.stats().ambientSources).toBe(1);
  r.loop.destroy();
});

test('render-loop: a pointerdown or keydown on the input restarts the idle clock', () => {
  /** An EventTarget that records its listeners. */
  class Input extends EventTarget {
    readonly added: string[] = [];
    readonly removed: string[] = [];
    override addEventListener(type: string, fn: EventListenerOrEventListenerObject | null, o?: AddEventListenerOptions | boolean): void {
      this.added.push(type);
      super.addEventListener(type, fn, o);
    }
    override removeEventListener(type: string, fn: EventListenerOrEventListenerObject | null, o?: EventListenerOptions | boolean): void {
      this.removed.push(type);
      super.removeEventListener(type, fn, o);
    }
  }
  const input = new Input();
  const r = rig({ input });
  expect(input.added).toEqual(['pointerdown', 'keydown']);
  const c = source({ continuous: true });
  r.loop.addAmbient(c.s);
  r.run(IDLE_AFTER_MS - 1_000);
  input.dispatchEvent(new Event('pointerdown'));
  r.run(IDLE_AFTER_MS - 1_000);
  input.dispatchEvent(new Event('keydown'));
  r.run(IDLE_AFTER_MS - 1_000);
  // Never 60 s without input: the source never went idle.
  const steps = c.steps.length;
  r.run(500);
  expect(c.steps.length).toBeGreaterThan(steps);
  expect(r.listening()).toBe(true);
  r.loop.destroy();
  expect(input.removed).toEqual(['pointerdown', 'keydown']);
});
