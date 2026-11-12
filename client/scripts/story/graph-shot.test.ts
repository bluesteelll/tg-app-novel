// The shot kinds in the knot graph (docs/plans/shots §3.1-3.2, lane SH1): what a knot's tags name for the chapter's
// manifest and preload, and what its opening tag lines clear for `budget/knot-set`. A face on a shot chapter names
// nothing (SH2 cut Q4, lane SH4): its files are the shot pass's.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

import { assetIndex, decodeAssetCatalog } from '../../src/story/catalog.ts';
import type { AssetIndex, BgId, ChapterId, CharId, ExprId, KnotName } from '../../src/story/staging.ts';
import { parseTags } from '../../src/story/tags.ts';
import { buildGraph } from './graph.ts';
import type { KnotNode } from './graph.ts';
import { GLOBALS_PATH } from './lint.ts';
import type { CastMember, LocId, Shot } from './shots/list.ts';

function committedAssets(): AssetIndex {
  const text = readFileSync(new URL('../../../assets/catalog.json', import.meta.url), 'utf8');
  const catalog = decodeAssetCatalog(JSON.parse(text.startsWith(String.fromCharCode(0xfeff)) ? text.slice(1) : text));
  if (!catalog.ok) {
    throw new Error('invariant: the committed catalog decodes');
  }
  return assetIndex(catalog.value);
}

const ASSETS = committedAssets();

/** The graph node of a knot whose opening tag lines are `tags`, followed by one line; `shots`: the declared shots. */
function knotWith(tags: string | readonly string[], shots?: readonly Shot[]): KnotNode {
  const list = typeof tags === 'string' ? [tags] : tags;
  for (const tag of list) {
    // Non-vacuity: the tag parses, so an empty asset list below is the graph's, never a dropped tag's.
    expect(parseTags([tag], ASSETS).commands, tag).toHaveLength(1);
  }
  const main = ['INCLUDE ../common/globals.ink', '-> shot', '=== shot ===', ...list.map((t) => `# ${t}`), 'Text. #id:ch1.shot.a001', '-> END'];
  const sources = new Map([
    ['ch1/main.ink', `${main.join('\n')}\n`],
    [GLOBALS_PATH, 'VAR g_trust = 0\n'],
  ]);
  const chapter = { id: 'ch1' as ChapterId, paid: false, entry: 'ch1/main.ink' }; // a fixture id
  const { graph } = buildGraph({ chapter, files: ['ch1/main.ink', GLOBALS_PATH], sources, assets: ASSETS, ...(shots === undefined ? {} : { shots }) });
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

test('graph: a cam names no asset', () => {
  for (const tag of ['cam: push to=ally z=120', 'cam: pull', 'cam: pan to=left']) {
    const node = knotWith(tag);
    expect(node.assets, tag).toEqual([]);
    expect(node.clears, tag).toEqual(CLEARS_NOTHING);
  }
});

test('graph: think, anim and fx name no asset', () => {
  for (const tag of ['think', 'anim: ally nod', 'fx: shake']) {
    const node = knotWith(tag);
    expect(node.assets, tag).toEqual([]);
    expect(node.clears, tag).toEqual(CLEARS_NOTHING);
  }
});

// ---------------------------------------------------------------------------------------------------------------
// SH2 cut Q4 (RULINGS 279/280, lane SH4): a face on a shot chapter names no knot asset; a legacy chapter's face its sprite.

/** ally as a face member of a shot, at rest neutral (ids of the committed catalog). */
const ALLY: CastMember = { char: 'ally' as CharId, view: 'face', rest: 'neutral' as ExprId, figure: false };
/** A declared shot `id` in its own location with `cast`. */
const shotOf = (id: string, cast: readonly CastMember[]): Shot => ({ id: id as BgId, loc: id as LocId, frame: 'two', cast });
const ROOM_SMILE = ['scene: room', 'face: ally smile'];

test('graph: a face on a shot chapter names no asset', () => {
  // The room is a shot with ally's face: the face draws from the shot's files, which only the step flow knows and the
  // shot pass names, so neither the knot's preload nor the chapter's manifest gets the sprite.
  const node = knotWith(ROOM_SMILE, [shotOf('room', [ALLY])]);
  expect(node.assets).toEqual(['bg/room']);
  // Nothing else changes: the clears and the successors are the legacy chapter's.
  const legacy = knotWith(ROOM_SMILE);
  expect([node.clears, node.next, node.ending]).toEqual([legacy.clears, legacy.next, legacy.ending]);
});

test('graph: a face on a chapter whose shots have no cast names its sprite', () => {
  // ch1-ch3: no list, cast-less shots only, or a cast shot the chapter never names: a face names its sprite as before.
  for (const shots of [[], [shotOf('room', [])], [shotOf('room', []), shotOf('street', [ALLY])]]) {
    expect(knotWith(ROOM_SMILE, shots).assets, JSON.stringify(shots)).toEqual(['bg/room', 'char/ally/smile']);
  }
});

const STORY_SCRIPT = fileURLToPath(new URL('../story.ts', import.meta.url));
const CLIENT_DIR = fileURLToPath(new URL('../..', import.meta.url));
/** A spawned Node loads inkjs/full and compiles: allow for a loaded machine instead of retrying. */
const CLI_TIMEOUT_MS = 60_000;

/** A clean, emitting fixture repo (never the committed story): one free chapter, a smile in the cafe's two-shot. */
function faceRepo(): Record<string, string> {
  const table = (o: unknown): string => `${JSON.stringify(o, null, 2)}\n`;
  const names = (ru: boolean): unknown => ({
    names: ru ? { ally: 'Подруга', stranger: 'Незнакомец', voice: 'Голос' } : { ally: 'Ally', stranger: 'Stranger', voice: 'Voice' },
    chapters: { ch1: ru ? 'Глава 1' : 'Chapter 1' },
    stories: { manor: ru ? 'Усадьба' : 'The Manor' },
    teasers: { manor: ru ? 'Черновик истории для проверки сборки.' : 'A draft story for the build check.' },
  });
  const cafe = { id: 'cafe', loc: 'cafe', frame: 'two', cast: [{ char: 'ally', view: 'face', rest: 'neutral' }] };
  return {
    'assets/catalog.json': readFileSync(new URL('../../../assets/catalog.json', import.meta.url), 'utf8'),
    'story/cast.json': JSON.stringify({ ally: { char: 'ally' }, stranger: { char: 'stranger' }, voice: { char: null } }),
    'story/chapters.json': JSON.stringify([{ id: 'ch1', entry: 'ch1/main.ink', paid: false, next: null }]),
    'story/stories.json': JSON.stringify([{ id: 'manor', first: 'ch1', cover: 'cover/manor', endings: {} }]),
    'story/shots.json': JSON.stringify({ locs: [{ id: 'cafe', light: 'warm lamps' }], shots: [cafe] }),
    'story/common/globals.ink': 'VAR g_x = 0\n',
    'story/ch1/main.ink': [
      'INCLUDE ../common/globals.ink',
      '-> cafe',
      '=== cafe ===',
      '# scene: cafe',
      'ally: Привет. #id:ch1.cafe.a001',
      '# face: ally smile',
      'ally: Ха. #id:ch1.cafe.a002',
      '-> END',
      '',
    ].join('\n'),
    'story/locales/en/ch1.json': table({ 'ch1.cafe.a001': { ru: 'Привет.', en: 'Hi.' }, 'ch1.cafe.a002': { ru: 'Ха.', en: 'Ha.' } }),
    'story/locales/ru/story.json': table(names(true)),
    'story/locales/en/story.json': table(names(false)),
  };
}

test(
  'graph: a story run names no sprite for a face on a shot chapter',
  () => {
    const root = mkdtempSync(join(tmpdir(), 'story-face-'));
    try {
      for (const [rel, text] of Object.entries(faceRepo())) {
        const abs = join(root, ...rel.split('/'));
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, text);
      }
      const r = spawnSync(process.execPath, [STORY_SCRIPT, '--root', root], { cwd: CLIENT_DIR, encoding: 'utf8' });
      expect(r.status, r.stdout + r.stderr).toBe(0);
      // The story tool hands the shot list to the graph: the knot's preload and the chapter's usage name the plate (so
      // the lists are the graph's, not empty) and no sprite for the face.
      const read = (...rel: string[]): unknown => JSON.parse(readFileSync(join(root, ...rel), 'utf8'));
      const meta = read('client', 'src', 'story-gen', 'free', 'ch1.meta.json') as { knots: Record<string, { assets: string[] }> };
      const usage = read('server', 'content', 'build', 'usage.json') as { chapters: Record<string, { assets: string[] }> };
      expect(meta.knots['cafe']?.assets).toEqual(['bg/cafe']);
      expect(usage.chapters['ch1']?.assets).toEqual(['bg/cafe']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  CLI_TIMEOUT_MS,
);
