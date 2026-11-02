// The image loader (PROTOTYPE-PLAN K4): the injected FetchAsset (api/http.ts: bearer and re-auth for gated URLs) →
// createImageBitmap → a Pixi Texture over an ImageSource. With registry.ts the only creator of textures (arch rule
// `texture-create`); it never fetches itself (arch rule `fetch-in-scene-audio`), so paid art re-auths like any /api call.
import { ImageSource, Rectangle, Texture } from 'pixi.js';

import type { Box } from '../geom/cover.ts';
import type { FetchAsset } from '../story/catalog.ts';
import type { Decoded, LoadError, LoadImage } from './registry.ts';

// Pixi 8.22's own AVIF detection image (pixi.js/lib/assets/detections/parsers/detectAvif.mjs:12): 2×2 px, as sharp
// decodes it; the probe asks only that it decodes to a non-empty bitmap.
const AVIF_PROBE =
  'AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADybWV0YQAAAAAAAAAoaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAGxpYmF2aWYAAAAADnBpdG0AAAAAAAEAAAAeaWxvYwAAAABEAAABAAEAAAABAAABGgAAAB0AAAAoaWluZgAAAAAAAQAAABppbmZlAgAAAAABAABhdjAxQ29sb3IAAAAAamlwcnAAAABLaXBjbwAAABRpc3BlAAAAAAAAAAIAAAACAAAAEHBpeGkAAAAAAwgICAAAAAxhdjFDgQ0MAAAAABNjb2xybmNseAACAAIAAYAAAAAXaXBtYQAAAAAAAAABAAEEAQKDBAAAACVtZGF0EgAKCBgANogQEAwgMg8f8D///8WfhwB8+ErK42A=';

const aborted: { ok: false; error: LoadError } = { ok: false, error: { kind: 'aborted' } };
const detail = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const rect = (b: Box): Rectangle => new Rectangle(b.x, b.y, b.w, b.h);

/**
 * FetchAsset → ImageBitmap → Texture. The bitmap is kept as the texture's resource (the context-loss restore re-uploads
 * from it; paid art is no-store) and closed on release, on abort and on failure. Alpha follows Pixi's own loader
 * (loadTextures.mjs:25, :64-69): a default-decoded bitmap uploaded with `premultiply-alpha-on-upload`. The texture is
 * laid out as the file's canvas (MEMORY-PLAN 4.B): Pixi sizes and anchors a sprite on `orig` and draws the stored
 * pixels at `trim`, so a trimmed file renders where its untrimmed canvas would.
 */
export function createImageLoader(deps: { fetchAsset: FetchAsset }): LoadImage<Texture> {
  return async (ref, signal, geometry) => {
    const got = await deps.fetchAsset(ref.url, signal);
    if (!got.ok) {
      return got.error.kind === 'aborted' ? aborted : { ok: false, error: { kind: 'fetch', error: got.error } };
    }
    if (signal.aborted) {
      return aborted;
    }
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(got.value);
    } catch (e) {
      return { ok: false, error: { kind: 'decode', detail: detail(e) } };
    }
    if (signal.aborted) {
      bitmap.close();
      return aborted;
    }
    const source = new ImageSource({ resource: bitmap, alphaMode: 'premultiply-alpha-on-upload', label: ref.url, resolution: geometry.resolution });
    const texture = new Texture({
      source,
      label: ref.url,
      orig: rect(geometry.orig),
      ...(geometry.trim === null ? {} : { trim: rect(geometry.trim) }),
    });
    let alive = true;
    const decoded: Decoded<Texture> = {
      texture,
      w: bitmap.width,
      h: bitmap.height,
      release() {
        if (!alive) {
          return;
        }
        alive = false;
        texture.destroy(true);
        bitmap.close();
      },
    };
    return { ok: true, value: decoded };
  };
}

/** True if this WebView decodes AVIF; checked once at mount, so the registry picks one variant for the session. */
export async function probeAvif(): Promise<boolean> {
  try {
    const bytes = Uint8Array.from(atob(AVIF_PROBE), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/avif' }));
    const ok = bitmap.width > 0 && bitmap.height > 0;
    bitmap.close();
    return ok;
  } catch {
    return false;
  }
}
