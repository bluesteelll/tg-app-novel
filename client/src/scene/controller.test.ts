// The scene controller's step functions (lane SH5b fix2, O7): `mount` needs a WebGL Application, so no test builds a
// mounted controller; `apply` and `restore` are `applyStep` and `restoreStep` over the mounted parts, run here over the
// real executor and a load-only registry at the full tier, on a stage adapter that draws nothing.
import { expect, test } from 'vitest';

import type { HalfFile, ImageEntry, Result } from '../story/catalog.ts';
import type { AssetId, BgId } from '../story/staging.ts';
import { applyStep, restoreStep } from './controller.ts';
import { createExecutor } from './executor.ts';
import type { GroupRef, StageAdapter, VisualCommand } from './executor.ts';
import { ENSURE_HOLDER } from './preload.ts';
import type { StageWindow } from './preload.ts';
import { createAssetRegistry } from './registry.ts';
import type { AssetError, Decoded, LoadImage } from './registry.ts';
import { createRenderLoop } from './render-loop.ts';

type Tex = { readonly url: string };

/** bg/x's half: half its stored px per side, in its own files. */
const HALF: HalfFile = {
  w: 540,
  h: 1024,
  decodedBytes: 540 * 1024 * 4,
  avif: { url: '/assets/x-half.avif', bytes: 40 },
  webp: { url: '/assets/x-half.webp', bytes: 48 },
};
const X: ImageEntry = {
  kind: 'image',
  w: 1080,
  h: 2048,
  decodedBytes: 1080 * 2048 * 4,
  avif: { url: '/assets/x.avif', bytes: 100 },
  webp: { url: '/assets/x.webp', bytes: 120 },
  half: HALF,
};
const BG_X = 'bg/x' as AssetId; // test fixture id: the brand is earned by the manifest decoder
const CUT: VisualCommand = { kind: 'bg', bg: 'x' as BgId, t: 'cut', ms: 0 };
const W: StageWindow = { need: [BG_X], warm: [], near: 0, hope: [], eventRoom: [] };

/**
 * The mounted parts over a fake load that records each URL and decodes at once at that file's own stored px (the
 * registry refuses any other size); the executor's swap reports land in `windows`.
 */
function parts() {
  const urls: string[] = [];
  const windows: StageWindow[] = [];
  const skipped: AssetError[] = [];
  const load: LoadImage<Tex> = (ref) => {
    urls.push(ref.url);
    const file = ref.url === HALF.avif.url ? HALF : X;
    const d: Decoded<Tex> = {
      texture: { url: ref.url },
      w: file.w,
      h: file.h,
      keptBytes: ref.bytes,
      gen: 1,
      open: () => false,
      revive: () => Promise.resolve({ ok: true, value: undefined }),
      release: () => {},
    };
    return Promise.resolve({ ok: true, value: d });
  };
  const registry = createAssetRegistry<Tex>({ load, variant: 'avif', tier: 'full' });
  let n = 0;
  const group = (): GroupRef => {
    n += 1;
    return { group: n };
  };
  const adapter: StageAdapter<Tex> = {
    size: () => ({ w: 390, h: 844 }),
    group,
    anchor: () => ({ anchor: group(), depth: group(), motion: group(), content: group() }),
    node: group,
    dropGroup: () => {},
    sprite: () => {
      n += 1;
      return { sprite: n };
    },
    destroy: () => {},
    set: () => {},
    fx: () => {},
  };
  const resolve = (id: AssetId): Result<ImageEntry, AssetError> => (id === BG_X ? { ok: true, value: X } : { ok: false, error: { kind: 'missing-id', id } });
  const executor = createExecutor<Tex>({
    adapter,
    registry,
    resolve,
    loop: createRenderLoop({ ticker: { add() {}, remove() {} }, render() {} }),
    resolution: 1,
    onSkip: (e) => skipped.push(e),
    swapped: (w) => windows.push(w),
  });
  return { registry, executor, urls, windows, skipped };
}

test("controller: an entry's first apply takes its new slots from their halves and flags its window", async () => {
  // Arm 1, a chapter entry's first step (shots §5.8 step 1): the plate starts from its half, and the window says so.
  const entry = parts();
  await applyStep(entry, [CUT], { instant: true, preview: true, window: W });
  expect(entry.urls[0]).toBe('/assets/x-half.avif');
  expect(entry.windows).toEqual([{ ...W, preview: true }]);
  expect(entry.registry.previews()).toEqual([{ id: BG_X, visible: true }]);
  expect(entry.skipped).toEqual([]);
  // Arm 2, any other step: the full file, and the window as the step gave it.
  const later = parts();
  await applyStep(later, [CUT], { instant: true, window: W });
  expect(later.urls[0]).toBe('/assets/x.avif');
  expect(later.windows).toEqual([W]);
  expect(later.windows[0]).not.toHaveProperty('preview');
  expect(later.registry.previews()).toEqual([]);
});

test("controller: an entry's restore takes its slots from their halves", async () => {
  const entry = parts();
  await restoreStep(entry, { bg: 'x' as BgId, cg: null, chars: [], props: [] }, { preview: true });
  expect(entry.urls[0]).toBe('/assets/x-half.avif');
  expect(entry.registry.previews()).toEqual([{ id: BG_X, visible: true }]);
  const later = parts();
  await restoreStep(later, { bg: 'x' as BgId, cg: null, chars: [], props: [] });
  expect(later.urls[0]).toBe('/assets/x.avif');
  expect(later.registry.previews()).toEqual([]);
});

test("controller: a step lets go of the batch's ensure holder once its slots are taken (D7)", async () => {
  // The game's stage ensures every id of a step under ENSURE_HOLDER, then applies (or restores) it. Once the slots are
  // taken, an ensured id the step does not show is held by nothing and is dropped (principle 4: textures released
  // after a scene); the shown one stays live under its slot. Two fetches, one per ensured id: the slot takes the
  // ensured record, so the holder goes only after the slots are taken (a release before them re-fetches bg/x).
  const rows: unknown[] = [];
  for (const step of ['apply', 'restore'] as const) {
    const p = parts();
    const y = 'bg/y' as AssetId; // test fixture id, ensured but not shown
    const ensured = await Promise.all([BG_X, y].map((id) => p.registry.acquire(id, ENSURE_HOLDER, { entry: X, priority: 'visible' })));
    const before = [p.registry.state(BG_X), p.registry.state(y)];
    if (step === 'apply') {
      await applyStep(p, [CUT], { instant: true, window: W });
    } else {
      await restoreStep(p, { bg: 'x' as BgId, cg: null, chars: [], props: [] });
    }
    rows.push([step, ensured.map((r) => r.ok), before, p.registry.state(BG_X), p.registry.state(y), p.urls.length]);
  }
  expect(rows).toEqual([
    ['apply', [true, true], ['live', 'live'], 'live', 'none', 2],
    ['restore', [true, true], ['live', 'live'], 'live', 'none', 2],
  ]);
});

test("controller: a preview step lets go of the batch's ensure holder once its slots are taken (D7)", async () => {
  // A chapter entry's stage ensures its ids under ENSURE_HOLDER as previews (preload's ensure), then applies (or
  // restores) inside the preview scope: that arm lets go of the holder too, or an ensured id the step does not show
  // stays live and counts as visible for the upgrades. Two fetches, one per ensured id: the slot takes the ensured
  // record, so the holder goes only after the slots are taken.
  const rows: unknown[] = [];
  for (const step of ['apply', 'restore'] as const) {
    const p = parts();
    const y = 'bg/y' as AssetId; // test fixture id, ensured but not shown
    const ensured = await Promise.all([BG_X, y].map((id) => p.registry.acquire(id, ENSURE_HOLDER, { entry: X, priority: 'visible', preview: true })));
    const before = [p.registry.state(BG_X), p.registry.state(y)];
    if (step === 'apply') {
      await applyStep(p, [CUT], { instant: true, preview: true, window: W });
    } else {
      await restoreStep(p, { bg: 'x' as BgId, cg: null, chars: [], props: [] }, { preview: true });
    }
    rows.push([step, ensured.map((r) => r.ok), before, p.registry.state(BG_X), p.registry.state(y), p.urls.length]);
  }
  expect(rows).toEqual([
    ['apply', [true, true], ['live', 'live'], 'live', 'none', 2],
    ['restore', [true, true], ['live', 'live'], 'live', 'none', 2],
  ]);
});
