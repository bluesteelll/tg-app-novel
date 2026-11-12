// The shot view (docs/plans/shots §5.1-5.2, lane SH4): rest framing, zoom range, the face plan and a stage's slots.
import { expect, test, vi } from 'vitest';

import { cover } from '../geom/cover.ts';
import type { Size } from '../geom/cover.ts';
import type { AssetManifest } from '../story/catalog.ts';
import type { Box, CastRig, Member, MotionSet, ShotRig } from '../story/shots.ts';
import type { AssetId, BgId, ChapterId, CharId, ExprId } from '../story/staging.ts';
import type { SceneSnapshot } from './executor.ts';
import { backdropPlacement } from './layout.ts';
import { chapterRigs, faceLayers, overscan, restFraming, shotSlots, slack, zoomRange } from './shot-view.ts';

// Fixture rigs as the manifest decoder types them; the brands are earned by the decoder in production.
const id = (s: string): AssetId => s as AssetId;
const mem = (file: string, frame: Box, at: Box): Member => ({ file: id(file), frame, at });
const motion = (shot: string, c: string, x: string, talk: number): MotionSet => {
  const f = `face/${shot}/${c}/${x}`;
  return {
    blink: { half: mem(f, [0, 0, 40, 20], [500, 600, 40, 20]), closed: mem(f, [40, 0, 40, 20], [500, 600, 40, 20]) },
    talk: Array.from({ length: talk }, (_, i) => mem(`talk/${shot}/${c}/${x}`, [i * 30, 0, 30, 20], [520, 680, 30, 20])),
    accent: mem(f, [80, 0, 60, 20], [490, 560, 60, 20]),
  };
};
/** A face member of `shot`: rest `neutral` (talk), `smile` (a layer, talk), `worried` (a layer, no talk). */
function faceMember(shot: string, c: string, at: Box, figure = false): CastRig & { char: CharId } {
  const layer = (x: string): Member => mem(`face/${shot}/${c}/${x}`, [0, 40, at[2], at[3]], at);
  return {
    char: c as CharId,
    view: 'face',
    face: {
      rest: 'neutral' as ExprId,
      exprs: {
        ['neutral' as ExprId]: { layer: null, motion: motion(shot, c, 'neutral', 2) },
        ['smile' as ExprId]: { layer: layer('smile'), motion: motion(shot, c, 'smile', 1) },
        ['worried' as ExprId]: { layer: layer('worried'), motion: motion(shot, c, 'worried', 0) },
      },
      head: at,
    },
    body: { cx: 540, cy: 1300, rx: 200, ry: 600, rot: 0, feet: [540, 1900] },
    headDepth: 0.5,
    plateau: '',
    plateauCoarse: '',
    band: 40,
    group: 0,
    figure: figure ? mem(`sheet/${shot}`, [0, 200, 400, 1400], [340, 500, 400, 1400]) : null,
    hair: [{ member: mem(`sheet/${shot}`, [0, 0, 200, 120], [at[0], at[1] - 60, 200, 120]), pivot: [at[0] + 100, at[1]] }],
  };
}
function rig(frame: ShotRig['frame'], cast: ShotRig['cast'] = [], focus: readonly [number, number] = [540, 1024]): ShotRig {
  return { w: 1080, h: 2048, frame, focus, cast, planes: [], ambient: [], depth: '' };
}
const CU = rig('close', [faceMember('cu', 'ally', [480, 520, 160, 200])]);
const TWO = rig('two', [faceMember('two', 'ally', [200, 520, 160, 200]), faceMember('two', 'stranger', [700, 500, 160, 200])]);
const stageOn = (bg: string, chars: Array<[string, string]> = []): SceneSnapshot => ({
  bg: bg as BgId,
  cg: null,
  chars: chars.map(([char, expr]) => ({ char: char as CharId, expr: expr as ExprId, at: 'center' })),
  props: [],
});
const faces = (...xs: Array<[string, string]>): ReadonlyMap<CharId, ExprId> => new Map(xs.map(([c, x]) => [c as CharId, x as ExprId]));

/** §5.4's table: the stage in CSS px and its render resolution, min(DPR, 2). */
const TABLE: ReadonlyArray<{ stage: Size; r: number; half: boolean }> = [
  { stage: { w: 390, h: 844 }, r: 2, half: false },
  { stage: { w: 412, h: 915 }, r: 2, half: false },
  { stage: { w: 360, h: 800 }, r: 1, half: true },
  { stage: { w: 405, h: 720 }, r: 1, half: false },
  { stage: { w: 787, h: 1400 }, r: 1.5, half: false },
];

test("shot-view: a room's rest framing equals cover()", () => {
  const room = rig('room', [], [100, 300]);
  for (const { stage, r, half } of TABLE) {
    const c = backdropPlacement(stage);
    // Centred whatever the focus: a room's frame is exactly the hotspot and props mapping.
    expect(restFraming(room, stage, r, half), `${stage.w} x ${stage.h}`).toEqual({ x: c.offsetX, y: c.offsetY, k: c.scale });
    expect(overscan(room, stage, r, half)).toBe(1);
  }
});

test('shot-view: a 1080 plate covers the 9:16 stage by width', () => {
  const stage = { w: 405, h: 720 };
  const x = restFraming(CU, stage, 1, false);
  // 405 / 1080 = 0.375 > 720 / 2048 = 0.352: the width decides, times the overscan.
  expect(x.k).toBeCloseTo((405 / 1080) * 1.03, 12);
  expect(1080 * x.k).toBeGreaterThan(stage.w);
  expect(2048 * x.k).toBeGreaterThan(stage.h);
  // The plate covers the stage on both axes: no edge shows.
  expect(x.x).toBeLessThanOrEqual(0);
  expect(x.y).toBeLessThanOrEqual(0);
  expect(x.x + 1080 * x.k).toBeGreaterThanOrEqual(stage.w);
  expect(x.y + 2048 * x.k).toBeGreaterThanOrEqual(stage.h);
});

test("shot-view: a shot's overscan is 1.03 and never above 1 / k_dev", () => {
  const kDev = (stage: Size, r: number, half: boolean): number => cover(stage, { w: 1080, h: 2048 }).scale * r * (half ? 2 : 1);
  // Every phone of the table zooms 1.03; the desktop stage at DPR 1.5 would need a zoom-out (1 / k_dev = 0.915): 1.
  expect(TABLE.map(({ stage, r, half }) => overscan(CU, stage, r, half))).toEqual([1.03, 1.03, 1.03, 1.03, 1]);
  // Between 1 and 1.03 the plate's own px decide: 529 x 1004 at r 2 gives k_dev 0.980.
  const near = { w: 529, h: 1004 };
  expect(overscan(CU, near, 2, false)).toBeCloseTo(1 / kDev(near, 2, false), 12);
  expect(overscan(CU, near, 2, false)).toBeLessThan(1.03);
  for (const { stage, r, half } of [...TABLE, { stage: near, r: 2, half: false }]) {
    expect(overscan(CU, stage, r, half)).toBeLessThanOrEqual(Math.max(1, 1 / kDev(stage, r, half)) + 1e-12);
  }
});

test('shot-view: the zoom range never falls below the overscan', () => {
  // 787 x 1400 at DPR 1.5: k_dev 1.093, so no push (round 1's 0.915 would show the stage edge).
  expect(zoomRange(CU, { w: 787, h: 1400 }, 1.5, false)).toEqual({ min: 1, max: 1 });
  expect(zoomRange(CU, { w: 390, h: 844 }, 2, false).max).toBeCloseTo(1 / ((844 / 2048) * 2), 12);
  expect(zoomRange(CU, { w: 405, h: 720 }, 1, false)).toEqual({ min: 1.03, max: 1.3 });
  for (const { stage, r, half } of TABLE) {
    const z = zoomRange(CU, stage, r, half);
    expect(z.min).toBe(overscan(CU, stage, r, half));
    expect(z.max).toBeGreaterThanOrEqual(z.min);
  }
});

test('shot-view: a face member sits at its plate box', () => {
  const [layer] = faceLayers(CU, faces(['ally', 'smile']));
  expect(layer).toEqual({ char: 'ally', expr: 'smile', kind: 'layer', file: 'face/cu/ally/smile', frame: [0, 40, 160, 200], at: [480, 520, 160, 200] });
  // On the stage it is the plate box under the shot's framing.
  const stage = { w: 390, h: 844 };
  const x = restFraming(CU, stage, 2, false);
  const [px, py, pw, ph] = layer?.at ?? [0, 0, 0, 0];
  expect({ x: x.x + px * x.k, y: x.y + py * x.k, w: pw * x.k, h: ph * x.k }).toEqual({ x: x.x + 480 * x.k, y: x.y + 520 * x.k, w: 160 * x.k, h: 200 * x.k });
});

test("shot-view: a shot's rest framing moves toward its focus inside the slack", () => {
  const stage = { w: 390, h: 844 };
  const centred = restFraming(CU, stage, 2, false);
  const { sx, sy } = slack(CU, stage, centred);
  expect(sx).toBeGreaterThan(0);
  expect(sy).toBeGreaterThan(0);
  // A centred focus keeps the crop centred.
  expect(centred.x).toBeCloseTo(-sx, 9);
  expect(centred.y).toBeCloseTo(-sy, 9);
  // A focus near the left edge moves the crop right, up to the plate's left edge, never past it.
  const left = restFraming(rig('close', [], [60, 1024]), stage, 2, false);
  expect(left.x).toBeCloseTo(0, 9);
  expect(left.k).toBe(centred.k);
  // A focus inside the slack lands on the stage's centre.
  const near = restFraming(rig('close', [], [560, 1000]), stage, 2, false);
  expect(near.x + 560 * near.k).toBeCloseTo(stage.w / 2, 9);
  expect(near.y + 1000 * near.k).toBeCloseTo(stage.h / 2, 9);
  // A focus near the bottom: the plate's bottom edge stays at the stage's.
  const low = restFraming(rig('close', [], [540, 2040]), stage, 2, false);
  expect(low.y + 2048 * low.k).toBeCloseTo(stage.h, 9);
});

test("shot-view: a face's layers are its expression's own set", () => {
  // RULINGS 273 O2: per face only one expression's members, from its face file and the shot's sheet; the rest: none.
  for (const x of ['smile', 'worried']) {
    const plan = faceLayers(TWO, faces(['ally', x]));
    expect(plan.map((p) => [p.char, p.kind, p.file])).toEqual([
      ['ally', 'layer', `face/two/ally/${x}`],
      ['ally', 'hair', 'sheet/two'],
    ]);
    expect(plan.filter((p) => p.kind === 'layer').map((p) => p.expr)).toEqual([x]);
  }
  expect(faceLayers(TWO, faces())).toEqual([]);
  expect(faceLayers(TWO, faces(['ally', 'neutral'], ['stranger', 'neutral']))).toEqual([]);
  // An expression the rig lacks is drawn at rest; a face of a character outside the cast is no one's.
  expect(faceLayers(TWO, faces(['ally', 'furious'], ['keeper', 'smile']))).toEqual([]);
  // Two faces: each its own set, back to front; a figure plane comes from the sheet, under its member's face.
  const fig = rig('two', [faceMember('fig', 'ally', [200, 520, 160, 200], true), faceMember('fig', 'stranger', [700, 500, 160, 200])]);
  expect(faceLayers(fig, faces(['ally', 'smile'], ['stranger', 'worried'])).map((p) => [p.char, p.kind, p.expr, p.file])).toEqual([
    ['ally', 'figure', null, 'sheet/fig'],
    ['ally', 'layer', 'smile', 'face/fig/ally/smile'],
    ['ally', 'hair', null, 'sheet/fig'],
    ['stranger', 'layer', 'worried', 'face/fig/stranger/worried'],
    ['stranger', 'hair', null, 'sheet/fig'],
  ]);
  expect(faceLayers(fig, faces()).map((p) => p.kind)).toEqual(['figure']);
});

test("shot-view: a shot's slots follow its faces", () => {
  // At rest: the plate and the rest's talk file; no sheet, no face file.
  expect(Object.fromEntries(shotSlots(TWO, stageOn('two')))).toEqual({
    bg: 'bg/two',
    'talk:ally': 'talk/two/ally/neutral',
    'talk:stranger': 'talk/two/stranger/neutral',
  });
  // One face off rest: the sheet and that face's file; its talk follows its expression.
  expect(Object.fromEntries(shotSlots(TWO, stageOn('two', [['ally', 'smile']])))).toEqual({
    bg: 'bg/two',
    sheet: 'sheet/two',
    'face:ally': 'face/two/ally/smile',
    'talk:ally': 'talk/two/ally/smile',
    'talk:stranger': 'talk/two/stranger/neutral',
  });
  // An expression without talk has no talk slot.
  expect(Object.fromEntries(shotSlots(TWO, stageOn('two', [['stranger', 'worried']])))).toEqual({
    bg: 'bg/two',
    sheet: 'sheet/two',
    'face:stranger': 'face/two/stranger/worried',
    'talk:ally': 'talk/two/ally/neutral',
  });
  // Cut-outs need the sheet at rest too: a figure plane, or a plane.
  const fig = rig('two', [faceMember('fig', 'ally', [200, 520, 160, 200], true)]);
  expect(shotSlots(fig, stageOn('fig')).get('sheet')).toBe('sheet/fig');
  const planes: ShotRig = { ...rig('wide'), planes: [{ member: mem('sheet/wide', [0, 0, 10, 10], [0, 0, 10, 10]), depth: 0.5, pivot: [5, 5], front: false }] };
  expect(Object.fromEntries(shotSlots(planes, stageOn('wide')))).toEqual({ bg: 'bg/wide', sheet: 'sheet/wide' });
  // An expression the rig lacks: drawn at rest, so no face slot and no sheet.
  expect(shotSlots(TWO, stageOn('two', [['ally', 'furious']])).has('sheet')).toBe(false);
});

test('shot-view: a chapter whose shots have no cast has no rigs', () => {
  const B64 = (bytes: number): string => 'A'.repeat(Math.ceil(bytes / 3) * 4);
  const raw = (cast: ShotRig['cast']): unknown => ({
    shot: { ...rig('wide'), depth: B64(13 * 24), cast: cast.map((m) => ({ ...m, plateau: B64(Math.ceil((25 * 47) / 8)), plateauCoarse: B64(Math.ceil((13 * 24) / 8)) })) },
  });
  const manifest = (shots: unknown): AssetManifest => ({ chapterId: 'ch1' as ChapterId, assets: {}, ...(shots === undefined ? {} : { shots }) });
  // ch1-ch3's case: rigs without a cast, so the chapter plays on sprites; and a manifest without shots.
  expect(chapterRigs(manifest(raw([])))).toBe(null);
  expect(chapterRigs(manifest(undefined))).toBe(null);
  // A cast shot makes a shot chapter, memoised per manifest object.
  const m = manifest(raw([faceMember('shot', 'ally', [480, 520, 160, 200])]));
  const rigs = chapterRigs(m);
  expect([...(rigs?.keys() ?? [])]).toEqual(['shot']);
  expect(chapterRigs(m)).toBe(rigs);
  // Shots that do not decode: logged once, then legacy.
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  const bad = manifest({ shot: { w: 1080 } });
  expect(chapterRigs(bad)).toBe(null);
  expect(chapterRigs(bad)).toBe(null);
  expect(errors).toHaveBeenCalledTimes(1);
  errors.mockRestore();
});
