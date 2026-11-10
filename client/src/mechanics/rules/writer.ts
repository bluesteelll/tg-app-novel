// The writer (engine plan §3.1 `Writer`): the one write path of every rule over the reducer's draft, core's included,
// and the kernel trigger runner every rule fires through. `reduce` (core.ts) builds one per action, hands it to core and
// to the modules' hooks, and appends its record, every fact change with its cause and every module cue in write order,
// as `cue` effects (plan (2)). Silent fields (`SILENT_FIELDS`: section, room, lastRoom) are written to the draft
// directly. Rules half: explore-ui chunk code (the `rules-lazy` arch rule). Pure.
import { lockOf, own, runOf, set, setRun } from '../../explore/reduce.ts';
import type { Draft, ExploreEffect } from '../../explore/reduce.ts';
import type { Cue } from '../../cues/types.ts';
import type { PuzzleRun, WorldState } from '../../explore/state.ts';
import type { PuzzleLocalId } from '../../story/staging.ts';
import type { Effect, HotspotKey, ItemId } from '../../world/types.ts';
import type { ArrivalOut, Cause, FactKind, KernelFactKind, KernelWorld, ListField, MechanicId, RulesRegistry, TriggerKey, Writer } from '../contract.ts';

export function added<T>(list: readonly T[], v: T): readonly T[] {
  return list.includes(v) ? list : [...list, v];
}

/**
 * Every trigger fires at most once; an empty one is never recorded, so it adds no state. `at`: the hotspot the trigger
 * belongs to (null: a room's `onEnter`), which its gifts name. Its `fired` entry and every write of its effects carry
 * the action's `cause` with `via` = this trigger (a fact's `via` is the trigger running when it was written).
 */
export function fire(out: KernelWriter, firedKey: string, effects: readonly Effect[], at: HotspotKey | null, cause: Cause): void {
  const d = out.draft;
  if (effects.length === 0 || d.s.fired.includes(firedKey)) {
    return;
  }
  const via: Cause = { ...cause, via: firedKey as TriggerKey }; // every fired key is a trigger key
  out.set('fired', [...d.s.fired, firedKey], via);
  for (const e of effects) {
    if ('give' in e) {
      if (d.ix.items.has(e.give)) {
        out.set('held', added(d.s.held, e.give), via);
        d.effects.push({ kind: 'got', gift: { item: e.give }, at });
      }
    } else if ('unlock' in e) {
      openKey(out, e.unlock, via);
    } else {
      out.set('pendingStory', [...d.s.pendingStory, e.story], via);
    }
  }
}

/** A key entering `open` runs its lock's `onOpen` once, whatever the cause. */
export function openKey(out: KernelWriter, key: HotspotKey, cause: Cause): void {
  const d = out.draft;
  const entry = d.ix.hotspots.get(key);
  const lock = entry === undefined ? null : lockOf(entry.hotspot);
  if (lock === null || d.s.open.includes(key)) {
    return;
  }
  out.set('open', [...d.s.open, key], cause);
  fire(out, `open:${key}`, lock.onOpen, key, cause);
}

/** A module cue as the writer recorded it. */
export type ModuleCue = { readonly module: MechanicId; readonly name: string; readonly at: HotspotKey | null; readonly item: ItemId | null };
/** One fact entering or leaving the state through the writer, with the cause the rule gave. */
export type FactChange = { readonly kind: FactKind; readonly id: string; readonly change: 'added' | 'removed'; readonly cause: Cause };
/** One entry of the writer's record: a fact cue or a module cue, as the cue bus takes it. */
export type RecordedCue = Extract<Cue, { kind: 'fact' | 'module' }>;

/**
 * The kernel's writer: the module-facing `Writer` plus what core's rules and hooks reach through it. The registry's
 * dispatch hands it to every module's `apply` and `tap` (`Id` / `C`: that module's id and cue names).
 */
export type KernelWriter<Id extends string = string, C extends string = string> = Writer<Id, C> & {
  readonly draft: Draft;
  readonly world: KernelWorld;
  readonly rules: RulesRegistry;
  /** Every fact change and module cue, in write order: `reduce` appends them as `cue` effects. */
  readonly record: readonly RecordedCue[];
  /** The record's fact changes (a `set`, `run` or `slots`), in order. */
  readonly changes: readonly FactChange[];
  /** The record's module cues, in order. */
  readonly cues: readonly ModuleCue[];
  /** Kernel only: lock `key`'s cells, a `slot` fact (id: the lock key) added as a cell fills, removed as one empties. */
  slots(key: HotspotKey, cells: ReadonlyArray<ItemId | null>, cause: Cause): void;
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
  readonly world: KernelWorld;
  readonly rules: RulesRegistry;
  #record: RecordedCue[] | null = null;

  constructor(d: Draft, w: KernelWorld, rules: RulesRegistry) {
    this.draft = d;
    this.world = w;
    this.rules = rules;
  }

  get state(): WorldState {
    return this.draft.s;
  }

  get record(): readonly RecordedCue[] {
    return this.#record ?? NONE;
  }

  get changes(): readonly FactChange[] {
    return this.record.flatMap((c) => (c.kind === 'fact' ? [{ kind: c.fact.kind, id: c.fact.id, change: c.change, cause: c.cause }] : []));
  }

  get cues(): readonly ModuleCue[] {
    return this.record.flatMap((c) => (c.kind === 'module' ? [{ module: c.module, name: c.name, at: c.at, item: c.item }] : []));
  }

  #fact(kind: FactKind, id: string, change: FactChange['change'], cause: Cause): void {
    (this.#record ??= []).push({ kind: 'fact', fact: { kind, id }, change, cause });
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
        this.#fact(kind, x, 'removed', cause);
      }
    }
    for (const x of value) {
      if (!was.has(x)) {
        this.#fact(kind, x, 'added', cause);
      }
    }
    set(this.draft, field, value);
  }

  slots(key: HotspotKey, cells: ReadonlyArray<ItemId | null>, cause: Cause): void {
    const before = own(this.draft.s.slots, key) ?? NONE;
    if (sameList(before, cells)) {
      return;
    }
    const filled = (c: ReadonlyArray<ItemId | null>): number => c.filter((x) => x !== null).length;
    this.#fact('slot', key, filled(cells) >= filled(before) ? 'added' : 'removed', cause);
    set(this.draft, 'slots', { ...this.draft.s.slots, [key]: cells });
  }

  /** Records the outcome that left and the one that came, then a changed attempt or hint count. */
  run(puzzle: PuzzleLocalId, run: PuzzleRun, cause: Cause): void {
    const before = runOf(this.draft.s, puzzle);
    if (sameRun(before, run)) {
      return;
    }
    if (before.outcome !== run.outcome) {
      if (before.outcome !== null) {
        this.#fact(before.outcome, puzzle, 'removed', cause);
      }
      if (run.outcome !== null) {
        this.#fact(run.outcome, puzzle, 'added', cause);
      }
    }
    if (before.attempts !== run.attempts) {
      this.#fact('attempt', puzzle, run.attempts > before.attempts ? 'added' : 'removed', cause);
    }
    if (before.hintsOpened !== run.hintsOpened) {
      this.#fact('hint', puzzle, run.hintsOpened > before.hintsOpened ? 'added' : 'removed', cause);
    }
    setRun(this.draft, puzzle, run);
  }

  fire(trigger: TriggerKey, effects: readonly Effect[], cause: Cause): void {
    fire(this, trigger, effects, cause.at, cause);
  }

  effect(e: ExploreEffect): void {
    this.draft.effects.push(e);
  }

  // The widest signature, so this one writer is every module's: each module's rules see only their own names.
  cue(module: string, name: string, at: HotspotKey | null, item: ItemId | null): void {
    (this.#record ??= []).push({ kind: 'module', module: module as MechanicId, name, at, item }); // a module's own id, typed by its rules half
  }
}

/** The writer of one `reduce` call over its draft. */
export function createWriter(d: Draft, w: KernelWorld, rules: RulesRegistry): KernelWriter {
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
