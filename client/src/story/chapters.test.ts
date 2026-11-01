// The chapter loader (PROTOTYPE-PLAN "Build outputs", F4 / F5, "Paid-content protection", "Resource lifetime"): free
// chapters by their hashed static URLs, paid ones only through the API, every file decoded, a superseded or cancelled
// load never delivered. The fetch seams are fakes that record each call and its signal.
import { expect, test } from 'vitest';

import type { Endpoints } from '../api/endpoints.ts';
import type { ChapterPayload } from '../api/generated/api.ts';
import type { ApiError } from '../api/http.ts';
import type { AssetFetchError, FetchAsset, LoadedChapter, Result } from './catalog.ts';
import { FREE_CHAPTER_FILES, createChapterLoader, freeChapterFiles } from './chapters.ts';
import type { ChapterLoadError } from './chapters.ts';
import type { ChapterId } from './staging.ts';

const CH1 = 'ch1' as ChapterId;
const VERSION = '0123456789abcdef';
const WORLD_VERSION = 'aaaaaaaaaaaaaaaa';

/** The keys exactly as Vite's eager `import.meta.glob('../story-gen/free/*.json', { query: '?url' })` writes them. */
const GLOB: Readonly<Record<string, string>> = {
  '../story-gen/free/ch1.story.json': '/assets/ch1.story-0a1b2c3d.json',
  '../story-gen/free/ch1.meta.json': '/assets/ch1.meta-0a1b2c3d.json',
  '../story-gen/free/ch1.assets.json': '/assets/ch1.assets-0a1b2c3d.json',
  '../story-gen/free/ch1.en.json': '/assets/ch1.en-0a1b2c3d.json',
  '../story-gen/free/ch1.world.json': '/assets/ch1.world-0a1b2c3d.json',
  // ch2 is incomplete (no meta, assets or en): not listed.
  '../story-gen/free/ch2.story.json': '/assets/ch2.story-0a1b2c3d.json',
  // ch3 has no world.
  '../story-gen/free/ch3.story.json': '/assets/ch3.story-0a1b2c3d.json',
  '../story-gen/free/ch3.meta.json': '/assets/ch3.meta-0a1b2c3d.json',
  '../story-gen/free/ch3.assets.json': '/assets/ch3.assets-0a1b2c3d.json',
  '../story-gen/free/ch3.en.json': '/assets/ch3.en-0a1b2c3d.json',
};
const FREE = freeChapterFiles(GLOB);
const URLS = {
  story: '/assets/ch1.story-0a1b2c3d.json',
  meta: '/assets/ch1.meta-0a1b2c3d.json',
  assets: '/assets/ch1.assets-0a1b2c3d.json',
  en: '/assets/ch1.en-0a1b2c3d.json',
  world: '/assets/ch1.world-0a1b2c3d.json',
};

const STORY = { inkVersion: 21, root: [['^Hello.', '\n', 'done', null], 'done', null], listDefs: {} };
const meta = (chapterId: string) => ({
  chapterId,
  storyVersion: VERSION,
  firstKnot: 'start',
  globals: [],
  vars: [],
  knots: { start: { assets: [], next: [], ending: false } },
  endings: {},
});
const ASSETS = { chapterId: 'ch1', assets: {} };
const EN = { 'ch1.start.a001': 'Hello.' };

/** A one-section public world; `secret` adds the server-only `solution` a public world must never carry. */
function world(secret = false): Record<string, unknown> {
  const text = (n: number) => ({ id: `ch1.yard.${n.toString().padStart(4, '0')}`, ru: 'Текст.' });
  const dial = { type: 'code', title: text(1), prompt: text(2), closeup: null, params: { dials: 2 }, maxAttempts: null, giveUp: false, hintTiers: 0 };
  return {
    format: 1,
    items: {},
    docs: {},
    puzzles: { dial: secret ? { ...dial, solution: [1, 1] } : dial },
    sections: {
      yard: {
        start: 'gate',
        bgm: null,
        rooms: {
          gate: {
            bg: 'cafe',
            title: text(3),
            onEnter: [],
            hotspots: [
              {
                id: 'box',
                kind: 'object',
                rect: [100, 200, 200, 200],
                label: text(4),
                lock: { slots: [], puzzle: 'dial', locked: text(5), onOpen: [], onFail: [] },
                then: [],
                look: null,
                prop: null,
              },
            ],
          },
        },
      },
    },
    version: WORLD_VERSION,
  };
}

/** ch1's static files by URL. */
function files(over: Partial<Record<keyof typeof URLS, string>> = {}): Record<string, string> {
  return {
    [URLS.story]: over.story ?? JSON.stringify(STORY),
    [URLS.meta]: over.meta ?? JSON.stringify(meta('ch1')),
    [URLS.assets]: over.assets ?? JSON.stringify(ASSETS),
    [URLS.en]: over.en ?? JSON.stringify(EN),
    [URLS.world]: over.world ?? JSON.stringify(world()),
  };
}

/**
 * A FetchAsset over `bodies` (URL → text) that records every call with its signal. `hold` keeps each answer until
 * `release()`; `honourAbort` answers `aborted` when the signal fires, as the real fetch does.
 */
function staticFiles(bodies: Readonly<Record<string, string>>, o: { hold?: boolean; honourAbort?: boolean } = {}) {
  const calls: Array<{ url: string; signal: AbortSignal }> = [];
  const waiting: Array<() => void> = [];
  const answer = (url: string): Result<Blob, AssetFetchError> => {
    const text = bodies[url];
    return text === undefined ? { ok: false, error: { kind: 'http', status: 404 } } : { ok: true, value: new Blob([text]) };
  };
  const fetchAsset: FetchAsset = (url, signal) => {
    calls.push({ url, signal });
    if (o.hold !== true) {
      return Promise.resolve(answer(url));
    }
    return new Promise((resolve) => {
      if (o.honourAbort === true) {
        signal.addEventListener('abort', () => resolve({ ok: false, error: { kind: 'aborted' } }), { once: true });
      }
      waiting.push(() => resolve(answer(url)));
    });
  };
  const release = (): void => {
    for (const go of waiting.splice(0)) {
      go();
    }
  };
  return { fetchAsset, calls, release, urls: () => calls.map((c) => c.url).sort() };
}

const PAYLOAD: ChapterPayload = { chapterId: 'ch1', storyVersion: VERSION, story: STORY, meta: meta('ch1'), assets: ASSETS, en: EN, world: world() };

/** A getChapter that answers `answer` and records each call with its signal. */
function api(answer: Result<ChapterPayload, ApiError>) {
  const calls: Array<{ chapter: ChapterId; signal: AbortSignal | undefined }> = [];
  const getChapter: Endpoints['getChapter'] = (chapter, o) => {
    calls.push({ chapter, signal: o?.signal });
    return Promise.resolve(answer);
  };
  return { getChapter, calls };
}

const httpError = (status: number): Result<ChapterPayload, ApiError> => ({
  ok: false,
  error: { kind: 'http', status, code: null, body: null, retryAfter: null },
});

function loaded(r: Result<LoadedChapter, ChapterLoadError>): LoadedChapter {
  if (!r.ok) {
    throw new Error(`load error ${JSON.stringify(r.error)}`);
  }
  return r.value;
}

test('loader: free chapter from static urls', async () => {
  expect([...FREE.keys()].sort()).toEqual(['ch1', 'ch3']);
  expect(FREE.get(CH1)).toEqual(URLS);
  expect(FREE.get('ch3' as ChapterId)?.world).toBeNull();
  // The module's own glob evaluates under vitest (an empty map before the story tool ran).
  expect(FREE_CHAPTER_FILES).toBeInstanceOf(Map);

  const net = staticFiles(files());
  const loader = createChapterLoader({ getChapter: api(httpError(500)).getChapter, fetchAsset: net.fetchAsset, free: FREE });
  const ru = loaded(await loader.load({ id: CH1, paid: false }, { withEn: false }));
  expect(net.urls()).toEqual([URLS.assets, URLS.meta, URLS.story, URLS.world]);
  expect(ru.id).toBe('ch1');
  expect(ru.story).toEqual(STORY);
  expect(ru.meta.storyVersion).toBe(VERSION);
  expect(ru.assets).toEqual(ASSETS);
  expect(ru.en).toBeNull();
  expect(ru.world?.version).toBe(WORLD_VERSION);

  net.calls.length = 0;
  const en = loaded(await loader.load({ id: CH1, paid: false }, { withEn: true }));
  expect(net.urls()).toEqual([URLS.assets, URLS.en, URLS.meta, URLS.story, URLS.world]);
  expect(en.en).toEqual(EN);

  net.calls.length = 0;
  const later = loaded(await loader.loadEn(ru));
  expect(net.urls()).toEqual([URLS.en]);
  expect(later).toEqual({ ...ru, en: EN });
  loader.dispose();
});

test('loader: paid chapter only through the api', async () => {
  const net = staticFiles(files());
  const paid = api({ ok: true, value: PAYLOAD });
  // ch1 is listed in the free map too: a paid id still never reaches a static URL (principle 0).
  const loader = createChapterLoader({ getChapter: paid.getChapter, fetchAsset: net.fetchAsset, free: FREE });
  const ch = loaded(await loader.load({ id: CH1, paid: true }, { withEn: false }));
  expect(net.urls()).toEqual([]);
  expect(paid.calls).toEqual([{ chapter: 'ch1', signal: expect.any(AbortSignal) }]);
  expect(ch).toMatchObject({ id: 'ch1', story: STORY, assets: ASSETS, en: EN });
  expect(ch.world?.version).toBe(WORLD_VERSION);

  const refused = createChapterLoader({ getChapter: api(httpError(403)).getChapter, fetchAsset: net.fetchAsset, free: FREE });
  expect(await refused.load({ id: CH1, paid: true }, { withEn: false })).toEqual({ ok: false, error: { kind: 'not-entitled' } });
  const missing = createChapterLoader({ getChapter: api(httpError(404)).getChapter, fetchAsset: net.fetchAsset, free: FREE });
  expect(await missing.load({ id: CH1, paid: true }, { withEn: false })).toEqual({ ok: false, error: { kind: 'not-found' } });
  expect(net.urls()).toEqual([]);
  loader.dispose();
});

test('loader: world through decodeWorldPublic', async () => {
  const free = createChapterLoader({ getChapter: api(httpError(500)).getChapter, fetchAsset: staticFiles(files()).fetchAsset, free: FREE });
  expect(loaded(await free.load({ id: CH1, paid: false }, { withEn: false })).world?.sections).toHaveProperty('yard');
  const secret = createChapterLoader({
    getChapter: api(httpError(500)).getChapter,
    fetchAsset: staticFiles(files({ world: JSON.stringify(world(true)) })).fetchAsset,
    free: FREE,
  });
  expect(await secret.load({ id: CH1, paid: false }, { withEn: false })).toMatchObject({ ok: false, error: { kind: 'malformed', file: 'world' } });

  const fetchAsset = staticFiles({}).fetchAsset;
  const paid = createChapterLoader({ getChapter: api({ ok: true, value: PAYLOAD }).getChapter, fetchAsset, free: FREE });
  expect(loaded(await paid.load({ id: CH1, paid: true }, { withEn: false })).world?.version).toBe(WORLD_VERSION);
  const paidSecret = createChapterLoader({ getChapter: api({ ok: true, value: { ...PAYLOAD, world: world(true) } }).getChapter, fetchAsset, free: FREE });
  expect(await paidSecret.load({ id: CH1, paid: true }, { withEn: false })).toMatchObject({ ok: false, error: { kind: 'malformed', file: 'world' } });
  const none = createChapterLoader({ getChapter: api({ ok: true, value: { ...PAYLOAD, world: null } }).getChapter, fetchAsset, free: FREE });
  expect(loaded(await none.load({ id: CH1, paid: true }, { withEn: false })).world).toBeNull();
});

test('loader: a stale load is dropped by generation', async () => {
  // The answers ignore the abort, so only the generation can keep A's (complete, valid) files from being delivered.
  const net = staticFiles(files(), { hold: true });
  const loader = createChapterLoader({ getChapter: api(httpError(500)).getChapter, fetchAsset: net.fetchAsset, free: FREE });
  const a = loader.load({ id: CH1, paid: false }, { withEn: false });
  const b = loader.load({ id: CH1, paid: false }, { withEn: false });
  net.release();
  expect(await a).toEqual({ ok: false, error: { kind: 'stale' } });
  expect(await b).toMatchObject({ ok: true, value: { id: 'ch1' } });
  loader.dispose();
});

test('loader: chapter change aborts the fetch', async () => {
  const net = staticFiles(files(), { hold: true, honourAbort: true });
  const loader = createChapterLoader({ getChapter: api(httpError(500)).getChapter, fetchAsset: net.fetchAsset, free: FREE });
  const pending = loader.load({ id: CH1, paid: false }, { withEn: true });
  expect(net.calls).toHaveLength(5);
  loader.cancel();
  expect(net.calls.map((c) => c.signal.aborted)).toEqual([true, true, true, true, true]);
  expect([{ ok: false, error: { kind: 'aborted' } }, { ok: false, error: { kind: 'stale' } }]).toContainEqual(await pending);

  // The next load() does the same to the load it supersedes: its bytes stop competing with the new load's.
  net.calls.length = 0;
  const superseded = loader.load({ id: CH1, paid: false }, { withEn: false });
  const supersededSignals = net.calls.map((c) => c.signal);
  const next = loader.load({ id: CH1, paid: false }, { withEn: false });
  expect(supersededSignals.map((s) => s.aborted)).toEqual([true, true, true, true]);
  expect(net.calls.slice(supersededSignals.length).map((c) => c.signal.aborted)).toEqual([false, false, false, false]);
  expect(await superseded).toEqual({ ok: false, error: { kind: 'stale' } });
  net.release();
  expect(await next).toMatchObject({ ok: true, value: { id: 'ch1' } });

  // dispose() does the same, and the loader starts nothing afterwards.
  net.calls.length = 0;
  const last = loader.load({ id: CH1, paid: false }, { withEn: false });
  loader.dispose();
  expect(net.calls.map((c) => c.signal.aborted)).toEqual([true, true, true, true]);
  expect([{ ok: false, error: { kind: 'aborted' } }, { ok: false, error: { kind: 'stale' } }]).toContainEqual(await last);
  net.calls.length = 0;
  expect(await loader.load({ id: CH1, paid: false }, { withEn: false })).toEqual({ ok: false, error: { kind: 'aborted' } });
  expect(net.calls).toEqual([]);

  // A paid load's request gets the same signal.
  const paid = api({ ok: true, value: PAYLOAD });
  const paidLoader = createChapterLoader({ getChapter: paid.getChapter, fetchAsset: net.fetchAsset, free: FREE });
  const p = paidLoader.load({ id: CH1, paid: true }, { withEn: false });
  paidLoader.cancel();
  expect(paid.calls[0]?.signal?.aborted).toBe(true);
  expect(await p).toEqual({ ok: false, error: { kind: 'stale' } });
});

test('loader: malformed files are error values', async () => {
  const load = async (over: Partial<Record<keyof typeof URLS, string>>): Promise<Result<LoadedChapter, ChapterLoadError>> =>
    createChapterLoader({ getChapter: api(httpError(500)).getChapter, fetchAsset: staticFiles(files(over)).fetchAsset, free: FREE }).load(
      { id: CH1, paid: false },
      { withEn: true },
    );
  expect(await load({ story: '{ not json' })).toMatchObject({ ok: false, error: { kind: 'malformed', file: 'story' } });
  expect(await load({ meta: JSON.stringify(meta('ch2')) })).toMatchObject({ ok: false, error: { kind: 'malformed', file: 'meta' } });
  expect(await load({ assets: JSON.stringify({ chapterId: 'ch1', assets: {}, extra: 1 }) })).toMatchObject({
    ok: false,
    error: { kind: 'malformed', file: 'assets' },
  });
  expect(await load({ en: JSON.stringify({ 'not an id': 'x' }) })).toMatchObject({ ok: false, error: { kind: 'malformed', file: 'en' } });
  const paid = createChapterLoader({
    getChapter: api({ ok: true, value: { ...PAYLOAD, storyVersion: 'ffffffffffffffff' } }).getChapter,
    fetchAsset: staticFiles({}).fetchAsset,
    free: FREE,
  });
  expect(await paid.load({ id: CH1, paid: true }, { withEn: false })).toMatchObject({ ok: false, error: { kind: 'malformed', file: 'payload' } });
});
