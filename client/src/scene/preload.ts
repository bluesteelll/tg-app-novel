// Asset scheduling over the registry (PROTOTYPE-PLAN "Per-chapter manifest", "Preload", F4, F5): the current
// chapter's manifest, id resolution (in `from` when given, so the next chapter's ids resolve in its own manifest),
// background preloads under a tag (`preload:<knot>`, `next:<chapterId>`, `room:<roomId>`) with two fetches in flight,
// and the blocking `ensure` of a batch's assets under the holder `ensure`. Pure over the registry: no Pixi, no fetch.
import type { AssetManifest, ImageEntry, Result } from '../story/catalog.ts';
import type { AssetId } from '../story/staging.ts';
import type { AssetError, AssetRegistry, SceneError } from './registry.ts';

/** Preload fetches in flight at once; `ensure` is not limited. */
export const PRELOAD_IN_FLIGHT = 2;
/**
 * The holder of a batch's blocking loads (D7): released once apply / restore took the slot holders, and by setChapter
 * and destroy. One name serves because GameSession's single intent queue runs one ensure at a time.
 */
export const ENSURE_HOLDER = 'ensure';

export interface AssetScheduler {
  /** Swaps the manifest; releases every `preload:*`, every `next:*` except `next:<m.chapterId>`, and `ensure`. */
  setChapter(m: AssetManifest): void;
  resolve(id: AssetId, from?: AssetManifest): Result<ImageEntry, AssetError>;
  /** Background, at preload priority; an id that does not resolve is reported and skipped. */
  preload(tag: string, ids: readonly AssetId[], from?: AssetManifest): void;
  /** Drops queued and in-flight preloads of the tag and releases its holder; a trailing `:` names a family. */
  releasePreload(tag: string): void;
  /** Loads a batch's assets at visible priority; resolves once every one is live or failed. */
  ensure(ids: readonly AssetId[], signal: AbortSignal): Promise<Result<void, SceneError>>;
  destroy(): void;
}

type Item = { readonly tag: string; readonly id: AssetId; readonly entry: ImageEntry };
type Flight = Item & { readonly controller: AbortController };

/** The registry's holder rule: a trailing `:` is a family, any other name is exact. */
const matches = (tag: string, pattern: string): boolean => (pattern.endsWith(':') ? tag.startsWith(pattern) : tag === pattern);

export function createAssetScheduler<T>(deps: { registry: AssetRegistry<T>; onError(e: AssetError): void }): AssetScheduler {
  const { registry } = deps;
  let manifest: AssetManifest | null = null;
  let queue: Item[] = [];
  let inFlight: Flight[] = [];
  /** Every tag preload() was given and not released since. */
  const tags = new Set<string>();
  let dead = false;

  const resolve = (id: AssetId, from?: AssetManifest): Result<ImageEntry, AssetError> => {
    const m = from ?? manifest;
    const entry = m !== null && Object.hasOwn(m.assets, id) ? m.assets[id] : undefined;
    if (entry === undefined) {
      return { ok: false, error: { kind: 'missing-id', id } };
    }
    if (entry.kind !== 'image') {
      return { ok: false, error: { kind: 'not-image', id } };
    }
    return { ok: true, value: entry };
  };

  const pump = (): void => {
    while (!dead && inFlight.length < PRELOAD_IN_FLIGHT) {
      const item = queue.shift();
      if (item === undefined) {
        return;
      }
      const flight: Flight = { ...item, controller: new AbortController() };
      inFlight.push(flight);
      const o = { entry: item.entry, priority: 'preload' as const, signal: flight.controller.signal };
      // Not awaited: the slot frees when the acquire settles, whichever way.
      void registry.acquire(item.id, item.tag, o).then((r) => {
        inFlight = inFlight.filter((f) => f !== flight);
        // A preload over the steady cap is expected (K5) and an aborted one was released on purpose.
        if (!r.ok && r.error.kind !== 'aborted' && r.error.kind !== 'over-cap') {
          deps.onError(r.error);
        }
        pump();
      });
    }
  };

  const releasePreload = (pattern: string): void => {
    queue = queue.filter((i) => !matches(i.tag, pattern));
    for (const f of inFlight.filter((x) => matches(x.tag, pattern))) {
      f.controller.abort();
    }
    inFlight = inFlight.filter((x) => !matches(x.tag, pattern));
    for (const t of [...tags]) {
      if (matches(t, pattern)) {
        tags.delete(t);
      }
    }
    registry.releaseHolder(pattern);
    pump();
  };

  return {
    setChapter(m) {
      if (dead) {
        return;
      }
      manifest = m;
      const kept = `next:${m.chapterId}`;
      for (const t of [...tags]) {
        if (t.startsWith('next:') && t !== kept) {
          releasePreload(t);
        }
      }
      releasePreload('preload:');
      registry.releaseHolder(ENSURE_HOLDER);
    },
    resolve,
    preload(tag, ids, from) {
      if (dead) {
        return;
      }
      tags.add(tag);
      for (const id of ids) {
        const r = resolve(id, from);
        if (!r.ok) {
          deps.onError(r.error);
          continue;
        }
        const known = (x: Item): boolean => x.tag === tag && x.id === id;
        if (!queue.some(known) && !inFlight.some(known)) {
          queue.push({ tag, id, entry: r.value });
        }
      }
      pump();
    },
    releasePreload,
    async ensure(ids, signal) {
      const outcomes = ids.map(async (id): Promise<AssetError | null> => {
        if (dead) {
          return { kind: 'aborted', id };
        }
        const r = resolve(id);
        if (!r.ok) {
          return r.error;
        }
        const got = await registry.acquire(id, ENSURE_HOLDER, { entry: r.value, priority: 'visible', signal });
        return got.ok ? null : got.error;
      });
      const errors = (await Promise.all(outcomes)).filter((e): e is AssetError => e !== null);
      return errors.length === 0 ? { ok: true, value: undefined } : { ok: false, error: { kind: 'assets', errors } };
    },
    destroy() {
      if (dead) {
        return;
      }
      dead = true;
      queue = [];
      for (const f of inFlight) {
        f.controller.abort();
      }
      inFlight = [];
      for (const t of tags) {
        registry.releaseHolder(t);
      }
      tags.clear();
      registry.releaseHolder(ENSURE_HOLDER);
      manifest = null;
    },
  };
}
