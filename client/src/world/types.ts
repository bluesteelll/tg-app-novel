// The world shapes of docs/PUZZLES-PLAN.md "World data": the source `story/<ch>/world.json` the narrative-designer
// writes, and the public world the client loads. Types plus the one glyph list; world/decode.ts is the only decoder.
// Pure (X4, `arch: pure world modules`): the runtime and the story tool import it alike.
import type { CodeParams } from '../puzzles/rules/code.ts';
import type { PuzzleType } from '../puzzles/rules/index.ts';
import type { OrderParams } from '../puzzles/rules/order.ts';
import type {
  BgId,
  CgId,
  ChapterId,
  KnotName,
  LineId,
  PropId,
  PuzzleLocalId,
  Rect,
  SectionId,
  SfxId,
  TrackId,
} from '../story/staging.ts';

// The same structural brand as story/staging.ts, which keeps its own private.
type Brand<T, B extends string> = T & { readonly __brand: B };
/** `[a-z][a-z0-9_]*`, unique across every section of the chapter (`world/duplicate-id`). */
export type RoomId = Brand<string, 'RoomId'>;
/** `[a-z][a-z0-9_]*`, unique within its room. */
export type HotspotId = Brand<string, 'HotspotId'>;
export type ItemId = Brand<string, 'ItemId'>;
export type DocId = Brand<string, 'DocId'>;
/** `<room>.<hotspot>`: chapter-unique because rooms are. */
export type HotspotKey = Brand<string, 'HotspotKey'>;

/** X16: the closed set of inline-SVG inventory icons. */
export const GLYPHS = ['sun', 'moon', 'star', 'key', 'letter', 'book', 'gear', 'coin'] as const;
export type Glyph = (typeof GLYPHS)[number];

/** A player-facing world line: its STAGING-DSL §4 line ID and the Russian text (en comes from the locale table). */
export type WorldText = { readonly id: LineId; readonly ru: string };

/** A trigger's effect: exactly one key. */
export type Effect = { readonly give: ItemId } | { readonly unlock: HotspotKey } | { readonly story: KnotName };
/** What a `take` hotspot gives: exactly one key. */
export type Gift = { readonly item: ItemId } | { readonly doc: DocId };
/** Where an `exit` leads: a room of its own section, or out of the section into a story knot. */
export type ExitTarget = { readonly room: RoomId } | { readonly story: KnotName };

export type LockSlot = { readonly accepts: ItemId };
/** Slots fill in any order and persist; then `puzzle` (if any) opens; solved → open, failed → `onFail`. */
export type Lock = {
  readonly slots: readonly LockSlot[];
  readonly puzzle: PuzzleLocalId | null;
  readonly locked: WorldText;
  /** Runs once when the key first enters `open`, whatever the cause. */
  readonly onOpen: readonly Effect[];
  readonly onFail: readonly Effect[];
};

type HotspotBase = { readonly id: HotspotId; readonly rect: Rect; readonly label: WorldText };
export type LookHotspot = HotspotBase & { readonly kind: 'look'; readonly look: WorldText; readonly then: readonly Effect[] };
export type TakeHotspot = HotspotBase & {
  readonly kind: 'take';
  readonly gives: Gift;
  readonly prop: PropId | null;
  readonly then: readonly Effect[];
};
export type ExitHotspot = HotspotBase & {
  readonly kind: 'exit';
  readonly to: ExitTarget;
  readonly lock: Lock | null;
  readonly sfx: SfxId | null;
};
export type ObjectHotspot = HotspotBase & {
  readonly kind: 'object';
  readonly lock: Lock | null;
  readonly then: readonly Effect[];
  readonly look: WorldText | null;
  readonly prop: PropId | null;
};
export type Hotspot = LookHotspot | TakeHotspot | ExitHotspot | ObjectHotspot;

export type Room = {
  readonly bg: BgId;
  readonly title: WorldText;
  readonly onEnter: readonly Effect[];
  readonly hotspots: readonly Hotspot[];
};
export type Section = {
  readonly start: RoomId;
  readonly bgm: TrackId | null;
  readonly rooms: Readonly<Record<RoomId, Room>>;
};
export type Item = { readonly name: WorldText; readonly desc: WorldText; readonly glyph: Glyph };
export type Doc = { readonly title: WorldText; readonly body: readonly WorldText[] };

type PuzzleParams = { readonly code: CodeParams; readonly order: OrderParams };
type PuzzleCommon = {
  readonly title: WorldText;
  readonly prompt: WorldText;
  readonly closeup: CgId | null;
  /** 1..9; at the limit the outcome is `failed` (X8). */
  readonly maxAttempts: number | null;
  readonly giveUp: boolean;
};
/** One puzzle instance, discriminated by `type`; `params` is what `PUZZLE_RULES[type].decodeParams` returns. */
export type PuzzleBody = {
  [T in PuzzleType]: { readonly type: T; readonly params: PuzzleParams[T] } & PuzzleCommon;
}[PuzzleType];
/** The source puzzle: `solution` and `hints` are server-only (X7). */
export type SourcePuzzle = PuzzleBody & { readonly solution: readonly number[]; readonly hints: readonly WorldText[] };
export type HintTiers = 0 | 1 | 2 | 3;
/** The public puzzle: the hint count only. */
export type PublicPuzzle = PuzzleBody & { readonly hintTiers: HintTiers };

type World<P> = {
  readonly format: 1;
  readonly items: Readonly<Record<ItemId, Item>>;
  readonly docs: Readonly<Record<DocId, Doc>>;
  readonly puzzles: Readonly<Record<PuzzleLocalId, P>>;
  readonly sections: Readonly<Record<SectionId, Section>>;
};
export type WorldSource = World<SourcePuzzle>;
/** The public world as `toPublic` returns it; the story tool (LW3) stamps `version` on emit. */
export type WorldPublicBody = World<PublicPuzzle>;
/** `version` = `worldVersion(body)` (X9 "World version"); a save records the version it was written against. */
export type WorldPublic = WorldPublicBody & { readonly version: string };

/** `server/content/puzzles/<ch>.json` (PUZZLES-PLAN "Server formats"): what the server checks answers against. */
export type ServerPuzzle = {
  readonly type: PuzzleType;
  readonly answerLen: number;
  readonly answerMax: number;
  readonly solution: readonly number[];
  readonly title: { readonly ru: string; readonly en: string };
  readonly hints: ReadonlyArray<{ readonly ru: string; readonly en: string }>;
};
export type ServerPuzzleContent = {
  readonly format: 1;
  readonly chapterId: ChapterId;
  readonly puzzles: Readonly<Record<PuzzleLocalId, ServerPuzzle>>;
};
