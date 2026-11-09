// The clue lints of engine plan §7.3 (I4: a secret goal never ships, so the world must show it): a secret puzzle a
// lock holds declares the facts that show its answer, a shown goal declares none, and each declared fact holds in a
// state the player reaches before the puzzle is over. A build pass of the world lint registry (§3.2). Build only and
// pure, no node:*: world.ts imports the registry and scan-dist.ts imports world.ts. Its imports from index.ts and
// lint.ts are `import type`; it never imports world.ts (index.ts's value graph has no edge back).
import type { Severity } from '../lint.ts';
import type { WorldLint } from './index.ts';

/** Every clue code with its severity: all errors, so `npm run story` never passes a secret no player can find. */
export const CLUE_CODES = {
  'world/clue-declared': 'E',
  'world/reach-has-clue': 'E',
  'world/clue-reachable': 'E',
} as const satisfies Readonly<Record<string, Severity>>;

export const CLUES_LINT: WorldLint<keyof typeof CLUE_CODES> = { id: 'clues', codes: CLUE_CODES, lint: () => [] };
