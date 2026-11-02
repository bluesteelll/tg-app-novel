// The game session (PROTOTYPE-PLAN F2-F5, STORIES-PLAN "Module API", META-PLAN M1) over fakes: inline ink compiled by
// the story tool's compiler and played by the real runner, a fake scene that keeps the asset registry's holders, fake
// audio, saves and reporter, and the real view model, screens stack and settings store. Each test disposes its game,
// so `liveRunners()` deltas are exact.
import type { Component } from 'svelte';
import { expect, test, vi } from 'vitest';

import { compileChapter } from '../../scripts/story/compile.ts';
import { GLOBALS_PATH } from '../../scripts/story/lint.ts';
import type { AttemptResponse, ProductDto, SaveFull, SaveListResponse, SaveSlot, SaveSummary } from '../api/generated/api.ts';
import type { ApiError, Clock } from '../api/http.ts';
import type { AudioCommand, AudioManager } from '../audio/manager.ts';
import { createExploreController } from '../explore/controller.ts';
import { EMPTY_WORLD_STATE } from '../explore/state.ts';
import type { ManualSlot, SaveService, SaveState, SaveWrite } from '../saves/service.ts';
import type { SceneController } from '../scene/controller.ts';
import type { SceneSnapshot, VisualCommand } from '../scene/executor.ts';
import { createSettingsStore } from '../settings/store.ts';
import type { CloudPort, SettingsStore } from '../settings/store.ts';
import type { StatEvent } from '../stats/reporter.ts';
import type { PuzzleUiProps } from '../puzzles/registry.ts';
import type { ChapterLoader } from '../story/chapters.ts';
import { decodeChapterMeta } from '../story/catalog.ts';
import type { AssetEntry, AssetManifest, ChapterCatalog, LoadedChapter, Result, StoryId } from '../story/catalog.ts';
import { liveRunners } from '../story/runner.ts';
import { decodeSave, encodeSave } from '../story/save-codec.ts';
import { EMPTY_SNAPSHOT } from '../story/staging.ts';
import type { AssetId, ChapterId, ProductId, StoryVersion } from '../story/staging.ts';
import type { InvoiceStatus } from '../telegram/index.ts';
import { createExploreView } from '../ui/explore-view.svelte.ts';
import type { ExploreViewStore } from '../ui/explore-view.svelte.ts';
import { createPuzzleView } from '../ui/puzzle-view.svelte.ts';
import type { PuzzleHostProps, PuzzleView } from '../ui/puzzle-view.svelte.ts';
import { createScreens } from '../ui/screens.ts';
import type { Screens } from '../ui/screens.ts';
import { decodeWorldSource, toPublic } from '../world/decode.ts';
import type { HotspotKey, ItemId, WorldPublic } from '../world/types.ts';
import { createViewModel } from '../ui/state.svelte.ts';
import type { ViewModel } from '../ui/state.svelte.ts';
import { newestAuto } from './boot.ts';
import { createGame } from './game.ts';
import type { Entitlements, Game, GameDeps } from './game.ts';
import type { ExploreChunk, LazyChunks } from './yields.ts';

// ---------------------------------------------------------------------------------------------------------------
// Fixtures: chapters

const GLOBALS = 'VAR g_x = 0\n';
const inkCache = new Map<string, unknown>();

/** `<id>`'s compiled story from `main` (after the globals INCLUDE), parsed; memoized by source. */
function inkJson(id: string, main: readonly string[]): unknown {
  const source = `${['INCLUDE ../common/globals.ink', ...main].join('\n')}\n`;
  const key = `${id}\n${source}`;
  const hit = inkCache.get(key);
  if (hit !== undefined) {
    return hit;
  }
  const entry = `${id}/main.ink`;
  const files = new Map([[GLOBALS_PATH, GLOBALS], [entry, source]]);
  const r = compileChapter({ id: id as ChapterId, paid: false, entry }, (k) => files.get(k) ?? null);
  if (r.compiled === null) {
    throw new Error(`fixture does not compile: ${JSON.stringify(r.findings)}`);
  }
  const json: unknown = JSON.parse(r.compiled.json);
  inkCache.set(key, json);
  return json;
}

type KnotSpec = { assets?: readonly string[]; next?: readonly string[]; ending?: boolean };

function image(name: string): AssetEntry {
  const ref = (ext: string) => ({ url: `/assets/${name}.${ext}`, bytes: 1000 });
  return { kind: 'image', w: 1080, h: 2048, decodedBytes: 8_847_360, avif: ref('avif'), webp: ref('webp') };
}

function sound(name: string, role: 'bgm' | 'sfx'): AssetEntry {
  return { kind: 'audio', role, durationMs: 1000, file: { url: `/assets/${name}.m4a`, bytes: 1000 }, codec: 'm4a' };
}

/** A manifest naming `ids`: images for bg / char / cg / prop, audio for bgm / sfx. */
function manifest(id: string, ids: readonly string[]): AssetManifest {
  const assets: Record<string, AssetEntry> = {};
  for (const a of ids) {
    const name = a.replaceAll('/', '_');
    assets[a] = a.startsWith('bgm/') ? sound(name, 'bgm') : a.startsWith('sfx/') ? sound(name, 'sfx') : image(name);
  }
  return { chapterId: id as ChapterId, assets: assets as Record<AssetId, AssetEntry> };
}

/** A loaded chapter over `main`; the first knot of `knots` is `firstKnot`; `endings` maps knots to ending names. */
function chapter(
  id: string,
  main: readonly string[],
  knots: Readonly<Record<string, KnotSpec>>,
  o: { assets?: readonly string[]; endings?: Readonly<Record<string, string>>; version?: string; vars?: readonly string[]; world?: WorldPublic } = {},
): LoadedChapter {
  const names = Object.keys(knots);
  const meta = decodeChapterMeta({
    chapterId: id,
    storyVersion: o.version ?? `${id.slice(2).padStart(2, '0')}11111111111111`,
    firstKnot: names[0],
    globals: ['g_x'],
    vars: o.vars ?? ['g_x'],
    knots: Object.fromEntries(
      names.map((k) => [k, { assets: knots[k]?.assets ?? [], next: knots[k]?.next ?? [], ending: knots[k]?.ending ?? false }]),
    ),
    endings: o.endings ?? {},
  });
  if (!meta.ok) {
    throw new Error(`fixture meta does not decode: ${JSON.stringify(meta.error)}`);
  }
  const used = new Set([...(o.assets ?? []), ...names.flatMap((k) => knots[k]?.assets ?? [])]);
  return { id: id as ChapterId, story: inkJson(id, main), meta: meta.value, assets: manifest(id, [...used]), en: null, world: o.world ?? null };
}

/** manor ch1: a knot with a speaker, a second line, a choice set, then a garden knot that ends the chapter. */
const MANOR_CH1 = [
  '-> arrival',
  '=== arrival ===',
  '# scene: hall',
  '# show: ally neutral at=left',
  '# bgm: calm',
  'ally: Welcome. #id:ch1.arrival.l001',
  'It is late. #id:ch1.arrival.l002',
  '* [Stay. #id:ch1.arrival.c001]',
  '    You stay. #id:ch1.arrival.l003',
  '    -> garden',
  '* [Leave. #id:ch1.arrival.c002]',
  '    You leave. #id:ch1.arrival.l004',
  '    -> garden',
  '=== garden ===',
  '# bg: garden',
  'The garden. #id:ch1.garden.l005',
  '-> END',
];

function manorCh1(): LoadedChapter {
  return chapter('ch1', MANOR_CH1, {
    arrival: { assets: ['bg/hall', 'char/ally/neutral', 'bgm/calm'], next: ['garden'] },
    garden: { assets: ['bg/garden'], ending: true },
  });
}

const MANOR = 'manor' as StoryId;
const TIDE = 'tide' as StoryId;
const CH1 = 'ch1' as ChapterId;
const CH2 = 'ch2' as ChapterId;
const CH3 = 'ch3' as ChapterId;

function catalog(): ChapterCatalog {
  const title = (ru: string) => ({ ru, en: ru });
  return {
    stories: [
      { id: MANOR, chapters: [CH1, CH2], cover: 'cover/manor' as AssetId, title: title('Manor'), teaser: title('The manor') },
      { id: TIDE, chapters: [CH3], cover: 'cover/tide' as AssetId, title: title('Tide'), teaser: title('The tide') },
    ],
    chapters: [
      { id: CH1, paid: false, productId: null, next: CH2, title: title('One') },
      { id: CH2, paid: true, productId: 'chapter:ch2' as ProductId, next: null, title: title('Two') },
      { id: CH3, paid: false, productId: null, next: null, title: title('Three') },
    ],
    cast: { ally: { char: 'ally', name: { ru: 'Элли', en: 'Ally' } } } as ChapterCatalog['cast'],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Fakes

/** Timers the test advances by hand; `now` moves with them. */
class FakeClock implements Clock {
  #now = 1_000_000;
  #next = 1;
  readonly #timers = new Map<number, { at: number; fn: () => void }>();

  now(): number {
    return this.#now;
  }
  get pending(): number {
    return this.#timers.size;
  }
  setTimeout(fn: () => void, ms: number): number {
    const id = this.#next++;
    this.#timers.set(id, { at: this.#now + ms, fn });
    return id;
  }
  clearTimeout(id: number): void {
    this.#timers.delete(id);
  }
  advance(ms: number): void {
    const end = this.#now + ms;
    for (;;) {
      const due = [...this.#timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (due === undefined) {
        break;
      }
      this.#timers.delete(due[0]);
      this.#now = due[1].at;
      due[1].fn();
    }
    this.#now = end;
  }
}

const EMPTY_STAGE: SceneSnapshot = Object.freeze({ bg: null, cg: null, chars: Object.freeze([]), props: Object.freeze([]) });

/** The executor's end-state rule (§7 order), for the holders it keeps: scene, bg, hide, show, cg, props. */
function reduceStage(s: SceneSnapshot, batch: readonly VisualCommand[]): SceneSnapshot {
  let { bg, cg } = s;
  let chars = [...s.chars];
  let props = [...s.props];
  for (const c of batch) {
    switch (c.kind) {
      case 'scene':
        bg = c.bg;
        cg = null;
        chars = [];
        props = [];
        break;
      case 'bg':
        bg = c.bg;
        props = [];
        break;
      case 'hide':
        chars = c.char === 'all' ? [] : chars.filter((x) => x.char !== c.char);
        break;
      case 'show': {
        const at = c.at ?? chars.find((x) => x.char === c.char)?.at ?? 'center';
        chars = [...chars.filter((x) => x.char !== c.char), { char: c.char, expr: c.expr, at }];
        break;
      }
      case 'cg':
        cg = c.cg;
        break;
      case 'props':
        props = [...c.props];
        break;
      case 'wait':
        break;
    }
  }
  return { bg, cg, chars, props };
}

/** `scene:<slot>` holders of a stage, as the executor keeps them. */
function stageHolders(s: SceneSnapshot): Map<string, string> {
  const out = new Map<string, string>();
  if (s.bg !== null) {
    out.set('scene:bg', `bg/${s.bg}`);
  }
  if (s.cg !== null) {
    out.set('scene:cg', `cg/${s.cg}`);
  }
  for (const c of s.chars) {
    out.set(`scene:char:${c.char}`, `char/${c.char}/${c.expr}`);
  }
  for (const p of s.props) {
    out.set(`scene:prop:${p.prop}`, `prop/${p.prop}`);
  }
  return out;
}

type FakeScene = SceneController & {
  /** Holder tag → asset ids, as the registry keeps them (a trailing `:` releases a family). */
  readonly holders: Map<string, Set<string>>;
  readonly calls: string[];
};

function fakeScene(): FakeScene {
  const holders = new Map<string, Set<string>>();
  const calls: string[] = [];
  let stage = EMPTY_STAGE;
  const matches = (tag: string, pattern: string): boolean => (pattern.endsWith(':') ? tag.startsWith(pattern) : tag === pattern);
  const release = (pattern: string, keep?: string): void => {
    for (const tag of [...holders.keys()]) {
      if (matches(tag, pattern) && tag !== keep) {
        holders.delete(tag);
      }
    }
  };
  const restage = (next: SceneSnapshot): void => {
    stage = next;
    release('scene:');
    for (const [tag, id] of stageHolders(next)) {
      holders.set(tag, new Set([id]));
    }
  };
  return {
    holders,
    calls,
    mount: async () => {
      calls.push('mount');
      return { ok: true, value: undefined };
    },
    setChapter(m) {
      calls.push(`setChapter:${m.chapterId}`);
      release('preload:');
      release('next:', `next:${m.chapterId}`);
      release('ensure');
    },
    apply: async (batch) => {
      calls.push(`apply:${batch.map((c) => c.kind).join(',')}`);
      restage(reduceStage(stage, batch));
    },
    complete() {
      calls.push('complete');
    },
    restore: async (s) => {
      calls.push(`restore:${s.bg ?? '-'}`);
      restage({ bg: s.bg, cg: s.cg, chars: [...s.chars], props: [...s.props] });
    },
    snapshot: () => ({ ...stage, chars: [...stage.chars], props: [...stage.props] }),
    preload(tag, ids) {
      calls.push(`preload:${tag}`);
      holders.set(tag, new Set([...(holders.get(tag) ?? []), ...ids]));
    },
    releasePreload(tag) {
      calls.push(`release:${tag}`);
      release(tag);
    },
    ensure: async () => ({ ok: true, value: undefined }),
    onActivated: async () => {
      calls.push('onActivated');
    },
    pause() {
      calls.push('pause');
    },
    resume() {
      calls.push('resume');
    },
    stats: () => ({ liveTextures: holders.size, liveBytes: 0, pendingLoads: 0, activeTimelines: 0, overCap: 0 }),
    debugForceContextLoss() {},
    debugPropRects: () => [],
    destroy() {
      calls.push('destroy');
    },
  };
}

type FakeAudio = AudioManager & { readonly calls: string[]; readonly applied: AudioCommand[][] };

function fakeAudio(): FakeAudio {
  const calls: string[] = [];
  const applied: AudioCommand[][] = [];
  let bgm: AudioManager['currentBgm'] extends () => infer B ? B : never = null;
  return {
    calls,
    applied,
    apply(cmds) {
      applied.push([...cmds]);
      for (const c of cmds) {
        if (c.kind === 'bgm') {
          bgm = c.track === null ? null : { track: c.track, vol: c.vol };
        }
      }
    },
    restore(b) {
      calls.push('restore');
      bgm = b;
    },
    currentBgm: () => bgm,
    setChapter(m) {
      calls.push(`setChapter:${m?.chapterId ?? 'null'}`);
    },
    preload() {},
    setVolumes() {},
    suspend() {
      calls.push('suspend');
    },
    resume: async () => {
      calls.push('resume');
      return 'running';
    },
    onNeedsGesture: () => () => {},
    stats: () => ({ decodedBytes: 0, state: 'running' }),
  };
}

type FakeSaves = SaveService & {
  readonly story: StoryId;
  readonly autosaves: SaveWrite[];
  readonly slots: Map<SaveSlot, SaveFull>;
  readonly resolved: Array<'keep-here' | 'load-theirs'>;
  disposed: number;
  emit(s: SaveState): void;
};

function summary(story: StoryId, slot: SaveSlot, w: SaveWrite, savedAt = 1): SaveSummary {
  return { storyId: story, slot, rev: 1, chapterId: w.chapterId, storyVersion: w.storyVersion, lineId: w.lineId, savedAt, writeId: 'w' };
}

function fakeSaves(story: StoryId): FakeSaves {
  const listeners = new Set<(s: SaveState) => void>();
  let state: SaveState = { kind: 'idle' };
  const slots = new Map<SaveSlot, SaveFull>();
  const self: FakeSaves = {
    story,
    autosaves: [],
    slots,
    resolved: [],
    disposed: 0,
    emit(s) {
      state = s;
      for (const fn of [...listeners]) {
        fn(s);
      }
    },
    start: async () => ({ ok: true, value: undefined }),
    autosave(w) {
      self.autosaves.push(w);
      slots.set('auto', { summary: summary(story, 'auto', w), body: w.body });
    },
    save: async (slot: ManualSlot, w: SaveWrite) => {
      slots.set(slot, { summary: summary(story, slot, w), body: w.body });
      return { ok: true, value: { rev: 1, savedAt: 1 } };
    },
    overwrite: async (slot: ManualSlot, w: SaveWrite) => {
      slots.set(slot, { summary: summary(story, slot, w), body: w.body });
      return { ok: true, value: { rev: 2, savedAt: 2 } };
    },
    resolveConflict(choice) {
      self.resolved.push(choice);
    },
    load: async (slot) => ({ ok: true, value: slots.get(slot) ?? null }),
    flush: async () => 'saved',
    state: () => state,
    onState(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    onActivated() {},
    dispose() {
      self.disposed += 1;
      listeners.clear();
    },
  };
  return self;
}

/** A loader over fixed chapters; a paid chapter not in `owned` answers `not-entitled`, as the server's 403. */
function fakeLoader(chapters: ReadonlyMap<string, LoadedChapter>, owned: () => ReadonlySet<string>): ChapterLoader & { loads: string[] } {
  const loads: string[] = [];
  return {
    loads,
    load: async (ch) => {
      loads.push(ch.id);
      const found = chapters.get(ch.id);
      if (found === undefined) {
        return { ok: false, error: { kind: 'not-found' } };
      }
      if (ch.paid && !owned().has(ch.id)) {
        return { ok: false, error: { kind: 'not-entitled' } };
      }
      return { ok: true, value: found };
    },
    loadEn: async (ch) => ({ ok: true, value: { ...ch, en: {} } }),
    cancel() {},
    dispose() {},
  };
}

/** A CloudStorage that answers at once and records every write. */
function fakeCloud(): CloudPort & { readonly writes: Array<[string, string]> } {
  const items = new Map<string, string>();
  const writes: Array<[string, string]> = [];
  return {
    writes,
    get: async (k) => ({ ok: true, value: items.get(k) ?? null }),
    set: async (k, v) => {
      writes.push([k, v]);
      items.set(k, v);
      return { ok: true, value: undefined };
    },
  };
}

/** No lazy chunk: a test that reaches a yield passes its own. */
const NO_CHUNKS: LazyChunks = {
  explore: async () => ({ ok: false, error: { kind: 'chunk', detail: 'no chunks in this test' } }),
  puzzleHost: async () => ({ ok: false, error: { kind: 'chunk', detail: 'no chunks in this test' } }),
  puzzleUi: async () => ({ ok: false, error: { kind: 'chunk', detail: 'no chunks in this test' } }),
};

type Harness = {
  game: Game;
  vm: ViewModel;
  screens: Screens;
  explore: ExploreViewStore;
  puzzle: PuzzleView;
  clock: FakeClock;
  scene: FakeScene;
  audio: FakeAudio;
  saves: FakeSaves[];
  events: StatEvent[];
  haptics: string[];
  cloud: ReturnType<typeof fakeCloud>;
  settings: SettingsStore;
  loader: ReturnType<typeof fakeLoader>;
  owned: Set<string>;
  /** The purchase calls in order: createInvoice, openInvoice, getOrder, getEntitlements, and the list's refresh. */
  readonly purchases: string[];
  /** How many times the game handed Home back (onExit). */
  exits(): number;
  /** The newest session's saves. */
  save(): FakeSaves;
};

type HarnessOptions = {
  chapters?: readonly LoadedChapter[];
  owned?: readonly string[];
  list?: SaveListResponse;
  /** Slots every new session's saves start with (the server's copy). */
  slots?: ReadonlyMap<SaveSlot, SaveFull>;
  /** openInvoice's answers in order (then 'cancelled'); 'paid' also grants, as the webhook does on the server. */
  invoice?: readonly InvoiceStatus[];
  /** The lazy families; the default imports none (a yield with no chunks is a test bug). */
  chunks?: LazyChunks;
  /** postAttempt's answer; the default is a network error. */
  attempt?: () => Promise<Result<AttemptResponse, ApiError>>;
};

function harness(o: HarnessOptions = {}): Harness {
  const clock = new FakeClock();
  const vm = createViewModel({ timers: clock, lang: 'ru' });
  let gameRef: Game | null = null;
  const screens = createScreens({
    back: { setVisible() {}, onPress: () => () => {} },
    onView: (v) => {
      vm.screens = v;
      gameRef?.screensChanged(v);
    },
  });
  const explore = createExploreView();
  const puzzle = createPuzzleView();
  const scene = fakeScene();
  const audio = fakeAudio();
  const saves: FakeSaves[] = [];
  const events: StatEvent[] = [];
  const haptics: string[] = [];
  const cloud = fakeCloud();
  const settings = createSettingsStore({ cloud });
  const owned = new Set(o.owned ?? []);
  const chapters = new Map((o.chapters ?? [manorCh1()]).map((c) => [c.id as string, c]));
  const loader = fakeLoader(chapters, () => owned);
  const products = (): ProductDto[] =>
    catalog()
      .chapters.filter((c) => c.paid)
      .map((c) => ({ productId: c.productId ?? '', chapterId: c.id, priceStars: 50, owned: owned.has(c.id) }));
  const entitlements: Entitlements = {
    list: products,
    refresh: async () => {
      purchases.push('refresh');
      return { ok: true, value: products() };
    },
  };
  const fail: ApiError = { kind: 'network', detail: 'offline in the unit test' };
  const purchases: string[] = [];
  const answers = [...(o.invoice ?? [])];
  let product: string | null = null;
  let exits = 0;
  const chapterOf = (p: string | null): string | null => catalog().chapters.find((c) => c.productId === p)?.id ?? null;
  const deps: GameDeps = {
    vm,
    screens,
    tg: {
      haptic: {
        impact: (s) => haptics.push(`impact:${s}`),
        selection: () => haptics.push('selection'),
        notify: (t) => haptics.push(`notify:${t}`),
      },
      setClosingConfirmation: () => {},
      openInvoice: async () => {
        purchases.push('openInvoice');
        const status = answers.shift() ?? 'cancelled';
        const ch = chapterOf(product);
        if (status === 'paid' && ch !== null) {
          owned.add(ch);
        }
        return { ok: true, value: status };
      },
    },
    api: {
      listSaves: async () => ({ ok: true, value: { slots: [] } }),
      createInvoice: async (p) => {
        purchases.push(`createInvoice:${p}`);
        product = p;
        return o.invoice === undefined ? { ok: false, error: fail } : { ok: true, value: { orderId: 'o1', invoiceUrl: 'https://t.me/$o1' } };
      },
      getOrder: async (id) => {
        purchases.push(`getOrder:${id}`);
        const ch = chapterOf(product);
        const status = ch !== null && owned.has(ch) ? 'paid' : 'created';
        return { ok: true, value: { orderId: id, productId: product ?? '', status } };
      },
      getEntitlements: async () => {
        purchases.push('getEntitlements');
        return { ok: true, value: { products: products() } };
      },
      getPuzzle: async () => ({ ok: false, error: fail }),
      postAttempt: () => o.attempt?.() ?? Promise.resolve({ ok: false, error: fail }),
    },
    catalog: catalog(),
    entitlements,
    saveList: async () => ({ ok: true, value: o.list ?? { slots: [] } }),
    saves: (story) => {
      const s = fakeSaves(story);
      for (const [slot, full] of o.slots ?? []) {
        s.slots.set(slot, full);
      }
      saves.push(s);
      return s;
    },
    settings,
    reporter: { record: (e) => events.push(e), flush: () => {} },
    clock,
    scene,
    audio: () => audio,
    unlock: () => {},
    loaders: { current: loader, next: loader, en: loader },
    fetchAsset: async () => ({ ok: false, error: { kind: 'network', detail: 'no assets in the unit test' } }),
    dpr: () => 2,
    accountLang: 'ru',
    onExit: () => {
      exits += 1;
    },
    explore,
    puzzle,
    chunks: o.chunks ?? NO_CHUNKS,
  };
  const game = createGame(deps);
  gameRef = game;
  // A stand-in: the fake scene never reads its host, and the explore controller reads only its two sizes.
  game.attachStage({ clientWidth: 360, clientHeight: 640 } as unknown as HTMLElement);
  return {
    game,
    vm,
    screens,
    explore,
    puzzle,
    clock,
    scene,
    audio,
    saves,
    events,
    haptics,
    cloud,
    settings,
    loader,
    owned,
    purchases,
    exits: () => exits,
    save: () => {
      const s = saves.at(-1);
      if (s === undefined) {
        throw new Error('invariant: a session was started');
      }
      return s;
    },
  };
}

/** The shown line's id, or null. */
const lineOf = (vm: ViewModel): string | null => vm.line?.lineId ?? null;

/** Lets the promise callbacks queued so far run (the fakes answer in microtasks). */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    await Promise.resolve();
  }
}

async function startManor(h: Harness): Promise<void> {
  const r = await h.game.start({ kind: 'new', story: MANOR, chapter: CH1 });
  expect(r).toEqual({ ok: true, value: undefined });
}

// ---------------------------------------------------------------------------------------------------------------
// C2: the session core

test('game_holds_one_runner', async () => {
  const base = liveRunners();
  const h = harness();
  await startManor(h);
  expect(lineOf(h.vm)).toBe('ch1.arrival.l001');
  expect(liveRunners() - base).toBe(1);
  await h.game.advance();
  expect(lineOf(h.vm)).toBe('ch1.arrival.l002');
  // A manual slot holding the knot-entry autosave (at l001), then a load of it: the old runner is disposed.
  const auto = h.save().slots.get('auto');
  expect(auto).toBeDefined();
  if (auto !== undefined) {
    h.save().slots.set('s1', { ...auto, summary: { ...auto.summary, slot: 's1' } });
  }
  await h.game.load('s1');
  expect(lineOf(h.vm)).toBe('ch1.arrival.l001');
  expect(liveRunners() - base).toBe(1);
  h.game.dispose();
  expect(liveRunners() - base).toBe(0);
});

test('game: a choice records its option line id', async () => {
  const h = harness();
  await startManor(h);
  await h.game.advance();
  await h.game.advance();
  expect(h.vm.choices?.options.map((c) => c.lineId)).toEqual(['ch1.arrival.c001', 'ch1.arrival.c002']);
  await h.game.choose(0);
  expect(h.events.filter((e) => e.kind === 'choice_made')).toEqual([
    { kind: 'choice_made', chapterId: CH1, storyVersion: '0111111111111111' as StoryVersion, option: 'ch1.arrival.c001' },
  ]);
  expect(h.haptics).toEqual(['impact:light']);
  expect(lineOf(h.vm)).toBe('ch1.arrival.l003');
  expect(h.vm.choices).toBeNull();
  h.game.dispose();
});

test('game: start rejects a chapter outside the story', async () => {
  const base = liveRunners();
  const h = harness();
  const r = await h.game.start({ kind: 'new', story: MANOR, chapter: CH3 });
  expect(r).toEqual({ ok: false, error: { kind: 'chapter-outside-story', story: MANOR, chapter: CH3 } });
  expect([h.saves.length, h.loader.loads, h.vm.screens.root.kind, liveRunners() - base]).toEqual([0, [], 'home', 0]);
  h.game.dispose();
});

test('game: continue picks the newest auto across stories', () => {
  const at = (story: string, slot: SaveSlot, savedAt: number, rev: number): SaveSummary => ({
    storyId: story as StoryId,
    slot,
    rev,
    chapterId: 'ch1',
    storyVersion: '0111111111111111',
    lineId: null,
    savedAt,
    writeId: `${story}-${slot}`,
  });
  const slots = [
    at('manor', 'auto', 100, 7),
    at('manor', 's1', 900, 1), // a manual slot is never Continue
    at('tide', 'auto', 200, 1),
    at('gone', 'auto', 999, 1), // a story the catalog no longer lists is ignored
  ];
  const c = catalog();
  for (const list of [slots, [...slots].reverse()]) {
    expect(newestAuto({ slots: list }, c)?.story.id).toBe('tide');
  }
  // The same savedAt: the higher rev, then the story id, whatever the list order.
  const tie = [at('tide', 'auto', 200, 1), at('manor', 'auto', 200, 2)];
  for (const list of [tie, [...tie].reverse()]) {
    expect(newestAuto({ slots: list }, c)?.story.id).toBe('manor');
  }
  const even = [at('tide', 'auto', 200, 1), at('manor', 'auto', 200, 1)];
  for (const list of [even, [...even].reverse()]) {
    expect(newestAuto({ slots: list }, c)?.story.id).toBe('manor');
  }
  expect(newestAuto({ slots: [at('gone', 'auto', 1, 1)] }, c)).toBeNull();
});

// ---------------------------------------------------------------------------------------------------------------
// W1: the autosave conflict prompt (PP F3 step 4)

const THEIRS: SaveSummary = {
  storyId: MANOR,
  slot: 'auto',
  rev: 9,
  chapterId: 'ch1',
  storyVersion: '0111111111111111',
  lineId: 'ch1.arrival.l001',
  savedAt: 5,
  writeId: 'another-device',
};

/** The conflict prompt in the toasts, as the player sees it: the message and its two labels. */
function conflictPrompt(vm: ViewModel): { message: string; labels: string[] } | null {
  const p = vm.toasts.find((e) => e.key === 'save_conflict');
  return p?.kind === 'prompt' ? { message: p.message, labels: p.actions.map((a) => a.label) } : null;
}

test('game: a foreign autosave conflict shows the load or keep prompt', async () => {
  const h = harness();
  await startManor(h);
  expect(conflictPrompt(h.vm)).toBeNull();
  h.save().emit({ kind: 'paused', current: THEIRS });
  expect(conflictPrompt(h.vm)).toEqual({
    message: 'Прогресс сохранён на другом устройстве',
    labels: ['Загрузить его', 'Играть здесь'],
  });
  // A retry or a failure shows nothing (F3 step 3); the lane leaving `paused` takes the prompt away.
  h.save().emit({ kind: 'retrying', attempt: 1, inMs: 1000 });
  expect(conflictPrompt(h.vm)).toBeNull();
  h.save().emit({ kind: 'failed', error: { kind: 'network', detail: 'offline' } });
  expect(conflictPrompt(h.vm)).toBeNull();
  h.game.dispose();
});

test('game: each conflict action resolves the conflict with its choice', async () => {
  const h = harness();
  await startManor(h);
  await h.game.advance();
  await h.game.advance();
  expect(h.vm.choices).not.toBeNull();
  const actions = (): Array<() => void> => {
    const p = h.vm.toasts.find((e) => e.key === 'save_conflict');
    return p?.kind === 'prompt' ? p.actions.map((a) => a.run) : [];
  };
  // Keep playing here: the service re-PUTs over theirs; the story stays where it is.
  h.save().emit({ kind: 'paused', current: THEIRS });
  actions()[1]?.();
  actions()[1]?.(); // a second tap on a gone prompt changes nothing
  expect(h.save().resolved).toEqual(['keep-here']);
  expect(conflictPrompt(h.vm)).toBeNull();
  // Load it: the service drops our queue, and the other device's autosave is resumed.
  const first = h.save().autosaves[0];
  expect(first).toBeDefined();
  if (first !== undefined) {
    h.save().slots.set('auto', { summary: THEIRS, body: first.body });
  }
  h.save().emit({ kind: 'paused', current: THEIRS });
  actions()[0]?.();
  await settle();
  expect(h.save().resolved).toEqual(['keep-here', 'load-theirs']);
  expect(lineOf(h.vm)).toBe('ch1.arrival.l001');
  expect(h.vm.choices).toBeNull();
  h.game.dispose();
});

// ---------------------------------------------------------------------------------------------------------------
// W2 (a): the read-set reaches CloudStorage (PP K13, F4 step 1)

const readWrites = (h: Harness): string[] => h.cloud.writes.map(([k]) => k).filter((k) => k.startsWith('read_'));

test('game: a chapter start and a resume load the read-set so flush writes it', async () => {
  const h = harness();
  await startManor(h);
  await settle();
  await h.settings.flush();
  expect(readWrites(h)).toEqual(['read_ch1']);
  // A later session resumes the autosave: its chapter's read-set is loaded before the first mark, too.
  const auto = h.save().slots.get('auto');
  h.game.dispose();
  expect(auto).toBeDefined();
  if (auto === undefined) {
    return;
  }
  const again = harness({ slots: new Map([['auto', auto]]) });
  expect((await again.game.start({ kind: 'slot', story: MANOR, slot: 'auto' })).ok).toBe(true);
  await settle();
  await again.settings.flush();
  expect(readWrites(again)).toEqual(['read_ch1']);
  again.game.dispose();
});

test('game: deactivated suspends audio and the auto timer', async () => {
  const h = harness();
  await startManor(h);
  h.game.setMode('auto');
  h.game.lineShown();
  h.game.onLifecycle('deactivated');
  expect(h.audio.calls).toContain('suspend');
  expect(h.scene.calls).toContain('pause');
  expect(h.vm.paused).toBe(true);
  h.clock.advance(60_000);
  await settle();
  expect(lineOf(h.vm)).toBe('ch1.arrival.l001');
  h.game.onLifecycle('activated');
  expect(h.audio.calls).toContain('resume');
  expect(h.scene.calls).toContain('resume');
  expect(h.vm.paused).toBe(false);
  h.clock.advance(60_000);
  await settle();
  expect(lineOf(h.vm)).toBe('ch1.arrival.l002');
  h.game.dispose();
});

// ---------------------------------------------------------------------------------------------------------------
// C3: chapter change, the next-chapter preload, endings and the chapter reports (PP F2 steps 1-5, F4, F5; SP F4′)

/** manor ch2 (paid): one knot whose batch is a background only, so a character left from ch1 would survive it. */
function manorCh2(): LoadedChapter {
  return chapter(
    'ch2',
    ['-> study', '=== study ===', '# bg: study', 'Two begins. #id:ch2.study.l001', 'Two ends. #id:ch2.study.l002', '-> END'],
    { study: { assets: ['bg/study'], ending: true } },
  );
}

/** ch1 whose first knot `a` ends (a choice diverts to END) and leads to `b`, which does not end, then to `c`, which does. */
function branchCh1(): LoadedChapter {
  return chapter(
    'ch1',
    [
      '-> a',
      '=== a ===',
      '# scene: hall',
      'A line. #id:ch1.a.l001',
      '* [To b. #id:ch1.a.c001]',
      '    -> b',
      '* [End. #id:ch1.a.c002]',
      '    -> END',
      '=== b ===',
      'B line. #id:ch1.b.l002',
      '-> c',
      '=== c ===',
      '# bg: garden',
      'C line. #id:ch1.c.l003',
      '-> END',
    ],
    {
      a: { assets: ['bg/hall'], next: ['b'], ending: true },
      b: { next: ['c'] },
      c: { assets: ['bg/garden'], ending: true },
    },
  );
}

/** tide ch3 (free, the last of its chain): Trust leads to `dawn` (a plain END), Doubt to `drowned` (a declared ending). */
function tideCh3(): LoadedChapter {
  return chapter(
    'ch3',
    [
      '-> shore',
      '=== shore ===',
      '# scene: beach',
      'The shore. #id:ch3.shore.l001',
      '* [Trust. #id:ch3.shore.c001]',
      '    -> dawn',
      '* [Doubt. #id:ch3.shore.c002]',
      '    -> drowned',
      '=== dawn ===',
      'Dawn. #id:ch3.dawn.l002',
      '-> END',
      '=== drowned ===',
      'Cold water. #id:ch3.drowned.l003',
      '-> END',
    ],
    { shore: { assets: ['bg/beach'], next: ['dawn', 'drowned'] }, dawn: { ending: true }, drowned: { ending: true } },
    { endings: { drowned: 'drowned' } },
  );
}

const V_CH1 = '0111111111111111' as StoryVersion;
const V_CH2 = '0211111111111111' as StoryVersion;
const V_CH3 = '0311111111111111' as StoryVersion;

/** The chapter and ending reports, in order. */
const reports = (h: Harness): StatEvent[] => h.events.filter((e) => e.kind !== 'choice_made');

/** Every asset id the fake registry holds, as `holder=id`. */
const held = (h: Harness): string[] => [...h.scene.holders].flatMap(([tag, ids]) => [...ids].map((id) => `${tag}=${id}`)).sort();

/** manor ch1 from its start to the garden knot's line (the ending knot), through the first option. */
async function playManorCh1(h: Harness): Promise<void> {
  await startManor(h);
  await h.game.advance(); // l002
  await h.game.advance(); // the choice set
  await h.game.choose(0); // l003
  await h.game.advance(); // l005, entering garden
  await settle(); // F5's load of the next chapter
}

test('chapter_change_releases', async () => {
  const h = harness({ chapters: [manorCh1(), manorCh2()], owned: ['ch2'] });
  await playManorCh1(h);
  expect(lineOf(h.vm)).toBe('ch1.garden.l005');
  expect(h.scene.holders.has('scene:char:ally')).toBe(true);
  expect(h.scene.holders.has('next:ch2')).toBe(true);
  await h.game.advance(); // END: the change, then ch2's first line
  expect(lineOf(h.vm)).toBe('ch2.study.l001');
  // F4 step 5: the new first knot's batch and its hand-over only; nothing of ch1's stage or preloads.
  expect(held(h)).toEqual(['preload:study=bg/study', 'scene:bg=bg/study']);
  const change = h.scene.calls.indexOf('setChapter:ch2');
  expect(change).toBeGreaterThan(-1);
  expect(h.scene.calls.slice(change, change + 2)).toEqual(['setChapter:ch2', 'restore:-']);
  expect(h.audio.calls).toContain('setChapter:ch2');
  expect(h.loader.loads).toEqual(['ch1', 'ch2']); // F4 step 4 takes the chapter F5 kept
  h.game.dispose();
});

test('game: next-chapter holder released on non-ending branch', async () => {
  const h = harness({ chapters: [branchCh1(), manorCh2()], owned: ['ch2'] });
  expect((await h.game.start({ kind: 'new', story: MANOR, chapter: CH1 })).ok).toBe(true);
  await settle();
  // Knot a is an ending knot: F5 holds the next chapter's first knot.
  expect([...(h.scene.holders.get('next:ch2') ?? [])]).toEqual(['bg/study']);
  await h.game.advance(); // a's choice set
  const mark = h.scene.calls.length;
  await h.game.choose(0); // b, which does not end
  expect(lineOf(h.vm)).toBe('ch1.b.l002');
  expect([...h.scene.holders.keys()].filter((k) => k.startsWith('next:'))).toEqual([]);
  const since = h.scene.calls.slice(mark);
  const released = since.indexOf('release:next:');
  expect(released).toBeGreaterThan(-1);
  expect(since.indexOf('preload:preload:c')).toBeGreaterThan(released); // step 4 after step 2
  h.game.dispose();
});

test('game: ending knot reports the ending and skips next-chapter preload', async () => {
  const lonely = chapter(
    'ch1',
    MANOR_CH1,
    { arrival: { assets: ['bg/hall', 'char/ally/neutral', 'bgm/calm'], next: ['garden'] }, garden: { assets: ['bg/garden'], ending: true } },
    { endings: { garden: 'lonely' } },
  );
  const h = harness({ chapters: [lonely, manorCh2()], owned: ['ch2'] });
  await playManorCh1(h);
  expect(reports(h)).toEqual([
    { kind: 'chapter_started', chapterId: CH1, storyVersion: V_CH1 },
    { kind: 'ending_reached', chapterId: CH1, storyVersion: V_CH1, ending: 'lonely' },
  ]);
  expect(h.scene.calls.filter((c) => c.startsWith('preload:next:'))).toEqual([]);
  expect(h.loader.loads).toEqual(['ch1']);
  h.game.dispose();
});

test('game: declared ending end is distinguishable from chapter end', async () => {
  const run = async (option: number): Promise<StatEvent[]> => {
    const h = harness({ chapters: [tideCh3()] });
    expect((await h.game.start({ kind: 'new', story: TIDE, chapter: CH3 })).ok).toBe(true);
    await h.game.advance();
    await h.game.choose(option);
    await h.game.advance(); // END
    h.game.dispose();
    return reports(h);
  };
  const started = { kind: 'chapter_started', chapterId: CH3, storyVersion: V_CH3 };
  expect(await run(1)).toEqual([started, { kind: 'ending_reached', chapterId: CH3, storyVersion: V_CH3, ending: 'drowned' }]);
  expect(await run(0)).toEqual([started, { kind: 'chapter_completed', chapterId: CH3, storyVersion: V_CH3 }]);
});

test('game: story end shows the end', async () => {
  const h = harness({ chapters: [tideCh3()] });
  expect((await h.game.start({ kind: 'new', story: TIDE, chapter: CH3 })).ok).toBe(true);
  await h.game.advance();
  await h.game.choose(1); // drowned, the declared ending
  const autosaves = h.save().autosaves.length;
  await h.game.advance(); // END
  expect(h.vm.notice?.kind).toBe('the_end');
  expect(h.vm.screens.root.kind).toBe('notice');
  // F4′: no new autosave (the ending knot's checkpoint is the last one), not even at pagehide.
  h.game.pagehide();
  expect(h.save().autosaves.length).toBe(autosaves);
  h.game.dispose();
});

test('game: a chapter end with no next chapter shows to be continued', async () => {
  const h = harness({ chapters: [tideCh3()] });
  expect((await h.game.start({ kind: 'new', story: TIDE, chapter: CH3 })).ok).toBe(true);
  await h.game.advance();
  await h.game.choose(0); // dawn: a plain END, and ch3 has no next chapter
  await h.game.advance(); // END
  expect(h.vm.notice?.kind).toBe('to_be_continued');
  expect(h.vm.screens.root.kind).toBe('notice');
  expect(reports(h).at(-1)).toEqual({ kind: 'chapter_completed', chapterId: CH3, storyVersion: V_CH3 });
  h.game.dispose();
});

test('game: chapter start and end are reported', async () => {
  const h = harness({ chapters: [manorCh1(), manorCh2()], owned: ['ch2'] });
  await playManorCh1(h);
  await h.game.advance(); // END, then ch2
  expect(reports(h)).toEqual([
    { kind: 'chapter_started', chapterId: CH1, storyVersion: V_CH1 },
    { kind: 'chapter_completed', chapterId: CH1, storyVersion: V_CH1 },
    { kind: 'chapter_started', chapterId: CH2, storyVersion: V_CH2 },
  ]);
  h.game.dispose();
});

test('game: an unowned next chapter saves its pending start and opens the paywall', async () => {
  const h = harness({ chapters: [manorCh1(), manorCh2()] });
  await playManorCh1(h);
  expect(h.loader.loads).toEqual(['ch1']); // F5 preloads only a chapter the player may read
  await h.game.advance(); // END
  const w = h.save().autosaves.at(-1);
  const body = w === undefined ? null : decodeSave(w.body);
  expect(body?.ok && { chapterId: body.value.chapterId, ink: body.value.ink, carry: body.value.chapterStart.carry }).toEqual({
    chapterId: 'ch2',
    ink: null,
    carry: { g_x: 0 },
  });
  expect(h.vm.paywall).toEqual({ chapter: 'Two', priceStars: 50, state: { kind: 'idle' } });
  expect(h.vm.screens.overlays.map((o) => o.kind)).toEqual(['paywall']);
  expect(reports(h).at(-1)).toEqual({ kind: 'chapter_completed', chapterId: CH1, storyVersion: V_CH1 });
  // Back closes it; the next tap opens it again (D11).
  h.screens.back();
  expect(h.vm.screens.overlays).toEqual([]);
  await h.game.advance();
  expect(h.vm.screens.overlays.map((o) => o.kind)).toEqual(['paywall']);
  const auto = h.save().slots.get('auto');
  h.game.dispose();
  // Continue from that save in a later session: the paywall again, over the game root.
  const again = harness({ chapters: [manorCh1(), manorCh2()], slots: new Map(auto === undefined ? [] : [['auto', auto]]) });
  expect((await again.game.start({ kind: 'slot', story: MANOR, slot: 'auto' })).ok).toBe(true);
  expect(again.vm.screens.root.kind).toBe('game');
  expect(again.vm.screens.overlays.map((o) => o.kind)).toEqual(['paywall']);
  again.game.dispose();
});

/** A body as F4 step 3 writes it at ch1's END while ch2 was not owned. */
function pendingCh2(): SaveFull {
  const body = {
    format: 1,
    chapterId: 'ch2',
    storyVersion: V_CH1,
    ink: null,
    at: { lineId: null, knot: null, yield: null },
    staging: { bg: null, cg: null, chars: [], bgm: null, props: [] },
    checkpoint: null,
    chapterStart: { carry: { g_x: 1 } },
    backlog: [],
    world: EMPTY_WORLD_STATE,
    worldVersion: null,
  };
  const w: SaveWrite = { chapterId: CH2, storyVersion: V_CH1, lineId: null, body: JSON.stringify(body) };
  return { summary: summary(MANOR, 'auto', w), body: w.body };
}

test('game: pending chapter start reports chapter start', async () => {
  const h = harness({ chapters: [manorCh1(), manorCh2()], owned: ['ch2'], slots: new Map([['auto', pendingCh2()]]) });
  expect((await h.game.start({ kind: 'slot', story: MANOR, slot: 'auto' })).ok).toBe(true);
  expect(lineOf(h.vm)).toBe('ch2.study.l001');
  expect(reports(h)).toEqual([{ kind: 'chapter_started', chapterId: CH2, storyVersion: V_CH2 }]);
  h.game.dispose();
});

test('game: exact or checkpoint resume does not report chapter start', async () => {
  const first = harness();
  await startManor(first);
  await first.game.advance();
  const auto = first.save().slots.get('auto'); // the knot entry's autosave, at l001
  first.game.dispose();
  expect(auto).toBeDefined();
  if (auto === undefined) {
    return;
  }
  // Exact: the same story version.
  const exact = harness({ slots: new Map([['auto', auto]]) });
  expect((await exact.game.start({ kind: 'slot', story: MANOR, slot: 'auto' })).ok).toBe(true);
  expect(lineOf(exact.vm)).toBe('ch1.arrival.l001');
  expect(reports(exact)).toEqual([]);
  exact.game.dispose();
  // Checkpoint: a story update changed the version, so the exact level is skipped.
  const updated = chapter(
    'ch1',
    MANOR_CH1,
    { arrival: { assets: ['bg/hall', 'char/ally/neutral', 'bgm/calm'], next: ['garden'] }, garden: { assets: ['bg/garden'], ending: true } },
    { version: '0122222222222222' },
  );
  const checkpoint = harness({ chapters: [updated], slots: new Map([['auto', auto]]) });
  expect((await checkpoint.game.start({ kind: 'slot', story: MANOR, slot: 'auto' })).ok).toBe(true);
  expect(lineOf(checkpoint.vm)).toBe('ch1.arrival.l001');
  expect(reports(checkpoint)).toEqual([]);
  checkpoint.game.dispose();
});


// ---------------------------------------------------------------------------------------------------------------
// C4: the ink-error floor (PP F2 "Runtime errors", D10)

test('game: repeated ink error walks resume down to chapter start', async () => {
  // `->->` outside a tunnel raises at run time, after the knot's checkpoint and its choice set.
  const broken = chapter(
    'ch1',
    [
      '-> start',
      '=== start ===',
      'Start line. #id:ch1.start.l001',
      '-> broken',
      '=== broken ===',
      'Broken line. #id:ch1.broken.l002',
      '* [Go on. #id:ch1.broken.c001]',
      '    ->->',
    ],
    { start: { next: ['broken'] }, broken: {} },
  );
  const h = harness({ chapters: [broken] });
  await startManor(h);
  await h.game.advance(); // l002, entering broken: its checkpoint
  const fail = async (): Promise<void> => {
    await h.game.advance(); // the choice set
    await h.game.choose(0); // the ink error
    expect(h.vm.notice?.kind).toBe('story_error');
  };
  const returnToSave = async (): Promise<string | null> => {
    const n = h.vm.notice;
    if (n?.kind === 'story_error') {
      n.onaction();
    }
    await settle();
    await settle();
    return lineOf(h.vm);
  };
  await fail();
  expect(await returnToSave()).toBe('ch1.broken.l002'); // the first error: the checkpoint
  await fail();
  expect(await returnToSave()).toBe('ch1.start.l001'); // a later one: the chapter start
  await h.game.advance();
  await fail();
  expect(await returnToSave()).toBe('ch1.start.l001'); // the floor
  h.game.dispose();
});

// ---------------------------------------------------------------------------------------------------------------
// W2 (b): the story-update resume toasts (PP "Save format and resume")

/** The transient note with that message, if shown. */
const note = (vm: ViewModel, message: string): boolean => vm.toasts.some((e) => e.kind === 'note' && e.message === message);

/** manor's autosave at l001 (the arrival knot's entry), from a session of the current ch1. */
async function arrivalSave(): Promise<SaveFull | undefined> {
  const first = harness();
  await startManor(first);
  const auto = first.save().slots.get('auto');
  first.game.dispose();
  return auto;
}

test('game: a story update resume at the checkpoint shows its toast', async () => {
  const auto = await arrivalSave();
  expect(auto).toBeDefined();
  if (auto === undefined) {
    return;
  }
  const same = harness({ slots: new Map([['auto', auto]]) });
  expect((await same.game.start({ kind: 'slot', story: MANOR, slot: 'auto' })).ok).toBe(true);
  expect(same.vm.toasts).toEqual([]); // the exact level: nothing to say
  same.game.dispose();
  const updated = chapter(
    'ch1',
    MANOR_CH1,
    { arrival: { assets: ['bg/hall', 'char/ally/neutral', 'bgm/calm'], next: ['garden'] }, garden: { assets: ['bg/garden'], ending: true } },
    { version: '0122222222222222' },
  );
  const h = harness({ chapters: [updated], slots: new Map([['auto', auto]]) });
  expect((await h.game.start({ kind: 'slot', story: MANOR, slot: 'auto' })).ok).toBe(true);
  expect(lineOf(h.vm)).toBe('ch1.arrival.l001');
  expect(note(h.vm, 'История обновилась: продолжаем с начала сцены')).toBe(true);
  h.game.dispose();
});

test('game: a story update resume at the chapter start shows its toast', async () => {
  const auto = await arrivalSave();
  expect(auto).toBeDefined();
  if (auto === undefined) {
    return;
  }
  // The update removed the saved checkpoint's knot: the resume falls to the chapter start.
  const rewritten = chapter('ch1', ['-> hall', '=== hall ===', 'The hall. #id:ch1.hall.l001', '-> END'], { hall: { ending: true } }, { version: '0133333333333333' });
  const h = harness({ chapters: [rewritten], slots: new Map([['auto', auto]]) });
  expect((await h.game.start({ kind: 'slot', story: MANOR, slot: 'auto' })).ok).toBe(true);
  expect(lineOf(h.vm)).toBe('ch1.hall.l001');
  expect(note(h.vm, 'История обновилась: продолжаем с начала главы')).toBe(true);
  expect(note(h.vm, 'История обновилась: продолжаем с начала сцены')).toBe(false);
  h.game.dispose();
});

// ---------------------------------------------------------------------------------------------------------------
// C5: the chapter purchase and exit to stories (PP P1-P9, D11, D17; SP "Module API")

test('game: exit to stories returns the registry to baseline', async () => {
  const base = liveRunners();
  const h = harness({ chapters: [manorCh1(), manorCh2()], owned: ['ch2'] });
  await playManorCh1(h);
  // In play at an ending knot: its stage, its own preload and the next chapter (F5) are held.
  expect(held(h)).toEqual(expect.arrayContaining(['scene:bg=bg/garden', 'scene:char:ally=char/ally/neutral', 'next:ch2=bg/study']));
  await h.game.exitToStories();
  expect(held(h)).toEqual([]);
  expect(h.audio.calls).toContain('setChapter:null');
  expect(liveRunners() - base).toBe(0);
  expect([h.exits(), h.vm.line, h.vm.choices]).toEqual([1, null, null]);
  h.game.dispose();
});

test('game: exit to stories disposes the save service', async () => {
  const h = harness();
  await startManor(h);
  await h.game.advance(); // l002
  const before = h.save().autosaves.length;
  await Promise.all([h.game.exitToStories(), h.game.exitToStories()]); // single-shot
  // SP order: the autosave of the line on screen, then the service is disposed.
  expect(h.save().autosaves.map((w) => w.lineId).slice(before)).toEqual(['ch1.arrival.l002']);
  expect(h.save().disposed).toBe(1);
  expect(h.exits()).toBe(1);
  h.game.dispose();
});

test('game: a confirmed purchase starts the pending chapter', async () => {
  const h = harness({ chapters: [manorCh1(), manorCh2()], invoice: ['failed', 'paid'] });
  await playManorCh1(h);
  await h.game.advance(); // END: ch2's pending start and the paywall
  h.game.buy();
  await settle();
  // P7: a failed payment is a toast, and the paywall stays.
  expect(h.vm.toasts.some((e) => e.kind === 'note' && e.message === 'Оплата не прошла')).toBe(true);
  expect(h.vm.paywall?.state).toEqual({ kind: 'failed', reason: 'failed' });
  expect(lineOf(h.vm)).toBe('ch1.garden.l005');
  h.game.buy();
  await settle();
  await settle();
  // P8-P9: unlocked only after the server's order and entitlement reads; then F4 step 4 with the saved carry.
  expect(h.purchases).toEqual([
    'createInvoice:chapter:ch2',
    'openInvoice',
    'createInvoice:chapter:ch2',
    'openInvoice',
    'getOrder:o1',
    'getEntitlements',
    'refresh',
  ]);
  expect(h.vm.paywall).toBeNull();
  expect(h.vm.screens.overlays).toEqual([]);
  expect(lineOf(h.vm)).toBe('ch2.study.l001');
  expect(reports(h).at(-1)).toEqual({ kind: 'chapter_started', chapterId: CH2, storyVersion: V_CH2 });
  h.game.dispose();
});

test('game: a locked chapter row opens the paywall and the unlock starts it', async () => {
  const h = harness({ chapters: [manorCh1(), manorCh2()], invoice: ['paid'] });
  h.game.offerChapter(MANOR, CH2);
  // D17: over the current root, before any session.
  expect(h.vm.screens.root.kind).toBe('home');
  expect(h.vm.screens.overlays.map((o) => o.kind)).toEqual(['paywall']);
  expect(h.vm.paywall).toEqual({ chapter: 'Two', priceStars: 50, state: { kind: 'idle' } });
  h.game.buy();
  await settle();
  await settle();
  expect(h.vm.screens.root.kind).toBe('game');
  expect(lineOf(h.vm)).toBe('ch2.study.l001');
  expect(reports(h)).toEqual([{ kind: 'chapter_started', chapterId: CH2, storyVersion: V_CH2 }]);
  h.game.dispose();
});

// ---------------------------------------------------------------------------------------------------------------
// C6: the yields in the session (PZ "Resource lifetime", F9, F10; SP "Module API")

type Json = Record<string, unknown>;
let worldLine = 0;
const wtxt = (ru: string): Json => ({ id: `ch1.gw.${(worldLine++).toString(36).padStart(4, '0')}`, ru });
const WRECT = [100, 200, 200, 200];

/** hall (an exit to study, a medal, a box the medal and the gate code open); study's onEnter runs study_event. */
function gameWorld(): WorldPublic {
  const code = (closeup: string | null, maxAttempts: number | null): Json => ({
    type: 'code',
    title: wtxt('code'),
    prompt: wtxt('prompt'),
    closeup,
    params: { dials: 4 },
    maxAttempts,
    giveUp: false,
    solution: [1, 1, 1, 1],
    hints: [wtxt('hint')],
  });
  const exitTo = (id: string, to: string): Json => ({ id, kind: 'exit', rect: WRECT, label: wtxt(id), to: { room: to }, lock: null, sfx: null });
  const r = decodeWorldSource({
    format: 1,
    items: { medal: { name: wtxt('Медаль'), desc: wtxt('d'), glyph: 'sun' } },
    docs: {},
    puzzles: { drawer: code('drawer_close', 2), gate: code(null, null) },
    sections: {
      manor: {
        start: 'hall',
        bgm: null,
        rooms: {
          hall: {
            bg: 'hall',
            title: wtxt('Hall'),
            onEnter: [],
            hotspots: [
              exitTo('to_study', 'study'),
              { id: 'medal', kind: 'take', rect: WRECT, label: wtxt('medal'), gives: { item: 'medal' }, prop: 'medal', then: [] },
              {
                id: 'box',
                kind: 'object',
                rect: WRECT,
                label: wtxt('box'),
                lock: { slots: [{ accepts: 'medal' }], puzzle: 'gate', locked: wtxt('locked'), onOpen: [], onFail: [] },
                then: [],
                look: null,
                prop: null,
              },
            ],
          },
          study: { bg: 'study', title: wtxt('Study'), onEnter: [{ story: 'study_event' }], hotspots: [exitTo('to_hall', 'hall')] },
        },
      },
    },
  });
  if (!r.ok) {
    throw new Error(`invariant: the fixture world decodes: ${JSON.stringify(r.error)}`);
  }
  return { ...toPublic(r.value), version: '1111111111111111' };
}

const WORLD_VARS = ['g_x', 'pz_drawer', 'pz_drawer_hints', 'pz_gate', 'pz_gate_hints', 'it_medal'];
const WORLD_INK_VARS = ['VAR pz_drawer = 0', 'VAR pz_drawer_hints = 0', 'VAR pz_gate = 0', 'VAR pz_gate_hints = 0', 'VAR it_medal = false'];

/** ch1 with the world: `start` hands over to the manor rooms, or (`puzzle`) to the drawer's linear puzzle first. */
function worldCh1(first: 'explore' | 'puzzle'): LoadedChapter {
  return chapter(
    'ch1',
    [
      ...WORLD_INK_VARS,
      '-> start',
      '=== start ===',
      '# scene: hall',
      'Start. #id:ch1.start.l001',
      ...(first === 'explore' ? ['# explore: manor', '-> DONE'] : ['-> cabinet']),
      '=== cabinet ===',
      'The drawer. #id:ch1.cabinet.l002',
      '# puzzle: drawer then=after',
      '-> DONE',
      '=== after ===',
      'After. #id:ch1.after.l003',
      '-> END',
      '=== study_event ===',
      'Event. #id:ch1.study_event.l004',
      '# explore: manor',
      '-> DONE',
    ],
    {
      start: { assets: ['bg/hall'], next: first === 'explore' ? [] : ['cabinet'] },
      cabinet: { next: [] },
      after: { ending: true },
      study_event: {},
    },
    { assets: ['bg/study', 'prop/medal', 'cg/drawer_close'], vars: WORLD_VARS, world: gameWorld() },
  );
}

/** The real controller behind a counting factory, and a stand-in layer and host (the unit never renders them). */
function worldChunks(): { chunks: LazyChunks; created: () => number } {
  let created = 0;
  const layer = (() => ({})) as unknown as ExploreChunk['layer'];
  const host = (() => ({})) as unknown as Component<PuzzleHostProps>;
  const ui = (() => ({})) as unknown as Component<PuzzleUiProps>;
  return {
    chunks: {
      explore: async () => ({
        ok: true,
        value: {
          create: (d) => {
            created += 1;
            return createExploreController(d);
          },
          layer,
        },
      }),
      puzzleHost: async () => ({ ok: true, value: host }),
      puzzleUi: async () => ({ ok: true, value: ui }),
    },
    created: () => created,
  };
}

/** A fake ResizeObserver whose disconnects are counted (the controller observes the stage host). */
function stubObserver(): { disconnected: () => number } {
  let disconnected = 0;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      disconnect(): void {
        disconnected += 1;
      }
    },
  );
  return { disconnected: () => disconnected };
}

type HeldAttempt = {
  attempt: () => Promise<Result<AttemptResponse, ApiError>>;
  answer: (r: Result<AttemptResponse, ApiError>) => void;
  sent: () => number;
};

/** Attempts the test answers by hand, the oldest first. */
function heldAttempt(): HeldAttempt {
  const waiting: Array<(r: Result<AttemptResponse, ApiError>) => void> = [];
  let sent = 0;
  return {
    attempt: () => {
      sent += 1;
      return new Promise((resolve) => {
        waiting.push(resolve);
      });
    },
    answer: (r) => waiting.shift()?.(r),
    sent: () => sent,
  };
}

const WRONG: Result<AttemptResponse, ApiError> = { ok: true, value: { correct: false, solved: false } };
const hk = (k: string): HotspotKey => k as HotspotKey;

test('game_holds_one_explore_controller', async () => {
  const observer = stubObserver();
  const w = worldChunks();
  const h = harness({ chapters: [worldCh1('explore')], chunks: w.chunks });
  await startManor(h);
  await h.game.advance(); // the explore yield
  await settle();
  expect([w.created(), h.explore.layer !== null]).toEqual([1, true]);
  // The study's onEnter event and its return run on the same controller.
  h.game.exploreActions.ontap(hk('hall.to_study'));
  await settle();
  expect(lineOf(h.vm)).toBe('ch1.study_event.l004');
  await h.game.advance(); // the event's explore yield: back to the study
  await settle();
  expect(w.created()).toBe(1);
  // A load of the autosave at that yield re-enters the rooms with the same controller.
  await h.game.load('auto');
  await settle();
  expect([w.created(), h.explore.layer !== null]).toEqual([1, true]);
  h.game.dispose();
  expect(observer.disconnected()).toBe(1);
  vi.unstubAllGlobals();
});

test('game_holds_at_most_one_puzzle_session', async () => {
  const held = heldAttempt();
  const w = worldChunks();
  const h = harness({ chapters: [worldCh1('puzzle')], chunks: w.chunks, attempt: held.attempt });
  await startManor(h);
  await h.game.advance(); // l002, the cabinet
  await h.game.advance(); // the puzzle yield
  await settle();
  const first = h.puzzle.frame?.id;
  expect(h.puzzle.frame?.mode).toBe('linear');
  h.game.puzzleActions.ontry(); // an attempt in flight
  expect(held.sent()).toBe(1);
  // A reload of the autosave at the yield reopens the puzzle: one session, the first one disposed.
  await h.game.load('auto');
  await settle();
  expect(h.puzzle.frame?.id).not.toBe(first);
  held.answer(WRONG); // the first session's late answer counts nothing
  await settle();
  h.game.pagehide();
  const last = h.save().autosaves.at(-1);
  const body = last === undefined ? null : decodeSave(last.body);
  expect(body?.ok && body.value.world.puzzles).toEqual({});
  expect(h.puzzle.frame?.line).toBe('idle');
  h.game.dispose();
  expect(h.puzzle.frame).toBeNull();
});

test('game: exit to stories disposes explore, puzzle and purchase sessions', async () => {
  const observer = stubObserver();
  const held = heldAttempt();
  const w = worldChunks();
  const h = harness({ chapters: [worldCh1('explore')], chunks: w.chunks, attempt: held.attempt });
  await startManor(h);
  await h.game.advance(); // the rooms
  await settle();
  // The medal into the box's slot opens the gate puzzle (an exploration overlay), and a Try goes out.
  h.game.exploreActions.ontap(hk('hall.medal'));
  await settle();
  h.game.exploreActions.oninsert(hk('hall.box'), 'medal' as ItemId);
  await settle();
  expect([h.puzzle.frame?.mode, h.vm.screens.overlays.map((o) => o.kind)]).toEqual(['explore', ['puzzle']]);
  h.game.puzzleActions.ontry();
  expect(held.sent()).toBe(1);
  expect([...h.scene.holders.keys()].some((k) => k.startsWith('room:'))).toBe(true);
  await h.game.exitToStories();
  const autosaves = h.save().autosaves.length;
  held.answer(WRONG); // the attempt's late answer dispatches nothing
  await settle();
  expect([...h.scene.holders.keys()].filter((k) => k.startsWith('room:'))).toEqual([]);
  expect([observer.disconnected(), h.puzzle.frame, h.explore.layer, h.save().autosaves.length]).toEqual([1, null, null, autosaves]);
  h.game.dispose();
  vi.unstubAllGlobals();
  // The chapter purchase: a flow confirming at the exit polls no more.
  const p = harness({ chapters: [manorCh1(), manorCh2()], invoice: ['pending'] });
  await playManorCh1(p);
  await p.game.advance(); // END: the paywall
  p.game.buy();
  await settle();
  expect(p.vm.paywall?.state.kind).toBe('confirming');
  await p.game.exitToStories();
  const polls = p.purchases.length;
  p.clock.advance(60_000);
  await settle();
  expect(p.purchases.length).toBe(polls);
  p.game.dispose();
});

// ---------------------------------------------------------------------------------------------------------------
// The autosave windows, the mount retry and the rooms after a load (fix round 1)

/** Holds every scene `ensure` until the returned release: the step that waits on one stays in flight. */
function holdEnsure(scene: FakeScene): () => void {
  const original = scene.ensure;
  const waiting: Array<() => void> = [];
  scene.ensure = () =>
    new Promise((resolve) => {
      waiting.push(() => resolve({ ok: true, value: undefined }));
    });
  return () => {
    scene.ensure = original;
    for (const w of waiting.splice(0)) {
      w();
    }
  };
}

test('game: an autosave while a step loads resumes exactly', async () => {
  const h = harness();
  await startManor(h);
  await h.game.advance(); // l002
  await h.game.advance(); // the choice set
  await h.game.choose(0); // l003
  const since = h.save().autosaves.length;
  const release = holdEnsure(h.scene);
  const step = h.game.advance(); // the runner is at l005, garden's entry; its bg/garden is still loading
  await settle();
  h.game.onLifecycle('deactivated'); // the app is left while the step is in flight
  h.game.pagehide();
  release();
  await step;
  await settle();
  const written = h.save().autosaves.slice(since);
  h.game.dispose();
  expect(written.length).toBeGreaterThan(0);
  for (const w of written) {
    const again = harness({ slots: new Map([['auto', { summary: summary(MANOR, 'auto', w), body: w.body }]]) });
    expect((await again.game.start({ kind: 'slot', story: MANOR, slot: 'auto' })).ok).toBe(true);
    expect(again.vm.toasts).toEqual([]); // an exact resume: no story-update note
    expect([lineOf(again.vm), again.scene.snapshot().bg]).toEqual(['ch1.garden.l005', 'garden']);
    again.game.dispose();
  }
  // The knot entry's autosave, then the lifecycle's: written once the step was on screen, not dropped.
  expect(written.map((w) => w.lineId)).toEqual(['ch1.garden.l005', 'ch1.garden.l005']);
});

test('game: load it sends no autosave between the choice and the load', async () => {
  const h = harness();
  await startManor(h);
  await h.game.advance(); // l002
  await h.game.advance(); // the choice set
  await h.game.choose(0); // l003
  const sv = h.save();
  const theirs = sv.autosaves[0]; // the other device's save: the start knot's entry, at l001
  expect(theirs).toBeDefined();
  if (theirs === undefined) {
    return;
  }
  const log: string[] = [];
  const autosave = sv.autosave;
  sv.autosave = (w, o) => {
    log.push(`autosave:${w.lineId}`);
    autosave(w, o);
  };
  const resolveConflict = sv.resolveConflict;
  sv.resolveConflict = (c) => {
    log.push(`resolve:${c}`);
    resolveConflict(c);
  };
  let held: Promise<void> | null = null;
  const load = sv.load;
  sv.load = async (slot) => {
    log.push(`load:${slot}`);
    await held;
    return load(slot);
  };
  const loadIt = (): void => {
    const p = h.vm.toasts.find((e) => e.key === 'save_conflict');
    if (p?.kind === 'prompt') {
      p.actions[0]?.run();
    }
  };
  // 1. "Load it" while a step waits on its art: that step's knot-entry autosave must not land over their save.
  sv.slots.set('auto', { summary: THEIRS, body: theirs.body });
  const release = holdEnsure(h.scene);
  sv.emit({ kind: 'paused', current: THEIRS });
  const step = h.game.advance(); // l005, garden's entry: waits on bg/garden
  await settle();
  loadIt();
  release();
  await step;
  await settle();
  expect(log).toEqual(['resolve:load-theirs', 'load:auto']);
  expect(lineOf(h.vm)).toBe('ch1.arrival.l001');
  // 2. The app is left while their save is being read: its autosave is written after the resume, of their save.
  await h.game.advance(); // l002
  log.length = 0;
  sv.slots.set('auto', { summary: THEIRS, body: theirs.body });
  let answer = (): void => {};
  held = new Promise((resolve) => {
    answer = resolve;
  });
  sv.emit({ kind: 'paused', current: THEIRS });
  loadIt();
  await settle();
  h.game.onLifecycle('deactivated');
  answer();
  await settle();
  await settle();
  expect(log).toEqual(['resolve:load-theirs', 'load:auto', 'autosave:ch1.arrival.l001']);
  expect(lineOf(h.vm)).toBe('ch1.arrival.l001');
  h.game.dispose();
});

test('game: a failed scene mount is retried by the notice', async () => {
  const h = harness();
  let mounts = 0;
  h.scene.mount = async () => {
    mounts += 1;
    return mounts === 1 ? { ok: false, error: { kind: 'mount', detail: 'no webgl context' } } : { ok: true, value: undefined };
  };
  const r = await h.game.start({ kind: 'new', story: MANOR, chapter: CH1 });
  expect(r.ok).toBe(false);
  const notice = h.vm.notice;
  expect(notice?.kind).toBe('error');
  if (notice?.kind === 'error') {
    notice.onaction(); // its Retry starts again from the same point
  }
  await settle();
  await settle();
  expect([mounts, lineOf(h.vm)]).toEqual([2, 'ch1.arrival.l001']);
  h.game.dispose();
});

test('game: a load at a story step hides the rooms and releases their holders', async () => {
  stubObserver();
  const w = worldChunks();
  const h = harness({ chapters: [worldCh1('explore'), manorCh2()], chunks: w.chunks });
  await startManor(h);
  const auto = h.save().slots.get('auto'); // the start knot's entry autosave, at l001
  const decoded = auto === undefined ? null : decodeSave(auto.body);
  expect(decoded?.ok).toBe(true);
  if (auto === undefined || decoded === null || !decoded.ok) {
    return;
  }
  h.save().slots.set('s1', { ...auto, summary: { ...auto.summary, slot: 's1' } });
  const rooms = (): string[] => [...h.scene.holders.keys()].filter((k) => k.startsWith('room:'));
  const view = (): unknown[] => [lineOf(h.vm), h.explore.layer !== null, h.vm.screens.backVisible, rooms()];
  await h.game.advance(); // the explore yield: the hall
  await settle();
  h.game.exploreActions.ontap(hk('hall.to_study')); // the study's onEnter event
  await settle();
  await h.game.advance(); // the event's explore yield: back in the study
  await settle();
  expect(view()).toEqual(['ch1.study_event.l004', true, true, ['room:hall', 'room:study']]);
  // 1. The same chapter, at a story line: the layer, the root-back and the rooms' holders go.
  await h.game.load('s1');
  await settle();
  expect(view()).toEqual(['ch1.start.l001', false, false, []]);
  await h.game.advance(); // the story goes on into the rooms: entered afresh
  await settle();
  expect([w.created(), h.explore.layer !== null, rooms()]).toEqual([2, true, ['room:hall', 'room:study']]);
  // 2. A saved start of a chapter not owned (D11): the paywall over an empty stage, with no rooms under it.
  h.game.exploreActions.oninventory();
  const pending = { ...decoded.value, chapterId: CH2, ink: null, at: { lineId: null, knot: null, yield: null }, staging: EMPTY_SNAPSHOT };
  h.save().slots.set('s2', { summary: { ...auto.summary, slot: 's2', chapterId: CH2 }, body: encodeSave({ ...pending, checkpoint: null, backlog: [] }) });
  await h.game.load('s2');
  await settle();
  expect([h.explore.layer !== null, h.explore.panel, rooms(), h.vm.screens.overlays.map((o) => o.kind)]).toEqual([false, null, [], ['paywall']]);
  h.game.dispose();
  vi.unstubAllGlobals();
});
