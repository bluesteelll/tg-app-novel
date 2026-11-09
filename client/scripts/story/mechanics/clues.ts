// The clue lints of engine plan §7.3 (I4: a secret goal never ships, so the world must show it): a secret puzzle a
// lock holds declares the facts that show its answer, a shown goal declares none, and each declared fact holds in a
// state the player reaches before the puzzle is over. A build pass of the world lint registry (§3.2). Build only and
// pure, no node:*: world.ts imports the registry and scan-dist.ts imports world.ts. Its imports from index.ts and
// lint.ts are `import type`; it never imports world.ts (index.ts's value graph has no edge back).
import { hotspotKey, lockOf } from '../../../src/explore/reduce.ts';
import { PUZZLE_TYPES } from '../../../src/puzzles/rules/index.ts';
import type { PuzzleTypes } from '../../../src/puzzles/rules/index.ts';
import type { PuzzleLocalId, SectionId } from '../../../src/story/staging.ts';
import type { HotspotKey, WorldSource } from '../../../src/world/types.ts';
import type { Finding, Severity } from '../lint.ts';
import type { WorldLint, WorldLintInput } from './index.ts';

/** Every clue code with its severity: all errors, so `npm run story` never passes a secret no player can find. */
export const CLUE_CODES = {
  'world/clue-declared': 'E',
  'world/reach-has-clue': 'E',
  'world/clue-reachable': 'E',
} as const satisfies Readonly<Record<string, Severity>>;
type ClueCode = keyof typeof CLUE_CODES;

type HeldBy = { readonly section: SectionId; readonly key: HotspotKey };

/** A decoded record's own entries, keyed by the brand its keys were checked against. */
function entriesOf<K extends string, V>(r: Readonly<Record<K, V>>): Array<[K, V]> {
  return Object.entries(r) as Array<[K, V]>; // the keys of a decoded record are its ids
}

/** The locks that hold each puzzle, in world order (one at most in a valid world: `world/puzzle-multi-lock`). */
function locksOf(w: WorldSource): Map<PuzzleLocalId, HeldBy[]> {
  const out = new Map<PuzzleLocalId, HeldBy[]>();
  for (const [section, s] of entriesOf(w.sections)) {
    for (const [room, r] of entriesOf(s.rooms)) {
      for (const h of r.hotspots) {
        const pid = lockOf(h)?.puzzle ?? null;
        if (pid !== null) {
          out.set(pid, [...(out.get(pid) ?? []), { section, key: hotspotKey(room, h.id) }]);
        }
      }
    }
  }
  return out;
}

/**
 * The clue findings of one world: `world/clue-declared` for a secret puzzle a lock holds with no clue (a linear
 * puzzle's clue is the story's, RULINGS 180 Q1-A), `world/reach-has-clue` for a shown goal with one. `types` is the
 * registry the world was decoded with (a fixture type in tests).
 */
export function clueFindings(input: WorldLintInput, types: PuzzleTypes = PUZZLE_TYPES): Finding[] {
  const out: Finding[] = [];
  const report = (code: ClueCode, path: string, message: string): void => {
    out.push({ code, severity: CLUE_CODES[code], file: input.file, line: input.line(path), message });
  };
  const held = locksOf(input.world);
  for (const [pid, p] of entriesOf(input.world.puzzles)) {
    const goal = types.find((d) => d.type === p.type)?.goal;
    if (goal === 'secret' && (held.get(pid) ?? []).length > 0 && p.clues.length === 0) {
      report('world/clue-declared', `puzzles.${pid}`, `puzzle '${pid}' (${p.type}, a secret goal) declares no clue: clues names the fact that shows its answer (§7.3, I4)`);
    }
    if (goal === 'shown' && p.clues.length > 0) {
      report('world/reach-has-clue', `puzzles.${pid}.clues`, `puzzle '${pid}' (${p.type}) draws its goal: it declares no clue (§7.3)`);
    }
  }
  return out;
}

export const CLUES_LINT: WorldLint<ClueCode> = { id: 'clues', codes: CLUE_CODES, lint: (input) => clueFindings(input) };
