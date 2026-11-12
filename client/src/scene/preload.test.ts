import { expect, test, vi } from 'vitest';

import type { AssetEntry, AssetManifest, ImageEntry, Result } from '../story/catalog.ts';
import type { AssetId, ChapterId } from '../story/staging.ts';
import { PRELOAD_IN_FLIGHT, createAssetScheduler } from './preload.ts';
import type { StageWindow } from './preload.ts';
import { HARD_CAP_BYTES, createAssetRegistry } from './registry.ts';
import type { AcquireOptions, AssetError, AssetRegistry, Decoded, HeldFile, HoldImage, LoadError, LoadImage, SceneError, TextureHandle } from './registry.ts';

// ---------------------------------------------------------------------------------------------------------------
// Two chapter manifests over the real registry. The fake loader records every call (URL, file bytes, signal) and
// decodes at once, or on demand when deferred; every Decoded keeps its file's bytes (MEMORY-PLAN M2), is uploaded under
// generation 1, revives at once, and counts its release() calls by URL.

type Tex = { readonly url: string };
type Call = { url: string; bytes: number; signal: AbortSignal; resolve(r: Result<Decoded<Tex>, LoadError>): void; done: boolean };

const asId = (s: string): AssetId => s as AssetId; // test fixture ids: the brand is earned by the manifest decoder
const image = (file: string, w: number, h: number, gated = false): ImageEntry => {
  const dir = gated ? '/api/assets/' : '/assets/';
  return { kind: 'image', w, h, decodedBytes: w * h * 4, avif: { url: `${dir}${file}.avif`, bytes: 100 }, webp: { url: `${dir}${file}.webp`, bytes: 120 } };
};
const manifest = (chapterId: string, assets: Record<string, AssetEntry>): AssetManifest => ({
  chapterId: chapterId as ChapterId,
  assets: assets as Record<AssetId, AssetEntry>,
});
const ch1 = manifest('ch1', {
  'bg/a': image('bg_a', 1080, 2048),
  'prop/a': image('prop_a', 512, 512),
  'prop/b': image('prop_b', 512, 512),
  'prop/c': image('prop_c', 512, 512),
  'prop/d': image('prop_d', 512, 512),
  'prop/k1': image('prop_k1', 512, 512),
  'prop/r1': image('prop_r1', 512, 512),
  'prop/e': image('prop_e', 512, 512),
  'sfx/door': { kind: 'audio', role: 'sfx', durationMs: 400, file: { url: '/assets/sfx_door.m4a', bytes: 900 }, codec: 'm4a' },
});
// bg/paid_only exists only in the next chapter's (paid) manifest.
const ch2 = manifest('ch2', {
  'bg/paid_only': image('paid_only', 1080, 2048, true),
  'prop/n2': image('prop_n2', 512, 512, true),
  'prop/e': image('prop_e', 512, 512),
});
const ch3 = manifest('ch3', { 'prop/n3': image('prop_n3', 512, 512) });
// ch4: the next chapter of a handover (QO19); its first knot's art, the background gated.
const ch4 = manifest('ch4', {
  'bg/lamp': image('lamp', 1080, 2048, true),
  'char/keeper/smile': image('keeper_smile', 512, 512),
  'char/keeper/worried': image('keeper_worried', 512, 512),
  'char/keeper/neutral': image('keeper_neutral', 512, 512),
});
const LAMP = ['bg/lamp', 'char/keeper/smile', 'char/keeper/worried', 'char/keeper/neutral'].map(asId);
// ch5: three 2048x2048 backgrounds; one live and two loading exceed HARD_CAP_BYTES, so the third admission evicts.
const ch5 = manifest('ch5', {
  'bg/w1': image('w1', 2048, 2048),
  'bg/w2': image('w2', 2048, 2048),
  'bg/w3': image('w3', 2048, 2048),
});
const URLS = new Map<string, ImageEntry>();
for (const m of [ch1, ch2, ch3, ch4, ch5]) {
  for (const e of Object.values(m.assets)) {
    if (e.kind === 'image') {
      URLS.set(e.avif.url, e);
    }
  }
}
const urlOf = (m: AssetManifest, id: string): string => {
  const e = m.assets[asId(id)];
  return e?.kind === 'image' ? e.avif.url : `missing:${id}`;
};

type HoldCall = { url: string; bytes: number; signal: AbortSignal; resolve(r: Result<HeldFile<Tex>, LoadError>): void; done: boolean };

/** Records every acquire (`acquire <holder> <id>`) and every holder release (`release <name>`) the scheduler makes. */
function recording(registry: AssetRegistry<Tex>, log: string[]): AssetRegistry<Tex> {
  function acquire(id: AssetId, holder: string, o: AcquireOptions & { priority: 'warm' }): Promise<Result<null, AssetError>>;
  function acquire(id: AssetId, holder: string, o: AcquireOptions & { priority: 'visible' | 'preload' }): Promise<Result<TextureHandle<Tex>, AssetError>>;
  function acquire(id: AssetId, holder: string, o: AcquireOptions): Promise<Result<TextureHandle<Tex> | null, AssetError>> {
    log.push(`acquire ${holder} ${id}`);
    return o.priority === 'warm' ? registry.acquire(id, holder, { ...o, priority: 'warm' }) : registry.acquire(id, holder, { ...o, priority: o.priority });
  }
  return {
    ...registry,
    acquire,
    releaseHolder(h) {
      log.push(`release ${h}`);
      registry.releaseHolder(h);
    },
  };
}

/**
 * `{ hold: true }` (lane SH5a): the registry gets a fake `hold` instead of `load`; its fetches and its held files'
 * decodes are separate calls, each settled at once (`auto`) or on demand (`deferred`), counted by URL. The scheduler
 * then sees the registry through `recording`.
 */
function harness(mode: 'auto' | 'deferred' = 'auto', o?: { hold: true }) {
  const calls: Call[] = [];
  const released = new Map<string, number>();
  const decoded = (url: string, keptBytes: number): Decoded<Tex> | null => {
    const e = URLS.get(url);
    if (e === undefined) {
      return null;
    }
    // Uploaded under generation 1; a revive succeeds (MEMORY-PLAN M2).
    const d: Decoded<Tex> = {
      texture: { url },
      w: e.w,
      h: e.h,
      keptBytes,
      gen: 1,
      open: () => false,
      revive: (gen) => {
        d.gen = gen;
        return Promise.resolve({ ok: true, value: undefined });
      },
      release: () => released.set(url, (released.get(url) ?? 0) + 1),
    };
    return d;
  };
  const succeed = (call: Call): void => {
    const d = decoded(call.url, call.bytes);
    if (!call.done && d !== null) {
      call.done = true;
      call.resolve({ ok: true, value: d });
    }
  };
  const load: LoadImage<Tex> = (ref, signal) =>
    new Promise((resolve) => {
      const call: Call = { url: ref.url, bytes: ref.bytes, signal, resolve, done: false };
      calls.push(call);
      if (mode === 'auto') {
        succeed(call);
      }
    });
  // The hold harness: a fetch keeps the file; each decode of it is its own call (`calls` then lists the decodes).
  const fetches: HoldCall[] = [];
  const file = (url: string, bytes: number): HeldFile<Tex> => ({ bytes, decode: (signal, g) => load({ url, bytes }, signal, g), drop: () => {} });
  const hold: HoldImage<Tex> = (ref, signal) =>
    new Promise((resolve) => {
      const call: HoldCall = { url: ref.url, bytes: ref.bytes, signal, resolve, done: false };
      fetches.push(call);
      if (mode === 'auto') {
        call.done = true;
        resolve({ ok: true, value: file(ref.url, ref.bytes) });
      }
    });
  const log: string[] = [];
  const registry = o?.hold === true ? createAssetRegistry<Tex>({ hold, variant: 'avif', tier: 'full' }) : createAssetRegistry<Tex>({ load, variant: 'avif', tier: 'full' });
  const errors: AssetError[] = [];
  const s = createAssetScheduler({
    registry: o?.hold === true ? recording(registry, log) : registry,
    onError: (e) => {
      errors.push(e);
    },
  });
  /** The first call of `id` (in the window fixtures' manifests) not yet settled. */
  const open = <C extends { url: string; done: boolean }>(list: C[], id: string): C => {
    const c = list.find((x) => x.url === winUrl(id) && !x.done);
    if (c === undefined) {
      throw new Error(`invariant: ${id} has a call in flight`);
    }
    return c;
  };
  return {
    s,
    registry,
    calls,
    errors,
    succeed,
    succeedAll: () => {
      for (const c of [...calls]) {
        succeed(c);
      }
    },
    callsOf: (url: string): number => calls.filter((c) => c.url === url).length,
    releasedOf: (m: AssetManifest, id: string): number => released.get(urlOf(m, id)) ?? 0,
    // The hold harness, by the window fixtures' ids.
    log,
    acquired: (): string[] => log.filter((l) => l.startsWith('acquire ')).map((l) => l.slice('acquire '.length)),
    fetchesOf: (id: string): number => fetches.filter((c) => c.url === winUrl(id)).length,
    decodesOf: (id: string): number => calls.filter((c) => c.url === winUrl(id)).length,
    releasesOf: (id: string): number => released.get(winUrl(id)) ?? 0,
    fetchSignal: (id: string): AbortSignal | undefined => fetches.filter((c) => c.url === winUrl(id)).at(-1)?.signal,
    decodeSignal: (id: string): AbortSignal | undefined => calls.filter((c) => c.url === winUrl(id)).at(-1)?.signal,
    state: (id: string) => registry.state(asId(id)),
    land: (id: string): void => {
      const c = open(fetches, id);
      c.done = true;
      c.resolve({ ok: true, value: file(c.url, c.bytes) });
    },
    fetchFails: (id: string): void => {
      const c = open(fetches, id);
      c.done = true;
      c.resolve({ ok: false, error: { kind: 'fetch', error: { kind: 'http', status: 500 } } });
    },
    decoded: (id: string): void => succeed(open(calls, id)),
    /** A visible holder outside the scheduler (a slot of the stage), as the executor's take adds it. */
    visible: (id: string, holder: string) => registry.acquire(asId(id), holder, { entry: winEntry(id), priority: 'visible' }),
    /** Lands every fetch and settles every decode in flight, until none is left. */
    settle: async (): Promise<void> => {
      for (let i = 0; i < 8; i += 1) {
        for (const c of fetches.filter((x) => !x.done)) {
          c.done = true;
          c.resolve({ ok: true, value: file(c.url, c.bytes) });
        }
        await flush();
        for (const c of calls.filter((x) => !x.done)) {
          succeed(c);
        }
        await flush();
      }
    },
  };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const live = (): AbortSignal => new AbortController().signal;

// ---------------------------------------------------------------------------------------------------------------

test('abort_after_release_destroys', async () => {
  const h = harness('deferred');
  h.s.setChapter(ch1);
  h.s.preload('preload:k1', [asId('bg/a')]);
  expect(h.calls.length).toBe(1);
  h.s.releasePreload('preload:k1');
  expect(h.calls[0]?.signal.aborted).toBe(true);
  // The fetch completes anyway: the late texture is destroyed at once.
  h.succeedAll();
  await flush();
  expect(h.releasedOf(ch1, 'bg/a')).toBe(1);
  expect(h.registry.stats()).toEqual({ live: 0, bytes: 0, pending: 0, overCap: 0, keptBytes: 0, keptMismatch: 0, openBitmaps: 0, stale: 0, reviveFailed: 0 });
});

test('preload: next-chapter id resident after setChapter', async () => {
  const h = harness();
  h.s.setChapter(ch1);
  // F5: the next chapter's first knot, resolved in that chapter's manifest (the id is not in ch1's).
  h.s.preload('next:ch2', [asId('bg/paid_only')], ch2);
  expect(h.errors).toEqual([]);
  expect(h.calls.map((c) => c.url)).toEqual(['/api/assets/paid_only.avif']);
  await flush();
  // F4: the chapter change keeps next:ch2, so ensure meets the resident entry.
  h.s.setChapter(ch2);
  const r = await h.s.ensure([asId('bg/paid_only')], live());
  expect(r).toEqual({ ok: true, value: undefined });
  expect(h.callsOf('/api/assets/paid_only.avif')).toBe(1);
  expect(h.registry.stats().live).toBe(1);
});

test('preload: two fetches in flight at most', async () => {
  const h = harness('deferred');
  h.s.setChapter(ch1);
  h.s.preload('preload:k1', ['prop/a', 'prop/b', 'prop/c', 'prop/d'].map(asId));
  expect(PRELOAD_IN_FLIGHT).toBe(2);
  expect(h.calls.length).toBe(2);
  await flush();
  expect(h.calls.length).toBe(2);
  const first = h.calls[0];
  if (first !== undefined) {
    h.succeed(first);
  }
  await flush();
  expect(h.calls.length).toBe(3);
  h.succeedAll();
  await flush();
  expect(h.calls.length).toBe(4);
  h.succeedAll();
  await flush();
  expect(h.registry.stats().live).toBe(4);
  // ensure is not limited: it starts every load at once.
  const e = harness('deferred');
  e.s.setChapter(ch1);
  const all = e.s.ensure(['prop/a', 'prop/b', 'prop/c', 'prop/d'].map(asId), live());
  expect(e.calls.length).toBe(4);
  e.succeedAll();
  expect((await all).ok).toBe(true);
});

test('preload: missing id is an error value', async () => {
  const h = harness();
  h.s.setChapter(ch1);
  const r = await h.s.ensure([asId('bg/nope')], live());
  expect(r.ok).toBe(false);
  expect(r).toEqual({ ok: false, error: { kind: 'assets', errors: [{ kind: 'missing-id', id: 'bg/nope' }] } });
  h.s.preload('preload:k1', [asId('bg/nope')]);
  expect(h.errors).toEqual([{ kind: 'missing-id', id: 'bg/nope' }]);
  expect(h.calls.length).toBe(0);
  // An audio id is not a texture.
  expect(await h.s.ensure([asId('sfx/door')], live())).toEqual({
    ok: false,
    error: { kind: 'assets', errors: [{ kind: 'not-image', id: 'sfx/door' }] },
  });
  expect(h.calls.length).toBe(0);
});

test('preload: setChapter releases preload and other next holders', async () => {
  const h = harness();
  h.s.setChapter(ch1);
  h.s.preload('preload:k1', [asId('prop/k1')]);
  h.s.preload('next:ch2', [asId('prop/n2')], ch2);
  h.s.preload('next:ch3', [asId('prop/n3')], ch3);
  h.s.preload('room:r1', [asId('prop/r1')]);
  await flush();
  expect((await h.s.ensure([asId('prop/e')], live())).ok).toBe(true);
  expect(h.registry.stats().live).toBe(5);

  h.s.setChapter(ch2);
  expect(h.releasedOf(ch1, 'prop/k1')).toBe(1);
  expect(h.releasedOf(ch3, 'prop/n3')).toBe(1);
  expect(h.releasedOf(ch1, 'prop/e')).toBe(1);
  // next:ch2 holds the new chapter's first knot (F4); room:* belongs to the explore controller (PZ X13).
  expect(h.releasedOf(ch2, 'prop/n2')).toBe(0);
  expect(h.releasedOf(ch1, 'prop/r1')).toBe(0);
  expect(h.registry.stats().live).toBe(2);
  h.s.destroy();
  expect(h.registry.stats()).toEqual({ live: 0, bytes: 0, pending: 0, overCap: 0, keptBytes: 0, keptMismatch: 0, openBitmaps: 0, stale: 0, reviveFailed: 0 });
});

// ---------------------------------------------------------------------------------------------------------------
// QO19 / S36 step 1b: an item whose record is live or in flight joins at once, inside preload() and outside the slots.

test('preload: a join takes no slot', async () => {
  const h = harness('deferred');
  h.s.setChapter(ch1);
  const knot = LAMP.slice(0, 3);
  h.s.preload('next:ch4', knot, ch4);
  h.succeedAll();
  await flush();
  h.succeedAll();
  await flush();
  expect(h.registry.stats().live).toBe(3);
  // Both slots busy with fetches elsewhere.
  h.s.preload('room:r1', ['prop/a', 'prop/b'].map(asId));
  expect(h.calls.length).toBe(5);
  const bytes0 = h.registry.stats().bytes;
  h.s.preload('preload:k', knot, ch4);
  // A join costs no fetch and no byte.
  expect(h.calls.length).toBe(5);
  expect(h.registry.stats().bytes).toBe(bytes0);
  // Every holder was added inside the call: the other tag's release, in the same turn, ends nothing.
  h.registry.releaseHolder('next:ch4');
  expect(h.registry.stats().live).toBe(3);
  expect(knot.map((id) => h.releasedOf(ch4, id))).toEqual([0, 0, 0]);
  // The owner's release ends them.
  h.s.releasePreload('preload:k');
  expect(knot.map((id) => h.releasedOf(ch4, id))).toEqual([1, 1, 1]);
  expect(h.errors).toEqual([]);
});

test('preload: a handover keeps every landed file', async () => {
  const h = harness();
  h.s.setChapter(ch1);
  h.s.preload('next:ch4', LAMP, ch4);
  await flush();
  expect(h.registry.stats().live).toBe(4);
  expect(LAMP.map((id) => h.callsOf(urlOf(ch4, id)))).toEqual([1, 1, 1, 1]);
  // setChapter keeps next:ch4 (F4); GameSession's first knot holds its art, then releases the tag, in one turn.
  h.s.setChapter(ch4);
  h.s.preload('preload:lamp', LAMP);
  h.s.releasePreload('next:ch4');
  await flush();
  expect(LAMP.map((id) => h.callsOf(urlOf(ch4, id)))).toEqual([1, 1, 1, 1]);
  expect(LAMP.map((id) => h.releasedOf(ch4, id))).toEqual([0, 0, 0, 0]);
  expect(h.registry.stats().live).toBe(4);
  expect(h.errors).toEqual([]);
});

test('preload: a joined fetch keeps its slot after its tag is released', async () => {
  const h = harness('deferred');
  h.s.setChapter(ch1);
  const two = LAMP.slice(0, 2);
  h.s.preload('next:ch4', two, ch4);
  expect(h.calls.length).toBe(2);
  h.s.preload('preload:k', two, ch4);
  h.s.preload('room:r1', [asId('prop/r1')]);
  h.s.releasePreload('next:ch4');
  // The joins keep both fetches, and each carries its slot: two fetches in flight at most, r1 waits.
  expect(h.calls.length).toBe(2);
  expect(h.calls.map((c) => c.signal.aborted)).toEqual([false, false]);
  const first = h.calls[0];
  if (first === undefined) {
    throw new Error('invariant: the fixture started a load');
  }
  h.succeed(first);
  await flush();
  expect(h.calls.map((c) => c.url)).toEqual([urlOf(ch4, 'bg/lamp'), urlOf(ch4, 'char/keeper/smile'), urlOf(ch1, 'prop/r1')]);
  h.succeedAll();
  await flush();
  expect(h.registry.stats().live).toBe(3);
  expect(h.errors).toEqual([]);
});

test('preload: a released tag aborts its joins', async () => {
  const h = harness('deferred');
  h.s.setChapter(ch1);
  h.s.preload('room:r1', [asId('prop/a')]);
  h.s.preload('preload:k1', [asId('prop/a')]);
  // A join at a fetch its own flight still covers counts no slot (no double count): prop/b starts at once.
  h.s.preload('room:r2', [asId('prop/b')]);
  expect(h.calls.map((c) => c.url)).toEqual([urlOf(ch1, 'prop/a'), urlOf(ch1, 'prop/b')]);
  h.s.releasePreload('preload:k1');
  const a = h.calls[0];
  if (a === undefined) {
    throw new Error('invariant: the fixture started a load');
  }
  a.done = true;
  a.resolve({ ok: false, error: { kind: 'fetch', error: { kind: 'http', status: 500 } } });
  await flush();
  // room:r1's flight reports the failure once; the released join reports nothing.
  expect(h.errors).toEqual([{ kind: 'fetch', id: 'prop/a', error: { kind: 'http', status: 500 } }]);
});

test('preload: a join released and preloaded again in one turn holds again', async () => {
  const h = harness();
  h.s.setChapter(ch1);
  const knot = LAMP.slice(0, 3);
  h.s.preload('next:ch4', knot, ch4);
  await flush();
  expect(h.registry.stats().live).toBe(3);
  // Joined, released and joined again before any join settles: a released join must not shadow the new one.
  h.s.preload('preload:k', knot, ch4);
  h.s.releasePreload('preload:k');
  h.s.preload('preload:k', knot, ch4);
  h.registry.releaseHolder('next:ch4');
  expect(h.registry.stats().live, 'the second preload of the tag must hold the records').toBe(3);
  expect(knot.map((id) => h.releasedOf(ch4, id))).toEqual([0, 0, 0]);
  h.s.releasePreload('preload:k');
  expect(knot.map((id) => h.releasedOf(ch4, id))).toEqual([1, 1, 1]);
  expect(h.errors).toEqual([]);
});

test('preload: a join holder is evicted by a visible load over the hard cap', async () => {
  const h = harness();
  h.s.setChapter(ch5);
  h.s.preload('room:r1', [asId('bg/w1')]);
  await flush();
  expect(h.registry.stats().live).toBe(1);
  expect(3 * h.registry.stats().bytes, 'fixture shape: three ch5 backgrounds exceed the hard cap').toBeGreaterThan(HARD_CAP_BYTES);
  // A join is a preload-priority holder (cut D2): it pins nothing against a visible load.
  h.s.preload('preload:k', [asId('bg/w1')]);
  await flush();
  const r = await h.s.ensure(['bg/w2', 'bg/w3'].map(asId), live());
  expect(r, 'the visible batch is admitted after evicting the join').toEqual({ ok: true, value: undefined });
  expect(h.registry.stats().overCap).toBe(0);
  expect(h.releasedOf(ch5, 'bg/w1')).toBe(1);
});

test('preload: a repeated preload while its join is outstanding adds no second join', async () => {
  const h = harness('deferred');
  h.s.setChapter(ch1);
  h.s.preload('room:r1', [asId('prop/a')]);
  h.s.preload('preload:k1', [asId('prop/a')]);
  h.s.preload('preload:k1', [asId('prop/a')]);
  expect(h.calls.length).toBe(1);
  const a = h.calls[0];
  if (a === undefined) {
    throw new Error('invariant: the fixture started a load');
  }
  a.done = true;
  a.resolve({ ok: false, error: { kind: 'fetch', error: { kind: 'http', status: 500 } } });
  await flush();
  expect(h.errors.length, 'one report per tag: the flight of room:r1 and the single join of preload:k1').toBe(2);
});

test('preload: a settled join is forgotten, so its tag preloads again', async () => {
  const h = harness('deferred');
  h.s.setChapter(ch1);
  h.s.preload('preload:k', [asId('prop/a')]);
  h.s.preload('room:r1', [asId('prop/a')]);
  const a = h.calls[0];
  if (a === undefined) {
    throw new Error('invariant: the fixture started a load');
  }
  // The joined fetch fails: the registry ends the record while room:r1 is still a tracked tag (roomShown re-issues it).
  a.done = true;
  a.resolve({ ok: false, error: { kind: 'fetch', error: { kind: 'http', status: 500 } } });
  await flush();
  expect(h.registry.state(asId('prop/a'))).toBe('none');
  h.s.preload('room:r1', [asId('prop/a')]);
  expect(h.callsOf(urlOf(ch1, 'prop/a')), 'a later show of the room fetches its bg again').toBe(2);
});

test('preload: a family release drops released joins too', async () => {
  const h = harness('deferred');
  h.s.setChapter(ch1);
  h.s.preload('room:r1', [asId('prop/a')]);
  h.s.preload('preload:k', [asId('prop/a')]);
  // setChapter releases the `preload:` family; the same tag is joined again in the same turn.
  h.s.setChapter(ch1);
  h.s.preload('preload:k', [asId('prop/a')]);
  h.s.releasePreload('room:r1');
  const a = h.calls[0];
  if (a === undefined) {
    throw new Error('invariant: the fixture started a load');
  }
  expect(a.signal.aborted, 'the re-joined tag keeps the fetch alive after room:r1 let go').toBe(false);
  h.succeed(a);
  await flush();
  expect(h.registry.stats().live).toBe(1);
  expect(h.errors).toEqual([]);
});

test('preload: a settled join forgets only itself, so its siblings keep their carried slot', async () => {
  const h = harness('deferred');
  h.s.setChapter(ch1);
  const two = LAMP.slice(0, 2);
  // The handover (QO19): next:ch4 flies two files, the knot's hold joins both, then next:ch4 lets go in the same turn.
  h.s.preload('next:ch4', two, ch4);
  h.s.preload('preload:k', two, ch4);
  h.s.preload('room:r1', [asId('prop/r1')]);
  h.s.preload('room:r2', [asId('prop/a')]);
  h.s.releasePreload('next:ch4');
  expect(h.calls.length).toBe(2);
  const first = h.calls[0];
  if (first === undefined) {
    throw new Error('invariant: the fixture started a load');
  }
  h.succeed(first);
  await flush();
  // the second lamp file is still carried by its join: one slot for it, one for r1, so r2 waits
  expect(h.calls.map((c) => c.url)).toEqual([
    urlOf(ch4, 'bg/lamp'),
    urlOf(ch4, 'char/keeper/smile'),
    urlOf(ch1, 'prop/r1'),
  ]);
});

test("preload: a join waiting on a stale record's revive carries no slot", async () => {
  // Its own registry: the loader's revive is deferred, so a live record stays stale while its join waits on it.
  const calls: Call[] = [];
  const revives: (() => void)[] = [];
  const load: LoadImage<Tex> = (ref, signal) =>
    new Promise((resolve) => {
      calls.push({ url: ref.url, bytes: ref.bytes, signal, resolve, done: false });
    });
  const decodedOf = (url: string, keptBytes: number): Decoded<Tex> => {
    const e = URLS.get(url);
    if (e === undefined) {
      throw new Error('invariant: a fixture url');
    }
    const d: Decoded<Tex> = {
      texture: { url },
      w: e.w,
      h: e.h,
      keptBytes,
      gen: 1,
      open: () => false,
      revive: (gen) =>
        new Promise((resolve) => {
          revives.push(() => {
            d.gen = gen;
            resolve({ ok: true, value: undefined });
          });
        }),
      release: () => {},
    };
    return d;
  };
  const registry = createAssetRegistry<Tex>({ load, variant: 'avif', tier: 'full' });
  const errors: AssetError[] = [];
  const s = createAssetScheduler({
    registry,
    onError: (e) => {
      errors.push(e);
    },
  });
  s.setChapter(ch1);
  s.preload('room:r1', [asId('prop/a')]);
  const a = calls[0];
  if (a === undefined) {
    throw new Error('invariant: the fixture started a load');
  }
  a.done = true;
  a.resolve({ ok: true, value: decodedOf(a.url, a.bytes) });
  await flush();
  expect(registry.state(asId('prop/a'))).toBe('live');
  // The context came back: a revive to generation 2 runs; prop/a stays stale until its (deferred) revive resolves.
  const passes = registry.revive(2, live());
  await flush();
  expect(registry.stats().stale).toBe(1);
  expect(revives.length).toBe(1);
  // GameSession's hold: the knot's art, one of it resident but stale, the rest not loaded.
  s.preload('preload:k', [asId('prop/a')]);
  s.preload('room:r2', [asId('prop/b'), asId('prop/c')]);
  await flush();
  expect(calls.map((c) => c.url), 'a revive is no fetch: both slots stay free').toEqual([
    urlOf(ch1, 'prop/a'),
    urlOf(ch1, 'prop/b'),
    urlOf(ch1, 'prop/c'),
  ]);
  for (const r of revives) {
    r();
  }
  await passes.all;
  await flush();
  expect(errors).toEqual([]);
  s.destroy();
});

test('preload: two joins of different tags on one carried fetch cost one slot', async () => {
  const h = harness('deferred');
  h.s.setChapter(ch1);
  // GameSession's enterKnot order: knots j and k share art in flight, entering k releases preload:j (step 3), then the
  // hold of a knot n after k shares the same art (step 4). Two tags carry one fetch, so it costs one slot, not two.
  h.s.preload('preload:j', [asId('prop/a')]);
  h.s.preload('preload:k', [asId('prop/a')]);
  h.s.releasePreload('preload:j');
  h.s.preload('preload:n', [asId('prop/a'), asId('prop/b'), asId('prop/c')]);
  expect(h.calls.map((c) => c.url)).toEqual([urlOf(ch1, 'prop/a'), urlOf(ch1, 'prop/b')]);
});

// ---------------------------------------------------------------------------------------------------------------
// Pins for two arms no test held (LHJ triage_r4 F2 / Q7, test_r5 survivor R4).

test('preload: a repeated preload of an id in flight adds nothing, so one failure is one report', async () => {
  const h = harness('deferred');
  h.s.setChapter(ch1);
  h.s.preload('room:r1', [asId('prop/a')]);
  h.s.preload('room:r1', [asId('prop/a')]);
  const a = h.calls[0];
  if (a === undefined) {
    throw new Error('invariant: the fixture started a load');
  }
  a.done = true;
  a.resolve({ ok: false, error: { kind: 'fetch', error: { kind: 'http', status: 500 } } });
  await flush();
  expect(h.errors.length).toBe(1);
});

test('preload: a release pumps the next queued preload in the same turn', () => {
  const h = harness('deferred');
  h.s.setChapter(ch1);
  h.s.preload('preload:x', ['prop/a', 'prop/b'].map(asId));
  h.s.preload('preload:y', [asId('prop/c')]);
  expect(h.calls.map((c) => c.url)).toEqual([urlOf(ch1, 'prop/a'), urlOf(ch1, 'prop/b')]);
  // The released flights' acquires settle a microtask later; the release itself frees the slots for c at once.
  h.s.releasePreload('preload:x');
  expect(h.calls.map((c) => c.url)).toEqual([urlOf(ch1, 'prop/a'), urlOf(ch1, 'prop/b'), urlOf(ch1, 'prop/c')]);
});

// ---------------------------------------------------------------------------------------------------------------
// The step window (shots §5.8, lane SH5a) on the hold harness, at §5.9's sizes in MiB. A close-up's file is held at
// 0.477 MiB and decodes to 12.703 MiB live (its file included); every other image counts its decoded bytes only. One
// shot is one id here: the scheduler's rules do not depend on how many files a shot has.

const MIB = 1_048_576;
const mib = (x: number): number => Math.round(x * MIB);
const sized = (file: string, decoded: number, held = 0): ImageEntry => ({
  kind: 'image',
  w: 1024,
  h: 1024,
  decodedBytes: mib(decoded),
  avif: { url: `/assets/${file}.avif`, bytes: mib(held) },
  webp: { url: `/assets/${file}.webp`, bytes: mib(held) },
});
const cu = (file: string): ImageEntry => sized(file, 12.226, 0.477);
const CU = mib(12.226) + mib(0.477);
const wm = manifest('ch6', {
  'bg/wide': sized('wide', 10.169),
  'bg/close': sized('close', 10.169),
  'bg/cu_a': cu('cu_a'),
  'bg/cu_b': cu('cu_b'),
  'bg/cu_c': cu('cu_c'),
  'bg/cu_d': cu('cu_d'),
  'bg/street': cu('street'),
  'bg/vault': cu('vault'),
  'prop/x6': sized('x6', 6, 0.477),
  'prop/big': sized('big', 32, 0.477),
  'bg/hall': sized('hall', 11.262),
  'bg/study': sized('study', 11.262),
  'bg/cellar': sized('cellar', 11.262),
  'bg/lobby': sized('lobby', 16.562),
  'prop/hall': sized('prop_hall', 3.3),
  'prop/study': sized('prop_study', 3.3),
  'prop/cellar': sized('prop_cellar', 3.3),
  'prop/p3': sized('p3', 3),
  'face/f': sized('face_f', 1.633),
  'prop/s1': sized('s1', 0.1),
  'prop/s2': sized('s2', 0.1),
  'prop/s3': sized('s3', 0.1),
  'prop/h': sized('h', 0.1),
});
// The next chapter of the window fixtures: its opening wide and a first knot of six small files.
const nx = manifest('ch7', {
  'bg/opening': sized('opening', 10.169),
  ...Object.fromEntries([1, 2, 3, 4, 5, 6].map((i) => [`prop/n${i}`, sized(`n${i}`, 0.1)])),
});
for (const m of [wm, nx]) {
  for (const e of Object.values(m.assets)) {
    if (e.kind === 'image') {
      URLS.set(e.avif.url, e);
    }
  }
}
const winUrl = (id: string): string => urlOf(Object.hasOwn(wm.assets, id) ? wm : nx, id);
function winEntry(id: string): ImageEntry {
  const e = wm.assets[asId(id)] ?? nx.assets[asId(id)];
  if (e?.kind !== 'image') {
    throw new Error(`invariant: ${id} is a window fixture image`);
  }
  return e;
}
const stage = (o: { need?: string[]; warm?: string[]; near?: number; hope?: string[]; eventRoom?: string[] }): StageWindow => ({
  need: (o.need ?? []).map(asId),
  warm: (o.warm ?? []).map(asId),
  near: o.near ?? 0,
  hope: (o.hope ?? []).map(asId),
  eventRoom: (o.eventRoom ?? []).map(asId),
});
/** Microtasks only: what a settle does in the turn it runs, with no timer between. */
const micro = async (): Promise<void> => {
  for (let i = 0; i < 20; i += 1) {
    await Promise.resolve();
  }
};
const SIX = [1, 2, 3, 4, 5, 6].map((i) => `prop/n${i}`);

test('preload: want admits the required set first and hoped sets under STEADY', async () => {
  const h = harness('auto', { hold: true });
  h.s.setChapter(wm);
  h.s.want(stage({ need: ['bg/cu_a', 'bg/cu_b'], hope: ['bg/wide', 'prop/s1'] }));
  await h.settle();
  // need 25.406 MiB; the wide would make 35.575 > 32 and is refused; the small hoped prop fits after it.
  expect(h.acquired()).toEqual(['preload:win:bg/cu_a bg/cu_a', 'preload:win:bg/cu_b bg/cu_b', 'preload:win:bg/wide bg/wide', 'preload:win:prop/s1 prop/s1']);
  expect(['bg/cu_a', 'bg/cu_b', 'bg/wide', 'prop/s1'].map(h.state)).toEqual(['live', 'live', 'none', 'live']);
  expect(h.errors).toEqual([]);
});

test('preload: want releases what left the window', async () => {
  const h = harness('auto', { hold: true });
  h.s.setChapter(wm);
  h.s.want(stage({ need: ['bg/cu_a'], hope: ['prop/s1'] }));
  await h.settle();
  h.s.want(stage({ need: ['bg/cu_b'] }));
  await h.settle();
  expect(['bg/cu_a', 'prop/s1', 'bg/cu_b'].map(h.state)).toEqual(['none', 'none', 'live']);
  expect(h.log).toContain('release preload:win:bg/cu_a');
  expect(h.log).toContain('release preload:win:prop/s1');
});

test('preload: a released in-flight fetch is aborted', () => {
  const h = harness('deferred', { hold: true });
  h.s.setChapter(wm);
  h.s.want(stage({ need: ['bg/cu_a'] }));
  expect(h.fetchSignal('bg/cu_a')?.aborted).toBe(false);
  h.s.want(stage({ need: ['bg/cu_b'] }));
  expect(h.fetchSignal('bg/cu_a')?.aborted).toBe(true);
  expect(h.state('bg/cu_a')).toBe('none');
});

test('preload: a need refused over the cap is admitted after a release', async () => {
  const h = harness('auto', { hold: true });
  h.s.setChapter(wm);
  await h.visible('bg/wide', 'scene:a');
  await h.visible('bg/cu_a', 'scene:b');
  // 22.872 MiB on stage; CU B would make 35.575: refused, and nothing of the window's may go.
  h.s.want(stage({ need: ['bg/cu_a', 'bg/cu_b'] }));
  await h.settle();
  expect(h.state('bg/cu_b')).toBe('none');
  // A sweep released the wide: the deferred need is tried again.
  h.registry.release(asId('bg/wide'), 'scene:a');
  h.s.retry();
  await h.settle();
  expect(h.state('bg/cu_b')).toBe('live');
  expect(h.acquired().filter((a) => a.startsWith('preload:win:bg/cu_b'))).toHaveLength(2);
});

test('preload: a deferred need outside a newer window is forgotten', async () => {
  const h = harness('auto', { hold: true });
  h.s.setChapter(wm);
  await h.visible('bg/wide', 'scene:a');
  await h.visible('bg/cu_a', 'scene:b');
  h.s.want(stage({ need: ['bg/cu_a', 'bg/cu_b'] }));
  await h.settle();
  h.s.want(stage({ need: ['bg/cu_a'] }));
  h.registry.release(asId('bg/wide'), 'scene:a');
  h.s.retry();
  await h.settle();
  expect(h.state('bg/cu_b')).toBe('none');
  expect(h.acquired().filter((a) => a.startsWith('preload:win:bg/cu_b'))).toHaveLength(1);
});

test('preload: a refused need evicts resident hope and is admitted', async () => {
  const h = harness('auto', { hold: true });
  h.s.setChapter(wm);
  h.s.want(stage({ need: ['bg/wide'] }));
  await h.settle();
  // The tap: CU A visible; the wide's window holder stays (it is hope d2 of the next window): 22.872 MiB.
  await h.visible('bg/cu_a', 'scene:a');
  h.s.want(stage({ need: ['bg/cu_a', 'bg/cu_b'], hope: ['bg/wide'] }));
  await h.settle();
  expect(['bg/cu_b', 'bg/wide'].map(h.state)).toEqual(['live', 'none']);
  expect(h.registry.stats().bytes).toBe(2 * CU);
});

test('preload: a refused need evicts room holders outside the window at any step', async () => {
  const h = harness('auto', { hold: true });
  h.s.setChapter(wm);
  h.s.preload('room:hall', [asId('bg/hall')]);
  h.s.preload('room:study', [asId('bg/study')]);
  await h.settle();
  await h.visible('bg/cu_a', 'scene:a');
  // Inside the hall's event: the hall is the window's eventRoom. 35.227 MiB; CU B refused.
  h.s.want(stage({ need: ['bg/cu_a', 'bg/cu_b'], eventRoom: ['bg/hall'] }));
  await h.settle();
  expect(['bg/cu_b', 'bg/study', 'bg/hall'].map(h.state)).toEqual(['live', 'none', 'none']);
  expect(h.registry.stats().bytes).toBe(2 * CU);
  expect(h.log.filter((l) => l.startsWith('release room:'))).toEqual(['release room:study', 'release room:hall']);
});

test('preload: a room window never evicts the room on stage', async () => {
  const h = harness('auto', { hold: true });
  h.s.setChapter(wm);
  h.s.preload('room:study', [asId('bg/study')]);
  h.s.preload('room:hall', [asId('bg/hall')]);
  await h.settle();
  await h.visible('bg/wide', 'scene:a');
  // r:hall's window: the hall (the most recently requested tag) is its need; the props would make 35.993 MiB.
  h.s.want(stage({ need: ['bg/hall', 'prop/hall'] }));
  await h.settle();
  expect(['bg/hall', 'prop/hall', 'bg/study'].map(h.state)).toEqual(['live', 'live', 'none']);
  expect(h.log).not.toContain('release room:hall');
});

test('preload: room holders the window hopes for are evicted last', async () => {
  const h = harness('auto', { hold: true });
  h.s.setChapter(wm);
  h.s.preload('room:study', [asId('bg/study')]);
  h.s.preload('room:cellar', [asId('bg/cellar')]);
  await h.settle();
  await h.visible('bg/wide', 'scene:a');
  // The cellar (the most recent tag) is hoped for: the study goes first, and one eviction suffices.
  h.s.want(stage({ need: ['bg/wide', 'face/f'], hope: ['bg/cellar'] }));
  await h.settle();
  expect(['face/f', 'bg/study', 'bg/cellar'].map(h.state)).toEqual(['live', 'none', 'live']);
  expect(h.log).not.toContain('release room:cellar');
});

test('preload: warm files are held before hope and decoded in order while they fit', async () => {
  const h = harness('auto', { hold: true });
  h.s.setChapter(wm);
  await h.visible('bg/cu_a', 'scene:a');
  // A choice at CU A whose replies open on CU B and CU C: 13.657 MiB held; CU B decodes ahead, CU C would not fit.
  h.s.want(stage({ need: ['bg/cu_a'], warm: ['bg/cu_b', 'bg/cu_c'], hope: ['prop/s1'] }));
  await h.settle();
  const a = h.acquired();
  expect(a.indexOf('preload:warm:bg/cu_b bg/cu_b')).toBeLessThan(a.indexOf('preload:warm:bg/cu_c bg/cu_c'));
  expect(a.indexOf('preload:warm:bg/cu_c bg/cu_c')).toBeLessThan(a.indexOf('preload:win:prop/s1 prop/s1'));
  expect(['bg/cu_b', 'bg/cu_c'].map(h.state)).toEqual(['live', 'held']);
  expect([h.fetchesOf('bg/cu_b'), h.fetchesOf('bg/cu_c'), h.decodesOf('bg/cu_c')]).toEqual([1, 1, 0]);
});

test('preload: a refused need sheds a decoded warm file back to its bytes', async () => {
  const h = harness('auto', { hold: true });
  h.s.setChapter(wm);
  await h.visible('bg/cu_a', 'scene:a');
  h.s.want(stage({ need: ['bg/cu_a'], warm: ['bg/cu_b', 'bg/cu_c'] }));
  await h.settle();
  expect(h.state('bg/cu_b')).toBe('live');
  // Reply B's next step keeps CU B as an opener and needs CU D: 38.586 MiB, refused; CU B's decode sheds.
  h.s.want(stage({ need: ['bg/cu_a', 'bg/cu_d'], warm: ['bg/cu_b'] }));
  await h.settle();
  expect(['bg/cu_d', 'bg/cu_b', 'bg/cu_c'].map(h.state)).toEqual(['live', 'held', 'none']);
  expect(h.fetchesOf('bg/cu_b')).toBe(1);
});

test('preload: want keeps the held warm files of the new window', async () => {
  const h = harness('auto', { hold: true });
  h.s.setChapter(wm);
  h.s.want(stage({ need: ['bg/cu_a'], warm: ['bg/cu_b'] }));
  await h.settle();
  h.s.want(stage({ need: ['bg/cu_c'], warm: ['bg/cu_b'] }));
  await h.settle();
  expect(h.state('bg/cu_b')).not.toBe('none');
  expect(h.fetchesOf('bg/cu_b')).toBe(1);
});

test('preload: near warm files go before tag preloads, far ones after', async () => {
  const h = harness('auto', { hold: true });
  h.s.setChapter(wm);
  // r:hall's window: the room's own opener (near) first, EN's neighbour, then the neighbours' onEnter openers.
  h.s.want(stage({ need: ['prop/s1', 'prop/s2'], warm: ['bg/cu_a', 'bg/cu_b', 'bg/cu_c'], near: 1 }));
  h.s.preload('room:study', [asId('bg/study')]);
  await h.settle();
  const order = h.acquired().filter((a) => a.startsWith('preload:warm:') || a.startsWith('room:'));
  expect(order).toEqual(['preload:warm:bg/cu_a bg/cu_a', 'room:study bg/study', 'preload:warm:bg/cu_b bg/cu_b', 'preload:warm:bg/cu_c bg/cu_c']);
});

test("preload: a refused need evicts the next chapter's holders", async () => {
  const h = harness('auto', { hold: true });
  h.s.setChapter(wm);
  await h.visible('bg/cu_b', 'scene:b');
  h.s.preload('next:ch7', [asId('bg/opening')], nx);
  await h.settle();
  // The step before the closing wide: CU B + the wide + next:ch7's opening wide would be 33.041 MiB.
  h.s.want(stage({ need: ['bg/cu_b', 'bg/close'] }));
  await h.settle();
  expect(['bg/close', 'bg/opening'].map(h.state)).toEqual(['live', 'none']);
  expect(h.registry.stats().bytes).toBe(CU + mib(10.169));
});

test('preload: next-chapter preloads queue after hope', async () => {
  const h = harness('deferred', { hold: true });
  h.s.setChapter(wm);
  h.s.preload('preload:k', ['prop/s1', 'prop/s2'].map(asId));
  h.s.preload('next:ch7', [asId('prop/n1')], nx);
  h.s.want(stage({ need: ['bg/cu_a'], warm: ['bg/cu_b'], near: 1, hope: ['prop/h'] }));
  await h.settle();
  expect(h.acquired().at(-1)).toBe('next:ch7 prop/n1');
  expect(h.state('prop/n1')).toBe('live');
});

test("preload: inside a room event the event's own room is evicted last", async () => {
  const h = harness('auto', { hold: true });
  h.s.setChapter(wm);
  // EN at the hall: the hall, the study, the cellar (refused); the move to the study: the cellar released, then the
  // study and the hall requested again.
  for (const r of ['hall', 'study', 'cellar']) {
    h.s.preload(`room:${r}`, [asId(`bg/${r}`)]);
  }
  await h.settle();
  expect(h.state('bg/cellar')).toBe('none');
  h.s.releasePreload('room:cellar');
  h.s.preload('room:study', [asId('bg/study')]);
  h.s.preload('room:hall', [asId('bg/hall')]);
  await h.settle();
  await h.visible('bg/wide', 'scene:a');
  // The study event's step: 32.693 MiB live and a face file of 1.633: one eviction suffices.
  h.s.want(stage({ need: ['bg/wide', 'face/f'] }));
  await h.settle();
  expect(['face/f', 'bg/hall', 'bg/study'].map(h.state)).toEqual(['live', 'none', 'live']);
  expect(h.registry.stats().bytes).toBe(mib(11.262) + mib(10.169) + mib(1.633));
});

test('preload: an onEnter event keeps its room through eventRoom', async () => {
  const h = harness('auto', { hold: true });
  h.s.setChapter(wm);
  h.s.preload('room:hall', [asId('bg/hall')]);
  h.s.preload('room:cellar', [asId('bg/cellar')]);
  await h.settle();
  await h.visible('bg/cu_a', 'scene:a');
  // 35.227 MiB; the cellar's event needs a face file: the hall goes, the cellar's tag stays.
  h.s.want(stage({ need: ['bg/cu_a', 'face/f'], eventRoom: ['bg/cellar'] }));
  await h.settle();
  expect(['face/f', 'bg/hall', 'bg/cellar'].map(h.state)).toEqual(['live', 'none', 'live']);
  expect(h.log).not.toContain('release room:cellar');
  expect(h.s.stats().rooms).toEqual(['room:cellar']);
  expect(h.registry.stats().bytes).toBe(mib(11.262) + CU + mib(1.633));
});

test('preload: an onEnter event whose room only the window holds keeps it', async () => {
  const h = harness('auto', { hold: true });
  h.s.setChapter(wm);
  h.s.preload('room:hall', [asId('bg/hall')]);
  await h.settle();
  await h.visible('bg/cu_a', 'scene:a');
  // At the hall the cellar's neighbour preload was refused: room:cellar holds nothing.
  h.s.preload('room:cellar', [asId('bg/cellar')]);
  await h.settle();
  expect(h.state('bg/cellar')).toBe('none');
  // The cellar on stage, then its onEnter event's opening cut: the window's eventRoom holders alone keep it.
  await h.visible('bg/cellar', 'scene:bg');
  await h.visible('prop/cellar', 'scene:prop');
  h.s.want(stage({ need: ['bg/cu_a', 'face/f'], eventRoom: ['bg/cellar', 'prop/cellar'] }));
  h.registry.release(asId('bg/cellar'), 'scene:bg');
  h.registry.release(asId('prop/cellar'), 'scene:prop');
  await h.settle();
  // 38.527 MiB + the face file: the hall goes, the cellar stays (28.898 MiB).
  expect(['face/f', 'bg/hall', 'bg/cellar', 'prop/cellar'].map(h.state)).toEqual(['live', 'none', 'live', 'live']);
  expect(h.registry.stats().bytes).toBe(mib(11.262) + mib(3.3) + CU + mib(1.633));
});

test('preload: a warm decode that does not fit evicts nothing', async () => {
  const h = harness('auto', { hold: true });
  h.s.setChapter(wm);
  h.s.preload('room:study', [asId('bg/study')]);
  await h.settle();
  // r:lobby's window with two openers held: 28.778 MiB; decoding the first needs 12.226 more.
  h.s.want(stage({ need: ['bg/lobby'], warm: ['bg/cu_b', 'bg/cu_c'], near: 2 }));
  await h.settle();
  expect(['bg/study', 'bg/cu_b', 'bg/cu_c'].map(h.state)).toEqual(['live', 'held', 'held']);
  expect(h.log).not.toContain('release room:study');
});

test('preload: joining a record that exists takes no slot', async () => {
  const h = harness('deferred', { hold: true });
  h.s.setChapter(wm);
  for (const id of ['prop/s3', 'prop/h', 'face/f']) {
    void h.visible(id, `scene:${id}`);
  }
  await h.settle();
  // Both slots busy with fetches.
  h.s.preload('preload:k', ['prop/s1', 'prop/s2'].map(asId));
  h.log.length = 0;
  h.s.want(stage({ need: ['prop/s3', 'prop/h', 'face/f', 'prop/s1', 'prop/s2', 'prop/x6'] }));
  expect(h.acquired()).toEqual(['prop/s3', 'prop/h', 'face/f', 'prop/s1', 'prop/s2'].map((id) => `preload:win:${id} ${id}`));
  h.s.preload('room:z', ['prop/s3', 'prop/h', 'face/f'].map(asId));
  expect(h.acquired().slice(5)).toEqual(['room:z prop/s3', 'room:z prop/h', 'room:z face/f']);
  expect(h.fetchesOf('prop/x6')).toBe(0);
});

test("preload: the first window after a chapter change joins the next chapter's files, then releases its tag", async () => {
  const h = harness('auto', { hold: true });
  h.s.setChapter(wm);
  h.s.preload('next:ch7', SIX.map(asId), nx);
  await h.settle();
  h.s.setChapter(nx);
  h.log.length = 0;
  h.s.want(stage({ need: SIX }));
  expect(h.log).toEqual([...SIX.map((id) => `acquire preload:win:${id} ${id}`), 'release next:ch7']);
  await h.settle();
  expect(SIX.map(h.fetchesOf)).toEqual([1, 1, 1, 1, 1, 1]);
  expect(SIX.map(h.state)).toEqual(SIX.map(() => 'live'));
  h.log.length = 0;
  h.s.want(stage({ need: SIX }));
  expect(h.log.filter((l) => l.startsWith('release '))).toEqual([]);
});

test('preload: a room preload refused under a warm decode sheds the decode and is admitted', async () => {
  const h = harness('deferred', { hold: true });
  h.s.setChapter(wm);
  // r:lobby: the street opener near, a 6 MiB file and the vault's bg far (the neighbour EN asks for), a small hope.
  h.s.want(stage({ need: ['bg/lobby'], warm: ['bg/street', 'prop/x6', 'bg/vault'], near: 1, hope: ['prop/h'] }));
  h.land('bg/street');
  await micro();
  h.land('bg/lobby');
  await micro();
  h.decoded('bg/lobby');
  await micro();
  h.land('prop/x6');
  await micro();
  h.land('bg/vault');
  await micro();
  // Every warm file held: the street decodes ahead (30.319 MiB), the hope is in flight, the other decodes queue.
  expect([h.decodesOf('bg/street'), h.fetchesOf('prop/h')]).toEqual([1, 1]);
  h.s.preload('room:vault', [asId('bg/vault')]);
  h.decoded('bg/street');
  await micro();
  // The vault's decode was refused at 42.6 MiB: the street sheds to its file, the hope goes, the vault is admitted
  // before anything queued (the 6 MiB decode would fit after the shed) is pumped.
  expect(['bg/vault', 'bg/street', 'prop/x6'].map(h.state)).toEqual(['pending', 'held', 'held']);
  expect([h.fetchesOf('bg/street'), h.fetchesOf('bg/vault'), h.decodesOf('bg/vault')]).toEqual([1, 1, 1]);
});

test('preload: a room preload refused under a warm decode in flight sheds the decode and is admitted in the same turn', async () => {
  const h = harness('deferred', { hold: true });
  h.s.setChapter(wm);
  h.s.want(stage({ need: ['bg/lobby'], warm: ['bg/street', 'bg/vault'], near: 1 }));
  h.land('bg/street');
  await micro();
  h.land('bg/lobby');
  await micro();
  h.decoded('bg/lobby');
  await micro();
  h.land('bg/vault');
  await micro();
  expect(h.decodesOf('bg/street')).toBe(1);
  // The street's decode is still in flight when EN asks for the vault.
  h.s.preload('room:vault', [asId('bg/vault')]);
  await micro();
  expect(h.state('bg/vault')).toBe('pending');
  expect(h.decodeSignal('bg/street')?.aborted).toBe(true);
  expect(h.registry.stats().bytes).toBe(mib(16.562) + 2 * mib(0.477) + mib(12.226));
  // The aborted decode lands late: released at once, the file still held.
  h.decoded('bg/street');
  await micro();
  expect(h.releasesOf('bg/street')).toBe(1);
  expect(h.state('bg/street')).toBe('held');
  expect([h.fetchesOf('bg/street'), h.fetchesOf('bg/vault')]).toEqual([1, 1]);
});

test('preload: a refused need sheds a warm decode in flight and is admitted in the same turn', async () => {
  const h = harness('deferred', { hold: true });
  h.s.setChapter(wm);
  h.s.preload('room:r', [asId('prop/p3')]);
  h.land('prop/p3');
  await micro();
  h.decoded('prop/p3');
  await micro();
  h.s.want(stage({ need: ['bg/cu_a'], warm: ['bg/cu_b'] }));
  h.land('bg/cu_a');
  h.land('bg/cu_b');
  await micro();
  h.decoded('bg/cu_a');
  await micro();
  // CU B's decode ahead is in flight (28.406 MiB); the next step needs CU D: refused at 41.109.
  expect(h.decodesOf('bg/cu_b')).toBe(1);
  h.s.want(stage({ need: ['bg/cu_a', 'bg/cu_d'], warm: ['bg/cu_b'] }));
  await micro();
  expect(['bg/cu_d', 'bg/cu_b', 'prop/p3'].map(h.state)).toEqual(['pending', 'held', 'live']);
  expect(h.decodeSignal('bg/cu_b')?.aborted).toBe(true);
  expect(h.log).not.toContain('release room:r');
});

test('preload: the warm decodes start in the turn the last warm file lands', async () => {
  vi.useFakeTimers();
  try {
    const h = harness('deferred', { hold: true });
    h.s.setChapter(wm);
    h.s.want(stage({ warm: ['prop/x6', 'prop/big'] }));
    h.land('prop/x6');
    await micro();
    expect(h.decodesOf('prop/x6')).toBe(0);
    h.land('prop/big');
    await micro();
    // No timer ran: the decode of the first file started in the settle of the last fetch; the second does not fit.
    expect(h.decodesOf('prop/x6')).toBe(1);
    expect(h.registry.stats().pending).toBe(1);
  } finally {
    vi.useRealTimers();
  }
});

test('preload: a held record is queued as a decode and never joined', async () => {
  const h = harness('deferred', { hold: true });
  h.s.setChapter(wm);
  h.s.want(stage({ warm: ['prop/big'] }));
  h.land('prop/big');
  await micro();
  expect(h.state('prop/big')).toBe('held');
  // Both slots busy with the next window's need fetches.
  h.s.want(stage({ need: ['prop/s1', 'prop/s2'], warm: ['prop/big'] }));
  h.s.preload('room:x', [asId('prop/big')]);
  expect(h.acquired().filter((a) => a.startsWith('room:x'))).toEqual([]);
  h.land('prop/s1');
  await micro();
  h.decoded('prop/s1');
  await micro();
  expect(h.acquired().filter((a) => a.startsWith('room:x'))).toEqual(['room:x prop/big']);
});

test('preload: a join that carries a fetch in flight holds one of the two slots', async () => {
  const h = harness('deferred', { hold: true });
  h.s.setChapter(wm);
  h.s.preload('room:x', [asId('bg/vault')]);
  h.s.want(stage({ warm: ['bg/vault'] }));
  h.s.preload('room:y', [asId('prop/s1')]);
  h.s.preload('room:z', [asId('prop/s2')]);
  h.s.releasePreload('room:x');
  // The vault is warm-only and still fetching: its join carries the fetch and holds a slot.
  expect(h.state('bg/vault')).toBe('held');
  expect([h.fetchesOf('bg/vault'), h.fetchesOf('prop/s1'), h.fetchesOf('prop/s2')]).toEqual([1, 1, 0]);
  h.land('bg/vault');
  await micro();
  expect(h.fetchesOf('prop/s2')).toBe(1);
});

test("preload: a refused need evicts a kept room's state set before a neighbour's bg", async () => {
  const h = harness('auto', { hold: true });
  h.s.setChapter(wm);
  // EN back in the hall: its room and state set, then the study's bg and its kept state set (29.124 MiB).
  h.s.preload('room:hall', [asId('bg/hall')]);
  h.s.preload('state:hall', [asId('prop/hall')]);
  h.s.preload('room:study', [asId('bg/study')]);
  h.s.preload('state:study', [asId('prop/study')]);
  await h.settle();
  h.s.want(stage({ need: ['bg/hall', 'prop/hall', 'prop/p3'] }));
  await h.settle();
  expect(['prop/p3', 'prop/study', 'bg/study'].map(h.state)).toEqual(['live', 'none', 'live']);
});

test("preload: window stats count every need item not live and list the window's ids", async () => {
  const h = harness('deferred', { hold: true });
  h.s.setChapter(wm);
  expect(h.s.stats()).toEqual({ window: { pending: 0, ids: [] }, rooms: [] });
  h.s.preload('room:study', [asId('prop/s3')]);
  h.s.want(stage({ need: ['prop/s1', 'prop/s2'], warm: ['bg/cu_b'], hope: ['prop/h'] }));
  expect(h.s.stats()).toEqual({ window: { pending: 2, ids: ['prop/s1', 'prop/s2', 'bg/cu_b', 'prop/h'] }, rooms: ['room:study'] });
  h.land('prop/s1');
  await micro();
  h.decoded('prop/s1');
  await micro();
  expect(h.s.stats().window.pending).toBe(1);
});

test("preload: ensure settles when a window item's fetch fails", async () => {
  const h = harness('deferred', { hold: true });
  h.s.setChapter(wm);
  h.s.want(stage({ need: ['prop/s1'] }));
  const seen: { value: Result<void, SceneError> | null } = { value: null };
  void h.s.ensure([asId('prop/s1')], live()).then((r) => {
    seen.value = r;
  });
  h.fetchFails('prop/s1');
  await flush();
  expect(seen.value).toMatchObject({ ok: false, error: { kind: 'assets', errors: [{ kind: 'fetch', id: 'prop/s1' }] } });
  expect(h.state('prop/s1')).toBe('none');
  expect(h.errors).toMatchObject([{ kind: 'fetch', id: 'prop/s1' }]);
});
