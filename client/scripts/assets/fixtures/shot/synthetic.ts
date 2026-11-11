// A tiny synthetic `src` shot as code (lane SH3c, cut D15): the files of `assets/src/shot/<s>/` (shots §4.1) as rasters
// in the original's geometry, its shot.json and its depth map, with a knob per failure case of §4.3. Test input only:
// vitest collects scripts/**/*.test.ts and the asset tool reads <root>/assets/src/shot/<s>/, so nothing here ships, and
// no binary enters git (the tool tests write PNGs from these rasters into a temp repository). Pure: no sharp, no node:*.
import type { DepthSource } from '../../extract.ts';
import type { Raster } from '../../shots.ts';

type Rgb = readonly [number, number, number];
type Rect = readonly [x: number, y: number, w: number, h: number];

/** The fixture's knobs; the defaults extract cleanly. */
export type Knobs = {
  /** The original's size: tiny for the pure tests, 1080 × 2048 for the tool tests (R5). */
  readonly w: number;
  readonly h: number;
  /** The face's unit (px): its boxes scale with it; the 2 / 4 / 8 px dilations of §4.2-4.3 do not. */
  readonly u: number;
  /** shot.json `crop`; null: the whole original. */
  readonly crop: Rect | null;
  /** shot.json `q`; null: absent (50). */
  readonly q: number | null;
  /** R1: added to every channel of `ally.smile.png` (a whole-frame relight). */
  readonly relight: number;
  /** R7: false paints the hair lock into the plate too (the region not inpainted). */
  readonly inpainted: boolean;
  /** R2: the rest talk mouths drawn 3 px under the left eye. */
  readonly talkNearBlink: boolean;
  /** m7: the angry accent's brow 6 px (`apart`) or 3 px (`touching`) above the eyes' lids. */
  readonly angryAccent: 'apart' | 'touching';
  /** W2 (P0): the angry accent drawn as an irregular, noise-thresholded blob instead of a moved brow. */
  readonly irregular: boolean;
  /** A figure layer (`figure_ally`, the figure mask) for a `figure: true` member. */
  readonly figure: boolean;
  /** A plane layer (`plane_0`, `mask.plane.0.png`). */
  readonly plane: boolean;
  /** Files left out of the directory. */
  readonly missing: readonly string[];
};

export const DEFAULT_KNOBS: Knobs = {
  w: 160,
  h: 320,
  u: 1,
  crop: null,
  q: null,
  relight: 0,
  inpainted: true,
  talkNearBlink: false,
  angryAccent: 'apart',
  irregular: false,
  figure: false,
  plane: false,
  missing: [],
};

/** One generated source directory: its rasters by file name, its depth map, its shot.json. */
export type SyntheticShot = {
  readonly w: number;
  readonly h: number;
  readonly files: ReadonlyMap<string, Raster>;
  readonly depth: DepthSource;
  readonly json: Record<string, unknown>;
};

/** Where the face of `ally` sits (original px); every test derives its expected boxes from these. */
export function geometry(w: number, h: number, u: number) {
  const fx = Math.round(w / 2);
  const fy = Math.round(0.3 * h);
  const eyeTop = fy - 20 * u;
  const browH = 4 * u;
  const eyes: readonly Rect[] = [
    [fx - 30 * u, eyeTop, 20 * u, 8 * u],
    [fx + 10 * u, eyeTop, 20 * u, 8 * u],
  ];
  return {
    fx,
    fy,
    eyeTop,
    browH,
    eyes,
    /** The eyes of `surprised`: 2 units taller on both sides. */
    wide: eyes.map(([x, , ew]): Rect => [x, eyeTop - 2 * u, ew, 12 * u]),
    browY: fy - 34 * u,
    mouth: [fx - 12 * u, fy + 22 * u, 24 * u, 4 * u] as Rect,
    smile: [fx - 14 * u, fy + 20 * u, 28 * u, 4 * u] as Rect,
    open: [
      [fx - 8 * u, fy + 20 * u, 16 * u, 8 * u],
      [fx - 10 * u, fy + 18 * u, 20 * u, 12 * u],
    ] as readonly Rect[],
    cheeks: [
      [fx - 38 * u, fy + 2 * u, 10 * u, 6 * u],
      [fx + 28 * u, fy + 2 * u, 10 * u, 6 * u],
    ] as readonly Rect[],
    head: { cx: fx, cy: fy, rx: 46 * u, ry: 60 * u },
    hair: { cx: fx - 30 * u, cy: fy - 44 * u, rx: 10 * u, ry: 22 * u },
    hairPivot: [fx - 30 * u, fy - 66 * u] as const,
    fig: { cx: fx, cy: Math.round(0.62 * h), rx: 48 * u, ry: Math.round(0.36 * h) },
    plane: { cx: Math.round(0.2 * w), cy: Math.round(0.88 * h), rx: Math.round(0.12 * w), ry: Math.round(0.05 * h) },
  };
}

const WHITE: Rgb = [235, 235, 228];
const PUPIL: Rgb = [30, 30, 45];
const LID: Rgb = [200, 160, 140];
const BROW: Rgb = [50, 40, 30];
const LIPS: Rgb = [150, 60, 60];
const OPEN: Rgb = [90, 20, 30];
const BLUSH: Rgb = [230, 150, 150];
const HAIR: Rgb = [70, 45, 30];
const BODY: Rgb = [120, 80, 140];
const PLANE: Rgb = [40, 90, 60];
const BLOB: Rgb = [90, 30, 30];

function gradient(w: number, h: number): Raster {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      data.set([60 + Math.floor((100 * x) / w), 70 + Math.floor((80 * y) / h), 110, 255], (y * w + x) * 4);
    }
  }
  return { data, w, h };
}

function fillRect(r: Raster, [x0, y0, rw, rh]: Rect, c: Rgb): void {
  for (let y = Math.max(0, y0); y < Math.min(r.h, y0 + rh); y++) {
    for (let x = Math.max(0, x0); x < Math.min(r.w, x0 + rw); x++) {
      r.data.set(c, (y * r.w + x) * 4);
    }
  }
}

/** An ellipse's coverage at px (x, y): 1 inside, 0 outside, a linear ramp `feather` px wide across its edge. */
function ellipseCover(e: { cx: number; cy: number; rx: number; ry: number }, x: number, y: number, feather: number): number {
  const d = (Math.hypot((x + 0.5 - e.cx) / e.rx, (y + 0.5 - e.cy) / e.ry) - 1) * Math.min(e.rx, e.ry);
  return feather <= 0 ? (d <= 0 ? 1 : 0) : Math.min(1, Math.max(0, 0.5 - d / feather));
}

/** Paints colour `c` over `r` with the coverage of ellipse `e` (a straight-alpha blend). */
function paintEllipse(r: Raster, e: { cx: number; cy: number; rx: number; ry: number }, feather: number, c: Rgb): void {
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) {
      const a = ellipseCover(e, x, y, feather);
      if (a > 0) {
        const o = (y * r.w + x) * 4;
        for (let k = 0; k < 3; k++) {
          r.data[o + k] = Math.round((c[k] ?? 0) * a + (r.data[o + k] ?? 0) * (1 - a));
        }
      }
    }
  }
}

/** A white-on-transparent mask of ellipse `e` (§4.1: soft masks, value = coverage). */
function ellipseMask(w: number, h: number, e: { cx: number; cy: number; rx: number; ry: number }, feather: number): Raster {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = Math.round(255 * ellipseCover(e, x, y, feather));
      if (v > 0) {
        data.set([255, 255, 255, v], (y * w + x) * 4);
      }
    }
  }
  return { data, w, h };
}

/** Value noise in [0, 1): a hash per lattice point, bilinear between them (cell px). */
function noise(x: number, y: number, cell: number): number {
  const hash = (i: number, j: number): number => {
    let v = Math.imul(i, 374761393) + Math.imul(j, 668265263);
    v = Math.imul(v ^ (v >>> 13), 1274126177);
    return ((v ^ (v >>> 16)) >>> 0) / 4294967296;
  };
  const [gx, gy] = [x / cell, y / cell];
  const [i, j] = [Math.floor(gx), Math.floor(gy)];
  const [fx, fy] = [gx - i, gy - j];
  return (1 - fx) * (1 - fy) * hash(i, j) + fx * (1 - fy) * hash(i + 1, j) + (1 - fx) * fy * hash(i, j + 1) + fx * fy * hash(i + 1, j + 1);
}

type Face = {
  readonly eyes?: 'open' | 'half' | 'closed';
  readonly wide?: boolean;
  readonly brow?: 'rest' | 'raised' | 'angry';
  /** The angry accent's moved brow (or blob), drawn over the angry brow. */
  readonly accent?: 'apart' | 'touching' | null;
  readonly mouth?: 'rest' | 'smile';
  readonly open?: 0 | 1 | 2;
  readonly near?: 0 | 1 | 2;
  readonly cheeks?: boolean;
};

/**
 * One face of `ally` on the plate (hair painted in when `hair`): the gradient, the eyes, brows and mouth of `face`.
 * Every variant is rendered by this one function, so a state differs from its base exactly where its face differs.
 */
function render(k: Knobs, face: Face, hair: boolean): Raster {
  const g = geometry(k.w, k.h, k.u);
  const r = gradient(k.w, k.h);
  const browRow = { rest: g.browY, raised: g.browY - 3 * k.u, angry: g.eyeTop - 9 - g.browH }[face.brow ?? 'rest'];
  for (const [i, eye] of (face.wide === true ? g.wide : g.eyes).entries()) {
    const [x, y, ew, eh] = eye;
    fillRect(r, eye, WHITE);
    fillRect(r, [x + 7 * k.u, y + Math.floor(eh / 2) - 2 * k.u, 6 * k.u, 4 * k.u], PUPIL);
    if (face.eyes === 'half') {
      fillRect(r, [x, y, ew, Math.floor(eh / 2)], LID);
    } else if (face.eyes === 'closed') {
      fillRect(r, eye, LID);
      fillRect(r, [x, y + Math.floor(eh / 2), ew, Math.max(1, Math.floor(k.u / 2))], PUPIL);
    }
    const bx = g.eyes[i]?.[0] ?? x;
    if (face.accent === undefined || face.accent === null || !k.irregular) {
      const row = face.accent === 'apart' ? g.eyeTop - 5 - g.browH : face.accent === 'touching' ? g.eyeTop - 2 - g.browH : browRow;
      fillRect(r, [bx, row, 20 * k.u, g.browH], BROW);
    } else {
      fillRect(r, [bx, browRow, 20 * k.u, g.browH], BROW);
    }
  }
  if (face.accent !== undefined && face.accent !== null && k.irregular) {
    // W2: an irregular diff, a noise-thresholded blob over both eyes, its lowest row 6 px above the lids.
    const [x0, x1] = [(g.eyes[0]?.[0] ?? 0) - 2 * k.u, (g.eyes[1]?.[0] ?? 0) + 22 * k.u];
    for (let y = g.eyeTop - 6 - 4 * k.u; y <= g.eyeTop - 6; y++) {
      for (let x = x0; x < x1; x++) {
        if (noise(x, y, 3 * k.u) > 0.5) {
          r.data.set(BLOB, (y * k.w + x) * 4);
        }
      }
    }
  }
  fillRect(r, face.mouth === 'smile' ? g.smile : g.mouth, LIPS);
  const open = g.open[(face.open ?? 0) - 1];
  if (open !== undefined) {
    fillRect(r, open, OPEN);
  }
  if ((face.near ?? 0) > 0) {
    const [ex, , ew, eh] = g.eyes[0] ?? [0, 0, 0, 0];
    fillRect(r, [ex, g.eyeTop + eh + 2, ew, face.near === 1 ? 3 * k.u : 4 * k.u], OPEN);
  }
  if (face.cheeks === true) {
    for (const c of g.cheeks) {
      fillRect(r, c, BLUSH);
    }
  }
  if (hair) {
    paintEllipse(r, g.hair, 3, HAIR);
  }
  return r;
}

/** The synthetic shot `cafe` of `ally` (rest `neutral`; expressions smile, surprised, angry), knobs over the defaults. */
export function syntheticShot(over: Partial<Knobs> = {}): SyntheticShot {
  const k: Knobs = { ...DEFAULT_KNOBS, ...over };
  const g = geometry(k.w, k.h, k.u);
  const baked = !k.inpainted;
  const v = (face: Face): Raster => render(k, face, baked);
  const original = render(k, {}, true);
  if (k.figure) {
    paintEllipse(original, g.fig, 0, BODY);
    paintEllipse(original, g.hair, 3, HAIR);
  }
  if (k.plane) {
    paintEllipse(original, g.plane, 3, PLANE);
  }
  const smile = v({ mouth: 'smile', cheeks: true });
  if (k.relight !== 0) {
    for (let i = 0; i < smile.data.length; i++) {
      smile.data[i] = i % 4 === 3 ? 255 : Math.min(255, (smile.data[i] ?? 0) + k.relight);
    }
  }
  const files = new Map<string, Raster>([
    ['original.png', original],
    ['plate.png', v({})],
    ['mask.fig.ally.png', ellipseMask(k.w, k.h, g.fig, 0)],
    ['mask.head.ally.png', ellipseMask(k.w, k.h, g.head, 0)],
    ['mask.hair.ally.0.png', ellipseMask(k.w, k.h, g.hair, 3)],
    ['ally.half.png', v({ eyes: 'half' })],
    ['ally.closed.png', v({ eyes: 'closed' })],
    ['ally.accent.png', v({ brow: 'raised' })],
    ['ally.talk1.png', k.talkNearBlink ? v({ near: 1 }) : v({ open: 1 })],
    ['ally.talk2.png', k.talkNearBlink ? v({ near: 2 }) : v({ open: 2 })],
    ['ally.smile.png', smile],
    ['ally.smile.talk1.png', v({ mouth: 'smile', cheeks: true, open: 1 })],
    ['ally.smile.talk2.png', v({ mouth: 'smile', cheeks: true, open: 2 })],
    ['ally.surprised.png', v({ wide: true })],
    ['ally.surprised.half.png', v({ wide: true, eyes: 'half' })],
    ['ally.surprised.closed.png', v({ wide: true, eyes: 'closed' })],
    ['ally.angry.png', v({ brow: 'angry' })],
    ['ally.angry.accent.png', v({ brow: 'angry', accent: k.angryAccent })],
    ['ally.angry.accent.half.png', v({ brow: 'angry', accent: k.angryAccent, eyes: 'half' })],
    ['ally.angry.accent.closed.png', v({ brow: 'angry', accent: k.angryAccent, eyes: 'closed' })],
  ]);
  if (k.plane) {
    files.set('mask.plane.0.png', ellipseMask(k.w, k.h, g.plane, 3));
  }
  for (const name of k.missing) {
    files.delete(name);
  }
  // depth.png: a vertical 16-bit ramp at a quarter of the size, white (near) at the bottom (cut D12).
  const [dw, dh] = [Math.max(2, Math.floor(k.w / 4)), Math.max(2, Math.floor(k.h / 4))];
  const depth = new Uint16Array(dw * dh);
  for (let y = 0; y < dh; y++) {
    depth.fill(Math.round((65535 * y) / (dh - 1)), y * dw, (y + 1) * dw);
  }
  const layers: Record<string, unknown> = {
    hair_ally_0: { kind: 'hair', char: 'ally', mask: 'mask.hair.ally.0.png', pivot: [...g.hairPivot], depth: 0.6 },
  };
  if (k.figure) {
    layers['figure_ally'] = { kind: 'figure', char: 'ally', mask: 'mask.fig.ally.png', pivot: [g.fig.cx, g.fig.cy + g.fig.ry - 1], depth: 0.6 };
  }
  if (k.plane) {
    layers['plane_0'] = { kind: 'plane', char: null, mask: 'mask.plane.0.png', pivot: [g.plane.cx, g.plane.cy], depth: 0.9, front: true };
  }
  const json: Record<string, unknown> = {
    crop: [...(k.crop ?? [0, 0, k.w, k.h])],
    focus: [g.fx, g.fy],
    ...(k.q === null ? {} : { q: k.q }),
    layers,
  };
  return { w: k.w, h: k.h, files, depth: { data: depth, w: dw, h: dh, max: 65535 }, json };
}
