import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { ASSET_ID_RE, decodeAssetCatalog, decodeAssetManifest, decodeCoverManifest } from '../../src/story/catalog.ts';
import type { CatalogImage, CatalogIssue, ChapterListEntry, Trim } from '../../src/story/catalog.ts';
import { decodeLook, decodeLoops, decodeShotRigs, stepWindow } from '../../src/story/shots.ts';
import type { FaceRig, ShotRig } from '../../src/story/shots.ts';
import type { AssetId, BgId, ChapterId, CharId, ExprId, PropId } from '../../src/story/staging.ts';
import { main } from '../assets.ts';
import type { Encoders } from '../assets.ts';
import { LIMITS } from '../budget.ts';
import { scanPaidFiles } from '../scan-dist.ts';
import { decodeChapterList, decodeStoryUsage } from '../story/emit.ts';
import { placeholderHue } from '../story/shots/list.ts';
import type { Shot } from '../story/shots/list.ts';
import { parseShotFileId } from '../story/shots/usage.ts';
import type { ShotNeed } from '../story/shots/usage.ts';
import { SHARP_CODEC, decodeRaster, encodeAvif, encodeImage, encodeRaster, halfRgba } from './encode.ts';
import type { Codec, EncodedRaster } from './encode.ts';
import { alphaProblems, decodeShotSource, extractShot } from './extract.ts';
import { syntheticShot } from './fixtures/shot/synthetic.ts';
import type { Knobs } from './fixtures/shot/synthetic.ts';
import { ASSET_FILE_RE, ASSET_OUT, assetFileName, assetUsage, catalogImage, decodeAssetFingerprints, gatedCopies, halfAsk, sha256Hex, tierOf, urlPath } from './manifest.ts';
import type { AssetUsage } from './manifest.ts';
import { CANONICAL_SIZE, imageKind, renderPlaceholder } from './placeholder.ts';
import type { ImageKind } from './placeholder.ts';
import { packShot, shotFileRaster } from './shots.ts';
import type { ChapterNeed, Raster } from './shots.ts';
import { synthWav } from './synth.ts';

const CLIENT_DIR = fileURLToPath(new URL('../..', import.meta.url));
/** A spawned CLI run (node + sharp) on a loaded machine; the 5 s default fails it spuriously (carry, LP2's C0). */
const CLI_TIMEOUT_MS = 30_000;
const ASSETS_SCRIPT = fileURLToPath(new URL('../assets.ts', import.meta.url));

// ---------------------------------------------------------------------------------------------------------------
// The catalog entry schema (assets/catalog.json): seven namespaces, every entry a placeholder's parameters.

type RawCatalog = Record<string, Record<string, unknown>>;

/** A small catalog in the committed format: every namespace, one placeholder entry each. */
function rawCatalog(): RawCatalog {
  return {
    bg: { cafe: { placeholder: { hue: 30 } } },
    chars: { ally: { exprs: { neutral: { placeholder: { hue: 200 } } } } },
    cg: { letter: { placeholder: { hue: 50 } } },
    bgm: { calm: { placeholder: { hz: 220 } }, tension: { placeholder: { hz: 247 } } },
    sfx: { door: { placeholder: { hz: 440 } } },
    prop: { note: { placeholder: { hue: 120 } } },
    cover: { manor: { placeholder: { hue: 15 } } },
  };
}

function issues(r: { ok: true } | { ok: false; error: CatalogIssue[] }): CatalogIssue[] {
  return r.ok ? [] : r.error;
}

function at(path: string): CatalogIssue {
  return { file: 'assets/catalog.json', path, detail: expect.any(String) as string };
}

describe('catalog', () => {
  test('catalog: cover namespace decodes', () => {
    const r = decodeAssetCatalog(rawCatalog());
    expect(issues(r)).toEqual([]);
    expect(r.ok && r.value.cover).toEqual({ manor: { placeholder: { hue: 15 } } });
    expect(ASSET_ID_RE.test('cover/manor')).toBe(true);
    expect(ASSET_ID_RE.test('cover/manor/x')).toBe(false);
    // Required like the other namespaces: a catalog without covers is an error, not an empty Home.
    const raw = rawCatalog();
    Reflect.deleteProperty(raw, 'cover');
    expect(issues(decodeAssetCatalog(raw))).toContainEqual({ file: 'assets/catalog.json', path: 'cover', detail: 'missing' });
  });

  test('catalog: prop namespace decodes', () => {
    const r = decodeAssetCatalog(rawCatalog());
    expect(issues(r)).toEqual([]);
    expect(r.ok && r.value.prop).toEqual({ note: { placeholder: { hue: 120 } } });
    expect(ASSET_ID_RE.test('prop/note')).toBe(true);
    expect(ASSET_ID_RE.test('prop/Note')).toBe(false);
    const raw = rawCatalog();
    Reflect.deleteProperty(raw, 'prop');
    expect(issues(decodeAssetCatalog(raw))).toContainEqual({ file: 'assets/catalog.json', path: 'prop', detail: 'missing' });
    raw['prop'] = { all: { placeholder: { hue: 1 } } };
    expect(issues(decodeAssetCatalog(raw))).toContainEqual(at('prop.all'));
  });

  test('catalog: entry needs placeholder params', () => {
    const cases: ReadonlyArray<readonly [string, (c: RawCatalog) => void, readonly string[]]> = [
      ['empty bg entry', (c) => (c.bg = { cafe: {} }), ['bg.cafe.placeholder']],
      ['empty expression', (c) => (c.chars = { ally: { exprs: { neutral: {} } } }), ['chars.ally.exprs.neutral.placeholder']],
      ['empty cg entry', (c) => (c.cg = { letter: {} }), ['cg.letter.placeholder']],
      ['empty prop entry', (c) => (c.prop = { note: {} }), ['prop.note.placeholder']],
      ['empty cover entry', (c) => (c.cover = { manor: {} }), ['cover.manor.placeholder']],
      ['empty bgm entry', (c) => (c.bgm = { calm: {} }), ['bgm.calm.placeholder']],
      ['empty sfx entry', (c) => (c.sfx = { door: {} }), ['sfx.door.placeholder']],
      // Real art and audio are PP "Later": a source path is an unknown key until a lane makes it a tested path.
      ['src beside the placeholder', (c) => (c.bg = { cafe: { placeholder: { hue: 30 }, src: 'cafe.png' } }), ['bg.cafe.src']],
      ['audio src instead of a placeholder', (c) => (c.sfx = { door: { src: 'door.m4a' } }), ['sfx.door.src', 'sfx.door.placeholder']],
      ['placeholder not an object', (c) => (c.bg = { cafe: { placeholder: 30 } }), ['bg.cafe.placeholder']],
      ['hue over 359', (c) => (c.bg = { cafe: { placeholder: { hue: 360 } } }), ['bg.cafe.placeholder.hue']],
      ['negative hue', (c) => (c.cover = { manor: { placeholder: { hue: -1 } } }), ['cover.manor.placeholder.hue']],
      ['fractional hue', (c) => (c.prop = { note: { placeholder: { hue: 1.5 } } }), ['prop.note.placeholder.hue']],
      ['hue as a string', (c) => (c.cg = { letter: { placeholder: { hue: '50' } } }), ['cg.letter.placeholder.hue']],
      ['image with a tone', (c) => (c.bg = { cafe: { placeholder: { hz: 220 } } }), ['bg.cafe.placeholder.hz', 'bg.cafe.placeholder.hue']],
      ['audio with a hue', (c) => (c.bgm = { calm: { placeholder: { hue: 30 } } }), ['bgm.calm.placeholder.hue', 'bgm.calm.placeholder.hz']],
      ['tone under 55 Hz', (c) => (c.sfx = { door: { placeholder: { hz: 54 } } }), ['sfx.door.placeholder.hz']],
      ['tone over 1760 Hz', (c) => (c.sfx = { door: { placeholder: { hz: 1761 } } }), ['sfx.door.placeholder.hz']],
      ['fractional tone', (c) => (c.bgm = { calm: { placeholder: { hz: 220.5 } } }), ['bgm.calm.placeholder.hz']],
      // Two placeholders of one role with one tone are the same bytes: a public and a paid-only copy would collide.
      ['shared tone in one role', (c) => (c.bgm = { calm: { placeholder: { hz: 220 } }, mystery: { placeholder: { hz: 220 } } }), ['bgm.mystery.placeholder.hz']],
    ];
    for (const [name, mutate, paths] of cases) {
      const raw = rawCatalog();
      mutate(raw);
      const found = issues(decodeAssetCatalog(raw));
      for (const path of paths) {
        expect(found, name).toContainEqual(at(path));
      }
      expect(found.length, name).toBe(paths.length);
    }
    // Controls: the fixture decodes, and one tone in two roles is two different clips (8 s against 0.6 s).
    expect(issues(decodeAssetCatalog(rawCatalog()))).toEqual([]);
    const crossRole = rawCatalog();
    crossRole.sfx = { door: { placeholder: { hz: 220 } } };
    expect(issues(decodeAssetCatalog(crossRole))).toEqual([]);
  });

  test('catalog: a bg src form decodes', () => {
    // Shots §2.4, §4.1: a bg is its placeholder or its own extracted shot directory (`assets/src/shot/<id>/`, SH3c).
    const raw = rawCatalog();
    raw.bg = { cafe: { src: 'shot/cafe' }, hall: { placeholder: { hue: 30 } } };
    const r = decodeAssetCatalog(raw);
    expect(issues(r)).toEqual([]);
    expect(r.ok && r.value.bg).toEqual({ cafe: { src: 'shot/cafe' }, hall: { placeholder: { hue: 30 } } });
    // Another shot's directory, a file, a deeper path, a non-string: refused at the entry's src, and only there.
    for (const src of ['shot/hall', 'cafe.png', 'shot/cafe/plate.png', 'loop/cafe', 7]) {
      raw.bg = { cafe: { src } };
      expect(issues(decodeAssetCatalog(raw)), String(src)).toEqual([at('bg.cafe.src')]);
    }
    // An unknown key beside src is reported; src is a bg's form only (another image namespace keeps its one form).
    raw.bg = { cafe: { src: 'shot/cafe', hue: 30 } };
    expect(issues(decodeAssetCatalog(raw))).toEqual([at('bg.cafe.hue')]);
    const cg = rawCatalog();
    cg.cg = { letter: { src: 'shot/letter' } };
    expect(issues(decodeAssetCatalog(cg))).toEqual([at('cg.letter.src'), at('cg.letter.placeholder')]);
  });

  test('catalog: a loop prop decodes with its frames and fps', () => {
    // Shots §2.4 (rev. 2, W10): a prop is an image or a loop, its frames from a placeholder (hue, 1..12 frames) or its
    // own source directory (`loop/<id>`, SH3c), stepped at a positive integer fps.
    const raw = rawCatalog();
    raw.prop = {
      note: { placeholder: { hue: 120 } },
      fire: { loop: { placeholder: { hue: 20, frames: 6 }, fps: 8 } },
      torch: { loop: { src: 'loop/torch', fps: 12 } },
    };
    const r = decodeAssetCatalog(raw);
    expect(issues(r)).toEqual([]);
    expect(r.ok && r.value.prop).toEqual({
      note: { placeholder: { hue: 120 } },
      fire: { loop: { placeholder: { hue: 20, frames: 6 }, fps: 8 } },
      torch: { loop: { src: 'loop/torch', fps: 12 } },
    });
    const one = (fire: unknown): CatalogIssue[] => {
      const c = rawCatalog();
      c.prop = { fire };
      return issues(decodeAssetCatalog(c));
    };
    const cases: ReadonlyArray<readonly [string, unknown, readonly string[]]> = [
      ['no frame', { loop: { placeholder: { hue: 20, frames: 0 }, fps: 8 } }, ['prop.fire.loop.placeholder.frames']],
      ['13 frames', { loop: { placeholder: { hue: 20, frames: 13 }, fps: 8 } }, ['prop.fire.loop.placeholder.frames']],
      ['fractional frames', { loop: { placeholder: { hue: 20, frames: 1.5 }, fps: 8 } }, ['prop.fire.loop.placeholder.frames']],
      ['hue over 359', { loop: { placeholder: { hue: 360, frames: 6 }, fps: 8 } }, ['prop.fire.loop.placeholder.hue']],
      ['unknown placeholder key', { loop: { placeholder: { hue: 20, frames: 6, hz: 9 }, fps: 8 } }, ['prop.fire.loop.placeholder.hz']],
      ['fps 0', { loop: { placeholder: { hue: 20, frames: 6 }, fps: 0 } }, ['prop.fire.loop.fps']],
      ['fps as a string', { loop: { placeholder: { hue: 20, frames: 6 }, fps: '8' } }, ['prop.fire.loop.fps']],
      ['no fps', { loop: { placeholder: { hue: 20, frames: 6 } } }, ['prop.fire.loop.fps']],
      ["another loop's source", { loop: { src: 'loop/torch', fps: 8 } }, ['prop.fire.loop.src']],
      ['a shot source', { loop: { src: 'shot/fire', fps: 8 } }, ['prop.fire.loop.src']],
      ['both forms', { loop: { placeholder: { hue: 20, frames: 6 }, src: 'loop/fire', fps: 8 } }, ['prop.fire.loop']],
      ['neither form', { loop: { fps: 8 } }, ['prop.fire.loop']],
      ['unknown loop key', { loop: { src: 'loop/fire', fps: 8, speed: 2 } }, ['prop.fire.loop.speed']],
      ['loop not an object', { loop: 8 }, ['prop.fire.loop']],
      ['loop beside a placeholder', { placeholder: { hue: 20 }, loop: { src: 'loop/fire', fps: 8 } }, ['prop.fire.loop']],
    ];
    for (const [name, fire, paths] of cases) {
      expect(one(fire), name).toEqual(paths.map(at));
    }
    // A loop is a prop's form only: on a bg it is an unknown key.
    const bg = rawCatalog();
    bg.bg = { cafe: { loop: { src: 'loop/cafe', fps: 8 } } };
    expect(issues(decodeAssetCatalog(bg))).toEqual([at('bg.cafe.loop'), at('bg.cafe.placeholder')]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Placeholder SVG (placeholder.ts): canonical size per namespace, hue, label, transparency.

/** The root element's width, height and viewBox attributes. */
function rootAttrs(svg: string): { width: string; height: string; viewBox: string } {
  const open = /^<svg\b[^>]*>/.exec(svg)?.[0] ?? '';
  const attr = (name: string): string => new RegExp(String.raw`\s${name}="([^"]*)"`).exec(open)?.[1] ?? '';
  return { width: attr('width'), height: attr('height'), viewBox: attr('viewBox') };
}

describe('placeholder', () => {
  const HUE30: CatalogImage = { placeholder: { hue: 30 } };

  test('placeholder: canonical sizes per namespace', () => {
    const cases: ReadonlyArray<readonly [string, number, number]> = [
      ['bg/cafe', 1080, 2048],
      ['cg/letter', 1080, 2048],
      ['char/ally/smile', 768, 1536],
      ['prop/note', 512, 512],
      ['cover/manor', 360, 640],
    ];
    for (const [id, w, h] of cases) {
      const p = renderPlaceholder(id as AssetId, HUE30); // a literal asset id of the demo catalog
      expect({ w: p.w, h: p.h }, id).toEqual({ w, h });
      expect(rootAttrs(p.svg), id).toEqual({ width: String(w), height: String(h), viewBox: `0 0 ${w} ${h}` });
    }
    // Audio has no picture: asking for one is a caller bug.
    expect(() => renderPlaceholder('bgm/calm' as AssetId, HUE30)).toThrow(/invariant/);
  });

  test('placeholder: deterministic and hue-specific', () => {
    const random = vi.spyOn(Math, 'random');
    vi.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') });
    try {
      const first = renderPlaceholder('bg/cafe' as AssetId, HUE30).svg;
      vi.setSystemTime(new Date('2031-06-15T12:34:56Z'));
      expect(renderPlaceholder('bg/cafe' as AssetId, HUE30).svg).toBe(first);
      expect(random).not.toHaveBeenCalled();
      const other = renderPlaceholder('bg/cafe' as AssetId, { placeholder: { hue: 200 } }).svg;
      expect(other).not.toBe(first);
      expect(first).toContain('hsl(30 ');
      expect(other).toContain('hsl(200 ');
      expect(other).not.toContain('hsl(30 ');
      // The label is the asset id: two ids with one hue are two different pictures.
      expect(first).toMatch(/<text\b[^>]*>bg\/cafe<\/text>/);
      expect(renderPlaceholder('bg/room' as AssetId, HUE30).svg).not.toBe(first);
    } finally {
      vi.useRealTimers();
      random.mockRestore();
    }
  });

  test('assets: every image namespace has a canonical size and a placeholder shape', () => {
    // Shots §4.4 (rev. 4, W5): imageKind is the one image-namespace predicate; a shot file (sheet, face, talk) is an
    // image kind like the other five, so every Record keyed by it has the three and the planner reads one predicate.
    const cases: ReadonlyArray<readonly [string, string, number, number]> = [
      ['bg/cafe', 'bg', 1080, 2048],
      ['cg/letter', 'cg', 1080, 2048],
      ['char/ally/smile', 'char', 768, 1536],
      ['prop/note', 'prop', 512, 512],
      ['cover/manor', 'cover', 360, 640],
      // The packing bound of a shot file (principle 4's 2048 px), not a fixed canvas: the packer sizes each file.
      ['sheet/cafe', 'sheet', 2048, 2048],
      ['face/cafe/ally/smile', 'face', 2048, 2048],
      ['talk/cafe/ally/smile', 'talk', 2048, 2048],
    ];
    for (const [id, kind, w, h] of cases) {
      expect(imageKind(id as AssetId), id).toBe(kind);
      expect(CANONICAL_SIZE[kind as ImageKind], id).toEqual({ w, h });
      const p = renderPlaceholder(id as AssetId, HUE30); // a literal asset id
      expect(rootAttrs(p.svg), id).toEqual({ width: String(w), height: String(h), viewBox: `0 0 ${w} ${h}` });
      expect(p.svg, id).toContain(`>${id}</text>`);
    }
    expect(Object.keys(CANONICAL_SIZE).sort()).toEqual(cases.map(([, kind]) => kind).sort());
    for (const id of ['face/cafe/ally/smile', 'talk/cafe/ally/smile', 'sheet/cafe']) {
      expect(renderPlaceholder(id as AssetId, HUE30).svg, id).not.toMatch(/<rect/); // a transparent canvas
    }
    for (const id of ['bgm/calm', 'sfx/door', 'face/cafe/ally', 'sheet/cafe/ally']) {
      expect(imageKind(id as AssetId) === null || !ASSET_ID_RE.test(id), id).toBe(true);
    }
  });

  test('placeholder: character and prop are transparent', () => {
    const char = renderPlaceholder('char/ally/smile' as AssetId, HUE30).svg;
    const prop = renderPlaceholder('prop/note' as AssetId, HUE30).svg;
    for (const svg of [char, prop]) {
      expect(svg).not.toMatch(/<rect\b/); // nothing paints the full canvas: the background shows through
      expect(svg).toMatch(/<circle\b/);
    }
    expect(char).toMatch(/<path\b[^>]*\sd="M[^"]+Z"/); // the body under the head circle
    // Control: a background is opaque edge to edge.
    expect(renderPlaceholder('bg/cafe' as AssetId, HUE30).svg).toMatch(/<rect x="0" y="0" width="1080" height="2048"/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Encode (encode.ts): sharp, AVIF + WebP, the 2048 px clamp, dimensions from sharp's output info.

const utf8 = new TextEncoder();

function strip(w: number, h: number): Uint8Array {
  return utf8.encode(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
      `<rect x="0" y="0" width="${w}" height="${h}" fill="hsl(10 50% 50%)"/></svg>`,
  );
}

async function dims(bytes: Uint8Array): Promise<{ w: number | undefined; h: number | undefined; format: string | undefined }> {
  const m = await sharp(bytes).metadata();
  return { w: m.width, h: m.height, format: m.format };
}

/** A raster's alpha clamped to 0 / 255: what a codec that loses the feather decodes to (M-SH3e's shape). */
function clampAlpha(r: Raster): Raster {
  const data = Uint8Array.from(r.data);
  for (let i = 3; i < data.length; i += 4) {
    data[i] = (data[i] ?? 0) < 128 ? 0 : 255;
  }
  return { data, w: r.w, h: r.h };
}

/** The half tier's source of a raster (MEMORY-PLAN 4.C). */
function halfOf(r: Raster): Raster {
  return { data: halfRgba(r.data, r.w, r.h), w: r.w / 2, h: r.h / 2 };
}

/** A w × h test raster: colour noise (a fixed hash) under an ellipse's alpha, 255 inside with a 3-px ramp at its edge. */
function featheredNoise(w: number, h: number): Raster {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = Math.imul(Math.imul(x, 73856093) ^ Math.imul(y, 19349663), 2654435761) >>> 0;
      const d = (Math.hypot((x + 0.5 - w / 2) / (0.4 * w), (y + 0.5 - h / 2) / (0.4 * h)) - 1) * 0.4 * Math.min(w, h);
      data.set([v & 255, (v >>> 8) & 255, (v >>> 16) & 255, Math.round(255 * Math.min(1, Math.max(0, 0.5 - d / 3)))], (y * w + x) * 4);
    }
  }
  return { data, w, h };
}

/** A src loop's frame `i` (cut rider R-b): `featheredNoise` with its red channel turned per frame, so frames differ. */
function loopFrame(i: number, w: number, h: number): Raster {
  const r = featheredNoise(w, h);
  const data = Uint8Array.from(r.data);
  for (let p = 0; p < data.length; p += 4) {
    data[p] = ((data[p] ?? 0) + 41 * i) & 255;
  }
  return { data, w, h };
}

/**
 * A fake codec for the q search (RULINGS 267): each AVIF call answers `bytes(w, q)` zero bytes that decode to the tier's
 * px as given when `pass(w, q)`, else with their alpha clamped; `calls` records `<w>:<q>` per AVIF call in order, `out`
 * each call's bytes. The search's R6 compare stays the real one.
 */
function fakeCodec(
  pass: (w: number, q: number) => boolean,
  bytes: (w: number, q: number) => number,
): { codec: Codec; calls: string[]; out: Map<string, Uint8Array> } {
  const decoded = new Map<Uint8Array, Raster>();
  const calls: string[] = [];
  const out = new Map<string, Uint8Array>();
  const codec: Codec = {
    avif: (px, q) => {
      const b = new Uint8Array(bytes(px.w, q));
      decoded.set(b, pass(px.w, q) ? px : clampAlpha(px));
      calls.push(`${px.w}:${q}`);
      out.set(`${px.w}:${q}`, b);
      return Promise.resolve(b);
    },
    webp: (px) => {
      const b = new Uint8Array(1);
      decoded.set(b, px);
      return Promise.resolve(b);
    },
    decode: (b) => {
      const r = decoded.get(b);
      return r === undefined ? Promise.reject(new Error('invariant: the fake decodes its own output')) : Promise.resolve(r);
    },
  };
  return { codec, calls, out };
}

/** The synthetic `src` shot at 1080-plate scale (P0's inputs), extracted and packed: every packed file's px, built once. */
let packedFixture: Promise<ReadonlyMap<AssetId, Raster>> | null = null;
function fixtureFiles(): Promise<ReadonlyMap<AssetId, Raster>> {
  packedFixture ??= (async () => {
    const fx = syntheticShot({ w: 1080, h: 2048, u: 4 });
    const source = decodeShotSource(fx.json, 'cafe' as BgId);
    if (!source.ok) {
      throw new Error(`invariant: the fixture's shot.json decodes: ${source.error.join('; ')}`);
    }
    const shot: Shot = { id: 'cafe' as BgId, loc: 'cafe' as Shot['loc'], frame: 'close', cast: [{ char: 'ally' as CharId, view: 'face', rest: 'neutral' as ExprId, figure: false }] };
    const need = (ch: string, faces: ReadonlyArray<readonly [string, boolean]>): ChapterNeed => ({ ch: ch as ChapterId, need: cafeNeed(faces, ch) as unknown as ShotNeed });
    const r = await extractShot({
      shot,
      source: source.value,
      needs: [need('ch1', [['neutral', true], ['smile', true]]), need('ch2', [['surprised', false], ['angry', false]])],
      load: (file) => Promise.resolve(fx.files.get(file) ?? null),
      loadDepth: () => Promise.resolve(fx.depth),
    });
    if (!r.ok) {
      throw new Error(`invariant: the fixture extracts: ${r.error.join('; ')}`);
    }
    return new Map([...packShot(r.value.layers).files].map(([id, f]) => [id, shotFileRaster(f)] as const));
  })();
  return packedFixture;
}

/** The fixture's packed file `id`. */
function fileOf(files: ReadonlyMap<AssetId, Raster>, id: string): Raster {
  const r = files.get(id as AssetId);
  if (r === undefined) {
    throw new Error(`invariant: the fixture packs ${id}`);
  }
  return r;
}

describe('encode', () => {
  test('encode: input over 2048 px is clamped', async () => {
    const e = await encodeImage(strip(4096, 64));
    expect(e.w).toBe(2048);
    expect(e.h).toBe(32);
    expect(await dims(e.avif)).toEqual({ w: 2048, h: 32, format: 'heif' });
    expect(await dims(e.webp)).toEqual({ w: 2048, h: 32, format: 'webp' });
    // Never enlarged: a small input keeps its size.
    const small = await encodeImage(strip(100, 50));
    expect({ w: small.w, h: small.h }).toEqual({ w: 100, h: 50 });
  });

  test('encode: avif and webp carry the reported dims', async () => {
    const p = renderPlaceholder('cover/manor' as AssetId, { placeholder: { hue: 35 } });
    const e = await encodeImage(utf8.encode(p.svg));
    expect({ w: e.w, h: e.h }).toEqual({ w: p.w, h: p.h });
    const avif = await sharp(e.avif).metadata();
    // libheif reports AVIF as format 'heif' with AV1 compression (verified on sharp 0.35.5).
    expect({ format: avif.format, compression: avif.compression, w: avif.width, h: avif.height }).toEqual({
      format: 'heif',
      compression: 'av1',
      w: 360,
      h: 640,
    });
    expect(await dims(e.webp)).toEqual({ w: 360, h: 640, format: 'webp' });
  });

  test('encode: a transparent sprite is cut to its alpha box plus 2 px, even-sided', async () => {
    // MEMORY-PLAN 4.B: an integer-aligned opaque rect on a transparent canvas; the box widens by 2 px (clamped to the
    // canvas), then to even sides on the far side, or on the near side where the far side is the canvas edge.
    const sprite = (w: number, h: number, r: { x: number; y: number; w: number; h: number } | null): Uint8Array =>
      utf8.encode(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
          (r === null ? '' : `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="hsl(200 45% 55%)"/>`) +
          '</svg>',
      );
    // Case A: x 154..613 → 152..615; y 145..1535 → 143..1535 (the canvas edge), odd, so the near side: 142..1535.
    const a = await encodeImage(sprite(768, 1536, { x: 154, y: 145, w: 460, h: 1391 }), { trim: true });
    expect(a.w).toBe(464);
    expect({ w: a.w, h: a.h, trim: a.trim }).toEqual({ w: 464, h: 1394, trim: { canvasW: 768, canvasH: 1536, x: 152, y: 142 } });
    expect(await dims(a.avif)).toEqual({ w: 464, h: 1394, format: 'heif' });
    expect(await dims(a.webp)).toEqual({ w: 464, h: 1394, format: 'webp' });
    // Case B, on the 512×512 prop canvas: x 101..201 → 99..203, y 201..301 → 199..303, both odd: the far sides widen,
    // x 99..204 and y 199..304.
    const b = await encodeImage(sprite(512, 512, { x: 101, y: 201, w: 101, h: 101 }), { trim: true });
    expect({ w: b.w, h: b.h, trim: b.trim }).toEqual({ w: 106, h: 106, trim: { canvasW: 512, canvasH: 512, x: 99, y: 199 } });
    expect(await dims(b.avif)).toEqual({ w: 106, h: 106, format: 'heif' });
    expect(await dims(b.webp)).toEqual({ w: 106, h: 106, format: 'webp' });
    // Controls: an empty alpha box and a box that is the whole canvas stay untrimmed, byte for byte the untrimmed
    // encode (bg, cg and cover never ask for a trim).
    for (const input of [sprite(768, 1536, null), strip(100, 50)]) {
      const plain = await encodeImage(input);
      const asked = await encodeImage(input, { trim: true });
      expect(Object.hasOwn(asked, 'trim')).toBe(false);
      expect({ w: asked.w, h: asked.h }).toEqual({ w: plain.w, h: plain.h });
      expect(Buffer.compare(asked.avif, plain.avif)).toBe(0);
      expect(Buffer.compare(asked.webp, plain.webp)).toBe(0);
    }
  });

  test('encode: the half of a trimmed placeholder is its 2 x 2 average', async () => {
    // MEMORY-PLAN 4.C (critique_r2 W5), on the stranger as placeholder.ts draws it, through M1's trim.
    const id = 'char/stranger/neutral' as AssetId;
    const catalog = decodeAssetCatalog(JSON.parse(readFileSync(new URL('../../../assets/catalog.json', import.meta.url), 'utf8')));
    const entry = catalog.ok ? catalogImage(catalog.value, id) : undefined;
    if (entry === undefined) {
      throw new Error(`invariant: assets/catalog.json defines ${id}`);
    }
    const svg = utf8.encode(renderPlaceholder(id, entry).svg);
    const e = await encodeImage(svg, { trim: true, half: { canvasH: 1536 } });
    expect(e.trim, 'the stranger is trimmed').toBeDefined();
    expect(e.half, 'the half asked on the 1536-px canvas').toBeDefined();
    const { trim, half } = e;
    if (trim === undefined || half === undefined) {
      throw new Error('invariant: checked above');
    }
    // Sizes: exactly half the stored file per side, in both files.
    expect({ w: half.w * 2, h: half.h * 2 }).toEqual({ w: e.w, h: e.h });
    expect(await dims(half.avif)).toEqual({ w: e.w / 2, h: e.h / 2, format: 'heif' });
    expect(await dims(half.webp)).toEqual({ w: e.w / 2, h: e.h / 2, format: 'webp' });

    // Pixels: the stored box of this test's own raster of the SVG, at the reported trim.
    const { data: canvasPx, info } = await sharp(svg).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect({ w: info.width, h: info.height }).toEqual({ w: trim.canvasW, h: trim.canvasH });
    const stored = new Uint8Array(e.w * e.h * 4);
    for (let y = 0; y < e.h; y++) {
      const from = ((trim.y + y) * info.width + trim.x) * 4;
      stored.set(canvasPx.subarray(from, from + e.w * 4), y * e.w * 4);
    }
    const ours = halfRgba(stored, e.w, e.h);
    const px = (a: Uint8Array, i: number): number => a[i] ?? 0;
    let worst = 0;
    for (let y = 0; y < half.h; y++) {
      for (let x = 0; x < half.w; x++) {
        const top = (2 * y * e.w + 2 * x) * 4;
        const block = [top, top + 4, top + e.w * 4, top + e.w * 4 + 4];
        const o = (y * half.w + x) * 4;
        const alpha = block.reduce((s, i) => s + px(stored, i + 3), 0) / 4;
        worst = Math.max(worst, Math.abs(px(ours, o + 3) - alpha));
        // Compared premultiplied: the mean of c·a over the block against the half's own c·a (0..255 scale).
        for (const c of [0, 1, 2]) {
          const mean = block.reduce((s, i) => s + px(stored, i + c) * px(stored, i + 3), 0) / (4 * 255);
          worst = Math.max(worst, Math.abs((px(ours, o + c) * px(ours, o + 3)) / 255 - mean));
        }
      }
    }
    expect(worst, 'the largest premultiplied deviation from the 2 × 2 mean, per channel').toBeLessThanOrEqual(1);

    // The file the encoder wrote is that average: the half WebP's alpha (lossless, sharp's alphaQuality defaults to
    // 100) equals halfRgba's of the stored box px for px (critique r2 W3: no other resampler passes).
    const written = await sharp(half.webp).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect({ w: written.info.width, h: written.info.height }).toEqual({ w: half.w, h: half.h });
    const alphaAt = (x: number, y: number): number => px(written.data, (y * half.w + x) * 4 + 3);
    let differing = 0;
    for (let i = 0; i < half.w * half.h; i++) {
      differing += px(written.data, i * 4 + 3) === px(ours, i * 4 + 3) ? 0 : 1;
    }
    expect(differing, "half WebP px whose alpha is not halfRgba's").toBe(0);
    // Borders, read from the written file: alpha 0 on every border row and column not at the canvas edge.
    const borders: Array<[string, Array<[number, number]>]> = [];
    const rows = (y: number): Array<[number, number]> => Array.from({ length: half.w }, (_, x): [number, number] => [x, y]);
    const cols = (x: number): Array<[number, number]> => Array.from({ length: half.h }, (_, y): [number, number] => [x, y]);
    if (trim.x > 0) {
      borders.push(['left', cols(0)]);
    }
    if (trim.y > 0) {
      borders.push(['top', rows(0)]);
    }
    if (trim.x + e.w < trim.canvasW) {
      borders.push(['right', cols(half.w - 1)]);
    }
    if (trim.y + e.h < trim.canvasH) {
      borders.push(['bottom', rows(half.h - 1)]);
    }
    expect(borders.map(([side]) => side), 'the stranger is inside its canvas on three sides').toEqual(['left', 'top', 'right']);
    for (const [side, points] of borders) {
      expect(points.filter(([x, y]) => alphaAt(x, y) !== 0).length, `${side} border: px with alpha > 0`).toBe(0);
    }

    // The planned pair passes the decoder's exact-halving and canvas rules.
    const ref = (name: string, bytes: Uint8Array): { url: string; bytes: number } => ({ url: `/assets/${name}`, bytes: bytes.length });
    const raw = {
      chapterId: 'ch1',
      assets: {
        [id]: {
          kind: 'image',
          w: e.w,
          h: e.h,
          decodedBytes: e.w * e.h * 4,
          avif: ref('char-stranger-neutral-00000000.avif', e.avif),
          webp: ref('char-stranger-neutral-00000000.webp', e.webp),
          trim,
          half: {
            w: half.w,
            h: half.h,
            decodedBytes: half.w * half.h * 4,
            avif: ref('char-stranger-neutral-half-00000000.avif', half.avif),
            webp: ref('char-stranger-neutral-half-00000000.webp', half.webp),
          },
        },
      },
    };
    expect(decodeAssetManifest(raw)).toEqual({ ok: true, value: raw });

    // P1: no ask, or 'none', gives no half; the ask never moves the full files.
    const unasked = await encodeImage(svg, { trim: true });
    const none = await encodeImage(svg, { trim: true, half: 'none' });
    expect([Object.hasOwn(unasked, 'half'), Object.hasOwn(none, 'half')]).toEqual([false, false]);
    expect({ w: unasked.w, h: unasked.h, trim: unasked.trim }).toEqual({ w: e.w, h: e.h, trim });
    expect(Buffer.compare(e.avif, unasked.avif)).toBe(0);
    expect(Buffer.compare(e.webp, unasked.webp)).toBe(0);
  }, 60_000);

  test('assets: an encoded sheet keeps its feathered alpha within 8/255', async () => {
    // R6 (§4.3, cut D9) through RULINGS 267's search: the fixture's sheet (a feathered hair lock) and its three face files
    // (angry's with its masked blink and accent, fix3 M1) at 1080-plate scale, each searched per tier from q 50. The test
    // decodes what ships, AVIF and WebP of both tiers, and compares every px's alpha with its source's (the half's:
    // halfRgba of it).
    const files = await fixtureFiles();
    const ids = ['face/cafe/ally/angry', 'face/cafe/ally/smile', 'face/cafe/ally/surprised', 'sheet/cafe'];
    expect([...files.keys()].filter((id) => !id.startsWith('talk/')).sort()).toEqual(ids);
    for (const id of ids) {
      const px = fileOf(files, id);
      const r = await encodeRaster(px, { id: id as AssetId, half: 'any', q: 50, search: true });
      expect(r.ok ? [] : r.error, id).toEqual([]);
      const image = r.ok ? r.value.image : null;
      expect(r.ok ? [r.value.q.full >= 50, (r.value.q.half ?? 0) >= 50] : [], `${id}: each chosen q is at least the start`).toEqual([true, true]);
      expect([image?.w, image?.h, image?.half?.w, image?.half?.h]).toEqual([px.w, px.h, px.w / 2, px.h / 2]);
      const half = halfOf(px);
      const shipped: ReadonlyArray<readonly [string, Uint8Array | undefined, Raster]> = [
        [`${id} full AVIF`, image?.avif, px],
        [`${id} full WebP`, image?.webp, px],
        [`${id} half AVIF`, image?.half?.avif, half],
        [`${id} half WebP`, image?.half?.webp, half],
      ];
      for (const [what, bytes, source] of shipped) {
        expect(bytes, what).toBeDefined();
        expect(alphaProblems(what, await decodeRaster(bytes ?? new Uint8Array(0)), source)).toEqual([]);
      }
    }
    // Not vacuous: the sheet's shipped AVIF with its decoded alpha clamped (the feather lost) fails the same check.
    const sheet = fileOf(files, 'sheet/cafe');
    const r = await encodeRaster(sheet, { id: 'sheet/cafe' as AssetId, half: 'none', q: 50, search: true });
    const decoded = await decodeRaster(r.ok ? r.value.image.avif : new Uint8Array(0));
    const clamped = alphaProblems('sheet/cafe full AVIF', clampAlpha(decoded), sheet);
    expect(clamped).toHaveLength(1);
    expect(clamped[0]).toMatch(/^sheet\/cafe full AVIF: alpha \d+\/255 off at \(\d+, \d+\) \(R6: within 8\/255 at every px\)$/);
  }, 120_000);

  test('assets: the q search fails loudly at the ceiling', async () => {
    // RULINGS 267: when no candidate up to 90 keeps every px's alpha within 8/255, each failing tier is an error value
    // naming the file, the tier, the best candidate's q and its worst px, after every coarse step was tried; nothing is
    // returned to write (the tool exits 1 on it, C7).
    const px = featheredNoise(64, 32);
    const worst = (r: Raster): string => {
      const c = clampAlpha(r);
      let [err, at] = [0, 0];
      for (let i = 0; i < r.w * r.h; i++) {
        const d = Math.abs((c.data[i * 4 + 3] ?? 0) - (r.data[i * 4 + 3] ?? 0));
        [err, at] = d > err ? [d, i] : [err, at];
      }
      return `${err}/255 off at (${at % r.w}, ${Math.floor(at / r.w)})`;
    };
    const { codec, calls } = fakeCodec(() => false, () => 100);
    const r = await encodeRaster(px, { id: 'sheet/x' as AssetId, half: 'any', q: 50, search: true }, codec);
    const steps = [50, 55, 60, 65, 70, 75, 80, 85, 90];
    expect(calls).toEqual([...steps.map((q) => `64:${q}`), ...steps.map((q) => `32:${q}`)]);
    expect(r).toEqual({
      ok: false,
      error: [
        `sheet/x: full: no AVIF q in 50..90 keeps alpha within 8/255 (R6: the best, q 50, is ${worst(px)})`,
        `sheet/x: half: no AVIF q in 50..90 keeps alpha within 8/255 (R6: the best, q 50, is ${worst(halfOf(px))})`,
      ],
    });
    // From the shot's q 44 the step skips 90, which is still the last candidate.
    const from44 = fakeCodec(() => false, () => 100);
    const r44 = await encodeRaster(px, { id: 'sheet/x' as AssetId, half: 'none', q: 44, search: true }, from44.codec);
    expect(from44.calls).toEqual([44, 49, 54, 59, 64, 69, 74, 79, 84, 89, 90].map((q) => `64:${q}`));
    expect(r44.ok ? [] : r44.error).toEqual([`sheet/x: full: no AVIF q in 44..90 keeps alpha within 8/255 (R6: the best, q 44, is ${worst(px)})`]);
    // Both tiers start at the shot's q (W3, triage r1 F1): from 44 the half tier walks 44 .. 90 as the full tier does.
    const both = fakeCodec(() => false, () => 100);
    const rBoth = await encodeRaster(px, { id: 'sheet/x' as AssetId, half: 'any', q: 44, search: true }, both.codec);
    const steps44 = [44, 49, 54, 59, 64, 69, 74, 79, 84, 89, 90];
    expect(both.calls).toEqual([...steps44.map((q) => `64:${q}`), ...steps44.map((q) => `32:${q}`)]);
    expect(rBoth.ok ? [] : rBoth.error).toEqual([
      `sheet/x: full: no AVIF q in 44..90 keeps alpha within 8/255 (R6: the best, q 44, is ${worst(px)})`,
      `sheet/x: half: no AVIF q in 44..90 keeps alpha within 8/255 (R6: the best, q 44, is ${worst(halfOf(px))})`,
    ]);
  });

  test('assets: the q search ships only a verified candidate, the fewest bytes', async () => {
    // RULINGS 267, the probe's non-monotone half tier (passes at 62, fails at 63-67, passes from 68): the coarse walk from
    // 50 stops at 70, the refine tries 66-69, and of the passing 68, 69 and 70 the fewest bytes (69) ships. The failing 66
    // and 67 are smaller still, so a candidate shipped without its check would show. The full tier passes at once.
    const px = featheredNoise(64, 32);
    const halfBytes: Readonly<Record<number, number>> = { 66: 10, 67: 10, 68: 60, 69: 40, 70: 50 };
    const { codec, calls, out } = fakeCodec(
      (w, q) => (w === 64 ? q >= 50 : q === 62 || q >= 68),
      (w, q) => (w === 64 ? 100 : (halfBytes[q] ?? 80)),
    );
    const r = await encodeRaster(px, { id: 'face/x/ally/smile' as AssetId, half: 'any', q: 50, search: true }, codec);
    expect(calls).toEqual(['64:50', '32:50', '32:55', '32:60', '32:65', '32:70', '32:66', '32:67', '32:68', '32:69']);
    expect(r.ok ? r.value.q : r.error).toEqual({ full: 50, half: 69 });
    expect(r.ok && r.value.image.avif === out.get('64:50')).toBe(true);
    expect(r.ok && r.value.image.half?.avif === out.get('32:69')).toBe(true);
  });

  test('assets: the q search is deterministic', async () => {
    // RULINGS 267: two runs on the same px choose the same q per tier and write the same bytes.
    const sheet = fileOf(await fixtureFiles(), 'sheet/cafe');
    const o = { id: 'sheet/cafe' as AssetId, half: 'any', q: 50, search: true } as const;
    const [a, b] = [await encodeRaster(sheet, o), await encodeRaster(sheet, o)];
    expect([a.ok, b.ok]).toEqual([true, true]);
    if (!a.ok || !b.ok) {
      return;
    }
    expect(b.value.q).toEqual(a.value.q);
    const files = (e: typeof a.value.image): Uint8Array[] => [e.avif, e.webp, e.half?.avif ?? new Uint8Array(0), e.half?.webp ?? new Uint8Array(0)];
    expect(files(b.value.image).map((f, i) => Buffer.compare(f, files(a.value.image)[i] ?? new Uint8Array(0)))).toEqual([0, 0, 0, 0]);
  }, 120_000);

  test("assets: a shot's q lowers its AVIF bytes", async () => {
    // §4.4 (RULINGS 267): a shot's q is its plate's AVIF quality exactly (no search), both tiers; WebP stays q80. A plate
    // is opaque (fix3 F1): an unsearched raster with any alpha below 255 is a bug, since extractShot refuses that plate.
    const feathered = featheredNoise(256, 128);
    const px: Raster = { ...feathered, data: Uint8Array.from(feathered.data, (v, i) => (i % 4 === 3 ? 255 : v)) };
    const at = async (q: number) => {
      const r = await encodeRaster(px, { id: 'bg/noise' as AssetId, half: 'any', q, search: false });
      if (!r.ok) {
        throw new Error(`invariant: a fixed q never fails: ${r.error.join('; ')}`);
      }
      return r.value;
    };
    const [lo, hi] = [await at(40), await at(50)];
    expect([lo.q, hi.q]).toEqual([
      { full: 40, half: 40 },
      { full: 50, half: 50 },
    ]);
    expect(lo.image.avif.length).toBeLessThan(hi.image.avif.length);
    expect(lo.image.half?.avif.length ?? 0).toBeLessThan(hi.image.half?.avif.length ?? 0);
    expect(Buffer.compare(lo.image.webp, hi.image.webp)).toBe(0);
    expect(Buffer.compare(lo.image.half?.webp ?? new Uint8Array(0), hi.image.half?.webp ?? new Uint8Array(1))).toBe(0);
    await expect(encodeRaster(feathered, { id: 'bg/noise' as AssetId, half: 'any', q: 50, search: false })).rejects.toThrow(/invariant: bg\/noise is opaque/);
    // The bound is 255, not 0: unlike `feathered` (alpha-0 corners), this raster holds one px at alpha 254 and none at 0.
    const nearly: Raster = { ...px, data: Uint8Array.from(px.data, (v, i) => (i === (5 * px.w + 7) * 4 + 3 ? 254 : v)) };
    await expect(encodeRaster(nearly, { id: 'bg/noise' as AssetId, half: 'any', q: 50, search: false })).rejects.toThrow(/invariant: bg\/noise is opaque/);
    // shot.json's q (cut D3): absent reads 50; 40 (the floor) is accepted; 35 and 101 are refused by name.
    const json = (q: unknown): ReturnType<typeof decodeShotSource> =>
      decodeShotSource({ crop: [0, 0, 1080, 2048], focus: [540, 600], ...(q === undefined ? {} : { q }) }, 'cafe' as BgId);
    expect(json(undefined)).toMatchObject({ ok: true, value: { q: 50 } });
    expect(json(40)).toMatchObject({ ok: true, value: { q: 40 } });
    expect(json(35)).toEqual({ ok: false, error: ['cafe/shot.json: q: 35 is not an integer in 40..100'] });
    expect(json(101)).toEqual({ ok: false, error: ['cafe/shot.json: q: 101 is not an integer in 40..100'] });
  }, 60_000);
});

// ---------------------------------------------------------------------------------------------------------------
// Synth (synth.ts): placeholder WAV, 22.05 kHz mono 16-bit PCM.

describe('synth', () => {
  test('synth: wav header bytes', () => {
    const { wav } = synthWav('sfx', { hz: 440 });
    const header = wav.subarray(0, 44);
    expect(header.length).toBe(44);
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    const ascii = (offset: number): string => String.fromCharCode(...wav.subarray(offset, offset + 4));
    const dataLen = wav.length - 44;
    expect(dataLen).toBe(26_460);
    expect(ascii(0)).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(36 + dataLen);
    expect(ascii(8)).toBe('WAVE');
    expect(ascii(12)).toBe('fmt ');
    expect(view.getUint32(16, true)).toBe(16); // PCM fmt chunk size
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(22_050); // sample rate
    expect(view.getUint32(28, true)).toBe(44_100); // byte rate = rate × block align
    expect(view.getUint16(32, true)).toBe(2); // block align
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
    expect(ascii(36)).toBe('data');
    expect(view.getUint32(40, true)).toBe(dataLen);
  });

  test('synth: placeholder sizes and durations', () => {
    const bgm = synthWav('bgm', { hz: 220 });
    expect({ bytes: bgm.wav.length, durationMs: bgm.durationMs }).toEqual({ bytes: 352_844, durationMs: 8_000 });
    expect(bgm.wav.length).toBeLessThanOrEqual(400_000); // K23: a placeholder BGM WAV fits the 400 KB rule
    const sfx = synthWav('sfx', { hz: 440 });
    expect({ bytes: sfx.wav.length, durationMs: sfx.durationMs }).toEqual({ bytes: 26_504, durationMs: 600 });
    // The tone fades in and out (no click on a loop) and stays inside 16-bit range; it is deterministic per tone.
    const view = new DataView(bgm.wav.buffer, bgm.wav.byteOffset, bgm.wav.byteLength);
    const sample = (i: number): number => view.getInt16(44 + 2 * i, true);
    const last = (bgm.wav.length - 44) / 2 - 1;
    expect([sample(0), sample(last)]).toEqual([0, 0]);
    let peak = 0;
    for (let i = 0; i <= last; i++) {
      peak = Math.max(peak, Math.abs(sample(i)));
    }
    expect(peak).toBeGreaterThan(8_000);
    expect(peak).toBeLessThan(32_767);
    // Buffer.compare: a deep toEqual over 352,844 elements takes seconds.
    expect(Buffer.compare(synthWav('bgm', { hz: 220 }).wav, bgm.wav)).toBe(0);
    expect(Buffer.compare(synthWav('bgm', { hz: 247 }).wav, bgm.wav)).not.toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Asset and cover manifests (catalog.ts): one parser for the asset tool's tests, budget and the later loaders. The
// server's committed fixtures (L6b, server/src/content.rs reads avif / webp / file URLs) are the contract.

function fixture(ch: string): unknown {
  const url = new URL(`../../../server/tests/fixtures/content/chapters/${ch}/assets.json`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8'));
}

type RawEntry = Record<string, unknown>;

function image(name: string, over: RawEntry = {}): RawEntry {
  return {
    kind: 'image',
    w: 1080,
    h: 2048,
    decodedBytes: 1080 * 2048 * 4,
    avif: { url: `/api/assets/${name}.avif`, bytes: 120_000 },
    webp: { url: `/api/assets/${name}.webp`, bytes: 200_000 },
    ...over,
  };
}

function audio(role: 'bgm' | 'sfx', name: string, over: RawEntry = {}): RawEntry {
  return { kind: 'audio', role, durationMs: 8_000, file: { url: `/api/assets/${name}.wav`, bytes: 352_844 }, codec: 'wav', ...over };
}

function manifestIssues(raw: unknown): CatalogIssue[] {
  const r = decodeAssetManifest(raw);
  return r.ok ? [] : r.error;
}

describe('catalog manifests', () => {
  test('catalog: asset manifest decodes the server fixtures', () => {
    for (const ch of ['ch2', 'ch4']) {
      const raw = fixture(ch);
      // The decoded value is the file's content: every key known, nothing dropped or renamed.
      expect(decodeAssetManifest(raw), ch).toEqual({ ok: true, value: raw });
    }
    const ch2 = decodeAssetManifest(fixture('ch2'));
    const entries = ch2.ok ? ch2.value.assets : {};
    expect(Object.entries(entries).map(([id, e]) => [id, e.kind])).toEqual([
      ['bg/archive', 'image'],
      ['sfx/door', 'audio'],
      ['bgm/hall', 'audio'],
    ]);
    const hall = entries['bgm/hall' as AssetId];
    expect(hall?.kind === 'audio' && hall.file.url).toBe('/assets/bgm-hall-0e0e0e0e.m4a'); // a public file in a paid manifest
  });

  test('catalog: malformed asset manifest is an error value', () => {
    type RawManifest = { chapterId: string; assets: Record<string, RawEntry> };
    const valid = (): RawManifest => ({
      chapterId: 'ch2',
      assets: { 'bg/archive': image('bg-archive-0a1b2c3d'), 'bgm/mystery': audio('bgm', 'bgm-mystery-1a2b3c4d') },
    });
    expect(manifestIssues(valid())).toEqual([]); // control
    const named = 'bg-archive-0a1b2c3d';
    const cases: ReadonlyArray<readonly [string, (m: RawManifest) => void, readonly string[]]> = [
      ['url outside both prefixes', (m) => (m.assets['bg/archive'] = image(named, { avif: { url: `/static/${named}.avif`, bytes: 1 } })), ['assets.bg/archive.avif.url']],
      ['dot-dot in a name', (m) => (m.assets['bg/archive'] = image(named, { avif: { url: '/api/assets/../secret.avif', bytes: 1 } })), ['assets.bg/archive.avif.url']],
      ['avif url on webp', (m) => (m.assets['bg/archive'] = image(named, { webp: { url: `/api/assets/${named}.avif`, bytes: 1 } })), ['assets.bg/archive.webp.url']],
      ['codec is not the extension', (m) => (m.assets['bgm/mystery'] = audio('bgm', 'bgm-mystery-1a2b3c4d', { codec: 'm4a' })), ['assets.bgm/mystery.file.url']],
      ['decodedBytes is not w*h*4', (m) => (m.assets['bg/archive'] = image(named, { decodedBytes: 1080 * 2048 * 3 })), ['assets.bg/archive.decodedBytes']],
      // PP:2049 erratum: the manifest carries no placeholder flag (budget reads it from the catalog).
      ['unknown key', (m) => (m.assets['bgm/mystery'] = audio('bgm', 'bgm-mystery-1a2b3c4d', { placeholder: true })), ['assets.bgm/mystery.placeholder']],
      ['prop id with an audio entry', (m) => (m.assets['prop/note'] = audio('sfx', 'prop-note-1a2b3c4d')), ['assets.prop/note.kind']],
      ['bgm id with the sfx role', (m) => (m.assets['bgm/mystery'] = audio('sfx', 'bgm-mystery-1a2b3c4d')), ['assets.bgm/mystery.role']],
      ['image entry without webp', (m) => (m.assets['bg/archive'] = image(named, { webp: undefined })), ['assets.bg/archive.webp']],
      ['zero bytes', (m) => (m.assets['bg/archive'] = image(named, { avif: { url: `/api/assets/${named}.avif`, bytes: 0 } })), ['assets.bg/archive.avif.bytes']],
      ['fractional width', (m) => (m.assets['bg/archive'] = image(named, { w: 1080.5 })), ['assets.bg/archive.w']],
      ['unknown kind', (m) => (m.assets['bg/archive'] = image(named, { kind: 'video' })), ['assets.bg/archive.kind']],
      ['not an asset id', (m) => (m.assets['bg/Archive'] = image(named)), ['assets.bg/Archive']],
      ['a cover in a chapter manifest', (m) => (m.assets['cover/manor'] = image('cover-manor-1a2b3c4d')), ['assets.cover/manor']],
      ['bad chapter id', (m) => (m.chapterId = 'chapter2'), ['chapterId']],
      ['unknown top-level key', (m) => Reflect.set(m, 'version', 1), ['version']],
    ];
    for (const [name, mutate, paths] of cases) {
      const m = valid();
      mutate(m);
      // JSON round trip: an `undefined` override drops the key, as a file would not have it.
      const found = manifestIssues(JSON.parse(JSON.stringify(m)));
      for (const path of paths) {
        expect(found, name).toContainEqual({ file: 'assets.json', path, detail: expect.any(String) as string });
      }
      expect(found.length, `${name}: ${JSON.stringify(found)}`).toBe(paths.length);
    }
    for (const raw of [null, [], 'manifest', { chapterId: 'ch2' }]) {
      expect(decodeAssetManifest(raw).ok, JSON.stringify(raw)).toBe(false);
    }
  });

  test('catalog: sheet ids are image ids', () => {
    // Shots §2.4: sheet/<s>, face/<s>/<c>/<x> and talk/<s>/<c>/<x> are image entries with a half tier, public or gated,
    // each half under its own entry's prefix (M3s).
    const half = (name: string, prefix: string): RawEntry => ({
      w: 512,
      h: 256,
      decodedBytes: 512 * 256 * 4,
      avif: { url: `${prefix}${name}-half-0a0a0a0a.avif`, bytes: 900 },
      webp: { url: `${prefix}${name}-half-0a0a0a0a.webp`, bytes: 1_200 },
    });
    const packed = (name: string, prefix: string): RawEntry =>
      image(name, {
        w: 1024,
        h: 512,
        decodedBytes: 1024 * 512 * 4,
        avif: { url: `${prefix}${name}-0b0b0b0b.avif`, bytes: 9_000 },
        webp: { url: `${prefix}${name}-0b0b0b0b.webp`, bytes: 12_000 },
        half: half(name, prefix),
      });
    const raw = {
      chapterId: 'ch2',
      assets: {
        'sheet/cafe': packed('sheet-cafe', '/assets/'),
        'face/cafe/ally/smile': packed('face-cafe-ally-smile', '/api/assets/'),
        'talk/cafe/ally/smile': packed('talk-cafe-ally-smile', '/api/assets/'),
      },
    };
    expect(decodeAssetManifest(raw)).toEqual({ ok: true, value: raw });
    // An audio entry under a shot file's id is refused, as for every image namespace.
    for (const id of Object.keys(raw.assets)) {
      expect(manifestIssues({ chapterId: 'ch2', assets: { [id]: audio('sfx', 'x-0c0c0c0c') } }), id).toContainEqual({
        file: 'assets.json',
        path: `assets.${id}.kind`,
        detail: expect.any(String) as string,
      });
    }
  });

  test('catalog: a manifest carries shots, look and loops as opaque keys', () => {
    // Shots §4.5 (the CH D26 pattern): the entry's decoder admits the three keys and hands them on as they are; only
    // story/shots.ts decodes them, so nothing here judges their content.
    const raw = {
      chapterId: 'ch1',
      assets: { 'bg/cafe': image('bg-cafe-0a1b2c3d') },
      shots: { cafe: { w: 1080, h: 2048, anything: ['opaque'] } },
      look: { images: ['bg/cafe'], windows: { 'k:start': [[0], [], 0, []] } },
      loops: { candle: { frames: [[0, 0, 2, 2]], fps: 8 } },
    };
    expect(decodeAssetManifest(raw)).toEqual({ ok: true, value: raw });
    // Each key alone, and none: a manifest without them decodes as before, with no key added.
    for (const key of ['shots', 'look', 'loops'] as const) {
      const one = { chapterId: raw.chapterId, assets: raw.assets, [key]: raw[key] };
      expect(decodeAssetManifest(one), key).toEqual({ ok: true, value: one });
    }
    const plain = decodeAssetManifest({ chapterId: 'ch1', assets: raw.assets });
    expect(plain.ok && Object.keys(plain.value)).toEqual(['chapterId', 'assets']);
    // A fourth unknown key is still refused.
    expect(manifestIssues({ ...raw, rigs: {} })).toEqual([{ file: 'assets.json', path: 'rigs', detail: expect.any(String) as string }]);
  });

  test('catalog: cover manifest decodes', () => {
    const cover = (over: RawEntry = {}): RawEntry =>
      image('x', {
        w: 360,
        h: 640,
        decodedBytes: 360 * 640 * 4,
        avif: { url: '/assets/cover-manor-1a2b3c4d.avif', bytes: 9_000 },
        webp: { url: '/assets/cover-manor-1a2b3c4d.webp', bytes: 12_000 },
        ...over,
      });
    const raw = { assets: { 'cover/manor': cover() } };
    expect(decodeCoverManifest(raw)).toEqual({ ok: true, value: raw });
    const at = (path: string): CatalogIssue => ({ file: 'story-gen/covers.json', path, detail: expect.any(String) as string });
    const refused = (value: unknown): CatalogIssue[] => {
      const r = decodeCoverManifest(value);
      return r.ok ? [] : r.error;
    };
    // Only covers, only images, only public URLs: a cover is shown before any purchase.
    expect(refused({ assets: { 'bg/cafe': cover() } })).toEqual([at('assets.bg/cafe')]);
    const gated = cover({ avif: { url: '/api/assets/cover-manor-1a2b3c4d.avif', bytes: 9_000 } });
    expect(refused({ assets: { 'cover/manor': gated } })).toEqual([at('assets.cover/manor.avif.url')]);
    expect(refused({ assets: { 'cover/manor': audio('sfx', 'cover-manor-1a2b3c4d') } })).toContainEqual(at('assets.cover/manor.kind'));
    expect(refused({ assets: {}, chapterId: 'ch1' })).toEqual([at('chapterId')]);
  });

  // MEMORY-PLAN 4.B / §5: a char or prop file holds its alpha box; `trim` places it on its canvas.
  const ALLY_TRIM = { canvasW: 768, canvasH: 1536, x: 151, y: 142 };
  const trimmedAlly = (over: RawEntry = {}, trim: unknown = ALLY_TRIM): RawEntry =>
    image('char-ally-neutral-0c0c0c0c', { w: 466, h: 1394, decodedBytes: 466 * 1394 * 4, trim, ...over });
  const oneEntry = (id: string, entry: RawEntry): CatalogIssue[] => manifestIssues({ chapterId: 'ch1', assets: { [id]: entry } });

  test('catalog: trimmed image entry decodes', () => {
    const raw = {
      chapterId: 'ch1',
      assets: {
        'char/ally/neutral': trimmedAlly(),
        'prop/note': image('prop-note-0d0d0d0d', { w: 494, h: 494, decodedBytes: 494 * 494 * 4, trim: { canvasW: 512, canvasH: 512, x: 9, y: 9 } }),
        'bg/street': image('bg-street-0a0a0a0a'),
      },
    };
    const r = decodeAssetManifest(raw);
    expect(r).toEqual({ ok: true, value: raw });
    // An untrimmed entry carries no `trim` key at all, not `trim: undefined`.
    const street = r.ok ? r.value.assets['bg/street' as AssetId] : undefined;
    expect(street).toBeDefined();
    expect(Object.hasOwn(street ?? {}, 'trim')).toBe(false);
  });

  test('catalog: a trim outside its canvas is an error value', () => {
    const ally = 'assets.char/ally/neutral';
    const at = (path: string, detail: unknown = expect.any(String), file: CatalogIssue['file'] = 'assets.json'): CatalogIssue => ({
      file,
      path,
      detail: detail as string, // a literal or an asymmetric matcher
    });
    const only = 'only char and prop entries are trimmed';
    const coverIssues = (raw: unknown): CatalogIssue[] => {
      const r = decodeCoverManifest(raw);
      return r.ok ? [] : r.error;
    };
    const cover = image('x', {
      w: 360,
      h: 640,
      decodedBytes: 360 * 640 * 4,
      avif: { url: '/assets/cover-manor-1a2b3c4d.avif', bytes: 9_000 },
      webp: { url: '/assets/cover-manor-1a2b3c4d.webp', bytes: 12_000 },
      trim: { canvasW: 400, canvasH: 700, x: 20, y: 30 },
    });
    const sprite = (trim: unknown, over: RawEntry = {}) => (): CatalogIssue[] => oneEntry('char/ally/neutral', trimmedAlly(over, trim));
    const cases: ReadonlyArray<readonly [string, () => CatalogIssue[], readonly CatalogIssue[]]> = [
      ['x + w past canvasW', sprite({ ...ALLY_TRIM, x: 303 }), [at(`${ally}.trim.x`)]],
      ['y + h past canvasH', sprite({ ...ALLY_TRIM, y: 143 }), [at(`${ally}.trim.y`)]],
      ['negative x', sprite({ ...ALLY_TRIM, x: -1 }), [at(`${ally}.trim.x`)]],
      ['zero canvasW', sprite({ ...ALLY_TRIM, canvasW: 0 }), [at(`${ally}.trim.canvasW`)]],
      ['fractional y', sprite({ ...ALLY_TRIM, y: 141.5 }), [at(`${ally}.trim.y`)]],
      [
        'a trim equal to the canvas',
        sprite({ canvasW: 768, canvasH: 1536, x: 0, y: 0 }, { w: 768, h: 1536, decodedBytes: 768 * 1536 * 4 }),
        [at(`${ally}.trim`, 'the stored size is the canvas: omit trim')],
      ],
      ['a trim on a bg', () => oneEntry('bg/street', image('bg-street-0a0a0a0a', { trim: ALLY_TRIM })), [at('assets.bg/street.trim', only)]],
      ['a trim on a cg', () => oneEntry('cg/letter', image('cg-letter-0b0b0b0b', { trim: ALLY_TRIM })), [at('assets.cg/letter.trim', only)]],
      ['a trim on a cover', () => coverIssues({ assets: { 'cover/manor': cover } }), [at('assets.cover/manor.trim', only, 'story-gen/covers.json')]],
      ['an unknown key in the trim', sprite({ ...ALLY_TRIM, z: 1 }), [at(`${ally}.trim.z`)]],
      ['a missing y', sprite({ canvasW: 768, canvasH: 1536, x: 151 }), [at(`${ally}.trim.y`, 'missing')]],
      ['a trim that is not an object', sprite(5), [at(`${ally}.trim`, 'not an object')]],
    ];
    for (const [name, issuesOf, expected] of cases) {
      const found = issuesOf();
      for (const issue of expected) {
        expect(found, name).toContainEqual(issue);
      }
      expect(found.length, `${name}: ${JSON.stringify(found)}`).toBe(expected.length);
    }
    // Control: the sprite on its canvas decodes.
    expect(oneEntry('char/ally/neutral', trimmedAlly())).toEqual([]);
  });

  test('catalog: a char entry with an odd stored side is an error value', () => {
    // Even sides make the half tier an exact halving (MEMORY-PLAN 4.B), trimmed or not.
    const at = (path: string): CatalogIssue => ({ file: 'assets.json', path, detail: expect.any(String) as string });
    const char = oneEntry('char/ally/neutral', image('char-ally-neutral-0c0c0c0c', { w: 767, h: 1536, decodedBytes: 767 * 1536 * 4 }));
    expect(char).toContainEqual(at('assets.char/ally/neutral.w'));
    expect(char).toHaveLength(1);
    expect(oneEntry('prop/note', image('prop-note-0d0d0d0d', { w: 512, h: 511, decodedBytes: 512 * 511 * 4 }))).toEqual([at('assets.prop/note.h')]);
    // Control: the rule is char and prop only; the decoder leaves a bg's size to the budget.
    expect(oneEntry('bg/street', image('bg-street-0a0a0a0a', { w: 1079, decodedBytes: 1079 * 2048 * 4 }))).toEqual([]);
  });

  // MEMORY-PLAN 4.C: `half` is the half tier's file, exactly half the stored file per side, under its entry's prefix.
  const halfFile = (name: string, w: number, h: number, prefix = '/api/assets/', over: RawEntry = {}): RawEntry => ({
    w,
    h,
    decodedBytes: w * h * 4,
    avif: { url: `${prefix}${name}-half-0f0f0f0f.avif`, bytes: 30_000 },
    webp: { url: `${prefix}${name}-half-0f0f0f0f.webp`, bytes: 50_000 },
    ...over,
  });
  /** An entry whose own files are public (image()'s are gated). */
  const publicImage = (name: string, over: RawEntry = {}): RawEntry =>
    image(name, { avif: { url: `/assets/${name}.avif`, bytes: 120_000 }, webp: { url: `/assets/${name}.webp`, bytes: 200_000 }, ...over });
  const ALLY_HALF = halfFile('char-ally-neutral', 233, 697);

  test('catalog: half tier decodes', () => {
    const raw = {
      chapterId: 'ch1',
      assets: {
        'bg/street': publicImage('bg-street-0a0a0a0a', { half: halfFile('bg-street', 540, 1024, '/assets/') }),
        'char/ally/neutral': trimmedAlly({ half: ALLY_HALF }),
        'prop/note': image('prop-note-0d0d0d0d', {
          w: 494,
          h: 494,
          decodedBytes: 494 * 494 * 4,
          trim: { canvasW: 512, canvasH: 512, x: 9, y: 9 },
          half: halfFile('prop-note', 247, 247),
        }),
        'bg/cafe': image('bg-cafe-0a0a0a0a'),
      },
    };
    const r = decodeAssetManifest(raw);
    expect(r).toEqual({ ok: true, value: raw });
    // An entry without a half carries no `half` key at all.
    const cafe = r.ok ? r.value.assets['bg/cafe' as AssetId] : undefined;
    expect(cafe).toBeDefined();
    expect(Object.hasOwn(cafe ?? {}, 'half')).toBe(false);
  });

  test('catalog: a half that is not exactly half its file is an error value', () => {
    const half = 'assets.char/ally/neutral.half';
    const cases: ReadonlyArray<readonly [string, RawEntry, string]> = [
      ['233×698 under a 466×1394 file', halfFile('char-ally-neutral', 233, 698), `${half}.h`],
      ['a width that is not half', halfFile('char-ally-neutral', 234, 697), `${half}.w`],
      ['decodedBytes is not w*h*4', halfFile('char-ally-neutral', 233, 697, '/api/assets/', { decodedBytes: 233 * 697 * 3 }), `${half}.decodedBytes`],
      ['a trim of its own', halfFile('char-ally-neutral', 233, 697, '/api/assets/', { trim: ALLY_TRIM }), `${half}.trim`],
      ['a half without webp', halfFile('char-ally-neutral', 233, 697, '/api/assets/', { webp: undefined }), `${half}.webp`],
    ];
    for (const [name, value, path] of cases) {
      // JSON round trip: an `undefined` override drops the key, as a file would not have it.
      const found = oneEntry('char/ally/neutral', JSON.parse(JSON.stringify(trimmedAlly({ half: value }))) as RawEntry);
      expect(found, `${name}: ${JSON.stringify(found)}`).toEqual([{ file: 'assets.json', path, detail: expect.any(String) as string }]);
    }
    expect(oneEntry('char/ally/neutral', trimmedAlly({ half: ALLY_HALF }))).toEqual([]); // control
  });

  test('catalog: a char half off the 1536-px canvas is an error value', () => {
    const at = (id: string): CatalogIssue => ({ file: 'assets.json', path: `assets.${id}.half`, detail: expect.any(String) as string });
    // MEMORY-PLAN 4.C, the character canvas rule: a char on a smaller canvas loads its full file on either tier.
    const small = image('char-ally-neutral-0c0c0c0c', {
      w: 400,
      h: 1100,
      decodedBytes: 400 * 1100 * 4,
      trim: { canvasW: 600, canvasH: 1200, x: 100, y: 50 },
      half: halfFile('char-ally-neutral', 200, 550),
    });
    expect(oneEntry('char/ally/neutral', small)).toEqual([at('char/ally/neutral')]);
    const untrimmed = image('char-ally-neutral-0c0c0c0c', { w: 768, h: 1024, decodedBytes: 768 * 1024 * 4, half: halfFile('char-ally-neutral', 384, 512) });
    expect(oneEntry('char/ally/neutral', untrimmed)).toEqual([at('char/ally/neutral')]);
    // Control: on the canonical canvas the half decodes.
    expect(oneEntry('char/ally/neutral', trimmedAlly({ half: ALLY_HALF }))).toEqual([]);
  });

  test('catalog: a half on a cover or under another prefix than its file is an error value', () => {
    const cover = image('x', {
      w: 360,
      h: 640,
      decodedBytes: 360 * 640 * 4,
      avif: { url: '/assets/cover-manor-1a2b3c4d.avif', bytes: 9_000 },
      webp: { url: '/assets/cover-manor-1a2b3c4d.webp', bytes: 12_000 },
      half: halfFile('cover-manor', 180, 320, '/assets/'),
    });
    const covers = decodeCoverManifest({ assets: { 'cover/manor': cover } });
    expect(covers.ok ? [] : covers.error).toEqual([{ file: 'story-gen/covers.json', path: 'assets.cover/manor.half', detail: expect.any(String) as string }]);
    // Principle 0: a public half of a gated file ships its pixels free; a gated half of a public file is a slip too.
    const at = [{ file: 'assets.json', path: 'assets.bg/street.half', detail: expect.any(String) as string }];
    expect(oneEntry('bg/street', image('bg-street-0a0a0a0a', { half: halfFile('bg-street', 540, 1024, '/assets/') }))).toEqual(at);
    expect(oneEntry('bg/street', publicImage('bg-street-0a0a0a0a', { half: halfFile('bg-street', 540, 1024, '/api/assets/') }))).toEqual(at);
    // Controls: a half under its file's own prefix decodes, gated (M3s) and public (M3c) alike.
    expect(oneEntry('bg/street', image('bg-street-0a0a0a0a', { half: halfFile('bg-street', 540, 1024, '/api/assets/') }))).toEqual([]);
    expect(oneEntry('bg/street', publicImage('bg-street-0a0a0a0a', { half: halfFile('bg-street', 540, 1024, '/assets/') }))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The asset tool (manifest.ts + assets.ts) on temporary repositories: tiering, the manifests, covers, the paid
// fingerprints, the sweep, and the CLI. In-process runs take fast stand-in encoders; one spawned run takes sharp.

const CH1 = { id: 'ch1', entry: 'ch1/main.ink', paid: false, next: 'ch2' };
const CH2 = { id: 'ch2', entry: 'ch2/main.ink', paid: true, productId: 'chapter:ch2', next: null };
const REPO_CATALOG = {
  bg: { cafe: { placeholder: { hue: 18 } }, archive: { placeholder: { hue: 45 } }, room: { placeholder: { hue: 30 } } },
  chars: { ally: { exprs: { neutral: { placeholder: { hue: 200 } } } } },
  cg: { letter: { placeholder: { hue: 40 } } },
  bgm: { calm: { placeholder: { hz: 220 } }, mystery: { placeholder: { hz: 196 } } },
  sfx: { door: { placeholder: { hz: 440 } } },
  prop: { note: { placeholder: { hue: 85 } } },
  cover: { manor: { placeholder: { hue: 35 } } },
};
/** ch1 (free) names bg/cafe; ch2 (paid) names bg/cafe too, and bg/archive and bgm/mystery only it names. */
const REPO_USAGE = {
  chapters: {
    ch1: { assets: ['bg/cafe', 'bgm/calm', 'char/ally/neutral'], knots: {} },
    ch2: { assets: ['bg/archive', 'bg/cafe', 'bgm/mystery'], knots: {} },
  },
};

/**
 * The shot pipeline's fixture (shots §2.5-2.6): `cafe` is a declared close-up of ally (rest neutral) that free ch1
 * shows with ally speaking at rest and paid ch2 with ally smiling and speaking; `archive` an implied cast-less shot of
 * ch2 alone. So `bg/cafe`, `sheet/cafe` and `talk/cafe/ally/neutral` are public, `face/cafe/ally/smile`,
 * `talk/cafe/ally/smile` and `bg/archive` paid-only.
 */
const SHOT_CATALOG = { ...REPO_CATALOG, chars: { ally: { exprs: { neutral: { placeholder: { hue: 200 } }, smile: { placeholder: { hue: 160 } } } } } };
const SHOT_LIST = { locs: [{ id: 'cafe', light: null }], shots: [{ id: 'cafe', loc: 'cafe', frame: 'close', cast: [{ char: 'ally', view: 'face', rest: 'neutral' }] }] };

/**
 * build/shots.json's need of the close-up `shot` (its loc of the same id) with ally in `faces` (`[expr, talk]`), line IDs
 * `<ch>.<shot>.a00<i>`; `cafeNeed`, of `cafe`; and of an implied cast-less shot.
 */
function shotNeedOf(shot: string, faces: ReadonlyArray<readonly [string, boolean]>, ch: string): Record<string, unknown> {
  const lines = (i: number): string[] => [`${ch}.${shot}.a00${i}`];
  return {
    cast: { ally: { view: 'face', rest: 'neutral', figure: false } },
    faces: { ally: faces.map(([expr, talk], i) => ({ expr, talk, lines: lines(i) })) },
    frame: 'close',
    loc: shot,
    camTargets: [],
    motions: [],
    room: null,
  };
}
function cafeNeed(faces: ReadonlyArray<readonly [string, boolean]>, ch: string): Record<string, unknown> {
  return shotNeedOf('cafe', faces, ch);
}
function impliedNeed(shot: string): Record<string, unknown> {
  return { cast: {}, faces: {}, frame: 'wide', loc: shot, camTargets: [], motions: [], room: null };
}

type ShotChapter = { shots: Record<string, unknown>; assets: string[]; look?: Record<string, unknown> };
const SHOT_CHAPTERS: Readonly<Record<'ch1' | 'ch2', ShotChapter>> = {
  ch1: { shots: { cafe: cafeNeed([['neutral', true]], 'ch1') }, assets: ['bg/cafe', 'sheet/cafe', 'talk/cafe/ally/neutral'] },
  ch2: {
    shots: { archive: impliedNeed('archive'), cafe: cafeNeed([['smile', true]], 'ch2') },
    assets: ['bg/archive', 'bg/cafe', 'face/cafe/ally/smile', 'sheet/cafe', 'talk/cafe/ally/smile'],
  },
};

/** A build/shots.json of these chapters (no entry alternatives, no legacy sprites). */
function shotsUsage(chapters: Readonly<Record<string, ShotChapter>>): unknown {
  return { chapters: Object.fromEntries(Object.entries(chapters).map(([id, c]) => [id, { shots: c.shots, assets: c.assets, look: c.look ?? {}, entry: {}, sprites: false }])) };
}

/** The inputs a shot repository adds: the catalog with ally's smile and the shot list; then its build/shots.json. */
const SHOT_FILES: Readonly<Record<string, unknown>> = { 'assets/catalog.json': SHOT_CATALOG, 'story/shots.json': SHOT_LIST };
const SHOT_REPO: Readonly<Record<string, unknown>> = { ...SHOT_FILES, 'server/content/build/shots.json': shotsUsage(SHOT_CHAPTERS) };

/**
 * Shots §4.1 (lane SH3c): `cafe` as a src shot (`bg.cafe = { src: 'shot/cafe' }`), ally with `surprised` too; free ch1
 * shows ally at rest and smiling, both spoken, paid ch2 ally surprised. So `bg/cafe`, `sheet/cafe`,
 * `face/cafe/ally/smile`, `talk/cafe/ally/neutral` and `talk/cafe/ally/smile` are public, `face/cafe/ally/surprised`
 * paid. The source directory comes from `shotDir` (fixtures/shot/synthetic.ts).
 */
const SRC_CATALOG = {
  ...SHOT_CATALOG,
  bg: { ...SHOT_CATALOG.bg, cafe: { src: 'shot/cafe' } },
  chars: { ally: { exprs: { ...SHOT_CATALOG.chars.ally.exprs, surprised: { placeholder: { hue: 280 } } } } },
};
const SRC_CHAPTERS: Readonly<Record<'ch1' | 'ch2', ShotChapter>> = {
  ch1: {
    shots: { cafe: cafeNeed([['neutral', true], ['smile', true]], 'ch1') },
    assets: ['bg/cafe', 'face/cafe/ally/smile', 'sheet/cafe', 'talk/cafe/ally/neutral', 'talk/cafe/ally/smile'],
  },
  ch2: { shots: { cafe: cafeNeed([['surprised', false]], 'ch2') }, assets: ['bg/cafe', 'face/cafe/ally/surprised', 'sheet/cafe'] },
};
const SRC_REPO: Readonly<Record<string, unknown>> = {
  'assets/catalog.json': SRC_CATALOG,
  'story/shots.json': SHOT_LIST,
  'server/content/build/shots.json': shotsUsage(SRC_CHAPTERS),
};
/** The src shot's six files. */
const SRC_FILES = ['bg/cafe', 'face/cafe/ally/smile', 'face/cafe/ally/surprised', 'sheet/cafe', 'talk/cafe/ally/neutral', 'talk/cafe/ally/smile'];

function writeRepo(root: string, files: Readonly<Record<string, unknown>> = {}): void {
  const all: Record<string, unknown> = {
    'story/chapters.json': [CH1, CH2],
    'assets/catalog.json': REPO_CATALOG,
    'server/content/build/usage.json': REPO_USAGE,
    ...files,
  };
  for (const [rel, value] of Object.entries(all)) {
    plant(root, rel, typeof value === 'string' ? value : JSON.stringify(value));
  }
}

function plant(root: string, rel: string, content: string | Uint8Array): void {
  const abs = join(root, ...rel.split('/'));
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

function readRel(root: string, rel: string): string {
  return readFileSync(join(root, ...rel.split('/')), 'utf8');
}

function listDir(root: string, rel: string): string[] {
  const abs = join(root, ...rel.split('/'));
  return existsSync(abs) ? readdirSync(abs).sort() : [];
}

/** Stand-ins for sharp: distinct bytes per SVG, the dimensions of its root (as sharp reports them for an SVG). */
const FAKE_ENCODERS: Encoders = {
  encodeImage: (svg) => {
    const text = new TextDecoder().decode(svg);
    const size = (attr: string): number => Number(new RegExp(String.raw`^<svg\b[^>]*\s${attr}="(\d+)"`).exec(text)?.[1]);
    const tag = sha256Hex(svg).slice(0, 16);
    return Promise.resolve({ avif: utf8.encode(`avif ${tag}`), webp: utf8.encode(`webp ${tag}`), w: size('width'), h: size('height') });
  },
  synthWav,
};

/** FAKE_ENCODERS with the stored size and trim set per asset id (read from the placeholder's label). */
function trimmingFakes(over: Readonly<Record<string, { w: number; h: number; trim?: Trim }>>): Encoders {
  return {
    ...FAKE_ENCODERS,
    encodeImage: async (svg, o) => {
      const e = await FAKE_ENCODERS.encodeImage(svg, o);
      const id = /<text\b[^>]*>([^<]+)<\/text>/.exec(new TextDecoder().decode(svg))?.[1];
      const size = id === undefined ? undefined : over[id];
      return size === undefined ? e : { ...e, ...size };
    },
  };
}

/** FAKE_ENCODERS that return a half pair for every image, whatever the ask: the planner's tier gate is what decides. */
const HALVING_FAKES: Encoders = {
  ...FAKE_ENCODERS,
  encodeImage: async (svg, o) => {
    const e = await FAKE_ENCODERS.encodeImage(svg, o);
    const tag = sha256Hex(svg).slice(0, 16);
    return { ...e, half: { avif: utf8.encode(`half avif ${tag}`), webp: utf8.encode(`half webp ${tag}`), w: e.w / 2, h: e.h / 2 } };
  },
};

/**
 * HALVING_FAKES whose bytes depend on the placeholder label's namespace alone, so every image of one namespace encodes
 * to the same four files (I-0's twin, fix3 I1): `bg/archive` and `bg/cafe` among them.
 */
const NAMESPACE_FAKES: Encoders = {
  ...HALVING_FAKES,
  encodeImage: async (svg, o) => {
    const e = await HALVING_FAKES.encodeImage(svg, o);
    const label = /<text\b[^>]*>([^<]+)<\/text>/.exec(new TextDecoder().decode(svg))?.[1] ?? '(no label)';
    const ns = label.slice(0, label.indexOf('/'));
    return {
      ...e,
      avif: utf8.encode(`avif ${ns}`),
      webp: utf8.encode(`webp ${ns}`),
      half: { avif: utf8.encode(`half avif ${ns}`), webp: utf8.encode(`half webp ${ns}`), w: e.w / 2, h: e.h / 2 },
    };
  },
};

async function runTool(root: string, encoders = FAKE_ENCODERS): Promise<{ code: number; out: string[]; err: string[] }> {
  const out: string[] = [];
  const err: string[] = [];
  const log = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => void out.push(args.map(String).join(' ')));
  const error = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => void err.push(args.map(String).join(' ')));
  try {
    return { code: await main([], root, encoders), out, err };
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
}

function decodedUsage(): AssetUsage {
  const u = decodeStoryUsage(REPO_USAGE);
  if (!u.ok) {
    throw new Error(`invariant: the fixture usage decodes: ${u.error.join('; ')}`);
  }
  return assetUsage(u.value);
}

function decodedChapters(): readonly ChapterListEntry[] {
  const c = decodeChapterList([CH1, CH2]);
  if (!c.ok) {
    throw new Error('invariant: the fixture chapter list decodes');
  }
  return c.value;
}

/**
 * Shots §4.1, a src shot's source directory as files: the synthetic shot's rasters as 8-bit RGBA PNGs, its depth map as
 * a 16-bit greyscale PNG, its shot.json; built once per knob set.
 */
const shotDirs = new Map<string, Promise<ReadonlyMap<string, Uint8Array>>>();
function shotDir(over: Partial<Knobs>): Promise<ReadonlyMap<string, Uint8Array>> {
  const key = JSON.stringify(over);
  const known = shotDirs.get(key);
  if (known !== undefined) {
    return known;
  }
  const made = (async () => {
    const fx = syntheticShot(over);
    const files = new Map<string, Uint8Array>();
    for (const [name, r] of fx.files) {
      files.set(name, await sharp(r.data, { raw: { width: r.w, height: r.h, channels: 4 } }).png().toBuffer());
    }
    const depth = sharp(fx.depth.data, { raw: { width: fx.depth.w, height: fx.depth.h, channels: 1 } });
    files.set('depth.png', await depth.toColourspace('grey16').png().toBuffer());
    files.set('shot.json', utf8.encode(JSON.stringify(fx.json)));
    return files;
  })();
  shotDirs.set(key, made);
  return made;
}

/** Plants `assets/src/shot/<shot>/`: `files`, each of `over` replacing one (or, null, leaving it out). */
function plantShot(root: string, files: ReadonlyMap<string, Uint8Array>, over: Readonly<Record<string, Uint8Array | null>> = {}, shot = 'cafe'): void {
  const all = new Map(files);
  for (const [name, bytes] of Object.entries(over)) {
    if (bytes === null) {
      all.delete(name);
    } else {
      all.set(name, bytes);
    }
  }
  for (const [name, bytes] of all) {
    plant(root, `assets/src/shot/${shot}/${name}`, bytes);
  }
}

/** A source directory's shot.json, as an object. */
function shotJson(files: ReadonlyMap<string, Uint8Array>): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(files.get('shot.json'))) as Record<string, unknown>;
}

/** The tool wrote nothing: no story-gen, both asset directories empty. */
function wroteNothing(root: string, what: string): void {
  expect(existsSync(join(root, 'client', 'src', 'story-gen')), `${what}: story-gen`).toBe(false);
  expect(listDir(root, 'client/public/assets'), `${what}: public assets`).toEqual([]);
  expect(listDir(root, 'server/content/assets'), `${what}: gated assets`).toEqual([]);
}

/** `base`, recording every encode call in `calls`: an image by its placeholder's label, a raster by its id. */
function recordingEncoders(base: Encoders, calls: string[]): Encoders {
  return {
    ...base,
    encodeImage: (svg, o) => {
      calls.push(/<text\b[^>]*>([^<]+)<\/text>/.exec(new TextDecoder().decode(svg))?.[1] ?? '(no label)');
      return base.encodeImage(svg, o);
    },
    encodeRaster: (px, o, codec) => {
      calls.push(o.id);
      return (base.encodeRaster ?? encodeRaster)(px, o, codec);
    },
  };
}

describe('assets', () => {
  let repo = '';
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'assets-'));
  });
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  test('assets: paid-only asset is never routed public', async () => {
    expect(tierOf('bg/archive' as AssetId, decodedUsage(), decodedChapters())).toBe('paid');
    expect(tierOf('bg/cafe' as AssetId, decodedUsage(), decodedChapters())).toBe('public');
    writeRepo(repo);
    const r = await runTool(repo);
    expect(r.code, r.err.join('\n')).toBe(0);
    const paid = listDir(repo, 'server/content/assets');
    expect(paid.filter((n) => /^bg-archive-[0-9a-f]{8}\.(avif|webp)$/.test(n))).toHaveLength(2);
    expect(listDir(repo, 'client/public/assets').filter((n) => n.startsWith('bg-archive-') || n.startsWith('bgm-mystery-'))).toEqual([]);
    const ch2 = JSON.parse(readRel(repo, 'server/content/chapters/ch2/assets.json')) as { assets: Record<string, RawEntry> };
    expect(ch2.assets['bg/archive']?.['avif']).toEqual({ url: expect.stringMatching(/^\/api\/assets\/bg-archive-[0-9a-f]{8}\.avif$/) as string, bytes: expect.any(Number) as number });
    // The shared asset is public in both manifests: one entry, one public file.
    const ch1 = JSON.parse(readRel(repo, 'client/src/story-gen/free/ch1.assets.json')) as { assets: Record<string, RawEntry> };
    expect(ch2.assets['bg/cafe']).toEqual(ch1.assets['bg/cafe']);
    expect(ch1.assets['bg/cafe']?.['avif']).toEqual({ url: expect.stringMatching(/^\/assets\/bg-cafe-[0-9a-f]{8}\.avif$/) as string, bytes: expect.any(Number) as number });
    expect(readRel(repo, 'client/src/story-gen/free/ch1.assets.json')).not.toContain('/api/');
  });

  test('assets: covers always public', async () => {
    expect(tierOf('cover/manor' as AssetId, decodedUsage(), decodedChapters())).toBe('public'); // no chapter names it
    writeRepo(repo);
    const r = await runTool(repo);
    expect(r.code, r.err.join('\n')).toBe(0);
    expect(r.out).not.toContain('asset unused: cover/manor');
    expect(listDir(repo, 'client/public/assets').filter((n) => n.startsWith('cover-manor-'))).toHaveLength(2);
    const covers = decodeCoverManifest(JSON.parse(readRel(repo, 'client/src/story-gen/covers.json')));
    expect(covers.ok && Object.entries(covers.value.assets).map(([id, e]) => [id, e.w, e.h])).toEqual([['cover/manor', 360, 640]]);
    // A cover belongs to no chapter manifest.
    expect(readRel(repo, 'client/src/story-gen/free/ch1.assets.json')).not.toContain('cover/');
  });

  test('assets: unused asset is skipped and reported', async () => {
    writeRepo(repo);
    const r = await runTool(repo);
    expect(r.code, r.err.join('\n')).toBe(0);
    expect(r.out.filter((l) => l.startsWith('asset unused: '))).toEqual([
      'asset unused: bg/room',
      'asset unused: cg/letter',
      'asset unused: prop/note',
      'asset unused: sfx/door',
    ]);
    expect(r.out).toContainEqual(expect.stringMatching(/^assets: 3 public, 2 paid, 4 unused, 1 covers; /));
    const everything = [...listDir(repo, 'client/public/assets'), ...listDir(repo, 'server/content/assets')];
    expect(everything.filter((n) => /^(bg-room|cg-letter|prop-note|sfx-door)-/.test(n))).toEqual([]);
  });

  test('assets: paid manifest keeps the server fixture keys', async () => {
    writeRepo(repo);
    // Every image encoded with a half: the planner keeps every scene image's half, public (bg/cafe) and gated
    // (bg/archive, served by the server since M3s).
    expect((await runTool(repo, HALVING_FAKES)).code).toBe(0);
    const planned = JSON.parse(readRel(repo, 'server/content/chapters/ch2/assets.json')) as { assets: Record<string, RawEntry> };
    expect(decodeAssetManifest(planned)).toEqual({ ok: true, value: planned });
    const committed = fixture('ch2') as { assets: Record<string, RawEntry> };
    // Per kind, the set of distinct entry shapes (the entry keys and each URL or `half` slot's keys) equals the
    // committed fixture's: what AssetProbe and HalfProbe read. Every entry counts, not the last one of its kind.
    const shape = (m: { assets: Record<string, RawEntry> }): Record<string, string[]> => {
      const out: Record<string, Set<string>> = {};
      for (const entry of Object.values(m.assets)) {
        const slots = Object.entries(entry).filter(([, v]) => typeof v === 'object' && v !== null);
        const one = JSON.stringify([Object.keys(entry).sort(), slots.map(([k, v]) => [k, Object.keys(v as object).sort()])]);
        (out[String(entry['kind'])] ??= new Set()).add(one);
      }
      return Object.fromEntries(Object.entries(out).map(([kind, set]) => [kind, [...set].sort()]));
    };
    expect(shape(planned)).toEqual(shape(committed));
    type Half = { avif: { url: string }; webp: { url: string } }; // decoded above
    // Every half sits under its own entry's prefix (F3): bg/cafe's under /assets/, bg/archive's under /api/assets/.
    const halfUrls = Object.values(planned.assets).flatMap((e) => {
      const half = e['half'] as Half | undefined;
      const own = (e['avif'] as { url: string } | undefined)?.url ?? '';
      const prefix = own.startsWith('/api/assets/') ? '/api/assets/' : '/assets/';
      return half === undefined ? [] : [half.avif.url, half.webp.url].map((url) => ({ url, prefix }));
    });
    expect(halfUrls, 'the halves in planned ch2').toHaveLength(4);
    expect(halfUrls.filter(({ url, prefix }) => !url.startsWith(prefix)), 'a half outside its entry prefix').toEqual([]);
    const gated = Object.values(planned.assets)
      .flatMap((e) => {
        const half = e['half'] as Half | undefined;
        const top = Object.values(e).flatMap((v) => (typeof v === 'object' && v !== null && 'url' in v ? [String(v.url)] : []));
        return half === undefined ? top : [...top, half.avif.url, half.webp.url];
      })
      .filter((u) => u.startsWith('/api/assets/'));
    expect(gated, 'the gated URLs: bg/archive full and half, bgm/mystery').toHaveLength(5);
    for (const url of gated) {
      const name = url.slice('/api/assets/'.length);
      expect(name).toMatch(/^[a-z0-9][a-z0-9_-]*\.(avif|webp|m4a|wav)$/); // server/src/content.rs gated_asset_type
      expect(existsSync(join(repo, 'server', 'content', 'assets', name)), name).toBe(true);
    }
  });

  test('assets: fingerprints list every paid file with its hash', async () => {
    writeRepo(repo);
    expect((await runTool(repo)).code).toBe(0);
    const fp = decodeAssetFingerprints(JSON.parse(readRel(repo, 'server/content/build/fingerprints.assets.json')));
    expect(fp.ok).toBe(true);
    const files = fp.ok ? fp.value.files : [];
    const onDisk = listDir(repo, 'server/content/assets');
    expect(files.map((f) => f.name)).toEqual(onDisk); // every paid file, sorted by name, and nothing else
    expect(files.map((f) => [f.asset, f.name.slice(f.name.lastIndexOf('.'))]).sort()).toEqual([
      ['bg/archive', '.avif'],
      ['bg/archive', '.webp'],
      ['bgm/mystery', '.wav'],
    ]);
    for (const f of files) {
      expect(f.sha256, f.name).toBe(sha256Hex(readFileSync(join(repo, 'server', 'content', 'assets', f.name))));
    }
    // The decoder refuses what is not this format (L3b's placeholder fixture held bare names).
    for (const bad of [{ files: ['bg-archive-0123abcd.avif'] }, { files: [{ asset: 'bg/archive', name: 'x.avif', sha256: 'abc' }] }, { files: [] , extra: 1 }]) {
      expect(decodeAssetFingerprints(bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  test('assets: stale outputs are swept', async () => {
    writeRepo(repo);
    // An old public copy of an asset that is paid-only now, and an old paid file no plan names.
    plant(repo, 'client/public/assets/bg-archive-deadbeef.avif', 'old public copy');
    plant(repo, 'server/content/assets/old-00000000.wav', 'old paid file');
    const r = await runTool(repo);
    expect(r.code, r.err.join('\n')).toBe(0);
    expect(existsSync(join(repo, 'client', 'public', 'assets', 'bg-archive-deadbeef.avif'))).toBe(false);
    expect(existsSync(join(repo, 'server', 'content', 'assets', 'old-00000000.wav'))).toBe(false);
    expect(listDir(repo, 'client/public/assets').filter((n) => n.startsWith('bg-cafe-'))).toHaveLength(2);
    expect(listDir(repo, 'server/content/assets')).toHaveLength(3);
    expect(r.out).toContainEqual(expect.stringMatching(/; \d+ files written, 2 stale removed$/));
  });

  test('assets: failed run writes nothing', async () => {
    const ghost = { chapters: { ...REPO_USAGE.chapters, ch1: { assets: ['bg/cafe', 'bg/ghost'], knots: {} } } };
    writeRepo(repo, { 'server/content/build/usage.json': ghost });
    plant(repo, 'client/public/assets/bg-archive-deadbeef.avif', 'old public copy');
    const r = await runTool(repo);
    expect(r.code).toBe(1);
    expect(r.err).toContain('assets: ch1 uses bg/ghost, which assets/catalog.json does not define');
    expect(listDir(repo, 'client/public/assets')).toEqual(['bg-archive-deadbeef.avif']); // nothing swept, nothing new
    expect(listDir(repo, 'server/content/assets')).toEqual([]);
    expect(existsSync(join(repo, 'client', 'src', 'story-gen'))).toBe(false);
    // An unreadable input is the same: reported, nothing written.
    rmSync(join(repo, 'assets', 'catalog.json'));
    const missing = await runTool(repo);
    expect(missing.code).toBe(1);
    expect(missing.err).toContain('assets: assets/catalog.json: missing');
    expect(listDir(repo, 'client/public/assets')).toEqual(['bg-archive-deadbeef.avif']);
  });

  test("assets: a gated file with a public file's bytes is refused before anything is written", async () => {
    // Principle 0 at the file level (fix3 I-0): no file planned under server/content/assets has the bytes of one planned
    // under client/public/assets, or scan-dist's hash arm finds the gated file shipped. The fake encodes by namespace, so
    // the gated bg/archive's four files equal the public bg/cafe's: each is one line naming its twin, and nothing is
    // swept or written.
    writeRepo(repo);
    const r = await runTool(repo, NAMESPACE_FAKES);
    const files: ReadonlyArray<readonly [string, 'avif' | 'webp', 'full' | 'half']> = [
      ['avif bg', 'avif', 'full'],
      ['webp bg', 'webp', 'full'],
      ['half avif bg', 'avif', 'half'],
      ['half webp bg', 'webp', 'half'],
    ];
    const twins = files.map(([text, ext, size]) => {
      const bytes = utf8.encode(text);
      const [paid, pub] = [assetFileName('bg/archive' as AssetId, bytes, ext, size), assetFileName('bg/cafe' as AssetId, bytes, ext, size)];
      return `assets: server/content/assets/${paid} has the bytes of client/public/assets/${pub} (principle 0: a gated file is never a public file's copy)`;
    });
    expect(r.code, r.err.join('\n')).toBe(1);
    expect(r.err).toEqual([...twins].sort());
    wroteNothing(repo, 'a gated copy');
    // With two public twins the line names the first by path; the later one is planned first, so the sort counts too.
    const same = new Uint8Array([1, 2, 3, 4]);
    const plan = new Map<string, Uint8Array>([
      [`${ASSET_OUT.public}/b-twin.avif`, same],
      [`${ASSET_OUT.public}/a-twin.avif`, same],
      [`${ASSET_OUT.paid}/gated.avif`, same],
    ]);
    expect(gatedCopies(plan)).toEqual([
      `${ASSET_OUT.paid}/gated.avif has the bytes of ${ASSET_OUT.public}/a-twin.avif (principle 0: a gated file is never a public file's copy)`,
    ]);
  });

  test('assets: expressions of one character share a canvas', async () => {
    // MEMORY-PLAN 4.B: every expression of a character keeps one transform on its canvas, so a swap stays aligned.
    const catalog = { ...REPO_CATALOG, chars: { ally: { exprs: { neutral: { placeholder: { hue: 200 } }, smile: { placeholder: { hue: 160 } } } } } };
    const usage = { chapters: { ...REPO_USAGE.chapters, ch1: { assets: [...REPO_USAGE.chapters.ch1.assets, 'char/ally/smile'], knots: {} } } };
    const stored = { w: 466, h: 1394 };
    const neutral = { ...stored, trim: { canvasW: 768, canvasH: 1536, x: 151, y: 142 } };
    writeRepo(repo, { 'assets/catalog.json': catalog, 'server/content/build/usage.json': usage });
    const mismatched = await runTool(repo, trimmingFakes({ 'char/ally/neutral': neutral, 'char/ally/smile': { ...stored, trim: { canvasW: 768, canvasH: 1534, x: 151, y: 140 } } }));
    expect(mismatched.code).toBe(1);
    expect(mismatched.err).toEqual(['assets: char/ally: expressions on different canvases (char/ally/neutral 768×1536, char/ally/smile 768×1534)']);
    expect(listDir(repo, 'client/public/assets')).toEqual([]);
    expect(existsSync(join(repo, 'client', 'src', 'story-gen'))).toBe(false);
    // Control: one canvas for both; the planner writes each file's trim into its manifest entry.
    const matched = await runTool(repo, trimmingFakes({ 'char/ally/neutral': neutral, 'char/ally/smile': { ...stored, trim: { canvasW: 768, canvasH: 1536, x: 151, y: 140 } } }));
    expect(matched.code, matched.err.join('\n')).toBe(0);
    const ch1 = JSON.parse(readRel(repo, 'client/src/story-gen/free/ch1.assets.json')) as { assets: Record<string, RawEntry> };
    expect(ch1.assets['char/ally/neutral']).toMatchObject({ w: 466, h: 1394, decodedBytes: 466 * 1394 * 4, trim: neutral.trim });
    expect(Object.keys(ch1.assets['char/ally/neutral'] ?? {})).toEqual(['kind', 'w', 'h', 'decodedBytes', 'avif', 'webp', 'trim']);
    expect(Object.hasOwn(ch1.assets['bg/cafe'] ?? {}, 'trim')).toBe(false);
  });

  test('assets: a char canvas with an odd side is refused', async () => {
    // Even canvases keep an even trimmed box inside them (MEMORY-PLAN 4.B). A trimmed file first: its stored sides are
    // even, so only the canvas is at fault.
    writeRepo(repo);
    const odd = await runTool(repo, trimmingFakes({ 'char/ally/neutral': { w: 466, h: 1394, trim: { canvasW: 767, canvasH: 1536, x: 151, y: 142 } } }));
    expect(odd.code).toBe(1);
    expect(odd.err).toEqual(['assets: char/ally/neutral: canvas 767×1536 has an odd side (char and prop canvases are even)']);
    expect(existsSync(join(repo, 'client', 'src', 'story-gen'))).toBe(false);
    // An untrimmed file is its own canvas: a used prop at 512×511.
    const usage = { chapters: { ...REPO_USAGE.chapters, ch1: { assets: [...REPO_USAGE.chapters.ch1.assets, 'prop/note'], knots: {} } } };
    writeRepo(repo, { 'server/content/build/usage.json': usage });
    const prop = await runTool(repo, trimmingFakes({ 'prop/note': { w: 512, h: 511 } }));
    expect(prop.code).toBe(1);
    expect(prop.err).toEqual(['assets: prop/note: canvas 512×511 has an odd side (char and prop canvases are even)']);
    expect(listDir(repo, 'client/public/assets')).toEqual([]);
  });

  test('assets: the tool asks the encoder to trim char and prop only', async () => {
    // MEMORY-PLAN 4.B: only the transparent kinds are cut to their alpha box. ch1 also names a cg and a prop here, so
    // every image namespace is encoded; the ask is recorded per id (the placeholder's label), for every encoded image.
    const usage = { chapters: { ...REPO_USAGE.chapters, ch1: { assets: [...REPO_USAGE.chapters.ch1.assets, 'cg/letter', 'prop/note'], knots: {} } } };
    writeRepo(repo, { 'server/content/build/usage.json': usage });
    const asked: Record<string, boolean> = {};
    const recording: Encoders = {
      ...FAKE_ENCODERS,
      encodeImage: (svg, o) => {
        const id = /<text\b[^>]*>([^<]+)<\/text>/.exec(new TextDecoder().decode(svg))?.[1] ?? '(no label)';
        asked[id] = o.trim;
        return FAKE_ENCODERS.encodeImage(svg, o);
      },
    };
    const r = await runTool(repo, recording);
    expect(r.code, r.err.join('\n')).toBe(0);
    expect(asked).toEqual({
      'bg/archive': false,
      'bg/cafe': false,
      'cg/letter': false,
      'char/ally/neutral': true,
      'cover/manor': false,
      'prop/note': true,
    });
  });

  test('assets: a char on a canvas shorter than 1536 px gets no half', async () => {
    // MEMORY-PLAN 4.C, the character canvas rule, through the tool's ask and the real encoder. The asset CLI admits
    // placeholders only, so the off-canonical source is a PNG built here: an opaque rect on transparency.
    const ask = halfAsk('char/ally/neutral' as AssetId, 'public');
    expect(ask).toEqual({ canvasH: 1536 });
    const sprite = (w: number, h: number): Promise<Buffer> =>
      sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite([{ input: { create: { width: w / 2, height: h / 2, channels: 4, background: { r: 200, g: 90, b: 60, alpha: 1 } } }, left: w / 4, top: h / 4 }])
        .png()
        .toBuffer();
    const small = await encodeImage(await sprite(600, 1200), { trim: true, half: ask });
    expect(small.trim, 'the small sprite is trimmed').toMatchObject({ canvasW: 600, canvasH: 1200 });
    expect(Object.hasOwn(small, 'half'), 'no half off the 1536-px canvas').toBe(false);
    // Control: the canonical canvas gets a half of exactly half its stored size.
    const canonical = await encodeImage(await sprite(768, 1536), { trim: true, half: ask });
    expect(canonical.half && { w: canonical.half.w * 2, h: canonical.half.h * 2 }).toEqual({ w: canonical.w, h: canonical.h });
  }, 30_000);

  test("assets: a gated image's half is gated beside it", async () => {
    // The halving fake returns a half for every image whatever the ask, so this pins the planner's half gate alone: a
    // gated image's half takes its file's directory, URL prefix and fingerprints (principle 0, M3s); a cover has none.
    writeRepo(repo);
    const r = await runTool(repo, HALVING_FAKES);
    expect(r.code, r.err.join('\n')).toBe(0);
    type Planned = { assets: Record<string, RawEntry> };
    type Half = { avif: { url: string }; webp: { url: string } }; // decoded by the planner
    const ch1 = JSON.parse(readRel(repo, 'client/src/story-gen/free/ch1.assets.json')) as Planned;
    const ch2 = JSON.parse(readRel(repo, 'server/content/chapters/ch2/assets.json')) as Planned;
    expect(Object.hasOwn(ch2.assets['bg/archive'] ?? {}, 'half'), 'the gated bg/archive has a half').toBe(true);
    const archiveHalf = ch2.assets['bg/archive']?.['half'] as Half | undefined;
    expect([archiveHalf?.avif.url, archiveHalf?.webp.url]).toEqual([
      expect.stringMatching(/^\/api\/assets\/bg-archive-half-[0-9a-f]{8}\.avif$/) as string,
      expect.stringMatching(/^\/api\/assets\/bg-archive-half-[0-9a-f]{8}\.webp$/) as string,
    ]);
    const cafeHalf = ch2.assets['bg/cafe']?.['half'] as Half | undefined;
    expect(cafeHalf, 'the public bg/cafe has a half').toBeDefined();
    expect([cafeHalf?.avif.url, cafeHalf?.webp.url]).toEqual([
      expect.stringMatching(/^\/assets\/bg-cafe-half-[0-9a-f]{8}\.avif$/) as string,
      expect.stringMatching(/^\/assets\/bg-cafe-half-[0-9a-f]{8}\.webp$/) as string,
    ]);
    expect(ch2.assets['bg/cafe'], 'one entry per id in every manifest').toEqual(ch1.assets['bg/cafe']);
    const halves = (rel: string): string[] => listDir(repo, rel).filter((n) => n.includes('-half-'));
    expect(halves('client/public/assets').length, 'the public halves').toBeGreaterThan(0);
    const shapes = (names: readonly string[]): string[] => names.map((n) => n.replace(/-[0-9a-f]{8}\./, '-<hash8>.')).sort();
    expect(shapes(halves('server/content/assets')), 'the gated halves').toEqual(['bg-archive-half-<hash8>.avif', 'bg-archive-half-<hash8>.webp']);
    expect(listDir(repo, 'client/public/assets').filter((n) => n.startsWith('bg-archive-')), 'no bg/archive file is public').toEqual([]);
    const fp = decodeAssetFingerprints(JSON.parse(readRel(repo, 'server/content/build/fingerprints.assets.json')));
    const archive = fp.ok ? fp.value.files.filter((f) => f.asset === 'bg/archive') : [];
    expect(archive.map((f) => f.name).sort(), "bg/archive's four files are fingerprinted").toEqual(
      listDir(repo, 'server/content/assets').filter((n) => n.startsWith('bg-archive-')),
    );
    expect(archive).toHaveLength(4);
    for (const f of archive) {
      expect(f.sha256, f.name).toBe(sha256Hex(readFileSync(join(repo, 'server', 'content', 'assets', f.name))));
    }
    const covers = JSON.parse(readRel(repo, 'client/src/story-gen/covers.json')) as Planned;
    expect(Object.hasOwn(covers.assets['cover/manor'] ?? {}, 'half'), 'a cover has no half').toBe(false);
  });

  test('assets: the tool asks a half for public images and never for a cover', async () => {
    writeRepo(repo);
    const asked: Record<string, unknown> = {};
    const recording: Encoders = {
      ...FAKE_ENCODERS,
      encodeImage: (svg, o) => {
        const id = /<text\b[^>]*>([^<]+)<\/text>/.exec(new TextDecoder().decode(svg))?.[1] ?? '(no label)';
        asked[id] = o.half;
        return FAKE_ENCODERS.encodeImage(svg, o);
      },
    };
    const r = await runTool(repo, recording);
    expect(r.code, r.err.join('\n')).toBe(0);
    expect(asked).toEqual({ 'bg/archive': 'any', 'bg/cafe': 'any', 'char/ally/neutral': { canvasH: 1536 }, 'cover/manor': 'none' });
  });

  test('assets: sheets, face and talk files get half files', () => {
    // Shots §4.2 step 7 (rev. 3, C1): every shot file gets a half like every bg, public or gated (M3s); the packer keeps
    // every side even, so the ask is 'any'. A file no chapter uses gets none.
    for (const id of ['sheet/cafe', 'face/cafe/ally/smile', 'talk/cafe/ally/neutral']) {
      expect([halfAsk(id as AssetId, 'public'), halfAsk(id as AssetId, 'paid'), halfAsk(id as AssetId, 'unused')], id).toEqual(['any', 'any', 'none']);
    }
    // Controls: the existing kinds keep their asks.
    expect(halfAsk('bg/cafe' as AssetId, 'paid')).toBe('any');
    expect(halfAsk('cover/manor' as AssetId, 'public')).toBe('none');
  });

  test("assets: a half file's name is distinct from every full file name", () => {
    // MEMORY-PLAN §5: every id of every namespace, the edge ids whose parts read "half" among them, for the same bytes.
    const ids = ['bg/cafe', 'bg/half', 'cg/letter', 'char/ally/neutral', 'char/half/half', 'char/ally/half', 'prop/half', 'cover/manor', 'bgm/half', 'sfx/door'];
    const bytes = utf8.encode('the same bytes');
    const names = new Map<string, string>();
    for (const id of ids) {
      for (const size of ['full', 'half'] as const) {
        const ext = id.startsWith('bgm/') || id.startsWith('sfx/') ? 'wav' : 'avif';
        const name = assetFileName(id as AssetId, bytes, ext, size);
        expect(name, `${id} ${size}`).toMatch(ASSET_FILE_RE);
        expect(names.has(name), `${name} is made once`).toBe(false);
        names.set(name, `${id} ${size}`);
      }
    }
    expect(names.size).toBe(ids.length * 2);
    // Parsing a name by its namespace's part count recovers its id and size: the names are injective.
    for (const [name, made] of names) {
      const segments = name.slice(0, name.lastIndexOf('-')).split('-');
      const parts = segments[0] === 'char' ? 3 : 2;
      const rest = segments.slice(parts);
      const size = rest.length === 0 ? 'full' : rest.join('-') === 'half' ? 'half' : `unparsed ${rest.join('-')}`;
      expect(`${segments.slice(0, parts).join('/')} ${size}`, name).toBe(made);
    }
  });

  test('assets: a face file only a paid chapter needs is gated', async () => {
    // Shots §2.5 (rev. 4, W3): every shot file is one asset tiered by `tierOf` over build/shots.json's per-chapter
    // `assets`: ally's smile in `cafe` is needed by paid ch2 only, so its face file is gated, full and half.
    writeRepo(repo, SHOT_REPO);
    const r = await runTool(repo, HALVING_FAKES);
    expect(r.code, r.err.join('\n')).toBe(0);
    const face = (dir: string): string[] => listDir(repo, dir).filter((n) => n.startsWith('face-cafe-ally-smile-'));
    expect(face('server/content/assets').filter((n) => !n.includes('-half-'))).toHaveLength(2);
    expect(face('server/content/assets').map((n) => n.replace(/-[0-9a-f]{8}\./, '-<hash8>.')).sort()).toEqual([
      'face-cafe-ally-smile-<hash8>.avif',
      'face-cafe-ally-smile-<hash8>.webp',
      'face-cafe-ally-smile-half-<hash8>.avif',
      'face-cafe-ally-smile-half-<hash8>.webp',
    ]);
    expect(face('client/public/assets'), 'no face/cafe/ally/smile file is public').toEqual([]);
    const fp = decodeAssetFingerprints(JSON.parse(readRel(repo, 'server/content/build/fingerprints.assets.json')));
    expect((fp.ok ? fp.value.files : []).filter((f) => f.asset === 'face/cafe/ally/smile').map((f) => f.name).sort()).toEqual(face('server/content/assets'));
    const ch2 = JSON.parse(readRel(repo, 'server/content/chapters/ch2/assets.json')) as { assets: Record<string, RawEntry> };
    expect(ch2.assets['face/cafe/ally/smile']?.['avif']).toEqual({ url: expect.stringMatching(/^\/api\/assets\/face-cafe-ally-smile-[0-9a-f]{8}\.avif$/) as string, bytes: expect.any(Number) as number });
    // The free chapter's manifest names no file of it.
    expect(readRel(repo, 'client/src/story-gen/free/ch1.assets.json')).not.toContain('face/cafe/ally/smile');
  });

  test('assets: a shot shown by a free chapter has a public plate and sheet', async () => {
    writeRepo(repo, SHOT_REPO);
    const r = await runTool(repo, HALVING_FAKES);
    expect(r.code, r.err.join('\n')).toBe(0);
    const pub = (prefix: string): string[] => listDir(repo, 'client/public/assets').filter((n) => n.startsWith(prefix));
    expect(pub('sheet-cafe-').filter((n) => !n.includes('-half-'))).toHaveLength(2);
    expect(pub('sheet-cafe-half-')).toHaveLength(2);
    expect(pub('bg-cafe-')).toHaveLength(4);
    expect(pub('talk-cafe-ally-neutral-')).toHaveLength(4); // ch1 speaks at rest
    // One public entry, the same in the free and the paid manifest.
    const ch1 = JSON.parse(readRel(repo, 'client/src/story-gen/free/ch1.assets.json')) as { assets: Record<string, RawEntry> };
    const ch2 = JSON.parse(readRel(repo, 'server/content/chapters/ch2/assets.json')) as { assets: Record<string, RawEntry> };
    expect(ch1.assets['sheet/cafe']?.['avif']).toEqual({ url: expect.stringMatching(/^\/assets\/sheet-cafe-[0-9a-f]{8}\.avif$/) as string, bytes: expect.any(Number) as number });
    expect(ch2.assets['sheet/cafe']).toEqual(ch1.assets['sheet/cafe']);
    expect(listDir(repo, 'server/content/assets').filter((n) => n.startsWith('sheet-'))).toEqual([]);
    // The tool's shot files go to the encoder untrimmed with a half asked for, public or gated.
    const asked: Record<string, unknown> = {};
    const recording: Encoders = {
      ...HALVING_FAKES,
      encodeImage: (svg, o) => {
        const id = /<text\b[^>]*>([^<]+)<\/text>/.exec(new TextDecoder().decode(svg))?.[1] ?? '(no label)';
        asked[id] = o;
        return HALVING_FAKES.encodeImage(svg, o);
      },
    };
    expect((await runTool(repo, recording)).code).toBe(0);
    for (const id of ['sheet/cafe', 'face/cafe/ally/smile', 'talk/cafe/ally/neutral', 'talk/cafe/ally/smile']) {
      expect(asked[id], id).toEqual({ trim: false, half: 'any' });
    }
  });

  test('assets: a declared shot without a catalog bg is encoded as its implied placeholder', async () => {
    // SH2's cut Q7: `story` admits a declared shot the catalog lacks (an implied placeholder, hue = FNV-1a of its id mod
    // 360, list.ts `effectiveCatalog`); the asset tool now encodes it the same way instead of refusing it.
    const list = { locs: [{ id: 'attic', light: null }], shots: [{ id: 'attic', loc: 'attic', frame: 'wide', cast: [] }] };
    const attic = { cast: {}, faces: {}, frame: 'wide', loc: 'attic', camTargets: [], motions: [], room: null };
    const usage = { chapters: { ...REPO_USAGE.chapters, ch1: { assets: [...REPO_USAGE.chapters.ch1.assets, 'bg/attic'], knots: {} } } };
    writeRepo(repo, {
      'story/shots.json': list,
      'server/content/build/usage.json': usage,
      'server/content/build/shots.json': shotsUsage({ ch1: { shots: { attic }, assets: ['bg/attic'] }, ch2: { shots: {}, assets: [] } }),
    });
    const svgs: Record<string, string> = {};
    const recording: Encoders = {
      ...FAKE_ENCODERS,
      encodeImage: (svg, o) => {
        const text = new TextDecoder().decode(svg);
        svgs[/<text\b[^>]*>([^<]+)<\/text>/.exec(text)?.[1] ?? '(no label)'] = text;
        return FAKE_ENCODERS.encodeImage(svg, o);
      },
    };
    const r = await runTool(repo, recording);
    expect(r.code, r.err.join('\n')).toBe(0);
    expect(svgs['bg/attic']).toContain(`hsl(${placeholderHue('attic')} `);
    expect(listDir(repo, 'client/public/assets').filter((n) => n.startsWith('bg-attic-'))).toHaveLength(2);
  });

  test('assets: a shot list without its build/shots.json is refused', async () => {
    // story/shots.json switches the tool to the shot pipeline; its build/shots.json is then required and must hold
    // exactly the listed chapters. Every problem is reported; nothing is written.
    writeRepo(repo, SHOT_FILES);
    const missing = await runTool(repo);
    expect(missing.code).toBe(1);
    expect(missing.err).toEqual(['assets: server/content/build/shots.json: missing (story/shots.json exists: run the story tool)']);
    expect(existsSync(join(repo, 'client', 'src', 'story-gen'))).toBe(false);
    const stale = shotsUsage({ ch1: SHOT_CHAPTERS.ch1, ch3: SHOT_CHAPTERS.ch2 });
    writeRepo(repo, { ...SHOT_REPO, 'server/content/build/shots.json': stale });
    const wrong = await runTool(repo);
    expect(wrong.code).toBe(1);
    expect(wrong.err).toEqual([
      'assets: server/content/build/shots.json has no chapter ch2 (run the story tool)',
      'assets: server/content/build/shots.json names ch3, which story/chapters.json does not list (run the story tool)',
    ]);
    expect(listDir(repo, 'client/public/assets')).toEqual([]);
    expect(existsSync(join(repo, 'client', 'src', 'story-gen'))).toBe(false);
  });

  test('assets: an expression the catalog dropped is reported, not thrown', async () => {
    // SH3a review M1: a stale build/shots.json (free ch1 shows ally in frown, which the catalog no longer defines) is an
    // input problem by name, reported before any layer is built. The shot is not packed, and no "(run the story tool)"
    // line follows for the files its chapters list: one cause, one message (critique O2).
    const frowning = { shots: { cafe: cafeNeed([['frown', false]], 'ch1') }, assets: ['bg/cafe', 'face/cafe/ally/frown', 'sheet/cafe'] };
    writeRepo(repo, { ...SHOT_FILES, 'server/content/build/shots.json': shotsUsage({ ...SHOT_CHAPTERS, ch1: frowning }) });
    const r = await runTool(repo, HALVING_FAKES);
    expect(r.code).toBe(1);
    expect(r.err).toEqual([
      'assets: server/content/build/shots.json: ch1 shows ally in frown in cafe, which assets/catalog.json does not define (run the story tool)',
    ]);
    expect(r.err.filter((l) => l.includes('invariant'))).toEqual([]);
    expect(existsSync(join(repo, 'client', 'src', 'story-gen'))).toBe(false);
    expect(listDir(repo, 'client/public/assets')).toEqual([]);
    expect(listDir(repo, 'server/content/assets')).toEqual([]);
  });

  test('assets: a src shot without a shot list is refused by name', async () => {
    // Shots §4.1 (cut D14): a src shot's cast and needs come from story/shots.json and build/shots.json, so a src bg
    // without a shot list is named and nothing is encoded or written.
    writeRepo(repo, { 'assets/catalog.json': { ...REPO_CATALOG, bg: { ...REPO_CATALOG.bg, cafe: { src: 'shot/cafe' } } } });
    const calls: string[] = [];
    const r = await runTool(repo, recordingEncoders(FAKE_ENCODERS, calls));
    expect(r.code).toBe(1);
    expect(r.err).toEqual(["assets: bg/cafe: src shot/cafe needs story/shots.json (a src shot's cast and needs come from the shot list)"]);
    expect(calls).toEqual([]);
    wroteNothing(repo, 'no shot list');
  });

  test('assets: a shot source directory builds its plate, sheet, face and talk files', async () => {
    // Shots §4.1-4.5 end to end (lane SH3c): the synthetic shot's directory (an 1100 × 2048 original cropped to its
    // 1080 × 2048 plate at x 10, q 44) is extracted and packed through SH3a's packer, its plate encoded at q 44 and its
    // alpha files searched from 44 (RULINGS 267), each tiered per file by `tierOf`.
    const files = await shotDir({ w: 1100, h: 2048, u: 4, crop: [10, 0, 1080, 2048], q: 44 });
    const json = shotJson(files);
    writeRepo(repo, SRC_REPO);
    plantShot(repo, files);
    const seen = new Map<string, { q: number; search: boolean }>();
    const chosen = new Map<string, EncodedRaster['q']>();
    const recording: Encoders = {
      encodeImage,
      synthWav,
      encodeRaster: async (px, o, codec) => {
        seen.set(o.id, { q: o.q, search: o.search });
        const e = await encodeRaster(px, o, codec);
        if (e.ok) {
          chosen.set(o.id, e.value.q);
        }
        return e;
      },
    };
    const r = await runTool(repo, recording);
    expect(r.code, r.err.join('\n')).toBe(0);
    // W3: the shot's q reaches every file: the plate's quality, every alpha file's start.
    expect([...seen.keys()].sort()).toEqual(SRC_FILES);
    for (const id of SRC_FILES) {
      expect(seen.get(id), id).toEqual({ q: 44, search: id !== 'bg/cafe' });
    }
    // The log names each alpha file whose chosen q differs from the start, per tier.
    const logged = SRC_FILES.filter((id) => id !== 'bg/cafe').flatMap((id) => {
      const q = chosen.get(id);
      const tiers = [q?.full === 44 ? '' : `${q?.full} full`, q?.half === 44 ? '' : `${q?.half} half`].filter((t) => t !== '');
      return tiers.length === 0 ? [] : [`assets: ${id}: AVIF q ${tiers.join(', ')} (R6 search from q 44)`];
    });
    expect(r.out.filter((l) => l.includes(': AVIF q '))).toEqual(logged);
    // The other five are public; the paid chapter's face file is gated, full and half.
    const pub = listDir(repo, 'client/public/assets');
    const paid = listDir(repo, 'server/content/assets');
    for (const id of SRC_FILES) {
      const named = (dir: string[]): number => dir.filter((n) => n.startsWith(`${id.replaceAll('/', '-')}-`)).length;
      expect([named(pub), named(paid)], id).toEqual(id === 'face/cafe/ally/surprised' ? [0, 4] : [4, 0]);
    }
    const ch1 = JSON.parse(readRel(repo, 'client/src/story-gen/free/ch1.assets.json')) as { assets: Record<string, RawEntry>; shots: unknown };
    const ch2 = JSON.parse(readRel(repo, 'server/content/chapters/ch2/assets.json')) as { assets: Record<string, RawEntry>; shots: unknown };
    expect([ch1.assets['bg/cafe']?.['w'], ch1.assets['bg/cafe']?.['h']]).toEqual([1080, 2048]);
    // Each file's bytes per tier within SH3b's limits (budget.ts LIMITS; a plate's scaled with its width, `plateLimit`).
    for (const id of SRC_FILES) {
      const entry = ch1.assets[id] ?? ch2.assets[id];
      const kind = id.slice(0, id.indexOf('/')) as 'bg' | 'sheet' | 'face' | 'talk';
      const w = Number(entry?.['w']);
      const limit = kind === 'bg' ? { avif: Math.floor((LIMITS.image.bg.avif * w) / 1080), webp: Math.floor((LIMITS.image.bg.webp * w) / 1080) } : LIMITS.image[kind];
      const bytes = (e: RawEntry | undefined, f: 'avif' | 'webp'): number => Number((e?.[f] as { bytes?: unknown } | undefined)?.bytes);
      const half = entry?.['half'] as RawEntry | undefined;
      for (const [tier, e] of [['full', entry], ['half', half]] as const) {
        expect(bytes(e, 'avif'), `${id} ${tier} AVIF`).toBeLessThanOrEqual(limit.avif);
        expect(bytes(e, 'webp'), `${id} ${tier} WebP`).toBeLessThanOrEqual(limit.webp);
      }
    }
    // F1 (fix3): the plate, opaque by check, ships no alpha band in any file; every alpha file's AVIF keeps its band.
    const alphaBand = async (e: RawEntry | undefined, f: 'avif' | 'webp'): Promise<boolean> => {
      const url = String((e?.[f] as { url?: unknown } | undefined)?.url);
      return (await sharp(readFileSync(join(repo, ...(urlPath(url) ?? url).split('/')))).metadata()).hasAlpha;
    };
    const plate = ch1.assets['bg/cafe'];
    const plateHalf = plate?.['half'] as RawEntry | undefined;
    const plateBands = [await alphaBand(plate, 'avif'), await alphaBand(plate, 'webp'), await alphaBand(plateHalf, 'avif'), await alphaBand(plateHalf, 'webp')];
    expect(plateBands, 'bg/cafe AVIF, WebP, half AVIF, half WebP').toEqual([false, false, false, false]);
    for (const id of SRC_FILES.filter((x) => x !== 'bg/cafe')) {
      expect(await alphaBand(ch1.assets[id] ?? ch2.assets[id], 'avif'), `${id}: its AVIF keeps its alpha band`).toBe(true);
    }
    // The rigs: the crop-translated focus, the hair from the sheet, the rest blink copied into smile's face file,
    // surprised's own blink, and every member in one of its chapter's own entries.
    const rigs = (m: { shots: unknown }): ReadonlyMap<BgId, ShotRig> => {
      const d = decodeShotRigs(m.shots);
      expect(d.ok ? [] : d.error).toEqual([]);
      return d.ok ? d.value : new Map();
    };
    const [rig1, rig2] = [rigs(ch1).get('cafe' as BgId), rigs(ch2).get('cafe' as BgId)];
    const [focus, crop] = [json['focus'] as number[], json['crop'] as number[]];
    expect(rig1?.focus).toEqual([(focus[0] ?? 0) - (crop[0] ?? 0), (focus[1] ?? 0) - (crop[1] ?? 0)]);
    expect([rig1?.w, rig1?.h]).toEqual([1080, 2048]);
    expect(rig1?.cast[0]?.hair.map((h) => h.member.file)).toEqual(['sheet/cafe']);
    const face = (rig: ShotRig | undefined, x: string): FaceRig['exprs'][ExprId] | undefined => rig?.cast[0]?.face?.exprs[x as ExprId];
    expect(face(rig1, 'neutral')?.motion.blink.half.file).toBe('sheet/cafe');
    expect(face(rig1, 'smile')?.motion.blink.half).toMatchObject({ file: 'face/cafe/ally/smile', at: face(rig1, 'neutral')?.motion.blink.half.at });
    expect(face(rig2, 'surprised')?.motion.blink.half.file).toBe('face/cafe/ally/surprised');
    expect(face(rig2, 'surprised')?.motion.blink.half.at).not.toEqual(face(rig2, 'neutral')?.motion.blink.half.at);
    const named = (v: unknown): string[] =>
      Array.isArray(v)
        ? v.flatMap(named)
        : typeof v === 'object' && v !== null
          ? Object.entries(v).flatMap(([k, x]) => (k === 'file' && typeof x === 'string' ? [x] : named(x)))
          : [];
    for (const m of [ch1, ch2]) {
      expect(named(m.shots).filter((f) => !Object.hasOwn(m.assets, f))).toEqual([]);
    }

    // R6 is on the tool's path: an encodeRaster that clamps alpha before the real one ships nothing (the tool's own
    // check against its source px), and a codec whose AVIF loses the feather reaches the search's ceiling. Each run
    // exits 1 and writes nothing.
    const again = mkdtempSync(join(tmpdir(), 'assets-'));
    try {
      writeRepo(again, SRC_REPO);
      plantShot(again, files);
      const clamping = await runTool(again, { encodeImage, synthWav, encodeRaster: (px, o, codec) => encodeRaster(clampAlpha(px), o, codec) });
      expect(clamping.code).toBe(1);
      expect(clamping.err.length).toBeGreaterThan(0);
      expect(clamping.err.filter((l) => !/^assets: sheet\/cafe\b.*\(R6: /.test(l))).toEqual([]);
      wroteNothing(again, 'clamped before the encoder');
      const lossy: Codec = { ...SHARP_CODEC, avif: (px, q) => encodeAvif(clampAlpha(px), q) };
      const ceiling = await runTool(again, { encodeImage, synthWav, encodeRaster: (px, o) => encodeRaster(px, o, lossy) });
      expect(ceiling.code).toBe(1);
      const line = /^assets: sheet\/cafe: (full|half): no AVIF q in 44\.\.90 keeps alpha within 8\/255 \(R6: the best, q \d+, is \d+\/255 off at \(\d+, \d+\)\)$/;
      expect(ceiling.err.map((l) => line.exec(l)?.[1] ?? l)).toEqual(['full', 'half']);
      wroteNothing(again, 'a codec that clamps alpha');
    } finally {
      rmSync(again, { recursive: true, force: true });
    }
  }, 120_000);

  test('assets: a src plate with an odd width is refused before it is encoded', async () => {
    // R5 (§4.3) runs on shot.json's crop before any source file is decoded (the odd-side carry, MD1 O1): a 1081-px crop
    // is one input problem by name, with no encode call and nothing written. Its passing 1080 case is the end-to-end test.
    writeRepo(repo, SRC_REPO);
    plant(repo, 'assets/src/shot/cafe/shot.json', JSON.stringify({ crop: [0, 0, 1081, 2048], focus: [540, 614] }));
    const calls: string[] = [];
    const r = await runTool(repo, recordingEncoders(FAKE_ENCODERS, calls));
    expect(r.code).toBe(1);
    expect(r.err).toEqual(['assets: cafe: plate 1081 × 2048 (R5: 2048 high, an even width in 1080..1440)']);
    expect(calls).toEqual([]);
    wroteNothing(repo, 'odd crop');
  });

  test("assets: a room prop over a cast member's figure is a warning", async () => {
    // R8 (§4.3, cut D6): a room's props draw above its shot's root, so a prop rect over a cast member's figure mask is
    // warned about on stdout, and the run still succeeds; the same rect moved off the figure warns about nothing.
    const files = await shotDir({ w: 1080, h: 2048, u: 4 });
    const list = { ...SHOT_LIST, shots: SHOT_LIST.shots.map((s) => ({ ...s, frame: 'room' })) };
    const need = { ...cafeNeed([['neutral', false]], 'ch1'), frame: 'room', room: 'hall' };
    const world = (rect: readonly number[]): unknown => ({
      format: 1,
      items: {},
      docs: {},
      puzzles: {},
      sections: {
        house: {
          start: 'hall',
          bgm: null,
          rooms: {
            hall: {
              bg: 'cafe',
              title: { id: 'ch1.hall.t001', ru: 'Зал' },
              onEnter: [],
              hotspots: [{ id: 'vase', kind: 'object', rect, label: { id: 'ch1.vase.l001', ru: 'Ваза' }, lock: null, then: [], look: null, prop: 'vase' }],
            },
          },
        },
      },
    });
    const usage = shotsUsage({ ch1: { shots: { cafe: need }, assets: ['bg/cafe', 'sheet/cafe'] }, ch2: { shots: {}, assets: [] } });
    const warnings = async (rect: readonly number[]): Promise<string[]> => {
      writeRepo(repo, { ...SRC_REPO, 'story/shots.json': list, 'server/content/build/shots.json': usage, 'story/ch1/world.json': world(rect) });
      plantShot(repo, files);
      const r = await runTool(repo, FAKE_ENCODERS);
      expect(r.code, r.err.join('\n')).toBe(0);
      return r.out.filter((l) => l.startsWith('assets: warning: '));
    };
    // The figure mask is the ellipse centred at (540, 1270) with radii 192 and 737 (fixture geometry at u 4).
    expect(await warnings([500, 1200, 80, 80])).toEqual(["assets: warning: cafe: hall prop rect [500, 1200, 80, 80] covers ally's figure (R8: props draw above the shot root)"]);
    expect(await warnings([20, 20, 40, 40])).toEqual([]);
  }, 120_000);

  test('assets: a src shot the tool cannot extract is refused by name and writes nothing', async () => {
    // Fail closed, one cause one message (cut D14, R9's clauses, critique W1 / O1): each case is refused by name before
    // anything is encoded, and nothing is written.
    const base = await shotDir({ w: 1080, h: 2048, u: 4 });
    const json = shotJson(base);
    const layers = json['layers'] as Record<string, unknown>;
    const j = (v: unknown): Uint8Array => utf8.encode(JSON.stringify(v));
    const castless = { ...SHOT_LIST, shots: SHOT_LIST.shots.map((s) => ({ ...s, cast: [] })) };
    const castlessNeed = { ...impliedNeed('cafe'), frame: 'close' };
    const figured = { ...SHOT_LIST, shots: SHOT_LIST.shots.map((s) => ({ ...s, cast: s.cast.map((m) => ({ ...m, figure: true })) })) };
    const figuredNeed = (faces: ReadonlyArray<readonly [string, boolean]>, ch: string): Record<string, unknown> => ({
      ...cafeNeed(faces, ch),
      cast: { ally: { view: 'face', rest: 'neutral', figure: true } },
    });
    const transparent = await sharp({ create: { width: 1080, height: 2048, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    // F1 (fix3): alpha 254 at one px inside the crop is within R1's 2/255, so only the plate's own check refuses it.
    const plate = syntheticShot({ w: 1080, h: 2048, u: 4 }).files.get('plate.png');
    const seeThrough = Uint8Array.from(plate?.data ?? []);
    seeThrough[(100 * 1080 + 540) * 4 + 3] = 254;
    const translucent = await sharp(seeThrough, { raw: { width: 1080, height: 2048, channels: 4 } }).png().toBuffer();
    const large = await shotDir({ w: 1080, h: 2048, u: 4, largePlanes: true });
    // D5 / D12 (triage r1 F2): read by its header before anything is decoded, so a tiny file stands for the whole one.
    const rgba16 = await sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 1 } } }).toColourspace('rgb16').png().toBuffer();
    const colourDepth = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 10, g: 20, b: 30 } } }).png().toBuffer();
    // R8's world read (triage r1 F3): a room src shot whose chapter world does not decode.
    const roomList = { ...SHOT_LIST, shots: SHOT_LIST.shots.map((s) => ({ ...s, frame: 'room' })) };
    const roomNeed = { ...cafeNeed([['neutral', false]], 'ch1'), frame: 'room', room: 'hall' };
    const cases: ReadonlyArray<{ name: string; repo: Readonly<Record<string, unknown>>; src: Readonly<Record<string, Uint8Array | null>>; err: readonly (string | RegExp)[] }> = [
      {
        name: 'ambient',
        repo: SRC_REPO,
        src: { 'shot.json': j({ ...json, ambient: [{ kind: 'flicker', mask: 'mask.flicker.0.png' }] }) },
        err: ["assets: cafe/shot.json: ambient: not supported yet (a src shot's ambient is SH9's; declare none)"],
      },
      {
        name: 'planes without a cast',
        repo: {
          ...SRC_REPO,
          'story/shots.json': castless,
          'server/content/build/shots.json': shotsUsage({ ch1: { shots: { cafe: castlessNeed }, assets: ['bg/cafe'] }, ch2: { shots: { cafe: castlessNeed }, assets: ['bg/cafe'] } }),
        },
        src: { 'shot.json': j({ ...json, layers: { plane_0: { kind: 'plane', char: null, mask: 'mask.plane.0.png', pivot: [540, 1800], depth: 0.9 } } }) },
        err: ["assets: cafe: a plane layer in a shot without a cast (a cast-less src shot's sheet is not listed yet)"],
      },
      {
        name: 'figure without its layer',
        repo: {
          ...SRC_REPO,
          'story/shots.json': figured,
          'server/content/build/shots.json': shotsUsage({
            ch1: { ...SRC_CHAPTERS.ch1, shots: { cafe: figuredNeed([['neutral', true], ['smile', true]], 'ch1') } },
            ch2: { ...SRC_CHAPTERS.ch2, shots: { cafe: figuredNeed([['surprised', false]], 'ch2') } },
          }),
        },
        src: {},
        err: ['assets: cafe: ally has figure: true but no figure layer (R9: a hop / bounce member is cut out)'],
      },
      {
        name: 'a layer of no cast member',
        repo: SRC_REPO,
        src: { 'shot.json': j({ ...json, layers: { ...layers, hair_bob_0: { kind: 'hair', char: 'bob', mask: 'mask.hair.bob.0.png', pivot: [540, 400], depth: 0.6 } } }) },
        err: ['assets: cafe/shot.json: layers.hair_bob_0.char: bob is not a cast member of cafe'],
      },
      {
        name: 'a sheet over 2048',
        repo: SRC_REPO,
        src: Object.fromEntries([...large].filter(([name]) => name === 'original.png' || name === 'shot.json' || name.startsWith('mask.plane.'))),
        err: [/^assets: sheet\/cafe does not fit 2048 × 2048 \(layer sizes \d+ × \d+(, \d+ × \d+)*\)$/],
      },
      {
        name: 'an empty mask',
        repo: SRC_REPO,
        src: { 'mask.hair.ally.0.png': transparent },
        err: ['assets: cafe/mask.hair.ally.0.png: empty'],
      },
      {
        name: 'a plate that is not opaque',
        repo: SRC_REPO,
        src: { 'plate.png': translucent },
        err: ['assets: cafe/plate.png: alpha below 255 at 1 px inside the crop, the first at (540, 100) with alpha 254 (a plate is opaque: the base under every face layer, §4.3)'],
      },
      {
        name: 'a src bg no shot shows',
        repo: { ...SRC_REPO, 'server/content/build/shots.json': shotsUsage({ ch1: { shots: {}, assets: [] }, ch2: { shots: {}, assets: [] } }) },
        src: {},
        err: ['assets: bg/cafe: src shot/cafe is used, but server/content/build/shots.json shows no shot of it (run the story tool)'],
      },
      {
        name: 'a 16-bit source file',
        repo: SRC_REPO,
        src: { 'original.png': rgba16 },
        err: ['assets: cafe/original.png: png, ushort, 4 channels, not an 8-bit PNG (D5)'],
      },
      {
        name: 'a colour depth map',
        repo: SRC_REPO,
        src: { 'depth.png': colourDepth },
        err: ['assets: cafe/depth.png: png, uchar, 3 channels, not an 8- or 16-bit greyscale PNG (D12)'],
      },
      {
        name: 'a world that does not decode',
        repo: {
          ...SRC_REPO,
          'story/shots.json': roomList,
          'server/content/build/shots.json': shotsUsage({ ch1: { shots: { cafe: roomNeed }, assets: ['bg/cafe', 'sheet/cafe'] }, ch2: { shots: {}, assets: [] } }),
          'story/ch1/world.json': { format: 2, items: {}, docs: {}, puzzles: {}, sections: {} },
        },
        src: {},
        err: ['assets: story/ch1/world.json: format: 2: the world format is 1'],
      },
    ];
    const errs = new Map<string, readonly string[]>();
    for (const c of cases) {
      const root = join(repo, c.name.replaceAll(' ', '-'));
      writeRepo(root, c.repo);
      plantShot(root, base, c.src);
      const calls: string[] = [];
      const r = await runTool(root, recordingEncoders(FAKE_ENCODERS, calls));
      errs.set(c.name, r.err);
      expect(r.code, `${c.name}: ${r.err.join('\n')}`).toBe(1);
      expect(r.err.length, `${c.name}: ${r.err.join('\n')}`).toBe(c.err.length);
      c.err.forEach((want, i) => {
        if (typeof want === 'string') {
          expect(r.err[i], c.name).toBe(want);
        } else {
          expect(r.err[i], c.name).toMatch(want);
        }
      });
      expect(calls, c.name).toEqual([]);
      wroteNothing(root, c.name);
    }
    // The unpackable sheet lists both planes' sizes, each as wide as the plate.
    expect((errs.get('a sheet over 2048') ?? []).join('\n').match(/1080 × \d+/g)).toHaveLength(2);
  }, 120_000);

  test('assets: a loop prop packs its frames into one atlas with the loop rig in the manifest', async () => {
    // Shots §2.4 (W10): a loop prop's frames are one atlas `prop/<id>`, a plain image entry; its frame boxes and fps
    // travel in the manifest's top-level `loops`, for the chapters that use the prop.
    const catalog = { ...REPO_CATALOG, prop: { ...REPO_CATALOG.prop, fire: { loop: { placeholder: { hue: 20, frames: 6 }, fps: 8 } } } };
    const usage = { chapters: { ...REPO_USAGE.chapters, ch1: { ...REPO_USAGE.chapters.ch1, worldAssets: ['prop/fire'] } } };
    writeRepo(repo, { 'assets/catalog.json': catalog, 'server/content/build/usage.json': usage });
    const asked: Record<string, unknown> = {};
    const svgs: Record<string, string> = {};
    const recording: Encoders = {
      ...FAKE_ENCODERS,
      encodeImage: (svg, o) => {
        const text = new TextDecoder().decode(svg);
        const id = /<text\b[^>]*>([^<]+)<\/text>/.exec(text)?.[1] ?? '(no label)';
        [asked[id], svgs[id]] = [o, text];
        return FAKE_ENCODERS.encodeImage(svg, o);
      },
    };
    const r = await runTool(repo, recording);
    expect(r.code, r.err.join('\n')).toBe(0);
    expect(asked['prop/fire']).toEqual({ trim: false, half: 'any' }); // the frames are the rig's boxes: never trimmed
    expect(svgs['prop/fire']?.match(/<rect\b/g)).toHaveLength(6);
    expect(listDir(repo, 'client/public/assets').filter((n) => n.startsWith('prop-fire-'))).toHaveLength(2);
    const ch1 = JSON.parse(readRel(repo, 'client/src/story-gen/free/ch1.assets.json')) as Record<string, unknown>;
    expect(Object.keys(ch1)).toEqual(['chapterId', 'assets', 'loops']);
    const entry = (ch1['assets'] as Record<string, { w: number; h: number }>)['prop/fire'];
    const loops = decodeLoops(ch1['loops']);
    expect(loops.ok ? [] : loops.error).toEqual([]);
    const fire = loops.ok ? loops.value.get('fire' as PropId) : undefined;
    expect(fire?.fps).toBe(8);
    expect(fire?.frames).toHaveLength(6);
    for (const [x, y, w, h] of fire?.frames ?? []) {
      expect([w, h]).toEqual([512, 512]);
      expect([x % 2, y % 2]).toEqual([0, 0]);
      expect(x + w <= (entry?.w ?? 0) && y + h <= (entry?.h ?? 0)).toBe(true);
    }
    expect(new Set((fire?.frames ?? []).map((f) => f.join(','))).size).toBe(6);
    expect([entry?.w, entry?.h]).toEqual([2048, 1024]);
    // A chapter that does not use the prop carries no loop.
    expect(Object.keys(JSON.parse(readRel(repo, 'server/content/chapters/ch2/assets.json')) as object)).toEqual(['chapterId', 'assets']);
  });

  test('assets: a loop prop used only by a paid chapter is gated', async () => {
    const catalog = { ...REPO_CATALOG, prop: { ...REPO_CATALOG.prop, fire: { loop: { placeholder: { hue: 20, frames: 3 }, fps: 6 } } } };
    const usage = { chapters: { ...REPO_USAGE.chapters, ch2: { ...REPO_USAGE.chapters.ch2, worldAssets: ['prop/fire'] } } };
    writeRepo(repo, { 'assets/catalog.json': catalog, 'server/content/build/usage.json': usage });
    const r = await runTool(repo, HALVING_FAKES);
    expect(r.code, r.err.join('\n')).toBe(0);
    const fire = (dir: string): string[] => listDir(repo, dir).filter((n) => n.startsWith('prop-fire-'));
    expect(fire('server/content/assets')).toHaveLength(4); // full and half, both formats
    expect(fire('client/public/assets')).toEqual([]);
    const fp = decodeAssetFingerprints(JSON.parse(readRel(repo, 'server/content/build/fingerprints.assets.json')));
    expect((fp.ok ? fp.value.files : []).filter((f) => f.asset === 'prop/fire').map((f) => f.name).sort()).toEqual(fire('server/content/assets'));
    const ch2 = JSON.parse(readRel(repo, 'server/content/chapters/ch2/assets.json')) as { assets: Record<string, RawEntry>; loops?: unknown };
    expect(ch2.assets['prop/fire']?.['avif']).toEqual({ url: expect.stringMatching(/^\/api\/assets\/prop-fire-[0-9a-f]{8}\.avif$/) as string, bytes: expect.any(Number) as number });
    const loops = decodeLoops(ch2.loops);
    expect(loops.ok ? [...loops.value.keys()] : loops.error).toEqual(['fire']);
    const ch1 = readRel(repo, 'client/src/story-gen/free/ch1.assets.json');
    expect(ch1).not.toContain('fire');
  });

  test('assets: a src loop prop packs its frames into one atlas', async () => {
    // Shots §2.4 / §4.4 (cut rider R-b, RULINGS 267): `assets/src/loop/fire/0.png .. 5.png`, six 96 × 64 frames with a
    // feathered alpha, are packed into one atlas `prop/fire` like a placeholder's, encoded from px with its AVIF q
    // searched from 50, and the manifest's loop rig names each frame's box. R6 holds on the shipped bytes.
    const catalog = { ...REPO_CATALOG, prop: { ...REPO_CATALOG.prop, fire: { loop: { src: 'loop/fire', fps: 8 } } } };
    const usage = { chapters: { ...REPO_USAGE.chapters, ch1: { ...REPO_USAGE.chapters.ch1, worldAssets: ['prop/fire'] } } };
    writeRepo(repo, { 'assets/catalog.json': catalog, 'server/content/build/usage.json': usage });
    const frames = Array.from({ length: 6 }, (_, i) => loopFrame(i, 96, 64));
    for (const [i, f] of frames.entries()) {
      plant(repo, `assets/src/loop/fire/${i}.png`, await sharp(f.data, { raw: { width: f.w, height: f.h, channels: 4 } }).png().toBuffer());
    }
    const seen: { id: string; q: number; search: boolean }[] = [];
    const recording: Encoders = {
      ...FAKE_ENCODERS,
      encodeRaster: (px, o, codec) => {
        seen.push({ id: o.id, q: o.q, search: o.search });
        return encodeRaster(px, o, codec);
      },
    };
    const r = await runTool(repo, recording);
    expect(r.code, r.err.join('\n')).toBe(0);
    expect(seen).toEqual([{ id: 'prop/fire', q: 50, search: true }]);
    const ch1 = JSON.parse(readRel(repo, 'client/src/story-gen/free/ch1.assets.json')) as { assets: Record<string, RawEntry>; loops: unknown };
    const loops = decodeLoops(ch1.loops);
    expect(loops.ok ? [] : loops.error).toEqual([]);
    const fire = loops.ok ? loops.value.get('fire' as PropId) : undefined;
    expect(fire?.fps).toBe(8);
    expect(fire?.frames.map(([, , w, h]) => [w, h])).toEqual(Array.from({ length: 6 }, () => [96, 64]));
    const entry = ch1.assets['prop/fire'];
    const [w, h] = [Number(entry?.['w']), Number(entry?.['h'])];
    expect([w % 2, h % 2, w <= 2048 && h <= 2048]).toEqual([0, 0, true]);
    // The atlas the tool encoded, rebuilt from the frames at the rig's boxes: its shipped AVIF and WebP, full and half,
    // keep alpha within 8/255 at every px.
    const atlas = new Uint8Array(w * h * 4);
    (fire?.frames ?? []).forEach(([x, y], i) => {
      const f = frames[i];
      for (let row = 0; f !== undefined && row < f.h; row++) {
        atlas.set(f.data.subarray(row * f.w * 4, (row + 1) * f.w * 4), ((y + row) * w + x) * 4);
      }
    });
    const source: Raster = { data: atlas, w, h };
    const half = entry?.['half'] as RawEntry | undefined;
    expect(half?.['w']).toBe(w / 2);
    const shipped = (e: RawEntry | undefined, f: 'avif' | 'webp'): Uint8Array => {
      const url = String((e?.[f] as { url?: unknown } | undefined)?.url);
      return readFileSync(join(repo, 'client', 'public', 'assets', url.slice(url.lastIndexOf('/') + 1)));
    };
    for (const [tier, e, px] of [['full', entry, source], ['half', half, halfOf(source)]] as const) {
      for (const f of ['avif', 'webp'] as const) {
        expect(alphaProblems(`prop/fire ${tier} ${f}`, await decodeRaster(shipped(e, f)), px)).toEqual([]);
      }
    }
  }, 60_000);

  test('assets: a src loop frame over 512 x 512 is refused', async () => {
    // Shots §4.4 (cut rider R-b, the loop-frame carry): a src loop's frames are 0.png .. <n-1>.png, 1..12 of them, one
    // size, each side even and at most 512. Each case is one input problem by name: no encode, nothing written.
    const catalog = { ...REPO_CATALOG, prop: { ...REPO_CATALOG.prop, fire: { loop: { src: 'loop/fire', fps: 8 } } } };
    const usage = { chapters: { ...REPO_USAGE.chapters, ch1: { ...REPO_USAGE.chapters.ch1, worldAssets: ['prop/fire'] } } };
    const png = (w: number, h: number): Promise<Buffer> => {
      const f = loopFrame(0, w, h);
      return sharp(f.data, { raw: { width: f.w, height: f.h, channels: 4 } }).png().toBuffer();
    };
    // `names`: the frames' file names when they are not 0.png .. <n-1>.png (triage r1 F4, F5: no frame, a stray name).
    const cases: ReadonlyArray<{ name: string; sizes: ReadonlyArray<readonly [number, number]>; names?: readonly string[]; err: string }> = [
      { name: 'over 512', sizes: [[514, 512], [514, 512]], err: 'assets: prop/fire: assets/src/loop/fire: frames of 514 × 512 (shots §4.4: each side even and at most 512)' },
      { name: '13 frames', sizes: Array.from({ length: 13 }, () => [96, 64] as const), err: 'assets: prop/fire: assets/src/loop/fire has 13 frames (shots §4.4: 1..12)' },
      { name: 'two sizes', sizes: [[96, 64], [98, 64]], err: 'assets: prop/fire: assets/src/loop/fire: frames of 96 × 64, 98 × 64 (shots §4.4: one size)' },
      { name: 'an odd side', sizes: [[95, 64]], err: 'assets: prop/fire: assets/src/loop/fire: frames of 95 × 64 (shots §4.4: each side even and at most 512)' },
      { name: 'no frame', sizes: [], err: 'assets: prop/fire: assets/src/loop/fire has no frame (shots §4.4: 0.png .. <n-1>.png, 1..12 frames)' },
      {
        name: 'a gap',
        sizes: [[96, 64], [96, 64]],
        names: ['0.png', '2.png'],
        err: 'assets: prop/fire: assets/src/loop/fire: 2.png not in 0.png .. 1.png (shots §4.4: frames numbered from 0, contiguous)',
      },
      { name: 'no 0.png', sizes: [[96, 64]], names: ['1.png'], err: 'assets: prop/fire: assets/src/loop/fire: 1.png not in 0.png .. 0.png (shots §4.4: frames numbered from 0, contiguous)' },
    ];
    for (const c of cases) {
      const root = join(repo, c.name.replaceAll(' ', '-'));
      writeRepo(root, { 'assets/catalog.json': catalog, 'server/content/build/usage.json': usage });
      for (const [i, [w, h]] of c.sizes.entries()) {
        plant(root, `assets/src/loop/fire/${c.names?.[i] ?? `${i}.png`}`, await png(w, h));
      }
      const calls: string[] = [];
      const r = await runTool(root, recordingEncoders(FAKE_ENCODERS, calls));
      expect(r.code, c.name).toBe(1);
      expect(r.err, c.name).toEqual([c.err]);
      expect(calls, c.name).toEqual([]);
      wroteNothing(root, c.name);
    }
  }, 60_000);

  test("assets: a gated src file is never a public file's copy", async () => {
    // Principle 0 for every gated src kind (fix3 I1, M2), with a paid chapter that speaks. `booth`'s source directory is
    // a byte copy of `cafe`'s and `ember`'s frames of `fire`'s, so booth's plate, sheet, face and talk files and ember's
    // atlas have the px of public files; so has `talk/cafe/ally/surprised`, whose diff misses the rest mouths (its talk
    // file is the rest's mouths, §2.6). A gated src file carries its own id as EXIF ImageDescription and a public one
    // none: no gated file is a public file's bytes, scan-dist's hash arm stays silent, every decoded px is its twin's.
    const files = await shotDir({ w: 1100, h: 2048, u: 4, crop: [10, 0, 1080, 2048], q: 44 });
    const catalog = {
      ...SRC_CATALOG,
      bg: { ...SRC_CATALOG.bg, booth: { src: 'shot/booth' } },
      prop: { ...SRC_CATALOG.prop, fire: { loop: { src: 'loop/fire', fps: 8 } }, ember: { loop: { src: 'loop/ember', fps: 8 } } },
    };
    const list = {
      locs: [...SHOT_LIST.locs, { id: 'booth', light: null }],
      shots: [...SHOT_LIST.shots, { id: 'booth', loc: 'booth', frame: 'close', cast: [{ char: 'ally', view: 'face', rest: 'neutral' }] }],
    };
    const chapters = {
      ch1: SRC_CHAPTERS.ch1,
      ch2: {
        shots: { booth: shotNeedOf('booth', [['neutral', true], ['smile', false]], 'ch2'), cafe: cafeNeed([['surprised', true]], 'ch2') },
        assets: ['bg/booth', 'bg/cafe', 'face/booth/ally/smile', 'face/cafe/ally/surprised', 'sheet/booth', 'sheet/cafe', 'talk/booth/ally/neutral', 'talk/cafe/ally/surprised'],
      },
    };
    const usage = { chapters: { ch1: { ...REPO_USAGE.chapters.ch1, worldAssets: ['prop/fire'] }, ch2: { ...REPO_USAGE.chapters.ch2, worldAssets: ['prop/ember'] } } };
    writeRepo(repo, {
      'assets/catalog.json': catalog,
      'story/shots.json': list,
      'server/content/build/shots.json': shotsUsage(chapters),
      'server/content/build/usage.json': usage,
    });
    plantShot(repo, files);
    plantShot(repo, files, {}, 'booth');
    for (const prop of ['fire', 'ember']) {
      for (let i = 0; i < 6; i++) {
        const f = loopFrame(i, 96, 64);
        plant(repo, `assets/src/loop/${prop}/${i}.png`, await sharp(f.data, { raw: { width: f.w, height: f.h, channels: 4 } }).png().toBuffer());
      }
    }
    const seen: string[] = [];
    const r = await runTool(repo, {
      encodeImage,
      synthWav,
      encodeRaster: (px, o, codec) => {
        seen.push(o.id);
        return encodeRaster(px, o, codec);
      },
    });
    expect(r.code, r.err.join('\n')).toBe(0);
    const gated = ['bg/booth', 'face/booth/ally/smile', 'face/cafe/ally/surprised', 'prop/ember', 'sheet/booth', 'talk/booth/ally/neutral', 'talk/cafe/ally/surprised'];
    const pub = ['bg/cafe', 'face/cafe/ally/smile', 'prop/fire', 'sheet/cafe', 'talk/cafe/ally/neutral', 'talk/cafe/ally/smile'];
    expect([...seen].sort(), 'every src file is encoded from px').toEqual([...gated, ...pub].sort());
    // M2, the split: each gated id's four files gated, fingerprinted, named by the paid manifest alone; each public one's
    // four files public.
    const [pubDir, paidDir] = [listDir(repo, 'client/public/assets'), listDir(repo, 'server/content/assets')];
    const of = (dir: readonly string[], id: string): string[] => dir.filter((n) => n.startsWith(`${id.replaceAll('/', '-')}-`));
    const fp = decodeAssetFingerprints(JSON.parse(readRel(repo, 'server/content/build/fingerprints.assets.json')));
    const printed = fp.ok ? fp.value.files : [];
    type Manifest = { assets: Record<string, RawEntry> };
    const ch1 = JSON.parse(readRel(repo, 'client/src/story-gen/free/ch1.assets.json')) as Manifest;
    const ch2 = JSON.parse(readRel(repo, 'server/content/chapters/ch2/assets.json')) as Manifest;
    /** An entry's four URLs: AVIF, WebP, half AVIF, half WebP. */
    const urls = (e: RawEntry | undefined): string[] => {
      const half = e?.['half'] as RawEntry | undefined;
      return [e?.['avif'], e?.['webp'], half?.['avif'], half?.['webp']].map((f) => String((f as { url?: unknown } | undefined)?.url));
    };
    const bytesAt = (url: string): Buffer => readFileSync(join(repo, ...(urlPath(url) ?? url).split('/')));
    for (const id of gated) {
      expect([of(paidDir, id).length, of(pubDir, id).length], `${id}: gated, never public`).toEqual([4, 0]);
      expect(printed.filter((f) => f.asset === id).map((f) => f.name).sort(), `${id}: fingerprinted`).toEqual(of(paidDir, id));
      expect(urls(ch2.assets[id]).filter((u) => !u.startsWith('/api/assets/')), `${id}: ch2 names it under /api/assets/`).toEqual([]);
      expect(Object.hasOwn(ch1.assets, id), `${id}: absent from ch1's manifest`).toBe(false);
    }
    for (const id of pub) {
      expect([of(pubDir, id).length, of(paidDir, id).length], `${id}: public, not gated`).toEqual([4, 0]);
    }
    // I-0: no gated file has a public file's bytes, so scan-dist's hash arm finds nothing.
    const read = (dir: string, names: readonly string[]): { path: string; bytes: Buffer }[] =>
      names.map((name) => ({ path: `${dir}/${name}`, bytes: readFileSync(join(repo, ...dir.split('/'), name)) }));
    const [pubFiles, paidFiles] = [read('client/public/assets', pubDir), read('server/content/assets', paidDir)];
    const pubBySha = new Map(pubFiles.map((f) => [sha256Hex(f.bytes), f.path]));
    const twins = paidFiles.flatMap((f) => {
      const twin = pubBySha.get(sha256Hex(f.bytes));
      return twin === undefined ? [] : [`${f.path} has the bytes of ${twin}`];
    });
    expect(twins).toEqual([]);
    expect(scanPaidFiles(pubFiles, printed)).toEqual([]);
    // The mark: each gated src file carries its own id; no public src file carries EXIF.
    for (const id of gated) {
      for (const url of urls(ch2.assets[id])) {
        const bytes = bytesAt(url);
        expect((await sharp(bytes).metadata()).exif, `${url}: its mark`).toBeDefined();
        expect(bytes.includes(id), `${url} holds ${id}`).toBe(true);
      }
    }
    for (const id of pub) {
      for (const url of urls(ch1.assets[id])) {
        expect((await sharp(bytesAt(url)).metadata()).exif, `${url}: unmarked`).toBeUndefined();
      }
    }
    // The pixels are untouched: each gated twin decodes to its public twin's px, AVIF and WebP, full and half.
    const pairs = [
      ['bg/booth', 'bg/cafe'],
      ['sheet/booth', 'sheet/cafe'],
      ['face/booth/ally/smile', 'face/cafe/ally/smile'],
      ['talk/booth/ally/neutral', 'talk/cafe/ally/neutral'],
      ['talk/cafe/ally/surprised', 'talk/cafe/ally/neutral'],
      ['prop/ember', 'prop/fire'],
    ] as const;
    const differ: string[] = [];
    for (const [g, p] of pairs) {
      const [gu, pu] = [urls(ch2.assets[g]), urls(ch1.assets[p])];
      for (const [i, url] of gu.entries()) {
        const [a, b] = [await decodeRaster(bytesAt(url)), await decodeRaster(bytesAt(pu[i] ?? ''))];
        if (a.w !== b.w || a.h !== b.h || Buffer.compare(a.data, b.data) !== 0) {
          differ.push(`${url} against ${pu[i] ?? ''}`);
        }
      }
    }
    expect(differ).toEqual([]);
  }, 120_000);

  test('assets: a chapter manifest carries only the rigs, members and files its chapter uses', async () => {
    // Shots §4.5 (CH D5): each chapter's manifest holds a rig per shot it shows, with only the expressions it shows and
    // talk members only where it speaks, every member in one of its own files; and its look, when it has windows.
    const step = { cur: ['bg/cafe', 'sheet/cafe', 'talk/cafe/ally/neutral'], certain: [], certainDist: 0, possible: [], near: 0, d2: [], d3: [], labels: false };
    writeRepo(repo, { ...SHOT_REPO, 'server/content/build/shots.json': shotsUsage({ ...SHOT_CHAPTERS, ch1: { ...SHOT_CHAPTERS.ch1, look: { 'ch1.cafe.a001': step } } }) });
    const r = await runTool(repo, HALVING_FAKES);
    expect(r.code, r.err.join('\n')).toBe(0);
    const ch1 = JSON.parse(readRel(repo, 'client/src/story-gen/free/ch1.assets.json')) as Record<string, unknown>;
    const ch2 = JSON.parse(readRel(repo, 'server/content/chapters/ch2/assets.json')) as Record<string, unknown>;
    expect(Object.keys(ch1)).toEqual(['chapterId', 'assets', 'shots', 'look']);
    expect(Object.keys(ch2)).toEqual(['chapterId', 'assets', 'shots']); // no window: no look
    const rigs = (m: Record<string, unknown>): ReadonlyMap<BgId, ShotRig> => {
      const d = decodeShotRigs(m['shots']);
      expect(d.ok ? [] : d.error).toEqual([]);
      return d.ok ? d.value : new Map();
    };
    const [r1, r2] = [rigs(ch1), rigs(ch2)];
    expect([...r1.keys()]).toEqual(['cafe']);
    expect([...r2.keys()]).toEqual(['archive', 'cafe']);
    expect(r2.get('archive' as BgId)?.cast).toEqual([]);
    const ally1 = r1.get('cafe' as BgId)?.cast[0];
    const ally2 = r2.get('cafe' as BgId)?.cast[0];
    const expr = (m: typeof ally1, x: string): FaceRig['exprs'][ExprId] | undefined => m?.face?.exprs[x as ExprId];
    expect(Object.keys(ally1?.face?.exprs ?? {})).toEqual(['neutral']);
    expect(expr(ally1, 'neutral')?.motion.talk.map((m) => m.file)).toEqual(['talk/cafe/ally/neutral', 'talk/cafe/ally/neutral']);
    expect(Object.keys(ally2?.face?.exprs ?? {})).toEqual(['neutral', 'smile']);
    expect(expr(ally2, 'neutral')?.motion.talk).toEqual([]); // ch2 never has ally speak at rest
    expect(expr(ally2, 'smile')?.layer?.file).toBe('face/cafe/ally/smile');
    expect(expr(ally2, 'smile')?.motion.talk.map((m) => m.file)).toEqual(['talk/cafe/ally/smile', 'talk/cafe/ally/smile']);
    // Every member's file is one of its chapter's own entries; the free chapter's rigs name no gated file.
    const files = (v: unknown): string[] =>
      Array.isArray(v)
        ? v.flatMap(files)
        : typeof v === 'object' && v !== null
          ? Object.entries(v).flatMap(([k, x]) => (k === 'file' && typeof x === 'string' ? [x] : files(x)))
          : [];
    for (const m of [ch1, ch2]) {
      const named = files(m['shots']);
      expect(named.length).toBeGreaterThan(0);
      expect(named.filter((f) => !Object.hasOwn(m['assets'] as object, f))).toEqual([]);
    }
    expect(files(ch1['shots']).filter((f) => f.startsWith('face/') || f.endsWith('/smile'))).toEqual([]);
    const look = decodeLook(ch1['look']);
    expect(look.ok ? stepWindow(look.value, 'ch1.cafe.a001') : look.error).toEqual({ need: step.cur, warm: [], near: 0, hope: [] });
  });

  test('assets: every shot file id in build/shots.json is a manifest asset id', async () => {
    // Rev. 5 (m8): the story tool's shot file ids and the asset tool's manifest keys are one grammar: each listed id
    // passes ASSET_ID_RE, parses by its segment count, and names its chapter's entry and the rig member it draws.
    writeRepo(repo, SHOT_REPO);
    const r = await runTool(repo, HALVING_FAKES);
    expect(r.code, r.err.join('\n')).toBe(0);
    const manifests: Record<string, string> = { ch1: 'client/src/story-gen/free/ch1.assets.json', ch2: 'server/content/chapters/ch2/assets.json' };
    let checked = 0;
    for (const [ch, c] of Object.entries(SHOT_CHAPTERS)) {
      const m = JSON.parse(readRel(repo, manifests[ch] ?? '')) as { assets: Record<string, unknown>; shots?: unknown };
      const rigs = decodeShotRigs(m.shots);
      expect(rigs.ok, `${ch}: ${rigs.ok ? '' : rigs.error.join('; ')}`).toBe(true);
      for (const id of c.assets) {
        expect(ASSET_ID_RE.test(id), id).toBe(true);
        const p = parseShotFileId(id);
        expect(p, id).not.toBeNull();
        expect(Object.hasOwn(m.assets, id), `${ch} ${id}`).toBe(true);
        const rig = p === null || !rigs.ok ? undefined : rigs.value.get(p.shot);
        expect(rig, `${ch} ${id}`).toBeDefined();
        if (p !== null && (p.ns === 'face' || p.ns === 'talk')) {
          const exprs = rig?.cast.find((x) => x.char === p.char)?.face?.exprs ?? {};
          expect(Object.hasOwn(exprs, p.expr), `${ch} ${id}`).toBe(true);
        }
        checked++;
      }
    }
    expect(checked).toBe(8);
  });

  test('assets: a need whose file its chapter does not list is refused', async () => {
    // Shots §4.5 (CH D5): build/shots.json's decoder admits a listed file only when a need makes it, never the converse,
    // so the planner's own-entries invariant is what keeps a rig member out of a manifest without its entry: free ch1
    // shows ally smiling silently yet lists no face file, which paid ch2 alone lists, so the file is gated.
    const smiling = cafeNeed([['neutral', true], ['smile', false]], 'ch1');
    writeRepo(repo, { ...SHOT_FILES, 'server/content/build/shots.json': shotsUsage({ ...SHOT_CHAPTERS, ch1: { ...SHOT_CHAPTERS.ch1, shots: { cafe: smiling } } }) });
    await expect(runTool(repo, HALVING_FAKES)).rejects.toThrow(/ch1's manifest is one of its assets entries; face\/cafe\/ally\/smile is not$/);
    expect(existsSync(join(repo, 'client', 'src', 'story-gen', 'free', 'ch1.assets.json')), 'no free manifest names it').toBe(false);
    expect(listDir(repo, 'client/public/assets')).toEqual([]);
    expect(listDir(repo, 'server/content/assets')).toEqual([]);
    // A public file the need makes and no chapter lists: the same refusal, not a rig member with no entry at all.
    writeRepo(repo, { ...SHOT_FILES, 'server/content/build/shots.json': shotsUsage({ ...SHOT_CHAPTERS, ch1: { ...SHOT_CHAPTERS.ch1, assets: ['bg/cafe', 'sheet/cafe'] } }) });
    await expect(runTool(repo, HALVING_FAKES)).rejects.toThrow(/ch1's manifest is one of its assets entries; talk\/cafe\/ally\/neutral is not$/);
    expect(existsSync(join(repo, 'client', 'src', 'story-gen'))).toBe(false);
  });

  test('assets: a look image its chapter does not list is refused', async () => {
    // Shots §4.5 (CH D5): build/shots.json's decoder checks a window's non-shot image by the id grammar alone, never
    // against its chapter's usage, so the planner's own-entries invariant is what keeps a look image out of a manifest
    // without its entry: free ch1's window may warm cg/letter (a `possible` id), which paid ch2 alone lists, so the
    // image is gated.
    const step = { cur: [], certain: [], certainDist: 0, possible: ['cg/letter'], near: 1, d2: [], d3: [], labels: false };
    const usage = { chapters: { ...REPO_USAGE.chapters, ch2: { ...REPO_USAGE.chapters.ch2, assets: [...REPO_USAGE.chapters.ch2.assets, 'cg/letter'] } } };
    writeRepo(repo, {
      ...SHOT_REPO,
      'server/content/build/usage.json': usage,
      'server/content/build/shots.json': shotsUsage({ ...SHOT_CHAPTERS, ch1: { ...SHOT_CHAPTERS.ch1, look: { 'ch1.cafe.a001': step } } }),
    });
    await expect(runTool(repo, HALVING_FAKES)).rejects.toThrow(/ch1's manifest is one of its assets entries; cg\/letter is not$/);
    expect(existsSync(join(repo, 'client', 'src', 'story-gen')), 'no free manifest names it').toBe(false);
    expect(listDir(repo, 'client/public/assets')).toEqual([]);
    expect(listDir(repo, 'server/content/assets')).toEqual([]);
  });

  test('assets: cli runs through a linked path under preserve-symlinks-main', async () => {
    // Node keeps the link's spelling for the main module under the flag; the guard canonicalises both sides, and the
    // main module's relative imports stay under scripts/, so the run happens. The real encoders (sharp) run here.
    const one = { bg: { cafe: { placeholder: { hue: 18 } } }, chars: {}, cg: {}, bgm: {}, sfx: {}, prop: {}, cover: {} };
    writeRepo(repo, {
      'story/chapters.json': [{ ...CH1, next: null }],
      'assets/catalog.json': one,
      'server/content/build/usage.json': { chapters: { ch1: { assets: ['bg/cafe'], knots: {} } } },
    });
    const link = join(repo, 'scripts');
    symlinkSync(dirname(ASSETS_SCRIPT), link, process.platform === 'win32' ? 'junction' : 'dir');
    try {
      const r = spawnSync(process.execPath, ['--preserve-symlinks-main', join(link, 'assets.ts'), '--root', repo], {
        cwd: CLIENT_DIR,
        encoding: 'utf8',
      });
      expect(r.status, r.stdout + r.stderr).toBe(0);
      // The public bg's full and half pairs, the manifest, covers.json and the fingerprints.
      expect(r.stdout).toMatch(/^assets: 1 public, 0 paid, 0 unused, 0 covers; 7 files written, 0 stale removed$/m);
    } finally {
      unlinkSync(link); // the link only: afterEach's recursive delete never meets a way into client/scripts
    }
    // sharp's output: the manifest's dimensions are the canonical size, and the AVIF reads back at them.
    const ch1 = decodeAssetManifest(JSON.parse(readRel(repo, 'client/src/story-gen/free/ch1.assets.json')));
    const cafe = ch1.ok ? ch1.value.assets['bg/cafe' as AssetId] : undefined;
    expect(cafe?.kind === 'image' && [cafe.w, cafe.h, cafe.decodedBytes]).toEqual([1080, 2048, 1080 * 2048 * 4]);
    const name = cafe?.kind === 'image' ? cafe.avif.url.slice('/assets/'.length) : '';
    expect(await dims(readFileSync(join(repo, 'client', 'public', 'assets', name)))).toEqual({ w: 1080, h: 2048, format: 'heif' });
    // The half pair (MEMORY-PLAN 4.C): 540 × 1024, and its AVIF reads back at that size.
    const half = cafe?.kind === 'image' ? cafe.half : undefined;
    expect(half && [half.w, half.h, half.decodedBytes]).toEqual([540, 1024, 540 * 1024 * 4]);
    const halfName = half === undefined ? '' : half.avif.url.slice('/assets/'.length);
    expect(await dims(readFileSync(join(repo, 'client', 'public', 'assets', halfName)))).toEqual({ w: 540, h: 1024, format: 'heif' });
  }, CLI_TIMEOUT_MS);
});
