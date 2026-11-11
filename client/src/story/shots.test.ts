import { describe, expect, test } from 'vitest';

import type { AssetEntry, AssetManifest } from './catalog.ts';
import { decodeLook, decodeLoops, decodeShotRigs, faceIndex, shotImages, stepWindow } from './shots.ts';
import type { LookIndex, ShotRig } from './shots.ts';
import type { AssetId, BgId, ChapterId } from './staging.ts';

/** `n` bits (or bytes) as the base64 the asset tool writes: all zero, the right length. */
function zeros(bytes: number): string {
  return 'A'.repeat(Math.ceil(bytes / 3) * 4);
}
const PLATEAU = zeros(Math.ceil((25 * 47) / 8)); // 147 bytes, 196 chars
const COARSE = zeros(Math.ceil((13 * 24) / 8)); // 39 bytes, 52 chars
const DEPTH = zeros(13 * 24); // 312 bytes, 416 chars

type Json = Record<string, unknown>;

function member(file: string, frame: readonly number[], at: readonly number[]): Json {
  return { file, frame, at };
}

/** A two-shot of `cafe`: ally (face, rest neutral, smiles and speaks in smile), bob (back view). */
function rawRig(): Json {
  const blink = (file: string, y: number): Json => ({
    half: member(file, [0, y, 400, 130], [140, 430, 400, 130]),
    closed: member(file, [0, y + 130, 400, 130], [140, 430, 400, 130]),
  });
  return {
    w: 1080,
    h: 2048,
    frame: 'two',
    focus: [540, 614],
    cast: [
      {
        char: 'ally',
        view: 'face',
        face: {
          rest: 'neutral',
          exprs: {
            neutral: { layer: null, motion: { blink: blink('sheet/cafe', 0), talk: [], accent: member('sheet/cafe', [0, 260, 400, 80], [140, 600, 400, 80]) } },
            smile: {
              layer: member('face/cafe/ally/smile', [0, 0, 440, 460], [120, 384, 440, 460]),
              motion: {
                blink: blink('face/cafe/ally/smile', 460),
                talk: [member('talk/cafe/ally/smile', [0, 0, 180, 110], [250, 720, 180, 110]), member('talk/cafe/ally/smile', [180, 0, 180, 110], [250, 720, 180, 110])],
                accent: member('face/cafe/ally/smile', [0, 720, 400, 80], [140, 600, 400, 80]),
              },
            },
          },
          head: [90, 340, 500, 560],
        },
        body: { cx: 340, cy: 1331, rx: 165, ry: 717, rot: 0, feet: [340, 2048] },
        headDepth: 0.2,
        plateau: PLATEAU,
        plateauCoarse: COARSE,
        band: 140,
        group: 0,
        figure: null,
        hair: [{ member: member('sheet/cafe', [400, 0, 220, 230], [230, 300, 220, 230]), pivot: [340, 300] }],
      },
      {
        char: 'bob',
        view: 'back',
        face: null,
        body: { cx: 720, cy: 1331, rx: 165, ry: 717, rot: 0, feet: [720, 2048] },
        headDepth: 0.2,
        plateau: PLATEAU,
        plateauCoarse: COARSE,
        band: 60,
        group: 1,
        figure: member('sheet/cafe', [620, 0, 330, 1434], [555, 614, 330, 1434]),
        hair: [{ member: member('sheet/cafe', [950, 0, 220, 230], [610, 300, 220, 230]), pivot: [720, 300] }],
      },
    ],
    planes: [],
    ambient: [],
    depth: DEPTH,
  };
}

function decodeOne(rig: Json): ReturnType<typeof decodeShotRigs> {
  return decodeShotRigs({ cafe: rig });
}

function errors(r: { ok: true } | { ok: false; error: string[] }): string[] {
  return r.ok ? [] : r.error;
}

/** A look whose image table the windows index: a step, a knot and a room window. */
function rawLook(): Json {
  return {
    images: ['bg/cafe', 'bg/hall', 'face/cafe/ally/smile', 'prop/note', 'sheet/cafe'],
    windows: {
      'ch1.start.a001': [[0, 4], [2], 1, [1]],
      'k:start': [[0], [], 0, []],
      'r:hall': [[1, 3], [0, 4], 2, []],
    },
  };
}

function entry(name: string): AssetEntry {
  return {
    kind: 'image',
    w: 1080,
    h: 2048,
    decodedBytes: 1080 * 2048 * 4,
    avif: { url: `/assets/${name}.avif`, bytes: 1 },
    webp: { url: `/assets/${name}.webp`, bytes: 1 },
  };
}

describe('shots decoders', () => {
  test('shots: a rig decodes', () => {
    const raw = rawRig();
    const r = decodeOne(raw);
    expect(errors(r)).toEqual([]);
    const rig = r.ok ? r.value.get('cafe' as BgId) : undefined;
    // The decoded rig is the file's value: every key known, nothing dropped or renamed.
    expect(rig).toEqual(raw);
    expect(rig?.cast.map((m) => [m.char, m.view, m.face?.rest ?? null])).toEqual([
      ['ally', 'face', 'neutral'],
      ['bob', 'back', null],
    ]);
    expect(rig?.cast[0]?.face?.exprs['neutral' as never]?.layer).toBeNull();
    // A member may carry `masked: true` and an expression a joint blink (§4.5, rev. 3).
    const masked = rawRig();
    const smile = ((masked['cast'] as Json[])[0]?.['face'] as Json)['exprs'] as Record<string, Json>;
    const motion = smile['smile']?.['motion'] as Json;
    motion['joint'] = { half: { ...member('face/cafe/ally/smile', [0, 800, 400, 130], [140, 430, 400, 130]), masked: true }, closed: member('face/cafe/ally/smile', [0, 930, 400, 130], [140, 430, 400, 130]) };
    expect(errors(decodeOne(masked))).toEqual([]);
    // Nothing but an object of rigs keyed by shot id.
    for (const bad of [null, [], 'cafe', { Cafe: raw }]) {
      expect(decodeShotRigs(bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  test('shots: an unknown rig key is refused', () => {
    type Case = readonly [string, (rig: Json) => void, string];
    const ally = (rig: Json): Json => (rig['cast'] as Json[])[0] ?? {};
    const exprs = (rig: Json): Record<string, Json> => ((ally(rig)['face'] as Json)['exprs'] ?? {}) as Record<string, Json>;
    const cases: readonly Case[] = [
      ['an unknown rig key', (r) => (r['sprites'] = []), 'cafe.sprites'],
      ['an unknown cast member key', (r) => (ally(r)['mood'] = 'calm'), 'cafe.cast.0.mood'],
      ['an unknown member key', (r) => ((exprs(r)['smile'] as Json)['layer'] = { ...member('face/cafe/ally/smile', [0, 0, 440, 460], [120, 384, 440, 460]), z: 1 }), 'cafe.cast.0.face.exprs.smile.layer.z'],
      ['an unknown motion key', (r) => (((exprs(r)['smile'] as Json)['motion'] as Json)['wink'] = null), 'cafe.cast.0.face.exprs.smile.motion.wink'],
      ['a missing rig key', (r) => Reflect.deleteProperty(r, 'depth'), 'cafe.depth'],
      ['a member of another shot', (r) => ((exprs(r)['smile'] as Json)['layer'] = member('face/hall/ally/smile', [0, 0, 440, 460], [120, 384, 440, 460])), 'cafe.cast.0.face.exprs.smile.layer.file'],
      ['a face file of another character', (r) => ((exprs(r)['smile'] as Json)['layer'] = member('face/cafe/bob/smile', [0, 0, 440, 460], [120, 384, 440, 460])), 'cafe.cast.0.face.exprs.smile.layer.file'],
      ['a box with a fraction', (r) => ((exprs(r)['smile'] as Json)['layer'] = member('face/cafe/ally/smile', [0, 0, 440.5, 460], [120, 384, 440, 460])), 'cafe.cast.0.face.exprs.smile.layer.frame'],
      ['a box past the plate', (r) => ((exprs(r)['smile'] as Json)['layer'] = member('face/cafe/ally/smile', [0, 0, 440, 460], [700, 384, 440, 460])), 'cafe.cast.0.face.exprs.smile.layer.at'],
      ['a plateau of the wrong length', (r) => (ally(r)['plateau'] = COARSE), 'cafe.cast.0.plateau'],
      ['a coarse plateau of the wrong length', (r) => (ally(r)['plateauCoarse'] = PLATEAU), 'cafe.cast.0.plateauCoarse'],
      ['a depth grid of the wrong length', (r) => (r['depth'] = PLATEAU), 'cafe.depth'],
      ['a member without a hair lock (R9)', (r) => (ally(r)['hair'] = []), 'cafe.cast.0.hair'],
      ['an unknown frame', (r) => (r['frame'] = 'extreme'), 'cafe.frame'],
      ['a face rig on a back view', (r) => (((r['cast'] as Json[])[1] ?? {})['view'] = 'face'), 'cafe.cast.1.face'],
    ];
    for (const [name, mutate, path] of cases) {
      const rig = rawRig();
      mutate(rig);
      const found = errors(decodeOne(rig));
      expect(found.filter((e) => e.startsWith(`${path}:`)), `${name}: ${JSON.stringify(found)}`).toHaveLength(1);
      expect(found, name).toHaveLength(1);
    }
    expect(errors(decodeOne(rawRig()))).toEqual([]); // control
  });

  test('shots: a look entry indexes the image table', () => {
    const r = decodeLook(rawLook());
    expect(errors(r)).toEqual([]);
    expect(r).toEqual({ ok: true, value: rawLook() });
    const cases: ReadonlyArray<readonly [string, (l: Json) => void, string]> = [
      ['an index past the table', (l) => ((l['windows'] as Record<string, unknown>)['k:start'] = [[5], [], 0, []]), 'windows.k:start.0.0'],
      ['a negative index', (l) => ((l['windows'] as Record<string, unknown>)['k:start'] = [[0], [-1], 0, []]), 'windows.k:start.1.0'],
      ['an image that is no asset id', (l) => (l['images'] = ['bg/cafe', 'bg/Hall', 'face/cafe/ally/smile', 'prop/note', 'sheet/cafe']), 'images.1'],
      ['an audio image', (l) => (l['images'] = ['bg/cafe', 'bgm/calm', 'face/cafe/ally/smile', 'prop/note', 'sheet/cafe']), 'images.1'],
      ['an image twice', (l) => (l['images'] = ['bg/cafe', 'bg/cafe', 'face/cafe/ally/smile', 'prop/note', 'sheet/cafe']), 'images.1'],
      ['a window key that is no step or room', (l) => ((l['windows'] as Record<string, unknown>)['start'] = [[0], [], 0, []]), 'windows.start'],
      ['an unknown look key', (l) => (l['labels'] = true), 'labels'],
    ];
    for (const [name, mutate, path] of cases) {
      const look = rawLook();
      mutate(look);
      const found = errors(decodeLook(look));
      expect(found.filter((e) => e.startsWith(`${path}:`)), `${name}: ${JSON.stringify(found)}`).toHaveLength(1);
      expect(found, name).toHaveLength(1);
    }
  });

  test('shots: a look window decodes need, warm, near and hope', () => {
    const r = decodeLook(rawLook());
    const look = r.ok ? r.value : null;
    expect(look && stepWindow(look, 'ch1.start.a001')).toEqual({
      need: ['bg/cafe', 'sheet/cafe'],
      warm: ['face/cafe/ally/smile'],
      near: 1,
      hope: ['bg/hall'],
    });
    expect(look && stepWindow(look, 'k:start')).toEqual({ need: ['bg/cafe'], warm: [], near: 0, hope: [] });
    // `near` counts the warm files fetched before the tag preloads: never more than `warm` holds.
    const over = rawLook();
    (over['windows'] as Record<string, unknown>)['k:start'] = [[0], [2], 2, []];
    expect(errors(decodeLook(over))).toEqual([expect.stringMatching(/^windows\.k:start\.2: 2 is more than the 1 warm files/)]);
    // The tuple's shape is exact: four slots, near a whole number.
    for (const bad of [[[0], [], 0], [[0], [], 0, [], []], [[0], [], 0.5, []], [[0], [], -1, []], { need: [0] }]) {
      const look = rawLook();
      (look['windows'] as Record<string, unknown>)['k:start'] = bad;
      expect(errors(decodeLook(look)), JSON.stringify(bad)).toHaveLength(1);
    }
  });

  test('shots: stepWindow finds a room window by its room id', () => {
    const r = decodeLook(rawLook());
    const look: LookIndex | null = r.ok ? r.value : null;
    // A room window is keyed `r:<room>` (rev. 5, m7): by the room, never by its bg.
    expect(look && stepWindow(look, 'r:hall')).toEqual({ need: ['bg/hall', 'prop/note'], warm: ['bg/cafe', 'sheet/cafe'], near: 2, hope: [] });
    expect(look && stepWindow(look, 'r:cafe')).toBeNull();
    expect(look && stepWindow(look, 'bg/hall')).toBeNull();
    // Own keys only: an inherited name is no window.
    expect(look && stepWindow(look, 'constructor')).toBeNull();
  });

  test("shots: shotImages lists a room's bg and its sheet, never a face or talk file", () => {
    // A chapter whose `cafe` shot has a cast at rest and one non-rest face file, and a cast-less `hall`.
    const assets: Record<string, AssetEntry> = {
      'bg/cafe': entry('bg-cafe-0a0a0a0a'),
      'bg/hall': entry('bg-hall-0b0b0b0b'),
      'face/cafe/ally/smile': entry('face-cafe-ally-smile-0c0c0c0c'),
      'sheet/cafe': entry('sheet-cafe-0d0d0d0d'),
      'talk/cafe/ally/neutral': entry('talk-cafe-ally-neutral-0e0e0e0e'),
    };
    const manifest: AssetManifest = { chapterId: 'ch1' as ChapterId, assets: assets as Record<AssetId, AssetEntry> }; // literal ids
    expect(shotImages(manifest, 'cafe' as BgId)).toEqual(['bg/cafe', 'sheet/cafe']);
    expect(shotImages(manifest, 'hall' as BgId)).toEqual(['bg/hall']);
  });

  test("shots: faceIndex answers a rig's characters and expressions", () => {
    const r = decodeOne(rawRig());
    const index = faceIndex(r.ok ? r.value : new Map<BgId, ShotRig>());
    expect([index.hasChar('ally'), index.hasExpr('ally', 'neutral'), index.hasExpr('ally', 'smile')]).toEqual([true, true, true]);
    // A back-view member has no face: neither its character nor any expression is answered from this rig.
    expect([index.hasChar('bob'), index.hasExpr('bob', 'neutral')]).toEqual([false, false]);
    expect([index.hasChar('carol'), index.hasExpr('ally', 'angry'), index.hasExpr('ally', 'constructor'), index.hasChar('constructor')]).toEqual([false, false, false, false]);
  });

  test('shots: a loop rig decodes', () => {
    const raw = { candle: { frames: [[0, 0, 256, 256], [256, 0, 256, 256], [0, 256, 256, 256]], fps: 8 } };
    expect(decodeLoops(raw)).toEqual({ ok: true, value: new Map([['candle', raw.candle]]) });
    const frames = (n: number): number[][] => Array.from({ length: n }, (_, i) => [i * 2, 0, 2, 2]);
    const cases: ReadonlyArray<readonly [string, unknown, string]> = [
      ['no frame', { candle: { frames: [], fps: 8 } }, 'candle.frames'],
      ['13 frames', { candle: { frames: frames(13), fps: 8 } }, 'candle.frames'],
      ['fps 0', { candle: { frames: frames(2), fps: 0 } }, 'candle.fps'],
      ['a fractional fps', { candle: { frames: frames(2), fps: 7.5 } }, 'candle.fps'],
      ['an unknown key', { candle: { frames: frames(2), fps: 8, loop: true } }, 'candle.loop'],
      ['a frame that is no box', { candle: { frames: [[0, 0, 2]], fps: 8 } }, 'candle.frames.0'],
      ['a prop id that is no id', { Candle: { frames: frames(2), fps: 8 } }, 'Candle'],
    ];
    for (const [name, raw, path] of cases) {
      const found = errors(decodeLoops(raw));
      expect(found.filter((e) => e.startsWith(`${path}:`)), `${name}: ${JSON.stringify(found)}`).toHaveLength(1);
      expect(found, name).toHaveLength(1);
    }
  });
});
