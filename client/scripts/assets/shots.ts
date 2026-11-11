// The asset tool's shot pipeline, pure side (docs/plans/shots §2.6, §4.2 steps 5-8, §4.5; lanes SH3a, SH3c): a
// placeholder shot's layer set synthesized from the story tool's needs (a `src` shot's is extract.ts's), the files either
// kind packs into (§2.6: the sheet, a face file per non-rest expression, a talk file per spoken one), their placeholder
// SVGs or raster px, and what a chapter manifest carries of them (its rigs and its look). No node:*, no sharp: the
// encoders and IO stay in assets.ts.
import type { AssetCatalog } from '../../src/story/catalog.ts';
import type { Box, CastRig, FaceRig, Frame, LookIndex, LoopRig, Member, MotionSet, ShotRig, ShotWindow } from '../../src/story/shots.ts';
import type { AssetId, BgId, ChapterId, CharId, ExprId } from '../../src/story/staging.ts';
import type { Shot } from '../story/shots/list.ts';
import { SHOT_USAGE_FILE } from '../story/shots/usage.ts';
import type { ShotNeed, WindowRefs } from '../story/shots/usage.ts';
import { packedLabelWidth, renderPacked } from './placeholder.ts';

/** RGBA px, row-major, 4 bytes per px: a `src` shot's state as cut from its sources (§4.2). */
export type Raster = { readonly data: Uint8Array; readonly w: number; readonly h: number };
/**
 * One drawn state: its box on the plate and its fill, `F`: the flat CSS colour a placeholder paints it in, or a `src`
 * shot's px (a `Raster` exactly box-sized; the field keeps its name so one packer serves both, cut D2). `masked`: its
 * alpha is its diff dilated 2 px and feathered 2 px, not a rectangle (§4.2 step 7b, m7).
 */
export type Layer<F = string> = { readonly box: Box; readonly fill: F; readonly masked?: true };
export type Pair<F = string> = { readonly half: Layer<F>; readonly closed: Layer<F> };
/**
 * One expression of a face member: its layer (null: the rest, which the plate shows) and its motion states. A state
 * that reuses the rest's (§4.2 step 3: the expression leaves that box as the plate shows it) holds the rest's own
 * `Layer`; every state of an expression is packed into that expression's file, so a reused one is copied there (§2.6).
 */
export type ExprLayers<F = string> = {
  readonly layer: Layer<F> | null;
  readonly blink: Pair<F>;
  readonly accent: Layer<F>;
  /** Its two talk mouths; null where it has none (a rest never spoken in has no mouth box, §4.2 step 1). */
  readonly mouths: readonly [Layer<F>, Layer<F>] | null;
  /** Some chapter has the character speak in it in this shot: its talk file exists (§2.6). */
  readonly speaks: boolean;
  /** Rev. 3 (m7): the blink drawn on the accent state, where its blink and accent diffs touch (§4.2 step 7b). */
  readonly joint?: Pair<F>;
};
/** A figure mask's moments (§4.2 step 5). */
export type Ellipse = { readonly cx: number; readonly cy: number; readonly rx: number; readonly ry: number; readonly rot: number };
export type CastLayers<F = string> = {
  readonly char: CharId;
  readonly view: 'face' | 'back';
  readonly rest: ExprId;
  /**
   * R9's inputs: the figure mask of every member, the head mask (hair included) of a face member. `feet`: the lowest
   * row's centroid of a real figure mask (§4.2 step 5); a placeholder's sits at the ellipse's foot.
   */
  readonly masks: { readonly fig: Ellipse | null; readonly head: Box | null; readonly feet?: readonly [number, number] };
  readonly hair: readonly { readonly layer: Layer<F>; readonly pivot: readonly [number, number] }[];
  /** The figure cut out as a plane (`figure: true`, for `anim: hop | bounce`), else null. */
  readonly figure: Layer<F> | null;
  /** A face member's expressions, the rest first; empty for a back view. */
  readonly exprs: ReadonlyMap<ExprId, ExprLayers<F>>;
};
/** A plane cut out of a `src` shot's original (§4.1 `layers`, kind `plane`): drawn at `depth`, in front or behind. */
export type PlaneLayer<F = string> = { readonly layer: Layer<F>; readonly depth: number; readonly pivot: readonly [number, number]; readonly front: boolean };
/**
 * A shot's layer set on its plate; `cast` back to front. `planes` and `focus` come from a `src` shot's shot.json; a
 * placeholder has neither (no planes, the focus at the plate's centre).
 */
export type ShotLayers<F = string> = {
  readonly shot: BgId;
  readonly frame: Frame;
  readonly w: number;
  readonly h: number;
  readonly cast: readonly CastLayers<F>[];
  readonly planes?: readonly PlaneLayer<F>[];
  readonly focus?: readonly [number, number];
};

/** Per character, every expression some chapter shows it in, and whether it speaks in it (the union of the needs). */
export type ShotFaces = ReadonlyMap<CharId, ReadonlyMap<ExprId, boolean>>;

/** Principle 4: no file side over 2048 px. */
const MAX_SIDE = 2048;
/** A packed file is at least this high, so its label renders at the minimum font (placeholder.ts). */
const MIN_FILE_H = 12;

const order = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const even = (v: number): number => 2 * Math.round(v / 2);

/** The union of every chapter's face needs of one shot: per character, per expression, whether it is spoken in. */
export function facesOf(needs: readonly ShotNeed[]): ShotFaces {
  const out = new Map<CharId, Map<ExprId, boolean>>();
  for (const n of needs) {
    for (const [c, list] of Object.entries(n.faces) as [CharId, ShotNeed['faces'][CharId]][]) {
      const exprs = out.get(c) ?? new Map<ExprId, boolean>();
      for (const f of list ?? []) {
        exprs.set(f.expr, (exprs.get(f.expr) ?? false) || f.talk);
      }
      out.set(c, exprs);
    }
  }
  return new Map([...out].sort(([a], [b]) => order(a, b)).map(([c, xs]) => [c, new Map([...xs].sort(([a], [b]) => order(a, b)))]));
}

/** §4.2 step 8: the placeholder boxes are given at close-up scale and scaled by the shot's frame. */
export const FRAME_SCALE: Readonly<Record<Frame, number>> = { close: 1, two: 0.75, ots: 0.75, medium: 0.5, insert: 0.5, wide: 0.25, room: 0.25 };

function hsl(hue: number, saturation: number, lightness: number): string {
  return `hsl(${hue} ${saturation}% ${lightness}%)`;
}

/** `[x, y, w, h]` cut to the plate. */
function onPlate(x: number, y: number, w: number, h: number, pw: number, ph: number): Box {
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  return [x0, y0, Math.min(pw, x + w) - x0, Math.min(ph, y + h) - y0];
}

/** An even offset in [0, max]: a box of even size placed at it stays on the plate and even. */
function evenIn(v: number, max: number): number {
  return Math.min(Math.max(0, even(v)), max);
}

/**
 * §4.2 step 8, the placeholder geometry of cast member `i` of `n`: centred at `(i+1)/(n+1)` of the plate width, 0.30 of
 * its height; at close-up scale the blink box E 400 × 130, the accent box B 400 × 80, the mouth box M 180 × 110 inside an
 * expression box 440 × 460, laid out top to bottom with equal even gaps (>= 8 px at every scale, so the boxes stay
 * disjoint after the 4-px dilation); the head mask = the expression box dilated 60 px; one hair lock over the head,
 * its pivot (the root) at its top centre; a figure ellipse from the head's centre to the plate's foot. Every box even.
 */
function memberGeometry(i: number, n: number, s: number, pw: number, ph: number) {
  const xc = Math.round(((i + 1) / (n + 1)) * pw);
  const yc = even(0.3 * ph);
  const [xw, xh] = [even(440 * s), even(460 * s)];
  const x0 = evenIn(xc - xw / 2, pw - xw);
  const y0 = evenIn(yc - xh / 2, ph - xh);
  const [ew, eh, bw, bh, mw, mh] = [even(400 * s), even(130 * s), even(400 * s), even(80 * s), even(180 * s), even(110 * s)];
  const gap = 2 * Math.floor((xh - eh - bh - mh) / 8);
  const centred = (w: number): number => x0 + even((xw - w) / 2);
  const blink: Box = [centred(ew), y0 + gap, ew, eh];
  const accent: Box = [centred(bw), blink[1] + eh + gap, bw, bh];
  const mouth: Box = [centred(mw), accent[1] + bh + gap, mw, mh];
  const d = even(60 * s);
  const head = onPlate(x0 - d, y0 - d, xw + 2 * d, xh + 2 * d, pw, ph);
  const [hw, hh] = [even(xw / 2), even(xh / 2)];
  const hair: Box = [evenIn(xc - hw / 2, pw - hw), head[1], hw, hh];
  const rx = even(0.4 * xw);
  const fig: Ellipse = { cx: xc, cy: (yc + ph) / 2, rx, ry: (ph - yc) / 2, rot: 0 };
  return { expr: [x0, y0, xw, xh] as Box, blink, accent, mouth, head, hair, fig, figBox: onPlate(even(xc - rx), yc, 2 * rx, ph - yc, pw, ph) };
}

/** One chapter's need of a shot, with the chapter that has it (build/shots.json). */
export type ChapterNeed = { readonly ch: ChapterId; readonly need: ShotNeed };

/**
 * SH3a review M1: every expression a chapter's need shows a character in is one the catalog defines; else the story
 * tool's build/shots.json is stale. Reported by name before any layer is built, so `exprHue`'s throw stays an invariant.
 */
export function faceNeedProblems(shot: BgId, needs: readonly ChapterNeed[], catalog: AssetCatalog): string[] {
  const out: string[] = [];
  for (const { ch, need } of needs) {
    for (const [c, list] of Object.entries(need.faces) as [CharId, ShotNeed['faces'][CharId]][]) {
      const entry = Object.hasOwn(catalog.chars, c) ? catalog.chars[c] : undefined;
      for (const f of (list ?? []).filter((x) => entry === undefined || !Object.hasOwn(entry.exprs, x.expr))) {
        out.push(`${SHOT_USAGE_FILE}: ${ch} shows ${c} in ${f.expr} in ${shot}, which assets/catalog.json does not define (run the story tool)`);
      }
    }
  }
  return out;
}

/** The vocabulary hue of `char`'s expression `expr` (catalog.json `chars.<c>.exprs.<x>.placeholder.hue`). */
function exprHue(catalog: AssetCatalog, char: CharId, expr: ExprId): number {
  const entry = Object.hasOwn(catalog.chars, char) ? catalog.chars[char] : undefined;
  const image = entry !== undefined && Object.hasOwn(entry.exprs, expr) ? entry.exprs[expr] : undefined;
  if (image === undefined) {
    throw new Error(`invariant: ${char}/${expr} is an expression of assets/catalog.json (the shot list and the story tool check it)`);
  }
  return image.placeholder.hue;
}

/**
 * §4.2 step 8, a placeholder shot's layer set from its cast (draw order, `story/shots.json`) and the union of the
 * chapters' face needs: a placeholder expression changes every box, so every needed expression owns its blink, accent
 * and (where spoken) talk states: the upper bound. Each state is a flat rect in the expression's vocabulary hue, the
 * motion states lighter or darker tints; hair locks and the figure plane in the rest hue, darker.
 */
export function placeholderLayers(shot: Shot, faces: ShotFaces, catalog: AssetCatalog, plate: { readonly w: number; readonly h: number }): ShotLayers {
  const s = FRAME_SCALE[shot.frame];
  const cast = shot.cast.map((m, i): CastLayers => {
    const g = memberGeometry(i, shot.cast.length, s, plate.w, plate.h);
    const restHue = exprHue(catalog, m.char, m.rest);
    const exprs = new Map<ExprId, ExprLayers>();
    if (m.view === 'face') {
      const needed = faces.get(m.char) ?? new Map<ExprId, boolean>();
      for (const x of [m.rest, ...[...needed.keys()].filter((e) => e !== m.rest).sort(order)]) {
        const hue = exprHue(catalog, m.char, x);
        const speaks = needed.get(x) ?? false;
        exprs.set(x, {
          layer: x === m.rest ? null : { box: g.expr, fill: hsl(hue, 45, 55) },
          blink: { half: { box: g.blink, fill: hsl(hue, 45, 72) }, closed: { box: g.blink, fill: hsl(hue, 45, 38) } },
          accent: { box: g.accent, fill: hsl(hue, 60, 80) },
          mouths: speaks ? [{ box: g.mouth, fill: hsl(hue, 50, 30) }, { box: g.mouth, fill: hsl(hue, 50, 46) }] : null,
          speaks,
        });
      }
    }
    const hairPivot: readonly [number, number] = [g.hair[0] + g.hair[2] / 2, g.hair[1]];
    return {
      char: m.char,
      view: m.view,
      rest: m.rest,
      masks: { fig: g.fig, head: m.view === 'face' ? g.head : null },
      hair: [{ layer: { box: g.hair, fill: hsl(restHue, 30, 24) }, pivot: hairPivot }],
      figure: m.figure ? { box: g.figBox, fill: hsl(restHue, 35, 44) } : null,
      exprs,
    };
  });
  return { shot: shot.id, frame: shot.frame, w: plate.w, h: plate.h, cast };
}

// ---------------------------------------------------------------------------------------------------------------
// Files (§2.6) and packing (§4.2 step 7)

/** One packed state: its key (`<char>/<what>`), its frame in its file, its box on the plate, its fill (`masked`: m7). */
export type PackedItem<F = string> = { readonly key: string; readonly frame: Box; readonly at: Box; readonly fill: F; readonly masked?: true };
/** One shot file: its even size (at most 2048 per side) and its states. */
export type PackedFile<F = string> = { readonly id: AssetId; readonly w: number; readonly h: number; readonly items: readonly PackedItem<F>[] };

type Item<F> = { readonly key: string; readonly layer: Layer<F> };

/** A plane's packed key: `plane/<index>`, never a member's (whose second segment is `hair`, `figure` or an id). */
const planeKey = (i: number): string => `plane/${i}`;

/**
 * Which states each file holds (§2.6), in a fixed order: the sheet (each member's hair, figure and rest motion, then a
 * `src` shot's planes), then each member's face and talk files.
 */
function fileItems<F>(layers: ShotLayers<F>): Map<AssetId, Item<F>[]> {
  const out = new Map<AssetId, Item<F>[]>();
  const add = (id: string, key: string, layer: Layer<F>): void => {
    const file = id as AssetId; // built from the shot, character and expression ids
    out.set(file, [...(out.get(file) ?? []), { key, layer }]);
  };
  const sheet = `sheet/${layers.shot}`;
  for (const m of layers.cast) {
    m.hair.forEach((h, i) => add(sheet, `${m.char}/hair/${i}`, h.layer));
    if (m.figure !== null) {
      add(sheet, `${m.char}/figure`, m.figure);
    }
    const rest = m.exprs.get(m.rest);
    if (rest !== undefined) {
      add(sheet, `${m.char}/${m.rest}/blink.half`, rest.blink.half);
      add(sheet, `${m.char}/${m.rest}/blink.closed`, rest.blink.closed);
      add(sheet, `${m.char}/${m.rest}/accent`, rest.accent);
      if (rest.joint !== undefined) {
        add(sheet, `${m.char}/${m.rest}/joint.half`, rest.joint.half);
        add(sheet, `${m.char}/${m.rest}/joint.closed`, rest.joint.closed);
      }
    }
  }
  (layers.planes ?? []).forEach((p, i) => add(sheet, planeKey(i), p.layer));
  for (const m of layers.cast) {
    for (const [x, e] of m.exprs) {
      const face = `face/${layers.shot}/${m.char}/${x}`;
      if (x !== m.rest && e.layer !== null) {
        add(face, `${m.char}/${x}/layer`, e.layer);
        add(face, `${m.char}/${x}/blink.half`, e.blink.half);
        add(face, `${m.char}/${x}/blink.closed`, e.blink.closed);
        add(face, `${m.char}/${x}/accent`, e.accent);
        if (e.joint !== undefined) {
          add(face, `${m.char}/${x}/joint.half`, e.joint.half);
          add(face, `${m.char}/${x}/joint.closed`, e.joint.closed);
        }
      }
      if (e.speaks) {
        if (e.mouths === null) {
          throw new Error(`invariant: ${layers.shot}: ${m.char} speaks in ${x}, so it has mouths (its own or the rest's)`);
        }
        const talk = `talk/${layers.shot}/${m.char}/${x}`;
        e.mouths.forEach((l, i) => add(talk, `${m.char}/${x}/talk/${i}`, l));
      }
    }
  }
  return out;
}

/**
 * Shelf packing of one file (§4.2 step 7): states by height, tallest first (ties in file order), left to right, a new
 * shelf when the next would pass 2048 px. Every size is even, so every coordinate is, and the half tier halves every
 * frame exactly; the file is at least as wide as its label at the minimum font (placeholder.ts) and 12 px high.
 */
function shelves<F>(id: AssetId, items: readonly Item<F>[]): { readonly frames: ReadonlyMap<string, Box>; readonly w: number; readonly h: number } {
  const byHeight = items.map((it, i) => ({ it, i })).sort((a, b) => b.it.layer.box[3] - a.it.layer.box[3] || a.i - b.i);
  const frames = new Map<string, Box>();
  let [x, y, shelf, width] = [0, 0, 0, 0];
  for (const { it } of byHeight) {
    const [, , w, h] = it.layer.box;
    if (x > 0 && x + w > MAX_SIDE) {
      y += shelf;
      [x, shelf] = [0, 0];
    }
    frames.set(it.key, [x, y, w, h]);
    x += w;
    shelf = Math.max(shelf, h);
    width = Math.max(width, x);
  }
  return { frames, w: Math.max(width, packedLabelWidth(id)), h: Math.max(y + shelf, MIN_FILE_H) };
}

/** One file, packed by `shelves`; a state off the even 2048 grid or a file past 2048 is a bug (R5, `packProblems`). */
function packFile<F>(id: AssetId, items: readonly Item<F>[]): PackedFile<F> {
  for (const { key, layer } of items) {
    if (layer.box[2] % 2 !== 0 || layer.box[3] % 2 !== 0 || layer.box[2] > MAX_SIDE || layer.box[3] > MAX_SIDE) {
      throw new Error(`invariant: ${id} ${key}: a packed state is even-sized and at most ${MAX_SIDE} px (${layer.box.join(', ')})`);
    }
  }
  const { frames, w, h } = shelves(id, items);
  if (w > MAX_SIDE || h > MAX_SIDE) {
    throw new Error(`invariant: ${id} packs into ${MAX_SIDE} × ${MAX_SIDE} (${w} × ${h})`);
  }
  return {
    id,
    w,
    h,
    items: items.map(({ key, layer }) => ({
      key,
      frame: frames.get(key) ?? [0, 0, 0, 0],
      at: layer.box,
      fill: layer.fill,
      ...(layer.masked === true ? { masked: true as const } : {}),
    })),
  };
}

/** Every file of a shot's layer set, packed: the sheet (a shot with a cast), its face and talk files. */
export function shotFiles<F>(layers: ShotLayers<F>): ReadonlyMap<AssetId, PackedFile<F>> {
  return new Map([...fileItems(layers)].map(([id, items]) => [id, packFile(id, items)]));
}

/**
 * Critique O1: each file of a layer set that would not fit 2048 × 2048, by name with its layer sizes in file order, so
 * real art too large for one file is an input problem before anything is encoded, never `packFile`'s invariant.
 */
export function packProblems<F>(layers: ShotLayers<F>): string[] {
  return [...fileItems(layers)].flatMap(([id, items]) => {
    const { w, h } = shelves(id, items);
    const sizes = items.map(({ layer }) => `${layer.box[2]} × ${layer.box[3]}`).join(', ');
    return w > MAX_SIDE || h > MAX_SIDE ? [`${id} does not fit ${MAX_SIDE} × ${MAX_SIDE} (layer sizes ${sizes})`] : [];
  });
}

/** A cast member's states as members of the files they sit in (§4.5 `Member`). */
export type MemberPack = {
  readonly char: CharId;
  readonly hair: readonly { readonly member: Member; readonly pivot: readonly [number, number] }[];
  readonly figure: Member | null;
  /** A face member's expressions (the rest first): its layer (null at rest) and motion; a back view has none. */
  readonly exprs: ReadonlyMap<ExprId, { readonly layer: Member | null; readonly motion: MotionSet }>;
};
/**
 * A shot's packed files and, per cast member (draw order), where each of its states sits; a `src` shot's planes as the
 * rig carries them (in the sheet), none for a placeholder.
 */
export type ShotPack<F = string> = {
  readonly files: ReadonlyMap<AssetId, PackedFile<F>>;
  readonly cast: readonly MemberPack[];
  readonly planes: ShotRig['planes'];
};

/**
 * §4.2 step 7 (rev. 4, W4): one packing per file of §2.6, each within 2048 × 2048 with every coordinate and size even,
 * and each state as a `Member` of the file it sits in: the rest's blink and accent, every hair lock and figure plane and
 * a `src` shot's planes in the sheet, an expression's layer and motion states in its face file (a reused rest state as a
 * copy), its mouths in its talk file, never the sheet's.
 */
export function packShot<F>(layers: ShotLayers<F>): ShotPack<F> {
  const files = shotFiles(layers);
  const members = new Map<string, Member>();
  for (const file of files.values()) {
    for (const item of file.items) {
      members.set(item.key, { file: file.id, frame: item.frame, at: item.at, ...(item.masked === true ? { masked: true as const } : {}) });
    }
  }
  const get = (key: string): Member => {
    const m = members.get(key);
    if (m === undefined) {
      throw new Error(`invariant: ${layers.shot}: ${key} is packed in one of its files`);
    }
    return m;
  };
  const cast = layers.cast.map((m): MemberPack => {
    const exprs = [...m.exprs].map(([x, e]) => {
      const key = `${m.char}/${x}`;
      const motion: MotionSet = {
        blink: { half: get(`${key}/blink.half`), closed: get(`${key}/blink.closed`) },
        talk: e.speaks && e.mouths !== null ? e.mouths.map((_, i) => get(`${key}/talk/${i}`)) : [],
        accent: get(`${key}/accent`),
        ...(e.joint === undefined ? {} : { joint: { half: get(`${key}/joint.half`), closed: get(`${key}/joint.closed`) } }),
      };
      return [x, { layer: x === m.rest ? null : get(`${key}/layer`), motion }] as const;
    });
    return {
      char: m.char,
      hair: m.hair.map((h, i) => ({ member: get(`${m.char}/hair/${i}`), pivot: h.pivot })),
      figure: m.figure === null ? null : get(`${m.char}/figure`),
      exprs: new Map(exprs),
    };
  });
  const planes = (layers.planes ?? []).map((p, i) => ({ member: get(planeKey(i)), depth: p.depth, pivot: p.pivot, front: p.front }));
  return { files, cast, planes };
}

/** A loop prop's frame side (shots §4.4: frames at most 512 × 512; a placeholder's fill the prop canvas). */
const LOOP_FRAME = 512;

/**
 * Shots §2.4 (rev. 2, W10), a placeholder loop prop's atlas `prop/<id>`: `frames` frames of 512 × 512, each a flat rect
 * one step lighter, packed like a shot file (even, within 2048 × 2048) so the half tier halves every frame exactly.
 */
export function loopAtlas(id: AssetId, hue: number, frames: number): PackedFile {
  const items = Array.from({ length: frames }, (_, i): Item<string> => ({
    key: `frame/${i}`,
    layer: { box: [0, 0, LOOP_FRAME, LOOP_FRAME], fill: hsl(hue, 55, 30 + Math.round((40 * i) / Math.max(1, frames - 1))) },
  }));
  return packFile(id, items);
}

/** A loop's frame count bound (shots §4.4; catalog.ts's `LOOP_FRAMES` for a placeholder's). */
const LOOP_MAX_FRAMES = 12;

/**
 * Shots §4.4 (cut rider R-b), a `src` loop's frames as found in `assets/src/<src>/` (`<name>.png` → its size): exactly
 * `0.png` .. `<n-1>.png`, 1..12 of them, one size, each side even and at most 512. One problem by name, the first that
 * holds, so the half tier halves every frame exactly and the atlas fits 2048 × 2048.
 */
export function loopFrameProblems(id: AssetId, src: string, frames: ReadonlyMap<string, { readonly w: number; readonly h: number }>): string[] {
  const dir = `assets/src/${src}`;
  const n = frames.size;
  if (n === 0) {
    return [`${id}: ${dir} has no frame (shots §4.4: 0.png .. <n-1>.png, 1..12 frames)`];
  }
  if (n > LOOP_MAX_FRAMES) {
    return [`${id}: ${dir} has ${n} frames (shots §4.4: 1..${LOOP_MAX_FRAMES})`];
  }
  const stray = [...frames.keys()].filter((name) => !/^(0|[1-9][0-9]*)\.png$/.test(name) || Number(name.slice(0, -4)) >= n).sort();
  if (stray.length > 0) {
    return [`${id}: ${dir}: ${stray.join(', ')} not in 0.png .. ${n - 1}.png (shots §4.4: frames numbered from 0, contiguous)`];
  }
  const sizes = [...new Set(Array.from({ length: n }, (_, i) => frames.get(`${i}.png`)).map((f) => `${f?.w ?? 0} × ${f?.h ?? 0}`))];
  if (sizes.length > 1) {
    return [`${id}: ${dir}: frames of ${sizes.join(', ')} (shots §4.4: one size)`];
  }
  const { w, h } = frames.get('0.png') ?? { w: 0, h: 0 };
  return w % 2 === 0 && h % 2 === 0 && w <= LOOP_FRAME && h <= LOOP_FRAME
    ? []
    : [`${id}: ${dir}: frames of ${w} × ${h} (shots §4.4: each side even and at most ${LOOP_FRAME})`];
}

/**
 * Shots §2.4 / §4.4, a `src` loop prop's atlas `prop/<id>`: its frames (`loopFrameProblems` holds), frame i at key
 * `frame/<i>`, packed like a placeholder's; generic over the fill, so the tool packs from sizes and draws the px only
 * when the atlas is encoded.
 */
export function srcLoopAtlas<F>(id: AssetId, frames: readonly { readonly w: number; readonly h: number; readonly fill: F }[]): PackedFile<F> {
  return packFile(
    id,
    frames.map((f, i): Item<F> => ({ key: `frame/${i}`, layer: { box: [0, 0, f.w, f.h], fill: f.fill } })),
  );
}

/** The manifest's loop rig of an atlas (§4.5 `LoopRig`): its frames' boxes in frame order, and the fps. */
export function loopRig(atlas: PackedFile<unknown>, fps: number): LoopRig {
  return { frames: atlas.items.map((it) => it.frame), fps };
}

/**
 * A `src` shot's packed file as RGBA px: each state's px at its frame, transparent between them (the packer's gaps and
 * the label floor), what the encoder gets (§4.2 step 7).
 */
export function shotFileRaster(file: PackedFile<Raster>): Raster {
  const data = new Uint8Array(file.w * file.h * 4);
  for (const { key, frame, fill } of file.items) {
    if (fill.w !== frame[2] || fill.h !== frame[3]) {
      throw new Error(`invariant: ${file.id} ${key}: a state's px are its frame's size (${fill.w} × ${fill.h} in ${frame.join(', ')})`);
    }
    for (let y = 0; y < fill.h; y++) {
      data.set(fill.data.subarray(y * fill.w * 4, (y + 1) * fill.w * 4), ((frame[1] + y) * file.w + frame[0]) * 4);
    }
  }
  return { data, w: file.w, h: file.h };
}

/** A packed file's placeholder SVG: its states as flat rects, then its id as its label. */
export function shotFileSvg(file: PackedFile): string {
  return renderPacked(file.id, file.w, file.h, file.items);
}

// ---------------------------------------------------------------------------------------------------------------
// Checks (§4.3 R5, R9) and the rig's fields from masks (§4.2 steps 5-6)

/** R5: a plate is 2048 high with an even width in [1080, 1440]; a `room` plate exactly 1080 × 2048. */
export function plateProblems(shot: BgId, frame: Frame, w: number, h: number): string[] {
  if (frame === 'room') {
    return w === 1080 && h === 2048 ? [] : [`${shot}: a room plate is ${w} × ${h} (R5: exactly 1080 × 2048)`];
  }
  return h === 2048 && w % 2 === 0 && w >= 1080 && w <= 1440 ? [] : [`${shot}: plate ${w} × ${h} (R5: 2048 high, an even width in 1080..1440)`];
}

/** R9: every cast member has a figure mask and a hair lock; every face member a head mask. Messages name the member. */
export function castProblems<F>(layers: ShotLayers<F>): string[] {
  return layers.cast.flatMap((m) => [
    ...(m.masks.fig === null ? [`${layers.shot}: ${m.char} has no figure mask (R9: every cast member has one)`] : []),
    ...(m.hair.length === 0 ? [`${layers.shot}: ${m.char} has no hair lock (R9: every cast member has one)`] : []),
    ...(m.view === 'face' && m.masks.head === null ? [`${layers.shot}: ${m.char} has no head mask (R9: every face member has one)`] : []),
  ]);
}

/** A vertex lattice over the plate: vertex (i, j) at (i × w / (cols − 1), j × h / (rows − 1)), index j × cols + i. */
export type Lattice = { readonly cols: number; readonly rows: number };
/** §4.2 step 5: the plateau's lattice (a cell 45 × 44.5 px on 1080 × 2048, scaled with the plate). */
export const FINE: Lattice = { cols: 25, rows: 47 };
/** The S-D fallback lattice, and the depth grid's (§4.2 step 6). */
export const COARSE: Lattice = { cols: 13, rows: 24 };

/** The regions a head plateau covers: the head mask (hair included), every face layer box, every hair-lock root. */
function headRegions<F>(m: CastLayers<F>): Box[] {
  const states = [...m.exprs.values()].flatMap((x) => [x.layer, x.blink.half, x.blink.closed, x.accent, ...(x.mouths ?? [])]);
  return [
    ...(m.masks.head === null ? [] : [m.masks.head]),
    ...states.flatMap((l) => (l === null ? [] : [l.box])),
    ...m.hair.map((h): Box => [h.pivot[0], h.pivot[1], 0, 0]),
  ];
}

/**
 * §4.2 step 5 (rev. 3, W3), the head plateau: every vertex of a cell that touches (closed intervals) one of the
 * member's head regions, dilated by one cell. Every cell touching the head or a face layer then has its four corners in
 * it, which is what makes the head's affine exact there (§5.6).
 */
export function plateauOf<F>(m: CastLayers<F>, plate: { readonly w: number; readonly h: number }, l: Lattice): ReadonlySet<number> {
  const [cw, ch] = [plate.w / (l.cols - 1), plate.h / (l.rows - 1)];
  const corners = new Set<number>();
  for (const [bx, by, bw, bh] of headRegions(m)) {
    for (let i = 0; i < l.cols - 1; i++) {
      for (let j = 0; j < l.rows - 1; j++) {
        if ((i + 1) * cw >= bx && i * cw <= bx + bw && (j + 1) * ch >= by && j * ch <= by + bh) {
          for (const k of [j * l.cols + i, j * l.cols + i + 1, (j + 1) * l.cols + i, (j + 1) * l.cols + i + 1]) {
            corners.add(k);
          }
        }
      }
    }
  }
  const out = new Set<number>();
  for (const k of corners) {
    const [i, j] = [k % l.cols, Math.floor(k / l.cols)];
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        if (i + di >= 0 && i + di < l.cols && j + dj >= 0 && j + dj < l.rows) {
          out.add((j + dj) * l.cols + i + di);
        }
      }
    }
  }
  return out;
}

function toBase64(bytes: Uint8Array): string {
  let text = '';
  for (const b of bytes) {
    text += String.fromCharCode(b);
  }
  return btoa(text);
}

/** A vertex set as the rig writes it: bit k (MSB first in each byte) for vertex k, base64. */
export function plateauBits(vertices: ReadonlySet<number>, l: Lattice): string {
  const bytes = new Uint8Array(Math.ceil((l.cols * l.rows) / 8));
  for (const k of vertices) {
    bytes[k >> 3] = (bytes[k >> 3] ?? 0) | (0x80 >> (k & 7));
  }
  return toBase64(bytes);
}

/** §4.2 step 5: the head-motion falloff, `max(60, 0.25 × the head mask's bbox width)` px (60 without a head mask). */
export function bandOf<F>(m: CastLayers<F>): number {
  return Math.max(60, 0.25 * (m.masks.head?.[2] ?? 0));
}

/**
 * §4.2 step 5, head groups: two members whose plateaus (the fine lattice) come within the larger of their bands are one
 * group, transitively; groups are numbered in draw order by their first member.
 */
export function headGroups<F>(layers: ShotLayers<F>): number[] {
  const plate = { w: layers.w, h: layers.h };
  const points = layers.cast.map((m) =>
    [...plateauOf(m, plate, FINE)].map((k) => [((k % FINE.cols) * layers.w) / (FINE.cols - 1), (Math.floor(k / FINE.cols) * layers.h) / (FINE.rows - 1)] as const),
  );
  const parent = layers.cast.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : root(parent[i] ?? i));
  for (let a = 0; a < layers.cast.length; a++) {
    for (let b = a + 1; b < layers.cast.length; b++) {
      const [ma, mb] = [layers.cast[a], layers.cast[b]];
      const reach = Math.max(ma === undefined ? 60 : bandOf(ma), mb === undefined ? 60 : bandOf(mb));
      const near = (points[a] ?? []).some(([ax, ay]) => (points[b] ?? []).some(([bx, by]) => Math.hypot(ax - bx, ay - by) <= reach));
      if (near) {
        parent[root(b)] = root(a);
      }
    }
  }
  const index = new Map<number, number>();
  return layers.cast.map((_, i) => {
    const r = root(i);
    const known = index.get(r) ?? index.size;
    index.set(r, known);
    return known;
  });
}

/**
 * §4.2 step 8 (rev. 4, m2), a placeholder's depth grid on the 13 × 24 lattice, rows top to bottom: a vertex at
 * y = i / (rows − 1) × h reads n(y) = clamp((y/h − 0.35)/0.65, 0, 1) (vertex sampling: the top 35 % a far wall at 0, the
 * last row 255), quantised to u8. It depends on y / h only, so one grid serves every plate.
 */
export function placeholderDepth(): Uint8Array {
  const grid = new Uint8Array(COARSE.cols * COARSE.rows);
  for (let i = 0; i < COARSE.rows; i++) {
    grid.fill(Math.round(255 * Math.min(1, Math.max(0, (i / (COARSE.rows - 1) - 0.35) / 0.65))), i * COARSE.cols, (i + 1) * COARSE.cols);
  }
  return grid;
}

/** The depth grid as the rig writes it (§4.5 `depth`: base64 of 13 × 24 u8). */
export function depthBase64(grid: Uint8Array): string {
  return toBase64(grid);
}

/** The depth grid's bilinear read at plate point (x, y), as n in [0, 1] (§5.6 reads it the same way). */
export function depthAt(grid: Uint8Array, plate: { readonly w: number; readonly h: number }, x: number, y: number): number {
  const gx = Math.min(1, Math.max(0, x / plate.w)) * (COARSE.cols - 1);
  const gy = Math.min(1, Math.max(0, y / plate.h)) * (COARSE.rows - 1);
  const [i, j] = [Math.min(Math.floor(gx), COARSE.cols - 2), Math.min(Math.floor(gy), COARSE.rows - 2)];
  const [fx, fy] = [gx - i, gy - j];
  const v = (c: number, r: number): number => grid[r * COARSE.cols + c] ?? 0;
  return ((1 - fx) * (1 - fy) * v(i, j) + fx * (1 - fy) * v(i + 1, j) + (1 - fx) * fy * v(i, j + 1) + fx * fy * v(i + 1, j + 1)) / 255;
}

// ---------------------------------------------------------------------------------------------------------------
// What a chapter manifest carries (§4.5): its rigs, restricted to the chapter (CH D5), and its look

/** Vertex `k` of lattice `l` on the plate, in plate px. */
function vertexAt(k: number, l: Lattice, plate: { readonly w: number; readonly h: number }): readonly [number, number] {
  return [((k % l.cols) * plate.w) / (l.cols - 1), (Math.floor(k / l.cols) * plate.h) / (l.rows - 1)];
}

/** One chapter's rig of one cast member: the shot's packing, with only the expressions the chapter shows. */
function castRig<F>(
  m: CastLayers<F>,
  p: MemberPack,
  group: number,
  shown: ReadonlyMap<ExprId, boolean>,
  plate: { readonly w: number; readonly h: number },
  depth: Uint8Array,
): CastRig & { readonly char: CharId } {
  const fig = m.masks.fig;
  if (fig === null || p.char !== m.char) {
    throw new Error(`invariant: ${m.char} has a figure mask (R9, checked before planning) and its own packing`);
  }
  const fine = plateauOf(m, plate, FINE);
  const points = [...fine].map((k) => vertexAt(k, FINE, plate));
  const mean = points.reduce((sum, [x, y]) => sum + depthAt(depth, plate, x, y), 0) / Math.max(1, points.length);
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const [x0, y0] = [Math.floor(Math.min(...xs)), Math.floor(Math.min(...ys))];
  // The rest is always there (the plate shows it); every other expression only where this chapter shows it, and its
  // talk mouths only where this chapter has the character speak in it.
  const exprs = [...p.exprs].filter(([x]) => x === m.rest || shown.has(x)).map(([x, e]) => [x, { layer: e.layer, motion: shown.get(x) === true ? e.motion : { ...e.motion, talk: [] } }] as const);
  const face: FaceRig | null =
    m.view === 'back' ? null : { rest: m.rest, exprs: Object.fromEntries(exprs) as FaceRig['exprs'], head: [x0, y0, Math.ceil(Math.max(...xs)) - x0, Math.ceil(Math.max(...ys)) - y0] };
  return {
    char: m.char,
    view: m.view,
    face,
    body: { cx: fig.cx, cy: fig.cy, rx: fig.rx, ry: fig.ry, rot: fig.rot, feet: m.masks.feet ?? [fig.cx, Math.min(plate.h, fig.cy + fig.ry)] },
    headDepth: Math.round(mean * 255) / 255,
    plateau: plateauBits(fine, FINE),
    plateauCoarse: plateauBits(plateauOf(m, plate, COARSE), COARSE),
    band: bandOf(m),
    group,
    figure: p.figure,
    hair: p.hair,
  };
}

/**
 * §4.5, one chapter's rig of one shot it shows (CH D5): the plate's size, the chapter's frame for it, the focus (a `src`
 * shot's from shot.json, else the plate's centre), its cast back to front with only the expressions and talk the chapter
 * needs (`need.faces`), its planes (a `src` shot's; none for a placeholder), no ambient (SH9), the depth grid. Every
 * member names a file of the chapter's own when the story tool's `assets` list agrees (the planner checks it).
 */
export function shotRig<F>(layers: ShotLayers<F>, pack: ShotPack<F>, need: ShotNeed, depth: Uint8Array): ShotRig {
  const plate = { w: layers.w, h: layers.h };
  const groups = headGroups(layers);
  const cast = layers.cast.map((m, i) => {
    const p = pack.cast[i];
    if (p === undefined) {
      throw new Error(`invariant: ${layers.shot}: ${m.char} is packed`);
    }
    const shown = new Map((need.faces[m.char] ?? []).map((f) => [f.expr, f.talk] as const));
    return castRig(m, p, groups[i] ?? 0, shown, plate, depth);
  });
  const frame: Frame = need.frame;
  const focus = layers.focus ?? [layers.w / 2, layers.h / 2];
  return { w: layers.w, h: layers.h, frame, focus, cast, planes: pack.planes, ambient: [], depth: depthBase64(depth) };
}

const unique = <T>(xs: readonly T[]): T[] => [...new Set(xs)];

/**
 * §4.5 (rev. 5, W1), a build window folded into what the runtime gets: `need` = cur then certain, `warm` = possible
 * minus need in look order with `near` re-counted over the first `near` possible ids that survive, `hope` = d2 then d3
 * minus need and warm; each list once per id. The distance and the certain / possible split stay build-only.
 */
export function foldWindow(w: WindowRefs): ShotWindow {
  const need = unique([...w.cur, ...w.certain]);
  const needed = new Set(need);
  const warm = unique(w.possible.filter((id) => !needed.has(id)));
  const near = new Set(w.possible.slice(0, w.near).filter((id) => !needed.has(id))).size;
  const taken = new Set([...need, ...warm]);
  return { need, warm, near, hope: unique([...w.d2, ...w.d3].filter((id) => !taken.has(id))) };
}

/** A chapter's `look`: its windows folded, one sorted image table, windows by sorted key; null without a window. */
export function manifestLook(windows: Readonly<Record<string, WindowRefs>>): LookIndex | null {
  const folded = Object.entries(windows)
    .sort(([a], [b]) => order(a, b))
    .map(([k, w]) => [k, foldWindow(w)] as const);
  if (folded.length === 0) {
    return null;
  }
  const images = unique(folded.flatMap(([, w]) => [...w.need, ...w.warm, ...w.hope])).sort(order);
  const at = new Map(images.map((id, i) => [id, i]));
  const index = (ids: readonly AssetId[]): number[] => ids.map((id) => at.get(id) ?? -1);
  return { images, windows: Object.fromEntries(folded.map(([k, w]) => [k, [index(w.need), index(w.warm), w.near, index(w.hope)] as const])) };
}
