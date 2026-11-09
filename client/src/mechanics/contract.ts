// The module contract of the mechanics engine (engine plan §3.1, §3.2): the kernel types a mechanic is written against,
// its two halves (`MechanicData`, the engine's, which decodes and normalizes; `MechanicRules`, the explore-ui chunk's,
// which acts) and the types derived from the two registries (mechanics/data/index.ts, mechanics/rules/index.ts).
// Types and constants only: it value-imports nothing, and its registry references are `import type`, so no chunk pays
// for what it declares beyond the constants a module reads. Pure.
import type { Field } from '../api/decode.ts';
import type { ControlDecl } from '../cues/types.ts';
import type { ExploreEffect } from '../explore/reduce.ts';
import type { PuzzleRun, WorldState } from '../explore/state.ts';
import type { Result } from '../story/catalog.ts';
import type { PropId, PuzzleLocalId, Rect, SectionId } from '../story/staging.ts';
import type { WorldIssue } from '../world/decode.ts';
import type { Effect, HotspotKey, ItemId, RoomId, WorldPublicBody, WorldText } from '../world/types.ts';
import type { MECHANIC_DATA } from './data/index.ts';
import type { MECHANIC_RULES } from './rules/index.ts';

// ---------------------------------------------------------------------------------------------------------------
// §3.1 Kernel types

// The same structural brand as world/types.ts, which keeps its own private.
type Brand<T, B extends string> = T & { readonly __brand: B };
export type MechanicId = Brand<string, 'MechanicId'>;
export type FlagId = Brand<string, 'FlagId'>;
/** 'default' or a declared state. */
export type StateName = Brand<string, 'StateName'>;
/** `<room>.<hotspot>` or `<room>~<decor>`. */
export type AnchorKey = Brand<string, 'AnchorKey'>;
/** A `fired` entry: `enter:<room>` | `then:<key>` | `open:<key>` | `fail:<key>` | a module's prefix. */
export type TriggerKey = Brand<string, 'TriggerKey'>;
/** Every issue reported: the kernel's own, so a module's `line-id` issue maps to `id/missing` / `id/format` in the story
 *  tool's `decodeWorldFile` exactly as a kernel text's does. */
export type Issue = WorldIssue;

/** A fact a rule can read or write; `id` is the fact's id (an item, a hotspot key, a room, a puzzle, a trigger). */
export type FactAtom = { readonly kind: FactKind; readonly id: string };
/** The facts of the kernel's WorldState; module `core` owns them in the data registry. */
export const KERNEL_FACT_KINDS = [
  'held',
  'used',
  'doc',
  'taken',
  'examined',
  'open',
  'slot',
  'fired',
  'visited',
  'solved',
  'failed',
  'abandoned',
  'attempt',
  'hint',
  'story',
] as const;
export type KernelFactKind = (typeof KERNEL_FACT_KINDS)[number];
type FactsOf<M> = M extends { readonly owns: { readonly facts?: readonly (infer F)[] } } ? F : never;
/** The fact kinds the data registry's modules add beyond the kernel's. */
export type ModuleFactKind = Exclude<FactsOf<(typeof MECHANIC_DATA)[number]>, KernelFactKind>;
export type FactKind = KernelFactKind | ModuleFactKind;
/** WorldState fields whose changes are never a fact cue, each with its reason (the cue gate reads this list). */
export const SILENT_FIELDS = {
  format: 'not play state',
  section: 'every change is a `move:enter|resume` or a `move:leave` cue (§8.1)',
  room: 'every change is a move cue',
  lastRoom: 'bookkeeping of the move',
  unproved: 'bookkeeping of reconcile',
  flags: 'no rule sets a flag until module `flags` (GM5f) owns the `flag` fact kind, which then carries its changes',
} as const;

/** 'carry': an item the chapter start gave (§6.6). */
export type CauseVerb = 'tap' | 'insert' | 'use' | 'combine' | 'enter' | 'return' | 'trigger' | 'solve' | 'fail' | 'device' | 'leave-view' | 'carry';
export type Cause = { readonly verb: CauseVerb; readonly at: HotspotKey | null; readonly item: ItemId | null; readonly via: TriggerKey | null };
/** The list fields of WorldState a rule writes (`unproved` is reconcile's). */
export type ListField = 'visited' | 'held' | 'used' | 'docs' | 'taken' | 'examined' | 'open' | 'fired' | 'pendingStory';

/** The one write path of every rule. Each list-field change appends one fact change per added / removed member. */
export interface Writer {
  readonly state: WorldState;
  set<K extends ListField>(field: K, value: WorldState[K], cause: Cause): void;
  /** solved / failed / abandoned / attempt / hint facts. */
  run(puzzle: PuzzleLocalId, run: PuzzleRun, cause: Cause): void;
  /** The kernel trigger runner. */
  fire(trigger: TriggerKey, effects: readonly Effect[], cause: Cause): void;
  effect(e: ExploreEffect): void;
  /** A module cue. */
  cue(module: MechanicId, name: string, at: HotspotKey | null, item: ItemId | null): void;
}

// ---------------------------------------------------------------------------------------------------------------
// §3.2 The two halves and the registries

/** The places a module may own keys in. */
export type Place = 'world' | 'item' | 'room' | 'hotspot' | 'slot' | 'effect';
/** One owned value with its place's id (item / room id, HotspotKey, `<HotspotKey>#<slot>`, trigger path) and source path
 *  (`sections.<s>.rooms.<r>.hotspots.<i>`, `items.<id>`, ...), so a module's issues and texts carry the author's path;
 *  `raw` holds only the keys of `owns[place]`. */
export type OwnedAt = { readonly place: Place; readonly id: string; readonly path: string; readonly raw: Readonly<Record<string, unknown>> };
/** One entry per place that carries at least one owned key. */
export type OwnedRaw = readonly OwnedAt[];
/** The kernel decoders' report, in the kernel's decoder shape (world/decode.ts keeps its own private). */
export type IssueReport = (path: string, reason: WorldIssue['reason'], detail: string) => void;
/** The kernel decoders a module reuses: the composed decoder passes the kernel's line-ID text decoder. */
export type DecodeCtx = { readonly text: (v: unknown, path: string, report: IssueReport) => WorldText };
/** A decoder returns undefined exactly when it reported at least one issue. */
type Decoder<T> = (v: unknown, path: string, report: IssueReport) => T | undefined;

/** ENGINE half, mechanics/data/<id>.ts. Runs at chapter load and at resume, before any room. */
export interface MechanicData<Id extends string, D, Sl = never> {
  readonly id: Id;
  /** 'none': a data-only module (labels); the alignment check then skips it. */
  readonly rules: 'chunk' | 'none';
  /** Exactly the keys this module owns per place; a key owned twice fails `mechanics: every key has one owner`. */
  readonly owns: {
    readonly world?: readonly string[];
    readonly item?: readonly string[];
    readonly room?: readonly string[];
    readonly hotspot?: readonly string[];
    readonly slot?: readonly string[];
    readonly effect?: readonly string[];
    readonly trigger?: string;
    readonly atoms?: readonly string[];
    readonly facts?: readonly string[];
  };
  /** Strict keys, every issue reported. Gets only its owned keys, per place; the result goes to `world.mods[id]`. */
  decode(raw: OwnedRaw, ctx: DecodeCtx): Result<D, Issue[]>;
  /** The inverse, for emission and the version hash: `decode(encode(d))` equals `d`. */
  encode(d: D): OwnedRaw;
  /** Reconcile steps 1-3 for this module's facts: drop refs the world lost, refit, re-arm lost gifts. */
  normalize(w: KernelWorld, s: WorldState, dropped: string[]): WorldState;
  /** The effects a `fired` entry with this module's prefix names (the kernel's `triggerOf`, explore/reconcile.ts). */
  trigger?(w: KernelWorld, target: string): readonly Effect[] | undefined;
  /** Condition atoms this module adds: their decoder, and whether a gating condition may use them. */
  readonly atoms?: { readonly [kind: string]: { readonly decode: Decoder<unknown>; readonly gating: boolean } };
  /** Saved state beyond facts. Its key must be in the save format's field list; adding one is a format bump. */
  readonly slice?: { readonly key: string; readonly initial: Sl; readonly read: Field<Sl>; normalize(w: KernelWorld, s: Sl): Sl };
  /** The DOM controls this module's UI adds, with their trigger (engine plan §8.3); `ui:<name>` keys derive from them.
   *  A control plays `UI_MOTIONS`' default unless it names its own preset; `haptic` adds touch feedback on top (§8.5).
   *  Data, in the engine half, so the cue stage resolves a control's motion without importing any rules half. A module
   *  that declares controls keeps its literal type (`satisfies`), or `ControlCue` cannot read their names. */
  readonly controls?: readonly ControlDecl[];
}

/** CHUNK half, mechanics/rules/<id>.ts (explore-ui family). Never value-imported by the engine. */
export interface MechanicRules<Id extends string, A extends { readonly kind: string }, C extends string> {
  /** The same id, in the same relative order, as its data half. */
  readonly id: Id;
  /** Every action this module enables in s (the proof enumerates them). */
  actions(w: KernelWorld, s: WorldState): readonly A[];
  apply(w: KernelWorld, a: A, out: Writer): void;
  /** Every fact this module's GATING rules read in `section`: `sectionKey` is built from these. */
  reads(w: KernelWorld, section: SectionId): readonly FactAtom[];
  /** Module cue names; each `module:<id>:<name>` needs a cue motion. */
  readonly cues: readonly C[];
  /** A tap on a hotspot that carries a key this module owns (`owns.hotspot`): core's `tap` hands it over before its own
   *  kinds, so the UI always dispatches `tap` and `actions` lists that tap once (core already does). False: not mine. */
  tap?(w: KernelWorld, s: WorldState, at: HotspotKey, out: Writer): boolean;
  /** Runs once per `room` effect into `room`, after the room's `onEnter` trigger and only when no event knot is
   *  pending: core calls it at its three `room` pushes (a move or a section's entry, a resume, an event return). It
   *  writes no state: `ArrivalOut` offers only a `puzzle` effect and a module cue, so the proof's states are unchanged
   *  and `actions` never lists it. A puzzle end pushes no `room` effect, so it never re-arrives. */
  arrived?(w: KernelWorld, s: WorldState, room: RoomId, out: ArrivalOut): void;
  /** Its share of the room's derived picture. */
  visuals?(w: KernelWorld, s: WorldState, room: RoomId): readonly PropView[];
  /** Evaluates an atom kind its data half declared. */
  holds?(w: KernelWorld, s: WorldState, atom: { readonly kind: string; readonly value: unknown }): boolean;
}

/** What an arrival may do: open a puzzle (the same states a hotspot's own tap reaches) and play a module cue. */
export type ArrivalOut = {
  effect(e: Extract<ExploreEffect, { kind: 'puzzle' }>): void;
  cue(module: MechanicId, name: string, at: HotspotKey | null): void;
};

/** The rules registry as the kernel walks it: each module's actions are widened to their `kind`, so the registry's
 *  type never refers back to the tuple it is built from. */
export type RulesRegistry = readonly MechanicRules<string, { readonly kind: string }, string>[];
export type ActionOf<R> = R extends MechanicRules<string, infer A, string> ? A : never;
/** The derived union of every module's actions. */
export type SectionAction = ActionOf<(typeof MECHANIC_RULES)[number]>;
export type ModuleCueKey = {
  [R in (typeof MECHANIC_RULES)[number] as R['id']]: `module:${R['id']}:${R['cues'][number]}`;
}[(typeof MECHANIC_RULES)[number]['id']];
export type DataOf<M> = M extends MechanicData<string, infer D, unknown> ? D : never;
/** One side table per module, keyed by its id (modules never edit world/types.ts). */
export type ModsOf<T extends readonly { readonly id: string }[]> = { readonly [M in T[number] as M['id']]: DataOf<M> };
/** The decoded world: the kernel body plus the modules' side tables. `mods` is optional until the composed decoder
 *  builds it on every decoded world; the explore controller and the story tool pass worlds without it today. */
export type KernelWorld = WorldPublicBody & { readonly mods?: ModsOf<typeof MECHANIC_DATA> };

/** One anchor's picture in a room (§6.4): `at` is stable across states, so motions and labels target it. */
export type PropView = {
  readonly at: AnchorKey;
  readonly state: StateName;
  /** The state's base image; null: nothing drawn. */
  readonly prop: PropId | null;
  /** Drawn inside the anchor over the base. */
  readonly patch: { readonly prop: PropId; readonly rect: Rect } | null;
  /** Base box, canonical bg px. */
  readonly rect: Rect;
  /** Decor order; hotspot props 0. */
  readonly z: number;
};
