import { expect, test } from 'vitest';

import { classify, openingTagLines } from './classify.ts';
import type { LineClass } from './classify.ts';

function classes(source: string): LineClass[] {
  return classify(source).map((l) => l.cls);
}

function src(...lines: string[]): string {
  return lines.join('\n');
}

test('classify: knots, stitches and functions', () => {
  const lines = classify(
    src(
      'Top text.',
      '=== cafe ===',
      'Hello.',
      '= intro',
      'Hi.',
      '== street',
      'Bye.',
      '=== function lerp(a, b) ===',
      '~ return a',
      '=== k(x) ===',
      '= s(y)',
      '===Big Knot===',
    ),
  );
  expect(lines.map((l) => l.cls)).toEqual([
    { kind: 'text', speaker: null, text: 'Top text.', tags: [], diverts: [] },
    { kind: 'knot', name: 'cafe', params: null, fn: false },
    { kind: 'text', speaker: null, text: 'Hello.', tags: [], diverts: [] },
    { kind: 'stitch', name: 'intro', params: null },
    { kind: 'text', speaker: null, text: 'Hi.', tags: [], diverts: [] },
    { kind: 'knot', name: 'street', params: null, fn: false },
    { kind: 'text', speaker: null, text: 'Bye.', tags: [], diverts: [] },
    { kind: 'knot', name: 'lerp', params: 'a, b', fn: true },
    { kind: 'logic', code: 'return a', tags: [] },
    { kind: 'knot', name: 'k', params: 'x', fn: false },
    { kind: 'stitch', name: 's', params: 'y' },
    { kind: 'knot', name: 'Big Knot', params: null, fn: false },
  ]);
  expect(lines.map((l) => [l.line, l.knot, l.stitch])).toEqual([
    [1, null, null],
    [2, 'cafe', null],
    [3, 'cafe', null],
    [4, 'cafe', 'intro'],
    [5, 'cafe', 'intro'],
    [6, 'street', null],
    [7, 'street', null],
    [8, 'lerp', null],
    [9, 'lerp', null],
    [10, 'k', null],
    [11, 'k', 's'],
    [12, 'Big Knot', null],
  ]);
});

test('classify: tag-only, text and speaker lines', () => {
  expect(
    classes(
      src(
        '# scene: cafe',
        '  #show: ally smile at=left #bgm: calm',
        'ally: You came after all. #show: ally smile #id:ch1.cafe.k3x9',
        'The rain had not stopped. #id:ch1.cafe.p2m7',
        'Note: not a speaker.',
        '    voice: Is anyone there?',
        'ally:no space #id:ch1.cafe.n0sp',
        'Привет, мир. #id:ch1.cafe.ru01',
      ),
    ),
  ).toEqual([
    { kind: 'tags', tags: [{ text: 'scene: cafe', col: 1 }] },
    {
      kind: 'tags',
      tags: [
        { text: 'show: ally smile at=left', col: 3 },
        { text: 'bgm: calm', col: 29 },
      ],
    },
    {
      kind: 'text',
      speaker: 'ally',
      text: 'You came after all.',
      tags: [
        { text: 'show: ally smile', col: 27 },
        { text: 'id:ch1.cafe.k3x9', col: 45 },
      ],
      diverts: [],
    },
    {
      kind: 'text',
      speaker: null,
      text: 'The rain had not stopped.',
      tags: [{ text: 'id:ch1.cafe.p2m7', col: 27 }],
      diverts: [],
    },
    { kind: 'text', speaker: null, text: 'Note: not a speaker.', tags: [], diverts: [] },
    { kind: 'text', speaker: 'voice', text: 'Is anyone there?', tags: [], diverts: [] },
    {
      kind: 'text',
      speaker: null,
      text: 'ally:no space',
      tags: [{ text: 'id:ch1.cafe.n0sp', col: 15 }],
      diverts: [],
    },
    { kind: 'text', speaker: null, text: 'Привет, мир.', tags: [{ text: 'id:ch1.cafe.ru01', col: 14 }], diverts: [] },
  ]);
});

test('classify: choices split condition, bracket, tags and divert', () => {
  const base = { label: null, condition: null, afterTags: [], diverts: [] };
  expect(
    classes(
      src(
        '* [Show her the letter #id:ch1.cafe.c4tz]',
        '* {g_trust_ally > 1} [Trust her #id:ch1.cafe.t001] -> street',
        '+ (again) [Wait #id:ch1.cafe.w001]',
        '    ** [Deeper #id:ch1.cafe.d001]',
        '* [Leave #sfx: door] You leave.',
        '* -> fallback',
        '* Hello there #id:ch1.cafe.h001',
        '* [Go] #bg: cafe',
        '* * {a} {b > 1} [Two levels #id:ch1.cafe.t002]',
        '* Before [inside] after',
        '* [Use \\# key #id:ch1.cafe.k001]',
      ),
    ),
  ).toEqual([
    {
      ...base,
      kind: 'choice',
      depth: 1,
      sticky: false,
      outside: '',
      bracket: { text: 'Show her the letter', tags: [{ text: 'id:ch1.cafe.c4tz', col: 24 }] },
    },
    {
      ...base,
      kind: 'choice',
      depth: 1,
      sticky: false,
      condition: '{g_trust_ally > 1}',
      outside: '',
      bracket: { text: 'Trust her', tags: [{ text: 'id:ch1.cafe.t001', col: 33 }] },
      diverts: [{ target: 'street', col: 52, tunnel: false }],
    },
    {
      ...base,
      kind: 'choice',
      depth: 1,
      sticky: true,
      label: 'again',
      outside: '',
      bracket: { text: 'Wait', tags: [{ text: 'id:ch1.cafe.w001', col: 17 }] },
    },
    {
      ...base,
      kind: 'choice',
      depth: 2,
      sticky: false,
      outside: '',
      bracket: { text: 'Deeper', tags: [{ text: 'id:ch1.cafe.d001', col: 16 }] },
    },
    {
      ...base,
      kind: 'choice',
      depth: 1,
      sticky: false,
      outside: 'You leave.',
      bracket: { text: 'Leave', tags: [{ text: 'sfx: door', col: 10 }] },
    },
    {
      ...base,
      kind: 'choice',
      depth: 1,
      sticky: false,
      outside: '',
      bracket: null,
      diverts: [{ target: 'fallback', col: 3, tunnel: false }],
    },
    {
      ...base,
      kind: 'choice',
      depth: 1,
      sticky: false,
      outside: 'Hello there',
      bracket: null,
      afterTags: [{ text: 'id:ch1.cafe.h001', col: 15 }],
    },
    {
      ...base,
      kind: 'choice',
      depth: 1,
      sticky: false,
      outside: '',
      bracket: { text: 'Go', tags: [] },
      afterTags: [{ text: 'bg: cafe', col: 8 }],
    },
    {
      ...base,
      kind: 'choice',
      depth: 2,
      sticky: false,
      condition: '{a} {b > 1}',
      outside: '',
      bracket: { text: 'Two levels', tags: [{ text: 'id:ch1.cafe.t002', col: 29 }] },
    },
    {
      ...base,
      kind: 'choice',
      depth: 1,
      sticky: false,
      outside: 'Before after',
      bracket: { text: 'inside', tags: [] },
    },
    {
      ...base,
      kind: 'choice',
      depth: 1,
      sticky: false,
      outside: '',
      bracket: { text: 'Use \\# key', tags: [{ text: 'id:ch1.cafe.k001', col: 15 }] },
    },
  ]);
});

test('classify: gathers, labels and diverts', () => {
  expect(
    classes(
      src(
        '- (meet) ally: Hi. #id:ch1.a.0001',
        '- - Deeper gather.',
        '-> street',
        '  -> street.intro #id:ch1.a.0002',
        '->->',
        '-> k ->',
        '-> k -> j',
        '-> END',
        '- -> DONE',
        'Hello -> k',
        '-',
      ),
    ),
  ).toEqual([
    {
      kind: 'gather',
      depth: 1,
      label: 'meet',
      speaker: 'ally',
      text: 'Hi.',
      tags: [{ text: 'id:ch1.a.0001', col: 20 }],
      diverts: [],
    },
    { kind: 'gather', depth: 2, label: null, speaker: null, text: 'Deeper gather.', tags: [], diverts: [] },
    { kind: 'divert', diverts: [{ target: 'street', col: 1, tunnel: false }], tunnel: false, tags: [] },
    {
      kind: 'divert',
      diverts: [{ target: 'street.intro', col: 3, tunnel: false }],
      tunnel: false,
      tags: [{ text: 'id:ch1.a.0002', col: 19 }],
    },
    { kind: 'divert', diverts: [{ target: '->', col: 1, tunnel: true }], tunnel: true, tags: [] },
    { kind: 'divert', diverts: [{ target: 'k', col: 1, tunnel: true }], tunnel: true, tags: [] },
    {
      kind: 'divert',
      diverts: [
        { target: 'k', col: 1, tunnel: true },
        { target: 'j', col: 6, tunnel: false },
      ],
      tunnel: true,
      tags: [],
    },
    { kind: 'divert', diverts: [{ target: 'END', col: 1, tunnel: false }], tunnel: false, tags: [] },
    {
      kind: 'gather',
      depth: 1,
      label: null,
      speaker: null,
      text: '',
      tags: [],
      diverts: [{ target: 'DONE', col: 3, tunnel: false }],
    },
    { kind: 'text', speaker: null, text: 'Hello', tags: [], diverts: [{ target: 'k', col: 7, tunnel: false }] },
    { kind: 'gather', depth: 1, label: null, speaker: null, text: '', tags: [], diverts: [] },
  ]);
});

test('classify: comments, escaped hash, CRLF and BOM', () => {
  const source = [
    `${String.fromCharCode(0xfeff)}// a comment`,
    'Use the \\# key. #id:ch1.a.0001',
    'ally: see // aside #id:ch1.cafe.ab12',
    'Hello #id:ch1.x.abcd // note',
    '/* block',
    '# scene: street',
    '*/ # bg: cafe',
    'text /* inline */ more #id:ch1.a.0002',
    'http://example.org #id:ch1.a.0003',
    '',
    '/* unterminated',
    '# cg: letter',
  ].join('\r\n');
  const lines = classify(source);
  expect(lines.map((l) => l.cls)).toEqual([
    { kind: 'comment' },
    { kind: 'text', speaker: null, text: 'Use the \\# key.', tags: [{ text: 'id:ch1.a.0001', col: 17 }], diverts: [] },
    // ink drops everything after `//`, the ID tag included: the lint then sees a line with no ID, as the compiler does.
    { kind: 'text', speaker: 'ally', text: 'see', tags: [], diverts: [] },
    { kind: 'text', speaker: null, text: 'Hello', tags: [{ text: 'id:ch1.x.abcd', col: 7 }], diverts: [] },
    { kind: 'comment' },
    { kind: 'comment' },
    { kind: 'tags', tags: [{ text: 'bg: cafe', col: 2 }] },
    { kind: 'text', speaker: null, text: 'text  more', tags: [{ text: 'id:ch1.a.0002', col: 12 }], diverts: [] },
    { kind: 'text', speaker: null, text: 'http:', tags: [], diverts: [] },
    { kind: 'blank' },
    { kind: 'comment' },
    { kind: 'comment' },
  ]);
  expect(lines.map((l) => l.line)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  expect(lines[0]?.raw).toBe('// a comment');
  expect(lines[2]?.raw).toBe('ally: see // aside #id:ch1.cafe.ab12');
  expect(lines[2]?.code).toBe('ally: see ');
});

test('classify: multi-line conditionals and sequences', () => {
  const none = { speaker: null, text: '', tags: [], diverts: [] };
  expect(
    classes(
      src(
        '{ g_lied_to_ally:',
        '    ally: He knows you lied. #id:ch1.street.l1ed',
        '- else:',
        '    ally: Who is he? #id:ch1.street.wh0h',
        '}',
        '{ stopping:',
        '    - First visit. #id:ch1.a.s001',
        '    - ally: Again. #id:ch1.a.s002',
        '}',
        '{',
        '- g_x > 1: Many. #id:ch1.a.m001',
        '- else:',
        '    { shuffle:',
        '    - One. #id:ch1.a.o001',
        '    }',
        '}',
        // ink prints what follows a closing `}` as an ordinary line: text, tags and diverts are kept.
        '{ g_x:',
        '    Inside. #id:ch1.a.t001',
        '} ally: Tail. #id:ch1.a.t002',
        '{ g_x:',
        '} -> next #bg: cafe',
        '{g_x: inline|text} #id:ch1.a.i001',
        '- A gather again.',
      ),
    ),
  ).toEqual([
    { kind: 'block-open', block: 'conditional', head: 'g_lied_to_ally', ...none },
    {
      kind: 'text',
      speaker: 'ally',
      text: 'He knows you lied.',
      tags: [{ text: 'id:ch1.street.l1ed', col: 30 }],
      diverts: [],
    },
    { kind: 'block-branch', block: 'conditional', head: 'else', ...none },
    { kind: 'text', speaker: 'ally', text: 'Who is he?', tags: [{ text: 'id:ch1.street.wh0h', col: 22 }], diverts: [] },
    { kind: 'block-close', ...none },
    { kind: 'block-open', block: 'sequence', head: 'stopping', ...none },
    {
      kind: 'block-branch',
      block: 'sequence',
      head: '',
      ...none,
      text: 'First visit.',
      tags: [{ text: 'id:ch1.a.s001', col: 20 }],
    },
    {
      kind: 'block-branch',
      block: 'sequence',
      head: '',
      ...none,
      speaker: 'ally',
      text: 'Again.',
      tags: [{ text: 'id:ch1.a.s002', col: 20 }],
    },
    { kind: 'block-close', ...none },
    { kind: 'block-open', block: 'conditional', head: '', ...none },
    {
      kind: 'block-branch',
      block: 'conditional',
      head: 'g_x > 1',
      ...none,
      text: 'Many.',
      tags: [{ text: 'id:ch1.a.m001', col: 18 }],
    },
    { kind: 'block-branch', block: 'conditional', head: 'else', ...none },
    { kind: 'block-open', block: 'sequence', head: 'shuffle', ...none },
    { kind: 'block-branch', block: 'sequence', head: '', ...none, text: 'One.', tags: [{ text: 'id:ch1.a.o001', col: 12 }] },
    { kind: 'block-close', ...none },
    { kind: 'block-close', ...none },
    { kind: 'block-open', block: 'conditional', head: 'g_x', ...none },
    { kind: 'text', speaker: null, text: 'Inside.', tags: [{ text: 'id:ch1.a.t001', col: 13 }], diverts: [] },
    { kind: 'block-close', speaker: 'ally', text: 'Tail.', tags: [{ text: 'id:ch1.a.t002', col: 15 }], diverts: [] },
    { kind: 'block-open', block: 'conditional', head: 'g_x', ...none },
    { kind: 'block-close', ...none, tags: [{ text: 'bg: cafe', col: 11 }], diverts: [{ target: 'next', col: 3, tunnel: false }] },
    { kind: 'text', speaker: null, text: '{g_x: inline|text}', tags: [{ text: 'id:ch1.a.i001', col: 20 }], diverts: [] },
    { kind: 'gather', depth: 1, label: null, ...none, text: 'A gather again.' },
  ]);
});

test('classify: declarations, includes and forbidden constructs', () => {
  expect(
    classes(
      src(
        'INCLUDE ../common/globals.ink',
        'VAR g_trust_ally = 0',
        'CONST MAX_TRIES = 3',
        'LIST mood = happy, sad',
        'EXTERNAL play_sound(name)',
        '<- background',
        '-> k ->',
        '->->',
        '=== k(x) ===',
        '= s(x)',
        '=== function f(x) ===',
        'TODO: write this scene',
        'VAR text = "a # b"',
      ),
    ),
  ).toEqual([
    { kind: 'include', path: '../common/globals.ink' },
    { kind: 'decl', keyword: 'VAR', name: 'g_trust_ally', value: '0' },
    { kind: 'decl', keyword: 'CONST', name: 'MAX_TRIES', value: '3' },
    { kind: 'decl', keyword: 'LIST', name: 'mood', value: 'happy, sad' },
    { kind: 'decl', keyword: 'EXTERNAL', name: 'play_sound', value: '(name)' },
    { kind: 'thread', target: 'background' },
    { kind: 'divert', diverts: [{ target: 'k', col: 1, tunnel: true }], tunnel: true, tags: [] },
    { kind: 'divert', diverts: [{ target: '->', col: 1, tunnel: true }], tunnel: true, tags: [] },
    { kind: 'knot', name: 'k', params: 'x', fn: false },
    { kind: 'stitch', name: 's', params: 'x' },
    { kind: 'knot', name: 'f', params: 'x', fn: true },
    { kind: 'todo', text: 'write this scene' },
    { kind: 'decl', keyword: 'VAR', name: 'text', value: '"a # b"' },
  ]);
});

test('classify: opening tag lines end at the first other line', () => {
  const lines = classify(
    src(
      '=== c ===', // 1
      '# scene: cafe', // 2
      '// a comment', // 3
      '', // 4
      '# show: ally smile', // 5
      'ally: Hi. #id:ch1.c.0001', // 6
      '# bg: room', // 7
      '=== d ===', // 8
      'ally: Hello. #id:ch1.d.0001', // 9
      '# scene: street', // 10
      '=== e ===', // 11
      '# bgm: calm', // 12
      '= intro', // 13
      '# scene: cafe', // 14
      '=== f ===', // 15
      '/*', // 16
      '# scene: street', // 17
      '*/', // 18
      '# bg: cafe', // 19
      'ally: Back. #id:ch1.f.0001', // 20
      '=== g ===', // 21
      '/* # scene: street */', // 22
      'ally: Again. #id:ch1.g.0001', // 23
      '=== h ===', // 24
      '~ x = 1', // 25
      '# scene: cafe', // 26
    ),
  );
  const opening = openingTagLines(lines);
  expect(Object.fromEntries([...opening].map(([knot, run]) => [knot, run.map((l) => l.line)]))).toEqual({
    c: [2, 5],
    d: [],
    e: [12],
    // A tag line inside a block comment is not credited: the compiled story never runs it.
    f: [19],
    g: [],
    h: [],
  });
  expect(opening.get('c')?.map((l) => l.cls)).toEqual([
    { kind: 'tags', tags: [{ text: 'scene: cafe', col: 1 }] },
    { kind: 'tags', tags: [{ text: 'show: ally smile', col: 1 }] },
  ]);
});
