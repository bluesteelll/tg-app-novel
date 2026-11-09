## 4. Condition grammar

```ts
// Decoder + reads: client/src/mechanics/data/conditions.ts (engine). Evaluator: client/src/mechanics/rules/conditions.ts.
export type Cond =
  | { readonly held: ItemId } | { readonly used: ItemId } | { readonly has: ItemId }        // has = held or used
  | { readonly doc: DocId }
  | { readonly taken: HotspotKey } | { readonly examined: HotspotKey } | { readonly open: HotspotKey }
  | { readonly visited: RoomId }
  | { readonly solved: PuzzleLocalId } | { readonly failed: PuzzleLocalId }
  | { readonly [moduleAtom: string]: unknown }          // module atoms: `flag` (GM5f), `part` (GM8i, visual only)
  | { readonly all: readonly Cond[] } | { readonly any: readonly Cond[] } | { readonly not: Cond };
export const COND_MAX_DEPTH = 4;      // LIMIT (new)
export const COND_MAX_ATOMS = 16;     // LIMIT (new)
export function decodeCond(raw: unknown, ctx: DecodeCtx, path: string): Result<Cond, Issue[]>;
export function condReads(c: Cond): readonly FactAtom[];
export function holds(w: KernelWorld, s: WorldState, c: Cond): boolean;     // chunk
```

- **JSON:** every object has exactly one key; `null` means "always". Example:
  `{ "all": [ { "has": "match" }, { "not": { "open": "study.lamp" } } ] }`.
- **Two scopes, decided by where the condition sits:**
  - **gating** (hotspot `when`, `uses.when`, recipe `when`): every atom names an id of the same section (rooms,
    hotspots, items and docs the section gives, its lock puzzles, the flags it owns, the carried items it declares).
    Lint `world/cross-section-cond`. Their atoms enter `sectionKey` through `reads`.
  - **visual** (`is`, `decor.is`): any id of the chapter; `part` is visual-only (`world/visual-only-atom`). Never in a
    key, so a picture can follow a fact of another section (synthesis §3.2) at 0 states.
  - Changed by RULINGS 191, 192, 196 (as of `837b1ed`; docs lane `docs-errata-12`, group A): as merged (GM3c
    `837b1ed`), the gating scope is `sectionScope(pub, section)` (`client/src/explore/reduce.ts:168`; critique O1,
    adopted): the section's rooms, hotspot keys, the items and docs it gives and its lock puzzles, the keys `sectionKey`
    reads, so the lint and the key have one definition, and the carried items a section declares join the scope when
    `sectionScope` learns them (the carry lane, critique Q2). `world/cross-section-cond` judges kernel atoms only; a
    module's gating atom is its own module's to scope. A third site, a puzzle's **`clues`** (GM1d, widened by GM3c): a
    clue is a condition, not an atom ([§7.3](07-puzzle-types.md#73-i4-secret-goals-never-ship)), of scope `clue`:
    `world/clue-reachable` judges it from the lock's section, and here only `world/cond-size` applies
    (`client/scripts/story/mechanics/conditions.ts:28-33`, `:98-103`). As merged the signatures take a registry
    parameter: `decodeCond(raw, ctx, path, mechanics = MECHANIC_DATA)` (`client/src/mechanics/data/conditions.ts:130`),
    `holds(w, s, c, rules = MECHANIC_RULES, data = MECHANIC_DATA)` (`client/src/mechanics/rules/conditions.ts:19`).
- **Limits:** depth <= 4 and <= 16 atoms per condition (`world/cond-size`): bounded evaluation, readable data.
- **Why one JSON grammar, no expression strings:** strings would cross the seam unparsed; this decoder returns every
  issue as a value (design principle 3). Rejected: ink-style `{x && y}` expressions (a second parser, and ink braces).
