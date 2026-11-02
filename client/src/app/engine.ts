// The engine chunk's composition root (PROTOTYPE-PLAN "app/engine.ts", the two-stage boot; L15 D1): the only path to
// Pixi, inkjs and GSAP, imported dynamically by boot.ts while Home is shown. It builds the scene controller, one
// chapter loader per role, the SaveService factory and the Game, and hands the overlay the in-play components, which
// never render before the engine and so ship in its closure rather than the entry's.
import type { Endpoints } from '../api/endpoints.ts';
import { systemClock } from '../api/http.ts';
import type { Http } from '../api/http.ts';
import { createAudioManager } from '../audio/manager.ts';
import type { AudioManager } from '../audio/manager.ts';
import type { Lang } from '../i18n/index.ts';
import { createSaveService } from '../saves/service.ts';
import { createSceneController } from '../scene/controller.ts';
import type { SettingsStore } from '../settings/store.ts';
import type { StatsReporter } from '../stats/reporter.ts';
import type { ChapterCatalog } from '../story/catalog.ts';
import { createChapterLoader } from '../story/chapters.ts';
import type { TelegramClient } from '../telegram/index.ts';
import Backlog from '../ui/Backlog.svelte';
import Choices from '../ui/Choices.svelte';
import DialogueBox from '../ui/DialogueBox.svelte';
import { createExploreView } from '../ui/explore-view.svelte.ts';
import type { ExploreViewStore } from '../ui/explore-view.svelte.ts';
import Menu from '../ui/Menu.svelte';
import Paywall from '../ui/Paywall.svelte';
import { createPuzzleView } from '../ui/puzzle-view.svelte.ts';
import type { PuzzleView } from '../ui/puzzle-view.svelte.ts';
import QuickBar from '../ui/QuickBar.svelte';
import SaveLoad from '../ui/SaveLoad.svelte';
import type { Screens } from '../ui/screens.ts';
import Settings from '../ui/Settings.svelte';
import Stage from '../ui/Stage.svelte';
import type { ViewModel } from '../ui/state.svelte.ts';
import Terms from '../ui/Terms.svelte';
import { createGame } from './game.ts';
import type { Entitlements, Game, GameDeps } from './game.ts';

/** The in-play components and the two lazy views' stores, for App.svelte once the engine is in. */
export type EngineUi = {
  readonly Stage: typeof Stage;
  readonly DialogueBox: typeof DialogueBox;
  readonly Choices: typeof Choices;
  readonly QuickBar: typeof QuickBar;
  readonly Menu: typeof Menu;
  readonly Backlog: typeof Backlog;
  readonly Settings: typeof Settings;
  readonly SaveLoad: typeof SaveLoad;
  readonly Paywall: typeof Paywall;
  readonly Terms: typeof Terms;
  /** Written by app/yields.ts and the explore controller; App renders its loaded layer. */
  readonly explore: ExploreViewStore;
  /** Written by app/yields.ts; App renders its loaded host. */
  readonly puzzle: PuzzleView;
};

/** What boot hands the engine: the entry's services, created before the engine loaded. */
export type EngineDeps = {
  tg: TelegramClient;
  vm: ViewModel;
  screens: Screens;
  http: Pick<Http, 'fetchAsset'>;
  api: Endpoints;
  catalog: ChapterCatalog;
  entitlements: Entitlements;
  saveList: GameDeps['saveList'];
  settings: SettingsStore;
  reporter: Pick<StatsReporter, 'record' | 'flush'>;
  accountLang: Lang;
  /** audio/unlock.ts's `unlockAudio`, from the entry: the one context, made inside a tap. */
  unlock: () => AudioContext;
  onExit: () => void;
};

export function createEngine(d: EngineDeps): { game: Game; ui: EngineUi } {
  const fetchAsset = d.http.fetchAsset;
  const loader = () => createChapterLoader({ getChapter: (id, o) => d.api.getChapter(id, o), fetchAsset });
  const scene = createSceneController();
  let audio: AudioManager | null = null;
  const explore = createExploreView();
  const puzzle = createPuzzleView();
  const game = createGame({
    vm: d.vm,
    screens: d.screens,
    tg: d.tg,
    api: d.api,
    catalog: d.catalog,
    entitlements: d.entitlements,
    saveList: d.saveList,
    saves: (story) => createSaveService({ api: d.api, device: d.tg.device, clock: systemClock, story }),
    settings: d.settings,
    reporter: d.reporter,
    clock: systemClock,
    scene,
    // Created at the first start, after the Home tap made the context: never before a gesture (principle 5).
    audio: () => (audio ??= createAudioManager(d.unlock(), { fetchAsset })),
    unlock: () => {
      d.unlock();
    },
    loaders: { current: loader(), next: loader(), en: loader() },
    fetchAsset,
    dpr: () => globalThis.devicePixelRatio,
    accountLang: d.accountLang,
    onExit: d.onExit,
    explore,
    puzzle,
  });
  return {
    game,
    ui: { Stage, DialogueBox, Choices, QuickBar, Menu, Backlog, Settings, SaveLoad, Paywall, Terms, explore, puzzle },
  };
}
