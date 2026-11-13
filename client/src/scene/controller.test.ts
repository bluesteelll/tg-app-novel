// The scene controller's step functions (lane SH5b fix2, O7): `mount` needs a WebGL Application, so no test builds a
// mounted controller; `apply` and `restore` are `applyStep` and `restoreStep` over the mounted parts, run here over the
// real executor and a load-only registry at the full tier, on a stage adapter that draws nothing.
// The step options matrix (fix3) pins both functions' option handling against an explicit model, cell by cell.
import { expect, test } from 'vitest';

import type { HalfFile, ImageEntry, Result } from '../story/catalog.ts';
import type { AssetId, BgId } from '../story/staging.ts';
import { applyStep, restoreStep } from './controller.ts';
import { createExecutor } from './executor.ts';
import type { Executor, GroupRef, SceneSnapshot, StageAdapter, VisualCommand } from './executor.ts';
import { ENSURE_HOLDER, KEEP_WINDOW } from './preload.ts';
import type { StageWindow } from './preload.ts';
import { createAssetRegistry } from './registry.ts';
import type { AssetError, AssetRegistry, Decoded, LoadImage, RecordState } from './registry.ts';
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
/** A test fixture id a step ensures but does not show. */
const BG_Y = 'bg/y' as AssetId;
/** A test fixture id the step's window holds and its ensure does not. */
const BG_Z = 'bg/z' as AssetId;
/** The scheduler's window holder of bg/z: preload.ts's `WIN` prefix plus the id (the prefix is module-private there). */
const WIN_Z = 'preload:win:bg/z';
const CUT: VisualCommand = { kind: 'bg', bg: 'x' as BgId, t: 'cut', ms: 0 };
/** An animated batch's wait pads its timeline (executor.ts compose) and an instant one's does not: `instant` shows. */
const WAIT: VisualCommand = { kind: 'wait', ms: 400 };
const W: StageWindow = { need: [BG_X], warm: [], near: 0, hope: [], eventRoom: [] };

/** The states of bg/x, bg/y and bg/z, in that order. */
const held = (r: Pick<AssetRegistry<Tex>, 'state'>): RecordState[] => [BG_X, BG_Y, BG_Z].map((id) => r.state(id));

/**
 * The mounted parts over a fake load that records each URL and decodes at once at that file's own stored px (the
 * registry refuses any other size); the executor's swap reports land in `windows`, and the states of bg/x, bg/y and
 * bg/z at each swap point (what the mounted scheduler's want / kick reads in that same turn) in `atSwap`.
 */
function parts() {
  const urls: string[] = [];
  const windows: StageWindow[] = [];
  const atSwap: RecordState[][] = [];
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
    swapped: (w) => {
      windows.push(w);
      atSwap.push(held(registry));
    },
  });
  return { registry, executor, urls, windows, atSwap, skipped };
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

// ---------------------------------------------------------------------------------------------------------------
// The step options matrix (fix3, D7)
//
// The game's stage ensures every id of a step under ENSURE_HOLDER, then applies (or restores) it: inside the preview
// scope for a chapter entry's first step (shots §5.8 step 1), with the step's window, and instant only in skip mode.
// Once the slots are taken the step lets go of that holder (D7) on every arm: an ensured id the step does not show is
// then held by nothing and dropped (principle 4: textures released after a scene), a shown one stays live under its
// slot, and a release before the takes would fetch the shown id again. A windowed step has let go by its swap point,
// where the scheduler plans the window against the caps (and an entry's swap kicks the upgrades); an animated step
// lets go the same way, or a chapter played outside skip mode would pile up every id it ensured.

type Pv = true | false | 'absent';
type Cell =
  | { readonly op: 'apply'; readonly batch: 'cut' | 'cut+wait' | 'empty'; readonly preview: Pv; readonly window: 'W' | 'Wf' | 'KEEP' | 'none'; readonly instant: boolean }
  | { readonly op: 'restore'; readonly snapshot: 'S' | 'E'; readonly preview: Pv };
/** What the executor reads of a call: an apply's `instant` and `window` (executor.ts apply), a restore's snapshot. */
type Handed = { instant: boolean; window: StageWindow | null } | SceneSnapshot;
/** One cell's observations: t0 is synchronously after the step returns, t2 after `complete()` and its settle. */
type Row = {
  /** The fixture: bg/x and bg/y ensured, bg/z held by the window, all three live before the step. */
  ensured: boolean[];
  before: RecordState[];
  /** The executor's calls, each as the executor reads it. */
  handed: Handed[];
  /** The caller's window (KEEP_WINDOW included) has the same value after the step. */
  callerWindowKept: boolean;
  /** The step's calls in order: `apply` / `restore` (`+scope` inside the preview scope) and `release:<holder>`. */
  log0: string[];
  log2: string[];
  /** The states of bg/x, bg/y and bg/z at t0, at each swap report and at t2. */
  at0: RecordState[];
  atSwap: RecordState[][];
  at2: RecordState[];
  /** The URLs the step itself fetched. */
  stepFetches: number;
  /** `done` fulfilled within MICROTASKS turns, and within MICROTASKS turns after `complete()`. */
  settled: boolean;
  settledAfterComplete: boolean;
};

const PREVIEWS: readonly Pv[] = [true, false, 'absent'];
/** Outer dimension first, so a run is deterministic (a step that wrote into KEEP_WINDOW would meet the later cells). */
const CELLS: readonly Cell[] = [
  ...(['cut', 'cut+wait', 'empty'] as const).flatMap((batch) =>
    PREVIEWS.flatMap((preview) =>
      (['W', 'Wf', 'KEEP', 'none'] as const).flatMap((window) => [true, false].map((instant): Cell => ({ op: 'apply', batch, preview, window, instant }))),
    ),
  ),
  ...(['S', 'E'] as const).flatMap((snapshot) => PREVIEWS.map((preview): Cell => ({ op: 'restore', snapshot, preview }))),
];
const label = (c: Cell): string =>
  c.op === 'apply' ? `apply ${c.batch} preview=${c.preview} window=${c.window} instant=${c.instant}` : `restore ${c.snapshot} preview=${c.preview}`;

/** A restore's snapshot, a fresh literal per call: S shows bg/x, E is the empty stage. */
const snapshotOf = (s: 'S' | 'E'): SceneSnapshot => ({ bg: s === 'S' ? ('x' as BgId) : null, cg: null, chars: [], props: [] });

/**
 * The model: what a step must do, written from D7 and the hand-off rules (the lane's cut, fix3 MC0-MC5), never from a
 * run. It reads only the cell, the fixture's literals and ENSURE_HOLDER; its windows are literals, never the objects
 * the step is handed, so a step that writes into its caller's window (KEEP_WINDOW included) is seen.
 */
function expected(c: Cell): Row {
  const shows = c.op === 'apply' ? c.batch !== 'empty' : c.snapshot === 'S';
  const scope = c.preview === true;
  const waits = c.op === 'apply' && c.batch === 'cut+wait' && !c.instant;
  // MC3: the ensure holder goes after the takes, so the shown id stays live under its slot and is not fetched again,
  // the ensured id the step does not show is dropped, and the window's holder stays.
  const after: RecordState[] = [shows ? 'live' : 'none', 'none', 'live'];
  // MC2, MC3: one executor call, inside the preview scope iff the step is a preview (false and absent are not), then
  // one release of the ensure holder, before the step returns.
  const log = [scope ? `${c.op}+scope` : c.op, `release:${ENSURE_HOLDER}`];
  return {
    // MC0
    ensured: [true, true, true],
    before: ['live', 'live', 'live'],
    // MC1, MC1r
    handed: [c.op === 'apply' ? { instant: c.instant, window: handedWindow(c.window, scope) } : snapshotOf(c.snapshot)],
    callerWindowKept: true,
    log0: log,
    log2: log,
    at0: after,
    // MC4: one swap report per apply with a window, with the release in by then
    atSwap: c.op === 'apply' && c.window !== 'none' ? [after] : [],
    at2: after,
    stepFetches: 0,
    // MC5: only an animated batch with a wait outlives the microtasks, and complete() ends it
    settled: !waits,
    settledAfterComplete: true,
  };
}

/**
 * MC1: the window the executor gets. None stays none; a preview step hands a copy flagged `preview` (a caller's
 * `preview: false` is overridden, KEEP's `keep` is kept); any other step hands the caller's value.
 */
function handedWindow(w: 'W' | 'Wf' | 'KEEP' | 'none', scope: boolean): StageWindow | null {
  const value: StageWindow | null =
    w === 'W'
      ? { need: [BG_X], warm: [], near: 0, hope: [], eventRoom: [] }
      : w === 'Wf'
        ? { need: [BG_X], warm: [], near: 0, hope: [], eventRoom: [], preview: false }
        : w === 'KEEP'
          ? { need: [], warm: [], near: 0, hope: [], eventRoom: [], keep: true }
          : null;
  return value === null || !scope ? value : { ...value, preview: true };
}

/** The window a cell hands its step: W and Wf fresh per cell, KEEP the module's KEEP_WINDOW itself (as the game does). */
const windowArg = (w: 'W' | 'Wf' | 'KEEP' | 'none'): StageWindow | undefined =>
  w === 'W'
    ? { need: [BG_X], warm: [], near: 0, hope: [], eventRoom: [] }
    : w === 'Wf'
      ? { need: [BG_X], warm: [], near: 0, hope: [], eventRoom: [], preview: false }
      : w === 'KEEP'
        ? KEEP_WINDOW
        : undefined;

/** Turns a step that does not wait has to settle in: at least twice the slowest such cell's measured count. */
const MICROTASKS = 50;

/** Whether `p` fulfils within `n` microtask turns; a pending or rejected one reads false. */
async function settledWithin(p: Promise<void>, n: number): Promise<boolean> {
  let done = false;
  // Watched, not awaited: the turns are what this counts.
  void p.then(
    () => {
      done = true;
    },
    () => {},
  );
  for (let i = 0; i < n; i += 1) {
    await Promise.resolve();
  }
  return done;
}

/** The parts the step functions take (controller.ts `StageParts`, module-private there). */
type Stage = {
  readonly registry: Pick<AssetRegistry<Tex>, 'previewing' | 'releaseHolder'>;
  readonly executor: Pick<Executor<Tex>, 'apply' | 'restore'>;
};

/**
 * One cell over fresh parts. The step runs over recorders that delegate to the real registry and executor, so the swap
 * point and the settle are the executor's own; the executor reaches the real registry directly, so the log holds the
 * step's own calls only.
 */
async function observe(c: Cell): Promise<Row> {
  const p = parts();
  const preview = c.preview === true;
  // The game's stage ensures with the step's own flag (game.ts stage).
  const ensured = await Promise.all([
    p.registry.acquire(BG_X, ENSURE_HOLDER, { entry: X, priority: 'visible', preview }),
    p.registry.acquire(BG_Y, ENSURE_HOLDER, { entry: X, priority: 'visible', preview }),
    p.registry.acquire(BG_Z, WIN_Z, { entry: X, priority: 'preload' }),
  ]);
  const before = held(p.registry);
  const fetched = p.urls.length;
  const log: string[] = [];
  const handed: Handed[] = [];
  let depth = 0;
  const stage: Stage = {
    registry: {
      previewing: <R>(run: () => R): R =>
        p.registry.previewing(() => {
          depth += 1;
          try {
            return run();
          } finally {
            depth -= 1;
          }
        }),
      releaseHolder: (h) => {
        log.push(`release:${h}`);
        p.registry.releaseHolder(h);
      },
    },
    executor: {
      apply: (b, o) => {
        log.push(depth > 0 ? 'apply+scope' : 'apply');
        handed.push({ instant: o.instant, window: o.window ?? null });
        return p.executor.apply(b, o);
      },
      restore: (s) => {
        log.push(depth > 0 ? 'restore+scope' : 'restore');
        handed.push(s);
        return p.executor.restore(s);
      },
    },
  };
  const window = c.op === 'apply' ? windowArg(c.window) : undefined;
  const value = JSON.stringify(window);
  const done =
    c.op === 'apply'
      ? applyStep(stage, c.batch === 'cut' ? [CUT] : c.batch === 'cut+wait' ? [CUT, WAIT] : [], {
          instant: c.instant,
          ...(window === undefined ? {} : { window }),
          ...(c.preview === 'absent' ? {} : { preview: c.preview }),
        })
      : c.preview === 'absent'
        ? restoreStep(stage, snapshotOf(c.snapshot))
        : restoreStep(stage, snapshotOf(c.snapshot), { preview: c.preview });
  // t0: nothing has run since the step returned.
  const log0 = [...log];
  const at0 = held(p.registry);
  const settled = await settledWithin(done, MICROTASKS);
  p.executor.complete();
  const settledAfterComplete = await settledWithin(done, MICROTASKS);
  return {
    ensured: ensured.map((r) => r.ok),
    before,
    handed,
    callerWindowKept: JSON.stringify(window) === value,
    log0,
    log2: [...log],
    at0,
    atSwap: p.atSwap,
    at2: held(p.registry),
    stepFetches: p.urls.length - fetched,
    settled,
    settledAfterComplete,
  };
}

test("controller: a step's options matrix (D7): the executor's options and scope, the holders at return, swap point and settle, and when the step settles", async () => {
  // apply: 3 batches x 3 previews x 4 windows x 2 instants = 72; restore: 2 snapshots x 3 previews = 6.
  expect(CELLS).toHaveLength(78);
  expect(new Set(CELLS.map(label)).size).toBe(78);
  for (const cell of CELLS) {
    expect.soft(await observe(cell), label(cell)).toEqual(expected(cell));
  }
});
