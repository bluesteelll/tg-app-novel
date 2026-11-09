import { gsap } from 'gsap/gsap-core';
import { expect, test, vi } from 'vitest';

import { ROOM_SOURCE } from '../geom/cover.ts';
import type { Size } from '../geom/cover.ts';
import type { AnchorKey } from '../mechanics/contract.ts';
import type { ImageEntry, Result } from '../story/catalog.ts';
import type { AssetId, BgId, CgId, CharId, ExprId, PropId, Rect, Slot } from '../story/staging.ts';
import { createExecutor } from './executor.ts';
import type { Layer, Placement, StageAdapter, VisualCommand } from './executor.ts';
import { backdropPlacement, propPlacement } from './layout.ts';
import { REVIVE_DEADLINE_MS, createAssetRegistry } from './registry.ts';
import type { AssetError, Decoded, LoadError, LoadImage } from './registry.ts';
import { createRenderLoop } from './render-loop.ts';
import type { RenderLoop, Ticker } from './render-loop.ts';
import { createReviveFlow } from './revive-flow.ts';

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
// A recording stage: every node (a character group, the four nodes of an anchor, a sprite) with its parent, an event
// log, the alpha writes, and a throw on any write to a destroyed node, on a sprite over a released texture (Pixi would
// crash, or draw a dead texture, there) and on a drop over a live sprite (the executor destroys the art first).

type Tex = { readonly url: string };
type Role = 'char' | 'anchor' | 'depth' | 'motion' | 'content' | 'sprite';
/** `parent`: null for a node at the top of its layer. */
type Node = {
  readonly id: number;
  readonly role: Role;
  readonly layer: Layer;
  readonly key: string;
  readonly parent: number | null;
  alive: boolean;
  p: Placement;
  readonly tex: Tex | null;
};

const S390: Size = { w: 390, h: 844 };

/** `freed`: the textures whose Decoded.release() ran (by identity: every load decodes a new texture object). */
function recordingStage(size: Size, freed: ReadonlySet<Tex> = new Set()) {
  let n = 0;
  const log: string[] = [];
  /** Every `set` that wrote an alpha: its target's role and key. */
  const alphas: Array<{ role: Role; key: string; alpha: number }> = [];
  const nodes = new Map<number, Node>();
  /** The live children of each parent (a node, or a layer for its top nodes) in Pixi's array order. */
  const kids = new Map<number | Layer, number[]>();
  const stage = { size };
  const node = (k: number): Node => {
    const x = nodes.get(k);
    if (x === undefined || !x.alive) {
      throw new Error(`stage: node ${k} is not alive`);
    }
    return x;
  };
  const add = (role: Role, layer: Layer, key: string, parent: number | null, tex: Tex | null): number => {
    n += 1;
    nodes.set(n, { id: n, role, layer, key, parent, alive: true, p: {}, tex });
    kids.set(parent ?? layer, [...(kids.get(parent ?? layer) ?? []), n]);
    return n;
  };
  const kill = (x: Node): void => {
    x.alive = false;
    kids.set(x.parent ?? x.layer, (kids.get(x.parent ?? x.layer) ?? []).filter((k) => k !== x.id));
  };
  const below = (x: Node): Node[] => (kids.get(x.id) ?? []).map(node).flatMap((c) => [c, ...below(c)]);
  const up = (x: Node): Node[] => (x.parent === null ? [] : [node(x.parent), ...up(node(x.parent))]);
  // chars sprites log their character, every other sprite its asset name.
  const keyOf = (layer: Layer, id: AssetId): string => (layer === 'chars' ? (id.split('/')[1] ?? id) : (id.split('/').pop() ?? id));
  const adapter: StageAdapter<Tex> = {
    size: () => stage.size,
    group(char) {
      log.push(`group:${char}`);
      return { group: add('char', 'chars', char, null, null) };
    },
    anchor(layer, label) {
      log.push(`anchor:${layer}:${label}`);
      const anchor = add('anchor', layer, label, null, null);
      const depth = add('depth', layer, label, anchor, null);
      const motion = add('motion', layer, label, depth, null);
      return { anchor: { group: anchor }, depth: { group: depth }, motion: { group: motion }, content: { group: add('content', layer, label, motion, null) } };
    },
    dropGroup(g) {
      const x = node(g.group);
      if (x.role !== 'char' && x.role !== 'anchor') {
        throw new Error(`stage: drop of an anchor's inner ${x.role} node`);
      }
      const art = below(x).find((d) => d.role === 'sprite');
      if (art !== undefined) {
        throw new Error(`stage: drop of ${x.key} with the live sprite ${art.key}`);
      }
      for (const d of [x, ...below(x)]) {
        kill(d);
      }
      log.push(`drop:${x.key}`);
    },
    sprite(layer, tex, g) {
      if (freed.has(tex.texture)) {
        throw new Error(`stage: sprite on the released texture ${tex.texture.url}`);
      }
      if (g !== undefined) {
        node(g.group);
      }
      const key = keyOf(layer, tex.id);
      log.push(`create:${layer}:${key}`);
      return { sprite: add('sprite', layer, key, g?.group ?? null, tex.texture) };
    },
    destroy(s) {
      const x = node(s.sprite);
      if (x.role !== 'sprite') {
        throw new Error(`stage: destroy of a ${x.role} node`);
      }
      kill(x);
      log.push(`destroy:${x.layer}:${x.key}`);
    },
    set(target, p) {
      const x = node('sprite' in target ? target.sprite : target.group);
      if (p.alpha !== undefined) {
        alphas.push({ role: x.role, key: x.key, alpha: p.alpha });
      }
      Object.assign(x.p, p);
    },
    fx(alpha) {
      log.push(`fx:${alpha}`);
    },
  };
  const live = (layer: Layer): Node[] => [...nodes.values()].filter((x) => x.role === 'sprite' && x.alive && x.layer === layer);
  const inGroup = (char: string): Node[] =>
    [...nodes.values()].filter((x) => x.role === 'sprite' && x.alive && x.parent !== null && node(x.parent).role === 'char' && node(x.parent).key === char);
  /** Every live node of every role, in creation order. */
  const liveNodes = (): Node[] => [...nodes.values()].filter((x) => x.alive);
  /** The live anchors of a layer, in creation order. */
  const anchors = (layer: Layer): Node[] => [...nodes.values()].filter((x) => x.role === 'anchor' && x.alive && x.layer === layer);
  /** The roles above a node, nearest first, ending at its layer. */
  const rolesAbove = (x: Node): Array<Role | 'layer'> => [...up(x).map((y) => y.role), 'layer'];
  /** The alpha a node draws with: its own times every ancestor's (Pixi multiplies a container's alpha down). */
  const worldAlpha = (x: Node | undefined): number | undefined => (x === undefined ? undefined : [x, ...up(x)].reduce((a, y) => a * (y.p.alpha ?? 1), 1));
  /** Where a node draws in stage px: its x, y plus every ancestor's (no ancestor scales); its own w, h. */
  const worldBox = (x: Node): Placement => {
    const all = [x, ...up(x)];
    return { x: all.reduce((s, y) => s + (y.p.x ?? 0), 0), y: all.reduce((s, y) => s + (y.p.y ?? 0), 0), w: x.p.w, h: x.p.h };
  };
  /**
   * A parent's children in draw order, bottom first. A sortable parent (the props and chars layers, every `content`) is
   * sorted the way Pixi sorts at a render: its children array, in place and stably, by z (a tie keeps the array's
   * current order, which an earlier sort may have changed).
   */
  const drawOrder = (parent: Node | Layer): Node[] => {
    const at = typeof parent === 'string' ? parent : parent.id;
    const ids = kids.get(at) ?? [];
    if (typeof parent === 'string' ? parent === 'props' || parent === 'chars' : parent.role === 'content') {
      ids.sort((a, b) => (node(a).p.z ?? 0) - (node(b).p.z ?? 0));
    }
    return ids.map(node);
  };
  /** An anchor's `content` node. */
  const contentOf = (a: Node): Node => {
    const c = below(a).find((d) => d.role === 'content');
    if (c === undefined) {
      throw new Error(`stage: ${a.key} has no content node`);
    }
    return c;
  };
  return { adapter, log, alphas, live, inGroup, liveNodes, anchors, rolesAbove, worldAlpha, worldBox, drawOrder, contentOf, stage };
}

/** The one node of a list (a test reads a single anchor or sprite). */
function one(xs: readonly Node[]): Node {
  const [x] = xs;
  if (x === undefined || xs.length !== 1) {
    throw new Error(`expected one node, got ${xs.length}`);
  }
  return x;
}

// ---------------------------------------------------------------------------------------------------------------
// Assets: a fixture manifest, the real registry and a loader that decodes at once, counting loads and releases. Each
// Decoded reports the harness's GPU generation when its load settles (1 unless a test raises it); its revive succeeds
// at once unless the test fails or holds it (MEMORY-PLAN M2 commit 3a), and a load can be deferred (a stalled fetch).

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
  // A drawer, its open state (the same anchor, another image) and a patch drawn over it (per-player GM6a, E-P1).
  'prop/drawer': image('prop_drawer', 300, 200),
  'prop/drawer_open': image('prop_drawer_open', 300, 260),
  'prop/glint': image('prop_glint', 100, 100),
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
  let gen = 1;
  /** Per URL: every revive fails, or each waits for `settle` (held). */
  const reviveRule = new Map<string, 'fail' | 'hold'>();
  const heldRevives = new Map<string, Array<(r: Result<void, LoadError>) => void>>();
  /** Per URL: the next load waits until the test lets it settle. */
  const deferred = new Map<string, { ready: boolean; go: (() => void) | null }>();
  const load: LoadImage<Tex> = (ref) => {
    loads.set(ref.url, (loads.get(ref.url) ?? 0) + 1);
    const e = byUrl.get(ref.url);
    if (e === undefined || ref.url === urlOf('bg/broken')) {
      return Promise.resolve({ ok: false, error: { kind: 'decode', detail: 'no such fixture' } });
    }
    const decode = (): Result<Decoded<Tex>, LoadError> => {
      const texture: Tex = { url: ref.url };
      const release = (): void => {
        released.set(ref.url, (released.get(ref.url) ?? 0) + 1);
        freed.add(texture);
      };
      const d: Decoded<Tex> = {
        texture,
        w: e.w,
        h: e.h,
        keptBytes: ref.bytes,
        gen,
        open: () => false,
        revive: (to, signal) => {
          const done = (r: Result<void, LoadError>): Result<void, LoadError> => {
            if (r.ok && !signal.aborted) {
              d.gen = to;
            }
            return r;
          };
          const rule = reviveRule.get(ref.url);
          if (rule === 'fail') {
            return Promise.resolve(done({ ok: false, error: { kind: 'decode', detail: 'revive failed' } }));
          }
          if (rule === 'hold') {
            return new Promise((resolve) => {
              heldRevives.set(ref.url, [...(heldRevives.get(ref.url) ?? []), (r) => resolve(done(r))]);
            });
          }
          return Promise.resolve(done({ ok: true, value: undefined }));
        },
        release,
      };
      return { ok: true, value: d };
    };
    const wait = deferred.get(ref.url);
    if (wait === undefined) {
      return Promise.resolve(decode());
    }
    deferred.delete(ref.url);
    return new Promise((resolve) => {
      wait.go = () => resolve(decode());
      if (wait.ready) {
        wait.go();
      }
    });
  };
  const registry = createAssetRegistry<Tex>({ load, variant: 'avif', tier: 'full' });
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
    /** The generation the next settling load reports; a test raises it before it revives. */
    setGen: (g: number): void => {
      gen = g;
    },
    failRevive: (id: string): void => {
      reviveRule.set(urlOf(id), 'fail');
    },
    /** Every revive of `id` waits; the returned controls settle the ones held so far. */
    holdRevive: (id: string): { succeed(): void; fail(): void } => {
      reviveRule.set(urlOf(id), 'hold');
      const settle = (r: Result<void, LoadError>): void => {
        const waiting = heldRevives.get(urlOf(id)) ?? [];
        heldRevives.delete(urlOf(id));
        for (const w of waiting) {
          w(r);
        }
      };
      return {
        succeed: () => settle({ ok: true, value: undefined }),
        fail: () => settle({ ok: false, error: { kind: 'decode', detail: 'revive failed' } }),
      };
    },
    /** The next load of `id` waits (a stalled fetch) until the returned function is called. */
    deferLoad: (id: string): (() => void) => {
      const wait: { ready: boolean; go: (() => void) | null } = { ready: false, go: null };
      deferred.set(urlOf(id), wait);
      return () => {
        wait.ready = true;
        wait.go?.();
      };
    },
  };
}

/** A fixture entry by id. */
function entryOf(id: string): ImageEntry {
  const e = ENTRIES[id];
  if (e === undefined) {
    throw new Error(`invariant: ${id} is a fixture entry`);
  }
  return e;
}
const asId = (s: string): AssetId => s as AssetId; // fixture ids: the brand is earned by the manifest decoder
const noAbort = (): AbortSignal => new AbortController().signal;

/** Holds `id`'s record under a holder of the test, outside the executor (a preload or the scheduler's ensure). */
async function pin(h: ReturnType<typeof harness>, id: string): Promise<void> {
  const r = await h.registry.acquire(asId(id), 'test', { entry: entryOf(id), priority: 'visible' });
  expect(r.ok).toBe(true);
}

/** Ends `id`'s record the way a context restore does: generation 2, and its re-decode fails. */
async function failOnRevive(h: ReturnType<typeof harness>, id: string): Promise<void> {
  h.failRevive(id);
  h.setGen(2);
  expect(await h.registry.revive(2, noAbort()).visible).toBe('done');
  expect(h.registry.current(asId(id))).toBe(null);
}

/** Records console.error calls (the chain's catch logs a build that threw) until `restore`. */
function spyErrors(): { readonly errors: unknown[][]; restore(): void } {
  const errors: unknown[][] = [];
  const spy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
    errors.push(a);
  });
  return { errors, restore: () => spy.mockRestore() };
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
/** `[prop, rect]`, or with its anchor key and part as the world gives them (`<room>.<hotspot>`, absent part: base). */
const props = (...ps: ReadonlyArray<readonly [string, Rect, string?, ('base' | 'patch')?]>): VisualCommand => ({
  kind: 'props',
  props: ps.map(([prop, rect, at, part]) => ({
    prop: prop as PropId,
    rect,
    ...(at === undefined ? {} : { at: at as AnchorKey }),
    ...(part === undefined ? {} : { part }),
  })),
});
const LAMP: Rect = [500, 900, 100, 100];
const KEY: Rect = [200, 1200, 120, 80];
const DRAWER: Rect = [300, 1500, 300, 200];
const DRAWER_OPEN: Rect = [300, 1500, 300, 260];
const GLINT: Rect = [380, 1540, 100, 100];
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
  expect(h.registry.stats()).toEqual({ live: 0, bytes: 0, pending: 0, overCap: 0, keptBytes: 0, keptMismatch: 0, openBitmaps: 0, stale: 0, reviveFailed: 0 });
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
    'drop:cg/letter',
    'destroy:props:lamp',
    'drop:lamp',
    'destroy:bg:street',
    'drop:bg/street',
    'anchor:bg:bg/cafe',
    'create:bg:cafe',
    'group:ally',
    'create:chars:ally',
    'fx:0',
  ]);
  h.ex.destroy();
});

test('executor: fade through black changes the stage only at black', async () => {
  const h = harness();
  const isChange = (x: string): boolean => /^(create|destroy|group|anchor|drop):/.test(x);
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
    'drop:bg/street',
    'anchor:bg:bg/cafe',
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
  expect(h.log.filter(isChange)).toEqual(['destroy:bg:cafe', 'drop:bg/cafe', 'anchor:bg:bg/room', 'create:bg:room']);
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
  expect(h.worldAlpha(h.live('bg')[0])).toBe(0);
  h.ex.complete();
  await Promise.resolve();
  expect(settled).toBe(true);
  expect(h.live('bg').map(h.worldAlpha)).toEqual([1]);
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
  expect(h.live('bg').map((x) => ({ key: x.key, alpha: h.worldAlpha(x) }))).toEqual([{ key: 'street', alpha: 1 }]);
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
  const lamp = one(h.live('props'));
  expect({ ...h.worldBox(lamp), alpha: h.worldAlpha(lamp) }).toEqual({ ...propPlacement(S390, LAMP), alpha: 1 });
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
  const before = [...h.live('bg'), ...h.inGroup('ally'), ...h.live('props')].map(h.worldBox);
  const loaded = ['bg/room', 'char/ally/neutral', 'prop/lamp'].map(h.loadsOf);
  // The old stage died with its Application (context loss): nothing is destroyed on it, everything is made anew.
  const fresh = recordingStage(S390, h.freed);
  h.ex.rebind(fresh.adapter);
  const after = [...fresh.live('bg'), ...fresh.inGroup('ally'), ...fresh.live('props')];
  expect(after.length).toBe(3);
  expect(after.map(fresh.worldBox)).toEqual(before);
  expect(after.map(fresh.worldAlpha)).toEqual([1, 1, 1]);
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
  expect(h.live('props').map(h.worldBox)).toEqual([
    propPlacement(small, LAMP),
    propPlacement(small, KEY),
  ]);
  h.ex.destroy();
});

test('executor: a build that throws kills its timeline', async () => {
  // L11 review minor M1: a build that throws before its timeline is handed to the batch must not leave that paused
  // timeline in gsap's root timeline. The chain's catch logs it and the batch still settles.
  const h = harness();
  const errors: unknown[][] = [];
  const spy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
    errors.push(a);
  });
  const sprite = h.adapter.sprite.bind(h.adapter);
  let thrown = false;
  h.adapter.sprite = (layer, tex, g) => {
    if (!thrown) {
      thrown = true;
      throw new Error('stage: a bug in a build');
    }
    return sprite(layer, tex, g);
  };
  const applied = track(h.ex.apply([bg('cafe', 'crossfade', 500)], NOW));
  await flush();
  spy.mockRestore();
  expect(errors.map((e) => e[0])).toEqual(['scene: batch failed']);
  expect(applied.done).toBe(true);
  expect(gsap.globalTimeline.getChildren(true, true, true)).toEqual([]);
  h.ex.destroy();
});

// ---------------------------------------------------------------------------------------------------------------
// MEMORY-PLAN M2 commit 3a: reacquire() and the identity rule (section 8). Records end through the real
// registry.revive(2, signal) after the harness generation is raised to 2.

test('executor: reacquire removes a view bound to an ended record at once', async () => {
  const h = harness();
  await h.ex.apply([bg('cafe', 'cut'), show('ally', 'neutral', 'left', 'cut')], NOW);
  await failOnRevive(h, 'bg/cafe');
  h.log.length = 0;
  const returned: unknown = h.ex.reacquire();
  // Synchronously, before any await: nothing waits on the re-take.
  expect(returned).toBe(undefined);
  expect(h.live('bg')).toEqual([]);
  expect(h.inGroup('ally').length).toBe(1);
  expect(h.log.filter((x) => x.startsWith('destroy:'))).toEqual(['destroy:bg:cafe']);
  h.ex.destroy();
});

test('executor: reacquire takes the slot again on a new record', async () => {
  const h = harness();
  await h.ex.apply([bg('cafe', 'cut'), show('ally', 'neutral', 'left', 'cut')], NOW);
  const ended = h.registry.current(asId('bg/cafe'));
  await failOnRevive(h, 'bg/cafe');
  h.ex.reacquire();
  await flush();
  expect(h.loadsOf('bg/cafe')).toBe(2);
  const now = h.registry.current(asId('bg/cafe'));
  expect(now).not.toBe(null);
  expect(now).not.toBe(ended);
  const [sprite] = h.live('bg');
  expect(sprite?.tex).toBe(now?.texture);
  expect(sprite?.tex !== null && sprite?.tex !== undefined && h.freed.has(sprite.tex)).toBe(false);
  expect(h.loadsOf('char/ally/neutral')).toBe(1);
  expect(h.ex.snapshot().bg).toBe('cafe');
  h.ex.destroy();
});

test('executor: a batch never builds on a handle whose record ended', async () => {
  const h = harness();
  const spy = spyErrors();
  await pin(h, 'bg/cafe');
  const allyLoads = h.deferLoad('char/ally/neutral');
  // B's bg take joins the live record at once; its ally take waits on a stalled fetch.
  const b = h.ex.apply([bg('cafe', 'cut'), show('ally', 'neutral', null, 'cut')], NOW);
  await flush();
  await failOnRevive(h, 'bg/cafe');
  h.ex.reacquire();
  allyLoads();
  await b;
  await flush();
  spy.restore();
  expect(spy.errors).toEqual([]);
  expect(h.inGroup('ally').length).toBe(1);
  // The re-take, queued behind B, shows the slot on the new record.
  const [sprite] = h.live('bg');
  expect(sprite?.tex).toBe(h.registry.current(asId('bg/cafe'))?.texture);
  expect(h.loadsOf('bg/cafe')).toBe(2);
  h.ex.destroy();
});

test('executor: a fade through black never shows a handle whose record ended at black', async () => {
  const h = harness();
  await pin(h, 'bg/street');
  const s = track(h.ex.apply([scene('street', 'fade', 800)], NOW));
  await flush();
  advance(100);
  await failOnRevive(h, 'bg/street');
  h.ex.reacquire(); // no street sprite yet: it removes nothing and completes nothing
  expect(h.ex.stats().activeTimelines).toBe(1);
  advance(400); // the midpoint: the slot keeps what it showed
  expect(h.live('bg')).toEqual([]);
  advance(400); // past S's end, so the re-take chained behind it builds
  await flush();
  expect(s.done).toBe(true);
  const [sprite] = h.live('bg');
  expect(sprite?.key).toBe('street');
  expect(sprite?.tex).toBe(h.registry.current(asId('bg/street'))?.texture);
  expect(h.loadsOf('bg/street')).toBe(2);
  h.ex.destroy();
});

test('executor: a second reacquire touches nothing', async () => {
  const h = harness();
  await h.ex.apply([bg('cafe', 'cut'), show('ally', 'neutral', 'left', 'cut')], NOW);
  await failOnRevive(h, 'bg/cafe');
  h.ex.reacquire();
  h.ex.reacquire(); // while the re-take is pending
  await flush();
  const current = h.registry.current(asId('bg/cafe'));
  const live = h.registry.stats().live;
  h.ex.reacquire(); // after it settled
  await flush();
  expect(h.loadsOf('bg/cafe')).toBe(2);
  expect(h.log.filter((x) => x === 'destroy:bg:cafe')).toEqual(['destroy:bg:cafe']);
  expect(h.live('bg').map((x) => x.key)).toEqual(['cafe']);
  expect(h.registry.current(asId('bg/cafe'))).toBe(current);
  expect(h.registry.stats().live).toBe(live);
  h.ex.destroy();
});

test('executor: reacquire behind a waiting batch removes at once', async () => {
  const h = harness();
  await h.ex.apply([bg('cafe', 'cut')], NOW);
  const allyLoads = h.deferLoad('char/ally/neutral');
  const a = h.ex.apply([show('ally', 'neutral', 'left', 'cut')], NOW);
  await flush();
  await failOnRevive(h, 'bg/cafe');
  h.ex.reacquire();
  // A still waits in the chain; the removal does not.
  expect(h.live('bg')).toEqual([]);
  allyLoads();
  await a;
  await flush();
  expect(h.inGroup('ally').length).toBe(1);
  expect(h.live('bg').map((x) => x.key)).toEqual(['cafe']);
  expect(h.loadsOf('bg/cafe')).toBe(2);
  h.ex.destroy();
});

test('executor: a waiting take that failed with its record is taken again', async () => {
  const h = harness();
  await pin(h, 'char/ally/neutral');
  const held = h.holdRevive('char/ally/neutral');
  h.setGen(2);
  void h.registry.revive(2, noAbort());
  await flush();
  // B's take joins the record still waiting for its revive.
  const b = h.ex.apply([show('ally', 'neutral', 'left', 'cut')], NOW);
  await flush();
  expect(h.inGroup('ally').length).toBe(0);
  held.fail();
  await b;
  expect(h.skipped.map((e) => e.kind)).toEqual(['decode']);
  expect(h.inGroup('ally').length).toBe(0);
  h.ex.reacquire();
  await flush();
  expect(h.loadsOf('char/ally/neutral')).toBe(2);
  expect(h.inGroup('ally').length).toBe(1);
  h.ex.destroy();
});

test('executor: reacquire touches nothing not bound to an ended record', async () => {
  const h = harness();
  // A visual skipped by its own decode failure, a live character, then a running 200 ms expression fade.
  await h.ex.apply([bg('broken', 'cut'), show('ally', 'neutral', 'left', 'cut')], NOW);
  expect(h.skipped.map((e) => e.kind)).toEqual(['decode']);
  const fade = h.ex.apply([show('ally', 'worried', null, 'fade', 200)], NOW);
  await flush();
  expect(h.ex.stats().activeTimelines).toBe(1);
  const ids = ['bg/broken', 'char/ally/neutral', 'char/ally/worried'];
  const loads = ids.map(h.loadsOf);
  h.log.length = 0;
  h.ex.reacquire();
  await flush();
  expect(ids.map(h.loadsOf)).toEqual(loads);
  expect(h.log.filter((x) => x.startsWith('destroy:'))).toEqual([]);
  expect(h.ex.stats().activeTimelines).toBe(1);
  h.ex.complete();
  await fade;
  h.ex.destroy();
});

test('executor: rebind skips a view whose record ended', async () => {
  const h = harness();
  await h.ex.apply([bg('cafe', 'cut'), show('ally', 'neutral', 'left', 'cut')], NOW);
  await failOnRevive(h, 'bg/cafe');
  const fresh = recordingStage(S390, h.freed);
  h.ex.rebind(fresh.adapter);
  expect(fresh.live('bg')).toEqual([]);
  expect(fresh.inGroup('ally').length).toBe(1);
  h.ex.reacquire();
  await flush();
  expect(fresh.live('bg').map((x) => x.key)).toEqual(['cafe']);
  expect(fresh.live('bg')[0]?.tex).toBe(h.registry.current(asId('bg/cafe'))?.texture);
  expect(fresh.inGroup('ally').length).toBe(1);
  h.ex.destroy();
});

// ---------------------------------------------------------------------------------------------------------------
// MEMORY-PLAN M2 commit 3b: the revive flow over the real registry and executor.

test('executor: with the revive flow, frames resume at the deadline while a batch waits on a stalled fetch', async () => {
  const h = harness();
  const spy = spyErrors();
  await h.ex.apply([bg('cafe', 'cut')], NOW);
  const allyLoads = h.deferLoad('char/ally/neutral');
  const a = track(h.ex.apply([show('ally', 'neutral', 'left', 'cut')], NOW));
  await flush();
  h.holdRevive('bg/cafe'); // the bg's re-decode never settles
  const atResume: Array<{ stale: number; bgSprites: number; waiting: boolean }> = [];
  const resume = vi.fn(() => {
    atResume.push({ stale: h.registry.stats().stale, bgSprites: h.live('bg').length, waiting: !a.done });
  });
  const flow = createReviveFlow({ revive: (gen, signal) => h.registry.revive(gen, signal), reacquire: () => h.ex.reacquire(), resume });
  flow.lost();
  h.setGen(2);
  flow.start(2);
  await flush();
  expect(resume).not.toHaveBeenCalled();
  vi.advanceTimersByTime(REVIVE_DEADLINE_MS);
  await flush();
  // Once, while A still waits: nothing stale can be bound by a frame, and the bg's view is already gone.
  expect(atResume).toEqual([{ stale: 0, bgSprites: 0, waiting: true }]);
  expect(flow.suspended()).toBe(false);
  allyLoads();
  await flush();
  expect(a.done).toBe(true);
  expect(h.inGroup('ally').length).toBe(1);
  expect(h.live('bg').map((x) => x.key)).toEqual(['cafe']);
  expect(h.loadsOf('bg/cafe')).toBe(2);
  spy.restore();
  expect(spy.errors).toEqual([]);
  expect(resume).toHaveBeenCalledTimes(1);
  flow.destroy();
  h.ex.destroy();
});

// ---------------------------------------------------------------------------------------------------------------
// Per-player GM6a (§6.1): every bg, CG and prop sits in an anchor of four nested nodes (anchor > depth > motion >
// content); the batch motions write the `anchor`, the art lives in `content`.

test('executor: a bg crossfade fades the anchors, not the sprites', async () => {
  const h = harness();
  await h.ex.apply([bg('cafe', 'cut')], NOW);
  h.alphas.length = 0;
  h.log.length = 0;
  const batch = h.ex.apply([bg('street', 'crossfade', 500), cg('letter', 'fade', 500)], NOW);
  await flush();
  advance(250);
  // Every alpha the batch wrote went to an anchor; no art sprite's own alpha was written.
  expect(h.alphas.length).toBeGreaterThan(0);
  expect(h.alphas.filter((w) => w.role !== 'anchor')).toEqual([]);
  expect(h.anchors('bg').map((x) => x.key)).toEqual(['bg/cafe', 'bg/street']);
  expect(h.anchors('bg')[1]?.p.alpha).toBeCloseTo(0.5, 6);
  expect(h.anchors('cg')[0]?.p.alpha).toBeCloseTo(0.5, 6);
  expect([...h.live('bg'), ...h.live('cg')].map((x) => x.p.alpha)).toEqual([undefined, undefined, undefined]);
  h.ex.complete();
  await batch;
  // One bg anchor left; the old one was dropped after its sprite was destroyed.
  expect(h.anchors('bg').map((x) => x.key)).toEqual(['bg/street']);
  expect(h.log.filter((x) => /^(destroy|drop):/.test(x))).toEqual(['destroy:bg:cafe', 'drop:bg/cafe']);
  expect([...h.live('bg'), ...h.live('cg')].map(h.worldAlpha)).toEqual([1, 1]);
  h.ex.destroy();
});

test("executor: an anchor's art lives in its content node", async () => {
  const h = harness();
  await h.ex.apply([bg('cafe', 'cut'), cg('letter', 'cut'), props(['lamp', LAMP, 'room.lamp'])], NOW);
  const arts = [...h.live('bg'), ...h.live('cg'), ...h.live('props')];
  expect(arts.length).toBe(3);
  for (const art of arts) {
    expect(h.rolesAbove(art)).toEqual(['content', 'motion', 'depth', 'anchor', 'layer']);
  }
  h.ex.destroy();
});

test('executor: a bg and a CG draw at the cover box, offset by their anchors', async () => {
  const h = harness();
  await h.ex.apply([bg('cafe', 'cut'), cg('letter', 'cut')], NOW);
  // The phone stage cuts the cover box at the sides, the small one at the top and bottom: a lost or a doubled offset
  // moves the art on either.
  for (const size of [S390, { w: 320, h: 568 }]) {
    h.stage.size = size;
    h.ex.relayout();
    const c = backdropPlacement(size);
    expect(c.offsetX !== 0 || c.offsetY !== 0).toBe(true);
    for (const layer of ['bg', 'cg'] as const) {
      const art = one(h.live(layer));
      expect(h.worldBox(art), layer).toEqual({ x: c.offsetX, y: c.offsetY, w: ROOM_SOURCE.w * c.scale, h: ROOM_SOURCE.h * c.scale });
      expect({ x: art.p.x ?? 0, y: art.p.y ?? 0 }, `${layer}: the art has no offset of its own`).toEqual({ x: 0, y: 0 });
    }
  }
  h.ex.destroy();
});

test("executor: a prop's box is its anchor's position and its sprite's size", async () => {
  const h = harness();
  await h.ex.apply([bg('room', 'cut'), props(['lamp', LAMP, 'room.lamp'], ['key', KEY])], NOW);
  const box = propPlacement(S390, LAMP);
  // The anchor at the box's origin, the art at (0, 0) of `content` with the box's size: drawn at the box, not twice
  // its origin.
  const anchor = one(h.anchors('props').filter((x) => x.key === 'room.lamp'));
  expect({ x: anchor.p.x, y: anchor.p.y }).toEqual({ x: box.x, y: box.y });
  const lamp = one(h.live('props').filter((x) => x.key === 'lamp'));
  expect(h.rolesAbove(lamp)[0]).toBe('content');
  expect({ x: lamp.p.x ?? 0, y: lamp.p.y ?? 0, w: lamp.p.w, h: lamp.p.h }).toEqual({ x: 0, y: 0, w: box.w, h: box.h });
  expect(h.worldBox(lamp)).toEqual(box);
  // propRects reports the stage boxes, in the command's order.
  expect(h.ex.propRects()).toEqual([
    { prop: 'lamp', ...box },
    { prop: 'key', ...propPlacement(S390, KEY) },
  ]);
  h.ex.destroy();
});

test("executor: a taken prop's anchor fades out with its sprite", async () => {
  const h = harness();
  await h.ex.apply([bg('room', 'cut'), props(['lamp', LAMP, 'room.lamp'], ['key', KEY, 'room.key'])], NOW);
  const kept = one(h.anchors('props').filter((x) => x.key === 'room.key'));
  const keyBox = h.worldBox(one(h.live('props').filter((x) => x.key === 'key')));
  h.alphas.length = 0;
  h.log.length = 0;
  // A take: the room's crossfade onto the bg it shows, without the lamp.
  const take = h.ex.apply([bg('room', 'crossfade', 300), props(['key', KEY, 'room.key'])], NOW);
  await flush();
  advance(150);
  // Only the taken prop's anchor is written: half faded; its sprite keeps its own alpha.
  expect(h.alphas.filter((w) => w.role !== 'anchor' || w.key !== 'room.lamp')).toEqual([]);
  expect(one(h.anchors('props').filter((x) => x.key === 'room.lamp')).p.alpha).toBeCloseTo(0.5, 6);
  expect(one(h.live('props').filter((x) => x.key === 'lamp')).p.alpha).toBe(undefined);
  h.ex.complete();
  await take;
  expect(h.log.filter((x) => /^(anchor|create|destroy|drop):/.test(x))).toEqual(['destroy:props:lamp', 'drop:room.lamp']);
  expect(h.alphas.filter((w) => w.key !== 'room.lamp')).toEqual([]);
  expect(h.anchors('props')).toEqual([kept]);
  const key = one(h.live('props'));
  expect({ ...h.worldBox(key), alpha: h.worldAlpha(key) }).toEqual({ ...keyBox, alpha: 1 });
  expect(h.releasedOf('prop/lamp')).toBe(1);
  h.ex.destroy();
});

test('executor: a prop whose image changes at the same anchor crossfades inside it', async () => {
  const h = harness();
  await h.ex.apply([bg('room', 'cut'), props(['drawer', DRAWER, 'room.drawer'])], NOW);
  const anchor = one(h.anchors('props'));
  h.alphas.length = 0;
  h.log.length = 0;
  // E-P1: the open drawer at the same anchor.
  const swap = h.ex.apply([bg('room', 'crossfade', 300), props(['drawer_open', DRAWER_OPEN, 'room.drawer'])], NOW);
  await flush();
  advance(150);
  expect(h.anchors('props')).toEqual([anchor]);
  // The new image under the old one at full alpha, the old one fading out over it.
  const mid = h.drawOrder(h.contentOf(anchor));
  expect(mid.map((x) => x.key)).toEqual(['drawer_open', 'drawer']);
  expect(h.worldAlpha(mid[0])).toBe(1);
  expect(h.worldAlpha(mid[1])).toBeCloseTo(0.5, 6);
  expect(h.alphas.filter((w) => w.role === 'anchor')).toEqual([]);
  h.ex.complete();
  await swap;
  expect(h.drawOrder(h.contentOf(anchor)).map((x) => x.key)).toEqual(['drawer_open']);
  expect(h.log.filter((x) => /^(anchor|drop):/.test(x))).toEqual([]);
  expect(h.log.filter((x) => x.startsWith('destroy:'))).toEqual(['destroy:props:drawer']);
  expect(h.ex.propRects()).toEqual([{ prop: 'drawer_open', ...propPlacement(S390, DRAWER_OPEN) }]);
  expect(h.worldBox(one(h.live('props')))).toEqual(propPlacement(S390, DRAWER_OPEN));
  h.ex.destroy();
});

test('executor: a patch is a child of its base anchor', async () => {
  const h = harness();
  await h.ex.apply([bg('room', 'cut'), props(['drawer', DRAWER, 'room.drawer'])], NOW);
  const anchor = one(h.anchors('props'));
  const origin = propPlacement(S390, DRAWER);
  const box = propPlacement(S390, GLINT);
  h.alphas.length = 0;
  h.log.length = 0;
  // The patch fades in inside the base's anchor, above the base, at its box minus the anchor's origin.
  const add = h.ex.apply([bg('room', 'crossfade', 300), props(['drawer', DRAWER, 'room.drawer'], ['glint', GLINT, 'room.drawer', 'patch'])], NOW);
  await flush();
  advance(150);
  expect(h.anchors('props')).toEqual([anchor]);
  const content = h.contentOf(anchor);
  expect(h.drawOrder(content).map((x) => x.key)).toEqual(['drawer', 'glint']);
  const glint = one(h.live('props').filter((x) => x.key === 'glint'));
  expect({ x: glint.p.x, y: glint.p.y, w: glint.p.w, h: glint.p.h }).toEqual({ x: box.x - origin.x, y: box.y - origin.y, w: box.w, h: box.h });
  expect(glint.p.alpha).toBeCloseTo(0.5, 6);
  expect(anchor.p.alpha).toBe(1);
  h.ex.complete();
  await add;
  expect(glint.p.alpha).toBe(1);
  expect(h.ex.propRects()).toEqual([
    { prop: 'drawer', ...origin },
    { prop: 'glint', ...box },
  ]);
  // The patch fades out inside the anchor; the anchor stays.
  const remove = h.ex.apply([bg('room', 'crossfade', 300), props(['drawer', DRAWER, 'room.drawer'])], NOW);
  await flush();
  advance(150);
  expect(glint.p.alpha).toBeCloseTo(0.5, 6);
  expect(anchor.p.alpha).toBe(1);
  h.ex.complete();
  await remove;
  expect(h.drawOrder(content).map((x) => x.key)).toEqual(['drawer']);
  expect(h.anchors('props')).toEqual([anchor]);
  expect(h.alphas.filter((w) => w.role === 'anchor')).toEqual([]);
  expect(h.log.filter((x) => /^(anchor|create|destroy|drop):/.test(x))).toEqual(['create:props:glint', 'destroy:props:glint']);
  h.ex.destroy();
});

test("executor: prop anchors follow the command's order", async () => {
  // (A) A state image at the same anchor keeps the anchor's place in the props layer (it is not drawn last).
  const a = harness();
  await a.ex.apply([bg('room', 'cut'), props(['drawer', DRAWER, 'room.drawer'], ['lamp', LAMP, 'room.lamp'])], NOW);
  await a.ex.apply([bg('room', 'crossfade', 300), props(['drawer_open', DRAWER_OPEN, 'room.drawer'], ['lamp', LAMP, 'room.lamp'])], { instant: true });
  expect(a.drawOrder('props').map((x) => x.key)).toEqual(['room.drawer', 'room.lamp']);
  a.ex.destroy();
  // (B) A new anchor named before a kept one is drawn before (under) it: the layer's order is the command's.
  const b = harness();
  await b.ex.apply([bg('room', 'cut'), props(['lamp', LAMP, 'room.lamp'])], NOW);
  await b.ex.apply([bg('room', 'crossfade', 300), props(['key', KEY, 'room.key'], ['lamp', LAMP, 'room.lamp'])], { instant: true });
  expect(b.drawOrder('props').map((x) => x.key)).toEqual(['room.key', 'room.lamp']);
  expect(b.ex.propRects().map((r) => r.prop)).toEqual(['key', 'lamp']);
  b.ex.destroy();
});

test('executor: a placement that gains its at keeps its anchor', async () => {
  // A format-1 save's props have no `at` (keyed by prop); the room's at-keyed placements of the same props take those
  // anchors over (D5.1): nothing is created, dropped or faded.
  const h = harness();
  await h.ex.apply([bg('room', 'cut'), props(['lamp', LAMP], ['key', KEY])], NOW);
  const before = h.anchors('props');
  expect(before.map((x) => x.key)).toEqual(['lamp', 'key']);
  h.alphas.length = 0;
  h.log.length = 0;
  const gain = h.ex.apply([bg('room', 'crossfade', 300), props(['lamp', LAMP, 'room.lamp'], ['key', KEY, 'room.key'])], NOW);
  await flush();
  h.ex.complete();
  await gain;
  expect(h.anchors('props')).toEqual(before);
  expect(h.log.filter((x) => /^(anchor|create|destroy|drop):/.test(x))).toEqual([]);
  expect(h.alphas).toEqual([]);
  h.ex.destroy();
  // The format-1 resume's first take: the kept prop's anchor is taken over untouched; only the taken one fades out.
  const r = harness();
  await r.ex.apply([bg('room', 'cut'), props(['lamp', LAMP], ['key', KEY])], NOW);
  const key = one(r.anchors('props').filter((x) => x.key === 'key'));
  r.alphas.length = 0;
  r.log.length = 0;
  const take = r.ex.apply([bg('room', 'crossfade', 300), props(['key', KEY, 'room.key'])], NOW);
  await flush();
  advance(150);
  expect(r.alphas.filter((w) => w.key !== 'lamp')).toEqual([]);
  r.ex.complete();
  await take;
  expect(r.anchors('props')).toEqual([key]);
  expect(r.log.filter((x) => /^(anchor|create|destroy|drop):/.test(x))).toEqual(['destroy:props:lamp', 'drop:lamp']);
  expect(r.worldAlpha(one(r.live('props')))).toBe(1);
  r.ex.destroy();
});

test('executor: a placement that loses its at keeps its anchor', async () => {
  // The other direction (review r1 I1): a format-1 save restored over the room's at-keyed props places the same props
  // without `at`; they take those anchors over and stay on screen: nothing is created, dropped or faded.
  const h = harness();
  await h.ex.apply([bg('room', 'cut'), props(['lamp', LAMP, 'room.lamp'], ['key', KEY, 'room.key'])], NOW);
  const before = h.anchors('props');
  const boxes = h.live('props').map(h.worldBox);
  h.alphas.length = 0;
  h.log.length = 0;
  await h.ex.restore({ bg: 'room' as BgId, cg: null, chars: [], props: [{ prop: 'lamp' as PropId, rect: LAMP }, { prop: 'key' as PropId, rect: KEY }] });
  expect(h.live('props').map((x) => x.key), 'after the restore').toEqual(['lamp', 'key']);
  expect(h.anchors('props')).toEqual(before);
  expect(h.live('props').map(h.worldBox)).toEqual(boxes);
  expect(h.ex.propRects().map((r) => r.prop)).toEqual(['lamp', 'key']);
  expect(h.log.filter((x) => /^(anchor|create|destroy|drop):/.test(x))).toEqual([]);
  expect(h.alphas).toEqual([]);
  // The take that follows sends the room's at-keyed placements again, without the lamp: the kept prop's anchor is
  // taken over untouched; only the taken one fades out.
  const key = one(h.anchors('props').filter((x) => x.key === 'room.key'));
  const take = h.ex.apply([bg('room', 'crossfade', 300), props(['key', KEY, 'room.key'])], NOW);
  await flush();
  advance(150);
  expect(h.alphas.filter((w) => w.key !== 'room.lamp')).toEqual([]);
  h.ex.complete();
  await take;
  expect(h.anchors('props')).toEqual([key]);
  expect(h.log.filter((x) => /^(anchor|create|destroy|drop):/.test(x))).toEqual(['destroy:props:lamp', 'drop:room.lamp']);
  expect(h.worldAlpha(one(h.live('props')))).toBe(1);
  h.ex.destroy();
});

test('executor: an anchor the target names is never taken over', async () => {
  // A patch moved out to its own key: the base's anchor, which the target still names, keeps the base.
  const h = harness();
  await h.ex.apply([bg('room', 'cut'), props(['drawer', DRAWER, 'room.drawer'], ['glint', GLINT, 'room.drawer', 'patch'])], NOW);
  const drawer = one(h.anchors('props'));
  await h.ex.apply([bg('room', 'crossfade', 300), props(['drawer', DRAWER, 'room.drawer'], ['glint', GLINT, 'room.glint'])], { instant: true });
  expect(h.drawOrder(h.contentOf(drawer)).map((x) => x.key)).toEqual(['drawer']);
  h.ex.destroy();
  // A prop moved into a key that has its anchor: that anchor is never replaced in the map (it would outlive destroy).
  const m = harness();
  await m.ex.apply([bg('room', 'cut'), props(['drawer', DRAWER, 'room.drawer'], ['glint', GLINT, 'room.glint'])], NOW);
  const base = one(m.anchors('props').filter((x) => x.key === 'room.drawer'));
  await m.ex.apply([bg('room', 'crossfade', 300), props(['drawer', DRAWER, 'room.drawer'], ['glint', GLINT, 'room.drawer', 'patch'])], { instant: true });
  expect(m.drawOrder(m.contentOf(base)).map((x) => x.key)).toEqual(['drawer']);
  m.ex.destroy();
  expect(m.liveNodes().map((x) => `${x.role}:${x.key}`)).toEqual([]);
});

test('executor: rebind re-creates each anchor before its sprite', async () => {
  const h = harness();
  await h.ex.apply([bg('room', 'cut'), cg('letter', 'cut'), show('ally', 'neutral', 'left', 'cut'), props(['lamp', LAMP, 'room.lamp'])], NOW);
  // E-P7 case B with a patch: a new anchor named before the kept one.
  await h.ex.apply(
    [bg('room', 'crossfade', 300), props(['drawer', DRAWER, 'room.drawer'], ['glint', GLINT, 'room.drawer', 'patch'], ['lamp', LAMP, 'room.lamp'])],
    { instant: true },
  );
  /** The props layer in draw order with each anchor's z, and its content in draw order with each sprite's z. */
  const drawn = (s: ReturnType<typeof recordingStage>): unknown[] =>
    s.drawOrder('props').map((a) => [a.key, a.p.z, s.drawOrder(s.contentOf(a)).map((x) => [x.key, x.p.z])]);
  const before = drawn(h);
  expect(before).toEqual([
    ['room.drawer', 0, [['drawer', 0], ['glint', 2]]],
    ['room.lamp', 1, [['lamp', 0]]],
  ]);
  const fresh = recordingStage(S390, h.freed);
  h.ex.rebind(fresh.adapter);
  // Each anchor first, then its own art, with no other anchor between; nothing destroyed or dropped.
  expect(fresh.log.filter((x) => /^(anchor|group|create):/.test(x))).toEqual([
    'anchor:bg:bg/room',
    'create:bg:room',
    'anchor:cg:cg/letter',
    'create:cg:letter',
    'group:ally',
    'create:chars:ally',
    'anchor:props:room.drawer',
    'create:props:drawer',
    'create:props:glint',
    'anchor:props:room.lamp',
    'create:props:lamp',
  ]);
  for (const art of [...fresh.live('bg'), ...fresh.live('cg'), ...fresh.live('props')]) {
    expect(fresh.rolesAbove(art)).toEqual(['content', 'motion', 'depth', 'anchor', 'layer']);
  }
  expect(fresh.log.filter((x) => /^(destroy|drop):/.test(x))).toEqual([]);
  // The new stage draws the props as the old one did, with the same z (critique W2).
  expect(drawn(fresh)).toEqual(before);
  h.ex.destroy();
});

test('executor: reacquire drops every anchor it empties, at once', async () => {
  const h = harness();
  await h.ex.apply(
    [
      bg('cafe', 'cut'),
      cg('letter', 'cut'),
      props(['drawer', DRAWER, 'room.drawer'], ['glint', GLINT, 'room.drawer', 'patch'], ['lamp', LAMP, 'room.lamp'], ['key', KEY, 'room.key']),
    ],
    NOW,
  );
  const drawer = one(h.anchors('props').filter((x) => x.key === 'room.drawer'));
  // One revive ends the bg, the CG, the lamp (its anchor's only art) and the glint (a patch beside its base).
  for (const id of ['bg/cafe', 'cg/letter', 'prop/lamp', 'prop/glint']) {
    h.failRevive(id);
  }
  h.setGen(2);
  expect(await h.registry.revive(2, noAbort()).visible).toBe('done');
  h.log.length = 0;
  h.ex.reacquire();
  // Synchronously: each ended backdrop goes with its anchor, the emptied prop anchor is dropped, the drawer's stays.
  expect(h.log.filter((x) => /^(destroy|drop):/.test(x))).toEqual([
    'destroy:bg:cafe',
    'drop:bg/cafe',
    'destroy:cg:letter',
    'drop:cg/letter',
    'destroy:props:glint',
    'destroy:props:lamp',
    'drop:room.lamp',
  ]);
  expect([...h.anchors('bg'), ...h.anchors('cg')]).toEqual([]);
  expect(h.anchors('props').map((x) => x.key)).toEqual(['room.drawer', 'room.key']);
  expect(h.drawOrder(h.contentOf(drawer)).map((x) => x.key)).toEqual(['drawer']);
  // The re-take shows each one again in an anchor of its own, the props in the command's order.
  await flush();
  expect([...h.anchors('bg'), ...h.anchors('cg')].map((x) => x.key)).toEqual(['bg/cafe', 'cg/letter']);
  expect(h.drawOrder('props').map((x) => x.key)).toEqual(['room.drawer', 'room.lamp', 'room.key']);
  expect(h.drawOrder(h.contentOf(drawer)).map((x) => x.key)).toEqual(['drawer', 'glint']);
  h.ex.destroy();
  expect(h.liveNodes().map((x) => `${x.role}:${x.key}`)).toEqual([]);
});

test('executor: destroy leaves no anchor alive', async () => {
  const h = harness();
  await h.ex.apply([bg('cafe', 'cut')], NOW);
  // A completed bg crossfade: its old anchor was retired with its sprite.
  const crossfade = h.ex.apply([bg('street', 'crossfade', 500)], NOW);
  await flush();
  advance(600);
  await crossfade;
  await h.ex.apply([bg('street', 'cut'), props(['drawer', DRAWER, 'room.drawer'], ['lamp', LAMP, 'room.lamp'])], NOW);
  // In flight: an in-anchor image change with a patch fading in, a prop anchor leaving, one arriving, a CG fading in.
  void h.ex.apply(
    [
      bg('street', 'crossfade', 300),
      cg('letter', 'fade', 500),
      props(['drawer_open', DRAWER_OPEN, 'room.drawer'], ['glint', GLINT, 'room.drawer', 'patch'], ['key', KEY, 'room.key']),
    ],
    NOW,
  );
  await flush();
  advance(150);
  expect(h.ex.stats().activeTimelines).toBe(1);
  expect(h.anchors('props').map((x) => x.key)).toEqual(['room.drawer', 'room.lamp', 'room.key']);
  h.ex.destroy();
  // No anchor, inner node (depth, motion, content) or sprite outlives the executor (plan 08 row 6).
  expect(h.liveNodes().map((x) => `${x.role}:${x.key}`)).toEqual([]);
  expect(h.registry.stats().live).toBe(0);
});

// ---------------------------------------------------------------------------------------------------------------
// The shots plan's SH1 kinds on today's stage: the cut verb, a face, the camera held in the snapshot.

test('executor: a bg cut replaces the shot at once', async () => {
  const h = harness();
  await h.ex.apply([bg('cafe', 'cut')], NOW);
  h.log.length = 0;
  const cut = track(h.ex.apply([bg('street', 'cut')], NOW));
  await flush();
  // No time passed: the batch ended without a timeline, the old shot gone with its anchor.
  expect(cut.done).toBe(true);
  expect(h.ex.stats().activeTimelines).toBe(0);
  expect(h.live('bg').map((x) => x.key)).toEqual(['street']);
  expect(h.log.filter((x) => /^(anchor|create|destroy|drop):/.test(x))).toEqual([
    'destroy:bg:cafe',
    'drop:bg/cafe',
    'anchor:bg:bg/street',
    'create:bg:street',
  ]);
  expect(h.releasedOf('bg/cafe')).toBe(1);
  h.ex.destroy();
});
