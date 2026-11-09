// The writer (engine plan §3.1 `Writer`): the write path of a mechanic module's rules over the reducer's draft, and the
// kernel trigger runner every rule fires through. `reduce` (core.ts) builds one per action and hands it to the modules'
// hooks; core's own rules write the draft directly. Rules half: explore-ui chunk code (the `rules-lazy` arch rule).
// Pure.
import { lockOf, runOf, set, setRun } from '../../explore/reduce.ts';
import type { Draft, ExploreEffect } from '../../explore/reduce.ts';
import type { PuzzleRun, WorldState } from '../../explore/state.ts';
import type { PuzzleLocalId } from '../../story/staging.ts';
import type { Effect, HotspotKey, ItemId, WorldPublicBody } from '../../world/types.ts';
import type { ArrivalOut, Cause, FactKind, KernelFactKind, ListField, MechanicId, RulesRegistry, TriggerKey, Writer } from '../contract.ts';

export function added<T>(list: readonly T[], v: T): readonly T[] {
  return list.includes(v) ? list : [...list, v];
}

/** Every trigger fires at most once; an empty one is never recorded, so it adds no state. */
export function fire(d: Draft, firedKey: string, effects: readonly Effect[]): void {
  if (effects.length === 0 || d.s.fired.includes(firedKey)) {
    return;
  }
  set(d, 'fired', [...d.s.fired, firedKey]);
  for (const e of effects) {
    if ('give' in e) {
      if (d.ix.items.has(e.give)) {
        set(d, 'held', added(d.s.held, e.give));
        d.effects.push({ kind: 'got', gift: { item: e.give } });
      }
    } else if ('unlock' in e) {
      openKey(d, e.unlock);
    } else {
      set(d, 'pendingStory', [...d.s.pendingStory, e.story]);
    }
  }
}

/** A key entering `open` runs its lock's `onOpen` once, whatever the cause. */
export function openKey(d: Draft, key: HotspotKey): void {
  const entry = d.ix.hotspots.get(key);
  const lock = entry === undefined ? null : lockOf(entry.hotspot);
  if (lock === null || d.s.open.includes(key)) {
    return;
  }
  set(d, 'open', [...d.s.open, key]);
  fire(d, `open:${key}`, lock.onOpen);
}

/** A module cue as the writer recorded it. */
export type ModuleCue = { readonly module: MechanicId; readonly name: string; readonly at: HotspotKey | null; readonly item: ItemId | null };
/** One fact entering or leaving the state through the writer, with the cause the rule gave. */
export type FactChange = { readonly kind: FactKind; readonly id: string; readonly change: 'added' | 'removed'; readonly cause: Cause };

/** The kernel's writer: the module-facing `Writer` plus what core's rules and hooks reach through it. */
export type KernelWriter = Writer & {
  readonly draft: Draft;
  readonly world: WorldPublicBody;
  readonly rules: RulesRegistry;
  /** Every fact change a `set` or `run` made, in order. */
  readonly changes: readonly FactChange[];
  readonly cues: readonly ModuleCue[];
};

/** The fact kind of each list field's members. */
const FACT_OF: { readonly [F in ListField]: KernelFactKind } = {
  visited: 'visited',
  held: 'held',
  used: 'used',
  docs: 'doc',
  taken: 'taken',
  examined: 'examined',
  open: 'open',
  fired: 'fired',
  pendingStory: 'story',
};

const NONE: readonly never[] = Object.freeze([]);

function sameList<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function sameRun(a: PuzzleRun, b: PuzzleRun): boolean {
  return a.outcome === b.outcome && a.attempts === b.attempts && a.hintsOpened === b.hintsOpened;
}

// A class, so a `reduce` call allocates one object: the search builds a writer per successor.
class DraftWriter implements KernelWriter {
  readonly draft: Draft;
  readonly world: WorldPublicBody;
  readonly rules: RulesRegistry;
  #changes: FactChange[] | null = null;
  #cues: ModuleCue[] | null = null;

  constructor(d: Draft, w: WorldPublicBody, rules: RulesRegistry) {
    this.draft = d;
    this.world = w;
    this.rules = rules;
  }

  get state(): WorldState {
    return this.draft.s;
  }

  get changes(): readonly FactChange[] {
    return this.#changes ?? NONE;
  }

  get cues(): readonly ModuleCue[] {
    return this.#cues ?? NONE;
  }

  #record(kind: FactKind, id: string, change: FactChange['change'], cause: Cause): void {
    (this.#changes ??= []).push({ kind, id, change, cause });
  }

  /** Records the removed members in their old order, then the added members in their new order. */
  set<K extends ListField>(field: K, value: WorldState[K], cause: Cause): void {
    const before: readonly string[] = this.draft.s[field];
    if (sameList<string>(before, value)) {
      return;
    }
    const kind = FACT_OF[field];
    const now = new Set<string>(value);
    const was = new Set<string>(before);
    for (const x of before) {
      if (!now.has(x)) {
        this.#record(kind, x, 'removed', cause);
      }
    }
    for (const x of value) {
      if (!was.has(x)) {
        this.#record(kind, x, 'added', cause);
      }
    }
    set(this.draft, field, value);
  }

  /** Records the outcome that left and the one that came, then a changed attempt or hint count. */
  run(puzzle: PuzzleLocalId, run: PuzzleRun, cause: Cause): void {
    const before = runOf(this.draft.s, puzzle);
    if (sameRun(before, run)) {
      return;
    }
    if (before.outcome !== run.outcome) {
      if (before.outcome !== null) {
        this.#record(before.outcome, puzzle, 'removed', cause);
      }
      if (run.outcome !== null) {
        this.#record(run.outcome, puzzle, 'added', cause);
      }
    }
    if (before.attempts !== run.attempts) {
      this.#record('attempt', puzzle, run.attempts > before.attempts ? 'added' : 'removed', cause);
    }
    if (before.hintsOpened !== run.hintsOpened) {
      this.#record('hint', puzzle, run.hintsOpened > before.hintsOpened ? 'added' : 'removed', cause);
    }
    setRun(this.draft, puzzle, run);
  }

  fire(trigger: TriggerKey, effects: readonly Effect[], _cause: Cause): void {
    fire(this.draft, trigger, effects);
  }

  effect(e: ExploreEffect): void {
    this.draft.effects.push(e);
  }

  cue(module: MechanicId, name: string, at: HotspotKey | null, item: ItemId | null): void {
    (this.#cues ??= []).push({ module, name, at, item });
  }
}

/** The writer of one `reduce` call over its draft. */
export function createWriter(d: Draft, w: WorldPublicBody, rules: RulesRegistry): KernelWriter {
  return new DraftWriter(d, w, rules);
}

/** The arrival hook's narrow view of the writer: a `puzzle` effect into the draft, a module cue into the record. */
export function arrivalOut(out: KernelWriter): ArrivalOut {
  return {
    effect: (e) => {
      out.effect(e);
    },
    cue: (module, name, at) => {
      out.cue(module, name, at, null);
    },
  };
}
