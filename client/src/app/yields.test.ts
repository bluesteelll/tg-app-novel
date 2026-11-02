// The yields (PUZZLES-PLAN F6, F7, X8, X12, X14; the L15 cut D4, D13, D18, D20, K47-K54) over a fake GameSession:
// a fixture world the decoder accepts, the real explore controller (a fake ResizeObserver), the real puzzle session
// over a fake API, the real view stores, screens stack and view model, and a stage log of every batch the yields
// apply. The runner is a recorder of `enter`, so the projection each knot is entered with is visible.
import type { Component } from 'svelte';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import type { AttemptResponse } from '../api/generated/api.ts';
import type { ApiError, Clock } from '../api/http.ts';
import type { AudioCommand } from '../audio/manager.ts';
import { createExploreController } from '../explore/controller.ts';
import type { ExploreController } from '../explore/controller.ts';
import { EMPTY_WORLD_STATE } from '../explore/state.ts';
import type { WorldState } from '../explore/state.ts';
import type { PuzzleUiProps } from '../puzzles/registry.ts';
import type { VisualCommand } from '../scene/executor.ts';
import type { StatEvent } from '../stats/reporter.ts';
import { decodeChapterMeta } from '../story/catalog.ts';
import type { AssetEntry, AssetManifest, LoadedChapter, Result } from '../story/catalog.ts';
import type { AssetId, ChapterId, KnotName, PuzzleLocalId, SectionId, StagingSnapshot } from '../story/staging.ts';
import { createExploreView } from '../ui/explore-view.svelte.ts';
import type { ExploreLayerProps } from '../ui/explore-view.svelte.ts';
import { createPuzzleView } from '../ui/puzzle-view.svelte.ts';
import type { PuzzleHostProps } from '../ui/puzzle-view.svelte.ts';
import { createScreens } from '../ui/screens.ts';
import { createViewModel } from '../ui/state.svelte.ts';
import { decodeWorldSource, toPublic } from '../world/decode.ts';
import type { HotspotKey, ItemId, WorldPublic } from '../world/types.ts';
import { createYields } from './yields.ts';
import type { ExploreChunk, LazyChunks, Yields } from './yields.ts';

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

const VARS = ['g_x', 'pz_drawer', 'pz_drawer_hints', 'pz_gate', 'pz_gate_hints', 'it_medal', 'it_key'];

function image(name: string): AssetEntry {
  const ref = (ext: string) => ({ url: `/assets/${name}.${ext}`, bytes: 1000 });
  return { kind: 'image', w: 1080, h: 2048, decodedBytes: 8_847_360, avif: ref('avif'), webp: ref('webp') };
}

function manorChapter(): LoadedChapter {
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
  const ids = ['bg/hall', 'bg/study', 'prop/medal', 'cg/drawer_close'];
  const assets: AssetManifest = { chapterId: 'ch1' as ChapterId, assets: Object.fromEntries(ids.map((id) => [id, image(id)])) as Record<AssetId, AssetEntry> };
  return { id: 'ch1' as ChapterId, story: {}, meta: meta.value, assets, en: null, world: manorWorld() };
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

function rig(o: { create?: ExploreChunk['create']; attempts?: Array<Result<AttemptResponse, ApiError>> } = {}) {
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
  const events: StatEvent[] = [];
  const haptics: string[] = [];
  const holders = new Map<string, Set<string>>();
  let stage: StagingSnapshot = { bg: null, cg: null, chars: [], bgm: null, props: [] };
  const calls = { explore: 0, host: 0, ui: 0, attempts: 0 };
  const answers = [...(o.attempts ?? [])];
  const ch = manorChapter();
  const chunks: LazyChunks = {
    explore: async () => {
      calls.explore += 1;
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
  };
  const yields = createYields({
    vm,
    screens,
    tg: { haptic: { impact: () => {}, selection: () => {}, notify: (t) => haptics.push(`notify:${t}`) } },
    api: {
      getPuzzle: async () => ({ ok: false, error: { kind: 'network', detail: 'none' } }),
      postAttempt: async () => {
        calls.attempts += 1;
        return answers.shift() ?? { ok: true, value: { correct: false, solved: false } };
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
    },
    explore,
    puzzle,
    reporter: { record: (e) => events.push(e) },
    clock,
    chunks,
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
    apply: async (visual: readonly VisualCommand[], audio: readonly AudioCommand[]) => {
      log.push(`apply:${visual.map((c) => c.kind).join(',')}|${audio.map((c) => c.kind).join(',')}`);
      for (const c of visual) {
        if (c.kind === 'bg') {
          stage = { ...stage, bg: c.bg, props: [] };
        } else if (c.kind === 'props') {
          stage = { ...stage, props: [...c.props] };
        } else if (c.kind === 'cg') {
          stage = { ...stage, cg: c.cg };
        }
      }
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
  });
  y = yields;
  const entered: Array<{ knot: string; projection: Readonly<Record<string, unknown>> }> = [];
  return { yields, vm, screens, explore, puzzle, log, events, haptics, holders, calls, entered, stage: () => stage };
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
  const r = rig({ attempts: [{ ok: true, value: { correct: true, solved: true } }] });
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
  const r = rig({ attempts: [{ ok: true, value: { correct: true, solved: true } }] });
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
  r.yields.restore(spent, null);
  await r.yields.onYield({ kind: 'puzzle', puzzle: DRAWER, then: AFTER });
  // D18: no session, no frame, no attempt; the run ends failed and the story goes on with pz_drawer = 2.
  expect([r.puzzle.frame, r.calls.host, r.calls.attempts]).toEqual([null, 0, 0]);
  expect(r.events.map((e) => (e.kind === 'puzzle_ended' ? e.outcome : e.kind))).toEqual(['failed']);
  expect(r.entered).toEqual([{ knot: 'after', projection: expect.objectContaining({ pz_drawer: 2 }) }]);
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
  r.yields.restore(EMPTY_WORLD_STATE, null);
  expect(resetShown(r)).toBe(false);
  r.yields.restore(EMPTY_WORLD_STATE, MANOR);
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
