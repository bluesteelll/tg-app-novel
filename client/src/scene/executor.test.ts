import { gsap } from 'gsap/gsap-core';
import { expect, test, vi } from 'vitest';

import type { Size } from '../geom/cover.ts';
import type { ImageEntry, Result } from '../story/catalog.ts';
import type { AssetId, BgId, CgId, CharId, ExprId, PropId, Rect, Slot } from '../story/staging.ts';
import { createExecutor } from './executor.ts';
import type { Layer, Placement, StageAdapter, VisualCommand } from './executor.ts';
import { propPlacement } from './layout.ts';
import { createAssetRegistry } from './registry.ts';
import type { AssetError, LoadImage } from './registry.ts';
import { createRenderLoop } from './render-loop.ts';
import type { RenderLoop, Ticker } from './render-loop.ts';

// GSAP reads the clock through `Date.now`, captured when its module loads: fake timers installed before every import
// (vi.hoisted runs first) make its ticker deterministic. advance() moves the fake clock and runs one manual tick (V6).
vi.hoisted(() => {
  vi.useFakeTimers();
});
gsap.ticker.lagSmoothing(0);

const advance = (ms: number): void => {
  vi.setSystemTime(Date.now() + ms);
  gsap.ticker.tick();
};
/** Lets the registry's and the executor's promise chains run (no timers involved). */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 50; i += 1) {
    await Promise.resolve();
  }
};
/** Watches a promise: `done` turns true once it settles. */
const track = (p: Promise<void>): { done: boolean } => {
  const s = { done: false };
  void p.then(() => {
    s.done = true;
  });
  return s;
};

// ---------------------------------------------------------------------------------------------------------------
// A recording stage: live sprites per layer and per character group, an event log, and a throw on any write to a
// destroyed object or on a sprite over a released texture (Pixi would crash, or draw a dead texture, there).

type Tex = { readonly url: string };
type Node = { kind: 'sprite' | 'group'; layer: Layer | 'group'; key: string; group: number | null; alive: boolean; p: Placement };

const S390: Size = { w: 390, h: 844 };

/** `freed`: the textures whose Decoded.release() ran (by identity: every load decodes a new texture object). */
function recordingStage(size: Size, freed: ReadonlySet<Tex> = new Set()) {
  let n = 0;
  const log: string[] = [];
  const nodes = new Map<number, Node>();
  const stage = { size };
  const node = (k: number): Node => {
    const x = nodes.get(k);
    if (x === undefined || !x.alive) {
      throw new Error(`stage: node ${k} is not alive`);
    }
    return x;
  };
  // chars sprites log their character, every other sprite its asset name.
  const keyOf = (layer: Layer, id: AssetId): string => (layer === 'chars' ? (id.split('/')[1] ?? id) : (id.split('/').pop() ?? id));
  const adapter: StageAdapter<Tex> = {
    size: () => stage.size,
    group(char) {
      n += 1;
      nodes.set(n, { kind: 'group', layer: 'group', key: char, group: null, alive: true, p: {} });
      log.push(`group:${char}`);
      return { group: n };
    },
    dropGroup(g) {
      const x = node(g.group);
      x.alive = false;
      log.push(`drop:${x.key}`);
    },
    sprite(layer, tex, g) {
      if (freed.has(tex.texture)) {
        throw new Error(`stage: sprite on the released texture ${tex.texture.url}`);
      }
      if (g !== undefined) {
        node(g.group);
      }
      n += 1;
      const key = keyOf(layer, tex.id);
      nodes.set(n, { kind: 'sprite', layer, key, group: g?.group ?? null, alive: true, p: {} });
      log.push(`create:${layer}:${key}`);
      return { sprite: n };
    },
    destroy(s) {
      const x = node(s.sprite);
      x.alive = false;
      log.push(`destroy:${x.layer}:${x.key}`);
    },
    set(target, p) {
      Object.assign(node('sprite' in target ? target.sprite : target.group).p, p);
    },
    fx(alpha) {
      log.push(`fx:${alpha}`);
    },
  };
  const live = (layer: Layer): Node[] => [...nodes.values()].filter((x) => x.kind === 'sprite' && x.alive && x.layer === layer);
  const inGroup = (char: string): Node[] => {
    const groups = [...nodes.entries()].filter(([, x]) => x.kind === 'group' && x.alive && x.key === char).map(([k]) => k);
    return [...nodes.values()].filter((x) => x.kind === 'sprite' && x.alive && x.group !== null && groups.includes(x.group));
  };
  return { adapter, log, live, inGroup, stage };
}

// ---------------------------------------------------------------------------------------------------------------
// Assets: a fixture manifest, the real registry and a loader that decodes at once, counting loads and releases.

const image = (file: string, w: number, h: number): ImageEntry => ({
  kind: 'image',
  w,
  h,
  decodedBytes: w * h * 4,
  avif: { url: `/assets/${file}.avif`, bytes: 100 },
  webp: { url: `/assets/${file}.webp`, bytes: 120 },
});
const ENTRIES: Readonly<Record<string, ImageEntry>> = {
  'bg/cafe': image('bg_cafe', 1080, 2048),
  'bg/street': image('bg_street', 1080, 2048),
  'bg/room': image('bg_room', 1080, 2048),
  'bg/broken': image('bg_broken', 1080, 2048), // in the manifest, but its file fails to decode (harness load)
  'char/ally/neutral': image('char_ally_neutral', 768, 1536),
  'char/ally/worried': image('char_ally_worried', 768, 1536),
  'char/stranger/serious': image('char_stranger_serious', 768, 1536),
  'cg/letter': image('cg_letter', 1080, 2048),
  'prop/lamp': image('prop_lamp', 512, 512),
  'prop/key': image('prop_key', 256, 256),
};
const urlOf = (id: string): string => ENTRIES[id]?.avif.url ?? `missing:${id}`;

/** A loop on a ticker that never ticks: these tests watch the stage, not the frames. */
const quietLoop = (): RenderLoop => createRenderLoop({ ticker: { add: () => {}, remove: () => {} }, render: () => {} });

function harness(size: Size = S390, loop: RenderLoop = quietLoop()) {
  const freed = new Set<Tex>();
  const stage = recordingStage(size, freed);
  const loads = new Map<string, number>();
  const released = new Map<string, number>();
  const byUrl = new Map(Object.values(ENTRIES).map((e) => [e.avif.url, e]));
  const load: LoadImage<Tex> = (ref) => {
    loads.set(ref.url, (loads.get(ref.url) ?? 0) + 1);
    const e = byUrl.get(ref.url);
    if (e === undefined || ref.url === urlOf('bg/broken')) {
      return Promise.resolve({ ok: false, error: { kind: 'decode', detail: 'no such fixture' } });
    }
    const texture: Tex = { url: ref.url };
    const release = (): void => {
      released.set(ref.url, (released.get(ref.url) ?? 0) + 1);
      freed.add(texture);
    };
    return Promise.resolve({ ok: true, value: { texture, w: e.w, h: e.h, release } });
  };
  const registry = createAssetRegistry<Tex>({ load, variant: 'avif' });
  const resolve = (id: AssetId): Result<ImageEntry, AssetError> => {
    const e = Object.hasOwn(ENTRIES, id) ? ENTRIES[id] : undefined;
    return e === undefined ? { ok: false, error: { kind: 'missing-id', id } } : { ok: true, value: e };
  };
  const skipped: AssetError[] = [];
  const onSkip = (e: AssetError): void => {
    skipped.push(e);
  };
  const ex = createExecutor<Tex>({ adapter: stage.adapter, registry, resolve, loop, resolution: 2, onSkip });
  return {
    ...stage,
    freed,
    registry,
    ex,
    skipped,
    loadsOf: (id: string): number => loads.get(urlOf(id)) ?? 0,
    releasedOf: (id: string): number => released.get(urlOf(id)) ?? 0,
  };
}

// Commands as parseTags types them; the brands are earned by the parser in production.
const bg = (b: string, t: 'crossfade' | 'fade' | 'cut' = 'crossfade', ms = 500): VisualCommand => ({ kind: 'bg', bg: b as BgId, t, ms });
const scene = (b: string, t: 'fade' | 'cut' = 'fade', ms = 800): VisualCommand => ({ kind: 'scene', bg: b as BgId, t, ms });
const show = (c: string, e: string, at: Slot | null = null, t: 'fade' | 'cut' = 'fade', ms: number | null = null): VisualCommand => ({
  kind: 'show',
  char: c as CharId,
  expr: e as ExprId,
  at,
  t,
  ms,
});
const cg = (c: string | null, t: 'fade' | 'cut' = 'fade', ms = 500): VisualCommand => ({
  kind: 'cg',
  cg: c === null ? null : (c as CgId),
  t,
  ms,
});
const wait = (ms: number): VisualCommand => ({ kind: 'wait', ms });
const hide = (c: string, t: 'fade' | 'cut' = 'fade', ms = 300): VisualCommand => ({
  kind: 'hide',
  char: c === 'all' ? 'all' : (c as CharId),
  t,
  ms,
});
const props = (...ps: ReadonlyArray<readonly [string, Rect]>): VisualCommand => ({
  kind: 'props',
  props: ps.map(([prop, rect]) => ({ prop: prop as PropId, rect })),
});
const LAMP: Rect = [500, 900, 100, 100];
const KEY: Rect = [200, 1200, 120, 80];
const NOW = { instant: false };

// ---------------------------------------------------------------------------------------------------------------

test('executor_kills_timelines', async () => {
  const h = harness();
  const first = h.ex.apply([bg('cafe', 'crossfade', 500)], NOW);
  await flush();
  expect(h.ex.stats().activeTimelines).toBe(1);
  h.ex.complete();
  expect(h.ex.stats().activeTimelines).toBe(0);
  await first;

  // A batch left to run completes on its own and is killed.
  let secondDone = false;
  void h.ex.apply([bg('street', 'crossfade', 500)], NOW).then(() => {
    secondDone = true;
  });
  await flush();
  expect(h.ex.stats().activeTimelines).toBe(1);
  advance(600);
  await flush();
  expect(h.ex.stats().activeTimelines).toBe(0);
  expect(secondDone).toBe(true);

  // destroy() mid-transition kills it and settles its apply.
  let thirdDone = false;
  void h.ex.apply([bg('room', 'fade', 800), show('ally', 'neutral')], NOW).then(() => {
    thirdDone = true;
  });
  await flush();
  expect(h.ex.stats().activeTimelines).toBe(1);
  h.ex.destroy();
  expect(h.ex.stats().activeTimelines).toBe(0);
  await flush();
  expect(thirdDone).toBe(true);
  expect(gsap.globalTimeline.getChildren(true, true, true)).toEqual([]);
  expect(h.registry.stats()).toEqual({ live: 0, bytes: 0, pending: 0, overCap: 0 });
});

test('executor_sprite_count_per_slot', async () => {
  const h = harness();
  await h.ex.apply([show('ally', 'neutral', 'left', 'cut')], NOW);
  expect(h.inGroup('ally').length).toBe(1);
  const swap = h.ex.apply([show('ally', 'worried')], NOW);
  await flush();
  // The new expression fades in over the old one: two sprites in the character's group during the swap.
  expect(h.inGroup('ally').length).toBe(2);
  h.ex.complete();
  await swap;
  expect(h.inGroup('ally').length).toBe(1);
  expect(h.releasedOf('char/ally/neutral')).toBe(1);
  expect(h.releasedOf('char/ally/worried')).toBe(0);
  expect(h.registry.stats().live).toBe(1);
  h.ex.destroy();
  expect(h.releasedOf('char/ally/worried')).toBe(1);
});

test('executor: snapshot at batch start', async () => {
  const h = harness();
  const batch = h.ex.apply([scene('cafe'), show('ally', 'neutral', 'left')], NOW);
  // Before any time passes (and before any texture arrived) the snapshot is the batch's end state.
  const s = h.ex.snapshot();
  expect(s.bg).toBe('cafe');
  expect(s.chars).toEqual([{ char: 'ally', expr: 'neutral', at: 'left' }]);
  expect(s.cg).toBe(null);
  expect(s.props).toEqual([]);
  await flush();
  h.ex.complete();
  await batch;
  expect(h.ex.snapshot()).toEqual(s);
  h.ex.destroy();
});

test('executor: scene t=fade applies shows while black', async () => {
  const h = harness();
  await h.ex.apply([bg('street', 'cut'), show('stranger', 'serious', 'right', 'cut'), cg('letter', 'cut'), props(['lamp', LAMP])], NOW);
  h.log.length = 0;
  const batch = h.ex.apply([scene('cafe'), show('ally', 'neutral')], NOW);
  await flush();
  h.ex.complete();
  await batch;
  expect(h.log).toEqual([
    'fx:1',
    'destroy:chars:stranger',
    'drop:stranger',
    'destroy:cg:letter',
    'destroy:props:lamp',
    'destroy:bg:street',
    'create:bg:cafe',
    'group:ally',
    'create:chars:ally',
    'fx:0',
  ]);
  h.ex.destroy();
});

test('executor: fade through black changes the stage only at black', async () => {
  const h = harness();
  const isChange = (x: string): boolean => /^(create|destroy|group|drop):/.test(x);
  /** The last black-rect write before the first stage change. */
  const fxBeforeChange = (): string | undefined =>
    h.log
      .slice(0, h.log.findIndex(isChange))
      .filter((x) => x.startsWith('fx:'))
      .pop();
  await h.ex.apply([bg('street', 'cut'), show('stranger', 'serious', 'right', 'cut')], NOW);

  // `scene t=fade ms=800`: black fades in over 400 ms; nothing is hidden, shown or swapped before that.
  h.log.length = 0;
  const dip = h.ex.apply([scene('cafe', 'fade', 800), show('ally', 'neutral', 'left')], NOW);
  await flush();
  advance(100);
  advance(250);
  expect(h.log.some(isChange)).toBe(false);
  advance(100);
  expect(fxBeforeChange()).toBe('fx:1');
  expect(h.log.filter(isChange)).toEqual([
    'destroy:chars:stranger',
    'drop:stranger',
    'destroy:bg:street',
    'create:bg:cafe',
    'group:ally',
    'create:chars:ally',
  ]);
  h.ex.complete();
  await dip;

  // `bg t=fade ms=600` dips the same way: the swap waits for black at 300 ms.
  h.log.length = 0;
  const fade = h.ex.apply([bg('room', 'fade', 600)], NOW);
  await flush();
  advance(250);
  expect(h.log.some(isChange)).toBe(false);
  advance(100);
  expect(fxBeforeChange()).toBe('fx:1');
  expect(h.log.filter(isChange)).toEqual(['destroy:bg:cafe', 'create:bg:room']);
  h.ex.complete();
  await fade;
  h.ex.destroy();
});

test('executor: a fade through black ends after its whole duration', async () => {
  const h = harness();
  await h.ex.apply([bg('cafe', 'cut')], NOW);
  // `bg t=fade ms=600`: black in over 300 ms, black out over 300 ms; GameSession waits on this batch before the text,
  // so its end is pinned from both sides (a black-out that is longer or shorter moves the text and every `wait`).
  const fade = track(h.ex.apply([bg('room', 'fade', 600)], NOW));
  await flush();
  advance(550);
  await flush();
  expect(fade.done).toBe(false);
  expect(h.ex.stats().activeTimelines).toBe(1);
  advance(100);
  await flush();
  expect(fade.done).toBe(true);
  expect(h.ex.stats().activeTimelines).toBe(0);
  h.ex.destroy();
});

test('executor: complete jumps to the end state and ends the wait', async () => {
  const h = harness();
  let settled = false;
  void h.ex.apply([bg('cafe', 'crossfade', 500), wait(1200)], NOW).then(() => {
    settled = true;
  });
  await flush();
  expect(h.ex.stats().activeTimelines).toBe(1);
  expect(h.live('bg')[0]?.p.alpha).toBe(0);
  h.ex.complete();
  await Promise.resolve();
  expect(settled).toBe(true);
  expect(h.live('bg').map((x) => x.p.alpha)).toEqual([1]);
  expect(h.ex.stats().activeTimelines).toBe(0);
  h.ex.destroy();
});

test('executor: a wait holds the batch after its transitions', async () => {
  const h = harness();
  // No transition: the batch holds for the wait alone.
  const held = track(h.ex.apply([bg('cafe', 'cut'), wait(1200)], NOW));
  await flush();
  advance(600);
  await flush();
  expect(held.done).toBe(false);
  advance(700);
  await flush();
  expect(held.done).toBe(true);
  // STAGING-DSL §7 step 4: the wait starts when the transitions end (500 ms crossfade, then 1200 ms).
  const after = track(h.ex.apply([bg('street', 'crossfade', 500), wait(1200)], NOW));
  await flush();
  advance(1600);
  await flush();
  expect(after.done).toBe(false);
  advance(200);
  await flush();
  expect(after.done).toBe(true);
  expect(h.ex.stats().activeTimelines).toBe(0);
  h.ex.destroy();
});

test('executor: skip mode and an early complete ignore the wait', async () => {
  const h = harness();
  const skipped = track(h.ex.apply([bg('cafe', 'cut'), wait(1200)], { instant: true }));
  await flush();
  expect(skipped.done).toBe(true);
  // complete() while the batch still waits for its texture: it builds instant, and its wait is skipped too.
  const early = track(h.ex.apply([bg('street', 'crossfade', 500), wait(1200)], NOW));
  h.ex.complete();
  await flush();
  expect(early.done).toBe(true);
  expect(h.live('bg').map((x) => ({ key: x.key, alpha: x.p.alpha }))).toEqual([{ key: 'street', alpha: 1 }]);
  expect(h.ex.stats().activeTimelines).toBe(0);
  h.ex.destroy();
});

test('executor: scene clears props', async () => {
  const h = harness();
  await h.ex.apply([bg('room', 'cut'), props(['lamp', LAMP], ['key', KEY])], NOW);
  expect(h.live('props').length).toBe(2);
  const batch = h.ex.apply([scene('cafe')], NOW);
  await flush();
  h.ex.complete();
  await batch;
  expect(h.live('props').length).toBe(0);
  expect(h.releasedOf('prop/lamp')).toBe(1);
  expect(h.releasedOf('prop/key')).toBe(1);
  expect(h.ex.snapshot().props).toEqual([]);
  h.ex.destroy();
});

test('executor: props survive restore', async () => {
  const h = harness();
  const saved = {
    bg: 'room' as BgId,
    cg: null,
    chars: [{ char: 'ally' as CharId, expr: 'neutral' as ExprId, at: 'right' as const }],
    props: [{ prop: 'lamp' as PropId, rect: LAMP }],
  };
  await h.ex.restore(saved);
  const lamp = h.live('props');
  expect(lamp.length).toBe(1);
  expect(lamp[0]?.p).toMatchObject({ ...propPlacement(S390, LAMP), alpha: 1 });
  expect(h.ex.snapshot().props).toEqual(saved.props);
  expect(h.ex.snapshot()).toEqual(saved);
  expect(h.live('bg').length).toBe(1);
  expect(h.inGroup('ally').length).toBe(1);
  expect(h.ex.stats().activeTimelines).toBe(0);
  h.ex.destroy();
});

test('executor: scene onto the same bg keeps its texture', async () => {
  const h = harness();
  await h.ex.apply([bg('cafe', 'cut'), show('ally', 'neutral', 'left', 'cut'), cg('letter', 'cut')], NOW);
  const [bgSprite] = h.live('bg');
  // `scene` onto the background already shown, re-showing the same expression at another slot.
  const batch = h.ex.apply([scene('cafe'), show('ally', 'neutral', 'right')], NOW);
  await flush();
  h.ex.complete();
  await batch;
  expect(h.releasedOf('bg/cafe')).toBe(0);
  expect(h.releasedOf('char/ally/neutral')).toBe(0);
  expect(h.releasedOf('cg/letter')).toBe(1);
  expect(h.live('bg')).toEqual([bgSprite]);
  expect(h.inGroup('ally').length).toBe(1);
  expect(h.registry.stats().live).toBe(2);
  // The same CG over itself, the same expression at its own slot: nothing is reloaded or released.
  await h.ex.apply([cg('letter', 'cut')], NOW);
  await h.ex.apply([cg('letter'), show('ally', 'neutral')], NOW);
  expect(h.releasedOf('cg/letter')).toBe(1);
  expect(h.live('cg').length).toBe(1);
  expect(h.loadsOf('bg/cafe')).toBe(1);
  expect(h.loadsOf('char/ally/neutral')).toBe(1);
  expect(h.ex.stats().activeTimelines).toBe(0);
  h.ex.destroy();
});

test('executor: props batch keeps the ids it names', async () => {
  const h = harness();
  await h.ex.apply([bg('room', 'cut'), props(['lamp', LAMP], ['key', KEY])], NOW);
  const lamp = h.live('props').find((x) => x.key === 'lamp');
  // A take: the room's props without the key.
  await h.ex.apply([props(['lamp', LAMP])], NOW);
  expect(h.releasedOf('prop/lamp')).toBe(0);
  expect(h.releasedOf('prop/key')).toBe(1);
  expect(h.live('props')).toEqual([lamp]);
  expect(h.loadsOf('prop/lamp')).toBe(1);
  h.ex.destroy();
});

test('executor: queued batches keep the textures they target', async () => {
  const h = harness();
  const errors: unknown[] = [];
  const spy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
    errors.push(a);
  });
  // Three batches before any texture arrived: each apply complete()s the earlier ones, which only marks an unbuilt
  // batch instant, so the first finishes (and sweeps) while the other two still wait in the queue.
  const batches = [bg('cafe', 'cut'), bg('street', 'cut'), bg('room', 'cut')].map((c) => h.ex.apply([c], NOW));
  await Promise.all(batches);
  spy.mockRestore();
  expect(errors).toEqual([]);
  expect(h.log.filter((x) => x.startsWith('create:bg:'))).toEqual(['create:bg:cafe', 'create:bg:street', 'create:bg:room']);
  expect(h.live('bg').map((x) => x.key)).toEqual(['room']);
  expect(['bg/cafe', 'bg/street', 'bg/room'].map(h.releasedOf)).toEqual([1, 1, 0]);
  expect(h.registry.stats().live).toBe(1);
  h.ex.destroy();
});

test('executor: a skipped replacement keeps the old visual and its texture', async () => {
  const h = harness();
  await h.ex.apply([bg('cafe', 'cut')], NOW);
  const shown = h.live('bg');
  // An id outside the manifest (cut), then a file that fails to decode (crossfade): the old background stays on
  // screen while the logical stage names the missing one, so its texture stays held.
  await h.ex.apply([bg('nope', 'cut')], NOW);
  await h.ex.apply([bg('broken', 'crossfade', 500)], NOW);
  expect(h.skipped.map((e) => e.kind)).toEqual(['missing-id', 'decode']);
  expect(h.ex.snapshot().bg).toBe('broken');
  expect(h.live('bg')).toEqual(shown);
  expect(h.releasedOf('bg/cafe')).toBe(0);
  expect(h.registry.stats().live).toBe(1);
  // The next background that loads replaces it, and only then is it freed.
  await h.ex.apply([bg('street', 'cut')], NOW);
  expect(h.live('bg').map((x) => x.key)).toEqual(['street']);
  expect(h.releasedOf('bg/cafe')).toBe(1);
  expect(h.registry.stats().live).toBe(1);
  h.ex.destroy();
});

test('render_loop_idles', async () => {
  const listeners = new Set<() => void>();
  const ticker: Ticker = {
    add: (fn) => {
      listeners.add(fn);
    },
    remove: (fn) => {
      listeners.delete(fn);
    },
  };
  const tick = (): void => {
    for (const fn of [...listeners]) {
      fn();
    }
  };
  let drawn = 0;
  const loop = createRenderLoop({
    ticker,
    render: () => {
      drawn += 1;
    },
  });
  const h = harness(S390, loop);
  expect(loop.stats().listening).toBe(false);

  const batch = h.ex.apply([bg('cafe', 'crossfade', 500)], NOW);
  await flush();
  // A timeline runs: a frame every tick.
  expect(loop.stats().listening).toBe(true);
  tick();
  tick();
  expect(loop.stats().frames).toBe(2);
  h.ex.complete();
  await batch;
  // One more frame shows the end state, then the listener goes.
  tick();
  expect(loop.stats().frames).toBe(3);
  expect(loop.stats().listening).toBe(false);
  tick();
  tick();
  tick();
  expect(loop.stats().frames).toBe(3);
  expect(listeners.size).toBe(0);

  // A change outside a timeline: exactly one frame, then idle again.
  loop.requestRender();
  expect(loop.stats().listening).toBe(true);
  tick();
  tick();
  expect(loop.stats().frames).toBe(4);
  expect(loop.stats().listening).toBe(false);
  expect(drawn).toBe(4);

  // An instant batch (no timeline) draws one frame too.
  await h.ex.apply([bg('street', 'cut')], NOW);
  tick();
  tick();
  expect(loop.stats().frames).toBe(5);
  expect(listeners.size).toBe(0);
  h.ex.destroy();
  loop.destroy();
});

test('executor: rebind re-creates the stage on a new adapter', async () => {
  const h = harness();
  await h.ex.apply([bg('room', 'cut'), show('ally', 'neutral', 'left', 'cut'), props(['lamp', LAMP])], NOW);
  const box = (x: { p: Placement }): Placement => ({ x: x.p.x, y: x.p.y, w: x.p.w, h: x.p.h });
  const before = [...h.live('bg'), ...h.inGroup('ally'), ...h.live('props')].map(box);
  const loaded = ['bg/room', 'char/ally/neutral', 'prop/lamp'].map(h.loadsOf);
  // The old stage died with its Application (context loss): nothing is destroyed on it, everything is made anew.
  const fresh = recordingStage(S390, h.freed);
  h.ex.rebind(fresh.adapter);
  const after = [...fresh.live('bg'), ...fresh.inGroup('ally'), ...fresh.live('props')];
  expect(after.length).toBe(3);
  expect(after.map(box)).toEqual(before);
  expect(after.map((x) => x.p.alpha)).toEqual([1, 1, 1]);
  expect(fresh.log.filter((e) => e.startsWith('destroy:'))).toEqual([]);
  // Every holder is kept: no load, no release.
  expect(['bg/room', 'char/ally/neutral', 'prop/lamp'].map(h.loadsOf)).toEqual(loaded);
  expect(['bg/room', 'char/ally/neutral', 'prop/lamp'].map(h.releasedOf)).toEqual([0, 0, 0]);
  expect(h.registry.stats().live).toBe(3);
  // From now on the executor drives the new stage.
  await h.ex.apply([hide('ally', 'cut')], NOW);
  expect(fresh.inGroup('ally').length).toBe(0);
  expect(h.releasedOf('char/ally/neutral')).toBe(1);
  h.ex.destroy();
  expect(fresh.live('bg').length + fresh.live('props').length).toBe(0);
});

test('executor: prop rects in stage px', async () => {
  const h = harness();
  await h.ex.apply([bg('room', 'cut'), props(['lamp', LAMP], ['key', KEY])], NOW);
  expect(h.ex.propRects()).toEqual([
    { prop: 'lamp', ...propPlacement(S390, LAMP) },
    { prop: 'key', ...propPlacement(S390, KEY) },
  ]);
  const small = { w: 320, h: 568 };
  h.stage.size = small;
  h.ex.relayout();
  expect(h.ex.propRects()).toEqual([
    { prop: 'lamp', ...propPlacement(small, LAMP) },
    { prop: 'key', ...propPlacement(small, KEY) },
  ]);
  // The sprites moved with them.
  expect(h.live('props').map((x) => ({ x: x.p.x, y: x.p.y, w: x.p.w, h: x.p.h }))).toEqual([
    propPlacement(small, LAMP),
    propPlacement(small, KEY),
  ]);
  h.ex.destroy();
});
