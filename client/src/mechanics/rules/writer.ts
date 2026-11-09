// The writer (engine plan §3.1 `Writer`): the write path of a mechanic module's rules over the reducer's draft, and the
// kernel trigger runner every rule fires through. `reduce` (core.ts) builds one per action and hands it to the modules'
// hooks; core's own rules write the draft directly. Rules half: explore-ui chunk code (the `rules-lazy` arch rule).
// Pure.
import { lockOf, runOf, set, setRun } from '../../explore/reduce.ts';
import type { Draft, ExploreEffect } from '../../explore/reduce.ts';
import type { PuzzleRun, WorldState } from '../../explore/state.ts';
import type { PuzzleLocalId } from '../../story/staging.ts';
import type { Effect, HotspotKey, ItemId, WorldPublicBody } from '../../world/types.ts';
import type { Cause, ListField, MechanicId, RulesRegistry, TriggerKey, Writer } from '../contract.ts';

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

/** The kernel's writer: the module-facing `Writer` plus what core's rules and hooks reach through it. */
export type KernelWriter = Writer & {
  readonly draft: Draft;
  readonly world: WorldPublicBody;
  readonly rules: RulesRegistry;
  readonly cues: readonly ModuleCue[];
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
  #cues: ModuleCue[] | null = null;

  constructor(d: Draft, w: WorldPublicBody, rules: RulesRegistry) {
    this.draft = d;
    this.world = w;
    this.rules = rules;
  }

  get state(): WorldState {
    return this.draft.s;
  }

  get cues(): readonly ModuleCue[] {
    return this.#cues ?? NONE;
  }

  set<K extends ListField>(field: K, value: WorldState[K], _cause: Cause): void {
    if (!sameList<unknown>(this.draft.s[field], value)) {
      set(this.draft, field, value);
    }
  }

  run(puzzle: PuzzleLocalId, run: PuzzleRun, _cause: Cause): void {
    if (!sameRun(runOf(this.draft.s, puzzle), run)) {
      setRun(this.draft, puzzle, run);
    }
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
