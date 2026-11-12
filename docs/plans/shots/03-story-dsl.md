## 3. THE STORY DSL

### 3.1 Tags (docs/STAGING-DSL.md §6 rows; the grammar is §2's `kind [":" args]`, `client/src/story/tags.ts:44-47`)

```
bg: <shot> [t=cut|crossfade|fade] [ms=N]
scene: <shot> [t=fade|cut] [ms=N]
face: <char> <expr> [ms=N]
cam: push [to=<char>|center] [z=<105..130>] [ms=N]
cam: pull [ms=N]
cam: pan to=<char>|left|right [ms=N]
think
anim: <char> <motion> [ms=N]
fx: shake|flash [ms=N]
```

| Tag | Meaning |
|---|---|
| `bg:` | The cut verb (rev. 2, W2: tag and command kind unchanged, `tags.ts:213-223`). Default `t` changes from `crossfade` to `cut` (OQ6); `ms` keeps its default 500 (`tags.ts:218`) and is the crossfade's length. `t=crossfade` to another shot is the exact dissolve (S14); onto the shot on stage it is today's props crossfade. `fade` is today's dip. |
| `scene:` | Unchanged grammar. Also resets faces and camera. |
| `face:` | Default ms: today's `show` expression-change default (verify). Persists across cuts within the scene. |
| `cam: push` | Defaults `to=center`, `z=110`, `ms=2400`. |
| `cam: pull` | Back to rest framing; default ms 1200. |
| `cam: pan` | Default ms 1800. |
| `think` | Flag on a text line: the speaker's mouth stays still and nobody is cued as a listener. |
| `anim:` | `<motion>` ∈ nod, shake, lean_in, lean_back, sigh, tremble, hop, bounce. hop and bounce need a figure plane. |
| `fx:` | one-shot |

Default ms values: E; the owner tunes them (OQ12).

**Ruled: RULINGS 279, 280** — SH2's cut Q4 taken by SH4 (`768fc9d`): on a shot chapter (a chapter that shows a shot
with a cast, STAGING-DSL §14.1) a `face:` names **no knot asset**. The knot graph's `assetOf` gives none there
(`client/scripts/story/graph.ts:117-128`; the chapter test `isShotChapter` `:506`, fed the declared shots by the one
caller, `client/scripts/story.ts:684`), so the knot index and its preload list never name `char/<c>/<x>` for it. Its
drawn files are the shot pass's (`build/shots.json` `assets`, §3.6): each batch ensures the face file before its
line (`imageIds`, §5.2), and the step windows' preload of them is SH5a's and SH5b's (planned). On a legacy chapter a `face:` still names its
sprite. Pinned by `graph: a face on a shot chapter names no asset` and `graph: a face on a chapter whose shots have no
cast names its sprite` (`client/scripts/story/graph-shot.test.ts:87`, `:97`).

**Batch order** (extends `executor.ts:143-187`):
1. scene
2. bg (the cut)
3. face (applied to the new shot before it is revealed: no patch animation in a cutting batch)
4. cam
5. cg
6. props
7. anim / fx
8. wait

**Batch conflicts** (parser reason `'conflict'` -> the existing `batch/conflict`, `client/scripts/story/lint.ts:118`,
so no new `LINT_CODES` row; EN's rule [engine §3.2 The two halves and the registries](../engine/03-module-contract.md#32-the-two-halves-and-the-registries)):
- two `bg`, and `bg` + `scene` (today's rules, `tags.ts:333-334`);
- two `face` of one character;
- two `cam`;
- two `fx`.

### 3.2 Typed commands (`client/src/story/staging.ts`, SH1)

```ts
export type CamTarget = CharId | 'center';
export type CamState =
  | { readonly kind: 'rest' }
  | { readonly kind: 'push'; readonly to: CamTarget; readonly z: number }      // z in [105, 130], percent
  | { readonly kind: 'pan'; readonly to: CharId | 'left' | 'right' };
export type Motion = 'nod' | 'shake' | 'lean_in' | 'lean_back' | 'sigh' | 'tremble' | 'hop' | 'bounce';
export type StagingCommand =
  | { kind: 'bg'; bg: BgId; t: 'crossfade' | 'fade' | 'cut'; ms: number }   // unchanged (staging.ts:30); default t: cut
  | { kind: 'scene'; bg: BgId; t: 'fade' | 'cut'; ms: number }
  | { kind: 'face'; char: CharId; expr: ExprId; ms: number | null }
  | { kind: 'cam'; cam: Exclude<CamState, { kind: 'rest' }> | { kind: 'pull' }; ms: number | null }
  | { kind: 'think' }
  | { kind: 'anim'; char: CharId; motion: Motion; ms: number | null }
  | { kind: 'fx'; fx: 'shake' | 'flash'; ms: number | null }
  | /* show, hide: until SH12 */ /* cg, bgm, sfx, wait, puzzle, explore: unchanged */ ...;
export type StagingSnapshot = {
  bg: BgId | null;                    // the shot in effect
  cg: CgId | null;
  chars: ReadonlyArray<{ char: CharId; expr: ExprId; at: Slot }>;  // faces: at = 'center'; legacy sprites until SH12
  bgm: { track: TrackId; vol: number } | null;
  props: readonly PropPlacement[];
  cam?: CamState;                     // I-1 (GM2a format 2); absent = rest
};
```

**Routing** (`splitBatch`, moved by SH1 from `client/src/app/game.ts:241-268` to `client/src/app/stage-route.ts`):

| Command | Consumer |
|---|---|
| `bg`, `face`, `cam`, `anim`, `fx` | the scene |
| `think` | GameSession: it calls `scene.talk(null)` for that line |
| `TAG_KINDS` / `SameUnion` | stay the drift guard (`tags.ts:27-32`) |

### 3.3 Lints

**Parser-level** (`parseTags`, one parser for the gate and the runtime):
- unknown kind; bad argument;
- unknown shot: `hasBg` over the effective catalog;
- unknown character or expression: the catalog vocabulary at build, the chapter's rigs at runtime (SH4, §5.2).

**Shot lints:** a separate registry, `SHOT_LINT_CODES` in `client/scripts/story/shots/lint.ts`. It follows EN's
"each lint file declares its own codes" ([engine §3.2 The two halves and the registries](../engine/03-module-contract.md#32-the-two-halves-and-the-registries)), so `LINT_CODES` and its 86-row doc pin
(`client/src/story/dsl-doc.test.ts:139-153`) stay untouched. It is documented in a new STAGING-DSL §14 with its own
two-way test in `shots.test.ts`.

| Code | Sev | Fires when |
|---|---|---|
| `shot/undeclared` | W | (rev. 3: was E) a `bg:` / `scene:` / world room names a catalog bg that `story/shots.json` does not declare: an implied cast-less shot (§2.4) |
| `shot/room-frame` | E | (rev. 3, W9) a world room or view whose bg shots.json declares with a `frame` other than `room` |
| `shot/list` | E | shots.json does not decode: an unknown char, a `rest` not in the char's vocabulary, a `view` other than face / back, a duplicate, an unknown `loc` |
| `shot/char-absent` | E | `face:`, `anim:`, `cam to=` names a character that is not in the shot in effect after the batch's cut on **some** path (may-analysis) |
| `shot/back-view` | E | `face:` or `cam to=` names a cast member whose view is `back` |
| `shot/motion-unsupported` | E | `anim: hop/bounce` for a cast member without `figure: true` |
| `shot/sprite-in-shot-chapter` | E | (rev. 2, m7) any `show:` / `hide:` in a chapter that names at least one shot with a non-empty cast: a shot chapter has no sprites at all, cast member or not; a legacy chapter (every used shot cast-less) keeps its sprites until it is restaged; lapses with SH12 |
| `shot/loc-change` | W | a `bg:` cut to another `loc` without `scene:` |
| `shot/plane-over-hotspot` | W | (rev. 2) a room shot's front plane overlaps a hotspot rect of that room (world data) |
| `shot/plane-over-label` | E | (reconcile, per-player R-S2) a room shot's plane (back or front) `at` box or a cast member's `body` bounding box meets a bg label's rect of that room, or a front plane's `at` box meets an anchor label's rect (labels: `w.mods.labels`, GM6d2's data) |
| `shot/implied-placeholder` | W | a used shot has no catalog entry (art pending) |
| `art/pending` | W (E under `--strict`) | a needed (shot, char, expr) state has no art: the shot's bg is a placeholder |
| `flow/edge-missing` | E | a playthrough observed a step transition the CFG lacks. Rev. 2 (m5): fail-closed **only for transitions some seeded run observes**; a CFG edge missing on a path no run takes passes. The CFG rules (below) are the primary guard, the 200 runs a check on them |
| `flow/unsupported` | E | a construct the flow does not model: threads `<-` (verify: none in `story/`) |

**Asset-step checks** (SH3c for `src` shots, rev. 4; R5 and R9 run on placeholders from SH3a) report every art failure
with the shot, the layer and the **line IDs that need it**.
They come from build/shots.json; the summary gives the message format as
`shot <s> lacks <char>.<expr> (needed by ch1.arrival.a004, ...)` (E, the exact wording is the lane's), and §4.3
lists the checks. Budget rows (SH3b): `step-window <ch>` and `entry step images <ch>`. Rev. 3 (W5): their codes
`budget/step-window` and `budget/entry-step` join `SHOT_LINT_CODES` (STAGING-DSL §14), not `LINT_CODES`;
`budget/knot-set` stays in `LINT_CODES` (`client/scripts/story/lint.ts:66`) while any chapter has `show:` sprites, and
SH12b removes it (the doc pin `dsl-doc.test.ts:146`, `toHaveLength(86)`, moves to 85 in the same commit; rev. 4: "SH12"
without a letter names SH12a and SH12b together). So SH3b
edits neither `lint.ts` (EN §12: GM1d alone, then A(`lint.ts`) never beside it) nor `dsl-doc.test.ts`.

### 3.4 The flow analysis (`client/scripts/story/shots/flow.ts`, build-only)

**Steps** (the runtime's presented steps, `game.ts:657-716`). Each has a key:

| Step | `StepKey` |
|---|---|
| a text line | its line ID |
| a choice point | every choice's line ID (one entry each, same window), because the first *displayed* choice varies with conditions |
| a knot entry (first knot, resume at a knot, return from a yield) | `k:<knot>` |

```ts
export type StepKey = LineId | `k:${KnotName}`;
export type Effect = { readonly shots: ReadonlySet<BgId>; readonly faces: ReadonlyMap<CharId, ReadonlySet<ExprId>>;
                       readonly cg: ReadonlySet<CgId | null>;           // may-sets at a step, after its batch
                       readonly room: ReadonlySet<RoomId | null>;        // rev. 2 (W8): the room whose props are on stage
                       readonly sprites: ReadonlyMap<CharId, ReadonlySet<ExprId>> };  // rev. 3 (W5): legacy `show:`; rev. 5 (W3): only flow.ts's transfer names the kinds (SH12a removes it, the field stays empty), SH12b removes the field and its readers
export type StepFlow = { readonly key: StepKey; readonly file: string; readonly line: number;
                         readonly next: readonly WindowKey[];             // rev. 5 (W2): an event's terminal step also leads to `r:<room>`
                         readonly effect: Effect;
                         readonly cut: BgId | CgId | null;               // the image change this step's batch makes
                         readonly appears: readonly AssetId[];           // rev. 4: every file its batch makes visible (§3.4)
                         readonly speaker: CharId | null; readonly think: boolean };
export function buildFlow(classified: ClassifiedChapter, graph: ChapterGraph, returns: EventReturns): Result<ReadonlyMap<StepKey, StepFlow>, Finding[]>;  // rev. 5 (W2): + returns
/** rev. 4 (C1, W2): one window per step key and per explore room; rev. 5 (m7): keyed by the room id, not its bg. */
export type WindowKey = StepKey | `r:${RoomId}`;
export type Lookahead = { readonly cur: readonly AssetId[];                 // the union of every alternative in effect (+ talk files)
  readonly certain: readonly AssetId[]; readonly certainDist: number;        // the shared next appearance; least steps to it
  readonly possible: readonly AssetId[];                                    // the other next-appearance files
  readonly near: number;                                                    // rev. 5 (m3): at a room window possible[0, near) = this room's own knots' files; rev. 6 (m3): at a story step near = possible.length
  readonly d2: readonly AssetId[]; readonly d3: readonly AssetId[] };
export function lookahead(flow: ReadonlyMap<StepKey, StepFlow>, rooms: RoomEvents, depth: 3): ReadonlyMap<WindowKey, Lookahead>;
/** rev. 4 (W2): per room of each section, the event and leave knots one action away (graph.ts `sectionKnots` + exits).
 *  rev. 5 (m3, m7): keyed by room; `near` = the room's own knots (hotspots, locks, onEnter, leaves), `far` = the
 *  onEnter knots of the rooms its exits lead to; (W2) `returns` = the rooms each event knot returns to. */
export type RoomEvents = ReadonlyMap<RoomId, { readonly shot: BgId; readonly room: readonly AssetId[];
  readonly near: readonly KnotName[]; readonly far: readonly KnotName[] }>;
export type EventReturns = ReadonlyMap<KnotName, { readonly rooms: readonly RoomId[]; readonly cofiredAfter: readonly KnotName[] }>;
```

Changed by RULINGS 261 (as of `a064399`; docs lane `docs-errata-16`, group A): `cur`'s comment read "the largest
alternative in effect". As built (SH2's `client/scripts/story/shots/flow.ts:1275-1283`, which SH3b's gate reads) `cur`
is the **union** of every alternative in effect plus the talk files of every shot in effect, and the runtime's `need`
is that same union plus `certain` (`foldWindow`, `client/scripts/assets/shots.ts:560-564`), so the gate charges what
the runtime requests (SH3b cut Q2). A room certain at the next step adds its label bound, derived from the usage
rooms' `bg`, since `build/shots.json` carries `labels` only for the window's own stage (cut Q3).

**CFG rules** over `classify.ts` line kinds (`client/scripts/story/classify.ts:20-82`):
- weave depth for choices and gathers;
- diverts enter a knot's first step;
- tunnels add call and every-return edges, conservative;
- conditional blocks take every branch;
- sticky / fallback choices count as choices;
- END and DONE end a path;
- yields return to their `then` / section-return knot, using the knot graph's existing edges (`graph.ts:460-709`).

**Cross-check:** `playChapter` gains `transitions: ReadonlySet<string>` (`"<from>→<to>"`) in `ChapterPlay`
(`client/scripts/story/playthrough.ts:70-88`). Every observed pair must be a CFG edge, else `flow/edge-missing`.

**May-analysis:**
- forward union to a fixpoint;
- **seeds** (rev. 2, W8): a chapter's first step: empty (§2.2); a section knot (an event or leave knot of an explore
  yield, reached over a section edge): its room's shot and `room = <its room>`, as `carriedStage` seeds it today
  (`client/scripts/story/graph.ts:200-212`); a yield return: the yielding room's shot and room;
- `scene:` resets faces and sets `room = null` unless its shot is a room's shot (then `room` = that room);
- `bg:` replaces shots; `room` = the room whose bg it names, else null (I-11 restores that room's props at runtime);
- `face:` replaces that character's set;
- (rev. 3, W5; until SH12) `show:` sets that character's sprite expression (an `at=` alone keeps it), `hide:` removes
  it, `scene:` clears every sprite (today's executor semantics, `executor.ts:148-154`); only a chapter with
  `show:` tags (a legacy chapter, `shot/sprite-in-shot-chapter`) has a non-empty `sprites`.

**Appearances** (rev. 4, C1 / W4; round 3's "image changes" widened): a step's `appears` = the files its batch makes
visible: a `bg:` / `scene:` cut brings the new shot's plate and sheet, the face files of its `face` members in effect
(faces persist across cuts, S4) and (rev. 5, m1) the talk file of each of them whose expression in effect has one; a
cut into a room's shot also brings that room's props and decor states (usage `props`, every state image, EN §6.4
[engine §6.4 `visual`: state-derived room pictures](../engine/06-mechanics-as-modules.md#64-visual-state-derived-room-pictures-gm3b-replaces-lfu3s-b-001-fix)) and its label bound; a `face:` without a cut brings that face file and its talk file, if it
exists; a `cg:` brings the CG; (rev. 5) a speaker change brings nothing (round 4 brought the new speaker's talk file;
every visible face's talk file is now held with its face, §5.2); (rev. 5, W2) an event knot's return to its room
(below) brings the room's shot, props, decor states and label bound, unless the event's last cut already shows it.

**D_n:** `d1(s)` = for every path from `s`, the first later step whose `appears` is not empty; `d2`, `d3` the next two.
- `certain(s)` = the files in the `d1` appearance of **every** path; `certainDist(s)` = the least number of presented
  steps from `s` to that appearance;
- `possible(s)` = the other `d1` files (on some paths only: a choice's branches, a condition's arms, the events of an
  explore room, a leave knot).

**The window at `s`** (S22, S32): `need` = `cur(s)` ∪ `certain(s)` (refused -> evict, then deferred, §5.8); `warm` =
`possible(s)` (held as bytes, decoded while they fit); `hope` = `d2 ∪ d3` (decoded best effort, dropped if refused).
Rev. 6 (m3): at a story step `near` = `|possible(s)|`, so every opener goes before the tag queue (a story step has no
EN neighbour to yield the link to, and a story cut has no designed wait, §5.8 step 5); at a room window `near` counts
the room's own knots' files (below). Round 5 defined the story-step case only in §5.8's parenthesis; an emitter writing
`near = 0` there would have queued a choice's openers behind `room:*` and legacy `preload:<knot>`.

**The gate `step-window`** at every window key:
`cur(s) + [certainDist(s) = 1] · Σ full(certain(s)) + Σ kept(possible(s)) <= 33,554,432 B`, where `full` = decoded
bytes + the larger kept file (`budget.ts:806-808`) and `kept` = the larger kept file alone.
- **Why the certain term is due one step ahead:** the runtime puts `certain(s)` in `need` at every step from the first
  one whose window lists it, and a refused `need` is deferred and re-admitted at every later release (round 2, W7). So
  the guarantee the runtime can keep is "resident from the step before it appears"; round 3 summed it at any
  distance, which charged a step for files the runtime defers anyway and made "delay a cut by one line" a lever that
  changed nothing (critique r3 C1).
- **Why the possible term is bytes:** exactly one branch of a divergence is taken, and its opener decodes from the
  held Blob at the tap (S32).
- **Levers** (printed with a failing step, §5.9) therefore act on `cur` at the step before the cut, or on a file's size;
  none removes an angle, a face state or a branch-specific shot.

**At an explore yield** (rev. 4, W2; replaces round 3's one window per yield): each room `r` of the section has the
window key `r:<r>` (rev. 5, m7: the room id; round 4 keyed by bg, which merged two rooms on one bg into one window
holding both sections' openers): `cur` = the room's shot, props, decor states and label bound; `certain` = ∅;
`possible` = the `d1` files of every event and leave knot **one action away**: the knots `sectionKnots` names in `r`'s
hotspots, locks and `onEnter` (`client/scripts/story/graph.ts:416-444`, events and leaves) and in the rooms `r`'s
exits lead to (their `onEnter` fires on the move; their hotspot events need a second action and are counted anyway:
conservative at kept bytes); rev. 5 (m3): ordered `r`'s own knots first (`near` = their file count), then the exit
rooms' (`far`), the order the scheduler fetches them in (§5.8); `hope` = ∅. The yield step's own window is its section
start room's `r:` window. EN's neighbour holders (`room:<n>`, `client/src/explore/controller.ts:167-179`) stay outside
the window and bounded by `room-set` (`budget.ts:870-899`); a refused `need` or `warm` item may evict them (§5.8,
I-14), rev. 5 (W2): at any step, inside an event the event's own room too.

**An event's return** (rev. 5, W2). An event knot ends by returning to the explore (lint `explore/event-return`,
`graph.ts:456`); `eventReturned` then runs the next co-fired event knot, or batches the room the player is in
(`client/src/explore/reduce.ts:344-356`), which for an event is the room that fired it (an `onEnter` event fires after
the move into its room, `reduce.ts:311-324`). The CFG therefore gives every terminal step of an event knot `E` the
successors `r:<room>` for each room `EventReturns` names for `E` (the rooms `sectionKnots` lists it under) plus the
first step of every knot the same effect list fires after `E` (`cofiredAfter`). The `r:` node's appearance is the
room's shot, props, decor states and label bound (empty when `E`'s last cut already shows the room); it ends the step
flow (the explore resumes; what follows is that room's own window, above), so it adds no `d2` / `d3` beyond itself. So when `E` is
named in one room and nothing is co-fired after it, the return is `certain` at `E`'s last step at distance 1 and the
gate charges it there: CU B + the hall = 12.703 + 16.562 = **29.265 MiB** (§5.9); otherwise it is `possible` (held as
bytes). Leave knots leave the section (EN releases its whole `room:*` set at a `leave`,
`client/src/explore/controller.ts:157-158`; rev. 6, m8: round 5 cited `yields.ts:306-309`, which shows `story` and
`leave` both calling `toStory`) and get no return edge. Inside the
event every step's window is the ordinary story window; EN's `room:*` set is outside it, evictable, and re-requested
by EN's next `roomShown` after the return (I-14).

**Window bytes** (the gate's `cur` and `d_n` terms, W8): a shot = `bg/<s>` + `sheet/<s>` + (rev. 4) for each visible
face member the largest face file of its may-set and (rev. 5, m1; round 4: the speaker's only) its talk file for that
expression, when one exists; a room in effect adds its usage props (decoded + kept) and `LABELS_BOUND` = 2 MiB (4 x 512 x 256 x 4 B,
[per-player §6.5 Memory and budget](../per-player/06-labels-on-the-art.md#65-memory-and-budget)). Rev. 3 (W5): the sprites in effect add their `char/<c>/<e>` images to `cur`; a legacy chapter
also keeps today's `knot-set` rows (sprites appearing at the next steps, `carriedBound`, `budget.ts:827-867`).

**Entry alternatives** (rev. 3, C1): per step, one alternative per possible top image (a CG of the may-set, else a
shot of the may-set with its drawn files), plus, in a legacy chapter, every sprite of the step's `sprites`. The
`entry step images` row prices each alternative at its **half-tier** AVIF bytes (§5.11). Rev. 4: a shot's drawn files
are its plate, its sheet and the face files in effect (talk files are motion); an explore yield step's alternatives
are **every room of its section** (a resume restores any room).

### 3.5 The art list

`npm run story -- --art-list` writes `target/art-list/<story>.md` (owner-readable) and `.json` (the same data,
machine-readable). Per location: the light note and the setups in order of first use. Per shot:

| Field | Source |
|---|---|
| frame, loc, tier per file, plate width | shots.json; build/shots.json `assets` per chapter (rev. 4) |
| (rev. 4, W4) per expression of a face member: its marginal (+4-24 min of art, ~+44 KB AVIF for a CU face file, +1.633 MiB while it is the next appearance) | §6.5, §5.9 |
| cast: view, rest, figure | shots.json |
| expressions needed per character, each with the line IDs and a count | flow `effect.faces` at every step whose shot set holds the shot |
| per character: the rest set (`half`, `closed`, `accent`; `talk1`, `talk2` if it speaks at rest) | needs; every `face` cast member, any size (S30) |
| per non-rest expression `x`: `x`, then `x.half` + `x.closed`, `x.accent`, `x.talk1` + `x.talk2` (talk only where it speaks in `x`), each marked "only if `x` changes that box; else the rest state is reused" | flow speaker x effect (not `think`); the asset tool reports which were needed (R4) |
| (rev. 3, W4) per cast member, face and back views: `mask.fig` (always), `mask.head` (face views), hair locks: at least 1, 2 typical, each a SAM 3 mask plus the plate inpaint behind it; minutes per item (§6.5 step 8) | shots.json cast; required by R9 |
| (rev. 3, m7) joint states `x.accent.half` / `x.accent.closed`, listed only after an asset run reported touching blink and accent diffs for `x` (R2) | the asset tool's last report |
| camera targets (`cam to=`) -> which faces must stay sharp at <= 130 % | flow |
| motions needing a figure plane | flow |
| ambient: the shot's `ambient[]` entries (flicker, loop, particles, plane sway) and, for a room, its decor loop props by state | shot.json, world `decor` |
| counts: plates, face states (lower = derived states all reused, upper = all drawn), ambient items; hours estimate (§6.5 rates, a range) | A |

The md file ends with the chapter totals and the reuse table (which shots appear on how many steps).

### 3.6 build/shots.json (story tool -> asset tool, the contract; `client/scripts/story/shots/usage.ts`)

```ts
export type ShotNeed = { readonly cast: Readonly<Record<CharId, { view: 'face' | 'back'; rest: ExprId; figure: boolean }>>;  // rev. 3: every member needs fig + >= 1 hair lock (R9)
  readonly faces: Readonly<Record<CharId, readonly { expr: ExprId; talk: boolean; lines: readonly LineId[] }[]>>;
  readonly frame: Frame; readonly loc: LocId; readonly camTargets: readonly CamTarget[]; readonly motions: readonly Motion[];
  readonly room: RoomId | null };                                   // rev. 2: the room this shot draws, if any
export type WindowRefs = { readonly cur: readonly AssetId[]; readonly certain: readonly AssetId[]; readonly certainDist: number;
  readonly possible: readonly AssetId[]; readonly near: number; readonly d2: readonly AssetId[];   // rev. 5 (m3): near, §3.4
  readonly d3: readonly AssetId[]; readonly labels: boolean };     // rev. 2 (W8): props of a room in effect are listed; labels = its bound; rev. 4: certain / possible
export type ShotUsage = { readonly chapters: Readonly<Record<ChapterId, {
  readonly shots: Readonly<Record<BgId, ShotNeed>>;
  readonly assets: readonly AssetId[];                              // rev. 4 (W3): every shot-family file this chapter needs (§2.6); read by tierOf and scan-dist
  readonly look: Readonly<Record<WindowKey, WindowRefs>>;           // rev. 4: + room windows; rev. 5 (m7): `r:<room>`
  // rev. 2 (W5): per step, the alternatives a session entering there may await (one per possible top image: a CG of
  // the may-set, else a shot's drawn files; rev. 3: + the sprites in effect in a legacy chapter); the `entry step
  // images` row takes the largest alternative's half-tier AVIF bytes (rev. 3, C1).
  readonly entry: Readonly<Record<StepKey, readonly (readonly AssetId[])[]>>;
  readonly sprites: boolean }>> };                                  // rev. 3 (W5): some `show:` / `hide:`; keeps knot-set until SH12
export function decodeShotUsage(raw: unknown): Result<ShotUsage, string[]>;   // keysExactly, as emit.ts:562-610
// rev. 4 (W3): no shotTiers. The asset tool tiers each listed file with tierOf; scan-dist derives its own set (§2.5).
/** rev. 5 (m8): the story tool -> asset tool seam checks its shot-file ids by structure, never with catalog.ts's
 *  ASSET_ID_RE (`client/src/story/catalog.ts:390`, which admits `char/` as the only multi-segment form until SH3a
 *  widens it): `face/<s>/<c>/<x>` must name a shot of the list, a cast member of it and an expression of its need. */
export type ShotFileId = { readonly ns: 'bg' | 'sheet'; readonly shot: BgId }
  | { readonly ns: 'face' | 'talk'; readonly shot: BgId; readonly char: CharId; readonly expr: ExprId };
export function parseShotFileId(id: string): ShotFileId | null;
// SH3a's `assets: every shot file id in build/shots.json is a manifest asset id` keeps this grammar and the widened
// ASSET_ID_RE equal (one test over the fixture usage), so the two seams cannot drift.
```

Written to `server/content/build/shots.json` beside `usage.json` (`client/scripts/story/emit.ts:442`); byte-identical
across runs (sorted keys).
