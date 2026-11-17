// The face animator (shots plan SH7, CH §6.1 rev. 3, D4): one face's blinks, brow moves and mouth flaps as discrete
// states over the render loop's clock `t` (ms, paused time excluded). Pure: no Pixi, no GSAP, no clock and no DOM of
// its own; the randomness is injected. The executor applies its states to the face's motion members, the expression's
// own `MotionSet` only (RULINGS 273 O2). The continuous formulas (breathing, sway, hair) are SH8's.

/** A blink every BLINK_MS x U(0.5, 1.5) (05a:94-98, CH's default). */
export const BLINK_MS = 4_000;
/** A brow move on the face's own clock every BROW_MS x U(0.5, 1.5), the first within BROW_MS (CH D29). */
export const BROW_MS = 8_000;
/** A talk with no time of its own stops after this long (CH D19). */
export const TALK_MAX_MS = 20_000;

/** What the face shows at a time: its eyes, its brow accent, and the talk mouth by index (null: the expression's own). */
export type FaceState = { readonly eyes: 'open' | 'half' | 'closed'; readonly accent: boolean; readonly mouth: number | null };

export type FaceAnimator = {
  /** Latched: takes effect at the next `sample`. `think`: brows as a speaker's, mouth still. */
  talk(on: boolean, o?: { readonly forMs?: number; readonly think?: boolean }): void;
  /** Latched: another character spoke (the listener cue). */
  heard(): void;
  sample(t: number): FaceState;
  /** Ms from `t` to the next state change; 0 while a latch is pending. */
  nextChangeMs(t: number): number;
};

/** The chain's phases from its start: half, closed, half, then open (CH §6.1). */
const HALF_MS = 50;
const CLOSED_MS = 70;
const CHAIN_MS = HALF_MS + CLOSED_MS + HALF_MS;
/** One blink in ten is a double: a second chain after a short open. */
const DOUBLE_P = 0.1;
const DOUBLE_GAP_MS = 80;
const FLAP_MIN_MS = 80;
const FLAP_MAX_MS = 140;
/** A brow move shows the expression's accent this long. */
const BROW_HOLD_MS = 250;
const HEARD_P = 1 / 4;
const HEARD_MIN_MS = 150;
const HEARD_MAX_MS = 400;
const SPEAKER_P = 1 / 3;

/**
 * One face's animator over its expression's set: `set.talk` are the talk mouths it can show (none: no flap). The
 * schedules start at the first call that carries a time; a scheduled change whose whole span passed unseen (the face
 * was held) is rolled again from the time of that call, so a held face never bursts its missed blinks.
 */
export function createFaceAnimator(set: { readonly talk: readonly unknown[] }, rng: () => number = Math.random): FaceAnimator {
  const mouths = set.talk.length;
  const between = (lo: number, hi: number): number => lo + (hi - lo) * rng();

  let started = false;
  // Blinks: the next (or current) chain's start, whether it is a double's first, and whether a call saw it.
  let blinkAt = 0;
  let blinkDouble = false;
  let blinkSeen = false;
  // Brows: the last move's start, the own clock's next move, and a cued move (a listener's or none).
  let browStart = Number.NEGATIVE_INFINITY;
  let browNext = 0;
  let browCue: number | null = null;
  // Talk: the mouth, the next flap and the talk's end.
  let talking = false;
  let still = false;
  let talkUntil = 0;
  let mouth: number | null = null;
  let flapAt = 0;
  // The latches, resolved at the next sample.
  let talkLatch: { readonly on: boolean; readonly forMs: number | undefined; readonly think: boolean } | null = null;
  let heardLatch = false;

  const scheduleBlink = (base: number, double: boolean): void => {
    blinkAt = base + (double ? DOUBLE_GAP_MS : BLINK_MS * between(0.5, 1.5));
    blinkDouble = !double && rng() < DOUBLE_P;
    blinkSeen = false;
  };
  const startBrow = (at: number): void => {
    browStart = at;
    browNext = at + BROW_MS * between(0.5, 1.5);
    browCue = null;
  };
  /** Another mouth than `m`: an open one, or the expression's own (null); one talk mouth alternates with null. */
  const nextMouth = (m: number | null): number | null => {
    const choices: Array<number | null> = [null, ...Array.from({ length: mouths }, (_, i) => i)].filter((x) => x !== m);
    return choices[Math.min(choices.length - 1, Math.floor(rng() * choices.length))] ?? null;
  };

  const start = (t: number): void => {
    if (!started) {
      started = true;
      scheduleBlink(t, false);
      browNext = t + BROW_MS * between(0.25, 1);
    }
  };
  const resolveLatches = (t: number): void => {
    const l = talkLatch;
    talkLatch = null;
    if (l !== null && l.on) {
      talking = true;
      still = l.think || mouths === 0;
      talkUntil = t + Math.min(l.forMs ?? TALK_MAX_MS, TALK_MAX_MS);
      mouth = still ? null : Math.min(mouths - 1, Math.floor(rng() * mouths));
      flapAt = t + between(FLAP_MIN_MS, FLAP_MAX_MS);
      if (rng() < SPEAKER_P && t >= browStart + BROW_HOLD_MS) {
        startBrow(t);
      }
    } else if (l !== null) {
      talking = false;
      mouth = null;
    }
    if (heardLatch) {
      heardLatch = false;
      if (rng() < HEARD_P) {
        browCue = t + between(HEARD_MIN_MS, HEARD_MAX_MS);
      }
    }
  };
  /** Every schedule brought to `t`. */
  const advance = (t: number): void => {
    while (t >= blinkAt + CHAIN_MS) {
      const end = blinkAt + CHAIN_MS;
      if (blinkSeen) {
        scheduleBlink(end, blinkDouble);
      } else {
        scheduleBlink(t, false);
      }
    }
    if (t >= blinkAt) {
      blinkSeen = true;
    }
    for (;;) {
      const due = Math.min(browNext, browCue ?? Number.POSITIVE_INFINITY);
      if (t < due) {
        break;
      }
      if (due < browStart + BROW_HOLD_MS) {
        // Due while a move shows: it joins that move, and the own clock counts from it.
        browCue = null;
        browNext = browStart + BROW_MS * between(0.5, 1.5);
        continue;
      }
      if (t >= due + BROW_HOLD_MS) {
        browCue = null;
        browNext = t + BROW_MS * between(0.5, 1.5);
        break;
      }
      startBrow(due);
    }
    if (talking && t >= talkUntil) {
      talking = false;
      mouth = null;
    }
    while (talking && !still && t >= flapAt) {
      if (t - flapAt > FLAP_MAX_MS) {
        flapAt = t;
      }
      mouth = nextMouth(mouth);
      flapAt += between(FLAP_MIN_MS, FLAP_MAX_MS);
    }
  };
  const eyesAt = (t: number): FaceState['eyes'] => {
    const d = t - blinkAt;
    if (d < 0 || d >= CHAIN_MS) {
      return 'open';
    }
    return d < HALF_MS || d >= HALF_MS + CLOSED_MS ? 'half' : 'closed';
  };

  return {
    talk(on, o) {
      talkLatch = { on, forMs: o?.forMs, think: o?.think === true };
    },
    heard() {
      heardLatch = true;
    },
    sample(t) {
      start(t);
      resolveLatches(t);
      advance(t);
      return { eyes: eyesAt(t), accent: t >= browStart && t < browStart + BROW_HOLD_MS, mouth };
    },
    nextChangeMs(t) {
      start(t);
      if (talkLatch !== null || heardLatch) {
        return 0;
      }
      advance(t);
      const at = [browNext, browCue ?? Number.POSITIVE_INFINITY];
      at.push(...[blinkAt, blinkAt + HALF_MS, blinkAt + HALF_MS + CLOSED_MS, blinkAt + CHAIN_MS].filter((x) => x > t));
      if (t < browStart + BROW_HOLD_MS) {
        at.push(browStart + BROW_HOLD_MS);
      }
      if (talking) {
        at.push(talkUntil);
        if (!still) {
          at.push(flapAt);
        }
      }
      return Math.max(0, Math.min(...at) - t);
    },
  };
}

/** The scene-motion chunk's root type (D1): what the controller's `import()` hands the executor. */
export type MotionKit = { readonly face: typeof createFaceAnimator; readonly talkMaxMs: number };
