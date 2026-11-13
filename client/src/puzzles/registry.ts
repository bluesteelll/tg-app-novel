// The puzzle type UIs' loader (docs/PUZZLES-PLAN.md X14, X17): one dynamic chunk per type, so a type UI is never in
// the entry or the engine's static closure (the `lazy-ui` arch rule, the puzzle-type budget row). Each `import()` is
// a literal, so Vite emits exactly one chunk per type; a chunk that fails to load is an error value, never a throw.
import type { Component } from 'svelte';

import type { GestureCue } from '../cues/types.ts';
import type { Lang } from '../i18n/index.ts';
import type { Result } from '../story/catalog.ts';
import type { Glyph, ItemId } from '../world/types.ts';
import type { PuzzleType } from './rules/index.ts';

/**
 * What every type UI renders from. `params` is narrowed by its type's data half's `decodeParams` (`PUZZLE_TYPES`);
 * `answer` is the session's (the UI holds none of its own); `item` names an `order` piece in the UI language, with
 * its world glyph (K46).
 */
export type PuzzleUiProps = {
  params: unknown;
  answer: readonly number[];
  busy: boolean;
  lang: Lang;
  onchange: (a: readonly number[]) => void;
  item: (id: ItemId) => { name: string; glyph: Glyph } | null;
  /**
   * A reach type's report (engine plan §7.1 round 5 W3, §7.4; GM7r): `canonical(p, answer)`, once per turn to reached
   * (`puzzles/play/reach.ts`'s edge over the `answer` prop). Commit types never call it.
   */
  onreach?: (canonical: readonly number[]) => void;
  /** A gesture surface's step (engine plan §8.3; GM7r): its control's cue, `index` the step's part. */
  oncue?: (name: GestureCue, index: number) => void;
};

/** A type UI's chunk did not load (offline, a replaced deploy); a later call runs `import()` again. */
export type ChunkError = { kind: 'chunk'; detail: string };

function detailOf(e: unknown): string {
  return e instanceof Error ? e.message || e.name : String(e);
}

type UiLoader = () => Promise<Result<Component<PuzzleUiProps>, ChunkError>>;

/** A type UI's loader: its module's component, or the chunk error when `import()` rejects. */
function loader(load: () => Promise<{ default: Component<PuzzleUiProps> }>): UiLoader {
  return async () => {
    try {
      return { ok: true, value: (await load()).default };
    } catch (e) {
      return { ok: false, error: { kind: 'chunk', detail: detailOf(e) } };
    }
  };
}

/** One loader per puzzle type (engine plan §7.1); a type without one is a tsc error. */
export const PUZZLE_UI: { readonly [T in PuzzleType]: UiLoader } = Object.freeze({
  code: loader(() => import('./ui/CodeLock.svelte')),
  order: loader(() => import('./ui/OrderPuzzle.svelte')),
});

/** The component of puzzle type `t`, loaded on first use. */
export function loadPuzzleUi(t: PuzzleType): Promise<Result<Component<PuzzleUiProps>, ChunkError>> {
  return PUZZLE_UI[t]();
}
