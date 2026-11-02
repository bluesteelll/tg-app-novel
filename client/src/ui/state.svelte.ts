// The overlay's view model (PROTOTYPE-PLAN "client/src"): what the components render, written by the boot and the
// game session. It holds views only, never a Story, a runner or a Pixi object (principle 7). Every field is
// `$state.raw` and is replaced, never mutated, so a component re-renders on assignment and nothing deep is proxied.
import type { EngineUi } from '../app/engine.ts';
import type { MetaView } from '../app/meta.ts';
import type { Lang } from '../i18n/index.ts';
import type { PurchaseState } from '../purchase/flow.ts';
import type { ManualSlot } from '../saves/service.ts';
import { DEFAULT_SETTINGS } from '../settings/store.ts';
import type { Settings } from '../settings/store.ts';
import type { LineId } from '../story/staging.ts';
import type { BacklogLine } from './Backlog.svelte';
import type { ChapterRow } from './ChapterSelect.svelte';
import type { NoticeView } from './Notice.svelte';
import type { SlotView } from './SaveLoad.svelte';
import type { ScreensView } from './screens.ts';
import type { StoryCardView } from './StoryPicker.svelte';
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
/** One story's chapters as ChapterSelect shows them, in play order; `story` is its title in the UI language. */
export type ChaptersView = { story: string; rows: readonly ChapterRow[] };
/** The save screen: the occupied slots, and the manual slot being written, asked about or failed. */
export type SavesView = {
  slots: readonly SlotView[];
  saving: ManualSlot | null;
  conflict: ManualSlot | null;
  failed: ManualSlot | null;
};
/** One chapter's paywall: its title, the server's price (null: the price read failed) and the purchase state. */
export type PaywallView = { chapter: string; priceStars: number | null; state: PurchaseState };
/** The view model's clock: the page's timers, or a test's. */
export type Timers = { setTimeout(fn: () => void, ms: number): number; clearTimeout(id: number): void };

/** A transient note's lifetime. */
export const TOAST_MS = 4000;
/** Entries kept at once; above it the oldest transient goes. */
export const TOAST_MAX = 3;

/** The overlay's state; the components read it, the boot and the game session write it. */
export interface ViewModel {
  lang: Lang;
  screens: ScreensView;
  /** Home's Continue: the story title of the newest autosave, or null for none. */
  continueLabel: string | null;
  /** The full-screen notice the `notice` root shows; a new object for every presentation. */
  notice: NoticeView | null;
  /** Home's story cards, in catalog order. */
  cards: readonly StoryCardView[];
  /** The chapters overlay's story. */
  chapters: ChaptersView | null;
  line: LineView | null;
  choices: ChoiceSet | null;
  backlog: readonly BacklogLine[];
  settings: Settings;
  saves: SavesView;
  paywall: PaywallView | null;
  mode: PlayMode;
  speed: TextSpeed;
  reducedMotion: boolean;
  /** The Mini App is in the background (`deactivated`): the dialogue's reveal holds. */
  paused: boolean;
  /** The in-play components, once the engine chunk has loaded; null before. */
  ui: EngineUi | null;
  /** What the meta overlays render (app/meta.ts writes it); null until the meta controller exists, after auth. */
  meta: MetaView | null;
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

/** The save screen before its first list. */
export const NO_SAVES: SavesView = Object.freeze({ slots: Object.freeze([]), saving: null, conflict: null, failed: null });

class OverlayState implements ViewModel {
  lang: Lang = $state.raw('ru');
  screens: ScreensView = $state.raw(
    Object.freeze({ root: Object.freeze({ kind: 'home' }), overlays: Object.freeze([]), backVisible: false }),
  );
  continueLabel: string | null = $state.raw(null);
  notice: NoticeView | null = $state.raw(null);
  cards: readonly StoryCardView[] = $state.raw([]);
  chapters: ChaptersView | null = $state.raw(null);
  line: LineView | null = $state.raw(null);
  choices: ChoiceSet | null = $state.raw(null);
  backlog: readonly BacklogLine[] = $state.raw([]);
  settings: Settings = $state.raw(DEFAULT_SETTINGS);
  saves: SavesView = $state.raw(NO_SAVES);
  paywall: PaywallView | null = $state.raw(null);
  mode: PlayMode = $state.raw('normal');
  speed: TextSpeed = $state.raw('normal');
  reducedMotion: boolean = $state.raw(false);
  paused: boolean = $state.raw(false);
  ui: EngineUi | null = $state.raw(null);
  meta: MetaView | null = $state.raw(null);
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
