// The puzzle overlay's view store (docs/PUZZLES-PLAN.md X14 and "Modules"; PROTOTYPE-PLAN L15 commit 3): what
// App.svelte renders for an open puzzle, written only by GameSession (app/yields.ts, L15). It holds views and the
// loaded puzzle-host component, never a session, a runner or a Pixi object (principle 7). Every field is
// `$state.raw` and is replaced, never mutated; `covers` is derived from `frame`. It is statically importable: the lazy
// components appear here as types only, and their values arrive through `yields.ts`'s `import()` (the `lazy-ui` arch
// rule).
import type { Component } from 'svelte';

import type { CueEvent } from '../cues/types.ts';
import type { Lang } from '../i18n/index.ts';
import type { PuzzleUiProps } from '../puzzles/registry.ts';
import type { PuzzleType } from '../puzzles/rules/index.ts';
import type { HintLadder, PuzzleMode } from '../puzzles/session.ts';
import type { Screen } from './screens.ts';

/** The frame's status line. */
export type PuzzleLine = 'idle' | 'checking' | 'wrong' | 'solved' | 'failed' | 'offline' | 'rate-limited';

/** One open puzzle as the frame shows it; the texts are already in the UI language, like `LineView`. */
export type PuzzleFrameView = {
  /** New for every session, so the type UI re-mounts (its selection resets) when a puzzle reopens. */
  id: number;
  mode: PuzzleMode;
  type: PuzzleType;
  title: string;
  prompt: string;
  params: unknown;
  answer: readonly number[];
  /**
   * The frame waits for an answer that settles it: an attempt in flight (yields' `post(o)`, the one attempt starter,
   * sets it; the attempt's reply clears it, in `attempted`, or in `countdown` for a 429; a `busy` reply leaves it to the
   * attempt in flight). Try and the type UI's input are off while it holds. Never the chunk's state: that is
   * `retrying`.
   */
  busy: boolean;
  line: PuzzleLine;
  attemptsLeft: number | null;
  /** Seconds left before Try opens again after a 429; GameSession owns the countdown. */
  retryAfter: number | null;
  /**
   * A reach frame's reached answer awaits a decisive reply (engine plan §7.5): true from the type UI's report until a
   * move away or a mismatch; false while nothing is reached, and Try is off. Null for a commit frame: Try as built.
   */
  awaiting: boolean | null;
  /** The puzzle allows Give up; the frame offers it in a linear puzzle only. */
  giveUp: boolean;
  hintTiers: number;
  /** The type UI; null while its chunk loads or after it failed to load. */
  ui: Component<PuzzleUiProps> | null;
  loadFailed: boolean;
  /**
   * A Retry's import of the host and type chunks is in flight: the notice stays, with Retry disabled. Never `busy`.
   * Starts false (`openPuzzle`); yields' `onretry` sets it and the chunk write (`loadPuzzleUis`) clears it with its
   * result, so both Retry buttons (PuzzleHost's and App's failed-host block) are disabled only while a reload runs.
   */
  retrying: boolean;
};

/** The ladder as the session answered it, with the use in flight and its failure. */
export type HintLadderUiView = HintLadder & { busy: boolean; failed: boolean };

/** GameSession's answers to the frame: every one is called inside the tap that caused it. */
export type PuzzleHostCallbacks = {
  /** Names an `order` piece in the UI language, with its glyph. */
  item: PuzzleUiProps['item'];
  onchange: (a: readonly number[]) => void;
  ontry: () => void;
  ongiveup: () => void;
  onhint: () => void;
  onretry: () => void;
  onusehint: (tier: number) => void;
  ongetmore: () => void;
  /**
   * The frame family's cues (engine plan §8.3; GM3p): its root emits each declared control's `ui` cue here, with its
   * point in the frame root's px; yields moves it to the stage host's and puts it on the session's bus. Optional: a
   * host without a bus (a test's) plays none.
   */
  oncue?: (e: CueEvent) => void;
  /**
   * A reach type UI's report (engine plan §7.4, §7.5; GM7r): the working answer turned reached, `canonical` its posted
   * form. yields posts it once per solve; a commit frame ignores it. Optional: a host that opens no reach type needs none.
   */
  onreach?: (canonical: readonly number[]) => void;
};

/**
 * The host's callbacks over whichever yields `get` names at each call (engine plan GM3w): Game's are these over its
 * current session's, so a later session's host is reached and none once the session has ended (`item` then names no
 * piece). One explicit forwarder per callback, so a lane adding a callback edits this file only.
 */
export function forwardHost(get: () => PuzzleHostCallbacks | undefined): PuzzleHostCallbacks {
  return {
    item: (id) => get()?.item(id) ?? null,
    onchange: (a) => get()?.onchange(a),
    ontry: () => get()?.ontry(),
    ongiveup: () => get()?.ongiveup(),
    onhint: () => get()?.onhint(),
    onretry: () => get()?.onretry(),
    onusehint: (tier) => get()?.onusehint(tier),
    ongetmore: () => get()?.ongetmore(),
    oncue: (e) => get()?.oncue?.(e),
    onreach: (c) => get()?.onreach?.(c),
  };
}

/** The props of the puzzle-host chunk's component (`ui/puzzles/PuzzleHost.svelte`). */
export type PuzzleHostProps = { lang: Lang; frame: PuzzleFrameView | null; ladder: HintLadderUiView | null } & PuzzleHostCallbacks;

/** The store; App.svelte renders `host` with `frame` and `ladder` while both `host` and `frame` are set. */
export interface PuzzleView {
  /** The puzzle-host chunk's component once `yields.ts` has loaded it. */
  host: Component<PuzzleHostProps> | null;
  frame: PuzzleFrameView | null;
  /** The hint ladder while it is open. */
  ladder: HintLadderUiView | null;
  /**
   * `coversStage(frame)`, answered at each read: App reads it here, so the entry imports nothing of this module
   * (GM3w cut D1).
   */
  readonly covers: boolean;
}

class PuzzleViewState implements PuzzleView {
  host: Component<PuzzleHostProps> | null = $state.raw(null);
  frame: PuzzleFrameView | null = $state.raw(null);
  ladder: HintLadderUiView | null = $state.raw(null);

  get covers(): boolean {
    return coversStage(this.frame);
  }
}

/** An empty store: no host loaded, no puzzle open. */
export function createPuzzleView(): PuzzleView {
  return new PuzzleViewState();
}

/**
 * The frame covers the stage: the stage layer under it is inert and App renders the frame layer (engine plan GM3w).
 * Every frame does today; a device drawn inside the room will not. A plain `boolean`, not a type predicate, so no
 * caller's narrowing changes when the body does.
 */
export function coversStage(f: PuzzleFrameView | null): boolean {
  return f !== null;
}

/**
 * The overlay a frame puts on the screens stack: an exploration puzzle closes with BackButton; a linear puzzle is a
 * mode, not an overlay, so it shows none and one stray Back never abandons a branch (X8).
 */
export function backScreen(f: PuzzleFrameView): Screen | null {
  return f.mode === 'explore' ? { kind: 'puzzle' } : null;
}
