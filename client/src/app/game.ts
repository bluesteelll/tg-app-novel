// The game session (PROTOTYPE-PLAN "app/game.ts", F2-F5; STORIES-PLAN "Module API", Y7, Y14; META-PLAN M1): one Game
// for the page's life, one story per session. It turns runner steps into staging batches for the scene and the audio,
// views for the overlay and autosaves for the server (principle 7: the scene only ever sees staging commands), and it
// owns every per-session resource: the runner, the SaveService and the timers. One intent runs at a time (F2): a tap
// while a batch is in flight completes the transition, a choice is ignored, a load or an exit waits for it.
// It lives in the engine chunk; scene/, audio/ and explore/ are reached through their types only (tests pass fakes);
// the purchase flow is import()ed at the paywall (lever P), the in-play overlays after the first line's reveal and at a
// Menu or Backlog tap before it (lever O5).
import type { Endpoints } from '../api/endpoints.ts';
import type { ProductDto, SaveListResponse, SaveSlot, SaveSummary } from '../api/generated/api.ts';
import type { ApiError, Clock } from '../api/http.ts';
import type { AudioManager } from '../audio/manager.ts';
import { EMPTY_WORLD_STATE } from '../explore/state.ts';
import { t } from '../i18n/index.ts';
import type { Lang } from '../i18n/index.ts';
import { createLineText } from '../i18n/lines.ts';
import type { LineText } from '../i18n/lines.ts';
import type { PurchaseFlow, PurchaseState } from '../purchase/flow.ts';
import type { HintPort } from '../puzzles/session.ts';
import type { ManualSlot, SaveError, SaveService, SaveState, SaveWrite } from '../saves/service.ts';
import { summaryOf } from '../saves/summary.ts';
import type { SceneController } from '../scene/controller.ts';
import type { VisualCommand } from '../scene/executor.ts';
import { KEEP_WINDOW } from '../scene/preload.ts';
import type { StageWindow } from '../scene/preload.ts';
import type { SceneError } from '../scene/registry.ts';
import type { Settings, SettingsStore } from '../settings/store.ts';
import type { StatsReporter } from '../stats/reporter.ts';
import { carryInto, carryOut } from '../story/carry.ts';
import type { ChapterLoader, ChapterLoadError } from '../story/chapters.ts';
import type { ChapterCatalog, FetchAsset, InkScalar, LoadedChapter, Result, StoryEntry, StoryId } from '../story/catalog.ts';
import { resume } from '../story/resume.ts';
import type { ResumeError, ResumeLevel } from '../story/resume.ts';
import { liveRunners, StoryRunner } from '../story/runner.ts';
import type { RunnerError, RunnerStep } from '../story/runner.ts';
import { BACKLOG_MAX, SAVE_FORMAT, decodeSave, encodeSave } from '../story/save-codec.ts';
import type { BacklogEntry, SaveBody } from '../story/save-codec.ts';
import { EMPTY_SNAPSHOT } from '../story/staging.ts';
import type {
  AssetIndex,
  ChapterId,
  KnotName,
  LineId,
  ProductId,
  SpeakerId,
  StagingSnapshot,
  TagError,
  VarName,
} from '../story/staging.ts';
import type { Lifecycle, TelegramClient } from '../telegram/index.ts';
import type { BacklogLine } from '../ui/overlays/Backlog.svelte';
import { forwardLayer } from '../ui/explore-view.svelte.ts';
import type { ExploreLayerActions, ExploreViewStore } from '../ui/explore-view.svelte.ts';
import type { NoticeView } from '../ui/Notice.svelte';
import type { SlotView } from '../ui/overlays/SaveLoad.svelte';
import { forwardHost } from '../ui/puzzle-view.svelte.ts';
import type { PuzzleHostCallbacks, PuzzleView } from '../ui/puzzle-view.svelte.ts';
import type { Screens, ScreensView } from '../ui/screens.ts';
import type { ChoiceSet, LineView, OverlayUi, PlayMode, ViewModel } from '../ui/state.svelte.ts';
import { graphemes, GRAPHEMES_PER_SECOND } from '../ui/typewriter.ts';
import { latched, metaHold, PURCHASE_OPEN, RELOAD_POLL_MS, RELOADED_FOR, withLatch } from './reload.ts';
import { imageIds, knotAssets, lookOf, manifestIndex, roomWindowKey, splitBatch, windowFor, withRoomProps } from './stage-route.ts';
import type { WorldAt } from './stage-route.ts';
import { createYields, LAZY_CHUNKS } from './yields.ts';
import type { LazyChunks, Yields, YieldsHost } from './yields.ts';

/** What a session starts from: a chapter of the story from its start, or a save slot of the story. */
export type StartFrom = { kind: 'new'; story: StoryId; chapter: ChapterId } | { kind: 'slot'; story: StoryId; slot: SaveSlot };

/** Why a start did not reach its first step; every one but the two refusals also shows a notice. */
export type GameError =
  | { kind: 'unknown-story'; story: StoryId }
  /** STORIES-PLAN Y14: a chapter that is not on the story's chain. */
  | { kind: 'chapter-outside-story'; story: StoryId; chapter: ChapterId }
  /** A session runs or is starting. */
  | { kind: 'busy' }
  | { kind: 'saves'; error: ApiError }
  | { kind: 'empty-slot'; slot: SaveSlot }
  | { kind: 'unreadable-save'; detail: string }
  | { kind: 'chapter'; error: ChapterLoadError }
  | { kind: 'scene'; error: SceneError }
  | { kind: 'story'; error: ResumeError | RunnerError };

/** The server's products as boot read them; `list()` is null while unread or after a failed read. */
export interface Entitlements {
  list(): readonly ProductDto[] | null;
  /** `GET /api/entitlements` again (after a purchase, a paywall's Retry); the list follows a success. */
  refresh(): Promise<Result<readonly ProductDto[], ApiError>>;
}

/** What boot lends the Game for a build-skew reload (LBI D6): the page's URL and its reload; tests pass fakes. */
export type ReloadPort = { href(): string; reload(url: string): void };

/** Why a build-skew recovery waits (LBI D5 step 2), in the order they are checked. */
export type ReloadBlocker = 'intent' | 'background' | 'purchase' | 'attempt' | 'save' | 'gift';

/** `href`'s part before the fragment and the fragment's `&`-separated params, byte for byte. */
function fragmentParams(href: string): { base: string; params: string[] } {
  const at = href.indexOf('#');
  const fragment = at < 0 ? '' : href.slice(at + 1);
  return { base: at < 0 ? href : href.slice(0, at), params: fragment === '' ? [] : fragment.split('&') };
}

const isLatch = (param: string): boolean => param === RELOADED_FOR || param.startsWith(`${RELOADED_FOR}=`);

/**
 * LBI D6: the build id this tab reloaded for, from `href`'s fragment, or null. The fragment survives
 * `location.reload()` and needs no web storage; a Mini App opened again gets a fresh URL without it.
 */
export function reloadedFor(href: string): string | null {
  const param = fragmentParams(href).params.find(isLatch);
  if (param === undefined) {
    return null;
  }
  const value = param.slice(RELOADED_FOR.length + 1);
  try {
    return decodeURIComponent(value);
  } catch {
    return value; // not written by withReloadedFor: compared as it stands
  }
}

/** `href` with the latch set to `served`: every other fragment param byte for byte, an existing latch replaced in place. */
export function withReloadedFor(href: string, served: string): string {
  const { base, params } = fragmentParams(href);
  const latch = `${RELOADED_FOR}=${encodeURIComponent(served)}`;
  const at = params.findIndex(isLatch);
  const next = at < 0 ? [...params, latch] : params.flatMap((p, i) => (i === at ? [latch] : isLatch(p) ? [] : [p]));
  return `${base}#${next.join('&')}`;
}

/** The purchase flow's chunk (lever P): reached by `import()` only, so the engine chunk does not carry it. */
type PurchaseModule = Pick<typeof import('../purchase/flow.ts'), 'createPurchaseFlow' | 'chapterDelivered'>;

/** The Game's collaborators; the engine wires the real ones (app/engine.ts), the tests fakes. */
export type GameDeps = {
  vm: ViewModel;
  screens: Screens;
  /** `perfClass` picks the render resolution (lever F); a facade without it renders as 'AVERAGE' (telegram/perf.ts). */
  tg: Pick<TelegramClient, 'haptic' | 'setClosingConfirmation' | 'openInvoice' | 'close'> & Partial<Pick<TelegramClient, 'perfClass'>>;
  api: Pick<Endpoints, 'listSaves' | 'createInvoice' | 'getOrder' | 'getEntitlements' | 'getPuzzle' | 'postAttempt'>;
  catalog: ChapterCatalog;
  entitlements: Entitlements;
  /** The saves list a session starts from: boot's own list once, then a fresh `GET /api/saves`. */
  saveList: () => Promise<Result<SaveListResponse, ApiError>>;
  /** One SaveService per session (STORIES-PLAN Y7). */
  saves: (story: StoryId) => SaveService;
  settings: SettingsStore;
  reporter: Pick<StatsReporter, 'record' | 'flush'>;
  clock: Clock;
  scene: SceneController;
  /** The audio manager, created on first use: its context comes from the Start tap's unlock (F1 step 6). */
  audio: () => AudioManager;
  /** `unlockAudio()`: synchronously inside a tap. */
  unlock: () => void;
  /** One loader per role (story/chapters.ts): the current chapter, F5's next chapter, a language switch. */
  loaders: { current: ChapterLoader; next: ChapterLoader; en: ChapterLoader };
  fetchAsset: FetchAsset;
  /** The device pixel ratio the scene mounts at. */
  dpr: () => number;
  /** The account's language (K29), used while the settings name none. */
  accountLang: Lang;
  /** The session ended for Home (exitToStories). */
  onExit: () => void;
  /** The two lazy views' stores App renders (app/yields.ts writes them). */
  explore: ExploreViewStore;
  puzzle: PuzzleView;
  /** The lazy families' loaders; the tests pass their own. */
  chunks?: LazyChunks;
  /** The purchase flow's loader (lever P): the paywall prefetches it, Buy waits for it; the tests pass their own. */
  loadPurchase?: () => Promise<PurchaseModule>;
  /**
   * Lever O5: the in-play overlays' module: the first revealed line prefetches it, a Menu or Backlog tap waits for it;
   * the tests pass their own.
   */
  loadOverlayUi?: () => Promise<OverlayUi>;
};

/**
 * The meta controller's side of a session (META-PLAN M27, F16; RULINGS 105): boot's gate, which reads the controller
 * when called, so the session runs the same before and after the controller's chunk lands.
 */
export type GameMeta = {
  /** A declared ending was reached (F16): the stats settle, then the card over the end; never rejects. */
  onEnding(story: StoryId): Promise<void>;
  /** The puzzle session's hint port (M21), or null for none; boot's gate forwards to the controller's (LFL HP). */
  hintPort(): HintPort | null;
  /**
   * A step is on screen (a line, choices, a yield or the end), or D11's paywall over the empty stage, which no step
   * follows: the controller's chunk is requested once (LFL T1).
   */
  stepShown(): void;
  /** A line was revealed: the meta overlays' chunk is fetched once. */
  lineShown(): void;
  /** The session leaves: no meta answer of before pushes an overlay. */
  closeOverlays(): void;
};

/** The Game the overlay drives. Each method that starts an intent resolves once that intent is done. */
export interface Game {
  /** Starts a session of `from.story` (F1 steps 7-9); one session at a time. */
  start(from: StartFrom): Promise<Result<void, GameError>>;
  /** The Stage element (its `onhost`): the scene mounts into it at the first start. */
  attachStage(host: HTMLElement | null): void;
  /** A tap on the play surface: completes a transition in flight, else the next step (the empty stage's tap opens a
   * pending paid start's paywall again: D11, Q64). */
  advance(): Promise<void>;
  /** A pick from the shown choice set; ignored while busy. */
  choose(index: number): Promise<void>;
  setMode(m: PlayMode): void;
  /** The dialogue box revealed the whole line (its `ondone`). */
  lineShown(): void;
  /** Any tap on the game root, in the capture phase (D12): resumes sound that needs a gesture. */
  gesture(): void;
  /**
   * Lever O5: with the overlays module in, at once; before it lands, once it lands if the screens stack did not change
   * since the call (so the first of several waiting opens wins); a failed load opens nothing, with a note if the stack
   * did not change.
   */
  openMenu(): void;
  /** As openMenu; the backlog's lines are those of the moment it opens. */
  openBacklog(): void;
  /** As openMenu. */
  openSettings(): void;
  /** As openMenu; resolves after its open and slot refresh, or after the drop or the note. */
  openSaves(): Promise<void>;
  openTerms(): void;
  save(slot: ManualSlot): Promise<void>;
  /** The conflict ask's Yes: overwrite another device's save in `slot`. */
  overwrite(slot: ManualSlot): Promise<void>;
  cancelOverwrite(): void;
  /** Single-shot per presentation; waits for a batch in flight. */
  load(slot: SaveSlot): Promise<void>;
  setSettings(next: Settings): void;
  onLifecycle(e: Lifecycle): void;
  /** `pagehide`: the autosave as a keepalive PUT. */
  pagehide(): void;
  /**
   * The paywall's Buy (P2): the purchase flow of the paywall's chapter; the server's reads unlock it, never this. It
   * waits for the purchase module only when the paywall's prefetch has not landed (lever P).
   */
  buy(): void;
  /** The paywall's Check again (P7: `delayed`, or a sheet whose close was lost). */
  checkAgain(): void;
  /** The paywall's Retry after a failed price read (P1); a chapter the server lists owned unlocks (P9). */
  retryPrice(): Promise<void>;
  /** D17: a locked chapter row: the paywall over the current root; the unlock starts the chapter. */
  offerChapter(story: StoryId, chapter: ChapterId): void;
  /** STORIES-PLAN "Module API": every session resource in its order, then Home; single-shot, after a batch in flight. */
  exitToStories(): Promise<void>;
  /** The screens stack changed (boot's `onView`): the explore panels and an exploration puzzle follow it. */
  screensChanged(v: ScreensView): void;
  /** Boot's meta port, attached before the game is published; a game without one shows no card and no hint port. */
  attachMeta(m: GameMeta): void;
  /**
   * LBI D5: the server now serves build `served`, not this page's. At the next safe point (no intent, not in the
   * background, no invoice the player is looking at open or being confirmed, no attempt awaiting its answer, no manual
   * save or gift in flight)
   * the step on screen is autosaved, the update notice covers every control, and `page` reloads into the new build
   * once the autosave is flushed. One recovery per page; none for a build this tab already reloaded for (D6).
   */
  skewed(served: string, page: ReloadPort): void;
  /**
   * Q60: a lazy load failed again after the evidence that the network and the server deliver it (boot's recovery). At
   * the next safe point, as `skewed`: the autosave, the restart notice, the flush, then `page` reloads with `latch`
   * appended (`withLatch`). A no-op when `page` already carries `latch`, when any recovery is pending (one per page), or
   * after dispose.
   */
  restart(latch: string, page: ReloadPort): void;
  /** The explore layer's callbacks, for the current session's yields. */
  readonly exploreActions: ExploreLayerActions;
  /** The puzzle host's callbacks, for the current session's yields. */
  readonly puzzleActions: PuzzleHostCallbacks;
  dispose(): void;
}

/** F2 auto mode: after a line is revealed, wait this plus AUTO_PER_GRAPHEME_MS per grapheme (normal speed). */
export const AUTO_BASE_MS = 1200;
export const AUTO_PER_GRAPHEME_MS = 40;
/** F2 skip mode: one read line per this many ms, so the player sees it run and can stop it. */
export const SKIP_STEP_MS = 80;
/** The sound chip's toast key. */
const SOUND_CHIP = 'sound';
/** F3 step 4's prompt: another device's save paused the autosave lane. */
const CONFLICT_PROMPT = 'save_conflict';
/** P7: the failed-payment note. */
const PURCHASE_TOAST = 'purchase';
/** SP "Module API": how long the exit waits for the autosave before the service's pending cache keeps it. */
export const EXIT_FLUSH_MS = 2000;
/**
 * K31 (L15b review OQ1): a manual save's 409 asks "Overwrite?" no sooner than this after the tap that sent it. The
 * conflict ask's Yes renders where the overwrite ask's Yes was, so the second tap of a double tap would overwrite
 * another device's save unseen; until then `saving` keeps every write control disabled. AOSP's DOUBLE_TAP_TIMEOUT
 * (300 ms, from the first tap's up to the second's down) plus the second press's down to click.
 */
export const CONFLICT_HOLD_MS = 500;
/** LBI D6: the fragment parameter recording the build id this tab reloaded for (Q60: one definition, app/reload.ts). */
export { RELOADED_FOR } from './reload.ts';
/** LBI D4: the server's answer to this names the build it serves; the probe after a chapter file failed to load. */
const BUILD_PROBE_URL = '/api/health';
/** Every holder family the session requests besides the stage: knot preloads, F5, the explore rooms. */
const EXIT_RELEASES: readonly string[] = ['preload:', 'next:', 'room:'];
const IDLE: PurchaseState = Object.freeze({ kind: 'idle' });
/** The story-update note of a resume below the level it asked for (W2 b); a later one replaces it. */
const RESUME_TOAST = 'resume';
/** The dev banner of a dropped tag (D10); `__TG_MOCK__` builds only. */
const TAG_ERROR_TOAST = '__novelDebug:tag-error';

const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
const err = <E>(error: E): Result<never, E> => ({ ok: false, error });
const DONE: Promise<void> = Promise.resolve();
const NO_AT: SaveBody['at'] = Object.freeze({ lineId: null, knot: null, yield: null });
const MANUAL_SLOTS: readonly SaveSlot[] = ['auto', 's1', 's2', 's3'];

/** One session's state: everything here dies with the session (exitToStories, a failed start, dispose). */
type Session = {
  readonly story: StoryEntry;
  readonly saves: SaveService;
  /** The autosave lane's state subscription (W1). */
  offSaves: () => void;
  /** Aborts the session's blocking loads when it ends. */
  readonly abort: AbortController;
  ch: LoadedChapter | null;
  assets: AssetIndex;
  lines: LineText;
  runner: StoryRunner | null;
  /** The values carried INTO the current chapter. */
  carry: Record<VarName, InkScalar>;
  checkpoint: SaveBody['checkpoint'];
  backlog: BacklogEntry[];
  /** The ru text of every choice shown this session, for the backlog's "your choice". */
  readonly choiceText: Map<LineId, string>;
  at: SaveBody['at'];
  /**
   * The session may describe two steps at once: the runner, the chapter, the world or the stage has moved and
   * `present` has not yet set the position (an `end` step never does). Set at every move, cleared by `present`.
   */
  torn: boolean;
  /** The step on screen. */
  step: RunnerStep | null;
  /** The last line shown: it stays on screen above a choice set. */
  shown: Extract<RunnerStep, { kind: 'line' }> | null;
  /** The body of the last autosave, or of the save this session last resumed: "Return to last save" resumes it. */
  last: SaveBody | null;
  /**
   * W1 "Load it": the player chose the other device's autosave. The service's lane is open over their rev from that
   * tap on, so nothing of this session is written until a body loaded from the server has resumed (principle 1).
   */
  adopting: boolean;
  /**
   * D-slot (RULINGS 101): each manual slot's latest 409, with the server's envelope. `asked` is null while its hold
   * lasts, then the ask's order number: the ask shown is the slot asked first among these (`shownAsk`), so a later ask
   * never displaces it. A No or an answer applies to its own slot only.
   */
  readonly conflicts: Map<ManualSlot, { readonly current: SaveSummary; readonly asked: number | null }>;
  /** The knots of the current chapter whose `preload:<knot>` holder this session requested (F2 steps 3-4). */
  readonly held: Set<KnotName>;
  /** F5's `next:<id>` holder while it is wanted (requested, or its chapter still loading); null once released. */
  nextTag: string | null;
  /** F5's next chapter, kept for F4 step 4 so it is fetched once. */
  kept: { id: ChapterId; loaded: Promise<Result<LoadedChapter, ChapterLoadError>> } | null;
  /** The new chapter's first knot, whose entry turns `next:<id>` into `preload:<knot>` (F4 step 4, F2 step 1). */
  handover: KnotName | null;
  /** D11: the saved start of a paid chapter the player does not own; the paywall's chapter. */
  pending: SaveBody | null;
  /** D10: the runtime errors of the current chapter, which walk "Return to last save" down the resume levels. */
  inkErrors: number;
  /** The yields of this session: the world, the explore controller, the open puzzle (PZ "Resource lifetime"). */
  readonly yields: Yields;
  /**
   * Shots §5.8 "Entry at the half tier": `'entered'` by enterChapter, `'first'` from the next `present` (the entry's
   * first step, its restore included before it), `'none'` from its first windowed stage, the next `present` or a resume
   * inside the chapter. While not `'none'` the stages and the restore load previews.
   */
  entry: 'entered' | 'first' | 'none';
};

/**
 * The paywall's purchase: its chapter, its flow once Buy ran, and the story a pre-session unlock starts (D17);
 * `waiting` while a Buy waits for the purchase module (lever P).
 */
type Offer = {
  readonly chapter: ChapterId;
  readonly product: ProductId | null;
  readonly start: StoryId | null;
  flow: PurchaseFlow | null;
  waiting: boolean;
};

/**
 * LBI D5: a recovery waiting for its safe point, reloading through boot's port: a skew's latch is the build to reload
 * into, a chunk restart's (Q60) the page's own build marked `chunk:`.
 */
type Recovery = { readonly kind: 'skew' | 'chunk'; readonly latch: string; readonly page: ReloadPort };

type DebugHook = {
  stats(): unknown;
  lineId(): LineId | null;
  /** No argument: `'restorable'` (perf e2e); `'hard'`: the loss nothing restores (memory e2e). */
  forceContextLoss(mode?: 'restorable' | 'hard'): void;
  propRects(): ReturnType<SceneController['debugPropRects']>;
};

export function createGame(deps: GameDeps): Game {
  const { vm, screens, tg, catalog, settings, reporter, clock, scene, loaders } = deps;
  let session: Session | null = null;
  /** The intent in progress (F2 single intent queue); it never rejects. */
  let busy: Promise<void> | null = null;
  let host: HTMLElement | null = null;
  let hostWaiters: Array<(h: HTMLElement) => void> = [];
  const chunks = deps.chunks ?? LAZY_CHUNKS;
  const loadPurchase = deps.loadPurchase ?? (() => import('../purchase/flow.ts'));
  const loadOverlayUi = deps.loadOverlayUi ?? (() => import('../ui/overlays/index.ts'));
  let mounted: Promise<Result<void, SceneError>> | null = null;
  let sound: AudioManager | null = null;
  let autoTimer: number | null = null;
  let skipTimer: number | null = null;
  /**
   * Each manual slot's conflict ask held for CONFLICT_HOLD_MS; one is cleared when it fires and by its slot's next
   * answer, No or write, and every one when the session or the screen goes.
   */
  const conflictHolds = new Map<ManualSlot, number>();
  /** The order of the conflict asks: the next ask's number. */
  let askSeq = 0;
  /** The shown line is fully revealed (its `ondone` came). */
  let revealed = false;
  /** Between `deactivated` and `activated`; a Game made in the background is told `deactivated` by boot (E6). */
  let paused = false;
  /** An auto advance was pending at `deactivated`: it is scheduled again at `activated`. */
  let autoHeld = false;
  let loading = false;
  let disposed = false;
  let exiting = false;
  let choiceSetId = 0;
  let offer: Offer | null = null;
  /**
   * Lever P: the purchase module once it loaded, and its one load, in flight or done, for the page's life (the module
   * is code, not session state); a failed load is cleared, so the next Buy imports again.
   */
  let purchase: PurchaseModule | null = null;
  let purchaseLoad: Promise<PurchaseModule | null> | null = null;
  /**
   * Lever O5: any overlays load was attempted, the prefetch's or a tap's, so the first line's prefetch runs at most
   * once and never after a tap's load (a failed load is retried only by a tap: no automatic second import of the URL).
   */
  let overlaysAsked = false;
  /** Lever O5: the overlays module's one load, in flight or done; a failed load is cleared. */
  let overlayLoad: Promise<OverlayUi | null> | null = null;
  let meta: GameMeta | null = null;
  /**
   * An autosave asked for from outside the intent queue that has to wait (`waits`); it is written as soon as it no
   * longer has to, at the latest when the intent ends.
   */
  let deferred: { s: Session; keepalive: boolean } | null = null;
  /** LBI D5 (Q60: or a chunk restart): the recovery waiting for its safe point (one per page), and its poll timer. */
  let recovery: Recovery | null = null;
  let reloadTimer: number | null = null;
  /** LBI D5 'attempt': the puzzle attempts sent through the yields and not yet answered. */
  let attemptsInFlight = 0;

  // -------------------------------------------------------------------------------------------------------------
  // Intents

  /**
   * Runs `fn` as the one intent; it starts in a microtask, after `busy` names it. A throw (a bug) reaches the caller
   * through the returned promise; `busy` itself always settles.
   */
  const run = <T>(fn: () => Promise<T>): Promise<T> => {
    const p = Promise.resolve().then(fn);
    const clear = (): void => {
      if (busy === tracked) {
        busy = null;
        flushDeferred();
      }
    };
    const tracked: Promise<void> = p.then(clear, clear);
    busy = tracked;
    return p;
  };
  /** Waits for the intent in progress, then runs `fn` as the next one. */
  const after = async <T>(fn: () => Promise<T>): Promise<T> => {
    while (busy !== null) {
      await busy;
    }
    return run(fn);
  };

  // -------------------------------------------------------------------------------------------------------------
  // Views

  const titleOf = (ch: ChapterId): string => {
    const entry = catalog.chapters.find((c) => c.id === ch);
    return entry === undefined ? ch : entry.title[vm.lang];
  };
  const speakerName = (id: SpeakerId | null): string | null => {
    if (id === null || !Object.hasOwn(catalog.cast, id)) {
      return null;
    }
    return catalog.cast[id]?.name[vm.lang] ?? null;
  };
  const lineView = (s: Session, step: Extract<RunnerStep, { kind: 'line' }>): LineView => ({
    lineId: step.lineId,
    speaker: speakerName(step.speaker),
    text: s.lines.text(step.lineId, step.ru, vm.lang),
  });
  const choiceSet = (s: Session, step: Extract<RunnerStep, { kind: 'choices' }>): ChoiceSet => ({
    id: ++choiceSetId,
    options: step.choices.map((c) => ({ index: c.index, lineId: c.lineId, text: s.lines.text(c.lineId, c.ru, vm.lang) })),
  });
  const backlogLines = (s: Session): BacklogLine[] =>
    s.backlog.map((e) => {
      const chosenRu = e.chosen === undefined ? undefined : s.choiceText.get(e.chosen);
      return {
        lineId: e.lineId,
        speaker: speakerName(e.speaker),
        text: s.lines.text(e.lineId, e.ru, vm.lang),
        chosen: e.chosen === undefined || chosenRu === undefined ? null : s.lines.text(e.chosen, chosenRu, vm.lang),
      };
    });
  /** The views on screen again, in the current language. */
  const relabel = (s: Session): void => {
    if (s.shown !== null && vm.line !== null) {
      vm.line = lineView(s, s.shown);
    }
    if (s.step?.kind === 'choices' && vm.choices !== null) {
      vm.choices = choiceSet(s, s.step);
    }
    vm.backlog = backlogLines(s);
    s.yields.relabel(); // K49
  };

  const showNotice = (n: NoticeView): void => {
    vm.notice = n;
    screens.setRoot({ kind: 'notice' });
    tg.setClosingConfirmation(false);
  };

  const tagError = (errors: readonly TagError[]): void => {
    // F2: production drops the bad command and goes on; the dev build also shows the banner (D10).
    console.warn('story: tag dropped', errors);
    if (__TG_MOCK__) {
      vm.showToast({ kind: 'dev', key: TAG_ERROR_TOAST, message: errors.map((e) => `${e.tag}: ${e.reason}`).join('; ') });
    }
  };

  // -------------------------------------------------------------------------------------------------------------
  // Audio and timers

  const audioOnce = (): AudioManager => {
    if (sound === null) {
      const a = deps.audio();
      sound = a;
      a.setVolumes(settings.current().volume);
      a.onNeedsGesture((needed) => {
        if (needed) {
          vm.showToast({ kind: 'chip', key: SOUND_CHIP, message: t(vm.lang, 'toast.sound_resume'), tap: () => game.gesture() });
        } else {
          vm.dismissToast(SOUND_CHIP);
        }
      });
      if (paused) {
        // E6 (critique W1): made in the background (the Start's tap unlocked the context), it starts as a manager
        // that existed at `deactivated`: suspended until `activated` resumes it.
        a.suspend();
      }
    }
    return sound;
  };

  const clearAuto = (): void => {
    if (autoTimer !== null) {
      clock.clearTimeout(autoTimer);
      autoTimer = null;
    }
  };
  const clearSkip = (): void => {
    if (skipTimer !== null) {
      clock.clearTimeout(skipTimer);
      skipTimer = null;
    }
  };
  /** One slot's held conflict ask, or with no slot every one. */
  const clearHold = (slot?: ManualSlot): void => {
    for (const [held, id] of conflictHolds) {
      if (slot === undefined || held === slot) {
        clock.clearTimeout(id);
        conflictHolds.delete(held);
      }
    }
  };
  /** D-slot: the ask shown is the earliest asked of the slots still asking. */
  const shownAsk = (s: Session): ManualSlot | null => {
    let shown: { slot: ManualSlot; asked: number } | null = null;
    for (const [slot, c] of s.conflicts) {
      if (c.asked !== null && (shown === null || c.asked < shown.asked)) {
        shown = { slot, asked: c.asked };
      }
    }
    return shown?.slot ?? null;
  };
  /** A slot's conflict is over: its hold and its entry go; no other slot's. */
  const dropConflict = (s: Session, slot: ManualSlot): void => {
    clearHold(slot);
    s.conflicts.delete(slot);
  };
  /** F2 auto: `1200 + 40 × graphemes` ms at normal speed, scaled by the text speed. */
  const autoDelay = (text: string): number => {
    const speed = vm.speed === 'instant' ? 'fast' : vm.speed;
    const scale = GRAPHEMES_PER_SECOND.normal / GRAPHEMES_PER_SECOND[speed];
    return Math.round((AUTO_BASE_MS + AUTO_PER_GRAPHEME_MS * graphemes(text).length) * scale);
  };
  const scheduleAuto = (): void => {
    clearAuto();
    const line = vm.line;
    if (vm.mode !== 'auto' || paused || !revealed || line === null || session?.step?.kind !== 'line') {
      return;
    }
    autoTimer = clock.setTimeout(() => {
      autoTimer = null;
      void game.advance(); // a timer has no caller; the intent reports through the views
    }, autoDelay(line.text));
  };

  // -------------------------------------------------------------------------------------------------------------
  // Saves

  const stagingNow = (): StagingSnapshot => ({ ...scene.snapshot(), bgm: sound?.currentBgm() ?? null });

  /** The body an autosave or a manual save writes now; null when no chapter is running. */
  const bodyOf = (s: Session): SaveBody | null => {
    if (s.pending !== null) {
      return s.pending;
    }
    const ch = s.ch;
    const runner = s.runner;
    if (ch === null || runner === null) {
      return null;
    }
    return {
      format: SAVE_FORMAT,
      chapterId: ch.id,
      storyVersion: ch.meta.storyVersion,
      ink: runner.inkState(),
      at: s.at,
      staging: stagingNow(),
      checkpoint: s.checkpoint,
      chapterStart: { carry: { ...s.carry }, items: [] },
      backlog: s.backlog.slice(-BACKLOG_MAX),
      world: worldOf(s),
      worldVersion: ch.world?.version ?? null,
    };
  };
  const writeOf = (b: SaveBody): SaveWrite => ({ chapterId: b.chapterId, storyVersion: b.storyVersion, lineId: b.at.lineId, body: encodeSave(b) });

  /**
   * `bodyOf` would compose a body of two steps: the session is `torn` and its fields are what it composes from. A
   * pending start is one complete body (D11 read it from the server, or `pendingPaid` wrote it), so it never mixes.
   */
  const mixes = (s: Session): boolean => s.torn && s.pending === null;

  /**
   * F3 / D9: the autosave of the current state; the read-sets flush at the same points. A session that `mixes` writes
   * nothing (fix_r2 KL4): a resume that failed past `enterChapter` leaves the new chapter over the old runner at rest.
   */
  const autosave = (s: Session, o?: { keepalive?: boolean }): void => {
    const body = s.adopting || mixes(s) ? null : bodyOf(s);
    if (body === null) {
      return;
    }
    s.last = body;
    s.saves.autosave(writeOf(body), o);
    void settings.flush(); // never rejects; a failed write is not an error (settings/store.ts)
  };

  /**
   * An intent is past a move of the session and before its `present` (the runner and the backlog at the next step,
   * the position, the checkpoint and the stage still at the last), whose body would resume a level lower as a false
   * story update; or "Load it" holds every write until their save has resumed, and a request kept until then is
   * written of their save. While a pending start is the body nothing waits (fix_r2 KL2): it is complete as it is.
   */
  const waits = (s: Session): boolean => s.adopting || mixes(s);

  /**
   * The autosave of `deactivated`, `pagehide` and the yields' timers, which run outside the intent queue. It is
   * written at once, with its keepalive, unless an intent runs and the session `waits`: then it is kept, and written
   * when the step is on screen (a deactivated holds a batch's transitions, and with them the intent's end, until
   * activated) or when the intent ends.
   */
  const autosaveOutside = (s: Session, keepalive: boolean): void => {
    if (busy !== null && waits(s)) {
      deferred = { s, keepalive: keepalive || (deferred?.s === s && deferred.keepalive) };
      return;
    }
    autosave(s, { keepalive });
  };
  const flushDeferred = (): void => {
    const d = deferred;
    if (d === null || (busy !== null && waits(d.s))) {
      return;
    }
    deferred = null;
    if (session === d.s) {
      autosave(d.s, { keepalive: d.keepalive });
    }
  };

  // -------------------------------------------------------------------------------------------------------------
  // The world (PUZZLES-PLAN; yields.ts from C6)

  const worldOf = (s: Session): SaveBody['world'] => s.yields.world();

  // -------------------------------------------------------------------------------------------------------------
  // Steps

  /**
   * Applies a visual batch after its blocking loads; resolves with the batch's own end (transitions, wait). `window`:
   * the step's preload window, wanted at the batch's swap point (shots §5.8); none keeps the previous one.
   */
  const stage = async (s: Session, visual: readonly VisualCommand[], instant: boolean, window?: StageWindow): Promise<{ done: Promise<void> }> => {
    const preview = s.entry !== 'none';
    const ids = imageIds(visual, { stage: scene.snapshot(), manifest: s.ch?.assets ?? null });
    if (ids.length > 0) {
      // F1 step 9: an asset that fails to load is skipped by the scene, and the story goes on.
      await scene.ensure(ids, s.abort.signal, { preview });
    }
    // An entry's windowless stage hands the keep window, so its swap upgrades the previews (shots §5.8 step 3); the
    // first windowed stage ends the entry.
    const done = scene.apply(visual, { instant, window: window ?? (preview ? KEEP_WINDOW : undefined), preview });
    if (window !== undefined) {
      s.entry = 'none';
    }
    return { done };
  };

  /** The world's section and room, which a step's window reads (an event's room) and a room batch keys on. */
  const worldAt = (s: Session): WorldAt => {
    const w = s.yields.world();
    return { section: w.section, room: w.room };
  };

  /**
   * A presented step's window (shots §5.8, D1): a line by its ID, a choice set by its first choice's ID, else the knot's
   * index; inside a room event with the room as `eventRoom`. A yield step hands none, so the previous window stays
   * through it (D13).
   */
  const windowOf = (s: Session, ch: LoadedChapter, step: RunnerStep): StageWindow | undefined => {
    switch (step.kind) {
      case 'line':
        return windowFor(ch.assets, step.lineId, step.knot, worldAt(s));
      case 'choices':
        return windowFor(ch.assets, step.choices[0]?.lineId ?? null, step.knot, worldAt(s));
      case 'yield':
        return undefined;
      case 'end':
        return windowFor(ch.assets, null, null, worldAt(s));
      default: {
        const _never: never = step;
        return _never;
      }
    }
  };

  /** A room batch's window (shots §5.8 "At each room batch"): its room's, while a section is current; else none. */
  const roomWindow = (s: Session, visual: readonly VisualCommand[]): StageWindow | undefined => {
    const m = s.ch?.assets ?? null;
    const look = m === null ? null : lookOf(m);
    if (look === null || !look.ok) {
      return undefined;
    }
    const at = worldAt(s);
    const key = roomWindowKey(visual, at, look.value);
    return key === null ? undefined : windowFor(m, key, null, at);
  };

  /** D8: one displayed step, its batch, its view, the knot entry and its autosave. */
  const present = async (s: Session, step: RunnerStep): Promise<void> => {
    const ch = s.ch;
    if (ch === null) {
      return;
    }
    // The first step after a chapter entry keeps the entry; any later step ends it (shots §5.8 step 1).
    s.entry = s.entry === 'entered' ? 'first' : 'none';
    const instant = vm.mode === 'skip';
    const before = stagingNow();
    const batch = splitBatch(step.commands);
    // W8: a cut to a room's shot inside its section shows the room's props from the world.
    const visual = withRoomProps(batch.visual, (bg) => s.yields.roomFor(bg));
    let wasRead = false;
    if (step.kind === 'line') {
      wasRead = settings.isRead(ch.id, step.lineId);
      settings.markRead(ch.id, step.lineId);
      s.backlog.push({ lineId: step.lineId, speaker: step.speaker, ru: step.ru });
      if (s.backlog.length > BACKLOG_MAX) {
        s.backlog.splice(0, s.backlog.length - BACKLOG_MAX);
      }
    }
    const shown = await stage(s, visual, instant, windowOf(s, ch, step));
    if (session !== s) {
      return;
    }
    audioOnce().apply(batch.audio, { instant }); // once per batch, the empty one included (L12)
    s.step = step;
    switch (step.kind) {
      case 'line':
        revealed = false;
        s.shown = step;
        s.at = { lineId: step.lineId, knot: step.knot, yield: null };
        vm.line = lineView(s, step);
        vm.choices = null;
        break;
      case 'choices':
        s.at = { lineId: null, knot: step.knot, yield: null };
        for (const c of step.choices) {
          s.choiceText.set(c.lineId, c.ru);
        }
        vm.choices = choiceSet(s, step);
        break;
      case 'yield':
        s.at = { lineId: null, knot: step.knot, yield: step.yield };
        s.yields.ahead(step.yield);
        break;
      case 'end':
        break;
      default: {
        const _never: never = step;
        return _never;
      }
    }
    // LFL T1: only now, with the step's batch loaded and its view set, so nothing before it shares the link with the
    // meta controller's chunk (RULINGS 149).
    meta?.stepShown();
    if (step.kind !== 'end') {
      s.torn = false; // the stage, the position and (below, in the same turn) the checkpoint are this step's
    }
    if (step.kind !== 'end' && step.enteredKnot) {
      s.checkpoint = { knot: step.knot, vars: s.runner?.checkpointVars() ?? {}, staging: before };
      enterKnot(s, ch, step.knot);
      autosave(s);
    } else if (step.kind === 'choices' || step.kind === 'yield') {
      autosave(s);
    }
    flushDeferred(); // the session describes this step alone now: a request that waited for it is written
    await shown.done;
    if (session !== s) {
      return;
    }
    if (step.kind === 'end') {
      await chapterEnd(s, ch);
      return;
    }
    if (step.kind === 'yield') {
      await s.yields.onYield(step.yield);
      return;
    }
    if (step.kind === 'line' && vm.mode === 'skip') {
      if (wasRead || settings.current().skipUnread) {
        skipTimer = clock.setTimeout(() => {
          skipTimer = null;
          void game.advance(); // a timer has no caller; the intent reports through the views
        }, SKIP_STEP_MS);
      } else {
        vm.mode = 'normal'; // F2: skip stops at an unread line
      }
    } else if (step.kind === 'choices' && vm.mode === 'skip') {
      vm.mode = 'normal'; // and at a choice
    }
  };

  /** The runner's answer: a step to show, a dropped tag (the step without it), or the story-error notice. */
  const handle = async (s: Session, r: Result<RunnerStep, RunnerError>): Promise<void> => {
    s.torn = true; // `r` is the runner's `next()`, called in this same turn: the runner is at the next step
    if (r.ok) {
      return present(s, r.value);
    }
    if (r.error.kind === 'tags') {
      tagError(r.error.errors);
      const shown = s.runner?.current() ?? null;
      return shown === null ? undefined : present(s, shown);
    }
    storyError(s, r.error);
  };

  const next = async (s: Session): Promise<void> => {
    clearAuto();
    clearSkip();
    if (s.pending !== null) {
      openPaywall(s.pending.chapterId, null); // D11: the tap after Back closed the paywall opens it again
      return;
    }
    const runner = s.runner;
    // A choice set waits for its pick, a yield for the host; next() would hand the same step back.
    if (runner === null || s.step?.kind === 'choices' || s.step?.kind === 'yield' || s.step?.kind === 'end') {
      return;
    }
    await handle(s, runner.next());
  };

  /** F2 runtime errors: the story-error screen, whose action returns to the last save. */
  const storyError = (s: Session, e: RunnerError): void => {
    console.error('story: runtime error', e);
    s.inkErrors += 1;
    s.runner?.dispose();
    s.runner = null;
    showNotice({ kind: 'story_error', onaction: () => void after(() => returnToSave(s)) });
  };

  /**
   * "Return to last save": the last autosave or the save this session resumed (LFU1 cut Q3), one level lower per error
   * in this chapter (D10): the first from its checkpoint, every later one from the chapter start, so a knot that keeps
   * failing cannot loop. With neither (a new game's first step) it exits to the stories (triage r1 M1): the server's
   * copy stays, and Home's Continue is the retry (RULINGS 93).
   */
  const returnToSave = async (s: Session): Promise<void> => {
    if (session !== s) {
      return;
    }
    const body = s.last;
    if (body === null) {
      void game.exitToStories(); // queued after this intent; Home is its outcome
      return;
    }
    screens.setRoot({ kind: 'game' });
    tg.setClosingConfirmation(true);
    s.yields.rootShown(); // D4: setRoot cleared the root-back
    await resumeBody(s, body, s.inkErrors > 1 ? 'chapter-start' : 'checkpoint');
  };

  // -------------------------------------------------------------------------------------------------------------
  // Chapters and resumes

  const chapterEntry = (id: ChapterId): ChapterCatalog['chapters'][number] | null => catalog.chapters.find((c) => c.id === id) ?? null;

  const loadChapter = (id: ChapterId): Promise<Result<LoadedChapter, ChapterLoadError>> => {
    const entry = chapterEntry(id);
    if (entry === null) {
      return Promise.resolve(err({ kind: 'not-found' }));
    }
    return loaders.current.load({ id, paid: entry.paid }, { withEn: vm.lang === 'en' });
  };

  /** A paid chapter is the player's only by the server's entitlement list (principle 1); a free one always is. */
  const owns = (c: ChapterCatalog['chapters'][number]): boolean =>
    !c.paid || (deps.entitlements.list()?.some((p) => p.chapterId === c.id && p.owned) ?? false);
  const priceOf = (id: ChapterId): number | null => deps.entitlements.list()?.find((p) => p.chapterId === id)?.priceStars ?? null;

  /**
   * The chapter becomes the session's: its manifest resolves the scene's and the audio's ids, its table the lines, and
   * its read-set loads from CloudStorage (W2 a), merging the marks made meanwhile, so the flushes write it. `clear` is
   * F4 step 4's order: the scene's chapter, the empty stage (every `scene:*` holder of the old chapter), the audio's.
   */
  const enterChapter = async (s: Session, ch: LoadedChapter, clear: boolean): Promise<void> => {
    s.torn = true; // the chapter and the world change here; the runner and the position follow
    s.entry = 'entered'; // its first step and the restore before it load previews (shots §5.8 step 1)
    s.yields.chapterChanged(); // D11 / PZ F10: the puzzle session, then the controller; the world starts empty
    s.ch = ch;
    s.assets = manifestIndex(ch.assets);
    s.lines = createLineText(ch.en);
    s.held.clear(); // setChapter releases every preload:* holder
    s.inkErrors = 0;
    void settings.loadRead(ch.id); // never rejects; a failed read keeps the chapter memory-only (settings/store.ts)
    scene.setChapter(ch.assets);
    if (clear) {
      await scene.restore(EMPTY_SNAPSHOT);
      if (session !== s) {
        return;
      }
    }
    audioOnce().setChapter(ch.assets);
  };

  /** A fresh runner of `ch` with the carry (a `fresh` start point: `chapter_started`, SP F2), and its first step. */
  const beginChapter = async (
    s: Session,
    ch: LoadedChapter,
    carry: Readonly<Record<VarName, InkScalar>>,
    clear: boolean,
  ): Promise<Result<void, GameError>> => {
    await enterChapter(s, ch, clear);
    if (session !== s) {
      return err({ kind: 'busy' });
    }
    const into = carryInto(carry, ch.meta);
    const made = StoryRunner.create(ch, { kind: 'fresh', carry: into }, s.assets);
    if (!made.ok) {
      storyError(s, made.error);
      return err({ kind: 'story', error: made.error });
    }
    s.runner?.dispose();
    s.runner = made.value;
    s.carry = into;
    s.checkpoint = null;
    s.at = NO_AT;
    s.step = null;
    s.shown = null;
    s.pending = null;
    vm.stageTap = false;
    reporter.record({ kind: 'chapter_started', chapterId: ch.id, storyVersion: ch.meta.storyVersion });
    await handle(s, made.value.next());
    return ok(undefined);
  };

  /** F5 cancelled: another save is resumed (PP F5 "Release"); the kept chapter is dropped. */
  const dropNext = (s: Session): void => {
    if (s.nextTag !== null || s.handover !== null) {
      scene.releasePreload('next:');
    }
    s.nextTag = null;
    s.handover = null;
    s.kept = null;
    loaders.next.cancel();
  };

  /** A save body back into the session (F3 step 6): its chapter, a runner at the level resume reaches, its stage. */
  const resumeBody = async (s: Session, body: SaveBody, minLevel?: ResumeLevel): Promise<Result<void, GameError>> => {
    dropNext(s);
    let ch = s.ch !== null && s.ch.id === body.chapterId ? s.ch : null;
    if (ch === null) {
      const loaded = await loadChapter(body.chapterId);
      if (session !== s) {
        return err({ kind: 'busy' });
      }
      if (!loaded.ok) {
        if (loaded.error.kind === 'not-entitled') {
          // D11: the saved start of a chapter still not owned, or a save inside a chapter refunded since (the server
          // answered 403, so nothing was delivered); the paywall again, over an empty stage, the body kept whole.
          s.torn = true; // the stage empties under the last step
          await scene.restore(EMPTY_SNAPSHOT);
          audioOnce().restore(null);
          if (session !== s) {
            return err({ kind: 'busy' });
          }
          vm.line = null;
          vm.choices = null;
          s.step = null;
          s.shown = null;
          s.yields.restore(EMPTY_WORLD_STATE, null, null); // no rooms under the paywall; a body's world returns with its resume
          pendingPaid(s, body, false);
          // LFL T1 (fix_r1 I1): this paywall is the session's first screen and no step follows it, so the controller's
          // chunk is asked for here as at a step; its Terms -> policy link and the Menu's meta taps run on the first tap.
          meta?.stepShown();
          return ok(undefined);
        }
        return chapterFailed(s, loaded.error);
      }
      ch = loaded.value;
      await enterChapter(s, ch, false);
      if (session !== s) {
        return err({ kind: 'busy' });
      }
    } else {
      s.entry = 'none'; // a resume inside the current chapter is no entry: it loads the full tier
    }
    const r = resume(body, ch, s.assets, minLevel === undefined ? {} : { minLevel });
    if (!r.ok) {
      showNotice({ kind: 'error', onaction: () => void game.exitToStories() });
      return err({ kind: 'story', error: r.error });
    }
    const resumed = r.value;
    s.torn = true; // the body's world, runner and fields come in here; its stage and its first step follow
    s.yields.restore(resumed.world, resumed.reset, resumed.first.kind === 'yield' ? resumed.first.yield : null);
    s.runner?.dispose();
    s.runner = resumed.runner;
    s.carry = { ...body.chapterStart.carry };
    s.checkpoint = body.checkpoint;
    s.backlog = [...body.backlog];
    s.last = body; // the server's copy this session now runs from; an autosave during `present` replaces it
    s.at = NO_AT;
    s.step = null;
    s.shown = null;
    s.pending = null;
    vm.stageTap = false;
    vm.line = null;
    vm.choices = null;
    if (vm.paywall !== null) {
      vm.paywall = null;
      screens.close('paywall');
    }
    // D12: the audio's chapter is set (enterChapter) before its restore.
    await scene.restore(resumed.staging, { preview: s.entry !== 'none' });
    audioOnce().restore(resumed.staging.bgm);
    if (session !== s) {
      return err({ kind: 'busy' });
    }
    if (resumed.level === 'chapter-start') {
      // Resume steps 2 and 5 start the chapter from a `fresh` point; exact and checkpoint resumes report nothing.
      reporter.record({ kind: 'chapter_started', chapterId: ch.id, storyVersion: ch.meta.storyVersion });
    }
    if (resumed.storyUpdated) {
      // A story update moved the player back: say from where (the error floor's lower levels are asked, never noted).
      const key = resumed.level === 'chapter-start' ? 'toast.resume_chapter_start' : 'toast.resume_checkpoint';
      vm.showToast({ kind: 'note', key: RESUME_TOAST, message: t(vm.lang, key), sticky: false });
    }
    await present(s, resumed.first);
    return ok(undefined);
  };

  // -------------------------------------------------------------------------------------------------------------
  // Knots, the next chapter and the chapter end (PP F2 steps 1-5, F4, F5; SP F2 addition, F4′)

  /**
   * Requests `preload:<k>` for knot `k` of `ch` once: its images in the scene, its sfx in the audio. With a decoding
   * `look` the windows ask for the bg, CG and prop files, so the knot keeps its sprites (never appearances) only (L3).
   */
  const hold = (s: Session, ch: LoadedChapter, k: KnotName): void => {
    if (s.held.has(k) || !Object.hasOwn(ch.meta.knots, k)) {
      return;
    }
    const { images, sounds } = knotAssets(ch.meta.knots[k]?.assets ?? []);
    const kept = lookOf(ch.assets).ok ? images.filter((id) => id.startsWith('char/')) : images;
    if (kept.length > 0) {
      scene.preload(`preload:${k}`, kept);
    }
    if (sounds.length > 0) {
      audioOnce().preload(sounds);
    }
    s.held.add(k);
  };

  /** F5: a free or owned next chapter is loaded once (kept for F4 step 4) and its first knot's art is preloaded. */
  const preloadNext = (s: Session, ch: LoadedChapter): void => {
    const id = chapterEntry(ch.id)?.next ?? null;
    const entry = id === null ? null : chapterEntry(id);
    if (entry === null || !owns(entry)) {
      return;
    }
    const tag = `next:${entry.id}`;
    s.nextTag = tag;
    if (s.kept?.id !== entry.id) {
      s.kept = { id: entry.id, loaded: loaders.next.load({ id: entry.id, paid: entry.paid }, { withEn: vm.lang === 'en' }) };
    }
    const kept = s.kept;
    // A background request: the loader answers with a Result, never a rejection; F4 step 4 awaits the same promise.
    void kept.loaded.then((r) => {
      if (session !== s || s.kept !== kept || s.nextTag !== tag) {
        return; // the player left the ending knot, loaded another save, or left the story meanwhile
      }
      if (!r.ok) {
        s.kept = null; // F4 step 4 loads it again and reports its error there
        return;
      }
      const next = r.value;
      const { images, sounds } = knotAssets(next.meta.knots[next.meta.firstKnot]?.assets ?? []);
      // D6: with a decoding look, the first knot's index window (need, warm, then hope, each id once) and its sprites;
      // else its images. The ids resolve in the next chapter's manifest: art only that chapter uses loads too.
      const w = windowFor(next.assets, null, next.meta.firstKnot, null);
      const ids = lookOf(next.assets).ok ? [...new Set([...w.need, ...w.warm, ...w.hope, ...images.filter((id) => id.startsWith('char/'))])] : images;
      scene.preload(tag, ids, next.assets);
      audioOnce().preload(sounds, next.assets);
    });
  };

  /** F2 steps 1-5 at the entry of knot `k`, between its checkpoint and its autosave. */
  const enterKnot = (s: Session, ch: LoadedChapter, k: KnotName): void => {
    const knot = Object.hasOwn(ch.meta.knots, k) ? ch.meta.knots[k] : undefined;
    if (knot === undefined) {
      return;
    }
    if (s.handover === k) {
      // 1. The new chapter's first knot: its art, resident under next:<id>, is held under the chapter's own tag. The
      // entry tag itself ends at the chapter's first window, once its files were joined (shots §5.8 step 1c).
      s.handover = null;
      hold(s, ch, k);
    }
    if (!knot.ending && (s.nextTag !== null || s.handover !== null)) {
      // 2. The story goes on in this chapter: the next chapter's art does not stay live; the kept chapter stays.
      scene.releasePreload('next:');
      s.nextTag = null;
      s.handover = null;
    }
    // 3. Preloads of knots no longer in {k} ∪ next(k).
    const keep = new Set<KnotName>([k, ...knot.next]);
    for (const held of [...s.held]) {
      if (!keep.has(held)) {
        scene.releasePreload(`preload:${held}`);
        s.held.delete(held);
      }
    }
    // 4. After 2-3, so the bytes they freed count toward the cap.
    for (const n of knot.next) {
      hold(s, ch, n);
    }
    if (!knot.ending) {
      return;
    }
    // 5. F5, unless k is a declared story ending (SP F2 addition): that reports the ending, flushed at once.
    const ending = Object.hasOwn(ch.meta.endings, k) ? ch.meta.endings[k] : undefined;
    if (ending === undefined) {
      preloadNext(s, ch);
      return;
    }
    reporter.record({ kind: 'ending_reached', chapterId: ch.id, storyVersion: ch.meta.storyVersion, ending });
    reporter.flush();
  };

  /** The offer's flow dies with it: its timers, its late answers (P2-P8). */
  const closeOffer = (): void => {
    const o = offer;
    offer = null;
    o?.flow?.dispose();
  };

  /**
   * Lever P: the purchase module, one load per page (meta.ts's shape). A failure is logged and the load cleared, so
   * the next call imports again; the player's note is Buy's, never the prefetch's.
   */
  const purchaseModule = (): Promise<PurchaseModule | null> => {
    purchaseLoad ??= loadPurchase().then(
      (m) => {
        purchase = m;
        return m;
      },
      (e: unknown) => {
        console.error('game: the purchase module did not load', e);
        purchaseLoad = null;
        return null;
      },
    );
    return purchaseLoad;
  };

  /**
   * Lever O5: the overlays module, one load per page (purchaseModule's shape). It is in `vm.overlayUi` before any
   * caller's reaction runs. A failure is logged and the load cleared, so the next tap imports again; the player's note
   * is the tap's, never the prefetch's.
   */
  const overlayUiModule = (): Promise<OverlayUi | null> => {
    overlaysAsked = true;
    overlayLoad ??= loadOverlayUi().then(
      (m) => {
        vm.overlayUi = m;
        return m;
      },
      (e: unknown) => {
        console.error('game: the overlays module did not load', e);
        overlayLoad = null;
        return null;
      },
    );
    return overlayLoad;
  };

  /**
   * Lever O5: `open` with the overlays module in, in the same tick; else once it lands, unless the Game is gone or the
   * screens stack changed since the call (any push, close or root freezes a new view: the earliest current tap wins,
   * and no overlay lands over a stack the player has left), with a note if the load failed.
   */
  const withOverlays = (open: () => void | Promise<void>): Promise<void> => {
    if (vm.overlayUi !== null) {
      return Promise.resolve(open());
    }
    const at = screens.view();
    return overlayUiModule().then((m) => {
      if (disposed || screens.view() !== at) {
        return;
      }
      if (m === null) {
        // boot's meta-gate note (its key too): a failed meta tap and a failed overlay tap show one note
        vm.showToast({ kind: 'note', key: 'meta.action_failed', message: t(vm.lang, 'meta.action_failed'), sticky: false });
        return;
      }
      return open();
    });
  };

  /** The paywall of `id`; an open offer of the same chapter keeps its flow, so a re-open shows its state. */
  const openPaywall = (id: ChapterId, start: StoryId | null): void => {
    let o = offer;
    if (o === null || o.chapter !== id || o.start !== start) {
      closeOffer();
      o = { chapter: id, product: chapterEntry(id)?.productId ?? null, start, flow: null, waiting: false };
      offer = o;
    }
    vm.paywall = { chapter: titleOf(id), priceStars: priceOf(id), state: o.flow?.state() ?? IDLE };
    screens.push({ kind: 'paywall' });
    if (o.product !== null) {
      // Lever P: the module loads while the paywall is read, so Buy waits for it only when this has not landed.
      void purchaseModule(); // never rejects
    }
  };

  /** Buy with the module in: one flow per offer, and a flow made in the background starts paused (lever P D6). */
  const startPurchase = (o: Offer, p: ProductId, m: PurchaseModule): void => {
    const made = o.flow === null;
    o.flow ??= m.createPurchaseFlow({
      api: deps.api,
      tg,
      clock,
      isDelivered: m.chapterDelivered(deps.api),
      onState: (st) => purchaseState(o, st),
    });
    if (made && paused) {
      o.flow.onDeactivated(); // its `activated` arms the window and the poll; until then it holds still
    }
    o.flow.buy(p);
  };

  /**
   * P9 / F4 step 4: the chapter now owned starts from its saved start, with the carry it saved. A save inside it (its
   * ink kept: refunded since) resumes as saved; `resumeBody` loads the chapter itself, so a refund in between reaches
   * D11's paywall again.
   */
  const startPending = async (s: Session): Promise<void> => {
    const body = s.pending;
    if (session !== s || body === null) {
      return;
    }
    if (body.ink !== null) {
      await resumeBody(s, body); // its failures show their own notices
      return;
    }
    const loaded = await loadChapter(body.chapterId);
    if (session !== s) {
      return;
    }
    if (!loaded.ok) {
      if (loaded.error.kind === 'not-entitled') {
        vm.stageTap = true; // the pending start waits again; `unlocked` withdrew the tap
        openPaywall(body.chapterId, null); // P9: refunded in between; the server wins
        return;
      }
      chapterFailed(s, loaded.error);
      return;
    }
    await beginChapter(s, loaded.value, body.chapterStart.carry, true);
  };

  /** P8-P9: the server delivered the chapter: the list follows, the paywall closes, the chapter starts. */
  const unlocked = async (o: Offer, refreshed: boolean): Promise<void> => {
    if (!refreshed) {
      await deps.entitlements.refresh(); // F5 and the chapter rows read the list; a failed read changes nothing here
    }
    if (offer !== o) {
      return;
    }
    closeOffer();
    vm.paywall = null;
    vm.stageTap = false; // the purchase landed: no tap reopens the paywall while the chapter loads
    screens.close('paywall');
    if (o.start !== null) {
      await game.start({ kind: 'new', story: o.start, chapter: o.chapter }); // its failures show their notices
      return;
    }
    const s = session;
    if (s !== null && s.pending?.chapterId === o.chapter) {
      await after(() => startPending(s));
    }
  };

  const purchaseState = (o: Offer, st: PurchaseState): void => {
    if (offer !== o) {
      return;
    }
    if (vm.paywall !== null) {
      vm.paywall = { ...vm.paywall, state: st };
    }
    if (st.kind === 'failed' && st.reason === 'failed') {
      vm.showToast({ kind: 'note', key: PURCHASE_TOAST, message: t(vm.lang, 'toast.purchase_failed'), sticky: false });
    } else if (st.kind === 'unlocked') {
      void unlocked(o, false); // the outcome is on screen: the chapter, or the paywall again
    }
  };

  /**
   * D11 / F4 step 3: the chapter's start is the save (`ink: null`), or a save inside a chapter refunded since (its ink
   * kept, resumed as saved after a purchase), and the paywall opens over the game.
   */
  const pendingPaid = (s: Session, body: SaveBody, write: boolean): void => {
    s.runner?.dispose();
    s.runner = null;
    s.pending = body;
    vm.stageTap = true;
    s.last = body;
    if (write) {
      autosave(s); // the pending body, through the one guarded write
    }
    openPaywall(body.chapterId, null);
  };

  /** F4 / F4′ at the chapter's END, inside the intent that reached it. */
  const chapterEnd = async (s: Session, ch: LoadedChapter): Promise<void> => {
    void settings.flush(); // F4 step 1: the read-set of the chapter's last lines; never rejects
    const runner = s.runner;
    const last = s.checkpoint?.knot ?? null;
    if (last !== null && Object.hasOwn(ch.meta.endings, last)) {
      // F4′: the story is over. The knot's ending_reached marks it; nothing is saved past the knot's checkpoint.
      runner?.dispose();
      s.runner = null;
      const m = meta;
      const story = s.story.id;
      const onaction = (): void => void game.exitToStories();
      // F16: the card action is the retry; the first card follows the settle, asked for once the end is the root.
      showNotice(m === null ? { kind: 'the_end', onaction } : { kind: 'the_end', onaction, oncard: () => void m.onEnding(story) });
      if (m !== null) {
        void m.onEnding(story); // never rejects; the card or its toast is on screen
      }
      return;
    }
    reporter.record({ kind: 'chapter_completed', chapterId: ch.id, storyVersion: ch.meta.storyVersion });
    const carry = runner === null ? { ...s.carry } : carryOut(runner, ch.meta);
    runner?.dispose();
    s.runner = null;
    const id = chapterEntry(ch.id)?.next ?? null;
    if (id === null) {
      showNotice({ kind: 'to_be_continued', onaction: () => void game.exitToStories() });
      return;
    }
    const entry = chapterEntry(id);
    if (entry === null) {
      showNotice({ kind: 'error', onaction: () => void game.exitToStories() }); // the catalog decoder admits no such chain
      return;
    }
    const pending = (): SaveBody => ({
      format: SAVE_FORMAT,
      chapterId: id,
      // The next chapter's version is unknown before its load; resume reads none for an `ink: null` body.
      storyVersion: ch.meta.storyVersion,
      ink: null,
      at: NO_AT,
      staging: EMPTY_SNAPSHOT,
      checkpoint: null,
      chapterStart: { carry, items: [] },
      backlog: s.backlog.slice(-BACKLOG_MAX),
      world: EMPTY_WORLD_STATE,
      worldVersion: null,
    });
    if (!owns(entry)) {
      pendingPaid(s, pending(), true);
      return;
    }
    const kept = s.kept?.id === id ? s.kept.loaded : null;
    s.kept = null;
    let loaded = kept === null ? null : await kept;
    if (loaded === null || !loaded.ok) {
      loaded = await loadChapter(id);
    }
    if (session !== s) {
      return;
    }
    if (!loaded.ok) {
      if (loaded.error.kind === 'not-entitled') {
        pendingPaid(s, pending(), true); // the list said owned, the server did not (a refund): the server wins
        return;
      }
      chapterFailed(s, loaded.error);
      return;
    }
    s.handover = s.nextTag === `next:${id}` ? loaded.value.meta.firstKnot : null;
    s.nextTag = null;
    await beginChapter(s, loaded.value, carry, true);
  };

  /** A chapter that could not be loaded: the reopen notice for an ended session, else the error notice. */
  const chapterFailed = (s: Session, e: ChapterLoadError): Result<void, GameError> => {
    if (e.kind === 'session-expired') {
      endSession(s);
      showNotice({ kind: 'reopen', onclose: () => tg.close() });
    } else {
      showNotice({ kind: 'error', onaction: () => void game.exitToStories() });
      // LBI D4: a chapter file a deploy removed answers without the build header; the probe's answer carries it, and a
      // skew it shows reaches `skewed` through boot. Its own result is not needed (it never rejects).
      void deps.fetchAsset(BUILD_PROBE_URL, new AbortController().signal);
    }
    return err({ kind: 'chapter', error: e });
  };

  // -------------------------------------------------------------------------------------------------------------
  // Sessions

  /**
   * W1 / F3 step 4: the autosave lane paused on another device's save; only the player's explicit choice resumes it
   * (principle 1: progress is never overwritten silently). `retrying` and `failed` show nothing (F3 step 3).
   */
  const onSaveState = (s: Session, st: SaveState): void => {
    if (session !== s) {
      return;
    }
    if (st.kind !== 'paused') {
      vm.dismissToast(CONFLICT_PROMPT);
      return;
    }
    let answered = false; // one answer per prompt: a double tap resolves once
    const answer = (choice: 'keep-here' | 'load-theirs'): void => {
      if (answered || session !== s) {
        return;
      }
      answered = true;
      vm.dismissToast(CONFLICT_PROMPT);
      if (choice === 'keep-here') {
        s.saves.resolveConflict(choice);
        return;
      }
      // Before the resolve opens the lane: the step in flight, a lifecycle event or a timer may autosave next.
      s.adopting = true;
      s.saves.resolveConflict(choice);
      void after(() => loadSlot(s, 'auto')); // the other device's progress; the outcome is on screen
    };
    vm.showToast({
      kind: 'prompt',
      key: CONFLICT_PROMPT,
      message: t(vm.lang, 'toast.save_conflict'),
      actions: [
        { label: t(vm.lang, 'toast.save_conflict_load'), run: () => answer('load-theirs') },
        { label: t(vm.lang, 'toast.save_conflict_keep'), run: () => answer('keep-here') },
      ],
    });
  };

  /**
   * LBI D5 'attempt': the yields' puzzle calls, each attempt counted until its answer, so a recovery never reloads
   * between the two. The answer's continuation (a solved puzzle queues its outcome as an intent) runs in microtasks,
   * before the recovery's next timer task looks again.
   */
  const yieldsApi: YieldsHost['api'] = {
    getPuzzle: (id, lang, o) => deps.api.getPuzzle(id, lang, o),
    postAttempt: async (id, answer, o) => {
      attemptsInFlight += 1;
      try {
        return await deps.api.postAttempt(id, answer, o);
      } finally {
        attemptsInFlight -= 1;
      }
    },
  };

  /** The session's side of its yields; every method runs after the session exists. */
  const yieldsHost = (of: () => Session): YieldsHost => ({
    vm,
    screens,
    tg,
    api: yieldsApi,
    scene,
    explore: deps.explore,
    puzzle: deps.puzzle,
    reporter,
    clock,
    chunks,
    hints: () => meta?.hintPort() ?? null,
    stageHost: () => host,
    chapter: () => of().ch,
    runner: () => of().runner,
    text: (w) => of().lines.text(w.id, w.ru, vm.lang),
    apply: async (visual, audio, started) => {
      const s = of();
      const instant = vm.mode === 'skip';
      const shown = await stage(s, visual, instant, roomWindow(s, visual));
      if (session !== s) {
        return;
      }
      started?.();
      audioOnce().apply(audio, { instant });
      await shown.done;
    },
    bgm: () => sound?.currentBgm() ?? null,
    continueStory: async () => {
      const s = of();
      const runner = s.runner;
      if (session === s && runner !== null) {
        s.step = null;
        await handle(s, runner.next());
      }
    },
    storyError: (e) => storyError(of(), e),
    autosave: () => autosaveOutside(of(), false),
    notice: (retry) => {
      const s = of();
      showNotice({
        kind: 'error',
        onaction: () =>
          void after(async () => {
            if (session !== s) {
              return;
            }
            screens.setRoot({ kind: 'game' });
            tg.setClosingConfirmation(true);
            s.yields.rootShown();
            await retry();
          }),
      });
    },
    tap: (fn) => {
      if (busy !== null) {
        scene.complete(); // D7: a tap during a batch completes it
        return busy;
      }
      return run(fn);
    },
    queue: (fn) => after(fn),
  });

  const openSession = (story: StoryEntry): Session => {
    const saves = deps.saves(story.id);
    let self: Session | null = null;
    const yields = createYields(
      yieldsHost(() => {
        if (self === null) {
          throw new Error('invariant: a session exists before its yields run');
        }
        return self;
      }),
    );
    const s: Session = {
      story,
      saves,
      yields,
      offSaves: () => {},
      abort: new AbortController(),
      ch: null,
      assets: EMPTY_INDEX,
      lines: createLineText(null),
      runner: null,
      carry: {},
      checkpoint: null,
      backlog: [],
      choiceText: new Map(),
      at: NO_AT,
      torn: false,
      step: null,
      shown: null,
      last: null,
      adopting: false,
      conflicts: new Map(),
      held: new Set(),
      nextTag: null,
      kept: null,
      handover: null,
      pending: null,
      inkErrors: 0,
      entry: 'none',
    };
    self = s;
    s.offSaves = saves.onState((st) => onSaveState(s, st));
    return s;
  };

  /** Every per-session resource is released; the scene and the audio stay with the Game. */
  const endSession = (s: Session): void => {
    if (session === s) {
      session = null;
    }
    clearAuto();
    clearSkip();
    clearHold();
    s.abort.abort();
    s.yields.dispose();
    s.runner?.dispose();
    s.runner = null;
    s.offSaves();
    vm.dismissToast(CONFLICT_PROMPT);
    s.saves.dispose();
    loaders.current.cancel();
    loaders.next.cancel();
    s.kept = null;
    s.nextTag = null;
    if (offer !== null && offer.start === null) {
      closeOffer();
    }
    vm.line = null;
    vm.choices = null;
    vm.paywall = null;
    vm.stageTap = false;
  };

  /** A failed start: the session ends, and the notice's Retry starts again from the same point. */
  const startFailed = (s: Session, from: StartFrom, e: GameError): Result<void, GameError> => {
    endSession(s);
    showNotice({ kind: 'error', onaction: () => void game.start(from) });
    return err(e);
  };

  /**
   * STORIES-PLAN "Module API", in order: the chapter purchase, the autosave (EXIT_FLUSH_MS, else the pending cache),
   * the runner, the stage and every holder family, the audio, the saves, the reporter; then Home. The Pixi
   * Application stays.
   */
  const exitNow = async (): Promise<void> => {
    const s = session;
    if (s === null) {
      return;
    }
    meta?.closeOverlays(); // a card asked for at the end lands on nothing
    s.yields.disposePuzzle();
    closeOffer();
    autosave(s); // the world is still in the explore controller
    await s.saves.flush({ timeoutMs: EXIT_FLUSH_MS });
    if (session !== s) {
      return;
    }
    s.yields.dispose();
    clearAuto();
    clearSkip();
    s.runner?.dispose();
    s.runner = null;
    await scene.restore(EMPTY_SNAPSHOT);
    for (const tag of EXIT_RELEASES) {
      scene.releasePreload(tag);
    }
    sound?.setChapter(null);
    endSession(s);
    reporter.flush();
    tg.setClosingConfirmation(false);
    deps.onExit();
  };

  /** One mount for the page: one in flight or done is shared; a failed one is forgotten, so a Retry mounts again. */
  const mountOnce = (): Promise<Result<void, SceneError>> => {
    mounted ??= (async () => {
      const el = host ?? (await new Promise<HTMLElement>((resolve) => hostWaiters.push(resolve)));
      const r = await scene.mount(el, { dpr: deps.dpr(), perfClass: tg.perfClass ?? 'AVERAGE', fetchAsset: deps.fetchAsset });
      if (!r.ok) {
        mounted = null; // the controller is idle again after a failed init (scene/controller.ts)
      }
      return r;
    })();
    return mounted;
  };

  const begin = async (story: StoryEntry, from: StartFrom): Promise<Result<void, GameError>> => {
    const list = await deps.saveList();
    if (!list.ok) {
      showNotice({ kind: 'error', onaction: () => void game.start(from) });
      return err({ kind: 'saves', error: list.error });
    }
    closeOffer();
    const s = openSession(story);
    session = s;
    vm.notice = null;
    vm.line = null;
    vm.choices = null;
    screens.setRoot({ kind: 'game' });
    tg.setClosingConfirmation(true);
    audioOnce();
    const mount = mountOnce();
    if (from.kind === 'new') {
      // D5: the scene mounts while the chapter loads; the saves' pending upload runs beside them (F3 step 5).
      const [m, ch, started] = await Promise.all([mount, loadChapter(from.chapter), s.saves.start(list.value)]);
      if (session !== s) {
        return err({ kind: 'busy' });
      }
      if (!m.ok) {
        return startFailed(s, from, { kind: 'scene', error: m.error });
      }
      if (!started.ok) {
        return startFailed(s, from, { kind: 'saves', error: started.error });
      }
      if (!ch.ok) {
        return chapterFailed(s, ch.error);
      }
      return beginChapter(s, ch.value, {}, false);
    }
    // A slot: the pending upload first, so the load reads the newest copy of ours (F3 step 5).
    const started = await s.saves.start(list.value);
    if (session !== s) {
      return err({ kind: 'busy' });
    }
    if (!started.ok) {
      return startFailed(s, from, { kind: 'saves', error: started.error });
    }
    const [m, full] = await Promise.all([mount, s.saves.load(from.slot)]);
    if (session !== s) {
      return err({ kind: 'busy' });
    }
    if (!m.ok) {
      return startFailed(s, from, { kind: 'scene', error: m.error });
    }
    if (!full.ok) {
      return startFailed(s, from, { kind: 'saves', error: full.error });
    }
    if (full.value === null) {
      return startFailed(s, from, { kind: 'empty-slot', slot: from.slot });
    }
    const body = decodeSave(full.value.body);
    if (!body.ok) {
      return startFailed(s, from, { kind: 'unreadable-save', detail: body.error.detail });
    }
    return resumeBody(s, body.value);
  };

  /**
   * W1 "Load it" read nothing to resume: a failed read, an empty slot or an unreadable body (fix_r1 KL1; RULINGS 81).
   * `adopting` stays set until the session ends, so nothing of it is written, a request kept during the read included;
   * the error notice exits, and Home's Continue reads their save (RULINGS 93). An ended session gets the reopen notice,
   * as in `chapterFailed`, never the error notice over the one the http layer showed. A manual load is unchanged.
   */
  const adoptFailed = (s: Session, e: ApiError | null): void => {
    if (!s.adopting) {
      return;
    }
    if (e?.kind === 'session-expired') {
      endSession(s);
      showNotice({ kind: 'reopen', onclose: () => tg.close() });
      return;
    }
    showNotice({ kind: 'error', onaction: () => void game.exitToStories() });
  };

  const loadSlot = async (s: Session, slot: SaveSlot): Promise<void> => {
    const full = await s.saves.load(slot);
    if (session !== s) {
      return;
    }
    if (!full.ok || full.value === null) {
      adoptFailed(s, full.ok ? null : full.error);
      return;
    }
    const body = decodeSave(full.value.body);
    if (!body.ok) {
      console.error('saves: unreadable body', body.error);
      adoptFailed(s, null);
      return;
    }
    clearAuto();
    clearSkip();
    const resumed = await resumeBody(s, body.value);
    if (resumed.ok && session === s && s.adopting) {
      // Their save took over. Nothing of this session was written since the choice: the server's copy is this body,
      // which `resumeBody` recorded as the last save.
      s.adopting = false;
    }
  };

  // -------------------------------------------------------------------------------------------------------------
  // The save screen (F3 manual slots)

  const slotViews = (s: Session, list: SaveListResponse): SlotView[] =>
    MANUAL_SLOTS.flatMap((slot) => {
      const found = summaryOf(list, s.story.id, slot);
      return found === null ? [] : [{ slot, savedAt: found.savedAt, chapter: titleOf(found.chapterId as ChapterId) }];
    });
  const refreshSlots = async (s: Session): Promise<void> => {
    const r = await deps.api.listSaves();
    if (r.ok && session === s) {
      vm.saves = { ...vm.saves, slots: slotViews(s, r.value) };
    }
  };
  /** A manual write's answer on the save screen; `tappedAt` is the tap that sent it, which a conflict ask waits past. */
  const saved = async (s: Session, slot: ManualSlot, r: Result<unknown, SaveError>, tappedAt: number): Promise<void> => {
    if (session !== s) {
      return;
    }
    // A newer answer for this slot replaces its held ask (LFU1 critique O3); another slot's ask stays (RULINGS 101).
    dropConflict(s, slot);
    if (r.ok) {
      vm.saves = { ...vm.saves, saving: null, conflict: shownAsk(s), failed: null };
      await refreshSlots(s);
    } else if (r.error.kind === 'conflict') {
      const current = r.error.current;
      s.conflicts.set(slot, { current, asked: null });
      const ask = (): void => {
        conflictHolds.delete(slot);
        if (session !== s || s.conflicts.get(slot)?.current !== current) {
          return;
        }
        s.conflicts.set(slot, { current, asked: askSeq++ });
        // The hold absorbed taps on its own slot only: another slot's write may be in flight.
        const saving = vm.saves.saving === slot ? null : vm.saves.saving;
        vm.saves = { ...vm.saves, saving, conflict: shownAsk(s), failed: null };
      };
      const left = tappedAt + CONFLICT_HOLD_MS - clock.now();
      if (left > 0) {
        conflictHolds.set(slot, clock.setTimeout(ask, left));
      } else {
        ask();
      }
    } else {
      vm.saves = { ...vm.saves, saving: null, conflict: shownAsk(s), failed: slot };
    }
  };

  /**
   * A manual save writes the step on screen (triage r2 M4). While an intent is past a move and before its `present`
   * (`mixes`), `saving` names the slot at once, as D33's latch needs, and the body is taken once that intent has ended:
   * the wait is the step's own load time, as an exit's is. A session that still mixes then, or at rest, writes nothing.
   */
  const writeManual = async (s: Session, slot: ManualSlot, put: (w: SaveWrite) => Promise<Result<unknown, SaveError>>): Promise<void> => {
    const tappedAt = clock.now();
    const waiting = busy !== null && mixes(s);
    let body = mixes(s) ? null : bodyOf(s);
    if (!waiting && body === null) {
      return; // at rest: no chapter runs, or the session describes two steps (a resume failed past the swap)
    }
    // This write's answer is the slot's next one, so its earlier ask is over (an overwrite took its envelope first).
    // Another slot's ask stays shown; its controls are disabled while `saving` names a slot.
    dropConflict(s, slot);
    vm.saves = { ...vm.saves, saving: slot, conflict: shownAsk(s), failed: null };
    if (body === null) {
      while (busy !== null && mixes(s)) {
        await busy;
      }
      if (session !== s) {
        return;
      }
      body = mixes(s) ? null : bodyOf(s);
      if (body === null) {
        vm.saves = { ...vm.saves, saving: null, conflict: shownAsk(s) };
        return;
      }
    }
    await saved(s, slot, await put(writeOf(body)), tappedAt);
  };

  // -------------------------------------------------------------------------------------------------------------
  // Build skew (LBI D5): the reload into the new build, at a safe point

  /**
   * What a reload would cut now, or null at a safe point. A deactivated page waits for `activated`: the player would
   * not see the notice, and the flush may be throttled. The grant of an open invoice is the server's on
   * `successful_payment` either way (principle 2); waiting keeps the flow's poll, and with it the paywall's state, so no
   * reloaded paywall offers Buy for a payment still being confirmed (`delayed` included, critique W1). A Buy waiting for
   * the purchase module (lever P) holds like an invoice being created: its flow is made and asks for the invoice as
   * soon as the module lands, which would open the sheet under the update notice.
   * The wallet's pack flow is waited for only while the player is on it (LRB): a pack Buy waiting for the module (E6,
   * `purchaseWaiting`: the same reason as the paywall's), an invoice being created or confirmed, the wallet open, or a
   * sheet no Back on the wallet has shown closed. One the player left (`purchaseLeft`) holds
   * nothing: it moves only on the wallet's Check again or `activated`. After that reload the wallet reads the balance
   * again and the credit shows once the webhook lands, but its Buy is a new purchase, not Check again: the server
   * refuses a second pre-checkout of the pack for up to CHECKOUT_LOCK_SECS (120 s), and a later one charges and credits a
   * second pack. Accepted (LRB critique W1): a pack is consumable and every charge is credited, against a hold for the
   * page's life. A gift is waited for only while its dialog shows it sending (`gift.busy`); one the player closed, and a
   * request id kept for a retry, are not: once sent the move is the server's, and the dialog reads the balance again
   * before any resend. A hint is not waited for: a tier unlocked before debits nothing again.
   */
  const reloadBlocker = (): ReloadBlocker | null => {
    if (busy !== null) {
      return 'intent';
    }
    if (paused) {
      return 'background';
    }
    // LRB's wallet and gift clauses, in app/reload.ts since Q60: boot's recovery reads them when no Game exists.
    const m = metaHold(vm.meta);
    if (offer?.waiting === true || PURCHASE_OPEN.has(offer?.flow?.state().kind ?? 'idle') || m === 'purchase') {
      return 'purchase';
    }
    if (attemptsInFlight > 0) {
      return 'attempt';
    }
    if (vm.saves.saving !== null) {
      return 'save';
    }
    if (m === 'gift') {
      return 'gift';
    }
    return null;
  };

  /**
   * D5 step 3, in this one timer task once nothing blocks: the autosave of this exact point (by its own rules: an
   * adopting or mixed session writes nothing, a pending paid start writes its body), then the update notice (Q60: the
   * restart notice for a chunk restart) as the root, which covers every control so no Buy or attempt can start; then
   * the flush and the reload.
   */
  const reloadTick = (): void => {
    reloadTimer = null;
    const r = recovery;
    if (r === null || disposed) {
      return;
    }
    if (reloadBlocker() !== null) {
      reloadTimer = clock.setTimeout(reloadTick, RELOAD_POLL_MS);
      return;
    }
    clearAuto();
    clearSkip();
    const s = session;
    if (s !== null) {
      autosave(s);
    }
    showNotice({ kind: r.kind === 'skew' ? 'update' : 'restart' });
    void reloadAfterFlush(r, s); // its end is the reload; nothing awaits it
  };

  /**
   * The exit's rule (EXIT_FLUSH_MS, else the pending cache keeps the autosave), then the reload with the latch set: a
   * skew's replaces any latch (LBI D6), a chunk restart's is appended (Q60 D4).
   */
  const reloadAfterFlush = async (r: Recovery, s: Session | null): Promise<void> => {
    if (s !== null) {
      await s.saves.flush({ timeoutMs: EXIT_FLUSH_MS });
    }
    if (!disposed) {
      const href = r.page.href();
      r.page.reload(r.kind === 'skew' ? withReloadedFor(href, r.latch) : withLatch(href, r.latch));
    }
  };

  // -------------------------------------------------------------------------------------------------------------
  // The debug hook (D22)

  if (__TG_MOCK__) {
    const hook: DebugHook = {
      stats: () => ({
        scene: scene.stats(),
        audio: sound?.stats() ?? null,
        runners: liveRunners(),
        ...(session?.yields.presence() ?? { explore: false, puzzle: false }),
      }),
      lineId: () => vm.line?.lineId ?? null,
      forceContextLoss: (mode) => scene.debugForceContextLoss(mode ?? 'restorable'),
      propRects: () => scene.debugPropRects(),
    };
    (globalThis as typeof globalThis & { __novelDebug?: DebugHook }).__novelDebug = hook;
  }

  const game: Game = {
    async start(from) {
      const story = catalog.stories.find((x) => x.id === from.story) ?? null;
      if (story === null) {
        return err({ kind: 'unknown-story', story: from.story });
      }
      if (from.kind === 'new' && !story.chapters.includes(from.chapter)) {
        return err({ kind: 'chapter-outside-story', story: from.story, chapter: from.chapter });
      }
      if (disposed || session !== null || busy !== null) {
        return err({ kind: 'busy' });
      }
      return run(() => begin(story, from));
    },
    attachStage(el) {
      host = el;
      if (el !== null) {
        const waiters = hostWaiters;
        hostWaiters = [];
        for (const w of waiters) {
          w(el);
        }
      }
    },
    advance() {
      const s = session;
      if (s === null || disposed) {
        return DONE;
      }
      if (busy !== null) {
        scene.complete(); // F2: taps during a batch coalesce into complete()
        return busy;
      }
      return run(() => next(s));
    },
    choose(index) {
      const s = session;
      const step = s?.step;
      if (s === null || busy !== null || step?.kind !== 'choices' || s.runner === null) {
        return DONE;
      }
      const option = step.choices.find((c) => c.index === index);
      const ch = s.ch;
      if (option === undefined || ch === null || !s.runner.choose(index).ok) {
        return DONE;
      }
      s.torn = true; // the runner is past the choice set; its next step is presented by the intent below
      tg.haptic.impact('light');
      reporter.record({ kind: 'choice_made', chapterId: ch.id, storyVersion: ch.meta.storyVersion, option: option.lineId });
      const last = s.backlog.at(-1);
      if (last !== undefined) {
        last.chosen = option.lineId;
      }
      vm.choices = null;
      s.step = null;
      return run(() => next(s));
    },
    setMode(m) {
      vm.mode = m;
      clearAuto();
      clearSkip();
      if (m === 'auto') {
        scheduleAuto();
      } else if (m === 'skip' && busy === null && session?.step?.kind === 'line') {
        void game.advance(); // the intent reports through the views
      }
    },
    lineShown() {
      revealed = true;
      scheduleAuto();
      session?.yields.lineShown();
      meta?.lineShown();
      if (!overlaysAsked) {
        void overlayUiModule(); // lever O5: once per page, after the gameplay chunks; it never rejects
      }
    },
    gesture() {
      const a = sound;
      if (a === null) {
        return;
      }
      if (a.stats().state !== 'running') {
        deps.unlock();
        void a.resume(); // its outcome reaches the chip through onNeedsGesture
      }
    },
    openMenu() {
      void withOverlays(() => {
        screens.push({ kind: 'menu' });
      });
    },
    openBacklog() {
      void withOverlays(() => {
        const s = session;
        if (s !== null) {
          vm.backlog = backlogLines(s);
          screens.push({ kind: 'backlog' });
        }
      });
    },
    openSettings() {
      void withOverlays(() => {
        vm.settings = settings.current();
        screens.push({ kind: 'settings' });
      });
    },
    openSaves() {
      return withOverlays(async () => {
        const s = session;
        if (s === null) {
          return;
        }
        clearHold(); // a held ask would show over the fresh screen, whose Yes then finds no conflict
        s.conflicts.clear(); // the fresh screen's slot list is the server's state (LFU1)
        vm.saves = { ...vm.saves, saving: null, conflict: null, failed: null };
        screens.push({ kind: 'saves' });
        await refreshSlots(s);
      });
    },
    openTerms() {
      screens.push({ kind: 'terms' });
    },
    async save(slot) {
      const s = session;
      if (s === null || vm.saves.saving !== null) {
        return;
      }
      await writeManual(s, slot, (w) => s.saves.save(slot, w));
    },
    async overwrite(slot) {
      const s = session;
      const c = s?.conflicts.get(slot);
      if (s === null || c === undefined || vm.saves.conflict !== slot || vm.saves.saving !== null) {
        return;
      }
      const current = c.current; // taken before the write drops the slot's ask
      await writeManual(s, slot, (w) => s.saves.overwrite(slot, w, current));
    },
    cancelOverwrite() {
      // The shown ask's No is that slot's alone (RULINGS 101): the next asked slot shows.
      const s = session;
      const slot = vm.saves.conflict;
      if (s === null || slot === null) {
        vm.saves = { ...vm.saves, conflict: null };
        return;
      }
      dropConflict(s, slot);
      vm.saves = { ...vm.saves, conflict: shownAsk(s) };
    },
    load(slot) {
      const s = session;
      if (s === null || loading) {
        return DONE;
      }
      loading = true;
      screens.close('saves');
      return after(() => loadSlot(s, slot)).finally(() => {
        loading = false;
      });
    },
    setSettings(nextSettings) {
      void settings.update(nextSettings); // never rejects (settings/store.ts)
      const cur = settings.current();
      vm.settings = cur;
      vm.speed = cur.speed;
      sound?.setVolumes(cur.volume);
      const lang = cur.lang ?? deps.accountLang;
      if (lang !== vm.lang) {
        void setLang(lang); // the views follow when the en table is in
      }
    },
    onLifecycle(e) {
      const s = session;
      if (e === 'deactivated') {
        paused = true;
        vm.paused = true;
        scene.pause();
        sound?.suspend();
        if (autoTimer !== null) {
          clearAuto();
          autoHeld = true;
        }
        offer?.flow?.onDeactivated();
        if (s !== null) {
          autosaveOutside(s, false);
        }
        void settings.flush(); // never rejects
        return;
      }
      paused = false;
      vm.paused = false;
      scene.resume();
      void scene.onActivated(); // the context check settles by itself (scene/controller.ts)
      if (sound !== null) {
        void sound.resume(); // 'needs-gesture' reaches the chip through onNeedsGesture
      }
      s?.saves.onActivated();
      offer?.flow?.onActivated();
      if (autoHeld) {
        autoHeld = false;
        scheduleAuto();
      }
    },
    pagehide() {
      const s = session;
      if (s !== null) {
        autosaveOutside(s, true);
      }
    },
    buy() {
      const o = offer;
      if (disposed || o === null || o.product === null) {
        return;
      }
      const p = o.product;
      if (purchase !== null) {
        startPurchase(o, p, purchase); // the paywall's prefetch landed: today's synchronous Buy
        return;
      }
      // Lever P: the prefetch failed or has not landed. The paywall stays the flow's (no flow: idle, Buy enabled);
      // a double tap queues on the one load, and the flow's own guard opens one sheet.
      o.waiting = true;
      void purchaseModule().then((m) => {
        o.waiting = false;
        if (disposed || offer !== o) {
          return; // the offer ended while the module loaded: nothing is bought
        }
        if (m === null) {
          vm.showToast({ kind: 'note', key: PURCHASE_TOAST, message: t(vm.lang, 'toast.purchase_failed'), sticky: false });
          return;
        }
        startPurchase(o, p, m);
      });
    },
    checkAgain() {
      offer?.flow?.checkAgain();
    },
    async retryPrice() {
      const o = offer;
      if (o === null) {
        return;
      }
      const r = await deps.entitlements.refresh();
      if (offer !== o || vm.paywall === null) {
        return;
      }
      if (r.ok && r.value.some((x) => x.chapterId === o.chapter && x.owned)) {
        await unlocked(o, true); // P1: already owned skips to P9
        return;
      }
      vm.paywall = { ...vm.paywall, priceStars: priceOf(o.chapter) };
    },
    offerChapter(story, chapter) {
      const entry = catalog.stories.find((x) => x.id === story);
      if (disposed || session !== null || entry === undefined || !entry.chapters.includes(chapter)) {
        return;
      }
      openPaywall(chapter, story);
    },
    screensChanged(v) {
      session?.yields.screensChanged(v);
    },
    attachMeta(m) {
      meta = m;
    },
    skewed(served, page) {
      if (disposed || recovery !== null || reloadedFor(page.href()) === served) {
        return; // the latch: this tab already reloaded for `served`, so today's error states stay (D6)
      }
      recovery = { kind: 'skew', latch: served, page };
      reloadTimer = clock.setTimeout(reloadTick, 0); // checked in a task of its own, never inside the response path
    },
    restart(latch, page) {
      if (disposed || recovery !== null || latched(page.href(), latch)) {
        return; // one recovery per page; a page that restarted for this build keeps today's error states (Q60 F4)
      }
      recovery = { kind: 'chunk', latch, page };
      reloadTimer = clock.setTimeout(reloadTick, 0);
    },
    exploreActions: forwardLayer(() => session?.yields.layer),
    puzzleActions: forwardHost(() => session?.yields.host),
    exitToStories() {
      if (disposed || exiting || session === null) {
        return DONE;
      }
      exiting = true;
      return after(exitNow).finally(() => {
        exiting = false;
      });
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      closeOffer();
      const s = session;
      if (s !== null) {
        endSession(s);
      }
      clearAuto();
      clearSkip();
      clearHold();
      if (reloadTimer !== null) {
        clock.clearTimeout(reloadTimer);
        reloadTimer = null;
      }
      recovery = null;
      hostWaiters = [];
      if (__TG_MOCK__) {
        delete (globalThis as typeof globalThis & { __novelDebug?: DebugHook }).__novelDebug;
      }
    },
  };

  /** K49 / setLang: the UI language; a free chapter's en table loads first, then every view is rebuilt. */
  const setLang = async (lang: Lang): Promise<void> => {
    vm.lang = lang;
    const s = session;
    const ch = s?.ch ?? null;
    if (s !== null && ch !== null && lang === 'en' && ch.en === null) {
      const r = await loaders.en.loadEn(ch);
      if (r.ok && session === s && s.ch?.id === r.value.id) {
        s.ch = r.value;
        s.lines = createLineText(r.value.en);
      }
    }
    if (s !== null && session === s) {
      relabel(s);
    }
  };

  return game;
}

const EMPTY_INDEX: AssetIndex = {
  hasBg: () => false,
  hasExpr: () => false,
  hasChar: () => false,
  hasCg: () => false,
  hasTrack: () => false,
  hasSfx: () => false,
};
