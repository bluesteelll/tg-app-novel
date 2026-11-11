// The asset tool's shot pipeline, pure side (docs/plans/shots §2.6, §4.2 steps 5-8, §4.5; lane SH3a): a shot's layer
// set synthesized from the story tool's needs (placeholders: no `src` before SH3c), the files it packs into (§2.6: the
// sheet, a face file per non-rest expression, a talk file per spoken one) and their placeholder SVGs. No node:*, no
// sharp: the encoders and IO stay in assets.ts.
import type { AssetCatalog } from '../../src/story/catalog.ts';
import type { Box, Frame, Member, MotionSet } from '../../src/story/shots.ts';
import type { AssetId, BgId, CharId, ExprId } from '../../src/story/staging.ts';
import type { Shot } from '../story/shots/list.ts';
import type { ShotNeed } from '../story/shots/usage.ts';
import { packedLabelWidth, renderPacked } from './placeholder.ts';

/** One drawn state: its box on the plate and the flat fill a placeholder paints it in. */
export type Layer = { readonly box: Box; readonly fill: string };
export type Pair = { readonly half: Layer; readonly closed: Layer };
/**
 * One expression of a face member: its layer (null: the rest, which the plate shows) and its motion states. A state
 * that reuses the rest's (§4.2 step 3: the expression leaves that box as the plate shows it) holds the rest's own
 * `Layer`; every state of an expression is packed into that expression's file, so a reused one is copied there (§2.6).
 */
export type ExprLayers = {
  readonly layer: Layer | null;
  readonly blink: Pair;
  readonly accent: Layer;
  /** Its two talk mouths; null where it has none (a rest never spoken in has no mouth box, §4.2 step 1). */
  readonly mouths: readonly [Layer, Layer] | null;
  /** Some chapter has the character speak in it in this shot: its talk file exists (§2.6). */
  readonly speaks: boolean;
};
/** A figure mask's moments (§4.2 step 5). */
export type Ellipse = { readonly cx: number; readonly cy: number; readonly rx: number; readonly ry: number; readonly rot: number };
export type CastLayers = {
  readonly char: CharId;
  readonly view: 'face' | 'back';
  readonly rest: ExprId;
  /** R9's inputs: the figure mask of every member, the head mask (hair included) of a face member. */
  readonly masks: { readonly fig: Ellipse | null; readonly head: Box | null };
  readonly hair: readonly { readonly layer: Layer; readonly pivot: readonly [number, number] }[];
  /** The figure cut out as a plane (`figure: true`, for `anim: hop | bounce`), else null. */
  readonly figure: Layer | null;
  /** A face member's expressions, the rest first; empty for a back view. */
  readonly exprs: ReadonlyMap<ExprId, ExprLayers>;
};
/** A shot's layer set on its plate; `cast` back to front. */
export type ShotLayers = { readonly shot: BgId; readonly frame: Frame; readonly w: number; readonly h: number; readonly cast: readonly CastLayers[] };

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

/** One packed state: its key (`<char>/<what>`), its frame in its file, its box on the plate, its fill. */
export type PackedItem = { readonly key: string; readonly frame: Box; readonly at: Box; readonly fill: string };
/** One shot file: its even size (at most 2048 per side) and its states. */
export type PackedFile = { readonly id: AssetId; readonly w: number; readonly h: number; readonly items: readonly PackedItem[] };

type Item = { readonly key: string; readonly layer: Layer };

/** Which states each file holds (§2.6), in a fixed order: the sheet, then each member's face and talk files. */
function fileItems(layers: ShotLayers): Map<AssetId, Item[]> {
  const out = new Map<AssetId, Item[]>();
  const add = (id: string, key: string, layer: Layer): void => {
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
    }
  }
  for (const m of layers.cast) {
    for (const [x, e] of m.exprs) {
      const face = `face/${layers.shot}/${m.char}/${x}`;
      if (x !== m.rest && e.layer !== null) {
        add(face, `${m.char}/${x}/layer`, e.layer);
        add(face, `${m.char}/${x}/blink.half`, e.blink.half);
        add(face, `${m.char}/${x}/blink.closed`, e.blink.closed);
        add(face, `${m.char}/${x}/accent`, e.accent);
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
function packFile(id: AssetId, items: readonly Item[]): PackedFile {
  for (const { key, layer } of items) {
    if (layer.box[2] % 2 !== 0 || layer.box[3] % 2 !== 0 || layer.box[2] > MAX_SIDE || layer.box[3] > MAX_SIDE) {
      throw new Error(`invariant: ${id} ${key}: a packed state is even-sized and at most ${MAX_SIDE} px (${layer.box.join(', ')})`);
    }
  }
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
  const w = Math.max(width, packedLabelWidth(id));
  const h = Math.max(y + shelf, MIN_FILE_H);
  if (w > MAX_SIDE || h > MAX_SIDE) {
    throw new Error(`invariant: ${id} packs into ${MAX_SIDE} × ${MAX_SIDE} (${w} × ${h})`);
  }
  return { id, w, h, items: items.map(({ key, layer }) => ({ key, frame: frames.get(key) ?? [0, 0, 0, 0], at: layer.box, fill: layer.fill })) };
}

/** Every file of a shot's layer set, packed: the sheet (a shot with a cast), its face and talk files. */
export function shotFiles(layers: ShotLayers): ReadonlyMap<AssetId, PackedFile> {
  return new Map([...fileItems(layers)].map(([id, items]) => [id, packFile(id, items)]));
}

/** A cast member's states as members of the files they sit in (§4.5 `Member`). */
export type MemberPack = {
  readonly char: CharId;
  readonly hair: readonly { readonly member: Member; readonly pivot: readonly [number, number] }[];
  readonly figure: Member | null;
  /** A face member's expressions (the rest first): its layer (null at rest) and motion; a back view has none. */
  readonly exprs: ReadonlyMap<ExprId, { readonly layer: Member | null; readonly motion: MotionSet }>;
};
/** A shot's packed files and, per cast member (draw order), where each of its states sits. */
export type ShotPack = { readonly files: ReadonlyMap<AssetId, PackedFile>; readonly cast: readonly MemberPack[] };

/**
 * §4.2 step 7 (rev. 4, W4): one packing per file of §2.6, each within 2048 × 2048 with every coordinate and size even,
 * and each state as a `Member` of the file it sits in: the rest's blink and accent and every hair lock and figure plane
 * in the sheet, an expression's layer and motion states in its face file (a reused rest state as a copy), its mouths in
 * its talk file, never the sheet's.
 */
export function packShot(layers: ShotLayers): ShotPack {
  const files = shotFiles(layers);
  const members = new Map<string, Member>();
  for (const file of files.values()) {
    for (const item of file.items) {
      members.set(item.key, { file: file.id, frame: item.frame, at: item.at });
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
  return { files, cast };
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
export function castProblems(layers: ShotLayers): string[] {
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
function headRegions(m: CastLayers): Box[] {
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
export function plateauOf(m: CastLayers, plate: { readonly w: number; readonly h: number }, l: Lattice): ReadonlySet<number> {
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
export function bandOf(m: CastLayers): number {
  return Math.max(60, 0.25 * (m.masks.head?.[2] ?? 0));
}

/**
 * §4.2 step 5, head groups: two members whose plateaus (the fine lattice) come within the larger of their bands are one
 * group, transitively; groups are numbered in draw order by their first member.
 */
export function headGroups(layers: ShotLayers): number[] {
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
