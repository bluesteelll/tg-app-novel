// The story list (STAGING-DSL §9, §11 `catalog/stories`; STORIES-PLAN Y2, Y4): the decoder's rules 1-7. Fixtures
// are inline: chapter-list literals and the decoded committed asset catalog (its covers); the committed cast is never
// read here. Each case asserts the defect first, then its control: the same source without the defect decodes.
import { readFileSync } from 'node:fs';

import { expect, test } from 'vitest';

import { decodeAssetCatalog } from '../../src/story/catalog.ts';
import type { AssetCatalog, ChapterListEntry, EndingName, Result, StoryId } from '../../src/story/catalog.ts';
import type { AssetId, ChapterId, KnotName, ProductId } from '../../src/story/staging.ts';
import type { Finding } from './lint.ts';
import { decodeStories } from './stories.ts';
import type { StoryPlan } from './stories.ts';

function readRepoJson(path: string): unknown {
  const text = readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
  return JSON.parse(text.startsWith(String.fromCharCode(0xfeff)) ? text.slice(1) : text);
}

function committedAssets(): AssetCatalog {
  const catalog = decodeAssetCatalog(readRepoJson('assets/catalog.json'));
  if (!catalog.ok) {
    throw new Error('invariant: the committed catalog decodes');
  }
  return catalog.value;
}

/** The committed catalog: `cover/manor` and `cover/tide` exist, `cover/nowhere` does not. */
const ASSETS = committedAssets();

/** A list entry; a paid chapter's product is `chapter:<id>`. Test fixtures name their ids directly. */
function ch(id: string, next: string | null, paid = false): ChapterListEntry {
  return { id: id as ChapterId, entry: `${id}/main.ink`, paid, productId: paid ? (`chapter:${id}` as ProductId) : null, next: next as ChapterId | null };
}

/** ch1 (free) → ch2 (paid), the committed skeleton's shape. */
const LIST = [ch('ch1', 'ch2'), ch('ch2', null, true)];

/** One stories.json entry as written: `manor` from ch1 with its cover and no ending, `over` replacing keys. */
function source(over: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return { id: 'manor', first: 'ch1', cover: 'cover/manor', endings: {}, ...over };
}

type Endings = Readonly<Record<string, { chapter: string; knot: string }>>;

/** The plan a clean entry decodes to. */
function plan(id: string, chapters: readonly string[], endings: Endings = {}, cover = `cover/${id}`): StoryPlan {
  return {
    id: id as StoryId,
    first: chapters[0] as ChapterId,
    cover: cover as AssetId,
    endings: endings as Readonly<Record<EndingName, { chapter: ChapterId; knot: KnotName }>>,
    chapters: chapters as readonly ChapterId[],
  }; // fixture ids match their grammars
}

/** The findings as story.ts prints them; none on a decoded file. */
function printed(r: Result<readonly StoryPlan[], Finding[]>): string[] {
  return r.ok ? [] : r.error.map((f) => `${f.severity} ${f.file}:${f.line} ${f.code} ${f.message}`);
}

function e(message: string): string {
  return `E story/stories.json:0 catalog/stories ${message}`;
}

// ---------------------------------------------------------------------------------------------------------------
// decodeStories: rules 1-7

test('stories: chapter in two stories fails', () => {
  // Two firsts whose chains merge: ch1 → ch3 and ch2 → ch3.
  const merged = [ch('ch1', 'ch3'), ch('ch2', 'ch3'), ch('ch3', null, true)];
  const two = [source({ id: 'manor', first: 'ch1' }), source({ id: 'tide', first: 'ch2', cover: 'cover/tide' })];
  expect(printed(decodeStories(two, merged, ASSETS))).toEqual([
    e('ch3 lies on the chains of manor and tide: a chapter belongs to exactly one story (§9)'),
  ]);
  const apart = [ch('ch1', 'ch3'), ch('ch2', null), ch('ch3', null, true)];
  expect(decodeStories(two, apart, ASSETS)).toEqual({ ok: true, value: [plan('manor', ['ch1', 'ch3']), plan('tide', ['ch2'])] });
});

test('stories: chapter in no story fails', () => {
  const list = [...LIST, ch('ch3', null)];
  expect(printed(decodeStories([source()], list, ASSETS))).toEqual([
    e("ch3 lies on no story's chain: every listed chapter belongs to exactly one story (§9)"),
  ]);
  const both = [source(), source({ id: 'tide', first: 'ch3', cover: 'cover/tide' })];
  expect(decodeStories(both, list, ASSETS)).toEqual({ ok: true, value: [plan('manor', ['ch1', 'ch2']), plan('tide', ['ch3'])] });
});

test('stories: paid first chapter fails', () => {
  expect(printed(decodeStories([source()], [ch('ch1', null, true)], ASSETS))).toEqual([
    e("0.first: 'ch1' is paid: the first chapter of a story is free (§9)"),
  ]);
  expect(decodeStories([source()], [ch('ch1', null)], ASSETS)).toEqual({ ok: true, value: [plan('manor', ['ch1'])] });
});

test('stories: next cycle fails', () => {
  // story.ts judges the list's play order first; the pure decoder must still refuse a loop.
  const loop = [ch('ch1', 'ch2'), ch('ch2', 'ch3'), ch('ch3', 'ch2')];
  expect(printed(decodeStories([source()], loop, ASSETS))).toEqual([e("0.first: the chain from 'ch1' visits 'ch2' twice")]);
  const line = [ch('ch1', 'ch2'), ch('ch2', 'ch3'), ch('ch3', null)];
  expect(decodeStories([source()], line, ASSETS)).toEqual({ ok: true, value: [plan('manor', ['ch1', 'ch2', 'ch3'])] });
});

test('stories: first named by a next fails', () => {
  const list = [ch('ch1', 'ch2'), ch('ch2', null)];
  expect(printed(decodeStories([source({ first: 'ch2' })], list, ASSETS))).toEqual([
    e("0.first: 'ch2' is the next of 'ch1': a story starts where no chain leads (§9)"),
    e("ch1 lies on no story's chain: every listed chapter belongs to exactly one story (§9)"),
  ]);
  expect(decodeStories([source()], list, ASSETS)).toEqual({ ok: true, value: [plan('manor', ['ch1', 'ch2'])] });
});

test('stories: unknown cover fails', () => {
  expect(printed(decodeStories([source({ cover: 'cover/nowhere' })], LIST, ASSETS))).toEqual([
    e("0.cover: 'cover/nowhere' is not in assets/catalog.json"),
  ]);
  expect(printed(decodeStories([source({ cover: 'bg/cafe' })], LIST, ASSETS))).toEqual([
    e('0.cover: "bg/cafe" does not match ^cover\\/([a-z][a-z0-9_]*)$'),
  ]);
  expect(decodeStories([source({ cover: 'cover/tide' })], LIST, ASSETS)).toEqual({
    ok: true,
    value: [plan('manor', ['ch1', 'ch2'], {}, 'cover/tide')],
  });
});

test('stories: bad story id fails', () => {
  const grammar = '^[a-z][a-z0-9_]{0,23}$';
  expect(printed(decodeStories([source({ id: 'Manor' })], LIST, ASSETS))).toEqual([e(`0.id: "Manor" does not match ${grammar}`)]);
  const long = 'a'.repeat(25);
  expect(printed(decodeStories([source({ id: long })], LIST, ASSETS))).toEqual([e(`0.id: "${long}" does not match ${grammar}`)]);
  // Rule 2's uniqueness: a second story with the first one's id.
  const list = [...LIST, ch('ch3', null)];
  const twice = [source(), source({ first: 'ch3', cover: 'cover/tide' })];
  expect(printed(decodeStories(twice, list, ASSETS))).toEqual([e("1.id: duplicate id 'manor'")]);
  const max = 'a'.repeat(24);
  const distinct = [source({ id: max }), source({ id: 'tide', first: 'ch3', cover: 'cover/tide' })];
  expect(decodeStories(distinct, list, ASSETS)).toEqual({
    ok: true,
    value: [plan(max, ['ch1', 'ch2'], {}, 'cover/manor'), plan('tide', ['ch3'])],
  });
});

test('stories: unknown key fails', () => {
  expect(printed(decodeStories([source({ extra: 1 })], LIST, ASSETS))).toEqual([
    e('0.extra: unknown key (expected id, first, cover, endings)'),
  ]);
  const noEndings = { id: 'manor', first: 'ch1', cover: 'cover/manor' };
  expect(printed(decodeStories([noEndings], LIST, ASSETS))).toEqual([e('0.endings: missing')]);
  const extraInEnding = source({ endings: { end: { chapter: 'ch2', knot: 'archive', extra: true } } });
  expect(printed(decodeStories([extraInEnding], LIST, ASSETS))).toEqual([
    e('0.endings.end.extra: unknown key (expected chapter, knot)'),
  ]);
  // Rule 1: a non-empty array.
  expect(printed(decodeStories({ stories: [source()] }, LIST, ASSETS))).toEqual([e('not a JSON array of stories')]);
  expect(printed(decodeStories([], LIST, ASSETS))).toEqual([e('0 stories: every listed chapter lies on exactly one story (§9)')]);
  expect(decodeStories([source()], LIST, ASSETS)).toEqual({ ok: true, value: [plan('manor', ['ch1', 'ch2'])] });
});

test('stories: ending chapter outside the story fails', () => {
  const list = [...LIST, ch('ch3', null)];
  const elsewhere = [source({ endings: { truth: { chapter: 'ch3', knot: 'shore' } } }), source({ id: 'tide', first: 'ch3', cover: 'cover/tide' })];
  expect(printed(decodeStories(elsewhere, list, ASSETS))).toEqual([
    e("0.endings.truth.chapter: 'ch3' is not on the chain of the story (ch1 → ch2)"),
  ]);
  const own = [source({ endings: { truth: { chapter: 'ch2', knot: 'archive' } } }), source({ id: 'tide', first: 'ch3', cover: 'cover/tide' })];
  expect(decodeStories(own, list, ASSETS)).toEqual({
    ok: true,
    value: [plan('manor', ['ch1', 'ch2'], { truth: { chapter: 'ch2', knot: 'archive' } }), plan('tide', ['ch3'])],
  });
});

test('stories: bad ending name fails', () => {
  const grammar = '^[a-z][a-z0-9_]{0,31}$';
  const at = { chapter: 'ch2', knot: 'archive' };
  const long = 'a'.repeat(33);
  const bad = source({ endings: { Truth: at, _ashes: at, [long]: at } });
  expect(printed(decodeStories([bad], LIST, ASSETS))).toEqual([
    e(`0.endings.Truth: 'Truth' does not match ${grammar}`),
    e(`0.endings._ashes: '_ashes' does not match ${grammar}`),
    e(`0.endings.${long}: '${long}' does not match ${grammar}`),
  ]);
  const max = 'a'.repeat(32);
  const good = source({ endings: { truth: at, [max]: { chapter: 'ch1', knot: 'street' } } });
  expect(decodeStories([good], LIST, ASSETS)).toEqual({
    ok: true,
    value: [plan('manor', ['ch1', 'ch2'], { truth: at, [max]: { chapter: 'ch1', knot: 'street' } })],
  });
});
