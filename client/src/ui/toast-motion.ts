// Per-player GM6t: every toast enters, leaves and swaps its text with our own `Element.animate` (rule `waapi`), never a
// Svelte transition directive, which would pull Svelte's transition runtime into the entry chunk. A leave is a ghost:
// the stack keeps a removed entry rendered, inert and aria-hidden, until its `out` ends, under a leave token that is
// never reused. Values only, no value import (the entry's closure gains this file alone); `toast-motion.test.ts` holds
// the table to the cue gate (`MIN_VISIBLE_MS`, `keyframesVisible`).
import type { ToastEntry } from './state.svelte.ts';

export type ToastMotion = 'in' | 'out' | 'swap';
export type ToastMotionDef = { readonly keyframes: readonly Keyframe[]; readonly ms: number; readonly easing: string };

const FADE_IN: readonly Keyframe[] = [{ opacity: 0 }, { opacity: 1 }];
const FADE_OUT: readonly Keyframe[] = [{ opacity: 1 }, { opacity: 0 }];

/**
 * The three toast motions (design defaults, per-player T6): `in` rises 12 px into place, `out` drifts 8 px up while
 * fading, `swap` settles the new text from 104 %. Reduced motion keeps each motion's `ms` and easing and animates
 * opacity only (the cue stage's convention, engine plan §8.6).
 */
export const TOAST_MOTIONS: {
  readonly [K in ToastMotion]: { readonly full: ToastMotionDef; readonly reduced: ToastMotionDef };
} = {
  in: {
    full: {
      keyframes: [
        { opacity: 0, transform: 'translateY(12px)' },
        { opacity: 1, transform: 'none' },
      ],
      ms: 220,
      easing: 'ease-out',
    },
    reduced: { keyframes: FADE_IN, ms: 220, easing: 'ease-out' },
  },
  out: {
    full: {
      keyframes: [
        { opacity: 1, transform: 'none' },
        { opacity: 0, transform: 'translateY(-8px)' },
      ],
      ms: 180,
      easing: 'ease-in',
    },
    reduced: { keyframes: FADE_OUT, ms: 180, easing: 'ease-in' },
  },
  swap: {
    full: {
      keyframes: [
        { opacity: 0, transform: 'scale(1.04)' },
        { opacity: 1, transform: 'none' },
      ],
      ms: 200,
      easing: 'ease-out',
    },
    reduced: { keyframes: FADE_IN, ms: 200, easing: 'ease-out' },
  },
};

/**
 * Plays `kind` on `el`; an `out` holds its last frame (`fill: 'both'`), so a finished leave never flashes back before
 * its ghost is removed. Null where `el.animate` is not a function: an enter or a swap then shows at once, and the
 * caller ends a leave at once.
 */
export function playToast(el: Element, kind: ToastMotion, reduced: boolean): Animation | null {
  if (typeof el.animate !== 'function') {
    return null;
  }
  const def = TOAST_MOTIONS[kind][reduced ? 'reduced' : 'full'];
  // `animate` copies its keyframes and never writes them; the table's readonly view is ours.
  return el.animate(def.keyframes as Keyframe[], {
    duration: def.ms,
    easing: def.easing,
    fill: kind === 'out' ? 'both' : 'none',
  });
}

/** A live entry (`leave` null) or a ghost under its own never-reused leave token. */
export type ToastSlot = { readonly entry: ToastEntry; readonly leave: number | null };

/**
 * The stack to render. Pure. `next`'s entries are live, in order. Each key of `prev` absent from `next` stays a ghost,
 * inserted in `prev` order at its index in `prev` (clamped to the stack built so far), with its last live entry: it
 * keeps its token if it was a ghost already, else it takes `token`, `token + 1`, ... in `prev` order. A ghost whose
 * token is in `ended` is dropped. A key in `next` is never a ghost, so the keys stay distinct. Returns the stack and
 * the next unused token.
 */
export function stackOf(
  prev: readonly ToastSlot[],
  next: readonly ToastEntry[],
  ended: ReadonlySet<number>,
  token: number,
): { readonly slots: readonly ToastSlot[]; readonly token: number } {
  const keys = new Set(next.map((e) => e.key));
  const slots: ToastSlot[] = next.map((entry) => ({ entry, leave: null }));
  prev.forEach((slot, i) => {
    if (!keys.has(slot.entry.key)) {
      const leave = slot.leave ?? token++;
      if (!ended.has(leave)) {
        // `splice` clamps an index past the end to the end.
        slots.splice(i, 0, { entry: slot.entry, leave });
      }
    }
  });
  return { slots, token };
}
