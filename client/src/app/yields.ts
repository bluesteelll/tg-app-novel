// The yields (PUZZLES-PLAN F6, F7, F9, F10, X8, X12, X13, X14 and "Modules"; the L15 cut D4, D13, D18, D20,
// K47-K54): GameSession's half that runs what a `yield` step hands over, one per session. A linear puzzle and an
// exploration section are host-owned: the world state lives here (and in the explore controller while a section is
// current), room batches are built here from world data, and the story is re-entered only here, through `project` +
// `runner.enter` (the `runner-enter` arch rule), so ink never reads the rooms and the rooms never read ink
// (principle 7). Every `import()` of the four lazy families is here too (X14): the explore controller with its layer,
// the puzzle host, and the puzzle types through `loadPuzzleUi`.
import type { Component } from 'svelte';

import type { Endpoints } from '../api/endpoints.ts';
import type { Clock } from '../api/http.ts';
import type { AudioCommand } from '../audio/manager.ts';
import type { ExploreController, createExploreController } from '../explore/controller.ts';
import { project } from '../explore/project.ts';
import { runReduce, worldIndex } from '../explore/reduce.ts';
import type { ExploreAction, ExploreEffect } from '../explore/reduce.ts';
import { EMPTY_WORLD_STATE } from '../explore/state.ts';
import type { PuzzleOutcome, PuzzleRun, WorldState } from '../explore/state.ts';
import { t } from '../i18n/index.ts';
import type { AnchorKey } from '../mechanics/contract.ts';
import { loadPuzzleUi } from '../puzzles/registry.ts';
import type { ChunkError } from '../puzzles/registry.ts';
import { createPuzzleSession } from '../puzzles/session.ts';
import type { AttemptResult, HintPort, PuzzleEnd, PuzzleError, PuzzleMode, PuzzleSession } from '../puzzles/session.ts';
import type { SceneController } from '../scene/controller.ts';
import type { VisualCommand } from '../scene/executor.ts';
import type { StatsReporter } from '../stats/reporter.ts';
import type { LoadedChapter, Result } from '../story/catalog.ts';
import type { RunnerError, StoryRunner } from '../story/runner.ts';
import type { KnotName, PropPlacement, PuzzleLocalId, SectionId, StagingSnapshot, VarName, YieldCommand } from '../story/staging.ts';
import type { TelegramClient } from '../telegram/index.ts';
import type { ExploreLayerActions, ExploreLayerProps, ExploreViewStore } from '../ui/explore-view.svelte.ts';
import { backScreen } from '../ui/puzzle-view.svelte.ts';
import type { PuzzleFrameView, PuzzleHostCallbacks, PuzzleHostProps, PuzzleView } from '../ui/puzzle-view.svelte.ts';
import type { Screens, ScreensView } from '../ui/screens.ts';
import type { ViewModel } from '../ui/state.svelte.ts';
import type { Gift, HotspotKey, Room, RoomId, WorldPublic, WorldText } from '../world/types.ts';

/** X12: the door fade of a room batch. */
export const ROOM_FADE_MS = 400;
/** B-001 / X11: a take's prop fades out of the room on screen over this long; the bg already shown stays. */
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
};

/** What GameSession gives its yields: the views, the ports, and its own steps. */
export type YieldsHost = {
  vm: ViewModel;
  screens: Screens;
  tg: Pick<TelegramClient, 'haptic'>;
  api: Pick<Endpoints, 'getPuzzle' | 'postAttempt'>;
  scene: Pick<SceneController, 'preload' | 'releasePreload' | 'snapshot'>;
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
};

export interface Yields {
  /** A `yield` step is on screen, after its batch and its autosave. */
  onYield(y: YieldCommand): Promise<void>;
  /** D13: the chapter's first line is shown: the lazy chunks its world needs are prefetched (not awaited). */
  lineShown(): void;
  /** The world a save body carries now. */
  world(): WorldState;
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
 * X11: the props a room shows, at their hotspot rects, each anchored at its hotspot key (engine plan §5.2, R-A4); a
 * taken `take` is gone from the picture.
 */
function roomProps(room: RoomId, r: Room, s: WorldState): PropPlacement[] {
  const out: PropPlacement[] = [];
  for (const h of r.hotspots) {
    if ((h.kind === 'take' || h.kind === 'object') && h.prop !== null) {
      const key = `${room}.${h.id}`; // reduce.ts `hotspotKey`, the `<room>.<hotspot>` form of an AnchorKey
      const taken = h.kind === 'take' && s.taken.includes(key as HotspotKey);
      if (!taken) {
        out.push({ prop: h.prop, rect: h.rect, at: key as AnchorKey });
      }
    }
  }
  return out;
}

const sameProps = (a: readonly PropPlacement[], b: readonly PropPlacement[]): boolean =>
  a.length === b.length && a.every((p, i) => p.prop === b[i]?.prop && p.rect.every((v, j) => v === b[i]?.rect[j]));

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
};

let frameSeq = 0;

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
  /** The async steps the effects of one dispatch asked for, run in order by the intent that dispatched. */
  const jobs: Array<() => Promise<void>> = [];

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

  // -------------------------------------------------------------------------------------------------------------
  // The root-back (X12, K50, D4)

  const back = (): void => {
    void h.tap(async () => {
      const c = controller;
      if (c === null || !c.back()) {
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

  /** Leaves the rooms for the story: the layer hides, the root-back clears (X12), the knot runs after the drain. */
  const toStory = (knot: KnotName): void => {
    closePanel();
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
      case 'room':
        jobs.push(() => roomBatch(e.room, e.sfx));
        return;
      case 'look':
        vm.showToast({ kind: 'note', key: 'look', message: h.text(e.text), sticky: false });
        return;
      case 'got': {
        h.tg.haptic.notify('success'); // K51
        const name = w === null ? null : giftName(e.gift, w);
        if (name !== null) {
          vm.showToast({ kind: 'note', key: 'got', message: name, sticky: false });
        }
        jobs.push(takeBatch); // B-001: before a `then`'s room or knot job, so the prop goes first
        return;
      }
      case 'lock':
        explore.panel = { kind: 'lock' };
        screens.push({ kind: 'lock' });
        return;
      case 'puzzle':
        jobs.push(() => openPuzzle(e.puzzle, 'explore', null));
        return;
      case 'story':
      case 'leave':
        toStory(e.knot);
        return;
      case 'refused':
        h.tg.haptic.notify('error'); // K51
        return;
      case 'reset':
        vm.showToast({ kind: 'note', key: 'area_reset', message: t(vm.lang, 'explore.area_reset'), sticky: false });
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

  /**
   * One action through the one writer: the controller while a section is current (K53, so an exploration puzzle's
   * results reach the lock), else the kernel's `runReduce` here (a linear puzzle's run, which no section holds). Taps
   * and inserts come only from the explore layer, which exists only with a controller, so nothing else is written here.
   */
  const act = (a: ExploreAction): void => {
    const c = controller;
    if (c !== null && world.section !== null) {
      c.dispatch(a);
      world = c.state();
      followLock();
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
  };

  /** K48: the lock panel closes when the controller's lock view turns null (opened, or another room). */
  const followLock = (): void => {
    if (explore.panel?.kind === 'lock' && explore.lock === null) {
      explore.panel = null;
      screens.close('lock');
    }
  };

  const dispatchNow = async (a: ExploreAction): Promise<void> => {
    act(a);
    await drain();
  };

  // -------------------------------------------------------------------------------------------------------------
  // Room batches (F7 step 1, X11, X12, D20)

  const roomBatch = async (room: RoomId, sfx: Extract<ExploreEffect, { kind: 'room' }>['sfx']): Promise<void> => {
    const ch = h.chapter();
    const w = ch?.world ?? null;
    const entry = w === null ? undefined : indexOf(w).rooms.get(room);
    if (w === null || entry === undefined) {
      return;
    }
    const props = roomProps(room, entry.room, world);
    const stage = h.scene.snapshot();
    const visual: VisualCommand[] =
      stage.bg === entry.room.bg && stage.cg === null && sameProps(stage.props, props)
        ? [] // the stage already shows the room: no fade
        : [{ kind: 'bg', bg: entry.room.bg, t: 'fade', ms: ROOM_FADE_MS }, { kind: 'props', props }];
    const audio: AudioCommand[] = [];
    const music = w.sections[entry.section]?.bgm ?? null;
    if (music !== null && h.bgm()?.track !== music) {
      audio.push({ kind: 'bgm', track: music, fadeMs: SECTION_BGM_FADE_MS, vol: 1 });
    }
    if (sfx !== null) {
      audio.push({ kind: 'sfx', sfx, vol: 1 });
    }
    explore.layer = inEvent() ? null : layerComponent; // an onEnter event hides the rooms it moved into
    await h.apply(visual, audio);
    if (dead) {
      return;
    }
    rootShown(); // the rooms are back: the root-back returns from the path state (X12)
    controller?.roomShown(); // K47 / D20: after the batch, so the registry counts the room before its neighbours
  };

  /**
   * B-001: a take removes its prop from the room on screen at once, not at the next room batch. It is a fade, not a
   * cut (owner Q53: motion wherever the picture changes): a crossfade onto the bg already shown keeps the bg and fades
   * only the props that changed. A `got` that changes no prop (a take without one, an effect's `give`, a room the stage
   * does not show) applies nothing.
   */
  const takeBatch = async (): Promise<void> => {
    const room = world.section !== null ? world.room : null;
    const w = h.chapter()?.world ?? null;
    const entry = w === null || room === null ? undefined : indexOf(w).rooms.get(room);
    if (room === null || entry === undefined) {
      return;
    }
    const stage = h.scene.snapshot();
    if (stage.bg !== entry.room.bg || stage.cg !== null) {
      return; // another picture is up: the room batch that shows the room again draws its props
    }
    const props = roomProps(room, entry.room, world);
    if (sameProps(stage.props, props)) {
      return;
    }
    await h.apply([{ kind: 'bg', bg: entry.room.bg, t: 'crossfade', ms: TAKE_FADE_MS }, { kind: 'props', props }], []);
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
      const chunk = await h.chunks.explore();
      if (dead || h.chapter() !== ch) {
        return;
      }
      const stageHost = h.stageHost();
      if (!chunk.ok || stageHost === null) {
        console.error('yields: the explore-ui chunk did not load', chunk.ok ? 'no stage host' : chunk.error.detail);
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
    c.enter(section, world); // admitSection, or admitEvent while an event knot is pending
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

  /** Closes the frame and its overlays and disposes the session; no outcome (an exit, a chapter change, a load). */
  const dropPuzzle = (): void => {
    const o = open;
    open = null;
    clearRetry();
    if (o === null) {
      return;
    }
    o.session.dispose();
    puzzle.frame = null;
    puzzle.ladder = null;
    screens.close('hints');
    screens.close('puzzle');
  };

  const loadPuzzleUis = async (o: Open, type: PuzzleFrameView['type']): Promise<void> => {
    const [hostUi, typeUi] = await Promise.all([h.chunks.puzzleHost(), h.chunks.puzzleUi(type)]);
    if (open !== o) {
      return;
    }
    if (hostUi.ok) {
      puzzle.host = hostUi.value;
    }
    // D13: a chunk error keeps the mode with Retry (linear) or the overlay with Retry (explore); no outcome.
    setFrame(o, typeUi.ok && hostUi.ok ? { ui: typeUi.value, loadFailed: false } : { ui: null, loadFailed: true });
  };

  /** The end of a run (PZ F6 steps 5-6, F7 step 7): the report, the close-up cleared, the outcome into the world. */
  const ended = async (local: PuzzleLocalId, outcome: PuzzleOutcome, mode: PuzzleMode, then: KnotName | null, closeup: boolean): Promise<void> => {
    const ch = h.chapter();
    if (ch !== null) {
      h.reporter.record({ kind: 'puzzle_ended', chapterId: ch.id, storyVersion: ch.meta.storyVersion, puzzle: local, outcome });
    }
    if (closeup) {
      await h.apply([{ kind: 'cg', cg: null, t: 'fade', ms: CLOSEUP_FADE_MS }], []);
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
    dropPuzzle();
    if (e.outcome === 'closed') {
      // X8: an exploration close records no outcome; the close-up goes, the rooms' neighbours come back.
      void h.queue(async () => {
        if (o.closeup) {
          await h.apply([{ kind: 'cg', cg: null, t: 'fade', ms: CLOSEUP_FADE_MS }], []);
        }
        controller?.roomShown();
      });
      return;
    }
    const outcome = e.outcome;
    void h.queue(() => ended(o.local, outcome, o.mode, o.then, o.closeup)); // the outcome is on screen
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
    dropPuzzle(); // at most one session
    const port = h.hints?.() ?? null;
    const made = createPuzzleSession({ api: h.api, hints: port, world: w, chapter: ch.id, puzzle: local, mode, run, lang: () => vm.lang, dispatch: act });
    if (!made.ok) {
      h.storyError({ kind: 'load', message: `puzzle ${made.error.puzzle} has no session` });
      return;
    }
    const o: Open = { session: made.value, port, local, mode, then, closeup: p.closeup !== null, id: ++frameSeq };
    open = o;
    o.session.onEnd((e) => onEnd(o, e));
    if (p.closeup !== null) {
      await h.apply([{ kind: 'cg', cg: p.closeup, t: 'fade', ms: CLOSEUP_FADE_MS }], []);
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
    const overlay = backScreen(frame);
    if (overlay !== null) {
      screens.push(overlay);
    }
    await loadPuzzleUis(o, p.type);
  };

  /** A 429's countdown (GameSession owns it): Try opens again at zero. */
  const countdown = (o: Open, secs: number): void => {
    clearRetry();
    setFrame(o, { line: 'rate-limited', retryAfter: secs, busy: false });
    if (secs <= 0) {
      setFrame(o, { line: 'idle', retryAfter: null });
      return;
    }
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
      switch (r.value.kind) {
        case 'correct':
          setFrame(o, { busy: false, line: 'solved' });
          return;
        case 'failed':
          setFrame(o, { busy: false, line: 'failed', attemptsLeft: 0 });
          return;
        case 'wrong':
          setFrame(o, { busy: false, line: 'wrong', attemptsLeft: r.value.attemptsLeft });
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
        return;
      case 'busy':
      case 'closed':
      case 'invalid':
        setFrame(o, { busy: false });
        return;
      default: {
        const _never: never = r.error;
        return _never;
      }
    }
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
        o.session.setAnswer(a);
        setFrame(o, { answer: o.session.answer() });
      }
    },
    ontry: () => {
      const o = open;
      const f = frameOf();
      if (o === null || f === null || f.busy || f.retryAfter !== null) {
        return;
      }
      setFrame(o, { busy: true, line: 'checking' });
      void o.session.attempt().then((r) => attempted(o, r)); // the session answers with a Result; the frame shows it
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
      puzzle.ladder = { ...o.session.ladder(), busy: true, failed: false };
      void o.session.hints().then((r) => {
        if (open === o) {
          puzzle.ladder = r.ok ? { ...r.value, busy: false, failed: false } : { ...o.session.ladder(), busy: false, failed: true };
        }
      }); // the ladder shows the answer
    },
    onretry: () => {
      const o = open;
      const f = frameOf();
      if (o !== null && f !== null && f.loadFailed) {
        setFrame(o, { loadFailed: false });
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
        puzzle.ladder = { ...o.session.ladder(), busy: false, failed: false };
        return;
      }
      if (state !== 'usable' || o.port === null) {
        return;
      }
      puzzle.ladder = { ...o.session.ladder(), busy: true, failed: false };
      void o.session.useHint(tier).then((r) => {
        if (open !== o || puzzle.ladder === null) {
          return; // the puzzle or its ladder was left meanwhile
        }
        if (r.ok) {
          puzzle.ladder = { ...r.value, busy: false, failed: false };
        } else if (r.error.kind !== 'busy') {
          // `busy`: another use is in flight, and its answer is the ladder.
          puzzle.ladder = { ...o.session.ladder(), busy: false, failed: r.error.kind === 'failed' };
        }
      }); // the ladder shows the answer
    },
    ongetmore: () => {
      open?.port?.getMore();
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
      controller?.reveal();
    },
    onclose: () => {
      screens.back(); // the overlay's own close is a Back press; screensChanged follows it
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
  };

  return {
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
    lineShown() {
      const w = prefetched ? null : (h.chapter()?.world ?? null);
      if (w === null) {
        return;
      }
      prefetched = true;
      // D13: after the first line, so these bytes never compete with the first knot's images; the module cache keeps
      // them for the yield. Not awaited: a failure surfaces at the yield, which imports again.
      if (Object.keys(w.sections).length > 0) {
        void h.chunks.explore();
      }
      if (Object.keys(w.puzzles).length > 0) {
        void h.chunks.puzzleHost();
      }
    },
    world: () => world,
    restore(next, reset, at) {
      dropPuzzle();
      jobs.length = 0;
      if (at?.kind !== 'explore') {
        disposeController();
      }
      closePanel();
      explore.layer = null;
      screens.setRootBack(null);
      world = next;
      if (reset !== null) {
        vm.showToast({ kind: 'note', key: 'area_reset', message: t(vm.lang, 'explore.area_reset'), sticky: false });
      }
    },
    chapterChanged() {
      dropPuzzle();
      disposeController();
      jobs.length = 0;
      world = EMPTY_WORLD_STATE;
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
        open.session.close(); // X8: Back closes an exploration puzzle with no outcome (deferred while an attempt runs)
      }
      const ladder = puzzle.ladder;
      if (ladder !== null && !kinds.has('hints')) {
        puzzle.ladder = null;
      } else if (ladder !== null && open !== null) {
        // The wallet's balance, as of now: a pack bought over the ladder shows once the wallet closes.
        puzzle.ladder = { ...open.session.ladder(), busy: ladder.busy, failed: ladder.failed };
      }
    },
    relabel() {
      controller?.relabel();
    },
    disposePuzzle: dropPuzzle,
    dispose() {
      if (dead) {
        return;
      }
      dropPuzzle();
      disposeController();
      dead = true;
      jobs.length = 0;
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
