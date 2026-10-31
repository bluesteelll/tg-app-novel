// L12 audio over fakes of the Web Audio and media element APIs: the unit project runs in node, which has neither.
// What only a device can show (the gesture policy, decoding, the media pipeline) is L15's, by name.
import { afterEach, expect, test, vi } from 'vitest';

import { decodeAssetManifest, type AssetFetchError, type AssetManifest, type Result } from '../story/catalog.ts';
import type { AssetId, SfxId, TrackId } from '../story/staging.ts';
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
  stops = 0;
  start(when = 0): void {
    this.starts.push(when);
  }
  stop(): void {
    this.stops += 1;
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
  /** Rejections the next play() calls return, in order. */
  readonly refusals: DOMException[] = [];
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
    const refusal = this.refusals.shift();
    if (refusal !== undefined) {
      this.paused = true;
      return Promise.reject(refusal);
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
  suspendCalls = 0;
  readonly #listeners = new Set<() => void>();
  /** What resume() does; by default the context runs at once. */
  resumeImpl = (): Promise<void> => {
    this.setState('running');
    return Promise.resolve();
  };
  constructor() {
    FakeAudioContext.instances.push(this);
  }
  /** A state change the browser makes, with its `statechange` event. */
  setState(state: AudioContextState): void {
    if (this.state !== state) {
      this.state = state;
      for (const fn of [...this.#listeners]) {
        fn();
      }
    }
  }
  addEventListener(type: string, fn: () => void): void {
    if (type === 'statechange') {
      this.#listeners.add(fn);
    }
  }
  removeEventListener(type: string, fn: () => void): void {
    if (type === 'statechange') {
      this.#listeners.delete(fn);
    }
  }
  resume(): Promise<void> {
    this.resumeCalls += 1;
    return this.resumeImpl();
  }
  suspend(): Promise<void> {
    this.suspendCalls += 1;
    this.setState('suspended');
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
  /** Reads the bytes `sfxBlob` wrote: "<frames>x<channels>". */
  decodeAudioData(data: ArrayBuffer): Promise<FakeBuffer> {
    const [length = 0, numberOfChannels = 0] = new TextDecoder().decode(data).split('x').map(Number);
    return Promise.resolve({ numberOfChannels, length, sampleRate: this.sampleRate });
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
const STORM = '/api/assets/bgm-storm-9f8e7d6c.m4a';
const WAVES = '/api/assets/bgm-waves-5e6f7a8b.m4a';
const DOOR = '/assets/sfx-door-aa11bb22.wav';
const PHONE = '/assets/sfx-phone-cc33dd44.wav';
const PHONE_ALT = '/assets/sfx-phone-99887766.wav'; // the same id under another content hash: other bytes
const STEPS = '/api/assets/sfx-steps-ee55ff66.wav';
const NUMBERED = (n: number): string => `/assets/sfx-s${n}-0000a00${n}.wav`;

function bgmEntry(url: string): unknown {
  return { kind: 'audio', role: 'bgm', durationMs: 8000, file: { url, bytes: 352_844 }, codec: url.endsWith('.wav') ? 'wav' : 'm4a' };
}

function sfxEntry(url: string): unknown {
  return { kind: 'audio', role: 'sfx', durationMs: 3000, file: { url, bytes: 99_000 }, codec: 'wav' };
}

/** A manifest built through L5's decoder, so every fixture is schema-true. */
function manifest(chapterId: string, assets: Record<string, unknown>): AssetManifest {
  const decoded = decodeAssetManifest({ chapterId, assets });
  if (!decoded.ok) {
    throw new Error(`fixture manifest: ${JSON.stringify(decoded.error)}`);
  }
  return decoded.value;
}

const CH1 = manifest('ch1', {
  'bgm/calm': bgmEntry(CALM),
  'bgm/tension': bgmEntry(TENSION),
  'bgm/storm': bgmEntry(STORM),
  'bgm/waves': bgmEntry(WAVES),
  'sfx/door': sfxEntry(DOOR),
  'sfx/phone': sfxEntry(PHONE),
  'sfx/steps': sfxEntry(STEPS),
  ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => [`sfx/s${n}`, sfxEntry(NUMBERED(n))])),
});
const CH2 = manifest('ch2', { 'bgm/calm': bgmEntry(CALM), 'sfx/phone': sfxEntry(PHONE), 'sfx/steps': sfxEntry(STEPS) });
const CH3 = manifest('ch3', { 'bgm/tension': bgmEntry(TENSION) });
const CH4 = manifest('ch4', { 'sfx/phone': sfxEntry(PHONE_ALT) });

function bgm(track: string | null, fadeMs = 1000, vol = 100): AudioCommand {
  // A fixture id: the manifests above hold it.
  return { kind: 'bgm', track: track as TrackId | null, fadeMs, vol };
}

function sfx(id: string, vol = 100): AudioCommand {
  return { kind: 'sfx', sfx: id as SfxId, vol }; // a fixture id
}

const sfxIds = (...names: string[]): AssetId[] => names.map((n) => `sfx/${n}` as AssetId); // fixture ids

/** An sfx file as the fake decoder reads it, "<frames>x<channels>": 3 s of stereo at 44.1 kHz by default. */
function sfxBlob(spec = '132300x2'): Blob {
  const bytes = new TextEncoder().encode(spec);
  // Only arrayBuffer() is read on this path; a plain object keeps it on the microtask queue that flush() drains.
  return { arrayBuffer: () => Promise.resolve(bytes.buffer) } as unknown as Blob;
}

const ok = (value: Blob): Result<Blob, AssetFetchError> => ({ ok: true, value });
const calm = (vol: number): { track: TrackId; vol: number } => ({ track: 'calm' as TrackId, vol }); // a fixture id

/** Lets every settled promise chain run (no timers move). */
async function flush(): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    await Promise.resolve();
  }
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

test('bgm_revokes_blob_urls', async () => {
  vi.useFakeTimers();
  const created = vi.spyOn(URL, 'createObjectURL');
  const revoked = vi.spyOn(URL, 'revokeObjectURL');
  const createdUrls = (): string[] => created.mock.results.map((r) => String(r.value));
  const revokedUrls = (): string[] => revoked.mock.calls.map((c) => c[0]);
  const { ctx, fetch, audio } = setup();
  audio.setChapter(CH1);
  const a = deck(ctx, 0);
  // (a) A gated track: fetchAsset with a signal, one object URL, the deck plays it.
  audio.apply([bgm('storm')], { instant: false });
  const storm = at(fetch.calls, 0);
  expect(storm.url).toBe(STORM);
  expect(storm.signal.aborted).toBe(false);
  storm.settle(ok(new Blob(['storm'])));
  await flush();
  expect(createdUrls().length).toBe(1);
  const stormUrl = at(createdUrls(), 0);
  expect(a.el.srcWrites).toEqual([stormUrl]);
  // (b) Replaced by a public track: revoked once its fade has released the deck.
  audio.apply([bgm('calm', 1000)], { instant: false });
  await vi.advanceTimersByTimeAsync(999);
  expect(revokedUrls()).toEqual([]);
  await vi.advanceTimersByTimeAsync(1);
  expect(revokedUrls()).toEqual([stormUrl]);
  expect(a.el.attr).toBeNull();
  // (c) A gated track, then stop: revoked when its fade-out ends.
  audio.apply([bgm('waves')], { instant: false });
  at(fetch.calls, 1).settle(ok(new Blob(['waves'])));
  await flush();
  const wavesUrl = at(createdUrls(), 1);
  audio.apply([bgm(null, 500)], { instant: false });
  await vi.advanceTimersByTimeAsync(499);
  expect(revokedUrls()).toEqual([stormUrl]);
  await vi.advanceTimersByTimeAsync(1);
  expect(revokedUrls()).toEqual([stormUrl, wavesUrl]);
  await vi.advanceTimersByTimeAsync(1000); // the calm deck's own fade-out ends too
  // (d) Superseded while loading: the request is aborted, and its late result creates no URL.
  audio.apply([bgm('storm')], { instant: false });
  const late = at(fetch.calls, 2);
  audio.apply([bgm('calm')], { instant: false });
  expect(late.signal.aborted).toBe(true);
  late.settle(ok(new Blob(['late'])));
  await flush();
  expect(createdUrls()).toEqual([stormUrl, wavesUrl]);
  expect(revokedUrls()).toEqual([stormUrl, wavesUrl]); // every URL created is revoked, once
});

test('bgm: same track new vol tweens without restart', async () => {
  vi.useFakeTimers();
  const { ctx, audio } = setup();
  audio.setChapter(CH1);
  audio.apply([bgm('calm')], { instant: false });
  const a = deck(ctx, 0);
  const b = deck(ctx, 1);
  ctx.currentTime = 5;
  audio.apply([bgm('calm', 1000, 50)], { instant: false });
  expect(a.el.srcWrites.length + b.el.srcWrites.length).toBe(1);
  expect(a.el.plays + b.el.plays).toBe(1);
  expect(a.gain.ops.slice(-3)).toEqual([
    { op: 'cancel', t: 5 },
    { op: 'set', v: 1, t: 5 },
    { op: 'ramp', v: 0.5, t: 6 },
  ]);
  // Back to a track that is still fading out: revived from its level, with no new src.
  ctx.currentTime = 10;
  audio.apply([bgm('tension', 2000)], { instant: false });
  ctx.currentTime = 11;
  audio.apply([bgm('calm', 1000)], { instant: false });
  expect(a.gain.ops.slice(-3)).toEqual([
    { op: 'cancel', t: 11 },
    { op: 'set', v: 0.25, t: 11 },
    { op: 'ramp', v: 1, t: 12 },
  ]);
  expect(b.gain.ops.slice(-3)).toEqual([
    { op: 'cancel', t: 11 },
    { op: 'set', v: 0.5, t: 11 },
    { op: 'ramp', v: 0, t: 12 },
  ]);
  expect(a.el.srcWrites).toEqual([CALM]);
  await vi.advanceTimersByTimeAsync(2000);
  expect(a.el.attr).toBe(CALM);
  expect(a.el.paused).toBe(false);
  expect(b.el.attr).toBeNull();
  expect(audio.currentBgm()).toEqual({ track: 'calm', vol: 100 });
});

test('bgm: restore is instant; currentBgm is the logical track', () => {
  vi.useFakeTimers();
  const { ctx, fetch, audio } = setup();
  audio.setChapter(CH1);
  audio.apply([bgm('storm', 1000, 80)], { instant: false });
  expect(audio.currentBgm()).toEqual({ track: 'storm', vol: 80 });
  ctx.currentTime = 3;
  audio.restore(calm(60));
  const a = deck(ctx, 0);
  expect(at(fetch.calls, 0).signal.aborted).toBe(true);
  expect(a.el.srcWrites).toEqual([CALM]);
  expect(a.gain.ops).toEqual([
    { op: 'cancel', t: 3 },
    { op: 'set', v: 0.6, t: 3 },
  ]);
  expect(vi.getTimerCount()).toBe(0);
  expect(audio.currentBgm()).toEqual({ track: 'calm', vol: 60 });
  audio.restore(calm(30));
  expect(a.el.srcWrites.length).toBe(1);
  expect(a.gain.ops.slice(-1)).toEqual([{ op: 'set', v: 0.3, t: 3 }]);
  audio.restore(null);
  expect(a.el.attr).toBeNull();
  expect(a.el.paused).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
  expect(audio.currentBgm()).toBeNull();
  // A track the manifest does not hold stops the music.
  audio.restore(calm(40));
  audio.restore({ track: 'nosuch' as TrackId, vol: 40 }); // a fixture id the manifest lacks
  expect(a.el.attr).toBeNull();
  expect(audio.currentBgm()).toBeNull();
});

test('bgm: commands during a gated load keep the audible track', async () => {
  vi.useFakeTimers();
  const { ctx, fetch, audio } = setup();
  audio.setChapter(CH1);
  audio.apply([bgm('calm', 0)], { instant: false });
  const a = deck(ctx, 0);
  const b = deck(ctx, 1);
  const opsBeforeLoad = a.gain.ops.length;
  ctx.currentTime = 10;
  audio.apply([bgm('storm')], { instant: false }); // B loads; A keeps calm at its level
  expect(a.gain.ops.length).toBe(opsBeforeLoad);
  expect(a.el.paused).toBe(false);
  // Back to the audible track during the load: revived, with no new src and no new download.
  ctx.currentTime = 11;
  audio.apply([bgm('calm', 1000, 60)], { instant: false });
  expect(a.el.srcWrites).toEqual([CALM]);
  expect(at(fetch.calls, 0).signal.aborted).toBe(true);
  expect(fetch.calls.length).toBe(1);
  expect(a.gain.ops.slice(-3)).toEqual([
    { op: 'cancel', t: 11 },
    { op: 'set', v: 1, t: 11 },
    { op: 'ramp', v: 0.6, t: 12 },
  ]);
  expect(b.el.plays).toBe(0);
  // Another track during a load: the load is replaced; the audible track keeps its level.
  ctx.currentTime = 20;
  audio.apply([bgm('storm')], { instant: false });
  const opsAt20 = a.gain.ops.length;
  ctx.currentTime = 21;
  audio.apply([bgm('waves')], { instant: false });
  expect(at(fetch.calls, 1).signal.aborted).toBe(true);
  expect(at(fetch.calls, 2).url).toBe(WAVES);
  expect(a.el.paused).toBe(false);
  expect(a.el.attr).toBe(CALM);
  expect(a.gain.ops.length).toBe(opsAt20);
  // Stop during a load: the load is dropped and the audible track fades out.
  ctx.currentTime = 22;
  audio.apply([bgm(null, 1500)], { instant: false });
  expect(at(fetch.calls, 2).signal.aborted).toBe(true);
  expect(a.gain.ops.slice(-3)).toEqual([
    { op: 'cancel', t: 22 },
    { op: 'set', v: 0.6, t: 22 },
    { op: 'ramp', v: 0, t: 23.5 },
  ]);
  expect(audio.currentBgm()).toBeNull();
  await vi.advanceTimersByTimeAsync(1500);
  expect(a.el.attr).toBeNull();
  // A restore of a track that is still fading out revives it at once.
  ctx.currentTime = 30;
  audio.apply([bgm('calm', 0)], { instant: false });
  ctx.currentTime = 31;
  audio.apply([bgm('tension', 2000)], { instant: false });
  audio.restore(calm(80));
  expect(a.el.srcWrites).toEqual([CALM, CALM]);
  expect(a.gain.ops.slice(-2)).toEqual([
    { op: 'cancel', t: 31 },
    { op: 'set', v: 0.8, t: 31 },
  ]);
  expect(b.el.attr).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});

test('sfx_cache_cap', async () => {
  const { ctx, fetch, audio } = setup();
  audio.setChapter(CH1);
  audio.preload(sfxIds('s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9'));
  for (const c of fetch.calls) {
    c.settle(ok(sfxBlob()));
  }
  await flush();
  expect(audio.stats().decodedBytes).toBe(7_408_800);
  expect(audio.stats().decodedBytes).toBeLessThanOrEqual(8_388_608);
  // s1 and s2, the least recently used, were evicted: s3 plays from the cache, s1 is fetched again.
  audio.apply([sfx('s3')], { instant: false });
  expect(fetch.calls.length).toBe(9);
  audio.apply([sfx('s1')], { instant: false });
  expect(fetch.calls.filter((c) => c.url === NUMBERED(1)).length).toBe(2);
  expect(ctx.sources.length).toBe(1);
});

test('sfx_cache_released_on_chapter', async () => {
  const { fetch, audio } = setup();
  audio.setChapter(CH1);
  audio.preload(sfxIds('door', 'phone', 'steps'));
  at(fetch.calls, 0).settle(ok(sfxBlob()));
  at(fetch.calls, 1).settle(ok(sfxBlob()));
  await flush();
  expect(audio.stats().decodedBytes).toBe(2_116_800);
  audio.setChapter(CH3); // names none of them
  expect(audio.stats().decodedBytes).toBe(0);
  const steps = at(fetch.calls, 2);
  expect(steps.signal.aborted).toBe(true);
  steps.settle(ok(sfxBlob()));
  await flush();
  expect(audio.stats().decodedBytes).toBe(0);
});

test('audio: next-chapter sfx survives setChapter', async () => {
  const { fetch, audio } = setup();
  audio.setChapter(CH1);
  audio.apply([sfx('door'), sfx('phone')], { instant: false });
  for (const c of fetch.calls) {
    c.settle(ok(sfxBlob()));
  }
  await flush();
  audio.preload(sfxIds('phone', 'steps'), CH2); // F5: the next chapter's first knot
  audio.preload(sfxIds('phone')); // a current-chapter hint after it does not undo the next chapter's tag
  expect(fetch.calls.length).toBe(3); // phone is cached: only steps is fetched
  audio.setChapter(CH2);
  at(fetch.calls, 2).settle(ok(sfxBlob()));
  await flush();
  expect(audio.stats().decodedBytes).toBe(2_116_800); // phone and steps; door released
  audio.apply([sfx('steps')], { instant: false });
  audio.apply([sfx('phone')], { instant: false });
  expect(fetch.calls.length).toBe(3);
});

test('sfx: plays through a voice gain and disconnects on end', async () => {
  const { ctx, fetch, audio } = setup();
  audio.setChapter(CH1);
  audio.setVolumes({ master: 50, bgm: 100, sfx: 80 });
  audio.apply([sfx('door', 50)], { instant: false });
  at(fetch.calls, 0).settle(ok(sfxBlob()));
  await flush();
  expect(ctx.sources.length).toBe(1);
  const src = at(ctx.sources, 0);
  expect(product(route(ctx, src))).toBe(0.2);
  expect(src.starts).toEqual([0]);
  const voiceGain = [...src.edges][0];
  src.onended?.();
  expect(src.edges.size).toBe(0);
  expect(voiceGain?.edges.size).toBe(0);
});

test('sfx: voices capped, oldest stopped first', async () => {
  const { ctx, fetch, audio } = setup();
  audio.setChapter(CH1);
  audio.preload(sfxIds('door'));
  at(fetch.calls, 0).settle(ok(sfxBlob()));
  await flush();
  for (let i = 0; i < 9; i += 1) {
    audio.apply([sfx('door')], { instant: false });
  }
  expect(ctx.sources.filter((s) => s.edges.size > 0).length).toBe(8);
  const first = at(ctx.sources, 0);
  expect(first.stops).toBe(1);
  expect(first.edges.size).toBe(0);
  expect(ctx.sources.slice(1).map((s) => s.stops)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
});

test('sfx: late load after a newer batch is dropped', async () => {
  const { ctx, fetch, audio } = setup();
  audio.setChapter(CH1);
  // A cold one-shot that lands within its own batch plays.
  audio.apply([sfx('door')], { instant: false });
  at(fetch.calls, 0).settle(ok(sfxBlob()));
  await flush();
  expect(ctx.sources.length).toBe(1);
  // One that lands after the next batch began is cached, not played under the later line.
  audio.apply([sfx('phone')], { instant: false });
  audio.apply([], { instant: false });
  at(fetch.calls, 1).settle(ok(sfxBlob()));
  await flush();
  expect(ctx.sources.length - 1).toBe(0);
  expect(audio.stats().decodedBytes).toBe(2_116_800);
});

test('audio: setChapter fades out bgm, null releases all sfx', async () => {
  vi.useFakeTimers();
  const { ctx, fetch, audio } = setup();
  audio.setChapter(CH1);
  audio.apply([bgm('calm', 0)], { instant: false });
  const a = deck(ctx, 0);
  ctx.currentTime = 4;
  audio.setChapter(CH2);
  expect(audio.currentBgm()).toBeNull();
  expect(a.gain.ops.slice(-3)).toEqual([
    { op: 'cancel', t: 4 },
    { op: 'set', v: 1, t: 4 },
    { op: 'ramp', v: 0, t: 5 },
  ]);
  await vi.advanceTimersByTimeAsync(999);
  expect(a.el.attr).toBe(CALM);
  await vi.advanceTimersByTimeAsync(1);
  expect(a.el.attr).toBeNull();
  // A load in the same chapter: setChapter, then a restore of the track still fading out revives it.
  audio.apply([bgm('calm', 0)], { instant: false });
  ctx.currentTime = 6;
  audio.setChapter(CH2);
  audio.restore(calm(100));
  expect(a.el.srcWrites).toEqual([CALM, CALM]);
  expect(a.gain.ops.slice(-2)).toEqual([
    { op: 'cancel', t: 6 },
    { op: 'set', v: 1, t: 6 },
  ]);
  expect(vi.getTimerCount()).toBe(0);
  // No chapter: every sfx is released, the one in flight aborted, and later commands resolve nothing.
  audio.preload(sfxIds('phone', 'steps'));
  at(fetch.calls, 0).settle(ok(sfxBlob()));
  await flush();
  expect(audio.stats().decodedBytes).toBe(1_058_400);
  audio.setChapter(null);
  expect(audio.stats().decodedBytes).toBe(0);
  expect(at(fetch.calls, 1).signal.aborted).toBe(true);
  audio.apply([bgm('calm'), sfx('door')], { instant: false });
  expect(fetch.calls.length).toBe(2);
  expect(audio.currentBgm()).toBeNull();
});

const notAllowed = (): DOMException => new DOMException('play() needs a user gesture', 'NotAllowedError');

/** resume()'s result once it settles, read without awaiting it. */
function outcome(audio: ReturnType<typeof createAudioManager>): { value?: string } {
  const box: { value?: string } = {};
  void audio.resume().then((r) => {
    box.value = r;
  });
  return box;
}

test('audio: suspend pauses decks, stops voices, completes fades', async () => {
  vi.useFakeTimers();
  const { ctx, fetch, audio } = setup();
  audio.setChapter(CH1);
  audio.apply([bgm('calm', 0)], { instant: false });
  ctx.currentTime = 10;
  audio.apply([bgm('tension', 2000, 80)], { instant: false }); // mid-crossfade from here
  audio.apply([sfx('door')], { instant: false });
  at(fetch.calls, 0).settle(ok(sfxBlob()));
  await flush();
  const voice = at(ctx.sources, 0);
  const a = deck(ctx, 0);
  const b = deck(ctx, 1);
  ctx.currentTime = 11;
  audio.suspend();
  expect(ctx.suspendCalls).toBe(1);
  expect(b.el.paused).toBe(true);
  expect(a.el.attr).toBeNull(); // the deck fading out is released
  expect(b.gain.ops.slice(-2)).toEqual([
    { op: 'cancel', t: 11 },
    { op: 'set', v: 0.8, t: 11 },
  ]);
  expect(voice.stops).toBe(1);
  expect(voice.edges.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  // While suspended: one-shots are dropped; music changes deck without playing, and its fades are cuts.
  audio.apply([sfx('door')], { instant: false });
  expect(ctx.sources.length).toBe(1);
  const playsBefore = a.el.plays;
  audio.apply([bgm('storm')], { instant: false });
  at(fetch.calls, 1).settle(ok(new Blob(['storm'])));
  await flush();
  expect(a.el.attr).not.toBeNull(); // the gated track landed on A
  expect(a.el.plays).toBe(playsBefore); // and was not played: the panel is hidden
  expect(b.el.attr).toBeNull(); // the deck that waited for it is cut, not faded
  expect(vi.getTimerCount()).toBe(0);
});

test('audio: resume reports needs-gesture when the context stays suspended', async () => {
  vi.useFakeTimers();
  const { ctx, audio } = setup();
  // resume() settles, yet the context stays suspended.
  ctx.state = 'suspended';
  ctx.resumeImpl = () => Promise.resolve();
  const settledButOff = outcome(audio);
  await flush();
  expect(settledButOff.value).toBe('needs-gesture');
  // resume() never settles: pending through the grace, needs-gesture at its end; the same for iOS 'interrupted'.
  for (const state of ['suspended', 'interrupted'] as const) {
    ctx.state = state;
    ctx.resumeImpl = () => new Promise<void>(() => undefined);
    const hung = outcome(audio);
    await vi.advanceTimersByTimeAsync(499);
    expect(hung.value).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(hung.value).toBe('needs-gesture');
  }
  // A context that runs: settled at once, with no time advanced.
  ctx.resumeImpl = () => {
    ctx.setState('running');
    return Promise.resolve();
  };
  const runs = outcome(audio);
  await flush();
  expect(runs.value).toBe('running');
});

test('audio: resume plays the active deck inside the call', async () => {
  vi.useFakeTimers();
  const { ctx, fetch, audio } = setup();
  audio.setChapter(CH1);
  audio.apply([bgm('calm', 0)], { instant: false });
  const a = deck(ctx, 0);
  const b = deck(ctx, 1);
  audio.suspend();
  const resumes = ctx.resumeCalls;
  const plays = a.el.plays;
  void audio.resume(); // nothing awaited: both calls happened inside resume() itself
  expect(ctx.resumeCalls).toBe(resumes + 1);
  expect(a.el.plays).toBe(plays + 1);
  await flush();
  // A deck still loading has no src: resume() plays the deck that sounds, never the loading one, and reports running.
  audio.apply([bgm('storm')], { instant: false });
  expect(at(fetch.calls, 0).url).toBe(STORM);
  audio.suspend();
  const resumed = outcome(audio);
  expect(a.el.plays).toBe(plays + 2);
  expect(b.el.plays).toBe(0);
  await flush();
  expect(resumed.value).toBe('running');
});

test('bgm: rejected play reports needs-gesture', async () => {
  vi.useFakeTimers();
  const { ctx, audio } = setup();
  audio.setChapter(CH1);
  const calls: boolean[] = [];
  const off = audio.onNeedsGesture((needed) => calls.push(needed));
  const a = deck(ctx, 0);
  const b = deck(ctx, 1);
  // A play() refused for want of a gesture: reported once, a second refusal included.
  a.el.refusals.push(notAllowed());
  audio.apply([bgm('calm')], { instant: false });
  await flush();
  expect(calls).toEqual([true]);
  b.el.refusals.push(notAllowed());
  audio.apply([bgm('tension')], { instant: false });
  await flush();
  expect(calls).toEqual([true]);
  // resume() inside a tap plays the decks: the need ends.
  expect(await audio.resume()).toBe('running');
  expect(calls).toEqual([true, false]);
  // An abort (a pause or a new src under play()) is no refusal, and the deck keeps its track.
  await vi.advanceTimersByTimeAsync(1000);
  a.el.refusals.push(new DOMException('interrupted by a new load', 'AbortError'));
  audio.apply([bgm('calm')], { instant: false });
  await flush();
  expect(calls).toEqual([true, false]);
  expect(a.el.attr).toBe(CALM);
  // A context left off outside our own suspend(): reported once the grace is over.
  ctx.state = 'suspended';
  audio.apply([bgm('tension')], { instant: false });
  await vi.advanceTimersByTimeAsync(499);
  expect(calls).toEqual([true, false]);
  await vi.advanceTimersByTimeAsync(1);
  expect(calls).toEqual([true, false, true]);
  expect(await audio.resume()).toBe('running');
  expect(calls).toEqual([true, false, true, false]);
  // Unsubscribed: a later refusal reaches no one.
  off();
  b.el.refusals.push(notAllowed());
  audio.apply([bgm(null, 0)], { instant: false });
  audio.apply([bgm('tension', 0)], { instant: false });
  await flush();
  expect(b.el.plays).toBeGreaterThan(0);
  expect(b.el.refusals.length).toBe(0);
  expect(calls).toEqual([true, false, true, false]);
});

test('audio: needs-gesture ends when the context runs on its own', async () => {
  vi.useFakeTimers();
  const { ctx, audio } = setup();
  audio.setChapter(CH1);
  const calls: boolean[] = [];
  audio.onNeedsGesture((needed) => calls.push(needed));
  // The Start tap's resume is still in flight when the first batch arrives; it lands within the grace: no report.
  ctx.state = 'suspended';
  audio.apply([bgm('calm')], { instant: false });
  await vi.advanceTimersByTimeAsync(200);
  ctx.setState('running');
  await vi.advanceTimersByTimeAsync(500);
  expect(calls).toEqual([]);
  // Interrupted past the grace: reported; the browser lifts it and the need ends with no resume() call.
  ctx.setState('interrupted');
  audio.apply([sfx('door')], { instant: false });
  await vi.advanceTimersByTimeAsync(500);
  expect(calls).toEqual([true]);
  ctx.setState('running');
  expect(calls).toEqual([true, false]);
  // So a later refusal is reported again.
  deck(ctx, 1).el.refusals.push(notAllowed());
  audio.apply([bgm('tension')], { instant: false });
  await flush();
  expect(calls).toEqual([true, false, true]);
});

test('bgm: a failed gated load stays silent, keeps the logical track and lets go of its deck', async () => {
  vi.useFakeTimers();
  const { ctx, fetch, audio } = setup();
  audio.setChapter(CH1);
  audio.apply([bgm('calm', 0)], { instant: false });
  ctx.currentTime = 5;
  audio.apply([bgm('storm', 1000)], { instant: false });
  const a = deck(ctx, 0);
  const b = deck(ctx, 1);
  at(fetch.calls, 0).settle({ ok: false, error: { kind: 'http', status: 403 } });
  await flush();
  expect(audio.currentBgm()).toEqual({ track: 'storm', vol: 100 });
  expect(b.el.srcWrites).toEqual([]); // silent: nothing ever played on it
  // The track that waited for it fades out over the command's fade.
  expect(a.gain.ops.slice(-2)).toEqual([
    { op: 'set', v: 1, t: 5 },
    { op: 'ramp', v: 0, t: 6 },
  ]);
  await vi.advanceTimersByTimeAsync(1000);
  expect(a.el.attr).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
  // Nothing is stuck loading: the same command fetches again.
  audio.apply([bgm('storm', 1000)], { instant: false });
  expect(fetch.calls.length).toBe(2);
});

test('audio: instant (skip mode) turns every bgm fade into a cut', () => {
  vi.useFakeTimers();
  const { ctx, audio } = setup();
  audio.setChapter(CH1);
  ctx.currentTime = 3;
  audio.apply([bgm('calm', 1000)], { instant: true });
  const a = deck(ctx, 0);
  expect(a.gain.ops.slice(-2)).toEqual([
    { op: 'cancel', t: 3 },
    { op: 'set', v: 1, t: 3 },
  ]);
  audio.apply([bgm('tension', 2000)], { instant: true });
  expect(a.el.attr).toBeNull(); // the old track is released at once
  expect(vi.getTimerCount()).toBe(0);
});

test('bgm: a refusal that arrives after its deck was released is not a need', async () => {
  const { ctx, audio } = setup();
  audio.setChapter(CH1);
  const calls: boolean[] = [];
  audio.onNeedsGesture((needed) => calls.push(needed));
  const b = deck(ctx, 1);
  deck(ctx, 0).el.refusals.push(notAllowed());
  audio.apply([bgm('calm', 0)], { instant: false });
  audio.apply([bgm('tension', 0)], { instant: false }); // the same turn: deck A is released, B plays
  await flush();
  expect(calls).toEqual([]);
  expect(b.el.plays).toBe(1);
});

test('bgm: a file the element cannot play is released while the logical track stays', async () => {
  const { ctx, audio } = setup();
  audio.setChapter(CH1);
  const a = deck(ctx, 0);
  a.el.refusals.push(new DOMException('no decoder', 'NotSupportedError'));
  audio.apply([bgm('calm', 0)], { instant: false });
  await flush();
  expect(a.el.attr).toBeNull();
  expect(audio.currentBgm()).toEqual({ track: 'calm', vol: 100 });
});

test('bgm: restore ends a fade in flight at once', () => {
  vi.useFakeTimers();
  const { ctx, audio } = setup();
  audio.setChapter(CH1);
  audio.apply([bgm('calm', 0)], { instant: false });
  audio.apply([bgm('tension', 2000)], { instant: false });
  expect(vi.getTimerCount()).toBe(1);
  audio.restore({ track: 'tension' as TrackId, vol: 50 }); // a fixture id
  expect(deck(ctx, 0).el.attr).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});

test('sfx: a failed fetch or an undecodable file is forgotten so that a later play tries again', async () => {
  const { ctx, fetch, audio } = setup();
  audio.setChapter(CH1);
  audio.apply([sfx('door')], { instant: false });
  at(fetch.calls, 0).settle({ ok: false, error: { kind: 'network', detail: 'offline' } });
  await flush();
  audio.apply([sfx('door')], { instant: false });
  expect(fetch.calls.length).toBe(2);
  vi.spyOn(ctx, 'decodeAudioData').mockRejectedValueOnce(new DOMException('bad data', 'EncodingError'));
  at(fetch.calls, 1).settle(ok(sfxBlob()));
  await flush();
  expect(ctx.sources.length).toBe(0);
  audio.apply([sfx('door')], { instant: false });
  expect(fetch.calls.length).toBe(3);
  at(fetch.calls, 2).settle(ok(sfxBlob()));
  await flush();
  expect(ctx.sources.length).toBe(1);
  expect(audio.stats().decodedBytes).toBe(1_058_400);
});

test('audio: preload ignores music ids', () => {
  const { fetch, audio } = setup();
  audio.setChapter(CH1);
  audio.preload(['bgm/storm', 'bgm/calm', 'sfx/door'] as AssetId[]); // fixture ids
  expect(fetch.calls.map((c) => c.url)).toEqual([DOOR]);
});

test('sfx: a one-shot still loading when suspend() lands never plays', async () => {
  const { ctx, fetch, audio } = setup();
  audio.setChapter(CH1);
  audio.apply([sfx('door')], { instant: false });
  audio.suspend();
  at(fetch.calls, 0).settle(ok(sfxBlob()));
  await flush();
  expect(ctx.sources.length).toBe(0);
  expect(audio.stats().decodedBytes).toBe(1_058_400); // cached for later
});

test('sfx: the same id from another URL replaces the cached bytes', async () => {
  const { fetch, audio } = setup();
  audio.setChapter(CH1);
  audio.preload(sfxIds('phone'));
  at(fetch.calls, 0).settle(ok(sfxBlob()));
  await flush();
  audio.preload(sfxIds('phone'), CH4);
  expect(fetch.calls.map((c) => c.url)).toEqual([PHONE, PHONE_ALT]);
  at(fetch.calls, 1).settle(ok(sfxBlob()));
  await flush();
  expect(audio.stats().decodedBytes).toBe(1_058_400); // the old bytes were dropped, not kept beside the new
});

test('sfx: a cache hit refreshes the entry so that the least recently used goes first', async () => {
  const { fetch, audio } = setup();
  audio.setChapter(CH1);
  audio.preload(sfxIds('s1', 's2', 's3', 's4', 's5', 's6', 's7'));
  for (const c of fetch.calls) {
    c.settle(ok(sfxBlob()));
  }
  await flush();
  audio.apply([sfx('s1')], { instant: false }); // a hit: s1 is now the most recently used
  audio.preload(sfxIds('s8'));
  at(fetch.calls, 7).settle(ok(sfxBlob()));
  await flush();
  expect(audio.stats().decodedBytes).toBe(7_408_800); // one entry went: s2
  audio.apply([sfx('s1')], { instant: false });
  expect(fetch.calls.length).toBe(8); // s1 still cached
  audio.apply([sfx('s2')], { instant: false });
  expect(fetch.calls.length).toBe(9); // s2 was the one evicted
});

test('sfx: the entry that just decoded is never the one evicted', async () => {
  const { ctx, fetch, audio } = setup();
  audio.setChapter(CH1);
  audio.preload(sfxIds('s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'));
  for (const c of fetch.calls.slice(1)) {
    c.settle(ok(sfxBlob()));
  }
  await flush();
  at(fetch.calls, 0).settle(ok(sfxBlob())); // s1, the least recently used, decodes last and tips the cache over the cap
  await flush();
  expect(audio.stats().decodedBytes).toBe(7_408_800);
  audio.apply([sfx('s1')], { instant: false });
  expect(fetch.calls.length).toBe(8);
  expect(ctx.sources.length).toBe(1);
});

test('sfx: an aborted load that reports after its id was reloaded does not drop the reload', async () => {
  const { ctx, fetch, audio } = setup();
  audio.setChapter(CH1);
  audio.preload(sfxIds('phone')); // in flight
  audio.setChapter(CH2); // CH2 names phone, but it was not preloaded for CH2: released, its request aborted
  expect(at(fetch.calls, 0).signal.aborted).toBe(true);
  audio.apply([sfx('phone')], { instant: false }); // CH2's first batch loads it again, from the same URL
  at(fetch.calls, 0).settle({ ok: false, error: { kind: 'aborted' } }); // fetchAsset reports the abort as a value
  await flush();
  at(fetch.calls, 1).settle(ok(sfxBlob()));
  await flush();
  expect(ctx.sources.length).toBe(1);
  expect(audio.stats().decodedBytes).toBe(1_058_400);
});

test('sfx: an entry released while it decodes is never counted', async () => {
  const { ctx, fetch, audio } = setup();
  audio.setChapter(CH1);
  let finish: (b: FakeBuffer) => void = () => undefined;
  vi.spyOn(ctx, 'decodeAudioData').mockReturnValueOnce(
    new Promise<FakeBuffer>((done) => {
      finish = done;
    }),
  );
  audio.preload(sfxIds('door'));
  at(fetch.calls, 0).settle(ok(sfxBlob()));
  await flush(); // fetched; the decode is pending
  audio.setChapter(CH3); // released mid-decode
  finish({ numberOfChannels: 2, length: 132_300, sampleRate: 44_100 });
  await flush();
  expect(audio.stats().decodedBytes).toBe(0);
});

test('audio: a resume that ends needs-gesture also tells the listener', async () => {
  vi.useFakeTimers();
  const { ctx, audio } = setup();
  const calls: boolean[] = [];
  audio.onNeedsGesture((needed) => calls.push(needed));
  ctx.state = 'suspended';
  ctx.resumeImpl = () => new Promise<void>(() => undefined);
  const hung = outcome(audio);
  await vi.advanceTimersByTimeAsync(500);
  expect(hung.value).toBe('needs-gesture');
  expect(calls).toEqual([true]);
});

test('audio: resume leaves no timer behind when the context runs at once', async () => {
  vi.useFakeTimers();
  const { audio } = setup();
  expect(await audio.resume()).toBe('running');
  expect(vi.getTimerCount()).toBe(0);
});

test('sfx: one-shots queued on a stopped context never sound under a later batch', async () => {
  const { ctx, fetch, audio } = setup();
  audio.setChapter(CH1);
  audio.preload(sfxIds('door', 'phone'));
  for (const c of fetch.calls) {
    c.settle(ok(sfxBlob()));
  }
  await flush();
  // The Start tap's resume is still in flight: a one-shot of the first batch sounds once the context runs.
  ctx.state = 'suspended';
  audio.apply([sfx('door')], { instant: false });
  ctx.setState('running');
  const first = at(ctx.sources, 0);
  expect(first.stops).toBe(0);
  expect(first.edges.size).toBe(1);
  first.onended?.();
  // Off without our suspend() (the resume did not take, or iOS 'interrupted'): a voice started on the stopped clock
  // would sound only when it runs, under a later line, so the next batch stops it.
  ctx.setState('suspended');
  audio.apply([sfx('door')], { instant: false });
  audio.apply([sfx('phone')], { instant: false });
  ctx.setState('running');
  const queued = ctx.sources.slice(1);
  expect(queued.map((s) => s.stops)).toEqual([1, 0]);
  expect(queued.map((s) => s.edges.size)).toEqual([0, 1]);
});

/** A context off in `state` without our suspend(), with a one-shot of the last batch queued on its stopped clock. */
async function queuedOnStoppedClock(
  state: AudioContextState,
): Promise<{ ctx: FakeAudioContext; audio: ReturnType<typeof createAudioManager> }> {
  const { ctx, fetch, audio } = setup();
  audio.setChapter(CH1);
  audio.preload(sfxIds('door', 'phone'));
  for (const c of fetch.calls) {
    c.settle(ok(sfxBlob()));
  }
  await flush();
  ctx.setState(state);
  audio.apply([sfx('door')], { instant: false }); // source 0
  return { ctx, audio };
}

test("sfx: an iOS 'interrupted' context stops the one-shot queued on it at the next batch", async () => {
  const { ctx, audio } = await queuedOnStoppedClock('interrupted');
  audio.apply([sfx('phone')], { instant: false });
  ctx.setState('running');
  expect(ctx.sources.map((s) => s.stops)).toEqual([1, 0]);
});

test('sfx: a bgm-only batch on a stopped context stops the one-shot queued on it', async () => {
  const { ctx, audio } = await queuedOnStoppedClock('suspended');
  audio.apply([bgm('calm', 1000)], { instant: false });
  ctx.setState('running');
  expect(at(ctx.sources, 0).stops).toBe(1);
});

test('sfx: an empty batch on a stopped context stops the one-shot queued on it', async () => {
  const { ctx, audio } = await queuedOnStoppedClock('suspended');
  audio.apply([], { instant: false });
  ctx.setState('running');
  expect(at(ctx.sources, 0).stops).toBe(1);
});

test('sfx: a batch with no chapter on a stopped context stops the one-shot queued on it', async () => {
  const { ctx, audio } = await queuedOnStoppedClock('suspended');
  audio.setChapter(null); // releases the cached entries, not the voices
  audio.apply([], { instant: false });
  ctx.setState('running');
  expect(at(ctx.sources, 0).stops).toBe(1);
});

test('audio: instant (skip mode) turns a bgm stop into a cut', () => {
  vi.useFakeTimers();
  const { ctx, audio } = setup();
  audio.setChapter(CH1);
  audio.apply([bgm('calm', 0)], { instant: false });
  const a = deck(ctx, 0);
  audio.apply([bgm(null, 2000)], { instant: true });
  expect(a.el.attr).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});

test('sfx: entries that total exactly the cap all stay', async () => {
  const { fetch, audio } = setup();
  audio.setChapter(CH1);
  audio.preload(sfxIds('s1', 's2'));
  // 1,048,576 mono float32 frames: 4 MiB each, 8 MiB together.
  at(fetch.calls, 0).settle(ok(sfxBlob('1048576x1')));
  at(fetch.calls, 1).settle(ok(sfxBlob('1048576x1')));
  await flush();
  expect(audio.stats().decodedBytes).toBe(8_388_608);
});

test('audio: a resume cut short by suspend() still ends its need when the context runs', async () => {
  vi.useFakeTimers();
  const { ctx, audio } = setup();
  // The panel's chip as L15 drives it: shown on fn(true) or a 'needs-gesture' resume, hidden on fn(false).
  let chip = false;
  audio.onNeedsGesture((needed) => {
    chip = needed;
  });
  ctx.state = 'suspended';
  ctx.resumeImpl = () => new Promise<void>(() => undefined);
  const hung = outcome(audio); // activated: the context does not run
  audio.suspend(); // deactivated inside the grace
  await vi.advanceTimersByTimeAsync(500);
  expect(hung.value).toBe('needs-gesture');
  chip = true;
  ctx.resumeImpl = () => {
    ctx.setState('running');
    return Promise.resolve();
  };
  const back = outcome(audio); // activated again: the context runs
  await vi.advanceTimersByTimeAsync(0);
  expect(back.value).toBe('running');
  expect(chip).toBe(false);
});

test("audio: a resume whose deck's play() is refused ends needs-gesture though the context runs", async () => {
  vi.useFakeTimers();
  const { ctx, audio } = setup();
  audio.setChapter(CH1);
  const a = deck(ctx, 0);
  audio.apply([bgm('calm', 0)], { instant: false });
  await flush();
  audio.suspend(); // deactivated
  // Activated with no gesture: the context runs again, yet the element refuses play() (Android's
  // setMediaPlaybackRequiresUserGesture), so a caller wired to the return alone must still show the chip.
  a.el.refusals.push(notAllowed());
  const r = await audio.resume();
  expect(ctx.state).toBe('running');
  expect(a.el.refusals).toHaveLength(0); // the resume's own retry met the refusal
  expect(r).toBe('needs-gesture');
});
