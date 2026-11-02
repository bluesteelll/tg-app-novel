// Image encoding (PROTOTYPE-PLAN K23): sharp rasterizes the placeholder SVG (or, later, a real PNG source) and writes
// AVIF + WebP. The only module that imports sharp: budget and scan-dist never load libvips. Principle 4: no side over
// 2048 px; the dimensions recorded in the manifest are sharp's output info, never the input's claim.
import sharp from 'sharp';
import type { Sharp } from 'sharp';

import type { Trim } from '../../src/story/catalog.ts';

/** Principle 4: the texture limit. */
export const MAX_SIDE = 2048;
/** MEMORY-PLAN 4.B: transparent px kept around the alpha box, so bilinear sampling at its edge reads transparency. */
const TRIM_MARGIN = 2;

/** `w`, `h`: the stored file's px; `trim`: where it sits on its canvas, absent when the file is the canvas. */
export type EncodedImage = { avif: Uint8Array; webp: Uint8Array; w: number; h: number; trim?: Trim };

/** The clamp: as large as possible within 2048×2048, aspect kept, never enlarged (sharp `fit: 'inside'`). */
function clamped(input: Uint8Array): Sharp {
  return sharp(input).resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true });
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

/**
 * The alpha box (any alpha > 0) of the clamped canvas, widened by the margin and to even sides; null when it is the
 * whole canvas or empty (a fully transparent input). Our own scan, not `sharp.trim()`, which also trims on colour.
 */
async function trimBox(input: Uint8Array): Promise<{ left: number; top: number; width: number; height: number; trim: Trim } | null> {
  const { data, info } = await clamped(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels } = info;
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if ((data[(y * w + x) * channels + channels - 1] ?? 0) > 0) {
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

/**
 * AVIF q50 effort 4 and WebP q80 (sharp's documented defaults, PP "Asset pipeline"), one after the other so the peak
 * stays one decoded canvas. Both outputs come from one clamp, so their sizes agree; a disagreement is a bug. With
 * `trim` (char, prop) the clamped canvas is cut to its alpha box (`extract` after `resize` cuts the resized image).
 */
export async function encodeImage(input: Uint8Array, o: { trim: boolean } = { trim: false }): Promise<EncodedImage> {
  const box = o.trim ? await trimBox(input) : null;
  const source = (): Sharp => {
    const c = clamped(input);
    return box === null ? c : c.extract({ left: box.left, top: box.top, width: box.width, height: box.height });
  };
  const avif = await source().avif({ quality: 50, effort: 4 }).toBuffer({ resolveWithObject: true });
  const webp = await source().webp({ quality: 80 }).toBuffer({ resolveWithObject: true });
  if (avif.info.width !== webp.info.width || avif.info.height !== webp.info.height) {
    throw new Error(
      `invariant: one clamp gives one size (avif ${avif.info.width}x${avif.info.height}, webp ${webp.info.width}x${webp.info.height})`,
    );
  }
  const out = { avif: avif.data, webp: webp.data, w: avif.info.width, h: avif.info.height };
  return box === null ? out : { ...out, trim: box.trim };
}
