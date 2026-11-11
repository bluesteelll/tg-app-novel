import sharp from 'sharp';
import { describe, expect, test } from 'vitest';

import type { AssetCatalog } from '../../src/story/catalog.ts';
import type { AssetId, BgId, CharId, ExprId } from '../../src/story/staging.ts';
import type { Shot } from '../story/shots/list.ts';
import type { ShotNeed } from '../story/shots/usage.ts';
import { facesOf, placeholderLayers, shotFiles, shotFileSvg } from './shots.ts';
import type { PackedFile } from './shots.ts';

const PLATE = { w: 1080, h: 2048 } as const;

/** ally (neutral 200, smile 160, angry 10) and bob (neutral 90): the expression vocabulary's hues tint the layers. */
const CATALOG = {
  bg: {},
  chars: {
    ally: { exprs: { neutral: { placeholder: { hue: 200 } }, smile: { placeholder: { hue: 160 } }, angry: { placeholder: { hue: 10 } } } },
    bob: { exprs: { neutral: { placeholder: { hue: 90 } } } },
  },
  cg: {},
  bgm: {},
  sfx: {},
  prop: {},
  cover: {},
} as unknown as AssetCatalog; // a literal catalog of decoded shape

function shot(id: string, frame: Shot['frame'], cast: ReadonlyArray<readonly [string, 'face' | 'back']>): Shot {
  return {
    id: id as BgId,
    loc: id as Shot['loc'],
    frame,
    cast: cast.map(([char, view]) => ({ char: char as CharId, view, rest: 'neutral' as ExprId, figure: false })),
  };
}

/** One chapter's need of a shot: per face member, its expressions as `[expr, talk]`. */
function need(s: Shot, faces: Readonly<Record<string, ReadonlyArray<readonly [string, boolean]>>>): ShotNeed {
  return {
    cast: Object.fromEntries(s.cast.map((m) => [m.char, { view: m.view, rest: m.rest, figure: m.figure }])),
    faces: Object.fromEntries(Object.entries(faces).map(([c, xs]) => [c, xs.map(([expr, talk]) => ({ expr, talk, lines: [] }))])),
    frame: s.frame,
    loc: s.loc,
    camTargets: [],
    motions: [],
    room: null,
  } as unknown as ShotNeed; // literal ids of the fixture catalog
}

/** The label element of a packed file's SVG: its text, font size and anchor. */
function labelOf(svg: string): { text: string; font: number; x: number; y: number } {
  const m = /<text x="(\d+)" y="(\d+)"[^>]*font-size="(\d+)"[^>]*>([^<]+)<\/text>/.exec(svg);
  return { x: Number(m?.[1]), y: Number(m?.[2]), font: Number(m?.[3]), text: m?.[4] ?? '' };
}

function rects(svg: string): number {
  return svg.match(/<rect\b/g)?.length ?? 0;
}

describe('shots placeholders', () => {
  test('assets: a placeholder shot has a layer per needed face state', async () => {
    // Two chapters' needs of one two-shot: ally speaks at rest and in smile (ch1, ch2), is angry silently (ch2); bob is
    // seen from the back. The union decides which states exist (§2.6).
    const two = shot('cafe_two', 'two', [['ally', 'face'], ['bob', 'back']]);
    const faces = facesOf([need(two, { ally: [['neutral', true], ['smile', false]] }), need(two, { ally: [['smile', true], ['angry', false]] })]);
    expect([...(faces.get('ally' as CharId) ?? [])]).toEqual([['angry', false], ['neutral', true], ['smile', true]]);
    const layers = placeholderLayers(two, faces, CATALOG, PLATE);
    expect(layers.cast.map((m) => [m.char, m.view, [...m.exprs.keys()], m.hair.length])).toEqual([
      ['ally', 'face', ['neutral', 'angry', 'smile'], 1],
      ['bob', 'back', [], 1],
    ]);
    const ally = layers.cast[0];
    const smile = ally?.exprs.get('smile' as ExprId);
    // Every needed non-rest expression has its layer, its blink pair and accent; a spoken one its two mouths.
    expect(smile?.layer?.fill).toMatch(/^hsl\(160 /);
    expect([smile?.blink.half.fill, smile?.blink.closed.fill, smile?.accent.fill].every((f) => f?.startsWith('hsl(160 '))).toBe(true);
    expect(smile?.mouths?.length).toBe(2);
    expect(ally?.exprs.get('angry' as ExprId)?.mouths).toBeNull();
    expect(ally?.exprs.get('neutral' as ExprId)?.mouths?.length).toBe(2);
    // R9's inputs exist on placeholders too: a figure mask per member, a head mask per face member.
    expect(layers.cast.map((m) => [m.masks.fig !== null, m.masks.head !== null])).toEqual([[true, true], [true, false]]);
    // Every box is even and inside the plate.
    const boxes = layers.cast.flatMap((m) => [
      ...m.hair.map((h) => h.layer.box),
      ...[...m.exprs.values()].flatMap((x) => [x.layer?.box, x.blink.half.box, x.blink.closed.box, x.accent.box, ...(x.mouths ?? []).map((l) => l.box)]),
    ]);
    for (const b of boxes.filter((x) => x !== undefined)) {
      expect(b.every((n) => n % 2 === 0) && b[0] + b[2] <= PLATE.w && b[1] + b[3] <= PLATE.h, JSON.stringify(b)).toBe(true);
    }
    // The files of §2.6, each SVG carrying its own id as its label (L5 M3): no two files are the same bytes.
    const files = shotFiles(layers);
    expect([...files.keys()].sort()).toEqual(['face/cafe_two/ally/angry', 'face/cafe_two/ally/smile', 'sheet/cafe_two', 'talk/cafe_two/ally/neutral', 'talk/cafe_two/ally/smile']);
    const counts: Record<string, number> = {};
    for (const [id, file] of files) {
      const svg = shotFileSvg(file);
      expect(labelOf(svg).text, id).toBe(id);
      counts[id] = rects(svg);
    }
    // The sheet: two hair locks and ally's rest blink pair and accent; a face file: layer, blink pair, accent.
    expect(counts).toEqual({
      'sheet/cafe_two': 5,
      'face/cafe_two/ally/angry': 4,
      'face/cafe_two/ally/smile': 4,
      'talk/cafe_two/ally/neutral': 2,
      'talk/cafe_two/ally/smile': 2,
    });
    // O2: the smallest packed file (a wide-frame talk file) still draws its whole label inside its canvas at a font that
    // renders pixels (>= 6 px; the packer makes a file at least 0.6 × 6 px per label character wide, and 12 px high).
    const wideFiles = (id: string): ReadonlyMap<AssetId, PackedFile> => {
      const s = shot(id, 'wide', [['ally', 'face']]);
      return shotFiles(placeholderLayers(s, facesOf([need(s, { ally: [['neutral', true]] })]), CATALOG, PLATE));
    };
    const all = [...wideFiles('cafe').values()];
    const smallest = all.reduce((a, b) => (b.w * b.h < a.w * a.h ? b : a));
    expect(smallest.id).toBe('talk/cafe/ally/neutral');
    const label = labelOf(shotFileSvg(smallest));
    expect(label.font, JSON.stringify(label)).toBeGreaterThanOrEqual(6);
    expect(0.6 * label.font * smallest.id.length, `${smallest.w} px wide`).toBeLessThanOrEqual(smallest.w);
    expect(label.y > 0 && label.y <= smallest.h && label.x === smallest.w / 2, JSON.stringify({ label, w: smallest.w, h: smallest.h })).toBe(true);
    // Two talk files of one geometry and hue (two shots) rasterize to different pixels.
    const other = wideFiles('hall').get('talk/hall/ally/neutral' as AssetId);
    expect(other && [other.w, other.h]).toEqual([smallest.w, smallest.h]);
    const raw = (f: PackedFile): Promise<Buffer> => sharp(Buffer.from(shotFileSvg(f))).raw().toBuffer();
    const [a, b] = await Promise.all([raw(smallest), other === undefined ? Promise.resolve(Buffer.alloc(0)) : raw(other)]);
    expect(a.length).toBe(b.length);
    expect(Buffer.compare(a, b), 'the two talk files rasterize alike').not.toBe(0);
  });

  test('assets: a rest expression has no layer', () => {
    // A member only ever at rest: no face file, its blink and accent in the sheet; a talk file only where it speaks.
    const close = shot('cafe_cu', 'close', [['ally', 'face']]);
    const silent = placeholderLayers(close, facesOf([need(close, { ally: [['neutral', false]] })]), CATALOG, PLATE);
    const rest = silent.cast[0]?.exprs.get('neutral' as ExprId);
    expect(rest?.layer).toBeNull();
    expect(rest?.mouths).toBeNull();
    expect([rest?.blink.half.fill, rest?.accent.fill].every((f) => f?.startsWith('hsl(200 '))).toBe(true);
    expect([...shotFiles(silent).keys()]).toEqual(['sheet/cafe_cu']);
    const sheet = shotFiles(silent).get('sheet/cafe_cu' as AssetId);
    expect(sheet && rects(shotFileSvg(sheet))).toBe(4); // a hair lock, the rest blink pair, the rest accent
    const speaking = placeholderLayers(close, facesOf([need(close, { ally: [['neutral', true]] })]), CATALOG, PLATE);
    expect(speaking.cast[0]?.exprs.get('neutral' as ExprId)?.layer).toBeNull();
    expect([...shotFiles(speaking).keys()].sort()).toEqual(['sheet/cafe_cu', 'talk/cafe_cu/ally/neutral']);
    // A cast-less shot has no file at all.
    expect([...shotFiles(placeholderLayers(shot('hall', 'room', []), new Map(), CATALOG, PLATE)).keys()]).toEqual([]);
  });
});
