// The scene controller's step functions (lane SH5b fix2, O7): `mount` needs a WebGL Application, so no test builds a
// mounted controller; `apply` and `restore` are `applyStep` and `restoreStep` over the mounted parts, run here over the
// real executor and a load-only registry at the full tier, on a stage adapter that draws nothing.
// The step options matrix (fix3) pins both functions' option handling against an explicit model, cell by cell.
// The render seam (lane SH6): the layers, the Pixi adapter's targets and the ledger, over real Pixi display objects and
// a renderer that records each render (no WebGL in node).
import { Container, Rectangle, Sprite } from 'pixi.js';
import type { Texture } from 'pixi.js';
import { expect, test, vi } from 'vitest';

import type { HalfFile, ImageEntry, Result } from '../story/catalog.ts';
import type { AssetId, BgId, CgId, ChapterId, CharId, ExprId, PropId } from '../story/staging.ts';
import { applyStep, chapterStep, createLayers, createMotionLoader, createSceneHolds, pixiAdapter, restoreStep, sceneSteps, swapCanvas, targetKit } from './controller.ts';
import { createExecutor } from './executor.ts';
import type { Executor, GroupRef, SceneSnapshot, StageAdapter, VisualCommand } from './executor.ts';
import { createGpuLedger, snapshotPlan } from './flatten.ts';
import type { FlatPlan } from './flatten.ts';
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
/**
 * cg/x's half and file, at URLs of their own and smaller than bg/x's, so that cg/x and the three records the fixture
 * holds stay under the steady cap and no eviction enters a cell.
 */
const CG_HALF: HalfFile = {
  w: 270,
  h: 512,
  decodedBytes: 270 * 512 * 4,
  avif: { url: '/assets/cg-x-half.avif', bytes: 20 },
  webp: { url: '/assets/cg-x-half.webp', bytes: 24 },
};
const CG_X: ImageEntry = {
  kind: 'image',
  w: 540,
  h: 1024,
  decodedBytes: 540 * 1024 * 4,
  avif: { url: '/assets/cg-x.avif', bytes: 50 },
  webp: { url: '/assets/cg-x.webp', bytes: 60 },
  half: CG_HALF,
};
/** A test fixture id a restore shows and the fixture never ensures. */
const CG = 'cg/x' as AssetId;
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
 * bg/z at each swap point (what the mounted scheduler's want / kick reads in that same turn) in `atSwap`. cg/x's files
 * load only once `open()` is called, so a restore that shows cg/x is still pending until then.
 */
function parts() {
  const urls: string[] = [];
  const windows: StageWindow[] = [];
  const atSwap: RecordState[][] = [];
  const skipped: AssetError[] = [];
  let open: () => void = () => {};
  const gate = new Promise<void>((r) => {
    open = r;
  });
  const load: LoadImage<Tex> = (ref) => {
    urls.push(ref.url);
    const cg = ref.url === CG_X.avif.url ? CG_X : ref.url === CG_HALF.avif.url ? CG_HALF : null;
    const file = cg ?? (ref.url === HALF.avif.url ? HALF : X);
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
    const loaded = { ok: true as const, value: d };
    return cg === null ? Promise.resolve(loaded) : gate.then(() => loaded);
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
  const resolve = (id: AssetId): Result<ImageEntry, AssetError> =>
    id === BG_X ? { ok: true, value: X } : id === CG ? { ok: true, value: CG_X } : { ok: false, error: { kind: 'missing-id', id } };
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
  return { registry, executor, urls, windows, atSwap, skipped, open };
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
// lets go the same way, or a chapter played outside skip mode would pile up every id it ensured. A resume restores a
// saved stage whole, and under a CG it waits for that CG to show: the game awaits the step before the first line.

type Pv = true | false | 'absent';
type Cell =
  | { readonly op: 'apply'; readonly batch: 'cut' | 'cut+wait' | 'empty'; readonly preview: Pv; readonly window: 'W' | 'Wf' | 'KEEP' | 'none'; readonly instant: boolean }
  | { readonly op: 'restore'; readonly snapshot: 'S' | 'E' | 'C'; readonly preview: Pv };
/** What the executor reads of a call: an apply's `instant` and `window` (executor.ts apply), a restore's snapshot. */
type Handed = { instant: boolean; window: StageWindow | null } | SceneSnapshot;
/** One cell's observations: t0 is synchronously after the step returns, t2 after `complete()`, `open()` and the settle. */
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
  /** `done` fulfilled within MICROTASKS turns, and within MICROTASKS turns after `complete()` and the gate's `open()`. */
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
  ...(['S', 'E', 'C'] as const).flatMap((snapshot) => PREVIEWS.map((preview): Cell => ({ op: 'restore', snapshot, preview }))),
];
const label = (c: Cell): string =>
  c.op === 'apply' ? `apply ${c.batch} preview=${c.preview} window=${c.window} instant=${c.instant}` : `restore ${c.snapshot} preview=${c.preview}`;

/**
 * A restore's snapshot, a fresh literal per call: S shows bg/x, E is the empty stage, and C is a saved stage under a CG
 * (cg/x over bg/x, with a character and a prop whose ids resolve to nothing, so they are skipped visuals and load nothing).
 */
const snapshotOf = (s: 'S' | 'E' | 'C'): SceneSnapshot =>
  s === 'C'
    ? {
        bg: 'x' as BgId,
        cg: 'x' as CgId,
        chars: [{ char: 'ally' as CharId, expr: 'neutral' as ExprId, at: 'left' }],
        props: [{ prop: 'lamp' as PropId, rect: [0, 0, 100, 100] }],
      }
    : { bg: s === 'S' ? ('x' as BgId) : null, cg: null, chars: [], props: [] };

/**
 * The model: what a step must do, written from D7 and the hand-off rules (the lane's cut, fix3 MC0-MC5), never from a
 * run. It reads only the cell, the fixture's literals and ENSURE_HOLDER; its windows are literals, never the objects
 * the step is handed, so a step that writes into its caller's window (KEEP_WINDOW included) is seen.
 */
function expected(c: Cell): Row {
  const shows = c.op === 'apply' ? c.batch !== 'empty' : c.snapshot !== 'E';
  const scope = c.preview === true;
  const waits = c.op === 'apply' && c.batch === 'cut+wait' && !c.instant;
  // The cell shows cg/x, which the fixture does not ensure and whose load waits for the gate.
  const cg = c.op === 'restore' && c.snapshot === 'C';
  // MC3: the ensure holder goes after the takes (the slots a CG covers are taken now too, executor.ts enqueue), so the
  // shown id stays live under its slot and is not fetched again, the ensured id the step does not show is dropped, and
  // the window's holder stays.
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
    // MC3: the step fetches each shown id that was not ensured, and that is C's CG file alone
    stepFetches: cg ? 1 : 0,
    // MC5: an animated batch with a wait outlives the microtasks, and complete() ends it; a restore with a CG resolves
    // once the CG shows (executor.ts restore), so it waits for the CG's load, and the gate's open() ends that
    settled: !waits && !cg,
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

/**
 * Turns a step has to settle in once nothing holds it back (no wait before `complete()`, no gated load after `open()`):
 * at least twice the slowest such cell's measured count.
 */
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
  // cg/x's load ends here (no cell but C started it), so a restore with a CG can settle by the last read.
  p.open();
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
  // apply: 3 batches x 3 previews x 4 windows x 2 instants = 72; restore: 3 snapshots x 3 previews = 9.
  expect(CELLS).toHaveLength(81);
  expect(new Set(CELLS.map(label)).size).toBe(81);
  for (const cell of CELLS) {
    expect.soft(await observe(cell), label(cell)).toEqual(expected(cell));
  }
});

test('controller: a chapter change completes the running batch before the scheduler takes the new chapter', async () => {
  // Carry S5 (SH5b r5-2): the old chapter's batch reports its window into the old chapter, then the scheduler moves.
  const p = parts();
  const log: string[] = [];
  const dip: VisualCommand = { kind: 'scene', bg: 'x' as BgId, t: 'fade', ms: 800 };
  const done = p.executor.apply([dip], { instant: false, window: W });
  // Built and running: its swap point is at black, 400 ms away.
  expect(await settledWithin(done, MICROTASKS)).toBe(false);
  expect(p.windows).toEqual([]);
  chapterStep(
    { executor: p.executor, scheduler: { setChapter: (m) => log.push(`setChapter ${m.chapterId}: windows ${p.windows.length}`) } },
    { chapterId: 'ch2' as ChapterId, assets: {} },
  );
  expect(log).toEqual(['setChapter ch2: windows 1']);
  expect(p.windows).toEqual([W]);
  expect(await settledWithin(done, MICROTASKS)).toBe(true);
});

// ---------------------------------------------------------------------------------------------------------------
// The render seam (lane SH6 D1, D8, D28; shots §5.5): `world` holds the stage under the transition layer, and a target
// is made, counted by the ledger, rendered once and shown, or refused with nothing left; only `dropTarget` frees one.

/** One render as the renderer was asked for it: the container, the target and the transform as [a, b, c, d, tx, ty]. */
type Render = { readonly container: Container; readonly target: Texture; readonly transform: readonly number[]; readonly clear: boolean };

/** Layers on a bare stage and the Pixi adapter over them, with a kit whose renderer records; `gate.open` is the gate. */
function seam() {
  const renders: Render[] = [];
  const gate = { open: true };
  const ledger = createGpuLedger();
  const stage = new Container();
  const layers = createLayers({ stage });
  const renderer = {
    render: (o: { container: Container; target: Texture; transform: { a: number; b: number; c: number; d: number; tx: number; ty: number }; clear: boolean }) => {
      const m = o.transform;
      renders.push({ container: o.container, target: o.target, transform: [m.a, m.b, m.c, m.d, m.tx, m.ty], clear: o.clear });
    },
  };
  const kit = targetKit({ renderer }, () => gate.open, ledger);
  const adapter = pixiAdapter({ screen: new Rectangle(0, 0, 390, 844) }, layers, kit);
  return { stage, layers, adapter, renders, gate, ledger };
}
const PHONE = snapshotPlan({ w: 390, h: 844 }, 2);

test('controller: the world holds bg, props and chars as one render group under the transition layer, cg and fx', () => {
  const { stage, layers } = seam();
  expect(stage.children.map((c) => [layers.world, layers.flat, layers.cg, layers.fx].indexOf(c))).toEqual([0, 1, 2, 3]);
  expect(layers.world.children.map((c) => [layers.bg, layers.props, layers.chars].indexOf(c))).toEqual([0, 1, 2]);
  expect([layers.world.isRenderGroup, layers.flat.isRenderGroup]).toEqual([true, false]);
  // At rest the world is at identity: a shot root's rest framing stays on its anchor (D1, the delta only).
  expect([layers.world.x, layers.world.y, layers.world.scale.x, layers.world.scale.y]).toEqual([0, 0, 1, 1]);
});

test('controller: a snapshot renders the world once into a device-px target the ledger tracks', () => {
  const { layers, adapter, renders, ledger } = seam();
  const f = adapter.flatten?.(PHONE, { kind: 'screen' }) ?? null;
  expect(f).not.toBeNull();
  expect(renders).toHaveLength(1);
  const [r] = renders;
  expect(r?.container).toBe(layers.world);
  expect([r?.target.source.pixelWidth, r?.target.source.pixelHeight, r?.target.source.resolution, r?.clear]).toEqual([780, 1688, 1, true]);
  // The stage in device px, from its top left.
  expect(r?.transform).toEqual([2, 0, 0, 2, 0, 0]);
  expect(ledger.stats()).toEqual({ targets: 1, targetBytes: 5_266_560, targetsCreated: 1, targetsDestroyed: 0 });
  // Shown above the world at 1 / scale, so it covers the stage exactly.
  const [s] = layers.flat.children;
  expect(layers.flat.children).toHaveLength(1);
  expect(s instanceof Sprite ? [s.texture === r?.target, s.x, s.y, s.scale.x, s.scale.y] : null).toEqual([true, 0, 0, 0.5, 0.5]);
  // Review O2: a world delta written just before, with no frame between, is in the transform (a held push's frame).
  adapter.world?.({ x: -10, y: -20, scale: 1.1 });
  expect([layers.world.x, layers.world.y, layers.world.scale.x]).toEqual([-10, -20, 1.1]);
  adapter.flatten?.(PHONE, { kind: 'screen' });
  expect(renders[1]?.transform).toEqual([2.2, 0, 0, 2.2, -20, -40]);
});

test('controller: dropping a snapshot destroys its target and the ledger sees it go', () => {
  const { layers, adapter, renders, ledger } = seam();
  const f = adapter.flatten?.(PHONE, { kind: 'screen' }) ?? null;
  const target = renders[0]?.target;
  const [s] = layers.flat.children;
  if (f === null || target === undefined || s === undefined) {
    throw new Error('invariant: the snapshot was made');
  }
  adapter.dropTarget?.(f);
  // The sprite, then the target with its source: Pixi's destroy event is what the ledger counts down on.
  expect([s.destroyed, target.destroyed]).toEqual([true, true]);
  expect(layers.flat.children).toEqual([]);
  expect(ledger.stats()).toEqual({ targets: 0, targetBytes: 0, targetsCreated: 1, targetsDestroyed: 1 });
});

test('controller: a closed render gate refuses a snapshot and leaves no target', () => {
  const { layers, adapter, renders, ledger, gate } = seam();
  gate.open = false;
  expect(adapter.flatten?.(PHONE, { kind: 'screen' })).toBeNull();
  expect(renders).toEqual([]);
  // Made, counted and destroyed at once: no path leaves a target the ledger does not see.
  expect(ledger.stats()).toEqual({ targets: 0, targetBytes: 0, targetsCreated: 1, targetsDestroyed: 1 });
  expect(layers.flat.children).toEqual([]);
  // An adapter with no kit (adapter.svelte.test.ts's two-argument form) makes nothing.
  const bare = pixiAdapter({ screen: new Rectangle(0, 0, 390, 844) }, createLayers({ stage: new Container() }));
  expect(bare.flatten?.(PHONE, { kind: 'screen' })).toBeNull();
  expect(ledger.stats().targetsCreated).toBe(1);
});

test('controller: a patch renders its rect of the world in device px at its plate place', () => {
  const { layers, adapter, renders, ledger } = seam();
  const root = adapter.anchor('bg', 'bg/lamp');
  adapter.world?.({ x: 5, y: -8, scale: 1.2 });
  const plan: FlatPlan = { w: 64, h: 80, bytes: 64 * 80 * 4, scale: 2, origin: { x: 100.5, y: 200 } };
  const f = adapter.flatten?.(plan, { kind: 'group', parent: root.content, x: 30, y: 40, k: 0.25, z: 7 }) ?? null;
  expect(f).not.toBeNull();
  // The world's delta, then the stage px from the rect's top left, at the resolution.
  const [r] = renders;
  expect(r?.container).toBe(layers.world);
  expect(r?.transform).toEqual([2.4, 0, 0, 2.4, -191, -416]);
  expect([r?.target.source.pixelWidth, r?.target.source.pixelHeight]).toEqual([64, 80]);
  expect(ledger.stats()).toMatchObject({ targets: 1, targetBytes: 20_480 });
  // Shown in the root's content at its plate place, scaled back to plate px, above the parts.
  const content = layers.bg.children[0]?.children[0]?.children[0]?.children[0];
  const [s] = content?.children ?? [];
  expect(s instanceof Sprite ? [s.texture === r?.target, s.x, s.y, s.scale.x, s.zIndex] : null).toEqual([true, 30, 40, 0.25, 7]);
  if (f !== null) {
    adapter.dropTarget?.(f);
  }
  expect(content?.children).toEqual([]);
  expect(ledger.stats()).toMatchObject({ targets: 0, targetsDestroyed: 1 });
});

// ---------------------------------------------------------------------------------------------------------------
// The motion kit's loader (lane SH7, D1, B11): the scene's one import(), started once a step has settled (an apply or a
// restore-first session's restore), never at mount and never on the path to the first line; a failed import leaves
// the faces at rest, and a shot built with no kit retries it (bounded per chapter).

/** A kit the loader hands over; these rows never animate a face. */
const LOADED_KIT = {
  face: (): never => {
    throw new Error('invariant: no face is made here');
  },
  talkMaxMs: 20_000,
};
const settled = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
/** Step parts whose apply waits until the test lets it settle; restore settles at once. */
function heldParts() {
  let release = (): void => {};
  const parts = {
    registry: { previewing: <R>(run: () => R): R => run(), releaseHolder: (): void => {} },
    executor: {
      apply: (): Promise<void> =>
        new Promise<void>((r) => {
          release = r;
        }),
      restore: (): Promise<void> => Promise.resolve(),
    },
  };
  return { parts, release: () => release() };
}

test("controller: the motion kit's import starts after the first apply, not at mount", async () => {
  const imports: string[] = [];
  const installed: unknown[] = [];
  const loader = createMotionLoader({
    load: () => {
      imports.push('motion');
      return Promise.resolve(LOADED_KIT);
    },
    install: (k) => installed.push(k),
  });
  const held = heldParts();
  let mounted = false;
  const steps = sceneSteps(() => (mounted ? held.parts : null), loader);
  // Not mounted: a step is a no-op and starts nothing.
  await steps.apply([], { instant: true });
  await steps.restore({ bg: null, cg: null, chars: [], props: [] });
  await settled();
  expect([imports, loader.state()]).toEqual([[], 'pending']);
  // Mounted: the first batch runs, and the import waits for it to settle.
  mounted = true;
  const first = steps.apply([CUT], { instant: false });
  await settled();
  expect(imports).toEqual([]);
  held.release();
  await first;
  await settled();
  expect([imports, loader.state(), installed]).toEqual([['motion'], 'ready', [LOADED_KIT]]);
  // Every later step imports nothing more.
  const second = steps.apply([CUT], { instant: true });
  held.release();
  await second;
  await steps.restore({ bg: 'x' as BgId, cg: null, chars: [], props: [] });
  await settled();
  expect([imports, installed.length]).toEqual([['motion'], 1]);
  // Arm (B11 (b)): a restore-first session's restore starts the import as its first settled step.
  const restoreFirst: string[] = [];
  const other = createMotionLoader({
    load: () => {
      restoreFirst.push('motion');
      return Promise.resolve(LOADED_KIT);
    },
    install: () => {},
  });
  await sceneSteps(() => heldParts().parts, other).restore({ bg: 'x' as BgId, cg: null, chars: [], props: [] });
  await settled();
  expect([restoreFirst, other.state()]).toEqual([['motion'], 'ready']);
});

test('controller: a failed kit import reports failed and a retry imports again', async () => {
  let imports = 0;
  const installed: unknown[] = [];
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const loader = createMotionLoader({
    load: () => {
      imports += 1;
      return imports === 1 ? Promise.reject(new Error('chunk offline')) : Promise.resolve(LOADED_KIT);
    },
    install: (k) => installed.push(k),
  });
  // A shot built before the first import asks for nothing: only a failed import is retried.
  loader.want();
  expect([imports, loader.state()]).toEqual([0, 'pending']);
  loader.applied();
  await settled();
  expect([imports, loader.state(), installed]).toEqual([1, 'failed', []]);
  expect(warn).toHaveBeenCalledTimes(1);
  // A later step does not retry; a shot built with no kit does, once while its import flies.
  loader.applied();
  expect(imports).toBe(1);
  loader.want();
  loader.want();
  expect([imports, loader.state()]).toEqual([2, 'pending']);
  await settled();
  expect([imports, loader.state(), installed]).toEqual([2, 'ready', [LOADED_KIT]]);
  // Loaded: nothing imports again.
  loader.want();
  loader.chapter();
  loader.want();
  await settled();
  expect([imports, installed.length]).toEqual([2, 1]);
  warn.mockRestore();
});

// ---------------------------------------------------------------------------------------------------------------
// The controller's holds and the rebuilt canvas (lane SH7, D10): a pause, a cover or an animation mode set before the
// mount holds the loop the mount makes (E6); a rebuilt canvas takes the old one's place and the host's box (E5).

test('controller: a pause and a cover set before mount hold the loop at mount', () => {
  const holds = createSceneHolds();
  // Before the mount: `deactivated`, an opaque frame, and the e2e build's frozen default.
  expect([holds.pause(), holds.pause()]).toEqual([true, false]);
  holds.setCovered('panel', true);
  holds.setAnimation({ frozen: true });
  // The mount's loop, with a continuous source on its stage layer.
  let clock = 0;
  const ticks = new Set<() => void>();
  const loop = createRenderLoop({
    ticker: {
      add: (fn) => {
        ticks.add(fn);
      },
      remove: (fn) => {
        ticks.delete(fn);
      },
    },
    render: () => true,
    now: () => clock,
    timer: { set: () => 0, clear: () => {} },
  });
  holds.attach(loop);
  const modes: Array<{ frozen: boolean; covered: boolean }> = [];
  let steps = 0;
  loop.addAmbient({
    layer: 'stage',
    continuous: () => true,
    step: () => {
      steps += 1;
    },
    nextChangeMs: () => null,
    setMode: (m) => {
      modes.push({ frozen: m.frozen, covered: m.covered });
      return false;
    },
  });
  const frame = (): void => {
    clock += 50;
    for (const fn of [...ticks]) {
      fn();
    }
  };
  // The mount's first frame request: paused, the loop does not listen.
  loop.requestRender();
  frame();
  expect([loop.stats().listening, loop.stats().frames, steps]).toEqual([false, 0, 0]);
  expect(modes.at(-1)).toEqual({ frozen: true, covered: true });
  // `activated`: the frame draws, the source stays held by the cover and the mode.
  expect(holds.resume()).toBe(true);
  frame();
  expect([loop.stats().frames, steps]).toEqual([1, 0]);
  holds.setAnimation({ frozen: false });
  holds.setCovered('panel', false);
  frame();
  expect(steps).toBeGreaterThan(0);
  expect(modes.at(-1)).toEqual({ frozen: false, covered: false });
  // After the mount a pause reaches the attached loop at once; a detached loop hears nothing more.
  holds.pause();
  expect(loop.stats().listening).toBe(false);
  holds.detach();
  holds.resume();
  expect(loop.stats().listening).toBe(false);
  loop.destroy();
});

test("controller: a rebuilt canvas takes the old canvas's place and the host's box", () => {
  type El = { readonly name: string };
  const old: El = { name: 'old canvas' };
  const later: El = { name: 'the frame layer' };
  const next: El = { name: 'new canvas' };
  const children: El[] = [old, later];
  const host = {
    children,
    // The host's box when the rebuild's init resolves: not the one appOptions read before the await.
    clientWidth: 412,
    clientHeight: 915,
    replaceChild(n: El, o: El): El {
      children.splice(children.indexOf(o), 1, n);
      return o;
    },
    appendChild(n: El): El {
      children.push(n);
      return n;
    },
  };
  const sizes: Array<[number, number]> = [];
  swapCanvas(host, old, {
    canvas: next,
    renderer: {
      resize: (w, h) => {
        sizes.push([w, h]);
      },
    },
  });
  expect(children.map((c) => c.name)).toEqual(['new canvas', 'the frame layer']);
  expect(sizes).toEqual([[412, 915]]);
});
