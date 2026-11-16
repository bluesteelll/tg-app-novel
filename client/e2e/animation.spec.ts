// Lane SH7's e2e (the faces in motion): the keeper's rest face in ch4's lamp-room shot blinks once the page runs its
// animation ('live'), the e2e build holds every face at rest by default ('frozen', so the other specs' pixels and
// frame counts stay still), and a camera push still tweens without reduced motion. The scene-motion chunk is the
// scene's one import(), requested only once the session's first batch has settled (Addendum B B11 (a)).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Page } from '@playwright/test';

import { t } from '../src/i18n/index.ts';
import { atRest, chunkFile, debugStats, expect, grantChapter, launch, reachLine, test, type DebugStats, type NovelDebug } from './helpers.ts';

const CLIENT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** A chapter load, the scene mount and the first batch. */
const LINE_MS = 30_000;
/** The window a face is watched over: past BLINK_MS x 1.5 (6 s, animator.ts) twice, so a live face blinks in it. */
const WATCH_MS = 12_000;
/** Half the push's CAM_MS.push (2400 ms, shot-view.ts): the shortest run of a live timeline the push may show. */
const PUSH_RUN_MS = 1_200;
/** Fresh dev users (no other spec names them): saves and purchases are server state for the whole run. */
const UID_LIVE = 1301;
const UID_FROZEN = 1302;
const UID_PUSH = 1303;
/** ch4's first line: the lamp room's wide shot, the keeper at her rest face (story/ch4/main.ink `lamp`). */
const LAMP_LINE = 'ch4.lamp.a001';

/** The scene's SH7 counters (controller.ts SceneStats), beside the fields helpers.ts reads. */
type FaceStats = DebugStats['scene'] & {
  motion?: 'pending' | 'ready' | 'failed';
  frames?: number;
  ambientFrames?: number;
  ambientSources?: number;
  blinks?: number;
  previews?: number;
};
/** `__novelDebug` with SH7's switch (app/game.ts DebugHook). */
type AnimationDebug = Omit<NovelDebug, 'stats'> & {
  stats(): Omit<DebugStats, 'scene'> & { scene: FaceStats };
  setAnimation(mode: 'live' | 'frozen'): void;
};
type AnimationWindow = { __novelDebug?: AnimationDebug; __e2eTimelines?: Array<[number, number]> };

async function sceneOf(page: Page): Promise<FaceStats> {
  return (await debugStats(page)).scene as FaceStats;
}

/** Waits `ms` in the page (its own clock, as the scene's loop runs on it). */
function pause(page: Page, ms: number): Promise<void> {
  return page.evaluate((d) => new Promise<void>((resolve) => setTimeout(resolve, d)), ms);
}

/** Home's Start of the tide story (ch3), to its first line. */
async function start(page: Page): Promise<void> {
  const b = page.locator('[data-story="tide"]').getByRole('button', { name: t('ru', 'stories.start') });
  await expect(b).toBeVisible({ timeout: LINE_MS });
  await b.tap();
  await expect(page.locator('.dialogue[data-line-id]')).toBeVisible({ timeout: LINE_MS });
}

/** Through ch3 on the c002 path (handover.spec.ts's walk) and the handover, to ch4's first line. */
async function toTheLampRoom(page: Page): Promise<void> {
  await reachLine(page, 'ch3.lighthouse.l008', { 'ch3.shore.c001': 1 });
  await reachLine(page, 'ch3.lighthouse_stairs.t011', { 'ch3.lighthouse.c001': 1 });
  await reachLine(page, LAMP_LINE);
}

/** The motion kit landed and the keeper's face has its source on the loop (held ones count). */
async function faceOnTheLoop(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        const s = await sceneOf(page);
        return s.motion === 'ready' && (s.ambientSources ?? 0) >= 1;
      },
      { timeout: LINE_MS, message: "the motion kit ready and the keeper's face on the loop" },
    )
    .toBe(true);
}

test('animation: the keeper blinks in the lamp-room shot', async ({ page, request }) => {
  test.setTimeout(240_000);
  await grantChapter(request, UID_LIVE, 'chapter:ch4');
  await launch(page, UID_LIVE);
  await start(page);

  // B11 (a): the kit's import starts once the session's first batch settled (scene/controller.ts sceneSteps), so after
  // the files that batch waited on: ch3's first knot's image, from its half on this fresh start (a chapter entry), whose
  // full file is the upgrade nothing awaits. Read from the story tool's free outputs (casts of its own outputs).
  const lineAt = await page.evaluate(() => performance.now());
  const free = path.join(CLIENT_DIR, 'src', 'story-gen', 'free');
  type Variant = { avif: { url: string }; webp: { url: string } };
  const ch3Meta = JSON.parse(readFileSync(path.join(free, 'ch3.meta.json'), 'utf8')) as { firstKnot: string; knots: Record<string, { assets: string[] }> };
  const ch3Assets = JSON.parse(readFileSync(path.join(free, 'ch3.assets.json'), 'utf8')) as {
    assets: Record<string, { kind: string } & Partial<Variant> & { half?: Variant }>;
  };
  const timings = (): Promise<Array<{ path: string; start: number; end: number }>> =>
    page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .filter((r): r is PerformanceResourceTiming => r instanceof PerformanceResourceTiming)
        .map((r) => ({ path: new URL(r.name).pathname, start: r.startTime, end: r.responseEnd })),
    );
  const motionChunk = `/${chunkFile('src/scene/motion/index.ts')}`;
  let entries = await timings();
  await expect
    .poll(
      async () => {
        entries = await timings();
        return entries.some((e) => e.path === motionChunk);
      },
      { timeout: LINE_MS, message: "the scene-motion chunk's resource entry" },
    )
    .toBe(true);
  const chunkStart = entries.find((e) => e.path === motionChunk)?.start ?? Number.NEGATIVE_INFINITY;
  const before = (urls: readonly string[]): typeof entries => entries.filter((e) => urls.includes(e.path) && e.start < lineAt);
  const waited = (ch3Meta.knots[ch3Meta.firstKnot]?.assets ?? []).flatMap((id) => {
    const a = ch3Assets.assets[id];
    if (a?.kind !== 'image') {
      return [];
    }
    const halves = before(a.half === undefined ? [] : [a.half.avif.url, a.half.webp.url]);
    return halves.length > 0 ? halves : before([a.avif?.url, a.webp?.url].filter((u): u is string => u !== undefined));
  });
  const story = entries.find((e) => /^\/assets\/ch3\.story-[^/]+\.json$/.test(e.path));
  console.log(
    `SH7 B11: ch3's story JSON ended at ${story?.end.toFixed(0) ?? 'none'} ms; the first batch's files ` +
      `${waited.map((e) => `${e.path} ended ${e.end.toFixed(0)} ms`).join(', ')}; the scene-motion chunk requested at ${chunkStart.toFixed(0)} ms`,
  );
  expect(story, "ch3's story JSON on this path").toBeDefined();
  expect(waited.length, "the first batch's image files on this path").toBeGreaterThan(0);
  expect(chunkStart, 'the scene-motion chunk after the first batch settled').toBeGreaterThanOrEqual(
    Math.max(story?.end ?? Number.POSITIVE_INFINITY, ...waited.map((e) => e.end)),
  );

  // A16: the e2e build holds the faces at rest; this test runs them before ch4.
  await page.evaluate(() => (window as unknown as AnimationWindow).__novelDebug?.setAnimation('live'));
  await toTheLampRoom(page);
  await faceOnTheLoop(page);
  const a = await sceneOf(page);
  await pause(page, WATCH_MS);
  const b = await sceneOf(page);
  console.log(`SH7 E1: over ${WATCH_MS} ms blinks ${a.blinks ?? 'none'} -> ${b.blinks ?? 'none'}, ambient frames ${a.ambientFrames ?? 'none'} -> ${b.ambientFrames ?? 'none'}`);
  expect((b.blinks ?? 0) - (a.blinks ?? 0), "the keeper's blinks in the window").toBeGreaterThanOrEqual(1);
  expect((b.ambientFrames ?? 0) - (a.ambientFrames ?? 0), 'the frames that drew a stepped face').toBeGreaterThan(0);
});

test('animation: the e2e build holds the faces at rest by default', async ({ page, request }) => {
  test.setTimeout(240_000);
  await grantChapter(request, UID_FROZEN, 'chapter:ch4');
  await launch(page, UID_FROZEN);
  await start(page);
  await toTheLampRoom(page);
  await faceOnTheLoop(page);
  // A17: the scene settles: no preview left to sharpen, nothing loading or moving, then no frame for 500 ms.
  await expect.poll(async () => (await sceneOf(page)).previews, { timeout: LINE_MS, message: 'no preview left' }).toBe(0);
  await atRest(page);
  await expect
    .poll(
      async () => {
        const f0 = (await sceneOf(page)).frames;
        await pause(page, 500);
        return f0 !== undefined && f0 === (await sceneOf(page)).frames;
      },
      { timeout: LINE_MS, message: 'no frame drawn for 500 ms' },
    )
    .toBe(true);
  const a = await sceneOf(page);
  await pause(page, WATCH_MS);
  const b = await sceneOf(page);
  console.log(`SH7 frozen: over ${WATCH_MS} ms frames ${a.frames ?? 'none'} -> ${b.frames ?? 'none'}, blinks ${b.blinks ?? 'none'}, ambient frames ${b.ambientFrames ?? 'none'}`);
  expect([b.blinks, b.ambientFrames], 'no blink and no ambient frame since the mount').toEqual([0, 0]);
  expect(b.frames, 'no frame drawn in the window').toBe(a.frames);
});

test('animation: a push without reduced motion tweens the camera', async ({ page, request }) => {
  test.setTimeout(240_000);
  await grantChapter(request, UID_PUSH, 'chapter:ch4');
  await launch(page, UID_PUSH);
  await start(page);
  await toTheLampRoom(page);
  await reachLine(page, 'ch4.lamp.a004');
  await atRest(page);
  // A sampler of the live timelines on every frame, started before the tap that runs a005's `# cam: push to=keeper`.
  await page.evaluate(() => {
    const w = window as unknown as AnimationWindow;
    const samples: Array<[number, number]> = [];
    w.__e2eTimelines = samples;
    const tick = (now: number): void => {
      samples.push([now, w.__novelDebug?.stats().scene.activeTimelines ?? 0]);
      if (w.__e2eTimelines === samples) {
        requestAnimationFrame(tick);
      }
    };
    requestAnimationFrame(tick);
  });
  await reachLine(page, 'ch4.lamp.a005');
  await atRest(page);
  const samples = await page.evaluate(() => {
    const w = window as unknown as AnimationWindow;
    const s = w.__e2eTimelines ?? [];
    delete w.__e2eTimelines;
    return s;
  });
  // The longest run of frames with a live timeline: the push's tween, unless reduced motion lands it at once (D2).
  let longest = 0;
  let from: number | null = null;
  for (const [at, live] of samples) {
    if (live >= 1) {
      from ??= at;
      longest = Math.max(longest, at - from);
    } else {
      from = null;
    }
  }
  console.log(`SH7 G7: ${samples.length} frames sampled, the longest run of a live timeline ${longest.toFixed(0)} ms`);
  expect(longest, "the push's tween").toBeGreaterThanOrEqual(PUSH_RUN_MS);
});
