import { expect, test } from 'vitest';

import type { VisualCommand } from '../scene/executor.ts';
import type { BgId, CgId, CharId, ExprId, KnotName, PropId, PuzzleLocalId, SectionId, SfxId, StagingCommand, TrackId } from '../story/staging.ts';
import { imageIds, splitBatch } from './stage-route.ts';

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
  puzzle: { kind: 'puzzle', puzzle: 'cabinet' as PuzzleLocalId, then: 'after' as KnotName },
  explore: { kind: 'explore', section: 'manor' as SectionId },
};

test('stage-route: splitBatch routes every command kind', () => {
  const r = splitBatch(Object.values(ALL));
  // The scene's and the audio's, each in the batch's order; a yield is its step's own, so neither list holds it.
  expect(r.visual).toEqual([ALL.bg, ALL.scene, ALL.show, ALL.hide, ALL.cg, ALL.wait, ALL.face]);
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
  // A hide, a CG taken off and a wait name no image.
  expect(imageIds([ALL.hide, off, ALL.wait])).toEqual([]);
});
