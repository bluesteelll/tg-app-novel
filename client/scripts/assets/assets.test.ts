import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { ASSET_ID_RE, decodeAssetCatalog, decodeAssetManifest, decodeCoverManifest } from '../../src/story/catalog.ts';
import type { CatalogImage, CatalogIssue, ChapterListEntry } from '../../src/story/catalog.ts';
import type { AssetId } from '../../src/story/staging.ts';
import { main } from '../assets.ts';
import type { Encoders } from '../assets.ts';
import { decodeChapterList, decodeStoryUsage } from '../story/emit.ts';
import { encodeImage } from './encode.ts';
import { assetUsage, decodeAssetFingerprints, sha256Hex, tierOf } from './manifest.ts';
import type { AssetUsage } from './manifest.ts';
import { renderPlaceholder } from './placeholder.ts';
import { synthWav } from './synth.ts';

const CLIENT_DIR = fileURLToPath(new URL('../..', import.meta.url));
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
    expect((await runTool(repo)).code).toBe(0);
    const planned = JSON.parse(readRel(repo, 'server/content/chapters/ch2/assets.json')) as { assets: Record<string, RawEntry> };
    expect(decodeAssetManifest(planned)).toEqual({ ok: true, value: planned });
    const committed = fixture('ch2') as { assets: Record<string, RawEntry> };
    // Per kind, the entry keys and each URL slot's keys equal the committed fixture's: what AssetProbe reads.
    const shape = (m: { assets: Record<string, RawEntry> }): Record<string, string> => {
      const out: Record<string, string> = {};
      for (const e of Object.values(m.assets)) {
        const slots = Object.entries(e).filter(([, v]) => typeof v === 'object' && v !== null);
        out[String(e['kind'])] = JSON.stringify([Object.keys(e).sort(), slots.map(([k, v]) => [k, Object.keys(v as object).sort()])]);
      }
      return out;
    };
    expect(shape(planned)).toEqual(shape(committed));
    const gated = Object.values(planned.assets).flatMap((e) =>
      Object.values(e).flatMap((v) => (typeof v === 'object' && v !== null && 'url' in v ? [String(v.url)] : [])),
    );
    expect(gated.filter((u) => u.startsWith('/api/assets/'))).toHaveLength(3);
    for (const url of gated.filter((u) => u.startsWith('/api/assets/'))) {
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
      expect(r.stdout).toMatch(/^assets: 1 public, 0 paid, 0 unused, 0 covers; 5 files written, 0 stale removed$/m);
    } finally {
      unlinkSync(link); // the link only: afterEach's recursive delete never meets a way into client/scripts
    }
    // sharp's output: the manifest's dimensions are the canonical size, and the AVIF reads back at them.
    const ch1 = decodeAssetManifest(JSON.parse(readRel(repo, 'client/src/story-gen/free/ch1.assets.json')));
    const cafe = ch1.ok ? ch1.value.assets['bg/cafe' as AssetId] : undefined;
    expect(cafe?.kind === 'image' && [cafe.w, cafe.h, cafe.decodedBytes]).toEqual([1080, 2048, 1080 * 2048 * 4]);
    const name = cafe?.kind === 'image' ? cafe.avif.url.slice('/assets/'.length) : '';
    expect(await dims(readFileSync(join(repo, 'client', 'public', 'assets', name)))).toEqual({ w: 1080, h: 2048, format: 'heif' });
  }, 30_000);
});
