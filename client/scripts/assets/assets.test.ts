import sharp from 'sharp';
import { describe, expect, test, vi } from 'vitest';

import { ASSET_ID_RE, decodeAssetCatalog } from '../../src/story/catalog.ts';
import type { CatalogImage, CatalogIssue } from '../../src/story/catalog.ts';
import type { AssetId } from '../../src/story/staging.ts';
import { encodeImage } from './encode.ts';
import { renderPlaceholder } from './placeholder.ts';

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
