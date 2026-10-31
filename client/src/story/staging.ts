// Branded ids and the typed staging commands of docs/STAGING-DSL.md §6 (PROTOTYPE-PLAN.md "TS types").
// Types only, plus the one empty snapshot value; `parseTags` (story/tags.ts) is the only parser of tags into commands.

type Brand<T, B extends string> = T & { readonly __brand: B };
export type ChapterId = Brand<string, 'ChapterId'>;
export type LineId = Brand<string, 'LineId'>;
export type KnotName = Brand<string, 'KnotName'>;
export type SpeakerId = Brand<string, 'SpeakerId'>;
export type BgId = Brand<string, 'BgId'>;
export type CharId = Brand<string, 'CharId'>;
export type ExprId = Brand<string, 'ExprId'>;
export type CgId = Brand<string, 'CgId'>;
export type TrackId = Brand<string, 'TrackId'>;
export type SfxId = Brand<string, 'SfxId'>;
/** 'bg/cafe' | 'char/ally/smile' | 'cg/letter' | 'bgm/calm' | 'sfx/door' | 'prop/<id>' (STAGING-DSL §8). */
export type AssetId = Brand<string, 'AssetId'>;
export type VarName = Brand<string, 'VarName'>;
export type StoryVersion = Brand<string, 'StoryVersion'>;
export type ProductId = Brand<string, 'ProductId'>;
export type OrderId = Brand<string, 'OrderId'>;
export type PuzzleLocalId = Brand<string, 'PuzzleLocalId'>;
export type SectionId = Brand<string, 'SectionId'>;
export type PropId = Brand<string, 'PropId'>;
export type Slot = 'left' | 'center' | 'right';
/** x, y, width, height in integer source px of the 1080×2048 background space. */
export type Rect = readonly [x: number, y: number, w: number, h: number];
export type PropPlacement = { readonly prop: PropId; readonly rect: Rect };

export type StagingCommand =
  | { kind: 'bg'; bg: BgId; t: 'crossfade' | 'fade' | 'cut'; ms: number }
  | { kind: 'scene'; bg: BgId; t: 'fade' | 'cut'; ms: number }
  | { kind: 'show'; char: CharId; expr: ExprId; at: Slot | null; t: 'fade' | 'cut'; ms: number | null }
  | { kind: 'hide'; char: CharId | 'all'; t: 'fade' | 'cut'; ms: number }
  | { kind: 'cg'; cg: CgId | null; t: 'fade' | 'cut'; ms: number }
  | { kind: 'bgm'; track: TrackId | null; fadeMs: number; vol: number }
  | { kind: 'sfx'; sfx: SfxId; vol: number }
  | { kind: 'wait'; ms: number }
  | { kind: 'puzzle'; puzzle: PuzzleLocalId; then: KnotName }
  | { kind: 'explore'; section: SectionId };

/** The commands that stop the story and hand control to the host (STAGING-DSL §6 yield block). */
export type YieldCommand = Extract<StagingCommand, { kind: 'puzzle' | 'explore' }>;

/**
 * The props of the current room (PUZZLES-PLAN X11): built by GameSession from world data, never parsed from a tag,
 * so it is not a `StagingCommand`. A `bg` or `scene` clears them.
 */
export type PropsCommand = { kind: 'props'; props: readonly PropPlacement[] };

export type TagError = {
  tag: string;
  reason: 'syntax' | 'unknown-kind' | 'missing-arg' | 'bad-arg' | 'unknown-asset' | 'bad-id' | 'multiple-id' | 'conflict';
  detail: string;
};
export type ParsedTags = { lineId: LineId | null; commands: StagingCommand[]; errors: TagError[] };

/** Asset lookups `parseTags` needs; `assetIndex` (story/catalog.ts) builds one from the catalog. */
export interface AssetIndex {
  hasBg(id: string): boolean;
  hasExpr(char: string, expr: string): boolean;
  hasChar(id: string): boolean;
  hasCg(id: string): boolean;
  hasTrack(id: string): boolean;
  hasSfx(id: string): boolean;
}

/** "Commands in effect" per slot [R3 §1.3]. */
export type StagingSnapshot = {
  bg: BgId | null;
  cg: CgId | null;
  chars: ReadonlyArray<{ char: CharId; expr: ExprId; at: Slot }>; // z-order = array order
  bgm: { track: TrackId; vol: number } | null;
  props: readonly PropPlacement[];
};

// Frozen: every "new game" starts from this one shared value, so a write through it would leak into the next.
export const EMPTY_SNAPSHOT: StagingSnapshot = Object.freeze({
  bg: null,
  cg: null,
  chars: Object.freeze([]),
  bgm: null,
  props: Object.freeze([]),
});
