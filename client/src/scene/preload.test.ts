import { expect, test } from 'vitest';

import type { AssetEntry, AssetManifest, ImageEntry, Result } from '../story/catalog.ts';
import type { AssetId, ChapterId } from '../story/staging.ts';
import { PRELOAD_IN_FLIGHT, createAssetScheduler } from './preload.ts';
import { createAssetRegistry } from './registry.ts';
import type { AssetError, Decoded, LoadError, LoadImage } from './registry.ts';

// ---------------------------------------------------------------------------------------------------------------
// Two chapter manifests over the real registry. The fake loader records every call (URL, signal) and decodes at once,
// or on demand when deferred; every Decoded counts its release() calls by URL.

type Tex = { readonly url: string };
type Call = { url: string; signal: AbortSignal; resolve(r: Result<Decoded<Tex>, LoadError>): void; done: boolean };

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
const URLS = new Map<string, ImageEntry>();
for (const m of [ch1, ch2, ch3]) {
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
  const decoded = (url: string): Decoded<Tex> | null => {
    const e = URLS.get(url);
    return e === undefined
      ? null
      : { texture: { url }, w: e.w, h: e.h, release: () => released.set(url, (released.get(url) ?? 0) + 1) };
  };
  const succeed = (call: Call): void => {
    const d = decoded(call.url);
    if (!call.done && d !== null) {
      call.done = true;
      call.resolve({ ok: true, value: d });
    }
  };
  const load: LoadImage<Tex> = (ref, signal) =>
    new Promise((resolve) => {
      const call: Call = { url: ref.url, signal, resolve, done: false };
      calls.push(call);
      if (mode === 'auto') {
        succeed(call);
      }
    });
  const registry = createAssetRegistry<Tex>({ load, variant: 'avif' });
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
  expect(h.registry.stats()).toEqual({ live: 0, bytes: 0, pending: 0, overCap: 0 });
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
  expect(h.registry.stats()).toEqual({ live: 0, bytes: 0, pending: 0, overCap: 0 });
});
