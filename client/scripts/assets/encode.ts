// Image encoding (PROTOTYPE-PLAN K23): sharp rasterizes the placeholder SVG (or, later, a real PNG source) and writes
// AVIF + WebP. The only module that imports sharp: budget and scan-dist never load libvips. Principle 4: no side over
// 2048 px; the dimensions recorded in the manifest are sharp's output info, never the input's claim. MEMORY-PLAN 4.C:
// on request, the half tier's pair too, the 2 × 2 premultiplied average of the stored file.
import sharp from 'sharp';
import type { Sharp } from 'sharp';

import type { Trim } from '../../src/story/catalog.ts';

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
