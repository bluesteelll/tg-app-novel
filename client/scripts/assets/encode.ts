// Image encoding (PROTOTYPE-PLAN K23): sharp rasterizes the placeholder SVG (or, later, a real PNG source) and writes
// AVIF + WebP. The only module that imports sharp: budget and scan-dist never load libvips. Principle 4: no side over
// 2048 px; the dimensions recorded in the manifest are sharp's output info, never the input's claim.
import sharp from 'sharp';
import type { Sharp } from 'sharp';

/** Principle 4: the texture limit. */
export const MAX_SIDE = 2048;

export type EncodedImage = { avif: Uint8Array; webp: Uint8Array; w: number; h: number };

/** The clamp: as large as possible within 2048×2048, aspect kept, never enlarged (sharp `fit: 'inside'`). */
function clamped(input: Uint8Array): Sharp {
  return sharp(input).resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true });
}

/**
 * AVIF q50 effort 4 and WebP q80 (sharp's documented defaults, PP "Asset pipeline"), one after the other so the peak
 * stays one decoded canvas. Both outputs come from one clamp, so their sizes agree; a disagreement is a bug.
 */
export async function encodeImage(input: Uint8Array): Promise<EncodedImage> {
  const avif = await clamped(input).avif({ quality: 50, effort: 4 }).toBuffer({ resolveWithObject: true });
  const webp = await clamped(input).webp({ quality: 80 }).toBuffer({ resolveWithObject: true });
  if (avif.info.width !== webp.info.width || avif.info.height !== webp.info.height) {
    throw new Error(
      `invariant: one clamp gives one size (avif ${avif.info.width}x${avif.info.height}, webp ${webp.info.width}x${webp.info.height})`,
    );
  }
  return { avif: avif.data, webp: webp.data, w: avif.info.width, h: avif.info.height };
}
