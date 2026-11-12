// The staging executor (PROTOTYPE-PLAN "Executor", STAGING-DSL §7): one GSAP timeline per batch in the fixed order
// (scene, then bg / show / hide / cg / props together, then wait), the logical snapshot updated at batch start,
// complete() = progress(1), timelines killed on completion. It drives a StageAdapter (Pixi in controller.ts, a recording
// fake in tests) and takes textures from the registry under one holder per slot (`scene:bg`, `scene:cg`,
// `scene:char:<id>`, `scene:prop:<id>`). The only importer of gsap (arch rule); GSAP core only, plain proxies (K7).
import { gsap } from 'gsap/gsap-core';

import { ROOM_SOURCE } from '../geom/cover.ts';
import type { Box, Size } from '../geom/cover.ts';
import type { ImageEntry, Result } from '../story/catalog.ts';
import type { Box as Box4, ShotRig } from '../story/shots.ts';
import type { AssetId, BgId, CharId, ExprId, PropId, PropPlacement, PropsCommand, Rect, Slot, StagingCommand, StagingSnapshot } from '../story/staging.ts';
import { backdropPlacement, charPlacement, propPlacement } from './layout.ts';
import type { AssetError, AssetRegistry, TextureHandle } from './registry.ts';
import type { RenderLoop, Ticker } from './render-loop.ts';
import { faceLayers, facesOf, restFraming, shotSlots } from './shot-view.ts';

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

/**
 * The commands the scene executes; audio, yields and `think` stay with GameSession (§7 steps 1 and 5). `anim` and `fx`
 * are one-shots nothing draws yet (the shots plan's SH8): reduce and compose pass over them.
 */
export type VisualCommand =
  | Extract<StagingCommand, { kind: 'bg' | 'scene' | 'show' | 'hide' | 'cg' | 'wait' | 'face' | 'cam' | 'anim' | 'fx' }>
  | PropsCommand;
export type SceneSnapshot = Omit<StagingSnapshot, 'bgm'>;

/** An adapter-owned sprite; the executor only hands it back. */
export type SpriteRef = { readonly sprite: number };
/** An adapter-owned container: one character's sprites (≤ 2 during an expression swap), or a node of an anchor. */
export type GroupRef = { readonly group: number };
/**
 * One anchor (per-player §6.1, reconcile P2): four nested nodes, each with one writer. `anchor`: the executor
 * (placement, batch fades); `depth`: SH8's parallax; `motion`: SH10's cue tweens (both identity until then); `content`:
 * the art.
 */
export type AnchorRef = { readonly anchor: GroupRef; readonly depth: GroupRef; readonly motion: GroupRef; readonly content: GroupRef };
export type Layer = 'bg' | 'props' | 'chars' | 'cg';
/**
 * Stage px, from the parent's origin. A `chars` sprite is anchored at its bottom centre, every other sprite at its top
 * left; `z` orders a node among its siblings (char groups, prop anchors, the sprites in a `content`).
 */
export type Placement = { x?: number; y?: number; w?: number; h?: number; alpha?: number; z?: number; scale?: number };

/** The stage the executor drives; GSAP tweens plain proxies and writes them through `set` (K7). */
export interface StageAdapter<T> {
  size(): Size;
  group(char: CharId): GroupRef;
  /** A new anchor on top of its layer; its art goes in `content`. */
  anchor(layer: 'bg' | 'props' | 'cg', label: string): AnchorRef;
  /** A new container on top of `parent` (a part of a shot root: a face's expression group, a figure plane). */
  node(parent: GroupRef, label: string): GroupRef;
  /** Destroys the container (a char group, or an anchor with its three inner nodes); its sprites were destroyed before. */
  dropGroup(g: GroupRef): void;
  /** A new sprite on top of its layer (or of the group: a char group, an anchor's `content`); the texture stays the registry's. */
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
   * die with their Application; what the stage showed is re-created instantly on `a`, every holder kept (no load). A
   * view whose record has ended is not re-created: it leaves the stage model, and `reacquire` takes its slot again.
   */
  rebind(a: StageAdapter<T>): void;
  /**
   * After a revive (MEMORY-PLAN M2, section 8 "Identity rule"): takes every shown or retiring view whose record has
   * ended off the stage at once (after complete(), and only when there is one), forgets every hold entry bound to an
   * ended record without a registry release, and takes those slots of the logical stage again in one instant batch.
   * It touches nothing else, so a repeated call is a no-op. Returns void: that batch may queue behind a batch waiting
   * on a fetch, and nothing waits for it.
   */
  reacquire(): void;
  /**
   * Stage px boxes of the live prop sprites in draw order: the props command's anchors, each base then its patches
   * (debugPropRects adds the page offset).
   */
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
  /**
   * A shot chapter's rigs (shots §5.1; null: a legacy chapter, drawn on sprites) and whether new records load the half
   * tier (the overscan's k_dev). Absent: every chapter is legacy.
   */
  shots?: { rigs(): Rigs; half(): boolean };
};
type Rigs = ReadonlyMap<BgId, ShotRig> | null;

// ---------------------------------------------------------------------------------------------------------------
// The logical stage

const EMPTY: SceneSnapshot = Object.freeze({ bg: null, cg: null, chars: Object.freeze([]), props: Object.freeze([]) });

const charSlot = (c: CharId): string => `char:${c}`;
const propSlot = (p: PropId): string => `prop:${p}`;
const holderOf = (slot: string): string => `scene:${slot}`;
const slotOf = (holder: string): string => holder.slice('scene:'.length);

/**
 * Slot → asset id of a snapshot (STAGING-DSL §8 ids, as scripts/story/graph.ts maps commands). On a shot (its bg has a
 * rig) the plate, sheet and face slots are the shot view's (§5.2) and no character has a sprite slot.
 */
function slotsOf(s: SceneSnapshot, rigs: Rigs): Map<string, AssetId> {
  // The brands are earned upstream: parseTags and the world decoder accept only ids the catalog lists.
  const rig = s.bg === null ? undefined : rigs?.get(s.bg);
  const out = rig === undefined ? new Map<string, AssetId>() : shotSlots(rig, s);
  if (rig === undefined && s.bg !== null) {
    out.set('bg', `bg/${s.bg}` as AssetId);
  }
  if (s.cg !== null) {
    out.set('cg', `cg/${s.cg}` as AssetId);
  }
  for (const c of rig === undefined ? s.chars : []) {
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

/**
 * The end state of a batch (§7 order): scene clears, bg replaces (and clears props), hides, shows, faces, cam, cg,
 * props. The camera holds until the next cut: a scene or a bg resets it to rest, the absent key (a stage without a
 * move stays byte-identical in snapshots and saves); then the batch's cam sets it, a pull back to rest. On a shot
 * chapter (`shot`) `chars` holds the faces: a face sets its character's expression, on stage or not (STAGING-DSL §14.2).
 */
export function reduce(s: SceneSnapshot, cmds: readonly VisualCommand[], shot = false): SceneSnapshot {
  let { bg, cg, cam } = s;
  let chars = [...s.chars];
  let props = [...s.props];
  const scene = find(cmds, 'scene');
  if (scene !== undefined) {
    bg = scene.bg;
    cg = null;
    chars = [];
    props = [];
    cam = undefined;
  }
  const bgCmd = find(cmds, 'bg');
  if (bgCmd !== undefined) {
    bg = bgCmd.bg;
    props = [];
    cam = undefined;
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
  // Shots plan §3.1 step 3: a face changes the expression of a character on stage (slot and z-order kept); a face
  // of a character not on stage changes nothing, except on a shot chapter, where it adds the face.
  for (const c of cmds) {
    if (c.kind === 'face') {
      const on = chars.some((x) => x.char === c.char);
      chars = on || !shot ? chars.map((x) => (x.char === c.char ? { ...x, expr: c.expr } : x)) : [...chars, { char: c.char, expr: c.expr, at: 'center' }];
    }
  }
  const camCmd = find(cmds, 'cam');
  if (camCmd !== undefined) {
    cam = camCmd.cam.kind === 'pull' ? undefined : camCmd.cam;
  }
  const cgCmd = find(cmds, 'cg');
  if (cgCmd !== undefined) {
    cg = cgCmd.cg;
  }
  const propsCmd = find(cmds, 'props');
  if (propsCmd !== undefined) {
    // Keyed by anchor and prop (RULINGS 245 Q8): one prop id at two anchors is two placements, and a base and its
    // patches share their anchor's key.
    const byAnchor = new Map(propsCmd.props.map((p) => [`${p.at ?? p.prop}\n${p.prop}`, p]));
    props = [...byAnchor.values()];
  }
  return { bg, cg, chars, props, ...(cam && { cam }) };
}

/** A snapshot's own copy; the camera key only when it is set, so a restore and every snapshot keep it as read. */
const copy = (s: SceneSnapshot): SceneSnapshot => ({
  bg: s.bg,
  cg: s.cg,
  chars: [...s.chars],
  props: [...s.props],
  ...(s.cam && { cam: s.cam }),
});

// ---------------------------------------------------------------------------------------------------------------
// The executor

type Hold<T> = Promise<Result<TextureHandle<T>, AssetError>>;
/**
 * A hold entry: the acquire, and the handle of the record it is bound to (identity rule item 2): the live record `take`
 * joined, read by `registry.current` right after the acquire, else the handle the acquire resolved with; null until
 * then, and for a take that could not acquire.
 */
type Held<T> = { readonly hold: Hold<T>; bound: TextureHandle<T> | null };
type View<T> = { readonly slot: string; readonly handle: TextureHandle<T>; readonly sprite: SpriteRef };
/**
 * A part of a shot root (shots §5.1): a face's expression group (`expr`) or a member's figure plane (null), one node
 * over the plate whose sprites draw frames of the records their views hold (the sheet, the face file).
 */
type Part<T> = { readonly char: CharId; readonly expr: ExprId | null; readonly group: GroupRef; readonly views: readonly View<T>[] };
/** A bg or a CG in its own anchor (a crossfade holds two); a shot's bg is its root, with its parts by key. */
type BackdropView<T> = View<T> & { readonly node: AnchorRef; readonly shot?: { readonly rig: ShotRig; readonly parts: Map<string, Part<T>> } };
/** The slot's live handle for a shot part, or undefined (its record is not live: the part is not drawn). */
type HandleOf<T> = (slot: string) => TextureHandle<T> | undefined;
type Fade = (on: GroupRef, from: number, to: number, ms: number, onEnd?: () => void) => void;
type CharView<T> = { readonly char: CharId; readonly group: GroupRef; at: Slot; view: View<T> };
/** `box`: where the sprite was last placed, in stage px (propRects). */
type PropView<T> = View<T> & { readonly prop: PropId; readonly part: 'base' | 'patch'; rect: Rect; box: Box };
/**
 * Props at one anchor key (`at`, else the prop: E-P1). `rect`: the rect it was created for, its origin for life;
 * `views`: its art in `content` order, the base under its patches.
 */
type PropAnchor<T> = { readonly node: AnchorRef; readonly rect: Rect; views: PropView<T>[] };
/** A visual on its way out: destroyed when its transition ends, when its batch finishes, or by destroy(). */
type Retiree<T> = { readonly views: readonly View<T>[]; readonly group: GroupRef | null };
type Timeline = ReturnType<typeof gsap.timeline>;
type Batch<T> = {
  readonly cmds: readonly VisualCommand[];
  readonly target: SceneSnapshot;
  /** The rigs the batch was reduced under, so it builds with them across a setChapter. */
  readonly rigs: Rigs;
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
  /** The rigs `logical` was reduced under. */
  let logicalRigs: Rigs = null;
  /** holder → asset id → the acquire, for every texture the executor holds (one release per (holder, id)). */
  const holds = new Map<string, Map<AssetId, Held<T>>>();
  const unfinished: Batch<T>[] = [];
  const active = new Set<Timeline>();
  const retiring = new Set<Retiree<T>>();
  let chain: Promise<void> = Promise.resolve();
  let destroyed = false;
  let fxAlpha = 0;
  // What the stage shows (a skipped visual is absent here while the logical stage names it).
  let bg: BackdropView<T> | null = null;
  let cg: BackdropView<T> | null = null;
  const chars = new Map<CharId, CharView<T>>();
  /** Prop anchors by key, in the last props command's order (E-P7): every pass over them walks the draw order. */
  const anchors = new Map<string, PropAnchor<T>>();

  /** The record behind `h` has ended (failed its revive): the registry no longer names this handle (identity rule). */
  const ended = (h: TextureHandle<T>): boolean => registry.current(h.id) !== h;
  const deadBound = (held: Held<T>): boolean => held.bound !== null && ended(held.bound);

  const take = (slot: string, id: AssetId): Hold<T> => {
    const holder = holderOf(slot);
    let byId = holds.get(holder);
    if (byId === undefined) {
      byId = new Map();
      holds.set(holder, byId);
    }
    const have = byId.get(id);
    if (have !== undefined) {
      return have.hold;
    }
    const entry = resolve(id);
    if (!entry.ok) {
      byId.set(id, { hold: Promise.resolve(entry), bound: null });
      return Promise.resolve(entry);
    }
    const hold = registry.acquire(id, holder, { entry: entry.value, priority: 'visible' });
    const held: Held<T> = { hold, bound: registry.current(id) };
    void hold.then((r) => {
      if (r.ok && held.bound === null) {
        held.bound = r.value;
      }
    });
    byId.set(id, held);
    return hold;
  };
  /**
   * Takes a slot for a batch. A talk file is motion (SH7 draws it), never awaited (shots §5.2): it is held under its
   * `scene:talk:<c>` holder from the batch on, and kept out of `takes`, so its load never delays a line.
   */
  const takeFor = (takes: Map<string, Hold<T>>, slot: string, id: AssetId): void => {
    const hold = take(slot, id);
    if (!slot.startsWith('talk:')) {
      takes.set(slot, hold);
    }
  };

  /** A shot root's part views (none for a legacy backdrop). */
  const partViews = (v: BackdropView<T>): View<T>[] => [...(v.shot?.parts.values() ?? [])].flatMap((p) => p.views);
  const shownViews = (): View<T>[] => {
    const out: View<T>[] = [];
    if (bg !== null) {
      out.push(bg, ...partViews(bg));
    }
    if (cg !== null) {
      out.push(cg);
    }
    for (const cv of chars.values()) {
      out.push(cv.view);
    }
    for (const a of anchors.values()) {
      out.push(...a.views);
    }
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
    for (const [slot, id] of slotsOf(logical, logicalRigs)) {
      add(slot, id);
    }
    for (const b of unfinished) {
      for (const [slot, id] of slotsOf(b.target, b.rigs)) {
        add(slot, id);
      }
    }
    for (const v of shownViews()) {
      add(v.slot, v.handle.id);
    }
    for (const [holder, byId] of holds) {
      for (const [id, held] of [...byId]) {
        if (!keep.has(`${holder}\n${id}`)) {
          byId.delete(id);
          // An entry bound to an ended record holds nothing; a release by id would act on a newer record of the id.
          if (!deadBound(held)) {
            registry.release(id, holder);
          }
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
  /** A part's sprites, then its node. */
  const destroyPart = (p: Part<T>): void => {
    p.views.forEach(destroyView);
    adapter.dropGroup(p.group);
  };
  /** A shot root's parts first, then the sprite, then its anchor (dropGroup's order). */
  const destroyBackdrop = (v: BackdropView<T>): void => {
    v.shot?.parts.forEach(destroyPart);
    v.shot?.parts.clear();
    destroyView(v);
    adapter.dropGroup(v.node.anchor);
  };
  /** Its sprites, then the anchor. */
  const destroyAnchor = (a: PropAnchor<T>): void => {
    a.views.forEach(destroyView);
    adapter.dropGroup(a.node.anchor);
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
  /** A backdrop with its shot's parts (each part before the root, so no node is dropped over a live sprite). */
  const retireBackdrop = (v: BackdropView<T>): (() => void) => {
    const parts = [...(v.shot?.parts.values() ?? [])].map((p) => retire(p.views, p.group));
    const root = retire([v], v.node.anchor);
    return () => {
      parts.forEach((f) => f());
      root();
    };
  };

  // Placement in the current stage size (layout.ts): backdrops cover ROOM_SOURCE, props take the same transform. An
  // anchor sits at its art's origin and the art at (0, 0) of `content` with its size, so the art's box is unchanged. A
  // shot root's anchor sits at the rest framing, scaled, over its plate and parts in plate px (shots §5.1).
  const placeBackdrop = (v: BackdropView<T>): void => {
    const rig = v.shot?.rig;
    if (rig !== undefined) {
      const f = restFraming(rig, adapter.size(), resolution, deps.shots?.half() ?? false);
      adapter.set(v.node.anchor, { x: f.x, y: f.y, scale: f.k });
      adapter.set(v.sprite, { w: rig.w, h: rig.h });
      return;
    }
    const c = backdropPlacement(adapter.size());
    adapter.set(v.node.anchor, { x: c.offsetX, y: c.offsetY });
    adapter.set(v.sprite, { w: ROOM_SOURCE.w * c.scale, h: ROOM_SOURCE.h * c.scale });
  };
  /**
   * One part of a shot root (shots §5.1): `char`'s figure plane (`expr` null), or its expression group at `expr` (the
   * layer, then the member's hair locks: `faceLayers`, so only that expression's own set, RULINGS 273 O2), on top of the
   * root's content at its member's z. Each sprite draws a frame of the record its slot holds, sized to its plate box;
   * the view keeps the record's handle (identity rule). Undefined when the face file is not live (no live record, or
   * the slot's record is another file than the member's) or nothing is drawn.
   */
  const part = (root: BackdropView<T>, rig: ShotRig, char: CharId, expr: ExprId | null, handleOf: HandleOf<T>): Part<T> | undefined => {
    const drawn: Array<{ slot: string; h: TextureHandle<T>; frame: T; at: Box4 }> = [];
    for (const p of faceLayers(rig, new Map(expr === null ? [] : [[char, expr]]))) {
      if (p.char !== char || (p.kind === 'figure') !== (expr === null)) {
        continue;
      }
      const slot = p.kind === 'layer' ? `face:${char}` : 'sheet';
      // The slot resolves for the target's shot; a kept root (its new plate failed) is another shot, whose member
      // file is not the one held, so it is not live here: the face is drawn at rest (review r1 I1).
      const held = handleOf(slot);
      const h = held !== undefined && held.id === p.file ? held : undefined;
      const f = h === undefined ? null : registry.frames(h, [p.frame]);
      const frame = f?.ok === true ? f.value[0] : undefined;
      // A face state whose face file or sheet failed is drawn at rest: a layer without its hair locks is no face.
      if (h === undefined || frame === undefined) {
        return undefined;
      }
      drawn.push({ slot, h, frame, at: p.at });
    }
    if (drawn.length === 0) {
      return undefined;
    }
    const group = adapter.node(root.node.content, expr === null ? `figure:${char}` : `face:${char}`);
    const views: View<T>[] = [];
    try {
      for (const d of drawn) {
        const [x, y, w, ht] = d.at;
        const sprite = adapter.sprite('bg', { id: d.h.id, texture: d.frame, w, h: ht }, group);
        views.push({ slot: d.slot, handle: d.h, sprite });
        adapter.set(sprite, { x, y, w, h: ht });
      }
    } catch (e) {
      destroyPart({ char, expr, group, views });
      throw e;
    }
    // Members back to front; a figure plane under its member's face.
    adapter.set(group, { z: 2 * rig.cast.findIndex((m) => m.char === char) + (expr === null ? 1 : 2) });
    return { char, expr, group, views };
  };
  /**
   * A shot root's parts to `faces` (K7): a missing figure plane is drawn; per face whose expression changed, the new
   * group fades in over the old one, which retires whole at the fade's end; a face back to its rest (the plate shows
   * it) or whose file is not live fades its group out. Only a changed face's groups are touched.
   */
  const drawFaces = (v: BackdropView<T>, faces: ReadonlyMap<CharId, ExprId>, handleOf: HandleOf<T>, fade: Fade, msOf: (c: CharId) => number): void => {
    const shot = v.shot;
    if (shot === undefined) {
      return;
    }
    for (const m of shot.rig.cast) {
      const fig = `figure:${m.char}`;
      const plane = m.figure === null || shot.parts.has(fig) ? undefined : part(v, shot.rig, m.char, null, handleOf);
      if (plane !== undefined) {
        shot.parts.set(fig, plane);
      }
      const key = `face:${m.char}`;
      const old = shot.parts.get(key);
      const want = faces.get(m.char);
      const x = m.face !== null && want !== undefined && want !== m.face.rest && Object.hasOwn(m.face.exprs, want) ? want : null;
      if ((old?.expr ?? null) === x) {
        continue;
      }
      const next = x === null ? undefined : part(v, shot.rig, m.char, x, handleOf);
      const out = old === undefined ? undefined : retire(old.views, old.group);
      if (next !== undefined) {
        shot.parts.set(key, next);
        fade(next.group, 0, 1, msOf(m.char), out);
      } else if (old !== undefined) {
        shot.parts.delete(key);
        fade(old.group, 1, 0, msOf(m.char), out);
      }
    }
  };
  const setNow: Fade = (on, _from, to, _ms, onEnd) => {
    adapter.set(on, { alpha: to });
    onEnd?.();
  };
  /**
   * A bg or a CG: its anchor on top of the layer, at `alpha`, then the art in its `content`; a shot's root also draws its
   * parts for `shot.faces`. A sprite that throws takes its fresh anchor (and the root's parts) with it, so a failed build
   * leaves no anchor in the layer (the shots plan's SH1 item 2 (b)).
   */
  const backdrop = (
    layer: 'bg' | 'cg',
    h: TextureHandle<T>,
    alpha: number,
    shot?: { rig: ShotRig; faces: ReadonlyMap<CharId, ExprId>; handleOf: HandleOf<T> },
  ): BackdropView<T> => {
    const node = adapter.anchor(layer, h.id);
    let sprite: SpriteRef;
    try {
      sprite = adapter.sprite(layer, h, node.content);
    } catch (e) {
      adapter.dropGroup(node.anchor);
      throw e;
    }
    const v: BackdropView<T> = { slot: layer, handle: h, node, sprite, ...(shot && { shot: { rig: shot.rig, parts: new Map() } }) };
    try {
      if (shot !== undefined) {
        drawFaces(v, shot.faces, shot.handleOf, setNow, () => 0);
      }
    } catch (e) {
      destroyBackdrop(v);
      throw e;
    }
    placeBackdrop(v);
    adapter.set(node.anchor, { alpha });
    return v;
  };
  /** A prop anchor at its rect's box origin; each of its sprites at its own box minus that origin, with its box size. */
  const placeAnchor = (a: PropAnchor<T>): void => {
    const o = propPlacement(adapter.size(), a.rect);
    adapter.set(a.node.anchor, { x: o.x, y: o.y });
    for (const v of a.views) {
      v.box = propPlacement(adapter.size(), v.rect);
      adapter.set(v.sprite, { ...v.box, x: v.box.x - o.x, y: v.box.y - o.y });
    }
  };
  /** E-P7: prop anchors in the map's (the command's) order; in each `content`, the base at 0 and patch i at 2 + i. */
  const orderProps = (): void => {
    [...anchors.values()].forEach((a, z) => {
      adapter.set(a.node.anchor, { z });
      let patch = 2;
      for (const v of a.views) {
        adapter.set(v.sprite, { z: v.part === 'base' ? 0 : patch++ });
      }
    });
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

  /** Builds the batch's stage changes on `tl` and hands it to the batch (or ends the batch when it has no time). */
  const compose = (b: Batch<T>, got: ReadonlyMap<string, TextureHandle<T>>, tl: Timeline): void => {
    const target = b.target;
    const want = slotsOf(target, b.rigs);
    const sec = (ms: number): number => (b.instant ? 0 : Math.max(0, ms) / 1000);
    /**
     * The batch's handle for a slot only while its record is live, read in the same step as the sprite it makes,
     * also at a fade's midpoint (identity rule item 1). Else the slot is built as a skipped visual.
     */
    const handleFor = (slot: string): TextureHandle<T> | undefined => {
      const h = got.get(slot);
      return h === undefined || ended(h) ? undefined : h;
    };
    /** A shot part's slot: the batch's take, else the live record an earlier batch's take holds for the target's id. */
    const shotHandle: HandleOf<T> = (slot) => {
      const id = want.get(slot);
      const h = handleFor(slot) ?? (id === undefined ? null : holds.get(holderOf(slot))?.get(id)?.bound);
      return h === null || h === undefined || ended(h) ? undefined : h;
    };
    /** The target's shot, when its bg has a rig: the root draws its faces. */
    const shotOf = (): Parameters<typeof backdrop>[3] => {
      const rig = target.bg === null ? undefined : b.rigs?.get(target.bg);
      return rig && { rig, faces: facesOf(target), handleOf: shotHandle };
    };
    /** The faces of the shot on stage to the target's, over each face command's time (200 ms by default). */
    const syncFaces = (now = false): void => {
      if (bg !== null) {
        const msOf = (c: CharId): number =>
          now ? 0 : (b.cmds.find((x): x is Extract<VisualCommand, { kind: 'face' }> => x.kind === 'face' && x.char === c)?.ms ?? 200);
        drawFaces(bg, facesOf(target), shotHandle, fade, msOf);
      }
    };

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

    /** A sprite that throws takes its fresh group with it (backdrop's rule; SH1 cut Q5). */
    const newChar = (c: CharId, at: Slot, h: TextureHandle<T>, alpha: number): CharView<T> => {
      const group = adapter.group(c);
      let sprite: SpriteRef;
      try {
        sprite = adapter.sprite('chars', h, group);
      } catch (e) {
        adapter.dropGroup(group);
        throw e;
      }
      const view: View<T> = { slot: charSlot(c), handle: h, sprite };
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
      const h = handleFor('bg');
      if (id !== null && h === undefined) {
        return;
      }
      if (bg !== null) {
        destroyBackdrop(bg);
        bg = null;
      }
      if (h !== undefined) {
        bg = backdrop('bg', h, 1, shotOf());
      }
    };
    /**
     * Props to the target over `ms` (§6.1, E-P1, E-P7), its placements grouped by anchor key in the command's order.
     * A key with no anchor takes over an anchor that shows one of its props, when the target does not name that
     * anchor's key: re-keyed, not faded (a format-1 save's at-less keys against the room's `at`, either way). An anchor
     * the target does not name, or with nothing it can show, fades out whole; in a kept anchor a view whose prop is gone
     * fades out (an old base over the new one), a new base goes under the old one and a new patch fades in above it; a
     * new anchor fades in with its art.
     */
    const syncProps = (ms: number): void => {
      // A prop shown now keeps its live record wherever it moves: into an anchor the target names, or out of one to its
      // own key, it is drawn at the new key in this batch without a take (RULINGS 245 Q8, GM6a cut deviation 5).
      const shown = new Map<PropId, TextureHandle<T>>();
      for (const a of anchors.values()) {
        for (const v of a.views) {
          if (!ended(v.handle)) {
            shown.set(v.prop, v.handle);
          }
        }
      }
      const propHandle = (p: PropId): TextureHandle<T> | undefined => handleFor(propSlot(p)) ?? shown.get(p);
      const byKey = new Map<string, PropPlacement[]>();
      for (const p of target.props) {
        byKey.set(p.at ?? p.prop, [...(byKey.get(p.at ?? p.prop) ?? []), p]);
      }
      for (const [k, ps] of byKey) {
        for (const [j, a] of [...anchors]) {
          if (!anchors.has(k) && !byKey.has(j) && a.views.some((v) => ps.some((p) => p.prop === v.prop))) {
            anchors.delete(j);
            anchors.set(k, a);
          }
        }
      }
      /** Shown in `a`, or its texture is here. */
      const can = (a: PropAnchor<T> | undefined, p: PropPlacement): boolean =>
        a?.views.some((v) => v.prop === p.prop) === true || propHandle(p.prop) !== undefined;
      for (const [k, a] of [...anchors]) {
        if (!(byKey.get(k) ?? []).some((p) => can(a, p))) {
          anchors.delete(k);
          fade(a.node.anchor, 1, 0, ms, retire(a.views, a.node.anchor));
        }
      }
      const next: Array<[string, PropAnchor<T>]> = [];
      // What this pass makes, for the unmake when a sprite throws (the shots plan's SH1 item 2 (b), RULINGS 198 W2).
      const made: PropView<T>[] = [];
      const fresh: AnchorRef[] = [];
      try {
        for (const [k, ps] of byKey) {
          const kept = anchors.get(k);
          const live = ps.filter((p) => can(kept, p));
          const first = live.find((p) => p.part !== 'patch') ?? live[0];
          if (first === undefined) {
            continue;
          }
          const a: PropAnchor<T> = kept ?? { node: adapter.anchor('props', k), rect: first.rect, views: [] };
          if (kept === undefined) {
            fresh.push(a.node);
          }
          let baseLeaves = false;
          const views: PropView<T>[] = [];
          for (const v of a.views) {
            const p = ps.find((x) => x.prop === v.prop);
            if (p === undefined) {
              if (v.part === 'base') {
                baseLeaves = true;
                adapter.set(v.sprite, { z: 1 });
              }
              fade(v.sprite, 1, 0, ms, retire([v], null));
            } else {
              v.rect = p.rect;
              views.push(v);
            }
          }
          // A leaving view is retiring now: if a sprite below throws, the anchor must not track it once it is destroyed
          // (critique r2 W1, RULINGS 200).
          a.views = [...views];
          for (const p of live) {
            const h = propHandle(p.prop);
            if (h !== undefined && !views.some((v) => v.prop === p.prop)) {
              const v: PropView<T> = {
                slot: propSlot(p.prop),
                handle: h,
                sprite: adapter.sprite('props', h, a.node.content),
                prop: p.prop,
                part: p.part ?? 'base',
                rect: p.rect,
                box: propPlacement(adapter.size(), p.rect),
              };
              views.push(v);
              made.push(v);
              if (kept !== undefined && (v.part === 'patch' || !baseLeaves)) {
                fade(v.sprite, 0, 1, ms);
              }
            }
          }
          a.views = [...views.filter((v) => v.part === 'base'), ...views.filter((v) => v.part === 'patch')];
          if (kept === undefined) {
            fade(a.node.anchor, 0, 1, ms);
          }
          next.push([k, a]);
        }
      } catch (e) {
        // A sprite this pass made that no anchor still in `anchors` tracks is destroyed, then every anchor it made is
        // dropped; a kept anchor keeps the views assigned to it. The views it retired go at finish().
        const tracked = new Set([...anchors.values()].flatMap((a) => a.views));
        made.filter((v) => !tracked.has(v)).forEach(destroyView);
        fresh.forEach((n) => adapter.dropGroup(n.anchor));
        throw e;
      }
      anchors.clear();
      for (const [k, a] of next) {
        anchors.set(k, a);
        placeAnchor(a);
      }
      orderProps();
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
          destroyBackdrop(cg);
          cg = null;
        }
        const keptProps = new Set<string>(target.props.map((p) => p.at ?? p.prop));
        for (const [k, a] of [...anchors]) {
          if (!keptProps.has(k)) {
            anchors.delete(k);
            destroyAnchor(a);
          }
        }
        swapBg();
        syncFaces(true);
        for (const c of target.chars) {
          const cv = chars.get(c.char);
          const h = handleFor(charSlot(c.char));
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
          syncFaces(true);
          syncProps(0);
        });
      } else if (bgCmd !== undefined && bgCmd.t === 'crossfade') {
        const id = want.get('bg') ?? null;
        const h = handleFor('bg');
        if ((bg?.handle.id ?? null) !== id && h !== undefined) {
          // New over old, never a symmetric fade (K7); the old one is destroyed when the new one is opaque. Another
          // shot is the dissolve's fallback: the new root over the old, which retires whole (shots §5.5).
          const old = bg;
          bg = backdrop('bg', h, 0, shotOf());
          fade(bg.node.anchor, 0, 1, bgCmd.ms, old === null ? undefined : retireBackdrop(old));
        }
        syncFaces();
        syncProps(bgCmd.ms);
      } else {
        swapBg();
        syncFaces();
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
        // A face is a show without `at` or `t`: the expression crossfade, 200 ms by default. A show of the same
        // character in the batch governs the timing (SH1 review M2); the state keeps §7's order (reduce).
        const of = (kind: 'show' | 'face'): Extract<VisualCommand, { kind: 'show' | 'face' }> | undefined =>
          b.cmds.find((x): x is Extract<VisualCommand, { kind: 'show' | 'face' }> => (x.kind === 'show' || x.kind === 'face') && x.kind === kind && x.char === c.char);
        const show = of('show') ?? of('face');
        const ms = (byDefault: number): number => (show === undefined || (show.kind === 'show' && show.t === 'cut') ? 0 : (show.ms ?? byDefault));
        const cv = chars.get(c.char);
        const id = want.get(charSlot(c.char));
        const h = handleFor(charSlot(c.char));
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
        const h = handleFor('cg');
        if (cgId === null && old !== null) {
          cg = null;
          fade(old.node.anchor, 1, 0, ms, retire([old], old.node.anchor));
        } else if (h !== undefined) {
          cg = backdrop('cg', h, 0);
          fade(cg.node.anchor, 0, 1, ms, old === null ? undefined : retire([old], old.node.anchor));
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
  const build = (b: Batch<T>, got: ReadonlyMap<string, TextureHandle<T>>): void => {
    const tl = gsap.timeline({ paused: true, defaults: { ease: 'none', lazy: false } });
    try {
      compose(b, got, tl);
    } catch (e) {
      // A paused timeline stays in gsap's root timeline until killed; once the batch holds it, finish() kills it.
      if (b.tl !== tl) {
        tl.kill();
      }
      throw e;
    }
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

  /** Chains a batch with the textures it takes. */
  const queue = (cmds: readonly VisualCommand[], target: SceneSnapshot, instant: boolean, takes: ReadonlyMap<string, Hold<T>>, rigs: Rigs): Promise<void> => {
    let settle: () => void = () => {};
    const done = new Promise<void>((r) => {
      settle = r;
    });
    const b: Batch<T> = { cmds, target, rigs, takes, instant, tl: null, finished: false, done, settle };
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

  const enqueue = (cmds: readonly VisualCommand[], target: SceneSnapshot, instant: boolean, rigs: Rigs): Promise<void> => {
    const before = slotsOf(logical, logicalRigs);
    logical = target;
    logicalRigs = rigs;
    const takes = new Map<string, Hold<T>>();
    for (const [slot, id] of slotsOf(target, rigs)) {
      if (before.get(slot) !== id) {
        takeFor(takes, slot, id);
      }
    }
    return queue(cmds, target, instant, takes, rigs);
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
      const rigs = deps.shots?.rigs() ?? null;
      return enqueue(cmds, reduce(logical, cmds, rigs !== null), o.instant, rigs);
    },
    complete,
    restore(s) {
      if (destroyed) {
        return Promise.resolve();
      }
      complete();
      return enqueue([], copy(s), true, deps.shots?.rigs() ?? null);
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
      for (const a of anchors.values()) {
        placeAnchor(a);
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
      // After complete() every visual is at its end state: opaque, at its slot. A view whose record ended is not
      // re-created (identity rule item 1); reacquire() takes its slot again.
      const again = <V extends View<T>>(v: V, layer: Layer, group?: GroupRef): V => {
        const sprite = adapter.sprite(layer, v.handle, group);
        adapter.set(sprite, { alpha: 1 });
        return { ...v, sprite };
      };
      // Each view's anchor first, then its art in it.
      if (bg !== null) {
        // A shot root again with its parts, from the frames its records keep (no load); a part whose record ended is not.
        const old = bg;
        const views = partViews(old);
        const handleOf: HandleOf<T> = (slot) => views.find((v) => v.slot === slot && !ended(v.handle))?.handle;
        const faces = new Map([...(old.shot?.parts.values() ?? [])].flatMap((p) => (p.expr === null ? [] : [[p.char, p.expr] as const])));
        bg = ended(old.handle) ? null : backdrop('bg', old.handle, 1, old.shot && { rig: old.shot.rig, faces, handleOf });
      }
      if (cg !== null) {
        cg = ended(cg.handle) ? null : backdrop('cg', cg.handle, 1);
      }
      for (const cv of [...chars.values()]) {
        if (ended(cv.view.handle)) {
          chars.delete(cv.char);
          continue;
        }
        const group = adapter.group(cv.char);
        const view = again(cv.view, 'chars', group);
        chars.set(cv.char, { char: cv.char, group, at: cv.at, view });
        placeCharSprite(view);
        adapter.set(group, { ...groupAt(cv.at, view), alpha: 1 });
      }
      orderChars(logical);
      // In the map's order, the command's: the new stage draws them in the same order, and keeps their z.
      for (const [k, p] of [...anchors]) {
        const views = p.views.filter((v) => !ended(v.handle));
        if (views.length === 0) {
          anchors.delete(k);
          continue;
        }
        const node = adapter.anchor('props', k);
        // A sprite that throws takes the sprites made before it and the fresh anchor with it (SH1 cut Q5).
        const made: PropView<T>[] = [];
        try {
          for (const v of views) {
            made.push({ ...v, sprite: adapter.sprite('props', v.handle, node.content) });
          }
        } catch (e) {
          made.forEach(destroyView);
          adapter.dropGroup(node.anchor);
          throw e;
        }
        const next: PropAnchor<T> = { node, rect: p.rect, views: made };
        anchors.set(k, next);
        placeAnchor(next);
        adapter.set(node.anchor, { alpha: 1 });
      }
      orderProps();
      loop.requestRender();
    },
    reacquire() {
      if (destroyed) {
        return;
      }
      if (shownViews().some((v) => ended(v.handle))) {
        // No transition may write to a view after it is gone: every running batch ends first (its retirees with it).
        complete();
        if (bg !== null && ended(bg.handle)) {
          destroyBackdrop(bg);
          bg = null;
        }
        // A shot part over an ended record leaves the root; the re-take below draws it again.
        for (const [k, p] of [...(bg?.shot?.parts ?? [])]) {
          if (p.views.some((v) => ended(v.handle))) {
            destroyPart(p);
            bg?.shot?.parts.delete(k);
          }
        }
        if (cg !== null && ended(cg.handle)) {
          destroyBackdrop(cg);
          cg = null;
        }
        for (const cv of [...chars.values()]) {
          if (ended(cv.view.handle)) {
            destroyChar(cv);
          }
        }
        // An ended view leaves its anchor; an anchor left empty is dropped.
        for (const [k, a] of [...anchors]) {
          a.views.filter((v) => ended(v.handle)).forEach(destroyView);
          a.views = a.views.filter((v) => !ended(v.handle));
          if (a.views.length === 0) {
            anchors.delete(k);
            adapter.dropGroup(a.node.anchor);
          }
        }
        loop.requestRender();
      }
      const want = slotsOf(logical, logicalRigs);
      const takes = new Map<string, Hold<T>>();
      const again: Array<[string, AssetId]> = [];
      for (const [holder, byId] of holds) {
        for (const [id, held] of [...byId]) {
          if (deadBound(held)) {
            // No registry release: the record has ended, and a release by id would act on a newer one.
            byId.delete(id);
            if (want.get(slotOf(holder)) === id) {
              again.push([slotOf(holder), id]);
            }
          }
        }
        if (byId.size === 0) {
          holds.delete(holder);
        }
      }
      for (const [slot, id] of again) {
        takeFor(takes, slot, id);
      }
      if (takes.size > 0) {
        // The logical stage is unchanged: the batch only shows those slots again, on new records.
        void queue([], logical, true, takes, logicalRigs);
      }
    },
    propRects() {
      return [...anchors.values()].flatMap((a) => a.views.map((v) => ({ prop: v.prop, ...v.box })));
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
      anchors.forEach(destroyAnchor);
      anchors.clear();
      for (const v of [bg, cg]) {
        if (v !== null) {
          destroyBackdrop(v);
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
