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
- **Limits:** depth <= 4 and <= 16 atoms per condition (`world/cond-size`): bounded evaluation, readable data.
- **Why one JSON grammar, no expression strings:** strings would cross the seam unparsed; this decoder returns every
  issue as a value (design principle 3). Rejected: ink-style `{x && y}` expressions (a second parser, and ink braces).
