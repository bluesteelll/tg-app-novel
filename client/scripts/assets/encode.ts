// Image encoding (PROTOTYPE-PLAN K23): sharp rasterizes the placeholder SVG, or takes a `src` shot's raster (shots
// §4.4, lane SH3c), and writes AVIF + WebP. The only module that imports sharp: budget and scan-dist never load libvips.
// Principle 4: no side over 2048 px; the dimensions recorded in the manifest are sharp's output info, never the input's
// claim. MEMORY-PLAN 4.C: on request, the half tier's pair too, the 2 × 2 premultiplied average of the stored file.
// RULINGS 267: a raster with alpha ships only AVIF bytes whose decoded alpha passed R6, its q searched per tier.
import sharp from 'sharp';
import type { Sharp } from 'sharp';

import type { Result, Trim } from '../../src/story/catalog.ts';
import type { AssetId } from '../../src/story/staging.ts';
import { ALPHA_TOLERANCE, alphaWorst } from './extract.ts';
import type { AlphaWorst, DepthSource } from './extract.ts';
import type { Raster } from './shots.ts';

/** Principle 4: the texture limit. */
export const MAX_SIDE = 2048;
/** MEMORY-PLAN 4.B: transparent px kept around the alpha box, so bilinear sampling at its edge reads transparency. */
const TRIM_MARGIN = 2;
/** AVIF q50 effort 4 and WebP q80 (sharp's documented defaults, PP "Asset pipeline"), for the full and the half file. */
const AVIF = { quality: 50, effort: 4 } as const;
const WEBP = { quality: 80 } as const;

/**
 * Whether to make the half pair (MEMORY-PLAN 4.C; the asset tool's `halfAsk` decides per id): `'none'`, never; `'any'`,
 * always; `{ canvasH }`, only when the clamped canvas is that high (a char off the canonical canvas has none).
 */
export type HalfAsk = 'none' | 'any' | { canvasH: number };
/** The half tier's pair: `w`, `h` are exactly half the stored file's. */
export type EncodedHalf = { avif: Uint8Array; webp: Uint8Array; w: number; h: number };
/**
 * `w`, `h`: the stored file's px; `trim`: where it sits on its canvas, absent when the file is the canvas; `half`: its
 * half pair, absent unless it was asked for and is due.
 */
export type EncodedImage = { avif: Uint8Array; webp: Uint8Array; w: number; h: number; trim?: Trim; half?: EncodedHalf };

/** Raw RGBA px, row-major, 4 bytes per px. */
type Rgba = { data: Uint8Array; w: number; h: number };

/** The clamp: as large as possible within 2048×2048, aspect kept, never enlarged (sharp `fit: 'inside'`). */
function clamped(input: Uint8Array): Sharp {
  return sharp(input).resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true });
}

/** The clamped canvas as raw RGBA: what the trim scans and the half averages. */
async function clampedRgba(input: Uint8Array): Promise<Rgba> {
  const { data, info } = await clamped(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.channels !== 4) {
    throw new Error(`invariant: ensureAlpha gives 4 channels, got ${info.channels}`);
  }
  return { data, w: info.width, h: info.height };
}

/** One axis of the box: [lo, hi] inclusive, widened by the margin, then to an even length (MEMORY-PLAN 4.B). */
function widened(lo: number, hi: number, size: number): { start: number; length: number } {
  let a = Math.max(0, lo - TRIM_MARGIN);
  let b = Math.min(size - 1, hi + TRIM_MARGIN);
  if ((b - a + 1) % 2 !== 0) {
    // One more column or row on the far side, or on the near side where the far side is the canvas edge; an odd
    // canvas filled edge to edge stays odd (the asset tool refuses it).
    if (b < size - 1) {
      b += 1;
    } else if (a > 0) {
      a -= 1;
    }
  }
  return { start: a, length: b - a + 1 };
}

type Box = { left: number; top: number; width: number; height: number; trim: Trim };

/**
 * The alpha box (any alpha > 0) of the clamped canvas, widened by the margin and to even sides; null when it is the
 * whole canvas or empty (a fully transparent input). Our own scan, not `sharp.trim()`, which also trims on colour.
 */
function trimBox(canvas: Rgba): Box | null {
  const { data, w, h } = canvas;
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if ((data[(y * w + x) * 4 + 3] ?? 0) > 0) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }
  if (maxX < 0) {
    return null;
  }
  const bx = widened(minX, maxX, w);
  const by = widened(minY, maxY, h);
  if (bx.length === w && by.length === h) {
    return null;
  }
  return { left: bx.start, top: by.start, width: bx.length, height: by.length, trim: { canvasW: w, canvasH: h, x: bx.start, y: by.start } };
}

/** The box's px out of the canvas: the stored file's pixels. */
function cut(canvas: Rgba, box: Box): Rgba {
  const data = new Uint8Array(box.width * box.height * 4);
  for (let y = 0; y < box.height; y++) {
    const from = ((box.top + y) * canvas.w + box.left) * 4;
    data.set(canvas.data.subarray(from, from + box.width * 4), y * box.width * 4);
  }
  return { data, w: box.width, h: box.height };
}

/**
 * MEMORY-PLAN 4.C (critique_r2 W5): each output px is the premultiplied mean of its 2 × 2 block, returned straight
 * (colour = Σ c·a / Σ a, alpha = the mean alpha; transparent black where all four are transparent). No px outside the
 * block reaches it, so the stored file's transparent margin halves to a 1-px border with alpha 0. Even sides only.
 */
export function halfRgba(data: Uint8Array, w: number, h: number): Uint8Array {
  if (w % 2 !== 0 || h % 2 !== 0 || data.length !== w * h * 4) {
    throw new Error(`invariant: the half tier halves an even-sided RGBA raster (${w}×${h}, ${data.length} bytes)`);
  }
  const hw = w / 2;
  const hh = h / 2;
  const out = new Uint8Array(hw * hh * 4);
  for (let y = 0; y < hh; y++) {
    for (let x = 0; x < hw; x++) {
      const top = (2 * y * w + 2 * x) * 4;
      const block = [top, top + 4, top + w * 4, top + w * 4 + 4];
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (const i of block) {
        const alpha = data[i + 3] ?? 0;
        r += (data[i] ?? 0) * alpha;
        g += (data[i + 1] ?? 0) * alpha;
        b += (data[i + 2] ?? 0) * alpha;
        a += alpha;
      }
      const o = (y * hw + x) * 4;
      if (a > 0) {
        out[o] = Math.round(r / a);
        out[o + 1] = Math.round(g / a);
        out[o + 2] = Math.round(b / a);
      }
      out[o + 3] = Math.round(a / 4);
    }
  }
  return out;
}

/**
 * One raw decode of the clamp, when a trim or a half is asked: the trim box, and the half's px when the ask is due. The
 * canvas raster lives only here, so it is not held through the encodes.
 */
async function scan(input: Uint8Array, trim: boolean, ask: HalfAsk): Promise<{ box: Box | null; half: Rgba | null }> {
  if (!trim && ask === 'none') {
    return { box: null, half: null };
  }
  const canvas = await clampedRgba(input);
  const box = trim ? trimBox(canvas) : null;
  if (ask !== 'any' && (ask === 'none' || canvas.h !== ask.canvasH)) {
    return { box, half: null };
  }
  const stored = box === null ? canvas : cut(canvas, box);
  return { box, half: { data: halfRgba(stored.data, stored.w, stored.h), w: stored.w / 2, h: stored.h / 2 } };
}

/**
 * AVIF and WebP one after the other, so the peak stays one decoded canvas. Both outputs come from one clamp, so their
 * sizes agree; a disagreement is a bug. With `trim` (char, prop) the clamped canvas is cut to its alpha box (`extract`
 * after `resize` cuts the resized image). With a `half` ask that is due (HalfAsk), the stored px are halved by
 * `halfRgba` and encoded with the same options; the full files never depend on the ask.
 */
export async function encodeImage(input: Uint8Array, o: { trim: boolean; half?: HalfAsk } = { trim: false }): Promise<EncodedImage> {
  const { box, half: halfPx } = await scan(input, o.trim, o.half ?? 'none');
  const source = (): Sharp => {
    const c = clamped(input);
    return box === null ? c : c.extract({ left: box.left, top: box.top, width: box.width, height: box.height });
  };
  const avif = await source().avif(AVIF).toBuffer({ resolveWithObject: true });
  const webp = await source().webp(WEBP).toBuffer({ resolveWithObject: true });
  if (avif.info.width !== webp.info.width || avif.info.height !== webp.info.height) {
    throw new Error(
      `invariant: one clamp gives one size (avif ${avif.info.width}x${avif.info.height}, webp ${webp.info.width}x${webp.info.height})`,
    );
  }
  const out: EncodedImage = { avif: avif.data, webp: webp.data, w: avif.info.width, h: avif.info.height };
  if (box !== null) {
    out.trim = box.trim;
  }
  if (halfPx !== null) {
    const raw = (): Sharp => sharp(halfPx.data, { raw: { width: halfPx.w, height: halfPx.h, channels: 4 } });
    const halfAvif = await raw().avif(AVIF).toBuffer({ resolveWithObject: true });
    const halfWebp = await raw().webp(WEBP).toBuffer({ resolveWithObject: true });
    for (const info of [halfAvif.info, halfWebp.info]) {
      if (info.width !== halfPx.w || info.height !== halfPx.h) {
        throw new Error(`invariant: the half pair is ${halfPx.w}x${halfPx.h}, got ${info.width}x${info.height}`);
      }
    }
    out.half = { avif: halfAvif.data, webp: halfWebp.data, w: halfPx.w, h: halfPx.h };
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Rasters (shots §4.4, lane SH3c): a `src` shot's plate and packed files, a `src` loop's atlas

/**
 * How a raster's file is written besides its px: `mark` (fix3 I1), an id written as EXIF ImageDescription, so a gated
 * file's bytes are never a public file's whatever its px (I-0; the decoded px are the unmarked encode's); `opaque`
 * (fix3 F1), no alpha band (a plate, opaque by check: its alpha is all 255, so nothing is lost).
 */
export type CodecOptions = { readonly mark?: string; readonly opaque?: true };

/**
 * What a raster encode runs on: one tier's AVIF at quality q, its WebP, and a decode back to RGBA. Injectable, so the
 * q search's tests run on a fake codec; R6's compare is always `alphaWorst`.
 */
export type Codec = {
  readonly avif: (px: Raster, q: number, o?: CodecOptions) => Promise<Uint8Array>;
  readonly webp: (px: Raster, o?: CodecOptions) => Promise<Uint8Array>;
  readonly decode: (bytes: Uint8Array) => Promise<Raster>;
};

function rawInput(px: Raster, o: CodecOptions = {}): Sharp {
  const input = sharp(px.data, { raw: { width: px.w, height: px.h, channels: 4 } });
  const banded = o.opaque === true ? input.removeAlpha() : input;
  return o.mark === undefined ? banded : banded.withExif({ IFD0: { ImageDescription: o.mark } });
}

/** sharp's output, checked against the input's size: a raster is never resized. */
function sameSize(out: { data: Uint8Array; info: { width: number; height: number } }, px: Raster, format: string): Uint8Array {
  if (out.info.width !== px.w || out.info.height !== px.h) {
    throw new Error(`invariant: a raster's ${format} is its size (${px.w}x${px.h}, got ${out.info.width}x${out.info.height})`);
  }
  return out.data;
}

/** One tier's AVIF at quality `q` (effort 4, as `encodeImage`'s), no resize, no trim; `o` as `CodecOptions` says. */
export async function encodeAvif(px: Raster, q: number, o?: CodecOptions): Promise<Uint8Array> {
  return sameSize(await rawInput(px, o).avif({ quality: q, effort: AVIF.effort }).toBuffer({ resolveWithObject: true }), px, 'AVIF');
}

/** One tier's WebP at q80 (alpha lossless: sharp's `alphaQuality` default 100); `o` as `CodecOptions` says. */
export async function encodeWebp(px: Raster, o?: CodecOptions): Promise<Uint8Array> {
  return sameSize(await rawInput(px, o).webp(WEBP).toBuffer({ resolveWithObject: true }), px, 'WebP');
}

/** A source file's header facts (cut D5, D12): its format, size, sample depth (`uchar`, `ushort`, ...) and channels. */
export type ImageFacts = { readonly format: string; readonly w: number; readonly h: number; readonly depth: string; readonly channels: number };

/** `bytes`' header facts; null when sharp reads no image there (an input problem, never a throw). */
export async function imageFacts(bytes: Uint8Array): Promise<ImageFacts | null> {
  try {
    const m = await sharp(bytes).metadata();
    return { format: m.format, w: m.width, h: m.height, depth: m.depth, channels: m.channels };
  } catch {
    return null;
  }
}

/**
 * depth.png's samples (cut D12): an 8- or 16-bit greyscale PNG (any alpha dropped) read through sharp's `grey16`, so an
 * 8-bit map arrives as v × 257 and both read against 65535 (`raw({ depth: 'ushort' })` alone keeps 8-bit values).
 */
export async function decodeDepth(bytes: Uint8Array): Promise<DepthSource> {
  const { data, info } = await sharp(bytes).removeAlpha().toColourspace('grey16').raw({ depth: 'ushort' }).toBuffer({ resolveWithObject: true });
  if (info.channels !== 1 || data.length !== info.width * info.height * 2) {
    throw new Error(`invariant: grey16 gives one 16-bit channel, got ${info.channels} channels in ${data.length} bytes`);
  }
  // A copy: the buffer's offset need not be 2-aligned; the samples are in the platform's order, as libvips wrote them.
  return { data: new Uint16Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.length)), w: info.width, h: info.height, max: 65535 };
}

/** Any image sharp reads (PNG, AVIF, WebP), as 8-bit RGBA. */
export async function decodeRaster(bytes: Uint8Array): Promise<Raster> {
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.channels !== 4 || data.length !== info.width * info.height * 4) {
    throw new Error(`invariant: ensureAlpha gives 8-bit RGBA, got ${info.channels} channels in ${data.length} bytes`);
  }
  return { data, w: info.width, h: info.height };
}

/** The real codec: sharp. */
export const SHARP_CODEC: Codec = { avif: encodeAvif, webp: encodeWebp, decode: decodeRaster };

/** RULINGS 267: the q search's ceiling, its coarse step and how many q below the first pass it tries. */
export const Q_CEILING = 90;
const Q_STEP = 5;
const Q_REFINE = 4;

/** One tier's search: the AVIF that ships and its q, or the best candidate when none passed. */
export type QSearch =
  | { readonly ok: true; readonly q: number; readonly avif: Uint8Array }
  | { readonly ok: false; readonly ceiling: number; readonly best: AlphaWorst & { readonly q: number } };

/**
 * RULINGS 267, one tier's AVIF q: from `start`, coarse steps of 5 up to the ceiling (90, itself the last candidate; a
 * start above it is its own), stopping at the first candidate whose decoded alpha passes R6 at every px; then the four q
 * just below it (never below the start); the passing candidate with the fewest bytes ships (ties: the lower q). Passing
 * is not monotone in q, so nothing ships that was not decoded and measured. Every candidate is encoded with `o`.
 */
export async function searchAvif(px: Raster, start: number, codec: Codec = SHARP_CODEC, o?: CodecOptions): Promise<QSearch> {
  const ceiling = Math.max(Q_CEILING, start);
  const tried = new Map<number, { readonly avif: Uint8Array; readonly worst: AlphaWorst }>();
  const passes = async (q: number): Promise<boolean> => {
    let t = tried.get(q);
    if (t === undefined) {
      const avif = await codec.avif(px, q, o);
      t = { avif, worst: alphaWorst(await codec.decode(avif), px) };
      tried.set(q, t);
    }
    return t.worst.err <= ALPHA_TOLERANCE;
  };
  let first: number | null = null;
  for (let q = start; first === null; q = Math.min(q + Q_STEP, ceiling)) {
    if (await passes(q)) {
      first = q;
    } else if (q === ceiling) {
      break;
    }
  }
  const candidates = (): { q: number; avif: Uint8Array; worst: AlphaWorst }[] => [...tried].map(([q, t]) => ({ q, ...t }));
  if (first === null) {
    const [best] = candidates().sort((a, b) => a.worst.err - b.worst.err || a.q - b.q);
    if (best === undefined) {
      throw new Error('invariant: the search tries its start');
    }
    return { ok: false, ceiling, best: { ...best.worst, q: best.q } };
  }
  for (let q = Math.max(start, first - Q_REFINE); q < first; q++) {
    await passes(q);
  }
  const [ship] = candidates()
    .filter((c) => c.worst.err <= ALPHA_TOLERANCE)
    .sort((a, b) => a.avif.length - b.avif.length || a.q - b.q);
  if (ship === undefined) {
    throw new Error('invariant: the first passing candidate is tried');
  }
  return { ok: true, q: ship.q, avif: ship.avif };
}

/** A raster's encode: its files, and the AVIF q each tier shipped at (`half` null: no half pair). */
export type EncodedRaster = { readonly image: EncodedImage; readonly q: { readonly full: number; readonly half: number | null } };

/**
 * A raster as AVIF + WebP, never resized or trimmed, with its half pair when the ask is due (`halfRgba` of the px, as
 * `encodeImage`'s). `search: false` (a plate, opaque at every px, else a bug: `extractShot` refuses that plate, fix3
 * F1): AVIF at `q` exactly, both tiers, and no file has an alpha band. `search: true` (a file with
 * alpha): each tier's AVIF q is `searchAvif`'s from `q`; a tier with no passing candidate up to the ceiling is an error
 * line naming the file, the tier, the best candidate's q and its worst px, and nothing is returned to write. WebP: q80.
 * `id` names the file in those lines. `mark` (fix3 I1): every AVIF candidate and both WebP of both tiers carry `id`
 * (`CodecOptions`). Sides even and at most 2048: the callers' R5, packer and loop-frame checks.
 */
export async function encodeRaster(
  px: Raster,
  o: { readonly id: AssetId; readonly half: HalfAsk; readonly q: number; readonly search: boolean; readonly mark?: boolean },
  codec: Codec = SHARP_CODEC,
): Promise<Result<EncodedRaster, string[]>> {
  if (px.w % 2 !== 0 || px.h % 2 !== 0 || px.w > MAX_SIDE || px.h > MAX_SIDE || px.data.length !== px.w * px.h * 4) {
    throw new Error(`invariant: ${o.id} is an even-sided RGBA raster of at most ${MAX_SIDE} px (${px.w}x${px.h}, ${px.data.length} bytes)`);
  }
  if (!o.search) {
    for (let i = 3; i < px.data.length; i += 4) {
      if (px.data[i] !== 255) {
        throw new Error(`invariant: ${o.id} is opaque at every px (an unsearched raster is a plate; extractShot refuses one that is not)`);
      }
    }
  }
  const opts: CodecOptions = { ...(o.mark === true ? { mark: o.id } : {}), ...(o.search ? {} : { opaque: true as const }) };
  const due = o.half === 'any' || (o.half !== 'none' && px.h === o.half.canvasH);
  const halfPx: Raster | null = due ? { data: halfRgba(px.data, px.w, px.h), w: px.w / 2, h: px.h / 2 } : null;
  const tier = async (t: Raster, name: 'full' | 'half'): Promise<Result<{ q: number; avif: Uint8Array }, string>> => {
    if (!o.search) {
      return { ok: true, value: { q: o.q, avif: await codec.avif(t, o.q, opts) } };
    }
    const r = await searchAvif(t, o.q, codec, opts);
    if (r.ok) {
      return { ok: true, value: r };
    }
    const { best } = r;
    return {
      ok: false,
      error: `${o.id}: ${name}: no AVIF q in ${o.q}..${r.ceiling} keeps alpha within ${ALPHA_TOLERANCE}/255 (R6: the best, q ${best.q}, is ${best.err}/255 off at (${best.x}, ${best.y}))`,
    };
  };
  const full = await tier(px, 'full');
  const half = halfPx === null ? null : await tier(halfPx, 'half');
  if (!full.ok || (half !== null && !half.ok)) {
    return { ok: false, error: [full, half].flatMap((r) => (r === null || r.ok ? [] : [r.error])) };
  }
  const image: EncodedImage = { avif: full.value.avif, webp: await codec.webp(px, opts), w: px.w, h: px.h };
  if (halfPx !== null && half !== null) {
    image.half = { avif: half.value.avif, webp: await codec.webp(halfPx, opts), w: halfPx.w, h: halfPx.h };
  }
  return { ok: true, value: { image, q: { full: full.value.q, half: half === null ? null : half.value.q } } };
}
