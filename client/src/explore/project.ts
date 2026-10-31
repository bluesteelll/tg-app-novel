// The outcome channel (docs/PUZZLES-PLAN.md X2): ink values derived from the world state, written by
// StoryRunner.enter() only for the variables the chapter declares. Pure (X4).
import type { InkScalar } from '../story/catalog.ts';
import type { PuzzleLocalId, VarName } from '../story/staging.ts';
import type { WorldPublicBody } from '../world/types.ts';
import type { PuzzleOutcome, WorldState } from './state.ts';

/** `pz_<puzzle>`: 0 none, 1 solved, 2 failed, 3 abandoned. */
const OUTCOME_CODE: Readonly<Record<PuzzleOutcome, number>> = { solved: 1, failed: 2, abandoned: 3 };

/**
 * `pz_<puzzle>` (int), `pz_<puzzle>_hints` (int, tiers opened), `it_<item>` (bool, ever obtained: held or used),
 * `dc_<doc>` (bool, found), each only when `declared` holds its name.
 */
export function project(w: WorldPublicBody, s: WorldState, declared: ReadonlySet<VarName>): Record<VarName, InkScalar> {
  const out: Record<VarName, InkScalar> = {};
  const write = (name: string, value: InkScalar): void => {
    const v = name as VarName; // a projection name is an ink identifier by construction (X2)
    if (declared.has(v)) {
      out[v] = value;
    }
  };
  const puzzles = Object.keys(w.puzzles) as PuzzleLocalId[]; // the keys of a decoded puzzle record are its ids
  for (const p of puzzles) {
    const run = Object.hasOwn(s.puzzles, p) ? s.puzzles[p] : undefined;
    const outcome = run?.outcome ?? null;
    write(`pz_${p}`, outcome === null ? 0 : OUTCOME_CODE[outcome]);
    write(`pz_${p}_hints`, run?.hintsOpened ?? 0);
  }
  const obtained = new Set<string>([...s.held, ...s.used]);
  for (const i of Object.keys(w.items)) {
    write(`it_${i}`, obtained.has(i));
  }
  const found = new Set<string>(s.docs);
  for (const d of Object.keys(w.docs)) {
    write(`dc_${d}`, found.has(d));
  }
  return out;
}
