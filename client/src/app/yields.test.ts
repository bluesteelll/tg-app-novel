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
import { ROOM_SOURCE, cover, toStage } from '../geom/cover.ts';
import type { ChunkError, PuzzleUiProps } from '../puzzles/registry.ts';
import type { HintPort, HintPortError } from '../puzzles/session.ts';
import type { SceneStats } from '../scene/controller.ts';
import type { VisualCommand } from '../scene/executor.ts';
import type { StatEvent } from '../stats/reporter.ts';
import { decodeChapterMeta } from '../story/catalog.ts';
import type { AssetEntry, AssetManifest, LoadedChapter, Result } from '../story/catalog.ts';
import type { AssetId, BgId, CgId, ChapterId, KnotName, PropId, PuzzleLocalId, Rect, SectionId, StagingSnapshot } from '../story/staging.ts';
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
import { ROOM_FADE_MS, TAKE_FADE_MS, VIEW_FADE_MS, coreCue, createYields, heldBy } from './yields.ts';
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
  /** `getPuzzle` answers only after it (a status request in flight). */
  statusGate?: Promise<void>;
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
  const calls = { explore: 0, host: 0, ui: 0, attempts: 0, stage: 0, status: 0 };
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
      getPuzzle: async () => {
        calls.status += 1;
        await o.statusGate;
        return o.status === undefined ? { ok: false, error: { kind: 'network', detail: 'none' } } : { ok: true, value: o.status };
      },
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
    // D-P (GM3p): the frame's points move from the frame root's px to the host's by their rects' offset.
    stageHost: () =>
      ({
        clientWidth: 360,
        clientHeight: 640,
        getBoundingClientRect: () => ({ left: 0, top: 0, right: 360, bottom: 640, width: 360, height: 640, x: 0, y: 0 }),
      }) as unknown as HTMLElement,
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
  // The take's state batch: the medal's anchor draws nothing after it, so the batch adds no image and holds nothing
  // (engine plan §6.4 round 13, `'no-load'`); a state batch that does hold has its own tests.
  let mark = r.cues.length;
  r.yields.layer.ontap(key('hall.medal'));
  await settle();
  expect(keysOf(r, mark)).toEqual(['fact:held:added', 'fact:taken:added']);
  r.release();
  await settle();
  expect(keysOf(r, mark)).toEqual(['fact:held:added', 'fact:taken:added']);
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

/** The hall (an exit into the desk, the medal with its prop) and the desk, a zoom view of the hall with no exit back. */
function zoomWorld(): WorldPublic {
  const raw = {
    format: 1,
    items: { medal: { name: txt('Медаль'), desc: txt('d'), glyph: 'sun' } },
    docs: {},
    puzzles: {},
    sections: {
      manor: {
        start: 'hall',
        bgm: null,
        rooms: {
          hall: { bg: 'hall', title: txt('Hall'), onEnter: [], hotspots: [exit('to_desk', 'desk'), take('medal', 'medal', 'medal')] },
          desk: { bg: 'cellar', title: txt('Desk'), onEnter: [], hotspots: [look('blotter')], view: { of: 'hall' } },
        },
      },
    },
  };
  const r = decodeWorldSource(raw);
  if (!r.ok) {
    throw new Error(`invariant: the zoom fixture world decodes: ${JSON.stringify(r.error)}`);
  }
  return { ...toPublic(r.value), mods: r.value.mods, version: '6666666666666666' };
}

test('yields: a zoom move crossfades the bg', async () => {
  const r = rig({ world: zoomWorld() });
  await inHall(r);
  const moves = (from: number): Array<Pick<CueEvent, 'cue' | 'box'>> =>
    r.cues
      .slice(from)
      .filter((e) => e.cue.kind === 'move')
      .map((e) => ({ cue: e.cue, box: e.box }));
  // The zoom-in: the desk crossfades over the hall (engine plan §6.3), its move cue at the exit's box.
  const door = boxOf(r, 'hall.to_desk');
  let at = r.batches.length;
  let mark = r.cues.length;
  r.yields.layer.ontap(key('hall.to_desk'));
  await settle();
  expect(roomOf(r)).toBe('desk');
  expect(r.batches.slice(at)).toEqual([[{ kind: 'bg', bg: 'cellar', t: 'crossfade', ms: VIEW_FADE_MS }, { kind: 'props', props: [] }]]);
  expect(moves(mark)).toEqual([{ cue: { kind: 'move', from: 'hall', to: 'desk', via: 'hall.to_desk', how: 'zoom-in' }, box: door }]);
  // The root back leaves the view by `leave-view`: a zoom-out by no exit, whose cue lands on the hall's exit into the
  // desk (W1, RULINGS 298: the zoom-in's box read backwards).
  expect(r.vm.screens.backVisible).toBe(true);
  at = r.batches.length;
  mark = r.cues.length;
  r.screens.back();
  await settle();
  expect(roomOf(r)).toBe('hall');
  expect(r.batches.slice(at)).toEqual([[{ kind: 'bg', bg: 'hall', t: 'crossfade', ms: VIEW_FADE_MS }, { kind: 'props', props: [{ prop: 'medal', rect: RECT, at: 'hall.medal' }] }]]);
  expect(moves(mark)).toEqual([{ cue: { kind: 'move', from: 'desk', to: 'hall', via: null, how: 'zoom-out' }, box: door }]);
  r.yields.dispose();
});

// ---------------------------------------------------------------------------------------------------------------
// GM4u: the view bar (engine plan §6.3; the leave control, `inView`, the box of a zoom-out by no exit)

const DESK_RECT: Rect = [500, 900, 300, 300];
const SHELF_RECT: Rect = [150, 1300, 250, 250];
const NOOK_RECT: Rect = [600, 400, 200, 200];
const BACK_RECT: Rect = [400, 1500, 300, 200];
const exitAt = (id: string, to: string, rect: Rect): Json => ({ ...exit(id, to), rect });

/**
 * hall <-> study; the study zooms into `desk` (bg cellar) by two exits, and the desk has no exit back (the demo's
 * shape: `leave-view` is its way out); the hall zooms into `nook`, which has an exit back and an onEnter event. Every
 * rect but the plain walk's differs, so each hotspot's drawn box differs. Without `entry` no hall exit enters the
 * nook: a synthetic world for the null box. At runtime a save standing in such a view restarts its section on load
 * (`reconcile` -> `unproved` -> `admitSection` from the start room); the rig's `restore` takes the state directly.
 */
function viewWorld(entry = true): WorldPublic {
  const raw = {
    format: 1,
    items: {},
    docs: {},
    puzzles: {},
    sections: {
      manor: {
        start: 'hall',
        bgm: null,
        rooms: {
          hall: { bg: 'hall', title: txt('Hall'), onEnter: [], hotspots: [exit('to_study', 'study'), ...(entry ? [exitAt('to_nook', 'nook', NOOK_RECT)] : [])] },
          study: {
            bg: 'study',
            title: txt('Study'),
            onEnter: [],
            hotspots: [exit('to_hall', 'hall'), exitAt('to_desk', 'desk', DESK_RECT), exitAt('to_desk_too', 'desk', SHELF_RECT)],
          },
          desk: { bg: 'cellar', title: txt('Desk'), onEnter: [], hotspots: [], view: { of: 'study' } },
          nook: { bg: 'cellar', title: txt('Nook'), onEnter: [{ story: 'study_event' }], hotspots: [exitAt('to_hall', 'hall', BACK_RECT)], view: { of: 'hall' } },
        },
      },
    },
  };
  const r = decodeWorldSource(raw);
  if (!r.ok) {
    throw new Error(`invariant: the view fixture world decodes: ${JSON.stringify(r.error)}`);
  }
  return { ...toPublic(r.value), mods: r.value.mods, version: '7777777777777777' };
}

test('yields: the explore view is in a view exactly while the room is one', async () => {
  const r = rig({ world: viewWorld() });
  await inHall(r);
  expect(r.explore.inView).toBe(false);
  r.yields.layer.ontap(key('hall.to_study'));
  await settle();
  // A walked plain room has a Back target, and is no view.
  expect([roomOf(r), r.vm.screens.backVisible, r.explore.inView]).toEqual(['study', true, false]);
  r.yields.layer.ontap(key('study.to_desk'));
  await settle();
  expect([roomOf(r), r.explore.inView]).toEqual(['desk', true]);
  const inDesk = r.yields.world();
  r.screens.back(); // a zoom-out by `leave-view`
  await settle();
  expect([roomOf(r), r.explore.inView]).toEqual(['study', false]);
  r.yields.layer.ontap(key('study.to_desk'));
  await settle();
  expect(r.explore.inView).toBe(true);
  r.yields.dispose();
  expect(r.explore.inView).toBe(false);
  // A resume inside the view: the room effect is a resume, and the flag is written with its batch.
  const x = rig({ world: viewWorld() });
  x.yields.restore(inDesk, null, { kind: 'explore', section: MANOR });
  expect(x.explore.inView).toBe(false);
  await x.yields.onYield({ kind: 'explore', section: MANOR });
  expect([roomOf(x), x.explore.inView, x.vm.screens.backVisible]).toEqual(['desk', true, true]);
  x.yields.dispose();
  // An event return into a view, in a fresh session (a reload inside the nook's knot): in one session the zoom-in's
  // batch has already written the flag, so a return there could not tell a rewrite from a stale value.
  const y = rig({ world: viewWorld() });
  await inHall(y);
  y.yields.layer.ontap(key('hall.to_nook'));
  await settle();
  expect([roomOf(y), y.explore.layer, y.vm.screens.backVisible]).toEqual(['nook', null, false]);
  const mid = y.yields.world();
  expect(mid.pendingStory).toEqual(['study_event']);
  y.yields.dispose();
  const e = rig({ world: viewWorld() });
  e.yields.restore(mid, null, null);
  expect(e.explore.inView).toBe(false);
  await e.yields.onYield({ kind: 'explore', section: MANOR }); // the knot's own yield: an event return
  expect([roomOf(e), e.explore.inView, e.vm.screens.backVisible]).toEqual(['nook', true, true]);
  e.yields.dispose();
});

/** The move cues the bus carried since `from`, with their boxes. */
const movesOf = (r: Rig, from: number): Array<Pick<CueEvent, 'cue' | 'box'>> =>
  r.cues
    .slice(from)
    .filter((e) => e.cue.kind === 'move')
    .map((e) => ({ cue: e.cue, box: e.box }));

test("yields: a zoom-out by no exit lands on the parent's exit into the view", async () => {
  const r = rig({ world: viewWorld() });
  await inHall(r);
  r.yields.layer.ontap(key('hall.to_study'));
  await settle();
  const desk = boxOf(r, 'study.to_desk');
  const shelf = boxOf(r, 'study.to_desk_too');
  const door = boxOf(r, 'study.to_hall');
  // Non-vacuity: the stage has a size, so each hotspot is drawn, and the three boxes differ.
  expect([desk, shelf, door].every((b) => b !== null)).toBe(true);
  expect(new Set([desk, shelf, door].map((b) => JSON.stringify(b))).size).toBe(3);
  // Into the desk by the study's second exit into it, then Back: the iris closes onto the first exit into the view
  // (W1, RULINGS 298), not the one taken; the batch's hold breathes on the same box.
  r.yields.layer.ontap(key('study.to_desk_too'));
  await settle();
  expect(roomOf(r)).toBe('desk');
  const inDesk = r.yields.world();
  let mark = r.cues.length;
  r.screens.back();
  await settle();
  expect(roomOf(r)).toBe('study');
  expect(movesOf(r, mark)).toEqual([{ cue: { kind: 'move', from: 'desk', to: 'study', via: null, how: 'zoom-out' }, box: desk }]);
  expect(waitsOf(r, mark)).toEqual([waitAt('waiting', desk), waitAt('waited', desk)]);
  // A zoom-out by an exit keeps its own box: the nook's exit back, not the hall's exit into the nook.
  r.screens.back(); // a walk to the hall
  await settle();
  expect(roomOf(r)).toBe('hall');
  const into = boxOf(r, 'hall.to_nook');
  r.yields.layer.ontap(key('hall.to_nook'));
  await settle(); // the nook's knot runs
  await r.yields.onYield({ kind: 'explore', section: MANOR }); // and returns
  expect(roomOf(r)).toBe('nook');
  const inNook = r.yields.world();
  const out = boxOf(r, 'nook.to_hall');
  expect(out).not.toBeNull();
  expect(out).not.toEqual(into);
  mark = r.cues.length;
  r.yields.layer.ontap(key('nook.to_hall'));
  await settle();
  expect(movesOf(r, mark)).toEqual([{ cue: { kind: 'move', from: 'nook', to: 'hall', via: 'nook.to_hall', how: 'zoom-out' }, box: out }]);
  r.yields.dispose();
  // In a session that never zoomed in (a resume inside the desk): the box is read at the leave.
  const x = rig({ world: viewWorld() });
  x.yields.restore(inDesk, null, { kind: 'explore', section: MANOR });
  await x.yields.onYield({ kind: 'explore', section: MANOR });
  expect(roomOf(x)).toBe('desk');
  mark = x.cues.length;
  x.screens.back();
  await settle();
  expect(roomOf(x)).toBe('study');
  expect(movesOf(x, mark)).toEqual([{ cue: { kind: 'move', from: 'desk', to: 'study', via: null, how: 'zoom-out' }, box: boxOf(x, 'study.to_desk') }]);
  x.yields.dispose();
  // No exit of the parent enters the view: the cue has no box (the stage's counted centre fallback). A defensive pin
  // on a synthetic state: at runtime such a save restarts its section on load (`admitSection`, `admitEvent`).
  const z = rig({ world: viewWorld(false) });
  z.yields.restore(inNook, null, { kind: 'explore', section: MANOR });
  await z.yields.onYield({ kind: 'explore', section: MANOR });
  expect(roomOf(z)).toBe('nook');
  mark = z.cues.length;
  z.screens.back();
  await settle();
  expect(roomOf(z)).toBe('hall');
  expect(movesOf(z, mark)).toEqual([{ cue: { kind: 'move', from: 'nook', to: 'hall', via: null, how: 'zoom-out' }, box: null }]);
  z.yields.dispose();
});

test("yields: the leave control is Back's own press, with the root back gone", async () => {
  const r = rig({ world: viewWorld() });
  expect(typeof r.yields.layer.onleaveview).toBe('function');
  await inHall(r);
  r.yields.layer.ontap(key('hall.to_study'));
  await settle();
  const desk = boxOf(r, 'study.to_desk');
  r.yields.layer.ontap(key('study.to_desk'));
  await settle();
  expect(roomOf(r)).toBe('desk');
  // A regression in the root-back registration: the leave control is still a way out (engine plan §6.3).
  r.screens.setRootBack(null);
  expect(r.vm.screens.backVisible).toBe(false);
  const at = r.batches.length;
  const mark = r.cues.length;
  r.yields.layer.onleaveview();
  await settle();
  expect(roomOf(r)).toBe('study');
  expect(r.batches.slice(at)).toEqual([[{ kind: 'bg', bg: 'study', t: 'crossfade', ms: VIEW_FADE_MS }, { kind: 'props', props: [] }]]);
  // The BackButton's move, and its landing: the study's exit into the desk (W1).
  expect(movesOf(r, mark)).toEqual([{ cue: { kind: 'move', from: 'desk', to: 'study', via: null, how: 'zoom-out' }, box: desk }]);
  // In a plain room with a path (the hall) the action is Back's walk too.
  r.yields.layer.onleaveview();
  await settle();
  expect(roomOf(r)).toBe('hall');
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

// ---------------------------------------------------------------------------------------------------------------
// State visuals (engine plan §6.4, GM3b): the state batch and its hold, the placements, `roomFor`, the diff on the bus

const LAMP: Rect = [100, 300, 200, 200];
const VASE: Rect = [300, 300, 200, 200];
const DRAWER_AT: Rect = [500, 300, 200, 200];
const BUST: Rect = [700, 300, 200, 200];
const URN_L: Rect = [100, 600, 200, 200];
const URN_R: Rect = [300, 600, 200, 200];
const RUG: Rect = [0, 1500, 1080, 400];
const SHADE: Rect = [400, 100, 300, 200];
const MIRROR: Rect = [200, 400, 400, 600];
const CRACK: Rect = [250, 500, 100, 100];
const object = (id: string, prop: string | null, rect: Rect, visual: Json = {}): Json => ({ id, kind: 'object', rect, label: txt(id), lock: null, then: [], look: null, prop, ...visual });
/** A visual rule: `state` once hotspot `k` was examined. */
const onceSeen = (k: string, state: string): Json[] => [{ when: { examined: k }, state }];

/**
 * The visual fixture: in the hall, a look at the switch lights the lamp, a look at the desk takes the vase's picture away
 * and opens the drawer (drawn after the vase), a look at the shelf takes the bust's away, two urns share one image, and
 * decor sits behind the hotspots (the rug, z -1) and in front (the shade, z 2, declared first). The den shares the
 * hall's bg; its mirror shows a crack patch once the hall's desk is examined. The attic has a bg of its own and an exit
 * out of the section.
 */
function visualWorld(): WorldPublic {
  const raw = {
    format: 1,
    items: {},
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
              exit('to_den', 'den'),
              exit('to_attic', 'attic'),
              look('switch'),
              look('desk'),
              look('shelf'),
              object('lamp', 'lamp', LAMP, { states: { lit: { prop: 'lamp_lit' } }, is: onceSeen('hall.switch', 'lit') }),
              object('vase', 'vase', VASE, { states: { gone: { prop: null } }, is: onceSeen('hall.desk', 'gone') }),
              object('drawer', null, DRAWER_AT, { states: { open: { prop: 'drawer_open' } }, is: onceSeen('hall.desk', 'open') }),
              object('bust', 'bust', BUST, { states: { gone: { prop: null } }, is: onceSeen('hall.shelf', 'gone') }),
              object('urn_l', 'urn', URN_L),
              object('urn_r', 'urn', URN_R),
            ],
            decor: [
              { id: 'shade', prop: 'shade', rect: SHADE, z: 2 },
              { id: 'rug', prop: 'rug', rect: RUG, z: -1 },
            ],
          },
          den: {
            bg: 'hall',
            title: txt('Den'),
            onEnter: [],
            hotspots: [exit('to_hall', 'hall'), object('mirror', 'mirror', MIRROR, { states: { cracked: { patch: 'crack', rect: CRACK } }, is: onceSeen('hall.desk', 'cracked') })],
          },
          attic: {
            bg: 'attic',
            title: txt('Attic'),
            onEnter: [],
            hotspots: [exit('to_hall', 'hall'), { id: 'out', kind: 'exit', rect: RECT, label: txt('out'), to: { story: 'after' }, lock: null, sfx: null }],
          },
        },
      },
    },
  };
  const r = decodeWorldSource(raw);
  if (!r.ok) {
    throw new Error(`invariant: the visual fixture world decodes: ${JSON.stringify(r.error)}`);
  }
  return { ...toPublic(r.value), mods: r.value.mods, version: '4444444444444444' };
}

/** A placement as the props command carries it: a base has no `part`, a patch has `part: 'patch'`. */
const placed = (prop: string, rect: Rect, at: string, part?: 'patch'): Json => ({ prop, rect, at, ...(part === undefined ? {} : { part }) });
/** The hall's props at its entry, back to front: the rug, the hotspots in their order (the drawer draws nothing yet), the shade. */
const HALL_PROPS = [
  placed('rug', RUG, 'hall~rug'),
  placed('lamp', LAMP, 'hall.lamp'),
  placed('vase', VASE, 'hall.vase'),
  placed('bust', BUST, 'hall.bust'),
  placed('urn', URN_L, 'hall.urn_l'),
  placed('urn', URN_R, 'hall.urn_r'),
  placed('shade', SHADE, 'hall~shade'),
];
const CROSSFADE = { kind: 'bg', bg: 'hall', t: 'crossfade', ms: TAKE_FADE_MS };
/** An anchor's box on the rig's 360×640 stage host: the cover mapping, with no minimum tap target. */
const anchorAt = (rect: Rect): CueEvent['box'] => toStage(rect, cover({ w: 360, h: 640 }, ROOM_SOURCE));
const propsCommands = (batches: readonly VisualCommand[][]): VisualCommand[] => batches.flat().filter((c) => c.kind === 'props');
const waitsOf = (r: Rig, from: number): Array<Pick<CueEvent, 'cue' | 'box'>> =>
  r.cues
    .slice(from)
    .filter((e) => e.cue.kind === 'ui-state' && (e.cue.name === 'waiting' || e.cue.name === 'waited'))
    .map((e) => ({ cue: e.cue, box: e.box }));
const waitAt = (name: 'waiting' | 'waited', box: CueEvent['box']): Pick<CueEvent, 'cue' | 'box'> => ({ cue: { kind: 'ui-state', name, panel: null, item: null }, box });

test('yields: a state change crossfades the props on screen', async () => {
  const r = rig({ world: visualWorld() });
  await inHall(r);
  const mark = r.batches.length;
  r.yields.layer.ontap(key('hall.switch'));
  await settle();
  // The look lit the lamp: the room on screen crossfades to its new picture over the bg already shown (owner Q53).
  const lit = HALL_PROPS.map((p) => (p['at'] === 'hall.lamp' ? placed('lamp_lit', LAMP, 'hall.lamp') : p));
  expect(r.batches.slice(mark)).toEqual([[CROSSFADE, { kind: 'props', props: lit }]]);
  expect(r.stage().props).toEqual(lit);
  // A second look changes no state: no batch.
  r.yields.layer.ontap(key('hall.switch'));
  await settle();
  expect(r.batches.length - mark).toBe(1);
  r.yields.dispose();
});

test('yields: two placements of one image keep two anchors', async () => {
  const r = rig({ world: visualWorld() });
  await inHall(r);
  // Engine plan §6.4 W7: one image at two anchors is two placements, each keyed by its own anchor.
  const urns = propsCommands(r.batches).flatMap((c) => (c.kind === 'props' ? c.props.filter((p) => p.prop === 'urn') : []));
  expect(urns).toEqual([placed('urn', URN_L, 'hall.urn_l'), placed('urn', URN_R, 'hall.urn_r')]);
  r.yields.dispose();
});

test('yields: the props command lists placements back to front', async () => {
  const r = rig({ world: visualWorld() });
  await inHall(r);
  // The draw order: decor by `z` around the hotspots' 0, the hotspots in world order (§6.4 "Anchors and order").
  expect(propsCommands(r.batches)).toEqual([{ kind: 'props', props: HALL_PROPS }]);
  r.yields.dispose();
});

test('yields: a state change that waits on its picture holds a motion at its anchor', async () => {
  const r = rig({ world: visualWorld(), late: true });
  await inLateHall(r);
  const mark = r.cues.length;
  r.yields.layer.ontap(key('hall.switch'));
  await settle();
  // The lit lamp's picture loads: the batch holds at the lamp's anchor until it starts.
  expect(waitsOf(r, mark)).toEqual([waitAt('waiting', anchorAt(LAMP))]);
  r.release();
  await settle();
  expect(waitsOf(r, mark)).toEqual([waitAt('waiting', anchorAt(LAMP)), waitAt('waited', anchorAt(LAMP))]);
  expect(r.stage().props).toContainEqual(placed('lamp_lit', LAMP, 'hall.lamp'));
  r.yields.dispose();
});

test('yields: a state change holds at the first changed anchor that draws an image', async () => {
  const r = rig({ world: visualWorld(), late: true });
  await inLateHall(r);
  const mark = r.cues.length;
  r.yields.layer.ontap(key('hall.desk'));
  await settle();
  // The vase, drawn first, turns to a state with no picture; the drawer turns to one: the hold is the drawer's.
  expect(waitsOf(r, mark)).toEqual([waitAt('waiting', anchorAt(DRAWER_AT))]);
  r.release();
  await settle();
  expect(waitsOf(r, mark)).toEqual([waitAt('waiting', anchorAt(DRAWER_AT)), waitAt('waited', anchorAt(DRAWER_AT))]);
  r.yields.dispose();
});

test('yields: a state change that draws no image opens no hold', async () => {
  const r = rig({ world: visualWorld(), late: true });
  await inLateHall(r);
  const mark = r.cues.length;
  const at = r.batches.length;
  r.yields.layer.ontap(key('hall.shelf'));
  await settle();
  // The bust's picture goes and nothing new is drawn: the batch adds no image, so it holds nothing (`'no-load'`).
  expect(r.batches.slice(at)).toEqual([[CROSSFADE, { kind: 'props', props: HALL_PROPS.filter((p) => p['at'] !== 'hall.bust') }]]);
  r.release();
  await settle();
  expect(waitsOf(r, mark)).toEqual([]);
  r.yields.dispose();
});

test("yields: roomFor gives a room's state commands by its bg", async () => {
  const r = rig({ world: visualWorld() });
  const bg = (b: string): BgId => b as BgId;
  // No section open (and no controller yet): null.
  expect(r.yields.roomFor(bg('hall'))).toBeNull();
  await inHall(r);
  expect(r.yields.roomFor(bg('hall'))).toEqual([{ kind: 'props', props: HALL_PROPS }]);
  r.yields.layer.ontap(key('hall.to_den'));
  await settle();
  // Two rooms on the hall's bg: the current one first.
  expect(r.yields.roomFor(bg('hall'))).toEqual([{ kind: 'props', props: [placed('mirror', MIRROR, 'den.mirror')] }]);
  r.yields.layer.ontap(key('den.to_hall'));
  await settle();
  r.yields.layer.ontap(key('hall.to_attic'));
  await settle();
  // From the attic: the first room on that bg in declaration order; its own bg gives its own (empty) picture.
  expect(r.yields.roomFor(bg('hall'))).toEqual([{ kind: 'props', props: HALL_PROPS }]);
  expect(r.yields.roomFor(bg('attic'))).toEqual([{ kind: 'props', props: [] }]);
  // No room of the section on that bg: null, not an empty command.
  expect(r.yields.roomFor(bg('cellar'))).toBeNull();
  r.yields.layer.ontap(key('attic.out'));
  await settle();
  // Out of the section: null.
  expect(r.yields.roomFor(bg('hall'))).toBeNull();
  r.yields.dispose();
});

test("yields: roomFor equals the room batch's state commands", async () => {
  const r = rig({ world: visualWorld() });
  await inHall(r);
  r.yields.layer.ontap(key('hall.desk'));
  await settle();
  const mark = r.batches.length;
  r.yields.layer.ontap(key('hall.to_den'));
  await settle();
  // The den is entered with its mirror cracked: the base, then its patch over it.
  const batch = propsCommands(r.batches.slice(mark));
  expect(batch).toEqual([{ kind: 'props', props: [placed('mirror', MIRROR, 'den.mirror'), placed('crack', CRACK, 'den.mirror', 'patch')] }]);
  expect(r.yields.roomFor('hall' as BgId)).toEqual(batch);
  r.yields.dispose();
});

test("yields: a dispatch's cues carry its visual diff", async () => {
  const r = rig({ world: cueWorld() });
  await inHall(r);
  let mark = r.cues.length;
  r.yields.layer.ontap(key('hall.medal'));
  await settle();
  // A take: the medal's anchor leaves the room's picture, and each cue of the dispatch carries that diff (§6.4, 08c).
  const taken = [{ at: 'hall.medal', from: 'default', to: null }];
  expect(r.cues.slice(mark).map((e) => [keyOf(e.cue), e.diff])).toEqual([
    ['fact:held:added', taken],
    ['fact:taken:added', taken],
  ]);
  // A move changes the room: no diff, on its move cue and on the cues of its arrival.
  mark = r.cues.length;
  r.yields.layer.ontap(key('hall.to_cellar'));
  await settle();
  const moved = r.cues.slice(mark);
  expect(moved.map((e) => keyOf(e.cue))).toContain('move:walk');
  expect(moved.filter((e) => e.diff.length > 0)).toEqual([]);
  r.yields.dispose();
});

/**
 * The state batch's edges (§6.4), on a world of their own so `visualWorld` and its `roomFor` expectations stay as they
 * are: in the hall, a look at the bell lights the bulb and runs a knot, a look at the switch lights the lamp, and the
 * door stands ajar once the den was visited. The den shares the hall's bg.
 */
function edgeWorld(): WorldPublic {
  const raw = {
    format: 1,
    items: {},
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
              exit('to_den', 'den'),
              look('switch'),
              { id: 'bell', kind: 'look', rect: RECT, label: txt('bell'), look: txt('seen bell'), then: [{ story: 'after' }] },
              object('lamp', 'lamp', LAMP, { states: { lit: { prop: 'lamp_lit' } }, is: onceSeen('hall.switch', 'lit') }),
              object('bulb', 'bulb', BUST, { states: { lit: { prop: 'bulb_lit' } }, is: onceSeen('hall.bell', 'lit') }),
              object('door', 'door', VASE, { states: { ajar: { prop: 'door_ajar' } }, is: [{ when: { visited: 'den' }, state: 'ajar' }] }),
            ],
          },
          den: { bg: 'hall', title: txt('Den'), onEnter: [], hotspots: [exit('to_hall', 'hall'), object('mirror', 'mirror', MIRROR)] },
        },
      },
    },
  };
  const r = decodeWorldSource(raw);
  if (!r.ok) {
    throw new Error(`invariant: the edge fixture world decodes: ${JSON.stringify(r.error)}`);
  }
  return { ...toPublic(r.value), mods: r.value.mods, version: '5555555555555555' };
}

test("yields: a dispatch's state change shows before its knot job", async () => {
  const r = rig({ world: edgeWorld() });
  await inHall(r);
  const mark = r.log.length;
  r.yields.layer.ontap(key('hall.bell'));
  await settle();
  // The look lit the bulb and queued its knot: the state batch runs ahead of the dispatch's own jobs, so the knot
  // starts over the changed picture (B-001).
  expect(r.log.slice(mark).filter((l) => l.startsWith('apply:') || l.startsWith('enter:'))).toEqual(['apply:bg,props|', 'enter:after']);
  expect(r.stage().props).toContainEqual(placed('bulb_lit', BUST, 'hall.bulb'));
  r.yields.dispose();
});

test('yields: a state change under a close-up applies no batch', async () => {
  const r = rig({ world: edgeWorld() });
  await inHall(r);
  // No shipped path changes a room's picture under a close-up (a puzzle's end awaits the close-up's fade-out before it
  // dispatches), so the stage is put there directly: the guard leaves the props to the room batch that shows the room.
  await r.host.apply([{ kind: 'cg', cg: 'drawer_close' as CgId, t: 'cut', ms: 0 }], []);
  const mark = r.batches.length;
  r.yields.layer.ontap(key('hall.switch'));
  await settle();
  // The look changed the hall's picture (the lamp is lit), so the empty batch list is the guard, not an empty diff.
  expect(r.yields.world().examined).toContain('hall.switch');
  expect((r.yields.roomFor('hall' as BgId) ?? []).flatMap((c) => (c.kind === 'props' ? c.props : []))).toContainEqual(placed('lamp_lit', LAMP, 'hall.lamp'));
  expect(r.batches.slice(mark)).toEqual([]);
  r.yields.dispose();
});

test('yields: a state change while another bg is up applies no batch', async () => {
  const r = rig({ world: edgeWorld() });
  await inHall(r);
  // No shipped path changes a room's picture while another bg is up (taps come only from the explore layer, which a
  // room batch shows over the room's own bg), so the stage is put there directly, on a bg no room of the world has:
  // the guard leaves the props to the room batch that shows the room again.
  await r.host.apply([{ kind: 'bg', bg: 'cellar' as BgId, t: 'cut', ms: 0 }], []);
  const lamp = placed('lamp_lit', LAMP, 'hall.lamp');
  const hallProps = () => (r.yields.roomFor('hall' as BgId) ?? []).flatMap((c) => (c.kind === 'props' ? c.props : []));
  expect(hallProps()).not.toContainEqual(lamp);
  const mark = r.batches.length;
  r.yields.layer.ontap(key('hall.switch'));
  await settle();
  // The look changed the hall's picture (the lamp is lit), so the empty batch list is the guard, not an empty diff.
  expect(r.yields.world().examined).toContain('hall.switch');
  expect(hallProps()).toContainEqual(lamp);
  expect(r.batches.slice(mark)).toEqual([]);
  expect(r.stage().bg).toBe('cellar');
  r.yields.dispose();
});

test('yields: a state change the stage already shows applies no batch', async () => {
  const r = rig({ world: edgeWorld() });
  await inHall(r);
  // No shipped state change keeps a room's placements (ch1's one `is`, the drawer, changes its prop), so the stage is
  // put there directly: the hall's props with the lamp already lit, the picture the look below leads to. The guard
  // leaves a picture the stage already shows alone: no crossfade onto the same props, no hold at the anchor.
  const lamp = placed('lamp_lit', LAMP, 'hall.lamp');
  const lit = r.stage().props.map((p) => (p.at === 'hall.lamp' ? { ...p, prop: 'lamp_lit' as PropId } : p));
  await r.host.apply([{ kind: 'props', props: lit }], []);
  expect(r.stage().props).toContainEqual(lamp);
  const hallProps = () => (r.yields.roomFor('hall' as BgId) ?? []).flatMap((c) => (c.kind === 'props' ? c.props : []));
  expect(hallProps()).not.toContainEqual(lamp);
  const mark = r.batches.length;
  const cm = r.cues.length;
  r.yields.layer.ontap(key('hall.switch'));
  await settle();
  // The look changed the lamp's state (its cue carries the diff) to the picture already up, so the empty batch list is
  // the guard, not an empty diff.
  expect(r.yields.world().examined).toContain('hall.switch');
  expect(r.cues.slice(cm).map((e) => e.diff)).toContainEqual([{ at: 'hall.lamp', from: 'default', to: 'lit' }]);
  expect(r.stage().props).toEqual(hallProps());
  expect(r.batches.slice(mark)).toEqual([]);
  r.yields.dispose();
});

test("yields: a move that changes the left room's picture stays a room fade", async () => {
  const r = rig({ world: edgeWorld() });
  await inHall(r);
  const mark = r.cues.length;
  const at = r.batches.length;
  r.yields.layer.ontap(key('hall.to_den'));
  await settle();
  // The arrival marks the den visited, which sets the hall's door ajar: a change to the room left, not to the one on
  // screen. No cue of the move carries it, and no state batch runs ahead of the move: the den fades in on the same bg.
  expect(roomOf(r)).toBe('den');
  const moved = r.cues.slice(mark);
  expect(moved.map((e) => keyOf(e.cue))).toContain('move:walk');
  expect(moved.filter((e) => e.diff.length > 0)).toEqual([]);
  expect(r.batches.slice(at)).toEqual([[{ kind: 'bg', bg: 'hall', t: 'fade', ms: ROOM_FADE_MS }, { kind: 'props', props: [placed('mirror', MIRROR, 'den.mirror')] }]]);
  // Back in the hall, the door stands ajar: the move did change the picture of the room it left.
  r.yields.layer.ontap(key('den.to_hall'));
  await settle();
  expect(r.stage().props).toContainEqual(placed('door_ajar', VASE, 'hall.door'));
  r.yields.dispose();
});

test("yields: a room batch applies when a prop's rect or the prop count differs", async () => {
  // `sameProps` (the room batch's "the stage already shows the room" guard) compares each placement's rect and the two
  // lists' lengths. No shipped path leaves the stage on a room's bg with its props almost drawn, so the stage is put
  // there directly from the den, which shares the hall's bg, and the hall is entered again.
  const r = rig({ world: visualWorld() });
  await inHall(r);
  const hallShown = r.stage().props;
  expect(hallShown).toEqual(HALL_PROPS);
  const fade = [{ kind: 'bg', bg: 'hall', t: 'fade', ms: ROOM_FADE_MS }, { kind: 'props', props: HALL_PROPS }];
  const backToHall = async (shown: typeof hallShown): Promise<VisualCommand[][]> => {
    r.yields.layer.ontap(key('hall.to_den'));
    await settle();
    await r.host.apply([{ kind: 'props', props: shown }], []);
    expect(r.stage().bg).toBe('hall');
    const at = r.batches.length;
    r.yields.layer.ontap(key('den.to_hall'));
    await settle();
    expect(roomOf(r)).toBe('hall');
    return r.batches.slice(at);
  };
  // The lamp's image on its own anchor, at another rect.
  const moved = hallShown.map((p) => (p.at === 'hall.lamp' ? { ...p, rect: [LAMP[0] + 50, LAMP[1], LAMP[2], LAMP[3]] as const } : p));
  expect(await backToHall(moved)).toEqual([fade]);
  // One placement more on the room's side: the stage shows a strict prefix of the room's placements.
  expect(await backToHall(hallShown.slice(0, -1))).toEqual([fade]);
  r.yields.dispose();
});

test('yields: a room batch over a close-up applies its fade', async () => {
  // The room's own bg and props are on the stage, but a close-up stands over them: the batch applies, so the room
  // comes back over the close-up (no shipped move starts under one; the stage is put there directly).
  const r = rig({ world: visualWorld() });
  await inHall(r);
  const hallShown = r.stage().props;
  r.yields.layer.ontap(key('hall.to_den'));
  await settle();
  await r.host.apply([{ kind: 'props', props: hallShown }, { kind: 'cg', cg: 'drawer_close' as CgId, t: 'cut', ms: 0 }], []);
  expect([r.stage().bg, r.stage().cg, r.stage().props]).toEqual(['hall', 'drawer_close', HALL_PROPS]);
  const at = r.batches.length;
  r.yields.layer.ontap(key('den.to_hall'));
  await settle();
  expect(r.batches.slice(at)).toEqual([[{ kind: 'bg', bg: 'hall', t: 'fade', ms: ROOM_FADE_MS }, { kind: 'props', props: HALL_PROPS }]]);
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

/** The hall gives the shard, the glue and the coin; the shard and the glue make the vase, with a say. */
function combineWorld(): WorldPublic {
  const raw = {
    format: 1,
    items: {
      shard: { name: txt('Осколок'), desc: txt('d'), glyph: 'key' },
      glue: { name: txt('Клей'), desc: txt('d'), glyph: 'key' },
      coin: { name: txt('Монета'), desc: txt('d'), glyph: 'coin' },
      vase: { name: txt('Ваза'), desc: txt('d'), glyph: 'key' },
    },
    docs: {},
    puzzles: {},
    sections: {
      manor: {
        start: 'hall',
        bgm: null,
        rooms: { hall: { bg: 'hall', title: txt('Hall'), onEnter: [], hotspots: [take('shard', 'shard', null), take('glue', 'glue', null), take('coin', 'coin', null)] } },
      },
    },
    recipes: [{ a: 'shard', b: 'glue', gives: 'vase', say: txt('Ваза склеена.') }],
  };
  const r = decodeWorldSource(raw);
  if (!r.ok) {
    throw new Error(`invariant: the combine fixture world decodes: ${JSON.stringify(r.error)}`);
  }
  return { ...toPublic(r.value), mods: r.value.mods, version: '4444444444444444' };
}

/** The hall of `combineWorld` with each of `takes` taken. */
async function holding(r: Rig, ...takes: string[]): Promise<void> {
  await inHall(r);
  for (const t of takes) {
    r.yields.layer.ontap(key(`hall.${t}`));
    await settle();
  }
}

/** The note toasts a look or a gift shows, as [key, message]. */
const notes = (r: Rig): Array<[string, string]> => r.vm.toasts.flatMap((e): Array<[string, string]> => (e.kind === 'note' && (e.key === 'got' || e.key === 'look') ? [[e.key, e.message]] : []));

test('yields: a ribbon item tapped onto another combines them', async () => {
  const r = rig({ world: combineWorld() });
  await holding(r, 'shard', 'glue');
  const shard = 'shard' as ItemId;
  r.yields.layer.onselect(shard);
  const mark = r.cues.length;
  r.yields.layer.oncombine(shard, 'glue' as ItemId);
  await settle();
  // The inputs leave the hands for the product, the selection with them.
  expect([r.yields.world().held, r.yields.world().used, r.explore.selected]).toEqual([['vase'], ['shard', 'glue'], null]);
  // Its toasts: the product's name, then the say.
  expect(notes(r)).toEqual([
    ['got', 'Ваза'],
    ['look', 'Ваза склеена.'],
  ]);
  // One block: the selection settles, then the writes' fact cues (no module cue: a run has none, 08b).
  expect(keysOf(r, mark)).toEqual(['ui-state:deselect', 'fact:held:removed', 'fact:held:removed', 'fact:used:added', 'fact:used:added', 'fact:held:added']);
  r.yields.dispose();
});

test('yields: a refused combine shakes both items and writes nothing', async () => {
  const r = rig({ world: combineWorld() });
  await holding(r, 'shard', 'coin');
  const before = r.yields.world();
  const toasts = r.vm.toasts;
  r.yields.layer.onselect('shard' as ItemId);
  const mark = r.cues.length;
  r.yields.layer.oncombine('shard' as ItemId, 'coin' as ItemId);
  await settle();
  // Nothing written, no toast; the selection settles, then the selected item shakes and the tapped one with it.
  expect([r.yields.world(), r.explore.selected, r.vm.toasts]).toEqual([before, null, toasts]);
  expect(r.cues.slice(mark).map((e) => [keyOf(e.cue), e.cue.kind === 'module' || e.cue.kind === 'ui-state' ? e.cue.item : null, e.box])).toEqual([
    ['ui-state:deselect', 'shard', null],
    ['module:combine:refused', 'shard', null],
    ['module:combine:refused-with', 'coin', null],
  ]);
  r.yields.dispose();
});

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

test('yields: a countdown that ends on a frame showing its attempts plays ready with them', async () => {
  // 08a: `index` = the attempts left when the frame shows them (`frame.attemptsLeft`); a 429 keeps them.
  const r = rig({ world: puzzleWorld(), attempts: [httpError(429, 1)] });
  await r.yields.onYield({ kind: 'puzzle', puzzle: PIECES, then: AFTER });
  expect(r.puzzle.frame?.attemptsLeft, 'the frame shows its attempts').toBe(3);
  r.yields.host.ontry();
  await settle();
  expect([r.calls.attempts, r.puzzle.frame?.line, r.puzzle.frame?.attemptsLeft]).toEqual([1, 'rate-limited', 3]);
  const mark = r.cues.length;
  r.clock.advance(1000);
  await settle();
  expect(frameKeys(r, mark)).toEqual(['puzzle:ready@3']);
  expect([r.puzzle.frame?.line, r.puzzle.frame?.attemptsLeft]).toEqual(['idle', 3]);
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

// ---------------------------------------------------------------------------------------------------------------
// GM3p: the hint ladder has one writer, and every answer plays its cue (engine plan §8.1 "The hint ladder")

/** The drawer's status: tier 1 unlocked, tiers 2 and 3 to spend on. */
const LADDER_STATUS: PuzzleStatus = {
  puzzleId: 'ch1.drawer',
  solved: false,
  hints: [
    { tier: 1, unlocked: true, text: 'one' },
    { tier: 2, unlocked: false, text: null },
    { tier: 3, unlocked: false, text: null },
  ],
  valueRun: null,
};

/** A hint port whose `use` answers with the next queued result (a spend by default), after its gate. */
function ladderPort(balance: number) {
  const state = { balance, gate: Promise.resolve() as Promise<void> };
  const results: Array<Result<{ text: string; balance: number }, HintPortError>> = [];
  const port: HintPort = {
    balance: () => state.balance,
    tierCost: () => 1,
    use: async () => {
      await state.gate;
      return results.shift() ?? { ok: true, value: { text: 'spent', balance: state.balance } };
    },
    getMore: () => {},
  };
  return { port, results, state };
}

/** The ladder's own cues after `from`: its hold's edges (`panel: 'hints'`) and its puzzle cues, with their index. */
const ladderKeys = (r: Rig, from: number): string[] =>
  r.cues.slice(from).flatMap((e) =>
    e.cue.kind === 'ui-state' && e.cue.panel === 'hints' && (e.cue.name === 'waiting' || e.cue.name === 'waited')
      ? [`ui-state:${e.cue.name}@hints`]
      : e.cue.kind === 'puzzle' && ['ladder', 'hint-shown', 'hint-failed', 'hint-renewing'].includes(e.cue.name)
        ? [`puzzle:${e.cue.name}${e.cue.index === null ? '' : `@${e.cue.index}`}`]
        : [],
  );

/** One step: what it runs (synchronously, or awaited when it answers a promise), the ladder after it, its cues. */
type LadderStep = readonly [name: string, run: () => unknown, ladder: { busy: boolean; failed: boolean } | null, cues: readonly string[]];

async function ladderSteps(r: Rig, steps: readonly LadderStep[]): Promise<void> {
  for (const [name, run, ladder, cues] of steps) {
    const mark = r.cues.length;
    const p = run();
    if (p instanceof Promise) {
      await p;
    }
    const l = r.puzzle.ladder;
    expect(l === null ? null : { busy: l.busy, failed: l.failed }, `${name}: the ladder`).toEqual(ladder);
    expect(ladderKeys(r, mark), `${name}: its cues`).toEqual(cues);
  }
}

test('yields: every hint-ladder answer plays its cue', async () => {
  // A ladder with a port: the status, a re-read, the uses and their answers, a wallet re-read, the sheet's close.
  const status = deferred<void>();
  const w = ladderPort(5);
  const r = rig({ status: LADDER_STATUS, statusGate: status.promise, hints: w.port });
  await r.yields.onYield({ kind: 'puzzle', puzzle: DRAWER, then: AFTER });
  const use = deferred<void>();
  const failedUse: Result<{ text: string; balance: number }, HintPortError> = { ok: false, error: { kind: 'network' } };
  await ladderSteps(r, [
    ['Hint', () => r.yields.host.onhint(), { busy: true, failed: false }, ['ui-state:waiting@hints']],
    ['the status answered', () => (status.resolve(), settle()), { busy: false, failed: false }, ['ui-state:waited@hints', 'puzzle:ladder']],
    ['a re-read of tier 1', () => r.yields.host.onusehint(1), { busy: false, failed: false }, ['puzzle:hint-shown@1']],
    ['a use of tier 2 starts', () => ((w.state.gate = use.promise), r.yields.host.onusehint(2)), { busy: true, failed: false }, ['ui-state:waiting@hints']],
    ['a second use while it runs (busy)', () => (r.yields.host.onusehint(2), settle()), { busy: true, failed: false }, []],
    ['the use answered', () => (use.resolve(), settle()), { busy: false, failed: false }, ['ui-state:waited@hints', 'puzzle:hint-shown@2', 'puzzle:ladder']],
    ['a use of tier 3 failed', () => (w.results.push(failedUse), r.yields.host.onusehint(3), settle()), { busy: false, failed: true }, ['ui-state:waiting@hints', 'ui-state:waited@hints', 'puzzle:hint-failed@3']],
    ['a re-read over the failed ladder', () => r.yields.host.onusehint(1), { busy: false, failed: false }, ['puzzle:hint-shown@1', 'puzzle:ladder']],
    ['tier 3 failed again', () => (w.results.push(failedUse), r.yields.host.onusehint(3), settle()), { busy: false, failed: true }, ['ui-state:waiting@hints', 'ui-state:waited@hints', 'puzzle:hint-failed@3']],
    ['a use starts over the failed ladder', () => ((w.state.gate = new Promise<void>(() => undefined)), r.yields.host.onusehint(3)), { busy: true, failed: true }, ['ui-state:waiting@hints']],
  ]);
  r.yields.dispose();
  // The no-text answers: each a waited and the ladder re-read, the alert cleared.
  for (const kind of ['insufficient', 'unavailable'] as const) {
    const n = ladderPort(5);
    const x = rig({ status: LADDER_STATUS, hints: n.port });
    await x.yields.onYield({ kind: 'puzzle', puzzle: DRAWER, then: AFTER });
    x.yields.host.onhint();
    await settle();
    n.results.push({ ok: false, error: { kind } });
    await ladderSteps(x, [
      [`a use answered ${kind}`, () => (x.yields.host.onusehint(2), settle()), { busy: false, failed: false }, ['ui-state:waiting@hints', 'ui-state:waited@hints', 'puzzle:ladder']],
    ]);
    x.yields.dispose();
  }
  // The wallet re-read on a screens change: the balance moved (a pack bought over the ladder), then it did not.
  const m = ladderPort(5);
  const y = rig({ status: LADDER_STATUS, hints: m.port });
  await y.yields.onYield({ kind: 'puzzle', puzzle: DRAWER, then: AFTER });
  y.yields.host.onhint();
  await settle();
  await ladderSteps(y, [
    ['the wallet opens over the ladder', () => y.screens.push({ kind: 'wallet' }), { busy: false, failed: false }, []],
    ['the wallet closes with a new balance', () => ((m.state.balance = 9), y.screens.back()), { busy: false, failed: false }, ['puzzle:ladder']],
    ['the sheet closes, idle', () => y.screens.back(), null, []],
  ]);
  y.yields.dispose();
  // A status that fails, a Hint again over the failed ladder (the alert kept), and the sheet closed while it is busy.
  const again = deferred<void>();
  const f = rig({ statusGate: again.promise, hints: ladderPort(5).port });
  await f.yields.onYield({ kind: 'puzzle', puzzle: DRAWER, then: AFTER });
  await ladderSteps(f, [
    ['Hint', () => f.yields.host.onhint(), { busy: true, failed: false }, ['ui-state:waiting@hints']],
    ['the status failed', () => (again.resolve(), settle()), { busy: false, failed: true }, ['ui-state:waited@hints', 'puzzle:hint-failed']],
    ['Hint again over the failed ladder', () => f.yields.host.onhint(), { busy: true, failed: true }, ['ui-state:waiting@hints']],
    ['its status failed again', () => settle(), { busy: false, failed: true }, ['ui-state:waited@hints', 'puzzle:hint-failed']],
  ]);
  f.yields.dispose();
  const busyClose = rig({ statusGate: new Promise<void>(() => undefined), hints: ladderPort(5).port });
  await busyClose.yields.onYield({ kind: 'puzzle', puzzle: DRAWER, then: AFTER });
  await ladderSteps(busyClose, [
    ['Hint', () => busyClose.yields.host.onhint(), { busy: true, failed: false }, ['ui-state:waiting@hints']],
    ['the sheet closes while the status runs', () => busyClose.screens.back(), null, ['ui-state:waited@hints']],
  ]);
  busyClose.yields.dispose();
  // A drop of the frame over a busy ladder ends its hold.
  const dropped = rig({ statusGate: new Promise<void>(() => undefined), hints: ladderPort(5).port });
  await dropped.yields.onYield({ kind: 'puzzle', puzzle: DRAWER, then: AFTER });
  await ladderSteps(dropped, [
    ['Hint', () => dropped.yields.host.onhint(), { busy: true, failed: false }, ['ui-state:waiting@hints']],
    ['the frame dropped', () => dropped.yields.disposePuzzle(), null, ['ui-state:waited@hints']],
  ]);
  dropped.yields.dispose();
});

test('yields: a status that answers after Back leaves the ladder closed', async () => {
  const status = deferred<void>();
  const r = rig({ status: LADDER_STATUS, statusGate: status.promise, hints: ladderPort(5).port });
  await r.yields.onYield({ kind: 'puzzle', puzzle: DRAWER, then: AFTER });
  r.yields.host.onhint();
  r.screens.back(); // the sheet closes before the status answers
  expect(r.puzzle.ladder).toBeNull();
  const mark = r.cues.length;
  status.resolve();
  await settle();
  expect(r.puzzle.ladder).toBeNull();
  expect(ladderKeys(r, mark)).toEqual([]);
  r.yields.dispose();
});

test('yields: two Hint taps that share one status play its answer once', async () => {
  // The session's status is single-flight, and the Hint button stays enabled while it runs: a repeat tap shares the
  // request, takes only its hold's edge, and the one answer writes the ladder and plays its cue once (08a's table).
  const status = deferred<void>();
  const r = rig({ status: LADDER_STATUS, statusGate: status.promise, hints: ladderPort(5).port });
  await r.yields.onYield({ kind: 'puzzle', puzzle: DRAWER, then: AFTER });
  await ladderSteps(r, [
    ['Hint', () => r.yields.host.onhint(), { busy: true, failed: false }, ['ui-state:waiting@hints']],
    ['Hint again while the status runs', () => r.yields.host.onhint(), { busy: true, failed: false }, []],
    ['the status answered', () => (status.resolve(), settle()), { busy: false, failed: false }, ['ui-state:waited@hints', 'puzzle:ladder']],
  ]);
  expect(r.calls.status, 'one status request').toBe(1);
  r.yields.dispose();
  // Back, then Hint again while the same status still runs: its answer still plays once.
  const late = deferred<void>();
  const b = rig({ status: LADDER_STATUS, statusGate: late.promise, hints: ladderPort(5).port });
  await b.yields.onYield({ kind: 'puzzle', puzzle: DRAWER, then: AFTER });
  await ladderSteps(b, [
    ['Hint', () => b.yields.host.onhint(), { busy: true, failed: false }, ['ui-state:waiting@hints']],
    ['the sheet closes while the status runs', () => b.screens.back(), null, ['ui-state:waited@hints']],
    ['Hint again while it still runs', () => b.yields.host.onhint(), { busy: true, failed: false }, ['ui-state:waiting@hints']],
    ['the status answered', () => (late.resolve(), settle()), { busy: false, failed: false }, ['ui-state:waited@hints', 'puzzle:ladder']],
  ]);
  expect(b.calls.status, 'one status request').toBe(1);
  b.yields.dispose();
});

test('yields: two Hint taps that share one failed status play its failure once', async () => {
  // The failed answer likewise; a tap after it starts a new request with its own answer, and a repeat tap during
  // that one keeps the alert up (08a: a repeat Hint keeps `failed`).
  const again = deferred<void>();
  const f = rig({ statusGate: again.promise, hints: ladderPort(5).port });
  await f.yields.onYield({ kind: 'puzzle', puzzle: DRAWER, then: AFTER });
  await ladderSteps(f, [
    ['Hint', () => f.yields.host.onhint(), { busy: true, failed: false }, ['ui-state:waiting@hints']],
    ['Hint again while the status runs', () => f.yields.host.onhint(), { busy: true, failed: false }, []],
    ['the status failed', () => (again.resolve(), settle()), { busy: false, failed: true }, ['ui-state:waited@hints', 'puzzle:hint-failed']],
    ['Hint again over the failed ladder', () => f.yields.host.onhint(), { busy: true, failed: true }, ['ui-state:waiting@hints']],
    ['and once more while its status runs', () => f.yields.host.onhint(), { busy: true, failed: true }, []],
    ['its status failed again', () => settle(), { busy: false, failed: true }, ['ui-state:waited@hints', 'puzzle:hint-failed']],
  ]);
  expect(f.calls.status, 'one status request per answer').toBe(2);
  f.yields.dispose();
});

test('yields: a Hint tap while the ladder is busy only shows the ladder', async () => {
  // Q68: a Hint tap while a hint use is in flight starts no status request: the use's answer is the ladder's, with its
  // one cue (GM3p's I1 rule), and the tap only shows the sheet.
  const w = ladderPort(5);
  const r = rig({ status: LADDER_STATUS, hints: w.port });
  await r.yields.onYield({ kind: 'puzzle', puzzle: DRAWER, then: AFTER });
  r.yields.host.onhint();
  await settle();
  const asked = r.calls.status;
  const use = deferred<void>();
  await ladderSteps(r, [
    ['a use of tier 2 starts', () => ((w.state.gate = use.promise), r.yields.host.onusehint(2)), { busy: true, failed: false }, ['ui-state:waiting@hints']],
    ['Hint while the use runs', () => (r.yields.host.onhint(), settle()), { busy: true, failed: false }, []],
    ['the use answered', () => (use.resolve(), settle()), { busy: false, failed: false }, ['ui-state:waited@hints', 'puzzle:hint-shown@2', 'puzzle:ladder']],
  ]);
  expect(r.calls.status, 'no status request while the use runs').toBe(asked);
  expect(r.vm.screens.overlays.filter((s) => s.kind === 'hints'), 'the sheet shows once').toHaveLength(1);
  r.yields.dispose();
});

test('yields: the ladder has one writer', () => {
  // Engine plan §8.1: every write of `puzzle.ladder` goes through `setLadder`, which emits its hold's edges.
  const writes = [...yieldsSource.matchAll(/\bpuzzle\.ladder = /g)].map((m) => m.index);
  expect(writes).toHaveLength(1);
  const start = yieldsSource.indexOf('  const setLadder = ');
  const end = yieldsSource.indexOf('\n  };\n', start);
  expect([start > -1, writes.every((i) => i > start && i < end)]).toEqual([true, true]);
});

// ---------------------------------------------------------------------------------------------------------------
// GM3p: a chunk Retry keeps its notice (engine plan §8.1 "The frame's flags and its ends"; 00-decision-table W1)

/** The frame's chunk fields: the only ones a chunk's result writes. */
const chunkFlags = (r: Rig): { loadFailed: boolean; retrying: boolean; ui: unknown } | null => {
  const f = r.puzzle.frame;
  return f === null ? null : { loadFailed: f.loadFailed, retrying: f.retrying, ui: f.ui };
};
const CHUNK_OFFLINE = { ok: false, error: { kind: 'chunk', detail: 'offline' } } as const;

test('yields: a failed type chunk plays load-failed and a retry keeps the notice until it answers', async () => {
  const host = chunkQueue<Result<Component<PuzzleHostProps>, ChunkError>>();
  const ui = chunkQueue<Result<Component<PuzzleUiProps>, ChunkError>>();
  const r = rig({ world: puzzleWorld(), loaders: { puzzleHost: host.loader, puzzleUi: ui.loader } });
  const opening = r.yields.onYield({ kind: 'puzzle', puzzle: CABINET, then: AFTER });
  await settle();
  host.land({ ok: true, value: HOST });
  ui.land(CHUNK_OFFLINE);
  await opening;
  expect(chunkFlags(r), 'the type chunk failed').toEqual({ loadFailed: true, retrying: false, ui: null });
  expect(frameKeys(r)).toEqual(['ui-state:waiting@puzzle', 'ui-state:waited@puzzle', 'ui-state:panel-open@puzzle', 'puzzle:load-failed']);
  // Retry: the notice stays, its Retry disabled, and the load hold opens again; a second tap meanwhile does nothing.
  let mark = r.cues.length;
  r.yields.host.onretry();
  expect(chunkFlags(r), 'Retry').toEqual({ loadFailed: true, retrying: true, ui: null });
  r.yields.host.onretry();
  await settle();
  expect([host.waiting(), ui.waiting()], 'one reload').toEqual([1, 1]);
  expect(frameKeys(r, mark), 'Retry').toEqual(['ui-state:waiting@puzzle']);
  // The reload fails: the notice again, Retry enabled, its wobble.
  mark = r.cues.length;
  host.land({ ok: true, value: HOST });
  ui.land(CHUNK_OFFLINE);
  await settle();
  expect(chunkFlags(r), 'the reload failed').toEqual({ loadFailed: true, retrying: false, ui: null });
  expect(frameKeys(r, mark), 'the reload failed').toEqual(['ui-state:waited@puzzle', 'puzzle:load-failed']);
  // Retry again, and the reload loads: the type UI opens.
  mark = r.cues.length;
  r.yields.host.onretry();
  expect(chunkFlags(r), 'Retry again').toEqual({ loadFailed: true, retrying: true, ui: null });
  await settle();
  host.land({ ok: true, value: HOST });
  ui.land({ ok: true, value: TYPE_UI });
  await settle();
  expect(chunkFlags(r), 'the reload loaded').toEqual({ loadFailed: false, retrying: false, ui: TYPE_UI });
  expect(frameKeys(r, mark), 'the reload loaded').toEqual(['ui-state:waiting@puzzle', 'ui-state:waited@puzzle', 'puzzle:opened']);
  // Retry over a loaded frame does nothing.
  mark = r.cues.length;
  r.yields.host.onretry();
  await settle();
  expect([chunkFlags(r)?.retrying, frameKeys(r, mark), host.waiting(), ui.waiting()]).toEqual([false, [], 0, 0]);
  r.yields.dispose();
});

test('yields: a chunk result writes only the chunk fields', async () => {
  // A frame waiting for a settling answer (per-player's values wait, set through the store) when its chunks land: the
  // result moves `ui`, `loadFailed` and `retrying` only, whether it loads or fails (W1: round 7's `busy: false`).
  for (const result of [{ ok: true, value: TYPE_UI }, CHUNK_OFFLINE] as const) {
    const ui = chunkQueue<Result<Component<PuzzleUiProps>, ChunkError>>();
    const r = rig({ world: puzzleWorld(), loaders: { puzzleUi: ui.loader } });
    const opening = r.yields.onYield({ kind: 'puzzle', puzzle: CABINET, then: AFTER });
    await settle();
    const f = r.puzzle.frame;
    if (f === null) {
      throw new Error('expected the open frame');
    }
    const before: PuzzleFrameView = { ...f, busy: true, line: 'checking' };
    r.puzzle.frame = before;
    ui.land(result);
    await opening;
    const after = r.puzzle.frame;
    if (after === null) {
      throw new Error('expected the frame after its chunk');
    }
    const moved = (Object.keys(after) as (keyof PuzzleFrameView)[]).filter((k) => !Object.is(after[k], before[k]));
    expect(moved.filter((k) => k !== 'ui' && k !== 'loadFailed' && k !== 'retrying'), `${result.ok}: moved`).toEqual([]);
    r.yields.dispose();
  }
  // A failed chunk, Retry, and the reload's result: `retrying` ends with it, loaded or failed.
  for (const reload of [{ ok: true, value: TYPE_UI }, CHUNK_OFFLINE] as const) {
    const ui = chunkQueue<Result<Component<PuzzleUiProps>, ChunkError>>();
    const r = rig({ world: puzzleWorld(), loaders: { puzzleUi: ui.loader } });
    const opening = r.yields.onYield({ kind: 'puzzle', puzzle: CABINET, then: AFTER });
    await settle();
    ui.land(CHUNK_OFFLINE);
    await opening;
    r.yields.host.onretry();
    await settle();
    ui.land(reload);
    await settle();
    expect([r.puzzle.frame?.retrying, r.puzzle.frame?.busy], `${reload.ok}: after the reload`).toEqual([false, false]);
    r.yields.dispose();
  }
});

test("yields: App's host-chunk Retry emits its control cue", async () => {
  /** The `ui:puzzle-retry` cues from `from` on, with their element, point and box. */
  const retries = (r: Rig, from: number): unknown[] =>
    r.cues.slice(from).flatMap((e) => (e.cue.kind === 'ui' && e.cue.control === 'puzzle-retry' ? [[keyOf(e.cue), e.el, e.point, e.box]] : []));
  // The host chunk failed: App's failed-host block shows outside every cue root, so yields emits its Retry's cue (the
  // stage finds the control by its name); the block stays while the reload runs.
  const host = chunkQueue<Result<Component<PuzzleHostProps>, ChunkError>>();
  const r = rig({ world: puzzleWorld(), loaders: { puzzleHost: host.loader } });
  const opening = r.yields.onYield({ kind: 'puzzle', puzzle: CABINET, then: AFTER });
  await settle();
  host.land(CHUNK_OFFLINE);
  await opening;
  expect([r.puzzle.host, r.puzzle.frame?.loadFailed]).toEqual([null, true]);
  let mark = r.cues.length;
  r.yields.host.onretry();
  r.yields.host.onretry(); // a second tap while it reloads (its button disabled): nothing
  expect(retries(r, mark), 'the failed-host Retry').toEqual([['ui:puzzle-retry', null, null, null]]);
  expect([r.puzzle.host, r.puzzle.frame?.loadFailed, r.puzzle.frame?.retrying], 'the block stays').toEqual([null, true, true]);
  host.land({ ok: true, value: HOST });
  await settle();
  expect([r.puzzle.host, chunkFlags(r)], 'the reload loaded').toEqual([HOST, { loadFailed: false, retrying: false, ui: TYPE_UI }]);
  r.yields.dispose();
  // The host loaded and the type chunk failed: PuzzleHost's own Retry emits through its frame root, so yields does not.
  const typeFailed = rig({ world: puzzleWorld(), loaders: { puzzleUi: async () => CHUNK_OFFLINE } });
  await typeFailed.yields.onYield({ kind: 'puzzle', puzzle: CABINET, then: AFTER });
  expect([typeFailed.puzzle.host, typeFailed.puzzle.frame?.loadFailed]).toEqual([HOST, true]);
  mark = typeFailed.cues.length;
  typeFailed.yields.host.onretry();
  expect(retries(typeFailed, mark), "the frame's Retry").toEqual([]);
  typeFailed.yields.dispose();
});

// ---------------------------------------------------------------------------------------------------------------
// GM3p: the state gate (engine plan §8.5; 08c "yields: every visible change of the puzzle view plays a cue")

/** The keys that settle a wait: the only ones that cover `busy` turning false or `attemptsLeft` moving (round 8). */
const SETTLE_KEYS = ['puzzle:wrong', 'puzzle:failed', 'puzzle:solved', 'puzzle:offline', 'puzzle:rate-limited', 'puzzle:ready', 'puzzle:renewed', 'puzzle:reset'];
/** A field's covering keys, from its new value (`VIEW_FIELD_CUES`), or why it never moves in a frame (`SILENT_VIEW_FIELDS`). */
type Covering = { readonly keys: (now: unknown) => readonly string[] } | { readonly silent: string };
const FIXED: Covering = { silent: 'fixed for the frame: its session opened it with this value' };
const CHUNK_KEYS: Covering = { keys: () => ['puzzle:opened', 'puzzle:load-failed'] };
const RUNG_KEYS: Covering = { keys: () => ['puzzle:ladder', 'puzzle:hint-shown', 'puzzle:hint-renewing'] };

/** Both tables in one: tsc holds every field of the view to exactly one entry (a new field fails the check). */
const FRAME_FIELD_CUES: { readonly [K in keyof PuzzleFrameView]-?: Covering } = {
  id: { silent: 'the frame itself: a new id is a new frame, its panel-open and the old frame end' },
  mode: FIXED,
  type: FIXED,
  title: FIXED,
  prompt: FIXED,
  params: FIXED,
  answer: { keys: () => ['puzzle:input', 'puzzle:reset', 'puzzle:demo'] },
  busy: { keys: (v) => (v === true ? ['puzzle:checking'] : SETTLE_KEYS) },
  line: { keys: (v) => (v === 'checking' ? ['puzzle:checking'] : v === 'idle' ? ['puzzle:ready', 'puzzle:renewed'] : [`puzzle:${String(v)}`]) },
  attemptsLeft: { keys: () => SETTLE_KEYS },
  retryAfter: { keys: () => ['puzzle:rate-limited', 'puzzle:ready', 'puzzle:checking'] },
  giveUp: FIXED,
  hintTiers: FIXED,
  ui: CHUNK_KEYS,
  loadFailed: CHUNK_KEYS,
  retrying: { keys: (v) => [v === true ? 'ui-state:waiting@puzzle' : 'ui-state:waited@puzzle'] },
};
const LADDER_FIELD_CUES: { readonly [K in keyof HintLadderUiView]-?: Covering } = {
  tiers: RUNG_KEYS,
  wallet: RUNG_KEYS,
  busy: { keys: (v) => [v === true ? 'ui-state:waiting@hints' : 'ui-state:waited@hints'] },
  failed: { keys: (v) => [v === true ? 'puzzle:hint-failed' : 'puzzle:ladder'] },
};

/** By value, as `isDeepStrictEqual` compares (08c): the rebuilt `tiers` / `wallet` count when their content moves; a function (the type UI) by identity. */
function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) {
    return true;
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null || Array.isArray(a) !== Array.isArray(b)) {
    return false;
  }
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => Object.hasOwn(b, k) && sameValue(Reflect.get(a, k), Reflect.get(b, k)));
}

/** A cue's key for the gate: a panel cue with its panel, a puzzle cue without its index. */
const gateKey = (c: Cue): string => (c.kind === 'ui-state' && c.panel !== null ? `ui-state:${c.name}@${c.panel}` : keyOf(c));
/** The frame's load hold is owed while its chunks load or a Retry reloads them (round 11), read on the raw frame. */
const loadingFrame = (f: PuzzleFrameView | null): boolean => f !== null && ((f.ui === null && !f.loadFailed) || f.retrying);
/** The open holds of `panel`: the `waiting` the bus carried for it minus its `waited`. */
const holdsOf = (r: Rig, panel: 'puzzle' | 'hints'): number =>
  r.cues.reduce((n, e) => (e.cue.kind === 'ui-state' && e.cue.panel === panel ? n + (e.cue.name === 'waiting' ? 1 : e.cue.name === 'waited' ? -1 : 0) : n), 0);

type GateStep = readonly [name: string, run: () => unknown];
/** What the gate saw: its problems, every field that moved, and the fields of the views it met (the non-vacuity). */
type GateLog = { readonly problems: string[]; readonly moved: Set<string>; readonly fields: Set<string>; steps: number };

/**
 * The state gate: each step (one host callback, one answered fixture request or chunk, one clock tick, then a microtask
 * flush) is compared on the shown view before and after it. A moved field needs one of its covering keys in the step;
 * a silent field may not move; a frame cue may not play while its frame is unshown (the load hold aside); after the
 * step, the open holds per panel equal the views' waits.
 */
async function gate(r: Rig, log: GateLog, steps: readonly GateStep[]): Promise<void> {
  const shown = (): PuzzleFrameView | null => (shownIn({ frame: r.puzzle.frame, host: r.puzzle.host, ladder: r.puzzle.ladder }) ? r.puzzle.frame : null);
  const firstOf = new Map<number, PuzzleFrameView>();
  for (const [name, run] of steps) {
    const b = shown();
    const bl = r.puzzle.ladder;
    const mark = r.cues.length;
    await run();
    await settle();
    log.steps += 1;
    const a = shown();
    const al = r.puzzle.ladder;
    const step = r.cues.slice(mark);
    const keys = new Set(step.map((e) => gateKey(e.cue)));
    const need = (what: string, cover: readonly string[]): void => {
      if (!cover.some((k) => keys.has(k))) {
        log.problems.push(`${what}: none of ${cover.join(' ')} at ${name}`);
      }
    };
    for (const f of [r.puzzle.frame, al]) {
      for (const k of Object.keys(f ?? {})) {
        log.fields.add(`${f === al ? 'ladder' : 'frame'}.${k}`);
      }
    }
    // The frame: its appearance, its end, then each field of the same frame.
    if (a !== null && (b === null || b.id !== a.id)) {
      need('frame', ['ui-state:panel-open@puzzle']);
    }
    if (b !== null && (a === null || a.id !== b.id)) {
      need('frame', ['puzzle:closed', 'puzzle:solved', 'puzzle:failed']);
    }
    const frameFields = Object.keys(FRAME_FIELD_CUES) as (keyof PuzzleFrameView)[];
    if (a !== null && b !== null && a.id === b.id) {
      for (const f of frameFields) {
        const c = FRAME_FIELD_CUES[f];
        if ('keys' in c && !sameValue(b[f], a[f])) {
          log.moved.add(`frame.${f}`);
          need(`frame ${f}`, c.keys(a[f]));
        }
      }
    }
    if (a !== null) {
      const first = firstOf.get(a.id) ?? a;
      firstOf.set(a.id, first);
      for (const f of frameFields) {
        if ('silent' in FRAME_FIELD_CUES[f] && !sameValue(first[f], a[f])) {
          log.problems.push(`silent field ${f} moved at ${name}`);
        }
      }
    }
    // The ladder: its sheet's open and close, then each field.
    if (bl === null && al !== null) {
      need('ladder', ['ui-state:panel-open@hints']);
    }
    if (bl !== null && al === null) {
      need('ladder', ['ui-state:panel-close@hints']);
    }
    if (bl !== null && al !== null) {
      for (const f of Object.keys(LADDER_FIELD_CUES) as (keyof HintLadderUiView)[]) {
        const c = LADDER_FIELD_CUES[f];
        if ('keys' in c && !sameValue(bl[f], al[f])) {
          log.moved.add(`ladder.${f}`);
          need(`ladder ${f}`, c.keys(al[f]));
        }
      }
    }
    // A frame cue plays only on a shown frame (round 10), the load hold's edges aside (round 11).
    step.forEach((e, i) => {
      const c = e.cue;
      const v = r.views[mark + i];
      const frameCue = c.kind === 'puzzle' || (c.kind === 'ui-state' && (c.panel === 'puzzle' || c.panel === 'hints'));
      const loadHold = c.kind === 'ui-state' && c.panel === 'puzzle' && (c.name === 'waiting' || c.name === 'waited');
      if (frameCue && !loadHold && v !== undefined && !shownIn(v)) {
        log.problems.push(`frame cue while unshown ${gateKey(c)} at ${name}`);
      }
    });
    // The hold balance (round 9, 11): one `puzzle` hold iff the frame loads, one `hints` hold iff the ladder waits.
    for (const [panel, owed] of [
      ['puzzle', loadingFrame(r.puzzle.frame)],
      ['hints', r.puzzle.ladder?.busy === true],
    ] as const) {
      const open = holdsOf(r, panel);
      if (open < Number(owed)) {
        log.problems.push(`hold ${panel} missing after ${name}`);
      }
      if (open > Number(owed)) {
        log.problems.push(`hold ${panel} open after ${name}`);
      }
    }
  }
}

/** The fixture's requests held: each step answers the oldest attempt or status. */
function heldRequests(r: Rig): { attempt: (v: Result<AttemptResponse, ApiError>) => void; status: (v: Result<PuzzleStatus, ApiError>) => void } {
  const attempts: Array<(v: Result<AttemptResponse, ApiError>) => void> = [];
  const statuses: Array<(v: Result<PuzzleStatus, ApiError>) => void> = [];
  r.host.api.postAttempt = () => new Promise((resolve) => attempts.push(resolve));
  r.host.api.getPuzzle = () => new Promise((resolve) => statuses.push(resolve));
  return { attempt: (v) => attempts.shift()?.(v), status: (v) => statuses.shift()?.(v) };
}

/** A hint port whose uses are held: each step answers the oldest. */
function heldPort(balance: number) {
  const state = { balance };
  const uses: Array<(v: Result<{ text: string; balance: number }, HintPortError>) => void> = [];
  const port: HintPort = {
    balance: () => state.balance,
    tierCost: () => 1,
    use: () => new Promise((resolve) => uses.push(resolve)),
    getMore: () => {},
  };
  return { port, state, use: (v: Result<{ text: string; balance: number }, HintPortError>): void => uses.shift()?.(v) };
}

/** The cue world with an unlimited three-tier drawer (the hall's chest), a Give-up cabinet and a three-try order. */
const gateWorld = (): WorldPublic =>
  cueWorld({
    drawer: { ...code('drawer_close', null), hints: [txt('a'), txt('b'), txt('c')] },
    cabinet: { ...code(null, null), giveUp: true },
    pieces: orderPuzzle(3),
  });
const STATUS_OK: Result<PuzzleStatus, ApiError> = { ok: true, value: LADDER_STATUS };
const NETWORK: Result<never, ApiError> = { ok: false, error: { kind: 'network', detail: 'offline' } };
const spent = (balance: number): Result<{ text: string; balance: number }, HintPortError> => ({ ok: true, value: { text: 'spent', balance } });
const usedFailed = (kind: HintPortError['kind']): Result<{ text: string; balance: number }, HintPortError> => ({ ok: false, error: { kind } });

test('yields: every visible change of the puzzle view plays a cue', async () => {
  const log: GateLog = { problems: [], moved: new Set(), fields: new Set(), steps: 0 };
  const linear = (r: Rig, puzzle: PuzzleLocalId) => (): void => void r.yields.onYield({ kind: 'puzzle', puzzle, then: AFTER });

  // An exploration frame in a hall where the engine already opened one (the host in), its type chunk pending: the
  // attempts' every answer, the countdown, the hint ladder's every answer, the wallet, Back over a request, the X8 close.
  {
    const ui = chunkQueue<Result<Component<PuzzleUiProps>, ChunkError>>();
    const w = heldPort(5);
    const r = rig({ world: gateWorld(), loaders: { puzzleUi: ui.loader }, hints: w.port });
    const q = heldRequests(r);
    await inHall(r);
    r.puzzle.host = HOST;
    const tier3 = (): void => r.yields.host.onusehint(3);
    await gate(r, log, [
      ['open (explore)', () => r.yields.layer.ontap(key('hall.chest'))],
      ['the type chunk', () => ui.land({ ok: true, value: TYPE_UI })],
      ['a dial change', () => r.yields.host.onchange([1, 0, 0, 0])],
      ['Try', () => r.yields.host.ontry()],
      ['answered wrong', () => q.attempt(WRONG)],
      ['Try', () => r.yields.host.ontry()],
      ['answered network', () => q.attempt(NETWORK)],
      ['Try', () => r.yields.host.ontry()],
      ['answered not-entitled', () => q.attempt(httpError(403))],
      ['Try', () => r.yields.host.ontry()],
      ['answered rate-limited', () => q.attempt(httpError(429, 2))],
      ['a countdown tick', () => r.clock.advance(1000)],
      ['the last countdown tick', () => r.clock.advance(1000)],
      ['Try', () => r.yields.host.ontry()],
      ['answered closed', () => q.attempt({ ok: false, error: { kind: 'aborted' } })],
      ['an answer of the wrong shape', () => r.yields.host.onchange([1])],
      ['Try answered invalid', () => r.yields.host.ontry()],
      ['the dials again', () => r.yields.host.onchange([1, 0, 0, 0])],
      ['Hint', () => r.yields.host.onhint()],
      ['the status answered', () => q.status(STATUS_OK)],
      ['a re-read of tier 1', () => r.yields.host.onusehint(1)],
      ['a use of tier 2', () => r.yields.host.onusehint(2)],
      ['a second use while it runs (busy)', () => r.yields.host.onusehint(2)],
      ['the use answered', () => w.use(spent(4))],
      ['a use of tier 3', tier3],
      ['the use failed', () => w.use(usedFailed('network'))],
      ['a re-read of an unlocked tier over the failed ladder', () => r.yields.host.onusehint(1)],
      ['a use of tier 3 again', tier3],
      ['the use answered insufficient', () => w.use(usedFailed('insufficient'))],
      ['a use of tier 3 again', tier3],
      // `unavailable` re-reads the status before it answers: the use's answer, then the status's.
      [
        'the use answered unavailable',
        async () => {
          w.use(usedFailed('unavailable'));
          await settle();
          q.status(STATUS_OK);
        },
      ],
      ['the wallet opens over the ladder', () => r.screens.push({ kind: 'wallet' })],
      ['the wallet closes with a new balance', () => ((w.state.balance = 9), r.screens.back())],
      ['a use of tier 3 again', tier3],
      ['Back with the use in flight', () => r.screens.back()],
      ['its late answer', () => w.use(spent(8))],
      ['Hint again', () => r.yields.host.onhint()],
      ['the status failed', () => q.status(NETWORK)],
      ['Hint again over the failed ladder', () => r.yields.host.onhint()],
      ['its status answered', () => q.status(STATUS_OK)],
      ['Back closes the sheet', () => r.screens.back()],
      ['an X8 Back closes the explore frame', () => r.screens.back()],
    ]);
    r.yields.dispose();
  }

  // A type chunk failed, Retry failed, Retry loaded; and Back during a Retry.
  for (const end of ['loaded', 'Back'] as const) {
    const ui = chunkQueue<Result<Component<PuzzleUiProps>, ChunkError>>();
    const r = rig({ world: gateWorld(), loaders: { puzzleUi: ui.loader } });
    await inHall(r);
    r.puzzle.host = HOST;
    await gate(r, log, [
      ['open (explore)', () => r.yields.layer.ontap(key('hall.chest'))],
      ['the type chunk failed', () => ui.land(CHUNK_OFFLINE)],
      ['Retry', () => r.yields.host.onretry()],
      ...(end === 'loaded'
        ? ([
            ['Retry failed', () => ui.land(CHUNK_OFFLINE)],
            ['Retry again', () => r.yields.host.onretry()],
            ['Retry loaded', () => ui.land({ ok: true, value: TYPE_UI })],
          ] as const)
        : ([
            ['Back during the Retry', () => r.screens.back()],
            ['the late reload', () => ui.land({ ok: true, value: TYPE_UI })],
          ] as const)),
    ]);
    r.yields.dispose();
  }

  // Linear frames (the host in): Give up; an order run to its last wrong try; a restore's drop with no outcome; a chunk
  // result over a frame waiting for a settling answer (per-player's values wait, set through the store).
  {
    const ui = chunkQueue<Result<Component<PuzzleUiProps>, ChunkError>>();
    const r = rig({ world: gateWorld(), loaders: { puzzleUi: ui.loader } });
    const q = heldRequests(r);
    r.puzzle.host = HOST;
    const chunk = (): void => ui.land({ ok: true, value: TYPE_UI });
    await gate(r, log, [
      ['a linear frame opened with its type chunk pending', linear(r, CABINET)],
      ['its chunk', chunk],
      ['Give up (yes)', () => r.yields.host.ongiveup()],
      ['an order frame', linear(r, PIECES)],
      ['its chunk', chunk],
      ['Try', () => r.yields.host.ontry()],
      ['answered wrong', () => q.attempt(WRONG)],
      ['Try', () => r.yields.host.ontry()],
      ['answered wrong', () => q.attempt(WRONG)],
      ['Try', () => r.yields.host.ontry()],
      ['answered with the last try wrong', () => q.attempt(WRONG)],
      ['a linear frame', linear(r, CABINET)],
      ['its chunk', chunk],
      ['a restore drops it with no outcome', () => r.yields.restore(EMPTY_WORLD_STATE, null, null)],
      ['a linear frame', linear(r, CABINET)],
    ]);
    const f = r.puzzle.frame;
    if (f === null) {
      throw new Error('expected the open frame');
    }
    r.puzzle.frame = { ...f, busy: true, line: 'checking' };
    await gate(r, log, [['a chunk result over a waiting frame', chunk]]);
    r.yields.dispose();
  }

  // A linear frame dropped during a Retry.
  {
    const ui = chunkQueue<Result<Component<PuzzleUiProps>, ChunkError>>();
    const r = rig({ world: gateWorld(), loaders: { puzzleUi: ui.loader } });
    r.puzzle.host = HOST;
    await gate(r, log, [
      ['a linear frame', linear(r, CABINET)],
      ['its chunk failed', () => ui.land(CHUNK_OFFLINE)],
      ['Retry', () => r.yields.host.onretry()],
      ['a restore during the Retry', () => r.yields.restore(EMPTY_WORLD_STATE, null, null)],
      ['the late reload', () => ui.land({ ok: true, value: TYPE_UI })],
    ]);
    r.yields.dispose();
  }

  // An X8 Back during an attempt in flight, then that attempt answered correct: the frame went with the Back.
  {
    const r = rig({ world: gateWorld() });
    const q = heldRequests(r);
    await inHall(r);
    r.puzzle.host = HOST;
    await gate(r, log, [
      ['open (explore), its chunks in', () => r.yields.layer.ontap(key('hall.chest'))],
      ['Try', () => r.yields.host.ontry()],
      ['an X8 Back during the attempt', () => r.screens.back()],
      ['the attempt answered correct', () => q.attempt(RIGHT)],
    ]);
    r.yields.dispose();
  }

  // The engine's first open, its host chunk pending (a fresh view): the chunk; an X8 Back, a restore and a chapter
  // change before it lands.
  for (const leave of ['the host chunk', 'an X8 Back before the host lands', 'a restore before the host lands', 'a chapter change before the host lands'] as const) {
    const host = chunkQueue<Result<Component<PuzzleHostProps>, ChunkError>>();
    const r = rig({ world: gateWorld(), loaders: { puzzleHost: host.loader } });
    const land = (): void => host.land({ ok: true, value: HOST });
    const explore = leave === 'an X8 Back before the host lands';
    if (explore) {
      await inHall(r);
    }
    const steps: GateStep[] = [
      ['the first open with the host chunk pending', explore ? () => r.yields.layer.ontap(key('hall.chest')) : linear(r, CABINET)],
    ];
    if (leave === 'the host chunk') {
      steps.push([leave, land]);
    } else {
      const go = explore ? () => r.screens.back() : leave === 'a restore before the host lands' ? () => r.yields.restore(EMPTY_WORLD_STATE, null, null) : () => r.yields.chapterChanged();
      steps.push([leave, go], ['the late host chunk', land]);
    }
    await gate(r, log, steps);
    r.yields.dispose();
  }

  // A Try answered correct while the ladder is open with its status in flight: the end cue, the ladder's waited and the
  // sheet's close all play on the shown frame, and both holds end.
  {
    const r = rig({ world: gateWorld(), hints: heldPort(5).port });
    const q = heldRequests(r);
    r.puzzle.host = HOST;
    await gate(r, log, [
      ['a linear frame, its chunks in', linear(r, CABINET)],
      ['Hint', () => r.yields.host.onhint()],
      ['Try', () => r.yields.host.ontry()],
      ['the attempt answered correct while the status runs', () => q.attempt(RIGHT)],
    ]);
    r.yields.dispose();
  }

  expect(log.problems).toEqual([]);
  // Non-vacuous: the views the gate met hold exactly the tables' fields, and every field with covering keys moved.
  const frameFields = Object.keys(FRAME_FIELD_CUES) as (keyof PuzzleFrameView)[];
  const ladderFields = Object.keys(LADDER_FIELD_CUES) as (keyof HintLadderUiView)[];
  const tables = [...frameFields.map((f) => `frame.${f}`), ...ladderFields.map((f) => `ladder.${f}`)].sort();
  expect([...log.fields].sort()).toEqual(tables);
  const covered = [
    ...frameFields.filter((f) => 'keys' in FRAME_FIELD_CUES[f]).map((f) => `frame.${f}`),
    ...ladderFields.filter((f) => 'keys' in LADDER_FIELD_CUES[f]).map((f) => `ladder.${f}`),
  ].sort();
  expect([...log.moved].sort()).toEqual(covered);
  expect(log.steps).toBe(93);
});

test('yields: a screens change closes a panel before it opens the next', async () => {
  // GM3u F1: a view that swaps the inventory for the lock closes the inventory first, then opens the lock.
  const r = rig({ world: cueWorld() });
  await inHall(r);
  const root = r.vm.screens.root;
  r.yields.screensChanged({ root, overlays: [{ kind: 'inventory' }], backVisible: true });
  const mark = r.cues.length;
  r.yields.screensChanged({ root, overlays: [{ kind: 'lock' }], backVisible: true });
  expect(panelCues(r, mark)).toEqual(['panel-close:inventory', 'panel-open:lock']);
  r.yields.dispose();
});

test('yields: the reveal emits its cue', async () => {
  // No section entered: no controller, so the reveal shows nothing and plays nothing.
  const none = rig({ world: cueWorld() });
  const before = none.cues.length;
  none.yields.layer.onreveal();
  await settle();
  expect(none.cues.slice(before).map((e) => keyOf(e.cue))).toEqual([]);
  none.yields.dispose();
  // In a room: one `ui-state:reveal`, no box (the stage plays it over the stage).
  const r = rig({ world: cueWorld() });
  await inHall(r);
  const mark = r.cues.length;
  r.yields.layer.onreveal();
  await settle();
  const played = r.cues.slice(mark);
  expect(played.map((e) => keyOf(e.cue))).toEqual(['ui-state:reveal']);
  expect(played.map((e) => e.box)).toEqual([null]);
  r.yields.dispose();
});

test("yields: a frame control's point reaches the bus in stage-host px", async () => {
  // The frame root emits points in its own px (`cues/root.ts`); the stage plays in the stage host's (§8.3, D-P).
  const r = rig({ world: puzzleWorld() });
  await r.yields.onYield({ kind: 'puzzle', puzzle: CABINET, then: AFTER });
  const rect = (left: number, top: number): DOMRect => ({ left, top, right: left + 360, bottom: top + 584, width: 360, height: 584, x: left, y: top }) as DOMRect;
  const root = { getBoundingClientRect: () => rect(4, 56) };
  const el = { closest: (sel: string) => (sel === '[data-cue-root]' ? root : null) } as unknown as HTMLElement;
  const tapAt = (point: { x: number; y: number } | null): CueEvent => ({
    cue: { kind: 'ui', control: 'puzzle-try', item: null, index: null },
    box: null,
    point,
    diff: [],
    el,
  });
  const mark = r.cues.length;
  r.yields.host.oncue?.(tapAt({ x: 10, y: 20 }));
  r.yields.host.oncue?.(tapAt(null));
  const played = r.cues.slice(mark);
  expect(played.map((e) => [keyOf(e.cue), e.point])).toEqual([
    ['ui:puzzle-try', { x: 14, y: 76 }],
    ['ui:puzzle-try', null],
  ]);
  // A host off the page's origin: the offset is the two rects' difference.
  r.host.stageHost = () => ({ getBoundingClientRect: () => rect(2, 6) }) as unknown as HTMLElement;
  const moved = r.cues.length;
  r.yields.host.oncue?.(tapAt({ x: 10, y: 20 }));
  expect(r.cues.slice(moved).map((e) => e.point)).toEqual([{ x: 12, y: 70 }]);
  r.yields.dispose();
});

test("yields: an explore root control's point reaches the bus in stage-host px", async () => {
  // Q69: the explore root emits points in its own box (`cues/root.ts`), which its 300 ms entrance (a 0.98 scale about
  // its centre) moves off the host's; the stage plays in the host's px, as for the frame family.
  const r = rig({ world: cueWorld() });
  await inHall(r);
  // The root mid-entrance: offset and scaled from the host's 360 x 640 (its entrance scales 0.98 -> 1).
  const root = { getBoundingClientRect: () => ({ left: 10, top: 20, right: 361, bottom: 644, width: 351, height: 624, x: 10, y: 20 }) as DOMRect };
  const el = { closest: (sel: string) => (sel === '[data-cue-root]' ? root : null) } as unknown as HTMLElement;
  const tapAt = (point: { x: number; y: number } | null): CueEvent => ({
    cue: { kind: 'ui', control: 'bare-art', item: null, index: null },
    box: null,
    point,
    diff: [],
    el,
  });
  const mark = r.cues.length;
  r.explore.oncue?.(tapAt({ x: 30, y: 40 }));
  r.explore.oncue?.(tapAt(null));
  expect(r.cues.slice(mark).map((e) => [keyOf(e.cue), e.point])).toEqual([
    ['ui:bare-art', { x: 40, y: 60 }],
    ['ui:bare-art', null],
  ]);
  // A host off the page's origin: the offset is the two rects' difference.
  r.host.stageHost = () =>
    ({ getBoundingClientRect: () => ({ left: 2, top: 6, right: 362, bottom: 646, width: 360, height: 640, x: 2, y: 6 }) as DOMRect }) as unknown as HTMLElement;
  const moved = r.cues.length;
  r.explore.oncue?.(tapAt({ x: 30, y: 40 }));
  expect(r.cues.slice(moved).map((e) => e.point)).toEqual([{ x: 38, y: 54 }]);
  r.yields.dispose();
  expect(r.explore.oncue).toBeUndefined();
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

/** One case per `WaitRow` (tsc keeps the table and the rows equal). */
const WAIT_CASES: { readonly [R in WaitRow]: WaitCase } = {
  // A visual batch's loads, through `held`: the room, the take and the close-up in and out, each with a late start.
  batch: async (row) => {
    const r = rig({ world: cueWorld(), late: true });
    await inLateHall(r);
    await script(row, r, [
      ['an exit', () => r.yields.layer.ontap(key('hall.to_cellar')), ['+room']],
      ['its start', () => r.release(), ['-room']],
      ['the way back', () => r.yields.layer.ontap(key('cellar.to_hall')), ['+room']],
      ['its start', () => r.release(), ['-room']],
      ['a take', () => r.yields.layer.ontap(key('hall.medal')), []], // its picture leaves, no image loads: no hold
      ['its start', () => r.release(), []],
      ['the close-up in', () => r.yields.layer.ontap(key('hall.chest')), ['+room']],
      ['its start, the frame write and the chunk write', () => r.release(), ['-room', '+puzzle', '-puzzle']],
      ['the close-up out at an X8 Back', () => r.screens.back(), ['+room']],
      ['its start', () => r.release(), ['-room']],
    ]);
    r.yields.dispose();
    // A state change whose new picture loads (engine plan §6.4): its batch holds at the anchor.
    const v = rig({ world: visualWorld(), late: true });
    await inLateHall(v);
    await script(row, v, [
      ['a state change', () => v.yields.layer.ontap(key('hall.switch')), ['+room']],
      ['its start', () => v.release(), ['-room']],
    ]);
    v.yields.dispose();
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
  // A ladder request (the status, a use): `setLadder`'s busy edges, and Back over a request in flight.
  ladder: async (row) => {
    const status = deferred<void>();
    const use = deferred<void>();
    const w = ladderPort(5);
    const r = rig({ status: LADDER_STATUS, statusGate: status.promise, hints: w.port });
    await r.yields.onYield({ kind: 'puzzle', puzzle: DRAWER, then: AFTER });
    await script(row, r, [
      ['Hint', () => r.yields.host.onhint(), ['+hints']],
      ['the status', () => status.resolve(), ['-hints']],
      ['a use', () => ((w.state.gate = use.promise), r.yields.host.onusehint(2)), ['+hints']],
      ['its answer', () => use.resolve(), ['-hints']],
    ]);
    r.yields.dispose();
    const b = rig({ statusGate: new Promise<void>(() => undefined), hints: ladderPort(5).port });
    await b.yields.onYield({ kind: 'puzzle', puzzle: DRAWER, then: AFTER });
    await script(row, b, [
      ['Hint', () => b.yields.host.onhint(), ['+hints']],
      ['Back over the request', () => b.screens.back(), ['-hints']],
    ]);
    b.yields.dispose();
  },
};

test('yields: every wait of the views holds a motion', async () => {
  for (const [row, run] of Object.entries(WAIT_CASES)) {
    await run(row);
  }
});
