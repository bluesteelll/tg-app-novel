// Module `use`'s rules half (engine plan §6.1): item-first use. A held item used on a target runs the target's first
// rule for that item whose `when` holds; else a lock target takes the item through core's insert fit; else the use is
// refused with the item's, else the room's, `refuse` text. A keeping slot leaves its item held (tools that stay).
// Explore-ui chunk code (the `rules-lazy` arch rule): rules/index.ts builds the entry from these function declarations,
// as it does core's (the core.ts <-> use.ts <-> index.ts imports are function declarations only). Pure.
import { hotspotKey, lockOf, own, worldIndex } from '../../explore/reduce.ts';
import type { WorldState } from '../../explore/state.ts';
import type { SectionId } from '../../story/staging.ts';
import type { HotspotKey, ItemId } from '../../world/types.ts';
import type { Cause, FactAtom, KernelWorld, ModuleScope, TriggerKey } from '../contract.ts';
import { condReads } from '../data/conditions.ts';
import type { UseData, UseRule } from '../data/use.ts';
import { holds } from './conditions.ts';
import { insertItem } from './core.ts';
import { present } from './flags.ts';
import { added } from './writer.ts';
import type { KernelWriter } from './writer.ts';

export type UseAction = { kind: 'use'; item: ItemId; target: HotspotKey };
/** `module:use:said` on every rule run, `module:use:refused` on a refusal (never core's `refused`). */
export type UseCue = 'refused' | 'said';

const NO_RULES: readonly UseRule[] = [];

function rulesOf(d: UseData, target: HotspotKey): readonly UseRule[] {
  return own(d.uses, target) ?? NO_RULES;
}

/** The index of the target's first rule for `item` whose `when` holds in `s`; -1: none. */
function firstRule(w: KernelWorld, s: WorldState, rules: readonly UseRule[], item: ItemId): number {
  return rules.findIndex((r) => r.item === item && (r.when === null || holds(w, s, r.when)));
}

/**
 * A hotspot the player sees in the current room of a current section with no event knot pending (a taken take is gone,
 * and a hidden one is absent: its `when`, module `flags`).
 */
function visible(w: KernelWorld, s: WorldState, target: HotspotKey): boolean {
  const entry = worldIndex(w).hotspots.get(target);
  return (
    s.section !== null &&
    s.pendingStory.length === 0 &&
    entry !== undefined &&
    entry.room === s.room &&
    !(entry.hotspot.kind === 'take' && s.taken.includes(target)) &&
    present(w, s, target)
  );
}

/** `use {item, target}`: the first matching rule, else the lock fit, else the refusal chain (§6.1 "Action"). */
export function applyUse(w: KernelWorld, a: UseAction, out: KernelWriter<'use', UseCue>): void {
  const s = out.state;
  const d = w.mods?.use;
  if (d === undefined || !visible(w, s, a.target) || !s.held.includes(a.item)) {
    return;
  }
  const cause: Cause = { verb: 'use', at: a.target, item: a.item, via: null };
  const rules = rulesOf(d, a.target);
  const i = firstRule(w, s, rules, a.item);
  const rule = rules[i];
  if (rule !== undefined) {
    if (!rule.keep) {
      out.set('held', s.held.filter((x) => x !== a.item), cause);
      out.set('used', added(s.used, a.item), cause);
    }
    // Fire-once, the kernel's trigger rule: an empty `do` records nothing, so a say-only rule repeats.
    out.fire(`use:${a.target}#${i}` as TriggerKey, rule.do, cause); // the module's own `fired` prefix (`owns.trigger`)
    if (rule.say !== null) {
      out.effect({ kind: 'look', text: rule.say, at: a.target });
    }
    out.cue('use', 'said', a.target, a.item);
    return;
  }
  const entry = worldIndex(w).hotspots.get(a.target);
  const lock = entry === undefined ? null : lockOf(entry.hotspot);
  if (lock !== null && insertItem(out, a.target, a.item, cause)) {
    return;
  }
  // Refused: nothing written. The item's text, else the room's; with neither, the UI's default (GM3u).
  out.effect({ kind: 'refused', at: a.target, item: a.item, reason: lock === null ? 'no-rule' : 'no-fit' });
  const text = own(d.refuse.items, a.item) ?? (s.room === null ? undefined : own(d.refuse.rooms, s.room));
  if (text !== undefined) {
    out.effect({ kind: 'look', text, at: a.target });
  }
  out.cue('use', 'refused', a.target, a.item);
}

/**
 * Every held item x visible target pair whose first matching rule exists and holds; a pair whose only effect would be
 * the lock fit stays `insert`'s (core's actions), so the search sees each edge once.
 */
export function useActions(w: KernelWorld, s: WorldState): UseAction[] {
  const d = w.mods?.use;
  const room = s.room === null ? undefined : worldIndex(w).rooms.get(s.room);
  if (d === undefined || room === undefined || s.room === null) {
    return [];
  }
  // Sorted, as core's inserts: two states that differ only in the order items were taken list the same actions.
  const held = [...s.held].sort();
  const out: UseAction[] = [];
  for (const h of room.room.hotspots) {
    const target = hotspotKey(s.room, h.id);
    const rules = rulesOf(d, target);
    if (rules.length === 0 || !visible(w, s, target)) {
      continue;
    }
    for (const item of held) {
      if (firstRule(w, s, rules, item) !== -1) {
        out.push({ kind: 'use', item, target });
      }
    }
  }
  return out;
}

/** The targets in `section` that carry rules, with their rules. */
function rulesIn(w: KernelWorld, section: SectionId): Array<[HotspotKey, readonly UseRule[]]> {
  const d = w.mods?.use;
  if (d === undefined) {
    return [];
  }
  const ix = worldIndex(w);
  // The keys of a decoded `uses` are hotspot keys.
  return (Object.entries(d.uses) as Array<[HotspotKey, readonly UseRule[]]>).filter(([key]) => ix.hotspots.get(key)?.section === section);
}

/**
 * `use`'s share of S's own facts (`MechanicRules.scope`): every item a rule of a target in S gives, and the `fired` key
 * of each such rule with a non-empty `do` (an empty one records nothing, so it is no fact).
 */
export function useScope(w: KernelWorld, section: SectionId): ModuleScope {
  const items: ItemId[] = [];
  const fired: TriggerKey[] = [];
  for (const [key, rules] of rulesIn(w, section)) {
    rules.forEach((r, i) => {
      if (r.do.length > 0) {
        fired.push(`use:${key}#${i}` as TriggerKey); // the module's own `fired` prefix
      }
      for (const e of r.do) {
        if ('give' in e) {
          items.push(e.give);
        }
      }
    });
  }
  return { items, fired };
}

/**
 * Every fact `use`'s rules read in S: `held` / `used` and `fired` of its share of S's own facts (`useScope`, the one
 * definition the reset composes), and per rule of a target in S `held` / `used` of its item and every atom of its
 * `when` (both S's own facts by `world/use-cross-section`).
 */
export function useReads(w: KernelWorld, section: SectionId): readonly FactAtom[] {
  const scope = useScope(w, section);
  const atoms: FactAtom[] = [];
  const item = (id: ItemId): void => {
    atoms.push({ kind: 'held', id }, { kind: 'used', id });
  };
  scope.items.forEach(item);
  for (const id of scope.fired) {
    atoms.push({ kind: 'fired', id });
  }
  for (const [, rules] of rulesIn(w, section)) {
    for (const r of rules) {
      item(r.item);
      if (r.when !== null) {
        atoms.push(...condReads(r.when));
      }
    }
  }
  return atoms;
}

/** Whether the slot `index` of lock `key` keeps its item held (`keep: true`). */
export function keepsSlot(w: KernelWorld, key: HotspotKey, index: number): boolean {
  return w.mods?.use.keep.includes(`${key}#${index}`) === true;
}
