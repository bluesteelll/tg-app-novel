// The staging executor (PROTOTYPE-PLAN "Executor", STAGING-DSL §7): one GSAP timeline per batch in the fixed order
// (scene, then bg / show / hide / cg / props together, then wait), the logical snapshot updated at batch start,
// complete() = progress(1), timelines killed on completion. It drives a StageAdapter (Pixi in controller.ts, a recording
// fake in tests) and takes textures from the registry under one holder per slot (`scene:bg`, `scene:cg`,
// `scene:char:<id>`, `scene:prop:<id>`). The only importer of gsap (arch rule); GSAP core only, plain proxies (K7).
import { gsap } from 'gsap/gsap-core';

import { ROOM_SOURCE } from '../geom/cover.ts';
import type { Box, Size } from '../geom/cover.ts';
import type { ImageEntry, Result } from '../story/catalog.ts';
import type { AssetId, CharId, PropId, PropsCommand, Rect, Slot, StagingCommand, StagingSnapshot } from '../story/staging.ts';
import { backdropPlacement, charPlacement, propPlacement } from './layout.ts';
import type { AssetError, AssetRegistry, TextureHandle } from './registry.ts';
import type { RenderLoop, Ticker } from './render-loop.ts';

/** GSAP's ticker for the render loop: one clock for tweens and frames (K6); tweens update before the frame draws. */
export const gsapTicker: Ticker = {
  add: (fn) => {
    gsap.ticker.add(fn);
  },
  remove: (fn) => {
    gsap.ticker.remove(fn);
  },
};
/** `deactivated` mid-transition: every timeline halts where it is (PP concurrency table). */
export function pauseAll(): void {
  gsap.globalTimeline.pause();
}
/** `activated`: the same timelines continue. */
export function resumeAll(): void {
  gsap.globalTimeline.resume();
}

/** The commands the scene executes; audio and yields stay with GameSession (§7 steps 1 and 5). */
export type VisualCommand =
  | Extract<StagingCommand, { kind: 'bg' | 'scene' | 'show' | 'hide' | 'cg' | 'wait' }>
  | PropsCommand;
export type SceneSnapshot = Omit<StagingSnapshot, 'bgm'>;

/** An adapter-owned sprite; the executor only hands it back. */
export type SpriteRef = { readonly sprite: number };
/** An adapter-owned container for one character's sprites (≤ 2 during an expression swap). */
export type GroupRef = { readonly group: number };
export type Layer = 'bg' | 'props' | 'chars' | 'cg';
/** Stage px. A `chars` sprite is anchored at its bottom centre, every other sprite at its top left; `z` orders groups. */
export type Placement = { x?: number; y?: number; w?: number; h?: number; alpha?: number; z?: number };

/** The stage the executor drives; GSAP tweens plain proxies and writes them through `set` (K7). */
export interface StageAdapter<T> {
  size(): Size;
  group(char: CharId): GroupRef;
  /** Destroys the container; its sprites were destroyed before. */
  dropGroup(g: GroupRef): void;
  /** A new sprite on top of its layer (or of the group); the texture stays the registry's. */
  sprite(layer: Layer, tex: TextureHandle<T>, g?: GroupRef): SpriteRef;
  destroy(s: SpriteRef): void;
  set(target: SpriteRef | GroupRef, p: Placement): void;
  /** The alpha of the full-stage black rect (fade through black). */
  fx(alpha: number): void;
}

export interface Executor<T> {
  /** Resolves when the batch's transitions and wait have ended (or it was completed, or the executor destroyed). */
  apply(b: readonly VisualCommand[], o: { instant: boolean }): Promise<void>;
  /** A tap during a transition: every running batch jumps to its end state. */
  complete(): void;
  /** Sets the stage to `s` instantly (load, chapter change). */
  restore(s: SceneSnapshot): Promise<void>;
  /** The logical stage: the end state of the last batch, from the moment it started. */
  snapshot(): SceneSnapshot;
  /** The stage size changed: a running batch completes, then every visual is placed for the new size. */
  relayout(): void;
  /**
   * A new stage after an unrecoverable context loss: a running batch completes on the old one, whose display objects
   * die with their Application; what the stage showed is re-created instantly on `a`, every holder kept (no load).
   */
  rebind(a: StageAdapter<T>): void;
  /** Stage px boxes of the live prop sprites, in the props command's order (debugPropRects adds the page offset). */
  propRects(): ReadonlyArray<{ prop: PropId } & Box>;
  stats(): { activeTimelines: number };
  /** Kills every timeline, settles every pending apply, destroys every sprite and releases every `scene:*` holder. */
  destroy(): void;
}

export type ExecutorDeps<T> = {
  adapter: StageAdapter<T>;
  registry: AssetRegistry<T>;
  /** An asset id in the current chapter's manifest. */
  resolve(id: AssetId): Result<ImageEntry, AssetError>;
  /** Frames on demand: begin / end around every timeline, requestRender after every instant change. */
  loop: RenderLoop;
  /** The render resolution (characters are never upscaled above source px). */
  resolution: number;
  /** A visual skipped because its texture could not be had: logged by the caller, the story continues. */
  onSkip(e: AssetError): void;
};

// ---------------------------------------------------------------------------------------------------------------
// The logical stage

const EMPTY: SceneSnapshot = Object.freeze({ bg: null, cg: null, chars: Object.freeze([]), props: Object.freeze([]) });

const charSlot = (c: CharId): string => `char:${c}`;
const propSlot = (p: PropId): string => `prop:${p}`;
const holderOf = (slot: string): string => `scene:${slot}`;

/** Slot → asset id of a snapshot (STAGING-DSL §8 ids, as scripts/story/graph.ts maps commands). */
function slotsOf(s: SceneSnapshot): Map<string, AssetId> {
  // The brands are earned upstream: parseTags and the world decoder accept only ids the catalog lists.
  const out = new Map<string, AssetId>();
  if (s.bg !== null) {
    out.set('bg', `bg/${s.bg}` as AssetId);
  }
  if (s.cg !== null) {
    out.set('cg', `cg/${s.cg}` as AssetId);
  }
  for (const c of s.chars) {
    out.set(charSlot(c.char), `char/${c.char}/${c.expr}` as AssetId);
  }
  for (const p of s.props) {
    out.set(propSlot(p.prop), `prop/${p.prop}` as AssetId);
  }
  return out;
}

function find<K extends VisualCommand['kind']>(
  cmds: readonly VisualCommand[],
  kind: K,
): Extract<VisualCommand, { kind: K }> | undefined {
  return cmds.find((c): c is Extract<VisualCommand, { kind: K }> => c.kind === kind);
}

/** The end state of a batch (§7 order): scene clears, bg replaces (and clears props), hides, shows, cg, props. */
function reduce(s: SceneSnapshot, cmds: readonly VisualCommand[]): SceneSnapshot {
  let { bg, cg } = s;
  let chars = [...s.chars];
  let props = [...s.props];
  const scene = find(cmds, 'scene');
  if (scene !== undefined) {
    bg = scene.bg;
    cg = null;
    chars = [];
    props = [];
  }
  const bgCmd = find(cmds, 'bg');
  if (bgCmd !== undefined) {
    bg = bgCmd.bg;
    props = [];
  }
  for (const c of cmds) {
    if (c.kind === 'hide') {
      chars = c.char === 'all' ? [] : chars.filter((x) => x.char !== c.char);
    }
  }
  for (const c of cmds) {
    if (c.kind === 'show') {
      const i = chars.findIndex((x) => x.char === c.char);
      const shown = i >= 0 ? chars[i] : undefined;
      const next = { char: c.char, expr: c.expr, at: c.at ?? shown?.at ?? 'center' };
      if (shown === undefined) {
        chars.push(next);
      } else {
        chars[i] = next;
      }
    }
  }
  const cgCmd = find(cmds, 'cg');
  if (cgCmd !== undefined) {
    cg = cgCmd.cg;
  }
  const propsCmd = find(cmds, 'props');
  if (propsCmd !== undefined) {
    const byProp = new Map(propsCmd.props.map((p) => [p.prop, p]));
    props = [...byProp.values()];
  }
  return { bg, cg, chars, props };
}

const copy = (s: SceneSnapshot): SceneSnapshot => ({ bg: s.bg, cg: s.cg, chars: [...s.chars], props: [...s.props] });
const sameRect = (a: Rect, b: Rect): boolean => a.every((v, i) => v === b[i]);

// ---------------------------------------------------------------------------------------------------------------
// The executor

type Hold<T> = Promise<Result<TextureHandle<T>, AssetError>>;
type View<T> = { readonly slot: string; readonly handle: TextureHandle<T>; readonly sprite: SpriteRef };
type CharView<T> = { readonly char: CharId; readonly group: GroupRef; at: Slot; view: View<T> };
/** `box`: where the sprite was last placed, in stage px (propRects). */
type PropView<T> = View<T> & { readonly prop: PropId; rect: Rect; box: Box };
/** A visual on its way out: destroyed when its transition ends, when its batch finishes, or by destroy(). */
type Retiree<T> = { readonly views: readonly View<T>[]; readonly group: GroupRef | null };
type Timeline = ReturnType<typeof gsap.timeline>;
type Batch<T> = {
  readonly cmds: readonly VisualCommand[];
  readonly target: SceneSnapshot;
  /** The textures this batch takes: slots whose asset id differs from the previous logical stage. */
  readonly takes: ReadonlyMap<string, Hold<T>>;
  instant: boolean;
  tl: Timeline | null;
  finished: boolean;
  readonly done: Promise<void>;
  readonly settle: () => void;
};

export function createExecutor<T>(deps: ExecutorDeps<T>): Executor<T> {
  const { registry, resolve, loop, resolution, onSkip } = deps;
  let adapter = deps.adapter;
  let logical: SceneSnapshot = EMPTY;
  /** holder → asset id → the acquire, for every texture the executor holds (one release per (holder, id)). */
  const holds = new Map<string, Map<AssetId, Hold<T>>>();
  const unfinished: Batch<T>[] = [];
  const active = new Set<Timeline>();
  const retiring = new Set<Retiree<T>>();
  let chain: Promise<void> = Promise.resolve();
  let destroyed = false;
  let fxAlpha = 0;
  // What the stage shows (a skipped visual is absent here while the logical stage names it).
  let bg: View<T> | null = null;
  let cg: View<T> | null = null;
  const chars = new Map<CharId, CharView<T>>();
  const props = new Map<PropId, PropView<T>>();

  const take = (slot: string, id: AssetId): Hold<T> => {
    const holder = holderOf(slot);
    let byId = holds.get(holder);
    if (byId === undefined) {
      byId = new Map();
      holds.set(holder, byId);
    }
    const have = byId.get(id);
    if (have !== undefined) {
      return have;
    }
    const entry = resolve(id);
    const hold: Hold<T> = entry.ok
      ? registry.acquire(id, holder, { entry: entry.value, priority: 'visible' })
      : Promise.resolve(entry);
    byId.set(id, hold);
    return hold;
  };

  const shownViews = (): View<T>[] => {
    const out: View<T>[] = [];
    if (bg !== null) {
      out.push(bg);
    }
    if (cg !== null) {
      out.push(cg);
    }
    for (const cv of chars.values()) {
      out.push(cv.view);
    }
    out.push(...props.values());
    for (const r of retiring) {
      out.push(...r.views);
    }
    return out;
  };

  /**
   * Releases every held (holder, id) that the stage no longer shows and no batch still targets. A slot whose asset id
   * is unchanged is never released, so a command naming the asset already in its slot keeps its texture (critique W1).
   */
  const sweep = (): void => {
    const keep = new Set<string>();
    const add = (slot: string, id: AssetId): void => {
      keep.add(`${holderOf(slot)}\n${id}`);
    };
    for (const [slot, id] of slotsOf(logical)) {
      add(slot, id);
    }
    for (const b of unfinished) {
      for (const [slot, id] of slotsOf(b.target)) {
        add(slot, id);
      }
    }
    for (const v of shownViews()) {
      add(v.slot, v.handle.id);
    }
    for (const [holder, byId] of holds) {
      for (const id of [...byId.keys()]) {
        if (!keep.has(`${holder}\n${id}`)) {
          byId.delete(id);
          registry.release(id, holder);
        }
      }
      if (byId.size === 0) {
        holds.delete(holder);
      }
    }
  };

  /** The sprite only: its texture stays held until sweep() finds the (holder, id) unused. */
  const destroyView = (v: View<T>): void => {
    adapter.destroy(v.sprite);
  };
  const retireNow = (r: Retiree<T>): void => {
    if (!retiring.delete(r)) {
      return;
    }
    for (const v of r.views) {
      destroyView(v);
    }
    if (r.group !== null) {
      adapter.dropGroup(r.group);
    }
  };
  /** Moves visuals off the stage model; the returned function destroys them (once). */
  const retire = (views: readonly View<T>[], group: GroupRef | null): (() => void) => {
    const r: Retiree<T> = { views, group };
    retiring.add(r);
    return () => retireNow(r);
  };

  // Placement in the current stage size (layout.ts): backdrops cover ROOM_SOURCE, props take the same transform.
  const placeBackdrop = (v: View<T>): void => {
    const c = backdropPlacement(adapter.size());
    adapter.set(v.sprite, { x: c.offsetX, y: c.offsetY, w: ROOM_SOURCE.w * c.scale, h: ROOM_SOURCE.h * c.scale });
  };
  const placeProp = (v: PropView<T>): void => {
    v.box = propPlacement(adapter.size(), v.rect);
    adapter.set(v.sprite, v.box);
  };
  const groupAt = (at: Slot, v: View<T>): { x: number; y: number } => {
    const p = charPlacement(adapter.size(), at, v.handle, resolution);
    return { x: p.x, y: p.y };
  };
  const placeCharSprite = (v: View<T>): void => {
    const { h } = charPlacement(adapter.size(), 'center', v.handle, resolution);
    adapter.set(v.sprite, { x: 0, y: 0, w: (h * v.handle.w) / v.handle.h, h });
  };
  const destroyChar = (cv: CharView<T>): void => {
    chars.delete(cv.char);
    destroyView(cv.view);
    adapter.dropGroup(cv.group);
  };
  /** Character groups in the snapshot's z-order (array order). */
  const orderChars = (s: SceneSnapshot): void => {
    s.chars.forEach((c, z) => {
      const cv = chars.get(c.char);
      if (cv !== undefined) {
        adapter.set(cv.group, { z });
      }
    });
  };

  const finish = (b: Batch<T>): void => {
    if (b.finished) {
      return;
    }
    b.finished = true;
    if (b.tl !== null) {
      active.delete(b.tl);
      b.tl.kill();
      b.tl = null;
      loop.end();
    } else {
      loop.requestRender();
    }
    // Batches build one at a time, so whatever still retires belongs to this one.
    for (const r of [...retiring]) {
      retireNow(r);
    }
    const i = unfinished.indexOf(b);
    if (i >= 0) {
      unfinished.splice(i, 1);
    }
    sweep();
    b.settle();
  };

  const build = (b: Batch<T>, got: ReadonlyMap<string, TextureHandle<T>>): void => {
    const tl = gsap.timeline({ paused: true, defaults: { ease: 'none', lazy: false } });
    const target = b.target;
    const want = slotsOf(target);
    const sec = (ms: number): number => (b.instant ? 0 : Math.max(0, ms) / 1000);

    /** Tweens an alpha from → to from t = 0; with no time it is set at once and `onEnd` runs now. */
    const fade = (on: SpriteRef | GroupRef, from: number, to: number, ms: number, onEnd?: () => void): void => {
      const d = sec(ms);
      if (d === 0) {
        adapter.set(on, { alpha: to });
        onEnd?.();
        return;
      }
      adapter.set(on, { alpha: from });
      const p = { a: from };
      tl.to(p, { a: to, duration: d, onUpdate: () => adapter.set(on, { alpha: p.a }), onComplete: onEnd }, 0);
    };
    const move = (g: GroupRef, from: { x: number; y: number }, to: { x: number; y: number }, ms: number): void => {
      const d = sec(ms);
      if (d === 0) {
        adapter.set(g, to);
        return;
      }
      const p = { ...from };
      tl.to(p, { x: to.x, y: to.y, duration: d, ease: 'power1.inOut', onUpdate: () => adapter.set(g, { x: p.x, y: p.y }) }, 0);
    };
    /** Fade through black: black in over ms / 2, `atBlack` while black, black out over ms / 2. */
    const dip = (ms: number, atBlack: () => void): void => {
      const half = sec(ms) / 2;
      if (half === 0) {
        atBlack();
        return;
      }
      const p = { a: fxAlpha };
      const write = (): void => {
        fxAlpha = p.a;
        adapter.fx(p.a);
      };
      tl.to(p, { a: 1, duration: half, onUpdate: write }, 0);
      tl.call(atBlack, undefined, half);
      tl.to(p, { a: 0, duration: half, onUpdate: write }, half);
    };

    const backdrop = (layer: 'bg' | 'cg', h: TextureHandle<T>, alpha: number): View<T> => {
      const v: View<T> = { slot: layer, handle: h, sprite: adapter.sprite(layer, h) };
      placeBackdrop(v);
      adapter.set(v.sprite, { alpha });
      return v;
    };
    const newProp = (p: { prop: PropId; rect: Rect }, h: TextureHandle<T>, alpha: number): void => {
      const v: PropView<T> = {
        slot: propSlot(p.prop),
        handle: h,
        sprite: adapter.sprite('props', h),
        prop: p.prop,
        rect: p.rect,
        box: { x: 0, y: 0, w: 0, h: 0 },
      };
      props.set(p.prop, v);
      placeProp(v);
      adapter.set(v.sprite, { alpha });
    };
    const newChar = (c: CharId, at: Slot, h: TextureHandle<T>, alpha: number): CharView<T> => {
      const group = adapter.group(c);
      const view: View<T> = { slot: charSlot(c), handle: h, sprite: adapter.sprite('chars', h, group) };
      const cv: CharView<T> = { char: c, group, at, view };
      chars.set(c, cv);
      placeCharSprite(view);
      adapter.set(group, { ...groupAt(at, view), alpha });
      return cv;
    };

    /** The background now: kept when the asset is unchanged, else replaced; a missing texture keeps the old one. */
    const swapBg = (): void => {
      const id = want.get('bg') ?? null;
      if ((bg?.handle.id ?? null) === id) {
        return;
      }
      const h = got.get('bg');
      if (id !== null && h === undefined) {
        return;
      }
      if (bg !== null) {
        destroyView(bg);
        bg = null;
      }
      if (h !== undefined) {
        bg = backdrop('bg', h, 1);
      }
    };
    /** Props to the target: kept ids stay (re-placed), removed ones fade out, new ones fade in, over `ms`. */
    const syncProps = (ms: number): void => {
      const wanted = new Map(target.props.map((p) => [p.prop, p]));
      for (const v of [...props.values()]) {
        const w = wanted.get(v.prop);
        if (w === undefined) {
          props.delete(v.prop);
          fade(v.sprite, 1, 0, ms, retire([v], null));
        } else if (!sameRect(w.rect, v.rect)) {
          v.rect = w.rect;
          placeProp(v);
        }
      }
      for (const p of target.props) {
        const h = got.get(propSlot(p.prop));
        if (!props.has(p.prop) && h !== undefined) {
          newProp(p, h, 0);
          const v = props.get(p.prop);
          if (v !== undefined) {
            fade(v.sprite, 0, 1, ms);
          }
        }
      }
    };

    const scene = find(b.cmds, 'scene');
    if (scene !== undefined) {
      // §7 step 2: while black, hide every character, remove the CG and the props, set the bg, apply the shows.
      dip(scene.t === 'cut' ? 0 : scene.ms, () => {
        for (const cv of [...chars.values()]) {
          if (want.get(charSlot(cv.char)) !== cv.view.handle.id) {
            destroyChar(cv);
          }
        }
        if (cg !== null) {
          destroyView(cg);
          cg = null;
        }
        const keptProps = new Set(target.props.map((p) => p.prop));
        for (const v of [...props.values()]) {
          if (!keptProps.has(v.prop)) {
            props.delete(v.prop);
            destroyView(v);
          }
        }
        swapBg();
        for (const c of target.chars) {
          const cv = chars.get(c.char);
          const h = got.get(charSlot(c.char));
          if (cv !== undefined) {
            cv.at = c.at;
            adapter.set(cv.group, { ...groupAt(c.at, cv.view), alpha: 1 });
          } else if (h !== undefined) {
            newChar(c.char, c.at, h, 1);
          }
        }
        syncProps(0);
        orderChars(target);
      });
    } else {
      // §7 step 3: bg, show, hide, cg (and props) start together.
      const bgCmd = find(b.cmds, 'bg');
      if (bgCmd !== undefined && bgCmd.t === 'fade') {
        dip(bgCmd.ms, () => {
          swapBg();
          syncProps(0);
        });
      } else if (bgCmd !== undefined && bgCmd.t === 'crossfade') {
        const id = want.get('bg') ?? null;
        const h = got.get('bg');
        if ((bg?.handle.id ?? null) !== id && h !== undefined) {
          // New over old, never a symmetric fade (K7); the old one is destroyed when the new one is opaque.
          const old = bg;
          bg = backdrop('bg', h, 0);
          fade(bg.sprite, 0, 1, bgCmd.ms, old === null ? undefined : retire([old], null));
        }
        syncProps(bgCmd.ms);
      } else {
        swapBg();
        syncProps(0);
      }

      const hides = b.cmds.filter((c) => c.kind === 'hide');
      for (const cv of [...chars.values()]) {
        if (!want.has(charSlot(cv.char))) {
          const h = hides.find((c) => c.char === 'all' || c.char === cv.char);
          chars.delete(cv.char);
          fade(cv.group, 1, 0, h === undefined || h.t === 'cut' ? 0 : h.ms, retire([cv.view], cv.group));
        }
      }
      for (const c of target.chars) {
        const show = b.cmds.find((x) => x.kind === 'show' && x.char === c.char);
        const ms = (byDefault: number): number => (show?.kind !== 'show' || show.t === 'cut' ? 0 : (show.ms ?? byDefault));
        const cv = chars.get(c.char);
        const id = want.get(charSlot(c.char));
        const h = got.get(charSlot(c.char));
        if (cv === undefined) {
          if (h !== undefined) {
            fade(newChar(c.char, c.at, h, 0).group, 0, 1, ms(300));
          }
          continue;
        }
        const moved = cv.at !== c.at;
        const changed = cv.view.handle.id !== id && h !== undefined;
        const d = ms(moved ? 400 : changed ? 200 : 300);
        if (changed) {
          const old = cv.view;
          cv.view = { slot: old.slot, handle: h, sprite: adapter.sprite('chars', h, cv.group) };
          placeCharSprite(cv.view);
          fade(cv.view.sprite, 0, 1, d, retire([old], null));
        }
        if (moved) {
          const from = groupAt(cv.at, cv.view);
          cv.at = c.at;
          move(cv.group, from, groupAt(c.at, cv.view), d);
        }
      }
      orderChars(target);

      const cgId = want.get('cg') ?? null;
      if ((cg?.handle.id ?? null) !== cgId) {
        const cgCmd = find(b.cmds, 'cg');
        const ms = cgCmd === undefined || cgCmd.t === 'cut' ? 0 : cgCmd.ms;
        const old = cg;
        const h = got.get('cg');
        if (cgId === null && old !== null) {
          cg = null;
          fade(old.sprite, 1, 0, ms, retire([old], null));
        } else if (h !== undefined) {
          cg = backdrop('cg', h, 0);
          fade(cg.sprite, 0, 1, ms, old === null ? undefined : retire([old], null));
        }
      }
    }

    // §7 step 4: the wait pads the same timeline, so complete() ends it too; skip mode and loads ignore it.
    const wait = find(b.cmds, 'wait');
    if (wait !== undefined && !b.instant) {
      tl.to({}, { duration: wait.ms / 1000 }, tl.duration());
    }

    if (tl.duration() === 0) {
      tl.kill();
      finish(b);
      return;
    }
    b.tl = tl;
    active.add(tl);
    loop.begin();
    tl.eventCallback('onComplete', () => finish(b));
    tl.play();
  };

  const run = async (b: Batch<T>): Promise<void> => {
    const got = new Map<string, TextureHandle<T>>();
    for (const [slot, hold] of b.takes) {
      const r = await hold;
      if (r.ok) {
        got.set(slot, r.value);
      } else if (!destroyed && r.error.kind !== 'aborted') {
        onSkip(r.error);
      }
    }
    if (destroyed || b.finished) {
      return;
    }
    build(b, got);
    await b.done;
  };

  const enqueue = (cmds: readonly VisualCommand[], target: SceneSnapshot, instant: boolean): Promise<void> => {
    const before = slotsOf(logical);
    logical = target;
    const takes = new Map<string, Hold<T>>();
    for (const [slot, id] of slotsOf(target)) {
      if (before.get(slot) !== id) {
        takes.set(slot, take(slot, id));
      }
    }
    let settle: () => void = () => {};
    const done = new Promise<void>((r) => {
      settle = r;
    });
    const b: Batch<T> = { cmds, target, takes, instant, tl: null, finished: false, done, settle };
    unfinished.push(b);
    // One batch builds at a time, after the previous one finished (complete() makes that immediate).
    chain = chain
      .then(() => run(b))
      .catch((e: unknown) => {
        // A bug in a build: the batch still settles, so GameSession never waits forever, and later batches run.
        finish(b);
        console.error('scene: batch failed', e);
      });
    return done;
  };

  const complete = (): void => {
    for (const b of [...unfinished]) {
      if (b.tl !== null) {
        b.tl.progress(1);
        finish(b);
      } else {
        b.instant = true;
      }
    }
  };

  return {
    apply(cmds, o) {
      if (destroyed) {
        return Promise.resolve();
      }
      complete();
      return enqueue(cmds, reduce(logical, cmds), o.instant);
    },
    complete,
    restore(s) {
      if (destroyed) {
        return Promise.resolve();
      }
      complete();
      return enqueue([], copy(s), true);
    },
    snapshot() {
      return copy(logical);
    },
    relayout() {
      if (destroyed) {
        return;
      }
      // A running move tweens toward the old stage's coordinates: end it first.
      complete();
      for (const v of [bg, cg]) {
        if (v !== null) {
          placeBackdrop(v);
        }
      }
      for (const cv of chars.values()) {
        placeCharSprite(cv.view);
        adapter.set(cv.group, groupAt(cv.at, cv.view));
      }
      for (const v of props.values()) {
        placeProp(v);
      }
      loop.requestRender();
    },
    rebind(a) {
      if (destroyed) {
        return;
      }
      complete();
      adapter = a;
      fxAlpha = 0;
      // After complete() every visual is at its end state: opaque, at its slot.
      const again = <V extends View<T>>(v: V, layer: Layer, group?: GroupRef): V => {
        const sprite = adapter.sprite(layer, v.handle, group);
        adapter.set(sprite, { alpha: 1 });
        return { ...v, sprite };
      };
      if (bg !== null) {
        bg = again(bg, 'bg');
        placeBackdrop(bg);
      }
      if (cg !== null) {
        cg = again(cg, 'cg');
        placeBackdrop(cg);
      }
      for (const cv of [...chars.values()]) {
        const group = adapter.group(cv.char);
        const view = again(cv.view, 'chars', group);
        chars.set(cv.char, { char: cv.char, group, at: cv.at, view });
        placeCharSprite(view);
        adapter.set(group, { ...groupAt(cv.at, view), alpha: 1 });
      }
      orderChars(logical);
      for (const v of [...props.values()]) {
        const next = again(v, 'props');
        props.set(v.prop, next);
        placeProp(next);
      }
      loop.requestRender();
    },
    propRects() {
      return [...props.values()].map((v) => ({ prop: v.prop, ...v.box }));
    },
    stats() {
      return { activeTimelines: active.size };
    },
    destroy() {
      if (destroyed) {
        return;
      }
      destroyed = true;
      for (const b of unfinished) {
        if (b.tl !== null) {
          b.tl.kill();
          b.tl = null;
          loop.end();
        }
        b.finished = true;
        b.settle();
      }
      unfinished.length = 0;
      active.clear();
      for (const r of [...retiring]) {
        retireNow(r);
      }
      for (const cv of [...chars.values()]) {
        destroyChar(cv);
      }
      for (const v of props.values()) {
        destroyView(v);
      }
      props.clear();
      for (const v of [bg, cg]) {
        if (v !== null) {
          destroyView(v);
        }
      }
      bg = null;
      cg = null;
      registry.releaseHolder('scene:');
      holds.clear();
      logical = EMPTY;
    },
  };
}
