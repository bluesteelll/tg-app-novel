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
import type { PuzzleUiProps } from '../puzzles/registry.ts';
import type { HintPort } from '../puzzles/session.ts';
import type { SceneStats } from '../scene/controller.ts';
import type { VisualCommand } from '../scene/executor.ts';
import type { StatEvent } from '../stats/reporter.ts';
import { decodeChapterMeta } from '../story/catalog.ts';
import type { AssetEntry, AssetManifest, LoadedChapter, Result } from '../story/catalog.ts';
import type { AssetId, ChapterId, KnotName, LineId, PuzzleLocalId, SectionId, StagingSnapshot } from '../story/staging.ts';
import { createExploreView } from '../ui/explore-view.svelte.ts';
import type { ExploreLayerProps } from '../ui/explore-view.svelte.ts';
import { createPuzzleView } from '../ui/puzzle-view.svelte.ts';
import type { PuzzleHostProps } from '../ui/puzzle-view.svelte.ts';
import { createScreens } from '../ui/screens.ts';
import { createViewModel } from '../ui/state.svelte.ts';
import type { CueStageProps } from '../ui/state.svelte.ts';
import { decodeWorldSource, toPublic } from '../world/decode.ts';
import type { HotspotKey, ItemId, WorldPublic } from '../world/types.ts';
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
  return { ...toPublic(r.value), version: '1111111111111111' };
}

/**
 * The cue fixture (engine plan GM3s): the hall holds one hotspot per effect the yields map to a cue (a look, a take with
 * a prop, a document, a lock, the exits) and an exit out of the section; the cellar's onEnter gives a coin; the
 * study's runs an event knot.
 */
function cueWorld(): WorldPublic {
  const raw = {
    format: 1,
    items: {
      medal: { name: txt('Медаль'), desc: txt('d'), glyph: 'sun' },
      key: { name: txt('Ключ'), desc: txt('d'), glyph: 'key' },
      coin: { name: txt('Монета'), desc: txt('d'), glyph: 'sun' },
    },
    docs: { letter: { title: txt('Письмо'), body: [txt('текст')] } },
    puzzles: { gate: code(null, null), drawer: code('drawer_close', 2) },
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
  return { ...toPublic(r.value), version: '2222222222222222' };
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
};

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
  };
  const host: YieldsHost = {
    vm,
    screens,
    tg: { haptic: { impact: () => {}, selection: () => {}, notify: (t) => haptics.push(`notify:${t}`) } },
    api: {
      getPuzzle: async () => (o.status === undefined ? { ok: false, error: { kind: 'network', detail: 'none' } } : { ok: true, value: o.status }),
      postAttempt: async () => {
        calls.attempts += 1;
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
      subscribe('scene', (e) => cues.push(e));
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
  // K51: a take is a success haptic; an item that does not fit the box's slot is an error haptic.
  r.yields.layer.ontap(key('hall.key'));
  await settle();
  r.yields.layer.ontap(key('hall.box'));
  await settle();
  expect(r.explore.panel).toEqual({ kind: 'lock' });
  r.yields.layer.oninsert(key('hall.box'), 'key' as ItemId);
  await settle();
  expect(r.haptics).toEqual(['notify:success', 'notify:error']);
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
  // A look is core's `look` at its hotspot, on its box.
  const desk = boxOf(r, 'hall.desk');
  expect(await step(() => r.yields.layer.ontap(key('hall.desk')))).toEqual([
    { cue: { kind: 'module', module: 'core', name: 'look', at: 'hall.desk', item: null }, box: desk },
  ]);
  // A take: the item is held, by a tap at its hotspot; a document gift likewise.
  const medal = boxOf(r, 'hall.medal');
  expect(await step(() => r.yields.layer.ontap(key('hall.medal')))).toEqual([
    { cue: { kind: 'fact', fact: { kind: 'held', id: 'medal' }, change: 'added', cause: tapCause('hall.medal') }, box: medal },
  ]);
  const letter = boxOf(r, 'hall.letter');
  expect(await step(() => r.yields.layer.ontap(key('hall.letter')))).toEqual([
    { cue: { kind: 'fact', fact: { kind: 'doc', id: 'letter' }, change: 'added', cause: tapCause('hall.letter') }, box: letter },
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
  // A room whose onEnter runs an event knot: the story fact, by the tap on the exit.
  const door = boxOf(r, 'hall.to_study');
  expect(await step(() => r.yields.layer.ontap(key('hall.to_study')))).toEqual([
    { cue: { kind: 'fact', fact: { kind: 'story', id: 'study_event' }, change: 'added', cause: tapCause('hall.to_study') }, box: door },
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
  expect(worldCues(reset)).toEqual([{ cue: { kind: 'module', module: 'core', name: 'reset', at: null, item: null }, box: null }]);
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
  // The subscription carries the session's cues.
  expect(worldCues(r).map((e) => e.cue.kind)).toEqual(['fact']);
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
  const looked: ExploreEffect = { kind: 'look', text: { id: 'ch1.yx.late' as LineId, ru: 'late' } };
  // Control: while the session lives, such an effect reaches the scene role.
  const before = r.cues.length;
  listener.fn?.(looked);
  expect(r.cues.length).toBe(before + 1);
  r.yields.dispose();
  listener.fn?.(looked);
  expect(r.cues.length).toBe(before + 1);
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

test('yields: every batch goes through held', () => {
  // The one batch site: every `h.apply(` of yields.ts is held's (GM3p's request walk replaces this pin by declaration).
  const sites = [...yieldsSource.matchAll(/\bh\.apply\(/g)].map((m) => m.index);
  expect(sites.length).toBe(1);
  const start = yieldsSource.indexOf('export function heldBy(');
  const end = yieldsSource.indexOf('\n}\n', start);
  expect(start).toBeGreaterThan(-1);
  expect(sites[0]).toBeGreaterThan(start);
  expect(sites[0]).toBeLessThan(end);
});

test('yields: a batch that waits on a load emits waiting, then waited', async () => {
  const r = rig({ world: cueWorld(), late: true });
  await inLateHall(r);
  // The take batch: the hold opens at the taken hotspot's box and closes when the batch starts.
  const medal = boxOf(r, 'hall.medal');
  let mark = r.cues.length;
  r.yields.layer.ontap(key('hall.medal'));
  await settle();
  expect(keysOf(r, mark)).toEqual(['fact:held:added', 'ui-state:waiting']);
  expect(r.cues.at(-1)?.box).toEqual(medal);
  r.release();
  await settle();
  expect(keysOf(r, mark)).toEqual(['fact:held:added', 'ui-state:waiting', 'ui-state:waited']);
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
  expect(keysOf(r, mark)).toEqual(['ui-state:waiting', 'ui-state:waited']);
  expect(r.puzzle.frame?.mode).toBe('explore');
  mark = r.cues.length;
  r.screens.back();
  await settle();
  expect(keysOf(r, mark)).toEqual(['ui-state:waiting']);
  r.release();
  await settle();
  expect(keysOf(r, mark)).toEqual(['ui-state:waiting', 'ui-state:waited']);
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
  expect(keysOf(p, mark)).toEqual(['ui-state:waiting']);
  expect(p.cues.at(-1)?.box).toBeNull();
  p.release();
  await settle();
  expect(keysOf(p, mark)).toEqual(['ui-state:waiting', 'ui-state:waited']);
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
  expect(keysOf(r, mark)).toEqual(['ui-state:waiting', 'ui-state:waited', 'move:walk', 'fact:held:added']);
  r.yields.dispose();
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
