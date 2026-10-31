// The story meta (STAGING-DSL §9 "Story meta", §11 `catalog/meta`; META-PLAN M2, M4, M5, "Source file"): the five
// rules of the lint over hand-written story plans, choice maps and puzzle sets, and the choice points of classified
// ink (through the gate's own classifier and graph, against the committed catalog). Each refused case is paired with
// its control: the same input without the defect passes.
import { readFileSync } from 'node:fs';

import { expect, test } from 'vitest';

import { assetIndex, decodeAssetCatalog } from '../../src/story/catalog.ts';
import type { EndingName, StoryId } from '../../src/story/catalog.ts';
import type { AssetId, AssetIndex, ChapterId, KnotName, LineId, PuzzleLocalId } from '../../src/story/staging.ts';
import { buildGraph } from './graph.ts';
import { GLOBALS_PATH } from './lint.ts';
import { choicePoints, lintMeta } from './meta.ts';
import type { ChoiceMap } from './meta.ts';
import type { StoryPlan } from './stories.ts';

/** A decoded story: its chain and its endings (name → chapter; the knot is irrelevant to the meta). */
function plan(id: string, chapters: readonly string[], endings: Readonly<Record<string, string>> = {}): StoryPlan {
  const decl = Object.fromEntries(Object.entries(endings).map(([name, chapter]) => [name, { chapter, knot: `${name}_knot` }]));
  return {
    id: id as StoryId,
    first: chapters[0] as ChapterId,
    cover: `cover/${id}` as AssetId,
    endings: decl as Readonly<Record<EndingName, { chapter: ChapterId; knot: KnotName }>>,
    chapters: chapters as readonly ChapterId[],
  }; // fixture ids match their grammars
}

/** manor: ch1 → ch2, endings truth (ch2) and ashes (ch1); tide: ch3 → ch4, ending drowned (ch4). */
const MANOR = plan('manor', ['ch1', 'ch2'], { truth: 'ch2', ashes: 'ch1' });
const TIDE = plan('tide', ['ch3', 'ch4'], { drowned: 'ch4' });
const STORIES = [MANOR, TIDE];

function choiceMap(entries: ReadonlyArray<readonly [string, string]>): ChoiceMap {
  return new Map(entries.map(([o, p]) => [o as LineId, p as LineId])); // fixture IDs match LINE_ID_RE
}

/** ch1-ch3 compiled (ch1 has a text line ch1.hall.t001 that is no option); ch4 did not compile. */
const CHOICES = new Map<ChapterId, ChoiceMap>([
  ['ch1' as ChapterId, choiceMap([['ch1.hall.c001', 'ch1.hall.c001'], ['ch1.hall.c002', 'ch1.hall.c001'], ['ch1.study.c003', 'ch1.study.c003']])],
  ['ch2' as ChapterId, choiceMap([['ch2.archive.p004', 'ch2.archive.p004']])],
  ['ch3' as ChapterId, choiceMap([['ch3.deck.d001', 'ch3.deck.d001']])],
]);

function puzzleSet(ids: readonly string[]): ReadonlySet<PuzzleLocalId> {
  return new Set(ids as readonly PuzzleLocalId[]); // fixture ids match the local-id grammar
}

/** ch1's world has drawer and cabinet; ch2 has no world; ch3's world did not decode; ch4's has reef. */
const PUZZLES = new Map<ChapterId, ReadonlySet<PuzzleLocalId> | null>([
  ['ch1' as ChapterId, puzzleSet(['drawer', 'cabinet'])],
  ['ch2' as ChapterId, puzzleSet([])],
  ['ch3' as ChapterId, null],
  ['ch4' as ChapterId, puzzleSet(['reef'])],
]);

type Json = Readonly<Record<string, unknown>>;

function t(ru: string, en: string): Json {
  return { ru, en };
}

function ach(when: unknown, over: Json = {}): Json {
  return { hidden: false, when, name: t('Название', 'A name'), desc: t('Описание достижения', 'An achievement description'), ...over };
}

const MANOR_ENDINGS: Json = { truth: t('Правда', 'The truth'), ashes: t('Пепел', 'Ashes') };
const TIDE_ENDINGS: Json = { drowned: t('Утонувший', 'Drowned') };
/** One achievement of every condition kind, all valid for manor. */
const MANOR_ACHIEVEMENTS: Json = {
  found_truth: ach({ ending: 'truth' }),
  two_ends: ach({ endings: 2 }),
  every_end: ach({ allEndings: true }, { hidden: true }),
  kind_word: ach({ choice: 'ch1.hall.c002' }),
  archive_done: ach({ chapter: 'ch2' }),
  drawer_clean: ach({ puzzle: 'ch1.drawer', hints: 0 }),
  cabinet_open: ach({ puzzle: 'ch1.cabinet' }),
  both: ach({ all: [{ ending: 'ashes' }, { choice: 'ch1.study.c003' }] }),
};

function story(endings: Json, achievements: Json = {}): Json {
  return { endings, achievements };
}

const CLEAN: Json = { manor: story(MANOR_ENDINGS, MANOR_ACHIEVEMENTS), tide: story(TIDE_ENDINGS) };

/** CLEAN with one achievement `probe` of the given condition in `id`'s entry (its endings kept). */
function probe(when: unknown, id: 'manor' | 'tide' = 'manor'): Json {
  return { ...CLEAN, [id]: story(id === 'manor' ? MANOR_ENDINGS : TIDE_ENDINGS, { probe: ach(when) }) };
}

type Over = { stories?: readonly StoryPlan[] };

/** The lint's messages for a source (a value is written as JSON, a string as is, null as a missing file). */
function lint(source: Json | string | null, over: Over = {}): { messages: string[]; printed: string[]; meta: unknown } {
  const text = source === null || typeof source === 'string' ? source : JSON.stringify(source);
  const r = lintMeta({ text, stories: over.stories ?? STORIES, choices: CHOICES, puzzles: PUZZLES });
  return {
    messages: r.findings.map((f) => f.message),
    printed: r.findings.map((f) => `${f.severity} ${f.file}:${f.line} ${f.code} ${f.message}`),
    meta: r.meta,
  };
}

function messages(source: Json | string | null, over: Over = {}): string[] {
  return lint(source, over).messages;
}

test('meta: catalog/meta red on fixture', () => {
  const long = (n: number): string => 'я'.repeat(n);
  const rules = {
    // 1. An object of story entries of story/stories.json, each with exactly endings and achievements.
    rule1: [
      ...messages({ ...CLEAN, nowhere: story({}) }),
      ...messages('[]'),
      ...messages('{ "manor": '),
      ...messages({ ...CLEAN, tide: { ...story(TIDE_ENDINGS), cover: 'x' } }),
    ],
    // 2. Exactly the declared endings, each titled in ru and en within 1-40 code points; a declaring story present.
    rule2: [
      ...messages({ ...CLEAN, manor: story({ ...MANOR_ENDINGS, truth: { ru: 'Правда' } }, MANOR_ACHIEVEMENTS) }),
      ...messages({ manor: CLEAN['manor'] }),
      ...messages({ ...CLEAN, tide: story({ ...TIDE_ENDINGS, bonus: t('Бонус', 'Bonus') }) }),
      ...messages({ ...CLEAN, tide: story({ drowned: t(long(41), 'Drowned') }) }),
      ...messages({ ...CLEAN, tide: story({ drowned: t('Утонувший', '   ') }) }),
    ],
    // 3. Achievement ids, the per-story cap, exact keys, a boolean `hidden`, name and desc in ru and en within limits.
    rule3: [
      ...messages({ ...CLEAN, tide: story(TIDE_ENDINGS, { found: ach({ ending: 'drowned' }, { name: { ru: 'Найдено' } }) }) }),
      ...messages({ ...CLEAN, tide: story(TIDE_ENDINGS, { 'Bad-Id': ach({ ending: 'drowned' }) }) }),
      ...messages({ ...CLEAN, tide: story(TIDE_ENDINGS, { found: ach({ ending: 'drowned' }, { hidden: 'no', extra: 1 }) }) }),
      ...messages({ ...CLEAN, tide: story(TIDE_ENDINGS, { found: ach({ ending: 'drowned' }, { desc: t(long(141), 'A description') }) }) }),
      ...messages({ ...CLEAN, tide: story(TIDE_ENDINGS, Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`a${i}`, ach({ ending: 'drowned' })]))) }),
    ],
    // 4. One condition kind per object, `hints: 0` only beside puzzle, an `all` of 2-4 conditions and no nested all.
    rule4: [
      ...messages(probe({ ending: 'truth', chapter: 'ch1' })),
      ...messages(probe({ ending: 'truth', hints: 0 })),
      ...messages(probe({ puzzle: 'ch1.drawer', hints: 1 })),
      ...messages(probe({ never: true })),
      ...messages(probe({ all: [{ ending: 'truth' }] })),
      ...messages(probe({ all: [{ ending: 'truth' }, { all: [{ ending: 'ashes' }, { chapter: 'ch1' }] }] })),
    ],
    // 5. What a condition names exists for the story (the full matrix is the next test).
    rule5: [...messages(probe({ ending: 'nowhere' })), ...messages(probe({ chapter: 'ch3' }))],
  };
  expect(rules).toEqual({
    rule1: [
      'nowhere: not a story of story/stories.json',
      'an array is not a JSON object of stories',
      expect.stringMatching(/^not JSON: /),
      'tide.cover: unknown key (expected endings, achievements)',
    ],
    rule2: [
      'manor.endings.truth.en: missing',
      'tide: missing (it declares endings drowned)',
      'tide.endings.bonus: not an ending tide declares',
      'tide.endings.drowned.ru: 41 code points (1-40)',
      'tide.endings.drowned.en: blank',
    ],
    rule3: [
      'tide.achievements.found.name.en: missing',
      "tide.achievements.Bad-Id: 'Bad-Id' does not match ^[a-z][a-z0-9_]{0,31}$",
      'tide.achievements.found.extra: unknown key (expected hidden, when, name, desc)',
      'tide.achievements.found.hidden: "no" is not a boolean',
      'tide.achievements.found.desc.ru: 141 code points (1-140)',
      'tide.achievements: 51 achievements (at most 50 per story)',
    ],
    rule4: [
      'manor.achievements.probe.when: 2 condition kinds (ending, chapter): a condition has exactly one',
      "manor.achievements.probe.when.hints: beside 'ending': hints only beside puzzle",
      'manor.achievements.probe.when.hints: 1 is not 0',
      'manor.achievements.probe.when.never: unknown key (a condition is one of ending, endings, allEndings, choice, chapter, puzzle, all)',
      'manor.achievements.probe.when: no condition kind',
      'manor.achievements.probe.when.all: 1 conditions (2-4)',
      'manor.achievements.probe.when.all.1: a nested all',
    ],
    rule5: [
      "manor.achievements.probe.when.ending: 'nowhere' is not an ending of manor",
      "manor.achievements.probe.when.chapter: 'ch3' is not on manor's chain (ch1 → ch2)",
    ],
  });

  // One violation per rule in one file: five findings, none stopping the run, each printed under catalog/meta.
  const combined = {
    manor: story({ ...MANOR_ENDINGS, ashes: { ru: 'Пепел' } }, { probe: ach({ ending: 'nowhere' }), twice: ach({ ending: 'truth', chapter: 'ch2' }) }),
    tide: story(TIDE_ENDINGS, { found: ach({ ending: 'drowned' }, { hidden: 1 }) }),
    nowhere: story({}),
  };
  expect(lint(combined).printed).toEqual([
    'E story/meta.json:0 catalog/meta manor.endings.ashes.en: missing',
    "E story/meta.json:0 catalog/meta manor.achievements.probe.when.ending: 'nowhere' is not an ending of manor",
    'E story/meta.json:0 catalog/meta manor.achievements.twice.when: 2 condition kinds (ending, chapter): a condition has exactly one',
    'E story/meta.json:0 catalog/meta tide.achievements.found.hidden: 1 is not a boolean',
    'E story/meta.json:0 catalog/meta nowhere: not a story of story/stories.json',
  ]);
  expect(lint(combined).meta).toBeNull();

  // Control: the clean file decodes to itself, every condition kind included.
  const clean = lint(CLEAN);
  expect(clean.printed).toEqual([]);
  expect(clean.meta).toEqual(CLEAN);
});

test('meta: every declared ending has a title', () => {
  // Two declared endings, one title (the achievements naming ashes judge against the declared endings, so they pass).
  expect(messages({ ...CLEAN, manor: story({ truth: MANOR_ENDINGS['truth'] }, MANOR_ACHIEVEMENTS) })).toEqual(['manor.endings.ashes: missing']);
  // A declaring story absent from the file.
  expect(messages({ manor: CLEAN['manor'] })).toEqual(['tide: missing (it declares endings drowned)']);
  // The file missing while stories declare endings.
  expect(messages(null)).toEqual(['manor: missing (it declares endings truth, ashes)', 'tide: missing (it declares endings drowned)']);
  // Controls: a story without endings may be absent; the file may be missing when no story declares one.
  const quiet = plan('tide', ['ch3', 'ch4']);
  expect(messages({ manor: CLEAN['manor'] }, { stories: [MANOR, quiet] })).toEqual([]);
  expect(lint(null, { stories: [plan('manor', ['ch1', 'ch2']), quiet] })).toEqual({ messages: [], printed: [], meta: {} });
  // A story without endings may still be present, with no title.
  expect(messages({ ...CLEAN, tide: story({}) }, { stories: [MANOR, quiet] })).toEqual([]);
});

test('meta: conditions name existing endings, choices, chapters and puzzles', () => {
  const at = (kind: string): string => `manor.achievements.probe.when.${kind}`;
  // ending: a declared ending of this story only.
  expect(messages(probe({ ending: 'nowhere' }))).toEqual([`${at('ending')}: 'nowhere' is not an ending of manor`]);
  expect(messages(probe({ ending: 'drowned' }))).toEqual([`${at('ending')}: 'drowned' is not an ending of manor`]);
  // endings: an integer in 1..the story's ending count.
  expect(messages(probe({ endings: 0 }))).toEqual([`${at('endings')}: 0 is not between 1 and 2 (the endings manor declares)`]);
  expect(messages(probe({ endings: 3 }))).toEqual([`${at('endings')}: 3 is not between 1 and 2 (the endings manor declares)`]);
  expect(messages(probe({ endings: 1.5 }))).toEqual([`${at('endings')}: 1.5 is not an integer`]);
  // allEndings: true, on a story that declares an ending.
  const quiet = plan('tide', ['ch3', 'ch4']);
  expect(messages({ ...CLEAN, tide: story({}, { probe: ach({ allEndings: true }) }) }, { stories: [MANOR, quiet] })).toEqual([
    'tide.achievements.probe.when.allEndings: tide declares no ending',
  ]);
  expect(messages(probe({ allEndings: false }))).toEqual([`${at('allEndings')}: false is not true`]);
  // choice: an option with text of a chapter on the chain; a text line's ID is no option.
  expect(messages(probe({ choice: 'ch1.hall.t001' }))).toEqual([`${at('choice')}: 'ch1.hall.t001' is not a choice with text of ch1`]);
  expect(messages(probe({ choice: 'ch3.deck.d001' }))).toEqual([`${at('choice')}: 'ch3.deck.d001' is not an option of a chapter on manor's chain`]);
  expect(messages(probe({ choice: 'hall.c001' }))).toEqual([`${at('choice')}: "hall.c001" is not a line ID`]);
  // chapter: on the chain.
  expect(messages(probe({ chapter: 'ch4' }))).toEqual([`${at('chapter')}: 'ch4' is not on manor's chain (ch1 → ch2)`]);
  // puzzle: a puzzle of a chapter on the chain, in that chapter's world.
  expect(messages(probe({ puzzle: 'ch4.reef' }))).toEqual([`${at('puzzle')}: 'ch4.reef' is not a puzzle of a chapter on manor's chain`]);
  expect(messages(probe({ puzzle: 'ch1.attic' }))).toEqual([`${at('puzzle')}: 'ch1.attic' is not a puzzle of ch1's world`]);
  expect(messages(probe({ puzzle: 'ch2.safe' }))).toEqual([`${at('puzzle')}: 'ch2.safe': ch2 has no world`]);
  // Inside an all, the same rules hold, each entry by its own path.
  expect(messages(probe({ all: [{ ending: 'truth' }, { puzzle: 'ch4.reef' }] }))).toEqual([
    `${at('all')}.1.puzzle: 'ch4.reef' is not a puzzle of a chapter on manor's chain`,
  ]);

  // Not judged: a choice into a chapter that did not compile (absent from the choice maps), a puzzle into a world that
  // did not decode (null): those chapters' own errors fail the run.
  const tide = (when: unknown): string[] => messages(probe(when, 'tide'));
  expect(tide({ choice: 'ch4.shore.s001' })).toEqual([]);
  expect(tide({ puzzle: 'ch3.anything' })).toEqual([]);
  // Controls: the same kinds, naming what exists.
  expect(tide({ choice: 'ch3.deck.d001' })).toEqual([]);
  expect(tide({ puzzle: 'ch4.reef', hints: 0 })).toEqual([]);
  expect(tide({ chapter: 'ch4' })).toEqual([]);
  expect(tide({ endings: 1 })).toEqual([]);
  expect(tide({ allEndings: true })).toEqual([]);
  expect(tide({ ending: 'drowned' })).toEqual([]);
});

// ---------------------------------------------------------------------------------------------------------------
// choicePoints: one weave level of one knot or stitch (M2)

function committedAssets(): AssetIndex {
  const text = readFileSync(new URL('../../../assets/catalog.json', import.meta.url), 'utf8');
  const catalog = decodeAssetCatalog(JSON.parse(text.startsWith(String.fromCharCode(0xfeff)) ? text.slice(1) : text));
  if (!catalog.ok) {
    throw new Error('invariant: the committed catalog decodes');
  }
  return assetIndex(catalog.value);
}

const ASSETS = committedAssets();

/** ch1's choice map as the gate builds it: the graph's lines over `ch1/main.ink` (from `body`) and the globals. */
function pointsOf(body: readonly string[], extra: Readonly<Record<string, string>> = {}): Record<string, string> {
  const files = ['ch1/main.ink', GLOBALS_PATH, ...Object.keys(extra)];
  const main = ['INCLUDE ../common/globals.ink', ...Object.keys(extra).map((f) => `INCLUDE ${f.slice('ch1/'.length)}`), '-> start', ...body].join('\n');
  const sources = new Map([['ch1/main.ink', `${main}\n`], [GLOBALS_PATH, 'VAR g_trust = 0\n'], ...Object.entries(extra)]);
  const chapter = { id: 'ch1' as ChapterId, paid: false, entry: 'ch1/main.ink' }; // a fixture id
  const { graph } = buildGraph({ chapter, files, sources, assets: ASSETS });
  return Object.fromEntries(choicePoints({ files, sources, lines: graph.lines }));
}

test('meta: choice points split by gathers and knots', () => {
  const body = [
    '=== start ===',
    'Start. #id:ch1.start.t001',
    '* [Block one, first #id:ch1.start.a001]',
    '* [Block one, second #id:ch1.start.a002]',
    '- Gathered. #id:ch1.start.t002',
    '* [Block two, first #id:ch1.start.a003]',
    '* [Block two, second #id:ch1.start.a004]',
    '  -> start_more',
    '= start_more',
    '* [After the stitch, first #id:ch1.start.a005]',
    '  -> b',
    '* [After the stitch, second #id:ch1.start.a006]',
    '  -> c',
    '=== b ===',
    '* [B one #id:ch1.b.b001]',
    '* [B two #id:ch1.b.b002]',
    '- -> END',
    '=== c ===',
    '* [C only #id:ch1.c.c001]',
    '  -> END',
  ];
  expect(pointsOf(body)).toEqual({
    'ch1.start.a001': 'ch1.start.a001',
    'ch1.start.a002': 'ch1.start.a001',
    'ch1.start.a003': 'ch1.start.a003',
    'ch1.start.a004': 'ch1.start.a003',
    'ch1.start.a005': 'ch1.start.a005',
    'ch1.start.a006': 'ch1.start.a005',
    'ch1.b.b001': 'ch1.b.b001',
    'ch1.b.b002': 'ch1.b.b001',
    'ch1.c.c001': 'ch1.c.c001',
  });
  // An included file starts clean, and its options keep their own points (source order: main, then the include).
  const extra = { 'ch1/more.ink': '=== more ===\n* [More one #id:ch1.more.m001]\n* [More two #id:ch1.more.m002]\n- -> END\n' };
  expect(Object.entries(pointsOf(['=== start ===', '* [Go #id:ch1.start.g001]', '  -> more'], extra))).toEqual([
    ['ch1.start.g001', 'ch1.start.g001'],
    ['ch1.more.m001', 'ch1.more.m001'],
    ['ch1.more.m002', 'ch1.more.m001'],
  ]);
});

test('meta: deeper weave is transparent', () => {
  const body = [
    '=== start ===',
    '* [A #id:ch1.start.a000]',
    '  ** [A1 #id:ch1.start.a100]',
    '  ** [A2 #id:ch1.start.a200]',
    '  - - Deeper gather. #id:ch1.start.g200',
    '  ** [A3 #id:ch1.start.a300]',
    '     {',
    '       - g_trust > 0:',
    '         Trusted. #id:ch1.start.t300',
    '       - else:',
    '         Not yet. #id:ch1.start.t301',
    '     }',
    '  ** [A4 #id:ch1.start.a400]',
    '* [B #id:ch1.start.b000]',
    '- -> END',
  ];
  expect(pointsOf(body)).toEqual({
    'ch1.start.a000': 'ch1.start.a000',
    'ch1.start.b000': 'ch1.start.a000',
    'ch1.start.a100': 'ch1.start.a100',
    'ch1.start.a200': 'ch1.start.a100',
    'ch1.start.a300': 'ch1.start.a300',
    'ch1.start.a400': 'ch1.start.a300',
  });
});

test('meta: fallback choices are not options', () => {
  const body = [
    '=== start ===',
    '* [One #id:ch1.start.o001]',
    '  -> END',
    '* [Two #id:ch1.start.o002]',
    '  -> END',
    '* -> fallback_knot',
    '=== fallback_knot ===',
    'Nothing left. #id:ch1.fallback_knot.f001',
    '* [Has an ID #id:ch1.fallback_knot.x002]',
    '  -> END',
  ];
  expect(pointsOf(body)).toEqual({ 'ch1.start.o001': 'ch1.start.o001', 'ch1.start.o002': 'ch1.start.o001', 'ch1.fallback_knot.x002': 'ch1.fallback_knot.x002' });
  // A choice with text but no ID (before --fix-ids) or a malformed one has no graph line: its id/* finding fails the
  // run, and it is no option here and opens no point, so the walk neither throws nor groups the next option under it.
  const unidentified = [
    '=== start ===',
    '* [No ID yet]',
    '  -> END',
    '* [Malformed #id:ch1.start.BAD]',
    '  -> END',
    '* [Has an ID #id:ch1.start.x001]',
    '  -> END',
  ];
  expect(pointsOf(unidentified)).toEqual({ 'ch1.start.x001': 'ch1.start.x001' });
});
