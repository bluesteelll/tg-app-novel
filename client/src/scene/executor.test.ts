import { gsap } from 'gsap/gsap-core';
import { expect, test, vi } from 'vitest';

import { ROOM_SOURCE } from '../geom/cover.ts';
import type { Size } from '../geom/cover.ts';
import type { AnchorKey } from '../mechanics/contract.ts';
import type { ImageEntry, Result } from '../story/catalog.ts';
import type { Box as Box4, CastRig, Member, ShotRig } from '../story/shots.ts';
import type { AssetId, BgId, CamState, CgId, CharId, ExprId, PropId, Rect, Slot } from '../story/staging.ts';
import { createExecutor } from './executor.ts';
import type { ExecutorDeps, Layer, Placement, StageAdapter, VisualCommand } from './executor.ts';
import { patchPlan } from './flatten.ts';
import type { FaceState, MotionKit } from './motion/animator.ts';
import type { FlatPlan } from './flatten.ts';
import { backdropPlacement, propPlacement } from './layout.ts';
import type { StageWindow } from './preload.ts';
import { REVIVE_DEADLINE_MS, TRANSIENT_CAP_BYTES, createAssetRegistry } from './registry.ts';
import type { AssetError, Decoded, FrameCut, LoadError, LoadImage } from './registry.ts';
import { createRenderLoop } from './render-loop.ts';
import type { RenderLoop, Ticker } from './render-loop.ts';
import { createReviveFlow } from './revive-flow.ts';
import { camFraming, restFraming, worldOf } from './shot-view.ts';
import type { WorldDelta } from './shot-view.ts';

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
// Opt-in (lane SH6): the transition targets, each a `flat` node (on screen in the `flat` layer, or a patch in a group),
// logged when made and dropped, with a throw on a second drop or a write after it.

type Tex = { readonly url: string };
type Role = 'char' | 'anchor' | 'depth' | 'motion' | 'content' | 'node' | 'sprite' | 'flat';
/** The executor's layers, and the transition layer above the world where a screen target shows. */
type StageLayer = Layer | 'flat';
/** `parent`: null for a node at the top of its layer. */
type Node = {
  readonly id: number;
  readonly role: Role;
  readonly layer: StageLayer;
  readonly key: string;
  readonly parent: number | null;
  alive: boolean;
  p: Placement;
  readonly tex: Tex | null;
};

const S390: Size = { w: 390, h: 844 };

/**
 * `freed`: the textures whose Decoded.release() ran (by identity: every load decodes a new texture object). `targets`
 * (opt-in): the stage draws transition targets (`draw`), or answers every `flatten` with null (`refuse`: a closed
 * render gate), and draws the camera (each world delta written, in `worlds`); absent, it has neither member, as every
 * stage before lane SH6.
 */
function recordingStage(size: Size, freed: ReadonlySet<Tex> = new Set(), targets?: 'draw' | 'refuse') {
  let n = 0;
  const log: string[] = [];
  /** Every `set` that wrote an alpha: its target's role and key. */
  const alphas: Array<{ role: Role; key: string; alpha: number }> = [];
  const nodes = new Map<number, Node>();
  /** The live children of each parent (a node, or a layer for its top nodes) in Pixi's array order. */
  const kids = new Map<number | StageLayer, number[]>();
  /** Every `flatten` call's plan, in order (a refused one included). */
  const plans: FlatPlan[] = [];
  /** Every world delta written, in order. */
  const worlds: WorldDelta[] = [];
  const stage = { size };
  const node = (k: number): Node => {
    const x = nodes.get(k);
    if (x === undefined || !x.alive) {
      throw new Error(`stage: node ${k} is not alive`);
    }
    return x;
  };
  const add = (role: Role, layer: StageLayer, key: string, parent: number | null, tex: Tex | null): number => {
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
  // chars sprites log their character, a shot file's frame its id, every other sprite its asset name.
  const keyOf = (layer: Layer, id: AssetId): string =>
    layer === 'chars' ? (id.split('/')[1] ?? id) : /^(?:sheet|face|talk)\//.test(id) ? id : (id.split('/').pop() ?? id);
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
    node(parent, label) {
      log.push(`node:${label}`);
      return { group: add('node', node(parent.group).layer, label, parent.group, null) };
    },
    dropGroup(g) {
      const x = node(g.group);
      if (x.role !== 'char' && x.role !== 'anchor' && x.role !== 'node') {
        throw new Error(`stage: drop of an anchor's inner ${x.role} node`);
      }
      const art = below(x).find((d) => d.role === 'sprite' || d.role === 'flat');
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
  if (targets !== undefined) {
    adapter.world = (p) => {
      worlds.push({ ...p });
    };
    adapter.flatten = (plan, place) => {
      plans.push(plan);
      if (targets === 'refuse') {
        log.push('flatten:refused');
        return null;
      }
      const parent = place.kind === 'screen' ? null : node(place.parent.group);
      const key = parent === null ? 'screen' : `patch:${parent.key}`;
      log.push(`flatten:${key}:${plan.w}x${plan.h}`);
      const id = add('flat', parent?.layer ?? 'flat', key, parent?.id ?? null, null);
      if (place.kind === 'group') {
        Object.assign(node(id).p, { x: place.x, y: place.y, scale: place.k, z: place.z });
      }
      return { sprite: id, flat: true };
    };
    adapter.dropTarget = (f) => {
      const x = node(f.sprite);
      if (x.role !== 'flat') {
        throw new Error(`stage: dropTarget of a ${x.role} node`);
      }
      kill(x);
      log.push(`dropTarget:${x.key}`);
    };
  }
  const live = (layer: Layer): Node[] => [...nodes.values()].filter((x) => x.role === 'sprite' && x.alive && x.layer === layer);
  /** The live transition targets, in creation order. */
  const flats = (): Node[] => [...nodes.values()].filter((x) => x.role === 'flat' && x.alive);
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
  return { adapter, log, alphas, live, flats, plans, worlds, inGroup, liveNodes, anchors, rolesAbove, worldAlpha, worldBox, drawOrder, contentOf, stage };
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
  // Two shots of one place (the shots plan's SH4): plates, sheets, face files and talk files.
  'bg/lamp': image('bg_lamp', 1080, 2048),
  'bg/lamp_cu': image('bg_lamp_cu', 1080, 2048),
  'sheet/lamp': image('sheet_lamp', 512, 512),
  'sheet/lamp_cu': image('sheet_lamp_cu', 512, 512),
  'face/lamp/ally/smile': image('face_lamp_ally_smile', 256, 256),
  'face/lamp/ally/worried': image('face_lamp_ally_worried', 256, 256),
  'face/lamp/stranger/smile': image('face_lamp_stranger_smile', 256, 256),
  'face/lamp_cu/ally/smile': image('face_lamp_cu_ally_smile', 256, 256),
  'talk/lamp/ally/neutral': image('talk_lamp_ally_neutral', 128, 64),
  'talk/lamp/ally/smile': image('talk_lamp_ally_smile', 128, 64),
  'talk/lamp/ally/worried': image('talk_lamp_ally_worried', 128, 64),
  'talk/lamp/stranger/neutral': image('talk_lamp_stranger_neutral', 128, 64),
  'talk/lamp/stranger/smile': image('talk_lamp_stranger_smile', 128, 64),
  'talk/lamp_cu/ally/neutral': image('talk_lamp_cu_ally_neutral', 128, 64),
  'talk/lamp_cu/ally/smile': image('talk_lamp_cu_ally_smile', 128, 64),
};
const urlOf = (id: string): string => ENTRIES[id]?.avif.url ?? `missing:${id}`;

/** A loop on a ticker that never ticks: these tests watch the stage, not the frames. */
const quietLoop = (): RenderLoop => createRenderLoop({ ticker: { add: () => {}, remove: () => {} }, render: () => {} });

/**
 * `shots`: the executor's shot dep (absent: none). The registry cuts frames as stand-ins named `<file url>#<box>`; a
 * disposed frame joins `freed`, so a sprite drawn on it throws like one on a released texture. `seat`: the window
 * seat's two reports (shots §5.8; absent: none). `targets`: the stage's target members (recordingStage). The
 * executor's GPU generation is the harness's (`setGen`).
 */
function harness(
  size: Size = S390,
  loop: RenderLoop = quietLoop(),
  shots?: { rigs(): ReadonlyMap<BgId, ShotRig> | null; half(): boolean },
  seat?: Pick<ExecutorDeps<Tex>, 'swapped' | 'released'>,
  targets?: 'draw' | 'refuse',
) {
  const freed = new Set<Tex>();
  const stage = recordingStage(size, freed, targets);
  const loads = new Map<string, number>();
  const released = new Map<string, number>();
  const byUrl = new Map(Object.values(ENTRIES).map((e) => [e.avif.url, e]));
  let gen = 1;
  /** Per URL: every revive fails, or each waits for `settle` (held). */
  const reviveRule = new Map<string, 'fail' | 'hold'>();
  const heldRevives = new Map<string, Array<(r: Result<void, LoadError>) => void>>();
  /** Per URL: the next load waits until the test lets it settle. */
  const deferred = new Map<string, { ready: boolean; go: (() => void) | null }>();
  /** URLs whose every load fails to decode. */
  const broken = new Set([urlOf('bg/broken')]);
  const load: LoadImage<Tex> = (ref) => {
    loads.set(ref.url, (loads.get(ref.url) ?? 0) + 1);
    const e = byUrl.get(ref.url);
    if (e === undefined || broken.has(ref.url)) {
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
  const frames: FrameCut<Tex> = {
    cut: (base, box) => ({ url: `${base.url}#${box.join(',')}` }),
    dispose: (frame) => {
      freed.add(frame);
    },
  };
  const registry = createAssetRegistry<Tex>({ load, variant: 'avif', tier: 'full', frames });
  const resolve = (id: AssetId): Result<ImageEntry, AssetError> => {
    const e = Object.hasOwn(ENTRIES, id) ? ENTRIES[id] : undefined;
    return e === undefined ? { ok: false, error: { kind: 'missing-id', id } } : { ok: true, value: e };
  };
  const skipped: AssetError[] = [];
  const onSkip = (e: AssetError): void => {
    skipped.push(e);
  };
  const ex = createExecutor<Tex>({
    adapter: stage.adapter,
    registry,
    resolve,
    loop,
    resolution: 2,
    onSkip,
    gen: () => gen,
    ...(shots === undefined ? {} : { shots }),
    ...seat,
  });
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
    /** Every later load of `id` fails to decode (a manifest file whose bytes are broken). */
    failLoad: (id: string): void => {
      broken.add(urlOf(id));
    },
    /** Every later load of `id` decodes again (the fetch that failed was the network's). */
    mendLoad: (id: string): void => {
      broken.delete(urlOf(id));
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
const face = (c: string, e: string, ms: number | null = null): VisualCommand => ({
  kind: 'face',
  char: c as CharId,
  expr: e as ExprId,
  ms,
});
/** A camera move as the parser types it (`ms: null`: the move's default). */
const camera = (move: Extract<VisualCommand, { kind: 'cam' }>['cam'], ms: number | null = null): VisualCommand => ({
  kind: 'cam',
  cam: move,
  ms,
});
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
  // The moved prop is drawn there from its live record in the same batch (RULINGS 245 Q8, GM6a review r2's carry).
  const m = harness();
  await m.ex.apply([bg('room', 'cut'), props(['drawer', DRAWER, 'room.drawer'], ['glint', GLINT, 'room.glint'])], NOW);
  const base = one(m.anchors('props').filter((x) => x.key === 'room.drawer'));
  await m.ex.apply([bg('room', 'crossfade', 300), props(['drawer', DRAWER, 'room.drawer'], ['glint', GLINT, 'room.drawer', 'patch'])], { instant: true });
  expect(m.anchors('props')).toEqual([base]);
  expect(m.drawOrder(m.contentOf(base)).map((x) => x.key)).toEqual(['drawer', 'glint']);
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

test('executor: a face changes the expression of a character on stage and nothing else', async () => {
  const h = harness();
  await h.ex.apply([bg('cafe', 'cut'), show('ally', 'neutral', 'left', 'cut'), show('stranger', 'serious', 'right', 'cut')], NOW);
  const shown = [...h.live('bg'), ...h.inGroup('stranger')];
  h.log.length = 0;
  const swap = track(h.ex.apply([face('ally', 'worried')], NOW));
  // The logical stage at batch start: ally's expression changed, her slot and the z-order kept.
  expect(h.ex.snapshot().chars).toEqual([
    { char: 'ally', expr: 'worried', at: 'left' },
    { char: 'stranger', expr: 'serious', at: 'right' },
  ]);
  await flush();
  // The expression crossfade of a show: the new sprite over the old one in ally's group, 200 ms by default.
  advance(150);
  await flush();
  expect(swap.done).toBe(false);
  expect(h.inGroup('ally').map((x) => x.key)).toEqual(['ally', 'ally']);
  advance(100);
  await flush();
  expect(swap.done).toBe(true);
  expect(h.inGroup('ally').length).toBe(1);
  expect(h.releasedOf('char/ally/neutral')).toBe(1);
  // Nothing else moved: the bg and the stranger keep their sprites, no anchor or group was made or dropped.
  expect([...h.live('bg'), ...h.inGroup('stranger')]).toEqual(shown);
  expect(h.log.filter((x) => /^(anchor|group|drop):/.test(x))).toEqual([]);
  expect(h.log.filter((x) => /^(create|destroy):/.test(x))).toEqual(['create:chars:ally', 'destroy:chars:ally']);
  // A face of a character not on stage adds no one.
  await h.ex.apply([hide('stranger', 'cut')], NOW);
  h.log.length = 0;
  await h.ex.apply([face('stranger', 'serious')], NOW);
  expect(h.ex.snapshot().chars).toEqual([{ char: 'ally', expr: 'worried', at: 'left' }]);
  expect(h.inGroup('stranger')).toEqual([]);
  expect(h.log.filter((x) => /^(anchor|group|create|destroy|drop):/.test(x))).toEqual([]);
  h.ex.destroy();
});

test('executor: a cam move persists in the snapshot until the next cut', async () => {
  const h = harness();
  await h.ex.apply([bg('cafe', 'cut'), show('ally', 'neutral', 'left', 'cut')], NOW);
  const push = { kind: 'push', to: 'ally' as CharId, z: 120 } as const;
  await h.ex.apply([camera(push)], NOW);
  expect(h.ex.snapshot().cam).toEqual(push);
  // A show, a CG and a wait keep the framing; the legacy harness draws no camera (no rig).
  await h.ex.apply([show('stranger', 'serious', 'right', 'cut')], NOW);
  await h.ex.apply([cg('letter', 'cut')], NOW);
  await h.ex.apply([wait(100)], { instant: true });
  expect(h.ex.snapshot().cam).toEqual(push);
  // A pull is the rest framing: the key is absent, as in every stage without a move.
  await h.ex.apply([camera({ kind: 'pull' })], NOW);
  expect('cam' in h.ex.snapshot()).toBe(false);
  // A restored stage keeps its framing (the copy path) until a bg cut; a bg and a cam in one batch set the new one.
  const pan = { kind: 'pan', to: 'left' } as const;
  await h.ex.restore({ ...h.ex.snapshot(), cam: pan });
  expect(h.ex.snapshot().cam).toEqual(pan);
  await h.ex.apply([cg('letter', 'cut')], NOW);
  expect(h.ex.snapshot().cam).toEqual(pan);
  await h.ex.apply([bg('street', 'cut')], NOW);
  expect('cam' in h.ex.snapshot()).toBe(false);
  await h.ex.apply([bg('cafe', 'cut'), camera(push)], NOW);
  expect(h.ex.snapshot().cam).toEqual(push);
  h.ex.destroy();
});

test('executor: a scene resets the camera', async () => {
  const h = harness();
  await h.ex.apply([bg('cafe', 'cut')], NOW);
  const push = { kind: 'push', to: 'center', z: 110 } as const;
  await h.ex.apply([camera(push)], NOW);
  expect(h.ex.snapshot().cam).toEqual(push);
  await h.ex.apply([scene('street', 'cut')], NOW);
  expect('cam' in h.ex.snapshot()).toBe(false);
  // A scene with a cam: the scene resets, then the batch's move is the new framing.
  await h.ex.apply([scene('cafe', 'cut'), camera({ kind: 'pan', to: 'right' })], NOW);
  expect(h.ex.snapshot().cam).toEqual({ kind: 'pan', to: 'right' });
  h.ex.destroy();
});

// ---------------------------------------------------------------------------------------------------------------
// Item 2 (b) of the shots plan's SH1 (GM6a's cut Q6, RULINGS 196, 198 W2, 200): a build that throws after it made an
// anchor or a sprite leaves nothing it made untracked, and no kept anchor tracks a view that is gone.

/** `adapter.sprite` throws for one asset id (keyed on the texture, so a crossfade's other sprites do not shift it). */
function throwOn(h: ReturnType<typeof harness>, id: string): void {
  const sprite = h.adapter.sprite.bind(h.adapter);
  h.adapter.sprite = (layer, tex, g) => {
    if (tex.id === id) {
      throw new Error(`stage: a bug in the build of ${id}`);
    }
    return sprite(layer, tex, g);
  };
}

/** Applies a batch whose build throws: the chain's catch logs it once and the apply still settles. */
async function applyFailing(h: ReturnType<typeof harness>, cmds: readonly VisualCommand[]): Promise<void> {
  const spy = spyErrors();
  const applied = track(h.ex.apply(cmds, NOW));
  await flush();
  spy.restore();
  expect(spy.errors.map((e) => e[0])).toEqual(['scene: batch failed']);
  expect(applied.done).toBe(true);
}

test('executor: a build whose view creation throws after the anchor leaves no anchor in its layer', async () => {
  // (a) A backdrop: the bg's anchor is made, then its sprite throws.
  const a = harness();
  throwOn(a, 'bg/cafe');
  await applyFailing(a, [bg('cafe', 'crossfade', 500)]);
  expect(a.anchors('bg').map((x) => x.key)).toEqual([]);
  a.ex.destroy();
  expect(a.liveNodes().map((x) => `${x.role}:${x.key}`)).toEqual([]);

  // (b) Two new prop anchors, the second one's sprite throws: neither anchor nor the first sprite stays.
  const b = harness();
  await b.ex.apply([bg('room', 'cut')], NOW);
  throwOn(b, 'prop/key');
  await applyFailing(b, [props(['lamp', LAMP, 'room.lamp'], ['key', KEY, 'room.key'])]);
  expect(b.anchors('props').map((x) => x.key)).toEqual([]);
  expect(b.live('props')).toEqual([]);
  b.ex.destroy();
  expect(b.liveNodes().map((x) => `${x.role}:${x.key}`)).toEqual([]);

  // (c) A kept anchor gains a patch, then its next patch throws: the anchor keeps only what it showed.
  const c = harness();
  await c.ex.apply([bg('room', 'cut'), props(['drawer', DRAWER, 'room.drawer'])], NOW);
  const drawer = c.anchors('props');
  throwOn(c, 'prop/key');
  await applyFailing(c, [
    bg('room', 'crossfade', 300),
    props(['drawer', DRAWER, 'room.drawer'], ['glint', GLINT, 'room.drawer', 'patch'], ['key', KEY, 'room.drawer', 'patch']),
  ]);
  expect(c.live('props').map((x) => x.key)).toEqual(['drawer']);
  expect(c.anchors('props')).toEqual(drawer);
  expect(() => c.ex.destroy()).not.toThrow();
  expect(c.liveNodes().map((x) => `${x.role}:${x.key}`)).toEqual([]);

  // (d) A kept anchor whose base swaps (its old image leaves) and whose new image throws, after another kept anchor
  // gained a patch: the leaving view is not tracked once it is gone, the other anchor's new sprite is live and tracked.
  const d = harness();
  await d.ex.apply([bg('room', 'cut'), props(['lamp', LAMP, 'room.lamp'], ['drawer', DRAWER, 'room.drawer'])], NOW);
  const kept = d.anchors('props');
  throwOn(d, 'prop/drawer_open');
  await applyFailing(d, [
    bg('room', 'crossfade', 300),
    props(['lamp', LAMP, 'room.lamp'], ['glint', GLINT, 'room.lamp', 'patch'], ['drawer_open', DRAWER_OPEN, 'room.drawer']),
  ]);
  expect(d.ex.propRects().map((r) => r.prop)).toEqual(['lamp', 'glint']);
  expect(d.live('props').map((x) => x.key)).toEqual(['lamp', 'glint']);
  expect(d.anchors('props')).toEqual(kept);
  expect(() => d.ex.destroy()).not.toThrow();
  expect(d.liveNodes().map((x) => `${x.role}:${x.key}`)).toEqual([]);
});

test('executor: a character whose sprite throws leaves no group in its layer', async () => {
  // SH1 cut Q5: newChar makes the group, then its sprite throws; the group goes with it, as a backdrop's anchor does.
  const h = harness();
  await h.ex.apply([bg('cafe', 'cut')], NOW);
  throwOn(h, 'char/ally/neutral');
  h.log.length = 0;
  await applyFailing(h, [show('ally', 'neutral', 'left', 'cut')]);
  expect(h.log.filter((x) => /^(group|drop):/.test(x))).toEqual(['group:ally', 'drop:ally']);
  expect(h.liveNodes().filter((x) => x.role === 'char')).toEqual([]);
  h.ex.destroy();
  expect(h.liveNodes().map((x) => `${x.role}:${x.key}`)).toEqual([]);
});

test('executor: a rebind whose prop sprite throws leaves no anchor in its layer', async () => {
  // SH1 cut Q5: rebind's props loop makes the anchor, then a sprite in it throws; the sprites it made and the anchor go.
  const h = harness();
  await h.ex.apply([bg('room', 'cut'), props(['drawer', DRAWER, 'room.drawer'], ['glint', GLINT, 'room.drawer', 'patch'])], NOW);
  const fresh = recordingStage(S390, h.freed);
  const sprite = fresh.adapter.sprite.bind(fresh.adapter);
  fresh.adapter.sprite = (layer, tex, g) => {
    if (tex.id === 'prop/glint') {
      throw new Error('stage: a bug in the build of prop/glint');
    }
    return sprite(layer, tex, g);
  };
  expect(() => h.ex.rebind(fresh.adapter)).toThrow('prop/glint');
  expect(fresh.log.filter((x) => /^(anchor:props|create:props|destroy|drop):/.test(x))).toEqual([
    'anchor:props:room.drawer',
    'create:props:drawer',
    'destroy:props:drawer',
    'drop:room.drawer',
  ]);
  expect(fresh.anchors('props')).toEqual([]);
  expect(fresh.live('props')).toEqual([]);
});

test('executor: a rebind whose character sprite throws leaves no group in its layer', async () => {
  // Carry E2: rebind's chars loop makes the group, then its sprite throws; the group goes with it (newChar's rule).
  const h = harness();
  await h.ex.apply([bg('cafe', 'cut'), show('ally', 'neutral', 'left', 'cut')], NOW);
  const fresh = recordingStage(S390, h.freed);
  const sprite = fresh.adapter.sprite.bind(fresh.adapter);
  fresh.adapter.sprite = (layer, tex, g) => {
    if (tex.id === 'char/ally/neutral') {
      throw new Error('stage: a bug in the build of char/ally/neutral');
    }
    return sprite(layer, tex, g);
  };
  expect(() => h.ex.rebind(fresh.adapter)).toThrow('char/ally/neutral');
  expect(fresh.log.filter((x) => /^(group|drop):/.test(x))).toEqual(['group:ally', 'drop:ally']);
  expect(fresh.liveNodes().filter((x) => x.role === 'char')).toEqual([]);
});

// ---------------------------------------------------------------------------------------------------------------
// SH1 review M2 / M3: a show and a face of one character in one batch.

test('executor: a show governs the timing of a face of the same character in its batch', async () => {
  const h = harness();
  await h.ex.apply([bg('cafe', 'cut'), show('ally', 'neutral', 'left', 'cut')], NOW);
  // The face asks for 1000 ms, the show for a cut: the show governs, so the expression changes at once.
  const both = track(h.ex.apply([face('ally', 'worried', 1000), show('ally', 'neutral', null, 'cut')], NOW));
  await flush();
  expect(h.ex.stats().activeTimelines).toBe(0);
  expect(both.done).toBe(true);
  expect(h.ex.snapshot().chars).toEqual([{ char: 'ally', expr: 'worried', at: 'left' }]);
  expect(h.inGroup('ally').length).toBe(1);
  expect(h.releasedOf('char/ally/neutral')).toBe(1);
  h.ex.destroy();
});

test("executor: a face applies after the batch's show", async () => {
  // STAGING-DSL §7's order: shows, then faces; the tag order in the batch does not matter.
  for (const batch of [
    [show('ally', 'neutral', 'left', 'cut'), face('ally', 'worried')],
    [face('ally', 'worried'), show('ally', 'neutral', 'left', 'cut')],
  ]) {
    const h = harness();
    await h.ex.apply([bg('cafe', 'cut'), ...batch], { instant: true });
    expect(h.ex.snapshot().chars).toEqual([{ char: 'ally', expr: 'worried', at: 'left' }]);
    h.ex.destroy();
  }
});

// ---------------------------------------------------------------------------------------------------------------
// RULINGS 245 Q8: the prop carry (GM3b's executor items).

test('executor: a prop moving to another anchor shows at its new key in the same batch', async () => {
  // GM6a cut deviation 5 / fix_r1: a two-view anchor whose patch leaves to its own key; the target still names the
  // old anchor, so nothing is taken over. The moved view is drawn at its new key from the live record, with no take.
  const h = harness();
  await h.ex.apply([bg('room', 'cut'), props(['drawer', DRAWER, 'room.drawer'], ['glint', GLINT, 'room.drawer', 'patch'])], NOW);
  const loads = h.loadsOf('prop/glint');
  await h.ex.apply([bg('room', 'crossfade', 300), props(['drawer', DRAWER, 'room.drawer'], ['glint', GLINT, 'room.glint'])], { instant: true });
  expect(h.anchors('props').map((x) => x.key)).toEqual(['room.drawer', 'room.glint']);
  const glint = one(h.anchors('props').filter((x) => x.key === 'room.glint'));
  expect(h.drawOrder(h.contentOf(glint)).map((x) => x.key)).toEqual(['glint']);
  expect(h.ex.propRects().map((r) => r.prop)).toEqual(['drawer', 'glint']);
  expect(h.loadsOf('prop/glint')).toBe(loads);
  expect(h.releasedOf('prop/glint')).toBe(0);
  h.ex.destroy();
  expect(h.liveNodes().map((x) => `${x.role}:${x.key}`)).toEqual([]);
});

test('executor: a restore re-keys a multi-view anchor without a new anchor', async () => {
  // GM6a test_r2 TM5 / TM13: the take-over looks at every view of the anchor, not only at its first.
  const h = harness();
  await h.ex.apply([bg('room', 'cut'), props(['drawer', DRAWER, 'room.drawer'], ['glint', GLINT, 'room.drawer', 'patch'])], NOW);
  const before = h.anchors('props');
  h.log.length = 0;
  await h.ex.restore({ bg: 'room' as BgId, cg: null, chars: [], props: [{ prop: 'drawer' as PropId, rect: DRAWER }] });
  expect(h.anchors('props')).toEqual(before);
  expect(h.log.filter((x) => /^(anchor|drop):/.test(x))).toEqual([]);
  expect(h.log.filter((x) => /^(create|destroy):/.test(x))).toEqual(['destroy:props:glint']);
  h.ex.destroy();
});

test('executor: a restore re-keys a multi-view anchor by its patch alone', async () => {
  // Pre-merge V-I1 (TM13): the anchor's first view is its base, so only a target naming a later view (the patch) tells
  // "every view" from "the first view only".
  const h = harness();
  await h.ex.apply([bg('room', 'cut'), props(['drawer', DRAWER, 'room.drawer'], ['glint', GLINT, 'room.drawer', 'patch'])], NOW);
  const before = h.anchors('props');
  h.log.length = 0;
  await h.ex.restore({ bg: 'room' as BgId, cg: null, chars: [], props: [{ prop: 'glint' as PropId, rect: GLINT }] });
  expect(h.anchors('props')).toEqual(before);
  expect(h.log.filter((x) => /^(anchor|drop):/.test(x))).toEqual([]);
  expect(h.log.filter((x) => /^(create|destroy):/.test(x))).toEqual(['destroy:props:drawer']);
  h.ex.destroy();
});

test('executor: one prop at two anchors keeps both', async () => {
  // The logical stage keys a placement by its anchor (`at ?? prop`), so one prop id at two anchors is two placements.
  const h = harness();
  await h.ex.apply([bg('room', 'cut'), props(['lamp', LAMP, 'room.lamp'], ['lamp', KEY, 'room.key'])], NOW);
  expect(h.ex.snapshot().props.map((p) => p.at)).toEqual(['room.lamp', 'room.key']);
  expect(h.anchors('props').map((x) => x.key)).toEqual(['room.lamp', 'room.key']);
  expect(h.live('props').map((x) => x.key)).toEqual(['lamp', 'lamp']);
  h.ex.destroy();
  expect(h.liveNodes().map((x) => `${x.role}:${x.key}`)).toEqual([]);
});

// ---------------------------------------------------------------------------------------------------------------
// Shots drawn from rigs (docs/plans/shots §5.1-5.2, §5.5, lane SH4): the plate and the drawn faces in the bg anchor.

const mem = (file: string, frame: Box4, at: Box4): Member => ({ file: asId(file), frame, at });
/**
 * A face member of `shot` at `at`: rest `neutral` (talk), `smile` and `worried` (each a layer; talk where the shot has
 * it). `moved`: an expression whose layer sits at another box of the same size.
 */
function castMember(shot: string, c: string, at: Box4, moved: Readonly<Record<string, Box4>> = {}): CastRig & { char: CharId } {
  const talkOf = (x: string): Member[] => (Object.hasOwn(ENTRIES, `talk/${shot}/${c}/${x}`) ? [mem(`talk/${shot}/${c}/${x}`, [0, 0, 40, 20], [at[0] + 40, at[1] + 140, 40, 20])] : []);
  const motion = (x: string) => {
    const f = `face/${shot}/${c}/${x}`;
    return { blink: { half: mem(f, [0, 0, 1, 1], at), closed: mem(f, [1, 0, 1, 1], at) }, talk: talkOf(x), accent: mem(f, [2, 0, 1, 1], at) };
  };
  const expr = (x: string) =>
    Object.hasOwn(ENTRIES, `face/${shot}/${c}/${x}`) ? { [x]: { layer: mem(`face/${shot}/${c}/${x}`, [0, 40, at[2], at[3]], moved[x] ?? at), motion: motion(x) } } : {};
  return {
    char: c as CharId,
    view: 'face',
    face: { rest: 'neutral' as ExprId, exprs: { ['neutral' as ExprId]: { layer: null, motion: motion('neutral') }, ...expr('smile'), ...expr('worried') }, head: at },
    body: { cx: 540, cy: 1300, rx: 200, ry: 600, rot: 0, feet: [540, 1900] },
    headDepth: 0.5,
    plateau: '',
    plateauCoarse: '',
    band: 40,
    group: 0,
    figure: null,
    hair: [{ member: mem(`sheet/${shot}`, [0, 0, 200, 120], [at[0], at[1] - 60, 200, 120]), pivot: [at[0] + 100, at[1]] }],
  };
}
const shotRig = (cast: ShotRig['cast']): ShotRig => ({ w: 1080, h: 2048, frame: 'two', focus: [540, 1024], cast, planes: [], ambient: [], depth: '' });
const ALLY_AT: Box4 = [200, 520, 160, 200];
const LAMP_RIG = shotRig([castMember('lamp', 'ally', ALLY_AT), castMember('lamp', 'stranger', [700, 500, 160, 200])]);
const LAMP_RIGS: ReadonlyMap<BgId, ShotRig> = new Map([
  ['lamp' as BgId, LAMP_RIG],
  ['lamp_cu' as BgId, shotRig([castMember('lamp_cu', 'ally', [400, 600, 300, 380])])],
]);
const shotHarness = (): ReturnType<typeof harness> => harness(S390, quietLoop(), { rigs: () => LAMP_RIGS, half: () => false });
/** The shot parts' nodes alive, in creation order. */
const partNodes = (h: ReturnType<typeof harness>): string[] => h.liveNodes().filter((x) => x.role === 'node').map((x) => x.key);
const drawLog = (h: ReturnType<typeof harness>): string[] => h.log.filter((x) => /^(anchor|node|create|destroy|drop):/.test(x));

test("executor: a shot draws its plate and its cast's drawn faces in the bg anchor", async () => {
  const h = shotHarness();
  await h.ex.apply([scene('lamp', 'cut'), face('ally', 'smile')], NOW);
  // The face of a shot chapter is in the snapshot without a show.
  expect(h.ex.snapshot().chars).toEqual([{ char: 'ally', expr: 'smile', at: 'center' }]);
  expect(drawLog(h)).toEqual(['anchor:bg:bg/lamp', 'create:bg:lamp', 'node:face:ally', 'create:bg:face/lamp/ally/smile', 'create:bg:sheet/lamp']);
  // The stranger is at rest: the plate shows it, no group.
  expect(partNodes(h)).toEqual(['face:ally']);
  // The bg anchor sits at the rest framing, scaled; the plate and the members are in plate px inside it.
  const f = restFraming(LAMP_RIG, S390, 2, false);
  expect(one(h.anchors('bg')).p).toMatchObject({ x: f.x, y: f.y, scale: f.k, alpha: 1 });
  const [plate, layer, hair] = h.live('bg');
  expect(plate?.p).toMatchObject({ w: 1080, h: 2048 });
  expect(layer?.p).toMatchObject({ x: 200, y: 520, w: 160, h: 200 });
  expect(hair?.p).toMatchObject({ x: 200, y: 460, w: 200, h: 120 });
  // Each member draws a frame of its record, not the whole file.
  expect([layer?.tex, hair?.tex]).toEqual([{ url: '/assets/face_lamp_ally_smile.avif#0,40,160,200' }, { url: '/assets/sheet_lamp.avif#0,0,200,120' }]);
  for (const x of [layer, hair]) {
    expect(x === undefined ? [] : h.rolesAbove(x)).toEqual(['node', 'content', 'motion', 'depth', 'anchor', 'layer']);
  }
  expect(plate === undefined ? [] : h.rolesAbove(plate)).toEqual(['content', 'motion', 'depth', 'anchor', 'layer']);
  h.ex.destroy();
  expect(h.liveNodes().map((x) => `${x.role}:${x.key}`)).toEqual([]);
  expect(h.registry.stats().live).toBe(0);
});

test("executor: a face change swaps only that character's groups", async () => {
  const h = shotHarness();
  await h.ex.apply([scene('lamp', 'cut'), face('ally', 'smile'), face('stranger', 'smile')], NOW);
  const stranger = h.liveNodes().filter((x) => x.key === 'face:stranger' || x.key === 'face/lamp/stranger/smile');
  h.log.length = 0;
  h.alphas.length = 0;
  const swap = track(h.ex.apply([face('ally', 'worried')], NOW));
  await flush();
  advance(100);
  await flush();
  // K7: the new expression group fades in over the old one, which stays opaque; the stranger is not touched.
  expect(partNodes(h)).toEqual(['face:ally', 'face:stranger', 'face:ally']);
  const [, , fresh] = h.liveNodes().filter((x) => x.role === 'node');
  expect(fresh?.p.alpha).toBeGreaterThan(0);
  expect(fresh?.p.alpha).toBeLessThan(1);
  advance(150);
  await flush();
  expect(swap.done).toBe(true);
  // The old group left whole with all its sprites; the new one holds only the new expression's own set (O2).
  expect(drawLog(h)).toEqual([
    'node:face:ally',
    'create:bg:face/lamp/ally/worried',
    'create:bg:sheet/lamp',
    'destroy:bg:face/lamp/ally/smile',
    'destroy:bg:sheet/lamp',
    'drop:face:ally',
  ]);
  expect(partNodes(h)).toEqual(['face:stranger', 'face:ally']);
  expect(stranger.every((x) => x.alive)).toBe(true);
  expect(h.alphas.filter((w) => w.key.includes('stranger'))).toEqual([]);
  expect(h.releasedOf('face/lamp/ally/smile')).toBe(1);
  expect(h.releasedOf('sheet/lamp')).toBe(0);
  // Back to the rest: the group fades out and leaves; the plate shows the face.
  await h.ex.apply([face('ally', 'neutral')], { instant: true });
  expect(partNodes(h)).toEqual(['face:stranger']);
  h.ex.destroy();
  expect(h.liveNodes().map((x) => `${x.role}:${x.key}`)).toEqual([]);
});

test("executor: a cut destroys the old shot's layers", async () => {
  const h = shotHarness();
  await h.ex.apply([scene('lamp', 'cut'), face('ally', 'smile')], NOW);
  h.log.length = 0;
  const cut = track(h.ex.apply([bg('lamp_cu', 'cut')], NOW));
  await flush();
  // At once: the old root's parts, its plate and its anchor go; the new shot is built with the faces a bg keeps.
  expect(cut.done).toBe(true);
  expect(drawLog(h)).toEqual([
    'destroy:bg:face/lamp/ally/smile',
    'destroy:bg:sheet/lamp',
    'drop:face:ally',
    'destroy:bg:lamp',
    'drop:bg/lamp',
    'anchor:bg:bg/lamp_cu',
    'create:bg:lamp_cu',
    'node:face:ally',
    'create:bg:face/lamp_cu/ally/smile',
    'create:bg:sheet/lamp_cu',
  ]);
  expect(['bg/lamp', 'sheet/lamp', 'face/lamp/ally/smile'].map(h.releasedOf)).toEqual([1, 1, 1]);
  // The fallback (this stage has no `flatten`): the new root over the old, which retires whole.
  h.log.length = 0;
  const dissolve = track(h.ex.apply([bg('lamp', 'crossfade', 300)], NOW));
  await flush();
  advance(150);
  expect(h.anchors('bg').map((x) => x.key)).toEqual(['bg/lamp_cu', 'bg/lamp']);
  advance(200);
  await flush();
  expect(dissolve.done).toBe(true);
  expect(h.anchors('bg').map((x) => x.key)).toEqual(['bg/lamp']);
  expect(drawLog(h).filter((x) => /^(destroy|drop):/.test(x))).toEqual([
    'destroy:bg:face/lamp_cu/ally/smile',
    'destroy:bg:sheet/lamp_cu',
    'drop:face:ally',
    'destroy:bg:lamp_cu',
    'drop:bg/lamp_cu',
  ]);
  h.ex.destroy();
  expect(h.liveNodes().map((x) => `${x.role}:${x.key}`)).toEqual([]);
});

test("executor: restore draws the snapshot's faces", async () => {
  const h = shotHarness();
  await h.ex.apply([scene('lamp', 'cut'), face('stranger', 'smile')], NOW);
  h.log.length = 0;
  await h.ex.restore({ bg: 'lamp' as BgId, cg: null, chars: [{ char: 'ally' as CharId, expr: 'smile' as ExprId, at: 'center' }], props: [] });
  // Instantly: the snapshot's face drawn, the stranger back at rest; the plate kept.
  expect(partNodes(h)).toEqual(['face:ally']);
  expect(drawLog(h)).toEqual([
    'node:face:ally',
    'create:bg:face/lamp/ally/smile',
    'create:bg:sheet/lamp',
    'destroy:bg:face/lamp/stranger/smile',
    'destroy:bg:sheet/lamp',
    'drop:face:stranger',
  ]);
  expect(h.ex.stats().activeTimelines).toBe(0);
  // A fresh executor restores the shot whole.
  const r = shotHarness();
  await r.ex.restore({ bg: 'lamp' as BgId, cg: null, chars: [{ char: 'ally' as CharId, expr: 'smile' as ExprId, at: 'center' }], props: [] });
  expect(drawLog(r)).toEqual(['anchor:bg:bg/lamp', 'create:bg:lamp', 'node:face:ally', 'create:bg:face/lamp/ally/smile', 'create:bg:sheet/lamp']);
  h.ex.destroy();
  r.ex.destroy();
});

test('executor: a shot whose member sprite throws leaves no shot root', async () => {
  // (a) The face layer throws; (b) the hair lock after it throws: neither the part nor the root stays.
  for (const id of ['face/lamp/ally/smile', 'sheet/lamp']) {
    const h = shotHarness();
    throwOn(h, id);
    await applyFailing(h, [scene('lamp', 'cut'), face('ally', 'smile')]);
    expect(h.anchors('bg'), id).toEqual([]);
    expect(h.liveNodes().map((x) => `${x.role}:${x.key}`), id).toEqual([]);
    h.ex.destroy();
    expect(h.liveNodes()).toEqual([]);
  }
});

test('executor: a bg without a rig is drawn as before', async () => {
  // The legacy pin: a shots dep whose rigs() is null draws exactly what no dep draws (ch1-ch3).
  const run = async (h: ReturnType<typeof harness>): Promise<string[]> => {
    await h.ex.apply([scene('cafe', 'cut'), show('ally', 'neutral', 'left', 'cut'), face('stranger', 'serious')], NOW);
    await h.ex.apply([face('ally', 'worried'), props(['lamp', LAMP])], { instant: true });
    await h.ex.apply([bg('street', 'crossfade', 300)], { instant: true });
    await h.ex.restore({ ...h.ex.snapshot(), bg: 'cafe' as BgId });
    const out = [...h.log, JSON.stringify(h.ex.snapshot())];
    h.ex.destroy();
    return out;
  };
  const legacy = await run(harness());
  expect(legacy).toContain('create:chars:ally');
  expect(await run(harness(S390, quietLoop(), { rigs: () => null, half: () => false }))).toEqual(legacy);
});

// ---------------------------------------------------------------------------------------------------------------
// The face lifecycle (docs/plans/shots §5.2, lane SH4 C5): a failed file draws the rest; talk files held, never awaited.

/** Whether the registry still has a live record of `id` (the executor is its only holder in these tests). */
const liveIn = (h: ReturnType<typeof harness>, ids: readonly string[]): boolean[] => ids.map((id) => h.registry.current(asId(id)) !== null);

test('executor: a face state whose sheet failed shows the rest face and logs a skip', async () => {
  const h = shotHarness();
  h.failLoad('sheet/lamp');
  await h.ex.apply([scene('lamp', 'cut'), face('ally', 'smile')], NOW);
  // The logical stage keeps the face; the stage shows the plate alone, which draws every face at rest: no group, and
  // no layer without the hair locks the sheet carries.
  expect(h.ex.snapshot().chars).toEqual([{ char: 'ally', expr: 'smile', at: 'center' }]);
  expect(partNodes(h)).toEqual([]);
  expect(drawLog(h)).toEqual(['anchor:bg:bg/lamp', 'create:bg:lamp']);
  expect(h.skipped.map((e) => `${e.kind}:${e.id}`)).toEqual(['decode:sheet/lamp']);
  // The same for a face file that failed: the stranger's smile is skipped, ally's (sheet and file live) is drawn.
  const g = shotHarness();
  g.failLoad('face/lamp/stranger/smile');
  await g.ex.apply([scene('lamp', 'cut'), face('ally', 'smile'), face('stranger', 'smile')], NOW);
  expect(partNodes(g)).toEqual(['face:ally']);
  expect(g.skipped.map((e) => `${e.kind}:${e.id}`)).toEqual(['decode:face/lamp/stranger/smile']);
  for (const x of [h, g]) {
    x.ex.destroy();
    expect(x.liveNodes()).toEqual([]);
    expect(x.registry.stats().live).toBe(0);
  }
});

test('executor: a cut whose plate fails draws no file of the new shot on the kept root', async () => {
  // Review r1 I1: the new shot's plate fails, so the old root stays (the story goes on). Its rig also has the face's
  // expression, but the slots hold the new shot's face file and sheet: another shot's files are not live on this root,
  // so the face is drawn at rest. The cut, the dissolve and the dip share it.
  for (const cmd of [bg('lamp_cu', 'cut'), bg('lamp_cu', 'crossfade', 300), bg('lamp_cu', 'fade', 300)]) {
    const h = shotHarness();
    await h.ex.apply([scene('lamp', 'cut')], NOW);
    h.failLoad('bg/lamp_cu');
    h.log.length = 0;
    const b = track(h.ex.apply([cmd, face('ally', 'smile')], NOW));
    for (let i = 0; i < 4; i += 1) {
      await flush();
      advance(200);
    }
    await flush();
    const t = JSON.stringify(cmd);
    expect(b.done, t).toBe(true);
    expect(h.anchors('bg').map((x) => x.key), t).toEqual(['bg/lamp']);
    expect(h.live('bg').map((x) => x.tex?.url), t).toEqual(['/assets/bg_lamp.avif']);
    expect(partNodes(h), t).toEqual([]);
    expect(drawLog(h), t).toEqual([]);
    expect(h.skipped.map((e) => `${e.kind}:${e.id}`), t).toEqual(['decode:bg/lamp_cu']);
    // The logical stage keeps the face and holds the target's files, so a later batch can retry the plate.
    expect(h.ex.snapshot().chars, t).toEqual([{ char: 'ally', expr: 'smile', at: 'center' }]);
    h.ex.destroy();
    expect(h.liveNodes(), t).toEqual([]);
    expect(h.registry.stats().live, t).toBe(0);
  }
  // The pin: a face the kept root already draws keeps its own files.
  const g = shotHarness();
  await g.ex.apply([scene('lamp', 'cut'), face('ally', 'smile')], NOW);
  g.failLoad('bg/lamp_cu');
  g.log.length = 0;
  await g.ex.apply([bg('lamp_cu', 'cut')], NOW);
  expect(g.live('bg').map((x) => x.tex?.url)).toEqual([
    '/assets/bg_lamp.avif',
    '/assets/face_lamp_ally_smile.avif#0,40,160,200',
    '/assets/sheet_lamp.avif#0,0,200,120',
  ]);
  expect(drawLog(g)).toEqual([]);
  g.ex.destroy();
  expect(g.liveNodes()).toEqual([]);
  expect(g.registry.stats().live).toBe(0);
});

test('executor: a kept root draws no figure plane of another shot', async () => {
  // Triage r2 F1: a figure plane is cut from the `sheet` slot too. The root's own sheet failed, so its figure plane is
  // missing and every later draw retries it; the next shot's plate fails while that shot's sheet loads, so the kept
  // root's `sheet` slot holds another shot's sheet, which is not this root's figure: no plane is drawn from it.
  const at: Box4 = [100, 700, 400, 392];
  const figured = (shot: string, c: string, head: Box4): CastRig & { char: CharId } => ({ ...castMember(shot, c, head), figure: mem(`sheet/${shot}`, [0, 120, 400, 392], at) });
  const rigs: ReadonlyMap<BgId, ShotRig> = new Map([
    ['lamp' as BgId, shotRig([figured('lamp', 'ally', ALLY_AT)])],
    ['lamp_cu' as BgId, shotRig([figured('lamp_cu', 'ally', [400, 600, 300, 380])])],
  ]);
  const figureHarness = (): ReturnType<typeof harness> => harness(S390, quietLoop(), { rigs: () => rigs, half: () => false });
  // The control: the same rig draws its own figure plane when its sheet loads, so the case below cannot pass because
  // no figure plane is ever drawn.
  const c = figureHarness();
  await c.ex.apply([scene('lamp', 'cut')], NOW);
  expect(c.live('bg').map((x) => x.tex?.url)).toEqual(['/assets/bg_lamp.avif', '/assets/sheet_lamp.avif#0,120,400,392']);
  expect(partNodes(c)).toEqual(['figure:ally']);
  c.ex.destroy();
  expect(c.liveNodes()).toEqual([]);
  expect(c.registry.stats().live).toBe(0);
  const h = figureHarness();
  h.failLoad('sheet/lamp');
  await h.ex.apply([scene('lamp', 'cut')], NOW);
  expect(h.live('bg').map((x) => x.tex?.url)).toEqual(['/assets/bg_lamp.avif']);
  h.failLoad('bg/lamp_cu');
  h.log.length = 0;
  const b = track(h.ex.apply([bg('lamp_cu', 'cut')], NOW));
  await flush();
  expect(b.done).toBe(true);
  expect(h.anchors('bg').map((x) => x.key)).toEqual(['bg/lamp']);
  expect(h.live('bg').map((x) => x.tex?.url)).toEqual(['/assets/bg_lamp.avif']);
  expect(partNodes(h)).toEqual([]);
  expect(drawLog(h)).toEqual([]);
  expect(h.skipped.map((e) => `${e.kind}:${e.id}`)).toEqual(['decode:sheet/lamp', 'decode:bg/lamp_cu']);
  h.ex.destroy();
  expect(h.liveNodes()).toEqual([]);
  expect(h.registry.stats().live).toBe(0);
});

test('executor: a face change releases the previous face and talk files after the transition', async () => {
  const h = shotHarness();
  await h.ex.apply([scene('lamp', 'cut'), face('ally', 'smile')], NOW);
  const smile = ['face/lamp/ally/smile', 'talk/lamp/ally/smile'];
  const worried = ['face/lamp/ally/worried', 'talk/lamp/ally/worried'];
  // The face on stage holds its face file and its talk file (SH7 draws talk; SH4 draws no talk sprite).
  expect(liveIn(h, smile)).toEqual([true, true]);
  expect(h.live('bg').filter((x) => x.tex?.url.includes('/talk_') === true)).toEqual([]);
  const swap = track(h.ex.apply([face('ally', 'worried')], NOW));
  await flush();
  advance(100);
  await flush();
  // K7 mid-way: the old group still shows, and the old files are still held beside the new ones.
  expect(swap.done).toBe(false);
  expect(liveIn(h, [...smile, ...worried])).toEqual([true, true, true, true]);
  advance(150);
  await flush();
  expect(swap.done).toBe(true);
  // After the K7 phases only the new expression's files are held; the old ones were released once each.
  expect(liveIn(h, [...smile, ...worried])).toEqual([false, false, true, true]);
  expect(smile.map((id) => h.releasedOf(id))).toEqual([1, 1]);
  // Back to the rest: the face file goes, the rest's talk file is held in its place.
  await h.ex.apply([face('ally', 'neutral')], { instant: true });
  expect(liveIn(h, [...worried, 'talk/lamp/ally/neutral'])).toEqual([false, false, true]);
  h.ex.destroy();
  expect(h.registry.stats().live).toBe(0);
});

test('executor: a talk file is taken without being awaited', async () => {
  const h = shotHarness();
  const go = h.deferLoad('talk/lamp/ally/smile');
  const b = track(h.ex.apply([scene('lamp', 'cut'), face('ally', 'smile')], NOW));
  await flush();
  // The batch finished with its talk file still loading: it was requested, never awaited.
  expect(b.done).toBe(true);
  expect(h.loadsOf('talk/lamp/ally/smile')).toBe(1);
  expect(partNodes(h)).toEqual(['face:ally']);
  expect(h.skipped).toEqual([]);
  // Settling later draws nothing and holds it for the stage.
  go();
  await flush();
  expect(liveIn(h, ['talk/lamp/ally/smile'])).toEqual([true]);
  expect(h.live('bg').filter((x) => x.tex?.url.includes('/talk_') === true)).toEqual([]);
  h.ex.destroy();
  expect(h.registry.stats().live).toBe(0);
});

test('executor: a figure plane and a drawn face keep their sprites in their own groups', async () => {
  // Triage r3 F1: a figured member whose face is drawn. The figure plane and the face's hair locks are both cut from
  // the `sheet` slot; the plane lives only in its own group, under its member's face, and the expression group holds
  // only that expression's layer and the member's hair locks (RULINGS 273 O2).
  const at: Box4 = [100, 700, 400, 392];
  const figured = (shot: string, c: string, head: Box4): CastRig & { char: CharId } => ({ ...castMember(shot, c, head), figure: mem(`sheet/${shot}`, [0, 120, 400, 392], at) });
  const rigs: ReadonlyMap<BgId, ShotRig> = new Map([['lamp' as BgId, shotRig([figured('lamp', 'ally', ALLY_AT)])]]);
  const h = harness(S390, quietLoop(), { rigs: () => rigs, half: () => false });
  await h.ex.apply([scene('lamp', 'cut'), face('ally', 'smile')], NOW);
  expect(drawLog(h)).toEqual(['anchor:bg:bg/lamp', 'create:bg:lamp', 'node:figure:ally', 'create:bg:sheet/lamp', 'node:face:ally', 'create:bg:face/lamp/ally/smile', 'create:bg:sheet/lamp']);
  const parts = h.liveNodes().filter((x) => x.role === 'node');
  expect(parts.map((x) => [x.key, h.drawOrder(x).map((s) => s.tex?.url)])).toEqual([
    ['figure:ally', ['/assets/sheet_lamp.avif#0,120,400,392']],
    ['face:ally', ['/assets/face_lamp_ally_smile.avif#0,40,160,200', '/assets/sheet_lamp.avif#0,0,200,120']],
  ]);
  // The figure plane draws under its member's face.
  expect(parts.map((x) => [x.key, x.p.z])).toEqual([
    ['figure:ally', 1],
    ['face:ally', 2],
  ]);
  h.ex.destroy();
  expect(h.liveNodes().map((x) => `${x.role}:${x.key}`)).toEqual([]);
  expect(h.registry.stats().live).toBe(0);
});

test('executor: members draw back to front across members', async () => {
  // Triage r4 M4b: a shot's cast is listed back to front, and every member's parts are siblings in the root's content,
  // so the member term of the z alone keeps the back member's face under the front member's figure plane, and a back
  // member's new expression group under the front member's face after a swap (a z tie falls back to creation order).
  const at: Box4 = [100, 700, 400, 392];
  const figured = (shot: string, c: string, head: Box4): CastRig & { char: CharId } => ({ ...castMember(shot, c, head), figure: mem(`sheet/${shot}`, [0, 120, 400, 392], at) });
  const rigs: ReadonlyMap<BgId, ShotRig> = new Map([['lamp' as BgId, shotRig([figured('lamp', 'ally', ALLY_AT), figured('lamp', 'stranger', [700, 500, 160, 200])])]]);
  const h = harness(S390, quietLoop(), { rigs: () => rigs, half: () => false });
  await h.ex.apply([scene('lamp', 'cut'), face('ally', 'smile'), face('stranger', 'smile')], NOW);
  const parts = h.liveNodes().filter((x) => x.role === 'node');
  expect(parts.map((x) => [x.key, x.p.z])).toEqual([
    ['figure:ally', 1],
    ['face:ally', 2],
    ['figure:stranger', 3],
    ['face:stranger', 4],
  ]);
  // What draws: the root's content in z order.
  const [root] = h.anchors('bg');
  expect(root === undefined ? [] : h.drawOrder(h.contentOf(root)).map((x) => `${x.role}:${x.key}`)).toEqual([
    'sprite:lamp',
    'node:figure:ally',
    'node:face:ally',
    'node:figure:stranger',
    'node:face:stranger',
  ]);
  h.ex.destroy();
  expect(h.liveNodes()).toEqual([]);
  expect(h.registry.stats().live).toBe(0);
  // The back member swaps its face (K7): its new group is created last and still draws under the front member's face.
  const s = shotHarness();
  await s.ex.apply([scene('lamp', 'cut'), face('ally', 'smile'), face('stranger', 'smile')], NOW);
  const swap = track(s.ex.apply([face('ally', 'worried')], NOW));
  await flush();
  advance(250);
  await flush();
  expect(swap.done).toBe(true);
  const [kept] = s.anchors('bg');
  expect(kept === undefined ? [] : s.drawOrder(s.contentOf(kept)).map((x) => `${x.role}:${x.key}`)).toEqual([
    'sprite:lamp',
    'node:face:ally',
    'node:face:stranger',
  ]);
  s.ex.destroy();
  expect(s.liveNodes()).toEqual([]);
  expect(s.registry.stats().live).toBe(0);
});

test('executor: a rebind re-creates a shot root and its drawn face from the cached frames', async () => {
  // Cut §2.3, pre-merge V-L (RULINGS 289): after a rebuild the root comes back with its rig and its faces (not the
  // legacy cover placement), every part on the same texture objects its records keep; no load, no release.
  const h = shotHarness();
  await h.ex.apply([scene('lamp', 'cut'), face('ally', 'smile')], NOW);
  const files = ['bg/lamp', 'sheet/lamp', 'face/lamp/ally/smile'];
  const before = h.live('bg');
  const beforeTex = before.map((x) => x.tex);
  const beforeBox = before.map(h.worldBox);
  const loads = files.map(h.loadsOf);
  const fresh = recordingStage(S390, h.freed);
  h.ex.rebind(fresh.adapter);
  const after = fresh.live('bg');
  expect(after.map((x) => x.key)).toEqual(['lamp', 'face/lamp/ally/smile', 'sheet/lamp']);
  // The very same texture objects: the plate's record texture and the two cached frames (no new cut, no load).
  after.forEach((x, i) => expect(x.tex).toBe(beforeTex[i]));
  expect(after.map(fresh.worldBox)).toEqual(beforeBox);
  expect(after.map(fresh.worldAlpha)).toEqual([1, 1, 1]);
  const f = restFraming(LAMP_RIG, S390, 2, false);
  expect(one(fresh.anchors('bg')).p).toMatchObject({ x: f.x, y: f.y, scale: f.k, alpha: 1 });
  expect(fresh.liveNodes().filter((x) => x.role === 'node').map((x) => [x.key, x.p.z])).toEqual([['face:ally', 2]]);
  expect(files.map(h.loadsOf)).toEqual(loads);
  expect(files.map(h.releasedOf)).toEqual([0, 0, 0]);
  // From now on the new stage is driven: a face back to its rest drops the group there.
  await h.ex.apply([face('ally', 'neutral')], { instant: true });
  expect(fresh.liveNodes().filter((x) => x.role === 'node')).toEqual([]);
  h.ex.destroy();
  expect(fresh.liveNodes()).toEqual([]);
  expect(h.registry.stats().live).toBe(0);
});

for (const id of ['face/lamp/ally/smile', 'sheet/lamp', 'bg/lamp']) {
  test(`executor: a reacquire after a failed revive of ${id} redraws the shot's face on a new record`, async () => {
    // Cut §2.3, pre-merge V-L (RULINGS 289): a part over an ended record leaves the root at once (no sprite over a
    // freed texture) and is drawn again on the re-taken record; only the ended file loads again.
    const files = ['face/lamp/ally/smile', 'sheet/lamp', 'bg/lamp'];
    const h = shotHarness();
    await h.ex.apply([scene('lamp', 'cut'), face('ally', 'smile')], NOW);
    await failOnRevive(h, id);
    h.ex.reacquire();
    expect(h.live('bg').filter((x) => x.tex !== null && h.freed.has(x.tex)).map((x) => x.key)).toEqual([]);
    await flush();
    expect(h.live('bg').map((x) => x.key)).toEqual(['lamp', 'face/lamp/ally/smile', 'sheet/lamp']);
    expect(h.live('bg').filter((x) => x.tex !== null && h.freed.has(x.tex)).map((x) => x.key)).toEqual([]);
    expect(partNodes(h)).toEqual(['face:ally']);
    expect(h.loadsOf(id)).toBe(2);
    for (const other of files.filter((x) => x !== id)) {
      expect(h.loadsOf(other), other).toBe(1);
    }
    h.ex.destroy();
    expect(h.liveNodes()).toEqual([]);
    expect(h.registry.stats().live).toBe(0);
  });
}

// ---------------------------------------------------------------------------------------------------------------
// The swap point (shots §5.8, lane SH5a D9): a batch with a window reports it once, after the sweep that releases the
// old shot's holders: at black for a dip, when the old root retires for a crossfade, right after the build otherwise,
// and at its end when it settles first. A sweep that releases a holder outside a swap point reports the release.

const STREET: StageWindow = { need: [asId('bg/street')], warm: [], near: 0, hope: [asId('bg/room')], eventRoom: [] };
const ROOM: StageWindow = { need: [asId('bg/room')], warm: [], near: 0, hope: [], eventRoom: [] };

/** A harness whose seat logs each report with the release count of `old`'s texture at that moment. */
function seated(old = 'bg/cafe'): ReturnType<typeof harness> & { readonly reports: string[] } {
  const reports: string[] = [];
  const h = harness(S390, quietLoop(), undefined, {
    swapped: (w) => reports.push(`swapped ${w.need.join(',')}: ${old} released ${h.releasedOf(old)}`),
    released: () => reports.push(`released: ${old} released ${h.releasedOf(old)}`),
  });
  return Object.assign(h, { reports });
}

test("executor: a cut reports its swap after the old shot's holders are released", async () => {
  const h = seated();
  await h.ex.apply([bg('cafe', 'cut')], NOW);
  expect(h.reports).toEqual([]);
  await h.ex.apply([bg('street', 'cut')], { instant: false, window: STREET });
  // Once, after the sweep that let the old plate go; that release is the swap's own, so no `released` beside it.
  expect(h.reports).toEqual(['swapped bg/street: bg/cafe released 1']);
  h.ex.destroy();
  expect(h.reports).toEqual(['swapped bg/street: bg/cafe released 1']);
});

test('executor: a dip reports its swap at black', async () => {
  const h = seated();
  await h.ex.apply([bg('cafe', 'cut')], NOW);
  const dip = h.ex.apply([scene('street', 'fade', 800)], { instant: false, window: STREET });
  await flush();
  advance(350);
  expect(h.reports).toEqual([]);
  advance(100);
  expect(h.reports).toEqual(['swapped bg/street: bg/cafe released 1']);
  advance(500);
  await dip;
  // `bg t=fade` dips the same way.
  h.reports.length = 0;
  const fade = h.ex.apply([bg('room', 'fade', 600)], { instant: false, window: ROOM });
  await flush();
  advance(250);
  expect(h.reports).toEqual([]);
  advance(100);
  expect(h.reports).toEqual(['swapped bg/room: bg/cafe released 1']);
  h.ex.complete();
  await fade;
  expect(h.reports).toEqual(['swapped bg/room: bg/cafe released 1']);
  expect(h.releasedOf('bg/street')).toBe(1);
  h.ex.destroy();
});

test('executor: a crossfade reports its swap once the old shot retires', async () => {
  const h = seated();
  await h.ex.apply([bg('cafe', 'cut')], NOW);
  const fade = h.ex.apply([bg('street', 'crossfade', 500)], { instant: false, window: STREET });
  await flush();
  advance(250);
  // The old plate still shows under the new one: no swap yet.
  expect(h.reports).toEqual([]);
  advance(300);
  await fade;
  expect(h.reports).toEqual(['swapped bg/street: bg/cafe released 1']);
  // A tap retires the old root at once, and the swap is reported with it.
  h.reports.length = 0;
  const tapped = h.ex.apply([bg('room', 'crossfade', 500)], { instant: false, window: ROOM });
  await flush();
  expect(h.reports).toEqual([]);
  h.ex.complete();
  await tapped;
  expect(h.reports).toEqual(['swapped bg/room: bg/cafe released 1']);
  expect(h.releasedOf('bg/street')).toBe(1);
  h.ex.destroy();
});

test('executor: restore awaits the CG and not the shot under it', async () => {
  const h = harness();
  const plate = h.deferLoad('bg/room');
  const saved = {
    bg: 'room' as BgId,
    cg: 'letter' as CgId,
    chars: [{ char: 'ally' as CharId, expr: 'neutral' as ExprId, at: 'right' as const }],
    props: [],
  };
  const restored = track(h.ex.restore(saved));
  await flush();
  // The CG covers the stage: the restore is done once it shows, while the covered plate still loads.
  expect(restored.done).toBe(true);
  expect(h.live('cg').map((x) => x.key)).toEqual(['letter']);
  expect(h.live('bg')).toEqual([]);
  expect(h.ex.snapshot()).toEqual(saved);
  // The covered slots were taken with the restore, and they draw under the CG once the plate lands.
  expect(h.loadsOf('bg/room')).toBe(1);
  expect(h.loadsOf('char/ally/neutral')).toBe(1);
  plate();
  await flush();
  expect(h.live('bg').map((x) => x.key)).toEqual(['room']);
  expect(h.inGroup('ally').length).toBe(1);
  expect(h.live('cg').map((x) => x.key)).toEqual(['letter']);
  expect(h.loadsOf('bg/room')).toBe(1);
  expect(h.ex.stats().activeTimelines).toBe(0);
  h.ex.destroy();
  expect(h.registry.stats().live).toBe(0);
});

test('executor: a batch without a window reports no swap', async () => {
  const h = seated();
  await h.ex.apply([bg('cafe', 'cut')], NOW);
  const fade = h.ex.apply([bg('street', 'crossfade', 500)], NOW);
  await flush();
  h.ex.complete();
  await fade;
  await h.ex.apply([scene('room', 'fade', 800)], { instant: true });
  await h.ex.restore({ bg: 'cafe' as BgId, cg: null, chars: [], props: [] });
  expect(h.reports.filter((r) => r.startsWith('swapped'))).toEqual([]);
  h.ex.destroy();
});

test('executor: destroy settles a windowed batch and reports no swap', async () => {
  // Carry S4 (IMPL-2): the controller destroys the scheduler right after the executor, so a window reported at
  // destroy() would plan loads that are aborted a moment later; the batch settles and its window is dropped.
  const h = seated();
  await h.ex.apply([bg('cafe', 'cut')], NOW);
  const fade = track(h.ex.apply([bg('street', 'crossfade', 500)], { instant: false, window: STREET }));
  await flush();
  advance(250);
  expect(h.reports).toEqual([]);
  h.ex.destroy();
  await flush();
  expect(fade.done).toBe(true);
  expect(h.reports).toEqual([]);
});

test('executor: a batch that fails to build still reports its swap at its end', async () => {
  const h = seated();
  const errors = spyErrors();
  const sprite = h.adapter.sprite.bind(h.adapter);
  let thrown = false;
  h.adapter.sprite = (layer, tex, g) => {
    if (!thrown) {
      thrown = true;
      throw new Error('stage: a bug in a build');
    }
    return sprite(layer, tex, g);
  };
  const applied = track(h.ex.apply([bg('cafe', 'crossfade', 500)], { instant: false, window: STREET }));
  await flush();
  errors.restore();
  expect(errors.errors.map((e) => e[0])).toEqual(['scene: batch failed']);
  expect(applied.done).toBe(true);
  expect(h.reports).toEqual(['swapped bg/street: bg/cafe released 0']);
  h.ex.destroy();
});

test('executor: a sweep that releases a holder reports it', async () => {
  const h = seated();
  await h.ex.apply([bg('cafe', 'cut')], NOW);
  // A batch's end that releases nothing reports nothing.
  await h.ex.apply([bg('cafe', 'cut')], NOW);
  expect(h.reports).toEqual([]);
  // A crossfade with no window: the old plate's holder goes at the batch's end, and the release is reported once.
  const fade = h.ex.apply([bg('street', 'crossfade', 500)], NOW);
  await flush();
  advance(550);
  await fade;
  expect(h.reports).toEqual(['released: bg/cafe released 1']);
  h.ex.destroy();
  expect(h.reports).toEqual(['released: bg/cafe released 1']);
});

// ---------------------------------------------------------------------------------------------------------------
// The exact dissolve between shots (docs/plans/shots §5.5, S14; lane SH6 D2, D8): one render of the stage into a
// target reserved in the transient band, the old shot gone and its holders released at once, the new shot built
// opaque under the target, which fades out and is dropped at the fade's end, at complete(), at a rebind or a revive
// of another generation, and at destroy(). A stage with no target member, a refused reservation or a closed render
// gate fall back to the new root over the old (counted in `flatRefused`).

/** A shot harness whose stage draws targets (or refuses them), with the seat's reports when given. */
const flatHarness = (targets: 'draw' | 'refuse' = 'draw', seat?: Pick<ExecutorDeps<Tex>, 'swapped' | 'released'>): ReturnType<typeof harness> =>
  harness(S390, quietLoop(), { rigs: () => LAMP_RIGS, half: () => false }, seat, targets);
/** The stage's draw log with the targets made and dropped. */
const flatLog = (h: ReturnType<typeof harness>): string[] => h.log.filter((x) => /^(anchor|node|create|destroy|drop|flatten|dropTarget):/.test(x));
const drops = (h: ReturnType<typeof harness>): string[] => h.log.filter((x) => x.startsWith('dropTarget:'));
const NO_RESERVATION = { reservations: 0, reservedBytes: 0 };
/** The phone snapshot: 390 x 844 at r 2 (flatten.ts snapshotPlan). */
const SNAPSHOT_BYTES = 780 * 1688 * 4;
const CU: StageWindow = { need: [asId('bg/lamp_cu')], warm: [], near: 0, hope: [], eventRoom: [] };

test("executor: a dissolve draws the old shot's snapshot over the new shot and drops it", async () => {
  const h = flatHarness();
  await h.ex.apply([scene('lamp', 'cut'), face('ally', 'smile')], NOW);
  h.log.length = 0;
  h.alphas.length = 0;
  const d = track(h.ex.apply([bg('lamp_cu', 'crossfade', 500)], NOW));
  await flush();
  // One render of the whole stage in device px, shown above the world; then the old root goes and the new one is
  // built opaque under it, with the faces the bg keeps.
  expect(flatLog(h)).toEqual([
    'flatten:screen:780x1688',
    'destroy:bg:face/lamp/ally/smile',
    'destroy:bg:sheet/lamp',
    'drop:face:ally',
    'destroy:bg:lamp',
    'drop:bg/lamp',
    'anchor:bg:bg/lamp_cu',
    'create:bg:lamp_cu',
    'node:face:ally',
    'create:bg:face/lamp_cu/ally/smile',
    'create:bg:sheet/lamp_cu',
  ]);
  expect(h.plans).toEqual([{ w: 780, h: 1688, bytes: SNAPSHOT_BYTES, scale: 2, origin: { x: 0, y: 0 } }]);
  expect(h.anchors('bg').map((x) => [x.key, x.p.alpha])).toEqual([['bg/lamp_cu', 1]]);
  const [flat] = h.flats();
  expect([flat?.key, flat?.layer, flat?.parent]).toEqual(['screen', 'flat', null]);
  // The snapshot fades out over the new shot, its bytes reserved in the band while it shows.
  advance(250);
  expect(flat?.p.alpha).toBeGreaterThan(0.4);
  expect(flat?.p.alpha).toBeLessThan(0.6);
  expect(h.registry.reserveStats()).toEqual({ reservations: 1, reservedBytes: SNAPSHOT_BYTES });
  expect(drops(h)).toEqual([]);
  advance(300);
  await flush();
  expect(d.done).toBe(true);
  expect(drops(h)).toEqual(['dropTarget:screen']);
  expect(h.flats()).toEqual([]);
  expect(h.registry.reserveStats()).toEqual(NO_RESERVATION);
  expect(h.ex.stats()).toEqual({ activeTimelines: 0, flatRefused: 0 });
  h.ex.destroy();
  expect(h.liveNodes()).toEqual([]);
});

test("executor: a dissolve releases the old shot's records right after the snapshot render", async () => {
  const h = flatHarness();
  await h.ex.apply([scene('lamp', 'cut'), face('ally', 'smile')], NOW);
  const d = track(h.ex.apply([bg('lamp_cu', 'crossfade', 500)], NOW));
  await flush();
  // No time has passed and no window asked for it: the target holds the old shot's pixels, so its plate, sheet, face
  // and talk files are released now; the new shot's are live.
  expect(d.done).toBe(false);
  expect(['bg/lamp', 'sheet/lamp', 'face/lamp/ally/smile', 'talk/lamp/ally/smile'].map(h.releasedOf)).toEqual([1, 1, 1, 1]);
  expect(liveIn(h, ['bg/lamp_cu', 'sheet/lamp_cu', 'face/lamp_cu/ally/smile', 'talk/lamp_cu/ally/smile'])).toEqual([true, true, true, true]);
  h.ex.complete();
  await flush();
  expect(d.done).toBe(true);
  h.ex.destroy();
  expect(h.registry.stats().live).toBe(0);
});

test('executor: a dissolve reports its swap right after the snapshot render', async () => {
  // A1 (S6): the swap point of the exact dissolve is the snapshot, not the old root's retirement (the legacy
  // crossfade's pin keeps that one); the target's end is no second swap.
  const reports: string[] = [];
  const h = flatHarness('draw', {
    swapped: (w) => reports.push(`swapped ${w.need.join(',')}: bg/lamp released ${h.releasedOf('bg/lamp')}`),
  });
  await h.ex.apply([scene('lamp', 'cut')], NOW);
  const d = h.ex.apply([bg('lamp_cu', 'crossfade', 500)], { instant: false, window: CU });
  await flush();
  expect(reports).toEqual(['swapped bg/lamp_cu: bg/lamp released 1']);
  advance(550);
  await d;
  expect(reports).toEqual(['swapped bg/lamp_cu: bg/lamp released 1']);
  h.ex.destroy();
});

test("executor: a dissolve's end asks the scheduler to retry", async () => {
  // T6: the target's bytes come back at its drop, so a preload refused while it showed may now be admitted.
  let retries = 0;
  const h = flatHarness('draw', {
    released: () => {
      retries += 1;
    },
  });
  await h.ex.apply([scene('lamp', 'cut')], NOW);
  // Windowed: the swap's own release is the window's report, not a retry.
  const d = h.ex.apply([bg('lamp_cu', 'crossfade', 500)], { instant: false, window: CU });
  await flush();
  advance(250);
  expect(retries).toBe(0);
  advance(300);
  await d;
  expect(drops(h)).toEqual(['dropTarget:screen']);
  expect(retries).toBe(1);
  h.ex.destroy();
});

test('executor: a tap completes a dissolve and frees its target', async () => {
  const h = flatHarness();
  await h.ex.apply([scene('lamp', 'cut'), face('ally', 'smile')], NOW);
  const d = track(h.ex.apply([bg('lamp_cu', 'crossfade', 500)], NOW));
  await flush();
  advance(100);
  expect(h.flats()).toHaveLength(1);
  h.ex.complete();
  await flush();
  expect(d.done).toBe(true);
  expect(drops(h)).toEqual(['dropTarget:screen']);
  expect(h.flats()).toEqual([]);
  expect(h.registry.reserveStats()).toEqual(NO_RESERVATION);
  expect(h.ex.stats().activeTimelines).toBe(0);
  // Dropped exactly once: a second tap and the next batch drop nothing (the stage throws on a second drop).
  h.ex.complete();
  await h.ex.apply([face('ally', 'neutral')], { instant: true });
  expect(drops(h)).toEqual(['dropTarget:screen']);
  h.ex.destroy();
  expect(h.liveNodes()).toEqual([]);
});

test('executor: a refused target dissolves by container alpha and counts flatRefused', async () => {
  // CH D15: the render gate refuses (the stage answers null), the band refuses the reservation, or the stage draws no
  // target: today's crossfade, the new root over the old, which retires whole; no reservation is left.
  const arms: ReadonlyArray<readonly [string, () => ReturnType<typeof harness>]> = [
    ['a closed render gate', () => flatHarness('refuse')],
    ['a full band', () => flatHarness('draw')],
    ['no target member', () => shotHarness()],
  ];
  for (const [arm, make] of arms) {
    const h = make();
    await h.ex.apply([scene('lamp', 'cut'), face('ally', 'smile')], NOW);
    const band = arm === 'a full band' ? h.registry.reserve('test', TRANSIENT_CAP_BYTES) : null;
    h.log.length = 0;
    const d = track(h.ex.apply([bg('lamp_cu', 'crossfade', 300)], NOW));
    await flush();
    advance(150);
    expect(h.anchors('bg').map((x) => x.key), arm).toEqual(['bg/lamp', 'bg/lamp_cu']);
    expect(h.flats(), arm).toEqual([]);
    expect(h.registry.reserveStats(), arm).toEqual(band?.ok === true ? { reservations: 1, reservedBytes: TRANSIENT_CAP_BYTES } : NO_RESERVATION);
    advance(200);
    await flush();
    expect(d.done, arm).toBe(true);
    expect(h.anchors('bg').map((x) => x.key), arm).toEqual(['bg/lamp_cu']);
    expect(h.log.filter((x) => x.startsWith('flatten:')), arm).toEqual(arm === 'a closed render gate' ? ['flatten:refused'] : []);
    expect(h.ex.stats(), arm).toEqual({ activeTimelines: 0, flatRefused: 1 });
    if (band?.ok === true) {
      h.registry.unreserve(band.value);
    }
    expect(h.registry.reserveStats(), arm).toEqual(NO_RESERVATION);
    h.ex.destroy();
    expect(h.liveNodes(), arm).toEqual([]);
  }
});

test('executor: a crossfade onto the shot on stage fades only the props and reserves no target', async () => {
  // D16 (a guard): the take batch (yields.ts stateBatch: the room's bg again, crossfade, and the new props) keeps the
  // shot and crossfades its props; no target, no reservation, nothing counted.
  const h = flatHarness();
  await h.ex.apply([scene('lamp', 'cut'), props(['lamp', LAMP])], NOW);
  const root = one(h.anchors('bg'));
  h.log.length = 0;
  h.alphas.length = 0;
  const take = track(h.ex.apply([bg('lamp', 'crossfade', 500), props(['key', KEY])], NOW));
  await flush();
  advance(250);
  expect(h.registry.reserveStats()).toEqual(NO_RESERVATION);
  expect(h.anchors('bg')).toEqual([root]);
  const mid = h.anchors('props').map((x) => x.p.alpha ?? 1);
  expect(mid).toHaveLength(2);
  for (const a of mid) {
    expect(a).toBeGreaterThan(0.4);
    expect(a).toBeLessThan(0.6);
  }
  advance(300);
  await flush();
  expect(take.done).toBe(true);
  expect(h.log.filter((x) => /^(flatten|dropTarget|anchor:bg|drop:bg)/.test(x))).toEqual([]);
  expect(h.alphas.filter((w) => w.role === 'anchor' && w.key === 'bg/lamp')).toEqual([]);
  expect(h.anchors('props').map((x) => x.key)).toEqual(['key']);
  expect(h.ex.stats().activeTimelines).toBe(0);
  h.ex.destroy();
});

test('executor: a rebind mid-dissolve drops the target through the old adapter', async () => {
  // D8: rebind's complete() ends the dissolve on the old stage, so its target is dropped there before the new adapter
  // takes over; the old Application's destroy then meets no live target.
  const h = flatHarness();
  await h.ex.apply([scene('lamp', 'cut'), face('ally', 'smile')], NOW);
  const d = track(h.ex.apply([bg('lamp_cu', 'crossfade', 500)], NOW));
  await flush();
  advance(100);
  const fresh = recordingStage(S390, h.freed, 'draw');
  h.ex.rebind(fresh.adapter);
  await flush();
  expect(d.done).toBe(true);
  expect(drops(h)).toEqual(['dropTarget:screen']);
  expect(h.flats()).toEqual([]);
  expect(fresh.log.filter((x) => /^(flatten|dropTarget):/.test(x))).toEqual([]);
  expect(fresh.anchors('bg').map((x) => x.key)).toEqual(['bg/lamp_cu']);
  expect(h.registry.reserveStats()).toEqual(NO_RESERVATION);
  h.ex.destroy();
  expect(fresh.liveNodes()).toEqual([]);
});

test('executor: destroy mid-dissolve drops its target once', async () => {
  // C4 and review O4: destroy() drops the target with the rest of the stage, and reports no release (the scheduler is
  // destroyed right after, as S4 rules for the swap).
  let retries = 0;
  const h = flatHarness('draw', {
    released: () => {
      retries += 1;
    },
  });
  await h.ex.apply([scene('lamp', 'cut'), face('ally', 'smile')], NOW);
  const d = track(h.ex.apply([bg('lamp_cu', 'crossfade', 500)], NOW));
  await flush();
  advance(100);
  const before = retries;
  h.ex.destroy();
  await flush();
  expect(d.done).toBe(true);
  expect(drops(h)).toEqual(['dropTarget:screen']);
  expect(retries).toBe(before);
  expect(h.registry.reserveStats()).toEqual(NO_RESERVATION);
  expect(h.liveNodes()).toEqual([]);
  h.ex.destroy();
  expect(drops(h)).toEqual(['dropTarget:screen']);
});

test('executor: a revive mid-dissolve completes it and drops the target', async () => {
  // Shots §5.5 "Context loss mid-dissolve": a target rendered under an older GPU generation lost its pixels, so the
  // reacquire after the revive ends its batch; review O3: one rendered under the current generation stays.
  const h = flatHarness();
  await h.ex.apply([scene('lamp', 'cut'), face('ally', 'smile')], NOW);
  const d = track(h.ex.apply([bg('lamp_cu', 'crossfade', 500)], NOW));
  await flush();
  advance(100);
  h.setGen(2);
  h.ex.reacquire();
  await flush();
  expect(d.done).toBe(true);
  expect(drops(h)).toEqual(['dropTarget:screen']);
  expect(h.registry.reserveStats()).toEqual(NO_RESERVATION);
  const e = track(h.ex.apply([bg('lamp', 'crossfade', 500)], NOW));
  await flush();
  advance(100);
  h.ex.reacquire();
  await flush();
  expect(e.done).toBe(false);
  expect(h.flats()).toHaveLength(1);
  expect(drops(h)).toEqual(['dropTarget:screen']);
  advance(450);
  await flush();
  expect(e.done).toBe(true);
  expect(drops(h)).toEqual(['dropTarget:screen', 'dropTarget:screen']);
  h.ex.destroy();
  expect(h.liveNodes()).toEqual([]);
});

// ---------------------------------------------------------------------------------------------------------------
// The exact face patch (docs/plans/shots §5.5, S15; lane SH6 D9, review O1): a timed face change on a shot root renders
// the union of its old and new groups' boxes at the after-state into a target in the root's content, which fades in
// over the before-state; a refused one is K7. And the E1 lifetime (B2): a face change takes a failed sheet again, once
// per entry of the shot; every other slot keeps its failed take.

/** The lamp rig with ally's worried layer moved right and down: its group's box is not the smile group's. */
const MOVED_RIG = shotRig([castMember('lamp', 'ally', ALLY_AT, { worried: [260, 600, 160, 200] }), castMember('lamp', 'stranger', [700, 500, 160, 200])]);
const MOVED: { rigs(): ReadonlyMap<BgId, ShotRig>; half(): boolean } = { rigs: () => new Map([['lamp' as BgId, MOVED_RIG]]), half: () => false };
const faceNodes = (h: ReturnType<typeof harness>): Node[] => h.liveNodes().filter((x) => x.role === 'node' && x.key.startsWith('face:'));
const faceAlphas = (h: ReturnType<typeof harness>): string[] => faceNodes(h).map((x) => `${x.key}@${x.p.alpha}`);
/** What each target render sees: the face groups as `key@alpha`, in creation order. */
function rendersOf(h: ReturnType<typeof harness>): string[][] {
  const seen: string[][] = [];
  const draw = h.adapter.flatten;
  h.adapter.flatten = (plan, place) => {
    seen.push(faceAlphas(h));
    return draw?.(plan, place) ?? null;
  };
  return seen;
}

test('executor: a face change patches only the union of the old and new expression layer boxes', async () => {
  // D9: ally's smile group covers plate (200, 460) 200 x 260 (its layer and the hair lock above it), the worried one
  // (200, 460) 220 x 340 (its layer moved): the patch is their union, device (101, 365) 188 x 289 at the lamp's rest
  // framing on a phone at r 2, and the stranger's face is not in it.
  const h = harness(S390, quietLoop(), MOVED, undefined, 'draw');
  await h.ex.apply([scene('lamp', 'cut'), face('ally', 'smile'), face('stranger', 'smile')], NOW);
  const seen = rendersOf(h);
  h.log.length = 0;
  const one = track(h.ex.apply([face('ally', 'worried')], NOW));
  await flush();
  expect(flatLog(h)).toEqual(['node:face:ally', 'create:bg:face/lamp/ally/worried', 'create:bg:sheet/lamp', 'flatten:patch:bg/lamp:188x289']);
  expect(h.plans).toEqual([{ w: 188, h: 289, bytes: 217_328, scale: 2, origin: { x: 50.5, y: 182.5 } }]);
  // Rendered at the after-state: the old group hidden, the new one shown.
  expect(seen).toEqual([['face:ally@0', 'face:stranger@1', 'face:ally@1']]);
  // Shown in the root's content above both members' parts (z 2 x 2 + 1), at the snapped edge in plate px, one target
  // px per device px; under it the before-state.
  const f = restFraming(MOVED_RIG, S390, 2, false);
  const [patch] = h.flats();
  expect([patch?.key, patch?.p.z, patch?.p.alpha]).toEqual(['patch:bg/lamp', 5, 0]);
  expect(patch?.p.x).toBeCloseTo((50.5 - f.x) / f.k, 9);
  expect(patch?.p.y).toBeCloseTo((182.5 - f.y) / f.k, 9);
  expect(patch?.p.scale).toBeCloseTo(1 / (2 * f.k), 12);
  expect(faceAlphas(h)).toEqual(['face:ally@1', 'face:stranger@1', 'face:ally@0']);
  // The patch fades in over the face's 200 ms, its bytes reserved in the band while it shows.
  advance(100);
  expect(patch?.p.alpha).toBeGreaterThan(0.4);
  expect(patch?.p.alpha).toBeLessThan(0.6);
  expect(faceAlphas(h)).toEqual(['face:ally@1', 'face:stranger@1', 'face:ally@0']);
  expect(h.registry.reserveStats()).toEqual({ reservations: 1, reservedBytes: 217_328 });
  advance(150);
  await flush();
  // At its end the new group shows, the old one goes and the target is dropped.
  expect(one.done).toBe(true);
  expect(flatLog(h).slice(4)).toEqual(['destroy:bg:face/lamp/ally/smile', 'destroy:bg:sheet/lamp', 'drop:face:ally', 'dropTarget:patch:bg/lamp']);
  expect(faceAlphas(h)).toEqual(['face:stranger@1', 'face:ally@1']);
  expect(h.registry.reserveStats()).toEqual(NO_RESERVATION);
  expect(h.ex.stats()).toEqual({ activeTimelines: 0, flatRefused: 0 });

  // Review O1: two faces in one batch, one back to its rest. Both renders see both faces at their after-state, so
  // neither patch keeps the other's before-state where they would overlap; a tap ends both.
  seen.length = 0;
  h.log.length = 0;
  const two = track(h.ex.apply([face('ally', 'smile'), face('stranger', 'neutral')], NOW));
  await flush();
  expect(h.log.filter((x) => x.startsWith('flatten:'))).toEqual(['flatten:patch:bg/lamp:188x289', 'flatten:patch:bg/lamp:171x221']);
  expect(seen).toEqual([
    ['face:stranger@0', 'face:ally@0', 'face:ally@1'],
    ['face:stranger@0', 'face:ally@0', 'face:ally@1'],
  ]);
  expect(faceAlphas(h)).toEqual(['face:stranger@1', 'face:ally@1', 'face:ally@0']);
  advance(50);
  h.ex.complete();
  await flush();
  expect(two.done).toBe(true);
  expect(drops(h)).toEqual(['dropTarget:patch:bg/lamp', 'dropTarget:patch:bg/lamp']);
  expect(h.flats()).toEqual([]);
  expect(faceAlphas(h)).toEqual(['face:ally@1']);
  expect(h.registry.reserveStats()).toEqual(NO_RESERVATION);
  h.ex.destroy();
  expect(h.liveNodes()).toEqual([]);
});

test('executor: a refused patch falls back to the expression crossfade and counts flatRefused', async () => {
  // CH D15: the render gate refuses (the stage answers null), the band refuses the reservation, or the stage draws no
  // target: K7 for that face, the new group over the old one, which retires whole; no target, no reservation left.
  const arms: ReadonlyArray<readonly [string, () => ReturnType<typeof harness>]> = [
    ['a closed render gate', () => harness(S390, quietLoop(), MOVED, undefined, 'refuse')],
    ['a full band', () => harness(S390, quietLoop(), MOVED, undefined, 'draw')],
    ['no target member', () => harness(S390, quietLoop(), MOVED)],
  ];
  for (const [arm, make] of arms) {
    const h = make();
    await h.ex.apply([scene('lamp', 'cut'), face('ally', 'smile')], NOW);
    const band = arm === 'a full band' ? h.registry.reserve('test', TRANSIENT_CAP_BYTES) : null;
    h.log.length = 0;
    const p = track(h.ex.apply([face('ally', 'worried')], NOW));
    await flush();
    advance(100);
    const [old, fresh] = faceNodes(h);
    expect(old?.p.alpha, arm).toBe(1);
    expect(fresh?.p.alpha, arm).toBeGreaterThan(0.4);
    expect(fresh?.p.alpha, arm).toBeLessThan(0.6);
    expect(h.flats(), arm).toEqual([]);
    advance(150);
    await flush();
    expect(p.done, arm).toBe(true);
    expect(drawLog(h), arm).toEqual([
      'node:face:ally',
      'create:bg:face/lamp/ally/worried',
      'create:bg:sheet/lamp',
      'destroy:bg:face/lamp/ally/smile',
      'destroy:bg:sheet/lamp',
      'drop:face:ally',
    ]);
    expect(h.log.filter((x) => x.startsWith('flatten:')), arm).toEqual(arm === 'a closed render gate' ? ['flatten:refused'] : []);
    expect(h.ex.stats(), arm).toEqual({ activeTimelines: 0, flatRefused: 1 });
    if (band?.ok === true) {
      h.registry.unreserve(band.value);
    }
    expect(h.registry.reserveStats(), arm).toEqual(NO_RESERVATION);
    h.ex.destroy();
    expect(h.liveNodes(), arm).toEqual([]);
  }
});

test('executor: a sheet take that failed once is taken again at the next face change', async () => {
  // E1 lifetime (B2): the shot's sheet failed at its entry, so its face was drawn at rest; the next face change on the
  // shot takes the sheet again, waits for it and draws the face.
  const h = shotHarness();
  h.failLoad('sheet/lamp');
  await h.ex.apply([scene('lamp', 'cut'), face('ally', 'smile')], NOW);
  expect([h.loadsOf('sheet/lamp'), partNodes(h).length]).toEqual([1, 0]);
  h.mendLoad('sheet/lamp');
  await h.ex.apply([face('ally', 'worried')], { instant: true });
  expect(h.loadsOf('sheet/lamp')).toBe(2);
  expect(partNodes(h)).toEqual(['face:ally']);
  h.ex.destroy();
  expect(h.liveNodes()).toEqual([]);
  expect(h.registry.stats().live).toBe(0);
  // The bound: a retake that fails too is not taken again on the same entry of the shot, whatever the faces do...
  const g = shotHarness();
  g.failLoad('sheet/lamp');
  await g.ex.apply([scene('lamp', 'cut'), face('ally', 'smile')], NOW);
  await g.ex.apply([face('ally', 'worried')], { instant: true });
  await g.ex.apply([face('ally', 'smile'), face('stranger', 'smile')], { instant: true });
  expect(g.loadsOf('sheet/lamp')).toBe(2);
  expect(g.skipped.map((e) => `${e.kind}:${e.id}`)).toEqual(['decode:sheet/lamp', 'decode:sheet/lamp']);
  // ...until the shot is entered again: a restore that sets it, with a face changed, takes it once more.
  await g.ex.restore({ ...g.ex.snapshot(), chars: [{ char: 'ally' as CharId, expr: 'worried' as ExprId, at: 'center' }] });
  expect(g.loadsOf('sheet/lamp')).toBe(3);
  g.ex.destroy();
  expect(g.liveNodes()).toEqual([]);
  // Only what draws a face: the shot's plate keeps its failed take (A9).
  const k = shotHarness();
  k.failLoad('bg/lamp');
  await k.ex.apply([scene('lamp', 'cut'), face('ally', 'smile')], NOW);
  await k.ex.apply([face('ally', 'worried')], { instant: true });
  expect(k.loadsOf('bg/lamp')).toBe(1);
  k.ex.destroy();
  expect(k.registry.stats().live).toBe(0);
});

test('executor: a legacy bg take that failed is not taken again on the next line', async () => {
  // B2 (a guard): a chapter without rigs keeps its skip-once: a failed bg is not fetched again while its id is
  // unchanged, whatever the next lines change.
  const h = harness();
  h.failLoad('bg/cafe');
  await h.ex.apply([scene('cafe', 'cut'), show('ally', 'neutral', 'left', 'cut')], NOW);
  await h.ex.apply([face('ally', 'worried')], { instant: true });
  await h.ex.apply([show('ally', 'neutral', 'right', 'fade', 200), props(['lamp', LAMP])], { instant: true });
  expect(h.loadsOf('bg/cafe')).toBe(1);
  expect(h.skipped.map((e) => `${e.kind}:${e.id}`)).toEqual(['decode:bg/cafe']);
  h.ex.destroy();
  expect(h.registry.stats().live).toBe(0);
});

// ---------------------------------------------------------------------------------------------------------------
// The camera (docs/plans/shots §5.4, S20; lane SH6 Q7, D4, S1): a move tweens the world container's delta from the drawn
// framing to the target's, on the batch's timeline; a scene or a bg puts it back to rest at the cut point; a restore or
// an instant batch sets it at once; a relayout or a rebind frames the held move again for the stage it now has.

const PUSH = { kind: 'push', to: 'ally' as CharId, z: 120 } as const;
/** The world delta `cam` frames on the lamp shot (r 2, the full tier) at `size`. */
const framed = (cam: CamState, size: Size = S390): WorldDelta => worldOf(restFraming(LAMP_RIG, size, 2, false), camFraming(LAMP_RIG, size, 2, false, cam));
const REST: WorldDelta = { x: 0, y: 0, scale: 1 };
/** The last world delta a stage drew. */
const lastWorld = (worlds: readonly WorldDelta[]): WorldDelta | undefined => worlds[worlds.length - 1];
function expectWorld(got: WorldDelta | undefined, want: WorldDelta, at = ''): void {
  expect(got, at).toBeDefined();
  expect(got?.x, at).toBeCloseTo(want.x, 9);
  expect(got?.y, at).toBeCloseTo(want.y, 9);
  expect(got?.scale, at).toBeCloseTo(want.scale, 12);
}

test('executor: a cam move tweens the world and a tap completes it', async () => {
  const h = flatHarness();
  await h.ex.apply([scene('lamp', 'cut'), face('ally', 'smile')], NOW);
  // At rest nothing is written.
  expect(h.worlds).toEqual([]);
  const end = framed(PUSH);
  expect(end.scale).toBeGreaterThan(1);
  const m = track(h.ex.apply([camera(PUSH)], NOW));
  await flush();
  // The push's 2400 ms, power1.inOut: half way at its midpoint.
  advance(1200);
  const mid = lastWorld(h.worlds);
  expect(mid?.scale).toBeCloseTo(1 + (end.scale - 1) / 2, 6);
  expect(mid?.x).toBeCloseTo(end.x / 2, 6);
  expect(m.done).toBe(false);
  expect(h.ex.stats().activeTimelines).toBe(1);
  h.ex.complete();
  await flush();
  expect(m.done).toBe(true);
  expectWorld(lastWorld(h.worlds), end);
  expect(h.ex.snapshot().cam).toEqual(PUSH);
  // Held: a line that moves no camera writes no world; a pull returns to rest over its 1200 ms.
  const n = h.worlds.length;
  await h.ex.apply([face('ally', 'worried')], { instant: true });
  expect(h.worlds).toHaveLength(n);
  // A face patch under the held push renders the pushed rect (review O2: through the delta the executor wrote).
  const rest = restFraming(LAMP_RIG, S390, 2, false);
  const pushed = { x: end.x + end.scale * rest.x, y: end.y + end.scale * rest.y, k: end.scale * rest.k };
  const patched = track(h.ex.apply([face('ally', 'smile')], NOW));
  await flush();
  expect(h.plans).toEqual([patchPlan([200, 460, 200, 260], pushed, 2)?.plan]);
  h.ex.complete();
  await flush();
  expect(patched.done).toBe(true);
  expect(h.worlds).toHaveLength(n);
  const pull = track(h.ex.apply([camera({ kind: 'pull' })], NOW));
  await flush();
  advance(600);
  expect(lastWorld(h.worlds)?.scale).toBeCloseTo(end.scale - (end.scale - 1) / 2, 6);
  advance(700);
  await flush();
  expect(pull.done).toBe(true);
  expect(lastWorld(h.worlds)).toEqual(REST);
  h.ex.destroy();
});

test('executor: a cut resets the camera', async () => {
  const h = flatHarness();
  await h.ex.apply([scene('lamp', 'cut'), face('ally', 'smile')], NOW);
  await h.ex.apply([camera(PUSH)], { instant: true });
  expectWorld(lastWorld(h.worlds), framed(PUSH));
  // A cut: at rest at once, at the cut point.
  h.worlds.length = 0;
  await h.ex.apply([bg('lamp_cu', 'cut')], NOW);
  expect(h.worlds).toEqual([REST]);
  expect('cam' in h.ex.snapshot()).toBe(false);
  // A dip: at rest at black, not before.
  await h.ex.apply([camera(PUSH)], { instant: true });
  h.worlds.length = 0;
  const dip = track(h.ex.apply([bg('lamp', 'fade', 400)], NOW));
  await flush();
  advance(150);
  expect(h.worlds).toEqual([]);
  advance(100);
  expect(h.worlds).toEqual([REST]);
  advance(250);
  await flush();
  expect(dip.done).toBe(true);
  // A dissolve: the snapshot keeps the pushed frame, then the world is at rest under it; a move in the same batch
  // starts from rest at the cut point.
  await h.ex.apply([camera(PUSH)], { instant: true });
  h.worlds.length = 0;
  const d = track(h.ex.apply([bg('lamp_cu', 'crossfade', 500), camera({ kind: 'push', to: 'center', z: 110 })], NOW));
  await flush();
  expect(h.log.filter((x) => x.startsWith('flatten:'))).toContain('flatten:screen:780x1688');
  expect(h.worlds).toEqual([REST]);
  h.ex.complete();
  await flush();
  expect(d.done).toBe(true);
  const cu = LAMP_RIGS.get('lamp_cu' as BgId);
  if (cu === undefined) {
    throw new Error('invariant: the fixture has the close-up');
  }
  expectWorld(lastWorld(h.worlds), worldOf(restFraming(cu, S390, 2, false), camFraming(cu, S390, 2, false, { kind: 'push', to: 'center', z: 110 })));
  h.ex.destroy();
});

test('executor: restore applies the camera end state', async () => {
  const h = flatHarness();
  await h.ex.restore({ bg: 'lamp' as BgId, cg: null, chars: [{ char: 'ally' as CharId, expr: 'smile' as ExprId, at: 'center' }], props: [], cam: PUSH });
  // At once, one write, no timeline.
  expect(h.worlds).toHaveLength(1);
  expectWorld(h.worlds[0], framed(PUSH));
  expect(h.ex.stats().activeTimelines).toBe(0);
  // A restore without a move: back to rest at once.
  await h.ex.restore({ bg: 'lamp' as BgId, cg: null, chars: [], props: [] });
  expect(lastWorld(h.worlds)).toEqual(REST);
  h.ex.destroy();
});

test('executor: a relayout re-frames a held push for the new stage', async () => {
  // D4: the push to the stranger on the phone is held by the plate's right and top edges (the clamp); on the larger
  // stage the clamp is another, so the held delta is framed again, never kept.
  const toStranger = { kind: 'push', to: 'stranger' as CharId, z: 120 } as const;
  const S412: Size = { w: 412, h: 915 };
  const h = flatHarness();
  await h.ex.apply([scene('lamp', 'cut'), face('ally', 'smile')], NOW);
  await h.ex.apply([camera(toStranger)], { instant: true });
  const small = camFraming(LAMP_RIG, S390, 2, false, toStranger);
  expect(small.x).toBeCloseTo(390 - 1080 * small.k, 9);
  expect(small.y).toBe(0);
  const before = lastWorld(h.worlds);
  expectWorld(before, framed(toStranger));
  h.stage.size = S412;
  h.ex.relayout();
  const large = camFraming(LAMP_RIG, S412, 2, false, toStranger);
  expect(large.x).toBeCloseTo(412 - 1080 * large.k, 9);
  expect(large.y).toBe(0);
  expectWorld(lastWorld(h.worlds), framed(toStranger, S412));
  expect(Math.abs((lastWorld(h.worlds)?.x ?? 0) - (before?.x ?? 0))).toBeGreaterThan(1);
  h.ex.destroy();
});

test('executor: a rebind re-frames a held push on the new adapter', async () => {
  // D4: the rebuilt stage's world starts at identity; the held push is drawn on it, framed for its size.
  const S412: Size = { w: 412, h: 915 };
  const h = flatHarness();
  await h.ex.apply([scene('lamp', 'cut'), face('ally', 'smile')], NOW);
  await h.ex.apply([camera(PUSH)], { instant: true });
  const fresh = recordingStage(S412, h.freed, 'draw');
  h.ex.rebind(fresh.adapter);
  expect(fresh.worlds).toHaveLength(1);
  expectWorld(fresh.worlds[0], framed(PUSH, S412));
  // The held move stays the snapshot's.
  expect(h.ex.snapshot().cam).toEqual(PUSH);
  h.ex.destroy();
});

test('executor: a crossfade onto the shot on stage returns a held camera to rest over its time', async () => {
  // S1: SH1's rule is kept: any bg resets the camera, the take's crossfade onto the shot on stage included; the drawn
  // world returns to rest over the crossfade's time, not at once.
  const h = flatHarness();
  await h.ex.apply([scene('lamp', 'cut'), face('ally', 'smile')], NOW);
  await h.ex.apply([camera(PUSH)], { instant: true });
  const end = framed(PUSH);
  h.worlds.length = 0;
  const take = track(h.ex.apply([bg('lamp', 'crossfade', 500), props(['key', KEY])], NOW));
  await flush();
  expect(h.worlds).toEqual([]);
  advance(250);
  expect(lastWorld(h.worlds)?.scale).toBeCloseTo(end.scale - (end.scale - 1) / 2, 6);
  advance(300);
  await flush();
  expect(take.done).toBe(true);
  expect(lastWorld(h.worlds)).toEqual(REST);
  expect('cam' in h.ex.snapshot()).toBe(false);
  expect(h.log.filter((x) => x.startsWith('flatten:'))).toEqual([]);
  h.ex.destroy();
});

// ---------------------------------------------------------------------------------------------------------------
// Faces in motion (lane SH7, D3, D5, D8): once the motion kit is set, each face of the shot on stage has a group of its
// drawn expression's motion members over its part, drawn from the records its own slots hold, and a discrete source on
// the loop that shows the animator's states. A fake kit lets each test set a face's state by hand.

/**
 * A face member whose rest blink, accent (and, with `joint`, joint) members sit in the shot's sheet, as the asset tool
 * packs them, and whose mouths stay in its talk file (A14); its other expressions are castMember's (the face file).
 */
function castMotionMember(shot: string, c: string, at: Box4, joint = false): CastRig & { char: CharId } {
  const m = castMember(shot, c, at);
  const face = m.face;
  const rest = face?.exprs[face.rest];
  if (face === null || rest === undefined) {
    throw new Error('invariant: castMember draws a face with its rest');
  }
  const sheet = `sheet/${shot}`;
  const eyes: Box4 = [at[0] + 40, at[1] + 60, 80, 30];
  const motion = {
    blink: { half: mem(sheet, [300, 0, 80, 30], eyes), closed: mem(sheet, [300, 30, 80, 30], eyes) },
    talk: rest.motion.talk,
    accent: mem(sheet, [300, 60, 80, 20], [at[0] + 40, at[1] + 30, 80, 20]),
    ...(joint ? { joint: { half: mem(sheet, [300, 80, 80, 30], eyes), closed: mem(sheet, [300, 110, 80, 30], eyes) } } : {}),
  };
  return { ...m, face: { ...face, exprs: { ...face.exprs, [face.rest]: { layer: null, motion } } } };
}
const MOTION_RIGS: ReadonlyMap<BgId, ShotRig> = new Map([
  ['lamp' as BgId, shotRig([castMotionMember('lamp', 'ally', ALLY_AT), castMotionMember('lamp', 'stranger', [700, 500, 160, 200])])],
  ['lamp_cu' as BgId, shotRig([castMotionMember('lamp_cu', 'ally', [400, 600, 300, 380])])],
]);
const MOTION: { rigs(): ReadonlyMap<BgId, ShotRig>; half(): boolean } = { rigs: () => MOTION_RIGS, half: () => false };

/** A face the test drives: the state it shows, the talk calls and listener cues it got. */
type FakeFace = {
  readonly set: { readonly talk: readonly unknown[] };
  state: FaceState;
  readonly talks: Array<{ on: boolean; forMs?: number; think?: boolean }>;
  heard: number;
};
const OPEN: FaceState = { eyes: 'open', accent: false, mouth: null };
function fakeKit(): { readonly kit: MotionKit; readonly faces: FakeFace[] } {
  const faces: FakeFace[] = [];
  const kit: MotionKit = {
    face: (set) => {
      const f: FakeFace = { set, state: OPEN, talks: [], heard: 0 };
      faces.push(f);
      return {
        talk: (on, o) => {
          f.talks.push({ on, ...o });
        },
        heard: () => {
          f.heard += 1;
        },
        sample: () => f.state,
        nextChangeMs: () => 1_000,
      };
    },
    talkMaxMs: 20_000,
  };
  return { kit, faces };
}
/** The one face a kit made for a character: the kit makes them in cast order, so a test names the index. */
function faceAt(faces: readonly FakeFace[], i: number): FakeFace {
  const f = faces[i];
  if (f === undefined) {
    throw new Error(`invariant: face ${i} was made`);
  }
  return f;
}

/** A loop the test drives: `run` plays display frames, each firing the due timers and then one tick. */
function drivenLoop() {
  let clock = 0;
  const listeners = new Set<() => void>();
  let id = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const loop = createRenderLoop({
    ticker: {
      add: (fn) => {
        listeners.add(fn);
      },
      remove: (fn) => {
        listeners.delete(fn);
      },
    },
    render: () => {},
    now: () => clock,
    timer: {
      set: (fn, ms) => {
        id += 1;
        timers.set(id, { at: clock + ms, fn });
        return id;
      },
      clear: (h) => {
        timers.delete(h as number); // the handle `set` returned
      },
    },
  });
  const run = (ms: number): void => {
    const end = clock + ms;
    while (clock < end) {
      clock = Math.min(end, clock + 1000 / 60);
      for (const [k, t] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
        if (t.at <= clock && timers.delete(k)) {
          t.fn();
        }
      }
      for (const fn of [...listeners]) {
        fn();
      }
    }
  };
  return { loop, run };
}

/** The live motion groups' nodes, in creation order. */
const motionNodes = (h: ReturnType<typeof harness>): Node[] => h.liveNodes().filter((x) => x.role === 'node' && x.key.startsWith('motion:'));
/** A face's motion members in draw order, each as its frame (`<file>#<box>`) and alpha. */
function membersOf(h: ReturnType<typeof harness>, c: string): Array<{ frame: string; alpha: number | undefined; node: Node }> {
  const g = h.liveNodes().find((x) => x.role === 'node' && x.key === `motion:${c}`);
  return g === undefined ? [] : h.drawOrder(g).map((x) => ({ frame: (x.tex?.url ?? '').replace('/assets/', ''), alpha: x.p.alpha, node: x }));
}
const shownOf = (h: ReturnType<typeof harness>, c: string): string[] => membersOf(h, c).filter((m) => m.alpha === 1).map((m) => m.frame);
const ALLY_REST = ['sheet_lamp.avif#300,60,80,20', 'sheet_lamp.avif#300,0,80,30', 'sheet_lamp.avif#300,30,80,30', 'talk_lamp_ally_neutral.avif#0,0,40,20'];

test('executor: a shot built before the motion kit shows rest faces and gains its sources when the kit lands', async () => {
  const d = drivenLoop();
  const h = harness(S390, d.loop, MOTION);
  const { kit, faces } = fakeKit();
  await h.ex.apply([scene('lamp', 'cut')], NOW);
  // No kit: the plate shows both faces at rest, the sheet is not taken, no group, no source.
  expect(motionNodes(h)).toEqual([]);
  expect([h.loadsOf('sheet/lamp'), d.loop.stats().ambientSources]).toEqual([0, 0]);
  h.ex.setMotion(kit);
  await flush();
  // O1: the logical stage's motion slot is taken now, once for both faces, and each face gains its group and source.
  expect(h.loadsOf('sheet/lamp')).toBe(1);
  expect(motionNodes(h).map((x) => x.key)).toEqual(['motion:ally', 'motion:stranger']);
  expect(d.loop.stats().ambientSources).toBe(2);
  expect(faces.map((f) => f.set.talk.length)).toEqual([1, 1]);
  // Built hidden (A15): the rest's members from the sheet's record and the mouth from the talk file.
  expect(membersOf(h, 'ally').map((m) => [m.frame, m.alpha])).toEqual(ALLY_REST.map((f) => [f, 0]));
  // The source shows the animator's state at its next change.
  const ally = faceAt(faces, 0);
  ally.state = { eyes: 'closed', accent: true, mouth: 0 };
  d.run(1_100);
  expect(shownOf(h, 'ally')).toEqual(['sheet_lamp.avif#300,60,80,20', 'sheet_lamp.avif#300,30,80,30', 'talk_lamp_ally_neutral.avif#0,0,40,20']);
  expect(h.ex.blinks?.()).toBe(1);
  ally.state = OPEN;
  d.run(1_000);
  expect(shownOf(h, 'ally')).toEqual([]);
  h.ex.destroy();
  expect(d.loop.stats().ambientSources).toBe(0);
  expect(h.liveNodes()).toEqual([]);
  // Arm: a kit landing after a restore (F5's restore-first session).
  const r = drivenLoop();
  const g = harness(S390, r.loop, MOTION);
  await g.ex.restore({ bg: 'lamp' as BgId, cg: null, chars: [], props: [] });
  g.ex.setMotion(fakeKit().kit);
  await flush();
  expect(motionNodes(g).map((x) => x.key)).toEqual(['motion:ally', 'motion:stranger']);
  expect(r.loop.stats().ambientSources).toBe(2);
  g.ex.destroy();
});

test("executor: a face's animator leaves with its shot", async () => {
  const d = drivenLoop();
  const h = harness(S390, d.loop, MOTION);
  h.ex.setMotion(fakeKit().kit);
  await h.ex.apply([scene('lamp', 'cut')], NOW);
  await flush();
  expect(d.loop.stats().ambientSources).toBe(2);
  // A cut: the old shot's groups go with its root; the new shot's one face gains its own.
  h.log.length = 0;
  await h.ex.apply([bg('lamp_cu', 'cut')], NOW);
  await flush();
  expect(h.log.indexOf('drop:motion:ally')).toBeLessThan(h.log.indexOf('drop:bg/lamp'));
  expect(motionNodes(h).map((x) => x.key)).toEqual(['motion:ally']);
  expect(d.loop.stats().ambientSources).toBe(1);
  // A legacy bg: no shot, no face, no source.
  await h.ex.apply([scene('cafe', 'cut')], NOW);
  await flush();
  expect(motionNodes(h)).toEqual([]);
  expect(d.loop.stats().ambientSources).toBe(0);
  h.ex.destroy();
  expect(h.liveNodes()).toEqual([]);
});

test('executor: a rest-only shot takes its sheet for motion and never waits on it', async () => {
  const h = harness(S390, quietLoop(), MOTION);
  h.ex.setMotion(fakeKit().kit);
  const go = h.deferLoad('sheet/lamp');
  const cut = track(h.ex.apply([scene('lamp', 'cut')], NOW));
  await flush();
  // The batch ended while the sheet still loads: the motion slot is taken and not awaited.
  expect(cut.done).toBe(true);
  expect(h.loadsOf('sheet/lamp')).toBe(1);
  expect(h.live('bg').map((x) => x.key)).toEqual(['lamp']);
  expect(motionNodes(h)).toEqual([]);
  // Its landing builds the groups.
  go();
  await flush();
  expect(motionNodes(h).map((x) => x.key)).toEqual(['motion:ally', 'motion:stranger']);
  // Held under the motion slot's own holder (one take for both faces).
  h.registry.releaseHolder('scene:motion:sheet/lamp');
  expect(h.releasedOf('sheet/lamp')).toBe(1);
  h.ex.destroy();
});

test("executor: a face's motion retires whole at its expression change, the patch's fade included", async () => {
  const h = harness(S390, quietLoop(), MOTION, undefined, 'draw');
  h.ex.setMotion(fakeKit().kit);
  await h.ex.apply([scene('lamp', 'cut')], NOW);
  await flush();
  const stranger = one(h.liveNodes().filter((x) => x.key === 'motion:stranger'));
  h.log.length = 0;
  const change = track(h.ex.apply([face('ally', 'smile')], NOW));
  await flush();
  // At the change's start the rest group leaves whole, before the new part is built and the patch renders.
  expect(h.log.slice(0, 6)).toEqual([
    'destroy:bg:sheet/lamp',
    'destroy:bg:sheet/lamp',
    'destroy:bg:sheet/lamp',
    'destroy:bg:talk/lamp/ally/neutral',
    'drop:motion:ally',
    'node:face:ally',
  ]);
  expect(h.flats()).toHaveLength(1);
  advance(100);
  await flush();
  // Through the fade no member of either set shows.
  expect(motionNodes(h).map((x) => x.key)).toEqual(['motion:stranger']);
  expect(stranger.alive).toBe(true);
  advance(150);
  await flush();
  expect(change.done).toBe(true);
  // After it the smile's own set, from the face file and its talk file.
  expect(membersOf(h, 'ally').map((m) => m.frame)).toEqual([
    'face_lamp_ally_smile.avif#2,0,1,1',
    'face_lamp_ally_smile.avif#0,0,1,1',
    'face_lamp_ally_smile.avif#1,0,1,1',
    'talk_lamp_ally_smile.avif#0,0,40,20',
  ]);
  // W5: a talk take held past the fade's start lands inside it; the group still waits for the batch's end.
  const talk = h.deferLoad('talk/lamp/ally/worried');
  const worried = track(h.ex.apply([face('ally', 'worried')], NOW));
  await flush();
  advance(100);
  talk();
  await flush();
  expect(worried.done).toBe(false);
  expect(membersOf(h, 'ally')).toEqual([]);
  advance(150);
  await flush();
  expect(worried.done).toBe(true);
  expect(membersOf(h, 'ally').map((m) => m.frame)).toEqual([
    'face_lamp_ally_worried.avif#2,0,1,1',
    'face_lamp_ally_worried.avif#0,0,1,1',
    'face_lamp_ally_worried.avif#1,0,1,1',
    'talk_lamp_ally_worried.avif#0,0,40,20',
  ]);
  // And a kit landing mid-fade builds nothing before the batch ends.
  const k = harness(S390, quietLoop(), MOTION, undefined, 'draw');
  await k.ex.apply([scene('lamp', 'cut')], NOW);
  const late = track(k.ex.apply([face('ally', 'smile')], NOW));
  await flush();
  advance(100);
  k.ex.setMotion(fakeKit().kit);
  await flush();
  expect(motionNodes(k)).toEqual([]);
  advance(150);
  await flush();
  expect(late.done).toBe(true);
  expect(motionNodes(k).map((x) => x.key)).toEqual(['motion:ally', 'motion:stranger']);
  k.ex.destroy();
  h.ex.destroy();
  expect(h.liveNodes()).toEqual([]);
});

test("executor: a face's motion members draw the accent, then the eyes, then the mouth", async () => {
  const rigs: ReadonlyMap<BgId, ShotRig> = new Map([['lamp' as BgId, shotRig([castMotionMember('lamp', 'ally', ALLY_AT, true)])]]);
  const d = drivenLoop();
  const h = harness(S390, d.loop, { rigs: () => rigs, half: () => false });
  const { kit, faces } = fakeKit();
  h.ex.setMotion(kit);
  await h.ex.apply([scene('lamp', 'cut')], NOW);
  await flush();
  // C6: back to front, so a mouth wins any box a joint member overlaps.
  const accent = 'sheet_lamp.avif#300,60,80,20';
  const [half, closed, jointHalf, jointClosed] = ['300,0', '300,30', '300,80', '300,110'].map((b) => `sheet_lamp.avif#${b},80,30`);
  const mouth = 'talk_lamp_ally_neutral.avif#0,0,40,20';
  expect(membersOf(h, 'ally').map((m) => m.frame)).toEqual([accent, half, closed, jointHalf, jointClosed, mouth]);
  // Over its face's part (z 2), under the next member's figure plane (z 3), in the root's content.
  expect(one(motionNodes(h)).p.z).toBe(2.5);
  const [first] = membersOf(h, 'ally');
  expect(first === undefined ? [] : h.rolesAbove(first.node)).toEqual(['node', 'content', 'motion', 'depth', 'anchor', 'layer']);
  // The eyes close on the accent: the joint pair, not the blink pair.
  const f = faceAt(faces, 0);
  f.state = { eyes: 'closed', accent: true, mouth: 0 };
  d.run(1_100);
  expect(shownOf(h, 'ally')).toEqual([accent, jointClosed, mouth]);
  f.state = { eyes: 'half', accent: false, mouth: null };
  d.run(1_000);
  expect(shownOf(h, 'ally')).toEqual([half]);
  expect(h.ex.blinks?.()).toBe(1);
  h.ex.destroy();
});

test("executor: a rebind rebuilds a face's motion and a failed revive removes its source", async () => {
  const d = drivenLoop();
  const h = harness(S390, d.loop, MOTION);
  h.ex.setMotion(fakeKit().kit);
  await h.ex.apply([scene('lamp', 'cut')], NOW);
  await flush();
  expect(d.loop.stats().ambientSources).toBe(2);
  // The production order (W2): a failed revive with no rebind (a restored context), then the flow's reacquire, before
  // the resume frame: no group sprite stays over the ended record, and the sources go.
  await failOnRevive(h, 'sheet/lamp');
  h.ex.reacquire();
  expect(motionNodes(h)).toEqual([]);
  expect(h.live('bg').filter((x) => x.tex !== null && h.freed.has(x.tex)).map((x) => x.key)).toEqual([]);
  expect(d.loop.stats().ambientSources).toBe(0);
  // The re-taken motion slot rebuilds them by its own landing, on the new record.
  await flush();
  expect(h.loadsOf('sheet/lamp')).toBe(2);
  expect(motionNodes(h).map((x) => x.key)).toEqual(['motion:ally', 'motion:stranger']);
  expect(membersOf(h, 'ally').filter((m) => m.node.tex !== null && h.freed.has(m.node.tex))).toEqual([]);
  expect(d.loop.stats().ambientSources).toBe(2);
  // While a batch still waits on its loads (the groups' own sync waits for its end), the reacquire still takes them off
  // at once.
  const go = h.deferLoad('face/lamp/ally/smile');
  const waiting = track(h.ex.apply([face('ally', 'smile')], NOW));
  await flush();
  expect(waiting.done).toBe(false);
  h.setGen(3);
  expect(await h.registry.revive(3, noAbort()).visible).toBe('done');
  h.ex.reacquire();
  expect(motionNodes(h)).toEqual([]);
  expect(d.loop.stats().ambientSources).toBe(0);
  go();
  await flush();
  h.ex.complete();
  await flush();
  expect(waiting.done).toBe(true);
  await h.ex.apply([face('ally', 'neutral')], { instant: true });
  await flush();
  expect(motionNodes(h).map((x) => x.key).sort()).toEqual(['motion:ally', 'motion:stranger']);
  // A re-take that fails too: no group without its chain's members, and no source.
  h.setGen(4);
  expect(await h.registry.revive(4, noAbort()).visible).toBe('done');
  expect(h.registry.current(asId('sheet/lamp'))).toBe(null);
  h.failLoad('sheet/lamp');
  h.ex.reacquire();
  await flush();
  expect(motionNodes(h)).toEqual([]);
  expect(d.loop.stats().ambientSources).toBe(0);
  h.ex.destroy();
  // Arm: a rebind re-creates every group on the new stage and moves the sources there.
  const r = drivenLoop();
  const g = harness(S390, r.loop, MOTION);
  g.ex.setMotion(fakeKit().kit);
  await g.ex.apply([scene('lamp', 'cut')], NOW);
  await flush();
  const fresh = recordingStage(S390, g.freed);
  g.ex.rebind(fresh.adapter);
  expect(fresh.liveNodes().filter((x) => x.role === 'node').map((x) => x.key)).toEqual(['motion:ally', 'motion:stranger']);
  expect(r.loop.stats().ambientSources).toBe(2);
  // Arm: a relayout keeps the group and its source, and its members move with the root's framing.
  const member = fresh.liveNodes().find((x) => x.role === 'sprite' && x.tex?.url.endsWith('#300,0,80,30') === true);
  const box = member === undefined ? undefined : fresh.worldBox(member);
  fresh.stage.size = { w: 412, h: 915 };
  g.ex.relayout();
  expect(member?.alive).toBe(true);
  expect(member === undefined ? undefined : fresh.worldBox(member)).not.toEqual(box);
  expect(r.loop.stats().ambientSources).toBe(2);
  // Arm: a rebind after a failed revive of the sheet leaves no group, and no source.
  await failOnRevive(g, 'sheet/lamp');
  const other = recordingStage(S390, g.freed);
  g.ex.rebind(other.adapter);
  expect(other.liveNodes().filter((x) => x.key.startsWith('motion:'))).toEqual([]);
  expect(r.loop.stats().ambientSources).toBe(0);
  g.ex.destroy();
});

test("executor: frozen holds a face's motion and leaves a camera move, a cut and a dissolve running", async () => {
  const d = drivenLoop();
  const h = harness(S390, d.loop, MOTION, undefined, 'draw');
  const { kit, faces } = fakeKit();
  h.ex.setMotion(kit);
  d.loop.setAnimation({ frozen: true });
  await h.ex.apply([scene('lamp', 'cut')], NOW);
  await flush();
  // Built and counted, held: nothing shows and no blink is counted.
  expect(d.loop.stats().ambientSources).toBe(2);
  for (const f of faces) {
    f.state = { eyes: 'closed', accent: true, mouth: 0 };
  }
  d.run(3_000);
  expect([shownOf(h, 'ally'), shownOf(h, 'stranger'), h.ex.blinks?.()]).toEqual([[], [], 0]);
  // The camera still moves over its time.
  const push = track(h.ex.apply([camera({ kind: 'push', to: 'ally' as CharId, z: 120 })], NOW));
  await flush();
  advance(1200);
  expect(lastWorld(h.worlds)?.scale).toBeGreaterThan(1);
  expect(push.done).toBe(false);
  h.ex.complete();
  await flush();
  // A cut runs, and the exact dissolve makes its target and fades it over its time.
  await h.ex.apply([bg('lamp_cu', 'cut')], NOW);
  await flush();
  const dissolve = track(h.ex.apply([bg('lamp', 'crossfade', 500)], NOW));
  await flush();
  expect(h.flats()).toHaveLength(1);
  advance(250);
  expect(dissolve.done).toBe(false);
  advance(300);
  await flush();
  expect(dissolve.done).toBe(true);
  expect(shownOf(h, 'ally')).toEqual([]);
  // Live again: the faces show their states at the next change.
  d.loop.setAnimation({ frozen: false });
  for (const f of faces) {
    f.state = { eyes: 'closed', accent: false, mouth: null };
  }
  d.run(1_100);
  expect(shownOf(h, 'ally')).toEqual(['sheet_lamp.avif#300,30,80,30']);
  h.ex.destroy();
});
