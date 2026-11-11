// The asset tool's extraction of a `src` shot (docs/plans/shots §4.1-4.3, lane SH3c), pure side: shot.json's decoder
// (the one reader of it, so SH12b's story-side plane reader can import it), the one transform (the crop), the diffs of
// every variant against its declared base, the expression and motion layers with the reuse rule, the cut-outs, the
// figure mask's moments, the depth grid and R6's alpha compare. Its inputs arrive through injected loaders (assets.ts:
// the files decoded by encode.ts; the tests: synthetic rasters), so it imports no sharp and no node:*; packing is
// shots.ts's, one packer for placeholders and real art.
import type { Result } from '../../src/story/catalog.ts';
import type { Box } from '../../src/story/shots.ts';
import type { BgId, CharId, ExprId } from '../../src/story/staging.ts';
import type { HotspotKey, RoomId, WorldSource } from '../../src/world/types.ts';
import type { Shot } from '../story/shots/list.ts';
import { COARSE, castProblems, facesOf } from './shots.ts';
import type { CastLayers, ChapterNeed, Ellipse, ExprLayers, Layer, PlaneLayer, Raster, ShotLayers } from './shots.ts';

/** A cut-out layer's kind (§4.1 `layers`). */
export type LayerKind = 'hair' | 'plane' | 'figure';
/** One cut-out layer of shot.json: its mask in the shot's directory; `pivot` in original px (§4.1). */
export type SourceLayer = {
  readonly name: string;
  readonly kind: LayerKind;
  /** A cast member; null for a plane that belongs to no one. */
  readonly char: CharId | null;
  readonly mask: string;
  readonly pivot: readonly [number, number];
  readonly depth: number;
  readonly front: boolean;
};
/** A shot.json, decoded (cut D3): `crop` and `focus` in original px, `q` the AVIF quality of the shot's files. */
export type ShotSource = {
  readonly crop: Box;
  readonly focus: readonly [number, number];
  readonly q: number;
  /** By name. */
  readonly layers: readonly SourceLayer[];
};
/** depth.png's samples (cut D12): 8- or 16-bit grey, white near; any size. */
export type DepthSource = { readonly data: Uint16Array; readonly w: number; readonly h: number; readonly max: 255 | 65535 };

/** §4.1 `q`: the default (`encode.ts`'s AVIF quality) and the floor. */
export const DEFAULT_Q = 50;
export const MIN_Q = 40;
const MAX_Q = 100;

const SOURCE_KEYS = ['crop', 'focus', 'q', 'layers', 'ambient'];
const LAYER_KEYS = ['kind', 'char', 'mask', 'pivot', 'depth', 'front'];
const LAYER_KINDS: readonly LayerKind[] = ['hair', 'plane', 'figure'];
const ID_RE = /^[a-z][a-z0-9_]*$/;
/** A mask file of a kind (§4.1): `mask.hair.<char>.<n>.png`, `mask.plane.<n>.png`, `mask.fig.<char>.png`. */
const MASK_RE: Readonly<Record<LayerKind, RegExp>> = {
  hair: /^mask\.hair\.[a-z0-9_]+(\.[a-z0-9_]+)*\.png$/,
  plane: /^mask\.plane\.[a-z0-9_]+(\.[a-z0-9_]+)*\.png$/,
  figure: /^mask\.fig\.[a-z0-9_]+(\.[a-z0-9_]+)*\.png$/,
};

type Obj = Readonly<Record<string, unknown>>;

function isObject(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isPoint(v: unknown): v is readonly [number, number] {
  return Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n));
}

/**
 * Decodes `assets/src/shot/<shot>/shot.json` (§4.1, cut D3): exact keys; `crop` integers; `focus` and every `pivot` in
 * original px inside the crop; `q` an integer in 40..100 (absent: 50); `layers` (absent: none) each a hair lock, plane or
 * figure with its mask; a non-empty `ambient` refused by name (D14: SH9's, never silently dropped). Every problem names
 * `<shot>/shot.json` and the key path.
 */
export function decodeShotSource(raw: unknown, shot: BgId): Result<ShotSource, string[]> {
  const file = `${shot}/shot.json`;
  if (!isObject(raw)) {
    return { ok: false, error: [`${file}: not a JSON object`] };
  }
  const issues: string[] = [];
  const bad = (path: string, why: string): void => {
    issues.push(`${file}: ${path}: ${why}`);
  };
  for (const k of Object.keys(raw).filter((x) => !SOURCE_KEYS.includes(x))) {
    bad(k, `unknown key (expected ${SOURCE_KEYS.join(', ')})`);
  }
  for (const k of ['crop', 'focus'].filter((x) => !Object.hasOwn(raw, x))) {
    bad(k, 'missing');
  }
  const c = raw['crop'];
  const crop =
    Array.isArray(c) && c.length === 4 && c.every((n, i) => typeof n === 'number' && Number.isInteger(n) && n >= (i < 2 ? 0 : 1))
      ? ([c[0], c[1], c[2], c[3]] as Box) // four checked integers
      : null;
  if (crop === null && Object.hasOwn(raw, 'crop')) {
    bad('crop', `${JSON.stringify(c)} is not [x, y, w, h] in integers (x, y >= 0, w, h >= 1)`);
  }
  const inCrop = (path: string, v: unknown): readonly [number, number] | null => {
    if (!isPoint(v)) {
      bad(path, `${JSON.stringify(v) ?? 'undefined'} is not a point [x, y]`);
      return null;
    }
    if (crop !== null && (v[0] < crop[0] || v[1] < crop[1] || v[0] > crop[0] + crop[2] || v[1] > crop[1] + crop[3])) {
      bad(path, `${JSON.stringify(v)} is outside the crop ${JSON.stringify(crop)} (original px)`);
    }
    return v;
  };
  const focus = Object.hasOwn(raw, 'focus') ? inCrop('focus', raw['focus']) : null;
  const q = raw['q'] ?? DEFAULT_Q;
  if (typeof q !== 'number' || !Number.isInteger(q) || q < MIN_Q || q > MAX_Q) {
    bad('q', `${JSON.stringify(q)} is not an integer in ${MIN_Q}..${MAX_Q}`);
  }
  const ambient = raw['ambient'] ?? [];
  if (!Array.isArray(ambient)) {
    bad('ambient', 'not an array');
  } else if (ambient.length > 0) {
    bad('ambient', "not supported yet (a src shot's ambient is SH9's; declare none)");
  }
  const rawLayers = raw['layers'] ?? {};
  if (!isObject(rawLayers)) {
    bad('layers', 'not an object of layers by name');
  }
  const layers: SourceLayer[] = [];
  for (const [name, v] of Object.entries(isObject(rawLayers) ? rawLayers : {}).sort(([a], [b]) => (a < b ? -1 : 1))) {
    const p = `layers.${name}`;
    if (!ID_RE.test(name) || !isObject(v)) {
      bad(p, ID_RE.test(name) ? 'not an object' : 'not a layer name [a-z][a-z0-9_]*');
      continue;
    }
    const before = issues.length;
    for (const k of Object.keys(v).filter((x) => !LAYER_KEYS.includes(x))) {
      bad(`${p}.${k}`, `unknown key (expected ${LAYER_KEYS.join(', ')})`);
    }
    for (const k of LAYER_KEYS.filter((x) => x !== 'front' && !Object.hasOwn(v, x))) {
      bad(`${p}.${k}`, 'missing');
    }
    const kind = LAYER_KINDS.find((x) => x === v['kind']);
    if (kind === undefined) {
      bad(`${p}.kind`, `${JSON.stringify(v['kind']) ?? 'undefined'} is not one of ${LAYER_KINDS.join(', ')}`);
    }
    const char = v['char'];
    if (char === null ? kind !== 'plane' : typeof char !== 'string' || !ID_RE.test(char)) {
      bad(`${p}.char`, char === null ? 'null is for a plane only' : 'not a character id');
    }
    const mask = v['mask'];
    if (kind !== undefined && (typeof mask !== 'string' || !MASK_RE[kind].test(mask))) {
      bad(`${p}.mask`, `${JSON.stringify(mask) ?? 'undefined'} is not mask.${kind === 'figure' ? 'fig' : kind}.<name>.png`);
    }
    const pivot = inCrop(`${p}.pivot`, v['pivot']);
    const depth = v['depth'];
    if (typeof depth !== 'number' || !Number.isFinite(depth) || depth < 0 || depth > 1) {
      bad(`${p}.depth`, `${JSON.stringify(depth) ?? 'undefined'} is not a number in 0..1`);
    }
    const front = v['front'] ?? false;
    if (typeof front !== 'boolean') {
      bad(`${p}.front`, 'not a boolean');
    }
    if (issues.length === before && kind !== undefined && pivot !== null) {
      // Every field checked above.
      layers.push({ name, kind, char: char as CharId | null, mask: mask as string, pivot, depth: depth as number, front: front as boolean });
    }
  }
  if (issues.length > 0 || crop === null || focus === null) {
    return { ok: false, error: issues };
  }
  return { ok: true, value: { crop, focus, q: q as number, layers } }; // q checked above
}

// ---------------------------------------------------------------------------------------------------------------
// Rasters, diffs and boxes (§4.2; cut D5)

/** Inclusive px bounds `[x0, y0, x1, y1]`. */
type Bounds = readonly [x0: number, y0: number, x1: number, y1: number];
/** A px set over a raster of width `w` (one byte per px, 1 = in the set) with its count and bounds. */
type Px = { readonly bits: Uint8Array; readonly w: number; readonly count: number; readonly bounds: Bounds | null };

/** The one transform (§4.1): the px of `r` inside `box`, no resampling. */
export function cropRaster(r: Raster, [x, y, w, h]: Box): Raster {
  const data = new Uint8Array(w * h * 4);
  for (let row = 0; row < h; row++) {
    const from = ((y + row) * r.w + x) * 4;
    data.set(r.data.subarray(from, from + w * 4), row * w * 4);
  }
  return { data, w, h };
}

/** §4.2: the px of `v` that differ from `base` by more than 2/255 in any channel (cut D5). */
function changed(v: Raster, base: Raster): Px {
  const bits = new Uint8Array(v.w * v.h);
  let [x0, y0, x1, y1, count] = [v.w, v.h, -1, -1, 0];
  for (let y = 0; y < v.h; y++) {
    for (let x = 0; x < v.w; x++) {
      const o = (y * v.w + x) * 4;
      let d = 0;
      for (let k = 0; k < 4; k++) {
        d = Math.max(d, Math.abs((v.data[o + k] ?? 0) - (base.data[o + k] ?? 0)));
      }
      if (d > 2) {
        bits[y * v.w + x] = 1;
        count++;
        [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
      }
    }
  }
  return { bits, w: v.w, count, bounds: count === 0 ? null : [x0, y0, x1, y1] };
}

/** A mask's value at px `i` (cut D5): `ch0 × α / 255`, so a grey mask and a white-on-transparent one read the same. */
function maskValue(r: Raster, i: number): number {
  return Math.round(((r.data[i * 4] ?? 0) * (r.data[i * 4 + 3] ?? 0)) / 255);
}

/** The px of a mask with a value above 0. */
function inMask(r: Raster): Px {
  const bits = new Uint8Array(r.w * r.h);
  let [x0, y0, x1, y1, count] = [r.w, r.h, -1, -1, 0];
  for (let i = 0; i < r.w * r.h; i++) {
    if (maskValue(r, i) > 0) {
      const [x, y] = [i % r.w, Math.floor(i / r.w)];
      bits[i] = 1;
      count++;
      [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
    }
  }
  return { bits, w: r.w, count, bounds: count === 0 ? null : [x0, y0, x1, y1] };
}

function dilate(b: Bounds, r: number): Bounds {
  return [b[0] - r, b[1] - r, b[2] + r, b[3] + r];
}

function meet(a: Bounds, b: Bounds): Bounds | null {
  const m: Bounds = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])];
  return m[0] > m[2] || m[1] > m[3] ? null : m;
}

function join(a: Bounds | null, b: Bounds | null): Bounds | null {
  if (a === null || b === null) {
    return a ?? b;
  }
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

/** `px` dilated by `r` px (Chebyshev: a square element), one byte per px over its raster of `h` rows. */
function dilateBits(px: Px, h: number, r: number): Uint8Array {
  const w = px.w;
  const rows = new Uint8Array(w * h);
  const run = new Int32Array(Math.max(w, h) + 1);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      run[x + 1] = (run[x] ?? 0) + (px.bits[y * w + x] ?? 0);
    }
    for (let x = 0; x < w; x++) {
      rows[y * w + x] = (run[Math.min(w, x + r + 1)] ?? 0) - (run[Math.max(0, x - r)] ?? 0) > 0 ? 1 : 0;
    }
  }
  const out = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      run[y + 1] = (run[y] ?? 0) + (rows[y * w + x] ?? 0);
    }
    for (let y = 0; y < h; y++) {
      out[y * w + x] = (run[Math.min(h, y + r + 1)] ?? 0) - (run[Math.max(0, y - r)] ?? 0) > 0 ? 1 : 0;
    }
  }
  return out;
}

/** Whether two boxes share a px (half-open). */
function overlap(a: Box, b: Box): boolean {
  return a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
}

/**
 * Original-px bounds on the plate (crop `crop`), evened outward and clamped to the plate (cut D5: the plate is even by
 * R5, so every packed size stays even); null bounds give an empty box.
 */
function onPlate(b: Bounds | null, crop: Box): Box {
  if (b === null) {
    return [0, 0, 0, 0];
  }
  const x0 = Math.max(0, 2 * Math.floor((b[0] - crop[0]) / 2));
  const y0 = Math.max(0, 2 * Math.floor((b[1] - crop[1]) / 2));
  const x1 = Math.min(crop[2], 2 * Math.ceil((b[2] - crop[0] + 1) / 2));
  const y1 = Math.min(crop[3], 2 * Math.ceil((b[3] - crop[1] + 1) / 2));
  return x1 <= x0 || y1 <= y0 ? [0, 0, 0, 0] : [x0, y0, x1 - x0, y1 - y0];
}

/** Whether any px of `d` (original geometry) lies inside plate box `b` (crop `crop`). */
function hits(d: Px, b: Box, crop: Box): boolean {
  for (let y = b[1]; y < b[1] + b[3]; y++) {
    for (let x = b[0]; x < b[0] + b[2]; x++) {
      if (d.bits[(y + crop[1]) * d.w + x + crop[0]] === 1) {
        return true;
      }
    }
  }
  return false;
}

/** One cut state (§4.2): its file, its box on the plate, its variant's px and its diff over the box (one byte per px). */
type State = { readonly file: string; readonly box: Box; readonly px: Raster; readonly diff: Uint8Array };

function stateOf(file: string, v: Raster, d: Px, box: Box, crop: Box): State {
  const diff = new Uint8Array(box[2] * box[3]);
  for (let y = 0; y < box[3]; y++) {
    const from = (y + box[1] + crop[1]) * d.w + box[0] + crop[0];
    diff.set(d.bits.subarray(from, from + box[2]), y * box[2]);
  }
  return { file, box, px: cropRaster(v, [box[0] + crop[0], box[1] + crop[1], box[2], box[3]]), diff };
}

/**
 * R2's test (cut D6, m7): whether a changed px of a state of `a` lies within 4 px (Chebyshev) of a changed px of a state
 * of `b`, i.e. inside the alpha support a masked `b` draws over it (plate px).
 */
function touch(a: readonly State[], b: readonly State[]): boolean {
  const [x0, y0] = [Math.min(...a.map((s) => s.box[0])), Math.min(...a.map((s) => s.box[1]))];
  const [x1, y1] = [Math.max(...a.map((s) => s.box[0] + s.box[2])), Math.max(...a.map((s) => s.box[1] + s.box[3]))];
  const [rw, rh] = [x1 - x0, y1 - y0];
  const near = new Uint8Array(Math.max(0, rw * rh));
  for (const s of b) {
    for (let y = 0; y < s.box[3]; y++) {
      for (let x = 0; x < s.box[2]; x++) {
        if (s.diff[y * s.box[2] + x] !== 1) {
          continue;
        }
        const [px, py] = [s.box[0] + x - x0, s.box[1] + y - y0];
        for (let qy = Math.max(0, py - 4); qy <= Math.min(rh - 1, py + 4); qy++) {
          near.fill(1, qy * rw + Math.max(0, px - 4), qy * rw + Math.min(rw - 1, px + 4) + 1);
        }
      }
    }
  }
  return a.some((s) => s.diff.some((bit, i) => bit === 1 && near[(s.box[1] + Math.floor(i / s.box[2]) - y0) * rw + s.box[0] + (i % s.box[2]) - x0] === 1));
}

/** A rectangle layer: the state's own px over its box, opaque as its variant is (cut D5). */
function rectLayer(st: State): Layer<Raster> {
  return { box: st.box, fill: st.px };
}

/** A masked layer's alpha by Chebyshev distance to its own diff (§4.2 step 7b, cut D7): dilated 2 px, feathered 2 px. */
const MASKED_ALPHA: readonly number[] = [255, 255, 255, 170, 85, 0];

/**
 * §4.2 step 7b (m7), a masked layer: the state's px with alpha 255 within 2 px (Chebyshev) of its own diff, 170 at 3,
 * 85 at 4 and 0 beyond. Outside its diff a state equals its base, so the feathered edge composites exact px.
 */
function maskedLayer(st: State): Layer<Raster> {
  const [w, h] = [st.box[2], st.box[3]];
  const dist = new Uint8Array(w * h).fill(5);
  st.diff.forEach((bit, i) => {
    if (bit === 1) {
      dist[i] = 0;
    }
  });
  // Breadth first over the 8-neighbourhood: level k is Chebyshev distance k.
  for (let k = 1; k <= 4; k++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (dist[y * w + x] !== 5) {
          continue;
        }
        let near = false;
        for (let dy = -1; dy <= 1 && !near; dy++) {
          for (let dx = -1; dx <= 1 && !near; dx++) {
            const [nx, ny] = [x + dx, y + dy];
            near = nx >= 0 && ny >= 0 && nx < w && ny < h && dist[ny * w + nx] === k - 1;
          }
        }
        if (near) {
          dist[y * w + x] = k;
        }
      }
    }
  }
  const data = Uint8Array.from(st.px.data);
  dist.forEach((d, i) => {
    data[i * 4 + 3] = MASKED_ALPHA[d] ?? 0;
  });
  return { box: st.box, fill: { data, w, h }, masked: true };
}

/** `base` with a state's px over its box: the state's own variant, exactly, once R3 holds (its diff is inside its box). */
function composite(base: Raster, st: State, crop: Box): Raster {
  const data = Uint8Array.from(base.data);
  for (let y = 0; y < st.box[3]; y++) {
    data.set(st.px.data.subarray(y * st.box[2] * 4, (y + 1) * st.box[2] * 4), ((y + st.box[1] + crop[1]) * base.w + st.box[0] + crop[0]) * 4);
  }
  return { data, w: base.w, h: base.h };
}

/**
 * §4.2 step 4, a cut-out: the original's px with alpha = the mask's value, trimmed to the mask's px inside the crop and
 * evened; null when no px of the mask is inside the crop.
 */
function cutOut(mask: Raster, original: Raster, crop: Box): Layer<Raster> | null {
  const px = inMask(mask);
  const box = onPlate(px.bounds === null ? null : meet(px.bounds, [crop[0], crop[1], crop[0] + crop[2] - 1, crop[1] + crop[3] - 1]), crop);
  if (box[2] === 0) {
    return null;
  }
  const fill = cropRaster(original, [box[0] + crop[0], box[1] + crop[1], box[2], box[3]]);
  for (let y = 0; y < box[3]; y++) {
    for (let x = 0; x < box[2]; x++) {
      fill.data[(y * box[2] + x) * 4 + 3] = maskValue(mask, (y + box[1] + crop[1]) * mask.w + x + box[0] + crop[0]);
    }
  }
  return { box, fill };
}

/** R7's measure: the mean, over the mask's core (value >= 128) inside the crop, of the max-channel |plate − original|. */
function inpaintMean(mask: Raster, plate: Raster, original: Raster, crop: Box): number {
  let [sum, n] = [0, 0];
  for (let y = crop[1]; y < crop[1] + crop[3]; y++) {
    for (let x = crop[0]; x < crop[0] + crop[2]; x++) {
      const i = y * mask.w + x;
      if (maskValue(mask, i) >= 128) {
        let d = 0;
        for (let k = 0; k < 3; k++) {
          d = Math.max(d, Math.abs((plate.data[i * 4 + k] ?? 0) - (original.data[i * 4 + k] ?? 0)));
        }
        [sum, n] = [sum + d, n + 1];
      }
    }
  }
  return n === 0 ? 0 : sum / n;
}

// ---------------------------------------------------------------------------------------------------------------
// R6 (§4.3; cut D9, RULINGS 267): an encoded file's alpha against its source's

/** R6's tolerance: an encoded file's alpha stays within this of its source's at every px (/255). */
export const ALPHA_TOLERANCE = 8;
/** The worst |α decoded − α source| over every px, and the first px (row-major) where it occurs. */
export type AlphaWorst = { readonly err: number; readonly x: number; readonly y: number };

/** The worst alpha error of `decoded` against `source` (same size: an encoder never resizes, else a bug). */
export function alphaWorst(decoded: Raster, source: Raster): AlphaWorst {
  if (decoded.w !== source.w || decoded.h !== source.h) {
    throw new Error(`invariant: a decoded file is its source's size (${decoded.w} × ${decoded.h}, not ${source.w} × ${source.h})`);
  }
  let [err, at] = [0, 0];
  for (let i = 0; i < source.w * source.h; i++) {
    const d = Math.abs((decoded.data[i * 4 + 3] ?? 0) - (source.data[i * 4 + 3] ?? 0));
    if (d > err) {
      [err, at] = [d, i];
    }
  }
  return { err, x: at % source.w, y: Math.floor(at / source.w) };
}

/** R6 for `what` (`<id> <tier> <format>`): one line when some px's decoded alpha is more than 8/255 off its source's. */
export function alphaProblems(what: string, decoded: Raster, source: Raster): string[] {
  const w = alphaWorst(decoded, source);
  return w.err <= ALPHA_TOLERANCE ? [] : [`${what}: alpha ${w.err}/255 off at (${w.x}, ${w.y}) (R6: within ${ALPHA_TOLERANCE}/255 at every px)`];
}

// ---------------------------------------------------------------------------------------------------------------
// Weight fields and depth (§4.2 steps 5-6; cut D12, D13)

/**
 * §4.2 step 5 (cut D13): the moments of a figure mask inside the crop, in plate px (px centres), weighted by value / 255:
 * the centre, `rx` and `ry` = 2σ along the principal axes (major first), `rot` the major axis's angle in radians (plate
 * axes, y down), and the feet, the centroid of the mask's lowest row. Null when no px of the mask is inside the crop.
 */
export function maskMoments(mask: Raster, crop: Box): { readonly fig: Ellipse; readonly feet: readonly [number, number] } | null {
  const [cx, cy, cw, ch] = crop;
  let [sw, sx, sy] = [0, 0, 0];
  let [low, lowW, lowX] = [-1, 0, 0];
  for (let y = cy; y < cy + ch; y++) {
    for (let x = cx; x < cx + cw; x++) {
      const w = maskValue(mask, y * mask.w + x) / 255;
      if (w > 0) {
        [sw, sx, sy] = [sw + w, sx + w * (x - cx + 0.5), sy + w * (y - cy + 0.5)];
        if (y > low) {
          [low, lowW, lowX] = [y, 0, 0];
        }
        [lowW, lowX] = [lowW + w, lowX + w * (x - cx + 0.5)];
      }
    }
  }
  if (sw === 0) {
    return null;
  }
  const [mx, my] = [sx / sw, sy / sw];
  let [cxx, cyy, cxy] = [0, 0, 0];
  for (let y = cy; y < cy + ch; y++) {
    for (let x = cx; x < cx + cw; x++) {
      const w = maskValue(mask, y * mask.w + x) / 255;
      if (w > 0) {
        const [dx, dy] = [x - cx + 0.5 - mx, y - cy + 0.5 - my];
        [cxx, cyy, cxy] = [cxx + w * dx * dx, cyy + w * dy * dy, cxy + w * dx * dy];
      }
    }
  }
  [cxx, cyy, cxy] = [cxx / sw, cyy / sw, cxy / sw];
  const half = Math.hypot((cxx - cyy) / 2, cxy);
  const [l1, l2] = [(cxx + cyy) / 2 + half, Math.max(0, (cxx + cyy) / 2 - half)];
  return {
    fig: { cx: mx, cy: my, rx: 2 * Math.sqrt(l1), ry: 2 * Math.sqrt(l2), rot: 0.5 * Math.atan2(2 * cxy, cxx - cyy) },
    feet: [lowX / lowW, low - cy + 0.5],
  };
}

/**
 * §4.2 step 6 (cut D12): the depth map sampled bilinearly (px centres) at the 13 × 24 vertices, rows top to bottom, each
 * vertex placed as `placeholderDepth` places it (y = j / (rows − 1) × h on the plate) and mapped plate -> original ->
 * depth map by scale; white is near, n = v / max, u8 = round(255 n). No min-max normalisation: the owner's calibration
 * stays.
 */
export function depthGrid(d: DepthSource, crop: Box, original: { readonly w: number; readonly h: number }): Uint8Array {
  const grid = new Uint8Array(COARSE.cols * COARSE.rows);
  const at = (x: number, y: number): number => d.data[y * d.w + x] ?? 0;
  for (let j = 0; j < COARSE.rows; j++) {
    for (let i = 0; i < COARSE.cols; i++) {
      const ox = crop[0] + (i / (COARSE.cols - 1)) * crop[2];
      const oy = crop[1] + (j / (COARSE.rows - 1)) * crop[3];
      const sx = Math.min(d.w - 1, Math.max(0, (ox * d.w) / original.w - 0.5));
      const sy = Math.min(d.h - 1, Math.max(0, (oy * d.h) / original.h - 0.5));
      const [x0, y0] = [Math.min(Math.floor(sx), d.w - 2), Math.min(Math.floor(sy), d.h - 2)];
      const [fx, fy] = [sx - x0, sy - y0];
      const v = (1 - fx) * (1 - fy) * at(x0, y0) + fx * (1 - fy) * at(x0 + 1, y0) + (1 - fx) * fy * at(x0, y0 + 1) + fx * fy * at(x0 + 1, y0 + 1);
      grid[j * COARSE.cols + i] = Math.round((255 * v) / d.max);
    }
  }
  return grid;
}

// ---------------------------------------------------------------------------------------------------------------
// Extraction (§4.2 steps 1-6)

/** A rect where a room draws a prop (R8), in room px: a room shot's plate px (R5: exactly 1080 × 2048). */
export type RoomRect = { readonly room: string; readonly rect: Box };

/**
 * R8's rects (cut D6) of every room of `world` whose bg is shot `s`, in source order: a take or object hotspot's rect when
 * it has a prop or states (any hotspot's when a state draws a prop there), each state's patch rect, and each decor's
 * rect with its states' patch rects (mechanics/data/visual.ts).
 */
export function roomPropRects(world: WorldSource, s: BgId): RoomRect[] {
  const out: RoomRect[] = [];
  const { visual } = world.mods;
  for (const section of Object.values(world.sections)) {
    for (const [room, r] of Object.entries(section.rooms)) {
      if (r.bg !== s) {
        continue;
      }
      for (const h of r.hotspots) {
        const states = Object.values(visual.hotspots[`${room}.${h.id}` as HotspotKey]?.states ?? {});
        const kept = (h.kind === 'take' || h.kind === 'object') && (h.prop !== null || states.length > 0);
        if (kept || states.some((a) => 'prop' in a && a.prop !== null)) {
          out.push({ room, rect: h.rect });
        }
        out.push(...states.flatMap((a) => ('patch' in a ? [{ room, rect: a.rect }] : [])));
      }
      for (const d of visual.decor[room as RoomId] ?? []) {
        out.push({ room, rect: d.rect }, ...Object.values(d.states).flatMap((a) => ('patch' in a ? [{ room, rect: a.rect }] : [])));
      }
    }
  }
  return out;
}

/** Whether `mask` (original geometry) has a px with a value above 0 inside room rect `rect` on the plate (crop `crop`). */
function covers(mask: Raster, [rx, ry, rw, rh]: Box, crop: Box): boolean {
  for (let y = Math.max(0, ry); y < Math.min(crop[3], ry + rh); y++) {
    for (let x = Math.max(0, rx); x < Math.min(crop[2], rx + rw); x++) {
      if (maskValue(mask, (y + crop[1]) * mask.w + x + crop[0]) > 0) {
        return true;
      }
    }
  }
  return false;
}

/**
 * D14 and R9's clauses on shot.json's declared layers against the shot list's cast: a layer of a non-member, a plane in
 * a cast-less shot (its sheet is not listed yet), a `figure: true` member without a figure layer, a second figure layer.
 * They need no pixel, so they are reported before any file is read.
 */
function declarationProblems(shot: Shot, source: ShotSource): string[] {
  const s = shot.id;
  const problems: string[] = [];
  const cast = new Set<string>(shot.cast.map((m) => m.char));
  for (const l of source.layers.filter((x) => x.char !== null && !cast.has(x.char))) {
    problems.push(`${s}/shot.json: layers.${l.name}.char: ${String(l.char)} is not a cast member of ${s}`);
  }
  if (shot.cast.length === 0 && source.layers.some((l) => l.kind === 'plane')) {
    problems.push(`${s}: a plane layer in a shot without a cast (a cast-less src shot's sheet is not listed yet)`);
  }
  for (const m of shot.cast) {
    const figures = source.layers.filter((l) => l.kind === 'figure' && l.char === m.char);
    if (m.figure && figures.length === 0) {
      problems.push(`${s}: ${m.char} has figure: true but no figure layer (R9: a hop / bounce member is cut out)`);
    }
    for (const l of figures.slice(1)) {
      problems.push(`${s}/shot.json: layers.${l.name}: a second figure layer of ${m.char}`);
    }
  }
  return problems;
}

/** What `extractShot` reads: the shot list's declaration, its shot.json, every chapter's need of it, its files. */
export type ExtractInput = {
  readonly shot: Shot;
  readonly source: ShotSource;
  readonly needs: readonly ChapterNeed[];
  /** A file of the shot's source directory, decoded to RGBA; null when the directory has no such file. */
  readonly load: (file: string) => Promise<Raster | null>;
  /** depth.png's samples; null when absent. */
  readonly loadDepth: () => Promise<DepthSource | null>;
  /** R8: the prop rects of the rooms that draw this shot (`roomPropRects`); none when absent. */
  readonly rooms?: readonly RoomRect[];
};
/** A `src` shot's layer set on its plate (the crop), its depth grid and its R8 warnings. */
export type Extracted = { readonly layers: ShotLayers<Raster>; readonly depth: Uint8Array; readonly warnings: readonly string[] };

/**
 * Extracts a `src` shot (§4.2 steps 1-6): the rest motion boxes E / M / B, each needed expression's layer, its motion
 * states (its own where it changes that box, else the rest's own `Layer`: the reuse rule, step 3), the cut-out layers,
 * the figure moments, the head mask's box and the depth grid; every problem reported by name, nothing thrown.
 */
export async function extractShot(input: ExtractInput): Promise<Result<Extracted, string[]>> {
  const { shot, source } = input;
  const s = shot.id;
  const declared = declarationProblems(shot, source);
  if (declared.length > 0) {
    return { ok: false, error: declared };
  }
  const crop = source.crop;
  const problems: string[] = [];
  const original = await input.load('original.png');
  const plate = await input.load('plate.png');
  for (const [file, r] of [['original.png', original], ['plate.png', plate]] as const) {
    if (r === null) {
      problems.push(`${s}: ${file} missing`);
    }
  }
  if (original === null || plate === null) {
    return { ok: false, error: problems };
  }
  const [W, H] = [original.w, original.h];
  if (plate.w !== W || plate.h !== H) {
    return { ok: false, error: [`${s}/plate.png: ${plate.w} × ${plate.h}, not original.png's ${W} × ${H}`] };
  }
  if (crop[0] + crop[2] > W || crop[1] + crop[3] > H) {
    return { ok: false, error: [`${s}/shot.json: crop: ${JSON.stringify(crop)} is not inside original.png (${W} × ${H})`] };
  }
  const cropB: Bounds = [crop[0], crop[1], crop[0] + crop[2] - 1, crop[1] + crop[3] - 1];
  const sized = (file: string, r: Raster | null): Raster | null => {
    if (r !== null && (r.w !== W || r.h !== H)) {
      problems.push(`${s}/${file}: ${r.w} × ${r.h}, not original.png's ${W} × ${H}`);
      return null;
    }
    return r;
  };
  /** A file the shot needs; its absence is reported, as R4 with who needs it for a face state (`who`). */
  const need = async (file: string, who: string | null = null): Promise<Raster | null> => {
    const r = await input.load(file);
    if (r === null) {
      problems.push(`${s}: ${file} missing${who === null ? '' : ` (R4: a needed state; ${who})`}`);
    }
    return sized(file, r);
  };
  /** Masks reported empty (O1): R9 then adds no line of its own for them (one cause, one message). */
  const empty = new Set<string>();
  /** A mask R9 asks for: its absence is R9's to report (`castProblems`), an empty one is reported here (O1). */
  const mask = async (file: string): Promise<Raster | null> => {
    const r = sized(file, await input.load(file));
    if (r !== null && meet(inMask(r).bounds ?? [0, 0, -1, -1], cropB) === null) {
      problems.push(`${s}/${file}: empty`);
      empty.add(file);
      return null;
    }
    return r;
  };
  const toPlate = (p: readonly [number, number]): readonly [number, number] => [p[0] - crop[0], p[1] - crop[1]];

  const cutLayer = async (l: SourceLayer): Promise<Layer<Raster> | null> => {
    const m = await need(l.mask);
    if (m === null) {
      return null;
    }
    const layer = cutOut(m, original, crop);
    if (layer === null) {
      problems.push(`${s}/${l.mask}: empty`);
      empty.add(l.mask);
      return null;
    }
    const mean = inpaintMean(m, plate, original, crop);
    if (mean <= 8) {
      // The layer stays (the run fails on this line), so R9 adds no "no hair lock" for the same cause.
      problems.push(`${s}: ${l.mask} is not inpainted in plate.png (R7: its core differs from original.png by a mean of ${mean.toFixed(1)}/255, not over 8)`);
    }
    return layer;
  };

  /**
   * Who needs `c` in `x` (R2's and R4's messages): the line IDs that show it (with `talk`, of the chapters where `c`
   * speaks in it), sorted, once each; for a rest state no line shows, the chapters that show the shot.
   */
  const whoNeeds = (c: CharId, x: ExprId, talk = false): string => {
    const lines = input.needs.flatMap(({ need }) => (need.faces[c] ?? []).filter((f) => f.expr === x && (!talk || f.talk)).flatMap((f) => f.lines));
    return lines.length > 0 ? `lines ${[...new Set(lines)].sort().join(', ')}` : `chapters ${[...new Set(input.needs.map((n) => n.ch))].sort().join(', ')}`;
  };

  /**
   * R1 and R3 for one variant against its base (rev. 2): no changed px outside `c`'s head mask dilated 8 px (`near`), and
   * none outside its box on the plate, which bbox(diff) dilated 4 becomes once clipped to the crop and the head's bbox
   * dilated 8. True when it registers; else its one problem is reported (an unregistered diff reaches no other check).
   */
  const registers = (file: string, c: CharId, d: Px, near: Uint8Array, at: Box): boolean => {
    const report = (rule: (n: number, x: number, y: number) => string, outside: (i: number, x: number, y: number) => boolean): boolean => {
      let [n, first] = [0, -1];
      const [x0, y0, x1, y1] = d.bounds ?? [0, 0, -1, -1];
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const i = y * d.w + x;
          if (d.bits[i] === 1 && outside(i, x, y)) {
            [n, first] = [n + 1, first < 0 ? i : first];
          }
        }
      }
      if (n > 0) {
        problems.push(rule(n, first % d.w, Math.floor(first / d.w)));
      }
      return n === 0;
    };
    const [bx, by] = [at[0] + crop[0], at[1] + crop[1]];
    return (
      report(
        (n, x, y) => `${s}: ${file} changes ${n} px outside ${c}'s head mask dilated 8 px, the first at (${x}, ${y}) (R1: a variant equals its base there)`,
        (i) => near[i] !== 1,
      ) &&
      report(
        (n, x, y) => `${s}: ${file} changes ${n} px outside its box on the plate, the first at (${x}, ${y}) (R3: a box clipped to the plate and the head loses no changed px)`,
        (_, x, y) => x < bx || y < by || x >= bx + at[2] || y >= by + at[3],
      )
    );
  };

  /**
   * §4.2 steps 1-3 for one face member: the rest states against the plate (E, B, and M where the rest is spoken), each
   * needed expression's layer against the plate, and its motion states: its own against it where its diff meets that
   * rest box, else the rest's own `Layer` (copied into its file by the packer, §2.6). Every variant registers (R1, R3);
   * R2 then tests the motion layers each expression uses together.
   */
  const faceStates = async (
    c: CharId,
    rest: ExprId,
    needed: ReadonlyMap<ExprId, boolean>,
    head: { readonly clip: Bounds; readonly near: Uint8Array },
  ): Promise<Map<ExprId, ExprLayers<Raster>>> => {
    const box = (b: Bounds | null): Box => onPlate(b === null ? null : meet(dilate(b, 4), head.clip), crop);
    type Cut = { readonly file: string; readonly v: Raster; readonly d: Px };
    const variant = async (file: string, base: Raster, who: string): Promise<Cut | null> => {
      const v = await need(file, who);
      return v === null ? null : { file, v, d: changed(v, base) };
    };
    const settle = (cut: Cut, at: Box): State | null => (registers(cut.file, c, cut.d, head.near, at) ? stateOf(cut.file, cut.v, cut.d, at, crop) : null);
    /** Two states (blink, talk, joint) in one box: the bbox of both diffs, dilated 4. */
    const settlePair = (a: Cut, b: Cut): readonly [State, State] | null => {
      const at = box(join(a.d.bounds, b.d.bounds));
      const [sa, sb] = [settle(a, at), settle(b, at)];
      return sa === null || sb === null ? null : [sa, sb];
    };
    const pair = async (files: readonly [string, string], base: Raster, who: string): Promise<readonly [State, State] | null> => {
      const [a, b] = [await variant(files[0], base, who), await variant(files[1], base, who)];
      return a === null || b === null ? null : settlePair(a, b);
    };
    const single = async (file: string, base: Raster, who: string): Promise<State | null> => {
      const a = await variant(file, base, who);
      return a === null ? null : settle(a, box(a.d.bounds));
    };
    type Plan = {
      readonly layer: State | null;
      readonly blink: readonly [State, State];
      readonly accent: State;
      readonly mouths: readonly [State, State] | null;
      readonly speaks: boolean;
      readonly joint?: readonly [State, State];
    };
    const plans = new Map<ExprId, Plan>();
    /** The states some expression masks (O4: a reused rest state masked anywhere is masked everywhere: one `Layer`). */
    const masked = new Set<State>();
    /** Joint states by accent, then blink: a reused blink with a reused accent copies the rest's (null: asked for). */
    const joints = new Map<State, Map<State, readonly [State, State] | null>>();
    /**
     * R2 and step 7b on one expression's motion layers (`base`: its own raster, the plate for the rest). Boxes that overlap
     * make both layers masked; diffs that still touch: blink and accent need the joint states, cut against the accent
     * state (`<c>[.<x>].accent.half|closed.png`); a talk pair has no joint form. Null when R2 refuses the expression.
     */
    const apart = async (x: ExprId, p: Plan, base: Raster): Promise<Plan | null> => {
      let ok = true;
      let joint: readonly [State, State] | null | undefined;
      if (overlap(p.blink[0].box, p.accent.box)) {
        for (const st of [...p.blink, p.accent]) {
          masked.add(st);
        }
        if (touch(p.blink, [p.accent])) {
          const known = joints.get(p.accent)?.get(p.blink[0]);
          const restPair = plans.get(rest);
          const tag = restPair !== undefined && p.blink === restPair.blink && p.accent === restPair.accent ? c : `${c}.${x}`;
          const files = [`${tag}.accent.half.png`, `${tag}.accent.closed.png`] as const;
          if (known !== undefined) {
            joint = known;
          } else {
            const [a, b] = [sized(files[0], await input.load(files[0])), sized(files[1], await input.load(files[1]))];
            if (a === null || b === null) {
              problems.push(`${s}: ${c} in ${x}: the blink and accent diffs are within 4 px (R2: draw the joint states ${files[0]} and ${files[1]}; ${whoNeeds(c, x)})`);
              joint = null;
            } else {
              const accentState = composite(base, p.accent, crop);
              joint = settlePair({ file: files[0], v: a, d: changed(a, accentState) }, { file: files[1], v: b, d: changed(b, accentState) });
            }
            joints.set(p.accent, (joints.get(p.accent) ?? new Map<State, readonly [State, State] | null>()).set(p.blink[0], joint));
          }
          ok = joint !== null;
        }
      }
      const talk = p.speaks ? p.mouths : null;
      for (const [bn, b] of [['blink', p.blink], ['accent', [p.accent]]] as const) {
        if (talk !== null && overlap(talk[0].box, b[0].box)) {
          for (const st of [...talk, ...b]) {
            masked.add(st);
          }
          if (touch(talk, b)) {
            problems.push(`${s}: ${c} in ${x}: the talk and ${bn} diffs are within 4 px (R2: motion layers used together never touch; ${whoNeeds(c, x)})`);
            ok = false;
          }
        }
      }
      return !ok ? null : joint === undefined || joint === null ? p : { ...p, joint };
    };
    const restSpeaks = needed.get(rest) ?? false;
    // R4 (a), (d): the rest blink pair and accent of every face member, the rest mouths where the rest is spoken.
    const blink = await pair([`${c}.half.png`, `${c}.closed.png`], plate, whoNeeds(c, rest));
    const accent = await single(`${c}.accent.png`, plate, whoNeeds(c, rest));
    const mouths = restSpeaks ? await pair([`${c}.talk1.png`, `${c}.talk2.png`], plate, whoNeeds(c, rest, true)) : null;
    const restDone = blink !== null && accent !== null && (!restSpeaks || mouths !== null);
    const restPlan = restDone ? await apart(rest, { layer: null, blink, accent, mouths, speaks: restSpeaks }, plate) : null;
    if (restPlan !== null) {
      plans.set(rest, restPlan);
    }
    for (const x of [...needed.keys()].filter((e) => e !== rest).sort()) {
      // R4 (b): the expression itself; without the rest's boxes only its presence can be told.
      const cut = restDone ? await variant(`${c}.${x}.png`, plate, whoNeeds(c, x)) : null;
      if (!restDone && (await input.load(`${c}.${x}.png`)) === null) {
        problems.push(`${s}: ${c}.${x}.png missing (R4: a needed state; ${whoNeeds(c, x)})`);
      }
      if (cut === null || blink === null || accent === null) {
        continue;
      }
      if (cut.d.count === 0) {
        problems.push(`${s}: ${cut.file} equals the plate (an expression changes the face)`);
        continue;
      }
      const layer = settle(cut, box(cut.d.bounds));
      if (layer === null) {
        continue;
      }
      const speaks = needed.get(x) ?? false;
      // R4 (c), the reuse rule (§4.2 step 3): its own state where its diff meets that rest box (talk: or no rest M).
      const own = (rb: Box): boolean => hits(cut.d, rb, crop);
      const xBlink = own(blink[0].box) ? await pair([`${c}.${x}.half.png`, `${c}.${x}.closed.png`], cut.v, whoNeeds(c, x)) : blink;
      const xAccent = own(accent.box) ? await single(`${c}.${x}.accent.png`, cut.v, whoNeeds(c, x)) : accent;
      const xMouths = !speaks
        ? null
        : mouths === null || own(mouths[0].box)
          ? await pair([`${c}.${x}.talk1.png`, `${c}.${x}.talk2.png`], cut.v, whoNeeds(c, x, true))
          : mouths;
      const planned = xBlink === null || xAccent === null || (speaks && xMouths === null) ? null : await apart(x, { layer, blink: xBlink, accent: xAccent, mouths: xMouths, speaks }, cut.v);
      if (planned !== null) {
        plans.set(x, planned);
      }
    }
    // Each state is cut once, after every expression's R2, so a reused rest state stays the rest's own `Layer`.
    const cutStates = new Map<State, Layer<Raster>>();
    const layerOf = (st: State): Layer<Raster> => {
      const known = cutStates.get(st) ?? (masked.has(st) ? maskedLayer(st) : rectLayer(st));
      cutStates.set(st, known);
      return known;
    };
    return new Map(
      [...plans].map(([x, p]): [ExprId, ExprLayers<Raster>] => [
        x,
        {
          layer: p.layer === null ? null : layerOf(p.layer),
          blink: { half: layerOf(p.blink[0]), closed: layerOf(p.blink[1]) },
          accent: layerOf(p.accent),
          mouths: p.mouths === null ? null : [layerOf(p.mouths[0]), layerOf(p.mouths[1])],
          speaks: p.speaks,
          ...(p.joint === undefined ? {} : { joint: { half: layerOf(p.joint[0]), closed: layerOf(p.joint[1]) } }),
        },
      ]),
    );
  };

  const faces = facesOf(input.needs.map((n) => n.need));
  const members: CastLayers<Raster>[] = [];
  const rooms = input.rooms ?? [];
  const warnings: string[] = [];
  for (const m of shot.cast) {
    const fig = await mask(`mask.fig.${m.char}.png`);
    const moments = fig === null ? null : maskMoments(fig, crop);
    // R8 (a warning, cut D6): a room's props draw above the shot's root, so one over a member's figure would hide it.
    for (const { room, rect } of fig === null ? [] : rooms.filter((r) => covers(fig, r.rect, crop))) {
      warnings.push(`${s}: ${room} prop rect [${rect.join(', ')}] covers ${m.char}'s figure (R8: props draw above the shot root)`);
    }
    const head = m.view === 'face' ? await mask(`mask.head.${m.char}.png`) : null;
    const headPx = head === null ? null : inMask(head);
    const headIn = headPx?.bounds === null || headPx === null ? null : meet(headPx.bounds, cropB);
    const hair: { layer: Layer<Raster>; pivot: readonly [number, number] }[] = [];
    for (const l of source.layers.filter((x) => x.kind === 'hair' && x.char === m.char)) {
      const layer = await cutLayer(l);
      if (layer !== null) {
        hair.push({ layer, pivot: toPlate(l.pivot) });
      }
    }
    const figureLayer = source.layers.find((x) => x.kind === 'figure' && x.char === m.char);
    const figure = figureLayer === undefined ? null : await cutLayer(figureLayer);
    const exprs =
      m.view === 'face' && headPx !== null && headPx.bounds !== null
        ? await faceStates(m.char, m.rest, faces.get(m.char) ?? new Map<ExprId, boolean>(), {
            clip: meet(dilate(headPx.bounds, 8), cropB) ?? cropB,
            near: dilateBits(headPx, H, 8),
          })
        : new Map<ExprId, ExprLayers<Raster>>();
    members.push({
      char: m.char,
      view: m.view,
      rest: m.rest,
      masks: {
        fig: moments?.fig ?? null,
        head: headIn === null ? null : [headIn[0] - crop[0], headIn[1] - crop[1], headIn[2] - headIn[0] + 1, headIn[3] - headIn[1] + 1],
        ...(moments === null ? {} : { feet: moments.feet }),
      },
      hair,
      figure,
      exprs,
    });
  }

  const planes: PlaneLayer<Raster>[] = [];
  for (const l of source.layers.filter((x) => x.kind === 'plane')) {
    const layer = await cutLayer(l);
    if (layer !== null) {
      planes.push({ layer, depth: l.depth, pivot: toPlate(l.pivot), front: l.front });
    }
  }
  const depth = await input.loadDepth();
  if (depth === null) {
    problems.push(`${s}: depth.png missing`);
  }
  const layers: ShotLayers<Raster> = { shot: s, frame: shot.frame, w: crop[2], h: crop[3], cast: members, planes, focus: toPlate(source.focus) };
  // R9 (castProblems, shared with the placeholders), less a member's line whose mask was reported empty above.
  for (const m of members) {
    const hairEmpty = source.layers.some((l) => l.kind === 'hair' && l.char === m.char && empty.has(l.mask));
    const skip = [empty.has(`mask.fig.${m.char}.png`) ? 'figure mask' : '', empty.has(`mask.head.${m.char}.png`) ? 'head mask' : '', hairEmpty ? 'hair lock' : ''];
    problems.push(...castProblems({ ...layers, cast: [m] }).filter((line) => !skip.some((what) => what !== '' && line.includes(`has no ${what}`))));
  }
  if (problems.length > 0 || depth === null) {
    return { ok: false, error: problems };
  }
  return { ok: true, value: { layers, depth: depthGrid(depth, crop, { w: W, h: H }), warnings } };
}
