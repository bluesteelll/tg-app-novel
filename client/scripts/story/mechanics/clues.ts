// The clue lints of engine plan §7.3 (I4: a secret goal never ships, so the world must show it): a secret puzzle a
// lock holds declares the clues that show its answer, a shown goal declares none, and each declared clue holds in a
// state the player reaches before the puzzle is over. And the reach lints of §7.4 (GM7p): a reach puzzle has exactly one
// solution, the type's `solve`, which its play half's own rule reaches and orients and which its start does not
// already reach; a type with no wrong state takes no attempt count. One build pass of the world lint registry (§3.2).
// Build only and pure, no node:*: world.ts imports the registry and scan-dist.ts imports world.ts. Its imports from
// index.ts and lint.ts are `import type`; it never imports world.ts (index.ts's value graph has no edge back), and the
// puzzle lint registry it reads imports nothing of mechanics/.
import { RESUME_STATE_CAP, hotspotKey, lockOf } from '../../../src/explore/reduce.ts';
import { EMPTY_WORLD_STATE } from '../../../src/explore/state.ts';
import type { WorldState } from '../../../src/explore/state.ts';
import type { KernelWorld } from '../../../src/mechanics/contract.ts';
import { condReads } from '../../../src/mechanics/data/conditions.ts';
import type { Cond } from '../../../src/mechanics/data/conditions.ts';
import { holds } from '../../../src/mechanics/rules/conditions.ts';
import { searchSection, sectionEntry } from '../../../src/mechanics/rules/search.ts';
import { PUZZLE_TYPES } from '../../../src/puzzles/rules/index.ts';
import type { PuzzleTypes } from '../../../src/puzzles/rules/index.ts';
import type { PuzzleLocalId, SectionId } from '../../../src/story/staging.ts';
import { toPublic } from '../../../src/world/decode.ts';
import type { HotspotKey, WorldSource } from '../../../src/world/types.ts';
import type { Finding, Severity } from '../lint.ts';
import { PUZZLE_LINTS } from '../puzzles/index.ts';
import type { PuzzleLintRegistry } from '../puzzles/shape.ts';
import type { WorldLint, WorldLintInput } from './index.ts';

/** Every clue code with its severity: all errors, so `npm run story` never passes a secret no player can find. */
export const CLUE_CODES = {
  'world/clue-declared': 'E',
  'world/reach-has-clue': 'E',
  'world/clue-reachable': 'E',
} as const satisfies Readonly<Record<string, Severity>>;
type ClueCode = keyof typeof CLUE_CODES;

/**
 * Every reach code with its severity: all errors. A wrong reach solution makes every correct draw a mismatch (the lock
 * opens for no player, 07:203), and an attempt count on a type with no wrong state never moves.
 */
export const REACH_CODES = {
  'world/unique-solution': 'E',
  'world/reach-solution': 'E',
  'world/attempts-without-wrong': 'E',
} as const satisfies Readonly<Record<string, Severity>>;
type ReachCode = keyof typeof REACH_CODES;

type HeldBy = { readonly section: SectionId; readonly key: HotspotKey };

/** A decoded record's own entries, keyed by the brand its keys were checked against. */
function entriesOf<K extends string, V>(r: Readonly<Record<K, V>>): Array<[K, V]> {
  return Object.entries(r) as Array<[K, V]>; // the keys of a decoded record are its ids
}

type Places = {
  readonly rooms: ReadonlySet<string>;
  readonly hotspots: ReadonlySet<string>;
  /** The locks that hold each puzzle, in world order (one at most in a valid world: `world/puzzle-multi-lock`). */
  readonly held: ReadonlyMap<PuzzleLocalId, readonly HeldBy[]>;
};

/** One walk over the sections: the rooms and hotspot keys a clue may name, and the locks that hold each puzzle. */
function placesOf(w: WorldSource): Places {
  const rooms = new Set<string>();
  const hotspots = new Set<string>();
  const held = new Map<PuzzleLocalId, HeldBy[]>();
  for (const [section, s] of entriesOf(w.sections)) {
    for (const [room, r] of entriesOf(s.rooms)) {
      rooms.add(room);
      for (const h of r.hotspots) {
        const key = hotspotKey(room, h.id);
        hotspots.add(key);
        const pid = lockOf(h)?.puzzle ?? null;
        if (pid !== null) {
          held.set(pid, [...(held.get(pid) ?? []), { section, key }]);
        }
      }
    }
  }
  return { rooms, hotspots, held };
}

/** The kind of id a fact names, which the existence check looks up. */
type Named = { readonly kind: 'item' | 'doc' | 'hotspot' | 'room' | 'puzzle'; readonly id: string };

/** The id kind each kernel atom's fact names. A module's atom names none here: its module's lint scopes it. */
const NAMES: Readonly<Partial<Record<string, Named['kind']>>> = {
  held: 'item',
  used: 'item',
  doc: 'doc',
  taken: 'hotspot',
  examined: 'hotspot',
  open: 'hotspot',
  visited: 'room',
  solved: 'puzzle',
  failed: 'puzzle',
};

/** The first fact `c` reads (in tree order, a `not`'s too) that names no id of the world, or null. */
function unnamed(w: WorldSource, places: Places, c: Cond): Named | null {
  for (const a of condReads(c)) {
    const kind = NAMES[a.kind];
    if (kind !== undefined && !named(w, places, { kind, id: a.id })) {
      return { kind, id: a.id };
    }
  }
  return null;
}

/** Whether the world has the id a fact names. */
function named(w: WorldSource, places: Places, f: Named): boolean {
  switch (f.kind) {
    case 'item':
      return Object.hasOwn(w.items, f.id);
    case 'doc':
      return Object.hasOwn(w.docs, f.id);
    case 'hotspot':
      return places.hotspots.has(f.id);
    case 'room':
      return places.rooms.has(f.id);
    case 'puzzle':
      return Object.hasOwn(w.puzzles, f.id);
    default: {
      const never: never = f.kind;
      return never;
    }
  }
}

/**
 * The keys of `clues` that hold in no state of section S's search from its entry with puzzle `pid`'s end removed: no
 * `puzzle-ended` step of `pid`, solved or failed (critique W1: a failure that opens its own lock is no way to the clue
 * while the puzzle can be solved; `closed` stays, Back leaves the puzzle open). A clue holds where its whole condition
 * holds in one reached state (an `all` where every conjunct does), tested on the start and on every reported
 * successor, known and leaving edges too, so a fact the section key does not hold (`examined`, `visited`) is seen at
 * the edge that sets it (D4). Null at the cap: `world/state-cap` already fails the section.
 */
function unseenClues(pub: KernelWorld, section: SectionId, pid: PuzzleLocalId, clues: ReadonlyMap<number, Cond>): number[] | null {
  const missing = new Map(clues);
  const observe = (s: WorldState): void => {
    for (const [i, c] of missing) {
      if (holds(pub, s, c)) {
        missing.delete(i);
      }
    }
  };
  const start = sectionEntry(pub, EMPTY_WORLD_STATE, section);
  observe(start);
  const r = searchSection(pub, start, section, RESUME_STATE_CAP, {
    exclude: (st) => st.kind === 'puzzle-ended' && st.puzzle === pid,
    onEdge: (_from, succ) => observe(succ.state),
  });
  return r.result === 'cap' ? null : [...missing.keys()];
}

/**
 * The clue findings of one world: `world/clue-declared` for a secret puzzle a lock holds with no clue (a linear
 * puzzle's clue is the story's, RULINGS 180 Q1-A), `world/reach-has-clue` for a shown goal with one, and
 * `world/clue-reachable` for a clue (a condition, §4) with a fact that names no id of this world or, on a puzzle
 * exactly one lock holds, that holds in no state reached before the puzzle ends (a linear puzzle's order is the
 * story's: GM9p; a puzzle on two locks is `world/puzzle-multi-lock`'s). `types` is the registry the world was decoded
 * with (a fixture type in tests).
 */
export function clueFindings(input: WorldLintInput, types: PuzzleTypes = PUZZLE_TYPES): Finding[] {
  const out: Finding[] = [];
  const report = (code: ClueCode, path: string, message: string): void => {
    out.push({ code, severity: CLUE_CODES[code], file: input.file, line: input.line(path), message });
  };
  const w = input.world;
  const places = placesOf(w);
  let pub: KernelWorld | null = null; // built at the first search: a world with no lock clue never searches
  for (const [pid, p] of entriesOf(w.puzzles)) {
    const goal = types.find((d) => d.type === p.type)?.goal;
    const locks = places.held.get(pid) ?? [];
    if (goal === 'secret' && locks.length > 0 && p.clues.length === 0) {
      report('world/clue-declared', `puzzles.${pid}`, `puzzle '${pid}' (${p.type}, a secret goal) declares no clue: clues names the fact that shows its answer (§7.3, I4)`);
    }
    if (goal === 'shown' && p.clues.length > 0) {
      report('world/reach-has-clue', `puzzles.${pid}.clues`, `puzzle '${pid}' (${p.type}) draws its goal: it declares no clue (§7.3)`);
    }
    const clues = new Map<number, Cond>();
    p.clues.forEach((c, i) => {
      const missing = unnamed(w, places, c);
      if (missing === null) {
        clues.set(i, c);
      } else {
        report('world/clue-reachable', `puzzles.${pid}.clues.${i}`, `puzzle '${pid}': clue ${JSON.stringify(c)} names no ${missing.kind} of this world`);
      }
    });
    const [lock] = locks;
    if (lock === undefined || locks.length > 1 || clues.size === 0) {
      continue;
    }
    // The proof world carries the decoded `mods`, as the explore controller's does (critique W1).
    pub ??= { ...toPublic(w), mods: w.mods };
    for (const i of unseenClues(pub, lock.section, pid, clues) ?? []) {
      const message = `puzzle '${pid}': clue ${JSON.stringify(p.clues[i])} holds in no state of section ${lock.section} reached before '${pid}' is solved or failed (§7.3)`;
      report('world/clue-reachable', `puzzles.${pid}.clues.${i}`, message);
    }
  }
  return out;
}

function same(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * The reach findings of one world (§7.4, R8, R8b), per puzzle whose type `types` holds (an unknown type is the
 * decoder's): `world/attempts-without-wrong` for `maxAttempts` on a type whose `wrong` is 'none'; for a reach type,
 * `world/unique-solution` for two or more solutions or a search stopped at its bound, and `world/reach-solution` for a
 * lint half without `solve` / `reached` / `canonical`, no solution (an exhausted search), a `solve` that its play half's
 * own `reached` refuses or that `canonical` reorders, and a start that already reaches. One root cause, one finding: a
 * stopped search is only `world/unique-solution`'s. `lints` and `types` are the registries (a fixture type in tests).
 */
export function reachFindings(input: WorldLintInput, lints: PuzzleLintRegistry = PUZZLE_LINTS, types: PuzzleTypes = PUZZLE_TYPES): Finding[] {
  const out: Finding[] = [];
  const report = (code: ReachCode, path: string, message: string): void => {
    out.push({ code, severity: REACH_CODES[code], file: input.file, line: input.line(path), message });
  };
  for (const [pid, p] of entriesOf(input.world.puzzles)) {
    const data = types.find((d) => d.type === p.type);
    if (data === undefined) {
      continue;
    }
    if (data.wrong === 'none' && p.maxAttempts !== null) {
      const message = `puzzle '${pid}' (${p.type}) has maxAttempts ${p.maxAttempts}, but its type has no wrong answer: the count never moves`;
      report('world/attempts-without-wrong', `puzzles.${pid}.maxAttempts`, message);
    }
    if (data.check !== 'reach') {
      continue;
    }
    const at = `puzzles.${pid}.params`;
    const lint = Object.hasOwn(lints, p.type) ? lints[p.type] : undefined;
    if (lint?.solve === undefined || lint.reached === undefined || lint.canonical === undefined) {
      report('world/reach-solution', at, `puzzle '${pid}' (${p.type}): its type's lint half has no solve, reached or canonical (§7.4)`);
      continue;
    }
    const count = lint.countSolutions(p.params, 2);
    if (count === 2) {
      report('world/unique-solution', at, `puzzle '${pid}' (${p.type}) has two or more solutions: a reach puzzle posts its one solution (§7.4)`);
    } else if (count === null) {
      report('world/unique-solution', at, `puzzle '${pid}' (${p.type}): the solution search stopped at its bound before it proved one solution (§7.4)`);
    }
    const s = lint.solve(p.params);
    if (s === null) {
      if (count !== null) {
        report('world/reach-solution', at, `puzzle '${pid}' (${p.type}) has no solution: no answer reaches its goal (§7.4)`);
      }
    } else if (!lint.reached(p.params, s)) {
      report('world/reach-solution', at, `puzzle '${pid}' (${p.type}): its solve [${s.join(', ')}] does not reach its goal by the device's own rule (R8)`);
    } else if (!same(lint.canonical(p.params, s), s)) {
      const posted = lint.canonical(p.params, s);
      report('world/reach-solution', at, `puzzle '${pid}' (${p.type}): its solve [${s.join(', ')}] is not canonical: the device posts [${posted.join(', ')}] (R8b)`);
    }
    if (lint.reached(p.params, data.initial(p.params))) {
      report('world/reach-solution', at, `puzzle '${pid}' (${p.type}) is reached at its start: it would post before any input (§7.4)`);
    }
  }
  return out;
}

export const CLUES_LINT: WorldLint<ClueCode | ReachCode> = {
  id: 'clues',
  codes: { ...CLUE_CODES, ...REACH_CODES },
  lint: (input) => [...clueFindings(input), ...reachFindings(input)],
};
