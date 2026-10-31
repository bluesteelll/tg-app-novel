// The scene controller (PROTOTYPE-PLAN "Scene controller and asset registry"): one Pixi Application driven
// imperatively, its layers (bg, props, chars, cg, fx), the Pixi StageAdapter the executor drives, and the wiring of
// registry, loader, scheduler, executor and render loop. It reads staging commands only, never story state
// (principle 7); input belongs to the DOM overlay (`stage.eventMode = 'none'`).
import { Application, Container, Graphics, Sprite } from 'pixi.js';
import type { ApplicationOptions, Texture } from 'pixi.js';

import type { AssetManifest, FetchAsset, Result } from '../story/catalog.ts';
import type { AssetId } from '../story/staging.ts';
import { createExecutor, gsapTicker, pauseAll, resumeAll } from './executor.ts';
import type { Executor, GroupRef, Layer, SceneSnapshot, SpriteRef, StageAdapter, VisualCommand } from './executor.ts';
import { renderResolution } from './layout.ts';
import { createImageLoader, probeAvif } from './loader.ts';
import { ENSURE_HOLDER, createAssetScheduler } from './preload.ts';
import type { AssetScheduler } from './preload.ts';
import { createAssetRegistry } from './registry.ts';
import type { AssetError, AssetRegistry, SceneError } from './registry.ts';
import { createRenderLoop } from './render-loop.ts';
import type { RenderLoop } from './render-loop.ts';

export interface SceneController {
  mount(host: HTMLElement, o: { resolution: number; fetchAsset: FetchAsset }): Promise<Result<void, SceneError>>;
  /** Releases every preload:* holder and every next:* holder except next:<m.chapterId> (F4, F5). */
  setChapter(m: AssetManifest): void;
  /** Resolves after transitions + wait. */
  apply(batch: readonly VisualCommand[], o: { instant: boolean }): Promise<void>;
  /** A tap during a transition. */
  complete(): void;
  /** Instant. */
  restore(s: SceneSnapshot): Promise<void>;
  snapshot(): SceneSnapshot;
  /** Background, cancellable; ids resolve in `from` (the next chapter's manifest, F5) or else the current one. */
  preload(tag: string, ids: readonly AssetId[], from?: AssetManifest): void;
  releasePreload(tag: string): void;
  /** The blocking load of a batch's assets. */
  ensure(ids: readonly AssetId[], signal: AbortSignal): Promise<Result<void, SceneError>>;
  pause(): void;
  resume(): void;
  stats(): { liveTextures: number; liveBytes: number; pendingLoads: number; activeTimelines: number; overCap: number };
  destroy(): void;
}

type Layers = { readonly bg: Container; readonly props: Container; readonly chars: Container; readonly cg: Container; readonly fx: Graphics };
type Mounted = {
  readonly host: HTMLElement;
  readonly app: Application;
  readonly registry: AssetRegistry<Texture>;
  readonly scheduler: AssetScheduler;
  readonly loop: RenderLoop;
  readonly executor: Executor;
  readonly observer: ResizeObserver;
};

const EMPTY: SceneSnapshot = Object.freeze({ bg: null, cg: null, chars: Object.freeze([]), props: Object.freeze([]) });
const fail = (detail: string): { ok: false; error: SceneError } => ({ ok: false, error: { kind: 'mount', detail } });

/** PROTOTYPE-PLAN "Init" [R3 §4.3], plus the accessibility layer off: it would listen for Tab and add DOM nodes. */
function appOptions(host: HTMLElement, resolution: number): Partial<ApplicationOptions> {
  return {
    preference: 'webgl',
    resolution,
    autoDensity: true,
    antialias: false,
    background: '#000000',
    resizeTo: host,
    autoStart: false,
    accessibilityOptions: { enabledByDefault: false, activateOnTab: false },
  };
}

function createLayers(app: Application): Layers {
  const fx = new Graphics().rect(0, 0, 1, 1).fill(0x000000);
  fx.alpha = 0;
  fx.visible = false;
  const layers: Layers = { bg: new Container(), props: new Container(), chars: new Container(), cg: new Container(), fx };
  layers.chars.sortableChildren = true;
  app.stage.eventMode = 'none';
  app.stage.addChild(layers.bg, layers.props, layers.chars, layers.cg, layers.fx);
  return layers;
}

/** The executor's stage over Pixi: every display object it creates is destroyed through destroy / dropGroup. */
function pixiAdapter(app: Application, layers: Layers): StageAdapter<Texture> {
  let n = 0;
  const sprites = new Map<number, Sprite>();
  const groups = new Map<number, Container>();
  const node = (t: SpriteRef | GroupRef): Container | undefined => ('sprite' in t ? sprites.get(t.sprite) : groups.get(t.group));
  return {
    size: () => ({ w: app.screen.width, h: app.screen.height }),
    group(char) {
      n += 1;
      const c = new Container({ label: char });
      layers.chars.addChild(c);
      groups.set(n, c);
      return { group: n };
    },
    dropGroup(g) {
      const c = groups.get(g.group);
      groups.delete(g.group);
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
  let paused = false;

  const onResize = (): void => {
    const c = core;
    if (c === null) {
      return;
    }
    c.app.renderer.resize(c.host.clientWidth, c.host.clientHeight);
    c.loop.requestRender();
  };

  return {
    async mount(host, o) {
      if (state !== 'idle') {
        return fail(`mount while ${state}`);
      }
      state = 'mounting';
      const resolution = renderResolution(o.resolution, 'HIGH');
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
      const registry = createAssetRegistry<Texture>({
        load: createImageLoader({ fetchAsset: o.fetchAsset }),
        variant: avif ? 'avif' : 'webp',
      });
      const scheduler = createAssetScheduler({ registry, onError: report });
      const loop = createRenderLoop({ ticker: gsapTicker, render: () => app.render() });
      const executor = createExecutor<Texture>({
        adapter: pixiAdapter(app, layers),
        registry,
        resolve: (id) => scheduler.resolve(id),
        loop,
        resolution,
        onSkip: report,
      });
      // Telegram changes the host's height without a window resize; Pixi's resizeTo listens to window only.
      const observer = new ResizeObserver(onResize);
      core = { host, app, registry, scheduler, loop, executor, observer };
      observer.observe(host);
      if (pendingManifest !== null) {
        scheduler.setChapter(pendingManifest);
        pendingManifest = null;
      }
      state = 'mounted';
      loop.requestRender();
      return { ok: true, value: undefined };
    },
    setChapter(m) {
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
      const done = core.executor.apply(batch, o);
      // D7: the slot holders are taken by now, so the batch's ensure holder can go.
      core.registry.releaseHolder(ENSURE_HOLDER);
      return done;
    },
    complete() {
      core?.executor.complete();
    },
    restore(s) {
      if (core === null) {
        return Promise.resolve();
      }
      const done = core.executor.restore(s);
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
    ensure(ids, signal) {
      return core === null ? Promise.resolve(fail(`ensure while ${state}`)) : core.scheduler.ensure(ids, signal);
    },
    pause() {
      if (core === null || paused) {
        return;
      }
      paused = true;
      pauseAll();
      core.loop.pause();
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
      if (core === null) {
        return { liveTextures: 0, liveBytes: 0, pendingLoads: 0, activeTimelines: 0, overCap: 0 };
      }
      const r = core.registry.stats();
      return {
        liveTextures: r.live,
        liveBytes: r.bytes,
        pendingLoads: r.pending,
        activeTimelines: core.executor.stats().activeTimelines,
        overCap: r.overCap,
      };
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
      if (c === null) {
        return;
      }
      // Executor (timelines, sprites, scene:*), scheduler (preloads, ensure), registry (every texture and bitmap),
      // render loop, observer, then the Application with its layers.
      c.executor.destroy();
      c.scheduler.destroy();
      c.registry.destroy();
      c.loop.destroy();
      c.observer.disconnect();
      c.app.destroy({ removeView: true }, { children: true });
    },
  };
}
