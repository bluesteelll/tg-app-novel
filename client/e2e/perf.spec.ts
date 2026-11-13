// L15b's perf e2e (PROTOTYPE-PLAN "Budgets", "Test strategy"; MEMORY-PLAN 4.F): the one timing gate, the time to
// the first line under a throttled network and CPU (spec item 5), with a control that the throttle was live; the
// textures released at the chapter change (F4) and the JS heap on the manor path into ch2, which is owned before the
// launch through the real invoice and webhook; a lost WebGL context drawn again; and the render resolution per
// device class (lever F). Specs read `__novelDebug.stats()` by field only (MEMORY-PLAN M2 adds counters).
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Page } from '@playwright/test';

import { t, type UiKey } from '../src/i18n/index.ts';
import {
  atRest,
  chunkFile,
  debugStats,
  expect,
  grantChapter,
  guard,
  heapUsed,
  launch,
  playCh1ToEnd,
  stagePixel,
  test,
  type E2eWindow,
} from './helpers.ts';

const ru = (key: UiKey, params?: Readonly<Record<string, string | number>>): string => t('ru', key, params);

const E2E_DIR = path.dirname(fileURLToPath(import.meta.url));
const LINE_MS = 30_000;

/** Spec item 5 / PP "Budgets": the first line within 6 s at CPU 4x and 200,000 B/s down. */
const TTFL_LIMIT_MS = 6_000;
/** The throttle (PP "Budgets"): bytes per second down and up, one-way latency in ms. */
const DOWN_BPS = 200_000;
const UP_BPS = 93_750;
const LATENCY_MS = 150;
/** PP "Budgets", 48 MB read as the stricter decimal bytes. */
const HEAP_LIMIT = 48_000_000;

/** The manor card's Start, then the session's first line. */
async function startManor(page: Page): Promise<void> {
  const start = page.locator('[data-story="manor"]').getByRole('button', { name: ru('stories.start') });
  await expect(start).toBeVisible({ timeout: LINE_MS });
  await start.tap();
  await expect(page.locator('.dialogue[data-line-id]')).toBeVisible({ timeout: LINE_MS });
}

/** ch2's first line, the chapter change's sample instant once the scene is at rest. */
const ch2FirstLine = (page: Page) => page.locator('.dialogue[data-line-id="ch2.archive_cabinet.c002"]');

/**
 * From before the launch to the first line: Start tapped as soon as it is actionable, the line waited for in the page
 * (`waitFor`, not an assertion's back-off polling).
 */
async function timeToFirstLine(page: Page, uid: number): Promise<number> {
  const t0 = Date.now();
  await launch(page, uid);
  await page.locator('[data-story="manor"]').getByRole('button', { name: ru('stories.start') }).tap({ timeout: LINE_MS });
  await page.locator('.dialogue[data-line-id]').waitFor({ state: 'visible', timeout: LINE_MS });
  return Date.now() - t0;
}

/** The engine chunk's resource timing: its compressed body and the time its bytes took to arrive. */
async function engineTiming(page: Page, file: string): Promise<{ encodedBodySize: number; transferMs: number }> {
  return page.evaluate((pathname) => {
    const e = performance
      .getEntriesByType('resource')
      .find((r): r is PerformanceResourceTiming => new URL(r.name).pathname === pathname && r instanceof PerformanceResourceTiming);
    return e === undefined ? { encodedBodySize: 0, transferMs: 0 } : { encodedBodySize: e.encodedBodySize, transferMs: e.responseEnd - e.responseStart };
  }, `/${file}`);
}

/**
 * The F4 release check's bound (PP "Chapter change"): the decoded bytes of every image of `chapter`'s first knot and
 * of the knots it leads to, read in Node from the paid content (never in the bundle).
 */
function openingBound(chapter: string): number {
  const dir = path.resolve(E2E_DIR, '..', '..', 'server', 'content', 'chapters', chapter);
  // Casts of the story tool's own outputs, whose shapes its gate checks.
  const meta = JSON.parse(readFileSync(path.join(dir, 'meta.json'), 'utf8')) as {
    firstKnot: string;
    knots: Record<string, { assets: string[]; next: string[] }>;
  };
  const manifest = JSON.parse(readFileSync(path.join(dir, 'assets.json'), 'utf8')) as {
    assets: Record<string, { kind: string; decodedBytes?: number }>;
  };
  const first = meta.knots[meta.firstKnot];
  if (first === undefined) {
    throw new Error(`${chapter}/meta.json has no first knot`);
  }
  const ids = new Set([...first.assets, ...first.next.flatMap((k) => meta.knots[k]?.assets ?? [])]);
  let bytes = 0;
  for (const id of ids) {
    const a = manifest.assets[id];
    bytes += a?.kind === 'image' ? (a.decodedBytes ?? 0) : 0;
  }
  return bytes;
}

test('time to first line under throttling', async ({ page, browser, baseURL, viewport, hasTouch }) => {
  test.setTimeout(150_000);
  const engine = chunkFile('src/app/engine.ts');

  // Unthrottled first, in its own context with the same guards: printed beside the gate's figure, no limit.
  const plain = await browser.newContext({ baseURL, viewport, hasTouch });
  let unthrottled: number;
  try {
    const p = await plain.newPage();
    const check = await guard(p);
    unthrottled = await timeToFirstLine(p, 4001);
    check();
  } finally {
    await plain.close();
  }

  const encodings: string[] = [];
  page.on('response', (r) => {
    if (new URL(r.url()).pathname === `/${engine}`) {
      encodings.push(r.headers()['content-encoding'] ?? 'identity');
    }
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: LATENCY_MS,
    downloadThroughput: DOWN_BPS,
    uploadThroughput: UP_BPS,
  });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const throttled = await timeToFirstLine(page, 4002);

  // RULINGS 149 (LFL G2): on this path the meta controller's chunk is requested only once the first step is on screen,
  // so after ch1's story JSON and after every image of the first batch (`stage` awaits them before the step's view is
  // set): the images of ch1's first knot requested before the line showed, by the story tool's free outputs (read in
  // Node; casts of its own outputs, whose shapes its gate checks). A resource entry exists once its response ended.
  const lineAt = await page.evaluate(() => performance.now());
  const free = path.resolve(E2E_DIR, '..', 'src', 'story-gen', 'free');
  const ch1Meta = JSON.parse(readFileSync(path.join(free, 'ch1.meta.json'), 'utf8')) as { firstKnot: string; knots: Record<string, { assets: string[] }> };
  type Variant = { avif: { url: string }; webp: { url: string } };
  const ch1Assets = JSON.parse(readFileSync(path.join(free, 'ch1.assets.json'), 'utf8')) as {
    assets: Record<string, { kind: string } & Partial<Variant> & { half?: Variant }>;
  };
  const firstKnotImages = new Set(
    (ch1Meta.knots[ch1Meta.firstKnot]?.assets ?? []).flatMap((id) => {
      const a = ch1Assets.assets[id];
      return a?.kind === 'image' ? [a.avif?.url, a.webp?.url, a.half?.avif.url, a.half?.webp.url].filter((u): u is string => u !== undefined) : [];
    }),
  );
  const metaChunk = `/${chunkFile('src/app/meta.ts')}`;
  const timings = (): Promise<Array<{ path: string; start: number; end: number }>> =>
    page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .filter((r): r is PerformanceResourceTiming => r instanceof PerformanceResourceTiming)
        .map((r) => ({ path: new URL(r.name).pathname, start: r.startTime, end: r.responseEnd })),
    );
  let entries = await timings();
  await expect
    .poll(
      async () => {
        entries = await timings();
        return entries.some((e) => e.path === metaChunk);
      },
      { timeout: 10_000, message: "the meta controller chunk's resource entry" },
    )
    .toBe(true);
  const chunkStart = entries.find((e) => e.path === metaChunk)?.start ?? 0;
  const ch1Story = entries.find((e) => /^\/assets\/ch1\.story-[^/]+\.json$/.test(e.path));
  // Shots §5.8 (lane SH5b): a fresh start is a chapter entry, so an image whose half was fetched before the line is
  // staged from it, and its full files are its upgrade, which nothing awaits: not files of the batch.
  const staged = (ch1Meta.knots[ch1Meta.firstKnot]?.assets ?? []).flatMap((id) => {
    const a = ch1Assets.assets[id];
    const half = a?.half;
    const halves = half === undefined ? [] : [half.avif.url, half.webp.url];
    const full = [a?.avif?.url, a?.webp?.url].filter((u): u is string => u !== undefined);
    return a?.kind === 'image' && entries.some((e) => halves.includes(e.path) && e.start < lineAt) ? [{ id, halves, full }] : [];
  });
  const upgrades = new Set(staged.flatMap((s) => s.full));
  const batch = entries.filter((e) => firstKnotImages.has(e.path) && e.start < lineAt && !upgrades.has(e.path));
  console.log(
    `G2: the meta controller chunk requested at ${chunkStart.toFixed(0)} ms; ch1's story JSON ended at ` +
      `${ch1Story?.end.toFixed(0) ?? 'none'} ms; first batch ${batch.map((e) => `${e.path} ended ${e.end.toFixed(0)} ms`).join(', ')}`,
  );
  expect(ch1Story, "ch1's story JSON on this path").toBeDefined();
  expect(batch.length, "ch1's first-batch images on this path").toBeGreaterThan(0);
  expect(chunkStart, "the meta controller chunk is requested after the first line's chapter and its first batch's images").toBeGreaterThanOrEqual(
    Math.max(ch1Story?.end ?? Number.POSITIVE_INFINITY, ...batch.map((e) => e.end)),
  );
  // Shots §5.8 step 3 (lane SH5b): an upgrade starts at its batch's swap point, which follows the build, which follows
  // `ensure`'s resolution, which follows each awaited half's decode and so its response's end. The swap may come after
  // the read above (a dip's black), so the entries are read again until every staged image's upgrade answered.
  expect(staged.length, "ch1's first batch staged from its halves: a chapter entry on a full-tier session").toBeGreaterThan(0);
  const halfPaths = new Set(staged.flatMap((s) => s.halves));
  let after = entries;
  await expect
    .poll(
      async () => {
        after = await timings();
        return staged.every((s) => after.some((e) => s.full.includes(e.path)));
      },
      { timeout: LINE_MS, message: "every staged image's upgrade answered" },
    )
    .toBe(true);
  const halvesEnd = Math.max(...after.filter((e) => halfPaths.has(e.path) && e.start < lineAt).map((e) => e.end));
  console.log(
    `G2: staged ${staged.map((s) => s.id).join(', ')}; first-knot entries ` +
      `${after
        .filter((e) => firstKnotImages.has(e.path))
        .map((e) => `${e.path} started ${e.start.toFixed(0)} ended ${e.end.toFixed(0)} ms`)
        .join(', ')}; the staged halves' latest end ${halvesEnd.toFixed(0)} ms`,
  );
  for (const e of after.filter((x) => upgrades.has(x.path))) {
    expect(e.start, `${e.path} (an upgrade) starts after every staged half's response ended`).toBeGreaterThanOrEqual(halvesEnd);
  }

  // Critique W5: the throttle was live. The engine chunk's bytes cannot arrive faster than the emulated link.
  const timing = await engineTiming(page, engine);
  const floorMs = (0.9 * timing.encodedBodySize * 1000) / DOWN_BPS;
  const twaBytes = statSync(path.join(E2E_DIR, 'fixtures', 'telegram-web-app.js')).size;
  console.log(
    `TTFL: throttled ${throttled} ms (limit ${TTFL_LIMIT_MS}), unthrottled ${unthrottled} ms; ` +
      `control: the engine chunk ${timing.encodedBodySize} B (${encodings.join(', ') || 'no response seen'}) ` +
      `arrived in ${timing.transferMs.toFixed(0)} ms (floor ${floorMs.toFixed(0)} ms); ` +
      `the TWA fixture (${twaBytes} B on disk, 16.2 KB br in the budget, about 81 ms at ${DOWN_BPS} B/s, plus one ` +
      `${LATENCY_MS} ms RTT) is fulfilled from disk outside the throttle and is not in the figure`,
  );
  expect(timing.encodedBodySize, "the engine chunk's resource timing").toBeGreaterThan(0);
  expect(timing.transferMs, 'the engine chunk arrived at the throttled rate').toBeGreaterThanOrEqual(floorMs);
  expect(throttled, 'time to the first line, throttled').toBeLessThanOrEqual(TTFL_LIMIT_MS);
});

test.describe(() => {
  test.use({ reducedMotion: 'reduce' });

  test('textures released on chapter change', async ({ page, request }) => {
    test.setTimeout(180_000);
    await grantChapter(request, 4003, 'chapter:ch2');
    await launch(page, 4003);
    await startManor(page);
    await playCh1ToEnd(page);
    await expect(ch2FirstLine(page)).toBeVisible({ timeout: LINE_MS });
    await atRest(page);
    // RULINGS 297 Q3: ch2's first line holds its window at rest (need, warm, hope; shots §5.8), so the bound adds the
    // window's files outside the opening, read like openingBound from the paid content; an absent window throws.
    const bound =
      openingBound('ch2') +
      ((): number => {
        const dir = path.resolve(E2E_DIR, '..', '..', 'server', 'content', 'chapters', 'ch2');
        // Casts of the story tool's own outputs, whose shapes its gate checks.
        const meta = JSON.parse(readFileSync(path.join(dir, 'meta.json'), 'utf8')) as {
          firstKnot: string;
          knots: Record<string, { assets: string[]; next: string[] }>;
        };
        const manifest = JSON.parse(readFileSync(path.join(dir, 'assets.json'), 'utf8')) as {
          assets: Record<string, { kind: string; decodedBytes?: number }>;
          look?: { images: string[]; windows: Record<string, [number[], number[], number, number[]]> };
        };
        const w = manifest.look?.windows['ch2.archive_cabinet.c002'];
        if (w === undefined) {
          throw new Error("ch2's first-line window absent");
        }
        const first = meta.knots[meta.firstKnot];
        const opening = new Set([...(first?.assets ?? []), ...(first?.next ?? []).flatMap((k) => meta.knots[k]?.assets ?? [])]);
        const ids = new Set([...w[0], ...w[1], ...w[3]].map((i) => manifest.look?.images[i] ?? '').filter((id) => id !== '' && !opening.has(id)));
        let bytes = 0;
        for (const id of ids) {
          const a = manifest.assets[id];
          bytes += a?.kind === 'image' ? (a.decodedBytes ?? 0) : 0;
        }
        return bytes;
      })();
    const { liveBytes, liveTextures } = (await debugStats(page)).scene;
    console.log(`textures at ch2's first line: ${liveTextures} live, ${liveBytes} B (bound ${bound} B)`);
    expect(liveBytes, 'something of ch2 is on stage').toBeGreaterThan(0);
    expect(liveBytes, "ch1's textures released: at most ch2's opening").toBeLessThanOrEqual(bound);
  });

  test('heap under budget', async ({ page, request }) => {
    test.setTimeout(180_000);
    await grantChapter(request, 4004, 'chapter:ch2');
    await launch(page, 4004);
    await startManor(page);
    let inDrawer = Number.NaN;
    await playCh1ToEnd(
      page,
      {},
      {
        // The heaviest point of ch1 (PZ "Memory"): the explore controller, the world and the puzzle session are live.
        inDrawer: async () => {
          await expect
            .poll(async () => {
              const s = await debugStats(page);
              return s.explore && s.puzzle;
            })
            .toBe(true);
          await atRest(page);
          inDrawer = await heapUsed(page);
        },
      },
    );
    await expect(ch2FirstLine(page)).toBeVisible({ timeout: LINE_MS });
    await atRest(page);
    const atCh2 = await heapUsed(page);
    console.log(`heap: ${inDrawer} B with ch1's drawer open, ${atCh2} B at ch2's first line (limit ${HEAP_LIMIT} B)`);
    expect(inDrawer, "JS heap with ch1's drawer open").toBeLessThanOrEqual(HEAP_LIMIT);
    expect(atCh2, "JS heap at ch2's first line").toBeLessThanOrEqual(HEAP_LIMIT);
  });
});

test('context loss recovers', async ({ page }) => {
  test.setTimeout(90_000);
  await launch(page, 4005);
  await startManor(page);
  await atRest(page);
  const box = await page.locator('canvas').boundingBox();
  if (box === null) {
    throw new Error('no canvas');
  }
  // The backdrop's centre column, above the quick bar's row and the characters' heads (78 % of the stage height).
  const x = box.width / 2;
  const y = box.height * 0.12;
  const before = await stagePixel(page, x, y);
  const lit = (p: readonly number[]): boolean => Math.max(p[0] ?? 0, p[1] ?? 0, p[2] ?? 0) > 24;
  expect(lit(before), `the stage before the loss: ${before.join(',')}`).toBe(true);

  // The loss is observed on the canvas itself (L15b review M2), not assumed: a no-op hook would leave the stage lit
  // and the poll below green. Our listeners are the canvas's last (after Pixi's and the controller's), so on
  // `restored` the controller has already asked for the render the poll reads.
  const events = await page.locator('canvas').evaluate(
    (canvas) =>
      new Promise<string[]>((resolve) => {
        const seen: string[] = [];
        const guard = setTimeout(() => resolve([...seen]), 5_000);
        canvas.addEventListener('webglcontextlost', () => seen.push('lost'), { once: true });
        canvas.addEventListener(
          'webglcontextrestored',
          () => {
            seen.push('restored');
            clearTimeout(guard);
            resolve([...seen]);
          },
          { once: true },
        );
        (window as unknown as E2eWindow).__novelDebug?.forceContextLoss();
      }),
  );
  expect(events, 'the loss landed, then the restore').toEqual(['lost', 'restored']);
  let after: number[] = [];
  try {
    await expect
      .poll(
        async () => {
          after = await stagePixel(page, x, y);
          return lit(after) && after.slice(0, 3).every((c, i) => Math.abs(c - (before[i] ?? 0)) <= 12);
        },
        { timeout: 5_000, message: 'the stage drawn again after the restore' },
      )
      .toBe(true);
  } finally {
    console.log(`context loss: stage pixel ${before.join(',')} before, ${after.join(',')} last read after the loss`);
  }
});

/** A Telegram Android client on a LOW device (R1 §6: the class is the user agent's last token). */
const LOW_UA =
  'Mozilla/5.0 (Linux; Android 12; Pixel 3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 ' +
  'Telegram-Android/11.5.3 (Google Pixel 3; Android 12; SDK 31; LOW)';

/** The canvas's drawing-buffer width and its CSS width. */
function canvasWidths(page: Page): Promise<{ buffer: number; css: number }> {
  return page.locator('canvas').evaluate((el) => ({ buffer: (el as HTMLCanvasElement).width, css: el.clientWidth }));
}

test.describe(() => {
  test.use({ deviceScaleFactor: 2, userAgent: LOW_UA });

  test('scene: a LOW perf class renders at resolution 1', async ({ page }) => {
    test.setTimeout(90_000);
    await launch(page, 4006);
    await startManor(page);
    const w = await canvasWidths(page);
    expect(w.buffer, 'LOW: one buffer pixel per CSS pixel at DPR 2').toBe(w.css);
  });
});

test.describe(() => {
  test.use({ deviceScaleFactor: 2 });

  test('scene: an AVERAGE perf class at DPR 2 renders at resolution 2', async ({ page }) => {
    test.setTimeout(90_000);
    await launch(page, 4007);
    await startManor(page);
    const w = await canvasWidths(page);
    expect(w.buffer, 'AVERAGE: two buffer pixels per CSS pixel at DPR 2').toBe(2 * w.css);
  });
});
