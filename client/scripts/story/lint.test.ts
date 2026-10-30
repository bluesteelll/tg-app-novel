import { readFileSync } from 'node:fs';

import { expect, test } from 'vitest';

import { assetIndex, decodeAssetCatalog, decodeCast } from '../../src/story/catalog.ts';
import type { AssetCatalog, Cast } from '../../src/story/catalog.ts';
import type { AssetIndex, ChapterId } from '../../src/story/staging.ts';
import { GLOBALS_PATH, lintSources } from './lint.ts';
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
  expectAt(lintSources(story(['# fx: boom', 'Text. #id:ch1.start.a001'])), 'tag/unknown-kind', [0]);
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
  const f = lintSources(story(['Text without an id.', 'ally: Hi.', '* [Go]', '  -> END', '- A gather line.']));
  expectAt(f, 'id/missing', [0, 1, 2, 4]);
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
