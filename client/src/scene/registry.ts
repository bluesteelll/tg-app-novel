// The texture registry (PROTOTYPE-PLAN K4, K5): one entry per asset id with a set of holders, destroyed when the set
// empties; admission under the 32 MiB steady (preload) and 48 MiB hard (visible) caps, counting the bytes of loads
// still in flight; the AVIF / WebP variant fixed at creation. Generic over the texture type, so it holds no Pixi value
// and is tested in node over a fake loader; `scene/loader.ts` is the real `LoadImage`.
import type { AssetFetchError, AssetRef, ImageEntry, Result } from '../story/catalog.ts';
import type { AssetId } from '../story/staging.ts';

/** Preload admission: live + in-flight decoded bytes stay ≤ 32 MiB (K5). */
export const STEADY_CAP_BYTES = 33_554_432;
/** Visible admission, after evicting every preload-priority holder: ≤ 48 MiB (K5). */
export const HARD_CAP_BYTES = 50_331_648;
/** Principle 4: no texture side above 2048 px. The build gate is the first line, this the runtime one. */
export const MAX_TEXTURE_PX = 2048;

export type AssetError =
  | { kind: 'missing-id'; id: AssetId }
  | { kind: 'not-image'; id: AssetId }
  | { kind: 'too-large'; id: AssetId; w: number; h: number }
  | { kind: 'over-cap'; id: AssetId; needBytes: number; liveBytes: number; capBytes: number }
  | { kind: 'fetch'; id: AssetId; error: AssetFetchError }
  | { kind: 'decode'; id: AssetId; detail: string }
  | { kind: 'aborted'; id: AssetId };
export type SceneError = { kind: 'mount'; detail: string } | { kind: 'assets'; errors: readonly AssetError[] };

/** A loader failure; the loader sees a file reference, not an asset id, so the registry names the id. */
export type LoadError = { kind: 'fetch'; error: AssetFetchError } | { kind: 'decode'; detail: string } | { kind: 'aborted' };
/** A decoded image; `release()` frees the GPU texture and the CPU bitmap (`texture.destroy(true)` + `bitmap.close()`). */
export type Decoded<T> = { texture: T; w: number; h: number; release(): void };
export type LoadImage<T> = (ref: AssetRef, signal: AbortSignal) => Promise<Result<Decoded<T>, LoadError>>;
export type TextureHandle<T> = { readonly id: AssetId; readonly texture: T; readonly w: number; readonly h: number };
export type Priority = 'visible' | 'preload';
export type AcquireOptions = { entry: ImageEntry; priority: Priority; signal?: AbortSignal };
/** `bytes` = what the caps count: decoded bytes of live entries plus the reservations of loads in flight. */
export type RegistryStats = { live: number; bytes: number; pending: number; overCap: number };

export interface AssetRegistry<T> {
  /**
   * Adds `holder` to the id's holder set and resolves with the texture once it is decoded. Joining an entry that is
   * live or in flight costs no bytes and is never refused. A new entry is admitted only under its cap; the caller's
   * `signal` withdraws this holder (the load is aborted when no holder is left).
   */
  acquire(id: AssetId, holder: string, o: AcquireOptions): Promise<Result<TextureHandle<T>, AssetError>>;
  /** Removes one holder; idempotent. */
  release(id: AssetId, holder: string): void;
  /** `'preload:'` (a trailing `:`) releases that family; any other name is that exact holder only. */
  releaseHolder(h: string): void;
  stats(): RegistryStats;
  /** Releases every entry, aborting loads in flight; later calls are no-ops. */
  destroy(): void;
}

type Rec<T> = {
  readonly id: AssetId;
  readonly entry: ImageEntry;
  readonly holders: Map<string, Priority>;
  readonly controller: AbortController;
  /** Settles once, when the record leaves `pending`. */
  readonly outcome: Promise<Result<TextureHandle<T>, AssetError>>;
  readonly settle: (r: Result<TextureHandle<T>, AssetError>) => void;
  state: 'pending' | 'live' | 'dead';
  decoded: Decoded<T> | null;
  handle: TextureHandle<T> | null;
};

const fail = <E>(error: E): { ok: false; error: E } => ({ ok: false, error });

function assetError(id: AssetId, e: LoadError): AssetError {
  switch (e.kind) {
    case 'fetch':
      return { kind: 'fetch', id, error: e.error };
    case 'decode':
      return { kind: 'decode', id, detail: e.detail };
    case 'aborted':
      return { kind: 'aborted', id };
    default: {
      const unhandled: never = e;
      throw new Error(`invariant: unhandled load error ${String(unhandled)}`);
    }
  }
}

export function createAssetRegistry<T>(deps: { load: LoadImage<T>; variant: 'avif' | 'webp' }): AssetRegistry<T> {
  // Every record in the map is pending or live and counts its decodedBytes; a record leaves the map exactly once,
  // so a reservation is returned exactly once whatever order abort, release and a late settle come in.
  const records = new Map<AssetId, Rec<T>>();
  let overCap = 0;
  let destroyed = false;

  const counted = (): number => {
    let bytes = 0;
    for (const rec of records.values()) {
      bytes += rec.entry.decodedBytes;
    }
    return bytes;
  };

  /** Ends a record that is still pending: the load is aborted, the reservation returned, the waiters told. */
  const kill = (rec: Rec<T>, error: AssetError): void => {
    if (rec.state !== 'pending') {
      return;
    }
    rec.state = 'dead';
    if (records.get(rec.id) === rec) {
      records.delete(rec.id);
    }
    rec.controller.abort();
    rec.settle(fail(error));
  };

  /** Removes one holder of this record (never of a later record for the same id); an empty set ends the record. */
  const drop = (rec: Rec<T>, holder: string): void => {
    if (!rec.holders.delete(holder) || rec.holders.size > 0) {
      return;
    }
    if (rec.state === 'pending') {
      kill(rec, { kind: 'aborted', id: rec.id });
    } else if (rec.state === 'live') {
      rec.state = 'dead';
      records.delete(rec.id);
      rec.decoded?.release();
      rec.decoded = null;
    }
  };

  /** A load's result acts only on the record that started it (the PP's generation rule, by identity). */
  const onLoaded = (rec: Rec<T>, r: Result<Decoded<T>, LoadError>): void => {
    if (rec.state !== 'pending') {
      // Released, evicted or destroyed while in flight: a decoded result is destroyed at once.
      if (r.ok) {
        r.value.release();
      }
      return;
    }
    if (!r.ok) {
      kill(rec, assetError(rec.id, r.error));
      return;
    }
    const d = r.value;
    if (d.w !== rec.entry.w || d.h !== rec.entry.h) {
      // The caps counted the manifest's w × h × 4; a different decode would make them a fiction.
      d.release();
      kill(rec, { kind: 'decode', id: rec.id, detail: `decoded ${d.w}x${d.h}, manifest ${rec.entry.w}x${rec.entry.h}` });
      return;
    }
    rec.state = 'live';
    rec.decoded = d;
    rec.handle = { id: rec.id, texture: d.texture, w: d.w, h: d.h };
    rec.settle({ ok: true, value: rec.handle });
  };

  const start = (id: AssetId, entry: ImageEntry, holder: string, priority: Priority): Rec<T> => {
    let settle: (r: Result<TextureHandle<T>, AssetError>) => void = () => {};
    const outcome = new Promise<Result<TextureHandle<T>, AssetError>>((resolve) => {
      settle = resolve;
    });
    const rec: Rec<T> = {
      id,
      entry,
      holders: new Map([[holder, priority]]),
      controller: new AbortController(),
      outcome,
      settle,
      state: 'pending',
      decoded: null,
      handle: null,
    };
    records.set(id, rec);
    const ref = deps.variant === 'avif' ? entry.avif : entry.webp;
    let loading: Promise<Result<Decoded<T>, LoadError>>;
    try {
      loading = deps.load(ref, rec.controller.signal);
    } catch (e) {
      loading = Promise.resolve(fail({ kind: 'decode', detail: String(e) }));
    }
    // Not awaited: the result is delivered to this record by onLoaded, whenever it comes.
    void loading.then(
      (r) => onLoaded(rec, r),
      (e: unknown) => onLoaded(rec, fail({ kind: 'decode', detail: String(e) })),
    );
    return rec;
  };

  const evictPreloads = (): void => {
    for (const rec of [...records.values()]) {
      for (const [holder, priority] of [...rec.holders]) {
        if (priority === 'preload') {
          drop(rec, holder);
        }
      }
    }
  };

  /** K5: a preload must fit the steady cap; a visible load the hard cap, after evicting every preload holder. */
  const admit = (id: AssetId, need: number, priority: Priority): AssetError | null => {
    if (priority === 'preload') {
      const used = counted();
      return used + need <= STEADY_CAP_BYTES
        ? null
        : { kind: 'over-cap', id, needBytes: need, liveBytes: used, capBytes: STEADY_CAP_BYTES };
    }
    if (counted() + need <= HARD_CAP_BYTES) {
      return null;
    }
    evictPreloads();
    const used = counted();
    if (used + need <= HARD_CAP_BYTES) {
      return null;
    }
    overCap += 1;
    return { kind: 'over-cap', id, needBytes: need, liveBytes: used, capBytes: HARD_CAP_BYTES };
  };

  const waitFor = (rec: Rec<T>, holder: string, signal: AbortSignal | undefined): Promise<Result<TextureHandle<T>, AssetError>> => {
    if (rec.state === 'live' && rec.handle !== null) {
      return Promise.resolve({ ok: true, value: rec.handle });
    }
    return new Promise((resolve) => {
      const onAbort = (): void => {
        drop(rec, holder);
        resolve(fail({ kind: 'aborted', id: rec.id }));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      void rec.outcome.then((r) => {
        signal?.removeEventListener('abort', onAbort);
        // A holder released while the load was in flight never receives a texture it does not hold.
        resolve(r.ok && !rec.holders.has(holder) ? fail({ kind: 'aborted', id: rec.id }) : r);
      });
    });
  };

  return {
    acquire(id, holder, o) {
      if (destroyed || o.signal?.aborted === true) {
        return Promise.resolve(fail({ kind: 'aborted', id }));
      }
      const have = records.get(id);
      if (have !== undefined) {
        if (have.holders.get(holder) !== 'visible') {
          have.holders.set(holder, o.priority);
        }
        return waitFor(have, holder, o.signal);
      }
      const { entry } = o;
      if (entry.w > MAX_TEXTURE_PX || entry.h > MAX_TEXTURE_PX) {
        return Promise.resolve(fail({ kind: 'too-large', id, w: entry.w, h: entry.h }));
      }
      const refused = admit(id, entry.decodedBytes, o.priority);
      if (refused !== null) {
        return Promise.resolve(fail(refused));
      }
      return waitFor(start(id, entry, holder, o.priority), holder, o.signal);
    },
    release(id, holder) {
      const rec = records.get(id);
      if (rec !== undefined) {
        drop(rec, holder);
      }
    },
    releaseHolder(h) {
      const family = h.endsWith(':');
      for (const rec of [...records.values()]) {
        for (const holder of [...rec.holders.keys()]) {
          if (family ? holder.startsWith(h) : holder === h) {
            drop(rec, holder);
          }
        }
      }
    },
    stats() {
      let live = 0;
      let pending = 0;
      for (const rec of records.values()) {
        if (rec.state === 'live') {
          live += 1;
        } else {
          pending += 1;
        }
      }
      return { live, bytes: counted(), pending, overCap };
    },
    destroy() {
      destroyed = true;
      for (const rec of [...records.values()]) {
        for (const holder of [...rec.holders.keys()]) {
          drop(rec, holder);
        }
      }
      records.clear();
    },
  };
}
