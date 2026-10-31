import { expect, test } from 'vitest';

import type { ImageEntry, Result } from '../story/catalog.ts';
import type { AssetId } from '../story/staging.ts';
import { createAssetRegistry } from './registry.ts';
import type { Decoded, LoadError, LoadImage } from './registry.ts';

// ---------------------------------------------------------------------------------------------------------------
// A fake loader with deferred results: every call is recorded with its URL and signal, and every Decoded counts its
// release() calls by URL.

type Tex = { readonly url: string };
type Call = { url: string; signal: AbortSignal; resolve(r: Result<Decoded<Tex>, LoadError>): void; done: boolean };

const BG = 8_847_360; // 1080 × 2048 × 4
const PROP = 1_048_576; // 512 × 512 × 4

const asId = (s: string): AssetId => s as AssetId; // test fixture ids: the brand is earned by the manifest decoder
const image = (name: string, w: number, h: number): ImageEntry => ({
  kind: 'image',
  w,
  h,
  decodedBytes: w * h * 4,
  avif: { url: `/assets/${name}.avif`, bytes: 100 },
  webp: { url: `/assets/${name}.webp`, bytes: 120 },
});
const bg = (name: string): ImageEntry => image(name, 1080, 2048);
const prop = (name: string): ImageEntry => image(name, 512, 512);

function harness(variant: 'avif' | 'webp' = 'avif') {
  const calls: Call[] = [];
  const released = new Map<string, number>();
  const sizes = new Map<string, { w: number; h: number }>();
  const load: LoadImage<Tex> = (ref, signal) =>
    new Promise((resolve) => {
      calls.push({ url: ref.url, signal, resolve, done: false });
    });
  const registry = createAssetRegistry<Tex>({ load, variant });
  const decoded = (url: string, w: number, h: number): Decoded<Tex> => ({
    texture: { url },
    w,
    h,
    release: () => released.set(url, (released.get(url) ?? 0) + 1),
  });
  const callsOf = (url: string): Call[] => calls.filter((c) => c.url === url);
  /** Resolves a call with its manifest size (or `size`), once. */
  const succeed = (call: Call, size = sizes.get(call.url)): void => {
    if (call.done || size === undefined) {
      return;
    }
    call.done = true;
    call.resolve({ ok: true, value: decoded(call.url, size.w, size.h) });
  };
  const succeedAll = (): void => {
    for (const call of [...calls]) {
      succeed(call);
    }
  };
  /** Acquires `name` (its entry registered for the fake's decode size) and returns the pending result. */
  const acquire = (name: string, entry: ImageEntry, holder: string, priority: 'visible' | 'preload', signal?: AbortSignal) => {
    sizes.set(entry.avif.url, { w: entry.w, h: entry.h });
    sizes.set(entry.webp.url, { w: entry.w, h: entry.h });
    return registry.acquire(asId(name), holder, signal === undefined ? { entry, priority } : { entry, priority, signal });
  };
  return { registry, calls, released, callsOf, succeed, succeedAll, acquire, decoded };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const releasedOf = (released: Map<string, number>, name: string): number => released.get(`/assets/${name}.avif`) ?? 0;

// ---------------------------------------------------------------------------------------------------------------

test('registry_returns_to_baseline', async () => {
  const h = harness();
  const a = h.acquire('bg/a', bg('a'), 'scene:bg', 'visible');
  const b = h.acquire('bg/b', bg('b'), 'preload:k1', 'preload');
  const c = h.acquire('char/x/y', image('x_y', 768, 1536), 'next:ch2', 'preload');
  const a2 = h.acquire('bg/a', bg('a'), 'preload:k1', 'preload');
  h.succeedAll();
  for (const r of await Promise.all([a, b, c, a2])) {
    expect(r.ok).toBe(true);
  }
  expect(h.calls.length).toBe(3);
  expect(h.registry.stats().live).toBe(3);

  h.registry.release(asId('bg/a'), 'scene:bg');
  h.registry.release(asId('bg/a'), 'scene:bg');
  h.registry.releaseHolder('preload:');
  h.registry.releaseHolder('next:');

  expect([...h.released.values()].reduce((n, k) => n + k, 0)).toBe(3);
  expect(h.released).toEqual(
    new Map([
      ['/assets/a.avif', 1],
      ['/assets/b.avif', 1],
      ['/assets/x_y.avif', 1],
    ]),
  );
  expect(h.registry.stats()).toEqual({ live: 0, bytes: 0, pending: 0, overCap: 0 });
});

test('registry_caps', async () => {
  // (a) The room case (PUZZLES-PLAN X13): a room on stage, then three neighbour rooms preloaded before any load
  // resolves. The in-flight reservation makes the third over the steady cap at admission.
  const h = harness();
  const room = [h.acquire('bg/room0', bg('room0'), 'scene:bg', 'visible')];
  for (const p of ['p1', 'p2', 'p3', 'p4']) {
    room.push(h.acquire(`prop/${p}`, prop(p), `scene:prop:${p}`, 'visible'));
  }
  h.succeedAll();
  for (const r of await Promise.all(room)) {
    expect(r.ok).toBe(true);
  }
  expect(h.registry.stats().bytes).toBe(BG + 4 * PROP); // 13,041,664
  const a = h.acquire('bg/a', bg('a'), 'room:a', 'preload');
  expect(h.registry.stats().bytes).toBe(21_889_024);
  const b = h.acquire('bg/b', bg('b'), 'room:b', 'preload');
  expect(h.registry.stats().bytes).toBe(30_736_384);
  const c = h.acquire('bg/c', bg('c'), 'room:c', 'preload');
  h.succeedAll();
  expect(await c).toMatchObject({ ok: false, error: { kind: 'over-cap', capBytes: 33_554_432, needBytes: BG } });
  expect(h.callsOf('/assets/c.avif').length).toBe(0);
  expect((await a).ok).toBe(true);
  expect((await b).ok).toBe(true);
  expect(h.registry.stats()).toEqual({ live: 7, bytes: 30_736_384, pending: 0, overCap: 0 });

  // (b) Visible admission up to the hard cap: five backgrounds = 44,236,800 B.
  const v = harness();
  const five = ['v1', 'v2', 'v3', 'v4', 'v5'].map((n) => v.acquire(`bg/${n}`, bg(n), `scene:${n}`, 'visible'));
  v.succeedAll();
  for (const r of await Promise.all(five)) {
    expect(r.ok).toBe(true);
  }
  expect(v.registry.stats().bytes).toBe(5 * BG);

  // (c) Over the hard cap, a visible load first evicts every preload-priority holder, then fits.
  const e = harness();
  const pre = e.acquire('bg/p', bg('p'), 'preload:k1', 'preload');
  const four = ['v1', 'v2', 'v3', 'v4'].map((n) => e.acquire(`bg/${n}`, bg(n), `scene:${n}`, 'visible'));
  e.succeedAll();
  expect((await pre).ok).toBe(true);
  for (const r of await Promise.all(four)) {
    expect(r.ok).toBe(true);
  }
  // Joining a resident entry costs no bytes and is never refused, even above the steady cap.
  const join = e.acquire('bg/v1', bg('v1'), 'preload:k2', 'preload');
  expect((await join).ok).toBe(true);
  expect(e.calls.length).toBe(5);
  expect(e.registry.stats().bytes).toBe(5 * BG);
  const fifth = e.acquire('bg/v5', bg('v5'), 'scene:v5', 'visible');
  e.succeedAll();
  expect((await fifth).ok).toBe(true);
  expect(releasedOf(e.released, 'p')).toBe(1);
  expect(releasedOf(e.released, 'v1')).toBe(0);
  expect(e.registry.stats()).toEqual({ live: 5, bytes: 5 * BG, pending: 0, overCap: 0 });
});

test('registry: visible load over hard cap after eviction is refused', async () => {
  const h = harness();
  const p1 = h.acquire('prop/p1', prop('p1'), 'preload:k1', 'preload');
  const vs = ['v1', 'v2', 'v3', 'v4', 'v5'].map((n) => h.acquire(`bg/${n}`, bg(n), `scene:${n}`, 'visible'));
  h.succeedAll();
  expect((await p1).ok).toBe(true);
  for (const r of await Promise.all(vs)) {
    expect(r.ok).toBe(true);
  }
  expect(h.registry.stats().bytes).toBe(45_285_376);
  // 45,285,376 + 8,847,360 = 54,132,736 > 50,331,648; evicting p1 leaves 53,084,160, still over.
  const v6 = h.acquire('bg/v6', bg('v6'), 'scene:v6', 'visible');
  h.succeedAll();
  expect(await v6).toMatchObject({ ok: false, error: { kind: 'over-cap', capBytes: 50_331_648, liveBytes: 5 * BG } });
  expect(h.registry.stats().bytes).toBe(44_236_800);
  expect(h.registry.stats().overCap).toBe(1);
  expect(releasedOf(h.released, 'p1')).toBe(1);
  expect(h.callsOf('/assets/v6.avif').length).toBe(0);
});

test('registry: releaseHolder of preload:k1 keeps preload:k10', async () => {
  const h = harness();
  const k1 = h.acquire('bg/k1', bg('k1'), 'preload:k1', 'preload');
  const k10 = h.acquire('bg/k10', bg('k10'), 'preload:k10', 'preload');
  h.succeedAll();
  expect((await k1).ok).toBe(true);
  expect((await k10).ok).toBe(true);
  h.registry.releaseHolder('preload:k1');
  expect(h.registry.stats().live).toBe(1);
  expect(releasedOf(h.released, 'k1')).toBe(1);
  expect(releasedOf(h.released, 'k10')).toBe(0);
  h.registry.releaseHolder('preload:');
  expect(releasedOf(h.released, 'k10')).toBe(1);
});

test('registry: image over 2048 px or off its manifest size is refused', async () => {
  const h = harness();
  const wide = h.acquire('bg/wide', image('wide', 4096, 1024), 'scene:bg', 'visible');
  h.succeedAll();
  expect(await wide).toMatchObject({ ok: false, error: { kind: 'too-large', w: 4096, h: 1024 } });
  expect(h.callsOf('/assets/wide.avif').length).toBe(0);

  // The manifest says 512×512, the file decodes 1080×2048: the caps counted the wrong bytes.
  const lying = h.registry.acquire(asId('prop/lie'), 'scene:prop:lie', { entry: prop('lie'), priority: 'visible' });
  const call = h.callsOf('/assets/lie.avif')[0];
  expect(call).toBeDefined();
  if (call !== undefined) {
    h.succeed(call, { w: 1080, h: 2048 });
  }
  expect(await lying).toMatchObject({ ok: false, error: { kind: 'decode' } });
  expect(releasedOf(h.released, 'lie')).toBe(1);
  expect(h.registry.stats()).toEqual({ live: 0, bytes: 0, pending: 0, overCap: 0 });
});

test('registry: variant follows the avif probe', async () => {
  const webp = harness('webp');
  const w = webp.acquire('bg/x', bg('x'), 'scene:bg', 'visible');
  expect(webp.calls.map((c) => c.url)).toEqual(['/assets/x.webp']);
  webp.succeedAll();
  expect((await w).ok).toBe(true);

  const avif = harness('avif');
  const a = avif.acquire('bg/x', bg('x'), 'scene:bg', 'visible');
  expect(avif.calls.map((c) => c.url)).toEqual(['/assets/x.avif']);
  avif.succeedAll();
  expect((await a).ok).toBe(true);
});

test('registry: abort frees the reservation', async () => {
  const h = harness();
  const ctl = new AbortController();
  const pending = h.acquire('bg/a', bg('a'), 'scene:bg', 'visible', ctl.signal);
  expect(h.registry.stats()).toEqual({ live: 0, bytes: BG, pending: 1, overCap: 0 });
  ctl.abort();
  // The loader resolves anyway, late: that texture is destroyed at once and nothing is counted.
  h.succeedAll();
  await flush();
  expect(h.registry.stats().bytes).toBe(0);
  expect(h.registry.stats().pending).toBe(0);
  expect(h.registry.stats().live).toBe(0);
  expect(await pending).toMatchObject({ ok: false, error: { kind: 'aborted' } });
  expect(h.calls[0]?.signal.aborted).toBe(true);
  expect(releasedOf(h.released, 'a')).toBe(1);
});

test('registry: a late settle acts only on its own load', async () => {
  for (const late of ['aborted', 'decoded'] as const) {
    const h = harness();
    // L1 under holder A, released while in flight (aborted); then L2 for the same id under holder B.
    const first = h.acquire('bg/x', bg('x'), 'preload:k1', 'preload');
    h.registry.release(asId('bg/x'), 'preload:k1');
    const second = h.acquire('bg/x', bg('x'), 'preload:k3', 'preload');
    expect(h.calls.length).toBe(2);
    const [l1, l2] = h.calls;
    expect(l1?.signal.aborted).toBe(true);
    expect(h.registry.stats()).toEqual({ live: 0, bytes: BG, pending: 1, overCap: 0 });

    // L1 settles late: as the real FetchAsset reports an aborted fetch, or as a decode the loader finished anyway.
    if (late === 'aborted') {
      l1?.resolve({ ok: false, error: { kind: 'aborted' } });
    } else if (l1 !== undefined) {
      h.succeed(l1);
    }
    await flush();
    expect(h.registry.stats()).toEqual({ live: 0, bytes: BG, pending: 1, overCap: 0 });
    expect(await first).toMatchObject({ ok: false, error: { kind: 'aborted' } });

    if (l2 !== undefined) {
      h.succeed(l2);
    }
    const got = await second;
    expect(got.ok).toBe(true);
    expect(h.registry.stats()).toEqual({ live: 1, bytes: BG, pending: 0, overCap: 0 });
    expect(releasedOf(h.released, 'x')).toBe(late === 'decoded' ? 1 : 0);
    h.registry.releaseHolder('preload:');
    expect(releasedOf(h.released, 'x')).toBe(late === 'decoded' ? 2 : 1);
    expect(h.registry.stats()).toEqual({ live: 0, bytes: 0, pending: 0, overCap: 0 });
  }
});
