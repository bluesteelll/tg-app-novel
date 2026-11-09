## 5. World data and save format 2

### 5.1 World JSON: keys per module, no world-format bump

| Module (lane) | Place | Keys (default) |
|---|---|---|
| kernel (GM2b) | world | `renamed: { items?, docs?, rooms?, sections?, hotspots?, flags?, puzzles? }` (`{}`) |
| `use` (GM3) | hotspot / slot / item / room | `uses: UseRule[]` (`[]`); slot `keep: boolean` (`false`); item / room `refuse: WorldText | null` (`null`) |
| `visual` (GM3b) | hotspot / room | `states: Record<StateName, StateArt>` (`{}`), `is: { when: Cond; state }[]` (`[]`); room `decor: Decor[]` (`[]`) |
| `view` (GM4) | room | `view: { of: RoomId } | null` |
| `combine` (GM5) | world | `recipes: Recipe[]` |
| `flags` (GM5f) | world / effect / hotspot | `flags: Record<FlagId, { section }>`; effect `{ set: FlagId }`; hotspot `when: Cond | null` |
| `devices` (GM8i) | room | `device: HotspotId | null` |
| `carry` (GM9p) | item / world | item `carry: { required: boolean } | null`; world `inherits: ItemId[]` |
| `labels` (per-player GM6d2) | room | `labels` (per-player.md §6.2) |

```ts
type UseRule = { item: ItemId; keep: boolean; when: Cond | null; do: readonly Effect[]; say: WorldText | null };
type StateArt = { prop: PropId | null } | { patch: PropId; rect: Rect };        // null prop: nothing drawn
type Decor = { id: string; prop: PropId; rect: Rect; z: number; states: Record<StateName, StateArt>; is: { when: Cond; state: StateName }[] };
type Recipe = { a: ItemId; b: ItemId; gives: ItemId; keep: readonly ItemId[]; when: Cond | null; say: WorldText | null };
```

- **No world `format` bump.** The world JSON is read only by the build that emitted it (free) or by a client of the
  same deploy (paid). A stale client meeting a new key fails `exactKeys` (`decode.ts:94-109`) and the chapter load
  fails without a write. A bump adds nothing to that. New module keys are optional with defaults, as `take.then`
  already is (`decode.ts:3-4`), so existing worlds need no edit.
- Every new text is a `WorldText` with a line ID (principle 8), decoded through `DecodeCtx.text` at its source path,
  and declared by its module's `TextWalker` in `MECHANIC_TEXTS` with a role and a reach (round 6, W1; §3.2 "Module
  texts"): `use`'s `say` and `refuse` (`toast`), `combine`'s recipe `say` (`toast`), per-player's labels (`read`).
  `worldLines` walks them after the kernel texts from GM3c on, so the en checks, the shipped en, `id/chapter-prefix`,
  the needles and scan-dist see them; `world/text-unwalked` refuses one no walker declares.

### 5.2 Save format 2 (lane GM2a)

```ts
// client/src/story/save-codec.ts
export const SAVE_FORMAT = 2;
export type SaveBody = {
  format: typeof SAVE_FORMAT; chapterId: ChapterId; storyVersion: StoryVersion; ink: string | null;
  at: { lineId: LineId | null; knot: KnotName | null; yield: YieldCommand | null };
  staging: StagingSnapshot;                     // props: PropPlacement, now with optional `at` / `part`
  checkpoint: { knot: KnotName; vars: Record<VarName, InkScalar>; staging: StagingSnapshot } | null;
  chapterStart: { carry: Record<VarName, InkScalar>; items: readonly ItemId[] };      // + items (GM9r fills it)
  backlog: ReadonlyArray<BacklogEntry>; world: WorldState; worldVersion: string | null;
};
/** The save fields per format; `mechanics: slice keys pinned to SAVE_FORMAT` compares the registry's slices with it. */
export const SAVE_FIELDS: { readonly [F in 1 | 2]: readonly string[] };
export function decodeSave(raw: string): Result<SaveBody, SaveDecodeError>;   // format k < 2: decode k, then upgrade
export function encodeSave(b: SaveBody): string;
// client/src/explore/state.ts
export type PuzzleRun = { readonly outcome: PuzzleOutcome | null; readonly attempts: number; readonly hintsOpened: number;
  /** A view-presented device's working configuration (outside the proof key). Optional (critique_engine_r1 m1): absent
   *  = none, so today's literals (`reduce.ts:239` `NO_RUN`, `puzzles/session.test.ts:136`, `:358`) stay valid. */
  readonly work?: readonly number[] };
export type WorldState = { readonly format: 2; /* format-1 fields */ readonly flags: readonly FlagId[] };
// client/src/story/staging.ts
export type PropPlacement = { readonly prop: PropId; readonly rect: Rect;
  /** The stable anchor (per-player GM6a keys anchors by it; absent: keyed by prop, today's behaviour). */
  readonly at?: AnchorKey; readonly part?: 'base' | 'patch' };
// Reconcile r1 (design-shots I-1): the camera state a shot holds, declared here so format 2 carries it from GM2a on;
// design-shots SH1 adds the `cam` command and writes it (its §3.2). Absent = at rest, so every format-1 body upgrades
// with no key and today's `EMPTY_SNAPSHOT` (`staging.ts:77-83`) stays valid.
export type CamTarget = CharId | 'center';
export type CamState =
  | { readonly kind: 'rest' }
  | { readonly kind: 'push'; readonly to: CamTarget; readonly z: number }      // z: integer percent, 105..130
  | { readonly kind: 'pan'; readonly to: CharId | 'left' | 'right' };
// StagingSnapshot (`staging.ts:68-74`) gains `readonly cam?: CamState`. The codec reads it with the optional-key
// rule `at` / `part` / `work` already need (a key the body lacks yields no key; a present key is read strictly): a
// `kind` outside the three, a `to` that is no name (`NAME_RE`) or `'center'` / `'left'` / `'right'` where the kind
// admits it, or a `z` that is no integer in 105..130 fails the decode at `save.staging.cam`.
```

- **One bump for every known shape:** `flags` (GM5f), `run.work` (GM8i), `chapterStart.items` (GM9r), `PropPlacement.at`
  (GM3b / GM6a); reconcile r1 (design-shots I-1): `StagingSnapshot.cam` (SH1), in `staging` and in
  `checkpoint.staging` alike (one reader), ~6 source lines, +0.03 KB br on the engine (ARITHMETIC 6 x 4.3 B = 25.8 B;
  `save-codec.ts` is in the engine closure, its one value importer `game.ts:33`). Without it SH1 keeps `cam` out of the
  snapshot (its STOP item) and a resumed push opens at rest framing. Later lanes need no codec edit and no second
  stale-tab window. A future slice is format 3 (§3.6).
- **Upgrader 1 -> 2** (pure): `world.format = 2`, `flags = []`, `chapterStart.items = []`; runs and props unchanged
  (`work` is optional; the format-2 codec decodes it when present and refuses a malformed one).
- **A well-formed `work` that no longer fits** (critic r2 open question): GM2a's `normalize` drops `work` with its run
  only where the world lost the puzzle (as for any run); from GM8i the `devices` module's `normalize` (§3.2) also drops
  a `work` for which the type's `workFits(p, work)` (§7.1) is false (a device whose `parts` or `positions` changed in an
  update), so the device restarts from `initial` and a reach device never posts a shape the server refuses. Test
  `device: a saved work that no longer fits the device is dropped at resume` (GM8i).
- **Prop order (m9, E-P7):** `StagingSnapshot.props` keeps the command's array order, which is the draw order (props
  layer, back to front); GM3b emits it sorted by `z` (decor), then hotspot order. No new field. Golden fixture: a real ch1 format-1 body (`client/src/story/fixtures/save-1-ch1.json`, new),
  captured at GM2a's cut from today's codec.
- **Format 1's decoder is frozen** (kept for the upgrade); within a format the codec stays strict on every declared
  key; unknown keys stay ignored (`save-codec.ts:3-4`), which is why every shape change bumps.
- **A newer format** -> `unknown-format` -> the start fails without a write (`game.ts:1507-1510`). Changed by RULINGS
  181 (as of `9b4fd25`; docs lane `docs-errata-11`, group A): as merged (GM2a `9b4fd25`), the start's decode is
  `game.ts:1603-1606` (`begin`: `unreadable-save`, no write) and the load's `:1637-1642` (`loadSlot`: logged, the
  adopt fails).
- **`game.ts`:** 12 type references to `SaveBody`, two `format:` literals to `SAVE_FORMAT`, two `chapterStart`
  literals gain `items: []`. No behaviour change. This is why GM2a precedes the cut of the first animation / shot lane
  that holds `game.ts` (rev. 3 named MD2 / MA1a; RULINGS 132 re-sets them; orchestrator Q2; reconcile r1: that lane
  is **SH1**, design-shots §9.14).
- **Rejected:** a generic `mods: Record<MechanicId, unknown>` slot (an older build would carry an unvalidated blob);
  three bumps (GM5f, GM8i, GM9r each).

### 5.3 `renamed`, the client half (lane GM2b)

- **Step 0** (before `normalize`, `reconcile.ts:302`): the cumulative map rewrites every id the state holds: items
  (`held`, `used`, slot cells), docs, rooms (`room`, `lastRoom` values, `visited`, `enter:<room>` triggers), sections
  (`section`, `lastRoom` keys, `unproved`), hotspots (`taken`, `examined`, `open`, slot keys, `then | open | fail:<key>`
  triggers), flags. Knots have no map (an ink rename is an ink edit; `normalize` drops unknown knots as today).
- **Puzzles (R-E4, per-player round 2):** `renamed.puzzles` is refused by `world/renamed-puzzles` until per-player
  **GM6c1b** (the server reads stable storage keys, per-player.md §3.8; no server re-key exists any more); GM6c1b lifts
  the lint, adds `s.puzzles` keys to step 0 and emits each renamed puzzle's `key` in one commit (E-P5). For puzzles a
  rename never merges two storage keys (per-player's `puzzle-key/rename-agrees` over the key log, which accepts a
  chain's links resolving to one target; R-E15, round 4); chains still resolve to their final target. No window where
  the client re-keys and the server does not (I2 belongs to per-player.md §3.8).
- **Emit:** chains resolve to the final target (`a -> c`, `b -> c`); lints `world/renamed-target` (the target exists),
  `world/renamed-source` (the source no longer exists), `world/renamed-cycle`, `world/renamed-puzzles`. **All four are
  new in GM2b** (round 4: no `renamed` key or lint exists on main; a Grep of `client/scripts/story` and `client/src`
  finds none), declared in the core lint file's `codes` (`client/scripts/story/mechanics/core.ts`, §3.2), not in
  `LINT_CODES`. Append-only is an authoring rule; the golden body with a pre-rename id catches a removed entry for its
  fixtures.
- Changed by RULINGS 190 (as of `837b1ed`; docs lane `docs-errata-12`, group A): as merged (GM2b `1782d6d`; step 0 is
  `renameIds`, `client/src/explore/reconcile.ts:74`, the lints `client/scripts/story/mechanics/core.ts:12-17`):
  - **A room's rename moves no hotspot** (cut Q6): a hotspot moves by its own entry only, so the author lists
    `<old room>.<id> -> <new room>.<id>` under `hotspots` for every hotspot kept. No lint can see a forgotten entry (it
    needs the previous world); the authoring guide states the rule
    ([AUTHORING "Rules that protect players' saves"](../../AUTHORING.md#rules-that-protect-players-saves)).
  - **An item merge leaves the item in a lock or in hand, never both** (review I1): a held id that the map merges with
    a different id `used` holds is dropped from `held` and reported as `held:<saved id>` in `dropped`, and the lock
    keeps the item; one id the save has in both lists stays in both (a world that gives the item twice) unless a
    different saved `used` id merges onto it (triage r3 M1: then it leaves `held` too). One
    give-back serves step 0 and normalize (`giveBack`, `reconcile.ts:47`): the items of cells that went return used ->
    held, but an item a kept cell still holds stays used.
  - `renamed.flags` decodes and maps, but `world/renamed-target` refuses every flags entry until module `flags`
    declares flags (GM5f; cut Q1).

### 5.4 World JSON bytes (R6)

- **What ships** (CODE): free worlds are file URLs (`chapters.ts:68`), fetched and parsed (`chapters.ts:210-216`, `:202`),
  so the emitted text is the shipped text, pretty-printed (`emit.ts:124-126`).
- **GM2b emits the world compact** (`JSON.stringify(value)`) for `free/<ch>.world.json` and the paid
  `server/content/<ch>/world.json`. The version hash already uses compact JSON over `textless(body)` (`emit.ts:146-148`),
  so world versions and saves do not move; `story.json` keeps its format (its bytes are the story version,
  `emit.ts:120-121`).
- **Figures:** ch1 raw 10.8 KB, br 1.7 KB, 11 hotspots (MEASURED, `final-build.log:120`): ~0.98 KB raw and ~0.155 KB br
  per hotspot all-in (ARITHMETIC). Indentation share estimated ~25-30% (CLAIM, to be MEASURED by GM2b's build log).
  **The raw row binds first (m6):** 32 / 0.98 ≈ 33 hotspots per chapter pretty-printed today; after the compact
  emission 32 / (0.98 x 0.70..0.75) ≈ 44-47 (ARITHMETIC on the CLAIM share); the br row binds near 51 (8 / 0.155). New
  keys per hotspot lower all three. GM2b's build log MEASURES the compact raw bytes; GM4's reports bytes per hotspot
  with views and states.
- Changed by RULINGS 190 (as of `837b1ed`; docs lane `docs-errata-12`, group A): **MEASURED** at GM2b's merge
  (`1782d6d`, 4 builds per tree, identical): ch1 raw 10,779 -> 5,253 B and br 1,719 -> 1,506 B; ch2 raw 569 -> 394 B,
  br 286 -> 255 B. Indentation is **51.3 %** of ch1's raw bytes ((10,779 - 5,253) / 10,779), not the CLAIM 25-30 %, so
  the **br row binds first** now, and the capacity arithmetic changes (ARITHMETIC, ch1's 11 hotspots): raw 5.253 / 11
  = ~0.478 KB per hotspot, 32 / 0.478 ≈ 67 hotspots; br 1.506 / 11 = ~0.137 KB per hotspot, 8 / 0.137 ≈ 58. The
  "raw row binds first (m6)" paragraph above is the pretty-printed record.
- **Decision:** rows unchanged. A chapter that outgrows them splits (authoring). The world sits on the
  time-to-first-line path (fetched with the story, `chapters.ts:210-216`), so its br bytes are first-line bytes.
