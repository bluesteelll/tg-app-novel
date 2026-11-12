import { expect, test } from 'vitest';

import type { AssetEntry, AssetManifest, ImageEntry, Result } from '../story/catalog.ts';
import type { AssetId, ChapterId } from '../story/staging.ts';
import { PRELOAD_IN_FLIGHT, createAssetScheduler } from './preload.ts';
import { HARD_CAP_BYTES, createAssetRegistry } from './registry.ts';
import type { AssetError, Decoded, LoadError, LoadImage } from './registry.ts';

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

function harness(mode: 'auto' | 'deferred' = 'auto') {
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
  const registry = createAssetRegistry<Tex>({ load, variant: 'avif', tier: 'full' });
  const errors: AssetError[] = [];
  const s = createAssetScheduler({
    registry,
    onError: (e) => {
      errors.push(e);
    },
  });
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
