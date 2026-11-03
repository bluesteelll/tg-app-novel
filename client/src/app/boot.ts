// The two-stage boot (PROTOTYPE-PLAN F1, STORIES-PLAN F1′; L15 D2): the entry's half. It shows Home without a byte of
// Pixi, inkjs or GSAP, and meanwhile, in parallel, imports the engine chunk, exchanges initData for the server's token,
// fetches the public catalog and covers, lists every story's saves, reads the entitlements and loads the settings. A
// Home tap unlocks audio synchronously, inside the tap (principle 5), then waits for the engine and starts the story.
// It owns the page's subscriptions: the lifecycle, `pagehide`, the session's expiry. After auth it imports the meta
// controller's chunk beside the engine (RULINGS 105); the gate below is the one way to it.
import { createEndpoints } from '../api/endpoints.ts';
import type { Endpoints } from '../api/endpoints.ts';
import type { ProductDto, SaveListResponse, SaveSummary } from '../api/generated/api.ts';
import { createHttp, systemClock } from '../api/http.ts';
import type { ApiError, Http } from '../api/http.ts';
import type { Session } from '../api/session.ts';
import { unlockAudio } from '../audio/unlock.ts';
import { t } from '../i18n/index.ts';
import type { UiKey } from '../i18n/index.ts';
import { summaryOf } from '../saves/service.ts';
import { createSettingsStore } from '../settings/store.ts';
import type { Settings, SettingsStore } from '../settings/store.ts';
import { createStatsReporter } from '../stats/reporter.ts';
import type { StatsReporter } from '../stats/reporter.ts';
import { decodeChapterCatalog, decodeCoverManifest } from '../story/catalog.ts';
import type { CatalogIssue, ChapterCatalog, CoverManifest, Result, StoryEntry, StoryId } from '../story/catalog.ts';
import type { ChapterId } from '../story/staging.ts';
import type { Lifecycle, TelegramClient, Unsubscribe } from '../telegram/index.ts';
import type { StoryCardView } from '../ui/StoryPicker.svelte';
import { createScreens } from '../ui/screens.ts';
import type { Screens } from '../ui/screens.ts';
import { createViewModel } from '../ui/state.svelte.ts';
import type { ViewModel } from '../ui/state.svelte.ts';
import type { Entitlements, Game, GameMeta, StartFrom } from './game.ts';
import type { MetaController } from './meta.ts';

/** Home's buttons; each one unlocks audio inside its tap and is single-shot until Home is shown again (F1 step 5). */
export type HomeActions = {
  /** Continue: the newest autosave across stories. */
  continue(): void;
  /** A card's Start: the story's first chapter. */
  start(story: StoryId): void;
  /** A card's Continue: the story's autosave. */
  resume(story: StoryId): void;
  /** A card's Chapters: the story's chapter list. */
  chapters(story: StoryId): void;
  /** A row of the chapter list; a locked one leads to the paywall. */
  chapter(story: StoryId, chapter: ChapterId): void;
};

/** The meta taps of the entry and engine overlays (Home, the Menu, Terms; META-PLAN M24, M27; RULINGS 105). */
export type MetaTaps = {
  /** A card's playthrough button (F17); it shows only once the controller says the story has a card. */
  card(story: StoryId): void;
  friends(): void;
  wallet(): void;
  /** F28: the privacy policy, opened inside the tap or not at all (before the chunk, the tap only imports it). */
  policy(): void;
};

/** What App.svelte renders from: the view model, Home's actions and the game once the engine is in. */
export type AppHandle = {
  readonly vm: ViewModel;
  readonly home: HomeActions;
  /** Through the meta gate: given from the first Home, so a tap after a failed import imports again. */
  readonly metaTaps: MetaTaps;
  /** The Game, or null while the engine chunk loads. */
  game(): Game | null;
  /** The meta controller, or null while its chunk is not in. */
  meta(): MetaController | null;
  dispose(): void;
};

/** F1 step 3: the boot reads are retried this many times, with these waits, before the error notice. */
export const BOOT_RETRY_MS: readonly number[] = [1000, 2000, 4000];

/**
 * D15: the public catalog and covers as hashed static files (`?url`), fetched at boot, so the entry JS carries no
 * story data. A glob, as chapters.ts's: before the story tool has run the map is empty, and boot reports it.
 */
const PUBLIC_JSON = import.meta.glob<string>(['../story-gen/catalog.json', '../story-gen/covers.json'], {
  query: '?url',
  import: 'default',
  eager: true,
});
const CATALOG_URL = PUBLIC_JSON['../story-gen/catalog.json'] ?? null;
const COVERS_URL = PUBLIC_JSON['../story-gen/covers.json'] ?? null;

/** The boot reads Home needs; the covers and the entitlements may be missing (cards without images, Retry on price). */
type BootData = {
  session: Session;
  catalog: ChapterCatalog;
  covers: CoverManifest | null;
  list: SaveListResponse;
  products: readonly ProductDto[] | null;
  settings: Settings;
};
type BootError = { kind: 'expired' } | { kind: 'failed'; detail: string };

/**
 * Home's Continue (D16): the newest `auto` of the catalog's stories, by keyed lookups (never list position): the
 * newest `savedAt`, then the higher `rev`, then the lower story id. A save of a story the catalog lacks is ignored.
 */
export function newestAuto(list: SaveListResponse, catalog: ChapterCatalog): { story: StoryEntry; summary: SaveSummary } | null {
  let best: { story: StoryEntry; summary: SaveSummary } | null = null;
  for (const story of catalog.stories) {
    const summary = summaryOf(list, story.id, 'auto');
    if (summary === null) {
      continue;
    }
    const b = best?.summary;
    const newer =
      b === undefined ||
      summary.savedAt > b.savedAt ||
      (summary.savedAt === b.savedAt && (summary.rev > b.rev || (summary.rev === b.rev && story.id < (best?.story.id ?? story.id))));
    if (newer) {
      best = { story, summary };
    }
  }
  return best;
}

/** A public JSON file of the build, through the one fetch seam, decoded at this edge (principle 1). */
async function fetchJson<T>(http: Http, url: string | null, decode: (raw: unknown) => Result<T, CatalogIssue[]>): Promise<Result<T, string>> {
  if (url === null) {
    return { ok: false, error: 'not in this build (the story tool has not run)' };
  }
  // Nothing cancels a boot read: the page needs its answer, and a hung one ends at the network's own timeout.
  const r = await http.fetchAsset(url, new AbortController().signal);
  if (!r.ok) {
    return { ok: false, error: `${url}: ${r.error.kind}` };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(await r.value.text());
  } catch (e) {
    return { ok: false, error: `${url}: ${e instanceof Error ? e.message : String(e)}` };
  }
  const d = decode(raw);
  return d.ok ? d : { ok: false, error: `${url}: ${JSON.stringify(d.error)}` };
}

function describe(e: ApiError): string {
  return e.kind === 'http' ? `http ${e.status}` : e.kind;
}

/** The engine module, imported in parallel with the boot reads (F1 step 3). */
type EngineModule = typeof import('./engine.ts');

/** The meta controller's module (RULINGS 105): imported after auth, beside the engine; never awaited before the first line. */
type MetaModule = typeof import('./meta.ts');

/** The meta controller behind its lazy chunk (META-PLAN M27; RULINGS 105): Home, the end and the puzzles reach it here. */
export type MetaGate = {
  /** The controller once its chunk landed; null before, and after a failed import until a later one lands. */
  current(): MetaController | null;
  /** The controller, importing its chunk when it is not in (one import in flight); null when that import failed. */
  ready(): Promise<MetaController | null>;
  /**
   * A tap that needs the controller: `run` now, or once a new import (single flight) lands; a failed import shows
   * `meta.action_failed`. `inTask`: `run` only inside the tap's own task (F28); before the chunk the tap only imports.
   * A tap that waited is dropped, silently, when the stack's root changed meanwhile: it was made on a screen now gone.
   */
  tap(run: (m: MetaController) => void, o?: { inTask: boolean }): void;
  /** The Game's port, read when called: `onEnding` waits for the import; the others are no-ops before it. */
  readonly port: GameMeta;
  dispose(): void;
};

/**
 * The gate (RULINGS 105): one import in flight, as `importEngine`'s; a failed one is never retried on a timer, only by
 * the next tap or ending. `make` runs once, and only while the gate is not disposed.
 */
export function createMetaGate(d: {
  load: () => Promise<MetaModule>;
  make: (m: MetaModule) => MetaController;
  note: (key: UiKey) => void;
  /** The stack's root now; compared by identity, since every `setRoot` freezes a new one (ui/screens.ts). */
  root: () => object;
}): MetaGate {
  let current: MetaController | null = null;
  let flight: Promise<MetaController | null> | null = null;
  let disposed = false;
  /** Bumped when the session leaves: an ending that waited on the import is dropped. */
  let leaves = 0;

  const ready = (): Promise<MetaController | null> => {
    if (current !== null) {
      return Promise.resolve(current);
    }
    flight ??= d.load().then(
      (m) => {
        if (!disposed) {
          current ??= d.make(m);
        }
        return current;
      },
      (e: unknown) => {
        console.error('boot: the meta chunk did not load', e);
        flight = null;
        return null;
      },
    );
    return flight;
  };

  return {
    current: () => current,
    ready,
    tap(run, o) {
      const m = current;
      if (disposed) {
        return;
      }
      if (m !== null) {
        run(m);
        return;
      }
      const at = d.root();
      void ready().then((c) => {
        if (disposed || d.root() !== at) {
          return; // the page, or the screen the tap was made on, is gone (LMI fix_r1): the player taps again
        }
        if (c === null) {
          d.note('meta.action_failed');
        } else if (o?.inTask !== true) {
          run(c);
        }
      }); // a tap has no caller; the outcome is on screen
    },
    port: {
      async onEnding(story) {
        const m = current;
        if (m !== null) {
          return m.onEnding(story);
        }
        const left = leaves;
        const c = await ready();
        if (disposed) {
          return;
        }
        if (leaves !== left) {
          c?.endingReached(story); // the end was left while the chunk loaded: no card, but Home's card button (F17)
          return;
        }
        if (c === null) {
          d.note('meta.card_later'); // the end stays; its card action imports again
          return;
        }
        await c.onEnding(story);
      },
      hintPort: () => current?.hintPort() ?? null,
      lineShown: () => current?.lineShown(),
      closeOverlays: () => {
        leaves += 1;
        current?.closeOverlays();
      },
    },
    dispose() {
      disposed = true;
      current?.dispose();
      current = null;
    },
  };
}

export function startApp(tg: TelegramClient): AppHandle {
  const vm = createViewModel({ timers: systemClock, lang: 'ru' });
  // K12: a stack made with another root would not seed the view itself.
  let game: Game | null = null;
  const screens: Screens = createScreens({
    back: tg.backButton,
    onView: (v) => {
      vm.screens = v;
      game?.screensChanged(v); // the explore panels and an exploration puzzle follow the stack
      gate.current()?.screensChanged(v); // a closed meta overlay drops its data; a root change drops late answers
    },
  });
  vm.screens = screens.view();
  vm.reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const http = createHttp({ initData: tg.initData, clock: systemClock });
  const api: Endpoints = createEndpoints(http);
  const settings: SettingsStore = createSettingsStore({ cloud: tg.cloud });
  const subscriptions: Unsubscribe[] = [];
  let reporter: StatsReporter | null = null;
  let data: BootData | null = null;
  const gate = createMetaGate({
    load: () => import('./meta.ts'),
    make: (m) => {
      const c = m.createMetaController({
        meta: m.createMetaEndpoints(http), // from the controller's chunk: the meta routes stay out of the entry (RULINGS 137)
        api,
        tg,
        screens,
        vm,
        reporter: { settle: (o) => reporter?.settle(o) ?? Promise.resolve('timeout') },
        storyTitle: (story, lang) => data?.catalog.stories.find((s) => s.id === story)?.title[lang] ?? null,
        clock: systemClock,
        newId: () => crypto.randomUUID(),
        host: location.host,
        onCards: () => {
          if (data !== null && screens.view().root.kind === 'home') {
            vm.cards = cardsOf(data);
          }
        },
      });
      c.boot();
      return c;
    },
    note: (key) => vm.showToast({ kind: 'note', key, message: t(vm.lang, key), sticky: false }),
    root: () => screens.view().root,
  });
  let engine: Promise<Game | null> | null = null;
  /** The boot list, handed to the first session that asks; later sessions list again. */
  let freshList: SaveListResponse | null = null;
  /** F1 step 5: a Home button runs once until Home is shown again. */
  let homeBusy = false;
  let disposed = false;

  const showNotice = (n: NonNullable<ViewModel['notice']>): void => {
    vm.notice = n;
    screens.setRoot({ kind: 'notice' });
  };

  const cardsOf = (d: BootData): StoryCardView[] =>
    d.catalog.stories.map((s, i) => {
      const cover = d.covers !== null && Object.hasOwn(d.covers.assets, s.cover) ? d.covers.assets[s.cover] : undefined;
      return {
        id: s.id,
        title: s.title[vm.lang],
        teaser: s.teaser[vm.lang],
        cover: cover === undefined ? null : { avif: cover.avif.url, webp: cover.webp.url },
        continue: summaryOf(d.list, s.id, 'auto') !== null,
        eager: i < 3,
        card: gate.current()?.hasCard(s.id) ?? false, // the stats arrive later: the controller's onCards redraws
      };
    });

  const showHome = (d: BootData): void => {
    vm.cards = cardsOf(d);
    vm.continueLabel = newestAuto(d.list, d.catalog)?.story.title[vm.lang] ?? null;
    vm.notice = null;
    vm.chapters = null;
    screens.setRoot({ kind: 'home' });
    tg.setClosingConfirmation(false);
    homeBusy = false;
    gate.current()?.homeShown(); // a held invite prompt shows over Home
  };

  const entitlements: Entitlements = {
    list: () => data?.products ?? null,
    async refresh() {
      const r = await api.getEntitlements();
      if (r.ok && data !== null) {
        data = { ...data, products: r.value.products };
      }
      return r.ok ? { ok: true, value: r.value.products } : r;
    },
  };

  /** One round of the boot reads, all at once; only the auth, catalog and saves are required. */
  const readAll = async (): Promise<Result<BootData, BootError>> => {
    const [auth, catalog, covers, list, ents, loaded] = await Promise.all([
      http.auth(),
      fetchJson(http, CATALOG_URL, decodeChapterCatalog),
      fetchJson(http, COVERS_URL, decodeCoverManifest),
      api.listSaves(),
      api.getEntitlements(),
      settings.load(),
    ]);
    if (!auth.ok) {
      return { ok: false, error: auth.error.kind === 'session-expired' ? { kind: 'expired' } : { kind: 'failed', detail: describe(auth.error) } };
    }
    if (!catalog.ok) {
      return { ok: false, error: { kind: 'failed', detail: catalog.error } };
    }
    if (!list.ok) {
      return { ok: false, error: { kind: 'failed', detail: describe(list.error) } };
    }
    if (!covers.ok) {
      console.warn('boot: covers unavailable', covers.error); // STORIES-PLAN F1′: cards without images
    }
    return {
      ok: true,
      value: {
        session: auth.value,
        catalog: catalog.value,
        covers: covers.ok ? covers.value : null,
        list: list.value,
        products: ents.ok ? ents.value.products : null,
        settings: loaded,
      },
    };
  };

  const wait = (ms: number): Promise<void> => new Promise((resolve) => systemClock.setTimeout(resolve, ms));

  /** F1 step 3's failure column: a refused initData is "Reopen"; anything else retries with backoff, then Retry. */
  const readWithRetry = async (): Promise<Result<BootData, BootError>> => {
    let r = await readAll();
    for (const ms of BOOT_RETRY_MS) {
      if (r.ok || r.error.kind === 'expired' || disposed) {
        return r;
      }
      await wait(ms);
      r = await readAll();
    }
    return r;
  };

  /** F1 step 3: the engine chunk, imported beside the boot reads; a failed import is tried again at the next tap. */
  let engineModule: Promise<EngineModule | null> | null = null;
  const importEngine = (): Promise<EngineModule | null> => {
    engineModule ??= import('./engine.ts').catch((e: unknown) => {
      console.error('boot: the engine chunk did not load', e);
      engineModule = null;
      return null;
    });
    return engineModule;
  };

  /** The Game, created once the engine chunk and the boot reads are both in; null when the chunk failed. */
  const engineOf = (d: BootData): Promise<Game | null> => {
    engine ??= importEngine().then((m) => {
      if (m === null || disposed) {
        engine = null; // F1 step 7: an engine chunk error shows the error notice; the next tap imports again
        return null;
      }
      const made = m.createEngine({
        tg,
        vm,
        screens,
        http,
        api,
        catalog: d.catalog,
        entitlements,
        saveList: () => {
          const fresh = freshList;
          freshList = null;
          return fresh !== null ? Promise.resolve({ ok: true, value: fresh }) : api.listSaves();
        },
        settings,
        reporter: { record: (e) => reporter?.record(e), flush: (o) => reporter?.flush(o) },
        accountLang: d.session.lang,
        unlock: unlockAudio,
        onExit: () => void refreshHome(),
      });
      made.game.attachMeta(gate.port); // before the game is published, so every session runs attached
      game = made.game;
      const served = http.skew(); // LBI D5: a skew the boot reads saw before the Game existed
      if (served !== null) {
        made.game.skewed(served, page);
      }
      vm.ui = made.ui;
      return made.game;
    });
    return engine;
  };

  /** Home again after a session: the saves are listed again for Continue and the cards. */
  const refreshHome = async (): Promise<void> => {
    const d = data;
    if (d === null) {
      return;
    }
    const list = await api.listSaves();
    const now = data ?? d;
    data = list.ok ? { ...now, list: list.value } : now;
    if (list.ok) {
      freshList = list.value;
    }
    showHome(data);
  };

  /** A paid chapter the entitlement list does not show owned (the server checks again at every load). */
  const locked = (d: BootData, id: ChapterId): boolean => {
    const entry = d.catalog.chapters.find((c) => c.id === id);
    return entry?.paid === true && !(d.products ?? []).some((p) => p.chapterId === id && p.owned);
  };

  /** A Home tap: the unlock first and synchronously (principle 5), then the engine, then the story. */
  const begin = (from: StartFrom): void => {
    unlockAudio();
    const d = data;
    if (homeBusy || d === null) {
      return;
    }
    homeBusy = true;
    void (async () => {
      const g = await engineOf(d);
      if (g === null) {
        showNotice({ kind: 'error', onaction: () => showHome(d) });
        return;
      }
      const r = await g.start(from);
      if (!r.ok) {
        homeBusy = false; // the game showed its notice; a later Home tap may run again
      }
    })(); // a tap has no caller; the outcome is on screen
  };

  const home: HomeActions = {
    continue() {
      const d = data;
      const newest = d === null ? null : newestAuto(d.list, d.catalog);
      if (newest === null) {
        unlockAudio();
        return;
      }
      begin({ kind: 'slot', story: newest.story.id, slot: 'auto' });
    },
    start(story) {
      const s = data?.catalog.stories.find((x) => x.id === story);
      const first = s?.chapters[0];
      if (first === undefined) {
        unlockAudio();
        return;
      }
      begin({ kind: 'new', story, chapter: first });
    },
    resume(story) {
      begin({ kind: 'slot', story, slot: 'auto' });
    },
    chapters(story) {
      const d = data;
      const s = d?.catalog.stories.find((x) => x.id === story);
      if (d === null || s === undefined) {
        return;
      }
      vm.chapters = {
        story: s.title[vm.lang],
        rows: s.chapters.map((id) => ({ id, title: d.catalog.chapters.find((c) => c.id === id)?.title[vm.lang] ?? id, locked: locked(d, id) })),
      };
      screens.push({ kind: 'chapters', story });
    },
    chapter(story, chapter) {
      const d = data;
      if (d === null || !locked(d, chapter)) {
        begin({ kind: 'new', story, chapter });
        return;
      }
      // D17: a locked row opens the paywall over Home (the Paywall is the engine's); the unlock starts the chapter.
      unlockAudio();
      void engineOf(d).then((g) => {
        if (g === null) {
          showNotice({ kind: 'error', onaction: () => showHome(d) });
        } else {
          g.offerChapter(story, chapter);
        }
      }); // a tap has no caller; the outcome is on screen
    },
  };

  const metaTaps: MetaTaps = {
    card: (story) => gate.tap((m) => void m.openCard(story)), // its failure shows its toast
    friends: () => gate.tap((m) => m.openFriends()),
    wallet: () => gate.tap((m) => m.openWallet()),
    policy: () => gate.tap((m) => m.openPolicy(), { inTask: true }),
  };

  const boot = async (): Promise<void> => {
    const r = await readWithRetry();
    if (disposed) {
      return;
    }
    if (!r.ok) {
      if (r.error.kind === 'expired') {
        showNotice({ kind: 'reopen', onclose: () => tg.close() });
      } else {
        console.error('boot: the boot reads failed', r.error.detail);
        showNotice({ kind: 'error', onaction: () => void boot() });
      }
      return;
    }
    const d = r.value;
    data = d;
    freshList = d.list;
    // K25: the settings' language, else the account's.
    vm.lang = d.settings.lang ?? d.session.lang;
    vm.settings = d.settings;
    vm.speed = d.settings.speed;
    if (reporter === null) {
      // STORIES-PLAN F1′ step 3: the reporter after auth, then the persisted queue goes out.
      reporter = createStatsReporter({
        api,
        device: tg.device,
        clock: systemClock,
        newId: () => crypto.randomUUID(),
        log: __TG_MOCK__ ? (msg) => console.info(msg) : undefined,
      });
      reporter.flush();
    }
    void gate.ready(); // beside the engine; a failure is silent here and imported again by the next meta tap
    showHome(d);
    void engineOf(d); // created ahead of the tap; a failure shows at the tap
  };

  const onLifecycle = (e: Lifecycle): void => {
    game?.onLifecycle(e);
    gate.current()?.onLifecycle(e);
    if (e === 'deactivated') {
      reporter?.flush({ keepalive: true });
    }
  };
  const onPageHide = (): void => {
    game?.pagehide();
    reporter?.flush({ keepalive: true });
  };

  subscriptions.push(tg.onLifecycle(onLifecycle));
  subscriptions.push(http.onSessionExpired(() => showNotice({ kind: 'reopen', onclose: () => tg.close() })));
  window.addEventListener('pagehide', onPageHide);
  subscriptions.push(() => window.removeEventListener('pagehide', onPageHide));
  // LBI D5/D6: the Game's reload port. A hash-only `replace` navigates within the document; the reload then loads the
  // new build with the latch in the fragment. Read by `engineOf`'s closure, which runs after this block.
  const page = {
    href: (): string => location.href,
    reload: (url: string): void => {
      location.replace(url);
      location.reload();
    },
  };
  subscriptions.push(http.onSkew((served) => game?.skewed(served, page)));
  // LBI D4: a lazy chunk a deploy removed carries no build header; the probe's answer does. Never `preventDefault`:
  // the failed import keeps today's error state until the recovery replaces the screen.
  const probe = (): void => void http.fetchAsset('/api/health', new AbortController().signal);
  window.addEventListener('vite:preloadError', probe);
  subscriptions.push(() => window.removeEventListener('vite:preloadError', probe));

  if (!tg.inTelegram) {
    // F1 step 1: opened outside Telegram (or by a reply-keyboard button): nothing to sign in with.
    showNotice({ kind: 'open_in_telegram' });
  } else {
    void importEngine(); // in parallel with the reads; its failure shows at the tap
    void boot(); // the outcome is on screen: Home, Reopen or the error notice
  }

  return {
    vm,
    home,
    metaTaps,
    game: () => game,
    meta: () => gate.current(),
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      for (const off of subscriptions.splice(0)) {
        off();
      }
      game?.dispose();
      gate.dispose();
      reporter?.dispose();
      screens.dispose();
      vm.destroy();
    },
  };
}
