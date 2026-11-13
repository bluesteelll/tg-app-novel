// The scene controller (PROTOTYPE-PLAN "Scene controller and asset registry"): one Pixi Application driven
// imperatively, its layers (bg, props, chars, cg, fx), the Pixi StageAdapter the executor drives, and the wiring of
// registry, loader, scheduler, executor, revive flow and render loop. It reads staging commands only, never story state
// (principle 7); input belongs to the DOM overlay (`stage.eventMode = 'none'`). After a GPU context change it drives
// the revive (MEMORY-PLAN M2, section 8): frames are drawn only while the context is live and the flow lets them.
import { Application, Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';
import type { ApplicationOptions, ImageSource } from 'pixi.js';

import type { Size } from '../geom/cover.ts';
import type { AssetManifest, FetchAsset, Result, SizeTier } from '../story/catalog.ts';
import type { ShotRig } from '../story/shots.ts';
import type { AssetId, BgId, PropId } from '../story/staging.ts';
import { createExecutor, gsapTicker, pauseAll, resumeAll } from './executor.ts';
import type { Executor, GroupRef, Layer, SceneSnapshot, SpriteRef, StageAdapter, VisualCommand } from './executor.ts';
import { halfFits, renderResolution, stageBound, tierFor } from './layout.ts';
import type { PerfClass } from './layout.ts';
import { createImageLoader, probeAvif } from './loader.ts';
import { SKIP_PIXI_ENV } from './pixi-env.ts';
import { ENSURE_HOLDER, createAssetScheduler, windowDeps } from './preload.ts';
import type { AssetScheduler, StageWindow, WindowStats } from './preload.ts';
import { createAssetRegistry, pixiFrames } from './registry.ts';
import type { AssetError, AssetRegistry, ReviveEnd, SceneError } from './registry.ts';
import { createRenderLoop } from './render-loop.ts';
import type { RenderLoop } from './render-loop.ts';
import { createReviveFlow } from './revive-flow.ts';
import type { ReviveFlow } from './revive-flow.ts';
import { chapterRigs } from './shot-view.ts';

/** `__novelDebug.stats().scene` under `__TG_MOCK__` (perf and memory e2e); every field is always reported. */
export type SceneStats = {
  liveTextures: number;
  liveBytes: number;
  pendingLoads: number;
  activeTimelines: number;
  overCap: number;
  /** D13 rebuilds since mount: an unrestored context loss reached `activated` (MEMORY-PLAN M2 commit 1). */
  rebuilds: number;
  /** The GPU generation: 1 at mount, +1 at each `webglcontextrestored` and at each rebuild's install. */
  gen: number;
  /** Live textures whose decoded bitmap is still open (0 on a GL renderer once uploads are done). */
  openBitmaps: number;
  /** Live textures not yet brought to the generation of the latest revive. */
  stale: number;
  /** Frames drawn before the latest generation's visible revive was done (each could bind a stale texture). */
  staleFrames: number;
  /** Textures ended by a failed or late revive (cumulative). */
  reviveFailed: number;
  /** A revive is running (its passes have not both settled). */
  reviving: boolean;
  /** The latest visible revive, from its start to its visible pass done, in ms; null before the first. */
  visibleReviveMs: number | null;
  // The step windows (shots §5.8). Optional in the type only, for the stats literals other modules build; the controller
  // always reports them.
  /** The current window's need items not live, and the window's ids held or asked for. */
  window?: WindowStats['window'];
  /** The `room:` tags that hold or load a record. */
  rooms?: string[];
  /** Records with a warm holder, and the file bytes of the ones held undecoded. */
  warm?: number;
  warmBytes?: number;
  /** Live preview records (shots §5.8 step 5): a chapter entry's files still at their half, before their upgrade. */
  previews?: number;
};

export interface SceneController {
  /** The render resolution is decided here, from the device's pixel ratio and its class (layout.ts, lever F). */
  mount(host: HTMLElement, o: { dpr: number; perfClass: PerfClass; fetchAsset: FetchAsset }): Promise<Result<void, SceneError>>;
  /**
   * Releases every preload:* holder (the window's included) and every next:* holder except next:<m.chapterId> (F4, F5):
   * the entry tag, which the chapter's first window ends once it joined its files (shots §5.8 step 1c).
   */
  setChapter(m: AssetManifest): void;
  /**
   * Resolves after transitions + wait. `window`: the step's preload window, wanted at the batch's swap point.
   * `preview` (shots §5.8 step 1): a chapter entry's first step: the batch's new takes start from their halves, and its
   * window carries the flag.
   */
  apply(batch: readonly VisualCommand[], o: { instant: boolean; window?: StageWindow; preview?: boolean }): Promise<void>;
  /** A tap during a transition. */
  complete(): void;
  /** Instant. `preview`: a chapter entry's restore (shots §5.8 step 1), whose new takes start from their halves. */
  restore(s: SceneSnapshot, o?: { preview?: boolean }): Promise<void>;
  snapshot(): SceneSnapshot;
  /** Background, cancellable; ids resolve in `from` (the next chapter's manifest, F5) or else the current one. */
  preload(tag: string, ids: readonly AssetId[], from?: AssetManifest): void;
  releasePreload(tag: string): void;
  /** The blocking load of a batch's assets. `preview`: a chapter entry's first step (shots §5.8 step 1). */
  ensure(ids: readonly AssetId[], signal: AbortSignal, o?: { preview?: boolean }): Promise<Result<void, SceneError>>;
  /** Context-loss check + rebuild. */
  onActivated(): Promise<void>;
  pause(): void;
  resume(): void;
  stats(): SceneStats;
  /**
   * Wired to __novelDebug only under __TG_MOCK__ (perf and memory e2e). `'restorable'`: Pixi's forced loss, which Pixi
   * restores itself; `'hard'`: the WebGL extension's loss, which nothing restores, so `activated` rebuilds.
   */
  debugForceContextLoss(mode: 'restorable' | 'hard'): void;
  /** Page CSS px of the live prop sprites (PUZZLES-PLAN X10); __novelDebug only under __TG_MOCK__ (puzzles e2e). */
  debugPropRects(): ReadonlyArray<{ prop: PropId; x: number; y: number; w: number; h: number }>;
  destroy(): void;
}

/** PROTOTYPE-PLAN concurrency table: a context still lost this long after `activated` is rebuilt. */
export const CONTEXT_GRACE_MS = 2000;

type Layers = { readonly bg: Container; readonly props: Container; readonly chars: Container; readonly cg: Container; readonly fx: Graphics };
type Mounted = {
  readonly host: HTMLElement;
  readonly resolution: number;
  /** Replaced once by the rebuild after an unrecoverable context loss. */
  app: Application;
  /** The registry's size tier (MEMORY-PLAN 4.C): chosen at mount, demoted once to 'full' by a resize past the bound. */
  tier: SizeTier;
  readonly registry: AssetRegistry<Texture>;
  readonly scheduler: AssetScheduler;
  readonly loop: RenderLoop;
  readonly executor: Executor<Texture>;
  readonly flow: ReviveFlow;
  readonly observer: ResizeObserver;
};

const EMPTY: SceneSnapshot = Object.freeze({ bg: null, cg: null, chars: Object.freeze([]), props: Object.freeze([]) });
const fail = (detail: string): { ok: false; error: SceneError } => ({ ok: false, error: { kind: 'mount', detail } });

/**
 * The device's screen in CSS px (CSSOM View), the bound of every stage the session can reach (MEMORY-PLAN 4.C); null
 * when the WebView has no `screen` or reports a side that is not a positive finite number (then the tier is full).
 */
function screenSize(): Size | null {
  if (typeof screen === 'undefined') {
    return null;
  }
  const { width: w, height: h } = screen;
  return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? { w, h } : null;
}

/**
 * PROTOTYPE-PLAN "Init" [R3 §4.3], plus the accessibility layer off: it would listen for Tab and add DOM nodes. Sized
 * from the host at init and then only by the controller's ResizeObserver, not `resizeTo`: Pixi's ResizePlugin renders
 * on a window resize outside the render loop's gate, which could draw a texture not yet revived (MEMORY-PLAN M2).
 * Pixi's environment extensions are not imported (`SKIP_PIXI_ENV`, RULINGS 201 lever X): the app uses none of their
 * systems (events, accessibility, the DOM pipe, filters), so their chunks leave the path to the first line. Rule
 * `pixi-env` (arch.test.ts) keeps scene code off those systems and every `.init(` here on these options.
 */
export function appOptions(host: HTMLElement, resolution: number): Partial<ApplicationOptions> {
  return {
    preference: 'webgl',
    resolution,
    autoDensity: true,
    antialias: false,
    background: '#000000',
    width: host.clientWidth,
    height: host.clientHeight,
    autoStart: false,
    accessibilityOptions: { enabledByDefault: false, activateOnTab: false },
    skipExtensionImports: SKIP_PIXI_ENV,
  };
}

/** The stage's layers, bottom to top (the Application's stage, or a bare Container in a test). */
export function createLayers(app: Pick<Application, 'stage'>): Layers {
  const fx = new Graphics().rect(0, 0, 1, 1).fill(0x000000);
  fx.alpha = 0;
  fx.visible = false;
  const layers: Layers = { bg: new Container(), props: new Container(), chars: new Container(), cg: new Container(), fx };
  layers.chars.sortableChildren = true;
  layers.props.sortableChildren = true;
  app.stage.eventMode = 'none';
  app.stage.addChild(layers.bg, layers.props, layers.chars, layers.cg, layers.fx);
  return layers;
}

/** The executor's stage over Pixi: every display object it creates is destroyed through destroy / dropGroup. */
export function pixiAdapter(app: Pick<Application, 'screen'>, layers: Layers): StageAdapter<Texture> {
  let n = 0;
  const sprites = new Map<number, Sprite>();
  const groups = new Map<number, Container>();
  /** An anchor's id -> the ids of its three inner nodes, forgotten with it (no entry outlives its Container). */
  const inner = new Map<number, readonly number[]>();
  const node = (t: SpriteRef | GroupRef): Container | undefined => ('sprite' in t ? sprites.get(t.sprite) : groups.get(t.group));
  const add = (c: Container): GroupRef => {
    n += 1;
    groups.set(n, c);
    return { group: n };
  };
  return {
    size: () => ({ w: app.screen.width, h: app.screen.height }),
    group(char) {
      const c = new Container({ label: char });
      layers.chars.addChild(c);
      return add(c);
    },
    anchor(layer, label) {
      const anchor = new Container({ label });
      const depth = anchor.addChild(new Container());
      const motion = depth.addChild(new Container());
      const content = motion.addChild(new Container({ sortableChildren: true }));
      layers[layer].addChild(anchor);
      const ref = { anchor: add(anchor), depth: add(depth), motion: add(motion), content: add(content) };
      inner.set(ref.anchor.group, [ref.depth.group, ref.motion.group, ref.content.group]);
      return ref;
    },
    node(parent, label) {
      const c = new Container({ label });
      groups.get(parent.group)?.addChild(c);
      return add(c);
    },
    dropGroup(g) {
      const c = groups.get(g.group);
      for (const k of [g.group, ...(inner.get(g.group) ?? [])]) {
        groups.delete(k);
      }
      inner.delete(g.group);
      c?.destroy({ children: true });
    },
    sprite(layer: Layer, tex, g) {
      n += 1;
      const s = new Sprite(tex.texture);
      if (layer === 'chars') {
        s.anchor.set(0.5, 1);
      }
      ((g === undefined ? undefined : groups.get(g.group)) ?? layers[layer]).addChild(s);
      sprites.set(n, s);
      return { sprite: n };
    },
    destroy(s) {
      const sprite = sprites.get(s.sprite);
      sprites.delete(s.sprite);
      // The texture is the registry's: Sprite.destroy() without options leaves it alone.
      sprite?.destroy();
    },
    set(t, p) {
      const c = node(t);
      if (c === undefined) {
        return;
      }
      if (p.x !== undefined) {
        c.x = p.x;
      }
      if (p.y !== undefined) {
        c.y = p.y;
      }
      if (p.w !== undefined) {
        c.width = p.w;
      }
      if (p.h !== undefined) {
        c.height = p.h;
      }
      if (p.alpha !== undefined) {
        c.alpha = p.alpha;
      }
      if (p.z !== undefined) {
        c.zIndex = p.z;
      }
      if (p.scale !== undefined) {
        c.scale.set(p.scale);
      }
    },
    fx(alpha) {
      layers.fx.alpha = alpha;
      layers.fx.visible = alpha > 0;
      layers.fx.scale.set(app.screen.width, app.screen.height);
    },
  };
}

const report = (e: AssetError): void => {
  console.warn('scene: asset skipped', e);
};

export function createSceneController(): SceneController {
  let state: 'idle' | 'mounting' | 'mounted' | 'destroyed' = 'idle';
  let core: Mounted | null = null;
  let pendingManifest: AssetManifest | null = null;
  /** The current chapter's shot rigs (shot-view.ts); null on a legacy chapter. */
  let rigs: ReadonlyMap<BgId, ShotRig> | null = null;
  let paused = false;
  /** The canvas reported webglcontextlost and no webglcontextrestored since. */
  let lost = false;
  let activating: Promise<void> | null = null;
  let grace: { timer: ReturnType<typeof setTimeout>; wake: () => void } | null = null;
  let rebuilds = 0;
  /** The GPU generation every upload reports (MEMORY-PLAN 4.A). */
  let gen = 1;
  /** The generation of the latest revive whose visible pass settled 'done' (the mount's uploads are generation 1). */
  let doneGen = 1;
  let staleFrames = 0;
  let visibleReviveMs: number | null = null;

  const onResize = (): void => {
    const c = core;
    if (c === null) {
      return;
    }
    c.app.renderer.resize(c.host.clientWidth, c.host.clientHeight);
    c.executor.relayout();
    // MEMORY-PLAN 4.C, the one-way demotion: a host past the half bound (a foldable unfolded, a UA that under-reported
    // its screen) loads the full files from now on; what is on stage keeps its half until released (I4: same layout).
    if (c.tier === 'half' && !halfFits({ w: c.host.clientWidth, h: c.host.clientHeight }, c.resolution)) {
      c.registry.demote();
      c.tier = 'full';
    }
    c.loop.requestRender();
  };
  const onLost = (): void => {
    lost = true;
    core?.flow.lost();
  };
  // Pixi's own listener ran first (GlContextSystem, added during app.init): every GPU texture of this renderer is gone.
  // The revive uploads them again, and its visible pass draws the cleared buffer (resume). While deactivated, only the
  // generation moves: `activated` starts the revive (MEMORY-PLAN section 9).
  const onRestored = (): void => {
    lost = false;
    gen += 1;
    const c = core;
    if (c === null) {
      return;
    }
    if (paused) {
      c.flow.lost();
    } else {
      c.flow.start(gen);
    }
  };
  const watch = (canvas: HTMLCanvasElement): void => {
    // Pixi's EventSystem set this, and it is skipped (SKIP_PIXI_ENV): without it a touch on the bare picture gets the
    // body's `manipulation` (index.html) and pans or pinch-zooms. Both installs, mount and rebuild, come through here.
    canvas.style.touchAction = 'none';
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);
  };
  const unwatch = (canvas: HTMLCanvasElement): void => {
    canvas.removeEventListener('webglcontextlost', onLost);
    canvas.removeEventListener('webglcontextrestored', onRestored);
  };
  const isLost = (app: Application): boolean => {
    const r = app.renderer;
    return lost || ('gl' in r && r.context.isLost);
  };
  /**
   * The loader's upload (MEMORY-PLAN 4.A): to the renderer current at this call (the rebuild replaces it), GL only and
   * never on a lost context; the generation it uploaded under, else null (the bitmap stays open).
   */
  const upload = (source: ImageSource): number | null => {
    const c = core;
    if (c === null) {
      return null;
    }
    const r = c.app.renderer;
    if (!('gl' in r) || isLost(c.app)) {
      return null;
    }
    r.texture.initSource(source);
    return gen;
  };
  /** `registry.revive`, timed, and the generation whose visible pass is done recorded before the flow sees it. */
  const reviveWith =
    (registry: AssetRegistry<Texture>) =>
    (to: number, signal: AbortSignal): { visible: Promise<ReviveEnd>; all: Promise<ReviveEnd> } => {
      const t0 = performance.now();
      const passes = registry.revive(to, signal);
      const visible = passes.visible.then((end) => {
        if (end === 'done') {
          doneGen = Math.max(doneGen, to);
          visibleReviveMs = performance.now() - t0;
        }
        return end;
      });
      return { visible, all: passes.all };
    };
  /**
   * Every point where `activated` finds the context live: a revive that did not finish (frames still suspended, or a
   * stale texture) starts again under the current generation; while deactivated, nothing (the next `activated` does).
   */
  const live = (c: Mounted): void => {
    if (!paused && (c.flow.suspended() || c.registry.stats().stale > 0)) {
      c.flow.start(gen);
    } else {
      c.loop.requestRender();
    }
  };
  /** Resolves after CONTEXT_GRACE_MS, or at once when the controller is destroyed. */
  const waitGrace = (): Promise<void> =>
    new Promise((resolve) => {
      const wake = (): void => {
        grace = null;
        resolve();
      };
      grace = { timer: setTimeout(wake, CONTEXT_GRACE_MS), wake };
    });

  /**
   * D13: a new Application on the same host. The registry's textures stay; their GPU copies are per renderer, so the
   * revive brings each to the new one before its first frame (an upload of a kept bitmap, else a decode of the kept
   * file). The executor re-creates the stage on it.
   */
  const rebuild = async (c: Mounted): Promise<void> => {
    const app = new Application();
    try {
      await app.init(appOptions(c.host, c.resolution));
    } catch (e) {
      console.error('scene: rebuild after context loss failed', e);
      return;
    }
    if (core !== c) {
      app.destroy({ removeView: true }, { children: true });
      return;
    }
    // MEMORY-PLAN section 8 "Rebuild": one synchronous block, so no upload and no frame meets a half-installed stage.
    // The first frame is the revive's resume, after this block.
    const old = c.app;
    c.flow.lost();
    unwatch(old.canvas);
    c.host.appendChild(app.canvas);
    c.executor.rebind(pixiAdapter(app, createLayers(app)));
    c.app = app;
    lost = false;
    watch(app.canvas);
    gen += 1;
    rebuilds += 1;
    // A rebuild the grace reaches while deactivated builds at once and defers only the revive (RULINGS 78).
    if (paused) {
      c.flow.lost();
    } else {
      c.flow.start(gen);
    }
    // Sprites and layers go with the old stage; textures and their sources are the registry's and are kept.
    old.destroy({ removeView: true }, { children: true, texture: false, textureSource: false });
  };

  const activated = async (c: Mounted): Promise<void> => {
    if (!isLost(c.app)) {
      live(c);
      return;
    }
    await waitGrace();
    if (core !== c) {
      return;
    }
    if (isLost(c.app)) {
      await rebuild(c);
    } else {
      live(c);
    }
  };

  return {
    async mount(host, o) {
      if (state !== 'idle') {
        return fail(`mount while ${state}`);
      }
      state = 'mounting';
      const resolution = renderResolution(o.dpr, o.perfClass);
      const avif = await probeAvif();
      const app = new Application();
      try {
        await app.init(appOptions(host, resolution));
      } catch (e) {
        if (state === 'mounting') {
          state = 'idle';
        }
        return fail(e instanceof Error ? e.message : String(e));
      }
      if (state !== 'mounting') {
        app.destroy({ removeView: true }, { children: true });
        return fail('destroyed while mounting');
      }
      host.appendChild(app.canvas);
      const layers = createLayers(app);
      // MEMORY-PLAN 4.C: the half files only on a LOW device whose largest reachable stage passes halfFits.
      const tier = tierFor(o.perfClass, stageBound(screenSize(), { w: host.clientWidth, h: host.clientHeight }), resolution);
      const registry = createAssetRegistry<Texture>({
        hold: createImageLoader({ fetchAsset: o.fetchAsset, upload }),
        variant: avif ? 'avif' : 'webp',
        tier,
        frames: pixiFrames({ Texture, Rectangle }),
      });
      const scheduler = createAssetScheduler({ registry, onError: report });
      // The current Application (the rebuild replaces it), and the only path to a frame: none while the context is lost
      // or the revive flow holds frames, so no frame binds a texture not yet revived (MEMORY-PLAN I7).
      const loop = createRenderLoop({
        ticker: gsapTicker,
        render: () => {
          const c = core;
          if (c === null || lost || c.flow.suspended()) {
            return;
          }
          if (doneGen !== gen) {
            staleFrames += 1;
          }
          c.app.render();
        },
      });
      const executor = createExecutor<Texture>({
        adapter: pixiAdapter(app, layers),
        registry,
        resolve: (id) => scheduler.resolve(id),
        loop,
        resolution,
        onSkip: report,
        // A demoted session's new records are full (MEMORY-PLAN 4.C), so the overscan reads the tier as it is now.
        shots: { rigs: () => rigs, half: () => core?.tier === 'half' },
        // The swap point wants the step's window; a release retries what the window was refused (shots §5.8).
        ...windowDeps(scheduler),
      });
      const flow = createReviveFlow({
        revive: reviveWith(registry),
        reacquire: () => executor.reacquire(),
        resume: () => loop.requestRender(),
      });
      // The renderer's only sizing after init: the host's box, whatever changed it (a window resize, Telegram's height).
      const observer = new ResizeObserver(onResize);
      core = { host, resolution, app, tier, registry, scheduler, loop, executor, flow, observer };
      observer.observe(host);
      watch(app.canvas);
      if (pendingManifest !== null) {
        scheduler.setChapter(pendingManifest);
        pendingManifest = null;
      }
      state = 'mounted';
      loop.requestRender();
      return { ok: true, value: undefined };
    },
    setChapter(m) {
      if (state !== 'destroyed') {
        rigs = chapterRigs(m);
      }
      if (core !== null) {
        core.scheduler.setChapter(m);
      } else if (state !== 'destroyed') {
        pendingManifest = m;
      }
    },
    apply(batch, o) {
      if (core === null) {
        return Promise.resolve();
      }
      const { executor } = core;
      // Shots §5.8 step 1: the executor takes every changed slot synchronously inside apply, so the scope marks them.
      const done =
        o.preview === true
          ? core.registry.previewing(() => executor.apply(batch, o.window === undefined ? { instant: o.instant } : { instant: o.instant, window: { ...o.window, preview: true } }))
          : executor.apply(batch, o);
      // D7: the slot holders are taken by now, so the batch's ensure holder can go.
      core.registry.releaseHolder(ENSURE_HOLDER);
      return done;
    },
    complete() {
      core?.executor.complete();
    },
    restore(s, o) {
      if (core === null) {
        return Promise.resolve();
      }
      const { executor } = core;
      const done = o?.preview === true ? core.registry.previewing(() => executor.restore(s)) : executor.restore(s);
      core.registry.releaseHolder(ENSURE_HOLDER);
      return done;
    },
    snapshot() {
      return core === null ? { ...EMPTY, chars: [], props: [] } : core.executor.snapshot();
    },
    preload(tag, ids, from) {
      core?.scheduler.preload(tag, ids, from);
    },
    releasePreload(tag) {
      core?.scheduler.releasePreload(tag);
    },
    ensure(ids, signal, o) {
      return core === null ? Promise.resolve(fail(`ensure while ${state}`)) : core.scheduler.ensure(ids, signal, o);
    },
    onActivated() {
      const c = core;
      if (c === null) {
        return Promise.resolve();
      }
      // One check at a time: a second activated during the grace period joins the first.
      activating ??= activated(c).finally(() => {
        activating = null;
      });
      return activating;
    },
    pause() {
      if (core === null || paused) {
        return;
      }
      paused = true;
      pauseAll();
      core.loop.pause();
      // A hidden WebView throttles timers: the revive stops here, records stay stale, frames stay as they are.
      core.flow.abort();
    },
    resume() {
      if (core === null || !paused) {
        return;
      }
      paused = false;
      resumeAll();
      core.loop.resume();
    },
    stats() {
      const counters = { rebuilds, gen, staleFrames, visibleReviveMs };
      if (core === null) {
        const none = { liveTextures: 0, liveBytes: 0, pendingLoads: 0, activeTimelines: 0, overCap: 0 };
        const windows = { window: { pending: 0, ids: [] }, rooms: [], warm: 0, warmBytes: 0, previews: 0 };
        return { ...none, openBitmaps: 0, stale: 0, reviveFailed: 0, reviving: false, ...counters, ...windows };
      }
      const r = core.registry.stats();
      return {
        liveTextures: r.live,
        // Live texture bytes: the caps also count the kept files (MEMORY-PLAN M2), which hold no texture.
        liveBytes: r.bytes - r.keptBytes,
        pendingLoads: r.pending,
        activeTimelines: core.executor.stats().activeTimelines,
        overCap: r.overCap,
        openBitmaps: r.openBitmaps,
        stale: r.stale,
        reviveFailed: r.reviveFailed,
        reviving: core.flow.reviving(),
        ...counters,
        ...core.scheduler.stats(),
        ...core.registry.warmStats(),
        previews: core.registry.previews().length,
      };
    },
    debugForceContextLoss(mode) {
      const r = core?.app.renderer;
      if (r === undefined || !('gl' in r)) {
        return;
      }
      switch (mode) {
        case 'restorable':
          // Pixi restores a forced loss on the next tick (GlContextSystem.handleContextLost); webglcontextrestored follows.
          r.context.forceContextLoss();
          return;
        case 'hard':
          // Neither Pixi (no `_contextLossForced`) nor the browser restores this loss (MEMORY-PLAN 4.A), so `activated`
          // finds the context lost after the grace and rebuilds (D13).
          r.gl.getExtension('WEBGL_lose_context')?.loseContext();
          return;
        default: {
          const unhandled: never = mode;
          throw new Error(`invariant: unhandled context loss mode ${String(unhandled)}`);
        }
      }
    },
    debugPropRects() {
      const c = core;
      if (c === null) {
        return [];
      }
      // The canvas origin in the page plus stage px, unscaled: page px only while the stage is not scaled. Where Q67's
      // phone column scales it, a stage px is k page px (k = the canvas's client width / its layout width), and the e2e
      // converts by k itself.
      const box = c.app.canvas.getBoundingClientRect();
      const x0 = box.left + window.scrollX;
      const y0 = box.top + window.scrollY;
      return c.executor.propRects().map((r) => ({ prop: r.prop, x: x0 + r.x, y: y0 + r.y, w: r.w, h: r.h }));
    },
    destroy() {
      if (state === 'destroyed') {
        return;
      }
      state = 'destroyed';
      pendingManifest = null;
      const c = core;
      core = null;
      if (paused) {
        paused = false;
        resumeAll();
      }
      if (grace !== null) {
        clearTimeout(grace.timer);
        grace.wake();
      }
      if (c === null) {
        return;
      }
      unwatch(c.app.canvas);
      // The revive flow (its revive aborted), executor (timelines, sprites, scene:*), scheduler (preloads, ensure),
      // registry (every texture, bitmap and kept file), render loop, observer, then the Application with its layers.
      c.flow.destroy();
      c.executor.destroy();
      c.scheduler.destroy();
      c.registry.destroy();
      c.loop.destroy();
      c.observer.disconnect();
      c.app.destroy({ removeView: true }, { children: true });
    },
  };
}
