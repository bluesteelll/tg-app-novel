// Lane X (RULINGS 201 lever X; budget-r198 design §2.4 D2, D5): the scene skips Pixi's environment imports. A fresh
// start requests none of their chunks before its first line, named from the e2e build's manifest (not by pattern) and
// minus the files the budget's first-line walk counts, so a chunk shared with the engine never lands on the list. The
// stage canvas keeps `touch-action: none` on both installs: Pixi's EventSystem set it, the controller's `watch` does
// now, at mount and after a rebuild.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Page } from '@playwright/test';

import { firstLineFiles, parseManifest } from '../scripts/budget.ts';
import { t } from '../src/i18n/index.ts';
import { PIXI_ENV_SRCS } from '../src/scene/pixi-env.ts';
import { atRest, chunkFile, expect, launch, requests, test, type E2eWindow } from './helpers.ts';

const E2E_DIR = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIR = path.resolve(E2E_DIR, '..');
const LINE_MS = 30_000;
/** scene/controller.ts CONTEXT_GRACE_MS (2000; not imported: the module loads pixi.js) plus the rebuild's own time. */
const REBUILD_MS = 2_000 + 3_000;
/**
 * The positive control: the engine's chunk, which every fresh start requests. Since Q60 G3 the renderers are in it
 * (vite.config.ts `pixiChunking`), so the WebGL renderer has no chunk of its own to request.
 */
const ENGINE_KEY = 'src/app/engine.ts';

/**
 * The debug hook's fields this spec reads. helpers.ts (frozen in this lane) names neither `rebuilds` nor the loss
 * mode, as in memory.spec.ts. Not a type import of scene/controller.ts: that module loads pixi.js into Node.
 */
type EnvDebug = { stats(): { scene: { rebuilds: number } }; forceContextLoss(mode: 'restorable' | 'hard'): void };
type EnvWindow = Omit<E2eWindow, '__novelDebug'> & { __novelDebug?: EnvDebug };

/**
 * The files a fresh start must not request: the static closure (`imports` only, as a module's own load pulls them) of
 * Pixi's environment chunks in the e2e build, minus the first-line files the budget counts under the skip. A dynamic
 * edge would reach chunks requested later, after the first line.
 */
function forbiddenFiles(): string[] {
  const manifest = parseManifest(JSON.parse(readFileSync(path.join(CLIENT_DIR, 'dist-e2e', '.vite', 'manifest.json'), 'utf8')));
  const keys = new Set<string>();
  const queue = [...PIXI_ENV_SRCS];
  for (let key = queue.pop(); key !== undefined; key = queue.pop()) {
    if (keys.has(key)) {
      continue;
    }
    const chunk = manifest[key];
    if (chunk === undefined) {
      throw new Error(`dist-e2e/.vite/manifest.json has no chunk for ${key}`);
    }
    keys.add(key);
    queue.push(...(chunk.imports ?? []));
  }
  const allowed = firstLineFiles(manifest, { pixiEnvSkipped: true });
  return [...keys].flatMap((key) => manifest[key]?.file ?? []).filter((file) => !allowed.has(file)).sort();
}

/** Home -> the manor's Start -> its first line, the scene at rest. */
async function firstLineAtRest(page: Page): Promise<void> {
  const start = page.locator('[data-story="manor"]').getByRole('button', { name: t('ru', 'stories.start') });
  await expect(start).toBeVisible({ timeout: LINE_MS });
  await start.tap();
  await expect(page.locator('.dialogue[data-line-id]')).toBeVisible({ timeout: LINE_MS });
  await atRest(page);
}

/** The stage canvas's computed `touch-action` (what the browser applies, not the inline style). */
function touchAction(page: Page): Promise<string> {
  return page.locator('canvas').evaluate((canvas) => getComputedStyle(canvas).touchAction);
}

/** `forceContextLoss('hard')`, the loss observed on the canvas itself, and no restore within 1 s (memory.spec.ts). */
function hardLoss(page: Page): Promise<string[]> {
  return page.locator('canvas').evaluate(
    (canvas) =>
      new Promise<string[]>((resolve) => {
        const seen: string[] = [];
        canvas.addEventListener('webglcontextlost', () => seen.push('lost'), { once: true });
        canvas.addEventListener('webglcontextrestored', () => seen.push('restored'), { once: true });
        (window as unknown as EnvWindow).__novelDebug?.forceContextLoss('hard');
        setTimeout(() => resolve([...seen]), 1_000);
      }),
  );
}

async function rebuilds(page: Page): Promise<number> {
  await page.waitForFunction(() => '__novelDebug' in window);
  return page.evaluate(() => {
    const hook = (window as unknown as EnvWindow).__novelDebug;
    if (hook === undefined) {
      throw new Error('__novelDebug is gone');
    }
    return hook.stats().scene.rebuilds;
  });
}

test('scene: a fresh start requests no Pixi environment chunk', async ({ page }) => {
  const scripts = requests(page, /\.js(?:\?|$)/);
  await launch(page, 9801);
  await firstLineAtRest(page);
  const requested = scripts.urls.map((u) => new URL(u).pathname);
  const forbidden = forbiddenFiles();
  console.log(`scene-env: forbidden ${forbidden.join(', ')}`);
  const [browserAll] = PIXI_ENV_SRCS;
  if (browserAll === undefined) {
    throw new Error('invariant: PIXI_ENV_SRCS names browserAll first');
  }
  // Vacuity: the list names the browser's environment chunk, so an empty or misnamed list cannot pass.
  expect(forbidden, 'the forbidden list').toContain(chunkFile(browserAll));
  // The recorder sees the scene's own requests before the first line.
  expect(requested, 'the engine chunk is requested').toContain(`/${chunkFile(ENGINE_KEY)}`);
  expect(requested.filter((p) => forbidden.includes(p.slice(1))), 'Pixi environment chunks requested').toEqual([]);
});

test('scene: the stage canvas takes no touch gestures', async ({ page }) => {
  await launch(page, 9802);
  await firstLineAtRest(page);
  expect(await touchAction(page)).toBe('none');
});

test('scene: a rebuilt canvas takes no touch gestures', async ({ page }) => {
  test.setTimeout(120_000);
  await launch(page, 9803);
  await firstLineAtRest(page);
  const first = await page.locator('canvas').elementHandle();
  if (first === null) {
    throw new Error('no canvas at the first line');
  }
  expect(await hardLoss(page), 'the hard loss landed and nothing restored it within 1 s').toEqual(['lost']);
  await page.evaluate(() => {
    const mock = (window as unknown as EnvWindow).__tgMock;
    mock.minimize();
    mock.restore();
  });
  await expect.poll(() => rebuilds(page), { timeout: REBUILD_MS, message: 'activated rebuilt the stage' }).toBe(1);
  // Non-vacuity: the canvas measured below is the rebuild's new one.
  expect(await first.evaluate((canvas) => canvas.isConnected), 'the first canvas is gone').toBe(false);
  await first.dispose();
  expect(await touchAction(page)).toBe('none');
});
