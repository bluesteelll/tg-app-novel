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
 * canvas would. `upgrade` (shots §5.8 step 3) swaps a half file's texture to its full file in place: the same texture
 * and source, the source resized to the stored box at resolution 1, so its size, the texture's frame and every frame
 * cut from it stay as they were; the held file becomes the full Blob.
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
    /** The kept Blob's size: what the caps count; an upgrade sets it to the full file's. */
    let size = kept.size;
    const file: HeldFile<Texture> = {
      get bytes() {
        return size;
      },
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
        let { width: w, height: h } = bitmap;
        let keptBytes = blob.size;
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
          get w() {
            return w;
          },
          get h() {
            return h;
          },
          get keptBytes() {
            return keptBytes;
          },
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
          async upgrade(fullRef, full, us) {
            if (!alive || us.aborted) {
              return aborted;
            }
            const fetched = await deps.fetchAsset(fullRef.url, us);
            if (!fetched.ok) {
              return fetched.error.kind === 'aborted' ? aborted : { ok: false, error: { kind: 'fetch', error: fetched.error } };
            }
            if (!alive || us.aborted) {
              return aborted;
            }
            // `createImageBitmap` is read at call time, never captured (the e2e wraps it).
            let next: ImageBitmap;
            try {
              next = await createImageBitmap(fetched.value);
            } catch (e) {
              return { ok: false, error: { kind: 'decode', detail: detail(e) } };
            }
            if (!alive || us.aborted) {
              next.close();
              return aborted;
            }
            // The stored box in full px, never the canvas: a trimmed file's canvas is larger than its pixels (shots §5.8,
            // SH5b cut §1.3). The source's size stays this box; only its pixel size moves to the full file's.
            const box = full.trim ?? full.canvas;
            if (next.width !== box.w || next.height !== box.h) {
              const seen = `${next.width}x${next.height}`;
              next.close();
              return { ok: false, error: { kind: 'decode', detail: `upgrade decoded ${seen}, stored box ${box.w}x${box.h}` } };
            }
            // One synchronous swap: the new bitmap is the resource before the resize re-uploads it (GlTextureSystem
            // listens to `resize`), and stays open until that upload is done.
            bitmap.close();
            source.resource = next;
            if (!source.resize(box.w, box.h, 1)) {
              source.update();
            }
            gen = deps.upload(source);
            if (gen !== null) {
              next.close();
            }
            bitmap = next;
            kept = fetched.value;
            size = fetched.value.size;
            keptBytes = fetched.value.size;
            w = box.w;
            h = box.h;
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
