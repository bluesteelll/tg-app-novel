// The image loader (PROTOTYPE-PLAN K4): the injected FetchAsset (api/http.ts: bearer and re-auth for gated URLs) →
// createImageBitmap → a Pixi Texture over an ImageSource. With registry.ts the only creator of textures (arch rule
// `texture-create`); it never fetches itself (arch rule `fetch-in-scene-audio`), so paid art re-auths like any /api call.
import { ImageSource, Rectangle, Texture } from 'pixi.js';

import type { Box } from '../geom/cover.ts';
import type { FetchAsset } from '../story/catalog.ts';
import type { Decoded, HeldFile, HoldImage, LoadError } from './registry.ts';

// Pixi 8.22's own AVIF detection image (pixi.js/lib/assets/detections/parsers/detectAvif.mjs:12): 2×2 px, as sharp
// decodes it; the probe asks only that it decodes to a non-empty bitmap.
const AVIF_PROBE =
  'AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADybWV0YQAAAAAAAAAoaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAGxpYmF2aWYAAAAADnBpdG0AAAAAAAEAAAAeaWxvYwAAAABEAAABAAEAAAABAAABGgAAAB0AAAAoaWluZgAAAAAAAQAAABppbmZlAgAAAAABAABhdjAxQ29sb3IAAAAAamlwcnAAAABLaXBjbwAAABRpc3BlAAAAAAAAAAIAAAACAAAAEHBpeGkAAAAAAwgICAAAAAxhdjFDgQ0MAAAAABNjb2xybmNseAACAAIAAYAAAAAXaXBtYQAAAAAAAAABAAEEAQKDBAAAACVtZGF0EgAKCBgANogQEAwgMg8f8D///8WfhwB8+ErK42A=';

const aborted: { ok: false; error: LoadError } = { ok: false, error: { kind: 'aborted' } };
const detail = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const rect = (b: Box): Rectangle => new Rectangle(b.x, b.y, b.w, b.h);

/** Uploads to the renderer current at call time, never a captured one; GL only; the generation, or null. */
export type Upload = (source: ImageSource) => number | null;

/**
 * FetchAsset → a held file (shots §5.8 "The warm form"): the fetched Blob (counted by the caps at its real size, never
 * given a URL), kept until the registry's record ends (`drop()`). Its `decode` is ImageBitmap → Texture, uploaded at
 * once (MEMORY-PLAN 4.A), as often as the record asks (a shed decodes it again, no fetch): when `upload` reports a GPU
 * generation the bitmap is closed and the Blob is the only CPU copy; when it reports null (a lost context, no GL
 * renderer) the bitmap stays open, the texture's resource. `revive` brings the texture to a later generation in place:
 * a kept bitmap is uploaded, a closed one decoded again from the Blob. A bitmap is closed on release, on abort and on
 * failure, and one that settles late is closed when it does; a texture's release leaves the Blob to the held file.
 * Alpha follows Pixi's own loader (loadTextures.mjs:25, :64-69): a default-decoded bitmap uploaded with
 * `premultiply-alpha-on-upload`. The texture is laid out as the file's canvas (MEMORY-PLAN 4.B): Pixi sizes and
 * anchors a sprite on `orig` and draws the stored pixels at `trim`, so a trimmed file renders where its untrimmed
 * canvas would.
 */
export function createImageLoader(deps: { fetchAsset: FetchAsset; upload: Upload }): HoldImage<Texture> {
  return async (ref, signal) => {
    const got = await deps.fetchAsset(ref.url, signal);
    if (!got.ok) {
      return got.error.kind === 'aborted' ? aborted : { ok: false, error: { kind: 'fetch', error: got.error } };
    }
    if (signal.aborted) {
      return aborted;
    }
    let kept: Blob | null = got.value;
    const file: HeldFile<Texture> = {
      bytes: kept.size,
      async decode(s, geometry) {
        const blob = kept;
        if (blob === null || s.aborted) {
          return aborted;
        }
        // `createImageBitmap` is read at call time, never captured (the e2e wraps it).
        let bitmap: ImageBitmap;
        try {
          bitmap = await createImageBitmap(blob);
        } catch (e) {
          return { ok: false, error: { kind: 'decode', detail: detail(e) } };
        }
        if (s.aborted) {
          bitmap.close();
          return aborted;
        }
        // Read before the bitmap closes: a closed bitmap reports 0 × 0.
        const { width: w, height: h } = bitmap;
        const source = new ImageSource({ resource: bitmap, alphaMode: 'premultiply-alpha-on-upload', label: ref.url, resolution: geometry.resolution });
        // Never collected by Pixi's GC: it would re-upload from a closed bitmap. The registry owns the lifetime. Set after
        // construction: ImageSource's constructor sets `autoGarbageCollect = true` over the option (pixi.js 8.22
        // ImageSource.mjs:9).
        source.autoGarbageCollect = false;
        const texture = new Texture({
          source,
          label: ref.url,
          orig: rect(geometry.orig),
          ...(geometry.trim === null ? {} : { trim: rect(geometry.trim) }),
        });
        let alive = true;
        let gen = deps.upload(source);
        if (gen !== null) {
          bitmap.close();
        }
        const decoded: Decoded<Texture> = {
          texture,
          w,
          h,
          keptBytes: blob.size,
          get gen() {
            return gen;
          },
          open: () => alive && bitmap.width > 0,
          async revive(to, rs) {
            const from = kept;
            if (!alive || from === null || rs.aborted) {
              return aborted;
            }
            if (gen === null) {
              // Kept open: an upload, no decode.
              gen = deps.upload(source);
              if (gen !== null) {
                bitmap.close();
              }
              return { ok: true, value: undefined };
            }
            if (gen >= to) {
              return { ok: true, value: undefined };
            }
            // `createImageBitmap` is read at call time, never captured (the e2e wraps it).
            let next: ImageBitmap;
            try {
              next = await createImageBitmap(from);
            } catch (e) {
              return { ok: false, error: { kind: 'decode', detail: detail(e) } };
            }
            if (!alive || rs.aborted) {
              next.close();
              return aborted;
            }
            bitmap = next;
            source.resource = next;
            gen = deps.upload(source);
            if (gen !== null) {
              next.close();
            }
            return { ok: true, value: undefined };
          },
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
      },
      drop() {
        kept = null;
      },
    };
    return { ok: true, value: file };
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
