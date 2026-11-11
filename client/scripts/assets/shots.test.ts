import sharp from 'sharp';
import { describe, expect, test } from 'vitest';

import type { AssetCatalog } from '../../src/story/catalog.ts';
import type { AssetId, BgId, CharId, ExprId } from '../../src/story/staging.ts';
import type { Shot } from '../story/shots/list.ts';
import type { ShotNeed } from '../story/shots/usage.ts';
import type { Box } from '../../src/story/shots.ts';
import {
  COARSE,
  FINE,
  bandOf,
  castProblems,
  depthBase64,
  facesOf,
  headGroups,
  placeholderDepth,
  placeholderLayers,
  plateProblems,
  plateauBits,
  plateauOf,
  shotFiles,
  shotFileSvg,
} from './shots.ts';
import type { CastLayers, Lattice, PackedFile, ShotLayers } from './shots.ts';

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

// ---------------------------------------------------------------------------------------------------------------
// §4.2 step 5 and §4.3: R5, the head plateau on both lattices, head groups, R9, the placeholder depth grid.

/** A face member's head regions, as §4.2 step 5 lists them: the head mask, every face layer box, every hair root. */
function headRegions(m: CastLayers): Box[] {
  const states = [...m.exprs.values()].flatMap((x) => [x.layer, x.blink.half, x.blink.closed, x.accent, ...(x.mouths ?? [])]);
  return [
    ...(m.masks.head === null ? [] : [m.masks.head]),
    ...states.flatMap((l) => (l === null ? [] : [l.box])),
    ...m.hair.map((h): Box => [h.pivot[0], h.pivot[1], 0, 0]),
  ];
}

/** The vertex `k`'s plate position on lattice `l`. */
function vertex(k: number, l: Lattice, w: number, h: number): readonly [number, number] {
  return [((k % l.cols) * w) / (l.cols - 1), (Math.floor(k / l.cols) * h) / (l.rows - 1)];
}

function decodeBits(b64: string, n: number): Set<number> {
  const bytes = Buffer.from(b64, 'base64');
  const out = new Set<number>();
  for (let k = 0; k < n; k++) {
    if (((bytes[k >> 3] ?? 0) & (0x80 >> (k & 7))) !== 0) {
      out.add(k);
    }
  }
  return out;
}

/** A face member at rest whose head mask is `head`, one hair lock rooted at its top centre, one small face box. */
function headAt(char: string, head: Box): CastLayers {
  const l = { box: [head[0] + 20, head[1] + 20, 40, 20] as Box, fill: 'hsl(0 0% 0%)' };
  return {
    char: char as CharId,
    view: 'face',
    rest: 'neutral' as ExprId,
    masks: { fig: { cx: head[0] + head[2] / 2, cy: 1400, rx: 100, ry: 600, rot: 0 }, head },
    hair: [{ layer: { box: [head[0], head[1], 40, 40], fill: l.fill }, pivot: [head[0] + head[2] / 2, head[1]] }],
    figure: null,
    exprs: new Map([['neutral' as ExprId, { layer: null, blink: { half: l, closed: l }, accent: l, mouths: null, speaks: false }]]),
  };
}

describe('shots checks', () => {
  test('assets: a plate that is not 2048 high fails', () => {
    // R5: h = 2048, w even in [1080, 1440]; a `room` plate exactly 1080 × 2048. The message names the shot.
    const cases: ReadonlyArray<readonly [Shot['frame'], number, number, boolean]> = [
      ['wide', 1080, 2046, false],
      ['wide', 1081, 2048, false],
      ['wide', 1442, 2048, false],
      ['wide', 1078, 2048, false],
      ['room', 1440, 2048, false],
      ['room', 1080, 2046, false],
      ['wide', 1080, 2048, true],
      ['close', 1440, 2048, true],
      ['two', 1200, 2048, true],
      ['room', 1080, 2048, true],
    ];
    for (const [frame, w, h, ok] of cases) {
      const found = plateProblems('cafe' as BgId, frame, w, h);
      expect(found, `${frame} ${w} × ${h}`).toHaveLength(ok ? 0 : 1);
      for (const p of found) {
        expect(p, `${frame} ${w} × ${h}`).toMatch(new RegExp(`^cafe: .*${w} × ${h}.*\\(R5`));
      }
    }
  });

  test('assets: the head plateau covers the head mask and every face layer box with one cell of margin', () => {
    // §4.2 step 5 (rev. 3, W3): every vertex of a cell touching the head mask, a face layer box or a hair root, dilated
    // by one cell, on the 25 × 47 lattice (a cell 45 × 44.5 px on 1080 × 2048, scaled with the plate) and on 13 × 24.
    const close = shot('cafe_cu', 'close', [['ally', 'face']]);
    for (const plate of [PLATE, { w: 1440, h: 2048 }]) {
      const layers = placeholderLayers(close, facesOf([need(close, { ally: [['neutral', true], ['smile', true]] })]), CATALOG, plate);
      const ally = layers.cast[0];
      if (ally === undefined) {
        throw new Error('invariant: the fixture has a cast');
      }
      for (const [l, chars] of [[FINE, 196], [COARSE, 52]] as const) {
        const v = plateauOf(ally, plate, l);
        const [cw, ch] = [plate.w / (l.cols - 1), plate.h / (l.rows - 1)];
        let cells = 0;
        for (const [bx, by, bw, bh] of headRegions(ally)) {
          for (let i = 0; i < l.cols - 1; i++) {
            for (let j = 0; j < l.rows - 1; j++) {
              if ((i + 1) * cw < bx || i * cw > bx + bw || (j + 1) * ch < by || j * ch > by + bh) {
                continue;
              }
              cells += 1;
              // The cell's four corners and every vertex one cell around them.
              for (let di = -1; di <= 2; di++) {
                for (let dj = -1; dj <= 2; dj++) {
                  const [vi, vj] = [i + di, j + dj];
                  if (vi >= 0 && vi < l.cols && vj >= 0 && vj < l.rows) {
                    expect(v.has(vj * l.cols + vi), `${plate.w}: ${l.cols} × ${l.rows} vertex ${vi},${vj} around cell ${i},${j}`).toBe(true);
                  }
                }
              }
            }
          }
        }
        expect(cells, 'non-vacuous').toBeGreaterThan(4);
        // The plateau is the head's, not the whole frame: the plate's bottom corners stay out.
        expect([v.has(l.cols * (l.rows - 1)), v.has(l.cols * l.rows - 1)]).toEqual([false, false]);
        const bits = plateauBits(v, l);
        expect(bits).toHaveLength(chars);
        expect(decodeBits(bits, l.cols * l.rows)).toEqual(v);
      }
    }
  });

  test('assets: two heads closer than their bands form one head group', () => {
    // §4.2 step 5: the band f = max(60, 0.25 × the head mask's bbox width); two plateaus within max(f_a, f_b) are one
    // group, transitively; groups are numbered in draw order.
    expect(bandOf(headAt('a', [100, 400, 160, 200]))).toBe(60);
    expect(bandOf(headAt('a', [100, 400, 400, 200]))).toBe(100);
    const layers = (heads: readonly Box[]): ShotLayers => ({
      shot: 'cafe' as BgId,
      frame: 'two',
      w: 1080,
      h: 2048,
      cast: heads.map((b, i) => headAt(`c${i}`, b)),
    });
    // A and C are far apart; B sits close to both: one group by transitivity.
    const [a, b, c]: Box[] = [[60, 400, 160, 200], [340, 400, 160, 200], [620, 400, 160, 200]];
    expect(headGroups(layers([a, b, c] as Box[]))).toEqual([0, 0, 0]);
    expect(headGroups(layers([a, c] as Box[]))).toEqual([0, 1]);
    // Against the rule itself: across offsets, two heads join exactly when their plateaus come within the larger band.
    const dist = (p: ReadonlySet<number>, q: ReadonlySet<number>): number => {
      let best = Infinity;
      for (const s of p) {
        for (const t of q) {
          const [[px, py], [qx, qy]] = [vertex(s, FINE, 1080, 2048), vertex(t, FINE, 1080, 2048)];
          best = Math.min(best, Math.hypot(px - qx, py - qy));
        }
      }
      return best;
    };
    let [joinedApart, separate] = [0, 0];
    for (let x = 240; x <= 880; x += 20) {
      const l = layers([[60, 400, 400, 200], [x, 400, 160, 200]]);
      const [pa, pb] = l.cast.map((m) => plateauOf(m, { w: 1080, h: 2048 }, FINE));
      const d = dist(pa ?? new Set(), pb ?? new Set());
      const joined = d <= 100; // max(100, 60)
      expect(headGroups(l), `B at x ${x}, plateaus ${d.toFixed(1)} px apart`).toEqual(joined ? [0, 0] : [0, 1]);
      joinedApart += joined && d > 0 ? 1 : 0;
      separate += joined ? 0 : 1;
    }
    expect([joinedApart > 0, separate > 0], 'both outcomes seen, a join without overlap among them').toEqual([true, true]);
  });

  test('assets: a cast member without a hair lock fails', () => {
    // R9 (rev. 3, W4): every cast member has a hair lock and a figure mask; every face member a head mask.
    const two = shot('cafe_two', 'two', [['ally', 'face'], ['bob', 'back']]);
    const layers = placeholderLayers(two, facesOf([need(two, { ally: [['neutral', true]] })]), CATALOG, PLATE);
    expect(castProblems(layers)).toEqual([]); // control: placeholders satisfy R9
    const without = (char: string, change: (m: CastLayers) => CastLayers): ShotLayers => ({
      ...layers,
      cast: layers.cast.map((m) => (m.char === char ? change(m) : m)),
    });
    expect(castProblems(without('ally', (m) => ({ ...m, hair: [] })))).toEqual(['cafe_two: ally has no hair lock (R9: every cast member has one)']);
    expect(castProblems(without('bob', (m) => ({ ...m, hair: [] })))).toEqual(['cafe_two: bob has no hair lock (R9: every cast member has one)']);
    expect(castProblems(without('ally', (m) => ({ ...m, masks: { ...m.masks, head: null } })))).toEqual(['cafe_two: ally has no head mask (R9: every face member has one)']);
  });

  test('assets: a back-view member without a figure mask fails', () => {
    const two = shot('cafe_two', 'two', [['ally', 'face'], ['bob', 'back']]);
    const layers = placeholderLayers(two, facesOf([need(two, { ally: [['neutral', false]] })]), CATALOG, PLATE);
    const noFig: ShotLayers = { ...layers, cast: layers.cast.map((m) => (m.char === 'bob' ? { ...m, masks: { ...m.masks, fig: null } } : m)) };
    expect(castProblems(noFig)).toEqual(['cafe_two: bob has no figure mask (R9: every cast member has one)']);
    expect(castProblems(layers)).toEqual([]);
    // A back view needs no head mask: none is synthesized for it, and none is asked.
    expect(layers.cast.find((m) => m.char === 'bob')?.masks.head).toBeNull();
  });

  test("assets: a placeholder room's depth grid is far at the top and near at the floor", () => {
    // §4.2 step 8 (rev. 4, m2): n(y) = clamp((y/h - 0.35)/0.65, 0, 1) at the 13 × 24 lattice's vertices, row i at
    // y = i/(rows-1) × h (vertex sampling, RULINGS 254), quantised to u8, base64.
    const grid = placeholderDepth();
    expect(grid).toHaveLength(13 * 24);
    const rows = Array.from({ length: 24 }, (_, i) => [...grid.slice(i * 13, i * 13 + 13)]);
    for (const [i, row] of rows.entries()) {
      expect(new Set(row).size, `row ${i} is one depth`).toBe(1);
      expect(row[0], `row ${i}`).toBe(Math.round(255 * Math.min(1, Math.max(0, (i / 23 - 0.35) / 0.65))));
    }
    expect(rows.slice(0, 9).flat().every((n) => n === 0), 'the top 35 %: a far wall at 0').toBe(true);
    expect(rows[23]?.every((n) => n === 255), 'the floor at the bottom edge: 255').toBe(true);
    expect(rows.every((row, i) => i === 0 || (row[0] ?? 0) >= (rows[i - 1]?.[0] ?? 0)), 'monotone').toBe(true);
    // A bilinear read at the cellar `star` hotspot's centre (y 1,300 of 2,048): n ≈ 0.44, F11's precondition (SH8).
    const at = (y: number): number => {
      const r = (y / 2048) * 23;
      const [lo, hi] = [rows[Math.floor(r)]?.[6] ?? 0, rows[Math.ceil(r)]?.[6] ?? 0];
      return (lo + (hi - lo) * (r - Math.floor(r))) / 255;
    };
    expect(at(1300)).toBeCloseTo(0.44, 2);
    expect(depthBase64(grid)).toHaveLength(416);
    expect([...Buffer.from(depthBase64(grid), 'base64')]).toEqual([...grid]);
  });
});
