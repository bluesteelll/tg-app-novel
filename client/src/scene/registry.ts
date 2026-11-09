// The texture registry (PROTOTYPE-PLAN K4, K5): one entry per asset id with a set of holders, destroyed when the set
// empties; admission under the 32 MiB steady (preload) and 48 MiB hard (visible) caps, counting the decoded bytes and
// the kept encoded file of every record, in flight included; the AVIF / WebP variant fixed at creation, and the size
// tier (MEMORY-PLAN 4.C: an entry's half file on a LOW phone) fixed at creation until a one-way demotion; after a GPU
// context change, the revive that brings every live texture to the current renderer (MEMORY-PLAN M2, 4.A, section 8).
// Generic over the texture type, so it holds no Pixi value and is tested in node over a fake loader;
// `scene/loader.ts` is the real `LoadImage`.
import type { AssetFetchError, AssetRef, ImageEntry, ImageFile, Result, SizeTier } from '../story/catalog.ts';
import type { AssetId } from '../story/staging.ts';
import { textureGeometry } from './layout.ts';
import type { TextureGeometry } from './layout.ts';

/** Preload admission: live + in-flight decoded bytes and their files stay ≤ 32 MiB (K5; MEMORY-PLAN M2). */
export const STEADY_CAP_BYTES = 33_554_432;
/** Visible admission, after evicting every preload-priority holder: ≤ 48 MiB (K5). */
export const HARD_CAP_BYTES = 50_331_648;
/** Principle 4: no texture side above 2048 px. The build gate is the first line, this the runtime one. */
export const MAX_TEXTURE_PX = 2048;
/**
 * A revive's deadline (MEMORY-PLAN section 8 "Revive failure"): every visible record is revived by this long after the
 * visible pass started, a background record by this long after its own start; a record that is not ends as failed.
 */
export const REVIVE_DEADLINE_MS = 3000;
/** How a revive pass settles: every record handled, or the revive aborted first. */
export type ReviveEnd = 'done' | 'aborted';

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
/**
 * A decoded image; `release()` frees the GPU texture, the CPU bitmap and the kept file (`texture.destroy(true)` +
 * `bitmap.close()` + the Blob dropped).
 * `w`, `h`: the bitmap's stored px, checked against the entry's.
 * `keptBytes`: the size of the encoded file the loader keeps (the fetched Blob), counted by the caps once live.
 * `gen`: the GPU generation the texture was last uploaded under, or null while its bitmap is kept open (not uploaded:
 * a lost context, or no GL renderer); read again after each `revive`.
 * `open()`: the decoded bitmap is still open (not closed after its upload).
 * `revive(gen)`: brings the texture to generation `gen`, in place (the same texture object): a kept bitmap is uploaded,
 * an uploaded one is decoded again from the kept file.
 */
export type Decoded<T> = {
  texture: T;
  w: number;
  h: number;
  keptBytes: number;
  gen: number | null;
  open(): boolean;
  revive(gen: number, signal: AbortSignal): Promise<Result<void, LoadError>>;
  release(): void;
};
/**
 * `geometry` lays the file out as its canvas (MEMORY-PLAN §6). A trailing parameter, so a loader that ignores it
 * still type-checks (the scene suites' fakes).
 */
export type LoadImage<T> = (ref: AssetRef, signal: AbortSignal, geometry: TextureGeometry) => Promise<Result<Decoded<T>, LoadError>>;
/** `w`, `h`: the canvas (a trimmed file's full image), what charPlacement sizes on (RULINGS 35). */
export type TextureHandle<T> = { readonly id: AssetId; readonly texture: T; readonly w: number; readonly h: number };
export type Priority = 'visible' | 'preload';
export type AcquireOptions = { entry: ImageEntry; priority: Priority; signal?: AbortSignal };
/**
 * `bytes` = what the caps count: decoded bytes + kept file bytes of live entries, plus the reservations (decoded +
 * the manifest's file bytes) of loads in flight. `keptBytes`: the kept files of live entries (inside `bytes`).
 * `keptMismatch` (cumulative, like `overCap`): entries that went live keeping another size than the manifest's file.
 * `openBitmaps`: live entries whose decoded bitmap is open. `stale`: live entries not yet brought to the generation of
 * the latest `revive` (0 before the first). `reviveFailed` (cumulative): entries ended by a failed or late revive.
 */
export type RegistryStats = {
  live: number;
  bytes: number;
  pending: number;
  overCap: number;
  keptBytes: number;
  keptMismatch: number;
  openBitmaps: number;
  stale: number;
  reviveFailed: number;
};
/** An id's record as `state(id)` reports it: decoded (revived or not), its load in flight, or no record. */
export type RecordState = 'live' | 'pending' | 'none';

export interface AssetRegistry<T> {
  /**
   * Adds `holder` to the id's holder set and resolves with the texture once it is decoded. Joining an entry that is
   * live or in flight costs no bytes and is never refused. A new entry is admitted only under its cap; the caller's
   * `signal` withdraws this holder (the load is aborted when no holder is left). Joining an entry not yet revived waits
   * for its revive, which takes that entry first; a revive that fails it answers `decode`.
   */
  acquire(id: AssetId, holder: string, o: AcquireOptions): Promise<Result<TextureHandle<T>, AssetError>>;
  /** Removes one holder; idempotent. */
  release(id: AssetId, holder: string): void;
  /** `'preload:'` (a trailing `:`) releases that family; any other name is that exact holder only. */
  releaseHolder(h: string): void;
  /**
   * The handle of the id's entry while that entry is live (revived or not), else null (none, in flight, ended). The
   * handle is the entry's identity: a revive keeps it, and an ended entry's handle is never current again.
   */
  current(id: AssetId): TextureHandle<T> | null;
  /**
   * The id's entry: `'live'` while decoded (revived or not), `'pending'` while its load is in flight, else `'none'` (never
   * acquired, ended, refused). An acquire of an id that is not `'none'` joins its entry: no bytes, never refused. A pure
   * read: it adds no holder and moves no byte.
   */
  state(id: AssetId): RecordState;
  /**
   * Brings every live entry not at `gen` to it, one at a time: entries with a visible holder first (`visible` settles
   * `'done'` once each is revived or ended, at the latest REVIVE_DEADLINE_MS after the pass started), then the rest
   * (`all`). An entry whose revive fails or is late ends at once. A newer call, or `signal`, aborts the revive: no entry
   * fails by an abort, and each pass not yet settled settles `'aborted'` then. Each pass settles exactly once.
   */
  revive(gen: number, signal: AbortSignal): { visible: Promise<ReviveEnd>; all: Promise<ReviveEnd> };
  /**
   * MEMORY-PLAN 4.C, the one-way demotion: every record started from now on loads its entry's full file. Live and
   * in-flight records keep the file they started with until they end; the layout does not depend on the tier (I4).
   */
  demote(): void;
  stats(): RegistryStats;
  /** Releases every entry, aborting loads in flight and a running revive; later calls are no-ops. */
  destroy(): void;
}

type Rec<T> = {
  readonly id: AssetId;
  readonly entry: ImageEntry;
  /** The file of the registry's tier when the record started (the entry's half, or the entry itself): what it counts. */
  readonly file: ImageFile;
  /** `file` in the session's variant: what the load fetches and the admission reserves. */
  readonly ref: AssetRef;
  /** The file's texture geometry (its tier's resolution on the entry's canvas), computed once when the record starts. */
  readonly geometry: TextureGeometry;
  readonly holders: Map<string, Priority>;
  readonly controller: AbortController;
  /** Settles once, when the record leaves `pending`. */
  readonly outcome: Promise<Result<TextureHandle<T>, AssetError>>;
  readonly settle: (r: Result<TextureHandle<T>, AssetError>) => void;
  /** Acquires waiting for this live record's revive; told once it is revived or ends. */
  readonly waiting: Set<(r: Result<TextureHandle<T>, AssetError>) => void>;
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

/** Resolves with 'late' after REVIVE_DEADLINE_MS, unless cleared. */
function deadline(): { late: Promise<'late'>; clear(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<'late'>((resolve) => {
    timer = setTimeout(() => resolve('late'), REVIVE_DEADLINE_MS);
  });
  return { late, clear: () => clearTimeout(timer) };
}

/**
 * `tier` is required (critique_r2 W6): a caller that forgets it would load the full tier silently. `'half'` loads each
 * entry's half file where it has one (MEMORY-PLAN 4.C), until `demote()`.
 */
export function createAssetRegistry<T>(deps: { load: LoadImage<T>; variant: 'avif' | 'webp'; tier: SizeTier }): AssetRegistry<T> {
  // Every record in the map is pending or live and counts its decodedBytes; a record leaves the map exactly once,
  // so a reservation is returned exactly once whatever order abort, release and a late settle come in.
  const records = new Map<AssetId, Rec<T>>();
  /** The tier of records started from now on; only `demote()` changes it, to 'full'. */
  let tier = deps.tier;
  let overCap = 0;
  let keptMismatch = 0;
  let reviveFailed = 0;
  /** The generation of the latest revive() call; null before the first. */
  let reviveGen: number | null = null;
  /** The revive in progress, if any. */
  let reviving: { abort(): void } | null = null;
  let destroyed = false;

  const refOf = (file: ImageFile): AssetRef => (deps.variant === 'avif' ? file.avif : file.webp);
  /** A pending record reserves the manifest's file; a live one counts the file its loader kept, at its real size. */
  const counted = (): number => {
    let bytes = 0;
    for (const rec of records.values()) {
      bytes += rec.file.decodedBytes + (rec.decoded === null ? rec.ref.bytes : rec.decoded.keptBytes);
    }
    return bytes;
  };
  /** A live record whose texture is not at `gen`: kept open (never uploaded) or uploaded under an older generation. */
  const isStale = (rec: Rec<T>, gen: number | null): boolean => {
    const g = rec.decoded?.gen;
    return rec.state === 'live' && gen !== null && g !== undefined && (g === null || g < gen);
  };
  const hasVisibleHolder = (rec: Rec<T>): boolean => [...rec.holders.values()].includes('visible');

  /** Tells every acquire waiting on this record's revive. */
  const wake = (rec: Rec<T>, r: Result<TextureHandle<T>, AssetError>): void => {
    const waiting = [...rec.waiting];
    rec.waiting.clear();
    for (const w of waiting) {
      w(r);
    }
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

  /** Ends a live record: it leaves the map, its texture and kept file are freed, its waiting acquires told `error`. */
  const end = (rec: Rec<T>, error: AssetError): void => {
    if (rec.state !== 'live') {
      return;
    }
    rec.state = 'dead';
    if (records.get(rec.id) === rec) {
      records.delete(rec.id);
    }
    rec.decoded?.release();
    rec.decoded = null;
    wake(rec, fail(error));
  };

  /** Section 8 "Revive failure": the record ends whatever its holders, so no later acquire can join it. */
  const failRevive = (rec: Rec<T>, detail: string): void => {
    if (rec.state !== 'live') {
      return;
    }
    reviveFailed += 1;
    end(rec, { kind: 'decode', id: rec.id, detail });
  };

  /** Removes one holder of this record (never of a later record for the same id); an empty set ends the record. */
  const drop = (rec: Rec<T>, holder: string): void => {
    if (!rec.holders.delete(holder) || rec.holders.size > 0) {
      return;
    }
    if (rec.state === 'pending') {
      kill(rec, { kind: 'aborted', id: rec.id });
    } else {
      end(rec, { kind: 'aborted', id: rec.id });
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
    if (d.w !== rec.file.w || d.h !== rec.file.h) {
      // The caps counted the manifest's w × h × 4; a different decode would make them a fiction.
      d.release();
      kill(rec, { kind: 'decode', id: rec.id, detail: `decoded ${d.w}x${d.h}, manifest ${rec.file.w}x${rec.file.h}` });
      return;
    }
    rec.state = 'live';
    rec.decoded = d;
    if (d.keptBytes !== rec.ref.bytes) {
      // A host that rewrites images: counted as it is (above), never refused, so it cannot black the stage.
      keptMismatch += 1;
    }
    rec.handle = { id: rec.id, texture: d.texture, w: rec.geometry.canvas.w, h: rec.geometry.canvas.h };
    rec.settle({ ok: true, value: rec.handle });
  };

  const start = (id: AssetId, entry: ImageEntry, file: ImageFile, ref: AssetRef, holder: string, priority: Priority): Rec<T> => {
    let settle: (r: Result<TextureHandle<T>, AssetError>) => void = () => {};
    const outcome = new Promise<Result<TextureHandle<T>, AssetError>>((resolve) => {
      settle = resolve;
    });
    const rec: Rec<T> = {
      id,
      entry,
      file,
      ref,
      geometry: textureGeometry(entry, file === entry ? 'full' : 'half'),
      holders: new Map([[holder, priority]]),
      controller: new AbortController(),
      outcome,
      settle,
      waiting: new Set(),
      state: 'pending',
      decoded: null,
      handle: null,
    };
    records.set(id, rec);
    let loading: Promise<Result<Decoded<T>, LoadError>>;
    try {
      loading = deps.load(ref, rec.controller.signal, rec.geometry);
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
    if (rec.state === 'live' && rec.handle !== null && !isStale(rec, reviveGen)) {
      return Promise.resolve({ ok: true, value: rec.handle });
    }
    return new Promise((resolve) => {
      // A holder released while the record was in flight or stale never receives a texture it does not hold.
      const told = (r: Result<TextureHandle<T>, AssetError>): void => {
        signal?.removeEventListener('abort', onAbort);
        resolve(r.ok && !rec.holders.has(holder) ? fail({ kind: 'aborted', id: rec.id }) : r);
      };
      const onAbort = (): void => {
        rec.waiting.delete(told);
        drop(rec, holder);
        resolve(fail({ kind: 'aborted', id: rec.id }));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      if (rec.state === 'live') {
        // Not yet revived: the revive takes this record first (`next`) and tells it.
        rec.waiting.add(told);
      } else {
        void rec.outcome.then(told);
      }
    });
  };

  /** The next record a revive to `gen` takes: one an acquire waits on first, then by insertion; visible ones only. */
  const next = (gen: number, tried: ReadonlySet<Rec<T>>, visibleOnly: boolean): Rec<T> | null => {
    const due = (rec: Rec<T>): boolean => !tried.has(rec) && isStale(rec, gen) && (!visibleOnly || hasVisibleHolder(rec));
    for (const rec of records.values()) {
      if (rec.waiting.size > 0 && due(rec)) {
        return rec;
      }
    }
    for (const rec of records.values()) {
      if (due(rec)) {
        return rec;
      }
    }
    return null;
  };

  /** One record's revive, raced against `late`; an abort of the revive fails nothing. */
  const reviveOne = async (rec: Rec<T>, gen: number, signal: AbortSignal, late: Promise<'late'>): Promise<void> => {
    const d = rec.decoded;
    if (d === null) {
      return;
    }
    const own = new AbortController();
    const stop = (): void => own.abort();
    signal.addEventListener('abort', stop, { once: true });
    let attempt: Promise<Result<void, LoadError>>;
    try {
      attempt = d.revive(gen, own.signal);
    } catch (e) {
      attempt = Promise.resolve(fail({ kind: 'decode', detail: String(e) }));
    }
    const r = await Promise.race([attempt.catch((e: unknown) => fail({ kind: 'decode' as const, detail: String(e) })), late]);
    signal.removeEventListener('abort', stop);
    if (signal.aborted || rec.state !== 'live' || rec.decoded !== d) {
      // Aborted (records stay stale for the next revive), or released meanwhile (its late bitmap is the loader's).
      own.abort();
      return;
    }
    if (r === 'late') {
      own.abort();
      failRevive(rec, `not revived within ${REVIVE_DEADLINE_MS} ms`);
    } else if (!r.ok) {
      failRevive(rec, r.error.kind === 'decode' ? r.error.detail : `revive ${r.error.kind}`);
    } else if (!isStale(rec, gen) && rec.handle !== null) {
      wake(rec, { ok: true, value: rec.handle });
    }
  };

  /** The two passes of one revive; returns at its abort. */
  const drive = async (gen: number, signal: AbortSignal, visibleDone: () => void, allDone: () => void): Promise<void> => {
    const tried = new Set<Rec<T>>();
    // The visible pass: one deadline for all of it, so frames are never suspended past it.
    const pass = deadline();
    let expired = false;
    void pass.late.then(() => {
      expired = true;
    });
    try {
      for (let rec = next(gen, tried, true); rec !== null; rec = next(gen, tried, true)) {
        tried.add(rec);
        if (expired) {
          failRevive(rec, `not revived within ${REVIVE_DEADLINE_MS} ms`);
          continue;
        }
        await reviveOne(rec, gen, signal, pass.late);
        if (signal.aborted) {
          return;
        }
      }
    } finally {
      pass.clear();
    }
    visibleDone();
    // The background pass: each record by its own deadline.
    for (let rec = next(gen, tried, false); rec !== null; rec = next(gen, tried, false)) {
      tried.add(rec);
      const own = deadline();
      try {
        await reviveOne(rec, gen, signal, own.late);
      } finally {
        own.clear();
      }
      if (signal.aborted) {
        return;
      }
    }
    allDone();
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
      // The record's file is resolved once, here: a demotion later never moves a record that has started.
      const file = tier === 'half' && entry.half !== undefined ? entry.half : entry;
      const ref = refOf(file);
      const refused = admit(id, file.decodedBytes + ref.bytes, o.priority);
      if (refused !== null) {
        return Promise.resolve(fail(refused));
      }
      return waitFor(start(id, entry, file, ref, holder, o.priority), holder, o.signal);
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
    current(id) {
      const rec = records.get(id);
      return rec?.state === 'live' ? rec.handle : null;
    },
    state(id) {
      // The map holds pending and live records only (kill / end delete), so a dead one is never reported.
      const s = records.get(id)?.state;
      return s === 'live' || s === 'pending' ? s : 'none';
    },
    revive(gen, signal) {
      reviving?.abort();
      reviveGen = gen;
      let settleVisible: (e: ReviveEnd) => void = () => {};
      let settleAll: (e: ReviveEnd) => void = () => {};
      const visible = new Promise<ReviveEnd>((resolve) => {
        settleVisible = resolve;
      });
      const all = new Promise<ReviveEnd>((resolve) => {
        settleAll = resolve;
      });
      const controller = new AbortController();
      let visibleOpen = true;
      let allOpen = true;
      const run = {
        abort(): void {
          if (controller.signal.aborted) {
            return;
          }
          controller.abort();
          signal.removeEventListener('abort', run.abort);
          if (reviving === run) {
            reviving = null;
          }
          if (visibleOpen) {
            visibleOpen = false;
            settleVisible('aborted');
          }
          if (allOpen) {
            allOpen = false;
            settleAll('aborted');
          }
        },
      };
      reviving = run;
      if (destroyed || signal.aborted) {
        run.abort();
        return { visible, all };
      }
      signal.addEventListener('abort', run.abort, { once: true });
      void drive(
        gen,
        controller.signal,
        () => {
          visibleOpen = false;
          settleVisible('done');
        },
        () => {
          allOpen = false;
          settleAll('done');
          signal.removeEventListener('abort', run.abort);
          if (reviving === run) {
            reviving = null;
          }
        },
      );
      return { visible, all };
    },
    demote() {
      tier = 'full';
    },
    stats() {
      let live = 0;
      let pending = 0;
      let keptBytes = 0;
      let openBitmaps = 0;
      let stale = 0;
      for (const rec of records.values()) {
        if (rec.state === 'live') {
          live += 1;
          keptBytes += rec.decoded?.keptBytes ?? 0;
          openBitmaps += rec.decoded?.open() === true ? 1 : 0;
          stale += isStale(rec, reviveGen) ? 1 : 0;
        } else {
          pending += 1;
        }
      }
      return { live, bytes: counted(), pending, overCap, keptBytes, keptMismatch, openBitmaps, stale, reviveFailed };
    },
    destroy() {
      destroyed = true;
      reviving?.abort();
      for (const rec of [...records.values()]) {
        for (const holder of [...rec.holders.keys()]) {
          drop(rec, holder);
        }
      }
      records.clear();
    },
  };
}
