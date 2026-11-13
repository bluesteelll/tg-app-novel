import { expect, test, vi } from 'vitest';

import type { AssetEntry, AssetManifest, ImageEntry, Result, SizeTier } from '../story/catalog.ts';
import type { AssetId, ChapterId } from '../story/staging.ts';
import { ENSURE_HOLDER, PRELOAD_IN_FLIGHT, createAssetScheduler, windowDeps } from './preload.ts';
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
/** A fake `Decoded.upgrade` call (lane SH5b): `id` by the full file's URL; it settles on demand, never by itself. */
type UpgradeCall = { id: string; url: string; signal: AbortSignal; settle(r: Result<void, LoadError>): void; done: boolean };

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
 * then sees the registry through `recording`. `{ tier }` (lane SH5b): the registry's tier, `'full'` by default. Every
 * Decoded can upgrade (lane SH5b): each call is recorded and settles only through `upgraded` or `settle`.
 */
function harness(mode: 'auto' | 'deferred' = 'auto', o?: { hold?: true; tier?: SizeTier }) {
  const calls: Call[] = [];
  const released = new Map<string, number>();
  const upgrades: UpgradeCall[] = [];
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
      // As the loader's swap: the same texture takes the full file's size and bytes; one aborted first swaps nothing.
      upgrade: (ref, _geometry, signal) =>
        new Promise((resolve) => {
          const u: UpgradeCall = {
            id: entryIdOf(ref.url),
            url: ref.url,
            signal,
            done: false,
            settle(r) {
              if (u.done) {
                return;
              }
              u.done = true;
              if (signal.aborted) {
                resolve({ ok: false, error: { kind: 'aborted' } });
                return;
              }
              const full = URLS.get(ref.url);
              if (r.ok && full !== undefined) {
                d.w = full.w;
                d.h = full.h;
                d.keptBytes = ref.bytes;
              }
              resolve(r);
            },
          };
          upgrades.push(u);
        }),
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
  const tier = o?.tier ?? 'full';
  const registry = o?.hold === true ? createAssetRegistry<Tex>({ hold, variant: 'avif', tier }) : createAssetRegistry<Tex>({ load, variant: 'avif', tier });
  const errors: AssetError[] = [];
  const s = createAssetScheduler({
    registry: o?.hold === true ? recording(registry, log) : registry,
    onError: (e) => {
      errors.push(e);
    },
  });
  /** The first call of `id` (in the window fixtures' manifests: its file, or its half) not yet settled. */
  const open = <C extends { url: string; done: boolean }>(list: C[], id: string): C => {
    const c = list.find((x) => (x.url === winUrl(id) || x.url === halfUrl(id)) && !x.done);
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
    // The upgrades (lane SH5b), by id in call order.
    upgradeCalls: (): string[] => upgrades.map((u) => u.id),
    upgradesOpen: (): number => upgrades.filter((u) => !u.done).length,
    upgraded: (id: string, r: Result<void, LoadError> = { ok: true, value: undefined }): void => {
      const u = upgrades.find((x) => x.id === id && !x.done);
      if (u === undefined) {
        throw new Error(`invariant: ${id} has an upgrade in flight`);
      }
      u.settle(r);
    },
    fetchUrls: (): string[] => fetches.map((c) => c.url),
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
    /** Lands every fetch and settles every decode and upgrade in flight, until none is left. */
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
        for (const u of upgrades.filter((x) => !x.done)) {
          u.settle({ ok: true, value: undefined });
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
// A chapter entry at the half tier (shots §5.8 "Entry at the half tier", lane SH5b): window images at the fixtures'
// sizes, each with a half exactly half its file per side (a quarter of its bytes; the catalog's rule), and two 19 MiB
// plates with none. Ranks by kind: a cg, plates, sheets and a talk file.
const halved = (file: string, decoded: number, held = 0): ImageEntry => {
  const e = sized(file, decoded, held);
  const quarter = (n: number): number => Math.round(n / 4);
  return {
    ...e,
    half: {
      w: e.w / 2,
      h: e.h / 2,
      decodedBytes: quarter(e.decodedBytes),
      avif: { url: `/assets/${file}-half.avif`, bytes: quarter(e.avif.bytes) },
      webp: { url: `/assets/${file}-half.webp`, bytes: quarter(e.webp.bytes) },
    },
  };
};
const em = manifest('ch8', {
  'cg/c': halved('e_cg', 4, 0.2),
  'bg/v': halved('e_v', 8, 0.2),
  'sheet/v': halved('e_sv', 2, 0.1),
  'bg/n': halved('e_n', 8, 0.2),
  'sheet/n': halved('e_sn', 2, 0.1),
  'prop/w': halved('e_w', 1, 0.05),
  'prop/hope': halved('e_h', 1, 0.05),
  'bg/p': halved('e_p', 8, 0.2),
  'bg/x': halved('e_x', 2, 0.1),
  'bg/big1': sized('e_big1', 19),
  'bg/big2': sized('e_big2', 19),
});
for (const m of [wm, nx, em]) {
  for (const e of Object.values(m.assets)) {
    if (e.kind === 'image') {
      URLS.set(e.avif.url, e);
      if (e.half !== undefined) {
        URLS.set(e.half.avif.url, { kind: 'image', ...e.half });
      }
    }
  }
}
const winUrl = (id: string): string => urlOf(Object.hasOwn(wm.assets, id) ? wm : Object.hasOwn(em.assets, id) ? em : nx, id);
/** An entry fixture's half file URL; a fixture without a half has none. */
const halfUrl = (id: string): string => {
  const e = em.assets[asId(id)];
  return e?.kind === 'image' && e.half !== undefined ? e.half.avif.url : `no-half:${id}`;
};
/** The entry fixture whose full or half file is `url` (an upgrade fetches the full one). */
function entryIdOf(url: string): string {
  const hit = Object.entries(em.assets).find(([, e]) => e.kind === 'image' && (e.avif.url === url || e.half?.avif.url === url));
  return hit?.[0] ?? `unknown:${url}`;
}
function winEntry(id: string): ImageEntry {
  const e = wm.assets[asId(id)] ?? em.assets[asId(id)] ?? nx.assets[asId(id)];
  if (e?.kind !== 'image') {
    throw new Error(`invariant: ${id} is a window fixture image`);
  }
  return e;
}
const stage = (o: { need?: string[]; warm?: string[]; near?: number; hope?: string[]; eventRoom?: string[]; preview?: true }): StageWindow => ({
  need: (o.need ?? []).map(asId),
  warm: (o.warm ?? []).map(asId),
  near: o.near ?? 0,
  hope: (o.hope ?? []).map(asId),
  eventRoom: (o.eventRoom ?? []).map(asId),
  ...(o.preview === true ? { preview: true } : {}),
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

// An end step hands EMPTY_WINDOW and the ending card, "to be continued" or the paywall follow with no setChapter:
// only want's own release frees the last line's holders there.
test('preload: an empty window releases every window holder', async () => {
  const h = harness('auto', { hold: true });
  h.s.setChapter(wm);
  h.s.want(stage({ need: ['bg/cu_a'], warm: ['bg/cu_b'], hope: ['prop/s1'] }));
  await h.settle();
  // The warm file is held, then decoded under its window holder (step 3): two holders on cu_b.
  expect([...h.acquired()].sort()).toEqual([
    'preload:warm:bg/cu_b bg/cu_b',
    'preload:win:bg/cu_a bg/cu_a',
    'preload:win:bg/cu_b bg/cu_b',
    'preload:win:prop/s1 prop/s1',
  ]);
  h.s.want(stage({}));
  await h.settle();
  expect(['bg/cu_a', 'bg/cu_b', 'prop/s1'].map(h.state)).toEqual(['none', 'none', 'none']);
  expect(h.log).toContain('release preload:win:bg/cu_a');
  expect(h.log).toContain('release preload:warm:bg/cu_b');
  expect(h.log).toContain('release preload:win:bg/cu_b');
  expect(h.log).toContain('release preload:win:prop/s1');
});

// Step 1 keeps every holder of an id that stays in need ∪ warm ∪ hope ∪ eventRoom, under either tag.
test('preload: ids that stay in the window keep their holders across a swap', async () => {
  const h = harness('auto', { hold: true });
  h.s.setChapter(wm);
  h.s.want(stage({ need: ['bg/cu_a'], warm: ['bg/cu_b'], hope: ['prop/s1'] }));
  await h.settle();
  const before = h.log.length;
  h.s.want(stage({ need: ['bg/cu_a'], warm: ['bg/cu_b'], hope: ['prop/s1'] }));
  await h.settle();
  expect(h.log.slice(before).filter((l) => l.startsWith('release '))).toEqual([]);
});

// A record whose only holder was a dropped one ends: a kept warm file held but not decoded, or a kept hope file,
// would be fetched again on every swap.
test('preload: a held-only warm file and a hoped file kept across a swap are fetched once', async () => {
  const h = harness('auto', { hold: true });
  h.s.setChapter(wm);
  await h.visible('bg/cu_a', 'scene:a');
  h.s.want(stage({ need: ['bg/cu_a'], warm: ['bg/cu_b', 'bg/cu_c'], hope: ['prop/s1'] }));
  await h.settle();
  expect(['bg/cu_b', 'bg/cu_c', 'prop/s1'].map(h.state)).toEqual(['live', 'held', 'live']);
  h.s.want(stage({ need: ['bg/cu_a'], warm: ['bg/cu_b', 'bg/cu_c'], hope: ['prop/s1'] }));
  await h.settle();
  expect([h.fetchesOf('bg/cu_c'), h.fetchesOf('prop/s1')]).toEqual([1, 1]);
});

test('preload: a tag released while its items are still queued never fetches them', async () => {
  const h = harness('deferred', { hold: true });
  h.s.setChapter(wm);
  // Two of the four take the slots; the other two wait in the queue when the tag goes.
  h.s.preload('preload:k1', ['prop/s1', 'prop/s2', 'prop/s3', 'prop/h'].map(asId));
  expect([h.fetchesOf('prop/s1'), h.fetchesOf('prop/s3')]).toEqual([1, 0]);
  h.s.releasePreload('preload:k1');
  await h.settle();
  expect([h.fetchesOf('prop/s3'), h.fetchesOf('prop/h')]).toEqual([0, 0]);
});

// A queued item has no holder yet, so step 1's drop never sees it: only the queue filter takes a leaver out.
test('preload: a window item still queued when the window swaps is never fetched', async () => {
  const h = harness('deferred', { hold: true });
  h.s.setChapter(wm);
  // PRELOAD_IN_FLIGHT = 2: s1 and s2 are in flight, s3 and h queued.
  h.s.want(stage({ need: ['prop/s1', 'prop/s2', 'prop/s3', 'prop/h'] }));
  expect(h.fetchesOf('prop/s3')).toBe(0);
  expect(h.fetchesOf('prop/h')).toBe(0);
  h.s.want(stage({ need: ['prop/x6'] }));
  await h.settle();
  expect(h.fetchesOf('prop/s3')).toBe(0);
  expect(h.fetchesOf('prop/h')).toBe(0);
});

test('preload: the new need takes the slots ahead of the old window still queued', () => {
  const h = harness('deferred', { hold: true });
  h.s.setChapter(wm);
  h.s.want(stage({ need: ['prop/s1', 'prop/s2', 'prop/s3', 'prop/h'] }));
  h.s.want(stage({ need: ['prop/x6'] }));
  expect([h.fetchesOf('prop/x6'), h.fetchesOf('prop/s3'), h.fetchesOf('prop/h')]).toEqual([1, 0, 0]);
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

test('preload: a refused warm fetch evicts resident hope and is held', async () => {
  const h = harness('auto', { hold: true });
  h.s.setChapter(wm);
  h.s.want(stage({ need: ['bg/cu_a'], hope: ['bg/wide'] }));
  await h.settle();
  await h.visible('bg/cu_b', 'scene:b');
  // 35.575 MiB live: the street's file (0.477) is refused at STEADY; step 6 (a) evicts the hoped wide to make room.
  h.s.want(stage({ need: ['bg/cu_a'], warm: ['bg/street'], near: 1, hope: ['bg/wide'] }));
  await h.settle();
  expect(['bg/street', 'bg/wide'].map(h.state)).toEqual(['held', 'none']);
  expect(h.log).toContain('release preload:win:bg/wide');
});

test('preload: a warm fetch refused over the cap is held after a release', async () => {
  const h = harness('auto', { hold: true });
  h.s.setChapter(wm);
  await h.visible('bg/cu_a', 'scene:a');
  await h.visible('bg/cu_b', 'scene:b');
  await h.visible('bg/wide', 'scene:w');
  // 35.575 MiB on stage and nothing of step 6 to release: the street's file is deferred, not lost.
  h.s.want(stage({ need: ['bg/cu_a'], warm: ['bg/street'], near: 1 }));
  await h.settle();
  expect(h.state('bg/street')).toBe('none');
  h.registry.release(asId('bg/cu_b'), 'scene:b');
  h.s.retry();
  await h.settle();
  expect(h.state('bg/street')).toBe('held');
  expect(h.fetchesOf('bg/street')).toBe(1);
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

// Step 6 (a) goes by rank: a warm decode (an opener of the coming cut) outranks a best-effort hope.
test('preload: step 6 (a) releases resident hope before it sheds a warm decode', async () => {
  const h = harness('auto', { hold: true });
  h.s.setChapter(wm);
  await h.visible('bg/cu_a', 'scene:a');
  h.s.want(stage({ need: ['bg/cu_a'], warm: ['bg/cu_b'], hope: ['prop/x6'] }));
  await h.settle();
  expect(['bg/cu_a', 'bg/cu_b', 'prop/x6'].map(h.state)).toEqual(['live', 'live', 'live']);
  // 31.883 MiB: CU A on stage, CU B decoded, x6 hoped. The hall's prop (3.3) is refused; the hope alone makes room,
  // and it queues again but no longer fits.
  h.s.want(stage({ need: ['bg/cu_a', 'prop/hall'], warm: ['bg/cu_b'], hope: ['prop/x6'] }));
  await h.settle();
  expect(['prop/hall', 'bg/cu_b', 'prop/x6'].map(h.state)).toEqual(['live', 'live', 'none']);
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

test("preload: a refused need never evicts a next chapter's tag that holds a need id", async () => {
  const h = harness('auto', { hold: true });
  h.s.setChapter(wm);
  await h.visible('bg/cu_b', 'scene:b');
  h.s.preload('next:ch7', ['prop/x6', 'bg/close'].map(asId));
  await h.settle();
  expect(['prop/x6', 'bg/close'].map(h.state)).toEqual(['live', 'live']);
  // 29.349 MiB; CU C would make 42.052. Step 6 (c) spares the tag (it holds x6, a need id): CU C is deferred.
  h.s.want(stage({ need: ['prop/x6', 'bg/cu_c'] }));
  await h.settle();
  expect(['bg/cu_c', 'bg/close'].map(h.state)).toEqual(['none', 'live']);
  expect(h.log).not.toContain('release next:ch7');
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

test("preload: step 6 (d) releases the window's event-room holders before EN's tags that hold the room", async () => {
  const h = harness('auto', { hold: true });
  h.s.setChapter(wm);
  h.s.preload('room:hall', [asId('bg/hall')]);
  h.s.preload('state:hall', [asId('prop/hall')]);
  await h.settle();
  await h.visible('bg/cu_a', 'scene:a');
  // 27.265 MiB; x6 (6.477) is refused. (d): the window's holders free nothing while EN holds the room, then EN's most
  // recent tag, state:hall, frees enough; room:hall stays.
  h.s.want(stage({ need: ['bg/cu_a', 'prop/x6'], eventRoom: ['bg/hall', 'prop/hall'] }));
  await h.settle();
  expect(h.state('prop/x6')).toBe('live');
  expect(h.log).toContain('release state:hall');
  expect(h.log).not.toContain('release room:hall');
  expect(h.s.stats().rooms).toEqual(['room:hall']);
});

test('preload: step 6 (d) never evicts an EN tag of the event room that holds a need id', async () => {
  const h = harness('auto', { hold: true });
  h.s.setChapter(wm);
  h.s.preload('room:hall', [asId('bg/hall')]);
  h.s.preload('state:hall', ['prop/hall', 'prop/p3'].map(asId));
  await h.settle();
  await h.visible('bg/cu_a', 'scene:a');
  // 30.265 MiB; x6 (6.477) is refused. (d): the window's holders, then room:hall; state:hall holds p3, a need id.
  h.s.want(stage({ need: ['bg/cu_a', 'prop/p3', 'prop/x6'], eventRoom: ['bg/hall', 'prop/hall'] }));
  await h.settle();
  expect(h.state('prop/x6')).toBe('live');
  expect(h.log).toContain('release room:hall');
  expect(h.log).not.toContain('release state:hall');
  expect(h.state('prop/hall')).toBe('live');
});

test('preload: a hope item evicted for a need queues again and is admitted while it fits', async () => {
  const h = harness('auto', { hold: true });
  h.s.setChapter(wm);
  h.s.want(stage({ need: ['bg/wide', 'prop/s1'] }));
  await h.settle();
  await h.visible('bg/cu_a', 'scene:a');
  // 22.972 MiB; CU B would make 35.675. Step 6 (a), the last first: s1 frees too little, the wide enough. Both queue
  // again: s1 fits, the wide does not.
  h.s.want(stage({ need: ['bg/cu_a', 'bg/cu_b'], hope: ['bg/wide', 'prop/s1'] }));
  await h.settle();
  expect(['bg/cu_b', 'bg/wide', 'prop/s1'].map(h.state)).toEqual(['live', 'none', 'live']);
});

test('preload: an event-room item evicted for a need queues again and is admitted while it fits', async () => {
  const h = harness('auto', { hold: true });
  h.s.setChapter(wm);
  h.s.want(stage({ eventRoom: ['bg/hall', 'prop/s1'] }));
  await h.settle();
  await h.visible('bg/cu_a', 'scene:a');
  // 24.065 MiB; CU B would make 36.768. Step 6 (d), the last first: s1 frees too little, the hall enough. Both queue
  // again: s1 fits, the hall does not.
  h.s.want(stage({ need: ['bg/cu_a', 'bg/cu_b'], eventRoom: ['bg/hall', 'prop/s1'] }));
  await h.settle();
  expect(['bg/cu_b', 'bg/hall', 'prop/s1'].map(h.state)).toEqual(['live', 'none', 'live']);
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

test('preload: retry() starts the decode of a held warm file stopped for room', async () => {
  const h = harness('auto', { hold: true });
  h.s.setChapter(wm);
  await h.visible('bg/cu_a', 'scene:a');
  await h.visible('bg/cu_b', 'scene:b');
  // 25.883 MiB with the street's file held; its decode (12.226) does not fit and stops.
  h.s.want(stage({ need: ['bg/cu_a'], warm: ['bg/street'], near: 1 }));
  await h.settle();
  expect([h.state('bg/street'), h.decodesOf('bg/street')]).toEqual(['held', 0]);
  // A sweep released CU B: step 3 runs again at the retry, from the held file.
  h.registry.release(asId('bg/cu_b'), 'scene:b');
  h.s.retry();
  await h.settle();
  expect(h.state('bg/street')).toBe('live');
  expect([h.fetchesOf('bg/street'), h.decodesOf('bg/street')]).toEqual([1, 1]);
});

// A second queued decode of one file would join the first once it starts and hold a slot its own flight covers.
test('preload: a warm decode still queued for a slot is not queued again by retry()', async () => {
  const h = harness('deferred', { hold: true });
  h.s.setChapter(wm);
  h.s.want(stage({ warm: ['prop/s1', 'prop/s2', 'prop/s3'] }));
  h.land('prop/s1');
  await flush();
  h.land('prop/s2');
  await flush();
  h.land('prop/s3');
  await flush();
  // PRELOAD_IN_FLIGHT = 2: the decodes of s1 and s2 are in flight and s3's waits; the next chapter's file queues
  // behind it.
  expect([h.decodesOf('prop/s1'), h.decodesOf('prop/s2'), h.decodesOf('prop/s3')]).toEqual([1, 1, 0]);
  h.s.preload('next:ch7', [asId('prop/n1')], nx);
  h.s.retry();
  await flush();
  h.decoded('prop/s1');
  await flush();
  expect(h.decodesOf('prop/s3')).toBe(1);
  // The second freed slot goes to the next chapter's file, and s3's decode was asked for once.
  h.decoded('prop/s2');
  await flush();
  expect(h.fetchesOf('prop/n1')).toBe(1);
  expect(h.acquired().filter((a) => a.startsWith('preload:win:prop/s3'))).toHaveLength(1);
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

test('preload: a warm id another holder decodes is joined and stays decoded when that holder leaves', async () => {
  const h = harness('auto', { hold: true });
  h.s.setChapter(wm);
  await h.visible('bg/street', 'scene:s');
  // The street is on stage when it becomes the window's warm opener: step 3 joins its decode as it is.
  h.s.want(stage({ warm: ['bg/street'], near: 1 }));
  await h.settle();
  h.registry.release(asId('bg/street'), 'scene:s');
  await h.settle();
  expect(h.state('bg/street')).toBe('live');
  expect([h.fetchesOf('bg/street'), h.decodesOf('bg/street')]).toEqual([1, 1]);
});

test('preload: a warm file decoded under the entry tag keeps its decode at the first window, and only there', async () => {
  // RULINGS 302 Q8 (lane SH5b rider R1): a handover's warm file the next chapter's tag decoded keeps that decode
  // across 1c's release of the tag, so step 3 never decodes it a second time.
  const h = harness('deferred', { hold: true });
  h.s.setChapter(wm);
  h.s.preload('next:ch7', [asId('prop/n1')], nx);
  await h.settle();
  expect(h.state('prop/n1')).toBe('live');
  h.s.setChapter(nx);
  h.s.want(stage({ need: ['prop/n2'], warm: ['prop/n1'] }));
  expect(h.state('prop/n1')).toBe('live');
  await h.settle();
  expect([h.state('prop/n1'), h.fetchesOf('prop/n1'), h.decodesOf('prop/n1')]).toEqual(['live', 1, 1]);
  // The guard (O3): with no entry tag, a warm record another holder decodes is joined by step 3 once no warm fetch is
  // left, as before; never in the window's own turn.
  h.s.preload('room:r', [asId('prop/n3')]);
  await h.settle();
  expect(h.state('prop/n3')).toBe('live');
  h.log.length = 0;
  h.s.want(stage({ warm: ['prop/n4', 'prop/n3'] }));
  expect(h.acquired().filter((a) => a === 'preload:win:prop/n3 prop/n3')).toEqual([]);
  h.land('prop/n4');
  await flush();
  expect(h.acquired().filter((a) => a === 'preload:win:prop/n3 prop/n3')).toEqual(['preload:win:prop/n3 prop/n3']);
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

test('preload: stats list no room tag whose preload was refused', async () => {
  const h = harness('auto', { hold: true });
  h.s.setChapter(wm);
  await h.visible('bg/cu_a', 'scene:a');
  await h.visible('bg/cu_b', 'scene:b');
  // 25.406 MiB: the lobby (16.562) is refused at STEADY; the study's prop (0.1) is admitted.
  h.s.preload('room:lobby', [asId('bg/lobby')]);
  h.s.preload('room:study', [asId('prop/s3')]);
  await h.settle();
  expect(['bg/lobby', 'prop/s3'].map(h.state)).toEqual(['none', 'live']);
  expect(h.s.stats().rooms).toEqual(['room:study']);
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

test('preload: the window seat forwards a swap to want and a release to retry', () => {
  // The executor's two reports reach the scheduler through this seat alone (lane SH5a D12): a swap is exactly
  // want(window), a release exactly retry().
  const calls: string[] = [];
  const asked: StageWindow[] = [];
  const seat = windowDeps({
    want: (w) => {
      calls.push('want');
      asked.push(w);
    },
    retry: () => {
      calls.push('retry');
    },
  });
  const w: StageWindow = { need: [asId('bg/a')], warm: [asId('bg/b')], near: 1, hope: [], eventRoom: [] };
  seat.swapped(w);
  expect(calls).toEqual(['want']);
  expect(asked[0]).toBe(w);
  seat.released();
  expect(calls).toEqual(['want', 'retry']);
  expect(asked).toEqual([w]);
});

// ---------------------------------------------------------------------------------------------------------------
// A chapter entry at the half tier (shots §5.8 "Entry at the half tier" steps 1-5, lane SH5b): the entry's previews,
// the upgrade chain (one at a time, outside the slots, the top image first) and the entry gate (only NEED items until
// the visible upgrades and the need previews are done), on the hold harness over `em`. The fake upgrades settle only
// when a test says so.

/** The entry's first batch: `ids` ensured as previews (step 1), then taken by the stage as the executor does. */
async function entryBatch(h: ReturnType<typeof harness>, ids: readonly string[]): Promise<void> {
  const r = await h.s.ensure(ids.map(asId), live(), { preview: true });
  expect(r).toEqual({ ok: true, value: undefined });
  for (const id of ids) {
    await h.visible(id, `scene:${id}`);
  }
  h.registry.releaseHolder(ENSURE_HOLDER);
}

test('preload: an entry window admits its need as previews at once, beside the visible upgrades', async () => {
  const h = harness('auto', { hold: true });
  h.s.setChapter(em);
  await entryBatch(h, ['bg/v']);
  const before = h.fetchUrls().length;
  // The swap point (step 4): the first cut's half files start in this turn, in the two slots, beside the plate's upgrade.
  h.s.want(stage({ need: ['bg/v', 'bg/n', 'sheet/n'], preview: true }));
  expect(h.fetchUrls().slice(before)).toEqual([halfUrl('bg/n'), halfUrl('sheet/n')]);
  expect(h.upgradeCalls()).toEqual(['bg/v']);
});

test("preload: an entry window's need previews upgrade after the visible records", async () => {
  const h = harness('auto', { hold: true });
  h.s.setChapter(em);
  await entryBatch(h, ['bg/v', 'sheet/v']);
  h.s.want(stage({ need: ['bg/v', 'sheet/v', 'bg/n', 'sheet/n'], preview: true }));
  const open = [h.upgradesOpen()];
  expect(h.upgradeCalls()).toEqual(['bg/v']);
  await flush();
  open.push(h.upgradesOpen());
  // The need previews are live from their halves; the plate's upgrade is still the only one.
  expect(h.registry.previews().map((p) => [p.id, p.visible])).toEqual([
    ['bg/v', true],
    ['sheet/v', true],
    ['bg/n', false],
    ['sheet/n', false],
  ]);
  expect(h.upgradeCalls()).toEqual(['bg/v']);
  for (let i = 0; i < 4; i += 1) {
    // The upgrade in flight ends; the next one starts.
    h.upgraded(h.upgradeCalls().at(-1) ?? '');
    await flush();
    open.push(h.upgradesOpen());
  }
  // The visible sheet before the need plate, though the plate ranks first: visible records lead.
  expect(h.upgradeCalls()).toEqual(['bg/v', 'sheet/v', 'bg/n', 'sheet/n']);
  expect(Math.max(...open), 'one upgrade at a time').toBe(1);
  expect(h.registry.previews()).toEqual([]);
});

test('preload: an entry window admits nothing but need until its visible upgrades and need previews are done', async () => {
  const h = harness('auto', { hold: true });
  h.s.setChapter(em);
  await entryBatch(h, ['bg/v']);
  const before = h.fetchUrls().length;
  h.s.want(stage({ need: ['bg/v', 'bg/n'], warm: ['prop/w'], near: 1, hope: ['prop/hope'], preview: true }));
  // A slot is free, but the gate holds the warm opener and the hope while the plate's upgrade runs.
  expect(h.fetchUrls().slice(before)).toEqual([halfUrl('bg/n')]);
  await flush();
  expect(h.state('bg/n')).toBe('live');
  expect(h.fetchUrls().slice(before)).toEqual([halfUrl('bg/n')]);
  // The plate is sharp and the need preview landed: the need's upgrade runs next and the gate opens in that turn.
  h.upgraded('bg/v');
  await micro();
  expect(h.upgradeCalls()).toEqual(['bg/v', 'bg/n']);
  expect(h.fetchUrls().slice(before)).toEqual([halfUrl('bg/n'), winUrl('prop/w'), winUrl('prop/hope')]);
});

test('preload: visible previews upgrade top image first', async () => {
  const h = harness('auto', { hold: true });
  h.s.setChapter(em);
  // Started sheet, plate, CG: the upgrades go CG, plate, sheet (step 3).
  await entryBatch(h, ['sheet/v', 'bg/v', 'cg/c']);
  h.s.want(stage({ need: ['sheet/v', 'bg/v', 'cg/c'], preview: true }));
  expect(h.upgradeCalls()).toEqual(['cg/c']);
  for (const id of ['cg/c', 'bg/v']) {
    h.upgraded(id);
    await flush();
  }
  expect(h.upgradeCalls()).toEqual(['cg/c', 'bg/v', 'sheet/v']);
});

test('preload: ensure with preview starts previews; without, the full files', async () => {
  const h = harness('auto', { hold: true });
  h.s.setChapter(em);
  expect(await h.s.ensure([asId('bg/v')], live(), { preview: true })).toEqual({ ok: true, value: undefined });
  expect(await h.s.ensure([asId('bg/n')], live())).toEqual({ ok: true, value: undefined });
  expect(h.fetchUrls()).toEqual([halfUrl('bg/v'), winUrl('bg/n')]);
  expect(h.registry.previews()).toEqual([{ id: asId('bg/v'), visible: true }]);
});

test('preload: a later window upgrades a preview a tap showed at the half tier', async () => {
  const h = harness('auto', { hold: true });
  h.s.setChapter(em);
  // Two 19 MiB plates on stage, in the window.
  await h.visible('bg/big1', 'scene:big1');
  await h.visible('bg/big2', 'scene:big2');
  h.s.want(stage({ need: ['bg/big1', 'bg/big2'] }));
  await flush();
  // A tap inside the entry's first step shows its plate at the half tier.
  expect(await h.s.ensure([asId('bg/v')], live(), { preview: true })).toEqual({ ok: true, value: undefined });
  await h.visible('bg/v', 'scene:v');
  h.registry.releaseHolder(ENSURE_HOLDER);
  // A release report: the chain tries the plate, whose full file would pass HARD (48.25 MiB): refused, the half stays.
  h.s.retry();
  await flush();
  expect(h.upgradeCalls()).toEqual([]);
  // Room is made, but the plate was tried since the last swap point: not before the next one.
  h.registry.release(asId('bg/big2'), 'scene:big2');
  h.s.releasePreload('preload:win:bg/big2');
  expect(h.state('bg/big2')).toBe('none');
  h.s.retry();
  await flush();
  expect(h.upgradeCalls()).toEqual([]);
  // The next window is a swap point (step 5): the plate is tried again and upgraded.
  h.s.want(stage({ need: ['bg/big1', 'bg/v'] }));
  expect(h.upgradeCalls()).toEqual(['bg/v']);
  h.upgraded('bg/v');
  await flush();
  expect(h.registry.previews()).toEqual([]);
});

test('preload: a need preview is spared by step 6 like any need item', async () => {
  const h = harness('auto', { hold: true });
  h.s.setChapter(em);
  h.s.want(stage({ need: ['bg/n'], preview: true }));
  await flush();
  // The need item is live from its half, its upgrade in flight (held).
  expect(h.registry.previews()).toEqual([{ id: asId('bg/n'), visible: false }]);
  expect(h.upgradeCalls()).toEqual(['bg/n']);
  // EN holds a 19 MiB plate under a room tag (29.25 MiB with the upgrade's reservation).
  h.s.preload('room:r', [asId('bg/big1')]);
  await flush();
  expect(h.state('bg/big1')).toBe('live');
  // The next step needs another 19 MiB plate, refused under STEADY: step 6 releases EN's tag, never the need preview.
  h.s.want(stage({ need: ['bg/n', 'bg/big2'], preview: true }));
  await flush();
  expect(['bg/n', 'bg/big1', 'bg/big2'].map(h.state)).toEqual(['live', 'none', 'live']);
  expect(h.log).toContain('release room:r');
  expect(h.log).not.toContain('release preload:win:bg/n');
  expect(h.registry.previews()).toEqual([{ id: asId('bg/n'), visible: false }]);
});

test('preload: a warm item never starts a preview', async () => {
  const h = harness('auto', { hold: true });
  h.s.setChapter(em);
  h.s.want(stage({ need: ['bg/n'], warm: ['prop/w'], near: 1, hope: ['prop/hope'], preview: true }));
  expect(h.fetchUrls()).toEqual([halfUrl('bg/n')]);
  await flush();
  await flush();
  // The gate opened once the need landed: the warm opener and the hope load their full files, and the opener's decode
  // is the full file's; only the need is a preview.
  expect(h.fetchUrls()).toEqual([halfUrl('bg/n'), winUrl('prop/w'), winUrl('prop/hope')]);
  expect(h.calls.filter((c) => c.url === winUrl('prop/w') || c.url === halfUrl('prop/w')).map((c) => c.url)).toEqual([winUrl('prop/w')]);
  expect(h.registry.previews().map((p) => p.id)).toEqual(['bg/n']);
});

test('preload: on a half-tier registry an entry window changes nothing', async () => {
  const w = stage({ need: ['bg/n'], warm: ['prop/w'], near: 1, hope: ['prop/hope'] });
  // Arm 1, the half tier: the same window with and without the entry's flag fetches the same files, turn by turn.
  const run = async (preview: boolean) => {
    const h = harness('auto', { hold: true, tier: 'half' });
    h.s.setChapter(em);
    h.s.want(preview ? { ...w, preview: true } : w);
    const turns = [h.fetchUrls()];
    for (let i = 0; i < 4; i += 1) {
      await flush();
      turns.push(h.fetchUrls());
    }
    return { h, turns };
  };
  const plain = await run(false);
  const entry = await run(true);
  expect(entry.turns).toEqual(plain.turns);
  expect(entry.turns[0]).toEqual([halfUrl('bg/n'), halfUrl('prop/w')]);
  // Arm 2, a session demoted by a resize: full from now on, so the entry previews and gates.
  const d = harness('deferred', { hold: true, tier: 'half' });
  d.registry.demote();
  d.s.setChapter(em);
  d.s.want({ ...w, preview: true });
  expect(d.fetchUrls()).toEqual([halfUrl('bg/n')]);
  d.land('bg/n');
  await micro();
  expect(d.fetchUrls()).toEqual([halfUrl('bg/n')]);
  // The need lands: no visible preview, no need left, and the need's own upgrade holds nothing; the gate opens.
  d.decoded('bg/n');
  await micro();
  expect(d.fetchUrls()).toEqual([halfUrl('bg/n'), winUrl('prop/w'), winUrl('prop/hope')]);
  expect(d.upgradeCalls()).toEqual(['bg/n']);
  // Arm 1 again: no preview and no upgrade on the half tier.
  expect([entry.h.registry.previews(), entry.h.upgradeCalls(), plain.h.upgradeCalls()]).toEqual([[], [], []]);
});

test("preload: a resumed puzzle's keep swaps end its restored plate and close-up at the full tier, and plan no window", async () => {
  // Shots §5.8 step 3 at an entry's windowless stages (lane SH5b, W2): each hands the keep window, whose swap counts as
  // a release; the entry tag waits for the first real window (S36). Literal, as the stage hands KEEP_WINDOW.
  const keep: StageWindow = { need: [], warm: [], near: 0, hope: [], eventRoom: [], keep: true };
  const h = harness('auto', { hold: true });
  h.s.setChapter(wm);
  h.s.preload('next:ch8', [asId('bg/x')], em);
  await flush();
  expect(h.state('bg/x')).toBe('live');
  h.s.setChapter(em);
  // The resume's restore: the controller wraps the executor's take in previewing.
  expect((await h.registry.previewing(() => h.visible('bg/p', 'scene:bg'))).ok).toBe(true);
  // The yield's own (empty) batch.
  h.log.length = 0;
  h.s.want(keep);
  expect(h.log).not.toContain('release next:ch8');
  expect(h.s.stats().window).toEqual({ pending: 0, ids: [] });
  await micro();
  expect(h.upgradeCalls()).toEqual(['bg/p']);
  // The puzzle's close-up, while the plate's upgrade is held: its half, then its keep swap; still one upgrade.
  await entryBatch(h, ['cg/c']);
  h.s.want(keep);
  await micro();
  expect(h.upgradeCalls()).toEqual(['bg/p']);
  expect(h.fetchUrls()).toEqual([winUrl('bg/x'), halfUrl('bg/p'), halfUrl('cg/c')]);
  // The plate is sharp: the close-up's upgrade starts in that turn, and both end at the full tier.
  h.upgraded('bg/p');
  await micro();
  expect(h.upgradeCalls()).toEqual(['bg/p', 'cg/c']);
  await h.settle();
  expect(h.registry.previews()).toEqual([]);
  expect(h.upgradeCalls()).toEqual(['bg/p', 'cg/c']);
  expect(h.fetchUrls()).toEqual([winUrl('bg/x'), halfUrl('bg/p'), halfUrl('cg/c')]);
  expect(h.registry.stats().bytes).toBe(mib(2) + mib(0.1) + mib(8) + mib(0.2) + mib(4) + mib(0.2));
  expect(h.state('bg/x')).toBe('live');
  expect(h.log).not.toContain('release next:ch8');
  // The first real window joins the tag's file, then releases the tag (S36).
  h.log.length = 0;
  h.s.want(stage({ need: ['bg/p', 'bg/x'] }));
  expect(h.log).toEqual(['acquire preload:win:bg/p bg/p', 'acquire preload:win:bg/x bg/x', 'release next:ch8']);
});

// Shots §5.8 step 3 (lane SH5b, RULINGS 330): an entry's upgrades start at its first swap point. Before it, a settle
// or a join settle carries no chain: nothing has started one.

test("preload: an entry's previews are not upgraded before its first swap point", async () => {
  const h = harness('auto', { hold: true });
  h.s.setChapter(em);
  await entryBatch(h, ['bg/v', 'sheet/v']);
  // As enterKnot's hold does before the first step's swap: a join of a live preview and a TAG fetch, both settling.
  h.s.preload('preload:k', [asId('sheet/v'), asId('bg/n')]);
  await flush();
  expect(h.upgradeCalls()).toEqual([]);
  // The batch's swap starts the chain in its own turn.
  h.s.want(stage({ need: ['bg/v', 'sheet/v'], preview: true }));
  expect(h.upgradeCalls()).toEqual(['bg/v']);
});

test('preload: a kept next: flight settling while an entry half is awaited starts no upgrade', async () => {
  const h = harness('deferred', { hold: true });
  // A swap in the old chapter, then the handover: setChapter keeps next:ch8 with its file in flight.
  h.s.setChapter(wm);
  h.s.want(stage({ need: [] }));
  h.s.preload('next:ch8', [asId('bg/x')], em);
  h.s.setChapter(em);
  // The entry's first batch: both halves held.
  const p = h.s.ensure([asId('bg/v'), asId('sheet/v')], live(), { preview: true });
  h.land('bg/v');
  await micro();
  h.decoded('bg/v');
  await micro();
  expect(h.upgradeCalls()).toEqual([]);
  // The kept flight settles while the sheet's half is still awaited: no full file joins the link.
  h.land('bg/x');
  await micro();
  h.decoded('bg/x');
  await micro();
  expect(h.state('sheet/v')).toBe('pending');
  expect(h.upgradeCalls()).toEqual([]);
  // The sheet lands, the stage takes the batch, and its swap starts the chain.
  h.land('sheet/v');
  await micro();
  h.decoded('sheet/v');
  await micro();
  expect(await p).toEqual({ ok: true, value: undefined });
  await h.visible('bg/v', 'scene:bg/v');
  await h.visible('sheet/v', 'scene:sheet/v');
  h.registry.releaseHolder(ENSURE_HOLDER);
  h.s.want(stage({ need: ['bg/v', 'sheet/v'], preview: true }));
  expect(h.upgradeCalls()).toEqual(['bg/v']);
});

test('preload: setChapter and destroy abort the upgrade in flight and forget its answer', async () => {
  // Arm 1, setChapter. The plate stays on stage under its scene holder, so no record end can stop its upgrade: only
  // the scheduler can, and its abort returns the registry's reservation in that turn.
  const h = harness('auto', { hold: true });
  h.s.setChapter(em);
  await entryBatch(h, ['bg/v']);
  h.s.want(stage({ need: ['bg/v'], preview: true }));
  expect(h.upgradeCalls()).toEqual(['bg/v']);
  expect(h.registry.stats().pending).toBe(1);
  h.s.setChapter(wm);
  expect(h.registry.stats().pending).toBe(0);
  // The late answer is forgotten: the new chapter has had no swap, and the aborted upgrade swapped nothing.
  h.upgraded('bg/v');
  await micro();
  expect(h.upgradeCalls()).toEqual(['bg/v']);
  expect(h.registry.previews()).toEqual([{ id: asId('bg/v'), visible: true }]);
  // Arm 2, destroy: the same entry on a fresh scheduler.
  const d = harness('auto', { hold: true });
  d.s.setChapter(em);
  await entryBatch(d, ['bg/v']);
  d.s.want(stage({ need: ['bg/v'], preview: true }));
  expect(d.registry.stats().pending).toBe(1);
  d.s.destroy();
  expect(d.registry.stats().pending).toBe(0);
});
