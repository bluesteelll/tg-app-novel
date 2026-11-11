// L15b's puzzles e2e (PUZZLES-PLAN "Test strategy", e2e, as the META re-cut names them): the manor's explore section
// solved and failed, a reload back into the same room with the items, hint texts kept on the server while locked, a
// paid chapter's puzzle behind its entitlement, BackButton walking the rooms, the live texture bytes while exploring,
// and the hotspot buttons over their props under insets in landscape. ch1's solutions and texts are read in Node.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { APIRequestContext, Page } from '@playwright/test';

import { t, type UiKey } from '../src/i18n/index.ts';
import { decodeSave } from '../src/story/save-codec.ts';
import {
  arrangeOrder,
  atRest,
  catalogTitle,
  debugStats,
  devToken,
  enterManor,
  events,
  expect,
  grantChapter,
  hotspot,
  itemName,
  launch,
  playCh1ToGate,
  puzzleFrame,
  reachLine,
  solveOrder,
  take,
  tapHotspot,
  test,
  walk,
  worldSolutions,
  type E2eWindow,
} from './helpers.ts';

const ru = (key: UiKey, params?: Readonly<Record<string, string | number>>): string => t('ru', key, params);
/** The props the stage draws now, by id (the debug hook drops a removed prop when its batch starts). */
const propIds = (page: Page): Promise<string[]> =>
  page.evaluate(() => ((window as unknown as E2eWindow).__novelDebug?.propRects() ?? []).map((r) => r.prop));

const STORY_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'story');
const LINE_MS = 30_000;
/** scene/registry.ts's steady cap: what the stage may hold while exploring. */
const STEADY_CAP_BYTES = 33_554_432;
/** explore/controller.ts's minimum tap target, in CSS px. */
const MIN_TARGET_PX = 44;
/** The study's hotspots drawn over a prop (story/ch1/world.json): hotspot id, prop id. */
const STUDY_PROPS = [
  ['medal', 'medal_sun'],
  ['letter', 'note'],
] as const;

test.use({ reducedMotion: 'reduce' });

function mock(page: Page, action: 'minimize' | 'restore' | 'pressBack'): Promise<void> {
  return page.evaluate((a) => (window as unknown as E2eWindow).__tgMock[a](), action);
}

/** The manor card's Start, then the first line. */
async function startManor(page: Page): Promise<void> {
  const start = page.locator('[data-story="manor"]').getByRole('button', { name: ru('stories.start') });
  await expect(start).toBeVisible();
  await start.tap();
  await expect(page.locator('.dialogue[data-line-id]')).toBeVisible({ timeout: LINE_MS });
}

const line = (page: Page, id: string) => page.locator(`.dialogue[data-line-id="${id}"]`);

/** A story file read in Node (the story gate has checked its shape). */
function storyJson(file: string): unknown {
  return JSON.parse(readFileSync(path.join(STORY_DIR, file), 'utf8'));
}

/** The world of the server's `auto` of manor for this user: its room and held items, or null while there is none. */
async function autoWorld(request: APIRequestContext, token: string): Promise<{ room: string | null; held: readonly string[] } | null> {
  const res = await request.get('/api/saves/manor/auto', { headers: { Authorization: `Bearer ${token}` } });
  if (res.status() === 404) {
    return null;
  }
  expect(res.status(), 'GET /api/saves/manor/auto').toBe(200);
  const full = (await res.json()) as { body: string };
  const body = decodeSave(full.body);
  if (!body.ok) {
    throw new Error(`the server's auto does not decode: ${body.error.detail}`);
  }
  return { room: body.value.world.room, held: body.value.world.held };
}

/** Whether the BackButton shows: its last `web_app_setup_back_button` call (none yet: hidden). */
async function backShown(page: Page): Promise<boolean> {
  const last = (await events(page)).filter((e) => e.type === 'web_app_setup_back_button').at(-1);
  const data: unknown = last?.data;
  return typeof data === 'object' && data !== null && Reflect.get(data, 'is_visible') === true;
}

test('explore: search item puzzle solve', async ({ page }) => {
  test.setTimeout(180_000);
  await launch(page, 5001);
  await startManor(page);
  await playCh1ToGate(page);
  const { gate } = worldSolutions();
  await solveOrder(page, 'gate', gate);
  await tapHotspot(page, 'hall', 'gate'); // open now: `manor_out`
  await expect(line(page, 'ch1.manor_out.o001'), 'the gate opened by its order').toBeVisible({ timeout: LINE_MS });
});

test('explore: gate fail branch', async ({ page }) => {
  test.setTimeout(180_000);
  await launch(page, 5002);
  await startManor(page);
  await playCh1ToGate(page);
  const { gate } = worldSolutions();
  const wrong = [gate[1] ?? 0, gate[0] ?? 0, ...gate.slice(2)]; // two pieces swapped: never the solution
  const frame = puzzleFrame(page, 'gate');
  for (let left = 2; left >= 0; left--) {
    await arrangeOrder(page, 'gate', wrong);
    await frame.getByRole('button', { name: ru('puzzle.try') }).tap();
    if (left > 0) {
      await expect(frame.getByText(ru('puzzle.attempts_left', { n: left }))).toBeVisible({ timeout: LINE_MS });
    }
  }
  // The third wrong order fails the lock: its onFail plays the forced knot, then the gate is open.
  await expect(line(page, 'ch1.manor_gate_forced.f002')).toBeVisible({ timeout: LINE_MS });
  await reachLine(page, 'ch1.manor_gate_forced.f003');
  await page.locator('.dialogue .tap').tap(); // `# explore: manor`
  await tapHotspot(page, 'hall', 'gate');
  await expect(line(page, 'ch1.manor_out.o002'), 'the forced gate').toBeVisible({ timeout: LINE_MS });
});

test('explore: reload resumes in the same room with items', async ({ page, request }) => {
  test.setTimeout(150_000);
  await launch(page, 5003);
  await startManor(page);
  await enterManor(page);
  await walk(page, 'hall', 'to_study', 'study', 'to_hall');
  await take(page, 'study', 'medal');
  // B-001: the taken medal fades out of the picture now, not when the study is entered again.
  await expect.poll(() => propIds(page), { timeout: 10_000, message: "the taken medal's prop leaves the stage" }).not.toContain('medal_sun');
  const token = await devToken(request, 5003);
  await mock(page, 'minimize'); // `deactivated` writes the autosave (F3)
  await expect
    .poll(() => autoWorld(request, token), { timeout: 10_000, message: "the server's auto: the study, the sun medal held" })
    .toEqual({ room: 'study', held: ['medal_sun'] });
  await mock(page, 'restore');

  await page.reload();
  const resume = page.getByRole('button', { name: ru('tap.continue_story', { story: catalogTitle('manor') }) });
  await expect(resume).toBeVisible();
  await resume.tap();
  await expect(hotspot(page, 'study', 'drawer'), "the study's hotspots").toBeVisible({ timeout: LINE_MS });
  await expect(hotspot(page, 'study', 'to_hall')).toBeVisible();
  await expect(hotspot(page, 'study', 'medal'), 'the medal stays taken').toBeHidden();
  await expect.poll(() => propIds(page), { timeout: 10_000, message: "the taken medal's prop stays off the stage after the resume" }).not.toContain('medal_sun');
  await page.getByRole('button', { name: ru('explore.bar_inventory') }).tap();
  await expect(page.locator('.inventory .name', { hasText: itemName('medal_sun') })).toBeVisible();
});

test('puzzle: hint text absent while locked', async ({ page, request }) => {
  test.setTimeout(120_000);
  const world = storyJson('ch1/world.json') as { puzzles: { drawer: { hints: Array<{ ru: string }> } } };
  const texts = world.puzzles.drawer.hints.map((h) => h.ru);
  expect(texts, 'the drawer has three hint tiers').toHaveLength(3);
  await launch(page, 5004);
  await startManor(page);
  await enterManor(page);
  await walk(page, 'hall', 'to_study', 'study', 'to_hall');
  await tapHotspot(page, 'study', 'drawer');
  const frame = puzzleFrame(page, 'drawer');
  await expect(frame).toBeVisible();
  await frame.getByRole('button', { name: ru('puzzle.hint') }).tap();
  const ladder = frame.getByRole('region', { name: ru('hint.title') });
  await expect(ladder).toBeVisible();
  // The ladder renders no locked tier (HintLadder): only tier 1, usable, with no use button (no hint port in L15).
  await expect(ladder.locator('li[data-state]')).toHaveCount(1);
  await expect(ladder.locator('li[data-state="usable"]')).toHaveCount(1);
  await expect(ladder.locator('li[data-state="unlocked"], .use, .text')).toHaveCount(0);

  const html = await page.content();
  const res = await request.get('/api/puzzles/ch1.drawer?lang=ru', { headers: { Authorization: `Bearer ${await devToken(request, 5004)}` } });
  expect(res.status(), 'GET /api/puzzles/ch1.drawer?lang=ru').toBe(200);
  const answer = await res.text();
  for (const text of texts) {
    expect(html.includes(text), `a locked hint's text in the DOM: ${text}`).toBe(false);
    expect(answer.includes(text), `a locked hint's text in the puzzle's answer: ${text}`).toBe(false);
  }
});

test('puzzle: paid chapter puzzle needs entitlement', async ({ request }) => {
  const world = storyJson('ch2/world.json') as { puzzles: { cabinet: { params: { dials: number } } } };
  const answer = Array.from({ length: world.puzzles.cabinet.params.dials }, () => 0);
  const auth = { Authorization: `Bearer ${await devToken(request, 5005)}` };
  const attempt = () => request.post('/api/puzzles/ch2.cabinet/attempts', { headers: auth, data: { answer } });
  expect((await attempt()).status(), 'an attempt on ch2 before the purchase').toBe(403);
  await grantChapter(request, 5005, 'chapter:ch2');
  expect((await attempt()).status(), 'an attempt on ch2 after the purchase').toBe(200);
});

test('explore: back button walks rooms then hides', async ({ page }) => {
  test.setTimeout(120_000);
  await launch(page, 5006);
  await startManor(page);
  await enterManor(page);
  const depth = await page.evaluate(() => history.length);
  await expect.poll(() => backShown(page), { message: 'BackButton at the section start' }).toBe(false);
  await walk(page, 'hall', 'to_study', 'study', 'to_hall');
  await expect.poll(() => backShown(page), { message: 'BackButton in the study' }).toBe(true);
  await atRest(page); // a Back during the room's transition only completes it, as a tap does (app/game.ts D7)
  await mock(page, 'pressBack');
  await expect(hotspot(page, 'hall', 'to_study'), 'back in the hall').toBeVisible({ timeout: LINE_MS });
  await expect.poll(() => backShown(page), { message: 'BackButton back at the section start' }).toBe(false);
  expect(await page.evaluate(() => history.length), 'history untouched').toBe(depth);
});

test('explore: live texture bytes stay under the steady cap', async ({ page }) => {
  test.setTimeout(150_000);
  await launch(page, 5007);
  await startManor(page);
  await enterManor(page);
  const seen: Array<[string, number]> = [];
  const sample = async (room: string): Promise<void> => {
    await atRest(page);
    seen.push([room, (await debugStats(page)).scene.liveBytes]);
  };
  await sample('hall');
  await walk(page, 'hall', 'to_study', 'study', 'to_hall');
  await sample('study');
  await walk(page, 'study', 'to_hall', 'hall', 'to_cellar');
  await sample('hall');
  await tapHotspot(page, 'hall', 'to_cellar'); // the cellar's onEnter: the voice
  await reachLine(page, 'ch1.manor_cellar_voice.v007');
  await page.locator('.dialogue .tap').tap(); // `# explore: manor`: back in the cellar
  await expect(hotspot(page, 'cellar', 'to_hall')).toBeVisible({ timeout: LINE_MS });
  await sample('cellar');
  await walk(page, 'cellar', 'to_hall', 'hall', 'to_study');
  await sample('hall');
  console.log(`live texture bytes after each room change: ${seen.map(([r, b]) => `${r} ${b}`).join(', ')} (cap ${STEADY_CAP_BYTES})`);
  for (const [room, bytes] of seen) {
    expect(bytes, `live texture bytes in the ${room}`).toBeLessThanOrEqual(STEADY_CAP_BYTES);
  }
});

test('explore: hotspot buttons align with props under safe area and landscape', async ({ page }) => {
  test.setTimeout(120_000);
  await launch(page, 5008);
  await startManor(page);
  await enterManor(page);
  await walk(page, 'hall', 'to_study', 'study', 'to_hall');
  await page.evaluate(() =>
    (window as unknown as E2eWindow).__tgMock.setSafeArea({ top: 24, bottom: 34, left: 0, right: 0 }, { top: 46, bottom: 0, left: 0, right: 0 }),
  );
  await page.setViewportSize({ width: 812, height: 375 });
  await page.evaluate(() => (window as unknown as E2eWindow).__tgMock.setViewport(375));
  // The stage keeps its portrait frame inside the landscape viewport; it follows the new height in client px. Its
  // layout height is the design box's (Q67: a column narrower than the design width is drawn scaled as one unit).
  await expect
    .poll(() => page.locator('canvas').evaluate((el) => Math.round(el.getBoundingClientRect().height)), {
      message: 'the stage at the landscape height',
    })
    .toBe(375);
  await atRest(page);

  // Sizes in layout (design) px, where the controller applies its minimum; positions in client px.
  const fits = (button: number, prop: number): boolean =>
    prop >= MIN_TARGET_PX ? Math.abs(button - prop) <= 1 : Math.abs(button - MIN_TARGET_PX) <= 1;
  const misses = async (): Promise<string[]> => {
    // One read, so no resize falls between the rects and the scale: k = client px per layout px, measured on the canvas.
    const { rects, x0, y0, k } = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      const box = canvas?.getBoundingClientRect();
      return {
        rects: (window as unknown as E2eWindow).__novelDebug?.propRects() ?? [],
        x0: (box?.left ?? 0) + window.scrollX,
        y0: (box?.top ?? 0) + window.scrollY,
        k: canvas === null || box === undefined ? 1 : box.height / canvas.clientHeight,
      };
    });
    const out: string[] = [];
    for (const [id, prop] of STUDY_PROPS) {
      const r = rects.find((x) => x.prop === prop);
      const b = await hotspot(page, 'study', id).boundingBox();
      if (r === undefined || b === null) {
        out.push(`${id}: ${r === undefined ? 'no prop rect' : 'no button box'} at k=${k}`);
        continue;
      }
      // debugPropRects is the canvas origin + stage layout px: the offset from the origin scales by k on screen.
      const c = { x: x0 + (r.x - x0) * k, y: y0 + (r.y - y0) * k, w: r.w * k, h: r.h * k };
      const centred = Math.abs(b.x + b.width / 2 - (c.x + c.w / 2)) <= 1 && Math.abs(b.y + b.height / 2 - (c.y + c.h / 2)) <= 1;
      if (!centred || !fits(b.width / k, r.w) || !fits(b.height / k, r.h)) {
        out.push(`${id}: button ${b.x},${b.y} ${b.width}x${b.height}, prop ${c.x},${c.y} ${c.w}x${c.h} at k=${k}`);
      }
    }
    return out;
  };
  await expect.poll(misses, { timeout: 10_000, message: 'each hotspot button over its prop' }).toEqual([]);
});
