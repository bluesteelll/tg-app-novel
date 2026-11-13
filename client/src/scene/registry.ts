// The texture registry (PROTOTYPE-PLAN K4, K5): one entry per asset id with a set of holders, destroyed when the set
// empties; admission under the 32 MiB steady (preload) and 48 MiB hard (visible) caps, counting the decoded bytes and
// the kept encoded file of every record, in flight included; the AVIF / WebP variant fixed at creation, and the size
// tier (MEMORY-PLAN 4.C: an entry's half file on a LOW phone) fixed at creation until a one-way demotion; after a GPU
// context change, the revive that brings every live texture to the current renderer (MEMORY-PLAN M2, 4.A, section 8);
// the warm form (shots §5.8): a record held as its fetched file, decoded only for a non-warm holder, shed back to the
// file when the last of those leaves. Generic over the texture type, so it holds no Pixi value and is tested in node
// over a fake loader; `scene/loader.ts` is the real `HoldImage`.
import type { AssetFetchError, AssetRef, ImageEntry, ImageFile, Result, SizeTier } from '../story/catalog.ts';
import type { Box } from '../story/shots.ts';
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
 * A decoded image; `release()` frees the GPU texture and the CPU bitmap (`texture.destroy(true)` + `bitmap.close()`); a
 * texture decoded from a held file borrows its Blob, which only the file's `drop()` frees.
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
/**
 * A fetched file kept as its bytes (shots §5.8 "The warm form"). `bytes`: its real size, what the caps count while no
 * texture is decoded from it. `decode` makes a texture from it with no fetch, as often as asked; `drop()` frees the
 * bytes, once, when the record ends.
 */
export type HeldFile<T> = {
  readonly bytes: number;
  decode(signal: AbortSignal, geometry: TextureGeometry): Promise<Result<Decoded<T>, LoadError>>;
  drop(): void;
};
/** Fetches a file and keeps it: `scene/loader.ts`. */
export type HoldImage<T> = (ref: AssetRef, signal: AbortSignal) => Promise<Result<HeldFile<T>, LoadError>>;
/** `w`, `h`: the canvas (a trimmed file's full image), what charPlacement sizes on (RULINGS 35). */
export type TextureHandle<T> = { readonly id: AssetId; readonly texture: T; readonly w: number; readonly h: number };
/** `warm`: the file only, never decoded for this holder (shots §5.8 step 3). */
export type Priority = 'visible' | 'preload' | 'warm';
export type AcquireOptions = { entry: ImageEntry; priority: Priority; signal?: AbortSignal };
/**
 * `bytes` = what the caps count: every record's file (the manifest's bytes while it is fetched, its real size once
 * held) plus the decoded bytes of each record with a non-warm holder, decoded or in flight. `keptBytes`: the files of
 * live records and of records with warm holders only (inside `bytes`), so `bytes - keptBytes` is texture bytes plus
 * the decodes in flight. `pending`: records with a fetch or a decode in flight, warm ones included.
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
/** The warm form's counts (shots §5.8): records with a warm holder, and the file bytes of those held with no texture. */
export type WarmStats = { warm: number; warmBytes: number };
/**
 * An id's record as `state(id)` reports it: decoded (revived or not); a non-warm holder waiting for its texture; warm
 * holders only (the file fetched or in flight); or no record.
 */
export type RecordState = 'live' | 'pending' | 'held' | 'none';
/**
 * How a record's texture is cut into frames (shots §5.1 "Ownership": a shot file's packed members): `cut` makes a
 * frame over the record's own source at a box in the file's full px, `dispose` destroys it and never that source.
 */
export type FrameCut<T> = { cut(base: T, box: Box): T; dispose(frame: T): void };

/**
 * The Pixi cut (the `texture-create` rule's file). A half file's source has resolution 0.5, so its width is already in
 * full px (Pixi 8: width = pixelWidth / resolution; a frame's UVs are frame / source width): the member's box cuts either
 * tier as the rig gives it. Its dispose leaves the source, which is the record's and dies with `release()`. Structural,
 * so this file keeps type-only Pixi imports and the scene suites pass stand-ins.
 */
export function pixiFrames<T extends { readonly source: unknown; destroy(destroySource?: boolean): void }, R>(pixi: {
  Texture: new (o: { source: T['source']; frame: R }) => T;
  Rectangle: new (x: number, y: number, w: number, h: number) => R;
}): FrameCut<T> {
  return {
    cut: (base, [x, y, w, h]) => new pixi.Texture({ source: base.source, frame: new pixi.Rectangle(x, y, w, h) }),
    dispose: (frame) => frame.destroy(false),
  };
}

export interface AssetRegistry<T> {
  /**
   * A `warm` holder: resolves once the id's file is held (no texture). It joins an existing record in any state at no
   * byte, never refused. A new record is admitted for its file under the steady cap; a registry with no `hold` refuses a
   * new warm record `decode` at once, as it does for a file marked undecodable.
   */
  acquire(id: AssetId, holder: string, o: AcquireOptions & { priority: 'warm' }): Promise<Result<null, AssetError>>;
  /**
   * Adds `holder` to the id's holder set and resolves with the texture once it is decoded. Joining an entry that is
   * live or in flight to be decoded costs no bytes and is never refused; joining a held one decodes its file (no
   * fetch), admitted for the decoded bytes. A new entry is admitted only under its cap; the caller's `signal` withdraws
   * this holder (the load is aborted when no holder is left). Joining an entry not yet revived waits for its revive,
   * which takes that entry first; a revive that fails it answers `decode`. A `preload` of a file marked undecodable is
   * refused `decode` at once; a `visible` one tries it again, and its success lifts the mark.
   */
  acquire(id: AssetId, holder: string, o: AcquireOptions & { priority: 'visible' | 'preload' }): Promise<Result<TextureHandle<T>, AssetError>>;
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
   * The id's entry: `'live'` while decoded (revived or not), `'pending'` while a non-warm holder waits for its texture,
   * `'held'` while it has warm holders only, else `'none'` (never acquired, ended, refused). An acquire of a live or
   * pending entry joins it: no bytes, never refused. A pure read: it adds no holder and moves no byte.
   */
  state(id: AssetId): RecordState;
  /** The id's record has a fetch or a decode in flight (what `stats().pending` sums). */
  loading(id: AssetId): boolean;
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
  warmStats(): WarmStats;
  /**
   * Frames cut from the live record behind `h` at `boxes` (file px), once per box, owned by that record: disposed when
   * it ends, before its texture is released. Refused (`decode`) for a handle that is not the id's current record, and
   * by a registry made without a FrameCut.
   */
  frames(h: TextureHandle<T>, boxes: readonly Box[]): Result<readonly T[], AssetError>;
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
  /** The fetch stage's: aborted only when the record ends, so a shed never refetches. */
  readonly controller: AbortController;
  /** The fetched file; null while the fetch is in flight. */
  held: HeldFile<T> | null;
  /** The decode in flight, under its own controller (a shed aborts it and keeps the file); null when none is. */
  attempt: AbortController | null;
  /** Acquires waiting for a texture (its decode, or the revive of a live one); told once it is there or ends. */
  readonly waiting: Set<Told<T>>;
  /** Warm acquires waiting for the file. */
  readonly files: Set<Told<T>>;
  dead: boolean;
  /** Its first decode is done: `keptMismatch` counts a record once. */
  decodedOnce: boolean;
  decoded: Decoded<T> | null;
  handle: TextureHandle<T> | null;
  /** The frames cut from this record's texture, by box. */
  readonly frames: Map<string, T>;
};
type Told<T> = (r: Result<TextureHandle<T> | null, AssetError>) => void;

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
 * entry's half file where it has one (MEMORY-PLAN 4.C), until `demote()`. The image dep is `hold` (production) or
 * `load` (the scene suites' fakes): a `load`-only registry runs the same record stages, its file held at once as a name
 * for its load, so it holds no bytes and refuses `warm`.
 */
export function createAssetRegistry<T>(
  deps: { variant: 'avif' | 'webp'; tier: SizeTier; frames?: FrameCut<T> } & ({ hold: HoldImage<T> } | { load: LoadImage<T> }),
): AssetRegistry<T> {
  // Every record in the map is fetching, held, decoding or live; a record leaves the map exactly once, so its bytes
  // are returned exactly once whatever order abort, release, a shed and a late settle come in.
  const records = new Map<AssetId, Rec<T>>();
  /** URLs whose file failed to decode: a background ask of one is refused, a visible ask tries it again. */
  const undecodable = new Set<string>();
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
  /** A record decodes for its non-warm holders only; with warm ones alone it is its file. */
  const decodes = (rec: Rec<T>): boolean => [...rec.holders.values()].some((p) => p !== 'warm');
  /** A fetch or a decode in flight. */
  const loading = (rec: Rec<T>): boolean => rec.held === null || rec.attempt !== null;
  /** Each record's file (the manifest's bytes in flight, its real size once kept), plus its decode if it has one. */
  const counted = (): number => {
    let bytes = 0;
    for (const rec of records.values()) {
      bytes += (rec.decoded?.keptBytes ?? rec.held?.bytes ?? rec.ref.bytes) + (decodes(rec) ? rec.file.decodedBytes : 0);
    }
    return bytes;
  };
  /** A live record whose texture is not at `gen`: kept open (never uploaded) or uploaded under an older generation. */
  const isStale = (rec: Rec<T>, gen: number | null): boolean => {
    const g = rec.decoded?.gen;
    return gen !== null && g !== undefined && (g === null || g < gen);
  };
  const hasVisibleHolder = (rec: Rec<T>): boolean => [...rec.holders.values()].includes('visible');
  const aborted = (id: AssetId): { ok: false; error: AssetError } => fail({ kind: 'aborted', id });

  /** Tells every acquire of the set. */
  const tell = (set: Set<Told<T>>, r: Result<TextureHandle<T> | null, AssetError>): void => {
    const waiting = [...set];
    set.clear();
    for (const w of waiting) {
      w(r);
    }
  };

  /** The texture leaves the record (its frames first: each is a view of the source that release() destroys); a decode in flight is aborted. */
  const undecode = (rec: Rec<T>): void => {
    for (const f of rec.frames.values()) {
      deps.frames?.dispose(f);
    }
    rec.frames.clear();
    rec.decoded?.release();
    rec.decoded = null;
    rec.handle = null;
    rec.attempt?.abort();
    rec.attempt = null;
  };

  /** Ends a record whatever its holders: it leaves the map, its fetch and decode are aborted, its texture and file freed, every waiter told. */
  const end = (rec: Rec<T>, error: AssetError): void => {
    if (rec.dead) {
      return;
    }
    rec.dead = true;
    if (records.get(rec.id) === rec) {
      records.delete(rec.id);
    }
    rec.controller.abort();
    undecode(rec);
    rec.held?.drop();
    rec.held = null;
    tell(rec.waiting, fail(error));
    tell(rec.files, fail(error));
  };

  /** Section 8 "Revive failure": the record ends whatever its holders, so no later acquire can join it. */
  const failRevive = (rec: Rec<T>, detail: string): void => {
    if (rec.decoded === null) {
      return;
    }
    reviveFailed += 1;
    end(rec, { kind: 'decode', id: rec.id, detail });
  };

  /**
   * Removes one holder of this record (never of a later record for the same id): an empty set ends the record; the last
   * non-warm holder leaving sheds it to its file in this turn (texture or decode gone, reservation returned).
   */
  const drop = (rec: Rec<T>, holder: string): void => {
    const was = rec.holders.get(holder);
    if (!rec.holders.delete(holder)) {
      return;
    }
    if (rec.holders.size === 0) {
      end(rec, { kind: 'aborted', id: rec.id });
    } else if (was !== 'warm' && !decodes(rec)) {
      undecode(rec);
      tell(rec.waiting, aborted(rec.id));
    }
  };

  /** A file that fails to decode ends its record and is marked, so no step asks for it again in the background. */
  const failDecode = (rec: Rec<T>, detail: string): void => {
    undecodable.add(rec.ref.url);
    end(rec, { kind: 'decode', id: rec.id, detail });
  };

  /** A decode's result acts only on the attempt that is the record's own (by identity): a shed or ended one is ignored. */
  const onDecoded = (rec: Rec<T>, attempt: AbortController, r: Result<Decoded<T>, LoadError>): void => {
    if (rec.attempt !== attempt) {
      // Shed, released or destroyed while in flight: a texture is released at once, a failure ends nothing.
      if (r.ok) {
        r.value.release();
      }
      return;
    }
    rec.attempt = null;
    if (!r.ok) {
      if (r.error.kind === 'decode') {
        failDecode(rec, r.error.detail);
      } else {
        end(rec, assetError(rec.id, r.error));
      }
      return;
    }
    const d = r.value;
    if (d.w !== rec.file.w || d.h !== rec.file.h) {
      // The caps counted the manifest's w × h × 4; a different decode would make them a fiction.
      d.release();
      failDecode(rec, `decoded ${d.w}x${d.h}, manifest ${rec.file.w}x${rec.file.h}`);
      return;
    }
    undecodable.delete(rec.ref.url);
    rec.decoded = d;
    if (!rec.decodedOnce && d.keptBytes !== rec.ref.bytes) {
      // A host that rewrites images: counted as it is (above), never refused, so it cannot black the stage.
      keptMismatch += 1;
    }
    rec.decodedOnce = true;
    rec.handle = { id: rec.id, texture: d.texture, w: rec.geometry.canvas.w, h: rec.geometry.canvas.h };
    tell(rec.waiting, { ok: true, value: rec.handle });
  };

  const decode = (rec: Rec<T>, held: HeldFile<T>): void => {
    const attempt = new AbortController();
    rec.attempt = attempt;
    let decoding: Promise<Result<Decoded<T>, LoadError>>;
    try {
      decoding = held.decode(attempt.signal, rec.geometry);
    } catch (e) {
      decoding = Promise.resolve(fail({ kind: 'decode', detail: String(e) }));
    }
    // Not awaited: the result is delivered to this attempt by onDecoded, whenever it comes.
    void decoding.then(
      (r) => onDecoded(rec, attempt, r),
      (e: unknown) => onDecoded(rec, attempt, fail({ kind: 'decode', detail: String(e) })),
    );
  };

  /** The fetch stage's end: a failure ends the record and marks nothing (a later ask fetches again). */
  const onFetched = (rec: Rec<T>, r: Result<HeldFile<T>, LoadError>): void => {
    if (rec.dead) {
      if (r.ok) {
        r.value.drop();
      }
      return;
    }
    if (!r.ok) {
      end(rec, assetError(rec.id, r.error));
      return;
    }
    rec.held = r.value;
    tell(rec.files, { ok: true, value: null });
    if (decodes(rec)) {
      decode(rec, r.value);
    }
  };

  const start = (id: AssetId, entry: ImageEntry, file: ImageFile, ref: AssetRef, holder: string, priority: Priority): Rec<T> => {
    const rec: Rec<T> = {
      id,
      entry,
      file,
      ref,
      geometry: textureGeometry(entry, file === entry ? 'full' : 'half'),
      holders: new Map([[holder, priority]]),
      controller: new AbortController(),
      held: null,
      attempt: null,
      waiting: new Set(),
      files: new Set(),
      dead: false,
      decodedOnce: false,
      decoded: null,
      handle: null,
      frames: new Map(),
    };
    records.set(id, rec);
    if ('load' in deps) {
      // In this turn, so the load starts inside acquire's call, as a one-stage loader's does.
      const { load } = deps;
      onFetched(rec, { ok: true, value: { bytes: ref.bytes, decode: (s, g) => load(ref, s, g), drop: () => {} } });
    } else {
      void deps.hold(ref, rec.controller.signal).then(
        (r) => onFetched(rec, r),
        (e: unknown) => onFetched(rec, fail({ kind: 'decode', detail: String(e) })),
      );
    }
    return rec;
  };

  /** Drops every holder of `priority`, on every record but `self`. */
  const evict = (priority: Priority, self: Rec<T> | undefined): void => {
    for (const rec of [...records.values()]) {
      for (const [holder, p] of [...rec.holders]) {
        if (p === priority && rec !== self) {
          drop(rec, holder);
        }
      }
    }
  };

  /**
   * K5: a preload or warm file must fit the steady cap; a visible load the hard cap, after evicting every preload
   * holder, then the warm holders of other records.
   */
  const admit = (id: AssetId, need: number, priority: Priority, self?: Rec<T>): AssetError | null => {
    if (priority !== 'visible') {
      const used = counted();
      return used + need <= STEADY_CAP_BYTES
        ? null
        : { kind: 'over-cap', id, needBytes: need, liveBytes: used, capBytes: STEADY_CAP_BYTES };
    }
    for (const p of [null, 'preload', 'warm'] as const) {
      if (p !== null) {
        evict(p, self);
      }
      if (counted() + need <= HARD_CAP_BYTES) {
        return null;
      }
    }
    overCap += 1;
    return { kind: 'over-cap', id, needBytes: need, liveBytes: counted(), capBytes: HARD_CAP_BYTES };
  };

  /** Resolves once the record has what `holder` waits for: its texture (live and current), or for a warm one its file. */
  const waitFor = (rec: Rec<T>, holder: string, signal: AbortSignal | undefined, warm: boolean): Promise<Result<TextureHandle<T> | null, AssetError>> => {
    if (warm ? rec.held !== null : rec.handle !== null && !isStale(rec, reviveGen)) {
      return Promise.resolve({ ok: true, value: warm ? null : rec.handle });
    }
    return new Promise((resolve) => {
      const set = warm ? rec.files : rec.waiting;
      // A holder released while it waited never receives what it does not hold.
      const told: Told<T> = (r) => {
        signal?.removeEventListener('abort', onAbort);
        resolve(r.ok && !rec.holders.has(holder) ? aborted(rec.id) : r);
      };
      const onAbort = (): void => {
        set.delete(told);
        drop(rec, holder);
        resolve(aborted(rec.id));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      // A live record not yet revived: the revive takes it first (`next`) and tells it.
      set.add(told);
    });
  };

  function acquire(id: AssetId, holder: string, o: AcquireOptions & { priority: 'warm' }): Promise<Result<null, AssetError>>;
  function acquire(id: AssetId, holder: string, o: AcquireOptions & { priority: 'visible' | 'preload' }): Promise<Result<TextureHandle<T>, AssetError>>;
  function acquire(id: AssetId, holder: string, o: AcquireOptions): Promise<Result<TextureHandle<T> | null, AssetError>> {
    if (destroyed || o.signal?.aborted === true) {
      return Promise.resolve(aborted(id));
    }
    const warm = o.priority === 'warm';
    const have = records.get(id);
    if (have !== undefined) {
      const was = have.holders.get(holder);
      // A held record decodes for its first non-warm holder: from its file, admitted for the decoded bytes.
      const decodeNow = !warm && !decodes(have);
      if (decodeNow) {
        const refused = admit(id, have.file.decodedBytes, o.priority, have);
        if (refused !== null) {
          return Promise.resolve(fail(refused));
        }
      }
      if (was !== 'visible' && (was === undefined || !warm)) {
        have.holders.set(holder, o.priority);
      }
      if (decodeNow && have.held !== null) {
        decode(have, have.held);
      }
      return waitFor(have, holder, o.signal, warm);
    }
    const { entry } = o;
    if (entry.w > MAX_TEXTURE_PX || entry.h > MAX_TEXTURE_PX) {
      return Promise.resolve(fail({ kind: 'too-large', id, w: entry.w, h: entry.h }));
    }
    // The record's file is resolved once, here: a demotion later never moves a record that has started.
    const file = tier === 'half' && entry.half !== undefined ? entry.half : entry;
    const ref = refOf(file);
    if (o.priority !== 'visible' && (undecodable.has(ref.url) || (warm && 'load' in deps))) {
      return Promise.resolve(fail({ kind: 'decode', id, detail: `no file to hold: ${ref.url}` }));
    }
    const refused = admit(id, ref.bytes + (warm ? 0 : file.decodedBytes), o.priority);
    if (refused !== null) {
      return Promise.resolve(fail(refused));
    }
    return waitFor(start(id, entry, file, ref, holder, o.priority), holder, o.signal, warm);
  }

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
    if (signal.aborted || rec.decoded !== d) {
      // Aborted (records stay stale for the next revive), or released or shed meanwhile (its late bitmap is the loader's).
      own.abort();
      return;
    }
    if (r === 'late') {
      own.abort();
      failRevive(rec, `not revived within ${REVIVE_DEADLINE_MS} ms`);
    } else if (!r.ok) {
      failRevive(rec, r.error.kind === 'decode' ? r.error.detail : `revive ${r.error.kind}`);
    } else if (!isStale(rec, gen) && rec.handle !== null) {
      tell(rec.waiting, { ok: true, value: rec.handle });
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
    acquire,
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
      return records.get(id)?.handle ?? null;
    },
    state(id) {
      // The map holds no dead record (end deletes), so an ended one is never reported.
      const rec = records.get(id);
      return rec === undefined ? 'none' : rec.decoded !== null ? 'live' : decodes(rec) ? 'pending' : 'held';
    },
    loading(id) {
      const rec = records.get(id);
      return rec !== undefined && loading(rec);
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
    frames(h, boxes) {
      const rec = records.get(h.id);
      const cut = deps.frames;
      if (rec?.handle !== h) {
        return fail({ kind: 'decode', id: h.id, detail: 'frames of a record that is not current' });
      }
      if (cut === undefined) {
        return fail({ kind: 'decode', id: h.id, detail: 'no frame cut' });
      }
      return {
        ok: true,
        value: boxes.map((b) => {
          const key = b.join(',');
          const have = rec.frames.get(key);
          if (have !== undefined) {
            return have;
          }
          const f = cut.cut(h.texture, b);
          rec.frames.set(key, f);
          return f;
        }),
      };
    },
    stats() {
      let live = 0;
      let pending = 0;
      let keptBytes = 0;
      let openBitmaps = 0;
      let stale = 0;
      for (const rec of records.values()) {
        const d = rec.decoded;
        if (d !== null) {
          live += 1;
          keptBytes += d.keptBytes;
          openBitmaps += d.open() ? 1 : 0;
          stale += isStale(rec, reviveGen) ? 1 : 0;
        } else if (!decodes(rec)) {
          // Its file alone, held or in flight: kept bytes, never texture bytes.
          keptBytes += rec.held?.bytes ?? rec.ref.bytes;
        }
        pending += loading(rec) ? 1 : 0;
      }
      return { live, bytes: counted(), pending, overCap, keptBytes, keptMismatch, openBitmaps, stale, reviveFailed };
    },
    warmStats() {
      let warm = 0;
      let warmBytes = 0;
      for (const rec of records.values()) {
        if ([...rec.holders.values()].includes('warm')) {
          warm += 1;
          warmBytes += decodes(rec) ? 0 : (rec.held?.bytes ?? 0);
        }
      }
      return { warm, warmBytes };
    },
    destroy() {
      destroyed = true;
      reviving?.abort();
      for (const rec of [...records.values()]) {
        end(rec, { kind: 'aborted', id: rec.id });
      }
      records.clear();
    },
  };
}
