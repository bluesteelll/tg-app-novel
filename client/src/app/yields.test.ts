// The yields (PUZZLES-PLAN F6, F7, X8, X12, X14; the L15 cut D4, D13, D18, D20, K47-K54) over a fake GameSession:
// a fixture world the decoder accepts, the real explore controller (a fake ResizeObserver), the real puzzle session
// over a fake API, the real view stores, screens stack and view model, and a stage log of every batch the yields
// apply. The runner is a recorder of `enter`, so the projection each knot is entered with is visible.
import type { Component } from 'svelte';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import type { AttemptResponse, PuzzleStatus } from '../api/generated/api.ts';
import type { ApiError, Clock } from '../api/http.ts';
import type { AudioCommand } from '../audio/manager.ts';
import type { Cue, CueEvent } from '../cues/types.ts';
import { createExploreController } from '../explore/controller.ts';
import type { ExploreController } from '../explore/controller.ts';
import type { ExploreEffect } from '../explore/reduce.ts';
import { EMPTY_WORLD_STATE } from '../explore/state.ts';
import type { WorldState } from '../explore/state.ts';
import type { ChunkError, PuzzleUiProps } from '../puzzles/registry.ts';
import type { HintPort } from '../puzzles/session.ts';
import type { SceneStats } from '../scene/controller.ts';
import type { VisualCommand } from '../scene/executor.ts';
import type { StatEvent } from '../stats/reporter.ts';
import { decodeChapterMeta } from '../story/catalog.ts';
import type { AssetEntry, AssetManifest, LoadedChapter, Result } from '../story/catalog.ts';
import type { AssetId, ChapterId, KnotName, PropId, PuzzleLocalId, SectionId, StagingSnapshot } from '../story/staging.ts';
import { createExploreView } from '../ui/explore-view.svelte.ts';
import type { ExploreLayerProps } from '../ui/explore-view.svelte.ts';
import { createPuzzleView } from '../ui/puzzle-view.svelte.ts';
import type { HintLadderUiView, PuzzleFrameView, PuzzleHostProps } from '../ui/puzzle-view.svelte.ts';
import { createScreens } from '../ui/screens.ts';
import { createViewModel } from '../ui/state.svelte.ts';
import type { CueStageProps } from '../ui/state.svelte.ts';
import { decodeWorldSource, toPublic } from '../world/decode.ts';
import type { DocId, HotspotKey, ItemId, WorldPublic } from '../world/types.ts';
import type { WaitRow } from '../requests.test.ts';
import { TAKE_FADE_MS, coreCue, createYields, heldBy } from './yields.ts';
import type { ExploreChunk, LazyChunks, Yields, YieldsHost } from './yields.ts';
import yieldsSource from './yields.ts?raw';

// ---------------------------------------------------------------------------------------------------------------
// Fixtures: a world in the source format (decoded and stamped, as controller.test.ts does) and its chapter

type Json = Record<string, unknown>;
let lineCounter = 0;
const txt = (ru: string): Json => ({ id: `ch1.yx.${(lineCounter++).toString(36).padStart(4, '0')}`, ru });
const RECT = [100, 200, 200, 200];
const exit = (id: string, to: string): Json => ({ id, kind: 'exit', rect: RECT, label: txt(`exit ${id}`), to: { room: to }, lock: null, sfx: null });
const take = (id: string, item: string, prop: string | null): Json => ({ id, kind: 'take', rect: RECT, label: txt(id), gives: { item }, prop, then: [] });
const lockOf = (accepts: string[], puzzle: string): Json => ({ slots: accepts.map((a) => ({ accepts: a })), puzzle, locked: txt('locked'), onOpen: [], onFail: [] });
const box = (id: string, lock: Json): Json => ({ id, kind: 'object', rect: RECT, label: txt(id), lock, then: [], look: null, prop: null });
const look = (id: string): Json => ({ id, kind: 'look', rect: RECT, label: txt(id), look: txt(`seen ${id}`), then: [] });
const code = (closeup: string | null, maxAttempts: number | null): Json => ({
  type: 'code',
  title: txt('code'),
  prompt: txt('prompt'),
  closeup,
  params: { dials: 4 },
  maxAttempts,
  giveUp: false,
  solution: [1, 1, 1, 1],
  hints: [txt('hint')],
});

/** hall (an exit to study, a medal with its prop, a key, a box locked by the medal and the gate puzzle); study runs an event. */
function manorWorld(): WorldPublic {
  const raw = {
    format: 1,
    items: { medal: { name: txt('Медаль'), desc: txt('d'), glyph: 'sun' }, key: { name: txt('Ключ'), desc: txt('d'), glyph: 'key' } },
    docs: {},
    puzzles: { drawer: code('drawer_close', 2), gate: code(null, null) },
    sections: {
      manor: {
        start: 'hall',
        bgm: null,
        rooms: {
          hall: { bg: 'hall', title: txt('Hall'), onEnter: [], hotspots: [exit('to_study', 'study'), take('medal', 'medal', 'medal'), take('key', 'key', null), box('box', lockOf(['medal'], 'gate'))] },
          study: { bg: 'study', title: txt('Study'), onEnter: [{ story: 'study_event' }], hotspots: [exit('to_hall', 'hall'), look('desk')] },
        },
      },
    },
  };
  const r = decodeWorldSource(raw);
  if (!r.ok) {
    throw new Error(`invariant: the fixture world decodes: ${JSON.stringify(r.error)}`);
  }
  return { ...toPublic(r.value), mods: r.value.mods, version: '1111111111111111' };
}

/**
 * The cue fixture (engine plan GM3s): the hall holds one hotspot per effect the yields map to a cue (a look, a take with
 * a prop, a document, a lock, the exits) and an exit out of the section; the cellar's onEnter gives a coin; the
 * study's runs an event knot. `extra` adds puzzles that no hotspot opens (a yield opens them).
 */
function cueWorld(extra: Json = {}): WorldPublic {
  const raw = {
    format: 1,
    items: {
      medal: { name: txt('Медаль'), desc: txt('d'), glyph: 'sun' },
      key: { name: txt('Ключ'), desc: txt('d'), glyph: 'key' },
      coin: { name: txt('Монета'), desc: txt('d'), glyph: 'sun' },
    },
    docs: { letter: { title: txt('Письмо'), body: [txt('текст')] } },
    puzzles: { gate: code(null, null), drawer: code('drawer_close', 2), ...extra },
    sections: {
      manor: {
        start: 'hall',
        bgm: null,
        rooms: {
          hall: {
            bg: 'hall',
            title: txt('Hall'),
            onEnter: [],
            hotspots: [
              exit('to_cellar', 'cellar'),
              exit('to_study', 'study'),
              take('medal', 'medal', 'medal'),
              take('key', 'key', null),
              { id: 'letter', kind: 'take', rect: RECT, label: txt('letter'), gives: { doc: 'letter' }, prop: null, then: [] },
              box('box', lockOf(['medal'], 'gate')),
              look('desk'),
              box('chest', lockOf([], 'drawer')),
              { id: 'out', kind: 'exit', rect: RECT, label: txt('out'), to: { story: 'after' }, lock: null, sfx: null },
            ],
          },
          cellar: { bg: 'cellar', title: txt('Cellar'), onEnter: [{ give: 'coin' }], hotspots: [exit('to_hall', 'hall')] },
          study: { bg: 'study', title: txt('Study'), onEnter: [{ story: 'study_event' }], hotspots: [exit('to_hall', 'hall')] },
        },
      },
    },
  };
  const r = decodeWorldSource(raw);
  if (!r.ok) {
    throw new Error(`invariant: the cue fixture world decodes: ${JSON.stringify(r.error)}`);
  }
  return { ...toPublic(r.value), mods: r.value.mods, version: '2222222222222222' };
}

const VARS = ['g_x', 'pz_drawer', 'pz_drawer_hints', 'pz_gate', 'pz_gate_hints', 'it_medal', 'it_key'];

function image(name: string): AssetEntry {
  const ref = (ext: string) => ({ url: `/assets/${name}.${ext}`, bytes: 1000 });
  return { kind: 'image', w: 1080, h: 2048, decodedBytes: 8_847_360, avif: ref('avif'), webp: ref('webp') };
}

function manorChapter(world: WorldPublic = manorWorld()): LoadedChapter {
  const meta = decodeChapterMeta({
    chapterId: 'ch1',
    storyVersion: '0111111111111111',
    firstKnot: 'start',
    globals: ['g_x'],
    vars: VARS,
    knots: Object.fromEntries(['start', 'after', 'study_event'].map((k) => [k, { assets: [], next: [], ending: false }])),
    endings: {},
  });
  if (!meta.ok) {
    throw new Error(`invariant: the fixture meta decodes: ${JSON.stringify(meta.error)}`);
  }
  const ids = ['bg/hall', 'bg/study', 'bg/cellar', 'prop/medal', 'cg/drawer_close'];
  const assets: AssetManifest = { chapterId: 'ch1' as ChapterId, assets: Object.fromEntries(ids.map((id) => [id, image(id)])) as Record<AssetId, AssetEntry> };
  return { id: 'ch1' as ChapterId, story: {}, meta: meta.value, assets, en: null, world };
}

const MANOR = 'manor' as SectionId;
const DRAWER = 'drawer' as PuzzleLocalId;
const AFTER = 'after' as KnotName;
const key = (k: string): HotspotKey => k as HotspotKey;

// ---------------------------------------------------------------------------------------------------------------
// The fake GameSession

/** Stand-ins: the unit never renders a component. */
const LAYER = (() => ({})) as unknown as Component<ExploreLayerProps>;
const HOST = (() => ({})) as unknown as Component<PuzzleHostProps>;
const TYPE_UI = (() => ({})) as unknown as Component<PuzzleUiProps>;
const STAGE = (() => ({})) as unknown as Component<CueStageProps>;

let observers = 0;
let disconnected = 0;
beforeEach(() => {
  observers = 0;
  disconnected = 0;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor() {
        observers += 1;
      }
      observe(): void {}
      disconnect(): void {
        disconnected += 1;
      }
    },
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

class FakeClock implements Clock {
  #now = 0;
  #next = 1;
  readonly #timers = new Map<number, { at: number; fn: () => void }>();
  now(): number {
    return this.#now;
  }
  setTimeout(fn: () => void, ms: number): number {
    const id = this.#next++;
    this.#timers.set(id, { at: this.#now + ms, fn });
    return id;
  }
  clearTimeout(id: number): void {
    this.#timers.delete(id);
  }
  /** Runs every timer that falls due within `ms`, in time order (one a callback sets included), then moves the clock. */
  advance(ms: number): void {
    const end = this.#now + ms;
    for (;;) {
      let next: [number, { at: number; fn: () => void }] | undefined;
      for (const e of this.#timers) {
        if (e[1].at <= end && (next === undefined || e[1].at < next[1].at)) {
          next = e;
        }
      }
      if (next === undefined) {
        break;
      }
      this.#timers.delete(next[0]);
      this.#now = next[1].at;
      next[1].fn();
    }
    this.#now = end;
  }
}

type Rig = ReturnType<typeof rig>;

type RigOptions = {
  create?: ExploreChunk['create'];
  attempts?: Array<Result<AttemptResponse, ApiError>>;
  /** `getPuzzle`'s answer; none = a network error. */
  status?: PuzzleStatus;
  /** The hint spend; none = no port. */
  hints?: HintPort;
  /** The chapter's world; the manor by default. */
  world?: WorldPublic;
  /** The explore loader settles only after it. */
  exploreGate?: Promise<void>;
  /** Each batch starts only when the test releases it (`release`): its loads are slow. */
  late?: boolean;
  /** Every attempt's answer waits for it (an attempt in flight). */
  attemptGate?: Promise<void>;
  /** Loaders in place of the counting ones (a deferred or failing chunk). */
  loaders?: Partial<LazyChunks>;
};

/** The views as they stood when a cue reached the bus. */
type ViewsAt = { readonly frame: PuzzleFrameView | null; readonly host: Component<PuzzleHostProps> | null; readonly ladder: HintLadderUiView | null };

/** A scene's counters with every field idle but the two the batch hold reads. */
function sceneStats(s: { stale: number; reviving: boolean }): SceneStats {
  return {
    liveTextures: 0,
    liveBytes: 0,
    pendingLoads: 0,
    activeTimelines: 0,
    overCap: 0,
    rebuilds: 0,
    gen: 1,
    openBitmaps: 0,
    stale: s.stale,
    staleFrames: 0,
    reviveFailed: 0,
    reviving: s.reviving,
    visibleReviveMs: null,
  };
}

function rig(o: RigOptions = {}) {
  const clock = new FakeClock();
  const vm = createViewModel({ timers: clock, lang: 'ru' });
  let y: Yields | null = null;
  const screens = createScreens({
    back: { setVisible() {}, onPress: () => () => {} },
    onView: (v) => {
      vm.screens = v;
      y?.screensChanged(v);
    },
  });
  screens.setRoot({ kind: 'game' });
  const explore = createExploreView();
  const puzzle = createPuzzleView();
  const log: string[] = [];
  /** Every visual batch the yields apply, whole and in order. */
  const batches: VisualCommand[][] = [];
  const events: StatEvent[] = [];
  const haptics: string[] = [];
  const holders = new Map<string, Set<string>>();
  let stage: StagingSnapshot = { bg: null, cg: null, chars: [], bgm: null, props: [] };
  const calls = { explore: 0, host: 0, ui: 0, attempts: 0, stage: 0 };
  /** Every cue the session's bus carries, through the scene role's subscription. */
  const cues: CueEvent[] = [];
  /** The puzzle views at each of those cues. */
  const views: ViewsAt[] = [];
  let sceneCalls = 0;
  /** The puzzle frame's type UI at each call of the stage loader. */
  const frameUi: unknown[] = [];
  /** The scene's revive state, which the batch hold reads. */
  const revive = { stale: 0, reviving: false };
  /** The starts of the late batches, oldest first. */
  const starts: Array<() => void> = [];
  const answers = [...(o.attempts ?? [])];
  const ch = manorChapter(o.world);
  const chunks: LazyChunks = {
    explore: async () => {
      calls.explore += 1;
      await o.exploreGate;
      return { ok: true, value: { create: o.create ?? createExploreController, layer: LAYER } };
    },
    puzzleHost: async () => {
      calls.host += 1;
      return { ok: true, value: HOST };
    },
    puzzleUi: async () => {
      calls.ui += 1;
      return { ok: true, value: TYPE_UI };
    },
    cueStage: async () => {
      calls.stage += 1;
      log.push('stage');
      frameUi.push(puzzle.frame?.ui ?? null);
      return { ok: true, value: STAGE };
    },
    ...o.loaders,
  };
  const host: YieldsHost = {
    vm,
    screens,
    tg: { haptic: { impact: () => {}, selection: () => {}, notify: (t) => haptics.push(`notify:${t}`) } },
    api: {
      getPuzzle: async () => (o.status === undefined ? { ok: false, error: { kind: 'network', detail: 'none' } } : { ok: true, value: o.status }),
      postAttempt: async () => {
        calls.attempts += 1;
        await o.attemptGate;
        return answers.shift() ?? { ok: true, value: { correct: false, solved: false, attemptsLeft: null, spent: false } };
      },
    },
    scene: {
      preload: (tag, ids) => {
        log.push(`preload:${tag}`);
        holders.set(tag, new Set(ids));
      },
      releasePreload: (tag) => {
        log.push(`release:${tag}`);
        for (const t of [...holders.keys()]) {
          if (tag.endsWith(':') ? t.startsWith(tag) : t === tag) {
            holders.delete(t);
          }
        }
      },
      snapshot: () => stage,
      stats: () => sceneStats(revive),
    },
    explore,
    puzzle,
    reporter: { record: (e) => events.push(e) },
    clock,
    chunks,
    hints: () => o.hints ?? null,
    // A stand-in: the controller reads only the two sizes of its box.
    stageHost: () => ({ clientWidth: 360, clientHeight: 640 }) as unknown as HTMLElement,
    chapter: () => ch,
    runner: () => ({
      enter: (knot, projection) => {
        log.push(`enter:${knot}`);
        entered.push({ knot, projection });
        return { ok: true, value: undefined };
      },
    }),
    text: (w) => w.ru,
    apply: async (visual: readonly VisualCommand[], audio: readonly AudioCommand[], started?: () => void) => {
      log.push(`apply:${visual.map((c) => c.kind).join(',')}|${audio.map((c) => c.kind).join(',')}`);
      batches.push([...visual]);
      for (const c of visual) {
        if (c.kind === 'bg') {
          stage = { ...stage, bg: c.bg, props: [] };
        } else if (c.kind === 'props') {
          stage = { ...stage, props: [...c.props] };
        } else if (c.kind === 'cg') {
          stage = { ...stage, cg: c.cg };
        }
      }
      if (o.late === true) {
        await new Promise<void>((resolve) => starts.push(resolve));
      }
      started?.();
    },
    bgm: () => null,
    continueStory: async () => {
      log.push('continue');
    },
    storyError: (e) => log.push(`storyError:${e.kind}`),
    autosave: () => log.push('autosave'),
    notice: () => log.push('notice'),
    tap: (fn) => fn(),
    queue: (fn) => fn(),
    sceneCues: (subscribe) => {
      sceneCalls += 1;
      subscribe('scene', (e) => {
        cues.push(e);
        views.push({ frame: puzzle.frame, host: puzzle.host, ladder: puzzle.ladder });
      });
    },
  };
  const yields = createYields(host);
  y = yields;
  const entered: Array<{ knot: string; projection: Readonly<Record<string, unknown>> }> = [];
  return {
    yields,
    host,
    vm,
    screens,
    explore,
    puzzle,
    log,
    batches,
    events,
    haptics,
    holders,
    calls,
    entered,
    cues,
    views,
    clock,
    frameUi,
    sceneCalls: () => sceneCalls,
    revive,
    /** Starts the oldest late batch. */
    release: (): void => starts.shift()?.(),
    stage: () => stage,
  };
}

/** Lets the promise callbacks queued so far run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 30; i += 1) {
    await Promise.resolve();
  }
}

/** The rooms of the manor section, entered from its yield. */
async function inHall(r: Rig): Promise<void> {
  await r.yields.onYield({ kind: 'explore', section: MANOR });
  expect(r.explore.layer).not.toBeNull();
}

const roomOf = (r: Rig): string | null => r.yields.world().room;

// ---------------------------------------------------------------------------------------------------------------
// Linear puzzles (F6, X8, D18)

test('yields: puzzle end projects then enters', async () => {
  const r = rig({ attempts: [{ ok: true, value: { correct: true, solved: true, attemptsLeft: null, spent: false } }] });
  await r.yields.onYield({ kind: 'puzzle', puzzle: DRAWER, then: AFTER });
  expect(r.puzzle.frame?.mode).toBe('linear');
  r.yields.host.ontry();
  await settle();
  // F6 step 6: the outcome reaches the world, then the projection, then the knot, then the story goes on.
  expect(r.entered).toEqual([{ knot: 'after', projection: expect.objectContaining({ pz_drawer: 1, pz_gate: 0 }) }]);
  expect(r.log.slice(r.log.indexOf('enter:after'))).toEqual(['enter:after', 'continue']);
  expect(r.events).toEqual([{ kind: 'puzzle_ended', chapterId: 'ch1', storyVersion: '0111111111111111', puzzle: 'drawer', outcome: 'solved' }]);
  expect(r.puzzle.frame).toBeNull();
  r.yields.dispose();
});

test('yields: puzzle end clears the close-up', async () => {
  const r = rig({ attempts: [{ ok: true, value: { correct: true, solved: true, attemptsLeft: null, spent: false } }] });
  await r.yields.onYield({ kind: 'puzzle', puzzle: DRAWER, then: AFTER });
  expect(r.stage().cg).toBe('drawer_close');
  r.yields.host.ontry();
  await settle();
  expect(r.stage().cg).toBeNull();
  expect(r.log.filter((l) => l.startsWith('apply:cg'))).toEqual(['apply:cg|', 'apply:cg|']);
  r.yields.dispose();
});

test('yields: a run at max attempts ends failed without a session', async () => {
  const r = rig();
  const spent: WorldState = { ...EMPTY_WORLD_STATE, puzzles: { [DRAWER]: { outcome: null, attempts: 2, hintsOpened: 0 } } };
  r.yields.restore(spent, null, null);
  await r.yields.onYield({ kind: 'puzzle', puzzle: DRAWER, then: AFTER });
  // D18: no session, no frame, no attempt; the run ends failed and the story goes on with pz_drawer = 2.
  expect([r.puzzle.frame, r.calls.host, r.calls.attempts]).toEqual([null, 0, 0]);
  expect(r.events.map((e) => (e.kind === 'puzzle_ended' ? e.outcome : e.kind))).toEqual(['failed']);
  expect(r.entered).toEqual([{ knot: 'after', projection: expect.objectContaining({ pz_drawer: 2 }) }]);
  r.yields.dispose();
});

test('yields: a linear wrong answer counts in the world', async () => {
  const r = rig();
  await r.yields.onYield({ kind: 'puzzle', puzzle: DRAWER, then: AFTER });
  r.yields.host.ontry();
  await settle();
  // The rig's default answer is wrong: the run stays open, and its count is the one a reload's D18 limit reads.
  expect(r.calls.attempts).toBe(1);
  expect(r.yields.world().puzzles[DRAWER]).toEqual({ outcome: null, attempts: 1, hintsOpened: 0 });
  r.yields.dispose();
});

test('yields: a linear hint use counts in the world', async () => {
  const used: number[] = [];
  const port: HintPort = {
    balance: () => 3,
    tierCost: () => 1,
    use: async (_puzzle, tier) => {
      used.push(tier);
      return { ok: true, value: { text: 'hint', balance: 2 } };
    },
    getMore: () => {},
  };
  const r = rig({ status: { puzzleId: 'ch1.drawer', solved: false, hints: [{ tier: 1, unlocked: false, text: null }], valueRun: null }, hints: port });
  await r.yields.onYield({ kind: 'puzzle', puzzle: DRAWER, then: AFTER });
  r.yields.host.onhint();
  await settle();
  r.yields.host.onusehint(1);
  await settle();
  // The spend went through, and the tier counts in the world (pz_drawer_hints projects it).
  expect(used).toEqual([1]);
  expect(r.yields.world().puzzles[DRAWER]).toEqual({ outcome: null, attempts: 0, hintsOpened: 1 });
  r.yields.dispose();
});

// ---------------------------------------------------------------------------------------------------------------
// Exploration (F7, X12, X13, D20, K47-K51)

test('yields: event return restores the room', async () => {
  const r = rig();
  await inHall(r);
  expect(r.stage().bg).toBe('hall');
  expect(r.stage().props.map((p) => p.prop)).toEqual(['medal']);
  // K51: a take is a success haptic and an item that does not fit the box's slot an error haptic, both the cue stage's
  // on top of their cues' motions ("stage: a haptic plays only on top of a motion"): yields plays none of its own.
  r.yields.layer.ontap(key('hall.key'));
  await settle();
  r.yields.layer.ontap(key('hall.box'));
  await settle();
  expect(r.explore.panel).toEqual({ kind: 'lock' });
  r.yields.layer.oninsert(key('hall.box'), 'key' as ItemId);
  await settle();
  expect(r.haptics).toEqual([]);
  r.screens.back(); // the lock panel closes with Back
  expect(r.explore.panel).toBeNull();
  // Into the study: its onEnter runs an event knot; the rooms hide for it.
  r.yields.layer.ontap(key('hall.to_study'));
  await settle();
  expect(r.entered.map((e) => e.knot)).toEqual(['study_event']);
  expect(r.explore.layer).toBeNull();
  const mark = r.log.length;
  // The event knot's own explore yield: the room returns, the root-back with it, then the neighbours (K47).
  await r.yields.onYield({ kind: 'explore', section: MANOR });
  expect(roomOf(r)).toBe('study');
  expect(r.explore.layer).not.toBeNull();
  expect(r.vm.screens.backVisible).toBe(true);
  const since = r.log.slice(mark);
  expect(since.indexOf('preload:room:study')).toBeGreaterThan(since.findIndex((l) => l.startsWith('apply:')));
  r.yields.dispose();
});

test('yields: a take removes its prop from the stage', async () => {
  const r = rig();
  await inHall(r);
  expect(r.stage().props.map((p) => p.prop)).toEqual(['medal']);
  const mark = r.batches.length;
  r.yields.layer.ontap(key('hall.medal'));
  await settle();
  // B-001: the taken medal leaves the room on screen at once, faded over the bg already shown (Q53), not at re-entry.
  expect(r.stage().props).toEqual([]);
  expect(r.batches.slice(mark)).toEqual([[{ kind: 'bg', bg: 'hall', t: 'crossfade', ms: TAKE_FADE_MS }, { kind: 'props', props: [] }]]);
  // A take without a prop changes no picture: no batch.
  r.yields.layer.ontap(key('hall.key'));
  await settle();
  expect(r.batches.length - mark).toBe(1);
  expect(r.yields.world().taken).toEqual(['hall.medal', 'hall.key']);
  r.yields.dispose();
});

test("yields: a room batch's props carry their anchor key", async () => {
  const r = rig();
  await inHall(r);
  // Engine plan §5.2 / R-A4: a prop's anchor is its hotspot key, `<room>.<hotspot>`, so the saved stage keeps it.
  const medal = [{ prop: 'medal', rect: [100, 200, 200, 200], at: 'hall.medal' }];
  expect(r.stage().props).toEqual(medal);
  expect(r.batches.flat().filter((c) => c.kind === 'props')).toEqual([{ kind: 'props', props: medal }]);
  r.yields.dispose();
});

/** hall and den over one background, each with the medal's prop at the same rect on its own hotspot. */
function twinWorld(): WorldPublic {
  const raw = {
    format: 1,
    items: { medal: { name: txt('Медаль'), desc: txt('d'), glyph: 'sun' }, coin: { name: txt('Монета'), desc: txt('d'), glyph: 'sun' } },
    docs: {},
    puzzles: {},
    sections: {
      manor: {
        start: 'hall',
        bgm: null,
        rooms: {
          hall: { bg: 'hall', title: txt('Hall'), onEnter: [], hotspots: [exit('to_den', 'den'), take('medal', 'medal', 'medal')] },
          den: { bg: 'hall', title: txt('Den'), onEnter: [], hotspots: [exit('to_hall', 'hall'), take('twin', 'coin', 'medal')] },
        },
      },
    },
  };
  const r = decodeWorldSource(raw);
  if (!r.ok) {
    throw new Error(`invariant: the fixture world decodes: ${JSON.stringify(r.error)}`);
  }
  return { ...toPublic(r.value), mods: r.value.mods, version: '3333333333333333' };
}

test('yields: a room batch redraws props whose anchor changed', async () => {
  const r = rig({ world: twinWorld() });
  await inHall(r);
  expect(r.stage().props).toEqual([{ prop: 'medal', rect: RECT, at: 'hall.medal' }]);
  const mark = r.batches.length;
  r.yields.layer.ontap(key('hall.to_den'));
  await settle();
  // The same prop at the same rect over the same background, on another hotspot: the batch redraws it there.
  const den = [{ prop: 'medal', rect: RECT, at: 'den.twin' }];
  expect([roomOf(r), r.stage().props]).toEqual(['den', den]);
  expect(r.batches.slice(mark).flat().filter((c) => c.kind === 'props')).toEqual([{ kind: 'props', props: den }]);
  r.yields.dispose();
});

test('yields: an at-less stage prop equals its anchored placement', async () => {
  const r = rig({ world: twinWorld() });
  await inHall(r);
  // A format-1 save's stage: the same prop and rect with no anchor (`PropPlacementV1`).
  await r.host.apply([{ kind: 'props', props: [{ prop: 'medal' as PropId, rect: [100, 200, 200, 200] as const }] }], []); // RECT, at no anchor
  const mark = r.batches.length;
  r.yields.layer.ontap(key('hall.to_den'));
  await settle();
  // The den's anchored placement is that picture: the room batch draws no props.
  expect(roomOf(r)).toBe('den');
  expect(r.batches.slice(mark).flat().filter((c) => c.kind === 'props')).toEqual([]);
  r.yields.dispose();
});

test('yields: back during an event knot does not move rooms', async () => {
  const r = rig();
  await inHall(r);
  r.yields.layer.ontap(key('hall.to_study'));
  await settle();
  // The event knot runs: the root-back is cleared, and a press moves nothing.
  expect(r.vm.screens.backVisible).toBe(false);
  const mark = r.log.length;
  r.screens.back();
  await settle();
  expect(roomOf(r)).toBe('study');
  expect(r.log.slice(mark).filter((l) => l.startsWith('apply:'))).toEqual([]);
  r.yields.dispose();
});

test('yields: the root-back returns after a notice', async () => {
  const r = rig();
  await inHall(r);
  r.yields.layer.ontap(key('hall.to_study'));
  await settle();
  await r.yields.onYield({ kind: 'explore', section: MANOR }); // the event returned: a path of one room
  expect(r.vm.screens.backVisible).toBe(true);
  r.screens.setRoot({ kind: 'notice' });
  r.screens.setRoot({ kind: 'game' }); // setRoot clears the root-back (screens.ts)
  expect(r.vm.screens.backVisible).toBe(false);
  r.yields.rootShown();
  expect(r.vm.screens.backVisible).toBe(true);
  r.screens.back(); // and it walks the path
  await settle();
  expect(roomOf(r)).toBe('hall');
  r.yields.dispose();
});

test('yields: lazy chunks are prefetched after the first line', () => {
  const r = rig();
  expect([r.calls.explore, r.calls.host]).toEqual([0, 0]);
  r.yields.lineShown();
  expect([r.calls.explore, r.calls.host]).toEqual([1, 1]);
  r.yields.lineShown(); // once per chapter
  expect([r.calls.explore, r.calls.host]).toEqual([1, 1]);
  r.yields.dispose();
});

// ---------------------------------------------------------------------------------------------------------------
// W2 (b): the area-reset toast (PP:5301-5302, X9)

const AREA_RESET = 'Этот раздел начался заново';
const resetShown = (r: Rig): boolean => r.vm.toasts.some((e) => e.kind === 'note' && e.message === AREA_RESET);

test('yields: a resume reset shows the area reset toast', () => {
  const r = rig();
  r.yields.restore(EMPTY_WORLD_STATE, null, null);
  expect(resetShown(r)).toBe(false);
  r.yields.restore(EMPTY_WORLD_STATE, MANOR, null);
  expect(resetShown(r)).toBe(true);
  r.yields.dispose();
});

test('yields: a controller reset effect shows the area reset toast', async () => {
  // admitSection restarting an unproved section is the controller's (controller.test.ts); here it says so.
  const create: ExploreChunk['create'] = (deps) => {
    const real: ExploreController = createExploreController(deps);
    return {
      ...real,
      enter: (section, state) => {
        real.enter(section, state);
        emit({ kind: 'reset', section });
      },
      onEffect: (fn) => {
        listeners.push(fn);
        return real.onEffect(fn);
      },
    };
  };
  const listeners: Array<Parameters<ExploreController['onEffect']>[0]> = [];
  const emit: Parameters<ExploreController['onEffect']>[0] = (e) => {
    for (const fn of listeners) {
      fn(e);
    }
  };
  const r = rig({ create });
  await inHall(r);
  expect(resetShown(r)).toBe(true);
  r.yields.dispose();
  expect([observers, disconnected]).toEqual([1, 1]);
});

// ---------------------------------------------------------------------------------------------------------------
// The cue channel (engine plan §8.1, GM3s): the session's bus, the effects mapped to cues, the stage's slot

/** The world, module and panel cues the bus carried (the waits and moves have their own tests), with their boxes. */
const worldCues = (r: Rig): Array<Pick<CueEvent, 'cue' | 'box'>> =>
  r.cues
    .filter((e) => e.cue.kind === 'fact' || e.cue.kind === 'module' || (e.cue.kind === 'ui-state' && e.cue.name === 'panel-open'))
    .map((e) => ({ cue: e.cue, box: e.box }));

/** The stage box of a hotspot's button now (the controller's cover-mapped box). */
const boxOf = (r: Rig, k: string): CueEvent['box'] => r.explore.hotspots.find((h) => h.key === k)?.css ?? null;

const tapCause = (at: string): Record<string, unknown> => ({ verb: 'tap', at, item: null, via: null });

test("yields: today's effects reach the cue bus", async () => {
  const r = rig({ world: cueWorld() });
  await inHall(r);
  const step = async (run: () => void): Promise<Array<Pick<CueEvent, 'cue' | 'box'>>> => {
    const mark = worldCues(r).length;
    run();
    await settle();
    return worldCues(r).slice(mark);
  };
  const fact = (kind: string, id: string, at: string, via: string | null = null): Record<string, unknown> => ({
    kind: 'fact',
    fact: { kind, id },
    change: 'added',
    cause: { ...tapCause(at), via },
  });
  // A look is core's `look` at its hotspot, then the writer's `examined`, on its box.
  const desk = boxOf(r, 'hall.desk');
  expect(await step(() => r.yields.layer.ontap(key('hall.desk')))).toEqual([
    { cue: { kind: 'module', module: 'core', name: 'look', at: 'hall.desk', item: null }, box: desk },
    { cue: fact('examined', 'hall.desk', 'hall.desk'), box: desk },
  ]);
  // A take: the item is held and the hotspot taken, by a tap at its hotspot; a document gift likewise.
  const medal = boxOf(r, 'hall.medal');
  expect(await step(() => r.yields.layer.ontap(key('hall.medal')))).toEqual([
    { cue: fact('held', 'medal', 'hall.medal'), box: medal },
    { cue: fact('taken', 'hall.medal', 'hall.medal'), box: medal },
  ]);
  const letter = boxOf(r, 'hall.letter');
  expect(await step(() => r.yields.layer.ontap(key('hall.letter')))).toEqual([
    { cue: fact('doc', 'letter', 'hall.letter'), box: letter },
    { cue: fact('taken', 'hall.letter', 'hall.letter'), box: letter },
  ]);
  // A tap on a locked hotspot opens its panel: the panel's own cue, at the write that opens it.
  expect(await step(() => r.yields.layer.ontap(key('hall.box')))).toEqual([
    { cue: { kind: 'ui-state', name: 'panel-open', panel: 'lock', item: null }, box: null },
  ]);
  // An item that does not fit: core's `refused` at the lock, with the item.
  const lock = boxOf(r, 'hall.box');
  r.yields.layer.ontap(key('hall.key'));
  await settle();
  expect(await step(() => r.yields.layer.oninsert(key('hall.box'), 'key' as ItemId))).toEqual([
    { cue: { kind: 'module', module: 'core', name: 'refused', at: 'hall.box', item: 'key' }, box: lock },
  ]);
  r.screens.back();
  // A room whose onEnter runs an event knot: the visit, then its trigger and the story fact (`via` the trigger), by the
  // tap on the exit.
  const door = boxOf(r, 'hall.to_study');
  expect(await step(() => r.yields.layer.ontap(key('hall.to_study')))).toEqual([
    { cue: fact('visited', 'study', 'hall.to_study'), box: door },
    { cue: fact('fired', 'enter:study', 'hall.to_study', 'enter:study'), box: door },
    { cue: fact('story', 'study_event', 'hall.to_study', 'enter:study'), box: door },
  ]);
  r.yields.dispose();

  // A section that restarted (admitSection's `reset`, never emitted by reduce): core's `reset`, over the stage.
  const create: ExploreChunk['create'] = (deps) => {
    const real = createExploreController(deps);
    let emit: Parameters<ExploreController['onEffect']>[0] | null = null;
    return {
      ...real,
      enter: (section, state) => {
        real.enter(section, state);
        emit?.({ kind: 'reset', section });
      },
      onEffect: (fn) => {
        emit = fn;
        return real.onEffect(fn);
      },
    };
  };
  const reset = rig({ create });
  await inHall(reset);
  // The section's entry first: its visit, caused by the entry (no hotspot, no box).
  expect(worldCues(reset)).toEqual([
    { cue: { kind: 'fact', fact: { kind: 'visited', id: 'hall' }, change: 'added', cause: { verb: 'enter', at: null, item: null, via: null } }, box: null },
    { cue: { kind: 'module', module: 'core', name: 'reset', at: null, item: null }, box: null },
  ]);
  reset.yields.dispose();
});

test('yields: the cue stage loads before a section or a puzzle opens', async () => {
  // A section: the stage's chunk is requested with the explore chunk, before the first room batch.
  const r = rig();
  expect(r.vm.cueStage).toBeNull();
  await inHall(r);
  expect(r.calls.stage).toBe(1);
  expect(r.log.indexOf('stage')).toBeLessThan(r.log.findIndex((l) => l.startsWith('apply:')));
  expect(r.vm.cueStage?.component).toBe(STAGE);
  r.yields.dispose();
  // The slot is written when the stage's own chunk settles, not after the explore chunk's: the stage is mounted while
  // the explore import runs, so the import's hold can show (critique W2).
  let open = (): void => {};
  const gated = rig({ exploreGate: new Promise<void>((resolve) => (open = resolve)) });
  const entering = gated.yields.onYield({ kind: 'explore', section: MANOR });
  await settle();
  expect(gated.explore.layer).toBeNull();
  expect(gated.vm.cueStage?.component).toBe(STAGE);
  open();
  await entering;
  expect(gated.explore.layer).not.toBeNull();
  gated.yields.dispose();
  // A puzzle: requested with the host and type chunks, before the frame's type UI is written.
  const p = rig();
  await p.yields.onYield({ kind: 'puzzle', puzzle: DRAWER, then: AFTER });
  expect(p.frameUi).toEqual([null]);
  expect(p.puzzle.frame?.ui).toBe(TYPE_UI);
  expect(p.vm.cueStage?.component).toBe(STAGE);
  p.yields.dispose();
});

test("yields: the scene role gets the session's cue subscription once", async () => {
  const r = rig({ world: cueWorld() });
  // Right after the bus exists: before any step of the session.
  expect(r.sceneCalls()).toBe(1);
  await inHall(r);
  r.yields.layer.ontap(key('hall.medal')); // a take: a cue and a batch
  await settle();
  await r.yields.onYield({ kind: 'puzzle', puzzle: DRAWER, then: AFTER });
  expect(r.sceneCalls()).toBe(1);
  // The subscription carries the session's cues: the hall's visit, then the take's held and taken, then the drawer
  // frame's appearance (GM3p: yields' own `panel-open` at the write that shows it).
  expect(worldCues(r).map((e) => e.cue.kind)).toEqual(['fact', 'fact', 'fact', 'ui-state']);
  r.yields.dispose();
});

test('yields: dispose leaves no cue subscriber', async () => {
  // A late effect: the controller's listener called after the session ended.
  const listener: { fn: Parameters<ExploreController['onEffect']>[0] | null } = { fn: null };
  const create: ExploreChunk['create'] = (deps) => {
    const real = createExploreController(deps);
    return {
      ...real,
      onEffect: (fn) => {
        listener.fn = fn;
        return real.onEffect(fn);
      },
    };
  };
  const r = rig({ create });
  await inHall(r);
  // A late look cue (the writer's record; a `look` effect itself plays no cue).
  const looked: ExploreEffect = { kind: 'cue', cue: coreCue('look', 'study.desk' as HotspotKey, null) };
  // Control: while the session lives, such an effect reaches the scene role.
  const before = r.cues.length;
  listener.fn?.(looked);
  expect(r.cues.length).toBe(before + 1);
  // D1: the explore root's emit is this session's bus, and the session clears its own at dispose.
  const tapped: CueEvent = { cue: { kind: 'ui', control: 'hotspot', item: null, index: null }, box: null, point: null, diff: [], el: null };
  r.explore.oncue?.(tapped);
  expect(r.cues.at(-1)).toBe(tapped);
  r.yields.dispose();
  listener.fn?.(looked);
  expect(r.cues.length).toBe(before + 2);
  expect(r.explore.oncue).toBeUndefined();
});

test('yields: a disposed session clears the cue stage slot', async () => {
  const r = rig();
  await inHall(r);
  const first = r.vm.cueStage;
  expect(first?.component).toBe(STAGE);
  // A second session on the same view model writes its own slot.
  const second = createYields(r.host);
  await second.onYield({ kind: 'explore', section: MANOR });
  const own = r.vm.cueStage;
  expect(own).not.toBeNull();
  expect(own).not.toBe(first);
  // The first session's late dispose leaves the second's slot; the second's own dispose clears it.
  r.yields.dispose();
  expect(r.vm.cueStage).toBe(own);
  second.dispose();
  expect(r.vm.cueStage).toBeNull();
});

test("yields: a module cue's name is one its rules half declares", () => {
  // GM3m review M2: a module cue whose name its rules half lacks has no motion row, and the stage would throw in the
  // bus emit. The yields' one builder takes core's declared names only.
  expect(coreCue('look', key('hall.desk'), null)).toEqual({ kind: 'module', module: 'core', name: 'look', at: 'hall.desk', item: null });
  // @ts-expect-error -- `opened` is no cue of core's rules half (a puzzle key): refused by type.
  expect(coreCue('opened', null, null).name).toBe('opened');
});

// ---------------------------------------------------------------------------------------------------------------
// The batch site and the moves (engine plan §8.1 "The frame's flags and its ends", point 11; rounds 4, 5, 12-14)

/** A cue's key, as the cue stage keys its motion. */
function keyOf(c: Cue): string {
  switch (c.kind) {
    case 'fact':
      return `fact:${c.fact.kind}:${c.change}`;
    case 'move':
      return `move:${c.how}`;
    case 'module':
      return `module:${c.module}:${c.name}`;
    case 'ui':
      return `ui:${c.control}`;
    case 'ui-state':
      return `ui-state:${c.name}`;
    case 'puzzle':
      return `puzzle:${c.name}`;
    default: {
      const never: never = c;
      return never;
    }
  }
}

/** The keys the bus carried from the `from`-th cue on. */
const keysOf = (r: Rig, from = 0): string[] => r.cues.slice(from).map((e) => keyOf(e.cue));

/** The rooms of the cue world, entered with a late batch released. */
async function inLateHall(r: Rig): Promise<void> {
  const entering = r.yields.onYield({ kind: 'explore', section: MANOR });
  await settle();
  r.release();
  await entering;
  expect(r.explore.layer).not.toBeNull();
}

test('yields: a batch that waits on a load emits waiting, then waited', async () => {
  const r = rig({ world: cueWorld(), late: true });
  await inLateHall(r);
  // The take batch: the hold opens at the taken hotspot's box and closes when the batch starts.
  const medal = boxOf(r, 'hall.medal');
  let mark = r.cues.length;
  r.yields.layer.ontap(key('hall.medal'));
  await settle();
  expect(keysOf(r, mark)).toEqual(['fact:held:added', 'fact:taken:added', 'ui-state:waiting']);
  expect(r.cues.at(-1)?.box).toEqual(medal);
  r.release();
  await settle();
  expect(keysOf(r, mark)).toEqual(['fact:held:added', 'fact:taken:added', 'ui-state:waiting', 'ui-state:waited']);
  // The room batch: at the exit's box (the move cues have their own tests).
  const door = boxOf(r, 'hall.to_cellar');
  mark = r.cues.length;
  r.yields.layer.ontap(key('hall.to_cellar'));
  await settle();
  expect(keysOf(r, mark)).toEqual(['ui-state:waiting']);
  expect(r.cues.at(-1)?.box).toEqual(door);
  r.release();
  await settle();
  expect(keysOf(r, mark).slice(0, 2)).toEqual(['ui-state:waiting', 'ui-state:waited']);
  r.yields.layer.ontap(key('cellar.to_hall'));
  await settle();
  r.release();
  await settle();
  // The close-up in (an exploration puzzle's), then out at its X8 Back (`onEnd`'s closed branch): at the centre.
  mark = r.cues.length;
  r.yields.layer.ontap(key('hall.chest'));
  await settle();
  expect(keysOf(r, mark)).toEqual(['ui-state:waiting']);
  expect(r.cues.at(-1)?.box).toBeNull();
  r.release();
  await settle();
  // GM3p: then the frame's own load hold (its write, its chunk write), its appearance and its type UI.
  expect(keysOf(r, mark)).toEqual(['ui-state:waiting', 'ui-state:waited', 'ui-state:waiting', 'ui-state:waited', 'ui-state:panel-open', 'puzzle:opened']);
  expect(r.puzzle.frame?.mode).toBe('explore');
  mark = r.cues.length;
  r.screens.back();
  await settle();
  // GM3p: the X8 Back hides the frame (its end cue), then the close-up's hold.
  expect(keysOf(r, mark)).toEqual(['puzzle:closed', 'ui-state:waiting']);
  expect(r.cues.at(-1)?.box).toBeNull();
  r.release();
  await settle();
  expect(keysOf(r, mark)).toEqual(['puzzle:closed', 'ui-state:waiting', 'ui-state:waited']);
  expect(r.stage().cg).toBeNull();
  r.yields.dispose();

  // The close-up out at a run's end (`ended`): a linear puzzle solved.
  const p = rig({ late: true, attempts: [{ ok: true, value: { correct: true, solved: true, attemptsLeft: null, spent: false } }] });
  const opening = p.yields.onYield({ kind: 'puzzle', puzzle: DRAWER, then: AFTER });
  await settle();
  p.release();
  await opening;
  mark = p.cues.length;
  p.yields.host.ontry();
  await settle();
  // GM3p: the attempt's check and the frame's end cue come first.
  expect(keysOf(p, mark)).toEqual(['puzzle:checking', 'puzzle:solved', 'ui-state:waiting']);
  expect(p.cues.at(-1)?.box).toBeNull();
  p.release();
  await settle();
  expect(keysOf(p, mark)).toEqual(['puzzle:checking', 'puzzle:solved', 'ui-state:waiting', 'ui-state:waited']);
  expect(p.entered.map((e) => e.knot)).toEqual(['after']);
  p.yields.dispose();

  // `'no-load'`: a batch that adds no image holds nothing, unless a revive runs or a texture is stale (the stage's
  // `ensure` then waits on it): then it holds at the centre.
  const emitted: CueEvent[] = [];
  const revive = { stale: 0, reviving: false };
  const held = heldBy(
    {
      apply: async (_visual, _audio, started) => {
        started?.();
      },
      scene: { preload: () => {}, releasePreload: () => {}, snapshot: () => ({ bg: null, cg: null, chars: [], bgm: null, props: [] }), stats: () => sceneStats(revive) },
    },
    (e) => emitted.push(e),
  );
  const noLoad = async (s: { stale: number; reviving: boolean }): Promise<Array<Pick<CueEvent, 'cue' | 'box'>>> => {
    Object.assign(revive, s);
    emitted.length = 0;
    await held([], [], 'no-load');
    return emitted.map((e) => ({ cue: e.cue, box: e.box }));
  };
  const pair = [
    { cue: { kind: 'ui-state', name: 'waiting', panel: null, item: null }, box: null },
    { cue: { kind: 'ui-state', name: 'waited', panel: null, item: null }, box: null },
  ];
  expect(await noLoad({ stale: 0, reviving: false })).toEqual([]);
  expect(await noLoad({ stale: 0, reviving: true })).toEqual(pair);
  expect(await noLoad({ stale: 1, reviving: false })).toEqual(pair);
  expect(await noLoad({ stale: 0, reviving: false })).toEqual([]);
});

test('yields: a move cue plays when its batch starts', async () => {
  const r = rig({ world: cueWorld(), late: true });
  await inLateHall(r);
  const door = boxOf(r, 'hall.to_cellar');
  let mark = r.cues.length;
  r.yields.layer.ontap(key('hall.to_cellar'));
  await settle();
  // Built at the effect, while the hall is current; nothing of it plays while the batch loads.
  expect(keysOf(r, mark).filter((k) => k.startsWith('move:'))).toEqual([]);
  r.release();
  await settle();
  const move = r.cues.slice(mark).find((e) => e.cue.kind === 'move');
  expect(move).toEqual({ cue: { kind: 'move', from: 'hall', to: 'cellar', via: 'hall.to_cellar', how: 'walk' }, box: door, point: null, diff: [], el: null });
  // Back to the hall, then out of the section: `move:leave` at the exit's box, at once (no batch).
  r.yields.layer.ontap(key('cellar.to_hall'));
  await settle();
  r.release();
  await settle();
  const out = boxOf(r, 'hall.out');
  mark = r.cues.length;
  r.yields.layer.ontap(key('hall.out'));
  await settle();
  expect(r.cues.slice(mark).map((e) => ({ cue: e.cue, box: e.box }))).toEqual([
    { cue: { kind: 'move', from: 'hall', to: null, via: 'hall.out', how: 'leave' }, box: out },
  ]);
  expect(r.explore.layer).toBeNull();
  r.yields.dispose();
});

test('yields: a take emits exactly one held cue', async () => {
  // The writer's `held` alone: the `got` effect keeps its toast and batch, and no cue of its own.
  const r = rig({ world: cueWorld() });
  await inHall(r);
  const mark = r.cues.length;
  r.yields.layer.ontap(key('hall.medal'));
  await settle();
  expect(keysOf(r, mark).filter((k) => k.startsWith('fact:'))).toEqual(['fact:held:added', 'fact:taken:added']);
  r.yields.dispose();
});

test("yields: a lock puzzle's end plays its fact cues at the lock", async () => {
  const r = rig({ world: cueWorld(), attempts: [{ ok: true, value: { correct: true, solved: true, attemptsLeft: null, spent: false } }] });
  await inHall(r);
  const lock = boxOf(r, 'hall.box');
  r.yields.layer.ontap(key('hall.medal'));
  await settle();
  // The medal fills the box's one slot: its puzzle opens; solved, the lock opens.
  r.yields.layer.oninsert(key('hall.box'), 'medal' as ItemId);
  await settle();
  expect(r.puzzle.frame?.mode).toBe('explore');
  const mark = r.cues.length;
  r.yields.host.ontry();
  await settle();
  const facts = r.cues.slice(mark).filter((e) => e.cue.kind === 'fact');
  expect(lock).not.toBeNull();
  expect(facts.map((e) => [keyOf(e.cue), e.box])).toEqual([
    ['fact:solved:added', lock],
    ['fact:open:added', lock],
  ]);
  r.yields.dispose();
});

test("yields: a moving dispatch's cues play after its move cue", async () => {
  // The cellar's onEnter gives a coin: the gift's cue rides the move's batch and plays after its move cue.
  const r = rig({ world: cueWorld(), late: true });
  await inLateHall(r);
  const mark = r.cues.length;
  r.yields.layer.ontap(key('hall.to_cellar'));
  await settle();
  expect(keysOf(r, mark)).toEqual(['ui-state:waiting']);
  r.release();
  await settle();
  expect(keysOf(r, mark)).toEqual(['ui-state:waiting', 'ui-state:waited', 'move:walk', 'fact:visited:added', 'fact:fired:added', 'fact:held:added']);
  r.yields.dispose();
});

test("yields: an arrival's fact cues play with its move at the batch start", async () => {
  // The cellar walk, its batch late: nothing but the hold before it starts; then the move, and the arrival's facts
  // (the visit, the cellar's onEnter trigger and its gift) with it.
  const r = rig({ world: cueWorld(), late: true });
  await inLateHall(r);
  let mark = r.cues.length;
  r.yields.layer.ontap(key('hall.to_cellar'));
  await settle();
  expect(keysOf(r, mark)).toEqual(['ui-state:waiting']);
  r.release();
  await settle();
  expect(keysOf(r, mark)).toEqual(['ui-state:waiting', 'ui-state:waited', 'move:walk', 'fact:visited:added', 'fact:fired:added', 'fact:held:added']);
  const fired = r.cues.slice(mark).find((e) => keyOf(e.cue) === 'fact:fired:added')?.cue;
  expect(fired?.kind === 'fact' ? [fired.fact.id, fired.cause.verb, fired.cause.at, fired.cause.via] : null).toEqual(['enter:cellar', 'tap', 'hall.to_cellar', 'enter:cellar']);
  r.yields.dispose();

  // A controller that delivers a cue effect before the room effect of the same dispatch: it still plays after the move.
  const create: ExploreChunk['create'] = (deps) => {
    const real = createExploreController(deps);
    return {
      ...real,
      onEffect: (fn) =>
        real.onEffect((e) => {
          if (e.kind === 'room' && e.how === 'walk') {
            fn({ kind: 'cue', cue: coreCue('look', 'hall.to_cellar' as HotspotKey, null) });
          }
          fn(e);
        }),
    };
  };
  const early = rig({ world: cueWorld(), late: true, create });
  await inLateHall(early);
  mark = early.cues.length;
  early.yields.layer.ontap(key('hall.to_cellar'));
  await settle();
  expect(keysOf(early, mark)).toEqual(['ui-state:waiting']);
  early.release();
  await settle();
  expect(keysOf(early, mark)).toEqual(['ui-state:waiting', 'ui-state:waited', 'move:walk', 'module:core:look', 'fact:visited:added', 'fact:fired:added', 'fact:held:added']);
  early.yields.dispose();
});

test("yields: a section's first entry holds a motion while its chunk loads", async () => {
  let open = (): void => {};
  const r = rig({ exploreGate: new Promise<void>((resolve) => (open = resolve)) });
  const entering = r.yields.onYield({ kind: 'explore', section: MANOR });
  await settle();
  // The explore chunk loads: one hold, at the centre.
  expect(keysOf(r)).toEqual(['ui-state:waiting']);
  expect(r.cues[0]?.box).toBeNull();
  open();
  await entering;
  // It ends when the import settles, before the section's first room batch holds its own.
  expect(keysOf(r).slice(0, 3)).toEqual(['ui-state:waiting', 'ui-state:waited', 'ui-state:waiting']);
  r.yields.dispose();
});

// ---------------------------------------------------------------------------------------------------------------
// Loading the lazy chunks ahead (engine plan §8.1 "Loading"; D13)

test('yields: a resume onto a yield prefetches its chunks', async () => {
  const r = rig();
  // A resume onto a story line: its first line prefetches, as a fresh start's does.
  r.yields.restore(EMPTY_WORLD_STATE, null, null);
  expect([r.calls.explore, r.calls.host, r.calls.stage]).toEqual([0, 0, 0]);
  // A resume onto a yield shows no line first: the yield's chunks and the stage are requested at once.
  r.yields.restore(EMPTY_WORLD_STATE, null, { kind: 'explore', section: MANOR });
  expect([r.calls.explore, r.calls.host, r.calls.stage]).toEqual([1, 1, 1]);
  await settle();
  expect(r.vm.cueStage?.component).toBe(STAGE);
  r.yields.dispose();
});

test('yields: a yield step prefetches its chunks ahead of its transition', async () => {
  const r = rig();
  r.yields.ahead({ kind: 'puzzle', puzzle: DRAWER, then: AFTER });
  expect([r.calls.explore, r.calls.host, r.calls.stage]).toEqual([1, 1, 1]);
  await settle();
  // Once per chapter; the stage, once in, stays for the session.
  r.yields.ahead({ kind: 'explore', section: MANOR });
  r.yields.lineShown();
  expect([r.calls.explore, r.calls.host, r.calls.stage]).toEqual([1, 1, 1]);
  r.yields.chapterChanged();
  r.yields.ahead({ kind: 'explore', section: MANOR });
  expect([r.calls.explore, r.calls.host, r.calls.stage]).toEqual([2, 2, 1]);
  r.yields.dispose();
});

// ---------------------------------------------------------------------------------------------------------------
// The ribbon (engine plan §6.1 UI, §8.1 point 9; GM3u): the selection, the use from the ribbon, a refusal's default text

/**
 * The use fixture: the hall's desk runs a rule for the key (it gives a coin and keeps nothing), its shelf has no rule
 * and no lock, its chest is a lock for the map; neither the key nor the hall has a refusal text, the den has one.
 */
function useWorld(): WorldPublic {
  const raw = {
    format: 1,
    items: {
      key: { name: txt('Ключ'), desc: txt('d'), glyph: 'key' },
      map: { name: txt('Карта'), desc: txt('d'), glyph: 'letter' },
      coin: { name: txt('Монета'), desc: txt('d'), glyph: 'coin' },
    },
    docs: {},
    puzzles: {},
    sections: {
      manor: {
        start: 'hall',
        bgm: null,
        rooms: {
          hall: {
            bg: 'hall',
            title: txt('Hall'),
            onEnter: [],
            hotspots: [
              take('key', 'key', null),
              take('map', 'map', null),
              { ...look('desk'), uses: [{ item: 'key', do: [{ give: 'coin' }] }] },
              look('shelf'),
              { id: 'chest', kind: 'object', rect: RECT, label: txt('chest'), lock: { slots: [{ accepts: 'map' }], puzzle: null, locked: txt('locked'), onOpen: [], onFail: [] }, then: [], look: null, prop: null },
              exit('to_den', 'den'),
            ],
          },
          den: { bg: 'study', title: txt('Den'), onEnter: [], refuse: txt('den refuse'), hotspots: [exit('to_hall', 'hall'), look('crate')] },
        },
      },
    },
  };
  const r = decodeWorldSource(raw);
  if (!r.ok) {
    throw new Error(`invariant: the use fixture world decodes: ${JSON.stringify(r.error)}`);
  }
  return { ...toPublic(r.value), mods: r.value.mods, version: '3333333333333333' };
}

/** The ribbon's selection cues the bus carried from the `from`-th cue on: [name, item]. */
const selections = (r: Rig, from: number): Array<[string, string | null]> =>
  r.cues.slice(from).flatMap((e): Array<[string, string | null]> => (e.cue.kind === 'ui-state' && (e.cue.name === 'select' || e.cue.name === 'deselect') ? [[e.cue.name, e.cue.item]] : []));

test('yields: a ribbon selection writes the view and plays select and deselect', async () => {
  const r = rig({ world: cueWorld() });
  await inHall(r);
  r.yields.layer.ontap(key('hall.medal'));
  await settle();
  r.yields.layer.ontap(key('hall.key'));
  await settle();
  const medal = 'medal' as ItemId;
  const held = 'key' as ItemId;
  let mark = r.cues.length;
  r.yields.layer.onselect(medal);
  expect([r.explore.selected, selections(r, mark)]).toEqual([medal, [['select', 'medal']]]);
  // The ribbon's cue: no panel, no box (the stage finds the slot by its item).
  expect(r.cues.at(-1)).toEqual({ cue: { kind: 'ui-state', name: 'select', panel: null, item: 'medal' }, box: null, point: null, diff: [], el: null });
  // Another item: the old one settles back, then the new one lifts.
  mark = r.cues.length;
  r.yields.layer.onselect(held);
  expect([r.explore.selected, selections(r, mark)]).toEqual([held, [['deselect', 'medal'], ['select', 'key']]]);
  // The selected item again toggles it off; a deselect with nothing selected plays nothing.
  mark = r.cues.length;
  r.yields.layer.onselect(held);
  r.yields.layer.ondeselect();
  expect([r.explore.selected, selections(r, mark)]).toEqual([null, [['deselect', 'key']]]);
  r.yields.layer.onselect(medal);
  mark = r.cues.length;
  r.yields.layer.ondeselect();
  expect([r.explore.selected, selections(r, mark)]).toEqual([null, [['deselect', 'medal']]]);
  // An item that leaves the hands another way (the lock panel's insert) takes the selection with it, silently.
  r.yields.layer.onselect(medal);
  mark = r.cues.length;
  r.yields.layer.oninsert(key('hall.box'), medal);
  await settle();
  expect([r.yields.world().used, r.explore.selected, selections(r, mark)]).toEqual([['medal'], null, []]);
  // A resume drops the rooms and the selection with them, silently.
  r.yields.layer.onselect(held);
  mark = r.cues.length;
  r.yields.restore(r.yields.world(), null, null);
  expect([r.explore.selected, selections(r, mark)]).toEqual([null, []]);
  // A resume into the rooms keeps the controller (no dispose), so the resume's own clear is the one that takes it.
  r.yields.layer.onselect(held);
  mark = r.cues.length;
  r.yields.restore(r.yields.world(), null, { kind: 'explore', section: MANOR });
  expect([r.explore.selected, selections(r, mark)]).toEqual([null, []]);
  // A chapter change disposes the controller, whose clear takes it (no resume follows to clear it).
  r.yields.layer.onselect(held);
  mark = r.cues.length;
  r.yields.chapterChanged();
  expect([r.explore.selected, selections(r, mark)]).toEqual([null, []]);
  r.yields.dispose();
  // The rooms left for a knot: the selection goes with them, silently.
  const out = rig({ world: cueWorld() });
  await inHall(out);
  out.yields.layer.ontap(key('hall.key'));
  await settle();
  out.yields.layer.onselect(held);
  mark = out.cues.length;
  out.yields.layer.ontap(key('hall.out'));
  await settle();
  expect([out.explore.layer, out.explore.selected, selections(out, mark)]).toEqual([null, null, []]);
  out.yields.dispose();
});

test('yields: a use from the ribbon deselects and runs the rule', async () => {
  const r = rig({ world: useWorld() });
  await inHall(r);
  r.yields.layer.ontap(key('hall.key'));
  await settle();
  const held = 'key' as ItemId;
  r.yields.layer.onselect(held);
  const mark = r.cues.length;
  r.yields.layer.onuse(held, key('hall.desk'));
  await settle();
  // One block: the selection settles, then the rule's writes and its `said`, each on the desk's box.
  expect(r.explore.selected).toBeNull();
  expect(keysOf(r, mark)).toEqual(['ui-state:deselect', 'fact:held:removed', 'fact:used:added', 'fact:fired:added', 'fact:held:added', 'module:use:said']);
  expect(r.cues.slice(mark + 1).map((e) => e.box)).toEqual(Array.from({ length: 5 }, () => boxOf(r, 'hall.desk')));
  expect([r.yields.world().held, r.yields.world().used]).toEqual([['coin'], ['key']]);
  r.yields.dispose();
});

test('yields: a refused use with no text shows the mechanics default', async () => {
  const r = rig({ world: useWorld() });
  await inHall(r);
  r.yields.layer.ontap(key('hall.key'));
  await settle();
  const held = 'key' as ItemId;
  /** The texts of the toast a look shows (`key: 'look'`, one at a time). */
  const looks = (): string[] => r.vm.toasts.flatMap((e) => (e.key === 'look' && e.kind === 'note' ? [e.message] : []));
  // The shelf: no rule for the key and no lock; neither the key nor the hall says why: the UI's default.
  r.yields.layer.onselect(held);
  r.yields.layer.onuse(held, key('hall.shelf'));
  await settle();
  const { mechT } = await import('../i18n/mechanics.ts');
  expect(looks()).toEqual([mechT('ru', 'mech.use_refused')]);
  expect(r.yields.world().held).toEqual(['key']);
  // Core's refusal (an insert that does not fit) shows no default: the lock panel says it there.
  r.vm.dismissToast('look');
  r.yields.layer.oninsert(key('hall.chest'), held);
  await settle();
  expect(looks()).toEqual([]);
  // A refusal with a text of its own: the den's replaces the default (its `look` follows `refused` in the same block).
  r.yields.layer.ontap(key('hall.to_den'));
  await settle();
  r.yields.layer.onuse(held, key('den.crate'));
  await settle();
  expect(looks()).toEqual(['den refuse']);
  r.yields.dispose();
});

// ---------------------------------------------------------------------------------------------------------------
// The screens diff (engine plan §8.1 point 10; GM3u): a panel's cues follow the screens stack, whoever pushed it

/** A panel cue of the screens diff. */
const isPanelCue = (e: CueEvent): boolean => e.cue.kind === 'ui-state' && (e.cue.name === 'panel-open' || e.cue.name === 'panel-close');
/** The panel cues the bus carried from the `from`-th cue on, as `name:panel`. */
const panelCues = (r: Rig, from: number): string[] =>
  r.cues.slice(from).flatMap((e) => (e.cue.kind === 'ui-state' && isPanelCue(e) ? [`${e.cue.name}:${e.cue.panel}`] : []));

test('yields: the screens diff emits panel-open and panel-close', async () => {
  const r = rig({ world: cueWorld() });
  await inHall(r);
  const step = async (run: () => void): Promise<string[]> => {
    const mark = r.cues.length;
    run();
    await settle();
    return panelCues(r, mark);
  };
  // The lock: one open at the tap that pushes its panel (the opener adds none of its own), one close at Back.
  expect(await step(() => r.yields.layer.ontap(key('hall.box')))).toEqual(['panel-open:lock']);
  expect(await step(() => r.screens.back())).toEqual(['panel-close:lock']);
  // The inventory and the reader over it: each its own; the reader's close leaves the inventory open.
  expect(await step(() => r.yields.layer.ontap(key('hall.letter')))).toEqual([]);
  expect(await step(() => r.yields.layer.oninventory())).toEqual(['panel-open:inventory']);
  expect(await step(() => r.yields.layer.onread('letter' as DocId))).toEqual(['panel-open:document']);
  expect(await step(() => r.yields.layer.onclose())).toEqual(['panel-close:document']);
  expect(await step(() => r.screens.back())).toEqual(['panel-close:inventory']);
  // An exploration puzzle is no screens-diff panel: its frame's appearance is yields' own `panel-open` (GM3p, from
  // the write that shows it), and its X8 Back adds none (its leave is its end cue). The hint ladder over it is one (its
  // live target is HintLadder's marker).
  expect(await step(() => r.yields.layer.ontap(key('hall.chest')))).toEqual(['panel-open:puzzle']);
  expect(r.puzzle.frame?.mode).toBe('explore');
  expect(await step(() => r.yields.host.onhint())).toEqual(['panel-open:hints']);
  expect(await step(() => r.screens.back())).toEqual(['panel-close:hints']);
  expect(await step(() => r.screens.back())).toEqual([]);
  expect(r.vm.screens.overlays).toEqual([]);
  // Every panel cue is the panel's own: no box (the stage finds the panel by its marker).
  expect(r.cues.filter(isPanelCue).map((e) => e.box)).toEqual(Array.from({ length: 9 }, () => null));
  r.yields.dispose();
});

// ---------------------------------------------------------------------------------------------------------------
// GM3p: the puzzle cues (engine plan §8.1 "The frame's flags and its ends", point 11; §8.6 `frameShown`)

const PIECES = 'pieces' as PuzzleLocalId;
const CABINET = 'cabinet' as PuzzleLocalId;
/** A linear `order` puzzle over the cue world's three items, `maxAttempts` tries. */
const orderPuzzle = (maxAttempts: number | null): Json => ({
  type: 'order',
  title: txt('order'),
  prompt: txt('prompt'),
  closeup: null,
  params: { pieces: ['medal', 'key', 'coin'] },
  maxAttempts,
  giveUp: false,
  solution: [2, 0, 1],
  hints: [txt('hint')],
});
/** The cue world with an `order` puzzle of three tries and a code puzzle with no close-up that allows Give up. */
const puzzleWorld = (): WorldPublic => cueWorld({ pieces: orderPuzzle(3), cabinet: { ...code(null, null), giveUp: true } });

const WRONG: Result<AttemptResponse, ApiError> = { ok: true, value: { correct: false, solved: false, attemptsLeft: null, spent: false } };
const RIGHT: Result<AttemptResponse, ApiError> = { ok: true, value: { correct: true, solved: true, attemptsLeft: null, spent: false } };
const httpError = (status: number, retryAfter: number | null = null): Result<AttemptResponse, ApiError> => ({
  ok: false,
  error: { kind: 'http', status, code: null, body: null, retryAfter },
});

/** A promise the test settles. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve: (v: T) => void = () => {};
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** The host chunk, deferred until the test lands it. */
const deferredHost = (): { loader: LazyChunks['puzzleHost']; land: () => void } => {
  const d = deferred<void>();
  return {
    loader: async () => {
      await d.promise;
      return { ok: true, value: HOST };
    },
    land: () => d.resolve(),
  };
};

/** The puzzle keys (and the frame's `ui-state` keys with their panel) the bus carried from `from` on. */
const frameKeys = (r: Rig, from = 0): string[] =>
  r.cues
    .slice(from)
    .flatMap((e) =>
      e.cue.kind === 'puzzle'
        ? [`puzzle:${e.cue.name}${e.cue.index === null ? '' : `@${e.cue.index}`}`]
        : e.cue.kind === 'ui-state' && e.cue.panel === 'puzzle'
          ? [`ui-state:${e.cue.name}@puzzle`]
          : [],
    );
/** App's frame layer shows the frame (§8.1 point 8): the host component, or the failed-host block. */
const shownIn = (v: ViewsAt): boolean => v.frame !== null && (v.host !== null || v.frame.loadFailed);

test('yields: a dial change emits puzzle input with its index', async () => {
  const r = rig();
  await r.yields.onYield({ kind: 'puzzle', puzzle: DRAWER, then: AFTER });
  const mark = r.cues.length;
  r.yields.host.onchange([0, 1, 0, 0]);
  r.yields.host.onchange([0, 1, 0, 0]); // the same answer: no change, no cue
  r.yields.host.onchange([2, 1, 0, 3]);
  expect(frameKeys(r, mark)).toEqual(['puzzle:input@1', 'puzzle:input@0', 'puzzle:input@3']);
  expect(r.cues.slice(mark).every((e) => e.cue.kind === 'puzzle' && e.cue.puzzle === DRAWER && e.box === null)).toBe(true);
  r.yields.dispose();
});

test('yields: a wrong attempt emits puzzle wrong and a solve emits puzzle solved', async () => {
  const r = rig({ attempts: [WRONG, RIGHT] });
  await r.yields.onYield({ kind: 'puzzle', puzzle: DRAWER, then: AFTER });
  let mark = r.cues.length;
  r.yields.host.ontry();
  await settle();
  expect(frameKeys(r, mark)).toEqual(['puzzle:checking', 'puzzle:wrong']);
  mark = r.cues.length;
  r.yields.host.ontry();
  await settle();
  // The end cue comes from the drop that ends the frame (`onEnd`), not from `attempted`, which never sees an ending answer.
  expect(frameKeys(r, mark)).toEqual(['puzzle:checking', 'puzzle:solved']);
  expect(r.puzzle.frame).toBeNull();
  r.yields.dispose();
});

test('yields: a last wrong attempt emits puzzle failed', async () => {
  const r = rig({ world: puzzleWorld(), attempts: [WRONG, WRONG, WRONG] });
  await r.yields.onYield({ kind: 'puzzle', puzzle: PIECES, then: AFTER });
  const id = r.puzzle.frame?.id;
  const mark = r.cues.length;
  for (let i = 0; i < 3; i += 1) {
    r.yields.host.ontry();
    await settle();
  }
  expect(frameKeys(r, mark)).toEqual(['puzzle:checking', 'puzzle:wrong', 'puzzle:checking', 'puzzle:wrong', 'puzzle:checking', 'puzzle:failed']);
  // Emitted while its frame was still on screen (the stage captures the wrapper inside the emit), then the frame goes.
  const at = r.cues.findIndex((e) => e.cue.kind === 'puzzle' && e.cue.name === 'failed');
  const v = r.views[at];
  expect([v?.frame?.id, v !== undefined && shownIn(v)]).toEqual([id, true]);
  expect(r.puzzle.frame).toBeNull();
  r.yields.dispose();
});

test('yields: a solve emits puzzle solved while its frame is shown', async () => {
  const r = rig({ world: puzzleWorld(), attempts: [RIGHT] });
  await r.yields.onYield({ kind: 'puzzle', puzzle: CABINET, then: AFTER });
  const id = r.puzzle.frame?.id;
  r.yields.host.ontry();
  await settle();
  const solved = r.cues.flatMap((e, i) => (e.cue.kind === 'puzzle' && e.cue.name === 'solved' ? [i] : []));
  expect(solved).toHaveLength(1);
  const v = r.views[solved[0] ?? -1];
  expect([v?.frame?.id, v !== undefined && shownIn(v)]).toEqual([id, true]);
  expect(r.puzzle.frame).toBeNull();
  r.yields.dispose();
});

test('yields: a give-up and an X8 close emit puzzle closed', async () => {
  // A linear give-up (the session ends `abandoned`; its drop's cue is `closed`).
  const r = rig({ world: puzzleWorld() });
  await r.yields.onYield({ kind: 'puzzle', puzzle: CABINET, then: AFTER });
  let mark = r.cues.length;
  r.yields.host.ongiveup();
  await settle();
  expect(frameKeys(r, mark)).toEqual(['puzzle:closed']);
  expect(r.puzzle.frame).toBeNull();
  r.yields.dispose();
  // An exploration puzzle's X8 Back with nothing in flight: one close, one motion.
  const x = rig({ world: cueWorld() });
  await inHall(x);
  x.yields.layer.ontap(key('hall.chest'));
  await settle();
  expect(x.puzzle.frame?.mode).toBe('explore');
  mark = x.cues.length;
  x.screens.back();
  await settle();
  expect(frameKeys(x, mark)).toEqual(['puzzle:closed']);
  expect(x.puzzle.frame).toBeNull();
  x.yields.dispose();
});

test("yields: every frame's appearance plays one panel-open", async () => {
  const opens = (r: Rig, from: number): number =>
    r.cues.slice(from).filter((e) => e.cue.kind === 'ui-state' && e.cue.name === 'panel-open' && e.cue.panel === 'puzzle').length;
  // A linear frame whose type chunk is still loading (the host already in): it shows at its write, once.
  const ui = deferred<void>();
  const r = rig({
    loaders: {
      puzzleUi: async () => {
        await ui.promise;
        return { ok: true, value: TYPE_UI };
      },
    },
  });
  r.puzzle.host = HOST;
  const opening = r.yields.onYield({ kind: 'puzzle', puzzle: DRAWER, then: AFTER });
  await settle();
  expect(opens(r, 0)).toBe(1);
  ui.resolve();
  await opening;
  expect(opens(r, 0)).toBe(1);
  r.yields.dispose();
  // An exploration frame: one, from the write that shows it (the screens diff does not speak for `puzzle`).
  const x = rig({ world: cueWorld() });
  await inHall(x);
  const mark = x.cues.length;
  x.yields.layer.ontap(key('hall.chest'));
  await settle();
  expect(x.puzzle.frame?.mode).toBe('explore');
  expect(opens(x, mark)).toBe(1);
  x.yields.dispose();
});

test('yields: an X8 Back hides the frame at once and a late correct answer still opens the lock', async () => {
  const answer = deferred<void>();
  const r = rig({ world: cueWorld(), attempts: [RIGHT], attemptGate: answer.promise });
  await inHall(r);
  r.yields.layer.ontap(key('hall.chest'));
  await settle();
  expect([r.puzzle.frame?.mode, r.stage().cg]).toEqual(['explore', 'drawer_close']);
  r.yields.host.ontry(); // the attempt is in flight
  await settle();
  const mark = r.cues.length;
  r.screens.back();
  await settle();
  // At the Back: the frame is gone, it irises out once, and the close-up fades out.
  expect(r.puzzle.frame).toBeNull();
  expect(frameKeys(r, mark)).toEqual(['puzzle:closed']);
  expect(r.stage().cg).toBeNull();
  const back = r.cues.length;
  answer.resolve();
  await settle();
  // The late answer opens the lock in the room, with no second frame motion.
  expect(r.yields.world().puzzles[DRAWER]?.outcome).toBe('solved');
  expect(frameKeys(r, back)).toEqual([]);
  expect(r.cues.slice(back).filter(isPanelCue)).toEqual([]);
  r.yields.dispose();
});

test("yields: a frame's appearance is emitted by the write that shows it", async () => {
  const host = deferredHost();
  const r = rig({ world: puzzleWorld(), loaders: { puzzleHost: host.loader } });
  // The first frame of the page: its write shows nothing (no host), the chunk write shows it.
  const opening = r.yields.onYield({ kind: 'puzzle', puzzle: CABINET, then: AFTER });
  await settle();
  expect(frameKeys(r)).toEqual(['ui-state:waiting@puzzle']);
  let mark = r.cues.length;
  host.land();
  await opening;
  expect(frameKeys(r, mark)).toEqual(['ui-state:waited@puzzle', 'ui-state:panel-open@puzzle', 'puzzle:opened']);
  // A second open with the host in: the frame write shows it.
  r.yields.disposePuzzle();
  const ui = deferred<void>();
  r.host.chunks.puzzleUi = async () => {
    await ui.promise;
    return { ok: true, value: TYPE_UI };
  };
  mark = r.cues.length;
  const second = r.yields.onYield({ kind: 'puzzle', puzzle: CABINET, then: AFTER });
  await settle();
  expect(frameKeys(r, mark)).toEqual(['ui-state:panel-open@puzzle', 'ui-state:waiting@puzzle']);
  ui.resolve();
  await second;
  expect(frameKeys(r, mark)).toEqual(['ui-state:panel-open@puzzle', 'ui-state:waiting@puzzle', 'ui-state:waited@puzzle', 'puzzle:opened']);
  r.yields.dispose();
  // A frame that opens waiting (its `busy` set through the store before the chunk lands, as per-player's values wait
  // does): its appearance breathes at once.
  const waitHost = deferredHost();
  const w = rig({ world: puzzleWorld(), loaders: { puzzleHost: waitHost.loader } });
  const waiting = w.yields.onYield({ kind: 'puzzle', puzzle: CABINET, then: AFTER });
  await settle();
  const f = w.puzzle.frame;
  w.puzzle.frame = f === null ? null : { ...f, busy: true, line: 'checking' };
  mark = w.cues.length;
  waitHost.land();
  await waiting;
  expect(frameKeys(w, mark)).toEqual(['ui-state:waited@puzzle', 'ui-state:panel-open@puzzle', 'puzzle:checking', 'puzzle:opened']);
  w.yields.dispose();
  // A host that fails: the failed-host block shows, then its notice wobbles.
  const failed = rig({ world: puzzleWorld(), loaders: { puzzleHost: async () => ({ ok: false, error: { kind: 'chunk', detail: 'offline' } }) } });
  await failed.yields.onYield({ kind: 'puzzle', puzzle: CABINET, then: AFTER });
  expect(frameKeys(failed)).toEqual(['ui-state:waiting@puzzle', 'ui-state:waited@puzzle', 'ui-state:panel-open@puzzle', 'puzzle:load-failed']);
  expect([failed.puzzle.host, failed.puzzle.frame?.loadFailed]).toEqual([null, true]);
  failed.yields.dispose();
  // Every frame cue of the four opens was emitted with its frame on screen.
  for (const x of [r, w, failed]) {
    const unshown = x.cues.flatMap((e, i) => {
      const v = x.views[i];
      const frameCue = e.cue.kind === 'puzzle' || (e.cue.kind === 'ui-state' && e.cue.panel === 'puzzle' && e.cue.name === 'panel-open');
      return frameCue && v !== undefined && !shownIn(v) ? [keyOf(e.cue)] : [];
    });
    expect(unshown).toEqual([]);
  }
});

test('yields: a frame that never showed plays no cue', async () => {
  // An X8 Back, a restore and a chapter change, each before the first host chunk lands: only the load hold ends.
  const drops: ReadonlyArray<readonly [string, (r: Rig) => void]> = [
    ['an X8 Back', (r) => r.screens.back()],
    ['a restore', (r) => r.yields.restore(EMPTY_WORLD_STATE, null, null)],
    ['a chapter change', (r) => r.yields.chapterChanged()],
  ];
  for (const [name, drop] of drops) {
    const host = deferredHost();
    const r = rig({ world: cueWorld(), loaders: { puzzleHost: host.loader } });
    await inHall(r);
    const mark = r.cues.length;
    r.yields.layer.ontap(key('hall.chest'));
    await settle();
    expect(r.puzzle.frame?.mode, name).toBe('explore');
    drop(r);
    await settle();
    host.land();
    await settle();
    expect(frameKeys(r, mark), name).toEqual(['ui-state:waiting@puzzle', 'ui-state:waited@puzzle']);
    // The dropped open's late chunk result writes nothing.
    expect([r.puzzle.frame, r.puzzle.host], name).toEqual([null, null]);
    r.yields.dispose();
  }
});

test('yields: the host hears every change of the shown frame', async () => {
  const host = deferredHost();
  const r = rig({ world: puzzleWorld(), loaders: { puzzleHost: host.loader } });
  const heard: Array<{ id: number } | null> = [];
  r.host.frameShown = (f) => heard.push(f === null ? null : { id: f.id });
  await inHall(r);
  // Nothing until the frame is on screen.
  r.yields.layer.ontap(key('hall.chest'));
  await settle();
  const first = r.puzzle.frame?.id ?? -1;
  expect(heard).toEqual([]);
  host.land();
  await settle();
  expect(heard).toEqual([{ id: first }]);
  // An X8 Back takes it off; a reopen (the host now in) shows the next at its write; a restore takes it off.
  r.screens.back();
  await settle();
  r.yields.layer.ontap(key('hall.chest'));
  await settle();
  const second = r.puzzle.frame?.id ?? -1;
  r.yields.restore(EMPTY_WORLD_STATE, null, null);
  await settle();
  await r.yields.onYield({ kind: 'puzzle', puzzle: CABINET, then: AFTER });
  const third = r.puzzle.frame?.id ?? -1;
  r.yields.dispose();
  expect(heard).toEqual([{ id: first }, null, { id: second }, null, { id: third }, null]);
  // A frame that never appeared reports nothing.
  const late = deferredHost();
  const x = rig({ world: cueWorld(), loaders: { puzzleHost: late.loader } });
  const none: unknown[] = [];
  x.host.frameShown = (f) => none.push(f);
  await inHall(x);
  x.yields.layer.ontap(key('hall.chest'));
  await settle();
  x.screens.back();
  late.land();
  await settle();
  x.yields.dispose();
  expect(none).toEqual([]);
  // An X8 Back over an attempt in flight: the session ends with the late answer, the frame left at the Back.
  const answer = deferred<void>();
  const y = rig({ world: cueWorld(), attempts: [RIGHT], attemptGate: answer.promise });
  const atBack: Array<{ id: number } | null> = [];
  y.host.frameShown = (f) => atBack.push(f === null ? null : { id: f.id });
  await inHall(y);
  y.yields.layer.ontap(key('hall.chest'));
  await settle();
  const shown = y.puzzle.frame?.id ?? -1;
  y.yields.host.ontry();
  await settle();
  y.screens.back();
  await settle();
  expect(atBack).toEqual([{ id: shown }, null]);
  answer.resolve();
  await settle();
  y.yields.dispose();
  expect(atBack).toEqual([{ id: shown }, null]);
});

test('yields: every attempt starts through post', () => {
  // The one attempt starter (per-player R-E28): `session.attempt(` occurs once in yields.ts, inside `const post`.
  const sites = [...yieldsSource.matchAll(/\.session\.attempt\(/g)].map((m) => m.index);
  expect(sites).toHaveLength(1);
  const start = yieldsSource.indexOf('  const post = ');
  const end = yieldsSource.indexOf('\n  };\n', start);
  expect(start).toBeGreaterThan(-1);
  expect(sites[0]).toBeGreaterThan(start);
  expect(sites[0]).toBeLessThan(end);
});

test('yields: an offline reply and each countdown second emit their cues', async () => {
  const r = rig({ world: puzzleWorld(), attempts: [{ ok: false, error: { kind: 'network', detail: 'down' } }, httpError(403), httpError(429, 3)] });
  await r.yields.onYield({ kind: 'puzzle', puzzle: CABINET, then: AFTER });
  const mark = r.cues.length;
  r.yields.host.ontry();
  await settle();
  r.yields.host.ontry();
  await settle();
  expect(frameKeys(r, mark)).toEqual(['puzzle:checking', 'puzzle:offline', 'puzzle:checking', 'puzzle:offline']);
  const limit = r.cues.length;
  r.yields.host.ontry();
  await settle();
  // One cue per second, its index the seconds left.
  expect(frameKeys(r, limit)).toEqual(['puzzle:checking', 'puzzle:rate-limited@3']);
  r.clock.advance(1000);
  expect(frameKeys(r, limit)).toEqual(['puzzle:checking', 'puzzle:rate-limited@3', 'puzzle:rate-limited@2']);
  r.clock.advance(1000);
  expect(frameKeys(r, limit).slice(-1)).toEqual(['puzzle:rate-limited@1']);
  expect(r.puzzle.frame?.retryAfter).toBe(1);
  r.yields.dispose();
});

test('yields: a countdown that ends with nothing to post emits puzzle ready', async () => {
  const r = rig({ world: puzzleWorld(), attempts: [httpError(429, 3)] });
  await r.yields.onYield({ kind: 'puzzle', puzzle: CABINET, then: AFTER });
  r.yields.host.ontry();
  await settle();
  const mark = r.cues.length;
  r.clock.advance(3000);
  await settle();
  expect(frameKeys(r, mark)).toEqual(['puzzle:rate-limited@2', 'puzzle:rate-limited@1', 'puzzle:ready']);
  expect([r.puzzle.frame?.line, r.puzzle.frame?.retryAfter, r.calls.attempts]).toEqual(['idle', null, 1]);
  r.clock.advance(5000);
  expect(frameKeys(r, mark)).toHaveLength(3);
  r.yields.dispose();
});

test('yields: a check that ends with no outcome returns the frame to idle with puzzle ready', async () => {
  // `attempt()` refuses an answer of the wrong shape (`invalid`) before any request: an order of one piece of three.
  const r = rig({ world: puzzleWorld() });
  await r.yields.onYield({ kind: 'puzzle', puzzle: PIECES, then: AFTER });
  r.yields.host.onchange([0]);
  const mark = r.cues.length;
  r.yields.host.ontry();
  await settle();
  expect(frameKeys(r, mark)).toEqual(['puzzle:checking', 'puzzle:ready@3']);
  expect([r.puzzle.frame?.line, r.puzzle.frame?.busy, r.calls.attempts]).toEqual(['idle', false, 0]);
  r.yields.dispose();
});

test('yields: a busy reply leaves the frame to the attempt in flight', async () => {
  const answer = deferred<void>();
  const r = rig({ world: puzzleWorld(), attempts: [WRONG], attemptGate: answer.promise });
  await r.yields.onYield({ kind: 'puzzle', puzzle: CABINET, then: AFTER });
  r.yields.host.ontry(); // in flight
  await settle();
  // The frame shown as idle again (a write this lane does not make), so a second Try reaches the session: `busy`.
  const f = r.puzzle.frame;
  r.puzzle.frame = f === null ? null : { ...f, busy: false, line: 'idle' };
  r.yields.host.ontry();
  const checking = r.puzzle.frame;
  const mark = r.cues.length;
  await settle();
  expect([r.calls.attempts, r.puzzle.frame === checking, r.puzzle.frame?.busy]).toEqual([1, true, true]);
  expect(frameKeys(r, mark)).toEqual([]);
  // The attempt in flight settles it.
  answer.resolve();
  await settle();
  expect([r.puzzle.frame?.line, r.puzzle.frame?.busy]).toEqual(['wrong', false]);
  r.yields.dispose();
});

// The class guard of §8.1 point 11: every wait of the views has exactly one hold from the block that starts it to every
// block that ends it. A hold's edges as the stage keys them: `ui-state:waiting` / `waited` per panel (`room` for a
// box-less or `via` hold), and the answer in flight, opened by `puzzle:checking` and ended by the same puzzle's next
// `CHECKING_ENDS` key.

const CHECKING_ENDS_KEYS = ['wrong', 'failed', 'solved', 'offline', 'rate-limited', 'ready', 'renewed', 'reset', 'closed'];

/** The hold edges of `cues`, given the answer holds already open; the panels' open counts after them. */
function holdEdges(cues: readonly CueEvent[], open: Map<string, number>): string[] {
  const edges: string[] = [];
  for (const e of cues) {
    const c = e.cue;
    let edge: string | null = null;
    if (c.kind === 'ui-state' && (c.name === 'waiting' || c.name === 'waited')) {
      edge = `${c.name === 'waiting' ? '+' : '-'}${c.panel ?? 'room'}`;
    } else if (c.kind === 'puzzle' && c.name === 'checking') {
      edge = '+answer';
    } else if (c.kind === 'puzzle' && CHECKING_ENDS_KEYS.includes(c.name) && (open.get('answer') ?? 0) > 0) {
      edge = '-answer';
    }
    if (edge !== null) {
      const panel = edge.slice(1);
      open.set(panel, (open.get(panel) ?? 0) + (edge.startsWith('+') ? 1 : -1));
      edges.push(edge);
    }
  }
  return edges;
}

/** One block of a row's script: what it runs, and the hold edges it declares, in order. */
type Block = readonly [name: string, run: () => unknown, edges: readonly string[]];

/** Runs `blocks` on `r`, checking each block's edges and that no panel ever holds two holds, or a negative one. */
async function script(row: string, r: Rig, blocks: readonly Block[]): Promise<void> {
  const open = new Map<string, number>();
  holdEdges(r.cues, open);
  for (const [name, run, edges] of blocks) {
    const mark = r.cues.length;
    await run();
    await settle();
    const seen = holdEdges(r.cues.slice(mark), open);
    expect(seen, `${row}: ${name}`).toEqual(edges);
    expect(
      [...open].filter(([, n]) => n < 0 || n > 1),
      `${row}: ${name}: one hold per panel`,
    ).toEqual([]);
  }
  expect(
    [...open].filter(([, n]) => n !== 0),
    `${row}: every hold ended`,
  ).toEqual([]);
}

/** Deferred chunk results, landed one at a time in call order. */
function chunkQueue<T>(): { loader: () => Promise<T>; land: (v: T) => void; waiting: () => number } {
  const pending: Array<(v: T) => void> = [];
  return {
    loader: () => new Promise<T>((resolve) => pending.push(resolve)),
    land: (v) => pending.shift()?.(v),
    waiting: () => pending.length,
  };
}

type WaitCase = (row: string) => Promise<void>;

/** One case per `WaitRow` (tsc keeps the table and the rows equal). The ladder row's case lands with `setLadder`. */
const WAIT_CASES: { readonly [R in Exclude<WaitRow, 'ladder'>]: WaitCase } = {
  // A visual batch's loads, through `held`: the room, the take and the close-up in and out, each with a late start.
  batch: async (row) => {
    const r = rig({ world: cueWorld(), late: true });
    await inLateHall(r);
    await script(row, r, [
      ['an exit', () => r.yields.layer.ontap(key('hall.to_cellar')), ['+room']],
      ['its start', () => r.release(), ['-room']],
      ['the way back', () => r.yields.layer.ontap(key('cellar.to_hall')), ['+room']],
      ['its start', () => r.release(), ['-room']],
      ['a take', () => r.yields.layer.ontap(key('hall.medal')), ['+room']],
      ['its start', () => r.release(), ['-room']],
      ['the close-up in', () => r.yields.layer.ontap(key('hall.chest')), ['+room']],
      ['its start, the frame write and the chunk write', () => r.release(), ['-room', '+puzzle', '-puzzle']],
      ['the close-up out at an X8 Back', () => r.screens.back(), ['+room']],
      ['its start', () => r.release(), ['-room']],
    ]);
    r.yields.dispose();
    // The close-up out at a run's end (`ended`).
    const p = rig({ late: true, attempts: [RIGHT] });
    await script(row, p, [
      ['the close-up in', () => void p.yields.onYield({ kind: 'puzzle', puzzle: DRAWER, then: AFTER }), ['+room']],
      ['its start, the frame write and the chunk write', () => p.release(), ['-room', '+puzzle', '-puzzle']],
      ['a solve, then the close-up out', () => p.yields.host.ontry(), ['+answer', '-answer', '+room']],
      ['its start', () => p.release(), ['-room']],
    ]);
    p.yields.dispose();
  },
  // A section's first explore-chunk import: it ends when the import settles, ok or failed.
  'explore-import': async (row) => {
    const chunks = chunkQueue<Result<ExploreChunk, ChunkError>>();
    const r = rig({ world: cueWorld(), loaders: { explore: chunks.loader } });
    await script(row, r, [
      ['the yield', () => void r.yields.onYield({ kind: 'explore', section: MANOR }), ['+room']],
      ['the chunk, then the first room batch', () => chunks.land({ ok: true, value: { create: createExploreController, layer: LAYER } }), ['-room', '+room', '-room']],
    ]);
    r.yields.dispose();
    const failing = chunkQueue<Result<ExploreChunk, ChunkError>>();
    const f = rig({ world: cueWorld(), loaders: { explore: failing.loader } });
    await script(row, f, [
      ['the yield', () => void f.yields.onYield({ kind: 'explore', section: MANOR }), ['+room']],
      ['the chunk failed', () => failing.land({ ok: false, error: { kind: 'chunk', detail: 'offline' } }), ['-room']],
    ]);
    expect(f.log.at(-1), `${row}: the D13 notice`).toBe('notice');
    f.yields.dispose();
    // The ninth view row (RULINGS 233 Q1): only the cue stage pending; the hold waits for it too.
    const stage = chunkQueue<Result<Component<CueStageProps>, ChunkError>>();
    const s = rig({ world: cueWorld(), loaders: { cueStage: stage.loader } });
    await script(row, s, [
      ['the yield', () => void s.yields.onYield({ kind: 'explore', section: MANOR }), ['+room']],
      ['the stage chunk, then the first room batch', () => stage.land({ ok: true, value: STAGE }), ['-room', '+room', '-room']],
    ]);
    s.yields.dispose();
  },
  // A frame's chunk imports (the host and the type) and a chunk Retry, unshown (no host yet) and shown.
  'frame-chunks': async (row) => {
    const host = chunkQueue<Result<Component<PuzzleHostProps>, ChunkError>>();
    const ui = chunkQueue<Result<Component<PuzzleUiProps>, ChunkError>>();
    const r = rig({ world: puzzleWorld(), loaders: { puzzleHost: host.loader, puzzleUi: ui.loader } });
    await script(row, r, [
      ['the frame write (unshown)', () => void r.yields.onYield({ kind: 'puzzle', puzzle: CABINET, then: AFTER }), ['+puzzle']],
      ['the host chunk', () => host.land({ ok: true, value: HOST }), []],
      ['the type chunk failed: the chunk write', () => ui.land({ ok: false, error: { kind: 'chunk', detail: 'offline' } }), ['-puzzle']],
      ['Retry', () => r.yields.host.onretry(), ['+puzzle']],
      ['the reload: the chunk write', () => (host.land({ ok: true, value: HOST }), ui.land({ ok: true, value: TYPE_UI })), ['-puzzle']],
      ['a second open (shown at its write)', () => void r.yields.onYield({ kind: 'puzzle', puzzle: PIECES, then: AFTER }), ['+puzzle']],
      ['its chunk write', () => (host.land({ ok: true, value: HOST }), ui.land({ ok: true, value: TYPE_UI })), ['-puzzle']],
    ]);
    r.yields.dispose();
    // `endFrame`: an X8 Back before the chunks land ends the hold; their late result writes nothing.
    const xHost = chunkQueue<Result<Component<PuzzleHostProps>, ChunkError>>();
    const x = rig({ world: cueWorld(), loaders: { puzzleHost: xHost.loader } });
    await inHall(x);
    await script(row, x, [
      ['a lock tap: the close-up in, the frame write', () => x.yields.layer.ontap(key('hall.chest')), ['+room', '-room', '+puzzle']],
      ['an X8 Back: endFrame, the close-up out', () => x.screens.back(), ['-puzzle', '+room', '-room']],
      [
        'the late chunks',
        () => {
          while (xHost.waiting() > 0) {
            xHost.land({ ok: true, value: HOST });
          }
        },
        [],
      ],
    ]);
    expect([x.puzzle.frame, x.puzzle.host], `${row}: the dropped open writes nothing`).toEqual([null, null]);
    x.yields.dispose();
    // The ninth view row (RULINGS 233 Q1): only the cue stage pending (a fresh session has no stage slot yet).
    const stage = chunkQueue<Result<Component<CueStageProps>, ChunkError>>();
    const s = rig({ world: puzzleWorld(), loaders: { cueStage: stage.loader } });
    await script(row, s, [
      ['the frame write', () => void s.yields.onYield({ kind: 'puzzle', puzzle: CABINET, then: AFTER }), ['+puzzle']],
      ['the stage chunk: the chunk write', () => stage.land({ ok: true, value: STAGE }), ['-puzzle']],
    ]);
    s.yields.dispose();
  },
  // An answer in flight: `post`'s `puzzle:checking` to the reply's key, the countdown's first tick or the end cue.
  answer: async (row) => {
    const gate = deferred<void>();
    const r = rig({ world: puzzleWorld(), attempts: [WRONG, httpError(429, 2), RIGHT], attemptGate: gate.promise });
    await r.yields.onYield({ kind: 'puzzle', puzzle: CABINET, then: AFTER });
    await script(row, r, [
      ['Try', () => r.yields.host.ontry(), ['+answer']],
      ['the wrong reply', () => gate.resolve(), ['-answer']],
      ['Try', () => r.yields.host.ontry(), ['+answer', '-answer']],
      ['the countdown', () => r.clock.advance(2000), []],
      ['Try: solved', () => r.yields.host.ontry(), ['+answer', '-answer']],
    ]);
    r.yields.dispose();
  },
};

test('yields: every wait of the views holds a motion', async () => {
  for (const [row, run] of Object.entries(WAIT_CASES)) {
    await run(row);
  }
});
