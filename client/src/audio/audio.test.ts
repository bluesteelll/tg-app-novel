// L12 audio over fakes of the Web Audio and media element APIs: the unit project runs in node, which has neither.
// What only a device can show (the gesture policy, decoding, the media pipeline) is L15's, by name.
import { afterEach, expect, test, vi } from 'vitest';

import { decodeAssetManifest, type AssetFetchError, type AssetManifest, type Result } from '../story/catalog.ts';
import type { TrackId } from '../story/staging.ts';
import { createAudioManager, type AudioCommand } from './manager.ts';

type ParamOp = { op: 'cancel'; t: number } | { op: 'set'; v: number; t: number } | { op: 'ramp'; v: number; t: number };

class FakeAudioParam {
  readonly ops: ParamOp[] = [];
  /** Where the automation ends: the last scheduled or written value. */
  target: number;
  constructor(value: number) {
    this.target = value;
  }
  get value(): number {
    return this.target;
  }
  set value(v: number) {
    this.target = v;
  }
  cancelScheduledValues(t: number): this {
    this.ops.push({ op: 'cancel', t });
    return this;
  }
  setValueAtTime(v: number, t: number): this {
    this.ops.push({ op: 'set', v, t });
    this.target = v;
    return this;
  }
  linearRampToValueAtTime(v: number, t: number): this {
    this.ops.push({ op: 'ramp', v, t });
    this.target = v;
    return this;
  }
}

class FakeNode {
  readonly edges = new Set<FakeNode>();
  connect<T extends FakeNode>(to: T): T {
    this.edges.add(to);
    return to;
  }
  disconnect(): void {
    this.edges.clear();
  }
}

class FakeGain extends FakeNode {
  readonly gain = new FakeAudioParam(1);
}

type FakeBuffer = { numberOfChannels: number; length: number; sampleRate: number };

class FakeBufferSource extends FakeNode {
  buffer: FakeBuffer | null = null;
  onended: (() => void) | null = null;
  readonly starts: number[] = [];
  start(when = 0): void {
    this.starts.push(when);
  }
}

class FakeAudio {
  static readonly instances: FakeAudio[] = [];
  loop = false;
  paused = true;
  /** The src attribute; null once removed. */
  attr: string | null = null;
  readonly srcWrites: string[] = [];
  plays = 0;
  loads = 0;
  constructor() {
    FakeAudio.instances.push(this);
  }
  get src(): string {
    return this.attr ?? '';
  }
  set src(v: string) {
    this.attr = v;
    this.srcWrites.push(v);
  }
  removeAttribute(name: string): void {
    if (name === 'src') {
      this.attr = null;
    }
  }
  load(): void {
    this.loads += 1;
  }
  play(): Promise<void> {
    this.plays += 1;
    if (this.attr === null) {
      return new Promise<void>(() => undefined); // no source: the resource selection algorithm waits
    }
    this.paused = false;
    return Promise.resolve();
  }
  pause(): void {
    this.paused = true;
  }
}

class FakeMediaSource extends FakeNode {
  readonly el: FakeAudio;
  constructor(el: FakeAudio) {
    super();
    this.el = el;
  }
}

class FakeAudioContext {
  static readonly instances: FakeAudioContext[] = [];
  state: AudioContextState = 'suspended';
  currentTime = 0;
  readonly sampleRate = 44_100;
  readonly destination = new FakeNode();
  readonly nodes: FakeNode[] = [];
  readonly gains: FakeGain[] = [];
  readonly sources: FakeBufferSource[] = [];
  readonly mediaSources: FakeMediaSource[] = [];
  resumeCalls = 0;
  constructor() {
    FakeAudioContext.instances.push(this);
  }
  resume(): Promise<void> {
    this.resumeCalls += 1;
    this.state = 'running';
    return Promise.resolve();
  }
  createGain(): FakeGain {
    const g = new FakeGain();
    this.gains.push(g);
    this.nodes.push(g);
    return g;
  }
  createBufferSource(): FakeBufferSource {
    const s = new FakeBufferSource();
    this.sources.push(s);
    this.nodes.push(s);
    return s;
  }
  createBuffer(numberOfChannels: number, length: number, sampleRate: number): FakeBuffer {
    return { numberOfChannels, length, sampleRate };
  }
  createMediaElementSource(el: FakeAudio): FakeMediaSource {
    if (this.mediaSources.some((s) => s.el === el)) {
      throw new DOMException('the element already has a source node', 'InvalidStateError');
    }
    const s = new FakeMediaSource(el);
    this.mediaSources.push(s);
    this.nodes.push(s);
    return s;
  }
}

type FetchCall = { url: string; signal: AbortSignal; settle: (r: Result<Blob, AssetFetchError>) => void };

/** A FetchAsset whose every call waits until the test settles it. */
function fakeFetch(): { fn: (url: string, signal: AbortSignal) => Promise<Result<Blob, AssetFetchError>>; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fn = (url: string, signal: AbortSignal): Promise<Result<Blob, AssetFetchError>> =>
    new Promise((settle) => {
      calls.push({ url, signal, settle });
    });
  return { fn, calls };
}

const CALM = '/assets/bgm-calm-0a1b2c3d.wav';
const TENSION = '/assets/bgm-tension-1b2c3d4e.wav';

function bgmEntry(url: string): unknown {
  return { kind: 'audio', role: 'bgm', durationMs: 8000, file: { url, bytes: 352_844 }, codec: url.endsWith('.wav') ? 'wav' : 'm4a' };
}

/** A manifest built through L5's decoder, so every fixture is schema-true. */
function manifest(chapterId: string, assets: Record<string, unknown>): AssetManifest {
  const decoded = decodeAssetManifest({ chapterId, assets });
  if (!decoded.ok) {
    throw new Error(`fixture manifest: ${JSON.stringify(decoded.error)}`);
  }
  return decoded.value;
}

const CH1 = manifest('ch1', { 'bgm/calm': bgmEntry(CALM), 'bgm/tension': bgmEntry(TENSION) });

function bgm(track: string | null, fadeMs = 1000, vol = 100): AudioCommand {
  // A fixture id: the manifests above hold it.
  return { kind: 'bgm', track: track as TrackId | null, fadeMs, vol };
}

function at<T>(xs: readonly T[], i: number): T {
  const x = xs[i];
  if (x === undefined) {
    throw new Error(`fixture: no item ${i}`);
  }
  return x;
}

function setup(): { ctx: FakeAudioContext; fetch: ReturnType<typeof fakeFetch>; audio: ReturnType<typeof createAudioManager> } {
  vi.stubGlobal('Audio', FakeAudio);
  const ctx = new FakeAudioContext();
  ctx.state = 'running';
  const fetch = fakeFetch();
  // The fakes model the part of Web Audio the manager calls; this cast is the seam's one unchecked step.
  const audio = createAudioManager(ctx as unknown as AudioContext, { fetchAsset: fetch.fn });
  return { ctx, fetch, audio };
}

/** The gain nodes from `node` to the destination, or null when its path does not reach it. */
function route(ctx: FakeAudioContext, node: FakeNode): FakeGain[] | null {
  const gains: FakeGain[] = [];
  let here = node;
  for (let hop = 0; hop < 10; hop += 1) {
    if (here === ctx.destination) {
      return gains;
    }
    if (here instanceof FakeGain) {
      gains.push(here);
    }
    const next = [...here.edges];
    if (next.length !== 1 || next[0] === undefined) {
      return null;
    }
    here = next[0];
  }
  return null;
}

const product = (gains: readonly FakeGain[] | null): number => (gains ?? []).reduce((p, g) => p * g.gain.target, 1);

/** The bus gains, found by topology: master reaches the destination; the bgm bus is the one the decks feed. */
function buses(ctx: FakeAudioContext): { master?: FakeGain; bgm?: FakeGain; sfx?: FakeGain } {
  const deckGains = new Set(ctx.mediaSources.flatMap((s) => [...s.edges]));
  const own = ctx.gains.filter((g) => !deckGains.has(g));
  const master = own.find((g) => g.edges.has(ctx.destination));
  const bgmBus = own.find((g) => [...deckGains].some((d) => d.edges.has(g)));
  const sfxBus = own.find((g) => g !== master && g !== bgmBus);
  return { master, bgm: bgmBus, sfx: sfxBus };
}

/** Deck `i` (creation order): its element and its gain. */
function deck(ctx: FakeAudioContext, i: number): { el: FakeAudio; gain: FakeAudioParam } {
  const source = at(ctx.mediaSources, i);
  const node = [...source.edges][0];
  if (!(node instanceof FakeGain)) {
    throw new Error(`fixture: deck ${i} has no gain`);
  }
  return { el: source.el, gain: node.gain };
}

afterEach(() => {
  FakeAudioContext.instances.length = 0;
  FakeAudio.instances.length = 0;
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test('unlock: one context, resumed and primed in each gesture', async () => {
  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.resetModules(); // the context cache is module-private
  const { unlockAudio } = await import('./unlock.ts');
  const first = unlockAudio();
  const resumedByFirst = FakeAudioContext.instances[0]?.resumeCalls;
  const second = unlockAudio();
  expect(FakeAudioContext.instances.length).toBe(1);
  const ctx = FakeAudioContext.instances[0];
  expect(first).toBe(ctx);
  expect(second).toBe(ctx);
  // Resumed inside each call, before it returned: the gesture's own turn.
  expect(resumedByFirst).toBe(1);
  expect(ctx?.resumeCalls).toBe(2);
  expect(ctx?.sources.length).toBe(2);
  for (const primer of ctx?.sources ?? []) {
    expect(primer.buffer).toEqual({ numberOfChannels: 1, length: 1, sampleRate: 44_100 });
    expect(primer.starts).toEqual([0]);
    expect([...primer.edges]).toEqual([ctx?.destination]);
    primer.onended?.();
    expect(primer.edges.size).toBe(0);
  }
  if (ctx !== undefined) {
    ctx.state = 'closed';
  }
  const third = unlockAudio();
  expect(FakeAudioContext.instances.length).toBe(2);
  expect(third).toBe(FakeAudioContext.instances[1]);
});

test('audio: decks reach the destination through bgm and master gains', () => {
  const { ctx, audio } = setup();
  audio.setChapter(CH1);
  audio.setVolumes({ master: 50, bgm: 80, sfx: 100 });
  audio.apply([bgm('calm', 0)], { instant: false });
  expect(product(route(ctx, at(ctx.mediaSources, 0)))).toBe(0.4);
  expect(ctx.mediaSources.length).toBe(2);
  for (const source of ctx.mediaSources) {
    const gains = route(ctx, source);
    expect(gains?.length).toBe(3); // the deck's own gain, the bgm bus, master
    expect(product(gains?.slice(1) ?? null)).toBe(0.4);
  }
  const intoDestination = ctx.nodes.filter((n) => n.edges.has(ctx.destination));
  expect(intoDestination.length).toBe(1);
  expect(intoDestination[0]).toBe(buses(ctx).master);
});

test('audio: setVolumes clamps and ramps bus gains', () => {
  const { ctx, audio } = setup();
  audio.setVolumes({ master: 150, bgm: -5, sfx: Number.NaN });
  const { master, bgm: bgmBus, sfx: sfxBus } = buses(ctx);
  expect(master?.gain.target).toBe(1);
  expect(bgmBus?.gain.target).toBe(0);
  expect(sfxBus?.gain.target).toBe(0);
  for (const bus of [master, bgmBus, sfxBus]) {
    expect(bus?.gain.ops.at(-1)).toEqual({ op: 'ramp', v: bus?.gain.target, t: 0.05 });
  }
});

test('bgm_crossfade_ramps_gains', async () => {
  vi.useFakeTimers();
  const { ctx, audio } = setup();
  audio.setChapter(CH1);
  ctx.currentTime = 10;
  audio.apply([bgm('calm', 1000, 100)], { instant: false });
  const a = deck(ctx, 0);
  expect(a.gain.ops).toEqual([
    { op: 'cancel', t: 10 },
    { op: 'set', v: 0, t: 10 },
    { op: 'ramp', v: 1, t: 11 },
  ]);
  ctx.currentTime = 20;
  audio.apply([bgm('tension', 2000, 80)], { instant: false });
  const b = deck(ctx, 1);
  expect(a.gain.ops.slice(3)).toEqual([
    { op: 'cancel', t: 20 },
    { op: 'set', v: 1, t: 20 },
    { op: 'ramp', v: 0, t: 22 },
  ]);
  expect(b.gain.ops).toEqual([
    { op: 'cancel', t: 20 },
    { op: 'set', v: 0, t: 20 },
    { op: 'ramp', v: 0.8, t: 22 },
  ]);
  expect(b.el.srcWrites).toEqual([TENSION]);
  expect(b.el.plays).toBe(1);
  await vi.advanceTimersByTimeAsync(1999);
  expect(a.el.attr).toBe(CALM);
  await vi.advanceTimersByTimeAsync(1);
  expect(a.el.paused).toBe(true);
  expect(a.el.attr).toBeNull();
  expect(a.el.loads).toBe(1);
  expect(b.el.paused).toBe(false);
});

test('bgm: public track streams by url without fetchAsset', () => {
  const { ctx, fetch, audio } = setup();
  audio.setChapter(CH1);
  audio.apply([bgm('calm')], { instant: false });
  expect(fetch.calls.length).toBe(0);
  const a = deck(ctx, 0);
  expect(a.el.srcWrites).toEqual([CALM]);
  expect(a.el.plays).toBe(1);
  expect(FakeAudio.instances.map((el) => el.loop)).toEqual([true, true]);
  // One source node per element, created once.
  expect(ctx.mediaSources.map((s) => s.el)).toEqual(FakeAudio.instances);
});
