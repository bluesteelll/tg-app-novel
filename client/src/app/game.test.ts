// The game session (PROTOTYPE-PLAN F2-F5, STORIES-PLAN "Module API", META-PLAN M1) over fakes: inline ink compiled by
// the story tool's compiler and played by the real runner, a fake scene that keeps the asset registry's holders, fake
// audio, saves and reporter, and the real view model, screens stack and settings store. Each test disposes its game,
// so `liveRunners()` deltas are exact.
import type { Component } from 'svelte';
import { expect, test, vi } from 'vitest';

import { compileChapter } from '../../scripts/story/compile.ts';
import { GLOBALS_PATH } from '../../scripts/story/lint.ts';
import type { Decoder } from '../api/decode.ts';
import { createEndpoints, puzzleId } from '../api/endpoints.ts';
import type { Endpoints } from '../api/endpoints.ts';
import { createMetaEndpoints } from '../api/meta.ts';
import samplesText from '../api/fixtures/dto-samples.json?raw';
import type { AttemptResponse, ProductDto, PuzzleStatus, SaveFull, SaveListResponse, SaveSlot, SaveSummary } from '../api/generated/api.ts';
import type { ApiError, ApiRequest, Clock, Http } from '../api/http.ts';
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
import { PAID_WINDOW_MS, PENDING_WINDOW_MS } from '../purchase/flow.ts';
import type { PurchaseState } from '../purchase/flow.ts';
import type { ChapterLoader } from '../story/chapters.ts';
import { decodeChapterMeta } from '../story/catalog.ts';
import type { AssetEntry, AssetManifest, ChapterCatalog, LoadedChapter, Result, StoryId } from '../story/catalog.ts';
import { liveRunners } from '../story/runner.ts';
import { decodeSave, encodeSave } from '../story/save-codec.ts';
import { EMPTY_SNAPSHOT } from '../story/staging.ts';
import type { AssetId, ChapterId, OrderId, ProductId, PuzzleLocalId, StoryVersion } from '../story/staging.ts';
import type { InvoiceStatus } from '../telegram/index.ts';
import { createExploreView } from '../ui/explore-view.svelte.ts';
import type { ExploreViewStore } from '../ui/explore-view.svelte.ts';
import { createPuzzleView } from '../ui/puzzle-view.svelte.ts';
import type { PuzzleHostProps, PuzzleView } from '../ui/puzzle-view.svelte.ts';
import { createScreens } from '../ui/screens.ts';
import type { Screens, ScreensView } from '../ui/screens.ts';
import { decodeWorldSource, toPublic } from '../world/decode.ts';
import type { HotspotKey, ItemId, WorldPublic } from '../world/types.ts';
import { createViewModel } from '../ui/state.svelte.ts';
import type { ViewModel } from '../ui/state.svelte.ts';
import { createMetaGate, HOME_IDLE_MS, newestAuto } from './boot.ts';
import type { MetaGate } from './boot.ts';
import { CONFLICT_HOLD_MS, createGame, reloadedFor, withReloadedFor } from './game.ts';
import type { Entitlements, Game, GameDeps, ReloadPort } from './game.ts';
import type { MetaController, MetaDeps, MetaUi, MetaView } from './meta.ts';
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
    stats: () => ({
      liveTextures: holders.size,
      liveBytes: 0,
      pendingLoads: 0,
      activeTimelines: 0,
      overCap: 0,
      rebuilds: 0,
      gen: 1,
      openBitmaps: 0,
      stale: 0,
      staleFrames: 0,
      reviveFailed: 0,
      reviving: false,
      visibleReviveMs: null,
    }),
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
  /** Every URL the game asked `fetchAsset` for, in order (LBI: the build-id probe). */
  readonly assetUrls: string[];
  /** How many times the game handed Home back (onExit). */
  exits(): number;
  /** How many times the game closed the Mini App (the facade's `close`). */
  closes(): number;
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
  /** Holds every openInvoice answer until it settles: the native sheet stays open meanwhile. */
  invoiceGate?: Promise<void>;
  /** The lazy families; the default imports none (a yield with no chunks is a test bug). */
  chunks?: LazyChunks;
  /** postAttempt's answer; the default is a network error. */
  attempt?: () => Promise<Result<AttemptResponse, ApiError>>;
  /** getPuzzle's answer; the default is a network error. */
  status?: () => Promise<Result<PuzzleStatus, ApiError>>;
  /** Also told every screens view, after the game (boot's `onView` tells the meta controller too). */
  onView?: (v: ScreensView) => void;
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
      o.onView?.(v);
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
  const assetUrls: string[] = [];
  const answers = [...(o.invoice ?? [])];
  let product: string | null = null;
  let exits = 0;
  let closes = 0;
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
      close: () => {
        closes += 1;
      },
      openInvoice: async () => {
        purchases.push('openInvoice');
        if (o.invoiceGate !== undefined) {
          await o.invoiceGate;
        }
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
      getPuzzle: () => o.status?.() ?? Promise.resolve({ ok: false, error: fail }),
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
    fetchAsset: async (url) => {
      assetUrls.push(url);
      return { ok: false, error: { kind: 'network', detail: 'no assets in the unit test' } };
    },
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
    assetUrls,
    exits: () => exits,
    closes: () => closes,
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

const WRONG: Result<AttemptResponse, ApiError> = { ok: true, value: { correct: false, solved: false, attemptsLeft: null, spent: false } };
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

// ---------------------------------------------------------------------------------------------------------------
// The outside autosave at once, and the guards of fix round 1 pinned (fix round 2)

test('game: a pagehide and a deactivated during a step keep the keepalive of either order', async () => {
  const seen: Record<string, Array<boolean | undefined>> = {};
  for (const order of ['pagehide-first', 'deactivated-first'] as const) {
    const h = harness();
    await startManor(h);
    await h.game.advance(); // l002
    await h.game.advance(); // the choice set
    await h.game.choose(0); // l003
    const sv = h.save();
    const keepalive: Array<boolean | undefined> = [];
    const autosave = sv.autosave;
    sv.autosave = (w, o) => {
      keepalive.push(o?.keepalive);
      autosave(w, o);
    };
    const release = holdEnsure(h.scene);
    const step = h.game.advance(); // l005, garden's entry: waits on bg/garden
    await settle();
    if (order === 'pagehide-first') {
      h.game.pagehide();
      h.game.onLifecycle('deactivated');
    } else {
      h.game.onLifecycle('deactivated');
      h.game.pagehide();
    }
    release();
    await step;
    await settle();
    seen[order] = keepalive;
    h.game.dispose();
  }
  // The knot entry's autosave, then the one write both requests waited for, with the pagehide's keepalive.
  expect(seen).toEqual({ 'pagehide-first': [undefined, true], 'deactivated-first': [undefined, true] });
});

/** `worldCh1('explore')` whose study event opens on a cg, so its first step can be held on that one load. */
function worldCh1Cg(): LoadedChapter {
  return chapter(
    'ch1',
    [
      ...WORLD_INK_VARS,
      '-> start',
      '=== start ===',
      '# scene: hall',
      'Start. #id:ch1.start.l001',
      '# explore: manor',
      '-> DONE',
      '=== study_event ===',
      '# cg: drawer_close',
      'Event. #id:ch1.study_event.l004',
      '# explore: manor',
      '-> DONE',
    ],
    { start: { assets: ['bg/hall'], next: [] }, study_event: { assets: ['cg/drawer_close'] } },
    { assets: ['bg/study', 'prop/medal', 'cg/drawer_close'], vars: WORLD_VARS, world: gameWorld() },
  );
}

test('game: a rooms dirty write while a story step loads resumes exactly', async () => {
  stubObserver();
  const h = harness({ chapters: [worldCh1Cg()], chunks: worldChunks().chunks });
  await startManor(h);
  await h.game.advance(); // the explore yield: the hall
  await settle();
  const sv = h.save();
  const since = sv.autosaves.length;
  const ensure = h.scene.ensure;
  let release = (): void => {};
  let held = false;
  h.scene.ensure = (ids, signal) => {
    if (!ids.some((id) => id === 'cg/drawer_close')) {
      return ensure(ids, signal);
    }
    held = true;
    return new Promise((resolve) => {
      release = () => resolve({ ok: true, value: undefined });
    });
  };
  h.game.exploreActions.ontap(hk('hall.to_study')); // the study's room batch marks the world dirty; its event's cg loads
  await settle();
  await settle();
  expect(held).toBe(true); // the runner is at l004 while the position is still the yield
  h.clock.advance(2_000); // the dirty debounce fires inside that window
  await settle();
  release();
  await settle();
  await settle();
  h.scene.ensure = ensure;
  const written = sv.autosaves.slice(since);
  h.game.dispose();
  vi.unstubAllGlobals();
  const resumed: unknown[] = [];
  for (const w of written) {
    stubObserver();
    const again = harness({
      chapters: [worldCh1Cg()],
      chunks: worldChunks().chunks,
      slots: new Map([['auto', { summary: summary(MANOR, 'auto', w), body: w.body }]]),
    });
    const ok = (await again.game.start({ kind: 'slot', story: MANOR, slot: 'auto' })).ok;
    await settle();
    resumed.push([w.lineId, ok, again.vm.toasts.length, lineOf(again.vm)]);
    again.game.dispose();
    vi.unstubAllGlobals();
  }
  // The event's knot entry, then the dirty write that waited for it: both resume at the event's line, with no note.
  expect(resumed).toEqual([
    ['ch1.study_event.l004', true, 0, 'ch1.study_event.l004'],
    ['ch1.study_event.l004', true, 0, 'ch1.study_event.l004'],
  ]);
});

test('game: load it blocks the pending-start write of a refunded next chapter', async () => {
  const h = harness({ chapters: [manorCh1(), manorCh2()], owned: ['ch2'] });
  const load = h.loader.load;
  let go = (): void => {};
  const gate = new Promise<void>((resolve) => {
    go = resolve;
  });
  h.loader.load = async (ch, o) => {
    if (ch.id === 'ch2') {
      await gate; // F5's load of ch2, which the END intent waits on
    }
    return load(ch, o);
  };
  await playManorCh1(h);
  const sv = h.save();
  const theirs = sv.autosaves[0]; // the other device's save: the start knot's entry, at l001
  expect(theirs).toBeDefined();
  if (theirs === undefined) {
    return;
  }
  const log: string[] = [];
  const autosave = sv.autosave;
  sv.autosave = (w, o) => {
    log.push(`autosave:${w.chapterId}`);
    autosave(w, o);
  };
  const resolveConflict = sv.resolveConflict;
  sv.resolveConflict = (c) => {
    log.push(`resolve:${c}`);
    resolveConflict(c);
  };
  sv.slots.set('auto', { summary: THEIRS, body: theirs.body });
  const end = h.game.advance(); // END: ch2 is listed owned, and its held load decides
  await settle();
  sv.emit({ kind: 'paused', current: THEIRS });
  const p = h.vm.toasts.find((e) => e.key === 'save_conflict');
  if (p?.kind === 'prompt') {
    p.actions[0]?.run(); // Load it
  }
  h.owned.delete('ch2'); // a refund meanwhile: the server answers 403
  go();
  await end;
  await settle();
  await settle();
  // No pending start of ours lands over their save, so their save is what the queued load resumes.
  expect(log.filter((l) => l !== 'resolve:load-theirs')).toEqual([]);
  expect(lineOf(h.vm)).toBe('ch1.arrival.l001');
  h.game.dispose();
});

test('game: keep here neither loads the other save nor stops autosaving', async () => {
  const h = harness();
  await startManor(h);
  await h.game.advance(); // l002
  const sv = h.save();
  const log: string[] = [];
  const load = sv.load;
  sv.load = async (slot) => {
    log.push(`load:${slot}`);
    return load(slot);
  };
  sv.emit({ kind: 'paused', current: THEIRS });
  const p = h.vm.toasts.find((e) => e.key === 'save_conflict');
  expect(p?.kind).toBe('prompt');
  if (p?.kind === 'prompt') {
    p.actions[1]?.run(); // Играть здесь
  }
  await settle();
  expect(log).toEqual([]);
  const before = sv.autosaves.length;
  await h.game.advance(); // the choice set: its autosave goes on
  expect(sv.autosaves.slice(before).map((w) => w.lineId)).toEqual([null]);
  h.game.dispose();
});

/** The ink-error floor's chapter: the choice after `broken`'s line raises at run time (`->->` outside a tunnel). */
function brokenCh1(): LoadedChapter {
  return chapter(
    'ch1',
    ['-> start', '=== start ===', 'Start line. #id:ch1.start.l001', '-> broken', '=== broken ===', 'Broken line. #id:ch1.broken.l002', '* [Go on. #id:ch1.broken.c001]', '    ->->'],
    { start: { next: ['broken'] }, broken: {} },
  );
}

test('game: return to last save after load it resumes their save', async () => {
  const other = harness({ chapters: [brokenCh1()] });
  await startManor(other);
  await other.game.advance(); // l002, entering broken: its checkpoint
  await other.game.advance(); // the choice set
  const theirs = other.save().slots.get('auto');
  other.game.dispose();
  expect(theirs).toBeDefined();
  if (theirs === undefined) {
    return;
  }
  const h = harness({ chapters: [brokenCh1()] });
  await startManor(h); // ours: l001, the start knot's entry
  const sv = h.save();
  sv.slots.set('auto', theirs);
  sv.emit({ kind: 'paused', current: THEIRS });
  const p = h.vm.toasts.find((e) => e.key === 'save_conflict');
  if (p?.kind === 'prompt') {
    p.actions[0]?.run(); // Load it
  }
  await settle();
  await settle();
  expect(h.vm.choices).not.toBeNull(); // their choice set
  await h.game.choose(0); // the ink error, before any autosave of their save
  const n = h.vm.notice;
  expect(n?.kind).toBe('story_error');
  if (n?.kind === 'story_error') {
    n.onaction(); // Return to last save
  }
  await settle();
  await settle();
  const line = lineOf(h.vm);
  h.game.dispose();
  expect(line).toBe('ch1.broken.l002'); // their checkpoint; ours would be ch1.start.l001
});

test('game: a deactivated during a transition autosaves at once', async () => {
  const h = harness();
  await startManor(h); // l001
  const sv = h.save();
  const written: Array<[string | null, boolean | undefined]> = [];
  const autosave = sv.autosave;
  sv.autosave = (w, o) => {
    written.push([w.lineId, o?.keepalive]);
    autosave(w, o);
  };
  /** Holds the end of the batches applied from now (their transitions; deactivated pauses them so) until the release. */
  const holdApply = (): (() => void) => {
    const apply = h.scene.apply;
    const ends: Array<() => void> = [];
    h.scene.apply = (batch, o) => {
      void apply(batch, o); // the fake stage takes the batch; only its end is held
      return new Promise<void>((resolve) => {
        ends.push(resolve);
      });
    };
    return () => {
      h.scene.apply = apply;
      for (const end of ends.splice(0)) {
        end();
      }
    };
  };
  // 1. l002 is on screen while its batch runs: the session describes l002 alone, so each request is written at once.
  let finish = holdApply();
  let step = h.game.advance(); // l002
  await settle();
  expect(lineOf(h.vm)).toBe('ch1.arrival.l002');
  h.game.onLifecycle('deactivated');
  const atOnce = written.map(([line]) => line);
  h.game.pagehide();
  finish();
  await step;
  await settle();
  expect(atOnce).toEqual(['ch1.arrival.l002']);
  expect(written).toEqual([
    ['ch1.arrival.l002', false],
    ['ch1.arrival.l002', true],
  ]);
  // 2. While the next step waits on its art the request waits, and it is written once that step is on screen, while
  // its batch still runs (a paused transition would hold the intent's end until activated).
  h.game.onLifecycle('activated');
  await h.game.advance(); // the choice set
  await h.game.choose(0); // l003
  written.length = 0;
  const release = holdEnsure(h.scene);
  finish = holdApply();
  step = h.game.advance(); // l005, garden's entry: waits on bg/garden
  await settle();
  h.game.onLifecycle('deactivated');
  const waited = written.length;
  release();
  await settle();
  const onScreen = [...written];
  finish();
  await step;
  await settle();
  h.game.dispose();
  expect([waited, onScreen]).toEqual([
    0,
    [
      ['ch1.garden.l005', undefined],
      ['ch1.garden.l005', false],
    ],
  ]);
  expect(written).toEqual(onScreen); // nothing is left to write when the step ends
});

test('game: a deactivated while a load restores the stage waits for the loaded step', async () => {
  const h = harness({ chapters: [manorCh1(), manorCh2()] });
  await startManor(h); // l001: the start knot's entry autosave
  const sv = h.save();
  const auto = sv.slots.get('auto');
  const decoded = auto === undefined ? null : decodeSave(auto.body);
  expect(decoded?.ok).toBe(true);
  if (auto === undefined || decoded === null || !decoded.ok) {
    return;
  }
  sv.slots.set('s1', { ...auto, summary: { ...auto.summary, slot: 's1' } });
  const pending = { ...decoded.value, chapterId: CH2, ink: null, at: { lineId: null, knot: null, yield: null }, staging: EMPTY_SNAPSHOT };
  sv.slots.set('s2', { summary: { ...auto.summary, slot: 's2', chapterId: CH2 }, body: encodeSave({ ...pending, checkpoint: null, backlog: [] }) });
  await h.game.advance(); // l002
  /** Holds the next stage restore after the fake stage took it, until the returned release. */
  const holdRestore = (): (() => void) => {
    const restore = h.scene.restore;
    let end = (): void => {};
    h.scene.restore = (snapshot) => {
      void restore(snapshot); // the fake stage takes the snapshot; only the restore's end is held
      return new Promise<void>((resolve) => {
        end = resolve;
      });
    };
    return () => {
      h.scene.restore = restore;
      end();
    };
  };
  const loadDeactivated = async (slot: 's1' | 's2'): Promise<{ waited: number; written: SaveWrite[] }> => {
    const since = sv.autosaves.length;
    const release = holdRestore();
    const loading = h.game.load(slot);
    await settle();
    h.game.onLifecycle('deactivated');
    const waited = sv.autosaves.length - since;
    release();
    await loading;
    await settle();
    h.game.onLifecycle('activated');
    return { waited, written: sv.autosaves.slice(since) };
  };
  // 1. The same chapter: the body's runner and fields are in, its stage is still being restored.
  const same = await loadDeactivated('s1');
  // 2. D11, a saved start of a chapter not owned: the stage empties under l002 before the pending start is the body.
  const paid = await loadDeactivated('s2');
  h.game.dispose();
  const resumed: unknown[] = [];
  for (const w of same.written) {
    const again = harness({ slots: new Map([['auto', { summary: summary(MANOR, 'auto', w), body: w.body }]]) });
    const ok = (await again.game.start({ kind: 'slot', story: MANOR, slot: 'auto' })).ok;
    resumed.push([w.lineId, ok, again.vm.toasts.length, lineOf(again.vm)]);
    again.game.dispose();
  }
  expect([same.waited, resumed]).toEqual([0, [['ch1.arrival.l001', true, 0, 'ch1.arrival.l001']]]);
  expect([paid.waited, paid.written.map((w) => [w.chapterId, w.lineId])]).toEqual([0, [['ch2', null]]]);
});

/** manor ch1 whose ending knot ends on a batch of its own: a tag line between its last line and `-> END`. */
function endBatchCh1(): LoadedChapter {
  return chapter('ch1', [...MANOR_CH1.slice(0, -1), 'Night falls. #id:ch1.garden.l006', '# hide: ally', '-> END'], {
    arrival: { assets: ['bg/hall', 'char/ally/neutral', 'bgm/calm'], next: ['garden'] },
    garden: { assets: ['bg/garden'], ending: true },
  });
}

test('game: a deactivated during the end batch keeps the last exact save', async () => {
  const h = harness({ chapters: [endBatchCh1(), manorCh2()], owned: ['ch2'] });
  await playManorCh1(h); // l005, entering garden
  await h.game.advance(); // l006, the chapter's last line
  await settle();
  const sv = h.save();
  const written: SaveWrite[] = [];
  const autosave = sv.autosave;
  sv.autosave = (w, o) => {
    written.push(w);
    autosave(w, o);
  };
  h.game.onLifecycle('deactivated'); // no intent runs: l006 is written at once
  await settle();
  h.game.onLifecycle('activated');
  await settle();
  const apply = h.scene.apply;
  const ends: Array<() => void> = [];
  h.scene.apply = (batch, o) => {
    void apply(batch, o); // the fake stage takes the batch; only its end is held
    return new Promise<void>((resolve) => {
      ends.push(resolve);
    });
  };
  const step = h.game.advance(); // END: ink is past l006 while the end batch (`hide: ally`) runs
  await settle();
  h.game.onLifecycle('deactivated');
  await settle();
  const atKill = written.at(-1); // a WebView killed here leaves the auto slot's last write
  h.scene.apply = apply;
  for (const end of ends.splice(0)) {
    end();
  }
  await step;
  await settle();
  h.game.dispose();
  let resumed: unknown = null;
  if (atKill !== undefined) {
    const again = harness({
      chapters: [endBatchCh1(), manorCh2()],
      owned: ['ch2'],
      slots: new Map([['auto', { summary: summary(MANOR, 'auto', atKill), body: atKill.body }]]),
    });
    const ok = (await again.game.start({ kind: 'slot', story: MANOR, slot: 'auto' })).ok;
    await settle();
    resumed = [atKill.lineId, ok, again.vm.toasts.map((t) => t.key), lineOf(again.vm)];
    again.game.dispose();
  }
  // the end step never sets the position: a body of it would resume a level lower as a false story update
  expect(resumed).toEqual(['ch1.garden.l006', true, [], 'ch1.garden.l006']);
});

// ---------------------------------------------------------------------------------------------------------------
// The engine follow-ups (LFU1): the save paths of a session that describes two steps, the failure notices, the manual
// save's conflict hold

/** manor ch2 broken past the story gate: its first line has no line id, so a resume at its start fails at the floor. */
function noIdCh2(): LoadedChapter {
  return chapter('ch2', ['-> study', '=== study ===', '# bg: study', 'Two begins.', '-> END'], { study: { assets: ['bg/study'], ending: true } });
}

/**
 * At l002, a load of ch2's saved start: the chapter is swapped in, then the resume fails at its floor (fix_r2 KL4).
 * Resolves with the number of autosaves before the load.
 */
async function failAfterSwap(h: Harness): Promise<number> {
  await startManor(h);
  await h.game.advance(); // l002
  const start = pendingCh2();
  h.save().slots.set('s1', { ...start, summary: { ...start.summary, slot: 's1' } });
  const since = h.save().autosaves.length;
  await h.game.load('s1');
  return since;
}

test('game: a resume that fails after the chapter swap writes no autosave', async () => {
  const base = liveRunners();
  const h = harness({ chapters: [manorCh1(), noIdCh2()], owned: ['ch2'] });
  const sv = h.save;
  const since = await failAfterSwap(h);
  expect(h.vm.notice?.kind).toBe('error');
  // At rest under the notice, the session holds ch2 over ch1's runner at l002: no request may write that body.
  h.game.onLifecycle('deactivated');
  h.game.pagehide();
  h.game.onLifecycle('activated');
  const n = h.vm.notice;
  if (n?.kind === 'error') {
    n.onaction(); // the notice's exit, whose own autosave comes first
  }
  await settle();
  await settle();
  expect(sv().autosaves.slice(since).map((w) => [w.chapterId, w.lineId])).toEqual([]);
  expect(h.exits()).toBe(1);
  expect(liveRunners() - base).toBe(0);
  h.game.dispose();
});

test('game: an outside autosave over a pending start is written at once', async () => {
  const h = harness({ chapters: [manorCh1(), manorCh2()] });
  await startManor(h); // l001: the start knot's entry autosave
  await h.game.advance(); // l002
  const sv = h.save();
  const auto = sv.slots.get('auto');
  const decoded = auto === undefined ? null : decodeSave(auto.body);
  expect(decoded?.ok).toBe(true);
  if (auto === undefined || decoded === null || !decoded.ok) {
    return;
  }
  const pending = { ...decoded.value, chapterId: CH2, ink: null, at: { lineId: null, knot: null, yield: null }, staging: EMPTY_SNAPSHOT };
  sv.slots.set('s2', { summary: { ...auto.summary, slot: 's2', chapterId: CH2 }, body: encodeSave({ ...pending, checkpoint: null, backlog: [] }) });
  await h.game.load('s2'); // D11: ch2 is not owned, so its saved start is the session's body under the paywall
  expect(h.vm.screens.overlays.map((o) => o.kind)).toEqual(['paywall']);
  const since = sv.autosaves.length;
  const load = h.loader.load;
  let go = (): void => {};
  const gate = new Promise<void>((resolve) => {
    go = resolve;
  });
  h.loader.load = async (ch, o) => {
    if (ch.id === 'ch2') {
      await gate; // startPending's load of ch2
    }
    return load(ch, o);
  };
  h.owned.add('ch2');
  const unlocking = h.game.retryPrice(); // P1: already owned, so P9 starts the pending chapter, held on its load
  await settle();
  h.game.onLifecycle('deactivated');
  const atOnce = sv.autosaves.slice(since).map((w) => [w.chapterId, w.lineId]);
  h.game.onLifecycle('activated');
  go();
  await unlocking;
  await settle();
  const all = sv.autosaves.slice(since).map((w) => [w.chapterId, w.lineId]);
  const line = lineOf(h.vm);
  h.game.dispose();
  // The pending start is a complete body, so the request does not wait for ch2's first step.
  expect(atOnce).toEqual([['ch2', null]]);
  expect(line).toBe('ch2.study.l001');
  expect(all).toEqual([
    ['ch2', null],
    ['ch2', 'ch2.study.l001'],
  ]);
});

test('game: a failed load it read shows the error notice', async () => {
  const rows: unknown[] = [];
  for (const kind of ['get', 'empty', 'undecodable', 'expired'] as const) {
    const h = harness();
    await startManor(h);
    await h.game.advance(); // l002
    const sv = h.save();
    const log: Array<string | null> = [];
    const autosave = sv.autosave;
    sv.autosave = (w, o) => {
      log.push(w.lineId);
      autosave(w, o);
    };
    let answer = (): void => {};
    const held = new Promise<void>((resolve) => {
      answer = resolve;
    });
    const load = sv.load;
    sv.load = async (slot) => {
      if (kind === 'get') {
        await held;
        return { ok: false, error: { kind: 'network', detail: 'offline' } };
      }
      // The http layer's answer once the page's session has ended; it has shown the reopen notice already (boot).
      return kind === 'expired' ? { ok: false, error: { kind: 'session-expired' } } : load(slot);
    };
    if (kind === 'empty') {
      sv.slots.delete('auto');
    } else if (kind === 'undecodable') {
      sv.slots.set('auto', { summary: THEIRS, body: 'not json' });
    }
    sv.emit({ kind: 'paused', current: THEIRS });
    const p = h.vm.toasts.find((e) => e.key === 'save_conflict');
    if (p?.kind === 'prompt') {
      p.actions[0]?.run(); // Load it
    }
    await settle();
    if (kind === 'get') {
      h.game.onLifecycle('deactivated'); // during the read: kept under adopting
      answer();
      await settle();
    }
    h.game.onLifecycle('deactivated'); // at rest
    const notice = h.vm.notice;
    const root = h.vm.screens.root.kind;
    if (notice?.kind === 'error') {
      notice.onaction();
    }
    await settle();
    await settle();
    rows.push([kind, notice?.kind, root, log, h.exits(), h.save().disposed]);
    h.game.dispose();
  }
  // Their save stays the server's copy: nothing of ours is written; the notice exits to Home, whose Continue reads it.
  // An ended session keeps the reopen notice, as a chapter load does (chapterFailed).
  expect(rows).toEqual([
    ['get', 'error', 'notice', [], 1, 1],
    ['empty', 'error', 'notice', [], 1, 1],
    ['undecodable', 'error', 'notice', [], 1, 1],
    ['expired', 'reopen', 'notice', [], 0, 1],
  ]);
});

test('game: the reopen notice of an ended session closes the app', async () => {
  const rows: unknown[] = [];
  // "Load it" whose read finds the page's session ended (adoptFailed), then a chapter load that finds it (chapterFailed).
  for (const part of ['adopt', 'chapter'] as const) {
    const h = harness();
    if (part === 'adopt') {
      await startManor(h);
      await h.game.advance(); // l002
      const sv = h.save();
      sv.load = async () => ({ ok: false, error: { kind: 'session-expired' } });
      sv.emit({ kind: 'paused', current: THEIRS });
      const p = h.vm.toasts.find((e) => e.key === 'save_conflict');
      if (p?.kind === 'prompt') {
        p.actions[0]?.run(); // Load it
      }
    } else {
      h.loader.load = async () => ({ ok: false, error: { kind: 'session-expired' } });
      void h.game.start({ kind: 'new', story: MANOR, chapter: CH1 });
    }
    await settle();
    await settle();
    // K33: the notice's Close is the facade's close, once per tap of its one action.
    const n = h.vm.notice;
    if (n?.kind === 'reopen') {
      n.onclose();
    }
    rows.push([part, n?.kind, h.closes()]);
    h.game.dispose();
  }
  expect(rows).toEqual([
    ['adopt', 'reopen', 1],
    ['chapter', 'reopen', 1],
  ]);
});

test('game: a failed manual load stays at the shown line without a notice', async () => {
  const rows: unknown[] = [];
  for (const kind of ['get', 'empty', 'undecodable'] as const) {
    const h = harness();
    await startManor(h);
    await h.game.advance(); // l002
    const sv = h.save();
    if (kind === 'get') {
      sv.load = async () => ({ ok: false, error: { kind: 'network', detail: 'offline' } });
    } else if (kind === 'undecodable') {
      sv.slots.set('s1', { summary: { ...THEIRS, slot: 's1' }, body: 'not json' });
    } // 'empty': s1 was never saved
    await h.game.openSaves();
    await h.game.load('s1'); // the save screen's Load, not "Load it": the session is not adopting
    await settle();
    rows.push([kind, h.vm.notice?.kind ?? null, h.vm.screens.root.kind, lineOf(h.vm), h.exits()]);
    h.game.dispose();
  }
  // Only "Load it" leaves the session with nothing to resume; a manual load that read nothing keeps the game as it was.
  expect(rows).toEqual([
    ['get', null, 'game', 'ch1.arrival.l002', 0],
    ['empty', null, 'game', 'ch1.arrival.l002', 0],
    ['undecodable', null, 'game', 'ch1.arrival.l002', 0],
  ]);
});

/** ch1 broken past the story gate after its first line: the second line has no line id. */
function noIdNextCh1(): LoadedChapter {
  return chapter('ch1', ['-> start', '=== start ===', 'Start line. #id:ch1.start.l001', 'No id here.', '-> END'], { start: {} });
}

/** ch1 broken past the story gate at its first line: it has no line id. */
function noIdFirstCh1(): LoadedChapter {
  return chapter('ch1', ['-> start', '=== start ===', 'No id here.', '-> END'], { start: {} });
}

test('game: return to last save after a continue resumes the continued save', async () => {
  const first = harness({ chapters: [noIdNextCh1()] });
  await startManor(first); // l001: its knot entry's autosave
  const auto = first.save().slots.get('auto');
  first.game.dispose();
  expect(auto).toBeDefined();
  if (auto === undefined) {
    return;
  }
  // An exact resume at a line writes nothing; the save it resumed is the session's last save (LFU1 cut Q3), so the
  // next step's error returns to it, from its checkpoint (D10), instead of exiting to the stories.
  const h = harness({ chapters: [noIdNextCh1()], slots: new Map([['auto', auto]]) });
  expect((await h.game.start({ kind: 'slot', story: MANOR, slot: 'auto' })).ok).toBe(true);
  await h.game.advance();
  const n = h.vm.notice;
  expect(n?.kind).toBe('story_error');
  if (n?.kind === 'story_error') {
    n.onaction(); // Return to last save
  }
  await settle();
  await settle();
  expect([h.exits(), h.save().disposed, lineOf(h.vm)]).toEqual([0, 0, 'ch1.start.l001']);
  h.game.dispose();
});

test('game: return to last save with no save exits to the stories', async () => {
  const parts: ReadonlyArray<readonly [string, () => Promise<Harness>]> = [
    [
      'new',
      async () => {
        const h = harness({ chapters: [noIdFirstCh1()] });
        await startManor(h); // the first step raises
        return h;
      },
    ],
  ];
  const rows: unknown[] = [];
  for (const [part, reach] of parts) {
    const h = await reach();
    const n = h.vm.notice;
    expect(n?.kind).toBe('story_error');
    if (n?.kind === 'story_error') {
      n.onaction(); // Return to last save
    }
    await settle();
    await settle();
    rows.push([part, h.exits(), h.save().disposed, lineOf(h.vm)]);
    h.game.dispose();
  }
  expect(rows).toEqual([['new', 1, 1, null]]);
});

/** Every manual save of `sv` answers the server's 409: another device saved the slot. */
function conflicting(sv: FakeSaves): void {
  sv.save = async (slot, w) => ({ ok: false, error: { kind: 'conflict', current: summary(MANOR, slot, w) } });
}

test('game: a 409 on a manual save asks only after the double-tap window', async () => {
  const h = harness();
  await startManor(h);
  await h.game.advance(); // l002
  const sv = h.save();
  conflicting(sv);
  const overwrites: string[] = [];
  const overwrite = sv.overwrite;
  sv.overwrite = (slot, w, current) => {
    overwrites.push(slot);
    return overwrite(slot, w, current);
  };
  const view = (): unknown[] => [h.vm.saves.saving, h.vm.saves.conflict];
  // 1. The overwrite ask's Yes, answered 409 at once, then the double tap's second tap where the conflict's Yes renders.
  void h.game.save('s1');
  await settle();
  await h.game.overwrite('s1');
  await settle();
  expect([...view(), overwrites.length]).toEqual(['s1', null, 0]);
  // 2. After the window the conflict asks, and a deliberate Yes overwrites.
  h.clock.advance(CONFLICT_HOLD_MS);
  const asked = view();
  await h.game.overwrite('s1');
  await settle();
  expect([asked, overwrites]).toEqual([[null, 's1'], ['s1']]);
  // 3. The save screen left and opened again within the window: the held ask never shows over the fresh screen.
  void h.game.save('s1');
  await settle();
  await h.game.openSaves();
  h.clock.advance(CONFLICT_HOLD_MS);
  expect(view()).toEqual([null, null]);
  // 4. The story left within the window: the hold's timer goes with the session.
  const timers = h.clock.pending;
  void h.game.save('s1');
  await settle();
  const holding = h.clock.pending - timers;
  await h.game.exitToStories();
  expect([holding, h.clock.pending - timers, h.exits()]).toEqual([1, 0, 1]);
  h.game.dispose();
});

test('game: a late answer of an earlier manual save replaces a held conflict ask', async () => {
  const h = harness();
  await startManor(h);
  await h.game.advance(); // l002
  const inFlight = inFlightSaves(h);
  // 1. A write to s1 in flight, the save screen left and opened again (which resets `saving`), then a second to s1.
  void h.game.save('s1');
  await settle();
  const first = inFlight.get('s1');
  await h.game.openSaves();
  const timers = h.clock.pending;
  void h.game.save('s1');
  await settle();
  const second = inFlight.get('s1');
  if (first === undefined || second === undefined || first === second) {
    throw new Error('both manual writes to s1 should be in flight');
  }
  // 2. The second write's 409 lands inside its double-tap window, so its ask is held; then the first write lands.
  second.answer(conflictOn('s1', second.w));
  await settle();
  const holding = h.clock.pending - timers;
  first.answer({ ok: true, value: { rev: 1, savedAt: 1 } });
  await settle();
  // 3. The slot's newer answer replaces its held ask at once (its timer goes), and the ask never shows.
  const afterAnswer = h.clock.pending - timers;
  h.clock.advance(CONFLICT_HOLD_MS);
  expect([holding, afterAnswer, h.vm.saves.saving, h.vm.saves.conflict]).toEqual([1, 0, null, null]);
  h.game.dispose();
});

/** What a manual write answers. */
type SaveAnswer = Awaited<ReturnType<SaveService['save']>>;

/** Keeps every manual write of `h` in flight until the test answers it, by slot. */
function inFlightSaves(h: Harness): Map<ManualSlot, { w: SaveWrite; answer: (r: SaveAnswer) => void }> {
  const inFlight = new Map<ManualSlot, { w: SaveWrite; answer: (r: SaveAnswer) => void }>();
  h.save().save = (slot, w) =>
    new Promise<SaveAnswer>((answer) => {
      inFlight.set(slot, { w, answer });
    });
  return inFlight;
}

/** The server's 409 for a manual write of `w` to `slot`: another device saved the slot. */
const conflictOn = (slot: ManualSlot, w: SaveWrite): SaveAnswer => ({
  ok: false,
  error: { kind: 'conflict', current: summary(MANOR, slot, w) },
});

test("game: an answer on one slot keeps another slot's held conflict ask", async () => {
  const h = harness();
  await startManor(h);
  await h.game.advance(); // l002
  const inFlight = inFlightSaves(h);
  // 1. s1's write in flight, the save screen left and opened again (which resets `saving`), then s2's write.
  void h.game.save('s1');
  await settle();
  await h.game.openSaves();
  void h.game.save('s2');
  await settle();
  const s1 = inFlight.get('s1');
  const s2 = inFlight.get('s2');
  if (s1 === undefined || s2 === undefined) {
    throw new Error('both manual writes should be in flight');
  }
  // 2. s2 answers 409 inside the double-tap window, so its ask is held; then s1's earlier write lands.
  s2.answer(conflictOn('s2', s2.w));
  await settle();
  s1.answer({ ok: true, value: { rev: 1, savedAt: 1 } });
  await settle();
  // 3. s1's answer is s1's alone (RULINGS 101): s2's refused write still asks when its window closes.
  h.clock.advance(CONFLICT_HOLD_MS);
  expect([h.vm.saves.saving, h.vm.saves.conflict, h.clock.pending]).toEqual([null, 's2', 0]);
  h.game.dispose();
});

test("game: no on one slot's conflict ask keeps another slot's held ask", async () => {
  const h = harness();
  await startManor(h);
  await h.game.advance(); // l002
  const inFlight = inFlightSaves(h);
  // 1. s1's write in flight, the save screen left and opened again, then s2's write 50 ms before s1's window closes.
  void h.game.save('s1');
  await settle();
  await h.game.openSaves();
  h.clock.advance(CONFLICT_HOLD_MS - 50);
  void h.game.save('s2');
  await settle();
  const s1 = inFlight.get('s1');
  const s2 = inFlight.get('s2');
  if (s1 === undefined || s2 === undefined) {
    throw new Error('both manual writes should be in flight');
  }
  // 2. s1's 409 asks when its window closes; s2's 409 lands 60 ms after its tap, so its ask is held under s1's.
  s1.answer(conflictOn('s1', s1.w));
  await settle();
  h.clock.advance(50);
  const shown = h.vm.saves.conflict;
  h.clock.advance(10);
  s2.answer(conflictOn('s2', s2.w));
  await settle();
  // 3. No on s1's ask is s1's alone (RULINGS 101): s2's held ask shows when its own window closes.
  h.game.cancelOverwrite();
  h.clock.advance(CONFLICT_HOLD_MS);
  expect([shown, h.vm.saves.conflict, h.clock.pending]).toEqual(['s1', 's2', 0]);
  // 4. The 409s in the reverse order of their taps (critique O1): s2's lands first and is held, s1's asks at once.
  // s2's ask, coming later, never displaces the one shown; No on s1 then shows s2.
  await h.game.openSaves();
  void h.game.save('s1');
  await settle();
  await h.game.openSaves();
  h.clock.advance(400);
  void h.game.save('s2');
  await settle();
  const r1 = inFlight.get('s1');
  const r2 = inFlight.get('s2');
  if (r1 === undefined || r2 === undefined || r1 === s1 || r2 === s2) {
    throw new Error('both second manual writes should be in flight');
  }
  h.clock.advance(50);
  r2.answer(conflictOn('s2', r2.w));
  await settle();
  h.clock.advance(150);
  r1.answer(conflictOn('s1', r1.w));
  await settle();
  const first = h.vm.saves.conflict;
  h.clock.advance(300); // s2's window closes: its ask is asked behind s1's
  const kept = h.vm.saves.conflict;
  h.game.cancelOverwrite();
  expect([first, kept, h.vm.saves.conflict, h.vm.saves.saving, h.clock.pending]).toEqual(['s1', 's1', 's2', null, 0]);
  h.game.dispose();
});

test('game: a 409 after a round trip asks when the window since the tap closes', async () => {
  const h = harness();
  await startManor(h);
  await h.game.advance(); // l002
  const inFlight = inFlightSaves(h);
  const view = (): unknown[] => [h.vm.saves.saving, h.vm.saves.conflict];
  void h.game.save('s1');
  await settle();
  const s1 = inFlight.get('s1');
  if (s1 === undefined) {
    throw new Error('the manual write should be in flight');
  }
  // The 409 lands 300 ms after the tap: the ask is still held there, and shows at the tap's window end, not later.
  h.clock.advance(300);
  s1.answer(conflictOn('s1', s1.w));
  await settle();
  const atAnswer = view();
  h.clock.advance(CONFLICT_HOLD_MS - 300);
  expect([atAnswer, view()]).toEqual([
    ['s1', null],
    [null, 's1'],
  ]);
  h.game.dispose();
});

test('game: the hold of a 409 counts from the tap, not from the end of the step wait', async () => {
  const h = harness();
  await startManor(h);
  await h.game.advance(); // l002
  await h.game.advance(); // the choice set
  await h.game.choose(0); // l003
  conflicting(h.save());
  const view = (): unknown[] => [h.vm.saves.saving, h.vm.saves.conflict];
  const release = holdEnsure(h.scene);
  const step = h.game.advance(); // l005, garden's entry: waits on bg/garden
  await settle();
  const saving = h.game.save('s1');
  await settle();
  // The step ends 300 ms after the tap and the 409 answers at once: the ask shows at the tap's window end, the
  // double tap's second tap having been absorbed by `saving` during the wait.
  h.clock.advance(300);
  release();
  await step;
  await saving;
  await settle();
  const atAnswer = view();
  h.clock.advance(CONFLICT_HOLD_MS - 300);
  expect([atAnswer, view()]).toEqual([
    ['s1', null],
    [null, 's1'],
  ]);
  h.game.dispose();
});

test('game: a manual save with a step in flight waits for that step', async () => {
  /** A manual slot's body resumed in a fresh session: [lineId, ok, toasts, line]. */
  const resumed = async (full: SaveFull | undefined): Promise<unknown[] | null> => {
    if (full === undefined) {
      return null;
    }
    const again = harness({ slots: new Map([['auto', { ...full, summary: { ...full.summary, slot: 'auto' } }]]) });
    const ok = (await again.game.start({ kind: 'slot', story: MANOR, slot: 'auto' })).ok;
    const row = [full.summary.lineId, ok, again.vm.toasts.length, lineOf(again.vm)];
    again.game.dispose();
    return row;
  };
  const atL003 = async (h: Harness): Promise<void> => {
    await startManor(h);
    await h.game.advance(); // l002
    await h.game.advance(); // the choice set
    await h.game.choose(0); // l003
  };
  // 1. Save while l005 (garden's entry) waits on its art: the runner is at l005, the position and the stage at l003.
  const h = harness();
  await atL003(h);
  const sv = h.save();
  let release = holdEnsure(h.scene);
  let step = h.game.advance();
  await settle();
  const saving = h.game.save('s1');
  await settle();
  const during = [sv.slots.has('s1'), h.vm.saves.saving];
  expect(during).toEqual([false, 's1']);
  release();
  await step;
  await saving;
  await settle();
  const one = await resumed(sv.slots.get('s1'));
  h.game.dispose();
  // 2. The conflict's deliberate Yes in the same window.
  const h2 = harness();
  await atL003(h2);
  const sv2 = h2.save();
  conflicting(sv2);
  await h2.game.save('s2');
  h2.clock.advance(CONFLICT_HOLD_MS);
  const asked = h2.vm.saves.conflict;
  release = holdEnsure(h2.scene);
  step = h2.game.advance();
  await settle();
  const writing = h2.game.overwrite('s2');
  await settle();
  const during2 = [sv2.slots.has('s2'), h2.vm.saves.saving];
  release();
  await step;
  await writing;
  await settle();
  const two = await resumed(sv2.slots.get('s2'));
  h2.game.dispose();
  // 3. At rest in a session of two steps (a resume that failed after the chapter swap): nothing to save.
  const h3 = harness({ chapters: [manorCh1(), noIdCh2()], owned: ['ch2'] });
  await failAfterSwap(h3);
  await h3.game.save('s3');
  const three = [h3.vm.notice?.kind, h3.save().slots.has('s3'), h3.vm.saves.saving];
  h3.game.dispose();
  expect([one, asked, during2, two, three]).toEqual([
    ['ch1.garden.l005', true, 0, 'ch1.garden.l005'],
    's2',
    [false, 's2'],
    ['ch1.garden.l005', true, 0, 'ch1.garden.l005'],
    ['error', false, null],
  ]);
});

// ---------------------------------------------------------------------------------------------------------------
// LMI: the meta controller through boot's gate (META-PLAN F16, F17, M21, M27; RULINGS 105). The real gate and
// controller over the real endpoints and decoders; the meta routes answer their dto samples unless a test replaces
// one, and the chunk import and the stats settle are answered by hand.

const META_SAMPLES: unknown = JSON.parse(samplesText);

/** The raw dto sample `name[0]`, as the server sends it. */
function metaSample(name: string): unknown {
  const all = typeof META_SAMPLES === 'object' && META_SAMPLES !== null ? (META_SAMPLES as Record<string, unknown>) : {};
  const list = Object.hasOwn(all, name) ? all[name] : undefined;
  const s = Array.isArray(list) ? (list[0] as unknown) : undefined;
  if (s === undefined) {
    throw new Error(`dto-samples.json has no ${name}[0]`);
  }
  return s;
}

type MetaWire = { ok: true; body: unknown } | { ok: false; error: ApiError };
type MetaModule = typeof import('./meta.ts');

const CARD_ROUTE = /^POST \/api\/stories\/[^/]+\/card$/;
const HINT_ROUTE = /^POST \/api\/puzzles\/[^/]+\/hints\/\d+$/;
const WALLET_ROUTE = /^GET \/api\/wallet$/;
const META_ROUTES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^GET \/api\/social$/, 'SocialResponse'],
  [WALLET_ROUTE, 'WalletResponse'],
  [/^GET \/api\/stats$/, 'StatsResponse'],
  [CARD_ROUTE, 'CardResponse'],
  [HINT_ROUTE, 'HintUseResponse'],
];
const serverError = (status: number, code: 'internal' | 'insufficient_balance'): MetaWire => ({
  ok: false,
  error: { kind: 'http', status, code, body: null, retryAfter: null },
});

const META_TG = {
  supportsShareMessage: () => false,
  shareMessage: () => Promise.resolve({ ok: true, value: undefined }),
  openTelegramLink: () => ({ ok: true, value: undefined }),
  openLink: () => ({ ok: true, value: undefined }),
  startParam: () => null,
  openInvoice: () => Promise.resolve({ ok: true, value: 'cancelled' }),
} satisfies MetaDeps['tg'];

type MetaRig = {
  gate: MetaGate;
  /** `METHOD path` of every meta request, in order. */
  sent: string[];
  /** `match`'s answer from now on; a promise holds the request until it settles. */
  on(match: RegExp, answer: () => MetaWire | Promise<MetaWire>): void;
  /** Every settle's options, in order. */
  settles: Array<{ timeoutMs: number }>;
  /** Answers every pending settle 'drained'. */
  drain(): void;
  loads(): number;
  made(): number;
  /** The import in flight lands with the real module. */
  land(): Promise<void>;
  /** The import in flight fails. */
  fail(): Promise<void>;
  /** How often the gate or the controller asked Home to redraw its card buttons. */
  cards(): number;
  /** How often the controller loaded the overlays' chunk. */
  uiLoads(): number;
  /** The endpoints over the rig's http: boot's own stats read is made through them (LFL B1). */
  api: Endpoints;
};

/**
 * Boot's gate over the harness's view model and stack, wired as boot.ts wires it (its `make` and `note`); Telegram's
 * invoice sheet closes as `openInvoice` says ('cancelled' by default).
 */
function metaRig(
  h: Harness,
  bind: (gate: MetaGate) => void = () => {},
  openInvoice: MetaDeps['tg']['openInvoice'] = META_TG.openInvoice,
): MetaRig {
  const sent: string[] = [];
  const own: Array<readonly [RegExp, () => MetaWire | Promise<MetaWire>]> = [];
  const http: Pick<Http, 'request'> = {
    request: async <T>(r: ApiRequest, decode: Decoder<T>): Promise<Result<T, ApiError>> => {
      const label = `${r.method} ${r.path.split('?')[0] ?? r.path}`;
      sent.push(label);
      const mine = own.find(([m]) => m.test(label));
      const sample = META_ROUTES.find(([m]) => m.test(label));
      let wire: MetaWire;
      if (mine !== undefined) {
        wire = await mine[1]();
      } else if (sample !== undefined) {
        wire = { ok: true, body: metaSample(sample[1]) };
      } else {
        throw new Error(`no answer for ${label}`);
      }
      if (!wire.ok) {
        return { ok: false, error: wire.error };
      }
      const d = decode(wire.body);
      return d.ok ? d : { ok: false, error: { kind: 'decode', detail: d.error } };
    },
  };
  const settles: Array<{ timeoutMs: number }> = [];
  const waiting: Array<(v: 'drained' | 'timeout') => void> = [];
  let loads = 0;
  let made = 0;
  let cards = 0;
  let uiLoads = 0;
  let flight: { resolve: (m: MetaModule) => void; reject: (e: unknown) => void } | null = null;
  const api = createEndpoints(http);
  const redraw = (): void => {
    cards += 1;
  };
  const gate = createMetaGate({
    load: () => {
      loads += 1;
      return new Promise<MetaModule>((resolve, reject) => {
        flight = { resolve, reject };
      });
    },
    root: () => h.screens.view().root,
    make: (m, stats) => {
      made += 1;
      const c = m.createMetaController({
        meta: createMetaEndpoints(http),
        api,
        stats: () => stats ?? api.getStats(),
        tg: { ...META_TG, openInvoice },
        screens: h.screens,
        vm: h.vm,
        reporter: {
          settle: (o) => {
            settles.push(o);
            return new Promise((resolve) => waiting.push(resolve));
          },
        },
        storyTitle: () => null,
        clock: h.clock,
        newId: () => 'id-1',
        host: 'example.test',
        onCards: redraw,
        // The overlays are never rendered here: the controller only hands the module to App.svelte.
        loadUi: () => {
          uiLoads += 1;
          return Promise.resolve({} as MetaUi);
        },
      });
      c.boot();
      return c;
    },
    note: (key) => h.vm.showToast({ kind: 'note', key, message: key, sticky: false }),
    onCards: redraw,
    clock: h.clock,
  });
  bind(gate);
  return {
    gate,
    sent,
    on: (match, answer) => {
      own.unshift([match, answer]);
    },
    settles,
    drain: () => {
      for (const resolve of waiting.splice(0)) {
        resolve('drained');
      }
    },
    loads: () => loads,
    made: () => made,
    land: async () => {
      const m = await import('./meta.ts');
      flight?.resolve(m);
      await settle();
    },
    fail: async () => {
      flight?.reject(new Error('offline'));
      await settle();
    },
    cards: () => cards,
    uiLoads: () => uiLoads,
    api,
  };
}

/** A tide harness whose screens reach the gate's controller, as boot's `onView` does, with the gate attached. */
function metaHarness(o: HarnessOptions = {}, openInvoice?: MetaDeps['tg']['openInvoice']): { h: Harness; m: MetaRig } {
  let gate: MetaGate | null = null;
  const h = harness({ chapters: [tideCh3()], ...o, onView: (v) => gate?.current()?.screensChanged(v) });
  const m = metaRig(
    h,
    (g) => {
      gate = g;
    },
    openInvoice,
  );
  h.game.attachMeta(m.gate.port);
  return { h, m };
}

/** Tide ch3 to its declared ending (drowned): the end notice. */
async function drowned(h: Harness): Promise<void> {
  expect((await h.game.start({ kind: 'new', story: TIDE, chapter: CH3 })).ok).toBe(true);
  await h.game.advance();
  await h.game.choose(1);
  await h.game.advance(); // END
  await settle();
  expect(h.vm.notice?.kind).toBe('the_end');
}

const overlayKinds = (h: Harness): string[] => h.vm.screens.overlays.map((x) => x.kind);
const toastKeys = (h: Harness): string[] => h.vm.toasts.map((x) => x.key);
const cardPosts = (m: MetaRig): string[] => m.sent.filter((x) => CARD_ROUTE.test(x));

/** The end's card action; the test fails without one. */
function cardAction(h: Harness): () => void {
  const n = h.vm.notice;
  if (n?.kind !== 'the_end' || n.oncard === undefined) {
    throw new Error('the end has no card action');
  }
  return n.oncard;
}

test('game: ending settles stats then opens the card', async () => {
  const { h, m } = metaHarness();
  void m.gate.ready();
  await m.land();
  await drowned(h);
  // The end shows with its card action; the card waits for the ending's event to reach the server (F16).
  expect(typeof cardAction(h)).toBe('function');
  expect(m.settles).toEqual([{ timeoutMs: 3000 }]);
  expect(cardPosts(m)).toEqual([]);
  m.drain();
  await settle();
  expect(cardPosts(m)).toEqual(['POST /api/stories/tide/card']);
  expect(overlayKinds(h)).toEqual(['card']);
  expect(h.vm.meta?.card?.story).toBe(TIDE);
  expect(h.vm.screens.root.kind).toBe('notice');
  h.game.dispose();
  m.gate.dispose();
});

test('game: card failure keeps the end', async () => {
  // (a) The card POST fails: the end stays under the toast, and its card action asks again.
  const { h, m } = metaHarness();
  void m.gate.ready();
  await m.land();
  m.on(CARD_ROUTE, () => serverError(500, 'internal'));
  await drowned(h);
  m.drain();
  await settle();
  expect([h.vm.screens.root.kind, h.vm.notice?.kind, overlayKinds(h), toastKeys(h)]).toEqual(['notice', 'the_end', [], ['meta.card_later']]);
  h.vm.dismissToast('meta.card_later');
  m.on(CARD_ROUTE, () => ({ ok: true, body: metaSample('CardResponse') }));
  cardAction(h)();
  await settle();
  m.drain();
  await settle();
  expect(overlayKinds(h)).toEqual(['card']);
  h.game.dispose();
  m.gate.dispose();

  // (b) The meta chunk does not load: a non-tap trigger's import (the session's first step) fails silently, the
  // ending's own import fails with the toast, and the end's card action imports again.
  const b = metaHarness();
  void b.m.gate.ready();
  await b.m.fail();
  expect([b.m.loads(), toastKeys(b.h)]).toEqual([1, []]);
  await drowned(b.h);
  expect(b.m.loads()).toBe(2);
  await b.m.fail();
  expect([b.h.vm.screens.root.kind, b.h.vm.notice?.kind, overlayKinds(b.h), toastKeys(b.h)]).toEqual(['notice', 'the_end', [], ['meta.card_later']]);
  cardAction(b.h)();
  expect(b.m.loads()).toBe(3);
  await b.m.land();
  b.m.drain();
  await settle();
  expect([cardPosts(b.m), overlayKinds(b.h)]).toEqual([['POST /api/stories/tide/card'], ['card']]);
  b.h.game.dispose();
  b.m.gate.dispose();
});

test('game: an ending while the meta chunk loads gets its card', async () => {
  const { h, m } = metaHarness();
  void m.gate.ready(); // a non-tap trigger's import (the session's first step), still in flight at the end
  await drowned(h);
  expect(typeof cardAction(h)).toBe('function');
  expect([m.loads(), m.made(), cardPosts(m), m.settles]).toEqual([1, 0, [], []]);
  await m.land();
  expect(m.settles).toEqual([{ timeoutMs: 3000 }]);
  m.drain();
  await settle();
  expect([cardPosts(m), overlayKinds(h)]).toEqual([['POST /api/stories/tide/card'], ['card']]);
  h.game.dispose();
  m.gate.dispose();
});

test('game: puzzle hints use the attached port', async () => {
  const w = worldChunks();
  const status: PuzzleStatus = { puzzleId: 'ch1.drawer', solved: false, hints: [{ tier: 1, unlocked: false, text: null }], valueRun: null };
  const { h, m } = metaHarness({ chapters: [worldCh1('puzzle')], chunks: w.chunks, status: () => Promise.resolve({ ok: true, value: status }) });
  m.on(WALLET_ROUTE, () => ({ ok: true, body: { balances: [{ kind: 'hint', balance: 3, debt: 0 }], packs: [], hintTierCost: 1, maxPerGift: 3 } }));
  void m.gate.ready();
  await m.land();
  await startManor(h);
  await h.game.advance(); // l002, the cabinet
  await h.game.advance(); // the puzzle yield
  await settle();
  h.game.puzzleActions.onhint();
  await settle();
  // The wallet's port: its cost and balance are the server's.
  expect(h.puzzle.ladder?.wallet).toEqual({ cost: 1, balance: 3 });
  expect(h.puzzle.ladder?.tiers.map((x) => x.state)).toEqual(['usable']);

  // Not enough on the server: the session asks the port for more, which opens the wallet; Get more opens it too.
  m.on(HINT_ROUTE, () => serverError(409, 'insufficient_balance'));
  h.game.puzzleActions.onusehint(1);
  await settle();
  expect(overlayKinds(h)).toEqual(['hints', 'wallet']);
  expect(h.puzzle.ladder).toMatchObject({ busy: false, failed: false });
  h.screens.back();
  h.game.puzzleActions.ongetmore();
  await settle();
  expect(overlayKinds(h)).toEqual(['hints', 'wallet']);
  h.screens.back();

  // A use in flight: a second Use is answered `busy` and writes nothing; the first use's answer is the ladder.
  let release: (w: MetaWire) => void = () => {};
  m.on(HINT_ROUTE, () => new Promise<MetaWire>((resolve) => (release = resolve)));
  h.game.puzzleActions.onusehint(1);
  expect(h.puzzle.ladder?.busy).toBe(true);
  h.game.puzzleActions.onusehint(1);
  await settle();
  expect(h.puzzle.ladder?.busy).toBe(true);
  release({ ok: true, body: metaSample('HintUseResponse') });
  await settle();
  expect(m.sent.filter((x) => HINT_ROUTE.test(x))).toEqual(['POST /api/puzzles/ch1.drawer/hints/1', 'POST /api/puzzles/ch1.drawer/hints/1']);
  expect(h.puzzle.ladder).toEqual({
    tiers: [{ tier: 1, text: 'Look under the rug.', state: 'unlocked' }],
    wallet: { cost: 1, balance: 2 },
    busy: false,
    failed: false,
  });
  h.game.dispose();
  m.gate.dispose();
});

test('game: exit closes the meta overlays', async () => {
  // (a) The card is asked for, then the player leaves the end: its late answer pushes nothing.
  const { h, m } = metaHarness();
  void m.gate.ready();
  await m.land();
  let release: (w: MetaWire) => void = () => {};
  m.on(CARD_ROUTE, () => new Promise<MetaWire>((resolve) => (release = resolve)));
  await drowned(h);
  m.drain();
  await settle();
  expect(cardPosts(m)).toEqual(['POST /api/stories/tide/card']);
  await h.game.exitToStories();
  release({ ok: true, body: metaSample('CardResponse') });
  await settle();
  expect([h.exits(), overlayKinds(h)]).toEqual([1, []]);
  h.game.dispose();
  m.gate.dispose();

  // (b) The ending waits on the import, and the player leaves before it lands: no card is asked for at all.
  const b = metaHarness();
  void b.m.gate.ready();
  await drowned(b.h);
  await b.h.game.exitToStories();
  await b.m.land();
  b.m.drain();
  await settle();
  expect([b.m.made(), b.m.settles, cardPosts(b.m), overlayKinds(b.h)]).toEqual([1, [], [], []]);
  b.h.game.dispose();
  b.m.gate.dispose();
});

test('boot: an ending left before the meta chunk lands still marks its card', async () => {
  const { h, m } = metaHarness();
  // The stats read stays unanswered, so only this session's ending can give tide its card (the sample has none).
  m.on(/^GET \/api\/stats$/, () => new Promise<MetaWire>(() => {}));
  void m.gate.ready(); // a non-tap trigger's import (the session's first step), still in flight at the end
  await drowned(h);
  await h.game.exitToStories(); // the end is left before the chunk lands
  await m.land();
  m.drain();
  await settle();
  // LMI critique O3: no card is asked for, but the ending was reached in this session, so Home's card button shows.
  expect([m.gate.current()?.hasCard(TIDE), m.cards(), m.settles, cardPosts(m)]).toEqual([true, 1, [], []]);
  h.game.dispose();
  m.gate.dispose();
});

const statsGets = (m: MetaRig): string[] => m.sent.filter((x) => x === 'GET /api/stats');

test("boot: Home card buttons from boot's stats before the meta chunk", async () => {
  // LFL B1: boot hands the gate its own stats read after auth; Home's card buttons need no controller chunk.
  const { h, m } = metaHarness();
  m.gate.stats(m.api.getStats());
  await settle();
  // StatsResponse[0]: manor has its endings, tide none.
  expect([m.gate.hasCard(MANOR), m.gate.hasCard(TIDE), m.cards(), m.loads()]).toEqual([true, false, 1, 0]);
  // The chunk lands: the controller answers from now on (an ending of this session, which boot's read lacks), and it
  // was handed the same read, so the page made one stats GET in all.
  void m.gate.ready();
  await m.land();
  m.gate.current()?.endingReached(TIDE);
  expect([m.gate.hasCard(MANOR), m.gate.hasCard(TIDE), m.made(), statsGets(m)]).toEqual([true, true, 1, ['GET /api/stats']]);
  h.game.dispose();
  m.gate.dispose();
});

test('game: a presented step tells the meta port', async () => {
  // LFL T1: the controller's chunk is asked for once the session's first step is on screen, never before (RULINGS 149,
  // W2): while the first batch's images load, nothing is requested.
  const { h, m } = metaHarness();
  const release = holdEnsure(h.scene);
  const started = h.game.start({ kind: 'new', story: TIDE, chapter: CH3 });
  await settle();
  expect([lineOf(h.vm), m.loads()], 'the first batch still loads: no step, no import').toEqual([null, 0]);
  release();
  expect((await started).ok).toBe(true);
  expect([lineOf(h.vm), m.loads()]).toEqual(['ch3.shore.l001', 1]);
  // A later step joins the import already made.
  await h.game.advance();
  await settle();
  expect([h.vm.choices === null, m.loads()]).toEqual([false, 1]);
  h.game.dispose();
  m.gate.dispose();
});

test('game: a continue into a pending paid start asks for the meta chunk at its paywall', async () => {
  // LFL fix_r1 I1: D11's paywall over the empty stage is the session's first screen and no step follows it, so the
  // chunk is asked for there as at a step; the paywall's Terms -> policy link then opens on its first tap.
  const { h, m } = metaHarness({ chapters: [manorCh1(), manorCh2()], slots: new Map([['auto', pendingCh2()]]) });
  expect((await h.game.start({ kind: 'slot', story: MANOR, slot: 'auto' })).ok).toBe(true);
  expect([h.vm.screens.root.kind, overlayKinds(h), m.loads()]).toEqual(['game', ['paywall'], 1]);
  await m.land();
  const taps: string[] = [];
  m.gate.tap(() => taps.push('policy'), { inTask: true });
  expect([m.made(), taps]).toEqual([1, ['policy']]);
  h.game.dispose();
  m.gate.dispose();
});

/** The gate over a load the test settles by hand, and a controller stub the gate only hands out and disposes. */
function bareGate(o: { root?: () => object; clock?: FakeClock } = {}): {
  gate: MetaGate;
  flights: Array<{ resolve: (m: MetaModule) => void; reject: (e: unknown) => void }>;
  loads(): number;
  runs: string[];
} {
  const flights: Array<{ resolve: (m: MetaModule) => void; reject: (e: unknown) => void }> = [];
  const runs: string[] = [];
  let loads = 0;
  const gate = createMetaGate({
    load: () => {
      loads += 1;
      return new Promise<MetaModule>((resolve, reject) => flights.push({ resolve, reject }));
    },
    make: () => ({ dispose: () => {} }) as MetaController,
    note: () => {},
    root: o.root ?? (() => ROOT),
    onCards: () => {},
    clock: o.clock ?? new FakeClock(),
  });
  return { gate, flights, loads: () => loads, runs };
}

test('boot: the meta chunk waits for the first step', async () => {
  const g = bareGate();
  expect(g.loads(), 'nothing is imported when the gate is made').toBe(0);
  g.gate.port.stepShown();
  g.gate.port.stepShown();
  expect(g.loads(), 'the first step imports once').toBe(1);
  g.flights.shift()?.reject(new Error('offline'));
  await settle();
  // RULINGS 105: a failed import is never retried by a step; a tap imports again.
  g.gate.port.stepShown();
  expect(g.loads(), 'a step after the failure').toBe(1);
  g.gate.tap(() => g.runs.push('friends'));
  expect(g.loads(), 'a tap after the failure').toBe(2);
  g.gate.dispose();
});

test('boot: a line shown before the meta chunk lands prefetches the overlays', async () => {
  const { h, m } = metaHarness();
  m.gate.port.lineShown(); // the first line revealed while the chunk is still on its way
  void m.gate.ready();
  await m.land();
  expect(m.uiLoads(), "the overlays' chunk, fetched once the controller is in").toBe(1);
  m.gate.port.lineShown();
  expect(m.uiLoads(), 'once per page').toBe(1);
  h.game.dispose();
  m.gate.dispose();
});

test('boot: the hint port waits for the meta chunk', async () => {
  const drawer = puzzleId(CH1, 'drawer' as PuzzleLocalId);
  const { h, m } = metaHarness();
  m.on(WALLET_ROUTE, () => ({ ok: true, body: { balances: [{ kind: 'hint', balance: 3, debt: 0 }], packs: [], hintTierCost: 1, maxPerGift: 3 } }));
  // Before the chunk: a port all the same, its cost and balance unknown (the ladder hides Use and Get more).
  const port = m.gate.port.hintPort();
  expect(port).not.toBeNull();
  if (port === null) {
    return;
  }
  expect([port.balance(), port.tierCost(), m.loads()]).toEqual([null, null, 1]);
  // A use waits for the chunk, then spends through the controller's wallet port: one POST.
  const used = port.use(drawer, 1, 'ru');
  await m.land();
  expect(await used).toEqual({ ok: true, value: { text: 'Look under the rug.', balance: 2 } });
  expect([m.sent.filter((x) => HINT_ROUTE.test(x)), port.tierCost(), port.balance()]).toEqual([['POST /api/puzzles/ch1.drawer/hints/1'], 1, 2]);
  // Get more opens the wallet.
  port.getMore();
  await settle();
  expect(overlayKinds(h)).toEqual(['wallet']);
  h.game.dispose();
  m.gate.dispose();

  // The chunk does not load: the use answers `network` (the session shows its hint failure).
  const b = metaHarness();
  const offline = b.m.gate.port.hintPort();
  const failed = offline?.use(drawer, 1, 'ru');
  await b.m.fail();
  expect(await failed).toEqual({ ok: false, error: { kind: 'network' } });
  b.h.game.dispose();
  b.m.gate.dispose();
});

test('boot: Home idle imports the meta chunk once the engine is in', async () => {
  // LFL T5: HOME_IDLE_MS after both Home and the engine import settled, and only while that Home is still the root.
  const clock = new FakeClock();
  let root: object = { kind: 'home' };
  const g = bareGate({ root: () => root, clock });
  // 1. Home alone, however long: the engine is not in, so a Start tap may still be on its way.
  g.gate.homeShown();
  clock.advance(HOME_IDLE_MS);
  expect(g.loads(), 'Home without the engine').toBe(0);
  // 2. The engine settles: the wait counts from it.
  g.gate.engineSettled();
  clock.advance(HOME_IDLE_MS - 1);
  expect(g.loads(), 'one ms short').toBe(0);
  clock.advance(1);
  expect(g.loads(), 'Home idle').toBe(1);
  g.gate.dispose();

  // 3. The root changes before the wait ends (a Start tap): nothing, however long.
  const left = bareGate({ root: () => root, clock });
  left.gate.homeShown();
  left.gate.engineSettled();
  clock.advance(HOME_IDLE_MS - 1);
  root = { kind: 'game' };
  clock.advance(LONG_WAIT_MS);
  expect(left.loads(), 'Home left').toBe(0);
  left.gate.dispose();

  // 4. Home shown again (a new root) restarts the wait; 5. a failed idle import arms no timer again.
  root = { kind: 'home' };
  const again = bareGate({ root: () => root, clock });
  again.gate.engineSettled();
  again.gate.homeShown();
  clock.advance(HOME_IDLE_MS - 500);
  root = { kind: 'home' };
  again.gate.homeShown();
  clock.advance(HOME_IDLE_MS - 1);
  expect(again.loads(), 'the wait restarted at the second Home').toBe(0);
  clock.advance(1);
  expect(again.loads(), 'the second Home idle').toBe(1);
  again.flights.shift()?.reject(new Error('offline'));
  await settle();
  again.gate.homeShown();
  again.gate.engineSettled();
  expect(clock.pending, 'no timer after a failed import').toBe(0);
  clock.advance(LONG_WAIT_MS);
  expect(again.loads()).toBe(1);
  again.gate.dispose();
});

test('boot: a launch parameter imports the meta chunk at boot', () => {
  // LFL T4: an invite's prompt shows over the first Home, so its launch imports at once; no parameter, no import.
  const invited = bareGate();
  invited.gate.launched('fCODE');
  expect(invited.loads()).toBe(1);
  invited.gate.dispose();
  const plain = bareGate();
  plain.gate.launched(null);
  expect(plain.loads()).toBe(0);
  plain.gate.dispose();
});

/** Longer than any retry timer a gate could hide (RULINGS 105: never on a timer). */
const LONG_WAIT_MS = 10 * 60_000;
/** A root that never changes: the gate's waiting taps all run. */
const ROOT = Object.freeze({ kind: 'home' });
/** The global timers as a gate's clock: under `vi.useFakeTimers` a gate timer is one the test counts and runs. */
const PAGE_TIMERS: Pick<Clock, 'setTimeout' | 'clearTimeout'> = {
  setTimeout: (fn, ms) => Number(setTimeout(fn, ms)),
  clearTimeout: (id) => clearTimeout(id),
};

test('boot: a waiting meta tap is dropped when the root changes', async () => {
  const module = await import('./meta.ts');
  const ctl = { dispose: () => {} } as MetaController;
  const flights: Array<{ resolve: (m: MetaModule) => void; reject: (e: unknown) => void }> = [];
  const notes: string[] = [];
  const runs: string[] = [];
  let root: object = { kind: 'home' };
  const gateOf = (): MetaGate =>
    createMetaGate({
      load: () => new Promise<MetaModule>((resolve, reject) => flights.push({ resolve, reject })),
      make: () => ctl,
      note: (key) => notes.push(key),
      root: () => root,
      onCards: () => {},
      clock: new FakeClock(),
    });
  // 1. A Friends tap waits on the chunk while the player goes Home -> a story -> Home: another root (identity, not
  // kind), so the tap is dropped when the chunk lands, with no toast; the chunk stays in for the next tap.
  const gate = gateOf();
  gate.tap(() => runs.push('friends'));
  root = { kind: 'home' };
  flights.shift()?.resolve(module);
  await settle();
  expect([runs, notes, gate.current()]).toEqual([[], [], ctl]);
  // 2. The root unchanged: the waiting taps run, an in-task one still only imports (F28).
  const kept = gateOf();
  kept.tap(() => runs.push('friends'));
  kept.tap(() => runs.push('policy'), { inTask: true });
  flights.shift()?.resolve(module);
  await settle();
  expect(runs).toEqual(['friends']);
  // 3. A failed import under another root: nothing to tell; the player tapped on a screen that is gone.
  const failed = gateOf();
  failed.tap(() => runs.push('wallet'));
  root = { kind: 'game' };
  flights.shift()?.reject(new Error('offline'));
  await settle();
  expect([runs, notes]).toEqual([['friends'], []]);
  gate.dispose();
  kept.dispose();
  failed.dispose();
});

test('boot: meta chunk import retried by the next tap, single flight', async () => {
  const module = await import('./meta.ts');
  // Fake timers from here on (the dynamic import above is real): a re-import on any timer shows as a second `load`.
  vi.useFakeTimers();
  try {
    // The gate only hands the controller out and disposes it: nothing else here calls into it.
    let ended = 0;
    const ctl = {
      dispose: () => {
        ended += 1;
      },
    } as MetaController;
    const flights: Array<{ resolve: (m: MetaModule) => void; reject: (e: unknown) => void }> = [];
    let loads = 0;
    let made = 0;
    const notes: string[] = [];
    const runs: string[] = [];
    const gate = createMetaGate({
      load: () => {
        loads += 1;
        return new Promise<MetaModule>((resolve, reject) => flights.push({ resolve, reject }));
      },
      make: () => {
        made += 1;
        return ctl;
      },
      note: (key) => notes.push(key),
      root: () => ROOT,
      onCards: () => {},
      clock: PAGE_TIMERS,
    });
    // A non-tap trigger's import (the session's first step, a launch parameter, Home idle) fails silently, and nothing
    // imports again without a tap, however long the page stays open.
    void gate.ready();
    flights.shift()?.reject(new Error('offline'));
    await settle();
    await vi.advanceTimersByTimeAsync(LONG_WAIT_MS);
    expect([loads, notes, gate.current()]).toEqual([1, [], null]);
    expect(vi.getTimerCount(), 'no timer left to import again').toBe(0);
    // A tap imports again; its failure shows the toast, and again nothing imports until the next tap.
    gate.tap(() => runs.push('friends'));
    expect(loads).toBe(2);
    flights.shift()?.reject(new Error('offline'));
    await settle();
    await vi.advanceTimersByTimeAsync(LONG_WAIT_MS);
    expect([runs, notes]).toEqual([[], ['meta.action_failed']]);
    expect([loads, vi.getTimerCount()], 'no retry after a failed tap without another tap').toEqual([2, 0]);
    // A tap that must run in its own task (the policy link, F28) only imports before the chunk; two taps join it.
    gate.tap(() => runs.push('policy'), { inTask: true });
    gate.tap(() => runs.push('friends'));
    gate.tap(() => runs.push('wallet'));
    expect(loads).toBe(3);
    flights.shift()?.resolve(module);
    await settle();
    expect([runs, made, gate.current()]).toEqual([['friends', 'wallet'], 1, ctl]);
    // With the controller in, every tap runs at once, inside the tap.
    gate.tap(() => runs.push('policy'), { inTask: true });
    gate.tap(() => runs.push('card'));
    expect(runs).toEqual(['friends', 'wallet', 'policy', 'card']);
    expect([loads, made]).toEqual([3, 1]);
    gate.dispose();
    gate.tap(() => runs.push('after'));
    expect([ended, gate.current(), runs.length]).toEqual([1, null, 4]);

    // Disposed before the chunk lands: no controller is made, and a waiting ending or tap shows nothing (critique O4).
    const late = createMetaGate({
      load: () => new Promise<MetaModule>((resolve, reject) => flights.push({ resolve, reject })),
      make: () => {
        made += 1;
        return ctl;
      },
      note: (key) => notes.push(key),
      root: () => ROOT,
      onCards: () => {},
      clock: PAGE_TIMERS,
    });
    void late.ready();
    const ending = late.port.onEnding(TIDE);
    late.tap(() => runs.push('late'));
    late.dispose();
    flights.shift()?.resolve(module);
    await ending;
    await settle();
    expect([made, late.current(), runs.length, notes]).toEqual([1, null, 4, ['meta.action_failed']]);
  } finally {
    vi.useRealTimers();
  }
});

// ---------------------------------------------------------------------------------------------------------------
// LBI D5-D6: a deploy under the open page; the reload into the new build at a safe point, and the latch

/** A build the server serves after a deploy, other than this page's. */
const SKEW = 'ffffffffffffffff';
/** A Mini App URL as Telegram opens it: the launch params in the fragment, percent-encoded twice over. */
const HREF =
  'https://app.example/?v=1#tgWebAppData=query_id%3DAAH1%26user%3D%257B%2522id%2522%253A1001%257D%26hash%3D0123abcd' +
  '&tgWebAppVersion=9.6&tgWebAppThemeParams=%7B%22bg_color%22%3A%22%2317212b%22%7D';

/** Boot's port over a fake `location`: each reload is recorded, and the page's URL becomes the reloaded one. */
function fakePage(href = HREF): ReloadPort & { readonly reloads: string[] } {
  const reloads: string[] = [];
  let now = href;
  return {
    reloads,
    href: () => now,
    reload: (url) => {
      reloads.push(url);
      now = url;
    },
  };
}

/** `ms` of the fake clock in 100 ms steps, the fakes' answers settling between them. */
async function pass(h: Harness, ms: number): Promise<void> {
  for (let left = ms; left > 0; left -= 100) {
    h.clock.advance(Math.min(100, left));
    await settle();
  }
}

/** The meta overlays' view as the controller writes it; the recovery reads only `purchase`, `purchaseLeft` and `gift.busy`. */
function metaView(o: Partial<MetaView> = {}): MetaView {
  return {
    ui: null,
    card: null,
    social: null,
    profile: null,
    wallet: null,
    purchase: { kind: 'idle' },
    purchaseLeft: false,
    invite: null,
    gift: null,
    busy: { social: false, consent: false, invite: false, wallet: false },
    ...o,
  };
}

type GiftView = NonNullable<MetaView['gift']>;
const giftView = (busy: boolean): GiftView => ({
  friend: { handle: 'f1' as GiftView['friend']['handle'], firstName: 'Аня' },
  kind: 'hint' as GiftView['kind'],
  balance: 3,
  maxAmount: null,
  error: null,
  busy,
});

test('game: skew reloads at a safe point with the step autosaved', async () => {
  const h = harness();
  await startManor(h);
  await h.game.advance(); // l002
  let flushed: (v: 'saved' | 'pending') => void = () => {};
  h.save().flush = () =>
    new Promise((resolve) => {
      flushed = resolve;
    });
  const page = fakePage();
  const before = h.save().autosaves.length;
  h.game.skewed(SKEW, page);
  // Nothing inside the response path that reported it: the safe point is looked for in a timer task.
  expect([h.save().autosaves.length, h.vm.notice, page.reloads]).toEqual([before, null, []]);
  h.clock.advance(0);
  await settle();
  // In that task: the autosave of the line on screen, then the update notice as the root over every control.
  expect(h.save().autosaves.slice(before).map((w) => w.lineId)).toEqual(['ch1.arrival.l002']);
  expect([h.vm.notice?.kind, h.vm.screens.root.kind, h.vm.screens.overlays]).toEqual(['update', 'notice', []]);
  expect(page.reloads, 'no reload before the flush settles').toEqual([]);
  flushed('saved');
  await settle();
  expect(page.reloads).toEqual([`${HREF}&novelReloadedFor=${SKEW}`]);
  // One recovery per page: a later skew signal starts no second one.
  h.game.skewed('eeeeeeeeeeeeeeee', page);
  await pass(h, 2000);
  expect(page.reloads).toHaveLength(1);
  h.game.dispose();
});

test('game: skew waits for an open invoice', async () => {
  let open: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  const h = harness({ chapters: [manorCh1(), manorCh2()], invoice: ['pending'], invoiceGate: gate });
  await playManorCh1(h);
  await h.game.advance(); // END: ch2's pending start and the paywall
  h.game.buy();
  await settle();
  expect(h.vm.paywall?.state.kind).toBe('sheet');
  const page = fakePage();
  h.game.skewed(SKEW, page);
  await pass(h, 3000);
  expect([page.reloads, h.vm.notice], 'the sheet is open').toEqual([[], null]);
  open(); // Telegram closes the sheet: pending
  await settle();
  expect(h.vm.paywall?.state.kind).toBe('confirming');
  await pass(h, 5000);
  expect([page.reloads, h.vm.notice], 'the order is being confirmed').toEqual([[], null]);
  // Critique W1: the window ends with the payment still unconfirmed; the paywall shows Check again, never Buy.
  await pass(h, PENDING_WINDOW_MS);
  expect(h.vm.paywall?.state.kind).toBe('delayed');
  await pass(h, 5000);
  expect([page.reloads, h.vm.notice], 'the payment is delayed').toEqual([[], null]);
  h.owned.add('ch2'); // the webhook's grant lands on the server
  h.game.checkAgain();
  await settle();
  await settle();
  expect(lineOf(h.vm)).toBe('ch2.study.l001');
  await pass(h, 1000);
  // After the unlock and the chapter's start: one reload, from the new chapter's first line.
  expect(page.reloads).toHaveLength(1);
  expect(h.save().autosaves.at(-1)?.lineId).toBe('ch2.study.l001');
  h.game.dispose();
});

test("game: skew waits for a puzzle attempt's answer", async () => {
  const held = heldAttempt();
  const w = worldChunks();
  const h = harness({ chapters: [worldCh1('puzzle')], chunks: w.chunks, attempt: held.attempt });
  await startManor(h);
  await h.game.advance(); // l002, the cabinet
  await h.game.advance(); // the puzzle yield
  await settle();
  h.game.puzzleActions.ontry(); // an attempt in flight
  expect(held.sent()).toBe(1);
  const page = fakePage();
  h.game.skewed(SKEW, page);
  await pass(h, 3000);
  expect([page.reloads, h.vm.notice], 'the attempt awaits its answer').toEqual([[], null]);
  held.answer({ ok: true, value: { correct: true, solved: true, attemptsLeft: null, spent: false } });
  await settle();
  await pass(h, 1000);
  // The answer's outcome ran as an intent to its end first: the reload's autosave is past the puzzle.
  expect(page.reloads).toHaveLength(1);
  expect(h.save().autosaves.at(-1)?.lineId).toBe('ch1.after.l003');
  h.game.dispose();
});

test('game: skew waits for a manual save and a gift in flight', async () => {
  const h = harness();
  await startManor(h);
  await h.game.advance(); // l002
  const inFlight = inFlightSaves(h);
  void h.game.save('s1');
  await settle();
  expect(h.vm.saves.saving).toBe('s1');
  const page = fakePage();
  h.game.skewed(SKEW, page);
  await pass(h, 2000);
  expect([page.reloads, h.vm.notice], 'the manual save is in flight').toEqual([[], null]);
  h.vm.meta = metaView({ gift: giftView(true) }); // a gift sent from the friends overlay meanwhile
  inFlight.get('s1')?.answer({ ok: true, value: { rev: 1, savedAt: 1 } });
  await settle();
  expect(h.vm.saves.saving).toBeNull();
  await pass(h, 2000);
  expect([page.reloads, h.vm.notice], 'the gift is in flight').toEqual([[], null]);
  h.vm.meta = metaView({ gift: giftView(false) });
  await pass(h, 1000);
  expect(page.reloads).toHaveLength(1);
  h.game.dispose();
});

test('game: skew waits while the app is in the background', async () => {
  const h = harness();
  await startManor(h);
  h.game.onLifecycle('deactivated');
  const page = fakePage();
  h.game.skewed(SKEW, page);
  await pass(h, 3000);
  expect([page.reloads, h.vm.notice], 'deactivated').toEqual([[], null]);
  h.game.onLifecycle('activated');
  await pass(h, 1000);
  expect(page.reloads).toHaveLength(1);
  expect(h.vm.notice?.kind).toBe('update');
  h.game.dispose();
});

test("game: skew waits for the wallet's purchase", async () => {
  const h = harness(); // Home: no session to autosave
  const page = fakePage();
  const open: PurchaseState[] = [
    { kind: 'requesting' },
    { kind: 'sheet', orderId: 'o1' as OrderId },
    { kind: 'confirming', orderId: 'o1' as OrderId, since: 0 },
    { kind: 'delayed', orderId: 'o1' as OrderId },
  ];
  h.vm.meta = metaView({ purchase: open[0] });
  h.game.skewed(SKEW, page);
  for (const purchase of open) {
    h.vm.meta = metaView({ purchase });
    await pass(h, 2000);
    expect([page.reloads, h.vm.notice], purchase.kind).toEqual([[], null]);
  }
  h.vm.meta = metaView({ purchase: { kind: 'unlocked', product: 'pack:hints' as ProductId } });
  await pass(h, 1000);
  expect(page.reloads).toEqual([`${HREF}&novelReloadedFor=${SKEW}`]);
  h.game.dispose();
});

const PACK_ID = 'pack:hint_s' as ProductId;

/**
 * LRB: Home with the real meta controller and screens, the wallet open and a pack's Buy tapped until the flow reads
 * `kind`; the invoice is created, Telegram's sheet closes as `sheet` says, and every order poll reads `checkout` (the
 * webhook is not in yet). The purchase module is imported at the first Buy, so the wait runs in real macrotasks.
 */
async function packBought(
  sheet: MetaDeps['tg']['openInvoice'],
  kind: PurchaseState['kind'],
): Promise<{ h: Harness; m: MetaRig }> {
  const { h, m } = metaHarness({}, sheet);
  m.on(/^POST \/api\/invoices$/, () => ({ ok: true, body: metaSample('CreateInvoiceResponse') }));
  m.on(/^GET \/api\/orders\//, () => ({
    ok: true,
    body: { orderId: 'o_0123456789abcdef0123456789abcdef', productId: PACK_ID, status: 'checkout' },
  }));
  void m.gate.ready();
  await m.land();
  const ctl = m.gate.current();
  ctl?.openWallet();
  await settle();
  expect(overlayKinds(h)).toEqual(['wallet']);
  ctl?.buyPack(PACK_ID);
  for (let i = 0; i < 50 && h.vm.meta?.purchase.kind !== kind; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  expect(h.vm.meta?.purchase.kind).toBe(kind);
  return { h, m };
}

test('game: skew does not wait for a pack purchase delayed after the wallet closed', async () => {
  const { h, m } = await packBought(() => Promise.resolve({ ok: true, value: 'paid' }), 'confirming');
  const page = fakePage();
  h.game.skewed(SKEW, page);
  await pass(h, 2000);
  expect([page.reloads, h.vm.notice], 'confirming, the wallet open').toEqual([[], null]);
  h.screens.back(); // the player leaves the wallet
  await pass(h, 2000);
  expect([page.reloads, h.vm.notice], 'confirming, the wallet closed').toEqual([[], null]);
  // The 30 s window ends with the order still in checkout: `delayed`, nothing of it on screen.
  await pass(h, PAID_WINDOW_MS);
  expect(page.reloads).toEqual([`${HREF}&novelReloadedFor=${SKEW}`]);
  expect([h.vm.meta?.purchase.kind, h.vm.notice?.kind]).toEqual(['delayed', 'update']);
  h.game.dispose();
  m.gate.dispose();
});

test('game: skew waits for a delayed pack purchase until the wallet closes', async () => {
  const { h, m } = await packBought(() => Promise.resolve({ ok: true, value: 'paid' }), 'confirming');
  await pass(h, PAID_WINDOW_MS);
  expect([h.vm.meta?.purchase.kind, overlayKinds(h)]).toEqual(['delayed', ['wallet']]);
  const page = fakePage();
  h.game.skewed(SKEW, page);
  await pass(h, 3000);
  expect([page.reloads, h.vm.notice], 'delayed, the wallet open').toEqual([[], null]);
  h.screens.back(); // the player leaves the wallet
  await pass(h, 1000);
  expect(page.reloads).toEqual([`${HREF}&novelReloadedFor=${SKEW}`]);
  expect(h.vm.notice?.kind).toBe('update');
  h.game.dispose();
  m.gate.dispose();
});

test('game: skew waits for a pack sheet until the player leaves the wallet', async () => {
  // Telegram's sheet never answers: it is open, or its close was lost (P7).
  const { h, m } = await packBought(() => new Promise(() => {}), 'sheet');
  const page = fakePage();
  h.game.skewed(SKEW, page);
  await pass(h, 3000);
  expect([page.reloads, h.vm.notice], 'the sheet, the wallet open').toEqual([[], null]);
  h.screens.back(); // the player's Back reached the page, so the modal sheet is closed
  await pass(h, 1000);
  expect([page.reloads, h.vm.meta?.purchase.kind]).toEqual([[`${HREF}&novelReloadedFor=${SKEW}`], 'sheet']);
  h.game.dispose();
  m.gate.dispose();
});

test("game: skew latch keeps today's handling in a reloaded tab", async () => {
  const first = harness();
  await startManor(first);
  const page1 = fakePage();
  first.game.skewed(SKEW, page1);
  await pass(first, 1000);
  expect(page1.reloads).toHaveLength(1);
  first.game.dispose();
  // The reloaded tab came back on the old bundle, and the server still serves SKEW: no notice, no second reload.
  const reloaded = page1.reloads[0] ?? '';
  const h = harness();
  await startManor(h);
  const page2 = fakePage(reloaded);
  h.game.skewed(SKEW, page2);
  await pass(h, 3000);
  expect([page2.reloads, h.vm.notice, h.vm.screens.root.kind]).toEqual([[], null, 'game']);
  // A later deploy recovers once more; the latch names it now.
  h.game.skewed('eeeeeeeeeeeeeeee', page2);
  await pass(h, 1000);
  expect(page2.reloads).toEqual([`${HREF}&novelReloadedFor=eeeeeeeeeeeeeeee`]);
  h.game.dispose();
});

test('game: the latch fragment keeps the launch params', () => {
  expect(reloadedFor(HREF)).toBeNull();
  const once = withReloadedFor(HREF, SKEW);
  expect(once).toBe(`${HREF}&novelReloadedFor=${SKEW}`);
  expect(reloadedFor(once)).toBe(SKEW);
  // A second skew replaces the value; the launch params stay byte for byte, in place.
  expect(withReloadedFor(once, 'eeeeeeeeeeeeeeee')).toBe(`${HREF}&novelReloadedFor=eeeeeeeeeeeeeeee`);
  expect(withReloadedFor('https://a/#x=1&novelReloadedFor=aaaa&y=2&novelReloadedFor=bbbb', 'cccc')).toBe(
    'https://a/#x=1&novelReloadedFor=cccc&y=2',
  );
  // No fragment, or an empty one.
  expect(withReloadedFor('https://a/', SKEW)).toBe(`https://a/#novelReloadedFor=${SKEW}`);
  expect(withReloadedFor('https://a/#', SKEW)).toBe(`https://a/#novelReloadedFor=${SKEW}`);
  // Only the parameter itself, never one that merely starts with its name.
  expect(reloadedFor('https://a/#novelReloadedForX=1&tgWebAppVersion=9.6')).toBeNull();
  expect(reloadedFor(withReloadedFor('https://a/#x=1', 'a b&c'))).toBe('a b&c');
});

test('game: a chapter that fails to load probes the build id', async () => {
  const h = harness(); // ch3 is in the catalog, and no loader serves it
  await startManor(h);
  expect(h.assetUrls, 'a chapter that loads probes nothing').toEqual([]);
  await h.game.exitToStories();
  expect((await h.game.start({ kind: 'new', story: TIDE, chapter: CH3 })).ok).toBe(false);
  expect(h.vm.notice?.kind).toBe('error');
  expect(h.assetUrls).toEqual(['/api/health']);
  h.game.dispose();
});
