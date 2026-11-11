import { describe, expect, test } from 'vitest';

import type { Result } from '../../src/story/catalog.ts';
import type { Box } from '../../src/story/shots.ts';
import type { AssetId, BgId, ChapterId, CharId, ExprId } from '../../src/story/staging.ts';
import type { Shot } from '../story/shots/list.ts';
import type { ShotNeed } from '../story/shots/usage.ts';
import { decodeShotSource, depthGrid, extractShot, maskMoments } from './extract.ts';
import type { Extracted } from './extract.ts';
import { geometry, syntheticShot } from './fixtures/shot/synthetic.ts';
import type { SyntheticShot } from './fixtures/shot/synthetic.ts';
import { COARSE, packShot, shotFileRaster } from './shots.ts';
import type { ChapterNeed, ExprLayers, Raster, ShotLayers } from './shots.ts';

// ---------------------------------------------------------------------------------------------------------------
// The pure extraction (extract.ts, shots §4.2-4.3) over the synthetic `src` shot (fixtures/shot/synthetic.ts, 160 × 320).

/** `cafe`, a close-up of ally (rest neutral), as the shot list declares it. */
function cafe(figure = false): Shot {
  return { id: 'cafe' as BgId, loc: 'cafe' as Shot['loc'], frame: 'close', cast: [{ char: 'ally' as CharId, view: 'face', rest: 'neutral' as ExprId, figure }] };
}

/** One chapter's need of `cafe`: ally in each `[expr, talk]`, line IDs `<ch>.cafe.a00<i>`. */
function needOf(ch: string, faces: ReadonlyArray<readonly [string, boolean]>): ChapterNeed {
  const need = {
    cast: { ally: { view: 'face', rest: 'neutral', figure: false } },
    faces: { ally: faces.map(([expr, talk], i) => ({ expr, talk, lines: [`${ch}.cafe.a00${i}`] })) },
    frame: 'close',
    loc: 'cafe',
    camTargets: [],
    motions: [],
    room: null,
  } as unknown as ShotNeed; // literal ids of the fixture
  return { ch: ch as ChapterId, need };
}

/** Extracts the fixture with these needs; `loaded` records every file the extraction asked for. */
async function extract(fx: SyntheticShot, needs: readonly ChapterNeed[], loaded: string[] = []): Promise<Result<Extracted, string[]>> {
  const source = decodeShotSource(fx.json, 'cafe' as BgId);
  if (!source.ok) {
    throw new Error(`invariant: the fixture's shot.json decodes: ${source.error.join('; ')}`);
  }
  return extractShot({
    shot: cafe(),
    source: source.value,
    needs,
    load: (file) => {
      loaded.push(file);
      return Promise.resolve(fx.files.get(file) ?? null);
    },
    loadDepth: () => Promise.resolve(fx.depth),
  });
}

function layersOf(r: Result<Extracted, string[]>): ShotLayers<Raster> {
  if (!r.ok) {
    throw new Error(`invariant: the fixture extracts: ${r.error.join('; ')}`);
  }
  return r.value.layers;
}

function exprOf(layers: ShotLayers<Raster>, x: string): ExprLayers<Raster> {
  const e = layers.cast[0]?.exprs.get(x as ExprId);
  if (e === undefined) {
    throw new Error(`invariant: ally has ${x}`);
  }
  return e;
}

/** The px of raster `r` (original geometry) inside `[x, y, w, h]`, as the test reads them. */
function pxIn(r: Raster | undefined, [x, y, w, h]: Box): number[] {
  const out: number[] = [];
  for (let row = y; row < y + h; row++) {
    out.push(...(r?.data.subarray((row * (r.w ?? 0) + x) * 4, (row * (r.w ?? 0) + x + w) * 4) ?? []));
  }
  return out;
}

describe('extract', () => {
  test("assets: an expression's diff becomes one expression layer", async () => {
    // §4.2 step 2: smile changes the mouth and blushes both cheeks; its layer is the crop of ally.smile.png over the bbox
    // of everything it changes, dilated 4 px and evened, on the plate (the crop is the whole original here).
    const fx = syntheticShot();
    const g = geometry(fx.w, fx.h, 1);
    const layers = layersOf(await extract(fx, [needOf('ch1', [['neutral', false], ['smile', false]])]));
    const [left, right] = [g.cheeks[0] ?? [0, 0, 0, 0], g.cheeks[1] ?? [0, 0, 0, 0]];
    // x: the left cheek's left edge to the right cheek's right edge; y: the cheeks' top to the rest mouth's bottom.
    const box: Box = [left[0] - 4, left[1] - 4, right[0] + right[2] + 4 - (left[0] - 4), g.mouth[1] + g.mouth[3] + 4 - (left[1] - 4)];
    expect(box).toEqual([38, 94, 84, 32]);
    const smile = exprOf(layers, 'smile').layer;
    expect(smile?.box).toEqual(box);
    expect(smile?.masked).toBeUndefined();
    expect([...(smile?.fill.data ?? [])]).toEqual(pxIn(fx.files.get('ally.smile.png'), box));
    // The rest has no layer: the plate shows it.
    expect(exprOf(layers, 'neutral').layer).toBeNull();
  });

  test('assets: an expression that keeps the rest eyes reuses the rest blink', async () => {
    // §4.2 step 3 (rev. 4): smile leaves the rest blink and accent boxes as the plate shows them, so its blink pair and
    // accent are the rest's own layers, no file of its own is read, and the packer copies them into its face file.
    const loaded: string[] = [];
    const layers = layersOf(await extract(syntheticShot(), [needOf('ch1', [['neutral', false], ['smile', false]])], loaded));
    const [rest, smile] = [exprOf(layers, 'neutral'), exprOf(layers, 'smile')];
    expect(smile.blink.half).toBe(rest.blink.half);
    expect(smile.blink.closed).toBe(rest.blink.closed);
    expect(smile.accent).toBe(rest.accent);
    expect(loaded.filter((f) => f.startsWith('ally.smile.'))).toEqual(['ally.smile.png']);
    const pack = packShot(layers);
    const motion = pack.cast[0]?.exprs.get('smile' as ExprId)?.motion;
    expect([motion?.blink.half.file, motion?.blink.closed.file, motion?.accent.file]).toEqual(['face/cafe/ally/smile', 'face/cafe/ally/smile', 'face/cafe/ally/smile']);
    const face = pack.files.get('face/cafe/ally/smile' as AssetId);
    const copies = (face?.items ?? []).filter((i) => i.key.startsWith('ally/smile/blink.'));
    expect(copies.map((i) => [i.at, i.fill])).toEqual([
      [rest.blink.half.box, rest.blink.half.fill],
      [rest.blink.closed.box, rest.blink.closed.fill],
    ]);
    expect(pack.cast[0]?.exprs.get('neutral' as ExprId)?.motion.blink.half.file).toBe('sheet/cafe');
  });

  test('assets: a non-rest talk is cut against its expression', async () => {
    // §4.2 table: ally.smile.talk<n>.png's base is ally.smile.png, not the plate, so its box holds the mouth only (against
    // the plate it would span the blushed cheeks too). Smile changes the rest talk box, so it has its own mouths.
    const g = geometry(160, 320, 1);
    const layers = layersOf(await extract(syntheticShot(), [needOf('ch1', [['neutral', true], ['smile', true]])]));
    const [rest, smile] = [exprOf(layers, 'neutral'), exprOf(layers, 'smile')];
    const [o1, o2] = [g.open[0] ?? [0, 0, 0, 0], g.open[1] ?? [0, 0, 0, 0]];
    // The two open mouths' bbox (talk2's is the larger and holds talk1's), dilated 4.
    const mouth: Box = [o2[0] - 4, o2[1] - 4, o2[2] + 8, o2[3] + 8];
    expect(o1[0] >= o2[0] && o1[1] >= o2[1]).toBe(true);
    expect(mouth).toEqual([66, 110, 28, 20]);
    expect(smile.mouths?.map((m) => m.box)).toEqual([mouth, mouth]);
    expect(smile.mouths?.[0]).not.toBe(rest.mouths?.[0]);
    expect(mouth[0]).toBeGreaterThan((g.cheeks[0]?.[0] ?? 0) + (g.cheeks[0]?.[2] ?? 0));
    expect(smile.speaks).toBe(true);
  });

  test('assets: a relit expression fails registration', async () => {
    // R1 (rev. 2, W4): a variant equals its declared base outside its character's head mask dilated 8 px. ally.smile.png
    // relit by +12/255 everywhere (a whole-frame relight) changes every px there; the count is checked by brute force.
    const needs = [needOf('ch1', [['neutral', false], ['smile', false]])];
    expect(await extract(syntheticShot(), needs)).toMatchObject({ ok: true });
    const fx = syntheticShot({ relight: 12 });
    const head = fx.files.get('mask.head.ally.png');
    const inHead = (x: number, y: number): boolean => (head?.data[(y * fx.w + x) * 4 + 3] ?? 0) > 0;
    let outside = 0;
    for (let y = 0; y < fx.h; y++) {
      for (let x = 0; x < fx.w; x++) {
        let near = false;
        for (let dy = -8; dy <= 8 && !near; dy++) {
          for (let dx = -8; dx <= 8 && !near; dx++) {
            near = x + dx >= 0 && x + dx < fx.w && y + dy >= 0 && y + dy < fx.h && inHead(x + dx, y + dy);
          }
        }
        outside += near ? 0 : 1;
      }
    }
    expect(outside).toBeGreaterThan(0);
    const r = await extract(fx, needs);
    expect(r.ok ? [] : r.error).toEqual([
      `cafe: ally.smile.png changes ${outside} px outside ally's head mask dilated 8 px, the first at (0, 0) (R1: a variant equals its base there)`,
    ]);
  });

  test('assets: overlapping motion boxes fail', async () => {
    // R2 (rev. 3, m7, cut D6): the motion layers used together on one expression (blink, accent, talk where spoken) whose
    // boxes overlap are tested by their diffs: the rest talk mouths drawn 3 px under the left eye touch the rest blink.
    const needs = [needOf('ch1', [['neutral', true]])];
    expect(await extract(syntheticShot(), needs)).toMatchObject({ ok: true }); // disjoint boxes
    const r = await extract(syntheticShot({ talkNearBlink: true }), needs);
    expect(r.ok ? [] : r.error).toEqual([
      'cafe: ally in neutral: the talk and blink diffs are within 4 px (R2: motion layers used together never touch; lines ch1.cafe.a000)',
    ]);
  });

  test('assets: a diff clipped at the plate edge fails', async () => {
    // R3 (rev. 2): a layer box is bbox(diff) dilated 4, clipped to the crop and to the head mask's bbox dilated 8; a
    // changed px outside the clipped box would be lost. The crop [46, 0, 114, 320] cuts smile's left cheek (x 42..51).
    const needs = [needOf('ch1', [['neutral', false], ['smile', false]])];
    expect(await extract(syntheticShot(), needs)).toMatchObject({ ok: true }); // the same diff inside the crop
    const r = await extract(syntheticShot({ crop: [46, 0, 114, 320] }), needs);
    const g = geometry(160, 320, 1);
    const [cx, cy, cw, chh] = g.cheeks[0] ?? [0, 0, 0, 0];
    const lost = (46 - cx) * chh;
    expect(cw).toBeGreaterThan(46 - cx);
    expect(r.ok ? [] : r.error).toEqual([
      `cafe: ally.smile.png changes ${lost} px outside its box on the plate, the first at (${cx}, ${cy}) (R3: a box clipped to the plate and the head loses no changed px)`,
    ]);
  });

  test('assets: a cut-out not inpainted in the plate fails', async () => {
    // R7: a cut-out's region is inpainted in the plate (the plate differs from the original inside the mask's core by a
    // mean > 8/255); a hair lock painted into the plate too would reveal itself when the lock sways.
    const needs = [needOf('ch1', [['neutral', false]])];
    expect(await extract(syntheticShot(), needs)).toMatchObject({ ok: true }); // inpainted (the green half)
    const r = await extract(syntheticShot({ inpainted: false }), needs);
    expect(r.ok ? [] : r.error).toEqual([
      'cafe: mask.hair.ally.0.png is not inpainted in plate.png (R7: its core differs from original.png by a mean of 0.0/255, not over 8)',
    ]);
  });

  test('assets: an expression that changes the eyes needs its own blink', async () => {
    // R4 with the reuse rule (§4.2 step 3, W4 b): surprised widens the eyes, so its diff meets the rest blink box E and
    // the rest blink no longer composites to surprised: its own blink pair is needed, named with ch2's lines; supplied,
    // it is cut against ally.surprised.png.
    const needs = [needOf('ch2', [['surprised', false]])];
    const without = await extract(syntheticShot({ missing: ['ally.surprised.half.png', 'ally.surprised.closed.png'] }), needs);
    expect(without.ok ? [] : without.error).toEqual([
      'cafe: ally.surprised.half.png missing (R4: a needed state; lines ch2.cafe.a000)',
      'cafe: ally.surprised.closed.png missing (R4: a needed state; lines ch2.cafe.a000)',
    ]);
    const fx = syntheticShot();
    const layers = layersOf(await extract(fx, needs));
    const [rest, surprised] = [exprOf(layers, 'neutral'), exprOf(layers, 'surprised')];
    expect(surprised.blink.half).not.toBe(rest.blink.half);
    // Its lids against its own wide eyes (2 units taller each side): the wide eyes' bbox, dilated 4.
    const g = geometry(160, 320, 1);
    const [l, r] = [g.wide[0] ?? [0, 0, 0, 0], g.wide[1] ?? [0, 0, 0, 0]];
    const box: Box = [l[0] - 4, l[1] - 4, r[0] + r[2] + 4 - (l[0] - 4), l[3] + 8];
    expect(box).toEqual([46, 70, 68, 20]);
    expect([surprised.blink.half.box, surprised.blink.closed.box]).toEqual([box, box]);
    expect([...surprised.blink.closed.fill.data]).toEqual(pxIn(fx.files.get('ally.surprised.closed.png'), box));
    // The brows are untouched: the rest accent is reused.
    expect(surprised.accent).toBe(rest.accent);
  });

  test('assets: a needed state missing from the source fails with its line IDs', async () => {
    // R4: every needed state exists as a file; the message names the file and every line that shows the character in
    // that expression (both chapters'), or, for a rest state no line shows, the chapters that show the shot.
    const needs = [needOf('ch1', [['neutral', false], ['smile', false]]), needOf('ch2', [['smile', true]])];
    const r = await extract(syntheticShot({ missing: ['ally.smile.png'] }), needs);
    expect(r.ok ? [] : r.error).toEqual(['cafe: ally.smile.png missing (R4: a needed state; lines ch1.cafe.a001, ch2.cafe.a000)']);
    const rest = await extract(syntheticShot({ missing: ['ally.half.png'] }), [needOf('ch2', [['surprised', false]])]);
    expect(rest.ok ? [] : rest.error).toEqual(['cafe: ally.half.png missing (R4: a needed state; chapters ch2)']);
  });

  test('assets: overlapping blink and accent boxes are cut as masked layers', async () => {
    // §4.2 step 7b (rev. 3, m7; critique O4): angry lowers the brow (its diff misses the rest blink box E, so the rest
    // blink is reused) and its own accent lowers it further: the accent's box overlaps E while the two diffs stay 6 px
    // apart. Both layers are masked: alpha 255 within 2 px of the layer's own diff, 170 at 3, 85 at 4, 0 beyond. The rest
    // blink is one Layer, so it is masked wherever it is used (exact: angry equals the plate inside E).
    const fx = syntheticShot();
    const layers = layersOf(await extract(fx, [needOf('ch1', [['neutral', false], ['angry', false]])]));
    const [rest, angry] = [exprOf(layers, 'neutral'), exprOf(layers, 'angry')];
    expect(angry.blink.half).toBe(rest.blink.half);
    expect(angry.accent).not.toBe(rest.accent);
    expect([angry.accent.masked, angry.blink.half.masked, angry.blink.closed.masked]).toEqual([true, true, true]);
    expect([rest.accent.masked, angry.layer?.masked]).toEqual([undefined, undefined]);
    // The accent's alpha, against its diff from ally.angry.png read here by brute force over its box.
    const [bx, by, bw, bh] = angry.accent.box;
    const [v, base] = [fx.files.get('ally.angry.accent.png'), fx.files.get('ally.angry.png')];
    const changedAt = (x: number, y: number): boolean => {
      const o = (y * fx.w + x) * 4;
      return [0, 1, 2, 3].some((k) => Math.abs((v?.data[o + k] ?? 0) - (base?.data[o + k] ?? 0)) > 2);
    };
    const levels = new Map<number, number>();
    for (let y = by; y < by + bh; y++) {
      for (let x = bx; x < bx + bw; x++) {
        let d = 5;
        for (let qy = y - 4; qy <= y + 4; qy++) {
          for (let qx = x - 4; qx <= x + 4; qx++) {
            if (qx >= bx && qy >= by && qx < bx + bw && qy < by + bh && changedAt(qx, qy)) {
              d = Math.min(d, Math.max(Math.abs(qx - x), Math.abs(qy - y)));
            }
          }
        }
        const alpha = d <= 2 ? 255 : d === 3 ? 170 : d === 4 ? 85 : 0;
        const got = angry.accent.fill.data[((y - by) * bw + (x - bx)) * 4 + 3];
        expect(got, `alpha at (${x}, ${y}), ${d} px from the diff`).toBe(alpha);
        levels.set(alpha, (levels.get(alpha) ?? 0) + 1);
      }
    }
    expect([...levels.keys()].sort((a, b) => a - b)).toEqual([0, 85, 170, 255]);
    // The packed members say so, and the face file's px carry that alpha.
    const pack = packShot(layers);
    const motion = pack.cast[0]?.exprs.get('angry' as ExprId)?.motion;
    expect([motion?.accent.masked, motion?.blink.half.masked, motion?.blink.closed.masked]).toEqual([true, true, true]);
    expect(pack.cast[0]?.exprs.get('neutral' as ExprId)?.motion.blink.half).toMatchObject({ file: 'sheet/cafe', masked: true });
    expect(pack.cast[0]?.exprs.get('neutral' as ExprId)?.motion.accent.masked).toBeUndefined();
    const file = pack.files.get('face/cafe/ally/angry' as AssetId);
    const item = file?.items.find((i) => i.key === 'ally/angry/accent');
    expect(item?.masked).toBe(true);
    const composed = file === undefined ? undefined : shotFileRaster(file);
    const [fx0, fy0] = item?.frame ?? [0, 0];
    const alphaIn = (r: Raster | undefined, x: number, y: number, w: number): number => r?.data[(y * w + x) * 4 + 3] ?? -1;
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        expect(alphaIn(composed, fx0 + x, fy0 + y, composed?.w ?? 0)).toBe(alphaIn(angry.accent.fill, x, y, bw));
      }
    }
  });

  test('assets: touching blink and accent diffs ask for the joint states', async () => {
    // §4.2 step 7b, R2 (m7): angry's accent brow 3 px above the lids: masking cannot keep the reused blink from drawing
    // the brow back, so the tool asks for the joint states (blink drawn on the accent state), named with the lines;
    // supplied, they are cut against ally.angry.accent.png and packed in angry's face file as its motion's `joint`.
    const needs = [needOf('ch1', [['neutral', false], ['angry', false]])];
    const missing = await extract(syntheticShot({ angryAccent: 'touching', missing: ['ally.angry.accent.half.png', 'ally.angry.accent.closed.png'] }), needs);
    expect(missing.ok ? [] : missing.error).toEqual([
      'cafe: ally in angry: the blink and accent diffs are within 4 px (R2: draw the joint states ally.angry.accent.half.png and ally.angry.accent.closed.png; lines ch1.cafe.a001)',
    ]);
    const fx = syntheticShot({ angryAccent: 'touching' });
    const layers = layersOf(await extract(fx, needs));
    const angry = exprOf(layers, 'angry');
    const g = geometry(160, 320, 1);
    const [l, r] = [g.eyes[0] ?? [0, 0, 0, 0], g.eyes[1] ?? [0, 0, 0, 0]];
    const joint: Box = [l[0] - 4, l[1] - 4, r[0] + r[2] + 4 - (l[0] - 4), l[3] + 8]; // the closed lids' bbox, dilated 4
    expect([angry.joint?.half.box, angry.joint?.closed.box]).toEqual([joint, joint]);
    expect([...(angry.joint?.closed.fill.data ?? [])]).toEqual(pxIn(fx.files.get('ally.angry.accent.closed.png'), joint));
    expect(exprOf(layers, 'neutral').joint).toBeUndefined();
    const motion = packShot(layers).cast[0]?.exprs.get('angry' as ExprId)?.motion;
    expect([motion?.joint?.half.file, motion?.joint?.closed.file]).toEqual(['face/cafe/ally/angry', 'face/cafe/ally/angry']);
  });

  test('assets: a depth map is sampled onto the grid through the crop, white near', () => {
    // §4.2 step 6 (cut D12, critique W4): a vertical ramp depth.png of 64 × 128 (white = near at the bottom) under the
    // crop [40, 96, 160, 320] of a 240 × 480 original. Vertex row j sits at plate y = j / 23 × 320, original y + 96, depth
    // row (y × 128 / 480 − 0.5) at px centres; a linear ramp reads back that row's own value.
    const [W, H, dw, dh] = [240, 480, 64, 128];
    const crop: Box = [40, 96, 160, 320];
    const expected = (j: number): number => {
      const sy = Math.min(dh - 1, Math.max(0, ((crop[1] + (j / (COARSE.rows - 1)) * crop[3]) * dh) / H - 0.5));
      return Math.round((255 * sy) / (dh - 1));
    };
    expect([expected(0), expected(COARSE.rows - 1)]).toEqual([50, 222]);
    for (const max of [65535, 255] as const) {
      const data = new Uint16Array(dw * dh);
      for (let y = 0; y < dh; y++) {
        data.fill(Math.round((max * y) / (dh - 1)), y * dw, (y + 1) * dw);
      }
      const grid = depthGrid({ data, w: dw, h: dh, max }, crop, { w: W, h: H });
      expect(grid.length).toBe(COARSE.cols * COARSE.rows);
      const row = (j: number): number[] => [...grid.subarray(j * COARSE.cols, (j + 1) * COARSE.cols)];
      for (const j of [0, COARSE.rows - 1]) {
        expect(row(j).every((v) => Math.abs(v - expected(j)) <= 1), `${max}: row ${j} = ${row(j).join(',')}`).toBe(true);
      }
      for (let j = 0; j < COARSE.rows; j++) {
        expect(new Set(row(j)).size, `${max}: row ${j} is constant along x`).toBe(1);
        if (j > 0) {
          expect(row(j)[0] ?? 0, `${max}: row ${j} is nearer than row ${j - 1}`).toBeGreaterThan(row(j - 1)[0] ?? 0);
        }
      }
    }
  });

  test("assets: a figure mask's moments give its body ellipse and feet", () => {
    // §4.2 step 5 (cut D13, critique W4): a solid ellipse of semi-axes 60 and 24, rotated 0.5 rad, centred at (150, 170)
    // of a 320 × 360 original, under the crop [20, 10, 300, 340]. Its moments: the centre in plate px, 2σ = the semi-axis
    // along each principal axis (σ = r / 2 for a solid ellipse), the major axis's angle in radians, the lowest row's
    // centroid as the feet.
    const [W, H, a, b, rot] = [320, 360, 60, 24, 0.5];
    const crop: Box = [20, 10, 300, 340];
    const data = new Uint8Array(W * H * 4);
    const inside = (x: number, y: number): boolean => {
      const [dx, dy] = [x + 0.5 - 150, y + 0.5 - 170];
      const [u, v] = [dx * Math.cos(rot) + dy * Math.sin(rot), -dx * Math.sin(rot) + dy * Math.cos(rot)];
      return (u / a) ** 2 + (v / b) ** 2 <= 1;
    };
    let lowest = -1;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (inside(x, y)) {
          data.set([255, 255, 255, 255], (y * W + x) * 4);
          lowest = y;
        }
      }
    }
    const lowXs = Array.from({ length: W }, (_, x) => x).filter((x) => inside(x, lowest));
    const m = maskMoments({ data, w: W, h: H }, crop);
    expect(m).not.toBeNull();
    expect(Math.abs((m?.fig.cx ?? 0) - 130)).toBeLessThanOrEqual(0.5);
    expect(Math.abs((m?.fig.cy ?? 0) - 160)).toBeLessThanOrEqual(0.5);
    expect(m?.fig.rx ?? 0).toBeGreaterThan(m?.fig.ry ?? 0);
    expect(Math.abs((m?.fig.rx ?? 0) / a - 1)).toBeLessThanOrEqual(0.08);
    expect(Math.abs((m?.fig.ry ?? 0) / b - 1)).toBeLessThanOrEqual(0.08);
    const off = ((((m?.fig.rot ?? 0) - rot) % Math.PI) + Math.PI * 1.5) % Math.PI - Math.PI / 2;
    expect(Math.abs(off), `rot ${m?.fig.rot} against ${rot} rad`).toBeLessThanOrEqual(0.02);
    const feetX = lowXs.reduce((sum, x) => sum + x + 0.5, 0) / lowXs.length - crop[0];
    expect(m?.feet).toEqual([feetX, lowest + 0.5 - crop[1]]);
    expect(lowest).toBeGreaterThan(170);
  });
});
