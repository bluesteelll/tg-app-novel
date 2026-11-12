import { expect, test } from 'vitest';

import type { SceneSnapshot, VisualCommand } from '../scene/executor.ts';
import type { AssetEntry, AssetManifest } from '../story/catalog.ts';
import type { AssetId, BgId, CgId, ChapterId, CharId, ExprId, KnotName, PropId, PuzzleLocalId, SectionId, SfxId, StagingCommand, TrackId } from '../story/staging.ts';
import { parseTags } from '../story/tags.ts';
import { EMPTY_WINDOW } from '../scene/preload.ts';
import { imageIds, lookOf, manifestIndex, roomWindowKey, splitBatch, windowFor, withEventRoom, withRoomProps } from './stage-route.ts';

// Commands as parseTags types them; the brands are earned by the parser in production.
/** One command of every kind: a kind added to StagingCommand fails `check` here until its route is pinned. */
const ALL: { [K in StagingCommand['kind']]: Extract<StagingCommand, { kind: K }> } = {
  bg: { kind: 'bg', bg: 'cafe' as BgId, t: 'cut', ms: 500 },
  scene: { kind: 'scene', bg: 'street' as BgId, t: 'fade', ms: 800 },
  show: { kind: 'show', char: 'ally' as CharId, expr: 'neutral' as ExprId, at: 'left', t: 'fade', ms: null },
  hide: { kind: 'hide', char: 'stranger' as CharId, t: 'fade', ms: 300 },
  cg: { kind: 'cg', cg: 'letter' as CgId, t: 'fade', ms: 500 },
  bgm: { kind: 'bgm', track: 'calm' as TrackId, fadeMs: 1000, vol: 100 },
  sfx: { kind: 'sfx', sfx: 'door' as SfxId, vol: 100 },
  wait: { kind: 'wait', ms: 1200 },
  face: { kind: 'face', char: 'ally' as CharId, expr: 'smile' as ExprId, ms: null },
  cam: { kind: 'cam', cam: { kind: 'push', to: 'ally' as CharId, z: 120 }, ms: null },
  think: { kind: 'think' },
  anim: { kind: 'anim', char: 'ally' as CharId, motion: 'nod', ms: null },
  fx: { kind: 'fx', fx: 'flash', ms: 300 },
  puzzle: { kind: 'puzzle', puzzle: 'cabinet' as PuzzleLocalId, then: 'after' as KnotName },
  explore: { kind: 'explore', section: 'manor' as SectionId },
};

test('stage-route: splitBatch routes every command kind', () => {
  const r = splitBatch(Object.values(ALL));
  // The scene's and the audio's, each in the batch's order; a yield is its step's own, so neither list holds it.
  expect(r.visual).toEqual([ALL.bg, ALL.scene, ALL.show, ALL.hide, ALL.cg, ALL.wait, ALL.face, ALL.cam, ALL.anim, ALL.fx]);
  expect(r.audio).toEqual([ALL.bgm, ALL.sfx]);
});

test("stage-route: imageIds lists a batch's images", () => {
  const off: VisualCommand = { kind: 'cg', cg: null, t: 'fade', ms: 500 };
  const props: VisualCommand = {
    kind: 'props',
    props: [
      { prop: 'lamp' as PropId, rect: [500, 900, 100, 100] },
      { prop: 'glint' as PropId, rect: [380, 1540, 100, 100], part: 'patch' },
    ],
  };
  expect(imageIds([ALL.bg, ALL.scene, ALL.show, ALL.hide, ALL.cg, off, ALL.wait, props])).toEqual([
    'bg/cafe',
    'bg/street',
    'char/ally/neutral',
    'cg/letter',
    'prop/lamp',
    'prop/glint',
  ]);
  // On a sprite stage a face names its expression's sprite, as a show does (it is ensured before the line).
  expect(imageIds([ALL.face])).toEqual(['char/ally/smile']);
  // A hide, a CG taken off, a wait, a camera move and the one-shots name no image.
  expect(imageIds([ALL.hide, off, ALL.wait, ALL.cam, ALL.anim, ALL.fx])).toEqual([]);
});

test('stage-route: think goes to the session, anim and fx to the scene', () => {
  const r = splitBatch([ALL.anim, ALL.think, ALL.bgm, ALL.fx]);
  expect(r.think).toBe(true);
  expect(r.visual).toEqual([ALL.anim, ALL.fx]);
  expect(r.audio).toEqual([ALL.bgm]);
  // A batch without it: the line is spoken as usual.
  expect(splitBatch([ALL.anim, ALL.bgm]).think).toBe(false);
  expect(splitBatch([]).think).toBe(false);
});

// ---------------------------------------------------------------------------------------------------------------
// A shot chapter's batch (docs/plans/shots §5.2, rev. 4 W4 and m5; lane SH4): the drawn files it ensures.

const B64 = (bytes: number): string => 'A'.repeat(Math.ceil(bytes / 3) * 4);
type RawBox = readonly [number, number, number, number];
const member = (file: string, frame: RawBox, at: RawBox): unknown => ({ file, frame, at });
/** A face member as a manifest's `shots` carries it: rest `neutral`, a layer per other expression, talk in each. */
function rawCast(shot: string, c: string, at: RawBox, exprs: readonly string[], figure = false): unknown {
  const f = (x: string): string => `face/${shot}/${c}/${x}`;
  const motion = (x: string): unknown => ({
    blink: { half: member(f(x), [0, 0, 1, 1], at), closed: member(f(x), [1, 0, 1, 1], at) },
    talk: [member(`talk/${shot}/${c}/${x}`, [0, 0, 40, 20], at)],
    accent: member(f(x), [2, 0, 1, 1], at),
  });
  return {
    char: c,
    view: 'face',
    face: { rest: 'neutral', exprs: Object.fromEntries(['neutral', ...exprs].map((x) => [x, { layer: x === 'neutral' ? null : member(f(x), [0, 40, at[2], at[3]], at), motion: motion(x) }])), head: at },
    body: { cx: 540, cy: 1300, rx: 200, ry: 600, rot: 0, feet: [540, 1900] },
    headDepth: 0.5,
    plateau: B64(Math.ceil((25 * 47) / 8)),
    plateauCoarse: B64(Math.ceil((13 * 24) / 8)),
    band: 40,
    group: 0,
    figure: figure ? member(`sheet/${shot}`, [0, 200, 300, 1000], [300, 600, 300, 1000]) : null,
    hair: [{ member: member(`sheet/${shot}`, [0, 0, 200, 120], [at[0], at[1] - 60, 200, 120]), pivot: [at[0], at[1]] }],
  };
}
const rawShot = (cast: readonly unknown[], planes: readonly unknown[] = []): unknown => ({ w: 1080, h: 2048, frame: 'two', focus: [540, 1024], cast, planes, ambient: [], depth: B64(13 * 24) });
const entry = (url: string): AssetEntry => ({ kind: 'image', w: 256, h: 256, decodedBytes: 262_144, avif: { url: `${url}.avif`, bytes: 100 }, webp: { url: `${url}.webp`, bytes: 120 } });
/** A shot chapter's manifest: `two` (ally and stranger), `two_cu` (ally), `fig` (a figure plane), `wide` (a plane). */
function shotManifest(chapterId: string, base: string, exprs: readonly string[]): AssetManifest {
  const ids = ['bg/two', 'bg/two_cu', 'bg/fig', 'bg/wide', 'sheet/two', 'sheet/two_cu', 'sheet/fig', 'sheet/wide'];
  for (const x of exprs) {
    ids.push(`face/two/ally/${x}`, `face/two/stranger/${x}`, `face/two_cu/ally/${x}`, `face/fig/ally/${x}`);
  }
  return {
    chapterId: chapterId as ChapterId,
    assets: Object.fromEntries(ids.map((id) => [id, entry(`${base}${id.replaceAll('/', '-')}`)])),
    shots: {
      two: rawShot([rawCast('two', 'ally', [200, 520, 160, 200], exprs), rawCast('two', 'stranger', [700, 500, 160, 200], exprs)]),
      two_cu: rawShot([rawCast('two_cu', 'ally', [400, 600, 300, 380], exprs)]),
      fig: rawShot([rawCast('fig', 'ally', [200, 520, 160, 200], exprs, true)]),
      wide: rawShot([], [{ member: member('sheet/wide', [0, 0, 100, 100], [0, 1500, 1080, 548]), depth: 0.2, pivot: [540, 2048], front: true }]),
    },
  };
}
const SHOTS = shotManifest('ch4', '/assets/', ['smile', 'worried']);
const on = (bg: string | null, faces: Array<[string, string]> = []): SceneSnapshot => ({
  bg: bg as BgId | null,
  cg: null,
  chars: faces.map(([char, expr]) => ({ char: char as CharId, expr: expr as ExprId, at: 'center' })),
  props: [],
});
const cmdFace = (c: string, x: string): VisualCommand => ({ kind: 'face', char: c as CharId, expr: x as ExprId, ms: null });
const cmdScene = (b: string): VisualCommand => ({ kind: 'scene', bg: b as BgId, t: 'cut', ms: 500 });
const cmdBg = (b: string): VisualCommand => ({ kind: 'bg', bg: b as BgId, t: 'cut', ms: 500 });

test('stage-route: a batch ensures the sheet when a face is not at rest or the shot has cut-outs', () => {
  // At rest, the plate alone: the plate shows every face.
  expect(imageIds([cmdScene('two')], { stage: on(null), manifest: SHOTS })).toEqual(['bg/two']);
  // A face off its rest: its face file and the sheet (the hair locks drawn over it).
  expect(imageIds([cmdFace('ally', 'smile')], { stage: on('two'), manifest: SHOTS })).toEqual(['bg/two', 'face/two/ally/smile', 'sheet/two']);
  // Cut-outs need the sheet at rest too: a figure plane, a plane.
  expect(imageIds([cmdScene('fig')], { stage: on('two'), manifest: SHOTS })).toEqual(['bg/fig', 'sheet/fig']);
  expect(imageIds([cmdScene('wide')], { stage: on('two'), manifest: SHOTS })).toEqual(['bg/wide', 'sheet/wide']);
  // Back to the rest: no sheet, no face file.
  expect(imageIds([cmdFace('ally', 'neutral')], { stage: on('two', [['ally', 'smile']]), manifest: SHOTS })).toEqual(['bg/two']);
});

test("stage-route: manifestIndex knows a face from the chapter's rigs", () => {
  // No char/ entry: the face vocabulary is the rigs' (a face of a shot chapter validates against its own manifest).
  const idx = manifestIndex(SHOTS);
  expect([idx.hasChar('ally'), idx.hasChar('stranger'), idx.hasChar('keeper')]).toEqual([true, true, false]);
  expect([idx.hasExpr('ally', 'smile'), idx.hasExpr('ally', 'neutral'), idx.hasExpr('ally', 'furious'), idx.hasExpr('keeper', 'smile')]).toEqual([true, true, false, false]);
  expect(parseTags(['face: ally smile'], idx).commands).toEqual([cmdFace('ally', 'smile')]);
  // A legacy chapter answers from its sprites only.
  const legacy = manifestIndex({ chapterId: 'ch1' as ChapterId, assets: Object.fromEntries([['char/ally/neutral', entry('/assets/char-ally-neutral')]]) });
  expect([legacy.hasChar('ally'), legacy.hasExpr('ally', 'neutral'), legacy.hasExpr('ally', 'smile')]).toEqual([true, true, false]);
});

test('stage-route: a batch ensures the face file of every visible face not at rest, never a talk file', () => {
  // The shot after the cut and the persisted faces decide: a bg cut keeps ally's smile, in the new shot's files.
  expect(imageIds([cmdBg('two_cu')], { stage: on('two', [['ally', 'smile']]), manifest: SHOTS })).toEqual(['bg/two_cu', 'face/two_cu/ally/smile', 'sheet/two_cu']);
  // A scene resets the faces to their rest: the plate alone.
  expect(imageIds([cmdScene('two_cu')], { stage: on('two', [['ally', 'smile']]), manifest: SHOTS })).toEqual(['bg/two_cu']);
  // A second face changes: both visible faces off rest are ensured, the persisted one included.
  const both = imageIds([cmdFace('stranger', 'worried')], { stage: on('two', [['ally', 'smile']]), manifest: SHOTS });
  expect(both).toEqual(['bg/two', 'face/two/ally/smile', 'face/two/stranger/worried', 'sheet/two']);
  // A face never names a sprite on a shot chapter, and no batch names a talk file (motion, never awaited).
  for (const ids of [both, imageIds([cmdFace('ally', 'smile'), cmdBg('two')], { stage: on('two'), manifest: SHOTS })]) {
    expect(ids.filter((id) => id.startsWith('talk/') || id.startsWith('char/'))).toEqual([]);
  }
});

test("stage-route: a paid chapter's batch ensures its gated face files", () => {
  // A paid chapter's manifest: every file gated; the blush lives only in a gated face file.
  const gated = '/api/assets/';
  const paid = shotManifest('ch2', gated, ['blush']);
  const ids = imageIds([cmdFace('ally', 'blush')], { stage: on('two'), manifest: paid });
  expect(ids).toEqual(['bg/two', 'face/two/ally/blush', 'sheet/two']);
  for (const id of ids) {
    const e = paid.assets[id];
    expect(e?.kind === 'image' ? e.avif.url.slice(0, gated.length) : null, id).toBe(gated);
  }
});

test("stage-route: a sprite chapter's ids are unchanged with a context", () => {
  // ch1-ch3: cast-less rigs (or none) make no shot chapter, so the ids are today's, a face's sprite included.
  const castless: AssetManifest = { chapterId: 'ch1' as ChapterId, assets: {}, shots: { two: rawShot([]) } };
  const cmds = [ALL.bg, ALL.scene, ALL.show, ALL.hide, ALL.cg, ALL.face, ALL.wait];
  const today = imageIds(cmds);
  expect(today).toEqual(['bg/cafe', 'bg/street', 'char/ally/neutral', 'cg/letter', 'char/ally/smile']);
  for (const manifest of [castless, { chapterId: 'ch1' as ChapterId, assets: {} }, null]) {
    expect(imageIds(cmds, { stage: on('two', [['ally', 'smile']]), manifest })).toEqual(today);
  }
});

// ---------------------------------------------------------------------------------------------------------------
// The step windows (shots §5.8, lane SH5a): a chapter's look decoded once per manifest, a step's window by its key or
// its knot's index, a room batch's key, the event's room, and the room props on a story cut.

const LOOK = {
  images: ['bg/hall', 'sheet/hall', 'bg/cu_a', 'bg/cu_b', 'prop/lamp', 'bg/study', 'bg/street'],
  windows: {
    'ch1.arrival.a001': [[0, 1], [3], 0, [2]],
    'k:arrival': [[6], [], 0, [0]],
    'r:hall': [[0, 1, 4], [6], 1, []],
    'r:study': [[5], [], 0, []],
    'r:office': [[5], [], 0, []],
  },
};
const looked = (look?: unknown): AssetManifest => ({ chapterId: 'ch1' as ChapterId, assets: {}, ...(look === undefined ? {} : { look }) });
const where = (section: string | null, room: string | null): { section: string | null; room: string | null } => ({ section, room });
const asAsset = (s: string): AssetId => s as AssetId; // fixture ids: the brand is earned by the manifest decoder
const A001 = { need: ['bg/hall', 'sheet/hall'], warm: ['bg/cu_b'], near: 0, hope: ['bg/cu_a'] };

test("stage-route: a step's window comes from look", () => {
  const m = looked(LOOK);
  expect(lookOf(m), 'decoded once per manifest').toBe(lookOf(m));
  expect(windowFor(m, 'ch1.arrival.a001', 'arrival', null)).toEqual({ ...A001, eventRoom: [] });
  // A chapter without look, or with one that does not decode: the empty window, which still ends the entry tag.
  for (const none of [looked(), looked({ images: 'bg/hall' }), null]) {
    expect(windowFor(none, 'ch1.arrival.a001', 'arrival', null)).toEqual(EMPTY_WINDOW);
  }
  expect(lookOf(looked({ images: 'bg/hall' })).ok).toBe(false);
});

test('stage-route: a missing key falls back to the knot index', () => {
  const m = looked(LOOK);
  const index = { need: ['bg/street'], warm: [], near: 0, hope: ['bg/hall'], eventRoom: [] };
  expect(windowFor(m, 'ch1.arrival.a099', 'arrival', null)).toEqual(index);
  expect(windowFor(m, null, 'arrival', null)).toEqual(index);
  // Neither the key nor the knot's index: the empty window.
  expect(windowFor(m, 'ch1.arrival.a099', 'gate', null)).toEqual(EMPTY_WINDOW);
  expect(windowFor(m, null, null, null)).toEqual(EMPTY_WINDOW);
});

test("stage-route: a room batch's window key is its room's; a close-up batch has none", () => {
  const r = lookOf(looked(LOOK));
  if (!r.ok) {
    throw new Error('invariant: the fixture look decodes');
  }
  const look = r.value;
  const letter: VisualCommand = { kind: 'cg', cg: 'letter' as CgId, t: 'fade', ms: 500 };
  const clear: VisualCommand = { kind: 'cg', cg: null, t: 'fade', ms: 500 };
  // A room batch, an empty one and a close-up's clear hand the room's window; two rooms on one bg keep their own keys.
  expect(roomWindowKey([cmdScene('hall')], where('manor', 'hall'), look)).toBe('r:hall');
  expect(roomWindowKey([], where('manor', 'hall'), look)).toBe('r:hall');
  expect(roomWindowKey([clear], where('manor', 'hall'), look)).toBe('r:hall');
  expect(roomWindowKey([cmdScene('study')], where('manor', 'study'), look)).toBe('r:study');
  expect(roomWindowKey([cmdScene('study')], where('manor', 'office'), look)).toBe('r:office');
  // A batch that sets a CG (a close-up), no current section, or a room the look has no window for: none.
  expect(roomWindowKey([letter], where('manor', 'hall'), look)).toBeNull();
  expect(roomWindowKey([], where(null, null), look)).toBeNull();
  expect(roomWindowKey([], where('manor', 'attic'), look)).toBeNull();
});

test('stage-route: a story step inside a room event passes its room as eventRoom', () => {
  const m = looked(LOOK);
  // In the hall's event: the hall window's need files the step lists in no class, in order.
  expect(windowFor(m, 'ch1.arrival.a001', 'arrival', where('manor', 'hall'))).toEqual({ ...A001, eventRoom: ['prop/lamp'] });
  const room = { need: ['bg/hall', 'prop/lamp', 'bg/study'].map(asAsset), warm: [asAsset('bg/street')], near: 0, hope: [] };
  const step = { need: [asAsset('bg/cu_a')], warm: [asAsset('bg/study')], near: 0, hope: [asAsset('prop/lamp')] };
  expect(withEventRoom(step, room).eventRoom).toEqual(['bg/hall']);
  expect(withEventRoom(step, null).eventRoom).toEqual([]);
  // No current section, the room's own window, or a room with no window: no eventRoom.
  expect(windowFor(m, 'ch1.arrival.a001', 'arrival', where(null, null)).eventRoom).toEqual([]);
  expect(windowFor(m, 'r:hall', null, where('manor', 'hall')).eventRoom).toEqual([]);
  expect(windowFor(m, 'ch1.arrival.a001', 'arrival', where('manor', 'attic')).eventRoom).toEqual([]);
});

test('stage-route: a story step after a leave (no section, the last room kept) gets no eventRoom', () => {
  const m = looked(LOOK);
  // A leave changes only the section: ch1's steps after the gate run at { section: null, room: 'hall' }.
  expect(windowFor(m, 'ch1.arrival.a001', 'arrival', where('manor', 'hall')).eventRoom).toEqual(['prop/lamp']);
  expect(windowFor(m, 'ch1.arrival.a001', 'arrival', where(null, 'hall'))).toEqual({ ...A001, eventRoom: [] });
});

test("stage-route: a cut to a room's shot appends its props from world state", () => {
  const props: VisualCommand = { kind: 'props', props: [{ prop: 'lamp' as PropId, rect: [500, 900, 100, 100] }] };
  const roomFor = (bg: BgId): readonly VisualCommand[] | null => (bg === 'hall' ? [props] : null);
  expect(withRoomProps([cmdBg('hall')], roomFor)).toEqual([cmdBg('hall'), props]);
  expect(withRoomProps([cmdScene('street'), ALL.show, cmdScene('hall')], roomFor)).toEqual([cmdScene('street'), ALL.show, cmdScene('hall'), props]);
  // A cut to a bg no room of the section shows, a batch with no cut, and no world (roomFor null): unchanged.
  expect(withRoomProps([cmdBg('street')], roomFor)).toEqual([cmdBg('street')]);
  expect(withRoomProps([ALL.show], roomFor)).toEqual([ALL.show]);
  expect(withRoomProps([cmdBg('hall')], () => null)).toEqual([cmdBg('hall')]);
});
