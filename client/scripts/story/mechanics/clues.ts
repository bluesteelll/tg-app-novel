// The clue lints of engine plan §7.3 (I4: a secret goal never ships, so the world must show it): a secret puzzle a
// lock holds declares the facts that show its answer, a shown goal declares none, and each declared fact holds in a
// state the player reaches before the puzzle is over. A build pass of the world lint registry (§3.2). Build only and
// pure, no node:*: world.ts imports the registry and scan-dist.ts imports world.ts. Its imports from index.ts and
// lint.ts are `import type`; it never imports world.ts (index.ts's value graph has no edge back).
import { RESUME_STATE_CAP, hotspotKey, lockOf, runOf } from '../../../src/explore/reduce.ts';
import { EMPTY_WORLD_STATE } from '../../../src/explore/state.ts';
import type { WorldState } from '../../../src/explore/state.ts';
import { searchSection, sectionEntry } from '../../../src/mechanics/rules/search.ts';
import { PUZZLE_TYPES } from '../../../src/puzzles/rules/index.ts';
import type { PuzzleTypes } from '../../../src/puzzles/rules/index.ts';
import type { PuzzleLocalId, SectionId } from '../../../src/story/staging.ts';
import { toPublic } from '../../../src/world/decode.ts';
import type { ClueAtom, HotspotKey, WorldPublicBody, WorldSource } from '../../../src/world/types.ts';
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

/** What a clue atom names (the kind of id the existence check looks up) and whether it holds in a state. */
type Fact = { readonly kind: 'item' | 'doc' | 'hotspot' | 'room' | 'puzzle'; readonly id: string; holds(s: WorldState): boolean };

function factOf(a: ClueAtom): Fact {
  if ('held' in a) {
    return { kind: 'item', id: a.held, holds: (s) => s.held.includes(a.held) };
  }
  if ('used' in a) {
    return { kind: 'item', id: a.used, holds: (s) => s.used.includes(a.used) };
  }
  if ('has' in a) {
    return { kind: 'item', id: a.has, holds: (s) => s.held.includes(a.has) || s.used.includes(a.has) };
  }
  if ('doc' in a) {
    return { kind: 'doc', id: a.doc, holds: (s) => s.docs.includes(a.doc) };
  }
  if ('taken' in a) {
    return { kind: 'hotspot', id: a.taken, holds: (s) => s.taken.includes(a.taken) };
  }
  if ('examined' in a) {
    return { kind: 'hotspot', id: a.examined, holds: (s) => s.examined.includes(a.examined) };
  }
  if ('open' in a) {
    return { kind: 'hotspot', id: a.open, holds: (s) => s.open.includes(a.open) };
  }
  if ('visited' in a) {
    return { kind: 'room', id: a.visited, holds: (s) => s.visited.includes(a.visited) };
  }
  if ('solved' in a) {
    return { kind: 'puzzle', id: a.solved, holds: (s) => runOf(s, a.solved).outcome === 'solved' };
  }
  return { kind: 'puzzle', id: a.failed, holds: (s) => runOf(s, a.failed).outcome === 'failed' };
}

/** Whether the world has the id a fact names. */
function named(w: WorldSource, places: Places, f: Fact): boolean {
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
 * The keys of `facts` that hold in no state of section S's search from its entry with puzzle `pid`'s end removed:
 * no `puzzle-ended` step of `pid`, solved or failed (critique W1: a failure that opens its own lock is no way to the
 * clue while the puzzle can be solved; `closed` stays, Back leaves the puzzle open). Each fact is tested on the start
 * and on every reported successor, known and leaving edges too, so a fact the section key does not hold (`examined`,
 * `visited`) is seen at the edge that sets it (D4). Null at the cap: `world/state-cap` already fails the section.
 */
function unseenFacts(pub: WorldPublicBody, section: SectionId, pid: PuzzleLocalId, facts: ReadonlyMap<number, Fact>): number[] | null {
  const missing = new Map(facts);
  const observe = (s: WorldState): void => {
    for (const [i, f] of missing) {
      if (f.holds(s)) {
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
 * `world/clue-reachable` for an atom that names no fact of this world or, on a puzzle exactly one lock holds, holds in
 * no state reached before the puzzle ends (a linear puzzle's order is the story's: GM9p; a puzzle on two locks is
 * `world/puzzle-multi-lock`'s). `types` is the registry the world was decoded with (a fixture type in tests).
 */
export function clueFindings(input: WorldLintInput, types: PuzzleTypes = PUZZLE_TYPES): Finding[] {
  const out: Finding[] = [];
  const report = (code: ClueCode, path: string, message: string): void => {
    out.push({ code, severity: CLUE_CODES[code], file: input.file, line: input.line(path), message });
  };
  const w = input.world;
  const places = placesOf(w);
  let pub: WorldPublicBody | null = null; // built at the first search: a world with no lock clue never searches
  for (const [pid, p] of entriesOf(w.puzzles)) {
    const goal = types.find((d) => d.type === p.type)?.goal;
    const locks = places.held.get(pid) ?? [];
    if (goal === 'secret' && locks.length > 0 && p.clues.length === 0) {
      report('world/clue-declared', `puzzles.${pid}`, `puzzle '${pid}' (${p.type}, a secret goal) declares no clue: clues names the fact that shows its answer (§7.3, I4)`);
    }
    if (goal === 'shown' && p.clues.length > 0) {
      report('world/reach-has-clue', `puzzles.${pid}.clues`, `puzzle '${pid}' (${p.type}) draws its goal: it declares no clue (§7.3)`);
    }
    const facts = new Map<number, Fact>();
    p.clues.forEach((a, i) => {
      const f = factOf(a);
      if (named(w, places, f)) {
        facts.set(i, f);
      } else {
        report('world/clue-reachable', `puzzles.${pid}.clues.${i}`, `puzzle '${pid}': clue ${JSON.stringify(a)} names no ${f.kind} of this world`);
      }
    });
    const [lock] = locks;
    if (lock === undefined || locks.length > 1 || facts.size === 0) {
      continue;
    }
    pub ??= toPublic(w);
    for (const i of unseenFacts(pub, lock.section, pid, facts) ?? []) {
      const message = `puzzle '${pid}': clue ${JSON.stringify(p.clues[i])} holds in no state of section ${lock.section} reached before '${pid}' is solved or failed (§7.3)`;
      report('world/clue-reachable', `puzzles.${pid}.clues.${i}`, message);
    }
  }
  return out;
}

export const CLUES_LINT: WorldLint<ClueCode> = { id: 'clues', codes: CLUE_CODES, lint: (input) => clueFindings(input) };
