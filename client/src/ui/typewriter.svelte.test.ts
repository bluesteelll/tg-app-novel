// L14a in happy-dom: the time-based grapheme typewriter and the dialogue box that owns one (PROTOTYPE-PLAN
// "Localization", F2 "Tap"). Frames come from a hand-driven clock, so every frame and its cancel is counted.
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, expect, test, vi } from 'vitest';

import type { LineId } from '../story/staging.ts';
import DialogueBox from './DialogueBox.svelte';
import type { LineView } from './state.svelte.ts';
import { createTypewriter, graphemes, GRAPHEMES_PER_SECOND, type FrameClock, type TextSpeed } from './typewriter.ts';

// svelteTesting()'s auto-cleanup does not reach the `dom` project, so each test unmounts what it rendered here.
afterEach(() => cleanup());

/** requestAnimationFrame by hand: `frame(ms)` moves time on and runs the frames pending at that moment. */
class FakeFrames implements FrameClock {
  #now = 0;
  #next = 1;
  readonly #pending = new Map<number, (t: number) => void>();
  requested = 0;

  get pending(): number {
    return this.#pending.size;
  }
  now(): number {
    return this.#now;
  }
  request(cb: (t: number) => void): number {
    const id = this.#next++;
    this.#pending.set(id, cb);
    this.requested++;
    return id;
  }
  cancel(id: number): void {
    this.#pending.delete(id);
  }
  frame(ms = 16): void {
    this.#now += ms;
    const due = [...this.#pending.values()];
    this.#pending.clear();
    for (const cb of due) {
      cb(this.#now);
    }
  }
}

/** A reveal target outside the DOM: the two spans' text. */
function spans(): { shown: { textContent: string | null }; rest: { textContent: string | null } } {
  return { shown: { textContent: null }, rest: { textContent: null } };
}

const lineOf = (text: string, id = 'ch1.l1', speaker: string | null = null): LineView => ({
  lineId: id as LineId,
  speaker,
  text,
});

const LONG = 'x'.repeat(400);

function box(props: {
  line: LineView | null;
  speed?: TextSpeed;
  reducedMotion?: boolean;
  paused?: boolean;
}): {
  clock: FakeFrames;
  onadvance: ReturnType<typeof vi.fn>;
  ondone: ReturnType<typeof vi.fn>;
  shown: () => string;
  result: ReturnType<typeof render<typeof DialogueBox>>;
} {
  const clock = new FakeFrames();
  const onadvance = vi.fn();
  const ondone = vi.fn();
  const result = render(DialogueBox, {
    line: props.line,
    speed: props.speed ?? 'normal',
    reducedMotion: props.reducedMotion ?? false,
    paused: props.paused ?? false,
    lang: 'en',
    onadvance,
    ondone,
    clock,
  });
  const shown = (): string => result.container.querySelector('[data-reveal="shown"]')?.textContent ?? '';
  return { clock, onadvance, ondone, shown, result };
}

test('typewriter: graphemes intact', () => {
  // A Cyrillic letter, a ZWJ family, e + U+0301 (combining acute) and a flag: four graphemes, ten code points.
  const text = 'а👩‍👩‍👧é🇷🇺';
  const clock = new FakeFrames();
  const target = spans();
  let done = 0;
  const tw = createTypewriter(target, { clock, onDone: () => done++ });
  tw.start(text, { speed: 'slow', reducedMotion: false });
  const seen = [target.shown.textContent ?? ''];
  while (tw.running()) {
    clock.frame(8);
    seen.push(target.shown.textContent ?? '');
    expect((target.shown.textContent ?? '') + (target.rest.textContent ?? '')).toBe(text);
  }
  const boundaries = ['', 'а', 'а👩‍👩‍👧', 'а👩‍👩‍👧é', text];
  for (const prefix of seen) {
    expect(boundaries, JSON.stringify(prefix)).toContain(prefix);
  }
  expect([...new Set(seen)]).toEqual(boundaries);
  expect(graphemes(text)).toEqual(['а', '👩‍👩‍👧', 'é', '🇷🇺']);
  expect(done).toBe(1);
});

test('typewriter: speed sets graphemes per second', () => {
  for (const speed of ['slow', 'normal', 'fast'] as const) {
    const clock = new FakeFrames();
    const target = spans();
    let done = 0;
    const tw = createTypewriter(target, { clock, onDone: () => done++ });
    tw.start(LONG, { speed, reducedMotion: false });
    for (let ms = 0; ms < 1000; ms += 20) {
      clock.frame(20);
    }
    expect(target.shown.textContent?.length, speed).toBe(GRAPHEMES_PER_SECOND[speed]);
    expect([tw.running(), done]).toEqual([true, 0]);
    // The natural end fires onDone once, and no frame is left.
    while (tw.running()) {
      clock.frame(20);
    }
    expect([target.shown.textContent, target.rest.textContent, done, clock.pending]).toEqual([LONG, '', 1, 0]);
    clock.frame(20);
    expect(done).toBe(1);
  }
  expect(GRAPHEMES_PER_SECOND).toEqual({ slow: 25, normal: 45, fast: 80 });

  // Instant shows the whole line at once, with no frame, and that is the line's end.
  const clock = new FakeFrames();
  const target = spans();
  let done = 0;
  const tw = createTypewriter(target, { clock, onDone: () => done++ });
  tw.start(LONG, { speed: 'instant', reducedMotion: false });
  expect([target.shown.textContent, target.rest.textContent, tw.running(), clock.requested, done]).toEqual([
    LONG,
    '',
    false,
    0,
    1,
  ]);
});

test('typewriter: tap completes', async () => {
  const { onadvance, ondone, shown, clock, result } = box({ line: lineOf(LONG, 'ch1.l1', 'Mira') });
  clock.frame(100);
  expect(shown().length).toBe(4);
  const tap = result.getByRole('button', { name: 'Next' });
  tap.click();
  expect([shown(), onadvance.mock.calls.length, clock.pending]).toEqual([LONG, 0, 0]);
  await Promise.resolve();
  expect(ondone).toHaveBeenCalledTimes(1);
  tap.click();
  await Promise.resolve();
  expect([onadvance.mock.calls.length, ondone.mock.calls.length]).toEqual([1, 1]);
  expect(result.container.querySelector('[data-line-id="ch1.l1"]')).not.toBeNull();
});

test('typewriter: reduced motion instant', async () => {
  for (const props of [{ reducedMotion: true }, { speed: 'instant' as const }]) {
    const { clock, ondone, onadvance, shown, result } = box({ line: lineOf(LONG), ...props });
    expect([shown(), clock.requested]).toEqual([LONG, 0]);
    // The line's end is reported after the box's effect has returned, never inside it.
    expect(ondone).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(ondone).toHaveBeenCalledTimes(1);
    // Nothing to complete: the first tap advances.
    result.getByRole('button', { name: 'Next' }).click();
    expect(onadvance).toHaveBeenCalledTimes(1);
    result.unmount();
  }
});

test('typewriter: pause holds the reveal', async () => {
  const clock = new FakeFrames();
  const target = spans();
  const tw = createTypewriter(target, { clock, onDone: () => {} });
  tw.start(LONG, { speed: 'normal', reducedMotion: false });
  for (let i = 0; i < 25; i++) {
    clock.frame(20);
  }
  expect(target.shown.textContent?.length).toBe(22);
  tw.pause();
  expect([clock.pending, tw.running()]).toEqual([0, true]);
  clock.frame(5000);
  expect(target.shown.textContent?.length).toBe(22);
  tw.resume();
  clock.frame(20);
  // 500 ms + 20 ms of reveal time at 45/s: the pause is not counted.
  expect(target.shown.textContent?.length).toBe(23);

  // The box pauses with its `paused` prop (the panel left the foreground), and resumes where it stopped.
  const view = box({ line: lineOf(LONG) });
  view.clock.frame(1000);
  expect(view.shown().length).toBe(45);
  await view.result.rerender({ paused: true });
  expect(view.clock.pending).toBe(0);
  view.clock.frame(3000);
  expect(view.shown().length).toBe(45);
  await view.result.rerender({ paused: false });
  view.clock.frame(1000);
  expect(view.shown().length).toBe(90);
});

test('typewriter: a new line cancels the running reveal', async () => {
  const { clock, ondone, shown, result } = box({ line: lineOf(LONG, 'ch1.l1') });
  clock.frame(200);
  expect(shown().length).toBe(9);
  const next = 'y'.repeat(100);
  await result.rerender({ line: lineOf(next, 'ch1.l2') });
  expect(clock.pending).toBeLessThanOrEqual(1);
  expect(result.container.querySelector('[data-line-id="ch1.l2"]')).not.toBeNull();
  clock.frame(200);
  expect(shown()).toBe('y'.repeat(9));
  await Promise.resolve();
  // The first line never reported an end: it was replaced, not finished.
  expect(ondone).not.toHaveBeenCalled();
  while (shown() !== next) {
    clock.frame(100);
  }
  await Promise.resolve();
  expect([ondone.mock.calls.length, clock.pending]).toEqual([1, 0]);
});

test('typewriter: unmount cancels the frame', async () => {
  const { clock, ondone, result } = box({ line: lineOf(LONG) });
  clock.frame(100);
  expect(clock.pending).toBe(1);
  result.unmount();
  expect(clock.pending).toBe(0);
  clock.frame(60_000);
  await Promise.resolve();
  expect(ondone).not.toHaveBeenCalled();

  // A line that ended just before the unmount reports nothing afterwards either.
  const instant = box({ line: lineOf(LONG), speed: 'instant' });
  instant.result.unmount();
  await Promise.resolve();
  expect(instant.ondone).not.toHaveBeenCalled();
});

test('typewriter: line text is set as text, never markup', () => {
  const text = '<b>x</b><img src=x onerror="globalThis.hacked = 1">';
  const { shown, result } = box({ line: lineOf(text, 'ch1.l1', '<i>Mira</i>'), speed: 'instant' });
  const root = result.container;
  expect([root.querySelector('img'), root.querySelector('b'), root.querySelector('i')]).toEqual([null, null, null]);
  expect(shown()).toBe(text);
  expect(root.querySelector('[aria-live="polite"]')?.textContent).toContain(text);
  expect(root.textContent).toContain('<i>Mira</i>');
});
