// The line reveal (PROTOTYPE-PLAN "Localization"): time-based, by grapheme (Intl.Segmenter, iOS 14.1+), into two
// spans written through `textContent` only, so story text is never parsed as markup. The unrevealed rest stays in
// the layout (the caller hides it), so the box does not reflow as the line grows. One frame at most is pending.

/** The player's text speed; `instant` shows each line whole. */
export type TextSpeed = 'slow' | 'normal' | 'fast' | 'instant';

/** Graphemes per second of each timed speed. */
export const GRAPHEMES_PER_SECOND = { slow: 25, normal: 45, fast: 80 } as const;

/** The frame source: the page's rAF and clock, or a test's. */
export type FrameClock = { now(): number; request(cb: (t: number) => void): number; cancel(id: number): void };

/** Where the reveal writes: the shown part and the rest. */
export type Reveal = { shown: { textContent: string | null }; rest: { textContent: string | null } };

/** One reveal at a time over one target. */
export interface Typewriter {
  /**
   * Reveals `text` from its start, cancelling the reveal in progress (whose end is then never reported). `instant`,
   * reduced motion or an empty text show it whole at once.
   */
  start(text: string, o: { speed: TextSpeed; reducedMotion: boolean }): void;
  /** Shows the running line whole; a no-op when nothing runs. */
  complete(): void;
  /** Holds the reveal; the held time does not count. */
  pause(): void;
  resume(): void;
  /** A line is being revealed (also while paused). */
  running(): boolean;
  /** Cancels the frame; every later call is a no-op and nothing is reported. */
  destroy(): void;
}

let segmenter: Intl.Segmenter | null = null;

/** The user-perceived characters of `text`, so a reveal never splits an emoji or a combining mark. */
export function graphemes(text: string): string[] {
  segmenter ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  return Array.from(segmenter.segment(text), (s) => s.segment);
}

/**
 * A typewriter over `target`. `onDone` fires exactly once per `start()`, synchronously, when the whole line is shown:
 * at its natural end (in a frame), on `complete()`, or inside `start()` itself for an instant line.
 */
export function createTypewriter(target: Reveal, deps: { clock: FrameClock; onDone: () => void }): Typewriter {
  const { clock, onDone } = deps;
  let text = '';
  /** Code-unit offset of each grapheme boundary: `ends[n]` is where the first n graphemes end. */
  let ends: number[] = [0];
  let shownCount = 0;
  let perSecond = 0;
  let startedAt = 0;
  let pausedFor = 0;
  let pausedAt: number | null = null;
  let frame: number | null = null;
  let revealing = false;
  let destroyed = false;

  const total = (): number => ends.length - 1;

  const write = (n: number): void => {
    shownCount = n;
    const cut = ends[n] ?? text.length;
    target.shown.textContent = text.slice(0, cut);
    target.rest.textContent = text.slice(cut);
  };

  const cancel = (): void => {
    if (frame !== null) {
      clock.cancel(frame);
      frame = null;
    }
  };

  const finish = (): void => {
    cancel();
    revealing = false;
    pausedAt = null;
    write(total());
    onDone();
  };

  const tick = (): void => {
    frame = null;
    const n = Math.floor(((clock.now() - startedAt - pausedFor) * perSecond) / 1000);
    if (n >= total()) {
      finish();
      return;
    }
    if (n !== shownCount) {
      write(n);
    }
    frame = clock.request(tick);
  };

  return {
    start: (next, o) => {
      if (destroyed) {
        return;
      }
      cancel();
      text = next;
      ends = [0];
      for (const g of graphemes(next)) {
        ends.push((ends.at(-1) ?? 0) + g.length);
      }
      pausedFor = 0;
      pausedAt = null;
      if (o.speed === 'instant' || o.reducedMotion || total() === 0) {
        revealing = false;
        write(total());
        onDone();
        return;
      }
      perSecond = GRAPHEMES_PER_SECOND[o.speed];
      startedAt = clock.now();
      revealing = true;
      write(0);
      frame = clock.request(tick);
    },
    complete: () => {
      if (!destroyed && revealing) {
        finish();
      }
    },
    pause: () => {
      if (!destroyed && revealing && pausedAt === null) {
        pausedAt = clock.now();
        cancel();
      }
    },
    resume: () => {
      if (!destroyed && revealing && pausedAt !== null) {
        pausedFor += clock.now() - pausedAt;
        pausedAt = null;
        frame = clock.request(tick);
      }
    },
    running: () => revealing,
    destroy: () => {
      destroyed = true;
      revealing = false;
      cancel();
    },
  };
}

/** The page's frames: `performance.now()` and `requestAnimationFrame`. */
export function browserFrameClock(): FrameClock {
  return {
    now: () => performance.now(),
    request: (cb) => requestAnimationFrame(cb),
    cancel: (id) => cancelAnimationFrame(id),
  };
}
