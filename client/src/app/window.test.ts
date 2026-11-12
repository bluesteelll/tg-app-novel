// The step windows end to end (shots §5.8, §9.6 commit 2c; lane SH5a): the real scheduler over the real registry,
// step windows through the real withEventRoom, and a stage of ~30 lines that does what the executor and GameSession do
// at a tap (ensure the batch's files at visible priority, take the new `scene:` holders, the sweep releasing the old
// ones, then the window at the swap point) and EN's preload / releasePreload calls in EN's order. The fake hold counts
// fetches and decodes per id. Each sequence asserts that no fetch of a cut's files starts at its tap: a held file may
// decode, nothing is fetched.
import { expect, test } from 'vitest';

import { createAssetScheduler } from '../scene/preload.ts';
import type { StageWindow } from '../scene/preload.ts';
import { createAssetRegistry } from '../scene/registry.ts';
import type { AssetError, Decoded, HeldFile, HoldImage, LoadError } from '../scene/registry.ts';
import type { AssetEntry, AssetManifest, ImageEntry, Result } from '../story/catalog.ts';
import type { ShotWindow } from '../story/shots.ts';
import type { AssetId, ChapterId } from '../story/staging.ts';
import { withEventRoom } from './stage-route.ts';

type Tex = { readonly url: string };
type Call<T> = { id: string; signal: AbortSignal; resolve(r: Result<T, LoadError>): void; done: boolean };

const asId = (s: string): AssetId => s as AssetId; // fixture ids: the brand is earned by the manifest decoder
const MIB = 1_048_576;
const mib = (x: number): number => Math.round(x * MIB);
const image = (file: string, decoded: number, held: number): ImageEntry => ({
  kind: 'image',
  w: 1024,
  h: 1024,
  decodedBytes: decoded,
  avif: { url: `/assets/${file}.avif`, bytes: held },
  webp: { url: `/assets/${file}.webp`, bytes: held },
});
const manifest = (chapterId: string, assets: Record<string, AssetEntry>): AssetManifest => ({
  chapterId: chapterId as ChapterId,
  assets: assets as Record<AssetId, AssetEntry>,
});
/** §5.9's sizes: a close-up's file is held at 0.477 MiB and decodes to 12.703 MiB live; a wide 10.169; a room 11.262. */
const cu = (file: string): ImageEntry => image(file, mib(12.226), mib(0.477));
const SH = manifest('ch6', {
  'bg/wide': image('wide', mib(10.169), 0),
  'bg/close': image('close', mib(10.169), 0),
  'bg/cu_a': cu('cu_a'),
  'bg/cu_b': cu('cu_b'),
  'bg/cu_c': cu('cu_c'),
  'bg/hall': image('hall', mib(11.262), 0),
  'bg/study': image('study', mib(11.262), 0),
  'bg/cellar': image('cellar', mib(11.262), 0),
  'prop/hall': image('prop_hall', mib(3.3), 0),
  'prop/cellar': image('prop_cellar', mib(3.3), 0),
  'face/f': image('face_f', mib(1.633), 0),
});
/** The next chapter: its opening wide and the first knot's other files. */
const NX = manifest('ch7', {
  'bg/opening': image('opening', mib(10.169), 0),
  ...Object.fromEntries([1, 2, 3, 4].map((i) => [`prop/n${i}`, image(`n${i}`, mib(0.1), 0)])),
});
/** ch1's manor at its measured sizes (a ch1 plate 8,847,360 B decoded; the arrival's two sprites 6,102,810 B). */
const PLATE = 8_847_360;
const CH1 = manifest('ch1', {
  'bg/hall': image('m_hall', PLATE, 2448),
  'bg/study': image('m_study', PLATE, 2448),
  'bg/cellar': image('m_cellar', PLATE, 2836),
  'bg/street': image('m_street', PLATE, 2540),
  'prop/medal_star': image('m_medal', 65_536, 1000),
  'char/ally/neutral': image('m_neutral', 3_051_405, 0),
  'char/ally/worried': image('m_worried', 3_051_405, 0),
  'prop/study_set': image('m_study_set', 2_909_330, 0),
});
const ENTRIES = new Map<string, [string, ImageEntry]>();
for (const m of [SH, NX, CH1]) {
  for (const [id, e] of Object.entries(m.assets)) {
    if (e.kind === 'image') {
      ENTRIES.set(e.avif.url, [id, e]);
    }
  }
}

const win = (o: { need?: string[]; warm?: string[]; near?: number; hope?: string[] }): StageWindow => withEventRoom(shot(o), null);
const shot = (o: { need?: string[]; warm?: string[]; near?: number; hope?: string[] }): ShotWindow => ({
  need: (o.need ?? []).map(asId),
  warm: (o.warm ?? []).map(asId),
  near: o.near ?? 0,
  hope: (o.hope ?? []).map(asId),
});
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const micro = async (): Promise<void> => {
  for (let i = 0; i < 20; i += 1) {
    await Promise.resolve();
  }
};

/** The stage: `stall` names ids whose decodes wait for `finish(id)`; every other fetch and decode settles at once. */
function stage(first: AssetManifest) {
  const fetched: string[] = [];
  const decodes: Call<Decoded<Tex>>[] = [];
  const stall = new Set<string>();
  const released = new Map<string, number>();
  const at = (url: string): [string, ImageEntry] => {
    const e = ENTRIES.get(url);
    if (e === undefined) {
      throw new Error(`invariant: ${url} is a fixture file`);
    }
    return e;
  };
  const texture = (url: string, keptBytes: number): Decoded<Tex> => {
    const [, e] = at(url);
    return {
      texture: { url },
      w: e.w,
      h: e.h,
      keptBytes,
      gen: 1,
      open: () => false,
      revive: () => Promise.resolve({ ok: true, value: undefined }),
      release: () => released.set(url, (released.get(url) ?? 0) + 1),
    };
  };
  const file = (url: string, bytes: number): HeldFile<Tex> => ({
    bytes,
    decode: (signal) =>
      new Promise((resolve) => {
        const call: Call<Decoded<Tex>> = { id: at(url)[0], signal, resolve, done: false };
        decodes.push(call);
        if (!stall.has(call.id)) {
          call.done = true;
          resolve({ ok: true, value: texture(url, bytes) });
        }
      }),
    drop: () => {},
  });
  const hold: HoldImage<Tex> = (ref) => {
    fetched.push(at(ref.url)[0]);
    return Promise.resolve({ ok: true, value: file(ref.url, ref.bytes) });
  };
  const registry = createAssetRegistry<Tex>({ hold, variant: 'avif', tier: 'full' });
  const errors: AssetError[] = [];
  const s = createAssetScheduler({ registry, onError: (e) => errors.push(e) });
  s.setChapter(first);
  let onStage: string[] = [];
  const entry = (id: string): ImageEntry => {
    const r = s.resolve(asId(id));
    if (!r.ok) {
      throw new Error(`invariant: ${id} resolves`);
    }
    return r.value;
  };
  return {
    s,
    registry,
    errors,
    stall,
    fetched,
    fetches: (id: string): number => fetched.filter((x) => x === id).length,
    decodes: (id: string): number => decodes.filter((c) => c.id === id).length,
    releases: (id: string): number => released.get(entry(id).avif.url) ?? 0,
    state: (id: string) => registry.state(asId(id)),
    /** A stalled decode settles now. */
    finish: (id: string): void => {
      const c = decodes.find((x) => x.id === id && !x.done);
      if (c === undefined) {
        throw new Error(`invariant: ${id} has a decode in flight`);
      }
      c.done = true;
      const url = entry(id).avif.url;
      c.resolve({ ok: true, value: texture(url, entry(id).avif.bytes) });
    },
    settle: flush,
    /** A swap point with no batch (a step on the same shot): the window only. */
    step: async (w: StageWindow): Promise<void> => {
      s.want(w);
      await flush();
    },
    /** A tap: the batch's files at visible priority, then the swap; returns the ids fetched at the tap. */
    cut: async (ids: string[], w: StageWindow | null): Promise<string[]> => {
      const before = fetched.length;
      const r = await s.ensure(ids.map(asId), new AbortController().signal);
      if (!r.ok) {
        throw new Error(`invariant: the batch loads: ${JSON.stringify(r.error)}`);
      }
      const atTap = fetched.slice(before);
      for (const id of ids) {
        await registry.acquire(asId(id), `scene:${id}`, { entry: entry(id), priority: 'visible' });
      }
      registry.releaseHolder('ensure');
      for (const old of onStage.filter((x) => !ids.includes(x))) {
        registry.release(asId(old), `scene:${old}`);
      }
      onStage = [...ids];
      if (w !== null) {
        s.want(w);
      }
      await flush();
      return atTap;
    },
    /** A chapter's clear (restore with no window): every scene holder goes. */
    clear: (): void => {
      for (const old of onStage) {
        registry.release(asId(old), `scene:${old}`);
      }
      onStage = [];
    },
  };
}

test('window: wide, close-up, reverse close-up, wide loads no cut at its tap', async () => {
  const h = stage(SH);
  // The wide's step: the next close-up is certain (need), the reverse one hoped for (refused at 35.575 MiB).
  await h.cut(['bg/wide'], win({ need: ['bg/wide', 'bg/cu_a'], hope: ['bg/cu_b'] }));
  expect(h.fetched).toEqual(['bg/wide', 'bg/cu_a']);
  // CU A: the wide stays as hope d2 until CU B's need evicts it (25.406 MiB).
  expect(await h.cut(['bg/cu_a'], win({ need: ['bg/cu_a', 'bg/cu_b'], hope: ['bg/wide'] }))).toEqual([]);
  expect(await h.cut(['bg/cu_b'], win({ need: ['bg/cu_b', 'bg/wide'], hope: ['bg/cu_a'] }))).toEqual([]);
  expect(await h.cut(['bg/wide'], win({ need: ['bg/wide'], hope: ['bg/cu_b'] }))).toEqual([]);
  expect(h.errors).toEqual([]);
});

test('window: a choice cut decodes from the bytes held since the choice', async () => {
  const h = stage(SH);
  // A choice at CU A whose replies open on CU B and CU C: B decodes ahead (26.360 MiB), C stays held.
  await h.cut(['bg/cu_a'], win({ need: ['bg/cu_a'], warm: ['bg/cu_b', 'bg/cu_c'] }));
  expect(['bg/cu_b', 'bg/cu_c'].map(h.state)).toEqual(['live', 'held']);
  // The tap on C: its held file decodes at visible priority, nothing is fetched.
  expect(await h.cut(['bg/cu_c'], win({ need: ['bg/cu_c'] }))).toEqual([]);
  expect([h.fetches('bg/cu_c'), h.decodes('bg/cu_c')]).toEqual([1, 1]);
});

test('window: an exchange inside a room event loads no cut at its tap', async () => {
  const h = stage(SH);
  // The hall with its props and the event's opener held; EN holds the hall and the study.
  const hall = shot({ need: ['bg/hall', 'prop/hall'], warm: ['bg/cu_a'], near: 1 });
  await h.cut(['bg/hall', 'prop/hall'], withEventRoom(hall, null));
  h.s.preload('room:hall', [asId('bg/hall')]);
  h.s.preload('room:study', [asId('bg/study')]);
  await h.settle();
  const ev = (o: { need: string[] }): StageWindow => withEventRoom(shot(o), hall);
  // The hotspot's exchange: CU A -> CU B -> CU A -> CU B, its last line certain of the return.
  expect(await h.cut(['bg/cu_a'], ev({ need: ['bg/cu_a', 'bg/cu_b'] }))).toEqual([]);
  expect(await h.cut(['bg/cu_b'], ev({ need: ['bg/cu_b', 'bg/cu_a'] }))).toEqual([]);
  expect(await h.cut(['bg/cu_a'], ev({ need: ['bg/cu_a', 'bg/cu_b'] }))).toEqual([]);
  expect(await h.cut(['bg/cu_b'], ev({ need: ['bg/cu_b', 'bg/hall', 'prop/hall'] }))).toEqual([]);
  // The return: the room batch finds the hall resident.
  expect(await h.cut(['bg/hall', 'prop/hall'], withEventRoom(hall, null))).toEqual([]);
  expect(h.errors).toEqual([]);
});

test("window: an ending knot's cuts load none at their tap while the next chapter is held", async () => {
  const h = stage(SH);
  await h.cut(['bg/cu_a'], null);
  // The ending knot's entry asks for the next chapter's first window; it lands (22.872 MiB).
  h.s.preload('next:ch7', [asId('bg/opening')], NX);
  await h.settle();
  // The final choice: CU B and CU C held (23.826); CU B's decode ahead would make 36.052.
  await h.step(win({ need: ['bg/cu_a'], warm: ['bg/cu_b', 'bg/cu_c'] }));
  expect(['bg/cu_b', 'bg/cu_c', 'bg/opening'].map(h.state)).toEqual(['held', 'held', 'live']);
  // Reply B, then the step before the closing wide: the wide evicts next:ch7 (22.872), never waits.
  expect(await h.cut(['bg/cu_b'], win({ need: ['bg/cu_b', 'bg/close'] }))).toEqual([]);
  expect(await h.cut(['bg/close'], win({ need: ['bg/close'] }))).toEqual([]);
  expect(h.state('bg/opening')).toBe('none');
});

test('window: an onEnter event keeps its room', async () => {
  const h = stage(SH);
  // The hall: EN holds the hall and the study; the cellar's neighbour preload is refused (33.786 MiB).
  await h.cut(['bg/hall'], win({ need: ['bg/hall'] }));
  for (const r of ['hall', 'study', 'cellar']) {
    h.s.preload(`room:${r}`, [asId(`bg/${r}`)]);
  }
  await h.settle();
  expect(h.state('bg/cellar')).toBe('none');
  // The move: EN keeps the hall and the cellar; the cellar's room batch hands its window, with the event's opener.
  h.s.releasePreload('room:study');
  const cellar = shot({ need: ['bg/cellar', 'prop/cellar'], warm: ['bg/cu_a'], near: 1 });
  await h.cut(['bg/cellar', 'prop/cellar'], withEventRoom(cellar, null));
  // The onEnter event (EN's roomShown is silent while it runs): the opener, then a face change, then the last line.
  const ev = (o: { need: string[] }): StageWindow => withEventRoom(shot(o), cellar);
  expect(await h.cut(['bg/cu_a'], ev({ need: ['bg/cu_a', 'face/f'] }))).toEqual([]);
  expect(h.state('bg/hall'), "the face file's need released the hall").toBe('none');
  expect(await h.cut(['bg/cu_a', 'face/f'], ev({ need: ['bg/cu_a', 'face/f', 'bg/cellar', 'prop/cellar'] }))).toEqual([]);
  // The return: the cellar never left.
  expect(await h.cut(['bg/cellar', 'prop/cellar'], withEventRoom(cellar, null))).toEqual([]);
  expect([h.fetches('bg/cellar'), h.fetches('prop/cellar')]).toEqual([1, 1]);
});

test('window: a handover whose preload landed fetches nothing for its first window', async () => {
  const h = stage(SH);
  const knot = ['bg/opening', 'prop/n1', 'prop/n2', 'prop/n3', 'prop/n4'];
  h.s.preload('next:ch7', knot.map(asId), NX);
  await h.settle();
  // The handover: setChapter keeps next:ch7, the clear passes no window, the first batch ensures the opening wide.
  h.s.setChapter(NX);
  h.clear();
  expect(await h.cut(['bg/opening'], null)).toEqual([]);
  // The dip's swap, at black: the first window joins the knot's files, then the entry tag ends.
  await h.step(win({ need: knot }));
  expect(knot.map(h.fetches)).toEqual([1, 1, 1, 1, 1]);
  // next:ch7 holds nothing now: without the window's holders the knot's files end.
  h.registry.releaseHolder('preload:win:');
  expect(knot.slice(1).map(h.state)).toEqual(['none', 'none', 'none', 'none']);
});

/** ch1's manor, hall -> study -> hall, with EN's calls in roomShown's order; `stallBack` holds the return's decodes. */
async function backInTheHall(stallBack: readonly string[]) {
  const h = stage(CH1);
  const hall = win({ need: ['bg/hall'], warm: ['bg/street', 'bg/cellar', 'prop/medal_star'], near: 1 });
  const atHall = (): void => {
    for (const [tag, id] of [
      ['room:hall', 'bg/hall'],
      ['room:study', 'bg/study'],
      ['room:cellar', 'bg/cellar'],
    ] as const) {
      h.s.preload(tag, [asId(id)]);
    }
  };
  // The arrival's legacy knot hold keeps the two sprites (D2).
  h.s.preload('preload:manor_arrive', ['char/ally/neutral', 'char/ally/worried'].map(asId));
  await h.cut(['bg/hall'], hall);
  atHall();
  await h.settle();
  // The study: EN keeps the study and the hall; its set is the study's own.
  h.s.releasePreload('room:cellar');
  await h.cut(['bg/study', 'prop/study_set'], win({ need: ['bg/study', 'prop/study_set'] }));
  h.s.preload('room:study', [asId('bg/study')]);
  h.s.preload('state:study', [asId('prop/study_set')]);
  h.s.preload('room:hall', [asId('bg/hall')]);
  await h.settle();
  // Back in the hall: the move releases the kept set; the room batch's window decodes the street's opener first.
  h.s.releasePreload('state:study');
  for (const id of stallBack) {
    h.stall.add(id);
  }
  const mark = h.fetched.length;
  await h.cut(['bg/hall'], hall);
  // roomShown: the hall, the neighbours' bgs in exit order, then the kept set.
  atHall();
  h.s.preload('state:study', [asId('prop/study_set')]);
  return { h, since: (id: string): number => h.fetched.slice(mark).filter((x) => x === id).length };
}

const full = (id: string): number => {
  const e = CH1.assets[asId(id)];
  return e?.kind === 'image' ? e.decodedBytes + e.avif.bytes : 0;
};
const held = (id: string): number => {
  const e = CH1.assets[asId(id)];
  return e?.kind === 'image' ? e.avif.bytes : 0;
};
const HALL_WITH_CELLAR = ['bg/hall', 'bg/study', 'bg/cellar', 'char/ally/neutral', 'char/ally/worried'];

test("window: back in the hall after the study the cellar's bg is live and the street's opener only held", async () => {
  const { h } = await backInTheHall([]);
  await h.settle();
  expect(['bg/cellar', 'bg/street', 'prop/study_set'].map(h.state)).toEqual(['live', 'held', 'none']);
  const st = h.registry.stats();
  expect(st.bytes - st.keptBytes).toBe(3 * PLATE + 2 * 3_051_405);
  expect(st.bytes).toBe(HALL_WITH_CELLAR.reduce((n, id) => n + full(id), 0) + held('bg/street') + held('prop/medal_star'));
});

test("window: back in the hall the cellar's bg is admitted while the street's opener is still decoding, and the opener stays held", async () => {
  const { h, since } = await backInTheHall(['bg/street', 'bg/cellar']);
  await micro();
  // The cellar's refusal settled: the street's decode in flight was aborted and its reservation returned.
  expect(h.state('bg/cellar')).toBe('pending');
  expect(h.registry.stats().bytes).toBe(HALL_WITH_CELLAR.reduce((n, id) => n + full(id), 0) + held('bg/street') + held('prop/medal_star'));
  const before = h.releases('bg/street');
  h.finish('bg/street');
  await micro();
  expect(h.releases('bg/street') - before, 'the late texture released at once').toBe(1);
  expect(h.state('bg/street')).toBe('held');
  expect(since('bg/street')).toBe(1);
  h.finish('bg/cellar');
  await h.settle();
  expect(['bg/cellar', 'prop/study_set'].map(h.state)).toEqual(['live', 'none']);
});
