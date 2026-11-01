// The chapter loader (PROTOTYPE-PLAN "Build outputs", F4 / F5, "Paid-content protection", "Resource lifetime"). A free
// chapter comes from its hashed static URLs (the build's eager `?url` glob over story-gen/free/, which holds free
// outputs only); a paid chapter comes only through `GET /api/chapters/{id}` after the server's entitlement check, never
// from a static or guessable URL, never from a public fallback, and is never stored (principle 0). Every file is decoded
// at this edge (principle 1); the result is JSON only. Each load owns one AbortController: the next load, cancel() or
// dispose() aborts it, and a generation number turns a superseded result into `stale`. No timer: the caller cancels.
// One loader per role (the current chapter, F5's next-chapter preload, a language switch), since a load or loadEn
// cancels only its own loader's work.
import type { Endpoints } from '../api/endpoints.ts';
import type { ChapterPayload } from '../api/generated/api.ts';
import type { ApiError } from '../api/http.ts';
import { decodeWorldPublic } from '../world/decode.ts';
import { decodeAssetManifest, decodeChapterMeta } from './catalog.ts';
import type { FetchAsset, LoadedChapter, Result } from './catalog.ts';
import type { ChapterId, LineId } from './staging.ts';
import { LINE_ID_RE } from './tags.ts';

/** A free chapter's static URLs; `world` only for a chapter with a world. */
export type FreeChapterFiles = { story: string; meta: string; assets: string; en: string; world: string | null };
export type ChapterLoadError =
  | { kind: 'not-entitled' }
  | { kind: 'not-found' }
  | { kind: 'network'; detail: string }
  | { kind: 'session-expired' }
  | { kind: 'http'; status: number }
  | { kind: 'malformed'; file: ChapterFile; detail: string }
  | { kind: 'stale' }
  | { kind: 'aborted' };
type ChapterFile = 'payload' | 'story' | 'meta' | 'assets' | 'en' | 'world';

export interface ChapterLoader {
  /** `withEn` fetches a free chapter's en table now (an en player); a paid payload always carries it. */
  load(ch: { id: ChapterId; paid: boolean }, o: { withEn: boolean }): Promise<Result<LoadedChapter, ChapterLoadError>>;
  /** `ch` with its en table (a language switch); a chapter that has one is returned as it is. */
  loadEn(ch: LoadedChapter): Promise<Result<LoadedChapter, ChapterLoadError>>;
  /** A chapter change, the load of another save: aborts the work in flight and makes its result `stale`. */
  cancel(): void;
  dispose(): void;
}

/** emit.ts `chapterPaths` / manifest.ts: `free/<ch>.<kind>.json`, read by the file name only. */
const FREE_FILE_RE = /\/(ch[1-9][0-9]*)\.(story|meta|assets|en|world)\.json$/;
type FreeKind = 'story' | 'meta' | 'assets' | 'en' | 'world';

/** The free chapters of a glob (key → URL): a chapter is listed only with its story, meta, assets and en files. */
export function freeChapterFiles(glob: Readonly<Record<string, string>>): ReadonlyMap<ChapterId, FreeChapterFiles> {
  const found = new Map<string, Partial<Record<FreeKind, string>>>();
  for (const [key, url] of Object.entries(glob)) {
    const m = FREE_FILE_RE.exec(key);
    const id = m?.[1];
    const kind = m?.[2] as FreeKind | undefined; // one of the alternatives the pattern matched
    if (id !== undefined && kind !== undefined) {
      found.set(id, { ...found.get(id), [kind]: url });
    }
  }
  const out = new Map<ChapterId, FreeChapterFiles>();
  for (const [id, f] of found) {
    if (f.story !== undefined && f.meta !== undefined && f.assets !== undefined && f.en !== undefined) {
      // The brand is earned by FREE_FILE_RE, which matches CHAPTER_ID_RE's grammar.
      out.set(id as ChapterId, { story: f.story, meta: f.meta, assets: f.assets, en: f.en, world: f.world ?? null });
    }
  }
  return out;
}

/** The build's free chapters (an empty map before the story tool has run). */
export const FREE_CHAPTER_FILES: ReadonlyMap<ChapterId, FreeChapterFiles> = freeChapterFiles(
  import.meta.glob<string>('../story-gen/free/*.json', { query: '?url', import: 'default', eager: true }),
);

const malformed = (file: ChapterFile, detail: string): { ok: false; error: ChapterLoadError } => ({ ok: false, error: { kind: 'malformed', file, detail } });

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function apiError(e: ApiError): ChapterLoadError {
  switch (e.kind) {
    case 'http':
      // 403: no entitlement, the paywall (the save stays); 404: no such chapter.
      return e.status === 403 ? { kind: 'not-entitled' } : e.status === 404 ? { kind: 'not-found' } : { kind: 'http', status: e.status };
    case 'network':
      return { kind: 'network', detail: e.detail };
    case 'decode':
      return { kind: 'malformed', file: 'payload', detail: e.detail };
    case 'session-expired':
      return { kind: 'session-expired' };
    case 'aborted':
      return { kind: 'aborted' };
    default: {
      const unreachable: never = e;
      return unreachable;
    }
  }
}

/** The en line table `{ lineId: text }` (emit.ts). */
function decodeEn(raw: unknown): Result<Readonly<Record<LineId, string>>, string> {
  if (!isObject(raw)) {
    return { ok: false, error: 'not a JSON object' };
  }
  for (const [id, text] of Object.entries(raw)) {
    if (!LINE_ID_RE.test(id)) {
      return { ok: false, error: `${JSON.stringify(id)} is not a line id` };
    }
    if (typeof text !== 'string') {
      return { ok: false, error: `${id}: not a string` };
    }
  }
  return { ok: true, value: Object.fromEntries(Object.entries(raw)) as Record<LineId, string> }; // keys and values checked above
}

/** The chapter's documents as parsed JSON, decoded and cross-checked against the chapter id. */
type Documents = { story: unknown; meta: unknown; assets: unknown; en: unknown; world: unknown };

function decodeChapter(id: ChapterId, d: Documents): Result<LoadedChapter, ChapterLoadError> {
  if (!isObject(d.story)) {
    return malformed('story', 'not ink JSON (an object)');
  }
  const meta = decodeChapterMeta(d.meta);
  if (!meta.ok) {
    return malformed('meta', JSON.stringify(meta.error));
  }
  if (meta.value.chapterId !== id) {
    return malformed('meta', `the meta of ${meta.value.chapterId}`);
  }
  const assets = decodeAssetManifest(d.assets);
  if (!assets.ok) {
    return malformed('assets', JSON.stringify(assets.error));
  }
  if (assets.value.chapterId !== id) {
    return malformed('assets', `the manifest of ${assets.value.chapterId}`);
  }
  const en = d.en === null ? null : decodeEn(d.en);
  if (en !== null && !en.ok) {
    return malformed('en', en.error);
  }
  const world = d.world === null ? null : decodeWorldPublic(d.world);
  if (world !== null && !world.ok) {
    return malformed('world', JSON.stringify(world.error));
  }
  const chapter: LoadedChapter = { id, story: d.story, meta: meta.value, assets: assets.value, en: en?.value ?? null, world: world?.value ?? null };
  return { ok: true, value: chapter };
}

function fromPayload(id: ChapterId, p: ChapterPayload): Result<LoadedChapter, ChapterLoadError> {
  if (p.chapterId !== id) {
    return malformed('payload', `the payload of ${p.chapterId}`);
  }
  const chapter = decodeChapter(id, { story: p.story, meta: p.meta, assets: p.assets, en: p.en, world: p.world });
  if (chapter.ok && chapter.value.meta.storyVersion !== p.storyVersion) {
    return malformed('payload', `storyVersion ${p.storyVersion} is not the meta's ${chapter.value.meta.storyVersion}`);
  }
  return chapter;
}

export function createChapterLoader(deps: {
  getChapter: Endpoints['getChapter'];
  fetchAsset: FetchAsset;
  /** The free chapters' URLs; FREE_CHAPTER_FILES by default. */
  free?: ReadonlyMap<ChapterId, FreeChapterFiles>;
}): ChapterLoader {
  const free = deps.free ?? FREE_CHAPTER_FILES;
  let generation = 0;
  let inFlight: AbortController | null = null;
  let disposed = false;

  /** Starts a load: whatever was in flight is aborted and superseded. */
  const begin = (): { gen: number; signal: AbortSignal } => {
    inFlight?.abort();
    generation += 1;
    inFlight = new AbortController();
    return { gen: generation, signal: inFlight.signal };
  };
  const cancel = (): void => {
    inFlight?.abort();
    inFlight = null;
    generation += 1;
  };
  /** A load's result, unless a later load, cancel() or dispose() superseded it. */
  const settle = <T>(gen: number, r: Result<T, ChapterLoadError>): Result<T, ChapterLoadError> => {
    if (gen !== generation) {
      return { ok: false, error: { kind: 'stale' } };
    }
    inFlight = null;
    return r;
  };

  /** One static file's JSON, through the injected FetchAsset (a plain GET for a non-/api/ URL, no bearer). */
  const fetchJson = async (url: string, file: ChapterFile, signal: AbortSignal): Promise<Result<unknown, ChapterLoadError>> => {
    const r = await deps.fetchAsset(url, signal);
    if (!r.ok) {
      return { ok: false, error: r.error }; // every AssetFetchError kind is a ChapterLoadError kind
    }
    let text: string;
    try {
      text = await r.value.text();
    } catch (e) {
      return { ok: false, error: { kind: 'network', detail: e instanceof Error ? e.message : String(e) } };
    }
    try {
      return { ok: true, value: JSON.parse(text) as unknown };
    } catch {
      return malformed(file, 'not JSON');
    }
  };

  const loadFree = async (id: ChapterId, files: FreeChapterFiles, withEn: boolean, signal: AbortSignal): Promise<Result<LoadedChapter, ChapterLoadError>> => {
    const none: Result<unknown, ChapterLoadError> = { ok: true, value: null };
    const [story, meta, assets, en, world] = await Promise.all([
      fetchJson(files.story, 'story', signal),
      fetchJson(files.meta, 'meta', signal),
      fetchJson(files.assets, 'assets', signal),
      withEn ? fetchJson(files.en, 'en', signal) : none,
      files.world !== null ? fetchJson(files.world, 'world', signal) : none,
    ]);
    // The first failure in file order.
    if (!story.ok) {
      return story;
    }
    if (!meta.ok) {
      return meta;
    }
    if (!assets.ok) {
      return assets;
    }
    if (!en.ok) {
      return en;
    }
    if (!world.ok) {
      return world;
    }
    return decodeChapter(id, { story: story.value, meta: meta.value, assets: assets.value, en: en.value, world: world.value });
  };

  const loadPaid = async (id: ChapterId, signal: AbortSignal): Promise<Result<LoadedChapter, ChapterLoadError>> => {
    const r = await deps.getChapter(id, { signal });
    return r.ok ? fromPayload(id, r.value) : { ok: false, error: apiError(r.error) };
  };

  return {
    async load(ch, o) {
      if (disposed) {
        return { ok: false, error: { kind: 'aborted' } };
      }
      const { gen, signal } = begin();
      if (ch.paid) {
        return settle(gen, await loadPaid(ch.id, signal)); // never the free map: a paid id there is not a fallback
      }
      const files = free.get(ch.id);
      if (files === undefined) {
        return settle(gen, { ok: false, error: { kind: 'not-found' } });
      }
      return settle(gen, await loadFree(ch.id, files, o.withEn, signal));
    },
    async loadEn(ch) {
      if (disposed) {
        return { ok: false, error: { kind: 'aborted' } };
      }
      if (ch.en !== null) {
        return { ok: true, value: ch };
      }
      const files = free.get(ch.id);
      if (files === undefined) {
        return { ok: false, error: { kind: 'not-found' } };
      }
      const { gen, signal } = begin();
      const raw = await fetchJson(files.en, 'en', signal);
      if (!raw.ok) {
        return settle(gen, raw);
      }
      const en = decodeEn(raw.value);
      return settle(gen, en.ok ? { ok: true, value: { ...ch, en: en.value } } : malformed('en', en.error));
    },
    cancel,
    dispose() {
      cancel();
      disposed = true;
    },
  };
}
