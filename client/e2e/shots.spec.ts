// Lane SH4's e2e (docs/plans/shots §5): ch4's lamp room as two shots, the keeper a face member of both. Her one face
// change (worried to smile, at a017, in the close-up) is drawn from the close-up's face file over its plate; the
// batch's ensure holds the line until that file is live (app/stage-route.ts imageIds with the stage and the chapter's
// manifest), and a reload restores the face from the server's autosave. The colours are the asset tool's placeholder
// fills (scripts/assets/shots.ts): an expression's layer is hsl(hue, 45%, 55%), its hue from assets/catalog.json.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { APIRequestContext, Page } from '@playwright/test';

import { t } from '../src/i18n/index.ts';
import { overscan, restFraming } from '../src/scene/shot-view.ts';
import { decodeAssetCatalog, decodeAssetManifest } from '../src/story/catalog.ts';
import type { AssetManifest } from '../src/story/catalog.ts';
import { decodeShotRigs } from '../src/story/shots.ts';
import type { Box, Member, ShotRig } from '../src/story/shots.ts';
import type { AssetId, BgId, CharId, ExprId } from '../src/story/staging.ts';
import { ANSWER_SETTLE_MS, atRest, devToken, expect, grantChapter, holdRequests, launch, reachLine, stagePixel, test, type E2eWindow } from './helpers.ts';

const CLIENT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** A chapter load, the scene mount and the first batch. */
const LINE_MS = 30_000;
/** Fresh dev users (no other spec names them): saves and purchases are server state for the whole run. */
const UID_FACE = 1201;
const UID_RELOAD = 1202;
/** Never granted ch4: no spec grants it (principle 0's non-owner). */
const UID_NON_OWNER = 1205;
const CLOSE_UP = 'lamp_keeper_cu' as BgId; // a shot id of story/shots.json
const KEEPER = 'keeper' as CharId; // a cast id of story/cast.json
const SMILE = 'smile' as ExprId; // an expression of assets/catalog.json
const SMILE_FILE = 'face/lamp_keeper_cu/keeper/smile' as AssetId; // the close-up's face file of the smile

type Rgba = readonly [number, number, number, number];
type Rgb = readonly [number, number, number];

/** ch4's paid manifest as the build under test writes it (server/content: served only after an entitlement check). */
function ch4Manifest(): AssetManifest {
  const m = decodeAssetManifest(JSON.parse(readFileSync(path.join(CLIENT_DIR, '..', 'server', 'content', 'chapters', 'ch4', 'assets.json'), 'utf8')));
  if (!m.ok) {
    throw new Error(`ch4's assets.json does not decode: ${JSON.stringify(m.error)}`);
  }
  return m.value;
}

/** The smile's placeholder layer fill, hsl(hue, 45%, 55%) as RGB, its hue from the committed catalog. */
function smileColour(): Rgb {
  const text = readFileSync(path.join(CLIENT_DIR, '..', 'assets', 'catalog.json'), 'utf8');
  const catalog = decodeAssetCatalog(JSON.parse(text.startsWith(String.fromCharCode(0xfeff)) ? text.slice(1) : text));
  const hue = catalog.ok ? catalog.value.chars[KEEPER]?.exprs[SMILE]?.placeholder.hue : undefined;
  if (hue === undefined) {
    throw new Error('assets/catalog.json has no keeper smile');
  }
  // CSS Color 4's hsl-to-rgb, s and l as fractions.
  const [s, l] = [0.45, 0.55];
  const channel = (n: number): number => {
    const k = (n + hue / 30) % 12;
    return Math.round(255 * (l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [channel(0), channel(8), channel(4)];
}

/**
 * A point of the keeper's smile layer in the close-up, in plate px: inside the layer's box, halfway from its top-left
 * corner to the nearest member of that expression's motion set, so off every motion member and off the hair locks drawn
 * over the layer, and above the face file's label band (the label is centred in its file: placeholder.ts renderPacked,
 * at most min(h / 2, 96) px high).
 */
function smilePoint(manifest: AssetManifest): { rig: ShotRig; at: readonly [number, number] } {
  const rigs = decodeShotRigs(manifest.shots);
  const rig = rigs.ok ? rigs.value.get(CLOSE_UP) : undefined;
  const member = rig?.cast.find((c) => c.char === KEEPER);
  const smile = member?.face?.exprs[SMILE];
  const layer = smile?.layer ?? null;
  if (rig === undefined || member === undefined || smile === undefined || layer === null) {
    throw new Error("ch4's manifest has no smile layer for the keeper in the close-up");
  }
  const { motion } = smile;
  const set: Member[] = [motion.blink.half, motion.blink.closed, motion.accent, ...motion.talk, ...(motion.joint ? [motion.joint.half, motion.joint.closed] : [])];
  const [ax, ay] = layer.at;
  const gap = (m: Member): number => Math.hypot(m.at[0] - ax, m.at[1] - ay);
  const nearest = set.reduce((a, b) => (gap(b) < gap(a) ? b : a));
  const at = [ax + (nearest.at[0] - ax) / 2, ay + (nearest.at[1] - ay) / 2] as const;
  const inside = (b: Box): boolean => at[0] >= b[0] && at[0] < b[0] + b[2] && at[1] >= b[1] && at[1] < b[1] + b[3];
  expect(inside(layer.at), `the point ${at.join(', ')} is on the smile layer`).toBe(true);
  for (const m of [...set, ...member.hair.map((h) => h.member)]) {
    expect(inside(m.at), `the point ${at.join(', ')} is off ${m.file} at ${m.at.join(', ')}`).toBe(false);
  }
  const file = manifest.assets[layer.file];
  if (file?.kind !== 'image') {
    throw new Error(`ch4's manifest has no image ${layer.file}`);
  }
  const fileY = layer.frame[1] + (at[1] - ay);
  expect(fileY, "the point is above the face file's label band").toBeLessThan(file.h / 2 - Math.min(file.h / 2, 96));
  return { rig, at };
}

/** The plate point on the stage at the rest framing, in CSS px from the canvas's top left. */
async function stagePoint(page: Page, rig: ShotRig, at: readonly [number, number]): Promise<[number, number]> {
  const box = await page.locator('canvas').boundingBox();
  if (box === null) {
    throw new Error('no canvas on the page');
  }
  const stage = { w: box.width, h: box.height };
  // The tier and the resolution leave the framing alone here: z0 is 1.03 for the full and the half tier alike.
  expect([overscan(rig, stage, 1, false), overscan(rig, stage, 1, true)], `z0 at ${stage.w} x ${stage.h}`).toEqual([1.03, 1.03]);
  const f = restFraming(rig, stage, 1, false);
  return [Math.round(f.x + at[0] * f.k), Math.round(f.y + at[1] * f.k)];
}

const distance = (a: Rgba, b: Rgb): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const within = (a: Rgba, b: Rgb, d: number): boolean => [0, 1, 2].every((i) => Math.abs((a[i] ?? 0) - (b[i] ?? 0)) <= d);

/** Tide's card button, then the session's first line (stories.spec.ts `play`). */
async function play(page: Page, button: 'stories.start' | 'stories.continue'): Promise<void> {
  const b = page.locator('[data-story="tide"]').getByRole('button', { name: t('ru', button) });
  await expect(b).toBeVisible({ timeout: LINE_MS });
  await b.tap();
  await expect(page.locator('.dialogue[data-line-id]')).toBeVisible({ timeout: LINE_MS });
}

/** Through ch3 on the c002 path (handover.spec.ts's walk) and the handover, to ch4's a004: the close-up's first line. */
async function toTheCloseUp(page: Page): Promise<void> {
  await reachLine(page, 'ch3.lighthouse.l008', { 'ch3.shore.c001': 1 });
  await reachLine(page, 'ch3.lighthouse_stairs.t011', { 'ch3.lighthouse.c001': 1 });
  await reachLine(page, 'ch4.lamp.a004');
}

/** The dialogue's line fully revealed (helpers.ts readPlay: nothing left to reveal). */
async function revealed(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => document.querySelector('.dialogue [data-reveal="rest"]')?.textContent ?? ''), { timeout: LINE_MS, message: 'the line fully revealed' })
    .toBe('');
}

function mock(page: Page, action: 'minimize' | 'restore'): Promise<void> {
  return page.evaluate((a) => (window as unknown as E2eWindow).__tgMock[a](), action);
}

/** The server's `auto` of tide for this user: its line, or null while there is none. */
async function serverAutoLine(request: APIRequestContext, token: string): Promise<string | null> {
  const res = await request.get('/api/saves', { headers: { Authorization: `Bearer ${token}` } });
  expect(res.status(), 'GET /api/saves').toBe(200);
  const body = (await res.json()) as { slots: Array<{ storyId: string; slot: string; lineId: string | null }> };
  return body.slots.find((s) => s.storyId === 'tide' && s.slot === 'auto')?.lineId ?? null;
}

/** `deactivated` writes the autosave (F3); the server's copy is polled until it holds `line`, then the app comes back. */
async function autosavedAt(page: Page, request: APIRequestContext, uid: number, line: string): Promise<void> {
  const token = await devToken(request, uid);
  await mock(page, 'minimize');
  await expect.poll(() => serverAutoLine(request, token), { timeout: 10_000, message: 'the lifecycle autosave' }).toBe(line);
  await mock(page, 'restore');
}

test.use({ reducedMotion: 'reduce' });

test("shots: the keeper's face changes in the lamp-room shot", async ({ page, request }) => {
  test.setTimeout(300_000);
  await grantChapter(request, UID_FACE, 'chapter:ch4');
  await launch(page, UID_FACE);
  await play(page, 'stories.start');
  await toTheCloseUp(page);

  const manifest = ch4Manifest();
  const { rig, at } = smilePoint(manifest);
  const smile = smileColour();
  const [x, y] = await stagePoint(page, rig, at);
  // The close-up at rest: its plate shows the keeper worried. Every sample follows atRest (the K7 fade is 200 ms
  // whatever reducedMotion says).
  await atRest(page);
  const rest = await stagePixel(page, x, y);
  expect(distance(rest, smile), `the rest face at ${x}, ${y} (${rest.join(', ')}) is not the smile ${smile.join(', ')}`).toBeGreaterThan(40);

  // The ensure hold: a017's batch names the smile's face file, and its line waits for it.
  await reachLine(page, 'ch4.lamp.a016', { 'ch4.lamp.c001': 0 });
  await revealed(page);
  const entry = manifest.assets[SMILE_FILE];
  if (entry?.kind !== 'image') {
    throw new Error(`ch4's manifest has no image ${SMILE_FILE}`);
  }
  const urls = [entry, ...(entry.half === undefined ? [] : [entry.half])].flatMap((f) => [f.avif.url, f.webp.url]);
  const holds = await Promise.all(urls.map((u) => holdRequests(page, `**${u}`)));
  let requested = false;
  for (const h of holds) {
    void h.requested.then(() => {
      requested = true;
    });
  }
  await page.locator('.dialogue .tap').tap();
  // Only the tier and the format the page picks is fetched: the first request of any of them.
  await expect.poll(() => requested, { timeout: LINE_MS, message: "fixture shape absent: a017's batch never requested the keeper's smile face file" }).toBe(true);
  await page.waitForTimeout(ANSWER_SETTLE_MS);
  expect(await page.locator('.dialogue').getAttribute('data-line-id'), 'still at a016 while the face file is held').toBe('ch4.lamp.a016');
  await Promise.all(holds.map((h) => h.release()));
  await expect(page.locator('.dialogue[data-line-id="ch4.lamp.a017"]')).toBeVisible({ timeout: LINE_MS });
  await atRest(page);
  const after = await stagePixel(page, x, y);
  expect(within(after, smile, 10), `the smile at ${x}, ${y}: ${after.join(', ')} against ${smile.join(', ')}`).toBe(true);
});

test("shots: a reload restores the keeper's face", async ({ page, request }) => {
  test.setTimeout(300_000);
  await grantChapter(request, UID_RELOAD, 'chapter:ch4');
  await launch(page, UID_RELOAD);
  await play(page, 'stories.start');
  await toTheCloseUp(page);
  await reachLine(page, 'ch4.lamp.a018', { 'ch4.lamp.c001': 0 });
  await revealed(page);
  // The save barrier: the server holds a018's autosave (else the last one written would be c001's, on the rest face).
  await autosavedAt(page, request, UID_RELOAD, 'ch4.lamp.a018');

  await launch(page, UID_RELOAD);
  await play(page, 'stories.continue');
  // A red here is the resume, never the face.
  await expect(page.locator('.dialogue[data-line-id="ch4.lamp.a018"]')).toBeVisible({ timeout: LINE_MS });
  const { rig, at } = smilePoint(ch4Manifest());
  const smile = smileColour();
  const [x, y] = await stagePoint(page, rig, at);
  await atRest(page);
  const restored = await stagePixel(page, x, y);
  expect(within(restored, smile, 10), `the restored smile at ${x}, ${y}: ${restored.join(', ')} against ${smile.join(', ')}`).toBe(true);
});

test('shots: a player without ch4 gets 403 for its sheet, face and talk files', async ({ request }) => {
  // Principle 0 for the shot kinds a window may fetch (the scene's other 403 pin is a ch2 bg half, memory.spec.ts).
  const manifest = ch4Manifest();
  const ids = Object.keys(manifest.assets) as AssetId[]; // the manifest decoder's keys are asset ids
  const urls = ['sheet/', 'face/', 'talk/'].flatMap((kind) => {
    const id = ids.find((x) => x.startsWith(kind) && manifest.assets[x]?.kind === 'image');
    const e = id === undefined ? undefined : manifest.assets[id];
    if (e?.kind !== 'image') {
      throw new Error(`fixture shape absent: ch4 has no ${kind.slice(0, -1)} file`);
    }
    return [e, ...(e.half === undefined ? [] : [e.half])].flatMap((f) => [f.avif.url, f.webp.url]);
  });
  const token = await devToken(request, UID_NON_OWNER);
  for (const url of urls) {
    const res = await request.get(url, { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status(), `GET ${url} without the entitlement`).toBe(403);
  }
});
