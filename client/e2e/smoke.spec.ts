// L15b's smoke e2e (PROTOTYPE-PLAN "Test strategy", e2e): the audio unlock inside the Start tap, save / reload / load,
// the lifecycle autosave, BackButton without history, the lifecycle pause and the overwrite ask's geometry. Each test
// plays as its own dev user. Buttons are found by role and the UI tables, a line by `.dialogue[data-line-id]`.
import type { APIRequestContext, Page } from '@playwright/test';

import { t, type UiKey } from '../src/i18n/index.ts';
import {
  catalogTitle,
  chunkFile,
  debugStats,
  devToken,
  events,
  expect,
  launch,
  lineId,
  reachLine,
  test,
  type E2eWindow,
} from './helpers.ts';

const ru = (key: UiKey, params?: Readonly<Record<string, string | number>>): string => t('ru', key, params);

/** A chapter load, the scene mount and the first batch. */
const LINE_MS = 30_000;

/** A construction of the page's AudioContext, with the type of the event being dispatched at that moment. */
type AudioConstruction = { during: string | null };

/** Runs before the page's scripts (Playwright serialises it): every AudioContext constructed is recorded. */
function recordAudioContexts(): void {
  const made: AudioConstruction[] = [];
  Object.defineProperty(window, '__e2eAudio', { value: made });
  const Native = window.AudioContext;
  window.AudioContext = class extends Native {
    constructor(options?: AudioContextOptions) {
      // `window.event` is the event whose listener runs now; a construction in a later task sees none.
      made.push({ during: window.event?.type ?? null });
      super(options);
    }
  };
}

function audioContexts(page: Page): Promise<AudioConstruction[]> {
  return page.evaluate(() => (window as unknown as { __e2eAudio: AudioConstruction[] }).__e2eAudio);
}

function mock(page: Page, action: 'minimize' | 'restore' | 'pressBack'): Promise<void> {
  return page.evaluate((a) => (window as unknown as E2eWindow).__tgMock[a](), action);
}

/** The manor card's Start: the first chapter, the tap that unlocks audio. */
async function startManor(page: Page): Promise<void> {
  const start = page.locator('[data-story="manor"]').getByRole('button', { name: ru('stories.start') });
  await expect(start).toBeVisible();
  await start.tap();
  await expect(page.locator('.dialogue[data-line-id]')).toBeVisible({ timeout: LINE_MS });
}

/** The quick bar's Menu, then the menu's Saves. */
async function openSaves(page: Page): Promise<void> {
  await page.getByRole('button', { name: ru('quick.menu') }).tap();
  await page.getByRole('button', { name: ru('menu.saves') }).tap();
  await expect(page.locator('[data-slot="s1"]')).toBeVisible();
}

/** The server's `auto` of manor for this user: its line, or null while there is none. */
async function serverAutoLine(request: APIRequestContext, token: string): Promise<string | null> {
  const res = await request.get('/api/saves', { headers: { Authorization: `Bearer ${token}` } });
  expect(res.status(), 'GET /api/saves').toBe(200);
  const body = (await res.json()) as { slots: Array<{ storyId: string; slot: string; lineId: string | null }> };
  return body.slots.find((s) => s.storyId === 'manor' && s.slot === 'auto')?.lineId ?? null;
}

/** `deactivated` writes the autosave (F3); the server's copy is polled until it holds `line`, then the app comes back. */
async function autosavedAt(page: Page, request: APIRequestContext, uid: number, line: string): Promise<void> {
  const token = await devToken(request, uid);
  await mock(page, 'minimize');
  await expect.poll(() => serverAutoLine(request, token), { timeout: 10_000, message: 'the lifecycle autosave' }).toBe(line);
  await mock(page, 'restore');
}

/** After a reload: Home's Continue (the newest autosave, D16) resumes manor. */
async function continueFromHome(page: Page): Promise<void> {
  const resume = page.getByRole('button', { name: ru('tap.continue_story', { story: catalogTitle('manor') }) });
  await expect(resume).toBeVisible();
  await resume.tap();
  await expect(page.locator('.dialogue[data-line-id]')).toBeVisible({ timeout: LINE_MS });
}

test('tap-to-start unlocks audio only after the gesture', async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(recordAudioContexts);
  // Critique W1: the engine chunk is held until after the tap. Without the unlock in the tap, the first context is
  // made by the engine's arrival, a network task outside the click; with the chunk already in, its continuation would
  // still run in the click's own microtask checkpoint and could not tell the two apart.
  const engine = `/${chunkFile('src/app/engine.ts')}`;
  let release = (): void => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    (url) => url.pathname === engine,
    async (route) => {
      await released;
      await route.fallback(); // on to the fixture's route, which continues a loopback request
    },
  );
  try {
    await launch(page, 2001);
    const start = page.locator('[data-story="manor"]').getByRole('button', { name: ru('stories.start') });
    await expect(start).toBeVisible();
    expect(await page.evaluate(() => '__novelDebug' in window), 'the engine is still held').toBe(false);
    expect(await audioContexts(page), 'before the tap').toEqual([]);
    await start.tap();
    expect(await audioContexts(page), 'inside the tap').toEqual([{ during: 'click' }]);
    release();
    await expect(page.locator('.dialogue[data-line-id]')).toBeVisible({ timeout: LINE_MS });
    await expect.poll(async () => (await debugStats(page)).audio?.state ?? null, { timeout: 10_000 }).toBe('running');
    expect(await audioContexts(page), 'the engine reuses the one context').toEqual([{ during: 'click' }]);
  } finally {
    release();
  }
});

test.describe(() => {
  test.use({ reducedMotion: 'reduce' });

  test('play choose save reload load resumes at same line', async ({ page, request }) => {
    test.setTimeout(180_000);
    await launch(page, 2002);
    await startManor(page);
    const saved = 'ch1.arrival.a010'; // after the trust pick
    await reachLine(page, saved, { 'ch1.arrival.c001': 0 });
    await openSaves(page);
    const s1 = page.locator('[data-slot="s1"]');
    await s1.getByRole('button', { name: ru('saves.save') }).tap();
    await expect(s1).toContainText(catalogTitle('ch1'));
    await mock(page, 'pressBack');
    await mock(page, 'pressBack');
    const later = 'ch1.arrival.a012';
    await reachLine(page, later);
    await autosavedAt(page, request, 2002, later);

    await page.reload();
    await continueFromHome(page);
    await expect.poll(() => lineId(page)).toBe(later);
    await openSaves(page);
    await s1.getByRole('button', { name: ru('saves.load') }).tap();
    await expect.poll(() => lineId(page), { timeout: LINE_MS }).toBe(saved);
  });

  test('autosave resume after reload', async ({ page, request }) => {
    test.setTimeout(120_000);
    await launch(page, 2003);
    await startManor(page);
    const line = 'ch1.arrival.a005';
    await reachLine(page, line);
    await autosavedAt(page, request, 2003, line);

    await page.reload();
    await continueFromHome(page);
    await expect.poll(() => lineId(page)).toBe(line);
  });

  test('saves: overwrite ask keeps yes below save', async ({ page }) => {
    test.setTimeout(90_000);
    const puts: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'PUT' && new URL(r.url()).pathname === '/api/saves/manor/s1') {
        puts.push(r.url());
      }
    });
    await launch(page, 2006);
    await startManor(page);
    await openSaves(page);
    const s1 = page.locator('[data-slot="s1"]');
    const save = s1.getByRole('button', { name: ru('saves.save') });
    await save.tap();
    await expect(s1).toContainText(catalogTitle('ch1'));
    expect(puts, 'the fill').toHaveLength(1);

    const r = await save.boundingBox();
    if (r === null) {
      throw new Error('Save has no box');
    }
    await save.tap();
    const yes = s1.getByRole('button', { name: ru('saves.yes') });
    await expect(yes).toBeVisible();
    const y = await yes.boundingBox();
    expect(y?.y ?? 0, "Yes starts below Save's former rectangle").toBeGreaterThanOrEqual(r.y + r.height);
    await s1.getByRole('button', { name: ru('saves.no') }).tap();
    await expect(yes).toBeHidden();

    // A double tap on an occupied row's Save: the first asks, the second meets the question or No, never Yes.
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    await page.touchscreen.tap(cx, cy);
    await page.touchscreen.tap(cx, cy);
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 500)));
    expect(puts, 'no write after the fill').toHaveLength(1);
  });
});

test('back button closes overlays without history', async ({ page }) => {
  test.setTimeout(90_000);
  await launch(page, 2004);
  await startManor(page);
  const depth = await page.evaluate(() => history.length);
  const from = (await events(page)).length;
  const menu = page.getByRole('heading', { name: ru('menu.title') });
  const settings = page.getByRole('heading', { name: ru('settings.title') });
  await page.getByRole('button', { name: ru('quick.menu') }).tap();
  await expect(menu).toBeVisible();
  // Settings opens from the menu, so two overlays are stacked; the quick bar is under the menu's layer.
  await page.getByRole('button', { name: ru('menu.settings') }).tap();
  await expect(settings).toBeVisible();

  await mock(page, 'pressBack');
  await expect(settings).toBeHidden();
  await expect(menu).toBeVisible();
  await mock(page, 'pressBack');
  await expect(menu).toBeHidden();
  await expect(page.locator('.dialogue[data-line-id]')).toBeVisible();

  expect(await page.evaluate(() => history.length), 'history untouched').toBe(depth);
  const back = (await events(page)).slice(from).filter((e) => e.type === 'web_app_setup_back_button');
  expect(back.map((e) => e.data)).toEqual([{ is_visible: true }, { is_visible: false }]);
});

test('deactivated pauses audio, activated resumes', async ({ page }) => {
  test.setTimeout(120_000);
  await launch(page, 2005);
  await startManor(page);
  await reachLine(page, 'ch1.arrival.a013');
  // The next tap enters manor_arrive, whose `# scene: hall` fades for 800 ms (STAGING-DSL default).
  await page.locator('.dialogue .tap').tap();
  await expect
    .poll(async () => (await debugStats(page)).scene.activeTimelines, { intervals: [50], message: 'the transition started' })
    .toBeGreaterThanOrEqual(1);
  await mock(page, 'minimize');
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 1500)));
  const held = await debugStats(page);
  expect(held.scene.activeTimelines, 'the transition holds while deactivated').toBeGreaterThanOrEqual(1);
  expect(held.audio?.state, 'audio suspended').toBe('suspended');

  await mock(page, 'restore');
  await expect.poll(async () => (await debugStats(page)).scene.activeTimelines, { timeout: 5_000 }).toBe(0);
  await expect.poll(async () => (await debugStats(page)).audio?.state ?? null, { timeout: 5_000 }).toBe('running');
});
