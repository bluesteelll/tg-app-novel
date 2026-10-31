// L12 audio over fakes of the Web Audio and media element APIs: the unit project runs in node, which has neither.
// What only a device can show (the gesture policy, decoding, the media pipeline) is L15's, by name.
import { afterEach, expect, test, vi } from 'vitest';

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

type FakeBuffer = { numberOfChannels: number; length: number; sampleRate: number };

class FakeBufferSource extends FakeNode {
  buffer: FakeBuffer | null = null;
  onended: (() => void) | null = null;
  readonly starts: number[] = [];
  start(when = 0): void {
    this.starts.push(when);
  }
}

class FakeAudioContext {
  static readonly instances: FakeAudioContext[] = [];
  state: AudioContextState = 'suspended';
  currentTime = 0;
  readonly sampleRate = 44_100;
  readonly destination = new FakeNode();
  readonly sources: FakeBufferSource[] = [];
  resumeCalls = 0;
  constructor() {
    FakeAudioContext.instances.push(this);
  }
  resume(): Promise<void> {
    this.resumeCalls += 1;
    this.state = 'running';
    return Promise.resolve();
  }
  createBufferSource(): FakeBufferSource {
    const s = new FakeBufferSource();
    this.sources.push(s);
    return s;
  }
  createBuffer(numberOfChannels: number, length: number, sampleRate: number): FakeBuffer {
    return { numberOfChannels, length, sampleRate };
  }
}

afterEach(() => {
  FakeAudioContext.instances.length = 0;
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
