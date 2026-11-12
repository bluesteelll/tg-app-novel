// The yields (PUZZLES-PLAN F6, F7, F9, F10, X8, X12, X13, X14 and "Modules"; the L15 cut D4, D13, D18, D20,
// K47-K54): GameSession's half that runs what a `yield` step hands over, one per session. A linear puzzle and an
// exploration section are host-owned: the world state lives here (and in the explore controller while a section is
// current), room batches are built here from world data, and the story is re-entered only here, through `project` +
// `runner.enter` (the `runner-enter` arch rule), so ink never reads the rooms and the rooms never read ink
// (principle 7). Every `import()` of the lazy families is here too (X14): the explore controller with its layer,
// the puzzle host, the puzzle types through `loadPuzzleUi`, and the cue stage (engine plan §8.1). The session's cue bus
// lives here: today's effects reach it as cues (GM3s), and the stage subscribes once its chunk is in.
import type { Component } from 'svelte';

import type { Endpoints } from '../api/endpoints.ts';
import type { Clock } from '../api/http.ts';
import type { AudioCommand } from '../audio/manager.ts';
import { createCueBus } from '../cues/bus.ts';
import type { CueBus } from '../cues/bus.ts';
import type { Cue, CueEvent, MoveHow, PuzzleCue, VisualDiff } from '../cues/types.ts';
import type { ExploreController, createExploreController } from '../explore/controller.ts';
import { project } from '../explore/project.ts';
import { own, runReduce, worldIndex } from '../explore/reduce.ts';
import type { ExploreEffect } from '../explore/reduce.ts';
import { EMPTY_WORLD_STATE } from '../explore/state.ts';
import type { PuzzleOutcome, PuzzleRun, WorldState } from '../explore/state.ts';
import type { Box } from '../geom/cover.ts';
import { t } from '../i18n/index.ts';
import { mechT } from '../i18n/mechanics.ts';
import type { AnchorKey, Cause, CauseVerb, MechanicId, PropView, SectionAction, StateName } from '../mechanics/contract.ts';
import type { MECHANIC_RULES } from '../mechanics/rules/index.ts';
import { loadPuzzleUi } from '../puzzles/registry.ts';
import type { ChunkError } from '../puzzles/registry.ts';
import { createPuzzleSession } from '../puzzles/session.ts';
import type { AttemptResult, HintPort, PuzzleEnd, PuzzleError, PuzzleMode, PuzzleSession } from '../puzzles/session.ts';
import type { SceneController } from '../scene/controller.ts';
import type { VisualCommand } from '../scene/executor.ts';
import type { StatsReporter } from '../stats/reporter.ts';
import type { LoadedChapter, Result } from '../story/catalog.ts';
import type { RunnerError, StoryRunner } from '../story/runner.ts';
import type { BgId, KnotName, PropPlacement, PuzzleLocalId, SectionId, StagingSnapshot, VarName, YieldCommand } from '../story/staging.ts';
import type { TelegramClient } from '../telegram/index.ts';
import type { ExploreLayerActions, ExploreLayerProps, ExploreViewStore } from '../ui/explore-view.svelte.ts';
import { backScreen, coversStage } from '../ui/puzzle-view.svelte.ts';
import type { HintLadderUiView, PuzzleFrameView, PuzzleHostCallbacks, PuzzleHostProps, PuzzleView } from '../ui/puzzle-view.svelte.ts';
import type { ScreenKind, Screens, ScreensView } from '../ui/screens.ts';
import type { CueStageProps, CueStageSlot, ViewModel } from '../ui/state.svelte.ts';
import type { Gift, HotspotKey, ItemId, RoomId, WorldPublic, WorldText } from '../world/types.ts';

/** X12: the door fade of a room batch. */
export const ROOM_FADE_MS = 400;
/** Engine plan §6.3 "Transition": a zoom into or out of a view crossfades the bg (reconcile r1 I-5). */
export const VIEW_FADE_MS = 400;
/** B-001 / X11 / §6.4: a state batch (a taken prop leaving included) crossfades the props over this long; the bg stays. */
export const TAKE_FADE_MS = 300;
/** The close-up's fade in and out (a puzzle with a `closeup`). */
export const CLOSEUP_FADE_MS = 300;
/** PZ F9: a `dirty` effect autosaves after this quiet time; a newer one restarts it. */
export const DIRTY_DEBOUNCE_MS = 2000;
/** A section's music fades in over this long when a room batch starts it. */
const SECTION_BGM_FADE_MS = 1000;

/** The explore-ui chunk: the controller's factory and the layer component (one family, X14). */
export type ExploreChunk = { create: typeof createExploreController; layer: Component<ExploreLayerProps> };

/** The lazy families' loaders; a failed `import()` is an error value, and a later call imports again. */
export type LazyChunks = {
  explore(): Promise<Result<ExploreChunk, ChunkError>>;
  puzzleHost(): Promise<Result<Component<PuzzleHostProps>, ChunkError>>;
  puzzleUi: typeof loadPuzzleUi;
  /** The cue stage (engine plan §8.1): optional, so a host without it loads none and gets no slot. */
  cueStage?(): Promise<Result<Component<CueStageProps>, ChunkError>>;
};

const chunkError = (e: unknown): { ok: false; error: ChunkError } => ({
  ok: false,
  error: { kind: 'chunk', detail: e instanceof Error ? e.message || e.name : String(e) },
});

/** Every `import()` of the lazy families (X14): each literal is its own dynamic chunk, never in a static closure. */
export const LAZY_CHUNKS: LazyChunks = {
  explore: async () => {
    try {
      const [c, v] = await Promise.all([import('../explore/controller.ts'), import('../ui/explore/ExploreView.svelte')]);
      return { ok: true, value: { create: c.createExploreController, layer: v.default } };
    } catch (e) {
      return chunkError(e);
    }
  },
  puzzleHost: async () => {
    try {
      return { ok: true, value: (await import('../ui/puzzles/PuzzleHost.svelte')).default };
    } catch (e) {
      return chunkError(e);
    }
  },
  puzzleUi: loadPuzzleUi,
  cueStage: async () => {
    try {
      return { ok: true, value: (await import('../cues/stage/index.ts')).CueStage };
    } catch (e) {
      return chunkError(e);
    }
  },
};

/** A frame on screen in App's frame layer (the opaque frame overlay); `id` is `PuzzleFrameView.id` (engine plan §8.6). */
export type ShownFrame = { readonly id: number };

/** What GameSession gives its yields: the views, the ports, and its own steps. */
export type YieldsHost = {
  vm: ViewModel;
  screens: Screens;
  tg: Pick<TelegramClient, 'haptic'>;
  api: Pick<Endpoints, 'getPuzzle' | 'postAttempt'>;
  scene: Pick<SceneController, 'preload' | 'releasePreload' | 'snapshot' | 'stats'>;
  explore: ExploreViewStore;
  puzzle: PuzzleView;
  reporter: Pick<StatsReporter, 'record'>;
  clock: Clock;
  chunks: LazyChunks;
  /** The hint port a new puzzle session takes (META-PLAN M21: the wallet's), or null; none given is null. */
  hints?: () => HintPort | null;
  /** The Stage element the scene mounted into (X10: the controller's box); null before the first mount. */
  stageHost(): HTMLElement | null;
  chapter(): LoadedChapter | null;
  runner(): Pick<StoryRunner, 'enter'> | null;
  /** A world line in the UI language (the chapter's tables). */
  text(w: WorldText): string;
  /**
   * A batch the yields built (a room, a close-up) through `ensure`, the scene and the audio; resolves at its end.
   * `started` runs once when the batch starts, after its loads and before its audio, an empty batch included: where a
   * cue that goes with the batch's transition is emitted (engine plan GM3w). A batch whose session ended during its
   * loads never starts, so its `started` never runs.
   */
  apply(visual: readonly VisualCommand[], audio: readonly AudioCommand[], started?: () => void): Promise<void>;
  bgm(): StagingSnapshot['bgm'];
  /** After `runner.enter`: the story's next step, shown (and its own yield, if it stops at one). */
  continueStory(): Promise<void>;
  storyError(e: RunnerError): void;
  autosave(): void;
  /** The error notice; its action returns to the game root and runs `retry`. */
  notice(retry: () => Promise<void>): void;
  /** A player intent (D7): while a batch is in flight it completes the transition instead of running. */
  tap(fn: () => Promise<void>): Promise<void>;
  /** An intent that must run: after the batch in flight. */
  queue(fn: () => Promise<void>): Promise<void>;
  /** The scene role's seam (engine plan §8.6, design-shots I-4): called once, with the session's bus subscription. */
  sceneCues?: (subscribe: CueBus['subscribe']) => void;
  /**
   * The frame on screen changed (engine plan §8.6): `f` once the frame has appeared (`appear`, after the write that
   * shows it), `null` at the step that takes a shown frame off screen (its clear, an X8 Back's `hideFrame`, a drop by
   * another open, `restore`, a chapter change or `dispose`). Never two equal values in a row; a frame that never
   * appeared reports nothing; only a frame that covers the stage (`coversStage`) reports. Void: no host wait.
   */
  frameShown?: (f: ShownFrame | null) => void;
};

export interface Yields {
  /** A yield step's pictures are loaded and its transition starts; `onYield` follows once the step is on screen. */
  ahead(y: YieldCommand): void;
  /** A `yield` step is on screen, after its batch and its autosave. */
  onYield(y: YieldCommand): Promise<void>;
  /** D13: the chapter's first line is shown: the lazy chunks its world needs are prefetched (not awaited). */
  lineShown(): void;
  /** The world a save body carries now. */
  world(): WorldState;
  /**
   * Engine plan §8.7: the state commands of the room of the current section that `bg` shows, built as its room batch
   * builds them: the current room when its bg is `bg`, else the first such room in declaration order. Null when no room
   * of the section has that bg, when no section is open, or before the explore chunk's controller exists (Q5).
   */
  roomFor(bg: BgId): readonly VisualCommand[] | null;
  /**
   * A resume's world; a non-null `reset` is a section that restarted (X9: the area-reset toast). `at` is the yield
   * of the resumed step, if it is one. The rooms leave the screen with the step they belonged to: the layer, its
   * panels and the root-back. An explore yield re-enters them with this controller; any other step drops the
   * controller with its `room:*` holders, and a later explore yield makes a new one.
   */
  restore(world: WorldState, reset: SectionId | null, at: YieldCommand | null): void;
  /** PZ F10: the puzzle session, then the controller; the world starts empty. */
  chapterChanged(): void;
  /** D4: the game root is set again (`setRoot` cleared the root-back): it returns from the cached path state. */
  rootShown(): void;
  /** The screens stack changed: the panels and an exploration puzzle follow its overlays (Back closes them). */
  screensChanged(v: ScreensView): void;
  /** K49: the views again in the UI language. */
  relabel(): void;
  /** Exit order step 1 (SP "Module API"): the open puzzle session, aborting an attempt in flight. */
  disposePuzzle(): void;
  /** The session ends: the puzzle session, the controller, the timers. */
  dispose(): void;
  presence(): { explore: boolean; puzzle: boolean };
  readonly layer: ExploreLayerActions;
  readonly host: PuzzleHostCallbacks;
}

/** The run a puzzle starts from: the saved attempts and hints count toward its limit (X8). */
const runOf = (s: WorldState, p: PuzzleLocalId): PuzzleRun =>
  (Object.hasOwn(s.puzzles, p) ? s.puzzles[p] : undefined) ?? { outcome: null, attempts: 0, hintsOpened: 0 };

/**
 * X11 and engine plan §6.4: a room's picture as the props command draws it, back to front, each placement keyed by its
 * anchor (§5.2, R-A4): an anchor's base (no `part`), then its patch over it. A view that draws nothing places nothing.
 */
const placementsOf = (views: readonly PropView[]): PropPlacement[] =>
  views.flatMap((v) => [
    ...(v.prop === null ? [] : [{ prop: v.prop, rect: v.rect, at: v.at }]),
    ...(v.patch === null ? [] : [{ prop: v.patch.prop, rect: v.patch.rect, at: v.at, part: 'patch' as const }]),
  ]);

/**
 * §6.4 "Per-dispatch diff": the anchors whose state a dispatch changed, in draw order; one that left the picture (a
 * taken take) or joined it has null on that side.
 */
const diffOf = (before: readonly PropView[], after: readonly PropView[]): VisualDiff[] => {
  const stateIn = (views: readonly PropView[], at: AnchorKey): StateName | null => views.find((v) => v.at === at)?.state ?? null;
  return [...before, ...after.filter((v) => stateIn(before, v.at) === null)]
    .sort((a, b) => a.z - b.z)
    .flatMap((v) => {
      const from = stateIn(before, v.at);
      const to = stateIn(after, v.at);
      return from === to ? [] : [{ at: v.at, from, to }];
    });
};

/**
 * The stage already shows these placements: the same prop at the same rect on the same anchor, in order. An absent
 * anchor (a format-1 save's placement, `PropPlacementV1`) is the same prop and rect at any anchor (carry (c)).
 */
const sameProps = (a: readonly PropPlacement[], b: readonly PropPlacement[]): boolean =>
  a.length === b.length &&
  a.every((p, i) => {
    const q = b[i];
    return q !== undefined && p.prop === q.prop && p.rect.every((v, j) => v === q.rect[j]) && (p.at === undefined || q.at === undefined || p.at === q.at);
  });

/** An open puzzle: its session, how it ends, and the frame the overlay shows. */
type Open = {
  session: PuzzleSession;
  /** The session's hint port: its get-more opens the wallet. */
  port: HintPort | null;
  local: PuzzleLocalId;
  mode: PuzzleMode;
  then: KnotName | null;
  closeup: boolean;
  id: number;
  /** `hideFrame` took the frame off screen; the session ends later (an X8 Back over an attempt in flight). */
  hidden: boolean;
  /** `appear` has shown the frame: its cues may play (the shown-frame test). */
  appeared: boolean;
  /** The frame's load hold is open (`holdLoad`): exactly while `loading(puzzle.frame)` holds. */
  loading: boolean;
  /**
   * The status request the frame's Hint last read (`hints()` is single-flight): a tap that shares it adds no second
   * reader, so its one answer writes the ladder and plays its cue once.
   */
  asked: ReturnType<PuzzleSession['hints']> | null;
};

/** The end cue of a dropped frame (`dropPuzzle`): the session's end, `closed` for a no-outcome drop, null at `dispose`. */
type DropCue = Extract<PuzzleCue, 'solved' | 'failed' | 'closed'> | null;

/** The hint ladder's own cues (engine plan §8.1 "The hint ladder"). */
type LadderCue = Extract<PuzzleCue, 'ladder' | 'hint-shown' | 'hint-failed' | 'hint-renewing'>;

let frameSeq = 0;

/** A cue as the yields emit it: no pointer, no visual diff, no element (no control cue is theirs). */
const cueEvent = (cue: Cue, box: Box | null): CueEvent => ({ cue, box, point: null, diff: [], el: null });

/**
 * The overlays whose cues the screens diff speaks (engine plan §8.1 point 10): a sheet of the rooms or the hint ladder.
 * An exploration puzzle is none: its frame's own `opened` and `closed` cues show it.
 */
const PANEL_KINDS = ['inventory', 'document', 'lock', 'hints'] as const satisfies readonly ScreenKind[];
type PanelKind = (typeof PANEL_KINDS)[number];

/** A wait of the views (engine plan §8.1 point 11): the room batch's hold, `panel: null`. */
const waitCue = (name: 'waiting' | 'waited', box: Box | null): CueEvent => cueEvent({ kind: 'ui-state', name, panel: null, item: null }, box);

/** Where a batch's load hold plays (its `via` box; null: the stage centre) and what plays when the batch starts. */
export type HeldAt = { readonly box: Box | null; readonly atStart?: () => void };

/**
 * The one site that applies a visual batch for the views (engine plan §8.1 "The frame's flags and its ends"):
 * `ui-state:waiting` before `h.apply`, and from that apply's `started` (called once per apply, an empty batch included)
 * `waited`, then `at.atStart` (a room batch's move cue and its entry's cues). `'no-load'` (a batch that adds no image)
 * holds nothing while no texture is stale and no revive runs; otherwise `ensure` may wait, so it holds at the centre.
 * A batch whose session ended never starts: the bus is gone with it.
 */
export function heldBy(
  h: Pick<YieldsHost, 'apply' | 'scene'>,
  emit: (e: CueEvent) => void,
): (visual: readonly VisualCommand[], audio: readonly AudioCommand[], at: HeldAt | 'no-load') => Promise<void> {
  // `at` names `HeldAt` on the declaration with a body: the request walk binds the batch site by it.
  return (visual, audio, at: HeldAt | 'no-load') => {
    const hold: HeldAt | null = at !== 'no-load' ? at : h.scene.stats().stale === 0 && !h.scene.stats().reviving ? null : { box: null };
    if (hold !== null) {
      emit(waitCue('waiting', hold.box));
    }
    return h.apply(visual, audio, () => {
      if (hold !== null) {
        emit(waitCue('waited', hold.box));
        hold.atStart?.();
      }
    });
  };
}

/** Core's cue names: its rules half's `cues` (a type read: the rules stay in the explore-ui chunk). */
type CoreCueName = (typeof MECHANIC_RULES)[0]['cues'][number];
/** The one builder of the yields' module cues: only a name core declares, so its motion row exists (GM3m review M2). */
export const coreCue = (name: CoreCueName, at: HotspotKey | null, item: ItemId | null): Extract<Cue, { kind: 'module' }> => ({
  kind: 'module',
  module: 'core' as MechanicId,
  name,
  at,
  item,
});

const cause = (verb: CauseVerb, at: HotspotKey | null = null, item: ItemId | null = null): Cause => ({ verb, at, item, via: null });

/**
 * The cause of a dispatched action's cues; a use acts at its target with its item (§6.1); a lock puzzle's run acts at its
 * lock, so its cues land on the lock's box.
 */
const causeOf = (a: SectionAction, w: WorldPublic | null): Cause =>
  a.kind === 'tap'
    ? cause('tap', a.hotspot)
    : a.kind === 'insert'
      ? cause('insert', a.hotspot, a.item)
      : a.kind === 'use'
        ? cause('use', a.target, a.item)
        : cause(
            a.kind === 'puzzle-ended' && a.outcome === 'solved' ? 'solve' : 'fail',
            'puzzle' in a && w !== null ? (worldIndex(w).puzzleLock.get(a.puzzle) ?? null) : null,
          );

export function createYields(h: YieldsHost): Yields {
  const { vm, screens, explore, puzzle } = h;
  let world: WorldState = EMPTY_WORLD_STATE;
  let controller: ExploreController | null = null;
  let layerComponent: Component<ExploreLayerProps> | null = null;
  let offs: Array<() => void> = [];
  /** The last `onPath` value (K50): the root-back returns from it after an event knot and after `setRoot`. */
  let walkable = false;
  let open: Open | null = null;
  let prefetched = false;
  let dirtyTimer: number | null = null;
  let retryTimer: number | null = null;
  let dead = false;
  /** The panels the screens stack showed at its last change, so the next change says which left and which arrived. */
  let panels: readonly PanelKind[] = [];
  /** The async steps the effects of one dispatch asked for, run in order by the intent that dispatched. */
  const jobs: Array<() => Promise<void>> = [];

  // -------------------------------------------------------------------------------------------------------------
  // The cue channel (engine plan §8.1): one bus per session; the stage's slot once its chunk is in

  /**
   * A family root's cue with its point moved from the root's px to the stage host's (D-P: the stage plays in the host's
   * px). The two differ for a frame root (full-bleed under the viewport's top inset) and for any root while its
   * entrance scales it (Q69: the explore root's 0.98 scale about its centre). A cue with no point, element, root or
   * host passes as it came.
   */
  const inStageHost = (e: CueEvent): CueEvent => {
    const root = e.el?.closest('[data-cue-root]') ?? null;
    const host = h.stageHost();
    if (e.point === null || root === null || host === null) {
      return e;
    }
    const r = root.getBoundingClientRect();
    const s = host.getBoundingClientRect();
    return { ...e, point: { x: e.point.x + r.left - s.left, y: e.point.y + r.top - s.top } };
  };

  const bus = createCueBus();
  h.sceneCues?.(bus.subscribe);
  /** The explore root's emit (D1): its controls' cues on this session's bus, in stage-host px; cleared at dispose. */
  const exploreCue = (e: CueEvent): void => bus.emit(inStageHost(e));
  explore.oncue = exploreCue;
  /** Plans the stage dropped at its unmount: orphans the bus cannot see. */
  let dropped = 0;
  let slot: CueStageSlot | null = null;
  /** The stage's chunk; the slot is written when that chunk settles, never after a sibling's (critique W2). */
  const loadStage = async (): Promise<boolean> => {
    if (h.chunks.cueStage === undefined || slot !== null) {
      return true;
    }
    const r = await h.chunks.cueStage();
    if (r.ok && slot === null && !dead) {
      slot = {
        component: r.value,
        subscribe: bus.subscribe,
        orphans: () => bus.orphans() + dropped,
        dropped: () => {
          dropped += 1;
        },
        host: () => h.stageHost(),
        haptic: h.tg.haptic,
      };
      vm.cueStage = slot;
    }
    return r.ok;
  };

  /**
   * D13 and §8.1 "Loading": the lazy chunks the chapter's world needs and the stage, once per chapter, ahead of the
   * first wait they cover; after the first line (so these bytes never compete with the first knot's images), at a
   * resume onto a yield, ahead of a yield step's transition, and after a section's first room. Not awaited: a failure
   * surfaces at the yield, which imports again.
   */
  const prefetch = (): void => {
    const w = prefetched ? null : (h.chapter()?.world ?? null);
    if (w === null) {
      return;
    }
    prefetched = true;
    const sections = Object.keys(w.sections).length > 0;
    const puzzles = Object.keys(w.puzzles).length > 0;
    if (sections) {
      void h.chunks.explore();
    }
    if (puzzles) {
      void h.chunks.puzzleHost();
    }
    if (sections || puzzles) {
      void loadStage();
    }
  };

  /**
   * A room batch to run (D9): how its move enters the room, its move cue, built at the effect, and the cues of the entry
   * that pushed it (D8).
   */
  type RoomJob = {
    readonly room: RoomId;
    readonly sfx: Extract<ExploreEffect, { kind: 'room' }>['sfx'];
    readonly how: MoveHow;
    readonly move: CueEvent;
    cues: readonly CueEvent[];
  };
  /**
   * One controller entry (D8): its cause, the box of the hotspot it acts on, how a move it makes enters its room, the
   * cues it maps, the first room job it pushes, which carries them to its batch's start (§8.1 round 5), and the room's
   * visual diff, which every cue it maps carries (§6.4).
   */
  type Scope = {
    readonly cause: Cause;
    readonly box: Box | null;
    readonly how: MoveHow;
    readonly cues: CueEvent[] | null;
    job: RoomJob | null;
    diff: readonly VisualDiff[];
  };
  const AT_ONCE: Scope = { cause: cause('trigger'), box: null, how: 'walk', cues: null, job: null, diff: [] };
  let scope = AT_ONCE;
  /** The room the last batch showed: a move's `from`. */
  let shown: RoomId | null = null;
  /** The next section entry is the resume onto its yield. */
  let resumed = false;
  /** A world cue of the entry in scope, on its hotspot's box. */
  const send = (cue: Cue): void => {
    const e = cueEvent(cue, scope.box);
    if (scope.cues === null) {
      bus.emit(e);
    } else {
      scope.cues.push(e);
    }
  };
  /** Runs one controller entry; the box is read before it, while the hotspot it acts on is still shown. */
  const scoped = <T>(cause: Cause, run: () => T, how: MoveHow = 'walk'): T => {
    const s: Scope = { cause, box: explore.hotspots.find((v) => v.key === cause.at)?.css ?? null, how, cues: [], job: null, diff: [] };
    scope = s;
    const out = run();
    scope = AT_ONCE;
    const cues = (s.cues ?? []).map((e) => ({ ...e, diff: s.diff })); // the diff is known once the entry has run
    if (s.job !== null) {
      s.job.cues = cues;
    } else {
      for (const e of cues) {
        bus.emit(e);
      }
    }
    return out;
  };
  const held = heldBy(h, bus.emit);

  const drain = async (): Promise<void> => {
    for (let job = jobs.shift(); job !== undefined; job = jobs.shift()) {
      await job();
      if (dead) {
        jobs.length = 0;
      }
    }
  };

  /** The world's lookups, built once per loaded world. */
  let index: { w: WorldPublic; ix: ReturnType<typeof worldIndex> } | null = null;
  const indexOf = (w: WorldPublic): ReturnType<typeof worldIndex> => {
    if (index?.w !== w) {
      index = { w, ix: worldIndex(w) };
    }
    return index.ix;
  };
  const inEvent = (): boolean => world.pendingStory.length > 0;
  /**
   * W1 (RULINGS 298): the drawn box of the first shown exit into `view`, in world order, from the hotspots the
   * controller has just written for the room it settled in; null when none is shown.
   */
  const exitBoxInto = (w: WorldPublic, view: RoomId | null): Box | null =>
    explore.hotspots.find((v) => {
      const x = indexOf(w).hotspots.get(v.key)?.hotspot;
      return x?.kind === 'exit' && 'room' in x.to && x.to.room === view;
    })?.css ?? null;

  // -------------------------------------------------------------------------------------------------------------
  // The root-back (X12, K50, D4)

  const back = (): void => {
    void h.tap(async () => {
      const c = controller;
      if (c === null || !scoped(cause('tap'), () => c.back())) {
        return;
      }
      world = c.state();
      await drain();
    }); // a press has no caller; the move is on screen
  };
  const rootShown = (): void => {
    const exploring = controller !== null && world.section !== null && explore.layer !== null;
    screens.setRootBack(exploring && walkable && !inEvent() ? back : null);
  };

  // -------------------------------------------------------------------------------------------------------------
  // The world and its effects

  const dirty = (): void => {
    if (dirtyTimer !== null) {
      h.clock.clearTimeout(dirtyTimer);
    }
    dirtyTimer = h.clock.setTimeout(() => {
      dirtyTimer = null;
      h.autosave();
    }, DIRTY_DEBOUNCE_MS);
  };

  const closePanel = (): void => {
    explore.panel = null;
    screens.close('inventory');
    screens.close('lock');
  };

  /** Leaves the rooms for the story: the layer hides with the ribbon's selection, the root-back clears (X12), the knot
   *  runs after the drain. */
  const toStory = (knot: KnotName): void => {
    closePanel();
    explore.selected = null;
    explore.layer = null;
    screens.setRootBack(null);
    jobs.push(() => enterKnot(knot));
  };

  const giftName = (g: Gift, w: WorldPublic): string | null => {
    if ('item' in g) {
      const item = Object.hasOwn(w.items, g.item) ? w.items[g.item] : undefined;
      return item === undefined ? null : h.text(item.name);
    }
    const doc = Object.hasOwn(w.docs, g.doc) ? w.docs[g.doc] : undefined;
    return doc === undefined ? null : h.text(doc.title);
  };

  const effect = (e: ExploreEffect): void => {
    const c = controller;
    if (c !== null) {
      world = c.state();
    }
    const w = h.chapter()?.world ?? null;
    switch (e.kind) {
      case 'room': {
        // D9: from the room the last batch showed, by the entry's hotspot (an exit) or by its kind (Back: none). A zoom
        // says so itself (§6.3: core's `moveHow`, `leave-view` included); any other move is the entry's kind. A zoom-out
        // by no exit (`leave-view`: the leave control or Back) lands on the parent's first shown exit into the view just
        // left, the zoom-in's box read backwards (W1, RULINGS 298); `settle` wrote the parent's hotspots before this.
        const how: MoveHow = e.how === 'zoom-in' || e.how === 'zoom-out' ? e.how : scope.how;
        const box = e.how === 'zoom-out' && e.via === null && w !== null ? exitBoxInto(w, e.from) : scope.box;
        const move = cueEvent({ kind: 'move', from: shown, to: e.room, via: scope.cause.at, how }, box);
        const job: RoomJob = { room: e.room, sfx: e.sfx, how, move, cues: [] };
        if (scope.cues !== null) {
          scope.job ??= job;
        }
        jobs.push(() => roomBatch(job));
        return;
      }
      case 'look':
        vm.showToast({ kind: 'note', key: 'look', message: h.text(e.text), sticky: false }); // its cue is the writer's
        return;
      case 'got': {
        // Its fact cue is the writer's (a `cue` effect), which carries K51's success haptic in its row (D6). A taken
        // prop leaves the stage by the dispatch's state batch (`act`).
        const name = w === null ? null : giftName(e.gift, w);
        if (name !== null) {
          vm.showToast({ kind: 'note', key: 'got', message: name, sticky: false });
        }
        return;
      }
      case 'lock':
        explore.panel = { kind: 'lock' };
        screens.push({ kind: 'lock' }); // its `panel-open` is the screens diff's, here in this push (never held with a move)
        return;
      case 'puzzle':
        jobs.push(() => openPuzzle(e.puzzle, 'explore', null));
        return;
      case 'story':
        toStory(e.knot); // its fact cue is the writer's
        return;
      case 'leave':
        send({ kind: 'move', from: shown, to: null, via: scope.cause.at, how: 'leave' });
        toStory(e.knot);
        return;
      case 'refused':
        // Its cue is the writer's: core's `refused` at an insert, `use`'s at a use (K51's error haptic, D6). A refused use
        // says so in the UI's default words (§6.1, GM3u); a `look` of the same block (the item's or the room's text, which
        // `use` emits after this effect) replaces it, by the toast's key. A refused insert says it in the lock panel.
        if (scope.cause.verb === 'use') {
          vm.showToast({ kind: 'note', key: 'look', message: mechT(vm.lang, 'mech.use_refused'), sticky: false });
        }
        return;
      case 'reset':
        vm.showToast({ kind: 'note', key: 'area_reset', message: t(vm.lang, 'explore.area_reset'), sticky: false });
        send(coreCue('reset', null, null));
        return;
      case 'cue':
        // The writer's record (engine plan §8.1 plan (2)): each fact and module cue of the entry, on its box.
        send(e.cue);
        return;
      case 'dirty':
        dirty();
        return;
      default: {
        const _never: never = e;
        return _never;
      }
    }
  };

  // -------------------------------------------------------------------------------------------------------------
  // The ribbon's selection (engine plan §6.1 UI, §8.1 point 9; GM3u): written here only

  /** The ribbon's cue for `item`: no panel and no box (the stage finds the slot by its item). */
  const selection = (name: 'select' | 'deselect', item: ItemId): CueEvent => cueEvent({ kind: 'ui-state', name, panel: null, item }, null);
  /** Clears the selection with its `deselect` (the slot settles back); none selected, nothing. */
  const deselect = (): void => {
    const was = explore.selected ?? null;
    if (was !== null) {
      explore.selected = null;
      bus.emit(selection('deselect', was));
    }
  };

  /**
   * One action through the one writer: the controller while a section is current (K53, so an exploration puzzle's
   * results reach the lock), else the kernel's `runReduce` here (a linear puzzle's run, which no section holds). Taps,
   * inserts and uses come only from the explore layer, which exists only with a controller, so nothing else is written
   * here. A selected item the action took out of the hands leaves the selection, with no cue of its own: the action's
   * cues show where it went. A dispatch that changes the picture of its room, the room staying current, queues one state
   * batch (§6.4) ahead of its own jobs, so a `then`'s room or knot job runs after the change is on screen (B-001).
   */
  const act = (a: SectionAction): void => {
    scoped(causeOf(a, h.chapter()?.world ?? null), () => {
      const c = controller;
      if (c !== null && world.section !== null) {
        const room = world.room;
        const before = room === null ? [] : c.visualsOf(room);
        const first = jobs.length;
        c.dispatch(a);
        world = c.state();
        followLock();
        const diff = room === null || world.room !== room ? [] : diffOf(before, c.visualsOf(room));
        if (diff.length > 0) {
          scope.diff = diff;
          jobs.splice(first, 0, () => stateBatch(diff));
        }
        return;
      }
      const w = h.chapter()?.world ?? null;
      if (w === null || (a.kind !== 'attempt-failed' && a.kind !== 'hint-opened' && a.kind !== 'puzzle-ended')) {
        return;
      }
      const out = runReduce(w, world, a);
      world = out.state;
      for (const e of out.effects) {
        effect(e);
      }
    });
    if (explore.selected != null && !world.held.includes(explore.selected)) {
      explore.selected = null;
    }
  };

  /** K48: the lock panel closes when the controller's lock view turns null (opened, or another room). */
  const followLock = (): void => {
    if (explore.panel?.kind === 'lock' && explore.lock === null) {
      explore.panel = null;
      screens.close('lock');
    }
  };

  const dispatchNow = async (a: SectionAction): Promise<void> => {
    act(a);
    await drain();
  };

  // -------------------------------------------------------------------------------------------------------------
  // Room batches (F7 step 1, X11, X12, D20)

  /**
   * The one builder of a room's props (engine plan §6.4; `roomBatch`, the state batch and `roomFor` read it): the
   * controller's views of the room in the current state, as placements. Null without a controller (Q5).
   */
  const propsOf = (room: RoomId): PropPlacement[] | null => (controller === null ? null : placementsOf(controller.visualsOf(room)));

  const roomBatch = async (j: RoomJob): Promise<void> => {
    const { room, sfx } = j;
    // §8.1 round 5: the move cue, then the cues of the entry that moved, when the batch starts.
    const atStart = (): void => {
      for (const e of [j.move, ...j.cues]) {
        bus.emit(e);
      }
    };
    const ch = h.chapter();
    const w = ch?.world ?? null;
    const entry = w === null ? undefined : indexOf(w).rooms.get(room);
    const props = propsOf(room); // a room job is pushed only by the controller's listener: never null in practice
    if (w === null || entry === undefined || props === null) {
      atStart(); // no batch: nothing holds them back
      return;
    }
    const stage = h.scene.snapshot();
    const zoom = j.how === 'zoom-in' || j.how === 'zoom-out'; // §6.3: a view crossfades over its parent, no door dip
    const visual: VisualCommand[] =
      stage.bg === entry.room.bg && stage.cg === null && sameProps(stage.props, props)
        ? [] // the stage already shows the room: no fade
        : [zoom ? { kind: 'bg', bg: entry.room.bg, t: 'crossfade', ms: VIEW_FADE_MS } : { kind: 'bg', bg: entry.room.bg, t: 'fade', ms: ROOM_FADE_MS }, { kind: 'props', props }];
    const audio: AudioCommand[] = [];
    const music = w.sections[entry.section]?.bgm ?? null;
    if (music !== null && h.bgm()?.track !== music) {
      audio.push({ kind: 'bgm', track: music, fadeMs: SECTION_BGM_FADE_MS, vol: 1 });
    }
    if (sfx !== null) {
      audio.push({ kind: 'sfx', sfx, vol: 1 });
    }
    shown = room;
    // §6.3 (GM4u): the bar's leave control shows in a view, by the controller's own rule over its state (`inView`), in
    // the same flush as the layer and the room's hotspots, so it never shows over a room the layer is not showing.
    explore.inView = world.section !== null && world.room !== null && own(w.mods.view.of, world.room) !== undefined;
    explore.layer = inEvent() ? null : layerComponent; // an onEnter event hides the rooms it moved into
    await held(visual, audio, { box: j.move.box, atStart });
    if (dead) {
      return;
    }
    rootShown(); // the rooms are back: the root-back returns from the path state (X12)
    controller?.roomShown(); // K47 / D20: after the batch, so the registry counts the room before its neighbours
    prefetch(); // a session resumed into a room has the host before its first lock tap
  };

  /**
   * B-001 and engine plan §6.4: a dispatch's state change shows in the room on screen at once, not at the next room
   * batch (a take's prop leaving it included). It is a fade, not a cut (owner Q53: motion wherever the picture changes):
   * a crossfade onto the bg already shown keeps the bg and fades only the props that changed. Its load holds at the
   * first changed anchor that draws an image (`stateHold`; none: `'no-load'`). Another picture up (a close-up, a room
   * the stage does not show) or the props already shown apply nothing.
   */
  const stateBatch = async (diff: readonly VisualDiff[]): Promise<void> => {
    const c = controller;
    const room = world.section !== null ? world.room : null;
    const w = h.chapter()?.world ?? null;
    const entry = w === null || room === null ? undefined : indexOf(w).rooms.get(room);
    const props = room === null ? null : propsOf(room);
    const stage = h.scene.snapshot();
    if (c === null || entry === undefined || props === null || stage.bg !== entry.room.bg || stage.cg !== null || sameProps(stage.props, props)) {
      return; // the room batch that shows the room again draws its props
    }
    await held([{ kind: 'bg', bg: entry.room.bg, t: 'crossfade', ms: TAKE_FADE_MS }, { kind: 'props', props }], [], c.stateHold(diff));
  };

  // -------------------------------------------------------------------------------------------------------------
  // Re-entering the story (X2, F6 step 6, F7 steps 4 and 7)

  const enterKnot = async (knot: KnotName): Promise<void> => {
    const ch = h.chapter();
    const runner = h.runner();
    if (ch === null || runner === null) {
      return;
    }
    // The projection after the world's last write, so the knot's first choices see the outcome.
    const projection = ch.world === null ? {} : project(ch.world, world, new Set<VarName>(ch.meta.vars));
    const entered = runner.enter(knot, projection);
    if (!entered.ok) {
      h.storyError(entered.error);
      return;
    }
    await h.continueStory();
  };

  // -------------------------------------------------------------------------------------------------------------
  // Sections (F7)

  const openSection = async (section: SectionId): Promise<void> => {
    const ch = h.chapter();
    const w = ch?.world ?? null;
    if (ch === null || w === null) {
      h.storyError({ kind: 'load', message: `an explore yield in ${ch?.id ?? 'no chapter'} without a world` });
      return;
    }
    let c = controller;
    if (c === null) {
      // §8.1 point 11: the section's first chunk import is a wait of the views; it ends when the import settles.
      bus.emit(waitCue('waiting', null));
      const [chunk, staged] = await Promise.all([h.chunks.explore(), loadStage()]);
      bus.emit(waitCue('waited', null));
      if (dead || h.chapter() !== ch) {
        return;
      }
      const stageHost = h.stageHost();
      if (!chunk.ok || !staged || stageHost === null) {
        console.error('yields: the explore-ui chunk did not load', chunk.ok ? (staged ? 'no stage host' : 'no cue stage') : chunk.error.detail);
        h.notice(() => openSection(section)); // D13: Retry imports again; the yield stays where it is
        return;
      }
      c = chunk.value.create({ world: w, manifest: ch.assets, scene: h.scene, view: explore, text: h.text, stageHost });
      controller = c;
      layerComponent = chunk.value.layer;
      offs.push(c.onEffect(effect));
      offs.push(
        c.onPath((now) => {
          walkable = now;
          if (!inEvent() && explore.layer !== null) {
            screens.setRootBack(now ? back : null);
          }
        }),
      );
    }
    const entering = c;
    const how = inEvent() ? 'return' : resumed ? 'resume' : 'enter';
    resumed = false;
    // admitSection, or admitEvent while an event knot is pending
    scoped(cause(how === 'return' ? 'return' : 'enter'), () => entering.enter(section, world), how);
    world = c.state();
    await drain();
  };

  // -------------------------------------------------------------------------------------------------------------
  // Puzzles (F6, X8, D18)

  const frameOf = (): PuzzleFrameView | null => puzzle.frame;
  const setFrame = (o: Open, patch: Partial<PuzzleFrameView>): void => {
    const f = puzzle.frame;
    if (open === o && f !== null && f.id === o.id) {
      puzzle.frame = { ...f, ...patch };
    }
  };

  const clearRetry = (): void => {
    if (retryTimer !== null) {
      h.clock.clearTimeout(retryTimer);
      retryTimer = null;
    }
  };

  /** The frame id `frameShown` last reported; null: none on screen. */
  let reported: number | null = null;
  const report = (f: ShownFrame | null): void => {
    if ((f?.id ?? null) !== reported) {
      reported = f?.id ?? null;
      h.frameShown?.(f);
    }
  };

  /**
   * The frame is on screen (engine plan §8.1 point 8): App's frame layer renders the host component, or the failed-host
   * block; before either, the layer is an empty `div`.
   */
  const shownFrame = (): boolean => puzzle.frame !== null && (puzzle.host !== null || puzzle.frame.loadFailed);
  /** The shown-frame test: a cue of `o`'s frame plays only while it is the open, appeared, unhidden frame on screen. */
  const showing = (o: Open): boolean => open === o && !o.hidden && o.appeared && puzzle.frame?.id === o.id;
  /** A frame cue of `o` (no box: the stage finds its target in the frame), dropped while the frame is not shown. */
  const puzzleCue = (o: Open, name: PuzzleCue, index: number | null = null): void => {
    if (showing(o)) {
      bus.emit(cueEvent({ kind: 'puzzle', puzzle: o.local, name, index }, null));
    }
  };
  /**
   * The one writer of `puzzle.ladder` (engine plan §8.1 "The hint ladder"; pinned by `yields: the ladder has one
   * writer`): writes `next`, emits its hold's edge when `busy` turns (`ui-state:waiting` / `waited`, `panel: 'hints'`; a
   * null `next` over a busy ladder is a `waited`, so Back during a request ends the hold), then each `[name, index]` of
   * `cues` as a frame cue of `o` (dropped while the frame is not shown).
   */
  const setLadder = (o: Open | null, next: HintLadderUiView | null, cues: readonly (readonly [LadderCue, number | null])[] = []): void => {
    const was = puzzle.ladder?.busy ?? false;
    puzzle.ladder = next;
    const now = next?.busy ?? false;
    if (now !== was) {
      bus.emit(cueEvent({ kind: 'ui-state', name: now ? 'waiting' : 'waited', panel: 'hints', item: null }, null));
    }
    if (o !== null) {
      for (const [name, index] of cues) {
        puzzleCue(o, name, index);
      }
    }
  };
  /** The shown ladder's alert, kept by a new request until it answers (a repeat Hint, a use's start). */
  const ladderFailed = (): boolean => puzzle.ladder?.failed ?? false;

  /** A `ui-state` cue of the frame's panel (no box: the stage finds the frame, its notice, or the centre). */
  const frameState = (name: 'panel-open' | 'waiting' | 'waited'): CueEvent => cueEvent({ kind: 'ui-state', name, panel: 'puzzle', item: null }, null);

  /**
   * Called after each write that can show `o`'s frame (the frame write, the chunk write): at the first after which it is
   * the open, unhidden frame on screen, the frame's one `panel-open`, then `puzzle:checking` when it shows `busy` (a wait
   * that began before it showed breathes as one that began after), and the host hears it (`frameShown`).
   */
  const appear = (o: Open): void => {
    const f = puzzle.frame;
    if (o.appeared || open !== o || o.hidden || f === null || f.id !== o.id || !shownFrame()) {
      return;
    }
    o.appeared = true;
    bus.emit(frameState('panel-open'));
    if (f.busy) {
      puzzleCue(o, 'checking');
    }
    if (coversStage(f)) {
      report({ id: o.id });
    }
  };

  /**
   * The frame's load hold (engine plan §8.1 point 11), one per open: opened at the frame write and a Retry, ended by the
   * chunk write and `endFrame`, whether or not the frame shows (it plays at the notice, else at the stage centre).
   */
  const holdLoad = (o: Open, on: boolean): void => {
    if (open !== o || o.loading === on) {
      return;
    }
    o.loading = on;
    bus.emit(frameState(on ? 'waiting' : 'waited'));
  };

  /** The one end emission of a frame: its load hold ends first, whatever it shows; then, if it is shown, `cue`. */
  const endFrame = (o: Open, cue: Exclude<DropCue, null>): void => {
    holdLoad(o, false);
    puzzleCue(o, cue);
  };

  /** The close-up fades out and the rooms' neighbours come back, after the batch in flight. */
  const unshowCloseup = (o: Open): void => {
    void h.queue(async () => {
      if (o.closeup) {
        await held([{ kind: 'cg', cg: null, t: 'fade', ms: CLOSEUP_FADE_MS }], [], { box: null });
      }
      controller?.roomShown();
    });
  };

  /**
   * Closes the frame and its overlays and disposes the session, `cue` the frame's end (engine plan §8.1 "Ends"): the end
   * cue, the ladder and its sheet while the frame is still the open one on screen, then the rest.
   */
  const dropPuzzle = (cue: DropCue): void => {
    const o = open;
    if (o === null) {
      clearRetry();
      return;
    }
    if (cue !== null) {
      endFrame(o, cue);
    }
    setLadder(o, null);
    screens.close('hints');
    open = null;
    clearRetry();
    o.session.dispose();
    puzzle.frame = null;
    report(null);
    screens.close('puzzle');
  };

  /**
   * An X8 Back hides the frame at once (engine plan §8.1 "Ends"): its end cue, the ladder, the frame, the close-up. The
   * session stays open until its end, so an attempt in flight still reaches the world when it answers.
   */
  const hideFrame = (o: Open): void => {
    endFrame(o, 'closed');
    setLadder(o, null);
    screens.close('hints');
    puzzle.frame = null;
    report(null);
    o.hidden = true;
    unshowCloseup(o);
  };

  const loadPuzzleUis = async (o: Open, type: PuzzleFrameView['type']): Promise<void> => {
    const [hostUi, typeUi, staged] = await Promise.all([h.chunks.puzzleHost(), h.chunks.puzzleUi(type), loadStage()]);
    if (open !== o) {
      return;
    }
    if (hostUi.ok) {
      puzzle.host = hostUi.value;
    }
    // D13: a chunk error keeps the mode with Retry (linear) or the overlay with Retry (explore); no outcome. The chunk
    // fields only (00-decision-table W1): `busy` and the line are a settling answer's, never a chunk's.
    const loaded = typeUi.ok && hostUi.ok && staged;
    setFrame(o, loaded ? { ui: typeUi.value, loadFailed: false, retrying: false } : { ui: null, loadFailed: true, retrying: false });
    // The wait's end, the frame's appearance (when this write shows it), then the state it ends in.
    holdLoad(o, false);
    appear(o);
    puzzleCue(o, loaded ? 'opened' : 'load-failed');
  };

  /** The end of a run (PZ F6 steps 5-6, F7 step 7): the report, the close-up cleared, the outcome into the world. */
  const ended = async (local: PuzzleLocalId, outcome: PuzzleOutcome, mode: PuzzleMode, then: KnotName | null, closeup: boolean): Promise<void> => {
    const ch = h.chapter();
    if (ch !== null) {
      h.reporter.record({ kind: 'puzzle_ended', chapterId: ch.id, storyVersion: ch.meta.storyVersion, puzzle: local, outcome });
    }
    if (closeup) {
      await held([{ kind: 'cg', cg: null, t: 'fade', ms: CLOSEUP_FADE_MS }], [], { box: null });
      if (dead) {
        return;
      }
    }
    act({ kind: 'puzzle-ended', puzzle: local, outcome });
    if (mode === 'linear' && then !== null) {
      await enterKnot(then);
      return;
    }
    controller?.roomShown(); // D20: the close-up is cleared
    await drain();
  };

  const onEnd = (o: Open, e: PuzzleEnd): void => {
    if (open !== o) {
      return;
    }
    dropPuzzle(e.outcome === 'solved' || e.outcome === 'failed' ? e.outcome : 'closed');
    if (e.outcome === 'closed') {
      // X8: an exploration close records no outcome; the close-up goes, the rooms' neighbours come back (a hidden
      // frame's close-up went at its Back).
      if (!o.hidden) {
        unshowCloseup(o);
      }
      return;
    }
    const outcome = e.outcome;
    void h.queue(() => ended(o.local, outcome, o.mode, o.then, o.closeup && !o.hidden)); // the outcome is on screen
  };

  const openPuzzle = async (local: PuzzleLocalId, mode: PuzzleMode, then: KnotName | null): Promise<void> => {
    const ch = h.chapter();
    const w = ch?.world ?? null;
    const p = w !== null && Object.hasOwn(w.puzzles, local) ? w.puzzles[local] : undefined;
    if (ch === null || w === null || p === undefined) {
      h.storyError({ kind: 'load', message: `puzzle ${local} is not in the world of ${ch?.id ?? 'no chapter'}` });
      return;
    }
    const run = runOf(world, local);
    if (p.maxAttempts !== null && run.attempts >= p.maxAttempts) {
      // D18: a run at its limit is over; the server does not enforce the limit, so no session sends an attempt.
      await ended(local, 'failed', mode, then, false);
      return;
    }
    dropPuzzle('closed'); // at most one session
    const port = h.hints?.() ?? null;
    const made = createPuzzleSession({ api: h.api, hints: port, world: w, chapter: ch.id, puzzle: local, mode, run, lang: () => vm.lang, dispatch: act });
    if (!made.ok) {
      h.storyError({ kind: 'load', message: `puzzle ${made.error.puzzle} has no session` });
      return;
    }
    const o: Open = { session: made.value, port, local, mode, then, closeup: p.closeup !== null, id: ++frameSeq, hidden: false, appeared: false, loading: false, asked: null };
    open = o;
    o.session.onEnd((e) => onEnd(o, e));
    if (p.closeup !== null) {
      await held([{ kind: 'cg', cg: p.closeup, t: 'fade', ms: CLOSEUP_FADE_MS }], [], { box: null });
      if (open !== o) {
        return;
      }
    }
    const frame: PuzzleFrameView = {
      id: o.id,
      mode,
      type: p.type,
      title: h.text(p.title),
      prompt: h.text(p.prompt),
      params: p.params,
      answer: o.session.answer(),
      busy: false,
      line: 'idle',
      attemptsLeft: p.maxAttempts === null ? null : p.maxAttempts - run.attempts,
      retryAfter: null,
      giveUp: p.giveUp,
      hintTiers: p.hintTiers,
      ui: null,
      loadFailed: false,
      retrying: false,
    };
    puzzle.frame = frame;
    appear(o); // shown at its write when the host chunk is in
    holdLoad(o, true);
    const overlay = backScreen(frame);
    if (overlay !== null) {
      screens.push(overlay);
    }
    await loadPuzzleUis(o, p.type);
  };

  /** A 429's countdown (GameSession owns it): one cue per second, its index the seconds left; Try opens again at zero. */
  const countdown = (o: Open, secs: number): void => {
    clearRetry();
    setFrame(o, { line: 'rate-limited', retryAfter: secs, busy: false });
    if (secs <= 0) {
      setFrame(o, { line: 'idle', retryAfter: null });
      puzzleCue(o, 'ready', puzzle.frame?.attemptsLeft ?? null); // nothing to post: the frame takes input again
      return;
    }
    puzzleCue(o, 'rate-limited', secs);
    retryTimer = h.clock.setTimeout(() => {
      retryTimer = null;
      countdown(o, secs - 1);
    }, 1000);
  };

  const attempted = (o: Open, r: Result<AttemptResult, PuzzleError>): void => {
    if (open !== o) {
      return; // the run ended with this answer (solved, failed) or was closed meanwhile
    }
    if (r.ok) {
      // `correct` and `failed` end the session first (its listeners run inside `attempt`), so `open !== o` above: the end
      // cues are `dropPuzzle`'s, through `onEnd`.
      switch (r.value.kind) {
        case 'correct':
          setFrame(o, { busy: false, line: 'solved' });
          return;
        case 'failed':
          setFrame(o, { busy: false, line: 'failed', attemptsLeft: 0 });
          return;
        case 'wrong':
          setFrame(o, { busy: false, line: 'wrong', attemptsLeft: r.value.attemptsLeft });
          puzzleCue(o, 'wrong');
          h.autosave(); // F9: the attempts count survives a reload
          return;
        default: {
          const _never: never = r.value;
          return _never;
        }
      }
    }
    switch (r.error.kind) {
      case 'rate-limited':
        countdown(o, r.error.retryAfterSecs);
        return;
      case 'network':
      case 'not-entitled':
        setFrame(o, { busy: false, line: 'offline' });
        puzzleCue(o, 'offline');
        return;
      case 'busy':
        return; // another attempt is in flight: its own reply settles the frame
      case 'closed':
      case 'invalid':
        // A check that ends with no outcome: the frame takes input again.
        setFrame(o, { busy: false, line: 'idle' });
        puzzleCue(o, 'ready', puzzle.frame?.attemptsLeft ?? null);
        return;
      default: {
        const _never: never = r.error;
        return _never;
      }
    }
  };

  /**
   * The one attempt starter (per-player R-E28): refuses while the frame is busy or a countdown runs; else `busy`,
   * `checking` and `puzzle:checking`, then the attempt, its reply through `attempted`.
   */
  const post = (o: Open): boolean => {
    const f = frameOf();
    if (open !== o || f === null || f.id !== o.id || f.busy || f.retryAfter !== null) {
      return false;
    }
    setFrame(o, { busy: true, line: 'checking' });
    puzzleCue(o, 'checking');
    void o.session.attempt().then((r) => attempted(o, r)); // the session answers with a Result; the frame shows it
    return true;
  };

  const puzzleHost: PuzzleHostCallbacks = {
    item: (id) => {
      const w = h.chapter()?.world ?? null;
      const item = w !== null && Object.hasOwn(w.items, id) ? w.items[id] : undefined;
      return item === undefined ? null : { name: h.text(item.name), glyph: item.glyph };
    },
    onchange: (a) => {
      const o = open;
      if (o !== null) {
        const was = o.session.answer();
        o.session.setAnswer(a);
        const now = o.session.answer();
        setFrame(o, { answer: now });
        // One cue per changed part, in index order.
        for (let i = 0; i < Math.max(was.length, now.length); i += 1) {
          if (was[i] !== now[i]) {
            puzzleCue(o, 'input', i);
          }
        }
      }
    },
    ontry: () => {
      const o = open;
      if (o !== null) {
        post(o);
      }
    },
    ongiveup: () => {
      open?.session.giveUp();
    },
    onhint: () => {
      const o = open;
      if (o === null) {
        return;
      }
      screens.push({ kind: 'hints' });
      if (puzzle.ladder?.busy === true) {
        return; // Q68: a status or a hint use in flight: its answer is the ladder's, so the tap only shows the sheet
      }
      setLadder(o, { ...o.session.ladder(), busy: true, failed: ladderFailed() }); // a repeat tap keeps the alert up
      const asked = o.session.hints();
      if (asked === o.asked) {
        return; // a tap while the status runs shares it: its reader below answers every tap once
      }
      o.asked = asked;
      void asked.then((r) => {
        if (open !== o || puzzle.ladder === null) {
          return; // the puzzle or its ladder was left meanwhile
        }
        if (r.ok) {
          setLadder(o, { ...r.value, busy: false, failed: false }, [['ladder', null]]);
        } else {
          setLadder(o, { ...o.session.ladder(), busy: false, failed: true }, [['hint-failed', null]]);
        }
      }); // the ladder shows the answer
    },
    onretry: () => {
      const o = open;
      const f = frameOf();
      if (o !== null && f !== null && f.loadFailed && !f.retrying) {
        if (puzzle.host === null) {
          // App's failed-host Retry lies outside every cue root, so its control cue is emitted here (found by its name).
          bus.emit(cueEvent({ kind: 'ui', control: 'puzzle-retry', item: null, index: null }, null));
        }
        // The notice stays, its Retry disabled, until the reload answers (engine plan §8.1 "The frame's flags").
        holdLoad(o, true);
        setFrame(o, { retrying: true });
        void loadPuzzleUis(o, f.type); // a second import() (D13); the frame shows the outcome
      }
    },
    onusehint: (tier) => {
      const o = open;
      const state = o?.session.ladder().tiers.find((x) => x.tier === tier)?.state;
      if (o === null || state === undefined) {
        return;
      }
      if (state === 'unlocked') {
        o.session.openHint(tier); // a re-read: the text is in memory, nothing is spent
        // The tier's text is the answer: the alert clears, with the ladder's glint when it was up.
        const cleared: readonly (readonly [LadderCue, number | null])[] = ladderFailed() ? [['ladder', null]] : [];
        setLadder(o, { ...o.session.ladder(), busy: puzzle.ladder?.busy ?? false, failed: false }, [['hint-shown', tier], ...cleared]);
        return;
      }
      if (state !== 'usable' || o.port === null) {
        return;
      }
      setLadder(o, { ...o.session.ladder(), busy: true, failed: ladderFailed() }); // the alert stays until the answer
      void o.session.useHint(tier).then((r) => {
        if (open !== o || puzzle.ladder === null) {
          return; // the puzzle or its ladder was left meanwhile
        }
        if (r.ok) {
          setLadder(o, { ...r.value, busy: false, failed: false }, [
            ['hint-shown', tier],
            ['ladder', null],
          ]);
        } else if (r.error.kind === 'failed') {
          setLadder(o, { ...o.session.ladder(), busy: false, failed: true }, [['hint-failed', tier]]);
        } else if (r.error.kind !== 'busy') {
          // `busy`: another use is in flight, and its answer is the ladder. The rest re-read it (`insufficient` also
          // opens the wallet, whose motion is the meta overlay's).
          setLadder(o, { ...o.session.ladder(), busy: false, failed: false }, [['ladder', null]]);
        }
      }); // the ladder shows the answer
    },
    ongetmore: () => {
      open?.port?.getMore();
    },
    oncue: (e) => {
      bus.emit(inStageHost(e)); // the frame family's controls (engine plan §8.3), on the session's bus
    },
  };

  // -------------------------------------------------------------------------------------------------------------
  // The explore layer (K48)

  const layer: ExploreLayerActions = {
    ontap: (key) => {
      void h.tap(() => dispatchNow({ kind: 'tap', hotspot: key })); // the outcome is on screen
    },
    oninsert: (key, item) => {
      void h.tap(() => dispatchNow({ kind: 'insert', hotspot: key, item })); // the outcome is on screen
    },
    oninventory: () => {
      explore.panel = { kind: 'inventory' };
      screens.push({ kind: 'inventory' });
    },
    onread: (doc) => {
      explore.panel = { kind: 'doc', doc };
      screens.push({ kind: 'document' });
    },
    onreveal: () => {
      if (controller !== null) {
        controller.reveal();
        // The reveal's own cue (§8.1 point 10): no box, the stage plays it over the stage.
        bus.emit(cueEvent({ kind: 'ui-state', name: 'reveal', panel: null, item: null }, null));
      }
    },
    onclose: () => {
      screens.back(); // the overlay's own close is a Back press; screensChanged follows it
    },
    onselect: (item) => {
      // Another item: the old one settles back first; the selected one again: off.
      const again = explore.selected === item;
      deselect();
      if (!again) {
        explore.selected = item;
        bus.emit(selection('select', item));
      }
    },
    ondeselect: deselect,
    onuse: (item, target) => {
      // One block: the selection settles back, then the use's writes and cues (§6.1 "Action").
      void h.tap(async () => {
        deselect();
        await dispatchNow({ kind: 'use', item, target });
      }); // the outcome is on screen
    },
  };

  const disposeController = (): void => {
    for (const off of offs) {
      off();
    }
    offs = [];
    controller?.dispose();
    controller = null;
    walkable = false;
    explore.layer = null;
    explore.panel = null;
    explore.selected = null;
    explore.inView = false;
  };

  return {
    // The step's pictures are loaded: the yield's chunks download while its transition runs (§8.1 "Loading").
    ahead: prefetch,
    async onYield(y) {
      if (dead) {
        return;
      }
      if (y.kind === 'puzzle') {
        await openPuzzle(y.puzzle, 'linear', y.then);
      } else {
        await openSection(y.section);
      }
    },
    lineShown: prefetch,
    world: () => world,
    roomFor(bg) {
      const w = h.chapter()?.world ?? null;
      const rooms = w === null || world.section === null ? [] : [...indexOf(w).rooms].filter(([, e]) => e.section === world.section && e.room.bg === bg).map(([id]) => id);
      const room = rooms.find((id) => id === world.room) ?? rooms[0];
      const props = room === undefined ? null : propsOf(room);
      return props === null ? null : [{ kind: 'props', props }];
    },
    restore(next, reset, at) {
      dropPuzzle('closed');
      jobs.length = 0;
      if (at?.kind !== 'explore') {
        disposeController();
      }
      closePanel();
      explore.layer = null;
      explore.selected = null;
      screens.setRootBack(null);
      world = next;
      shown = null;
      resumed = at?.kind === 'explore';
      if (reset !== null) {
        vm.showToast({ kind: 'note', key: 'area_reset', message: t(vm.lang, 'explore.area_reset'), sticky: false });
      }
      if (at !== null) {
        prefetch(); // no line shows before the resumed yield
      }
    },
    chapterChanged() {
      dropPuzzle('closed');
      disposeController();
      jobs.length = 0;
      world = EMPTY_WORLD_STATE;
      shown = null;
      resumed = false;
      prefetched = false;
      if (dirtyTimer !== null) {
        h.clock.clearTimeout(dirtyTimer);
        dirtyTimer = null;
      }
    },
    rootShown,
    screensChanged(v) {
      const kinds = new Set(v.overlays.map((o) => o.kind));
      const p = explore.panel;
      if (p !== null) {
        const kind = p.kind === 'doc' ? 'document' : p.kind;
        if (!kinds.has(kind)) {
          explore.panel = p.kind === 'doc' && kinds.has('inventory') ? { kind: 'inventory' } : null;
        }
      }
      if (open !== null && open.mode === 'explore' && puzzle.frame?.id === open.id && !kinds.has('puzzle')) {
        // X8: Back closes an exploration puzzle with no outcome: the frame goes at once, the session at its end (deferred
        // while an attempt runs, whose answer still reaches the world).
        const o = open;
        hideFrame(o);
        o.session.close();
      }
      const ladder = puzzle.ladder;
      if (ladder !== null && !kinds.has('hints')) {
        setLadder(open, null);
      } else if (ladder !== null && open !== null) {
        // The wallet's balance, as of now: a pack bought over the ladder shows once the wallet closes, with its glint.
        const next = { ...open.session.ladder(), busy: ladder.busy, failed: ladder.failed };
        const moved = next.wallet?.cost !== ladder.wallet?.cost || next.wallet?.balance !== ladder.wallet?.balance;
        setLadder(open, next, moved ? [['ladder', null]] : []);
      }
      // The panels' own cues (§8.1 point 10), from the stack whoever pushed or popped it: the ones that left close first,
      // then the ones that arrived open, each with no box (the stage finds the panel by its marker). A disposed bus
      // drops them.
      const now = PANEL_KINDS.filter((k) => kinds.has(k));
      const was = panels;
      panels = now;
      for (const k of was.filter((k) => !now.includes(k))) {
        bus.emit(cueEvent({ kind: 'ui-state', name: 'panel-close', panel: k, item: null }, null));
      }
      for (const k of now.filter((k) => !was.includes(k))) {
        bus.emit(cueEvent({ kind: 'ui-state', name: 'panel-open', panel: k, item: null }, null));
      }
    },
    relabel() {
      controller?.relabel();
    },
    disposePuzzle: () => dropPuzzle('closed'),
    dispose() {
      if (dead) {
        return;
      }
      dropPuzzle(null);
      disposeController();
      dead = true;
      jobs.length = 0;
      bus.dispose();
      if (slot !== null && vm.cueStage === slot) {
        vm.cueStage = null;
      }
      if (explore.oncue === exploreCue) {
        explore.oncue = undefined;
      }
      if (dirtyTimer !== null) {
        h.clock.clearTimeout(dirtyTimer);
        dirtyTimer = null;
      }
    },
    presence: () => ({ explore: controller !== null, puzzle: open !== null }),
    layer,
    host: puzzleHost,
  };
}
