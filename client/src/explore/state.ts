// The exploration state (docs/PUZZLES-PLAN.md "World state and the reducer contract"): what a save body carries as
// `world`. Written during play only by mechanics/rules/core.ts's `reduce` while a section is current and by
// explore/reduce.ts's `runReduce` for a linear puzzle's run, and at a section's entry by admitSection or admitEvent
// (X9). Pure (X4).
import type { FlagId } from '../mechanics/contract.ts';
import type { KnotName, PuzzleLocalId, SectionId } from '../story/staging.ts';
import type { DocId, HotspotKey, ItemId, RoomId } from '../world/types.ts';

export type PuzzleOutcome = 'solved' | 'failed' | 'abandoned';
/** One puzzle's run: the dials and the arrangement are not saved, attempts and hints opened are (X9). */
export type PuzzleRun = { readonly outcome: PuzzleOutcome | null; readonly attempts: number; readonly hintsOpened: number };

/**
 * The lists are sets (the reducer never adds an element twice; `sectionKey` sorts them), kept in the order play
 * added them; `pendingStory` is the one ordered queue.
 */
export type WorldState = {
  readonly format: 2;
  readonly section: SectionId | null;
  readonly room: RoomId | null;
  readonly lastRoom: Readonly<Record<SectionId, RoomId>>;
  readonly visited: readonly RoomId[];
  readonly held: readonly ItemId[];
  readonly used: readonly ItemId[];
  readonly docs: readonly DocId[];
  readonly taken: readonly HotspotKey[];
  readonly examined: readonly HotspotKey[];
  /** A lock's filled slots by index; an absent entry is all-empty. */
  readonly slots: Readonly<Record<HotspotKey, ReadonlyArray<ItemId | null>>>;
  readonly open: readonly HotspotKey[];
  /** 'enter:<room>' | 'then:<key>' | 'open:<key>' | 'fail:<key>': every trigger fires at most once. */
  readonly fired: readonly string[];
  /** Head = the event knot running now. */
  readonly pendingStory: readonly KnotName[];
  readonly puzzles: Readonly<Record<PuzzleLocalId, PuzzleRun>>;
  /** X9 step 5: sections not yet re-proved after a version change; read and written by no reducer rule. */
  readonly unproved: readonly SectionId[];
  /** The flags set (engine plan §5.2, module `flags`); no rule sets one yet. */
  readonly flags: readonly FlagId[];
};

// Frozen: every new chapter starts from this one shared value, so a write through it would leak into the next.
export const EMPTY_WORLD_STATE: WorldState = Object.freeze({
  format: 2,
  section: null,
  room: null,
  lastRoom: Object.freeze({}),
  visited: Object.freeze([]),
  held: Object.freeze([]),
  used: Object.freeze([]),
  docs: Object.freeze([]),
  taken: Object.freeze([]),
  examined: Object.freeze([]),
  slots: Object.freeze({}),
  open: Object.freeze([]),
  fired: Object.freeze([]),
  pendingStory: Object.freeze([]),
  puzzles: Object.freeze({}),
  unproved: Object.freeze([]),
  flags: Object.freeze([]),
});
