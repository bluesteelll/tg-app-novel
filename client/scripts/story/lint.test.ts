import { readFileSync } from 'node:fs';

import { expect, test } from 'vitest';

import { assetIndex, decodeAssetCatalog, decodeCast } from '../../src/story/catalog.ts';
import type { AssetCatalog, Cast } from '../../src/story/catalog.ts';
import type { AssetIndex, ChapterId } from '../../src/story/staging.ts';
import { GLOBALS_PATH, lintCatalog, lintSources } from './lint.ts';
import type { Finding, LintCode, SourceChapter, SourceLintInput } from './lint.ts';

// The committed catalog and cast, decoded (a later lane that adds required catalog fields updates both files and
// the decoder together, so these fixtures stay valid).
function readRepoJson(path: string): unknown {
  const text = readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
  return JSON.parse(text.startsWith(String.fromCharCode(0xfeff)) ? text.slice(1) : text);
}

function committed(): { catalog: AssetCatalog; assets: AssetIndex; cast: Cast } {
  const catalog = decodeAssetCatalog(readRepoJson('assets/catalog.json'));
  if (!catalog.ok) {
    throw new Error('invariant: the committed catalog decodes');
  }
  const cast = decodeCast(readRepoJson('story/cast.json'), catalog.value);
  if (!cast.ok) {
    throw new Error('invariant: the committed cast decodes');
  }
  return { catalog: catalog.value, assets: assetIndex(catalog.value), cast: cast.value };
}

const COMMITTED = committed();

function chapterId(id: string): ChapterId {
  return id as ChapterId; // test fixtures name their chapters directly
}

const CH1: SourceChapter = { id: chapterId('ch1'), paid: false, entry: 'ch1/main.ink' };
const ENTRY_HEAD = ['INCLUDE ../common/globals.ink', '-> start', '=== start ==='];
/** Line number of the first body line inside `ch1/main.ink`. */
const BODY = ENTRY_HEAD.length + 1;

/** A well-formed one-chapter story whose `start` knot holds `body`; extra files are added as given. */
function story(body: readonly string[], extra: Record<string, string> = {}, chapters: readonly SourceChapter[] = [CH1]): SourceLintInput {
  const files = new Map<string, string>([
    [GLOBALS_PATH, 'VAR g_trust = 0\n'],
    ['ch1/main.ink', [...ENTRY_HEAD, ...body].join('\n')],
    ...Object.entries(extra),
  ]);
  return { files, chapters, assets: COMMITTED.assets, cast: COMMITTED.cast };
}

function where(findings: readonly Finding[], code: LintCode): string[] {
  return findings.filter((f) => f.code === code).map((f) => `${f.file}:${f.line}`);
}

/** Asserts `code` is reported exactly on `lines` of ch1/main.ink (body-relative, 0-based). */
function expectAt(findings: readonly Finding[], code: LintCode, bodyLines: readonly number[]): void {
  expect(where(findings, code), JSON.stringify(findings, null, 1)).toEqual(bodyLines.map((n) => `ch1/main.ink:${BODY + n}`));
}

test('lint: tag/syntax red on fixture', () => {
  expectAt(lintSources(story(['# BG: Cafe', 'Text. #id:ch1.start.a001'])), 'tag/syntax', [0]);
});

test('lint: tag/unknown-kind red on fixture', () => {
  // Line 4: a tag after a closing `}` is a tag of the compiled story too.
  const f = lintSources(story(['# fx: boom', 'Text. #id:ch1.start.a001', '{ g_trust:', '    In. #id:ch1.start.a002', '} # fx: boom']));
  expectAt(f, 'tag/unknown-kind', [0, 4]);
});

test('lint: tag/missing-arg red on fixture', () => {
  expectAt(lintSources(story(['# show: ally', 'Text. #id:ch1.start.a001 #wait:'])), 'tag/missing-arg', [0, 1]);
});

test('lint: tag/bad-arg red on fixture', () => {
  const f = lintSources(story(['# bg: cafe ms=10001', 'Text. #id:ch1.start.a001 #sfx: door vol=101', '# wait: 49 ms=1']));
  expectAt(f, 'tag/bad-arg', [0, 1, 2]);
});

test('lint: tag/unknown-asset red on fixture', () => {
  const f = lintSources(story(['# bg: nowhere', 'ally: Hi. #show: ally grin #id:ch1.start.a001', '# bg: constructor', 'Text. #id:ch1.start.a002']));
  expectAt(f, 'tag/unknown-asset', [0, 1, 2]);
});

test('lint: tag/dynamic red on fixture', () => {
  const f = lintSources(story(['# show: {who} smile', 'Text. #id:ch1.start.a001 #sfx: {sound}']));
  expectAt(f, 'tag/dynamic', [0, 1]);
  // A dynamic tag is reported once, as dynamic, not also as a grammar error.
  expect(where(f, 'tag/syntax')).toEqual([]);
});

test('lint: tag/in-choice red on fixture', () => {
  const f = lintSources(story(['* [Leave #sfx: door #id:ch1.start.c001]', '  -> END', '* Stay #bg: cafe #id:ch1.start.c002']));
  expectAt(f, 'tag/in-choice', [0, 2]);
});

test('lint: tag/after-choice-bracket red on fixture', () => {
  const f = lintSources(story(['* [Go #id:ch1.start.c001] #bg: cafe', '  -> END', '* [Run #id:ch1.start.c002] -> END #id:ch1.start.c003']));
  expectAt(f, 'tag/after-choice-bracket', [0, 2]);
});

test('lint: batch/conflict red on fixture', () => {
  const f = lintSources(
    story([
      '# bg: cafe', // 0
      '// a comment inside the run is transparent', // 1
      '# bg: room', // 2: conflicts with line 0
      'Text. #id:ch1.start.a001', // 3
      '# show: ally smile', // 4
      'ally: Hi. #hide: ally #id:ch1.start.a002', // 5: conflicts with line 4
      '# hide: all', // 6
      '# show: stranger neutral', // 7: D5, `all` names every character
      'Text. #id:ch1.start.a003', // 8
      '# scene: cafe', // 9
      '# show: ally smile', // 10: allowed with a scene
      'Text. #id:ch1.start.a004 #sfx: door #sfx: steps', // 11: two sfx are allowed
    ]),
  );
  expectAt(f, 'batch/conflict', [2, 5, 7]);
});

test('lint: id/missing red on fixture', () => {
  const f = lintSources(
    story([
      'Text without an id.', // 0
      'ally: Hi.', // 1
      '* [Go]', // 2
      '  -> END', // 3
      '- A gather line.', // 4
      '{ g_trust:', // 5
      '    In. #id:ch1.start.a001', // 6
      '} Text without an id.', // 7: ink prints the text after a closing `}`
    ]),
  );
  expectAt(f, 'id/missing', [0, 1, 2, 4, 7]);
});

test('lint: id/format red on fixture', () => {
  const f = lintSources(story(['Text. #id:ch1.start.BAD1', '* [Go #id:ch1.start]', '  -> END']));
  expectAt(f, 'id/format', [0, 1]);
});

test('lint: id/multiple red on fixture', () => {
  const f = lintSources(story(['Text. #id:ch1.start.a001 #id:ch1.start.a002', '* [Go #id:ch1.start.c001 #id:ch1.start.c002]', '  -> END']));
  expectAt(f, 'id/multiple', [0, 1]);
});

test('lint: id/duplicate red on fixture', () => {
  // Two files of one chapter: the second occurrence in walk order (entry first) is the duplicate.
  const input = story(['Text. #id:ch1.start.d001', 'Again. #id:ch1.start.d002', 'Repeat. #id:ch1.start.d002', '-> END'], {
    'ch1/other.ink': '=== other ===\nElsewhere. #id:ch1.start.d001\n-> END',
  });
  const main = input.files.get('ch1/main.ink') ?? '';
  const files = new Map(input.files).set('ch1/main.ink', main.replace('-> start', 'INCLUDE other.ink\n-> start'));
  const f = lintSources({ ...input, files });
  expect(where(f, 'id/duplicate')).toEqual([`ch1/main.ink:${BODY + 3}`, 'ch1/other.ink:2']);
  // The same ID in two chapters is L3c's cross-chapter check, not a within-chapter duplicate.
  const ch2: SourceChapter = { id: chapterId('ch2'), paid: true, entry: 'ch2/main.ink' };
  const two = story(['Text. #id:ch1.start.d001', '-> END'], { 'ch2/main.ink': 'INCLUDE ../common/globals.ink\n-> start\n=== start ===\nText. #id:ch1.start.d001\n-> END' }, [CH1, ch2]);
  expect(where(lintSources(two), 'id/duplicate')).toEqual([]);
});

test('lint: id/chapter-prefix red on fixture', () => {
  const f = lintSources(story(['Text. #id:ch2.start.p001', '* [Go #id:ch10.start.p002]', '  -> END', 'Fine. #id:ch1.start.p003']));
  expectAt(f, 'id/chapter-prefix', [0, 1]);
});

test('lint: id/on-non-text red on fixture', () => {
  const f = lintSources(
    story(['# id:ch1.start.t001', 'Text. #id:ch1.start.t002', '~ g_trust = 1 #id:ch1.start.t003', '* [#id:ch1.start.t004] -> END', '-> END #id:ch1.start.t005']),
  );
  expectAt(f, 'id/on-non-text', [0, 2, 3, 4]);
});

test('lint: speaker/unknown red on fixture', () => {
  const f = lintSources(story(['ghost: Boo. #id:ch1.start.s001', 'constructor: Hi. #id:ch1.start.s002', 'voice: Hello? #id:ch1.start.s003']));
  expectAt(f, 'speaker/unknown', [0, 1]);
});

test('lint: speaker/in-choice red on fixture', () => {
  const f = lintSources(story(['* [ally: Hi #id:ch1.start.c001]', '  -> END', '* [Hi #id:ch1.start.c002]', '  -> END']));
  expectAt(f, 'speaker/in-choice', [0]);
});

test('lint: choice/text-after red on fixture', () => {
  const f = lintSources(story(['* [Go #id:ch1.start.c001] You go.', '  -> END', '* Plain choice #id:ch1.start.c002', '  -> END', '* [Ok #id:ch1.start.c003] -> END']));
  expectAt(f, 'choice/text-after', [0, 2]);
});

test('lint: choice/too-many red on fixture', () => {
  const five = [1, 2, 3, 4, 5].flatMap((n) => [`* [Option ${n} #id:ch1.start.c00${n}]`, '  -> END']);
  const f = lintSources(
    story([
      ...five, // the 5th choice is at body line 8
      '- (after) Gathered. #id:ch1.start.g001', // 10: a gather closes the block
      ...[1, 2, 3, 4].flatMap((n) => [`* [Again ${n} #id:ch1.start.e00${n}]`, '  -> END']),
      '* -> END', // a fallback choice is not counted
    ]),
  );
  expectAt(f, 'choice/too-many', [8]);
  expect(f.find((x) => x.code === 'choice/too-many')?.severity).toBe('W');
});

test('lint: text/inline-logic red on fixture', () => {
  const f = lintSources(
    story(['Hi, {name}! #id:ch1.start.i001', '{g_trust: Yes|No} #id:ch1.start.i002', '* [Go {now} #id:ch1.start.i003]', '  -> END', 'A \\{ literal brace. #id:ch1.start.i004']),
  );
  expectAt(f, 'text/inline-logic', [0, 1, 2]);
});

test('lint: text/glue red on fixture', () => {
  const f = lintSources(story(['Hello <> #id:ch1.start.g001', '<> world #id:ch1.start.g002', '~ g_trust = 1']));
  expectAt(f, 'text/glue', [0, 1]);
});

test('lint: text/divert-on-line red on fixture', () => {
  const f = lintSources(story(['Go now. -> END #id:ch1.start.v001', '- Gather. -> END #id:ch1.start.v002', '-> END']));
  expectAt(f, 'text/divert-on-line', [0, 1]);
});

test('lint: text/long red on fixture', () => {
  // Graphemes, not UTF-16 units: an emoji with a skin-tone modifier is 4 units, e + a combining acute is 2.
  const thumb = String.fromCodePoint(0x1f44d, 0x1f3fd);
  const accented = `e${String.fromCodePoint(0x301)}`;
  const g160 = `${thumb.repeat(80)}${accented.repeat(80)}`;
  expect(g160.length).toBeGreaterThan(160);
  const f = lintSources(
    story([
      `ally: ${g160} #id:ch1.start.l001`, // 160 graphemes after the speaker prefix: clean
      `${g160}x #id:ch1.start.l002`, // 161
    ]),
  );
  expectAt(f, 'text/long', [1]);
  expect(f.find((x) => x.code === 'text/long')?.severity).toBe('W');
});

test('lint: allowed line forms raise nothing', () => {
  const f = lintSources(
    story([
      '# scene: cafe',
      '# show: ally neutral at=left',
      '# bgm: calm',
      'The rain had not stopped. #id:ch1.start.a001',
      'ally: You came. #show: ally smile #id:ch1.start.a002',
      'Use the \\# key. #id:ch1.start.a003',
      '* {g_trust > 1} [Trust her #id:ch1.start.c001]',
      '    ~ g_trust += 1',
      '    -> END',
      '+ [Wait #id:ch1.start.c002]',
      '    -> END',
      '* -> END',
      '- (after) Gathered. #id:ch1.start.g001',
      '{ g_trust:',
      '    ally: Yes. #id:ch1.start.b001',
      '- else:',
      '    ally: No. #id:ch1.start.b002',
      '}',
      '{ stopping:',
      '    - First visit. #id:ch1.start.q001',
      '    - voice: Again? #id:ch1.start.q002',
      '}',
      '-> END',
    ]),
  );
  expect(f).toEqual([]);
});

// ---------------------------------------------------------------------------------------------------------------
// File- and chapter-level rules

/** A story given file by file (story-relative path → lines), with ch1 as the only chapter unless told otherwise. */
function files(sources: Record<string, readonly string[]>, chapters: readonly SourceChapter[] = [CH1]): SourceLintInput {
  const map = new Map<string, string>([[GLOBALS_PATH, 'VAR g_trust = 0']]);
  for (const [path, lines] of Object.entries(sources)) {
    map.set(path, lines.join('\n'));
  }
  return { files: map, chapters, assets: COMMITTED.assets, cast: COMMITTED.cast };
}

/** An entry file's lines: the globals INCLUDE first, then `rest`. */
function entry(...rest: string[]): string[] {
  return ['INCLUDE ../common/globals.ink', ...rest];
}

/** `input` with common/globals.ink replaced by `lines`. */
function withGlobals(input: SourceLintInput, lines: readonly string[]): SourceLintInput {
  return { ...input, files: new Map(input.files).set(GLOBALS_PATH, lines.join('\n')) };
}

test('lint: tag/global red on fixture', () => {
  const f = lintSources(
    files({
      'ch1/main.ink': entry('INCLUDE extra.ink', '# bgm: calm', '-> start', '=== start ===', 'Hi. #id:ch1.start.a001', '-> END'),
      'ch1/extra.ink': ['# scene: cafe', '=== extra ===', '# scene: street', 'There. #id:ch1.extra.a001', '-> END'],
    }),
  );
  expect(where(f, 'tag/global')).toEqual(['ch1/extra.ink:1', 'ch1/main.ink:3']);
});

// [case, top-level lines after the globals INCLUDE, knot body lines, line of the finding in ch1/main.ink]
const FORBIDDEN: ReadonlyArray<readonly [string, readonly string[], readonly string[], number]> = [
  ['external', ['EXTERNAL play_sound(name)'], [], 2],
  ['thread', [], ['<- background', 'Hi. #id:ch1.start.a001'], 4],
  ['done', [], ['Hi. #id:ch1.start.a001', '-> DONE'], 5],
  ['tunnel call', [], ['-> start ->', 'Hi. #id:ch1.start.a001'], 4],
  ['tunnel return', [], ['Hi. #id:ch1.start.a001', '->->'], 5],
  ['knot parameter', [], ['Hi. #id:ch1.start.a001', '-> END', '=== other(x) ===', 'Bye. #id:ch1.other.a001'], 6],
  ['stitch parameter', [], ['Hi. #id:ch1.start.a001', '-> END', '= part(x)', 'Bye. #id:ch1.start.a002'], 6],
  ['list', ['LIST mood = calm, angry'], [], 2],
];
for (const [name, top, body, line] of FORBIDDEN) {
  test(`lint: ink/forbidden red on fixture (${name})`, () => {
    const knot = body.length > 0 ? body : ['Hi. #id:ch1.start.a001'];
    const main = entry(...top, '-> start', '=== start ===', ...knot, '-> END');
    expect(where(lintSources(files({ 'ch1/main.ink': main })), 'ink/forbidden')).toEqual([`ch1/main.ink:${line}`]);
  });
}

test('lint: ink/name red on fixture', () => {
  const main = entry('-> start', '=== start ===', '-> Big', '=== Big ===', '= Intro', '-> END', '=== café ===', '-> END');
  const f = lintSources(files({ 'ch1/main.ink': [...main, '=== 1k ===', '-> END', '=== ok_2 ===', '= fine_1', '-> END'] }));
  expect(where(f, 'ink/name')).toEqual(['ch1/main.ink:5', 'ch1/main.ink:6', 'ch1/main.ink:8', 'ch1/main.ink:10']);
});

test('lint: ink/include red on fixture (outside dirs)', () => {
  const f = lintSources(
    files({
      'ch1/main.ink': entry('INCLUDE ../ch2/scene.ink', 'INCLUDE ../../outside.ink', 'INCLUDE ok.ink', '-> start', '=== start ===', '-> END'),
      'ch1/ok.ink': ['=== ok ===', '-> END'],
      'ch2/scene.ink': ['=== scene ===', '-> END'],
    }),
  );
  expect(where(f, 'ink/include')).toEqual(['ch1/main.ink:2', 'ch1/main.ink:3']);
});

test('lint: ink/include red on fixture (paid file in a free chapter)', () => {
  // The paid chapter's directory sits inside the free one's, so only the principle-0 branch can catch this include.
  const ch2: SourceChapter = { id: chapterId('ch2'), paid: true, entry: 'ch1/paid/main.ink' };
  const f = lintSources(
    files(
      {
        'ch1/main.ink': entry('INCLUDE paid/scene.ink', 'INCLUDE own.ink', '-> start', '=== start ===', '-> END'),
        'ch1/own.ink': ['=== own ===', '-> END'],
        'ch1/paid/main.ink': ['INCLUDE ../../common/globals.ink', '-> paid_start', '=== paid_start ===', '-> END'],
        'ch1/paid/scene.ink': ['=== secret ===', 'The secret. #id:ch1.secret.s001', '-> END'],
      },
      [CH1, ch2],
    ),
  );
  const include = f.filter((x) => x.code === 'ink/include');
  expect(include.map((x) => `${x.file}:${x.line}`)).toEqual(['ch1/main.ink:2']);
  expect(include[0]?.message).toContain('free chapter ch1 includes a file of paid chapter ch2');
});

test('lint: ink/include red on fixture (two chapters)', () => {
  const a: SourceChapter = { id: chapterId('ch1'), paid: false, entry: 'book/one.ink' };
  const b: SourceChapter = { id: chapterId('ch2'), paid: false, entry: 'book/two.ink' };
  const f = lintSources(
    files(
      {
        'book/one.ink': ['INCLUDE ../common/globals.ink', 'INCLUDE shared.ink', '-> one', '=== one ===', '-> END'],
        'book/two.ink': ['INCLUDE ../common/globals.ink', 'INCLUDE shared.ink', '-> two', '=== two ===', '-> END'],
        'book/shared.ink': ['=== shared ===', '-> END'],
      },
      [a, b],
    ),
  );
  expect(where(f, 'ink/include')).toEqual(['book/one.ink:2', 'book/two.ink:2']);
});

test('lint: ink/include red on fixture (nested include resolves from the entry dir)', () => {
  // From the entry dir, sub/a.ink's `../ch2/x.ink` is ch2/x.ink (outside ch1/); from sub/ it would be ch1/ch2/x.ink.
  const f = lintSources(
    files({
      'ch1/main.ink': entry('INCLUDE sub/a.ink', '-> start', '=== start ===', '-> END'),
      'ch1/sub/a.ink': ['INCLUDE ../ch2/x.ink', 'INCLUDE sub/b.ink', '=== a ===', '-> END'],
      'ch1/sub/b.ink': ['=== b ===', 'Reached. #id:ch2.b.0001', '-> END'],
      'ch2/x.ink': ['=== x ===', '-> END'],
    }),
  );
  expect(where(f, 'ink/include')).toEqual(['ch1/sub/a.ink:1']);
  // sub/b.ink, resolved from the entry dir, is reached: its lines are checked as ch1's.
  expect(where(f, 'id/chapter-prefix')).toEqual(['ch1/sub/b.ink:2']);
});

test('lint: ink/entry red on fixture (top-level text)', () => {
  const main = entry('INCLUDE extra.ink', 'VAR ch1_seen = false', 'Hello there. #id:ch1.start.a001', '-> start', '-> start');
  const f = lintSources(
    files({
      'ch1/main.ink': [...main, '~ ch1_seen = true', '=== start ===', '-> END'],
      // An included file's top level is compiled into the entry's root flow, before the divert.
      'ch1/extra.ink': ['CONST ch1_max = 3', 'Stray text. #id:ch1.extra.a001', '=== extra ===', '-> END'],
    }),
  );
  expect(where(f, 'ink/entry')).toEqual(['ch1/extra.ink:2', 'ch1/main.ink:4', 'ch1/main.ink:6', 'ch1/main.ink:7']);
  const none = lintSources(files({ 'ch1/main.ink': entry('=== start ===', '-> END') }));
  expect(where(none, 'ink/entry')).toEqual(['ch1/main.ink:2']);
});

test('lint: ink/entry red on fixture (first line)', () => {
  const late = ['// header comment', 'VAR ch1_x = 1', 'INCLUDE ../common/globals.ink', '-> start', '=== start ===', '-> END'];
  expect(where(lintSources(files({ 'ch1/main.ink': late })), 'ink/entry')).toEqual(['ch1/main.ink:2']);
  const wrong = ['INCLUDE globals.ink', '-> start', '=== start ===', '-> END'];
  expect(where(lintSources(files({ 'ch1/main.ink': wrong })), 'ink/entry')).toEqual(['ch1/main.ink:1']);
});

test('lint: vars/global-prefix red on fixture (no prefix)', () => {
  const input = files({ 'ch1/main.ink': entry('-> start', '=== start ===', '-> END') });
  const f = lintSources(withGlobals(input, ['VAR g_ok = 1', 'VAR trust = 0']));
  expect(where(f, 'vars/global-prefix')).toEqual([`${GLOBALS_PATH}:2`]);
});

test('lint: vars/global-prefix red on fixture (not scalar)', () => {
  const input = files({ 'ch1/main.ink': entry('-> start', '=== start ===', '-> END') });
  const quoted = 'VAR g_text = "say \\"hi\\""';
  const globals = ['VAR g_int = -3', 'VAR g_float = 0.5', 'VAR g_bool = true', quoted, 'VAR g_ref = g_int', 'VAR g_sum = 1 + 2', 'VAR g_list = (a, b)'];
  const f = lintSources(withGlobals(input, globals));
  expect(where(f, 'vars/global-prefix')).toEqual([5, 6, 7].map((n) => `${GLOBALS_PATH}:${n}`));
});

test('lint: vars/global-prefix red on fixture (declared elsewhere)', () => {
  const f = lintSources(
    files({ 'ch1/main.ink': entry('VAR g_local = 1', 'CONST g_max = 2', 'VAR ch1_ok = 0', '-> start', '=== start ===', '-> END') }),
  );
  expect(where(f, 'vars/global-prefix')).toEqual(['ch1/main.ink:2', 'ch1/main.ink:3']);
});

test('lint: vars/global-prefix red on fixture (text in globals)', () => {
  const input = files({ 'ch1/main.ink': entry('-> start', '=== start ===', '-> END') });
  const globals = [
    'VAR g_trust = 0', // 1
    'Hello from globals.', // 2
    '=== function twice(x) ===', // 3
    '~ return x * 2', // 4
    'Output in a function. #id:ch1.g.0001', // 5
    '=== scene ===', // 6
    '= part', // 7
    '# bg: cafe', // 8
  ];
  const f = lintSources(withGlobals(input, globals));
  expect(where(f, 'vars/global-prefix')).toEqual([2, 5, 6, 7, 8].map((n) => `${GLOBALS_PATH}:${n}`));
});

/** A fresh, mutable parse of the committed assets/catalog.json. */
function rawCatalog(): { bg: Record<string, unknown>; [key: string]: unknown } {
  return JSON.parse(readFileSync(new URL('../../../assets/catalog.json', import.meta.url), 'utf8'));
}

function catalogFindings(catalog: unknown, cast: unknown): string[] {
  return lintCatalog(catalog, cast)
    .findings.filter((x) => x.code === 'catalog/assets')
    .map((x) => `${x.file}: ${x.message}`);
}

test('lint: catalog/assets red on fixture (reserved id)', () => {
  const raw = rawCatalog();
  raw.bg['all'] = {};
  const found = catalogFindings(raw, readRepoJson('story/cast.json'));
  expect(found.some((m) => m.startsWith('assets/catalog.json: bg.all:')), JSON.stringify(found)).toBe(true);
  expect(lintCatalog(raw, readRepoJson('story/cast.json')).catalog).toBeNull();
});

test('lint: catalog/assets red on fixture (bad key)', () => {
  const raw = rawCatalog();
  raw.bg['Bad'] = {};
  const found = catalogFindings(raw, readRepoJson('story/cast.json'));
  expect(found.some((m) => m.startsWith('assets/catalog.json: bg.Bad:')), JSON.stringify(found)).toBe(true);
});

test('lint: catalog/assets red on fixture (cast char missing)', () => {
  const found = catalogFindings(rawCatalog(), { ally: { char: 'ally' }, ghost: { char: 'ghost' } });
  expect(found.some((m) => m.startsWith('story/cast.json: ghost.char:')), JSON.stringify(found)).toBe(true);
  // The committed pair is clean: the control for the three catalog cases.
  const clean = lintCatalog(rawCatalog(), readRepoJson('story/cast.json'));
  expect(clean.findings).toEqual([]);
  expect(clean.cast).toEqual({ ally: { char: 'ally' }, stranger: { char: 'stranger' }, voice: { char: null } });
});

test('lint: allowed structure raises nothing', () => {
  const ch2: SourceChapter = { id: chapterId('ch2'), paid: true, entry: 'ch2/main.ink' };
  const main = entry('INCLUDE scenes.ink', 'VAR ch1_asked = false', 'CONST ch1_max = 3', '-> start', '=== start ===');
  const input = files(
    {
      'ch1/main.ink': [...main, 'Hi. #id:ch1.start.a001', '-> start.later', '= later', '~ g_trust = twice(g_trust)', '-> scenes', '=== ending ===', '-> END'],
      'ch1/scenes.ink': ['=== scenes ===', '# scene: cafe', 'Cafe. #id:ch1.scenes.a001', '-> ending'],
      // common/ is reached by both chapters: allowed, every chapter includes globals.ink.
      'ch2/main.ink': ['INCLUDE ../common/globals.ink', '-> begin', '=== begin ===', 'Paid. #id:ch2.begin.a001', '-> END'],
    },
    [CH1, ch2],
  );
  const f = lintSources(withGlobals(input, ['VAR g_trust = 0', 'VAR g_name = "Ally"', '=== function twice(x) ===', '~ return x * 2']));
  expect(f).toEqual([]);
});

test('lint: every finding is reported', () => {
  const f = lintSources(
    files({
      'ch1/main.ink': entry(
        '# bgm: calm', // 2: tag/global
        '-> Start',
        '=== Start ===', // 4: ink/name
        'ghost: Hello. #id:ch1.start.ab12', // 5: speaker/unknown
        'Hi <> there. #id:ch1.start.cd34', // 6: text/glue
        'Bye. #id:ch2.start.ef56', // 7: id/chapter-prefix
        '{ g_trust:',
        '    In. #id:ch1.start.gh78',
        '} -> DONE', // 10: ink/forbidden, a divert after a closing `}`
        '-> END',
      ),
    }),
  );
  expect(f.map((x) => `${x.line} ${x.code}`)).toEqual([
    '2 tag/global',
    '4 ink/name',
    '5 speaker/unknown',
    '6 text/glue',
    '7 id/chapter-prefix',
    '10 ink/forbidden',
  ]);
});
