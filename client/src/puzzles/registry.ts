// The puzzle type UIs' loader (docs/PUZZLES-PLAN.md X14, X17): one dynamic chunk per type, so a type UI is never in
// the entry or the engine's static closure (the `lazy-ui` arch rule, the puzzle-type budget row). Each `import()` is
// a literal, so Vite emits exactly one chunk per type; a chunk that fails to load is an error value, never a throw.
import type { Component } from 'svelte';

import type { Lang } from '../i18n/index.ts';
import type { Result } from '../story/catalog.ts';
import type { ItemId } from '../world/types.ts';
import type { PuzzleType } from './rules/index.ts';

/**
 * What every type UI renders from. `params` is narrowed by the type's own `PUZZLE_RULES[type].decodeParams`;
 * `answer` is the session's (the UI holds none of its own); `item` names an `order` piece in the UI language.
 */
export type PuzzleUiProps = {
  params: unknown;
  answer: readonly number[];
  busy: boolean;
  lang: Lang;
  onchange: (a: readonly number[]) => void;
  item: (id: ItemId) => { name: string } | null;
};

/** A type UI's chunk did not load (offline, a replaced deploy); a later call runs `import()` again. */
export type ChunkError = { kind: 'chunk'; detail: string };

function detailOf(e: unknown): string {
  return e instanceof Error ? e.message || e.name : String(e);
}

/** The component of puzzle type `t`, loaded on first use. */
export async function loadPuzzleUi(t: PuzzleType): Promise<Result<Component<PuzzleUiProps>, ChunkError>> {
  try {
    switch (t) {
      case 'code':
        return { ok: true, value: (await import('./ui/CodeLock.svelte')).default };
      case 'order':
        return { ok: true, value: (await import('./ui/OrderPuzzle.svelte')).default };
      default: {
        const never: never = t;
        return never;
      }
    }
  } catch (e) {
    return { ok: false, error: { kind: 'chunk', detail: detailOf(e) } };
  }
}
