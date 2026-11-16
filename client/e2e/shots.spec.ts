// Lane SH4's e2e (docs/plans/shots §5): ch4's lamp room as two shots, the keeper a face member of both. Her one face
// change (worried to smile, at a017, in the close-up) is drawn from the close-up's face file over its plate; the
// batch's ensure holds the line until that file is live (app/stage-route.ts imageIds with the stage and the chapter's
// manifest), and a reload restores the face from the server's autosave. The colours are the asset tool's placeholder
// fills (scripts/assets/shots.ts): an expression's layer is hsl(hue, 45%, 55%), its hue from assets/catalog.json.
// Lane SH5a (shots §5.8): the step windows in ch1, a cut whose plate the window asked for ahead and the rooms' windows.
// Lane SH6 (shots §5.5, §5.7): the lamp knot's dissolve back to the close-up, the keeper's push and each step's window
// bound on the live texture bytes.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { APIRequestContext, Page } from '@playwright/test';
import sharp from 'sharp';

import { t } from '../src/i18n/index.ts';
import { camFraming, overscan, restFraming, zoomRange } from '../src/scene/shot-view.ts';
import { decodeAssetCatalog, decodeAssetManifest } from '../src/story/catalog.ts';
import type { AssetManifest, HalfFile, ImageEntry } from '../src/story/catalog.ts';
import { decodeLook, decodeShotRigs, stepWindow } from '../src/story/shots.ts';
import type { Box, LookIndex, Member, ShotRig } from '../src/story/shots.ts';
import type { AssetId, BgId, CamState, CharId, ExprId } from '../src/story/staging.ts';
import {
  ANSWER_SETTLE_MS,
  atRest,
  debugStats,
  devToken,
  enterManor,
  expect,
  grantChapter,
  holdRequests,
  hotspot,
  launch,
  reachLine,
  stagePixel,
  tapHotspot,
  test,
  walk,
  type E2eWindow,
} from './helpers.ts';

const CLIENT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** A chapter load, the scene mount and the first batch. */
const LINE_MS = 30_000;
/** Fresh dev users (no other spec names them): saves and purchases are server state for the whole run. */
const UID_FACE = 1201;
const UID_RELOAD = 1202;
const UID_CUT = 1203;
const UID_ROOMS = 1204;
/** Never granted ch4: no spec grants it (principle 0's non-owner). */
const UID_NON_OWNER = 1205;
/** Fresh dev users of the half-tier entry (shots §5.8 "Entry at the half tier"): F5 and F6. */
const UID_SHARPEN = 1206;
const UID_ENTRY_CUT = 1207;
/** Fresh dev users of the lamp knot's transitions (lane SH6): the dissolve, the push and the window bound. */
const UID_DISSOLVE = 1208;
const UID_PUSH = 1209;
const UID_WINDOW = 1210;
const CLOSE_UP = 'lamp_keeper_cu' as BgId; // a shot id of story/shots.json
const KEEPER = 'keeper' as CharId; // a cast id of story/cast.json
const SMILE = 'smile' as ExprId; // an expression of assets/catalog.json
const SMILE_FILE = 'face/lamp_keeper_cu/keeper/smile' as AssetId; // the close-up's face file of the smile

type Rgba = readonly [number, number, number, number];
type Rgb = readonly [number, number, number];

/** The steady cap of the live texture bytes (MEMORY-PLAN STEADY, scene/registry.ts). */
const STEADY_BYTES = 33_554_432;

/**
 * The window fields of `__novelDebug.stats().scene` (scene/controller.ts SceneStats, lane SH5a D10) beside the ones
 * this spec samples. helpers.ts names none of them; not a type import of scene/controller.ts, which loads pixi.js.
 */
type WindowScene = {
  liveBytes: number;
  pendingLoads: number;
  activeTimelines: number;
  overCap: number;
  window: { pending: number; ids: string[] };
  rooms: string[];
  warm: number;
  warmBytes: number;
  /** Records started from their half file on a full-tier registry and not yet upgraded (lane SH5b). */
  previews: number;
  /** The transition targets as the GPU ledger counts them, live and since mount (lane SH6, CH D30). */
  targets?: number;
  targetBytes?: number;
  targetsCreated?: number;
  targetsDestroyed?: number;
  /** Live transient reservations (a dissolve's or a patch's target while it runs) and their bytes. */
  reservations?: number;
  reservedBytes?: number;
  /** Dissolves and patches that fell back to the container-alpha crossfade (cumulative, CH D15). */
  flatRefused?: number;
};

/** `__novelDebug.stats().scene` with its window fields. */
async function windowScene(page: Page): Promise<WindowScene> {
  await page.waitForFunction(() => '__novelDebug' in window);
  return page.evaluate(() => {
    const hook = (window as unknown as { __novelDebug?: { stats(): { scene: WindowScene } } }).__novelDebug;
    if (hook === undefined) {
      throw new Error('__novelDebug is gone');
    }
    return hook.stats().scene;
  });
}

/** ch1's look as the build under test writes it (the public story-gen manifest). */
function ch1Look(): LookIndex {
  const raw: unknown = JSON.parse(readFileSync(path.join(CLIENT_DIR, 'src', 'story-gen', 'free', 'ch1.assets.json'), 'utf8'));
  const look = decodeLook(typeof raw === 'object' && raw !== null ? Reflect.get(raw, 'look') : undefined);
  if (!look.ok) {
    throw new Error(`fixture shape absent: ch1's look does not decode: ${look.error.join('; ')}`);
  }
  return look.value;
}

/** The scene with no transition, on two reads 100 ms apart (atRest without its loads: a held fetch stays pending). */
async function stillScene(page: Page): Promise<void> {
  const still = async (): Promise<boolean> => (await debugStats(page)).scene.activeTimelines === 0;
  await expect
    .poll(
      async () => {
        if (!(await still())) {
          return false;
        }
        await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)));
        return still();
      },
      { timeout: LINE_MS, message: 'the scene still (no transition)' },
    )
    .toBe(true);
}

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

/** A story card's button (tide's by default), then the session's first line (stories.spec.ts `play`). */
async function play(page: Page, button: 'stories.start' | 'stories.continue', story: 'tide' | 'manor' = 'tide'): Promise<void> {
  const b = page.locator(`[data-story="${story}"]`).getByRole('button', { name: t('ru', button) });
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
  const manifest = ch4Manifest();
  const entry = manifest.assets[SMILE_FILE];
  if (entry?.kind !== 'image') {
    throw new Error(`ch4's manifest has no image ${SMILE_FILE}`);
  }
  await launch(page, UID_FACE);
  // The ensure hold: a017's batch names the smile's face file, and its line waits for it. The windows ask for that
  // file long before a017 (k:lamp's hope under next:ch4, a001's hope, a004's need), so every URL of it is held from
  // the launch on, and whichever ask comes first is held until the release.
  const urls = [entry, ...(entry.half === undefined ? [] : [entry.half])].flatMap((f) => [f.avif.url, f.webp.url]);
  const holds = await Promise.all(urls.map((u) => holdRequests(page, `**${u}`)));
  let requested = false;
  for (const h of holds) {
    void h.requested.then(() => {
      requested = true;
    });
  }
  await play(page, 'stories.start');
  await toTheCloseUp(page);

  const { rig, at } = smilePoint(manifest);
  const smile = smileColour();
  const [x, y] = await stagePoint(page, rig, at);
  // The close-up at rest: its plate shows the keeper worried. The held fetch is pending by design, so this sample waits
  // for no transition only: a004's batch ensured its plate before its line was set, and the point is off every motion
  // and hair member. Every later sample follows atRest (the K7 fade is 200 ms whatever reducedMotion says).
  await stillScene(page);
  const rest = await stagePixel(page, x, y);
  expect(distance(rest, smile), `the rest face at ${x}, ${y} (${rest.join(', ')}) is not the smile ${smile.join(', ')}`).toBeGreaterThan(40);

  await reachLine(page, 'ch4.lamp.a016', { 'ch4.lamp.c001': 0 });
  await revealed(page);
  // Only the tier and the format the page picks is fetched: the first request of any of them.
  await expect
    .poll(() => requested, {
      timeout: LINE_MS,
      message: "fixture shape absent: no request of the keeper's smile face file before a017's batch (a004's window needs it: C6's print (g))",
    })
    .toBe(true);
  await page.locator('.dialogue .tap').tap();
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

test('shots: a cut never waits for its plate', async ({ page }) => {
  // F2 (shots §5.8): the hall's plate is in a013's window, so the window fetched it before the tap; the cut's line
  // shows at once although every bg file after the first is answered 1.5 s late.
  test.setTimeout(300_000);
  const a013 = stepWindow(ch1Look(), 'ch1.arrival.a013');
  if (a013 === null || !a013.need.includes('bg/hall' as AssetId)) {
    throw new Error("fixture shape absent: ch1.arrival.a013's window does not need bg/hall");
  }
  let first: string | null = null;
  await page.route(/\/assets\/bg-[^/]+\.(?:avif|webp)$/, async (route) => {
    const url = route.request().url();
    first ??= url;
    if (url !== first) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    await route.fallback();
  });
  await launch(page, UID_CUT);
  await play(page, 'stories.start', 'manor');
  await reachLine(page, 'ch1.arrival.a013');
  await expect.poll(async () => (await windowScene(page)).window.pending, { timeout: LINE_MS, message: "a013's window live" }).toBe(0);
  await atRest(page);
  // The line's appearance, timed in the page from just before the tap.
  const target = 'ch1.manor_arrive.a002';
  await page.evaluate((id) => {
    const w = window as unknown as { __cutLineAt?: number };
    delete w.__cutLineAt;
    const shown = (): boolean => {
      const box = document.querySelector<HTMLElement>('.dialogue');
      return box !== null && !box.hidden && box.getAttribute('data-line-id') === id;
    };
    const obs = new MutationObserver(() => {
      if (shown()) {
        w.__cutLineAt = performance.now();
        obs.disconnect();
      }
    });
    obs.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-line-id', 'hidden'] });
  }, target);
  const tappedAt = await page.evaluate(() => performance.now());
  await page.locator('.dialogue .tap').tap();
  await expect(page.locator(`.dialogue[data-line-id="${target}"]`)).toBeVisible({ timeout: LINE_MS });
  const shownAt = await page.evaluate(() => (window as unknown as { __cutLineAt?: number }).__cutLineAt ?? null);
  expect(shownAt, 'the line seen by the observer').not.toBeNull();
  const ms = (shownAt ?? Number.POSITIVE_INFINITY) - tappedAt;
  console.log(`shots F2: ${target} shown ${ms.toFixed(0)} ms after the tap`);
  expect(ms, "the cut's line after the tap, in ms").toBeLessThanOrEqual(300);
});

/**
 * F3's sample in `room`, once the scheduler is idle (the window's need live, nothing in flight, warm included), then at
 * rest: the window is the room's (its need asked, nothing outside it), the live texture bytes under STEADY, and no
 * visible refusal past the hard cap since `overCap`.
 */
async function roomSample(page: Page, look: LookIndex, room: string, overCap: number): Promise<void> {
  const w = stepWindow(look, `r:${room}`);
  if (w === null) {
    throw new Error(`fixture shape absent: ch1's look has no r:${room}`);
  }
  await expect
    .poll(
      async () => {
        const s = await windowScene(page);
        return s.window.pending === 0 && s.pendingLoads === 0;
      },
      { timeout: LINE_MS, message: `the scheduler idle in the ${room}` },
    )
    .toBe(true);
  await atRest(page);
  const s = await windowScene(page);
  console.log(`shots F3: ${room} ids ${s.window.ids.join(',')} live ${s.liveBytes} warm ${s.warm} (${s.warmBytes} B) rooms ${s.rooms.join(',')}`);
  const listed = new Set<string>([...w.need, ...w.warm, ...w.hope]);
  expect(w.need.filter((id) => !s.window.ids.includes(id)), `r:${room}'s need not asked`).toEqual([]);
  expect(s.window.ids.filter((id) => !listed.has(id)), `window ids outside r:${room}`).toEqual([]);
  expect(s.liveBytes, `live texture bytes in the ${room}`).toBeLessThanOrEqual(STEADY_BYTES);
  expect(s.overCap, `overCap in the ${room}`).toBe(overCap);
}

test('shots: a room move hands the window to the new room', async ({ page }) => {
  // F3 (shots §5.8 "At each room batch"): hall, study, hall, then the cellar through its onEnter event; each room's
  // sample reads that room's window (the cellar's after the event's return, never a line of it).
  test.setTimeout(300_000);
  const look = ch1Look();
  for (const r of ['hall', 'study', 'cellar']) {
    if (stepWindow(look, `r:${r}`) === null) {
      throw new Error(`fixture shape absent: ch1's look has no r:${r}`);
    }
  }
  await launch(page, UID_ROOMS);
  await play(page, 'stories.start', 'manor');
  await enterManor(page);
  const overCap = (await windowScene(page)).overCap;
  await roomSample(page, look, 'hall', overCap);
  await walk(page, 'hall', 'to_study', 'study', 'to_hall');
  await roomSample(page, look, 'study', overCap);
  await walk(page, 'study', 'to_hall', 'hall', 'to_cellar');
  await roomSample(page, look, 'hall', overCap);
  await tapHotspot(page, 'hall', 'to_cellar'); // the cellar's onEnter: the voice
  await reachLine(page, 'ch1.manor_cellar_voice.v007');
  await page.locator('.dialogue .tap').tap(); // `# explore: manor`: back in the cellar
  await expect(hotspot(page, 'cellar', 'to_hall'), "the cellar's rooms after the event").toBeVisible({ timeout: LINE_MS });
  await roomSample(page, look, 'cellar', overCap);
});

// ---------------------------------------------------------------------------------------------------------------
// The half-tier entry (shots §5.8 "Entry at the half tier", lane SH5b): a Continue from Home is a chapter entry, so its
// restore and first step start their images from the half files and the upgrade chain sharpens them in place.

/** ch4's first line: the lamp room's wide shot, two steps before the close-up (story/ch4/main.ink `lamp`). */
const LAMP_LINE = 'ch4.lamp.a001';
const WIDE_PLATE = 'bg/lamp_wide' as AssetId; // `# scene: lamp_wide`'s plate
const WIDE_SHEET = 'sheet/lamp_wide' as AssetId;
const CU_PLATE = 'bg/lamp_keeper_cu' as AssetId; // a004's `# bg: lamp_keeper_cu`
/** How late a held-back full file is answered: F5 every full file of ch4, F6 the wide plate's. No half file is. */
const FULL_DELAY_MS = 2000;

/** ch4's look as the build under test writes it (the paid manifest that ch4Manifest reads). */
function ch4Look(): LookIndex {
  const raw: unknown = JSON.parse(readFileSync(path.join(CLIENT_DIR, '..', 'server', 'content', 'chapters', 'ch4', 'assets.json'), 'utf8'));
  const look = decodeLook(typeof raw === 'object' && raw !== null ? Reflect.get(raw, 'look') : undefined);
  if (!look.ok) {
    throw new Error(`fixture shape absent: ch4's look does not decode: ${look.error.join('; ')}`);
  }
  return look.value;
}

/** An image of ch4 that LAMP_LINE's window needs, with its half file. */
function lampImage(manifest: AssetManifest, id: AssetId): ImageEntry & { half: HalfFile } {
  const need = stepWindow(ch4Look(), LAMP_LINE)?.need ?? [];
  const e = manifest.assets[id];
  if (!need.includes(id) || e?.kind !== 'image' || e.half === undefined) {
    throw new Error(`fixture shape absent: ${LAMP_LINE}'s window does not need ${id}, or ${id} has no half file`);
  }
  return { ...e, half: e.half };
}

/** A ch4 owner from a fresh start to LAMP_LINE (toTheCloseUp's walk, stopped there), autosaved there on the server. */
async function savedInTheLampRoom(page: Page, request: APIRequestContext, uid: number): Promise<void> {
  await grantChapter(request, uid, 'chapter:ch4');
  await launch(page, uid);
  await play(page, 'stories.start');
  await reachLine(page, 'ch3.lighthouse.l008', { 'ch3.shore.c001': 1 });
  await reachLine(page, 'ch3.lighthouse_stairs.t011', { 'ch3.lighthouse.c001': 1 });
  await reachLine(page, LAMP_LINE);
  await autosavedAt(page, request, uid, LAMP_LINE);
}

/** For the next document: room for every resource timing entry, and the time LAMP_LINE first shows (`__entryLineAt`). */
async function recordTheEntry(page: Page): Promise<void> {
  await page.addInitScript((line) => {
    performance.setResourceTimingBufferSize(2000);
    const w = window as unknown as { __entryLineAt?: number };
    const obs = new MutationObserver(() => {
      const box = document.querySelector<HTMLElement>('.dialogue');
      if (box !== null && !box.hidden && box.getAttribute('data-line-id') === line) {
        w.__entryLineAt = performance.now();
        obs.disconnect();
      }
    });
    obs.observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-line-id', 'hidden'] });
  }, LAMP_LINE);
}

/** A GL clear the page made (`recordFrames`): its page time and the scene's live previews then (-1 unreadable). */
type Drawn = { t: number; previews: number };

/**
 * For the next document: every GL clear, with the scene's `previews` at that moment. Pixi clears the back buffer once
 * per rendered frame (its renderer's `clear` defaults to `clearBeforeRender`), and nothing renders to another target in
 * this test (a dissolve or a face patch would: lane SH6): `targetsCreated` stays 0, asserted at its end, so each clear
 * is a drawn frame.
 */
async function recordFrames(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown> & { __drawn?: Drawn[]; __novelDebug?: { stats(): { scene: { previews?: number } } } };
    const drawn: Drawn[] = [];
    w.__drawn = drawn;
    const wrap = (ctor: unknown): void => {
      if (typeof ctor !== 'function') {
        return;
      }
      const proto = (ctor as { prototype: { clear?: (mask: number) => void } }).prototype;
      const clear = proto.clear;
      if (clear === undefined) {
        return;
      }
      proto.clear = function (this: unknown, mask: number): void {
        if (drawn.length < 10_000) {
          let previews = -1;
          try {
            previews = w.__novelDebug?.stats().scene.previews ?? -1;
          } catch {
            previews = -1; // the hook mid-teardown
          }
          drawn.push({ t: performance.now(), previews });
        }
        clear.call(this, mask);
      };
    };
    wrap(w['WebGLRenderingContext']);
    wrap(w['WebGL2RenderingContext']);
  });
}

/** `recordFrames`' clears on this page: every one, or (with `from`) those at or after page time `from` with no preview. */
function drawnFrames(page: Page, from?: number): Promise<number> {
  return page.evaluate((t) => {
    const all = (window as unknown as { __drawn?: Drawn[] }).__drawn ?? [];
    return t === null ? all.length : all.filter((f) => f.t >= t && f.previews === 0).length;
  }, from ?? null);
}

/** The page's resource timing of the first answered of `urls` (URL paths), in page ms; null while none has ended. */
function answered(page: Page, urls: readonly string[]): Promise<{ start: number; end: number } | null> {
  return page.evaluate((list) => {
    const e = performance
      .getEntriesByType('resource')
      .find((r): r is PerformanceResourceTiming => r instanceof PerformanceResourceTiming && list.includes(new URL(r.name).pathname));
    return e === undefined ? null : { start: e.startTime, end: e.responseEnd };
  }, [...urls]);
}

test('shots: a resume shows the half tier first and sharpens', async ({ page, request }) => {
  // F5: the restore and a001's first step start from the half files and the line waits for no full file; then the
  // chain swaps every record to its full file, one at a time, while every full file of ch4 is FULL_DELAY_MS late.
  test.setTimeout(300_000);
  const manifest = ch4Manifest();
  const plate = lampImage(manifest, WIDE_PLATE);
  const sheet = lampImage(manifest, WIDE_SHEET);
  await savedInTheLampRoom(page, request, UID_SHARPEN);

  // Installed only now: the first session entered ch4 at its handover too.
  const full = new Set(Object.values(manifest.assets).flatMap((e) => (e.kind === 'image' ? [e.avif.url, e.webp.url] : [])));
  await page.route(
    (url) => full.has(url.pathname),
    async (route) => {
      await new Promise((resolve) => setTimeout(resolve, FULL_DELAY_MS));
      await route.fallback();
    },
  );
  const firstAsked = new Map<string, number>();
  page.on('request', (r) => {
    const p = new URL(r.url()).pathname;
    if (!firstAsked.has(p)) {
      firstAsked.set(p, Date.now());
    }
  });
  await recordTheEntry(page);
  await recordFrames(page);
  const launchedAt = Date.now();
  await launch(page, UID_SHARPEN);
  await play(page, 'stories.continue');
  await expect(page.locator(`.dialogue[data-line-id="${LAMP_LINE}"]`)).toBeVisible({ timeout: LINE_MS });
  // One sample is enough: the upgrades run one at a time and each full file is FULL_DELAY_MS late, so a preview is
  // still listed long after the line, wherever the first upgrade started.
  const atLine = await windowScene(page);
  expect(atLine.previews, `previews at ${LAMP_LINE}`).toBeGreaterThan(0);
  const half = await answered(page, [plate.half.avif.url, plate.half.webp.url]);
  const lineAt = await page.evaluate(() => (window as unknown as { __entryLineAt?: number }).__entryLineAt ?? null);
  expect(half, `${WIDE_PLATE}'s half file fetched`).not.toBeNull();
  expect(lineAt, `${LAMP_LINE} seen by the observer`).not.toBeNull();
  expect(half?.end ?? Number.POSITIVE_INFINITY, `${WIDE_PLATE}'s half answered before ${LAMP_LINE} showed`).toBeLessThanOrEqual(lineAt ?? Number.NEGATIVE_INFINITY);
  // The recorder sees this context's frames (the restore and the line's step drew some), so a 0 below is no frame drawn.
  expect(await drawnFrames(page), 'GL clears recorded on this page').toBeGreaterThan(0);

  // Six serial upgrades (the three visible records, then a001's three close-up needs), each FULL_DELAY_MS late: about
  // 12.5 s, so the named LINE_MS and not the default expect timeout. Every read keeps the entry's peak.
  const peak = { liveBytes: 0, pendingLoads: 0, samples: 0 };
  await expect
    .poll(
      async () => {
        const s = await windowScene(page);
        peak.liveBytes = Math.max(peak.liveBytes, s.liveBytes);
        peak.pendingLoads = Math.max(peak.pendingLoads, s.pendingLoads);
        peak.samples += 1;
        return s.previews;
      },
      { timeout: LINE_MS, intervals: [250], message: 'every preview sharpened' },
    )
    .toBe(0);
  // Shots §5.8 step 3: the stage draws on demand and F5 sends no input, so only the swaps' own frame requests can draw
  // the full files: a frame after the line whose scene had no preview left.
  await expect
    .poll(() => drawnFrames(page, lineAt ?? Number.POSITIVE_INFINITY), { message: 'a frame drawn after every preview sharpened, with no input' })
    .toBeGreaterThan(0);
  console.log(
    `shots F5: entry reservation peak liveBytes (textures plus the loads and the upgrade in flight) ${peak.liveBytes} B, pendingLoads ${peak.pendingLoads} over ${peak.samples} samples`,
  );
  await atRest(page);
  const rest = await windowScene(page);
  const asked = (urls: readonly string[]): string => {
    const at = urls.flatMap((u) => firstAsked.get(u) ?? []);
    return at.length === 0 ? 'never' : `+${Math.min(...at) - launchedAt} ms`;
  };
  console.log(
    `shots F5: L0 ${atLine.liveBytes} B at ${LAMP_LINE}, L1 ${rest.liveBytes} B at rest, rise ${rest.liveBytes - atLine.liveBytes} B; ` +
      `${WIDE_PLATE} half asked ${asked([plate.half.avif.url, plate.half.webp.url])}, full ${asked([plate.avif.url, plate.webp.url])} after the launch`,
  );
  // The at-rest bound (cut Q2): the wide shot's plate and sheet are live at their full size.
  expect(rest.liveBytes, `liveBytes at rest against the full ${WIDE_PLATE} and ${WIDE_SHEET}`).toBeGreaterThanOrEqual(plate.decodedBytes + sheet.decodedBytes);
  // The frame count above holds only while no clear was a target's (recordFrames): no transition target was made.
  expect(rest.targetsCreated, 'transition targets made in this test').toBe(0);
  // Principle 0: the half file is gated like the full one.
  for (const [uid, status] of [
    [UID_SHARPEN, 200],
    [UID_NON_OWNER, 403],
  ] as const) {
    const res = await request.get(plate.half.avif.url, { headers: { Authorization: `Bearer ${await devToken(request, uid)}` } });
    expect(res.status(), `GET ${plate.half.avif.url} as ${uid}`).toBe(status);
  }
});

test("shots: after an entry the first cut's half files are requested beside the upgrade", async ({ page, request }) => {
  // F6: the entry's window starts the close-up's need from the half files beside the visible upgrades, not after them;
  // two steps on, the cut shows at once at the half tier while the close-up plate's full file is still held, and the
  // plate sharpens once it is answered.
  test.setTimeout(300_000);
  const manifest = ch4Manifest();
  const wide = lampImage(manifest, WIDE_PLATE);
  const cu = lampImage(manifest, CU_PLATE);
  lampImage(manifest, 'sheet/lamp_keeper_cu' as AssetId);
  lampImage(manifest, 'talk/lamp_keeper_cu/keeper/worried' as AssetId);
  await savedInTheLampRoom(page, request, UID_ENTRY_CUT);

  // Installed only now (cut §9 O6): the first session's handover into ch4 is an entry too, and would satisfy them.
  const wideFull = [wide.avif.url, wide.webp.url];
  await page.route(
    (url) => wideFull.includes(url.pathname),
    async (route) => {
      await new Promise((resolve) => setTimeout(resolve, FULL_DELAY_MS));
      await route.fallback();
    },
  );
  // Every URL of the close-up plate's full file, as the face test holds its file: whichever the page picks.
  const holds = await Promise.all([cu.avif.url, cu.webp.url].map((u) => holdRequests(page, `**${u}`)));
  let cuFullRequested = false;
  for (const h of holds) {
    void h.requested.then(() => {
      cuFullRequested = true;
    });
  }
  const cuFiles = new Set([cu.avif.url, cu.webp.url, cu.half.avif.url, cu.half.webp.url]);
  const cuAsked: string[] = [];
  page.on('request', (r) => {
    const p = new URL(r.url()).pathname;
    if (cuFiles.has(p)) {
      cuAsked.push(p);
    }
  });
  await recordTheEntry(page);
  await launch(page, UID_ENTRY_CUT);
  await play(page, 'stories.continue');
  await expect(page.locator(`.dialogue[data-line-id="${LAMP_LINE}"]`)).toBeVisible({ timeout: LINE_MS });

  // The close-up's half plate is asked beside the wide plate's upgrade: it starts before that full file's answer ends.
  const cuHalf = [cu.half.avif.url, cu.half.webp.url];
  await expect.poll(() => answered(page, wideFull), { timeout: LINE_MS, message: `${WIDE_PLATE}'s full file answered` }).not.toBeNull();
  await expect.poll(() => cuAsked.length, { timeout: LINE_MS, message: `a request of ${CU_PLATE}` }).toBeGreaterThan(0);
  expect(cuAsked[0], `${CU_PLATE}'s first request`).toMatch(/-half-/);
  await expect.poll(() => answered(page, cuHalf), { timeout: LINE_MS, message: `${CU_PLATE}'s half file answered` }).not.toBeNull();
  const wideAt = await answered(page, wideFull);
  const cuAt = await answered(page, cuHalf);
  console.log(`shots F6: ${CU_PLATE} half started at ${cuAt?.start.toFixed(0)} ms, ${WIDE_PLATE} full answered at ${wideAt?.end.toFixed(0)} ms`);
  expect(cuAt?.start ?? Number.POSITIVE_INFINITY, `${CU_PLATE}'s half starts before ${WIDE_PLATE}'s full answer ends`).toBeLessThan(wideAt?.end ?? Number.NEGATIVE_INFINITY);
  // The need is live, previews included (a live preview counts as live). The held upgrade keeps pendingLoads above 0,
  // so nothing before the release waits on atRest.
  await expect.poll(async () => (await windowScene(page)).window.pending, { timeout: LINE_MS, message: `${LAMP_LINE}'s window live` }).toBe(0);

  // a002 or a003 (g_tide_trust_keeper decides): a second step, no entry; its talk file is in a001's need.
  await stillScene(page);
  await revealed(page);
  await page.locator('.dialogue .tap').tap();
  await expect(page.locator('.dialogue[data-line-id="ch4.lamp.a002"], .dialogue[data-line-id="ch4.lamp.a003"]')).toBeVisible({ timeout: LINE_MS });
  await stillScene(page);
  await revealed(page);
  // The chain has reached the close-up plate: its upgrade is in flight on the held full file.
  await expect.poll(() => cuFullRequested, { timeout: LINE_MS, message: `${CU_PLATE}'s upgrade asked its full file` }).toBe(true);

  // The cut to a004, timed in the page from just before the tap: its batch joins the live preview as it is.
  const target = 'ch4.lamp.a004';
  await page.evaluate((id) => {
    const w = window as unknown as { __cutLineAt?: number };
    delete w.__cutLineAt;
    const shown = (): boolean => {
      const box = document.querySelector<HTMLElement>('.dialogue');
      return box !== null && !box.hidden && box.getAttribute('data-line-id') === id;
    };
    const obs = new MutationObserver(() => {
      if (shown()) {
        w.__cutLineAt = performance.now();
        obs.disconnect();
      }
    });
    obs.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-line-id', 'hidden'] });
  }, target);
  const tappedAt = await page.evaluate(() => performance.now());
  await page.locator('.dialogue .tap').tap();
  await expect(page.locator(`.dialogue[data-line-id="${target}"]`)).toBeVisible({ timeout: LINE_MS });
  const shownAt = await page.evaluate(() => (window as unknown as { __cutLineAt?: number }).__cutLineAt ?? null);
  expect(shownAt, 'the line seen by the observer').not.toBeNull();
  const ms = (shownAt ?? Number.POSITIVE_INFINITY) - tappedAt;
  console.log(`shots F6: ${target} shown ${ms.toFixed(0)} ms after the tap, ${CU_PLATE}'s full file held`);
  expect(ms, "the cut's line after the tap, in ms").toBeLessThanOrEqual(300);
  expect((await windowScene(page)).previews, `${CU_PLATE} still a preview at ${target}`).toBeGreaterThan(0);

  // Released, the close-up plate sharpens, then a001's other close-up needs: none of them late.
  await Promise.all(holds.map((h) => h.release()));
  await expect.poll(async () => (await windowScene(page)).previews, { timeout: LINE_MS, message: 'every preview sharpened' }).toBe(0);
  await atRest(page);
});

// ---------------------------------------------------------------------------------------------------------------
// The lamp knot's transitions (lane SH6, cut commit 8): a016 cuts to the lens insert, a017 dissolves back to the
// close-up with the smile through one render target, and a005 pushes in on the keeper.

/** a016's `# bg: lamp_lens_insert`: the insert the knot cuts to and dissolves away from. */
const LENS_INSERT = 'bg/lamp_lens_insert' as AssetId;
/** a005's `# cam: push to=keeper`, with the tag's default zoom (story/tags.ts). */
const PUSH: CamState = { kind: 'push', to: KEEPER, z: 110 };
/** The knot's last line before the dawn (story/ch4/main.ink `lamp`). */
const LAMP_LAST = 'ch4.lamp.a019';

/**
 * Q8: the lamp knot's SH6 staging as the build under test compiles it (the paid story and its look), checked before
 * E1-E3 run, so a red below is never a missing tag: the push, the cut to the insert, and the dissolve back.
 */
function ch4Story(): void {
  const story = readFileSync(path.join(CLIENT_DIR, '..', 'server', 'content', 'chapters', 'ch4', 'story.json'), 'utf8');
  for (const tag of ['cam: push to=keeper', 'bg: lamp_lens_insert', 'bg: lamp_keeper_cu t=crossfade']) {
    if (!story.includes(tag)) {
      throw new Error(`fixture shape absent: ch4's compiled story has no \`# ${tag}\``);
    }
  }
  if (!(stepWindow(ch4Look(), 'ch4.lamp.a016')?.need ?? []).includes(LENS_INSERT)) {
    throw new Error(`fixture shape absent: ch4.lamp.a016's window does not need ${LENS_INSERT}`);
  }
}

/** The dialogue as helpers.ts readPlay reads it (not exported there): its line, whether it reveals, the choices. */
type Shown = { line: string | null; revealing: boolean; choices: string[] };

function shownNow(page: Page): Promise<Shown> {
  return page.evaluate((): Shown => {
    const box = document.querySelector<HTMLElement>('.dialogue');
    const on = box !== null && !box.hidden;
    return {
      line: on ? box.getAttribute('data-line-id') : null,
      revealing: on && (box.querySelector('[data-reveal="rest"]')?.textContent ?? '') !== '',
      choices: [...document.querySelectorAll('.choices button')].map((b) => b.getAttribute('data-line-id') ?? ''),
    };
  });
}

/** The canvas as the page shows it (overlays included, as stagePixel reads it), in CSS px from its top left. */
async function canvasShot(page: Page): Promise<{ w: number; h: number; at: (x: number, y: number) => Rgba }> {
  const box = await page.locator('canvas').boundingBox();
  if (box === null) {
    throw new Error('no canvas on the page');
  }
  const png = await page.screenshot({ clip: box, scale: 'css' });
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const at = (x: number, y: number): Rgba => {
    const i = (y * info.width + x) * 4;
    return [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0, data[i + 3] ?? 0];
  };
  return { w: info.width, h: info.height, at };
}

const rgb = (c: Rgba): Rgb => [c[0], c[1], c[2]];

test('shots: a dissolve leaves no target alive', async ({ page, request }) => {
  // E1 (shots §5.5): a017's `bg: lamp_keeper_cu t=crossfade` dissolves the insert into the close-up through one render
  // target; at rest the ledger has counted it made and destroyed (Pixi's destroy event, CH D30) and no reservation is
  // left in the registry's transient band.
  test.setTimeout(300_000);
  ch4Story();
  await grantChapter(request, UID_DISSOLVE, 'chapter:ch4');
  await launch(page, UID_DISSOLVE);
  await play(page, 'stories.start');
  await toTheCloseUp(page);
  await reachLine(page, 'ch4.lamp.a017', { 'ch4.lamp.c001': 0 });
  await atRest(page);
  const s = await windowScene(page);
  console.log(
    `shots E1: at a017 targets ${s.targets} (${s.targetBytes} B), made ${s.targetsCreated}, destroyed ${s.targetsDestroyed}, ` +
      `reservations ${s.reservations} (${s.reservedBytes} B), flatRefused ${s.flatRefused}`,
  );
  // First: a refusal falls back to the container crossfade, which makes no target; the counts below would say so less plainly.
  expect(s.flatRefused, 'a refused dissolve on the e2e stage is a finding').toBe(0);
  expect(s.targetsCreated ?? 0, 'targets made by the dissolve').toBeGreaterThan(0);
  expect(s.targetsDestroyed, 'targets destroyed against those made').toBe(s.targetsCreated);
  expect(s.targets, 'live targets at rest').toBe(0);
  expect(s.targetBytes, 'live target bytes at rest').toBe(0);
  expect(s.reservations, 'live reservations at rest').toBe(0);
  expect(s.reservedBytes, 'reserved bytes at rest').toBe(0);
});

test("shots: a push frames the keeper's face", async ({ page, request }) => {
  // E2 (shots §5.7, cut D6): a005's push, computed here through camFraming as F1 computes the rest through restFraming,
  // is what the stage draws once the move is over. The keeper is worried at a004 and a005, the rest the plate itself
  // shows (no face layer), so on a placeholder plate her face is the plate's own flat colour. The sample is a plate
  // point q, in her face box where the plate draws a face there, else the plate point nearest her head that the push
  // moves across an edge of the plate: its stage point p = push(q) shows another colour at rest (read from the page,
  // no hue assumption) and q's under the push. With the push not applied, p keeps the other colour.
  test.setTimeout(300_000);
  ch4Story();
  const rigs = decodeShotRigs(ch4Manifest().shots);
  const rig = rigs.ok ? rigs.value.get(CLOSE_UP) : undefined;
  const keeper = rig?.cast.find((c) => c.char === KEEPER);
  const face = keeper?.face ?? null;
  if (rig === undefined || keeper === undefined || face === null) {
    throw new Error("fixture shape absent: ch4's manifest has no face member keeper in the close-up");
  }
  await grantChapter(request, UID_PUSH, 'chapter:ch4');
  await launch(page, UID_PUSH);
  await play(page, 'stories.start');
  await toTheCloseUp(page);
  const box = await page.locator('canvas').boundingBox();
  if (box === null) {
    throw new Error('no canvas on the page');
  }
  const stage = { w: box.width, h: box.height };
  // Either tier frames it alike: 1.10 is inside both zoom ranges, so the push is cover x 1.10 whatever the session's tier.
  for (const half of [false, true]) {
    const z = zoomRange(rig, stage, 1, half);
    expect(z.min <= 1.1 && 1.1 <= z.max, `the zoom range ${z.min}..${z.max} (half ${half}) at ${stage.w} x ${stage.h} holds 1.10`).toBe(true);
  }
  const rest = restFraming(rig, stage, 1, false);
  const push = camFraming(rig, stage, 1, false, PUSH);
  const toStage = (f: { x: number; y: number; k: number }, q: readonly [number, number]): [number, number] => [
    Math.round(f.x + q[0] * f.k),
    Math.round(f.y + q[1] * f.k),
  ];
  const toPlate = (f: { x: number; y: number; k: number }, p: readonly [number, number]): [number, number] => [(p[0] - f.x) / f.k, (p[1] - f.y) / f.k];
  // The push frames her: her head centred across the stage, every face layer box whole on it, 1.10 / z0 times larger.
  const head = face.head;
  expect(Math.abs(push.x + (head[0] + head[2] / 2) * push.k - stage.w / 2), "the keeper's head centred across the stage").toBeLessThan(0.5);
  const layers = Object.values(face.exprs).flatMap((e) => (e.layer === null ? [] : [e.layer.at]));
  expect(layers.length, "the keeper's face layer boxes").toBeGreaterThan(0);
  for (const [x, y, w, h] of layers) {
    const [x0, y0] = toStage(push, [x, y]);
    const [x1, y1] = toStage(push, [x + w, y + h]);
    expect([x0 >= 0, y0 >= 0, x1 <= stage.w, y1 <= stage.h], `the face box ${x}, ${y}, ${w}, ${h} whole under the push`).toEqual([true, true, true, true]);
  }
  expect(push.k / rest.k, 'the push over the rest').toBeCloseTo(1.1 / overscan(rig, stage, 1, false), 9);

  // At a004, the close-up at rest: the candidate points, read from one shot of the canvas.
  await stillScene(page);
  await revealed(page);
  const shot = await canvasShot(page);
  expect([shot.w, shot.h], 'the canvas shot in CSS px').toEqual([Math.round(stage.w), Math.round(stage.h)]);
  // Between the overlays (the quick bar at the top, the dialogue at the bottom), each with a margin.
  const quick = await page.locator('nav.quick').boundingBox();
  const dialogue = await page.locator('.dialogue').boundingBox();
  const top = (quick === null ? 0 : quick.y + quick.height - box.y) + 4;
  const bottom = Math.min(shot.h, (dialogue?.y ?? Number.POSITIVE_INFINITY) - box.y) - 4;
  const r = Math.ceil(6 * rest.k); // 6 plate px at the rest scale, in stage px
  const onStage = ([x, y]: readonly [number, number]): boolean => x >= r && x < shot.w - r && y >= top + r && y < bottom - r;
  const steady = ([x, y]: readonly [number, number]): boolean => {
    const c = rgb(shot.at(x, y));
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (!within(shot.at(x + dx, y + dy), c, 10)) {
          return false;
        }
      }
    }
    return true;
  };
  const off = (boxes: readonly Box[], [x, y]: readonly [number, number]): boolean =>
    boxes.every(([bx, by, bw, bh]) => x < bx - 6 || x >= bx + bw + 6 || y < by - 6 || y >= by + bh + 6);
  const motion = Object.values(face.exprs).flatMap(({ motion: m }) => [
    m.blink.half.at,
    m.blink.closed.at,
    m.accent.at,
    ...m.talk.map((t) => t.at),
    ...(m.joint ? [m.joint.half.at, m.joint.closed.at] : []),
  ]);
  const hair = keeper.hair.map((h) => h.member.at);
  const { body } = keeper;
  const ry = body.rot === 0 ? body.ry : Math.max(body.rx, body.ry);
  const rx = body.rot === 0 ? body.rx : ry;
  const figure: Box = [body.cx - rx, body.cy - ry, 2 * rx, 2 * ry];
  // q off every motion and hair member; what the rest frame shows at p off her face, her figure and those members.
  const qOff = [...motion, ...hair];
  const pOff = [...qOff, ...layers, figure, ...(keeper.figure === null ? [] : [keeper.figure.at])];
  const inFace = (q: readonly [number, number]): boolean => !off(layers.map(([x, y, w, h]): Box => [x + 12, y + 12, w - 24, h - 24]), q);
  const centre = [head[0] + head[2] / 2, head[1] + head[3] / 2] as const;
  type Pick = { q: [number, number]; p: [number, number]; atQ: [number, number]; face: boolean; gap: number };
  const picks: Pick[] = [];
  for (let qy = 0; qy <= rig.h; qy += 2) {
    for (let qx = 0; qx <= rig.w; qx += 2) {
      const q: [number, number] = [qx, qy];
      const p = toStage(push, q);
      const atQ = toStage(rest, q);
      if (!onStage(p) || !onStage(atQ) || !off(qOff, q) || !off(pOff, toPlate(rest, p))) {
        continue;
      }
      if (distance(shot.at(...p), rgb(shot.at(...atQ))) > 40 && steady(p) && steady(atQ)) {
        picks.push({ q, p, atQ, face: inFace(q), gap: Math.hypot(qx - centre[0], qy - centre[1]) });
      }
    }
  }
  const inside = picks.filter((c) => c.face);
  const pick = (inside.length > 0 ? inside : picks).reduce<Pick | null>((a, b) => (a === null || b.gap < a.gap ? b : a), null);
  if (pick === null) {
    throw new Error('fixture shape absent: no plate point the push moves to a stage point the rest frame shows in another colour');
  }
  const [px, py] = pick.p;
  const [fx, fy] = pick.atQ;
  const atQ = rgb(await stagePixel(page, fx, fy));
  const before = await stagePixel(page, px, py);
  console.log(
    `shots E2: rest ${JSON.stringify(rest)}, push ${JSON.stringify(push)}; ${picks.length} candidates, ${inside.length} in the face box; ` +
      `q ${pick.q.join(', ')} (${pick.face ? 'face box' : 'plate edge'}) shows ${atQ.join(', ')} at ${fx}, ${fy}; p ${px}, ${py} shows ${before.join(', ')} at rest`,
  );
  expect(distance(before, atQ), `p ${px}, ${py} at rest (${before.join(', ')}) against q at rest (${atQ.join(', ')})`).toBeGreaterThan(40);

  // a005's batch is the push: reachLine returns at its line at rest (the move over), atRest once nothing loads.
  await reachLine(page, 'ch4.lamp.a005');
  await atRest(page);
  const below = await page.locator('.dialogue').boundingBox();
  expect((below?.y ?? Number.POSITIVE_INFINITY) - box.y, 'the dialogue at a005 below the sample').toBeGreaterThan(py + r);
  const above = await page.locator('nav.quick').boundingBox();
  expect(above === null ? 0 : above.y + above.height - box.y, 'the quick bar at a005 above the sample').toBeLessThan(py - r);
  const after = await stagePixel(page, px, py);
  expect(within(after, atQ, 10), `p ${px}, ${py} under the push: ${after.join(', ')} against q's ${atQ.join(', ')}`).toBe(true);
});

test("shots: live texture bytes stay within each step's window bound across the lamp knot", async ({ page, request }) => {
  // E3 (shots §5.8, 09d:63-69, cut D7): at each line from a001 to a019, once the scheduler is idle and nothing moves
  // (no window pending, no load, no timeline, no preview), the live texture bytes are within the full size of the
  // step's window, need, warm and hope (budget.ts decoded: the decoded bytes plus the larger file), and no reservation
  // is live: a017's dissolve has released the insert and its target by its rest.
  test.setTimeout(300_000);
  ch4Story();
  const look = ch4Look();
  const manifest = ch4Manifest();
  await grantChapter(request, UID_WINDOW, 'chapter:ch4');
  await launch(page, UID_WINDOW);
  await play(page, 'stories.start');
  await reachLine(page, 'ch3.lighthouse.l008', { 'ch3.shore.c001': 1 });
  await reachLine(page, 'ch3.lighthouse_stairs.t011', { 'ch3.lighthouse.c001': 1 });
  await reachLine(page, LAMP_LINE);

  type Row = { line: string; live: number; bound: number; reservations: number; ids: number };
  const rows: Row[] = [];
  for (let step = 0; ; step++) {
    if (step >= 40) {
      throw new Error(`${LAMP_LAST} not reached in 40 steps`);
    }
    let now: Shown = { line: null, revealing: false, choices: [] };
    await expect
      .poll(
        async () => {
          now = await shownNow(page);
          return now.choices.length > 0 || (now.line !== null && !now.revealing);
        },
        { timeout: LINE_MS, message: 'a line or a choice set' },
      )
      .toBe(true);
    if (now.choices.length > 0) {
      // c001, the crank: the knot's one choice.
      expect(now.choices[0], 'the lamp knot choice').toBe('ch4.lamp.c001');
      const set = now.choices.join(' ');
      await page.locator('.choices button').nth(0).tap();
      await expect.poll(async () => (await shownNow(page)).choices.join(' '), { timeout: LINE_MS, message: 'the pick in ch4.lamp.c001' }).not.toBe(set);
      continue;
    }
    const line = now.line ?? '';
    const seen: { s: WindowScene | null } = { s: null };
    await expect
      .poll(
        async () => {
          const s = await windowScene(page);
          seen.s = s;
          return s.window.pending + s.pendingLoads + s.activeTimelines + s.previews;
        },
        { timeout: LINE_MS, intervals: [250], message: `the scheduler idle at ${line}` },
      )
      .toBe(0);
    const s = seen.s;
    const w = stepWindow(look, line);
    if (s === null || w === null) {
      throw new Error(`fixture shape absent: ch4's look has no window for ${line}`);
    }
    const ids = [...new Set([...w.need, ...w.warm, ...w.hope])];
    let bound = 0;
    for (const id of ids) {
      const e = manifest.assets[id];
      if (e?.kind !== 'image') {
        throw new Error(`fixture shape absent: ${line}'s window lists ${id}, not an image of ch4's manifest`);
      }
      bound += e.decodedBytes + Math.max(e.avif.bytes, e.webp.bytes);
    }
    rows.push({ line, live: s.liveBytes, bound, reservations: s.reservations ?? -1, ids: ids.length });
    if (line === LAMP_LAST) {
      break;
    }
    await page.locator('.dialogue .tap').tap();
    await expect
      .poll(
        async () => {
          const x = await shownNow(page);
          return x.line !== line || x.choices.length > 0;
        },
        { timeout: LINE_MS, message: `the step after ${line}` },
      )
      .toBe(true);
  }
  console.log(`shots E3: line, liveBytes, bound (ids), reservations\n${rows.map((x) => `  ${x.line} ${x.live} ${x.bound} (${x.ids}) ${x.reservations}`).join('\n')}`);
  const lines = rows.map((x) => x.line);
  for (const l of ['ch4.lamp.a004', 'ch4.lamp.a005', 'ch4.lamp.a016', 'ch4.lamp.a017', LAMP_LAST]) {
    expect(lines, `the walk sampled ${l}`).toContain(l);
  }
  expect(
    rows.filter((x) => x.live > x.bound || x.reservations !== 0),
    'steps whose live texture bytes pass their window bound, or with a live reservation',
  ).toEqual([]);
});
