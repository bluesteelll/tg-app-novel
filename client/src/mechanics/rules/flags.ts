// Module `flags`'s rules half (engine plan §6.5): a `{ set: <flag> }` effect runs among its trigger's kernel effects
// at its source index (the runner's `effects` hook) and adds the flag once; the atom `{ flag: <id> }` holds while the
// flag is set; a section's reset clears the flags it declares (`scope`). A hotspot's `when` is its presence
// (`present`): a hidden hotspot is no action (tap, insert, use), draws nothing, has no hit area and is no way back;
// core, use, visual, the search and the explore controller read it here. The atoms of S's `when`s are S's key facts
// (`reads`). It enables no action and emits no module cue: a flag's change is the fact cue `fact:flag:added` the writer
// records. Every read of the module's data goes through `w.mods?.flags`: the soft-lock proof also runs a public body
// without `mods`, which has no flag and no gate. Explore-ui chunk code (the `rules-lazy` arch rule): rules/index.ts
// builds the entry from these function declarations, and the registry is read only inside function bodies. Pure.
import { own, worldIndex } from '../../explore/reduce.ts';
import type { WorldState } from '../../explore/state.ts';
import type { SectionId } from '../../story/staging.ts';
import type { HotspotKey } from '../../world/types.ts';
import type { Cause, FactAtom, FlagId, KernelWorld, ModuleEffect, ModuleScope, TriggerKey } from '../contract.ts';
import { condReads } from '../data/conditions.ts';
import type { Cond } from '../data/conditions.ts';
import type { FlagsData } from '../data/flags.ts';
import { holds } from './conditions.ts';
import { added } from './writer.ts';
import type { KernelWriter } from './writer.ts';

/** The module enables no action: a flag changes only through a trigger's `set`. */
export type FlagsAction = never;

const NO_EFFECTS: readonly ModuleEffect[] = [];

// Per decoded data: each trigger's sets, by trigger key, in source index order. A module-level const read only inside
// function bodies (the registry cycle's rule, rules/index.ts).
const SETS = new WeakMap<FlagsData, ReadonlyMap<string, readonly ModuleEffect[]>>();

/** The set effect of flag `f`: idempotent, a fact cue only when the flag is new. */
function setOf(index: number, f: FlagId): ModuleEffect {
  return {
    index,
    run: (out: KernelWriter, via: Cause) => {
      out.set('flags', added(out.state.flags, f), via);
    },
  };
}

function setsByTrigger(d: FlagsData): ReadonlyMap<string, readonly ModuleEffect[]> {
  const cached = SETS.get(d);
  if (cached !== undefined) {
    return cached;
  }
  const out = new Map<string, ModuleEffect[]>();
  for (const [id, f] of Object.entries(d.sets)) {
    // `<trigger>#<source index>`: a trigger key holds no '#', so the last one splits it.
    const hash = id.lastIndexOf('#');
    const trigger = id.slice(0, hash);
    const list = out.get(trigger) ?? [];
    list.push(setOf(Number(id.slice(hash + 1)), f));
    out.set(trigger, list);
  }
  for (const list of out.values()) {
    list.sort((a, b) => a.index - b.index);
  }
  SETS.set(d, out);
  return out;
}

/** The runner's hook (`MechanicRules.effects`): the sets of `trigger`, each at its source index. */
export function flagEffects(w: KernelWorld, trigger: TriggerKey): readonly ModuleEffect[] {
  const d = w.mods?.flags;
  return d === undefined ? NO_EFFECTS : (setsByTrigger(d).get(trigger) ?? NO_EFFECTS);
}

/** `{ flag: <id> }` holds while the flag is set. */
export function holdsFlag(_w: KernelWorld, s: WorldState, atom: { readonly kind: string; readonly value: unknown }): boolean {
  return typeof atom.value === 'string' && s.flags.includes(atom.value as FlagId); // a decoded flag atom's value is a flag id
}

/** `flags`' share of S's own facts (`MechanicRules.scope`): the flags S declares, which only S's reset clears. */
export function flagScope(w: KernelWorld, section: SectionId): ModuleScope {
  const d = w.mods?.flags;
  const flags = d === undefined ? [] : (Object.keys(d.flags) as FlagId[]).filter((f) => d.flags[f]?.section === section); // a decoded record's keys are flag ids
  return { items: [], fired: [], flags };
}

/**
 * Whether hotspot `key` is present in `s`: it has no `when`, or its `when` holds. A world without the module's data
 * (the mods-less proof body) gates nothing.
 */
export function present(w: KernelWorld, s: WorldState, key: HotspotKey): boolean {
  const d = w.mods?.flags;
  const c = d === undefined ? undefined : own(d.when, key);
  return c === undefined || holds(w, s, c);
}

/** Whether hotspot `key` has a `when` at all, whatever the state (the place quotient's (a2): a gated entry). */
export function gated(w: KernelWorld, key: HotspotKey): boolean {
  const d = w.mods?.flags;
  return d !== undefined && Object.hasOwn(d.when, key);
}

/** Every fact the `when`s of S's hotspots read (a gating condition reads S's own facts, `world/flag-scope`). */
export function flagReads(w: KernelWorld, section: SectionId): readonly FactAtom[] {
  const d = w.mods?.flags;
  if (d === undefined) {
    return [];
  }
  const ix = worldIndex(w);
  const atoms: FactAtom[] = [];
  for (const [key, c] of Object.entries(d.when) as Array<[HotspotKey, Cond]>) {
    // The keys of a decoded `when` table are hotspot keys.
    if (ix.hotspots.get(key)?.section === section) {
      atoms.push(...condReads(c));
    }
  }
  return atoms;
}

/** No action: a flag changes only when a trigger sets it. */
export function flagsActions(): readonly FlagsAction[] {
  return [];
}

/** Never called: the module has no action kind. */
export function applyFlags(): void {}
