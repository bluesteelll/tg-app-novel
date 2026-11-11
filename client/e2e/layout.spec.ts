// Q67's layout pins (RULINGS 240, 242, 244, 247): every screen lives in one phone-shaped column. A window at most
// 480 CSS px wide is a phone, its column the whole window; a wider one gets a centred 9:16 column; a column narrower
// than the 360 px design width draws its one design box scaled. One page-side check (`fitInPage`) runs on every
// screen at every window: the column's box, then each visible control inside the column and the window, clipped by
// no ancestor, scrolled into view only by a user scroller, and reached by a tap at its centre. Each test walks its
// screens once (its taps at its first window), collects every failure and asserts the list once at its end.
import { readFileSync, writeFileSync } from 'node:fs';

import type { APIRequestContext, Page } from '@playwright/test';

import { t, type UiKey } from '../src/i18n/index.ts';
import {
  atRest,
  catalogTitle,
  enterManor,
  expect,
  hotspotLabel,
  itemName,
  launch,
  plantPending,
  puzzleFrame,
  reachLine,
  take,
  tapHotspot,
  test,
  walk,
  type E2eWindow,
} from './helpers.ts';

const ru = (key: UiKey, params?: Readonly<Record<string, string | number>>): string => t('ru', key, params);

/** ch2's pending start (lazy-recovery.spec.ts's carry): a Continue opens its paywall at once. */
const CARRY = { g_gate_forced: false, g_manor_trust: 2, g_manor_promise: true, g_tide_trust_keeper: 0 } as const;
const LINE_MS = 30_000;
/** The design width (telegram/viewport.ts DESIGN_WIDTH) and the design box below it (the cover's 360 x 640). */
const DESIGN_W = 360;
const DESIGN_H = 640;
/** cues/stage/index.ts's landings: the `edge` box's side, the `centre` / point box's side. */
const EDGE_PX = 56;
const POINT_PX = 72;

type Insets = { top: number; bottom: number; left: number; right: number };
const ZERO: Insets = { top: 0, bottom: 0, left: 0, right: 0 };
/** The project's inset model (boot.spec.ts, puzzles.spec.ts): the notch and home bar, Telegram's fullscreen header. */
const NOTCH: Insets = { top: 24, bottom: 34, left: 0, right: 0 };
const HEADER: Insets = { top: 46, bottom: 0, left: 0, right: 0 };

type Win = { readonly w: number; readonly h: number; readonly safe?: Insets; readonly content?: Insets };
type Rect = { x: number; y: number; w: number; h: number };
type Control = { key: string; name: string; cue: string; choice: boolean; inert: boolean; rect: Rect };
type FitArg = { screen: string; win: string; w: number; design: boolean };
type FitResult = { column: Rect; controls: Control[]; failures: string[] };
type Screen = 'home' | 'first-line' | 'choices' | 'room' | 'menu' | 'paywall';

const winName = (w: Win): string => `${w.w}x${w.h}`;
const r2 = (n: number): number => Math.round(n * 100) / 100;
const show = (r: Rect): string => `${r2(r.x)},${r2(r.y)} ${r2(r.w)}x${r2(r.h)}`;
const close = (p: Rect, q: Rect, tol: number): boolean =>
  Math.abs(p.x - q.x) <= tol && Math.abs(p.y - q.y) <= tol && Math.abs(p.w - q.w) <= tol && Math.abs(p.h - q.h) <= tol;

/**
 * Runs in the page (Playwright serialises it, so it is self-contained). The column `C` is `.app`'s client rect; at a
 * window at most 480 px wide it is `#app`'s box, wider it is min(content width, height x 9/16) centred in `#app`'s
 * content box. With `design`, `.design` is drawn at a = C.w / 360 laid out 360 wide when C is narrower, else
 * untransformed. Every control's box is read before any scroll adjustment (E2's capture), then checked.
 */
function fitInPage(a: FitArg): FitResult {
  const SEL = 'button, [role=button], a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
  const r2 = (n: number): number => Math.round(n * 100) / 100;
  const show = (r: Rect): string => `${r2(r.x)},${r2(r.y)} ${r2(r.w)}x${r2(r.h)}`;
  const rectOf = (el: Element): Rect => {
    const b = el.getBoundingClientRect();
    return { x: b.left, y: b.top, w: b.width, h: b.height };
  };
  const within = (r: Rect, box: Rect): boolean =>
    r.x >= box.x - 0.5 && r.y >= box.y - 0.5 && r.x + r.w <= box.x + box.w + 0.5 && r.y + r.h <= box.y + box.h + 0.5;
  const centreIn = (r: Rect, box: Rect): boolean => within({ x: r.x + r.w / 2, y: r.y + r.h / 2, w: 0, h: 0 }, box);
  const cut = (p: Rect, q: Rect): Rect => {
    const x = Math.max(p.x, q.x);
    const y = Math.max(p.y, q.y);
    return { x, y, w: Math.max(0, Math.min(p.x + p.w, q.x + q.w) - x), h: Math.max(0, Math.min(p.y + p.h, q.y + q.h) - y) };
  };
  const desc = (el: Element): string => `${el.tagName.toLowerCase()}${[...el.classList].filter((c) => !c.startsWith('svelte-')).map((c) => `.${c}`).join('')}`;
  const at = `${a.screen} at ${a.win}`;
  const failures: string[] = [];
  const root = document.getElementById('app');
  const col = document.querySelector('.app');
  if (root === null || col === null) {
    return { column: { x: 0, y: 0, w: 0, h: 0 }, controls: [], failures: [`${at}: no #app or .app`] };
  }

  const C = rectOf(col);
  const A = rectOf(root);
  let want = A;
  if (a.w > 480) {
    const s = getComputedStyle(root);
    const left = parseFloat(s.paddingLeft);
    const content = A.w - left - parseFloat(s.paddingRight);
    const w = Math.min(content, (A.h * 9) / 16);
    want = { x: A.x + left + (content - w) / 2, y: A.y, w, h: A.h };
  }
  if (!(Math.abs(C.x - want.x) <= 0.5 && Math.abs(C.y - want.y) <= 0.5 && Math.abs(C.w - want.w) <= 0.5 && Math.abs(C.h - want.h) <= 0.5)) {
    failures.push(`column at ${a.win}: got ${show(C)}; want ${show(want)}`);
  }
  if (a.design) {
    const design = document.querySelector('.design');
    if (design === null) {
      failures.push(`design box at ${a.win}: missing`);
    } else {
      const s = getComputedStyle(design);
      const m = /^matrix\(([^,]+),/.exec(s.transform);
      if (C.w < 360) {
        const got = m === null ? Number.NaN : parseFloat(m[1] ?? '');
        const k = C.w / 360;
        if (!(Math.abs(got - k) <= 0.002)) {
          failures.push(`design transform at ${a.win}: got ${m === null ? s.transform : `a ${got.toFixed(3)}`}; want a ${k.toFixed(3)}`);
        }
        if (!(Math.abs(parseFloat(s.width) - 360) <= 0.5)) {
          failures.push(`design width at ${a.win}: got ${s.width}; want 360px`);
        }
      } else if (s.transform !== 'none') {
        failures.push(`design transform at ${a.win}: got ${s.transform}; want none`);
      }
    }
  }

  const els = [...root.querySelectorAll(SEL)].filter((el) => {
    if (el.closest('[data-cue-stage]') !== null || !el.checkVisibility({ visibilityProperty: true })) {
      return false;
    }
    const b = el.getBoundingClientRect();
    return b.width > 0 && b.height > 0;
  });
  const seen = new Map<string, number>();
  const controls: Control[] = els.map((el) => {
    const label = el.getAttribute('aria-label');
    const labels = el instanceof HTMLInputElement ? el.labels : null;
    const name = (label ?? labels?.[0]?.textContent ?? el.textContent ?? '').replace(/\s+/g, ' ').trim();
    const cue = el.getAttribute('data-cue') ?? '';
    const base = `${el.tagName.toLowerCase()}|${name}|${cue}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return { key: `${base}|${n}`, name, cue, choice: el.closest('.choices') !== null, inert: el.closest('[inert]') !== null, rect: rectOf(el) };
  });

  const view: Rect = { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
  const box = cut(C, view);
  els.forEach((el, i) => {
    const c = controls[i];
    if (c === undefined) {
      return;
    }
    const what = `${at}: ${c.key}`;
    // 1. A user scroller brings it fully inside first (its scroll px are layout px: a client delta divided by its scale).
    const scrolled: Array<[HTMLElement, number]> = [];
    for (let p = el.parentElement; p !== null; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (/^(auto|scroll)$/.test(s.overflowY) && p.scrollHeight > p.clientHeight) {
        const pr = p.getBoundingClientRect();
        const er = el.getBoundingClientRect();
        const k = p.offsetHeight > 0 ? pr.height / p.offsetHeight : 1;
        scrolled.push([p, p.scrollTop]);
        if (er.top < pr.top) {
          p.scrollTop -= (pr.top - er.top) / k;
        } else if (er.bottom > pr.bottom) {
          p.scrollTop += (er.bottom - pr.bottom) / k;
        }
      }
      if (p === col) {
        break;
      }
    }
    const r = rectOf(el);
    const hotspot = el.matches('[data-cue="hotspot"]');
    // 2. Inside the column and the window.
    if (!within(r, box)) {
      failures.push(`${what} outside the column: ${show(r)} not in ${show(box)}`);
    }
    // 3, 4. No clipping ancestor up to the column cuts it (a hotspot: its centre), and none hides a scrolled spill.
    let visible = cut(r, box);
    for (let p = el.parentElement; p !== null; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (s.overflowX !== 'visible' || s.overflowY !== 'visible') {
        const pr = rectOf(p);
        if (!(hotspot ? centreIn(r, pr) : within(r, pr))) {
          failures.push(`${what} clipped by ${desc(p)}: ${show(r)} not in ${show(pr)}`);
        }
        visible = cut(visible, pr);
        const hiddenX = s.overflowX === 'hidden' || s.overflowX === 'clip';
        const hiddenY = s.overflowY === 'hidden' || s.overflowY === 'clip';
        if ((hiddenX && p.scrollLeft !== 0) || (hiddenY && p.scrollTop !== 0)) {
          failures.push(`${what}: ${desc(p)} hides a scroll of ${p.scrollLeft},${p.scrollTop}`);
        }
      }
      if (p === col) {
        break;
      }
    }
    // 5. A tap at its visible centre reaches it (or another control), through the column's transform. A control group
    // drawn over it counts as a control: the choice list covers the dialogue's tap by design ("no tap-through",
    // Choices.svelte), on the parent as on the column.
    if (!c.inert && visible.w > 0 && visible.h > 0) {
      const hit = document.elementFromPoint(visible.x + visible.w / 2, visible.y + visible.h / 2);
      const group = hit?.closest('[role=group]') ?? null;
      const cover = group !== null && !group.contains(el) && group.querySelector(SEL) !== null;
      if (hit === null || !(el.contains(hit) || hit.closest(SEL) !== null || cover)) {
        failures.push(`${what}: a tap at its centre reaches ${hit === null ? 'nothing' : desc(hit)}`);
      }
    }
    for (const [p, top] of scrolled.reverse()) {
      p.scrollTop = top;
    }
  });
  return { column: C, controls, failures };
}

/** The settled layout's fingerprint: `#app`'s height, the column, the design box's transform and the inset inputs. */
function layoutState(): { appH: number; col: string; consistent: boolean; insets: number[] } {
  const root = document.getElementById('app');
  const col = document.querySelector('.app');
  const design = document.querySelector('.design');
  const c = col?.getBoundingClientRect();
  const html = getComputedStyle(document.documentElement);
  const px = (name: string): number => parseFloat(html.getPropertyValue(name) || '0') || 0;
  let consistent = true;
  if (design !== null && c !== undefined) {
    // fitColumn has answered the column's last size: a scale below the design width, none from it up.
    const m = /^matrix\(([^,]+),/.exec(getComputedStyle(design).transform);
    consistent = c.width < 360 ? m !== null && Math.abs(parseFloat(m[1] ?? '') - c.width / 360) <= 0.002 : m === null;
  }
  return {
    appH: root?.getBoundingClientRect().height ?? 0,
    col: c === undefined ? '' : `${c.left},${c.top},${c.width},${c.height}`,
    consistent,
    insets: ['top', 'bottom', 'left', 'right'].flatMap((s) => [px(`--tg-safe-area-inset-${s}`), px(`--tg-content-safe-area-inset-${s}`)]),
  };
}

/**
 * A window: the page's size, then Telegram's stable height and insets (the mock), until the layout settles: `#app` at
 * the height, the inset inputs applied, the design box answering the column, the column unmoved over 100 ms. A
 * window that never settles is a failure string, so a broken fit reaches the screens' checks instead of a timeout.
 */
async function resize(page: Page, win: Win, failures: string[]): Promise<void> {
  await page.setViewportSize({ width: win.w, height: win.h });
  const safe = win.safe ?? ZERO;
  const content = win.content ?? ZERO;
  await page.evaluate(
    ([h, s, c]) => {
      const mock = (window as unknown as E2eWindow).__tgMock;
      mock.setViewport(h);
      mock.setSafeArea(s, c);
    },
    [win.h, safe, content] as const,
  );
  const insets = (['top', 'bottom', 'left', 'right'] as const).flatMap((s) => [safe[s], content[s]]);
  let last = '';
  for (let i = 0; i < 100; i++) {
    const a = await page.evaluate(layoutState);
    await page.waitForTimeout(100);
    const b = await page.evaluate(layoutState);
    last = JSON.stringify(b);
    if (
      Math.abs(b.appH - win.h) <= 0.5 &&
      b.consistent &&
      a.col === b.col &&
      b.insets.every((v, j) => Math.abs(v - (insets[j] ?? 0)) <= 0.01)
    ) {
      return;
    }
  }
  failures.push(`layout not settled at ${winName(win)}: ${last}`);
}

/**
 * The page's own motions over (bounded): a root's entrance (`LAYER_MOTIONS.in`, a 0.98 scale) or a ghost still running
 * would move the boxes a check reads. An infinite animation never blocks.
 */
async function motionsDone(page: Page): Promise<void> {
  for (let i = 0; i < 50; i++) {
    const running = await page.evaluate(
      () =>
        document.getAnimations().filter((a) => a.playState === 'running' && Number.isFinite(Number(a.effect?.getComputedTiming().endTime)))
          .length,
    );
    if (running === 0) {
      return;
    }
    await page.waitForTimeout(100);
  }
}

type Check = { readonly screen: Screen | 'frame'; readonly win: Win; readonly design: boolean; readonly play: boolean };

/** One screen at one window: settles it (and the scene, in play) and returns the page's report. */
async function fitAt(page: Page, c: Check, failures: string[]): Promise<FitResult> {
  await resize(page, c.win, failures);
  if (c.play) {
    await atRest(page);
  }
  await motionsDone(page);
  const r = await page.evaluate(fitInPage, { screen: c.screen, win: winName(c.win), w: c.win.w, design: c.design });
  failures.push(...r.failures);
  return r;
}

/** Non-vacuity: the screen's own controls (outside `[inert]`) by count and by name. */
function minimums(screen: Screen | 'frame', at: string, controls: readonly Control[]): string[] {
  const live = controls.filter((c) => !c.inert);
  const named = (key: UiKey): number => live.filter((c) => c.name === ru(key)).length;
  const out: string[] = [];
  const need = (ok: boolean, what: string): void => {
    if (!ok) {
      out.push(`${screen} at ${at}: ${what} (live controls: ${live.map((c) => c.key).join(', ')})`);
    }
  };
  switch (screen) {
    case 'home':
      need(live.length >= 3, 'fewer than 3 controls');
      break;
    case 'first-line':
      need(live.length >= 5, 'fewer than 5 controls');
      for (const k of ['quick.auto', 'quick.skip', 'quick.backlog', 'quick.menu', 'quick.advance'] as const) {
        need(named(k) >= 1, `no ${k}`);
      }
      break;
    case 'choices':
      need(live.filter((c) => c.choice).length >= 2, 'fewer than 2 .choices buttons');
      break;
    case 'room':
      need(named('explore.bar_inventory') === 1, 'no explore.bar_inventory');
      need(named('explore.bar_reveal') === 1, 'no explore.bar_reveal');
      need(live.some((c) => c.cue === 'hotspot'), 'no hotspot');
      break;
    case 'menu':
      need(live.length >= 4, 'fewer than 4 controls');
      break;
    case 'paywall': {
      const buy = ru('paywall.buy', { n: '#' }).split('#')[0] ?? '';
      need(named('paywall.terms_agree') === 1, 'no paywall.terms_agree');
      need(live.some((c) => buy !== '' && c.name.startsWith(buy)), 'no Buy');
      break;
    }
    case 'frame':
      need(named('puzzle.try') === 1, 'no puzzle.try');
      need(named('puzzle.hint') >= 1, 'no puzzle.hint');
      need(named('puzzle.dial_up') + named('puzzle.dial_down') >= 8, 'fewer than 8 dial buttons');
      break;
    default: {
      const never: never = screen;
      return never;
    }
  }
  return out;
}

/** E2's capture: per screen, per window, the column and every control's key and box. */
type Capture = Record<string, Record<string, { column: Rect; controls: Array<{ key: string; rect: Rect }> }>>;

/**
 * Home, the first line, the first choice set, the first room, the Menu and the paywall of a pending paid start, each
 * checked at every window (taps at the first), with a second user for the paywall.
 */
async function walkScreens(
  page: Page,
  request: APIRequestContext,
  o: { readonly uids: readonly [number, number]; readonly wins: readonly Win[]; readonly design: boolean },
  failures: string[],
  capture: Capture,
): Promise<void> {
  const first = o.wins[0];
  if (first === undefined) {
    throw new Error('walkScreens: no window');
  }
  const check = async (screen: Screen, play: boolean): Promise<void> => {
    for (const win of o.wins) {
      const r = await fitAt(page, { screen, win, design: o.design, play }, failures);
      failures.push(...minimums(screen, winName(win), r.controls));
      (capture[screen] ??= {})[winName(win)] = { column: r.column, controls: r.controls.map((c) => ({ key: c.key, rect: c.rect })) };
    }
    await resize(page, first, failures);
    if (play) {
      await atRest(page);
    }
  };

  await launch(page, o.uids[0]);
  await resize(page, first, failures);
  const start = page.locator('[data-story="manor"]').getByRole('button', { name: ru('stories.start') });
  await expect(start).toBeVisible({ timeout: LINE_MS });
  await check('home', false);

  await start.tap();
  await reachLine(page, 'ch1.arrival.a001');
  await check('first-line', true);

  await reachLine(page, 'ch1.arrival.a008');
  await page.locator('.dialogue .tap').tap();
  await expect(page.locator('.choices button')).toHaveCount(2, { timeout: LINE_MS });
  await check('choices', true);
  await page.locator('.choices button').nth(0).tap();

  await enterManor(page);
  await check('room', true);

  await page.getByRole('button', { name: ru('quick.menu') }).tap();
  await expect(page.getByRole('button', { name: ru('menu.saves') })).toBeVisible({ timeout: LINE_MS });
  await check('menu', true);
  await page.evaluate(() => (window as unknown as E2eWindow).__tgMock.pressBack());
  await expect(page.getByRole('button', { name: ru('menu.saves') })).toBeHidden({ timeout: LINE_MS });

  await plantPending(request, o.uids[1], 'ch2', CARRY);
  await launch(page, o.uids[1]);
  await resize(page, first, failures);
  const resume = page.getByRole('button', { name: ru('tap.continue_story', { story: catalogTitle('manor') }) });
  await expect(resume).toBeVisible({ timeout: LINE_MS });
  await resume.tap();
  await expect(page.getByRole('heading', { name: catalogTitle('ch2'), exact: true })).toBeVisible({ timeout: LINE_MS });
  await check('paywall', true);
}

test('layout: every screen fits a centred 9:16 column in landscape and short windows', async ({ page, request }) => {
  test.setTimeout(300_000);
  const failures: string[] = [];
  // Every window above the 480 px line: unscaled (1280 x 720, 481 x 700: one px above it), scaled (1000 x 473, the
  // owner's 642 x 435 pane, the short 500 x 400).
  const wins: Win[] = [
    { w: 1280, h: 720 },
    { w: 1000, h: 473 },
    { w: 642, h: 435 },
    { w: 481, h: 700 },
    { w: 500, h: 400 },
  ];
  await walkScreens(page, request, { uids: [9301, 9302], wins, design: true }, failures, {});
  expect(failures).toEqual([]);
});

test('layout: phone windows keep every screen\'s control boxes', async ({ page, request }, testInfo) => {
  test.setTimeout(300_000);
  const failures: string[] = [];
  const capture: Capture = {};
  // Every window at most 480 px wide: the column is the window. 390 x 844 runs with the inset model (RULINGS 247
  // W1), so the parent equality pins the insets' path on the phone branch; the 16:9 expanded phones (375 x 591,
  // 360 x 560), 390 x 560 and the line itself (480 x 700) pillar-box the stage inside the window as today.
  const wins: Win[] = [
    { w: 390, h: 844, safe: NOTCH, content: HEADER },
    { w: 360, h: 640 },
    { w: 375, h: 591 },
    { w: 360, h: 560 },
    { w: 390, h: 560 },
    { w: 480, h: 700 },
  ];
  // The parent has no design box: E2 is the phone pin that holds on both trees.
  await walkScreens(page, request, { uids: [9303, 9304], wins, design: false }, failures, capture);
  writeFileSync(testInfo.outputPath('layout-phone.json'), JSON.stringify(capture, null, 2));

  // RULINGS 242 Q5: with the parent's capture (the same test run on the parent tree), every box equals it.
  const parentPath = process.env['LAYOUT_PARENT'];
  if (parentPath !== undefined && parentPath !== '') {
    const parent = JSON.parse(readFileSync(parentPath, 'utf8')) as Capture;
    for (const [screen, byWin] of Object.entries(parent)) {
      for (const [win, p] of Object.entries(byWin)) {
        const h = capture[screen]?.[win];
        if (h === undefined) {
          failures.push(`parent: ${screen} at ${win} not walked`);
          continue;
        }
        if (!close(h.column, p.column, 0.5)) {
          failures.push(`parent: ${screen} at ${win}: column ${show(h.column)}; parent ${show(p.column)}`);
        }
        const keys = h.controls.map((c) => c.key).join(' / ');
        const pkeys = p.controls.map((c) => c.key).join(' / ');
        if (keys !== pkeys) {
          failures.push(`parent: ${screen} at ${win}: controls ${keys}; parent ${pkeys}`);
          continue;
        }
        p.controls.forEach((pc, i) => {
          const hc = h.controls[i];
          if (hc !== undefined && !close(hc.rect, pc.rect, 0.5)) {
            failures.push(`parent: ${screen} at ${win}: ${pc.key} ${show(hc.rect)}; parent ${show(pc.rect)}`);
          }
        });
      }
    }
  }
  expect(failures).toEqual([]);
});

/** A ghost the cue stage added, as read in the recorder's callback. */
type Ghost = { seq: number; tag: string; classes: string[]; children: number; label: string | null; box: Rect; layer: Rect };
/**
 * A click as the window received it (capture phase, before any root's listener): its client point, whether it hit the
 * bare art, and how many animations its cue root ran at that moment (the root's entrance moves the point it emits).
 */
type Tap = { seq: number; x: number; y: number; bare: boolean; moving: number };
type GhostWindow = Window & { __layoutGhosts?: Ghost[]; __layoutTaps?: Tap[] };

/** A plain ghost: a childless `div` with no class but the stage's own (cues/stage/index.ts `ghostOf`). */
const plain = (g: Ghost): boolean => g.tag === 'div' && g.children === 0 && g.classes.every((c) => c === 'cue-ghost' || c === 'cue-plain');
const ghostsSince = async (page: Page, mark: number): Promise<Ghost[]> =>
  (await page.evaluate(() => (window as GhostWindow).__layoutGhosts ?? [])).filter((g) => g.seq >= mark);
const mark = (page: Page): Promise<number> => page.evaluate(() => ((window as GhostWindow).__layoutGhosts ?? []).length);
const played = (page: Page): Promise<string[]> =>
  page.evaluate(() => (document.querySelector('[data-cue-stage]')?.getAttribute('data-cues-played') ?? '').split(' '));
const tapMark = (page: Page): Promise<number> => page.evaluate(() => ((window as GhostWindow).__layoutTaps ?? []).length);
const tapsSince = async (page: Page, from: number): Promise<Tap[]> =>
  (await page.evaluate(() => (window as GhostWindow).__layoutTaps ?? [])).filter((t) => t.seq >= from);

/** Waits (bounded) until `pick` finds a ghost since `from` and the cue `key` played; returns the picked ghosts. */
async function awaitGhosts(page: Page, from: number, key: string, pick: (g: Ghost) => boolean): Promise<{ ghosts: Ghost[]; played: boolean }> {
  for (let i = 0; i < 50; i++) {
    const ghosts = (await ghostsSince(page, from)).filter(pick);
    const ok = (await played(page)).includes(key);
    if (ghosts.length > 0 && ok) {
      return { ghosts, played: ok };
    }
    await page.waitForTimeout(100);
  }
  return { ghosts: (await ghostsSince(page, from)).filter(pick), played: (await played(page)).includes(key) };
}

/** A live element's client rect and the cue layer's, in one read. */
async function rectsOf(page: Page, selector: string): Promise<{ el: Rect | null; layer: Rect; k: number }> {
  return page.evaluate((sel) => {
    const rect = (e: Element): Rect => {
      const b = e.getBoundingClientRect();
      return { x: b.left, y: b.top, w: b.width, h: b.height };
    };
    const layer = document.querySelector('[data-cue-stage]');
    const el = [...document.querySelectorAll(sel)].find((e) => e.closest('[data-cue-stage]') === null) ?? null;
    if (layer === null) {
      return { el: null, layer: { x: 0, y: 0, w: 0, h: 0 }, k: 0 };
    }
    const l = rect(layer);
    return { el: el === null ? null : rect(el), layer: l, k: l.w / parseFloat(getComputedStyle(layer).width) };
  }, selector);
}

/** `r` in the layer's px: (client rect - layer origin) / k. */
const inLayer = (r: Rect, l: Rect, k: number): Rect => ({ x: (r.x - l.x) / k, y: (r.y - l.y) / k, w: r.w / k, h: r.h / k });

/** The ripple's tolerance in layer px: the check and the stage read the same click and layer (see `bareArtRipple`). */
const RIPPLE_TOL = 0.05;

/**
 * A tap on the hall's bare art at a whole client px; the ripple's centre must be the click's point as the window
 * received it, in layer px. Want and got come from the same inputs by the same arithmetic (the click's point, the
 * layer's rect, k); the ghost's inline style round-trips to about 5e-5 layer px, so the tolerance is `RIPPLE_TOL`,
 * and a systematic sub-pixel error (a rounding in D5's division) fails. Returns the click, for the caller's motion guard.
 */
async function bareArtRipple(page: Page, step: string, k: number, failures: string[]): Promise<Tap | null> {
  // A whole px: the touch then arrives as tapped (a fractional one arrives rounded to the client px grid).
  const point = await page.evaluate(
    ([fractions, minDist]) => {
      const host = document.querySelector('canvas')?.parentElement;
      const layer = document.querySelector('[data-cue-stage]');
      if (host === null || host === undefined || layer === null) {
        return null;
      }
      const h = host.getBoundingClientRect();
      const l = layer.getBoundingClientRect();
      const kk = l.width / parseFloat(getComputedStyle(layer).width);
      for (const [fx, fy] of fractions) {
        const x = Math.round(h.left + fx * h.width);
        const y = Math.round(h.top + fy * h.height);
        const bare = document.elementFromPoint(x, y)?.matches('[data-cue="bare-art"]') ?? false;
        if (bare && Math.hypot(x - (l.left + l.width / 2), y - (l.top + l.height / 2)) / kk > minDist) {
          return { x, y };
        }
      }
      return null;
    },
    [
      [
        [0.2, 0.15],
        [0.8, 0.15],
        [0.2, 0.4],
        [0.8, 0.4],
      ],
      POINT_PX,
    ] as const,
  );
  if (point === null) {
    failures.push(`${step} no bare-art point among the host fractions`);
    return null;
  }
  const fromTap = await tapMark(page);
  const from = await mark(page);
  await page.touchscreen.tap(point.x, point.y);
  const size = (g: Ghost): boolean => plain(g) && Math.abs(g.box.w - POINT_PX) <= 1 && Math.abs(g.box.h - POINT_PX) <= 1;
  const r = await awaitGhosts(page, from, 'ui:bare-art', size);
  if (!r.played) {
    failures.push(`${step} guard: ui:bare-art not played`);
  }
  const taps = await tapsSince(page, fromTap);
  const tap = taps[0];
  if (taps.length !== 1 || tap === undefined) {
    failures.push(`${step} guard: clicks since the tap: got ${taps.length}; want 1`);
    return null;
  }
  if (Math.abs(tap.x - point.x) > 0.01 || Math.abs(tap.y - point.y) > 0.01) {
    failures.push(`${step} guard: the tap arrived at ${tap.x},${tap.y}; tapped at ${point.x},${point.y}`);
  }
  if (!tap.bare) {
    failures.push(`${step} guard: the click missed the bare art`);
  }
  const { layer } = await rectsOf(page, '.app');
  const want = { x: (tap.x - layer.x) / k, y: (tap.y - layer.y) / k };
  const centre = (g: Ghost): { x: number; y: number } => ({ x: g.box.x + g.box.w / 2, y: g.box.y + g.box.h / 2 });
  const best = r.ghosts.sort((p, q) => Math.hypot(centre(p).x - want.x, centre(p).y - want.y) - Math.hypot(centre(q).x - want.x, centre(q).y - want.y))[0];
  if (best === undefined) {
    failures.push(`${step} ripple: no plain 72 x 72 ghost`);
  } else if (Math.abs(centre(best).x - want.x) > RIPPLE_TOL || Math.abs(centre(best).y - want.y) > RIPPLE_TOL) {
    failures.push(`${step} ripple: centre got ${r2(centre(best).x)},${r2(centre(best).y)}; want ${r2(want.x)},${r2(want.y)}`);
  }
  return tap;
}

test('layout: cue ghosts land on their targets in a scaled column', async ({ page }) => {
  test.setTimeout(300_000);
  const failures: string[] = [];
  const wide: Win = { w: 1000, h: 473 };
  await launch(page, 9305);
  await resize(page, wide, failures);
  await page.locator('[data-story="manor"]').getByRole('button', { name: ru('stories.start') }).tap();
  await reachLine(page, 'ch1.arrival.a001');
  await expect(page.locator('[data-cue-stage]'), 'the cue stage').toBeAttached({ timeout: LINE_MS });
  // The recorder: every ghost the stage adds to its layer, read in the observer's callback; every click as it arrives.
  await page.evaluate(() => {
    const layer = document.querySelector('[data-cue-stage]');
    const w = window as GhostWindow;
    const out: Ghost[] = [];
    w.__layoutGhosts = out;
    const taps: Tap[] = [];
    w.__layoutTaps = taps;
    window.addEventListener(
      'click',
      (ev) => {
        const target = ev.target instanceof Element ? ev.target : null;
        taps.push({
          seq: taps.length,
          x: ev.clientX,
          y: ev.clientY,
          bare: target?.matches('[data-cue="bare-art"]') ?? false,
          moving: target?.closest('[data-cue-root]')?.getAnimations().length ?? 0,
        });
      },
      true,
    );
    if (layer === null) {
      return;
    }
    new MutationObserver((records) => {
      for (const rec of records) {
        for (const n of rec.addedNodes) {
          if (!(n instanceof HTMLElement) || !n.classList.contains('cue-ghost')) {
            continue;
          }
          const l = layer.getBoundingClientRect();
          out.push({
            seq: out.length,
            tag: n.tagName.toLowerCase(),
            classes: [...n.classList],
            children: n.childElementCount,
            label: n.getAttribute('aria-label'),
            box: { x: parseFloat(n.style.left), y: parseFloat(n.style.top), w: parseFloat(n.style.width), h: parseFloat(n.style.height) },
            layer: { x: l.left, y: l.top, w: l.width, h: l.height },
          });
        }
      }
    }).observe(layer, { childList: true });
  });
  await enterManor(page);
  await atRest(page);

  // Non-vacuity: the column is scaled (the layer's client width over its layout width).
  const k = (await rectsOf(page, '.app')).k;
  if (!(Math.abs(k - 0.7390625) <= 0.002)) {
    failures.push(`k at 1000x473: got ${k}; want 0.7390625 (the column scaled)`);
  }

  // (a) The hall at rest: a tap on the bare art plays the ripple at its point (D5's point division). Q69: the explore
  // root enters for 300 ms after `enterManor` (`LAYER_MOTIONS.in`, a 0.98 scale about its centre), which moves the
  // point its cue carries, so (a) waits for that entrance as (b), (c) and (f) wait for theirs.
  {
    await motionsDone(page);
    const tap = await bareArtRipple(page, '(a)', k, failures);
    if (tap !== null && tap.moving !== 0) {
      failures.push(`(a) guard: the explore root moved at the tap (${tap.moving} animations)`);
    }
  }

  // (d) The hall to the study: the walk's sweep covers the whole stage (the 'stage' target's division).
  {
    const from = await mark(page);
    await walk(page, 'hall', 'to_study', 'study', 'to_hall');
    await atRest(page);
    const r = await awaitGhosts(page, from, 'move:walk', plain);
    if (!r.played) {
      failures.push('(d) guard: move:walk not played');
    }
    const largest = r.ghosts.sort((p, q) => q.box.w * q.box.h - p.box.w * p.box.h)[0];
    const want = { x: 0, y: 0, w: DESIGN_W, h: DESIGN_H };
    if (largest === undefined) {
      failures.push('(d) largest stage ghost: none');
    } else if (!close(largest.box, want, 1)) {
      failures.push(`(d) largest stage ghost: got ${show(largest.box)}; want ${show(want)}`);
    }
  }

  // (b) The study: the drawer's press, a hit area's clone at its box (boxIn).
  const drawerLabel = hotspotLabel('study', 'drawer');
  {
    await atRest(page);
    await motionsDone(page);
    const at = await rectsOf(page, `button.hotspot[aria-label="${drawerLabel}"]`);
    const from = await mark(page);
    await tapHotspot(page, 'study', 'drawer');
    await expect(puzzleFrame(page, 'drawer')).toBeVisible({ timeout: LINE_MS });
    await atRest(page);
    const clone = (g: Ghost): boolean => !plain(g) && g.classes.includes('hotspot') && g.label === drawerLabel;
    const r = await awaitGhosts(page, from, 'ui:hotspot', clone);
    if (!r.played) {
      failures.push('(b) guard: ui:hotspot not played');
    }
    if (r.ghosts.length !== 1 || at.el === null) {
      failures.push(`(b) guard: press ghosts of drawer: got ${r.ghosts.length}; want 1${at.el === null ? ' (no drawer button)' : ''}`);
    }
    const g = r.ghosts[0];
    if (g !== undefined && at.el !== null) {
      const want = inLayer(at.el, at.layer, k);
      if (!close(g.box, want, 1)) {
        failures.push(`(b) press ghost of drawer: got ${show(g.box)}; want ${show(want)}`);
      }
    }
  }

  // (c) The drawer's frame: every control fits the scaled column; Back's exit ghost covers the frame root (boxIn).
  {
    // The root's last box is read past its entrance (cues/stage/index.ts `measure`), so the expected one is too.
    await motionsDone(page);
    const r = await page.evaluate(fitInPage, { screen: 'frame', win: winName(wide), w: wide.w, design: true });
    failures.push(...r.failures, ...minimums('frame', winName(wide), r.controls));
    const at = await rectsOf(page, '[data-cue-root="frame"]');
    const from = await mark(page);
    await page.evaluate(() => (window as unknown as E2eWindow).__tgMock.pressBack());
    await expect(puzzleFrame(page, 'drawer')).toBeHidden({ timeout: LINE_MS });
    const rootGhost = (g: Ghost): boolean => g.classes.includes('cue-root-ghost') && g.classes.includes('frame');
    let ghosts: Ghost[] = [];
    for (let i = 0; i < 50 && ghosts.length === 0; i++) {
      await page.waitForTimeout(100);
      ghosts = (await ghostsSince(page, from)).filter(rootGhost);
    }
    if (ghosts.length !== 1 || at.el === null) {
      failures.push(`(c) guard: root ghosts of the frame after Back: got ${ghosts.length}; want 1${at.el === null ? ' (no frame root)' : ''}`);
    }
    const g = ghosts[0];
    if (g !== undefined && at.el !== null) {
      const want = inLayer(at.el, at.layer, k);
      if (!close(g.box, want, 1)) {
        failures.push(`(c) root ghost of the frame: got ${show(g.box)}; want ${show(want)}`);
      }
    }
  }

  // (e) The gate's lock panel hides the ribbon: an insert's `ribbon` cues land at the edge box (landing's division).
  {
    await take(page, 'study', 'medal');
    await walk(page, 'study', 'to_hall', 'hall', 'gate');
    await tapHotspot(page, 'hall', 'gate');
    const held = page.locator('.held-item', { hasText: itemName('medal_sun') });
    await expect(held).toBeVisible({ timeout: LINE_MS });
    await atRest(page);
    const ribbon = await page.evaluate(() => [...document.querySelectorAll('[data-cue-ribbon]')].some((e) => e.closest('[data-cue-stage]') === null));
    if (ribbon) {
      failures.push('(e) guard: a live ribbon under the lock panel');
    }
    const from = await mark(page);
    await held.tap();
    await expect(held).toBeHidden({ timeout: LINE_MS });
    const edge = (g: Ghost): boolean => plain(g) && Math.abs(g.box.w - EDGE_PX) <= 1 && Math.abs(g.box.h - EDGE_PX) <= 1;
    const r = await awaitGhosts(page, from, 'fact:slot:added', edge);
    if (!r.played) {
      failures.push('(e) guard: fact:slot:added not played');
    }
    const want = { x: (DESIGN_W - EDGE_PX) / 2, y: DESIGN_H - EDGE_PX / 2, w: EDGE_PX, h: EDGE_PX };
    if (r.ghosts.length === 0) {
      failures.push('(e) edge ghost: none');
    }
    for (const g of r.ghosts) {
      if (!close(g.box, want, 1)) {
        failures.push(`(e) edge ghost: got ${show(g.box)}; want ${show(want)}`);
      }
    }
    await page.evaluate(() => (window as unknown as E2eWindow).__tgMock.pressBack());
    await expect(page.locator('[data-cue-panel="lock"]')).toBeHidden({ timeout: LINE_MS });
  }

  // (f) The hall at 320 x 490, a phone narrower than the design width: the inscription's look glints at its bus box
  // (D5's offset division: the host sits pillar-boxed inside the scaled design box).
  {
    const phone: Win = { w: 320, h: 490 };
    await resize(page, phone, failures);
    await atRest(page);
    const fit = await page.evaluate(fitInPage, { screen: 'room', win: winName(phone), w: phone.w, design: true });
    failures.push(...fit.failures.filter((f) => f.startsWith('column') || f.startsWith('design')));
    const kf = (await rectsOf(page, '.app')).k;
    if (!(Math.abs(kf - 320 / 360) <= 0.002)) {
      failures.push(`(f) k at 320x490: got ${kf}; want 0.8889`);
    }
    const offset = await page.evaluate(() => {
      const host = document.querySelector('canvas')?.parentElement;
      const layer = document.querySelector('[data-cue-stage]');
      return host === null || host === undefined || layer === null ? 0 : host.getBoundingClientRect().left - layer.getBoundingClientRect().left;
    });
    if (offset < 20) {
      failures.push(`(f) guard: host left - layer left got ${r2(offset)}; want >= 20`);
    }
    const label = hotspotLabel('hall', 'inscription');
    await motionsDone(page);
    const at = await rectsOf(page, `button.hotspot[aria-label="${label}"]`);
    const from = await mark(page);
    await tapHotspot(page, 'hall', 'inscription');
    const want = at.el === null ? null : inLayer(at.el, at.layer, kf);
    const sized = (g: Ghost): boolean => plain(g) && want !== null && Math.abs(g.box.w - want.w) <= 1 && Math.abs(g.box.h - want.h) <= 1;
    const r = await awaitGhosts(page, from, 'module:core:look', sized);
    if (!r.played) {
      failures.push('(f) guard: module:core:look not played');
    }
    const g = r.ghosts[0];
    if (g === undefined || want === null) {
      failures.push(`(f) look ghost: none${want === null ? ' (no inscription button)' : ''}`);
    } else if (!close(g.box, want, 1)) {
      failures.push(`(f) look ghost: got ${show(g.box)}; want ${show(want)}`);
    }
  }
  expect(failures).toEqual([]);
});

test('layout: safe-area insets hold in a scaled landscape column', async ({ page }) => {
  test.setTimeout(300_000);
  const failures: string[] = [];
  // A landscape phone with its notch on the left only (RULINGS 247 O2): the column centres in the safe area.
  const win: Win = { w: 812, h: 375, safe: { top: 24, bottom: 34, left: 44, right: 0 }, content: HEADER };
  const column = { x: 44 + (812 - 44 - (375 * 9) / 16) / 2, y: 0, w: (375 * 9) / 16, h: 375 };
  await launch(page, 9306);
  await resize(page, win, failures);
  await page.locator('[data-story="manor"]').getByRole('button', { name: ru('stories.start') }).tap();
  await reachLine(page, 'ch1.arrival.a001');

  const r = await fitAt(page, { screen: 'first-line', win, design: true, play: true }, failures);
  failures.push(...minimums('first-line', winName(win), r.controls));
  if (!close(r.column, column, 0.5)) {
    failures.push(`column at 812x375: got ${show(r.column)}; want ${show(column)}`);
  }
  const lines = await page.evaluate(() => ({
    quick: [...document.querySelectorAll('nav.quick button')].map((b) => b.getBoundingClientRect().top),
    dialogue: document.querySelector('.dialogue .tap')?.getBoundingClientRect().bottom ?? Number.NaN,
    padLeft: getComputedStyle(document.querySelector('nav.quick') ?? document.body).paddingLeft,
  }));
  if (lines.quick.length !== 4 || lines.quick.some((top) => top < 70 - 0.5)) {
    failures.push(`quick.* top: got ${lines.quick.map(r2).join(', ')}; want 4 at >= 70`);
  }
  if (!(lines.dialogue <= 341 + 0.5)) {
    failures.push(`dialogue bottom: got ${r2(lines.dialogue)}; want <= 341`);
  }
  if (lines.padLeft !== '8px') {
    failures.push(`.quick padding-left: got ${lines.padLeft}; want 8px (no side inset inside the column)`);
  }

  await page.getByRole('button', { name: ru('quick.menu') }).tap();
  const saves = page.getByRole('button', { name: ru('menu.saves') });
  await expect(saves).toBeVisible({ timeout: LINE_MS });
  const m = await fitAt(page, { screen: 'menu', win, design: true, play: true }, failures);
  failures.push(...minimums('menu', winName(win), m.controls));
  if (!close(m.column, column, 0.5)) {
    failures.push(`column at 812x375 (menu): got ${show(m.column)}; want ${show(column)}`);
  }
  const top = (await saves.boundingBox())?.y ?? Number.NaN;
  if (!(top >= 70 - 0.5)) {
    failures.push(`menu's first button top: got ${r2(top)}; want >= 70`);
  }
  expect(failures).toEqual([]);
});
