// The shot kinds in the knot graph (docs/plans/shots §3.1-3.2, lane SH1): what a knot's tags name for the chapter's
// manifest and preload, and what its opening tag lines clear for `budget/knot-set`.
import { readFileSync } from 'node:fs';

import { expect, test } from 'vitest';

import { assetIndex, decodeAssetCatalog } from '../../src/story/catalog.ts';
import type { AssetIndex, ChapterId, KnotName } from '../../src/story/staging.ts';
import { parseTags } from '../../src/story/tags.ts';
import { buildGraph } from './graph.ts';
import type { KnotNode } from './graph.ts';
import { GLOBALS_PATH } from './lint.ts';

function committedAssets(): AssetIndex {
  const text = readFileSync(new URL('../../../assets/catalog.json', import.meta.url), 'utf8');
  const catalog = decodeAssetCatalog(JSON.parse(text.startsWith(String.fromCharCode(0xfeff)) ? text.slice(1) : text));
  if (!catalog.ok) {
    throw new Error('invariant: the committed catalog decodes');
  }
  return assetIndex(catalog.value);
}

const ASSETS = committedAssets();

/** The graph node of a knot whose opening tag line is `tag`, followed by one line. */
function knotWith(tag: string): KnotNode {
  // Non-vacuity: the tag parses, so an empty asset list below is the graph's, never a dropped tag's.
  expect(parseTags([tag], ASSETS).commands, tag).toHaveLength(1);
  const main = ['INCLUDE ../common/globals.ink', '-> shot', '=== shot ===', `# ${tag}`, 'Text. #id:ch1.shot.a001', '-> END'];
  const sources = new Map([
    ['ch1/main.ink', `${main.join('\n')}\n`],
    [GLOBALS_PATH, 'VAR g_trust = 0\n'],
  ]);
  const chapter = { id: 'ch1' as ChapterId, paid: false, entry: 'ch1/main.ink' }; // a fixture id
  const { graph } = buildGraph({ chapter, files: ['ch1/main.ink', GLOBALS_PATH], sources, assets: ASSETS });
  const node = graph.knots.get('shot' as KnotName); // the fixture's knot
  if (node === undefined) {
    throw new Error('invariant: the fixture has the knot shot');
  }
  return node;
}

const CLEARS_NOTHING = { all: false, bg: false, cg: false, chars: [] };

test('graph: a face names its expression and keeps its character', () => {
  // The chapter's manifest and the knot's preload get the expression's sprite, so the runtime's manifest index admits
  // the face; its character's old expression stays counted, as both draw during the crossfade.
  const node = knotWith('face: ally smile');
  expect(node.assets).toEqual(['char/ally/smile']);
  expect(node.clears).toEqual(CLEARS_NOTHING);
});
