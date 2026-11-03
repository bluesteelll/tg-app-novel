import { expect, test, vi } from 'vitest';

import type { HalfFile, ImageEntry, Result, SizeTier, Trim } from '../story/catalog.ts';
import type { AssetId } from '../story/staging.ts';
import type { TextureGeometry } from './layout.ts';
import { createAssetRegistry } from './registry.ts';
import type { Decoded, LoadError, LoadImage } from './registry.ts';

// ---------------------------------------------------------------------------------------------------------------
// A fake loader with deferred results: every call is recorded with its URL, file bytes, signal and geometry, and every
// Decoded counts its release() calls by URL. Byte-faithful (MEMORY-PLAN M2): a Decoded keeps the bytes of the file it
// was called with, as the real loader keeps the fetched Blob, reports the harness's GPU generation when its load settles
// (1 unless a test raises it), and records every revive, which succeeds at once unless the test holds them.

type Tex = { readonly url: string };
type Call = {
  url: string;
  bytes: number;
  signal: AbortSignal;
  geometry: TextureGeometry;
  resolve(r: Result<Decoded<Tex>, LoadError>): void;
  done: boolean;
};
type Revive = { url: string; gen: number; signal: AbortSignal; settle(r: Result<void, LoadError>): void; done: boolean };

const BG = 8_847_360; // 1080 × 2048 × 4
const PROP = 1_048_576; // 512 × 512 × 4
/** The AVIF fixture file: what each record keeps once live and reserves while in flight (M2). */
const F = 100;

const asId = (s: string): AssetId => s as AssetId; // test fixture ids: the brand is earned by the manifest decoder
const image = (name: string, w: number, h: number, trim?: Trim): ImageEntry => ({
  kind: 'image',
  w,
  h,
  decodedBytes: w * h * 4,
  avif: { url: `/assets/${name}.avif`, bytes: 100 },
  webp: { url: `/assets/${name}.webp`, bytes: 120 },
  ...(trim === undefined ? {} : { trim }),
});
const bg = (name: string): ImageEntry => image(name, 1080, 2048);
const prop = (name: string): ImageEntry => image(name, 512, 512);

function harness(variant: 'avif' | 'webp' = 'avif', tier: SizeTier = 'full') {
  const calls: Call[] = [];
  const revives: Revive[] = [];
  const released = new Map<string, number>();
  /** The generation a load that settles now was uploaded under (the controller's, MEMORY-PLAN 4.A). */
  let gen = 1;
  let reviveMode: 'auto' | 'hold' = 'auto';
  const sizes = new Map<string, { w: number; h: number }>();
  const load: LoadImage<Tex> = (ref, signal, geometry) =>
    new Promise((resolve) => {
      calls.push({ url: ref.url, bytes: ref.bytes, signal, geometry, resolve, done: false });
    });
  const registry = createAssetRegistry<Tex>({ load, variant, tier });
  const decoded = (url: string, w: number, h: number, keptBytes: number): Decoded<Tex> => {
    const d: Decoded<Tex> = {
      texture: { url },
      w,
      h,
      keptBytes,
      gen,
      open: () => false,
      revive: (to, signal) =>
        new Promise((resolve) => {
          const r: Revive = {
            url,
            gen: to,
            signal,
            done: false,
            settle(result) {
              if (r.done) {
                return;
              }
              r.done = true;
              // As the loader: a revive that settles after its abort uploads nothing.
              if (result.ok && !signal.aborted) {
                d.gen = to;
              }
              resolve(result);
            },
          };
          revives.push(r);
          if (reviveMode === 'auto') {
            r.settle({ ok: true, value: undefined });
          }
        }),
      release: () => released.set(url, (released.get(url) ?? 0) + 1),
    };
    return d;
  };
  const callsOf = (url: string): Call[] => calls.filter((c) => c.url === url);
  /** Resolves a call with its manifest size (or `size`) and its file's bytes kept (or `kept`), once. */
  const succeed = (call: Call, size = sizes.get(call.url), kept = call.bytes): void => {
    if (call.done || size === undefined) {
      return;
    }
    call.done = true;
    call.resolve({ ok: true, value: decoded(call.url, size.w, size.h, kept) });
  };
  const succeedAll = (): void => {
    for (const call of [...calls]) {
      succeed(call);
    }
  };
  /** Acquires `name` (its entry, and its half's, registered for the fake's decode size) and returns the pending result. */
  const acquire = (name: string, entry: ImageEntry, holder: string, priority: 'visible' | 'preload', signal?: AbortSignal) => {
    for (const f of entry.half === undefined ? [entry] : [entry, entry.half]) {
      sizes.set(f.avif.url, { w: f.w, h: f.h });
      sizes.set(f.webp.url, { w: f.w, h: f.h });
    }
    return registry.acquire(asId(name), holder, signal === undefined ? { entry, priority } : { entry, priority, signal });
  };
  /** Settles every held revive so far with `r`; returns how many. */
  const settleRevives = (r: Result<void, LoadError> = { ok: true, value: undefined }): number => {
    const open = revives.filter((x) => !x.done);
    for (const x of open) {
      x.settle(r);
    }
    return open.length;
  };
  return {
    registry,
    calls,
    revives,
    released,
    callsOf,
    succeed,
    succeedAll,
    acquire,
    decoded,
    settleRevives,
    setGen: (g: number): void => {
      gen = g;
    },
    setReviveMode: (m: 'auto' | 'hold'): void => {
      reviveMode = m;
    },
  };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const releasedOf = (released: Map<string, number>, name: string): number => released.get(`/assets/${name}.avif`) ?? 0;
const noAbort = (): AbortSignal => new AbortController().signal;
/** What a promise settled with so far (null: not yet), read without awaiting it. */
function seen<V>(p: Promise<V>): { value: V | null } {
  const s: { value: V | null } = { value: null };
  void p.then((v) => {
    s.value = v;
  });
  return s;
}
const ZERO = { live: 0, bytes: 0, pending: 0, overCap: 0, keptBytes: 0, keptMismatch: 0, openBitmaps: 0, stale: 0, reviveFailed: 0 };
const FAILED: Result<void, LoadError> = { ok: false, error: { kind: 'decode', detail: 'corrupt file' } };

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
  expect(h.registry.stats()).toEqual({ live: 0, bytes: 0, pending: 0, overCap: 0, keptBytes: 0, keptMismatch: 0, openBitmaps: 0, stale: 0, reviveFailed: 0 });
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
  expect(h.registry.stats().bytes).toBe(BG + 4 * PROP + 5 * F); // 13,042,164
  const a = h.acquire('bg/a', bg('a'), 'room:a', 'preload');
  expect(h.registry.stats().bytes).toBe(21_889_624);
  const b = h.acquire('bg/b', bg('b'), 'room:b', 'preload');
  expect(h.registry.stats().bytes).toBe(30_737_084);
  const c = h.acquire('bg/c', bg('c'), 'room:c', 'preload');
  h.succeedAll();
  expect(await c).toMatchObject({ ok: false, error: { kind: 'over-cap', capBytes: 33_554_432, needBytes: BG + F } });
  expect(h.callsOf('/assets/c.avif').length).toBe(0);
  expect((await a).ok).toBe(true);
  expect((await b).ok).toBe(true);
  expect(h.registry.stats()).toEqual({ live: 7, bytes: 30_737_084, pending: 0, overCap: 0, keptBytes: 7 * F, keptMismatch: 0, openBitmaps: 0, stale: 0, reviveFailed: 0 });

  // (b) Visible admission up to the hard cap: five backgrounds and their files = 44,237,300 B.
  const v = harness();
  const five = ['v1', 'v2', 'v3', 'v4', 'v5'].map((n) => v.acquire(`bg/${n}`, bg(n), `scene:${n}`, 'visible'));
  v.succeedAll();
  for (const r of await Promise.all(five)) {
    expect(r.ok).toBe(true);
  }
  expect(v.registry.stats().bytes).toBe(44_237_300);

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
  expect(e.registry.stats().bytes).toBe(44_237_300);
  const fifth = e.acquire('bg/v5', bg('v5'), 'scene:v5', 'visible');
  e.succeedAll();
  expect((await fifth).ok).toBe(true);
  expect(releasedOf(e.released, 'p')).toBe(1);
  expect(releasedOf(e.released, 'v1')).toBe(0);
  expect(e.registry.stats()).toEqual({ live: 5, bytes: 44_237_300, pending: 0, overCap: 0, keptBytes: 5 * F, keptMismatch: 0, openBitmaps: 0, stale: 0, reviveFailed: 0 });
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
  expect(h.registry.stats().bytes).toBe(45_285_976);
  // 45,285,976 + 8,847,460 = 54,133,436 > 50,331,648; evicting p1 leaves 53,084,760, still over.
  const v6 = h.acquire('bg/v6', bg('v6'), 'scene:v6', 'visible');
  h.succeedAll();
  expect(await v6).toMatchObject({ ok: false, error: { kind: 'over-cap', capBytes: 50_331_648, liveBytes: 44_237_300 } });
  expect(h.registry.stats().bytes).toBe(44_237_300);
  expect(h.registry.stats().overCap).toBe(1);
  expect(releasedOf(h.released, 'p1')).toBe(1);
  expect(h.callsOf('/assets/v6.avif').length).toBe(0);
});

test('registry: a visible load over the hard cap evicts room and next preloads', async () => {
  // Eviction goes by priority, not by holder name: preload.ts takes `room:*` and `next:*` at preload priority too.
  for (const holder of ['room:a', 'next:ch2']) {
    const h = harness();
    const pre = h.acquire('bg/r', bg('r'), holder, 'preload');
    const four = ['v1', 'v2', 'v3', 'v4'].map((n) => h.acquire(`bg/${n}`, bg(n), `scene:${n}`, 'visible'));
    h.succeedAll();
    expect((await pre).ok).toBe(true);
    for (const r of await Promise.all(four)) {
      expect(r.ok).toBe(true);
    }
    // 5 BG live = 44,237,300; a fifth visible BG needs 53,084,760 > 50,331,648 unless the preload goes.
    const fifth = h.acquire('bg/v5', bg('v5'), 'scene:v5', 'visible');
    h.succeedAll();
    expect({ holder, ok: (await fifth).ok }).toEqual({ holder, ok: true });
    expect(releasedOf(h.released, 'r')).toBe(1);
    expect(h.registry.stats()).toEqual({ live: 5, bytes: 44_237_300, pending: 0, overCap: 0, keptBytes: 5 * F, keptMismatch: 0, openBitmaps: 0, stale: 0, reviveFailed: 0 });
  }
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
  expect(h.registry.stats()).toEqual({ live: 0, bytes: 0, pending: 0, overCap: 0, keptBytes: 0, keptMismatch: 0, openBitmaps: 0, stale: 0, reviveFailed: 0 });
});

// MEMORY-PLAN 4.B: the placeholder sprite's alpha box, stored 466×1394, at (151, 142) on its 768×1536 canvas.
const ALLY_TRIM: Trim = { canvasW: 768, canvasH: 1536, x: 151, y: 142 };

test("registry: a trimmed entry's handle reports its canvas", async () => {
  // charPlacement sizes a character on the canvas (RULINGS 35): the handle reports it, the caps count stored px.
  const h = harness();
  const got = h.acquire('char/ally/neutral', image('ally_neutral', 466, 1394, ALLY_TRIM), 'scene:char:ally', 'visible');
  h.succeedAll();
  const r = await got;
  if (!r.ok) {
    throw new Error(`invariant: the stored-size decode succeeds: ${JSON.stringify(r.error)}`);
  }
  expect(r.value.h).toBe(1536);
  expect(r.value.w).toBe(768);
  expect(h.registry.stats()).toEqual({ live: 1, bytes: 466 * 1394 * 4 + F, pending: 0, overCap: 0, keptBytes: F, keptMismatch: 0, openBitmaps: 0, stale: 0, reviveFailed: 0 });
});

test("registry: load receives the entry's geometry", async () => {
  const h = harness();
  const ally = h.acquire('char/ally/neutral', image('ally_neutral', 466, 1394, ALLY_TRIM), 'scene:char:ally', 'visible');
  const street = h.acquire('bg/street', bg('street'), 'scene:bg', 'visible');
  expect(h.callsOf('/assets/ally_neutral.avif')[0]?.geometry).toEqual({
    canvas: { w: 768, h: 1536 },
    orig: { x: 0, y: 0, w: 768, h: 1536 },
    trim: { x: 151, y: 142, w: 466, h: 1394 },
    resolution: 1,
  });
  expect(h.callsOf('/assets/street.avif')[0]?.geometry).toEqual({
    canvas: { w: 1080, h: 2048 },
    orig: { x: 0, y: 0, w: 1080, h: 2048 },
    trim: null,
    resolution: 1,
  });
  h.succeedAll();
  expect((await ally).ok && (await street).ok).toBe(true);
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
  expect(h.registry.stats()).toEqual({ live: 0, bytes: 8_847_460, pending: 1, overCap: 0, keptBytes: 0, keptMismatch: 0, openBitmaps: 0, stale: 0, reviveFailed: 0 });
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
    expect(h.registry.stats()).toEqual({ live: 0, bytes: 8_847_460, pending: 1, overCap: 0, keptBytes: 0, keptMismatch: 0, openBitmaps: 0, stale: 0, reviveFailed: 0 });

    // L1 settles late: as the real FetchAsset reports an aborted fetch, or as a decode the loader finished anyway.
    if (late === 'aborted') {
      l1?.resolve({ ok: false, error: { kind: 'aborted' } });
    } else if (l1 !== undefined) {
      h.succeed(l1);
    }
    await flush();
    expect(h.registry.stats()).toEqual({ live: 0, bytes: 8_847_460, pending: 1, overCap: 0, keptBytes: 0, keptMismatch: 0, openBitmaps: 0, stale: 0, reviveFailed: 0 });
    expect(await first).toMatchObject({ ok: false, error: { kind: 'aborted' } });

    if (l2 !== undefined) {
      h.succeed(l2);
    }
    const got = await second;
    expect(got.ok).toBe(true);
    expect(h.registry.stats()).toEqual({ live: 1, bytes: 8_847_460, pending: 0, overCap: 0, keptBytes: F, keptMismatch: 0, openBitmaps: 0, stale: 0, reviveFailed: 0 });
    expect(releasedOf(h.released, 'x')).toBe(late === 'decoded' ? 1 : 0);
    h.registry.releaseHolder('preload:');
    expect(releasedOf(h.released, 'x')).toBe(late === 'decoded' ? 2 : 1);
    expect(h.registry.stats()).toEqual({ live: 0, bytes: 0, pending: 0, overCap: 0, keptBytes: 0, keptMismatch: 0, openBitmaps: 0, stale: 0, reviveFailed: 0 });
  }
});

test('registry_caps_count_kept_bytes', async () => {
  // MEMORY-PLAN M2 commit 2: admission reserves decoded + file bytes. The registry counts the manifest's decodedBytes
  // as given, so one entry carries the whole 32 MiB - 100 B here.
  const atCap = (file: number): ImageEntry => ({ ...image('big', 2048, 2048), decodedBytes: 33_554_432 - 100, avif: { url: '/assets/big.avif', bytes: file } });
  const over = harness();
  const refused = over.acquire('bg/big', atCap(200), 'preload:k1', 'preload');
  over.succeedAll();
  expect(await refused).toMatchObject({ ok: false, error: { kind: 'over-cap', capBytes: 33_554_432, needBytes: 33_554_532, liveBytes: 0 } });
  expect(over.calls.length).toBe(0);
  // Control: decoded + file exactly at the steady cap is admitted.
  const fits = harness();
  const got = fits.acquire('bg/big', atCap(100), 'preload:k1', 'preload');
  expect(fits.registry.stats().bytes).toBe(33_554_432);
  fits.succeedAll();
  expect((await got).ok).toBe(true);
});

test('registry: a kept blob is counted at its real size', async () => {
  // The admission reserves the manifest's file bytes; once live the record counts what the loader kept. A host that
  // rewrote the file (another size) is counted as it is and reported, never refused (MEMORY-PLAN 4.A, critique O8).
  const h = harness();
  const got = h.acquire('bg/a', bg('a'), 'scene:bg', 'visible');
  const call = h.callsOf('/assets/a.avif')[0];
  if (call === undefined) {
    throw new Error('invariant: the acquire started a load');
  }
  h.succeed(call, undefined, 300);
  expect((await got).ok).toBe(true);
  expect(h.registry.stats()).toEqual({ live: 1, bytes: BG + 300, pending: 0, overCap: 0, keptBytes: 300, keptMismatch: 1, openBitmaps: 0, stale: 0, reviveFailed: 0 });
  h.registry.release(asId('bg/a'), 'scene:bg');
  expect(h.registry.stats()).toEqual({ live: 0, bytes: 0, pending: 0, overCap: 0, keptBytes: 0, keptMismatch: 1, openBitmaps: 0, stale: 0, reviveFailed: 0 });
});

// ---------------------------------------------------------------------------------------------------------------
// MEMORY-PLAN M2 commit 3: the revive (4.A, section 8 A2, "Revive failure", "Identity rule").

/** Acquires each `bg/<name>` under `scene:<name>` (visible) and lets every load settle; returns the handles. */
async function liveBgs(h: ReturnType<typeof harness>, names: readonly string[], priority: 'visible' | 'preload' = 'visible') {
  const got = names.map((n) => h.acquire(`bg/${n}`, bg(n), priority === 'visible' ? `scene:${n}` : `preload:${n}`, priority));
  h.succeedAll();
  const out = [];
  for (const r of await Promise.all(got)) {
    if (!r.ok) {
      throw new Error(`invariant: the fixture loads: ${JSON.stringify(r.error)}`);
    }
    out.push(r.value);
  }
  return out;
}
const urlsOf = (revives: readonly Revive[]): string[] => revives.map((r) => `${r.url}@${r.gen}`);

test('registry: revive brings every record of an older generation once', async () => {
  const h = harness();
  await liveBgs(h, ['a', 'b', 'c']);
  expect(h.registry.stats().stale).toBe(0);
  const r = h.registry.revive(2, noAbort());
  expect(await r.visible).toBe('done');
  expect(await r.all).toBe('done');
  expect(urlsOf(h.revives)).toEqual(['/assets/a.avif@2', '/assets/b.avif@2', '/assets/c.avif@2']);
  expect(h.registry.stats()).toEqual({ ...ZERO, live: 3, bytes: 3 * (BG + F), keptBytes: 3 * F });
  // A second revive to the same generation finds nothing stale.
  expect(await h.registry.revive(2, noAbort()).all).toBe('done');
  expect(h.revives.length).toBe(3);
});

test('registry: revive skips a record uploaded under the current generation', async () => {
  const h = harness();
  await liveBgs(h, ['old']);
  h.setGen(2); // the next load uploads under the restored context's generation
  await liveBgs(h, ['new']);
  expect(await h.registry.revive(2, noAbort()).all).toBe('done');
  expect(h.revives.filter((r) => r.url === '/assets/new.avif').length).toBe(0);
  expect(urlsOf(h.revives)).toEqual(['/assets/old.avif@2']);
  expect(h.registry.stats().stale).toBe(0);
});

test('registry: revive serves visible holders first', async () => {
  const h = harness();
  // The preload-only record is inserted first.
  await liveBgs(h, ['p'], 'preload');
  await liveBgs(h, ['v']);
  h.setReviveMode('hold');
  const r = h.registry.revive(2, noAbort());
  const visible = seen(r.visible);
  const all = seen(r.all);
  await flush();
  // One at a time: the visible record first, the preload-only record only after the visible pass.
  expect(urlsOf(h.revives)).toEqual(['/assets/v.avif@2']);
  h.settleRevives();
  await flush();
  expect(visible.value).toBe('done');
  expect(all.value).toBe(null);
  expect(urlsOf(h.revives)).toEqual(['/assets/v.avif@2', '/assets/p.avif@2']);
  h.settleRevives();
  await flush();
  expect(all.value).toBe('done');
});

test('registry: acquire on a record not yet revived waits for it', async () => {
  const h = harness();
  const [, , z] = await liveBgs(h, ['x', 'y', 'z']);
  h.setReviveMode('hold');
  void h.registry.revive(2, noAbort());
  await flush();
  expect(urlsOf(h.revives)).toEqual(['/assets/x.avif@2']);
  const join = seen(h.acquire('bg/z', bg('z'), 'preload:k1', 'preload'));
  await flush();
  expect(join.value).toBe(null);
  h.settleRevives();
  await flush();
  // The record an acquire waits on moves to the front: z before y.
  expect(urlsOf(h.revives)).toEqual(['/assets/x.avif@2', '/assets/z.avif@2']);
  expect(join.value).toBe(null);
  h.settleRevives();
  await flush();
  expect(join.value).toEqual({ ok: true, value: z });
  expect(join.value?.ok === true ? join.value.value : null).toBe(z);
});

test('registry: a failed revive ends the record and fails its waiting acquire', async () => {
  const h = harness();
  await liveBgs(h, ['a']);
  h.setReviveMode('hold');
  const r = h.registry.revive(2, noAbort());
  await flush();
  const waiting = h.acquire('bg/a', bg('a'), 'preload:k1', 'preload');
  h.settleRevives(FAILED);
  expect(await waiting).toMatchObject({ ok: false, error: { kind: 'decode', id: 'bg/a', detail: 'corrupt file' } });
  expect(await r.visible).toBe('done');
  expect(await r.all).toBe('done');
  // Out of the map whatever its holders: its texture destroyed, its kept file dropped.
  expect(h.registry.current(asId('bg/a'))).toBe(null);
  expect(releasedOf(h.released, 'a')).toBe(1);
  expect(h.registry.stats()).toEqual({ ...ZERO, reviveFailed: 1 });
});

test('registry: a revive that misses its deadline ends the record', async () => {
  vi.useFakeTimers();
  try {
    const h = harness();
    await liveBgs(h, ['p'], 'preload');
    await liveBgs(h, ['v']);
    h.setReviveMode('hold'); // a re-decode that never settles
    const r = h.registry.revive(2, noAbort());
    const visible = seen(r.visible);
    const all = seen(r.all);
    // Literal advances pin REVIVE_DEADLINE_MS at 3000 (MEMORY-PLAN 4.A: 6 x the 500 ms visible-revive threshold); a
    // move of the value is a declared pin move here.
    await vi.advanceTimersByTimeAsync(2999);
    expect(visible.value).toBe(null);
    expect(h.registry.current(asId('bg/v'))).not.toBe(null);
    await vi.advanceTimersByTimeAsync(1);
    expect(visible.value).toBe('done');
    expect(h.registry.current(asId('bg/v'))).toBe(null);
    expect(h.revives[0]?.signal.aborted).toBe(true);
    expect(releasedOf(h.released, 'v')).toBe(1);
    // The background record's deadline counts from its own start, at the end of the visible pass.
    expect(urlsOf(h.revives)).toEqual(['/assets/v.avif@2', '/assets/p.avif@2']);
    await vi.advanceTimersByTimeAsync(2999);
    expect(all.value).toBe(null);
    await vi.advanceTimersByTimeAsync(1);
    expect(all.value).toBe('done');
    expect(h.registry.stats()).toEqual({ ...ZERO, reviveFailed: 2 });
  } finally {
    vi.useRealTimers();
  }
});

test('registry: the visible pass has one deadline counted from its start', async () => {
  vi.useFakeTimers();
  try {
    const h = harness();
    await liveBgs(h, ['a', 'b', 'c']);
    h.setReviveMode('hold');
    const r = h.registry.revive(2, noAbort());
    const visible = seen(r.visible);
    await vi.advanceTimersByTimeAsync(2000);
    expect(urlsOf(h.revives)).toEqual(['/assets/a.avif@2']);
    h.settleRevives(); // a is revived 2000 ms into the pass
    await vi.advanceTimersByTimeAsync(0);
    expect(urlsOf(h.revives)).toEqual(['/assets/a.avif@2', '/assets/b.avif@2']);
    await vi.advanceTimersByTimeAsync(999); // 2999 ms from the start of the pass
    expect(visible.value).toBe(null);
    await vi.advanceTimersByTimeAsync(1); // 3000 ms: the pass deadline, not b's own 3000 ms from 2000
    expect(visible.value).toBe('done');
    expect(h.registry.current(asId('bg/a'))).not.toBe(null);
    expect(h.registry.current(asId('bg/b'))).toBe(null);
    expect(h.registry.current(asId('bg/c'))).toBe(null);
    // c, reached after the expiry, is ended without a decode started for it (MEMORY-PLAN 4.A: one at a time).
    expect(urlsOf(h.revives)).toEqual(['/assets/a.avif@2', '/assets/b.avif@2']);
    expect(h.registry.stats().reviveFailed).toBe(2);
  } finally {
    vi.useRealTimers();
  }
});

test('registry: an acquire after a failed revive starts a new record', async () => {
  const h = harness();
  const [first] = await liveBgs(h, ['a']);
  h.setReviveMode('hold');
  const r = h.registry.revive(2, noAbort());
  await flush();
  h.settleRevives(FAILED);
  expect(await r.visible).toBe('done');
  const again = h.acquire('bg/a', bg('a'), 'scene:a', 'visible');
  expect(h.callsOf('/assets/a.avif').length).toBe(2);
  h.succeedAll();
  const got = await again;
  if (!got.ok) {
    throw new Error(`invariant: the new record loads: ${JSON.stringify(got.error)}`);
  }
  expect(got.value).not.toBe(first);
  expect(h.registry.current(asId('bg/a'))).toBe(got.value);
});

test('registry: an aborted revive fails no record', async () => {
  // `deactivated`: the revive is aborted through its signal; the records stay stale for the next one.
  const h = harness();
  const [a] = await liveBgs(h, ['a', 'b']);
  h.setReviveMode('hold');
  const ctl = new AbortController();
  const r = h.registry.revive(2, ctl.signal);
  await flush();
  expect(h.revives.length).toBe(1);
  ctl.abort();
  expect(h.revives[0]?.signal.aborted).toBe(true);
  // The loader answers its own abort.
  h.settleRevives({ ok: false, error: { kind: 'aborted' } });
  expect(await r.visible).toBe('aborted');
  expect(await r.all).toBe('aborted');
  await flush();
  expect(h.registry.stats()).toEqual({ ...ZERO, live: 2, bytes: 2 * (BG + F), keptBytes: 2 * F, stale: 2 });
  expect(h.registry.current(asId('bg/a'))).toBe(a);
  expect(releasedOf(h.released, 'a')).toBe(0);
  // `activated`: a new revive under the same generation brings both.
  h.setReviveMode('auto');
  expect(await h.registry.revive(2, noAbort()).all).toBe('done');
  expect(h.registry.stats()).toMatchObject({ live: 2, stale: 0, reviveFailed: 0 });
});

test('registry: revive ignores an entry released mid-revive', async () => {
  for (const late of [{ ok: true, value: undefined }, FAILED] as const) {
    const h = harness();
    await liveBgs(h, ['a']);
    h.setReviveMode('hold');
    const r = h.registry.revive(2, noAbort());
    await flush();
    h.registry.release(asId('bg/a'), 'scene:a');
    expect(releasedOf(h.released, 'a')).toBe(1);
    // The revive settles after the release: it acts on nothing.
    h.settleRevives(late);
    expect(await r.visible).toBe('done');
    expect(await r.all).toBe('done');
    expect(releasedOf(h.released, 'a')).toBe(1);
    expect(h.registry.stats()).toEqual(ZERO);
  }
});

test("registry: current names a live record's handle and nothing else", async () => {
  const h = harness();
  const pending = h.acquire('bg/a', bg('a'), 'scene:a', 'visible');
  expect(h.registry.current(asId('bg/a'))).toBe(null);
  h.succeedAll();
  const first = await pending;
  if (!first.ok) {
    throw new Error('invariant: the fixture loads');
  }
  expect(h.registry.current(asId('bg/a'))).toBe(first.value);
  h.registry.release(asId('bg/a'), 'scene:a');
  expect(h.registry.current(asId('bg/a'))).toBe(null);
  // A later record of the id has another handle.
  const [second] = await liveBgs(h, ['a']);
  expect(second).not.toBe(first.value);
  expect(h.registry.current(asId('bg/a'))).toBe(second);
  // A failed revive ends it: nothing is current.
  h.setReviveMode('hold');
  const r = h.registry.revive(2, noAbort());
  await flush();
  h.settleRevives(FAILED);
  expect(await r.visible).toBe('done');
  expect(h.registry.current(asId('bg/a'))).toBe(null);
  expect(h.registry.current(asId('bg/none'))).toBe(null);
});

test('registry: a revived record keeps its handle', async () => {
  const h = harness();
  const [a] = await liveBgs(h, ['a']);
  expect(await h.registry.revive(2, noAbort()).all).toBe('done');
  expect(h.revives.length).toBe(1);
  // The same texture re-uploaded in place: every view bound to the handle stays valid.
  expect(h.registry.current(asId('bg/a'))).toBe(a);
  const join = await h.acquire('bg/a', bg('a'), 'preload:k1', 'preload');
  expect(join.ok ? join.value : null).toBe(a);
});

test('registry: visible and all settle aborted when the revive is aborted', async () => {
  const h = harness();
  await liveBgs(h, ['p'], 'preload');
  await liveBgs(h, ['v']);
  h.setReviveMode('hold');

  // By its signal during the visible pass: both passes.
  const c1 = new AbortController();
  const r1 = h.registry.revive(2, c1.signal);
  await flush();
  c1.abort();
  expect(await r1.visible).toBe('aborted');
  expect(await r1.all).toBe('aborted');
  h.settleRevives({ ok: false, error: { kind: 'aborted' } });

  // By its signal after the visible pass: that pass keeps 'done'.
  const c2 = new AbortController();
  const r2 = h.registry.revive(2, c2.signal);
  await flush();
  h.settleRevives();
  expect(await r2.visible).toBe('done');
  await flush();
  expect(urlsOf(h.revives).at(-1)).toBe('/assets/p.avif@2');
  c2.abort();
  expect(await r2.all).toBe('aborted');
  h.settleRevives({ ok: false, error: { kind: 'aborted' } });

  // By a newer call: the older revive's passes settle 'aborted', the newer one runs.
  const r3 = h.registry.revive(3, noAbort());
  await flush();
  const r4 = h.registry.revive(4, noAbort());
  expect(await r3.visible).toBe('aborted');
  expect(await r3.all).toBe('aborted');
  const r4all = seen(r4.all);
  for (let i = 0; i < 10 && r4all.value === null; i++) {
    h.settleRevives();
    await flush();
  }
  expect(await r4.visible).toBe('done');
  expect(r4all.value).toBe('done');
  expect(h.registry.stats()).toMatchObject({ live: 2, stale: 0, reviveFailed: 0 });
});

test('registry: a revive with no stale record settles done at once', async () => {
  // The `activated` restart (section 9): nothing stale, no timer, no revive call.
  const h = harness();
  h.setGen(2);
  await liveBgs(h, ['a']);
  const r = h.registry.revive(2, noAbort());
  const settled: string[] = [];
  void r.visible.then((e) => settled.push(`visible:${e}`));
  void r.all.then((e) => settled.push(`all:${e}`));
  await Promise.resolve();
  expect(settled).toEqual(['visible:done', 'all:done']);
  expect(h.revives).toEqual([]);
});

test('registry: a revive that settles in time leaves no deadline timer pending', async () => {
  vi.useFakeTimers();
  try {
    const h = harness();
    await liveBgs(h, ['p'], 'preload');
    await liveBgs(h, ['v']);
    const r = h.registry.revive(2, noAbort());
    expect(await r.visible).toBe('done');
    expect(await r.all).toBe('done');
    expect(vi.getTimerCount(), 'a settled revive must not leave a 3000 ms deadline timer pending').toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

// MEMORY-PLAN 4.C, §7 row "M3c half": a LOW registry loads, counts and lays out each entry's half file.

/** `entry`'s half: half its stored px per side, in its own small files. */
const halved = (name: string, entry: ImageEntry, avif = 40, webp = 48): ImageEntry => {
  const half: HalfFile = {
    w: entry.w / 2,
    h: entry.h / 2,
    decodedBytes: (entry.w / 2) * (entry.h / 2) * 4,
    avif: { url: `/assets/${name}-half.avif`, bytes: avif },
    webp: { url: `/assets/${name}-half.webp`, bytes: webp },
  };
  return { ...entry, half };
};

test('registry: a LOW registry counts the half file', async () => {
  const h = harness('avif', 'half');
  const char = halved('x_y', image('x_y', 768, 1536));
  const pending = h.acquire('char/x/y', char, 'scene:x', 'visible');
  // The load fetches the half, laid out at resolution 0.5 on the full canvas.
  expect(h.calls.map((c) => c.url)).toEqual(['/assets/x_y-half.avif']);
  expect(h.calls[0]?.geometry).toEqual({ canvas: { w: 768, h: 1536 }, orig: { x: 0, y: 0, w: 768, h: 1536 }, trim: null, resolution: 0.5 });
  // In flight it reserves the half's decoded bytes and file: 384 × 768 × 4 + 40.
  expect(h.registry.stats().bytes).toBe(1_179_648 + 40);
  h.succeedAll();
  const live = await pending;
  // The handle reports the canvas, so the layout is the full tier's (I4).
  expect(live.ok ? { w: live.value.w, h: live.value.h } : live.error).toEqual({ w: 768, h: 1536 });
  expect(h.registry.stats()).toMatchObject({ live: 1, bytes: 1_179_648 + 40, keptBytes: 40, keptMismatch: 0 });
  // An entry without a half loads its full file on the half tier.
  const plain = h.acquire('bg/a', bg('a'), 'scene:bg', 'visible');
  expect(h.calls.map((c) => c.url)).toEqual(['/assets/x_y-half.avif', '/assets/a.avif']);
  expect(h.calls[1]?.geometry.resolution).toBe(1);
  h.succeedAll();
  expect((await plain).ok).toBe(true);
  expect(h.registry.stats().bytes).toBe(1_179_648 + 40 + BG + F);
});

test('registry: demote applies to records started later', async () => {
  const h = harness('avif', 'half');
  const a = h.acquire('bg/a', halved('a', bg('a')), 'scene:a', 'visible');
  h.succeedAll();
  const first = await a;
  expect(h.callsOf('/assets/a-half.avif')).toHaveLength(1);
  h.registry.demote();
  // A record started after the demotion loads its full file.
  const b = h.acquire('bg/b', halved('b', bg('b')), 'scene:b', 'visible');
  expect(h.calls.map((c) => c.url)).toEqual(['/assets/a-half.avif', '/assets/b.avif']);
  h.succeedAll();
  expect((await b).ok).toBe(true);
  // A second holder joining the live half record makes no load call and gets the same handle; it still counts its half.
  const joining = h.acquire('bg/a', halved('a', bg('a')), 'preload:k1', 'preload');
  expect(h.calls.map((c) => c.url), 'joining the live half record makes no load call').toEqual(['/assets/a-half.avif', '/assets/b.avif']);
  const join = await joining;
  expect(join.ok && first.ok ? join.value === first.value : join).toBe(true);
  expect(h.registry.stats()).toMatchObject({ live: 2, bytes: 540 * 1024 * 4 + 40 + BG + F });
  expect(h.released.get('/assets/a-half.avif') ?? 0, 'the live half record is not ended').toBe(0);
});
