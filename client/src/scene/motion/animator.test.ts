// The face animator (lane SH7, D4): its states over a time the test moves, with the randomness fixed. Each walk visits
// every change the animator announces (`nextChangeMs`), as the render loop's discrete timer does.
import { expect, test } from 'vitest';

import { BLINK_MS, BROW_MS, TALK_MAX_MS, createFaceAnimator } from './animator.ts';
import type { FaceAnimator, FaceState } from './animator.ts';

/** A seeded generator (mulberry32): varied draws, the same on every run. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Every state the animator shows from `from` to `to`, at each change it announces (the first at `from`). */
function walk(a: FaceAnimator, from: number, to: number): Array<{ t: number; s: FaceState }> {
  const out: Array<{ t: number; s: FaceState }> = [];
  let t = from;
  while (t <= to) {
    out.push({ t, s: a.sample(t) });
    const next = a.nextChangeMs(t);
    t += Math.max(1, next);
  }
  return out;
}

test('animator: a blink runs half closed half open within its chain', () => {
  // rng 0.5: the interval is BLINK_MS x 1.0 and no blink is a double.
  const a = createFaceAnimator({ talk: [] }, () => 0.5);
  expect(a.sample(0).eyes).toBe('open');
  expect(a.nextChangeMs(0)).toBe(BLINK_MS);
  const at = (t: number): FaceState['eyes'] => a.sample(t).eyes;
  expect([at(3_999), at(4_000), at(4_049), at(4_050), at(4_119), at(4_120), at(4_169), at(4_170)]).toEqual([
    'open',
    'half',
    'half',
    'closed',
    'closed',
    'half',
    'half',
    'open',
  ]);
  // The next chain counts from the end of this one.
  expect([at(8_169), at(8_170)]).toEqual(['open', 'half']);
  // Every interval lies in BLINK_MS x [0.5, 1.5]: the shortest and the longest draws.
  const short = createFaceAnimator({ talk: [] }, () => 0.15);
  short.sample(0);
  expect(short.nextChangeMs(0)).toBe(BLINK_MS * 0.65);
  const long = createFaceAnimator({ talk: [] }, () => 0.999);
  long.sample(0);
  expect(long.nextChangeMs(0)).toBeLessThanOrEqual(BLINK_MS * 1.5);
  // A double blink (a draw under 0.1): a second chain 80 ms after the first ends.
  const twice = createFaceAnimator({ talk: [] }, () => 0.05);
  twice.sample(0);
  const first = BLINK_MS * 0.55;
  expect(twice.sample(first + 60).eyes).toBe('closed');
  expect(twice.sample(first + 170).eyes).toBe('open');
  expect(twice.nextChangeMs(first + 170)).toBe(80);
  expect(twice.sample(first + 250 + 60).eyes).toBe('closed');
  // A face held past a whole chain (frozen, covered) does not burst it: open, and the next blink counts from now.
  const held = createFaceAnimator({ talk: [] }, () => 0.5);
  held.sample(0);
  expect(held.sample(30_000).eyes).toBe('open');
  expect([held.sample(30_000 + BLINK_MS - 1).eyes, held.sample(30_000 + BLINK_MS).eyes]).toEqual(['open', 'half']);
  // Over a long walk every closed eye sits inside a half-closed-half chain.
  const states = walk(createFaceAnimator({ talk: [] }, seeded(7)), 0, 120_000)
    .map((x) => x.s.eyes)
    .filter((e, i, all) => i === 0 || e !== all[i - 1]);
  expect(states.join(',')).toMatch(/^open(,half,closed,half,open)+$/);
  expect(states.filter((e) => e === 'closed').length).toBeGreaterThan(15);
});

test('animator: flaps never repeat a mouth', () => {
  const a = createFaceAnimator({ talk: ['a', 'b'] }, seeded(11));
  // Not talking: no flap.
  expect(walk(a, 0, 5_000).every((x) => x.s.mouth === null)).toBe(true);
  a.talk(true);
  expect(a.nextChangeMs(5_000)).toBe(0);
  // Every ms: each flap shows another mouth, so no mouth holds past one flap interval (80-140 ms).
  const runs = (xs: ReadonlyArray<number | null>): Array<{ m: number | null; n: number }> =>
    xs.reduce<Array<{ m: number | null; n: number }>>((out, m) => {
      const last = out[out.length - 1];
      if (last !== undefined && last.m === m) {
        last.n += 1;
      } else {
        out.push({ m, n: 1 });
      }
      return out;
    }, []);
  const talk = Array.from({ length: 4_000 }, (_, i) => a.sample(5_000 + i).mouth);
  expect(talk[0]).not.toBeNull();
  expect(new Set(talk)).toEqual(new Set([null, 0, 1]));
  const flaps = runs(talk).slice(0, -1);
  expect(flaps.length).toBeGreaterThan(25);
  for (const r of flaps) {
    expect(r.n).toBeGreaterThanOrEqual(80);
    expect(r.n).toBeLessThanOrEqual(140);
  }
  // Stopped: the expression's own mouth at once, and no flap after.
  a.talk(false);
  expect(walk(a, 9_001, 12_000).every((x) => x.s.mouth === null)).toBe(true);
  // One talk mouth alternates with the expression's own.
  const one = createFaceAnimator({ talk: ['a'] }, seeded(3));
  one.talk(true);
  const alt = runs(Array.from({ length: 2_000 }, (_, i) => one.sample(i).mouth)).slice(0, -1);
  expect(alt.map((r) => r.m)).toEqual(alt.map((_, i) => (i % 2 === 0 ? 0 : null)));
  expect(alt.every((r) => r.n <= 140)).toBe(true);
  // A talk with no time of its own stops at TALK_MAX_MS; one with `forMs` at its end.
  const max = createFaceAnimator({ talk: ['a', 'b'] }, seeded(5));
  max.talk(true);
  max.sample(0);
  expect(walk(max, 1, TALK_MAX_MS - 1).some((x) => x.s.mouth !== null)).toBe(true);
  expect(walk(max, TALK_MAX_MS, TALK_MAX_MS + 3_000).every((x) => x.s.mouth === null)).toBe(true);
  const timed = createFaceAnimator({ talk: ['a', 'b'] }, seeded(9));
  timed.talk(true, { forMs: 1_200 });
  timed.sample(0);
  expect(walk(timed, 1_200, 4_000).every((x) => x.s.mouth === null)).toBe(true);
});

test('animator: a listener moves its brows within 1.5 x browMs', () => {
  const bound = 1.5 * BROW_MS;
  expect(bound).toBe(12_000);
  // The longest draws (0.999): the listener cue never fires, so the own clock alone moves the brows.
  const listener = createFaceAnimator({ talk: [] }, () => 0.999);
  listener.sample(0);
  listener.heard();
  const moves = (a: FaceAnimator, to: number): number[] => {
    const out: number[] = [];
    let was = false;
    for (const { t, s } of walk(a, 1, to)) {
      if (s.accent && !was) {
        out.push(t);
      }
      was = s.accent;
    }
    return out;
  };
  const heardMoves = moves(listener, 60_000);
  expect(heardMoves[0]).toBeLessThanOrEqual(bound);
  for (let i = 1; i < heardMoves.length; i += 1) {
    expect((heardMoves[i] ?? 0) - (heardMoves[i - 1] ?? 0)).toBeLessThanOrEqual(bound);
  }
  // A face that never talks and hears nothing moves on its own clock too.
  const silent = createFaceAnimator({ talk: [] }, seeded(21));
  silent.sample(0);
  const own = moves(silent, 60_000);
  expect(own[0]).toBeLessThanOrEqual(bound);
  for (let i = 1; i < own.length; i += 1) {
    expect((own[i] ?? 0) - (own[i - 1] ?? 0)).toBeLessThanOrEqual(bound);
  }
  // The move is the expression's accent for 250 ms, then back (a second face on the same draws, walked to it).
  const target = own[0] ?? 0;
  const again = createFaceAnimator({ talk: [] }, seeded(21));
  again.sample(0);
  walk(again, 1, target - 1);
  expect([again.sample(target).accent, again.sample(target + 249).accent, again.sample(target + 250).accent]).toEqual([true, true, false]);
  // The listener cue (a draw under 1/4): the accent within 150-400 ms of the next sample.
  const cued = createFaceAnimator({ talk: [] }, () => 0.2);
  cued.sample(0);
  cued.heard();
  cued.sample(100);
  expect(cued.sample(100 + 149).accent).toBe(false);
  expect(cued.sample(100 + 150 + 0.2 * 250).accent).toBe(true);
});

test('animator: think keeps the mouth still', () => {
  // rng 0: the speaker's brow draw succeeds at the talk start.
  const a = createFaceAnimator({ talk: ['a', 'b'] }, () => 0);
  a.sample(0);
  a.talk(true, { think: true });
  const first = a.sample(10);
  expect(first.mouth).toBeNull();
  expect(first.accent).toBe(true);
  const states = walk(a, 11, 15_000).map((x) => x.s);
  expect(states.every((s) => s.mouth === null)).toBe(true);
  // The eyes still blink while it thinks.
  expect(states.some((s) => s.eyes === 'closed')).toBe(true);
});
