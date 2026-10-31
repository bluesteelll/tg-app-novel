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
