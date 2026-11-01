// The overlay's view model (PROTOTYPE-PLAN "client/src"): what the components render, written by the boot and the
// game session. It holds views only, never a Story, a runner or a Pixi object (principle 7). Every field is
// `$state.raw` and is replaced, never mutated, so a component re-renders on assignment and nothing deep is proxied.
import type { Lang } from '../i18n/index.ts';
import type { LineId } from '../story/staging.ts';
import type { ScreensView } from './screens.ts';
import type { TextSpeed } from './typewriter.ts';

/** The current line: the speaker's name and the text, both already in the UI language. */
export type LineView = { lineId: LineId; speaker: string | null; text: string };
/** One option; `index` is the runner's choice index. */
export type ChoiceView = { index: number; lineId: LineId; text: string };
/** One presentation of choices; `id` is new each time, so a pick counts once per presentation. */
export type ChoiceSet = { id: number; options: readonly ChoiceView[] };
/** How the story advances (F2 modes). */
export type PlayMode = 'normal' | 'auto' | 'skip';
/** A prompt's button. */
export type ToastAction = { label: string; run: () => void };
/**
 * A toast, with its strings resolved by the producer (whose table it is). Only a `note` with `sticky: false` is
 * transient; every other entry stays until dismissed.
 */
export type ToastEntry =
  | { kind: 'note'; key: string; message: string; sticky: boolean }
  | {
      kind: 'prompt';
      key: string;
      message: string;
      actions: readonly [ToastAction] | readonly [ToastAction, ToastAction];
    }
  | { kind: 'chip'; key: string; message: string; tap: () => void }
  | { kind: 'dev'; key: string; message: string };
/** The view model's clock: the page's timers, or a test's. */
export type Timers = { setTimeout(fn: () => void, ms: number): number; clearTimeout(id: number): void };

/** A transient note's lifetime. */
export const TOAST_MS = 4000;
/** Entries kept at once; above it the oldest transient goes. */
export const TOAST_MAX = 3;

/** The overlay's state; the components read it, the game session writes it. */
export interface ViewModel {
  lang: Lang;
  screens: ScreensView;
  /** Home's Continue: the story title of the newest autosave, or null for none. */
  continueLabel: string | null;
  line: LineView | null;
  choices: ChoiceSet | null;
  mode: PlayMode;
  speed: TextSpeed;
  reducedMotion: boolean;
  readonly toasts: readonly ToastEntry[];
  /** Adds `e`; an entry with the same key is replaced in place (its timer restarted). Above TOAST_MAX the oldest
   * transient is dropped; a sticky entry never is. */
  showToast(e: ToastEntry): void;
  /** Removes that entry and clears its timer; an unknown key is a no-op. */
  dismissToast(key: string): void;
  /** Clears every timer; idempotent, and later `showToast` calls are no-ops. */
  destroy(): void;
}

const isTransient = (e: ToastEntry): boolean => e.kind === 'note' && !e.sticky;

class OverlayState implements ViewModel {
  lang: Lang = $state.raw('ru');
  screens: ScreensView = $state.raw(
    Object.freeze({ root: Object.freeze({ kind: 'home' }), overlays: Object.freeze([]), backVisible: false }),
  );
  continueLabel: string | null = $state.raw(null);
  line: LineView | null = $state.raw(null);
  choices: ChoiceSet | null = $state.raw(null);
  mode: PlayMode = $state.raw('normal');
  speed: TextSpeed = $state.raw('normal');
  reducedMotion: boolean = $state.raw(false);
  #toasts: readonly ToastEntry[] = $state.raw([]);
  readonly #timers: Timers;
  /** The pending expiry of each transient entry, by key. */
  readonly #expiry = new Map<string, number>();
  #destroyed = false;

  constructor(timers: Timers, lang: Lang) {
    this.#timers = timers;
    this.lang = lang;
  }

  get toasts(): readonly ToastEntry[] {
    return this.#toasts;
  }

  showToast(e: ToastEntry): void {
    if (this.#destroyed) {
      return;
    }
    this.#clearExpiry(e.key);
    const at = this.#toasts.findIndex((x) => x.key === e.key);
    let next = at === -1 ? [...this.#toasts, e] : this.#toasts.map((x, i) => (i === at ? e : x));
    while (next.length > TOAST_MAX) {
      const oldest = next.findIndex(isTransient);
      if (oldest === -1) {
        break;
      }
      const dropped = next[oldest];
      if (dropped !== undefined) {
        this.#clearExpiry(dropped.key);
      }
      next = next.filter((_, i) => i !== oldest);
    }
    if (isTransient(e) && next.includes(e)) {
      this.#expiry.set(
        e.key,
        this.#timers.setTimeout(() => this.#expire(e.key), TOAST_MS),
      );
    }
    this.#toasts = next;
  }

  dismissToast(key: string): void {
    this.#clearExpiry(key);
    if (this.#toasts.some((x) => x.key === key)) {
      this.#toasts = this.#toasts.filter((x) => x.key !== key);
    }
  }

  destroy(): void {
    this.#destroyed = true;
    for (const id of this.#expiry.values()) {
      this.#timers.clearTimeout(id);
    }
    this.#expiry.clear();
  }

  #expire(key: string): void {
    this.#expiry.delete(key);
    this.#toasts = this.#toasts.filter((x) => x.key !== key);
  }

  #clearExpiry(key: string): void {
    const id = this.#expiry.get(key);
    if (id !== undefined) {
      this.#timers.clearTimeout(id);
      this.#expiry.delete(key);
    }
  }
}

/** The overlay's one view model, in `lang`, with toast timers on `deps.timers`. */
export function createViewModel(deps: { timers: Timers; lang: Lang }): ViewModel {
  return new OverlayState(deps.timers, deps.lang);
}
