// The world's module texts (engine plan §3.2 "Module texts"; per-player R-E25): the types of a module's text walker,
// the kernel's roles as data, and the gate that refuses a module text no walker returns (`world/text-unwalked`).
// world.ts runs the one walk of world texts (`worldLines`, its private `moduleTextsOf`) and hands the walked IDs in
// through `WorldLintInput.moduleLines`, so this file reads no registry. Build only and pure, no node:*: world.ts
// imports it and scan-dist.ts imports world.ts. Its imports from index.ts and lint.ts are `import type`, erased at run
// time, so it loads first or last alike; it imports nothing from world.ts, not even a type (index.ts's header).
import type { MechanicId } from '../../../src/mechanics/contract.ts';
import type { Cond } from '../../../src/mechanics/data/conditions.ts';
import type { HotspotKey, ItemId, RoomId, WorldSource, WorldText } from '../../../src/world/types.ts';
import type { Finding, Severity } from '../lint.ts';
import type { WorldLint } from './index.ts';

/** How the player meets a world text; per-player's placeholder and clue rules decide per role, never per field. */
export type TextRole =
  /** read at leisure and rendered through the values store (a doc body, an item description, a label) */
  | 'read'
  /** a note that lives seconds (a look, a lock text, `use`'s say / refuse, a recipe's say) */
  | 'toast'
  /** a title, a name, a prompt, a hotspot label */
  | 'name'
  /** a hint tier: kernel puzzles only (server content; a module's data ships in the public world, principle 0) */
  | 'hint';

/**
 * One module text: `path` its dotted source path from the world root (findings, the line, `--fix-ids`); `reach` the
 * conditions any one of which, when it holds, lets the player read it ([]: it never serves as a clue).
 */
export type ModuleText = { readonly text: WorldText; readonly path: string; readonly role: Exclude<TextRole, 'hint'>; readonly reach: readonly Cond[] };

/** The source paths of the world's places, built once per walk by world.ts; '' for a place the world lacks. */
export type PlacePaths = {
  room(r: RoomId): string;
  hotspot(k: HotspotKey): string;
  item(i: ItemId): string;
  slot(k: HotspotKey, index: number): string;
};

/** A module's walker: its texts in source order, read from its own decoded data `d` (= `w.mods[id]`). */
export type TextWalker<D> = (w: WorldSource, d: D, at: PlacePaths) => readonly ModuleText[];

/** The walkers by module id as the walk takes them: `MECHANIC_TEXTS`, or a test's fixture modules beside it. */
export type TextRegistry = { readonly [id: string]: TextWalker<never> | null };

/** Today's kernel walk, one field per row (world.ts `worldLines`). */
export type KernelTextField =
  | 'item.name'
  | 'item.desc'
  | 'doc.title'
  | 'doc.body'
  | 'puzzle.title'
  | 'puzzle.prompt'
  | 'puzzle.hints'
  | 'room.title'
  | 'hotspot.label'
  | 'lock.locked'
  | 'hotspot.look';

/**
 * The kernel's roles (R-E9 as data), so a new kernel text field is one row. `reach`: 'has' = `[{ has: <the item> }]`,
 * 'doc' = `[{ doc: <the doc> }]`, null = [].
 */
export const KERNEL_TEXT_ROLES: { readonly [field in KernelTextField]: { readonly role: TextRole; readonly reach: 'has' | 'doc' | null } } = {
  'item.name': { role: 'name', reach: null },
  'item.desc': { role: 'read', reach: 'has' },
  'doc.title': { role: 'name', reach: null },
  'doc.body': { role: 'read', reach: 'doc' },
  'puzzle.title': { role: 'name', reach: null },
  'puzzle.prompt': { role: 'name', reach: null },
  'puzzle.hints': { role: 'hint', reach: null },
  'room.title': { role: 'name', reach: null },
  'hotspot.label': { role: 'name', reach: null },
  'lock.locked': { role: 'toast', reach: null },
  'hotspot.look': { role: 'toast', reach: null },
};

export const TEXT_CODES = { 'world/text-unwalked': 'E' } as const satisfies Readonly<Record<string, Severity>>;

/**
 * The line IDs of every text inside `v`, objects and lists alike: a plain object whose own keys are exactly `id` and
 * `ru`, both strings (the predicate the version hash calls a text, emit.ts `textless`).
 */
function textIds(v: unknown, out: string[]): string[] {
  if (Array.isArray(v)) {
    for (const x of v) {
      textIds(x, out);
    }
  } else if (typeof v === 'object' && v !== null) {
    const o = v as Readonly<Record<string, unknown>>; // decoded module data: plain JSON values
    const id = o['id'];
    if (Object.keys(o).length === 2 && typeof id === 'string' && typeof o['ru'] === 'string') {
      out.push(id);
    } else {
      for (const x of Object.values(o)) {
        textIds(x, out);
      }
    }
  }
  return out;
}

/**
 * `world/text-unwalked`: every text inside a module's decoded data has its ID among the IDs that module's walker
 * returned (`moduleLines`; none for a module without an entry or with `null`), reported at the line where the ID first
 * appears in the world file. So a module that declares `null`, or a walker that misses a field, fails `npm run story`
 * the first time its data holds a text.
 */
export const TEXTS_LINT: WorldLint<keyof typeof TEXT_CODES> = {
  id: 'texts',
  codes: TEXT_CODES,
  lint: (input) => {
    const out: Finding[] = [];
    for (const [m, data] of Object.entries(input.world.mods)) {
      const walked: ReadonlySet<string> | undefined = input.moduleLines.get(m as MechanicId); // a key of `mods` is its module's id
      for (const id of textIds(data, [])) {
        if (walked?.has(id) !== true) {
          const at = input.text.indexOf(JSON.stringify(id));
          const line = at < 0 ? 0 : input.text.slice(0, at).split('\n').length;
          const message = `'${id}' is a text of module ${m} that no text walker returns: walk it in MECHANIC_TEXTS (§3.2)`;
          out.push({ code: 'world/text-unwalked', severity: TEXT_CODES['world/text-unwalked'], file: input.file, line, message });
        }
      }
    }
    return out;
  },
};
