## 5. Client half

### 5.1 Placeholder grammar and the renderer

```
placeholder := "$code(" local ")" | "$code(" local "." index ")"
local       := [a-z][a-z0-9_]*          (a PuzzleLocalId of this chapter)
index       := [1-9][0-9]?              (1-based: authors count dials from 1)
```

- One grammar for world texts, ink lines, choices, the en tables and hint templates. No braces (ink, R4). Any other
  `$` is literal text. A `$code(` that does not parse is a lint error at build and the mask at runtime.
- **Join rule:** `$code(p)` renders every entry in decimal, joined by `""` when `answerMax <= 9` (`1847`), else by
  `"-"`. `$code(p.n)` renders entry n. Both sides read `answerMax` (the public params give the client the shape).
- **Mask:** `·` (U+00B7) per entry while a value is unavailable (loading, failed, restarting, superseded); never for a
  value the store holds live while a refresh runs or after one fails (round 7, r6 W1, §5.2), nor for a spent run's
  last value in a world that owes it no restart (round 8, r7 W1: a recorded outcome, or the own final answer's window).

```ts
// client/src/world/values.ts (new; pure-world by path, arch.test.ts:130-137; engine)
export type Placeholder = { readonly puzzle: PuzzleLocalId; readonly index: number | null };
export type PlaceholderSpan = { readonly start: number; readonly end: number; readonly ph: Placeholder };
export type PlaceholderError = { readonly at: number; readonly reason: 'syntax' | 'index' };
export const VALUE_MASK = '\u00B7';
/** shown: the digits. pending: the mask, shimmering; it may still resolve (loading, restarting, failed + Retry).
 *  still: the mask with no motion loop and no Retry; it never resolves here (another chapter's text, a placeholder
 *  naming no per-player puzzle of this chapter, a malformed one) (W5). "This chapter" is the one yields holds
 *  (`ValuesDeps.chapter()`), judged by its world, never by what the store holds: a per-player puzzle of that chapter
 *  the store does not hold renders `pending` (round 9, r8 W1). */
export type ValueState = 'shown' | 'pending' | 'still';
/** A run of a shown text: plain text, or one rendered value (W2: every surface gets the value's position). */
export type TextRun =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'value'; readonly puzzle: PuzzleLocalId; readonly index: number | null; readonly text: string; readonly state: ValueState };
/** A text as a view shows it: `text` (aria-live, tests) and, when it holds a value, its runs, whose texts concatenate
 *  to `text`. Absent `runs` = one plain run. */
export type ShownText = { readonly text: string; readonly runs?: readonly TextRun[] };
/** What the renderer knows of one placeholder's puzzle. `len` sizes the mask; null (unknown here) gives three `\u00B7`. */
export type ValueLookup =
  | { readonly state: 'shown'; readonly value: readonly number[]; readonly max: number }
  | { readonly state: 'pending' | 'still'; readonly len: number | null };
/** Every placeholder of `text`, in order; the lint's and the renderer's one parser. */
export function placeholders(text: string): Result<readonly PlaceholderSpan[], PlaceholderError>;
/** `text` with each placeholder rendered through `lookup`; a malformed text renders every `$code(` as `still`.
 *  `puzzles` lists the puzzles the text names, so a value change re-renders only the views that hold one. */
export function renderText(text: string, lookup: (p: PuzzleLocalId) => ValueLookup): ShownText & { readonly puzzles: readonly PuzzleLocalId[] };
/** The chapter a line or choice ID belongs to: its first segment (`<chapter>.<knot>.<suffix>`, STAGING-DSL.md:153);
 *  null when it has none. The origin of an ink text for `render` (W5). */
export function lineChapter(lineId: string): ChapterId | null;
```

- **Reveal (m10).** The typewriter reveals plain runs per grapheme and a **value run as one step** (the value appears
  whole when the reveal reaches it). `retext` keeps the step count, so a value whose text changes length (the mask
  `\u00B7\u00B7\u00B7` -> `12-7-30`, a re-draw `9-14-2` -> `10-3-27`) never moves which plain graphemes are revealed; a finished line
  stays finished.

**R4.** ink gives `$` no meaning and `(` none mid-line; parentheses mark labels only on gathers and options, and `{ }`,
`|`, `->`, `<>`, `#`, `//` are its markers (ink `Documentation/WritingWithInk.md`, fetched 2026-11-03). A choice
starting `* $code(` cannot read as a label (`* (`). Test `story: an ink line with a placeholder compiles and plays
verbatim` compiles, with the build's inkjs compiler, a fixture holding a narration line, a speaker line, a choice
`* [Набрать $code(drawer) #id:…]`, a line starting `$code(drawer.1)` and one with `($code(drawer.2))`, plays it with the
inkjs runtime, and asserts each `Continue()` text equals the source text and each line keeps its `#id:` tag. It is a
verification (green on arrival, labelled so); the red-first of that commit is `story: an ink placeholder of an unknown
puzzle is refused`.

### 5.2 The values store (GameSession)

```ts
// client/src/app/values.ts (new; engine; owned by createYields, one per session)
export type PlayerValueView = { readonly value: readonly number[]; readonly run: number; readonly attemptsLeft: number | null;
  readonly spent: boolean; readonly max: number };
/** What surfaces see per puzzle (round 8, r7 W1 / m4 / m5): derived after every event from `Known` below, by the
 *  first matching rule of "Entry, derived". */
export type Entry =
  | { kind: 'loading' }                                       // nothing known yet; the request p awaits is in flight
  | { kind: 'ready'; v: PlayerValueView }                      // shown: a live value, or a spent run no restart is owed for
  | { kind: 'restarting'; from: PlayerValueView }             // the restart this store owes from `from.run` is in flight
  | { kind: 'superseded'; v: PlayerValueView; newer: number } // a status named run `newer` > v.run; a later request in flight
  | { kind: 'failed'; last: PlayerValueView | null; cause: 'fetch' | 'restart' | 'unheld' }; // the request p awaited
                                                              // failed: the Retry prompt; Retry re-issues exactly that
                                                              // request; 'unheld' (round 9, RULINGS 135 (a)): p is a
                                                              // per-player puzzle of `chapter()` with no entry in the
                                                              // store's generation of `chapter().id` (round 10: per
                                                              // puzzle, keyed by id); Retry loads `chapter()`
/** A request's token: per store generation, increasing; every fetch and restart gets one when issued (r7 m5). */
type ReqId = number;
/** What the store keeps per per-player puzzle of the chapter (round 8; replaces round 7's `restartFrom` and the
 *  `awaiting` kind). */
type Known = {
  best: PlayerValueView | null;   // the monotonic merge of every server body ("Merge")
  floor: number;                  // the highest run any response named, a status's `valueRun` included
  floorReq: ReqId;                // the first request issued after `floor` last rose: only its body or a later one
                                  // settles `superseded`
  awaiting: ReqId | null;         // the newest request whose answer can settle p while p shows no value; set to null
                                  // by any body that settles p (entry `ready` / `restarting`; round 9, r8 m4)
  owed: { readonly from: number; inFlight: boolean } | null; // a restart this store decided (the spent run it leaves),
                                  // kept until a body names a higher run or the decision lapses
  fail: 'fetch' | 'restart' | null; // set by the failure of the request in `awaiting` or of the owed restart; cleared by
                                  // a body that settles p and by a user's action (Retry, a Try's 409), never by an
                                  // automatic re-post (r7 m4)
  endedHere: boolean;             // this device's own final answer spent `best.run`; counts only while the world holds
                                  // no outcome for p
};
/** The last digits a `ready` entry brought, per (chapter, puzzle), for the whole session: the value-changed toast's
 *  base (round 9, r8 m1). Round 10 (r9 O1; round 9 kept it as `Known.lastDigits`, so a generation change dropped it):
 *  kept across every generation of the same chapter (a paywall round trip, a replay, a `sync` reload), keyed by the
 *  chapter so `ch2.drawer` never reads `ch1.drawer`'s digits, cleared only by `dispose`; memory only, never saved. At
 *  most one entry per per-player puzzle of the chapters played this session (tens, a few hundred bytes). */
type ShownDigits = Map<`${ChapterId}/${PuzzleLocalId}`, readonly number[]>;
/** The chapter whose world yields holds, as the store needs it (round 9, RULINGS 135 (a)). */
export type HeldChapter = { readonly id: ChapterId;
  readonly perPlayer: ReadonlyMap<PuzzleLocalId, { readonly len: number; readonly max: number }> };
/** Reconcile P3 (critique_perplayer_r10 O1): yields' `heldOf`. Returns `{ id: ch.id, perPlayer }`: the `id` always
 *  from the `LoadedChapter` passed in, only the `perPlayer` map cached (one entry, keyed by `ch.world`; a world-less
 *  chapter, `world: null`, `catalog.ts:1068-1069`, gets the empty map). Never a key. */
export const createHeldOf: () => (ch: LoadedChapter) => HeldChapter;
export type ValuesDeps = { api: Pick<Endpoints, 'getValues' | 'restartPuzzle'>; world(): WorldState;
  /** yields' open session's puzzle (`open?.local ?? null`), read when the store decides a restart: a linear re-entry
   *  after `solved` / `abandoned` plays p again (round 8, r7 W1, §3.6). */
  playing(): PuzzleLocalId | null;
  /** The chapter whose world yields holds now (round 9): `left ? null : heldOf(h.chapter())`, `heldOf =
   *  createHeldOf()` (reconcile P3, r10 O1: the `id` is read from the chapter on every call, only the `perPlayer` map
   *  is cached per `LoadedChapter.world`, which `loadEn`'s spread shares, `chapters.ts:273`; two world-less chapters
   *  share the key `null` and the empty map, never an `id`; a cache for speed only, never a key). Null before the first chapter and between `chapterLeft()` and the next
   *  world installation (the paywall). **The store's generation is keyed by the returned `id` (round 10, r9 W1;
   *  round 9 compared the returned object by identity, which the language switch's new `LoadedChapter` of the same
   *  chapter broke, `game.ts:1953`):** a generation is held for `chapter()` iff `held() === chapter().id`; its entries
   *  are built from the `perPlayer` of the `load` that created it, and a chapter's world is fixed between two `load`s
   *  ("Keyed by its chapter", the audit). */
  chapter(): HeldChapter | null; clock: Clock };
export interface ValuesStore {
  /** Called by `Yields.chapterEntered()` once the chapter is the session's (m2): a new store generation of `chapter()`
   *  every time, the same chapter included (a replay drops its `Known`, `endedHere` with it): drops the previous
   *  entries and aborts their requests; no request when its `perPlayer` is empty; `chapter()` null -> as `sync`'s drop.
   *  (Round 9: reads `chapter()` instead of taking the chapter and its map as arguments.) */
  load(): void;
  /** Called at every world installation (yields' `restore` and `chapterLeft`; round 9, RULINGS 135 (a), replacing
   *  round 8's `leave()`): `chapter()` null -> the generation is dropped (requests aborted, `held()` null, nothing
   *  reconciled); `held() !== chapter().id` (left, another chapter, never loaded), or a per-player puzzle of
   *  `chapter()` with no entry in the generation (round 10: unreachable on main, the defensive per-puzzle form) ->
   *  `load()`, the same fetch and failure state as `chapterEntered`; else the generation stays (every shown code with
   *  it, whatever object `chapter()` returned, round 10) and `reconcile()` runs, plus one automatic refetch when an
   *  entry is `failed` with `cause: 'fetch'` ("the retry at a `restore`"). */
  sync(): void;
  /** The chapter of the current generation, or null (none yet, or dropped). */
  held(): ChapterId | null;
  /** Decides, per puzzle, whether a restart is **owed**: `best` is spent and the world plays p with no failure of its
   *  own, i.e. `world()` holds no outcome for p and not `endedHere`, or `playing() === p` and p's outcome is `solved`
   *  / `abandoned` (a linear re-entry, §3.6). Newly owed -> one restart posted (`owed.inFlight`; at most one in flight
   *  per (puzzle, run)). Owed, not in flight, and no longer wanted (the world changed under it) -> `owed` and `fail`
   *  dropped, so the entry shows `ready(best)`. Called at the world replacements of this chapter (`sync` at
   *  `restore`, round 9; the `reset` effect), after `ended` records an outcome (`act(puzzle-ended)`, `yields.ts:535`),
   *  by `openPuzzle` (b), and by the store itself after every **successful** body (a fetch's 200, a restart's 200, a
   *  409's `value`); never after a failure, **never at `chapterChanged`** (round 8, r7 m3), and only over the
   *  generation of `chapter()` (round 9: a store that holds another chapter, or none, reconciles nothing). */
  reconcile(): void;
  /** `origin` = the chapter `text` belongs to (`lineChapter(lineId)` for ink texts; null = the current chapter, as for
   *  world texts). The current chapter is `chapter()` (round 9: never the store's generation). Another chapter's text,
   *  or any text while `chapter()` is null, renders every placeholder `still`; in the current chapter a placeholder's
   *  local id maps through the world's resolved `renamed.puzzles` first, then the entry decides (W5); a per-player
   *  puzzle of `chapter()` the store does not hold renders `pending` with its `len` from `chapter().perPlayer`. */
  render(text: string, origin: ChapterId | null): ShownText & { readonly puzzles: readonly PuzzleLocalId[] };
  /** p's derived entry (yields' `valuesPatch` and `openPuzzle` read it). A per-player puzzle of `chapter()` the store
   *  does not hold: `failed { last: null, cause: 'unheld' }` (round 9). A pure read: no read issues a request. */
  entry(p: PuzzleLocalId): Entry;
  /** The newest run the store knows for p (`best.run`), **in every entry state** (round 8, r7 W2); null only before
   *  any body, and for a puzzle the store does not hold (round 9). The session's port sends it with every attempt: a
   *  run the server moved past is a 409 carrying the current value, never compared, and the server answers a runless
   *  per-player attempt the same way (§3.5 step 4). */
  run(p: PuzzleLocalId): number | null;
  /** The digits of the last `ready` entry of p in `chapter()` this session, kept through masks and across generations
   *  of that chapter (`ShownDigits`; round 10, r9 O1; round 9 read `Known.lastDigits`, per generation); null when none
   *  was shown (round 9, r8 m1: `Open.seenDigits` starts from it). */
  lastShown(p: PuzzleLocalId): readonly number[] | null;
  /** >= 1 held entry is `failed`, or a per-player puzzle of `chapter()` is unheld (round 9; round 10: per puzzle, no
   *  entry in the generation of `chapter().id`). It reads the generation and `Known.fail`, never `entry`. The Retry
   *  prompt follows it (`syncPrompt`, "The Retry prompt"). */
  failing(): boolean;
  /** An attempt the server compared, for the run it sent (always a number now: a runless one is a 409): merged into
   *  that run only; `spent: true` also marks p `endedHere` (round 7, found while resolving). For a puzzle the store
   *  does not hold: dropped (it cannot occur, since such a Try sends no run, and is logged if it does). */
  answered(p: PuzzleLocalId, sent: number, r: AttemptResponse): void;
  /** A 409 value_changed of a Try: the server's current run of p, merged, then reconcile. A user's request, so a
   *  failed restart it names is re-posted with `fail` cleared (r7 m4). For a puzzle of `chapter()` the store does not
   *  hold (round 9): `load()` first (the user's action, as Retry), then v is merged into the new generation as p's
   *  first body (it is the server's current run of that puzzle), so the Try still unmasks the code at its 409. */
  learn(p: PuzzleLocalId, v: PlayerValue): void;
  /** A status of p named `valueRun`. Above `max(best?.run ?? 0, floor)`: `floor := valueRun`, one refetch is issued
   *  and p awaits it (`superseded` when a value is known, `loading` while nothing has landed: a first fetch in flight
   *  is not enough, its read may predate the status, r7 m5). At or below: nothing (the store is already as new, or a
   *  refetch for it is already awaited). For a puzzle of `chapter()` the store does not hold: `load()` (round 9; the
   *  first fetch reads the newest run anyway). */
  stale(p: PuzzleLocalId, valueRun: number): void;
  /** Resolves when p's entry is `ready` or `failed`: only `loading`, `restarting` and `superseded` hold it, so a
   *  refresh in flight over a `ready` entry never makes a lock wait (round 7, r6 W1). A puzzle the store does not hold
   *  is `failed` (`unheld`), so it resolves at once: never a wait (round 9, RULINGS 135 (a)). */
  ready(p: PuzzleLocalId): Promise<void>;
  /** `activated`: a background refetch of the chapter; shown codes stay ("Refresh" below). A store that holds no
   *  generation of `chapter()`, **or a per-player puzzle of `chapter()` with no entry in the generation** (reconcile
   *  P3, r10 m3: `sync`'s per-puzzle unheld form, stated once for both): `load()` instead (round 9: r8 W1 step 5,
   *  "activated refreshes nothing"), so `activated` resolves an unheld puzzle exactly as Retry does; the background
   *  refetch merges into held entries only and never creates one. */
  refresh(): void;
  /** The Retry prompt's action, on every `failed` entry: `fail` cleared (the prompt leaves at the tap), then exactly
   *  the request that failed is re-issued: `cause: 'restart'` re-posts the owed restart, or, when the restart is no
   *  longer owed (the world changed under it), drops it and leaves `ready(last)`; `cause: 'fetch'` joins one refetch
   *  that p awaits (round 8, r7 W1: "No dead end" below); `cause: 'unheld'` -> `load()` of `chapter()` (round 9). */
  retry(): void;
  /** Each change lists `shown`: the puzzles whose rendered value changed (mask -> value, value -> new value,
   *  value -> mask), which `revalue` re-renders; `entries`: the puzzles whose entry changed at all (its kind, run,
   *  `attemptsLeft` or `spent`), which yields' `syncValues` reads for an open frame (round 6, r5 W2); and `failing`:
   *  `failing()` (round 9: an unheld chapter included), which the Retry prompt follows (round 7). One call per event,
   *  after the store's own reconcile, so no surface ever sees a spent run of a fresh world as `ready`. A generation
   *  change (`load`, a dropping `sync`) lists every puzzle of the old and the new generation in `shown` and `entries`
   *  (round 9: every rendered value may change with it). */
  onChange(cb: (c: { readonly shown: readonly PuzzleLocalId[]; readonly entries: readonly PuzzleLocalId[];
    readonly failing: boolean }) => void): () => void;
  dispose(): void;
}
```

- **State per puzzle (round 7, r6 W1 / m5; replaces round 6's four-line state list).** Per per-player puzzle of the
  chapter the store keeps `Known`: `best`, the newest server body seen (a fetch's 200, a restart's 200, a 409's
  `value`, an own attempt's answer for the run it sent), and `floor`, the highest run any response named (a status's
  `valueRun` included).
  - **Merge (m5).** A body whose `run` is below `best.run`, or below `floor` when its request was issued before
    `floorReq` (round 8: a later request's body below `floor` first lowers it, "No dead end"), never replaces `best`;
    **a below-floor body of an older request fills a `best` that is still null (round 9, r8 m5):** it is the newest
    body known, so `run(p)` names it and a Try carries it to the 409, while rule (3) keeps it masked (`superseded`); if
    that run is spent in a fresh world, rule (2) owes a restart from it, which the server answers as a no-op with its
    current run (§3.6 restart: `run != from`), one idempotent request at most; a higher run replaces
    it; within one run the server holds one value (a value changes only with a new run, §3.5 step 3, §3.6), `spent`
    only turns true and `wrong` only grows (§3.5 step 5), so the merge takes `spent = a || b` and the smaller
    `attemptsLeft` (null = uncapped, above every number). Arrival order therefore never matters: a refresh body read
    before a restart committed and landing after its 200 changes nothing. Trade-off: a deploy that raises a per-player
    puzzle's cap mid-session shows the lower count until the next chapter load (a new `Known`).
  - **Entry, derived after every event (round 8, r7 W1; replaces round 7's "ready ... or spent in a world that failed
    the puzzle ... otherwise `failed`"), first matching rule:** (1) `fail !== null` -> `failed { last: best, cause:
    fail }`; (2) `owed !== null` -> `restarting { from: best }` (`best` is the spent run `owed.from`); (3) `best !==
    null` and `floor > best.run` -> `superseded`; (4) `best !== null` -> `ready(best)`: a live value, **or a spent run
    no restart is owed for**: a world holding any outcome for p (`failed`, `solved`, `abandoned`) that does not play
    it, or the own final answer's window (`endedHere`); (5) otherwise `loading`. `ready` renders the digits; the other
    four render the mask with its shimmer. The derivation reads no world outcome itself: what a world owes is decided
    once, in `reconcile`, so the display can never disagree with the restart decision (the round-7 defect: a solved
    world owed nothing yet derived to `failed`).
  - **No dead end (round 8, r7 W1).** A `failed` entry exists only while `fail` is set; `fail` is set only by the
    failure of the request p awaited (`awaiting`) or of its owed restart; Retry re-issues exactly that request; and that
    request's success always leaves p `ready` or `restarting`: a fetch body from a request issued at or after
    `floorReq` settles `superseded` (should it name a run below `floor`, which cannot happen while runs only grow,
    §3.5, `floor` drops to it and the console logs `values: run below a status`), so rule (4) or, through
    `reconcile`, rule (2) applies; a restart's 200 names a higher run, which ends `owed`. So `retry()` never loops on
    a state no fetch can change, and every prompt is cleared by the success of its own request.
  - **Refresh (r6 W1).** A fetch that is not the chapter's first (`activated`, Retry, the retry at a `restore`, a
    status's `stale`) changes no `ready` entry when it starts, while it is in flight or when it fails: every surface
    keeps the digits, `ready(p)` does not wait for it, no prompt shows and no frame changes. A success merges like any
    body. **Tokens (round 8, r7 m5):** every request issued while p shows no value (`loading`, `superseded`, `failed`)
    becomes the one p awaits (`awaiting := id`); a `ready` or `restarting` entry awaits no fetch: **any body that
    settles p (its entry derives `ready` or `restarting` after the merge: a fetch's 200, a restart's 200, a Try's 409,
    an own answer) sets `awaiting := null` (round 9, r8 m4)**, so a request issued before that settle can fail
    nothing. A failure sets `fail := 'fetch'` only on entries whose `awaiting` is **that** request's id, so an older refetch failing while a newer one
    is in flight (two `stale` calls, a Retry over an `activated` refresh) changes nothing; every other entry is
    unchanged, a `failed` one stays `failed` (no second edge), and a `restarting` entry is left to its own request.
    **Why keep a known code:** a value changes only by a server action,
    and the run guard already makes a code the server moved past harmless (§3.5 step 4: a Try against it is a 409
    carrying the current value, never counted); masking would buy no safety and cost, on every resume, a `1847 -> ···· ->
    1847` flicker with the `change` motion on every span, and, on a resume over a socket iOS dropped in the background,
    a mask and a prompt over codes the player just read (§0 R7: the mask is for a value that is unavailable). The two
    values the client **knows** are dead mask at once (TRUTH): a status naming a newer run (`stale`, `superseded`) and a
    spent run a restart is owed for (`restarting`, or `failed` when its restart failed). A spent run nobody restarts
    (a recorded outcome) is not dead: it is the server's current value of p, and it changes only if the story plays
    the puzzle again, which owes the restart and then masks it (round 8, r7 W1).
  - **`activated` while a restart is in flight.** The refresh's body settles the entry only if it names a run above
    `from` (the restart committed, or another tab's); a body naming `from` itself changes nothing; its failure leaves
    `restarting` alone. The restart's own failure applies only while the entry is still `restarting` from that run.
  - **Restarts (round 8: `owed`, r7 W1 / m4).** `reconcile` decides what is owed (its doc above); at most one restart
    in flight per (puzzle, run). After one fails (`fail := 'restart'`, entry `failed`, `last` the spent run), the next
    successful body that names that spent run re-posts it, and so does Retry; a failure itself never reconciles, so
    nothing loops. **Who clears `fail` (m4):** a re-post caused by a user's action (Retry, the 409 of the player's Try)
    clears it, so the prompt leaves at the tap and returns only if that request fails; a re-post caused by an automatic
    body (an `activated` refresh, a status's refetch) keeps it, so the prompt and the mask stay up through the re-post
    and leave only when its 200 lands; a resume over a restart that keeps failing therefore never slides the prompt
    out and back (round 7's "the prompt never leaves and returns on a resume" was false while a restart kept failing,
    r7 m4). (Round 6's "at most once per (puzzle, run) per store" let a Try after a failed restart re-learn run 3's dead
    value with no re-post: found in round 7.) A world whose outcome is `failed` owes no restart (the failed-world rule,
    §3.6); one holding `solved` / `abandoned` owes one only while the story plays the puzzle again (`playing()`).
  - **The own final answer (found in round 7).** `answered` with `spent: true` marks p `endedHere`; the mark counts
    only while the world holds no outcome for p and goes with the store generation (round 8: `load` always starts a
    new one) or at a world replacement. The session ends `failed` at once, but `onEnd` queues `ended`, which records
    the outcome after the close-up fade (`yields.ts:544-561`, `:529-535`); a values body landing in that window would
    otherwise meet a spent run in a world with no outcome and re-draw before any restart, against O2. A world replaced
    by an older save afterwards is a real restart (§3.6's table), so the mark clears there. (A give-up tapped during
    that final attempt cannot turn this into `abandoned`: the session defers it and the decisive answer wins,
    `session.ts:174-175`, `:227-231`.)
  - **The Retry prompt.** Yields shows the `values_failed` prompt (`vm.showToast`, as `yields.ts:288` shows its notes;
    Retry: dismiss + `values.retry()`) when `failing()` is true and dismisses it (`vm.dismissToast`,
    `state.svelte.ts:95`, `:168`; GM6t's `out`) when it is false, through one level-triggered function `syncPrompt()`
    (round 9, RULINGS 135 (a); round 8 followed `failing`'s edges only): it compares `values.failing()` with
    `promptUp` and acts only on a difference, so on the store's events it behaves exactly as the edges did (M-P8i's
    "no change reports `failing` false" still decides), and it also runs after every world installation (`restore`,
    `chapterLeft`, `chapterEntered`) and at `openPuzzle`, so a store state that arose without an event (a puzzle the
    store does not hold) still shows its Retry. **Round 10 (r9 W1): `Yields.render`, the one wrapper every surface
    renders through, schedules it too:** when the text it rendered holds a placeholder of the current chapter and
    `values.failing() !== promptUp`, one deduplicated `queueMicrotask(syncPrompt)`; the store's `render` stays a pure
    read, and the prompt is a toast, never a request. A microtask, never a synchronous call: a view may render while
    Svelte evaluates a `$derived` or a template expression, where a state write (`vm.showToast`) is refused (CLAIM:
    Svelte 5's `state_unsafe_mutation`; verify at GM6c2's cut), and the microtask also lets a store event of the same
    block run `syncPrompt` first. So a mask a surface shows over a failing state brings its Retry
    within the same task, whatever path produced the state (a language switch on round 9's key would have; a later
    path that changes `chapter()` without an installation would). A store event in the same block runs `syncPrompt`
    synchronously first, so the scheduled call finds no difference and does nothing: no second toast, no flicker.
    **One render path (reconcile P3, critique_perplayer_r10 m2):** every value surface renders through that wrapper,
    so the claim above holds for each: the ink surfaces (`lineView` / `choiceSet` / `backlogLines`, `game.ts:501`,
    `:506`, `:510`, GM6c3), the explore controller's `shown` dep for documents and items (§5.3: yields passes
    `(t) => render(h.text(t), null)`, its own wrapper; round 10 wrote `values.render`, which skipped the scheduling on
    ch1's diary clue), the labels' texts (GM6d2, the same wrapper) and every later module's `read` text. `values.render(`
    occurs exactly once in `yields.ts`, inside the wrapper: pin `yields: every value surface renders through render`
    (GM6c2, a source count as `yields: every batch goes through held` was; **M-PR1c**). **Reconcile r2
    (critique_perplayer_r1 O1):** a count of the spelling misses an alias (`const { render } = values` handed to a
    surface), the shape engine.md closed for `held` by declaration (`BATCH_MEMBER`, [engine §8.1 The cue union and the bus](../engine/08a-cue-union-and-bus.md#81-the-cue-union-and-the-bus)). So the
    site is checked by declaration in GM3p's walk, which GM6c2 holds (`client/src/requests.test.ts`): with
    `BATCH_MEMBER` made a list `SITE_MEMBERS` (R-E34), GM6c2 adds the row `{ file: 'app/values.ts', type:
    'ValuesStore', member: 'render', site: 'RenderOrigin' }`, `RenderOrigin` (= `ChapterId | null`) a type alias in
    `app/yields.ts` used only by the wrapper's `origin` parameter (the store declares its own `origin` as `ChapterId |
    null`), so every reference to `ValuesStore.render` (a call, a value hand-off, a destructure, a bind; the walk's
    three shapes) must lie inside the wrapper's declaration, exactly one over the program ("site outside <member>
    <file> <fn>", "site count <n>", "site <n> declarations"); M-PR1c re-pointed to it and the source pin retired in
    that commit (one check per invariant). Test-only, 0 bundle bytes. Until engine.md answers R-E34 the pin stands as
    written, and GM6c2's cut reads which form applies. **Reconcile r3 (E-P29 (c)): answered.** engine.md adopts R-E34
    with a change (`SITE_MEMBERS` in GM3p's walk, [engine §8.1 The cue union and the bus](../engine/08a-cue-union-and-bus.md#81-the-cue-union-and-the-bus)): a row is `{ label, member: { file, type,
    name }, site: { file, alias } }`, so GM6c2's row reads `{ label: 'render', member: { file: 'app/values.ts', type:
    'ValuesStore', name: 'render' }, site: { file: 'app/yields.ts', alias: 'RenderOrigin' } }` and its messages are
    "render outside <site fn> <file> <fn>", "render site count <n>", "render site <n> declarations"; the source pin
    stands only if GM6c2's cut finds GM3p merged without `SITE_MEMBERS` (a cut check, not a design fork); and GM6c4's
    `yields: a document that meets a puzzle the store does not hold shows the Retry prompt` covers a world surface.
    **Session end (reconcile P3, r10 open question 1):** `Yields.dispose()` dismisses the prompt when `promptUp`
    (`vm.dismissToast('values_failed')`, as main's teardown dismisses its own session prompt, `game.ts:1465`,
    `:1469`), sets `disposed`, and only then disposes the store; `syncPrompt()` returns at once while `disposed`, so a
    microtask scheduled before the teardown never shows a prompt over the story list; a second `dispose()` (main calls
    it twice on an exit, `exitNow` `game.ts:1508`, then `endSession` `:1518` -> `:1465`) is a no-op. Test `yields:
    dispose dismisses the values prompt and a queued prompt stays down` (**M-PR1a**, **M-PR1b**).
    Retry clears `fail` on every `failed` entry, so
    the prompt leaves at the tap and returns only if a re-issued request fails; an automatic fetch or re-post leaves
    `failed` entries `failed` until a body settles them, so the prompt never leaves and returns on a resume (now true
    with a failing restart too, m4).
  - **Requests.** Each call issues its own request with its token (a refresh does not join an older fetch: that
    fetch's read may predate the resume); the merge makes their order irrelevant; `load`, a `sync` that drops or
    replaces the generation (round 9; round 8's `leave`) and `dispose` abort them, and a response of an older
    generation is dropped.
- **Keyed by its chapter (round 9, r8 W1; RULINGS 135 (a), the orchestrator's ruling).** A generation belongs to one
  chapter (`held()`), and the chapter that matters is the one yields holds (`chapter()`), never the other way round.
  - **Invariant.** After every world installation the generation is the one loaded from `chapter()` (so `held() ===
    chapter()?.id`), or none when `chapter()` is null: yields' `restore` (on main and after
    this lane always a world of `h.chapter()`: its two call sites are `game.ts:906`, which `chapterLeft()` replaces, and
    `:925`) and `chapterLeft()` call `values.sync()` after installing the world; `chapterEntered()` calls
    `values.load()`. So a world of chapter c never meets a store that does not hold c's values: left at a paywall,
    another chapter's, or never loaded, the store loads c's values with the first fetch's mask and failure state
    (`loading`, then `ready` / `failed` with the prompt), and the first body reconciles against the restored world.
    Under a paywall (`left`, `chapter()` null) the generation is dropped and nothing reconciles, so the empty world
    restarts no spent run of the chapter left (r7 m3's class, closed as in round 8).
  - **The key is the `ChapterId` (round 10, r9 W1).** The ruling says "keyed by its chapter"; round 9 implemented it
    as the identity of the `HeldChapter` object, one per `LoadedChapter`, and on main a `LoadedChapter` of the same
    chapter is replaced with no world installation: `setLang` assigns `s.ch = r.value` (`game.ts:1953`), the result of
    `loadEn`'s `{ ...ch, en: en.value }` (`chapters.ts:273`), on the first switch to English in every free chapter
    loaded in Russian (`withEn: vm.lang === 'en'`, `game.ts:811`; `ch.en === null`, `:1950`), and then only
    `relabel(s)` runs (`:1957-1959`, `:457-466`). The id survives that spread, the identity does not, and nothing of
    the store's depends on more than the id: the per-player set comes from `world`, which the spread shares
    (`catalog.ts:1069`). **Why the id is a sufficient key (the audit):** `chapter()` = `left ? null :
    heldOf(h.chapter())`, `h.chapter()` is `s.ch` (`game.ts:1278`), and on main `s.ch` is assigned at exactly two
    places (Grep `\.ch = ` over `game.ts`): `enterChapter` (`:827`), which GM6c2 follows in the same synchronous run
    with `chapterEntered()` -> `values.load()`, a new generation unconditionally (the same id included, so a reload
    of a chapter always rebuilds its entries from the world just loaded); and `setLang` (`:1953`), guarded to the same
    id (`s.ch?.id === r.value.id`, `:1952`) with the same `world`. `left` is written only inside yields'
    `chapterLeft` / `restore` / `chapterEntered`, each of which then calls `sync` or `load`. A new session builds a
    new `Yields` and a new store. So after every synchronous block on main's paths `held() === chapter()?.id` and
    every per-player puzzle of `chapter()` has its entry: the unheld state is unreachable on main, and the language
    switch keeps every shown code with no request (no `1847 -> ···· -> 1847`, §5.2 "Why keep a known code"). Rejected:
    keeping the identity key and adding a `sync` / `syncPrompt` call to `setLang` (a fifth `game.ts` hunk; one
    `getValues` and a masked flicker of every code per language switch, for a chapter whose values did not change;
    and the two statements of the key would still disagree, r9 W1 step 8); keying by the `world` reference (it would
    work, but it makes the store's correctness rest on how a loader copies an object; the id is what the ruling
    names, and the cache by `world` is only a speed-up). §14 Q15 re-runs the audit at GM6c2's cut: a third `s.ch`
    assignment, or one that changes the id without `enterChapter`, is a STOP item.
  - **A puzzle the store does not hold** (round 10: per puzzle, a per-player puzzle of `chapter()` with no entry in
    the store's generation of `chapter().id`; every such puzzle when `held() !== chapter().id`; round 9 wrote "no
    generation of that `chapter()` object"; unreachable on main by the audit above, the defensive answer the ruling
    asks for, and if a later path reaches it the first render of its mask schedules the prompt, "The Retry prompt"): `entry` =
    `failed { last: null, cause: 'unheld' }`, rendered `pending` (the mask with its shimmer, never `still`); `ready`
    resolves at once; `run` = null; `failing()` true. So an open frame ends its wait `idle` + `puzzle:ready` with Try
    enabled (§5.5's `failed` row), `syncPrompt` shows Retry, and every action resolves it: Retry, a Try (runless, so
    the server's 409 brings the value, which `learn` merges after loading the chapter), `activated` (`refresh`, whose
    per-puzzle unheld form is `load()`, reconcile P3, r10 m3), a status (`stale`). No read issues a request (render, `entry`, `ready`, `run` stay pure).
  - **No dead end, extended.** The guard `values: every masking state has an action that resolves it` walks every
    state that masks (`loading`, `failed` by fetch, `restarting`, `failed` by restart, `superseded`, the superseded
    entry an older refetch failed under, `unheld` by drop and by another chapter, and (round 10) `unheld` per puzzle,
    a per-player puzzle of `chapter()` missing from a generation of the same id; plus the states that must not mask:
    an entry a 409 settled whose refetch then fails, m4, and (round 10, r9 W1) the held chapter under a new
    `HeldChapter` object with an equal map, the language switch's shape) and asserts for each: the current chapter's
    placeholder renders `shown` or `pending`, never `still`; a `pending` entry either awaits a request in flight whose
    success derives `ready` / `restarting`, or has `failing()` true and a `retry()` that issues exactly one request
    whose success does; `ready(p)` is pending only while such a request is in flight; and (reconcile P3, r10 m3) for
    every `unheld` state `refresh()` issues exactly one request, the `load`, whose success derives p's entry from its
    body (**M-PR1d**: `refresh` per generation only). It is a store-level guard over a
    fake `chapter()`; the game-level paths that change `chapter()` are the audit's two `s.ch` assignments and `left`,
    each pinned by a `game` test (`game: entering a chapter loads its values`, `game: a language switch keeps the shown
    codes`, the two paywall tests), and any path the audit misses still shows Retry with its mask through `render`'s
    prompt scheduling (`yields: a render that meets a puzzle the store does not hold shows the Retry prompt`).
- **Owner and lifetime.** Created in `createYields`, disposed by `Yields.dispose()`; its requests abort on `load`,
  a dropping or replacing `sync` and dispose; a response after dispose or of an older generation is dropped (the session-generation rule of
  today's sessions). A restart already posted still commits on the server; the next load reads its run (§7). The
  `values_failed` prompt is yields' (shown and dismissed only by `syncPrompt` and `dispose`): `Yields.dispose()`
  dismisses it and makes every later `syncPrompt` a no-op ("The Retry prompt", reconcile P3).
- **Request sites (reconcile P1, E-P23 (a), RULINGS 148 W1; replaces E-P22 (a)'s `WAIT_SITES` author step).** GM3p's
  request walk (`requests: every request start is a declared site`, `client/src/requests.test.ts`, engine.md §8.1
  point 11) sees every reference to a guarded member; this file's are four, each a **view row** of `REQUEST_SITES`,
  none `other` (a values wait is a view wait; an `other` row in a views file is red by the walk's own rule once
  `'app/values.ts'` is in `VIEW_FILES`, **M-PR1h**):

  | file | fn (nearest enclosing named function) | member | waits |
  |---|---|---|---|
  | `app/values.ts` | `issueFetch` (the one function every `load` / refresh / refetch / `stale` / `learn` fetch calls) | `Endpoints.getValues` | `['values']` |
  | `app/values.ts` | `issueRestart` (the one function every owed restart and re-post calls) | `Endpoints.restartPuzzle` | `['restart']` |
  | `app/game.ts` | `getValues` (yields' api forwarder, beside `getPuzzle` / `postAttempt`, `game.ts:1336-1346`) | `Endpoints.getValues` | `['values']` |
  | `app/game.ts` | `restartPuzzle` (the same forwarder) | `Endpoints.restartPuzzle` | `['restart']` |

  GM6c2 adds `'values' | 'restart'` to `WaitRow` (in `requests.test.ts`), their answer-row cases to `WAIT_CASES`
  (`yields.test.ts`: start `puzzle:checking`, end a `CHECKING_ENDS` key, E-P21 (a)) and `'app/values.ts'` to
  `VIEW_FILES`; no root extension. The two forwarders are plain (no `attemptsInFlight` count: a restart committed on
  the server survives a reload, §7, and a values read changes nothing). `getValues` / `restartPuzzle` themselves land
  in **GM6s2** commit 2 inside `createEndpoints` (`api/endpoints.ts:71-100`), under its existing port row, so they need
  no row (E-P23 (a) says GM6c2; corrected, §12.2). `ValuesDeps.api` stays `Pick<Endpoints, 'getValues' |
  'restartPuzzle'>` (E-P24 (c)); yields' `YieldsHost.api` Pick (`yields.ts:89`) and `GameDeps.api` Pick (`game.ts:132`)
  gain the two members. No `FetchAsset` reference (E-P24 (b)); no `YieldsHost.apply` reference outside `held` (E-P24
  (a)). **Reconcile r2 (E-P28 (b), (c)):** no GM6 lane adds a promise-returning member to `YieldsHost` or to a host
  type handed to the views (the two `api` members are port members, which `HOST_WAITS` excludes, [engine §8.1 The cue union and the bus](../engine/08a-cue-union-and-bus.md#81-the-cue-union-and-the-bus)),
  so no `HOST_WAITS` row is added; `ValuesStore` is created inside `createYields` and reaches no host type, so round 1's
  conditional `{ member: 'ValuesStore.ready', wait: 'values' }` row lapses (its wait is the `values` answer row). The
  `Pick` is never typed `unknown` / `object` / `{}` ("widened") nor received through a generic whose constraint
  re-declares a member ("re-typed").
- **Templates outside their chapter (W5).** The store holds the current chapter's entries only. The backlog lives for
  the session and is restored from the save (`game.ts:1351`, `:669-671`, `:930`), so it holds templates of earlier
  chapters and of ids renamed since. Rule: a text renders against the chapter it belongs to. A line of another chapter
  renders each placeholder `still` (the mask, no shimmer, no Retry): never this chapter's value, even when this chapter
  has a puzzle with the same local id (local ids are per chapter: `ch2.drawer` is legal). A current-chapter template
  with a pre-rename id (`$code(desk_drawer)` saved before `desk_drawer -> drawer`) resolves through the world's resolved
  `renamed.puzzles` (engine.md §5.3, filled from GM6c1b on) and shows the renamed puzzle's value. Placeholders in a
  carried item's text cannot name another chapter (engine.md R-E10 lint), so world texts always use the current
  chapter. Tests: `values: another chapter's template renders still`, `values: a template naming a renamed puzzle
  renders the new puzzle's value` (GM6c2), `game: a ch1 backlog line in ch2 never renders ch2's value` (GM6c3).
- **Re-located on main `acc4e0d` (reconcile P1/P4; the `game.ts:N` cites of this bullet are `525dd68`'s):**
  `chapterChanged()` `game.ts:890`, `s.ch = ch` `:891` (then `s.assets`, `s.lines` `:892-893`, the first `await`
  `:899`: `chapterEntered()` goes after `:893`, before `:899`); the paywall restore `:970` (in `resumeBody` `:949`, the
  same-chapter test `:951`, the branch `:958-972`); the resumed restore `:989`; `chapter: () => of().ch` `:1362`;
  `onLifecycle` `:1966` (the `activated` branch from `:1984`).
- **What `Yields` exposes (GM6c2; `Yields` at `yields.ts:122-151`):** `render(text, origin): ShownText & { puzzles }`
  (the store's `render`, plus round 10's prompt scheduling, "The Retry prompt"; reconcile P3: the one render path of
  every value surface),
  `onValuesChange(cb: (changed: readonly PuzzleLocalId[]) => void): () => void` (the store's `shown` list),
  `activated(): void`, `chapterEntered(): void` and (round 8) `chapterLeft(): void`. `game.ts` calls
  `chapterEntered()` in `enterChapter` right after `s.ch = ch` (`game.ts:827-829`; `chapterChanged()` at `:826` runs
  before the chapter is set, and the chapter load has finished by then, m2), `chapterLeft()` in `resumeBody`'s paywall
  branch **in place of** `s.yields.restore(EMPTY_WORLD_STATE, null, null)` (`game.ts:906`; round 9, RULINGS 135 (a);
  round 8 called it right before that restore): it sets yields' `left`, installs the empty world through the same
  private `install(world, reset, at)` that `restore` uses (the puzzle dropped by engine.md's `dropPuzzle('closed')`,
  the no-outcome drop its §8.1 lists for `restore`, `dropPuzzle`'s doc at [engine §8.1 The cue union and the bus](../engine/08a-cue-union-and-bus.md#81-the-cue-union-and-the-bus) as read in its round 9, re-located in round 10 (r9 question 3; round 9 cited [engine §8.1 The cue union and the bus](../engine/08a-cue-union-and-bus.md#81-the-cue-union-and-the-bus)); the jobs, the controller, the panels,
  the root-back, `world := EMPTY_WORLD_STATE`: exactly what that restore did), then `values.sync()` (no wanted chapter:
  the store drops its generation, so no reconcile sees the chapter left against the empty world; r7 m3's class) and
  `syncPrompt()`; `activated()` from `onLifecycle` (GM6c2), and subscribes `revalue` to `onValuesChange` (GM6c3).
  `restore(world, reset, at)` becomes `left := false; install(world, reset, at); values.sync(); syncPrompt()`, and
  `chapterEntered()` `left := false; values.load(); syncPrompt()`; yields passes `chapter: () => left ? null :
  heldOf(h.chapter())` (the world's per-player puzzles, cached per `LoadedChapter.world`; round 10: a speed-up, never
  the key, which is the returned `id`). `chapterChanged` calls nothing
  on the store (r7 m3): `chapterEntered` follows it in the same `enterChapter` (`game.ts:826-829`, its only caller),
  and the new generation's first body reconciles. yields passes `playing: () => open?.local ?? null` (round 8).
  **A resume into the chapter already entered skips `enterChapter` (`game.ts:887`); its `restore` calls
  `values.sync()`, which keeps a store that holds this chapter (and reconciles it against the restored world) and
  loads the chapter's values into one that does not (left at a paywall by `chapterLeft()`, or never loaded), with the
  same fetch and failure state as `chapterEntered` (round 9, RULINGS 135 (a); round 8 said "keeps the loaded store",
  false after a paywall: r8 W1).** The scene and the overlay never read the store
  (principle 7): they get rendered texts and commands.
- **Never saved.** Memory only: not in `WorldState`, not in the save body (the backlog stores `{lineId, ru}`
  templates), not in CloudStorage / DeviceStorage / `localStorage` (arch rules `web-storage` etc. hold).
- **Motion.** The store emits no cue (R-E3 withdrawn, §12): each surface animates its own value change (§5.3).

### 5.3 Clue surfaces and TRUTH

| Surface | Rendered where (lane) | On a value change |
|---|---|---|
| doc body paragraphs, item descriptions | the explore controller builds `DocView.body: readonly ShownText[]` and `ItemView.desc: ShownText` through a new dep `shown: (t: WorldText) => ShownText` (yields passes `(t) => render(h.text(t), null)`, **its own wrapper `render`, never the store's `values.render`** (reconcile P3, r10 m2: the wrapper schedules the Retry prompt), beside `text` at `yields.ts:460`); `DocumentReader` and `Inventory` render them through `ValueText` (GM6c4) | `revalue(changed)` re-builds only the open document / inventory views whose source holds a changed puzzle's placeholder (`puzzles` of `render`); `ValueText` plays the value motion on each changed span |
| ink lines, choices, backlog | `game.ts` `lineView` / `choiceSet` / `backlogLines` carry `runs` from `s.yields.render(s.lines.text(id, ru, lang), lineChapter(id))` (`game.ts:437-455`), each backlog entry and its `chosen` text by **its own** ID's chapter (W5); `DialogueBox` writes the runs through the typewriter's run writer, `Choices` and `Backlog` through `ValueText` (GM6c3) | `revalue(s, changed)` beside `relabel` (`game.ts:457-466`) **re-renders text only: it calls nothing on `scene` (no `scene.talk`, no `apply`) and never reports `lineShown` again**, so a talker keeps its call points (the line display and `lineShown()`; `characters.md` §6.2, R7) whatever design owns it after RULINGS 132 (r3 W2); the line on screen is re-built **with the same `reveal`** only if its source holds a changed placeholder, and `DialogueBox` then calls `typewriter.retext` (the revealed step count kept, a value run being one step, m10; a finished line stays finished, `onDone` never reported twice) while the writer plays the value motion on the changed span; an open choice set is re-built **with the same `id`** (`game.ts:442-445` mints a new one only for a new step); backlog entries likewise. A language switch (K49) keeps today's full relabel with a new `reveal`, so the reveal restarts in the new language as today |
| labels on the art (role `read`, R-E25) | yields' `labels` command (GM6d2), each text through yields' wrapper `render(h.text(label.text), null)` (reconcile P3, r10 m2: the wrapper, never `values.render`) | a `labels` command for the current room, applied through `held` (E-P24 (a); a labels-only batch's `at` from `stateHold`, `'no-load'`, honoured while `stats().stale === 0 && !stats().reviving`, R-E33, E-P28 (a)); the executor crossfades a changed label (§6.4). **Reconcile r2 (W2):** sent only while the stage shows the room's bg (a CG over it included); during a cut-away (a room event's close-ups) nothing is sent, and the batch that shows the room again carries the current labels (§6.2 "Producer"). **Reconcile r3 (W1):** the labels-only batch is sent by the labels job, an intent queued through `YieldsHost.queue` that runs after the batch in flight and renders the labels when it runs, so a value that lands while a room, visual or story cut-back batch loads reaches the art right after that batch, the newest value last |
| hint texts | server-rendered (O3); `PuzzleStatus.valueRun` (status only; a hint-use text is "run unknown", m3) | **W3.** On every store change of p while p's session is open, yields calls `session.valueChanged(run)`: each tier text not rendered at the store's current run is dropped. If the ladder is open it is re-rendered at once (those tiers `unlocked`, `text: null`, `busy`: `HintLadder.svelte:41-45` shows "unlocked" and no text), yields emits **`puzzle:hint-renewing`** once per dropped tier (`index` = tier; R-E20: `fold` on the tier, wherever the ladder is, a frame or engine.md's ExploreView `ladder` sheet; r3 m7), and the status is re-fetched (free: a read); each tier whose text changed re-plays engine.md's `puzzle:hint-shown` (`unfold`). A closed ladder fetches when it opens (`yields.ts:704-709`), and a re-read of an unlocked tier whose text was dropped fetches instead of re-showing memory (`yields.ts:726-729` gains that branch). A status whose `valueRun` differs from the store's run calls `stale(p, valueRun)` (round 7: a newer run masks p until the refetch lands; an older one changes nothing), and the store change that follows runs the rule above (GM6c2; the cue is GM3p's) |
| the attempt verdict | server | `run` sent: the newest run the store knows, in every entry state (round 8, r7 W2); a runless per-player attempt (no body has landed) is a 409 as well; 409 `value_changed` -> `learn(p, value)` + reconcile; nothing counted; the open frame plays `puzzle:renewed` when its run changes (W6, R-E14), a frame that showed no run included |
| every `toast` / `name` line, kernel or module (look texts, lock texts, titles, names, prompts, hotspot labels; engine.md's `use` `say` / `refuse`, a recipe's `say`) | none: `world/placeholder` refuses a placeholder there by role (§4; round 6, R-E25) | - |
| a later module's `read` text | its module's view, through `Yields.render` (the contract of the `read` role, R-E25) | as the doc / item rows: `revalue` re-renders the views whose source holds a changed placeholder |
| another device | its own store | its next response: load / resume (`restore`), `activated` (one call `s.yields.activated()` -> `values.refresh()`, added beside `game.ts:1833-1839`; on main `acc4e0d`: in `onLifecycle`'s `activated` branch, `game.ts:1966`, `:1984-1993`, reconcile P1), Retry, any 409, any `valueRun` mismatch (`stale(p, valueRun)`). No verdict is ever given against a value that device did not show (the run guard); until one of those responses lands this device keeps showing the code it knows (round 7, r6 W1) |

**Value motion (maximum animation: every value change moves, on every surface).**

```ts
// client/src/ui/value-motion.ts (new, GM6c3; engine). The only caller of Element.animate for values.
export type ValueMotion = 'change' | 'mask';
/** Keyframes and timing per motion and per reduced-motion setting. */
export const VALUE_MOTIONS: { readonly [K in ValueMotion]: { readonly full: MotionDef; readonly reduced: MotionDef } };
export type MotionDef = { readonly keyframes: readonly Keyframe[]; readonly ms: number; readonly iterations: number };
/** Plays `kind` on one value span; the caller cancels the returned Animation when the span changes again or leaves. */
export function playValue(el: Element, kind: ValueMotion, reduced: boolean): Animation;
```

- `change` (mask -> digits, old digits -> re-drawn digits): the new digits rise in (opacity 0 -> 1, `translateY` 6 -> 0
  px, `blur` 4 -> 0 px) over 320 ms; `mask`: a light sweep over the `·` run (background-position), 1,200 ms per cycle,
  looping while the value is `pending`. A `still` value gets the `change` motion when it first appears or changes
  text and no loop (it will not resolve, so a shimmer would promise a load that never comes, W5). Reduced motion:
  opacity / colour only, >= 120 ms (engine.md §8.6's rule), never a cut. Durations are CLAIM defaults for
  `design-animation` to tune (R-A3). The gate's floor and its visibility test are engine.md's `MIN_VISIBLE_MS`
  (`cues/types.ts`) and `keyframesVisible` (`cues/visible.ts`), imported, not copied (E-P8).
- `ValueText.svelte` (new, GM6c3) renders a `ShownText`: plain runs as text, each value run as
  `<span class="value" data-value={puzzle}>`, through Svelte's text interpolation only (no `{@html}`); a Svelte action
  per value span calls `playValue` when its text changes and cancels on destroy. The typewriter's run writer does the
  same for the dialogue box, with nodes made by `createTextNode` / `createElement` + `textContent` (no markup parse).
  **Resolve rule (round 9, RULINGS 135 (b), engine.md's rule for every motion target, mirrored here):** a value span
  is animated only once the write that creates or changes it is in the DOM: `ValueText`'s span action runs after
  Svelte's flush (an action's mount / update, never a `$effect.pre` over the runs), the run writer right after its
  own synchronous DOM write; a span a write removes plays no value motion of its own (its line's or frame's exit
  belongs to that view's owner) and its action's destroy cancels its `Animation`. No timer. Test `value-text: a value
  span a re-render creates plays its motion after its flush` (GM6c3). A span inside a frame that first shows at the
  chunk write mounts in that flush and its action runs on mount; no ghost; value motions are not cue motions, so
  engine's `fallbacks()` does not count them (E-P20 (b), reconcile P1: unchanged).
- **Gates:** `value-motion: every value motion changes a visible property for >= 120 ms` (seen red on the mutation
  "equal keyframes"); `value-text: a changed value plays the change motion` (a fake `animate`; seen red on the mutation
  "the action skips `playValue`").

The restart runs at a world replacement of the chapter (`restore`, `reset`; round 8: not `chapterChanged`, whose next
chapter's first body reconciles instead, r7 m3), where the puzzle session is already dropped (`dropPuzzle`,
`yields.ts:497-509`), after any successful values body (reconcile), at `openPuzzle` when the store says spent and the
world plays the puzzle with no failure of its own (outcome null, or a linear re-entry after `solved` / `abandoned`,
round 8, r7 W1), and after a 409 inside an open session. `openPuzzle` for a per-player puzzle
opens its frame at once; while `values.ready(p)` is pending the frame is `busy` in `line: 'checking'`, the same
pending state and motion as a Try in flight (`yields.ts:693`), so a lock tap on a slow network never waits
motionless (W6). **Reconcile P1 (E-P20 (a), E-P21 (a), E-P22 (c), (e)):** the open writes `busy: true, line:
'checking'` into the frame literal before `appear(o)` runs and emits **no `puzzle:checking` of its own**; `appear(o)`
emits `panel-open`, then `puzzle:checking` for a frame that shows `busy`, at the write that shows the frame (the frame
write when the host chunk is in, else the chunk write, whose order is `waited`, `panel-open`, `checking`, `opened`),
so the wait has one cue on either path and breathes only on a shown frame; the frame's load hold is engine's
(`holdLoad`, opened at the frame write; GM6c2 adds none); `checking`'s breath loops until a `CHECKING_ENDS` key of the
same puzzle, which every end below emits (the player cancels the breath in the step that starts the end key's
motion); every frame cue GM6c2 emits passes yields' shown-frame test (`open === o && !o.hidden && o.appeared &&
puzzle.frame?.id === o.id`), so a cue of a frame not yet shown is dropped and the frame appears in its current state
("values land before the host chunk", §9 GM6c2); Try is disabled while busy, and a hint fetch meanwhile is covered by W3's
run check. **The wait ends with motion too (round 6, r5 W2):** values ready -> `puzzle:ready`; values failed or a
restart failed -> `line: 'idle'` with `puzzle:ready` as well (round 7, r6 m4: the frame shows nothing of the code, a
Try is answered, and the Retry prompt with the masked spans tells the failure); a new run -> `puzzle:renewed`
(§5.5 `syncValues`). Stale notes the player wrote are the owner's accepted cost (RULINGS 123).

### 5.4 R7: the values fetch fails

| Cause | State | Player sees | Recovery |
|---|---|---|---|
| **the chapter's first fetch** (`load`): network, timeout, 5xx, decode error | every per-player puzzle of the chapter `loading` -> `failed` | the mask with its shimmer on every per-player span; the `values_failed` prompt with Retry, sliding in and out with GM6t's toast motion (W6); an open frame waiting on the values ends its wait `line: 'idle'` with `puzzle:ready`, Try enabled (round 7, r6 m4: not the `offline` line, "Offline: the answer cannot be checked now", `en.ts:134`, which is false here: the attempt route may well be up, and a Try with no known run is answered by the 409 that brings the code, round 8) | Retry (`retry()`) re-runs the fetch; `activated` and the next `restore` retry too; a Try fetches the code through its 409 (round 8, r7 W2); values that land play the value motion on every span, `puzzle:ready` in an open frame whose attempts line changes (`renewed` when the 409 of a Try brought them), and the prompt leaves |
| 401 | http.ts's single re-auth runs first; still 401 -> as the row above | as above | as above |
| 403 / 404 | cannot follow a loaded chapter; logged; as the first row | as above | as above |
| **a later fetch fails** (`activated`, Retry, the retry at a `restore`, a status's `stale`; round 7, r6 W1) | every `ready` entry unchanged; `loading` / `superseded` entries that awaited **this** request (its token, round 8, r7 m5) -> `failed`; an entry awaiting a newer request unchanged; `failed` stays; `restarting` left to its own request | **nothing changes for a code already shown:** no mask, no prompt, no frame change, no cue; a superseded code stays masked and the prompt shows (a `failing` edge) | the next fetch or Retry |
| a restart fails | that puzzle `restarting` -> `failed` (`cause: 'restart'`, `last`: the spent run) | the mask on its spans (already masked while restarting); the prompt; an open frame waiting on the restart ends its wait `idle` with `puzzle:ready`, Try enabled (round 7, r6 m4) | Retry, or the next successful body naming that spent run (a refresh, the 409 of a Try that carried that run), re-posts with the same `from` (idempotent); a re-post by an automatic body keeps the prompt up until its 200 (round 8, r7 m4); the new run lands with `puzzle:renewed`. If the world stops owing the restart meanwhile (the linear re-entry ended, a world replacement), Retry drops it and the entry shows `ready(last)` (r7 W1) |
| **the store holds no generation of the chapter on screen** (round 9, r8 W1, RULINGS 135 (a): left at a paywall and resumed into the same chapter, which `sync` at that `restore` now loads; round 10, r9 W1: a language switch is not this row, since the key is the `ChapterId` and the switch keeps it; no other path on main reaches it, by the audit in §5.2 "The key is the `ChapterId`"; a later path that does shows the mask with its Retry, because `render` schedules `syncPrompt`, and the store-level guard proves every action then resolves it) | at the `restore`: a new generation, every per-player puzzle `loading` (the first fetch), as `chapterEntered`; defensively, a puzzle met while unheld is `failed` (`cause: 'unheld'`) | the first fetch's mask with its shimmer; then as the first row (digits, or the prompt with Retry); an unheld puzzle: the mask, the prompt, an open frame `idle` + `puzzle:ready` with Try enabled, never a wait | the `restore`'s own load; for an unheld puzzle Retry, a Try (its runless 409 is merged after the load starts), `activated`, a status: each loads the chapter |

Try stays enabled while the values are `failed`, and **no Try is ever judged blind (round 8, r7 W2; replaces round
7's "a blind answer (no `run`) is compared against the live run")**: the attempt carries the newest run the store
knows, `best.run`, in every entry state. A run the server moved past (a status's newer run, a spent run whose
restart is in flight or failed, a restart whose 200 was lost) is a 409 with the current `PlayerValue`, which `learn`
merges; reconcile restarts a spent run the world owes a restart (re-posting a restart that failed, with `fail`
cleared: the player's tap), so the spans unmask with the new run's value, and on a live run the 409 body unmasks them
at once. A store that never received a body sends no run, and the server answers that with the same 409 (§3.5 step
4), so the Try loads the code: the frame plays `checking`, then `renewed` (its first run), the prompt leaves, and the
player enters the code they now see. A Try therefore never ends a run, nor counts a guess, against a value this device
did not display (§2's target, literally). e2e (GM6c4): `values: a failing values route masks the code and Retry shows it` (Playwright
`page.route('**/api/chapters/ch1/values', r => r.abort())`, open the diary, expect `····`, unroute, Retry, read four
digits, enter them on the drawer, expect it open).

### 5.5 Puzzle session changes (`puzzles/session.ts`) and `openPuzzle`

- Deps gain `value: ValuePort | null` (`{ run(): number | null; answered(sent: number, r): void; learn(v):
  void; stale(valueRun: number): void; ready(): Promise<void> }`; round 7: `answered` names the run it sent, `stale`
  the run the status named), null for a static puzzle. **`run()` is the store's `run(p)`: the newest run it knows, in
  every entry state (round 8, r7 W2; round 7 returned null unless the entry was `ready`, so a Try went out blind
  exactly in `superseded`, `restarting` and `failed`, where the store knew its code was dead); null only before any
  body.**
- `attempt()` sends `run()` whenever it is non-null; with none the server answers 409 (§3.5 step 4), so every
  per-player answer the server compares names the run the client last saw. `#settle` for a per-player puzzle: a 200
  with `spent: true` ends `failed`; `attemptsLeft` comes from the response; no local count ends a per-player run.
  `{correct: false, solved: true}` keeps today's rule for static puzzles only. A static session (no port) that meets a
  409 `value_changed` (a tab whose world predates a static -> per-player content update) returns `PuzzleError {
  kind: 'value-changed' }` with nothing to learn; yields' pass has no values patch and ends the check `idle` +
  `puzzle:ready`; the tab's next chapter load brings the per-player world (§7).
- 409 `value_changed` -> `learn(value)`, then `PuzzleError { kind: 'value-changed' }`, nothing counted. Yields'
  `value-changed` case is a pass (`settle`, below), by the entry after `learn`: `ready(v)` with `v.run !== shownRun`
  (a frame that showed no run included: the 409 of a runless Try, round 8) plays `renewed` at once; `restarting` /
  `loading` / `superseded` (a spent run the world owes a restart) keep the frame `checking` (`waiting` set) while the
  restart runs, and `syncValues` ends that wait with `renewed` (the new run) or `ready` (the restart failed) (round 7;
  round 6 wrote "the frame line stays `idle`", which dropped the Try-pending motion during the restart); `failed` ends
  it `idle` + `ready`. The frame stays open, its attempts left come from the new run, and the toast
  `puzzle_value_changed` shows when a `ready` entry brings digits that differ from **the last digits shown for p**,
  across masks (round 9, r8 m1; round 8 read "replaced by other digits", which the restart's own mask, `V -> ···· ->
  V'`, made false in the very case it was written for): yields keeps `Open.seenDigits`, started at open from
  `values.lastShown(p)` and moved by every `ready(v)` row, and compares with it, never with the previous render. A
  first value after no digits at all (the runless Try's 409, a first fetch) is not a change of code and shows none,
  nor does a restart that keeps the value (a solved run's, §3.6). No new `PuzzleLine`, so `ui/puzzle-view.svelte.ts` and `PuzzleHost.svelte` stay
  untouched.
- **A full-commit device (round 5, E-P12).** When the open puzzle's type has `commit: 'full'` (engine.md's `ritual`),
  a `value-changed` reply also runs engine.md's `restartWork(open)` (§7.5 item 3, [engine §7.5 Devices: lifecycle, attempts, working state](../engine/07-puzzle-types.md#75-devices-lifecycle-attempts-working-state-m6-m7-w2-round-3-w1-w2-m9-m10-gm8i-module-gm8h-host) as read in round 6, m2;
  its full-commit rule "every reply that is not correct and not a 429 restarts the presses", [engine §7.5 Devices: lifecycle, attempts, working state](../engine/07-puzzle-types.md#75-devices-lifecycle-attempts-working-state-m6-m7-w2-round-3-w1-w2-m9-m10-gm8i-module-gm8h-host)), so the full press sequence never
  stays on the device with nothing to post it; the parts go dark with `fact:work:removed` cues (motion). The later of
  GM6c2 / GM8h wires the branch, with `yields: a re-drawn value restarts a full sequence` (GM6c2 commit 6 when GM8h is
  merged at its cut; else GM8h's commit (7), [engine GM8h `mech-device-host`](../engine/12e-lanes-gm7-gm9.md#gm8h-mech-device-host-new), R-E24 accepted). No per-player full-commit puzzle
  can exist before both lanes: `ritual` lands in GM8b, after GM8h (engine.md GM8b [engine GM8b `mech-sequence`](../engine/12e-lanes-gm7-gm9.md#gm8b-mech-sequence), its After row [engine GM8b `mech-sequence`](../engine/12e-lanes-gm7-gm9.md#gm8b-mech-sequence)), and
  `world/per-player-runtime` refuses every mark until GM6c4.
- **The run change has its own motion (W6).** Whenever the store's run of the open session's puzzle changes (a 409
  then a restart, an `activated` refresh, a Retry, a forced re-draw seen at any of them), yields emits
  `{ kind: 'puzzle', puzzle, name: 'renewed', index: null }` once per new run (R-E14: a member of engine.md's
  `PUZZLE_CUES`, accepted in GM3m with its `CUE_MOTIONS` entry, engine.md §0 row 105, [engine §8.1 The cue union and the bus](../engine/08a-cue-union-and-bus.md#81-the-cue-union-and-the-bus); r3 m5; overlay as
  engine.md adopted it: frame `breathe` + `MotionSpec.with` `roll` on the attempts line, target `attempts`
  (`[data-cue-attempts]`, marked by GM3p / GM8h; round 8, E-P17 (e): no longer `[data-cue-index]`, a control
  attribute); reduced: an opacity pulse; scene: MR1 owes). The `puzzle_value_changed` toast enters with GM6t's motion. A spent-run Try thus
  plays `checking` (breathe), then `renewed`, never `wrong` or `failed`. A `value-changed` reply has its own case in
  `attempted`'s exhaustive switch (`yields.ts:654-671`), never the `network` / `not-entitled` branch that sets
  `offline` (`:658-661`), so it plays `renewed` and never `puzzle:offline` (E-P15 (c); test `yields: a value_changed
  reply plays renewed, never offline`).
- **`syncValues(o)`: the one writer of every frame change the store causes, each with a cue (round 6, r5 W2).** The
  frame's values wait used to end in a cut: the status text vanished, the attempts line popped in and Try lit up
  (`PuzzleHost.svelte:81-84`, `:201-203`: no motion of their own). Yields keeps on `Open` the run the frame last showed
  (`shownRun: number | null`) and one flag, `waiting` (the frame opened, or re-entered, the values wait). **The base of
  every row is what the frame shows (round 7, r6 m1):** `shownRun` and `frame.attemptsLeft`, never the entry's previous
  value, so an attempt whose own answer already wrote its count to the frame (`yields.ts:645`) finds nothing to
  change. One pure function decides, one writes:
  - `valuesPatch(o, frame): { patch: Partial<PuzzleFrameView>; cue: 'renewed' | 'ready' | null; recoded: boolean }`,
    by the first matching row of the table below; `recoded` (round 9, r8 m1) is true for a `ready(v)` row whose
    `v.value` differs from `o.seenDigits` when that is non-null, and the writer that applies the patch (`syncValues`
    or `settle`) then shows the `puzzle_value_changed` toast once (GM6t's motion);
  - `syncValues(o)` writes `patch` and emits `cue` on a store change whose `entries` list `o.local` and at the end of
    `openPuzzle`'s wait, **except while `o.trying` or a 429 countdown runs (`frame.retryAfter !== null`)** (round 7,
    r6 m3): then the pass that ends that state runs it. **Its cue passes yields' shown-frame test (reconcile P1,
    E-P20 (a)):** written to a frame not yet shown (`!o.appeared`, the host chunk still loading), the patch lands and
    the cue is dropped, so the frame appears in its current state at the chunk write; `settle`'s cues and the
    `hint-renewing` cues through `setLadder` follow the same test. **`Open.trying` (round 8, r7 m1; round 7 wrote "while the
    session is busy (an attempt in flight)", a predicate the tree has not):** set by `post(o)`, the one attempt
    starter, which **GM3p lands** (round 9, E-P18 (b); R-E28 accepted with that change, [engine §14.2 Answers to per-player.md §12](../engine/14-interface-requests.md#142-answers-to-per-playermd-12), its contract
    [engine §7.5 Devices: lifecycle, attempts, working state](../engine/07-puzzle-types.md#75-devices-lifecycle-attempts-working-state-m6-m7-w2-round-3-w1-w2-m9-m10-gm8i-module-gm8h-host) as read: refuses while the frame is busy or a countdown runs, else `busy: true`, `line: 'checking'`,
    `puzzle:checking`, `session.attempt().then((r) => attempted(o, r))`); **GM6c2 adds `o.trying = true` as its first
    write**; its callers are `ontry` (main's only site, `yields.ts:687-695`), GM7r's `postReach` and the zero's re-post
    `ready(o)`, GM8h's full-commit post and `oncommit`; and cleared by `attempted` as the first step of that attempt's
    pass. Neither natural reading works: the session's own in-flight marker is cleared before `#settle`
    (`session.ts:221-226`), so `answered` / `learn` would fire `syncValues` mid-settle and play `ready` before `wrong`;
    `frame.busy` is also true during the 409-restart wait (`waiting`), so the store change that ends the wait would be
    skipped (round 9, E-P18 (a): engine.md's chunk Retry is now its own field `retrying`, no longer `busy`, so round
    8's second example lapsed; the restart wait alone decides it, M-P8e unchanged). A `busy` reply clears nothing and runs no pass (E-P17 (b)): another attempt
    is in flight and its pass ends `trying`;
  - **`settle(o, writerPatch, writerCue)`, the one-cue pass (round 7, r6 m3):** `attempted`'s branches and the
    countdown's zero (`yields.ts:619-630`, `:632-671`) write `{ ...valuesPatch.patch, ...writerPatch }` in one
    `setFrame` (the writer's `line` wins) and emit, for that return to input: an outcome (`wrong`) its own cue, then
    `renewed` only when the values patch carries a run change (two state changes: the verdict, then the run; a same-run
    count change rides the outcome's write, as the attempt's own count does today); a no-outcome reply (`closed` /
    `invalid`, GM3p's `line: 'idle'`; round 8, E-P17 (b): `busy` is not one, it runs no pass) or the countdown's zero
    with nothing to post: **one** cue, `renewed` when the values patch carries a run change, else `ready`;
    `value-changed`: `renewed` for a `ready` entry of another run than `shownRun` (null included), `waiting := true`
    with the frame left `checking` while the restart the 409 caused runs, or `idle` + `ready` for a `failed` entry; `rate-limited` starts the
    countdown, during which `syncValues` never writes (the status line keeps its seconds and Try stays disabled until
    the zero; the clue spans still move at once with their own motion). So every return of the frame to input has
    exactly one cue (engine.md [engine §8.1 The cue union and the bus](../engine/08a-cue-union-and-bus.md#81-the-cue-union-and-the-bus)), `renewed` taking `ready`'s place when the run changed (R-E27 (d)). A zero that
    re-posts (engine.md GM7r's `ready(o)`) starts an attempt (`checking`), whose outcome is the pass; of GM6c2 / GM7r
    the lane that lands second wires the non-posting zero to `settle` (R-E27 (d)).

| Entry of `o.local` | Against the frame | Patch | Cue |
|---|---|---|---|
| `ready(v)` | `shownRun !== null` and `v.run !== shownRun` | `busy: false`, `line: 'idle'`, `attemptsLeft: v.attemptsLeft` | `puzzle:renewed` (R-E14) |
| `ready(v)` | `waiting` (none shown, or the same run) | as above | **`puzzle:ready`** (R-E26) |
| `ready(v)` | not `waiting`, none shown or the same run, `v.attemptsLeft !== frame.attemptsLeft` (another device's wrong answer seen at a refresh; the count after a failed wait) | `attemptsLeft: v.attemptsLeft` | `puzzle:ready` |
| `ready(v)` | otherwise | none (`shownRun := v.run`) | none |
| `failed` (a values load or a restart failed) | `waiting` | `busy: false`, `line: 'idle'` (`attemptsLeft` kept: the last known, null when none) | `puzzle:ready` (round 7, r6 m4: the wait ended and a Try is answered, by the run it carries or by the 409 that loads the code, round 8; the prompt and the masked spans tell the failure) |
| `failed` | not `waiting` | none (the frame shows nothing of the code; a failed refresh never reaches here for a `ready` entry, §5.2) | none |
| `loading` / `restarting` / `superseded` | `waiting` | none (still `checking`) | none: the wait's own `checking` is its motion |
| `loading` / `restarting` / `superseded` | not `waiting` | none (the spans mask and shimmer; the frame keeps its last state) | none |

  `shownRun := v.run` and (round 9) `seenDigits := v.value` after every `ready(v)` row; `waiting := false` after every
  row that ends the wait. At open, `shownRun` = the entry's run when it has one (a spent entry waiting for its restart
  included, so the restart's new run plays `renewed`, as round 3's (b) said), else null; `seenDigits` =
  `values.lastShown(p)` (the last digits a `ready` entry brought for p in this chapter this session, across masks and,
  round 10 (r9 O1), across generations of the chapter: a code another device re-drew while the store was dropped at a
  paywall, or before a replay's reload, still tells the change when it lands), so a frame that
  opens over a masked restart of a code the player read in the diary still tells the change. Round 6's `down` flag is gone: no values row writes
  `offline` any more. Why one decider and one pass: five call sites (the wait, a store change, an attempt outcome, a
  countdown's zero, a Retry) write the frame; one table makes "every frame change has its cue" a property of one
  function, and one pass makes "one cue per return to input" a property of one call. Bytes (round 7): `valuesPatch` /
  `settle` ~+8 lines net in `yields.ts` beside the store's ~+20 (merge, `superseded`, `endedHere`, the refresh rule,
  `failing`); with round 6's `syncValues` ~14: ARITHMETIC +0.06 + 0.12 KB br, inside GM6c2's figure (§10). Round 8:
  request tokens, `owed` / `fail` and the `playing` dep in the store (~+10 net), `post(o)` / `trying`, `chapterLeft`
  and the reconcile after `ended` in yields (~+5): ~15 lines, ARITHMETIC 15 x 4.3 B = 64.5 B, **+0.06 KB br**. Round 9:
  the store's `chapter()` dep and `HeldChapter`, `sync`, `held`, `failing`, the unheld answers, `lastDigits` /
  `lastShown`, the `awaiting` clear and the null-`best` fill (~+15), yields' `left` / `install` / `sync` calls,
  `syncPrompt` and `seenDigits` / `recoded` (~+5), less `post(o)`'s body, which GM3p lands (E-P18 (b), ~-4): ~16 lines
  net, ARITHMETIC 16 x 4.3 B = 68.8 B, **+0.07 KB br**. Round 10 (r9 W1, O1): the id comparison replaces the identity
  one (0), the per-puzzle unheld test in `sync` / `entry` / `failing` (~+2), `render`'s prompt scheduling in yields
  (~+3), `ShownDigits` replacing `Known.lastDigits` (~0): ~5 lines, ARITHMETIC 5 x 4.3 B = 21.5 B, **+0.02 KB br**.
- **Tier texts carry their run (W3, m3).** The session tags each tier text with the `valueRun` of the status that
  brought it, and a hint-use text with `null` (run unknown: `HintPort.use` returns `{ text, balance }`,
  `session.ts:62`). New session method `valueChanged(run: number): readonly number[]` deletes every text whose tag is not `run`
  (`#texts`, `session.ts:184`; `#usedHere` keeps the tier unlocked, so `ladder()` reports it `unlocked` with
  `text: null`) and returns the dropped tiers, for which yields emits `puzzle:hint-renewing` (R-E20, r3 m7) when the
  ladder is open. **Every ladder write here goes through engine.md's one writer `setLadder(o, next, cues)` (GM3p;
  round 8, E-P17 (a)):** the drop writes the ladder with the dropped tiers `unlocked`, `text: null`, `busy: true` and
  the cues `puzzle:hint-renewing` once per dropped tier (`index` = tier, target `tier`, `[data-cue-tier]`), so
  `setLadder`'s `busy` edge plays the ladder's wait hold (`ui-state:waiting`, `panel: 'hints'`); the re-fetch's
  answer writes through it with `puzzle:hint-shown` per tier whose text came back and the "status answered" row's
  `puzzle:ladder` (`ui-state:waited` from the edge), its failure with the "status failed" row's `puzzle:hint-failed`;
  GM3p's `yields: the ladder has one writer` stays green by name in GM6c2. A `useHint` answer that arrives after a run change it did not see is dropped the same way (the session
  compares `run()` at the request's start and end). A status whose `valueRun` differs from `run()` calls
  `stale(valueRun)` (round 7: the store masks p only when `valueRun` is the newer run).
- `yields.openPuzzle` (`yields.ts:563-616`) for a per-player puzzle: **(a)** world outcome `failed` ->
  `ended(local, 'failed', ...)` without a session and without waiting (the D18 replacement; an authored retry loop
  ends failed again, the server run untouched); else the frame opens as today, and **while `values.ready(p)` is
  pending** it is `busy: true, line: 'checking'` with `puzzle:checking` (the Try-pending state and motion, W6;
  reconcile P1, E-P20 (a): `busy` / `line` are written in the frame literal and the cue is `appear(o)`'s, emitted
  after `panel-open` when the frame shows, never by the open itself); then
  **(b)** the store's best run spent and the world playing p with no failure of its own (outcome null, or, round 8,
  r7 W1, `solved` / `abandoned` on a linear re-entry: `open` is already `o`, so `playing()` is p) -> `values.reconcile()`
  (a fresh world's restart was owed at its body already; a re-entry's is owed here) and the restart is awaited
  (`ready` again, still `checking`), then `renewed`; **(c)** `syncValues(o)` writes the end of the wait by its table (`attemptsLeft` from the
  store entry, null when unknown or uncapped, at `:603`; `busy: false`; `line: 'idle'` with `puzzle:ready` whether
  the values landed or failed; round 6, r5 W2; round 7, r6 m4), then `syncPrompt()` (round 9: a puzzle the store does
  not hold is `failed`, so `ready(p)` has already resolved and the open shows Retry, never a wait). An `activated`
  refresh in flight never makes the open wait (`ready(p)` resolves for a `ready` entry at once, §5.2; r6 W1). If the session ends or another opens
  meanwhile, the late `ready` is dropped (the `open !== o` rule, `yields.ts:589`). Static puzzles keep D18 (`:571-576`)
  and today's open as built.
- **Tests (GM6c2):** `yields: a per-player puzzle whose world failed ends failed without a session`, `yields: a spent
  run in a fresh world restarts before Try opens`, `yields: a runless try on a spent run restarts instead of
  failing` (round 8: renamed from "a blind try ...", the attempt names no run because no body landed), `puzzles: value_changed on a spent run restarts and keeps the frame open`, `values: an activated refresh
  reconciles a spent fresh puzzle`, `yields: a restart while the ladder is open re-reads tier 3` (W3; predicted red on
  the parent: the ladder still holds the run-3 text), `puzzles: a value change drops the tier texts of another run`,
  `yields: a re-read of a dropped tier fetches its text`, `yields: a lock tap while values load opens the frame
  checking` (W6), `yields: a run change in an open frame plays renewed` (W6); round 6 (r5 W2): `yields: values that
  land in an open frame play ready`, `yields: a value_changed reply plays renewed, never offline` (E-P15 (c)); round 7
  (r6 W1, m1, m3, m4; the three round-6 names that asserted `offline` are renamed and re-asserted, one replaced):
  `yields: a values failure ends the frame's wait with ready`, `yields: a failed restart ends the frame's wait with
  ready`, `yields: values that land after a failed wait show the attempts with ready`, `yields: a failed activated
  refresh leaves an idle frame idle`, `yields: a refresh during a try plays only the outcome` (replaces `yields: a store
  change during a try waits for its outcome`), `yields: a refresh after the outcome with a lower count plays ready`,
  `yields: a store change during a countdown waits for its zero`, `yields: a no-outcome reply with a run change plays
  renewed alone`, `yields: values that land after a failure dismiss the Retry prompt`; round 8 (r7 W1, W2, m1-m3,
  E-P17): `yields: a linear re-entry after give-up restarts a spent run before Try opens`, `yields: a try with no
  known run unmasks the code instead of judging it`, `yields: a count seen during a try reaches the frame at its
  no-outcome reply`, `yields: a busy reply runs no values pass`, `yields: a chapter change restarts nothing of the
  chapter left`, `puzzles: a try while superseded sends the last known run`, and GM3p's state gate `yields: every
  visible change of the puzzle view plays a cue` with this file's steps appended; round 9 (r8 W1, m1; E-P18 (a)):
  `yields: a frame over a puzzle the store does not hold shows the failing state with Retry`, `yields: a restart after
  a spent-run Try shows the value-changed toast`, `yields: a values wait over a cached type chunk keeps Try disabled`;
  the store's in GM6c2 commits 1-2. **Reconcile P1 (E-P21 (b), E-P22 (c)):** the four wait tests (`a lock tap while
  values load opens the frame checking`, `values that land in an open frame play ready`, `a values failure ends the
  frame's wait with ready`, `a failed restart ends the frame's wait with ready`) set `puzzle.host` through the store
  before the open and assert the bus filtered to `puzzle:*` keys, except where the fixture defers the type chunk,
  which lists `ui-state:waited`, `panel-open`, `puzzle:checking`, `puzzle:opened` in that order; plus `yields: values
  that land before the host chunk play no frame cue` (E-P20 (a)'s state-gate step, a fresh `PuzzleView`).
  **Reconcile P3:** `yields: dispose dismisses the values prompt and a queued prompt stays down`, `yields: every value
  surface renders through render`.

### 5.6 Principles

| Principle | How |
|---|---|
| 0 | domains only in server content; `decodeWorldPublic` refuses them; values only in the DB and in GameSession memory; the values route of a paid chapter needs its entitlement; paid worlds' templates ride the paid world (served after the entitlement) |
| 1 | draw, compare, spent and re-draw are server decisions; the client's restart claim only asks for a server-guarded action that gives nothing of value; the lock opens only after the server's `correct` (today's path) |
| 2 | no new payment path; unlocks keyed by the stable key, so neither a rename, a rollback nor a re-draw loses an unlock or creates a second debit key (§3.6, §3.8) |
| 7 | ink holds templates; the scene gets rendered strings in a command; neither reads the store |
| 8 | a placeholder line keeps its `#id:` / `id`; ru and en carry the same placeholders (lint); the three new UI strings live in their own locale table `client/src/i18n/values.ts` (`valuesRu`, `valuesEn: Record<ValuesKey, string>`, `vt(lang, key)`; `i18n/meta.ts:1-2`, `:135-142` is the precedent), imported only by `app/values.ts` and `app/yields.ts`, which are engine-chunk modules (`boot.ts:410`), so the strings ship in the engine, never in the entry (r3 W1: round 3's reason "yields is not a lazy chunk" was wrong) |
