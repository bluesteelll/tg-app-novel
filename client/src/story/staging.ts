// Branded ids and the typed staging commands of docs/STAGING-DSL.md §6 (PROTOTYPE-PLAN.md "TS types").
// Types only, plus the one empty snapshot value; `parseTags` (story/tags.ts) is the only producer of commands.

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
/** 'bg/cafe' | 'char/ally/smile' | 'cg/letter' | 'bgm/calm' | 'sfx/door' (STAGING-DSL §8). */
export type AssetId = Brand<string, 'AssetId'>;
export type VarName = Brand<string, 'VarName'>;
export type StoryVersion = Brand<string, 'StoryVersion'>;
export type ProductId = Brand<string, 'ProductId'>;
export type OrderId = Brand<string, 'OrderId'>;
export type Slot = 'left' | 'center' | 'right';

export type StagingCommand =
  | { kind: 'bg'; bg: BgId; t: 'crossfade' | 'fade' | 'cut'; ms: number }
  | { kind: 'scene'; bg: BgId; t: 'fade' | 'cut'; ms: number }
  | { kind: 'show'; char: CharId; expr: ExprId; at: Slot | null; t: 'fade' | 'cut'; ms: number | null }
  | { kind: 'hide'; char: CharId | 'all'; t: 'fade' | 'cut'; ms: number }
  | { kind: 'cg'; cg: CgId | null; t: 'fade' | 'cut'; ms: number }
  | { kind: 'bgm'; track: TrackId | null; fadeMs: number; vol: number }
  | { kind: 'sfx'; sfx: SfxId; vol: number }
  | { kind: 'wait'; ms: number };

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
};

// Frozen: every "new game" starts from this one shared value, so a write through it would leak into the next.
export const EMPTY_SNAPSHOT: StagingSnapshot = Object.freeze({ bg: null, cg: null, chars: Object.freeze([]), bgm: null });
