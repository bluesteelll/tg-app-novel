// GM3s's mechanics e2e (engine plan §12 GM3s commit (4)): the cue stage plays the demo walk's cues on its layer. The
// stage's debug attributes (§8.6, written only under `__TG_MOCK__`, which the e2e build compiles in) are the evidence:
// `data-cues-played` (the last keys played), `data-cue-orphans` (cues no stage played) and `data-cue-fallbacks`
// (cues whose target was missing). The room layer's exit is RULINGS 195's fallback: the live root leaves the document
// at once and the stage plays its exit on the root's ghost, so the evidence is the order of the DOM records.
import type { Locator, Page } from '@playwright/test';

import { t } from '../src/i18n/index.ts';
import {
  enterManor,
  expect,
  launch,
  playCh1ToGate,
  reachLine,
  solveOrder,
  take,
  tapHotspot,
  test,
  walk,
  worldSolutions,
} from './helpers.ts';

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
