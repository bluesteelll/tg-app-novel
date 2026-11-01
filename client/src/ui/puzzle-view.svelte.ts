// The puzzle overlay's view store (docs/PUZZLES-PLAN.md X14 and "Modules"; PROTOTYPE-PLAN L15 commit 3): what
// App.svelte renders for an open puzzle, written only by GameSession (app/yields.ts, L15). It holds views and the
// loaded puzzle-host component, never a session, a runner or a Pixi object (principle 7). Every field is
// `$state.raw` and is replaced, never mutated. It is statically importable: the lazy components appear here as types
// only, and their values arrive through `yields.ts`'s `import()` (the `lazy-ui` arch rule).
import type { Component } from 'svelte';

import type { Lang } from '../i18n/index.ts';
import type { PuzzleUiProps } from '../puzzles/registry.ts';
import type { PuzzleType } from '../puzzles/rules/index.ts';
import type { HintLadder, PuzzleMode } from '../puzzles/session.ts';
import type { ItemId } from '../world/types.ts';
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
  /** An attempt is in flight. */
  busy: boolean;
  line: PuzzleLine;
  attemptsLeft: number | null;
  /** Seconds left before Try opens again after a 429; GameSession owns the countdown. */
  retryAfter: number | null;
  /** The puzzle allows Give up; the frame offers it in a linear puzzle only. */
  giveUp: boolean;
  hintTiers: number;
  /** The type UI; null while its chunk loads or after it failed to load. */
  ui: Component<PuzzleUiProps> | null;
  loadFailed: boolean;
};

/** The ladder as the session answered it, with the use in flight and its failure. */
export type HintLadderUiView = HintLadder & { busy: boolean; failed: boolean };

/** GameSession's answers to the frame: every one is called inside the tap that caused it. */
export type PuzzleHostCallbacks = {
  /** Names an `order` piece in the UI language. */
  item: (id: ItemId) => { name: string } | null;
  onchange: (a: readonly number[]) => void;
  ontry: () => void;
  ongiveup: () => void;
  onhint: () => void;
  onretry: () => void;
  onusehint: (tier: number) => void;
  ongetmore: () => void;
};

/** The props of the puzzle-host chunk's component (`ui/puzzles/PuzzleHost.svelte`). */
export type PuzzleHostProps = { lang: Lang; frame: PuzzleFrameView | null; ladder: HintLadderUiView | null } & PuzzleHostCallbacks;

/** The store; App.svelte renders `host` with `frame` and `ladder` while both `host` and `frame` are set. */
export interface PuzzleView {
  /** The puzzle-host chunk's component once `yields.ts` has loaded it. */
  host: Component<PuzzleHostProps> | null;
  frame: PuzzleFrameView | null;
  /** The hint ladder while it is open. */
  ladder: HintLadderUiView | null;
}

class PuzzleViewState implements PuzzleView {
  host: Component<PuzzleHostProps> | null = $state.raw(null);
  frame: PuzzleFrameView | null = $state.raw(null);
  ladder: HintLadderUiView | null = $state.raw(null);
}

/** An empty store: no host loaded, no puzzle open. */
export function createPuzzleView(): PuzzleView {
  return new PuzzleViewState();
}

/**
 * The overlay a frame puts on the screens stack: an exploration puzzle closes with BackButton; a linear puzzle is a
 * mode, not an overlay, so it shows none and one stray Back never abandons a branch (X8).
 */
export function backScreen(f: PuzzleFrameView): Screen | null {
  return f.mode === 'explore' ? { kind: 'puzzle' } : null;
}
