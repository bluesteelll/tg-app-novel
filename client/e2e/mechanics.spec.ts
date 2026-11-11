// GM3s's mechanics e2e (engine plan §12 GM3s commit (4)): the cue stage plays the demo walk's cues on its layer. The
// stage's debug attributes (§8.6, written only under `__TG_MOCK__`, which the e2e build compiles in) are the evidence:
// `data-cues-played` (the last keys played), `data-cue-orphans` (cues no stage played) and `data-cue-fallbacks`
// (cues whose target was missing). The room layer's exit is RULINGS 195's fallback: the live root leaves the document
// at once and the stage plays its exit on the root's ghost, so the evidence is the order of the DOM records.
import type { Locator, Page } from '@playwright/test';

import { t } from '../src/i18n/index.ts';
import {
  atRest,
  catalogTitle,
  chunkFile,
  debugStats,
  enterManor,
  expect,
  grantChapter,
  holdRequests,
  hotspot,
  hotspotLabel,
  itemName,
  launch,
  plantPending,
  playCh1ToGate,
  puzzleFrame,
  reachLine,
  solveOrder,
  take,
  tapHotspot,
  test,
  walk,
  worldSolutions,
} from './helpers.ts';
import type { E2eWindow } from './helpers.ts';

const LINE_MS = 30_000;
/** A cue plays one flush after its emit; its motion lasts at most a second (§8.4). */
const CUE_MS = 20_000;

const stage = (page: Page): Locator => page.locator('[data-cue-stage]');

/** The keys the stage played, oldest first (§8.6 `data-cues-played`). */
async function played(page: Page): Promise<string[]> {
  return ((await stage(page).getAttribute('data-cues-played')) ?? '').split(' ').filter((k) => k !== '');
}

/** A debug counter of the mounted stage; NaN when the stage is not mounted. */
async function counter(page: Page, name: 'data-cue-orphans' | 'data-cue-fallbacks'): Promise<number> {
  return Number(await stage(page).getAttribute(name));
}

/** The manor card's Start, then the first line. */
async function startManor(page: Page): Promise<void> {
  const start = page.locator('[data-story="manor"]').getByRole('button', { name: t('ru', 'stories.start') });
  await expect(start).toBeVisible();
  await start.tap();
  await expect(page.locator('.dialogue[data-line-id]')).toBeVisible({ timeout: LINE_MS });
}

/** The way out of the manor: the gate's order solved, then the open gate (`manor_out`, the section's leave). */
async function leaveManor(page: Page): Promise<void> {
  await solveOrder(page, 'gate', worldSolutions().gate);
  await tapHotspot(page, 'hall', 'gate');
  await expect.poll(() => played(page), { timeout: CUE_MS, message: 'move:leave played' }).toContain('move:leave');
}

type RootWatch = { readonly order: string[]; inertRoots: number };
type WatchWindow = Window & { __rootWatch?: RootWatch };

/**
 * Records, in order, a family root leaving the document, a root ghost added on the stage layer and that ghost
 * leaving; and counts each check that found an attached `[data-cue-root]` carrying `inert` (nothing outros now).
 */
function watchRoots(page: Page): Promise<void> {
  return page.evaluate(() => {
    const watch: RootWatch = { order: [], inertRoots: 0 };
    (window as WatchWindow).__rootWatch = watch;
    const holds = (n: Node, sel: string): boolean => n instanceof Element && (n.matches(sel) || n.querySelector(sel) !== null);
    new MutationObserver((records) => {
      for (const r of records) {
        r.removedNodes.forEach((n) => {
          if (holds(n, '[data-cue-root]')) {
            watch.order.push('root-removed');
          }
          if (holds(n, '.cue-root-ghost')) {
            watch.order.push('ghost-removed');
          }
        });
        r.addedNodes.forEach((n) => {
          if (holds(n, '.cue-root-ghost') && (n.parentElement?.closest('[data-cue-stage]') ?? null) !== null) {
            watch.order.push('ghost-added');
          }
        });
      }
      if (document.querySelector('[data-cue-root][inert]') !== null) {
        watch.inertRoots += 1;
      }
    }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['inert'] });
  });
}

const rootWatch = (page: Page): Promise<RootWatch | undefined> => page.evaluate(() => (window as WatchWindow).__rootWatch);

test('mechanics: a take plays its cue', async ({ page }) => {
  test.setTimeout(120_000);
  await launch(page, 9701);
  await startManor(page);
  await enterManor(page);
  await walk(page, 'hall', 'to_study', 'study', 'to_hall');
  await take(page, 'study', 'medal');
  await expect.poll(() => played(page), { timeout: CUE_MS, message: 'the take played' }).toContain('fact:held:added');
});

test("mechanics: an event knot's start plays its cue and the room layer leaves with motion", async ({ page }) => {
  test.setTimeout(120_000);
  await launch(page, 9702);
  await startManor(page);
  await enterManor(page);
  await expect(stage(page), 'the cue stage is mounted before the tap').toBeAttached({ timeout: CUE_MS });
  await watchRoots(page);
  // The cellar's onEnter starts its voice knot: the rooms leave at the tap's flush.
  await tapHotspot(page, 'hall', 'to_cellar');
  await expect
    .poll(async () => (await rootWatch(page))?.order, { timeout: CUE_MS, message: 'the root left, then its ghost played and left' })
    .toEqual(['root-removed', 'ghost-added', 'ghost-removed']);
  expect((await rootWatch(page))?.inertRoots, 'no attached family root outros').toBe(0);
  await expect.poll(() => played(page), { timeout: CUE_MS, message: "the knot's start played" }).toContain('fact:story:added');
});

test('mechanics: a section leave plays move:leave', async ({ page }) => {
  test.setTimeout(240_000);
  await launch(page, 9703);
  await startManor(page);
  await playCh1ToGate(page);
  await leaveManor(page);
  await expect(page.locator('.dialogue[data-line-id^="ch1.manor_out."]'), 'the gate opened').toBeVisible({ timeout: LINE_MS });
});

test('mechanics: no cue is orphaned across the demo walk', async ({ page }) => {
  test.setTimeout(300_000);
  await launch(page, 9704);
  await startManor(page);
  // playCh1ToEnd's walk, read while the stage is mounted: once the leave played, and again before the END.
  await playCh1ToGate(page);
  await leaveManor(page);
  expect([await counter(page, 'data-cue-orphans'), await counter(page, 'data-cue-fallbacks')], 'orphans, fallbacks').toEqual([0, 0]);
  await reachLine(page, 'ch1.street.s018');
  expect([await counter(page, 'data-cue-orphans'), await counter(page, 'data-cue-fallbacks')], 'orphans, fallbacks').toEqual([0, 0]);
  await page.locator('.dialogue .tap').tap(); // END
});

// ---------------------------------------------------------------------------------------------------------------
// GM3u (engine plan §6.1 UI; RULINGS 226 Q2): the item ribbon's selection and a use, in the real client. Every locator
// of this test's own taps is scoped to the live explore root: a ghost on the stage layer carries no `data-cue*` and lives
// under `[data-cue-stage]`, so it never matches (Q62; the stage layer's `aria-hidden` is the other guard).

/** The live explore layer. */
const rooms = (page: Page): Locator => page.locator('.layer[data-cue-root]');
/** A held item's slot in the live ribbon. */
const ribbonSlot = (page: Page, item: string): Locator =>
  rooms(page).locator('[data-cue-ribbon]').getByRole('button', { name: itemName(item), exact: true });
/** A hotspot of the current room, in the live layer. */
const liveHotspot = (page: Page, room: string, id: string): Locator =>
  rooms(page).getByRole('button', { name: hotspotLabel(room, id), exact: true });

test('mechanics: select a medal, tap the gate, its slot fills', async ({ page }) => {
  test.setTimeout(180_000);
  await launch(page, 9705);
  await startManor(page);
  await enterManor(page);
  await walk(page, 'hall', 'to_study', 'study', 'to_hall');
  await take(page, 'study', 'medal');
  await walk(page, 'study', 'to_hall', 'hall', 'gate');
  // The medal's slot selects it.
  const medal = ribbonSlot(page, 'medal_sun');
  await expect(medal).toBeVisible({ timeout: CUE_MS });
  await atRest(page);
  await medal.tap();
  await expect(medal).toHaveAttribute('aria-pressed', 'true');
  // A use the hall refuses (the inscription is a look with no rule for the medal, and ch1 writes no refusal text): the
  // UI's default words, and the selection put back. (Critique W2: the mechanics table is read here, inside the test, so
  // where it is absent this file still loads and only this test is red.)
  const { mechT } = await import('../src/i18n/mechanics.ts');
  await atRest(page);
  await liveHotspot(page, 'hall', 'inscription').tap();
  await expect(page.locator('.toast', { hasText: mechT('ru', 'mech.use_refused') })).toBeVisible({ timeout: CUE_MS });
  await expect(medal).toHaveAttribute('aria-pressed', 'false');
  // Selected again, the gate takes it into its first slot (the lock fit): the medal leaves the hands.
  await atRest(page);
  await medal.tap();
  await expect(medal).toHaveAttribute('aria-pressed', 'true');
  await atRest(page);
  await liveHotspot(page, 'hall', 'gate').tap();
  await expect(medal).toBeHidden({ timeout: CUE_MS });
  await expect
    .poll(() => played(page), { timeout: CUE_MS, message: 'the selection and the fill played' })
    .toEqual(expect.arrayContaining(['ui-state:select', 'ui-state:deselect', 'fact:slot:added']));
  // The gate again, nothing selected: its lock panel shows the medal in the first of its three slots.
  await atRest(page);
  await liveHotspot(page, 'hall', 'gate').tap();
  const slots = page.locator('.lock .slot');
  await expect(slots).toHaveCount(3, { timeout: CUE_MS });
  await expect(slots.nth(0)).toHaveClass(/\bfilled\b/);
  await expect(slots.nth(0).locator('.name')).toHaveText(itemName('medal_sun'));
  for (const i of [1, 2]) {
    await expect(slots.nth(i)).not.toHaveClass(/\bfilled\b/);
  }
  await expect(page.locator('.held-item', { hasText: itemName('medal_sun') })).toHaveCount(0);
  expect([await counter(page, 'data-cue-orphans'), await counter(page, 'data-cue-fallbacks')], 'orphans, fallbacks').toEqual([0, 0]);
});

// ---------------------------------------------------------------------------------------------------------------
// GM3p (engine plan §8.3, §8.5): the puzzle frame is a cue family. Its controls are found by their names (a ghost on
// the stage layer sits under the layer's `aria-hidden`, so a role locator never matches one).

/** ch2's carried values (memory.spec.ts's): the trust picks of ch1. */
const CH2_CARRY = { g_gate_forced: false, g_manor_trust: 2, g_manor_promise: true, g_tide_trust_keeper: 0 } as const;

test("mechanics: a linear puzzle's give-up ask and no play their cues", async ({ page, request }) => {
  test.setTimeout(180_000);
  // ch2 owned (a simulated payment through the real webhook), then F4's pending start, so Continue opens it.
  await grantChapter(request, 9706, 'chapter:ch2');
  await plantPending(request, 9706, 'ch2', CH2_CARRY);
  await launch(page, 9706);
  const resume = page.getByRole('button', { name: t('ru', 'tap.continue_story', { story: catalogTitle('manor') }) });
  await expect(resume).toBeVisible({ timeout: LINE_MS });
  await resume.tap();
  // The archive's last line, then the tap that yields `# puzzle: cabinet`: a linear frame with Give up.
  await reachLine(page, 'ch2.archive_cabinet.c012');
  await page.locator('.dialogue .tap').tap();
  const ask = page.getByRole('button', { name: t('ru', 'puzzle.give_up'), exact: true });
  await expect(ask).toBeVisible({ timeout: LINE_MS });
  await ask.tap();
  const no = page.getByRole('button', { name: t('ru', 'saves.no'), exact: true });
  await expect(no).toBeVisible();
  await no.tap();
  await expect(ask, 'No keeps the frame and asks again').toBeVisible();
  await expect
    .poll(() => played(page), { timeout: CUE_MS, message: 'the ask and the no played' })
    .toEqual(expect.arrayContaining(['ui:give-up-ask', 'ui:give-up-no']));
  expect([await counter(page, 'data-cue-orphans'), await counter(page, 'data-cue-fallbacks')], 'orphans, fallbacks').toEqual([0, 0]);
});

/** The Telegram BackButton, pressed (the mock's native side). */
function pressBack(page: Page): Promise<void> {
  return page.evaluate(() => (window as unknown as E2eWindow).__tgMock.pressBack());
}

test('mechanics: a tap on the room right after a puzzle closes reaches the room', async ({ page }) => {
  test.setTimeout(180_000);
  await launch(page, 9707);
  await startManor(page);
  await enterManor(page);
  await walk(page, 'hall', 'to_study', 'study', 'to_hall');
  // The drawer's code lock, its attempt held at the network: Try with the dials at 0-0-0-0 (a wrong answer, later).
  const attempt = await holdRequests(page, '**/api/puzzles/*/attempts');
  await tapHotspot(page, 'study', 'drawer');
  const frame = puzzleFrame(page, 'drawer');
  await expect(frame).toBeVisible({ timeout: LINE_MS });
  await frame.getByRole('button', { name: t('ru', 'puzzle.try') }).tap();
  await attempt.requested;
  // X8: Back closes the exploration puzzle with the answer in flight; the frame goes at once, the room takes taps.
  await pressBack(page);
  await expect(frame).toBeHidden({ timeout: CUE_MS });
  // A tap on the study (W1: the drawer's own room, so the late answer's cue lands on the shown drawer): the medal is
  // taken while the attempt is still held.
  await take(page, 'study', 'medal');
  await expect.poll(() => played(page), { timeout: CUE_MS, message: 'the take played' }).toContain('fact:held:added');
  // The answer arrives: a wrong attempt, its world cue on the drawer's hotspot.
  await attempt.release();
  await expect.poll(() => played(page), { timeout: CUE_MS, message: 'the late attempt played' }).toContain('fact:attempt:added');
  await expect(frame, 'no second frame').toBeHidden();
  expect([await counter(page, 'data-cue-orphans'), await counter(page, 'data-cue-fallbacks')], 'orphans, fallbacks').toEqual([0, 0]);
});

test('mechanics: the first puzzle of a page load holds a motion while its frame loads and slides in on its frame', async ({ page }) => {
  test.setTimeout(180_000);
  // The puzzle host's chunk held from the page's load (the yields prefetch it) until 1.5 s after the drawer's tap.
  const host = await holdRequests(page, `**/${chunkFile('src/ui/puzzles/PuzzleHost.svelte')}`);
  await launch(page, 9708);
  await startManor(page);
  await enterManor(page);
  await walk(page, 'hall', 'to_study', 'study', 'to_hall');
  await tapHotspot(page, 'study', 'drawer');
  await page.waitForTimeout(1500);
  await host.release();
  await expect(puzzleFrame(page, 'drawer')).toBeVisible({ timeout: LINE_MS });
  // The frame's load hold, its appearance on its own frame, then its type UI: in that order.
  const order = ['ui-state:waiting@puzzle', 'ui-state:waited@puzzle', 'ui-state:panel-open@puzzle', 'puzzle:opened'];
  await expect
    .poll(async () => (await played(page)).filter((k) => order.includes(k)), { timeout: CUE_MS, message: "the frame's hold, appearance and opening" })
    .toEqual(order);
  expect([await counter(page, 'data-cue-orphans'), await counter(page, 'data-cue-fallbacks')], 'orphans, fallbacks').toEqual([0, 0]);
});

test('mechanics: a hint ladder that cannot load plays its failure cue', async ({ page }) => {
  test.setTimeout(180_000);
  // The drawer's status request fails at the network: the ladder's first answer is its failure line.
  await page.route(/\/api\/puzzles\/ch1\.drawer\?/, (route) => route.abort());
  await launch(page, 9709);
  await startManor(page);
  await enterManor(page);
  await walk(page, 'hall', 'to_study', 'study', 'to_hall');
  await tapHotspot(page, 'study', 'drawer');
  const frame = puzzleFrame(page, 'drawer');
  await expect(frame).toBeVisible({ timeout: LINE_MS });
  await frame.getByRole('button', { name: t('ru', 'puzzle.hint'), exact: true }).tap();
  await expect(frame.getByRole('alert'), "the ladder's failure line").toHaveText(t('ru', 'hint.failed'), { timeout: CUE_MS });
  await expect.poll(() => played(page), { timeout: CUE_MS, message: 'the failure played' }).toContain('puzzle:hint-failed');
  expect([await counter(page, 'data-cue-orphans'), await counter(page, 'data-cue-fallbacks')], 'orphans, fallbacks').toEqual([0, 0]);
});

// ---------------------------------------------------------------------------------------------------------------
// GM3b (engine plan §6.4): the drawer's open state is a picture of its own, and a room's state pictures are preloaded
// after its neighbours' backgrounds (RULINGS 246 W1). All three run at the default phone viewport, where one client
// px is one layout px.

/** helpers.ts's step bound. */
const STEP_MS = 20_000;

/** The props the stage draws now, by id, with their stage boxes (`__novelDebug.propRects`). */
const propRects = (page: Page): Promise<ReadonlyArray<{ prop: string; x: number; y: number; w: number; h: number }>> =>
  page.evaluate(() => (window as unknown as E2eWindow).__novelDebug?.propRects() ?? []);

/** The last wait of the views (`panel: null`) the stage played: a room or state batch's load hold. */
const lastWait = async (page: Page): Promise<string | undefined> =>
  (await played(page)).filter((k) => k === 'ui-state:waiting' || k === 'ui-state:waited').at(-1);

/**
 * Counts every request matching `url` from now on and, with `hold`, keeps each until `release()`. Routing disables the
 * HTTP cache (Playwright's `route`), so every fetch of the file is counted.
 */
async function counted(page: Page, url: string, hold = false): Promise<{ count(): number; release(): void }> {
  let n = 0;
  let open = (): void => undefined;
  const opened = hold ? new Promise<void>((resolve) => (open = resolve)) : Promise.resolve();
  await page.route(url, async (route) => {
    n += 1;
    await opened;
    await route.fallback();
  });
  return { count: () => n, release: () => open() };
}

/** `atRest` with the `held` loads allowed: no other load and no transition, on two reads 100 ms apart. */
async function settledWith(page: Page, held: () => number): Promise<void> {
  const still = async (): Promise<boolean> => {
    const s = (await debugStats(page)).scene;
    return s.pendingLoads === held() && s.activeTimelines === 0;
  };
  await expect
    .poll(async () => (await still()) && (await page.waitForTimeout(100).then(still)), {
      timeout: STEP_MS,
      message: 'the scene at rest but for the held loads',
    })
    .toBe(true);
}

/** helpers.ts's private `solveCode` (each dial stepped up to its digit, then Try): no wait on rest. */
async function solveDrawer(page: Page): Promise<void> {
  const frame = puzzleFrame(page, 'drawer');
  await expect(frame).toBeVisible({ timeout: STEP_MS });
  for (const [i, want] of worldSolutions().drawer.entries()) {
    const dial = frame.locator('.dial').nth(i);
    const digit = dial.locator('.digit');
    await expect(digit).toBeVisible({ timeout: STEP_MS });
    for (let n = 0; n < 10 && Number(await digit.textContent()) !== want; n++) {
      const before = await digit.textContent();
      await dial.getByRole('button', { name: t('ru', 'puzzle.dial_up') }).tap();
      await expect(digit).not.toHaveText(before ?? '');
    }
    await expect(digit).toHaveText(String(want));
  }
  await frame.getByRole('button', { name: t('ru', 'puzzle.try') }).tap();
  await expect(frame).toBeHidden({ timeout: STEP_MS });
}

/** The open drawer's picture, drawn on the drawer's anchor: centred on the drawer's button (one box, cover-mapped). */
async function drawerOpenAtAnchor(page: Page): Promise<boolean> {
  const r = (await propRects(page)).find((x) => x.prop === 'drawer_open');
  const b = await hotspot(page, 'study', 'drawer').boundingBox();
  return r !== undefined && b !== null && Math.abs(r.x + r.w / 2 - (b.x + b.width / 2)) <= 1 && Math.abs(r.y + r.h / 2 - (b.y + b.height / 2)) <= 1;
}

test('mechanics: opening the drawer changes its picture at once', async ({ page }) => {
  test.setTimeout(180_000);
  await launch(page, 9710);
  await startManor(page);
  await enterManor(page);
  await walk(page, 'hall', 'to_study', 'study', 'to_hall');
  await tapHotspot(page, 'study', 'drawer');
  expect((await propRects(page)).map((r) => r.prop), 'the shut drawer draws nothing').not.toContain('drawer_open');
  await solveDrawer(page);
  await expect.poll(() => played(page), { timeout: CUE_MS, message: 'the drawer solved' }).toContain('puzzle:solved');
  // The close-up out, then the state batch: the open drawer is drawn on the drawer's anchor with no room change.
  await expect.poll(() => drawerOpenAtAnchor(page), { timeout: CUE_MS, message: 'drawer_open at the drawer' }).toBe(true);
  expect(await counter(page, 'data-cue-fallbacks'), 'fallbacks').toBe(0);
});

test('mechanics: a state picture that loads holds a motion at its anchor', async ({ page }) => {
  test.setTimeout(180_000);
  // The open drawer's picture held from its first request (the study's `state:` preload) until 1.5 s after the solve.
  const open = await counted(page, '**/assets/prop-drawer_open-*', true);
  await launch(page, 9711);
  await startManor(page);
  await enterManor(page);
  await walk(page, 'hall', 'to_study', 'study', 'to_hall');
  // The study's batch is over and its preload holds the picture (cut addendum W1): a raw tap, so no wait on rest.
  await settledWith(page, open.count);
  await hotspot(page, 'study', 'drawer').tap();
  await solveDrawer(page);
  await expect.poll(() => played(page), { timeout: CUE_MS, message: 'the drawer solved' }).toContain('puzzle:solved');
  await page.waitForTimeout(1000);
  expect(await lastWait(page), 'the state batch holds while its picture loads').toBe('ui-state:waiting');
  await page.waitForTimeout(500);
  open.release();
  await expect.poll(() => lastWait(page), { timeout: CUE_MS, message: 'the hold ends when the picture lands' }).toBe('ui-state:waited');
  await expect.poll(async () => (await propRects(page)).map((r) => r.prop), { timeout: CUE_MS, message: 'drawer_open drawn' }).toContain('drawer_open');
  expect(await counter(page, 'data-cue-fallbacks'), 'fallbacks').toBe(0);
});

test("mechanics: the cellar's background is preloaded in the hall after the study", async ({ page }) => {
  test.setTimeout(180_000);
  const cellar = await counted(page, '**/assets/bg-cellar-*');
  await launch(page, 9712);
  await startManor(page);
  await enterManor(page);
  await atRest(page);
  const live = [(await debugStats(page)).scene.liveBytes];
  await walk(page, 'hall', 'to_study', 'study', 'to_hall');
  await atRest(page);
  const inStudy = cellar.count();
  // Back in the hall: its neighbours' bgs come before the study's kept pictures, so the cellar's is admitted again.
  await walk(page, 'study', 'to_hall', 'hall', 'to_cellar');
  await atRest(page);
  live.push((await debugStats(page)).scene.liveBytes);
  console.log(`live texture bytes in the hall before and after the study: ${live.join(', ')}`);
  expect(cellar.count(), "the hall preloaded the cellar's background again").toBeGreaterThan(inStudy);
  const inHall = cellar.count();
  await tapHotspot(page, 'hall', 'to_cellar'); // the cellar's onEnter: the voice
  await reachLine(page, 'ch1.manor_cellar_voice.v007');
  expect(cellar.count(), 'the cellar joined the live record').toBe(inHall);
});
